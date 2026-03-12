
/**
 * SpaceGameEngine - Phase 1: Infinite Space / Player Movement
 *
 * Forked from GameEngine.ts and simplified for the iPhone space survival game.
 *
 * Removed:
 *  - Multi-layer map hierarchy (Universe / Solar System / Local / Sub-Map)
 *  - Zoom-transition animations between layers
 *  - Portal / interactable map-switch detection
 *  - Difficulty scaling system (wave system will own this later)
 *
 * Kept:
 *  - All entity classes (player, enemy, projectile, asteroid, particle)
 *  - All 5 weapon types + homing missile logic
 *  - Full physics system (SAT collisions, gravity, screen shake)
 *  - AI system (enemies disabled in Phase 1 — enemySpawnEnabled = false)
 *  - Background effects (star field, nebulae, shooting stars)
 *  - Minimap
 *  - Damage texts, explosions, particle bursts, engine trail
 *
 * Added / Changed:
 *  - Single InfiniteSpaceMap — boundless, no edges
 *  - Asteroid lifecycle: spawn in a ring around the player,
 *    despawn when they drift too far from the player
 *  - Player health reported in EngineStats for UI health bar
 *  - Player death → GAME_OVER state (respawn on restart)
 *
 * Future phases add on top of this file:
 *  Phase 2 — Power-ups (add PowerUpSystem, drop on enemy kill)
 *  Phase 3 — Enemy waves (set enemySpawnEnabled = true, add WaveSystem)
 *  Phase 4 — Score, wave progression, wave-complete screen
 *  Phase 5 — Sound, polish, Capacitor iOS build
 */

import { InputSystem } from './systems/InputSystem';
import { PhysicsSystem } from './systems/PhysicsSystem';
import { RenderSystem } from './systems/RenderSystem';
import { AISystem } from './systems/AISystem';
import { InfiniteSpaceMap } from './maps/InfiniteSpaceMap';
import {
  GameEntity, EntityType, MapType, CameraState, EngineStats,
  Vector2, WeaponType, WeaponConfig, DamageText, GameState
} from '../types';
import {
  COLORS, PHYSICS_CONSTANTS, PROJECTILE_CONSTANTS, WEAPONS, WEAPON_LIST,
  MINIMAP_CONSTANTS, PLAYER_MOVEMENT_CONFIG, DAMAGE_TEXT_CONSTANTS,
  TRAIL_CONSTANTS, PARTICLE_CONSTANTS, CAMERA_CONSTANTS, SPRITE_CONSTANTS,
  ENEMY_WEAPON, ENEMY_CONSTANTS, EXPLOSION_CONSTANTS
} from '../constants';
import { ASSETS } from '../assets';

const PHYSICS_MAX_STEPS = 5;

// Asteroid density around the player in infinite space
const TARGET_ASTEROID_COUNT = 100;
const ASTEROID_SPAWN_MIN_DIST = 600;   // units from player
const ASTEROID_SPAWN_MAX_DIST = 2500;
const ASTEROID_DESPAWN_DIST_SQ = 3500 * 3500;

export class SpaceGameEngine {
  private input: InputSystem;
  private physics: PhysicsSystem;
  private renderer: RenderSystem;
  private ai: AISystem;

  private isRunning: boolean = false;
  private gameState: GameState = GameState.MENU;
  private lastTime: number = 0;
  private accumulator: number = 0;
  private readonly FIXED_DT: number = 1 / 120;

  private spaceMap: InfiniteSpaceMap;
  private player: GameEntity;
  private camera: CameraState;

  private damageTexts: DamageText[] = [];
  private currentWeaponIndex: number = 0;

  private minimapExpanded: boolean = false;
  private minimapTimer: number = 0;
  private minimapDebounce: number = 0;
  private frameEntities: GameEntity[] = [];

  private shakeTimer: number = 0;
  private shakeIntensity: number = 0;

  // Phase 3+: set to true to enable enemy spawning
  private enemySpawnEnabled: boolean = false;

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

    this.spaceMap = new InfiniteSpaceMap();
    this.spaceMap.init();
    this.physics.initializeStaticGrid(this.spaceMap.entities);
    this.renderer.setMapType(this.spaceMap.type);
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

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
      this.lastTime = performance.now();
    }
  }

  public restartGame() {
    // Reset map — fresh asteroid field
    this.spaceMap = new InfiniteSpaceMap();
    this.spaceMap.init();
    this.physics.initializeStaticGrid(this.spaceMap.entities);

    // Reset player
    this.player.position = { x: 0, y: 0 };
    this.player.velocity = { x: 0, y: 0 };
    this.player.health = this.player.maxHealth;
    this.player.trail = [];
    this.player.size = { x: SPRITE_CONSTANTS.PLAYER_BASE_SIZE, y: SPRITE_CONSTANTS.PLAYER_BASE_SIZE };
    this.player.sprite = ASSETS.PLAYER_SHIP;
    this.player.isExploding = false;
    this.player.explosionTimer = undefined;
    this.player.active = true;
    this.player.weaponCooldown = 0;
    this.player.burstQueue = 0;
    this.player.burstTimer = 0;

    this.camera.zoom = 1;
    this.camera.position = { x: 0, y: 0 };
    this.shakeTimer = 0;
    this.camera.shakeOffset = { x: 0, y: 0 };

    this.damageTexts = [];
    this.gameState = GameState.PLAYING;
    this.prepareFrameEntities();
  }

  public cycleWeapon() {
    if (this.gameState !== GameState.PLAYING) return;
    this.currentWeaponIndex = (this.currentWeaponIndex + 1) % WEAPON_LIST.length;
    this.player.currentWeapon = WEAPON_LIST[this.currentWeaponIndex];
    this.player.burstQueue = 0;
  }

  // ─── Game Loop ───────────────────────────────────────────────────────────────

  private loop = (time: number) => {
    if (!this.isRunning) return;

    const frameTime = (time - this.lastTime) / 1000;
    this.lastTime = time;

    this.onStatsUpdate({
      fps: Math.round(1000 / ((performance.now() - time) + 1)),
      entityCount: this.spaceMap.entities.length + 1,
      currentMapName: this.spaceMap.name,
      currentMapType: this.spaceMap.type,
      currentWeapon: WEAPONS[this.player.currentWeapon || WeaponType.BLASTER].name,
      gameState: this.gameState,
      playerHealth: Math.max(0, this.player.health),
      playerMaxHealth: this.player.maxHealth
    });

    if (this.gameState !== GameState.PLAYING) {
      this.draw();
      requestAnimationFrame(this.loop);
      return;
    }

    const safeFrameTime = Math.min(frameTime, 0.25);
    this.prepareFrameEntities();
    this.accumulator += safeFrameTime;

    let steps = 0;
    while (this.accumulator >= this.FIXED_DT && steps < PHYSICS_MAX_STEPS) {
      this.updatePhysics(this.FIXED_DT);
      this.accumulator -= this.FIXED_DT;
      steps++;
    }
    if (this.accumulator > this.FIXED_DT * PHYSICS_MAX_STEPS) {
      this.accumulator = 0;
    }

    this.updateGameLogic(safeFrameTime);
    this.prepareFrameEntities();
    this.draw();

    requestAnimationFrame(this.loop);
  };

  // ─── Frame preparation ───────────────────────────────────────────────────────

  private prepareFrameEntities() {
    this.frameEntities.length = 0;
    const ents = this.spaceMap.entities;
    for (let i = 0; i < ents.length; i++) {
      this.frameEntities.push(ents[i]);
    }
    this.frameEntities.push(this.player);
  }

  // ─── Physics Update ──────────────────────────────────────────────────────────

  private updatePhysics(dt: number) {
    const allEntities = this.frameEntities;

    if (this.enemySpawnEnabled) {
      this.ai.update(dt, allEntities, this.player);
      this.handleEnemyShooting(dt);
    }

    this.physics.update(
      allEntities,
      this.spaceMap.type,
      dt,
      this.spawnDamageText,
      this.handleEntityDeath,
      this.handleScreenShake
    );

    // Tick explosion timers for non-player entities
    this.spaceMap.entities.forEach(e => {
      if (e.isExploding && e.explosionTimer !== undefined) {
        e.explosionTimer -= dt;
        if (e.explosionTimer <= 0) {
          e.active = false;
        }
      }
    });

    // Asteroid shard spawning on large-rock destruction
    const newlyDestroyed = this.spaceMap.entities.filter(
      e => !e.active && e.type === EntityType.ASTEROID
    );
    newlyDestroyed.forEach(ast => {
      if (ast.size.x > 15) this.createAsteroidShards(ast);
    });

    // Lifecycle: despawn far asteroids, respawn near player
    this.handleAsteroidLifecycle();

    // Compact entity list (garbage-free in-place deletion)
    let writeIdx = 0;
    for (let i = 0; i < this.spaceMap.entities.length; i++) {
      const ent = this.spaceMap.entities[i];
      if (ent.active) {
        this.spaceMap.entities[writeIdx++] = ent;
      }
    }
    this.spaceMap.entities.length = writeIdx;
  }

  /**
   * Replaces the fixed-radius respawn from the original engine.
   * Asteroids now follow the player through infinite space:
   *   - Despawn if they drift more than ASTEROID_DESPAWN_DIST away
   *   - Respawn in a ring just outside the player's immediate view
   */
  private handleAsteroidLifecycle() {
    const px = this.player.position.x;
    const py = this.player.position.y;

    // Mark distant asteroids inactive so the compaction loop removes them
    const ents = this.spaceMap.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.type !== EntityType.ASTEROID || !e.active) continue;
      const dx = e.position.x - px;
      const dy = e.position.y - py;
      if (dx * dx + dy * dy > ASTEROID_DESPAWN_DIST_SQ) {
        e.active = false;
      }
    }

    // Count remaining asteroids and top up a few per frame to avoid pop-in
    const count = ents.filter(e => e.type === EntityType.ASTEROID && e.active).length;
    const deficit = TARGET_ASTEROID_COUNT - count;
    const spawnBatch = Math.min(deficit, 3);

    for (let i = 0; i < spawnBatch; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = ASTEROID_SPAWN_MIN_DIST +
        Math.random() * (ASTEROID_SPAWN_MAX_DIST - ASTEROID_SPAWN_MIN_DIST);
      const x = px + Math.cos(angle) * dist;
      const y = py + Math.sin(angle) * dist;
      const size = 20 + Math.random() * 100;
      this.spaceMap.entities.push(this.spaceMap.spawnAsteroid(x, y, size, 2.0));
    }
  }

  // ─── Game Logic Update ───────────────────────────────────────────────────────

  private updateGameLogic(dt: number) {
    // Screen shake decay
    if (this.shakeTimer > 0) {
      this.shakeTimer -= dt;
      const decay = Math.max(0, this.shakeTimer / CAMERA_CONSTANTS.SHAKE_DECAY);
      const mag = this.shakeIntensity * decay;
      this.camera.shakeOffset = {
        x: (Math.random() - 0.5) * mag * 2,
        y: (Math.random() - 0.5) * mag * 2
      };
      if (this.shakeTimer <= 0) {
        this.camera.shakeOffset = { x: 0, y: 0 };
      }
    }

    if (this.minimapDebounce > 0) this.minimapDebounce -= dt;

    // Player death → transition to GAME_OVER
    if (this.player.health <= 0 && !this.player.isExploding) {
      this.handleEntityDeath(this.player);
    }

    if (this.player.isExploding) {
      if (this.player.explosionTimer !== undefined) {
        this.player.explosionTimer -= dt;
        if (this.player.explosionTimer <= 0) {
          // Phase 1: auto-respawn at origin so movement testing is uninterrupted.
          // Phase 4: change this to gameState = GAME_OVER.
          this.respawnPlayer();
        }
      }
      this.camera.position.x = this.player.position.x;
      this.camera.position.y = this.player.position.y;
      return;
    }

    // Minimap auto-collapse
    if (this.minimapExpanded) {
      this.minimapTimer -= dt;
      if (this.minimapTimer <= 0) this.minimapExpanded = false;
    }

    // ── Player movement ──────────────────────────────────────────────────────
    const moveDir = this.input.getMovementVector();
    this.player.inputVector = moveDir;

    const moveConfig = PLAYER_MOVEMENT_CONFIG[this.spaceMap.type];
    const acc = moveConfig ? moveConfig.acceleration : PHYSICS_CONSTANTS.ACCELERATION;
    const maxSpeed = moveConfig ? moveConfig.maxSpeed : PHYSICS_CONSTANTS.MAX_SPEED;

    const timeScale = dt * 60;
    this.player.velocity.x += moveDir.x * acc * timeScale;
    this.player.velocity.y += moveDir.y * acc * timeScale;

    const currentSpeed = Math.sqrt(
      this.player.velocity.x ** 2 + this.player.velocity.y ** 2
    );
    if (currentSpeed > maxSpeed) {
      this.player.velocity.x = (this.player.velocity.x / currentSpeed) * maxSpeed;
      this.player.velocity.y = (this.player.velocity.y / currentSpeed) * maxSpeed;
    }

    // ── Engine trail ──────────────────────────────────────────────────────────
    if (this.player.trail) {
      for (let i = this.player.trail.length - 1; i >= 0; i--) {
        this.player.trail[i].lifetime -= dt;
        if (this.player.trail[i].lifetime <= 0) {
          this.player.trail.splice(i, 1);
        }
      }
    }
    const lastTrailPt = this.player.trail?.length
      ? this.player.trail[this.player.trail.length - 1]
      : null;
    if (
      !lastTrailPt ||
      (this.player.position.x - lastTrailPt.x) ** 2 +
      (this.player.position.y - lastTrailPt.y) ** 2 > TRAIL_CONSTANTS.MIN_DISTANCE_SQ
    ) {
      this.player.trail = this.player.trail || [];
      this.player.trail.push({
        x: this.player.position.x,
        y: this.player.position.y,
        lifetime: TRAIL_CONSTANTS.LIFETIME,
        maxLifetime: TRAIL_CONSTANTS.LIFETIME
      });
    }

    // ── Aiming ───────────────────────────────────────────────────────────────
    const mousePos = this.input.getMousePosition();
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    this.player.rotation = Math.atan2(mousePos.y - cy, mousePos.x - cx);

    // ── Shooting + minimap toggle ──────────────────────────────────────────
    const fireEvents = this.input.getFireEvents();
    fireEvents.forEach(evt => {
      const { SIZE, EXPANDED_SIZE, MARGIN } = MINIMAP_CONSTANTS;
      const currentSize = this.minimapExpanded ? EXPANDED_SIZE : SIZE;
      const mapX = MARGIN;
      const mapY = window.innerHeight - currentSize - MARGIN;

      if (
        evt.x >= mapX && evt.x <= mapX + currentSize &&
        evt.y >= mapY && evt.y <= mapY + currentSize
      ) {
        if (this.minimapDebounce > 0) return;
        this.minimapExpanded = !this.minimapExpanded;
        this.minimapTimer = this.minimapExpanded ? 5.0 : 0;
        this.minimapDebounce = 0.3;
        return;
      }

      if (!this.minimapExpanded) this.handleShooting(evt);
    });

    // ── Weapon cooldowns / burst queue ───────────────────────────────────────
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
        this.spawnProjectileFromConfig(this.player, { x: targetX, y: targetY }, config, EntityType.PLAYER);
      }
    }

    this.updateHomingProjectiles(dt);

    // ── Damage text cleanup ───────────────────────────────────────────────────
    let dIdx = 0;
    for (let i = 0; i < this.damageTexts.length; i++) {
      const t = this.damageTexts[i];
      t.lifetime -= dt;
      t.position.x += t.velocity.x * dt;
      t.position.y += t.velocity.y * dt;
      if (t.lifetime > 0) this.damageTexts[dIdx++] = t;
    }
    this.damageTexts.length = dIdx;

    // ── Camera ───────────────────────────────────────────────────────────────
    this.camera.position.x = this.player.position.x;
    this.camera.position.y = this.player.position.y;
  }

  // ─── Enemy Shooting (used when enemySpawnEnabled = true in Phase 3) ──────────

  private handleEnemyShooting(dt: number) {
    const weapon = ENEMY_WEAPON;
    const rangeSq = ENEMY_CONSTANTS.VISION_RANGE * ENEMY_CONSTANTS.VISION_RANGE;

    for (let i = 0; i < this.spaceMap.entities.length; i++) {
      const enemy = this.spaceMap.entities[i];
      if (!enemy.active || enemy.type !== EntityType.ENEMY) continue;

      enemy.weaponCooldown = Math.max(0, (enemy.weaponCooldown || 0) - dt);
      if (enemy.weaponCooldown > 0) continue;

      const dx = this.player.position.x - enemy.position.x;
      const dy = this.player.position.y - enemy.position.y;
      if (dx * dx + dy * dy > rangeSq) continue;

      const leadAngle = Math.atan2(dy, dx) +
        (Math.random() - 0.5) * (weapon.spread * Math.PI / 180);
      const targetX = enemy.position.x + Math.cos(leadAngle) * 500;
      const targetY = enemy.position.y + Math.sin(leadAngle) * 500;

      enemy.weaponCooldown = weapon.cooldown;
      this.spawnProjectileFromConfig(enemy, { x: targetX, y: targetY }, weapon, EntityType.ENEMY);
    }
  }

  // ─── Combat helpers ───────────────────────────────────────────────────────────

  private handleShooting(target: Vector2) {
    if (this.player.weaponCooldown && this.player.weaponCooldown > 0) return;
    const config = WEAPONS[this.player.currentWeapon || WeaponType.BLASTER];
    this.player.weaponCooldown = config.cooldown;

    if (config.type === WeaponType.BURST && config.burstCount) {
      this.player.burstQueue = config.burstCount - 1;
      this.player.burstTimer = config.burstDelay;
    }

    const worldX = this.player.position.x + (target.x - window.innerWidth / 2) / this.camera.zoom;
    const worldY = this.player.position.y + (target.y - window.innerHeight / 2) / this.camera.zoom;

    this.spawnProjectileFromConfig(
      this.player, { x: worldX, y: worldY }, config, EntityType.PLAYER
    );
  }

  private spawnProjectileFromConfig(
    shooter: GameEntity,
    target: Vector2,
    config: WeaponConfig,
    ownerType: EntityType
  ) {
    const angle = Math.atan2(
      target.y - shooter.position.y,
      target.x - shooter.position.x
    );

    if (ownerType === EntityType.PLAYER) {
      const recoilImpulse =
        (PROJECTILE_CONSTANTS.MASS * config.speed * config.recoil) / (shooter.mass || 1);
      shooter.velocity.x -= Math.cos(angle) * recoilImpulse;
      shooter.velocity.y -= Math.sin(angle) * recoilImpulse;
    }

    const halfSpread = (config.spread * (Math.PI / 180)) / 2;

    for (let i = 0; i < config.count; i++) {
      let currentAngle = angle;
      if (config.count > 1) {
        const step = (halfSpread * 2) / (config.count - 1);
        currentAngle = (angle - halfSpread) + step * i;
      } else if (config.spread > 0) {
        currentAngle += (Math.random() - 0.5) * (config.spread * (Math.PI / 180));
      }

      const vx = Math.cos(currentAngle) * config.speed;
      const vy = Math.sin(currentAngle) * config.speed;
      const muzzleBase = Math.max(shooter.size?.x || SPRITE_CONSTANTS.PLAYER_BASE_SIZE, shooter.size?.y || SPRITE_CONSTANTS.PLAYER_BASE_SIZE);
      const muzzleOffset = muzzleBase * 0.6;
      const startX = shooter.position.x + Math.cos(currentAngle) * muzzleOffset;
      const startY = shooter.position.y + Math.sin(currentAngle) * muzzleOffset;

      this.spaceMap.entities.push({
        id: `proj_${Date.now()}_${i}`,
        type: EntityType.PROJECTILE,
        position: { x: startX, y: startY },
        velocity: { x: vx, y: vy },
        size: { x: config.size * 2.5, y: config.size * 0.4 },
        rotation: currentAngle,
        color: config.color,
        active: true,
        health: 1,
        maxHealth: 1,
        lifetime: config.lifetime,
        mass: PROJECTILE_CONSTANTS.MASS,
        damage: config.damage,
        homing: config.homing,
        ownerType
      });
    }
  }

  private updateHomingProjectiles(dt: number) {
    const entities = this.spaceMap.entities;
    for (let i = 0; i < entities.length; i++) {
      const p = entities[i];
      if (!p.active || p.type !== EntityType.PROJECTILE || !p.homing) continue;

      let target: GameEntity | null = null;
      let minDist = 400 * 400;

      for (let j = 0; j < entities.length; j++) {
        const e = entities[j];
        if (e.active && (e.type === EntityType.ENEMY || e.type === EntityType.ASTEROID)) {
          const d2 = (e.position.x - p.position.x) ** 2 + (e.position.y - p.position.y) ** 2;
          if (d2 < minDist) { minDist = d2; target = e; }
        }
      }

      if (target) {
        const desiredAngle = Math.atan2(
          target.position.y - p.position.y,
          target.position.x - p.position.x
        );
        let diff = desiredAngle - p.rotation;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turnRate = 5 * dt;
        p.rotation += Math.abs(diff) < turnRate ? diff : Math.sign(diff) * turnRate;
        const speed = Math.sqrt(p.velocity.x ** 2 + p.velocity.y ** 2);
        p.velocity.x = Math.cos(p.rotation) * speed;
        p.velocity.y = Math.sin(p.rotation) * speed;
      }
    }
  }

  // ─── Entity events ────────────────────────────────────────────────────────────

  private handleEntityDeath = (entity: GameEntity) => {
    if (entity.type === EntityType.PLAYER || entity.type === EntityType.ENEMY) {
      this.startExplosion(entity);
    }

    const { LIFETIME_MIN, LIFETIME_MAX, SPEED_MIN, SPEED_MAX, SIZE_MIN, SIZE_MAX } = PARTICLE_CONSTANTS;
    const numParticles = 8 + Math.floor(Math.random() * 5);
    for (let i = 0; i < numParticles; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);
      const size = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN);
      const life = LIFETIME_MIN + Math.random() * (LIFETIME_MAX - LIFETIME_MIN);

      this.spaceMap.entities.push({
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

  private startExplosion(entity: GameEntity) {
    if (entity.isExploding) return;
    const baseSize = Math.max(entity.size.x, entity.size.y);
    entity.isExploding = true;
    entity.explosionTimer = EXPLOSION_CONSTANTS.DURATION;
    entity.sprite = ASSETS.EXPLOSION;
    entity.size = {
      x: baseSize * Math.abs(EXPLOSION_CONSTANTS.SIZE_MULTIPLIER || 1.5),
      y: baseSize * Math.abs(EXPLOSION_CONSTANTS.SIZE_MULTIPLIER || 1.5)
    };
    entity.velocity = { x: 0, y: 0 };
    entity.hitFlash = 0;
    entity.active = true;
  }

  private respawnPlayer() {
    this.player.isExploding = false;
    this.player.explosionTimer = undefined;
    this.player.health = this.player.maxHealth;
    this.player.active = true;
    this.player.sprite = ASSETS.PLAYER_SHIP;
    this.player.size = { x: SPRITE_CONSTANTS.PLAYER_BASE_SIZE, y: SPRITE_CONSTANTS.PLAYER_BASE_SIZE };
    this.player.position = { x: 0, y: 0 };
    this.player.velocity = { x: 0, y: 0 };
    this.player.rotation = 0;
    this.player.trail = [];
    this.player.weaponCooldown = 0;
    this.player.burstQueue = 0;
    this.player.burstTimer = 0;
    this.shakeTimer = 0;
    this.camera.shakeOffset = { x: 0, y: 0 };
    this.camera.position = { x: 0, y: 0 };
  }

  private createAsteroidShards(parent: GameEntity) {
    const shardCount = 2 + Math.floor(Math.random() * 2);
    const newSize = parent.size.x / Math.sqrt(shardCount);
    const hp = newSize > 30 ? 2 : 1;

    for (let i = 0; i < shardCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 2;
      const points: Vector2[] = [];
      const numPoints = 5;
      for (let j = 0; j < numPoints; j++) {
        const a = (j / numPoints) * Math.PI * 2;
        const r = (newSize / 2) * (0.6 + Math.random() * 0.4);
        points.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
      }

      this.spaceMap.entities.push({
        id: `shard_${Date.now()}_${i}`,
        type: EntityType.ASTEROID,
        position: {
          x: parent.position.x + Math.cos(angle) * newSize * 0.5,
          y: parent.position.y + Math.sin(angle) * newSize * 0.5
        },
        velocity: {
          x: parent.velocity.x + Math.cos(angle) * speed,
          y: parent.velocity.y + Math.sin(angle) * speed
        },
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

  private spawnDamageText = (pos: Vector2, amount: number) => {
    const isCrit = amount > 3;
    this.damageTexts.push({
      id: `dmg_${Date.now()}_${Math.random()}`,
      position: { ...pos },
      text: Math.round(amount).toString(),
      velocity: { x: (Math.random() - 0.5) * 10, y: -DAMAGE_TEXT_CONSTANTS.SPEED },
      lifetime: DAMAGE_TEXT_CONSTANTS.LIFETIME,
      maxLifetime: DAMAGE_TEXT_CONSTANTS.LIFETIME,
      color: isCrit ? DAMAGE_TEXT_CONSTANTS.CRIT_COLOR : DAMAGE_TEXT_CONSTANTS.COLOR,
      active: true
    });
  };

  private handleScreenShake = (amount: number) => {
    if (amount > this.shakeIntensity || this.shakeTimer <= 0) {
      this.shakeIntensity = amount;
      this.shakeTimer = CAMERA_CONSTANTS.SHAKE_DECAY;
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  private draw() {
    this.renderer.render(
      this.frameEntities,
      this.camera,
      this.spaceMap.type,
      this.minimapExpanded,
      this.damageTexts
    );
  }
}
