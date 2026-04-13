

import { InputSystem } from './systems/InputSystem';
import { PhysicsSystem } from './systems/PhysicsSystem';
import { RenderSystem } from './systems/RenderSystem';
import { AISystem } from './systems/AISystem';
import { BaseMapLayer, UniverseMap } from './maps/MapClasses';
import { HEX_SIZE, HEX_AREA, TileGenerator, pixelToHexCoord, hexCoordToPixel } from './maps/TileGenerator';
import { GameEntity, EntityType, EnemyRole, MapType, CameraState, EngineStats, Vector2, WeaponType, WeaponConfig, DamageText, GameState, ShardType, DropCompositionEntry, PlayerHUDMessage, WaveAnnouncement, TrailPoint, NebulaColorStop } from '../types';
import { COLORS, PHYSICS_CONSTANTS, PROJECTILE_CONSTANTS, WEAPONS, WEAPON_LIST, MINIMAP_CONSTANTS, PLAYER_MOVEMENT_CONFIG, DAMAGE_TEXT_CONSTANTS, ASTEROID_GENERATION_CONFIG, TRAIL_CONSTANTS, PARTICLE_CONSTANTS, CAMERA_CONSTANTS, SPRITE_CONSTANTS, ENEMY_WEAPON, ENEMY_BURST_CONFIG, ENEMY_CONSTANTS, EXPLOSION_CONSTANTS, DIFFICULTY_SCALES, DIFFICULTY_STAT_SCALES, ENEMY_VARIANTS, ENEMY_ROLE, WAVE_CONSTANTS, generateWaveDef, DROP_CONFIG, ENEMY_AMMO_DROP, ASTEROID_AMMO_PROGRESSION, STRUCTURE_CONSTANTS, AI_CONFIG, COLLISION_CONFIG, AMMO_HUD_CONSTANTS, computeAmmoHUDLayout, SHIELD_CONSTANTS, HEALTH_DROP_INTERVAL, REGEN_POP_CONSTANTS, WAVE_ANNOUNCE_CONSTANTS, GLITTER_TRAIL_CONSTANTS, NEBULA_CONSTANTS } from '../constants';
import { ASSETS } from '../assets';
import { FlowFieldGrid } from './systems/FlowFieldGrid';
import { cloneComposition, blendCompositionToHex, blendCompositions, randomNebulaComposition, hexToHueDeg, paletteHueToHex, clampHueToPalette, NEBULA_PALETTE_HUE_MIN, NEBULA_PALETTE_HUE_RANGE } from './NebulaColor';

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
  private playerMessages: PlayerHUDMessage[] = [];
  private readonly MAX_PLAYER_MESSAGES = 6;
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

  // Wave announcement banners rendered on the canvas
  public waveAnnouncements: WaveAnnouncement[] = [];

  // Collision-based stick bonds — entities bond on contact and merge after threshold
  private stickBonds: Array<{ a: GameEntity; b: GameEntity; timer: number; threshold: number }> = [];
  // Counts down after thrust stops; trail keeps emitting with shrinking lifetimes during this window
  private trailDecayTimer: number = 0;
  private static readonly TRAIL_DECAY_DURATION = 1.0; // seconds
  // Last unit-length thrust direction — stored so coasting trail emissions still
  // know which way "backward" is (moveDir is zero while coasting)
  private lastThrustDir: Vector2 = { x: 0, y: 0 };
  // Last world position a trail point was emitted from (used for distance-gated
  // emission; trail point positions themselves drift and can't be used directly)
  private lastTrailEmitPos: Vector2 = { x: 0, y: 0 };
  // Per-frame drift speed of thrust-trail points along the -thrust direction
  private static readonly THRUST_TRAIL_DRIFT = 1.2;
  // Per-frame lerp factor for easing lastThrustDir toward the current input
  // direction — keeps the trail smooth through rapid input direction changes
  private static readonly THRUST_DIR_SMOOTH = 0.2;
  // Tracks whether thrust was active last frame; used to detect the start of
  // a fresh thrust event so we can reset the trail (otherwise a new bright
  // head stitched onto a decayed chain visually re-lights the old trail).
  private wasThrusting: boolean = false;
  // Trails from previous thrust events — continue to drift and fade on their
  // own, never have new points appended, so they visually detach from the
  // player when a new thrust event begins.
  private detachedTrails: TrailPoint[][] = [];

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
      ammo: {},  // BLASTER is always ∞ (no entry); other weapons stored here when unlocked
      gold: 0,
      shield: SHIELD_CONSTANTS.MAX_CHARGE,
      maxShield: SHIELD_CONSTANTS.MAX_CHARGE,
      shieldRechargeTimer: 0,
      shieldHitFlash: 0
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

  public skipWave() {
    if (this.waveState === 'cleared' && this.waveGraceTimer > 0) {
      this.waveGraceTimer = 0;
      this.spawnWave(this.waveIndex + 1);
      // Push stats immediately so the UI reflects the new wave number
      // before the next rAF tick rather than lagging one frame.
      this.onStatsUpdate({
        fps: 0,
        entityCount: (this.currentMap?.entities.length || 0) + 1,
        currentMapName: this.currentMap?.name || '',
        currentMapType: this.currentMap?.type || MapType.UNIVERSE,
        currentWeapon: WEAPONS[this.player.currentWeapon || WeaponType.BLASTER].name,
        gameState: this.gameState,
        difficulty: this.difficultyLevel,
        waveNumber: this.waveIndex + 1,
        waveStatus: 'active',
        waveGraceTimer: undefined,
        debugMode: this.debugMode,
        weaponCount: this.currentWeaponIndex + 1,
      });
    }
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
      this.waveAnnouncements = [];
      this.loadMap(new UniverseMap());

      // Reset Player
      this.player.position = { x: 0, y: 0 };
      this.player.velocity = { x: 0, y: 0 };
      this.player.health = this.player.maxHealth;
      this.player.shield = this.player.maxShield;
      this.player.shieldRechargeTimer = 0;
      this.player.shieldHitFlash = 0;
      this.player.ammo = {};
      this.player.gold = 0;
      this.player.trail = [];
      this.detachedTrails = [];
      this.lastThrustDir = { x: 0, y: 0 };
      this.lastTrailEmitPos = { x: 0, y: 0 };
      this.wasThrusting = false;
      this.damageTexts = [];
      this.player.size = { x: SPRITE_CONSTANTS.PLAYER_BASE_SIZE, y: SPRITE_CONSTANTS.PLAYER_BASE_SIZE };
      
      this.camera.zoom = CAMERA_CONSTANTS.DEFAULT_ZOOM;
      this.camera.position = { x: 0, y: 0 };
      this.shakeTimer = 0;
      this.camera.shakeOffset = { x: 0, y: 0 };

      this.gameState = GameState.MENU;
      this.prepareFrameEntities();
  }

  /**
   * Select a weapon by slot tap.
   * - Tapping an unowned / empty slot does nothing.
   * - Tapping the already-active non-blaster weapon toggles it off (switches to blaster).
   * - Tapping any other owned weapon switches to it.
   * At level 1 only one weapon is active at a time (exclusive selection).
   */
  private selectWeapon(wType: WeaponType) {
    const isBlaster = wType === WeaponType.BLASTER;
    const ammo      = this.player.ammo?.[wType] ?? 0;
    if (!isBlaster && ammo <= 0) return; // unowned / empty — ignore tap

    if (!isBlaster && this.player.currentWeapon === wType) {
      // Toggle off: deselect and fall back to blaster
      this.player.currentWeapon = WeaponType.BLASTER;
      this.currentWeaponIndex   = WEAPON_LIST.indexOf(WeaponType.BLASTER);
      this.player.burstQueue    = 0;
      return;
    }

    this.player.currentWeapon = wType;
    this.currentWeaponIndex   = WEAPON_LIST.indexOf(wType);
    this.player.burstQueue    = 0;
  }

  public cycleWeapon() {
    if (this.gameState !== GameState.PLAYING) return;
    // Only cycle through blaster (always owned) + weapons with ammo
    const owned = WEAPON_LIST.filter(w =>
      w === WeaponType.BLASTER ||
      ((this.player.ammo?.[w] ?? 0) > 0)
    );
    if (owned.length <= 1) return;
    const currentIdx = owned.indexOf(this.player.currentWeapon || WeaponType.BLASTER);
    const nextIdx = (currentIdx + 1) % owned.length;
    this.player.currentWeapon = owned[nextIdx];
    this.currentWeaponIndex = WEAPON_LIST.indexOf(this.player.currentWeapon);
    this.player.burstQueue = 0;
  }

  public setDifficulty(level: number) {
      const clamped = Math.min(3, Math.max(0, Math.round(level)));
      this.difficultyLevel = clamped;
      this.enemyScale = DIFFICULTY_SCALES[clamped] ?? 1;
      // Only restart if a game is already in progress; on the menu screen
      // just store the value so the next startGame() picks it up.
      if (this.gameState !== GameState.MENU) {
          this.restartGame();
      }
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
      shield: this.player.shield,
      maxShield: this.player.maxShield,
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
          enemy.weaponCooldown = Math.max(0, (enemy.weaponCooldown ?? 0) - dt);
          if (enemy.weaponCooldown > 0) continue;

          const dx = this.player.position.x - enemy.position.x;
          const dy = this.player.position.y - enemy.position.y;
          const distSq = dx * dx + dy * dy;
          if (distSq > rangeSq) continue;

          // Lazily init burst state — first trigger starts a fresh burst
          if (enemy.burstQueue === undefined) enemy.burstQueue = ENEMY_BURST_CONFIG.BURST_SIZE;

          // Slight inaccuracy
          const aimAngle = Math.atan2(dy, dx) + (Math.random() - 0.5) * (weapon.spread * Math.PI / 180);
          const targetX = enemy.position.x + Math.cos(aimAngle) * 500;
          const targetY = enemy.position.y + Math.sin(aimAngle) * 500;
          this.spawnProjectileFromConfig(enemy, { x: targetX, y: targetY }, weapon, EntityType.ENEMY);

          // Burst state: fire BURST_SIZE shots with BURST_GAP between them,
          // then wait BURST_RELOAD before starting the next burst.
          if (enemy.burstQueue > 1) {
              enemy.burstQueue--;
              enemy.weaponCooldown = ENEMY_BURST_CONFIG.BURST_GAP;
          } else {
              enemy.burstQueue = ENEMY_BURST_CONFIG.BURST_SIZE;
              enemy.weaponCooldown = ENEMY_BURST_CONFIG.BURST_RELOAD;
          }
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
        this.handleScreenShake,
        this.handleProjectileHit
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
          const isDropShard = e.type === EntityType.INTERACTABLE && !!e.dropType && e.dropType !== 'health';
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

      // Nebula dynamics: strong gravity pull of small shards toward larger
      // nebula neighbours, plus merge-on-contact absorption.  Runs after
      // physics integration so shard positions are up-to-date, and before
      // compaction so absorbed shards are dropped from the entities array
      // on the same frame.
      this.updateNebulaDynamics(dt);

      // In-place compaction (Garbage Free)
      // Inactive tiles with regenProgress set are kept as ghost placeholders
      // — applies to both glass (STRUCTURE) and nebula (NEBULA) tiles.
      let writeIdx = 0;
      for (let i = 0; i < this.currentMap.entities.length; i++) {
          const ent = this.currentMap.entities[i];
          const isRegenGhost = (ent.type === EntityType.STRUCTURE || ent.type === EntityType.NEBULA)
                               && ent.regenProgress !== undefined;
          if (ent.active || isRegenGhost) {
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

      if (entity.type === EntityType.NEBULA || entity.type === EntityType.NEBULA_SHARD) {
          // Both tiles and shards shatter into N children at
          // SHARD_LINEAR_RATIO of parent diameter.  Tile regen (below)
          // caps permanent growth by resetting tile size to the canonical
          // hex dimensions on respawn.
          this.spawnNebulaShards(entity);
      }

      if (entity.type === EntityType.NEBULA) {
          // Nebula tiles regenerate on the same cadence as glass tiles.
          // The entity stays in currentMap.entities as an inactive
          // placeholder (preserved by the compaction check below) until
          // the regen timer expires, at which point it pops back with
          // its canonical hex size — this is how merge-grown tiles
          // revert to original dimensions (otherwise area would compound).
          entity.regenProgress = 0;
          this.pendingRegens.push({ entity, timer: NEBULA_CONSTANTS.REGEN_DELAY });
      }

      if (entity.type === EntityType.ENEMY) {
          this.spawnEnemyShards(entity);
      }

      // Death burst particles — size/color tuned per entity type
      if (entity.type === EntityType.ENEMY) {
          // Large colored burst matching the enemy's tier color, plus a white core flash
          this.spawnParticles(entity.position, 10 + Math.floor(Math.random() * 4), entity.color || '#f87171', {
              speedMin: 3, speedMax: 10, sizeMin: 1.5, sizeMax: 3.5,
              lifetimeMin: 0.3, lifetimeMax: 0.6,
          });
          this.spawnParticles(entity.position, 5, '#ffffff', {
              speedMin: 5, speedMax: 14, sizeMin: 1, sizeMax: 2,
              lifetimeMin: 0.15, lifetimeMax: 0.3,
          });
      } else if (entity.type === EntityType.PLAYER) {
          // Cyan energy explosion
          this.spawnParticles(entity.position, 12, '#38bdf8', {
              speedMin: 4, speedMax: 12, sizeMin: 1.5, sizeMax: 3,
              lifetimeMin: 0.3, lifetimeMax: 0.6,
          });
          this.spawnParticles(entity.position, 6, '#ffffff', {
              speedMin: 6, speedMax: 16, sizeMin: 1, sizeMax: 2,
              lifetimeMin: 0.15, lifetimeMax: 0.3,
          });
      } else if (entity.type === EntityType.ASTEROID) {
          // Small shard/asteroid break — quick dusty puff
          const isTileShard = entity.shardType === 'tile';
          const breakColor = isTileShard ? (entity.color || '#6366f1') : '#94a3b8';
          this.spawnParticles(entity.position, 4, breakColor, {
              speedMin: 2, speedMax: 5, sizeMin: 1, sizeMax: 2,
              lifetimeMin: 0.15, lifetimeMax: 0.35,
          });
      } else if (entity.type === EntityType.NEBULA || entity.type === EntityType.NEBULA_SHARD) {
          // Nebula tiles fade out gracefully (see nebulaFadeTimer in the
          // renderer) and nebula shards vanish silently — no spark burst
          // on destruction.  Merge/transmute/regen events still emit the
          // subtle glimmer via spawnNebulaGlimmer.
      } else {
          // Generic fallback (structures, misc)
          const numParticles = 4 + Math.floor(Math.random() * 3);
          const { LIFETIME_MIN, LIFETIME_MAX, SPEED_MIN, SPEED_MAX, SIZE_MIN, SIZE_MAX } = PARTICLE_CONSTANTS;
          this.spawnParticles(entity.position, numParticles, entity.color || '#facc15', {
              speedMin: SPEED_MIN, speedMax: SPEED_MAX,
              sizeMin: SIZE_MIN, sizeMax: SIZE_MAX,
              lifetimeMin: LIFETIME_MIN, lifetimeMax: LIFETIME_MAX,
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

    // Tile regeneration tick — handles both STRUCTURE (glass) and NEBULA.
    // Nebula regen uses a rule-based color pass that reads its neighbours'
    // compositions from a lazily-built grid index (one scan per frame, not
    // one per regen, so the cost stays O(n) at worst).
    let nebulaGridIndex: Map<number, GameEntity> | null = null;
    const buildNebulaIndex = (): Map<number, GameEntity> => {
        if (nebulaGridIndex) return nebulaGridIndex;
        const map = new Map<number, GameEntity>();
        if (this.currentMap) {
            const ents = this.currentMap.entities;
            for (let k = 0; k < ents.length; k++) {
                const e = ents[k];
                if (e.type !== EntityType.NEBULA) continue;
                if (!e.active) continue;
                if (e.nebulaFadeTimer !== undefined) continue;
                if (e.nebulaGridCol === undefined || e.nebulaGridRow === undefined) continue;
                const key = (e.nebulaGridCol << 16) | (e.nebulaGridRow & 0xFFFF);
                map.set(key, e);
            }
        }
        nebulaGridIndex = map;
        return map;
    };

    for (let i = this.pendingRegens.length - 1; i >= 0; i--) {
        const regen = this.pendingRegens[i];
        regen.timer -= dt;
        // Progress is normalised against the per-type delay so both tile
        // types can share this loop with their own timing constants.
        const delay = regen.entity.type === EntityType.NEBULA
            ? NEBULA_CONSTANTS.REGEN_DELAY
            : STRUCTURE_CONSTANTS.TILE_REGEN_DELAY;
        regen.entity.regenProgress = 1 - (regen.timer / delay);

        if (regen.timer <= 0) {
            regen.entity.health = regen.entity.maxHealth;
            regen.entity.active = true;
            regen.entity.regenProgress = undefined;

            if (regen.entity.type === EntityType.NEBULA) {
                // Tiles never grow (only shards do), so size is already
                // canonical.  Rule-based colour regeneration (see
                // computeRegeneratedNebulaComposition) reads the
                // regenerating tile's 6 hex neighbours and blends their
                // compositions with the old tile's composition based on
                // isolation level — interior tiles smooth toward the
                // cluster average, edge tiles drift less, isolated
                // tiles keep their old hue exactly.
                regen.entity.nebulaColorComposition = this.computeRegeneratedNebulaComposition(
                    regen.entity,
                    buildNebulaIndex()
                );
                regen.entity.color = regen.entity.nebulaColorComposition[0].hex;
                // Fade in slowly instead of popping — no glimmer burst.
                regen.entity.nebulaSpawnTimer = NEBULA_CONSTANTS.FADE_IN_DURATION;
            } else {
                // Glass tile: existing pop-in animation.
                regen.entity.regenPopTimer = REGEN_POP_CONSTANTS.DURATION;
                this.spawnParticles(regen.entity.position, REGEN_POP_CONSTANTS.CHIP_COUNT, regen.entity.color || '#6366f1', {
                    speedMin: REGEN_POP_CONSTANTS.CHIP_SPEED_MIN,
                    speedMax: REGEN_POP_CONSTANTS.CHIP_SPEED_MAX,
                    lifetimeMin: REGEN_POP_CONSTANTS.CHIP_LIFETIME,
                    lifetimeMax: REGEN_POP_CONSTANTS.CHIP_LIFETIME,
                    sizeMin: 1, sizeMax: 2,
                });
            }

            // Re-add to the static grid so collisions start hitting again.
            this.physics.addStaticEntity(regen.entity);
            this.pendingRegens.splice(i, 1);

            // The just-regenerated tile should now count as a neighbour for
            // any later regens in this same frame (cluster-wide shatter).
            if (regen.entity.type === EntityType.NEBULA
                && regen.entity.nebulaGridCol !== undefined
                && regen.entity.nebulaGridRow !== undefined) {
                const key = (regen.entity.nebulaGridCol << 16)
                          | (regen.entity.nebulaGridRow & 0xFFFF);
                buildNebulaIndex().set(key, regen.entity);
            }
        }
    }

    // Tick down regenPopTimer on tiles
    if (this.currentMap) {
        const ents = this.currentMap.entities;
        for (let i = 0; i < ents.length; i++) {
            const e = ents[i];
            if (e.regenPopTimer !== undefined && e.regenPopTimer > 0) {
                e.regenPopTimer -= dt;
                if (e.regenPopTimer <= 0) {
                    e.regenPopTimer = undefined;
                }
            }
        }
    }

    // Tick down wave announcements
    for (let i = this.waveAnnouncements.length - 1; i >= 0; i--) {
        this.waveAnnouncements[i].lifetime -= dt;
        if (this.waveAnnouncements[i].lifetime <= 0) {
            this.waveAnnouncements.splice(i, 1);
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

        // Wave clear announcement
        const clearLife = WAVE_ANNOUNCE_CONSTANTS.FADEIN + WAVE_ANNOUNCE_CONSTANTS.HOLD + WAVE_ANNOUNCE_CONSTANTS.FADEOUT;
        this.waveAnnouncements.push({
          text: `WAVE ${this.waveIndex + 1} CLEAR`,
          color: '#4ade80',
          lifetime: clearLife,
          maxLifetime: clearLife,
        });

        // Difficulty-scaled health drop interval
        const healthInterval = HEALTH_DROP_INTERVAL[this.difficultyLevel] ?? 20;
        if ((this.waveIndex + 1) % healthInterval === 0) {
          const hAngle = Math.random() * Math.PI * 2;
          const hDist  = 20 + Math.random() * 80; // 20–100 units from player
          const hPos   = {
            x: this.player.position.x + Math.cos(hAngle) * hDist,
            y: this.player.position.y + Math.sin(hAngle) * hDist,
          };
          this.spawnHealthDrop(hPos, DROP_CONFIG.HEALTH_HEAL_AMOUNT);
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
    this.player.velocity.x += moveDir.x * acc * timeScale;
    this.player.velocity.y += moveDir.y * acc * timeScale;
    const throttle = Math.sqrt(moveDir.x * moveDir.x + moveDir.y * moveDir.y);

    const currentSpeed = Math.sqrt(this.player.velocity.x**2 + this.player.velocity.y**2);
    if (currentSpeed > maxSpeed) {
        this.player.velocity.x = (this.player.velocity.x / currentSpeed) * maxSpeed;
        this.player.velocity.y = (this.player.velocity.y / currentSpeed) * maxSpeed;
    }

    if (this.player.trail) {
        this.tickTrail(this.player.trail, dt);
    }
    // Tick detached trails (ones from prior thrust events) and drop empty arrays
    for (let i = this.detachedTrails.length - 1; i >= 0; i--) {
        this.tickTrail(this.detachedTrails[i], dt);
        if (this.detachedTrails[i].length === 0) {
            this.detachedTrails.splice(i, 1);
        }
    }

    const thrusting = throttle > 0;
    // Start of a fresh thrust event — detach the old active trail so it
    // continues to drift and fade on its own, then start a new empty trail
    // for the new thrust event.  This prevents the spatial gradient fill
    // from re-lighting faded old points when a new bright head is appended.
    if (thrusting && !this.wasThrusting) {
        if (this.player.trail && this.player.trail.length > 0) {
            this.detachedTrails.push(this.player.trail);
        }
        this.player.trail = [];
        // Snap the thrust direction to the new input so the first emitted
        // point of the fresh trail uses the actual direction, not whatever
        // was cached from the previous thrust event.
        this.lastThrustDir.x = moveDir.x / throttle;
        this.lastThrustDir.y = moveDir.y / throttle;
        this.lastTrailEmitPos.x = this.player.position.x;
        this.lastTrailEmitPos.y = this.player.position.y;
    }
    this.wasThrusting = thrusting;
    if (thrusting) {
        this.trailDecayTimer = GameEngine.TRAIL_DECAY_DURATION;
        // Target (normalized) thrust direction from current input
        const tx = moveDir.x / throttle;
        const ty = moveDir.y / throttle;
        // Smoothly ease the stored direction toward the target so rapid input
        // changes produce curves rather than sharp corners in the trail.  A
        // framerate-compensated lerp keeps the feel consistent across dt.
        const alpha = 1 - Math.pow(1 - GameEngine.THRUST_DIR_SMOOTH, dt * 60);
        this.lastThrustDir.x += (tx - this.lastThrustDir.x) * alpha;
        this.lastThrustDir.y += (ty - this.lastThrustDir.y) * alpha;
        // Re-normalize
        const dl = Math.sqrt(this.lastThrustDir.x * this.lastThrustDir.x + this.lastThrustDir.y * this.lastThrustDir.y);
        if (dl > 0.0001) {
            this.lastThrustDir.x /= dl;
            this.lastThrustDir.y /= dl;
        } else {
            // Fallback if interpolation collapsed to zero (e.g. 180° reversal)
            this.lastThrustDir.x = tx;
            this.lastThrustDir.y = ty;
        }
    } else {
        this.trailDecayTimer = Math.max(0, this.trailDecayTimer - dt);
    }

    // Distance-gated emission — compare against the last EMISSION position
    // rather than the last trail point, since points drift after emission.
    const emitDx = this.player.position.x - this.lastTrailEmitPos.x;
    const emitDy = this.player.position.y - this.lastTrailEmitPos.y;
    const emitDistSq = emitDx * emitDx + emitDy * emitDy;
    const hasTrail = !!this.player.trail && this.player.trail.length > 0;

    if (this.trailDecayTimer > 0 &&
            (!hasTrail || emitDistSq > TRAIL_CONSTANTS.MIN_DISTANCE_SQ)) {
        // t: 1.0 while thrusting, tapers to 0 over the decay window.
        // Lifetime shrinks so points vanish sooner; scale shrinks so they start narrower.
        const t = this.trailDecayTimer / GameEngine.TRAIL_DECAY_DURATION;
        const pointLifetime = TRAIL_CONSTANTS.LIFETIME * t;
        // Offset emission to the ship's rear relative to thrust direction so
        // the trail visibly comes out the back, not the center of the sprite.
        const halfSize = this.player.size.x / 2;
        const tdx = this.lastThrustDir.x;
        const tdy = this.lastThrustDir.y;
        const drift = GameEngine.THRUST_TRAIL_DRIFT;
        this.player.trail = this.player.trail || [];
        this.player.trail.push({
            x: this.player.position.x - tdx * halfSize,
            y: this.player.position.y - tdy * halfSize,
            lifetime: pointLifetime,
            maxLifetime: pointLifetime,
            scale: t,
            // Per-frame backward drift so consecutive points form a strip
            // aligned with the thrust axis regardless of player motion.
            vx: -tdx * drift,
            vy: -tdy * drift,
        });
        this.lastTrailEmitPos.x = this.player.position.x;
        this.lastTrailEmitPos.y = this.player.position.y;
    }

    // Glitter trail — emits independently of thrust, based purely on motion
    this.spawnGlitterTrail();

    const mousePos = this.input.getMousePosition();
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    this.player.rotation = Math.atan2(mousePos.y - cy, mousePos.x - cx);

    const fireEvents = this.input.getFireEvents();
    fireEvents.forEach(evt => {
        const { SIZE, EXPANDED_SIZE, MARGIN } = MINIMAP_CONSTANTS;
        const currentSize = this.minimapExpanded ? EXPANDED_SIZE : SIZE;
        const mapX = MARGIN;
        const mapY = window.innerHeight - currentSize - AMMO_HUD_CONSTANTS.BOTTOM_MARGIN;

        if (evt.x >= mapX && evt.x <= mapX + currentSize &&
            evt.y >= mapY && evt.y <= mapY + currentSize) {

            if (this.minimapDebounce > 0) return;

            this.minimapExpanded = !this.minimapExpanded;
            this.minimapTimer = this.minimapExpanded ? 5.0 : 0;
            this.minimapDebounce = 0.3;
            return;
        }

        // Ammo HUD slot selection — intercept taps on the weapon slots
        const { SLOT_H, SLOT_GAP } = AMMO_HUD_CONSTANTS;
        const { startX: slotStartX, startY: slotStartY, slotW } =
            computeAmmoHUDLayout(window.innerWidth, window.innerHeight);

        if (evt.y >= slotStartY && evt.y <= slotStartY + SLOT_H) {
            for (let i = 0; i < WEAPON_LIST.length; i++) {
                const sx = slotStartX + i * (slotW + SLOT_GAP);
                if (evt.x >= sx && evt.x <= sx + slotW) {
                    this.selectWeapon(WEAPON_LIST[i]);
                    return;
                }
            }
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
            if (config.type === WeaponType.BURST) this.handleScreenShake(3);
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

    // Player HUD message tick
    let msgIdx = 0;
    for (let i = 0; i < this.playerMessages.length; i++) {
        this.playerMessages[i].lifetime -= dt;
        if (this.playerMessages[i].lifetime > 0) {
            this.playerMessages[msgIdx++] = this.playerMessages[i];
        }
    }
    this.playerMessages.length = msgIdx;

    // Tick down per-weapon ammo pickup flash timers
    if (this.player.ammoPickupFlash) {
      for (const wType of WEAPON_LIST) {
        const f = this.player.ammoPickupFlash[wType];
        if (f && f.timer > 0) {
          f.timer -= dt;
          if (f.timer <= 0) delete this.player.ammoPickupFlash[wType];
        }
      }
    }

    // Proximity collection + magnetic pull — single pass over activeDrops
    if (!this.player.isExploding) {
      const collectRadSq = DROP_CONFIG.COLLECT_RADIUS * DROP_CONFIG.COLLECT_RADIUS;
      const MAGNET_RANGE_SQ = 150 * 150;
      const MAGNET_ACCEL    = 7; // world-units/s² toward player; scales up as dist shrinks
      for (let i = 0; i < this.activeDrops.length; i++) {
        const drop = this.activeDrops[i];
        if (!drop.active || drop.dropType === 'health') continue;
        const dx     = this.player.position.x - drop.position.x;
        const dy     = this.player.position.y - drop.position.y;
        const distSq = dx * dx + dy * dy;
        if (distSq <= collectRadSq) {
          this.applyDropEffect(drop);
          drop.active = false;
          continue;
        }
        if (distSq < MAGNET_RANGE_SQ) {
          const dist = Math.sqrt(distSq);
          const a    = MAGNET_ACCEL / dist; // inverse-linear: stronger when closer
          drop.velocity.x += dx * a * dt;
          drop.velocity.y += dy * a * dt;
        }
      }
      // Health drop proximity check (no magnet — static heart)
      const cr2 = collectRadSq;
      for (let i = 0; i < this.activeDrops.length; i++) {
        const drop = this.activeDrops[i];
        if (!drop.active || drop.dropType !== 'health') continue;
        const dx = this.player.position.x - drop.position.x;
        const dy = this.player.position.y - drop.position.y;
        if (dx * dx + dy * dy <= cr2) {
          this.applyDropEffect(drop);
          drop.active = false;
        }
      }
    }

    // Remove drops that were deactivated (collected, shot, or expired).
    let dropWriteIdx = 0;
    for (let i = 0; i < this.activeDrops.length; i++) {
        if (this.activeDrops[i].active) this.activeDrops[dropWriteIdx++] = this.activeDrops[i];
    }
    this.activeDrops.length = dropWriteIdx;


    this.camera.position.x = this.player.position.x;
    this.camera.position.y = this.player.position.y;
  }

  // ── Player HUD messages ─────────────────────────────────────────────────────

  private pushPlayerMessage(text: string, color: string, lifetime = 2.5) {
    this.playerMessages.push({
      id: `hud_${Date.now()}_${Math.random()}`,
      text,
      color,
      lifetime,
      maxLifetime: lifetime,
    });
    // Keep the list bounded; drop the oldest entry when over the cap
    if (this.playerMessages.length > this.MAX_PLAYER_MESSAGES) {
      this.playerMessages.shift();
    }
  }

  // ── Particle helpers ────────────────────────────────────────────────────────

  private spawnParticles(
    position: Vector2,
    count: number,
    color: string,
    options?: {
      speedMin?: number;
      speedMax?: number;
      sizeMin?: number;
      sizeMax?: number;
      lifetimeMin?: number;
      lifetimeMax?: number;
      spreadAngle?: number; // center angle (radians); undefined = full circle
      spreadCone?: number;  // half-cone in radians; undefined = Math.PI (full circle)
      baseVelocity?: Vector2;
      positionJitter?: number; // random offset radius around `position` (default 0)
    }
  ) {
    if (!this.currentMap) return;
    const {
      speedMin = 2, speedMax = 5,
      sizeMin = 1, sizeMax = 3,
      lifetimeMin = 0.2, lifetimeMax = 0.45,
      spreadAngle, spreadCone,
      baseVelocity,
      positionJitter = 0,
    } = options ?? {};

    const halfCone = spreadCone ?? Math.PI;

    for (let i = 0; i < count; i++) {
      const angle = spreadAngle !== undefined
        ? spreadAngle + (Math.random() - 0.5) * 2 * halfCone
        : Math.random() * Math.PI * 2;
      const speed = speedMin + Math.random() * (speedMax - speedMin);
      const size  = sizeMin + Math.random() * (sizeMax - sizeMin);
      const life  = lifetimeMin + Math.random() * (lifetimeMax - lifetimeMin);

      // Optional position scatter — useful for spawning glittery clouds
      // over an area (e.g. nebula merge glimmer) instead of a single point.
      let px = position.x;
      let py = position.y;
      if (positionJitter > 0) {
        const jAngle = Math.random() * Math.PI * 2;
        const jDist  = Math.sqrt(Math.random()) * positionJitter; // uniform area
        px += Math.cos(jAngle) * jDist;
        py += Math.sin(jAngle) * jDist;
      }

      this.currentMap.entities.push({
        id: `part_${Date.now()}_${i}_${Math.random()}`,
        type: EntityType.PARTICLE,
        position: { x: px, y: py },
        velocity: {
          x: Math.cos(angle) * speed + (baseVelocity?.x ?? 0),
          y: Math.sin(angle) * speed + (baseVelocity?.y ?? 0),
        },
        size:      { x: size, y: size },
        rotation:  0,
        color,
        active:    true,
        health:    1,
        maxHealth: 1,
        lifetime:  life,
        maxLifetime: life,
        mass:      0.1,
      });
    }
  }

  /**
   * Subtle glittery glimmer burst used for nebula merge / transmute /
   * regen feedback.  Spawns two small passes of tiny additive particles
   * scattered within a radius around the centre point:
   *   - 3 white highlight motes
   *   - 4 tint-coloured softer motes
   *
   * Kept deliberately sparse so cloud events read as a quiet twinkle
   * rather than a bright particle burst.
   */
  private spawnNebulaGlimmer(position: Vector2, radius: number, tint: string) {
    // White highlight pass — sparse punctuation points
    this.spawnParticles(position, 3, '#ffffff', {
      speedMin: 0.1, speedMax: 0.5,
      sizeMin: 0.3, sizeMax: 0.9,
      lifetimeMin: 0.4, lifetimeMax: 0.8,
      positionJitter: radius,
    });
    // Tinted pass — softer, slightly larger coloured motes around/between
    this.spawnParticles(position, 4, tint, {
      speedMin: 0.1, speedMax: 0.4,
      sizeMin: 0.4, sizeMax: 1.1,
      lifetimeMin: 0.5, lifetimeMax: 1.0,
      positionJitter: radius * 1.2,
    });
  }

  /**
   * Tick a trail array: decrement each point's lifetime, apply per-point
   * drift velocity, and splice expired entries.  Shared between the active
   * player trail and detached trails from prior thrust events.
   */
  private tickTrail(trail: TrailPoint[], dt: number) {
    for (let i = trail.length - 1; i >= 0; i--) {
      const tp = trail[i];
      tp.lifetime -= dt;
      if (tp.vx !== undefined) tp.x += tp.vx;
      if (tp.vy !== undefined) tp.y += tp.vy;
      if (tp.lifetime <= 0) {
        trail.splice(i, 1);
      }
    }
  }

  /**
   * Glitter trail — spawns tiny additive-blended sparkles trailing behind the
   * player along the current velocity vector.  Density is triangularly
   * distributed across the player's width (peaked on the center-line, falling
   * off toward the edges).  Particles have zero velocity so they stay put
   * while the player moves forward, naturally forming a trail.
   */
  private spawnGlitterTrail() {
    if (!this.currentMap) return;
    const v = this.player.velocity;
    const speedSq = v.x * v.x + v.y * v.y;
    if (speedSq < GLITTER_TRAIL_CONSTANTS.MIN_SPEED_SQ) return;

    const speed = Math.sqrt(speedSq);
    // Forward unit vector (direction of travel) and its perpendicular
    const fx = v.x / speed;
    const fy = v.y / speed;
    const perpX = -fy;
    const perpY = fx;

    const halfWidth = this.player.size.x / 2;
    // Spawn at the player's tail so particles appear behind, not on top of, the sprite
    const tailX = this.player.position.x - fx * halfWidth;
    const tailY = this.player.position.y - fy * halfWidth;

    const { COUNT_PER_FRAME, LIFETIME_MIN, LIFETIME_MAX, SIZE_MIN, SIZE_MAX, COLORS: GCOLORS } = GLITTER_TRAIL_CONSTANTS;

    for (let i = 0; i < COUNT_PER_FRAME; i++) {
      // Triangular distribution in [-1, 1] peaked at 0 — gives denser center,
      // sparser edges across the player's width.
      const u = Math.random() - Math.random();
      const lateral = u * halfWidth;

      const life = LIFETIME_MIN + Math.random() * (LIFETIME_MAX - LIFETIME_MIN);
      const size = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN);
      const color = GCOLORS[Math.floor(Math.random() * GCOLORS.length)];

      this.currentMap.entities.push({
        id: `glit_${Date.now()}_${i}_${Math.random()}`,
        type: EntityType.PARTICLE,
        position: {
          x: tailX + perpX * lateral,
          y: tailY + perpY * lateral,
        },
        velocity: { x: 0, y: 0 },
        size: { x: size, y: size },
        rotation: 0,
        color,
        active: true,
        health: 1,
        maxHealth: 1,
        lifetime: life,
        maxLifetime: life,
        mass: 0.01,
      });
    }
  }

  private handleProjectileHit = (impactPos: Vector2, proj: GameEntity, target: GameEntity) => {
    // Derive impact direction for a slight forward cone bias
    const projSpeed = Math.sqrt(proj.velocity.x ** 2 + proj.velocity.y ** 2) || 1;
    const impactAngle = Math.atan2(proj.velocity.y, proj.velocity.x);

    switch (target.type) {
      case EntityType.ENEMY:
        // Bright sparks in the enemy's own color, spread forward from impact
        this.spawnParticles(impactPos, 6, target.color || '#f87171', {
          speedMin: 3, speedMax: 8, sizeMin: 1.5, sizeMax: 3,
          spreadAngle: impactAngle, spreadCone: Math.PI * 0.6,
        });
        break;

      case EntityType.PLAYER:
        // Sparks deflect away from the contact point (opposite of incoming direction)
        this.spawnParticles(impactPos, 8, '#38bdf8', {
          speedMin: 4, speedMax: 9, sizeMin: 1, sizeMax: 2.5,
          spreadAngle: impactAngle + Math.PI, spreadCone: Math.PI * 0.65,
        });
        this.spawnParticles(impactPos, 3, '#ffffff', {
          speedMin: 6, speedMax: 12, sizeMin: 0.5, sizeMax: 1.5,
          spreadAngle: impactAngle + Math.PI, spreadCone: Math.PI * 0.45,
        });
        break;

      case EntityType.ASTEROID: {
        // Gray rocky dust, smaller and slower
        const dustCount = target.size.x > 50 ? 5 : 3;
        this.spawnParticles(impactPos, dustCount, '#94a3b8', {
          speedMin: 1.5, speedMax: 4, sizeMin: 1, sizeMax: 2,
          spreadAngle: impactAngle, spreadCone: Math.PI * 0.55,
          baseVelocity: { x: target.velocity.x * 0.3, y: target.velocity.y * 0.3 },
        });
        break;
      }

      case EntityType.STRUCTURE:
        // Tile sparks: two layers — colored chips + white hot sparks
        this.spawnParticles(impactPos, 4, target.color || '#6366f1', {
          speedMin: 3, speedMax: 7, sizeMin: 1, sizeMax: 2,
          spreadAngle: impactAngle, spreadCone: Math.PI * 0.65,
        });
        this.spawnParticles(impactPos, 3, '#ffffff', {
          speedMin: 5, speedMax: 10, sizeMin: 0.5, sizeMax: 1.5,
          spreadAngle: impactAngle, spreadCone: Math.PI * 0.5,
        });
        break;

      case EntityType.INTERACTABLE:
        // Small glint when hitting a drop item
        this.spawnParticles(impactPos, 3, proj.color || '#facc15', {
          speedMin: 2, speedMax: 5, sizeMin: 1, sizeMax: 2,
        });
        break;
    }
    void projSpeed; // suppress lint
  };

  private spawnDamageText = (pos: Vector2, amount: number, target?: GameEntity) => {
      // Player damage goes to the HUD list, not the world-space float
      if (target?.type === EntityType.PLAYER) {
          const isCrit = amount > 3;
          this.pushPlayerMessage(
              `-${Math.round(amount)}`,
              isCrit ? DAMAGE_TEXT_CONSTANTS.CRIT_COLOR : '#f87171',
              isCrit ? 2.8 : 2.2
          );
          return;
      }
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

      entity.isExploding = true;
      entity.explosionTimer = EXPLOSION_CONSTANTS.DURATION;
      entity.sprite = undefined;
      entity.velocity = { x: 0, y: 0 };
      entity.hitFlash = 0;
      entity.active = false; // Hide immediately — particles carry the effect
  }

  private respawnPlayer() {
      const spawn = this.currentMap?.playerSpawn || { x: 0, y: 0 };
      this.player.isExploding = false;
      this.player.explosionTimer = undefined;
      this.player.health = this.player.maxHealth;
      this.player.shield = this.player.maxShield;
      this.player.shieldRechargeTimer = 0;
      this.player.shieldHitFlash = 0;
      this.player.active = true;
      this.player.sprite = ASSETS.PLAYER_SHIP;
      this.player.size = { x: SPRITE_CONSTANTS.PLAYER_BASE_SIZE, y: SPRITE_CONSTANTS.PLAYER_BASE_SIZE };
      this.player.position = { ...spawn };
      this.player.velocity = { x: 0, y: 0 };
      this.player.rotation = 0;
      this.player.trail = [];
      this.detachedTrails = [];
      this.trailDecayTimer = 0;
      this.lastThrustDir = { x: 0, y: 0 };
      this.lastTrailEmitPos = { x: this.player.position.x, y: this.player.position.y };
      this.wasThrusting = false;
      this.player.weaponCooldown = 0;
      this.player.burstQueue = 0;
      this.player.burstTimer = 0;
      this.shakeTimer = 0;
      this.camera.shakeOffset = { x: 0, y: 0 };
      this.camera.position = { ...this.player.position };
  }

  private handleShooting(target: Vector2) {
      if (this.player.weaponCooldown && this.player.weaponCooldown > 0) return;

      let weaponType = this.player.currentWeapon || WeaponType.BLASTER;

      // If non-blaster and out of ammo, auto-fallback to blaster
      if (weaponType !== WeaponType.BLASTER && (this.player.ammo?.[weaponType] ?? 0) <= 0) {
          weaponType = WeaponType.BLASTER;
          this.player.currentWeapon = WeaponType.BLASTER;
          this.currentWeaponIndex = WEAPON_LIST.indexOf(WeaponType.BLASTER);
          this.player.burstQueue = 0;
      }

      const config = WEAPONS[weaponType];
      this.player.weaponCooldown = config.cooldown;

      // Deduct ammo for non-blaster weapons (one shot = one ammo unit)
      if (weaponType !== WeaponType.BLASTER && this.player.ammo) {
          const before = this.player.ammo[weaponType] ?? 0;
          this.player.ammo[weaponType] = Math.max(0, before - 1);
          if (this.player.ammo[weaponType] === 0) {
              // Will auto-switch on next shot; leave current active until then
          }
      }

      if (config.type === WeaponType.SHOTGUN) {
          this.handleScreenShake(5);
      } else if (config.type === WeaponType.CANNON) {
          this.handleScreenShake(COLLISION_CONFIG.SHAKE.MEDIUM);
      } else if (config.type === WeaponType.BURST) {
          this.handleScreenShake(3);
      }

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
          if (d.active && d.dropType !== 'glass' && d.dropType !== 'powerup' && d.dropType !== 'health') candidates.push(d);
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

          if (drop.dropType === 'ammo' && drop.dropWeapon !== undefined) {
              comp.push({ type: 'ammo', value: drop.dropValue ?? 1, weapon: drop.dropWeapon });
              const wColor = WEAPONS[drop.dropWeapon]?.color ?? '#ffffff';
              ast.powerupGlowColor = ast.powerupGlowColor
                  ? blendHexColors(ast.powerupGlowColor, wColor)
                  : wColor;
          } else if (drop.dropType === 'health') {
              comp.push({ type: 'health', value: drop.dropValue ?? 1 });
              const dColor = '#4ade80';
              ast.powerupGlowColor = ast.powerupGlowColor
                  ? blendHexColors(ast.powerupGlowColor, dColor)
                  : dColor;
          }

          ast.dropComposition = comp.length > 0 ? comp : undefined;
          ast.velocity.x = nvx; ast.velocity.y = nvy;
          drop.active = false;
      }

      // Soft sparkle at the merge point for all cases
      this.spawnParticles({ x: nmx, y: nmy }, 5, '#fbbf24', {
          speedMin: 1, speedMax: 4, sizeMin: 1, sizeMax: 2.5,
          lifetimeMin: 0.2, lifetimeMax: 0.4,
      });
      this.spawnParticles({ x: nmx, y: nmy }, 3, '#ffffff', {
          speedMin: 2, speedMax: 6, sizeMin: 0.5, sizeMax: 1.5,
          lifetimeMin: 0.1, lifetimeMax: 0.25,
      });
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
              ...(dropA.dropType === 'ammo' && dropA.dropWeapon
                  ? [{ type: 'ammo' as const, value: dropA.dropValue ?? 1, weapon: dropA.dropWeapon }]
                  : dropA.dropType === 'health'
                  ? [{ type: 'health' as const, value: dropA.dropValue ?? 1 }]
                  : []),
              ...(dropB.dropType === 'ammo' && dropB.dropWeapon
                  ? [{ type: 'ammo' as const, value: dropB.dropValue ?? 1, weapon: dropB.dropWeapon }]
                  : dropB.dropType === 'health'
                  ? [{ type: 'health' as const, value: dropB.dropValue ?? 1 }]
                  : []),
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

      // Dust/debris burst at the break point
      const dustColor  = isTile ? parent.color : '#94a3b8';
      const dustCount  = 5 + Math.floor(parent.size.x / 20);
      const dustSpeed  = impactSpeed * 0.4 + 2;
      this.spawnParticles(parent.position, dustCount, dustColor, {
          speedMin: 1, speedMax: dustSpeed,
          sizeMin: 1, sizeMax: 2.5,
          lifetimeMin: 0.25, lifetimeMax: 0.55,
          spreadAngle: impactAngle ?? undefined,
          spreadCone: Math.PI,
          baseVelocity: parent.velocity,
      });
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

    // Flanking: divide enemies into groups arriving from evenly-spaced angles.
    // A random base rotation ensures no two waves look the same.
    const numFlanks = totalEnemies >= 5 ? 3 : 2;
    const flankSpacing = (Math.PI * 2) / numFlanks;
    const flankBaseRotation = Math.random() * Math.PI * 2;

    for (const group of scaledGroups) {
      for (let i = 0; i < group.count; i++) {
        const flankIdx = enemyIdx % numFlanks;
        const baseAngle = flankBaseRotation + flankIdx * flankSpacing + (Math.random() - 0.5) * flankSpacing * 0.35;
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

    // Wave start announcement
    const totalLife = WAVE_ANNOUNCE_CONSTANTS.FADEIN + WAVE_ANNOUNCE_CONSTANTS.HOLD + WAVE_ANNOUNCE_CONSTANTS.FADEOUT;
    this.waveAnnouncements.push({
      text: `WAVE ${index + 1}`,
      subtext: 'GET READY',
      color: '#ffffff',
      lifetime: totalLife,
      maxLifetime: totalLife,
    });
  }


  /**
   * Apply the reward of a collected/broken drop directly to the player.
   * Called both from spawnDrops (when a drop is destroyed by a player projectile)
   * and previously from the contact-collection loop.
   */
  private applyDropEffect(entity: GameEntity) {
    if (entity.dropType === 'ammo' && entity.dropWeapon !== undefined) {
      const wType  = entity.dropWeapon;
      const amount = entity.dropValue ?? DROP_CONFIG.AMMO_PER_ASTEROID;
      if (!this.player.ammo) this.player.ammo = {};
      this.player.ammo[wType] = (this.player.ammo[wType] ?? 0) + amount;
      // Trigger slot flash — accumulate amount if picked up in quick succession
      if (!this.player.ammoPickupFlash) this.player.ammoPickupFlash = {};
      const prev = this.player.ammoPickupFlash[wType];
      this.player.ammoPickupFlash[wType] = {
        timer:  0.75,
        amount: (prev && prev.timer > 0 ? prev.amount : 0) + amount,
      };
    } else if (entity.dropType === 'health') {
      const healAmount = entity.dropValue ?? DROP_CONFIG.HEALTH_HEAL_AMOUNT;
      const healed = Math.min(healAmount, this.player.maxHealth - this.player.health);
      if (healed > 0) {
        this.player.health += healed;
        this.pushPlayerMessage(`+${Math.round(healed)}`, '#ef4444');
      }
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
        for (const comp of entity.dropComposition) {
          if (comp.type === 'ammo') {
            this.spawnAmmoDrop(pos, comp.weapon, comp.value, pv);
          } else if (comp.type === 'health') {
            this.spawnHealthDrop(pos, comp.value, pv);
          }
          // 'powerup' entries no longer spawn — powerup drops have been removed
        }
      } else if (Math.random() < DROP_CONFIG.AMMO_DROP_CHANCE_ASTEROID) {
        // Wave-scaled ammo drop — only some asteroids drop ammo
        const waveAmmoType = this.getAsteroidAmmoType();
        this.spawnAmmoDrop(pos, waveAmmoType, DROP_CONFIG.AMMO_PER_ASTEROID, pv);
      }

    }
  }

  /**
   * Set aggroTimer on all active enemies within AGGRO_RANGE of a kill position.
   * Called whenever an enemy is destroyed; nearby survivors become enraged,
   * gaining a speed boost and shortened idle time for AGGRO_DURATION seconds.
   */
  private triggerAggroNearby(position: Vector2) {
    if (!this.currentMap) return;
    const rangeSq = AI_CONFIG.AGGRO_RANGE * AI_CONFIG.AGGRO_RANGE;
    for (const e of this.currentMap.entities) {
      if (!e.active || e.type !== EntityType.ENEMY) continue;
      const dx = e.position.x - position.x;
      const dy = e.position.y - position.y;
      if (dx * dx + dy * dy > rangeSq) continue;
      e.aggroTimer = AI_CONFIG.AGGRO_DURATION;
    }
  }

  /**
   * Break a dead enemy into debris using the 70/15/10/5 split:
   *   70% tile shards  — visual debris only
   *   15% own-color ammo drop
   *   10% next-color ammo drop
   *    5% empty asteroid shard
   */
  private spawnEnemyShards(enemy: GameEntity) {
    if (!this.currentMap) return;

    const pos    = enemy.position;
    const pv     = enemy.velocity;
    const subtype = enemy.enemySubtype;
    const ammoMap = subtype ? ENEMY_AMMO_DROP[subtype] : null;

    // Plan: 6 tile shards + 1 own ammo + 1 next ammo + 1 empty asteroid (50 % chance)
    const TOTAL_PHYSICAL = 6 + 1 + 1 + (Math.random() < 0.5 ? 1 : 0);

    // Build the spawn list: 'tile' | 'asteroid' | 'own' | 'next'
    type SlotKind = 'tile' | 'asteroid' | 'own' | 'next';
    const slots: SlotKind[] = [];
    for (let i = 0; i < 6; i++) slots.push('tile');
    if (ammoMap) { slots.push('own'); slots.push('next'); }
    if (TOTAL_PHYSICAL > 8) slots.push('asteroid');
    // Shuffle so drops aren't always last
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }

    const total = slots.length;
    for (let i = 0; i < total; i++) {
      const baseAngle = (i / total) * Math.PI * 2;
      const angle     = baseAngle + (Math.random() - 0.5) * (Math.PI / total) * 1.5;
      const speed     = 1.5 + Math.random() * 3.0;
      const vx = pv.x * 0.2 + Math.cos(angle) * speed;
      const vy = pv.y * 0.2 + Math.sin(angle) * speed;

      const kind = slots[i];

      if (kind === 'own' && ammoMap && Math.random() < DROP_CONFIG.AMMO_DROP_CHANCE_ENEMY_OWN) {
        this.spawnAmmoDrop(pos, ammoMap.own, DROP_CONFIG.AMMO_PER_ENEMY_OWN, { x: vx * 5, y: vy * 5 });
        continue;
      }
      if (kind === 'next' && ammoMap && Math.random() < DROP_CONFIG.AMMO_DROP_CHANCE_ENEMY_NEXT) {
        this.spawnAmmoDrop(pos, ammoMap.next, DROP_CONFIG.AMMO_PER_ENEMY_NEXT, { x: vx * 5, y: vy * 5 });
        continue;
      }

      // Physical shard
      const isTile = kind === 'tile';
      const shardType: ShardType = isTile ? 'tile' : 'asteroid';
      const size    = 12 + Math.random() * 10;
      const numPts  = isTile ? (4 + Math.floor(Math.random() * 3)) : (5 + Math.floor(Math.random() * 3));
      const jitterK = isTile ? 0.25 : 0.8;
      const rMin    = isTile ? 0.60 : 0.55;
      const rRange  = isTile ? 0.55 : 0.70;
      const baseR   = (size / 2) * 0.8;
      const rawPts: { angle: number; r: number }[] = [];
      for (let j = 0; j < numPts; j++) {
        const ba = (j / numPts) * Math.PI * 2;
        const aj = (Math.random() - 0.5) * (Math.PI / numPts) * jitterK;
        rawPts.push({ angle: ba + aj, r: baseR * (rMin + Math.random() * rRange) });
      }
      rawPts.sort((a, b) => a.angle - b.angle);
      const pts: Vector2[] = rawPts.map(p => ({ x: Math.cos(p.angle) * p.r, y: Math.sin(p.angle) * p.r }));

      this.currentMap.entities.push({
        id:           `enemy_shard_${Date.now()}_${i}_${Math.random()}`,
        type:          EntityType.ASTEROID,
        shardType,
        position:     { x: pos.x, y: pos.y },
        velocity:     { x: vx, y: vy },
        size:         { x: size, y: size },
        rotation:      Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 2 * (2.5 / (size / 20)),
        color:         isTile ? '#b4e6fd' : COLORS.ASTEROID,
        active:        true,
        health:        1,
        maxHealth:     1,
        mass:          size,
        polygonPoints: pts,
      });
    }
  }

  /**
   * Generate an irregular shard polygon for a drop.
   * baseR controls visual size and should scale with the drop's value so
   * larger-value drops are physically bigger.
   */
  private generateShardPolygon(type: 'ammo' | 'health', baseR: number): Vector2[] {
    let numPoints: number;
    let radMin: number;
    let radMax: number;
    let angleJitterScale: number;
    if (type === 'ammo') {
      numPoints = 5 + Math.floor(Math.random() * 3);   // 5-7, jagged crystal
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

    // Impact sparks: tile-colored chips + bright white hot sparks
    const tileImpactAngle = tile.lastImpactVelocity
      ? Math.atan2(tile.lastImpactVelocity.y, tile.lastImpactVelocity.x)
      : undefined;
    this.spawnParticles(tile.position, 6, tile.color || '#6366f1', {
      speedMin: 2, speedMax: 7, sizeMin: 1, sizeMax: 2.5,
      lifetimeMin: 0.2, lifetimeMax: 0.45,
      spreadAngle: tileImpactAngle, spreadCone: Math.PI * 0.65,
    });
    this.spawnParticles(tile.position, 4, '#ffffff', {
      speedMin: 5, speedMax: 12, sizeMin: 0.5, sizeMax: 1.5,
      lifetimeMin: 0.1, lifetimeMax: 0.25,
      spreadAngle: tileImpactAngle, spreadCone: Math.PI * 0.5,
    });
  }

  /**
   * Shatter a destroyed nebula entity (tile OR shard) into
   * SHARDS_PER_SHATTER smaller children at SHARD_LINEAR_RATIO of the
   * parent's diameter.  With N = 3 and ratio = 0.6, total child area
   * ≈ 1.08 × parent — a modest ~8 % inflation per shatter, kept bounded
   * by tile regeneration (grown tiles revert to canonical hex size).
   *
   * Children are fan-spread in the REARWARD cone (180° ± FAN_HALF_ANGLE)
   * at an offset of SHARD_SPAWN_OFFSET_RATIO × parentRadius.  This puts
   * every child behind the striker's trajectory (away from both the
   * striker and the destroyed tile centre), so the striker doesn't
   * immediately plow into its own debris.
   *
   * Rotation sign follows the tangent rule: shards on the striker's
   * visual right spin CW (positive rotationSpeed in canvas coords),
   * shards on the left spin CCW.  Colinear shards get a random sign.
   *
   * Parent's colour composition is cloned into every child so shatter →
   * merge preserves hue through many cycles (see NebulaColor.blendCompositions).
   *
   * If the computed child diameter would fall below MIN_SHATTER_DIAMETER,
   * the shatter is skipped entirely — the parent is too small to break
   * further, and the caller should leave it alive (or have already passed
   * the check).  This keeps the shard population bounded.
   */
  private spawnNebulaShards(parent: GameEntity) {
    if (!this.currentMap) return;

    const parentDiameter = Math.max(parent.size.x, parent.size.y);
    const parentRadius   = parentDiameter / 2;
    // Explicit per-child linear ratio — 0.60 by default.  Total child
    // area = N × ratio² × parent_area; tile regen caps permanent growth.
    const childDiameter = parentDiameter * NEBULA_CONSTANTS.SHARD_LINEAR_RATIO;
    if (childDiameter < NEBULA_CONSTANTS.MIN_SHATTER_DIAMETER) return;

    const composition = parent.nebulaColorComposition;
    const count       = NEBULA_CONSTANTS.SHARDS_PER_SHATTER;

    // Striker direction (forward vector).  Canvas uses y-down, so "right"
    // of the striker's travel direction (as drawn on screen) corresponds
    // to a positive z-component of cross(forward, shard-offset) — the
    // tangent rule the user specified.
    const iv = parent.lastImpactVelocity;
    const impactSpeed = iv ? Math.sqrt(iv.x * iv.x + iv.y * iv.y) : 0;
    let fx = 1, fy = 0;
    if (iv && impactSpeed > 0.001) {
        fx = iv.x / impactSpeed;
        fy = iv.y / impactSpeed;
    }

    const spinK = Math.min(
        NEBULA_CONSTANTS.MAX_SPIN,
        1 + impactSpeed * NEBULA_CONSTANTS.SPIN_PER_UNIT_SPEED
    );

    // REARWARD fan: children spawn behind the striker's motion direction
    // so they're not in the striker's forward path.  Base angle = π (180°
    // from forward), spread symmetrically by ± FAN_HALF_ANGLE.  With
    // count = 3 and FAN = 60°, rear angles are [120°, 180°, 240°] — a
    // wide rear arc that clears the striker's trajectory on both sides.
    const fan  = NEBULA_CONSTANTS.FAN_HALF_ANGLE;
    const step = count > 1 ? (2 * fan) / (count - 1) : 0;
    const offsetMag = parentRadius * NEBULA_CONSTANTS.SHARD_SPAWN_OFFSET_RATIO;

    for (let i = 0; i < count; i++) {
        // Rear-cone angle: π + (−fan … +fan) relative to forward.
        const offsetAngle = Math.PI + (count > 1 ? -fan + step * i : 0);
        const cosA = Math.cos(offsetAngle);
        const sinA = Math.sin(offsetAngle);
        // Rotate forward vector by offsetAngle → this shard's direction
        const dx = fx * cosA - fy * sinA;
        const dy = fx * sinA + fy * cosA;

        // Spawn position: offset from parent centre along the rear-cone
        // direction by ~2 × parent radius, well outside the tile footprint.
        const spawnX = parent.position.x + dx * offsetMag;
        const spawnY = parent.position.y + dy * offsetMag;

        // Tangent-rule side: z-component of cross(forward, spawn-direction).
        // cross > 0 → shard is on the striker's visual right (CW rotation).
        // cross < 0 → shard is on the striker's visual left  (CCW rotation).
        // cross ≈ 0 → on-axis (centre shard) → random spin direction.
        const cross = fx * dy - fy * dx;
        const spinSign = cross > 0.01 ? 1
                        : cross < -0.01 ? -1
                        : (Math.random() < 0.5 ? 1 : -1);
        const rotationSpeed = spinSign * spinK;

        // Velocity: "dragged along" model.  The parallel component (in
        // the striker's direction of travel) dominates; the perpendicular
        // component is small and biased toward the shard's tangent side
        // so left-spawned shards drift slightly left and right-spawned
        // shards slightly right.  Forward drag is capped at a fraction
        // of the striker's own speed, so shards never outpace the striker
        // (no re-collision even if the player decelerates).
        const parallelSpeed = Math.max(
            NEBULA_CONSTANTS.MIN_PARALLEL_SPEED,
            impactSpeed * NEBULA_CONSTANTS.FORWARD_DRAG_FACTOR
        );
        const perpSpeed = impactSpeed * NEBULA_CONSTANTS.PERP_SCATTER_FACTOR;
        // Right tangent in canvas y-down coords = (-fy, fx).  Flip sign
        // for left-side shards.  Centre shards (side ≈ 0) get no perp.
        const perpSign = cross > 0.01 ? 1 : cross < -0.01 ? -1 : 0;
        const perpX = -fy * perpSign * perpSpeed;
        const perpY =  fx * perpSign * perpSpeed;
        const velX = fx * parallelSpeed + perpX;
        const velY = fy * parallelSpeed + perpY;

        this.currentMap.entities.push({
            id:             `nebula_shard_${Date.now()}_${i}_${Math.random()}`,
            type:            EntityType.NEBULA_SHARD,
            shardType:      'nebula',
            position:       { x: spawnX, y: spawnY },
            velocity:       { x: velX, y: velY },
            size:           { x: childDiameter, y: childDiameter },
            rotation:        Math.random() * Math.PI * 2,
            rotationSpeed,
            color:           composition ? blendCompositionToHex(composition) : (parent.color || NEBULA_CONSTANTS.DEFAULT_HEX),
            active:          true,
            health:          1,
            maxHealth:       1,
            mass:            childDiameter,
            sprite:          parent.sprite,
            nebulaColorComposition: composition ? cloneComposition(composition) : undefined,
            nebulaTileArea:  parent.nebulaTileArea,
            nebulaGridCol:   parent.nebulaGridCol,
            nebulaGridRow:   parent.nebulaGridRow,
            linearDamping:   NEBULA_CONSTANTS.LINEAR_DAMPING,
            angularDamping:  NEBULA_CONSTANTS.ANGULAR_DAMPING,
            // Fade-in on birth — shards slowly materialize behind the
            // striker instead of popping in instantly.
            nebulaSpawnTimer: NEBULA_CONSTANTS.FADE_IN_DURATION,
        });
    }
  }

  /**
   * Per-frame gravity + merge pass for nebula shards.
   *
   * Only NEBULA_SHARD entities participate — nebula TILES are immutable
   * sinks that never grow or absorb.  New tiles are born by shard
   * coalescence: when two shards merge and the combined disc area reaches
   * canonical HEX_AREA, the merged shard transmutes into a brand-new
   * NEBULA tile at the nearest clear grid cell (see tryTransmuteShardToTile).
   *
   * Each shard is pulled toward the nearest larger-or-equal neighbouring
   * shard within GRAVITY_RANGE.  Equal-sized pairs merge too — the
   * mergedThisFrame Set prevents duplicate processing within a single
   * frame, and the id check in the inner loop handles the rare exact-tie
   * case without infinite loops.
   *
   * Broadphase uses a cell grid over shards to avoid O(n²).
   */
  private updateNebulaDynamics(dt: number) {
    if (!this.currentMap) return;
    const ents = this.currentMap.entities;

    // Collect active nebula shards ONLY.  Tiles are not targets and
    // don't need to be spatially indexed for this pass.  Fading shards
    // are skipped — they're in their death animation and should not
    // iterate as sources or be valid merge targets.
    const all: GameEntity[] = [];
    for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        if (!e.active) continue;
        if (e.nebulaFadeTimer !== undefined) continue;
        if (e.type === EntityType.NEBULA_SHARD) {
            all.push(e);
        }
    }
    if (all.length < 2) return;

    // Spatial hash over GRAVITY_RANGE cells.
    const CELL = NEBULA_CONSTANTS.GRAVITY_RANGE;
    const grid = new Map<number, number[]>();
    for (let i = 0; i < all.length; i++) {
        const e = all[i];
        const cx = Math.floor(e.position.x / CELL);
        const cy = Math.floor(e.position.y / CELL);
        const key = (cx << 16) | (cy & 0xFFFF);
        let cell = grid.get(key);
        if (!cell) { cell = []; grid.set(key, cell); }
        cell.push(i);
    }

    const GRAV_RANGE_SQ = CELL * CELL;
    const GRAV_K        = NEBULA_CONSTANTS.GRAVITY_STRENGTH;
    const GRAV_MIN      = NEBULA_CONSTANTS.GRAVITY_MIN_DIST;
    const MERGE_K       = NEBULA_CONSTANTS.MERGE_PROXIMITY_K;

    // Per-frame set of targets that have already absorbed a shard.
    // Enforces "at most one merge per target per frame" so the three
    // children of a single shatter distribute across multiple neighbours
    // instead of all stacking into the same nearest tile.  Combined with
    // area-conserving shatter this keeps cluster growth bounded.
    const mergedThisFrame = new Set<GameEntity>();

    for (let i = 0; i < all.length; i++) {
        const shard = all[i];
        if (!shard.active) continue;
        if (shard.type !== EntityType.NEBULA_SHARD) continue;

        const shardR = Math.max(shard.size.x, shard.size.y) / 2;

        // Find nearest larger neighbour across the 3×3 cell block.
        const acx = Math.floor(shard.position.x / CELL);
        const acy = Math.floor(shard.position.y / CELL);

        let bestTarget: GameEntity | null = null;
        let bestDistSq = Infinity;

        for (let ncx = acx - 1; ncx <= acx + 1; ncx++) {
            for (let ncy = acy - 1; ncy <= acy + 1; ncy++) {
                const cell = grid.get((ncx << 16) | (ncy & 0xFFFF));
                if (!cell) continue;
                for (let k = 0; k < cell.length; k++) {
                    const j = cell[k];
                    if (j === i) continue;
                    const target = all[j];
                    if (!target.active) continue;
                    if (mergedThisFrame.has(target)) continue; // one merge/target/frame
                    const targetR = Math.max(target.size.x, target.size.y) / 2;
                    // Allow equal-size merges (relaxed from strictly larger).
                    // mergedThisFrame + inactive-check combine to prevent
                    // the race where A and B see each other as valid targets
                    // in the same frame and double-merge.
                    if (targetR < shardR) continue;

                    const dx = target.position.x - shard.position.x;
                    const dy = target.position.y - shard.position.y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq > GRAV_RANGE_SQ) continue;
                    if (distSq < bestDistSq) {
                        bestDistSq = distSq;
                        bestTarget = target;
                    }
                }
            }
        }

        if (!bestTarget) continue;

        const dx = bestTarget.position.x - shard.position.x;
        const dy = bestTarget.position.y - shard.position.y;
        const dist = Math.sqrt(bestDistSq);
        if (dist < 0.0001) continue;

        const targetR   = Math.max(bestTarget.size.x, bestTarget.size.y) / 2;
        const mergeDist = (targetR + shardR) * MERGE_K;

        if (dist <= mergeDist) {
            this.mergeNebulas(bestTarget, shard);
            mergedThisFrame.add(bestTarget);
            // Post-merge: if the grown shard is now large enough to form
            // a tile (disc area ≥ canonical hex area), try transmuting it.
            this.tryTransmuteShardToTile(bestTarget);
            continue;
        }

        // Strong linear-radial gravity: force ∝ 1 / max(dist, MIN_DIST).
        // Combined with the damping pass, this produces a steady terminal
        // drift toward the target rather than a runaway acceleration.
        const effDist = Math.max(dist, GRAV_MIN);
        const accel   = (GRAV_K * dt) / effDist;
        const invDist = 1 / dist;
        shard.velocity.x += (dx * invDist) * accel;
        shard.velocity.y += (dy * invDist) * accel;
    }
  }

  /**
   * Absorb a smaller nebula shard into a larger-or-equal nebula shard.
   * Only called on NEBULA_SHARD pairs (tiles are not merge targets).
   *
   * - larger.size grows so its disc area gains the smaller's disc area
   * - larger's position and sprite remain unchanged
   * - colour composition is blended weighted by each shard's area
   * - smaller becomes inactive and emits a brief particle puff as a
   *   "simple merge animation"
   *
   * Post-merge, the caller checks whether the grown shard should
   * transmute into a fresh NEBULA tile (see tryTransmuteShardToTile).
   */
  private mergeNebulas(larger: GameEntity, smaller: GameEntity) {
    const largeR = Math.max(larger.size.x, larger.size.y) / 2;
    const smallR = Math.max(smaller.size.x, smaller.size.y) / 2;
    const largeArea = Math.PI * largeR * largeR;
    const smallArea = Math.PI * smallR * smallR;
    const newArea = largeArea + smallArea;
    const newDiameter = Math.sqrt(newArea / Math.PI) * 2;

    // Grow the larger shard's size so its disc area gains the smaller's.
    // Shards are circles (polygon is absent), so size.x === size.y and
    // both the visual sprite and the gravity/merge radius scale up.
    larger.size.x = newDiameter;
    larger.size.y = newDiameter;
    larger.mass   = newDiameter;

    // Blend colour compositions weighted by area; larger dominates.
    larger.nebulaColorComposition = blendCompositions(
        larger.nebulaColorComposition, largeArea,
        smaller.nebulaColorComposition, smallArea
    );
    larger.color = blendCompositionToHex(larger.nebulaColorComposition);

    // Simple merge animation: glittery glimmer burst at the absorption
    // point, scattered within a radius matching the larger shard.
    const tint = blendCompositionToHex(larger.nebulaColorComposition);
    const glimmerR = Math.max(smaller.size.x, smaller.size.y) * 0.5;
    this.spawnNebulaGlimmer(smaller.position, glimmerR, tint);

    // Smaller vanishes; compaction pass at end of physics removes it.
    smaller.active = false;
  }

  /**
   * Deterministic, neighbourhood-aware colour rule for regenerating
   * nebula tiles.  Works directly in hue space over the blue / indigo /
   * violet / pink palette arc (NEBULA_PALETTE_HUE_MIN..MAX).
   *
   * Algorithm:
   *   1. Read old hue from the tile's previous composition.
   *   2. Gather 6 neighbour hues (active, non-fading NEBULA tiles) from
   *      the supplied grid index, weighted by each neighbour's disc area.
   *   3. Compute a linear area-weighted average of the neighbour hues.
   *      (Linear average is safe because the palette is a clamped [210,
   *      340] arc — no circular wraparound issues.)
   *   4. Mix with the old hue based on the tile's isolation:
   *        emptyCount     = 6 − activeNeighbours
   *        oldWeight      = emptyCount / 6
   *        neighborWeight = 1 − oldWeight
   *      So a fully surrounded tile adopts the neighbour average
   *      exactly; an isolated tile would stick with its old hue.
   *   5. Enforce a minimum hue shift: if the rule's natural output is
   *      closer than REGEN_MIN_HUE_SHIFT degrees to the old hue, step
   *      forward (or backward, based on a deterministic grid-parity
   *      sign) along the palette arc by exactly that minimum.  This
   *      guarantees every regeneration is visibly different from the
   *      previous colour — no silent "same hue" respawns.
   *   6. Clamp to the palette arc (defensive — stays within blue→pink).
   *   7. Return a single-stop composition at the configured palette
   *      saturation / lightness.
   *
   * The rule is fully deterministic — identical map state yields
   * identical regen colours, so the cloud evolves along a predictable
   * neighbourhood walk rather than into RNG noise.
   */
  private computeRegeneratedNebulaComposition(
    tile: GameEntity,
    nebulaIndex: Map<number, GameEntity>
  ): NebulaColorStop[] {
    // Derive the tile's previous hue.  If the tile has no composition
    // (shouldn't happen, but defensive), fall back to a fresh palette
    // pick so the new hue is still within range.
    const oldComp = tile.nebulaColorComposition;
    const oldHue = clampHueToPalette(
        oldComp && oldComp[0]
            ? hexToHueDeg(oldComp[0].hex)
            : hexToHueDeg(randomNebulaComposition()[0].hex)
    );

    // Collect neighbour hues, area-weighted.
    let avgNeighborHue = oldHue;
    let activeCount = 0;

    if (tile.nebulaGridCol !== undefined && tile.nebulaGridRow !== undefined) {
        const neighbors = TileGenerator.getHexNeighbors(tile.nebulaGridCol, tile.nebulaGridRow);
        let hueSum = 0;
        let weightSum = 0;
        for (const n of neighbors) {
            const key = (n.c << 16) | (n.r & 0xFFFF);
            const nTile = nebulaIndex.get(key);
            if (!nTile || !nTile.nebulaColorComposition || nTile === tile) continue;
            const hex = nTile.nebulaColorComposition[0]?.hex;
            if (!hex) continue;
            const nHue = clampHueToPalette(hexToHueDeg(hex));
            const r = Math.max(nTile.size.x, nTile.size.y) / 2;
            const weight = Math.PI * r * r;
            hueSum += nHue * weight;
            weightSum += weight;
            activeCount++;
        }
        if (activeCount > 0) {
            avgNeighborHue = hueSum / weightSum;
        }
    }

    // Isolation-based mix between old and neighbour average.
    const NUM_NEIGHBORS = 6;
    const emptyCount = NUM_NEIGHBORS - activeCount;
    const oldWeight = emptyCount / NUM_NEIGHBORS;
    const neighborWeight = 1 - oldWeight;
    let targetHue = oldHue * oldWeight + avgNeighborHue * neighborWeight;

    // Enforce minimum hue shift so every regen is visibly distinct.
    // Linear distance is sufficient — all palette hues live in the
    // contiguous [HUE_MIN, HUE_MAX] arc, no circular wraparound.
    const minShift = NEBULA_CONSTANTS.REGEN_MIN_HUE_SHIFT;
    if (Math.abs(targetHue - oldHue) < minShift) {
        // Deterministic direction: parity of (col + row) picks + or −.
        // Using grid coords instead of a counter keeps the rule stateless.
        const sign = (((tile.nebulaGridCol ?? 0) + (tile.nebulaGridRow ?? 0)) & 1) === 0 ? 1 : -1;
        // Step forward by minShift, then fold back into the palette
        // arc via modular reduction so we always land in [MIN, MAX].
        const shifted = oldHue + sign * minShift;
        const offset = ((shifted - NEBULA_PALETTE_HUE_MIN) % NEBULA_PALETTE_HUE_RANGE + NEBULA_PALETTE_HUE_RANGE) % NEBULA_PALETTE_HUE_RANGE;
        targetHue = NEBULA_PALETTE_HUE_MIN + offset;
    }

    // Defensive final clamp (in case of upstream drift).
    targetHue = clampHueToPalette(targetHue);

    return [{ hex: paletteHueToHex(targetHue), weight: 1 }];
  }

  /**
   * If the given nebula shard has grown large enough (disc area ≥
   * HEX_AREA), transmute it into a brand-new NEBULA tile at the nearest
   * unoccupied grid cell.  Returns true if the transmutation succeeded.
   *
   * The shard's accumulated colour composition is passed to the new
   * tile, so the palette that multiple shards mixed together carries
   * over to the tile that finally condenses out of them.
   *
   * If no candidate cell is clear (the shard's own cell and all 6
   * neighbours are occupied), the transmutation aborts and the shard
   * stays as a shard — a later frame may find a clear cell as it drifts.
   */
  private tryTransmuteShardToTile(shard: GameEntity): boolean {
    if (!this.currentMap) return false;
    if (shard.type !== EntityType.NEBULA_SHARD) return false;

    // Disc-area threshold: the shard must cover at least one full hex
    // worth of area before condensing into a tile.
    const shardR = Math.max(shard.size.x, shard.size.y) / 2;
    const shardArea = Math.PI * shardR * shardR;
    if (shardArea < HEX_AREA) return false;

    // Candidate cells: the shard's current hex cell + 6 neighbours,
    // sorted by distance from the shard's position so we snap to the
    // nearest free slot.
    const origin = pixelToHexCoord(shard.position.x, shard.position.y);
    const candidates: { c: number; r: number; distSq: number }[] = [];
    const pushCandidate = (c: number, r: number) => {
        const p = hexCoordToPixel(c, r);
        const dx = p.x - shard.position.x;
        const dy = p.y - shard.position.y;
        candidates.push({ c, r, distSq: dx * dx + dy * dy });
    };
    pushCandidate(origin.c, origin.r);
    for (const n of TileGenerator.getHexNeighbors(origin.c, origin.r)) {
        pushCandidate(n.c, n.r);
    }
    candidates.sort((a, b) => a.distSq - b.distSq);

    let chosen: { c: number; r: number } | null = null;
    for (const cand of candidates) {
        if (this.isGridCellFreeForNebula(cand.c, cand.r)) {
            chosen = cand;
            break;
        }
    }
    if (!chosen) return false;

    // Create the new tile at the chosen grid cell, carrying over the
    // shard's colour composition as the tile's palette.
    const composition = shard.nebulaColorComposition
        ? cloneComposition(shard.nebulaColorComposition)
        : undefined;
    const tile = TileGenerator.createNebulaTileEntity(
        chosen.c,
        chosen.r,
        composition ?? [{ hex: shard.color || NEBULA_CONSTANTS.DEFAULT_HEX, weight: 1 }],
        HEX_AREA
    );

    this.currentMap.entities.push(tile);
    this.physics.addStaticEntity(tile);

    // New tile fades in slowly instead of popping — no glimmer burst.
    // createNebulaTileEntity already sets nebulaSpawnTimer, but we
    // re-set it here for clarity (and to future-proof if the factory
    // default ever changes).
    tile.nebulaSpawnTimer = NEBULA_CONSTANTS.FADE_IN_DURATION;

    // Shard collapses into the new tile.
    shard.active = false;
    return true;
  }

  /**
   * Check whether the given grid cell (odd-r offset) has no active or
   * regenerating nebula tile already occupying it, and is also clear of
   * static-grid collision geometry (glass tiles etc.).
   */
  private isGridCellFreeForNebula(col: number, row: number): boolean {
    if (!this.currentMap) return false;
    const pos = hexCoordToPixel(col, row);

    // Any nebula entity pinned to this grid cell — active or regenerating.
    const ents = this.currentMap.entities;
    for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        if (e.type !== EntityType.NEBULA) continue;
        if (e.nebulaGridCol === col && e.nebulaGridRow === row) return false;
    }

    // Any other static geometry (glass tiles) overlapping this cell —
    // check a radius slightly smaller than the hex so touching neighbours
    // don't register as collisions.
    if (!this.physics.isPositionClear(pos.x, pos.y, HEX_SIZE * 0.5)) return false;
    return true;
  }

  /** Returns the ammo type asteroids should drop for the current wave. */
  private getAsteroidAmmoType(): WeaponType {
    const idx = Math.min(
      Math.floor(this.waveIndex / 3),
      ASTEROID_AMMO_PROGRESSION.length - 1
    );
    return ASTEROID_AMMO_PROGRESSION[idx];
  }

  private spawnAmmoDrop(pos: Vector2, weapon: WeaponType, amount: number, parentVelocity?: Vector2) {
    if (!this.currentMap) return;
    if (weapon === WeaponType.BLASTER) return; // Blaster is always infinite — no drops
    if (this.activeDrops.length >= DROP_CONFIG.MAX_ACTIVE_DROPS) return;
    const drop = this.makeDropEntity(`drop_ammo_${weapon}_${Date.now()}_${Math.random()}`,
      pos, parentVelocity, WEAPONS[weapon].color, amount, 'ammo');
    drop.dropWeapon = weapon;
    drop.polygonPoints = this.generateShardPolygon('ammo', Math.min(9, Math.max(4, 3.5 + amount * 0.2)));
    this.currentMap.entities.push(drop);
    this.activeDrops.push(drop);
  }

  private spawnHealthDrop(pos: Vector2, value: number, parentVelocity?: Vector2) {
    if (!this.currentMap) return;
    if (this.activeDrops.length >= DROP_CONFIG.MAX_ACTIVE_DROPS) return;
    const drop: GameEntity = {
      id:          `drop_health_${Date.now()}_${Math.random()}`,
      type:        EntityType.INTERACTABLE,
      position:    { x: pos.x, y: pos.y },
      velocity:    { x: 0, y: 0 },
      size:        { x: 48, y: 48 },
      rotation:    0,
      rotationSpeed: 0,
      color:       '#ef4444',
      active:      true,
      health:      1,
      maxHealth:   1,
      mass:        Infinity, // static — never moved by physics or flow field
      dropType:    'health',
      dropValue:   value,
    };
    this.currentMap.entities.push(drop);
    this.activeDrops.push(drop);
  }

  private makeDropEntity(
    id: string, pos: Vector2, pv: Vector2 | undefined,
    color: string, value: number, dropType: 'ammo' | 'health'
  ): GameEntity {
    const scatter = 20;
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 0.5 + Math.random() * 1.5;
    const r       = Math.min(10, Math.max(4, 3.5 + value * 0.075));
    return {
      id, type: EntityType.INTERACTABLE,
      position: { x: pos.x + (Math.random() - 0.5) * scatter * 2, y: pos.y + (Math.random() - 0.5) * scatter * 2 },
      velocity: { x: (pv?.x ?? 0) * 0.3 + Math.cos(angle) * speed, y: (pv?.y ?? 0) * 0.3 + Math.sin(angle) * speed },
      size: { x: r * 3, y: r * 3 },
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 2 * 2.5,
      color, active: true, health: 1, maxHealth: 1, mass: 5,
      dropType, dropValue: value,
      polygonPoints: [],
    };
  }

  // Spawn a powerup drop for a specific weapon (used when a composite asteroid releases its stored weapons).
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
          this.player.position,
          this.playerMessages,
          this.player,
          this.waveAnnouncements,
          this.detachedTrails
      );
  }
}
