

import { InputSystem } from './systems/InputSystem';
import { PhysicsSystem } from './systems/PhysicsSystem';
import { RenderSystem } from './systems/RenderSystem';
import { AISystem } from './systems/AISystem';
import { BaseMapLayer, UniverseMap } from './maps/MapClasses';
import { GameEntity, EntityType, EnemyRole, MapType, CameraState, EngineStats, Vector2, WeaponType, WeaponConfig, DamageText, GameState, ShardType, DropCompositionEntry } from '../types';
import { COLORS, PHYSICS_CONSTANTS, PROJECTILE_CONSTANTS, WEAPONS, WEAPON_LIST, MINIMAP_CONSTANTS, PLAYER_MOVEMENT_CONFIG, DAMAGE_TEXT_CONSTANTS, ASTEROID_GENERATION_CONFIG, TRAIL_CONSTANTS, PARTICLE_CONSTANTS, CAMERA_CONSTANTS, SPRITE_CONSTANTS, ENEMY_WEAPON, ENEMY_CONSTANTS, EXPLOSION_CONSTANTS, DIFFICULTY_SCALES, DIFFICULTY_STAT_SCALES, ENEMY_VARIANTS, ENEMY_ROLE, WAVE_CONSTANTS, generateWaveDef, DROP_CONFIG, STRUCTURE_CONSTANTS } from '../constants';
import { ASSETS } from '../assets';
import { FlowFieldGrid } from './systems/FlowFieldGrid';

/** Average two 6-digit hex colours component-wise. */
function blendHexColors(hexA: string, hexB: string): string {
    const rA = parseInt(hexA.slice(1, 3), 16), gA = parseInt(hexA.slice(3, 5), 16), bA = parseInt(hexA.slice(5, 7), 16);
    const rB = parseInt(hexB.slice(1, 3), 16), gB = parseInt(hexB.slice(3, 5), 16), bB = parseInt(hexB.slice(5, 7), 16);
    return `#${Math.round((rA + rB) / 2).toString(16).padStart(2, '0')}${Math.round((gA + gB) / 2).toString(16).padStart(2, '0')}${Math.round((bA + bB) / 2).toString(16).padStart(2, '0')}`;
}

export class GameEngine {
  private input: InputSystem;
  private physics: PhysicsSystem;
  private renderer: RenderSystem;
  private ai: AISystem;
  private flowField: FlowFieldGrid;
  
  private isRunning: boolean = false;
  private gameState: GameState = GameState.MENU;
  private lastTime: number = 0;
  
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
  
  private respawnTimer: number = 0;
  private difficultyLevel: number = 3;
  private enemyScale: number = 1;

  // Debug mode
  private debugMode: boolean = false;

  // Wave system
  private waveIndex: number = 0;
  private waveEnemyIds: Set<string> = new Set();
  private waveState: 'inactive' | 'active' | 'cleared' | 'complete' = 'inactive';
  private waveGraceTimer: number = 0;

  // Screen Shake State
  private shakeTimer: number = 0;
  private shakeIntensity: number = 0;

  // Tile regeneration — destroyed tiles waiting to respawn
  private pendingRegens: { entity: GameEntity; timer: number }[] = [];

  // Fast drop lookup — avoids scanning all ~22k map entities every frame
  private activeDrops: GameEntity[] = [];

  // Collision-based stick bonds — entities bond on contact and merge after threshold
  private stickBonds: Array<{ a: GameEntity; b: GameEntity; timer: number; threshold: number }> = [];
  // Counts down after thrust stops; trail keeps emitting with shrinking lifetimes during this window
  private trailDecayTimer: number = 0;
  private static readonly TRAIL_DECAY_DURATION = 0.6; // seconds

  public toggleDebug() {
    this.debugMode = !this.debugMode;
    this.renderer.setDebugMode(this.debugMode);
  }

  private onStatsUpdate: (stats: EngineStats) => void;

  constructor(onStatsUpdate: (stats: EngineStats) => void, difficultyLevel: number = 3) {
    this.onStatsUpdate = onStatsUpdate;
    const clamped = Math.min(3, Math.max(0, Math.round(difficultyLevel)));
    this.difficultyLevel = clamped;
    this.enemyScale = DIFFICULTY_SCALES[clamped] ?? 1;
    
    this.input = new InputSystem();
    this.physics = new PhysicsSystem();
    this.renderer = new RenderSystem();
    this.ai = new AISystem();
    this.flowField = new FlowFieldGrid();

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
      sprite: ASSETS.PLAYER_SHIP,
      fuel: 100,
      maxFuel: 100,
      gold: 0
    };

    this.camera = {
      position: { x: 0, y: 0 },
      zoom: CAMERA_CONSTANTS.DEFAULT_ZOOM,
      targetId: 'player',
      shakeOffset: { x: 0, y: 0 }
    };

    const initialMap = new UniverseMap();
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
    this.initWaveSystem();
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
      this.pendingRegens = [];
      this.activeDrops = [];
      this.trailDecayTimer = 0;
      this.loadMap(new UniverseMap());

      // Reset Player
      this.player.position = { x: 0, y: 0 };
      this.player.velocity = { x: 0, y: 0 };
      this.player.health = this.player.maxHealth;
      this.player.fuel = this.player.maxFuel;
      this.player.gold = 0;
      this.player.trail = [];
      this.damageTexts = [];
      this.player.size = { x: SPRITE_CONSTANTS.PLAYER_BASE_SIZE, y: SPRITE_CONSTANTS.PLAYER_BASE_SIZE };
      
      this.camera.zoom = CAMERA_CONSTANTS.DEFAULT_ZOOM;
      this.camera.position = { x: 0, y: 0 };
      this.shakeTimer = 0;
      this.camera.shakeOffset = { x: 0, y: 0 };

      this.gameState = GameState.PLAYING;
      this.initWaveSystem();
      this.prepareFrameEntities();
  }

  public cycleWeapon() {
    if (this.gameState !== GameState.PLAYING) return;
    this.currentWeaponIndex = (this.currentWeaponIndex + 1) % WEAPON_LIST.length;
    const newWeapon = WEAPON_LIST[this.currentWeaponIndex];
    this.player.currentWeapon = newWeapon;
    this.player.burstQueue = 0;
  }

  public setDifficulty(level: number) {
      const clamped = Math.min(3, Math.max(0, Math.round(level)));
      this.difficultyLevel = clamped;
      this.enemyScale = DIFFICULTY_SCALES[clamped] ?? 1;
      this.restartGame();
  }

  private loop = (time: number) => {
    if (!this.isRunning) return;
    
    const frameTime = (time - this.lastTime) / 1000;
    this.lastTime = time;

    // Report stats
    const wsMap: Record<string, 'active' | 'cleared' | 'complete'> = {
      inactive: 'active', active: 'active', cleared: 'cleared', complete: 'complete'
    };
    this.onStatsUpdate({
      fps: Math.round(1000 / ((performance.now() - time) + 1)),
      entityCount: (this.currentMap?.entities.length || 0) + 1,
      currentMapName: this.currentMap?.name || 'Loading...',
      currentMapType: this.currentMap?.type || MapType.UNIVERSE,
      currentWeapon: WEAPONS[this.player.currentWeapon || WeaponType.BLASTER].name,
      gameState: this.gameState,
      difficulty: this.difficultyLevel,
      waveNumber: this.waveIndex + 1,
      waveStatus: wsMap[this.waveState],
      waveGraceTimer: this.waveGraceTimer > 0 ? Math.ceil(this.waveGraceTimer) : undefined,
      debugMode: this.debugMode,
      weaponCount: this.currentWeaponIndex + 1,
      fuel: this.player.fuel,
      maxFuel: this.player.maxFuel,
      gold: this.player.gold
    });

    if (this.gameState !== GameState.PLAYING) {
        // If paused or in menu, still draw (static frame) but skip updates
        try { this.draw(); } catch (e) { console.error('[RenderSystem] draw error:', e); }
        requestAnimationFrame(this.loop);
        return;
    }

    // Cap dt to prevent physics explosion after tab switch / GPU stall
    const safeFrameTime = Math.min(frameTime, 0.05);

    // Refresh working set for physics/AI without reallocating each call
    this.prepareFrameEntities();

    // One physics step per rendered frame at the actual frame rate.
    // This eliminates the 1-vs-2 step alternation that caused visual jitter
    // with a fixed-timestep accumulator at 60 Hz display.
    try { this.updatePhysics(safeFrameTime); } catch (e) { console.error('[PhysicsSystem] update error:', e); }
    try { this.updateGameLogic(safeFrameTime); } catch (e) { console.error('[GameLogic] update error:', e); }
    // Include entities spawned during game logic (e.g., projectiles) before rendering
    this.prepareFrameEntities();
    try { this.draw(); } catch (e) { console.error('[RenderSystem] draw error:', e); }

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

  private handleEnemyShooting(dt: number) {
      if (!this.currentMap) return;
      const weapon = ENEMY_WEAPON;
      const rangeSq = ENEMY_CONSTANTS.VISION_RANGE * ENEMY_CONSTANTS.VISION_RANGE;

      for (let i = 0; i < this.currentMap.entities.length; i++) {
          const enemy = this.currentMap.entities[i];
          if (!enemy.active || enemy.type !== EntityType.ENEMY) continue;
          if (!enemy.enemySubtype || ENEMY_ROLE[enemy.enemySubtype] !== EnemyRole.SHOOTING) continue;

          // Cooldown management
          enemy.weaponCooldown = Math.max(0, (enemy.weaponCooldown || 0) - dt);
          if (enemy.weaponCooldown > 0) continue;

          const dx = this.player.position.x - enemy.position.x;
          const dy = this.player.position.y - enemy.position.y;
          const distSq = dx*dx + dy*dy;
          if (distSq > rangeSq) continue;

          // Slight inaccuracy
          const leadAngle = Math.atan2(dy, dx) + (Math.random() - 0.5) * (weapon.spread * Math.PI / 180);
          const targetX = enemy.position.x + Math.cos(leadAngle) * 500;
          const targetY = enemy.position.y + Math.sin(leadAngle) * 500;

          enemy.weaponCooldown = weapon.cooldown;
          this.spawnProjectileFromConfig(enemy, { x: targetX, y: targetY }, weapon, EntityType.ENEMY);
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

      // Rebuild the enemy pursuit field if the player changed grid cells.
      this.flowField.scheduleEnemyRebuild(this.player.position.x, this.player.position.y);
      this.flowField.flushEnemyField();

      this.ai.update(dt, allEntities, this.player, this.flowField);
      this.handleEnemyShooting(dt);

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

      // Single pass: collect destroyed asteroids + count all, avoiding two filter() allocations.
      // createAsteroidShards() pushes to entities so we must collect before iterating.
      const config = ASTEROID_GENERATION_CONFIG[MapType.UNIVERSE];
      const newlyDestroyed: GameEntity[] = [];
      let currentAsteroidCount = 0;
      for (let i = 0; i < this.currentMap.entities.length; i++) {
          const e = this.currentMap.entities[i];
          if (e.type !== EntityType.ASTEROID) continue;
          currentAsteroidCount++;
          if (!e.active) newlyDestroyed.push(e);
      }
      for (const ast of newlyDestroyed) {
          if (ast.size.x > ASTEROID_GENERATION_CONFIG[MapType.UNIVERSE].minSize) this.createAsteroidShards(ast);
      }
      if (currentAsteroidCount < config.count) {
          this.handleAsteroidRespawn(config);
      }

      // Flow-field nudge: steer each asteroid toward the grid flow direction.
      // Elastic correction rate: asteroids near the target speed get a gentle
      // 8 %/s nudge; asteroids that have been slowed by collisions receive up
      // to 9× stronger correction so they re-enter the stream quickly without
      // any hard velocity override (no teleporting).
      const FLOW_CORRECTION  = 0.08;
      const FLOW_TARGET_SPEED = config.speedMultiplier;
      const entities = this.currentMap.entities;
      for (let i = 0; i < entities.length; i++) {
          const e = entities[i];
          const isDropShard = e.type === EntityType.INTERACTABLE && !!e.dropType;
          if ((e.type !== EntityType.ASTEROID && !isDropShard) || !e.active) continue;
          const flow = this.flowField.sampleAsteroidFlow(e.position.x, e.position.y);
          const tx = flow.x * FLOW_TARGET_SPEED;
          const ty = flow.y * FLOW_TARGET_SPEED;
          const speed   = Math.sqrt(e.velocity.x * e.velocity.x + e.velocity.y * e.velocity.y);
          const urgency = 1 + 8 * Math.max(0, 1 - speed / FLOW_TARGET_SPEED);
          const alpha   = Math.min(0.8, FLOW_CORRECTION * dt * urgency);
          e.velocity.x += (tx - e.velocity.x) * alpha;
          e.velocity.y += (ty - e.velocity.y) * alpha;
          if (e.rotationSpeed) e.rotation += e.rotationSpeed * dt;
      }

      // Gentle flow-field current on the player — adds a subtle drift bias in

      // Mild mutual gravity — pulls nearby asteroids and collectible drops together,
      // causing gradual clustering as they drift through the flow field.
      // Glass shards are purely debris and excluded.
      // Spatial grid (cell = interaction radius) reduces O(n²) pairs to O(n·k)
      // where k is the local candidate density — typically 1–5 vs. all candidates.
      const GRAV_G        = 2.5;
      const GRAV_RANGE    = 120;
      const GRAV_RANGE_SQ = GRAV_RANGE * GRAV_RANGE;
      const GRAV_MIN_SQ   = 12 * 12;

      const gravCandidates: GameEntity[] = [this.player];
      for (let i = 0; i < entities.length; i++) {
          const e = entities[i];
          if (!e.active) continue;
          if (e.type === EntityType.ASTEROID) { gravCandidates.push(e); continue; }
          if (e.type === EntityType.INTERACTABLE && e.dropType && e.dropType !== 'glass') {
              gravCandidates.push(e);
          }
      }

      // Bucket candidate indices by grid cell
      const gravGrid = new Map<number, number[]>();
      for (let i = 0; i < gravCandidates.length; i++) {
          const e = gravCandidates[i];
          const cx = Math.floor(e.position.x / GRAV_RANGE);
          const cy = Math.floor(e.position.y / GRAV_RANGE);
          const key = (cx << 16) | (cy & 0xFFFF);
          let cell = gravGrid.get(key);
          if (!cell) { cell = []; gravGrid.set(key, cell); }
          cell.push(i);
      }

      // Check only same + 8 neighbouring cells; j > i ensures each pair is processed once
      for (let i = 0; i < gravCandidates.length; i++) {
          const a = gravCandidates[i];
          const acx = Math.floor(a.position.x / GRAV_RANGE);
          const acy = Math.floor(a.position.y / GRAV_RANGE);
          for (let ncx = acx - 1; ncx <= acx + 1; ncx++) {
              for (let ncy = acy - 1; ncy <= acy + 1; ncy++) {
                  const cell = gravGrid.get((ncx << 16) | (ncy & 0xFFFF));
                  if (!cell) continue;
                  for (let k = 0; k < cell.length; k++) {
                      const j = cell[k];
                      if (j <= i) continue;
                      const b = gravCandidates[j];
                      const dx = b.position.x - a.position.x;
                      const dy = b.position.y - a.position.y;
                      const distSq = dx * dx + dy * dy;
                      if (distSq > GRAV_RANGE_SQ) continue;
                      const effSq = Math.max(distSq, GRAV_MIN_SQ);
                      const f    = GRAV_G / effSq;
                      const fx   = dx * f;
                      const fy   = dy * f;
                      a.velocity.x += fx * dt;
                      a.velocity.y += fy * dt;
                      b.velocity.x -= fx * dt;
                      b.velocity.y -= fy * dt;
                  }
              }
          }
      }

      // Stick bonds: detect contact and merge entities after threshold
      this.handleEntitySticking(dt);

      // In-place compaction (Garbage Free)
      // Inactive tiles with regenProgress set are kept as ghost placeholders.
      let writeIdx = 0;
      for (let i = 0; i < this.currentMap.entities.length; i++) {
          const ent = this.currentMap.entities[i];
          if (ent.active || (ent.type === EntityType.STRUCTURE && ent.regenProgress !== undefined)) {
              this.currentMap.entities[writeIdx++] = ent;
          }
      }
      this.currentMap.entities.length = writeIdx;
  }

  private handleEntityDeath = (entity: GameEntity) => {
      if (entity.type === EntityType.PLAYER || entity.type === EntityType.ENEMY) {
          this.startExplosion(entity);
      }

      if (entity.type === EntityType.STRUCTURE) {
          this.flowField.onTileDestroyed(entity.position.x, entity.position.y);
          // Queue for regeneration; entity stays in the map entities list as
          // an inactive ghost so we can render an outline during regen.
          entity.regenProgress = 0;
          this.pendingRegens.push({ entity, timer: STRUCTURE_CONSTANTS.TILE_REGEN_DELAY });
      }

      // Spawn Particles
      const numParticles = 4 + Math.floor(Math.random() * 3);
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

      this.spawnDrops(entity);
  };

  private handleAsteroidRespawn(config: any) {
      // Collect POIs once outside the placement-attempt loop.
      const pois = this.currentMap?.entities.filter(e => e.type === EntityType.INTERACTABLE) || [];
      for (let i=0; i<5; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 500 + Math.random() * (config.radius - 500);
          const x = Math.cos(angle) * dist;
          const y = Math.sin(angle) * dist;

          let safe = true;
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

    // Tile regeneration tick
    for (let i = this.pendingRegens.length - 1; i >= 0; i--) {
        const regen = this.pendingRegens[i];
        regen.timer -= dt;
        regen.entity.regenProgress = 1 - (regen.timer / STRUCTURE_CONSTANTS.TILE_REGEN_DELAY);

        if (regen.timer <= 0) {
            // Restore tile to full health and re-add to physics static grid
            regen.entity.health = regen.entity.maxHealth;
            regen.entity.active = true;
            regen.entity.regenProgress = undefined;
            this.physics.addStaticEntity(regen.entity);
            this.pendingRegens.splice(i, 1);
        }
    }

    // Death handling
    if (this.player.health <= 0 && !this.player.isExploding) {
        this.handleEntityDeath(this.player);
    }

    if (this.player.isExploding) {
        if (this.player.explosionTimer !== undefined) {
            this.player.explosionTimer -= dt;
            if (this.player.explosionTimer <= 0) {
                this.respawnPlayer();
            }
        }
        this.camera.position.x = this.player.position.x;
        this.camera.position.y = this.player.position.y;
        return; // Skip controls while exploding
    }

    // Wave completion check
    if (this.waveState === 'active' && this.currentMap) {
      const entities = this.currentMap.entities;
      let allDead = true;
      for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (this.waveEnemyIds.has(e.id) && e.active && !e.isExploding) {
          allDead = false;
          break;
        }
      }
      if (allDead) {
        this.waveState = 'cleared';
        const waveDef = generateWaveDef(this.waveIndex);

        // Auto-grant weapon unlock (only first 18 hand-authored waves carry powerups)
        if (waveDef.powerup !== null) {
          this.player.currentWeapon = waveDef.powerup;
          this.currentWeaponIndex = WEAPON_LIST.indexOf(waveDef.powerup);
          this.player.burstQueue = 0;
          this.damageTexts.push({
            id: `unlock_${Date.now()}`,
            position: { ...this.player.position },
            text: WEAPONS[waveDef.powerup].name + ' Unlocked!',
            velocity: { x: 0, y: -DAMAGE_TEXT_CONSTANTS.SPEED },
            lifetime: 2.5,
            maxLifetime: 2.5,
            color: WEAPONS[waveDef.powerup].color,
            active: true,
          });
        }

        // Always start the grace period — waves are infinite
        this.waveGraceTimer = WAVE_CONSTANTS.GRACE_PERIOD;
      }
    }

    // Grace period countdown — spawn next wave when timer expires (infinite)
    if (this.waveState === 'cleared' && this.waveGraceTimer > 0) {
      this.waveGraceTimer -= dt;
      if (this.waveGraceTimer <= 0) {
        this.waveGraceTimer = 0;
        this.spawnWave(this.waveIndex + 1);
      }
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
    const hasFuel = (this.player.fuel ?? 0) > 0;
    if (hasFuel) {
        this.player.velocity.x += moveDir.x * acc * timeScale;
        this.player.velocity.y += moveDir.y * acc * timeScale;
    }

    // Drain fuel proportional to throttle magnitude (0 at rest, full rate at full throttle)
    const throttle = Math.sqrt(moveDir.x * moveDir.x + moveDir.y * moveDir.y);
    if (throttle > 0 && hasFuel) {
        this.player.fuel = Math.max(0, (this.player.fuel ?? 0) - DROP_CONFIG.FUEL_DRAIN_RATE * throttle * dt);
    }

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

    const thrusting = hasFuel && throttle > 0;
    if (thrusting) {
        this.trailDecayTimer = GameEngine.TRAIL_DECAY_DURATION;
    } else {
        this.trailDecayTimer = Math.max(0, this.trailDecayTimer - dt);
    }

    const lastPos = this.player.trail && this.player.trail.length > 0
        ? this.player.trail[this.player.trail.length - 1]
        : null;

    if (this.trailDecayTimer > 0 &&
            (!lastPos || ((this.player.position.x - lastPos.x)**2 + (this.player.position.y - lastPos.y)**2 > TRAIL_CONSTANTS.MIN_DISTANCE_SQ))) {
        // t: 1.0 while thrusting, tapers to 0 over the decay window.
        // Lifetime shrinks so points vanish sooner; scale shrinks so they start narrower.
        const t = this.trailDecayTimer / GameEngine.TRAIL_DECAY_DURATION;
        const pointLifetime = TRAIL_CONSTANTS.LIFETIME * t;
        this.player.trail = this.player.trail || [];
        this.player.trail.push({
            x: this.player.position.x,
            y: this.player.position.y,
            lifetime: pointLifetime,
            maxLifetime: pointLifetime,
            scale: t,
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
            this.spawnProjectileFromConfig(this.player, {x: targetX, y: targetY}, config, EntityType.PLAYER);
        }
    }

    this.updateHomingProjectiles(dt);
    this.updateProjectileTrails(dt);

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

    // Remove drops that were deactivated (shot by player).
    // Collection is now triggered by player projectile hits, not magnetic contact.
    let dropWriteIdx = 0;
    for (let i = 0; i < this.activeDrops.length; i++) {
        if (this.activeDrops[i].active) this.activeDrops[dropWriteIdx++] = this.activeDrops[i];
    }
    this.activeDrops.length = dropWriteIdx;


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

  private startExplosion(entity: GameEntity) {
      if (entity.isExploding) return;

      const baseSize = Math.max(entity.size.x, entity.size.y);
      const sizeMultiplier = Math.abs(EXPLOSION_CONSTANTS.SIZE_MULTIPLIER || 1.5);

      entity.isExploding = true;
      entity.explosionTimer = EXPLOSION_CONSTANTS.DURATION;
      entity.sprite = ASSETS.EXPLOSION;
      entity.size = { x: baseSize * sizeMultiplier, y: baseSize * sizeMultiplier };
      entity.velocity = { x: 0, y: 0 };
      entity.hitFlash = 0;
      entity.active = true; // Keep active so it renders during explosion
  }

  private respawnPlayer() {
      const spawn = this.currentMap?.playerSpawn || { x: 0, y: 0 };
      this.player.isExploding = false;
      this.player.explosionTimer = undefined;
      this.player.health = this.player.maxHealth;
      this.player.active = true;
      this.player.sprite = ASSETS.PLAYER_SHIP;
      this.player.size = { x: SPRITE_CONSTANTS.PLAYER_BASE_SIZE, y: SPRITE_CONSTANTS.PLAYER_BASE_SIZE };
      this.player.position = { ...spawn };
      this.player.velocity = { x: 0, y: 0 };
      this.player.rotation = 0;
      this.player.trail = [];
      this.trailDecayTimer = 0;
      this.player.weaponCooldown = 0;
      this.player.burstQueue = 0;
      this.player.burstTimer = 0;
      this.shakeTimer = 0;
      this.camera.shakeOffset = { x: 0, y: 0 };
      this.camera.position = { ...this.player.position };
  }

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

      this.spawnProjectileFromConfig(this.player, {x: worldX, y: worldY}, config, EntityType.PLAYER);
  }

  private spawnProjectileFromConfig(shooter: GameEntity, target: Vector2, config: WeaponConfig, ownerType: EntityType) {
      const angle = Math.atan2(target.y - shooter.position.y, target.x - shooter.position.x);

      // Only apply recoil to player for now
      if (ownerType === EntityType.PLAYER) {
          const recoilImpulse = (PROJECTILE_CONSTANTS.MASS * config.speed * config.recoil) / (shooter.mass || 1);
          shooter.velocity.x -= Math.cos(angle) * recoilImpulse;
          shooter.velocity.y -= Math.sin(angle) * recoilImpulse;
      }

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

          // Spawn slightly forward from the ship nose based on entity size
          const muzzleBase = Math.max(shooter.size?.x || SPRITE_CONSTANTS.PLAYER_BASE_SIZE, shooter.size?.y || SPRITE_CONSTANTS.PLAYER_BASE_SIZE);
          const muzzleOffset = muzzleBase * 0.6;
          const startX = shooter.position.x + Math.cos(currentAngle) * muzzleOffset;
          const startY = shooter.position.y + Math.sin(currentAngle) * muzzleOffset;

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
              maxLifetime: config.lifetime,
              mass: PROJECTILE_CONSTANTS.MASS,
              damage: config.damage,
              homing: config.homing,
              ownerType,
              pierceCount: config.pierce,
              trail: [],
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
                  if (e.active && e.type === EntityType.ENEMY) {
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

  private updateProjectileTrails(dt: number) {
      if (!this.currentMap) return;
      const entities = this.currentMap.entities;
      const TRAIL_LIFETIME = 0.25; // shorter than player trail
      const TRAIL_SCALE = 0.5;
      const MIN_DIST_SQ = TRAIL_CONSTANTS.MIN_DISTANCE_SQ;

      for (let i = 0; i < entities.length; i++) {
          const p = entities[i];
          if (!p.active || p.type !== EntityType.PROJECTILE) continue;

          // Decay existing trail points (write-index avoids O(n) splice shifts)
          if (p.trail) {
              let writeIdx = 0;
              for (let j = 0; j < p.trail.length; j++) {
                  p.trail[j].lifetime -= dt;
                  if (p.trail[j].lifetime > 0) {
                      p.trail[writeIdx++] = p.trail[j];
                  }
              }
              p.trail.length = writeIdx;
          } else {
              p.trail = [];
          }

          // Add new trail point if far enough from last
          const t = p.trail;
          const lastPos = t.length > 0 ? t[t.length - 1] : null;
          const dx = p.position.x - (lastPos?.x ?? p.position.x - 1);
          const dy = p.position.y - (lastPos?.y ?? p.position.y - 1);
          if (!lastPos || (dx * dx + dy * dy > MIN_DIST_SQ)) {
              t.push({
                  x: p.position.x,
                  y: p.position.y,
                  lifetime: TRAIL_LIFETIME,
                  maxLifetime: TRAIL_LIFETIME,
                  scale: TRAIL_SCALE,
              });
          }
      }
  }

  // ─── Collision-based stick bonds ───────────────────────────────────────────
  // Entities bond only on physical contact. While bonded their velocities are
  // nudged toward shared momentum. After the threshold duration they merge.
  // Bonds break if entities drift apart beyond 1.5× contact distance.

  private handleEntitySticking(dt: number) {
      if (!this.currentMap) return;

      const SAME_THRESHOLD = 1.0;   // base seconds for min-size pair (same type)
      const DIFF_THRESHOLD = 2.0;   // base seconds for min-size pair (cross type)
      const SIZE_REF       = 20;    // reference size (min asteroid diameter)
      const SIZE_POWER     = 1.5;   // exponent — small bodies merge fast, large ones slowly
      const DIFF_CHANCE    = 0.5;   // probability that a cross-type contact forms a bond
      const COHESION       = 4.0;   // fraction of velocity delta corrected per second
      const BREAK_FACTOR   = 1.5;   // bond breaks when dist > contactDist * this
      const CONTACT_BUFFER = 4;     // extra pixel tolerance for contact detection

      // ── 1. Update existing bonds ──────────────────────────────────────────
      const bonded = new Set<GameEntity>();
      let writeIdx = 0;

      for (let bi = 0; bi < this.stickBonds.length; bi++) {
          const bond = this.stickBonds[bi];
          const { a, b } = bond;

          if (!a.active || !b.active) continue; // discard silently

          const dx = b.position.x - a.position.x;
          const dy = b.position.y - a.position.y;
          const dist       = Math.sqrt(dx * dx + dy * dy);
          const contactDist = (a.size.x + b.size.x) * 0.5;

          if (dist > contactDist * BREAK_FACTOR) continue; // bond broken — discard

          // Velocity cohesion: nudge both toward shared momentum centre
          const totalMass = a.mass + b.mass;
          const sharedVx  = (a.velocity.x * a.mass + b.velocity.x * b.mass) / totalMass;
          const sharedVy  = (a.velocity.y * a.mass + b.velocity.y * b.mass) / totalMass;
          const blend     = Math.min(1, COHESION * dt);
          a.velocity.x   += (sharedVx - a.velocity.x) * blend;
          a.velocity.y   += (sharedVy - a.velocity.y) * blend;
          b.velocity.x   += (sharedVx - b.velocity.x) * blend;
          b.velocity.y   += (sharedVy - b.velocity.y) * blend;

          bond.timer += dt;

          if (bond.timer >= bond.threshold) {
              // Time's up — merge and discard bond
              this.mergeEntities(a, b);
              continue;
          }

          // Keep bond alive
          this.stickBonds[writeIdx++] = bond;
          bonded.add(a);
          bonded.add(b);
      }
      this.stickBonds.length = writeIdx;

      // ── 2. Detect new contacts via spatial grid ───────────────────────────
      // Candidates: active asteroids + eligible drops (no glass/powerup)
      const candidates: GameEntity[] = [];
      const entities = this.currentMap.entities;
      for (let i = 0; i < entities.length; i++) {
          const e = entities[i];
          if (e.active && e.type === EntityType.ASTEROID) candidates.push(e);
      }
      for (let i = 0; i < this.activeDrops.length; i++) {
          const d = this.activeDrops[i];
          if (d.active && d.dropType !== 'glass' && d.dropType !== 'powerup') candidates.push(d);
      }
      if (candidates.length < 2) return;

      // Cell size: must cover the widest possible contact distance.
      // Max asteroid = 200, max drop ≈ 30 → max contactDist ≈ (200+200)/2 + buffer = 104 → use 110.
      const CELL = 110;
      const grid  = new Map<number, number[]>();
      for (let i = 0; i < candidates.length; i++) {
          const c  = candidates[i];
          const cx = Math.floor(c.position.x / CELL);
          const cy = Math.floor(c.position.y / CELL);
          const key = (cx << 16) | (cy & 0xFFFF);
          let cell  = grid.get(key);
          if (!cell) { cell = []; grid.set(key, cell); }
          cell.push(i);
      }

      for (let i = 0; i < candidates.length; i++) {
          const a = candidates[i];
          if (!a.active || bonded.has(a)) continue;

          const acx = Math.floor(a.position.x / CELL);
          const acy = Math.floor(a.position.y / CELL);

          for (let ncx = acx - 1; ncx <= acx + 1; ncx++) {
              for (let ncy = acy - 1; ncy <= acy + 1; ncy++) {
                  const cell = grid.get((ncx << 16) | (ncy & 0xFFFF));
                  if (!cell) continue;
                  for (let k = 0; k < cell.length; k++) {
                      const j = cell[k];
                      if (j <= i) continue;
                      const b = candidates[j];
                      if (!b.active || bonded.has(b)) continue;

                      const dx = b.position.x - a.position.x;
                      const dy = b.position.y - a.position.y;
                      const distSq      = dx * dx + dy * dy;
                      const contactDist = (a.size.x + b.size.x) * 0.5 + CONTACT_BUFFER;
                      if (distSq > contactDist * contactDist) continue;

                      // Same type: ast+ast with same shardType, or drop+drop with same dropType
                      const sameType =
                          (a.type === EntityType.ASTEROID && b.type === EntityType.ASTEROID &&
                           (a.shardType ?? 'asteroid') === (b.shardType ?? 'asteroid')) ||
                          (a.type !== EntityType.ASTEROID && b.type !== EntityType.ASTEROID &&
                           a.dropType === b.dropType);

                      if (!sameType && Math.random() > DIFF_CHANCE) continue;

                      // Threshold scales with average entity size: small pairs merge quickly,
                      // large ones take significantly longer.
                      // e.g. size 20→1s, size 50→4s, size 100→11s, size 200→32s (same type)
                      const avgSize   = (a.size.x + b.size.x) * 0.5;
                      const sizeRatio = Math.max(1, avgSize / SIZE_REF);
                      const baseTime  = sameType ? SAME_THRESHOLD : DIFF_THRESHOLD;
                      const threshold = baseTime * Math.pow(sizeRatio, SIZE_POWER);
                      this.stickBonds.push({ a, b, timer: 0, threshold });
                      bonded.add(a);
                      bonded.add(b);
                  }
              }
          }
      }
  }

  // ─── Merge two bonded entities ──────────────────────────────────────────────
  // Handles: asteroid+asteroid, drop+drop (same/different type), asteroid+drop.

  private mergeEntities(a: GameEntity, b: GameEntity) {
      if (!a.active || !b.active) return;

      const totalMass = a.mass + b.mass;
      const nvx = (a.velocity.x * a.mass + b.velocity.x * b.mass) / totalMass;
      const nvy = (a.velocity.y * a.mass + b.velocity.y * b.mass) / totalMass;
      const nmx = (a.position.x * a.mass + b.position.x * b.mass) / totalMass;
      const nmy = (a.position.y * a.mass + b.position.y * b.mass) / totalMass;

      const aIsAst = a.type === EntityType.ASTEROID;
      const bIsAst = b.type === EntityType.ASTEROID;

      if (aIsAst && bIsAst) {
          // Asteroid + Asteroid — area-conserving accretion
          const MAX_HP   = 6;
          const rA = a.size.x / 2;
          const rB = b.size.x / 2;
          const newDiam = Math.sqrt(rA * rA + rB * rB) * 2;

          // Larger entity by area dominates shardType; blend glow colors
          const dominant: ShardType = (rA >= rB ? a.shardType : b.shardType) ?? 'asteroid';
          const glowA = a.powerupGlowColor;
          const glowB = b.powerupGlowColor;
          const newGlow = glowA && glowB ? blendHexColors(glowA, glowB) : (glowA ?? glowB);

          const composition: DropCompositionEntry[] = [
              ...(a.dropComposition ?? []),
              ...(b.dropComposition ?? []),
          ];

          // Regenerate polygon at new size; keep blocky for tile, jagged for asteroid
          const isTile  = dominant === 'tile';
          const numPts  = isTile ? (4 + Math.floor(Math.random() * 3)) : (7 + Math.floor(Math.random() * 4));
          const jitterK = isTile ? 0.25 : 0.7;
          const rMin    = isTile ? 0.60 : 0.60;
          const rRange  = isTile ? 0.55 : 0.65;
          const baseR   = (newDiam / 2) * 0.82;
          const rawPts: { angle: number; r: number }[] = [];
          for (let pi = 0; pi < numPts; pi++) {
              const base   = (pi / numPts) * Math.PI * 2;
              const jitter = (Math.random() - 0.5) * (Math.PI / numPts) * jitterK;
              rawPts.push({ angle: base + jitter, r: baseR * (rMin + Math.random() * rRange) });
          }
          rawPts.sort((pa, pb) => pa.angle - pb.angle);
          a.polygonPoints = rawPts.map(p => ({ x: Math.cos(p.angle) * p.r, y: Math.sin(p.angle) * p.r }));

          a.shardType        = dominant;
          a.powerupGlowColor = newGlow;
          // Blend color toward dominant when merging cross-type
          if (a.shardType !== b.shardType) a.color = blendHexColors(a.color, b.color);
          a.size.x = newDiam; a.size.y = newDiam;
          a.mass   = newDiam;
          a.position.x = nmx; a.position.y = nmy;
          a.velocity.x = nvx; a.velocity.y = nvy;
          a.health     = Math.min(MAX_HP, a.health + b.health);
          a.maxHealth  = Math.min(MAX_HP, a.maxHealth + b.maxHealth);
          a.dropComposition = composition.length > 0 ? composition : undefined;
          b.active = false;

      } else if (!aIsAst && !bIsAst) {
          // Drop + Drop
          if (a.dropType === b.dropType) {
              // Same type — grow the drop (area-conserving: new_r = sqrt(rA² + rB²))
              a.dropValue  = (a.dropValue ?? 0) + (b.dropValue ?? 0);
              const rda    = a.size.x / 2;
              const rdb    = b.size.x / 2;
              const newR   = Math.sqrt(rda * rda + rdb * rdb) * 2;
              a.size.x     = newR; a.size.y = newR;
              a.position.x = nmx;  a.position.y = nmy;
              a.velocity.x = nvx;  a.velocity.y = nvy;
              b.active = false;
          } else {
              // Different types — collapse into a composite asteroid
              this.spawnCompositeAsteroid(a, b, nmx, nmy, nvx, nvy);
              a.active = false;
              b.active = false;
          }

      } else {
          // Asteroid + Drop — asteroid absorbs the drop payload and takes on its glow color
          const ast  = aIsAst ? a : b;
          const drop = aIsAst ? b : a;
          const comp: DropCompositionEntry[] = [...(ast.dropComposition ?? [])];

          // Color keyed to drop type — matches what the renderer uses for drop glows
          const DROP_COLORS: Partial<Record<string, string>> = {
              fuel:   '#00e5ff',
              gold:   '#ffd700',
              health: '#4ade80',
          };

          if (drop.dropType === 'powerup' && drop.dropWeapon !== undefined) {
              comp.push({ type: 'powerup', value: drop.dropValue ?? 1, weapon: drop.dropWeapon });
              const wColor = WEAPONS[drop.dropWeapon]?.color ?? '#ffffff';
              ast.powerupGlowColor = ast.powerupGlowColor
                  ? blendHexColors(ast.powerupGlowColor, wColor)
                  : wColor;
          } else if (drop.dropType && drop.dropType !== 'glass') {
              comp.push({ type: drop.dropType as 'fuel' | 'gold' | 'health', value: drop.dropValue ?? 1 });
              const dColor = DROP_COLORS[drop.dropType];
              if (dColor) {
                  ast.powerupGlowColor = ast.powerupGlowColor
                      ? blendHexColors(ast.powerupGlowColor, dColor)
                      : dColor;
              }
          }

          ast.dropComposition = comp.length > 0 ? comp : undefined;
          ast.velocity.x = nvx; ast.velocity.y = nvy;
          drop.active = false;
      }
  }

  private spawnCompositeAsteroid(
      dropA: GameEntity, dropB: GameEntity,
      mx: number, my: number, mvx: number, mvy: number
  ) {
      if (!this.currentMap) return;

      const ra      = dropA.size.x / 2;
      const rb      = dropB.size.x / 2;
      // Area-conserving: new area = area_A + area_B → new_radius = sqrt(ra² + rb²)
      const newSize = Math.sqrt(ra * ra + rb * rb) * 2;
      const hp      = Math.max(1, Math.round(newSize / 20));

      // Irregular polygon (same approach as normal asteroids)
      const numPts = 9 + Math.floor(Math.random() * 4);
      const baseR  = (newSize / 2) * 0.82;
      const rawPts: { angle: number; r: number }[] = [];
      for (let i = 0; i < numPts; i++) {
          const base   = (i / numPts) * Math.PI * 2;
          const jitter = (Math.random() - 0.5) * (Math.PI / numPts) * 0.65;
          rawPts.push({ angle: base + jitter, r: baseR * (0.75 + Math.random() * 0.5) });
      }
      rawPts.sort((a, b) => a.angle - b.angle);
      const points = rawPts.map(p => ({
          x: Math.cos(p.angle) * p.r,
          y: Math.sin(p.angle) * p.r,
      }));

      this.currentMap.entities.push({
          id:            `composite_${Date.now()}_${Math.random()}`,
          type:          EntityType.ASTEROID,
          shardType:    'asteroid',
          position:      { x: mx, y: my },
          velocity:      { x: mvx, y: mvy },
          size:          { x: newSize, y: newSize },
          rotation:      Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * (1.5 / (newSize / 20)),
          color:         blendHexColors(dropA.color, dropB.color),
          active:        true,
          health:        hp,
          maxHealth:     hp,
          mass:          newSize,
          polygonPoints: points,
          dropComposition: [
              { type: dropA.dropType as 'fuel' | 'gold' | 'health', value: dropA.dropValue ?? 1 },
              { type: dropB.dropType as 'fuel' | 'gold' | 'health', value: dropB.dropValue ?? 1 },
          ],
      });
  }

  private createAsteroidShards(parent: GameEntity) {
      // Minimum shard size = smallest spawnable asteroid.
      const MIN_SIZE = ASTEROID_GENERATION_CONFIG[MapType.UNIVERSE].minSize;

      // Parent area (area ∝ size²).
      const parentArea = parent.size.x * parent.size.x;

      // If parent is too small to yield two valid fragments, stop.
      if (parentArea < MIN_SIZE * MIN_SIZE * 2) return;

      // Damage scales both count and size distribution.
      // damageNorm 0 → 2 pieces, mostly large; 1 → 5 pieces, mostly small.
      const damage     = parent.lastImpactDamage ?? 1;
      const damageNorm = Math.min(1, (damage - 1) / 4);
      const count      = 2 + Math.round(damageNorm * 3); // 2–5

      // Power-law area distribution: alpha low → few large; alpha high → many small.
      const alpha = 0.4 + damageNorm * 1.6; // 0.4–2.0
      const rawAreas = Array.from({ length: count }, () => Math.pow(Math.random(), alpha));
      const rawSum   = rawAreas.reduce((s, a) => s + a, 0);

      // Normalise so total area equals parent area, then convert to sizes.
      const sizes: number[] = rawAreas
          .map(a => Math.sqrt((a / rawSum) * parentArea))
          .filter(s => s >= MIN_SIZE);

      if (sizes.length < 2) return; // not enough valid fragments

      // Resolve impact direction.
      const iv = parent.lastImpactVelocity;
      const impactSpeed = iv ? Math.sqrt(iv.x * iv.x + iv.y * iv.y) : 0;
      const impactAngle = impactSpeed > 0.001 ? Math.atan2(iv!.y, iv!.x) : null;
      const HALF_CONE   = Math.PI * 0.55;

      const parentRadius = parent.size.x / 2;

      // Inherit shard type and color from parent so tile shards stay tiles, etc.
      const parentShardType = parent.shardType ?? 'asteroid';
      const isTile          = parentShardType === 'tile';

      for (let i = 0; i < sizes.length; i++) {
          const newSize = sizes[i];
          const hp      = newSize > 30 ? 2 : 1;

          let scatterAngle: number;
          let scatterSpeed: number;
          if (impactAngle !== null) {
              scatterAngle = impactAngle + (Math.random() - 0.5) * 2 * HALF_CONE;
              scatterSpeed = impactSpeed * 0.35 + 0.4 + Math.random() * 1.2;
          } else {
              scatterAngle = Math.random() * Math.PI * 2;
              scatterSpeed = 1 + Math.random() * 2;
          }

          const vx = parent.velocity.x + Math.cos(scatterAngle) * scatterSpeed;
          const vy = parent.velocity.y + Math.sin(scatterAngle) * scatterSpeed;

          // Polygon style mirrors the parent type: blocky for tile, jagged for asteroid
          const numPoints   = isTile ? (4 + Math.floor(Math.random() * 3)) : (5 + Math.floor(Math.random() * 3));
          const angleJitterK = isTile ? 0.25 : 0.8;
          const rMin         = isTile ? 0.60 : 0.55;
          const rRange       = isTile ? 0.55 : 0.70;
          const baseR        = (newSize / 2) * 0.8;
          const rawPts: { angle: number; r: number }[] = [];
          for (let j = 0; j < numPoints; j++) {
              const baseAngle   = (j / numPoints) * Math.PI * 2;
              const angleJitter = (Math.random() - 0.5) * (Math.PI / numPoints) * angleJitterK;
              rawPts.push({ angle: baseAngle + angleJitter, r: baseR * (rMin + Math.random() * rRange) });
          }
          rawPts.sort((a, b) => a.angle - b.angle);
          const points: Vector2[] = rawPts.map(p => ({ x: Math.cos(p.angle) * p.r, y: Math.sin(p.angle) * p.r }));

          const offsetX = Math.cos(scatterAngle) * parentRadius * 0.25;
          const offsetY = Math.sin(scatterAngle) * parentRadius * 0.25;
          const maxSpin = 2.0 / (newSize / 20);

          this.currentMap?.entities.push({
              id:           `shard_${Date.now()}_${i}`,
              type:          EntityType.ASTEROID,
              shardType:     parentShardType,
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
              mass:          newSize,
              sprite:        parent.sprite,
          });
      }
  }

  // --- WAVE SYSTEM ---

  private initWaveSystem() {
    this.waveIndex = 0;
    this.waveEnemyIds = new Set();
    this.waveState = 'inactive';
    this.waveGraceTimer = 0;
    this.spawnWave(0);
  }

  private spawnWave(index: number) {
    if (!this.currentMap) return;
    this.waveIndex = index;
    this.waveEnemyIds.clear();

    const statScale = DIFFICULTY_STAT_SCALES[this.difficultyLevel] ?? DIFFICULTY_STAT_SCALES[3];
    const waveDef = generateWaveDef(index);
    const scaledGroups = waveDef.enemies.map(g => ({ ...g, count: Math.round(g.count * this.enemyScale) }));
    const totalEnemies = scaledGroups.reduce((s, g) => s + g.count, 0);
    let enemyIdx = 0;

    for (const group of scaledGroups) {
      for (let i = 0; i < group.count; i++) {
        const baseAngle = (enemyIdx / totalEnemies) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
        const safeRadius = (ENEMY_VARIANTS[group.subtype].size / 2) + 30;
        let x = 0, y = 0;
        // Try up to 8 candidate positions; pick first one clear of static tiles
        for (let attempt = 0; attempt < 8; attempt++) {
          const a = baseAngle + (attempt / 8) * Math.PI * 2 * 0.25;
          const dist = 550 + Math.random() * 200;
          x = this.player.position.x + Math.cos(a) * dist;
          y = this.player.position.y + Math.sin(a) * dist;
          if (this.physics.isPositionClear(x, y, safeRadius)) break;
        }
        const config = ENEMY_VARIANTS[group.subtype];
        const id = `wave_${index}_${enemyIdx}_${Date.now()}`;

        const tierMap: Partial<Record<string, number>> = {
          RAMMER_1: 1, SHOOTER_1: 1,
          RAMMER_2: 2, SHOOTER_2: 2,
          RAMMER_3: 3, SHOOTER_3: 3,
        };
        const enemyTier = tierMap[group.subtype] ?? 1;

        const scaledHealth = Math.max(1, Math.round(config.health * statScale.health));
        this.currentMap.entities.push({
          id,
          type: EntityType.ENEMY,
          enemySubtype: group.subtype,
          enemyTier,
          position: { x, y },
          velocity: { x: 0, y: 0 },
          size: { x: config.size, y: config.size },
          rotation: Math.random() * Math.PI * 2,
          color: config.color,
          active: true,
          health: scaledHealth,
          maxHealth: scaledHealth,
          maxSpeed: config.maxSpeed * statScale.speed,
          mass: config.mass,
          visionRange: ENEMY_CONSTANTS.VISION_RANGE,
          sprite: config.sprite
        });

        this.waveEnemyIds.add(id);
        enemyIdx++;
      }
    }

    this.waveState = 'active';
  }


  /**
   * Apply the reward of a collected/broken drop directly to the player.
   * Called both from spawnDrops (when a drop is destroyed by a player projectile)
   * and previously from the contact-collection loop.
   */
  private applyDropEffect(entity: GameEntity) {
    if (entity.dropType === 'fuel') {
      const gained = Math.min(
        (this.player.maxFuel ?? 100) - (this.player.fuel ?? 0),
        entity.dropValue ?? 0
      );
      this.player.fuel = (this.player.fuel ?? 0) + gained;
      this.damageTexts.push({
        id: `collect_${Date.now()}_${Math.random()}`,
        position: { ...entity.position },
        text: '+FUEL',
        velocity: { x: (Math.random() - 0.5) * 8, y: -DAMAGE_TEXT_CONSTANTS.SPEED },
        lifetime: DAMAGE_TEXT_CONSTANTS.LIFETIME,
        maxLifetime: DAMAGE_TEXT_CONSTANTS.LIFETIME,
        color: '#00e5ff',
        active: true,
      });
    } else if (entity.dropType === 'gold') {
      const amount = entity.dropValue ?? 0;
      this.player.gold = (this.player.gold ?? 0) + amount;
      this.damageTexts.push({
        id: `collect_${Date.now()}_${Math.random()}`,
        position: { ...entity.position },
        text: `+${Math.round(amount)}`,
        velocity: { x: (Math.random() - 0.5) * 8, y: -DAMAGE_TEXT_CONSTANTS.SPEED },
        lifetime: DAMAGE_TEXT_CONSTANTS.LIFETIME,
        maxLifetime: DAMAGE_TEXT_CONSTANTS.LIFETIME,
        color: '#ffd700',
        active: true,
      });
    } else if (entity.dropType === 'health') {
      const healAmount = entity.dropValue ?? DROP_CONFIG.HEALTH_HEAL_AMOUNT;
      const healed = Math.min(healAmount, this.player.maxHealth - this.player.health);
      if (healed > 0) {
        this.player.health += healed;
        this.damageTexts.push({
          id: `collect_${Date.now()}_${Math.random()}`,
          position: { ...entity.position },
          text: `+${Math.round(healed)}`,
          velocity: { x: (Math.random() - 0.5) * 8, y: -DAMAGE_TEXT_CONSTANTS.SPEED },
          lifetime: DAMAGE_TEXT_CONSTANTS.LIFETIME,
          maxLifetime: DAMAGE_TEXT_CONSTANTS.LIFETIME,
          color: '#4ade80',
          active: true,
        });
      }
    } else if (entity.dropType === 'powerup' && entity.dropWeapon !== undefined) {
      this.player.currentWeapon = entity.dropWeapon;
      this.currentWeaponIndex = WEAPON_LIST.indexOf(entity.dropWeapon);
      this.player.burstQueue = 0;
    }
  }

  private spawnDrops(entity: GameEntity) {
    const pos = entity.position;
    const pv = entity.velocity;

    if (entity.type === EntityType.STRUCTURE) {
      this.spawnGlassShards(entity);

    } else if (entity.type === EntityType.INTERACTABLE && entity.dropType && entity.dropType !== 'glass') {
      // Drop was destroyed by a player projectile — apply its reward immediately.
      this.applyDropEffect(entity);

    } else if (entity.type === EntityType.ASTEROID) {
      if (entity.dropComposition && entity.dropComposition.length > 0) {
        // Release all stored drop payloads (fuel/gold/health as drops; powerups as weapon drops)
        for (const comp of entity.dropComposition) {
          if (comp.type === 'powerup') {
            this.spawnPowerupDrop(pos, pv, comp.weapon);
          } else {
            this.spawnDrop(pos, comp.type, comp.value, pv);
          }
        }
      } else {
        const goldAmt = DROP_CONFIG.GOLD_PER_ASTEROID_SIZE * (entity.size.x ?? 40);
        this.spawnDrop(pos, 'gold', goldAmt, pv);
      }

      if (Math.random() < DROP_CONFIG.POWERUP_CHANCE_ASTEROID) {
        this.spawnRandomPowerupDrop(pos, pv);
      }

    } else if (entity.type === EntityType.ENEMY) {
      const tier = entity.enemyTier ?? 1;
      this.spawnDrop(pos, 'gold', DROP_CONFIG.GOLD_PER_ENEMY_TIER * tier, pv);

      if (Math.random() < DROP_CONFIG.HEALTH_CHANCE_ENEMY) {
        this.spawnDrop(pos, 'health', DROP_CONFIG.HEALTH_HEAL_AMOUNT, pv);
      }

      if (Math.random() < DROP_CONFIG.POWERUP_CHANCE_ENEMY * tier) {
        this.spawnRandomPowerupDrop(pos, pv);
      }
    }
  }

  /**
   * Generate an irregular shard polygon for a drop.
   * baseR controls visual size and should scale with the drop's value so
   * larger-value drops are physically bigger.
   */
  private generateShardPolygon(type: 'fuel' | 'gold' | 'health' | 'powerup', baseR: number): Vector2[] {
    let numPoints: number;
    let radMin: number;
    let radMax: number;
    let angleJitterScale: number;
    if (type === 'fuel') {
      numPoints = 4 + Math.floor(Math.random() * 2);   // 4-5, chunky tile piece
      radMin = 0.6; radMax = 1.1; angleJitterScale = 0.3;
    } else if (type === 'gold') {
      numPoints = 5 + Math.floor(Math.random() * 3);   // 5-7, asteroid shard
      radMin = 0.55; radMax = 1.25; angleJitterScale = 0.65;
    } else if (type === 'health') {
      numPoints = 6 + Math.floor(Math.random() * 3);   // 6-8, organic blob
      radMin = 0.45; radMax = 1.3; angleJitterScale = 0.5;
    } else {
      numPoints = 5 + Math.floor(Math.random() * 2);   // 5-6, crystal
      radMin = 0.65; radMax = 1.15; angleJitterScale = 0.4;
    }
    const rawPts: { angle: number; r: number }[] = [];
    for (let i = 0; i < numPoints; i++) {
      const baseAngle = (i / numPoints) * Math.PI * 2;
      const jitter = (Math.random() - 0.5) * (Math.PI / numPoints) * 2 * angleJitterScale;
      rawPts.push({ angle: baseAngle + jitter, r: baseR * (radMin + Math.random() * (radMax - radMin)) });
    }
    rawPts.sort((a, b) => a.angle - b.angle);
    return rawPts.map(p => ({ x: Math.cos(p.angle) * p.r, y: Math.sin(p.angle) * p.r }));
  }

  /**
   * Scatter 7–9 glass shards from a destroyed tile plus an occasional fuel shard.
   * Glass shards look like tile fragments (same glass rendering), drift with the
   * flow field, and persist as permanent debris.  They are NOT added to activeDrops so
   * they cannot be collected — they are purely environmental debris.
   */
  private spawnGlassShards(tile: GameEntity) {
    if (!this.currentMap) return;

    // Damage biases count and size distribution.
    // damageNorm 0 → 4–6 shards, mostly large; 1 → 9–11, mostly small.
    const damage     = tile.lastImpactDamage ?? 1;
    const damageNorm = Math.min(1, (damage - 1) / 4);
    const count      = Math.round(4 + damageNorm * 6) + Math.floor(Math.random() * 3);

    // Tile is approximated as a square with half-side 11 → area = 11² = 121.
    const TILE_HALF = 11;
    const parentArea = TILE_HALF * TILE_HALF;
    const MIN_RADIUS = 2; // don't spawn sub-pixel shards

    // Power-law area distribution — same principle as asteroids.
    const alpha    = 0.3 + damageNorm * 1.5; // 0.3 → few large; 1.8 → many small
    const rawAreas = Array.from({ length: count }, () => Math.pow(Math.random(), alpha));
    const rawSum   = rawAreas.reduce((s, a) => s + a, 0);
    // Radii derived from normalised areas (area = r²).
    const radii: number[] = rawAreas
      .map(a => Math.sqrt((a / rawSum) * parentArea))
      .filter(r => r >= MIN_RADIUS);

    if (radii.length < 2) return;

    const iv = tile.lastImpactVelocity;
    const impactSpeed = iv ? Math.sqrt(iv.x * iv.x + iv.y * iv.y) : 0;
    const impactAngle = impactSpeed > 0.001 ? Math.atan2(iv!.y, iv!.x) : null;
    const HALF_CONE   = Math.PI * 0.6;
    const scatter     = 12;

    for (let i = 0; i < radii.length; i++) {
      const radius = radii[i];

      let angle: number;
      let speed: number;
      if (impactAngle !== null) {
        angle = impactAngle + (Math.random() - 0.5) * 2 * HALF_CONE;
        speed = impactSpeed * 0.2 + 0.3 + Math.random() * 1.2;
      } else {
        angle = Math.random() * Math.PI * 2;
        speed = 0.4 + Math.random() * 1.5;
      }

      // Tile shard polygon — 4–6 vertices, low angular jitter, moderate radius
      // variation.  More blocky/faceted than asteroid shards (which use 5–7 pts
      // with higher jitter) to hint at their manufactured origin.
      const numPoints = 4 + Math.floor(Math.random() * 3);
      const rawPts: { angle: number; r: number }[] = [];
      for (let j = 0; j < numPoints; j++) {
        const baseAngle = (j / numPoints) * Math.PI * 2;
        const jitter    = (Math.random() - 0.5) * (Math.PI / numPoints) * 0.25;
        rawPts.push({ angle: baseAngle + jitter, r: radius * (0.6 + Math.random() * 0.55) });
      }
      rawPts.sort((a, b) => a.angle - b.angle);
      const pts: Vector2[] = rawPts.map(p => ({ x: Math.cos(p.angle) * p.r, y: Math.sin(p.angle) * p.r }));

      const size = radius * 4; // diameter; slightly larger so physics feel solid
      this.currentMap.entities.push({
        id:            `tile_shard_${Date.now()}_${i}_${Math.random()}`,
        type:           EntityType.ASTEROID,
        shardType:     'tile',
        position:      {
          x: tile.position.x + (Math.random() - 0.5) * scatter * 2,
          y: tile.position.y + (Math.random() - 0.5) * scatter * 2,
        },
        velocity:      { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        size:          { x: size, y: size },
        rotation:       Math.random() * Math.PI * 2,
        rotationSpeed:  (Math.random() - 0.5) * 2 * (2.8 / Math.max(1, radius / 4)),
        color:          '#b4e6fd',   // blue-white tile hue
        active:         true,
        health:         1,
        maxHealth:      1,
        mass:           size,
        polygonPoints:  pts,
      });
    }

    // ~35 % chance: also eject a fuel shard
    if (Math.random() < 0.35) {
      this.spawnDrop(tile.position, 'fuel', DROP_CONFIG.FUEL_FROM_TILE, tile.velocity);
    }
  }

  private spawnDrop(pos: Vector2, type: 'fuel' | 'gold' | 'health', value: number, parentVelocity?: Vector2) {
    if (!this.currentMap) return;
    if (this.activeDrops.length >= DROP_CONFIG.MAX_ACTIVE_DROPS) return;
    const scatter = 20;
    const scatterAngle = Math.random() * Math.PI * 2;
    const scatterSpeed = 0.5 + Math.random() * 1.5;
    const pvx = parentVelocity?.x ?? 0;
    const pvy = parentVelocity?.y ?? 0;
    const maxSpin = 2.5;
    // Visual radius scales linearly with value so larger drops are physically bigger.
    // Range: value=10 → r≈4.2, value=80 → r≈9.5
    const dropRadius = Math.min(10, Math.max(4, 3.5 + value * 0.075));
    const drop: GameEntity = {
      id: `drop_${type}_${Date.now()}_${Math.random()}`,
      type: EntityType.INTERACTABLE,
      position: {
        x: pos.x + (Math.random() - 0.5) * scatter * 2,
        y: pos.y + (Math.random() - 0.5) * scatter * 2,
      },
      velocity: {
        x: pvx * 0.3 + Math.cos(scatterAngle) * scatterSpeed,
        y: pvy * 0.3 + Math.sin(scatterAngle) * scatterSpeed,
      },
      size: { x: dropRadius * 3, y: dropRadius * 3 },
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 2 * maxSpin,
      color: type === 'fuel' ? '#00e5ff' : type === 'health' ? '#4ade80' : '#ffd700',
      active: true,
      health: 1,
      maxHealth: 1,
      mass: 5,
      dropType: type,
      dropValue: value,
      polygonPoints: this.generateShardPolygon(type, dropRadius),
    };
    this.currentMap.entities.push(drop);
    this.activeDrops.push(drop);
  }

  // Spawn a powerup drop for a specific weapon (used when a composite asteroid releases its stored weapons).
  private spawnPowerupDrop(pos: Vector2, parentVelocity: Vector2 | undefined, weapon: WeaponType) {
    if (!this.currentMap) return;
    if (this.activeDrops.length >= DROP_CONFIG.MAX_ACTIVE_DROPS) return;
    this.spawnRandomPowerupDrop(pos, parentVelocity, weapon);
  }

  private spawnRandomPowerupDrop(pos: Vector2, parentVelocity?: Vector2, specificWeapon?: WeaponType) {
    if (!this.currentMap) return;
    if (this.activeDrops.length >= DROP_CONFIG.MAX_ACTIVE_DROPS) return;
    const weaponType = specificWeapon ?? WEAPON_LIST[Math.floor(Math.random() * WEAPON_LIST.length)];
    const weaponConfig = WEAPONS[weaponType];
    const scatter = 20;
    const scatterAngle = Math.random() * Math.PI * 2;
    const scatterSpeed = 0.5 + Math.random() * 1.5;
    const pvx = parentVelocity?.x ?? 0;
    const pvy = parentVelocity?.y ?? 0;
    const maxSpin = 2.5;
    const dropRadius = 7; // fixed mid-range size for weapon powerups
    const drop: GameEntity = {
      id: `drop_powerup_${Date.now()}_${Math.random()}`,
      type: EntityType.INTERACTABLE,
      position: {
        x: pos.x + (Math.random() - 0.5) * scatter * 2,
        y: pos.y + (Math.random() - 0.5) * scatter * 2,
      },
      velocity: {
        x: pvx * 0.3 + Math.cos(scatterAngle) * scatterSpeed,
        y: pvy * 0.3 + Math.sin(scatterAngle) * scatterSpeed,
      },
      size: { x: dropRadius * 3, y: dropRadius * 3 },
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 2 * maxSpin,
      color: weaponConfig.color,
      active: true,
      health: 1,
      maxHealth: 1,
      mass: 5,
      name: weaponConfig.name,
      dropType: 'powerup',
      dropWeapon: weaponType,
      polygonPoints: this.generateShardPolygon('powerup', dropRadius),
    };
    this.currentMap.entities.push(drop);
    this.activeDrops.push(drop);
  }

  private loadMap(map: BaseMapLayer) {
      if (!map.initialized) {
          map.init();
      }
      this.currentMap = map;
      // Pre-calculate spatial grid for static tiles to avoid overhead in main loop
      this.physics.initializeStaticGrid(map.entities);
      this.flowField.initObstacles(map.entities);
      this.flowField.buildAsteroidField();
      this.renderer.setMapType(map.type);
  }

  private draw() {
      if (!this.currentMap) return;
      
      this.renderer.render(
          this.frameEntities,
          this.camera,
          this.currentMap.type,
          this.minimapExpanded,
          this.damageTexts,
          this.player.position
      );
  }
}
