

import { InputSystem } from './systems/InputSystem';
import { PhysicsSystem } from './systems/PhysicsSystem';
import { RenderSystem } from './systems/RenderSystem';
import { AISystem } from './systems/AISystem';
import { BaseMapLayer, UniverseMap, SolarSystemMap, LocalMap, SubMap } from './maps/MapClasses';
import { GameEntity, EntityType, MapType, CameraState, EngineStats, Vector2, WeaponType, WeaponConfig, DamageText, GameState } from '../types';
import { COLORS, PHYSICS_CONSTANTS, PROJECTILE_CONSTANTS, WEAPONS, WEAPON_LIST, MINIMAP_CONSTANTS, PLAYER_MOVEMENT_CONFIG, DAMAGE_TEXT_CONSTANTS, ASTEROID_GENERATION_CONFIG, TRAIL_CONSTANTS, PARTICLE_CONSTANTS, CAMERA_CONSTANTS, SPRITE_CONSTANTS } from '../constants';
import { ASSETS } from '../assets';

const MAP_RANK = {
  [MapType.UNIVERSE]: 0,
  [MapType.SOLAR_SYSTEM]: 1,
  [MapType.LOCAL]: 2,
  [MapType.SUB_MAP]: 3
};

const PHYSICS_MAX_STEPS = 5;

export class GameEngine {
  private input: InputSystem;
  private physics: PhysicsSystem;
  private renderer: RenderSystem;
  private ai: AISystem;
  
  private isRunning: boolean = false;
  private gameState: GameState = GameState.MENU;
  private lastTime: number = 0;
  private accumulator: number = 0;
  // UPDATED: 120 Hz Physics for smoother simulation
  private readonly FIXED_DT: number = 1/120;
  
  private maps: Map<string, BaseMapLayer> = new Map();
  private currentMap: BaseMapLayer | null = null;
  private player: GameEntity;
  private camera: CameraState;
  
  private damageTexts: DamageText[] = [];
  private currentWeaponIndex: number = 0;
  
  private minimapExpanded: boolean = false;
  private minimapTimer: number = 0;
  private minimapDebounce: number = 0;
  private interactionCooldown: number = 0;
  private frameEntities: GameEntity[] = [];
  
  // Screen Shake State
  private shakeTimer: number = 0;
  private shakeIntensity: number = 0;

  private transition = {
      active: false,
      timer: 0,
      duration: CAMERA_CONSTANTS.TRANSITION_DURATION, 
      targetType: MapType.UNIVERSE,
      targetId: '',
      switched: false,
      startZoom: 1,
      direction: 'IN' as 'IN' | 'OUT'
  };

  private onStatsUpdate: (stats: EngineStats) => void;

  constructor(onStatsUpdate: (stats: EngineStats) => void) {
    this.onStatsUpdate = onStatsUpdate;
    
    this.input = new InputSystem();
    this.physics = new PhysicsSystem();
    this.renderer = new RenderSystem();
    this.ai = new AISystem();

    this.player = {
      id: 'player',
      type: EntityType.PLAYER,
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      size: { x: SPRITE_CONSTANTS.PLAYER_BASE_SIZE, y: SPRITE_CONSTANTS.PLAYER_BASE_SIZE },
      rotation: 0,
      color: COLORS.PLAYER,
      active: true,
      health: 100,
      maxHealth: 100,
      mass: PHYSICS_CONSTANTS.PLAYER_MASS,
      currentWeapon: WeaponType.BLASTER,
      weaponCooldown: 0,
      burstQueue: 0,
      burstTimer: 0,
      trail: [],
      sprite: ASSETS.PLAYER_SHIP
    };

    this.camera = {
      position: { x: 0, y: 0 },
      zoom: 1,
      targetId: 'player',
      shakeOffset: { x: 0, y: 0 }
    };

    const initialMap = new UniverseMap();
    this.maps.set(initialMap.id, initialMap);
    this.loadMap(initialMap);
  }

  public initCanvas(ctx: CanvasRenderingContext2D) {
    this.renderer.setContext(ctx);
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    this.prepareFrameEntities();
    requestAnimationFrame(this.loop);
  }

  public stop() {
    this.isRunning = false;
  }

  // --- STATE MANAGEMENT ---
  public startGame() {
    this.gameState = GameState.PLAYING;
  }

  public pauseGame() {
    if (this.gameState === GameState.PLAYING) {
        this.gameState = GameState.PAUSED;
    }
  }

  public resumeGame() {
    if (this.gameState === GameState.PAUSED) {
        this.gameState = GameState.PLAYING;
        this.lastTime = performance.now(); // Prevent physics jump
    }
  }

  public restartGame() {
      // Reset Maps
      this.maps.clear();
      const initialMap = new UniverseMap();
      this.maps.set(initialMap.id, initialMap);
      this.loadMap(initialMap);

      // Reset Player
      this.player.position = { x: 0, y: 0 };
      this.player.velocity = { x: 0, y: 0 };
      this.player.health = this.player.maxHealth;
      this.player.trail = [];
      this.damageTexts = [];
      this.player.size = { x: SPRITE_CONSTANTS.PLAYER_BASE_SIZE, y: SPRITE_CONSTANTS.PLAYER_BASE_SIZE };
      
      this.camera.zoom = 1;
      this.camera.position = { x: 0, y: 0 };
      this.shakeTimer = 0;
      this.camera.shakeOffset = { x: 0, y: 0 };

      this.gameState = GameState.PLAYING;
      this.prepareFrameEntities();
  }

  public cycleWeapon() {
    if (this.gameState !== GameState.PLAYING) return;
    this.currentWeaponIndex = (this.currentWeaponIndex + 1) % WEAPON_LIST.length;
    const newWeapon = WEAPON_LIST[this.currentWeaponIndex];
    this.player.currentWeapon = newWeapon;
    this.player.burstQueue = 0;
  }

  private loop = (time: number) => {
    if (!this.isRunning) return;
    
    const frameTime = (time - this.lastTime) / 1000;
    this.lastTime = time;

    // Report stats
    this.onStatsUpdate({
      fps: Math.round(1000 / ((performance.now() - time) + 1)), 
      entityCount: (this.currentMap?.entities.length || 0) + 1,
      currentMapName: this.currentMap?.name || 'Loading...',
      currentMapType: this.currentMap?.type || MapType.UNIVERSE,
      currentWeapon: WEAPONS[this.player.currentWeapon || WeaponType.BLASTER].name,
      gameState: this.gameState
    });

    if (this.gameState !== GameState.PLAYING) {
        // If paused or in menu, still draw (static frame) but skip updates
        this.draw();
        requestAnimationFrame(this.loop);
        return;
    }

    const safeFrameTime = Math.min(frameTime, 0.25);

    if (this.transition.active) {
        this.updateTransition(safeFrameTime);
        this.draw(); 
        requestAnimationFrame(this.loop);
        return;
    }

    // Refresh working set for physics/AI without reallocating each call
    this.prepareFrameEntities();
    this.accumulator += safeFrameTime;

    // Safety Cap: Don't run more than N physics steps per frame to avoid "spiral of death" lag
    let steps = 0;
    while (this.accumulator >= this.FIXED_DT && steps < PHYSICS_MAX_STEPS) {
        this.updatePhysics(this.FIXED_DT);
        this.accumulator -= this.FIXED_DT;
        steps++;
    }
    // If we're falling too far behind, just discard the accumulated time
    if (this.accumulator > this.FIXED_DT * PHYSICS_MAX_STEPS) {
        this.accumulator = 0;
    }
    
    this.updateGameLogic(safeFrameTime);
    // Include entities spawned during game logic (e.g., projectiles) before rendering
    this.prepareFrameEntities();
    this.draw();

    requestAnimationFrame(this.loop);
  };

  private prepareFrameEntities() {
      if (!this.currentMap) return;
      this.frameEntities.length = 0;
      const ents = this.currentMap.entities;
      for (let i = 0; i < ents.length; i++) {
          this.frameEntities.push(ents[i]);
      }
      this.frameEntities.push(this.player);
  }

  private updateTransition(dt: number) {
      this.transition.timer += dt;
      const t = Math.min(this.transition.timer / this.transition.duration, 1.0);
      
      const { TRANSITION_ZOOM_IN_FACTOR, TRANSITION_ZOOM_OUT_FACTOR } = CAMERA_CONSTANTS;

      if (this.transition.direction === 'IN') {
          this.camera.zoom = 1 + (TRANSITION_ZOOM_IN_FACTOR * t * t * t); 
      } else {
          this.camera.zoom = 1 - (TRANSITION_ZOOM_OUT_FACTOR * t * t * t);
      }

      if (t >= 1.0) {
          this.executeMapSwitch(this.transition.targetType, this.transition.targetId);
          this.camera.position = { ...this.player.position };
          this.transition.active = false;
          this.camera.zoom = 1.0;
      }
  }

  private handleScreenShake = (amount: number) => {
      // Prioritize larger shakes
      if (amount > this.shakeIntensity || this.shakeTimer <= 0) {
          this.shakeIntensity = amount;
          this.shakeTimer = CAMERA_CONSTANTS.SHAKE_DECAY;
      }
  }

  private updatePhysics(dt: number) {
      if (!this.currentMap) return;

      const allEntities = this.frameEntities;
      
      this.ai.update(dt, allEntities, this.player);

      this.physics.update(
        allEntities, 
        this.currentMap.type, 
        dt,
        this.spawnDamageText,
        this.handleEntityDeath,
        this.handleScreenShake
      );

      this.currentMap.entities.forEach(e => {
          if (e.isExploding && e.explosionTimer !== undefined) {
              e.explosionTimer -= dt;
              if (e.explosionTimer <= 0) {
                  e.active = false;
              }
          }
      });

      const newlyDestroyed = this.currentMap.entities.filter(e => !e.active && e.type === EntityType.ASTEROID);
      newlyDestroyed.forEach(ast => {
          if (ast.size.x > 15) {
              this.createAsteroidShards(ast);
          }
      });
      
      const config = ASTEROID_GENERATION_CONFIG[this.currentMap.type];
      const currentAsteroids = this.currentMap.entities.filter(e => e.type === EntityType.ASTEROID).length;
      if (currentAsteroids < config.count) {
          this.handleAsteroidRespawn(config);
      }

      // In-place compaction (Garbage Free)
      let writeIdx = 0;
      for (let i = 0; i < this.currentMap.entities.length; i++) {
          const ent = this.currentMap.entities[i];
          if (ent.active) {
              this.currentMap.entities[writeIdx++] = ent;
          }
      }
      this.currentMap.entities.length = writeIdx;
  }

  private handleEntityDeath = (entity: GameEntity) => {
      // Spawn Particles
      const numParticles = 8 + Math.floor(Math.random() * 5);
      const { LIFETIME_MIN, LIFETIME_MAX, SPEED_MIN, SPEED_MAX, SIZE_MIN, SIZE_MAX } = PARTICLE_CONSTANTS;
      
      for (let i = 0; i < numParticles; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);
          const size = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN);
          const life = LIFETIME_MIN + Math.random() * (LIFETIME_MAX - LIFETIME_MIN);

          this.currentMap?.entities.push({
              id: `part_${Date.now()}_${i}`,
              type: EntityType.PARTICLE,
              position: { x: entity.position.x, y: entity.position.y },
              velocity: { 
                  x: Math.cos(angle) * speed, 
                  y: Math.sin(angle) * speed 
              },
              size: { x: size, y: size },
              rotation: Math.random() * Math.PI * 2,
              color: entity.color || '#facc15', 
              active: true,
              health: 1,
              maxHealth: 1,
              lifetime: life,
              maxLifetime: life,
              mass: 0.1
          });
      }
  };

  private handleAsteroidRespawn(config: any) {
      for (let i=0; i<5; i++) { 
          const angle = Math.random() * Math.PI * 2;
          const dist = 500 + Math.random() * (config.radius - 500);
          const x = Math.cos(angle) * dist;
          const y = Math.sin(angle) * dist;

          let safe = true;
          const pois = this.currentMap?.entities.filter(e => e.type === EntityType.INTERACTABLE) || [];
          for (const p of pois) {
              const d2 = (x - p.position.x)**2 + (y - p.position.y)**2;
              const safeDist = (p.gravityRange || p.size.x) + 800; 
              if (d2 < safeDist**2) {
                  safe = false;
                  break;
              }
          }

          if (safe && this.currentMap) {
               const newAst = (this.currentMap as any).createAsteroid(x, y, 
                  config.minSize + Math.random() * (config.maxSize - config.minSize),
                  config.speedMultiplier
               );
               this.currentMap.entities.push(newAst);
               break; 
          }
      }
  }

  private updateGameLogic(dt: number) {
    if (!this.currentMap) return;

    // Update Shake
    if (this.shakeTimer > 0) {
        this.shakeTimer -= dt;
        const decay = Math.max(0, this.shakeTimer / CAMERA_CONSTANTS.SHAKE_DECAY); // Linear falloff
        const mag = this.shakeIntensity * decay;
        
        this.camera.shakeOffset = {
            x: (Math.random() - 0.5) * mag * 2,
            y: (Math.random() - 0.5) * mag * 2
        };

        if (this.shakeTimer <= 0) {
            this.camera.shakeOffset = { x: 0, y: 0 };
        }
    }

    if (this.interactionCooldown > 0) {
        this.interactionCooldown -= dt;
    }
    
    if (this.minimapDebounce > 0) {
        this.minimapDebounce -= dt;
    }

    // Auto-collapse minimap
    if (this.minimapExpanded) {
        this.minimapTimer -= dt;
        if (this.minimapTimer <= 0) {
            this.minimapExpanded = false;
        }
    }

    const moveDir = this.input.getMovementVector();
    this.player.inputVector = moveDir; // Debug visualization assignment
    
    const moveConfig = PLAYER_MOVEMENT_CONFIG[this.currentMap.type];
    const acc = moveConfig ? moveConfig.acceleration : PHYSICS_CONSTANTS.ACCELERATION;
    const maxSpeed = moveConfig ? moveConfig.maxSpeed : PHYSICS_CONSTANTS.MAX_SPEED;

    // Time-Scaled Input Acceleration
    // Input is applied per-frame (variable dt), so we must scale acceleration by dt
    // Normalized to 60fps (dt * 60)
    const timeScale = dt * 60;
    this.player.velocity.x += moveDir.x * acc * timeScale;
    this.player.velocity.y += moveDir.y * acc * timeScale;

    const currentSpeed = Math.sqrt(this.player.velocity.x**2 + this.player.velocity.y**2);
    if (currentSpeed > maxSpeed) {
        this.player.velocity.x = (this.player.velocity.x / currentSpeed) * maxSpeed;
        this.player.velocity.y = (this.player.velocity.y / currentSpeed) * maxSpeed;
    }

    if (this.player.trail) {
        for (let i = this.player.trail.length - 1; i >= 0; i--) {
            this.player.trail[i].lifetime -= dt;
            if (this.player.trail[i].lifetime <= 0) {
                this.player.trail.splice(i, 1);
            }
        }
    }

    const lastPos = this.player.trail && this.player.trail.length > 0 
        ? this.player.trail[this.player.trail.length - 1] 
        : null;
    
    if (!lastPos || ((this.player.position.x - lastPos.x)**2 + (this.player.position.y - lastPos.y)**2 > TRAIL_CONSTANTS.MIN_DISTANCE_SQ)) {
        this.player.trail = this.player.trail || [];
        this.player.trail.push({ 
            x: this.player.position.x, 
            y: this.player.position.y,
            lifetime: TRAIL_CONSTANTS.LIFETIME,
            maxLifetime: TRAIL_CONSTANTS.LIFETIME
        });
    }

    const mousePos = this.input.getMousePosition();
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    this.player.rotation = Math.atan2(mousePos.y - cy, mousePos.x - cx);

    const fireEvents = this.input.getFireEvents();
    fireEvents.forEach(evt => {
        const { SIZE, EXPANDED_SIZE, MARGIN } = MINIMAP_CONSTANTS;
        const currentSize = this.minimapExpanded ? EXPANDED_SIZE : SIZE;
        const mapX = MARGIN;
        const mapY = window.innerHeight - currentSize - MARGIN;

        if (evt.x >= mapX && evt.x <= mapX + currentSize &&
            evt.y >= mapY && evt.y <= mapY + currentSize) {
            
            if (this.minimapDebounce > 0) return;
            
            this.minimapExpanded = !this.minimapExpanded;
            this.minimapTimer = this.minimapExpanded ? 5.0 : 0; 
            this.minimapDebounce = 0.3; 
            return;
        }

        if (!this.minimapExpanded) {
            this.handleShooting(evt);
        }
    });

    if (this.player.weaponCooldown && this.player.weaponCooldown > 0) {
        this.player.weaponCooldown -= dt;
    }

    if (this.player.burstQueue && this.player.burstQueue > 0) {
        this.player.burstTimer = (this.player.burstTimer || 0) - dt;
        if (this.player.burstTimer <= 0) {
            this.player.burstQueue--;
            const config = WEAPONS[this.player.currentWeapon || WeaponType.BLASTER];
            this.player.burstTimer = config.burstDelay || 0.1;
            const targetX = this.player.position.x + Math.cos(this.player.rotation) * 100;
            const targetY = this.player.position.y + Math.sin(this.player.rotation) * 100;
            this.spawnProjectileFromConfig({x: targetX, y: targetY}, config);
        }
    }

    this.updateHomingProjectiles(dt);

    // Damage Text cleanup
    let dTextIdx = 0;
    for (let i = 0; i < this.damageTexts.length; i++) {
        const t = this.damageTexts[i];
        t.lifetime -= dt;
        t.position.x += t.velocity.x * dt;
        t.position.y += t.velocity.y * dt;
        if (t.lifetime > 0) {
            this.damageTexts[dTextIdx++] = t;
        }
    }
    this.damageTexts.length = dTextIdx;

    if (this.interactionCooldown <= 0) {
        const interactables = this.currentMap.entities.filter(e => e.type === EntityType.INTERACTABLE);
        for (const entity of interactables) {
            const dist = Math.sqrt(
                (this.player.position.x - entity.position.x) ** 2 +
                (this.player.position.y - entity.position.y) ** 2
            );

            if (dist < (entity.size.x / 2 + this.player.size.x)) {
                if (entity.targetMapId && entity.targetMapType) {
                    this.switchMap(entity.targetMapType, entity.targetMapId);
                    break; 
                }
            }
        }
    }

    this.camera.position.x = this.player.position.x;
    this.camera.position.y = this.player.position.y;
  }

  private spawnDamageText = (pos: Vector2, amount: number) => {
      const isCrit = amount > 3;
      this.damageTexts.push({
          id: `dmg_${Date.now()}_${Math.random()}`,
          position: { ...pos },
          text: Math.round(amount).toString(),
          velocity: { 
              x: (Math.random() - 0.5) * 10, 
              y: -DAMAGE_TEXT_CONSTANTS.SPEED 
          },
          lifetime: DAMAGE_TEXT_CONSTANTS.LIFETIME,
          maxLifetime: DAMAGE_TEXT_CONSTANTS.LIFETIME,
          color: isCrit ? DAMAGE_TEXT_CONSTANTS.CRIT_COLOR : DAMAGE_TEXT_CONSTANTS.COLOR,
          active: true
      });
  };

  private handleShooting(target: Vector2) {
      if (this.player.weaponCooldown && this.player.weaponCooldown > 0) return;
      const config = WEAPONS[this.player.currentWeapon || WeaponType.BLASTER];
      this.player.weaponCooldown = config.cooldown;

      if (config.type === WeaponType.BURST && config.burstCount) {
          this.player.burstQueue = config.burstCount - 1; 
          this.player.burstTimer = config.burstDelay;
      }

      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const worldX = this.player.position.x + (target.x - cx) / this.camera.zoom;
      const worldY = this.player.position.y + (target.y - cy) / this.camera.zoom;

      this.spawnProjectileFromConfig({x: worldX, y: worldY}, config);
  }

  private spawnProjectileFromConfig(target: Vector2, config: WeaponConfig) {
      const angle = Math.atan2(target.y - this.player.position.y, target.x - this.player.position.x);

      const recoilImpulse = (PROJECTILE_CONSTANTS.MASS * config.speed * config.recoil) / this.player.mass;
      this.player.velocity.x -= Math.cos(angle) * recoilImpulse;
      this.player.velocity.y -= Math.sin(angle) * recoilImpulse;

      const halfSpread = (config.spread * (Math.PI / 180)) / 2;

      for (let i = 0; i < config.count; i++) {
          let currentAngle = angle;
          if (config.count > 1) {
             const step = (halfSpread * 2) / (config.count - 1);
             currentAngle = (angle - halfSpread) + (step * i);
          } else if (config.spread > 0) {
             currentAngle += (Math.random() - 0.5) * (config.spread * (Math.PI / 180));
          }

          const vx = Math.cos(currentAngle) * config.speed;
          const vy = Math.sin(currentAngle) * config.speed;

          const pSize = { 
              x: config.size * 2.5, 
              y: config.size * 0.4
          };

          // Spawn slightly forward from the ship nose based on player size
          const muzzleOffset = SPRITE_CONSTANTS.PLAYER_BASE_SIZE * 0.6;
          const startX = this.player.position.x + Math.cos(currentAngle) * muzzleOffset;
          const startY = this.player.position.y + Math.sin(currentAngle) * muzzleOffset;

          this.currentMap?.entities.push({
              id: `proj_${Date.now()}_${i}`,
              type: EntityType.PROJECTILE,
              position: { x: startX, y: startY },
              velocity: { x: vx, y: vy },
              size: pSize,
              rotation: currentAngle,
              color: config.color,
              active: true,
              health: 1,
              maxHealth: 1,
              lifetime: config.lifetime,
              mass: PROJECTILE_CONSTANTS.MASS,
              damage: config.damage,
              homing: config.homing
          });
      }
  }

  private updateHomingProjectiles(dt: number) {
      if (!this.currentMap) return;
      // Filter-less optimization
      const entities = this.currentMap.entities;
      for (let i = 0; i < entities.length; i++) {
          const p = entities[i];
          if (p.active && p.type === EntityType.PROJECTILE && p.homing) {
             
              let target: GameEntity | null = null;
              let minDist = 400 * 400; 

              for (let j = 0; j < entities.length; j++) {
                  const e = entities[j];
                  if (e.active && (e.type === EntityType.ENEMY || e.type === EntityType.ASTEROID)) {
                      const d2 = (e.position.x - p.position.x)**2 + (e.position.y - p.position.y)**2;
                      if (d2 < minDist) {
                          minDist = d2;
                          target = e;
                      }
                  }
              }

              if (target) {
                  const desiredAngle = Math.atan2(target.position.y - p.position.y, target.position.x - p.position.x);
                  let angleDiff = desiredAngle - p.rotation;
                  
                  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

                  const turnRate = 5 * dt; 
                  if (Math.abs(angleDiff) < turnRate) {
                      p.rotation = desiredAngle;
                  } else {
                      p.rotation += Math.sign(angleDiff) * turnRate;
                  }

                  const speed = Math.sqrt(p.velocity.x**2 + p.velocity.y**2);
                  p.velocity.x = Math.cos(p.rotation) * speed;
                  p.velocity.y = Math.sin(p.rotation) * speed;
              }
          }
      }
  }

  private createAsteroidShards(parent: GameEntity) {
      const shardCount = 2 + Math.floor(Math.random() * 2);
      const newSize = parent.size.x / Math.sqrt(shardCount);
      const hp = newSize > 30 ? 2 : 1;

      for (let i = 0; i < shardCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 1 + Math.random() * 2;
          const vx = parent.velocity.x + Math.cos(angle) * speed;
          const vy = parent.velocity.y + Math.sin(angle) * speed;
          const points: Vector2[] = [];
          const numPoints = 5;
          for (let j = 0; j < numPoints; j++) {
             const a = (j / numPoints) * Math.PI * 2;
             const r = (newSize/2) * (0.6 + Math.random() * 0.4);
             points.push({x: Math.cos(a)*r, y: Math.sin(a)*r});
          }
          const offsetX = Math.cos(angle) * (newSize * 0.5);
          const offsetY = Math.sin(angle) * (newSize * 0.5);

          this.currentMap?.entities.push({
              id: `shard_${Date.now()}_${i}`,
              type: EntityType.ASTEROID,
              position: { x: parent.position.x + offsetX, y: parent.position.y + offsetY },
              velocity: { x: vx, y: vy },
              size: { x: newSize, y: newSize },
              rotation: Math.random() * Math.PI * 2,
              color: COLORS.ASTEROID,
              active: true,
              health: hp,
              maxHealth: hp,
              polygonPoints: points,
              mass: newSize,
              sprite: parent.sprite
          });
      }
  }

  private switchMap(type: MapType, id: string) {
      if (this.transition.active) return;
      console.log(`Starting transition to: ${id} (${type})`);
      const currentRank = MAP_RANK[this.currentMap?.type || MapType.UNIVERSE];
      const targetRank = MAP_RANK[type];

      this.transition.active = true;
      this.transition.timer = 0;
      this.transition.targetType = type;
      this.transition.targetId = id;
      this.transition.switched = false;
      this.transition.startZoom = this.camera.zoom;
      this.transition.direction = targetRank > currentRank ? 'IN' : 'OUT';
      this.interactionCooldown = 2.0; 
  }

  private executeMapSwitch(type: MapType, id: string) {
      console.log(`Executing Switch: ${id} (${type})`);
      const previousMapId = this.currentMap ? this.currentMap.id : null;
      let newMap: BaseMapLayer;
      
      if (this.maps.has(id)) {
          newMap = this.maps.get(id)!;
      } else {
          switch (type) {
              case MapType.UNIVERSE: newMap = new UniverseMap(); break;
              case MapType.SOLAR_SYSTEM: newMap = new SolarSystemMap(id, 'Solar System'); break;
              case MapType.LOCAL: newMap = new LocalMap(id, 'Local Sector'); break;
              case MapType.SUB_MAP: newMap = new SubMap(id, 'Station Interior'); break;
              default: newMap = new UniverseMap();
          }
          if (this.currentMap) newMap.parentId = this.currentMap.id;
          this.maps.set(id, newMap);
      }

      this.loadMap(newMap);
      this.player.trail = [];
      
      let spawnFound = false;
      if (previousMapId) {
          const gateway = newMap.entities.find(e => e.targetMapId === previousMapId);
          if (gateway) {
              const offsetAngle = Math.atan2(-gateway.velocity.y || 1, -gateway.velocity.x || 0); 
              const offsetDist = gateway.size.x + this.player.size.x + 50;
              this.player.position = {
                  x: gateway.position.x + Math.cos(offsetAngle) * offsetDist,
                  y: gateway.position.y + Math.sin(offsetAngle) * offsetDist
              };
              spawnFound = true;
          }
      }

      if (!spawnFound) {
         this.player.position = { ...newMap.playerSpawn };
      }
      this.player.velocity = { x: 0, y: 0 };
  }

  private loadMap(map: BaseMapLayer) {
      if (!map.initialized) {
          map.init();
      }
      this.currentMap = map;
      // Pre-calculate spatial grid for static tiles to avoid overhead in main loop
      this.physics.initializeStaticGrid(map.entities);
      this.renderer.setMapType(map.type);
  }

  private draw() {
      if (!this.currentMap) return;
      
      this.renderer.render(
          this.frameEntities, 
          this.camera, 
          this.currentMap.type,
          this.minimapExpanded, 
          this.damageTexts 
      );
  }
}
