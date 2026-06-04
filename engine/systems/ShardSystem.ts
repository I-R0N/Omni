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
import { getCollisionR, invalidateCollisionR } from '../entityCache';
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
  PLASTIC_SHARD_AUTOMATA,
  TILE_SNAP,
  PLASTIC_DENT_RECOVERY,
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
 * pair composes — unless `cohesionOnly` is set, in which case the
 * bond never matures into compose (it just persists for cohesion +
 * threshold-pull).  `cohesionMul` and `breakFactorMul` are
 * per-partner multipliers stored at bond formation: 'strong' tier
 * partners use a higher cohesion blend rate and a larger break
 * factor (slower to detach).
 */
interface BondEntry {
  a: GameEntity;
  b: GameEntity;
  timer: number;
  threshold: number;
  cohesionOnly?: boolean;
  cohesionMul?: number;
  breakFactorMul?: number;
}

// 'strong' bond-tier multipliers (plastic-shard ↔ glass / rock /
// metal / indestructible today).  cohesionMul scales the velocity-
// blend rate (base COHESION 4.0/s in tickBonds) so a strong pair
// locks to a shared velocity faster — reads as a rigid grip.
// breakFactorMul scales the break distance (base BREAK_FACTOR 1.5 ×
// contactDist) so a strong bond stretches much further before it
// snaps — reads as hard to pull apart.  Both bond-formation sites
// (runMergeBroadphase mobile↔mobile + runShardTileBondFormation
// shard↔tile) read these constants so the two paths can't drift.
const STRONG_COHESION_MUL = 3.0;
const STRONG_BREAK_FACTOR_MUL = 4.0;

// ── Metal triangular-lattice constants ──────────────────────────────────
// An UP cell (apex toward local -y) shares its 3 edges with DOWN cells at
// these integer key offsets; a DOWN cell mirrors them.  Cell key (ix,iy)
// maps to lattice-frame centroid (ix·R·√3/2, iy·R/2).  Neighbours always
// flip orientation, so the lattice is bipartite and every key has a fixed
// up/down parity once a seed is placed.
const METAL_UP_NEIGHBORS: ReadonlyArray<readonly [number, number]> = [[0, 2], [-1, -1], [1, -1]];
const METAL_DOWN_NEIGHBORS: ReadonlyArray<readonly [number, number]> = [[0, -2], [-1, 1], [1, 1]];

// The 6 cells of the single hexagon every composite builds, centred on the
// lattice vertex (1,1).  formMetalComposite seeds the canonical rhombus
// (0,0)+(0,2) — both members of this set — so every composite shares this
// frame: it fills these 6 slots, and the hexagon centroid is the vertex
// (1,1) → lattice point (R·√3/2, R/2), which is also the mass centroid once
// all 6 are present (so a completed composite's `position` IS the hexagon
// centre).  METAL_HEX_SIZE = 6 is "complete".
const METAL_HEX_SIZE = 6;
const METAL_HEX_CELLS: ReadonlyArray<{ ix: number; iy: number; up: boolean }> = [
  { ix: 0, iy: 0, up: true },
  { ix: 2, iy: 0, up: true },
  { ix: 1, iy: 3, up: true },
  { ix: 0, iy: 2, up: false },
  { ix: 2, iy: 2, up: false },
  { ix: 1, iy: -1, up: false },
];

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
   * DBG toggle (Pl shade) — gates the plastic-shard neighbour-contact
   * count computed in runMergeBroadphase.  When false, the count
   * isn't refreshed (RenderSystem then falls back to per-instance
   * shades), saving the extra plastic-only neighbour scan.  Default
   * OFF — matches the renderer default; toggled in sync via
   * GameEngine.togglePlasticAutomata.
   */
  public plasticAutomataEnabled: boolean = false;
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

  // ── Per-merge-pass scratch buffers ──────────────────────────────────────
  // runMergeBroadphase() used to instantiate a fresh Set + Map per call;
  // both are cleared in place each pass now so the only persistent cost
  // is the inner number[] cell arrays themselves.  At 60 fps on a dense
  // shard map that saves ~120 allocations / sec without any change to the
  // broadphase's behaviour.
  private _mergeBondedScratch: Set<GameEntity> = new Set();
  private _mergeGridScratch: Map<number, number[]> = new Map();

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
      if (METAL_ASSEMBLY.ENABLED) this.tickMetalAssembly(entities, physics);
    }
    // Plastic-shard dent recovery is unconditional (runMergePass
    // gates the broadphase passes; recovery is independent of that
    // cadence and runs every sim step so the lerp is smooth).
    this.tickPlasticDentRecovery(entities, dt);
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

    // Metal-composite decomposition — metal-shard.shatter.kind is
    // 'none', so by default a dying metal entity just disappears.
    // But a composite (metalCells.length >= 2) is conceptually N
    // bonded triangles, and the user expects it to fragment back
    // into those triangles on destruction.  decomposeMetalComposite
    // walks the lattice, spawns one loose triangle per cell at the
    // cell's world position, and returns — bypassing the powerlaw
    // pipeline entirely so we don't double-spawn.  Single-cell
    // metal-shards still fall through to the kind-check below and
    // die cleanly without children.
    if (parent.shardVariant === 'metal-shard'
     && parent.metalCells !== undefined
     && parent.metalCells.length >= 2) {
      this.decomposeMetalComposite(parent, entities);
      return;
    }

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

    // Merge-count override — when the parent was built up by self-
    // merge (mergeCount > 1), break it back into roughly the same
    // number of base-sized fragments that composed it.  Damage-norm
    // and size-keyed count are ignored so the invariant "N base
    // shards in, N fragments out" holds regardless of how hard the
    // killing hit was.  A small ±1 wobble keeps the fragment count
    // from feeling mechanically uniform on repeated breaks.  Applies
    // to every variant going through shatterAsteroidStyle (rock-
    // shard / glass-shard / plastic-shard); base shards (mergeCount
    // === 1 or undefined) fall through to the existing size-keyed
    // and damage-based formulas.
    //
    // Rock-shard override — large rocks ALWAYS break into a
    // satisfying swarm regardless of merge history.  Count is the
    // MAX of (merges ± wobble) and (size / 40), so even a base
    // rock that condensed through ROCK_CONDENSE without going
    // through compose ends up with proportional debris instead of
    // 2-3 chunks.  Capped at 30 so top-tier boulders don't flood
    // the field.
    let count: number;
    const sizeLevels = parentVariant.shatter.shatterCountBySize;
    const merges = parent.mergeCount ?? 1;
    const isRockShatter = parent.shardVariant === 'rock-shard';
    if (isRockShatter) {
      const sizeBased = Math.min(30, Math.max(2, Math.floor(parent.size.x / 40)));
      const wobble = merges > 1 ? Math.floor(Math.random() * 3) - 1 : 0;
      const mergeBased = merges > 1 ? Math.max(2, merges + wobble) : 2;
      count = Math.max(mergeBased, sizeBased);
    } else if (merges > 1) {
      const wobble = Math.floor(Math.random() * 3) - 1; // -1, 0, +1
      count = Math.max(2, merges + wobble);
    } else if (sizeLevels && sizeLevels.length > 0) {
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
    if (merges > 1 || isRockShatter) {
      // Merged shard OR rock-shatter — even area-per-fragment so
      // every child lands at roughly base-shard size, regardless of
      // how many merges or how big the parent is.  Area-conserving
      // composes (glass-self, plastic-self) recover the base
      // diameter directly via sqrt(parentArea / N); rock-condense
      // merges shrink the survivor via density tiers, so its
      // parentArea / N is smaller than the original base —
      // fragments come out slightly under base size, which reads
      // correctly for a "denser cluster bursting apart."  No MIN_
      // SIZE filter pass since the invariant guarantees fragments
      // sit at roughly base size.
      const parentArea = parent.size.x * parent.size.x;
      const childSize = Math.sqrt(parentArea / count);
      sizes = Array.from({ length: count }, () => childSize);
    } else if (useFraction) {
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

    // Rock-only: pre-compute per-child density tiers as a mix around
    // the parent's tier (random ±2 clamped to valid range), then
    // scale each child's mass and HP by the chosen tier.  Reads as
    // "the parent's density distributes unevenly across fragments"
    // — some chunks are softer than the parent, some denser, and
    // the denser ones take more hits to crack open.  Non-rock
    // children leave densityTier undefined and use the standard
    // sizeToMass formula unchanged.
    let childDensityTiers: number[] | null = null;
    if (isRockShatter) {
      const parentTier = parent.densityTier ?? 0;
      const maxTier = ROCK_CONDENSE.DENSITY_MULT.length - 1;
      childDensityTiers = new Array(sizes.length);
      for (let i = 0; i < sizes.length; i++) {
        const offset = Math.floor(Math.random() * 5) - 2; // -2..+2
        childDensityTiers[i] = Math.max(0, Math.min(maxTier, parentTier + offset));
      }
    }

    for (let i = 0; i < sizes.length; i++) {
      const newSize = sizes[i];
      const baseHp  = newSize > 30 ? 2 : 1;
      // Density-aware mass + HP for rock children — sqrt(tier + 1)
      // scales HP gently so even top-tier rocks stay breakable
      // (tier 24 ≈ 5× HP); mass scales by the full DENSITY_MULT so
      // dense fragments feel heavy on impact and resist push.
      let childMass = childSpawn.sizeToMass(newSize);
      let hp = baseHp;
      let densityTier: number | undefined = undefined;
      if (childDensityTiers !== null) {
        densityTier = childDensityTiers[i];
        childMass *= ROCK_CONDENSE.DENSITY_MULT[densityTier];
        hp = Math.max(1, Math.round(baseHp * Math.sqrt(densityTier + 1)));
      }

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
      // Plastic-shard sub-shards re-roll their shade per-instance so
      // each generation has visible variation; everything else
      // inherits the parent's colour.
      const childColor = childVariant.id === 'plastic-shard'
        ? randomPlasticShardShade()
        : (isTile ? parent.color : (parent.color || COLORS.ASTEROID));

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
        mass:          childMass,
        // Rock children only: densityTier carries the chosen mix
        // tier so the renderer picks up the density tint and any
        // future merge / shatter respects the inherited density.
        // densityCachedTint left undefined so the renderer
        // recomputes on first draw.
        densityTier,
        sprite:        parent.sprite,
        // Optional per-entity damping from the variant's spawn shape
        // — undefined for variants that drift naturally; metal-
        // assembly uses these.
        linearDamping:  childSpawn.linearDamping,
        angularDamping: childSpawn.angularDamping,
        restSpeed:      childSpawn.restSpeed,
        restSpin:       childSpawn.restSpin,
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
    const parentRadius = getCollisionR(parent);
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

      // Per-bond break-factor multiplier — 'strong' tier partners
      // (set at formation time) tolerate larger separation before
      // the bond snaps.
      const breakFactor = BREAK_FACTOR * (bond.breakFactorMul ?? 1);
      if (dist > contactDist * breakFactor) continue; // bond broken

      // Velocity cohesion: nudge both toward shared momentum centre.
      // Gated by applyCohesion so the blend runs only on the same
      // cadence as separation — without that pacing, cohesion locks
      // bonded shards to a shared velocity / position while
      // separation is skipped, and clusters collapse to a point.
      //
      // Static-partner case (a.mass === Infinity or b.mass === Infinity):
      // the tile acts as an anchor — only the dynamic side's velocity
      // bleeds toward zero (the tile's "shared velocity").  The
      // mass-weighted formula would NaN with ∞, so we branch.
      if (applyCohesion) {
        const cohesionRate = COHESION * (bond.cohesionMul ?? 1);
        const blend        = Math.min(1, cohesionRate * dt);
        if (a.mass === Infinity && b.mass !== Infinity) {
          b.velocity.x += (0 - b.velocity.x) * blend;
          b.velocity.y += (0 - b.velocity.y) * blend;
        } else if (b.mass === Infinity && a.mass !== Infinity) {
          a.velocity.x += (0 - a.velocity.x) * blend;
          a.velocity.y += (0 - a.velocity.y) * blend;
        } else {
          const totalMass = a.mass + b.mass;
          const sharedVx  = (a.velocity.x * a.mass + b.velocity.x * b.mass) / totalMass;
          const sharedVy  = (a.velocity.y * a.mass + b.velocity.y * b.mass) / totalMass;
          a.velocity.x   += (sharedVx - a.velocity.x) * blend;
          a.velocity.y   += (sharedVy - a.velocity.y) * blend;
          b.velocity.x   += (sharedVx - b.velocity.x) * blend;
          b.velocity.y   += (sharedVy - b.velocity.y) * blend;
        }
      }

      // Cohesion-only bonds (today: plastic-shard) skip the merge
      // pipeline entirely — no timer accumulation, no compose call.
      // Re-push and continue.
      if (bond.cohesionOnly) {
        this.bonds[writeIdx++] = bond;
        continue;
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
    // keeps the last brightness) — no flicker, no snap.
    const cosmeticInterval = Math.max(1, this.perfController
        ? this.perfController.effectiveInterval('plasticCosmetic') | 0
        : 1);
    const runCosmetic = (this.plasticCosmeticTick % cosmeticInterval) === 0;
    this.plasticCosmeticTick++;
    // Track which entities are currently in active stick-bonds so
    // the bond-formation pass doesn't double-bond.  Scratch Set is reused
    // across passes — cleared in place — to skip a per-frame allocation.
    const bonded = this._mergeBondedScratch;
    bonded.clear();
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
      if (e.shardVariant === 'plastic-shard') {
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
    // Scratch grid is reused across passes.  Inner cell arrays are
    // cleared in place rather than dropped so successive frames retain
    // their array backing storage — the Map only carries the dense
    // header.  At ~1k cells/frame on the densest tile maps this skips
    // ~1k inner-array allocations per call.
    const grid = this._mergeGridScratch;
    for (const cell of grid.values()) cell.length = 0;
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
        const aR = getCollisionR(a);
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
              const bR = getCollisionR(b);
              const reach = (aR + bR) * buf;
              if (dx * dx + dy * dy <= reach * reach) count++;
            }
          }
        }
        a.plasticNeighborCount = count;
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
      const aR = getCollisionR(a);

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
              const pullRange  = aVariant!.merge.pullRange ?? CELL;
              const pullRangeSq = pullRange * pullRange;
              const pullInner    = aVariant!.merge.pullInnerRange ?? 0;
              const pullInnerSq  = pullInner * pullInner;
              const targetCooldownOk = (b.nebulaMergeCooldown ?? 0) <= 0;
              const matchesPull = aVariant!.merge.attractedTo !== 'none'
                && this.selects(aVariant!.merge.attractedTo, bVariantId, aVariantId!);
              // Annular gate: pull is suppressed below pullInnerRange so
              // the gravity hands off to bond cohesion at close range
              // instead of fighting it.  Outer cap stays at pullRange.
              // pullInnerRange undefined → 0 → today's behaviour (full
              // range from contact to outer).
              if (matchesPull && targetCooldownOk
                  && distSq >= pullInnerSq
                  && distSq <= pullRangeSq
                  && distSq < bestPullDistSq) {
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
            // by size and the rule's thresholdScale.
            const baseTime   = pullerVariant.merge.bondTimeSeconds ?? 10;
            const sizeRef    = pullerVariant.merge.bondTimeSizeRef   ?? 20;
            const sizePower  = pullerVariant.merge.bondTimeSizePower ?? 1.5;
            const avgSize    = (a.size.x + b.size.x) * 0.5;
            const sizeRatio  = sizeRef > 0 ? Math.max(1, avgSize / sizeRef) : 1;
            const baseScaled = baseTime * Math.pow(sizeRatio, sizePower);
            const threshold  = baseScaled * (rule.thresholdScale ?? 1);

            // Per-partner config (today: plastic-shard with cohesion-
            // only bonds and 'strong' tier for glass).  When set, the
            // entry overrides the bond's compose path + cohesion /
            // break factor.  Lookup is O(N) over the partner list but
            // N is small (≤10 typical) and only walked on formation.
            const partnerCfg = pullerVariant.merge.bondPartners
              ?.find(e => e.partner === partnerId);
            const cohesionOnly = partnerCfg?.cohesionOnly === true;
            const strong       = partnerCfg?.strength === 'strong';

            this.bonds.push({
              a, b, timer: 0, threshold,
              cohesionOnly: cohesionOnly || undefined,
              cohesionMul:    strong ? STRONG_COHESION_MUL : undefined,
              breakFactorMul: strong ? STRONG_BREAK_FACTOR_MUL : undefined,
            });
            bondedThisFrame.add(a);
            bondedThisFrame.add(b);

            // Zero-threshold guard: a variant configured with
            // bondTimeSeconds 0 composes on contact in the same frame
            // — unless cohesionOnly, which never composes.  No variant
            // sets bondTimeSeconds 0 today.
            if (threshold <= 0 && !cohesionOnly) {
              this.composeEntities(a, b, entities, _physics);
              // Drop the just-pushed bond (it's already resolved).
              this.bonds.pop();
            }
          }
        }
      }

      // Apply pull force toward the chosen target (if any).  Both loose
      // triangles AND composites seek now that composite ↔ composite merging
      // exists: the pull target rule (bR ≥ aR) makes each piece drift toward
      // a larger-or-equal metal body, so the biggest local cluster acts as an
      // anchor and smaller pieces/clusters accrete onto it.  A COMPLETED
      // hexagon (6 cells) stops actively seeking — it's floating toward its
      // grid snap, not still assembling, which also keeps it eligible to
      // settle/sleep out of the dynamic-load signal.  Metal triangles still in
      // their post-break grace aren't pulled, so they float free for the delay
      // before assembly.
      const metalInGrace = a.shardVariant === 'metal-shard' && (a.collapseGraceTimer ?? 0) > 0;
      const completedHexagon = a.metalCells !== undefined
        && a.metalCells.length >= METAL_HEX_SIZE;
      if (bestPullTarget && wantsPull && !metalInGrace && !completedHexagon) {
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

    // ── Shard ↔ static-tile bond formation ────────────────────────
    // The main bond loop above only walks mobile-shard candidates, so
    // a variant whose bondsWith includes tile partners (today: plastic-
    // shard, which sticks to glass/rock/metal/indestructible/plastic
    // tiles) needs a side-channel scan against the static grid.  Only
    // variants that actually list tiles in bondPartners benefit, so
    // the outer check short-circuits when no bond candidate is present.
    if (this.shardBondingEnabled) {
      this.runShardTileBondFormation(candidates, bonded, bondedThisFrame, _physics);
    }

    // Hot-spot collapse: snap overlapping glass-shard stacks (which
    // the throttled separation can't disperse) into static tiles.  Runs
    // last so shards consumed by the pull/bond passes above are already
    // excluded.
    if (HOTSPOT_COLLAPSE.ENABLED) this.collapseHotspots(entities, _physics, candidates);
  }

  /**
   * Form cohesion bonds between mobile shards and static tiles.  Walks
   * each mobile candidate whose variant has a `bondPartners` entry for
   * a tile variant; queries the static grid for nearby tiles via
   * `PhysicsSystem.forEachStaticTileNear`; forms a bond when contact
   * distance is hit.  Per-partner config (cohesionOnly / strength) is
   * applied the same way as the mobile-mobile path.  Today only
   * plastic-shard uses this — for every variant else the inner loop
   * short-circuits on the bondPartners lookup.
   */
  private runShardTileBondFormation(
    candidates: GameEntity[],
    bonded: Set<GameEntity>,
    bondedThisFrame: Set<GameEntity>,
    _physics: PhysicsSystem,
  ): void {
    const CONTACT_BUFFER = 4;
    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      if (!a.active) continue;
      const aVariantId = shardVariantOf(a);
      if (aVariantId === null) continue;
      const aVariant = SHARD_VARIANTS[aVariantId];
      // Cheap gate: skip variants with no per-partner tile entries.
      // For the only consumer today (plastic-shard) this still walks
      // every plastic-shard, but stops here for every other variant.
      if (!aVariant.merge.bondPartners) continue;
      if (aVariant.merge.bondsWith === 'none') continue;
      if (bonded.has(a) || bondedThisFrame.has(a)) continue;
      if ((a.nebulaMergeCooldown ?? 0) > 0) continue;

      const aR = getCollisionR(a);
      _physics.forEachStaticTileNear(a.position.x, a.position.y, (tile) => {
        if (bondedThisFrame.has(a)) return;
        if (tile.mass !== Infinity) return;             // dynamic — handled by main loop
        const tileVariantId = shardVariantOf(tile);
        if (tileVariantId === null) return;
        // bondsWith gate (variant selector).
        if (!this.selects(aVariant.merge.bondsWith, tileVariantId, aVariantId)) return;
        // Per-partner config.  Lack of an entry → no bond for this pair.
        const cfg = aVariant.merge.bondPartners!.find(e => e.partner === tileVariantId);
        if (!cfg) return;
        // Contact check.  Tile collision radius approximated from size.x.
        const dx = wrapDeltaX(a.position.x, tile.position.x);
        const dy = wrapDeltaY(a.position.y, tile.position.y);
        const tR = getCollisionR(tile);
        const contactDist = aR + tR + CONTACT_BUFFER;
        if (dx * dx + dy * dy > contactDist * contactDist) return;

        const baseTime   = aVariant.merge.bondTimeSeconds ?? 10;
        const cohesionOnly = cfg.cohesionOnly === true;
        const strong       = cfg.strength === 'strong';
        this.bonds.push({
          a, b: tile, timer: 0, threshold: baseTime,
          cohesionOnly: cohesionOnly || undefined,
          cohesionMul:    strong ? STRONG_COHESION_MUL : undefined,
          breakFactorMul: strong ? STRONG_BREAK_FACTOR_MUL : undefined,
        });
        bondedThisFrame.add(a);
        bondedThisFrame.add(tile);
      });
    }
  }

  /**
   * Hot-spot collapse — cure for overlapping shard piles the throttled
   * shard-pair separation can't keep apart (they stack and pulse in phase
   * with the skip interval).  Buckets active glass-shards into a fine,
   * tile-sized grid; any cell with >= MIN_COUNT shards of a material is
   * a real overlap stack (self-gating: at low load separation keeps cells
   * from filling).  Each stack condenses into ONE static tile at the
   * nearest free hex (surplus shards fade out).  Capped at MAX_TILES_PER
   * _PASS per pass.  Rock-shards stay shards forever (ROCK_CONDENSE grid);
   * plastic-shards opted out with the plastic-revert; metal triangles
   * reassemble via tickMetalAssembly instead.
   */
  private collapseHotspots(
    entities: GameEntity[],
    physics: PhysicsSystem,
    candidates: GameEntity[],
  ): void {
    const { CELL, MIN_COUNT, MAX_TILES_PER_PASS,
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
      const isGlass = v === 'glass-shard';
      // Metal triangles reassemble into a metal-tile once enough pack a cell.
      const isMetal = METAL_ENABLED && v === 'metal-shard';
      if (!isGlass && !isMetal) continue;
      const key = keyFor(Math.floor(c.position.x / CELL), Math.floor(c.position.y / CELL));
      let cell = grid.get(key);
      if (!cell) { cell = []; grid.set(key, cell); }
      cell.push(i);
    }

    let minAny = MIN_COUNT;
    if (METAL_ENABLED) minAny = Math.min(minAny, METAL_MIN_COUNT);
    let tilesMade = 0;
    for (const idxs of grid.values()) {
      if (tilesMade >= MAX_TILES_PER_PASS) break;
      if (idxs.length < minAny) continue;
      let glassCount = 0, metalCount = 0;
      let glassHost = -1, metalHost = -1;
      for (let k = 0; k < idxs.length; k++) {
        const e = candidates[idxs[k]];
        const sv = e.shardVariant;
        if (sv === 'glass-shard') {
          glassCount++;
          if (glassHost < 0 || e.size.x > candidates[glassHost].size.x) glassHost = idxs[k];
        } else if (sv === 'metal-shard') {
          metalCount++;
          if (metalHost < 0 || e.size.x > candidates[metalHost].size.x) metalHost = idxs[k];
        }
      }
      if (METAL_ENABLED && metalCount >= METAL_MIN_COUNT &&
          this.collapseStack(candidates, idxs, metalHost, 'metal-shard', 'metal', entities, physics)) {
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
    invalidateCollisionR(entity);
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
  /**
   * Unified post-compose tile snap for plastic + glass.  Called at
   * the end of every successful compose for the survivor.  Snaps
   * when the survivor's diameter has grown past TILE_SNAP.DIAMETER_
   * MULT × sqrt(HEX_AREA) AND its per-substep speed² has settled
   * below TILE_SNAP.REST_SPEED_SQ.  On snap: spawns the static tile
   * via buildTileAtNearestFreeHex and releases TILE_SNAP.DEBRIS_
   * COUNT debris shards of the survivor's variant — at the 2× area
   * threshold the merged shard carried roughly 4 × HEX_AREA worth
   * of mass, so 75 % is overflow released as the debris burst.
   */
  private trySnapToTile(
    survivor: GameEntity,
    shardVariant: 'plastic-shard' | 'glass-shard',
    material: 'plastic' | 'glass',
    entities: GameEntity[],
    physics: PhysicsSystem,
  ): void {
    if (survivor.shardVariant !== shardVariant) return;
    if ((survivor.mergeFadeTimer ?? 0) > 0) return;
    const minDiam = GLASS_TIER_DIAMETER * TILE_SNAP.DIAMETER_MULT;
    if (survivor.size.x < minDiam) return;
    const vx = survivor.velocity.x, vy = survivor.velocity.y;
    if (vx * vx + vy * vy >= TILE_SNAP.REST_SPEED_SQ) return;
    const snapPos = { x: survivor.position.x, y: survivor.position.y };
    if (!this.tryTransmuteShardToTile(survivor, shardVariant, material, entities, physics)) return;
    this.spawnSnapDebris(snapPos, shardVariant, entities);
  }

  /**
   * Plastic dent recovery (tiles + shards) — per-dent snap-back.
   * applyDentStep pushes one entry per hit onto e.plasticDentHistory
   * holding the polygon delta that dent applied (post - pre, after
   * the preserve-bounding-radius rescale).  Each entry ticks down
   * its own timer; when one expires, the recovery pass subtracts
   * its delta from polygonPoints and drops the entry.  Three hits
   * in quick succession produce three snap-backs spaced DELAY_
   * SECONDS apart — no smooth lerp, no per-entity lull.
   *
   * Polygon mutation invalidates the SAT cache so collision picks
   * up the updated edge normals.  Static tiles also have a baked
   * world-canvas stamp; flag _staticCached false so RenderSystem
   * re-stamps with the recovered outline.
   */
  private tickPlasticDentRecovery(entities: GameEntity[], dt: number): void {
    if (dt <= 0) return;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!e.active) continue;
      if (e.shardVariant !== 'plastic-shard' && e.shardVariant !== 'plastic-tile') continue;
      const history = e.plasticDentHistory;
      if (history === undefined || history.length === 0) continue;
      const pts = e.polygonPoints;
      if (!pts) continue;
      const isTile = e.shardVariant === 'plastic-tile';
      let writeIdx = 0;
      let mutated = false;
      let healed  = 0;
      for (let h = 0; h < history.length; h++) {
        const entry = history[h];
        entry.timer -= dt;
        if (entry.timer <= 0 && entry.delta.length === pts.length) {
          // Snap back: subtract this dent's delta from the current
          // polygon so the vertex that was pulled in springs out by
          // the same amount it moved.  Other dents on the history
          // stay intact and continue counting down independently.
          for (let j = 0; j < pts.length; j++) {
            pts[j].x -= entry.delta[j].x;
            pts[j].y -= entry.delta[j].y;
          }
          mutated = true;
          healed++;
          // Skip writing — entry retires here.
        } else {
          history[writeIdx++] = entry;
        }
      }
      history.length = writeIdx;
      // Plastic-tile health + colour recovery — one dent retire =
      // one HP back, capped at maxHealth.  Each hit decremented HP
      // by 1 and bumped tile.color toward plasticTileTargetColor
      // (applyDentStep), so reversing N dents recovers N HP and
      // re-lerps the colour from current toward original by the new
      // hpRatio.  Shards don't get HP recovery — they're free-
      // floating debris and just visually un-dent.
      if (isTile && healed > 0) {
        const maxHP = e.maxHealth ?? 1;
        e.health = Math.min(maxHP, e.health + healed);
        if (e.plasticTileOriginalColor !== undefined
         && e.plasticTileTargetColor   !== undefined) {
          const hpRatio = Math.max(0, Math.min(1, e.health / maxHP));
          e.color = lerpHexColors(
            e.plasticTileOriginalColor,
            e.plasticTileTargetColor,
            1 - hpRatio,
          );
        }
      }
      if (mutated) {
        e._satCacheAxes = undefined;
        if (e._staticCached === true) e._staticCached = false;
      }
    }
  }

  /**
   * Spawn the surplus-material burst released when a merged shard
   * snaps into a static tile.  TILE_SNAP.DEBRIS_COUNT shards of the
   * supplied variant at DEBRIS_DIAMETER, spawned at the snap
   * position with small outward velocities so they spray off the
   * materialising tile.  Polygon + colour follow the variant's
   * spawn config so plastic and glass debris read as base shards
   * of their respective materials.
   */
  private spawnSnapDebris(
    pos: Vector2,
    variant: 'plastic-shard' | 'glass-shard',
    entities: GameEntity[],
  ): void {
    const variantDef = SHARD_VARIANTS[variant];
    const childSpawn = variantDef.spawn;
    const size = TILE_SNAP.DEBRIS_DIAMETER;
    const mass = childSpawn.sizeToMass(size);
    const count = TILE_SNAP.DEBRIS_COUNT;
    const baseR = (size / 2) * 0.8;
    const idPrefix = variant === 'plastic-shard' ? 'plastic_snap_debris' : 'glass_snap_debris';
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 1.0 + Math.random() * 1.5;
      const points = this.generateShardPolygon(
        baseR,
        childSpawn.polyVerticesMin,
        childSpawn.polyVerticesMax,
        childSpawn.angleJitter,
        childSpawn.radiusMin,
        childSpawn.radiusRange,
        childSpawn.polyVerticesOptions,
      );
      entities.push({
        id:            nextId(idPrefix),
        type:          EntityType.STRUCTURE,
        shardVariant:  variant,
        position:      { x: pos.x + Math.cos(angle) * size * 0.5, y: pos.y + Math.sin(angle) * size * 0.5 },
        velocity:      { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        size:          { x: size, y: size },
        rotation:      Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 2,
        color:         variant === 'plastic-shard' ? randomPlasticShardShade() : COLORS.STRUCTURE,
        active:        true,
        health:        1,
        maxHealth:     1,
        polygonPoints: points,
        mass,
        collapseGraceTimer: getActiveShatterGraceDelay(),
      });
    }
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

    if (!this.buildTileAtNearestFreeHex(
      shard.position.x, shard.position.y, material, entities, physics,
    )) return false;

    // Source shard fades out — the tile materialises while the shard
    // dissolves on top of it.
    this.startMergeFadeOut(shard);
    return true;
  }

  /**
   * Snap-and-build: place a static tile of `material` (mass ∞) on the
   * nearest free hex cell to world `(wx, wy)` — the containing hex + its 6
   * neighbours, sorted by distance, first cell clear of static geometry
   * wins.  Returns false (and builds nothing) if every candidate is
   * occupied, so callers can retry later.  Shared by the shard tier
   * transitions and metal-hexagon crystallization.
   */
  private buildTileAtNearestFreeHex(
    wx: number,
    wy: number,
    material: StructureVariant,
    entities: GameEntity[],
    physics: PhysicsSystem,
  ): boolean {
    const origin = pixelToHexCoord(wx, wy);
    const candidates: { c: number; r: number; distSq: number }[] = [];
    const pushCandidate = (c: number, r: number) => {
      const p = hexCoordToPixel(c, r);
      const dx = wrapDeltaX(wx, p.x);
      const dy = wrapDeltaY(wy, p.y);
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
  private tickMetalAssembly(entities: GameEntity[], physics: PhysicsSystem): void {
    const composites: GameEntity[] = [];
    const loose: GameEntity[] = [];
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!e.active || e.shardVariant !== 'metal-shard') continue;
      if (e.metalCells !== undefined) composites.push(e); else loose.push(e);
    }
    if (loose.length === 0 && composites.length === 0) return;

    const R = HEX_SIZE / Math.sqrt(3);
    const SNAP = METAL_ASSEMBLY.SNAP_RANGE_R * R;
    const FORM = METAL_ASSEMBLY.FORM_RANGE_R * R;

    // Pass 1 — loose → composite.  A freshly-shattered triangle is left to
    // float free until its post-break grace (collapseGraceTimer) expires —
    // that's the delay before it starts snapping onto anything.  Composites
    // with empty lattice slots take the triangle as a new visible cell
    // (growMetalComposite); composites already at 6 cells but still under
    // the TILE_SNAP.METAL_EXCESS_CELLS cap absorb the triangle as invisible
    // mass (metalExcessCells counter), accumulating toward the 2 × HEX_
    // AREA snap threshold.
    for (let i = 0; i < loose.length; i++) {
      const l = loose[i];
      if (!l.active || l.metalCells !== undefined) continue;
      if ((l.collapseGraceTimer ?? 0) > 0) continue;
      let bestLattice: GameEntity | null = null;
      let bestLatticeTarget: { ix: number; iy: number; up: boolean; d2: number } | null = null;
      let bestExcess: GameEntity | null = null;
      let bestExcessD2 = Infinity;
      for (let c = 0; c < composites.length; c++) {
        const comp = composites[c];
        if (!comp.active) continue;
        const cells = comp.metalCells!;
        const dx = wrapDeltaX(comp.position.x, l.position.x);
        const dy = wrapDeltaY(comp.position.y, l.position.y);
        const reach = comp.size.x * 0.5 + SNAP;
        const distSq = dx * dx + dy * dy;
        if (distSq > reach * reach) continue;
        if (cells.length < METAL_HEX_SIZE) {
          const t = this.nearestMetalHexSlot(comp, l.position.x, l.position.y);
          if (t && (bestLatticeTarget === null || t.d2 < bestLatticeTarget.d2)) {
            bestLattice = comp;
            bestLatticeTarget = t;
          }
        } else if ((comp.metalExcessCells ?? 0) < TILE_SNAP.METAL_EXCESS_CELLS) {
          if (distSq < bestExcessD2) {
            bestExcess = comp;
            bestExcessD2 = distSq;
          }
        }
      }
      if (bestLattice && bestLatticeTarget) {
        this.growMetalComposite(bestLattice, l, bestLatticeTarget);
      } else if (bestExcess) {
        bestExcess.metalExcessCells = (bestExcess.metalExcessCells ?? 0) + 1;
        bestExcess.mass += l.mass;
        l.active = false;
      }
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
      if ((l.collapseGraceTimer ?? 0) > 0) continue;
      const k = gkey(Math.floor(l.position.x / CELL), Math.floor(l.position.y / CELL));
      let b = grid.get(k);
      if (!b) { b = []; grid.set(k, b); }
      b.push(i);
    }
    const FORM2 = FORM * FORM;
    for (let i = 0; i < loose.length; i++) {
      const a = loose[i];
      if (!a.active || a.metalCells !== undefined) continue;
      if ((a.collapseGraceTimer ?? 0) > 0) continue;
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

    // Pass 2b — composite + composite.  When two INCOMPLETE composites'
    // bounds overlap, pour the smaller's triangles into the larger's empty
    // hexagon slots (overflow released as loose), so partial hexagons snap
    // together.  Completed hexagons (floating, about to snap) sit out.
    // Coarse grid sized to the largest composite so the 3×3 neighbour scan
    // can't miss an overlap.
    let cMaxSize = 2 * R;
    for (const c of composites) if (c.active && c.size.x > cMaxSize) cMaxSize = c.size.x;
    const CCELL = cMaxSize;
    const CCOLS = Math.max(1, Math.ceil(MAP_WIDTH / CCELL));
    const CROWS = Math.max(1, Math.ceil(MAP_HEIGHT / CCELL));
    const ckey = (cx: number, cy: number) => {
      const x = ((cx % CCOLS) + CCOLS) % CCOLS;
      const y = ((cy % CROWS) + CROWS) % CROWS;
      return x * CROWS + y;
    };
    const incomplete = (e: GameEntity) =>
      e.active && e.metalCells !== undefined && e.metalCells.length < METAL_HEX_SIZE;
    const cgrid = new Map<number, number[]>();
    for (let i = 0; i < composites.length; i++) {
      const c = composites[i];
      if (!incomplete(c)) continue;
      const k = ckey(Math.floor(c.position.x / CCELL), Math.floor(c.position.y / CCELL));
      let b = cgrid.get(k); if (!b) { b = []; cgrid.set(k, b); } b.push(i);
    }
    const OVERLAP = METAL_ASSEMBLY.MERGE_OVERLAP_FACTOR;
    for (let i = 0; i < composites.length; i++) {
      const a = composites[i];
      if (!incomplete(a)) continue;
      const acx = Math.floor(a.position.x / CCELL);
      const acy = Math.floor(a.position.y / CCELL);
      for (let oy = -1; oy <= 1 && incomplete(a); oy++) {
        for (let ox = -1; ox <= 1 && incomplete(a); ox++) {
          const cell = cgrid.get(ckey(acx + ox, acy + oy));
          if (!cell) continue;
          for (const j of cell) {
            if (j === i) continue;
            const b = composites[j];
            if (!incomplete(b)) continue;
            const dx = wrapDeltaX(a.position.x, b.position.x);
            const dy = wrapDeltaY(a.position.y, b.position.y);
            const reach = (a.size.x + b.size.x) * 0.5 * OVERLAP;
            if (dx * dx + dy * dy > reach * reach) continue;
            // Larger is the host; smaller is absorbed.
            if (a.metalCells!.length >= b.metalCells!.length) {
              this.mergeMetalComposites(a, b, entities);
            } else {
              this.mergeMetalComposites(b, a, entities);
              break; // `a` was consumed — stop scanning on its behalf
            }
          }
        }
      }
    }

    // Pass 3 — composites that have completed their lattice AND soaked
    // METAL_EXCESS_CELLS worth of additional mass AND settled below the
    // speed gate snap to the nearest free grid hex.  Asleep + float-
    // timer gates were dropped — speed² < TILE_SNAP.REST_SPEED_SQ is
    // the single rest criterion, matching plastic + glass.  A hexagon
    // that's still drifting keeps absorbing (excess cap permitting)
    // until both gates are clean on the same tick.
    for (let c = 0; c < composites.length; c++) {
      const comp = composites[c];
      if (!comp.active || comp.metalCells === undefined) continue;
      if (comp.metalCells.length < METAL_HEX_SIZE) continue;
      if ((comp.metalExcessCells ?? 0) < TILE_SNAP.METAL_EXCESS_CELLS) continue;
      const vx = comp.velocity.x, vy = comp.velocity.y;
      if (vx * vx + vy * vy >= TILE_SNAP.REST_SPEED_SQ) continue;
      this.snapHexagonToGrid(comp, entities, physics);
    }
  }

  /**
   * Snap a complete-plus-excess composite onto the nearest free grid
   * hex as a static metal tile, then release its 6 visible lattice
   * triangles as overflow debris (mass-conserving: composite absorbed
   * 2 × HEX_AREA, tile takes 1 ×, debris takes 1 ×).  If every
   * candidate grid cell is occupied the snap is deferred — the
   * composite stays alive and retries on a later tick.
   */
  private snapHexagonToGrid(
    comp: GameEntity,
    entities: GameEntity[],
    physics: PhysicsSystem,
  ): void {
    if (!this.buildTileAtNearestFreeHex(comp.position.x, comp.position.y, 'metal', entities, physics)) return;
    // Release the 6 lattice cells as loose triangles — same world
    // positions + per-cell orientation the decompose-on-death path
    // uses, so the debris reads consistently with a "shot composite"
    // burst.  Triangles re-enter the assembly cycle if they're near
    // another incomplete composite.
    this.decomposeMetalComposite(comp, entities);
    comp.active = false;
  }

  /** Spawn a single loose metal-shard triangle at world `(wx, wy)` drifting
   *  away from `(fromX, fromY)`.  Used for triangles that overflow a hexagon
   *  when two composites merge — they re-enter the assembly cycle. */
  private spawnLooseMetalTriangle(
    entities: GameEntity[],
    wx: number, wy: number,
    fromX: number, fromY: number,
    R: number,
    color: string | undefined,
    sprite: string | undefined,
    health: number,
    vx: number, vy: number,
  ): void {
    const triSize = 2 * R;
    const dx = wrapDeltaX(fromX, wx);
    const dy = wrapDeltaY(fromY, wy);
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const POP = METAL_ASSEMBLY.RELEASE_POP_SPEED;
    const pos = { x: wx, y: wy };
    wrapPosition(pos);
    entities.push({
      id: nextId('metal_shard'),
      type: EntityType.STRUCTURE,
      shardVariant: 'metal-shard',
      position: pos,
      velocity: { x: vx + (dx / d) * POP, y: vy + (dy / d) * POP },
      size: { x: triSize, y: triSize },
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 1.0,
      color: color,
      active: true,
      health,
      maxHealth: health,
      mass: SHARD_VARIANTS['metal-shard'].spawn.sizeToMass(triSize),
      polygonPoints: [
        { x: R * Math.cos(-Math.PI / 2),                   y: R * Math.sin(-Math.PI / 2) },
        { x: R * Math.cos(-Math.PI / 2 + 2 * Math.PI / 3), y: R * Math.sin(-Math.PI / 2 + 2 * Math.PI / 3) },
        { x: R * Math.cos(-Math.PI / 2 + 4 * Math.PI / 3), y: R * Math.sin(-Math.PI / 2 + 4 * Math.PI / 3) },
      ],
      sprite,
      collapseGraceTimer: getActiveShatterGraceDelay(),
    });
  }

  /** Nearest EMPTY hexagon slot of `comp` to a piece at world `(wx, wy)` — or
   *  null if the hexagon is already full.  Every composite fills the same 6
   *  slots (METAL_HEX_CELLS), so growth is constrained to a single hexagon
   *  rather than an open-ended polyiamond. */
  private nearestMetalHexSlot(
    comp: GameEntity,
    wx: number,
    wy: number,
  ): { ix: number; iy: number; up: boolean; d2: number } | null {
    const cells = comp.metalCells!;
    if (cells.length >= METAL_HEX_SIZE) return null;
    const R = comp.metalLatticeR!;
    const ux = (R * Math.sqrt(3)) / 2;
    const uy = R / 2;
    const occ = new Set<string>();
    let cmx = 0, cmy = 0;
    for (const c of cells) { occ.add(c.ix + ',' + c.iy); cmx += c.ix * ux; cmy += c.iy * uy; }
    cmx /= cells.length; cmy /= cells.length;

    // Piece position in the composite's lattice frame (rotate the world
    // delta by -rotation, then offset by the mass centroid).
    const wdx = wrapDeltaX(comp.position.x, wx);
    const wdy = wrapDeltaY(comp.position.y, wy);
    const cos = Math.cos(comp.rotation);
    const sin = Math.sin(comp.rotation);
    const pieceLx = (wdx * cos + wdy * sin) + cmx;
    const pieceLy = (-wdx * sin + wdy * cos) + cmy;

    let best: { ix: number; iy: number; up: boolean; d2: number } | null = null;
    let bestD2 = Infinity;
    for (const s of METAL_HEX_CELLS) {
      if (occ.has(s.ix + ',' + s.iy)) continue;
      const dx = s.ix * ux - pieceLx;
      const dy = s.iy * uy - pieceLy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = { ix: s.ix, iy: s.iy, up: s.up, d2 }; }
    }
    return best;
  }

  /** Append cell (ix, iy, up) to `comp`'s lattice, keeping the already-placed
   *  cells fixed in the world (the entity origin tracks the shifting mass
   *  centroid).  Geometry only — the caller blends mass/health and recomputes
   *  bounds (batched so a multi-cell merge recomputes once). */
  private addCellToComposite(comp: GameEntity, ix: number, iy: number, up: boolean): void {
    const R = comp.metalLatticeR!;
    const ux = (R * Math.sqrt(3)) / 2;
    const uy = R / 2;
    const cells = comp.metalCells!;

    let cmx0 = 0, cmy0 = 0;
    for (const c of cells) { cmx0 += c.ix * ux; cmy0 += c.iy * uy; }
    cmx0 /= cells.length; cmy0 /= cells.length;

    cells.push({ ix, iy, up });

    let cmx1 = 0, cmy1 = 0;
    for (const c of cells) { cmx1 += c.ix * ux; cmy1 += c.iy * uy; }
    cmx1 /= cells.length; cmy1 /= cells.length;

    const sx = cmx1 - cmx0;
    const sy = cmy1 - cmy0;
    const cos = Math.cos(comp.rotation);
    const sin = Math.sin(comp.rotation);
    comp.position.x += sx * cos - sy * sin;
    comp.position.y += sx * sin + sy * cos;
    wrapPosition(comp.position);
  }

  /** Lock loose triangle `l` into composite `comp` at lattice cell `target`. */
  /**
   * Decompose a dying metal composite into its constituent loose
   * triangles.  Mirrors the lattice math in mergeMetalComposites:
   * each cell's local centroid is (ix·R·√3/2, iy·R/2) relative to
   * the composite's own centroid; rotate by the composite's
   * rotation, add parent.position to get world coords.  Each loose
   * triangle inherits parent's velocity plus a small outward
   * scatter from the composite centroid so the cluster pops apart
   * rather than overlapping perfectly at spawn.  Each triangle's
   * polygon is the standard equilateral (matches DropSystem's
   * metal-tile breakShards), with metalLatticeR carried over so a
   * later re-assembly pass measures the same lattice size.
   *
   * Mass + HP are split evenly across the cells.  Mass per cell =
   * SHARD_SPAWN_SHAPE_METAL.sizeToMass(2R) — same formula tile-
   * break uses — so a decomposed triangle is interchangeable with
   * one freshly broken off a tile.  collapseGraceTimer is stamped
   * so the decomposed pieces float free for a moment before
   * tickMetalAssembly can re-snap them onto other composites.
   */
  private decomposeMetalComposite(parent: GameEntity, entities: GameEntity[]): void {
    const cells = parent.metalCells;
    if (!cells || cells.length < 2) return;
    const R = parent.metalLatticeR;
    if (!R) return;

    const ux = (R * Math.sqrt(3)) / 2;
    const uy = R / 2;
    // Composite centroid in lattice frame (mean of cell coords) —
    // matches how mergeMetalComposites + tickMetalAssembly compute
    // the body's own (0, 0) anchor.
    let cmx = 0, cmy = 0;
    for (const c of cells) { cmx += c.ix * ux; cmy += c.iy * uy; }
    cmx /= cells.length; cmy /= cells.length;
    const cos = Math.cos(parent.rotation);
    const sin = Math.sin(parent.rotation);

    const triDiameter = 2 * R;
    const variantDef = SHARD_VARIANTS['metal-shard'];
    const triMass = variantDef.spawn.sizeToMass(triDiameter);
    const hpEach = Math.max(1, Math.round((parent.health ?? cells.length) / cells.length));
    const maxHpEach = Math.max(1, Math.round((parent.maxHealth ?? cells.length) / cells.length));

    const baseEquilateral: Vector2[] = [
      { x: R * Math.cos(-Math.PI / 2),                 y: R * Math.sin(-Math.PI / 2) },
      { x: R * Math.cos(-Math.PI / 2 + 2 * Math.PI / 3), y: R * Math.sin(-Math.PI / 2 + 2 * Math.PI / 3) },
      { x: R * Math.cos(-Math.PI / 2 + 4 * Math.PI / 3), y: R * Math.sin(-Math.PI / 2 + 4 * Math.PI / 3) },
    ];

    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      // Cell centroid in entity-local frame (lattice → composite frame).
      const ex = c.ix * ux - cmx;
      const ey = c.iy * uy - cmy;
      // Composite frame → world.
      const wx = parent.position.x + ex * cos - ey * sin;
      const wy = parent.position.y + ex * sin + ey * cos;
      // Outward scatter direction from composite centroid.
      const dx = wx - parent.position.x;
      const dy = wy - parent.position.y;
      const scatterMag = Math.sqrt(dx * dx + dy * dy);
      const scatterSpeed = 1.0 + Math.random() * 1.5;
      const sx = scatterMag > 0.001 ? (dx / scatterMag) * scatterSpeed : Math.cos(i) * scatterSpeed;
      const sy = scatterMag > 0.001 ? (dy / scatterMag) * scatterSpeed : Math.sin(i) * scatterSpeed;
      // Clone the equilateral template so each loose triangle owns
      // its own points (the dent pipeline mutates polygonPoints in
      // place; shared references would deform every sibling).
      const points: Vector2[] = baseEquilateral.map(p => ({ x: p.x, y: p.y }));

      entities.push({
        id:            nextId('metal_decomp'),
        type:          EntityType.STRUCTURE,
        shardVariant:  'metal-shard',
        position:      { x: wx, y: wy },
        velocity:      { x: parent.velocity.x + sx, y: parent.velocity.y + sy },
        size:          { x: triDiameter, y: triDiameter },
        rotation:      parent.rotation,
        rotationSpeed: (Math.random() - 0.5) * 2,
        color:         parent.color,
        active:        true,
        health:        hpEach,
        maxHealth:     maxHpEach,
        polygonPoints: points,
        mass:          triMass,
        metalLatticeR: R,
        collapseGraceTimer: getActiveShatterGraceDelay(),
      });
    }

    // Dust puff matches metal-tile's slate colour — same particle
    // tone whether you break a tile face or pop a composite.
    const onParticles = variantDef.onShatterParticles;
    if (onParticles && onParticles !== 'none' && onParticles !== 'inherit') {
      const iv = parent.lastImpactVelocity;
      const impactSpeed = iv ? Math.sqrt(iv.x * iv.x + iv.y * iv.y) : 0;
      const impactAngle = impactSpeed > 0.001 ? Math.atan2(iv!.y, iv!.x) : undefined;
      const dustCount = 4 + cells.length;
      this.particles.spawn(entities, parent.position, dustCount, onParticles.color, {
        speedMin: 1, speedMax: impactSpeed * 0.4 + 2,
        sizeMin: 1, sizeMax: 2.5,
        lifetimeMin: 0.25, lifetimeMax: 0.55,
        spreadAngle: impactAngle,
        spreadCone: Math.PI,
        baseVelocity: parent.velocity,
      });
    }
  }

  private growMetalComposite(
    comp: GameEntity,
    l: GameEntity,
    target: { ix: number; iy: number; up: boolean },
  ): void {
    this.addCellToComposite(comp, target.ix, target.iy, target.up);

    const tm = comp.mass + l.mass;
    comp.velocity.x = (comp.velocity.x * comp.mass + l.velocity.x * l.mass) / tm;
    comp.velocity.y = (comp.velocity.y * comp.mass + l.velocity.y * l.mass) / tm;
    comp.mass = tm;
    comp.health = (comp.health ?? 0) + (l.health ?? 0);
    comp.maxHealth = (comp.maxHealth ?? 0) + (l.maxHealth ?? 0);

    this.metalRecomputeBounds(comp);
    l.active = false;
  }

  /** Pour composite `other`'s triangles into `host`'s empty hexagon slots
   *  (host is the ≥-sized one).  Triangles that fit fill the hexagon
   *  (nearest-to-host first); any that overflow the 6 slots are released as
   *  loose metal-shards so they rejoin the assembly cycle.  This is the
   *  composite ↔ composite "snap together", capped at one hexagon. */
  private mergeMetalComposites(host: GameEntity, other: GameEntity, entities: GameEntity[]): void {
    // World position of each of other's cells (its own lattice → world).
    const R = other.metalLatticeR!;
    const ux = (R * Math.sqrt(3)) / 2;
    const uy = R / 2;
    const ocells = other.metalCells!;
    let ocmx = 0, ocmy = 0;
    for (const c of ocells) { ocmx += c.ix * ux; ocmy += c.iy * uy; }
    ocmx /= ocells.length; ocmy /= ocells.length;
    const ocos = Math.cos(other.rotation);
    const osin = Math.sin(other.rotation);
    const placements = ocells.map(c => {
      const ex = c.ix * ux - ocmx, ey = c.iy * uy - ocmy;
      const pwx = other.position.x + ex * ocos - ey * osin;
      const pwy = other.position.y + ex * osin + ey * ocos;
      const dx = wrapDeltaX(host.position.x, pwx);
      const dy = wrapDeltaY(host.position.y, pwy);
      return { pwx, pwy, d2: dx * dx + dy * dy };
    });
    // Nearest-to-host first so cells pack inward against the existing body.
    placements.sort((a, b) => a.d2 - b.d2);

    const perOtherMass = other.mass / ocells.length;
    const perOtherHealth = Math.max(1, Math.round((other.health ?? ocells.length) / ocells.length));
    for (const p of placements) {
      const slot = this.nearestMetalHexSlot(host, p.pwx, p.pwy);
      if (slot) {
        this.addCellToComposite(host, slot.ix, slot.iy, slot.up);
        const tm = host.mass + perOtherMass;
        host.velocity.x = (host.velocity.x * host.mass + other.velocity.x * perOtherMass) / tm;
        host.velocity.y = (host.velocity.y * host.mass + other.velocity.y * perOtherMass) / tm;
        host.mass = tm;
        host.health = (host.health ?? 0) + perOtherHealth;
        host.maxHealth = (host.maxHealth ?? 0) + perOtherHealth;
      } else {
        // Host hexagon is full — this triangle overflows back to loose.
        this.spawnLooseMetalTriangle(
          entities, p.pwx, p.pwy, host.position.x, host.position.y,
          R, other.color, other.sprite, perOtherHealth,
          other.velocity.x, other.velocity.y,
        );
      }
    }
    this.metalRecomputeBounds(host);
    // Shape changed — wake so the float/snap checks re-run from awake.
    host.asleep = false;
    host.sleepTimer = 0;
    other.active = false;
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

    // Approximate angular-momentum transfer about the new centroid: an
    // off-centre approach (the pair's relative velocity has a tangential
    // component) spins the composite, so it rotates as one body.  Equal
    // masses sit at ±(b-a)/2 from the centroid; L = Σ m(r × v), I = Σ m|r|².
    const rax = -wdx * 0.5, ray = -wdy * 0.5;
    const rbx = wdx * 0.5, rby = wdy * 0.5;
    const L = a.mass * (rax * a.velocity.y - ray * a.velocity.x)
            + b.mass * (rbx * b.velocity.y - rby * b.velocity.x);
    const I = a.mass * (rax * rax + ray * ray) + b.mass * (rbx * rbx + rby * rby);
    const momentumSpin = I > 1e-6 ? L / I : 0;
    // Add a baseline random spin so every composite tumbles like a loose
    // shard, not just off-centre merges.  Damping bleeds it off as the
    // composite settles (see METAL_ASSEMBLY); the clamp caps total spin.
    const spin = Math.max(-2.5, Math.min(2.5,
      momentumSpin + (Math.random() - 0.5) * 2 * METAL_ASSEMBLY.SPAWN_SPIN));

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
    a.rotationSpeed = spin;
    // Gentle free-floater: drifts/spins visibly, then bleeds to rest and
    // sleeps — so settled composites drop out of the dynamic-load signal
    // instead of throttling shared passes forever (see METAL_ASSEMBLY).
    a.linearDamping = METAL_ASSEMBLY.LINEAR_DAMPING;
    a.angularDamping = METAL_ASSEMBLY.ANGULAR_DAMPING;
    a.restSpeed = METAL_ASSEMBLY.REST_SPEED;
    a.restSpin = METAL_ASSEMBLY.REST_SPIN;
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
          // Overflow — both parties are already at the top of the
          // ROCK_CONDENSE grid (max size + max density), and rock-
          // shards no longer transmute into rock-tiles per user
          // direction.  Refuse the merge so the pair stays as two
          // separate top-tier shards.  Without this gate the pair
          // would silently keep accumulating mass into a single
          // entity that visually never changes — a sink that swallows
          // every nearby shard without feedback.
          return;
        }
        newDiam = ROCK_CONDENSE.DIAMETERS[cell.s - 1];
        if (density) newTier = Math.min(density.maxSteps, cell.d - 1);
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
      // Plastic: pull straight from SHARD_SPAWN_SHAPE_PLASTIC so the
      // merged shard reads as a bigger version of a base shard (4
      // jittered verts) rather than the smooth near-circle it used
      // to be.  Default (rock): 7–10 verts, jagged.
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
        const ps = dominantDef.spawn;
        numPts = ps.polyVerticesMin
               + Math.floor(Math.random() * (ps.polyVerticesMax - ps.polyVerticesMin + 1));
        jitterK = ps.angleJitter;
        rMin    = ps.radiusMin;
        rRange  = ps.radiusRange;
      } else {
        numPts = 7 + Math.floor(Math.random() * 4);
        jitterK = 0.7; rMin = 0.60; rRange = 0.65;
      }
      const baseR   = (newDiam / 2) * 0.82;
      a.polygonPoints = this.generateShardPolygon(baseR, numPts, numPts, jitterK, rMin, rRange);

      a.shardVariant     = dominantVariant;
      a.powerupGlowColor = newGlow;
      a.size.x = newDiam; a.size.y = newDiam;
      invalidateCollisionR(a);
      a.mass   = newMass;
      a.position.x = nmx; a.position.y = nmy;
      a.velocity.x = nvx; a.velocity.y = nvy;
      // Rock-only HP cap scales with density tier — denser rocks
      // take more damage to destroy.  Cap = MAX_HP × sqrt(tier+1),
      // so tier 0 keeps the flat MAX_HP, tier 5 ≈ 14.7, top tier 24
      // = 30.  Summed HP from both parents clamps to that cap so a
      // rock that's accumulated through many merges accrues HP up
      // to the cap dictated by its current density tier.  Other
      // variants use the flat MAX_HP unchanged.
      const hpCap = isRockResult
        ? Math.max(MAX_HP, Math.round(MAX_HP * Math.sqrt((newTier ?? 0) + 1)))
        : MAX_HP;
      a.health     = Math.min(hpCap, a.health + b.health);
      a.maxHealth  = Math.min(hpCap, a.maxHealth + b.maxHealth);
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
      // Merge-count sum — tracks how many base shards composed this
      // entity so shatterAsteroidStyle can fragment it back into the
      // same count on death.  Applies to EVERY compose path (rock
      // condense / glass-self / plastic-self) so the "N in, N out"
      // invariant holds across all variants going through this
      // function.  Undefined parents default to 1 each.
      a.mergeCount = (a.mergeCount ?? 1) + (b.mergeCount ?? 1);
      // Plastic-specific: clear dent-history because the polygon was
      // regenerated at a new size and prior dent deltas tied to the
      // OLD geometry would be wrong to subtract from the new polygon.
      if (isPlasticSelfMerge) {
        a.plasticDentHistory = undefined;
      }
      // Graceful retire — fade the smaller party out instead of
      // snapping to inactive.  PhysicsSystem ticks `mergeFadeTimer`
      // each substep and flips active=false on completion;
      // RenderSystem multiplies alpha by the fraction remaining so
      // the dissolve reads visibly across the field.
      this.startMergeFadeOut(b);

      // Post-compose tile-snap check — plastic + glass route to the
      // shared TILE_SNAP path with 2 × tile-diameter threshold, speed
      // gate, and overflow debris.  Polled here (not per-tick) so a
      // newly-merged survivor either snaps immediately on this frame
      // (if all gates pass) or waits until its next compose; in
      // either case the snap is tied to a clear "I just grew" event.
      if (a.shardVariant === 'plastic-shard') {
        this.trySnapToTile(a, 'plastic-shard', 'plastic', entities, physics);
      } else if (a.shardVariant === 'glass-shard') {
        this.trySnapToTile(a, 'glass-shard', 'glass', entities, physics);
      }
      // Rock-shard tile transition — DISABLED per user direction.
      // Rock-shards now merge into larger / denser rock-shards only;
      // they cap out at the top ROCK_CONDENSE cell (refused merge
      // gate above in the isRockResult branch) and never transmute
      // into a static rock-tile.  To restore the old behaviour,
      // uncomment the block below and the overflow path in the
      // isRockResult merge branch:
      //
      // if (a.shardVariant === 'rock-shard' && a.mass > ROCK_MAX_CELL_MASS) {
      //   this.tryTransmuteShardToTile(a, 'rock-shard', 'rock', entities, physics);
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
    const aR = getCollisionR(a);
    const bR = getCollisionR(b);
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

// Parametric hex-colour lerp.  Mirrors lerpHexColors in PhysicsSystem
// (kept duplicated rather than cross-imported — the two systems don't
// share a colour helpers module today and the function is 8 lines).
// Used by tickPlasticDentRecovery to walk the plastic-tile colour
// back toward its original as HP recovers.
function lerpHexColors(a: string, b: string, t: number): string {
  const rA = parseInt(a.slice(1, 3), 16), gA = parseInt(a.slice(3, 5), 16), bA = parseInt(a.slice(5, 7), 16);
  const rB = parseInt(b.slice(1, 3), 16), gB = parseInt(b.slice(3, 5), 16), bB = parseInt(b.slice(5, 7), 16);
  const r = Math.round(rA + (rB - rA) * t);
  const g = Math.round(gA + (gB - gA) * t);
  const c = Math.round(bA + (bB - bA) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${c.toString(16).padStart(2, '0')}`;
}
