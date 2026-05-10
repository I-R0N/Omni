

import { GameEntity, Vector2, MapType, EntityType } from '../../types';
import { PHYSICS_CONSTANTS, SPATIAL_GRID_SIZE, PLAYER_MOVEMENT_CONFIG, STRUCTURE_CONSTANTS, LOCAL_GRAVITY_CONSTANTS, COLLISION_CONFIG, SHIELD_CONSTANTS, NEBULA_CONSTANTS, nebulaFadeRateScale, SHARD_VARIANTS, SHARD_PAIR_CONSTANTS } from '../../constants';
import { MAP_WIDTH, MAP_HEIGHT, HALF_MAP_WIDTH, HALF_MAP_HEIGHT, wrapPosition, wrapDeltaX, wrapDeltaY, wrapX, wrapY, onMapDimensionsChanged } from '../toroidal';

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
  // Internal counter, ticked once per handleEntityCollisions call.
  // Used as `counter % interval === 0` to gate shard-shard pairs.
  private shardPairTick: number = 0;
  // Peak dynamic-grid cell population seen during this step's broadphase.
  // Tracked as the grid is populated; the 3×3 neighbourhood check is
  // quadratic per cell, so this is the direct signal for dense-cluster stalls.
  public lastMaxCellDensity: number = 0;

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

  // Call this when loading a map to cache static geometry
  public initializeStaticGrid(entities: GameEntity[]) {
      this.staticGrid.clear();

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
          if (entity.nebulaFadeTimer !== undefined && entity.nebulaFadeTimer > 0) {
              entity.nebulaFadeTimer -= dt;
              if (entity.nebulaFadeTimer <= 0) {
                  entity.nebulaFadeTimer = undefined;
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
      // Nebula shard fade — shattered shards stay active+rendered while
      // this counts down, then deactivate and get compacted out.  Tiles
      // already had their fade ticked above inside the mass=Infinity
      // branch, so this path only fires for dynamic (shard) entities.
      if (entity.nebulaFadeTimer !== undefined && entity.nebulaFadeTimer > 0) {
          entity.nebulaFadeTimer -= dt;
          if (entity.nebulaFadeTimer <= 0) {
              entity.nebulaFadeTimer = undefined;
              entity.active = false;
          }
      }
      // Generic merge fade-out — same lifecycle as the nebula timer
      // but applies across non-nebula shard families (rock / glass).
      // The smaller party of a density-compaction merge stays active
      // and rendered (with multiplied alpha) while this counts down,
      // then flips inactive so the in-place compaction in
      // GameEngine.updatePhysics drops it.
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
            // field at spawn time).
            const linearD = entity.linearDamping;
            const angularD = entity.angularDamping ?? NEBULA_CONSTANTS.ANGULAR_DAMPING;
            const lin = Math.pow(linearD, timeScale);
            const ang = Math.pow(angularD, timeScale);
            entity.velocity.x *= lin;
            entity.velocity.y *= lin;
            if (Math.abs(entity.velocity.x) < NEBULA_CONSTANTS.REST_SPEED) entity.velocity.x = 0;
            if (Math.abs(entity.velocity.y) < NEBULA_CONSTANTS.REST_SPEED) entity.velocity.y = 0;
            if (entity.rotationSpeed !== undefined) {
                entity.rotationSpeed *= ang;
                if (Math.abs(entity.rotationSpeed) < NEBULA_CONSTANTS.REST_SPIN) entity.rotationSpeed = 0;
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
      this.handleEntityCollisions(entities, onDamage, onDeath, onShake, onHit);
      if (this.shouldRunShardPairsThisStep()) {
        this.resolveShardPairs(asteroids);
      }
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
              const dist = Math.sqrt(distSq);
              const forceMag = (STRENGTH / dist) * timeScale; // Normalize force by time
              const ndx = dx / dist;
              const ndy = dy / dist;

              // Pull Asteroid
              e.velocity.x += ndx * forceMag;
              e.velocity.y += ndy * forceMag;

              // Pull Player
              const accelPlayer = forceMag * (e.mass / player.mass) * PLAYER_INFLUENCE;
              player.velocity.x -= ndx * accelPlayer;
              player.velocity.y -= ndy * accelPlayer;
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

                const dist = Math.sqrt(distSq);
                const ax = (dx / dist) * clampedForce;
                const ay = (dy / dist) * clampedForce;

                entity.velocity.x += ax;
                entity.velocity.y += ay;
            }
        }
    }
  }

  private handleEntityCollisions(
    entities: GameEntity[],
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
    const dynamicEntities: GameEntity[] = [];
    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (!e.active || e.isExploding) continue;

        // Static structures are already in staticGrid. Do NOT add them here.
        if (e.mass === Infinity && e.type !== EntityType.INTERACTABLE) continue;

        // Particles never interact in resolveCollision — skip the grid.
        if (e.type === EntityType.PARTICLE) continue;

        // Fading nebulas (tiles and shards alike) are in their death
        // animation — drop them out of broadphase so they can't be
        // re-shattered mid-fade even after the striker's cooldown expires.
        if (e.nebulaFadeTimer !== undefined) continue;

        // Nebula shards re-enter the dynamic grid so player/enemy contact
        // can trigger a shatter.  The nebula branch in resolveCollision is
        // still pass-through (no impulse), so they never exchange momentum
        // with anything — only the shatter side-effect fires.
        dynamicEntities.push(e);

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
        // Mobile shards (STRUCTURE finite mass) are SKIPPED as
        // outer-loop subjects — non-shard outer loops cover their
        // pairs via 3x3 mutual scan, and shard ↔ shard runs in
        // resolveShardPairs.
        if (a.type === EntityType.STRUCTURE) continue;

        const cx = Math.floor(a.position.x / SPATIAL_GRID_SIZE);
        const cy = Math.floor(a.position.y / SPATIAL_GRID_SIZE);

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
      const k = 1 - Math.random() * dent.vertexJitter;
      pts[bestIdx].x *= k;
      pts[bestIdx].y *= k;
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
    let interval = this.shardPairFrameInterval | 0;
    if (interval <= 0) {
        const density = this.lastMaxCellDensity;
        const table = SHARD_PAIR_CONSTANTS.AUTO_THRESHOLDS;
        let auto = table[table.length - 1].interval;
        for (let i = 0; i < table.length; i++) {
            if (density <= table[i].maxDensity) { auto = table[i].interval; break; }
        }
        interval = auto;
    }
    this.lastEffectiveShardPairInterval = interval;
    const run = (this.shardPairTick % interval) === 0;
    this.shardPairTick++;
    this.lastRunShardPair = run;
    return run;
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
   * missing).  Fading shards (nebulaFadeTimer / mergeFadeTimer set)
   * are filtered out — they shouldn't pull or push other shards
   * during their death animation.
   */
  private resolveShardPairs(shards: GameEntity[]): void {
    if (shards.length < 2) return;

    // Build the shard-only grid.  Same SPATIAL_GRID_SIZE as the main
    // dynamic grid so cell math and 3×3 scan radius are consistent
    // with everything else in the broadphase.
    this.shardGrid.clear();
    for (let i = 0; i < shards.length; i++) {
        const e = shards[i];
        if (!e.active || e.isExploding) continue;
        if (e.nebulaFadeTimer !== undefined) continue;
        if (e.mergeFadeTimer !== undefined) continue;
        const key = cellKey(e.position.x, e.position.y);
        let cell = this.shardGrid.get(key);
        if (!cell) { cell = []; this.shardGrid.set(key, cell); }
        cell.push(e);
    }

    // Walk the shard list and resolve pairs.  j > i ordering via
    // id comparison ensures each unordered pair is processed once.
    // The inner pair body is identical in spirit to the main loop's
    // shard-shard branch (now removed), but iterates a much smaller
    // set since non-shard entities aren't here.
    for (let i = 0; i < shards.length; i++) {
        const a = shards[i];
        if (!a.active || a.isExploding) continue;
        if (a.nebulaFadeTimer !== undefined) continue;
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
                    this.resolveAsteroidPair(a, b);
                }
            }
        }
    }
  }

  private resolveAsteroidPair(a: GameEntity, b: GameEntity) {
      // Cheapest possible early-outs first — most pair calls discard
      // here before paying any further work.

      const MAX_SEPARATION_STEP = 2;  // world units per entity per frame
      const rA = a.size.x * 0.42;
      const rB = b.size.x * 0.42;
      const sumR = rA + rB;
      const sumRSq = sumR * sumR;

      const dx = wrapDeltaX(a.position.x, b.position.x);
      const dy = wrapDeltaY(a.position.y, b.position.y);
      const distSq = dx * dx + dy * dy;
      if (distSq > sumRSq) return;

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
      if (a.shardVariant !== undefined && SHARD_VARIANTS[a.shardVariant].passThrough === true) return;
      if (b.shardVariant !== undefined && SHARD_VARIANTS[b.shardVariant].passThrough === true) return;

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
  }

  private checkAndResolveCollision(
    a: GameEntity,
    b: GameEntity,
    onDamage?: (pos: Vector2, amount: number, target?: GameEntity, impactWorldPos?: Vector2) => void,
    onDeath?: (entity: GameEntity) => void,
    onShake?: (amount: number) => void,
    onHit?: (impactPos: Vector2, proj: GameEntity, target: GameEntity) => void
  ) {
      // 0. BROADPHASE: Fast Circle Check — using toroidal delta so pairs
      // across the wrap seam are still considered.  If the shorter way
      // around the torus is < rA+rB, the two entities are genuinely close.
      let rA = Math.max(a.size.x, a.size.y) / 2;
      let rB = Math.max(b.size.x, b.size.y) / 2;
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

      // 1. SAT Collision Detection (Alloc-Free)
      if (this.checkCollisionSAT(a, b)) {
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
      
      // Calculate Axes into buffer
      const axesCount = this.fillAxes(this.bufferVerticesA, countA, this.bufferVerticesB, countB, this.bufferAxes);

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

      // ── NEBULA: pass-through with conditional shatter ──────────────────
      // Stage 5: per-variant passThrough flag drives the impulse skip
      // (only nebula-tile sets it today).  Nebula-shards now go
      // through standard collision impulse; their mass = 0.01 keeps
      // the striker velocity change negligible (~3 orders of
      // magnitude smaller than today's mass=size shards) while the
      // shard itself takes a strong kick that the existing
      // linearDamping = 0.97 bleeds off in <1s — the same "cloud
      // shoved aside" feel without a per-EntityType skip.
      const aPassThrough = a.shardVariant !== undefined && SHARD_VARIANTS[a.shardVariant].passThrough === true;
      const bPassThrough = b.shardVariant !== undefined && SHARD_VARIANTS[b.shardVariant].passThrough === true;
      // Shatter trigger is independent of pass-through — a nebula
      // tile shatters on PLAYER/ENEMY contact regardless.
      const aIsNebulaTile = a.shardVariant === 'nebula-tile';
      const bIsNebulaTile = b.shardVariant === 'nebula-tile';
      if (aPassThrough || bPassThrough) {
          // Both sides pass-through (e.g. tile-vs-tile in some future
          // configuration) — no impulse, no shatter.
          if (aPassThrough && bPassThrough) return;

          const nebula = aPassThrough ? a : b;
          const other  = aPassThrough ? b : a;

          // Striker must be PLAYER or ENEMY to shatter, AND must not
          // be in the post-shatter cooldown window.
          const shatters = (aIsNebulaTile || bIsNebulaTile)
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
                  nebula.nebulaFadeTimer = scaledFadeDuration;
                  nebula.nebulaFadeDuration = scaledFadeDuration;
                  if (nebula.shardVariant === 'nebula-tile') {
                      // Tiles live in the static grid — pull them out so
                      // the player can drift through the fading cell.
                      this.removeStaticEntity(nebula);
                  }
                  // Shards live in the dynamic grid which is rebuilt
                  // each frame; the populate loop below skips entities
                  // with nebulaFadeTimer set, so fading shards drop out
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
                  if (isDentEntity && target.mass !== Infinity && proj.velocity) {
                      const pushFactor = 0.20 / Math.max(1, target.mass / 10);
                      target.velocity.x += proj.velocity.x * pushFactor;
                      target.velocity.y += proj.velocity.y * pushFactor;
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
              const envDmg = impactSpeed * COLLISION_CONFIG.ENV_DAMAGE.MULTIPLIER;
              player.health -= envDmg;
              player.hitFlash = 0.1;
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
  }

  // --- OPTIMIZED SAT HELPERS ---
  private fillVertices(e: GameEntity, buffer: Vector2[]): number {
      let count = 0;
      // Shield expands the player's collision shape
      const shieldScale = (e.id === 'player' && (e.shield ?? 0) > 0)
          ? SHIELD_CONSTANTS.COLLISION_MULTIPLIER : 1;

      if (e.polygonPoints && e.polygonPoints.length > 0) {
          const cos = Math.cos(e.rotation);
          const sin = Math.sin(e.rotation);

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

  private fillAxes(vertsA: Vector2[], countA: number, vertsB: Vector2[], countB: number, bufferAxes: Vector2[]): number {
      let axisIdx = 0;
      
      // Axes for A
      for (let i = 0; i < countA; i++) {
          if (axisIdx >= bufferAxes.length) break;
          const p1 = vertsA[i];
          const p2 = vertsA[(i + 1) % countA];
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.sqrt(dx*dx + dy*dy);
          if (len > 0.001) {
              bufferAxes[axisIdx].x = -dy / len;
              bufferAxes[axisIdx].y = dx / len;
              axisIdx++;
          }
      }
      // Axes for B
      for (let i = 0; i < countB; i++) {
          if (axisIdx >= bufferAxes.length) break;
          const p1 = vertsB[i];
          const p2 = vertsB[(i + 1) % countB];
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.sqrt(dx*dx + dy*dy);
          if (len > 0.001) {
              bufferAxes[axisIdx].x = -dy / len;
              bufferAxes[axisIdx].y = dx / len;
              axisIdx++;
          }
      }
      return axisIdx;
  }
}
