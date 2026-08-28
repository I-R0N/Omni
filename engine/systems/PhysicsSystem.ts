

import { GameEntity, Vector2, MapType, EntityType } from '../../types';
import { PHYSICS_CONSTANTS, SPATIAL_GRID_SIZE, PLAYER_MOVEMENT_CONFIG, STRUCTURE_CONSTANTS, LOCAL_GRAVITY_CONSTANTS, COLLISION_CONFIG, SHIELD_CONSTANTS, HIT_FEEDBACK, NEBULA_CONSTANTS, nebulaFadeRateScale, SHARD_VARIANTS, SHARD_PAIR_CONSTANTS, SHARD_TILE_PAIR_CONSTANTS, SHARD_SLEEP_CONSTANTS, PLASTIC_TRANSMUTE_EXCLUDE, PLASTIC_DENT_RECOVERY, randomPlasticShardShade, ROCK_BREAK, rockBreakChance, isCollectibleDrop, BUBBLE_CONSTANTS, hitReactStrength, noteTraitDamage, markDamaged, markShieldDamaged, AUDIO_CONSTANTS, getNebulaWakeSpinMode, getPortalGravityMult, getPortalGravityRangeMult, portalHorizonRadius, avoidsPortals, PORTAL_CONSTANTS, getActiveFractureMode } from '../../constants';

import { MAP_WIDTH, MAP_HEIGHT, HALF_MAP_WIDTH, HALF_MAP_HEIGHT, wrapPosition, wrapDeltaX, wrapDeltaY, wrapX, wrapY, onMapDimensionsChanged, isVisibleOnTorus } from '../toroidal';
import { getCollisionR, invalidateCollisionR } from '../entityCache';
import type { PerfController } from './PerfController';
import { CellBuckets } from './CellBuckets';

/**
 * How a projectile should come off a surface — see
 * `PhysicsSystem.deflectProjectile`.  Everything is optional: with no options
 * at all a deflection is a plain mirror that keeps the shot's owner, which is
 * what both shipped callers want.
 */
export interface DeflectOptions {
    /** Where to put the bolt after the reflection, in the CALLER'S frame
     *  (see the toroidal note on `deflectProjectile`).  Omit either axis to
     *  leave it where it is. */
    snapX?: number;
    snapY?: number;
    /** Scale the outgoing speed.  1 (the default) is a perfect mirror. */
    speedScale?: number;
    /** Random angular scatter in radians, applied as ±spread/2 — for a
     *  surface that shouldn't return fire along a clean optical path. */
    spread?: number;
    /** Re-own the bolt: a PARRY rather than a ricochet.  Clears the
     *  already-hit set so the redirected shot can strike its new targets. */
    reownType?: EntityType;
    reownId?: string;
    /** Keep a homing bolt steering.  Default is to CLEAR homing — see the
     *  re-home loop noted on `deflectProjectile`. */
    keepHoming?: boolean;
}

// Number of spatial-grid cells along each axis of the toroidal map.  The
// broadphase identifies a cell by the dense index `cx * SPATIAL_ROWS + cy`,
// with both coordinates wrapped into [0, SPATIAL_COLS) / [0, SPATIAL_ROWS)
// so neighbour queries near a seam land on the same bucket as the entities
// they should collide with on the opposite side.
//
// `let` + dimension listener so per-map size changes rebuild the cell
// count used by wrapCellX/Y before the next broadphase pass.
let SPATIAL_COLS = Math.ceil(MAP_WIDTH  / SPATIAL_GRID_SIZE);
let SPATIAL_ROWS = Math.ceil(MAP_HEIGHT / SPATIAL_GRID_SIZE);
onMapDimensionsChanged((w, h) => {
    SPATIAL_COLS = Math.ceil(w / SPATIAL_GRID_SIZE);
    SPATIAL_ROWS = Math.ceil(h / SPATIAL_GRID_SIZE);
});

function wrapCellX(cx: number): number {
    return ((cx % SPATIAL_COLS) + SPATIAL_COLS) % SPATIAL_COLS;
}
function wrapCellY(cy: number): number {
    return ((cy % SPATIAL_ROWS) + SPATIAL_ROWS) % SPATIAL_ROWS;
}
// Cell identity is a DENSE INDEX (`cx * SPATIAL_ROWS + cy`), not a packed
// `(cx << 16) | cy` hash key.  Both axes are already wrapped into
// [0, SPATIAL_COLS) x [0, SPATIAL_ROWS) here, so the index space is exactly
// the grid — which lets CellBuckets be a flat array instead of a Map and
// turns every lookup (nine per entity per substep, in the 3x3 neighbour
// scan) from a hash into an array index.  The static grid keeps a Map, but
// it is keyed on the same dense index, so the two agree cell for cell.
function cellKey(x: number, y: number): number {
    const cx = wrapCellX(Math.floor(x / SPATIAL_GRID_SIZE));
    const cy = wrapCellY(Math.floor(y / SPATIAL_GRID_SIZE));
    return cx * SPATIAL_ROWS + cy;
}
function cellKeyFromCell(cx: number, cy: number): number {
    return wrapCellX(cx) * SPATIAL_ROWS + wrapCellY(cy);
}
/** Total cells in the current grid — the size CellBuckets must cover. */
function cellCount(): number {
    return SPATIAL_COLS * SPATIAL_ROWS;
}

// Parametric hex-colour lerp.  Used by applyDentStep to fade
// plastic-tile colour toward its sticky shard-shade target as
// damage accumulates.  Inputs expected as #RRGGBB.
function lerpHexColors(a: string, b: string, t: number): string {
    const rA = parseInt(a.slice(1, 3), 16), gA = parseInt(a.slice(3, 5), 16), bA = parseInt(a.slice(5, 7), 16);
    const rB = parseInt(b.slice(1, 3), 16), gB = parseInt(b.slice(3, 5), 16), bB = parseInt(b.slice(5, 7), 16);
    const r = Math.round(rA + (rB - rA) * t);
    const g = Math.round(gA + (gB - gA) * t);
    const c = Math.round(bA + (bB - bA) * t);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${c.toString(16).padStart(2, '0')}`;
}

// Precompute the squared "still-settled" distance multiplier:
// pair is considered stable when distSq > sumRSq × STABLE_DIST_FACTOR_SQ.
// Derived from `dist > sumR × (1 − STABLE_OVERLAP_FRACTION)`, i.e. the
// overlap is below the configured fraction of contact distance.
const STABLE_DIST_FACTOR_SQ = (1 - SHARD_PAIR_CONSTANTS.STABLE_OVERLAP_FRACTION) ** 2;

// Scratch buffer for applyDentStep's pre-dent vertex snapshot — sized
// to the largest variant polygon (hex tiles have 6 vertices; plastic
// shards have 4).  Reused across calls so each dent event makes ZERO
// allocations for the snapshot pass.  Layout: alternating x, y per
// vertex (so index 2i = x, 2i+1 = y).  Sized at 12 (6 verts × 2)
// with a small safety margin.
const _dentPreSnapshot: Float64Array = new Float64Array(16);

// Registry of plastic entities with at least one entry in their
// plasticDentHistory.  Populated by applyDentStep when it pushes a
// dent delta; consumed by ShardSystem.tickPlasticDentRecovery, which
// iterates this set INSTEAD of walking the full entity list every
// step.  When an entity's history empties (or it gets transmuted /
// composed / dies) the recovery pass / clear sites remove it.
export const pendingPlasticDentEntities: Set<GameEntity> = new Set();

export class PhysicsSystem {
  // Dual-grid system:
  // staticGrid stores immovable geometry (Tiles) and is calculated ONLY on map load.
  // dynamicGrid stores moving entities (Player, Enemies, Projectiles) and is cleared every frame.
  private staticGrid: Map<number, GameEntity[]> = new Map();
  // The two PER-SUBSTEP grids are CellBuckets, not plain Maps: they are
  // rebuilt at 120 Hz, and allocating a fresh array per occupied cell each
  // time was the engine's second-largest allocator (see CellBuckets' header).
  // The static grid stays a plain Map — it is built once on map load, so
  // there is nothing to recycle.
  private dynamicGrid: CellBuckets = new CellBuckets();
  // Separate spatial hash for shard ↔ shard pair resolution.
  // Walked only on Nth physics steps per the ShPair pacing —
  // skipping the rebuild + walk entirely on off-frames is the
  // savings the DBG slider was missing when shard-shard pairs
  // were inline in the main collision pass.
  private shardGrid: CellBuckets = new CellBuckets();
  /** Reusable dynamic-entity working set, index-filled each substep.  A
   *  fresh `[]` here churned a ~2000-slot backing store at 120 Hz. */
  private dynamicEntities: GameEntity[] = [];

  // True if any static tile on the current map emits a repel field
  // (glass-tile / metal-tile today).  Set in initializeStaticGrid by
  // walking the entity list once.  When false, the 5×5 repel-cell scan
  // inside handleEntityCollisions can short-circuit entirely — saves
  // ~25 Map lookups per dynamic entity per frame on maps with no repel
  // emitters (most showcase maps, plus any natural map composed only of
  // indestructible / plastic / rock / nebula tiles).
  private _anyRepelTilesPresent: boolean = false;

  // Cached list of gravitational attractors (planets/stars — entities with
  // `gravityRange > 0`).  Populated once per map via initializeAttractors()
  // instead of being rebuilt every sim substep by scanning the full ~22k
  // master entity array.  Individual attractors still get an `active` check
  // at access time so a destroyed attractor stops contributing mid-game.
  private attractorsCache: GameEntity[] = [];

  // ── Perf instrumentation ──────────────────────────────────────────────────
  // Last-step wall time (ms) for the main update phases.  Written once per
  // update() call and read by GameEngine for the dev perf overlay.  Kept as
  // plain instance fields so there is zero allocation in the hot path.
  public lastUpdateMs: number = 0;       // whole update() excluding caller
  public lastGravityMs: number = 0;      // applyGravity scan + pair loop
  public lastLocalGravityMs: number = 0; // applyLocalGravity scan
  public lastCollisionsMs: number = 0;   // handleEntityCollisions broadphase + SAT

  // Debug toggle — flips the player↔asteroid mutual-gravity scan on/off.
  // GameEngine sets this from the DBG panel for A/B perf testing.
  // Default true matches today's production behaviour.
  public localGravityEnabled: boolean = true;
  // Debug toggle — flips applyGravity (POI/attractor scan over the
  // master entity list) on/off.  When false the pass returns
  // immediately and lastGravityMs reads zero.
  public attractorGravityEnabled: boolean = true;
  // Debug toggle — flips handleEntityCollisions on/off.  When false
  // the entire broadphase + SAT pass is skipped (game-breaking;
  // strictly for measuring the isolated cost in the perf overlay).
  public collisionsEnabled: boolean = true;
  // Debug toggle — gates the enemy counterplay traits (armor chip-resist,
  // etc.).  Default ON; flip OFF to A/B the soft-counter engine.
  public traitsEnabled: boolean = true;
  // Debug toggle — gates the dedicated mobile-shard ↔ static-tile
  // collision scan (resolveShardTilePairs).  Default OFF: the main
  // broadphase already skips this pair (shards are excluded from
  // the outer loop), so today's behaviour is "shards drift through
  // tiles' geometry, only the repel field pushes them away."  Flip
  // ON to add the missing scan — bringing back the dead asteroid-
  // crash branch in resolveCollision (asteroid-pressure damage +
  // elastic bounce off the tile face).
  public shardTileCollisionsEnabled: boolean = true;
  // Debug toggle — when true, nebula-shard ↔ nebula-shard pairs
  // ignore the per-variant passThrough flag and take a normal
  // elastic collision impulse.  Default OFF preserves today's
  // behaviour (nebula shards intentionally pass through each
  // other so the cloud reads continuous).  Flip ON to A/B-test
  // whether hard collisions break up the "one big pile" symptom
  // when many nebula shards converge.  Scope is intentionally
  // narrow: nebula-vs-striker and nebula-vs-tile still honour
  // passThrough — only the same-variant pair is affected.
  public nebulaShardCollisionsEnabled: boolean = true;
  // Debug toggle — PLAYER ↔ nebula-shard HARD collision.  When true, the
  // player↔nebula-shard pair bypasses the nebula passThrough gate in
  // resolveCollision and takes the standard SAT impulse, so the ship physically
  // shoves / parts the nebula cloud (the light 0.01-mass shards scatter).
  // Default OFF: the near-massless (0.01) shards take huge velocity kicks off
  // the impulse and cascade energy through the field, dropping frames at high
  // shard density.  The default interaction is instead the cheap pass-through +
  // rotation swirl in applyNebulaPlayerPull (mirrors player↔nebula-TILE), which
  // this flag suppresses when on so the two don't compound.  Flip on for the
  // "part the cloud" look.
  public playerNebulaCollisionEnabled: boolean = false;
  // Debug toggle — collision-sleep for mobile shards.  When true,
  // resolveShardPairs skips the SAT+impulse math for asleep↔asleep
  // pairs (the bulk of a settled field).  Flip OFF to A/B-test the
  // win and confirm sleeping never freezes a shard through a real
  // collision.  Sleep bookkeeping in the integration loop still runs
  // when off (the flag is just ignored by the pair skip), so toggling
  // back on takes effect immediately without a settle delay.
  public shardSleepEnabled: boolean = true;
  // Count of shards flagged asleep as of the last resolveShardPairs
  // call — exposed for the DBG perf readout so the win is visible.
  public lastAsleepCount: number = 0;
  // Debug toggle — viewport-gated shard-pair cadence.  When true,
  // both-offscreen shard pairs resolve only on the catch-up phase
  // (every OFFSCREEN_RESOLVE_DIVISOR passes); on/near-screen pairs
  // always resolve.  Off restores resolving every pair regardless of
  // visibility.
  public shardViewportCullEnabled: boolean = true;
  // Debug toggle — the tile repel PUSH (glass-tile + metal-tile, the only
  // variants with a `repel` config).  When false, the repel scan still runs and
  // still lights the tile/scanner glow (repelImpulse), but the outward VELOCITY
  // impulse is not applied — so tiles react/light up to a nearby player/enemy
  // yet no longer physically shove them.  Default OFF (glow only).
  public repelPushEnabled: boolean = false;
  // Camera-aligned viewport rect (world coords, CULL_MARGIN-padded),
  // set per sim frame by GameEngine.  Null until the first set — then
  // resolveShardPairs treats all shards as on-screen (conservative).
  private viewportLeft: number = 0;
  private viewportRight: number = 0;
  private viewportTop: number = 0;
  private viewportBottom: number = 0;
  private hasViewportRect: boolean = false;
  // Monotonic resolveShardPairs call counter — drives the off-screen
  // catch-up phase (every OFFSCREEN_RESOLVE_DIVISOR-th call resolves
  // both-offscreen pairs too).
  private shardPairCallCount: number = 0;
  // Count of shards flagged offscreen in the last resolveShardPairs
  // grid build — exposed for the DBG perf readout.
  public lastOffscreenShardCount: number = 0;
  // Shard ↔ shard pair resolution runs every Nth physics step.
  // 0 = AUTO (scaled by maxCellDensity); ≥1 = manual override.
  // Cycled via DBG panel; default from constants.
  public shardPairFrameInterval: number = SHARD_PAIR_CONSTANTS.FRAME_INTERVAL;
  // Effective interval used by the most recent
  // handleEntityCollisions call — exposed so the DBG panel can
  // render "auto/3" while the slider value stays at 0.  Mirrors
  // the manual value when not in AUTO mode.
  public lastEffectiveShardPairInterval: number = 1;
  // Whether the most recent shouldRunShardPairsThisStep() call
  // returned true.  Read by GameEngine.updateGameLogic to gate the
  // ShardSystem merge / cohesion passes to the same cadence as the
  // SAT pair pass — without this, bonds + cohesion run every frame
  // while separation runs only every Nth, and dense clusters
  // collapse to a single point.
  public lastRunShardPair: boolean = true;
  // Shard ↔ static-tile pair resolution interval.  Mirrors the
  // shard-pair knobs above but gates resolveShardTilePairs.  Only
  // meaningful when shardTileCollisionsEnabled is true; cycled via
  // the DBG `Sh↔Tl int` button.
  public shardTilePairFrameInterval: number = SHARD_TILE_PAIR_CONSTANTS.FRAME_INTERVAL;
  public lastEffectiveShardTilePairInterval: number = 1;
  public lastRunShardTilePair: boolean = true;
  // Central performance controller (engine/systems/PerfController.ts).
  // The shard-pair / shard-tile-pair gates delegate to it; the per-step
  // run decision + effective interval are precomputed there each substep.
  // Null only in the (unused) bare-instantiation path; GameEngine always
  // wires it before the first update.
  private perfController: PerfController | null = null;
  // Peak dynamic-grid cell population seen during this step's broadphase.
  // Tracked as the grid is populated; the 3×3 neighbourhood check is
  // quadratic per cell, so this is the direct signal for dense-cluster stalls.
  public lastMaxCellDensity: number = 0;
  // Count of entities inserted into the dynamic grid this step — i.e. the
  // exact set the collision broadphase outer loop iterates (mobile shards,
  // projectiles, enemies, drops, player; particles + mass=∞ tiles
  // excluded).  This is the true per-frame collision cost driver, unlike
  // total entity count which is dominated by inert static tiles.  Read by
  // PerfController as the throttle's entity-load signal.
  public lastDynamicCount: number = 0;

  // HOT MEMORY BUFFERS (Pre-allocated to prevent GC)
  //
  // MAX_SAT_VERTICES caps the polygon size the SAT pass can handle without
  // silently truncating a shape mid-collision.  Current generators top out
  // at ~12 vertices per asteroid (9-12 for initial spawns in
  // MapClasses.ts:62, 7-10 for accretion merges in GameEngine.ts:1499), so
  // 24 gives roughly 2× headroom for future growth.  Pre-allocated once;
  // allocation cost is negligible (~1 KB total).
  private static readonly MAX_SAT_VERTICES = 24;
  private bufferVerticesA: Vector2[] = Array.from({ length: PhysicsSystem.MAX_SAT_VERTICES }, () => ({ x: 0, y: 0 }));
  private bufferVerticesB: Vector2[] = Array.from({ length: PhysicsSystem.MAX_SAT_VERTICES }, () => ({ x: 0, y: 0 }));
  private bufferAxes: Vector2[] = Array.from({ length: PhysicsSystem.MAX_SAT_VERTICES * 2 }, () => ({ x: 0, y: 0 }));
  private bufferMtv: Vector2 = { x: 0, y: 0 };
  // One-shot warning guard so a new polygon source that exceeds the cap
  // produces exactly one console entry instead of spamming every frame.
  private warnedVertexOverflow = false;

  // Scratch outputs for the parametric SAT test (satTest) — avoids
  // allocating a result object on the per-cell composite collision path.
  private satOverlap = 0;
  private satAxisX = 0;
  private satAxisY = 0;

  public setPerfController(pc: PerfController) {
      this.perfController = pc;
  }

  // Call this when loading a map to cache static geometry
  public initializeStaticGrid(entities: GameEntity[]) {
      this.staticGrid.clear();
      // Map load: drop the per-substep bucket pools too.  Their free lists are
      // sized to the OUTGOING map, and holding a 6k-shard map's worth of empty
      // arrays alive across a portal into a sparse one is a leak, not a cache.
      // (`beginPass` is the per-substep reset; this is the teardown.)
      this.dynamicGrid.reset();
      this.shardGrid.reset();
      this.dynamicEntities.length = 0;
      this._anyRepelTilesPresent = false;

      for (let i = 0; i < entities.length; i++) {
          const e = entities[i];
          // Only index static structures that are not interactive portals/stations
          if (e.mass === Infinity && e.type !== EntityType.INTERACTABLE && e.active) {
               const key = cellKey(e.position.x, e.position.y);

               let cell = this.staticGrid.get(key);
               if (!cell) {
                   cell = [];
                   this.staticGrid.set(key, cell);
               }
               cell.push(e);
               // While we're walking the static set anyway, note whether
               // any tile emits a repel field — used to short-circuit the
               // 5×5 repel-cell scan in handleEntityCollisions on maps
               // where no tile pushes back.
               if (e.shardVariant !== undefined
                   && SHARD_VARIANTS[e.shardVariant].repel !== undefined) {
                   this._anyRepelTilesPresent = true;
               }
          }
      }
  }

  /**
   * Cache the list of gravitational attractors for a map.  Call once on
   * map load (alongside initializeStaticGrid) to replace the old
   * rebuild-every-frame scan in applyGravity.  Attractors are almost
   * always fixed stellar geometry so a one-shot cache is sufficient; if
   * gameplay ever spawns a new attractor at runtime, add it via a future
   * `addAttractor()` helper or call this method again from the caller.
   */
  public initializeAttractors(entities: GameEntity[]) {
      this.attractorsCache.length = 0;
      for (let i = 0; i < entities.length; i++) {
          const e = entities[i];
          if (e.gravityRange && e.gravityRange > 0) {
              this.attractorsCache.push(e);
          }
      }
  }

  /** Per-frame camera-aligned viewport rect (world coords, already
   *  CULL_MARGIN-padded by the caller).  Drives the both-offscreen
   *  shard-pair cadence gate in resolveShardPairs. */
  public setViewportRect(left: number, right: number, top: number, bottom: number): void {
      this.viewportLeft = left;
      this.viewportRight = right;
      this.viewportTop = top;
      this.viewportBottom = bottom;
      this.hasViewportRect = true;
  }

  public update(
    entities: GameEntity[],
    asteroids: GameEntity[],
    player: GameEntity,
    mapType: MapType,
    dt: number,
    onDamage?: (pos: Vector2, amount: number, target?: GameEntity, impactWorldPos?: Vector2) => void,
    onDeath?: (entity: GameEntity) => void,
    onShake?: (amount: number, opts?: { dirX?: number; dirY?: number }) => void,
    onHit?: (impactPos: Vector2, proj: GameEntity, target: GameEntity) => void,
    onPortalEject?: (entity: GameEntity, portal: GameEntity) => void
  ) {
    const t0 = performance.now();

    // Determine Friction based on Environment (MapType) from Config
    const config = PLAYER_MOVEMENT_CONFIG[mapType];
    const baseFriction = config ? config.friction : PHYSICS_CONSTANTS.FRICTION;

    // Time-Corrected Friction: Ensure friction effect is consistent per SECOND, not per tick.
    // Normalized to 60Hz. If dt is 1/120, exponent is 0.5.
    const timeScale = dt * 60;
    const friction = Math.pow(baseFriction, timeScale);

    // Apply Planetary/Stellar Gravity (Scaled by time).
    // DBG-toggleable: when attractorGravityEnabled is false the scan
    // is skipped entirely and lastGravityMs reads zero.
    const tGrav = performance.now();
    if (this.attractorGravityEnabled) {
      this.applyGravity(entities, timeScale, onDamage, onPortalEject);
    }
    this.lastGravityMs = performance.now() - tGrav;

    // Apply Player-Asteroid Mutual Gravity (Scaled by time).
    // DBG-toggleable: when localGravityEnabled is false, the scan is
    // skipped entirely and lastLocalGravityMs reads zero — letting the
    // perf overlay show the cost dropping to baseline in real time.
    const tLocal = performance.now();
    if (this.localGravityEnabled) {
      this.applyLocalGravity(asteroids, player, timeScale);
    }
    this.lastLocalGravityMs = performance.now() - tLocal;

    // Player → nebula-shard pull (independent of local gravity toggle
    // — this is the only interaction the player gets with nebula
    // shards now that SAT impulse is gated off by passThrough).
    this.applyNebulaPlayerPull(entities, player, timeScale);

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      if (!entity.active) continue;

      // OPTIMIZATION: Early bail on static geometry.
      // Map scenes can hold ~22k tile structures, the vast majority of which
      // are inert walls with mass=Infinity.  Walking them through the full
      // lifetime/flash/shield pipeline below burns 5+ conditionals per tile
      // per substep for nothing.  Bail immediately here — but FIRST tick
      // the nebula-specific timers, because NEBULA tiles also have
      // mass=Infinity and their spawn / fade / cooldown decrements must
      // still run every frame.  Without this, newly-created tiles with
      // `nebulaSpawnTimer = FADE_IN_DURATION` compute `spawnMul = 0` in
      // the renderer and draw at alpha 0 — invisible sprites even though
      // debug outlines render fine.
      if (entity.mass === Infinity) {
          if (entity.hitFlash && entity.hitFlash > 0) entity.hitFlash -= dt;
          if (entity.nebulaImpactCooldown !== undefined && entity.nebulaImpactCooldown > 0) {
              entity.nebulaImpactCooldown -= dt;
          }
          if (entity.mergeFadeTimer !== undefined && entity.mergeFadeTimer > 0) {
              entity.mergeFadeTimer -= dt;
              if (entity.mergeFadeTimer <= 0) {
                  entity.mergeFadeTimer = undefined;
                  entity.mergeFadeDuration = undefined;
                  entity.active = false;
              }
          }
          if (entity.nebulaSpawnTimer !== undefined && entity.nebulaSpawnTimer > 0) {
              entity.nebulaSpawnTimer -= dt;
              if (entity.nebulaSpawnTimer <= 0) {
                  entity.nebulaSpawnTimer = undefined;
              }
          }
          // Asteroid-pressure accumulator decay.  The rolling window
          // expires into a full reset (both count and cooldown cleared)
          // so a tile only breaks under *sustained* pressure within
          // TILE_PRESSURE_WINDOW, not from hits spread over a minute.
          if (entity.tilePressureCooldown !== undefined && entity.tilePressureCooldown > 0) {
              entity.tilePressureCooldown -= dt;
              if (entity.tilePressureCooldown <= 0) entity.tilePressureCooldown = undefined;
          }
          if (entity.tilePressureTimer !== undefined && entity.tilePressureTimer > 0) {
              entity.tilePressureTimer -= dt;
              if (entity.tilePressureTimer <= 0) {
                  entity.tilePressureTimer = undefined;
                  entity.tilePressureCount = undefined;
              }
          }
          continue;
      }

      // Lifetime management
      if (entity.lifetime !== undefined) {
        entity.lifetime -= dt;
        if (entity.lifetime <= 0) {
            entity.active = false;
            continue;
        }
      }

      // Visuals: Tick down flash timer, and the longer health-bar window
      // that rides the same events (5d U5).
      if (entity.hitFlash && entity.hitFlash > 0) {
          entity.hitFlash -= dt;
      }
      if (entity.healthBarTimer !== undefined && entity.healthBarTimer > 0) {
          entity.healthBarTimer -= dt;
      }
      // Nebula shatter cooldown — strikers (PLAYER/ENEMY) that just broke
      // a nebula can't break another until this expires.
      if (entity.nebulaImpactCooldown !== undefined && entity.nebulaImpactCooldown > 0) {
          entity.nebulaImpactCooldown -= dt;
      }
      // Merge fade-out — both nebula AND non-nebula shard families
      // ride the same `mergeFadeTimer` field; the value differs by
      // variant (nebula longer, ~1 s; others crisp, ~0.5 s).  The
      // entity stays active+rendered with multiplied alpha while
      // the timer counts down, then flips inactive so the in-place
      // compaction in GameEngine.updatePhysics drops it.  Tiles
      // share this tick — see the mass=Infinity branch above.
      if (entity.mergeFadeTimer !== undefined && entity.mergeFadeTimer > 0) {
          entity.mergeFadeTimer -= dt;
          if (entity.mergeFadeTimer <= 0) {
              entity.mergeFadeTimer = undefined;
              entity.mergeFadeDuration = undefined;
              entity.active = false;
          }
      }
      // Nebula birth fade-in — newly-created tiles and shards count this
      // down from FADE_IN_DURATION to 0; the renderer scales alpha by
      // 1 − (timer / FADE_IN_DURATION) so they slowly materialise.
      if (entity.nebulaSpawnTimer !== undefined && entity.nebulaSpawnTimer > 0) {
          entity.nebulaSpawnTimer -= dt;
          if (entity.nebulaSpawnTimer <= 0) {
              entity.nebulaSpawnTimer = undefined;
          }
      }
      // Nebula shard merge cooldown — skip gravity pull + merge checks
      // in NebulaSystem.updateDynamics while this is positive.  Only
      // NEBULA_SHARDs carry this field in practice, but ticking it
      // unconditionally is a single branch per entity and keeps the
      // timer model consistent.
      if (entity.nebulaMergeCooldown !== undefined && entity.nebulaMergeCooldown > 0) {
          entity.nebulaMergeCooldown -= dt;
          if (entity.nebulaMergeCooldown <= 0) {
              entity.nebulaMergeCooldown = undefined;
          }
      }
      // Hot-spot-collapse grace — freshly-shattered rock/glass shards hold
      // off the overlap-collapse pass while this counts down, so a
      // destroyed tile's debris gets to scatter instead of snapping back
      // into a tile on the next merge frame.
      if (entity.collapseGraceTimer !== undefined && entity.collapseGraceTimer > 0) {
          entity.collapseGraceTimer -= dt;
          if (entity.collapseGraceTimer <= 0) {
              entity.collapseGraceTimer = undefined;
          }
      }
      // Shield: tick down hit flash and recharge timer, then recharge
      if (entity.shieldHitFlash && entity.shieldHitFlash > 0) {
          entity.shieldHitFlash -= dt;
      }
      if (entity.shieldRechargeTimer !== undefined && entity.shieldRechargeTimer > 0) {
          entity.shieldRechargeTimer -= dt;
      }
      if (entity.shield !== undefined && entity.maxShield !== undefined
          && entity.shield < entity.maxShield
          && (entity.shieldRechargeTimer ?? 0) <= 0
          && !entity.systemsDisabled) { // EMP-disabled shield doesn't recharge (Stage 3c)
          entity.shield = Math.min(entity.maxShield, entity.shield + (entity.shieldRechargeRate ?? SHIELD_CONSTANTS.RECHARGE_RATE) * dt);
      }
      // The directional arc-shield angle (Bulwark) is steered toward the
      // player by AISystem (it has the player reference) — not auto-rotated
      // here.

      // ORBITAL PHYSICS
      if (entity.orbitCenter && entity.orbitRadius && entity.orbitSpeed !== undefined && entity.orbitAngle !== undefined) {
          entity.orbitAngle += entity.orbitSpeed * dt;
          entity.position.x = entity.orbitCenter.x + Math.cos(entity.orbitAngle) * entity.orbitRadius;
          entity.position.y = entity.orbitCenter.y + Math.sin(entity.orbitAngle) * entity.orbitRadius;
          wrapPosition(entity.position);

          entity.velocity.x = 0;
          entity.velocity.y = 0;
      } else {
          // STANDARD PHYSICS

          // Skip movement for exploding entities
          if (entity.isExploding) continue;

          // Position integration — normalized to 60 Hz so that changing
          // FIXED_DT (and therefore the number of substeps per render frame)
          // does not alter the effective travel rate of any entity.  With
          // timeScale = dt * 60, dt = 1/60 yields ×1 (legacy behavior) and
          // dt = 1/120 yields ×0.5 per step × 2 steps per frame = same net
          // displacement per wall-clock second.
          entity.position.x += entity.velocity.x * timeScale;
          entity.position.y += entity.velocity.y * timeScale;
          // Toroidal map: keep positions in [-HALF_MAP, +HALF_MAP) so the
          // spatial hash, flow field, and all distance math always see a
          // canonical coordinate rather than one drifting off toward ±∞.
          wrapPosition(entity.position);

          // Apply Friction.  Stage 5: gate by per-entity damping
          // override (today: nebula-shards) instead of EntityType so
          // the shard-family unification doesn't lose nebula's
          // characteristic cloud drag.
          if (entity.linearDamping !== undefined) {
            // Custom heavy linear & angular damping (nebula-shards
            // today, future variants opt in via the same per-entity
            // field at spawn time).  Falls back to NEBULA_CONSTANTS
            // values for entities that don't set them.
            const linearD = entity.linearDamping;
            const angularD = entity.angularDamping ?? NEBULA_CONSTANTS.ANGULAR_DAMPING;
            const restSpeed = entity.restSpeed ?? NEBULA_CONSTANTS.REST_SPEED;
            const restSpin  = entity.restSpin  ?? NEBULA_CONSTANTS.REST_SPIN;
            const lin = Math.pow(linearD, timeScale);
            const ang = Math.pow(angularD, timeScale);
            entity.velocity.x *= lin;
            entity.velocity.y *= lin;
            if (Math.abs(entity.velocity.x) < restSpeed) entity.velocity.x = 0;
            if (Math.abs(entity.velocity.y) < restSpeed) entity.velocity.y = 0;
            if (entity.rotationSpeed !== undefined) {
                entity.rotationSpeed *= ang;
                if (Math.abs(entity.rotationSpeed) < restSpin) entity.rotationSpeed = 0;
                entity.rotation += entity.rotationSpeed * dt;
            }
          } else if (entity.type === EntityType.PLAYER || entity.type === EntityType.ENEMY
              || (entity.type === EntityType.INTERACTABLE && !entity.dropType)) {
            // Standard friction for player / enemies / non-drop POIs.
            // STRUCTURE entities (mobile shards post-collapse, plus
            // tiles which are mass=∞ and skipped earlier) and
            // projectiles / particles / drops free-drift today.
            entity.velocity.x *= friction;
            entity.velocity.y *= friction;

            // Snap to zero at very low speeds to prevent micro-drift calculations
            if (Math.abs(entity.velocity.x) < 0.01) entity.velocity.x = 0;
            if (Math.abs(entity.velocity.y) < 0.01) entity.velocity.y = 0;
          }
      }

      // Collision-sleep bookkeeping — mobile shard-family entities only.
      // Velocity / spin are final for this step here, so this is the one
      // place that decides the sleep flag (resolveShardPairs reads it).
      // Above-epsilon motion resets the dwell timer and wakes; otherwise
      // the timer accrues until DELAY_SECONDS, then the shard sleeps.
      // Collision wakes are stamped directly at the impulse sites, which
      // also reset sleepTimer so a grazed shard re-earns its dwell.
      if (entity.shardVariant !== undefined && entity.mass !== Infinity) {
          const vsq = entity.velocity.x * entity.velocity.x
                    + entity.velocity.y * entity.velocity.y;
          const spin = entity.rotationSpeed ?? 0;
          if (vsq > SHARD_SLEEP_CONSTANTS.SPEED_EPSILON_SQ
              || (spin < 0 ? -spin : spin) > SHARD_SLEEP_CONSTANTS.SPIN_EPSILON) {
              entity.sleepTimer = 0;
              entity.asleep = false;
          } else if (entity.asleep !== true) {
              const t = (entity.sleepTimer ?? 0) + dt;
              entity.sleepTimer = t;
              if (t >= SHARD_SLEEP_CONSTANTS.DELAY_SECONDS) entity.asleep = true;
          }
      }
    }

    // Optimized Entity-Entity Collision (Spatial Hash Grid).
    // DBG-toggleable: when collisionsEnabled is false the broadphase +
    // SAT pass is skipped entirely (game-breaking — projectiles fly
    // through, tiles are inert).  Strictly a perf measurement aid.
    //
    // Shard ↔ shard pairs run as a separate dedicated pass at the
    // ShPair-paced cadence — skipping the entire build + walk on
    // off-frames is what makes the slider visibly move `coll` ms.
    // Both passes share the same `tCol` window so the perf timer
    // reports total collision cost (main + shard-pair).
    const tCol = performance.now();
    if (this.collisionsEnabled) {
      this.handleEntityCollisions(entities, timeScale, onDamage, onDeath, onShake, onHit);
      if (this.shouldRunShardPairsThisStep()) {
        this.resolveShardPairs(asteroids, onDeath);
      }
      if (this.shardTileCollisionsEnabled && this.shouldRunShardTilePairsThisStep()) {
        this.resolveShardTilePairs(asteroids, onDamage, onDeath, onShake, onHit);
      }
      // Unconditional nebula-shard ↔ nebula-tile pass.  The main
      // broadphase skips STRUCTURE outers entirely and the wider
      // Sh↔Tl scan is opt-in via toggle — without this dedicated
      // pass nebula shards drift through nebula tiles' geometry.
      // Cheap: only iterates nebula-shards (a small fraction of
      // the asteroid list on most maps) and short-circuits inside
      // checkAndResolveCollision when the inner cell holds no
      // nebula-tile.
      this.resolveNebulaShardTilePairs(asteroids, onDamage, onDeath, onShake, onHit);
      // Unconditional passthroughShatter pass — for variants whose
      // SHARD_VARIANTS entry sets `passthroughShatter.targets`
      // (today: metal-shard targeting glass-tile + glass-shard).
      // Mirrors the nebula-tile pass: gets the dynamic-vs-static
      // pair in front of resolveCollision so the passthroughShatter
      // branch there can fire even when shardTileCollisionsEnabled
      // is off.  Dynamic-vs-dynamic pairs (metal-shard ↔ glass-
      // shard) flow through resolveShardPair, which calls the
      // same helper inline.
      this.resolvePassthroughShatterPairs(asteroids, onDamage, onDeath, onShake, onHit);
    }
    this.lastCollisionsMs = performance.now() - tCol;

    this.lastUpdateMs = performance.now() - t0;
  }

  /**
   * Mutual gravity between the player and every active asteroid.
   *
   * Phase 2: consumes EntityIndex.asteroids (passed down from GameEngine
   * via update()) instead of scanning the full ~22k entity master list.
   * The measurement-driven signal for late-wave drops: this single scan
   * used to walk every static tile just to reach a few hundred shards.
   * Each asteroid still gets an `isExploding` skip since the index is
   * filtered by `active` alone and can hold mid-explosion entries.
   */
  /**
   * Player → nebula-shard swirl.  Nebula shards keep their passThrough
   * flag so the player ship glides THROUGH them with no SAT impulse —
   * the same pass-through the player gets against nebula TILES.  In
   * place of a bounce this pass applies a soft ROTATION push: a
   * tangential velocity swirl (perpendicular to the ship→shard line)
   * plus a rotation-rate ramp, so the cloud swirls in the ship's wake
   * instead of sliding past inertly.  Cheap by construction — no SAT,
   * no near-massless energy cascade, just a per-shard velocity/spin
   * nudge — which is why it stays smooth at high shard density where
   * the hard-collision path drops frames.
   *
   * - Applied CONTINUOUSLY every substep (no cooldown gate) so the
   *   swirl reads as a smooth wake, not a once-a-second jerk.  Terminal
   *   swirl speed is bounded by NEBULA_CONSTANTS.LINEAR_DAMPING; the
   *   ship passes through fast enough that shards get a transient kick,
   *   then settle.
   * - Tangential (not radial): the swirl is perpendicular to the
   *   ship→shard vector, so shards orbit the ship rather than collapsing
   *   into the hull or blowing outward.
   * - Spin sign is deterministic per shard (id last-char parity) so a
   *   given shard always swirls the same way; the field as a whole reads
   *   as varied vortices rather than a uniform pinwheel.
   * - rotationSpeed is capped at NEBULA_CONSTANTS.MAX_SPIN.
   *
   * Skipped entirely when the DBG hard-collision toggle is on
   * (playerNebulaCollisionEnabled) — that path routes the pair through
   * the SAT impulse instead, and the two shouldn't compound.  The
   * nebula-shard shatter path is unchanged: shards never shatter on
   * player contact (pure pass-through); only nebula TILES do.
   */
  private applyNebulaPlayerPull(entities: GameEntity[], player: GameEntity, timeScale: number) {
      if (!player.active || player.isExploding) return;
      // Hard-collision toggle owns the interaction when on — don't
      // double up the swirl on top of the SAT bounce.
      if (this.playerNebulaCollisionEnabled) return;
      const range = NEBULA_CONSTANTS.PLAYER_PULL_RANGE;
      const rangeSq = range * range;
      const strength = NEBULA_CONSTANTS.PLAYER_PULL_STRENGTH;
      const spinKick = NEBULA_CONSTANTS.PLAYER_PULL_SPIN;
      const maxSpin = NEBULA_CONSTANTS.MAX_SPIN;
      const px = player.position.x;
      const py = player.position.y;

      for (let i = 0; i < entities.length; i++) {
          const e = entities[i];
          if (!e.active || e.shardVariant !== 'nebula-shard') continue;
          const dx = wrapDeltaX(e.position.x, px);
          const dy = wrapDeltaY(e.position.y, py);
          const distSq = dx * dx + dy * dy;
          if (distSq > rangeSq || distSq < 1) continue;
          const dist = Math.sqrt(distSq);
          const fall = 1 - dist / range; // 1 at centre → 0 at edge
          const invDist = 1 / dist;
          // Normalised radial (shard → player).
          const rx = dx * invDist;
          const ry = dy * invDist;
          // Spin HANDEDNESS is a DBG cycle (Visual ▸ "Neb spin") while the
          // proper rotational mechanics are parked (see PARKING_LOT):
          //  - `physical` (default): the wake shear — the ship's velocity
          //    crossed with the ship→shard vector — so a shard passed on the
          //    STARBOARD side turns CLOCKWISE on screen and a port-side one
          //    counter-clockwise (user report: the parity sign below gave a
          //    starboard pass no consistent handedness at all).  `dx`/`dy`
          //    here are shard→player, hence the sign arrangement.  A near-
          //    still ship sheds no wake, so below WAKE_MIN_SPEED the parity
          //    fallback keeps the idle cloud varied instead of frozen.
          //  - `inverted`: the same cross product negated — the A/B case.
          //  - `random`: the shipped id-parity "varied vortices".
          const mode = getNebulaWakeSpinMode();
          const vx = player.velocity.x, vy = player.velocity.y;
          let spinSign: number;
          if (mode === 'random' || vx * vx + vy * vy < 0.25) {
              const lastChar = e.id ? e.id.charCodeAt(e.id.length - 1) : 0;
              spinSign = (lastChar & 1) ? 1 : -1;
          } else {
              spinSign = (vy * dx - vx * dy) >= 0 ? 1 : -1;
              if (mode === 'inverted') spinSign = -spinSign;
          }
          // Tangential swirl: perpendicular to the radial, signed per
          // shard.  perp(rx,ry) = (-ry, rx); flip by spinSign.
          const swirl = strength * fall * timeScale;
          e.velocity.x += -ry * spinSign * swirl;
          e.velocity.y += rx * spinSign * swirl;
          // Rotation push, capped.
          const nextSpin = (e.rotationSpeed ?? 0) + spinSign * spinKick * fall * timeScale;
          e.rotationSpeed = Math.max(-maxSpin, Math.min(maxSpin, nextSpin));
      }
  }

  private applyLocalGravity(asteroids: GameEntity[], player: GameEntity, timeScale: number) {
      if (!player.active) return;

      const { RANGE, STRENGTH, MIN_DIST, PLAYER_INFLUENCE } = LOCAL_GRAVITY_CONSTANTS;
      const rangeSq = RANGE * RANGE;
      const minDistSq = MIN_DIST * MIN_DIST;

      for (let i = 0; i < asteroids.length; i++) {
          const e = asteroids[i];
          if (e.isExploding) continue;

          const dx = wrapDeltaX(e.position.x, player.position.x);
          const dy = wrapDeltaY(e.position.y, player.position.y);
          const distSq = dx*dx + dy*dy;

          if (distSq < rangeSq && distSq > minDistSq) {
              // Fold the 1/dist normalisation into the force scalar so
              // each velocity axis is one mul instead of one div + one mul.
              const invDist = 1 / Math.sqrt(distSq);
              const forceMag = (STRENGTH * invDist) * timeScale; // Normalize force by time
              const kx = dx * invDist * forceMag;
              const ky = dy * invDist * forceMag;

              // Pull Asteroid
              e.velocity.x += kx;
              e.velocity.y += ky;

              // Pull Player
              const playerScale = (e.mass / player.mass) * PLAYER_INFLUENCE;
              player.velocity.x -= kx * playerScale;
              player.velocity.y -= ky * playerScale;
          }
      }
  }

  private applyGravity(entities: GameEntity[], timeScale: number, onDamage?: (pos: Vector2, amount: number, target?: GameEntity, impactWorldPos?: Vector2) => void, onPortalEject?: (entity: GameEntity, portal: GameEntity) => void) {
    // Phase 2: use the attractors cache populated on map load instead of
    // re-scanning the full entity array every substep.  Individual dead
    // attractors are skipped at access time by the `active` check below so
    // a destroyed attractor stops contributing without rebuilding the list.
    const attractors = this.attractorsCache;
    if (attractors.length === 0) return;

    for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        // Optimization: Skip particles and immovable terrain.  Stage 5
        // collapses STRUCTURE to cover both static tiles and mobile
        // shards; the mass=Infinity gate alone correctly excludes the
        // tile case while letting mobile shards participate.
        if (!entity.active || entity.isExploding || entity.mass === Infinity || entity.type === EntityType.PARTICLE) continue;

        // Portal-transit grace: debris the exit rift just spat out is immune
        // to PORTAL gravity (pull and swallow both) until the timer runs
        // out, or the well that ejected it would recapture most of it —
        // escape speed from the mouth is ~8 px/tick against ejection speeds
        // of ~2-6.  Ticked here because this loop is the only per-substep
        // walk that cares; planets (non-portal attractors) still pull.
        let graced = false;
        if (entity.portalGraceTimer !== undefined && entity.portalGraceTimer > 0) {
            entity.portalGraceTimer -= timeScale / 60;
            graced = true;
        }

        for (let j = 0; j < attractors.length; j++) {
            const attractor = attractors[j];
            if (!attractor.active) continue;
            if (entity === attractor) continue;
            if (graced && attractor.isPortal) continue;

            const dx = wrapDeltaX(entity.position.x, attractor.position.x);
            const dy = wrapDeltaY(entity.position.y, attractor.position.y);
            const distSq = dx*dx + dy*dy;
            // DBG portal tuning is applied at the READ, so the entity keeps
            // PORTAL_CONSTANTS as its base and a knob re-tunes the portals
            // already in the world.  Non-portal attractors read 1×.
            const isPortalAttr = attractor.isPortal === true;
            const gMult = isPortalAttr ? getPortalGravityMult() : 1;
            const rMult = isPortalAttr ? getPortalGravityRangeMult() : 1;
            const range = attractor.gravityRange! * rMult;
            const rangeSq = range * range;

            // Mobile shard-family entities get the close-attractor crush
            // (mobile shards = STRUCTURE with finite mass).  A wormhole
            // portal SWALLOWS instead: the radius is the visual event
            // horizon (0.62 × r, the dark disc dropShapes draws), so the
            // shard disappears while covered by it, and there is no damage
            // popup — matter falling past a horizon is silent, and a crush
            // number over the rift would be pure noise.
            // Dragon body segments are exempt: they are chain-snapped to the
            // head's path every frame (velocity is moot) and dying any way
            // but a SHOT must go through the sever machinery, not a silent
            // deactivate that would leave a gap the DragonInstance still
            // references.
            const isMobileShard = entity.type === EntityType.STRUCTURE && entity.mass !== Infinity
                && entity.dragonSegment !== true;
            // A portal swallows at exactly the radius it is DRAWN at — the
            // same `portalHorizonRadius` the renderer calls, so matter can
            // never vanish beside the hole or survive inside it.  (It carries
            // the destination-span scaling and the DBG Size knob with it.)
            const crushR = isPortalAttr
                ? portalHorizonRadius(attractor)
                : attractor.size.x / 2;

            // ── STEERING CLEAR ──────────────────────────────────────────
            // Anything that steers itself is pushed OUT near a rift, so
            // nothing with a mind of its own is captured and parked in the
            // throat (user call).  One rule here rather than avoidance code
            // in the AISystem strategies, the dragon, the rivals and the
            // bubbles — four different movement machineries, and a fifth
            // arriving later would have had to remember.
            //
            // The pull is NOT cancelled: drifting toward a rift from across
            // the arena is worth keeping.  This simply wins closer in, so
            // they hold off at a standoff and slide around it.
            if (isPortalAttr && avoidsPortals(entity)) {
                const A = PORTAL_CONSTANTS.AVOID;
                const avoidR = Math.max(crushR * A.RANGE_MULT, A.RANGE_MIN);
                if (distSq < avoidR * avoidR) {
                    const d = Math.sqrt(distSq);
                    if (d > 1e-3) {
                        // Linear falloff to nothing at the rim, so there is no
                        // edge to bounce off — just firmer the closer it gets.
                        const push = A.ACCEL * (1 - d / avoidR) * timeScale;
                        entity.velocity.x -= (dx / d) * push;
                        entity.velocity.y -= (dy / d) * push;
                    }
                }
            }

            if (distSq < crushR * crushR) {
                // ── TOO BIG TO SWALLOW ──────────────────────────────────
                // An object whose own radius reaches a fair fraction of the
                // horizon cannot fit down it: crossing the centre FLINGS it
                // out along its own heading, the way a collision would throw
                // it (user call).  Sized against the horizon, so the same
                // rock ploughs through a small rift and vanishes into a big
                // one.  The player and projectiles are exempt — see
                // PORTAL_CONSTANTS.EJECT.
                const E = PORTAL_CONSTANTS.EJECT;
                const radius = Math.max(entity.size.x, entity.size.y) * 0.5;
                const ejectable = isPortalAttr
                    && entity.type !== EntityType.PLAYER
                    && entity.type !== EntityType.PROJECTILE
                    && radius >= crushR * E.SIZE_FRACTION;
                if (ejectable) {
                    let vx = entity.velocity.x, vy = entity.velocity.y;
                    let speed = Math.hypot(vx, vy);
                    if (speed > 1e-3) {
                        vx /= speed; vy /= speed;
                    } else {
                        // No heading of its own — something nudged it in at
                        // rest.  Throw it back the way it came in, which is
                        // the only direction that means anything here.
                        const d = Math.sqrt(distSq) || 1;
                        vx = -dx / d; vy = -dy / d; speed = 0;
                    }
                    const out = Math.max(E.SPEED, speed * E.BOOST);
                    entity.velocity.x = vx * out;
                    entity.velocity.y = vy * out;
                    entity.rotationSpeed = (entity.rotationSpeed ?? 0)
                        + (Math.random() - 0.5) * E.SPIN;
                    // The same immunity the transit debris gets, and for the
                    // same reason: without it the well it just cleared would
                    // haul it straight back down.
                    entity.portalGraceTimer = E.GRACE_SEC;
                    if (onPortalEject) onPortalEject(entity, attractor);
                    continue;
                }
                if (isMobileShard) {
                    entity.active = false;
                    if (onDamage && !attractor.isPortal) onDamage(entity.position, COLLISION_CONFIG.DAMAGE.SHARD_CRUSH, entity);
                    continue;
                }
            }

            if (distSq < rangeSq) {
                let force = ((attractor.gravityStrength || 1000) * gMult) / Math.max(distSq, 10000);
                const maxAccel = entity.type === EntityType.PLAYER ? 0.2 : 5.0;
                // Attractor-side player scaling (portals): shards and enemies
                // take the full well, the player only a fraction of it, so a
                // wormhole's mouth pulls debris in without trapping a pilot
                // who only flew close (thrust must always win).
                if (entity.type === EntityType.PLAYER && attractor.gravityPlayerScale !== undefined) {
                    force *= attractor.gravityPlayerScale;
                }

                // Scale force by time step so higher framerates don't increase gravity strength
                const clampedForce = Math.min(force, maxAccel) * timeScale;

                // One reciprocal-sqrt for two normalised axes — one div instead
                // of two.  Same math, half the per-pair division cost.
                const k = clampedForce / Math.sqrt(distSq);
                entity.velocity.x += dx * k;
                entity.velocity.y += dy * k;
            }
        }
    }
  }

  private handleEntityCollisions(
    entities: GameEntity[],
    timeScale: number,
    onDamage?: (pos: Vector2, amount: number, target?: GameEntity, impactWorldPos?: Vector2) => void,
    onDeath?: (entity: GameEntity) => void,
    onShake?: (amount: number, opts?: { dirX?: number; dirY?: number }) => void,
    onHit?: (impactPos: Vector2, proj: GameEntity, target: GameEntity) => void
  ) {
    // 1. Reset ONLY the Dynamic Grid (Static Grid is persistent).  beginPass
    // empties the buckets and recycles their arrays — see CellBuckets.
    // `resize` is a single compare once the grid is big enough; calling it
    // here rather than only at map load means no path can change the map
    // dimensions and leave the grid undersized.
    this.dynamicGrid.resize(cellCount());
    this.dynamicGrid.beginPass();

    // 2. Populate Dynamic Grid with moving entities.  While we're walking
    // each cell push, track the peak cell population — the 3×3 neighbourhood
    // SAT pass below is O(k²) per cell, so peak density is the direct signal
    // for dense-cluster stalls in the dev perf overlay.
    //
    // Particles are excluded from the grid entirely: resolveCollision
    // discards every pair involving a particle (they're purely visual),
    // so inserting them wastes grid memory and forces O(particles) extra
    // inner-loop iterations on every neighbour scan for no effect.
    // Peak cell population is tracked by the bucket store itself now (same
    // value, counted at the same moment — on each push).
    let dynN = 0;
    // Awake-only count drives the PerfController throttle: an asleep shard
    // skips pair-resolution math (resolveShardPairs bails on asleep↔asleep),
    // so a field of settled bodies costs almost nothing and must NOT pin the
    // load — same principle as the collectible-drop exclusion below.  Without this,
    // never-sleeping metal composites accumulate on mixed maps and throttle
    // shared passes (shardPair/colorBlend/…), starving nebula collisions.
    let awakeCount = 0;
    const dynamicEntities = this.dynamicEntities;
    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (!e.active || e.isExploding) continue;

        // Reset per-substep repel-impulse accumulator BEFORE the
        // static-grid skip — repel-emitting tiles (mass=∞) also
        // accumulate on the emitter side so RenderSystem can drive
        // glow off impulse and light up for any nearby repellable
        // body, not just the player.
        if (e.repelImpulse !== 0) e.repelImpulse = 0;

        // Static structures are already in staticGrid. Do NOT add them here.
        if (e.mass === Infinity && e.type !== EntityType.INTERACTABLE) continue;

        // Collectible drops (salvage / health / any future pickup) are non-physics
        // bodies: magnet-pulled + proximity-collected only (see GameEngine drop
        // scan).  Keeping them out of the dynamic grid removes their collision
        // cost AND their contribution to lastMaxCellDensity / lastDynamicCount,
        // so a lingering drop pile no longer pins the PerfController load — and,
        // crucially, means projectiles pass THROUGH them (they can't be shot).
        // Routed through the DROP_TYPES registry so new pickup types are covered
        // automatically.
        if (isCollectibleDrop(e)) continue;

        // Particles never interact in resolveCollision — skip the grid.
        if (e.type === EntityType.PARTICLE) continue;

        // Fading nebulas (tiles and shards alike) are in their death
        // animation — drop them out of broadphase so they can't be
        // re-shattered mid-fade even after the striker's cooldown expires.
        if (e.mergeFadeTimer !== undefined) continue;

        // Nebula shards re-enter the dynamic grid so player/enemy contact
        // can trigger a shatter.  The nebula branch in resolveCollision is
        // still pass-through (no impulse), so they never exchange momentum
        // with anything — only the shatter side-effect fires.
        dynamicEntities[dynN++] = e;
        if (!e.asleep) awakeCount++;

        this.dynamicGrid.push(cellKey(e.position.x, e.position.y), e);
    }
    // Truncate only when the working set actually shrank.  Assigning
    // `length` unconditionally every substep is the churn this is avoiding.
    if (dynamicEntities.length !== dynN) dynamicEntities.length = dynN;
    this.lastMaxCellDensity = this.dynamicGrid.maxDensity;
    this.lastDynamicCount = awakeCount;

    // 3. Check Collisions: Only iterate DYNAMIC entities as primary
    //    subjects, AND skip shards as outer-loop subjects entirely.
    //    Shards stay in dynamicGrid so non-shard outer loops still
    //    catch them in 3×3 scans (covers shard ↔ projectile / player /
    //    enemy pairs once each via id ordering).  Shard ↔ shard pairs
    //    are handled by resolveShardPairs() at the ShPair cadence.
    //    Removing shard outer loops cuts the per-frame pair-enum
    //    work by roughly the shard:non-shard ratio — a major win on
    //    populated maps where shards dominate.
    for (let i = 0; i < dynamicEntities.length; i++) {
        const a = dynamicEntities[i];

        const cx = Math.floor(a.position.x / SPATIAL_GRID_SIZE);
        const cy = Math.floor(a.position.y / SPATIAL_GRID_SIZE);

        // ── Repel-field scan (static tiles only) ─────────────────────
        // Hoisted: dynamic-side immunity — projectiles and particles
        // bypass repel unconditionally, and mobile-shard variants
        // marked `repelImmune` (today: glass-shard, plastic-shard —
        // same substance as their parent tile) drift through every
        // field unimpeded.  Per-emitter immunity via
        // `repelImmuneFrom` checked inside the inner loop (today
        // metal-shard ignores glass-tile only).  Computed once per
        // scanner; static-side emitter check (variant.repel) still
        // varies per pair.
        //
        // The walk runs for EVERY repellable scanner, including
        // mobile shards (which the SAT outer loop below skips).  That
        // way a rock-shard or nebula-shard inside a glass / metal
        // field still gets pushed.  Per cell: a Map lookup + a
        // variant-emitter check; per repel-emitting tile: a single
        // distance compare and (when in range) one sqrt + one
        // velocity nudge.  No allocations on the hot path.
        const aVariantDef = a.shardVariant !== undefined ? SHARD_VARIANTS[a.shardVariant] : undefined;
        // Map-level short-circuit: when the current map has zero static
        // tiles emitting a repel field, the 5×5 cell scan below will
        // find no emitters in any cell, so skip the walk entirely.
        const aRepellable =
            this._anyRepelTilesPresent
            && a.type !== EntityType.PROJECTILE
            && a.type !== EntityType.PARTICLE
            && aVariantDef?.repelImmune !== true;
        // Hoisted per-emitter immunity list — metal-shard ignores
        // glass-tile repel but feels every other field.  Undefined
        // for the common case (no per-emitter filtering).
        const aImmuneFrom = aVariantDef?.repelImmuneFrom;
        if (aRepellable) {
            for (let x = -2; x <= 2; x++) {
                for (let y = -2; y <= 2; y++) {
                    const cell = this.staticGrid.get(cellKeyFromCell(cx + x, cy + y));
                    if (!cell) continue;
                    for (let j = 0; j < cell.length; j++) {
                        const b = cell[j];
                        if (!b.active || b.shardVariant === undefined) continue;
                        if (aImmuneFrom !== undefined && aImmuneFrom.indexOf(b.shardVariant) !== -1) continue;
                        const repel = SHARD_VARIANTS[b.shardVariant].repel;
                        if (repel === undefined) continue;
                        // Torus-correct delta so a tile near one
                        // seam still pushes a player on the other.
                        const dx = wrapDeltaX(b.position.x, a.position.x);
                        const dy = wrapDeltaY(b.position.y, a.position.y);
                        const distSq = dx * dx + dy * dy;
                        const rangeSq = repel.range * repel.range;
                        if (distSq > 1 && distSq < rangeSq) {
                            const dist = Math.sqrt(distSq);
                            // Quadratic falloff — peaks at centre,
                            // zero at the range edge.  Steeper outer
                            // ramp than linear (force ~0.25 at half-
                            // range vs 0.5 linear) so the outer field
                            // is a soft hint and most of the push
                            // comes near the tile.
                            const t = 1 - dist / repel.range;
                            const accel = repel.strength * t * t * timeScale;
                            const inv = 1 / dist;
                            // The PUSH (outward velocity impulse) is DBG-gated;
                            // the glow feedback below (repelImpulse) still runs
                            // so tiles light up to a nearby body even with the
                            // push off.
                            if (this.repelPushEnabled) {
                                a.velocity.x += dx * inv * accel;
                                a.velocity.y += dy * inv * accel;
                            }
                            // ── `repelImpulse` CARRIES TWO MEANINGS ──────────
                            // One field name, two different accumulators, and
                            // the difference is the gate below.  Read both
                            // before changing either.
                            //
                            // (1) On the SCANNER `a` — the body moving through
                            // the field.  Accumulates from ANY repellable body,
                            // mobile shards included, and drives that body's OWN
                            // fade effects.  Ungated.
                            a.repelImpulse = (a.repelImpulse ?? 0) + accel;
                            // (2) On the TILE `b` — the emitter of the field,
                            // whose glow this drives (the "Model B" repel glow
                            // on glass + metal).  Accumulates ONLY from the
                            // player and enemies, NOT from the many mobile
                            // shards drifting through — ambient shard contact
                            // would keep the glow lit constantly.  Lighting up
                            // to the player's repel field is the primary intent;
                            // enemy emission is deliberate and shipped, so any
                            // refactor that loses it is a regression.
                            if (a.type === EntityType.PLAYER || a.type === EntityType.ENEMY) {
                                b.repelImpulse = (b.repelImpulse ?? 0) + accel;
                            }
                        }
                    }
                }
            }
        }

        // Mobile shards (STRUCTURE finite mass) are SKIPPED as
        // outer-loop subjects — non-shard outer loops cover their
        // pairs via 3x3 mutual scan, and shard ↔ shard runs in
        // resolveShardPairs.  The repel walk above already ran for
        // them when applicable.
        if (a.type === EntityType.STRUCTURE) continue;

        // Check 3x3 neighbor cells — cell coords wrap across the seam so
        // entities near the edge see their counterparts on the opposite
        // side of the map.  checkAndResolveCollision handles the world-
        // space offset required to make SAT see the right geometry.
        for (let x = -1; x <= 1; x++) {
            for (let y = -1; y <= 1; y++) {
                const key = cellKeyFromCell(cx + x, cy + y);

                // Retrieve candidates from BOTH grids
                const dynamicCandidates = this.dynamicGrid.get(key);
                const staticCandidates = this.staticGrid.get(key);

                // Check Dynamic vs Dynamic
                if (dynamicCandidates) {
                    for (let j = 0; j < dynamicCandidates.length; j++) {
                        const b = dynamicCandidates[j];
                        if (a === b) continue;
                        if (!b.active || b.isExploding) continue;
                        // Avoid double-processing: id ordering is only
                        // needed when BOTH parties may iterate the pair
                        // from their own outer loop.  Shards are
                        // skipped from outer-loop iteration above, so
                        // when b is a shard the pair can ONLY be hit
                        // from a's (non-shard) outer loop — process it
                        // regardless of id ordering.  For non-shard
                        // pairs the id check still dedupes.
                        if (b.type !== EntityType.STRUCTURE && a.id > b.id) continue;

                        // ── Type-pair filter: skip pairs that resolve-
                        // Collision always discards BEFORE the expensive
                        // SAT geometry pass.  In late waves with dense
                        // shard clusters (max cell 100+), these filters
                        // eliminate ~60 % of total pair checks.
                        const ta = a.type, tb = b.type;

                        // Projectile-projectile: resolveCollision returns
                        // immediately (no proj-proj interaction).
                        if (ta === EntityType.PROJECTILE && tb === EntityType.PROJECTILE) continue;

                        // Note: shard ↔ shard is unreachable here
                        // because shards are skipped from the outer
                        // loop above.  Those pairs run in
                        // resolveShardPairs() at the ShPair cadence.

                        this.checkAndResolveCollision(a, b, onDamage, onDeath, onShake, onHit);
                    }
                }

                // Check Dynamic vs Static
                if (staticCandidates) {
                    for (let j = 0; j < staticCandidates.length; j++) {
                        const b = staticCandidates[j];
                        if (!b.active) continue;

                        this.checkAndResolveCollision(a, b, onDamage, onDeath, onShake, onHit);
                    }
                }
            }
        }
    }
  }

  public removeStaticEntity(entity: GameEntity) {
      const key = cellKey(entity.position.x, entity.position.y);
      const cell = this.staticGrid.get(key);
      if (cell) {
          const idx = cell.indexOf(entity);
          if (idx !== -1) {
              cell.splice(idx, 1);
          }
      }
  }

  public addStaticEntity(entity: GameEntity) {
      const key = cellKey(entity.position.x, entity.position.y);
      let cell = this.staticGrid.get(key);
      if (!cell) {
          cell = [];
          this.staticGrid.set(key, cell);
      }
      if (!cell.includes(entity)) {
          cell.push(entity);
      }
  }

  // Apply one dent step to a tile whose variant declares a `dent` policy.
  // Called immediately after each damage event (projectile hit, player
  // crash, asteroid crash) and short-circuits for variants without a
  // dent policy.  Mutates only the single polygon vertex closest to
  // the impactor's world position — pulled inward by a random fraction
  // in [0, vertexJitter] of its current radius from the polygon
  // centroid (entity-local origin).  Other vertices stay put so the
  // edges shared with neighbouring tiles don't separate.  No
  // allocation in the hot path.
  //
  // Deliberately does NOT touch entity.size: the collision footprint
  // stays stable so AABB broadphase keeps working unchanged.  The
  // visible silhouette crumples asymmetrically on the hit side as
  // vertices accumulate inward pulls; the shard spawned at detach
  // time reads its size from the dented polygon's bounding extent
  // (see DropSystem.spawnDentShard).
  /**
   * Probabilistic early break for rock tiles / asteroids / rock-shards.
   * Their `maxHealth` is the size/density hit ceiling (ROCK_BREAK), not a
   * flat HP: the rock always survives (cracks) on the first hit, and from
   * the second hit on each hit rolls an early break whose odds climb to a
   * guaranteed break once the ceiling is reached.  Bigger / denser rocks
   * have a higher ceiling, so the same hit number is a smaller fraction and
   * they resist longer.  Zeroes `health` on a successful roll so the
   * caller's `health <= 0` death path shatters it on this hit.  No-op for
   * non-rock variants and already-dead entities.
   */
  public static maybeRockEarlyBreak(target: GameEntity): void {
      if (target.health === undefined || target.health <= 0) return;
      if (target.shardVariant !== 'rock-tile' && target.shardVariant !== 'rock-shard') return;
      const ceiling = target.maxHealth ?? ROCK_BREAK.MIN_HITS;
      const hitsTaken = ceiling - target.health;
      if (Math.random() < rockBreakChance(hitsTaken, ceiling)) target.health = 0;
  }

  /**
   * Directional arc-shield gate.  Returns true if the shield should absorb a
   * hit from projectile `proj` — always true for a full bubble (no
   * shieldArcHalfWidth), and true for an arc shield only when the shot's
   * INCOMING bearing falls within ±halfWidth of the sweeping shieldArcAngle.
   *
   * The incoming bearing is taken from the projectile's reversed velocity (the
   * side it came FROM), not its current position: a fast shot can overshoot
   * deep past the shield in one step, so its position at the collision frame
   * may sit on the far side of the hull and give the wrong side — the travel
   * direction does not.  Falls back to the position bearing only if the
   * projectile has no usable velocity.  Toroidal.
   */
  /** SFX sink (SFX_INVENTORY §4.3).  Set once by GameEngine; null in any
   *  context without audio.  A single generic hook rather than one
   *  callback per sound, so adding a physics-side sound is a call, not a
   *  signature change.  PhysicsSystem stays free of audio state. */
  public sfx: ((id: string, x: number, y: number,
                opts?: { gain?: number; pitch?: number }) => void) | null = null;

  /**
   * Reflect a projectile off a surface — the ONE deflection primitive.
   *
   * Three places in this engine bounce a bolt off something: a shield ring, a
   * bouncer round off a tile face, and (eventually) a parry or a mirror
   * hazard.  They differ only in WHERE the normal comes from and what happens
   * to ownership afterwards, so the mirror itself lives here and the caller
   * decides when it fires.
   *
   * `nx`/`ny` must be a UNIT normal pointing OUT of the surface.  Returns false
   * — changing nothing — when the bolt is not travelling into that surface
   * (`v·n >= 0`), which is what stops a just-deflected shot from being
   * deflected again by the same surface on the following step.  A projectile
   * with no velocity therefore also declines: it is not entering anything.
   *
   * TOROIDAL NOTE: positions are written in the CALLER'S frame.  The
   * broadphase shifts one body into the other's frame across a seam and
   * re-wraps afterwards, so this must not wrap on its own — doing so would
   * undo that shift mid-pair.
   */
  public static deflectProjectile(
      proj: GameEntity, nx: number, ny: number, opts?: DeflectOptions,
  ): boolean {
      const vx = proj.velocity?.x ?? 0;
      const vy = proj.velocity?.y ?? 0;
      const vdotn = vx * nx + vy * ny;
      if (vdotn >= 0) return false;

      // v' = v − 2(v·n)n.  For an axis-aligned normal this reduces to negating
      // one component, which is exactly what the bouncer's tile path did by
      // hand before it was folded onto this.
      let rx = vx - 2 * vdotn * nx;
      let ry = vy - 2 * vdotn * ny;

      const scale = opts?.speedScale;
      if (scale !== undefined && scale !== 1) { rx *= scale; ry *= scale; }

      const spread = opts?.spread;
      if (spread !== undefined && spread > 0) {
          const ang = (Math.random() - 0.5) * spread;
          const c = Math.cos(ang), sn = Math.sin(ang);
          const tx = rx * c - ry * sn;
          ry = rx * sn + ry * c;
          rx = tx;
      }

      proj.velocity.x = rx;
      proj.velocity.y = ry;
      proj.rotation = Math.atan2(ry, rx);

      if (opts?.snapX !== undefined) proj.position.x = opts.snapX;
      if (opts?.snapY !== undefined) proj.position.y = opts.snapY;

      // A deflected bolt is a DUMB ricochet unless the caller says otherwise.
      // A homing shot that keeps steering turns straight back into whatever
      // just turned it away and grinds the shield down in a loop — a real case
      // now that the PLAYER'S shield deflects, since enemy missiles home on
      // the player with no range gate.
      if (opts?.keepHoming !== true && proj.homing) {
          proj.homing = false;
          proj.targetEntityId = undefined;
      }

      // Re-owning is a PARRY rather than a ricochet: the bolt becomes the
      // deflector's, so the already-hit set has to clear or it would refuse
      // the very targets it is now aimed at.
      if (opts?.reownType !== undefined) {
          proj.ownerType = opts.reownType;
          proj.ownerId = opts.reownId;
          if (proj.hitEntityIds) proj.hitEntityIds.length = 0;
      }
      return true;
  }

  /** Radius at which a shield turns a shot away.
   *
   *  An ARC shield uses its own ring (which the Bulwark's render matches); any
   *  other pool uses the shield's physical standoff — the same
   *  `COLLISION_MULTIPLIER` the player's inflated collision shape and its
   *  rendered hit ring already use, so the ricochet happens exactly where the
   *  player sees the bubble. */
  public static shieldReach(e: GameEntity): number {
      if (e.shieldArcHalfWidth !== undefined) return PhysicsSystem.arcShieldReach(e);
      return getCollisionR(e) * SHIELD_CONSTANTS.COLLISION_MULTIPLIER;
  }

  public static shieldCoversHit(target: GameEntity, proj: GameEntity): boolean {
      const half = target.shieldArcHalfWidth;
      if (half === undefined) return true; // full bubble
      return PhysicsSystem.sectorCoversHit(target, proj, target.shieldArcAngle ?? 0, half);
  }

  /**
   * Shared directional-cover test: does `proj` arrive inside the sector of
   * half-width `half` centred on `center` (world radians) around `target`?
   *
   * Gated on the shot's TRAVEL direction, not its position, so a fast bolt that
   * overshoots the hull can't tunnel in from the covered side and count as an
   * open-side hit.  Falls back to the relative bearing for shots with no
   * velocity.  Toroidal.  Used by BOTH the Bulwark's arc shield (a depleting
   * pool centred on `shieldArcAngle`) and the (h) `front-shield` trait (a
   * permanent plate centred on the entity's FACING).
   */
  public static sectorCoversHit(target: GameEntity, proj: GameEntity, center: number, half: number): boolean {
      let bearing: number;
      const vx = proj.velocity?.x ?? 0, vy = proj.velocity?.y ?? 0;
      if (vx * vx + vy * vy > 1e-6) {
          bearing = Math.atan2(-vy, -vx); // direction the shot came from
      } else {
          bearing = Math.atan2(
              wrapDeltaY(target.position.y, proj.position.y),
              wrapDeltaX(target.position.x, proj.position.x),
          );
      }
      let d = bearing - center;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return Math.abs(d) <= half;
  }

  /** (h) `front-shield` trait: is this hit landing on the plate?  The plate is
   *  centred on the entity's FACING and never depletes — so the counterplay is
   *  geometric (flank / ricochet in from behind) or path-based (chains and
   *  shockwave rings damage outside this projectile path entirely). */
  public static frontShieldCoversHit(target: GameEntity, proj: GameEntity): boolean {
      const cfg = target.frontShield;
      if (!cfg) return false;
      return PhysicsSystem.sectorCoversHit(target, proj, target.rotation, (cfg.deg * Math.PI / 180) / 2);
  }

  /** World-unit radius of an arc shield's interception ring (matches the
   *  rendered ring).  The arc branch of `shieldReach`. */
  public static arcShieldReach(e: GameEntity): number {
      return Math.max(e.size.x, e.size.y) * SHIELD_CONSTANTS.ARC_REACH_FACTOR;
  }

  /**
   * Shield interception — EVERY live shield, not just the Bulwark's arc.
   *
   * When an incoming hostile projectile crosses the shield ring, the shield
   * DEFLECTS it off that surface and drains by the shot's damage — so the bolt
   * ricochets away (readable, and a hazard to whatever it can still hit)
   * instead of vanishing, while the shield still wears down.  This was
   * arc-only; the player's own bubble and the bosses' pools now go through the
   * same path, because "my shield ate that" and "my shield turned that away"
   * are the same event and were reading as two different ones.
   *
   * THE ARITHMETIC IS UNCHANGED by that generalization: a deflected shot drains
   * exactly the `damage` the SAT absorb path would have absorbed, and a shot
   * bigger than the remaining pool still falls through to that path.  What
   * changes is what the bolt does afterwards.
   *
   * Returns true if the pair was handled (caller skips the body SAT).  Returns
   * false — letting the shot proceed to the hull — when:
   *   - the pair isn't projectile-vs-shielded-entity,
   *   - the shield is empty, has no capacity, or is EMP'd offline,
   *   - the shot is one this target may not be hit by at all (own fire, an
   *     ally's shot passing through the player, a rival's shot at a rival),
   *   - the shot is outside the ring or, for an ARC, on an UNCOVERED bearing,
   *   - the shot's damage exceeds the remaining shield (it punches through; the
   *     body-SAT path drains the remaining shield and lands the remainder).
   */
  private tryShieldDeflect(
      a: GameEntity,
      b: GameEntity,
      onHit?: (impactPos: Vector2, proj: GameEntity, target: GameEntity) => void,
  ): boolean {
      let proj: GameEntity, shielded: GameEntity;
      if (a.type === EntityType.PROJECTILE && b.type !== EntityType.PROJECTILE) { proj = a; shielded = b; }
      else if (b.type === EntityType.PROJECTILE && a.type !== EntityType.PROJECTILE) { proj = b; shielded = a; }
      else return false;
      if ((shielded.shield ?? 0) <= 0 || (shielded.maxShield ?? 0) <= 0) return false;
      // An EMP'd shield is OFFLINE — it neither absorbs nor recharges, so it
      // cannot deflect either.  The SAT absorb path has always checked this;
      // the arc path did not, which only stopped being a live hole once the
      // player — the one entity the bubble's latch EMPs — started deflecting.
      if (shielded.systemsDisabled) return false;
      // Don't let the shield deflect its owner's own fire (same-team projectile).
      if (proj.ownerType === shielded.type) return false;
      // These two mirror the SAT path's filters.  A shot that may not hit this
      // target must not bounce off it either — an ally rival's fire passes
      // THROUGH the player, so ricocheting it off the player's shield would
      // invent a collision the damage path has always declined.
      if (shielded.type === EntityType.PLAYER && proj.sparesPlayer) return false;
      if (proj.hitsEnemies && shielded.isRival) return false;

      // ARC ONLY.  A ring that stands OFF the hull has to intercept before
      // the body SAT, because the bolt would otherwise fly through the gap
      // between ring and hull untouched.  A non-arc pool is the opposite
      // case — its ring IS the (shield-inflated) collision shape — so it
      // deflects at CONTACT instead, in `resolveCollision`; predicting that
      // contact with a radius here cannot be made to agree, because SAT
      // boxes an entity with no `polygonPoints` and a box's corners reach
      // √2 past the circle the ring is drawn as.  See the contact block.
      if (shielded.shieldArcHalfWidth === undefined) return false;

      // The bolt touches the ring when its EDGE does, not when its centre
      // crosses, so the test carries the projectile's own radius.
      const reach = PhysicsSystem.shieldReach(shielded) + getCollisionR(proj);
      const dx = wrapDeltaX(shielded.position.x, proj.position.x);
      const dy = wrapDeltaY(shielded.position.y, proj.position.y);
      const distSq = dx * dx + dy * dy;
      if (distSq > reach * reach) return false;                  // not at the ring yet
      if (!PhysicsSystem.shieldCoversHit(shielded, proj)) return false; // open side → hull

      // A shot bigger than the remaining shield punches through — let the body
      // SAT path do the existing partial absorb so the shield isn't double-
      // counted.
      const projDmg = proj.damage || 1;
      if (projDmg > shielded.shield!) return false;

      // Radial normal at the impact (outward from the shield centre), and a
      // snap to the ring surface so the bolt rides outward and can't
      // re-trigger / SAT the hull on the next step.  The shared helper
      // declines an outward-moving bolt — one already deflected — which is
      // what keeps a ricochet from being deflected again every step.
      const dist = Math.sqrt(distSq) || 1;
      const nx = dx / dist, ny = dy / dist;
      // Same parry rule as the contact site: the PLAYER'S deflect re-owns
      // the bolt (no player entity carries an arc today, but a future arc
      // module must not silently lose the parry).  Enemy arcs keep the
      // plain ricochet — the bolt keeps ITS owner, which for the Bulwark
      // case (a player shot turned away) already leaves it live against
      // other enemies.
      if (!PhysicsSystem.deflectProjectile(proj, nx, ny, {
          snapX: shielded.position.x + nx * (reach + 1),
          snapY: shielded.position.y + ny * (reach + 1),
          ...(shielded.type === EntityType.PLAYER ? {
              reownType: EntityType.PLAYER, reownId: 'player',
              keepHoming: true,
          } : {}),
      })) return false;

      shielded.shield! -= projDmg;
      markShieldDamaged(shielded);
      shielded.shieldHitFlash = SHIELD_CONSTANTS.HIT_FLASH_DURATION;
      shielded.shieldRechargeTimer = SHIELD_CONSTANTS.RECHARGE_DELAY;
      // A ricochet, not a landing: the deflect voice RISES in pitch, which
      // is the information the player needs.  A hit that empties the pool
      // still gets the louder COLLAPSE cue instead — "that was the last of
      // it" is the one thing more urgent than "that bounced", and the SAT
      // absorb path has always said it.
      this.sfx?.(shielded.shield! <= 0 ? 'impact.shield.break' : 'impact.shield.deflect',
                 proj.position.x, proj.position.y);
      if (onHit) onHit(proj.position, proj, shielded); // spark at the ring
      return true;
  }

  public static applyDentStep(tile: GameEntity, impactWorldPos: Vector2) {
      if (tile.shardVariant === undefined) return;
      const dent = SHARD_VARIANTS[tile.shardVariant].dent;
      if (dent === undefined) return;
      // Triangle-delete variants do their polygon mutation + shard
      // spawn in GameEngine.spawnDamageText (it needs entities-array
      // access for the spawn).  Skip the in-place vertex pull here so
      // the two paths don't fight over the same polygon.
      if (dent.kind !== undefined && dent.kind !== 'pull') return;

      // PROGRESSIVE fracture variants (V8) skip the dent pull entirely
      // under voronoi mode: the decomposition is applied once and FIXED —
      // boundaries highlight and pieces break off along it — so the
      // polygon must stay stable between detaches (a per-hit pull would
      // drift the pattern off the shape and wedge the arc splice).  The
      // highlight + break-off IS the per-hit damage read for these
      // materials; under the DBG 'legacy' mode the dent runs as shipped.
      const fract = SHARD_VARIANTS[tile.shardVariant].fracture;
      if (fract?.progressive === true
          && SHARD_VARIANTS[tile.shardVariant].shatter.kind === 'voronoi'
          && getActiveFractureMode() === 'voronoi') return;

      const pts = tile.polygonPoints;
      if (!pts || pts.length === 0) return;

      // The dent mutates the polygon in place — the fracture
      // decomposition is computed on the deformed shape, so the cache
      // dies here and lazily recomputes on the next read (voronoi
      // gauntlet; ~0.1 ms per damage event, never per frame).  EXCEPT on
      // the KILLING blow: the damage path decrements health BEFORE this
      // dent step, so health ≤ 0 here means the entity dies this event —
      // keeping the cache makes the shatter consume exactly the
      // decomposition whose edges were drawn as cracks last frame, so
      // the fragments separate along the lines the player was shown
      // (the final dent never renders; V3 acceptance).
      if (tile.health === undefined || tile.health > 0) {
          tile.fractureCells = undefined;
          tile.fractureEdges = undefined;
      }

      // Plastic dent recovery: snapshot the polygon BEFORE this dent
      // into the module-level _dentPreSnapshot scratch buffer (zero
      // per-dent allocation), then compute the post-dent delta after
      // the pull + preserve rescale.  Delta is stored on plasticDent
      // History as a Float64Array (one typed-array allocation per
      // dent instead of N+1 Vector2 objects).  Layout: 2i = x, 2i+1
      // = y.
      const isPlasticDent = tile.shardVariant === 'plastic-shard'
                         || tile.shardVariant === 'plastic-tile';
      const ptsLen = pts.length;
      if (isPlasticDent) {
          // Snapshot is bounded by the scratch buffer size (16 = 8
          // verts).  Variants with bigger polygons would silently
          // truncate here — bump _dentPreSnapshot if that ever
          // becomes a concern.
          for (let i = 0; i < ptsLen; i++) {
              _dentPreSnapshot[2 * i]     = pts[i].x;
              _dentPreSnapshot[2 * i + 1] = pts[i].y;
          }
      }

      // Capture pre-dent max vertex radius for preserveBoundingRadius
      // variants (today: plastic-shard).  Scaled below so the post-
      // dent bounding circle matches.
      let preMaxR2 = 0;
      if (dent.preserveBoundingRadius) {
          for (let i = 0; i < pts.length; i++) {
              const r2 = pts[i].x * pts[i].x + pts[i].y * pts[i].y;
              if (r2 > preMaxR2) preMaxR2 = r2;
          }
      }

      // Impact in entity-local coords (centroid at origin), with
      // toroidal wrap so impacts across the seam pick the right side.
      // wrapDeltaX(from, to) returns (to - from), so pass tile first
      // to get (impact - tile) — i.e. the impact's offset from the
      // tile centre.
      let dirX = wrapDeltaX(tile.position.x, impactWorldPos.x);
      let dirY = wrapDeltaY(tile.position.y, impactWorldPos.y);

      // Optional rotation of the impact direction before the closest-
      // vertex search.  Rock uses Math.PI/2 so the dent appears on a
      // side perpendicular to the impact — reads as "a chunk pinches
      // off the side while the tile stays in the grid."  Plastic and
      // metal leave this 0 (dent where hit).
      const angleOffset = dent.dentVertexAngleOffset;
      if (angleOffset !== undefined && angleOffset !== 0) {
          const cosA = Math.cos(angleOffset);
          const sinA = Math.sin(angleOffset);
          const rx = dirX * cosA - dirY * sinA;
          const ry = dirX * sinA + dirY * cosA;
          dirX = rx;
          dirY = ry;
      }

      let bestIdx = 0;
      let bestD2 = Infinity;
      for (let i = 0; i < pts.length; i++) {
          const dx = pts[i].x - dirX;
          const dy = pts[i].y - dirY;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) {
              bestD2 = d2;
              bestIdx = i;
          }
      }

      // Pull N adjacent vertices symmetrically around the closest
      // one (rock uses 3 to deform a wider region per hit; plastic /
      // metal default to 1 for a single-vertex pinch).  Of these
      // pulled vertices, `deepCount` get the centerVertexJitterMul
      // boost (rock uses 2 — the closest vertex plus one randomly-
      // chosen neighbour — for a chaotic two-notch fracture).  The
      // closest-to-impact vertex (offset 0, loop index `half`) is
      // always one of the deep slots; remaining deep slots are
      // sampled uniformly without replacement from the rest of the
      // pulled set via the standard reservoir-style pass below.
      // Each pulled vertex still draws its own random magnitude so
      // pulls aren't uniform within either subset.
      //
      // The per-vertex multiplicative factor k is clamped to a small
      // positive floor (0.05) so high-jitter rolls don't pull a
      // vertex past the polygon centroid and flip it through the
      // origin — that would invert winding and break SAT collision.
      // With the clamp, an "infinitely deep" pull bottoms out at 5 %
      // of the vertex's current radius.
      const pullCount = Math.max(1, dent.pullVertexCount ?? 1);
      const centerMul = dent.centerVertexJitterMul ?? 1;
      const deepCount = Math.min(pullCount, Math.max(1, dent.deepVertexCount ?? 1));
      const N = pts.length;
      const half = Math.floor(pullCount / 2);
      const K_MIN = 0.05;

      // Bitmask of loop indices marked as deep.  Closest vertex
      // (offset 0, index `half`) is always deep; remaining slots
      // chosen via a reservoir pass over the non-centre indices.
      let deepMask = 1 << half;
      if (deepCount > 1) {
          let remaining = deepCount - 1;
          let available = pullCount - 1;
          for (let i = 0; i < pullCount && remaining > 0; i++) {
              if (i === half) continue;
              if (Math.random() * available < remaining) {
                  deepMask |= 1 << i;
                  remaining--;
              }
              available--;
          }
      }

      for (let i = 0; i < pullCount; i++) {
          const offset = i - half;
          const idx = ((bestIdx + offset) % N + N) % N;
          const isDeep = (deepMask & (1 << i)) !== 0;
          const jitterMag = dent.vertexJitter * (isDeep ? centerMul : 1);
          const k = Math.max(K_MIN, 1 - Math.random() * jitterMag);
          pts[idx].x *= k;
          pts[idx].y *= k;
      }

      // preserveBoundingRadius rescale (today: plastic-shard).  After
      // pulling, find the new max radius and scale every vertex by
      // preMaxR / postMaxR so the bounding circle holds at its pre-
      // dent extent.  The pulled vertex is now at a smaller radius
      // than its neighbours after the scale — visible asymmetric
      // deformation, no overall shrink.
      if (dent.preserveBoundingRadius && preMaxR2 > 0) {
          let postMaxR2 = 0;
          for (let i = 0; i < pts.length; i++) {
              const r2 = pts[i].x * pts[i].x + pts[i].y * pts[i].y;
              if (r2 > postMaxR2) postMaxR2 = r2;
          }
          if (postMaxR2 > 0 && postMaxR2 < preMaxR2) {
              const scale = Math.sqrt(preMaxR2 / postMaxR2);
              for (let i = 0; i < pts.length; i++) {
                  pts[i].x *= scale;
                  pts[i].y *= scale;
              }
          }
      }

      // Plastic dent recovery: push this hit's per-vertex delta onto
      // plasticDentHistory with its own timer.  Delta is a flat
      // Float64Array (2N: alternating x,y) — one typed-array
      // allocation per dent instead of an Array + N {x,y} objects.
      // When the timer expires, ShardSystem.tickPlasticDentRecovery
      // subtracts the delta from polygonPoints and removes the
      // entity from pendingPlasticDentEntities once history empties.
      if (isPlasticDent) {
          const delta = new Float64Array(2 * ptsLen);
          for (let i = 0; i < ptsLen; i++) {
              delta[2 * i]     = pts[i].x - _dentPreSnapshot[2 * i];
              delta[2 * i + 1] = pts[i].y - _dentPreSnapshot[2 * i + 1];
          }
          if (!tile.plasticDentHistory) tile.plasticDentHistory = [];
          tile.plasticDentHistory.push({
              timer: PLASTIC_DENT_RECOVERY.DELAY_SECONDS,
              delta,
          });
          // Register for the recovery pass — the Set short-circuits
          // tickPlasticDentRecovery's full-entity walk.
          pendingPlasticDentEntities.add(tile);
      }

      // Plastic-tile damage colour shift toward the shard palette.
      // Lazy-init the original + target on first dent (target picks
      // one random shard shade and stays sticky), then lerp tile.
      // color from original to target by (1 - hpRatio).  At HP=0 the
      // colour equals the full shard shade and the existing break
      // path fires.
      if (tile.shardVariant === 'plastic-tile') {
          if (tile.plasticTileOriginalColor === undefined) {
              tile.plasticTileOriginalColor = tile.color;
          }
          if (tile.plasticTileTargetColor === undefined) {
              tile.plasticTileTargetColor = randomPlasticShardShade();
          }
          const maxHP = tile.maxHealth ?? 1;
          const hpRatio = Math.max(0, Math.min(1, tile.health / maxHP));
          const t = 1 - hpRatio;
          tile.color = lerpHexColors(
              tile.plasticTileOriginalColor!,
              tile.plasticTileTargetColor!,
              t,
          );
      }

      // polygonPoints mutated → invalidate any cached SAT axes (the
      // edge normals derived from those points are now stale) AND the
      // static-tile world-canvas stamp (which baked the old polygon
      // outline).  Both caches re-populate lazily on next use.
      tile._satCacheAxes = undefined;
      tile._occluderR = undefined;   // the shadow radius is derived from the polygon
      if (tile._staticCached === true) tile._staticCached = false;

      // Damage cracks are no longer appended here.  Rock / metal tiles
      // and shards now share the seeded, HP-driven crack overlay in
      // RenderSystem.drawDamageCracks (keyed off health/maxHealth), so
      // the fracture pattern is deterministic per entity and accrues as
      // HP drops rather than spawning fresh random segments per hit.
  }

  // ── THE STATIC-GEOMETRY QUERY LAYER ─────────────────────────────────
  //
  // Five callers used to walk the static grid with five near-identical
  // copies of the same loop.  They differed in three ways and agreed on
  // everything else, so gauntlet B2 collapsed them onto ONE walk plus five
  // thin wrappers that supply the differences:
  //
  //   - SPAN     how many cells out to look.  Four of the five hardcoded a
  //              3x3 neighbourhood, which covers a radius of at most
  //              SPATIAL_GRID_SIZE (120).  Every one of those callers
  //              queries well under 120 (measured max: 78.4, the dragon's
  //              head reach), so the fixed span is preserved for them and
  //              costs nothing.  The lighting pass queries at 300-500,
  //              where a 3x3 walk silently under-reports by 28-45%, and it
  //              passes a span derived from the radius instead.
  //   - FILTER   a toroidal radius test, or none at all (the shard-to-tile
  //              bond pass wants every tile in the block and applies its
  //              own contact test).  `rSq < 0` means "no filter".
  //   - VISITOR  collect-everything, or stop at the first hit.  Returning
  //              `false` from the visitor stops the walk.
  //
  // The probe is WRAPPED, which was the one substantive disagreement
  // between the old copies and is a FIX rather than a tidy-up.  See
  // `forEachStaticCells` for why.

  /** The one static-grid walk.  See the block comment above for what the
   *  parameters mean; `rSq < 0` disables the distance filter, and a visitor
   *  returning `false` stops the walk.
   *
   *  WHY THE PROBE IS WRAPPED.  Two of the five old copies wrapped their
   *  probe coordinates and two did not, and the difference was not
   *  cosmetic — it was a latent correctness bug that fires on any map whose
   *  dimensions are not a multiple of SPATIAL_GRID_SIZE.
   *
   *  `SPATIAL_COLS = ceil(MAP_WIDTH / 120)`, so such a map has a RAGGED
   *  last column and `floor((x + MAP_WIDTH) / 120)` is NOT
   *  `floor(x / 120) + SPATIAL_COLS`.  `wrapCellX` therefore lands an
   *  un-wrapped probe on a DIFFERENT cell than the wrapped one, and the
   *  block around it is off by one cell.  Measured: on Universe (16000,
   *  i.e. 133.33 cells) the two disagree on the cell index for 66.7% of
   *  positions, and a seam sweep found `isPositionClear` reporting a
   *  position CLEAR that is actually BLOCKED.  Rare (~1 in 33 000 queries)
   *  because the callers' radii are small against a 120 cell, but real, and
   *  in the unsafe direction.  Universe and Pocket are affected; the maps
   *  sized at a multiple of 120 never were.
   *
   *  This matters because `wrapDeltaX` applies a SINGLE correction step, so
   *  it too is only correct for inputs already inside the canonical box.
   *  Wrapping once, here, makes the whole layer correct for any caller. */
  private forEachStaticCells(
      x: number, y: number, span: number, rSq: number,
      visit: (t: GameEntity) => boolean | void,
      dynamic: boolean = false,
  ): void {
      const wx = wrapX(x);
      const wy = wrapY(y);
      const cx = Math.floor(wx / SPATIAL_GRID_SIZE);
      const cy = Math.floor(wy / SPATIAL_GRID_SIZE);
      // Clamp to half the grid extent: past that the wrapped cell indices
      // repeat and a cell would emit its tiles to the visitor twice.  At the
      // clamp the walk already covers the whole torus, so nothing is lost.
      // No shipped map is small enough for this to bite a span of 1.
      const spanX = Math.min(span, (SPATIAL_COLS - 1) >> 1);
      const spanY = Math.min(span, (SPATIAL_ROWS - 1) >> 1);
      const filter = rSq >= 0;
      for (let dx = -spanX; dx <= spanX; dx++) {
          for (let dy = -spanY; dy <= spanY; dy++) {
              const key = cellKeyFromCell(cx + dx, cy + dy);
              // ONE walk, two grids.  They are keyed on the same dense cell
              // index and expose the same `get(idx)`, so the only difference
              // is which one is asked — see the note on forEachDynamicInRadius
              // for why the dynamic grid is safe to read from the render pass.
              const cell = dynamic ? this.dynamicGrid.get(key) : this.staticGrid.get(key);
              if (!cell) continue;
              for (let i = 0; i < cell.length; i++) {
                  const t = cell[i];
                  if (!t.active) continue;
                  if (filter) {
                      const tdx = wrapDeltaX(t.position.x, wx);
                      const tdy = wrapDeltaY(t.position.y, wy);
                      if (tdx * tdx + tdy * tdy >= rSq) continue;
                  }
                  if (visit(t) === false) return;
              }
          }
      }
  }

  // Hoisted probe state + visitor for the two BOOLEAN wrappers.  A closure
  // built inside the wrapper would be constructed on every call, and
  // `hasStaticTileNear` runs ~9x per frame off the material-tile render
  // path — a per-frame allocation is exactly what the refill-idiom rule
  // exists to prevent.  A class-field arrow is allocated once per system.
  private _probeIgnoreId: string | undefined = undefined;
  private _probeHit = false;
  private readonly _probeVisit = (t: GameEntity): boolean => {
      if (this._probeIgnoreId !== undefined && t.id === this._probeIgnoreId) return true;
      this._probeHit = true;
      return false;   // stop the walk — these probes only need existence
  };

  /** Visit every active static tile whose centre is within `r` (toroidal) of
   *  (x,y).  The callback MUST NOT mutate the static grid (collect, then act).
   *  Used by the dragon to devour tiles in its path (Stage 6).
   *
   *  Keeps the historic 3x3 span.  Its only caller queries at most 78.4,
   *  which a 3x3 block fully covers, so this is behaviour-preserving —
   *  widening it would hand the dragon more terrain per pass and change
   *  pacing (gauntlet B3, deliberately not taken). */
  public forEachStaticNear(x: number, y: number, r: number, cb: (t: GameEntity) => void) {
      this.forEachStaticCells(x, y, 1, r * r, cb);
  }

  /** Visit every active static tile within `r` — the RADIUS-CORRECT walk,
   *  whose cell span is derived from the radius rather than fixed at 3x3.
   *  This is the one the lighting pass uses, where radii of 300-500 make
   *  the fixed span under-report by 28-45%. */
  public forEachStaticInRadius(x: number, y: number, r: number, cb: (t: GameEntity) => void): void {
      this.forEachStaticCells(x, y, Math.ceil(r / SPATIAL_GRID_SIZE), r * r, cb);
  }

  /** Visit every active DYNAMIC entity within `r` (toroidal) of (x,y).
   *
   *  Same walk as `forEachStaticInRadius`, over the other grid.  Used by the
   *  lighting pass so mobile shards cast shadows like tiles do.
   *
   *  WHY THE DYNAMIC GRID IS SAFE TO READ HERE.  It is rebuilt from scratch
   *  at the top of every collision substep and the render pass runs after
   *  the sim has drained the accumulator, so at draw time it holds the last
   *  substep's contents — which is exactly the state being drawn.  It is NOT
   *  safe to read mid-substep, and nothing does.
   *
   *  The grid holds more than shards (player, enemies, projectiles) and
   *  already excludes collectible drops, particles and fading nebula.
   *  Callers filter for what they want; this layer does not know about
   *  lighting. */
  public forEachDynamicInRadius(x: number, y: number, r: number, cb: (t: GameEntity) => void): void {
      this.forEachStaticCells(x, y, Math.ceil(r / SPATIAL_GRID_SIZE), r * r, cb, true);
  }

  /** True if world-space point (x, y) with radius `r` is clear of all static
   *  tiles — safe spawn-point validation. */
  public isPositionClear(x: number, y: number, r: number): boolean {
      this._probeIgnoreId = undefined;
      this._probeHit = false;
      this.forEachStaticCells(x, y, 1, r * r, this._probeVisit);
      return !this._probeHit;
  }

  /** True if an active static tile's centre lies within `radius` of (x, y),
   *  ignoring the tile whose id matches `ignoreId` (so a tile can probe for
   *  its own neighbours without finding itself).  Used by RenderSystem to
   *  suppress outline strokes on edges cleanly butted against a neighbour. */
  public hasStaticTileNear(x: number, y: number, radius: number, ignoreId?: string): boolean {
      this._probeIgnoreId = ignoreId;
      this._probeHit = false;
      this.forEachStaticCells(x, y, 1, radius * radius, this._probeVisit);
      this._probeIgnoreId = undefined;
      return this._probeHit;
  }

  /**
   * Iterate every active static tile in the 3x3 spatial cells around
   * (x, y) — NO radius filter.  Used by ShardSystem's plastic-shard to
   * tile bond formation, which applies its own contact test inside the
   * callback, so narrowing this to a radius here would duplicate that
   * test with a radius this layer cannot know.  Callbacks return early
   * (undefined) to skip a tile; they never stop the walk.
   */
  public forEachStaticTileNear(x: number, y: number, cb: (tile: GameEntity) => void): void {
      this.forEachStaticCells(x, y, 1, -1, cb);
  }

  /**
   * Cheap circle-only collision resolver for asteroid-asteroid pairs.
   *
   * Asteroids are roughly round (irregular convex polygons with radius
   * ≈ size.x / 2), so a full SAT pass is overkill — and prohibitively
   * expensive in dense clusters where a single cell can hold dozens of
   * shards giving O(k²) pair checks.  This routine uses toroidal-delta
   * distance, a single bounding-circle overlap test, and a mass-weighted
   * positional correction + elastic impulse.  Typical cost per pair is
   * ~10 multiplications and 1 sqrt.
   *
   * Collision radius is `size.x * 0.42`, not `size.x / 2` — the
   * generator places polygon points at a base radius of size × 0.41 with
   * ±25 % jitter, so the average visible extent sits near 0.42 × size.
   * Using the full size/2 fired the resolver at visible gaps where the
   * polygons clearly weren't touching, which read as "awkward" phantom
   * collisions.
   *
   * Per-entity positional correction is capped at MAX_SEPARATION_STEP
   * per frame so that first-frame encounters with a deeply-stacked
   * cluster (where many pairs have overlap ≈ sumR) ease apart over a
   * handful of frames instead of teleporting.  The elastic impulse is
   * applied every frame regardless so separation velocity builds up
   * quickly.
   */

  /**
   * Resolve the effective shard-pair frame interval, tick the
   * counter, and return whether the shard-pair pass should fire on
   * this physics substep.  Pulled out of handleEntityCollisions so
   * physics.update can decide whether to call resolveShardPairs at
   * all — skipping the function entirely (build + walk) is what
   * makes the DBG slider meaningfully move `coll` ms.
   *
   * N=0 (AUTO) selects the interval from the previous step's
   * `lastMaxCellDensity` per SHARD_PAIR_CONSTANTS.AUTO_THRESHOLDS.
   * Light fields keep N=1 (every-frame resolution); dense fields
   * climb so settled piles don't eat the frame budget.
   */
  public shouldRunShardPairsThisStep(): boolean {
    const pc = this.perfController;
    if (pc) {
        // The controller already folded `lastMaxCellDensity` (+ entity
        // count + sim time) into the load level and precomputed this
        // task's interval / run flag in beginStep().  The manual DBG
        // override (shardPairFrameInterval) was synced into the
        // controller before beginStep, so 0 = AUTO delegates here and
        // a manual pin still wins.
        this.lastEffectiveShardPairInterval = pc.effectiveInterval('shardPair');
        this.lastRunShardPair = pc.shouldRun('shardPair');
        return this.lastRunShardPair;
    }
    // Fallback (no controller wired): run every step.
    this.lastEffectiveShardPairInterval = 1;
    this.lastRunShardPair = true;
    return true;
  }

  /**
   * Symmetric gate for resolveShardTilePairs — same shape as
   * shouldRunShardPairsThisStep but with its own counter, interval,
   * and AUTO threshold table.  Both passes share the same density
   * signal (lastMaxCellDensity is a proxy for shard count, which
   * sets the outer-loop size for either scan).  Counter ticks only
   * when the parent toggle is on, so flipping the toggle doesn't
   * leave a half-cycled phase that desyncs the first post-enable
   * frame.
   */
  public shouldRunShardTilePairsThisStep(): boolean {
    const pc = this.perfController;
    if (pc) {
        this.lastEffectiveShardTilePairInterval = pc.effectiveInterval('shardTilePair');
        this.lastRunShardTilePair = pc.shouldRun('shardTilePair');
        return this.lastRunShardTilePair;
    }
    this.lastEffectiveShardTilePairInterval = 1;
    this.lastRunShardTilePair = true;
    return true;
  }

  /**
   * Dedicated shard ↔ shard pair-resolution pass.  Builds a fresh
   * shard-only spatial hash from the caller-supplied list of mobile
   * shards (typically `entityIndex.shardCandidates`), then walks
   * each shard's 3×3 cell neighbourhood for pairs and dispatches to
   * `resolveShardPair`.
   *
   * Called from physics.update gated by `shouldRunShardPairsThisStep()`,
   * so on skip-frames the entire build + walk are bypassed (this is
   * the savings the inline branch in handleEntityCollisions was
   * missing).  Fading shards (mergeFadeTimer set) are filtered
   * out — they shouldn't pull or push other shards during their
   * death animation.
   */
  private resolveShardPairs(
      shards: GameEntity[],
      onDeath?: (entity: GameEntity) => void,
  ): void {
    if (shards.length < 2) return;

    // Build the shard-only grid.  Same SPATIAL_GRID_SIZE as the main
    // dynamic grid so cell math and 3×3 scan radius are consistent
    // with everything else in the broadphase.  Asleep shards stay in
    // the grid (an awake neighbour must still find and resolve against
    // them); only the asleep↔asleep pair body is skipped below.
    // Viewport-gated cadence: this pass resolves both-offscreen pairs
    // only on the catch-up phase (every Nth call); on/near-screen pairs
    // resolve every call.  Compute the flags here (once per shard) so
    // the inner pair loop is a single bool read.  When no rect is set
    // or the gate is off, treat every shard as on-screen (offscreen=
    // false) so behaviour is identical to ungated resolution.
    this.shardPairCallCount++;
    const viewportGate = this.shardViewportCullEnabled && this.hasViewportRect;
    const catchUpPhase = (this.shardPairCallCount
        % SHARD_PAIR_CONSTANTS.OFFSCREEN_RESOLVE_DIVISOR) === 0;
    const vl = this.viewportLeft, vr = this.viewportRight;
    const vt = this.viewportTop, vb = this.viewportBottom;

    this.shardGrid.resize(cellCount());
    this.shardGrid.beginPass();
    let asleepCount = 0;
    let offscreenCount = 0;
    for (let i = 0; i < shards.length; i++) {
        const e = shards[i];
        if (!e.active || e.isExploding) continue;
        if (e.mergeFadeTimer !== undefined) continue;
        if (e.asleep === true) asleepCount++;
        if (viewportGate) {
            const r = (e.size.x > e.size.y ? e.size.x : e.size.y) * 0.5;
            e.offscreen = !isVisibleOnTorus(e.position.x, e.position.y, r, vl, vr, vt, vb);
            if (e.offscreen) offscreenCount++;
        } else {
            e.offscreen = false;
        }
        e._pairSeq = i; // pass-local numeric dedup index (see pair loop below)
        this.shardGrid.push(cellKey(e.position.x, e.position.y), e);
    }
    this.lastAsleepCount = asleepCount;
    this.lastOffscreenShardCount = offscreenCount;

    // Walk the shard list and resolve pairs.  j > i ordering via
    // id comparison ensures each unordered pair is processed once.
    // The inner pair body is identical in spirit to the main loop's
    // shard-shard branch (now removed), but iterates a much smaller
    // set since non-shard entities aren't here.
    for (let i = 0; i < shards.length; i++) {
        const a = shards[i];
        if (!a.active || a.isExploding) continue;
        if (a.mergeFadeTimer !== undefined) continue;

        const cx = Math.floor(a.position.x / SPATIAL_GRID_SIZE);
        const cy = Math.floor(a.position.y / SPATIAL_GRID_SIZE);

        for (let x = -1; x <= 1; x++) {
            for (let y = -1; y <= 1; y++) {
                const cell = this.shardGrid.get(cellKeyFromCell(cx + x, cy + y));
                if (!cell) continue;
                for (let j = 0; j < cell.length; j++) {
                    const b = cell[j];
                    if (a === b) continue;
                    // Process each unordered pair once.  Numeric dedup on the
                    // pass-local _pairSeq (set in the grid build above) — cheaper
                    // than the old `a.id > b.id` string compare, run per candidate
                    // over dense piles.  resolveShardPair + its delegates are
                    // fully order-independent, so which side is the representative
                    // doesn't change the outcome.
                    if (a._pairSeq! > b._pairSeq!) continue;
                    // Sleep skip: two resting shards in contact are
                    // stable — no separation or bounce to apply, so
                    // skip the SAT+impulse math entirely.  A pair with
                    // either party awake still resolves (and the
                    // resolution wakes both), so a disturbance ripples
                    // through the island over successive substeps.
                    if (this.shardSleepEnabled
                        && a.asleep === true && b.asleep === true) continue;
                    // Viewport gate: both shards offscreen → resolve
                    // only on the catch-up phase.  Either shard on/near
                    // screen → resolve every pass (full fidelity where
                    // the player can see it).  Bounded catch-up keeps
                    // off-screen piles from interpenetrating without
                    // limit; entering the padded viewport restores full
                    // rate before the shard is visible.
                    if (viewportGate && !catchUpPhase
                        && a.offscreen === true && b.offscreen === true) continue;
                    this.resolveShardPair(a, b, onDeath);
                }
            }
        }
    }
  }

  /**
   * Mobile-shard ↔ static-tile pass for variants that declare
   * `passthroughShatter.targets` (today: metal-shard targeting
   * glass-tile + glass-shard).  Unconditional — does NOT require
   * `shardTileCollisionsEnabled` — because the rule is a gameplay
   * mechanic, not a debug aid.  Cheap: only iterates shards whose
   * variant has the field set (today just metal-shard), and the
   * inner cell short-circuits if the static cell holds nothing.
   *
   * Dispatches through checkAndResolveCollision → resolveCollision,
   * where the inline passthroughShatter branch flips the target's
   * active flag and fires onDeath (which routes through GameEngine
   * .handleEntityDeath → spawnDrops → spawnGlassShards for tiles,
   * and ShardSystem.shatter for shards via the existing tier chain).
   * The carrier shard takes no impulse — its trajectory and HP are
   * unchanged.
   */
  private resolvePassthroughShatterPairs(
      shards: GameEntity[],
      onDamage?: (pos: Vector2, amount: number, target?: GameEntity, impactWorldPos?: Vector2) => void,
      onDeath?: (entity: GameEntity) => void,
      onShake?: (amount: number, opts?: { dirX?: number; dirY?: number }) => void,
      onHit?: (impactPos: Vector2, proj: GameEntity, target: GameEntity) => void,
  ): void {
      for (let i = 0; i < shards.length; i++) {
          const a = shards[i];
          if (!a.active || a.isExploding) continue;
          if (a.mergeFadeTimer !== undefined) continue;
          if (a.shardVariant === undefined) continue;
          const aVariant = SHARD_VARIANTS[a.shardVariant];
          if (aVariant.passthroughShatter === undefined) continue;

          const cx = Math.floor(a.position.x / SPATIAL_GRID_SIZE);
          const cy = Math.floor(a.position.y / SPATIAL_GRID_SIZE);

          for (let x = -1; x <= 1; x++) {
              for (let y = -1; y <= 1; y++) {
                  const cell = this.staticGrid.get(cellKeyFromCell(cx + x, cy + y));
                  if (!cell) continue;
                  for (let j = 0; j < cell.length; j++) {
                      const b = cell[j];
                      if (!b.active) continue;
                      if (b.shardVariant === undefined) continue;
                      if (aVariant.passthroughShatter.targets.indexOf(b.shardVariant) === -1) continue;
                      this.checkAndResolveCollision(a, b, onDamage, onDeath, onShake, onHit);
                  }
              }
          }
      }
  }

  /**
   * Pass-through-and-shatter rule (g3 material-interactions).  Called
   * from the impulse-resolution sites (resolveShardPair fast-path
   * and resolveCollision full-path) before any bounce math runs.
   * Returns true when the pair matches the rule and the target has
   * been routed through its death pipeline; callers should bail
   * immediately on true (no positional correction, no impulse, no
   * bounce).  The carrier's HP and trajectory are unchanged.
   *
   * Target dispatch mirrors the standard health-zero death path:
   * health = 0, active = false, removeStaticEntity for static tiles,
   * then onDeath().  GameEngine.handleEntityDeath fans out from
   * there (DropSystem.spawnGlassShards for glass-tile, ShardSystem
   * .shatter tier chain for glass-shard).
   */
  /**
   * A structure killed by a COLLISION, routed through the SAME death
   * pipeline a projectile kill takes.
   *
   * This exists because it was not always so: the two asteroid-impact kill
   * sites below used to set `health = 0; active = false` and remove the tile
   * from the static grid WITHOUT calling `onDeath`, so
   * `GameEngine.handleEntityDeath` never ran — no shatter, no debris, no
   * salvage roll, no sound.  A tile shot with a projectile broke; the same
   * tile crushed by a rock simply blinked out of existence.  (The PLAYER's
   * own crash path always did call it, which is what made the asymmetry easy
   * to miss: crashing into a tile yourself looked right.)
   *
   * The two stamps are what make the shatter read as an IMPACT rather than a
   * spontaneous crumble, and they are the same two the projectile path sets:
   * `lastImpactVelocity` gives the fragments a direction to scatter along,
   * and `lastImpactDamage` scales how many pieces and how fine
   * (ShardSystem.shatterPowerlawStyle / DropSystem.spawnGlassShards read it
   * as 1..5 → few-and-large .. many-and-small).
   *
   * ORDER MATTERS: the static grid entry has to go before `onDeath`, because
   * the death fan-out spawns mobile shards where the tile was and they would
   * otherwise collide with the corpse of their own parent.
   */
  private killStructureByImpact(
      structure: GameEntity,
      impactor: GameEntity,
      impactDamage: number,
      byPlayer: boolean,
      onDeath?: (entity: GameEntity) => void,
  ) {
      structure.health = 0;
      if (impactor.velocity) {
          structure.lastImpactVelocity = { x: impactor.velocity.x, y: impactor.velocity.y };
      }
      structure.lastImpactDamage = impactDamage;
      // Player-attributed kills score (handleEntityDeath reads this stamp);
      // a tile crushed by a drifting rock is nobody's kill.
      if (byPlayer) structure.killedByPlayer = true;
      structure.active = false;
      if (structure.mass === Infinity) {
          this.removeStaticEntity(structure);
      }
      if (onDeath) onDeath(structure);
  }

  /**
   * IMPACT STRENGTH — one number for the camera and the ear.
   *
   * `self`'s own velocity STEP along the collision normal: the quantity the
   * impulse solver applies a few lines later, mirrored here including the
   * mass-bias exponent, so nothing downstream is modelling the collision a
   * second time.  A STATIC `other` contributes `effInv = 0`, so `self` takes
   * the whole step — a wall is the hardest hit there is.
   *
   * Read by the screen shake (`SHAKE.IMPACT_*`) and by the crash voices
   * (`AUDIO_CONSTANTS.IMPACT_*`, docs/SFX_INVENTORY.md §4.4), which is the
   * point: how hard a hit reads to the eye and to the ear is one decision.
   */
  public static impactStrength(self: GameEntity, other: GameEntity, velAlongNormal: number): number {
      const k = COLLISION_CONFIG.MASS_BIAS_EXPONENT;
      const effSelf  = Math.pow(self.mass  === Infinity ? 0 : 1 / self.mass,  k);
      const effOther = Math.pow(other.mass === Infinity ? 0 : 1 / other.mass, k);
      const denom = effSelf + effOther;
      if (denom <= 0) return 0;
      return (1 + COLLISION_CONFIG.ELASTICITY) * Math.abs(velAlongNormal) * (effSelf / denom);
  }

  /** The `{gain, pitch}` a crash voice plays at, from that same strength.
   *  `floor` and `span` are the row's own (docs/SFX_INVENTORY.md §4.4) — the
   *  span is the dv at which it reaches full gain, which differs per row
   *  because the rows are gated at different speeds and reach different
   *  strengths.  Pass the IMPACTOR's mass for pitch; `Infinity` (a static
   *  tile) keeps the fixed voice the row already had. */
  private static impactVoice(dv: number, impactorMass: number, floor: number, span: number): { gain: number; pitch?: number } {
      const A = AUDIO_CONSTANTS;
      const gain = Math.max(floor, Math.min(1, dv / span));
      if (impactorMass === Infinity) return { gain };
      const pitch = Math.max(A.IMPACT_PITCH_MIN, Math.min(A.IMPACT_PITCH_MAX,
          Math.pow(A.IMPACT_PITCH_REF_MASS / Math.max(0.01, impactorMass), A.IMPACT_PITCH_EXP)));
      return { gain, pitch };
  }

  private tryPassthroughShatter(
      a: GameEntity,
      b: GameEntity,
      onDeath?: (entity: GameEntity) => void,
  ): boolean {
      if (a.shardVariant === undefined || b.shardVariant === undefined) return false;
      const aVar = SHARD_VARIANTS[a.shardVariant];
      const bVar = SHARD_VARIANTS[b.shardVariant];
      let target: GameEntity | null = null;
      if (aVar.passthroughShatter !== undefined
          && aVar.passthroughShatter.targets.indexOf(b.shardVariant) !== -1) {
          target = b;
      } else if (bVar.passthroughShatter !== undefined
          && bVar.passthroughShatter.targets.indexOf(a.shardVariant) !== -1) {
          target = a;
      }
      if (target === null) return false;

      // Stamp impact velocity / damage so the target's shatter
      // pipeline (asteroid-style tier chain for glass-shard, glass-
      // shard fan for glass-tile) gets a sensible scatter direction.
      const carrier = target === a ? b : a;
      if (carrier.velocity) {
          target.lastImpactVelocity = { x: carrier.velocity.x, y: carrier.velocity.y };
      }
      target.lastImpactDamage = Math.max(1, target.lastImpactDamage ?? 1);

      target.health = 0;
      target.active = false;
      if (target.mass === Infinity) {
          this.removeStaticEntity(target);
      }
      if (onDeath) onDeath(target);
      return true;
  }

  /**
   * Plastic-shard cross-material transmute on contact.  When a
   * plastic-shard collides with a strictly larger non-plastic non-
   * nebula shard (mobile or static tile), the plastic-shard adopts
   * the partner's material at the plastic-shard's current size +
   * polygon shape.  Reads as plastic absorbing the surface character
   * of whatever it touches; once converted the entity behaves as a
   * normal shard of the new variant for all subsequent passes
   * (bonds, repel immunity, density, render).  Tile partners
   * (glass-tile / rock-tile / metal-tile) map to the matching
   * SHARD variant — the plastic becomes a shard of that material,
   * not another tile.  Partners listed in PLASTIC_TRANSMUTE_EXCLUDE
   * (plastic-*, nebula-*, indestructible-tile) are no-ops.
   */
  private tryPlasticTransmuteOnContact(a: GameEntity, b: GameEntity): void {
      let plastic: GameEntity, other: GameEntity;
      if (a.shardVariant === 'plastic-shard') { plastic = a; other = b; }
      else if (b.shardVariant === 'plastic-shard') { plastic = b; other = a; }
      else return;
      const oVar = other.shardVariant;
      if (oVar === undefined) return;
      if (PLASTIC_TRANSMUTE_EXCLUDE.indexOf(oVar) !== -1) return;

      // Tile → matching shard variant; shard variants pass through.
      let targetVariant: string;
      switch (oVar) {
          case 'glass-tile':  targetVariant = 'glass-shard';  break;
          case 'rock-tile':   targetVariant = 'rock-shard';   break;
          case 'metal-tile':  targetVariant = 'metal-shard';  break;
          default:            targetVariant = oVar;           break;
      }
      const newVariantDef = SHARD_VARIANTS[targetVariant as keyof typeof SHARD_VARIANTS];
      if (newVariantDef === undefined) return;

      plastic.shardVariant     = targetVariant as typeof plastic.shardVariant;
      plastic.color            = other.color || plastic.color;
      plastic.mass             = newVariantDef.spawn.sizeToMass(plastic.size.x);
      plastic.mergeCount         = undefined;
      plastic.plasticDentHistory = undefined;
      pendingPlasticDentEntities.delete(plastic);
      invalidateCollisionR(plastic);
  }

  /**
   * Mobile-shard ↔ static-tile collision pass — debug-gated by
   * `shardTileCollisionsEnabled`.  The main broadphase skips
   * STRUCTURE entities as outer-loop subjects (commit cf69102),
   * which leaves shard-vs-tile pairs un-iterated.  This pass closes
   * that gap when the toggle is on: each mobile shard does a 3×3
   * staticGrid lookup and routes any overlapping tile through
   * checkAndResolveCollision — the same SAT + resolveCollision
   * path projectiles / players use.  Re-activates the dead
   * `aIsMobileShard && bIsStaticTile` branch in resolveCollision
   * (asteroid-pressure crash + indestructible bounce + elastic
   * impulse).
   */
  private resolveShardTilePairs(
      shards: GameEntity[],
      onDamage?: (pos: Vector2, amount: number, target?: GameEntity, impactWorldPos?: Vector2) => void,
      onDeath?: (entity: GameEntity) => void,
      onShake?: (amount: number, opts?: { dirX?: number; dirY?: number }) => void,
      onHit?: (impactPos: Vector2, proj: GameEntity, target: GameEntity) => void,
  ): void {
      for (let i = 0; i < shards.length; i++) {
          const a = shards[i];
          if (!a.active || a.isExploding) continue;
          if (a.mergeFadeTimer !== undefined) continue;

          const cx = Math.floor(a.position.x / SPATIAL_GRID_SIZE);
          const cy = Math.floor(a.position.y / SPATIAL_GRID_SIZE);

          for (let x = -1; x <= 1; x++) {
              for (let y = -1; y <= 1; y++) {
                  const cell = this.staticGrid.get(cellKeyFromCell(cx + x, cy + y));
                  if (!cell) continue;
                  for (let j = 0; j < cell.length; j++) {
                      const b = cell[j];
                      if (!b.active) continue;
                      this.checkAndResolveCollision(a, b, onDamage, onDeath, onShake, onHit);
                  }
              }
          }
      }
  }

  /**
   * Nebula-shard ↔ nebula-tile collision pass.  Runs every frame
   * regardless of the Sh↔Tl toggle.  Mirrors resolveShardTilePairs
   * but filtered to nebula variants — nebula shards should bounce
   * off cloud tiles even though the wider shard-tile pass is opt-
   * in.  The passThrough bypass in resolveCollision handles the
   * actual impulse path; this method just gets the pair in front
   * of it.
   */
  private resolveNebulaShardTilePairs(
      shards: GameEntity[],
      onDamage?: (pos: Vector2, amount: number, target?: GameEntity, impactWorldPos?: Vector2) => void,
      onDeath?: (entity: GameEntity) => void,
      onShake?: (amount: number, opts?: { dirX?: number; dirY?: number }) => void,
      onHit?: (impactPos: Vector2, proj: GameEntity, target: GameEntity) => void,
  ): void {
      for (let i = 0; i < shards.length; i++) {
          const a = shards[i];
          if (a.shardVariant !== 'nebula-shard') continue;
          if (!a.active || a.isExploding) continue;
          if (a.mergeFadeTimer !== undefined) continue;

          const cx = Math.floor(a.position.x / SPATIAL_GRID_SIZE);
          const cy = Math.floor(a.position.y / SPATIAL_GRID_SIZE);

          for (let x = -1; x <= 1; x++) {
              for (let y = -1; y <= 1; y++) {
                  const cell = this.staticGrid.get(cellKeyFromCell(cx + x, cy + y));
                  if (!cell) continue;
                  for (let j = 0; j < cell.length; j++) {
                      const b = cell[j];
                      if (b.shardVariant !== 'nebula-tile') continue;
                      if (!b.active) continue;
                      this.checkAndResolveCollision(a, b, onDamage, onDeath, onShake, onHit);
                  }
              }
          }
      }
  }

  private resolveShardPair(
      a: GameEntity,
      b: GameEntity,
      onDeath?: (entity: GameEntity) => void,
  ) {
      // Non-nebula shards (metal / rock / glass, loose or composite) never
      // collide with nebula shards — skip before any routing / SAT work.
      if (this.nebulaPassThroughPair(a, b)) return;

      // Cheapest possible early-outs first — most pair calls discard
      // here before paying any further work.

      const MAX_SEPARATION_STEP = 2;  // world units per entity per frame

      // Metal assembly: don't bounce metal triangles off each other when a
      // loose piece is involved — the ShardSystem assembly pass needs them
      // to interpenetrate so a loose triangle can reach a composite's free
      // face (or another loose triangle) and snap/lock.  Two formed
      // composites DO collide (so they rest against each other rather than
      // overlapping).  Metal-vs-other-shard falls through normally.
      const aMetal = a.shardVariant === 'metal-shard';
      const bMetal = b.shardVariant === 'metal-shard';
      if (aMetal && bMetal) {
          const bothComposite = a.metalCells !== undefined && b.metalCells !== undefined;
          if (!bothComposite) return;
      }

      // A metal composite collides by its actual assembled shape (per-cell
      // SAT), not a bounding circle — route any composite-involving pair to
      // the polygon resolver and skip the circle math below.
      if ((a.metalCells !== undefined && a.metalCells.length > 0)
          || (b.metalCells !== undefined && b.metalCells.length > 0)) {
          this.resolveCompositeShardPair(a, b, onDeath);
          return;
      }

      // Collision radius factor: a loose metal triangle uses its INSCRIBED
      // circle (size.x is the circumdiameter → 0.25 = inradius, so two
      // triangles touch at the edge-sharing distance); other shards keep the
      // 0.42 near-circumradius factor.  (Composites never reach here — they
      // resolve per-cell above.)
      const rA = a.size.x * (aMetal ? 0.25 : 0.42);
      const rB = b.size.x * (bMetal ? 0.25 : 0.42);
      const sumR = rA + rB;
      const sumRSq = sumR * sumR;

      const dx = wrapDeltaX(a.position.x, b.position.x);
      const dy = wrapDeltaY(a.position.y, b.position.y);
      const distSq = dx * dx + dy * dy;
      if (distSq > sumRSq) return;

      // Passthrough-and-shatter (today: metal-shard → glass-shard).
      // Skips impulse / positional correction entirely and routes
      // the target through its death pipeline.  Checked before the
      // settled-pair skip so a metal-shard sliding past a glass-
      // shard still triggers the shatter on first overlap.
      if (this.tryPassthroughShatter(a, b, onDeath)) return;

      // Settled-pair skip: when the pair is barely overlapping AND
      // already drifting at almost the same velocity, separation /
      // bounce produces an imperceptible nudge while costing the
      // full impulse + mass-correction math.  Bail before any of
      // it.  Overlap test stays squared by comparing distSq to
      //   sumR² × (1 − STABLE_OVERLAP_FRACTION)²
      // which is the largest distance² that still counts as
      // "settled".  Active collisions (overlap > fraction × sumR or
      // rel-vel above threshold) skip the early-out and resolve
      // normally.
      const rvx0 = b.velocity.x - a.velocity.x;
      const rvy0 = b.velocity.y - a.velocity.y;
      const relVelSq = rvx0 * rvx0 + rvy0 * rvy0;
      const stableMinDistSq = sumRSq * STABLE_DIST_FACTOR_SQ;
      if (relVelSq < SHARD_PAIR_CONSTANTS.STABLE_REL_VEL_SQ
          && distSq > stableMinDistSq) {
          return;
      }

      // Stage 5 fix: respect per-variant passThrough on the dynamic-
      // grid fast-path.  Without this, nebula-shards (passThrough=
      // true, mass=0.01) get an elastic bounce here that gives them a
      // huge velocity kick (invMassA = 100), and the bond-cohesion
      // pass smears that energy onto the glass partner.  The full
      // resolveCollision path already honours passThrough; the fast-
      // path needs the same gate.  Moved past the early-outs above
      // so most pair calls (no overlap, or settled) skip the dict
      // lookup entirely.
      //
      // DBG override: when `nebulaShardCollisionsEnabled` is on AND
      // both sides are nebula-shards, the passThrough gate is
      // bypassed and the pair takes the standard elastic bounce.
      const nebPairCollidesFast = this.nebulaShardCollisionsEnabled
        && a.shardVariant === 'nebula-shard'
        && b.shardVariant === 'nebula-shard';
      if (!nebPairCollidesFast) {
        if (a.shardVariant !== undefined && SHARD_VARIANTS[a.shardVariant].passThrough === true) return;
        if (b.shardVariant !== undefined && SHARD_VARIANTS[b.shardVariant].passThrough === true) return;
      }

      let nx: number;
      let ny: number;
      let dist: number;
      if (distSq < 0.01) {
          // Exact overlap — the very case that was trapping shards at a
          // shared centre.  Pick a deterministic axis from the ids so the
          // separation direction is stable frame-to-frame and the pair
          // consistently pushes apart instead of jittering.
          const seed = (a.id.charCodeAt(a.id.length - 1)
                      + b.id.charCodeAt(b.id.length - 1)) * 0.7853981633974483; // π/4
          nx = Math.cos(seed);
          ny = Math.sin(seed);
          dist = 0.001;
      } else {
          dist = Math.sqrt(distSq);
          nx = dx / dist;
          ny = dy / dist;
      }

      const overlap = sumR - dist;
      const { CORRECTION_PERCENT, SLOP, ELASTICITY } = COLLISION_CONFIG;
      // Memoised 1/mass + pow(1/mass, MASS_BIAS_EXPONENT), keyed on the mass
      // value.  Mass is constant per shard between merges, so this is computed
      // ~once per shard per mass-epoch and reused across ALL its pairs —
      // removing 2 divisions + 2 Math.pow from every resolved pair in a dense
      // pile.  Self-invalidating: any mass change (merge / density retier)
      // makes `_massCacheKey !== mass` and recomputes.  Bit-identical to the
      // old inline math.
      if (a._massCacheKey !== a.mass) {
          const im = 1 / a.mass;
          a._invMassCache = im;
          a._effInvMassCache = Math.pow(im, COLLISION_CONFIG.MASS_BIAS_EXPONENT);
          a._massCacheKey = a.mass;
      }
      if (b._massCacheKey !== b.mass) {
          const im = 1 / b.mass;
          b._invMassCache = im;
          b._effInvMassCache = Math.pow(im, COLLISION_CONFIG.MASS_BIAS_EXPONENT);
          b._massCacheKey = b.mass;
      }
      const invMassA = a._invMassCache!;
      const invMassB = b._invMassCache!;
      const totalInvMass = invMassA + invMassB;
      if (totalInvMass <= 0) return;

      // Positional correction — mass-weighted push apart.  Cap the per-
      // entity movement so a deeply-overlapping pair (e.g. the initial
      // frame when a newly-merged cluster is dissolved) separates
      // smoothly over several frames rather than teleporting chunks of
      // the cluster across the screen.
      const correction = Math.max(0, overlap - SLOP) * CORRECTION_PERCENT / totalInvMass;
      let pushA = correction * invMassA;
      let pushB = correction * invMassB;
      if (pushA > MAX_SEPARATION_STEP) pushA = MAX_SEPARATION_STEP;
      if (pushB > MAX_SEPARATION_STEP) pushB = MAX_SEPARATION_STEP;
      a.position.x -= nx * pushA;
      a.position.y -= ny * pushA;
      b.position.x += nx * pushB;
      b.position.y += ny * pushB;

      // Wake both ends.  Reaching here means a genuine contact cleared
      // the passthrough + settled-pair early-outs, so neither shard is
      // truly at rest any more — clear the flag and reset the dwell so
      // they must re-earn sleep.  This is what propagates a disturbance
      // through a resting island: an awake shard wakes the sleeper it
      // hits, which next step wakes its own neighbours.
      a.asleep = false; a.sleepTimer = 0;
      b.asleep = false; b.sleepTimer = 0;

      // Velocity resolution — elastic bounce along the contact normal.
      // The impulse split uses mass-bias-compressed inverse masses
      // (COLLISION_CONFIG.MASS_BIAS_EXPONENT) so a light fast shard
      // visibly shoves a heavy slow one; the positional correction
      // above keeps the true mass split.
      const rvx = b.velocity.x - a.velocity.x;
      const rvy = b.velocity.y - a.velocity.y;
      const velAlongNormal = rvx * nx + rvy * ny;
      if (velAlongNormal > 0) return; // already moving apart

      const effInvMassA = a._effInvMassCache!; // memoised above (mass-keyed)
      const effInvMassB = b._effInvMassCache!;
      const j = -(1 + ELASTICITY) * velAlongNormal;
      const impulse = j / (effInvMassA + effInvMassB);
      const ix = nx * impulse;
      const iy = ny * impulse;
      a.velocity.x -= ix * effInvMassA;
      a.velocity.y -= iy * effInvMassA;
      b.velocity.x += ix * effInvMassB;
      b.velocity.y += iy * effInvMassB;
  }

  /**
   * Nebula isolation rule: a nebula tile/shard physically interacts ONLY with
   * nebula shards (nebula-shard ↔ nebula-shard and nebula-shard ↔ nebula-tile)
   * plus player/enemy/projectile strikers (which shatter tiles / fly through).
   * Every other shard family — metal / rock / glass, loose OR composite —
   * passes through nebula entirely.  Returns true when the pair must be
   * skipped (no collision response).  This is the single explicit gate for
   * the rule; the per-variant passThrough flag still backs it up.
   */
  private nebulaPassThroughPair(a: GameEntity, b: GameEntity): boolean {
      const av = a.shardVariant;
      const bv = b.shardVariant;
      const aNeb = av === 'nebula-tile' || av === 'nebula-shard';
      const bNeb = bv === 'nebula-tile' || bv === 'nebula-shard';
      // Both nebula → allowed (handled by the nebula pair paths).  Neither
      // nebula → not our concern.
      if (aNeb === bNeb) return false;
      // Exactly one side is nebula.  The OTHER side passes through unless it
      // is itself a shard/tile (has a shardVariant) — strikers have none, so
      // the tile-shatter path keeps working for player/enemy/projectiles.
      return (aNeb ? bv : av) !== undefined;
  }

  private checkAndResolveCollision(
    a: GameEntity,
    b: GameEntity,
    onDamage?: (pos: Vector2, amount: number, target?: GameEntity, impactWorldPos?: Vector2) => void,
    onDeath?: (entity: GameEntity) => void,
    onShake?: (amount: number, opts?: { dirX?: number; dirY?: number }) => void,
    onHit?: (impactPos: Vector2, proj: GameEntity, target: GameEntity) => void
  ) {
      // Non-nebula shards (metal / rock / glass) never collide with nebula.
      if (this.nebulaPassThroughPair(a, b)) return;

      // Swarm gnats (diesOnContact) now take STANDARD enemy collisions — they
      // bounce off terrain (tiles / asteroids) and each other instead of
      // phasing through, so a flock reads as physical.  The Stage-4 perf
      // early-out that skipped every non-player pair is removed; the gnat still
      // POPS only on player contact (the resolveCollision ENEMY-vs-PLAYER
      // branch is gated on the target being the player), so hitting a tile
      // bounces rather than kills it.  (The boids separation already keeps a
      // flock spaced, so actual overlaps — the only pairs that reach SAT past
      // the circle broadphase — stay bounded.)
      // Phase-through (Stage 6 dragon): glides through terrain/enemies and eats
      // tiles via the consume pass; only collides with the player (contact) and
      // player projectiles (to take damage).  Same gate as the gnat.
      if (a.phasesTerrain === true || b.phasesTerrain === true) {
          const other = a.phasesTerrain === true ? b : a;
          const ok = other.type === EntityType.PLAYER
              || (other.type === EntityType.PROJECTILE && other.ownerType === EntityType.PLAYER);
          if (!ok) return;
      }

      // 0. BROADPHASE: Fast Circle Check — using toroidal delta so pairs
      // across the wrap seam are still considered.  If the shorter way
      // around the torus is < rA+rB, the two entities are genuinely close.
      // Cached bounding-radius lookup — getCollisionR() is a 1-field read
      // on cache hit (vast majority of frames) vs. Math.max + division.
      let rA = getCollisionR(a);
      let rB = getCollisionR(b);
      // Expand player radius when shield is active
      if (a.id === 'player' && (a.shield ?? 0) > 0) rA *= SHIELD_CONSTANTS.COLLISION_MULTIPLIER;
      if (b.id === 'player' && (b.shield ?? 0) > 0) rB *= SHIELD_CONSTANTS.COLLISION_MULTIPLIER;
      // Extend reach to the SHIELD ring so an incoming shot is considered out
      // to where the shield actually turns it away — tryShieldDeflect then
      // handles it there instead of letting it tunnel to the hull.  Gated to
      // pairs that contain a projectile: a shield is not a bigger body, and
      // inflating the radius for body pairs would only buy extra SAT work that
      // `fillVertices` (player-only inflation) would then decline anyway.
      if (a.type === EntityType.PROJECTILE || b.type === EntityType.PROJECTILE) {
          if ((a.shield ?? 0) > 0 && (a.maxShield ?? 0) > 0) rA = Math.max(rA, PhysicsSystem.shieldReach(a));
          if ((b.shield ?? 0) > 0 && (b.maxShield ?? 0) > 0) rB = Math.max(rB, PhysicsSystem.shieldReach(b));
      }
      const wdx = wrapDeltaX(a.position.x, b.position.x);
      const wdy = wrapDeltaY(a.position.y, b.position.y);
      const distSq = wdx*wdx + wdy*wdy;

      if (distSq > (rA + rB + 10)**2) return;

      // Terrain slam (Stage 5): the player hitting a tile / asteroid fast stamps
      // a short window GameEngine.updateBubbles reads to shake a latched bubble
      // free.  STRUCTURE covers static tiles + mobile shards.
      if (a.type === EntityType.STRUCTURE || b.type === EntityType.STRUCTURE) {
          const ply = a.id === 'player' ? a : (b.id === 'player' ? b : null);
          if (ply && Math.hypot(ply.velocity.x, ply.velocity.y) >= BUBBLE_CONSTANTS.KNOCK_SPEED) {
              ply.terrainSlamTimer = 0.12;
          }
      }

      // SAT works on absolute vertex positions.  If A and B sit on
      // opposite sides of the seam (|b - a| > HALF_MAP), shift b into
      // a's frame for the duration of this check so vertex math stays
      // local.  After resolution we re-wrap both positions so anything
      // the bouncer / positional-correction path wrote to a.position or
      // b.position in the shifted frame returns to canonical coords.
      const offsetX = (a.position.x + wdx) - b.position.x;
      const offsetY = (a.position.y + wdy) - b.position.y;
      const shifted = offsetX !== 0 || offsetY !== 0;
      if (shifted) {
          b.position.x += offsetX;
          b.position.y += offsetY;
      }

      // Shield interception: a hostile shot is DEFLECTED at the ring (before
      // SAT), so it visibly glances off the shield instead of reaching the
      // hull.  Uncovered arc bearings and punch-through shots fall through to
      // the normal SAT body hit, which drains the pool the old way.
      if (this.tryShieldDeflect(a, b, onHit)) {
          if (shifted) { wrapPosition(a.position); wrapPosition(b.position); }
          return;
      }

      // 1. SAT Collision Detection (Alloc-Free).  A metal composite collides
      // by its actual assembled shape (per-cell SAT) rather than its convex-
      // hull polygon, so contacts/hits match the connected triangles.
      const composite = (a.metalCells !== undefined && a.metalCells.length > 0)
                     || (b.metalCells !== undefined && b.metalCells.length > 0);
      const hit = composite ? this.compositeSAT(a, b) : this.checkCollisionSAT(a, b);
      if (hit) {
          // A moderate body collision aggros a passive bubble onto the collider
          // (before resolve, so we read the true impact velocities).
          PhysicsSystem.maybeBubbleCollisionAggro(a, b);
          this.resolveCollision(a, b, this.bufferMtv, onDamage, onDeath, onShake, onHit);
      }

      if (shifted) {
          // Normalize any positions the resolver may have written in b's
          // shifted frame (bouncer reflection, SLOP correction, etc.).
          wrapPosition(a.position);
          wrapPosition(b.position);
      }
  }

  /** Stage 5: a MODERATE body collision (relative impact speed ≥
   *  COLLIDE_AGGRO_SPEED) between a passive third-party bubble and the player /
   *  an enemy aggros the bubble onto the collider.  A light graze (slow drift
   *  contact) is below threshold and ignored.  Skipped while the bubble is
   *  latched or sick.  Bubble↔bubble is ignored. */
  private static maybeBubbleCollisionAggro(a: GameEntity, b: GameEntity) {
      const bubble = a.thirdParty ? a : (b.thirdParty ? b : null);
      if (!bubble || bubble.attachedToId !== undefined || (bubble.bubbleSickTimer ?? 0) > 0) return;
      const other = bubble === a ? b : a;
      if (other.thirdParty) return; // bubble ↔ bubble
      if (other.type !== EntityType.PLAYER && other.type !== EntityType.ENEMY) return;
      const rvx = a.velocity.x - b.velocity.x;
      const rvy = a.velocity.y - b.velocity.y;
      if (rvx * rvx + rvy * rvy < BUBBLE_CONSTANTS.COLLIDE_AGGRO_SPEED * BUBBLE_CONSTANTS.COLLIDE_AGGRO_SPEED) return;
      bubble.provoked = true;
      bubble.aggroTargetId = other.id; // 'player' for the player, else the enemy id
  }

  /**
   * Separating Axis Theorem (SAT) Implementation.
   * Checks for overlap on all normal axes of both polygons.
   * If overlap exists on ALL axes, collision is true.
   * Returns the Minimum Translation Vector (MTV) to resolve collision.
   */
  private checkCollisionSAT(a: GameEntity, b: GameEntity): boolean {
      // Fill buffers with vertices
      const countA = this.fillVertices(a, this.bufferVerticesA);
      const countB = this.fillVertices(b, this.bufferVerticesB);
      
      // Calculate Axes into buffer.  Pass entity refs so static-entity
      // axes are pulled from cache instead of recomputed every pair.
      const axesCount = this.fillAxes(this.bufferVerticesA, countA, this.bufferVerticesB, countB, this.bufferAxes, a, b);

      let minOverlap = Infinity;
      let smallestAxisX = 0;
      let smallestAxisY = 0;

      for (let i = 0; i < axesCount; i++) {
          const axis = this.bufferAxes[i];
          
          // Project A
          let minA = Infinity, maxA = -Infinity;
          for(let j=0; j<countA; j++) {
              const p = this.bufferVerticesA[j];
              const proj = p.x * axis.x + p.y * axis.y;
              if (proj < minA) minA = proj;
              if (proj > maxA) maxA = proj;
          }

          // Project B
          let minB = Infinity, maxB = -Infinity;
          for(let j=0; j<countB; j++) {
              const p = this.bufferVerticesB[j];
              const proj = p.x * axis.x + p.y * axis.y;
              if (proj < minB) minB = proj;
              if (proj > maxB) maxB = proj;
          }

          // Check Overlap
          if (maxA < minB || maxB < minA) {
              return false; // Separating axis found
          }

          // Get Overlap
          const o = Math.min(maxA, maxB) - Math.max(minA, minB);
          if (o < minOverlap) {
              minOverlap = o;
              smallestAxisX = axis.x;
              smallestAxisY = axis.y;
          }
      }

      // Ensure MTV points from A to B
      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      if ((dx * smallestAxisX + dy * smallestAxisY) < 0) {
          smallestAxisX = -smallestAxisX;
          smallestAxisY = -smallestAxisY;
      }

      this.bufferMtv.x = smallestAxisX * minOverlap;
      this.bufferMtv.y = smallestAxisY * minOverlap;
      return true;
  }

  // ── Metal composite per-cell collision ──────────────────────────────────
  // A metal composite is a rigid union of triangle cells on a shared
  // lattice; the union can be concave, so it can't be one SAT polygon.
  // Instead each cell is treated as its own convex collider and the body
  // collides as the union of cells — collision matches the actual connected
  // shape rather than a convex hull or bounding circle.

  /** Parametric SAT between two world-space vertex sets.  On overlap returns
   *  true and writes penetration depth + axis into satOverlap / satAxis{X,Y}
   *  (the minimum-translation axis); on a separating axis returns false. */
  private satTest(vA: Vector2[], cA: number, vB: Vector2[], cB: number): boolean {
      const axesCount = this.fillAxes(vA, cA, vB, cB, this.bufferAxes);
      let minOverlap = Infinity, axX = 0, axY = 0;
      for (let i = 0; i < axesCount; i++) {
          const axis = this.bufferAxes[i];
          let minA = Infinity, maxA = -Infinity;
          for (let j = 0; j < cA; j++) {
              const p = vA[j];
              const proj = p.x * axis.x + p.y * axis.y;
              if (proj < minA) minA = proj;
              if (proj > maxA) maxA = proj;
          }
          let minB = Infinity, maxB = -Infinity;
          for (let j = 0; j < cB; j++) {
              const p = vB[j];
              const proj = p.x * axis.x + p.y * axis.y;
              if (proj < minB) minB = proj;
              if (proj > maxB) maxB = proj;
          }
          if (maxA < minB || maxB < minA) return false;
          const o = Math.min(maxA, maxB) - Math.max(minA, minB);
          if (o < minOverlap) { minOverlap = o; axX = axis.x; axY = axis.y; }
      }
      this.satOverlap = minOverlap;
      this.satAxisX = axX;
      this.satAxisY = axY;
      return true;
  }

  /** Fill `buffer` with the 3 world-space vertices of composite cell `idx`
   *  (lattice-frame triangle → rotate by composite.rotation → translate). */
  private fillMetalCellVerts(comp: GameEntity, idx: number, cmx: number, cmy: number, buffer: Vector2[]): number {
      const R = comp.metalLatticeR!;
      const ux = (R * Math.sqrt(3)) / 2;
      const uy = R / 2;
      const c = comp.metalCells![idx];
      const ccx = c.ix * ux - cmx;
      const ccy = c.iy * uy - cmy;
      const cos = Math.cos(comp.rotation);
      const sin = Math.sin(comp.rotation);
      const px = comp.position.x;
      const py = comp.position.y;
      const lx0 = ccx, ly0 = c.up ? ccy - R : ccy + R;
      const lx1 = ccx + ux, ly1 = c.up ? ccy + uy : ccy - uy;
      const lx2 = ccx - ux, ly2 = c.up ? ccy + uy : ccy - uy;
      buffer[0].x = px + (lx0 * cos - ly0 * sin); buffer[0].y = py + (lx0 * sin + ly0 * cos);
      buffer[1].x = px + (lx1 * cos - ly1 * sin); buffer[1].y = py + (lx1 * sin + ly1 * cos);
      buffer[2].x = px + (lx2 * cos - ly2 * sin); buffer[2].y = py + (lx2 * sin + ly2 * cos);
      return 3;
  }

  /** Mass centroid of a composite in its lattice frame. */
  private metalCentroid(comp: GameEntity): { x: number; y: number } {
      const R = comp.metalLatticeR!;
      const ux = (R * Math.sqrt(3)) / 2;
      const uy = R / 2;
      const cells = comp.metalCells!;
      let cmx = 0, cmy = 0;
      for (const c of cells) { cmx += c.ix * ux; cmy += c.iy * uy; }
      return { x: cmx / cells.length, y: cmy / cells.length };
  }

  /** Per-cell SAT between a and b where at least one is a metal composite.
   *  Resolves against the deepest-penetrating cell pair; writes the MTV
   *  (oriented a → b) into bufferMtv and returns true on contact. */
  private compositeSAT(a: GameEntity, b: GameEntity): boolean {
      const aComp = a.metalCells !== undefined && a.metalCells.length > 0;
      const bComp = b.metalCells !== undefined && b.metalCells.length > 0;

      let cmAx = 0, cmAy = 0, cmBx = 0, cmBy = 0;
      let cA_poly = 0, cB_poly = 0;
      if (aComp) { const c = this.metalCentroid(a); cmAx = c.x; cmAy = c.y; }
      else cA_poly = this.fillVertices(a, this.bufferVerticesA);
      if (bComp) { const c = this.metalCentroid(b); cmBx = c.x; cmBy = c.y; }
      else cB_poly = this.fillVertices(b, this.bufferVerticesB);

      const aSub = aComp ? a.metalCells!.length : 1;
      const bSub = bComp ? b.metalCells!.length : 1;

      let bestPen = -1, bestAxX = 0, bestAxY = 0;
      for (let ai = 0; ai < aSub; ai++) {
          const cA = aComp ? this.fillMetalCellVerts(a, ai, cmAx, cmAy, this.bufferVerticesA) : cA_poly;
          for (let bi = 0; bi < bSub; bi++) {
              const cB = bComp ? this.fillMetalCellVerts(b, bi, cmBx, cmBy, this.bufferVerticesB) : cB_poly;
              if (this.satTest(this.bufferVerticesA, cA, this.bufferVerticesB, cB)
                  && this.satOverlap > bestPen) {
                  bestPen = this.satOverlap;
                  bestAxX = this.satAxisX;
                  bestAxY = this.satAxisY;
              }
          }
      }
      if (bestPen < 0) return false;

      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      if (dx * bestAxX + dy * bestAxY < 0) { bestAxX = -bestAxX; bestAxY = -bestAxY; }
      this.bufferMtv.x = bestAxX * bestPen;
      this.bufferMtv.y = bestAxY * bestPen;
      return true;
  }

  /** Shard-pair resolution where a metal composite is involved — per-cell
   *  SAT bounce along the contact normal (replaces the bounding-circle path
   *  in resolveShardPair for composites). */
  private resolveCompositeShardPair(a: GameEntity, b: GameEntity, onDeath?: (entity: GameEntity) => void): void {
      if (this.tryPassthroughShatter(a, b, onDeath)) return;
      if (a.shardVariant !== undefined && SHARD_VARIANTS[a.shardVariant].passThrough === true) return;
      if (b.shardVariant !== undefined && SHARD_VARIANTS[b.shardVariant].passThrough === true) return;

      // Cheap bounding-circle reject (broadphase already culls roughly).
      const rA = a.size.x / 2, rB = b.size.x / 2;
      const wdx = wrapDeltaX(a.position.x, b.position.x);
      const wdy = wrapDeltaY(a.position.y, b.position.y);
      if (wdx * wdx + wdy * wdy > (rA + rB) * (rA + rB)) return;

      // Shift b into a's frame so SAT (absolute vertices) is seam-correct.
      const offX = (a.position.x + wdx) - b.position.x;
      const offY = (a.position.y + wdy) - b.position.y;
      const shifted = offX !== 0 || offY !== 0;
      if (shifted) { b.position.x += offX; b.position.y += offY; }

      if (this.compositeSAT(a, b)) {
          const mx = this.bufferMtv.x, my = this.bufferMtv.y;
          const overlap = Math.sqrt(mx * mx + my * my);
          if (overlap > 1e-4) {
              const nx = mx / overlap, ny = my / overlap; // a → b
              const { CORRECTION_PERCENT, SLOP, ELASTICITY } = COLLISION_CONFIG;
              const invMassA = 1 / a.mass, invMassB = 1 / b.mass;
              const totalInvMass = invMassA + invMassB;
              if (totalInvMass > 0) {
                  const MAX_SEPARATION_STEP = 2;
                  const correction = Math.max(0, overlap - SLOP) * CORRECTION_PERCENT / totalInvMass;
                  let pushA = correction * invMassA, pushB = correction * invMassB;
                  if (pushA > MAX_SEPARATION_STEP) pushA = MAX_SEPARATION_STEP;
                  if (pushB > MAX_SEPARATION_STEP) pushB = MAX_SEPARATION_STEP;
                  a.position.x -= nx * pushA; a.position.y -= ny * pushA;
                  b.position.x += nx * pushB; b.position.y += ny * pushB;
                  a.asleep = false; a.sleepTimer = 0;
                  b.asleep = false; b.sleepTimer = 0;
                  const rvx = b.velocity.x - a.velocity.x;
                  const rvy = b.velocity.y - a.velocity.y;
                  const van = rvx * nx + rvy * ny;
                  if (van <= 0) {
                      // Mass-bias-compressed impulse split — same policy
                      // as resolveShardPair / resolveCollision.
                      const effInvMassA = Math.pow(invMassA, COLLISION_CONFIG.MASS_BIAS_EXPONENT);
                      const effInvMassB = Math.pow(invMassB, COLLISION_CONFIG.MASS_BIAS_EXPONENT);
                      const j = -(1 + ELASTICITY) * van / (effInvMassA + effInvMassB);
                      a.velocity.x -= nx * j * effInvMassA; a.velocity.y -= ny * j * effInvMassA;
                      b.velocity.x += nx * j * effInvMassB; b.velocity.y += ny * j * effInvMassB;
                  }
              }
          }
      }

      if (shifted) { wrapPosition(a.position); wrapPosition(b.position); }
  }

  private resolveCollision(
    a: GameEntity,
    b: GameEntity,
    mtv: Vector2,
    onDamage?: (pos: Vector2, amount: number, target?: GameEntity, impactWorldPos?: Vector2) => void,
    onDeath?: (entity: GameEntity) => void,
    onShake?: (amount: number, opts?: { dirX?: number; dirY?: number }) => void,
    onHit?: (impactPos: Vector2, proj: GameEntity, target: GameEntity) => void
  ) {
      if (a.type === EntityType.PARTICLE || b.type === EntityType.PARTICLE) return;

      // ── Passthrough-and-shatter (g3 material-interactions) ────────────
      // Variants whose SHARD_VARIANTS entry sets
      // `passthroughShatter.targets` (today: metal-shard targeting
      // glass-tile + glass-shard) skip impulse / positional
      // correction entirely on contact and route the target through
      // its standard death pipeline.  Checked before everything
      // else so projectile / shake / drop branches don't bounce
      // off a tile that's about to shatter from this contact.
      if (this.tryPassthroughShatter(a, b, onDeath)) return;

      // Plastic cross-material transmute — smaller plastic-shard
      // adopts the partner's material at its current size + shape.
      // Runs before nebula passThrough so the transmute fires on
      // glass / rock / metal partners only (nebula partners are in
      // PLASTIC_TRANSMUTE_EXCLUDE, so this is a fast no-op there);
      // post-transmute the entity behaves as its new variant for the
      // remainder of resolveCollision.
      this.tryPlasticTransmuteOnContact(a, b);

      // ── NEBULA: pass-through with conditional shatter ──────────────────
      // Stage 5: per-variant passThrough flag drives the impulse skip.
      // Nebula tiles AND nebula shards both set passThrough=true, so
      // strikers (player / enemy / projectile) glide through both with
      // no SAT impulse.  Player→shard motion is instead driven by the
      // PhysicsSystem.applyNebulaPlayerPull gravity field; contact
      // still triggers a shatter via the path below.
      //
      // DBG override mirrors the fast-path gate above — nebula-pair
      // hard collisions when the toggle is on.  Two cases skip the
      // passThrough gate so the standard SAT impulse runs:
      //   - nebula-shard ↔ nebula-shard, DBG-toggled by
      //     nebulaShardCollisionsEnabled (A/B-test for the gather-
      //     pile fix).
      //   - nebula-shard ↔ nebula-tile, unconditional — shards
      //     should bounce off cloud tiles instead of drifting
      //     through them.
      const aIsNebShard = a.shardVariant === 'nebula-shard';
      const bIsNebShard = b.shardVariant === 'nebula-shard';
      const aIsNebTile  = a.shardVariant === 'nebula-tile';
      const bIsNebTile  = b.shardVariant === 'nebula-tile';
      const nebShardPair = this.nebulaShardCollisionsEnabled && aIsNebShard && bIsNebShard;
      const nebShardTilePair = (aIsNebShard && bIsNebTile) || (bIsNebShard && aIsNebTile);
      // Player ↔ nebula-shard hard collision (DBG, default OFF) — the ship
      // physically parts the cloud instead of gliding through.  Bypasses the
      // passThrough gate so the pair below takes the normal SAT impulse.  Off
      // by default; the pass-through swirl (applyNebulaPlayerPull) is the
      // standard interaction.
      const playerNebShardPair = this.playerNebulaCollisionEnabled
          && ((aIsNebShard && b.type === EntityType.PLAYER)
              || (bIsNebShard && a.type === EntityType.PLAYER));
      const nebPairCollides = nebShardPair || nebShardTilePair || playerNebShardPair;
      const aPassThrough = !nebPairCollides && a.shardVariant !== undefined && SHARD_VARIANTS[a.shardVariant].passThrough === true;
      const bPassThrough = !nebPairCollides && b.shardVariant !== undefined && SHARD_VARIANTS[b.shardVariant].passThrough === true;
      if (aPassThrough || bPassThrough) {
          // Both sides pass-through (e.g. tile-vs-tile in some future
          // configuration) — no impulse, no shatter.
          if (aPassThrough && bPassThrough) return;

          const nebula = aPassThrough ? a : b;
          const other  = aPassThrough ? b : a;

          // Striker must be PLAYER or ENEMY to shatter, AND must not
          // be in the post-shatter cooldown window.  Only nebula-tiles
          // shatter on contact — nebula-shards interact with the
          // player exclusively through the applyNebulaPlayerPull
          // gravity field; contact alone is a pure pass-through with
          // no destruction.
          const isShatterable = nebula.shardVariant === 'nebula-tile';
          const shatters = isShatterable
                            && (other.type === EntityType.PLAYER || other.type === EntityType.ENEMY)
                            && (other.nebulaImpactCooldown ?? 0) <= 0;
          if (shatters) {
              // Size floor check: below MIN_SHATTER_DIAMETER the child
              // diameter would be too small to spawn, so just pass through.
              const parentD = Math.max(nebula.size.x, nebula.size.y);
              const childD  = parentD * NEBULA_CONSTANTS.SHARD_LINEAR_RATIO;
              if (childD >= NEBULA_CONSTANTS.MIN_SHATTER_DIAMETER) {
                  if (other.velocity) {
                      nebula.lastImpactVelocity = { x: other.velocity.x, y: other.velocity.y };
                  }
                  nebula.lastImpactDamage = 1;
                  nebula.health = 0;
                  // Effective fade-out duration scales with impact speed —
                  // a fast collision snaps through the fade, while slow
                  // drift-through keeps the graceful 1s dissolution.
                  // Both the duration AND the initial timer value get
                  // the scaled value so the renderer's alpha = timer /
                  // duration normalisation stays correct.
                  const impactSpeed = other.velocity
                      ? Math.sqrt(other.velocity.x * other.velocity.x + other.velocity.y * other.velocity.y)
                      : 0;
                  const rateScale = nebulaFadeRateScale(impactSpeed);
                  const scaledFadeDuration = NEBULA_CONSTANTS.FADE_DURATION / rateScale;
                  nebula.mergeFadeTimer = scaledFadeDuration;
                  nebula.mergeFadeDuration = scaledFadeDuration;
                  if (nebula.shardVariant === 'nebula-tile') {
                      // Tiles live in the static grid — pull them out so
                      // the player can drift through the fading cell.
                      this.removeStaticEntity(nebula);
                  }
                  // Shards live in the dynamic grid which is rebuilt
                  // each frame; the populate loop below skips entities
                  // with mergeFadeTimer set, so fading shards drop out
                  // of broadphase automatically on the next frame.
                  //
                  // Arm the striker's post-shatter cooldown.
                  other.nebulaImpactCooldown = NEBULA_CONSTANTS.IMPACT_COOLDOWN;
                  if (onDeath) onDeath(nebula);
              }
          }
          // No impulse / no positional correction regardless of outcome.
          return;
      }

      // INTERACTABLE collision rules:
      // - Non-drop interactables (POIs, etc.): skip entirely.
      // - Glass shards are full physics participants — they interact with everything
      //   (player, enemies, projectiles, asteroids, structures).  They are environmental
      //   debris and should deflect shots and bounce off ships.
      // - Collectible drops (salvage + health) are kept OUT of the dynamic grid
      //   entirely (see the dropType skip in the grid build), so they never
      //   reach this resolver — projectiles + ships pass through them and
      //   collection is purely the GameEngine magnet/proximity scan.  The
      //   non-glass branch below is a defensive guard in case one is ever
      //   re-added to the grid.
      if (a.type === EntityType.INTERACTABLE || b.type === EntityType.INTERACTABLE) {
          const dropA = a.type === EntityType.INTERACTABLE && !!a.dropType;
          const dropB = b.type === EntityType.INTERACTABLE && !!b.dropType;
          if (!dropA && !dropB) return; // non-drop interactable (POI, etc.) — skip
          const drop  = dropA ? a : b;
          const other = dropA ? b : a;
          if (drop.dropType !== 'glass') {
              // Only player projectiles can break collectible drops.
              // Enemy shots pass through them so enemies can't farm the player's loot.
              const isPlayerShot = other.type === EntityType.PROJECTILE && other.ownerType === EntityType.PLAYER;
              if (!isPlayerShot && other.type !== EntityType.STRUCTURE
                      && other.type !== EntityType.PLAYER) return;
              // Health drops: player passes through without a physics impulse.
              // Collection is handled by proximity check in GameEngine each frame.
              if (other.type === EntityType.PLAYER && drop.dropType === 'health') return;
          }
          // Glass shards: fall through — interact with all entity types.
      }

      // --- PROJECTILE COLLISIONS ---
      if (a.type === EntityType.PROJECTILE || b.type === EntityType.PROJECTILE) {
          const proj = a.type === EntityType.PROJECTILE ? a : b;
          const target = a.type === EntityType.PROJECTILE ? b : a;

          // Ignore friendly fire and projectile-projectile.  EXCEPTION: a
          // third-party entity (the bubble) is fair game for everyone — enemy
          // fire can hit it (Stage 5), so the enemy-vs-enemy filter is bypassed
          // when the target is neutral.
          if (target.type === EntityType.PROJECTILE) return;
          if (target.type === EntityType.PLAYER && proj.ownerType === EntityType.PLAYER) return;
          // Ally/neutral rival fire passes through the player (Stage 7) — its
          // shots are meant for the wave enemies, not the pilot.
          if (target.type === EntityType.PLAYER && proj.sparesPlayer) return;
          // Enemy-vs-enemy friendly fire, EXCEPT: a neutral third party (bubble)
          // is fair game for all, and a rival's `hitsEnemies` shot is allowed to
          // damage the wave enemies (Stage 7) — but never another rival.
          if (target.type === EntityType.ENEMY && proj.ownerType === EntityType.ENEMY
              && !target.thirdParty && !proj.hitsEnemies) return;
          if (proj.hitsEnemies && target.isRival) return;

          // Bouncer projectiles reflect off STRUCTURE tiles + glass-shards
          // (today's "tile shards"); they pass through every other shard
          // variant (rock-shards, nebula tiles, nebula shards).
          //
          // Stage 5: shard-family entities all share EntityType.STRUCTURE
          // now, so distinguishing static tiles vs glass-shards needs a
          // variant check.  STRUCTURE-tile variants (glass / plastic /
          // metal / indestructible) are mass=Infinity, so we can short-
          // circuit on that for tile reflection.  Mobile shards then
          // need a per-variant check — only glass-shard reflects.
          if (proj.isBouncer) {
              let isReflective = false;
              if (target.type === EntityType.STRUCTURE) {
                if (target.mass === Infinity) {
                  // Static tile.  All STRUCTURE tile variants reflect EXCEPT
                  // nebula-tile (passThrough = true).
                  isReflective = target.shardVariant !== 'nebula-tile';
                } else {
                  // Mobile shard.  Only glass-shard reflects.
                  isReflective = target.shardVariant === 'glass-shard';
                }
              }
              const isTile = isReflective;
              // Bounce-count gate: when bouncesRemaining is set (post-d2
              // pierce-beam), the projectile dissipates after N reflections
              // instead of bouncing forever inside its lifetime window.
              // bouncesRemaining=0 means "no bounces left" → deactivate on
              // the contact frame, fire onHit at the contact point, skip
              // the reflection math.
              if (isTile && proj.velocity && proj.bouncesRemaining !== undefined && proj.bouncesRemaining <= 0) {
                  if (onHit) onHit(proj.position, proj, target);
                  proj.active = false;
                  return;
              }
              if (isTile && proj.velocity) {
                  // Tiles are axis-aligned AABBs, and the projectile is thin and
                  // rotated along its travel direction — SAT's minimum-overlap axis
                  // is often the wrong reflection axis. Instead, infer the entry
                  // face from the projectile's velocity direction and the tile's
                  // dilated AABB: for each axis, compute the reverse-unwind time
                  // to exit the corresponding entry face. The axis with the smaller
                  // unwind time was the most-recently-crossed face → that's the
                  // face we bounce off of.
                  const tileHX = target.size.x / 2;
                  const tileHY = target.size.y / 2;

                  // Effective projectile half-extents along world X and Y,
                  // accounting for the projectile's rotation. This lets us push
                  // the projectile out just enough to clear the tile face,
                  // avoiding big visual teleports that break the trail.
                  const cosR = Math.abs(Math.cos(proj.rotation));
                  const sinR = Math.abs(Math.sin(proj.rotation));
                  const hw = proj.size.x / 2;
                  const hh = proj.size.y / 2;
                  const hxEff = cosR * hw + sinR * hh;
                  const hyEff = sinR * hw + cosR * hh;

                  const vx = proj.velocity.x;
                  const vy = proj.velocity.y;
                  const relX = proj.position.x - target.position.x;
                  const relY = proj.position.y - target.position.y;

                  // Reverse-unwind time to the entry face along each axis, using
                  // a conservative dilated AABB (use max effective half-extent).
                  const dHX = tileHX + hxEff;
                  const dHY = tileHY + hyEff;
                  let tX = Infinity;
                  let tY = Infinity;
                  if (vx >  0.0001) tX = (relX + dHX) / vx;  // entered through left face
                  else if (vx < -0.0001) tX = (relX - dHX) / vx;  // entered through right face
                  if (vy >  0.0001) tY = (relY + dHY) / vy;
                  else if (vy < -0.0001) tY = (relY - dHY) / vy;

                  // Contact point on the tile face, clamped to the tile's extent —
                  // this is where sparks should spawn so they sit on the surface
                  // rather than inside the tile.
                  let contactX = 0;
                  let contactY = 0;

                  // Pick the entry axis: the one with the SMALLER reverse-unwind
                  // time was crossed last, so that's the face we're reflecting off.
                  // Snap the projectile position to just outside that face + ε.
                  //
                  // The face normal then goes through the SHARED deflection
                  // helper — the same one the shield ring uses.  For an
                  // axis-aligned normal its mirror reduces to negating one
                  // component, which is exactly the arithmetic this branch used
                  // to do by hand.  `keepHoming` because a tile bounce is the
                  // bouncer working as designed, not a shot being turned away.
                  if (tX <= tY) {
                      const nx = vx > 0 ? -1 : 1;
                      contactX = target.position.x + nx * tileHX;
                      contactY = Math.max(
                          target.position.y - tileHY,
                          Math.min(target.position.y + tileHY, proj.position.y)
                      );
                      PhysicsSystem.deflectProjectile(proj, nx, 0, {
                          snapX: target.position.x + nx * (tileHX + hxEff + 0.5),
                          keepHoming: true,
                      });
                  } else {
                      const ny = vy > 0 ? -1 : 1;
                      contactY = target.position.y + ny * tileHY;
                      contactX = Math.max(
                          target.position.x - tileHX,
                          Math.min(target.position.x + tileHX, proj.position.x)
                      );
                      PhysicsSystem.deflectProjectile(proj, 0, ny, {
                          snapY: target.position.y + ny * (tileHY + hyEff + 0.5),
                          keepHoming: true,
                      });
                  }

                  // Decrement remaining-bounces counter (set on bouncer
                  // projectiles via WeaponConfig.bounceCount).  Counter is
                  // checked at the top of the reflection branch on the
                  // *next* tile contact; the projectile keeps moving on
                  // this frame after the reflection.
                  if (proj.bouncesRemaining !== undefined) {
                      proj.bouncesRemaining -= 1;
                  }

                  // Fire the impact callback AFTER the reflection so sparks spawn
                  // on the tile's surface and spray along the outgoing (reflected)
                  // velocity direction — away from the tile, not into it.
                  if (onHit) onHit({ x: contactX, y: contactY }, proj, target);
                  return;
              }
          }

          let projDmg = proj.damage || 1;

          // Shield absorbs damage — generalized from player-only to ANY
          // shielded entity (Stage 0 Bulwark): the enemy shield soaks the hit
          // and re-arms its recharge delay exactly like the player's.  Entities
          // without a shield (shield undefined) fall straight through.  A
          // directional arc shield only absorbs hits from the covered sector
          // (PhysicsSystem.shieldCoversHit) — flank it and the shot lands.  An
          // EMP-disabled shield (Stage 3c) is offline and absorbs nothing.
          if ((target.shield ?? 0) > 0 && (target.maxShield ?? 0) > 0
              && !target.systemsDisabled
              && PhysicsSystem.shieldCoversHit(target, proj)) {

              // CONTACT DEFLECT — the non-arc half of "every live shield turns
              // shots away".  A bubble pool's ring IS the shield-inflated
              // collision shape, so the moment SAT reports contact the bolt is
              // AT the shield: deflect it here rather than trying to predict
              // the same contact with a radius up in `tryShieldDeflect`.  That
              // prediction cannot be made to agree — an entity with no
              // `polygonPoints` (the player) is SAT-boxed, and a box's corners
              // reach √2 past the circle the ring is drawn as, so every
              // off-axis shot hit the square before entering the circle and was
              // absorbed instead (playtest: "no deflection from the base enemy
              // blaster").  Reacting to the contact makes the property true by
              // construction: this runs at exactly the moments the absorb
              // below would have.
              //
              // The shield still pays exactly `projDmg`, and a shot bigger than
              // the pool still falls through to the partial absorb.
              if (target.shieldArcHalfWidth === undefined && projDmg <= target.shield!) {
                  const sdx = wrapDeltaX(target.position.x, proj.position.x);
                  const sdy = wrapDeltaY(target.position.y, proj.position.y);
                  const sdist = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
                  const snx = sdx / sdist, sny = sdy / sdist;
                  // A bolt already on its way OUT is one this shield just
                  // turned away; it is not charged for a second time and it
                  // does not reach the hull either.
                  if (proj.velocity.x * snx + proj.velocity.y * sny >= 0) return;
                  // Snap clear of wherever the contact actually happened —
                  // measured from the bolt's own distance rather than the ring
                  // radius, since the shape that just caught it may reach
                  // further than the circle.
                  const clear = sdist + getCollisionR(proj) + 2;
                  // THE PLAYER'S DEFLECT IS A PARRY (user call): the turned
                  // bolt is re-owned to the player, so instead of flying off
                  // as a dud it stays live against the enemies that fired it
                  // — it damages them, pays their kills, and a parried HOMING
                  // missile keeps homing, which under player ownership means
                  // the owner-aware homing pass now steers it at the nearest
                  // enemy: the missile turns on its makers with no new
                  // plumbing.  Re-owning also clears `hitEntityIds` (see
                  // DeflectOptions), so the redirected shot may strike the
                  // very targets it was refused before.  A player-owned bolt
                  // cannot hit the player, so the re-home-into-the-shield
                  // loop the default guards against cannot arise here.
                  // ENEMY shields deliberately do NOT parry: a Warden that
                  // re-owned your own cannon shell would turn your gun on
                  // you, which is a design decision nobody has made.
                  const parry = target.type === EntityType.PLAYER;
                  PhysicsSystem.deflectProjectile(proj, snx, sny, {
                      snapX: target.position.x + snx * clear,
                      snapY: target.position.y + sny * clear,
                      ...(parry ? {
                          reownType: EntityType.PLAYER, reownId: 'player',
                          keepHoming: true,
                      } : {}),
                  });
                  target.shield! -= projDmg;
                  markShieldDamaged(target);
                  target.shieldHitFlash = SHIELD_CONSTANTS.HIT_FLASH_DURATION;
                  target.shieldRechargeTimer = SHIELD_CONSTANTS.RECHARGE_DELAY;
                  this.sfx?.(target.shield! <= 0 ? 'impact.shield.break' : 'impact.shield.deflect',
                             proj.position.x, proj.position.y);
                  if (onHit) onHit(proj.position, proj, target);
                  return;
              }

              const absorbed = Math.min(target.shield!, projDmg);
              target.shield! -= absorbed;
              markShieldDamaged(target);
              projDmg -= absorbed;
              target.shieldHitFlash = SHIELD_CONSTANTS.HIT_FLASH_DURATION;
              target.shieldRechargeTimer = SHIELD_CONSTANTS.RECHARGE_DELAY;
              // Shield hits must be tellable from hull hits BY EAR — "did
              // that cost me health?" is a live decision.  A shield that
              // just collapsed gets its own, louder cue.
              this.sfx?.(target.shield! <= 0 ? 'impact.shield.break' : 'impact.shield.absorb',
                         target.position.x, target.position.y);
          }
          // (h) front-shield: a permanent directional plate on the entity's
          // FACING cuts covered hits.  Deliberately applied BEFORE the regen
          // burst bucket below sees the damage — so bursting a plated target
          // means bursting it FROM BEHIND, which is what makes the plate+regen
          // phase the hard part of the Bastion fight.
          if (this.traitsEnabled && target.frontShield && projDmg > 0
              && PhysicsSystem.frontShieldCoversHit(target, proj)) {
              projDmg *= (1 - target.frontShield.reduction);
              target.shieldHitFlash = SHIELD_CONSTANTS.HIT_FLASH_DURATION;
          }
          // Armored enemies shrug off small per-hit "chip" damage — demands
          // big-hit weapons (counterplay trait; AoE bypasses, see GameEngine).
          if (this.traitsEnabled && target.armor && projDmg > 0 && projDmg < target.armor.chipThreshold) {
              projDmg *= (1 - target.armor.reduction);
              // A thick, dead clunk: the audible half of the reduced
              // damage number this path already shows.
              this.sfx?.('impact.armor.chip', target.position.x, target.position.y);
          }
          // (h) regen: feed the APPLIED damage into the fixed burst bucket.
          // No-op without the trait.
          if (this.traitsEnabled) noteTraitDamage(target, projDmg);
          if (projDmg > 0) {
              // Indestructible tiles eat the projectile without losing
              // health — flash only, health stays pinned.  Everything
              // else takes the full projectile damage.
              const isIndestructibleTile = target.type === EntityType.STRUCTURE
                  && target.shardVariant === 'indestructible-tile';
              // Dent-policy entities consume one HP per projectile
              // regardless of the projectile's damage value — so "hits
              // to break" tracks the player's mental model (each click
              // is one hit, independent of weapon power).  Applies to
              // both static dent tiles and mobile dent shards (plastic
              // and metal share the policy).  A Cannon shot at damage=5
              // costs the target 1 HP and runs one dent step, not five.
              // Hardness scales via the entity's health alone.
              const isDentEntity = target.shardVariant !== undefined
                  && SHARD_VARIANTS[target.shardVariant].dent !== undefined;
              // Rock tiles / asteroids / rock-shards also count "hits, not
              // damage": their maxHealth is a hit ceiling (ROCK_BREAK), so
              // every shot costs exactly 1 HP regardless of weapon power and
              // the probabilistic break rolls per hit.  (rock-tile is already
              // a dent entity; rock-shard has no dent policy, so name it.)
              const isHitCounted = isDentEntity
                  || target.shardVariant === 'rock-shard';
              if (!isIndestructibleTile) {
                  target.health -= isHitCounted ? 1 : projDmg;
                  // Dent-policy entities deform on every damage event,
                  // even the killing blow — the spawned mobile shard
                  // inherits the dented polygon at the post-deformation
                  // size.  Impact position is the projectile's current
                  // world position; applyDentStep finds the closest
                  // vertex.
                  PhysicsSystem.applyDentStep(target, proj.position);
                  // Stamp lastImpactVelocity on every dent hit (not
                  // only the killing blow) so intermediate shard
                  // spawns at HP thresholds know which direction to
                  // launch the freed chunk.  This was previously
                  // only set inside the `target.health <= 0` block
                  // below.
                  if (isDentEntity && target.type === EntityType.STRUCTURE && proj.velocity) {
                      target.lastImpactVelocity = { x: proj.velocity.x, y: proj.velocity.y };
                      target.lastImpactDamage = proj.damage ?? 1;
                  }
                  // Mobile dent shards (plastic-shard, metal-shard) get
                  // a velocity kick from the projectile — they're free-
                  // floating, so a hit should both deform AND push.
                  // Push magnitude scales inversely with shard mass so
                  // heavier metal shards take a smaller kick than the
                  // lighter plastic.  Static tiles (mass = Infinity)
                  // are filtered out by the finite-mass check.
                  //
                  if (isDentEntity && target.mass !== Infinity && proj.velocity) {
                      const pushFactor = 0.20 / Math.max(1, target.mass / 10);
                      target.velocity.x += proj.velocity.x * pushFactor;
                      target.velocity.y += proj.velocity.y * pushFactor;
                  }
                  // Probabilistic early break for rock tiles / asteroids /
                  // rock-shards (no-op for other variants).  Zeroes health
                  // on a successful roll so the shared death check below
                  // shatters it on this hit.
                  PhysicsSystem.maybeRockEarlyBreak(target);
              }
              target.hitFlash = 0.1;
              // Hit feedback — uncapped damage-scaled knockback + stagger so
              // the hit reads (post-armor projDmg, so chip hits kick weakly).
              if (target.type === EntityType.ENEMY && proj.velocity && !target.isExploding) {
                  const vmag = Math.hypot(proj.velocity.x, proj.velocity.y) || 1;
                  // POISE ((h)): a heavy hull takes a scaled-down shove and only
                  // staggers on a real hit, so a chip stream can neither push it
                  // off its line nor hold it in permanent hit-stun.  Absent →
                  // unchanged behaviour for every rank-and-file enemy.
                  const poise = target.poise;
                  // MOMENTUM in, velocity out — mass matters here exactly as
                  // it does for the shard push below and for the screen shake.
                  // Capped in the target's OWN top speed so a hit can never
                  // shove a body faster than it can fly under its own power.
                  const kickCap = HIT_FEEDBACK.KICK_MAX_SPEED_FRAC
                      * Math.max(target.maxSpeed ?? 0, HIT_FEEDBACK.KICK_SPEED_FLOOR);
                  const kickMass = target.mass === Infinity ? Infinity : Math.max(0.01, target.mass);
                  const kick = Math.min(
                      projDmg * HIT_FEEDBACK.KICK_IMPULSE_PER_DMG / kickMass,
                      kickCap,
                  ) * (poise ? poise.knockScale : 1);
                  target.velocity.x += (proj.velocity.x / vmag) * kick;
                  target.velocity.y += (proj.velocity.y / vmag) * kick;
                  if (!poise || projDmg >= poise.stunDamage) target.hitStun = HIT_FEEDBACK.STUN_SEC;
                  markDamaged(target, 0.18); // bigger flash + scale-punch on impact
                  // Scale-punch magnitude ∝ damage / maxHealth, so a chip on a
                  // tanky beast barely flinches and a heavy hit on a frail enemy snaps.
                  target.hitReact = hitReactStrength(projDmg, target.maxHealth ?? target.health);
                  target.provoked = true; // Stage 3a: a hit aggros a passive enemy
                  // Third-party retaliation (Stage 5): the bubble targets its
                  // attacker (player or the firing enemy), retargeting on each
                  // new hit.
                  if (target.thirdParty && proj.ownerId) target.aggroTargetId = proj.ownerId;
                  // A shot to a LATCHED bubble shakes it loose (→ sick) — read by
                  // GameEngine.updateBubbles.
                  if (target.attachedToId !== undefined) target.bubbleKnockFree = true;
              }
          }

          if (onShake && target.type !== EntityType.STRUCTURE) {
              if (target.type === EntityType.PLAYER) {
                  // Heavy shots wallop, chip shots barely register — scale the
                  // shake AND shove the player along the shot direction by the
                  // projectile's intrinsic damage (so a slug felt even through
                  // the shield).
                  const impactDmg = proj.damage || 1;
                  // Along the SHOT's travel direction — a bolt to the flank
                  // should throw the camera sideways, not shiver it.  The
                  // magnitude stays damage-driven: a projectile's momentum is
                  // negligible against the hull, so what the player feels is
                  // the hit, not the shove.
                  const pv = proj.velocity;
                  const pvm = pv ? Math.hypot(pv.x, pv.y) : 0;
                  onShake(Math.min(HIT_FEEDBACK.PLAYER_SHAKE_MAX,
                      HIT_FEEDBACK.PLAYER_SHAKE_BASE + impactDmg * HIT_FEEDBACK.PLAYER_SHAKE_PER_DMG),
                      pvm > 0 ? { dirX: pv!.x / pvm, dirY: pv!.y / pvm } : undefined);
                  if (proj.velocity && !target.isExploding) {
                      const vmag = Math.hypot(proj.velocity.x, proj.velocity.y) || 1;
                      // Same impulse rule, so a laden hull is shoved less —
                      // normalised to leave the lean ship exactly as it was.
                      const kick = impactDmg * HIT_FEEDBACK.PLAYER_KICK_IMPULSE_PER_DMG
                          / Math.max(1, target.mass);
                      target.velocity.x += (proj.velocity.x / vmag) * kick;
                      target.velocity.y += (proj.velocity.y / vmag) * kick;
                      markDamaged(target, Math.max(target.hitFlash ?? 0, Math.min(0.3, 0.08 + impactDmg * 0.012)));
                  }
              } else {
                  onShake(COLLISION_CONFIG.SHAKE.MICRO);
              }
          }

          if (onHit) onHit(proj.position, proj, target);
          // Armored enemies show the REDUCED number (chip feedback); others
          // show the raw projectile damage.
          const shownDmg = target.armor ? projDmg : (proj.damage || 1);
          if (onDamage) onDamage(target.position, shownDmg, target, proj.position);

          if (target.health <= 0) {
              // Player-attributed kill stamp — handleEntityDeath awards
              // shard/tile destruction points only when this is set.
              if (proj.ownerType === EntityType.PLAYER) target.killedByPlayer = true;
              // Rival kill (Stage 7): deny the player this enemy's points + combo.
              else if (proj.hitsEnemies && target.type === EntityType.ENEMY && !target.isRival) target.killedByRival = true;
              // Stamp the impactor's velocity so shard spawning can scatter
              // pieces in the direction of impact rather than randomly.
              if (target.type === EntityType.STRUCTURE) {
                  if (proj.velocity) target.lastImpactVelocity = { x: proj.velocity.x, y: proj.velocity.y };
                  target.lastImpactDamage = proj.damage ?? 1;
              }
              if (target.type === EntityType.STRUCTURE && target.mass === Infinity) {
                  this.removeStaticEntity(target);
              }
              if (onDeath) onDeath(target);
              if (!target.isExploding) {
                  target.active = false;
              }
          }

          // Penetration: if the projectile still has pierce capacity, let it continue
          // through the target rather than stopping. Track struck IDs to avoid
          // hitting the same entity multiple times on consecutive frames.
          const pierce = proj.pierceCount ?? 0;
          const alreadyHit = proj.hitEntityIds?.includes(target.id) ?? false;

          if (!alreadyHit && pierce > 0 && !target.isExploding) {
              proj.pierceCount = pierce - 1;
              if (!proj.hitEntityIds) proj.hitEntityIds = [];
              proj.hitEntityIds.push(target.id);
              // Still impart momentum impulse even when piercing
              if (target.mass !== Infinity && proj.velocity) {
                  const massRatio = (proj.mass ?? 1) / target.mass;
                  target.velocity.x += proj.velocity.x * massRatio * 0.3;
                  target.velocity.y += proj.velocity.y * massRatio * 0.3;
              }
          } else if (!target.isExploding) {
              proj.active = false;
              if (target.mass !== Infinity && proj.velocity) {
                  const massRatio = (proj.mass ?? 1) / target.mass;
                  target.velocity.x += proj.velocity.x * massRatio;
                  target.velocity.y += proj.velocity.y * massRatio;
              }
          }
          return;
      }

      // --- ENEMY vs PLAYER ---
      if (a.type === EntityType.ENEMY || b.type === EntityType.ENEMY) {
          const target = a.type === EntityType.ENEMY ? b : a;
          if (target.type === EntityType.PLAYER) {
              const enemy = a.type === EntityType.ENEMY ? a : b;
              const rdx = enemy.velocity.x - target.velocity.x;
              const rdy = enemy.velocity.y - target.velocity.y;
              const ramImpact = Math.sqrt(rdx * rdx + rdy * rdy);
              // Below shield damage threshold: contact flash only, no damage
              // Per-archetype contact damage (rushers hurt; ranged enemies
              // have 0).  No damage below the impact-speed threshold either.
              const contact = enemy.contactDamage ?? COLLISION_CONFIG.DAMAGE.PLAYER_RAM_ENEMY;
              // Die-on-contact gnats (Swarm): pop on the FIRST touch, dealing
              // their small bite once (regardless of impact speed, so a clinging
              // gnat can't friction-chip), then die — a discrete hit + visible
              // pop instead of an endless cling, and it self-clears the cloud.
              if (enemy.diesOnContact && !enemy.isExploding) {
                  if (contact > 0) {
                      let bite = contact * (enemy.damageMult ?? 1);
                      if ((target.shield ?? 0) > 0 && !target.systemsDisabled) {
                          const absorbed = Math.min(target.shield!, bite);
                          target.shield! -= absorbed;
                          markShieldDamaged(target);
                          bite -= absorbed;
                          target.shieldHitFlash = SHIELD_CONSTANTS.HIT_FLASH_DURATION;
                          target.shieldRechargeTimer = SHIELD_CONSTANTS.RECHARGE_DELAY;
                      }
                      if (bite > 0) { target.health -= bite; markDamaged(target, 0.2); }
                      if (onShake) onShake(COLLISION_CONFIG.SHAKE.MICRO);
                      if (target.health <= 0 && onDeath) onDeath(target);
                  }
                  enemy.health = 0;
                  if (onDeath) onDeath(enemy); // pop (death FX + score)
              } else if (ramImpact < SHIELD_CONSTANTS.DAMAGE_THRESHOLD || contact <= 0 || enemy.isExploding) {
                  // flash already handled by the general contact flash below
              } else {
                  // Per-wave enemy damage scaling rides enemy.damageMult.
                  const ramBase = contact * (enemy.damageMult ?? 1);
                  let ramDmg = ramBase;
                  if ((target.shield ?? 0) > 0 && !target.systemsDisabled) {
                      const absorbed = Math.min(target.shield!, ramDmg);
                      target.shield! -= absorbed;
                      markShieldDamaged(target);
                      ramDmg -= absorbed;
                      target.shieldHitFlash = SHIELD_CONSTANTS.HIT_FLASH_DURATION;
                      target.shieldRechargeTimer = SHIELD_CONSTANTS.RECHARGE_DELAY;
                  }
                  if (onDamage) onDamage(target.position, ramBase, target);
                  if (ramDmg > 0) {
                      target.health -= ramDmg;
                      markDamaged(target, 0.2);
                  }
                  if (onShake) onShake(COLLISION_CONFIG.SHAKE.MEDIUM);
                  if (target.health <= 0 && onDeath) {
                      onDeath(target);
                  }
              }
              // Kamikaze detonation (Stage 0): a bomber that reaches the player
              // detonates INSTANTLY at the contact point — flag it and route the
              // death now (handleEntityDeath fires the AoE shockwave), so it
              // never bounces away to explode at a distance.  explosionRadius is
              // the bomber marker; the !isExploding guard fires this exactly once.
              if (enemy.explosionRadius !== undefined && !enemy.isExploding) {
                  enemy.detonateOnDeath = true;
                  if (onDeath) onDeath(enemy);
              }
          }
      }

      // --- PHYSICAL BOUNCE (Impulse Resolution) ---
      const { CORRECTION_PERCENT, SLOP, ELASTICITY } = COLLISION_CONFIG;
      const invMassA = a.mass === Infinity ? 0 : 1 / a.mass;
      const invMassB = b.mass === Infinity ? 0 : 1 / b.mass;
      const totalInvMass = invMassA + invMassB;

      if (totalInvMass === 0) return;

      const mtvLen = Math.sqrt(mtv.x**2 + mtv.y**2);
      if (mtvLen < 0.0001) return;

      // 1. Positional Correction (Prevent Sinking)
      const correctionMag = (mtvLen - SLOP) / totalInvMass * CORRECTION_PERCENT;
      const nx = mtv.x / mtvLen;
      const ny = mtv.y / mtvLen;

      if (correctionMag > 0) {
          const px = nx * correctionMag;
          const py = ny * correctionMag;
          
          if (a.mass !== Infinity) {
              a.position.x -= px * invMassA;
              a.position.y -= py * invMassA;
          }
          if (b.mass !== Infinity) {
              b.position.x += px * invMassB;
              b.position.y += py * invMassB;
          }
      }

      // 2. Velocity Resolution (Bounce)
      const rvx = b.velocity.x - a.velocity.x;
      const rvy = b.velocity.y - a.velocity.y;
      const velAlongNormal = rvx * nx + rvy * ny;

      if (velAlongNormal > 0) return; // Moving away

      // Detect High Impact for Shake.
      //
      // Driven by the PLAYER'S OWN velocity step, not by closing speed: the
      // same quantity the impulse solver below is about to apply, so the
      // camera agrees with the physics instead of modelling it a second time.
      // Speed alone had no mass in it, which is why a chip and a wall shook
      // identically — see COLLISION_CONFIG.SHAKE.IMPACT_DV_MIN.
      const isPlayerCollision = (a.type === EntityType.PLAYER || b.type === EntityType.PLAYER);
      if (isPlayerCollision && onShake) {
          const playerIsA = a.type === EntityType.PLAYER;
          const player = playerIsA ? a : b;
          const other  = playerIsA ? b : a;
          const isHardTarget = other.type === EntityType.ENEMY || other.type === EntityType.STRUCTURE;
          if (isHardTarget) {
              const S = COLLISION_CONFIG.SHAKE;
              const dv = PhysicsSystem.impactStrength(player, other, velAlongNormal);
              if (dv > S.IMPACT_DV_MIN) {
                  // DIRECTION is the way the player is about to be shoved:
                  // the impulse acts along +n on b and -n on a.
                  const sign = playerIsA ? -1 : 1;
                  onShake(
                      Math.min(dv * S.IMPACT_DV_SCALE, S.IMPACT_MAX),
                      { dirX: nx * sign, dirY: ny * sign },
                  );
              }
          }
      }
      // Shield contact flash — any collision lights up the shield ring
      if (isPlayerCollision) {
          const player = a.type === EntityType.PLAYER ? a : b;
          if ((player.shield ?? 0) > 0) {
              player.shieldHitFlash = Math.max(player.shieldHitFlash ?? 0, SHIELD_CONSTANTS.CONTACT_FLASH_DURATION);
          }
          // Body slam against an enemy hull — harder-edged than the tile
          // crash, and gated on a real impact so drifting contact is silent.
          const other = a.type === EntityType.PLAYER ? b : a;
          if (other.type === EntityType.ENEMY && Math.abs(velAlongNormal) > 2.0) {
              // Voiced by the same strength the camera reads, so a gnat
              // glances off the hull and a Bastion stops you dead.  This row
              // used to pass nothing at all.
              this.sfx?.('crash.player.enemy', player.position.x, player.position.y,
                  PhysicsSystem.impactVoice(
                      PhysicsSystem.impactStrength(player, other, velAlongNormal),
                      other.mass, AUDIO_CONSTANTS.IMPACT_FLOOR_ENEMY, AUDIO_CONSTANTS.IMPACT_SPAN_ENEMY));
          }
      }

      // Structure crashing — player path.
      // Player punches through tiles on hard impact: the tile breaks apart
      // into glass shards (via onDeath → spawnDrops → spawnGlassShards)
      // and then regenerates on the normal 12 s timer (via onDeath → the
      // STRUCTURE branch of handleEntityDeath that queues pendingRegens).
      // Static tiles cost the player a fixed CRASH_VELOCITY_RETENTION
      // cut per crash-hit; mobile shards cost a mass-scaled cut and
      // receive the shed momentum (conserved hand-off, see below).
      //
      // Tiered tiles (plastic/metal) with maxHealth > 1 consume one
      // health tier per above-threshold crash rather than shattering in
      // one hit — the tile only onDeath's when health hits 0.
      //
      // Indestructible tiles short-circuit every destruction path: the
      // crash still flashes + sheds player velocity, but health stays
      // pinned and no onDeath fires.
      if ((a.type === EntityType.PLAYER && b.type === EntityType.STRUCTURE) || (b.type === EntityType.PLAYER && a.type === EntityType.STRUCTURE)) {
          const player = a.type === EntityType.PLAYER ? a : b;
          const structure = a.type === EntityType.STRUCTURE ? a : b;
          const impactSpeed = Math.abs(velAlongNormal);
          const isIndestructible = structure.shardVariant === 'indestructible-tile';

          // CONTACT AUDIO, split by what was hit.  A loose shard bouncing
          // off the hull is a completely different event from flying into
          // a wall, and it is audible far BELOW the speed needed to break
          // anything — so it gets its own voice and its own, much lower
          // threshold.  Previously both shared `crash.player.tile` gated at
          // CRASH_VELOCITY_THRESHOLD, which made light shard contact silent
          // and hard shard contact sound like masonry.
          if (structure.mass !== Infinity) {
              if (impactSpeed > STRUCTURE_CONSTANTS.SHARD_CONTACT_SPEED) {
                  // Gain and pitch from the shared impact strength: a light
                  // shard is quieter AND higher than a heavy one at the same
                  // closing speed, where before both came from raw speed and
                  // the shard's on-screen SIZE.  The speed GATE above is
                  // untouched — whether a contact is heard at all stays a
                  // contact question.
                  this.sfx?.('crash.player.shard', player.position.x, player.position.y,
                      PhysicsSystem.impactVoice(
                          PhysicsSystem.impactStrength(player, structure, velAlongNormal),
                          structure.mass, AUDIO_CONSTANTS.IMPACT_FLOOR_SHARD, AUDIO_CONSTANTS.IMPACT_SPAN_SHARD));
              }
          } else if (impactSpeed > STRUCTURE_CONSTANTS.CRASH_VELOCITY_THRESHOLD) {
              // Grinding, not explosive — and scaled by how hard you hit.  A
              // static tile takes the whole velocity step, which makes this
              // curve identical to the impactSpeed/12 it has always used.
              this.sfx?.('crash.player.tile', player.position.x, player.position.y,
                  PhysicsSystem.impactVoice(
                      PhysicsSystem.impactStrength(player, structure, velAlongNormal),
                      Infinity, AUDIO_CONSTANTS.IMPACT_FLOOR_TILE, AUDIO_CONSTANTS.IMPACT_SPAN_TILE));
          }

          if (impactSpeed > STRUCTURE_CONSTANTS.CRASH_VELOCITY_THRESHOLD) {
              // Stamp the pre-retention crash velocity so the death
              // pipeline (ShardSystem.shatter / spawnGlassShards)
              // scatters debris along the player's heading — same
              // contract as the projectile-hit stamp further down.
              structure.lastImpactVelocity = { x: player.velocity.x, y: player.velocity.y };
              // Mobile shards receive the momentum the player sheds.
              // The player's speed loss scales with the mass ratio (a
              // pebble barely slows the player; rocks at or above
              // player mass cost the full retention cut), and the same
              // Δp lands on the shard — so a killed rock's fragments
              // inherit real forward velocity instead of scattering
              // from rest, and a survivor gets knocked downrange.
              let retention = STRUCTURE_CONSTANTS.CRASH_VELOCITY_RETENTION;
              if (structure.mass !== Infinity) {
                  const lossFrac = (1 - retention)
                      * Math.min(1, structure.mass / player.mass);
                  retention = 1 - lossFrac;
                  const dvFactor = lossFrac * (player.mass / structure.mass);
                  structure.velocity.x += player.velocity.x * dvFactor;
                  structure.velocity.y += player.velocity.y * dvFactor;
              }
              player.velocity.x *= retention;
              player.velocity.y *= retention;
              structure.hitFlash = 0.1;
              if (isIndestructible || structure.dragonSegment === true) {
                  // Permanent wall — OR a dragon body segment, which only breaks
                  // when SHOT, not by crashing into it.  Signal the hit (flash /
                  // shake / the player already shed velocity above) but leave its
                  // health alone and queue no destruction.
                  if (onDamage) onDamage(structure.position, COLLISION_CONFIG.DAMAGE.STRUCTURE_IMPACT, structure, player.position);
                  return;
              }
              structure.health -= 1;
              PhysicsSystem.applyDentStep(structure, player.position);
              // A crash is a hit too — let rock break early on the same
              // rising-odds roll as a blaster shot (no-op for other tiles).
              PhysicsSystem.maybeRockEarlyBreak(structure);
              if (onDamage) onDamage(structure.position, COLLISION_CONFIG.DAMAGE.STRUCTURE_IMPACT, structure, player.position);
              if (structure.health <= 0) {
                  // Same helper as the two asteroid sites, so all three
                  // collision kills break identically; only the attribution
                  // differs (a crash IS the player's kill, and scores).
                  const over = impactSpeed / STRUCTURE_CONSTANTS.CRASH_VELOCITY_THRESHOLD - 1;
                  const impactDamage = 1 + 4 * Math.max(0, Math.min(1, over / 3));
                  this.killStructureByImpact(structure, player, impactDamage, true, onDeath);
              }
              return;
          } else if (impactSpeed > COLLISION_CONFIG.ENV_DAMAGE.SPEED_THRESHOLD) {
              // Light bump — tile doesn't break, but the player takes
              // environmental damage proportional to the impact speed.
              // Route through shield first (same model as enemy-ram
              // damage above): absorb up to the current shield value,
              // then bleed the remainder into health.
              let envDmg = impactSpeed * COLLISION_CONFIG.ENV_DAMAGE.MULTIPLIER;
              if ((player.shield ?? 0) > 0) {
                  const absorbed = Math.min(player.shield!, envDmg);
                  player.shield! -= absorbed;
                  markShieldDamaged(player);
                  envDmg -= absorbed;
                  player.shieldHitFlash = SHIELD_CONSTANTS.HIT_FLASH_DURATION;
                  player.shieldRechargeTimer = SHIELD_CONSTANTS.RECHARGE_DELAY;
              }
              if (envDmg > 0) {
                  player.health -= envDmg;
                  markDamaged(player, 0.1);
              }
          }
      }

      // Structure crashing — asteroid path.
      // Big accreted clusters plow straight through tile geometry rather
      // than bouncing, letting them clear traffic jams at cluster edges.
      // The threshold is momentum (mass × impactSpeed) so a heavy rock
      // at drift speed and a small shard at high speed can both crash,
      // while cruising shards stay harmlessly bouncing.
      //
      // This path deliberately does NOT call onDeath — unlike the player
      // crash above, asteroids destroy tiles permanently (no shard debris,
      // no regeneration queue, no flow-field BFS patch).  Omitting
      // onDeath avoids:
      //   - spawning 4–11 glass-shard asteroids per crashed tile
      //     (runaway entity count when a cluster plows a row of tiles),
      //   - `flowField.onTileDestroyed` and its patch BFS, which on a
      //     toroidal map propagates through every unblocked cell of the
      //     pursuit field within range and dominates the frame.
      // Enemies continue treating the destroyed cell as blocked until
      // the next natural full field rebuild (when the player changes
      // grid cells); that's a ~1 s staleness in the worst case, which
      // is cheaper than patching on every crash.
      // Mobile shards (rock-shard / glass-shard) live on
      // EntityType.STRUCTURE with finite mass; static tiles share
      // the EntityType but are mass=Infinity.  The crash interaction
      // is "mobile-shard vs static-tile" — distinguish by mass.
      const aIsMobileShard = a.type === EntityType.STRUCTURE && a.mass !== Infinity;
      const bIsMobileShard = b.type === EntityType.STRUCTURE && b.mass !== Infinity;
      const aIsStaticTile  = a.type === EntityType.STRUCTURE && a.mass === Infinity;
      const bIsStaticTile  = b.type === EntityType.STRUCTURE && b.mass === Infinity;
      if ((aIsMobileShard && bIsStaticTile) || (bIsMobileShard && aIsStaticTile)) {
          const asteroid = aIsMobileShard ? a : b;
          const structure = aIsStaticTile ? a : b;
          const impactSpeed = Math.abs(velAlongNormal);
          const momentum = asteroid.mass * impactSpeed;
          const isIndestructible = structure.shardVariant === 'indestructible-tile';

          if (momentum > STRUCTURE_CONSTANTS.SHARD_CRASH_MOMENTUM) {
              // Rough momentum transfer to the tile fragments.
              asteroid.velocity.x *= 0.85;
              asteroid.velocity.y *= 0.85;
              structure.hitFlash = 0.1;
              if (isIndestructible) {
                  // Asteroid bounces off a permanent wall — no damage.
                  if (onDamage) onDamage(structure.position, COLLISION_CONFIG.DAMAGE.STRUCTURE_IMPACT, structure, asteroid.position);
                  // Fall through to elastic bounce below.
              } else {
                  structure.health -= 1;
                  PhysicsSystem.applyDentStep(structure, asteroid.position);
                  if (onDamage) onDamage(structure.position, COLLISION_CONFIG.DAMAGE.STRUCTURE_IMPACT, structure, asteroid.position);
                  if (structure.health <= 0) {
                      // How HARD it was hit decides how finely it breaks: a
                      // bare-threshold nudge leaves a few big chunks, a slam
                      // several times over the threshold powders it.  Mapped
                      // onto the 1..5 the shatter tables already speak.
                      const over = momentum / STRUCTURE_CONSTANTS.SHARD_CRASH_MOMENTUM - 1;
                      const impactDamage = 1 + 4 * Math.max(0, Math.min(1, over / 3));
                      this.killStructureByImpact(structure, asteroid, impactDamage, false, onDeath);
                  }
                  return;
              }
          }

          // Below the single-hit crash threshold: accumulate a pressure
          // hit if the asteroid is "large enough".  A short cooldown
          // debounces multi-substep re-hits from one bounce event so a
          // single glancing collision counts as one pressure event
          // rather than two or three.  Once the accumulator reaches
          // TILE_PRESSURE_HITS within the TILE_PRESSURE_WINDOW,
          // the tile takes a damage tier the same way a single above-
          // threshold crash would (glass dies in one; tiered tiles step
          // down one tier per trigger).  Indestructible tiles accumulate
          // nothing — they're inert under pressure.
          if (!isIndestructible
              && asteroid.mass >= STRUCTURE_CONSTANTS.TILE_PRESSURE_MIN_MASS
              && !(structure.tilePressureCooldown ?? 0)) {
              structure.tilePressureCount = (structure.tilePressureCount ?? 0) + 1;
              structure.tilePressureTimer = STRUCTURE_CONSTANTS.TILE_PRESSURE_WINDOW;
              structure.tilePressureCooldown = STRUCTURE_CONSTANTS.TILE_PRESSURE_COOLDOWN;
              if (structure.tilePressureCount >= STRUCTURE_CONSTANTS.TILE_PRESSURE_HITS) {
                  structure.tilePressureCount = 0;
                  structure.health -= 1;
                  asteroid.velocity.x *= 0.85;
                  asteroid.velocity.y *= 0.85;
                  if (onDamage) onDamage(structure.position, COLLISION_CONFIG.DAMAGE.STRUCTURE_IMPACT, structure, asteroid.position);
                  if (structure.health <= 0) {
                      // Pressure is the SLOW kill — a tile ground down by
                      // repeated sub-threshold nudges rather than smashed —
                      // so it takes the gentlest break the tables offer: a
                      // few large chunks, drifting rather than sprayed.
                      this.killStructureByImpact(structure, asteroid, 1, false, onDeath);
                  }
                  return;
              }
          }
          // Still below pressure threshold: fall through to elastic bounce.
      }

      // Mobile-shard vs Player — speed-gated environmental damage
      // (bypasses shield).  Stage 5: mobile shards now live on
      // STRUCTURE+finite mass; the legacy ROCK_SHARD type is still
      // accepted for any not-yet-migrated spawn site.
      const aIsPlayerLike = a.type === EntityType.PLAYER;
      const bIsPlayerLike = b.type === EntityType.PLAYER;
      if ((aIsPlayerLike && bIsMobileShard) || (bIsPlayerLike && aIsMobileShard)) {
          const player = aIsPlayerLike ? a : b;
          const impactSpeed = Math.abs(velAlongNormal);
          if (impactSpeed > COLLISION_CONFIG.ENV_DAMAGE.SPEED_THRESHOLD) {
              const envDmg = impactSpeed * COLLISION_CONFIG.ENV_DAMAGE.MULTIPLIER;
              player.health -= envDmg;
              markDamaged(player, 0.1);
          }
      }
      
      // Mass-bias-compressed impulse split (velocity step only — the
      // positional correction above keeps the true mass split).  See
      // COLLISION_CONFIG.MASS_BIAS_EXPONENT.  invMass = 0 for static
      // entities survives the pow unchanged (0^k = 0), so infinite-
      // mass behaviour is identical.
      const effInvMassA = Math.pow(invMassA, COLLISION_CONFIG.MASS_BIAS_EXPONENT);
      const effInvMassB = Math.pow(invMassB, COLLISION_CONFIG.MASS_BIAS_EXPONENT);
      const j = -(1 + ELASTICITY) * velAlongNormal;
      const impulse = j / (effInvMassA + effInvMassB);

      const ix = nx * impulse;
      const iy = ny * impulse;

      if (a.mass !== Infinity) {
          a.velocity.x -= ix * effInvMassA;
          a.velocity.y -= iy * effInvMassA;
      }
      if (b.mass !== Infinity) {
          b.velocity.x += ix * effInvMassB;
          b.velocity.y += iy * effInvMassB;
      }
  }

  // --- OPTIMIZED SAT HELPERS ---
  private fillVertices(e: GameEntity, buffer: Vector2[]): number {
      let count = 0;
      // Shield expands the player's collision shape
      const shieldScale = (e.id === 'player' && (e.shield ?? 0) > 0)
          ? SHIELD_CONSTANTS.COLLISION_MULTIPLIER : 1;

      if (e.polygonPoints && e.polygonPoints.length > 0) {
          // Static entities (mass === Infinity) never rotate after spawn, so
          // their cos/sin are cached on first use and re-used across every
          // future collision pair the entity participates in.  Dynamic
          // entities take the trig path normally — their rotation can change
          // each substep so caching would be unsafe.
          let cos: number, sin: number;
          if (e.mass === Infinity && e._satCacheCos !== undefined) {
              cos = e._satCacheCos;
              sin = e._satCacheSin!;
          } else {
              cos = Math.cos(e.rotation);
              sin = Math.sin(e.rotation);
              if (e.mass === Infinity) {
                  e._satCacheCos = cos;
                  e._satCacheSin = sin;
              }
          }

          // Warn once if an entity ever exceeds the vertex cap — the break
          // below still protects against buffer overrun, but a truncated
          // polygon produces silently wrong collisions, so we want to know.
          if (e.polygonPoints.length > buffer.length && !this.warnedVertexOverflow) {
              this.warnedVertexOverflow = true;
              console.warn(
                  `[PhysicsSystem] SAT vertex buffer overflow: entity type=${e.type} ` +
                  `has ${e.polygonPoints.length} points but buffer holds ${buffer.length}. ` +
                  `Collision shape will be silently truncated. Raise MAX_SAT_VERTICES.`
              );
          }

          for (let i = 0; i < e.polygonPoints.length; i++) {
              if (count >= buffer.length) break;
              const p = e.polygonPoints[i];
              const px = p.x * shieldScale;
              const py = p.y * shieldScale;
              buffer[count].x = e.position.x + (px * cos - py * sin);
              buffer[count].y = e.position.y + (px * sin + py * cos);
              count++;
          }
      } else {
          const w = (e.size.x / 2) * shieldScale;
          const h = (e.size.y / 2) * shieldScale;
          buffer[0].x = e.position.x - w; buffer[0].y = e.position.y - h;
          buffer[1].x = e.position.x + w; buffer[1].y = e.position.y - h;
          buffer[2].x = e.position.x + w; buffer[2].y = e.position.y + h;
          buffer[3].x = e.position.x - w; buffer[3].y = e.position.y + h;
          count = 4;
      }
      return count;
  }

  private fillAxes(
      vertsA: Vector2[], countA: number,
      vertsB: Vector2[], countB: number,
      bufferAxes: Vector2[],
      eA?: GameEntity, eB?: GameEntity,
  ): number {
      let axisIdx = 0;
      axisIdx = this.fillEntityAxes(vertsA, countA, bufferAxes, axisIdx, eA);
      axisIdx = this.fillEntityAxes(vertsB, countB, bufferAxes, axisIdx, eB);
      return axisIdx;
  }

  /**
   * Append normalised edge normals for ONE entity to bufferAxes.  Static
   * entities (mass === Infinity) get a permanent cached axis list stamped
   * onto the entity on first use — their polygon shape and rotation are
   * frozen at spawn, so the world-space axes never change.  Subsequent
   * collisions involving the same static entity skip the sqrt+inverse-
   * multiply per edge entirely and only pay a memcpy.
   *
   * Dynamic entities (and callers that don't pass an entity ref) take the
   * compute path, identical to the original fillAxes loop.
   */
  private fillEntityAxes(
      verts: Vector2[], count: number,
      bufferAxes: Vector2[], startIdx: number,
      e: GameEntity | undefined,
  ): number {
      // Fast path: cached world-space axes for static entities.
      if (e && e.mass === Infinity && e._satCacheAxes !== undefined) {
          const cache = e._satCacheAxes;
          let idx = startIdx;
          for (let i = 0; i < cache.length && idx < bufferAxes.length; i++) {
              bufferAxes[idx].x = cache[i].x;
              bufferAxes[idx].y = cache[i].y;
              idx++;
          }
          return idx;
      }
      const wantCache = e !== undefined && e.mass === Infinity;
      const newCache: Vector2[] | null = wantCache ? [] : null;
      let idx = startIdx;
      for (let i = 0; i < count; i++) {
          if (idx >= bufferAxes.length) break;
          const p1 = verts[i];
          const p2 = verts[(i + 1) % count];
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const lenSq = dx*dx + dy*dy;
          if (lenSq > 0.000001) {
              const inv = 1 / Math.sqrt(lenSq);
              const ax = -dy * inv;
              const ay = dx * inv;
              bufferAxes[idx].x = ax;
              bufferAxes[idx].y = ay;
              idx++;
              if (newCache) newCache.push({ x: ax, y: ay });
          }
      }
      if (wantCache && e) {
          e._satCacheAxes = newCache!;
      }
      return idx;
  }
}
