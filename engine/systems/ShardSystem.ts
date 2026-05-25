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
  LOCAL_MERGE_CONSTANTS,
  ROCK_CONDENSE,
  StructureVariant,
  getRockShardFreeSpawn,
  nebulaFadeRateScale,
  randomPlasticShardShade,
  colorToWigglePhase,
  PLASTIC_DEFORM_CONSTANTS,
  PLASTIC_SHARD_AUTOMATA,
  PLASTIC_EAT,
  getActivePlasticEatAttract,
  PLASTIC_REACH,
  getActivePlasticYield,
  HOTSPOT_COLLAPSE,
  METAL_ASSEMBLY,
  getActiveShatterGraceDelay,
} from '../../constants';
import { EntityIndex } from './EntityIndex';
import type { PerfController } from './PerfController';
import { HEX_AREA, HEX_SIZE, TileGenerator, hexCoordToPixel, pixelToHexCoord } from '../maps/TileGenerator';
import {
  wrapDeltaX, wrapDeltaY, wrapPosition, wrapX, wrapY,
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
// Same threshold for plastic — merged plastic-shard at or above
// this diameter transmutes back into a plastic-tile via
// tryTransmuteShardToTile.  HEX_AREA is the regular-hex
// area at HEX_SIZE = 22, so the diameter ≈ 35 — well above the
// 17-24 sizes that plastic-shards spawn at from a tile burst,
// so a typical merge of 2-3 shards reaches the threshold.
const PLASTIC_TIER_DIAMETER = Math.sqrt(HEX_AREA);
// Rock-shard "grow into a tile" threshold.  Unlike glass (which condenses
// at exactly hex-area), rocks are allowed to grow LARGER before they
// transmute, so a dense cluster forms a visible big rock that keeps
// absorbing chips before snapping to a static rock-tile.  Set as a
// multiple of the hex-area diameter; raise/lower to tune how big rocks
// get before they tile.  At ×1.8 the rock reaches ≈ 3.2× hex area (many
// absorbed chips) before transmuting.
// ── Rock condensation grid helpers (see ROCK_CONDENSE in constants) ──
const ROCK_MAX_DIAMETER  = ROCK_CONDENSE.DIAMETERS[ROCK_CONDENSE.DIAMETERS.length - 1];
/** Nominal mass of grid cell (sizeTier, densityTier), tiers 1-indexed. */
function rockCellMass(s: number, d: number): number {
  return ROCK_CONDENSE.MASS_COEFF
    * ROCK_CONDENSE.DIAMETERS[s - 1] * ROCK_CONDENSE.DIAMETERS[s - 1]
    * ROCK_CONDENSE.DENSITY_MULT[d - 1];
}
const ROCK_MAX_CELL_MASS = rockCellMass(ROCK_CONDENSE.DIAMETERS.length, ROCK_CONDENSE.DENSITY_MULT.length);
/** Nearest size tier (1..5) for an arbitrary diameter (snaps spawned /
 *  legacy rocks onto the grid). */
function nearestRockSizeTier(diam: number): number {
  const D = ROCK_CONDENSE.DIAMETERS;
  let best = 1, bestErr = Infinity;
  for (let i = 0; i < D.length; i++) {
    const e = Math.abs(diam - D[i]);
    if (e < bestErr) { bestErr = e; best = i + 1; }
  }
  return best;
}
/** Denser-first placement of mass M onto the grid, starting at size tier
 *  s0 (the larger input's size — never shrink below it): pick the
 *  smallest density tier that holds M at the current size, growing size
 *  only when density caps.  Returns null when M exceeds the top cell
 *  (→ condense into a static rock-tile). */
function deriveRockCell(s0: number, M: number): { s: number; d: number } | null {
  const nS = ROCK_CONDENSE.DIAMETERS.length;
  const nD = ROCK_CONDENSE.DENSITY_MULT.length;
  let s = Math.max(1, Math.min(nS, s0));
  while (s <= nS) {
    for (let d = 1; d <= nD; d++) {
      if (rockCellMass(s, d) >= M - 1e-6) return { s, d };
    }
    s++; // density maxed at this size — grow size
  }
  return null; // overflow → tile
}

/** Local-density boost for the merge/absorption rate: 1.0× in sparse
 *  areas, ramping to MAX_BOOST in dense pockets (a shard's merge-grid
 *  cell occupancy).  Focuses the acceleration on the hotspots that
 *  actually drive collision cost. */
function localDensityBoost(cellCount: number): number {
  const { DENSITY_LO, DENSITY_HI, MAX_BOOST } = LOCAL_MERGE_CONSTANTS;
  if (cellCount <= DENSITY_LO) return 1;
  if (cellCount >= DENSITY_HI) return MAX_BOOST;
  return 1 + (MAX_BOOST - 1) * (cellCount - DENSITY_LO) / (DENSITY_HI - DENSITY_LO);
}

/**
 * Stick-bond between two entities — replaces GameEngine.stickBonds.
 * `timer` accumulates contact dt; when it reaches `threshold` the
 * pair composes.
 */
interface BondEntry {
  a: GameEntity;
  b: GameEntity;
  timer: number;
  threshold: number;
}

// ── Metal triangular-lattice constants ──────────────────────────────────
// An UP cell (apex toward local -y) shares its 3 edges with DOWN cells at
// these integer key offsets; a DOWN cell mirrors them.  Cell key (ix,iy)
// maps to lattice-frame centroid (ix·R·√3/2, iy·R/2).  Neighbours always
// flip orientation, so the lattice is bipartite and every key has a fixed
// up/down parity once a seed is placed.
const METAL_UP_NEIGHBORS: ReadonlyArray<readonly [number, number]> = [[0, 2], [-1, -1], [1, -1]];
const METAL_DOWN_NEIGHBORS: ReadonlyArray<readonly [number, number]> = [[0, -2], [-1, 1], [1, 1]];

// Andrew's monotone-chain convex hull (CCW).  Used to give a metal
// composite a convex collision polygon (SAT) that bounds its triangle
// cells — render uses the exact cells, collision uses this hull.
function metalConvexHull(points: Vector2[]): Vector2[] {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((p, q) => (p.x === q.x ? p.y - q.y : p.x - q.x));
  const cross = (o: Vector2, a: Vector2, b: Vector2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vector2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vector2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
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
   * via the zero-time bond) stops too.
   */
  public shardBondingEnabled: boolean = true;
  /**
   * DBG toggle (PAuto) — gates the plastic-shard neighbour-contact
   * count computed in runMergeBroadphase.  When false, the count
   * isn't refreshed (RenderSystem then falls back to per-instance
   * shades), saving the extra plastic-only neighbour scan.
   */
  public plasticAutomataEnabled: boolean = true;
  /**
   * DBG toggle (PRch) — gates the plastic "reach" pseudopod behaviour
   * (reach toward loose plastic / glass / rock, grab, retract).  Off
   * leaves plastic shards as a passive cohesive cluster.
   */
  public plasticReachEnabled: boolean = true;
  /**
   * Active stick-bonds.  Replaces GameEngine.stickBonds.  Each bond
   * accumulates a contact timer; when timer >= threshold the pair
   * composes.
   */
  private bonds: BondEntry[] = [];
  // Peak per-bond local merge-rate multiplier applied last tickBonds —
  // exposed for the DBG "merge rate" readout (replaces the old global
  // count-driven multiplier).  1.0 = no local acceleration this frame.
  public lastMergeRatePeak: number = 1;

  /**
   * Optional adapter providing variant-specific completion hooks.
   * Stage 2: nebula composition rewrite at regen completion.
   * Stage 4: nebula shard→tile transmutation after self-compose.
   * Non-nebula entities never call into the adapter, so non-nebula
   * regen / merge works regardless of whether one is wired.
   */
  private adapter: ShardAdapter | null = null;

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

  /**
   * Central performance controller.  Drives the plastic-cosmetic skip
   * gate (PAuto count + reach) and the entity-count merge/eat RATE
   * multiplier.  Null only pre-wire; GameEngine sets it at construction.
   */
  private perfController: PerfController | null = null;

  /**
   * Per-merge-pass counter for the plastic cosmetic sub-gate (PAuto
   * count + reach).  These passes are NESTED inside runMergeBroadphase,
   * which itself only runs on shard-pair steps — so they can't use the
   * controller's global-tick `shouldRun` (its phase might never coincide
   * with merge-pass steps, starving the gate forever).  Instead the
   * controller supplies the effective INTERVAL and we apply it against a
   * counter that ticks once per merge pass, so the gate fires every Nth
   * merge pass exactly like the old SHPAIR-paced cadence.
   */
  private plasticCosmeticTick: number = 0;

  constructor(private particles: ParticleSystem) {}

  public setPerfController(pc: PerfController): void {
    this.perfController = pc;
  }

  /** Wire the variant-specific completion adapter.  Called once at
   *  GameEngine construction after NebulaSystem is built. */
  public setAdapter(adapter: ShardAdapter): void {
    this.adapter = adapter;
  }

  /** Backwards-compat alias for the Stage 2 method name. */
  public setRegenAdapter(adapter: ShardAdapter): void {
    this.setAdapter(adapter);
  }

  /** Inject the current map type each frame.  Must be called before
   *  update() so the merge broadphase / free-spawn sizing read the
   *  right per-map config. */
  public setMergeContext(mapType: MapType): void {
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

  /** Wire the shard→tile blow-back hook.  Invoked with the new tile's
   *  centre whenever a shard cluster condenses into a static tile
   *  (glass / rock); GameEngine emits the merge shockwave there. */
  public setTileFormedHandler(fn: (x: number, y: number) => void): void {
    this.onTileFormed = fn;
  }
  private onTileFormed: ((x: number, y: number) => void) | null = null;

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
    // whose parties have separated, and compose pairs when timers
    // mature.  The cohesion velocity-blend inside
    // tickBonds is gated by runMergePass so it doesn't drag bonded
    // shards together on frames when separation is skipped — that
    // imbalance is what collapsed clusters to a single point on
    // high-N ShPair settings.
    this.tickBonds(entities, dt, physics, runMergePass);
    if (runMergePass) {
      this.runMergeBroadphase(entities, dt, physics);
      this.runLargeShardCollapse(entities);
      if (METAL_ASSEMBLY.ENABLED) this.tickMetalAssembly(entities);
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
    this.plasticCosmeticTick = 0;
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

    // Fraction-sized override (today: plastic-shard).  When both
    // childSizeFractionMin and childSizeFractionMax are set, sizes
    // are picked as `parent.size × random(fMin, fMax)` per child
    // — no area conservation, no MIN_SIZE filter on outputs — so a
    // fixed count of visible-sized children spawns regardless of
    // parent area math.  Termination: parent below MIN_SIZE
    // doesn't shatter, so shrinking generations die cleanly.
    const fMin = parentVariant.shatter.childSizeFractionMin;
    const fMax = parentVariant.shatter.childSizeFractionMax;
    const useFraction = fMin !== undefined && fMax !== undefined;

    if (useFraction) {
      if (parent.size.x < MIN_SIZE) return;
    } else {
      // Area-conservative mode: parent needs enough area for at
      // least two MIN_SIZE children.
      if (parent.size.x * parent.size.x < MIN_SIZE * MIN_SIZE * 2) return;
    }

    // Damage scales both count and size distribution.  damageNorm 0
    // → countMin pieces, mostly large (alphaMin); damageNorm 1 →
    // countMax pieces, mostly small (alphaMax).
    const damage     = parent.lastImpactDamage ?? 1;
    const damageNorm = Math.min(1, (damage - 1) / 4);
    const { countMin, countMax, alphaMin, alphaMax } = parentVariant.shatter;

    // Size-keyed count override (today: plastic-shard, 5 levels).
    // When set, picks the count from the first entry whose
    // `maxSize` exceeds parent.size — "bigger shards burst into
    // more children."  Falls through to the damage-based formula
    // otherwise.
    let count: number;
    const sizeLevels = parentVariant.shatter.shatterCountBySize;
    if (sizeLevels && sizeLevels.length > 0) {
      const parentSize = parent.size.x;
      let chosen = sizeLevels[sizeLevels.length - 1].count;
      for (let i = 0; i < sizeLevels.length; i++) {
        if (parentSize < sizeLevels[i].maxSize) { chosen = sizeLevels[i].count; break; }
      }
      count = chosen;
    } else {
      count = countMin + Math.round(damageNorm * (countMax - countMin));
    }
    if (count < 2) return;

    let sizes: number[];
    if (useFraction) {
      sizes = [];
      const span = fMax! - fMin!;
      for (let i = 0; i < count; i++) {
        sizes.push(parent.size.x * (fMin! + Math.random() * span));
      }
    } else {
      const parentArea = parent.size.x * parent.size.x;
      const alpha = alphaMin + damageNorm * (alphaMax - alphaMin);
      const rawAreas = Array.from({ length: count }, () => Math.pow(Math.random(), alpha));
      const rawSum   = rawAreas.reduce((s, a) => s + a, 0);
      sizes = rawAreas
        .map(a => Math.sqrt((a / rawSum) * parentArea))
        .filter(s => s >= MIN_SIZE);
      if (sizes.length < 2) return;
    }

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
      // Plastic-shard sub-shards re-roll their amber shade so each
      // generation has visible variation; everything else inherits
      // the parent's colour.  Reused for both `color` and (plastic
      // only) `wigglePhase`.
      const childColor = childVariant.id === 'plastic-shard'
        ? randomPlasticShardShade()
        : (isTile ? parent.color : (parent.color || COLORS.ASTEROID));
      // Spawn-time shape variance for plastic-shard sub-shards
      // (option B) — gives shatter-spawned children their own
      // shape footprint same as freshly-detached shards.
      const isChildPlasticShard = childVariant.id === 'plastic-shard';
      const sv = PLASTIC_DEFORM_CONSTANTS.SPAWN_SHAPE_VARIANCE;
      const baseScaleX = isChildPlasticShard ? (1 - sv + Math.random() * 2 * sv) : undefined;
      const baseScaleY = isChildPlasticShard ? (1 - sv + Math.random() * 2 * sv) : undefined;

      entities.push({
        id:           nextId('shard'),
        type:          EntityType.STRUCTURE,
        shardVariant:  childVariant.id,
        position:     { x: parent.position.x + offsetX, y: parent.position.y + offsetY },
        velocity:     { x: vx, y: vy },
        size:         { x: newSize, y: newSize },
        rotation:      Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 2 * maxSpin,
        color:         childColor,
        active:        true,
        health:        hp,
        maxHealth:     hp,
        polygonPoints: points,
        mass:          childSpawn.sizeToMass(newSize),
        sprite:        parent.sprite,
        // Optional per-entity damping from the variant's spawn shape
        // (today plastic-shard sets these so child shards inherit
        // strong cluster damping).  Undefined for variants that
        // drift naturally (rock / glass).  restSpeed / restSpin
        // raise the snap-to-zero floor for sleep-like behaviour
        // when shards are at rest.
        linearDamping:  childSpawn.linearDamping,
        angularDamping: childSpawn.angularDamping,
        restSpeed:      childSpawn.restSpeed,
        restSpin:       childSpawn.restSpin,
        // Plastic-shard wiggle phase derived from this shard's amber
        // shade — gives sub-shards spawned by shatter their own
        // oscillation timing, distinct from the parent.
        wigglePhase:   childVariant.id === 'plastic-shard' ? colorToWigglePhase(childColor) : undefined,
        // Plastic-shard spawn-time shape variance (option B).
        baseScaleX,
        baseScaleY,
        // Plastic-shard sticky-bond anchor — PhysicsSystem pulls each
        // shard toward this rest position every substep.  Anchor sits
        // at the child's spawn position so the shatter spread becomes
        // the cluster's new rest configuration.
        anchorX: isChildPlasticShard ? (parent.position.x + offsetX) : undefined,
        anchorY: isChildPlasticShard ? (parent.position.y + offsetY) : undefined,
        // Let the shatter debris fly apart before the overlap-collapse
        // pass can re-condense it into a tile (DBG-cyclable delay).
        collapseGraceTimer: getActiveShatterGraceDelay(),
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

    // Merge RATE is now computed LOCALLY per bond (see below): a bond in
    // a dense pocket matures faster, focusing the cull on hotspots.
    // Big-shard slowdown is handled by the bond *threshold* (per-variant
    // bondTimeSizePower), not the rate.  The DBG MrgRt gate
    // (perfController.mergeRateEnabled) holds the rate at a neutral 1.0×
    // when off.  tickBonds runs EVERY sim step, so the bond timer needs
    // no skip compensation.
    const rateEnabled = this.perfController ? this.perfController.mergeRateEnabled : true;
    let ratePeak = 1;

    const COHESION     = 4.0;   // fraction of velocity delta corrected per second
    const BREAK_FACTOR = 1.5;   // bond breaks when dist > contactDist * this
    // Per-frame merge budget — caps how many merges may fire this tick so
    // a freshly-shattered or hotspot cluster (whose bond timers elapse
    // together) compacts over several frames instead of one spike.  Once
    // exhausted, surplus bonds defer (timer = threshold - dt) to next
    // tick.  Boosted by LOCAL_MERGE.BUDGET_MULT when the rate feature is
    // on so dense fields consolidate at a useful throughput; base budget
    // when off.
    const budgetMult = rateEnabled ? LOCAL_MERGE_CONSTANTS.BUDGET_MULT : 1;
    let mergeBudget = Math.max(1, Math.round(CLEANUP_CONSTANTS.MAX_REMOVALS_PER_FRAME * budgetMult));

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

      // Per-bond local rate: density boost (denser pocket → faster),
      // neutral 1.0× when the DBG gate is off.  Big-shard slowdown is NOT
      // applied here — it lives solely in the bond *threshold* via the
      // per-variant bondTimeSizePower (avoids double-counting size).  The
      // boost is then lerped DOWN toward MERGE_LOAD_SCALE_MIN as global
      // load climbs (scaledMergeRate), so a heavy field stops merging
      // itself back to comfort — keeping the high-load state alive for
      // perf testing.  No-op at idle.
      let bondRate = 1;
      if (rateEnabled) {
        const cell = Math.max(a.mergeCellCount ?? 0, b.mergeCellCount ?? 0);
        bondRate = localDensityBoost(cell);
        if (bondRate > ratePeak) ratePeak = bondRate;
        if (this.perfController) bondRate = this.perfController.scaledMergeRate(bondRate);
      }
      bond.timer += dt * bondRate;

      if (bond.timer >= bond.threshold) {
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
        this.composeEntities(a, b, entities, physics);
        mergeBudget--;
        continue; // bond resolved — drop
      }

      this.bonds[writeIdx++] = bond;
    }
    this.bonds.length = writeIdx;
    this.lastMergeRatePeak = ratePeak;
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
    // PerfController-driven gate for the cosmetic plastic scans (PAuto
    // count + reach).  This broadphase already runs at the shard-pair
    // cadence; the controller's `plasticCosmetic` task supplies an extra
    // effective interval that throttles these two passes further (its
    // higher cost weight backs off harder under load) while the eat /
    // bonding work keeps the merge cadence.  Applied against a per-
    // merge-pass counter (not the controller's global-tick gate) so the
    // nested sub-pass can't be starved by phase misalignment.  When the
    // skip is active, plasticNeighborCount is left stale (the renderer
    // keeps the last brightness) and reach anchors hold (the spring
    // keeps chasing the last-aimed anchor) — no flicker, no snap.
    const cosmeticInterval = Math.max(1, this.perfController
        ? this.perfController.effectiveInterval('plasticCosmetic') | 0
        : 1);
    const runCosmetic = (this.plasticCosmeticTick % cosmeticInterval) === 0;
    this.plasticCosmeticTick++;
    // Frame-skip compensation factor: this whole broadphase runs once
    // per `skipComp` substeps (the shard-pair effective interval), so
    // time-based eat accumulation is multiplied by it to stay
    // frame-skip-independent (see the eat pass below).
    const skipComp = Math.max(1, _physics.lastEffectiveShardPairInterval | 0);
    // Local-density merge/eat acceleration gate (replaces the old global
    // count multiplier).  The eat pass below applies a per-shard density
    // boost from the consumed shard's merge-grid cell occupancy so plastic
    // digests faster inside a dense pocket; neutral when the gate is off.
    const eatRateEnabled = this.perfController ? this.perfController.mergeRateEnabled : true;
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
    let hasPlastic = false;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!e.active) continue;
      if (e.type !== EntityType.STRUCTURE || e.mass === Infinity) continue;
      // Once a shard is in its graceful retire window (merge fade-
      // out) it must not pull, bond, or get pulled.  Otherwise its
      // velocity blends with surviving partners and the dissolve
      // looks chaotic.
      if (e.mergeFadeTimer !== undefined) continue;
      if (e.shardVariant === 'plastic-shard') {
        hasPlastic = true;
        // Reset the plastic neighbour-contact count up front so the
        // count pass below only ever increments, and lone shards (or
        // the candidates.length < 2 early-return path) read 0.
        if (this.plasticAutomataEnabled && runCosmetic) e.plasticNeighborCount = 0;
      }
      candidates.push(e);
    }
    // Ammo drops are no longer merge candidates — they're inert
    // collectibles (magnet-pull + proximity-collect only), so they
    // neither bond with each other nor get absorbed by asteroids.
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
    // Stamp each candidate's local-crowd signal: the occupancy of its
    // merge-grid cell.  Cheap O(k); read by tickBonds to focus the
    // absorption-rate boost on dense pockets (hotspots).
    for (const cell of grid.values()) {
      for (let k = 0; k < cell.length; k++) candidates[cell[k]].mergeCellCount = cell.length;
    }

    // ── Plastic neighbour-contact count (PAuto automata) ───────────
    // Reuses the grid above (no second build).  For each plastic-
    // shard, count other plastic-shards whose centres fall within
    // CONTACT_BUFFER × (rA + rB) — i.e. touching or near-touching.
    // Runs before the gated pull/bond loop so every plastic-shard is
    // counted regardless of merge cooldown.  Drives RenderSystem's
    // brightness automata.  SHPAIR-paced (runCosmetic).
    if (this.plasticAutomataEnabled && runCosmetic) {
      const buf = PLASTIC_SHARD_AUTOMATA.CONTACT_BUFFER;
      for (let i = 0; i < candidates.length; i++) {
        const a = candidates[i];
        if (a.shardVariant !== 'plastic-shard' || !a.active) continue;
        const acx = Math.floor(a.position.x / CELL);
        const acy = Math.floor(a.position.y / CELL);
        const aR = Math.max(a.size.x, a.size.y) / 2;
        let count = 0;
        for (let ncx = acx - 1; ncx <= acx + 1; ncx++) {
          for (let ncy = acy - 1; ncy <= acy + 1; ncy++) {
            const cell = grid.get(keyFor(ncx, ncy));
            if (!cell) continue;
            for (let k = 0; k < cell.length; k++) {
              const j = cell[k];
              if (j === i) continue;
              const b = candidates[j];
              if (b.shardVariant !== 'plastic-shard' || !b.active) continue;
              const dx = wrapDeltaX(a.position.x, b.position.x);
              const dy = wrapDeltaY(a.position.y, b.position.y);
              const bR = Math.max(b.size.x, b.size.y) / 2;
              const reach = (aR + bR) * buf;
              if (dx * dx + dy * dy <= reach * reach) count++;
            }
          }
        }
        a.plasticNeighborCount = count;
      }
    }

    // ── Plastic eat pass ───────────────────────────────────────────
    // Plastic-shards consume glass-/rock-shards on prolonged contact.
    // A gentle inverse-distance attraction draws each glass/rock shard
    // toward the nearest plastic-shard within ATTRACT_RANGE so debris
    // settles into the plastic instead of bouncing away.  While the
    // shard's centre is within that plastic's visual orb (plasticR ×
    // CONTACT_RADIUS_FACTOR + own radius) it accumulates an eat timer
    // (decaying when it drifts off); once the timer matures the plastic
    // eats it.  Reuses the grid above; eats are collected then applied
    // so growth doesn't perturb the in-progress scan.  Skipped entirely
    // when no plastic-shards are present.
    if (hasPlastic) {
      const factor = PLASTIC_EAT.CONTACT_RADIUS_FACTOR;
      const attractRangeSq = PLASTIC_EAT.ATTRACT_RANGE * PLASTIC_EAT.ATTRACT_RANGE;
      const attractStrength = getActivePlasticEatAttract();
      // The eat timer accumulates ONLY when this broadphase runs, which
      // is once per `skipComp` substeps — so multiply dt by skipComp to
      // keep digest time frame-skip-independent under load.  The rate
      // multiplier then scales the maturation threshold (eatTime = base
      // / mult): > 1 shortens it (dense fields digest faster), < 1
      // lengthens it (sparse fields linger).  The pull force is
      // intentionally NOT compensated: it stays at the merge cadence (a
      // pre-existing "dense fields back off" behaviour).
      const dtEat = dt * skipComp;
      let eats: Array<{ eater: GameEntity; consumed: GameEntity }> | null = null;
      for (let i = 0; i < candidates.length; i++) {
        const g = candidates[i];
        if (!g.active) continue;
        if (g.shardVariant !== 'glass-shard' && g.shardVariant !== 'rock-shard' && g.shardVariant !== 'metal-shard') continue;
        const gcx = Math.floor(g.position.x / CELL);
        const gcy = Math.floor(g.position.y / CELL);
        const gR = Math.max(g.size.x, g.size.y) / 2;
        // Nearest plastic-shard within the attraction range.
        let nearP: GameEntity | null = null;
        let nearDistSq = Infinity;
        let nearDx = 0, nearDy = 0;
        for (let ncx = gcx - 1; ncx <= gcx + 1; ncx++) {
          for (let ncy = gcy - 1; ncy <= gcy + 1; ncy++) {
            const cell = grid.get(keyFor(ncx, ncy));
            if (!cell) continue;
            for (let k = 0; k < cell.length; k++) {
              const p = candidates[cell[k]];
              if (p.shardVariant !== 'plastic-shard' || !p.active) continue;
              const dx = wrapDeltaX(g.position.x, p.position.x);
              const dy = wrapDeltaY(g.position.y, p.position.y);
              const distSq = dx * dx + dy * dy;
              if (distSq <= attractRangeSq && distSq < nearDistSq) {
                nearDistSq = distSq;
                nearP = p;
                nearDx = dx;
                nearDy = dy;
              }
            }
          }
        }
        if (!nearP) {
          if (g.plasticEatTimer) g.plasticEatTimer = Math.max(0, g.plasticEatTimer - dtEat);
          continue;
        }
        const dist = Math.sqrt(nearDistSq);
        // Rock is no longer edible — plastic SHOVES it away instead.
        // Same nearDx/nearDy (g → p), negated so the push is g away
        // from p, with the same 1/dist falloff the attract used.
        if (g.shardVariant === 'rock-shard') {
          if (dist > 0.0001) {
            const effDist = Math.max(dist, PLASTIC_EAT.ATTRACT_MIN_DIST);
            const accel = (PLASTIC_EAT.ROCK_REPEL_STRENGTH * dt) / effDist;
            const inv = 1 / dist;
            g.velocity.x -= nearDx * inv * accel;
            g.velocity.y -= nearDy * inv * accel;
          }
          if (g.plasticEatTimer) g.plasticEatTimer = Math.max(0, g.plasticEatTimer - dtEat);
          continue;
        }
        // Glass + metal: gentle attraction toward the nearest plastic
        // (dx/dy already point g → p since wrapDelta is to − from).
        if (dist > 0.0001) {
          const effDist = Math.max(dist, PLASTIC_EAT.ATTRACT_MIN_DIST);
          const accel = (attractStrength * dt) / effDist;
          const inv = 1 / dist;
          g.velocity.x += nearDx * inv * accel;
          g.velocity.y += nearDy * inv * accel;
        }
        // Eat timer — only while inside the plastic's orb.
        const reach = (nearP.size.x / 2) * factor + gR;
        if (nearDistSq <= reach * reach) {
          const t = (g.plasticEatTimer ?? 0) + dtEat;
          g.plasticEatTimer = t;
          // Metal is dense — it takes significantly longer to digest.
          // Local density scales maturation: a debris shard in a dense
          // pocket digests faster, a lone one lingers at the base time.
          const baseEatTime = g.shardVariant === 'metal-shard'
            ? PLASTIC_EAT.SECONDS * PLASTIC_EAT.METAL_TIME_FACTOR
            : PLASTIC_EAT.SECONDS;
          // Density boost (faster digest in dense pockets), then lerped
          // DOWN toward the floor under high load — same load-driven
          // slowdown applied to bond merges (see tickBonds).
          let eatBoost = eatRateEnabled ? localDensityBoost(g.mergeCellCount ?? 0) : 1;
          if (eatRateEnabled && this.perfController) eatBoost = this.perfController.scaledMergeRate(eatBoost);
          const eatTime = baseEatTime / eatBoost;
          if (t >= eatTime) (eats ??= []).push({ eater: nearP, consumed: g });
        } else if (g.plasticEatTimer) {
          g.plasticEatTimer = Math.max(0, g.plasticEatTimer - dtEat);
        }
      }
      if (eats) {
        for (let i = 0; i < eats.length; i++) {
          const { eater, consumed } = eats[i];
          if (consumed.shardVariant === 'metal-shard') {
            // Metal isn't absorbed — it's transmuted into rock shards
            // ejected away from the plastic.
            this.applyPlasticEatMetal(eater, consumed, entities);
          } else {
            this.applyPlasticEat(eater, consumed);
          }
        }
      }
    }

    // ── Plastic reach pass (living-blob pseudopod) ─────────────────
    // Emergent reach → grab → retract via the existing anchor spring:
    //  1. Each loose target (glass/rock shard, or an unbonded plastic
    //     shard) is assigned its single nearest plastic reacher.
    //  2. A reacher leads its anchor toward the target (a yield-length
    //     "leash" ahead) so the spring stretches it out as a pseudopod;
    //     it saves its current anchor as "home" first.
    //  3. On contact (GRAB_DIST) it flips to retract: it leads its
    //     anchor back to home so the spring reels it (and whatever the
    //     bond / eat systems grabbed) back into the cluster.
    // One reacher per target keeps it a protrusion, not a whole-cluster
    // lurch.  Reuses the grid + `bonded` set above.  SHPAIR-paced
    // (runCosmetic) — anchors hold between updates so the reach stays
    // smooth even when this pass is throttled under load.
    if (hasPlastic && this.plasticReachEnabled && runCosmetic) {
      const RANGE_SQ = PLASTIC_REACH.RANGE * PLASTIC_REACH.RANGE;
      const grabF = PLASTIC_REACH.GRAB_DIST_FACTOR;
      const leash = getActivePlasticYield();
      // 1. Assign each target its nearest eligible plastic reacher.
      const assign = new Map<GameEntity, GameEntity>();      // reacher → target
      const assignDistSq = new Map<GameEntity, number>();
      for (let i = 0; i < candidates.length; i++) {
        const t = candidates[i];
        if (!t.active) continue;
        const tv = t.shardVariant;
        // Rock is repelled, not eaten — don't reach for it (glass/metal
        // are still grabbed + consumed).
        const isDebris = tv === 'glass-shard' || tv === 'metal-shard';
        const isLoosePlastic = tv === 'plastic-shard' && !bonded.has(t);
        if (!isDebris && !isLoosePlastic) continue;
        const tcx = Math.floor(t.position.x / CELL);
        const tcy = Math.floor(t.position.y / CELL);
        const tR = Math.max(t.size.x, t.size.y) / 2;
        let bestP: GameEntity | null = null;
        let bestSq = Infinity;
        for (let ncx = tcx - 1; ncx <= tcx + 1; ncx++) {
          for (let ncy = tcy - 1; ncy <= tcy + 1; ncy++) {
            const cell = grid.get(keyFor(ncx, ncy));
            if (!cell) continue;
            for (let k = 0; k < cell.length; k++) {
              const p = candidates[cell[k]];
              if (p === t || p.shardVariant !== 'plastic-shard' || !p.active) continue;
              if (p.reachBack) continue; // busy retracting
              const dx = wrapDeltaX(p.position.x, t.position.x);
              const dy = wrapDeltaY(p.position.y, t.position.y);
              const dSq = dx * dx + dy * dy;
              const grab = (Math.max(p.size.x, p.size.y) / 2 + tR) * grabF;
              if (dSq > grab * grab && dSq <= RANGE_SQ && dSq < bestSq) {
                bestSq = dSq;
                bestP = p;
              }
            }
          }
        }
        if (bestP) {
          const cur = assignDistSq.get(bestP);
          if (cur === undefined || bestSq < cur) {
            assign.set(bestP, t);
            assignDistSq.set(bestP, bestSq);
          }
        }
      }
      // 2. Drive each plastic shard's anchor per its reach phase.
      for (let i = 0; i < candidates.length; i++) {
        const p = candidates[i];
        if (p.shardVariant !== 'plastic-shard' || !p.active) continue;
        if (p.reachBack) {
          // Retract: lead the anchor back toward home.
          const hx = p.reachHomeX ?? p.position.x;
          const hy = p.reachHomeY ?? p.position.y;
          const dx = wrapDeltaX(p.position.x, hx);
          const dy = wrapDeltaY(p.position.y, hy);
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= PLASTIC_REACH.HOME_EPS) {
            p.anchorX = hx; p.anchorY = hy;
            p.reachBack = undefined;
            p.reachTargetId = undefined;
            p.reachHomeX = undefined;
            p.reachHomeY = undefined;
          } else {
            const lead = Math.min(dist, leash);
            p.anchorX = wrapX(p.position.x + (dx / dist) * lead);
            p.anchorY = wrapY(p.position.y + (dy / dist) * lead);
          }
          continue;
        }
        const t = assign.get(p);
        if (t) {
          // Reach out toward the assigned target.
          if (p.reachHomeX === undefined) {
            p.reachHomeX = p.anchorX ?? p.position.x;
            p.reachHomeY = p.anchorY ?? p.position.y;
          }
          p.reachTargetId = t.id;
          const dx = wrapDeltaX(p.position.x, t.position.x);
          const dy = wrapDeltaY(p.position.y, t.position.y);
          const dist = Math.sqrt(dx * dx + dy * dy);
          const grab = (Math.max(p.size.x, p.size.y) / 2 + Math.max(t.size.x, t.size.y) / 2) * grabF;
          if (dist <= grab) {
            p.reachBack = true; // grabbed → retract (bond/eat systems take it from here)
          } else if (dist > 0.001) {
            const lead = Math.min(dist, leash);
            p.anchorX = wrapX(p.position.x + (dx / dist) * lead);
            p.anchorY = wrapY(p.position.y + (dy / dist) * lead);
          }
        } else if (p.reachTargetId !== undefined) {
          // Lost the target before contact — retract home.
          p.reachBack = true;
        }
      }
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
                     && !aBondedAlready
                     // A reaching / retracting plastic shard is driven by
                     // its reach anchor — don't let the cohesion pull drag
                     // it back toward the cluster and cancel the reach.
                     && a.reachTargetId === undefined && !a.reachBack;

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
            } else {
              continue; // neither side wants the bond
            }

            // Cooldowns gate bond formation too.
            if ((b.nebulaMergeCooldown ?? 0) > 0) continue;

            const partnerId = pullerVariant === aVariant ? bVariantId : aVariantId;
            if (partnerId === null) continue;
            const rule = this.resolveRule(pullerVariant, partnerId);

            // Optional size-disparity gate (today: plastic-shard).
            // Skip the bond when the pair is too close in size —
            // forces "smaller merges into larger" by refusing equal
            // pairs.  Symmetric: applies regardless of which side
            // is the puller.
            const reqDelta = pullerVariant.merge.requireSizeDeltaFraction;
            if (reqDelta !== undefined && reqDelta > 0) {
              const larger  = Math.max(a.size.x, b.size.x);
              const smaller = Math.min(a.size.x, b.size.x);
              if (larger <= 0 || (larger - smaller) / larger < reqDelta) continue;
            }

            // Threshold: pullerVariant.merge.bondTimeSeconds, scaled
            // by size and the rule's thresholdScale.  Two scaling
            // modes — exponential (bondTimeSizeExp set, used by
            // plastic-shard) or polynomial (bondTimeSizePower, the
            // default for rock/glass).
            const baseTime   = pullerVariant.merge.bondTimeSeconds ?? 10;
            const sizeRef    = pullerVariant.merge.bondTimeSizeRef   ?? 20;
            const sizeExp    = pullerVariant.merge.bondTimeSizeExp;
            const sizePower  = pullerVariant.merge.bondTimeSizePower ?? 1.5;
            const avgSize    = (a.size.x + b.size.x) * 0.5;
            let baseScaled: number;
            if (sizeExp !== undefined && sizeExp > 0) {
              // Exponential mode — threshold doubles roughly every
              // ln(2)/sizeExp units of additional size above ref.
              baseScaled = baseTime * Math.exp(Math.max(0, avgSize - sizeRef) * sizeExp);
            } else {
              const sizeRatio = sizeRef > 0 ? Math.max(1, avgSize / sizeRef) : 1;
              baseScaled = baseTime * Math.pow(sizeRatio, sizePower);
            }
            const threshold  = baseScaled * (rule.thresholdScale ?? 1);

            this.bonds.push({ a, b, timer: 0, threshold });
            bondedThisFrame.add(a);
            bondedThisFrame.add(b);

            // Zero-threshold guard: a variant configured with
            // bondTimeSeconds 0 composes on contact in the same frame.
            // No variant sets that today, but keep the path so such a
            // config doesn't leave a permanently-unresolved bond.
            if (threshold <= 0) {
              this.composeEntities(a, b, entities, _physics);
              // Drop the just-pushed bond (it's already resolved).
              this.bonds.pop();
            }
          }
        }
      }

      // Apply pull force toward the chosen target (if any).  Metal
      // composites (metalCells set) don't actively seek — only loose pieces
      // are pulled in to snap — so formed shapes don't drift-pile onto each
      // other before composite-composite merging exists.
      if (bestPullTarget && wantsPull && a.metalCells === undefined) {
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

    // Hot-spot collapse: snap overlapping rock/glass shard stacks (which
    // the throttled separation can't disperse) into static tiles.  Runs
    // last so shards consumed by the pull/bond passes above are already
    // excluded.
    if (HOTSPOT_COLLAPSE.ENABLED) this.collapseHotspots(entities, _physics, candidates);
  }

  /**
   * Hot-spot collapse — cure for overlapping shard piles the throttled
   * shard-pair separation can't keep apart (they stack and pulse in phase
   * with the skip interval).  Buckets active rock-/glass-shards (plus the
   * SMALLER plastic-shards, < PLASTIC_MAX_SIZE — larger plastic only
   * splits) into a fine, tile-sized grid; any cell with >= MIN_COUNT (or
   * PLASTIC_MIN_COUNT) shards of a material
   * is a real overlap stack (self-gating: at low load separation keeps
   * cells from filling).  Each stack condenses into ONE static tile at the
   * nearest free hex (surplus shards fade out), so a field of stacks
   * becomes a cluster of tiles and leaves the dynamic grid.  Capped at
   * MAX_TILES_PER_PASS per pass so a big field clears over a few passes.
   */
  private collapseHotspots(
    entities: GameEntity[],
    physics: PhysicsSystem,
    candidates: GameEntity[],
  ): void {
    const { CELL, MIN_COUNT, MAX_TILES_PER_PASS,
            PLASTIC_ENABLED, PLASTIC_MIN_COUNT, PLASTIC_MAX_SIZE,
            METAL_ENABLED, METAL_MIN_COUNT } = HOTSPOT_COLLAPSE;
    const COLS = Math.ceil(MAP_WIDTH  / CELL);
    const ROWS = Math.ceil(MAP_HEIGHT / CELL);
    const keyFor = (cx: number, cy: number) => {
      const wx = ((cx % COLS) + COLS) % COLS;
      const wy = ((cy % ROWS) + ROWS) % ROWS;
      return (wx << 16) | (wy & 0xFFFF);
    };
    const grid = new Map<number, number[]>();
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c.active || c.mergeFadeTimer !== undefined) continue;
      // Freshly-shattered shards are off-limits until their grace timer
      // expires — gives a destroyed tile's debris time to scatter.
      if ((c.collapseGraceTimer ?? 0) > 0) continue;
      const v = c.shardVariant;
      const isRockGlass = v === 'rock-shard' || v === 'glass-shard';
      // Plastic condenses too, but only the smaller shards — larger ones
      // (>= PLASTIC_MAX_SIZE) only split/shatter, so they're excluded.
      const isSmallPlastic = PLASTIC_ENABLED && v === 'plastic-shard' && c.size.x < PLASTIC_MAX_SIZE;
      // Metal triangles reassemble into a metal-tile once enough pack a cell.
      const isMetal = METAL_ENABLED && v === 'metal-shard';
      if (!isRockGlass && !isSmallPlastic && !isMetal) continue;
      const key = keyFor(Math.floor(c.position.x / CELL), Math.floor(c.position.y / CELL));
      let cell = grid.get(key);
      if (!cell) { cell = []; grid.set(key, cell); }
      cell.push(i);
    }

    let minAny = MIN_COUNT;
    if (PLASTIC_ENABLED) minAny = Math.min(minAny, PLASTIC_MIN_COUNT);
    if (METAL_ENABLED) minAny = Math.min(minAny, METAL_MIN_COUNT);
    let tilesMade = 0;
    for (const idxs of grid.values()) {
      if (tilesMade >= MAX_TILES_PER_PASS) break;
      if (idxs.length < minAny) continue;
      // Tally each material + remember its largest shard (the transmute host).
      let rockCount = 0, glassCount = 0, plasticCount = 0, metalCount = 0;
      let rockHost = -1, glassHost = -1, plasticHost = -1, metalHost = -1;
      for (let k = 0; k < idxs.length; k++) {
        const e = candidates[idxs[k]];
        const sv = e.shardVariant;
        if (sv === 'rock-shard') {
          rockCount++;
          if (rockHost < 0 || e.size.x > candidates[rockHost].size.x) rockHost = idxs[k];
        } else if (sv === 'glass-shard') {
          glassCount++;
          if (glassHost < 0 || e.size.x > candidates[glassHost].size.x) glassHost = idxs[k];
        } else if (sv === 'metal-shard') {
          metalCount++;
          if (metalHost < 0 || e.size.x > candidates[metalHost].size.x) metalHost = idxs[k];
        } else {
          plasticCount++;
          if (plasticHost < 0 || e.size.x > candidates[plasticHost].size.x) plasticHost = idxs[k];
        }
      }
      if (rockCount >= MIN_COUNT &&
          this.collapseStack(candidates, idxs, rockHost, 'rock-shard', 'rock', entities, physics)) {
        tilesMade++;
      }
      if (tilesMade >= MAX_TILES_PER_PASS) break;
      if (METAL_ENABLED && metalCount >= METAL_MIN_COUNT &&
          this.collapseStack(candidates, idxs, metalHost, 'metal-shard', 'metal', entities, physics)) {
        tilesMade++;
      }
      if (tilesMade >= MAX_TILES_PER_PASS) break;
      if (PLASTIC_ENABLED && plasticCount >= PLASTIC_MIN_COUNT &&
          this.collapseStack(candidates, idxs, plasticHost, 'plastic-shard', 'plastic', entities, physics)) {
        tilesMade++;
      }
      if (tilesMade >= MAX_TILES_PER_PASS) break;
      if (glassCount >= MIN_COUNT &&
          this.collapseStack(candidates, idxs, glassHost, 'glass-shard', 'glass', entities, physics)) {
        tilesMade++;
      }
    }
  }

  /** Condense one material's stack inside a fine cell into a single tile:
   *  transmute the largest shard (host) to a tile at the nearest free hex,
   *  then fade out the rest of that material in the cell.  Returns true
   *  only when a tile was actually placed (a free hex was available). */
  private collapseStack(
    candidates: GameEntity[],
    idxs: number[],
    hostIdx: number,
    variant: ShardVariantId,
    material: StructureVariant,
    entities: GameEntity[],
    physics: PhysicsSystem,
  ): boolean {
    const host = hostIdx >= 0 ? candidates[hostIdx] : null;
    if (!host || !host.active || host.mergeFadeTimer !== undefined) return false;
    if (!this.tryTransmuteShardToTile(host, variant, material, entities, physics)) return false;
    for (let k = 0; k < idxs.length; k++) {
      if (idxs[k] === hostIdx) continue;
      const e = candidates[idxs[k]];
      if (e.shardVariant !== variant || !e.active || e.mergeFadeTimer !== undefined) continue;
      this.startMergeFadeOut(e);
    }
    return true;
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
    // At cap size a glass-shard condenses into a static glass-tile.
    // If every candidate hex is occupied the shard stays a (max-size)
    // shard and a later merge retries.
    this.tryTransmuteShardToTile(shard, 'glass-shard', 'glass', entities, physics);
  }

  /**
   * Snap a grown mobile shard to the nearest free hex cell and replace
   * it with a static tile of the given material (mass ∞).  Candidate
   * cells are the shard's current hex + its 6 neighbours, sorted by
   * distance; the first cell clear of static geometry wins.  If every
   * candidate is occupied the shard stays a shard (returns false) and a
   * later merge retries.  The source shard fades out as the tile
   * materialises on top of it.
   *
   * Shared by the glass and rock tier transitions (and plastic, when
   * re-enabled) — they differ only in the guard variant and the tile
   * material.
   */
  private tryTransmuteShardToTile(
    shard: GameEntity,
    variant: ShardVariantId,
    material: StructureVariant,
    entities: GameEntity[],
    physics: PhysicsSystem,
  ): boolean {
    if (shard.shardVariant !== variant) return false;

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
      // nebula-tiles in the same cell).  Radius slightly under
      // HEX_SIZE so touching neighbours don't register as overlap.
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
    const tile = TileGenerator.buildStructureTile(chosen.c, chosen.r, p.x, p.y, w, h, pts, material);
    entities.push(tile);
    physics.addStaticEntity(tile);

    // Blow-back: the tile snapping into place shoves nearby loose shards
    // clear (non-damaging shockwave — see MERGE_BLOWBACK).
    this.onTileFormed?.(p.x, p.y);

    // Source shard fades out — the tile materialises while the shard
    // dissolves on top of it.
    this.startMergeFadeOut(shard);
    return true;
  }

  // ── Metal rigid-composite assembly ──────────────────────────────────────
  // Two passes per merge tick:
  //   1. snap each loose triangle onto the nearest composite's empty
  //      boundary cell (growing the composite);
  //   2. fuse any remaining close loose-loose pairs into a fresh 2-cell
  //      composite.
  // The attraction pull (runMergeBroadphase, metal-shard.merge.attractedTo)
  // brings pieces into range; this pass does the rigid locking.
  private tickMetalAssembly(entities: GameEntity[]): void {
    const composites: GameEntity[] = [];
    const loose: GameEntity[] = [];
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!e.active || e.shardVariant !== 'metal-shard') continue;
      if (e.metalCells !== undefined) composites.push(e); else loose.push(e);
    }
    if (loose.length === 0) return;

    const R = HEX_SIZE / Math.sqrt(3);
    const SNAP = METAL_ASSEMBLY.SNAP_RANGE_R * R;
    const FORM = METAL_ASSEMBLY.FORM_RANGE_R * R;

    // Pass 1 — loose → composite.
    for (let i = 0; i < loose.length; i++) {
      const l = loose[i];
      if (!l.active || l.metalCells !== undefined) continue;
      let best: GameEntity | null = null;
      let bestTarget: { ix: number; iy: number; up: boolean; d2: number } | null = null;
      for (let c = 0; c < composites.length; c++) {
        const comp = composites[c];
        if (!comp.active) continue;
        const dx = wrapDeltaX(comp.position.x, l.position.x);
        const dy = wrapDeltaY(comp.position.y, l.position.y);
        const reach = comp.size.x * 0.5 + SNAP;
        if (dx * dx + dy * dy > reach * reach) continue;
        const t = this.nearestMetalFreeTarget(comp, l, SNAP);
        if (t && (bestTarget === null || t.d2 < bestTarget.d2)) { best = comp; bestTarget = t; }
      }
      if (best && bestTarget) this.growMetalComposite(best, l, bestTarget);
    }

    // Pass 2 — loose + loose → new composite, bucketed into a coarse grid
    // so the pair search stays local.
    const CELL = Math.max(FORM, 2 * R);
    const COLS = Math.max(1, Math.ceil(MAP_WIDTH / CELL));
    const ROWS = Math.max(1, Math.ceil(MAP_HEIGHT / CELL));
    const gkey = (cx: number, cy: number) => {
      const wx = ((cx % COLS) + COLS) % COLS;
      const wy = ((cy % ROWS) + ROWS) % ROWS;
      return wx * ROWS + wy;
    };
    const grid = new Map<number, number[]>();
    for (let i = 0; i < loose.length; i++) {
      const l = loose[i];
      if (!l.active || l.metalCells !== undefined) continue;
      const k = gkey(Math.floor(l.position.x / CELL), Math.floor(l.position.y / CELL));
      let b = grid.get(k);
      if (!b) { b = []; grid.set(k, b); }
      b.push(i);
    }
    const FORM2 = FORM * FORM;
    for (let i = 0; i < loose.length; i++) {
      const a = loose[i];
      if (!a.active || a.metalCells !== undefined) continue;
      const cx = Math.floor(a.position.x / CELL);
      const cy = Math.floor(a.position.y / CELL);
      let partner = -1;
      let bestD2 = FORM2;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const cell = grid.get(gkey(cx + ox, cy + oy));
          if (!cell) continue;
          for (const j of cell) {
            if (j <= i) continue;
            const b2 = loose[j];
            if (!b2.active || b2.metalCells !== undefined) continue;
            const dx = wrapDeltaX(a.position.x, b2.position.x);
            const dy = wrapDeltaY(a.position.y, b2.position.y);
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; partner = j; }
          }
        }
      }
      if (partner >= 0) {
        this.formMetalComposite(a, loose[partner]);
        composites.push(a);
      }
    }
  }

  /** Nearest empty boundary cell of `comp` to loose triangle `l`, in the
   *  composite's lattice frame, within `snap` world units — or null. */
  private nearestMetalFreeTarget(
    comp: GameEntity,
    l: GameEntity,
    snap: number,
  ): { ix: number; iy: number; up: boolean; d2: number } | null {
    const R = comp.metalLatticeR!;
    const ux = (R * Math.sqrt(3)) / 2;
    const uy = R / 2;
    const cells = comp.metalCells!;
    const occ = new Set<string>();
    let cmx = 0, cmy = 0;
    for (const c of cells) { occ.add(c.ix + ',' + c.iy); cmx += c.ix * ux; cmy += c.iy * uy; }
    cmx /= cells.length; cmy /= cells.length;

    // Loose triangle position in the composite's lattice frame (rotate the
    // world delta by -rotation, then offset by the mass centroid).
    const wdx = wrapDeltaX(comp.position.x, l.position.x);
    const wdy = wrapDeltaY(comp.position.y, l.position.y);
    const cos = Math.cos(comp.rotation);
    const sin = Math.sin(comp.rotation);
    const looseLx = (wdx * cos + wdy * sin) + cmx;
    const looseLy = (-wdx * sin + wdy * cos) + cmy;

    let best: { ix: number; iy: number; up: boolean; d2: number } | null = null;
    let bestD2 = snap * snap;
    for (const c of cells) {
      const offs = c.up ? METAL_UP_NEIGHBORS : METAL_DOWN_NEIGHBORS;
      for (const o of offs) {
        const tix = c.ix + o[0];
        const tiy = c.iy + o[1];
        if (occ.has(tix + ',' + tiy)) continue;
        const dx = tix * ux - looseLx;
        const dy = tiy * uy - looseLy;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; best = { ix: tix, iy: tiy, up: !c.up, d2 }; }
      }
    }
    return best;
  }

  /** Lock loose triangle `l` into composite `comp` at lattice cell `target`. */
  private growMetalComposite(
    comp: GameEntity,
    l: GameEntity,
    target: { ix: number; iy: number; up: boolean },
  ): void {
    const R = comp.metalLatticeR!;
    const ux = (R * Math.sqrt(3)) / 2;
    const uy = R / 2;
    const cells = comp.metalCells!;

    let cmx0 = 0, cmy0 = 0;
    for (const c of cells) { cmx0 += c.ix * ux; cmy0 += c.iy * uy; }
    cmx0 /= cells.length; cmy0 /= cells.length;

    cells.push({ ix: target.ix, iy: target.iy, up: target.up });

    let cmx1 = 0, cmy1 = 0;
    for (const c of cells) { cmx1 += c.ix * ux; cmy1 += c.iy * uy; }
    cmx1 /= cells.length; cmy1 /= cells.length;

    // Keep already-placed cells fixed in the world: when the mass centroid
    // shifts in the lattice frame, move the entity origin by the same shift
    // rotated into world space.
    const sx = cmx1 - cmx0;
    const sy = cmy1 - cmy0;
    const cos = Math.cos(comp.rotation);
    const sin = Math.sin(comp.rotation);
    comp.position.x += sx * cos - sy * sin;
    comp.position.y += sx * sin + sy * cos;
    wrapPosition(comp.position);

    const tm = comp.mass + l.mass;
    comp.velocity.x = (comp.velocity.x * comp.mass + l.velocity.x * l.mass) / tm;
    comp.velocity.y = (comp.velocity.y * comp.mass + l.velocity.y * l.mass) / tm;
    comp.mass = tm;
    comp.health = (comp.health ?? 0) + (l.health ?? 0);
    comp.maxHealth = (comp.maxHealth ?? 0) + (l.maxHealth ?? 0);

    this.metalRecomputeBounds(comp);
    l.active = false;
  }

  /** Fuse two loose triangles into a fresh 2-cell composite (rhombus).
   *  `a` becomes the composite; `b` is consumed. */
  private formMetalComposite(a: GameEntity, b: GameEntity): void {
    const R = a.size.x / 2;
    const wdx = wrapDeltaX(a.position.x, b.position.x);
    const wdy = wrapDeltaY(a.position.y, b.position.y);

    // Orient the lattice so cell (0,2) (local +y) lies along a→b, then drop
    // the origin at the pair's mass centroid (midpoint of equal masses).
    a.rotation = Math.atan2(wdy, wdx) - Math.PI / 2;
    a.position.x += wdx * 0.5;
    a.position.y += wdy * 0.5;
    wrapPosition(a.position);

    const tm = a.mass + b.mass;
    a.velocity.x = (a.velocity.x * a.mass + b.velocity.x * b.mass) / tm;
    a.velocity.y = (a.velocity.y * a.mass + b.velocity.y * b.mass) / tm;
    a.mass = tm;
    a.health = (a.health ?? 0) + (b.health ?? 0);
    a.maxHealth = (a.maxHealth ?? 0) + (b.maxHealth ?? 0);

    a.metalLatticeR = R;
    a.metalCells = [{ ix: 0, iy: 0, up: true }, { ix: 0, iy: 2, up: false }];
    a.rotationSpeed = 0;
    a.linearDamping = METAL_ASSEMBLY.LINEAR_DAMPING;
    a.angularDamping = METAL_ASSEMBLY.ANGULAR_DAMPING;
    this.metalRecomputeBounds(a);
    b.active = false;
  }

  /** Recompute a composite's bounding size + convex collision polygon from
   *  its cells (all in the lattice frame, relative to the mass centroid). */
  private metalRecomputeBounds(comp: GameEntity): void {
    const R = comp.metalLatticeR!;
    const ux = (R * Math.sqrt(3)) / 2;
    const uy = R / 2;
    const cells = comp.metalCells!;
    let cmx = 0, cmy = 0;
    for (const c of cells) { cmx += c.ix * ux; cmy += c.iy * uy; }
    cmx /= cells.length; cmy /= cells.length;

    const pts: Vector2[] = [];
    let maxR2 = 0;
    for (const c of cells) {
      const ccx = c.ix * ux - cmx;
      const ccy = c.iy * uy - cmy;
      const verts: ReadonlyArray<readonly [number, number]> = c.up
        ? [[0, -R], [ux, uy], [-ux, uy]]
        : [[0, R], [ux, -uy], [-ux, -uy]];
      for (const v of verts) {
        const x = ccx + v[0];
        const y = ccy + v[1];
        pts.push({ x, y });
        const r2 = x * x + y * y;
        if (r2 > maxR2) maxR2 = r2;
      }
    }
    const diam = 2 * Math.sqrt(maxR2);
    comp.size = { x: diam, y: diam };

    let hull = metalConvexHull(pts);
    if (hull.length > 24) {
      const out: Vector2[] = [];
      const step = hull.length / 24;
      for (let i = 0; i < 24; i++) out.push(hull[Math.floor(i * step)]);
      hull = out;
    }
    comp.polygonPoints = hull;
  }

  private composeEntities(
    a: GameEntity,
    b: GameEntity,
    entities: GameEntity[],
    physics: PhysicsSystem,
  ): void {
    if (!a.active || !b.active) return;

    // Stage 5: shard-family entities are now all EntityType.STRUCTURE.
    // Distinguish by variant id rather than the legacy EntityTypes.
    const aVariant = shardVariantOf(a);
    const bVariant = shardVariantOf(b);
    const aIsNebShard = aVariant === 'nebula-shard';
    const bIsNebShard = bVariant === 'nebula-shard';
    // Mobile-shard family: rock-shard, glass-shard, and plastic-
    // shard ride the asteroid accretion path.  Tile variants have
    // shatter.kind=none here so they don't compose (only mobile
    // shards merge).
    const aIsAst = aVariant === 'rock-shard' || aVariant === 'glass-shard' || aVariant === 'plastic-shard';
    const bIsAst = bVariant === 'rock-shard' || bVariant === 'glass-shard' || bVariant === 'plastic-shard';

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

      // Bonds are same-material only, so a and b share a variant; the
      // larger by diameter is the survivor (carries variant id + glow).
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
      // tier-transition mechanic (glass→tile at GLASS_TIER_DIAMETER)
      // wants the shards to *grow* visibly until they condense into a
      // tile.  Density's shrinkFactor would have them shrinking
      // instead.  Plastic-shard self-merge follows the same rule,
      // though plastic.density is already disabled so this gate is
      // double-defence.
      const isGlassSelfMerge   = a.shardVariant === 'glass-shard'   && b.shardVariant === 'glass-shard';
      const isPlasticSelfMerge = a.shardVariant === 'plastic-shard' && b.shardVariant === 'plastic-shard';
      // Rock-dominant merges condense through the ROCK_CONDENSE grid
      // (denser-first, CONTINUOUS — never refused, which was the old
      // stall).  Any two rock(+absorbed) shards combine: mass is
      // conserved, the survivor keeps the larger input's size and bumps
      // DENSITY (smaller footprint per mass, darker, heavier), growing
      // size only once density caps.  When the combined mass would exceed
      // the top cell (largest size + max density) the shard condenses into
      // a STATIC rock-tile — the only tile-forming event, so tiles are
      // rare and appear only after a cluster is already consolidated
      // (they don't get smashed by surrounding shards mid-process).
      const isRockResult = dominantVariant === 'rock-shard';
      if (isRockResult) {
        newMass = a.mass + b.mass;
        const startTier = Math.max(nearestRockSizeTier(aDia), nearestRockSizeTier(bDia));
        const cell = deriveRockCell(startTier, newMass);
        if (cell === null) {
          // Overflow — clamp visuals to the top cell; the post-compose
          // mass check below transmutes to a tile (or retries next merge
          // if no hex is free).
          newDiam = ROCK_MAX_DIAMETER;
          if (density) newTier = density.maxSteps;
        } else {
          newDiam = ROCK_CONDENSE.DIAMETERS[cell.s - 1];
          if (density) newTier = Math.min(density.maxSteps, cell.d - 1);
        }
      } else if (density?.enabled && !isGlassSelfMerge && !isPlasticSelfMerge) {
        // Density-enabled self-merge compaction (shrink + tier).  With
        // same-material-only bonds this is the metal-shard path; it
        // refuses once the variant hits max tier.
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
        // Glass-self / plastic-self growth (area-conserving).
        newDiam = Math.sqrt(rA * rA + rB * rB) * 2;
        if (!isPlasticSelfMerge) {
          // sizeCap avoids glass shards larger than the map's free-spawn
          // maxSize.  Plastic self-merge grows indefinitely per user dir.
          const sizeCap = getRockShardFreeSpawn(this.currentMapType).maxSize;
          if (newDiam > sizeCap) return;
        }
        // Mass follows the dominant variant's area-based curve.
        newMass = dominantDef.spawn.sizeToMass(newDiam);
      }

      const glowA = a.powerupGlowColor;
      const glowB = b.powerupGlowColor;
      const newGlow = glowA && glowB ? blendHex(glowA, glowB) : (glowA ?? glowB);

      const composition: DropCompositionEntry[] = [
        ...(a.dropComposition ?? []),
        ...(b.dropComposition ?? []),
      ];

      // Regenerate polygon at new size — vertex count + jitter per
      // dominant variant.  Glass: 4–6 verts, blocky panel shape.
      // Plastic: 16 verts, near-circular (matches SHARD_SPAWN_SHAPE_
      // PLASTIC's collision-only round silhouette).  Default
      // (rock): 7–10 verts, jagged.
      const isTile     = dominantVariant === 'glass-shard';
      const isPlasticS = dominantVariant === 'plastic-shard';
      let numPts: number;
      let jitterK: number;
      let rMin: number;
      let rRange: number;
      if (isTile) {
        numPts = 4 + Math.floor(Math.random() * 3);
        jitterK = 0.25; rMin = 0.60; rRange = 0.55;
      } else if (isPlasticS) {
        numPts = 16;
        jitterK = 0.0; rMin = 0.98; rRange = 0.04;
      } else {
        numPts = 7 + Math.floor(Math.random() * 4);
        jitterK = 0.7; rMin = 0.60; rRange = 0.65;
      }
      const baseR   = (newDiam / 2) * 0.82;
      a.polygonPoints = this.generateShardPolygon(baseR, numPts, numPts, jitterK, rMin, rRange);

      a.shardVariant     = dominantVariant;
      a.powerupGlowColor = newGlow;
      a.size.x = newDiam; a.size.y = newDiam;
      a.mass   = newMass;
      a.position.x = nmx; a.position.y = nmy;
      a.velocity.x = nvx; a.velocity.y = nvy;
      // Plastic-shard sticky-bond anchor — re-pin to the merged
      // centroid so the new (larger) shard treats this spot as its
      // rest position.  Without this the survivor would still be
      // pulled toward the smaller party's old anchor.
      if (a.shardVariant === 'plastic-shard' && a.anchorX !== undefined) {
        a.anchorX = nmx; a.anchorY = nmy;
      }
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
      // Rock-shard tile transition.  Only once the survivor's mass would
      // exceed the top condensation cell (largest size + max density) does
      // it condense into a STATIC rock-tile at the nearest free hex —
      // leaving the dynamic collision system entirely (the hotspot win).
      // This is the sole tile-forming event, so tiles are rare and appear
      // only after a cluster is fully consolidated.  If no hex is free it
      // stays a max-tier shard and a later merge retries.
      if (a.shardVariant === 'rock-shard' && a.mass > ROCK_MAX_CELL_MASS) {
        this.tryTransmuteShardToTile(a, 'rock-shard', 'rock', entities, physics);
      }
      // Plastic-shard tier transition — DISABLED per user direction.
      // Plastic-shards merge into ever-larger plastic-shards
      // indefinitely; no transmute back to plastic-tile.  To restore,
      // uncomment the call (PLASTIC_TIER_DIAMETER likewise):
      //
      // if (a.shardVariant === 'plastic-shard' && a.size.x >= PLASTIC_TIER_DIAMETER) {
      //   this.tryTransmuteShardToTile(a, 'plastic-shard', 'plastic', entities, physics);
      // }
    }

    // Soft sparkle at the merge point for shard merges.
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
   * Plastic eats a glass-/rock-shard: the plastic-shard `eater` grows
   * by the `consumed` shard's area (newDiameter = √(d_e² + d_c²) so
   * the rendered circle's area gains exactly the consumed area) and
   * the consumed shard fades out inside it.  The eater stays put — it
   * engulfs the debris rather than drifting toward it.
   */
  private applyPlasticEat(eater: GameEntity, consumed: GameEntity): void {
    if (!eater.active || !consumed.active) return;
    if (consumed.mergeFadeTimer !== undefined) return; // already being eaten
    const de = eater.size.x;
    const dc = consumed.size.x;
    // Add only GROWTH_AREA_FACTOR of the consumed area, so growing a
    // given amount takes proportionally more eaten shards.
    const newDiam = Math.sqrt(de * de + dc * dc * PLASTIC_EAT.GROWTH_AREA_FACTOR);
    // Regenerate the near-circular 16-gon collision polygon at the new
    // size (same params the asteroid-accretion path uses for plastic).
    eater.polygonPoints = this.generateShardPolygon((newDiam / 2) * 0.82, 16, 16, 0, 0.98, 0.04);
    eater.size.x = newDiam;
    eater.size.y = newDiam;
    eater.mass = SHARD_VARIANTS['plastic-shard'].spawn.sizeToMass(newDiam);
    // Re-pin the soft-body anchor to the eater's (unchanged) centre.
    if (eater.anchorX !== undefined) {
      eater.anchorX = eater.position.x;
      eater.anchorY = eater.position.y;
    }
    // The consumed shard dissolves inside the eater rather than popping.
    this.startMergeFadeOut(consumed);
  }

  /**
   * Plastic "eats" a metal shard — but metal isn't fully absorbed.  It's
   * transmuted into PLASTIC_EAT.METAL_TO_ROCK.COUNT rock shards ejected
   * away from the plastic; the plastic grows only SLIGHTLY (PLASTIC_GROWTH
   * _FACTOR of the metal's area — most of the mass leaves as rock debris).
   * The new rocks carry the shatter grace timer so they don't instantly
   * re-condense, and the plastic repel pass then keeps shoving them clear.
   */
  private applyPlasticEatMetal(eater: GameEntity, consumed: GameEntity, entities: GameEntity[]): void {
    if (!eater.active || !consumed.active) return;
    if (consumed.mergeFadeTimer !== undefined) return; // already being eaten
    const { COUNT, SIZE_FACTOR, EJECT_SPEED } = PLASTIC_EAT.METAL_TO_ROCK;
    const rockDiam = Math.max(8, consumed.size.x * SIZE_FACTOR);
    // Outward direction = eater → consumed (push the debris away from
    // the plastic), toroidal-correct.
    let bx = wrapDeltaX(eater.position.x, consumed.position.x);
    let by = wrapDeltaY(eater.position.y, consumed.position.y);
    const blen = Math.sqrt(bx * bx + by * by) || 1;
    bx /= blen; by /= blen;
    for (let i = 0; i < COUNT; i++) {
      // Fan the ejected rocks around the outward direction.
      const a  = (Math.random() - 0.5) * Math.PI * 0.6;
      const ca = Math.cos(a), sa = Math.sin(a);
      const ux = bx * ca - by * sa;
      const uy = bx * sa + by * ca;
      const speed = EJECT_SPEED * (0.7 + Math.random() * 0.6);
      const ox = consumed.position.x + ux * rockDiam * 0.5;
      const oy = consumed.position.y + uy * rockDiam * 0.5;
      this.spawnRockShard(entities, ox, oy, rockDiam, ux * speed, uy * speed);
    }
    // The eater grows slightly — only PLASTIC_GROWTH_FACTOR of the
    // metal's area (most of the mass left as the ejected rock debris).
    const de = eater.size.x;
    const dc = consumed.size.x;
    const grown = Math.sqrt(de * de + dc * dc * PLASTIC_EAT.METAL_TO_ROCK.PLASTIC_GROWTH_FACTOR);
    eater.polygonPoints = this.generateShardPolygon((grown / 2) * 0.82, 16, 16, 0, 0.98, 0.04);
    eater.size.x = grown;
    eater.size.y = grown;
    eater.mass = SHARD_VARIANTS['plastic-shard'].spawn.sizeToMass(grown);
    if (eater.anchorX !== undefined) {
      eater.anchorX = eater.position.x;
      eater.anchorY = eater.position.y;
    }
    // Metal dissolves.
    this.startMergeFadeOut(consumed);
    this.particles.spawn(entities, consumed.position, 4, COLORS.ASTEROID, {
      speedMin: 1, speedMax: 4, sizeMin: 1, sizeMax: 2.5,
      lifetimeMin: 0.2, lifetimeMax: 0.45,
    });
  }

  /** Spawn a single free rock-shard at (x,y) with the given diameter and
   *  velocity.  Carries the shatter grace timer so the overlap-collapse
   *  pass leaves it alone long enough to scatter. */
  private spawnRockShard(entities: GameEntity[], x: number, y: number, diameter: number, vx: number, vy: number): void {
    const numPts = 7 + Math.floor(Math.random() * 4);
    const pts = this.generateShardPolygon((diameter / 2) * 0.82, numPts, numPts, 0.7, 0.60, 0.65);
    entities.push({
      id:            nextId('shard'),
      type:          EntityType.STRUCTURE,
      shardVariant:  'rock-shard',
      position:      { x, y },
      velocity:      { x: vx, y: vy },
      size:          { x: diameter, y: diameter },
      rotation:      Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * (1.5 / Math.max(1, diameter / 30)),
      color:         COLORS.ASTEROID,
      active:        true,
      health:        1,
      maxHealth:     1,
      mass:          SHARD_VARIANTS['rock-shard'].spawn.sizeToMass(diameter),
      polygonPoints: pts,
      collapseGraceTimer: getActiveShatterGraceDelay(),
    });
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
