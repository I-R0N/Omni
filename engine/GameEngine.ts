

import { InputSystem } from './systems/InputSystem';
import { PhysicsSystem } from './systems/PhysicsSystem';
import { RenderSystem } from './systems/RenderSystem';
import { AISystem } from './systems/AISystem';
import { ParticleSystem } from './systems/ParticleSystem';
import { TrailSystem } from './systems/TrailSystem';
import { ProjectileSystem } from './systems/ProjectileSystem';
import { WeaponSystem } from './systems/WeaponSystem';
import { DropSystem } from './systems/DropSystem';
import { WaveSystem, WaveSpawnContext } from './systems/WaveSystem';
import { NebulaSystem } from './systems/NebulaSystem';
import { EntityIndex } from './systems/EntityIndex';
import { nextId } from './systems/IdAllocator';
import { BaseMapLayer, UniverseMap } from './maps/MapClasses';
import { GameEntity, EntityType, MapType, CameraState, EngineStats, Vector2, WeaponType, WeaponConfig, DamageText, GameState, ShardType, DropCompositionEntry, PlayerHUDMessage, WaveAnnouncement, TrailPoint } from '../types';
import { COLORS, PHYSICS_CONSTANTS, WEAPONS, WEAPON_LIST, MINIMAP_CONSTANTS, PLAYER_MOVEMENT_CONFIG, DAMAGE_TEXT_CONSTANTS, ASTEROID_GENERATION_CONFIG, TRAIL_CONSTANTS, PARTICLE_CONSTANTS, CAMERA_CONSTANTS, SPRITE_CONSTANTS, EXPLOSION_CONSTANTS, DIFFICULTY_SCALES, DROP_CONFIG, STRUCTURE_CONSTANTS, AI_CONFIG, AMMO_HUD_CONSTANTS, computeAmmoHUDLayout, LIGHTNING_CHAIN_RANGE, LIGHTNING_CHAIN_COUNT, LIGHTNING_ARC_LIFETIME, SHIELD_CONSTANTS, HEALTH_DROP_INTERVAL, REGEN_POP_CONSTANTS, SIMULATION_CONSTANTS } from '../constants';
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
  private particles: ParticleSystem;
  private trails: TrailSystem;
  private projectiles: ProjectileSystem;
  private weapons: WeaponSystem;
  private drops: DropSystem;
  private waves: WaveSystem;
  private nebulas: NebulaSystem;
  private entityIndex: EntityIndex;
  private flowField: FlowFieldGrid;
  
  private isRunning: boolean = false;
  private gameState: GameState = GameState.MENU;
  private lastTime: number = 0;
  // Fixed-timestep accumulator (Phase 1).  Frame delta is accumulated and the
  // simulation is stepped at SIMULATION_CONSTANTS.FIXED_DT until the
  // accumulator is drained; any remainder carries to the next frame.  This
  // decouples gameplay speed from display refresh rate so physics outcomes
  // are deterministic across devices.
  private simAccumulator: number = 0;
  
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

  // Wave system state lives on this.waves (WaveSystem) — these accessors
  // preserve the old GameEngine.waveX field ergonomics for the handful of
  // call sites that still read/write them directly.
  private get waveIndex(): number { return this.waves.waveIndex; }
  private set waveIndex(v: number) { this.waves.waveIndex = v; }
  private get waveEnemyIds(): Set<string> { return this.waves.waveEnemyIds; }
  private set waveEnemyIds(v: Set<string>) { this.waves.waveEnemyIds = v; }
  private get waveState(): 'inactive' | 'active' | 'cleared' | 'complete' { return this.waves.waveState; }
  private set waveState(v: 'inactive' | 'active' | 'cleared' | 'complete') { this.waves.waveState = v; }
  private get waveGraceTimer(): number { return this.waves.waveGraceTimer; }
  private set waveGraceTimer(v: number) { this.waves.waveGraceTimer = v; }

  // Screen Shake State
  private shakeTimer: number = 0;
  private shakeIntensity: number = 0;

  // Tile regeneration — destroyed tiles waiting to respawn
  private pendingRegens: { entity: GameEntity; timer: number }[] = [];

  // Fast drop lookup — avoids scanning all ~22k map entities every frame
  private activeDrops: GameEntity[] = [];

  // Wave announcement banners rendered on the canvas — forwarded from
  // WaveSystem so existing call sites keep working verbatim.
  public get waveAnnouncements(): WaveAnnouncement[] { return this.waves.announcements; }
  public set waveAnnouncements(v: WaveAnnouncement[]) { this.waves.announcements = v; }

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

    // Fill all weapon ammo when entering debug mode
    if (this.debugMode && this.player.ammo) {
      for (const w of WEAPON_LIST) {
        if (w === WeaponType.BLASTER) continue; // blaster is always infinite
        this.player.ammo[w] = 999;
      }
    }
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
    this.particles = new ParticleSystem();
    this.trails = new TrailSystem();
    this.projectiles = new ProjectileSystem();
    this.weapons = new WeaponSystem(this.projectiles);
    this.drops = new DropSystem(this.particles);
    this.waves = new WaveSystem();
    this.nebulas = new NebulaSystem(this.particles, this.drops);
    this.entityIndex = new EntityIndex();
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
    this.simAccumulator = 0;
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
    const ctx = this.waveContext();
    if (!ctx) return;
    if (!this.waves.skip(ctx)) return;
    // Push stats immediately so the UI reflects the new wave number before
    // the next rAF tick rather than lagging one frame.
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

  public pauseGame() {
    if (this.gameState === GameState.PLAYING) {
        this.gameState = GameState.PAUSED;
    }
  }

  public resumeGame() {
    if (this.gameState === GameState.PAUSED) {
        this.gameState = GameState.PLAYING;
        this.lastTime = performance.now(); // Prevent physics jump
        this.simAccumulator = 0;           // Drop stale accumulated time from pause
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

  private selectWeapon(wType: WeaponType) {
    this.currentWeaponIndex = this.weapons.selectWeapon(this.player, wType);
  }

  public cycleWeapon() {
    if (this.gameState !== GameState.PLAYING) return;
    this.currentWeaponIndex = this.weapons.cycleWeapon(this.player);
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

    // ── Fixed-timestep accumulator (Phase 1) ─────────────────────────────────
    // Drain the accumulator at a fixed simulation rate regardless of the
    // render frame rate.  Any leftover time carries to the next frame.
    //
    // A MAX_FRAME_TIME clamp drops excess time from tab-switch / GPU stalls
    // so we never try to simulate several seconds worth of physics in one
    // frame.  A MAX_SUBSTEPS clamp on the inner loop is the spiral-of-death
    // safeguard: if the sim is genuinely slower than real time the extra
    // time is silently discarded rather than compounding.
    const { FIXED_DT, MAX_SUBSTEPS, MAX_FRAME_TIME } = SIMULATION_CONSTANTS;
    this.simAccumulator += Math.min(frameTime, MAX_FRAME_TIME);

    let steps = 0;
    while (this.simAccumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
        // Refresh working set for physics/AI before each sim step so
        // entities spawned during the previous step are visible to this one.
        this.prepareFrameEntities();
        try { this.updatePhysics(FIXED_DT); }   catch (e) { console.error('[PhysicsSystem] update error:', e); }
        try { this.updateGameLogic(FIXED_DT); } catch (e) { console.error('[GameLogic] update error:', e); }
        this.simAccumulator -= FIXED_DT;
        steps++;
    }
    // If we hit the substep cap there's still leftover time we can't afford
    // to simulate this frame — discard it so the accumulator can't grow
    // unboundedly and trigger a death spiral on the next frame.
    if (steps >= MAX_SUBSTEPS && this.simAccumulator >= FIXED_DT) {
        this.simAccumulator = 0;
    }

    // Refresh the frame entity list one more time so anything spawned during
    // the final sim step is included in the render pass.
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
      // Phase 4: rebuild type-filtered candidate lists so every downstream
      // system scan runs on the minimal relevant slice instead of the full
      // master entity list.  Rebuilt once per sim substep; consumers must
      // not cache these references across steps.
      this.entityIndex.rebuild(this.currentMap.entities);
  }

  private handleEnemyShooting(dt: number) {
      if (!this.currentMap) return;
      this.weapons.updateEnemyShooting(this.currentMap.entities, this.entityIndex.enemies, this.player, dt);
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

      // Asteroid census + shard generation.  EntityIndex only contains
      // active asteroids, so we still need a master-list scan to catch
      // asteroids that were just deactivated this step (they're no longer
      // in the index) and to preserve the original total-count semantics.
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
      const asteroids = this.entityIndex.asteroids;
      const applyFlow = (e: GameEntity) => {
          const flow = this.flowField.sampleAsteroidFlow(e.position.x, e.position.y);
          const tx = flow.x * FLOW_TARGET_SPEED;
          const ty = flow.y * FLOW_TARGET_SPEED;
          const speed   = Math.sqrt(e.velocity.x * e.velocity.x + e.velocity.y * e.velocity.y);
          const urgency = 1 + 8 * Math.max(0, 1 - speed / FLOW_TARGET_SPEED);
          const alpha   = Math.min(0.8, FLOW_CORRECTION * dt * urgency);
          e.velocity.x += (tx - e.velocity.x) * alpha;
          e.velocity.y += (ty - e.velocity.y) * alpha;
          if (e.rotationSpeed) e.rotation += e.rotationSpeed * dt;
      };
      for (let i = 0; i < asteroids.length; i++) applyFlow(asteroids[i]);
      // Drops are a subset of activeDrops that are ammo shards (not glass, not health).
      for (let i = 0; i < this.activeDrops.length; i++) {
          const d = this.activeDrops[i];
          if (!d.active || !d.dropType || d.dropType === 'health') continue;
          applyFlow(d);
      }

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
      for (let i = 0; i < asteroids.length; i++) gravCandidates.push(asteroids[i]);
      for (let i = 0; i < this.activeDrops.length; i++) {
          const d = this.activeDrops[i];
          if (d.active && d.dropType && d.dropType !== 'glass') gravCandidates.push(d);
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

      if (entity.type === EntityType.ENEMY) {
          this.spawnEnemyShards(entity);
      }

      // Nebula tiles and shards route through NebulaSystem: polygonal
      // shard burst + occasional ammo drop + regen queueing are all
      // handled there.  They also skip the generic death-burst particles
      // below (nebulae fade out gracefully via nebulaFadeTimer) AND skip
      // the generic spawnDrops path since the ammo roll lives inside
      // NebulaSystem.handleDeath.
      const isNebula = entity.type === EntityType.NEBULA || entity.type === EntityType.NEBULA_SHARD;
      if (isNebula && this.currentMap) {
          this.nebulas.handleDeath(
              this.currentMap.entities,
              this.activeDrops,
              entity,
              this.waveIndex,
          );
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
      } else if (isNebula) {
          // Nebulae fade out gracefully via nebulaFadeTimer in the
          // renderer — no spark burst on destruction.  Merge/transmute
          // events emit a subtle glimmer instead (see NebulaSystem).
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

      // Nebulae run their own drop logic inside NebulaSystem.handleDeath
      // (above), so we skip the generic drops path for them.
      if (!entity.suppressDrops && !isNebula) {
          this.spawnDrops(entity);
      }
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
            regen.entity.regenPopTimer = REGEN_POP_CONSTANTS.DURATION;
            this.physics.addStaticEntity(regen.entity);
            this.pendingRegens.splice(i, 1);

            // Pop-in particle burst: tile-colored chips scattering outward
            this.spawnParticles(regen.entity.position, REGEN_POP_CONSTANTS.CHIP_COUNT, regen.entity.color || '#6366f1', {
                speedMin: REGEN_POP_CONSTANTS.CHIP_SPEED_MIN,
                speedMax: REGEN_POP_CONSTANTS.CHIP_SPEED_MAX,
                lifetimeMin: REGEN_POP_CONSTANTS.CHIP_LIFETIME,
                lifetimeMax: REGEN_POP_CONSTANTS.CHIP_LIFETIME,
                sizeMin: 1, sizeMax: 2,
            });
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
    this.waves.tickAnnouncements(dt);

    // Nebula per-frame pass: regen timer tick, shard gravity/merge
    // dynamics, shard→tile transmutation.  Runs after glass regen so
    // a just-regenerated nebula tile can already count as a neighbour
    // for same-frame nebula regens.
    if (this.currentMap) {
        this.nebulas.update(this.currentMap.entities, dt, this.physics);
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

    // Wave completion + grace-period countdown — delegated to WaveSystem.
    // On wave clear we drop a health pickup every Nth wave (difficulty-scaled).
    if (this.currentMap) {
      this.waves.checkCompletion(this.currentMap.entities, (clearedIndex) => {
        const healthInterval = HEALTH_DROP_INTERVAL[this.difficultyLevel] ?? 20;
        if ((clearedIndex + 1) % healthInterval === 0) {
          const hAngle = Math.random() * Math.PI * 2;
          const hDist  = 20 + Math.random() * 80; // 20–100 units from player
          const hPos   = {
            x: this.player.position.x + Math.cos(hAngle) * hDist,
            y: this.player.position.y + Math.sin(hAngle) * hDist,
          };
          this.spawnHealthDrop(hPos, DROP_CONFIG.HEALTH_HEAL_AMOUNT);
        }
      });

      const graceCtx = this.waveContext();
      if (graceCtx) this.waves.tickGrace(dt, graceCtx);
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

    // Tick weapon cooldown + burst-fire queue via WeaponSystem.
    if (this.currentMap) {
        this.weapons.tickPlayerBurst(this.currentMap.entities, this.player, dt, this.handleScreenShake);
    }

    // Refresh the candidate index before projectile post-processing: the
    // physics / AI / burst pass above may have spawned new projectiles or
    // destroyed enemies since the last rebuild in prepareFrameEntities.
    if (this.currentMap) this.entityIndex.rebuild(this.currentMap.entities);

    this.updateHomingProjectiles(dt);
    this.updateLightningGravity(dt);
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
      id: nextId('hud'),
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

  // Thin wrapper kept for call-site compatibility — delegates to ParticleSystem.
  private spawnParticles(
    position: Vector2,
    count: number,
    color: string,
    options?: Parameters<ParticleSystem['spawn']>[4]
  ) {
    if (!this.currentMap) return;
    this.particles.spawn(this.currentMap.entities, position, count, color, options);
  }

  /**
   * Thin wrappers kept so existing call sites in updateGameLogic don't have
   * to reach into subsystems directly.  Logic lives in TrailSystem /
   * ParticleSystem.
   */
  private tickTrail(trail: TrailPoint[], dt: number) {
    this.trails.tickTrail(trail, dt);
  }

  private spawnGlitterTrail() {
    if (!this.currentMap) return;
    this.particles.spawnGlitterTrail(this.currentMap.entities, this.player);
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

    // Lightning projectile: chain to nearby entities on impact
    if (proj.isLightningProjectile) {
        this.fireLightningChainFromImpact(impactPos, target);
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
          id: nextId('dmg'),
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
      if (!this.currentMap) return;

      // Convert screen-space target to world coords once; the rest of the
      // firing flow lives in WeaponSystem.
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const worldX = this.player.position.x + (target.x - cx) / this.camera.zoom;
      const worldY = this.player.position.y + (target.y - cy) / this.camera.zoom;

      const fired = this.weapons.firePlayerWeapon(
          this.currentMap.entities,
          this.player,
          { x: worldX, y: worldY },
          this.handleScreenShake,
      );

      // Keep the HUD weapon index aligned with the player's current weapon in
      // case WeaponSystem auto-fell back to blaster on an empty mag.
      if (fired) {
          this.currentWeaponIndex = WEAPON_LIST.indexOf(this.player.currentWeapon || WeaponType.BLASTER);
      }
  }

  // Thin wrappers that delegate to ProjectileSystem / TrailSystem.  Kept so
  // existing GameEngine call sites stay unchanged during the Phase 2 split.
  private spawnProjectileFromConfig(shooter: GameEntity, target: Vector2, config: WeaponConfig, ownerType: EntityType) {
      if (!this.currentMap) return;
      this.projectiles.spawn(this.currentMap.entities, shooter, target, config, ownerType);
  }

  private updateHomingProjectiles(dt: number) {
      if (!this.currentMap) return;
      this.projectiles.updateHoming(this.entityIndex.projectiles, this.entityIndex.enemies, dt);
  }

  private updateLightningGravity(dt: number) {
      if (!this.currentMap) return;
      this.projectiles.updateLightningGravity(
          this.entityIndex.projectiles,
          this.entityIndex.enemies,
          this.entityIndex.asteroids,
          dt,
      );
  }

  private updateProjectileTrails(dt: number) {
      if (!this.currentMap) return;
      this.trails.updateProjectileTrails(this.currentMap.entities, dt);
  }

  // ─── Lightning chain (triggered on projectile impact) ───────────────────

  private fireLightningChainFromImpact(impactPos: Vector2, firstTarget: GameEntity) {
      if (!this.currentMap) return;

      // Build chain: hop from the initial target to nearby enemies/asteroids.
      // Phase 4: walk the pre-filtered enemy + asteroid lists instead of the
      // full entity array.  Exploding entities are still skipped since the
      // index holds `active` entities that may mid-animation.
      const enemies = this.entityIndex.enemies;
      const asteroids = this.entityIndex.asteroids;
      const chain: GameEntity[] = [firstTarget];
      const hitSet = new Set<string>([firstTarget.id]);

      const pickNearest = (prev: GameEntity): GameEntity | null => {
          let nextTarget: GameEntity | null = null;
          let nextDistSq = LIGHTNING_CHAIN_RANGE * LIGHTNING_CHAIN_RANGE;
          for (let i = 0; i < enemies.length; i++) {
              const e = enemies[i];
              if (e.isExploding || hitSet.has(e.id)) continue;
              const dx = e.position.x - prev.position.x;
              const dy = e.position.y - prev.position.y;
              const d2 = dx * dx + dy * dy;
              if (d2 < nextDistSq) { nextDistSq = d2; nextTarget = e; }
          }
          for (let i = 0; i < asteroids.length; i++) {
              const e = asteroids[i];
              if (e.isExploding || hitSet.has(e.id)) continue;
              const dx = e.position.x - prev.position.x;
              const dy = e.position.y - prev.position.y;
              const d2 = dx * dx + dy * dy;
              if (d2 < nextDistSq) { nextDistSq = d2; nextTarget = e; }
          }
          return nextTarget;
      };

      for (let hop = 0; hop < LIGHTNING_CHAIN_COUNT; hop++) {
          const next = pickNearest(chain[chain.length - 1]);
          if (!next) break;
          chain.push(next);
          hitSet.add(next.id);
      }

      // Apply chain damage (skip index 0 — the first target already took projectile damage).
      // Damage reduces by 1/(totalHops-1) per hop: e.g. 3 total → 0.5× on hop 1, 0× on hop 2.
      const baseDmg = WEAPONS[WeaponType.LIGHTNING].damage;
      const totalHops = chain.length; // includes direct hit at index 0
      const reductionPerHop = totalHops > 1 ? 1 / (totalHops - 1) : 1;

      for (let i = 1; i < chain.length; i++) {
          const target = chain[i];
          const dmg = Math.max(0, baseDmg * (1 - i * reductionPerHop));
          if (dmg <= 0) { target.hitFlash = 0.1; continue; } // visual flash only

          target.health -= dmg;
          target.hitFlash = 0.15;
          this.spawnDamageText(target.position, dmg, target);

          if (target.health <= 0 && !target.isExploding) {
              target.lastImpactDamage = dmg;
              this.handleEntityDeath(target);
          }
      }

      // Only spawn arc visual if there's at least one chain hop
      if (chain.length < 2) return;

      // Build arc points: impact → target1 → target2 (target 0 is the direct hit)
      const arcPoints: Vector2[] = [];
      for (const t of chain) {
          arcPoints.push({ x: t.position.x, y: t.position.y });
      }

      // Spawn a single PARTICLE entity carrying the arc data for rendering
      this.currentMap.entities.push({
          id: nextId('lightning'),
          type: EntityType.PARTICLE,
          position: { x: impactPos.x, y: impactPos.y },
          velocity: { x: 0, y: 0 },
          size: { x: 1, y: 1 },
          rotation: 0,
          color: WEAPONS[WeaponType.LIGHTNING].color,
          active: true,
          health: 1,
          maxHealth: 1,
          lifetime: LIGHTNING_ARC_LIFETIME,
          maxLifetime: LIGHTNING_ARC_LIFETIME,
          mass: 0,
          isLightningArc: true,
          arcPoints,
      });
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
      // Candidates: active asteroids + eligible drops (no glass/powerup).
      // Phase 4: asteroids come straight from the prebuilt index.
      const asteroids = this.entityIndex.asteroids;
      const candidates: GameEntity[] = [];
      for (let i = 0; i < asteroids.length; i++) candidates.push(asteroids[i]);
      for (let i = 0; i < this.activeDrops.length; i++) {
          const d = this.activeDrops[i];
          if (d.active && d.dropType !== 'glass' && d.dropType !== 'health') candidates.push(d);
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
          id:            nextId('composite'),
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
              id:           nextId('shard'),
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

  /** Build the per-call spawn context that WaveSystem needs.  Kept as a
   *  tiny helper so every wave entry point (init / grace tick / skip) goes
   *  through the same factory. */
  private waveContext(): WaveSpawnContext | null {
    if (!this.currentMap) return null;
    return {
      entities: this.currentMap.entities,
      player: this.player,
      physics: this.physics,
      enemyScale: this.enemyScale,
      difficultyLevel: this.difficultyLevel,
    };
  }

  // Thin wrappers kept for internal call-site compatibility — delegate to WaveSystem.
  private initWaveSystem() {
    const ctx = this.waveContext();
    if (!ctx) return;
    this.waves.init(ctx);
  }

  private spawnWave(index: number) {
    const ctx = this.waveContext();
    if (!ctx) return;
    this.waves.spawn(index, ctx);
  }


  // --- Drop / shard thin wrappers ────────────────────────────────────────
  //
  // Logic lives in DropSystem; these wrappers preserve the existing call
  // sites in updateGameLogic / handleEntityDeath / collection paths.

  private applyDropEffect(entity: GameEntity) {
    this.drops.applyDropEffect(this.player, entity, (t, c) => this.pushPlayerMessage(t, c));
  }

  private spawnDrops(entity: GameEntity) {
    if (!this.currentMap) return;
    this.drops.spawnDrops(
      this.currentMap.entities,
      this.activeDrops,
      this.player,
      entity,
      this.waveIndex,
      (t, c) => this.pushPlayerMessage(t, c),
    );
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

  private spawnEnemyShards(enemy: GameEntity) {
    if (!this.currentMap) return;
    this.drops.spawnEnemyShards(this.currentMap.entities, this.activeDrops, enemy);
  }

  private spawnGlassShards(tile: GameEntity) {
    if (!this.currentMap) return;
    this.drops.spawnGlassShards(this.currentMap.entities, tile);
  }

  private spawnAmmoDrop(pos: Vector2, weapon: WeaponType, amount: number, parentVelocity?: Vector2) {
    if (!this.currentMap) return;
    this.drops.spawnAmmoDrop(this.currentMap.entities, this.activeDrops, pos, weapon, amount, parentVelocity);
  }

  private spawnHealthDrop(pos: Vector2, value: number, parentVelocity?: Vector2) {
    if (!this.currentMap) return;
    this.drops.spawnHealthDrop(this.currentMap.entities, this.activeDrops, pos, value, parentVelocity);
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
      // Forward the map's recorded nebula cluster-center positions to
      // the background layer so its puffs render at the same world
      // positions as the interactable tile clusters (one unified
      // cloud; backdrop still parallaxes as the camera moves).
      this.renderer.setNebulaClusterCenters(map.nebulaClusterCenters);
      // Fresh map — drop any queued nebula regens from the previous one.
      this.nebulas.reset();
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
