

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
import { ShardVariantId } from './systems/ShardSystem.types';
import { EntityIndex } from './systems/EntityIndex';
import { PerfController } from './systems/PerfController';
import { PerfRecorder } from './systems/PerfRecorder';
import { nextId } from './systems/IdAllocator';
import { BaseMapLayer, UniverseMap, RingMap, SevenRingsMap, PocketMap, AsteroidFieldMap, GlassFieldMap, PlasticFieldMap, MetalFieldMap, IndestructibleFieldMap, NebulaFieldMap, RockFieldMap, TileHeavyMap } from './maps/MapClasses';
import { TileGenerator, HEX_WIDTH, HEX_HEIGHT } from './maps/TileGenerator';
import { GameEntity, EntityType, MapType, CameraState, EngineStats, PerfSnapshot, Vector2, WeaponType, WeaponConfig, DamageText, GameState, DropCompositionEntry, PlayerHUDMessage, WaveAnnouncement, TrailPoint, TrailShape, TrailEmitMode, UpgradeCard, EffectPayload, EnemySubtype, ConsumeConfig } from '../types';
import { COLORS, PHYSICS_CONSTANTS, WEAPONS, WEAPON_LIST, MINIMAP_CONSTANTS, PLAYER_MOVEMENT_CONFIG, DAMAGE_TEXT_CONSTANTS, getRockShardFreeSpawn, TRAIL_CONSTANTS, PLAYER_TRAIL_CONSTANTS, PARTICLE_CONSTANTS, CAMERA_CONSTANTS, SPRITE_CONSTANTS, EXPLOSION_CONSTANTS, DIFFICULTY_SCALES, DROP_CONFIG, AMMO_CONSTANTS, STRUCTURE_CONSTANTS, AI_CONFIG, AMMO_HUD_CONSTANTS, computeAmmoHUDLayout, LIGHTNING_CHAIN_RANGE, LIGHTNING_CHAIN_COUNT, LIGHTNING_CHAIN_BRANCHES, LIGHTNING_CHAIN_EXCLUDED_VARIANTS, LIGHTNING_ARC_LIFETIME, SHIELD_CONSTANTS, HEALTH_DROP_INTERVAL, SCORE_CONSTANTS, SNITCH_CONSTANTS, UPGRADE_DEFS, UPGRADE_EFFECTS, UpgradeId, UPGRADE_CARD_CONSTANTS, UNLOCK_DEFS, UnlockDef, REGEN_POP_CONSTANTS, SIMULATION_CONSTANTS, INPUT_CONSTANTS, COLLISION_CONFIG, HIT_FEEDBACK, SHARD_PAIR_CONSTANTS, SHARD_TILE_PAIR_CONSTANTS, SHARD_VARIANTS, NEBULA_CONSTANTS, randomPlasticShade, randomPlasticShardShade, cyclePlasticPalette, getActivePlasticPaletteName, cyclePlasticShardPalette, getActivePlasticShardPaletteName, cyclePlasticGlowBrightness, getActivePlasticGlowBrightnessName, cycleMetalGlowBrightness, getActiveMetalGlowBrightnessName, cycleGlassGlowColor, getActiveGlassGlowColorName, cycleMetalGlowColor, getActiveMetalGlowColorName, cycleNebulaPalette, getActiveNebulaPaletteName, cycleNebulaStretch, getActiveNebulaStretchName, togglePlasticAutomataBrighten, isPlasticAutomataBrighten, PLASTIC_SHARD_FLOW_MULT, FLOW_VARIABILITY, MERGE_BLOWBACK, cycleShatterGrace, getActiveShatterGraceName, cyclePlayerThrust, getActivePlayerThrustName, getActivePlayerThrustMult, cyclePlayerSpeed, getActivePlayerSpeedName, getActivePlayerSpeedMult, cycleSnitchSpeed, getActiveSnitchSpeedName, getActiveSnitchSpeedMult, cycleSwarmMove, getActiveSwarmMoveName, getWaveDurationSec, cycleEnemyScale, getActiveEnemyScaleName, enemyHpMult, enemyDamageMult, hitReactStrength, CORROSION, DISABLE, ROCK_CHIP, ENEMY_NEBULA_BURST, KAMIKAZE_DETONATE_BUFFER, isCollectibleDrop, ENEMY_VARIANTS, BUBBLE_CONSTANTS, DRAGON_CONSTANTS, StructureVariant, RIVAL_CONSTANTS, RivalDisposition, PERF_CONTROLLER_CONSTANTS } from '../constants';
import { ASSETS } from '../assets';
import { invalidateCollisionR } from './entityCache';
import { FlowFieldGrid } from './systems/FlowFieldGrid';
import { FlowPattern, samplePattern } from './systems/FlowField';
import type { FlowSampler } from './systems/FlowFieldGrid';
import { wrapDeltaX, wrapDeltaY, wrapPosition, MAP_WIDTH, MAP_HEIGHT, setMapDimensions } from './toroidal';
import { randomRockNebulaComposition } from './NebulaColor';

/** Average two 6-digit hex colours component-wise. */
function blendHexColors(hexA: string, hexB: string): string {
    const rA = parseInt(hexA.slice(1, 3), 16), gA = parseInt(hexA.slice(3, 5), 16), bA = parseInt(hexA.slice(5, 7), 16);
    const rB = parseInt(hexB.slice(1, 3), 16), gB = parseInt(hexB.slice(3, 5), 16), bB = parseInt(hexB.slice(5, 7), 16);
    return `#${Math.round((rA + rB) / 2).toString(16).padStart(2, '0')}${Math.round((gA + gB) / 2).toString(16).padStart(2, '0')}${Math.round((bA + bB) / 2).toString(16).padStart(2, '0')}`;
}

// Per-projectile-hit probability that a rock-tile dent emits a nebula-
// puff shard.  Death-burst puffs (rock-tile end-of-life, rock-shard
// shatter) are not gated by this — only the per-hit dust kick is.
// Tuned so a player drilling a single rock-tile sees one puff per ~3
// hits rather than every shot, matching the user-requested "occasional
// dust" feel instead of a continuous cloud.
const ROCK_HIT_NEBULA_PUFF_CHANCE = 0.3;

/** One live dragon mini-boss (Stage 6): its head entity + Snake body + per-
 *  dragon lifecycle/attack timers.  Multiple can be alive at once. */
interface DragonInstance {
  head: GameEntity;
  body: GameEntity[];                    // eaten/spawned tiles, head→tail
  state: 'enter' | 'roam' | 'leave';
  stateTimer: number;                    // seconds left in the current state
  time: number;                          // weave clock
  gnatTimer: number;                     // countdown to the next brood spit
  missileTimer: number;                  // countdown to the next homing missile
  portal?: { x: number; y: number };     // exit-portal centre (leave state only)
  headThrough?: boolean;                  // head has crossed the exit portal
}

// A rival ship (Stage 7) and its engine-managed lifecycle/AI state.  The ship
// itself is a plain EntityType.ENEMY carrying isRival; everything else lives
// here so the entity stays lean.
interface RivalInstance {
  ship: GameEntity;
  disposition: RivalDisposition;
  state: 'enter' | 'roam' | 'leave';
  stateTimer: number;        // seconds left in the current state
  fireTimer: number;         // weapon cooldown
  stolen: number;            // points denied to the player so far (HUD/popup)
  portal?: { x: number; y: number };  // exit-portal centre (leave only)
  // Cached hunt target (Stage 7 perf).  Re-acquired on the PerfController
  // `rivalScan` cadence; steering/firing recompute only the O(1) distance to it
  // every step, and it's dropped the moment it goes inactive/exploding.
  target?: GameEntity | null;
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
  // Central performance controller — samples load each sim step and
  // hands every skippable pass an effective frame-skip interval.  See
  // engine/systems/PerfController.ts.
  private perfController: PerfController;
  // In-game FPS / perf capture harness (DBG tool).  Zero cost while idle;
  // records the per-frame timing + PerfSnapshot stream over a window and
  // exports a copy-paste text block (see engine/systems/PerfRecorder.ts).
  private perfRecorder: PerfRecorder = new PerfRecorder();

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
  // Run score — tier-scaled enemy-kill points + early-clear wave bonuses.
  // Reset with the rest of the run state in resetAndLoadSelectedMap.
  private score: number = 0;
  // HUD ticker — eases up toward `score` by integer steps each frame so
  // big awards roll up instead of snapping.  Display only; `score` is truth.
  private displayScore: number = 0;
  // Kill combo — `comboCount` rapid ship kills within `comboTimer`'s window
  // build a points multiplier (see comboMultiplier()).  Reset when the
  // window lapses.  Ship kills only; shard/tile kills don't touch it.
  private comboCount: number = 0;
  private comboTimer: number = 0;
  // ── Progression ─────────────────────────────────────────────────────────
  // Spendable Salvage currency (earns 1:1 with score) and per-upgrade levels.
  // applyUpgrades() folds the levels into the player's effective stats; all
  // reset per run.  Behaviour-changing unlocks + shop UI build on top.
  private credits: number = 0;
  private upgradeLevels: Record<UpgradeId, number> = {
      hull: 0, plating: 0, capacitor: 0, engine: 0,
      thrusters: 0, gunnery: 0, autoloader: 0, magazine: 0,
  };
  // Between-wave upgrade-card choice.  When `cardChoicePending` is set the
  // sim pauses and the UI shows `pendingCards`; picking one applies it and
  // resumes.  Offered every `cardWaveInterval` waves (DBG-cyclable).
  private cardChoicePending: boolean = false;
  private pendingCards: UpgradeCard[] = [];
  private cardWaveInterval: number = UPGRADE_CARD_CONSTANTS.DEFAULT_WAVE_INTERVAL;
  // Short delay after a wave clears before the card modal opens, so the
  // celebration animation plays first.  0 = nothing pending.
  private cardOpenDelaySec: number = 0;
  private pendingCardWaveNum: number = 0;
  // ── Unlocks ─────────────────────────────────────────────────────────────
  // The run starts LEAN: Blaster only, no shield, no charged shots.  Bought
  // in the Drydock (Salvage) or, rarely, granted free via a card.  Synced to
  // the player entity (ownedWeapons / overchargeUnlocked) for WeaponSystem.
  private unlockedWeapons: Set<WeaponType> = new Set([WeaponType.BLASTER]);
  private shieldUnlocked: boolean = false;
  private overchargeUnlocked: boolean = false;
  // The one live "+N" points popup, if any.  New awards accumulate into it
  // (O(1)) so a burst of kills reads as one growing number instead of a
  // pile — and without scanning the damage-text array per award.
  private _livePointsPopup: DamageText | null = null;
  // Damage-text object pool — see ParticleSystem._pool for the same
  // pattern in entity-space.  Damage texts spawn a few per impact and
  // expire on lifetime; reusing the objects across the spawn/despawn
  // cycle removes the literal-allocation cost from the hot combat path.
  private _damageTextPool: DamageText[] = [];
  private readonly DAMAGE_TEXT_POOL_CAP = 64;
  private playerMessages: PlayerHUDMessage[] = [];
  private readonly MAX_PLAYER_MESSAGES = 6;
  private currentWeaponIndex: number = 0;
  
  private minimapExpanded: boolean = false;
  private minimapTimer: number = 0;
  private minimapDebounce: number = 0;
  private interactionCooldown: number = 0;
  private frameEntities: GameEntity[] = [];

  // Reusable viewport rect — refreshed once per frame in
  // prepareFrameEntities and shared with EntityIndex / ShardSystem so
  // graceful-cleanup picks can prefer offscreen candidates without
  // allocating a fresh rect every frame.
  private _viewportRect = { left: 0, right: 0, top: 0, bottom: 0 };

  private respawnTimer: number = 0;
  // DBG enemy-test override: when set, every wave spawns ONLY this subtype.
  // Persists across map switches (a testing setting); applies from the next
  // wave start.
  private forcedTestEnemy: EnemySubtype | null = null;
  private difficultyLevel: number = 3;
  private enemyScale: number = 1;
  // Map the next restart / initial load should build.  Updated from the
  // main-menu map-style buttons so the UI-selected map survives the
  // restartGame() path (which re-instantiates the map class from scratch).
  private selectedMapType: MapType = MapType.UNIVERSE;

  // Debug mode
  private debugMode: boolean = false;

  // Player-trail shape — debug-only A/B selector.  CIRCLE matches the
  // production look; the rest are dev variants exposed via the DBG panel.
  private trailShape: TrailShape = TrailShape.CIRCLE;
  // Player-trail direction mode — VELOCITY (default) extends the trail
  // opposite to velocity (current production look — points emitted at
  // player.position naturally trail behind via the ship's path through
  // space).  THRUST extends the trail opposite to the input/thrust
  // direction by accumulating a per-emit offset in -input.  Toggled
  // from the DBG panel.
  private trailEmitMode: TrailEmitMode = TrailEmitMode.THRUST;

  // ── Performance toggle: player↔asteroid local gravity ───────────
  // PhysicsSystem.applyLocalGravity is the bidirectional pull
  // between the player ship and nearby asteroids (LOCAL_GRAVITY_
  // CONSTANTS).  Defaults to ON to match production; the DBG
  // panel's "LGrav" button flips it for measuring its cost in
  // isolation.
  private localGravityEnabled: boolean = true;
  // ── Performance toggle: attractor gravity scan ──────────────────
  // PhysicsSystem.applyGravity walks the master entity list every
  // frame to apply each POI / attractor's gravity to in-range
  // entities.  On populated maps the outer loop iterates ~22k
  // tiles + shards + particles even when there are no attractors
  // active.  DBG panel's "Grav" button flips it off so the cost
  // can be measured in isolation.
  private attractorGravityEnabled: boolean = true;
  // ── Performance toggle: SAT collision broadphase ────────────────
  // PhysicsSystem.handleEntityCollisions is the dynamic-grid
  // broadphase + SAT polygon resolver.  Off mode disables the
  // entire pass — projectiles fly through everything, ships clip,
  // tiles aren't destructible — purely for measuring the isolated
  // cost in the perf overlay.  Defaults to ON.
  private collisionsEnabled: boolean = true;

  // Debug toggle — gates the dedicated mobile-shard ↔ static-tile
  // collision scan in PhysicsSystem.  Defaults to OFF: today's
  // broadphase doesn't pair these (shards skip the outer loop), so
  // mobile shards drift through tiles' geometry; flipping ON adds
  // the missing scan and the asteroid-crash branch starts firing.
  private shardTileCollisionsEnabled: boolean = true;

  // Wave system state lives on this.waves (WaveSystem) — these accessors
  // preserve the old GameEngine.waveX field ergonomics for the handful of
  // call sites that still read/write them directly.
  private get waveIndex(): number { return this.waves.waveIndex; }
  private set waveIndex(v: number) { this.waves.waveIndex = v; }
  private get waveState(): 'inactive' | 'active' | 'cleared' { return this.waves.waveState; }
  private set waveState(v: 'inactive' | 'active' | 'cleared') { this.waves.waveState = v; }
  private get waveGraceTimer(): number { return this.waves.waveGraceTimer; }
  private set waveGraceTimer(v: number) { this.waves.waveGraceTimer = v; }

  // Screen Shake State
  private shakeTimer: number = 0;
  private shakeIntensity: number = 0;
  // DBG toggle — when false, handleScreenShake early-returns and
  // the camera stays anchored regardless of impact magnitude.
  private screenShakeEnabled: boolean = false;

  // ── Asteroid/shard flow-field DBG state ──────────────────────────────
  // When `asteroidFlowEnabled` is false, the per-asteroid / per-ammo-drop
  // velocity nudge in updatePhysics is skipped entirely.  Asteroids that
  // were moving keep their current velocity but receive no further
  // streamline correction; combined with `linearDamping` they decay
  // toward zero velocity over a few seconds and then only move when
  // collided with or pulled by gravity.  Default true.
  private asteroidFlowEnabled: boolean = true;

  // ── Snitch state ──────────────────────────────────────────────────────
  // One quidditch-style snitch that persists across waves: rides the
  // asteroid flow field with a burst/coast AI; catching it pays
  // SCORE_CONSTANTS.SNITCH_POINTS and ends the current wave (see
  // updateSnitch / catchSnitch).  A fresh one spawns for the next wave.
  private snitch: GameEntity | null = null;
  // Wander clock for the weave oscillation (sim-time accumulated).
  private snitchTime: number = 0;
  // Snitches CAUGHT this run — drives the speed ramp (NOT the wave number),
  // so the player can defer the snitch to keep it slow.  Reset per run.
  private snitchCatchCount: number = 0;
  // Catch interaction — DBG-toggleable while playtesting collide vs shoot.
  private snitchCatchMode: 'collide' | 'shoot' = 'collide';
  // Burst/coast AI state (see the SNITCH_CONSTANTS doc block) — there is
  // only ever one live snitch, so engine-level fields suffice; all of
  // these are re-seeded in spawnSnitch().
  private snitchAiState: 'coast' | 'dart' = 'coast';
  private snitchAiTimer: number = 0;        // countdown to the next state flip
  private snitchPanicCooldown: number = 0;  // guaranteed coast window between panic darts
  private snitchSpeedMult: number = 0;      // eased current speed (fraction of player cruise)
  private snitchDartAway: boolean = false;  // current dart is a panic dart (away-bias active)
  private snitchDartAwayX: number = 0;
  private snitchDartAwayY: number = 0;

  // ── Ambient bubble fauna (Stage 5) ────────────────────────────────────────
  // Bubbles are always-present roamers, not wave enemies.  maintainAmbient-
  // Bubbles keeps at least BUBBLE_CONSTANTS.AMBIENT_POPULATION alive, spawning
  // one offscreen each time this top-up timer elapses while the field is short.
  private ambientBubbleTimer: number = 0;

  // ── Dragon mini-boss (Stage 6) ────────────────────────────────────────────
  // Any number of engine-managed segmented serpents at once.  Each head is a
  // normal ENEMY (damageable / routed through handleEntityDeath); per-dragon
  // lifecycle + movement + Snake-body live on its DragonInstance (see
  // spawnDragon / updateDragons).
  private dragons: DragonInstance[] = [];
  private _dragonEatBuf: GameEntity[] = []; // reused tile-devour scratch (no per-frame alloc)
  private dragonsKilled = 0; // kill payout doubles each kill (3000 → 6000 → 12000 …)
  private rivals: RivalInstance[] = [];  // Stage 7 player-like roamers
  private nextRivalScore = RIVAL_CONSTANTS.SCORE_INTERVAL; // score at which the next rival warps in

  // Overlay toggles — gate the RenderSystem's asteroid/shard FF overlay
  // pass on/off independently.  All default OFF; debug-only.
  private ffOverlayVectors:   boolean = false;
  private ffOverlayCells:     boolean = false;
  private ffOverlayObstacles: boolean = false;
  private ffOverlayRebuilds:  boolean = false;
  // Vector overlay stride — cycles through SAMPLE_N_CYCLE so a coarser
  // sweep doesn't bury detail on dense maps.  Cells/obstacles/rebuild
  // overlays always render every cell.
  private static readonly FF_SAMPLE_N_CYCLE: readonly number[] = [1, 2, 4, 8, 16] as const;
  private ffOverlaySampleN: number = 1;
  // Cycle of cell sizes for the DBG "FF Density" toggle.  Coarsest
  // first (matches the existing default).  Each step rebuilds both
  // grids — asteroid field via the analytical formula + repulsion,
  // pursuit field lazily on the next sample.  Note: pursuit-field
  // range (MAX_ENEMY_RANGE) is measured in cells, so shrinking the
  // cell size also shrinks the world-units range — at 32 / 6 ≈ 50 %
  // of the default the BFS only fans out ~350 units, leaving enemies
  // outside that radius to rely on direct steering.  DBG-only knob;
  // production stays at the default 256.
  private static readonly FF_DENSITY_CYCLE: readonly number[] =
    [256, 192, 128, 96, 64, 48, 32] as const;
  private ffCellSize: number = 48;
  // Wall-repulsion kernel radius for the asteroid field, in cells.
  // R = 0 → legacy 4-cardinal-only scan (A/B baseline); R = 1..5 →
  // (2R+1)² neighbourhood with 1/d² falloff so the flow curves around
  // tile clusters from several cells away.  Default 3 — matches the
  // FlowFieldGrid default constant.  DBG-cycle via "FF KernelR".
  private static readonly FF_KERNEL_R_CYCLE: readonly number[] =
    [0, 1, 2, 3, 4, 5] as const;
  private ffKernelR: number = 5;
  // Tangent-mix factor for the wall-repulsion contribution.  0 = pure
  // radial (push perpendicular away from walls — current behaviour
  // produces opposing vectors on opposite sides of a long wall and
  // traps shards in the saddle along the boundary).  1 = pure tangent
  // (slide along the wall in the direction of the base flow — both
  // sides of the wall now point the same way along the wall, no
  // saddle).  Default 0.5 — meaningful tangent contribution while
  // still preserving some push-away behaviour.  DBG-cycle.
  private static readonly FF_TANGENT_MIX_CYCLE: readonly number[] =
    [0.0, 0.25, 0.5, 0.75, 1.0] as const;
  private ffTangentMix: number = 0.5;
  // Breathing field — scroll rate (rad/s) for the slow undulation
  // that migrates convergence zones so shard piles dissolve.  0 = off
  // (static field, no periodic re-bake).  DBG-cycle "FF Breathe":
  // off / slow / med / fast.
  private static readonly FF_BREATHE_RATE_CYCLE: readonly number[] =
    [0, 0.15, 0.4, 0.9] as const;
  private ffBreatheRate: number = 0;
  private ffBreathePhase: number = 0;
  private ffBreatheRebakeTimer: number = 0;
  // Seconds between breathing re-bakes.  ~3 Hz: smooth enough for a
  // slow drift, cheap enough that the per-bake cost (sub-ms at default
  // density) is negligible.
  private static readonly FF_BREATHE_REBAKE_INTERVAL = 0.33;
  // Per-shard lane jitter — strength of the persistent perpendicular
  // offset added to each shard's flow target so shards ride slightly
  // different parallel lanes instead of collapsing onto one streamline.
  // 0 = off.  DBG-cycle "FF Lane": off / low / med / high.
  private static readonly FF_LANE_JITTER_CYCLE: readonly number[] =
    [0, 0.1, 0.2, 0.35] as const;
  private ffLaneJitter: number = 0.2;
  // Selectable base-flow pattern (DBG "FF Pattern").  DEFAULT routes to
  // the active map's own sampleFlow(); the rest swap in an analytical
  // field (circular / spiral / gravity well / directional / wavy …).
  // Persists across map loads so a pattern can be compared on different
  // maps.  Cycling re-bakes the asteroid field with the chosen sampler;
  // kernel / tangent / breathing all still apply on top.
  private static readonly FF_PATTERN_CYCLE: readonly FlowPattern[] = [
    FlowPattern.DEFAULT,
    FlowPattern.MEANDER,
    FlowPattern.CIRCULAR,
    FlowPattern.SPIRAL,
    FlowPattern.GRAVITY_WELL,
    FlowPattern.WAVY_GRAVITY_WELL,
    FlowPattern.OUTWARD,
    FlowPattern.HORIZONTAL,
    FlowPattern.VERTICAL,
    FlowPattern.WAVY_HORIZONTAL,
    FlowPattern.WAVY_VERTICAL,
  ];
  // Short DBG-button labels per pattern (compact for the panel chip).
  private static readonly FF_PATTERN_LABELS: Record<FlowPattern, string> = {
    [FlowPattern.DEFAULT]:           'Map',
    [FlowPattern.MEANDER]:           'Meander',
    [FlowPattern.CIRCULAR]:          'Circular',
    [FlowPattern.SPIRAL]:            'Spiral',
    [FlowPattern.GRAVITY_WELL]:      'Well',
    [FlowPattern.WAVY_GRAVITY_WELL]: 'WavyWell',
    [FlowPattern.OUTWARD]:           'Outward',
    [FlowPattern.HORIZONTAL]:        'Horiz',
    [FlowPattern.VERTICAL]:          'Vert',
    [FlowPattern.WAVY_HORIZONTAL]:   'WavyH',
    [FlowPattern.WAVY_VERTICAL]:     'WavyV',
  };
  private ffPattern: FlowPattern = FlowPattern.DEFAULT;

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
  // Wall-clock timers for whole sim-phase calls — catches the work
  // that lives outside the per-system sub-timers (entity compaction,
  // flow-field nudge, weapon ticks, drop scan, ShardSystem, ...).
  // The gap between simMs and the sum of sub-timers is the
  // "untimed" budget per substep.
  private perfShardSys       = new Float64Array(GameEngine.PERF_WINDOW);
  private perfUpdatePhysics  = new Float64Array(GameEngine.PERF_WINDOW);
  private perfUpdateLogic    = new Float64Array(GameEngine.PERF_WINDOW);
  // Finer-grained sim sub-timers — added to pin down where the
  // updPhys/updLogic gaps live.  Each tracks one of the bigger
  // chunks NOT covered by the existing sub-timers (physics / coll /
  // shards / ai / homing / etc.).
  private perfPhysMisc       = new Float64Array(GameEngine.PERF_WINDOW);
  private perfLogicMisc      = new Float64Array(GameEngine.PERF_WINDOW);
  private perfDrops          = new Float64Array(GameEngine.PERF_WINDOW);
  private perfExplosionRings = new Float64Array(GameEngine.PERF_WINDOW);
  private perfWeapons        = new Float64Array(GameEngine.PERF_WINDOW);
  private lastUpdatePhysicsMs: number = 0;
  private lastUpdateGameLogicMs: number = 0;
  private lastPhysMiscMs: number = 0;
  private lastLogicMiscMs: number = 0;
  private lastDropsMs: number = 0;
  private lastExplosionRingsMs: number = 0;
  private lastWeaponsMs: number = 0;
  private perfSimIdx: number = 0;   // shared write index for every sim-side buffer
  private perfSimFilled: number = 0;
  // Render timings (one sample per rendered frame — may be written in menu
  // and paused states as well, so this is tracked on its own cursor)
  private perfRender         = new Float64Array(GameEngine.PERF_WINDOW);
  private perfNebula         = new Float64Array(GameEngine.PERF_WINDOW);
  private perfTileLighting  = new Float64Array(GameEngine.PERF_WINDOW);
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

  /**
   * Toggle the player↔asteroid local-gravity scan on/off.  When off,
   * `PhysicsSystem.applyLocalGravity` is skipped entirely and the
   * `lgrv` perf timer should drop to zero.
   */
  public toggleLocalGravity() {
    this.localGravityEnabled = !this.localGravityEnabled;
    this.physics.localGravityEnabled = this.localGravityEnabled;
  }

  /**
   * Toggle the attractor gravity pass on/off.  When off,
   * `PhysicsSystem.applyGravity` is skipped entirely and the
   * `grav` perf timer should drop to zero.  Used to measure the
   * cost of the full-master-list outer loop in isolation.
   */
  public toggleAttractorGravity() {
    this.attractorGravityEnabled = !this.attractorGravityEnabled;
    this.physics.attractorGravityEnabled = this.attractorGravityEnabled;
  }

  /**
   * Toggle the SAT collision broadphase on/off.  Off mode is
   * game-breaking (projectiles fly through, tiles are inert) —
   * it's strictly a perf measurement aid for the `coll` timer.
   */
  public toggleCollisions() {
    this.collisionsEnabled = !this.collisionsEnabled;
    this.physics.collisionsEnabled = this.collisionsEnabled;
  }

  /**
   * Toggle the dedicated mobile-shard ↔ static-tile collision pass.
   * Default OFF — the main broadphase skips this pair (shards drift
   * through tile geometry, only the repel field pushes them away).
   * Flip ON to add hard collisions: the asteroid-crash branch in
   * resolveCollision fires (pressure damage to the tile + elastic
   * bounce off the face).
   */
  public toggleShardTileCollisions() {
    this.shardTileCollisionsEnabled = !this.shardTileCollisionsEnabled;
    this.physics.shardTileCollisionsEnabled = this.shardTileCollisionsEnabled;
  }

  /**
   * Cycle the shard ↔ shard pair-resolution interval through
   * SHARD_PAIR_CONSTANTS.CYCLE_ORDER (AUTO → 1 → 2 → 4 → 8 → 16 →
   * 32 → 64 → 128 → 256 → 512 → 1028).  AUTO (= 0) lets
   * PhysicsSystem pick N from the previous step's peak collision-
   * cell density; numeric values pin the interval.  The effective
   * N (whether AUTO or manual) is mirrored into EngineStats so the
   * DBG panel can render `auto (3)` or `every 256` accordingly.
   */
  public cycleShardPairInterval() {
    const order = SHARD_PAIR_CONSTANTS.CYCLE_ORDER;
    const cur = this.physics.shardPairFrameInterval;
    const idx = order.indexOf(cur as (typeof order)[number]);
    const next = order[(idx + 1) % order.length];
    this.physics.shardPairFrameInterval = next;
  }

  /**
   * Cycle the shard ↔ static-tile pair-resolution interval through
   * SHARD_TILE_PAIR_CONSTANTS.CYCLE_ORDER.  Mirrors
   * `cycleShardPairInterval` exactly — same order, same AUTO
   * semantics — but gates `resolveShardTilePairs` instead of
   * `resolveShardPairs`.  Only meaningful when the parent
   * `shardTileCollisionsEnabled` toggle is on; cycling while OFF
   * still updates the stored value so the panel reflects it when
   * the user flips back on.
   */
  public cycleShardTilePairInterval() {
    const order = SHARD_TILE_PAIR_CONSTANTS.CYCLE_ORDER;
    const cur = this.physics.shardTilePairFrameInterval;
    const idx = order.indexOf(cur as (typeof order)[number]);
    const next = order[(idx + 1) % order.length];
    this.physics.shardTilePairFrameInterval = next;
  }

  /**
   * Toggle shard ↔ shard gravity pull (the attractedTo pass in
   * ShardSystem.runMergeBroadphase).  Today only nebula-shard has
   * non-'none' attractedTo, so this primarily flips nebula self-
   * coalesce gravity and any cross-variant pull on/off.
   */
  public toggleShardGravity() {
    this.shards.shardGravityEnabled = !this.shards.shardGravityEnabled;
  }

  /**
   * Master AUTO toggle for the central performance controller.  When
   * off, every AUTO task (manual interval 0) runs every step — i.e. all
   * automatic frame-skipping is disabled — while explicit manual pins
   * (set via the ShPair / Sh↔Tl int / ColorBlend int buttons) still
   * apply.  Lets a dev A/B the whole throttling system in one click.
   */
  public togglePerfAuto() {
    this.perfController.autoEnabled = !this.perfController.autoEnabled;
  }

  /**
   * Toggle shard ↔ shard bond formation + cohesion.  When off, any
   * existing bonds drop on the next ShardSystem.update() tick and
   * no new bonds form.  Nebula self-compose (which fires via the
   * zero-time bond path) and cross-variant absorb both stop too.
   */
  public toggleShardBonding() {
    this.shards.shardBondingEnabled = !this.shards.shardBondingEnabled;
  }

  /**
   * Toggle hard collisions between nebula-shard ↔ nebula-shard
   * pairs.  When on, the per-variant passThrough flag is ignored
   * for that specific pair and the SAT impulse path runs as
   * normal.  Default OFF — used to A/B-test whether forcing
   * nebula-pair separation breaks up the "one big pile" symptom.
   */
  public toggleNebulaShardCollisions() {
    this.physics.nebulaShardCollisionsEnabled = !this.physics.nebulaShardCollisionsEnabled;
  }

  /**
   * Toggle collision-sleep for mobile shards.  When on, resolveShardPairs
   * skips the SAT+impulse math for asleep↔asleep pairs (the bulk of a
   * settled field).  Off restores resolving every pair every pass — used
   * to A/B-test the win and confirm sleeping never freezes a shard
   * through a real collision.
   */
  public toggleShardSleep() {
    this.physics.shardSleepEnabled = !this.physics.shardSleepEnabled;
  }

  /**
   * Toggle viewport-gated shard-pair cadence.  When on, both-offscreen
   * shard pairs resolve only on the catch-up phase (every Nth pass);
   * on/near-screen pairs always resolve.  Off resolves every pair
   * regardless of visibility — used to A/B the win and confirm no
   * visible pop when off-screen piles scroll into view.
   */
  public toggleShardViewportCull() {
    this.physics.shardViewportCullEnabled = !this.physics.shardViewportCullEnabled;
  }

  /**
   * Toggle shard render LOD.  When on, mobile shards too small for their
   * polygon detail to read blit a cached solid disc instead of the full
   * polygon fill+stroke+glow.  Purely visual; off restores the full
   * per-vertex render for every shard.
   */
  public toggleShardLod() {
    this.renderer.shardLodEnabled = !this.renderer.shardLodEnabled;
  }

  /**
   * Toggle the local-density-driven merge/absorption rate.  When off, the
   * rate holds at a neutral 1.0× (base merge rate, no acceleration, base
   * per-frame budget) — used to A/B the consolidation feature.  When on,
   * shards in dense pockets merge/absorb faster and big absorbing rocks
   * slow down (see ShardSystem.tickBonds + LOCAL_MERGE_CONSTANTS).
   */
  public toggleMergeRate() {
    this.perfController.mergeRateEnabled = !this.perfController.mergeRateEnabled;
  }

  /**
   * Toggle the camera screen-shake effect on/off.  When off,
   * handleScreenShake early-returns and any in-flight shake decays
   * to zero on the next sim step (the existing decay logic clears
   * shakeOffset once shakeTimer hits 0).
   */
  public toggleScreenShake() {
    this.screenShakeEnabled = !this.screenShakeEnabled;
    if (!this.screenShakeEnabled) {
      // Cancel any in-flight shake immediately so the camera
      // returns to centered on the next frame.
      this.shakeTimer = 0;
      this.shakeIntensity = 0;
      this.camera.shakeOffset = { x: 0, y: 0 };
    }
  }

  /**
   * Toggle the DBG outline overlay for tile-and-shard variants
   * whose default render is outlineless — plastic-tile / plastic-
   * shard (soft gradient) and nebula-tile / nebula-shard (cloud
   * sprite).  When ON the renderer draws a thin cyan stroke of
   * each entity's collision polygon over the gradient / sprite,
   * making the SAT footprint visible against the soft fill.
   * Independent of the main DBG-mode toggle.
   */
  public toggleTileOutlines() {
    this.renderer.tileOutlinesEnabled = !this.renderer.tileOutlinesEnabled;
  }

  /** DBG (Visual): flip the off-screen-indicator chevron mode between
   *  "Offscreen" (only nearby-but-offscreen entities get a chevron) and "All"
   *  (also chevron on-screen entities — the original behaviour). */
  public toggleChevronMode() {
    this.renderer.chevronsOffscreenOnly = !this.renderer.chevronsOffscreenOnly;
  }

  /**
   * Toggle the plastic-shard neighbour-brightness automata (PAuto).
   * On: shards render in the active palette's constant base shade,
   * darkened by how many plastic-shards they're in contact with.
   * Off: per-instance random shades (and the contact count isn't
   * computed).  Flips the render flag AND the ShardSystem compute
   * flag together so the count work is skipped when off.
   */
  public togglePlasticAutomata() {
    const next = !this.renderer.plasticAutomataEnabled;
    this.renderer.plasticAutomataEnabled = next;
    this.shards.plasticAutomataEnabled = next;
  }

  /**
   * Flip the PAuto automata direction between darkening dense
   * interiors (default) and brightening them.  Live — RenderSystem
   * reads the shared flag in plasticAutomataHex each draw.
   */
  public togglePlasticAutomataDirection() {
    togglePlasticAutomataBrighten();
  }

  /**
   * Toggle the material-tile neighbour automata (DBG "Tile shade") for
   * glass / metal / rock static tiles.  Flips the render gate; on enable
   * it bakes the (frozen) neighbour counts once so the tint is correct
   * even if the toggle started off.
   */
  public toggleMaterialAutomata() {
    const next = !this.renderer.materialAutomataEnabled;
    this.renderer.materialAutomataEnabled = next;
    this.shards.materialAutomataEnabled = next;
    if (next && this.currentMap) this.shards.ensureMaterialNeighbors(this.currentMap.entities);
  }

  /**
   * Cycle the active plastic-TILE palette (litegreen → amber → black …)
   * and re-roll the colour of every active plastic-tile so the swap
   * is visible without breaking tiles.  Shards have their own
   * independent cycle (cyclePlasticShardPalette) so this method only
   * touches tiles.
   */
  public cyclePlasticPalette() {
    cyclePlasticPalette();
    if (!this.currentMap) return;
    const ents = this.currentMap.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.shardVariant !== 'plastic-tile') continue;
      e.color = randomPlasticShade();
    }
  }

  /**
   * Cycle the DBG plastic-SHARD palette through PLASTIC_PALETTES.
   * Independent of the tile palette (cyclePlasticPalette) — rotates
   * the shard colour family without touching tiles.  Live re-roll:
   * every plastic-shard's colour resamples from the new palette so
   * the change is visible without breaking shards.
   */
  public cyclePlasticShardPalette() {
    cyclePlasticShardPalette();
    if (!this.currentMap) return;
    const ents = this.currentMap.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.shardVariant !== 'plastic-shard') continue;
      e.color = randomPlasticShardShade();
    }
  }

  /**
   * Cycle the plastic-tile proximity-glow brightness multiplier
   * (MATERIAL_GLOW_BRIGHTNESS_CYCLE, 1× … 5×).  RenderSystem reads
   * the multiplier live each frame inside renderProximityBloom for
   * the plastic-tile branch only; metal has its own cycle, and other
   * glow-bearing tiles (rock / indestructible) are unaffected.
   */
  public cyclePlasticGlowBrightness() {
    cyclePlasticGlowBrightness();
  }

  /**
   * Cycle the metal-tile proximity-glow brightness multiplier
   * (MATERIAL_GLOW_BRIGHTNESS_CYCLE, 1× … 5×).  RenderSystem reads
   * the multiplier live each frame inside the metal-tile glow draw.
   */
  public cycleMetalGlowBrightness() {
    cycleMetalGlowBrightness();
  }

  /**
   * Cycle the DBG glass palette through GLASS_GLOW_COLORS.  Governs
   * the glass-tile proximity glow ONLY (RenderSystem reads the hex
   * live per draw).  Glass-shatter dust + main background nebula
   * clusters live on the Nebula cycle (see cycleNebulaPalette).
   * Default 'sky'.  No entity re-roll needed — the glow is read live.
   */
  public cycleGlassGlowColor() {
    cycleGlassGlowColor();
  }

  /**
   * Cycle the DBG metal-glow palette through the same 11-entry list
   * Glass uses (GLASS_GLOW_COLORS).  RenderSystem reads the active
   * hex via getActiveMetalGlowColor() in the metal-tile glow render
   * branch — range + peakAlpha stay with the variant.  Default
   * 'magenta' (closest to the legacy fuchsia baked into the
   * variant config).
   */
  public cycleMetalGlowColor() {
    cycleMetalGlowColor();
  }

  /**
   * Cycle the DBG nebula palette through GLASS_GLOW_COLORS.  Now
   * narrowly governs glass-tile shatter / merge dust ONLY
   * (randomGlassNebulaComposition).  Default 'sky'.  Main background
   * nebula clusters, nebula tiles, nebula shards, and BG puffs all
   * stay on the legacy default palette regardless of this cycle, and
   * rock-side dust is fixed at white.  Glass dust is ephemeral
   * (spawned per shatter event), so no entity re-roll is needed — the
   * next dust spawn picks up the new selection.
   */
  public cycleNebulaPalette() {
    cycleNebulaPalette();
  }


  /**
   * Toggle the plastic colour-equilibration pipeline (NebulaSystem
   * .equilibrateColors plastic block).  When off, plastic tiles
   * and shards stop drifting toward each other and stay at their
   * spawn / shatter colours.  Nebula blending is unaffected.
   */
  public togglePlasticBlend() {
    this.nebulas.plasticBlendEnabled = !this.nebulas.plasticBlendEnabled;
  }

  /**
   * Cycle the nebula-shard velocity-stretch stiffness through
   * VEL_STRETCH_K_CYCLE (off → soft → med → firm → stiff → off …).
   * The renderer reads getActiveNebulaStretchK() fresh each frame
   * so the change takes effect immediately.  The "free" rotation
   * behaviour (only squash aligns to velocity; sprite keeps its
   * own rotation) is fixed — see RenderSystem nebula-shard branch.
   */
  public cycleNebulaStretch() {
    cycleNebulaStretch();
  }

  /**
   * Cycle the DBG player-thrust multiplier (PLAYER_THRUST_CYCLE) applied
   * live to the per-map acceleration.  This is the knob that actually
   * raises everyday top speed, since terminal cruise is
   * acceleration/(1−friction).
   */
  public cyclePlayerThrust() {
    cyclePlayerThrust();
  }

  /**
   * Cycle the DBG player-speed multiplier (PLAYER_SPEED_CYCLE) applied
   * live to the per-map maxSpeed cap.  Only bites once the cap drops
   * below the friction-limited terminal velocity (or thrust pushes
   * cruise above it).
   */
  public cyclePlayerSpeed() {
    cyclePlayerSpeed();
  }

  /**
   * Toggle the per-asteroid / per-ammo-drop flow-field velocity nudge
   * in updatePhysics.  When OFF, the `applyFlow` step early-exits after
   * the rotation update — asteroids retain whatever velocity they had
   * but receive no streamline correction.  Combined with linearDamping
   * they decay toward zero velocity over a few seconds; from then on
   * they only move when collided with or pulled by gravity.  Surfaced
   * in the DBG panel for A/B-testing the contribution of the flow nudge
   * to the asteroid-field "feel".
   */
  public toggleAsteroidFlow() {
    this.asteroidFlowEnabled = !this.asteroidFlowEnabled;
  }

  /** Toggle the snitch catch interaction (collide ↔ shoot) — DBG aid for
   *  playtesting which catch mode feels better. */
  public toggleSnitchCatchMode() {
    this.snitchCatchMode = this.snitchCatchMode === 'collide' ? 'shoot' : 'collide';
  }

  /** Cycle the DBG snitch-speed multiplier (SNITCH_SPEED_CYCLE) — scales
   *  both AI speed states live so the chase feel can be tuned in-game. */
  public cycleSnitchSpeed() {
    cycleSnitchSpeed();
  }

  /** Cycle the DBG enemy-scaling multiplier (ENEMY_SCALE_CYCLE) — scales
   *  the per-wave HP+damage growth live to feel the comfortable-lead margin.
   *  Applies to enemies spawned after the change. */
  public cycleEnemyScale() {
    cycleEnemyScale();
  }

  /** DBG: cycle the gnat (Swarm) movement mode to feel each side-by-side. */
  public cycleSwarmMove() {
    cycleSwarmMove();
  }

  /** Toggle the enemy counterplay traits (armor chip-resist, …) for A/B. */
  public toggleTraits() {
    this.physics.traitsEnabled = !this.physics.traitsEnabled;
  }

  /** Toggle the FF Vectors overlay (asteroid-flow arrows). */
  public toggleFFOverlayVectors() {
    this.ffOverlayVectors = !this.ffOverlayVectors;
  }
  /** Toggle the FF Cells overlay (per-cell grid outlines). */
  public toggleFFOverlayCells() {
    this.ffOverlayCells = !this.ffOverlayCells;
  }
  /** Toggle the FF Obstacles overlay (blocked-cell tint). */
  public toggleFFOverlayObstacles() {
    this.ffOverlayObstacles = !this.ffOverlayObstacles;
  }
  /** Toggle the FF Rebuilds overlay (flash recently-rebaked cells). */
  public toggleFFOverlayRebuilds() {
    this.ffOverlayRebuilds = !this.ffOverlayRebuilds;
  }
  /**
   * Cycle the vector-overlay sample stride through 1 → 2 → 4 → 8 → 16.
   * Coarser strides reduce arrow density on whichever map is loaded;
   * stride 1 draws every cell.  Cells / obstacles / rebuilds overlays
   * always render every cell — only the vector overlay uses this.
   */
  public cycleFFOverlaySampleN() {
    const order = GameEngine.FF_SAMPLE_N_CYCLE;
    const idx = order.indexOf(this.ffOverlaySampleN);
    this.ffOverlaySampleN = order[(idx + 1) % order.length];
  }

  /**
   * Cycle the flow-field cell size through `FF_DENSITY_CYCLE` (256 →
   * 192 → 128 → 96 → 64 → 48 → 32 → 256).  Each step reallocates the
   * grid's typed-array buffers at the new resolution, rebuilds the
   * obstacle bitmap from the live entity list, and re-bakes the
   * asteroid field with the active map's sampleFlow.  The enemy
   * pursuit field is marked dirty so the next `flushEnemyField()`
   * rebuilds it for the new resolution.  All of this happens
   * synchronously inside the cycle — at the highest density (32-unit
   * cells on a 6 k map) the bake is still sub-millisecond.
   *
   * No-op when no map is loaded.
   */
  public cycleFFDensity() {
    if (!this.currentMap) return;
    const order = GameEngine.FF_DENSITY_CYCLE;
    const idx = order.indexOf(this.ffCellSize);
    const next = order[(idx + 1) % order.length];
    this.ffCellSize = next;
    this.flowField.setCellSize(next);
    this.flowField.initObstacles(this.currentMap.entities);
    // Re-bake under the active pattern selection (not necessarily the
    // map's own sampler) so the chosen pattern survives density changes.
    this.flowField.buildAsteroidField(this.flowSamplerFor(this.currentMap));
    // The new grid starts with defaults; push the current cycled
    // values back so they survive density changes.
    this.flowField.setKernelR(this.ffKernelR);
    this.flowField.setTangentMix(this.ffTangentMix);
  }

  /**
   * Cycle the asteroid-field wall-repulsion kernel radius through
   * `FF_KERNEL_R_CYCLE` (0 → 1 → 2 → 3 → 4 → 5).  R = 0 is the legacy
   * 4-cardinal-only scan kept for A/B testing; R ≥ 1 enables the
   * (2R+1)² kernel with 1/d² falloff so cells several positions away
   * from a wall already start curving the flow.  Each step re-bakes
   * the asteroid field in-place (sub-ms even at the finest density).
   */
  public cycleFFKernelR() {
    const order = GameEngine.FF_KERNEL_R_CYCLE;
    const idx = order.indexOf(this.ffKernelR);
    const next = order[(idx + 1) % order.length];
    this.ffKernelR = next;
    this.flowField.setKernelR(next);
  }

  /**
   * Cycle the wall-repulsion tangent-mix factor through
   * `FF_TANGENT_MIX_CYCLE` (0.00 → 0.25 → 0.50 → 0.75 → 1.00).  At 0
   * the kernel pushes purely perpendicular away from walls (creates
   * opposing vectors on either side of a long wall — the saddle
   * dead-zone failure mode).  At 1 each blocked-neighbour
   * contribution is rotated 90° so the flow slides ALONG the wall
   * (both sides flow in the same direction along the wall, no
   * saddle).  Re-bakes the asteroid field in-place.
   */
  public cycleFFTangentMix() {
    const order = GameEngine.FF_TANGENT_MIX_CYCLE;
    const idx = order.indexOf(this.ffTangentMix);
    const next = order[(idx + 1) % order.length];
    this.ffTangentMix = next;
    this.flowField.setTangentMix(next);
  }

  /**
   * Cycle the breathing scroll rate through `FF_BREATHE_RATE_CYCLE`
   * (off → slow → med → fast).  When non-zero, the asteroid field's
   * base direction undulates over time (re-baked on a throttled
   * cadence in updatePhysics) so convergence zones drift and shard
   * piles dissolve.  Cycling to a non-zero rate immediately re-bakes
   * at the current phase so the undulation appears; cycling back to
   * off re-bakes once with amplitude 0 to restore the static field.
   */
  public cycleFFBreathe() {
    const order = GameEngine.FF_BREATHE_RATE_CYCLE;
    const idx = order.indexOf(this.ffBreatheRate);
    const next = order[(idx + 1) % order.length];
    this.ffBreatheRate = next;
    const amp = next > 0 ? FlowFieldGrid.BREATHE_AMP : 0;
    this.flowField.setBreathe(amp, this.ffBreathePhase);
  }

  /**
   * Cycle the per-shard lane-jitter strength through
   * `FF_LANE_JITTER_CYCLE` (off → low → med → high).  Adds a stable
   * per-shard perpendicular offset to the flow target so shards ride
   * slightly different parallel lanes instead of collapsing onto one
   * streamline.  Live — no re-bake (applied at sample time in the
   * per-shard flow nudge).
   */
  public cycleFFLaneJitter() {
    const order = GameEngine.FF_LANE_JITTER_CYCLE;
    const idx = order.indexOf(this.ffLaneJitter);
    this.ffLaneJitter = order[(idx + 1) % order.length];
  }

  /**
   * Resolve the base-flow sampler for the given map under the current
   * DBG pattern selection.  DEFAULT uses the map's own sampleFlow();
   * any other pattern swaps in the corresponding analytical field.
   * Used at map load and at every re-bake (density / pattern cycle)
   * so the selection sticks.
   */
  private flowSamplerFor(map: BaseMapLayer): FlowSampler {
    if (this.ffPattern === FlowPattern.DEFAULT) {
      return (x, y) => map.sampleFlow(x, y);
    }
    const p = this.ffPattern;
    return (x, y) => samplePattern(p, x, y);
  }

  /**
   * Cycle the base-flow pattern through `FF_PATTERN_CYCLE` (map default
   * → meander → circular → spiral → gravity well → wavy well → outward
   * → horizontal → vertical → wavy-H → wavy-V).  Re-bakes the asteroid
   * field with the new sampler; current kernel / tangent / breathing
   * settings still apply on top.  The map's spawn-time seeding is
   * unaffected — existing shards re-settle onto the new pattern over a
   * second or two via the per-frame flow nudge.
   */
  public cycleFFPattern() {
    if (!this.currentMap) return;
    const order = GameEngine.FF_PATTERN_CYCLE;
    const idx = order.indexOf(this.ffPattern);
    this.ffPattern = order[(idx + 1) % order.length];
    this.flowField.buildAsteroidField(this.flowSamplerFor(this.currentMap));
  }

  /**
   * Cycle the hot-spot-collapse grace delay through SHATTER_GRACE_CYCLE
   * (0.6 → 3.6s).  Freshly-shattered rock/glass shards read
   * getActiveShatterGraceDelay() at spawn, so the new value applies to
   * tiles destroyed after the cycle.
   */
  public cycleShatterGrace() {
    cycleShatterGrace();
  }

  /**
   * Cycle the nebula tile→tile color-equilibration alpha through
   * NEBULA_CONSTANTS.BLEND_TILE_ALPHA_CYCLE (Off → Slow → Med →
   * Fast).  Anchors the cluster's structural hue — tiles drift
   * toward their 6-hex-neighbour weighted average each frame at
   * this alpha.
   */
  public cycleTileBlendAlpha() {
    const order = NEBULA_CONSTANTS.BLEND_TILE_ALPHA_CYCLE;
    const cur = this.nebulas.tileBlendAlpha;
    const idx = order.indexOf(cur as (typeof order)[number]);
    const next = order[(idx + 1) % order.length];
    this.nebulas.tileBlendAlpha = next;
  }

  /**
   * Cycle the nebula shard→nearest-tile color-equilibration alpha
   * through NEBULA_CONSTANTS.BLEND_SHARD_ALPHA_CYCLE.  Catch-up
   * blend for shards (anchors don't move).
   */
  public cycleShardBlendAlpha() {
    const order = NEBULA_CONSTANTS.BLEND_SHARD_ALPHA_CYCLE;
    const cur = this.nebulas.shardBlendAlpha;
    const idx = order.indexOf(cur as (typeof order)[number]);
    const next = order[(idx + 1) % order.length];
    this.nebulas.shardBlendAlpha = next;
  }

  /**
   * Cycle the cadence interval for the nebula color-equilibration
   * pass through NEBULA_CONSTANTS.BLEND_FRAME_INTERVAL_CYCLE.
   * Higher values trade smoothness for perf — the per-call work
   * stays the same but fires less often.
   */
  public cycleColorBlendInterval() {
    const order = NEBULA_CONSTANTS.BLEND_FRAME_INTERVAL_CYCLE;
    const cur = this.nebulas.colorBlendFrameInterval;
    const idx = order.indexOf(cur as (typeof order)[number]);
    const next = order[(idx + 1) % order.length];
    this.nebulas.colorBlendFrameInterval = next;
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
    // Wire physics into the renderer so the material-tile branch can
    // suppress edge strokes on edges that are cleanly butted against
    // a neighbour tile (queried via hasStaticTileNear).
    this.renderer.setPhysics(this.physics);
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
    // Wire the EntityIndex into ShardSystem so the large-shard-collapse
    // pass can prefer offscreen candidates (graceful cleanup — never
    // pop a shard out of existence in the player's view).
    this.shards.setEntityIndex(this.entityIndex);
    // Shard→tile condensation emits a small, non-damaging plasma-style
    // shockwave that shoves nearby loose shards clear, and patches the
    // flow field so the new tile registers as an obstacle (the merge
    // rules build large tile clusters at runtime — without this enemies
    // path through walls that post-date map load).
    this.shards.setTileFormedHandler((x, y) => {
        this.spawnShockwave({ x, y }, {
            radius: MERGE_BLOWBACK.RADIUS,
            damage: MERGE_BLOWBACK.DAMAGE,
            knockback: MERGE_BLOWBACK.KNOCKBACK,
            color: MERGE_BLOWBACK.COLOR,
            lifetime: MERGE_BLOWBACK.LIFETIME,
            // Environmental effect — shove loose shards, never the player.
            excludeIds: ['player'],
        });
        this.flowField.onTileCreated(x, y);
    });
    this.flowField = new FlowFieldGrid();
    // Hand the renderer a reference to the flow field so the DBG
    // asteroid/shard FF overlays (vectors / cells / obstacles /
    // rebuilds) can read per-cell state directly without going
    // through allocation-heavy `sampleAsteroidFlow()` calls.
    this.renderer.setFlowField(this.flowField);

    // Central performance controller — injected into every system that
    // owns a skippable pass.  It samples load in beginStep() (called
    // once per sim substep in the loop) and precomputes each task's
    // run decision; the systems just query shouldRun()/effectiveInterval().
    this.perfController = new PerfController();
    this.physics.setPerfController(this.perfController);
    this.shards.setPerfController(this.perfController);
    this.nebulas.setPerfController(this.perfController);

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
    this.syncUnlocksToPlayer();
    this.applyUpgrades(); // initialise upgrade-derived stat fields (all at L0)

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
      case MapType.PLASTIC_FIELD:        return new PlasticFieldMap();
      case MapType.METAL_FIELD:          return new MetalFieldMap();
      case MapType.INDESTRUCTIBLE_FIELD: return new IndestructibleFieldMap();
      case MapType.NEBULA_FIELD:         return new NebulaFieldMap();
      case MapType.ROCK_FIELD:           return new RockFieldMap();
      case MapType.TILE_HEAVY:           return new TileHeavyMap();
      case MapType.UNIVERSE:
      default:                           return new UniverseMap();
    }
  }

  /** Select the active map.  From the main menu this just swaps the
   *  backdrop the next startGame() will use.  Mid-game (paused or
   *  playing) it performs a full switch-and-play: reset the run, load
   *  the chosen map, and drop straight back into PLAYING so the map
   *  grid in the pause screen acts as a live map picker. */
  public setMapType(type: MapType) {
    this.selectedMapType = type;
    if (this.gameState === GameState.MENU) {
      this.loadMap(this.buildMap(type));
      // Recentre the player on the newly-loaded map's spawn so the
      // menu backdrop renders the new map at frame 0 instead of the
      // previous map's viewport.
      this.player.position = { ...this.currentMap!.playerSpawn };
      this.prepareFrameEntities();
    } else {
      this.resetAndLoadSelectedMap();
      this.gameState = GameState.PLAYING;
      this.initWaveSystem();
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
    this.seedAmbientBubbles(); // always-present fauna, ready from frame one
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
      waveElapsedSec: this.waveState === 'active' ? Math.floor(this.waves.elapsedSecPublic) : undefined,
      enemiesRemaining: this.waveState === 'active' && this.currentMap ? this.waves.enemiesRemaining(this.currentMap.entities) : undefined,
      score: Math.round(this.displayScore),
      comboMultiplier: this.comboMultiplier(),
      comboCount: this.comboCount,
      comboFraction: this.comboTimer > 0 ? this.comboTimer / SCORE_CONSTANTS.COMBO_WINDOW_SEC : 0,
      credits: this.credits,
      upgrades: this.upgradeSnapshot(),
      cardChoice: this.cardChoicePending ? this.pendingCards : undefined,
      cardInterval: this.cardWaveInterval,
      playerStats: this.gameState === GameState.PAUSED ? {
        health: Math.max(0, Math.round(this.player.health)),
        maxHealth: this.player.maxHealth,
        shield: Math.max(0, Math.round(this.player.shield ?? 0)),
        maxShield: this.player.maxShield ?? 0,
        damageMult: this.player.damageMult ?? 1,
        cooldownMult: this.player.cooldownMult ?? 1,
        speedMult: this.upgradeSpeedMult(),
        maxAmmo: this.player.maxAmmo ?? AMMO_CONSTANTS.MAX_POOL,
      } : undefined,
      unlocks: this.gameState === GameState.PAUSED ? {
        weapons: WEAPON_LIST.filter(w => this.unlockedWeapons.has(w)).map(w => WEAPONS[w].name),
        shield: this.shieldUnlocked,
        overcharge: this.overchargeUnlocked,
      } : undefined,
      shop: this.gameState === GameState.PAUSED ? this.shopSnapshot() : undefined,
      debugMode: this.debugMode,
      trailShape: this.trailShape,
      trailEmitMode: this.trailEmitMode,
      localGravityEnabled: this.localGravityEnabled,
      attractorGravityEnabled: this.attractorGravityEnabled,
      collisionsEnabled: this.collisionsEnabled,
      shardTileCollisionsEnabled: this.shardTileCollisionsEnabled,
      shardPairInterval: this.physics.shardPairFrameInterval,
      shardPairEffectiveInterval: this.physics.lastEffectiveShardPairInterval,
      shardTilePairInterval: this.physics.shardTilePairFrameInterval,
      shardTilePairEffectiveInterval: this.physics.lastEffectiveShardTilePairInterval,
      shardGravityEnabled: this.shards.shardGravityEnabled,
      shardBondingEnabled: this.shards.shardBondingEnabled,
      nebulaShardCollisionsEnabled: this.physics.nebulaShardCollisionsEnabled,
      shardSleepEnabled: this.physics.shardSleepEnabled,
      shardViewportCullEnabled: this.physics.shardViewportCullEnabled,
      shardLodEnabled: this.renderer.shardLodEnabled,
      mergeRateEnabled: this.perfController.mergeRateEnabled,
      screenShakeEnabled: this.screenShakeEnabled,
      tileOutlinesEnabled: this.renderer.tileOutlinesEnabled,
      chevronsOffscreenOnly: this.renderer.chevronsOffscreenOnly,
      plasticAutomataEnabled: this.renderer.plasticAutomataEnabled,
      plasticAutomataBrighten: isPlasticAutomataBrighten(),
      materialAutomataEnabled: this.renderer.materialAutomataEnabled,
      plasticPaletteName: getActivePlasticPaletteName(),
      plasticShardPaletteName: getActivePlasticShardPaletteName(),
      plasticGlowBrightnessName: getActivePlasticGlowBrightnessName(),
      metalGlowBrightnessName:   getActiveMetalGlowBrightnessName(),
      glassGlowColorName: getActiveGlassGlowColorName(),
      metalGlowColorName: getActiveMetalGlowColorName(),
      nebulaPaletteName: getActiveNebulaPaletteName(),
      plasticBlendEnabled: this.nebulas.plasticBlendEnabled,
      nebulaStretchName:   getActiveNebulaStretchName(),
      shatterGraceName:   getActiveShatterGraceName(),
      playerThrustName: getActivePlayerThrustName(),
      playerSpeedName: getActivePlayerSpeedName(),
      asteroidFlowEnabled: this.asteroidFlowEnabled,
      snitchCatchMode: this.snitchCatchMode,
      snitchSpeedName: getActiveSnitchSpeedName(),
      enemyScaleName: getActiveEnemyScaleName(),
      swarmMoveName: getActiveSwarmMoveName(),
      enemyScaleInfo: `hp ×${enemyHpMult(this.waveIndex).toFixed(2)} · dmg ×${enemyDamageMult(this.waveIndex).toFixed(2)}`,
      traitsEnabled: this.physics.traitsEnabled,
      forcedEnemy: this.forcedTestEnemy,
      statusEffects: (this.player.statusEffects && this.player.statusEffects.length > 0)
        ? this.player.statusEffects.map(e => ({ kind: e.kind, stacks: e.stacks, fraction: Math.max(0, e.remaining / e.maxDuration) }))
        : undefined,
      ffOverlayVectors:   this.ffOverlayVectors,
      ffOverlayCells:     this.ffOverlayCells,
      ffOverlayObstacles: this.ffOverlayObstacles,
      ffOverlayRebuilds:  this.ffOverlayRebuilds,
      ffOverlaySampleN:   this.ffOverlaySampleN,
      ffCellSize:         this.ffCellSize,
      ffKernelR:          this.ffKernelR,
      ffTangentMix:       this.ffTangentMix,
      ffBreatheRate:      this.ffBreatheRate,
      ffLaneJitter:       this.ffLaneJitter,
      ffPatternName:      GameEngine.FF_PATTERN_LABELS[this.ffPattern],
      tileBlendAlpha: this.nebulas.tileBlendAlpha,
      shardBlendAlpha: this.nebulas.shardBlendAlpha,
      colorBlendFrameInterval: this.nebulas.colorBlendFrameInterval,
      colorBlendEffectiveInterval: this.nebulas.lastEffectiveColorBlendInterval,
      perfAutoEnabled: this.perfController.autoEnabled,
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

  /** Reset all run state and load a fresh copy of `selectedMapType`.
   *  Shared by restartGame() (→ MENU) and the mid-game map switch in
   *  setMapType() (→ PLAYING).  Leaves gameState untouched; the caller
   *  decides the target state and pushes the frame. */
  private resetAndLoadSelectedMap() {
      this.shards.reset();
      this.perfController.reset();
      this.activeDrops = [];
      this.trailEmitAccumulator = 0;
      this.wasThrustingLastFrame = false;
      this.chainBreakPending = false;
      this.waveAnnouncements = [];
      // Snitch entity dies with the old map's entity list — just drop the
      // reference so the next wave spawns a fresh one.
      this.snitch = null;
      this.snitchTime = 0;
      this.snitchCatchCount = 0;
      this.dragons = []; // die with the old map's entity list
      this.dragonsKilled = 0; // reset the doubling payout per run
      this.rivals = []; // rival ships die with the old map
      this.nextRivalScore = RIVAL_CONSTANTS.SCORE_INTERVAL;
      this.loadMap(this.buildMap(this.selectedMapType));

      // Per-run progression reset — must precede the health/shield refill
      // below so maxHealth/maxShield are back at base before they're topped.
      this.credits = 0;
      this.resetUnlocks(); // back to lean (Blaster only, no shield/overcharge)
      this.resetUpgrades();
      this.cardChoicePending = false;
      this.pendingCards = [];
      this.cardOpenDelaySec = 0;
      this.pendingCardWaveNum = 0;

      // Reset Player
      this.player.position = { x: 0, y: 0 };
      this.player.velocity = { x: 0, y: 0 };
      this.player.health = this.player.maxHealth;
      this.player.shield = this.player.maxShield;
      this.player.shieldRechargeTimer = 0;
      this.player.shieldHitFlash = 0;
      this.player.statusEffects = [];
      this.player.ammo = 0;
      this.player.gold = 0;
      this.score = 0;
      this.displayScore = 0;
      this.comboCount = 0;
      this.comboTimer = 0;
      this._livePointsPopup = null;
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
  }

  public restartGame() {
      this.resetAndLoadSelectedMap();
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

    // HUD score ticker — roll the displayed total up toward the true
    // score by integer steps (≥1, ≤ a fraction of the gap) so awards
    // animate up rather than snapping.  Pure display; `score` is truth.
    if (this.displayScore !== this.score) {
      if (this.displayScore < this.score) {
        const diff = this.score - this.displayScore;
        this.displayScore = Math.min(
          this.score,
          this.displayScore + Math.max(1, Math.ceil(diff * SCORE_CONSTANTS.DISPLAY_CATCHUP_FRAC)),
        );
      } else {
        this.displayScore = this.score; // score only ever resets downward
      }
    }

    // Report stats
    const wsMap: Record<string, 'active' | 'cleared'> = {
      inactive: 'active', active: 'active', cleared: 'cleared'
    };
    // Build the perf snapshot once and reuse it for the HUD + the perf
    // recorder (feed only real PLAYING frames so idle/paused vsync doesn't
    // pollute the FPS distribution).  `frameTime` is the true rAF delta.
    const perf = this.buildPerfSnapshot();
    if (this.perfRecorder.recording && this.gameState === GameState.PLAYING) {
      this.perfRecorder.sample(
        frameTime * 1000,
        perf.renderMs,
        perf.updatePhysicsMs + perf.updateLogicMs,
        perf.collisionsMs,
        this.perfController.loadTier,
        this.perfController.loadLevel,
        perf.totalEntities,
        perf.enemyCount,
        perf.particleCount,
      );
    }
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
      waveElapsedSec: this.waveState === 'active' ? Math.floor(this.waves.elapsedSecPublic) : undefined,
      enemiesRemaining: this.waveState === 'active' && this.currentMap ? this.waves.enemiesRemaining(this.currentMap.entities) : undefined,
      score: Math.round(this.displayScore),
      comboMultiplier: this.comboMultiplier(),
      comboCount: this.comboCount,
      comboFraction: this.comboTimer > 0 ? this.comboTimer / SCORE_CONSTANTS.COMBO_WINDOW_SEC : 0,
      credits: this.credits,
      upgrades: this.upgradeSnapshot(),
      cardChoice: this.cardChoicePending ? this.pendingCards : undefined,
      cardInterval: this.cardWaveInterval,
      playerStats: this.gameState === GameState.PAUSED ? {
        health: Math.max(0, Math.round(this.player.health)),
        maxHealth: this.player.maxHealth,
        shield: Math.max(0, Math.round(this.player.shield ?? 0)),
        maxShield: this.player.maxShield ?? 0,
        damageMult: this.player.damageMult ?? 1,
        cooldownMult: this.player.cooldownMult ?? 1,
        speedMult: this.upgradeSpeedMult(),
        maxAmmo: this.player.maxAmmo ?? AMMO_CONSTANTS.MAX_POOL,
      } : undefined,
      unlocks: this.gameState === GameState.PAUSED ? {
        weapons: WEAPON_LIST.filter(w => this.unlockedWeapons.has(w)).map(w => WEAPONS[w].name),
        shield: this.shieldUnlocked,
        overcharge: this.overchargeUnlocked,
      } : undefined,
      shop: this.gameState === GameState.PAUSED ? this.shopSnapshot() : undefined,
      debugMode: this.debugMode,
      trailShape: this.trailShape,
      trailEmitMode: this.trailEmitMode,
      localGravityEnabled: this.localGravityEnabled,
      attractorGravityEnabled: this.attractorGravityEnabled,
      collisionsEnabled: this.collisionsEnabled,
      shardTileCollisionsEnabled: this.shardTileCollisionsEnabled,
      shardPairInterval: this.physics.shardPairFrameInterval,
      shardPairEffectiveInterval: this.physics.lastEffectiveShardPairInterval,
      shardTilePairInterval: this.physics.shardTilePairFrameInterval,
      shardTilePairEffectiveInterval: this.physics.lastEffectiveShardTilePairInterval,
      shardGravityEnabled: this.shards.shardGravityEnabled,
      shardBondingEnabled: this.shards.shardBondingEnabled,
      nebulaShardCollisionsEnabled: this.physics.nebulaShardCollisionsEnabled,
      shardSleepEnabled: this.physics.shardSleepEnabled,
      shardViewportCullEnabled: this.physics.shardViewportCullEnabled,
      shardLodEnabled: this.renderer.shardLodEnabled,
      mergeRateEnabled: this.perfController.mergeRateEnabled,
      screenShakeEnabled: this.screenShakeEnabled,
      tileOutlinesEnabled: this.renderer.tileOutlinesEnabled,
      chevronsOffscreenOnly: this.renderer.chevronsOffscreenOnly,
      plasticAutomataEnabled: this.renderer.plasticAutomataEnabled,
      plasticAutomataBrighten: isPlasticAutomataBrighten(),
      materialAutomataEnabled: this.renderer.materialAutomataEnabled,
      plasticPaletteName: getActivePlasticPaletteName(),
      plasticShardPaletteName: getActivePlasticShardPaletteName(),
      plasticGlowBrightnessName: getActivePlasticGlowBrightnessName(),
      metalGlowBrightnessName:   getActiveMetalGlowBrightnessName(),
      glassGlowColorName: getActiveGlassGlowColorName(),
      metalGlowColorName: getActiveMetalGlowColorName(),
      nebulaPaletteName: getActiveNebulaPaletteName(),
      plasticBlendEnabled: this.nebulas.plasticBlendEnabled,
      nebulaStretchName:   getActiveNebulaStretchName(),
      shatterGraceName:   getActiveShatterGraceName(),
      playerThrustName: getActivePlayerThrustName(),
      playerSpeedName: getActivePlayerSpeedName(),
      asteroidFlowEnabled: this.asteroidFlowEnabled,
      snitchCatchMode: this.snitchCatchMode,
      snitchSpeedName: getActiveSnitchSpeedName(),
      enemyScaleName: getActiveEnemyScaleName(),
      swarmMoveName: getActiveSwarmMoveName(),
      enemyScaleInfo: `hp ×${enemyHpMult(this.waveIndex).toFixed(2)} · dmg ×${enemyDamageMult(this.waveIndex).toFixed(2)}`,
      traitsEnabled: this.physics.traitsEnabled,
      forcedEnemy: this.forcedTestEnemy,
      statusEffects: (this.player.statusEffects && this.player.statusEffects.length > 0)
        ? this.player.statusEffects.map(e => ({ kind: e.kind, stacks: e.stacks, fraction: Math.max(0, e.remaining / e.maxDuration) }))
        : undefined,
      ffOverlayVectors:   this.ffOverlayVectors,
      ffOverlayCells:     this.ffOverlayCells,
      ffOverlayObstacles: this.ffOverlayObstacles,
      ffOverlayRebuilds:  this.ffOverlayRebuilds,
      ffOverlaySampleN:   this.ffOverlaySampleN,
      ffCellSize:         this.ffCellSize,
      ffKernelR:          this.ffKernelR,
      ffTangentMix:       this.ffTangentMix,
      ffBreatheRate:      this.ffBreatheRate,
      ffLaneJitter:       this.ffLaneJitter,
      ffPatternName:      GameEngine.FF_PATTERN_LABELS[this.ffPattern],
      tileBlendAlpha: this.nebulas.tileBlendAlpha,
      shardBlendAlpha: this.nebulas.shardBlendAlpha,
      colorBlendFrameInterval: this.nebulas.colorBlendFrameInterval,
      colorBlendEffectiveInterval: this.nebulas.lastEffectiveColorBlendInterval,
      perfAutoEnabled: this.perfController.autoEnabled,
      weaponCount: this.currentWeaponIndex + 1,
      shield: this.player.shield,
      maxShield: this.player.maxShield,
      perf,
      perfRecording: this.perfRecorder.recording,
      perfRecSamples: this.perfRecorder.sampleCount,
      perfRecScene: this.perfRecorder.sceneTag,
    });

    if (this.gameState !== GameState.PLAYING) {
        // If paused or in menu, still draw (static frame) but skip updates
        try { this.draw(); } catch (e) { console.error('[RenderSystem] draw error:', e); }
        this.recordRenderPerf();
        requestAnimationFrame(this.loop);
        return;
    }

    // Between-wave card choice freezes the sim (the field stays drawn
    // behind the React card overlay) until the player picks.
    if (this.cardChoicePending) {
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
        // Sample load + precompute every skippable task's run decision
        // for this substep.  Manual DBG overrides (which still live on
        // the systems that own their cycle buttons) are synced in first
        // so `0 = AUTO` delegates to the controller and a manual pin
        // wins.  Signals: current total entities, previous step's peak
        // collision-cell density, and the previous substep's sim time.
        this.perfController.setManual('shardPair', this.physics.shardPairFrameInterval);
        this.perfController.setManual('shardTilePair', this.physics.shardTilePairFrameInterval);
        this.perfController.setManual('colorBlend', this.nebulas.colorBlendFrameInterval);
        this.perfController.beginStep(
            this.perfCounts.totalEntities,
            this.physics.lastDynamicCount,
            this.physics.lastMaxCellDensity,
            this.lastUpdatePhysicsMs + this.lastUpdateGameLogicMs,
        );
        // Wall-clock the two top-level sim phases so the perf overlay
        // can show the gap between summed sub-timers and total sim
        // time.  Untimed work (entity compaction, flow-field nudge,
        // weapon ticks, drop scan, etc.) shows up as the difference.
        const tPhys0 = performance.now();
        try { this.updatePhysics(FIXED_DT); }   catch (e) { console.error('[PhysicsSystem] update error:', e); }
        this.lastUpdatePhysicsMs = performance.now() - tPhys0;
        const tLogic0 = performance.now();
        try { this.updateGameLogic(FIXED_DT); } catch (e) { console.error('[GameLogic] update error:', e); }
        this.lastUpdateGameLogicMs = performance.now() - tLogic0;
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

    // Enforce the particle hard-cap ONCE per frame (moved out of the per-spawn
    // path — see ParticleSystem.spawn).  Runs after the whole sim drain so
    // every death-burst / FX particle spawned this frame is counted, and before
    // the render pass so the on-screen cap (and which oldest particles are
    // dropped) is identical to the old per-spawn behaviour — just one O(N) pass
    // instead of one per spawn call.
    if (this.currentMap) this.particles.enforceCap(this.currentMap.entities);

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

      // Refresh the camera-aligned viewport rect so the graceful-cleanup
      // path inside ShardSystem can prefer offscreen candidates.  Reuses
      // the same halfW/halfH math as RenderSystem so visibility
      // partitioning and on-screen rendering agree at the seam.  The
      // padding (CAMERA_CONSTANTS.CULL_MARGIN) keeps shards that are
      // about-to-enter-frame on the on-screen side of the partition.
      const zoom = this.camera.zoom || 1;
      const halfW = (window.innerWidth / 2) / zoom;
      const halfH = (window.innerHeight / 2) / zoom;
      const margin = CAMERA_CONSTANTS.CULL_MARGIN;
      this._viewportRect.left   = this.camera.position.x - halfW - margin;
      this._viewportRect.right  = this.camera.position.x + halfW + margin;
      this._viewportRect.top    = this.camera.position.y - halfH - margin;
      this._viewportRect.bottom = this.camera.position.y + halfH + margin;
      this.entityIndex.setViewportRect(this._viewportRect);
      // Feed the same rect to PhysicsSystem so the shard-pair pass can
      // run both-offscreen pairs at a reduced cadence (Step 3).
      this.physics.setViewportRect(
          this._viewportRect.left, this._viewportRect.right,
          this._viewportRect.top, this._viewportRect.bottom,
      );

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
      if (!this.screenShakeEnabled) return;
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
      // The rebuild is already dirty-gated (only when the player crosses a
      // cell), but the PerfController's `flowField` task throttles the
      // flush itself so a player oscillating on a cell boundary under load
      // can't thrash the BFS every step.  When skipped the field holds its
      // last state (enemies pursue the last-known cell — no snap) and the
      // dirty flag stays set so the next allowed step rebuilds it.
      this.flowField.scheduleEnemyRebuild(this.player.position.x, this.player.position.y);
      if (this.perfController.shouldRun('flowField')) {
          this.flowField.flushEnemyField();
      } else {
          this.flowField.lastFlushMs = 0;
      }

      // Breathing field: advance the scroll phase and re-bake the
      // asteroid field on a throttled cadence so convergence zones
      // migrate over time (shard piles dissolve).  No-op when the
      // breathing rate is off.
      if (this.ffBreatheRate > 0) {
          this.ffBreatheRebakeTimer += dt;
          if (this.ffBreatheRebakeTimer >= GameEngine.FF_BREATHE_REBAKE_INTERVAL) {
              this.ffBreathePhase += this.ffBreatheRate * this.ffBreatheRebakeTimer;
              this.ffBreatheRebakeTimer = 0;
              this.flowField.setBreathe(FlowFieldGrid.BREATHE_AMP, this.ffBreathePhase);
          }
      }

      // Enemy AI state machine — skippable.  When throttled we dt-compensate
      // (multiply dt by the effective interval) so acceleration impulses and
      // reaction/idle/chase timers integrate to the same per-second behaviour
      // regardless of skip cadence; physics still integrates velocity every
      // step, so enemies coast smoothly between AI updates (no snap).
      if (this.perfController.shouldRun('ai')) {
          const aiDt = dt * this.perfController.effectiveInterval('ai');
          this.ai.update(aiDt, this.entityIndex.enemies, this.player, this.flowField, this.entityIndex.asteroids);
      } else {
          this.ai.lastUpdateMs = 0; // amortize cost across skip steps in the overlay
      }
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
      //   the flow — ramps up whenever something (collisions, bond cohesion
      //   with a neighbour in a different flow cell) has dragged it off its
      //   streamline.  Without this term, an asteroid at the target parallel
      //   speed dropped to urgency = 1 regardless of how much sideways drift
      //   it had accumulated.  Keeping the perp-deficit hot makes the
      //   correction actively damp sideways motion, so packs spread back
      //   out onto the flow lines.
      const FLOW_CORRECTION  = 0.08;
      const FLOW_TARGET_SPEED = config.speedMultiplier;
      const asteroids = this.entityIndex.asteroids;
      const flowEnabled = this.asteroidFlowEnabled;
      const laneJitter = this.ffLaneJitter;
      const applyFlow = (e: GameEntity) => {
          // Nebula shards anchor in place — flow correction is
          // skipped so the field can't drag them around the map.
          // Combined with NEBULA_CONSTANTS.LINEAR_DAMPING the
          // shard's velocity decays to zero after any kick (shatter,
          // gravity pull, impact) and stays there.  Rotation still
          // integrates so spinning shards keep tumbling visually.
          if (e.shardVariant === 'nebula-shard') {
              if (e.rotationSpeed) e.rotation += e.rotationSpeed * dt;
              return;
          }
          // DBG: when the asteroid-flow toggle is OFF, skip the
          // velocity nudge entirely.  Rotation still integrates so
          // existing tumble is preserved; existing velocity is left
          // untouched (only damping + collisions modify it).
          if (!flowEnabled) {
              if (e.rotationSpeed) e.rotation += e.rotationSpeed * dt;
              return;
          }
          const flow = this.flowField.sampleAsteroidFlow(e.position.x, e.position.y);
          // Per-shard lane jitter: nudge the target slightly
          // perpendicular to the flow by a STABLE per-shard amount so
          // shards ride parallel lanes instead of collapsing onto one
          // streamline.  Lazily seeded once per entity (stable
          // thereafter); the perpendicular of (fx, fy) is (-fy, fx).
          let fxDir = flow.x, fyDir = flow.y;
          if (laneJitter > 0) {
              if (e.flowLane === undefined) e.flowLane = Math.random() * 2 - 1;
              const off = e.flowLane * laneJitter;
              const px = -flow.y, py = flow.x;
              let nx = flow.x + px * off;
              let ny = flow.y + py * off;
              const nmag = Math.sqrt(nx * nx + ny * ny) || 1;
              fxDir = nx / nmag;
              fyDir = ny / nmag;
          }
          // Inverse-mass scaling — heavier shards lock on slower AND
          // cruise at a lower terminal speed.  Plastic's 5× boost is
          // multiplied BEFORE the mass scale so heavy plastic blobs
          // are diluted along with everything else; the boost shows
          // primarily on light plastic.
          const massScale = Math.sqrt(FLOW_VARIABILITY.MASS_REF
              / Math.max(e.mass, FLOW_VARIABILITY.MASS_REF * FLOW_VARIABILITY.MIN_MASS_FRACTION));
          const plasticBoost = e.shardVariant === 'plastic-shard' ? PLASTIC_SHARD_FLOW_MULT : 1;
          const correctionMul = plasticBoost * massScale;
          const targetSpeed = FLOW_TARGET_SPEED * massScale;
          const tx = fxDir * targetSpeed;
          const ty = fyDir * targetSpeed;
          const vAlongFlow = e.velocity.x * fxDir + e.velocity.y * fyDir;
          const vSq = e.velocity.x * e.velocity.x + e.velocity.y * e.velocity.y;
          const vPerp = Math.sqrt(Math.max(0, vSq - vAlongFlow * vAlongFlow));
          const parallelDeficit = Math.max(0, Math.min(1, 1 - vAlongFlow / targetSpeed));
          const perpDeficit     = Math.min(1, vPerp / targetSpeed);
          const urgency         = 1 + 8 * Math.max(parallelDeficit, perpDeficit);
          const alpha           = Math.min(0.8, FLOW_CORRECTION * dt * urgency * correctionMul);
          e.velocity.x += (tx - e.velocity.x) * alpha;
          e.velocity.y += (ty - e.velocity.y) * alpha;
          if (e.rotationSpeed) e.rotation += e.rotationSpeed * dt;
      };
      for (let i = 0; i < asteroids.length; i++) applyFlow(asteroids[i]);

      // Collectible drops (ammo + health) follow the same asteroid flow
      // field — the wind that catches loose shards also drags drops along,
      // so a wave kill's drops drift with the local current toward the
      // player instead of sitting where they spawned.  Magnetised drops
      // skip the pass so the player-magnet trajectory isn't tugged sideways.
      if (flowEnabled) {
          for (let i = 0; i < this.activeDrops.length; i++) {
              const d = this.activeDrops[i];
              if (!d.active) continue;
              if (!isCollectibleDrop(d)) continue;
              if (d.magnetized) continue;
              const flow = this.flowField.sampleAsteroidFlow(d.position.x, d.position.y);
              let fxDir = flow.x, fyDir = flow.y;
              if (laneJitter > 0) {
                  if (d.flowLane === undefined) d.flowLane = Math.random() * 2 - 1;
                  const off = d.flowLane * laneJitter;
                  const px = -flow.y, py = flow.x;
                  let nx = flow.x + px * off;
                  let ny = flow.y + py * off;
                  const nmag = Math.sqrt(nx * nx + ny * ny) || 1;
                  fxDir = nx / nmag;
                  fyDir = ny / nmag;
              }
              // Same inverse-mass scaling as the shard loop.  Drops
              // have fixed mass = 5 (makeDropEntity), so all ammo
              // drops share a single massScale ≈ sqrt(7/5) = 1.18 —
              // slightly faster than baseline-mass shards.  Plastic
              // boost doesn't apply (drops aren't shards).
              const massScale = Math.sqrt(FLOW_VARIABILITY.MASS_REF
                  / Math.max(d.mass, FLOW_VARIABILITY.MASS_REF * FLOW_VARIABILITY.MIN_MASS_FRACTION));
              const targetSpeed = FLOW_TARGET_SPEED * massScale;
              const tx = fxDir * targetSpeed;
              const ty = fyDir * targetSpeed;
              const vAlongFlow = d.velocity.x * fxDir + d.velocity.y * fyDir;
              const vSq = d.velocity.x * d.velocity.x + d.velocity.y * d.velocity.y;
              const vPerp = Math.sqrt(Math.max(0, vSq - vAlongFlow * vAlongFlow));
              const parallelDeficit = Math.max(0, Math.min(1, 1 - vAlongFlow / targetSpeed));
              const perpDeficit     = Math.min(1, vPerp / targetSpeed);
              const urgency         = 1 + 8 * Math.max(parallelDeficit, perpDeficit);
              const alpha           = Math.min(0.8, FLOW_CORRECTION * dt * urgency * massScale);
              d.velocity.x += (tx - d.velocity.x) * alpha;
              d.velocity.y += (ty - d.velocity.y) * alpha;
          }
      }


      // Stage 4: stick-bond + nebula gravity-merge are owned by
      // ShardSystem.update (called from updateGameLogic alongside
      // tickRegens).  The pass moved phases — was end-of-physics,
      // now end-of-logic — but same fixed-step dt, same ordering
      // relative to integration.

      // In-place compaction (Garbage Free)
      // Inactive tiles with regenProgress set are kept as ghost placeholders.
      // Inactive particles + projectiles are routed back to their owning
      // system's object pool for reuse on the next spawn — saves the
      // per-spawn allocation and the matching GC scan work.  All other
      // inactive entity types just fall out of the array and let the GC
      // collect them on the next sweep.
      let writeIdx = 0;
      for (let i = 0; i < this.currentMap.entities.length; i++) {
          const ent = this.currentMap.entities[i];
          if (ent.active || (ent.type === EntityType.STRUCTURE && ent.regenProgress !== undefined)) {
              this.currentMap.entities[writeIdx++] = ent;
          } else if (ent.type === EntityType.PARTICLE) {
              this.particles.releaseToPool(ent);
          } else if (ent.type === EntityType.PROJECTILE) {
              this.projectiles.releaseToPool(ent);
          }
      }
      this.currentMap.entities.length = writeIdx;
  }

  private handleEntityDeath = (entity: GameEntity, opts?: { scoreScale?: number }) => {
      // Dragon mini-boss (Stage 6): a bespoke death — payoff + rift collapse,
      // not the normal enemy explosion/shard/drop path.
      if (entity.enemySubtype === EnemySubtype.DRAGON && !entity.isExploding) {
          const inst = this.dragons.find(g => g.head === entity);
          if (inst) { this.dragonDeath(inst); return; }
      }
      // A body segment shot off: sever the tail + dissolve it (no regen/drops).
      if (entity.dragonSegment === true) { this.dragonSegmentDeath(entity); return; }
      // Score before startExplosion flips isExploding — the flag doubles
      // as the already-scored guard if a second death dispatch slips in.
      // Survivors retired at time-up never reach this path (WaveSystem
      // flips `active` directly), so they correctly award nothing.
      // scoreScale (default 1) lets the snitch board-clear pay a fraction
      // of the normal kill value per swept enemy.
      if (entity.type === EntityType.ENEMY && !entity.isExploding && !entity.killedByRival) {
          // Ship kills build the combo and are paid at the resulting
          // multiplier; the scoreScale (snitch sweep = 0.5) stacks on top.
          // A rival-killed enemy (killedByRival) pays the player NOTHING — the
          // rival stole it (Stage 7); the theft is shown by the rival's popup.
          const mult = this.registerComboKill();
          const scale = opts?.scoreScale ?? 1;
          this.awardScore(
              Math.round(SCORE_CONSTANTS.POINTS_PER_TIER * (entity.enemyTier ?? 1) * scale * mult),
              entity.position,
          );
      }
      if (entity.type === EntityType.PLAYER || entity.type === EntityType.ENEMY) {
          this.startExplosion(entity);
      }

      // Kamikaze detonation (Stage 0): a bomber flagged by the PhysicsSystem
      // contact path fires its AoE shockwave at the contact point — instant,
      // ENEMY-owned (threatens the player, shield-respecting in
      // updateExplosionRings) + catches nearby enemies/structures as
      // collateral.  Killed-early bombers never set the flag, so no boom.
      if (entity.detonateOnDeath && entity.explosionRadius !== undefined) {
          entity.detonateOnDeath = false;
          // Ring handles collateral (nearby enemies/structures) + visuals; the
          // PLAYER is hit DIRECTLY (below) so the launch + damage land instantly
          // and reliably at the contact point, not gated on the ring sweep
          // reaching them — hence the player is excluded from the ring.
          this.spawnShockwave(entity.position, {
              radius: entity.explosionRadius,
              damage: entity.explosionDamage ?? 0,
              knockback: entity.explosionKnockback ?? 0,
              color: entity.color || '#e879f9',
              ownerType: EntityType.ENEMY,
              ownerId: entity.id, // a caught bubble blames the bomber (Stage 5)
              excludeIds: ['player'],
          });
          this.applyKamikazeBlastToPlayer(entity);
          // Heavy screen punch — the detonation should feel like a real blast.
          this.handleScreenShake(COLLISION_CONFIG.SHAKE.HEAVY);
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
          // Shard/tile destruction points — player-attributed kills only
          // (flag stamped by the projectile / crash / lightning / AoE
          // damage paths).  Cleared immediately so a regen-reused tile
          // entity can't re-award without a fresh player kill.  Nebula
          // variants are excluded: ambient clouds shatter constantly and
          // would spam micro-payouts.
          if (entity.killedByPlayer) {
              entity.killedByPlayer = undefined;
              if (!isNebula) {
                  const points = isStaticTile
                      ? SCORE_CONSTANTS.TILE_DESTROY_POINTS_PER_HP * Math.max(1, Math.round(entity.maxHealth))
                      : SCORE_CONSTANTS.SHARD_DESTROY_POINTS;
                  this.awardScore(points, entity.position);
              }
          }
          // Tile destruction patches the analytical flow field so
          // pursuing enemies don't path through holes that closed
          // since map load.  Mobile shards have no flow-field
          // footprint.
          if (isStaticTile) {
              this.flowField.onTileDestroyed(entity.position.x, entity.position.y);
              // Material-tile automata counts are frozen at map-load bake,
              // so a tile death does NOT re-tint its surviving neighbours —
              // no recompute trigger here (that per-destroy O(n) pass was
              // the merge's main lag source).
          }
          // Variant-driven shatter (no-op for kind='none').
          // - nebula-tile: spawns 2-3 nebula-shards.
          // - glass-tile: visual debris via DropSystem.spawnGlassShards
          //   (called from spawnDrops); the SHARD_VARIANTS shatter
          //   policy is unused on this path.
          // - dent variants (plastic-tile / metal-tile / rock-tile):
          //   tile detaches via DropSystem.spawnDentShard reading
          //   dent.breakShards — skip ShardSystem.shatter entirely so
          //   the two paths don't double-spawn.  Variants with `dent`
          //   set BUT `breakShards` empty (today plastic-shard) want
          //   the standard shatter path for child-spawning — dent is
          //   only there for the HP-per-hit / no-visible-deform
          //   contract.
          const dent = SHARD_VARIANTS[variant].dent;
          const isDentSpawn = dent !== undefined && dent.breakShards.length > 0;
          if (this.currentMap && variant !== 'glass-tile' && !isDentSpawn) {
              this.shards.shatter(entity, this.currentMap.entities);
          }

          // Rock-shard death also releases 1 colour-matched nebula-
          // shard (cloud-style fragment) alongside the solid shatter
          // children.  Only fires for mobile shards (mass !==
          // Infinity) and only when the shard was big enough to
          // produce shatter children — small chips (size < 24)
          // destroy cleanly without puffs.
          if (this.currentMap
              && variant === 'rock-shard'
              && entity.mass !== Infinity
              && Math.max(entity.size.x, entity.size.y) >= 24) {
              const baseSize = this.deformedDiameter(entity);
              for (let nb = 0; nb < 1; nb++) {
                  const jitter = baseSize * 0.2;
                  const puffPos = {
                      x: entity.position.x + (Math.random() - 0.5) * jitter,
                      y: entity.position.y + (Math.random() - 0.5) * jitter,
                  };
                  const comp = randomRockNebulaComposition();
                  this.drops.spawnColoredNebulaShard(
                      this.currentMap.entities,
                      puffPos,
                      baseSize,
                      comp[0].hex,
                      0.45 + Math.random() * 0.2,
                      entity.lastImpactVelocity ?? entity.velocity,
                      comp,
                      0.5,
                      true, // fromRock — condenses back to rock-shard
                  );
              }
          }

          // Rock-tile death burst — 3-5 colour-matched nebula-shards
          // scattered around the tile centre, on top of the per-hit
          // puffs that fired during deformation.  Sells the final
          // collapse as a substantial dust cloud rather than just
          // another small chip-off.
          if (this.currentMap
              && variant === 'rock-tile'
              && entity.mass === Infinity) {
              const baseSize = this.deformedDiameter(entity);
              const count = 3 + Math.floor(Math.random() * 3);
              for (let nb = 0; nb < count; nb++) {
                  const jitter = baseSize * 0.4;
                  const puffPos = {
                      x: entity.position.x + (Math.random() - 0.5) * jitter,
                      y: entity.position.y + (Math.random() - 0.5) * jitter,
                  };
                  const comp = randomRockNebulaComposition();
                  this.drops.spawnColoredNebulaShard(
                      this.currentMap.entities,
                      puffPos,
                      baseSize,
                      comp[0].hex,
                      0.4 + Math.random() * 0.3,
                      entity.lastImpactVelocity,
                      comp,
                      0.5,
                      true, // fromRock — condenses back to rock-shard
                  );
              }
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

      // Tiny pop-on-contact gnats (Swarm) die in bulk — skip the heavy debris/
      // drop spray + nebula dust so a popping cloud doesn't flood the field with
      // shards, drops, and puffs.  They're a cheap threat, not a loot source.
      if (entity.type === EntityType.ENEMY && !entity.diesOnContact) {
          this.spawnEnemyShards(entity);

          // Enemy death dust — a handful of nebula-shards tinted to the
          // enemy's own body colour, mirroring the rock-tile death burst.
          // Cosmetic: the puffs drift, fade in, and feed the normal nebula
          // merge/condense system.  Single hex (no composition) so the
          // shard still equilibrates instead of freezing at spawn colour.
          if (this.currentMap && ENEMY_NEBULA_BURST.MAX_COUNT > 0) {
              const ec = entity.color || '#f87171';
              const baseSize = Math.max(entity.size.x, entity.size.y);
              const span = ENEMY_NEBULA_BURST.MAX_COUNT - ENEMY_NEBULA_BURST.MIN_COUNT + 1;
              const count = ENEMY_NEBULA_BURST.MIN_COUNT + Math.floor(Math.random() * span);
              const inheritVel = entity.lastImpactVelocity ?? entity.velocity;
              for (let nb = 0; nb < count; nb++) {
                  const jitter = baseSize * ENEMY_NEBULA_BURST.SPREAD_JITTER;
                  const puffPos = {
                      x: entity.position.x + (Math.random() - 0.5) * jitter,
                      y: entity.position.y + (Math.random() - 0.5) * jitter,
                  };
                  this.drops.spawnColoredNebulaShard(
                      this.currentMap.entities,
                      puffPos,
                      baseSize,
                      ec,
                      ENEMY_NEBULA_BURST.SIZE_FRACTION,
                      inheritVel,
                      undefined, // single-hex tint from the enemy colour
                      ENEMY_NEBULA_BURST.ALPHA_MUL,
                  );
              }
          }
      }

      // Death burst particles — size/color tuned per entity type
      if (entity.type === EntityType.ENEMY) {
          const ec = entity.color || '#f87171';
          const r = Math.max(entity.size.x, entity.size.y);
          // Tiny pop-on-contact gnats (Swarm) die in bulk, so they get a
          // deliberately LIGHT burst — one small ring + a few sparks, no screen
          // shake — to avoid particle/shake spam when a cloud goes down at once.
          if (entity.diesOnContact) {
              this.spawnShockwave(entity.position, { radius: r * 1.6, damage: 0, knockback: 0, color: ec, lifetime: 0.2 });
              this.spawnParticles(entity.position, 5, ec, {
                  speedMin: 3, speedMax: 10, sizeMin: 1.5, sizeMax: 3,
                  lifetimeMin: 0.18, lifetimeMax: 0.4,
              });
          } else {
              // Expanding shockwave ring (visual only) — a satisfying pop sized
              // to the enemy; bigger enemies pop bigger.
              this.spawnShockwave(entity.position, { radius: r * 2.4, damage: 0, knockback: 0, color: ec, lifetime: 0.34 });
              this.spawnShockwave(entity.position, { radius: r * 1.3, damage: 0, knockback: 0, color: '#ffffff', lifetime: 0.22 });
              // Big colored debris burst + white core flash.  (Counts trimmed
              // ~40 % — Tier 2b — so a mass death spawns fewer particles; the
              // pop still reads at MAX_PARTICLES-bounded density.)
              this.spawnParticles(entity.position, 10 + Math.floor(Math.random() * 4), ec, {
                  speedMin: 4, speedMax: 16, sizeMin: 2, sizeMax: 4.5,
                  lifetimeMin: 0.3, lifetimeMax: 0.7,
              });
              this.spawnParticles(entity.position, 5, '#ffffff', {
                  speedMin: 7, speedMax: 20, sizeMin: 1.5, sizeMax: 3,
                  lifetimeMin: 0.15, lifetimeMax: 0.35,
              });
              // Small tier-scaled screen punch (respects the DBG shake toggle).
              this.handleScreenShake(2.5 + (entity.enemyTier ?? 1));
          }
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
      } else if (variant === 'plastic-tile' || variant === 'plastic-shard') {
          // Plastic intentionally emits no death spark burst.
      } else if (isNebula) {
          // Nebulae fade out gracefully via mergeFadeTimer in the
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

    // Kill-combo window — lapses if no ship dies for COMBO_WINDOW_SEC.
    if (this.comboTimer > 0) {
        this.comboTimer -= dt;
        if (this.comboTimer <= 0) {
            this.comboTimer = 0;
            this.comboCount = 0;
        }
    }

    // Player status effects (corrosion DoT, …) tick before the death check.
    this.tickStatusEffects(dt);

    // Deferred card-modal open — fires once the wave-clear celebration
    // beat has elapsed (the modal then pauses the sim).
    if (this.cardOpenDelaySec > 0) {
        this.cardOpenDelaySec -= dt;
        if (this.cardOpenDelaySec <= 0 && !this.cardChoicePending) {
            this.openCardChoice(this.pendingCardWaveNum);
            this.pendingCardWaveNum = 0;
        }
    }

    // Update Shake.  Mutate shakeOffset in place rather than replacing the
    // object — the field is read by reference downstream and a fresh object
    // every active-shake frame is wasted GC pressure.
    if (this.shakeTimer > 0) {
        this.shakeTimer -= dt;
        const decay = Math.max(0, this.shakeTimer / CAMERA_CONSTANTS.SHAKE_DECAY); // Linear falloff
        const mag = this.shakeIntensity * decay;

        if (this.shakeTimer <= 0) {
            this.camera.shakeOffset.x = 0;
            this.camera.shakeOffset.y = 0;
        } else {
            this.camera.shakeOffset.x = (Math.random() - 0.5) * mag * 2;
            this.camera.shakeOffset.y = (Math.random() - 0.5) * mag * 2;
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
        this.shards.setMergeContext(this.currentMap.type);
        // Pace the shard merge / cohesion passes to the same cadence
        // as PhysicsSystem.resolveShardPairs (computed inside the
        // physics.update call earlier this substep).  Without this,
        // bond formation + cohesion run every frame while separation
        // runs only every Nth, and dense clusters collapse to a
        // single point on high-N ShPair settings.
        this.shards.update(this.currentMap.entities, dt, this.physics, this.physics.lastRunShardPair);
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

    // Cannon shockwave — tick any active explosion rings, damaging any
    // entity the wavefront has just reached.  Runs after physics so
    // entity positions reflect this step's movement before being tested
    // against the ring radius.
    // Kamikaze proximity fuse — detonate any bomber that has closed inside its
    // trigger radius of the player, so the blast goes off slightly BEFORE
    // contact (the on-contact path stays as a fallback).
    this.updateKamikazeProximity();

    // Stage 5: bubbles form/tick player latches and split when fat.  Runs
    // BEFORE updateAttachments so a latch formed this step snaps the same frame.
    this.updateBubbles(dt);
    // Ambient fauna: keep the always-present bubble population topped up.
    this.maintainAmbientBubbles(dt);

    // Stage 3 reusable mechanics: snap grapples to their targets, and run the
    // (gated) consume-and-grow neighbour scan.  Both no-op until an entity sets
    // attachedToId / consume (Stage 4/5/6).
    this.updateAttachments();
    if (this.perfController.shouldRun('consume')) this.updateConsumers(dt);

    // Stage 4: nests birth swarm brood on their timers.
    this.updateNests(dt);

    const tRings = performance.now();
    this.updateExplosionRings();
    this.lastExplosionRingsMs = performance.now() - tRings;

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

    // Timed-wave tick — spawn stream, time-up / early-clear completion,
    // survivor cleanup, grace countdown into the next wave.  On wave end we
    // drop a health pickup every Nth wave (difficulty-scaled).
    if (this.currentMap) {
      const waveCtx = this.waveContext();
      if (waveCtx) {
        this.waves.update(dt, waveCtx, this.handleWaveCleared);
      }
    }

    // Snitch tick — spawn for a fresh wave, steer along the flow field,
    // run the catch check (collide / shoot per the DBG toggle).
    this.updateSnitch(dt);
    this.updateDragons(dt);
    this.updateRivals(dt);

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
    const acc = (moveConfig ? moveConfig.acceleration : PHYSICS_CONSTANTS.ACCELERATION) * getActivePlayerThrustMult() * this.upgradeThrustMult();
    const maxSpeed = (moveConfig ? moveConfig.maxSpeed : PHYSICS_CONSTANTS.MAX_SPEED) * getActivePlayerSpeedMult() * this.upgradeSpeedMult();

    // Time-Scaled Input Acceleration
    // Input is applied per-frame (variable dt), so we must scale acceleration by dt
    // Normalized to 60fps (dt * 60)
    const timeScale = dt * 60;
    this.player.velocity.x += moveDir.x * acc * timeScale;
    this.player.velocity.y += moveDir.y * acc * timeScale;
    const throttle = Math.sqrt(moveDir.x * moveDir.x + moveDir.y * moveDir.y);

    // Speed cap, with an external-impulse overshoot allowance: an explosion
    // knockback (updateExplosionRings) raises `overSpeedAllow` above maxSpeed so
    // the player is actually launched; the overshoot decays back to the cap each
    // step (so the launch bleeds off) instead of the hard cap eating the hit.
    let speedCap = maxSpeed;
    if (this.player.overSpeedAllow !== undefined) {
        const over = this.player.overSpeedAllow - maxSpeed;
        if (over <= 0.5) {
            this.player.overSpeedAllow = undefined;
        } else {
            this.player.overSpeedAllow = maxSpeed + over * Math.pow(HIT_FEEDBACK.PLAYER_KNOCKBACK_DECAY, timeScale);
            speedCap = this.player.overSpeedAllow;
        }
    }
    const currentSpeed = Math.sqrt(this.player.velocity.x**2 + this.player.velocity.y**2);
    if (currentSpeed > speedCap) {
        this.player.velocity.x = (this.player.velocity.x / currentSpeed) * speedCap;
        this.player.velocity.y = (this.player.velocity.y / currentSpeed) * speedCap;
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
            this.handleShooting(evt, false);
        }
    });

    // Charge-release events: held for the full CHARGE_FULL window then
    // released.  Fire a charged shot.
    const chargeReleaseEvents = this.input.getChargeReleaseEvents();
    chargeReleaseEvents.forEach(evt => {
        if (!this.minimapExpanded) {
            this.handleShooting(evt, true);
        }
    });

    // Update player.chargeProgress for the charge-ring HUD.  Stored as
    // fraction of CHARGE_FULL ([0, 1]).  Ring snaps to "full" colour at 1.
    const heldFor = this.input.getMouseHoldDuration();
    this.player.chargeProgress = (this.overchargeUnlocked && heldFor > 0 && !this.player.systemsDisabled)
        ? Math.min(1, heldFor / INPUT_CONSTANTS.CHARGE_FULL)
        : 0;

    // Tick weapon cooldown + burst-fire queue via WeaponSystem — frozen while
    // EMP-disabled (Stage 3c) so an in-flight burst halts too.
    const tWeapons = performance.now();
    if (this.currentMap && !this.player.systemsDisabled) {
        this.weapons.tickPlayerBurst(this.currentMap.entities, this.player, dt, this.handleScreenShake);
    }
    this.lastWeaponsMs = performance.now() - tWeapons;

    // Refresh the candidate index before projectile post-processing: the
    // physics / AI / burst pass above may have spawned new projectiles or
    // destroyed enemies since the last rebuild in prepareFrameEntities.
    if (this.currentMap) this.entityIndex.rebuild(this.currentMap.entities);

    this.updateHomingProjectiles(dt);
    this.updateLightningGravity(dt);
    this.updateProjectileTrails(dt);

    // Damage Text cleanup.  Expired texts return to the pool for reuse
    // by the next spawnDamageText call instead of being dropped to GC.
    let dTextIdx = 0;
    for (let i = 0; i < this.damageTexts.length; i++) {
        const t = this.damageTexts[i];
        t.lifetime -= dt;
        t.position.x += t.velocity.x * dt;
        t.position.y += t.velocity.y * dt;
        if (t.lifetime > 0) {
            this.damageTexts[dTextIdx++] = t;
        } else if (this._damageTextPool.length < this.DAMAGE_TEXT_POOL_CAP) {
            this._damageTextPool.push(t);
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
    // An ammo shard starts pulling only once the player comes within
    // MAGNET_RANGE; from then on it's latched (`magnetized`) and homes to
    // completion even if the player leaves.  Health hearts collect on
    // contact only (static pickup).  Skippable (PerfController `dropScan`
    // task): collection has a generous radius so a few-step lag is
    // imperceptible, and the pull SETS velocity (units/step) rather than
    // accumulating acceleration, so a skipped scan just lets the drop
    // coast toward its last-aimed point until the next re-aim.  The
    // compaction below still runs every step so drops expired elsewhere
    // drop out promptly.
    const tDrops = performance.now();
    if (!this.player.isExploding && this.perfController.shouldRun('dropScan')) {
      const collectRadSq = DROP_CONFIG.COLLECT_RADIUS * DROP_CONFIG.COLLECT_RADIUS;
      const magnetRangeSq = DROP_CONFIG.MAGNET_RANGE * DROP_CONFIG.MAGNET_RANGE;
      const MAGNET_SPEED = DROP_CONFIG.MAGNET_SPEED;
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
        // Latch on first entry into pull range; once latched the drop
        // keeps homing regardless of distance (guaranteed collection).
        if (!drop.magnetized) {
          if (distSq >= magnetRangeSq) continue;
          drop.magnetized = true;
        }
        // Direct homing pull: velocity points straight at the player at
        // MAGNET_SPEED, eased to the exact remaining distance when close
        // so the drop settles on the player rather than overshooting.
        const dist  = Math.sqrt(distSq);
        const speed = Math.min(dist, MAGNET_SPEED);
        const k     = speed / dist;
        drop.velocity.x = dx * k;
        drop.velocity.y = dy * k;
      }
    }

    // Consolidate ammo-drop clusters — pairs within touching range
    // fuse, the survivor absorbs the value, the other retires for
    // the compaction sweep below.  Total ammo across the cluster is
    // preserved (sum-of-values onto the survivor), so this is purely
    // an entity-count reduction, not an ammo nerf.  Cadenced via
    // PerfController 'dropMerge' (autoCurve 1-4 steps) — the O(N²)
    // pair scan + pull damping isn't time-critical, drops converge
    // over many frames either way.
    if (this.perfController.shouldRun('dropMerge')) {
      this.drops.mergeAmmoDrops(this.activeDrops);
    }

    // Remove drops that were deactivated (collected, shot, or expired).
    let dropWriteIdx = 0;
    for (let i = 0; i < this.activeDrops.length; i++) {
        if (this.activeDrops[i].active) this.activeDrops[dropWriteIdx++] = this.activeDrops[i];
    }
    this.activeDrops.length = dropWriteIdx;
    this.lastDropsMs = performance.now() - tDrops;


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
    // Status-effect rounds (e.g. corrosion) debuff the player on hit.
    if (proj.appliesEffect && target.type === EntityType.PLAYER && !target.isExploding) {
      this.applyStatusEffect(target, proj.appliesEffect);
    }
    // Derive impact direction for a slight forward cone bias
    const impactAngle = Math.atan2(proj.velocity.y, proj.velocity.x);

    switch (target.type) {
      case EntityType.ENEMY:
        // Bright sparks in the enemy's own color, spread forward from impact,
        // plus a few hot white sparks for a punchier impact.
        this.spawnParticles(impactPos, 10, target.color || '#f87171', {
          speedMin: 4, speedMax: 11, sizeMin: 1.5, sizeMax: 3.5,
          spreadAngle: impactAngle, spreadCone: Math.PI * 0.6,
          lifetimeMin: 0.2, lifetimeMax: 0.4,
        });
        this.spawnParticles(impactPos, 4, '#ffffff', {
          speedMin: 6, speedMax: 14, sizeMin: 1, sizeMax: 2,
          spreadAngle: impactAngle, spreadCone: Math.PI * 0.45,
          lifetimeMin: 0.1, lifetimeMax: 0.25,
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
        // mobile shards (finite mass).  Mobile rock / plastic / metal
        // shards get a material-coloured dust puff; mobile glass-shards
        // keep the tile-spark layer.
        if (target.mass !== Infinity
            && (target.shardVariant === 'rock-shard'
                || target.shardVariant === 'plastic-shard'
                || target.shardVariant === 'metal-shard')) {
          const dustCount = target.size.x > 50 ? 5 : 3;
          const dustColor =
              target.shardVariant === 'plastic-shard' ? '#b45309'
            : target.shardVariant === 'metal-shard'   ? '#cbd5e1'
            :                                            '#94a3b8'; // rock-shard
          this.spawnParticles(impactPos, dustCount, dustColor, {
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
        this.fireLightningChainFromImpact(impactPos, target, proj);
    }

    // Cannon AoE: every entity within proj.explosionRadius takes
    // proj.explosionDamage and a knockback impulse.  Direct-hit target
    // is excluded (it already took config.damage in PhysicsSystem).
    if (proj.explosionRadius && proj.explosionRadius > 0) {
        this.applyExplosionAoE(impactPos, proj, target);
    }
  };

  // ── Progression: upgrade application + DBG controls ─────────────────────

  /** Engine/Thrusters levels feed the per-frame movement multipliers
   *  alongside the existing DBG thrust/speed cycles. */
  private upgradeSpeedMult(): number {
      return 1 + UPGRADE_EFFECTS.ENGINE_SPEED_FRAC_PER_LEVEL * this.upgradeLevels.engine;
  }
  private upgradeThrustMult(): number {
      return 1 + UPGRADE_EFFECTS.THRUSTERS_ACCEL_FRAC_PER_LEVEL * this.upgradeLevels.thrusters;
  }

  /** Recompute every upgrade-derived player stat from the current levels.
   *  Called at construction, on any level change, and on run reset.  Hull
   *  heals the HP it adds so a purchase is felt immediately. */
  private applyUpgrades() {
      const lv = this.upgradeLevels;
      const newMaxHp = 100 + UPGRADE_EFFECTS.HULL_HP_PER_LEVEL * lv.hull;
      const hpDelta = newMaxHp - this.player.maxHealth;
      this.player.maxHealth = newMaxHp;
      if (hpDelta > 0) this.player.health = Math.min(newMaxHp, this.player.health + hpDelta);
      // Shield is gated behind its unlock — locked → no shield at all
      // (Plating levels only matter once Shield is owned).
      this.player.maxShield = this.shieldUnlocked
          ? SHIELD_CONSTANTS.MAX_CHARGE + UPGRADE_EFFECTS.PLATING_SHIELD_PER_LEVEL * lv.plating
          : 0;
      if ((this.player.shield ?? 0) > this.player.maxShield) this.player.shield = this.player.maxShield;
      this.player.shieldRechargeRate = SHIELD_CONSTANTS.RECHARGE_RATE
          * (1 + UPGRADE_EFFECTS.CAPACITOR_RECHARGE_FRAC_PER_LEVEL * lv.capacitor);
      this.player.damageMult = 1 + UPGRADE_EFFECTS.GUNNERY_DAMAGE_FRAC_PER_LEVEL * lv.gunnery;
      this.player.cooldownMult = Math.max(
          UPGRADE_EFFECTS.AUTOLOADER_COOLDOWN_FLOOR,
          1 - UPGRADE_EFFECTS.AUTOLOADER_COOLDOWN_FRAC_PER_LEVEL * lv.autoloader,
      );
      this.player.maxAmmo = AMMO_CONSTANTS.MAX_POOL + UPGRADE_EFFECTS.MAGAZINE_AMMO_PER_LEVEL * lv.magazine;
  }

  /** Per-upgrade snapshot for the DBG panel + (future) shop. */
  private upgradeSnapshot() {
      return UPGRADE_DEFS.map(d => ({
          id: d.id, label: d.label, level: this.upgradeLevels[d.id], max: d.max,
      }));
  }

  /** DBG: bump an upgrade one level, wrapping max → 0, then re-apply. */
  public cycleUpgrade(id: UpgradeId) {
      const def = UPGRADE_DEFS.find(d => d.id === id);
      if (!def) return;
      this.upgradeLevels[id] = (this.upgradeLevels[id] + 1) % (def.max + 1);
      this.applyUpgrades();
  }
  /** DBG: max every upgrade. */
  public maxAllUpgrades() {
      for (const d of UPGRADE_DEFS) this.upgradeLevels[d.id] = d.max;
      this.applyUpgrades();
  }
  /** DBG: clear every upgrade back to L0. */
  public resetUpgrades() {
      for (const d of UPGRADE_DEFS) this.upgradeLevels[d.id] = 0;
      this.applyUpgrades();
  }
  /** DBG: grant Salvage for testing the shop. */
  public addDebugCredits(n: number) { this.credits += n; }

  // ── Status effects ──────────────────────────────────────────────────────

  /** Apply (or refresh + stack) a status effect on an entity (the player
   *  today).  Re-hits add a stack up to maxStacks and refresh the timer. */
  private applyStatusEffect(target: GameEntity, payload: EffectPayload) {
    const list = target.statusEffects ?? (target.statusEffects = []);
    const existing = list.find(e => e.kind === payload.kind);
    if (existing) {
      existing.stacks = Math.min(payload.maxStacks, existing.stacks + 1);
      existing.remaining = payload.duration;
      existing.maxDuration = payload.duration;
      existing.dmgPerStack = payload.dmgPerSec;
    } else {
      list.push({
        kind: payload.kind, remaining: payload.duration, maxDuration: payload.duration,
        stacks: 1, dmgPerStack: payload.dmgPerSec,
      });
    }
  }

  /** Tick the player's status effects: apply per-step damage, count down,
   *  drop expired.  Corrosion bleeds health directly (past the shield). */
  private tickStatusEffects(dt: number) {
    // Derived disable flag is recomputed every tick (set below if an active
    // 'disable' effect is present), so clear it up front even on the empty
    // early-out so it can't stick after the effect lapses.
    this.player.systemsDisabled = false;
    const list = this.player.statusEffects;
    if (!list || list.length === 0) return;
    let acidParticle = false;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (e.kind === 'corrosion' && !this.player.isExploding) {
        this.player.health -= e.dmgPerStack * e.stacks * dt;
        acidParticle = true;
      } else if (e.kind === 'disable') {
        // EMP: weapon + shield offline while active (read in the fire + shield
        // hot paths via systemsDisabled).
        this.player.systemsDisabled = true;
      }
      e.remaining -= dt;
      if (e.remaining <= 0) list.splice(i, 1);
    }
    // Occasional acid drip on the ship while corroding (throttled).
    if (acidParticle && Math.random() < 0.4) {
      this.spawnParticles(this.player.position, 1, CORROSION.COLOR, {
        speedMin: 0.5, speedMax: 2, sizeMin: 1, sizeMax: 2.2,
        lifetimeMin: 0.3, lifetimeMax: 0.6,
        positionJitter: this.player.size.x * 0.6,
      });
    }
  }

  /** DBG: drop a corrosion stack on the player to test the effect + HUD. */
  public debugApplyCorrosion() {
    this.applyStatusEffect(this.player, {
      kind: 'corrosion', duration: CORROSION.DURATION,
      dmgPerSec: CORROSION.DMG_PER_SEC, maxStacks: CORROSION.MAX_STACKS,
    });
  }

  /** DBG: EMP the player to test the weapon/shield disable + HUD badge. */
  public debugApplyDisable() {
    this.applyStatusEffect(this.player, {
      kind: 'disable', duration: DISABLE.DURATION, dmgPerSec: 0, maxStacks: 1,
    });
  }

  // ── Unlocks + Drydock shop ──────────────────────────────────────────────

  /** Push the unlock state onto the player entity so WeaponSystem can gate
   *  weapon cycle/select + charged shots without reaching into the engine. */
  private syncUnlocksToPlayer() {
      this.player.ownedWeapons = WEAPON_LIST.filter(w => this.unlockedWeapons.has(w));
      this.player.overchargeUnlocked = this.overchargeUnlocked;
  }

  private isUnlockOwned(def: UnlockDef): boolean {
      if (def.kind === 'shield') return this.shieldUnlocked;
      if (def.kind === 'overcharge') return this.overchargeUnlocked;
      return def.weapon !== undefined && this.unlockedWeapons.has(def.weapon);
  }

  /** Grant an unlock (free path: cards / DBG; the shop deducts first). */
  private applyUnlock(def: UnlockDef) {
      if (def.kind === 'shield') {
          this.shieldUnlocked = true;
          this.applyUpgrades();
          this.player.shield = this.player.maxShield ?? 0; // hand over a full shield
      } else if (def.kind === 'overcharge') {
          this.overchargeUnlocked = true;
          this.syncUnlocksToPlayer();
      } else if (def.weapon !== undefined) {
          this.unlockedWeapons.add(def.weapon);
          this.syncUnlocksToPlayer();
          // Auto-equip the freshly unlocked weapon for immediate payoff.
          this.currentWeaponIndex = this.weapons.selectWeapon(this.player, def.weapon);
      }
  }

  /** Buy a one-time unlock with Salvage.  (Stat upgrades are NOT sold here
   *  — they come exclusively from wave-completion cards.) */
  public purchaseUnlock(id: string): boolean {
      const def = UNLOCK_DEFS.find(d => d.id === id);
      if (!def || this.isUnlockOwned(def) || this.credits < def.cost) return false;
      this.credits -= def.cost;
      this.applyUnlock(def);
      return true;
  }

  /** DBG: unlock everything (weapons, shield, overcharge). */
  public debugUnlockAll() {
      for (const w of WEAPON_LIST) this.unlockedWeapons.add(w);
      this.shieldUnlocked = true;
      this.overchargeUnlocked = true;
      this.syncUnlocksToPlayer();
      this.applyUpgrades();
      this.player.shield = this.player.maxShield ?? 0;
  }

  /** Reset unlocks back to the lean run-start loadout. */
  private resetUnlocks() {
      this.unlockedWeapons = new Set([WeaponType.BLASTER]);
      this.shieldUnlocked = false;
      this.overchargeUnlocked = false;
      this.player.currentWeapon = WeaponType.BLASTER;
      this.currentWeaponIndex = 0;
      this.syncUnlocksToPlayer();
  }
  /** DBG: relock everything to the lean loadout. */
  public debugResetUnlocks() { this.resetUnlocks(); this.applyUpgrades(); }

  /** Drydock catalog snapshot for the player menu (built only while paused).
   *  Unlocks only — stat upgrades are card-only. */
  private shopSnapshot() {
      return {
          unlocks: UNLOCK_DEFS.map(d => {
              const owned = this.isUnlockOwned(d);
              return { id: d.id, label: d.label, desc: d.desc, owned, cost: d.cost, affordable: !owned && this.credits >= d.cost };
          }),
      };
  }

  /** Current kill-combo points multiplier (1 = no combo).  Steps up one
   *  per COMBO_KILLS_PER_TIER ship kills, capped at COMBO_MAX_MULTIPLIER. */
  private comboMultiplier(): number {
      if (this.comboTimer <= 0 || this.comboCount <= 0) return 1;
      return Math.min(
          SCORE_CONSTANTS.COMBO_MAX_MULTIPLIER,
          Math.max(1, Math.ceil(this.comboCount / SCORE_CONSTANTS.COMBO_KILLS_PER_TIER)),
      );
  }

  /** Register a ship kill against the combo: bump the count and refresh
   *  the window.  Returns the multiplier in effect AFTER the bump so the
   *  awarding caller scales this kill's points by it. */
  private registerComboKill(): number {
      this.comboCount++;
      this.comboTimer = SCORE_CONSTANTS.COMBO_WINDOW_SEC;
      return this.comboMultiplier();
  }

  /** Style a gold "+N" points popup: text + magnitude-tiered colour/size
   *  so a +5 chip reads differently from a +100 kill or a +1500 snitch. */
  private styleScorePopup(t: DamageText, value: number) {
      t.text = `+${value}`;
      if (value >= 1000)     { t.color = '#fde047'; t.fontScale = 1.7; }
      else if (value >= 300) { t.color = '#fbbf24'; t.fontScale = 1.35; }
      else if (value >= 100) { t.color = '#facc15'; t.fontScale = 1.15; }
      else                   { t.color = '#fcd34d'; t.fontScale = 0.9; }
  }

  /** Add points to the run score and float a gold "+N" popup.  A burst of
   *  awards (AoE / chain / sweep / rapid kills) accumulates into the one
   *  live popup — O(1), no array scan — so it reads as a growing total. */
  private awardScore(points: number, popupPos?: Vector2) {
      this.score += points;
      this.credits += points; // Salvage earns 1:1 with score (score stays the high-score)
      if (!popupPos || points === 0) return;

      // Fold into the current popup if it's still floating.
      const live = this._livePointsPopup;
      if (live && live.isScore && live.lifetime > 0) {
          live.scoreValue = (live.scoreValue ?? 0) + points;
          this.styleScorePopup(live, live.scoreValue);
          return;
      }

      const vx = (Math.random() - 0.5) * 10;
      const vy = -DAMAGE_TEXT_CONSTANTS.SPEED;
      const popup = this._damageTextPool.pop() ?? ({
          id: '', position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 },
          text: '', lifetime: 0, maxLifetime: 0, color: '', active: true,
      } as DamageText);
      popup.id = nextId('score');
      popup.position.x = popupPos.x; popup.position.y = popupPos.y;
      popup.velocity.x = vx; popup.velocity.y = vy;
      popup.lifetime = SCORE_CONSTANTS.POPUP_LIFETIME;
      popup.maxLifetime = SCORE_CONSTANTS.POPUP_LIFETIME;
      popup.isScore = true;
      popup.scoreValue = points;
      popup.active = true;
      this.styleScorePopup(popup, points);
      this.damageTexts.push(popup);
      this._livePointsPopup = popup;
  }

  private spawnDamageText = (pos: Vector2, amount: number, target?: GameEntity, impactWorldPos?: Vector2) => {
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
      // World-space damage numbers only show on a genuine SURVIVOR of the
      // hit — the case where the number carries information:
      //  - lethal hits (health <= 0) show nothing; the destruction FX and
      //    the gold points popup are the feedback (also kills the literal
      //    "999" asteroid-crush number),
      //  - dent tiles (plastic / metal) lose 1 HP per hit regardless of
      //    weapon, so the raw weapon-damage number is misleading and the
      //    visible deformation already telegraphs progress — skip them.
      // The remaining numbers (multi-HP survivors, e.g. future tanky
      // enemies) auto-appear without re-touching this gate.
      const isDent = target?.shardVariant !== undefined
          && SHARD_VARIANTS[target.shardVariant].dent !== undefined;
      // Rock (tiles + asteroids) reads its damage through the crack overlay
      // and the chip it sheds each hit, not a number — and it takes 1 HP/hit
      // regardless of weapon, so the raw "4" would mislead.  Suppress like
      // dent tiles.  (rock-tile is already a dent entity; name the shard.)
      const suppressNumber = isDent || target?.shardVariant === 'rock-shard';
      if (target && target.health > 0 && !suppressNumber) {
          const vx = (Math.random() - 0.5) * 10;
          const vy = -DAMAGE_TEXT_CONSTANTS.SPEED;
          const popup = this._damageTextPool.pop() ?? ({
              id: '', position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 },
              text: '', lifetime: 0, maxLifetime: 0, color: '', active: true,
          } as DamageText);
          popup.id = nextId('dmg');
          popup.position.x = pos.x; popup.position.y = pos.y;
          popup.text = Math.round(amount).toString();
          popup.velocity.x = vx; popup.velocity.y = vy;
          popup.lifetime = DAMAGE_TEXT_CONSTANTS.LIFETIME;
          popup.maxLifetime = DAMAGE_TEXT_CONSTANTS.LIFETIME;
          popup.color = DAMAGE_TEXT_CONSTANTS.COLOR;
          popup.isScore = false;
          popup.scoreValue = undefined;
          popup.fontScale = DAMAGE_TEXT_CONSTANTS.DAMAGE_FONT_SCALE;
          popup.active = true;
          this.damageTexts.push(popup);
      }

      // Dent-policy post-damage hooks — fire only while the tile is
      // still alive (target.health > 0).  Killing hits route through
      // the normal breakShards path in DropSystem.spawnDrops.
      if (target?.shardVariant && target.active && target.health > 0 && this.currentMap) {
          const dent = SHARD_VARIANTS[target.shardVariant].dent;
          if (dent) {
              // 'triangle-delete' kind: each hit removes the closest
              // vertex (+ angleOffset) and releases a triangle shard
              // shaped like the deleted corner.  Polygon loses one
              // vertex per hit; the dent kind on PhysicsSystem.
              // applyDentStep early-returns so it doesn't fight us
              // for the same polygon.  No current variant uses this
              // kind — kept as a building block.
              if (dent.kind === 'triangle-delete' && impactWorldPos) {
                  this.applyTriangleDelete(target, impactWorldPos, dent);
              }
              // 'pull' kind perHitShard: releases one shard at the
              // impact location every hit, sized to the deformed
              // tile.  Rock uses this so brittle chips visibly fly
              // off each hit while the polygon stays intact (vertex
              // count preserved; deformation accumulates via
              // applyDentStep's center-vertex pull).
              if (dent.perHitShard && impactWorldPos
                  && (dent.kind === undefined || dent.kind === 'pull')) {
                  this.drops.spawnPerHitShard(
                      this.currentMap.entities, target, dent.perHitShard, impactWorldPos,
                  );
                  // Rock-tile also releases tinted nebula-shards per
                  // hit — pairs the solid rock chip with drifting
                  // cloud puffs in the same colour as the parent tile,
                  // selling the brittle fracture as both shrapnel and
                  // dust.  Only rock today; other dent variants want
                  // the cleaner solid-shard-only readout.
                  if (target.shardVariant === 'rock-tile' && Math.random() < ROCK_HIT_NEBULA_PUFF_CHANCE) {
                      // Occasional puff per hit (probability gated above)
                      // at a varied size + small jitter on spawn position
                      // so it doesn't overlap exactly.  Without the gate
                      // every projectile that dented a rock-tile spawned
                      // a puff, which read as a constant cloud trailing
                      // the player rather than as occasional dust kicks.
                      const baseSize = this.deformedDiameter(target);
                      const jitter = baseSize * 0.15;
                      const puffPos = {
                          x: impactWorldPos.x + (Math.random() - 0.5) * jitter,
                          y: impactWorldPos.y + (Math.random() - 0.5) * jitter,
                      };
                      const comp = randomRockNebulaComposition();
                      this.drops.spawnColoredNebulaShard(
                          this.currentMap.entities,
                          puffPos,
                          baseSize,
                          comp[0].hex,
                          0.45 + Math.random() * 0.2,
                          target.lastImpactVelocity,
                          comp,
                          0.5,
                      );
                  }
              }
              // Intermediate dent-shard spawn (pull-kind variants):
              // when health / maxHealth crosses an entry's threshold,
              // spawn that shard once.  No current variant uses
              // intermediateShards either — also a building block.
              if (dent.intermediateShards && dent.intermediateShards.length > 0) {
                  const maxH = target.maxHealth || 1;
                  // Dent variants take 1 HP per hit (see PhysicsSystem
                  // projectile damage path), regardless of `amount`.
                  const preHealth = target.health + 1;
                  const fractionBefore = preHealth / maxH;
                  const fractionAfter  = target.health / maxH;
                  for (let i = 0; i < dent.intermediateShards.length; i++) {
                      const inter = dent.intermediateShards[i];
                      if (fractionBefore > inter.healthFraction
                          && fractionAfter <= inter.healthFraction) {
                          this.drops.spawnDentShard(this.currentMap.entities, target, [
                              { variant: inter.variant, sizeFraction: inter.sizeFraction },
                          ]);
                      }
                  }
              }
          }
          // Rock base layer — conservation-of-mass chipping.  Independent of
          // the dent block above (rock-shards have no dent policy): every
          // non-killing hit on a rock tile or asteroid chips one piece off
          // (mostly dust, sometimes a solid chunk) and slims a mobile
          // asteroid down so its mass is ~conserved over its life.
          if (impactWorldPos
              && (target.shardVariant === 'rock-tile' || target.shardVariant === 'rock-shard')) {
              this.releaseRockChip(target, impactWorldPos);
          }
      }
  };

  /**
   * Rock base layer — conservation-of-mass per-hit chipping.  Called for
   * every NON-killing hit on a rock entity (tile or asteroid).  The rock
   * cracks (the seeded overlay) and chips one piece off:
   *  - usually pulverised dust — a tinted nebula-shard,
   *  - sometimes (ROCK_CHIP.ROCK_FRACTION) a solid rock-shard chunk.
   * A mobile asteroid then SHRINKS by the chip's footprint (size + mass) so
   * the rock is ~conserved across its life; a static tile can't move off its
   * hex, so it conserves via the in-place dent (applyDentStep).  The killing
   * hit breaks the remainder into multiple pieces via the shatter path.
   */
  private releaseRockChip(parent: GameEntity, impactPos: Vector2): void {
      if (!this.currentMap) return;
      // Perf: most non-killing hits just crack (the overlay) — only some shed
      // a chip entity.  Thins the chip stream that drives render/sim cost.
      if (Math.random() >= ROCK_CHIP.CHIP_CHANCE) return;
      const entities = this.currentMap.entities;
      const diam = this.deformedDiameter(parent);
      // Solid chunks only come off reasonably-sized rock — a tiny shard would
      // shed a useless sliver, so it puffs dust until it breaks.
      const solid = diam >= ROCK_CHIP.SOLID_MIN_PARENT_DIAM
          && Math.random() < ROCK_CHIP.ROCK_FRACTION;
      let chipDiam: number;
      if (solid) {
          // Solid rock-shard chunk flung from the impact point (sized +
          // launched by spawnPerHitShard; it inherits the rock break model).
          chipDiam = diam * ROCK_CHIP.ROCK_SIZE_FRAC;
          this.drops.spawnPerHitShard(
              entities, parent,
              { variant: 'rock-shard', sizeFraction: ROCK_CHIP.ROCK_SIZE_FRAC },
              impactPos,
          );
      } else {
          // Dust is the priciest chip to render (tinted sprite) and it
          // accumulates (no lifetime), so only actually puff some of the
          // time.  No puff this hit → nothing chips (the crack already
          // telegraphed the damage); skip the conservation shrink too.
          if (Math.random() >= ROCK_CHIP.DUST_CHANCE) return;
          // Pulverised dust — a tinted nebula puff drifting off the impact.
          chipDiam = diam * ROCK_CHIP.NEBULA_SIZE_FRAC;
          const jitter = diam * 0.15;
          const puffPos = {
              x: impactPos.x + (Math.random() - 0.5) * jitter,
              y: impactPos.y + (Math.random() - 0.5) * jitter,
          };
          const comp = randomRockNebulaComposition();
          this.drops.spawnColoredNebulaShard(
              entities, puffPos, diam, comp[0].hex,
              ROCK_CHIP.NEBULA_SIZE_FRAC, parent.lastImpactVelocity, comp,
              0.45 + Math.random() * 0.2, true, // fromRock — condenses back to rock-shard
          );
      }
      // Conservation: slim a mobile asteroid by the chip's footprint (dust
      // counts for less — it's mostly vapour).  Static tiles (mass ∞) stay
      // pinned and conserve through the dent instead.
      if (parent.mass !== Infinity && parent.shardVariant === 'rock-shard') {
          const chipArea = solid
              ? chipDiam * chipDiam
              : chipDiam * chipDiam * ROCK_CHIP.NEBULA_MASS_FRAC;
          const parentArea = diam * diam;
          const ratio = Math.sqrt(Math.max(0, 1 - chipArea / parentArea));
          const newDiam = Math.max(ROCK_CHIP.MIN_SHARD_DIAM, diam * ratio);
          const applied = diam > 0 ? newDiam / diam : 1;
          if (applied < 0.999) {
              parent.size.x *= applied;
              parent.size.y *= applied;
              if (parent.polygonPoints) {
                  for (const p of parent.polygonPoints) { p.x *= applied; p.y *= applied; }
              }
              parent.mass *= applied * applied;
              invalidateCollisionR(parent);
          }
      }
  }

  /**
   * Triangle-delete dent step.  Finds the polygon vertex closest to
   * the impact direction (with optional dentVertexAngleOffset),
   * removes it from the tile's polygon — the two adjacent vertices
   * stay, forming a new flat edge where the corner used to be — and
   * spawns a triangle-shaped shard at that corner via
   * DropSystem.spawnTriangleShard.  The polygon stays convex (a
   * convex polygon minus an extreme vertex is still convex), so SAT
   * collision keeps working.
   *
   * Bails when the polygon is too small to safely remove another
   * vertex (< 4 verts left) — the killing hit will trigger
   * breakShards via the normal on-death path.
   */
  /**
   * Effective diameter of a (possibly-deformed) polygon entity.  Same
   * "average vertex radius × 2" proxy DropSystem.spawnDentShard uses
   * to size shards — area ≈ k × r² for a regular polygon so avgR
   * tracks the deformed area linearly.  Falls back to entity.size
   * when the polygon is missing.
   */
  private deformedDiameter(entity: GameEntity): number {
      const baseSize = Math.max(entity.size.x, entity.size.y);
      if (!entity.polygonPoints || entity.polygonPoints.length === 0) return baseSize;
      let sumR2 = 0;
      for (let i = 0; i < entity.polygonPoints.length; i++) {
          const p = entity.polygonPoints[i];
          sumR2 += p.x * p.x + p.y * p.y;
      }
      const avgR = Math.sqrt(sumR2 / entity.polygonPoints.length);
      return avgR * 2;
  }

  private applyTriangleDelete(
      target: GameEntity,
      impactWorldPos: Vector2,
      dent: NonNullable<typeof SHARD_VARIANTS[keyof typeof SHARD_VARIANTS]['dent']>,
  ) {
      const pts = target.polygonPoints;
      if (!pts || pts.length < 4) return;
      if (!this.currentMap) return;

      const N = pts.length;
      const localX = wrapDeltaX(target.position.x, impactWorldPos.x);
      const localY = wrapDeltaY(target.position.y, impactWorldPos.y);
      let dirX = localX, dirY = localY;
      const angleOffset = dent.dentVertexAngleOffset;
      if (angleOffset !== undefined && angleOffset !== 0) {
          const cosA = Math.cos(angleOffset);
          const sinA = Math.sin(angleOffset);
          dirX = localX * cosA - localY * sinA;
          dirY = localX * sinA + localY * cosA;
      }

      let bestIdx = 0;
      let bestD2 = Infinity;
      for (let i = 0; i < N; i++) {
          const dx = pts[i].x - dirX;
          const dy = pts[i].y - dirY;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) {
              bestD2 = d2;
              bestIdx = i;
          }
      }
      const prevIdx = (bestIdx - 1 + N) % N;
      const nextIdx = (bestIdx + 1) % N;

      // Snapshot the triangle BEFORE mutating the array.  Fresh
      // copies of each Vector2 so the spawned shard owns its own
      // vertex objects.
      const trianglePts: Vector2[] = [
          { x: pts[prevIdx].x, y: pts[prevIdx].y },
          { x: pts[bestIdx].x, y: pts[bestIdx].y },
          { x: pts[nextIdx].x, y: pts[nextIdx].y },
      ];

      pts.splice(bestIdx, 1);
      // Renderer's lazy-bake of originalCircumradiusSq used the old
      // vertex set; force a rebake on next render so deformation
      // metrics stay accurate.
      target.originalCircumradiusSq = undefined;

      const childVariant: ShardVariantId =
          dent.breakShards[0]?.variant ?? 'rock-shard';
      this.drops.spawnTriangleShard(
          this.currentMap.entities, target, trianglePts, childVariant,
      );
  }

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
      this.player.statusEffects = [];
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

  private handleShooting(target: Vector2, charged: boolean = false) {
      if (!this.currentMap) return;
      // Weapon offline while EMP-disabled (Stage 3c).
      if (this.player.systemsDisabled) return;

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
          charged,
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
      this.projectiles.updateHoming(this.entityIndex.projectiles, this.entityIndex.enemies, this.player, dt);
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

  private fireLightningChainFromImpact(impactPos: Vector2, firstTarget: GameEntity, proj?: GameEntity) {
      if (!this.currentMap) return;

      // Per-projectile chain overrides (set by ProjectileSystem.spawn from
      // WeaponConfig.chainCount/chainRange/chainBranches — populated by
      // the charged Lightning variant).  Fall back to the global
      // LIGHTNING_CHAIN_* constants for normal shots.
      const hopBudget = proj?.chainCount    ?? LIGHTNING_CHAIN_COUNT;
      const hopRange  = proj?.chainRange    ?? LIGHTNING_CHAIN_RANGE;
      const branches  = proj?.chainBranches ?? LIGHTNING_CHAIN_BRANCHES;
      const hopRangeSq = hopRange * hopRange;

      // Build a branching chain (tree, not list).  Each frontier node forks
      // to up to `branches` nearest unhit targets within `hopRange`.  Damage
      // falls off by depth (preserving the existing 1-d/maxDepth feel from
      // the old linear chain).  hitSet is shared globally so two parents at
      // the same depth never compete for the same child.
      // Phase 4: walk the pre-filtered enemy + asteroid lists instead of the
      // full entity array.  Exploding entities are still skipped since the
      // index holds `active` entities that may be mid-animation.
      const enemies = this.entityIndex.enemies;
      const asteroids = this.entityIndex.asteroids;
      const nodesByDepth: GameEntity[][] = [[firstTarget]];
      const edges: { from: GameEntity; to: GameEntity }[] = [];
      const hitSet = new Set<string>([firstTarget.id]);

      // Reused candidate buffer.  Cleared at the top of each pickNearestK
      // call so repeated picks within a single chain don't pile allocations.
      const candidates: { e: GameEntity; d2: number }[] = [];

      const pickNearestK = (parent: GameEntity, k: number): GameEntity[] => {
          candidates.length = 0;
          for (let i = 0; i < enemies.length; i++) {
              const e = enemies[i];
              if (e.isExploding || hitSet.has(e.id)) continue;
              const dx = wrapDeltaX(parent.position.x, e.position.x);
              const dy = wrapDeltaY(parent.position.y, e.position.y);
              const d2 = dx * dx + dy * dy;
              if (d2 < hopRangeSq) candidates.push({ e, d2 });
          }
          for (let i = 0; i < asteroids.length; i++) {
              const e = asteroids[i];
              if (e.isExploding || hitSet.has(e.id)) continue;
              // Filter inert / dielectric shard variants out of the chain.
              // See LIGHTNING_CHAIN_EXCLUDED_VARIANTS for the table and
              // for the plastic-/metal-shard note (Phase 1 g2).
              if (e.shardVariant && LIGHTNING_CHAIN_EXCLUDED_VARIANTS.has(e.shardVariant)) continue;
              const dx = wrapDeltaX(parent.position.x, e.position.x);
              const dy = wrapDeltaY(parent.position.y, e.position.y);
              const d2 = dx * dx + dy * dy;
              if (d2 < hopRangeSq) candidates.push({ e, d2 });
          }
          candidates.sort((a, b) => a.d2 - b.d2);
          const picked: GameEntity[] = [];
          for (let i = 0; i < candidates.length && picked.length < k; i++) {
              const c = candidates[i];
              if (hitSet.has(c.e.id)) continue; // race-resilient (shouldn't happen — defensive)
              picked.push(c.e);
              hitSet.add(c.e.id);
          }
          return picked;
      };

      for (let depth = 1; depth <= hopBudget; depth++) {
          const prev = nodesByDepth[depth - 1];
          const next: GameEntity[] = [];
          for (let p = 0; p < prev.length; p++) {
              const parent = prev[p];
              const picked = pickNearestK(parent, branches);
              for (let c = 0; c < picked.length; c++) {
                  edges.push({ from: parent, to: picked[c] });
                  next.push(picked[c]);
              }
          }
          if (next.length === 0) break;
          nodesByDepth.push(next);
      }

      // Apply chain damage by depth.  Depth 0 is the direct-hit target
      // (already damaged upstream by the projectile collision).  Damage at
      // depth d = baseDmg * (1 - d/maxDepth) — same falloff curve as the
      // pre-branching linear chain so balance per-target stays consistent.
      const baseDmg = WEAPONS[WeaponType.LIGHTNING].damage;
      const maxDepth = nodesByDepth.length - 1;
      for (let d = 1; d <= maxDepth; d++) {
          const factor = maxDepth > 0 ? Math.max(0, 1 - d / maxDepth) : 1;
          const dmg = baseDmg * factor;
          const tier = nodesByDepth[d];
          for (let i = 0; i < tier.length; i++) {
              const target = tier[i];
              if (dmg <= 0) { target.hitFlash = 0.1; continue; } // visual flash only

              target.health -= dmg;
              target.hitFlash = 0.15;
              target.hitReact = hitReactStrength(dmg, target.maxHealth ?? target.health);
              this.spawnDamageText(target.position, dmg, target);

              if (target.health <= 0 && !target.isExploding) {
                  target.lastImpactDamage = dmg;
                  // Lightning is a player-only weapon — chain kills are
                  // player-attributed for shard/tile scoring.
                  target.killedByPlayer = true;
                  this.handleEntityDeath(target);
              }
          }
      }

      // Only spawn arc visuals if at least one hop landed.
      if (edges.length === 0) return;

      // Spawn one PARTICLE arc entity per edge in the tree.  Each arc is a
      // 2-point polyline (parent.position → child.position).  RenderSystem's
      // existing isLightningArc branch handles the rest.  Cap loosely at
      // MAX_PARTICLES via ParticleSystem's own bookkeeping; a fully-saturated
      // default tree (branches=2, depth=2) produces 6 arcs per impact.
      const arcColor = WEAPONS[WeaponType.LIGHTNING].color;
      for (let i = 0; i < edges.length; i++) {
          const { from, to } = edges[i];
          this.currentMap.entities.push({
              id: nextId('lightning'),
              type: EntityType.PARTICLE,
              position: { x: from.position.x, y: from.position.y },
              velocity: { x: 0, y: 0 },
              size: { x: 1, y: 1 },
              rotation: 0,
              color: arcColor,
              active: true,
              health: 1,
              maxHealth: 1,
              lifetime: LIGHTNING_ARC_LIFETIME,
              maxLifetime: LIGHTNING_ARC_LIFETIME,
              mass: 0,
              isLightningArc: true,
              arcPoints: [
                  { x: from.position.x, y: from.position.y },
                  { x: to.position.x,   y: to.position.y   },
              ],
          });
      }
  }

  // ─── Cannon AoE — radial damage on projectile impact ───────────────────
  //
  // Reused for both normal and charged cannon shots.  The shockwave is now
  // **deferred** — instead of damaging every entity in the radius on the
  // impact frame, this spawns a ring particle whose currentRadius grows
  // from 0 → maxRadius across its lifetime.  updateExplosionRings (called
  // each fixed step from updateGameLogic) ticks the ring and damages
  // entities as the wavefront reaches them.  Direct-hit target is
  // pre-populated into hitEntityIds so it isn't double-damaged (it
  // already took config.damage from the projectile collision upstream).
  // Player is also pre-populated to prevent self-damage.
  // ─── Nest brood spawning (Stage 4) ─────────────────────────────────────
  //
  // Tick each nest's brood timer; when it elapses, birth a batch of brood at
  // the nest (via WaveSystem.spawnAt with counts=false — Stage 2b — so they
  // don't gate wave completion) up to the spawner's maxBrood cap (a hard cap on
  // the self-replicating population).  The O(enemies) brood census only runs on
  // the spawn frame, so the common case is just an O(nests) timer tick.
  private updateNests(dt: number) {
      if (!this.currentMap) return;
      const enemies = this.entityIndex.enemies;
      let ctx: WaveSpawnContext | null = null;
      for (let i = 0; i < enemies.length; i++) {
          const nest = enemies[i];
          if (nest.spawnTimer === undefined || !nest.active || nest.isExploding) continue;
          const spawner = nest.enemySubtype ? ENEMY_VARIANTS[nest.enemySubtype].spawner : undefined;
          if (!spawner) continue;
          nest.spawnTimer -= dt;
          if (nest.spawnTimer > 0) continue;
          nest.spawnTimer = spawner.interval;

          // Hard cap: count live brood of the spawned subtype and stop at maxBrood.
          let brood = 0;
          for (let k = 0; k < enemies.length; k++) {
              const e = enemies[k];
              if (e.enemySubtype === spawner.subtype && e.active && !e.isExploding) brood++;
          }
          const room = spawner.maxBrood - brood;
          if (room <= 0) continue;
          ctx = ctx ?? this.waveContext();
          if (!ctx) continue;
          const n = Math.min(spawner.batch, room);
          for (let b = 0; b < n; b++) this.waves.spawnAt(spawner.subtype, nest.position, ctx, false);
          // Birth puff so the spawn reads.
          this.spawnParticles(nest.position, 8, nest.color || '#0d9488', {
              speedMin: 2, speedMax: 6, sizeMin: 1.5, sizeMax: 3.5,
              lifetimeMin: 0.25, lifetimeMax: 0.55,
          });
      }
  }

  // ─── Bubble engagement pass (Stage 5) ──────────────────────────────────
  //
  // For each BUBBLE enemy: (1) a PASSIVE bubble grown to its multiply.atSize
  // SPLITS — it resets to base size and births one offspring (counts=false),
  // capped at multiply.maxPopulation live bubbles; (2) a PROVOKED bubble LATCHES
  // onto its AGGRO TARGET (the last thing to attack it — the player OR an enemy)
  // on contact — attach (Stage 3c) + drain, and an EMP (disable status) when the
  // target is the player.  Against the player the latch ends in a pop (spent
  // charge); against an enemy it releases and the bubble survives to re-engage.
  // O(enemies) with a one-shot population census only on a split frame; ungated
  // (bubbles are few), matching the kamikaze/nest passes.  Toroidal.
  private updateBubbles(dt: number) {
      if (!this.currentMap) return;
      const p = this.player;
      const enemies = this.entityIndex.enemies;
      const B = BUBBLE_CONSTANTS;
      const baseSize = ENEMY_VARIANTS[EnemySubtype.BUBBLE].size;
      // Terrain-slam window (player smacked a tile/asteroid fast) ticks down here.
      if (p.terrainSlamTimer) p.terrainSlamTimer = Math.max(0, p.terrainSlamTimer - dt);
      let ctx: WaveSpawnContext | null = null;

      for (let i = 0; i < enemies.length; i++) {
          const e = enemies[i];
          if (e.enemySubtype !== EnemySubtype.BUBBLE || !e.active || e.isExploding) continue;
          const cfg = ENEMY_VARIANTS[EnemySubtype.BUBBLE];
          if (e.bubbleFeedTimer) e.bubbleFeedTimer = Math.max(0, e.bubbleFeedTimer - dt); // membrane bulge decay
          if (e.bubbleSickTimer) e.bubbleSickTimer = Math.max(0, e.bubbleSickTimer - dt);
          const sick = (e.bubbleSickTimer ?? 0) > 0;

          // ── Digesting a held shard: tick down, then grow + heal (the eat). The
          // shrinking ghost is drawn inside the membrane by RenderSystem. ──
          if ((e.bubbleDigestTimer ?? 0) > 0) {
              e.bubbleDigestTimer = e.bubbleDigestTimer! - dt;
              if (Math.random() < 0.25) {
                  this.spawnParticles(e.position, 1, e.bubbleDigestColor || '#a8a29e', {
                      speedMin: 0.5, speedMax: 2, sizeMin: 0.8, sizeMax: 1.8,
                      lifetimeMin: 0.2, lifetimeMax: 0.45, positionJitter: Math.max(e.size.x, e.size.y) * 0.3,
                  });
              }
              if (e.bubbleDigestTimer <= 0) {
                  // Recover the richness from the stored per-shard duration.
                  const rich = (e.bubbleDigestDuration ?? B.DIGEST_DURATION) / B.DIGEST_DURATION;
                  this.growConsumer(e, cfg.consume!, rich);
                  this.syncBubbleMaxHealth(e); // maxHP scales with the new size
                  e.bubbleFeedTimer = B.FEED_PULSE; // final gulp bulge
                  e.bubbleDigestTimer = 0;
                  e.bubbleDigestDuration = undefined;
                  e.bubbleDigestColor = undefined;
                  e.bubbleDigestSize0 = undefined;
              }
          }

          // ── Latched: EMP + size-scaled drain; falls off (→ sick) on the timer,
          // a projectile hit, or a player terrain slam.  No longer dies. ──
          if (e.attachedToId !== undefined) {
              const victim = this.resolveAggroTarget(e.attachedToId);
              const onPlayer = e.attachedToId === 'player';
              // Face the target so the membrane squashes against its hull (render).
              e.rotation = Math.atan2(-(e.attachOffset?.y ?? 0), -(e.attachOffset?.x ?? 0));
              if (victim && !victim.isExploding) {
                  if (onPlayer) this.applyStatusEffect(p, { kind: 'disable', duration: B.EMP_REFRESH, dmgPerSec: 0, maxStacks: 1 });
                  const drain = B.LATCH_DPS * (Math.max(e.size.x, e.size.y) / baseSize); // bigger bubble bites harder
                  victim.health -= drain * dt;
                  if (victim.health <= 0 && !victim.isExploding) this.handleEntityDeath(victim);
              }
              e.bubbleLatchTimer = (e.bubbleLatchTimer ?? 0) - dt;
              const shaken = e.bubbleKnockFree === true || (onPlayer && (p.terrainSlamTimer ?? 0) > 0);
              if (e.bubbleLatchTimer <= 0 || shaken || !victim || victim.isExploding) {
                  e.bubbleKnockFree = undefined;
                  this.detachLatch(e); // fall off + go sick + lose aggro (no death)
              }
              continue;
          }

          if (sick) continue; // sluggish + can't hunt/latch/breed (AISystem drifts it)

          // ── Provoked + in contact with the aggro target → latch on ──
          const target = e.aggroTargetId ? this.resolveAggroTarget(e.aggroTargetId) : (e.provoked ? p : null);
          if (target) {
              if (!target.active || target.isExploding) {
                  // Attacker gone → calm down (back to ambient drift / breeding).
                  e.aggroTargetId = undefined;
                  e.provoked = false;
              } else {
                  const tr = Math.max(target.size.x, target.size.y) / 2;
                  const dx = wrapDeltaX(e.position.x, target.position.x);
                  const dy = wrapDeltaY(e.position.y, target.position.y);
                  const reach = tr + Math.max(e.size.x, e.size.y) / 2 + B.CONTACT_PAD;
                  if (dx * dx + dy * dy <= reach * reach) {
                      e.attachedToId = target.id;
                      e.attachOffset = { x: -dx, y: -dy }; // ride where it grabbed
                      e.bubbleLatchTimer = B.LATCH_DURATION;
                      if (target.id === 'player') this.applyStatusEffect(p, { kind: 'disable', duration: B.EMP_REFRESH, dmgPerSec: 0, maxStacks: 1 });
                      this.spawnParticles(target.position, 10, e.color || '#67e8f9', {
                          speedMin: 2, speedMax: 6, sizeMin: 1.5, sizeMax: 3.5,
                          lifetimeMin: 0.2, lifetimeMax: 0.5,
                      });
                  }
                  continue; // a provoked bubble doesn't breed
              }
          }

          // ── Passive + fat enough → split into two base-size bubbles ──
          // (not while digesting a meal).
          const mult = cfg.multiply;
          if (mult && (e.bubbleDigestTimer ?? 0) <= 0 && Math.max(e.size.x, e.size.y) >= mult.atSize) {
              let pop = 0;
              for (let k = 0; k < enemies.length; k++) {
                  const o = enemies[k];
                  if (o.enemySubtype === EnemySubtype.BUBBLE && o.active && !o.isExploding) pop++;
              }
              if (pop >= mult.maxPopulation) continue;
              ctx = ctx ?? this.waveContext();
              if (!ctx) continue;
              const base = cfg.size;
              e.size.x = base; e.size.y = base;
              this.syncBubbleMaxHealth(e); // back to base maxHP after shedding mass
              const a = Math.random() * Math.PI * 2;
              e.velocity.x += Math.cos(a) * B.SPLIT_SPEED;
              e.velocity.y += Math.sin(a) * B.SPLIT_SPEED;
              const child = this.waves.spawnAt(EnemySubtype.BUBBLE, e.position, ctx, false);
              child.velocity.x = -Math.cos(a) * B.SPLIT_SPEED;
              child.velocity.y = -Math.sin(a) * B.SPLIT_SPEED;
              this.spawnParticles(e.position, 8, e.color || '#67e8f9', {
                  speedMin: 2, speedMax: 6, sizeMin: 1.5, sizeMax: 3,
                  lifetimeMin: 0.2, lifetimeMax: 0.5,
              });
          }
      }
  }

  /** Resolve a bubble's aggro/latch target id to a live entity — the player
   *  ('player') or an active enemy by id — or null if it's gone.  Cheap: the
   *  player is special-cased and enemies come from the small filtered index. */
  private resolveAggroTarget(id: string): GameEntity | null {
      if (id === 'player') return this.player;
      const enemies = this.entityIndex.enemies;
      for (let i = 0; i < enemies.length; i++) {
          if (enemies[i].id === id) return enemies[i].active ? enemies[i] : null;
      }
      return null;
  }

  /** Break a bubble's latch: it falls off, goes SICK (sluggish + can't eat),
   *  and loses aggro — it does NOT die (shoot it while sick for the kill). */
  private detachLatch(e: GameEntity) {
      e.attachedToId = undefined;
      e.attachOffset = undefined;
      e.bubbleLatchTimer = 0;
      e.bubbleSickTimer = BUBBLE_CONSTANTS.SICK_DURATION;
      e.aggroTargetId = undefined;
      e.provoked = false; // calm down after the bite
      this.spawnParticles(e.position, 12, BUBBLE_CONSTANTS.SICK_COLOR, {
          speedMin: 2, speedMax: 7, sizeMin: 1.5, sizeMax: 3.2,
          lifetimeMin: 0.2, lifetimeMax: 0.55,
      });
  }

  /** Richness of a shard for mass/energy-conserved eating (shardRichness):
   *  denser/bigger shards score higher → longer digest + more growth/health.
   *  Clamped to BUBBLE_CONSTANTS.RICH_MIN..RICH_MAX. */
  private shardRichness(shard: GameEntity): number {
      const sizeR = Math.max(shard.size.x, shard.size.y) / 26; // ≈ a baseline shard
      let dens = 1;
      switch (shard.shardVariant) {
          case 'metal-shard':   dens = 1.7;  break;
          case 'rock-shard':    dens = 1.35; break;
          case 'glass-shard':   dens = 0.9;  break;
          case 'plastic-shard': dens = 0.9;  break;
          case 'nebula-shard':  dens = 0.8;  break;
      }
      return Math.max(BUBBLE_CONSTANTS.RICH_MIN, Math.min(BUBBLE_CONSTANTS.RICH_MAX, sizeR * dens));
    }

  /** Toxic shards make the bubble sick on eating: plastic, or a GREEN nebula
   *  shard (green-dominant blended colour). */
  private isToxicShard(shard: GameEntity): boolean {
      if (shard.shardVariant === 'plastic-shard') return true;
      if (shard.shardVariant === 'nebula-shard') {
          const hex = shard.nebulaBlendedHex || shard.color || '';
          if (hex.length >= 7) {
              const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
              return g > r * 1.1 && g > b * 1.1 && g > 90; // green-dominant
          }
      }
      return false;
  }

  // ─── Ambient bubble population (Stage 5) ───────────────────────────────
  //
  // Bubbles are always-present fauna, not wave enemies — keep at least
  // BUBBLE_CONSTANTS.AMBIENT_POPULATION alive at all times by topping up
  // offscreen on a timer while the field is short (breeding can carry the count
  // higher on its own).  Skipped while a DIFFERENT enemy is force-selected in
  // the DBG enemy-test so that isolation stays clean.  O(enemies) census.
  private maintainAmbientBubbles(dt: number) {
      if (!this.currentMap || this.gameState !== GameState.PLAYING) return;
      // A DBG enemy-test forcing a single type suppresses the ambient fauna so
      // that type is seen in isolation.
      if (this.forcedTestEnemy) return;

      let count = 0;
      const enemies = this.entityIndex.enemies;
      for (let i = 0; i < enemies.length; i++) {
          const e = enemies[i];
          if (e.enemySubtype === EnemySubtype.BUBBLE && e.active && !e.isExploding) count++;
      }
      if (count >= BUBBLE_CONSTANTS.AMBIENT_POPULATION) {
          this.ambientBubbleTimer = BUBBLE_CONSTANTS.AMBIENT_RESPAWN_INTERVAL;
          return;
      }
      this.ambientBubbleTimer -= dt;
      if (this.ambientBubbleTimer > 0) return;
      this.ambientBubbleTimer = BUBBLE_CONSTANTS.AMBIENT_RESPAWN_INTERVAL;
      this.spawnAmbientBubble();
  }

  /** Seed the ambient bubble population in one shot (called on entering play so
   *  the fauna is present from the first frame, not trickled in). */
  private seedAmbientBubbles() {
      if (!this.currentMap || this.forcedTestEnemy) return;
      for (let i = 0; i < BUBBLE_CONSTANTS.AMBIENT_POPULATION; i++) this.spawnAmbientBubble();
      this.ambientBubbleTimer = BUBBLE_CONSTANTS.AMBIENT_RESPAWN_INTERVAL;
  }

  /** Spawn one ambient bubble just outside the viewport (so it drifts in rather
   *  than popping into view).  counts=false + the `ambient` variant flag keep it
   *  out of wave accounting. */
  private spawnAmbientBubble(): GameEntity | null {
      const ctx = this.waveContext();
      if (!ctx) return null;
      const zoom = this.camera.zoom || 1;
      const halfDiag = Math.hypot((window.innerWidth / 2) / zoom, (window.innerHeight / 2) / zoom);
      const angle = Math.random() * Math.PI * 2;
      const dist = halfDiag + BUBBLE_CONSTANTS.SPAWN_MARGIN + Math.random() * 240;
      const pos = {
          x: this.player.position.x + Math.cos(angle) * dist,
          y: this.player.position.y + Math.sin(angle) * dist,
      };
      wrapPosition(pos);
      return this.waves.spawnAt(EnemySubtype.BUBBLE, pos, ctx, false);
  }

  // ─── Kamikaze proximity fuse ───────────────────────────────────────────
  //
  // Each step, detonate any bomber (explosionRadius stamped) that has closed
  // inside (player half-size + bomber half-size + KAMIKAZE_DETONATE_BUFFER) of
  // the player, so the blast goes off a hair BEFORE the hulls touch rather than
  // on overlap.  O(enemies); no PerfController gate (matches the AI pass).  The
  // on-contact detonation in PhysicsSystem remains as a fallback.
  private updateKamikazeProximity() {
      const p = this.player;
      if (p.isExploding) return;
      const enemies = this.entityIndex.enemies;
      const pr = Math.max(p.size.x, p.size.y) / 2;
      for (let i = 0; i < enemies.length; i++) {
          const e = enemies[i];
          if (e.explosionRadius === undefined || e.isExploding) continue;
          const dx = wrapDeltaX(e.position.x, p.position.x);
          const dy = wrapDeltaY(e.position.y, p.position.y);
          const trigger = pr + Math.max(e.size.x, e.size.y) / 2 + KAMIKAZE_DETONATE_BUFFER;
          if (dx * dx + dy * dy <= trigger * trigger) {
              e.detonateOnDeath = true;
              this.handleEntityDeath(e);
          }
      }
  }

  // ─── Attach pass (Stage 3c) ────────────────────────────────────────────
  //
  // Snap every attached entity onto its target each frame (a latch / grapple).
  // Runs in updateGameLogic AFTER physics so it tracks the target's post-move
  // position.  If the target is gone (dead / inactive / missing) the attachment
  // releases.  Iterates the (small) enemies index — the only attachers today
  // are enemies (the bubble grappling the player); revisit if a non-enemy ever
  // needs to attach.
  private updateAttachments() {
      const ents = this.entityIndex.enemies;
      for (let i = 0; i < ents.length; i++) {
          const e = ents[i];
          if (!e.active || e.attachedToId === undefined) continue;
          // Attachment targets are the player or an enemy (the bubble latch), so
          // resolve through the player special-case + the small enemies index
          // rather than a full O(all-entities) master-list scan.
          const target = this.resolveAggroTarget(e.attachedToId);
          if (!target || !target.active || target.isExploding) {
              e.attachedToId = undefined;
              continue;
          }
          e.position.x = target.position.x + (e.attachOffset?.x ?? 0);
          e.position.y = target.position.y + (e.attachOffset?.y ?? 0);
          wrapPosition(e.position);
          e.velocity.x = target.velocity.x;
          e.velocity.y = target.velocity.y;
      }
  }

  // ─── Consume-and-grow pass (Stage 3b) ──────────────────────────────────
  //
  // For each consumer (an entity carrying a `consume` config — the bubble; the
  // dragon later), two-phase feeding within the SENSE radius (`cfg.range`):
  // mobile candidates outside membrane contact are PULLED inward (a suck-in tug,
  // `cfg.pull`), and a candidate that has reached MEMBRANE CONTACT (radii
  // overlap) is SWALLOWED — grow + animate (consumeEntity).  This replaces the
  // old eat-on-sight-at-range so shards visibly stream in and pop on contact
  // instead of vanishing from afar.  PerfController-gated ('consume');
  // torus-correct.  Growth is capped at `cfg.maxSize`; the self-replication
  // entity cap lives at the child-spawn site (updateBubbles, Stage 5).
  private updateConsumers(dt: number) {
      if (!this.currentMap) return;
      const enemies = this.entityIndex.enemies;
      // Candidates: mobile shards (asteroids index) and/or static tiles.
      const shards = this.entityIndex.asteroids;
      for (let c = 0; c < enemies.length; c++) {
          const consumer = enemies[c];
          const cfg = consumer.consume;
          if (!cfg || !consumer.active || consumer.isExploding) continue;
          // Only a calm, idle bubble feeds: a hunting (provoked), latched,
          // digesting, or SICK bubble doesn't pull or capture shards.
          if ((consumer.bubbleDigestTimer ?? 0) > 0 || consumer.attachedToId !== undefined
              || consumer.provoked || (consumer.bubbleSickTimer ?? 0) > 0) continue;
          const rangeSq = cfg.range * cfg.range;
          const consumerR = Math.max(consumer.size.x, consumer.size.y) * 0.6; // membrane radius
          for (let k = 0; k < shards.length; k++) {
              const cand = shards[k];
              if (!cand.active || cand.isExploding) continue;
              const wantTile = cfg.eats === 'tile';
              const isTile = cand.mass === Infinity;
              if (wantTile !== isTile) continue;
              const dx = wrapDeltaX(consumer.position.x, cand.position.x); // consumer→cand
              const dy = wrapDeltaY(consumer.position.y, cand.position.y);
              const d2 = dx * dx + dy * dy;
              if (d2 > rangeSq) continue;
              const candR = Math.max(cand.size.x, cand.size.y) * 0.5;
              const contact = consumerR + candR;
              if (d2 <= contact * contact) {
                  // SWALLOW on membrane contact.  Mobile shards are engulfed and
                  // DIGESTED over time (held inside the bubble); static tiles
                  // (the future dragon) are eaten instantly.
                  if (isTile) this.consumeTile(consumer, cand, cfg, dx, dy);
                  else { this.beginDigest(consumer, cand, dx, dy); break; }
              } else if (!isTile && cfg.pull) {
                  // Suck-in: tug the mobile shard toward the membrane, stronger
                  // the closer it is (so a near shard accelerates into the mouth).
                  const d = Math.sqrt(d2) || 1;
                  const prox = 1 - d / cfg.range;          // 0 at the rim → 1 at contact
                  const a = cfg.pull * (0.3 + 0.7 * prox) * dt;
                  cand.velocity.x -= (dx / d) * a;
                  cand.velocity.y -= (dy / d) * a;
              }
          }
      }
  }

  /** Grow a consumer by one eat (size + heal + optional mass), scaled by `scale`
   *  (the shard's richness — mass/energy conserved), capped at maxSize.  Shared
   *  by the shard-digest finish + the instant tile eat.  (The bubble's maxHealth
   *  is recomputed from its new size by syncBubbleMaxHealth, called after.) */
  private growConsumer(consumer: GameEntity, cfg: ConsumeConfig, scale: number = 1) {
      const cur = Math.max(consumer.size.x, consumer.size.y);
      if (cur < cfg.maxSize) {
          const grown = Math.min(cfg.maxSize, cur + cfg.growthPerEat * scale);
          const s = grown / (cur || 1);
          consumer.size.x *= s;
          consumer.size.y *= s;
      }
      // Heal from eating (a denser meal heals more) — caps at the current maxHP;
      // size-driven maxHP growth is applied by syncBubbleMaxHealth afterwards.
      consumer.health = Math.min(consumer.maxHealth, consumer.health + BUBBLE_CONSTANTS.HEAL_PER_RICH * scale);
      if (cfg.massPerEat && consumer.mass !== Infinity) consumer.mass += cfg.massPerEat * scale;
  }

  /** Keep a bubble's maxHealth LINEAR with its size (anchored at the variant's
   *  base health @ base size).  Growing raises the ceiling AND fills the new HP
   *  (mass conserved); shrinking on a split caps current HP to the new ceiling. */
  private syncBubbleMaxHealth(e: GameEntity) {
      const v = ENEMY_VARIANTS[EnemySubtype.BUBBLE];
      const newMax = v.health * (Math.max(e.size.x, e.size.y) / v.size);
      const delta = newMax - e.maxHealth;
      e.maxHealth = newMax;
      e.health = delta > 0 ? Math.min(newMax, e.health + delta) : Math.min(e.health, newMax);
  }

  /** Begin digesting a mobile shard: snapshot its look onto the bubble, swallow
   *  it (deactivate), and spray a brief inward implosion.  Digest TIME scales
   *  with the shard's richness (denser = slower), stored on the bubble so the
   *  finish (updateBubbles) recovers the same richness for the heal/grow.  A
   *  TOXIC shard (plastic / green-nebula) also makes the bubble sick.  The bubble
   *  renders the shard as a shrinking ghost INSIDE its membrane until done.
   *  `dx/dy` is consumer→shard. */
  private beginDigest(consumer: GameEntity, shard: GameEntity, dx: number, dy: number) {
      const rich = this.shardRichness(shard);
      const dur = BUBBLE_CONSTANTS.DIGEST_DURATION * rich;
      consumer.bubbleDigestTimer = dur;
      consumer.bubbleDigestDuration = dur;
      consumer.bubbleDigestColor = shard.color || '#a8a29e';
      consumer.bubbleDigestSize0 = Math.max(shard.size.x, shard.size.y);
      consumer.bubbleFeedTimer = BUBBLE_CONSTANTS.FEED_PULSE;
      if (this.isToxicShard(shard)) consumer.bubbleSickTimer = BUBBLE_CONSTANTS.SICK_DURATION;
      const inward = Math.atan2(-dy, -dx); // shard → bubble
      this.spawnParticles(shard.position, 8, consumer.bubbleDigestColor, {
          spreadAngle: inward, spreadCone: 0.8,
          speedMin: 2.5, speedMax: 6, sizeMin: 1, sizeMax: 2.4,
          lifetimeMin: 0.1, lifetimeMax: 0.26,
      });
      shard.active = false; // swallowed (no score/regen — it's eaten, not destroyed)
  }

  /** Instant tile eat (the future dragon): grow + route the tile through the
   *  death/flow-field patch + an inward implosion.  `dx/dy` is consumer→tile. */
  private consumeTile(consumer: GameEntity, tile: GameEntity, cfg: ConsumeConfig, dx: number, dy: number) {
      this.growConsumer(consumer, cfg);
      const inward = Math.atan2(-dy, -dx);
      this.spawnParticles(tile.position, 9, tile.color || '#a8a29e', {
          spreadAngle: inward, spreadCone: 0.9,
          speedMin: 2.5, speedMax: 6.5, sizeMin: 1, sizeMax: 2.6,
          lifetimeMin: 0.12, lifetimeMax: 0.3,
      });
      consumer.bubbleFeedTimer = BUBBLE_CONSTANTS.FEED_PULSE;
      this.physics.removeStaticEntity(tile);
      this.flowField.onTileDestroyed(tile.position.x, tile.position.y);
      tile.active = false;
  }

  // ─── Kamikaze blast → player (direct, instant) ─────────────────────────
  //
  // Applied at detonation (handleEntityDeath) so the launch + damage land the
  // same frame at the contact point, independent of the expanding ring (which
  // only sweeps collateral onto other entities).  Damage is shield-respecting;
  // the knockback drives the player past the speed cap via `overSpeedAllow` so
  // it reads as a real shove (the hard cap would otherwise eat it).  Falloff
  // floors at 0.3 so a point-blank bomber always throws you.
  private applyKamikazeBlastToPlayer(bomb: GameEntity) {
      const p = this.player;
      if (p.isExploding) return;
      const radius = bomb.explosionRadius ?? 0;
      if (radius <= 0) return;
      const dx = wrapDeltaX(bomb.position.x, p.position.x);
      const dy = wrapDeltaY(bomb.position.y, p.position.y);
      const dist = Math.hypot(dx, dy);
      if (dist > radius) return;
      const falloff = Math.max(0.3, 1 - dist / radius);

      // Damage (shield first, then hull) — mirrors the projectile/ram paths.
      let dmg = (bomb.explosionDamage ?? 0) * falloff;
      if ((p.shield ?? 0) > 0) {
          const absorbed = Math.min(p.shield!, dmg);
          p.shield! -= absorbed;
          dmg -= absorbed;
          p.shieldHitFlash = SHIELD_CONSTANTS.HIT_FLASH_DURATION;
          p.shieldRechargeTimer = SHIELD_CONSTANTS.RECHARGE_DELAY;
      }
      if (dmg > 0) {
          p.health -= dmg;
          this.spawnDamageText(p.position, dmg, p);
      }
      p.hitFlash = 0.2;

      // Launch: shove along the bomb→player vector (away from the blast) and
      // raise the overshoot allowance so the cap doesn't clamp the impulse.
      const k = (bomb.explosionKnockback ?? 0) * falloff;
      let nx: number, ny: number;
      if (dist > 0.001) { nx = dx / dist; ny = dy / dist; }
      else { const a = Math.random() * Math.PI * 2; nx = Math.cos(a); ny = Math.sin(a); }
      p.velocity.x += nx * k;
      p.velocity.y += ny * k;
      p.overSpeedAllow = Math.max(p.overSpeedAllow ?? 0, Math.hypot(p.velocity.x, p.velocity.y));

      if (p.health <= 0 && !p.isExploding) this.handleEntityDeath(p);
  }

  private applyExplosionAoE(impactPos: Vector2, proj: GameEntity, directTarget: GameEntity) {      if (!this.currentMap) return;

      // Impact-frame visuals (instant): bright spark burst + screen shake.
      // These don't wait for the wavefront — the player should feel the
      // hit immediately while the ring continues outward.
      this.spawnParticles(impactPos, 14, '#fb923c', {
          speedMin: 4, speedMax: 11, sizeMin: 1.5, sizeMax: 3,
      });
      this.spawnParticles(impactPos, 6, '#ffffff', {
          speedMin: 6, speedMax: 14, sizeMin: 0.5, sizeMax: 1.5,
      });
      this.handleScreenShake(COLLISION_CONFIG.SHAKE.MEDIUM);

      // Spawn the damaging shockwave ring.  Direct-hit target is excluded
      // (it already took config.damage from the projectile collision) along
      // with the player (cannon is player-owned; the ring shouldn't
      // self-damage).
      this.spawnShockwave(impactPos, {
          radius: proj.explosionRadius!,
          damage: proj.explosionDamage ?? 0,
          knockback: proj.explosionKnockback ?? 0,
          color: WEAPONS[WeaponType.CANNON].color,
          ownerType: proj.ownerType,
          ownerId: proj.ownerId, // a caught bubble blames the shooter (Stage 5)
          excludeIds: [directTarget.id, 'player'],
      });
  }

  // ─── Reusable expanding shockwave ──────────────────────────────────────
  //
  // Spawns an `isExplosionRing` particle whose currentRadius grows 0 →
  // radius across `lifetime`.  updateExplosionRings (each fixed step) ticks
  // it, applying falloff damage + knockback to entities the wavefront
  // reaches.  Powers both the Plasma Cannon AoE and the smaller shard→tile
  // merge blow-back.  Only entities in range AT SPAWN are eligible
  // (validHitIds snapshot), so entities born during the sweep are excluded.
  private spawnShockwave(pos: Vector2, opts: {
      radius: number;
      damage: number;
      knockback: number;
      color: string;
      lifetime?: number;
      ownerType?: GameEntity['ownerType'];
      ownerId?: string;
      excludeIds?: string[];
  }) {
      if (!this.currentMap) return;
      const radius = opts.radius;
      if (!radius || radius <= 0) return;
      const radiusSq = radius * radius;

      // Cosmetic rings (the portal warp: damage 0 + knockback 0) never apply
      // anything, so the in-range snapshot is pure waste — updateExplosionRings
      // early-outs on an empty validHitIds set and the renderer draws the ring
      // from its radius/lifetime alone.  Skip the O(all-entities) scan + Set
      // work for them: a spawn burst (e.g. 10 dragon portals × 3 rings each)
      // used to walk the whole map per ring on the single spawn frame, which
      // is the bulk of the "spawn-burst hitch".  Damaging rings (cannon AoE,
      // kamikaze, merge blow-back) still snapshot exactly as before.
      const validHitIds = new Set<string>();
      const ents = this.currentMap.entities;
      const cosmeticRing = opts.damage <= 0 && opts.knockback <= 0;
      if (!cosmeticRing) {
          for (let i = 0; i < ents.length; i++) {
              const e = ents[i];
              if (!e.active || e.isExploding) continue;
              if (e.type === EntityType.PROJECTILE) continue;
              if (e.type === EntityType.PARTICLE) continue;
              if (e.type === EntityType.INTERACTABLE) continue;
              const dx = wrapDeltaX(pos.x, e.position.x);
              const dy = wrapDeltaY(pos.y, e.position.y);
              if (dx * dx + dy * dy <= radiusSq) validHitIds.add(e.id);
          }
      }

      const lifetime = opts.lifetime ?? 0.35;
      ents.push({
          id: nextId('explosion-ring'),
          type: EntityType.PARTICLE,
          position: { x: pos.x, y: pos.y },
          velocity: { x: 0, y: 0 },
          size: { x: 1, y: 1 },
          rotation: 0,
          color: opts.color,
          active: true,
          health: 1,
          maxHealth: 1,
          lifetime,
          maxLifetime: lifetime,
          mass: 0,
          isExplosionRing: true,
          explosionRadius: radius,
          explosionDamage: opts.damage,
          explosionKnockback: opts.knockback,
          ownerType: opts.ownerType,
          ownerId: opts.ownerId,
          hitEntityIds: opts.excludeIds ? [...opts.excludeIds] : [],
          validHitIds,
      });
  }

  // ─── Cannon AoE — per-frame shockwave tick ─────────────────────────────
  //
  // Walks isExplosionRing particles each fixed step.  For each, computes
  // currentRadius via the same `1 − lifetime/maxLifetime` formula the
  // renderer uses (so the damage front is always pixel-aligned with the
  // visible ring).  Then walks the master entity list once, damaging /
  // knocking back any entity whose current toroidal distance falls
  // within currentRadius and that hasn't been hit yet.  hitEntityIds
  // grows monotonically to prevent double-hits as the wave widens.
  private updateExplosionRings() {
      if (!this.currentMap) return;
      const entities = this.currentMap.entities;

      for (let r = 0; r < entities.length; r++) {
          const ring = entities[r];
          if (!ring.active || !ring.isExplosionRing) continue;

          const maxRadius = ring.explosionRadius;
          if (!maxRadius || maxRadius <= 0) continue;

          const life = ring.lifetime ?? 0;
          const maxLife = ring.maxLifetime ?? 1;
          const expand = Math.max(0, Math.min(1, 1 - life / maxLife));
          const currentRadius = maxRadius * expand;
          if (currentRadius <= 0) continue;

          const currentR2 = currentRadius * currentRadius;
          const dmg   = ring.explosionDamage ?? 0;
          const knock = ring.explosionKnockback ?? 0;
          const hits  = ring.hitEntityIds ?? (ring.hitEntityIds = []);

          // Only candidates that were in range AT SPAWN are eligible —
          // entities born during the sweep (e.g. glass-shards from tiles
          // the wave just shattered) are excluded.
          const valid = ring.validHitIds;
          if (!valid || valid.size === 0) continue;

          for (let i = 0; i < entities.length; i++) {
              const e = entities[i];
              if (!e.active || e.isExploding) continue;
              if (!valid.has(e.id)) continue;
              if (hits.includes(e.id)) continue;

              const dx = wrapDeltaX(ring.position.x, e.position.x);
              const dy = wrapDeltaY(ring.position.y, e.position.y);
              const d2 = dx * dx + dy * dy;
              if (d2 > currentR2) continue;

              hits.push(e.id);
              const dist = Math.sqrt(d2);
              const falloff = 1 - (dist / maxRadius); // 1 at centre, 0 at rim

              if (dmg > 0) {
                  let applied = dmg * falloff;
                  const isIndestructible = e.type === EntityType.STRUCTURE && e.shardVariant === 'indestructible-tile';
                  // Player shield soaks the blast first (kamikaze AoE and any
                  // future enemy-owned explosion) so an AoE hit isn't a raw
                  // shield-bypass — mirrors the projectile / ram absorption.
                  if (e.id === 'player' && (e.shield ?? 0) > 0 && !e.systemsDisabled) {
                      const absorbed = Math.min(e.shield!, applied);
                      e.shield! -= absorbed;
                      applied -= absorbed;
                      e.shieldHitFlash = SHIELD_CONSTANTS.HIT_FLASH_DURATION;
                      e.shieldRechargeTimer = SHIELD_CONSTANTS.RECHARGE_DELAY;
                  }
                  if (!isIndestructible) e.health -= applied;
                  if (e.type === EntityType.ENEMY) e.provoked = true; // Stage 3a
                  // Third-party retaliation (Stage 5): an AoE that catches a
                  // bubble makes it target the blast's owner.
                  if (e.thirdParty && ring.ownerId) e.aggroTargetId = ring.ownerId;
                  e.hitFlash = 0.12;
                  e.hitReact = hitReactStrength(applied, e.maxHealth ?? e.health);
                  this.spawnDamageText(e.position, applied, e);
                  if (e.health <= 0 && !e.isExploding) {
                      e.lastImpactDamage = applied;
                      if (ring.ownerType === EntityType.PLAYER) e.killedByPlayer = true;
                      if (e.type === EntityType.STRUCTURE && dist > 0) {
                          e.lastImpactVelocity = { x: (dx / dist) * 8, y: (dy / dist) * 8 };
                      }
                      if (e.type === EntityType.STRUCTURE && e.mass === Infinity) {
                          this.physics.removeStaticEntity(e);
                      }
                      this.handleEntityDeath(e);
                      e.active = false;
                  }
              }

              if (knock > 0 && e.mass !== Infinity && dist > 0) {
                  const k = knock * falloff;
                  e.velocity.x += (dx / dist) * k;
                  e.velocity.y += (dy / dist) * k;
                  // Let the player overshoot the speed cap so the blast actually
                  // launches them; the overshoot decays in updatePlayerMovement.
                  if (e.id === 'player') {
                      const sp = Math.hypot(e.velocity.x, e.velocity.y);
                      e.overSpeedAllow = Math.max(e.overSpeedAllow ?? 0, sp);
                  }
              }
          }
      }
  }

  // createAsteroidShards moved to ShardSystem.shatter in Stage 3 of
  // the shard-system overhaul.  See engine/systems/ShardSystem.ts.

  // --- WAVE SYSTEM ---

  /** Build the per-call spawn context that WaveSystem needs.  Kept as a
   *  tiny helper so every wave entry point (init / update tick / skip)
   *  goes through the same factory. */
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
      forcedEnemy: this.forcedTestEnemy,
    };
  }

  /** DBG: force every wave to spawn only `subtype` (or clear with null).
   *  Applies from the next wave; persists across map switches. */
  public setForcedTestEnemy(subtype: string | null) {
    this.forcedTestEnemy = (subtype && subtype in EnemySubtype)
      ? (subtype as EnemySubtype) : null;
  }

  /** Shared wave-completion hook — fires once per wave end on every path
   *  (time-up, early clear, snitch catch).  Pays the early-clear bonus,
   *  retires any uncaught snitch, and drops the milestone health pickup. */
  private handleWaveCleared = (clearedIndex: number, elapsedSec: number, bySnitch: boolean = false) => {
    // Completion bonus: flat base + speed-graded bonus from the wave timer.
    // Par = the wave's spawn-stream window; clearing at/under par pays the
    // full speed bonus, decaying to 0 by 2× par.
    const waveNum = clearedIndex + 1;
    const par = Math.max(1, getWaveDurationSec(clearedIndex));
    const speedFrac = Math.max(0, Math.min(1, 1 - Math.max(0, elapsedSec - par) / par));
    const bonus = SCORE_CONSTANTS.WAVE_COMPLETE_BASE
        + Math.round(SCORE_CONSTANTS.EARLY_CLEAR_BONUS_PER_WAVE * waveNum * speedFrac);
    this.awardScore(bonus, this.player.position);

    // Wave-clear celebration — gold for a snitch catch, green for a
    // clear-the-field win.  Plays before the card modal (see the delay).
    this.playWaveClearCelebration(bySnitch);
    // The snitch is wave bookkeeping only in that it pays out + ends the
    // wave on catch; the entity itself persists across wave boundaries
    // (it is never despawned at a wave end), so don't touch it here.
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

    // Between-wave upgrade card offer — every `cardWaveInterval` waves.
    // Deferred by CARD_OPEN_DELAY_SEC so the celebration plays first; the
    // tick in updateGameLogic opens the (sim-pausing) modal when it fires.
    if ((clearedIndex + 1) % this.cardWaveInterval === 0) {
      this.pendingCardWaveNum = clearedIndex + 1;
      this.cardOpenDelaySec = UPGRADE_CARD_CONSTANTS.CARD_OPEN_DELAY_SEC;
    }
  };

  /** Wave-clear celebration FX: two expanding shockwave rings (visual
   *  only — 0 damage/knockback), a colour-themed particle burst, and a
   *  camera punch.  Gold for a snitch catch, green for a clear-all win. */
  private playWaveClearCelebration(bySnitch: boolean) {
    if (!this.currentMap) return;
    const pos = this.player.position;
    const color = bySnitch ? '#fde047' : '#4ade80';
    this.spawnShockwave(pos, { radius: 540, damage: 0, knockback: 0, color, lifetime: 0.7 });
    this.spawnShockwave(pos, { radius: 320, damage: 0, knockback: 0, color: '#ffffff', lifetime: 0.5 });
    this.spawnParticles(pos, 64, color, {
      speedMin: 3, speedMax: 9, sizeMin: 1.5, sizeMax: 3.5,
      lifetimeMin: 0.5, lifetimeMax: 1.1,
    });
    this.spawnParticles(pos, 24, '#ffffff', {
      speedMin: 2, speedMax: 6, sizeMin: 1, sizeMax: 2.5,
      lifetimeMin: 0.4, lifetimeMax: 0.8,
    });
    this.handleScreenShake(COLLISION_CONFIG.SHAKE.MEDIUM);
  }

  // ── Between-wave upgrade cards ──────────────────────────────────────────

  /** Build the card set for the wave that just cleared and pause for the
   *  player's pick.  Pool = stat-upgrade cards (a free level of a not-maxed
   *  upgrade) + occasional Salvage cards; all-maxed falls back to Salvage. */
  private openCardChoice(waveNumber: number) {
    const { CARD_COUNT, SALVAGE_CARD_CHANCE, SALVAGE_CARD_BASE, SALVAGE_CARD_PER_WAVE } = UPGRADE_CARD_CONSTANTS;
    const salvageCard = (): UpgradeCard => {
      const amount = SALVAGE_CARD_BASE + SALVAGE_CARD_PER_WAVE * waveNumber;
      return { kind: 'salvage', label: 'Salvage Cache', desc: `+${amount} Salvage`, amount, rarity: 'common' };
    };
    // Offer only AUGMENTS whose dependency MODULE is installed — never a
    // card for a system the player can't use yet (e.g. shield Plating /
    // Capacitor before the Shield module, or Magazine with only the
    // ammo-free Blaster).  Levels are uncapped, so all eligible stay offerable.
    const pool = UPGRADE_DEFS.filter(d => this.augmentEligible(d));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    // Every Nth wave the stat cards are "powerful" — each grants a random
    // 2–4 levels at once (and renders with the rare accent).
    const { POWERFUL_WAVE_INTERVAL, POWERFUL_MIN_LEVELS, POWERFUL_MAX_LEVELS } = UPGRADE_CARD_CONSTANTS;
    const powerful = waveNumber % POWERFUL_WAVE_INTERVAL === 0;
    const cards: UpgradeCard[] = [];
    for (let i = 0; i < CARD_COUNT; i++) {
      const def = pool[i];
      if (def) {
        const levels = powerful
          ? POWERFUL_MIN_LEVELS + ((Math.random() * (POWERFUL_MAX_LEVELS - POWERFUL_MIN_LEVELS + 1)) | 0)
          : 1;
        const next = this.upgradeLevels[def.id] + levels;
        const tag = levels > 1 ? ` ×${levels}` : '';
        cards.push({
          kind: 'stat', label: def.label, desc: `${def.desc}${tag}  (→ Lv ${next})`,
          id: def.id, levels, rarity: powerful ? 'rare' : 'common',
        });
      } else {
        cards.push(salvageCard());
      }
    }
    // Chance to swap one stat card for a Salvage card for variety.
    if (cards.length === CARD_COUNT && cards.some(c => c.kind === 'stat') && Math.random() < SALVAGE_CARD_CHANCE) {
      const statIdxs = cards.map((c, i) => c.kind === 'stat' ? i : -1).filter(i => i >= 0);
      cards[statIdxs[(Math.random() * statIdxs.length) | 0]] = salvageCard();
    }
    // Rarely, offer a FREE unlock card (if anything's still unowned).
    const notOwned = UNLOCK_DEFS.filter(d => !this.isUnlockOwned(d));
    if (notOwned.length > 0 && Math.random() < UPGRADE_CARD_CONSTANTS.UNLOCK_CARD_CHANCE) {
      const u = notOwned[(Math.random() * notOwned.length) | 0];
      cards[(Math.random() * cards.length) | 0] = {
        kind: 'unlock', label: u.label, desc: `Module — ${u.desc}`, id: u.id, rarity: 'rare',
      };
    }
    this.pendingCards = cards;
    this.cardChoicePending = true;
  }

  /** Whether an augment card may be offered — gated on its dependency
   *  module so the player is never shown a card for a system they lack. */
  private augmentEligible(d: { requires?: 'shield' | 'anyWeapon' }): boolean {
    if (d.requires === 'shield') return this.shieldUnlocked;
    if (d.requires === 'anyWeapon') return this.unlockedWeapons.size > 1; // > Blaster
    return true;
  }

  /** Apply the chosen card and resume play.  Called from the UI. */
  public selectUpgradeCard(index: number) {
    if (!this.cardChoicePending) return;
    const card = this.pendingCards[index];
    if (card) {
      if (card.kind === 'stat' && card.id) {
        const id = card.id as UpgradeId;
        if (this.upgradeLevels[id] !== undefined) {
          this.upgradeLevels[id] += card.levels ?? 1; // uncapped; powerful cards grant 2–4
          this.applyUpgrades();
        }
      } else if (card.kind === 'salvage') {
        this.credits += card.amount ?? 0;
      } else if (card.kind === 'unlock' && card.id) {
        const def = UNLOCK_DEFS.find(d => d.id === card.id);
        if (def && !this.isUnlockOwned(def)) this.applyUnlock(def); // free (no cost)
      }
    }
    this.cardChoicePending = false;
    this.pendingCards = [];
  }

  /** DBG: cycle the card-offer wave interval (1 → 2 → 3 → 5 → 1). */
  public cycleCardInterval() {
    const cyc = UPGRADE_CARD_CONSTANTS.WAVE_INTERVAL_CYCLE;
    const i = cyc.indexOf(this.cardWaveInterval as 1 | 2 | 4 | 8);
    this.cardWaveInterval = cyc[(i + 1) % cyc.length];
  }

  /** DBG: force a card choice right now (uses the live wave number). */
  public debugTriggerCardChoice() {
    if (this.cardChoicePending) return;
    this.openCardChoice(this.waveIndex + 1);
  }

  // ── Snitch — quidditch-style bonus target ───────────────────────────────
  //
  // The snitch rides the asteroid flow field with a burst/coast AI and
  // PERSISTS across wave boundaries — one keeps flying until the player
  // catches it.  Catching it (colliding with it or shooting it, per the
  // DBG-toggleable catch mode) pays SCORE_CONSTANTS.SNITCH_POINTS and ends
  // the current wave; the next wave then spawns a fresh one.

  /** Per-sim-step snitch tick: lifecycle, flow-field steering, comet-tail
   *  emission, and the catch check.  Called from updateGameLogic after the
   *  wave tick so waveState is fresh. */
  private updateSnitch(dt: number) {
    if (!this.currentMap) return;
    this.snitchTime += dt;

    // Persist across wave boundaries: the snitch is never despawned at a
    // wave end, so an uncaught one keeps flying into the next wave.  A
    // fresh one only spawns when a wave is active and none is live — the
    // first wave, or the wave after a catch removed the previous snitch.
    if (this.waves.waveState === 'active' && (!this.snitch || !this.snitch.active)) {
      this.spawnSnitch();
    }

    const s = this.snitch;
    if (!s || !s.active) return;

    // ── Burst/coast AI ──────────────────────────────────────────────────
    // The snitch is interactive prey, not a constant-speed rail rider:
    // it coasts slow enough to close on (the catch window), then darts —
    // on a random timer, or the moment the player gets near (panic dart,
    // biased away from the player).  See the SNITCH_CONSTANTS doc block.
    this.snitchPanicCooldown = Math.max(0, this.snitchPanicCooldown - dt);
    this.snitchAiTimer -= dt;
    const toPlayerX = wrapDeltaX(s.position.x, this.player.position.x);
    const toPlayerY = wrapDeltaY(s.position.y, this.player.position.y);
    const playerDistSq = toPlayerX * toPlayerX + toPlayerY * toPlayerY;
    if (this.snitchAiState === 'coast') {
      const panic = this.snitchPanicCooldown <= 0
          && !this.player.isExploding
          && playerDistSq < SNITCH_CONSTANTS.PANIC_RADIUS * SNITCH_CONSTANTS.PANIC_RADIUS;
      if (panic || this.snitchAiTimer <= 0) {
        this.snitchAiState = 'dart';
        this.snitchAiTimer = SNITCH_CONSTANTS.DART_DURATION_MIN
            + Math.random() * (SNITCH_CONSTANTS.DART_DURATION_MAX - SNITCH_CONSTANTS.DART_DURATION_MIN);
        this.snitchDartAway = false;
        if (panic) {
          this.snitchPanicCooldown = SNITCH_CONSTANTS.PANIC_COOLDOWN;
          const d = Math.sqrt(playerDistSq);
          if (d > 1e-4) {
            this.snitchDartAwayX = -toPlayerX / d;
            this.snitchDartAwayY = -toPlayerY / d;
            this.snitchDartAway = true;
          }
        }
      }
    } else if (this.snitchAiTimer <= 0) {
      this.snitchAiState = 'coast';
      this.snitchDartAway = false;
      this.snitchAiTimer = SNITCH_CONSTANTS.COAST_DURATION_MIN
          + Math.random() * (SNITCH_CONSTANTS.COAST_DURATION_MAX - SNITCH_CONSTANTS.COAST_DURATION_MIN);
    }
    // Speed eases toward the state target — near-instant on the way up
    // (the burst), visibly slower on the way back down (the catch window
    // opens gradually as the dart bleeds off).
    const darting = this.snitchAiState === 'dart';
    // Per-wave speed ramp: headline (dart) speed grows WAVE_SPEED_STEP×
    // cruise per wave, capped; coast is a fixed fraction of it.  Read live
    // from the wave counter so the persistent snitch speeds up each wave.
    const waveBase = Math.min(
      SNITCH_CONSTANTS.WAVE_SPEED_MAX,
      SNITCH_CONSTANTS.WAVE_SPEED_STEP * (this.snitchCatchCount + 1),
    );
    const speedTarget = waveBase * (darting ? SNITCH_CONSTANTS.DART_RATIO : SNITCH_CONSTANTS.COAST_RATIO);
    const ease = darting ? SNITCH_CONSTANTS.SPEED_EASE_DART : SNITCH_CONSTANTS.SPEED_EASE_COAST;
    this.snitchSpeedMult += (speedTarget - this.snitchSpeedMult) * Math.min(1, ease * dt);

    // Steering: sampled flow direction rotated by the wander oscillation;
    // panic darts blend the away-from-player escape vector on top.  Speed
    // derives from the player's friction-limited terminal cruise (same
    // formula as the DBG thrust tooltip: acceleration/(1−friction),
    // clamped by maxSpeed) so the chase tracks thrust-mult changes.
    const flow = this.flowField.sampleAsteroidFlow(s.position.x, s.position.y);
    const wob = Math.sin(this.snitchTime * SNITCH_CONSTANTS.WANDER_FREQ + (s.snitchWanderPhase ?? 0))
        * SNITCH_CONSTANTS.WANDER_AMPLITUDE;
    const cosW = Math.cos(wob), sinW = Math.sin(wob);
    let dirX = flow.x * cosW - flow.y * sinW;
    let dirY = flow.x * sinW + flow.y * cosW;
    if (this.snitchDartAway) {
      const b = SNITCH_CONSTANTS.PANIC_AWAY_BIAS;
      const bx = dirX * (1 - b) + this.snitchDartAwayX * b;
      const by = dirY * (1 - b) + this.snitchDartAwayY * b;
      const bm = Math.sqrt(bx * bx + by * by) || 1;
      dirX = bx / bm;
      dirY = by / bm;
    }
    const moveCfg = PLAYER_MOVEMENT_CONFIG[this.currentMap.type];
    const cruise = Math.min(
      moveCfg.maxSpeed,
      (moveCfg.acceleration * getActivePlayerThrustMult()) / (1 - moveCfg.friction),
    );
    const targetSpeed = cruise * this.snitchSpeedMult * getActiveSnitchSpeedMult();
    const steerRate = darting ? SNITCH_CONSTANTS.DART_STEER_RATE : SNITCH_CONSTANTS.COAST_STEER_RATE;
    const alpha = Math.min(1, steerRate * dt * 60);
    s.velocity.x += (dirX * targetSpeed - s.velocity.x) * alpha;
    s.velocity.y += (dirY * targetSpeed - s.velocity.y) * alpha;
    s.rotation = Math.atan2(s.velocity.y, s.velocity.x);

    // Comet tail: decay + emit trail-strip points (rendered like a
    // projectile trail in gold) and sprinkle sparkle motes behind the core.
    if (!s.trail) s.trail = [];
    this.trails.tickTrail(s.trail, dt);
    const last = s.trail.length > 0 ? s.trail[s.trail.length - 1] : null;
    const tdx = last ? wrapDeltaX(last.x, s.position.x) : 1;
    const tdy = last ? wrapDeltaY(last.y, s.position.y) : 1;
    if (!last || tdx * tdx + tdy * tdy > TRAIL_CONSTANTS.MIN_DISTANCE_SQ) {
      s.trail.push({
        x: s.position.x,
        y: s.position.y,
        lifetime: SNITCH_CONSTANTS.TRAIL_LIFETIME,
        maxLifetime: SNITCH_CONSTANTS.TRAIL_LIFETIME,
        scale: SNITCH_CONSTANTS.TRAIL_SCALE,
      });
    }
    const sparkColors = SNITCH_CONSTANTS.SPARKLE_COLORS;
    this.spawnParticles(s.position, 1, sparkColors[(Math.random() * sparkColors.length) | 0], {
      speedMin: 0, speedMax: 1.5,
      sizeMin: 0.5, sizeMax: 1.6,
      lifetimeMin: 0.15, lifetimeMax: 0.4,
      positionJitter: SNITCH_CONSTANTS.SIZE * 0.5,
    });

    // Catch check (toPlayer deltas already computed by the AI block above).
    if (this.snitchCatchMode === 'collide') {
      if (this.player.isExploding) return;
      const r = Math.max(this.player.size.x, this.player.size.y) / 2
          + SNITCH_CONSTANTS.SIZE / 2 + SNITCH_CONSTANTS.COLLIDE_GRACE;
      if (playerDistSq <= r * r) this.catchSnitch(s);
    } else {
      const r = SNITCH_CONSTANTS.SHOOT_RADIUS;
      const projs = this.entityIndex.projectiles;
      for (let i = 0; i < projs.length; i++) {
        const p = projs[i];
        if (!p.active || p.ownerType !== EntityType.PLAYER) continue;
        const dx = wrapDeltaX(s.position.x, p.position.x);
        const dy = wrapDeltaY(s.position.y, p.position.y);
        if (dx * dx + dy * dy <= r * r) {
          p.active = false; // the shot is spent on the catch
          this.catchSnitch(s);
          break;
        }
      }
    }
  }

  /** Spawn a snitch on the off-screen ring around the player (same
   *  viewport-derived contract as wave-enemy spawns).  Non-drop
   *  INTERACTABLE → the physics broadphase ignores it entirely; it flies
   *  through everything and only the manual catch check can end it. */
  private spawnSnitch() {
    if (!this.currentMap) return;
    const zoom = this.camera.zoom || 1;
    const halfDiag = Math.hypot((window.innerWidth / 2) / zoom, (window.innerHeight / 2) / zoom);
    const angle = Math.random() * Math.PI * 2;
    const dist = halfDiag + SNITCH_CONSTANTS.SPAWN_MARGIN;
    const pos = {
      x: this.player.position.x + Math.cos(angle) * dist,
      y: this.player.position.y + Math.sin(angle) * dist,
    };
    wrapPosition(pos);
    const s: GameEntity = {
      id: nextId('snitch'),
      type: EntityType.INTERACTABLE,
      isSnitch: true,
      snitchWanderPhase: Math.random() * Math.PI * 2,
      position: pos,
      velocity: { x: 0, y: 0 },
      size: { x: SNITCH_CONSTANTS.SIZE, y: SNITCH_CONSTANTS.SIZE },
      rotation: 0,
      color: SNITCH_CONSTANTS.CORE_COLOR,
      active: true,
      health: 1,
      maxHealth: 1,
      mass: SNITCH_CONSTANTS.MASS,
      trail: [],
    };
    this.currentMap.entities.push(s);
    this.snitch = s;
    // Re-seed the burst/coast AI for the fresh snitch: open on a coast
    // window so the spawn reads as a wandering glint, not an escape.
    this.snitchAiState = 'coast';
    this.snitchAiTimer = SNITCH_CONSTANTS.COAST_DURATION_MIN
        + Math.random() * (SNITCH_CONSTANTS.COAST_DURATION_MAX - SNITCH_CONSTANTS.COAST_DURATION_MIN);
    this.snitchPanicCooldown = 0;
    const waveBase = Math.min(
      SNITCH_CONSTANTS.WAVE_SPEED_MAX,
      SNITCH_CONSTANTS.WAVE_SPEED_STEP * (this.snitchCatchCount + 1),
    );
    this.snitchSpeedMult = waveBase * SNITCH_CONSTANTS.COAST_RATIO;
    this.snitchDartAway = false;
  }

  /** Snitch caught: big gold payout + burst, then end the wave through
   *  the shared cleared path (no early-clear bonus stacks on top). */
  private catchSnitch(s: GameEntity) {
    s.active = false;
    this.snitch = null;
    this.snitchCatchCount++; // the NEXT snitch spawns faster — catching ramps speed, not waves
    this.awardScore(SCORE_CONSTANTS.SNITCH_POINTS, s.position);
    this.spawnParticles(s.position, SNITCH_CONSTANTS.CATCH_BURST_COUNT, SNITCH_CONSTANTS.CORE_COLOR, {
      speedMin: 1, speedMax: 6,
      sizeMin: 1, sizeMax: 3,
      lifetimeMin: 0.3, lifetimeMax: 0.8,
    });
    // Board clear: the catch wipes every live enemy on the field, each
    // worth half its normal kill value (full death path — explosions,
    // enemy shards, half-point "+N" popups).  Snapshot the count first so
    // the shards/particles those deaths append aren't re-scanned.
    if (this.currentMap) {
      const ents = this.currentMap.entities;
      const n = ents.length;
      for (let i = 0; i < n; i++) {
        const e = ents[i];
        if (e.type === EntityType.ENEMY && e.active && !e.isExploding) {
          this.handleEntityDeath(e, { scoreScale: SCORE_CONSTANTS.SNITCH_SWEEP_KILL_FRACTION });
        }
      }
    }
    this.waves.endWaveBySnitch(SCORE_CONSTANTS.SNITCH_POINTS, this.handleWaveCleared);
  }

  // ─── Dragon mini-boss (Stage 6) ────────────────────────────────────────
  //
  // Engine-managed segmented serpent.  The head is a normal ENEMY (so
  // projectiles damage it + handleEntityDeath routes a kill); this pass owns the
  // lifecycle (enter→roam→leave), the flow-weave steering, the body-path
  // history, and the tile-devour growth (via the shared consume pass).  One at a
  // time; DBG-summonable.  Toroidal.
  private updateDragons(dt: number) {
      if (this.dragons.length === 0 || !this.currentMap) return;
      const D = DRAGON_CONSTANTS;
      const moveCfg = PLAYER_MOVEMENT_CONFIG[this.currentMap.type];
      const cruise = Math.min(moveCfg.maxSpeed,
          (moveCfg.acceleration * getActivePlayerThrustMult()) / (1 - moveCfg.friction));

      for (let n = this.dragons.length - 1; n >= 0; n--) {
          const inst = this.dragons[n];
          const d = inst.head;
          if (!d.active) { this.dragons.splice(n, 1); continue; }
          inst.time += dt;

          // ── Steering ── while LEAVING, drive STRAIGHT toward the exit portal
          // (then keep going straight once the head is through, so the whole
          // body follows it through); otherwise the slow flow-weave roam.
          let dirX: number, dirY: number, speedMul: number;
          if (inst.state === 'leave' && inst.portal) {
              if (!inst.headThrough) {
                  const px = wrapDeltaX(d.position.x, inst.portal.x), py = wrapDeltaY(d.position.y, inst.portal.y);
                  const pm = Math.hypot(px, py) || 1; dirX = px / pm; dirY = py / pm;
              } else {
                  const vm = Math.hypot(d.velocity.x, d.velocity.y) || 1; dirX = d.velocity.x / vm; dirY = d.velocity.y / vm; // continue straight
              }
              speedMul = D.LEAVE_SPEED_MULT;
          } else {
              const flow = this.flowField.sampleAsteroidFlow(d.position.x, d.position.y);
              const wob = Math.sin(inst.time * D.WEAVE_FREQ + (d.glowPhase ?? 0)) * D.WEAVE_AMP;
              const cosW = Math.cos(wob), sinW = Math.sin(wob);
              dirX = flow.x * cosW - flow.y * sinW;
              dirY = flow.x * sinW + flow.y * cosW;
              speedMul = 1;
          }
          const target = cruise * D.SPEED_FRAC * speedMul;
          const alpha = Math.min(1, D.STEER_RATE * dt * 60 * (inst.state === 'leave' ? 4 : 1));
          d.velocity.x += (dirX * target - d.velocity.x) * alpha;
          d.velocity.y += (dirY * target - d.velocity.y) * alpha;
          d.rotation = Math.atan2(d.velocity.y, d.velocity.x);

          // ── Body path history (newest first) ──
          if (!d.dragonPath) d.dragonPath = [{ x: d.position.x, y: d.position.y }];
          const head0 = d.dragonPath[0];
          const mdx = wrapDeltaX(head0.x, d.position.x), mdy = wrapDeltaY(head0.y, d.position.y);
          if (mdx * mdx + mdy * mdy >= D.PATH_SPACING * D.PATH_SPACING) {
              d.dragonPath.unshift({ x: d.position.x, y: d.position.y });
              if (d.dragonPath.length > D.PATH_MAX) d.dragonPath.length = D.PATH_MAX;
          }

          // ── Devour tiles in the head's path → APPEND each as a body segment ──
          if (inst.state !== 'leave') {
              const headR = Math.max(d.size.x, d.size.y) * 0.6;
              const buf = this._dragonEatBuf;
              buf.length = 0;
              this.physics.forEachStaticNear(d.position.x, d.position.y, headR + 40, (t) => buf.push(t));
              for (let i = 0; i < buf.length; i++) {
                  const t = buf[i];
                  if (!t.active || t.shardVariant === 'indestructible-tile') continue; // can't devour the unbreakable
                  const tdx = wrapDeltaX(d.position.x, t.position.x);
                  const tdy = wrapDeltaY(d.position.y, t.position.y);
                  const contact = headR + Math.max(t.size.x, t.size.y) * 0.5;
                  if (tdx * tdx + tdy * tdy <= contact * contact) this.appendDragonSegment(inst, t, tdx, tdy);
              }
          }

          // ── Chain-follow: snap each body segment along the head's path ──
          this.positionDragonBody(inst);

          // ── Leaving: the dragon flies INTO the exit portal and is consumed
          // HEAD→TAIL — each part vanishes (puff) as it crosses the portal, the
          // body trailing through behind the (now-hidden) head. ──
          if (inst.state === 'leave' && inst.portal) {
              const cr = D.PORTAL_CONSUME_RADIUS, crSq = cr * cr;
              if (!inst.headThrough) {
                  const hx = wrapDeltaX(d.position.x, inst.portal.x), hy = wrapDeltaY(d.position.y, inst.portal.y);
                  if (hx * hx + hy * hy <= crSq) {
                      inst.headThrough = true;
                      d.dragonHidden = true;        // head "entered" — stop drawing it
                      d.contactDamage = 0;          // and stop hurting on contact
                      this.spawnParticles(d.position, 14, D.PORTAL_COLOR, { speedMin: 2, speedMax: 8, sizeMin: 1.5, sizeMax: 4, lifetimeMin: 0.2, lifetimeMax: 0.6 });
                  }
              }
              let remaining = 0;
              for (let i = 0; i < inst.body.length; i++) {
                  const s = inst.body[i];
                  if (!s.active) continue;
                  const sx = wrapDeltaX(s.position.x, inst.portal.x), sy = wrapDeltaY(s.position.y, inst.portal.y);
                  if (sx * sx + sy * sy <= crSq) {
                      s.active = false;
                      this.spawnParticles(s.position, 9, s.color || D.PORTAL_COLOR, { speedMin: 2, speedMax: 7, sizeMin: 1.2, sizeMax: 3, lifetimeMin: 0.15, lifetimeMax: 0.5 });
                  } else remaining++;
              }
              // Fully through (or the safety timer expired) → gone.
              if ((inst.headThrough && remaining === 0) || inst.stateTimer <= 0) {
                  this.despawnDragon(inst);
                  this.dragons.splice(n, 1);
                  continue;
              }
          }

          // ── Provoke-on-attack (third party): head shot stamps `provoked`
          // (PhysicsSystem); a BODY-segment hit provokes too (default player). ──
          if (!d.provoked) {
              for (let i = 0; i < inst.body.length; i++) {
                  if ((inst.body[i].hitFlash ?? 0) > 0) { d.provoked = true; if (!d.aggroTargetId) d.aggroTargetId = 'player'; break; }
              }
          }

          // ── Head attacks: ONLY once provoked — spit gnats + lob missiles ──
          if (inst.state === 'roam' && d.provoked) {
              inst.gnatTimer -= dt;
              if (inst.gnatTimer <= 0) {
                  inst.gnatTimer = D.GNAT_INTERVAL + Math.random() * D.GNAT_INTERVAL * 0.5;
                  const ctx = this.waveContext();
                  if (ctx) {
                      this.waves.spawnAt(EnemySubtype.SWARM, d.position, ctx, false);
                      this.spawnParticles(d.position, 7, '#2dd4bf', {
                          speedMin: 2, speedMax: 6, sizeMin: 1.5, sizeMax: 3, lifetimeMin: 0.2, lifetimeMax: 0.5,
                      });
                  }
              }
              inst.missileTimer -= dt;
              if (inst.missileTimer <= 0 && !this.player.isExploding) {
                  inst.missileTimer = D.MISSILE_INTERVAL;
                  this.fireDragonMissile(d);
              }
          }

          // ── Lifecycle ── (leave COMPLETION is handled by the portal-consume
          // pass above; here we only advance enter→roam→leave and open the exit
          // rift AHEAD of the head so it flies into it.) ──
          inst.stateTimer -= dt;
          if (inst.state === 'enter') {
              if (inst.stateTimer <= 0) { inst.state = 'roam'; inst.stateTimer = D.ROAM_DURATION; }
          } else if (inst.state === 'roam') {
              if (inst.stateTimer <= 0) {
                  inst.state = 'leave';
                  inst.stateTimer = D.LEAVE_DURATION; // safety cap only
                  const vm = Math.hypot(d.velocity.x, d.velocity.y) || 1;
                  const portal = { x: d.position.x + (d.velocity.x / vm) * D.PORTAL_AHEAD, y: d.position.y + (d.velocity.y / vm) * D.PORTAL_AHEAD };
                  wrapPosition(portal);
                  inst.portal = portal;
                  inst.headThrough = false;
                  this.openDragonPortal(portal);
              }
          }
      }
  }

  /** Open an offscreen entry portal and birth a dragon of `type` ('mixed' = a
   *  multi-material starting body).  Multiple can be alive at once. */
  private spawnDragon(type: StructureVariant | 'mixed' = 'mixed') {
      if (!this.currentMap) return;
      const zoom = this.camera.zoom || 1;
      const halfDiag = Math.hypot((window.innerWidth / 2) / zoom, (window.innerHeight / 2) / zoom);
      const angle = Math.random() * Math.PI * 2;
      const dist = halfDiag + DRAGON_CONSTANTS.SPAWN_MARGIN;
      const pos = { x: this.player.position.x + Math.cos(angle) * dist, y: this.player.position.y + Math.sin(angle) * dist };
      wrapPosition(pos);
      this.openDragonPortal(pos);

      const v = ENEMY_VARIANTS[EnemySubtype.DRAGON];
      const d: GameEntity = {
          id: nextId('dragon'),
          type: EntityType.ENEMY,
          enemySubtype: EnemySubtype.DRAGON,
          position: { x: pos.x, y: pos.y },
          velocity: { x: -Math.cos(angle) * 2, y: -Math.sin(angle) * 2 }, // head inward
          size: { x: v.size, y: v.size },
          rotation: angle + Math.PI,
          color: v.color,
          active: true,
          health: v.health,
          maxHealth: v.health,
          maxSpeed: v.maxSpeed,
          mass: v.mass,
          contactDamage: v.contactDamage,
          enemyShape: 'dragon',
          phasesTerrain: true,          // glides through terrain, eats it
          thirdParty: true,             // neutral: enemy fire hits it; provoke-on-attack
          consume: v.consume ? { ...v.consume } : undefined,
          aiState: 'chase',
          glowPhase: Math.random() * Math.PI * 2,
      };
      // Seed a trailing path (outward, away from the head's inward heading) so the
      // starting body lays out behind it immediately instead of stacking.
      const ox = Math.cos(angle), oy = Math.sin(angle); // outward = away from movement
      const seed: Vector2[] = [];
      for (let k = 0; k < 110; k++) seed.push({ x: pos.x + ox * k * DRAGON_CONSTANTS.PATH_SPACING, y: pos.y + oy * k * DRAGON_CONSTANTS.PATH_SPACING });
      d.dragonPath = seed;
      this.currentMap.entities.push(d);
      const inst: DragonInstance = {
          head: d, body: [], state: 'enter',
          stateTimer: DRAGON_CONSTANTS.ENTER_DURATION, time: 0,
          gnatTimer: DRAGON_CONSTANTS.GNAT_INTERVAL, missileTimer: DRAGON_CONSTANTS.MISSILE_INTERVAL,
      };
      // Spawn a starting body so it never enters as a bare head.  A 'mixed'
      // dragon cycles materials; a typed dragon is all one (it still becomes
      // mixed as it eats other tiles).
      const MIX: StructureVariant[] = ['glass', 'rock', 'metal', 'plastic'];
      for (let i = 0; i < DRAGON_CONSTANTS.START_SEGMENTS; i++) {
          const segVar = type === 'mixed' ? MIX[i % MIX.length] : type;
          const seg = this.makeDragonSegment(segVar, pos.x, pos.y);
          this.currentMap.entities.push(seg);
          inst.body.push(seg);
      }
      this.dragons.push(inst);
      this.positionDragonBody(inst); // lay the body out along the seeded path now
  }

  /** Fire one slow HOMING missile from the dragon head at the player. */
  private fireDragonMissile(d: GameEntity) {
      const M = DRAGON_CONSTANTS.MISSILE;
      const cfg = {
          type: WeaponType.HOMING, name: 'Dragon Missile', cooldown: 1,
          speed: M.speed, damage: M.damage, lifetime: M.lifetime, color: M.color, size: M.size,
          count: 1, spread: 0, recoil: 0, pierce: 0, ammoCost: 0, chargedAmmoCost: 0,
          homing: true, homingStrength: M.homingStrength, glow: true,
      } as WeaponConfig;
      this.spawnProjectileFromConfig(d, this.player.position, cfg, EntityType.ENEMY);
  }

  /** Devour a static tile → APPEND it as a body segment (Snake growth).  Beyond
   *  MAX_SEGMENTS the tile is just destroyed (the dragon still carves a path). */
  private appendDragonSegment(inst: DragonInstance, tile: GameEntity, dx: number, dy: number) {
      this.physics.removeStaticEntity(tile);
      this.flowField.onTileDestroyed(tile.position.x, tile.position.y);
      if (inst.body.length >= DRAGON_CONSTANTS.MAX_SEGMENTS) {
          const inward = Math.atan2(-dy, -dx);
          this.spawnParticles(tile.position, 6, tile.color || '#94a3b8', {
              spreadAngle: inward, spreadCone: 0.9, speedMin: 2, speedMax: 6, sizeMin: 1, sizeMax: 2.4, lifetimeMin: 0.1, lifetimeMax: 0.3,
          });
          tile.active = false;
          return;
      }
      tile.mass = DRAGON_CONSTANTS.SEGMENT_MASS; // finite → dynamic + shootable
      tile.dragonSegment = true;
      tile.phasesTerrain = true; // glides through terrain/each other; still solid to player + shots
      if (!tile.velocity) tile.velocity = { x: 0, y: 0 }; else { tile.velocity.x = 0; tile.velocity.y = 0; }
      inst.body.push(tile);
  }

  /** Build a fresh hex-tile body segment of `variant` at (x,y) — used to spawn
   *  the dragon's starting body.  A real tile (dent/shatter) flagged as a chain-
   *  controlled, phasing dragon segment. */
  private makeDragonSegment(variant: StructureVariant, x: number, y: number): GameEntity {
      const w = HEX_WIDTH, h = HEX_HEIGHT;
      const pts: Vector2[] = [
          { x: 0, y: -h / 2 }, { x: w / 2, y: -h / 4 }, { x: w / 2, y: h / 4 },
          { x: 0, y: h / 2 }, { x: -w / 2, y: h / 4 }, { x: -w / 2, y: -h / 4 },
      ];
      const seg = TileGenerator.buildStructureTile(0, 0, x, y, w, h, pts, variant);
      seg.mass = DRAGON_CONSTANTS.SEGMENT_MASS;
      seg.dragonSegment = true;
      seg.phasesTerrain = true;
      return seg;
  }

  /** Snap each body segment onto the head's path, SEGMENT_SPACING apart by arc
   *  length, oriented along the body — the Snake chain.  The walk is ANCHORED to
   *  the head's LIVE position (not the last recorded path point, which only
   *  updates every PATH_SPACING and made the whole body jump), so the chain
   *  tracks the smoothly-moving head jitter-free. */
  private positionDragonBody(inst: DragonInstance) {
      const head = inst.head;
      const body = inst.body;
      const path = head.dragonPath;
      if (body.length === 0 || !path || path.length < 1) return;
      const SP = DRAGON_CONSTANTS.SEGMENT_SPACING;
      let prevX = head.position.x, prevY = head.position.y; // live anchor
      let acc = 0, seg = 0, target = SP;
      for (let i = 0; i < path.length && seg < body.length; i++) {
          const cur = path[i];
          const vx = wrapDeltaX(prevX, cur.x), vy = wrapDeltaY(prevY, cur.y); // prev → cur
          const len = Math.hypot(vx, vy);
          if (len > 1e-4) {
              while (seg < body.length && acc + len >= target) {
                  const t = (target - acc) / len;
                  const s = body[seg];
                  s.position.x = prevX + vx * t;
                  s.position.y = prevY + vy * t;
                  wrapPosition(s.position);
                  s.rotation = Math.atan2(vy, vx);
                  s.velocity.x = 0; s.velocity.y = 0;
                  seg++; target += SP;
              }
              acc += len;
          }
          prevX = cur.x; prevY = cur.y;
      }
      // Path too short for the whole body — stack the rest at the tail end.
      const tail = path[path.length - 1];
      for (; seg < body.length; seg++) {
          const s = body[seg];
          s.position.x = tail.x; s.position.y = tail.y;
          wrapPosition(s.position);
          s.velocity.x = 0; s.velocity.y = 0;
      }
  }

  /** A body segment was destroyed: everything AFT of it falls off (→ free
   *  drifting shards), and the segment itself shatters (handled by the caller). */
  private severDragon(inst: DragonInstance, seg: GameEntity) {
      const idx = inst.body.indexOf(seg);
      if (idx < 0) return;
      for (let i = idx + 1; i < inst.body.length; i++) this.detachDragonSegment(inst.body[i]);
      inst.body.length = idx; // drop the broken segment + everything aft
  }

  /** Find the live dragon whose body contains `seg` (for sever routing). */
  private dragonOwning(seg: GameEntity): DragonInstance | undefined {
      for (let i = 0; i < this.dragons.length; i++) if (this.dragons[i].body.indexOf(seg) >= 0) return this.dragons[i];
      return undefined;
  }

  /** A severed segment falls off the dragon: clear the flag, turn it into a free
   *  mobile shard of its material, and kick it loose. */
  private detachDragonSegment(seg: GameEntity) {
      seg.dragonSegment = false;
      seg.phasesTerrain = false; // a loose shard collides normally again
      seg.shardVariant = this.tileToShardVariant(seg.shardVariant);
      const a = Math.random() * Math.PI * 2;
      seg.velocity.x = Math.cos(a) * 3.5;
      seg.velocity.y = Math.sin(a) * 3.5;
  }

  /** A killed body segment: sever the owning dragon's tail, then dissolve it
   *  (shatter burst, no regen/drops — it's a body part, not a map tile). */
  private dragonSegmentDeath(seg: GameEntity) {
      const inst = this.dragonOwning(seg);
      if (inst) this.severDragon(inst, seg);
      this.spawnParticles(seg.position, 12, seg.color || '#94a3b8', {
          speedMin: 2, speedMax: 8, sizeMin: 1.5, sizeMax: 3.5, lifetimeMin: 0.2, lifetimeMax: 0.55,
      });
      seg.active = false;
  }

  /** Map a tile variant to its mobile-shard variant (for severed body parts). */
  private tileToShardVariant(v: GameEntity['shardVariant']): GameEntity['shardVariant'] {
      switch (v) {
          case 'glass-tile':   return 'glass-shard';
          case 'rock-tile':    return 'rock-shard';
          case 'metal-tile':   return 'metal-shard';
          case 'plastic-tile': return 'plastic-shard';
          default:             return v;
      }
  }

  /** Dragon killed: big payoff + score + collapse the rift + scatter the body. */
  private dragonDeath(inst: DragonInstance) {
      const d = inst.head;
      // Payout doubles per kill this run: 3000, 6000, 12000, …
      this.awardScore(DRAGON_CONSTANTS.SCORE * Math.pow(2, this.dragonsKilled), d.position);
      this.dragonsKilled++;
      this.openDragonPortal(d.position);
      this.spawnParticles(d.position, 24, DRAGON_CONSTANTS.COLOR, { // Tier 2b: 40 → 24
          speedMin: 3, speedMax: 14, sizeMin: 2, sizeMax: 5, lifetimeMin: 0.4, lifetimeMax: 1.0,
      });
      this.handleScreenShake(COLLISION_CONFIG.SHAKE.HEAVY);
      d.active = false;
      for (let i = 0; i < inst.body.length; i++) this.detachDragonSegment(inst.body[i]); // body scatters
      const k = this.dragons.indexOf(inst);
      if (k >= 0) this.dragons.splice(k, 1);
  }

  /** Despawn a dragon (left via portal — no payoff).  The body leaves with it.
   *  Caller removes it from `this.dragons`. */
  private despawnDragon(inst: DragonInstance) {
      inst.head.active = false;
      for (let i = 0; i < inst.body.length; i++) inst.body[i].active = false;
  }

  /** Portal VFX: an expanding violet rift ring + sparks. */
  private openDragonPortal(pos: Vector2) {
      this.openPortal(pos, {
          color: DRAGON_CONSTANTS.PORTAL_COLOR,
          radius: DRAGON_CONSTANTS.PORTAL_RADIUS,
          duration: DRAGON_CONSTANTS.PORTAL_DURATION,
      });
  }

  /**
   * Reusable rift-portal VFX (Stage 7 — abstracted from the dragon's single
   * ring).  A layered warp: a bright white core flash, the main coloured rift
   * ring, a wider trailing echo ring, a disc of inward-swirling embers, and a
   * scatter of hot white sparks — plus a light screen punch.  Shared by the
   * dragon and the rival ships; tune via the caller's PORTAL_* constants.
   */
  private openPortal(pos: Vector2, opts: { color: string; radius: number; duration: number }) {
      const { color, radius, duration } = opts;
      // White core flash (fast, small) → the rift "ignites".
      this.spawnShockwave(pos, { radius: radius * 0.42, damage: 0, knockback: 0, color: '#ffffff', lifetime: duration * 0.55 });
      // Main coloured rift ring.
      this.spawnShockwave(pos, { radius, damage: 0, knockback: 0, color, lifetime: duration });
      // Wider, slower echo ring — gives the rift depth.
      this.spawnShockwave(pos, { radius: radius * 1.35, damage: 0, knockback: 0, color, lifetime: duration * 1.25 });
      // Swirling embers filling the disc (tangential bias reads as a vortex).
      // Counts trimmed ~40 % (Tier 2b) so a burst of simultaneous warps spawns
      // fewer particles; the layered rings still carry the rift's body.
      this.spawnParticles(pos, 18, color, {
          speedMin: 1, speedMax: 5, sizeMin: 1.5, sizeMax: 4,
          lifetimeMin: 0.35, lifetimeMax: 0.9, positionJitter: radius * 0.55,
      });
      // Hot white sparks bursting outward from the seam.
      this.spawnParticles(pos, 10, '#ffffff', {
          speedMin: 4, speedMax: 12, sizeMin: 1, sizeMax: 2.6, lifetimeMin: 0.2, lifetimeMax: 0.5,
      });
      this.handleScreenShake(COLLISION_CONFIG.SHAKE.MICRO * 4); // a soft warp thud
  }

  /** DBG: summon a dragon of `type` ('glass'|'rock'|'metal'|'plastic'|'mixed').
   *  Each call adds another — multiple dragons can be out at once. */
  public debugSpawnDragon(type: string = 'mixed') {
      const allowed = ['glass', 'rock', 'metal', 'plastic', 'mixed'];
      this.spawnDragon((allowed.includes(type) ? type : 'mixed') as StructureVariant | 'mixed');
  }

  // ─── Rival ships (Stage 7) ─────────────────────────────────────────────
  //
  // Player-like roamers that warp in via portal, hunt the WAVE enemies
  // (stealing the player's kill points + loot), and—per disposition—fight,
  // ignore, or retaliate against the player.  Engine-managed lifecycle
  // (mirrors updateDragons); the ship is a lean EntityType.ENEMY + isRival.

  private rollRivalDisposition(): RivalDisposition {
      const w = RIVAL_CONSTANTS.WEIGHTS;
      const r = Math.random() * (w.hostile + w.ally + w.neutral);
      if (r < w.hostile) return 'hostile';
      if (r < w.hostile + w.ally) return 'ally';
      return 'neutral';
  }

  /** Per-frame rival lifecycle: cadence warp-ins, per-ship hunt/strafe/fire/
   *  loot, and the warp-out fly-through.  Engine-driven (AISystem skips them). */
  private updateRivals(dt: number) {
      if (!this.currentMap) return;
      const R = RIVAL_CONSTANTS;

      // Cadence — a fresh random rival warps in every SCORE_INTERVAL points
      // earned (capped at MAX_RIVALS alive).  The threshold advances with the
      // score whether or not a rival actually spawns, so a score that vaults
      // several intervals at once doesn't queue a backlog of warp-ins.
      while (this.score >= this.nextRivalScore) {
          if (this.rivals.length < R.MAX_RIVALS) this.spawnRival();
          this.nextRivalScore += R.SCORE_INTERVAL;
      }
      if (this.rivals.length === 0) return;

      // Re-acquire targets + run the loot vacuum on the PerfController cadence;
      // everything else (steering, firing, lifecycle) still ticks every step.
      const doScan = this.perfController.shouldRun('rivalScan');
      const enemies = this.entityIndex.enemies;
      // Rivals fly with the SAME mechanics as the player: thrust toward the
      // desired heading + a self speed-cap, with the map's friction applied by
      // PhysicsSystem (enemies already get it).  acc/maxSpeed come from the map
      // movement config (player BASE values, no upgrade mults), so a rival is a
      // baseline player ship — the upgraded player can still out-fly it.
      const moveCfg = PLAYER_MOVEMENT_CONFIG[this.currentMap.type];
      const acc = moveCfg ? moveCfg.acceleration : PHYSICS_CONSTANTS.ACCELERATION;
      const baseMaxSpeed = moveCfg ? moveCfg.maxSpeed : PHYSICS_CONSTANTS.MAX_SPEED;
      const timeScale = dt * 60;
      for (let n = this.rivals.length - 1; n >= 0; n--) {
          const inst = this.rivals[n];
          const s = inst.ship;
          if (!s.active) { this.rivals.splice(n, 1); continue; }
          inst.stateTimer -= dt;
          inst.fireTimer -= dt;

          // ── Target: re-acquired on the rivalScan cadence (nearest wave enemy
          // within VISION; a hostile / provoked-neutral rival also weighs the
          // player), then CACHED on the instance.  Between scans steering/firing
          // reuse the cached target and only recompute the O(1) distance to it —
          // dropping it the moment it goes inactive/exploding. ──
          let target: GameEntity | null = inst.target ?? null;
          if (target && (!target.active || target.isExploding)) target = null;
          if (doScan) {
              const huntsPlayer = inst.disposition === 'hostile'
                  || (inst.disposition === 'neutral' && s.provoked === true);
              target = null;
              let acqD2 = R.VISION * R.VISION;
              for (let i = 0; i < enemies.length; i++) {
                  const e = enemies[i];
                  if (e.isRival || e.isExploding) continue;
                  const dx = wrapDeltaX(s.position.x, e.position.x), dy = wrapDeltaY(s.position.y, e.position.y);
                  const d2 = dx * dx + dy * dy;
                  if (d2 < acqD2) { acqD2 = d2; target = e; }
              }
              if (huntsPlayer && !this.player.isExploding) {
                  const dx = wrapDeltaX(s.position.x, this.player.position.x), dy = wrapDeltaY(s.position.y, this.player.position.y);
                  const d2 = dx * dx + dy * dy;
                  if (target === null || d2 < acqD2) { target = this.player; acqD2 = d2; }
              }
              inst.target = target;
          }
          // Live squared distance to the (cached) target — drives the strafe
          // sign + the fire-range gate below.
          let bestD2 = Infinity;
          if (target) {
              const tdx = wrapDeltaX(s.position.x, target.position.x), tdy = wrapDeltaY(s.position.y, target.position.y);
              bestD2 = tdx * tdx + tdy * tdy;
          }

          // ── Steering ──
          let dirX: number, dirY: number, speedMul = 1;
          if (inst.state === 'leave' && inst.portal) {
              const px = wrapDeltaX(s.position.x, inst.portal.x), py = wrapDeltaY(s.position.y, inst.portal.y);
              const pm = Math.hypot(px, py) || 1; dirX = px / pm; dirY = py / pm; speedMul = R.LEAVE_SPEED_MULT;
          } else if (target) {
              const tx = wrapDeltaX(s.position.x, target.position.x), ty = wrapDeltaY(s.position.y, target.position.y);
              const tm = Math.hypot(tx, ty) || 1;
              // Hold a firing gap: close if far, back off if too near; always strafe.
              const sign = tm > R.PREFERRED_DIST * 1.15 ? 1 : tm < R.PREFERRED_DIST * 0.7 ? -1 : 0;
              dirX = (tx / tm) * sign + (-ty / tm) * 0.7;
              dirY = (ty / tm) * sign + (tx / tm) * 0.7;
              const dm = Math.hypot(dirX, dirY) || 1; dirX /= dm; dirY /= dm;
              s.rotation = Math.atan2(ty, tx); // face the target
          } else {
              const flow = this.flowField.sampleAsteroidFlow(s.position.x, s.position.y);
              const fm = Math.hypot(flow.x, flow.y) || 1; dirX = flow.x / fm; dirY = flow.y / fm;
              s.rotation = Math.atan2(s.velocity.y, s.velocity.x);
          }
          // Player-style movement: apply thrust along the desired heading, then
          // self-cap speed (PhysicsSystem applies the map friction afterward, so
          // the rival accelerates + coasts exactly like the player ship).
          s.velocity.x += dirX * acc * timeScale;
          s.velocity.y += dirY * acc * timeScale;
          const maxSpeed = baseMaxSpeed * speedMul;
          const sp = Math.hypot(s.velocity.x, s.velocity.y);
          if (sp > maxSpeed) { const k = maxSpeed / sp; s.velocity.x *= k; s.velocity.y *= k; }
          if (inst.state === 'leave') s.rotation = Math.atan2(s.velocity.y, s.velocity.x);

          // ── Fire (only while roaming, target in range) ──
          if (inst.state === 'roam' && target && inst.fireTimer <= 0
              && bestD2 <= R.FIRE_RANGE * R.FIRE_RANGE) {
              inst.fireTimer = R.WEAPON.cooldown;
              this.fireRivalShot(inst, target);
          }

          // ── Loot vacuum: steal nearby collectible drops from the player
          // (cadenced with the target re-acquire; drops settle over many frames
          // so a few-step defer is invisible). ──
          if (doScan) this.rivalVacuumDrops(inst);

          // ── Lifecycle ──
          if (inst.state === 'enter') {
              if (inst.stateTimer <= 0) { inst.state = 'roam'; inst.stateTimer = R.ROAM_DURATION; }
          } else if (inst.state === 'roam') {
              if (inst.stateTimer <= 0) {
                  inst.state = 'leave'; inst.stateTimer = R.LEAVE_DURATION;
                  const vm = Math.hypot(s.velocity.x, s.velocity.y) || 1;
                  const portal = { x: s.position.x + (s.velocity.x / vm) * R.PORTAL_AHEAD, y: s.position.y + (s.velocity.y / vm) * R.PORTAL_AHEAD };
                  wrapPosition(portal);
                  inst.portal = portal;
                  this.openPortal(portal, { color: R.PORTAL_COLOR, radius: R.PORTAL_RADIUS, duration: R.PORTAL_DURATION });
              }
          } else if (inst.state === 'leave' && inst.portal) {
              const cr = R.PORTAL_CONSUME_RADIUS;
              const hx = wrapDeltaX(s.position.x, inst.portal.x), hy = wrapDeltaY(s.position.y, inst.portal.y);
              if (hx * hx + hy * hy <= cr * cr || inst.stateTimer <= 0) {
                  this.spawnParticles(s.position, 14, R.PORTAL_COLOR, { speedMin: 2, speedMax: 8, sizeMin: 1.5, sizeMax: 4, lifetimeMin: 0.2, lifetimeMax: 0.6 });
                  s.active = false; this.rivals.splice(n, 1); continue;
              }
          }
      }
  }

  /** Warp a rival ship in from an offscreen rift.  Disposition is rolled by
   *  weight unless one is forced (DBG). */
  private spawnRival(forced?: RivalDisposition) {
      if (!this.currentMap) return;
      const R = RIVAL_CONSTANTS;
      const zoom = this.camera.zoom || 1;
      const halfDiag = Math.hypot((window.innerWidth / 2) / zoom, (window.innerHeight / 2) / zoom);
      const angle = Math.random() * Math.PI * 2;
      const dist = halfDiag + R.SPAWN_MARGIN;
      const pos = { x: this.player.position.x + Math.cos(angle) * dist, y: this.player.position.y + Math.sin(angle) * dist };
      wrapPosition(pos);
      this.openPortal(pos, { color: R.PORTAL_COLOR, radius: R.PORTAL_RADIUS, duration: R.PORTAL_DURATION });

      const disposition = forced ?? this.rollRivalDisposition();
      const sprite = R.SPRITES[Math.floor(Math.random() * R.SPRITES.length)];
      const ship: GameEntity = {
          id: nextId('rival'),
          type: EntityType.ENEMY,
          position: { x: pos.x, y: pos.y },
          velocity: { x: -Math.cos(angle) * 2, y: -Math.sin(angle) * 2 }, // heading inward
          size: { x: R.SIZE, y: R.SIZE },
          rotation: angle + Math.PI,
          color: R.COLORS[disposition],
          active: true,
          health: R.HEALTH,
          maxHealth: R.HEALTH,
          maxSpeed: R.MAX_SPEED,
          mass: R.MASS,
          enemyTier: R.TIER,            // kill bounty when the player downs it
          isRival: true,
          sprite,
          trail: [],
          glowPhase: Math.random() * Math.PI * 2,
      };
      this.currentMap.entities.push(ship);
      this.rivals.push({
          ship, disposition, state: 'enter', stateTimer: R.ENTER_DURATION,
          fireTimer: Math.random() * R.WEAPON.cooldown, stolen: 0,
      });
  }

  /** Rival weapon: a blaster bolt that may damage the wave enemies (hitsEnemies)
   *  and—unless hostile or aimed AT the player—passes through the player. */
  private fireRivalShot(inst: RivalInstance, target: GameEntity) {
      if (!this.currentMap) return;
      const W = RIVAL_CONSTANTS.WEAPON;
      const cfg = {
          type: WeaponType.BLASTER, name: 'Rival Blaster', cooldown: W.cooldown,
          speed: W.speed, damage: W.damage, lifetime: W.lifetime,
          color: inst.ship.color || W.color, size: W.size,
          count: 1, spread: 0, recoil: 0, pierce: 0, ammoCost: 0, chargedAmmoCost: 0,
      } as WeaponConfig;
      const ents = this.currentMap.entities;
      const before = ents.length;
      this.spawnProjectileFromConfig(inst.ship, { x: target.position.x, y: target.position.y }, cfg, EntityType.ENEMY);
      const targetingPlayer = target === this.player;
      const spares = !(inst.disposition === 'hostile' || targetingPlayer);
      for (let i = before; i < ents.length; i++) {
          const p = ents[i];
          if (p.type === EntityType.PROJECTILE) { p.hitsEnemies = true; p.sparesPlayer = spares; }
      }
  }

  /** Steal any collectible drop within LOOT_RANGE (denies the player + heals). */
  private rivalVacuumDrops(inst: RivalInstance) {
      const R = RIVAL_CONSTANTS;
      const s = inst.ship;
      const rng2 = R.LOOT_RANGE * R.LOOT_RANGE;
      for (let i = 0; i < this.activeDrops.length; i++) {
          const drop = this.activeDrops[i];
          if (!drop.active || !isCollectibleDrop(drop)) continue;
          const dx = wrapDeltaX(s.position.x, drop.position.x), dy = wrapDeltaY(s.position.y, drop.position.y);
          if (dx * dx + dy * dy > rng2) continue;
          drop.active = false;
          s.health = Math.min(s.maxHealth ?? R.HEALTH, (s.health ?? 0) + R.HEAL_PER_LOOT);
          this.spawnParticles(drop.position, 5, s.color || '#e2e8f0', {
              speedMin: 1, speedMax: 5, sizeMin: 1, sizeMax: 2.4, lifetimeMin: 0.15, lifetimeMax: 0.4,
          });
      }
  }

  /** DBG: warp in a rival of the given disposition (or a weighted roll). */
  public debugSpawnRival(disposition: string = 'random') {
      const forced = (disposition === 'hostile' || disposition === 'ally' || disposition === 'neutral')
          ? disposition as RivalDisposition : undefined;
      this.spawnRival(forced);
  }

  // ─── Perf recorder (DBG FPS harness) ───────────────────────────────────
  // Start/stop a capture, cycle the scene label, and export a copy-paste
  // report.  Surfaced in the DBG panel's "Perf REC" section; see
  // engine/systems/PerfRecorder.ts.
  public perfRecToggle() { this.perfRecorder.toggle(); }
  public perfRecCycleScene() { this.perfRecorder.cycleScene(); }

  /** Build the copy-paste perf report from the current capture window.  The
   *  viewport / dpr / zoom are captured live so the block records the FOV the
   *  numbers were measured at (a wide desktop FOV draws more than a tablet). */
  public perfRecExport(): string {
    return this.perfRecorder.report({
      viewportW: typeof window !== 'undefined' ? window.innerWidth : 0,
      viewportH: typeof window !== 'undefined' ? window.innerHeight : 0,
      dpr: typeof window !== 'undefined' ? Math.round((window.devicePixelRatio || 1) * 10) / 10 : 1,
      zoom: this.camera.zoom || 1,
      mapName: this.currentMap?.name || '—',
      difficulty: this.difficultyLevel,
      buildTag: 'exotic-opt',
    }, PERF_CONTROLLER_CONSTANTS.TIER_NAMES as unknown as string[]);
  }

  // Thin wrapper kept for internal call-site compatibility — delegates to WaveSystem.
  private initWaveSystem() {
    const ctx = this.waveContext();
    if (!ctx) return;
    this.waves.init(ctx);
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
      // Apply the active flow-field tuning (density / kernel / tangent)
      // so the configured defaults — and any values cycled before a
      // restart — take effect at load instead of the grid's internal
      // defaults.  Mirrors cycleFFDensity's reconfigure ordering.
      this.flowField.setCellSize(this.ffCellSize);
      this.flowField.initObstacles(map.entities);
      // Bake under the active DBG pattern (DEFAULT = the map's own
      // sampler) so a selected pattern persists across map loads /
      // restarts.
      this.flowField.buildAsteroidField(this.flowSamplerFor(map));
      this.flowField.setKernelR(this.ffKernelR);
      this.flowField.setTangentMix(this.ffTangentMix);
      this.renderer.setMapType(map.type);
      // Forward the map's recorded nebula cluster-center positions to
      // the background layer so its puffs render at the same world
      // positions as the interactable tile clusters (one unified
      // cloud; backdrop still parallaxes as the camera moves).
      this.renderer.setNebulaClusterCenters(map.nebulaClusterCenters);
      // Pre-render structure dots to an offscreen minimap canvas so the
      // per-frame minimap pass is a single blit instead of ~22k fillRects.
      this.renderer.buildMinimapStaticLayer(map.entities, map.width, map.height);
      // Seed material-tile neighbour counts before baking the static
      // layer so cache-eligible variants (glass) stamp at the correct
      // automata brightness on the first frame.
      this.shards.ensureMaterialNeighbors(map.entities);
      // Pre-bake the world-tile static layer (glass + indestructible hex
      // sprites) so the per-frame world render replaces hundreds of
      // per-tile drawImage calls with a single (toroidal-wrapped) blit.
      this.renderer.buildStaticTileLayer(map.entities, map.width, map.height);
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
          {
              vectors:   this.ffOverlayVectors,
              cells:     this.ffOverlayCells,
              obstacles: this.ffOverlayObstacles,
              rebuilds:  this.ffOverlayRebuilds,
              sampleN:   this.ffOverlaySampleN,
          },
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
      this.perfShardSys[idx]      = this.shards.lastUpdateMs;
      this.perfUpdatePhysics[idx] = this.lastUpdatePhysicsMs;
      this.perfUpdateLogic[idx]   = this.lastUpdateGameLogicMs;
      this.perfDrops[idx]         = this.lastDropsMs;
      this.perfExplosionRings[idx] = this.lastExplosionRingsMs;
      this.perfWeapons[idx]       = this.lastWeaponsMs;
      // physMisc = updPhys − everything we already time inside it
      // (physics, ai, gravity, lgrv, coll, flow).  Captures the
      // surrounding GameEngine glue: entity compaction, asteroid
      // census, flow nudge over asteroids + drops, etc.
      const physMisc = Math.max(0, this.lastUpdatePhysicsMs
          - this.physics.lastUpdateMs - this.ai.lastUpdateMs - this.flowField.lastFlushMs);
      this.perfPhysMisc[idx] = physMisc;
      // logicMisc = updLogic − the explicit sub-timers we now track.
      const logicMisc = Math.max(0, this.lastUpdateGameLogicMs
          - this.shards.lastUpdateMs
          - this.lastExplosionRingsMs
          - this.lastWeaponsMs
          - this.lastDropsMs
          - this.projectiles.lastHomingMs
          - this.projectiles.lastLightningMs);
      this.perfLogicMisc[idx] = logicMisc;
      const next = idx + 1;
      this.perfSimIdx = next >= GameEngine.PERF_WINDOW ? 0 : next;
      if (this.perfSimFilled < GameEngine.PERF_WINDOW) this.perfSimFilled++;
  }

  // Called once per render frame (after draw()).  Render timing uses its
  // own ring since it happens once per frame regardless of how many sim
  // substeps the accumulator drained.
  private recordRenderPerf() {
      this.perfRender[this.perfRenderIdx]        = this.renderer.lastRenderMs;
      this.perfNebula[this.perfRenderIdx]        = this.renderer.lastNebulaMs;
      this.perfTileLighting[this.perfRenderIdx] = this.renderer.lastTileLightingMs;
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
          shardSysMs:     GameEngine.ringAvg(this.perfShardSys,     simN),
          updatePhysicsMs: GameEngine.ringAvg(this.perfUpdatePhysics, simN),
          updateLogicMs:  GameEngine.ringAvg(this.perfUpdateLogic,  simN),
          physMiscMs:     GameEngine.ringAvg(this.perfPhysMisc,     simN),
          logicMiscMs:    GameEngine.ringAvg(this.perfLogicMisc,    simN),
          dropsMs:        GameEngine.ringAvg(this.perfDrops,        simN),
          explosionRingsMs: GameEngine.ringAvg(this.perfExplosionRings, simN),
          weaponsMs:      GameEngine.ringAvg(this.perfWeapons,      simN),
          flowFieldMs:    GameEngine.ringAvg(this.perfFlowField,    simN),
          renderMs:       GameEngine.ringAvg(this.perfRender,       this.perfRenderFilled),
          nebulaMs:       GameEngine.ringAvg(this.perfNebula,       this.perfRenderFilled),
          nebulaVisible:  this.renderer.lastNebulaVisible,
          nebulaFast:     this.renderer.lastNebulaFastCount,
          nebulaSlow:     this.renderer.lastNebulaSlowCount,
          tileLightingMs:    GameEngine.ringAvg(this.perfTileLighting, this.perfRenderFilled),
          tileLightingCount: this.renderer.lastTileLightingCount,
          // Cell density peaks on single-frame spikes — report the window
          // max so the overlay surfaces transient clusters, not just the mean.
          maxCellDensity: GameEngine.ringPeak(this.perfDensity,     simN),
          totalEntities:     this.perfCounts.totalEntities,
          enemyCount:        this.perfCounts.enemyCount,
          asteroidCount:     this.perfCounts.asteroidCount,
          projectileCount:   this.perfCounts.projectileCount,
          particleCount:     this.perfCounts.particleCount,
          interactableCount: this.perfCounts.interactableCount,
          perfLoadLevel:     this.perfController.loadLevel,
          perfLoadTier:      this.perfController.tierName(),
          perfDynamicCount:  this.perfController.lastDynamicCount,
          perfAsleepCount:   this.physics.lastAsleepCount,
          perfOffscreenShards: this.physics.lastOffscreenShardCount,
          perfLodShards:     this.renderer.lastLodShardCount,
          perfMergeRateMult: this.shards.lastMergeRatePeak,
          // Fresh small array (9 tasks) per render frame — negligible vs.
          // the per-frame stats object the loop already builds, and keeps
          // the controller's internal `run` flag out of the snapshot.
          perfTasks: this.perfController.debug.map(t => ({ id: t.id, eff: t.eff, manual: t.manual })),
      };
  }
}
