

import { InputSystem } from './systems/InputSystem';
import { PhysicsSystem } from './systems/PhysicsSystem';
import { RenderSystem } from './systems/RenderSystem';
import type { Renderer } from './systems/Renderer';
import type { RendererDiagnostics } from './systems/RendererDiagnostics';
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
import { AudioSystem } from './systems/AudioSystem';
import { registerSfx } from './systems/SfxRegistry';
import { nextId } from './systems/IdAllocator';
import { mapDescriptor, descriptorForMapType, HUB_DESCRIPTOR, MAP_DESCRIPTORS } from './maps/MapDescriptors';
import { BaseMapLayer, OverworldMap, UniverseMap, RingMap, SevenRingsMap, PocketMap, AsteroidFieldMap, GlassFieldMap, PlasticFieldMap, MetalFieldMap, IndestructibleFieldMap, NebulaFieldMap, RockFieldMap, TileHeavyMap } from './maps/MapClasses';
import { TileGenerator, assertPolygonsUnaliased } from './maps/TileGenerator';
import { GameEntity, EntityType, MapType, CameraState, EngineStats, PerfSnapshot, Vector2, WeaponType, WeaponConfig, DamageText, GameState, DropCompositionEntry, PlayerHUDMessage, WaveAnnouncement, TrailPoint, TrailShape, TrailEmitMode, EffectPayload, EnemySubtype, ConsumeConfig, ControlScheme, RumbleKind } from '../types';
import { COLORS, PHYSICS_CONSTANTS, WEAPONS, WEAPON_LIST, MINIMAP_CONSTANTS, PLAYER_MOVEMENT_CONFIG, DAMAGE_TEXT_CONSTANTS, getRockShardFreeSpawn, TRAIL_CONSTANTS, PLAYER_TRAIL_CONSTANTS, PARTICLE_CONSTANTS, CAMERA_CONSTANTS, SPRITE_CONSTANTS, EXPLOSION_CONSTANTS, UI_CONSTANTS, DIFFICULTY_SCALES, DROP_CONFIG, SALVAGE_CONSTANTS, STRUCTURE_CONSTANTS, AI_CONFIG, LOADOUT_HUD_CONSTANTS, computeLoadoutHUDLayout, LIGHTNING_CHAIN_RANGE, LIGHTNING_CHAIN_COUNT, LIGHTNING_CHAIN_BRANCHES, LIGHTNING_CHAIN_EXCLUDED_VARIANTS, LIGHTNING_ARC_LIFETIME, SHIELD_CONSTANTS, HEALTH_DROP_INTERVAL, SCORE_CONSTANTS, SNITCH_CONSTANTS, REGEN_POP_CONSTANTS, SIMULATION_CONSTANTS, INPUT_CONSTANTS, COLLISION_CONFIG, HIT_FEEDBACK, SHARD_PAIR_CONSTANTS, SHARD_TILE_PAIR_CONSTANTS, SHARD_VARIANTS, NEBULA_CONSTANTS, randomPlasticShade, randomPlasticShardShade, cyclePlasticPalette, getActivePlasticPaletteName, cyclePlasticShardPalette, getActivePlasticShardPaletteName, cyclePlasticGlowBrightness, getActivePlasticGlowBrightnessName, cycleNebulaPalette, getActiveNebulaPaletteName, cycleNebulaStretch, getActiveNebulaStretchName, togglePlasticAutomataBrighten, isPlasticAutomataBrighten, PLASTIC_SHARD_FLOW_MULT, FLOW_VARIABILITY, MERGE_BLOWBACK, cycleShatterGrace, getActiveShatterGraceName, cyclePlayerThrust, getActivePlayerThrustName, getActivePlayerThrustMult, cyclePlayerSpeed, getActivePlayerSpeedName, getActivePlayerSpeedMult, cycleSnitchSpeed, getActiveSnitchSpeedName, getActiveSnitchSpeedMult, getPortalWarpDuration, getPortalWarpName, getPortalSizeName, getPortalGravityName, getPortalGravityRangeName, getPortalLensName, getPortalLensSpinName, getPortalLensRadiusName, getPortalTuningInfo, cycleSwarmMove, getActiveSwarmMoveName, getActiveMinimapMaterialName, getActiveLightingMode, getActiveLightingTier, getShardShadowsEnabled, getRefractionEnabled, getRefractBrightnessName, getLightBrightnessName, getEmissiveEnabled, getWorldLightsEnabled, getDepthAmbientEnabled, getEmitBrightnessName, getEmitShadowsEnabled, getEmitShadowTierName, getEmitFadeName, getCausticFadeName, getFlashlightName, getLightColorName, getTintMixName, getFogName, getShadowSoftnessName, getActiveRockPaletteName, getActiveStarDensityName, getActiveStarSizeName, getActiveStarBandsName, getActiveStarParallaxName, getActiveCollapseModeName, getWaveDurationSec, cycleEnemyScale, getActiveEnemyScaleName, cycleSimRate, getActiveSimRateName, getSimDt, getMaxSubsteps, cycleHudRate, getActiveHudRateName, getActiveHudRate, cycleSubstepCap, getActiveSubstepCapName, getActiveRenderScaleName, effectiveDpr, enemyHpMult, enemyDamageMult, hitReactStrength, CORROSION, DISABLE, ROCK_CHIP, ENEMY_NEBULA_BURST, KAMIKAZE_DETONATE_BUFFER, isCollectibleDrop, ENEMY_VARIANTS, BUBBLE_CONSTANTS, StructureVariant, RIVAL_CONSTANTS, RivalDisposition, PERF_CONTROLLER_CONSTANTS, STATION_CONSTANTS, OVERWORLD_CONSTANTS, MODULE_DEFS, ModuleDef, ModuleFamily, moduleDef, moduleFitsSlot, MODULE_SLOT_COUNT, MAX_INSTALLED_GUNS, SHIP_WEIGHT, INVENTORY_CAPACITY, COOLDOWN_FLOOR, MODULE_RESALE, MODULE_REQUIREMENTS, HEX_ADJACENCY, StationKind, StationServices, STATION_VARIANTS, OVERWORLD_STATIONS, PORTAL_CONSTANTS, HUB_PORTAL_SITES, BOSS_CONSTANTS, BOSS_DEFS, BOSS_ROTATION, STAGE_WAVE_COUNT, BossDef, WAVE_ANNOUNCE_CONSTANTS, noteTraitDamage, WEAPON_TRIGGERS, chargeTrigger, THRUST_TRIGGER, AUDIO_CONSTANTS, EXPLOSION_PROFILES, ExplosionProfile, computeMinimapRect, markDamaged, playerEjectSpeed, FLASHLIGHT_TOOL_LEVELS, setLightingTierOverride, getNebulaWakeSpinMode, PLAYER_ROLL_CONSTANTS, getActivePlayerRollAngle, getActivePlayerRollName, getActivePlayerHullName, getActiveRollDampingMult, getActiveRollDampingName, getActiveTiltMode, getActiveTiltModeName, getActiveLeanDirSign, getActiveLeanDirName, getActiveTiltSource, getActiveTiltSourceName, getActiveVelGainMult, getActiveVelGainName, getActiveShardCoatName, cycleFractureMode, getActiveFractureMode, FRACTURE_DETACH, MATERIAL_DAMAGE_CRACKS, crackConfigForVariant, isProgressiveFracture, getFractureRelaxName, getFractureSeparationName, getFractureSiteScaleName, getFractureBiasName } from '../constants';
import { TRIGGER_OFF } from './systems/DualSenseHID';
import { ASSETS } from '../assets';
import { invalidateCollisionR } from './entityCache';
import { ensureFractureCells, ensureFractureEdges, fractureRevealedEdgeCount } from './systems/fractureCache';
import { subtractBoundaryCell, polygonArea as fracturePolygonArea,
         pointToPolygonDistance2 } from './systems/fracture';
import { FlowFieldGrid } from './systems/FlowFieldGrid';
import { FlowPattern, samplePattern } from './systems/FlowField';
import type { FlowSampler } from './systems/FlowFieldGrid';
import { wrapDeltaX, wrapDeltaY, wrapPosition, MAP_WIDTH, MAP_HEIGHT, setMapDimensions } from './toroidal';
import { randomRockNebulaComposition } from './NebulaColor';
import { DragonInstance, updateDragons, spawnDragon, dragonDeath, dragonSegmentDeath } from './roamers/dragons';
import { RivalInstance, updateRivals, spawnRival } from './roamers/rivals';
import { updateSnitch } from './roamers/snitch';
import { updateBubbles, maintainAmbientBubbles, seedAmbientBubbles, updateAttachments, updateConsumers } from './roamers/bubbles';
import { updateBosses, payBossBounty, bossStatsSnapshot } from './bosses';
import { DebugControls } from './debugControls';
import { ShockwaveOpts, spawnShockwave as emitShockwave, updateExplosionRings, applyExplosionAoE,
         applyBlastToPlayer, applyKamikazeBlastToPlayer } from './explosions';
import { computeActiveSlots, applyModuleEffects, syncUnlocksToPlayer, syncLoadoutFromSlots,
         firstFreeSlotFor, areaSlots, resaleValue, statBreakdown,
         moveModuleInternal as moveModuleTiles, modulePrice as catalogPrice,
         outfittingSnapshot as buildOutfittingSnapshot } from './outfitting';

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


/** ENGINE-INTERNAL SURFACE (gauntlet 5f).  A member here declared WITHOUT
 *  `private` is not public API — it is reachable because the extracted engine
 *  modules (`engine/roamers/*`, …) are plain free functions taking
 *  `g: GameEngine`, which is how code moved out of this class without gaining
 *  an abstraction layer to route through (`docs/GAUNTLET_5F_LOG.md`, D1).
 *  `private` is compile-time only in TypeScript — the 5b suites already reach
 *  straight past it through `window.__omniEngine` — so widening it changes
 *  nothing at runtime.  The real public API is what `App.tsx` calls. */
// Audio-only tuning that belongs to a single call site each (SFX_INVENTORY
// §8.1).  PROVISIONAL, like every other number in this pass.
/** Consecutive salvage pickups inside this window climb the pickup scale. */
const SALVAGE_STREAK_WINDOW_MS = 1500;
/** Cap on that climb, so a long magnet train doesn't run off the top. */
const SALVAGE_STREAK_MAX = 11;

export class GameEngine {
  /** Not `private`: DebugControls reaches it for the joystick DBG toggle,
   *  and the Playwright suites drive the pad mapping through it (CLAUDE.md
   *  §8 — `private` is compile-time only, so the suites could read it either
   *  way; this just stops the compiler disagreeing with the debug menu). */
  input: InputSystem;
  physics: PhysicsSystem;
  /* Typed by the SEAM, not the class (gauntlet WebGPU stage 3): the engine
     depends on what a renderer must provide, and `new RenderSystem()` below
     is the concrete choice. Canvas2D remains the only implementation.

     `Renderer` is the SWAP CONTRACT (nine members, stable);
     `RendererDiagnostics` is the debug/perf surface that grows with the
     renderer and is not part of that contract. Split because 15 of the last
     15 additions were diagnostics — see engine/systems/Renderer.ts. */
  renderer: Renderer & RendererDiagnostics;
  private ai: AISystem;
  private particles: ParticleSystem;
  trails: TrailSystem;
  private projectiles: ProjectileSystem;
  private weapons: WeaponSystem;
  private drops: DropSystem;
  waves: WaveSystem;
  nebulas: NebulaSystem;
  // Stage 1 of shard-system overhaul — additive skeleton, no-op
  // update / onDeath.  Existing GameEngine + NebulaSystem code paths
  // still drive regen / shatter / merge.  See docs/SHARD_SYSTEM.md.
  shards: ShardSystem;
  entityIndex: EntityIndex;
  flowField: FlowFieldGrid;
  // Central performance controller — samples load each sim step and
  // hands every skippable pass an effective frame-skip interval.  See
  // engine/systems/PerfController.ts.
  perfController: PerfController;
  // SFX manager.  PUBLIC because UIOverlay's audio row (master volume +
  // mute) and the headless smokes both drive it directly — it holds no
  // simulation state, so there is nothing to protect.  See
  // docs/SFX_INVENTORY.md for the id contract and
  // engine/systems/AudioSystem.ts for the voice budget.
  public audio: AudioSystem;
  // Salvage-pickup streak: consecutive collections inside
  // SALVAGE_STREAK_WINDOW_MS step the pickup chime up a semitone, so a
  // magnetised cluster climbs a scale instead of rattling.  Audio-only
  // state — it feeds nothing else.
  private salvageStreak = 0;
  private salvageStreakAt = 0;

  // In-game FPS / perf capture harness (DBG tool).  Zero cost while idle;
  // records the per-frame timing + PerfSnapshot stream over a window and
  // exports a copy-paste text block (see engine/systems/PerfRecorder.ts).
  private perfRecorder: PerfRecorder = new PerfRecorder();

  private isRunning: boolean = false;
  gameState: GameState = GameState.MENU;
  lastTime: number = 0;
  // Fixed-timestep accumulator (Phase 1).  Frame delta is accumulated and the
  // simulation is stepped at SIMULATION_CONSTANTS.FIXED_DT until the
  // accumulator is drained; any remainder carries to the next frame.  This
  // decouples gameplay speed from display refresh rate so physics outcomes
  // are deterministic across devices.
  simAccumulator: number = 0;
  
  currentMap: BaseMapLayer | null = null;
  player: GameEntity;
  camera: CameraState;
  
  private damageTexts: DamageText[] = [];
  // Run score — tier-scaled enemy-kill points + early-clear wave bonuses.
  // Reset with the rest of the run state in resetAndLoadSelectedMap.
  score: number = 0;
  // HUD ticker — eases up toward `score` by integer steps each frame so
  // big awards roll up instead of snapping.  Display only; `score` is truth.
  private displayScore: number = 0;
  // Kill combo — `comboCount` rapid ship kills within `comboTimer`'s window
  // build a points multiplier (see comboMultiplier()).  Reset when the
  // window lapses.  Ship kills only; shard/tile kills don't touch it.
  private comboCount: number = 0;
  private comboTimer: number = 0;

  // ── Run-summary counters (Phase 3 Pair A, milestone A1) ─────────────────
  // Everything the death/run-summary overlay reports that no other system
  // already tracks.  RUN-scoped, so they are zeroed in
  // resetAndLoadSelectedMap() and deliberately NOT in loadMapFresh() — a
  // portal excursion is the same run, so its kills and seconds carry.
  private runKills: number = 0;          // enemy ships downed BY THE PLAYER
  private runCreditsEarned: number = 0;  // salvage income only (see earnCredits)
  // Salvage collected since the LAST DEATH.  The death screen reports this
  // rather than the run gross: what the player wants to know at the wreck is
  // "what did I bring back from THIS sortie", not a number that has been
  // climbing since the run began.  Snapshotted into `lastLifeCreditsEarned`
  // and zeroed at each death, so the next life starts its own tally.
  private lifeCreditsEarned: number = 0;
  private lastLifeCreditsEarned: number = 0;
  private runTimeSec: number = 0;        // SIM seconds — pauses/docks don't count
  private runWavesCleared: number = 0;   // clears across every arena this run
  private runHighestWave: number = 0;    // best wave NUMBER reached (1-based)
  private runBestCombo: number = 1;      // highest combo multiplier reached
  // Death beat: set when the player's explosion finishes instead of
  // respawning straight away.  While set the loop short-circuits (the
  // dockedAtStation precedent) and UIOverlay shows the run summary.  Death
  // SEMANTICS are unchanged — RESPAWN still calls respawnPlayer().
  private deathPending: boolean = false;
  // Counts down AFTER the wreck's explosion finishes and BEFORE the summary
  // appears — the boss stage-clear beat applied to the player's own death
  // (user call).  The sim keeps running through it AND through the screen
  // itself: unlike pause/dock/stage-clear, death does NOT freeze the world,
  // so the field stays alive behind the (semi-transparent) summary.
  private deathDelay: number = 0;
  // The summary is SNAPSHOTTED at the moment of death rather than rebuilt per
  // frame, precisely because the sim keeps running behind it — otherwise the
  // run clock would tick and stray kills would score while the player reads
  // their own obituary.
  private deathSummary: ReturnType<GameEngine['runSummarySnapshot']> | null = null;
  // ── Stage descent (boss capstone → deeper stage) ────────────────────────
  // A STAGE is one arena's ladder: BOSS_CONSTANTS.WAVE_INTERVAL ordinary waves
  // and then the boss's OWN capstone wave (STAGE_WAVE_COUNT waves in all), so
  // the capstone never lands inside a normal wave and cannot start until wave
  // WAVE_INTERVAL is cleared.  Killing that boss freezes the loop on a
  // STAGE-CLEAR screen
  // (the player is alive, so this pauses rather than ends) and opens a DESCENT
  // rift beside them.  From there the choice is in-world: down the new rift to
  // stage N+1, or back through the arena's return rift to the hub.
  //
  // `stageIndex` is 0-based DEPTH.  It drives WaveSystem.waveOffset, so enemy
  // growth and the boss rotation continue across a descent instead of
  // restarting with the arena's wave counter.  Returning to the HUB resets it
  // — the hub is the surface.
  stageIndex: number = 0;
  private stageClearPending: boolean = false;
  // Counts down AFTER the capstone dies and BEFORE the screen appears, so the
  // explosion, debris and salvage spray all land first.  The sim keeps running
  // during it — that is the point.
  stageClearDelay: number = 0;
  // Shape mirrors `EngineStats.stageClear` minus `mapName`, which the
  // snapshot fills from the live map.  (The `discountFraction` /
  // `discountSeconds` pair this used to carry died with the boss shop
  // discount; the capstone drops a module now — see §5 payout.)
  lastStageClear: {
    stage: number; bossName: string; nextStage: number;
    scoreAwarded: number; salvageCredits: number;
    rewardLabel?: string; rewardDesc?: string; rewardCredits?: number;
  } | null = null;
  // Salvage forfeited to the CURRENT death (shown on the summary) and across
  // the whole run (so repeated deaths read as a running cost).
  private lastDeathCreditsLost: number = 0;
  private runCreditsLost: number = 0;
  // ── Progression ─────────────────────────────────────────────────────────
  // Spendable Salvage currency — earned ONLY by collecting salvage drops in
  // the field (the score 1:1 mirror is gone).  Spent on module ITEMS at
  // shop stations; all reset per run.
  credits: number = 0;
  // 2-slot equip loadout (pivot 1b) — DERIVED from the weapon-group GUN
  // hexes via syncLoadoutFromSlots (WeaponSystem is untouched).
  equippedWeapons: (WeaponType | null)[] = [WeaponType.BLASTER, null];
  // ── Hex-slot outfitting with inventory (module-config increment) ────────
  // Modules are discrete non-upgradeable ITEMS (Mk varieties).  Purchases
  // land in `inventory` (tile grid, duplicates allowed); outfitting moves
  // items between inventory tiles and the two 7-hex groups.  Index 0 is
  // the center hex.  Guns mix freely with weapon mods in the weapon
  // flower, capped at MAX_INSTALLED_GUNS mounted (slot-agnostic count;
  // weaponless is allowed).  A module FUNCTIONS only while installed
  // AND its adjacency
  // requirement is met (MODULE_REQUIREMENTS fixpoint — see
  // computeActiveSlots); `activeShip`/`activeWeapon` cache the result.
  shipSlots: (string | null)[] = (() => {
      const s: (string | null)[] = new Array(MODULE_SLOT_COUNT).fill(null);
      s[0] = 'hull_base'; // free starter hull — the adjacency root, mounted center
      return s;
  })();
  weaponSlots: (string | null)[] = (() => {
      const s: (string | null)[] = new Array(MODULE_SLOT_COUNT).fill(null);
      s[0] = 'wpn_blaster'; // run starts with the starter gun mounted center
      return s;
  })();
  inventory: (string | null)[] = new Array(INVENTORY_CAPACITY).fill(null);
  activeShip: boolean[] = new Array(MODULE_SLOT_COUNT).fill(false);
  activeWeapon: boolean[] = new Array(MODULE_SLOT_COUNT).fill(false);
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
  currentWeaponIndex: number = 0;
  
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
  forcedTestEnemy: EnemySubtype | null = null;
  private difficultyLevel: number = 3;
  private enemyScale: number = 1;
  // Map the next restart / initial load should build.  Updated from the
  // main-menu map-style buttons so the UI-selected map survives the
  // restartGame() path (which re-instantiates the map class from scratch).
  // A new run starts on the HUB (roadmap step (k) decision): the player
  // spawns dock-adjacent at the home station and takes a portal out to an
  // arena, so the intended loop — earn → outfit → fight → return — is the
  // default path.  The main menu's map grid stays a direct-start override
  // (testing + the showcase maps); direct-starting an arena just skips the
  // hub, and run-state carry works identically either way.
  private selectedMapType: MapType = HUB_DESCRIPTOR.mapType;

  // Debug mode
  debugMode: boolean = false;

  // Player-trail shape — debug-only A/B selector.  CIRCLE matches the
  // production look; the rest are dev variants exposed via the DBG panel.
  trailShape: TrailShape = TrailShape.CIRCLE;
  // Player-trail direction mode — VELOCITY (default) extends the trail
  // opposite to velocity (current production look — points emitted at
  // player.position naturally trail behind via the ship's path through
  // space).  THRUST extends the trail opposite to the input/thrust
  // direction by accumulating a per-emit offset in -input.  Toggled
  // from the DBG panel.
  trailEmitMode: TrailEmitMode = TrailEmitMode.VELOCITY;

  // ── Performance toggle: player↔asteroid local gravity ───────────
  // PhysicsSystem.applyLocalGravity is the bidirectional pull
  // between the player ship and nearby asteroids (LOCAL_GRAVITY_
  // CONSTANTS).  Defaults to ON to match production; the DBG
  // panel's "LGrav" button flips it for measuring its cost in
  // isolation.
  localGravityEnabled: boolean = true;
  // ── Performance toggle: attractor gravity scan ──────────────────
  // PhysicsSystem.applyGravity walks the master entity list every
  // frame to apply each POI / attractor's gravity to in-range
  // entities.  On populated maps the outer loop iterates ~22k
  // tiles + shards + particles even when there are no attractors
  // active.  DBG panel's "Grav" button flips it off so the cost
  // can be measured in isolation.
  attractorGravityEnabled: boolean = true;
  // ── Performance toggle: SAT collision broadphase ────────────────
  // PhysicsSystem.handleEntityCollisions is the dynamic-grid
  // broadphase + SAT polygon resolver.  Off mode disables the
  // entire pass — projectiles fly through everything, ships clip,
  // tiles aren't destructible — purely for measuring the isolated
  // cost in the perf overlay.  Defaults to ON.
  collisionsEnabled: boolean = true;

  // Debug toggle — gates the dedicated mobile-shard ↔ static-tile
  // collision scan in PhysicsSystem.  Defaults to OFF: today's
  // broadphase doesn't pair these (shards skip the outer loop), so
  // mobile shards drift through tiles' geometry; flipping ON adds
  // the missing scan and the asteroid-crash branch starts firing.
  shardTileCollisionsEnabled: boolean = true;

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
  shakeTimer: number = 0;
  shakeIntensity: number = 0;
  /** Impact axis for the current shake, normalised; (0,0) = no direction, so
   *  the camera falls back to the isotropic jitter.  See handleScreenShake. */
  shakeDirX: number = 0;
  shakeDirY: number = 0;
  // DBG toggle — when false, handleScreenShake early-returns and
  // the camera stays anchored regardless of impact magnitude.
  // ON by default (user call).  Shake is the game's primary impact feedback —
  // what a crash, a detonation and a boss landing all read through — and it
  // shipped OFF, so the default build had no camera reaction to any of them.
  // (Rumble is unaffected either way: `handleScreenShake` fires it ABOVE this
  // gate on purpose.)  DBG ▸ Visual ▸ "Shake" is the off switch.
  screenShakeEnabled: boolean = true;

  // ── Asteroid/shard flow-field DBG state ──────────────────────────────
  // When `shardFlowEnabled` is false, the per-asteroid / per-drop
  // velocity nudge in updatePhysics is skipped entirely.  Asteroids that
  // were moving keep their current velocity but receive no further
  // streamline correction; combined with `linearDamping` they decay
  // toward zero velocity over a few seconds and then only move when
  // collided with or pulled by gravity.  Default true.
  shardFlowEnabled: boolean = true;

  // ── Snitch state ──────────────────────────────────────────────────────
  // One quidditch-style snitch that persists across waves: rides the
  // asteroid flow field with a burst/coast AI; catching it pays
  // SCORE_CONSTANTS.SNITCH_POINTS and ends the current wave (see
  // updateSnitch / catchSnitch).  A fresh one spawns for the next wave.
  snitch: GameEntity | null = null;
  // Wander clock for the weave oscillation (sim-time accumulated).
  snitchTime: number = 0;
  // Snitches CAUGHT this run — drives the speed ramp (NOT the wave number),
  // so the player can defer the snitch to keep it slow.  Reset per run.
  snitchCatchCount: number = 0;
  // Catch interaction — DBG-toggleable while playtesting collide vs shoot.
  snitchCatchMode: 'collide' | 'shoot' = 'collide';
  // Burst/coast AI state (see the SNITCH_CONSTANTS doc block) — there is
  // only ever one live snitch, so engine-level fields suffice; all of
  // these are re-seeded in spawnSnitch().
  snitchAiState: 'coast' | 'dart' = 'coast';
  snitchAiTimer: number = 0;        // countdown to the next state flip
  snitchPanicCooldown: number = 0;  // guaranteed coast window between panic darts
  snitchSpeedMult: number = 0;      // eased current speed (fraction of player cruise)
  snitchDartAway: boolean = false;  // current dart is a panic dart (away-bias active)
  snitchDartAwayX: number = 0;
  snitchDartAwayY: number = 0;

  // ── Ambient bubble fauna (Stage 5) ────────────────────────────────────────
  // Bubbles are always-present roamers, not wave enemies.  maintainAmbient-
  // Bubbles keeps at least BUBBLE_CONSTANTS.AMBIENT_POPULATION alive, spawning
  // one offscreen each time this top-up timer elapses while the field is short.
  ambientBubbleTimer: number = 0;

  // ── Dragon mini-boss (Stage 6) ────────────────────────────────────────────
  // Any number of engine-managed segmented serpents at once.  Each head is a
  // normal ENEMY (damageable / routed through handleEntityDeath); per-dragon
  // lifecycle + movement + Snake-body live on its DragonInstance, and the
  // behaviour lives in engine/roamers/dragons.ts.
  dragons: DragonInstance[] = [];
  _dragonEatBuf: GameEntity[] = []; // reused tile-devour scratch (no per-frame alloc)
  dragonsKilled = 0; // kill payout doubles each kill (3000 → 6000 → 12000 …)
  // Stage 7 player-like roamers; behaviour lives in engine/roamers/rivals.ts.
  rivals: RivalInstance[] = [];
  nextRivalScore = RIVAL_CONSTANTS.SCORE_INTERVAL; // score at which the next rival warps in

  // ── (h) Bosses ────────────────────────────────────────────────────────────
  // A boss is an ordinary wave enemy carrying a BOSS_DEFS phase table, so the
  // only engine state it needs is the live-boss handle the HUD bar reads and
  // the TIMED shop discount from the model-(d) payout (salvage + discount, no
  // unlock plumbing).  All three are run-scoped — reset with credits/score.
  liveBoss: GameEntity | null = null;
  bossesKilled = 0;

  // ── Space station POI + docking (economy-pivot 1e) ────────────────────────
  // The station lives on the OVERWORLD map (found by isStation at map load).
  // Docking = proximity (one O(1) torus distance per sim step) + an explicit
  // action (E key / HUD DOCK button).  While `dockedAtStation` the loop
  // short-circuits the sim exactly like the removed cardChoicePending card
  // modal did (field stays drawn behind the React station UI) and the
  // station UI hosts the Drydock shop, the loadout swaps, and hull repair.
  // Undocked = locked loadout: equipWeapon / purchaseUnlock / purchase-
  // Upgrade are guarded on this flag.
  private stations: GameEntity[] = [];
  private nearestStation: GameEntity | null = null; // nearest in dock range this step
  private dockedStation: GameEntity | null = null;
  private dockedAtStation: boolean = false;
  private dockInRange: boolean = false;
  private dockKeyHeld: boolean = false; // E-key edge detector (dock + undock + portal)
  // Map portals (roadmap step (k)) — cached at map load exactly like the
  // stations, and checked with the same proximity pattern.  Stations and
  // portals SHARE the E key: `updateInteractables` arbitrates by nearest
  // in-range, so at most one of `nearestStation` / `nearestPortal` is set
  // on any step and the affordance always names the action it will take.
  portals: GameEntity[] = [];
  private nearestPortal: GameEntity | null = null; // nearest in use range this step
  // Debris-transit queue (PORTAL_CONSTANTS.TRANSIT): loose entities captured
  // around the player at portal entry, waiting out their stagger delay before
  // emerging from the exit rift.  Queued entities exist NOWHERE else — they
  // join currentMap.entities only when updatePortalTransit releases them.
  // Cleared by loadMapFresh, so a second hop (or a restart) before the queue
  // drains means the wormhole simply kept the stragglers.
  private portalTransit: { entity: GameEntity; delay: number }[] = [];
  // Transit warp — the flight THROUGH the wormhole (PORTAL_CONSTANTS.WARP).
  // Wall-clock seconds remaining, and the length it started at, so the render
  // side can be handed a plain 0->1 progress.  Non-zero FREEZES the sim, the
  // stage-clear pattern: nothing may shoot the player while they are inside
  // the tunnel, and a frozen sim is what leaves the wall clock free to drive
  // the beat.
  private portalWarpTimer: number = 0;
  private portalWarpDuration: number = 0;
  private portalTransitExit: Vector2 = { x: 0, y: 0 };
  // Overworld roaming dragon — first spawn shortly after run start, then a
  // fresh rift a while after the previous dragon dies or leaves.
  private overworldDragonTimer: number = OVERWORLD_CONSTANTS.DRAGON_FIRST_SPAWN_SEC;

  // Overlay toggles — gate the RenderSystem's asteroid/shard FF overlay
  // pass on/off independently.  All default OFF; debug-only.
  ffOverlayVectors:   boolean = false;
  ffOverlayCells:     boolean = false;
  ffOverlayObstacles: boolean = false;
  ffOverlayRebuilds:  boolean = false;
  // Vector overlay stride — cycles through SAMPLE_N_CYCLE so a coarser
  // sweep doesn't bury detail on dense maps.  Cells/obstacles/rebuild
  // overlays always render every cell.
  ffOverlaySampleN: number = 1;
  // Cycle of cell sizes for the DBG "FF Density" toggle.  Coarsest
  // first (matches the existing default).  Each step rebuilds both
  // grids — asteroid field via the analytical formula + repulsion,
  // pursuit field lazily on the next sample.  Note: pursuit-field
  // range (MAX_ENEMY_RANGE) is measured in cells, so shrinking the
  // cell size also shrinks the world-units range — at 32 / 6 ≈ 50 %
  // of the default the BFS only fans out ~350 units, leaving enemies
  // outside that radius to rely on direct steering.  DBG-only knob;
  // production stays at the default 256.
  ffCellSize: number = 48;
  // Wall-repulsion kernel radius for the asteroid field, in cells.
  // R = 0 → legacy 4-cardinal-only scan (A/B baseline); R = 1..5 →
  // (2R+1)² neighbourhood with 1/d² falloff so the flow curves around
  // tile clusters from several cells away.  Default 3 — matches the
  // FlowFieldGrid default constant.  DBG-cycle via "FF KernelR".
  ffKernelR: number = 5;
  // Tangent-mix factor for the wall-repulsion contribution.  0 = pure
  // radial (push perpendicular away from walls — current behaviour
  // produces opposing vectors on opposite sides of a long wall and
  // traps shards in the saddle along the boundary).  1 = pure tangent
  // (slide along the wall in the direction of the base flow — both
  // sides of the wall now point the same way along the wall, no
  // saddle).  Default 0.5 — meaningful tangent contribution while
  // still preserving some push-away behaviour.  DBG-cycle.
  ffTangentMix: number = 0.5;
  // Breathing field — scroll rate (rad/s) for the slow undulation
  // that migrates convergence zones so shard piles dissolve.  0 = off
  // (static field, no periodic re-bake).  DBG-cycle "FF Breathe":
  // off / slow / med / fast.
  ffBreatheRate: number = 0;
  ffBreathePhase: number = 0;
  private ffBreatheRebakeTimer: number = 0;
  // Seconds between breathing re-bakes.  ~3 Hz: smooth enough for a
  // slow drift, cheap enough that the per-bake cost (sub-ms at default
  // density) is negligible.
  private static readonly FF_BREATHE_REBAKE_INTERVAL = 0.33;
  // Per-shard lane jitter — strength of the persistent perpendicular
  // offset added to each shard's flow target so shards ride slightly
  // different parallel lanes instead of collapsing onto one streamline.
  // 0 = off.  DBG-cycle "FF Lane": off / low / med / high.
  ffLaneJitter: number = 0.2;
  // Selectable base-flow pattern (DBG "FF Pattern").  DEFAULT routes to
  // the active map's own sampleFlow(); the rest swap in an analytical
  // field (circular / spiral / gravity well / directional / wavy …).
  // Persists across map loads so a pattern can be compared on different
  // maps.  Cycling re-bakes the asteroid field with the chosen sampler;
  // kernel / tangent / breathing all still apply on top.
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
  ffPattern: FlowPattern = FlowPattern.DEFAULT;

  // Tile regeneration is owned by ShardSystem (Stage 2 of shard-system
  // overhaul).  GameEngine.handleEntityDeath calls
  // `this.shards.queueRegen(entity)` for every shard-family death;
  // ShardSystem.update() drains the queue per fixed-step dt.

  // Fast drop lookup — avoids scanning all ~22k map entities every frame
  activeDrops: GameEntity[] = [];

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
  // Raw per-FRAME sim time (sum of updatePhysics + updateGameLogic across every
  // substep this frame) — the unsmoothed spike signal the Perf REC recorder
  // reads for tail attribution (distinct from the 60-frame-averaged
  // PerfSnapshot sim timers, which can't localise a single 50ms frame).
  private lastFrameSimMs: number = 0;
  /** Substeps the accumulator drained on the last frame (0..MAX_SUBSTEPS).
   *  `lastFrameSimMs` alone is ambiguous: at a fixed 120 Hz sim a 33 ms frame
   *  legitimately costs twice the sim of a 16 ms one, so a rising sim total
   *  can mean "the sim got slower" OR "the frame got longer and pulled more
   *  substeps in".  Pairing the two separates the sim's own cost from the
   *  substep-bunching a slow frame causes — the frame-PACING signal. */
  private lastFrameSteps: number = 0;
  /** Wall time of the `onStatsUpdate` CALL — i.e. how long it takes to
   *  SCHEDULE a React update, NOT how long React then spends rendering one.
   *  `onStatsUpdate` is a setState called from a rAF callback: React 18/19
   *  batches it and defers reconciliation past the end of this callback, so
   *  this bracket closes before any of the work it was once captioned as
   *  measuring has happened.  It is kept, under an honest name, as the
   *  CONTROL for that claim — it should stay near zero while `uiActualMs`
   *  moves.  The real cost is measured by `<Profiler>` (see noteUiRender). */
  private lastStatsScheduleMs: number = 0;
  // ── React reconciliation cost, reported IN by the UI layer ────────────
  //
  // Written by the `<Profiler onRender>` wrapped around `<UIOverlay>` in
  // App.tsx.  Plain field writes, never a setState — an instrument that
  // re-renders the tree it is measuring is its own load.
  //
  // Accumulated across commits and CONSUMED once per frame (see `loop`), so
  // a frame that committed nothing records 0 rather than repeating the last
  // commit's cost.  React commits after the rAF callback that scheduled
  // them, so what a frame consumes belongs to the PREVIOUS frame's push.
  private uiActualAccum: number = 0;
  private uiBaseAccum: number = 0;
  private uiCommitAccum: number = 0;
  private lastUiActualMs: number = 0;
  private lastUiBaseMs: number = 0;
  private lastUiCommits: number = 0;

  /** True once the `<Profiler>` has reported even one commit.
   *
   *  This exists because of the single most dangerous failure mode in this
   *  measurement: React's SHIPPING `react-dom` build strips the profiler
   *  timers, so `onRender` never fires and the UI cost reads exactly 0.00 —
   *  which is indistinguishable from "reconciliation is free".  A measurement
   *  build (`OMNI_PROFILE_REACT=1 npx vite build`, see vite.config.ts) keeps
   *  them.  Anything reporting the ui figures must report this flag beside
   *  them, so a zero is readable as EITHER "measured, and cheap" or "not
   *  measured at all". */
  public uiProfilerSeen: boolean = false;

  /** Fold one React commit of the UI tree into this frame's totals.
   *  `actualDuration` is what the commit cost; `baseDuration` is what it
   *  would have cost with no memoization anywhere. */
  public noteUiRender(actualDuration: number, baseDuration: number): void {
    this.uiProfilerSeen = true;
    this.uiActualAccum += actualDuration;
    this.uiBaseAccum += baseDuration;
    this.uiCommitAccum++;
  }
  /** Seconds accrued toward the next HUD (React) push — see HUD_RATE_CYCLE. */
  statsPushAccum: number = 0;
  // Last-seen values for the Perf REC event timeline (see markPerfEvents).
  private _pmWave = -1;
  private _pmState = '';
  private _pmBoss = false;
  private _pmMap = '';
  private _pmDead = false;
  private _pmStage = false;
  private _pmDocked = false;
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
  private perfLighting      = new Float64Array(GameEngine.PERF_WINDOW);
  private perfFog           = new Float64Array(GameEngine.PERF_WINDOW);
  private perfRenderIdx: number = 0;
  private perfRenderFilled: number = 0;
  // Latest count snapshot from the most recent prepareFrameEntities() pass.
  // Stored as a mutable struct so getPerfSnapshot() can read it without
  // rebuilding the object each frame.
  private perfCounts = {
      totalEntities: 0,
      enemyCount: 0,
      mobileShardCount: 0,
      projectileCount: 0,
      particleCount: 0,
      interactableCount: 0,
  };


  /** The DEBUG MENU — every toggle and cycle behind pause ▸ Debug Menu, moved
   *  to engine/debugControls.ts in gauntlet 5f.  Called from the UI as
   *  `engine.dbg.<toggle>()`; the flags they write are still engine fields. */
  readonly dbg = new DebugControls(this);

  /** Flashlight Kit tool state (user call): whether the kit module is
   *  installed+active (folded by applyModuleEffects), and the tap-cycled
   *  level (index into FLASHLIGHT_TOOL_LEVELS: 0 off / 1 medium / 2 high).
   *  Run-scoped like the outfit it derives from. */
  public flashlightEquipped: boolean = false;
  public flashlightLevel: number = 0;

  /** Toggle the enemy counterplay traits (armor chip-resist, …) for A/B.
   *  The one debug row that stayed a method on the engine: the 5b trait
   *  suites call it straight off `window.__omniEngine`, which makes it
   *  observable surface (ledger P7). */
  public toggleTraits() {
    this.physics.traitsEnabled = !this.physics.traitsEnabled;
    // The AI-side trait (evasive) switches with the damage-side ones (armor) —
    // one DBG toggle for the whole counterplay layer.
    this.ai.traitsEnabled = this.physics.traitsEnabled;
  }

  private onStatsUpdate: (stats: EngineStats) => void;

  constructor(onStatsUpdate: (stats: EngineStats) => void, difficultyLevel: number = 3) {
    this.onStatsUpdate = onStatsUpdate;
    const clamped = Math.min(3, Math.max(0, Math.round(difficultyLevel)));
    this.difficultyLevel = clamped;
    this.enemyScale = DIFFICULTY_SCALES[clamped] ?? 1;
    
    this.input = new InputSystem();
    // Audio: the AudioContext is NOT created here.  Mobile browsers
    // refuse to start audio outside a user gesture, so the manager only
    // arms one-shot window listeners and builds its graph on the first
    // real tap/click/keypress (including a menu tap, which on phones is
    // usually the first gesture there is).
    this.audio = new AudioSystem();
    registerSfx(this.audio);
    this.audio.armGestureUnlock();
    this.physics = new PhysicsSystem();
    this.renderer = new RenderSystem();
    // Wire physics into the renderer so the material-tile branch can
    // suppress edge strokes on edges that are cleanly butted against
    // a neighbour tile (queried via hasStaticTileNear).
    this.renderer.setPhysics(this.physics);
    // Physics-side SFX sink (shield absorb/deflect/break, armor chip,
    // crashes).  One generic hook so PhysicsSystem never imports audio
    // state — see PhysicsSystem.sfx.
    this.physics.sfx = (id, x, y, opts) =>
        this.audio.play(id, { x, y, gain: opts?.gain, pitch: opts?.pitch });
    this.ai = new AISystem();
    this.particles = new ParticleSystem();
    this.trails = new TrailSystem();
    this.projectiles = new ProjectileSystem();
    this.weapons = new WeaponSystem(this.projectiles);
    this.weapons.onEnemyFire = (id, x, y) => this.audio.play(id, { x, y });
    this.drops = new DropSystem(this.particles);
    this.drops.sfx = (id, x, y) => this.audio.play(id, { x, y });
    this.waves = new WaveSystem();
    this.nebulas = new NebulaSystem(this.particles, this.drops);
    this.shards = new ShardSystem(this.particles);
    this.shards.sfx = (id, x, y) => this.audio.play(id, { x, y });
    // Wire the variant-specific completion hook for the
    // neighbourhood-blend regen path (today: nebula-tile only).
    this.shards.setRegenAdapter(this.nebulas);
    // The renderer's bonded-pair blend pass reads the live bond list —
    // presentation only, and the only thing in the renderer that knows
    // ShardSystem exists.
    this.renderer.setShards(this.shards);
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
    // through allocation-heavy `sampleShardFlow()` calls.
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
      gold: 0,
      shield: SHIELD_CONSTANTS.MAX_CHARGE,
      maxShield: SHIELD_CONSTANTS.MAX_CHARGE,
      shieldRechargeTimer: 0,
      shieldHitFlash: 0
    };
    syncUnlocksToPlayer(this);
    syncLoadoutFromSlots(this); // derive loadout from gun hexes + apply module effects

    this.camera = {
      position: { x: 0, y: 0 },
      zoom: CAMERA_CONSTANTS.DEFAULT_ZOOM,
      targetId: 'player',
      shakeOffset: { x: 0, y: 0 }
    };

    this.loadMap(this.buildMap(this.selectedMapType));
  }

  /**
   * Resolve the base-flow sampler for the given map under the current
   * DBG pattern selection.  DEFAULT uses the map's own sampleFlow();
   * any other pattern swaps in the corresponding analytical field.
   * Used at map load and at every re-bake (density / pattern cycle)
   * so the selection sticks.
   */
  flowSamplerFor(map: BaseMapLayer): FlowSampler {
    if (this.ffPattern === FlowPattern.DEFAULT) {
      return (x, y) => map.sampleFlow(x, y);
    }
    const p = this.ffPattern;
    return (x, y) => samplePattern(p, x, y);
  }

  /** Factory for the per-run map class so both the constructor and
   *  restartGame() share a single construction path. */
  private buildMap(type: MapType): BaseMapLayer {
    switch (type) {
      case MapType.OVERWORLD:            return new OverworldMap();
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
      // Start is a user gesture by construction, so this doubles as a
      // guaranteed unlock point on top of the window listeners.
      this.audio.unlock();
      this.audio.play('ui.confirm');
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
    seedAmbientBubbles(this); // always-present fauna, ready from frame one
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
      currentWeapon: this.player.currentWeapon !== undefined ? WEAPONS[this.player.currentWeapon].name : 'None',
      gameState: this.gameState,
      difficulty: this.difficultyLevel,
      waveNumber: this.waveIndex + 1,
      waveStatus: 'active',
      wavesEnabled: true, // skip only exists during wave gameplay
      waveGraceTimer: undefined,
      waveElapsedSec: this.waveState === 'active' ? Math.floor(this.waves.elapsedSecPublic) : undefined,
      enemiesRemaining: this.waveState === 'active' && this.currentMap ? this.waves.enemiesRemaining(this.currentMap.entities) : undefined,
      boss: bossStatsSnapshot(this),
      score: Math.round(this.displayScore),
      comboMultiplier: this.comboMultiplier(),
      comboCount: this.comboCount,
      comboFraction: this.comboTimer > 0 ? this.comboTimer / SCORE_CONSTANTS.COMBO_WINDOW_SEC : 0,
      credits: this.credits,
      salvageFlash: this.player.salvagePickupFlash ? {
        amount: this.player.salvagePickupFlash.amount,
        fraction: Math.max(0, this.player.salvagePickupFlash.timer / 0.75),
      } : undefined,
      vitals: {
        health: Math.max(0, Math.round(this.player.health)),
        maxHealth: Math.round(this.player.maxHealth),
        shield: Math.max(0, Math.round(this.player.shield ?? 0)),
        maxShield: Math.round(this.player.maxShield ?? 0),
      },
      playerStats: this.gameState === GameState.PAUSED ? {
        health: Math.max(0, Math.round(this.player.health)),
        maxHealth: this.player.maxHealth,
        shield: Math.max(0, Math.round(this.player.shield ?? 0)),
        maxShield: this.player.maxShield ?? 0,
        damageMult: this.player.damageMult ?? 1,
        cooldownMult: this.player.cooldownMult ?? 1,
        speedMult: this.moduleSpeedMult,
        shipWeight: this.shipWeight,
        position: {
          x: Math.round(this.player.position.x),
          y: Math.round(this.player.position.y),
        },
      } : undefined,
      outfitting: this.gameState === GameState.PAUSED ? this.outfittingSnapshot() : undefined,
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
      playerNebulaCollisionEnabled: this.physics.playerNebulaCollisionEnabled,
      shardSleepEnabled: this.physics.shardSleepEnabled,
      shardViewportCullEnabled: this.physics.shardViewportCullEnabled,
      shardLodEnabled: this.renderer.shardLodEnabled,
      mergeRateEnabled: this.perfController.mergeRateEnabled,
      screenShakeEnabled: this.screenShakeEnabled,
      tileOutlinesEnabled: this.renderer.tileOutlinesEnabled,
      chevronsOffscreenOnly: this.renderer.chevronsOffscreenOnly,
      damageTriggeredBars: this.renderer.damageTriggeredBars,
      minimapMaterialName: getActiveMinimapMaterialName(),
      lightingModeName:  getActiveLightingMode(),
      lightingTierName:  getActiveLightingTier().name,
      shardShadowsEnabled: getShardShadowsEnabled(),
      refractionEnabled: getRefractionEnabled(),
      refractBrightnessName: getRefractBrightnessName(),
      lightBrightnessName: getLightBrightnessName(),
      emissiveEnabled: getEmissiveEnabled(),
      worldLightsEnabled: getWorldLightsEnabled(),
      depthAmbientEnabled: getDepthAmbientEnabled(),
      emitBrightnessName: getEmitBrightnessName(),
      emitShadowsEnabled: getEmitShadowsEnabled(),
      emitShadowTierName: getEmitShadowTierName(),
      emitFadeName: getEmitFadeName(),
      causticFadeName: getCausticFadeName(),
      flashlightName: getFlashlightName(),
      lightColorName: getLightColorName(),
      tintMixName: getTintMixName(),
      fogName: getFogName(),
      shadowSoftnessName: getShadowSoftnessName(),
      rockPaletteName: getActiveRockPaletteName(),
      fractureModeName: getActiveFractureMode(),
      fractureRelaxName: getFractureRelaxName(),
      fractureSeparationName: getFractureSeparationName(),
      fractureSiteScaleName: getFractureSiteScaleName(),
      fractureBiasName: getFractureBiasName(),
      nebulaWakeSpinName: getNebulaWakeSpinMode(),
      repelPushEnabled: this.physics.repelPushEnabled,
      shardBlendEnabled: this.renderer.shardBlendEnabled,
      shardBlendCount: this.renderer.lastShardBlendCount,
      shardCoatName: getActiveShardCoatName(),
      plasticAutomataEnabled: this.renderer.plasticAutomataEnabled,
      plasticAutomataBrighten: isPlasticAutomataBrighten(),
      materialAutomataEnabled: this.renderer.materialAutomataEnabled,
      plasticPaletteName: getActivePlasticPaletteName(),
      plasticShardPaletteName: getActivePlasticShardPaletteName(),
      plasticGlowBrightnessName: getActivePlasticGlowBrightnessName(),
      nebulaPaletteName: getActiveNebulaPaletteName(),
      plasticBlendEnabled: this.nebulas.plasticBlendEnabled,
      nebulaStretchName:   getActiveNebulaStretchName(),
      shatterGraceName:   getActiveShatterGraceName(),
      playerThrustName: getActivePlayerThrustName(),
      playerSpeedName: getActivePlayerSpeedName(),
      shardFlowEnabled: this.shardFlowEnabled,
      snitchCatchMode: this.snitchCatchMode,
      gamepadInfo: this.input.padDebugName(),
      gamepadAxes: this.input.padDebugAxes(),
      rumbleInfo: this.input.rumbleDebugInfo(),
      joystickForceVisible: this.input.joystickForceVisible,
      controlScheme: this.input.getControlScheme(),
      rumbleEnabled: this.input.rumbleEnabled,
      adaptiveTriggersSupported: this.input.adaptiveTriggersSupported(),
      adaptiveTriggersConnected: this.input.adaptiveTriggersConnected(),
      adaptiveTriggerInfo: this.input.adaptiveTriggerDebugInfo(),
      adaptiveTriggerReport: this.input.adaptiveTriggerReportHex(),
      snitchSpeedName: getActiveSnitchSpeedName(),
      portalWarpName: getPortalWarpName(),
      portalSizeName: getPortalSizeName(),
      portalGravityName: getPortalGravityName(),
      portalGravityRangeName: getPortalGravityRangeName(),
      portalLensName: getPortalLensName(),
      portalLensSpinName: getPortalLensSpinName(),
      portalLensRadiusName: getPortalLensRadiusName(),
      portalTuningInfo: getPortalTuningInfo(),
      rollFeelName: getActivePlayerRollName(),
      hullModeName: getActivePlayerHullName(),
      rollDampName: getActiveRollDampingName(),
      tiltModeName: getActiveTiltModeName(),
      leanDirName: getActiveLeanDirName(),
      tiltSourceName: getActiveTiltSourceName(),
      velGainName: getActiveVelGainName(),
      enemyScaleName: getActiveEnemyScaleName(),
      simRateName: getActiveSimRateName(),
      hudRateName: getActiveHudRateName(),
      substepCapName: getActiveSubstepCapName(),
      swarmMoveName: getActiveSwarmMoveName(),
      starDensityName: getActiveStarDensityName(this.currentMap?.type),
      starSizeName: getActiveStarSizeName(),
      starBandsName: getActiveStarBandsName(),
      starParallaxName: getActiveStarParallaxName(this.currentMap?.type),
      collapseModeName: getActiveCollapseModeName(),
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
    // The docked station UI and the death/run-summary screen already freeze
    // the sim; stacking the pause menu on top would double up two
    // full-screen overlays.
    if (this.gameState === GameState.PLAYING && !this.dockedAtStation
        && !this.deathPending && !this.stageClearPending) {
        this.gameState = GameState.PAUSED;
        this.audio.play('ui.back');
    }
  }

  public resumeGame() {
    if (this.gameState === GameState.PAUSED) {
        this.gameState = GameState.PLAYING;
        this.audio.play('ui.confirm');
        this.lastTime = performance.now(); // Prevent physics jump
        this.simAccumulator = 0;           // Drop stale accumulated time from pause
    }
  }

  /** Tear down MAP-SCOPED state and load a fresh copy of `type`.
   *
   *  Everything cleared here rebuilds for the new map on EVERY path —
   *  a new run and a portal transition alike: the per-map entity list
   *  and the caches keyed to it (shards, perf tiers, drops, wave
   *  announcements, damage text), and the roamers whose entities die
   *  with the old map (snitch / dragons / rivals).  RUN-SCOPED state
   *  (credits, outfit, score, hull, and the per-run counters that ride
   *  alongside them) is deliberately NOT touched — resetAndLoadSelectedMap
   *  resets that on top; transitionToMap preserves it.  That split is
   *  what makes run state carry across a portal (decision #39d). */
  private loadMapFresh(type: MapType) {
      this.shards.reset();
      this.perfController.reset();
      this.activeDrops = [];
      this.portalTransit.length = 0;
      this.trailEmitAccumulator = 0;
      this.wasThrustingLastFrame = false;
      this.chainBreakPending = false;
      this.waveAnnouncements = [];
      this.damageTexts = [];
      // Snitch entity dies with the old map's entity list — just drop the
      // reference so the next wave spawns a fresh one.  The per-run CATCH
      // COUNT (which ramps snitch speed) is run state and stays.
      this.snitch = null;
      this.snitchTime = 0;
      this.dragons = []; // die with the old map's entity list
      this.rivals = [];  // rival ships die with the old map
      // A boss belongs to the wave it capstoned; wave progress is fresh per
      // entry, so drop the handle with the map.  The RUN-scoped discount it
      // paid is economy state and survives the transition.
      this.liveBoss = null;
      // Station / docking / portal state — the POI entities themselves are
      // rebuilt with the map (loadMap re-finds them); the overworld dragon
      // timer restarts its first-spawn countdown.
      this.dockedAtStation = false;
      this.dockInRange = false;
      this.overworldDragonTimer = OVERWORLD_CONSTANTS.DRAGON_FIRST_SPAWN_SEC;
      this.loadMap(this.buildMap(type));
  }

  /** Park the player (and the camera) at the freshly-loaded map's declared
   *  spawn point, dropping the motion state that belongs to the old map.
   *  Hull / shield / outfit are untouched — the callers decide those. */
  private placePlayerAtSpawn(override?: Vector2) {
      const spawn = override ?? this.currentMap?.playerSpawn ?? { x: 0, y: 0 };
      this.player.position = { ...spawn };
      this.player.velocity = { x: 0, y: 0 };
      this.player.trail = [];
      this.trailEmitAccumulator = 0;
      this.wasThrustingLastFrame = false;
      this.chainBreakPending = false;
      this.camera.position = { ...spawn };
      this.shakeTimer = 0;
      this.camera.shakeOffset = { x: 0, y: 0 };
  }

  /** Reset all run state and load a fresh copy of `selectedMapType`.
   *  Shared by restartGame() (→ MENU) and the mid-game map switch in
   *  setMapType() (→ PLAYING).  Leaves gameState untouched; the caller
   *  decides the target state and pushes the frame. */
  private resetAndLoadSelectedMap() {
      this.loadMapFresh(this.selectedMapType);

      // ── Run-scoped reset — the half a portal transition SKIPS ──────────
      // Per-run counters that ride with the score/economy rather than with
      // the map: the snitch speed ramp, the doubling dragon payout, and the
      // score-cadence rival warp-ins.
      this.snitchCatchCount = 0;
      this.dragonsKilled = 0;
      this.nextRivalScore = RIVAL_CONSTANTS.SCORE_INTERVAL;
      // Boss payouts ((h) model (d)) are run-scoped like the credits they
      // discount — a new run starts at full price with no boss in the world.
      this.bossesKilled = 0;
      this.liveBoss = null;

      // Run-summary counters (A1) — the whole point of resetting them HERE is
      // that a portal excursion (transitionToMap) leaves them alone, so one
      // run's summary spans every map it visited.
      this.runKills = 0;
      this.runCreditsEarned = 0;
      this.lifeCreditsEarned = 0;
      this.lastLifeCreditsEarned = 0;
      this.runTimeSec = 0;
      this.runWavesCleared = 0;
      this.runHighestWave = 0;
      this.runBestCombo = 1;
      this.deathPending = false;
      this.deathDelay = 0;
      this.deathSummary = null;
      this.stageIndex = 0;
      this.stageClearPending = false;
      this.stageClearDelay = 0;
      this.lastStageClear = null;
      this.lastDeathCreditsLost = 0;
      this.runCreditsLost = 0;

      // Per-run progression reset — must precede the health/shield refill
      // below so maxHealth/maxShield are back at base before they're topped.
      this.credits = 0;
      this.resetOutfit(); // back to lean (bare hexes, empty inventory, Blaster on W1)

      // Clear the WRECK state too (A1).  Before the run-summary screen the
      // player could never be mid-explosion at a run reset — the auto-respawn
      // always cleared it first.  Now RESTART RUN / MAIN MENU are reachable
      // from the death screen, so a reset that left `isExploding` set would
      // re-raise the death screen on the next step (explosionTimer is already 0).
      this.player.isExploding = false;
      this.player.explosionTimer = undefined;
      this.player.active = true;
      this.player.sprite = ASSETS.PLAYER_SHIP;
      this.player.health = this.player.maxHealth;
      this.player.shield = this.player.maxShield;
      this.player.shieldRechargeTimer = 0;
      this.player.shieldHitFlash = 0;
      this.player.statusEffects = [];
      this.player.gold = 0;
      this.score = 0;
      this.displayScore = 0;
      this.comboCount = 0;
      this.comboTimer = 0;
      this._livePointsPopup = null;
      this.player.size = { x: SPRITE_CONSTANTS.PLAYER_BASE_SIZE, y: SPRITE_CONSTANTS.PLAYER_BASE_SIZE };
      this.camera.zoom = CAMERA_CONSTANTS.DEFAULT_ZOOM;

      // Reset Player — at the map's declared spawn point (the Overworld
      // spawns the player beside the station rather than at the origin).
      this.placePlayerAtSpawn();
  }

  // ── Map portals (roadmap step (k)) ──────────────────────────────────────

  /**
   * Travel to the map named by `descriptorId`, PRESERVING run state.
   *
   * This is loadMap + state preservation, not a new lifecycle: it runs the
   * same per-map rebuild `loadMapFresh` gives a new run (dimensions +
   * listeners, static grid, flow fields, background layer, minimap/static
   * tile bakes, station + portal caches, PerfController) and then re-inits
   * WaveSystem from the DESTINATION descriptor's `wavesEnabled`.  What it
   * does NOT do is the run-scoped reset: credits, score, the module slots
   * and inventory, owned weapons, and the player's CURRENT hull all ride
   * along untouched.  Hull damage carrying is the point — repairing at a
   * station is the loop (decision #39d).
   *
   * Wave progress is FRESH per entry by construction: `initWaveSystem` →
   * `WaveSystem.init` zeroes waveIndex, so leaving an arena abandons the
   * ladder and re-entering starts at wave 1.  No per-map run state exists.
   */
  /** Portal travel audio (SFX_INVENTORY §7.3).  One id covers the whole
   *  cut — pull, snap of silence, arrival bloom — because the map swap is
   *  instantaneous and two sounds across a zero-length gap phase against
   *  each other.  Flat, not positional: the player IS the transit. */
  public transitionToMap(descriptorId: string, opts?: { descend?: boolean }): boolean {
      const dest = mapDescriptor(descriptorId);
      if (!dest) return false;
      // Transit is a live-flight action: not from the menu, not while the
      // station UI has the sim frozen, not mid-death-explosion.
      if (this.gameState !== GameState.PLAYING) return false;
      if (this.dockedAtStation || this.player.isExploding) return false;

      this.audio.play('portal.transit');
      // Departure burst at the rift the player is leaving through — fired
      // before the load so it plays against the map being left.
      this.openPortal(this.player.position, {
          color: PORTAL_CONSTANTS.COLOR,
          radius: PORTAL_CONSTANTS.BURST_RADIUS,
          duration: PORTAL_CONSTANTS.BURST_DURATION,
      });

      // NOTE: `selectedMapType` is deliberately NOT updated.  It means
      // "the map a NEW RUN builds" — set by the menu's map grid — and a
      // portal is travel within a run, not a new selection.  So restarting
      // after a portal trip returns to the player's chosen start map (the
      // hub by default) rather than stranding the next run in an arena.
      // DEPTH.  Descending a boss rift goes one stage deeper; arriving at the
      // HUB surfaces (the hub is stage 0), so a trip home genuinely restarts
      // the ladder rather than banking progress.  Any other transition keeps
      // the current depth.  Set BEFORE loadMapFresh so initWaveSystem, which
      // runs below, reads the new value.
      // Where the player is coming FROM, resolved before the map is swapped —
      // used below to put them at the matching rift MOUTH on arrival.
      const fromId = descriptorForMapType(this.currentMap?.type)?.id;

      // DEBRIS TRAVELS WITH YOU (user call): everything loose within
      // TRANSIT.RADIUS of the ship — mobile shards and collectible drops,
      // exactly the stuff the wormhole's own gravity has been herding toward
      // the mouth — is captured out of the departing map here and re-emerges
      // from the exit rift after the player (updatePortalTransit), each on
      // its own stagger delay with a random heading and speed.  Nearest win
      // the cap, so a transit from a dense field takes the debris actually
      // AROUND the ship.  Enemies deliberately stay behind: the portal
      // clears the fight (decision #39d), and the hub is wave-free by
      // design.  The old map is discarded whole (buildMap constructs fresh
      // instances), so captured entities need no removal from it.
      const transitCfg = PORTAL_CONSTANTS.TRANSIT;
      const captured: { e: GameEntity; d2: number }[] = [];
      if (this.currentMap) {
          const rSq = transitCfg.RADIUS * transitCfg.RADIUS;
          for (const e of this.currentMap.entities) {
              if (!e.active || e.isExploding) continue;
              const isMobileShard = e.type === EntityType.STRUCTURE
                  && e.mass !== Infinity && e.dragonSegment !== true;
              if (!isMobileShard && !isCollectibleDrop(e)) continue;
              const dx = wrapDeltaX(this.player.position.x, e.position.x);
              const dy = wrapDeltaY(this.player.position.y, e.position.y);
              const d2 = dx * dx + dy * dy;
              if (d2 <= rSq) captured.push({ e, d2 });
          }
          captured.sort((a, b) => a.d2 - b.d2);
          if (captured.length > transitCfg.MAX_ENTITIES) {
              captured.length = transitCfg.MAX_ENTITIES;
          }
      }

      if (opts?.descend) this.stageIndex++;
      else if (dest.id === HUB_DESCRIPTOR.id) this.stageIndex = 0;
      // The stage-clear screen belongs to the arena being left.
      this.stageClearPending = false;
      this.stageClearDelay = 0;

      this.loadMapFresh(dest.mapType);
      // Emerge WHERE YOU CAME OUT.  If the destination has a rift pointing
      // back at the map just left — which is exactly the hub's per-arena
      // portal — surface beside that rift rather than at the map's declared
      // spawn.  Coming home from an arena used to dump the player at their
      // base station on the far side of the hub, which threw away the trip.
      // Looked up from the LIVE portal entities (not the placement table), so
      // it keeps working if placement changes, and it silently falls back to
      // the spawn when there is no matching rift (a descent into a fresh
      // arena has none).
      this.placePlayerAtSpawn(this.arrivalBesideRift(fromId));
      // …AND THROWN CLEAR.  `placePlayerAtSpawn` lands the ship dead-stopped,
      // which puts it at rest INSIDE the exit rift's own gravity well — so the
      // hole it just came out of immediately started pulling it back in.  The
      // arrival now carries an outward velocity along the mouth→ship axis,
      // sized to leave the well outright — SOLVED against the destination's
      // own well by `playerEjectSpeed`, so retuning the well cannot leave the
      // way out behind.  Radial rather than random, unlike the debris:
      // being spat sideways into the terrain you arrived beside is not an
      // arrival, and the player is the one thing that must never have to
      // fight its way out of the door.
      const exitMouth = this.exitMouthFor(fromId);
      if (exitMouth) {
          const ex = wrapDeltaX(exitMouth.position.x, this.player.position.x);
          const ey = wrapDeltaY(exitMouth.position.y, this.player.position.y);
          const len = Math.hypot(ex, ey);
          if (len > 1e-3) {
              const k = playerEjectSpeed(this.currentMap.type) / len;
              this.player.velocity.x = ex * k;
              this.player.velocity.y = ey * k;
          }
      }
      // Combat state belongs to the fight left behind: shield resumes its
      // normal recharge and lingering debuffs (corrosion DoT / EMP) drop.
      // Hull damage does NOT — that's the carry.
      this.player.shieldRechargeTimer = 0;
      this.player.shieldHitFlash = 0;
      this.player.statusEffects = [];
      this.playerMessages = [];

      // Queue the captured debris on the EXIT rift's mouth — the rift
      // pointing back where we came from (the same one arrivalBesideRift
      // read), falling back to the player's own arrival point when there is
      // no matching rift.  loadMapFresh cleared the queue above, so this
      // hop's cargo is all it holds.  Stagger delays are rolled here;
      // headings and speeds are rolled at emergence.
      if (captured.length > 0) {
          const mouth = this.exitMouthFor(fromId);
          const exit = mouth ? mouth.position : this.player.position;
          this.portalTransitExit.x = exit.x;
          this.portalTransitExit.y = exit.y;
          for (const { e } of captured) {
              e.velocity.x = 0;
              e.velocity.y = 0;
              e.hitFlash = 0;
              if (e.healthBarTimer !== undefined) e.healthBarTimer = 0;
              if (e.trail) e.trail.length = 0;
              this.portalTransit.push({
                  entity: e,
                  delay: transitCfg.DELAY_MIN
                      + Math.random() * (transitCfg.DELAY_MAX - transitCfg.DELAY_MIN),
              });
          }
      }

      // Waves per the DESTINATION descriptor — enabled in an arena, off in
      // the hub — and the always-present ambient fauna for the new map.
      this.initWaveSystem();
      seedAmbientBubbles(this);

      // Arrival burst at the destination spawn.
      this.openPortal(this.player.position, {
          color: PORTAL_CONSTANTS.COLOR,
          radius: PORTAL_CONSTANTS.BURST_RADIUS,
          duration: PORTAL_CONSTANTS.BURST_DURATION,
      });
      this.pushPlayerMessage(dest.name.toUpperCase(), PORTAL_CONSTANTS.COLOR);

      // …and fly through it.  Started LAST, once the destination is fully
      // built and the player placed in it, so the beat is pure presentation
      // over a world that is already correct — nothing about the arrival is
      // waiting on the animation, and cutting it short (DBG "Transit fx" off)
      // changes nothing but the look.
      this.portalWarpDuration = getPortalWarpDuration();
      this.portalWarpTimer = this.portalWarpDuration;

      this.prepareFrameEntities();
      // Accumulator hygiene — the map load is wall-clock work; don't
      // integrate it as simulated time (mirrors resumeGame / undock).
      // Called from inside the substep loop, the pending decrement takes
      // this one step negative, which simply drops a single sim step
      // across the load hitch — the right answer for a stall.
      this.lastTime = performance.now();
      this.simAccumulator = 0;
      return true;
  }

  /** Enter the portal the interaction check picked this step (nearest
   *  in-range, arbitrated against the stations).  Routed from the E key
   *  and the HUD affordance. */
  public enterPortal(): boolean {
      const p = this.nearestPortal;
      if (!p || !p.active || !p.portalTargetId) return false;
      return this.transitionToMap(p.portalTargetId, { descend: p.isDescent === true });
  }

  public restartGame() {
      // Returning to the main menu returns to the DEFAULT map: a run always
      // begins on the OVERWORLD hub (user call).  The menu no longer offers a
      // map choice — picking one is a DEBUG override that lasts for the run it
      // starts, not a preference that sticks to the front door.  Reset before
      // the load so the menu backdrop is the hub too.
      this.selectedMapType = HUB_DESCRIPTOR.mapType;
      this.resetAndLoadSelectedMap();
      this.gameState = GameState.MENU;
      this.prepareFrameEntities();
  }

  // ── Death / run-summary screen actions (A1) ──────────────────────────────
  // Three buttons, three EXISTING engine paths — nothing here invents a new
  // consequence for dying.  The death penalty question is owned by the
  // economy tuning pass (roadmap step 6), so RESPAWN is byte-for-byte the
  // auto-respawn that used to fire when the wreck finished.

  /** Primary action: continue the run from the current map's spawn. */
  public respawnFromDeath() {
      if (!this.deathPending) return;
      this.deathPending = false;
      this.deathDelay = 0;
      this.deathSummary = null;
      this.respawnPlayer();
      this.prepareFrameEntities();
  }

  /** Wipe the run and drop straight back into play on the same map — the
   *  main menu's START path (resetAndLoadSelectedMap + startGame) without the
   *  round trip through the menu. */
  public restartRun() {
      this.deathPending = false;
      this.deathDelay = 0;
      this.deathSummary = null;
      this.resetAndLoadSelectedMap();
      this.startGame();
      this.lastTime = performance.now();
      this.simAccumulator = 0;
      this.prepareFrameEntities();
  }

  /** Dismiss the stage-clear screen and resume the fight-cleared arena.  The
   *  descent rift and the return rift are both in the world; the player picks
   *  one by flying to it, which is why this needs no destination argument. */
  public dismissStageClear() {
      if (!this.stageClearPending) return;
      this.stageClearPending = false;
      // Same stale-time hygiene resumeGame() uses after a freeze.
      this.lastTime = performance.now();
      this.simAccumulator = 0;
      this.prepareFrameEntities();
  }

  /** Wipe the run and return to the main menu — restartGame() verbatim; the
   *  flag clear rides along inside resetAndLoadSelectedMap(). */
  public quitToMenu() {
      this.restartGame();
  }

  private selectWeapon(wType: WeaponType) {
      this.audio.play('weapon.cycle');
    this.currentWeaponIndex = this.weapons.selectWeapon(this.player, wType);
  }

  public cycleWeapon() {
      this.audio.play('weapon.cycle');
    if (this.gameState !== GameState.PLAYING) return;
    this.currentWeaponIndex = this.weapons.cycleWeapon(this.player);
  }

  /**
   * Pick the control scheme (user directive, G9).  A PREFERENCE, like
   * difficulty: it deliberately survives `restartGame()` and every map load,
   * because it describes the player's hands, not the run.
   */
  public setControlScheme(scheme: ControlScheme) {
    this.input.setControlScheme(scheme);
  }

  /**
   * Toggle the DualSense adaptive-trigger link (WebHID).
   *
   * Routed through the engine like every other UI action, but note what it is
   * NOT: it is not a control scheme and it is not a prerequisite for
   * anything.  The pad plays identically without it — this only changes what
   * the right trigger FEELS like — so nothing in the sim may branch on it,
   * and a platform without WebHID loses no functionality.
   *
   * Must be reached from a real click: `requestDevice` needs a user gesture.
   */
  public toggleAdaptiveTriggers(): Promise<boolean> {
    return this.input.adaptiveTriggersConnected()
      ? this.input.disconnectAdaptiveTriggers().then(() => false)
      : this.input.connectAdaptiveTriggers();
  }

  /** DBG: step the trigger wire encoding, and pulse the pad's motors over the
   *  SAME HID path to prove the transport independently of the encoding.
   *  Both exist because a DualSense answers a report it dislikes with
   *  silence, so "nothing happened" needs to be bisected rather than
   *  re-guessed. */
  /** How close the ship is to its speed cap, 0..1 — what the thrust
   *  trigger's resistance reports. */
  private lastMaxSpeed: number = PHYSICS_CONSTANTS.MAX_SPEED;
  private playerSpeedFraction(): number {
    const v = this.player.velocity;
    const speed = Math.sqrt(v.x * v.x + v.y * v.y);
    return Math.max(0, Math.min(1, speed / Math.max(1e-6, this.lastMaxSpeed)));
  }
  /** The ship's real terminal speed under held thrust (see the movement
   *  block for the derivation) — the tilt code's velocity normaliser. */
  private lastCruiseSpeed: number = PHYSICS_CONSTANTS.MAX_SPEED;
  /** How close the ship is to its CRUISE speed, 0..1 — the fraction the
   *  tilt terms read.  Separate from `playerSpeedFraction` (the cap
   *  fraction), which the thrust trigger's resistance still reports. */
  private playerCruiseFraction(): number {
    const v = this.player.velocity;
    const speed = Math.sqrt(v.x * v.x + v.y * v.y);
    return Math.max(0, Math.min(1, speed / Math.max(1e-6, this.lastCruiseSpeed)));
  }

  public cycleTriggerEncoding() { this.input.cycleTriggerEncoding(); }
  public testAdaptiveTriggerLink() { this.input.testAdaptiveTriggerLink(); }

  /** DIRECTIONAL TILT — ease `player.visualRoll` + `player.visualPitch`
   *  toward the tilt signal (PLAYER_ROLL_CONSTANTS documents every term and
   *  why it exists; the fields are documented in types.ts).  ROLL (lateral)
   *  is the STRAFE term — the thrust input's projection onto the facing
   *  axis's perpendicular — plus the TURN term — the smoothed rate the
   *  facing is swinging, scaled by throttle, the term the aim-locked
   *  schemes (touch / joystick / gamepad, where thrust is always along the
   *  nose) actually exercise, scaled by the CENTRIPETAL gate (bank scales
   *  with real speed), plus the SLIP term (drift relative to the nose
   *  holds the bank through a hard turn's slide).  PITCH (longitudinal)
   *  is nose-line thrust directly — held throttle holds the lean, cutting
   *  it settles level.  Components are signed so reversals swing
   *  through level instead of teleporting across it, and the signal VECTOR
   *  is magnitude-clamped so a diagonal cannot out-tilt the authored
   *  maximum.  Easing is a SECOND-ORDER SPRING (user call): each component
   *  carries an angular velocity and overshoots-and-settles rather than
   *  lerping, its frequency divided by √(mass ratio) so a heavy outfit
   *  tilts ponderously.  TUMBLE mode (DBG "Tilt mode") repurposes the same
   *  velocity state as a continuous roll rate — see the constants note. */
  private _rollPrevFacing: number | null = null;
  private _rollYawRate = 0;
  /** Tilt spring state: the angular velocities of the two eased
   *  components in LEAN mode, and the continuous roll rates in TUMBLE. */
  private _rollVel = 0;
  private _pitchVel = 0;
  /** The tilt spring's effective natural frequency: the authored omega ×
   *  the DBG damping step, over √(mass ratio) — rotational inertia grows
   *  with mass and ω ∝ 1/√I, so the same outfit that shoves slower also
   *  tilts slower, with the wobble character (the damping RATIO)
   *  unchanged. */
  private tiltOmega(): number {
    const { SPRING_OMEGA } = PLAYER_ROLL_CONSTANTS;
    const massRatio = Math.max(1e-6, this.player.mass / PHYSICS_CONSTANTS.PLAYER_MASS);
    return SPRING_OMEGA * getActiveRollDampingMult() / Math.sqrt(Math.max(1, massRatio));
  }
  /** One semi-implicit Euler step of the tilt spring for one component.
   *  Returns the new angle; the velocity lives in `_rollVel`/`_pitchVel`
   *  and is written back by the caller.  Semi-implicit (velocity first)
   *  keeps it stable at every damping step. */
  private springTilt(
    cur: number, velKey: '_rollVel' | '_pitchVel', target: number,
    dt: number, omega: number,
  ): number {
    const { SPRING_ZETA, REST_EPSILON, REST_VEL_EPSILON } = PLAYER_ROLL_CONSTANTS;
    const k = omega * omega;
    const c = 2 * SPRING_ZETA * omega;
    let v = this[velKey];
    v += (k * (target - cur) - c * v) * dt;
    let next = cur + v * dt;
    // Snap to true level once the settle is invisible — angle AND velocity
    // both small — so the renderer's straight-flight path stays the plain
    // rotation matrix.
    if (target === 0 && Math.abs(next) < REST_EPSILON && Math.abs(v) < REST_VEL_EPSILON) {
      next = 0;
      v = 0;
    }
    this[velKey] = v;
    return next;
  }
  /** The tilt signal for ONE source vector, written to the scratch pair
   *  below (no allocation — this runs up to twice per sim step).
   *
   *  Everything that makes a source distinct lives here: the STRAFE term
   *  reads the vector, and BOTH the turn gate and the slip term are scaled
   *  by the THROTTLE derived from it.  That is why 'Average' and 'Sum'
   *  blend the two RESULTS rather than the two input vectors — blending
   *  the vectors first would gate both halves by one merged throttle and
   *  lose exactly the difference the A/B exists to show. */
  private _tiltSigLat = 0;
  private _tiltSigLong = 0;
  private tiltSignalFrom(mx: number, my: number, cosF: number, sinF: number) {
    const { YAW_GAIN, PITCH_GAIN, SLIP_GAIN, TURN_SPEED_FLOOR } = PLAYER_ROLL_CONSTANTS;
    const vel = this.player.velocity;
    // STRAFE — perpendicular of facing (cos, sin) is (-sin, cos).
    const lat = my * cosF - mx * sinF;
    const throttle = Math.min(1, Math.sqrt(mx * mx + my * my));
    // TURN gate — CENTRIPETAL (tan(bank) ∝ v·ω): the bank of a carved
    // turn scales with actual SPEED, floored so a low-speed turn still
    // reads, and gated by throttle so a coasting or parked nose-swing —
    // which curves no path — stays level.  The MINUS sign below makes the
    // turn and strafe terms agree: mid-turn, thrust not yet swung to the
    // new nose lies on the NEGATIVE perp side of it.
    const turnGate = throttle
      * (TURN_SPEED_FLOOR + (1 - TURN_SPEED_FLOOR) * this.playerCruiseFraction());
    // SLIP — the velocity's lateral component relative to the nose, under
    // power: after a hard turn the path lags the nose and the hull stays
    // banked into the drift until it catches up.  Same sign convention as
    // the strafe term (thrusting and drifting the same way reinforce).
    const vLat = (vel.y * cosF - vel.x * sinF) / Math.max(1e-6, this.lastCruiseSpeed);
    const slip = SLIP_GAIN * Math.max(-1, Math.min(1, vLat)) * throttle;
    this._tiltSigLat = lat + slip - YAW_GAIN * this._rollYawRate * turnGate;
    // PITCH — nose-line thrust directly (the washout was removed, user
    // call): holding the throttle holds the lean, cutting it settles
    // level, reverse thrust leans the other way.
    this._tiltSigLong = (mx * cosF + my * sinF) * PITCH_GAIN;
  }
  private tickPlayerRoll(dt: number, moveDir: Vector2) {
    const { YAW_SMOOTHING, MAX_TILT } = PLAYER_ROLL_CONSTANTS;
    const facing = this.player.rotation;
    const cosF = Math.cos(facing);
    const sinF = Math.sin(facing);
    const vel = this.player.velocity;
    // TURN tracker — the facing's angular step this tick, wrapped so aiming
    // across the ±π seam is a small swing rather than a full spin, low-passed
    // to cancel pointer jitter.  Null prev = first tick (or a respawn reset):
    // measure from here, spike nothing.  Ticked ONCE per step, above the
    // source dispatch, so a two-source blend does not advance it twice.
    const prev = this._rollPrevFacing ?? facing;
    this._rollPrevFacing = facing;
    let dTheta = facing - prev;
    if (dTheta > Math.PI) dTheta -= 2 * Math.PI;
    else if (dTheta < -Math.PI) dTheta += 2 * Math.PI;
    const rawRate = dt > 0 ? dTheta / dt : 0;
    this._rollYawRate += (rawRate - this._rollYawRate) * Math.min(1, YAW_SMOOTHING * dt);

    // The DBG "Tilt src" A/B (user call): what DRIVES the signal.  THRUST
    // (the default) is the input vector — no input, no tilt.  VELOCITY is
    // the ship's motion normalised by the CRUISE speed, so the hull leans
    // with where it is actually going: a coasting drift holds its lean, a
    // wall bounce reads on the hull, and a tumble rolls as long as the ship
    // moves.  AVERAGE and SUM run BOTH and blend the RESULTS.  Whichever it
    // is, the branch below reads one clamped signal, so the choice reaches
    // both tilt modes for free.
    const src = getActiveTiltSource();
    // The velocity vector, cruise-normalised and gain-stepped, clamped to
    // the same 0..1 range the thrust input already lives in so the two are
    // commensurable before anything blends them.  The DBG "Vel gain" step
    // rides the normaliser: it moves WHERE the signal saturates, never how
    // deep it goes.
    const inv = getActiveVelGainMult() / Math.max(1e-6, this.lastCruiseSpeed);
    let vx = vel.x * inv;
    let vy = vel.y * inv;
    const vm = Math.sqrt(vx * vx + vy * vy);
    if (vm > 1) { vx /= vm; vy /= vm; }

    let sigLat: number;
    let sigLong: number;
    if (src === 'thrust' || src === 'velocity') {
      const useVel = src === 'velocity';
      this.tiltSignalFrom(useVel ? vx : moveDir.x, useVel ? vy : moveDir.y, cosF, sinF);
      sigLat = this._tiltSigLat;
      sigLong = this._tiltSigLong;
    } else {
      // BOTH effects, blended.  Average keeps the pair inside the range
      // either source reaches alone (it is the midpoint); Sum lets them
      // reinforce, so the hull banks SOONER — the magnitude clamp below is
      // what makes that safe, exactly as it does for an extreme Vel gain.
      // Sum is therefore 2× Average pre-clamp, and identical to it wherever
      // the pair already saturates.
      this.tiltSignalFrom(moveDir.x, moveDir.y, cosF, sinF);
      const tLat = this._tiltSigLat;
      const tLong = this._tiltSigLong;
      this.tiltSignalFrom(vx, vy, cosF, sinF);
      const scale = src === 'average' ? 0.5 : 1;
      sigLat = (tLat + this._tiltSigLat) * scale;
      sigLong = (tLong + this._tiltSigLong) * scale;
    }
    // Clamp the SIGNAL VECTOR's magnitude, not each component: the tilt is
    // one direction in 360°, and clamping per-axis would let a diagonal
    // reach √2 of the authored maximum.
    const sigMag = Math.sqrt(sigLat * sigLat + sigLong * sigLong);
    if (sigMag > 1) { sigLat /= sigMag; sigLong /= sigMag; }
    // Max angle comes from the DBG feel cycle (Player ▸ "Roll feel");
    // its Default step is PLAYER_ROLL_CONSTANTS.MAX_ANGLE, and Off (0)
    // levels out through this same easing rather than a separate branch.
    const maxAngle = getActivePlayerRollAngle();
    const omega = this.tiltOmega();

    if (getActiveTiltMode() === 'tumble') {
      // CONTINUOUS ROLL (test mode — user call): the clamped signal drives
      // angular RATE, not angle, so the hull keeps rolling about the axis
      // perpendicular to the thrust — end-over-end under forward
      // throttle, a barrel roll under strafe — and freezes where it
      // stopped when thrust drops, like a rolled object.  The velocity
      // state doubles as the rate; the "Roll feel" presets scale the rate
      // so Off stops the tumble; angles wrap to ±π.
      const { TUMBLE_RATE, MAX_ANGLE, REST_EPSILON, REST_VEL_EPSILON } =
        PLAYER_ROLL_CONSTANTS;
      const rateScale = TUMBLE_RATE * (maxAngle / MAX_ANGLE);
      const ease = Math.min(1, omega * dt);
      // NEGATED signal (user call): the tumble rolls the opposite way to
      // the lean's tilt — the read of a ball rolling WITH its travel
      // rather than tipping against it.
      this._rollVel += (-sigLat * rateScale - this._rollVel) * ease;
      this._pitchVel += (-sigLong * rateScale - this._pitchVel) * ease;
      const wrapPi = (a: number) =>
        a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a;
      let roll = wrapPi((this.player.visualRoll ?? 0) + this._rollVel * dt);
      let pitch = wrapPi((this.player.visualPitch ?? 0) + this._pitchVel * dt);
      // A stopped tumble that happens to sit near level snaps to it, so an
      // idle ship still earns the renderer's plain path.
      if (Math.abs(this._rollVel) < REST_VEL_EPSILON) {
        this._rollVel = sigLat === 0 ? 0 : this._rollVel;
        if (this._rollVel === 0 && Math.abs(roll) < REST_EPSILON) roll = 0;
      }
      if (Math.abs(this._pitchVel) < REST_VEL_EPSILON) {
        this._pitchVel = sigLong === 0 ? 0 : this._pitchVel;
        if (this._pitchVel === 0 && Math.abs(pitch) < REST_EPSILON) pitch = 0;
      }
      this.player.visualRoll = roll;
      this.player.visualPitch = pitch;
      return;
    }

    // The DBG "Lean dir" A/B (user call): one sign over both spring
    // targets, so Reversed tips the hull AWAY from the acceleration —
    // the same signal, easing and clamps, mirrored.
    const dirSign = getActiveLeanDirSign();
    let roll = this.springTilt(this.player.visualRoll ?? 0, '_rollVel', sigLat * maxAngle * dirSign, dt, omega);
    let pitch = this.springTilt(this.player.visualPitch ?? 0, '_pitchVel', sigLong * maxAngle * dirSign, dt, omega);
    // Combined-tilt ceiling: past π/2 the cos-foreshortening mirrors the
    // sprite.  The spring OVERSHOOTS by design, so this also brackets a
    // Deep-preset overshoot; a mirror is the one artefact that must never
    // draw.
    const tilt = Math.sqrt(roll * roll + pitch * pitch);
    if (tilt > MAX_TILT) { const s = MAX_TILT / tilt; roll *= s; pitch *= s; }
    this.player.visualRoll = roll;
    this.player.visualPitch = pitch;
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

  /**
   * Stamp discrete world transitions onto the Perf REC capture clock.
   *
   * The worst-frame table says WHEN a spike happened; without this it cannot
   * say WHAT was happening, and a 194s device capture stalled on exactly that
   * — three of its six worst frames inside one second, obviously an event
   * rather than load, and no way to name it.
   *
   * Detection is done by DIFFING state here rather than by calling
   * markEvent() from a dozen sites across WaveSystem / boss / portal code.
   * That keeps the instrumentation in one readable place and out of the
   * gameplay paths, at the cost of a few comparisons per frame — and those
   * only run while a capture is active.
   */
  private markPerfEvents(): void {
      const rec = this.perfRecorder;
      if (this.waveIndex !== this._pmWave) {
          this._pmWave = this.waveIndex;
          rec.markEvent(`wave${this.waveIndex + 1}`);
      }
      if (this.waveState !== this._pmState) {
          this._pmState = this.waveState;
          // 'active' is the spawn stream opening; 'cleared' is the wave-clear
          // beat (salvage spray + milestone drop), both plausible burst sites.
          if (this.waveState === 'active') rec.markEvent('spawn');
          else if (this.waveState === 'cleared') rec.markEvent('clear');
      }
      const bossAlive = !!(this.liveBoss && this.liveBoss.active && !this.liveBoss.isExploding);
      if (bossAlive !== this._pmBoss) {
          this._pmBoss = bossAlive;
          rec.markEvent(bossAlive ? 'boss-in' : 'boss-dead');
      }
      const mapName = this.currentMap?.name ?? '';
      if (mapName !== this._pmMap) {
          const first = this._pmMap === '';
          this._pmMap = mapName;
          if (!first) rec.markEvent('mapload');
      }
      if (this.deathPending !== this._pmDead) {
          this._pmDead = this.deathPending;
          if (this.deathPending) rec.markEvent('death');
      }
      if (this.stageClearPending !== this._pmStage) {
          this._pmStage = this.stageClearPending;
          if (this.stageClearPending) rec.markEvent('stageclear');
      }
      if (this.dockedAtStation !== this._pmDocked) {
          this._pmDocked = this.dockedAtStation;
          rec.markEvent(this.dockedAtStation ? 'dock' : 'undock');
      }
  }

  /**
   * Sample the gamepad once per rendered frame and spend the edges that do
   * not belong to a sim step (Pair C, c2).
   *
   * Runs BEFORE every freeze short-circuit in `loop`, which is the point: the
   * pause button has to work from inside the paused state, and a pad that
   * connects while the menu is up should still say so.  What is gated is the
   * FIRE queue — a trigger held through a station visit must not bank a shot
   * that lands the instant you undock.
   */
  private pollGamepad() {
    const frozen = this.gameState !== GameState.PLAYING || this.dockedAtStation
                || this.stageClearPending || this.deathPending;
    this.input.pollGamepad(!frozen);

    const conn = this.input.consumePadConnectionEvent();
    if (conn) {
      this.pushPlayerMessage(
        conn.connected ? 'GAMEPAD CONNECTED' : 'GAMEPAD DISCONNECTED',
        conn.connected ? '#7dd3fc' : '#fca5a5',
        INPUT_CONSTANTS.GAMEPAD.HINT_LIFETIME,
      );
    }

    if (this.input.consumePausePress()) {
      // pauseGame() is already a no-op while docked (one full-screen overlay
      // at a time), so this needs no docked branch of its own.
      if (this.gameState === GameState.PLAYING) this.pauseGame();
      else if (this.gameState === GameState.PAUSED) this.resumeGame();
    }

    // Both of these are DRAINED every frame whether or not they can be spent,
    // so a press made against a frozen world cannot fire later out of context.
    // The one exception is INTERACT while docked — the docked branch below is
    // its consumer, and undocking is exactly what it is for.
    const cycle = this.input.consumeCyclePress();
    if (cycle && !frozen) this.cycleWeapon();
    if (frozen && !this.dockedAtStation) this.input.consumeInteractPress();
  }

  /**
   * BACK, pressed with a full-screen overlay up (G15).
   *
   * The menu-nav driver owns CONFIRM — it clicks whatever has focus, which
   * needs no game knowledge at all — but BACK means something different on
   * each screen, and only the engine knows which is up.  Deliberately does
   * NOT dismiss the death or stage-clear screens: those are decisions
   * (respawn / restart / quit; descend / return), and a button that quietly
   * picks one for you is worse than no button.
   */
  public menuBack() {
    if (this.dockedAtStation) { this.undock(); return; }
    if (this.gameState === GameState.PAUSED) { this.resumeGame(); return; }
  }

  /**
   * Per-frame upkeep for the onscreen joystick (Pair C, c2): advance the
   * release fade, and hand InputSystem the LIVE minimap rect.
   *
   * The rect is pushed rather than looked up because the stick must not claim
   * a touch that belongs to the minimap toggle, and the minimap changes size
   * at runtime (75 px collapsed, 280 px expanded) — a constant in
   * INPUT_CONSTANTS could only be right for one of those.  This keeps HUD
   * layout knowledge in the engine, where it already lives (the fire-event
   * handler computes the same rect to catch the toggle tap).
   */
  private tickJoystick(frameTime: number) {
    this.input.tickJoystick(frameTime);

    const mm = computeMinimapRect(window.innerHeight, this.minimapExpanded);
    this.input.setStickExclusion(mm.x, mm.y, mm.size, mm.size);
  }

  private loop = (time: number) => {
    if (!this.isRunning) return;

    // NEVER NEGATIVE.  `time` is the rAF frame timestamp, which is the moment
    // the frame STARTED — so any code that stamps `lastTime` from
    // `performance.now()` mid-frame (transitionToMap does, to keep the map
    // load out of the sim clock) can leave lastTime AHEAD of the next frame's
    // timestamp.  The delta then comes back negative, and everything
    // downstream that subtracts it runs BACKWARDS: measured -0.16s, which
    // drove the transit beat's timer UP past its own duration and its
    // progress to -0.11, where the veil declined to paint and the destination
    // arena showed through — the second, subtler half of that bug.
    const frameTime = Math.max(0, (time - this.lastTime) / 1000);
    this.lastTime = time;

    this.pollGamepad();
    this.tickJoystick(frameTime);

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
    // HUD push gate.  React reconciliation is per-frame work the engine's
    // timers never measured; the HUD is chips and bars and does not need
    // 60 Hz.  Anything that must stay frame-perfect (minimap, loadout strip,
    // banners, damage text) is canvas-drawn and unaffected.
    //
    // Overlay states push IMMEDIATELY and unconditionally: the React tree is
    // what renders the pause / station / death / stage-clear screens, so
    // throttling those would delay a screen the player just asked for.  Only
    // the in-play HUD is throttled.
    this.statsPushAccum += frameTime;
    const hudPeriod = 1 / getActiveHudRate();
    const overlayUp = this.gameState !== GameState.PLAYING
        || this.dockedAtStation || this.deathPending || this.stageClearPending;
    const pushStats = overlayUp || this.statsPushAccum >= hudPeriod;
    if (pushStats) this.statsPushAccum = 0;
    // Consume whatever React committed since the last frame.  Done BEFORE the
    // snapshot so the snapshot, the recorder sample and the HUD all report the
    // same figures for this frame.  Zero here means "no commit landed", which
    // is the honest answer for a throttled frame — hence consume-and-reset
    // rather than a sticky last-value.
    this.lastUiActualMs = this.uiActualAccum;
    this.lastUiBaseMs   = this.uiBaseAccum;
    this.lastUiCommits  = this.uiCommitAccum;
    this.uiActualAccum = 0;
    this.uiBaseAccum = 0;
    this.uiCommitAccum = 0;
    const perf = this.buildPerfSnapshot();
    // Menu-grade snapshots (loadout / shop / stats) are built while the
    // pause menu OR the docked station UI is up — both are sim-frozen
    // full-screen overlays that need them.
    const menuOpen = this.gameState === GameState.PAUSED || this.dockedAtStation;
    if (this.perfRecorder.recording) this.markPerfEvents();
    if (this.perfRecorder.recording && this.gameState === GameState.PLAYING) {
      // frameTime (raw rAF delta), the raw per-frame render + sim (aligned to
      // the SAME just-finished frame — sample() runs at the top of the next
      // frame), and the smoothed snapshot.  The raw pair drives spike
      // attribution (which sub-system owns the worst frames).
      this.perfRecorder.sample(
        frameTime * 1000,
        perf,
        this.perfController.loadTier,
        this.perfController.loadLevel,
        this.renderer.lastRenderMs,
        this.lastFrameSimMs,
        this.lastFrameSteps,
        // The recorder's `ui` column.  This used to be fed the setState
        // SCHEDULING time, which is near-zero by construction — so every
        // capture in the repo's history reported a ui cost of ~0 and an
        // unexplained `other` residual of the same size as the real cost.
        // It is now the profiler's measured reconciliation time.
        this.lastUiActualMs,
        this.renderer.lastStampMs,
        this.renderer.lastStampCount,
        this.renderer.lastTintMs,
        this.renderer.lastTintMisses,
      );
    }
    const tStats0 = performance.now();
    if (pushStats) this.onStatsUpdate({
      fps: frameTime > 0 ? Math.round(1 / frameTime) : 0,
      entityCount: (this.currentMap?.entities.length || 0) + 1,
      currentMapName: this.currentMap?.name || 'Loading...',
      currentMapType: this.currentMap?.type || MapType.UNIVERSE,
      currentWeapon: this.player.currentWeapon !== undefined ? WEAPONS[this.player.currentWeapon].name : 'None',
      gameState: this.gameState,
      difficulty: this.difficultyLevel,
      waveNumber: this.waveIndex + 1,
      waveStatus: wsMap[this.waveState],
      wavesEnabled: this.wavesEnabled,
      waveGraceTimer: this.waveGraceTimer > 0 ? Math.ceil(this.waveGraceTimer) : undefined,
      waveElapsedSec: this.waveState === 'active' ? Math.floor(this.waves.elapsedSecPublic) : undefined,
      enemiesRemaining: this.waveState === 'active' && this.currentMap ? this.waves.enemiesRemaining(this.currentMap.entities) : undefined,
      boss: bossStatsSnapshot(this),
      score: Math.round(this.displayScore),
      comboMultiplier: this.comboMultiplier(),
      comboCount: this.comboCount,
      comboFraction: this.comboTimer > 0 ? this.comboTimer / SCORE_CONSTANTS.COMBO_WINDOW_SEC : 0,
      credits: this.credits,
      salvageFlash: this.player.salvagePickupFlash ? {
        amount: this.player.salvagePickupFlash.amount,
        fraction: Math.max(0, this.player.salvagePickupFlash.timer / 0.75),
      } : undefined,
      vitals: {
        health: Math.max(0, Math.round(this.player.health)),
        maxHealth: Math.round(this.player.maxHealth),
        shield: Math.max(0, Math.round(this.player.shield ?? 0)),
        maxShield: Math.round(this.player.maxShield ?? 0),
      },
      playerStats: menuOpen ? {
        health: Math.max(0, Math.round(this.player.health)),
        maxHealth: this.player.maxHealth,
        shield: Math.max(0, Math.round(this.player.shield ?? 0)),
        maxShield: this.player.maxShield ?? 0,
        damageMult: this.player.damageMult ?? 1,
        cooldownMult: this.player.cooldownMult ?? 1,
        speedMult: this.moduleSpeedMult,
        shipWeight: this.shipWeight,
        position: {
          x: Math.round(this.player.position.x),
          y: Math.round(this.player.position.y),
        },
      } : undefined,
      outfitting: menuOpen ? this.outfittingSnapshot() : undefined,
      runSummary: this.deathPending ? (this.deathSummary ?? undefined) : undefined,
      stageClear: this.stageClearPending && this.lastStageClear
          ? { ...this.lastStageClear, mapName: this.currentMap?.name ?? '' }
          : undefined,
      dock: this.dockStatsSnapshot(),
      portal: this.portalStatsSnapshot(),
      station: this.dockedAtStation ? this.stationSnapshot() : undefined,
      weaponCatalog: this.gameState === GameState.PAUSED ? this.weaponCatalogSnapshot() : undefined,
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
      playerNebulaCollisionEnabled: this.physics.playerNebulaCollisionEnabled,
      shardSleepEnabled: this.physics.shardSleepEnabled,
      shardViewportCullEnabled: this.physics.shardViewportCullEnabled,
      shardLodEnabled: this.renderer.shardLodEnabled,
      mergeRateEnabled: this.perfController.mergeRateEnabled,
      screenShakeEnabled: this.screenShakeEnabled,
      tileOutlinesEnabled: this.renderer.tileOutlinesEnabled,
      chevronsOffscreenOnly: this.renderer.chevronsOffscreenOnly,
      damageTriggeredBars: this.renderer.damageTriggeredBars,
      minimapMaterialName: getActiveMinimapMaterialName(),
      lightingModeName:  getActiveLightingMode(),
      lightingTierName:  getActiveLightingTier().name,
      shardShadowsEnabled: getShardShadowsEnabled(),
      refractionEnabled: getRefractionEnabled(),
      refractBrightnessName: getRefractBrightnessName(),
      lightBrightnessName: getLightBrightnessName(),
      emissiveEnabled: getEmissiveEnabled(),
      worldLightsEnabled: getWorldLightsEnabled(),
      depthAmbientEnabled: getDepthAmbientEnabled(),
      emitBrightnessName: getEmitBrightnessName(),
      emitShadowsEnabled: getEmitShadowsEnabled(),
      emitShadowTierName: getEmitShadowTierName(),
      emitFadeName: getEmitFadeName(),
      causticFadeName: getCausticFadeName(),
      flashlightName: getFlashlightName(),
      lightColorName: getLightColorName(),
      tintMixName: getTintMixName(),
      fogName: getFogName(),
      shadowSoftnessName: getShadowSoftnessName(),
      rockPaletteName: getActiveRockPaletteName(),
      fractureModeName: getActiveFractureMode(),
      fractureRelaxName: getFractureRelaxName(),
      fractureSeparationName: getFractureSeparationName(),
      fractureSiteScaleName: getFractureSiteScaleName(),
      fractureBiasName: getFractureBiasName(),
      nebulaWakeSpinName: getNebulaWakeSpinMode(),
      repelPushEnabled: this.physics.repelPushEnabled,
      shardBlendEnabled: this.renderer.shardBlendEnabled,
      shardBlendCount: this.renderer.lastShardBlendCount,
      shardCoatName: getActiveShardCoatName(),
      plasticAutomataEnabled: this.renderer.plasticAutomataEnabled,
      plasticAutomataBrighten: isPlasticAutomataBrighten(),
      materialAutomataEnabled: this.renderer.materialAutomataEnabled,
      plasticPaletteName: getActivePlasticPaletteName(),
      plasticShardPaletteName: getActivePlasticShardPaletteName(),
      plasticGlowBrightnessName: getActivePlasticGlowBrightnessName(),
      nebulaPaletteName: getActiveNebulaPaletteName(),
      plasticBlendEnabled: this.nebulas.plasticBlendEnabled,
      nebulaStretchName:   getActiveNebulaStretchName(),
      shatterGraceName:   getActiveShatterGraceName(),
      playerThrustName: getActivePlayerThrustName(),
      playerSpeedName: getActivePlayerSpeedName(),
      shardFlowEnabled: this.shardFlowEnabled,
      snitchCatchMode: this.snitchCatchMode,
      gamepadInfo: this.input.padDebugName(),
      gamepadAxes: this.input.padDebugAxes(),
      rumbleInfo: this.input.rumbleDebugInfo(),
      joystickForceVisible: this.input.joystickForceVisible,
      controlScheme: this.input.getControlScheme(),
      rumbleEnabled: this.input.rumbleEnabled,
      adaptiveTriggersSupported: this.input.adaptiveTriggersSupported(),
      adaptiveTriggersConnected: this.input.adaptiveTriggersConnected(),
      adaptiveTriggerInfo: this.input.adaptiveTriggerDebugInfo(),
      adaptiveTriggerReport: this.input.adaptiveTriggerReportHex(),
      snitchSpeedName: getActiveSnitchSpeedName(),
      portalWarpName: getPortalWarpName(),
      portalSizeName: getPortalSizeName(),
      portalGravityName: getPortalGravityName(),
      portalGravityRangeName: getPortalGravityRangeName(),
      portalLensName: getPortalLensName(),
      portalLensSpinName: getPortalLensSpinName(),
      portalLensRadiusName: getPortalLensRadiusName(),
      portalTuningInfo: getPortalTuningInfo(),
      rollFeelName: getActivePlayerRollName(),
      hullModeName: getActivePlayerHullName(),
      rollDampName: getActiveRollDampingName(),
      tiltModeName: getActiveTiltModeName(),
      leanDirName: getActiveLeanDirName(),
      tiltSourceName: getActiveTiltSourceName(),
      velGainName: getActiveVelGainName(),
      enemyScaleName: getActiveEnemyScaleName(),
      simRateName: getActiveSimRateName(),
      hudRateName: getActiveHudRateName(),
      substepCapName: getActiveSubstepCapName(),
      swarmMoveName: getActiveSwarmMoveName(),
      starDensityName: getActiveStarDensityName(this.currentMap?.type),
      starSizeName: getActiveStarSizeName(),
      starBandsName: getActiveStarBandsName(),
      starParallaxName: getActiveStarParallaxName(this.currentMap?.type),
      collapseModeName: getActiveCollapseModeName(),
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
      audio: {
        volume: this.audio.volume, muted: this.audio.muted,
        state: this.audio.contextState, audible: this.audio.audible,
        drafts: this.audio.draftsEnabled,
        sampled: this.audio.sampledIds.length, total: this.audio.allIds.length,
        unmatched: this.audio.unmatchedFiles,
        loopFiles: this.audio.loopSampleFilenames,
        latencyMs: this.audio.latencyMs,
      },
    });
    // Cost of SCHEDULING the React update — not of performing it.  The
    // reconciliation this setState triggers is deferred past the end of this
    // rAF callback, so it is not inside this bracket and never was: the
    // number this line produces is ~0 whatever the tree costs.  The measured
    // cost is `lastUiActualMs`, reported in by the `<Profiler>` in App.tsx.
    // Kept as the control that demonstrates the point.
    this.lastStatsScheduleMs = pushStats ? performance.now() - tStats0 : 0;

    // Audio follows the camera, and goes quiet whenever the sim does.  Two
    // number writes and a boolean per frame — the manager is otherwise
    // purely event-driven, so this is the entire per-frame audio cost.
    this.audio.setListener(this.camera.position.x, this.camera.position.y);
    this.audio.setActive(this.gameState === GameState.PLAYING && !this.dockedAtStation);

    if (this.gameState !== GameState.PLAYING) {
        // If paused or in menu, still draw (static frame) but skip updates
        try { this.draw(); } catch (e) { console.error('[RenderSystem] draw error:', e); }
        this.recordRenderPerf();
        requestAnimationFrame(this.loop);
        return;
    }

    // Docked at the station: freeze the sim (the field stays drawn behind
    // the React station UI) until the player undocks — the same short-
    // circuit the removed between-wave card modal used.  The E key undocks
    // (edge-triggered on the shared latch); the station UI's UNDOCK button
    // routes through undock() as well.
    if (this.dockedAtStation) {
        const eDown = this.input.isKeyDown('KeyE');
        if ((eDown && !this.dockKeyHeld) || this.input.consumeInteractPress()) this.undock();
        this.dockKeyHeld = eDown;
        try { this.draw(); } catch (e) { console.error('[RenderSystem] draw error:', e); }
        this.recordRenderPerf();
        requestAnimationFrame(this.loop);
        return;
    }

    // Stage cleared: the player is ALIVE, so this PAUSES rather than ends —
    // same freeze as the death screen, dismissed by CONTINUE, after which the
    // choice (descend / go home) is made in the world by flying to a rift.
    if (this.stageClearPending) {
        try { this.draw(); } catch (e) { console.error('[RenderSystem] draw error:', e); }
        this.recordRenderPerf();
        requestAnimationFrame(this.loop);
        return;
    }

    // In transit: the sim is HELD while the player flies up the wormhole, so
    // nothing shoots them inside the tunnel and the beat costs no simulation.
    // The timer runs on WALL CLOCK — exactly what a frozen sim leaves
    // available — and the frame still draws, which is what animates it.
    if (this.portalWarpTimer > 0) {
        this.portalWarpTimer = Math.max(0, this.portalWarpTimer - frameTime);
        try { this.draw(); } catch (e) { console.error('[RenderSystem] draw error:', e); }
        this.recordRenderPerf();
        requestAnimationFrame(this.loop);
        return;
    }

    // NOTE — deliberately NO `deathPending` short-circuit here.  Death is the
    // one full-screen overlay that does NOT freeze the sim (user call): the
    // field keeps moving behind the semi-transparent summary, so the player
    // watches the fight carry on without them.  The dead player is already
    // inert — `updateGameLogic` returns early while `isExploding`, so no
    // input, weapons, docking, drop-collection or wave progress happens —
    // and the summary itself is a SNAPSHOT taken at the moment of death, so
    // nothing behind the screen can move the numbers on it.

    // ── Fixed-timestep accumulator (Phase 1) ─────────────────────────────────
    // Drain the accumulator at a fixed simulation rate regardless of the
    // render frame rate.  Any leftover time carries to the next frame.
    //
    // A MAX_FRAME_TIME clamp drops excess time from tab-switch / GPU stalls
    // so we never try to simulate several seconds worth of physics in one
    // frame.  A MAX_SUBSTEPS clamp on the inner loop is the spiral-of-death
    // safeguard: if the sim is genuinely slower than real time the extra
    // time is silently discarded rather than compounding.
    // FIXED_DT and the substep clamp are read LIVE from the sim-rate cycle
    // (DBG "Sim rate", default 120Hz — identical to the hardcoded value it
    // replaced).  See SIM_RATE_CYCLE in constants.ts for why the rate is a
    // toggle rather than an edit.
    const FIXED_DT = getSimDt();
    const MAX_SUBSTEPS = getMaxSubsteps();
    const { MAX_FRAME_TIME, VSYNC_SNAP_FRACTION } = SIMULATION_CONSTANTS;
    let dtIn = Math.min(frameTime, MAX_FRAME_TIME);
    // VSYNC SNAP.  Without this, a sim rate equal to the display rate makes
    // the accumulator drift a hair either side of exactly one step, so frames
    // alternate 1-step / 2-step and the world judders — which is exactly why
    // a 1/60 timestep was tried and reverted once already (see the comment on
    // SIMULATION_CONSTANTS).  Snapping a frame delta that lands within a
    // quarter-step to the nearest whole number of steps removes the
    // alternation at its source.  At 120Hz a 60fps frame is already ~2.000
    // steps, so this is a no-op on the default path.
    const rawSteps = dtIn / FIXED_DT;
    const nearest = Math.round(rawSteps);
    if (nearest >= 1 && Math.abs(rawSteps - nearest) < VSYNC_SNAP_FRACTION) {
        dtIn = nearest * FIXED_DT;
    }
    this.simAccumulator += dtIn;

    let steps = 0;
    let frameSimMs = 0; // raw per-frame sim total (summed across substeps)
    while (this.simAccumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
        // Stage-clear raised mid-frame: stop draining immediately and drop the
        // leftover time, so the screen freezes on the frame the capstone died
        // rather than a few substeps later.  (Death is NOT here — it no longer
        // freezes the sim.)
        if (this.stageClearPending) { this.simAccumulator = 0; break; }
        // A portal entry swaps the map IN PLACE mid-substep and arms the
        // transit warp; the rest of this frame's substeps would otherwise
        // simulate the destination while the player is still in the tunnel.
        if (this.portalWarpTimer > 0) { this.simAccumulator = 0; break; }
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
        frameSimMs += this.lastUpdatePhysicsMs + this.lastUpdateGameLogicMs;
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
    this.lastFrameSimMs = frameSimMs; // raw per-frame sim total (spike attribution)
    this.lastFrameSteps = steps;      // …and how many substeps it covers

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
      // REFILL IDIOM (gauntlet 5c, P2) — the canonical explanation lives here
      // because this list is the hottest instance of it in the engine.
      //
      // `arr.length = 0` followed by `push` looks free and is not: setting the
      // length down shrinks the backing store, and the pushes then re-grow it
      // through the array growth policy, allocating a fresh backing store (and
      // several intermediate ones) EVERY refill.  This list is rebuilt 2-3
      // times per frame with ~1300-3600 entries, and it measured as the single
      // largest allocator in the engine — in the idle hub as much as in combat.
      //
      // Index-filling into the existing array and truncating ONLY when the
      // count actually shrank keeps the backing store at its high-water mark,
      // so a steady-state field allocates nothing.  Contents and `length` are
      // identical either way; no consumer can tell.  Measured standalone:
      // 2.6x faster and 11x less heap churn over 20 000 refills of 1300 items.
      const ents = this.currentMap.entities;
      const frame = this.frameEntities;
      const n = ents.length;
      for (let i = 0; i < n; i++) frame[i] = ents[i];
      frame[n] = this.player;
      if (frame.length !== n + 1) frame.length = n + 1;
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
      this.perfCounts.mobileShardCount     = this.entityIndex.shardCandidates.length;
      this.perfCounts.projectileCount   = this.entityIndex.projectiles.length;
      this.perfCounts.particleCount     = this.entityIndex.particleCount;
      this.perfCounts.interactableCount = this.entityIndex.interactableCount;
  }

  /** Baseline flow-correction rate, shared by the shard pass
   *  (`applyFlowTo`) and the collectible-drop pass that mirrors it. */
  private static readonly FLOW_CORRECTION = 0.08;

  /**
   * Steer one shard toward the local flow-field direction.
   *
   * CLOSURE HOISTING (gauntlet 5c, P3) — this used to be a `const applyFlow =
   * (e) => {…}` declared inside `updatePhysics`, i.e. a function object
   * CONSTRUCTED FRESH on every sim substep, 120 times a second.  That is not
   * just the cost of the allocation: a function re-created that often never
   * settles into V8's optimised tier, and in the unoptimised tier every
   * intermediate double is boxed on the heap.  The site measured ~98 bytes of
   * allocation per shard per substep — 175 MB over a 12 s capture on the
   * Asteroid Field, the single largest allocator in the engine after P2 —
   * while `perf/probe.mjs` showed the exact same operations allocating ZERO
   * when run from a stable, optimisable loop.
   *
   * The body below is byte-for-byte the old closure's; only its home changed.
   * Everything it used to capture is now an explicit parameter, which is what
   * lets it be a plain method.
   *
   * The collectible-drop pass in `updatePhysics` deliberately keeps its own
   * copy of this arithmetic rather than calling through here: drops carry a
   * `rotationSpeed`, so routing them through this method would start
   * integrating their rotation and that is a behaviour change, not a perf fix.
   */
  private applyFlowTo(
      e: GameEntity,
      dt: number,
      flowTargetSpeed: number,
      flowEnabled: boolean,
      laneJitter: number,
  ): void {
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
      const flow = this.flowField.sampleShardFlow(e.position.x, e.position.y);
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
          const nx = flow.x + px * off;
          const ny = flow.y + py * off;
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
      const targetSpeed = flowTargetSpeed * massScale;
      const tx = fxDir * targetSpeed;
      const ty = fyDir * targetSpeed;
      const vAlongFlow = e.velocity.x * fxDir + e.velocity.y * fyDir;
      const vSq = e.velocity.x * e.velocity.x + e.velocity.y * e.velocity.y;
      const vPerp = Math.sqrt(Math.max(0, vSq - vAlongFlow * vAlongFlow));
      const parallelDeficit = Math.max(0, Math.min(1, 1 - vAlongFlow / targetSpeed));
      const perpDeficit     = Math.min(1, vPerp / targetSpeed);
      const urgency         = 1 + 8 * Math.max(parallelDeficit, perpDeficit);
      const alpha           = Math.min(0.8, GameEngine.FLOW_CORRECTION * dt * urgency * correctionMul);
      e.velocity.x += (tx - e.velocity.x) * alpha;
      e.velocity.y += (ty - e.velocity.y) * alpha;
      if (e.rotationSpeed) e.rotation += e.rotationSpeed * dt;
  }

  private handleEnemyShooting(dt: number) {
      if (!this.currentMap) return;
      this.weapons.updateEnemyShooting(this.currentMap.entities, this.entityIndex.enemies, this.player, dt);
  }

  /** Haptic feedback with NO camera shake.  Most impacts want both and go
   *  through `handleScreenShake`; a few — the plain Blaster's shot — want the
   *  hand to feel something the camera must not react to. */
  handleRumble = (amount: number, kind: RumbleKind = 'impact') => {
      this.input.rumble(amount, kind);
  }

  handleScreenShake = (
      amount: number,
      opts?: { dirX?: number; dirY?: number; rumble?: RumbleKind },
  ) => {
      const rumbleKind: RumbleKind = opts?.rumble ?? 'impact';
      // Force feedback rides this call — every impact in the game already
      // funnels through it with magnitudes tuned against each other, so the
      // hand feels what the camera feels.  Deliberately ABOVE the
      // screen-shake toggle: wanting a crash in the hand and wanting the
      // camera to lurch are different preferences.
      this.input.rumble(amount, rumbleKind);

      if (!this.screenShakeEnabled) return;
      // Prioritize larger shakes
      if (amount > this.shakeIntensity || this.shakeTimer <= 0) {
          this.shakeIntensity = amount;
          this.shakeTimer = CAMERA_CONSTANTS.SHAKE_DECAY;
          // A DIRECTION is optional: an impact has one (the axis the ship was
          // shoved along), an explosion or a warp-in does not.  Stored
          // normalised; (0,0) means "no direction" and keeps the isotropic
          // jitter, so every existing caller is unchanged.
          const dx = opts?.dirX, dy = opts?.dirY;
          const dm = dx !== undefined && dy !== undefined ? Math.hypot(dx, dy) : 0;
          this.shakeDirX = dm > 0 ? dx! / dm : 0;
          this.shakeDirY = dm > 0 ? dy! / dm : 0;
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
          this.ai.update(aiDt, this.entityIndex.enemies, this.player, this.flowField,
              this.entityIndex.shardCandidates, this.entityIndex.projectiles);
      } else {
          this.ai.lastUpdateMs = 0; // amortize cost across skip steps in the overlay
      }
      this.handleEnemyShooting(dt);

      this.physics.update(
        allEntities,
        this.entityIndex.shardCandidates,
        this.player,
        this.currentMap.type,
        dt,
        this.spawnDamageText,
        this.handleEntityDeath,
        this.handleScreenShake,
        this.handleProjectileHit,
        this.handlePortalEject
      );

      // Indexed loop, not `forEach(e => …)`: the callback would be a fresh
      // closure on every substep (120 Hz).  See the CLOSURE HOISTING note on
      // applyFlowTo below — a function re-created per substep never settles
      // into optimised code.
      const mapEnts = this.currentMap.entities;
      for (let i = 0; i < mapEnts.length; i++) {
          const e = mapEnts[i];
          if (e.isExploding && e.explosionTimer !== undefined) {
              e.explosionTimer -= dt;
              if (e.explosionTimer <= 0) {
                  e.active = false;
              }
          }
      }

      // Rock-shard population census, for the free-spawn respawn target.
      // Pulls count/minSize/maxSize from the CURRENT map's config so the
      // respawn loop honours per-map population targets — previously
      // this was hardcoded to MapType.UNIVERSE which filled small maps
      // (e.g. Pocket, count = 2) with Deep Space's 140 asteroids.
      //
      // This loop USED to also shatter every rock-shard it found
      // deactivated, from before `handleEntityDeath` owned structure
      // deaths (CLAUDE.md §8: EVERY structure death goes through
      // `onDeath`).  Once the death path gained the shatter, that made it
      // a SECOND, unguarded shatter — measured: a large rock-shard's 4
      // fragments became 8 one frame later, each cell spawned twice, and
      // rock-shard was the only variant filtered for, which is exactly
      // why only mobile rocks doubled.  Worse, with no shooting at all it
      // shattered shards at FULL HEALTH (10/10, 11/11) — healthy shards
      // that a MERGE had just absorbed — spraying debris out of every
      // compose.  Deleted; ShardSystem.shatter now also refuses a second
      // call per entity so no future caller can reintroduce it.
      const config = getRockShardFreeSpawn(this.currentMap.type);
      let currentMobileShardCount = 0;
      for (let i = 0; i < this.currentMap.entities.length; i++) {
          if (this.currentMap.entities[i].shardVariant === 'rock-shard') currentMobileShardCount++;
      }
      if (currentMobileShardCount < config.count) {
          this.handleRockShardRespawn(config);
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
      const FLOW_CORRECTION = GameEngine.FLOW_CORRECTION;
      const FLOW_TARGET_SPEED = config.speedMultiplier;
      const asteroids = this.entityIndex.shardCandidates;
      const flowEnabled = this.shardFlowEnabled;
      const laneJitter = this.ffLaneJitter;
      for (let i = 0; i < asteroids.length; i++) {
          this.applyFlowTo(asteroids[i], dt, FLOW_TARGET_SPEED, flowEnabled, laneJitter);
      }

      // Collectible drops (salvage + health) follow the same asteroid flow
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
              const flow = this.flowField.sampleShardFlow(d.position.x, d.position.y);
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
              // have fixed mass = 5 (makeDropEntity), so all
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

  /** Enemy subtype → its death voice (SFX_INVENTORY §5.2).  Anything not
   *  listed falls back to `destroy.enemy.standard`, so a new archetype is
   *  audible from the day it is added rather than silent until someone
   *  remembers to wire it. */
  private static readonly ENEMY_DEATH_SFX: Partial<Record<EnemySubtype, string>> = {
      [EnemySubtype.SWARM]:    'destroy.enemy.small',
      [EnemySubtype.RAMMER_3]: 'destroy.enemy.heavy',
      [EnemySubtype.KAMIKAZE]: 'destroy.enemy.kamikaze',
      [EnemySubtype.BUBBLE]:   'destroy.enemy.bubble',
  };

  /** Enemy subtype → its death FX profile (roadmap step (b)).  Same shape
   *  and same fallbacks as ENEMY_DEATH_SFX, and resolved by the SAME
   *  classification below, so a class's look and its voice can never
   *  disagree. */
  private static readonly ENEMY_DEATH_FX: Partial<Record<EnemySubtype, ExplosionProfile>> = {
      [EnemySubtype.SWARM]:    EXPLOSION_PROFILES.SWARM,
      [EnemySubtype.RAMMER_3]: EXPLOSION_PROFILES.HEAVY,
      [EnemySubtype.KAMIKAZE]: EXPLOSION_PROFILES.KAMIKAZE,
      [EnemySubtype.BUBBLE]:   EXPLOSION_PROFILES.BUBBLE,
  };

  /** Material family → its break FX profile.  Plastic and nebula are
   *  deliberately absent: plastic has always emitted no death spark burst
   *  and nebula fades out through `mergeFadeTimer` in the renderer, and
   *  both of those are existing deliberate looks, not omissions. */
  private static readonly MATERIAL_FX: Record<string, ExplosionProfile> = {
      glass: EXPLOSION_PROFILES.GLASS,
      rock:  EXPLOSION_PROFILES.ROCK,
      metal: EXPLOSION_PROFILES.METAL,
  };

  /**
   * ONE classification of a dying entity into BOTH its visual profile and
   * its sound — the thing that makes a differentiated explosion and its
   * SFX land as a single beat (roadmap step (b) pairs with step (a)).
   *
   * Either half may be null: a POI has neither, the dragon head's death is
   * staged bespoke by `dragonDeath`, and plastic/nebula have a voice but
   * deliberately no particle burst.
   */
  private deathFx(entity: GameEntity): { fx: ExplosionProfile | null; sfx: string | null } {
      if (entity.type === EntityType.PLAYER) {
          return { fx: EXPLOSION_PROFILES.PLAYER, sfx: 'destroy.player' };
      }
      // A severed dragon segment is material, but breaking a piece off
      // something ALIVE has its own voice.  Checked before the material
      // branch, since a segment is a real tile-variant STRUCTURE.
      if (entity.dragonSegment === true) {
          const mat = GameEngine.MATERIAL_SFX[entity.shardVariant ?? ''];
          return { fx: GameEngine.MATERIAL_FX[mat] ?? null, sfx: 'destroy.dragon.segment' };
      }
      if (entity.type === EntityType.ENEMY) {
          // The dragon head's death is staged by dragonDeath, not here.
          if (entity.enemySubtype === EnemySubtype.DRAGON) return { fx: null, sfx: null };
          if (entity.isBoss) return { fx: EXPLOSION_PROFILES.BOSS, sfx: null }; // payBossBounty owns the voice
          if (entity.isRival) return { fx: EXPLOSION_PROFILES.RIVAL, sfx: 'destroy.rival' };
          const byType = GameEngine.ENEMY_DEATH_FX[entity.enemySubtype as EnemySubtype];
          if (byType) {
              return { fx: byType, sfx: GameEngine.ENEMY_DEATH_SFX[entity.enemySubtype as EnemySubtype] ?? null };
          }
          // A `poise` hull is by definition a heavy one — reading the trait
          // beats maintaining a second subtype list that drifts from it.
          return entity.poise
              ? { fx: EXPLOSION_PROFILES.HEAVY,    sfx: 'destroy.enemy.heavy' }
              : { fx: EXPLOSION_PROFILES.STANDARD, sfx: 'destroy.enemy.standard' };
      }
      if (entity.type === EntityType.STRUCTURE) {
          const mat = GameEngine.MATERIAL_SFX[entity.shardVariant ?? ''];
          if (!mat) return { fx: null, sfx: null };
          return {
              fx: GameEngine.MATERIAL_FX[mat] ?? null,
              sfx: entity.mass === Infinity ? `destroy.tile.${mat}` : `destroy.shard.${mat}`,
          };
      }
      return { fx: null, sfx: null };
  }

  /**
   * Render one death burst from its profile: up to two rings, the body-
   * coloured debris, the profile's accent layer, and a hot spark layer.
   * Every layer is optional (count/scale 0 skips it), which is how a
   * bubble gets no hot core and a material break gets no ring.
   *
   * Runs entirely on the EXISTING ParticleSystem — no new particle engine,
   * and no gradients, so there is nothing to cache per entity here.
   */
  private playDeathFx(entity: GameEntity, p: ExplosionProfile) {
      const pos = entity.position;
      const color = entity.color || '#f87171';
      const r = Math.max(entity.size.x, entity.size.y);
      if (p.ringScale > 0) {
          this.spawnShockwave(pos, {
              radius: r * p.ringScale, damage: 0, knockback: 0,
              color, lifetime: p.ringLifetime,
          });
      }
      if (p.coreScale > 0) {
          this.spawnShockwave(pos, {
              radius: r * p.coreScale, damage: 0, knockback: 0,
              color: '#ffffff', lifetime: p.coreLifetime,
          });
      }
      if (p.debrisCount > 0) {
          this.spawnParticles(pos, p.debrisCount, color, {
              speedMin: p.debrisSpeedMin, speedMax: p.debrisSpeedMax,
              sizeMin: p.debrisSizeMin,   sizeMax: p.debrisSizeMax,
              lifetimeMin: p.debrisLifeMin, lifetimeMax: p.debrisLifeMax,
          });
      }
      // The accent is what lets a class read by HUE rather than only by the
      // body tint — amber embers on a heavy hull, cyan droplets on a bubble.
      if (p.accent && p.accentCount > 0) {
          this.spawnParticles(pos, p.accentCount, p.accent, {
              speedMin: p.debrisSpeedMin * 0.7, speedMax: p.debrisSpeedMax * 0.8,
              sizeMin: p.debrisSizeMin * 0.7,   sizeMax: p.debrisSizeMax * 0.8,
              lifetimeMin: p.debrisLifeMin * 1.2, lifetimeMax: p.debrisLifeMax * 1.4,
          });
      }
      if (p.sparkCount > 0) {
          this.spawnParticles(pos, p.sparkCount, '#ffffff', {
              speedMin: p.sparkSpeedMin, speedMax: p.sparkSpeedMax,
              sizeMin: 1, sizeMax: 3, lifetimeMin: 0.15, lifetimeMax: 0.35,
          });
      }
      if (p.shake > 0) this.handleScreenShake(p.shake);
  }

  handleEntityDeath = (entity: GameEntity, opts?: { scoreScale?: number }) => {
      // Destruction audio (SFX_INVENTORY §5).  Fired FIRST, before any of
      // the bespoke branches below return early, so every death that
      // reaches this handler is heard.  A boss additionally gets its
      // payout beat from payBossBounty, and a dragon its own from
      // dragonDeath — both layered on top rather than replacing this.
      // Every id here collapses on retrigger, which is what keeps a
      // 40-fragment shatter to one heavier sound instead of 40 thin ones.
      // Resolved ONCE and reused for the burst below, so a class's look and
      // its voice come from a single classification.
      // STRUCTURE deaths are IDEMPOTENT (V9).  progressFracture can kill
      // an entity from INSIDE the damage-feedback hook (min-remainder),
      // after which the outer damage path still sees health <= 0 and
      // raises onDeath again — the cached decomposition then spawned an
      // exact duplicate of every fragment (user report: large rocks
      // releasing doubled shards).  Enemies/player already guard via
      // isExploding; structures get an explicit stamp, cleared on regen
      // revival (completeRegen reuses the entity object).
      if (entity.type === EntityType.STRUCTURE) {
          if (entity.deathDispatched === true) return;
          entity.deathDispatched = true;
      }
      const death = entity.isExploding ? { fx: null, sfx: null } : this.deathFx(entity);
      if (death.sfx) {
          // AMBIENT shard breaks (shard-on-shard, shard-on-tile) are
          // near-field by default so a dense field doesn't chatter from
          // events the player is not part of.  A break the PLAYER caused —
          // shot, rammed, chained or splashed, all of which stamp
          // killedByPlayer — is theirs to hear, so it overrides back to the
          // normal radius.  The flag is still live here: the scoring branch
          // that consumes it runs further down.
          const mine = entity.killedByPlayer === true;
          this.audio.play(death.sfx, mine
              ? { x: entity.position.x, y: entity.position.y,
                  near: AUDIO_CONSTANTS.NEAR_RADIUS, far: AUDIO_CONSTANTS.FAR_RADIUS }
              : { x: entity.position.x, y: entity.position.y });
      }
      // Dragon mini-boss (Stage 6): a bespoke death — payoff + rift collapse,
      // not the normal enemy explosion/shard/drop path.
      if (entity.enemySubtype === EnemySubtype.DRAGON && !entity.isExploding) {
          const inst = this.dragons.find(g => g.head === entity);
          if (inst) { dragonDeath(this, inst); return; }
      }
      // A body segment shot off: sever the tail + dissolve it (no regen/drops).
      if (entity.dragonSegment === true) { dragonSegmentDeath(this, entity); return; }
      // Score before startExplosion flips isExploding — the flag doubles
      // as the already-scored guard if a second death dispatch slips in.
      // Survivors retired at time-up never reach this path (WaveSystem
      // flips `active` directly), so they correctly award nothing.
      // scoreScale (default 1) lets the snitch board-clear pay a fraction
      // of the normal kill value per swept enemy.
      // Boss capstone ((h)): the model-(d) payout (salvage + timed shop
      // discount) rides ON TOP of the normal enemy death path below — a boss is
      // still an enemy, so it explodes, pays tier kill points and sprays shards
      // like one.  A rival-stolen kill pays the player nothing, same rule.
      if (entity.isBoss === true && entity.type === EntityType.ENEMY
          && !entity.isExploding && !entity.killedByRival) {
          payBossBounty(this, entity);
      }
      // A rival stole this kill — a small, pointed, deflating sting.  The
      // sound is the ONLY immediate signal the player was robbed, since
      // the points popup simply never appears.
      if (entity.type === EntityType.ENEMY && !entity.isExploding && entity.killedByRival) {
          this.audio.play('rival.steal', { x: entity.position.x, y: entity.position.y });
      }
      if (entity.type === EntityType.ENEMY && !entity.isExploding && !entity.killedByRival) {
          // Ship kills build the combo and are paid at the resulting
          // multiplier; the scoreScale (snitch sweep = 0.5) stacks on top.
          // A rival-killed enemy (killedByRival) pays the player NOTHING — the
          // rival stole it (Stage 7); the theft is shown by the rival's popup.
          // Run summary (A1): this branch is exactly "an enemy ship the
          // PLAYER downed" — rival-stolen kills are filtered out above, so
          // the counter matches the points the player was actually paid.
          this.runKills++;
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
          applyKamikazeBlastToPlayer(this, entity);
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
          // Voronoi opt-outs of the dent-spawn detour (voronoi gauntlet,
          // V2): a dent variant whose shatter.kind is 'voronoi' routes to
          // ShardSystem.shatter like any other — under the DBG 'legacy'
          // A/B the flag flips back and breakShards spawn as before.
          // DropSystem.spawnDrops carries the SAME guard on its
          // spawnDentShard call, so the two paths never double-spawn.
          const voronoiShatter = SHARD_VARIANTS[variant].shatter.kind === 'voronoi'
              && getActiveFractureMode() === 'voronoi';
          const isDentSpawn = dent !== undefined && dent.breakShards.length > 0
              && !voronoiShatter;
          // glass-tile's legacy debris comes from spawnGlassShards (via
          // spawnDrops), so it skips shatter — EXCEPT under voronoi (V5),
          // where its death breaks it into its own cells and the
          // spawnGlassShards call stands down (mirrored gate in
          // DropSystem.spawnDrops).
          if (this.currentMap && (variant !== 'glass-tile' || voronoiShatter)
              && !isDentSpawn) {
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
          // Nebula-specific salvage-drop roll + neighbour-counts-dirty.
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

      // Death burst — differentiated per entity class by EXPLOSION_PROFILES
      // (roadmap step (b)).  Before this, every enemy died the same way
      // tinted by its colour, so a gnat, a tank and a bomber were one event
      // at three sizes; a profile varies ring shape, debris count/speed/
      // size/lifetime, an accent hue and the screen punch.  The profile was
      // chosen by the SAME lookup that picked the sound above.
      //
      // Classes with a deliberate NON-burst keep it: plastic has never
      // sparked on death, and nebulae fade out via mergeFadeTimer in the
      // renderer.  Both resolve to a null profile rather than a special
      // case here.
      if (death.fx) {
          this.playDeathFx(entity, death.fx);
          // Enemy hulls additionally scale their punch by tier, as before.
          if (entity.type === EntityType.ENEMY && death.fx.shake > 0) {
              this.handleScreenShake((entity.enemyTier ?? 1));
          }
      } else if (entity.type !== EntityType.PLAYER
                 && entity.type !== EntityType.ENEMY
                 && !isShardFamily) {
          // Generic fallback for anything outside the classification
          // (misc structures) — unchanged from before.
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

  /** Something too big to fit crossed a rift's centre and was flung back out
   *  (PhysicsSystem.applyGravity).  The physics is done by the time this
   *  runs; this is only the WEIGHT of it — a shake scaled by how big the
   *  thing was, so a boulder ploughing through reads as heavier than a shard
   *  clipping the edge.
   *
   *  There are deliberately NO SPARKS (user call).  It fired a rift-coloured
   *  spray, which is the vocabulary of a COLLISION — and nothing collided:
   *  the rock never touched anything, it was too big to fit down the hole and
   *  the well threw it back.  Debris flying off it says it hit something
   *  solid, which is the one reading a wormhole must not give.  Same argument
   *  as stripping the idle rift to a bare disc: the ornament was saying
   *  something the mechanic does not mean.
   *
   *  Shake is distance-gated by the existing camera falloff rather than by a
   *  check here: `handleScreenShake` is the one funnel every impact in the
   *  game already goes through with magnitudes tuned against each other, so
   *  this joins it rather than inventing a second scale. */
  private handlePortalEject = (entity: GameEntity) => {
      const radius = Math.max(entity.size.x, entity.size.y) * 0.5;
      // Only worth a lurch if it happened near enough to see; the camera's
      // own falloff does the rest.
      const dx = wrapDeltaX(this.player.position.x, entity.position.x);
      const dy = wrapDeltaY(this.player.position.y, entity.position.y);
      if (dx * dx + dy * dy < 900 * 900) {
          this.handleScreenShake(Math.min(6, radius * 0.12));
      }
  };

  private handleRockShardRespawn(config: any) {
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
               const newAst = this.currentMap.createRockShard(x, y,
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

    // Run clock (A1) — SIM seconds, so time spent paused or docked is
    // excluded for free (both freeze the loop).  DEATH no longer freezes it
    // (the field stays alive behind the summary), so the dead window is
    // excluded EXPLICITLY here — reading your own obituary is not play time.
    // The highest wave reached is sampled here rather than at wave start so a
    // wave-free hub visit can't stomp the arena high-water mark.
    if (!this.deathPending && this.deathDelay <= 0) this.runTimeSec += dt;
    // Death beat: the wreck has finished and the sim is STILL running so the
    // field keeps moving; when it expires the summary fades in over a live
    // map.  Ticked here (before the isExploding early-return below) because
    // the player stays flagged exploding for the whole of it.
    if (this.deathDelay > 0) {
        this.deathDelay -= dt;
        if (this.deathDelay <= 0) {
            this.deathDelay = 0;
            this.deathPending = true;
        }
    }
    // Stage-clear beat: the capstone is down and the sim is still running so
    // the explosion plays out; when it expires the screen takes over.
    if (this.stageClearDelay > 0) {
        this.stageClearDelay -= dt;
        if (this.stageClearDelay <= 0) {
            this.stageClearDelay = 0;
            if (this.lastStageClear && !this.player.isExploding) this.stageClearPending = true;
        }
    }
    if (this.wavesEnabled) {
        const n = this.waveIndex + 1;
        if (n > this.runHighestWave) this.runHighestWave = n;
    }

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
        } else if (this.shakeDirX !== 0 || this.shakeDirY !== 0) {
            // DIRECTIONAL: lurch along the impact axis and ring back, rather
            // than shiver.  cos() starts at 1, so the first frame is the
            // hardest push and it is along the direction the ship was shoved
            // — the camera moves with the hit instead of vibrating about it.
            const S = COLLISION_CONFIG.SHAKE;
            const elapsed = CAMERA_CONSTANTS.SHAKE_DECAY - this.shakeTimer;
            const osc = Math.cos(elapsed * S.DIR_FREQ_HZ * Math.PI * 2);
            const along = mag * osc;
            const jitter = mag * S.DIR_JITTER;
            this.camera.shakeOffset.x = this.shakeDirX * along + (Math.random() - 0.5) * jitter;
            this.camera.shakeOffset.y = this.shakeDirY * along + (Math.random() - 0.5) * jitter;
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
    updateBubbles(this, dt);
    // Ambient fauna: keep the always-present bubble population topped up.
    maintainAmbientBubbles(this, dt);

    // Stage 3 reusable mechanics: snap grapples to their targets, and run the
    // (gated) consume-and-grow neighbour scan.  Both no-op until an entity sets
    // attachedToId / consume (Stage 4/5/6).
    updateAttachments(this);
    if (this.perfController.shouldRun('consume')) updateConsumers(this, dt);

    // (h) bosses: apply the health-fraction phase transitions BEFORE the nest
    // pass, so a phase that raises an escort brood arms its timer on the same
    // step it is entered.  Also ticks the timed shop-discount window.
    updateBosses(this, dt);
    // (h) regen trait: tick the burst buckets and heal.  Not boss-only — any
    // enemy carrying the trait is served here.
    this.updateEnemyRegen(dt);

    // Stage 4: nests birth swarm brood on their timers.
    this.updateNests(dt);

    const tRings = performance.now();
    updateExplosionRings(this);
    this.lastExplosionRingsMs = performance.now() - tRings;

    // Death handling
    if (this.player.health <= 0 && !this.player.isExploding) {
        this.handleEntityDeath(this.player);
    }

    if (this.player.isExploding) {
        // Cut the engine with the ship — this branch returns early, so the
        // idle bed would otherwise hum right through the death explosion.
        this.audio.loop('move.thrust', false);
        // `> 0` is load-bearing, not defensive: the sim keeps running after
        // death now, so without it this branch would re-fire (and re-charge
        // the penalty) on every subsequent step.
        if (this.player.explosionTimer !== undefined && this.player.explosionTimer > 0) {
            this.player.explosionTimer -= dt;
            if (this.player.explosionTimer <= 0) {
                // A1: the wreck finishing no longer respawns on its own — it
                // arms the beat that raises the run-summary screen.
                this.player.explosionTimer = 0;
                // Death penalty (user call): forfeit a fraction of UNSPENT
                // Salvage, charged HERE — once, on the transition into the
                // summary — so the screen can report exactly what it cost and
                // so neither respawning nor restarting can double-charge.
                // Money already spent on modules is untouched.
                // Whichever is HIGHER — the percentage or the flat floor —
                // clamped to what the player actually holds, so a broke pilot
                // is zeroed rather than driven negative.
                const lost = Math.min(
                    this.credits,
                    Math.max(
                        Math.floor(this.credits * SALVAGE_CONSTANTS.DEATH_PENALTY_FRACTION),
                        SALVAGE_CONSTANTS.DEATH_PENALTY_MIN,
                    ),
                );
                this.credits -= lost;
                this.lastDeathCreditsLost = lost;
                this.runCreditsLost += lost;
                // Close out this life's income tally for the summary, then
                // start the next life at zero.
                this.lastLifeCreditsEarned = this.lifeCreditsEarned;
                this.lifeCreditsEarned = 0;
                // Freeze the numbers HERE — the world keeps simulating behind
                // the screen, so a summary read live would drift.
                this.deathSummary = this.runSummarySnapshot();
                // Arm the beat instead of raising the screen on the frame the
                // wreck finished: the same reward-moment pacing the boss
                // capstone uses, applied to the player's own death.
                this.deathDelay = UI_CONSTANTS.DEATH_SCREEN_DELAY_SEC;
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
    updateSnitch(this, dt);
    updateDragons(this, dt);
    updateRivals(this, dt);

    // Station docking + portal travel — a handful of O(1) torus-wrapped
    // distances to fixed POI points + the shared E-key edge check.  No
    // scan, no PerfController task needed.  A portal entry swaps the map
    // in place from here; everything below re-reads `currentMap`, so the
    // rest of this step runs against the destination.
    this.updateInteractables();
    this.updatePortalTransit(dt);
    // Overworld roaming dragon — keep one alive: first spawn shortly after
    // run start, then a fresh rift a while after the previous one dies or
    // leaves (the timer re-arms while a dragon is up).
    if (this.currentMap.type === MapType.OVERWORLD) {
        if (this.dragons.length > 0) {
            this.overworldDragonTimer = OVERWORLD_CONSTANTS.DRAGON_RESPAWN_SEC;
        } else {
            this.overworldDragonTimer -= dt;
            if (this.overworldDragonTimer <= 0) {
                const types: (StructureVariant | 'mixed')[] = ['glass', 'rock', 'plastic', 'metal', 'mixed'];
                spawnDragon(this, types[Math.floor(Math.random() * types.length)]);
                this.overworldDragonTimer = OVERWORLD_CONSTANTS.DRAGON_RESPAWN_SEC;
            }
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
    const acc = (moveConfig ? moveConfig.acceleration : PHYSICS_CONSTANTS.ACCELERATION) * getActivePlayerThrustMult() * this.moduleThrustMult;
    const maxSpeed = (moveConfig ? moveConfig.maxSpeed : PHYSICS_CONSTANTS.MAX_SPEED) * getActivePlayerSpeedMult() * this.moduleSpeedMult;
    // Cached for the thrust trigger's resistance, which reports how close the
    // ship is to its cap.  Read here rather than recomputed, so the number the
    // hand feels is the number the sim is enforcing.
    this.lastMaxSpeed = maxSpeed;
    // The ship's actual TERMINAL speed under held thrust: each 60Hz tick the
    // movement below adds `acc` and PhysicsSystem multiplies by the per-map
    // friction f, so speed settles at acc·f/(1−f) — about a THIRD of the cap
    // on the shipped tuning (the cap only matters for knockback overshoot).
    // Cached for the tilt code, which normalises every velocity read by what
    // the ship can actually REACH: dividing by the cap ran the slip term, the
    // centripetal gate and the whole Velocity tilt source ~3× too weak
    // (user report: "velocity effects are very weak or not showing").
    const fr = moveConfig ? moveConfig.friction : PHYSICS_CONSTANTS.FRICTION;
    this.lastCruiseSpeed = Math.min(maxSpeed, (acc * fr) / Math.max(1e-6, 1 - fr));

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
    // Engine rumble (SFX_INVENTORY §6).  ALWAYS ON while alive — the loop
    // idles and the throttle swells it, rather than the whole bed snapping
    // on and off with the input.  Flat rather than positional: it is the
    // player's own ship.
    this.audio.loop('move.thrust', true, { param: Math.min(1, throttle) });

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

    // Banking roll — after the rotation update so the lateral decomposition
    // reads this step's facing, not last step's.
    this.tickPlayerRoll(dt, moveDir);

    const fireEvents = this.input.getFireEvents();
    fireEvents.forEach(evt => {
        const { x: mapX, y: mapY, size: currentSize } =
            computeMinimapRect(window.innerHeight, this.minimapExpanded);

        if (evt.x >= mapX && evt.x <= mapX + currentSize &&
            evt.y >= mapY && evt.y <= mapY + currentSize) {

            if (this.minimapDebounce > 0) return;

            this.minimapExpanded = !this.minimapExpanded;
            this.minimapTimer = this.minimapExpanded ? 5.0 : 0;
            this.minimapDebounce = 0.3;
            return;
        }

        // Loadout HUD slot selection — intercept taps on the 2 equip slots.
        const { SLOT_H } = LOADOUT_HUD_CONSTANTS;
        const { startY: slotStartY, slotW, slotXs } =
            computeLoadoutHUDLayout(window.innerWidth, window.innerHeight);

        if (evt.y >= slotStartY && evt.y <= slotStartY + SLOT_H) {
            for (let i = 0; i < slotXs.length; i++) {
                if (evt.x >= slotXs[i] && evt.x <= slotXs[i] + slotW) {
                    const w = this.equippedWeapons[i];
                    if (w !== null) this.selectWeapon(w);
                    return; // empty-slot tap is a no-op but still swallowed
                }
            }
        }

        // Whether a TAP is a shot is the scheme's call (G9): under the
        // joystick scheme shooting is the fire button's job, and a tap that
        // both aims and fires cannot coexist with a thumb that drags to aim.
        // The tap still reached the minimap toggle, the loadout slots and
        // `claimTapNear` above — those are not weapons.
        if (!this.minimapExpanded && this.input.tapFires()) {
            this.handleShooting(evt, false);
        }
    });

    // Charge-release events: held for the full CHARGE_FULL window then
    // released.  Fire a charged shot.
    const chargeReleaseEvents = this.input.getChargeReleaseEvents();
    chargeReleaseEvents.forEach(evt => {
        if (!this.minimapExpanded && this.input.tapFires()) {
            this.handleShooting(evt, true);
        }
    });

    // DEVICE shots — the onscreen fire button and the pad's trigger.  These
    // bypass the tap handler entirely (see InputSystem.getDeviceFireEvents):
    // a synthesised shot is aimed at the world, so it must not be offered to
    // the HUD widgets a real tap would hit on the way past.  The expanded
    // minimap does not block them either — the player pressed a weapon
    // control, not the map.
    const deviceFires = this.input.getDeviceFireEvents();
    for (let i = 0; i < deviceFires.length; i++) this.handleShooting(deviceFires[i], false);
    const deviceCharges = this.input.getDeviceChargeEvents();
    for (let i = 0; i < deviceCharges.length; i++) this.handleShooting(deviceCharges[i], true);

    // Update player.chargeProgress for the charge-ring HUD.  Stored as
    // fraction of CHARGE_FULL ([0, 1]).  Ring snaps to "full" colour at 1.
    const heldFor = this.input.getMouseHoldDuration();
    const prevCharge = this.player.chargeProgress ?? 0;
    this.player.chargeProgress = (this.player.overchargeUnlocked && this.player.currentWeapon !== undefined && heldFor > 0 && !this.player.systemsDisabled)
        ? Math.min(1, heldFor / INPUT_CONSTANTS.CHARGE_FULL)
        : 0;
    // Charge audio (SFX_INVENTORY §4.1): the whine TRACKS progress, so the
    // player can charge without watching their own ship, and a bell ping
    // marks the moment the shot arms.  `loop` is idempotent both ways, so
    // firing it every step with a live predicate is the intended usage.
    this.audio.loop('weapon.charge.loop', this.player.chargeProgress > 0,
                    { param: this.player.chargeProgress });
    if (this.player.chargeProgress >= 1 && prevCharge < 1) this.audio.play('weapon.charge.ready');

    // Adaptive triggers follow the SAME state the charge ring does, which is
    // why the sync sits here rather than on the weapon-change path: what the
    // trigger should feel like is a function of what the player is holding
    // RIGHT NOW, and "charging" is a state no weapon-change event fires for.
    // Three cases, in order of precedence: nothing to fire (no gun, or EMP'd
    // — the trigger goes slack, which is the disable made physical), winding
    // up a charged shot (a hard wall), or the equipped gun's own profile.
    // The call is a struct compare when nothing changed; it is a no-op
    // entirely unless the player has opted into WebHID.
    const thrustScheme = this.input.usesTriggerThrust();
    this.input.setTriggerProfile(
      // Under trigger-thrust the RIGHT trigger is a throttle too, so a weapon
      // profile on it would be describing a control the player is not using.
      thrustScheme ? THRUST_TRIGGER(this.playerSpeedFraction())
      // ...and where the gun has moved to a FACE button (`gamepad-left`) the
      // trigger is not the gun either, so it goes slack rather than
      // resisting for a control that fires nothing.
      : this.input.usesFaceFire() ? TRIGGER_OFF
      : (this.player.currentWeapon === undefined || this.player.systemsDisabled) ? TRIGGER_OFF
      : this.player.chargeProgress > 0 ? chargeTrigger(this.player.chargeProgress)
      : WEAPON_TRIGGERS[this.player.currentWeapon]);

    // The LEFT trigger is the throttle under the trigger-thrust scheme, and
    // its resistance reports what the engine is doing: it stiffens as the
    // ship approaches its top speed, so "already flat out" is something the
    // hand knows without reading the HUD.  Released under every other scheme
    // — a clutch on a control that does nothing is just a stiff trigger.
    this.input.setThrustTriggerProfile(
      thrustScheme && !this.player.isExploding
        ? THRUST_TRIGGER(this.playerSpeedFraction())
        : TRIGGER_OFF);

    // Tick weapon cooldown + burst-fire queue via WeaponSystem — frozen while
    // EMP-disabled (Stage 3c) so an in-flight burst halts too.
    const tWeapons = performance.now();
    if (this.currentMap && !this.player.systemsDisabled) {
        this.weapons.tickPlayerBurst(this.currentMap.entities, this.player, dt,
                                     this.handleScreenShake, this.playWeaponSfx);
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

    // Tick down the salvage-pickup flash timer (drives the "+N" flash on
    // the HUD Salvage chip via EngineStats.salvageFlash)
    if (this.player.salvagePickupFlash && this.player.salvagePickupFlash.timer > 0) {
      this.player.salvagePickupFlash.timer -= dt;
      if (this.player.salvagePickupFlash.timer <= 0) {
        this.player.salvagePickupFlash = undefined;
      }
    }

    // Proximity collection + magnetic pull — single pass over activeDrops.
    // A drop starts pulling only once the player comes within
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

    // Consolidate same-type drop clusters — pairs within touching range
    // fuse, the survivor absorbs the value, the other retires for
    // the compaction sweep below.  Total value across the cluster is
    // preserved (sum-of-values onto the survivor), so this is purely
    // an entity-count reduction, not a reward nerf.  Cadenced via
    // PerfController 'dropMerge' (autoCurve 1-4 steps) — the O(N²)
    // pair scan + pull damping isn't time-critical, drops converge
    // over many frames either way.
    if (this.perfController.shouldRun('dropMerge')) {
      this.drops.mergeDrops(this.activeDrops);
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
  spawnParticles(
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

  /** Shard variant → its material's impact / destruction SFX suffix.  One
   *  table drives both `impact.tile.*` and `destroy.tile.*`/`destroy.shard.*`
   *  so a material can never sound like one thing when chipped and another
   *  when broken. */
  private static readonly MATERIAL_SFX: Record<string, string> = {
      'glass-tile': 'glass', 'glass-shard': 'glass',
      'rock-tile': 'rock',   'rock-shard': 'rock',
      'metal-tile': 'metal', 'metal-shard': 'metal',
      'plastic-tile': 'plastic', 'plastic-shard': 'plastic',
      'nebula-tile': 'nebula',   'nebula-shard': 'nebula',
      // Indestructible tiles never die, but they DO get shot at.
      'indestructible-tile': 'metal',
  };

  private handleProjectileHit = (impactPos: Vector2, proj: GameEntity, target: GameEntity) => {
    // Impact audio (SFX_INVENTORY §4.3).  This handler already switches on
    // target class and shard variant for the particle layer, so the sound
    // rides the same dispatch — audio and visual land as one beat.
    if (target.type === EntityType.ENEMY) {
        this.audio.play('impact.hull.enemy', { x: impactPos.x, y: impactPos.y });
    } else if (target.type === EntityType.PLAYER) {
        this.audio.play('impact.hull.player', { x: impactPos.x, y: impactPos.y });
    } else if (target.type === EntityType.STRUCTURE) {
        const mat = GameEngine.MATERIAL_SFX[target.shardVariant ?? ''];
        if (mat) this.audio.play(`impact.tile.${mat}`, { x: impactPos.x, y: impactPos.y });
    }

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
        applyExplosionAoE(this, impactPos, proj, target);
    }
  };

  // ── Module effects + activity (adjacency requirements) ──────────────────

  // Movement multipliers from ACTIVE engine/thruster modules — read in the
  // per-frame movement line alongside the DBG thrust/speed cycles.
  moduleSpeedMult = 1;
  moduleThrustMult = 1;
  // Total SHIP weight (hull + every active module).  A first-class ship
  // attribute — the acceleration curve reads it, and the Ship Status panel
  // reports it as its own stat rather than blaming individual guns.
  shipWeight = SHIP_WEIGHT.HULL_BASE;

  // ── DBG module grants ───────────────────────────────────────────────────

  /** DBG: grant one module variety into the inventory — and auto-install
   *  it if a compatible hex is free (bypasses the drydock guard so
   *  wave-map testing needs no station trip).  No-op when the inventory
   *  is full. */
  public debugGrantModule(id: string) {
      const def = moduleDef(id);
      if (!def) return;
      const inv = this.inventory.indexOf(null);
      if (inv === -1) return;
      this.inventory[inv] = id;
      const free = firstFreeSlotFor(this, def);
      if (free !== -1) this.moveModuleInternal({ area: 'inventory', idx: inv }, { area: def.group, idx: free });
  }

  /** DBG: outfit a full high-end loadout in a canonical layout that
   *  satisfies every adjacency requirement, plus the remaining guns in
   *  the inventory. */
  public debugOutfitAll() {
      this.shipSlots.fill(null);
      this.weaponSlots.fill(null);
      this.inventory.fill(null);
      // Ship flower: hull core center; shield at 1 (touches hull);
      // capacitor at 6 (touches shield); plating 2, engine 3, thrusters 4
      // (touches engine).  Slot 5 left free.
      this.shipSlots[0] = 'hull_mk3';
      this.shipSlots[1] = 'shield';
      this.shipSlots[6] = 'capacitor_mk3';
      this.shipSlots[2] = 'plating_mk3';
      this.shipSlots[3] = 'engine_mk3';
      this.shipSlots[4] = 'thrusters_mk3';
      // Weapon flower: two guns + the three mods around the center gun.
      this.weaponSlots[0] = 'wpn_blaster';
      this.weaponSlots[1] = 'wpn_cannon';
      this.weaponSlots[2] = 'gunnery_mk3';
      this.weaponSlots[3] = 'autoloader_mk3';
      this.weaponSlots[4] = 'overcharge';
      const spareGuns = ['wpn_burst', 'wpn_shotgun', 'wpn_bouncer', 'wpn_lightning', 'wpn_homing'];
      for (let i = 0; i < spareGuns.length; i++) this.inventory[i] = spareGuns[i];
      syncLoadoutFromSlots(this);
      this.player.shield = this.player.maxShield ?? 0;
  }

  /** Run reset + DBG relock: back to the lean start — empty inventory,
   *  the free Base Hull on the center ship hex (adjacency root) and the
   *  starter Blaster on gun hex W1. */
  public resetOutfit() {
      this.shipSlots.fill(null);
      this.weaponSlots.fill(null);
      this.inventory.fill(null);
      this.shipSlots[0] = 'hull_base';
      this.weaponSlots[0] = 'wpn_blaster';
      this.player.currentWeapon = WeaponType.BLASTER;
      this.currentWeaponIndex = 0;
      syncLoadoutFromSlots(this);
  }

  /** DBG: grant Salvage for testing the shop. */
  public addDebugCredits(n: number) { this.credits += n; }

  // ── Status effects ──────────────────────────────────────────────────────

  /** Apply (or refresh + stack) a status effect on an entity (the player
   *  today).  Re-hits add a stack up to maxStacks and refresh the timer. */
  applyStatusEffect(target: GameEntity, payload: EffectPayload) {
    const list = target.statusEffects ?? (target.statusEffects = []);
    // Corrosion steps a semitone per stack so three stacks are audible AS
    // three; the EMP's power-down is the warning that fire is about to do
    // nothing (SFX_INVENTORY §8.2).
    if (target.type === EntityType.PLAYER) {
      const stacks = (list.find(e => e.kind === payload.kind)?.stacks ?? 0) + 1;
      if (payload.kind === 'corrosion') {
        this.audio.play('status.corrosion.apply', { pitch: Math.pow(2, (stacks - 1) / 12) });
      } else {
        this.audio.play('status.disable.apply');
      }
    }
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
    if (!list || list.length === 0) {
      // Nothing active: make sure the EMP dead-air loop is down.  The
      // recovery rise is played by the splice below, once per effect, so
      // it is deliberately NOT repeated here.
      this.audio.loop('status.disable.loop', false);
      return;
    }
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
      if (e.remaining <= 0) { list.splice(i, 1); this.audio.play('status.expire'); }
    }
    // Dead-air hum while EMP'd — the audible half of "your systems are
    // off".  Idempotent, so driving it from the live flag each tick is the
    // intended usage.
    this.audio.loop('status.disable.loop', this.player.systemsDisabled === true);
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

  // ── Space station docking (economy-pivot 1e; multi-station) ──────────────

  /** Per-sim-step interaction check for the two E-key POIs: stations
   *  (dock) and map portals (travel).  Both lists are tiny and fixed —
   *  the Overworld has 4 stations + 4 portals, an arena has 1 portal — so
   *  this is a handful of O(1) torus-wrapped distances per step, no scan
   *  and no PerfController task.
   *
   *  Stations and portals share the E key, so the two candidates are
   *  ARBITRATED BY NEAREST: whichever is closer wins, and only the winner
   *  gets its `*Ready` flag stamped.  That gives exactly one world-space
   *  halo, exactly one HUD affordance, and an affordance that always names
   *  the action E will take.  Runs only while PLAYING and undocked (the
   *  docked branch lives in the loop's freeze short-circuit). */
  private updateInteractables() {
    const blocked = this.player.isExploding;

    let station: GameEntity | null = null;
    let stationD2 = Infinity;
    // Nearest station at ANY distance — drives the presence loop, which
    // should swell on approach rather than switch on at the dock range.
    let nearestStationAny: GameEntity | null = null;
    let nearestStationAnyD2 = Infinity;
    const dockR2 = STATION_CONSTANTS.DOCK_RANGE * STATION_CONSTANTS.DOCK_RANGE;
    for (let i = 0; i < this.stations.length; i++) {
        const s = this.stations[i];
        s.stationDockReady = false;
        if (!s.active) continue;
        const dx = wrapDeltaX(s.position.x, this.player.position.x);
        const dy = wrapDeltaY(s.position.y, this.player.position.y);
        const d2 = dx * dx + dy * dy;
        if (d2 < nearestStationAnyD2) { nearestStationAny = s; nearestStationAnyD2 = d2; }
        if (blocked) continue;
        if (d2 <= dockR2 && d2 < stationD2) { station = s; stationD2 = d2; }
    }

    let portal: GameEntity | null = null;
    let portalD2 = Infinity;
    let nearestPortalAny: GameEntity | null = null;
    let nearestPortalAnyD2 = Infinity;
    const useR2 = PORTAL_CONSTANTS.USE_RANGE * PORTAL_CONSTANTS.USE_RANGE;
    for (let i = 0; i < this.portals.length; i++) {
        const p = this.portals[i];
        p.portalReady = false;
        if (!p.active) continue;
        const dx = wrapDeltaX(p.position.x, this.player.position.x);
        const dy = wrapDeltaY(p.position.y, this.player.position.y);
        const d2 = dx * dx + dy * dy;
        if (d2 < nearestPortalAnyD2) { nearestPortalAny = p; nearestPortalAnyD2 = d2; }
        if (blocked) continue;
        if (d2 <= useR2 && d2 < portalD2) { portal = p; portalD2 = d2; }
    }

    // Nearest wins.  Ties (and the both-null case) fall to the station
    // branch, preserving the pre-portal behaviour exactly.
    if (station && portal) {
        if (portalD2 < stationD2) station = null; else portal = null;
    }
    this.nearestStation = station;
    this.nearestPortal = portal;
    // POI presence loops.  Driven by the NEAREST portal / station at any
    // distance, so the volume swells as the player approaches instead of
    // snapping on at the interaction range; the per-sound radii do the
    // falloff.  One loop per id, so with four rifts on the Overworld the
    // nearest one owns the voice.  Deliberately different characters —
    // the portal is a tonal hum, the station a broadband bed — so the two
    // are tellable apart without looking.
    this.audio.loop('portal.idle', nearestPortalAny !== null,
                    nearestPortalAny
                      ? { x: nearestPortalAny.position.x, y: nearestPortalAny.position.y }
                      : undefined);
    this.audio.loop('poi.station.idle', nearestStationAny !== null,
                    nearestStationAny
                      ? { x: nearestStationAny.position.x, y: nearestStationAny.position.y }
                      : undefined);
    this.dockInRange = station !== null;
    if (station) station.stationDockReady = true;
    if (portal) portal.portalReady = true;

    // ── Trigger: SELECT YOUR SHIP, or press E ────────────────────────────
    // The primary gesture is tapping/clicking the ship itself — it works the
    // same on touch and mouse, needs no HUD button under the thumb, and puts
    // the control where the player is already looking.  The tap is CLAIMED
    // out of the fire queue (see InputSystem.claimTapNear) so using a portal
    // never also fires a shot; claiming only happens while something is
    // actually in range, so tapping the ship in open space still shoots.
    // E stays as the keyboard equivalent.
    //
    // A CONTROLLER button is the third path, and c2 wired it exactly as the
    // hole was left: the pad polls ONCE per frame in GameEngine.pollGamepad
    // and latches an edge, which is OR'd into `selected` below.  Nothing else
    // moved — no second polling path, no second arbitration.
    // Prompt AT the ship — the control lives there now, so the instruction
    // does too.  Cleared whenever nothing is in range.
    this.player.interactPrompt = portal
        ? (portal.isDescent ? 'TAP SHIP TO DESCEND'
           : portal.portalTargetId === HUB_DESCRIPTOR.id ? 'TAP SHIP TO RETURN'
           : 'TAP SHIP TO ENTER')
        : station ? 'TAP SHIP TO DOCK'
        : undefined;

    // Drained EVERY step, spent only when something is in range: a press in
    // open space is a press in open space, not a charge banked against the
    // next station you happen to fly past.  (The tap path gets this for free —
    // `claimTapNear` is only called while in range, and an unclaimed tap just
    // shoots.)
    const padInteract = this.input.consumeInteractPress();

    let selected = false;
    // The FLASHLIGHT TOOL rides the same gesture as the dock/portal, as the
    // fallback: with the kit installed, a ship-tap (or E, or the pad's
    // action button) in OPEN SPACE cycles the light.  Claiming the tap here
    // means a tap on the ship no longer fires a stray shot at your own hull
    // while the kit is aboard — which is the affordance the user asked for
    // ("turned on and off by touching the player ship").  Without the kit,
    // open-space behaviour is unchanged (the tap still shoots).
    if (station || portal || this.flashlightEquipped) {
        const screen = this.renderer.worldToScreen(this.camera, this.player.position);
        if (screen) {
            selected = this.input.claimTapNear(
                screen.x, screen.y,
                INPUT_CONSTANTS.SHIP_SELECT_RADIUS,
            );
        }
        if (!selected && padInteract) selected = true;
    }
    const eDown = this.input.isKeyDown('KeyE');
    if (selected || (eDown && !this.dockKeyHeld)) {
        if (portal) this.enterPortal();
        else if (station) this.dockAtStation();
        else this.cycleShipLight();
    }
    this.dockKeyHeld = eDown;
  }

  /** Dock at the nearest in-range station: freeze the sim and open its
   *  station UI (panels per STATION_VARIANTS services).  The ship parks
   *  (velocity zeroed) so undocking resumes stationary. */
  public dockAtStation(): boolean {
    if (this.gameState !== GameState.PLAYING) return false;
    if (this.dockedAtStation || !this.nearestStation || this.player.isExploding) return false;
    this.dockedAtStation = true;
    this.dockedStation = this.nearestStation;
    this.audio.play('poi.dock');
    this.player.velocity.x = 0;
    this.player.velocity.y = 0;
    return true;
  }

  /** Undock: release the sim freeze.  Mirrors resumeGame's accumulator
   *  hygiene so the first post-dock frame doesn't integrate stale time. */
  public undock() {
    if (!this.dockedAtStation) return;
    this.audio.play('poi.undock');
    this.dockedAtStation = false;
    this.dockedStation = null;
    this.lastTime = performance.now();
    this.simAccumulator = 0;
  }

  /** Hull repair — pay-per-HP, PRO-RATED.  Only at stations offering the
   *  repair service.  Shield is untouched — it recharges in the field. */
  public repairHull(): boolean {
    if (!this.dockedServices()?.repair) return false;
    const missing = Math.ceil(this.player.maxHealth - this.player.health);
    if (missing <= 0) return false;
    const per = STATION_CONSTANTS.REPAIR_COST_PER_HP;
    const heal = Math.min(missing, Math.floor(this.credits / per));
    if (heal <= 0) return false;
    this.credits -= heal * per;
    this.player.health = Math.min(this.player.maxHealth, this.player.health + heal);
    this.pushPlayerMessage(`+${heal} hull`, '#4ade80');
    this.audio.play('poi.repair');
    return true;
  }

  /** Run summary for EngineStats (A1) — built ONCE, at the moment of death,
   *  and then republished verbatim while `deathPending` (the sim keeps running
   *  behind the screen, so a live rebuild would drift).  Every field is a
   *  counter that already exists on the engine; nothing is recomputed here. */
  private runSummarySnapshot() {
    return {
      score: this.score,
      bestCombo: this.runBestCombo,
      kills: this.runKills,
      bosses: this.bossesKilled,
      wavesCleared: this.runWavesCleared,
      highestWave: this.runHighestWave,
      wavesEnabled: this.wavesEnabled,
      credits: this.credits,
      creditsEarned: this.runCreditsEarned,
      creditsEarnedLife: this.lastLifeCreditsEarned,
      creditsLost: this.lastDeathCreditsLost,
      creditsLostRun: this.runCreditsLost,
      timeSec: Math.floor(this.runTimeSec),
      mapName: this.currentMap?.name ?? '',
    };
  }

  /** Dock state for EngineStats: in-range/docked + the station's name and
   *  services so the UI shows the right affordance + panels. */
  private dockStatsSnapshot() {
    if (this.stations.length === 0) return undefined;
    const s = this.dockedAtStation ? this.dockedStation : this.nearestStation;
    const kind = s?.stationKind as StationKind | undefined;
    const variant = kind !== undefined ? STATION_VARIANTS[kind] : undefined;
    return {
        inRange: this.dockInRange,
        docked: this.dockedAtStation,
        name: variant?.name ?? s?.name,
        services: variant ? { ...variant.services } : undefined,
    };
  }

  /** Portal state for EngineStats: the in-range rift the E key would take,
   *  or undefined when a station won the nearest-in-range arbitration (or
   *  nothing is in range).  Exactly one of `dock.inRange` / `portal` is
   *  ever truthy, so the HUD offers a single unambiguous affordance. */
  private portalStatsSnapshot() {
    const p = this.nearestPortal;
    if (!p || !p.portalTargetId) return undefined;
    return {
        name: p.name ?? mapDescriptor(p.portalTargetId)?.name ?? 'UNKNOWN',
        targetId: p.portalTargetId,
        isReturn: p.portalTargetId === HUB_DESCRIPTOR.id,
    };
  }

  /** Station services snapshot for the docked UI (repair panel). */
  private stationSnapshot() {
    const per = STATION_CONSTANTS.REPAIR_COST_PER_HP;
    const missing = Math.max(0, Math.ceil(this.player.maxHealth - this.player.health));
    return {
        repairCostPerHp: per,
        missingHull: missing,
        fullRepairCost: missing * per,
        canRepair: missing > 0 && this.credits >= per,
    };
  }

  /** DBG: teleport the player to a station's doorstep, cycling through
   *  the stations on repeated presses (Overworld only — no-op on maps
   *  without stations). */
  public debugTeleportToStation() {
    if (this.stations.length === 0) return;
    this.teleportStationIdx = (this.teleportStationIdx + 1) % this.stations.length;
    const s = this.stations[this.teleportStationIdx];
    this.player.position.x = s.position.x;
    this.player.position.y = s.position.y + STATION_CONSTANTS.DOCK_RANGE * 0.8;
    wrapPosition(this.player.position);
    this.player.velocity.x = 0;
    this.player.velocity.y = 0;
  }
  private teleportStationIdx = -1;

  // ── Outfitting: loadout sync, tile moves, purchases, snapshots ──────────

  /**
   * Move a module item between tiles: inventory↔inventory (reorder),
   * inventory→hex (install), hex→inventory (uninstall), hex↔hex (move).
   * An occupied destination SWAPS when the displaced item fits the
   * source tile.  DRYDOCK-ONLY: rejected unless docked at a station with
   * a drydock (DBG paths bypass via moveModuleInternal) — EXCEPT pure
   * inventory↔inventory reorders, which are legal anywhere (rearranging
   * cargo is not outfitting).
   */
  public moveModule(
      from: { area: 'inventory' | 'ship' | 'weapon'; idx: number },
      to: { area: 'inventory' | 'ship' | 'weapon'; idx: number },
  ): boolean {
      const cargoOnly = from.area === 'inventory' && to.area === 'inventory';
      if (!cargoOnly && !this.dockedServices()?.drydock) {
          // Outfitting away from a drydock is the single most common thing
          // a player tries and cannot do — it needs an audible "no".
          this.audio.play('poi.reject');
          return false;
      }
      const moved = this.moveModuleInternal(from, to);
      // Seating a module into a hex is the tactile beat; dropping one back
      // into cargo is the softer one; a refused move is the reject buzz.
      this.audio.play(!moved ? 'poi.reject'
          : to.area === 'inventory' ? 'poi.module.stow' : 'poi.module.install');
      return moved;
  }

  // ─── Outfitting: the three entry points that are PUBLIC SURFACE ─────────
  //
  // Bodies live in engine/outfitting.ts with the rest of the hex-slot
  // machinery (gauntlet 5f).  These three keep a method on the engine because
  // the 5b suites call them straight off `window.__omniEngine` — `private` is
  // compile-time only, so what the tests reach for IS the observable surface,
  // and moving them off the class broke three suites until they came back.
  // That is the test net doing exactly the job it exists for; the forwards are
  // the honest record of where the boundary actually is.

  /** The tile move/swap itself, without `moveModule`'s drydock guard. */
  moveModuleInternal(
      from: { area: 'inventory' | 'ship' | 'weapon'; idx: number },
      to: { area: 'inventory' | 'ship' | 'weapon'; idx: number },
  ): boolean { return moveModuleTiles(this, from, to); }

  /** The ONE pricing seam — buy and resale both route through it. */
  modulePrice(cost: number): number { return catalogPrice(cost); }

  /** Hex-slot snapshot for the station UI + the pause cargo panel. */
  outfittingSnapshot() { return buildOutfittingSnapshot(this); }

  /** SELL an inventory module back for MODULE_RESALE.SELL_FRACTION of its
   *  cost.  Needs a station (any — every station drydocks); acts on
   *  INVENTORY tiles only, so installed modules must be uninstalled
   *  first.  Free items (Base Hull) can't be sold — scrap those. */
  public sellModule(idx: number): boolean {
      if (!this.dockedAtStation) return false;
      const value = resaleValue(this, idx, MODULE_RESALE.SELL_FRACTION);
      if (value === null || value <= 0) return false;
      this.inventory[idx] = null;
      this.credits += value;
      this.audio.play('poi.sell');
      return true;
  }

  /** SCRAP an inventory module from ANYWHERE for
   *  MODULE_RESALE.SCRAP_FRACTION of its cost — the jettison-for-pennies
   *  option when no station is near (also the only way to shed cost-0
   *  items like a spare Base Hull, which pay nothing). */
  public scrapModule(idx: number): boolean {
      const value = resaleValue(this, idx, MODULE_RESALE.SCRAP_FRACTION);
      if (value === null) return false;
      this.inventory[idx] = null;
      this.credits += value;
      this.audio.play('poi.scrap');
      return true;
  }

  /** Services of the currently docked station (null when undocked). */
  private dockedServices(): StationServices | null {
      const kind = this.dockedAtStation
          ? (this.dockedStation?.stationKind as StationKind | undefined)
          : undefined;
      return kind !== undefined ? STATION_VARIANTS[kind].services : null;
  }

  /** Buy a module ITEM into the inventory.  Requires being docked at a
   *  station whose shop carries the module's group, the salvage, and a
   *  free inventory tile.  NO auto-install — outfitting happens at a
   *  drydock (the shop and the drydock may be different stations). */
  public purchaseModule(moduleId: string): boolean {
      const def = moduleDef(moduleId);
      const svc = this.dockedServices();
      if (!def || !svc) return false;
      if (def.group === 'ship' ? !svc.shipShop : !svc.weaponShop) return false;
      const price = this.modulePrice(def.cost);
      if (def.cost <= 0 || this.credits < price) return false;
      const inv = this.inventory.indexOf(null);
      if (inv === -1) return false; // inventory full
      this.credits -= price;
      this.inventory[inv] = moduleId;
      this.audio.play('poi.purchase');
      return true;
  }

  /** DBG: mount one gun variety onto a gun hex (the pause-menu debug
   *  Weapons rows — the wave-map test path; bypasses the drydock guard).
   *  Fills the first empty gun hex, else replaces the hex the ACTIVE
   *  weapon is not in; a displaced gun drops to the inventory if there
   *  is room (else it is scrapped — DBG only). */
  public debugGrantWeapon(id: string) {
      const mDef = MODULE_DEFS.find(m => m.weapon === (id as WeaponType));
      if (!mDef) return;
      if (this.weaponSlots.includes(mDef.id)) return; // already mounted
      const gunSlots = this.weaponSlots
          .map((s, i) => ({ s, i }))
          .filter(e => e.s !== null && moduleDef(e.s)?.kind === 'weapon');
      let slot: number;
      if (gunSlots.length < MAX_INSTALLED_GUNS) {
          slot = this.weaponSlots.indexOf(null);
          if (slot === -1) slot = gunSlots.length > 0 ? gunSlots[gunSlots.length - 1].i : 0;
      } else {
          // At the gun limit — replace the mounted gun the ACTIVE weapon is
          // not, so the weapon under test doesn't yank the one being fired.
          const victim = gunSlots.find(e => moduleDef(e.s!)?.weapon !== this.player.currentWeapon) ?? gunSlots[0];
          slot = victim.i;
      }
      const displaced = this.weaponSlots[slot];
      if (displaced !== null) {
          const inv = this.inventory.indexOf(null);
          if (inv !== -1) this.inventory[inv] = displaced;
      }
      this.weaponSlots[slot] = mDef.id;
      syncLoadoutFromSlots(this);
  }

  /** Weapon catalog for the pause-menu DEBUG weapons rows (built only
   *  while paused): every gun variety with its presence + gun-hex index. */
  private weaponCatalogSnapshot() {
      return MODULE_DEFS.filter(d => d.family === 'gun').map(d => ({
          id: d.weapon as string,
          name: d.label,
          owned: this.weaponSlots.includes(d.id) || this.inventory.includes(d.id),
          slot: (() => {
              const i = d.weapon !== undefined ? this.equippedWeapons.indexOf(d.weapon) : -1;
              return i === -1 ? null : i;
          })(),
      }));
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
      const mult = this.comboMultiplier();
      // Run summary (A1): the best multiplier the run ever reached.
      if (mult > this.runBestCombo) this.runBestCombo = mult;
      return mult;
  }

  /** Salvage income — the ONE way credits are earned in the field.  Wraps the
   *  `this.credits += n` the drop paths used to do inline so the run-summary
   *  "earned this run" counter can't drift from the balance.  Deliberately
   *  NOT used by resale (sell/scrap is a refund of money already earned, so
   *  routing it here would double-count) nor by the DBG credit grant. */
  earnCredits(n: number) {
      this.credits += n;
      this.runCreditsEarned += n;
      this.lifeCreditsEarned += n;
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
  awardScore(points: number, popupPos?: Vector2) {
      this.score += points;
      // NOTE: score no longer mints Salvage (the 1:1 credits mirror is gone —
      // weapons-ammo pivot increment 1a).  Credits come only from COLLECTING
      // salvage drops in the field (applyDropEffect → onSalvage).
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

  spawnDamageText = (pos: Vector2, amount: number, target?: GameEntity, impactWorldPos?: Vector2) => {
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
          // PROGRESSIVE FRACTURE (V8; V10 generalised past rock).  Damage
          // highlights the pattern's boundaries and a piece breaks off
          // exactly when its boundary completes — no cadence roll.  Any
          // variant carrying `fracture.progressive` runs it: rock AND
          // glass since V10 (user call).  The legacy spawn-beside chip
          // stays for rock under the DBG 'legacy' A/B, and as the
          // fallback when an entity carries no usable decomposition.
          if (impactWorldPos && target.shardVariant !== undefined) {
              const isRockChipper = target.shardVariant === 'rock-tile'
                  || target.shardVariant === 'rock-shard';
              if (isProgressiveFracture(target.shardVariant)) {
                  if (!this.progressFracture(target, impactWorldPos) && isRockChipper) {
                      this.releaseRockChip(target, impactWorldPos);
                  }
              } else if (isRockChipper) {
                  this.releaseRockChip(target, impactWorldPos);
              }
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
   * PROGRESSIVE FRACTURE (voronoi gauntlet, V8 — the user's correction
   * of V4).  The decomposition is applied ONCE at first damage and then
   * FIXED: each hit reveals more of the impact-sorted edge list — the
   * same reveal the crack overlay draws, via the shared
   * `fractureRevealedEdgeCount` — and a cell whose BINDING edges are all
   * revealed has a fully highlighted boundary and BREAKS OFF as that
   * piece: it detaches with the cell's own polygon, the parent keeps
   * the spliced remainder (`subtractBoundaryCell`), and the SURVIVING
   * cells of the same pattern stay cached so later pieces break off the
   * decomposition the player has been watching.  An edge stops binding
   * once its partner cell has departed (that seam is open air), so
   * interior pieces free up as their neighbours leave; a cell whose
   * boundary is complete but which cannot splice yet simply waits.
   * There is NO chip-chance roll — the highlight completing IS the
   * trigger — and no recompute between detaches.
   *
   * entity.size and position stay untouched (the dent contract: stable
   * footprint, `position === hexCoord` for tiles) so the static grid
   * never rebuilds; the tile cache re-stamps via the `_staticCached`
   * flip every damage event already does.  The remainder routes to FULL
   * death — the remaining cells breaking as the final pieces — when it
   * would fall below FRACTURE_DETACH.MIN_REMAINDER_FRAC of the original
   * area, or when only one cell is left (feedback item 26c: cumulative
   * chip-off area IS the break threshold); the hit ceiling ends it the
   * same way.
   *
   * Returns false only when the entity carries no decomposition at all
   * (degenerate polygon) — the caller falls back to the legacy dust
   * puff; true means the hit was handled, including the quiet ticks
   * where boundaries merely highlighted further.
   */
  private progressFracture(target: GameEntity, impactWorldPos?: Vector2): boolean {
      if (!this.currentMap) return true;
      if (!target.active || (target.health ?? 0) <= 0) return true;
      // Stamp the REAL contact point in entity-local coords BEFORE the
      // pattern is built (V12), so the site bias crowds toward where the
      // shot actually landed rather than toward a direction proxy, and
      // so the contact test below has something honest to measure.
      if (impactWorldPos !== undefined) {
          const dx = wrapDeltaX(target.position.x, impactWorldPos.x);
          const dy = wrapDeltaY(target.position.y, impactWorldPos.y);
          const cs = Math.cos(-target.rotation), sn = Math.sin(-target.rotation);
          target.lastImpactLocal = { x: dx * cs - dy * sn, y: dx * sn + dy * cs };
      }
      const cells = ensureFractureCells(target);
      if (cells === null || cells.length === 0) return false;
      const edges = ensureFractureEdges(target);
      // A single-cell pattern has no interior boundary to highlight —
      // the hit-ceiling model owns that break.
      if (edges === null || edges.length === 0) return true;
      const pts0 = target.polygonPoints;
      if (!pts0 || pts0.length < 3) return false;

      const original = target.fractureOriginalArea
          ?? (target.fractureOriginalArea = fracturePolygonArea(pts0));

      // Reveal pacing is PER MATERIAL and comes from the same lookup the
      // crack render reads (V10: glass is progressive too, and it paces
      // one step per Blaster hit rather than rock's one per HP).
      const cfg = crackConfigForVariant(target.shardVariant);
      if (cfg === undefined) return true;
      const revealed = fractureRevealedEdgeCount(target, edges.length, cfg.freq);
      if (revealed <= 0) return true;

      const living = new Set<number>();
      for (const c of cells) living.add(c.siteIndex);

      // WHICH PIECE DID THE SHOT TOUCH? (V12, user call: "shards that
      // chip off are only shards that are contacted by a projectile ...
      // to avoid shards chipping from internal to a cluster or shard".)
      // Distance is measured to each cell's OWN OUTLINE, not its
      // centroid: a projectile stops at the surface, so the contact point
      // sits just outside the hull, and a centroid comparison on a large
      // body would happily nominate a piece buried on the far side.  A
      // contact point inside a cell scores zero, so the struck piece wins
      // outright; once earlier chips have opened a bay, a shot into that
      // bay picks the newly exposed neighbour, and chipping eats inward
      // from where the player is actually shooting.
      const local = target.lastImpactLocal;
      // No usable contact point (a damage source that carries none) — the
      // pattern still highlights, nothing detaches, and the hit-ceiling
      // or min-remainder rules still end the body.
      if (local === undefined) return true;

      // Candidates in order of distance FROM THE CONTACT, and only those
      // within CONTACT_RADIUS_FRAC of the body's size.  The struck cell
      // scores 0 and leads; the radius exists because that cell can be
      // boundary-complete yet not spliceable off the current remainder
      // (subtractBoundaryCell needs one contiguous boundary run, which a
      // piece flanking an earlier bay may not have) — in that case the
      // search may walk to a neighbour ON THE SAME FACE, never across the
      // body.  A piece on the far side is more than one radius away by
      // construction, so it cannot be chipped by a hit it never received.
      const reach = Math.max(target.size.x, target.size.y)
          * FRACTURE_DETACH.CONTACT_RADIUS_FRAC;
      const reach2 = reach * reach;
      const near: Array<{ i: number; d: number }> = [];
      for (let i = 0; i < cells.length; i++) {
          const d = pointToPolygonDistance2(local.x, local.y, cells[i].points);
          if (d <= reach2) near.push({ i, d });
      }
      if (near.length === 0) return true;
      near.sort((a, b) => a.d - b.d);

      const pts = target.polygonPoints;
      if (!pts || pts.length < 3) return true;
      const polyArea = fracturePolygonArea(pts);

      let hitIdx = -1;
      let c: (typeof cells)[number] | undefined;
      let remainder: { x: number; y: number }[] | null = null;
      let remainderArea = 0;
      for (const cand of near) {
          const cc = cells[cand.i];
          // Its boundary must ALSO be fully highlighted — contact says
          // WHICH piece, the reveal says WHETHER it is loose yet.  Only
          // UNREVEALED edges can still bind (the edge array is the reveal
          // order), and an edge whose partner has departed binds nothing.
          let bound = false;
          for (let k = revealed; k < edges.length && !bound; k++) {
              const ed = edges[k];
              if (!ed.cells.includes(cc.siteIndex)) continue;
              let binds = ed.cells.length === 1;
              if (!binds) {
                  for (const site of ed.cells) {
                      if (site !== cc.siteIndex && living.has(site)) { binds = true; break; }
                  }
              }
              if (binds) bound = true;
          }
          if (bound) continue; // still attached — this hit only cracks it
          if (cells.length <= 1) { hitIdx = cand.i; c = cc; break; }
          const rem = subtractBoundaryCell(pts, cc.points);
          if (rem === null) continue; // not spliceable off this remainder
          hitIdx = cand.i; c = cc; remainder = rem;
          remainderArea = fracturePolygonArea(rem);
          break;
      }
      if (hitIdx < 0 || c === undefined) return true;

      if (cells.length <= 1
          || (remainder !== null
              && remainderArea < FRACTURE_DETACH.MIN_REMAINDER_FRAC * original)) {
          // The last pieces: the whole entity goes through the normal
          // death path, and the shatter consumes exactly the surviving
          // cells of this pattern.  killedByPlayer was already stamped by
          // the damage path.
          target.health = 0;
          target.active = false;
          if (target.mass === Infinity) this.physics.removeStaticEntity(target);
          this.handleEntityDeath(target);
          return true;
      }
      // Boundary-complete and contacted, but not spliceable from the
      // current remainder yet — it leaves once a neighbour frees its arc.
      if (remainder === null) return true;

      // Fragment first (it reads the pre-mutation parent), then splice.
      // refArea is the ORIGINAL polygon area so every piece of the
      // pattern comes out area-true to the shape it was cut from.
      this.shards.spawnDetachedCell(target, c, original, this.currentMap.entities);
      target.polygonPoints = remainder;
      if (target.mass !== Infinity && polyArea > 0) {
          target.mass *= remainderArea / polyArea;
      }
      // The PATTERN persists — surviving cells + edges stay so the rest
      // of the decomposition breaks off later; only the derived
      // collision/render caches die.
      cells.splice(hitIdx, 1);
      target._satCacheAxes = undefined;
      target._occluderR = undefined;
      if (target._staticCached === true) target._staticCached = false;
      invalidateCollisionR(target);
      this.audio.play('destroy.shard.rock', {
          x: target.position.x, y: target.position.y });
      return true;
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

  /** Put an expanding shockwave ring into the world.  Body lives in
   *  engine/explosions.ts with the rest of the AoE layer (gauntlet 5f); it
   *  keeps a method here because the 5b trait suite calls it straight off
   *  `window.__omniEngine`, which makes it observable surface (ledger P7). */
  spawnShockwave(pos: Vector2, opts: ShockwaveOpts) { emitShockwave(this, pos, opts); }

  /** The death path: flip an entity to EXPLODING and arm the wreck timer.
   *  Not the FX layer — the particles are spawned by the caller — and also
   *  observable surface (the 5b death/economy suites call it). */
  startExplosion(entity: GameEntity) {
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
      this.player.visualRoll = 0;
      this.player.visualPitch = 0;
      this._rollPrevFacing = null;
      this._rollYawRate = 0;
      this._rollVel = 0;
      this._pitchVel = 0;
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
      if (this.player.systemsDisabled) { this.audio.play('weapon.reject'); return; }

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
          this.handleRumble,
          this.playWeaponSfx,
      );
      // A trigger pull that produced nothing still makes a sound — the
      // dead click is the feedback that the weapon is on cooldown, EMP'd,
      // or missing.  Its own hard throttle keeps mashing bearable.
      if (!fired && (this.player.weaponCooldown ?? 0) <= 0) {
          this.audio.play('weapon.reject');
      }

      // Keep the HUD weapon index aligned with the player's current weapon in
      // case WeaponSystem auto-fell back to blaster on an empty mag.
      if (fired) {
          this.currentWeaponIndex = WEAPON_LIST.indexOf(this.player.currentWeapon || WeaponType.BLASTER);
      }
  }

  /** WeaponType → SFX_INVENTORY §4.1 id.  A plain table rather than a
   *  switch so adding a weapon is a row, matching how ENEMY_BEHAVIOR and
   *  SHARD_VARIANTS dispatch. */
  private static readonly WEAPON_SFX: Record<WeaponType, string> = {
      [WeaponType.BLASTER]:   'weapon.blaster.fire',
      [WeaponType.BURST]:     'weapon.burst.fire',
      [WeaponType.SHOTGUN]:   'weapon.shotgun.fire',
      [WeaponType.BOUNCER]:   'weapon.bouncer.fire',
      [WeaponType.LIGHTNING]: 'weapon.lightning.fire',
      [WeaponType.HOMING]:    'weapon.homing.fire',
      [WeaponType.CANNON]:    'weapon.cannon.fire',
  };

  /** Fired by WeaponSystem once per spawned player shot.  A charged shot
   *  LAYERS `weapon.charged.release` over the family voice so every weapon
   *  reads as the same supercharged gesture (SFX_INVENTORY §4.1). */
  private playWeaponSfx = (weapon: WeaponType, isCharged: boolean, subShot: number) => {
      const pos = this.player.position;
      if (subShot > 0) {
          // Rising triplet: a semitone (×2^(1/12)) per sub-shot.
          this.audio.play('weapon.burst.sub', {
              x: pos.x, y: pos.y, pitch: Math.pow(2, subShot / 12),
          });
          return;
      }
      const id = GameEngine.WEAPON_SFX[weapon];
      if (id) this.audio.play(id, { x: pos.x, y: pos.y });
      if (isCharged) this.audio.play('weapon.charged.release', { x: pos.x, y: pos.y });
  };

  // Thin wrappers that delegate to ProjectileSystem / TrailSystem.  Kept so
  // existing GameEngine call sites stay unchanged during the Phase 2 split.
  spawnProjectileFromConfig(shooter: GameEntity, target: Vector2, config: WeaponConfig, ownerType: EntityType) {
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
          this.entityIndex.shardCandidates,
          dt,
      );
  }

  private updateProjectileTrails(dt: number) {
      if (!this.currentMap) return;
      this.trails.updateProjectileTrails(this.currentMap.entities, dt);
  }

  // ─── Lightning chain (triggered on projectile impact) ───────────────────

  private fireLightningChainFromImpact(impactPos: Vector2, firstTarget: GameEntity, proj?: GameEntity) {
      // One trigger for the whole chain: every arc in a chain lands within
      // this id's retrigger window, so the collapse rule turns a five-link
      // chain into one bigger crackle instead of five thin ones.
      this.audio.play('impact.lightning.arc', { x: impactPos.x, y: impactPos.y });
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
      const asteroids = this.entityIndex.shardCandidates;
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
              // (h) regen: chain damage feeds the burst bucket like a pellet
              // does.  Note the chain deliberately BYPASSES the front-shield
              // plate — it never travels as a projectile, which is exactly why
              // Lightning is a §7 answer to a directional defence.
              noteTraitDamage(target, dmg);
              markDamaged(target, 0.15);
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
          // Per-entity spawner FIRST ((h) boss phases raise / drop escorts),
          // then the archetype's own config (the Nest).
          const spawner = nest.spawner
              ?? (nest.enemySubtype ? ENEMY_VARIANTS[nest.enemySubtype].spawner : undefined);
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


  // createAsteroidShards moved to ShardSystem.shatter in Stage 3 of
  // the shard-system overhaul.  See engine/systems/ShardSystem.ts.

  // --- WAVE SYSTEM ---

  /** Build the per-call spawn context that WaveSystem needs.  Kept as a
   *  tiny helper so every wave entry point (init / update tick / skip)
   *  goes through the same factory. */
  waveContext(): WaveSpawnContext | null {
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
      onBossSpawn: this.handleBossSpawn,
    };
  }

  // ─── (h) Bosses ────────────────────────────────────────────────────────
  //
  // A boss is an ordinary counted wave enemy with a BOSS_DEFS phase table.
  // Everything below is bookkeeping around that: stamp the phase whose
  // health-fraction gate the boss has fallen past, keep the live-boss handle
  // for the HUD, and pay the model-(d) bounty on death.

  /** Timed boss shop-discount readout — undefined when no window is running,
   *  so the shop UI can show the beat only while it is live. */
  /** Boss-wave entrance: the capstone warps in through the SHARED rift VFX —
   *  the same `openPortal` abstraction the dragon and the rivals use. */
  /** ── The FLASHLIGHT TOOL (user call) ────────────────────────────────
   *  Cycle the ship's light: off → medium → high → off.  Reachable only
   *  while the Flashlight Kit module is installed and active
   *  (`flashlightEquipped`, folded by applyModuleEffects); the trigger is
   *  the same SELECT-YOUR-SHIP gesture the dock/portal use, taken as the
   *  FALLBACK when neither of those is in range — the arbitration in
   *  updateInteractables stays nearest-wins, the light just claims the
   *  gesture nothing else wanted. */
  public cycleShipLight(): boolean {
      if (!this.flashlightEquipped) return false;
      this.flashlightLevel = (this.flashlightLevel + 1) % FLASHLIGHT_TOOL_LEVELS.length;
      const lvl = FLASHLIGHT_TOOL_LEVELS[this.flashlightLevel];
      this.pushPlayerMessage(lvl.label, lvl.tier === undefined ? '#94a3b8' : '#fde68a');
      this.audio.play('ui.confirm');
      return true;
  }

  private handleBossSpawn = (boss: GameEntity) => {
      this.liveBoss = boss;
      // THE LADDER STOPS HERE (user call).  One seam for both ways a boss
      // reaches the field — the capstone wave's own spawn and the debug
      // menu's warp-in — so neither can leave the ladder running underneath
      // the fight.  It does not resume when the boss dies; see
      // WaveSystem.haltForBoss.
      this.waves.haltForBoss();
      this.audio.play('boss.intro');
      this.openPortal(boss.position, {
          color: boss.color || '#f87171',
          radius: BOSS_CONSTANTS.PORTAL_RADIUS,
          duration: BOSS_CONSTANTS.PORTAL_DURATION,
      });
      this.handleScreenShake(COLLISION_CONFIG.SHAKE.MEDIUM);
  };

  /**
   * REGEN counterplay trait ((h), WEAPONS_AMMO_PLAN §7).  For each enemy
   * carrying it: expire the FIXED burst bucket, count down any active burn,
   * and otherwise heal `perSec` toward maxHealth.
   *
   * The bucket is filled by constants.noteTraitDamage() from every player
   * damage path (projectile, lightning chain, shockwave ring), so splash and
   * chain damage count toward a burst like pellets do.  Gated by the same DBG
   * "Traits" toggle as the damage-side traits.
   *
   * O(enemies) with an early field check — the same shape as the kamikaze /
   * nest passes, and it does nothing at all until an enemy has the trait.
   */
  private updateEnemyRegen(dt: number) {
      if (!this.currentMap || !this.physics.traitsEnabled) return;
      const enemies = this.entityIndex.enemies;
      for (let i = 0; i < enemies.length; i++) {
          const e = enemies[i];
          const cfg = e.regen;
          if (!cfg || !e.active || e.isExploding) continue;
          // Bucket expiry — FIXED window: it runs out on schedule, no matter
          // what landed inside (see the EnemyTraitSet comment).
          if ((e.regenBucketTimer ?? 0) > 0) {
              e.regenBucketTimer = (e.regenBucketTimer ?? 0) - dt;
              if (e.regenBucketTimer! <= 0) { e.regenBucketTimer = 0; e.regenBucket = 0; }
          }
          if ((e.regenBurnTimer ?? 0) > 0) {
              e.regenBurnTimer = Math.max(0, (e.regenBurnTimer ?? 0) - dt);
              continue; // burning — no healing
          }
          if (e.health < e.maxHealth) {
              e.health = Math.min(e.maxHealth, e.health + cfg.perSec * dt);
          }
      }
  }

  /** Arrival point beside the rift that leads back to `fromId`, or undefined
   *  when the freshly-loaded map has no such rift.  Offset clear of the mouth
   *  so the player emerges NEXT TO the rift (it stays visible, and the ship
   *  isn't sitting inside the thing it just came out of) while still being in
   *  USE_RANGE, so turning straight around is one tap. */
  /** The rift on THIS map that points back where the player just came from —
   *  the mouth they surface out of.  One definition, because three things now
   *  depend on agreeing about it: where the player lands, which way they are
   *  thrown, and where their debris re-emerges. */
  private exitMouthFor(fromId?: string): GameEntity | undefined {
      if (!fromId) return undefined;
      return this.portals.find(p => p.portalTargetId === fromId);
  }

  private arrivalBesideRift(fromId?: string): Vector2 | undefined {
      const mouth = this.exitMouthFor(fromId);
      if (!mouth) return undefined;
      const pos = {
          x: mouth.position.x + PORTAL_CONSTANTS.ARRIVAL_OFFSET,
          y: mouth.position.y,
      };
      wrapPosition(pos);
      return pos;
  }

  /** Drain the debris-transit queue: each captured entity emerges from the
   *  exit rift's mouth once its stagger delay expires — random heading,
   *  random speed, a pinch of positional scatter so a big load doesn't
   *  stack on one point, and a portal-gravity grace window
   *  (portalGraceTimer) so the well that just spat it out can't swallow it
   *  straight back.  Runs on sim time, so pause / dock hold the stream
   *  mid-flow; the reverse splice-walk is event-frequency work (a few
   *  dozen items once per transit), not a hot path. */
  private updatePortalTransit(dt: number) {
      if (this.portalTransit.length === 0 || !this.currentMap) return;
      const cfg = PORTAL_CONSTANTS.TRANSIT;
      for (let i = this.portalTransit.length - 1; i >= 0; i--) {
          const item = this.portalTransit[i];
          item.delay -= dt;
          if (item.delay > 0) continue;
          this.portalTransit.splice(i, 1);
          const e = item.entity;
          const scatterA = Math.random() * Math.PI * 2;
          const scatterR = Math.random() * cfg.SCATTER;
          e.position.x = this.portalTransitExit.x + Math.cos(scatterA) * scatterR;
          e.position.y = this.portalTransitExit.y + Math.sin(scatterA) * scatterR;
          wrapPosition(e.position);
          const heading = Math.random() * Math.PI * 2;
          const speed = cfg.SPEED_MIN + Math.random() * (cfg.SPEED_MAX - cfg.SPEED_MIN);
          e.velocity.x = Math.cos(heading) * speed;
          e.velocity.y = Math.sin(heading) * speed;
          if (e.rotationSpeed !== undefined) {
              e.rotationSpeed += (Math.random() - 0.5) * 1.5;
          }
          e.portalGraceTimer = cfg.GRACE_SEC;
          e.active = true;
          // A drop that spent its lifetime nearly out gets a top-up: a
          // pickup that travelled the wormhole with you should be
          // collectible on the other side, not fade on arrival.
          if (e.lifetime !== undefined && e.lifetime < 10) e.lifetime = 10;
          this.currentMap.entities.push(e);
          if (isCollectibleDrop(e)) this.activeDrops.push(e);
          // A small pop of rift-coloured sparks sells the spit without a
          // full openPortal burst per shard.
          this.spawnParticles(e.position, 3, PORTAL_CONSTANTS.COLOR, {
              speedMin: 0.5, speedMax: 2,
              sizeMin: 1, sizeMax: 2.5,
              lifetimeMin: 0.2, lifetimeMax: 0.5,
          });
      }
  }

  /** DBG: warp a boss in near the player, phases and all.  `id` is an
   *  EnemySubtype key with a BOSS_DEFS row; anything else takes the first entry
   *  of BOSS_ROTATION.  Each click stacks another (matches the Dragon menu). */
  public debugSpawnBoss(id: string) {
      const ctx = this.waveContext();
      if (!ctx) return;
      const subtype = (id in EnemySubtype && BOSS_DEFS[id as EnemySubtype])
          ? (id as EnemySubtype) : BOSS_ROTATION[0];
      const spread = 420 + Math.random() * 260;
      const a = Math.random() * Math.PI * 2;
      const pos = {
          x: this.player.position.x + Math.cos(a) * spread,
          y: this.player.position.y + Math.sin(a) * spread,
      };
      wrapPosition(pos);
      const boss = this.waves.spawnAt(subtype, pos, ctx, true);
      this.handleBossSpawn(boss);
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
  handleWaveCleared = (clearedIndex: number, elapsedSec: number, bySnitch: boolean = false) => {
    // Completion bonus: flat base + speed-graded bonus from the wave timer.
    // Par = the wave's spawn-stream window; clearing at/under par pays the
    // full speed bonus, decaying to 0 by 2× par.
    const waveNum = clearedIndex + 1;
    // Run summary (A1): clears accumulate across every arena the run visits
    // (wave progress itself is fresh per portal entry), so the summary reports
    // total clears alongside the best single-arena wave reached.
    this.runWavesCleared++;
    const par = Math.max(1, getWaveDurationSec(clearedIndex));
    const speedFrac = Math.max(0, Math.min(1, 1 - Math.max(0, elapsedSec - par) / par));
    const bonus = SCORE_CONSTANTS.WAVE_COMPLETE_BASE
        + Math.round(SCORE_CONSTANTS.EARLY_CLEAR_BONUS_PER_WAVE * waveNum * speedFrac);
    this.awardScore(bonus, this.player.position);

    // Wave-clear celebration — gold for a snitch catch, green for a
    // clear-the-field win.  The audio mirrors the same split.
    this.audio.play(bySnitch ? 'wave.clear.snitch' : 'wave.clear');
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

    // Wave-clear reward beat (pivot 1c): the upgrade cards are gone, so the
    // clear pays a salvage burst instead — physical drops beside the player
    // (they converge/merge like any salvage).  Sized in SALVAGE_CONSTANTS
    // against the per-wave income arithmetic; the early-clear SPEED bonus
    // above stays score-only.  This spray + the grace timer is the
    // between-wave breather now that the card modal no longer pauses the sim.
    for (let i = 0; i < SALVAGE_CONSTANTS.WAVE_CLEAR_DROPS; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 40 + Math.random() * 80;
      this.spawnSalvageDrop({
        x: this.player.position.x + Math.cos(a) * d,
        y: this.player.position.y + Math.sin(a) * d,
      });
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


  // ─── Dragon mini-boss (Stage 6) ────────────────────────────────────────
  //
  // Engine-managed segmented serpent.  The head is a normal ENEMY (so
  // projectiles damage it + handleEntityDeath routes a kill); this pass owns the
  // lifecycle (enter→roam→leave), the flow-weave steering, the body-path
  // history, and the tile-devour growth (via the shared consume pass).  One at a
  // time; DBG-summonable.  Toroidal.

  /**
   * Reusable rift-portal VFX (Stage 7 — abstracted from the dragon's single
   * ring).  A layered warp: a bright white core flash, the main coloured rift
   * ring, a wider trailing echo ring, a disc of inward-swirling embers, and a
   * scatter of hot white sparks — plus a light screen punch.  Shared by the
   * dragon and the rival ships; tune via the caller's PORTAL_* constants.
   */
  openPortal(pos: Vector2, opts: { color: string; radius: number; duration: number }) {
      // A rift tearing open, heard from OUTSIDE (SFX_INVENTORY §7.3) — the
      // roamer arrivals/departures and the boss entrance all route here.
      // The player's own transit fires openPortal twice around the map
      // swap; this id's retrigger window collapses both into the
      // portal.transit voice instead of stacking a third layer on it.
      this.audio.play('portal.open', { x: pos.x, y: pos.y });
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
      spawnDragon(this, (allowed.includes(type) ? type : 'mixed') as StructureVariant | 'mixed');
  }

  /** DBG: warp in a rival of the given disposition (or a weighted roll). */
  public debugSpawnRival(disposition: string = 'random') {
      const forced = (disposition === 'hostile' || disposition === 'ally' || disposition === 'neutral')
          ? disposition as RivalDisposition : undefined;
      spawnRival(this, forced);
  }

  // ─── Perf recorder (DBG FPS harness) ───────────────────────────────────
  // Start/stop a capture, cycle the scene label, and export a copy-paste
  // report.  Surfaced in the DBG panel's "Perf REC" section; see
  // engine/systems/PerfRecorder.ts.
  public perfRecToggle() {
    const starting = !this.perfRecorder.recording;
    this.perfRecorder.toggle();
    // Seed the event-diff markers to the CURRENT world state when a capture
    // opens.  Without this the first recorded frame reads every marker as
    // "changed" and the timeline opens with a cluster of phantom events at
    // 0.0s — which is exactly the false correlation the timeline exists to
    // prevent.  Seeded silently, so the timeline holds only real transitions.
    if (starting) {
      this._pmWave = this.waveIndex;
      this._pmState = this.waveState;
      this._pmBoss = !!(this.liveBoss && this.liveBoss.active && !this.liveBoss.isExploding);
      this._pmMap = this.currentMap?.name ?? '';
      this._pmDead = this.deathPending;
      this._pmStage = this.stageClearPending;
      this._pmDocked = this.dockedAtStation;
    }
  }
  public perfRecCycleScene() { this.perfRecorder.cycleScene(); }

  /** Build the copy-paste perf report from the current capture window.  The
   *  viewport / dpr / zoom are captured live so the block records the FOV the
   *  numbers were measured at (a wide desktop FOV draws more than a tablet). */
  public perfRecExport(): string {
    return this.perfRecorder.report({
      viewportW: typeof window !== 'undefined' ? window.innerWidth : 0,
      viewportH: typeof window !== 'undefined' ? window.innerHeight : 0,
      // The EFFECTIVE ratio — what the frame was actually rasterised at, and
      // therefore what the render numbers below correspond to.  The raw device
      // ratio is recoverable from the `set` line's rscale entry.
      dpr: Math.round(effectiveDpr() * 10) / 10,
      zoom: this.camera.zoom || 1,
      audioLatencyMs: this.audio.latencyMs,
      mapName: this.currentMap?.name || '—',
      difficulty: this.difficultyLevel,
      buildTag: '5c-perf',
      // Every DBG knob that can change what these numbers mean.  Without it
      // an A/B capture cannot be told apart from the run it is compared to.
      settings: `sim ${getActiveSimRateName()} · substep ${getActiveSubstepCapName()}`
        + ` · rscale ${getActiveRenderScaleName()} · hud ${getActiveHudRateName()}`
        + ` · auto ${this.perfController.autoEnabled ? 'on' : 'off'}`
        // The lighting vocabulary, so a pasted capture says which
        // configuration produced its light/fog columns without a follow-up
        // question.  Report-time values: change settings mid-capture and the
        // line describes the end state, not the whole window.
        + ` · light ${getActiveLightingMode()}/${getActiveLightingTier().name}`
        + ` · soft ${this.renderer.getShadowSoftness()}`
        + ` · beam ${this.renderer.getFlashlight()}`
        + ` · refr ${this.renderer.getRefraction() ? 'on' : 'off'}`
        + ` · emis ${this.renderer.getEmissive() ? 'on' : 'off'}`
        + ` · eshd ${this.renderer.getEmitShadows() ? this.renderer.getEmitShadowTier().name : 'off'}`
        + ` · fog ${this.renderer.getFog()}`,
    }, PERF_CONTROLLER_CONSTANTS.TIER_NAMES as unknown as string[]);
  }

  // Thin wrapper kept for internal call-site compatibility — delegates to WaveSystem.
  /** True when the active map runs wave gameplay.  Read straight off the
   *  map descriptor (roadmap step (k)) so the registry is the ONE source
   *  of truth: the OVERWORLD hub is the wave-free home map — WaveSystem
   *  is initialised disabled there, exactly like difficulty "None" — and
   *  every arena runs waves.  Unregistered maps default to enabled. */
  get wavesEnabled(): boolean {
    return descriptorForMapType(this.currentMap?.type)?.wavesEnabled ?? true;
  }

  private initWaveSystem() {
    const ctx = this.waveContext();
    if (!ctx) return;
    // Depth carries the difficulty curve and the boss rotation forward; the
    // arena's own wave counter still restarts at 1 for the HUD.
    this.waves.waveOffset = this.stageIndex * STAGE_WAVE_COUNT;
    this.waves.init(ctx, this.wavesEnabled);
  }


  // --- Drop / shard thin wrappers ────────────────────────────────────────
  //
  // Logic lives in DropSystem; these wrappers preserve the existing call
  // sites in updateGameLogic / handleEntityDeath / collection paths.

  private applyDropEffect(entity: GameEntity) {
    // Pickup audio (SFX_INVENTORY §7.1).  Salvage arrives in magnetised
    // CLUSTERS, so a fixed pitch reads as a machine-gun rattle; stepping
    // it up a semitone per pickup inside a short window turns a cluster
    // into a climbing scale instead.  The streak resets once collection
    // pauses.
    const pos = entity.position;
    if (entity.dropType === 'salvage') {
        const now = performance.now();
        this.salvageStreak = (now - this.salvageStreakAt < SALVAGE_STREAK_WINDOW_MS)
            ? Math.min(this.salvageStreak + 1, SALVAGE_STREAK_MAX) : 0;
        this.salvageStreakAt = now;
        this.audio.play('pickup.salvage', {
            x: pos.x, y: pos.y, pitch: Math.pow(2, this.salvageStreak / 12),
        });
    } else if (entity.dropType === 'health') {
        this.audio.play('pickup.health', { x: pos.x, y: pos.y });
    }
    this.drops.applyDropEffect(
      this.player,
      entity,
      (t, c) => this.pushPlayerMessage(t, c),
      (credits) => { this.earnCredits(credits); },
    );
  }

  private spawnDrops(entity: GameEntity) {
    if (!this.currentMap) return;
    this.drops.spawnDrops(
      this.currentMap.entities,
      this.activeDrops,
      this.player,
      entity,
      (t, c) => this.pushPlayerMessage(t, c),
      (credits) => { this.earnCredits(credits); },
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

  spawnSalvageDrop(pos: Vector2, parentVelocity?: Vector2) {
    if (!this.currentMap) return;
    this.drops.spawnSalvageDrop(this.currentMap.entities, this.activeDrops, pos, parentVelocity);
  }

  private spawnHealthDrop(pos: Vector2, value: number, parentVelocity?: Vector2) {
    if (!this.currentMap) return;
    this.drops.spawnHealthDrop(this.currentMap.entities, this.activeDrops, pos, value, parentVelocity);
  }

  private loadMap(map: BaseMapLayer) {
      // Push the new map's dimensions into the shared toroidal module
      // BEFORE the map initialises or any system rebuilds its static
      // state — initializeStaticGrid, initObstacles, buildShardFlowField
      // all read dimension-derived constants that must reflect the
      // active map.  Listeners registered by PhysicsSystem, FlowField,
      // and FlowFieldGrid update their caches synchronously here.
      setMapDimensions(map.width, map.height);
      if (!map.initialized) {
          map.init();
      }
      this.currentMap = map;
      // The fog's EXPLORED memory is world space, and world space means
      // something different here — a memory kept across a load would draw the
      // last map's explored shape onto this one.  The renderer owns no other
      // per-map persistent state, which is why this is the only such call.
      this.renderer.resetFog();
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
      this.flowField.buildShardFlowField(this.flowSamplerFor(map));
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
      // Invariant: every entity must OWN its polygon geometry.  Polygons
      // are mutated in place by the dent / crash paths, so a shared array
      // makes a whole cohort of tiles deform together (and their hitboxes
      // change in lockstep).  buildStructureTile guarantees this for tiles
      // built through it; this pass catches a hand-rolled map that bypasses
      // the factory.  One cheap walk per map load — see TileGenerator.
      assertPolygonsUnaliased(map.entities, map.name);
      // Fresh map — drop any queued nebula regens from the previous one.
      this.nebulas.reset();
      // Cache the station POIs (Overworld only; empty elsewhere) and the
      // map portals (the hub's rifts out, an arena's single rift home) so
      // the per-step interaction check iterates two tiny fixed lists.
      this.stations = map.entities.filter(e => e.isStation);
      this.portals = map.entities.filter(e => e.isPortal);
      this.dockedStation = null;
      this.dockedAtStation = false;
      this.dockInRange = false;
      this.nearestStation = null;
      this.nearestPortal = null;
  }

  private draw() {
      if (!this.currentMap) return;

      // The DOM's capstone bar occupies the top of the screen while a boss is
      // alive; the off-screen indicator rect reserves that band so an arrow
      // pointing straight up does not draw underneath it.  One boolean, set
      // where the frame is drawn rather than read out of the DOM.
      this.renderer.bossBarActive =
          !!(this.liveBoss && this.liveBoss.active && !this.liveBoss.isExploding);

      // Transit warp — hand the renderer a plain 0->1 progress, so the beat
      // stays a pure function of one number and the render side owns no
      // timer of its own.  Null when no transit is in flight.
      // CLAMPED to [0, 1).  The frame-delta guard above is the fix for the
      // negative case, but this is the one the RULE depends on: the beat's
      // progress is what decides whether the world is covered, and a value
      // outside the range would hand the renderer a frame it does not know
      // how to veil.  Cheap, and it makes "the destination cannot show" a
      // property of the number rather than of the clock behaving.
      this.renderer.portalWarp = this.portalWarpTimer > 0 && this.portalWarpDuration > 0
          ? Math.max(0, Math.min(0.999999, 1 - this.portalWarpTimer / this.portalWarpDuration))
          : null;

      // A7 — hand the renderer the run's depth.  One field write per frame;
      // the fog folds it into its dark level (deeper = darker).
      this.renderer.stageDepth = this.stageIndex;
      // The Light TOOL, when it is ON: the cone override gives it the BEAM
      // style, and the TIER override steps the whole light system to the
      // level's rung ('medium'/'high') — both over the DBG globals, which
      // stay the raw dev overrides underneath (tool off / no kit → null →
      // the globals decide; the flashlight global ships 'off', the tier
      // 'low').
      const lightOn = this.flashlightEquipped && this.flashlightLevel > 0;
      this.renderer.playerLightToolHalfDeg =
          lightOn ? FLASHLIGHT_TOOL_LEVELS[this.flashlightLevel].halfDeg : null;
      setLightingTierOverride(
          lightOn ? (FLASHLIGHT_TOOL_LEVELS[this.flashlightLevel].tier ?? null) : null);
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
          this.input.getJoystickState(),
          this.input.getFireButtonState(),
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
      this.perfLighting[this.perfRenderIdx]     = this.renderer.lastLightingMs;
      this.perfFog[this.perfRenderIdx]          = this.renderer.lastFogMs;
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
          // Raw per-frame, not ring-averaged — see the PerfSnapshot comment.
          uiActualMs:     this.lastUiActualMs,
          uiBaseMs:       this.lastUiBaseMs,
          uiCommits:      this.lastUiCommits,
          uiScheduleMs:   this.lastStatsScheduleMs,
          uiProfiled:     this.uiProfilerSeen,
          nebulaMs:       GameEngine.ringAvg(this.perfNebula,       this.perfRenderFilled),
          nebulaVisible:  this.renderer.lastNebulaVisible,
          nebulaFast:     this.renderer.lastNebulaFastCount,
          nebulaSlow:     this.renderer.lastNebulaSlowCount,
          tileLightingMs:    GameEngine.ringAvg(this.perfTileLighting, this.perfRenderFilled),
          tileLightingCount: this.renderer.lastTileLightingCount,
          lightingMs:        GameEngine.ringAvg(this.perfLighting,     this.perfRenderFilled),
          lightingLights:    this.renderer.lastLightingLights,
          fogMs:             GameEngine.ringAvg(this.perfFog,          this.perfRenderFilled),
          // Cell density peaks on single-frame spikes — report the window
          // max so the overlay surfaces transient clusters, not just the mean.
          maxCellDensity: GameEngine.ringPeak(this.perfDensity,     simN),
          totalEntities:     this.perfCounts.totalEntities,
          enemyCount:        this.perfCounts.enemyCount,
          mobileShardCount:     this.perfCounts.mobileShardCount,
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
