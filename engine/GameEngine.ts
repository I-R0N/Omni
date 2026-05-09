

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
import { ShardSystem, shardVariantOf } from './systems/ShardSystem';
import { EntityIndex } from './systems/EntityIndex';
import { nextId } from './systems/IdAllocator';
import { BaseMapLayer, UniverseMap, RingMap, SevenRingsMap, PocketMap, AsteroidFieldMap, GlassFieldMap, HardTileFieldMap, IndestructibleFieldMap, NebulaFieldMap, RockFieldMap } from './maps/MapClasses';
import { GameEntity, EntityType, MapType, CameraState, EngineStats, PerfSnapshot, Vector2, WeaponType, WeaponConfig, DamageText, GameState, DropCompositionEntry, PlayerHUDMessage, WaveAnnouncement, TrailPoint, TrailShape, TrailEmitMode } from '../types';
import { COLORS, PHYSICS_CONSTANTS, WEAPONS, WEAPON_LIST, MINIMAP_CONSTANTS, PLAYER_MOVEMENT_CONFIG, DAMAGE_TEXT_CONSTANTS, getRockShardFreeSpawn, TRAIL_CONSTANTS, PLAYER_TRAIL_CONSTANTS, PARTICLE_CONSTANTS, CAMERA_CONSTANTS, SPRITE_CONSTANTS, EXPLOSION_CONSTANTS, DIFFICULTY_SCALES, DROP_CONFIG, AMMO_CONSTANTS, STRUCTURE_CONSTANTS, AI_CONFIG, AMMO_HUD_CONSTANTS, computeAmmoHUDLayout, LIGHTNING_CHAIN_RANGE, LIGHTNING_CHAIN_COUNT, LIGHTNING_ARC_LIFETIME, SHIELD_CONSTANTS, HEALTH_DROP_INTERVAL, REGEN_POP_CONSTANTS, SIMULATION_CONSTANTS } from '../constants';
import { ASSETS, setActiveNebulaSet, NebulaSet } from '../assets';
import { FlowFieldGrid } from './systems/FlowFieldGrid';
import { wrapDeltaX, wrapDeltaY, wrapPosition, MAP_WIDTH, MAP_HEIGHT, setMapDimensions } from './toroidal';

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
  // Stage 1 of shard-system overhaul — additive skeleton, no-op
  // update / onDeath.  Existing GameEngine + NebulaSystem code paths
  // still drive regen / shatter / merge.  See docs/SHARD_SYSTEM.md.
  private shards: ShardSystem;
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
  // Map the next restart / initial load should build.  Updated from the
  // main-menu map-style buttons so the UI-selected map survives the
  // restartGame() path (which re-instantiates the map class from scratch).
  private selectedMapType: MapType = MapType.UNIVERSE;

  // Debug mode
  private debugMode: boolean = false;

  // Which nebula image set is active.  Defaults to ALL so every discovered
  // nebula image renders out of the box; the DBG panel cycles through A
  // (baseline 00-08), B (everything past 08), ALL, and N16 for quick
  // comparison.
  private nebulaSet: NebulaSet = 'ALL';
  // Player-trail shape — debug-only A/B selector.  CIRCLE matches the
  // production look; the rest are dev variants exposed via the DBG panel.
  private trailShape: TrailShape = TrailShape.CIRCLE;
  // Player-trail direction mode — VELOCITY (default) extends the trail
  // opposite to velocity (current production look — points emitted at
  // player.position naturally trail behind via the ship's path through
  // space).  THRUST extends the trail opposite to the input/thrust
  // direction by accumulating a per-emit offset in -input.  Toggled
  // from the DBG panel.
  private trailEmitMode: TrailEmitMode = TrailEmitMode.VELOCITY;

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

  // Tile regeneration is owned by ShardSystem (Stage 2 of shard-system
  // overhaul).  GameEngine.handleEntityDeath calls
  // `this.shards.queueRegen(entity)` for every shard-family death;
  // ShardSystem.update() drains the queue per fixed-step dt.

  // Fast drop lookup — avoids scanning all ~22k map entities every frame
  private activeDrops: GameEntity[] = [];

  // Wave announcement banners rendered on the canvas — forwarded from
  // WaveSystem so existing call sites keep working verbatim.
  public get waveAnnouncements(): WaveAnnouncement[] { return this.waves.announcements; }
  public set waveAnnouncements(v: WaveAnnouncement[]) { this.waves.announcements = v; }

  // Stick-bonds + nebula gravity-merge are owned by ShardSystem
  // (Stage 4 of shard-system overhaul).  See engine/systems/ShardSystem.ts.

  // Accumulates throttle * dt; a ring emits each time it crosses the
  // EMIT_INTERVAL threshold.  Ties emission rate to applied thrust
  // (acceleration input), not to raw velocity — coasting produces no rings.
  private trailEmitAccumulator: number = 0;
  // Thrust state from the previous emission update.  Used to detect the
  // start of a fresh thrust event so the next emitted point can carry a
  // chainStart flag and the PATH renderer can break the polyline at the
  // gap rather than connecting old tail to new head.
  private wasThrustingLastFrame: boolean = false;
  // Sticky flag set when a fresh thrust event begins, cleared only when an
  // emission actually consumes it.  Survives the substeps / frames between
  // "thrust pressed" and "accumulator first reaches EMIT_INTERVAL", so the
  // chainStart flag is never lost to substep timing.
  private chainBreakPending: boolean = false;

  // ── Perf instrumentation ──────────────────────────────────────────────────
  // Pre-allocated ring buffers for per-system timings over the last N sim
  // substeps (or N render frames for perfRender).  All reads happen on the
  // stats callback path at the top of each render frame, and all writes are
  // O(1) per metric with no allocation — the `perfIdx` counters wrap on a
  // fixed-size Float64Array so the hot path stays GC-free.
  private static readonly PERF_WINDOW = 60;
  // Sim-substep timings (one sample per physics tick)
  private perfPhysics        = new Float64Array(GameEngine.PERF_WINDOW);
  private perfAI             = new Float64Array(GameEngine.PERF_WINDOW);
  private perfHoming         = new Float64Array(GameEngine.PERF_WINDOW);
  private perfLightning      = new Float64Array(GameEngine.PERF_WINDOW);
  private perfGravity        = new Float64Array(GameEngine.PERF_WINDOW);
  private perfLocalGravity   = new Float64Array(GameEngine.PERF_WINDOW);
  private perfCollisions     = new Float64Array(GameEngine.PERF_WINDOW);
  private perfFlowField      = new Float64Array(GameEngine.PERF_WINDOW);
  private perfDensity        = new Float64Array(GameEngine.PERF_WINDOW);
  private perfSimIdx: number = 0;   // shared write index for every sim-side buffer
  private perfSimFilled: number = 0;
  // Render timings (one sample per rendered frame — may be written in menu
  // and paused states as well, so this is tracked on its own cursor)
  private perfRender         = new Float64Array(GameEngine.PERF_WINDOW);
  private perfNebula         = new Float64Array(GameEngine.PERF_WINDOW);
  private perfRenderIdx: number = 0;
  private perfRenderFilled: number = 0;
  // Latest count snapshot from the most recent prepareFrameEntities() pass.
  // Stored as a mutable struct so getPerfSnapshot() can read it without
  // rebuilding the object each frame.
  private perfCounts = {
      totalEntities: 0,
      enemyCount: 0,
      asteroidCount: 0,
      projectileCount: 0,
      particleCount: 0,
      interactableCount: 0,
  };

  public toggleDebug() {
    this.debugMode = !this.debugMode;
    this.renderer.setDebugMode(this.debugMode);

    // Fill the shared ammo pool when entering debug mode
    if (this.debugMode) {
      this.player.ammo = AMMO_CONSTANTS.MAX_POOL;
    }
  }

  /**
   * Cycle through nebula image sets: ALL (all discovered) → A (baseline
   * 00-08) → B (everything past 08, dynamic) → N16 (Nebula16 only) → ALL.
   * Updates the shared NEBULA_IMAGES array, reloads background textures,
   * and re-rolls the sprite on every live NEBULA / NEBULA_SHARD entity so
   * tile-cluster art swaps instantly without requiring a map reload.
   */
  public toggleNebulaSet() {
    this.nebulaSet =
        this.nebulaSet === 'ALL' ? 'A'
      : this.nebulaSet === 'A'   ? 'B'
      : this.nebulaSet === 'B'   ? 'N16'
      : 'ALL';
    const active = setActiveNebulaSet(this.nebulaSet);
    this.renderer.setNebulaImages(active);

    if (active.length > 0 && this.currentMap) {
      for (const e of this.currentMap.entities) {
        if (e.shardVariant === 'nebula-tile' || e.shardVariant === 'nebula-shard') {
          e.sprite = active[Math.floor(Math.random() * active.length)];
        }
      }
    }
  }

  /**
   * Cycle through player-trail shapes: CIRCLE → SQUARE → TRIANGLE → LINE
   * → NONE → CIRCLE.  Forwards the new shape to the renderer; existing
   * trail points keep their stored emit-time angle, so a shape change is
   * an instant visual swap with no respawn needed.
   */
  public cycleTrailShape() {
    const order = [TrailShape.CIRCLE, TrailShape.SQUARE, TrailShape.TRIANGLE, TrailShape.LINE, TrailShape.PATH, TrailShape.DOTS, TrailShape.NONE];
    const i = order.indexOf(this.trailShape);
    this.trailShape = order[(i + 1) % order.length];
    this.renderer.setTrailShape(this.trailShape);
  }

  /**
   * Toggle the player-trail direction mode between THRUST and VELOCITY.
   * Both modes emit only while throttle > 0.  VELOCITY (default) places
   * trail points at player.position so the trail extends opposite to
   * velocity as the ship moves; THRUST accumulates an offset in the
   * -input direction each emit so the trail extends opposite to thrust
   * regardless of velocity.  Resets the per-thrust-event offset so the
   * new mode starts cleanly at the ship.
   */
  public cycleTrailEmitMode() {
    this.trailEmitMode = this.trailEmitMode === TrailEmitMode.THRUST
      ? TrailEmitMode.VELOCITY
      : TrailEmitMode.THRUST;
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
    this.shards = new ShardSystem(this.particles);
    // Wire the variant-specific completion hook for the
    // neighbourhood-blend regen path (today: nebula-tile only).
    this.shards.setRegenAdapter(this.nebulas);
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
      ammo: 0,   // shared-ammo pool (post-d1) — BLASTER bypasses, every other weapon draws by ammoCost
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

    this.loadMap(this.buildMap(this.selectedMapType));
  }

  /** Factory for the per-run map class so both the constructor and
   *  restartGame() share a single construction path. */
  private buildMap(type: MapType): BaseMapLayer {
    switch (type) {
      case MapType.RING:                 return new RingMap();
      case MapType.SEVEN_RINGS:          return new SevenRingsMap();
      case MapType.POCKET:               return new PocketMap();
      case MapType.ASTEROID_FIELD:       return new AsteroidFieldMap();
      case MapType.GLASS_FIELD:          return new GlassFieldMap();
      case MapType.HARD_TILE_FIELD:      return new HardTileFieldMap();
      case MapType.INDESTRUCTIBLE_FIELD: return new IndestructibleFieldMap();
      case MapType.NEBULA_FIELD:         return new NebulaFieldMap();
      case MapType.ROCK_FIELD:           return new RockFieldMap();
      case MapType.UNIVERSE:
      default:                           return new UniverseMap();
    }
  }

  /** Set the map style that the next restart / startGame will use.
   *  Called from the main menu.  No-op mid-game; the next restart
   *  (triggered by the UI) will pick up the new selection. */
  public setMapType(type: MapType) {
    this.selectedMapType = type;
    if (this.gameState === GameState.MENU) {
      this.loadMap(this.buildMap(type));
      // Recentre the player on the newly-loaded map's spawn so the
      // menu backdrop renders the new map at frame 0 instead of the
      // previous map's viewport.
      this.player.position = { ...this.currentMap!.playerSpawn };
      this.prepareFrameEntities();
    }
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
    this.input.cleanup();
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
      nebulaSet: this.nebulaSet,
      trailShape: this.trailShape,
      trailEmitMode: this.trailEmitMode,
      weaponCount: this.currentWeaponIndex + 1,
      perf: this.buildPerfSnapshot(),
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
      this.shards.reset();
      this.activeDrops = [];
      this.trailEmitAccumulator = 0;
      this.wasThrustingLastFrame = false;
      this.chainBreakPending = false;
      this.waveAnnouncements = [];
      this.loadMap(this.buildMap(this.selectedMapType));

      // Reset Player
      this.player.position = { x: 0, y: 0 };
      this.player.velocity = { x: 0, y: 0 };
      this.player.health = this.player.maxHealth;
      this.player.shield = this.player.maxShield;
      this.player.shieldRechargeTimer = 0;
      this.player.shieldHitFlash = 0;
      this.player.ammo = 0;
      this.player.gold = 0;
      this.player.trail = [];
      this.trailEmitAccumulator = 0;
      this.wasThrustingLastFrame = false;
      this.chainBreakPending = false;
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
      fps: frameTime > 0 ? Math.round(1 / frameTime) : 0,
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
      nebulaSet: this.nebulaSet,
      trailShape: this.trailShape,
      trailEmitMode: this.trailEmitMode,
      weaponCount: this.currentWeaponIndex + 1,
      shield: this.player.shield,
      maxShield: this.player.maxShield,
      perf: this.buildPerfSnapshot(),
    });

    if (this.gameState !== GameState.PLAYING) {
        // If paused or in menu, still draw (static frame) but skip updates
        try { this.draw(); } catch (e) { console.error('[RenderSystem] draw error:', e); }
        this.recordRenderPerf();
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
        // Push per-substep perf samples.  Every timed sub-phase was written
        // to instance fields on its owning system during the two calls above;
        // the recorder just reads and ring-buffers them in one shot.
        this.recordSimPerf();
        this.simAccumulator -= FIXED_DT;
        steps++;
    }
    // If we hit the substep cap there's still leftover time we can't afford
    // to simulate this frame.  Drop the full-step debt we can't catch up on
    // but keep the fractional remainder so sub-step phase stays continuous
    // across the clamp boundary (vs. zeroing and visibly snapping on the
    // next frame).
    if (steps >= MAX_SUBSTEPS && this.simAccumulator >= FIXED_DT) {
        this.simAccumulator %= FIXED_DT;
    }

    // Refresh the frame entity list one more time so anything spawned during
    // the final sim step is included in the render pass.
    this.prepareFrameEntities();
    try { this.draw(); } catch (e) { console.error('[RenderSystem] draw error:', e); }
    this.recordRenderPerf();

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

      // Mirror the latest entity-type counts into the perf snapshot — the
      // index just walked the full list anyway, so this is O(0) extra work.
      // The master list passed to rebuild() does not include the player, so
      // add 1 to totalEntities to match the existing entityCount semantics.
      this.perfCounts.totalEntities     = this.entityIndex.activeCount + 1;
      this.perfCounts.enemyCount        = this.entityIndex.enemies.length;
      this.perfCounts.asteroidCount     = this.entityIndex.asteroids.length;
      this.perfCounts.projectileCount   = this.entityIndex.projectiles.length;
      this.perfCounts.particleCount     = this.entityIndex.particleCount;
      this.perfCounts.interactableCount = this.entityIndex.interactableCount;
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

      this.ai.update(dt, this.entityIndex.enemies, this.player, this.flowField);
      this.handleEnemyShooting(dt);

      this.physics.update(
        allEntities,
        this.entityIndex.asteroids,
        this.player,
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
      //
      // Pulls count/minSize/maxSize from the CURRENT map's config so the
      // respawn loop honours per-map population targets — previously
      // this was hardcoded to MapType.UNIVERSE which filled small maps
      // (e.g. Pocket, count = 2) with Deep Space's 140 asteroids.
      const config = getRockShardFreeSpawn(this.currentMap.type);
      const newlyDestroyed: GameEntity[] = [];
      let currentAsteroidCount = 0;
      for (let i = 0; i < this.currentMap.entities.length; i++) {
          const e = this.currentMap.entities[i];
          if (e.shardVariant !== 'rock-shard') continue;
          currentAsteroidCount++;
          if (!e.active) newlyDestroyed.push(e);
      }
      for (const ast of newlyDestroyed) {
          // Asteroid-style shatter is variant-driven via ShardSystem
          // (Stage 3): the variant config gates count / size / scatter
          // and the size-floor check now lives inside shatter() too.
          if (this.currentMap) this.shards.shatter(ast, this.currentMap.entities);
      }
      if (currentAsteroidCount < config.count) {
          this.handleAsteroidRespawn(config);
      }

      // Flow-field nudge: steer each asteroid toward the grid flow direction.
      // Urgency is driven by TWO deficits, and the max of them wins:
      //
      //   parallelDeficit: how far below target the velocity's flow-aligned
      //   component is — ramps the correction back up to 9× when an asteroid
      //   is stalled or bouncing backward, and sits at 1× when it's cruising
      //   forward at target.
      //
      //   perpDeficit: how much velocity the asteroid has *perpendicular* to
      //   the flow — ramps up whenever something (collisions, mutual gravity,
      //   bond cohesion with a neighbour in a different flow cell) has
      //   dragged it off its streamline.  Without this term, an asteroid at
      //   the target parallel speed dropped to urgency = 1 regardless of
      //   how much sideways drift it had accumulated, so the perpendicular
      //   component of mutual gravity went essentially uncontested and
      //   asteroids slowly pulled each other into dense packs that still
      //   drifted at target speed together.  Keeping the perp-deficit hot
      //   makes the correction actively damp sideways motion, so packs
      //   spread back out onto the flow lines.
      const FLOW_CORRECTION  = 0.08;
      const FLOW_TARGET_SPEED = config.speedMultiplier;
      const asteroids = this.entityIndex.asteroids;
      const applyFlow = (e: GameEntity) => {
          const flow = this.flowField.sampleAsteroidFlow(e.position.x, e.position.y);
          const tx = flow.x * FLOW_TARGET_SPEED;
          const ty = flow.y * FLOW_TARGET_SPEED;
          const vAlongFlow = e.velocity.x * flow.x + e.velocity.y * flow.y;
          const vSq = e.velocity.x * e.velocity.x + e.velocity.y * e.velocity.y;
          const vPerp = Math.sqrt(Math.max(0, vSq - vAlongFlow * vAlongFlow));
          const parallelDeficit = Math.max(0, Math.min(1, 1 - vAlongFlow / FLOW_TARGET_SPEED));
          const perpDeficit     = Math.min(1, vPerp / FLOW_TARGET_SPEED);
          const urgency         = 1 + 8 * Math.max(parallelDeficit, perpDeficit);
          const alpha           = Math.min(0.8, FLOW_CORRECTION * dt * urgency);
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

      // Bucket candidate indices by grid cell — cell indices wrap modulo
      // the grid count so entities near a seam end up in the same bucket
      // as their counterparts on the far side (pair reasoning below uses
      // toroidal delta to compute the actual interaction force).
      const GRAV_GRID_COLS = Math.ceil(MAP_WIDTH  / GRAV_RANGE);
      const GRAV_GRID_ROWS = Math.ceil(MAP_HEIGHT / GRAV_RANGE);
      const gravCellKey = (cx: number, cy: number) => {
          const wx = ((cx % GRAV_GRID_COLS) + GRAV_GRID_COLS) % GRAV_GRID_COLS;
          const wy = ((cy % GRAV_GRID_ROWS) + GRAV_GRID_ROWS) % GRAV_GRID_ROWS;
          return (wx << 16) | (wy & 0xFFFF);
      };
      const gravGrid = new Map<number, number[]>();
      for (let i = 0; i < gravCandidates.length; i++) {
          const e = gravCandidates[i];
          const cx = Math.floor(e.position.x / GRAV_RANGE);
          const cy = Math.floor(e.position.y / GRAV_RANGE);
          let cell = gravGrid.get(gravCellKey(cx, cy));
          if (!cell) { cell = []; gravGrid.set(gravCellKey(cx, cy), cell); }
          cell.push(i);
      }

      // Check only same + 8 neighbouring cells; j > i ensures each pair is processed once
      for (let i = 0; i < gravCandidates.length; i++) {
          const a = gravCandidates[i];
          const acx = Math.floor(a.position.x / GRAV_RANGE);
          const acy = Math.floor(a.position.y / GRAV_RANGE);
          for (let ncx = acx - 1; ncx <= acx + 1; ncx++) {
              for (let ncy = acy - 1; ncy <= acy + 1; ncy++) {
                  const cell = gravGrid.get(gravCellKey(ncx, ncy));
                  if (!cell) continue;
                  for (let k = 0; k < cell.length; k++) {
                      const j = cell[k];
                      if (j <= i) continue;
                      const b = gravCandidates[j];
                      const dx = wrapDeltaX(a.position.x, b.position.x);
                      const dy = wrapDeltaY(a.position.y, b.position.y);
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

      // Stage 4: stick-bond + nebula gravity-merge are owned by
      // ShardSystem.update (called from updateGameLogic alongside
      // tickRegens).  The pass moved phases — was end-of-physics,
      // now end-of-logic — but same fixed-step dt, same ordering
      // relative to integration.

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

      // Stage 5: shard-family death dispatches by variant id rather
      // than EntityType.  The unified carrier (EntityType.STRUCTURE)
      // covers tiles (mass=Infinity) and mobile shards (finite mass)
      // in a single branch; per-variant behaviour falls out of
      // SHARD_VARIANTS and the variant-aware downstream calls.
      const variant = shardVariantOf(entity);
      const isShardFamily = entity.type === EntityType.STRUCTURE && variant !== null;
      const isStaticTile  = isShardFamily && entity.mass === Infinity;
      const isNebula      = variant === 'nebula-tile' || variant === 'nebula-shard';

      if (isShardFamily) {
          // Indestructible tiles should never reach onDeath in the
          // first place (damage paths short-circuit), but guard
          // defensively: restore health rather than queuing a
          // pointless regen.
          if (variant === 'indestructible-tile') {
              entity.health = entity.maxHealth;
              entity.active = true;
              return;
          }
          // Tile destruction patches the analytical flow field so
          // pursuing enemies don't path through holes that closed
          // since map load.  Mobile shards have no flow-field
          // footprint.
          if (isStaticTile) {
              this.flowField.onTileDestroyed(entity.position.x, entity.position.y);
          }
          // Variant-driven shatter (no-op for kind='none').
          // - nebula-tile: spawns 2-3 nebula-shards.
          // - rock-tile: spawns rock-shards (Stage 5+).
          // - glass-tile / reinforced-tile / heavy-tile: today's
          //   shatter is via DropSystem.spawnGlassShards (called
          //   from spawnDrops); the variant config has shatter.kind=
          //   'powerlaw' aspirationally for Stage 6 unification.
          if (this.currentMap && variant !== 'glass-tile' && variant !== 'reinforced-tile' && variant !== 'heavy-tile') {
              this.shards.shatter(entity, this.currentMap.entities);
          }
      }

      if (isNebula && this.currentMap) {
          // Nebula-specific ammo-drop roll + neighbour-counts-dirty.
          this.nebulas.handleDeath(
              this.currentMap.entities,
              this.activeDrops,
              entity,
          );
      }

      if (isShardFamily) {
          // Variant-driven regen — no-op for variants whose regen.kind
          // is 'none' / 'merge-only' (every mobile shard, plus nebula-
          // tile when TILE_REGEN_ENABLED is false, plus indestructible).
          this.shards.queueRegen(entity);
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
      } else if (variant === 'rock-shard' || variant === 'glass-shard') {
          // Small shard break — quick dusty puff.  Tile-shards
          // (glass-shard) puff the parent's tile colour; rock-shards
          // puff slate.  Stage 5: drives off shardVariant instead of
          // shardType so it works for both legacy ASTEROID-typed
          // entities and post-collapse STRUCTURE-typed shards.
          const breakColor = variant === 'glass-shard'
            ? (entity.color || '#6366f1')
            : '#94a3b8';
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
               const newAst = this.currentMap.createAsteroid(x, y,
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

    // ShardSystem update — drains the unified regen queue, ticks
    // existing stick-bonds, and runs the merge broadphase (gravity-
    // pull + bond formation).  Replaces the previous separate
    // GameEngine STRUCTURE regen loop, GameEngine handleEntitySticking,
    // and NebulaSystem updateDynamics.  Variant config drives every
    // policy decision (delay / threshold / pull-range / etc.).
    if (this.currentMap) {
        this.shards.setMergeContext(this.activeDrops, this.currentMap.type);
        this.shards.update(this.currentMap.entities, dt, this.physics);
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

    // Nebula per-frame pass: lazy nebula-grid index reset +
    // neighbour-count refresh that drives the interior-darken render
    // rule.  Stage 4: this system no longer owns regen / shard
    // gravity-merge / shard→tile transmutation — all routed through
    // ShardSystem above (regen/merge) and the onComposeNebulaShard
    // adapter hook (transmutation).
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

    // Thrust-gated emission — emit at a fixed rate (one tick every
    // EMIT_INTERVAL of real time) whenever throttle > 0.  Coasting at
    // full speed with no input still produces no rings, but the rate is
    // no longer scaled by throttle magnitude — so half-throttle gives
    // the same per-second emission count as full throttle, keeping
    // consecutive points (and PATH-shape segments) close together at
    // low throttle instead of stretching out into long choppy strokes.
    if (throttle > 0) {
        // Latch a chain break the first frame thrust resumes.  Stays set
        // through subsequent substeps / frames until an emission consumes
        // it — so the very first new point always gets chainStart, no
        // matter how long it takes the accumulator to reach EMIT_INTERVAL.
        if (!this.wasThrustingLastFrame) this.chainBreakPending = true;
        this.trailEmitAccumulator += dt;
        while (this.trailEmitAccumulator >= PLAYER_TRAIL_CONSTANTS.EMIT_INTERVAL) {
            this.trailEmitAccumulator -= PLAYER_TRAIL_CONSTANTS.EMIT_INTERVAL;
            // THRUST mode gets a 3× longer lifetime so the drift-extended
            // trail has time to reach its full reach behind the ship
            // before the head of the trail fades out; VELOCITY keeps the
            // production lifetime since its trail doesn't drift.
            const pointLifetime = this.trailEmitMode === TrailEmitMode.THRUST
                ? PLAYER_TRAIL_CONSTANTS.LIFETIME * 3
                : PLAYER_TRAIL_CONSTANTS.LIFETIME;
            this.player.trail = this.player.trail || [];
            // Capture velocity direction at emit so shape-aware variants
            // (LINE / TRIANGLE) orient consistently with the ship's heading.
            const vx = this.player.velocity.x;
            const vy = this.player.velocity.y;
            const angle = (vx !== 0 || vy !== 0) ? Math.atan2(vy, vx) : 0;
            // Trail-extension direction — VELOCITY mode (default) emits at
            // player.position with no per-point velocity, so the trail
            // naturally extends opposite to velocity as the ship moves
            // through space.  THRUST mode emits AT player.position too
            // (no initial offset, so the newest point sits on the ship)
            // and gives each point a per-tick drift in the -input
            // direction so it gradually extends away over the point's
            // lifetime — engine-exhaust style, anchored at the ship at
            // birth.
            let driftVx: number | undefined;
            let driftVy: number | undefined;
            if (this.trailEmitMode === TrailEmitMode.THRUST) {
                const dirX = moveDir.x / throttle;
                const dirY = moveDir.y / throttle;
                const driftSpeed = maxSpeed * 0.5;
                driftVx = -dirX * driftSpeed;
                driftVy = -dirY * driftSpeed;
            }
            this.player.trail.push({
                x: this.player.position.x,
                y: this.player.position.y,
                vx: driftVx,
                vy: driftVy,
                lifetime: pointLifetime,
                maxLifetime: pointLifetime,
                scale: 1,
                angle,
                chainStart: this.chainBreakPending ? true : undefined,
            });
            this.chainBreakPending = false;
        }
        this.wasThrustingLastFrame = true;
    } else {
        this.trailEmitAccumulator = 0;
        this.wasThrustingLastFrame = false;
    }

    // Glitter trail — motion-driven sparkles overlaid on the player sprite
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

        // Ammo HUD slot selection — intercept taps on the weapon slots.
        // Layout: [BLASTER] gap [AMMO READOUT] gap [BURST][SHOTGUN]…
        // The ammo readout box (between the blaster and the other weapons)
        // is informational only and not selectable.
        const { SLOT_H, SLOT_GAP } = AMMO_HUD_CONSTANTS;
        const { startY: slotStartY, slotW, blasterX, weaponsStartX } =
            computeAmmoHUDLayout(window.innerWidth, window.innerHeight);

        if (evt.y >= slotStartY && evt.y <= slotStartY + SLOT_H) {
            // Blaster slot (index 0)
            if (evt.x >= blasterX && evt.x <= blasterX + slotW) {
                this.selectWeapon(WEAPON_LIST[0]);
                return;
            }
            // Non-blaster weapon slots (indices 1..N-1)
            for (let i = 1; i < WEAPON_LIST.length; i++) {
                const sx = weaponsStartX + (i - 1) * (slotW + SLOT_GAP);
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

    // Tick down the shared ammo-pickup flash timer
    if (this.player.ammoPickupFlash && this.player.ammoPickupFlash.timer > 0) {
      this.player.ammoPickupFlash.timer -= dt;
      if (this.player.ammoPickupFlash.timer <= 0) {
        this.player.ammoPickupFlash = undefined;
      }
    }

    // Proximity collection + magnetic pull — single pass over activeDrops.
    // Ammo shards get a magnet accelerator; health hearts collect on contact
    // only (static pickup).
    if (!this.player.isExploding) {
      const collectRadSq = DROP_CONFIG.COLLECT_RADIUS * DROP_CONFIG.COLLECT_RADIUS;
      const MAGNET_RANGE_SQ = 150 * 150;
      const MAGNET_ACCEL    = 7; // world-units/s² toward player; scales up as dist shrinks
      for (let i = 0; i < this.activeDrops.length; i++) {
        const drop = this.activeDrops[i];
        if (!drop.active) continue;
        const dx     = wrapDeltaX(drop.position.x, this.player.position.x);
        const dy     = wrapDeltaY(drop.position.y, this.player.position.y);
        const distSq = dx * dx + dy * dy;
        if (distSq <= collectRadSq) {
          this.applyDropEffect(drop);
          drop.active = false;
          continue;
        }
        // Health drops are static — skip the magnet pull.
        if (drop.dropType === 'health') continue;
        if (distSq < MAGNET_RANGE_SQ) {
          const dist = Math.sqrt(distSq);
          const a    = MAGNET_ACCEL / dist; // inverse-linear: stronger when closer
          drop.velocity.x += dx * a * dt;
          drop.velocity.y += dy * a * dt;
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

      case EntityType.STRUCTURE:
        // Stage 6: STRUCTURE covers both static tiles (mass=∞) and
        // mobile shards (finite mass).  Mobile rock-shards get the
        // gray rocky dust the legacy ASTEROID branch produced;
        // mobile glass-shards keep the tile-spark layer.
        if (target.mass !== Infinity && target.shardVariant === 'rock-shard') {
          const dustCount = target.size.x > 50 ? 5 : 3;
          this.spawnParticles(impactPos, dustCount, '#94a3b8', {
            speedMin: 1.5, speedMax: 4, sizeMin: 1, sizeMax: 2,
            spreadAngle: impactAngle, spreadCone: Math.PI * 0.55,
            baseVelocity: { x: target.velocity.x * 0.3, y: target.velocity.y * 0.3 },
          });
        } else {
          // Tile sparks: two layers — colored chips + white hot sparks
          this.spawnParticles(impactPos, 4, target.color || '#6366f1', {
            speedMin: 3, speedMax: 7, sizeMin: 1, sizeMax: 2,
            spreadAngle: impactAngle, spreadCone: Math.PI * 0.65,
          });
          this.spawnParticles(impactPos, 3, '#ffffff', {
            speedMin: 5, speedMax: 10, sizeMin: 0.5, sizeMax: 1.5,
            spreadAngle: impactAngle, spreadCone: Math.PI * 0.5,
          });
        }
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
      this.trailEmitAccumulator = 0;
      this.wasThrustingLastFrame = false;
      this.chainBreakPending = false;
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
              const dx = wrapDeltaX(prev.position.x, e.position.x);
              const dy = wrapDeltaY(prev.position.y, e.position.y);
              const d2 = dx * dx + dy * dy;
              if (d2 < nextDistSq) { nextDistSq = d2; nextTarget = e; }
          }
          for (let i = 0; i < asteroids.length; i++) {
              const e = asteroids[i];
              if (e.isExploding || hitSet.has(e.id)) continue;
              const dx = wrapDeltaX(prev.position.x, e.position.x);
              const dy = wrapDeltaY(prev.position.y, e.position.y);
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

  // createAsteroidShards moved to ShardSystem.shatter in Stage 3 of
  // the shard-system overhaul.  See engine/systems/ShardSystem.ts.

  // --- WAVE SYSTEM ---

  /** Build the per-call spawn context that WaveSystem needs.  Kept as a
   *  tiny helper so every wave entry point (init / grace tick / skip) goes
   *  through the same factory. */
  private waveContext(): WaveSpawnContext | null {
    if (!this.currentMap) return null;
    // Read the live window size + camera zoom at spawn time so a recent
    // browser resize is reflected without needing a resize listener.
    // halfW/halfH match RenderSystem's viewport math exactly.
    const zoom = this.camera.zoom || 1;
    const halfW = (window.innerWidth / 2) / zoom;
    const halfH = (window.innerHeight / 2) / zoom;
    const viewportHalfDiagonal = Math.hypot(halfW, halfH);
    return {
      entities: this.currentMap.entities,
      player: this.player,
      physics: this.physics,
      enemyScale: this.enemyScale,
      difficultyLevel: this.difficultyLevel,
      viewportHalfDiagonal,
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
      const dx = wrapDeltaX(position.x, e.position.x);
      const dy = wrapDeltaY(position.y, e.position.y);
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

  private spawnAmmoDrop(pos: Vector2, amount: number, parentVelocity?: Vector2) {
    if (!this.currentMap) return;
    this.drops.spawnAmmoDrop(this.currentMap.entities, this.activeDrops, pos, amount, parentVelocity);
  }

  private spawnHealthDrop(pos: Vector2, value: number, parentVelocity?: Vector2) {
    if (!this.currentMap) return;
    this.drops.spawnHealthDrop(this.currentMap.entities, this.activeDrops, pos, value, parentVelocity);
  }

  private loadMap(map: BaseMapLayer) {
      // Push the new map's dimensions into the shared toroidal module
      // BEFORE the map initialises or any system rebuilds its static
      // state — initializeStaticGrid, initObstacles, buildAsteroidField
      // all read dimension-derived constants that must reflect the
      // active map.  Listeners registered by PhysicsSystem, FlowField,
      // and FlowFieldGrid update their caches synchronously here.
      setMapDimensions(map.width, map.height);
      if (!map.initialized) {
          map.init();
      }
      this.currentMap = map;
      // Pre-calculate spatial grid for static tiles to avoid overhead in main loop
      this.physics.initializeStaticGrid(map.entities);
      // Cache gravitational attractors once per map so applyGravity no
      // longer rescans the full entity array every substep.  Attractors
      // are effectively static geometry (stellar POIs), so a one-shot
      // cache matches their lifecycle.
      this.physics.initializeAttractors(map.entities);
      this.flowField.initObstacles(map.entities);
      this.flowField.buildAsteroidField((x, y) => map.sampleFlow(x, y));
      this.renderer.setMapType(map.type);
      // Forward the map's recorded nebula cluster-center positions to
      // the background layer so its puffs render at the same world
      // positions as the interactable tile clusters (one unified
      // cloud; backdrop still parallaxes as the camera moves).
      this.renderer.setNebulaClusterCenters(map.nebulaClusterCenters);
      // Pre-render structure dots to an offscreen minimap canvas so the
      // per-frame minimap pass is a single blit instead of ~22k fillRects.
      this.renderer.buildMinimapStaticLayer(map.entities, map.width, map.height);
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
          this.waveAnnouncements
      );
  }

  // ─── Perf recording ─────────────────────────────────────────────────────
  // Called exactly once per sim substep (immediately after updatePhysics +
  // updateGameLogic).  Reads the `lastXMs` fields populated by each system
  // during the substep and advances the shared ring-buffer cursor.
  private recordSimPerf() {
      const idx = this.perfSimIdx;
      this.perfPhysics[idx]       = this.physics.lastUpdateMs;
      this.perfAI[idx]            = this.ai.lastUpdateMs;
      this.perfHoming[idx]        = this.projectiles.lastHomingMs;
      this.perfLightning[idx]     = this.projectiles.lastLightningMs;
      this.perfGravity[idx]       = this.physics.lastGravityMs;
      this.perfLocalGravity[idx]  = this.physics.lastLocalGravityMs;
      this.perfCollisions[idx]    = this.physics.lastCollisionsMs;
      this.perfFlowField[idx]     = this.flowField.lastFlushMs;
      this.perfDensity[idx]       = this.physics.lastMaxCellDensity;
      const next = idx + 1;
      this.perfSimIdx = next >= GameEngine.PERF_WINDOW ? 0 : next;
      if (this.perfSimFilled < GameEngine.PERF_WINDOW) this.perfSimFilled++;
  }

  // Called once per render frame (after draw()).  Render timing uses its
  // own ring since it happens once per frame regardless of how many sim
  // substeps the accumulator drained.
  private recordRenderPerf() {
      this.perfRender[this.perfRenderIdx] = this.renderer.lastRenderMs;
      this.perfNebula[this.perfRenderIdx] = this.renderer.lastNebulaMs;
      const next = this.perfRenderIdx + 1;
      this.perfRenderIdx = next >= GameEngine.PERF_WINDOW ? 0 : next;
      if (this.perfRenderFilled < GameEngine.PERF_WINDOW) this.perfRenderFilled++;
  }


  /**
   * Average the first `filled` entries of a ring buffer.  `filled` tracks
   * how many samples have been written since startup so the reported mean
   * isn't dragged toward zero by the pre-allocated tail of the buffer
   * during the first second of gameplay.
   */
  private static ringAvg(buf: Float64Array, filled: number): number {
      if (filled <= 0) return 0;
      let sum = 0;
      for (let i = 0; i < filled; i++) sum += buf[i];
      return sum / filled;
  }

  /**
   * Peak value over the populated portion of a ring buffer.  Used for
   * maxCellDensity so a single-frame spike remains visible in the overlay
   * even after the surrounding substeps report normal density.
   */
  private static ringPeak(buf: Float64Array, filled: number): number {
      if (filled <= 0) return 0;
      let m = 0;
      for (let i = 0; i < filled; i++) if (buf[i] > m) m = buf[i];
      return m;
  }

  private buildPerfSnapshot(): PerfSnapshot {
      const simN = this.perfSimFilled;
      return {
          physicsMs:      GameEngine.ringAvg(this.perfPhysics,      simN),
          aiMs:           GameEngine.ringAvg(this.perfAI,           simN),
          homingMs:       GameEngine.ringAvg(this.perfHoming,       simN),
          lightningMs:    GameEngine.ringAvg(this.perfLightning,    simN),
          gravityMs:      GameEngine.ringAvg(this.perfGravity,      simN),
          localGravityMs: GameEngine.ringAvg(this.perfLocalGravity, simN),
          collisionsMs:   GameEngine.ringAvg(this.perfCollisions,   simN),
          flowFieldMs:    GameEngine.ringAvg(this.perfFlowField,    simN),
          renderMs:       GameEngine.ringAvg(this.perfRender,       this.perfRenderFilled),
          nebulaMs:       GameEngine.ringAvg(this.perfNebula,       this.perfRenderFilled),
          nebulaVisible:  this.renderer.lastNebulaVisible,
          nebulaFast:     this.renderer.lastNebulaFastCount,
          nebulaSlow:     this.renderer.lastNebulaSlowCount,
          // Cell density peaks on single-frame spikes — report the window
          // max so the overlay surfaces transient clusters, not just the mean.
          maxCellDensity: GameEngine.ringPeak(this.perfDensity,     simN),
          totalEntities:     this.perfCounts.totalEntities,
          enemyCount:        this.perfCounts.enemyCount,
          asteroidCount:     this.perfCounts.asteroidCount,
          projectileCount:   this.perfCounts.projectileCount,
          particleCount:     this.perfCounts.particleCount,
          interactableCount: this.perfCounts.interactableCount,
      };
  }
}
