

import { GameEntity, Vector2, MapType, EntityType } from '../../types';
import { PHYSICS_CONSTANTS, SPATIAL_GRID_SIZE, PLAYER_MOVEMENT_CONFIG, STRUCTURE_CONSTANTS, LOCAL_GRAVITY_CONSTANTS, COLLISION_CONFIG, SHIELD_CONSTANTS, NEBULA_CONSTANTS, nebulaFadeRateScale } from '../../constants';
import { MAP_WIDTH, MAP_HEIGHT, HALF_MAP_WIDTH, HALF_MAP_HEIGHT, wrapPosition, wrapDeltaX, wrapDeltaY } from '../toroidal';

// Number of spatial-hash cells along each axis of the toroidal map.  The
// broadphase keys pack (col, row) into a single int using `(cx << 16) |
// (cy & 0xFFFF)`, and cell indices are wrapped into [0, SPATIAL_COLS) so
// neighbour queries near a seam land on the same bucket as the entities
// they should collide with on the opposite side.
const SPATIAL_COLS = Math.ceil(MAP_WIDTH  / SPATIAL_GRID_SIZE);
const SPATIAL_ROWS = Math.ceil(MAP_HEIGHT / SPATIAL_GRID_SIZE);

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

export class PhysicsSystem {
  // Dual-grid system:
  // staticGrid stores immovable geometry (Tiles) and is calculated ONLY on map load.
  // dynamicGrid stores moving entities (Player, Enemies, Projectiles) and is cleared every frame.
  private staticGrid: Map<number, GameEntity[]> = new Map();
  private dynamicGrid: Map<number, GameEntity[]> = new Map();

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
    onDamage?: (pos: Vector2, amount: number, target?: GameEntity) => void,
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

    // Apply Planetary/Stellar Gravity (Scaled by time)
    const tGrav = performance.now();
    this.applyGravity(entities, timeScale, onDamage);
    this.lastGravityMs = performance.now() - tGrav;

    // Apply Player-Asteroid Mutual Gravity (Scaled by time)
    const tLocal = performance.now();
    this.applyLocalGravity(asteroids, player, timeScale);
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

          // Apply Friction
          if (entity.type === EntityType.NEBULA_SHARD) {
            // Nebula shards: custom heavy linear & angular damping (cloud drag).
            // Uses per-entity damping factors so individual shards can vary if
            // needed, with a sane default from NEBULA_CONSTANTS.
            const linearD = entity.linearDamping ?? NEBULA_CONSTANTS.LINEAR_DAMPING;
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
          } else if (entity.type !== EntityType.PROJECTILE && entity.type !== EntityType.ASTEROID && entity.type !== EntityType.PARTICLE
              && !(entity.type === EntityType.INTERACTABLE && entity.dropType)) {
            // Apply standard friction to all dynamic entities (Player, Enemies, etc)
            entity.velocity.x *= friction;
            entity.velocity.y *= friction;

            // Snap to zero at very low speeds to prevent micro-drift calculations
            if (Math.abs(entity.velocity.x) < 0.01) entity.velocity.x = 0;
            if (Math.abs(entity.velocity.y) < 0.01) entity.velocity.y = 0;
          }
      }
    }

    // Optimized Entity-Entity Collision (Spatial Hash Grid)
    const tCol = performance.now();
    this.handleEntityCollisions(entities, onDamage, onDeath, onShake, onHit);
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

  private applyGravity(entities: GameEntity[], timeScale: number, onDamage?: (pos: Vector2, amount: number, target?: GameEntity) => void) {
    // Phase 2: use the attractors cache populated on map load instead of
    // re-scanning the full entity array every substep.  Individual dead
    // attractors are skipped at access time by the `active` check below so
    // a destroyed attractor stops contributing without rebuilding the list.
    const attractors = this.attractorsCache;
    if (attractors.length === 0) return;

    for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        // Optimization: Skip particles and structures
        if (!entity.active || entity.isExploding || entity.mass === Infinity || entity.type === EntityType.STRUCTURE || entity.type === EntityType.PARTICLE) continue;

        for (let j = 0; j < attractors.length; j++) {
            const attractor = attractors[j];
            if (!attractor.active) continue;
            if (entity === attractor) continue;

            const dx = wrapDeltaX(entity.position.x, attractor.position.x);
            const dy = wrapDeltaY(entity.position.y, attractor.position.y);
            const distSq = dx*dx + dy*dy;
            const rangeSq = attractor.gravityRange! ** 2;

            if (distSq < (attractor.size.x / 2)**2 && entity.type === EntityType.ASTEROID) {
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
    onDamage?: (pos: Vector2, amount: number, target?: GameEntity) => void,
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

    // 3. Check Collisions: Only iterate DYNAMIC entities as primary subjects
    for (let i = 0; i < dynamicEntities.length; i++) {
        const a = dynamicEntities[i];

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
                        // Avoid double checking dynamic pairs
                        if (a.id > b.id) continue;

                        // ── Type-pair filter: skip pairs that resolve-
                        // Collision always discards BEFORE the expensive
                        // SAT geometry pass.  In late waves with dense
                        // shard clusters (max cell 100+), these filters
                        // eliminate ~60 % of total pair checks.
                        const ta = a.type, tb = b.type;

                        // Projectile-projectile: resolveCollision returns
                        // immediately (no proj-proj interaction).
                        if (ta === EntityType.PROJECTILE && tb === EntityType.PROJECTILE) continue;

                        // Asteroid-asteroid: the ONLY result is gentle
                        // impulse bouncing which fights against the
                        // gravity + flow-field that pushes shards together
                        // anyway, producing jitter rather than meaningful
                        // gameplay.  The stick-bond system still handles
                        // merging via its own grid.  Skipping this single
                        // pair type eliminates the dominant O(k²) cost in
                        // dense cluster cells.
                        if (ta === EntityType.ASTEROID && tb === EntityType.ASTEROID) continue;
                        
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

  private removeStaticEntity(entity: GameEntity) {
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

  private checkAndResolveCollision(
    a: GameEntity,
    b: GameEntity,
    onDamage?: (pos: Vector2, amount: number, target?: GameEntity) => void,
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
    onDamage?: (pos: Vector2, amount: number, target?: GameEntity) => void,
    onDeath?: (entity: GameEntity) => void,
    onShake?: (amount: number) => void,
    onHit?: (impactPos: Vector2, proj: GameEntity, target: GameEntity) => void
  ) {
      if (a.type === EntityType.PARTICLE || b.type === EntityType.PARTICLE) return;

      // ── NEBULA: pass-through with conditional shatter ──────────────────
      // Nebula tiles AND nebula shards never apply a collision impulse.
      // PLAYER/ENEMY contact shatters them into 3 children at 75% of the
      // parent's linear size (handled in GameEngine.spawnNebulaShards).
      // Projectiles and everything else pass straight through without
      // touching the nebula.  Sub-minimum shards pass through without
      // even shattering (the caller returns early in spawnNebulaShards).
      const aIsNebula = a.type === EntityType.NEBULA || a.type === EntityType.NEBULA_SHARD;
      const bIsNebula = b.type === EntityType.NEBULA || b.type === EntityType.NEBULA_SHARD;
      if (aIsNebula || bIsNebula) {
          // If both sides are nebula (tile/shard vs tile/shard), no shatter —
          // those interactions belong to the gravity/merge pass in
          // GameEngine.updateNebulaDynamics.
          if (aIsNebula && bIsNebula) return;

          const nebula = aIsNebula ? a : b;
          const other  = aIsNebula ? b : a;

          // Striker must be PLAYER or ENEMY to shatter, AND must not be
          // in the post-shatter cooldown window.  Shards are
          // INDESTRUCTIBLE — they pass through unchanged — so only
          // NEBULA tiles are shatterable.  This keeps the total nebula
          // area conserved: each tile shatter produces exactly one
          // tile's worth of effective shard mass, which eventually
          // coalesces back into one new tile via transmutation.
          const shatters = nebula.type === EntityType.NEBULA
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
                  if (nebula.type === EntityType.NEBULA) {
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
              if (!isPlayerShot && other.type !== EntityType.ASTEROID && other.type !== EntityType.STRUCTURE
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

          // Bouncer projectiles reflect off tiles (STRUCTURE) and tile shards
          // (ASTEROID with shardType === 'tile') instead of being consumed.
          // They do NOT damage tiles — a damaged tile dies in one shot (HEALTH=1),
          // which would leave nothing to bounce off of.
          if (proj.isBouncer) {
              const isTile = target.type === EntityType.STRUCTURE
                  || (target.type === EntityType.ASTEROID && target.shardType === 'tile');
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
              target.health -= projDmg;
              target.hitFlash = 0.1;
          }

          if (onShake && target.type !== EntityType.STRUCTURE && target.type !== EntityType.ASTEROID) {
              const shakeAmount = target.type === EntityType.PLAYER
                  ? COLLISION_CONFIG.SHAKE.MEDIUM
                  : COLLISION_CONFIG.SHAKE.MICRO;
              onShake(shakeAmount);
          }

          if (onHit) onHit(proj.position, proj, target);
          if (onDamage) onDamage(target.position, proj.damage || 1, target);

          if (target.health <= 0) {
              // Stamp the impactor's velocity so shard spawning can scatter
              // pieces in the direction of impact rather than randomly.
              if (target.type === EntityType.ASTEROID || target.type === EntityType.STRUCTURE) {
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
          const isHardTarget = other.type === EntityType.ENEMY || other.type === EntityType.ASTEROID || other.type === EntityType.STRUCTURE;
          
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

      // Structure Crashing Logic
      if ((a.type === EntityType.PLAYER && b.type === EntityType.STRUCTURE) || (b.type === EntityType.PLAYER && a.type === EntityType.STRUCTURE)) {
          const player = a.type === EntityType.PLAYER ? a : b;
          const structure = a.type === EntityType.STRUCTURE ? a : b;
          const impactSpeed = Math.abs(velAlongNormal);

          if (impactSpeed > STRUCTURE_CONSTANTS.CRASH_VELOCITY_THRESHOLD) {
              structure.health = 0;
              structure.active = false;
              if (structure.mass === Infinity) {
                  this.removeStaticEntity(structure);
              }
              player.velocity.x *= 0.5;
              player.velocity.y *= 0.5;
              if (onDamage) onDamage(structure.position, COLLISION_CONFIG.DAMAGE.STRUCTURE_IMPACT, structure);
              return;
          } else if (impactSpeed > COLLISION_CONFIG.ENV_DAMAGE.SPEED_THRESHOLD) {
              const envDmg = impactSpeed * COLLISION_CONFIG.ENV_DAMAGE.MULTIPLIER;
              player.health -= envDmg;
              player.hitFlash = 0.1;
          }
      }

      // Asteroid vs Player — speed-gated environmental damage (bypasses shield)
      if ((a.type === EntityType.PLAYER && b.type === EntityType.ASTEROID) || (b.type === EntityType.PLAYER && a.type === EntityType.ASTEROID)) {
          const player = a.type === EntityType.PLAYER ? a : b;
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
