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

import { GameEntity, EntityType, Vector2 } from '../../types';
import {
  SHARD_VARIANTS,
  REGEN_POP_CONSTANTS,
  COLORS,
  NEBULA_CONSTANTS,
  nebulaFadeRateScale,
} from '../../constants';
import { HEX_AREA } from '../maps/TileGenerator';
import { wrapPosition } from '../toroidal';
import { blendCompositionToHex, cloneComposition } from '../NebulaColor';
import { ParticleSystem } from './ParticleSystem';
import { PhysicsSystem } from './PhysicsSystem';
import { nextId } from './IdAllocator';
import {
  ShardVariantId,
  ShardVariantDef,
  ShardRegenAdapter,
} from './ShardSystem.types';

/**
 * Resolve an entity's variant id.  Reads the legacy `shardType` /
 * `structureVariant` fields when `shardVariant` is unset (stage 5+
 * stamps the field directly on every spawn site).
 *
 * Returns `null` for non-shard-family entities (PLAYER, ENEMY,
 * PROJECTILE, INTERACTABLE, PARTICLE).  Callers who only need the
 * variant of known shard-family entities can assert non-null.
 */
export function shardVariantOf(entity: GameEntity): ShardVariantId | null {
  if (entity.shardVariant !== undefined) return entity.shardVariant;

  switch (entity.type) {
    case EntityType.STRUCTURE: {
      const v = entity.structureVariant;
      if (v === 'reinforced')     return 'reinforced-tile';
      if (v === 'heavy')          return 'heavy-tile';
      if (v === 'indestructible') return 'indestructible-tile';
      // Default (unset or 'glass') — today's STRUCTURE-default = glass.
      return 'glass-tile';
    }
    case EntityType.ASTEROID: {
      const s = entity.shardType;
      if (s === 'tile')   return 'glass-shard';
      if (s === 'nebula') return 'nebula-shard';
      // Default (unset or 'asteroid') — today's free-floating asteroids.
      return 'rock-shard';
    }
    case EntityType.NEBULA:
      return 'nebula-tile';
    case EntityType.NEBULA_SHARD:
      return 'nebula-shard';
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

export class ShardSystem {
  /**
   * Regen queue — replaces the two separate queues that lived on
   * GameEngine (STRUCTURE tiles) and NebulaSystem (NEBULA tiles).
   * Driven by `SHARD_VARIANTS[variantId].regen` at completion time.
   */
  private pending: RegenEntry[] = [];

  /**
   * Optional adapter providing variant-specific completion hooks.
   * Today only the nebula-tile path uses it (composition rewrite +
   * cache invalidation + neighbour-counts dirty).  Non-nebula
   * regens never call into the adapter, so STRUCTURE-tile regen
   * works regardless of whether one is wired.
   */
  private regenAdapter: ShardRegenAdapter | null = null;

  constructor(private particles: ParticleSystem) {}

  /** Wire a variant-specific completion adapter.  Called once at
   *  GameEngine construction after NebulaSystem is built. */
  public setRegenAdapter(adapter: ShardRegenAdapter): void {
    this.regenAdapter = adapter;
  }

  /**
   * Per-frame tick.  Called from GameEngine.updateGameLogic at the
   * fixed-step dt.  Stage 2: ticks the unified regen queue.  Future
   * stages add the shatter / merge passes.
   */
  public update(entities: GameEntity[], dt: number, physics: PhysicsSystem): void {
    this.tickRegens(entities, dt, physics);
  }

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
  ): Vector2[] {
    const verticesRange = polyVerticesMax - polyVerticesMin + 1;
    const numPoints = polyVerticesMin + Math.floor(Math.random() * verticesRange);
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
      );

      const offsetX = Math.cos(scatterAngle) * parentRadius * 0.25;
      const offsetY = Math.sin(scatterAngle) * parentRadius * 0.25;
      const maxSpin = 2.0 / (newSize / 20);

      // Map child variant id back to today's EntityType / shardType
      // pair so existing physics + render code paths continue to work
      // before Stage 5's full EntityType collapse.
      entities.push({
        id:           nextId('shard'),
        type:          EntityType.ASTEROID,
        shardType:     isTile ? 'tile' : 'asteroid',
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

      const effectiveAreaPerShard = HEX_AREA / shardCount;

      entities.push({
        id:              nextId('nebula_shard'),
        type:            EntityType.NEBULA_SHARD,
        shardType:      'nebula',
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
        nebulaTileArea:  effectiveAreaPerShard,
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
}
