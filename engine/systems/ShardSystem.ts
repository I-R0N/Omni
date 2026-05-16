// ShardSystem — orchestrator for tile / shard regen, shatter, and merge.
//
// Stage 1: skeleton with no-op update / onDeath.
// Stage 2 (this stage): owns the unified regen queue.  Both STRUCTURE-tile
// and NEBULA-tile regens flow through `queueRegen` + `tickRegens`,
// driven by `SHARD_VARIANTS[variantId].regen`.  Variant-specific
// completion work (nebula composition rewrite, cache invalidation,
// neighbour-counts dirty bookkeeping) is dispatched via a small
// adapter interface implemented by NebulaSystem.
//
// Subsequent stages migrate shatter (Stage 3), homogeneous merge
// (Stage 4), then the EntityType collapse + cross-variant absorb
// (Stage 5).  See docs/SHARD_SYSTEM.md.

import { GameEntity, EntityType, Vector2, MapType, DropCompositionEntry } from '../../types';
import {
  SHARD_VARIANTS,
  REGEN_POP_CONSTANTS,
  COLORS,
  NEBULA_CONSTANTS,
  CLEANUP_CONSTANTS,
  WEAPONS,
  WEAPON_LIST,
  getRockShardFreeSpawn,
  nebulaFadeRateScale,
} from '../../constants';
import { EntityIndex } from './EntityIndex';
import { HEX_AREA, HEX_SIZE, TileGenerator, hexCoordToPixel, pixelToHexCoord } from '../maps/TileGenerator';
import {
  wrapDeltaX, wrapDeltaY, wrapPosition,
  MAP_WIDTH, MAP_HEIGHT,
} from '../toroidal';
import {
  blendCompositionToHex,
  blendCompositions,
  cloneComposition,
} from '../NebulaColor';
import { ParticleSystem } from './ParticleSystem';
import { PhysicsSystem } from './PhysicsSystem';
import { nextId } from './IdAllocator';
import {
  ShardVariantId,
  ShardVariantDef,
  VariantSelector,
  MergeRule,
  MergeOutcome,
  ShardAdapter,
} from './ShardSystem.types';

/**
 * Resolve an entity's variant id from `shardVariant` (set at every
 * spawn site).  Returns `null` for non-shard-family entities
 * (PLAYER, ENEMY, PROJECTILE, INTERACTABLE, PARTICLE).  Callers who
 * only need the variant of known shard-family entities can assert
 * non-null.
 */
export function shardVariantOf(entity: GameEntity): ShardVariantId | null {
  if (entity.shardVariant !== undefined) return entity.shardVariant;

  switch (entity.type) {
    case EntityType.STRUCTURE: {
      // Defensive default for any spawn site that hasn't stamped
      // shardVariant — glass-tile matches the legacy STRUCTURE-default.
      return 'glass-tile';
    }
    default:
      return null;
  }
}

/**
 * Per-entity regen entry.  `delaySeconds` is captured from the
 * variant config at queue time so the per-tick progress calculation
 * doesn't have to re-resolve the variant.
 */
interface RegenEntry {
  entity: GameEntity;
  timer: number;
  delaySeconds: number;
  variantId: ShardVariantId;
}

// Tile-equivalent diameter — the size at which a glass-shard is
// considered "tile-sized" and triggers the tier-transition roll
// (glass-tile vs. smaller rock-shard).  Matches the diameter of a
// circle whose area equals one hex tile.
const GLASS_TIER_DIAMETER = Math.sqrt(HEX_AREA);

/**
 * Stick-bond between two entities — replaces GameEngine.stickBonds.
 * `timer` accumulates contact dt; when it reaches `threshold` AND
 * the rule's gate (requirePartnerSizeFraction) is met, the resolved
 * outcome fires.
 */
interface BondEntry {
  a: GameEntity;
  b: GameEntity;
  timer: number;
  threshold: number;
  outcome: MergeOutcome;
  /** Optional gate for cross-variant absorbs (today: glass-shard
   *  must reach sizeMax * gate before absorb fires).  When unmet,
   *  the bond persists but the merge doesn't trigger. */
  requirePartnerSizeFraction?: number;
}

export class ShardSystem {
  /**
   * Regen queue — replaces the two separate queues that lived on
   * GameEngine (STRUCTURE tiles) and NebulaSystem (NEBULA tiles).
   * Driven by `SHARD_VARIANTS[variantId].regen` at completion time.
   */
  private pending: RegenEntry[] = [];

  /**
   * DBG toggle — gates the gravity-pull pass inside
   * runMergeBroadphase.  When false, no shard accelerates toward
   * another shard regardless of `attractedTo`.  Only nebula-shard
   * has non-'none' attractedTo today, so flipping this off mainly
   * stops nebula self-coalesce gravity and any cross-variant pull.
   */
  public shardGravityEnabled: boolean = true;
  /**
   * DBG toggle — gates bond formation in runMergeBroadphase AND
   * drops all existing bonds at the top of update().  When false,
   * shards never stick on contact; nebula self-compose (which fires
   * via the zero-time bond) and any cross-variant absorb stop too.
   */
  public shardBondingEnabled: boolean = true;
  /**
   * Active stick-bonds.  Replaces GameEngine.stickBonds.  Each bond
   * accumulates a contact timer; when timer >= threshold the bond's
   * resolved outcome ('compose' today, 'absorb' in Stage 5) fires.
   */
  private bonds: BondEntry[] = [];

  /**
   * Optional adapter providing variant-specific completion hooks.
   * Stage 2: nebula composition rewrite at regen completion.
   * Stage 4: nebula shard→tile transmutation after self-compose.
   * Non-nebula entities never call into the adapter, so non-nebula
   * regen / merge works regardless of whether one is wired.
   */
  private adapter: ShardAdapter | null = null;

  /**
   * Active drops cache (set by GameEngine).  Used by the merge
   * broadphase as additional candidates: today's stick-bond logic
   * pairs ammo / health drops with each other and with asteroids,
   * forming composite asteroids on cross-type drop merges.  The
   * dropComposition payload threading lives in composeEntities.
   */
  private activeDrops: GameEntity[] = [];

  /**
   * Caller-provided lookup for the current map type.  Used inside
   * composeEntities to read the asteroid-size cap from
   * MAP_POPULATION (today's mergeEntities call site
   * read GameEngine.currentMap.type for this).
   */
  private currentMapType: MapType = MapType.UNIVERSE;

  /**
   * Optional viewport-aware EntityIndex.  Null in headless tests / pre-
   * map-load; once wired, the large-shard-collapse pass uses it to
   * prefer offscreen candidates so collapses never pop on the player.
   */
  private entityIndex: EntityIndex | null = null;

  constructor(private particles: ParticleSystem) {}

  /** Wire the variant-specific completion adapter.  Called once at
   *  GameEngine construction after NebulaSystem is built. */
  public setAdapter(adapter: ShardAdapter): void {
    this.adapter = adapter;
  }

  /** Backwards-compat alias for the Stage 2 method name. */
  public setRegenAdapter(adapter: ShardAdapter): void {
    this.setAdapter(adapter);
  }

  /** Inject the active-drops cache + map type each frame.  Must be
   *  called before update() so the merge broadphase sees the right
   *  candidate set.  Cheap — passes a reference to the caller's
   *  array, not a copy. */
  public setMergeContext(activeDrops: GameEntity[], mapType: MapType): void {
    this.activeDrops = activeDrops;
    this.currentMapType = mapType;
  }

  /**
   * Wire the per-frame viewport-aware EntityIndex used by the
   * graceful-cleanup paths (large-shard collapse, post-merge
   * fade-out).  Called once at GameEngine construction; the index
   * is then consulted each tick via `isOffscreen(entity)`.
   */
  public setEntityIndex(index: EntityIndex): void {
    this.entityIndex = index;
  }

  /**
   * Per-frame tick.  Called from GameEngine.updateGameLogic at the
   * fixed-step dt.  Stage 4: ticks regens + merges (existing bonds +
   * new gravity-pull / bond-formation pass).  The density-compaction
   * passes (large-shard collapse + paced cleanup) run last so any
   * candidates that were just merged this frame don't get double-
   * processed.
   */
  public update(
    entities: GameEntity[],
    dt: number,
    physics: PhysicsSystem,
    runMergePass: boolean = true,
  ): void {
    const t0 = performance.now();
    // DBG bonding toggle is destructive — when off, any bonds left
    // over from the previous frame are dropped here so cohesion
    // stops dragging shards together as soon as the user flips it.
    if (!this.shardBondingEnabled && this.bonds.length > 0) {
      this.bonds.length = 0;
    }
    this.tickRegens(entities, dt, physics);
    // tickBonds always runs to advance bond timers, break bonds
    // whose parties have separated, and resolve compose / absorb
    // when timers mature.  The cohesion velocity-blend inside
    // tickBonds is gated by runMergePass so it doesn't drag bonded
    // shards together on frames when separation is skipped — that
    // imbalance is what collapsed clusters to a single point on
    // high-N ShPair settings.
    this.tickBonds(entities, dt, physics, runMergePass);
    if (runMergePass) {
      this.runMergeBroadphase(entities, dt, physics);
      this.runLargeShardCollapse(entities);
    }
    this.lastUpdateMs = performance.now() - t0;
  }

  /**
   * Wall time (ms) of the most recent update() call.  Read by
   * GameEngine for the dev perf overlay so the cost of merge
   * broadphase + bond ticks + density compaction is visible
   * outside the main physics / collisions buckets.
   */
  public lastUpdateMs: number = 0;

  /**
   * Death-routing entry point.  Stage 1–2: returns false (existing
   * GameEngine paths still own death dispatch).  Stage 5 will route
   * variant-driven shatter through here.
   */
  public onDeath(_entity: GameEntity): boolean {
    return false;
  }

  /**
   * Hard reset — called on game restart so a fresh run doesn't
   * inherit queued regens / bonds from the previous session.
   */
  public reset(): void {
    this.pending.length = 0;
    this.bonds.length = 0;
  }

  // ── Regen queue ───────────────────────────────────────────────────

  /**
   * Queue an entity for regen if its variant supports it.  Reads
   * `variant.regen.kind` / `delaySeconds` from `SHARD_VARIANTS`.
   * No-op if the variant's regen is `'none'` or `'merge-only'`, so
   * callers (handleEntityDeath, NebulaSystem.handleDeath) can call
   * unconditionally and let the variant config decide.
   *
   * Mirrors today's populate-site contract: sets `regenProgress = 0`
   * on the entity so the renderer draws a ghost outline during the
   * regen wait.
   */
  public queueRegen(entity: GameEntity): void {
    const variantId = shardVariantOf(entity);
    if (variantId === null) return;
    const variant = SHARD_VARIANTS[variantId];
    if (variant.regen.kind !== 'timer') return;
    const delay = variant.regen.delaySeconds;
    if (delay === undefined || delay <= 0) return;

    entity.regenProgress = 0;
    this.pending.push({
      entity,
      timer: delay,
      delaySeconds: delay,
      variantId,
    });
  }

  /**
   * Drain the regen queue: per-tick timer decrement, per-frame
   * `regenProgress` update for the renderer, and on completion the
   * variant-driven revive (health/active reset, optional pop-burst
   * particles, optional neighbourhood-blend hook, static-grid
   * re-add).
   */
  private tickRegens(entities: GameEntity[], dt: number, physics: PhysicsSystem): void {
    if (this.pending.length === 0) return;

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const regen = this.pending[i];
      regen.timer -= dt;
      regen.entity.regenProgress = 1 - (regen.timer / regen.delaySeconds);

      if (regen.timer <= 0) {
        this.completeRegen(regen, entities, physics);
        this.pending.splice(i, 1);
      }
    }
  }

  /** Revive a single entity at regen completion. */
  private completeRegen(regen: RegenEntry, entities: GameEntity[], physics: PhysicsSystem): void {
    const entity = regen.entity;
    const variant = SHARD_VARIANTS[regen.variantId];

    entity.health = entity.maxHealth;
    entity.active = true;
    entity.regenProgress = undefined;

    // Variant-specific completion hook (nebula composition rewrite
    // + cache invalidation + neighbour-counts dirty bookkeeping +
    // grid-index update).  Adapter no-ops gracefully when not set.
    if (variant.regen.rewriteColor === 'neighborhood-blend') {
      this.regenAdapter?.onNeighborhoodBlendRegen(entity, entities);
    }

    // Re-register in the static grid so collisions hit again.  Both
    // STRUCTURE and NEBULA tiles need this — today both code paths
    // call physics.addStaticEntity at completion.
    physics.addStaticEntity(entity);

    // Variant-driven pop animation: STRUCTURE tiles emit a chip
    // burst of tile-coloured particles; nebula tiles use the
    // fade-in via nebulaSpawnTimer (set inside the adapter).
    const popBurst = variant.regen.popBurst;
    if (popBurst) {
      entity.regenPopTimer = REGEN_POP_CONSTANTS.DURATION;
      this.particles.spawn(entities, entity.position, popBurst.chipCount, entity.color || '#6366f1', {
        speedMin: popBurst.chipSpeedMin,
        speedMax: popBurst.chipSpeedMax,
        lifetimeMin: popBurst.chipLifetime,
        lifetimeMax: popBurst.chipLifetime,
        sizeMin: 1, sizeMax: 2,
      });
    }
  }

  // ── Shatter dispatch ──────────────────────────────────────────────

  /**
   * Variant-driven shatter.  Reads `SHARD_VARIANTS[variant].shatter`
   * and produces children according to the configured style.
   * Today's two styles:
   *
   *  - 'asteroid' — power-law area distribution over parent area,
   *                 cone scatter around impact direction, count
   *                 driven by lastImpactDamage.  Replaces today's
   *                 `GameEngine.createAsteroidShards`.
   *  - 'nebula'   — fixed 2–3 children sized off GLASS_TILE_HALF²
   *                 (independent of parent size), rear-cone fan
   *                 positioning, tangent-rule spin, parallel/perp
   *                 velocity model.  Replaces today's
   *                 `NebulaSystem.spawnShards`.
   *
   *  Variants whose `shatter.kind === 'none'` are no-ops, so callers
   *  can dispatch unconditionally.  STRUCTURE tile variants today
   *  spawn glass-shards via DropSystem.spawnGlassShards (out of
   *  scope per task brief) and `shatter.kind === 'powerlaw'` is
   *  currently invoked only by ASTEROID + NEBULA + NEBULA_SHARD
   *  death dispatch in GameEngine.
   */
  public shatter(parent: GameEntity, entities: GameEntity[]): void {
    const variantId = shardVariantOf(parent);
    if (variantId === null) return;
    const variant = SHARD_VARIANTS[variantId];
    if (variant.shatter.kind !== 'powerlaw') return;

    if (variant.shatter.style === 'nebula') {
      this.shatterNebulaStyle(parent, variant, entities);
    } else {
      this.shatterAsteroidStyle(parent, variant, entities);
    }
  }

  /**
   * Generate a polygon at the given world-space radius using the
   * variant spawn shape's polyVerticesMin/Max + jitter parameters.
   * Returns world-space polygon points (sorted by angle so SAT
   * narrowphase works correctly).
   */
  private generateShardPolygon(
    baseR: number,
    polyVerticesMin: number,
    polyVerticesMax: number,
    angleJitter: number,
    radiusMin: number,
    radiusRange: number,
    polyVerticesOptions?: number[],
  ): Vector2[] {
    // Discrete options take priority over the continuous Min/Max range
    // (used by rock-shard / metal-shard to snap to specific counts).
    const numPoints = polyVerticesOptions !== undefined && polyVerticesOptions.length > 0
      ? polyVerticesOptions[Math.floor(Math.random() * polyVerticesOptions.length)]
      : polyVerticesMin + Math.floor(Math.random() * (polyVerticesMax - polyVerticesMin + 1));
    const rawPts: { angle: number; r: number }[] = [];
    for (let j = 0; j < numPoints; j++) {
      const baseAngle  = (j / numPoints) * Math.PI * 2;
      const jitterAmt  = (Math.random() - 0.5) * (Math.PI / numPoints) * angleJitter;
      rawPts.push({ angle: baseAngle + jitterAmt, r: baseR * (radiusMin + Math.random() * radiusRange) });
    }
    rawPts.sort((a, b) => a.angle - b.angle);
    return rawPts.map(p => ({ x: Math.cos(p.angle) * p.r, y: Math.sin(p.angle) * p.r }));
  }

  /**
   * Asteroid-style shatter — port of GameEngine.createAsteroidShards.
   * Power-law area distribution over the parent's area, cone scatter
   * around impact direction, child count driven by impact damage.
   * Used by rock-shard, glass-shard, rock-tile, and (when wired in
   * future stages) STRUCTURE-tile variants.
   */
  private shatterAsteroidStyle(
    parent: GameEntity,
    parentVariant: ShardVariantDef,
    entities: GameEntity[],
  ): void {
    const childVariant = SHARD_VARIANTS[parentVariant.shatter.childVariant];
    const MIN_SIZE = childVariant.spawn.sizeMin;
    const parentArea = parent.size.x * parent.size.x;

    // If parent is too small to yield two valid fragments, stop.
    if (parentArea < MIN_SIZE * MIN_SIZE * 2) return;

    // Damage scales both count and size distribution.  damageNorm 0
    // → countMin pieces, mostly large (alphaMin); damageNorm 1 →
    // countMax pieces, mostly small (alphaMax).
    const damage     = parent.lastImpactDamage ?? 1;
    const damageNorm = Math.min(1, (damage - 1) / 4);
    const { countMin, countMax, alphaMin, alphaMax } = parentVariant.shatter;
    const count = countMin + Math.round(damageNorm * (countMax - countMin));
    if (count < 2) return;

    const alpha = alphaMin + damageNorm * (alphaMax - alphaMin);
    const rawAreas = Array.from({ length: count }, () => Math.pow(Math.random(), alpha));
    const rawSum   = rawAreas.reduce((s, a) => s + a, 0);

    const sizes: number[] = rawAreas
      .map(a => Math.sqrt((a / rawSum) * parentArea))
      .filter(s => s >= MIN_SIZE);
    if (sizes.length < 2) return;

    // Resolve impact direction.
    const iv = parent.lastImpactVelocity;
    const impactSpeed = iv ? Math.sqrt(iv.x * iv.x + iv.y * iv.y) : 0;
    const impactAngle = impactSpeed > 0.001 ? Math.atan2(iv!.y, iv!.x) : null;
    const HALF_CONE   = parentVariant.shatter.scatterHalfCone;

    const parentRadius = parent.size.x / 2;
    const isTile = childVariant.id === 'glass-shard'; // colour fallback distinguishes blocky vs jagged
    const childSpawn = childVariant.spawn;

    for (let i = 0; i < sizes.length; i++) {
      const newSize = sizes[i];
      const hp      = newSize > 30 ? 2 : 1;

      let scatterAngle: number;
      let scatterSpeed: number;
      if (impactAngle !== null) {
        scatterAngle = impactAngle + (Math.random() - 0.5) * 2 * HALF_CONE;
        scatterSpeed = impactSpeed * parentVariant.shatter.forwardDrag + 0.4 + Math.random() * 1.2;
      } else {
        scatterAngle = Math.random() * Math.PI * 2;
        scatterSpeed = 1 + Math.random() * 2;
      }

      const vx = parent.velocity.x + Math.cos(scatterAngle) * scatterSpeed;
      const vy = parent.velocity.y + Math.sin(scatterAngle) * scatterSpeed;

      const baseR = (newSize / 2) * 0.8;
      const points = this.generateShardPolygon(
        baseR,
        childSpawn.polyVerticesMin,
        childSpawn.polyVerticesMax,
        childSpawn.angleJitter,
        childSpawn.radiusMin,
        childSpawn.radiusRange,
        childSpawn.polyVerticesOptions,
      );

      const offsetX = Math.cos(scatterAngle) * parentRadius * 0.25;
      const offsetY = Math.sin(scatterAngle) * parentRadius * 0.25;
      const maxSpin = 2.0 / (newSize / 20);

      // Stage 5: shard-family entities live on a single EntityType
      // (STRUCTURE), with shardVariant declaring the variant id.
      // PhysicsSystem dispatches by mass (∞ → static grid, finite →
      // dynamic) and per-variant passThrough flag.
      entities.push({
        id:           nextId('shard'),
        type:          EntityType.STRUCTURE,
        shardVariant:  childVariant.id,
        position:     { x: parent.position.x + offsetX, y: parent.position.y + offsetY },
        velocity:     { x: vx, y: vy },
        size:         { x: newSize, y: newSize },
        rotation:      Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 2 * maxSpin,
        color:         isTile ? parent.color : COLORS.ASTEROID,
        active:        true,
        health:        hp,
        maxHealth:     hp,
        polygonPoints: points,
        mass:          childSpawn.sizeToMass(newSize),
        sprite:        parent.sprite,
      });
    }

    // Variant-driven dust/debris burst.  Today's per-parent count
    // formula `5 + floor(parent.size.x / 20)` is preserved inline;
    // the variant's onShatterParticles supplies the colour ('inherit'
    // → parent.color for tile shards; { color } for rock shards).
    const onParticles = parentVariant.onShatterParticles;
    if (onParticles && onParticles !== 'none') {
      const dustColor = onParticles === 'inherit'
        ? (parent.color || '#94a3b8')
        : onParticles.color;
      const dustCount = 5 + Math.floor(parent.size.x / 20);
      const dustSpeed = impactSpeed * 0.4 + 2;
      this.particles.spawn(entities, parent.position, dustCount, dustColor, {
        speedMin: 1, speedMax: dustSpeed,
        sizeMin: 1, sizeMax: 2.5,
        lifetimeMin: 0.25, lifetimeMax: 0.55,
        spreadAngle: impactAngle ?? undefined,
        spreadCone: Math.PI,
        baseVelocity: parent.velocity,
      });
    }
  }

  /**
   * Nebula-style shatter — port of NebulaSystem.spawnShards.  Fixed
   * count (2–3), GLASS_TILE_HALF² area budget regardless of parent
   * size, rear-cone fan positioning behind the striker, tangent-rule
   * spin, parallel/perp velocity model.  Children inherit the parent's
   * composition + sprite + grid coords; effective area is split
   * equally so a full shatter still carries one HEX_AREA back toward
   * transmutation.
   */
  private shatterNebulaStyle(
    parent: GameEntity,
    parentVariant: ShardVariantDef,
    entities: GameEntity[],
  ): void {
    // Parent area budget for the shard power-law distribution.  We
    // intentionally use the glass-shard convention (TILE_HALF² = 121
    // for TILE_HALF = 11) regardless of the actual nebula tile size
    // so the resulting shards are the SAME scale as glass shards.
    const GLASS_TILE_HALF = 11;
    const parentArea = GLASS_TILE_HALF * GLASS_TILE_HALF;
    const childVariant = SHARD_VARIANTS[parentVariant.shatter.childVariant];
    const MIN_RADIUS = 2; // don't spawn sub-pixel shards

    const { countMin, countMax, alphaMin } = parentVariant.shatter;
    const countRange = countMax - countMin + 1;
    const count = countMin + Math.floor(Math.random() * countRange);
    const alpha = alphaMin; // nebula uses uniform alphaMin === alphaMax

    const rawAreas = Array.from({ length: count }, () => Math.pow(Math.random(), alpha));
    const rawSum   = rawAreas.reduce((s, a) => s + a, 0);
    const radii: number[] = rawAreas
      .map(a => Math.sqrt((a / rawSum) * parentArea))
      .filter(r => r >= MIN_RADIUS);
    if (radii.length < 1) return;

    const composition = parent.nebulaColorComposition;

    // Striker direction (forward vector).
    const iv = parent.lastImpactVelocity;
    const impactSpeed = iv ? Math.sqrt(iv.x * iv.x + iv.y * iv.y) : 0;
    let fx = 1, fy = 0;
    if (iv && impactSpeed > 0.001) {
      fx = iv.x / impactSpeed;
      fy = iv.y / impactSpeed;
    }

    const spinK = Math.min(
      NEBULA_CONSTANTS.MAX_SPIN,
      1 + impactSpeed * NEBULA_CONSTANTS.SPIN_PER_UNIT_SPEED,
    );

    // Effective birth fade-in duration — matches the rateScale
    // PhysicsSystem used for the parent's fade-out.
    const shardRateScale = nebulaFadeRateScale(impactSpeed);
    const fadeInBase = parentVariant.shatter.fadeInSeconds ?? NEBULA_CONSTANTS.FADE_IN_DURATION;
    const shardSpawnDuration = fadeInBase / shardRateScale;

    // REARWARD fan: children spawn behind the striker, spread
    // symmetrically across 2 × scatterHalfCone.
    const fan  = parentVariant.shatter.scatterHalfCone;
    const shardCount = radii.length;
    const step = shardCount > 1 ? (2 * fan) / (shardCount - 1) : 0;
    const parentRadius = Math.max(parent.size.x, parent.size.y) / 2;
    const offsetMag = parentRadius * NEBULA_CONSTANTS.SHARD_SPAWN_OFFSET_RATIO;

    const childSpawn = childVariant.spawn;
    const postCooldown = parentVariant.shatter.postShatterMergeCooldown ?? 0;

    for (let i = 0; i < shardCount; i++) {
      const radius = radii[i];

      // Polygon at the world-space radius (not the entity diameter,
      // matching the existing nebula spawnShards convention).
      const points = this.generateShardPolygon(
        radius,
        childSpawn.polyVerticesMin,
        childSpawn.polyVerticesMax,
        childSpawn.angleJitter,
        childSpawn.radiusMin,
        childSpawn.radiusRange,
        childSpawn.polyVerticesOptions,
      );
      const size = radius * 4; // diameter with a bit of slack for physics feel

      // Rear-cone angle: π + (−fan … +fan) relative to forward.
      const offsetAngle = Math.PI + (shardCount > 1 ? -fan + step * i : 0);
      const cosA = Math.cos(offsetAngle);
      const sinA = Math.sin(offsetAngle);
      const dx = fx * cosA - fy * sinA;
      const dy = fx * sinA + fy * cosA;

      const spawnPos = { x: parent.position.x + dx * offsetMag, y: parent.position.y + dy * offsetMag };
      wrapPosition(spawnPos);

      // Tangent-rule side for spin direction.
      const cross = fx * dy - fy * dx;
      const spinSign = cross > 0.01 ? 1
                      : cross < -0.01 ? -1
                      : (Math.random() < 0.5 ? 1 : -1);
      const rotationSpeed = spinSign * spinK;

      // "Dragged along" velocity model.
      const parallelSpeed = Math.max(
        NEBULA_CONSTANTS.MIN_PARALLEL_SPEED,
        impactSpeed * parentVariant.shatter.forwardDrag,
      );
      const perpSpeed = impactSpeed * parentVariant.shatter.perpScatter;
      const perpSign = cross > 0.01 ? 1 : cross < -0.01 ? -1 : 0;
      const perpX = -fy * perpSign * perpSpeed;
      const perpY =  fx * perpSign * perpSpeed;
      const velX = fx * parallelSpeed + perpX;
      const velY = fy * parallelSpeed + perpY;

      entities.push({
        id:              nextId('nebula_shard'),
        // Stage 5: unified carrier with mass-based dispatch.  Mass
        // resolves via childSpawn.sizeToMass() which the nebula-shard
        // variant overrides to () => 0.01 — striker impulse is
        // negligible without needing a per-EntityType skip.
        type:            EntityType.STRUCTURE,
        shardVariant:   childVariant.id,
        position:       { x: spawnPos.x, y: spawnPos.y },
        velocity:       { x: velX, y: velY },
        size:           { x: size, y: size },
        rotation:        Math.random() * Math.PI * 2,
        rotationSpeed,
        color:           composition ? blendCompositionToHex(composition) : (parent.color || NEBULA_CONSTANTS.DEFAULT_HEX),
        active:          true,
        health:          1,
        maxHealth:       1,
        mass:            childSpawn.sizeToMass(size),
        polygonPoints:   points,
        sprite:          parent.sprite,
        nebulaColorComposition: composition ? cloneComposition(composition) : undefined,
        nebulaGridCol:   parent.nebulaGridCol,
        nebulaGridRow:   parent.nebulaGridRow,
        linearDamping:   NEBULA_CONSTANTS.LINEAR_DAMPING,
        angularDamping:  NEBULA_CONSTANTS.ANGULAR_DAMPING,
        nebulaSpawnTimer:    shardSpawnDuration,
        nebulaSpawnDuration: shardSpawnDuration,
        nebulaMergeCooldown: postCooldown,
      });
    }
  }

  // ── Merge dispatch ────────────────────────────────────────────────

  /**
   * Evaluate a VariantSelector against a target variant id.  Pure
   * function; no allocation.
   */
  private selects(selector: VariantSelector, targetId: ShardVariantId, selfId: ShardVariantId): boolean {
    if (selector === 'none') return false;
    if (selector === 'all')  return true;
    if (selector === 'self') return targetId === selfId;
    if ('include' in selector) {
      for (let i = 0; i < selector.include.length; i++) {
        if (selector.include[i] === targetId) return true;
      }
      return false;
    }
    // exclude form
    for (let i = 0; i < selector.exclude.length; i++) {
      if (selector.exclude[i] === targetId) return false;
    }
    return true;
  }

  /**
   * Find the per-pair rule the puller's merge.rules expresses for a
   * partner variant.  Falls back to defaultOutcome if no rule
   * matches.  Mirrors the resolver in §3 of docs/SHARD_SYSTEM.md.
   */
  private resolveRule(pullerVariant: ShardVariantDef, partnerId: ShardVariantId): MergeRule {
    const rules = pullerVariant.merge.rules;
    if (rules) {
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        if (r.partner === partnerId) return r;
        if (r.partner === 'self' && partnerId === pullerVariant.id) return r;
      }
    }
    return { partner: 'self', outcome: pullerVariant.merge.defaultOutcome };
  }

  /**
   * Tick existing stick-bonds: cohesion velocity blend + timer
   * accumulation + merge-fire when threshold is met.  Bonds whose
   * parties have separated past BREAK_FACTOR contact distance, or
   * whose parties have gone inactive, are dropped silently.
   *
   * Mirrors the existing-bonds-update half of the previous
   * GameEngine.handleEntitySticking.  The new-contacts-detection
   * half lives in `runMergeBroadphase` below.
   */
  private tickBonds(entities: GameEntity[], dt: number, physics: PhysicsSystem, applyCohesion: boolean = true): void {
    if (this.bonds.length === 0) return;

    const COHESION     = 4.0;   // fraction of velocity delta corrected per second
    const BREAK_FACTOR = 1.5;   // bond breaks when dist > contactDist * this
    // Per-frame merge budget — caps how many density-compaction merges
    // may fire this tick.  Prevents a freshly-shattered cluster (whose
    // bond timers all elapse in the same frame) from collapsing into a
    // single shard in one frame; instead, the cluster compacts visibly
    // over a few frames.  Once exhausted, surplus bonds defer their
    // resolution by reverting timer to (threshold - dt) so they fire
    // next tick.  Sized at MAX_REMOVALS_PER_FRAME for the same reason
    // the cleanup pacing uses that budget — fade-pacing and merge-
    // pacing should breathe at the same rate.
    let mergeBudget = CLEANUP_CONSTANTS.MAX_REMOVALS_PER_FRAME;

    let writeIdx = 0;
    for (let bi = 0; bi < this.bonds.length; bi++) {
      const bond = this.bonds[bi];
      const { a, b } = bond;

      if (!a.active || !b.active) continue; // discard

      const dx = wrapDeltaX(a.position.x, b.position.x);
      const dy = wrapDeltaY(a.position.y, b.position.y);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const contactDist = (a.size.x + b.size.x) * 0.5;

      if (dist > contactDist * BREAK_FACTOR) continue; // bond broken

      // Velocity cohesion: nudge both toward shared momentum centre.
      // Gated by applyCohesion so the blend runs only on the same
      // cadence as separation — without that pacing, cohesion locks
      // bonded shards to a shared velocity / position while
      // separation is skipped, and clusters collapse to a point.
      if (applyCohesion) {
        const totalMass = a.mass + b.mass;
        const sharedVx  = (a.velocity.x * a.mass + b.velocity.x * b.mass) / totalMass;
        const sharedVy  = (a.velocity.y * a.mass + b.velocity.y * b.mass) / totalMass;
        const blend     = Math.min(1, COHESION * dt);
        a.velocity.x   += (sharedVx - a.velocity.x) * blend;
        a.velocity.y   += (sharedVy - a.velocity.y) * blend;
        b.velocity.x   += (sharedVx - b.velocity.x) * blend;
        b.velocity.y   += (sharedVy - b.velocity.y) * blend;
      }

      bond.timer += dt;

      if (bond.timer >= bond.threshold) {
        // Stage 5b: requirePartnerSizeFraction gate.  If unmet, the
        // bond persists with cohesion active but the merge doesn't
        // fire — useful for "rare-event" cross-variant outcomes
        // (e.g. nebula absorbed only into max-size glass-shards).
        const gate = bond.requirePartnerSizeFraction;
        let gateMet = true;
        if (gate !== undefined && gate > 0) {
          // Evaluate the gate against the LARGER side (the absorb host).
          const host = a.size.x >= b.size.x ? a : b;
          const hostVariant = shardVariantOf(host);
          if (hostVariant !== null) {
            const sizeMax = SHARD_VARIANTS[hostVariant].spawn.sizeMax;
            gateMet = host.size.x >= sizeMax * gate;
          }
        }
        if (gateMet) {
          // Per-frame merge budget — surplus bonds defer to next tick
          // so a cluster of bonds whose timers all elapse in the same
          // frame compacts visibly over several frames instead of in
          // one.  Defer by clamping timer just below threshold so the
          // bond stays alive and re-checks next tick.
          if (mergeBudget <= 0) {
            bond.timer = bond.threshold - dt;
            this.bonds[writeIdx++] = bond;
            continue;
          }
          this.composeEntities(a, b, entities, physics, bond.outcome);
          mergeBudget--;
          continue; // bond resolved — drop
        }
        // Gate unmet — cap the timer at threshold and keep the bond
        // alive.  Cohesion stays active; next frame re-checks gate.
        bond.timer = bond.threshold;
      }

      this.bonds[writeIdx++] = bond;
    }
    this.bonds.length = writeIdx;
  }

  /**
   * Single-pass merge broadphase: build a shared spatial hash over
   * mobile shard candidates + eligible drops, walk it once, and for
   * each pair perform two orthogonal jobs:
   *
   *   1. Pull pass:  if puller's variant.attractedTo selects partner
   *                  and pull tuning is configured, find the nearest
   *                  qualifying neighbour and apply gravity force.
   *                  Mirrors today's NebulaSystem.updateDynamics
   *                  (nearest-larger, 1/dist force).
   *   2. Bond pass:  if either variant's bondsWith selects the other
   *                  and the pair is in contact and neither is
   *                  already bonded this frame, form a stick-bond
   *                  with the resolved per-pair threshold.  Mirrors
   *                  today's GameEngine.handleEntitySticking
   *                  contact-detection.
   *
   *  Shared state per pass: spatial hash (built once, scanned
   *  separately), `bonded` set (entities currently in active bonds
   *  this frame — prevents new bond formation against already-
   *  bonded parties).  Both passes use 380-unit cells matching
   *  today's nebula-gravity grid; the asteroid stick-grid (110-unit
   *  cells today) was redundantly wider than necessary — the new
   *  3×3 scan radius (3 × 380 = 1140) comfortably covers the
   *  104-unit max contact distance.
   */
  private runMergeBroadphase(entities: GameEntity[], dt: number, _physics: PhysicsSystem): void {
    // Track which entities are currently in active stick-bonds so
    // the bond-formation pass doesn't double-bond.
    const bonded = new Set<GameEntity>();
    for (let i = 0; i < this.bonds.length; i++) {
      bonded.add(this.bonds[i].a);
      bonded.add(this.bonds[i].b);
    }


    // Candidate set: every mobile shard-family entity + eligible drops.
    // Stage 5: shards live on EntityType.STRUCTURE with finite mass
    // (mass=Infinity tiles are in the static grid — never candidates).
    // The legacy ASTEROID branch is kept as defence for any spawn
    // site that hasn't migrated yet.  Fading nebula-shards are
    // skipped (they're in their death animation).
    const candidates: GameEntity[] = [];
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!e.active) continue;
      if (e.type !== EntityType.STRUCTURE || e.mass === Infinity) continue;
      // Once a shard is in its graceful retire window (merge fade-
      // out) it must not pull, bond, or get pulled.  Otherwise its
      // velocity blends with surviving partners and the dissolve
      // looks chaotic.
      if (e.mergeFadeTimer !== undefined) continue;
      candidates.push(e);
    }
    for (let i = 0; i < this.activeDrops.length; i++) {
      const d = this.activeDrops[i];
      if (d.active && d.dropType !== 'glass' && d.dropType !== 'health') candidates.push(d);
    }
    if (candidates.length < 2) return;

    // Spatial hash — cell size matches the widest pull range across
    // variants (380, from nebula-shard gravity).  The 3×3 cell scan
    // covers contact distances up to 1140 — comfortably above the
    // ~104 max for 200-diameter asteroid pairs.
    const CELL = NEBULA_CONSTANTS.GRAVITY_RANGE;
    const COLS = Math.ceil(MAP_WIDTH  / CELL);
    const ROWS = Math.ceil(MAP_HEIGHT / CELL);
    const keyFor = (cx: number, cy: number) => {
      const wx = ((cx % COLS) + COLS) % COLS;
      const wy = ((cy % ROWS) + ROWS) % ROWS;
      return (wx << 16) | (wy & 0xFFFF);
    };
    const grid = new Map<number, number[]>();
    for (let i = 0; i < candidates.length; i++) {
      const c  = candidates[i];
      const cx = Math.floor(c.position.x / CELL);
      const cy = Math.floor(c.position.y / CELL);
      const key = keyFor(cx, cy);
      let cell = grid.get(key);
      if (!cell) { cell = []; grid.set(key, cell); }
      cell.push(i);
    }

    const CONTACT_BUFFER = 4;

    // Per-frame set: at most one merge per target this frame keeps
    // sibling shards from a single shatter from all stacking into
    // the same nearest tile.  Mirrors today's nebula updateDynamics
    // mergedThisFrame guard.
    const bondedThisFrame = new Set<GameEntity>();

    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      if (!a.active) continue;

      const aVariantId = shardVariantOf(a);
      // Drops have no shard variant — skip the variant-driven passes
      // for them, but they're still candidates for a partner's
      // bond-formation scan below.
      const aVariant: ShardVariantDef | null = aVariantId !== null ? SHARD_VARIANTS[aVariantId] : null;

      // Cooldown gate: freshly-spawned / freshly-merged shards skip
      // both pull and bond formation until their cooldown expires.
      if ((a.nebulaMergeCooldown ?? 0) > 0) continue;

      const acx = Math.floor(a.position.x / CELL);
      const acy = Math.floor(a.position.y / CELL);

      // ── Pull pass: find nearest larger qualifying neighbour ────
      let bestPullTarget: GameEntity | null = null;
      let bestPullDistSq = Infinity;
      const aR = Math.max(a.size.x, a.size.y) / 2;

      // ── Bond formation pass ────────────────────────────────────
      const aBondedAlready = bonded.has(a) || bondedThisFrame.has(a);

      // Pull pass is suppressed once the puller is already in a
      // stick-bond (this frame or a prior frame).  Without this
      // gate, gravity keeps adding velocity each frame on top of
      // the bond's cohesion blend — a nebula-shard cohering with a
      // glass-shard would get a steady-state velocity kick that
      // both sides eventually share via cohesion, accelerating the
      // pair indefinitely.  Asteroid stick-bonds today have no
      // gravity at all, so this matches their behaviour.
      const wantsPull = this.shardGravityEnabled
                     && aVariant && aVariant.merge.attractedTo !== 'none'
                     && !aBondedAlready;

      for (let ncx = acx - 1; ncx <= acx + 1; ncx++) {
        for (let ncy = acy - 1; ncy <= acy + 1; ncy++) {
          const cell = grid.get(keyFor(ncx, ncy));
          if (!cell) continue;
          for (let k = 0; k < cell.length; k++) {
            const j = cell[k];
            if (j === i) continue;
            const b = candidates[j];
            if (!b.active) continue;

            const bVariantId = shardVariantOf(b);
            const bVariant: ShardVariantDef | null = bVariantId !== null ? SHARD_VARIANTS[bVariantId] : null;

            const dx = wrapDeltaX(a.position.x, b.position.x);
            const dy = wrapDeltaY(a.position.y, b.position.y);
            const distSq = dx * dx + dy * dy;

            // Pull pass: only run on the "lower-i" pair traversal
            // (skip if j <= i would dedupe), but pull is unilateral
            // (only puller a receives force), so we DO want to
            // process this pair even when j < i.  Cooldowns on the
            // target are honoured.
            if (wantsPull && bVariantId !== null) {
              const bR = Math.max(b.size.x, b.size.y) / 2;
              const pullRange  = aVariant!.merge.pullRange ?? CELL;
              const pullRangeSq = pullRange * pullRange;
              const targetCooldownOk = (b.nebulaMergeCooldown ?? 0) <= 0;
              const matchesPull = aVariant!.merge.attractedTo !== 'none'
                && this.selects(aVariant!.merge.attractedTo, bVariantId, aVariantId!);
              // Today's nebula gravity targets nearest LARGER-OR-EQUAL
              // neighbour.  Preserve.
              if (matchesPull && targetCooldownOk && bR >= aR
                  && distSq <= pullRangeSq && distSq < bestPullDistSq) {
                bestPullDistSq = distSq;
                bestPullTarget = b;
              }
            }

            // Bond formation: only consider each unordered pair once
            // (j > i), and skip if either party is already bonded.
            // DBG-gated — when shardBondingEnabled is false, skip
            // the entire formation block.
            if (!this.shardBondingEnabled) continue;
            if (j <= i) continue;
            if (aBondedAlready) continue;
            if (bonded.has(b) || bondedThisFrame.has(b)) continue;

            const contactDist = (a.size.x + b.size.x) * 0.5 + CONTACT_BUFFER;
            if (distSq > contactDist * contactDist) continue;

            // Decide which side is the "puller" for rule resolution.
            // Either side may want the bond — variant selectors are
            // evaluated on both.
            let pullerVariant: ShardVariantDef | null = null;
            if (aVariant && aVariant.merge.bondsWith !== 'none' && bVariantId !== null
                && this.selects(aVariant.merge.bondsWith, bVariantId, aVariantId!)) {
              pullerVariant = aVariant;
            } else if (bVariant && bVariant.merge.bondsWith !== 'none' && aVariantId !== null
                && this.selects(bVariant.merge.bondsWith, aVariantId, bVariantId)) {
              pullerVariant = bVariant;
            } else if (a.type !== EntityType.STRUCTURE && b.type !== EntityType.STRUCTURE
                && a.dropType && b.dropType) {
              // Drop+drop bonding is variant-less today; preserve via
              // a synthetic threshold (same-type 10s, cross-type 20s).
              const sameType = a.dropType === b.dropType;
              if (!sameType && Math.random() > 0.5) continue;
              const SIZE_REF = 20, SIZE_POWER = 1.5;
              const avgSize  = (a.size.x + b.size.x) * 0.5;
              const sizeRatio = Math.max(1, avgSize / SIZE_REF);
              const baseTime  = sameType ? 10.0 : 20.0;
              const threshold = baseTime * Math.pow(sizeRatio, SIZE_POWER);
              this.bonds.push({ a, b, timer: 0, threshold, outcome: 'compose' });
              bondedThisFrame.add(a);
              bondedThisFrame.add(b);
              continue;
            } else {
              continue; // neither side wants the bond
            }

            // Cooldowns gate bond formation too.
            if ((b.nebulaMergeCooldown ?? 0) > 0) continue;

            const partnerId = pullerVariant === aVariant ? bVariantId : aVariantId;
            if (partnerId === null) continue;
            const rule = this.resolveRule(pullerVariant, partnerId);

            // Both 'compose' and 'absorb' outcomes are supported in
            // Stage 5b.  Other outcomes (none yet) skip the bond.
            if (rule.outcome !== 'compose' && rule.outcome !== 'absorb') continue;

            // Threshold: pullerVariant.merge.bondTimeSeconds, scaled
            // by size and the rule's thresholdScale.  For absorb
            // rules with bondTimeSeconds=0 (nebula → glass-shard) we
            // bump the base to MERGE_COOLDOWN so thresholdScale is
            // meaningful; the size-fraction gate is the dominant
            // gate anyway.
            let baseTime  = pullerVariant.merge.bondTimeSeconds ?? 10;
            if (rule.outcome === 'absorb' && baseTime <= 0) {
              baseTime = pullerVariant.merge.postMergeCooldown ?? 1.0;
            }
            const sizeRef   = pullerVariant.merge.bondTimeSizeRef   ?? 20;
            const sizePower = pullerVariant.merge.bondTimeSizePower ?? 1.5;
            const avgSize   = (a.size.x + b.size.x) * 0.5;
            const sizeRatio = sizeRef > 0 ? Math.max(1, avgSize / sizeRef) : 1;
            const baseScaled = baseTime * Math.pow(sizeRatio, sizePower);
            const threshold  = baseScaled * (rule.thresholdScale ?? 1);

            this.bonds.push({
              a, b, timer: 0, threshold,
              outcome: rule.outcome,
              requirePartnerSizeFraction: rule.requirePartnerSizeFraction,
            });
            bondedThisFrame.add(a);
            bondedThisFrame.add(b);

            // bondTimeSeconds === 0 (nebula's instant-merge case) →
            // fire compose immediately so today's same-frame nebula
            // merge timing is preserved.  Absorb rules don't take
            // this path (their effective baseTime is bumped above).
            if (threshold <= 0 && rule.outcome === 'compose') {
              this.composeEntities(a, b, entities, _physics, 'compose');
              // Drop the just-pushed bond (it's already resolved).
              this.bonds.pop();
            }
          }
        }
      }

      // Apply pull force toward the chosen target (if any).
      if (bestPullTarget && wantsPull) {
        const dx = wrapDeltaX(a.position.x, bestPullTarget.position.x);
        const dy = wrapDeltaY(a.position.y, bestPullTarget.position.y);
        const dist = Math.sqrt(bestPullDistSq);
        if (dist > 0.0001) {
          const minDist = aVariant!.merge.pullMinDist ?? 1;
          const strength = aVariant!.merge.pullStrength ?? 0;
          const effDist = Math.max(dist, minDist);
          const accel   = (strength * dt) / effDist;
          const invDist = 1 / dist;
          a.velocity.x += dx * invDist * accel;
          a.velocity.y += dy * invDist * accel;
        }
      }
    }
  }

  /**
   * Begin a graceful retire on a shard that's been merged out.
   * Replaces today's instant `b.active = false` so the smaller
   * party of a density-compaction merge dissolves over a short
   * window instead of popping.  PhysicsSystem ticks
   * `mergeFadeTimer` each substep; on reaching 0 the entity
   * goes inactive and the in-place compaction in
   * GameEngine.updatePhysics drops it from the master list.
   *
   * For nebula entities the same field covers impact-driven
   * fade (PhysicsSystem scales the duration by impact speed) and
   * non-impact retires (here).  Nebula uses a longer base
   * duration to read as "dissolving into the cloud"; non-nebula
   * shards use the crisper CLEANUP_CONSTANTS.MERGE_FADE_DURATION.
   */
  private startMergeFadeOut(entity: GameEntity): void {
    // Skip if entity is already fading out (avoid retriggering the
    // timer mid-fade, which would extend the dissolve).
    if (entity.mergeFadeTimer !== undefined && entity.mergeFadeTimer > 0) return;

    const variantId = shardVariantOf(entity);
    const duration = (variantId === 'nebula-shard' || variantId === 'nebula-tile')
      ? NEBULA_CONSTANTS.FADE_DURATION
      : CLEANUP_CONSTANTS.MERGE_FADE_DURATION;
    entity.mergeFadeTimer    = duration;
    entity.mergeFadeDuration = duration;
  }

  // ── Large-shard collapse ──────────────────────────────────────────
  // Shards whose diameter meets a variant's `density.largeShardCollapseSize`
  // contract inward in the next tick: replaced with a smaller, denser
  // version of themselves (single-input merge).  Reuses the same
  // shrink path as compose so the visual reads identical to a
  // multi-shard density merge — just with a single source.
  //
  // Per-frame budget (`CLEANUP_CONSTANTS.LARGE_COLLAPSE_BUDGET_PER_FRAME`)
  // caps the cascade so a giant freshly-spawned field doesn't all snap
  // to the dense baseline in one frame.  Offscreen candidates are
  // preferred — collapses never pop on the player's view.

  private runLargeShardCollapse(entities: GameEntity[]): void {
    let budget = CLEANUP_CONSTANTS.LARGE_COLLAPSE_BUDGET_PER_FRAME;
    if (budget <= 0) return;

    // Two-pass selection: prefer offscreen candidates first, then
    // onscreen if budget remains.  Both passes share the same
    // qualification check (variant has density, size >= threshold,
    // not at max tier, not already fading).  Avoid allocating a
    // candidate list — direct-walk the master entity array twice.
    for (let onscreen = 0; onscreen <= 1 && budget > 0; onscreen++) {
      for (let i = 0; i < entities.length && budget > 0; i++) {
        const e = entities[i];
        if (!e.active) continue;
        if (e.type !== EntityType.STRUCTURE || e.mass === Infinity) continue;
        if (e.mergeFadeTimer !== undefined) continue;
        if ((e.nebulaMergeCooldown ?? 0) > 0) continue;

        const variantId = shardVariantOf(e);
        if (variantId === null) continue;
        const variant = SHARD_VARIANTS[variantId];
        const density = variant.density;
        if (!density?.enabled) continue;

        // Threshold gate — diameter must be at/above the collapse
        // size, and below max tier.
        if (e.size.x < density.largeShardCollapseSize) continue;
        const tier = e.densityTier ?? 0;
        if (tier >= density.maxSteps) continue;

        // First pass picks only offscreen entities; second pass
        // picks anything still qualifying.  When the EntityIndex is
        // unwired (no viewport rect) `isOffscreen` returns false for
        // every entity, so the first pass is empty and the second
        // pass picks normally — keeps unit-test paths working.
        const off = this.entityIndex?.isOffscreen(e) ?? false;
        if (onscreen === 0 && !off) continue;
        if (onscreen === 1 && off) continue; // already handled

        this.collapseLargeShard(e, density, variantId);
        budget--;
      }
    }
  }

  /**
   * Single-input density step.  Replaces the entity in place with a
   * smaller, denser version of itself: tier += 1, size *= shrink,
   * mass preserved (already sums when shards merge; for single-input
   * the mass stays put — the entity just compresses geometrically).
   * Polygon regenerated at the new radius so SAT collisions track
   * the new bounds.  Density tint cache invalidated so the renderer
   * picks up the darker hue on next draw.
   */
  private collapseLargeShard(
    entity: GameEntity,
    density: NonNullable<typeof SHARD_VARIANTS[ShardVariantId]['density']>,
    variantId: ShardVariantId,
  ): void {
    const newTier = (entity.densityTier ?? 0) + 1;
    const newDiam = entity.size.x * density.shrinkFactor;

    // Polygon regen — match the variant's spawn shape so the
    // collapsed shard reads as the same kind of debris.
    const variant = SHARD_VARIANTS[variantId];
    const baseR = (newDiam / 2) * 0.82;
    entity.polygonPoints = this.generateShardPolygon(
      baseR,
      variant.spawn.polyVerticesMin,
      variant.spawn.polyVerticesMax,
      variant.spawn.angleJitter,
      variant.spawn.radiusMin,
      variant.spawn.radiusRange,
      variant.spawn.polyVerticesOptions,
    );

    entity.size.x = newDiam;
    entity.size.y = newDiam;
    entity.densityTier = newTier;
    entity.densityCachedTint = undefined;
    // Nebula fast-path cache lives on tiles (not shards), but the
    // shard's tinted-key cache also encodes the resolved colour.
    // Drop both so the next render reflects the darker tier.
    if (variantId === 'nebula-shard') {
      entity.nebulaTintedKey = undefined;
      entity.nebulaCachedTinted = undefined;
    }
  }

  /**
   * Apply the resolved merge outcome between two stick-bonded
   * entities.  Today's three flavours preserved verbatim:
   *
   *   nebula-shard + nebula-shard → area accumulation, composition
   *                                 blend, glimmer burst, smaller
   *                                 fades.  Adapter then attempts
   *                                 transmutation (host area ≥ HEX_AREA
   *                                 → new tile, host dissolves).
   *   asteroid + asteroid         → area-conserving accretion; larger
   *                                 dominates shardVariant / glow / hp.
   *   drop + drop                 → same-type grows; cross-type
   *                                 collapses into a composite asteroid.
   *   asteroid + drop             → asteroid absorbs drop's payload.
   *
   *  Invokes a soft sparkle at the merge point for asteroid / drop
   *  merges (today's behaviour).  Nebula-shard merges use the
   *  existing glimmer burst inside composeNebulaShards.
   */

  /**
   * Tier-transition router for a glass-shard that has grown to
   * tile-equivalent diameter via the merge pipeline.  Rolls 50/50
   * between:
   *   - glass-tile:  condense at the nearest free hex cell.
   *   - rock-shard:  downgrade in-place to a smaller, denser rock-
   *                  shard (first leg of the planned material tier
   *                  chain: nebula → glass → rock → metal → plastic).
   *
   * Glass-tile path can still fail if every candidate hex is
   * occupied — in that case the shard stays a glass-shard and a
   * later merge will retry.
   */
  private tryConvertOversizedGlassShard(
    shard: GameEntity,
    entities: GameEntity[],
    physics: PhysicsSystem,
  ): void {
    if (shard.shardVariant !== 'glass-shard') return;
    if (shard.size.x < GLASS_TIER_DIAMETER) return;
    if (Math.random() < 0.5) {
      this.tryTransmuteGlassShardToTile(shard, entities, physics);
    } else {
      this.convertGlassShardToRockShard(shard);
    }
  }

  /**
   * In-place transition from glass-shard to a smaller rock-shard.
   * Size shrinks by the rock-shard density shrinkFactor (≈0.88)
   * applied to GLASS_TIER_DIAMETER, polygon is regenerated with
   * rock-shard's irregular spawn config, mass is recomputed via
   * the rock variant's sizeToMass.  No new entity allocated —
   * mutates the host in place so the entity-id pipeline / spatial
   * grids stay stable across the swap.
   */
  private convertGlassShardToRockShard(shard: GameEntity): void {
    const rockVariant = SHARD_VARIANTS['rock-shard'];
    const rockSpawn = rockVariant.spawn;
    const newSize = GLASS_TIER_DIAMETER * (rockVariant.density?.shrinkFactor ?? 0.88);

    shard.shardVariant = 'rock-shard';
    shard.size.x = newSize;
    shard.size.y = newSize;
    shard.mass = rockSpawn.sizeToMass(newSize);
    shard.color = COLORS.ASTEROID;
    shard.sprite = undefined;
    // Density tier reset — the new rock-shard starts at base tier;
    // its own future merges will compact normally.
    shard.densityTier = undefined;
    shard.densityCachedTint = undefined;

    const baseR = (newSize / 2) * 0.82;
    shard.polygonPoints = this.generateShardPolygon(
      baseR,
      rockSpawn.polyVerticesMin,
      rockSpawn.polyVerticesMax,
      rockSpawn.angleJitter,
      rockSpawn.radiusMin,
      rockSpawn.radiusRange,
      rockSpawn.polyVerticesOptions,
    );
  }

  /**
   * Glass-shard counterpart of the nebula shard→tile transmute.
   * Snap the shard to the nearest free hex cell and replace it with
   * a fresh glass-tile.  Candidate cells are the shard's current
   * hex + 6 neighbours, sorted by distance.  If every candidate is
   * occupied (by another tile or static collision geometry), the
   * shard stays a shard and the caller can retry next merge.
   *
   * Unlike the nebula path, no system-level bookkeeping needs
   * dirtying (neighbour-counts, transmutation hooks) — glass tiles
   * don't drive a regeneration heuristic.  Just push the tile,
   * register it with PhysicsSystem's static grid, and fade out the
   * source shard.
   */
  private tryTransmuteGlassShardToTile(
    shard: GameEntity,
    entities: GameEntity[],
    physics: PhysicsSystem,
  ): boolean {
    if (shard.shardVariant !== 'glass-shard') return false;

    const origin = pixelToHexCoord(shard.position.x, shard.position.y);
    const candidates: { c: number; r: number; distSq: number }[] = [];
    const pushCandidate = (c: number, r: number) => {
      const p = hexCoordToPixel(c, r);
      const dx = wrapDeltaX(shard.position.x, p.x);
      const dy = wrapDeltaY(shard.position.y, p.y);
      candidates.push({ c, r, distSq: dx * dx + dy * dy });
    };
    pushCandidate(origin.c, origin.r);
    for (const n of TileGenerator.getHexNeighbors(origin.c, origin.r)) {
      pushCandidate(n.c, n.r);
    }
    candidates.sort((a, b) => a.distSq - b.distSq);

    let chosen: { c: number; r: number } | null = null;
    for (const cand of candidates) {
      const p = hexCoordToPixel(cand.c, cand.r);
      // Block on any nearby static geometry (existing tiles incl.
      // nebula-tiles in the same cell, glass tiles, etc.).  Radius
      // slightly under HEX_SIZE so touching neighbours don't
      // register as overlap.
      if (!physics.isPositionClear(p.x, p.y, HEX_SIZE * 0.5)) continue;
      chosen = cand;
      break;
    }
    if (!chosen) return false;

    const p = hexCoordToPixel(chosen.c, chosen.r);
    // Hex dimensions match TileGenerator's tile build.  Width is
    // sqrt(3)*HEX_SIZE; height is 2*HEX_SIZE.
    const w = Math.sqrt(3) * HEX_SIZE;
    const h = 2 * HEX_SIZE;
    const pts: Vector2[] = [
      { x:  0,    y: -h / 2 },
      { x:  w / 2, y: -h / 4 },
      { x:  w / 2, y:  h / 4 },
      { x:  0,    y:  h / 2 },
      { x: -w / 2, y:  h / 4 },
      { x: -w / 2, y: -h / 4 },
    ];
    const tile = TileGenerator.buildStructureTile(chosen.c, chosen.r, p.x, p.y, w, h, pts, 'glass');
    entities.push(tile);
    physics.addStaticEntity(tile);

    // Source shard fades out the same way as nebula transmute — the
    // tile materialises while the shard dissolves on top of it.
    this.startMergeFadeOut(shard);
    return true;
  }

  private composeEntities(
    a: GameEntity,
    b: GameEntity,
    entities: GameEntity[],
    physics: PhysicsSystem,
    outcome: MergeOutcome = 'compose',
  ): void {
    if (!a.active || !b.active) return;

    // Stage 5b: 'absorb' — smaller fades, larger gains a glow tint
    // mapped to the closest weapon-palette colour.  Used by nebula-
    // shard absorbed into a max-size glass-shard.
    if (outcome === 'absorb') {
      this.applyAbsorb(a, b, entities);
      return;
    }

    // Stage 5: shard-family entities are now all EntityType.STRUCTURE.
    // Distinguish by variant id rather than the legacy EntityTypes.
    const aVariant = shardVariantOf(a);
    const bVariant = shardVariantOf(b);
    const aIsNebShard = aVariant === 'nebula-shard';
    const bIsNebShard = bVariant === 'nebula-shard';
    // Mobile-shard family: rock-shard or glass-shard ride the asteroid
    // accretion path.  Tile variants have shatter.kind=none here so
    // they don't compose (only mobile shards merge).
    const aIsAst = aVariant === 'rock-shard' || aVariant === 'glass-shard';
    const bIsAst = bVariant === 'rock-shard' || bVariant === 'glass-shard';

    // Nebula-shard self-merge — own code path with composition blend +
    // transmutation hook.
    if (aIsNebShard && bIsNebShard) {
      const aR = Math.max(a.size.x, a.size.y);
      const bR = Math.max(b.size.x, b.size.y);
      const larger = aR >= bR ? a : b;
      const smaller = larger === a ? b : a;
      this.composeNebulaShards(larger, smaller, entities, physics);
      return;
    }

    // Mass-weighted velocity + centroid for the merged entity.
    // Centroid handling shifts b into a's frame so a wrap-crossing
    // pair doesn't merge into a point on the opposite side of the
    // map; the result is then re-wrapped to canonical coords.
    const totalMass = a.mass + b.mass;
    const nvx = (a.velocity.x * a.mass + b.velocity.x * b.mass) / totalMass;
    const nvy = (a.velocity.y * a.mass + b.velocity.y * b.mass) / totalMass;
    const bShiftX = a.position.x + wrapDeltaX(a.position.x, b.position.x);
    const bShiftY = a.position.y + wrapDeltaY(a.position.y, b.position.y);
    let nmx = (a.position.x * a.mass + bShiftX * b.mass) / totalMass;
    let nmy = (a.position.y * a.mass + bShiftY * b.mass) / totalMass;
    { const p = { x: nmx, y: nmy }; wrapPosition(p); nmx = p.x; nmy = p.y; }

    if (aIsAst && bIsAst) {
      // Asteroid + Asteroid — density compaction (smaller-but-denser).
      // When the dominant variant has `density.enabled`, the surviving
      // shard takes:
      //   mass     = a.mass + b.mass        (sum, per task brief)
      //   tier     = max(tiers) + 1, capped (per task brief)
      //   diameter = max(inputs) × shrink   (per task brief)
      // For variants without density (none today, kept defensive),
      // the legacy area-conserving accretion remains.
      const MAX_HP = 6;
      const rA = a.size.x / 2;
      const rB = b.size.x / 2;
      const aDia = a.size.x;
      const bDia = b.size.x;

      // Larger entity by diameter dominates surviving variant id +
      // glow blend.  Today the only mobile variants that bond are
      // rock-shard and glass-shard.
      const aIsLarger = aDia >= bDia;
      const dominantVariant = (aIsLarger ? a.shardVariant : b.shardVariant) ?? 'rock-shard';
      const dominantDef = SHARD_VARIANTS[dominantVariant];
      const density = dominantDef.density;

      // Density gate: refuse the merge if the dominant variant has
      // hit max tier OR the combined area is below the variant's
      // areaThreshold (skip trivial micro-shard merges).  Without
      // density (or disabled), fall through to legacy accretion.
      let newDiam: number;
      let newMass: number;
      let newTier: number | undefined = undefined;
      // Glass-shard self-merges bypass density compaction — the
      // tier-transition mechanic (glass→tile / smaller rock-shard)
      // wants the shards to *grow* visibly until they hit
      // GLASS_TIER_DIAMETER.  Density's shrinkFactor would have
      // them shrinking instead.  Other pairs (rock-self, cross-
      // variant) keep the density path.
      const isGlassSelfMerge = a.shardVariant === 'glass-shard' && b.shardVariant === 'glass-shard';
      if (density?.enabled && !isGlassSelfMerge) {
        const tierA = a.densityTier ?? 0;
        const tierB = b.densityTier ?? 0;
        const proposedTier = Math.max(tierA, tierB) + 1;
        if (proposedTier > density.maxSteps) return; // capped — leave pair separate
        const combinedArea = aDia * aDia + bDia * bDia;
        if (combinedArea < density.areaThreshold) return; // micro-shards stay separate
        newTier = proposedTier;
        const largerDia = aIsLarger ? aDia : bDia;
        newDiam = largerDia * density.shrinkFactor;
        newMass = a.mass + b.mass;
      } else {
        newDiam = Math.sqrt(rA * rA + rB * rB) * 2;
        const sizeCap = getRockShardFreeSpawn(this.currentMapType).maxSize;
        if (newDiam > sizeCap) return;
        newMass = newDiam;
      }

      const glowA = a.powerupGlowColor;
      const glowB = b.powerupGlowColor;
      const newGlow = glowA && glowB ? blendHex(glowA, glowB) : (glowA ?? glowB);

      const composition: DropCompositionEntry[] = [
        ...(a.dropComposition ?? []),
        ...(b.dropComposition ?? []),
      ];

      // Regenerate polygon at new size; blocky for tile-derived
      // glass-shard, jagged for rock-shard.
      const isTile  = dominantVariant === 'glass-shard';
      const numPts  = isTile ? (4 + Math.floor(Math.random() * 3)) : (7 + Math.floor(Math.random() * 4));
      const jitterK = isTile ? 0.25 : 0.7;
      const rMin    = isTile ? 0.60 : 0.60;
      const rRange  = isTile ? 0.55 : 0.65;
      const baseR   = (newDiam / 2) * 0.82;
      a.polygonPoints = this.generateShardPolygon(baseR, numPts, numPts, jitterK, rMin, rRange);

      a.shardVariant     = dominantVariant;
      a.powerupGlowColor = newGlow;
      if (a.shardVariant !== b.shardVariant) a.color = blendHex(a.color, b.color);
      a.size.x = newDiam; a.size.y = newDiam;
      a.mass   = newMass;
      a.position.x = nmx; a.position.y = nmy;
      a.velocity.x = nvx; a.velocity.y = nvy;
      a.health     = Math.min(MAX_HP, a.health + b.health);
      a.maxHealth  = Math.min(MAX_HP, a.maxHealth + b.maxHealth);
      a.dropComposition = composition.length > 0 ? composition : undefined;
      // Density bookkeeping — invalidate the per-entity tint cache so
      // the renderer picks up the darker tier on its next draw, then
      // commit the new tier.  Without the cache invalidation a freshly-
      // merged shard would render at the previous tier's tint until
      // some other path happened to clear the cache.
      if (density?.enabled && newTier !== undefined) {
        a.densityTier = newTier;
        a.densityCachedTint = undefined;
      }
      // Graceful retire — fade the smaller party out instead of
      // snapping to inactive.  PhysicsSystem ticks `mergeFadeTimer`
      // each substep and flips active=false on completion;
      // RenderSystem multiplies alpha by the fraction remaining so
      // the dissolve reads visibly across the field.
      this.startMergeFadeOut(b);

      // Glass-shard tier transition.  When the survivor is a glass-
      // shard that has grown to tile-equivalent diameter
      // (sqrt(HEX_AREA)), roll 50/50: condense into a glass-tile at
      // the nearest free hex, or downgrade to a smaller (denser)
      // rock-shard — the first leg of the planned material tier
      // chain (nebula→glass→rock→metal→plastic).
      if (a.shardVariant === 'glass-shard' && a.size.x >= GLASS_TIER_DIAMETER) {
        this.tryConvertOversizedGlassShard(a, entities, physics);
      }
    } else if (!aIsAst && !bIsAst) {
      // Drop + Drop.
      if (a.dropType === b.dropType) {
        // Same type — grow (area-conserving).
        a.dropValue  = (a.dropValue ?? 0) + (b.dropValue ?? 0);
        const rda    = a.size.x / 2;
        const rdb    = b.size.x / 2;
        const newR   = Math.sqrt(rda * rda + rdb * rdb) * 2;
        a.size.x     = newR; a.size.y = newR;
        a.position.x = nmx;  a.position.y = nmy;
        a.velocity.x = nvx;  a.velocity.y = nvy;
        b.active = false;
      } else {
        // Different types — collapse into a composite asteroid.
        this.spawnCompositeAsteroid(a, b, nmx, nmy, nvx, nvy, entities);
        a.active = false;
        b.active = false;
      }
    } else {
      // Asteroid + Drop — asteroid absorbs drop payload + glow.
      const ast  = aIsAst ? a : b;
      const drop = aIsAst ? b : a;
      const comp: DropCompositionEntry[] = [...(ast.dropComposition ?? [])];

      if (drop.dropType === 'ammo') {
        comp.push({ type: 'ammo', value: drop.dropValue ?? 1 });
        const wColor = drop.color || '#ffffff';
        ast.powerupGlowColor = ast.powerupGlowColor
          ? blendHex(ast.powerupGlowColor, wColor)
          : wColor;
      } else if (drop.dropType === 'health') {
        comp.push({ type: 'health', value: drop.dropValue ?? 1 });
        const dColor = '#4ade80';
        ast.powerupGlowColor = ast.powerupGlowColor
          ? blendHex(ast.powerupGlowColor, dColor)
          : dColor;
      }

      ast.dropComposition = comp.length > 0 ? comp : undefined;
      ast.velocity.x = nvx; ast.velocity.y = nvy;
      drop.active = false;
    }

    // Soft sparkle at the merge point for asteroid / drop merges.
    this.particles.spawn(entities, { x: nmx, y: nmy }, 5, '#fbbf24', {
      speedMin: 1, speedMax: 4, sizeMin: 1, sizeMax: 2.5,
      lifetimeMin: 0.2, lifetimeMax: 0.4,
    });
    this.particles.spawn(entities, { x: nmx, y: nmy }, 3, '#ffffff', {
      speedMin: 2, speedMax: 6, sizeMin: 0.5, sizeMax: 1.5,
      lifetimeMin: 0.1, lifetimeMax: 0.25,
    });
  }

  /**
   * Nebula-shard self-merge — port of NebulaSystem.mergeNebulas.
   * Larger shard grows by the smaller's disc area, accumulates
   * effective area for transmutation, blends compositions, drops
   * render fast-path caches, and emits a glimmer burst.  Smaller
   * shard fades out (compaction removes it).  Adapter is then
   * invoked for transmutation: if the host's accumulated
   * `nebulaTileArea` has crossed HEX_AREA, NebulaSystem spawns a
   * brand-new tile at the nearest free hex cell and the host
   * dissolves.
   */
  /**
   * Apply the 'absorb' merge outcome.  Smaller entity goes inactive
   * (no shatter, no drop, no fade); larger entity's
   * `powerupGlowColor` is set to the nearest weapon-palette colour
   * to the absorbed entity's blended hex.  If a glow is already
   * present, the two are blended via the existing blendHex.  A
   * small glimmer particle burst plays at the absorption point.
   *
   * Used today by nebula-shard absorbed into a max-size glass-shard
   * (the only absorb rule).  Future variants opt in by adding an
   * absorb rule to their merge.rules.
   */
  private applyAbsorb(a: GameEntity, b: GameEntity, entities: GameEntity[]): void {
    // Larger entity is the host; smaller is consumed.
    const aR = Math.max(a.size.x, a.size.y);
    const bR = Math.max(b.size.x, b.size.y);
    const host = aR >= bR ? a : b;
    const consumed = host === a ? b : a;

    // Map the consumed entity's colour (or composition blend) to the
    // closest weapon-palette colour, then blend onto the host's glow.
    const consumedHex = consumed.nebulaColorComposition
      ? blendCompositionToHex(consumed.nebulaColorComposition)
      : (consumed.color || '#ffffff');
    const tint = closestPowerupHex(consumedHex);
    host.powerupGlowColor = host.powerupGlowColor
      ? blendHex(host.powerupGlowColor, tint)
      : tint;

    // Glimmer at the absorption point — softer than the merge
    // sparkle so a "rare" absorb event still reads as distinct.
    this.particles.spawn(entities, consumed.position, 4, '#ffffff', {
      speedMin: 0.1, speedMax: 0.5,
      sizeMin: 0.3, sizeMax: 0.9,
      lifetimeMin: 0.4, lifetimeMax: 0.8,
      positionJitter: Math.max(consumed.size.x, consumed.size.y) * 0.4,
    });
    this.particles.spawn(entities, consumed.position, 5, tint, {
      speedMin: 0.1, speedMax: 0.4,
      sizeMin: 0.4, sizeMax: 1.1,
      lifetimeMin: 0.5, lifetimeMax: 1.0,
      positionJitter: Math.max(consumed.size.x, consumed.size.y) * 0.5,
    });

    consumed.active = false;
  }

  private composeNebulaShards(
    a: GameEntity,
    b: GameEntity,
    entities: GameEntity[],
    physics: PhysicsSystem,
  ): void {
    // Pair-consuming transmute — both source shards retire and a
    // single tile-equivalent output materialises (50/50 nebula-tile
    // vs glass-shard, routed inside the adapter).  No area-
    // accumulator any more: every successful nebula self-bond
    // triggers a transmute attempt.
    const aR = Math.max(a.size.x, a.size.y) / 2;
    const bR = Math.max(b.size.x, b.size.y) / 2;
    const aArea = Math.PI * aR * aR;
    const bArea = Math.PI * bR * bR;

    // Area-weighted color blend so the output inherits the pair's
    // combined palette rather than picking one side arbitrarily.
    const composition = blendCompositions(
      a.nebulaColorComposition, aArea,
      b.nebulaColorComposition, bArea,
    );

    // Mass-weighted midpoint position — wrap-aware so a torus-
    // crossing pair doesn't transmute on the wrong side of the
    // seam.  Nebula shards share the same low mass; this is
    // effectively the geometric midpoint.
    const totalMass = a.mass + b.mass;
    const bShiftX = a.position.x + wrapDeltaX(a.position.x, b.position.x);
    const bShiftY = a.position.y + wrapDeltaY(a.position.y, b.position.y);
    let mx = (a.position.x * a.mass + bShiftX * b.mass) / totalMass;
    let my = (a.position.y * a.mass + bShiftY * b.mass) / totalMass;
    { const p = { x: mx, y: my }; wrapPosition(p); mx = p.x; my = p.y; }

    const nvx = (a.velocity.x * a.mass + b.velocity.x * b.mass) / totalMass;
    const nvy = (a.velocity.y * a.mass + b.velocity.y * b.mass) / totalMass;

    // Glittery glimmer burst at the merge point — same visual
    // feedback the old grow-larger path had.
    const tint = blendCompositionToHex(composition);
    const glimmerR = Math.max(a.size.x, b.size.x) * 0.6;
    const midpoint: Vector2 = { x: mx, y: my };
    this.particles.spawn(entities, midpoint, 3, '#ffffff', {
      speedMin: 0.1, speedMax: 0.5,
      sizeMin: 0.3, sizeMax: 0.9,
      lifetimeMin: 0.4, lifetimeMax: 0.8,
      positionJitter: glimmerR,
    });
    this.particles.spawn(entities, midpoint, 4, tint, {
      speedMin: 0.1, speedMax: 0.4,
      sizeMin: 0.4, sizeMax: 1.1,
      lifetimeMin: 0.5, lifetimeMax: 1.0,
      positionJitter: glimmerR * 1.2,
    });

    // Both source shards retire — the adapter spawns the output
    // (tile or glass-shard) as a brand-new entity.
    this.startMergeFadeOut(a);
    this.startMergeFadeOut(b);

    // Adapter hook routes the 50/50 outcome.  Position is the
    // pair's midpoint; velocity is the mass-weighted average so a
    // resulting glass-shard inherits the cloud's drift.
    this.adapter?.onComposeNebulaShardPair(composition, midpoint, { x: nvx, y: nvy }, entities, physics);
  }

  /**
   * Composite-asteroid spawn — port of GameEngine.spawnCompositeAsteroid.
   * Fires only on cross-type drop+drop merges (e.g. ammo + health).
   * Result is a rock-shard with a packed dropComposition
   * carrying both drops' payloads.
   */
  private spawnCompositeAsteroid(
    dropA: GameEntity, dropB: GameEntity,
    mx: number, my: number, mvx: number, mvy: number,
    entities: GameEntity[],
  ): void {
    const ra      = dropA.size.x / 2;
    const rb      = dropB.size.x / 2;
    // Area-conserving: new area = area_A + area_B → new_radius = sqrt(ra² + rb²)
    const newSize = Math.sqrt(ra * ra + rb * rb) * 2;
    const hp      = Math.max(1, Math.round(newSize / 20));

    // Irregular polygon (same approach as normal asteroids).
    const baseR   = (newSize / 2) * 0.82;
    const points  = this.generateShardPolygon(baseR, 9, 12, 0.65, 0.75, 0.5);

    entities.push({
      id:            nextId('composite'),
      type:          EntityType.STRUCTURE,
      shardVariant:  'rock-shard',
      position:      { x: mx, y: my },
      velocity:      { x: mvx, y: mvy },
      size:          { x: newSize, y: newSize },
      rotation:      Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * (1.5 / (newSize / 20)),
      color:         blendHex(dropA.color, dropB.color),
      active:        true,
      health:        hp,
      maxHealth:     hp,
      mass:          newSize,
      polygonPoints: points,
      dropComposition: [
        ...(dropA.dropType === 'ammo'
          ? [{ type: 'ammo' as const, value: dropA.dropValue ?? 1 }]
          : dropA.dropType === 'health'
          ? [{ type: 'health' as const, value: dropA.dropValue ?? 1 }]
          : []),
        ...(dropB.dropType === 'ammo'
          ? [{ type: 'ammo' as const, value: dropB.dropValue ?? 1 }]
          : dropB.dropType === 'health'
          ? [{ type: 'health' as const, value: dropB.dropValue ?? 1 }]
          : []),
      ],
    });
  }
}

/**
 * Hex-color average — RGB midpoint blend.  Local to ShardSystem;
 * the same helper is duplicated in GameEngine.ts (private function)
 * and will be unified in Stage 6's dead-code sweep.
 */
function blendHex(hexA: string, hexB: string): string {
  const rA = parseInt(hexA.slice(1, 3), 16), gA = parseInt(hexA.slice(3, 5), 16), bA = parseInt(hexA.slice(5, 7), 16);
  const rB = parseInt(hexB.slice(1, 3), 16), gB = parseInt(hexB.slice(3, 5), 16), bB = parseInt(hexB.slice(5, 7), 16);
  return `#${Math.round((rA + rB) / 2).toString(16).padStart(2, '0')}${Math.round((gA + gB) / 2).toString(16).padStart(2, '0')}${Math.round((bA + bB) / 2).toString(16).padStart(2, '0')}`;
}

/**
 * Pre-tabulated weapon palette for the absorb side-effect.  Computed
 * once at module init from WEAPON_LIST + WEAPONS — zero per-call
 * allocation.  closestPowerupHex picks the nearest entry by squared-
 * Euclidean RGB distance.
 */
const POWERUP_PALETTE: Array<{ r: number; g: number; b: number; hex: string }> = (() => {
  const out: Array<{ r: number; g: number; b: number; hex: string }> = [];
  for (let i = 0; i < WEAPON_LIST.length; i++) {
    const hex = WEAPONS[WEAPON_LIST[i]].color;
    if (!hex || !hex.startsWith('#') || hex.length < 7) continue;
    out.push({
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
      hex,
    });
  }
  return out;
})();

/**
 * Map an arbitrary hex colour to the nearest weapon-palette colour.
 * Used by the 'absorb' merge outcome (today: nebula-shard absorbed
 * into a glass-shard).  Plain Euclidean distance in RGB space — no
 * perceptual weighting; the user signed off on "keep the math
 * simple".
 */
function closestPowerupHex(targetHex: string): string {
  if (!targetHex || !targetHex.startsWith('#') || targetHex.length < 7) {
    return POWERUP_PALETTE[0]?.hex ?? '#ffffff';
  }
  const tr = parseInt(targetHex.slice(1, 3), 16);
  const tg = parseInt(targetHex.slice(3, 5), 16);
  const tb = parseInt(targetHex.slice(5, 7), 16);
  let bestHex = POWERUP_PALETTE[0]?.hex ?? '#ffffff';
  let bestDist = Infinity;
  for (let i = 0; i < POWERUP_PALETTE.length; i++) {
    const e = POWERUP_PALETTE[i];
    const dr = e.r - tr;
    const dg = e.g - tg;
    const db = e.b - tb;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) { bestDist = d; bestHex = e.hex; }
  }
  return bestHex;
}
