

import { GameEntity, Vector2, MapType, EntityType } from '../../types';
import { PHYSICS_CONSTANTS, SPATIAL_GRID_SIZE, PLAYER_MOVEMENT_CONFIG, STRUCTURE_CONSTANTS, LOCAL_GRAVITY_CONSTANTS, COLLISION_CONFIG, SHIELD_CONSTANTS, NEBULA_CONSTANTS, nebulaFadeRateScale, SHARD_VARIANTS, SHARD_PAIR_CONSTANTS, SHARD_TILE_PAIR_CONSTANTS, SHARD_SLEEP_CONSTANTS, WIGGLE_CONSTANTS, PLASTIC_DEFORM_CONSTANTS, getActivePlasticStiffness, getActivePlasticYield, getActivePlasticDamping, getActivePlasticImpactCooldown } from '../../constants';

/** Set wiggle + dent state on a plastic-shard whose post-impulse
 *  speed has crossed restSpeed — wakes the shard out of its sleep
 *  state, so it both jiggles (visual short pulse) and accumulates
 *  a persistent dent in the impact direction (visual long-tail
 *  squash that decays over ~4 s).  `dirX` / `dirY` is the impact
 *  direction; stored as wiggleAngle for the wiggle's axis and
 *  normalised + accumulated into entity.dentX/Y for the dent.
 *  No-op for non-plastic entities and for impulses too small to
 *  matter.  Inlined comparison (squared speed vs squared rest) so
 *  the hot path skips a sqrt. */
function maybeStampPlasticWiggle(e: GameEntity, dirX: number, dirY: number, isCollision: boolean): void {
    if (e.shardVariant !== 'plastic-shard') return;
    const cooldownVal = getActivePlasticImpactCooldown();
    // 'off' (Infinity): collision contacts never re-orient the
    // deformation axis — kills the cluster-jitter entirely.
    // Projectile hits (isCollision=false) still wiggle.
    if (isCollision && cooldownVal === Infinity) return;
    // Debounce: a shard packed among neighbours fields several
    // contacts per substep; without this gate each one re-orients
    // the deformation axis, making the disc twitch back and forth.
    if ((e.wiggleCooldown ?? 0) > 0) return;
    const rest = e.restSpeed ?? NEBULA_CONSTANTS.REST_SPEED;
    const restSq = rest * rest;
    const vSq = e.velocity.x * e.velocity.x + e.velocity.y * e.velocity.y;
    if (vSq <= restSq) return;

    e.wiggleCooldown = cooldownVal === Infinity ? WIGGLE_CONSTANTS.DURATION : cooldownVal;
    e.wiggleTimer = WIGGLE_CONSTANTS.DURATION;
    e.wiggleAngle = Math.atan2(dirY, dirX);

    // Accumulate impact direction (normalised) into the dent
    // vector; cap total magnitude so repeated hits in the same
    // direction don't grow the dent indefinitely.
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
    if (dirLen <= 0.0001) return;
    const nx = dirX / dirLen;
    const ny = dirY / dirLen;
    const inc = PLASTIC_DEFORM_CONSTANTS.DENT_INCREMENT_PER_IMPACT;
    let newDX = (e.dentX ?? 0) + nx * inc;
    let newDY = (e.dentY ?? 0) + ny * inc;
    const max = PLASTIC_DEFORM_CONSTANTS.DENT_MAX_MAGNITUDE;
    const m = Math.sqrt(newDX * newDX + newDY * newDY);
    if (m > max) {
        const k = max / m;
        newDX *= k;
        newDY *= k;
    }
    e.dentX = newDX;
    e.dentY = newDY;
}
import { MAP_WIDTH, MAP_HEIGHT, HALF_MAP_WIDTH, HALF_MAP_HEIGHT, wrapPosition, wrapDeltaX, wrapDeltaY, wrapX, wrapY, onMapDimensionsChanged, isVisibleOnTorus } from '../toroidal';
import { getCollisionR } from '../entityCache';
import type { PerfController } from './PerfController';

// Number of spatial-hash cells along each axis of the toroidal map.  The
// broadphase keys pack (col, row) into a single int using `(cx << 16) |
// (cy & 0xFFFF)`, and cell indices are wrapped into [0, SPATIAL_COLS) so
// neighbour queries near a seam land on the same bucket as the entities
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
function cellKey(x: number, y: number): number {
    const cx = wrapCellX(Math.floor(x / SPATIAL_GRID_SIZE));
    const cy = wrapCellY(Math.floor(y / SPATIAL_GRID_SIZE));
    return (cx << 16) | (cy & 0xFFFF);
}
function cellKeyFromCell(cx: number, cy: number): number {
    return (wrapCellX(cx) << 16) | (wrapCellY(cy) & 0xFFFF);
}

// Precompute the squared "still-settled" distance multiplier:
// pair is considered stable when distSq > sumRSq × STABLE_DIST_FACTOR_SQ.
// Derived from `dist > sumR × (1 − STABLE_OVERLAP_FRACTION)`, i.e. the
// overlap is below the configured fraction of contact distance.
const STABLE_DIST_FACTOR_SQ = (1 - SHARD_PAIR_CONSTANTS.STABLE_OVERLAP_FRACTION) ** 2;

export class PhysicsSystem {
  // Dual-grid system:
  // staticGrid stores immovable geometry (Tiles) and is calculated ONLY on map load.
  // dynamicGrid stores moving entities (Player, Enemies, Projectiles) and is cleared every frame.
  private staticGrid: Map<number, GameEntity[]> = new Map();
  private dynamicGrid: Map<number, GameEntity[]> = new Map();
  // Separate spatial hash for shard ↔ shard pair resolution.
  // Walked only on Nth physics steps per the ShPair pacing —
  // skipping the rebuild + walk entirely on off-frames is the
  // savings the DBG slider was missing when shard-shard pairs
  // were inline in the main collision pass.
  private shardGrid: Map<number, GameEntity[]> = new Map();

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
    onShake?: (amount: number) => void,
    onHit?: (impactPos: Vector2, proj: GameEntity, target: GameEntity) => void
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
      this.applyGravity(entities, timeScale, onDamage);
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
          // ASTEROID_PRESSURE_WINDOW, not from hits spread over a minute.
          if (entity.asteroidHitCooldown !== undefined && entity.asteroidHitCooldown > 0) {
              entity.asteroidHitCooldown -= dt;
              if (entity.asteroidHitCooldown <= 0) entity.asteroidHitCooldown = undefined;
          }
          if (entity.asteroidHitTimer !== undefined && entity.asteroidHitTimer > 0) {
              entity.asteroidHitTimer -= dt;
              if (entity.asteroidHitTimer <= 0) {
                  entity.asteroidHitTimer = undefined;
                  entity.asteroidHitCount = undefined;
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

      // Visuals: Tick down flash timer
      if (entity.hitFlash && entity.hitFlash > 0) {
          entity.hitFlash -= dt;
      }
      // Nebula shatter cooldown — strikers (PLAYER/ENEMY) that just broke
      // a nebula can't break another until this expires.
      if (entity.nebulaImpactCooldown !== undefined && entity.nebulaImpactCooldown > 0) {
          entity.nebulaImpactCooldown -= dt;
      }
      // Plastic-shard wiggle timer — counts down to 0; the renderer
      // applies a damped-sinusoid scale pulse while > 0.  Set at
      // collision sites when the impulse wakes the shard above its
      // restSpeed.  Skipped (and cleared) when at 0 so the renderer's
      // gate check sees undefined rather than a stale near-zero.
      if (entity.wiggleTimer !== undefined && entity.wiggleTimer > 0) {
          entity.wiggleTimer -= dt;
          if (entity.wiggleTimer <= 0) entity.wiggleTimer = undefined;
      }
      // Impact-stamp cooldown — gates how often maybeStampPlasticWiggle
      // can re-orient the deformation axis (anti-twitch debounce).
      if (entity.wiggleCooldown !== undefined && entity.wiggleCooldown > 0) {
          entity.wiggleCooldown -= dt;
          if (entity.wiggleCooldown <= 0) entity.wiggleCooldown = undefined;
      }
      // Plastic-shard impact-dent decay — 2D vector that decays
      // exponentially toward zero each substep.  Half-life ~1 s
      // at PLASTIC_DEFORM_CONSTANTS.DENT_DECAY_PER_SECOND = 0.5
      // (a max-magnitude dent visibly persists ~4 s).  Both axes
      // snap to undefined together once both fall below the rest
      // threshold so the renderer's check stays cheap.
      if (entity.dentX !== undefined || entity.dentY !== undefined) {
          const decayMul = Math.pow(PLASTIC_DEFORM_CONSTANTS.DENT_DECAY_PER_SECOND, dt);
          const newDX = (entity.dentX ?? 0) * decayMul;
          const newDY = (entity.dentY ?? 0) * decayMul;
          const rest = PLASTIC_DEFORM_CONSTANTS.DENT_REST_THRESHOLD;
          if (Math.abs(newDX) < rest && Math.abs(newDY) < rest) {
              entity.dentX = undefined;
              entity.dentY = undefined;
          } else {
              entity.dentX = newDX;
              entity.dentY = newDY;
          }
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
      // Metal hexagon free-float — a completed composite floats while this
      // counts down, then ShardSystem snaps it to the grid as a tile.  Held
      // at 0 (not cleared) so ShardSystem can tell "ready" from "still
      // floating"; only the assembly pass clears it.
      if (entity.metalFloatTimer !== undefined && entity.metalFloatTimer > 0) {
          entity.metalFloatTimer -= dt;
          if (entity.metalFloatTimer < 0) entity.metalFloatTimer = 0;
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
          && (entity.shieldRechargeTimer ?? 0) <= 0) {
          entity.shield = Math.min(entity.maxShield, entity.shield + SHIELD_CONSTANTS.RECHARGE_RATE * dt);
      }

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
            // field at spawn time).  Per-entity restSpeed / restSpin
            // (when set) raise the snap-to-zero floor — plastic-
            // shards use this for sleep-like behaviour so tiny
            // residual drifts get culled and clusters stay
            // motionless unless directly disturbed.  Falls back to
            // NEBULA_CONSTANTS values for entities that don't set
            // them (nebula-shards, free-floating rock-shards).
            // Plastic-shards read the live DBG damping cycle so the
            // PDmp button retunes friction on every active shard, not
            // just newly-spawned ones.  Other variants keep their
            // spawn-time per-entity value.
            const linearD = entity.shardVariant === 'plastic-shard'
                ? getActivePlasticDamping()
                : entity.linearDamping;
            const angularD = entity.angularDamping ?? NEBULA_CONSTANTS.ANGULAR_DAMPING;
            const restSpeed = entity.restSpeed ?? NEBULA_CONSTANTS.REST_SPEED;
            const restSpin  = entity.restSpin  ?? NEBULA_CONSTANTS.REST_SPIN;
            const lin = Math.pow(linearD, timeScale);
            const ang = Math.pow(angularD, timeScale);
            entity.velocity.x *= lin;
            entity.velocity.y *= lin;
            if (Math.abs(entity.velocity.x) < restSpeed) entity.velocity.x = 0;
            if (Math.abs(entity.velocity.y) < restSpeed) entity.velocity.y = 0;
            // Elastoplastic sticky-bond anchor (today: plastic-shard).
            // Applied AFTER the damping + rest snap so the spring can
            // re-introduce velocity above restSpeed and keep pulling
            // the shard toward its anchor.  Toroidal-correct delta so
            // anchors near a wrap seam pull the shorter way.
            //
            // The anchor is an elastic-perfectly-plastic element:
            // while |displacement| <= yieldDist the spring pulls back
            // fully (elastic recovery); once displacement exceeds
            // yieldDist the anchor permanently MIGRATES toward the
            // shard so the clamped displacement stays at yieldDist —
            // the over-yield motion is "forgotten", leaving the shard
            // deformed.  That permanent migration is the lossy/plastic
            // behaviour the elastic spring alone could not produce.
            if (entity.anchorX !== undefined && entity.anchorY !== undefined) {
                let adx = wrapDeltaX(entity.anchorX, entity.position.x);
                let ady = wrapDeltaY(entity.anchorY, entity.position.y);
                const yieldDist = getActivePlasticYield();
                const distSq = adx * adx + ady * ady;
                if (distSq > yieldDist * yieldDist) {
                    // Plastic flow: migrate the anchor toward the
                    // shard along the displacement direction by the
                    // over-yield excess, then clamp the displacement
                    // used for the restoring force to yieldDist.
                    const dist = Math.sqrt(distSq);
                    const excess = dist - yieldDist;
                    const ux = adx / dist;
                    const uy = ady / dist;
                    entity.anchorX = wrapX(entity.anchorX + ux * excess);
                    entity.anchorY = wrapY(entity.anchorY + uy * excess);
                    adx = ux * yieldDist;
                    ady = uy * yieldDist;
                }
                const k = getActivePlasticStiffness();
                entity.velocity.x -= adx * k * dt;
                entity.velocity.y -= ady * k * dt;
            }
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
      // shard) flow through resolveAsteroidPair, which calls the
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
   * Player → nebula-shard gravity pull.  Nebula shards keep their
   * passThrough flag so the player ship glides through them without
   * an SAT impulse; this pass replaces the bounce with a soft pull
   * (velocity nudge toward the player + a stable rotational kick) so
   * the cloud appears to swirl in the ship's wake instead of just
   * sliding past.  Shatter still triggers on direct contact via the
   * standard nebula pass-through path in resolveCollision.
   *
   * - Linear falloff: full strength at the centre, zero at the range
   *   edge, no pull past the edge.
   * - Spin sign is deterministic per shard (id last-char parity) so a
   *   given shard always swirls the same way; the field as a whole
   *   reads as varied vortices rather than a uniform pinwheel.
   * - rotationSpeed is capped at NEBULA_CONSTANTS.MAX_SPIN so a long-
   *   lingering shard doesn't spin up to absurd rates.
   */
  private applyNebulaPlayerPull(entities: GameEntity[], player: GameEntity, timeScale: number) {
      if (!player.active || player.isExploding) return;
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
          // Skip shards on a cooldown — same field that gates shard↔shard
          // merging.  Freshly-spawned shatter children carry the cooldown
          // from postShatterMergeCooldown, so they "rest" for a beat
          // before the pull picks them up again.
          if ((e.nebulaMergeCooldown ?? 0) > 0) continue;
          const dx = wrapDeltaX(e.position.x, px);
          const dy = wrapDeltaY(e.position.y, py);
          const distSq = dx * dx + dy * dy;
          if (distSq > rangeSq || distSq < 1) continue;
          const dist = Math.sqrt(distSq);
          const fall = 1 - dist / range; // 1 at centre → 0 at edge
          const invDist = 1 / dist;
          const deltaV = strength * fall * timeScale;
          e.velocity.x += dx * invDist * deltaV;
          e.velocity.y += dy * invDist * deltaV;
          // Stable per-shard spin direction.
          const lastChar = e.id ? e.id.charCodeAt(e.id.length - 1) : 0;
          const spinSign = (lastChar & 1) ? 1 : -1;
          const nextSpin = (e.rotationSpeed ?? 0) + spinSign * spinKick * fall * timeScale;
          e.rotationSpeed = Math.max(-maxSpin, Math.min(maxSpin, nextSpin));
          // Stamp the same cooldown a freshly-spawned shard carries
          // (postShatterMergeCooldown = MERGE_COOLDOWN) so the pull
          // fires once per cycle rather than every step the player is
          // in range — turns continuous proximity into a pulse so the
          // shard doesn't accumulate velocity / spin without bound.
          // The same field gates shard↔shard merging while it's hot,
          // which keeps the rest-beat consistent across interactions.
          e.nebulaMergeCooldown = NEBULA_CONSTANTS.MERGE_COOLDOWN;
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

  private applyGravity(entities: GameEntity[], timeScale: number, onDamage?: (pos: Vector2, amount: number, target?: GameEntity, impactWorldPos?: Vector2) => void) {
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

        for (let j = 0; j < attractors.length; j++) {
            const attractor = attractors[j];
            if (!attractor.active) continue;
            if (entity === attractor) continue;

            const dx = wrapDeltaX(entity.position.x, attractor.position.x);
            const dy = wrapDeltaY(entity.position.y, attractor.position.y);
            const distSq = dx*dx + dy*dy;
            const rangeSq = attractor.gravityRange! ** 2;

            // Mobile shard-family entities get the close-attractor crush
            // (mobile shards = STRUCTURE with finite mass).
            const isMobileShard = entity.type === EntityType.STRUCTURE && entity.mass !== Infinity;
            if (distSq < (attractor.size.x / 2)**2 && isMobileShard) {
                entity.active = false;
                if (onDamage) onDamage(entity.position, COLLISION_CONFIG.DAMAGE.ASTEROID_CRUSH, entity);
                continue; 
            }

            if (distSq < rangeSq) {
                const force = (attractor.gravityStrength || 1000) / Math.max(distSq, 10000);
                const maxAccel = entity.type === EntityType.PLAYER ? 0.2 : 5.0;

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
    onShake?: (amount: number) => void,
    onHit?: (impactPos: Vector2, proj: GameEntity, target: GameEntity) => void
  ) {
    // 1. Clear ONLY Dynamic Grid (Static Grid is persistent)
    this.dynamicGrid.clear();

    // 2. Populate Dynamic Grid with moving entities.  While we're walking
    // each cell push, track the peak cell population — the 3×3 neighbourhood
    // SAT pass below is O(k²) per cell, so peak density is the direct signal
    // for dense-cluster stalls in the dev perf overlay.
    //
    // Particles are excluded from the grid entirely: resolveCollision
    // discards every pair involving a particle (they're purely visual),
    // so inserting them wastes grid memory and forces O(particles) extra
    // inner-loop iterations on every neighbour scan for no effect.
    let maxDensity = 0;
    // Awake-only count drives the PerfController throttle: an asleep shard
    // skips pair-resolution math (resolveShardPairs bails on asleep↔asleep),
    // so a field of settled bodies costs almost nothing and must NOT pin the
    // load — same principle as the ammo-drop exclusion below.  Without this,
    // never-sleeping metal composites accumulate on mixed maps and throttle
    // shared passes (shardPair/colorBlend/…), starving nebula collisions.
    let awakeCount = 0;
    const dynamicEntities: GameEntity[] = [];
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

        // Collectible ammo drops are non-physics bodies: magnet-pulled +
        // proximity-collected only (see GameEngine drop scan).  Keeping
        // them out of the dynamic grid removes their collision cost AND
        // their contribution to lastMaxCellDensity / lastDynamicCount, so
        // a lingering drop pile no longer pins the PerfController load.
        if (e.type === EntityType.INTERACTABLE && e.dropType === 'ammo') continue;

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
        dynamicEntities.push(e);
        if (!e.asleep) awakeCount++;

        const key = cellKey(e.position.x, e.position.y);

        let cell = this.dynamicGrid.get(key);
        if (!cell) {
            cell = [];
            this.dynamicGrid.set(key, cell);
        }
        cell.push(e);
        if (cell.length > maxDensity) maxDensity = cell.length;
    }
    this.lastMaxCellDensity = maxDensity;
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
                            a.velocity.x += dx * inv * accel;
                            a.velocity.y += dy * inv * accel;
                            // Scanner reads its own accumulator for fade fx.
                            a.repelImpulse = (a.repelImpulse ?? 0) + accel;
                            // The tile's glow tracks ONLY the player / enemies,
                            // not the many mobile shards drifting through its
                            // field — otherwise ambient shard contact keeps the
                            // glow lit constantly.  Lighting up to the player's
                            // repel field is the primary intent.
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
  public static applyDentStep(tile: GameEntity, impactWorldPos: Vector2) {
      if (tile.shardVariant === undefined) return;
      const dent = SHARD_VARIANTS[tile.shardVariant].dent;
      if (dent === undefined) return;
      // Triangle-delete variants do their polygon mutation + shard
      // spawn in GameEngine.spawnDamageText (it needs entities-array
      // access for the spawn).  Skip the in-place vertex pull here so
      // the two paths don't fight over the same polygon.
      if (dent.kind !== undefined && dent.kind !== 'pull') return;

      const pts = tile.polygonPoints;
      if (!pts || pts.length === 0) return;

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

      // polygonPoints mutated → invalidate any cached SAT axes (the
      // edge normals derived from those points are now stale) AND the
      // static-tile world-canvas stamp (which baked the old polygon
      // outline).  Both caches re-populate lazily on next use.
      tile._satCacheAxes = undefined;
      if (tile._staticCached === true) tile._staticCached = false;

      // Damage indicator for rock-tile: append a short crack line in
      // entity-local space.  Drawn over the cache stamp's fill on the
      // next pre-blit re-stamp (the cache-invalidate just above forces
      // a re-stamp this frame), so accumulating dents read as visible
      // cracks even though rock-tile renders no edge outline.  Bounded
      // so a swarm of stray hits doesn't pile up indefinitely; the
      // tile dies long before this cap matters in normal play.
      if (tile.shardVariant === 'rock-tile') {
          if (!tile.damageCracks) tile.damageCracks = [];
          if (tile.damageCracks.length < 8) {
              const R = Math.max(tile.size.x, tile.size.y) * 0.5;
              const angle = Math.random() * Math.PI * 2;
              const startR = R * (Math.random() * 0.25);
              const lenR = R * (0.45 + Math.random() * 0.35);
              const ca = Math.cos(angle);
              const sa = Math.sin(angle);
              tile.damageCracks.push({
                  x1: ca * startR,
                  y1: sa * startR,
                  x2: ca * (startR + lenR),
                  y2: sa * (startR + lenR),
              });
          }
      }
  }

  // Returns true if world-space point (x, y) with radius r is clear of all
  // static tiles — used for safe spawn-point validation.
  public isPositionClear(x: number, y: number, r: number): boolean {
      const cx = Math.floor(x / SPATIAL_GRID_SIZE);
      const cy = Math.floor(y / SPATIAL_GRID_SIZE);
      const rSq = r * r;

      for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
              const key = cellKeyFromCell(cx + dx, cy + dy);
              const cell = this.staticGrid.get(key);
              if (!cell) continue;
              for (let i = 0; i < cell.length; i++) {
                  const t = cell[i];
                  if (!t.active) continue;
                  // Toroidal distance — a candidate tile near the seam can
                  // still be within `r` of the test point on the short way.
                  const tdx = wrapDeltaX(t.position.x, x);
                  const tdy = wrapDeltaY(t.position.y, y);
                  if (tdx * tdx + tdy * tdy < rSq) return false;
              }
          }
      }
      return true;
  }

  // Returns true if an active static tile's centre lies within `radius` of
  // world-space point (x, y), ignoring the tile whose id matches `ignoreId`
  // (so a tile can probe for its own neighbours without finding itself).
  // Used by RenderSystem to suppress outline strokes on edges that are
  // cleanly butted against a neighbour tile.  Wraps the probe coordinates
  // so callers probing across the toroidal seam still find neighbours on
  // the opposite side.
  public hasStaticTileNear(x: number, y: number, radius: number, ignoreId?: string): boolean {
      const wx = wrapX(x);
      const wy = wrapY(y);
      const cx = Math.floor(wx / SPATIAL_GRID_SIZE);
      const cy = Math.floor(wy / SPATIAL_GRID_SIZE);
      const rSq = radius * radius;
      for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
              const cell = this.staticGrid.get(cellKeyFromCell(cx + dx, cy + dy));
              if (!cell) continue;
              for (let i = 0; i < cell.length; i++) {
                  const t = cell[i];
                  if (!t.active) continue;
                  if (ignoreId !== undefined && t.id === ignoreId) continue;
                  const tdx = wrapDeltaX(t.position.x, wx);
                  const tdy = wrapDeltaY(t.position.y, wy);
                  if (tdx * tdx + tdy * tdy < rSq) return true;
              }
          }
      }
      return false;
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
   * `resolveAsteroidPair`.
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

    this.shardGrid.clear();
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
        const key = cellKey(e.position.x, e.position.y);
        let cell = this.shardGrid.get(key);
        if (!cell) { cell = []; this.shardGrid.set(key, cell); }
        cell.push(e);
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
                    if (a.id > b.id) continue; // process each pair once
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
                    this.resolveAsteroidPair(a, b, onDeath);
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
      onShake?: (amount: number) => void,
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
   * from the impulse-resolution sites (resolveAsteroidPair fast-path
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
      onShake?: (amount: number) => void,
      onHit?: (impactPos: Vector2, proj: GameEntity, target: GameEntity) => void,
  ): void {
      for (let i = 0; i < shards.length; i++) {
          const a = shards[i];
          if (!a.active || a.isExploding) continue;
          if (a.mergeFadeTimer !== undefined) continue;

          const cx = Math.floor(a.position.x / SPATIAL_GRID_SIZE);
          const cy = Math.floor(a.position.y / SPATIAL_GRID_SIZE);

          // Snapshot the plastic-shard's pre-collision position so we
          // can detect after the inner loop whether SAT pushed it.
          // Sustained contact with a static tile means the shard's
          // sticky-bond anchor is pulling it INTO geometry — the
          // shard oscillates against the tile and damages it on every
          // bounce.  When that happens we snap the anchor to the
          // post-correction position so the spring stops fighting
          // the wall (see plastic anchor reset below).
          const isPlasticWithAnchor =
              a.shardVariant === 'plastic-shard' && a.anchorX !== undefined;
          const preX = isPlasticWithAnchor ? a.position.x : 0;
          const preY = isPlasticWithAnchor ? a.position.y : 0;

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

          // Plastic-shard anchor reset on real tile contact.  If the
          // collision pass moved the shard (positional correction
          // fired), the shard's anchor was effectively unreachable
          // — relocating the anchor to its current position breaks
          // the spring-into-tile vibration loop that would otherwise
          // chain-destroy neighbouring plastic-tiles.
          if (isPlasticWithAnchor && a.active) {
              const dxA = a.position.x - preX;
              const dyA = a.position.y - preY;
              if (dxA * dxA + dyA * dyA > 0.01) {
                  a.anchorX = a.position.x;
                  a.anchorY = a.position.y;
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
      onShake?: (amount: number) => void,
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

  private resolveAsteroidPair(
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
      const invMassA = 1 / a.mass;
      const invMassB = 1 / b.mass;
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
      const rvx = b.velocity.x - a.velocity.x;
      const rvy = b.velocity.y - a.velocity.y;
      const velAlongNormal = rvx * nx + rvy * ny;
      if (velAlongNormal > 0) return; // already moving apart

      const j = -(1 + ELASTICITY) * velAlongNormal;
      const impulse = j / totalInvMass;
      const ix = nx * impulse;
      const iy = ny * impulse;
      a.velocity.x -= ix * invMassA;
      a.velocity.y -= iy * invMassA;
      b.velocity.x += ix * invMassB;
      b.velocity.y += iy * invMassB;
      // Plastic-shard wiggle trigger — fires when the post-impulse
      // speed is above restSpeed (collision was strong enough to
      // wake the shard out of its sleep state).  Impact direction
      // = the contact normal (nx, ny); for entity b the inbound
      // direction is opposite, but atan2 produces a 180°-swapped
      // angle whose squash visual is identical (squash axis is
      // unsigned).  No-op for non-plastic pairs; sqrt-free.
      maybeStampPlasticWiggle(a,  nx,  ny, true);
      maybeStampPlasticWiggle(b, -nx, -ny, true);
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
    onShake?: (amount: number) => void,
    onHit?: (impactPos: Vector2, proj: GameEntity, target: GameEntity) => void
  ) {
      // Non-nebula shards (metal / rock / glass) never collide with nebula.
      if (this.nebulaPassThroughPair(a, b)) return;

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
      const wdx = wrapDeltaX(a.position.x, b.position.x);
      const wdy = wrapDeltaY(a.position.y, b.position.y);
      const distSq = wdx*wdx + wdy*wdy;

      if (distSq > (rA + rB + 10)**2) return;

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

      // 1. SAT Collision Detection (Alloc-Free).  A metal composite collides
      // by its actual assembled shape (per-cell SAT) rather than its convex-
      // hull polygon, so contacts/hits match the connected triangles.
      const composite = (a.metalCells !== undefined && a.metalCells.length > 0)
                     || (b.metalCells !== undefined && b.metalCells.length > 0);
      const hit = composite ? this.compositeSAT(a, b) : this.checkCollisionSAT(a, b);
      if (hit) {
          this.resolveCollision(a, b, this.bufferMtv, onDamage, onDeath, onShake, onHit);
      }

      if (shifted) {
          // Normalize any positions the resolver may have written in b's
          // shifted frame (bouncer reflection, SLOP correction, etc.).
          wrapPosition(a.position);
          wrapPosition(b.position);
      }
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
   *  in resolveAsteroidPair for composites). */
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
                      const j = -(1 + ELASTICITY) * van / totalInvMass;
                      a.velocity.x -= nx * j * invMassA; a.velocity.y -= ny * j * invMassA;
                      b.velocity.x += nx * j * invMassB; b.velocity.y += ny * j * invMassB;
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
    onShake?: (amount: number) => void,
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
      const nebPairCollides = nebShardPair || nebShardTilePair;
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
      // - Non-glass collectible drops: only physically collide with asteroids and
      //   structures.  Player collection is handled by the magnetic logic in GameEngine,
      //   not by physics contact, so we skip those pairs here to avoid accidental
      //   collection via direct collision.
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

          // Ignore friendly fire and projectile-projectile
          if (target.type === EntityType.PROJECTILE) return;
          if (target.type === EntityType.PLAYER && proj.ownerType === EntityType.PLAYER) return;
          if (target.type === EntityType.ENEMY && proj.ownerType === EntityType.ENEMY) return;

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
                  if (tX <= tY) {
                      const nx = vx > 0 ? -1 : 1;
                      contactX = target.position.x + nx * tileHX;
                      contactY = Math.max(
                          target.position.y - tileHY,
                          Math.min(target.position.y + tileHY, proj.position.y)
                      );
                      proj.velocity.x = -vx;
                      proj.position.x = target.position.x + nx * (tileHX + hxEff + 0.5);
                  } else {
                      const ny = vy > 0 ? -1 : 1;
                      contactY = target.position.y + ny * tileHY;
                      contactX = Math.max(
                          target.position.x - tileHX,
                          Math.min(target.position.x + tileHX, proj.position.x)
                      );
                      proj.velocity.y = -vy;
                      proj.position.y = target.position.y + ny * (tileHY + hyEff + 0.5);
                  }
                  proj.rotation = Math.atan2(proj.velocity.y, proj.velocity.x);

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

          // Shield absorbs damage for the player
          if (target.id === 'player' && (target.shield ?? 0) > 0) {
              const absorbed = Math.min(target.shield!, projDmg);
              target.shield! -= absorbed;
              projDmg -= absorbed;
              target.shieldHitFlash = SHIELD_CONSTANTS.HIT_FLASH_DURATION;
              target.shieldRechargeTimer = SHIELD_CONSTANTS.RECHARGE_DELAY;
          }
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
              if (!isIndestructibleTile) {
                  target.health -= isDentEntity ? 1 : projDmg;
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
                  // Plastic-shards get a 3× push factor — pairs with
                  // the wiggle visualisation to read as visibly
                  // bouncy when struck.  Other dent shards keep the
                  // baseline pushFactor.
                  if (isDentEntity && target.mass !== Infinity && proj.velocity) {
                      const bouncinessMul = target.shardVariant === 'plastic-shard' ? 3.0 : 1.0;
                      const pushFactor = (0.20 * bouncinessMul) / Math.max(1, target.mass / 10);
                      target.velocity.x += proj.velocity.x * pushFactor;
                      target.velocity.y += proj.velocity.y * pushFactor;
                      maybeStampPlasticWiggle(target, proj.velocity.x, proj.velocity.y, false);

                      // Plastic-shard tangent-rule spin from off-
                      // centre projectile hits.  Mirrors the
                      // nebula-shatter spin convention (ShardSystem
                      // .shatterNebulaStyle: `cross = fx*dy − fy*dx`,
                      // sign drives rotationSpeed direction) so
                      // plastic absorbs impacts with the same fluid-
                      // swirl handedness — shards on the upper /
                      // lower side of the impact axis rotate in
                      // opposite directions, like a fluid being
                      // parted.
                      //
                      // fx/fy = projectile forward (striker velocity).
                      // dx/dy = shard offset from striker position.
                      // |cross| is essentially |F|·|d|·sin(θ), i.e.
                      // the unsigned torque.  Magnitude here scales
                      // with how off-centre the hit is — dead-centre
                      // hits (cross ≈ 0) fall back to a random sign
                      // so the shard still nudges.
                      //
                      // angularDamping = 0.99 (variant config) is
                      // intentionally lighter than linearDamping
                      // (0.97) so the spin persists noticeably
                      // longer than the linear push — plastic
                      // shards visibly twirl after a hit.
                      if (target.shardVariant === 'plastic-shard' && target.rotationSpeed !== undefined) {
                          const fx = proj.velocity.x;
                          const fy = proj.velocity.y;
                          const dx = target.position.x - proj.position.x;
                          const dy = target.position.y - proj.position.y;
                          const cross = fx * dy - fy * dx;
                          const offsetLen = Math.sqrt(dx * dx + dy * dy);
                          const radius = target.size.x * 0.5;
                          const offsetFrac = Math.min(1, offsetLen / Math.max(1, radius));
                          const SPIN_PER_HIT = 3.0;
                          const sign = cross > 0.01 ? 1
                                     : cross < -0.01 ? -1
                                     : (Math.random() < 0.5 ? 1 : -1);
                          target.rotationSpeed += sign * SPIN_PER_HIT * Math.max(0.15, offsetFrac);
                      }
                  }
              }
              target.hitFlash = 0.1;
          }

          if (onShake && target.type !== EntityType.STRUCTURE) {
              const shakeAmount = target.type === EntityType.PLAYER
                  ? COLLISION_CONFIG.SHAKE.MEDIUM
                  : COLLISION_CONFIG.SHAKE.MICRO;
              onShake(shakeAmount);
          }

          if (onHit) onHit(proj.position, proj, target);
          if (onDamage) onDamage(target.position, proj.damage || 1, target, proj.position);

          if (target.health <= 0) {
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
              if (ramImpact < SHIELD_CONSTANTS.DAMAGE_THRESHOLD) {
                  // flash already handled by the general contact flash below
              } else {
                  let ramDmg = COLLISION_CONFIG.DAMAGE.PLAYER_RAM_ENEMY;
                  if ((target.shield ?? 0) > 0) {
                      const absorbed = Math.min(target.shield!, ramDmg);
                      target.shield! -= absorbed;
                      ramDmg -= absorbed;
                      target.shieldHitFlash = SHIELD_CONSTANTS.HIT_FLASH_DURATION;
                      target.shieldRechargeTimer = SHIELD_CONSTANTS.RECHARGE_DELAY;
                  }
                  if (onDamage) onDamage(target.position, COLLISION_CONFIG.DAMAGE.PLAYER_RAM_ENEMY, target);
                  if (ramDmg > 0) {
                      target.health -= ramDmg;
                      target.hitFlash = 0.2;
                  }
                  if (onShake) onShake(COLLISION_CONFIG.SHAKE.MEDIUM);
                  if (target.health <= 0 && onDeath) {
                      onDeath(target);
                  }
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

      // Detect High Impact for Shake
      const isPlayerCollision = (a.type === EntityType.PLAYER || b.type === EntityType.PLAYER);
      if (isPlayerCollision && onShake) {
          const impactSpeed = Math.abs(velAlongNormal);
          const other = a.type === EntityType.PLAYER ? b : a;
          const isHardTarget = other.type === EntityType.ENEMY || other.type === EntityType.STRUCTURE;
          
          if (impactSpeed > 2.0 && isHardTarget) {
              onShake(Math.min(impactSpeed, COLLISION_CONFIG.SHAKE.HEAVY) * COLLISION_CONFIG.SHAKE.CAP_MULTIPLIER);
          }
      }
      // Shield contact flash — any collision lights up the shield ring
      if (isPlayerCollision) {
          const player = a.type === EntityType.PLAYER ? a : b;
          if ((player.shield ?? 0) > 0) {
              player.shieldHitFlash = Math.max(player.shieldHitFlash ?? 0, SHIELD_CONSTANTS.CONTACT_FLASH_DURATION);
          }
      }

      // Structure crashing — player path.
      // Player punches through tiles on hard impact: the tile breaks apart
      // into glass shards (via onDeath → spawnDrops → spawnGlassShards)
      // and then regenerates on the normal 12 s timer (via onDeath → the
      // STRUCTURE branch of handleEntityDeath that queues pendingRegens).
      // The player loses half its velocity to the tile break.
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

          if (impactSpeed > STRUCTURE_CONSTANTS.CRASH_VELOCITY_THRESHOLD) {
              player.velocity.x *= 0.5;
              player.velocity.y *= 0.5;
              structure.hitFlash = 0.1;
              if (isIndestructible) {
                  // Permanent wall — signal the hit for SFX/shake but don't
                  // touch health or queue destruction.
                  if (onDamage) onDamage(structure.position, COLLISION_CONFIG.DAMAGE.STRUCTURE_IMPACT, structure, player.position);
                  return;
              }
              structure.health -= 1;
              PhysicsSystem.applyDentStep(structure, player.position);
              if (onDamage) onDamage(structure.position, COLLISION_CONFIG.DAMAGE.STRUCTURE_IMPACT, structure, player.position);
              if (structure.health <= 0) {
                  structure.health = 0;
                  structure.active = false;
                  if (structure.mass === Infinity) {
                      this.removeStaticEntity(structure);
                  }
                  if (onDeath) onDeath(structure);
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
                  envDmg -= absorbed;
                  player.shieldHitFlash = SHIELD_CONSTANTS.HIT_FLASH_DURATION;
                  player.shieldRechargeTimer = SHIELD_CONSTANTS.RECHARGE_DELAY;
              }
              if (envDmg > 0) {
                  player.health -= envDmg;
                  player.hitFlash = 0.1;
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

          if (momentum > STRUCTURE_CONSTANTS.ASTEROID_CRASH_MOMENTUM) {
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
                      structure.health = 0;
                      structure.active = false;
                      if (structure.mass === Infinity) {
                          this.removeStaticEntity(structure);
                      }
                  }
                  return;
              }
          }

          // Below the single-hit crash threshold: accumulate a pressure
          // hit if the asteroid is "large enough".  A short cooldown
          // debounces multi-substep re-hits from one bounce event so a
          // single glancing collision counts as one pressure event
          // rather than two or three.  Once the accumulator reaches
          // ASTEROID_PRESSURE_HITS within the ASTEROID_PRESSURE_WINDOW,
          // the tile takes a damage tier the same way a single above-
          // threshold crash would (glass dies in one; tiered tiles step
          // down one tier per trigger).  Indestructible tiles accumulate
          // nothing — they're inert under pressure.
          if (!isIndestructible
              && asteroid.mass >= STRUCTURE_CONSTANTS.ASTEROID_PRESSURE_MIN_MASS
              && !(structure.asteroidHitCooldown ?? 0)) {
              structure.asteroidHitCount = (structure.asteroidHitCount ?? 0) + 1;
              structure.asteroidHitTimer = STRUCTURE_CONSTANTS.ASTEROID_PRESSURE_WINDOW;
              structure.asteroidHitCooldown = STRUCTURE_CONSTANTS.ASTEROID_PRESSURE_COOLDOWN;
              if (structure.asteroidHitCount >= STRUCTURE_CONSTANTS.ASTEROID_PRESSURE_HITS) {
                  structure.asteroidHitCount = 0;
                  structure.health -= 1;
                  asteroid.velocity.x *= 0.85;
                  asteroid.velocity.y *= 0.85;
                  if (onDamage) onDamage(structure.position, COLLISION_CONFIG.DAMAGE.STRUCTURE_IMPACT, structure, asteroid.position);
                  if (structure.health <= 0) {
                      structure.health = 0;
                      structure.active = false;
                      if (structure.mass === Infinity) {
                          this.removeStaticEntity(structure);
                      }
                  }
                  return;
              }
          }
          // Still below pressure threshold: fall through to elastic bounce.
      }

      // Mobile-shard vs Player — speed-gated environmental damage
      // (bypasses shield).  Stage 5: mobile shards now live on
      // STRUCTURE+finite mass; the legacy ASTEROID type is still
      // accepted for any not-yet-migrated spawn site.
      const aIsPlayerLike = a.type === EntityType.PLAYER;
      const bIsPlayerLike = b.type === EntityType.PLAYER;
      if ((aIsPlayerLike && bIsMobileShard) || (bIsPlayerLike && aIsMobileShard)) {
          const player = aIsPlayerLike ? a : b;
          const impactSpeed = Math.abs(velAlongNormal);
          if (impactSpeed > COLLISION_CONFIG.ENV_DAMAGE.SPEED_THRESHOLD) {
              const envDmg = impactSpeed * COLLISION_CONFIG.ENV_DAMAGE.MULTIPLIER;
              player.health -= envDmg;
              player.hitFlash = 0.1;
          }
      }
      
      const j = -(1 + ELASTICITY) * velAlongNormal;
      const impulse = j / totalInvMass;

      const ix = nx * impulse;
      const iy = ny * impulse;

      if (a.mass !== Infinity) {
          a.velocity.x -= ix * invMassA;
          a.velocity.y -= iy * invMassA;
      }
      if (b.mass !== Infinity) {
          b.velocity.x += ix * invMassB;
          b.velocity.y += iy * invMassB;
      }
      // Plastic-shard wiggle trigger — fires when post-impulse
      // speed > restSpeed (collision woke the shard from its
      // sleep state).  Impact direction = contact normal (nx, ny)
      // flipped for the b side; squash visual is unsigned so the
      // 180° flip doesn't matter, but it's cheap to pass the
      // correct sign anyway.  No-op for non-plastic.
      maybeStampPlasticWiggle(a,  nx,  ny, true);
      maybeStampPlasticWiggle(b, -nx, -ny, true);
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
