

import { GameEntity, Vector2, MapType, EntityType } from '../../types';
import { PHYSICS_CONSTANTS, SPATIAL_GRID_SIZE, PLAYER_MOVEMENT_CONFIG, STRUCTURE_CONSTANTS, LOCAL_GRAVITY_CONSTANTS, COLLISION_CONFIG } from '../../constants';

export class PhysicsSystem {
  // Dual-grid system:
  // staticGrid stores immovable geometry (Tiles) and is calculated ONLY on map load.
  // dynamicGrid stores moving entities (Player, Enemies, Projectiles) and is cleared every frame.
  private staticGrid: Map<number, GameEntity[]> = new Map();
  private dynamicGrid: Map<number, GameEntity[]> = new Map();
  
  // HOT MEMORY BUFFERS (Pre-allocated to prevent GC)
  private bufferVerticesA: Vector2[] = Array.from({ length: 16 }, () => ({ x: 0, y: 0 }));
  private bufferVerticesB: Vector2[] = Array.from({ length: 16 }, () => ({ x: 0, y: 0 }));
  private bufferAxes: Vector2[] = Array.from({ length: 32 }, () => ({ x: 0, y: 0 }));
  private bufferMtv: Vector2 = { x: 0, y: 0 };

  // Call this when loading a map to cache static geometry
  public initializeStaticGrid(entities: GameEntity[]) {
      this.staticGrid.clear();
      const cellSize = SPATIAL_GRID_SIZE;

      for (let i = 0; i < entities.length; i++) {
          const e = entities[i];
          // Only index static structures that are not interactive portals/stations
          if (e.mass === Infinity && e.type !== EntityType.INTERACTABLE && e.active) {
               const cx = Math.floor(e.position.x / cellSize);
               const cy = Math.floor(e.position.y / cellSize);
               const key = (cx << 16) | (cy & 0xFFFF);
               
               let cell = this.staticGrid.get(key);
               if (!cell) {
                   cell = [];
                   this.staticGrid.set(key, cell);
               }
               cell.push(e);
          }
      }
  }

  public update(
    entities: GameEntity[], 
    mapType: MapType, 
    dt: number, 
    onDamage?: (pos: Vector2, amount: number) => void, 
    onDeath?: (entity: GameEntity) => void,
    onShake?: (amount: number) => void
  ) {
    // Determine Friction based on Environment (MapType) from Config
    const config = PLAYER_MOVEMENT_CONFIG[mapType];
    const baseFriction = config ? config.friction : PHYSICS_CONSTANTS.FRICTION;

    // Time-Corrected Friction: Ensure friction effect is consistent per SECOND, not per tick.
    // Normalized to 60Hz. If dt is 1/120, exponent is 0.5.
    const timeScale = dt * 60;
    const friction = Math.pow(baseFriction, timeScale);

    // Apply Planetary/Stellar Gravity (Scaled by time)
    this.applyGravity(entities, timeScale, onDamage);

    // Apply Player-Asteroid Mutual Gravity (Scaled by time)
    this.applyLocalGravity(entities, timeScale);

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      if (!entity.active) continue;

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

      // OPTIMIZATION: Skip Integration for Static Geometry
      // If mass is infinity (and not an interactable needing triggers), it never moves.
      if (entity.mass === Infinity) {
          continue; 
      }

      // ORBITAL PHYSICS
      if (entity.orbitCenter && entity.orbitRadius && entity.orbitSpeed !== undefined && entity.orbitAngle !== undefined) {
          entity.orbitAngle += entity.orbitSpeed * dt;
          entity.position.x = entity.orbitCenter.x + Math.cos(entity.orbitAngle) * entity.orbitRadius;
          entity.position.y = entity.orbitCenter.y + Math.sin(entity.orbitAngle) * entity.orbitRadius;
          
          entity.velocity.x = 0;
          entity.velocity.y = 0;
      } else {
          // STANDARD PHYSICS
          
          // Skip movement for exploding entities
          if (entity.isExploding) continue;

          entity.position.x += entity.velocity.x;
          entity.position.y += entity.velocity.y;

          // Apply Friction
          // Don't apply friction to projectiles (constant speed), asteroids (drift), or drop shards (drift like asteroids)
          if (entity.type !== EntityType.PROJECTILE && entity.type !== EntityType.ASTEROID && entity.type !== EntityType.PARTICLE
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
    this.handleEntityCollisions(entities, onDamage, onDeath, onShake);
  }

  private applyLocalGravity(entities: GameEntity[], timeScale: number) {
      const player = entities.find(e => e.type === EntityType.PLAYER);
      if (!player || !player.active) return;

      const { RANGE, STRENGTH, MIN_DIST, PLAYER_INFLUENCE } = LOCAL_GRAVITY_CONSTANTS;
      const rangeSq = RANGE * RANGE;
      const minDistSq = MIN_DIST * MIN_DIST;

      // Optimization: Could limit iteration to only Asteroids in dynamic grid, but raw iteration is fast enough for now
      for (let i = 0; i < entities.length; i++) {
          const e = entities[i];
          if (e.type !== EntityType.ASTEROID || !e.active || e.isExploding) continue;

          const dx = player.position.x - e.position.x;
          const dy = player.position.y - e.position.y;
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

  private applyGravity(entities: GameEntity[], timeScale: number, onDamage?: (pos: Vector2, amount: number) => void) {
    const attractors: GameEntity[] = [];
    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (e.active && e.gravityRange && e.gravityRange > 0) {
            attractors.push(e);
        }
    }

    if (attractors.length === 0) return;

    for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        // Optimization: Skip particles and structures
        if (!entity.active || entity.isExploding || entity.mass === Infinity || entity.type === EntityType.STRUCTURE || entity.type === EntityType.PARTICLE) continue;

        for (let j = 0; j < attractors.length; j++) {
            const attractor = attractors[j];
            if (entity === attractor) continue;

            const dx = attractor.position.x - entity.position.x;
            const dy = attractor.position.y - entity.position.y;
            const distSq = dx*dx + dy*dy;
            const rangeSq = attractor.gravityRange! ** 2;

            if (distSq < (attractor.size.x / 2)**2 && entity.type === EntityType.ASTEROID) {
                entity.active = false;
                if (onDamage) onDamage(entity.position, COLLISION_CONFIG.DAMAGE.ASTEROID_CRUSH);
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
    onDamage?: (pos: Vector2, amount: number) => void, 
    onDeath?: (entity: GameEntity) => void,
    onShake?: (amount: number) => void
  ) {
    // 1. Clear ONLY Dynamic Grid (Static Grid is persistent)
    this.dynamicGrid.clear();
    const cellSize = SPATIAL_GRID_SIZE;

    // 2. Populate Dynamic Grid with moving entities
    const dynamicEntities: GameEntity[] = [];
    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (!e.active || e.isExploding) continue;
        
        // Static structures are already in staticGrid. Do NOT add them here.
        if (e.mass === Infinity && e.type !== EntityType.INTERACTABLE) continue;

        dynamicEntities.push(e);
        
        const cx = Math.floor(e.position.x / cellSize);
        const cy = Math.floor(e.position.y / cellSize);
        const key = (cx << 16) | (cy & 0xFFFF);
        
        let cell = this.dynamicGrid.get(key);
        if (!cell) {
            cell = [];
            this.dynamicGrid.set(key, cell);
        }
        cell.push(e);
    }

    // 3. Check Collisions: Only iterate DYNAMIC entities as primary subjects
    for (let i = 0; i < dynamicEntities.length; i++) {
        const a = dynamicEntities[i];
        
        const cx = Math.floor(a.position.x / cellSize);
        const cy = Math.floor(a.position.y / cellSize);

        // Check 3x3 neighbor cells
        for (let x = -1; x <= 1; x++) {
            for (let y = -1; y <= 1; y++) {
                const key = ((cx + x) << 16) | ((cy + y) & 0xFFFF);
                
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
                        
                        this.checkAndResolveCollision(a, b, onDamage, onDeath, onShake);
                    }
                }

                // Check Dynamic vs Static
                if (staticCandidates) {
                    for (let j = 0; j < staticCandidates.length; j++) {
                        const b = staticCandidates[j];
                        if (!b.active) continue;
                        
                        this.checkAndResolveCollision(a, b, onDamage, onDeath, onShake);
                    }
                }
            }
        }
    }
  }

  private removeStaticEntity(entity: GameEntity) {
      const cellSize = SPATIAL_GRID_SIZE;
      const cx = Math.floor(entity.position.x / cellSize);
      const cy = Math.floor(entity.position.y / cellSize);
      const key = (cx << 16) | (cy & 0xFFFF);

      const cell = this.staticGrid.get(key);
      if (cell) {
          const idx = cell.indexOf(entity);
          if (idx !== -1) {
              cell.splice(idx, 1);
          }
      }
  }

  public addStaticEntity(entity: GameEntity) {
      const cellSize = SPATIAL_GRID_SIZE;
      const cx = Math.floor(entity.position.x / cellSize);
      const cy = Math.floor(entity.position.y / cellSize);
      const key = (cx << 16) | (cy & 0xFFFF);

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
      const cellSize = SPATIAL_GRID_SIZE;
      const cx = Math.floor(x / cellSize);
      const cy = Math.floor(y / cellSize);
      const rSq = r * r;

      for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
              const key = ((cx + dx) << 16) | ((cy + dy) & 0xFFFF);
              const cell = this.staticGrid.get(key);
              if (!cell) continue;
              for (let i = 0; i < cell.length; i++) {
                  const t = cell[i];
                  if (!t.active) continue;
                  const tdx = x - t.position.x;
                  const tdy = y - t.position.y;
                  if (tdx * tdx + tdy * tdy < rSq) return false;
              }
          }
      }
      return true;
  }

  private checkAndResolveCollision(
    a: GameEntity, 
    b: GameEntity, 
    onDamage?: (pos: Vector2, amount: number) => void, 
    onDeath?: (entity: GameEntity) => void,
    onShake?: (amount: number) => void
  ) {
      // 0. BROADPHASE: Fast Circle Check
      const rA = Math.max(a.size.x, a.size.y) / 2;
      const rB = Math.max(b.size.x, b.size.y) / 2;
      const dx = a.position.x - b.position.x;
      const dy = a.position.y - b.position.y;
      const distSq = dx*dx + dy*dy;
      
      if (distSq > (rA + rB + 10)**2) return;

      // 1. SAT Collision Detection (Alloc-Free)
      if (this.checkCollisionSAT(a, b)) {
          this.resolveCollision(a, b, this.bufferMtv, onDamage, onDeath, onShake);
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
    onDamage?: (pos: Vector2, amount: number) => void, 
    onDeath?: (entity: GameEntity) => void,
    onShake?: (amount: number) => void
  ) {
      if (a.type === EntityType.PARTICLE || b.type === EntityType.PARTICLE) return;
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

          target.health -= (proj.damage || 1);
          target.hitFlash = 0.1;
          
          if (onShake && target.type !== EntityType.STRUCTURE && target.type !== EntityType.ASTEROID) {
              onShake(COLLISION_CONFIG.SHAKE.MICRO); 
          }
          
          if (onDamage) onDamage(target.position, proj.damage || 1);

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
              if (onDamage) onDamage(target.position, COLLISION_CONFIG.DAMAGE.PLAYER_RAM_ENEMY);
              target.health -= COLLISION_CONFIG.DAMAGE.PLAYER_RAM_ENEMY;
              target.hitFlash = 0.2;
              if (onShake) onShake(COLLISION_CONFIG.SHAKE.MEDIUM);
              if (target.health <= 0 && onDeath) {
                  onDeath(target);
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
              if (onDamage) onDamage(structure.position, COLLISION_CONFIG.DAMAGE.STRUCTURE_IMPACT);
              return; 
          } else {
              if (onDamage) onDamage(player.position, COLLISION_CONFIG.DAMAGE.MINOR_IMPACT);
              player.health -= COLLISION_CONFIG.DAMAGE.MINOR_IMPACT;
              player.hitFlash = 0.2;
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
      if (e.polygonPoints && e.polygonPoints.length > 0) {
          const cos = Math.cos(e.rotation);
          const sin = Math.sin(e.rotation);
          
          for (let i = 0; i < e.polygonPoints.length; i++) {
              if (count >= buffer.length) break;
              const p = e.polygonPoints[i];
              buffer[count].x = e.position.x + (p.x * cos - p.y * sin);
              buffer[count].y = e.position.y + (p.x * sin + p.y * cos);
              count++;
          }
      } else {
          const w = e.size.x / 2;
          const h = e.size.y / 2;
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
