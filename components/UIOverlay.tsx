
import React, { useEffect, useRef, useState } from 'react';
import { EngineStats, MapType, GameState, TrailShape, TrailEmitMode, EnemySubtype, ControlScheme } from '../types';
import { CONTROL_SCHEMES, controlSchemeDef } from '../constants';

// Map menu is split into two labeled groups: the full-game "Maps" and the
// single-element "Test Maps" showcases (plus the multi-material Tile Heavy
// stress map).  Both the main menu and the pause screen render the same
// groups via renderMapGroup().
const REAL_MAPS: { type: MapType; label: string }[] = [
  // Wave-free home map: station POI (shop / loadout / repair) + ambient
  // roamers (bubbles, rivals, dragon).  No waves.
  { type: MapType.OVERWORLD,   label: 'Overworld' },
  { type: MapType.UNIVERSE,    label: 'Deep Space' },
  { type: MapType.RING,        label: 'Ring World' },
  { type: MapType.SEVEN_RINGS, label: 'Seven Rings' },
  { type: MapType.POCKET,      label: 'Pocket' },
];
// Enemy-test override — force every wave to spawn one subtype (or Off).
const ENEMY_TEST: { type: EnemySubtype | null; label: string }[] = [
  { type: null,                   label: 'Off' },
  { type: EnemySubtype.RAMMER_1,  label: 'Drone' },
  { type: EnemySubtype.RAMMER_2,  label: 'Charger' },
  { type: EnemySubtype.RAMMER_3,  label: 'Tank' },
  { type: EnemySubtype.SHOOTER_1, label: 'Skirmisher' },
  { type: EnemySubtype.SHOOTER_2, label: 'Orbiter' },
  { type: EnemySubtype.SHOOTER_3, label: 'Sniper' },
  { type: EnemySubtype.KAMIKAZE,  label: 'Kamikaze' },
  { type: EnemySubtype.BULWARK,   label: 'Bulwark' },
  { type: EnemySubtype.TURRET,    label: 'Turret' },
  { type: EnemySubtype.SWARM,     label: 'Swarm' },
  { type: EnemySubtype.NEST,      label: 'Nest' },
  // BUBBLE is ambient fauna (always present in normal play), not a forceable
  // wave enemy — so it's intentionally absent here.  Any force-selection below
  // suppresses the ambient bubbles for clean single-type isolation.
];
const TEST_MAPS: { type: MapType; label: string }[] = [
  { type: MapType.ASTEROID_FIELD,       label: 'Asteroid Field' },
  { type: MapType.GLASS_FIELD,          label: 'Glass Field' },
  { type: MapType.PLASTIC_FIELD,        label: 'Plastic Field' },
  { type: MapType.METAL_FIELD,          label: 'Metal Field' },
  { type: MapType.INDESTRUCTIBLE_FIELD, label: 'Indestructible' },
  { type: MapType.NEBULA_FIELD,         label: 'Nebula Field' },
  { type: MapType.ROCK_FIELD,           label: 'Rock Field' },
  { type: MapType.TILE_HEAVY,           label: 'Tile Heavy' },
];

interface UIOverlayProps {
  stats: EngineStats;
  onCycleWeapon?: () => void;
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRestart?: () => void;
  /** Death / run-summary screen (Phase 3 Pair A) — RESPAWN continues the run
   *  from the current map's spawn (unchanged death semantics), RESTART RUN
   *  wipes and replays the same map, MAIN MENU wipes and exits to the menu. */
  onRespawn?: () => void;
  onRestartRun?: () => void;
  onQuitToMenu?: () => void;
  /** Stage-clear screen: dismiss and resume the cleared arena.  There is no
   *  "descend" action here on purpose — the choice is made by flying to a
   *  rift, not by pressing a button. */
  onDismissStageClear?: () => void;
  onToggleDebug?: () => void;
  onCycleTrailShape?: () => void;
  onCycleTrailEmitMode?: () => void;
  onToggleLocalGravity?: () => void;
  onToggleAttractorGravity?: () => void;
  onToggleCollisions?: () => void;
  onToggleShardTileCollisions?: () => void;
  onToggleShardGravity?: () => void;
  onToggleShardBonding?: () => void;
  onToggleNebulaShardCollisions?: () => void;
  onTogglePlayerNebulaCollision?: () => void;
  onToggleShardSleep?: () => void;
  onToggleShardViewportCull?: () => void;
  onToggleShardLod?: () => void;
  onToggleMergeRate?: () => void;
  onToggleScreenShake?: () => void;
  // Audio settings (Phase 3 Pair B).  Deliberately the ONLY UI surface
  // this pass adds — Pair A owns the overlay's structural work.
  onSetVolume?: (v: number) => void;
  onToggleMute?: () => void;
  onToggleDrafts?: () => void;
  onToggleTileOutlines?: () => void;
  onToggleChevronMode?: () => void;
  onToggleDamageBars?: () => void;
  onToggleJoystickDebug?: () => void;
  onCycleMinimapMaterial?: () => void;
  onCycleLighting?: () => void;
  onCycleLightingTier?: () => void;
  onToggleShardShadows?: () => void;
  onToggleRefraction?: () => void;
  onCycleRefractBrightness?: () => void;
  onCycleLightBrightness?: () => void;
  onToggleEmissive?: () => void;
  onToggleWorldLights?: () => void;
  onToggleDepthAmbient?: () => void;
  onCycleEmitBrightness?: () => void;
  onToggleEmitShadows?: () => void;
  onCycleEmitShadowTier?: () => void;
  onCycleEmitFade?: () => void;
  onCycleCausticFade?: () => void;
  onCycleFlashlight?: () => void;
  onCycleLightColor?: () => void;
  onCycleTintMix?: () => void;
  onCycleFog?: () => void;
  onCycleShadowSoftness?: () => void;
  onCycleRockPalette?: () => void;
  onCycleFractureMode?: () => void;
  onCycleNebulaWakeSpin?: () => void;
  onToggleRumble?: () => void;
  onSetControlScheme?: (scheme: ControlScheme) => void;
  onToggleAdaptiveTriggers?: () => void;
  onCycleTriggerEncoding?: () => void;
  onTestTriggerLink?: () => void;
  onToggleRepelPush?: () => void;
  onToggleShardBlend?: () => void;
  onCycleShardCoat?: () => void;
  onTogglePlasticAutomata?: () => void;
  onTogglePlasticAutomataDirection?: () => void;
  onToggleMaterialAutomata?: () => void;
  onCyclePlasticPalette?: () => void;
  onCyclePlasticShardPalette?: () => void;
  onCyclePlasticGlowBrightness?: () => void;
  onCycleNebulaPalette?: () => void;
  onTogglePlasticBlend?: () => void;
  onCycleNebulaStretch?: () => void;
  onCycleShatterGrace?: () => void;
  onCyclePlayerThrust?: () => void;
  onCyclePlayerSpeed?: () => void;
  onCycleTileBlendAlpha?: () => void;
  onCycleShardBlendAlpha?: () => void;
  onCycleColorBlendInterval?: () => void;
  onCycleShardPairInterval?: () => void;
  onCycleShardTilePairInterval?: () => void;
  onToggleAsteroidFlow?: () => void;
  onToggleSnitchCatchMode?: () => void;
  onCycleSnitchSpeed?: () => void;
  onCyclePortalWarp?: () => void;
  onCyclePortalSize?: () => void;
  onCyclePortalGravity?: () => void;
  onCyclePortalGravityRange?: () => void;
  onCyclePortalLens?: () => void;
  onCyclePortalLensRadius?: () => void;
  onCyclePortalLensSpin?: () => void;
  onCyclePlayerRoll?: () => void;
  onCyclePlayerHull?: () => void;
  onCycleRollDamping?: () => void;
  onCycleTiltMode?: () => void;
  onCycleLeanDir?: () => void;
  onCycleTiltSource?: () => void;
  onCycleVelGain?: () => void;
  onCycleEnemyScale?: () => void;
  onCycleSimRate?: () => void;
  onCycleHudRate?: () => void;
  onCycleSubstepCap?: () => void;
  onCycleRenderScale?: () => void;
  renderScaleName?: string;
  onCycleSwarmMove?: () => void;
  onCycleStarDensity?: () => void;
  onCycleStarSize?: () => void;
  onCycleStarBands?: () => void;
  onCycleStarParallax?: () => void;
  onCycleCollapseMode?: () => void;
  onApplyCorrosion?: () => void;
  onApplyDisable?: () => void;
  onToggleTraits?: () => void;
  // DBG module grants (modules are discrete Mk-variety ITEMS now — no
  // levels): grant a variety into the inventory (auto-installs if a hex
  // is free), outfit a full canonical loadout, or reset to the lean start.
  onGrantModule?: (id: string) => void;
  onOutfitAll?: () => void;
  onResetOutfit?: () => void;
  onAddCredits?: () => void;
  onSpawnDragon?: (type: string) => void;
  onSpawnRival?: (disposition: string) => void;
  onSpawnBoss?: (id: string) => void;
  // Perf recorder (DBG FPS harness): toggle capture, cycle the scene label,
  // and export the copy-paste report string (returned so the overlay can
  // write it to the clipboard + show a manual-copy fallback).
  onPerfRecToggle?: () => void;
  onPerfRecCycleScene?: () => void;
  onPerfRecExport?: () => string;
  // Hex-slot outfitting — STATION-ONLY: the station UI is the sole caller;
  // the engine rejects installs/purchases while undocked.  purchase routes
  // leveled modules to the per-level cost curve, one-time to their price.
  onMoveModule?: (
    from: { area: 'inventory' | 'ship' | 'weapon'; idx: number },
    to: { area: 'inventory' | 'ship' | 'weapon'; idx: number },
  ) => void;
  onPurchaseModule?: (id: string) => void;
  // Module resale, INVENTORY tiles only: sell-back (90% of cost) needs a
  // station — any, every station drydocks; scrap (9%) works from anywhere
  // on the map (the pause-menu cargo panel's only cash-out).
  onSellModule?: (idx: number) => void;
  onScrapModule?: (idx: number) => void;
  // Station docking (Overworld): undock from the station UI, repair hull
  // (pay-per-HP, pro-rated).  There is no onDock — docking is the in-world
  // ship-select interaction, not a HUD button.
  onUndock?: () => void;
  onRepairHull?: () => void;
  // DBG: grant + equip a weapon (pause-menu debug Weapons rows) and
  // teleport the player to the station's doorstep (Overworld only).
  onGrantWeapon?: (id: string) => void;
  onTeleportStation?: () => void;
  onToggleFFOverlayVectors?: () => void;
  onToggleFFOverlayCells?: () => void;
  onToggleFFOverlayObstacles?: () => void;
  onToggleFFOverlayRebuilds?: () => void;
  onCycleFFOverlaySampleN?: () => void;
  onCycleFFDensity?: () => void;
  onCycleFFKernelR?: () => void;
  onCycleFFTangentMix?: () => void;
  onCycleFFBreathe?: () => void;
  onCycleFFLaneJitter?: () => void;
  onCycleFFPattern?: () => void;
  onTogglePerfAuto?: () => void;
  onSkipWave?: () => void;
  difficulty?: number;
  onSetDifficulty?: (level: number) => void;
  mapType?: MapType;
  onSetMapType?: (type: MapType) => void;
  onSetForcedEnemy?: (subtype: string | null) => void;
}

/**
 * Shared full-screen overlay scrim (user call: "all menus slightly
 * transparent to continue displaying the dynamic map").
 *
 * ONE constant for all five overlays — main menu, pause, station, death,
 * stage-clear — so the game never has two different ideas of how much world
 * shows through.  Two deliberate choices:
 *
 * - **The alpha is a legibility floor, not a taste knob.**  The map behind is
 *   a starfield with nebulae, salvage glints and explosions, i.e. arbitrary
 *   bright colour under arbitrary text.  55% slate-950 is what keeps
 *   `text-slate-500` body copy readable over the worst case (a lit nebula)
 *   while still reading clearly as "the world is still there".
 * - **The blur is SMALL on purpose.**  A heavy `backdrop-blur` is the usual
 *   way to buy legibility, but it defeats the point — the ask is to SEE the
 *   map move, and 12px of blur turns motion into a smear.  3px softens the
 *   high-frequency starfield (which is what actually fights small text)
 *   without hiding anything that moves.
 *
 * Note this does NOT track whether the sim is running: the pause menu freezes
 * the world and still shows it, which is exactly what was asked for.
 */
const OVERLAY_SCRIM = 'bg-slate-950/55 backdrop-blur-[3px]';

/**
 * Backing for content that must stay readable REGARDLESS of what is on the
 * map behind it — dense, small, information-bearing panels where the scrim's
 * legibility floor isn't enough.  Today that is the debug menu (rows of 10px
 * mono readouts, explicitly called out as needing to stay visible).  Nearly
 * opaque plus its own blur, so it reads like a panel sitting ON the scrim
 * rather than more transparency stacked on transparency.
 */
const PANEL_OPAQUE = 'bg-slate-950/95 backdrop-blur-md';

/** The overlay fade-in.  Death and stage-clear both interrupt live play, so
 *  both ease in rather than snapping over the frame the fight ended. */
const OVERLAY_FADE_IN = { animation: 'omniFadeIn 420ms ease-out both' } as const;
const OVERLAY_KEYFRAMES = '@keyframes omniFadeIn{from{opacity:0}to{opacity:1}}';

/* ── The shared class vocabulary (gauntlet 5d, U2) ──────────────────────
 *
 * `OVERLAY_SCRIM` and `PANEL_OPAQUE` above already set the pattern: when
 * more than one surface needs to look like the same thing, the class string
 * becomes a named constant so the surfaces cannot drift apart.  The 5d audit
 * (docs/GAUNTLET_5D_LOG.md, U1) counted what happens without that discipline
 * — three neutral-panel recipes meaning one thing, the primary action button
 * in three colours across five overlays, four treatments of one collapsible
 * toggle — so the rest of the vocabulary is named here.
 *
 * The rule for reading these: a constant is the DEFAULT, and a call site that
 * departs from it should say why in a comment.  There are three such
 * departures today and each is labelled at its call site.
 */

/** TYPE SCALE.  Five steps, and the names say what each is FOR rather than
 *  how big it is, because "10px vs 11px" is the question that produced the
 *  drift.  `MICRO` is the readability floor on glass — the audit found 7px
 *  badges, which is below anything legible on a phone held at arm's length. */
const T_MICRO = 'text-[9px]';   // badges, pips, slot numbers
const T_NOTE  = 'text-[10px]';  // secondary captions hanging off a value
const T_BODY  = 'text-[11px]';  // section headings, help rows, prose
const T_ROW   = 'text-xs';      // 12px — data rows, button labels

/** The neutral information PANEL.  Sixteen of the nineteen panels in the
 *  overlay already wanted exactly this; the other three said the same thing
 *  in slightly different slate. */
const PANEL = 'bg-slate-800/60 border border-slate-600/40 rounded-lg p-3';
/** Same panel, tighter — for a single-row strip rather than a stack. */
const PANEL_ROW = 'bg-slate-800/60 border border-slate-600/40 rounded-lg px-3 py-2';
/** An ACCENT panel keeps the neutral body and swaps only the border, so the
 *  accent reads as a label on a familiar shape rather than a different
 *  component.  Today: amber (commerce), rose (repair), sky (outfitting),
 *  emerald (reward). */
const panelAccent = (border: string) =>
  `bg-slate-800/60 border ${border} rounded-lg p-3`;

/** SECTION HEADING — the 11px uppercase rule the overlay already follows in
 *  every panel; named so the colour is the only thing a call site varies. */
const HEADING = `${T_BODY} font-bold uppercase tracking-widest`;

/** SCREEN TITLE (pause, station).  Steps down at phone width: the audit
 *  measured `text-3xl` + `tracking-[0.2em]` wrapping "PLAYER MENU" onto two
 *  lines at 390px, which is the viewport this game is designed for. */
const SCREEN_TITLE = 'text-2xl sm:text-3xl font-bold tracking-[0.15em] truncate min-w-0';
/** OUTCOME TITLE (death, stage-clear) — the two screens that interrupt play
 *  and get to shout.  Heavier than a screen title on purpose. */
const OUTCOME_TITLE = 'text-3xl sm:text-4xl font-black tracking-[0.2em]';

/** The TAP-TARGET FLOOR.  40px is what `screens.spec.ts` already asserts on
 *  the death screen; U1 found it held nowhere else (a 16.5px front-door
 *  toggle, 24.5px shop rows).  Applied as a min-height rather than by
 *  re-padding every control, so a dense row keeps its visual density and
 *  gains only its hit area. */
const TAP = 'min-h-[40px]';

/** PRIMARY ACTION — "carry on playing".  Station UNDOCK, pause CONTINUE,
 *  death RESPAWN and stage-clear CONTINUE all mean this, and emerald is what
 *  three of the four already were. */
const BTN_PRIMARY =
  `bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-lg shadow-lg ` +
  `transition-all active:scale-95 tracking-widest uppercase ${TAP}`;
/** SECONDARY ACTION — a real choice, but not the one the screen is steering
 *  you toward. */
const BTN_SECONDARY =
  `bg-slate-700/70 hover:bg-slate-600/70 text-slate-200 font-bold py-3 rounded-lg ` +
  `${T_ROW} tracking-widest uppercase transition-all active:scale-95 ${TAP}`;
/** A COMPACT action inside a panel (repair, sell, scrap, unmount). */
const BTN_COMPACT =
  `px-3 py-1.5 rounded ${T_BODY} font-bold transition-all active:scale-95 ${TAP} ` +
  `disabled:opacity-40 disabled:cursor-not-allowed`;
/** A SELECTABLE chip in a grid (difficulty, maps, enemy test, dragon…).
 *  `on` is the selected accent; `off` is the shared resting state, so an
 *  unselected chip looks the same everywhere and only the hover accent
 *  differs by group. */
const CHIP_BASE =
  `px-3 py-2 rounded-lg ${T_ROW} font-bold border transition-all active:scale-95 ${TAP}`;
const CHIP_OFF = 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white';

/** A HUD CHIP — the top-right readout stack.  One padding for the whole
 *  column; the audit found the status badges at `px-3 py-1` against
 *  `px-4 py-1.5` everywhere else, which is what made the stack's left edge
 *  ragged. */
/*  TRANSPARENCY (user call): a HUD chip sits ON the world, so the world reads
 *  through it.  The fill is the transparent half — the TEXT stays at full
 *  strength and keeps its drop shadow, so legibility comes from the marks
 *  rather than from hiding the map.  The blur is kept tiny for the same
 *  reason `OVERLAY_SCRIM`'s is: a heavy backdrop-blur buys legibility by
 *  smearing the motion the transparency exists to show. */
const HUD_CHIP =
  'bg-slate-900/35 border rounded-lg px-2.5 py-1 shadow-lg backdrop-blur-[2px] text-right ' +
  'drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]';

/** A COLLAPSIBLE SECTION toggle.  Colour is the semantic (amber = debug,
 *  sky = help, slate = neutral) and is passed in; everything else — size,
 *  padding, tap area, the ▸/▾ affordance — is shared. */
const SECTION_TOGGLE =
  `pointer-events-auto cursor-pointer ${T_BODY} uppercase tracking-widest ` +
  `select-none py-2 px-3 ${TAP} transition-colors`;

const UIOverlay: React.FC<UIOverlayProps> = ({
  stats,
  onCycleWeapon,
  onStart,
  onPause,
  onResume,
  onRestart,
  onRespawn,
  onRestartRun,
  onQuitToMenu,
  onDismissStageClear,
  onToggleDebug,
  onCycleTrailShape,
  onCycleTrailEmitMode,
  onToggleLocalGravity,
  onToggleAttractorGravity,
  onToggleCollisions,
  onToggleShardTileCollisions,
  onToggleShardGravity,
  onToggleShardBonding,
  onToggleNebulaShardCollisions,
  onTogglePlayerNebulaCollision,
  onToggleShardSleep,
  onToggleShardViewportCull,
  onToggleShardLod,
  onToggleMergeRate,
  onToggleScreenShake,
  onSetVolume,
  onToggleMute,
  onToggleDrafts,
  onToggleTileOutlines,
  onToggleChevronMode,
  onToggleDamageBars,
  onToggleJoystickDebug,
  onCycleMinimapMaterial,
  onCycleLighting,
  onCycleLightingTier,
  onToggleShardShadows,
  onToggleRefraction,
  onCycleRefractBrightness,
  onCycleLightBrightness,
  onToggleEmissive,
  onToggleWorldLights,
  onToggleDepthAmbient,
  onCycleEmitBrightness,
  onToggleEmitShadows,
  onCycleEmitShadowTier,
  onCycleEmitFade,
  onCycleCausticFade,
  onCycleFlashlight,
  onCycleLightColor,
  onCycleTintMix,
  onCycleFog,
  onCycleShadowSoftness,
  onCycleRockPalette,
  onCycleFractureMode,
  onCycleNebulaWakeSpin,
  onToggleRumble,
  onSetControlScheme,
  onToggleAdaptiveTriggers,
  onCycleTriggerEncoding,
  onTestTriggerLink,
  onToggleRepelPush,
  onToggleShardBlend,
  onCycleShardCoat,
  onTogglePlasticAutomata,
  onTogglePlasticAutomataDirection,
  onToggleMaterialAutomata,
  onCyclePlasticPalette,
  onCyclePlasticShardPalette,
  onCyclePlasticGlowBrightness,
  onCycleNebulaPalette,
  onTogglePlasticBlend,
  onCycleNebulaStretch,
  onCycleShatterGrace,
  onCyclePlayerThrust,
  onCyclePlayerSpeed,
  onCycleTileBlendAlpha,
  onCycleShardBlendAlpha,
  onCycleColorBlendInterval,
  onCycleShardPairInterval,
  onCycleShardTilePairInterval,
  onToggleAsteroidFlow,
  onToggleSnitchCatchMode,
  onCycleSnitchSpeed,
  onCyclePortalWarp,
  onCyclePortalSize,
  onCyclePortalGravity,
  onCyclePortalGravityRange,
  onCyclePortalLens,
  onCyclePortalLensRadius,
  onCyclePortalLensSpin,
  onCyclePlayerRoll,
  onCyclePlayerHull,
  onCycleRollDamping,
  onCycleTiltMode,
  onCycleLeanDir,
  onCycleTiltSource,
  onCycleVelGain,
  onCycleEnemyScale,
  onCycleSimRate,
  onCycleHudRate,
  onCycleSubstepCap,
  onCycleRenderScale,
  renderScaleName,
  onCycleSwarmMove,
  onCycleStarDensity,
  onCycleStarSize,
  onCycleStarBands,
  onCycleStarParallax,
  onCycleCollapseMode,
  onApplyCorrosion,
  onApplyDisable,
  onToggleTraits,
  onGrantModule,
  onOutfitAll,
  onResetOutfit,
  onAddCredits,
  onSpawnDragon,
  onSpawnRival,
  onSpawnBoss,
  onPerfRecToggle,
  onPerfRecCycleScene,
  onPerfRecExport,
  onMoveModule,
  onPurchaseModule,
  onSellModule,
  onScrapModule,
  onUndock,
  onRepairHull,
  onGrantWeapon,
  onTeleportStation,
  onToggleFFOverlayVectors,
  onToggleFFOverlayCells,
  onToggleFFOverlayObstacles,
  onToggleFFOverlayRebuilds,
  onCycleFFOverlaySampleN,
  onCycleFFDensity,
  onCycleFFKernelR,
  onCycleFFTangentMix,
  onCycleFFBreathe,
  onCycleFFLaneJitter,
  onCycleFFPattern,
  onTogglePerfAuto,
  onSkipWave,
  difficulty = 3,
  onSetDifficulty,
  mapType = MapType.OVERWORLD,
  onSetMapType,
  onSetForcedEnemy,
}) => {
  const isGrace = stats.waveStatus === 'cleared' && (stats.waveGraceTimer ?? 0) > 0;
  const perf = stats.perf;
  // DBG-panel section collapse state.  Each named section has its
  // own bool; default expanded.  Local-only (no persistence — page
  // refresh resets), which is fine for a dev panel.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => ({
    // 'stats' stays open by default; every other section starts collapsed.
    player: true, tilt: true, modules: true, weapons: true, visual: true, shardsphys: true, flowfield: true,
    perf: true, timing: true, dragon: true, rival: true, boss: true, perfrec: true,
    portal: true,
    // Map menus — controlled (not native <details>) so the dropdown state
    // survives the ~60 Hz stats-driven re-render of this overlay.  'fieldmaps'
    // is the Material Field Maps group (menu + pause); 'switchmap' is the
    // outer pause-only Switch Map / Test wrapper.  'debug' is the pause-menu
    // Debug Menu wrapper (the DBG panel's home since the station increment).
    // 'menudebug' is the MAIN MENU's debug dropdown — the map / enemy-test
    // buttons that used to sit on the front door.  Collapsed by default: the
    // menu is difficulty + START, and everything else is a debug override.
    // 'menuhelp' / 'pausehelp' are the Controls & Basics widget (Pair C, c1)
    // in the two menus that host it.  Two keys rather than one so opening it
    // to read the controls mid-run does not also unfold the front door.
    fieldmaps: true, switchmap: true, debug: true, menudebug: true,
    menuhelp: true, pausehelp: true,
  }));
  const toggleSection = (name: string) =>
    setCollapsed(prev => ({ ...prev, [name]: !prev[name] }));
  // Perf recorder: the last exported report text, shown in a manual-copy
  // textarea (a fallback so the block is always grabbable even if the async
  // Clipboard API is blocked — important on iOS Safari).  Cleared on dismiss.
  const [perfCopyText, setPerfCopyText] = useState<string>('');
  const [perfCopied, setPerfCopied] = useState<boolean>(false);
  const handlePerfCopy = () => {
    if (!onPerfRecExport) return;
    const text = onPerfRecExport();
    setPerfCopyText(text);
    setPerfCopied(false);
    // Best-effort async clipboard write (works on iOS Safari inside the tap);
    // the textarea below is the always-available fallback.
    try {
      navigator.clipboard?.writeText(text).then(() => setPerfCopied(true)).catch(() => {});
    } catch { /* fall through to the textarea */ }
  };
  // Read-only filter for the top 'Entities' readout: total / active
  // (awake) / asleep (dynamic-sleeping).  Display only — does not change
  // sleeping behaviour (that's the Shards & Physics ▸ Sleep toggle).
  const [entityCountMode, setEntityCountMode] = useState<'total' | 'active' | 'asleep'>('total');
  // Hex-slot outfitting: the currently selected tile (station UI + pause
  // cargo panel).  'inventory' selections drive the sell/scrap strip; the
  // detail strip below the flowers acts on this slot.
  const [selSlot, setSelSlot] = useState<{ g: 'ship' | 'weapon' | 'inventory'; i: number } | null>(null);
  /** Which station panel is showing (user call: the shop was at the bottom
   *  of one long scroll, so buying meant scrolling up to read the balance
   *  and back down to spend it).  The docked screen is THREE JOBS — buy,
   *  outfit, read the ship — and they are now tabs rather than a column, so
   *  no page is longer than a phone screen and the money lives in a header
   *  that never scrolls away.
   *
   *  Not normalised in an effect: the render picks the first AVAILABLE tab
   *  when this one is not offered here (the home drydock sells nothing), so
   *  a station's services decide what exists and this only remembers a
   *  preference. */
  const [stationTab, setStationTab] = useState<'shop' | 'outfit' | 'ship'>('shop');
  // Which Ship Status stat row is expanded to its per-module contributors
  // (A2).  Controlled so it survives the 60 Hz overlay re-render, same as the
  // pause-menu section collapse state.
  const [openStat, setOpenStat] = useState<string | null>(null);
  // Drag-and-drop outfitting (drydock only): pointer-based so touch and
  // mouse both work.  A press that never travels >8px falls through to
  // the normal click (hex selection); a real drag suppresses the click
  // and drops onto the [data-tile] under the pointer.
  const [dragging, setDragging] = useState<{
    area: 'inventory' | 'ship' | 'weapon'; idx: number; label: string;
    sx: number; sy: number; x: number; y: number; moved: boolean;
  } | null>(null);
  const dragRef = useRef(dragging);
  dragRef.current = dragging;
  const suppressClickRef = useRef(false);
  const onMoveModuleRef = useRef(onMoveModule);
  onMoveModuleRef.current = onMoveModule;
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => setDragging(d => {
      if (!d) return d;
      const moved = d.moved || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 8;
      return { ...d, x: e.clientX, y: e.clientY, moved };
    });
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      setDragging(null);
      if (!d || !d.moved) return;
      // A real drag happened — swallow the click that follows pointerup.
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 0);
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest?.('[data-tile]') as HTMLElement | null;
      const tile = el?.getAttribute('data-tile');
      if (!tile) return;
      const [area, idxStr] = tile.split(':');
      const idx = parseInt(idxStr, 10);
      if (!area || Number.isNaN(idx)) return;
      if (area === d.area && idx === d.idx) return;
      onMoveModuleRef.current?.(
        { area: d.area, idx: d.idx },
        { area: area as 'inventory' | 'ship' | 'weapon', idx },
      );
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging !== null]);

  // ── Shared hex-outfitting widgets ─────────────────────────────────────
  // Used by BOTH the docked station UI and the pause-menu cargo panel.
  // Flat-top hexes in a 7-tile flower (center + one at each side); borders
  // can't follow a clip-path, so each tile is an accent-coloured outer hex
  // with an inset inner face.
  const out = stats.outfitting;
  const dockedSvc = stats.dock?.docked ? stats.dock.services : undefined;
  // Installed hexes are drydock-only; the inventory is the player's cargo
  // hold — reorderable (and scrappable) from anywhere on the map.
  const canEditInstalled = dockedSvc?.drydock === true;
  /* HEX SIZING IS RESPONSIVE (5d, U2 — audit finding A2).
   *
   * The flowers used to be a fixed 200px-wide box in a `grid-cols-2` column
   * that is ~163px at 390px and ~128px at 320px, so the two flowers OVERLAPPED
   * by 20px on the design viewport and left the screen on both sides at 320.
   * That is not only cosmetic: the hexes are pointer drop targets resolved
   * through `document.elementFromPoint`, which returns the TOPMOST
   * `[data-tile]` — so an overlapping band could take a drop meant for its
   * neighbour.
   *
   * So the hex size is derived from the width actually available rather than
   * assumed.  The arithmetic mirrors the layout exactly: the panel sits in a
   * `max-w-2xl` (672) column with the overlay's `p-4` and the panel's own
   * `p-3`, and the two flowers split what is left with a `gap-2` between
   * them.  Capped at the original 76px so nothing about the tablet and
   * desktop cases changes, floored so a very narrow window degrades rather
   * than inverts.
   *
   * `vw` is state, not a per-frame read: it changes on RESIZE, which is a
   * user action a few times a session, not game data.  (The EngineStats-only
   * rule is about per-frame sim data — see CLAUDE.md §8.) */
  const [vw, setVw] = useState<number>(() =>
    typeof window === 'undefined' ? 390 : window.innerWidth);
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    onResize();
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  // Content width inside the overlay padding + the panel padding, capped by
  // the `max-w-2xl` wrapper the station and pause panels both use.
  const panelContentW = Math.min(vw, 672) - 32 /* overlay p-4 */ - 24 /* panel p-3 */;
  // Two flowers, `gap-2` between them; a flower's box is HEXW * 2.5 + 10.
  const HEXW = Math.max(40, Math.min(76, ((panelContentW - 8) / 2 - 10) / 2.5));
  const HEXH = HEXW * (66 / 76); // flat-top hex: H ≈ 0.868 W (the shipped ratio)
  // The inventory honeycomb is one row of INV_COLS across the same content
  // width: cw = 0.75 * INVW * (COLS - 1) + INVW = INVW * 4.75 at six columns.
  const INV_COLS = 6;
  const INVW = Math.max(36, Math.min(66, panelContentW / (0.75 * (INV_COLS - 1) + 1)));
  const INVH = INVW * (57 / 66);
  const HEX_CLIP = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
  const HEX_OFF = [
    { x: 0, y: 0 },
    { x: 0, y: -1 }, { x: 0.75, y: -0.5 },
    { x: 0.75, y: 0.5 }, { x: 0, y: 1 },
    { x: -0.75, y: 0.5 }, { x: -0.75, y: -0.5 },
  ];
  // Placement is slot-agnostic within a group; the gun LIMIT is a count
  // (Guns N/maxGuns), not a slot type.  Mounted guns get a dynamic W1/W2
  // badge in slot order.
  const kindFits = (g: 'ship' | 'weapon', kind: string) =>
    g === 'ship' ? (kind === 'ship' || kind === 'ship-part') : (kind === 'weapon' || kind === 'weapon-mod');
  const gunCount = out?.gunsMounted ?? 0;
  const maxGuns = out?.maxGuns ?? 2;
  const gunOrder = new Map<number, number>();
  (out?.weapon ?? []).forEach((m, i) => { if (m?.kind === 'weapon') gunOrder.set(i, gunOrder.size); });
  const selHexMod = selSlot && out && selSlot.g !== 'inventory'
    ? (selSlot.g === 'ship' ? out.ship : out.weapon)[selSlot.i] : null;
  const selInvMod = selSlot && out && selSlot.g === 'inventory'
    ? out.inventory[selSlot.i] : null;
  const firstFreeInv = (out?.inventory ?? []).findIndex(t => t === null);
  // Inventory items (with their tile index) that fit the selected empty
  // hex; guns at the mounted limit stay listed but disabled.
  const candidates = selSlot && out && selSlot.g !== 'inventory'
    ? out.inventory
        .map((m, idx) => ({ m, idx }))
        .filter(e => e.m !== null && e.m.group === selSlot.g && kindFits(selSlot.g as 'ship' | 'weapon', e.m.kind))
    : [];
  const beginDrag = (area: 'inventory' | 'ship' | 'weapon', idx: number, label: string) =>
    (e: React.PointerEvent) => {
      // No preventDefault — the compatibility click must still fire so a
      // drag-less press falls through to tap-selection.  touch-action:
      // none on the tiles handles scroll capture on touch instead.
      // Cargo (inventory) tiles drag anywhere; installed hexes only at a
      // docked drydock.
      if (area !== 'inventory' && !canEditInstalled) return;
      setDragging({ area, idx, label, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false });
    };
  /** One 7-hex flower.  `interactive: false` (pause menu) renders a
   *  read-only display: still tap-selectable for info, but no drag
   *  source and no [data-tile] drop target. */
  const renderHexGroup = (g: 'ship' | 'weapon', title: string, accentText: string, accentBg: string, interactive: boolean) => {
    const slots = g === 'ship' ? (out?.ship ?? []) : (out?.weapon ?? []);
    const cw = HEXW * 2.5 + 10, ch = HEXH * 3 + 10;
    return (
      <div className="flex flex-col items-center gap-1.5">
        {/* Title and the gun-count chip STACK rather than sharing a line
            (5d U2, audit finding B3): inline, the chip wrapped the weapon
            heading onto a second line at 390px, which pushed the weapon
            flower down out of alignment with the ship flower.  The fixed
            min-height keeps both headings the same height whether or not
            they carry a chip. */}
        <h3 className={`flex flex-col items-center justify-start gap-1 min-h-[38px] text-center ${HEADING} ${accentText}`}>
          <span>{title}</span>
          {g === 'weapon' && (
            <span
              className={`px-1.5 py-0.5 rounded ${T_MICRO} tabular-nums ${gunCount >= maxGuns ? 'bg-amber-600/40 text-amber-200' : 'bg-slate-700/70 text-slate-300'}`}
              title={`Mounted guns — limited to ${maxGuns} at a time (any hex; more slots is a future ship upgrade). Weaponless is allowed: guns weigh the ship down, flying light boosts acceleration.`}
            >
              Guns {gunCount}/{maxGuns}
            </span>
          )}
        </h3>
        <div className="relative" style={{ width: cw, height: ch }}>
          {slots.map((m, i) => {
            const off = HEX_OFF[i] ?? HEX_OFF[0];
            const isGun = m?.kind === 'weapon';
            const sel = selSlot?.g === g && selSlot.i === i;
            const offline = m !== null && !m.active;
            const lifted = dragging?.moved === true && dragging.area === g && dragging.idx === i;
            return (
              <button
                key={i}
                /* `data-tile` is the DRAG drop-target hook, so it only
                   exists on interactive flowers; `data-hex` is a stable
                   identity for every hex (read-only flowers included). */
                data-hex={`${g}:${i}`}
                data-tile={interactive ? `${g}:${i}` : undefined}
                onPointerDown={interactive && m !== null ? beginDrag(g, i, m.label) : undefined}
                onClick={() => { if (suppressClickRef.current) return; setSelSlot(sel ? null : { g, i }); }}
                className="absolute transition-transform active:scale-95"
                style={{
                  width: HEXW, height: HEXH, touchAction: 'none',
                  opacity: lifted ? 0.35 : undefined,
                  left: cw / 2 + off.x * HEXW - HEXW / 2,
                  top: ch / 2 + off.y * HEXH - HEXH / 2,
                  clipPath: HEX_CLIP,
                  background: sel ? '#f8fafc'
                    : offline ? '#9f1239'
                    : m ? (isGun ? '#f59e0b' : accentBg) : '#475569',
                }}
                title={m
                  ? (m.active ? m.label : `${m.label} — OFFLINE: must touch ${m.requires ?? 'its requirement'}`)
                  : `Empty ${g} slot`}
              >
                <span
                  className="absolute flex flex-col items-center justify-center text-center"
                  style={{ inset: 2.5, clipPath: HEX_CLIP, background: m ? '#0f172a' : '#1e293b' }}
                >
                  {/* 9px is the readability floor on glass; these two were
                      7px before 5d U2 (audit finding C4). */}
                  {isGun && <span className={`${T_MICRO} font-bold text-amber-400/90 tracking-widest leading-none mb-0.5`}>W{(gunOrder.get(i) ?? 0) + 1}</span>}
                  {m ? (
                    <>
                      <span className={`${T_MICRO} font-bold uppercase tracking-tight leading-tight px-1 ${offline ? 'text-rose-400' : 'text-slate-100'}`}>{m.label}</span>
                      {offline && <span className={`${T_MICRO} text-rose-400/90 font-bold leading-none mt-0.5`}>OFFLINE</span>}
                    </>
                  ) : (
                    <span className="text-slate-500 text-base font-bold leading-none">+</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };
  /** The cargo-hold honeycomb.  Tiles are drag-reorderable and
   *  tap-selectable (sell/scrap strip) EVERYWHERE; `installable` only
   *  changes the hint text (station = drag onto a hex to install). */
  const renderInventoryHex = (installable: boolean) => {
    const cw = 0.75 * INVW * (INV_COLS - 1) + INVW;
    const rows = Math.ceil((out?.inventory ?? []).length / INV_COLS);
    const ch = INVH * rows + INVH / 2 + 4;
    return (
      <div className="flex flex-col items-center gap-1.5">
        <h3 className={`text-amber-300 ${HEADING}`}>Inventory</h3>
        <div className="relative" style={{ width: cw, height: ch }}>
          {(out?.inventory ?? []).map((m, i) => {
            const col = i % INV_COLS, row = Math.floor(i / INV_COLS);
            const sel = selSlot?.g === 'inventory' && selSlot.i === i;
            const lifted = dragging?.moved === true && dragging.area === 'inventory' && dragging.idx === i;
            return (
              <button
                key={i}
                data-hex={`inventory:${i}`}
                data-tile={`inventory:${i}`}
                onPointerDown={m !== null ? beginDrag('inventory', i, m.label) : undefined}
                onClick={() => { if (suppressClickRef.current) return; setSelSlot(sel ? null : { g: 'inventory', i }); }}
                className="absolute transition-transform active:scale-95"
                style={{
                  width: INVW, height: INVH, touchAction: 'none',
                  opacity: lifted ? 0.35 : undefined,
                  left: col * 0.75 * INVW,
                  top: row * INVH + (col % 2 === 1 ? INVH / 2 : 0),
                  clipPath: HEX_CLIP,
                  background: sel ? '#f8fafc' : m !== null ? '#b45309' : '#334155',
                }}
                title={m
                  ? (installable ? `${m.label} — drag onto a hex slot to install` : `${m.label} — tap for sell / scrap, drag to rearrange`)
                  : 'Empty inventory tile'}
              >
                <span
                  className="absolute flex items-center justify-center text-center"
                  style={{ inset: 2, clipPath: HEX_CLIP, background: m ? '#0f172a' : '#1e293b' }}
                >
                  {m ? (
                    <span className={`${T_MICRO} font-bold uppercase tracking-tight leading-tight px-1 text-slate-100`}>{m.label}</span>
                  ) : (
                    <span className={`text-slate-600 ${T_ROW} font-bold leading-none`}>·</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };
  /** Ship Status — the full derived-stat set with per-module attribution
   *  (Phase 3 Pair A).  Shared verbatim by the pause menu and the docked
   *  station, like the hex widgets around it.
   *
   *  Every number is `EngineStats.outfitting.statLines`, which the engine
   *  builds from the same slot walk `applyModuleEffects` folds — nothing is
   *  recomputed here.  Tapping a row expands its contributors; tapping a hex
   *  in the flowers highlights every stat that hex feeds (the shared
   *  `selSlot` state), and OFFLINE modules are listed with their contribution
   *  struck through plus the contact they are missing. */
  const renderShipStatus = () => {
    const lines = out?.statLines ?? [];
    if (lines.length === 0) return null;
    const selHex = selSlot && selSlot.g !== 'inventory'
      ? { area: selSlot.g as 'ship' | 'weapon', idx: selSlot.i } : null;
    const feeds = (c: { area?: string; idx?: number }) =>
      selHex !== null && c.area === selHex.area && c.idx === selHex.idx;
    return (
      <div className={PANEL}>
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h3 className={`text-sky-300 ${HEADING}`}>Ship Status</h3>
          <span className={`text-slate-500 ${T_NOTE} text-right`}>
            {selHex ? 'highlighted: fed by the selected hex' : 'tap a stat for its modules'}
          </span>
        </div>
        <div className="flex flex-col">
          {lines.map(l => {
            const open = openStat === l.id;
            const lit = selHex !== null && l.contributors.some(feeds);
            const counted = l.contributors.filter(c => c.active).length;
            return (
              <div
                key={l.id}
                className={`rounded transition-colors ${lit ? 'bg-amber-500/10 ring-1 ring-amber-400/40' : ''}`}
              >
                <button
                  data-testid={`stat-${l.id}`}
                  onClick={() => setOpenStat(open ? null : l.id)}
                  className={`w-full flex items-center justify-between gap-2 px-1.5 py-1.5 text-left hover:bg-slate-700/30 rounded transition-colors ${TAP}`}
                >
                  <span className={`text-slate-400 ${T_ROW} flex items-baseline gap-1.5`}>
                    {l.label}
                    <span className={`text-slate-600 ${T_MICRO}`}>{open ? '▾' : '▸'}</span>
                  </span>
                  <span className="flex items-baseline gap-1.5">
                    {counted > 0 && (
                      <span className={`${T_MICRO} font-bold tabular-nums ${lit ? 'text-amber-300' : 'text-slate-600'}`}>
                        {counted} mod{counted > 1 ? 's' : ''}
                      </span>
                    )}
                    <span className={`text-white font-bold tabular-nums ${T_ROW}`}>{l.display}</span>
                  </span>
                </button>
                {open && (
                  <div
                    data-testid={`stat-detail-${l.id}`}
                    className={`px-1.5 pb-2 pt-0.5 flex flex-col gap-0.5 ${T_BODY}`}
                  >
                    <div className="flex justify-between gap-2 text-slate-500">
                      <span>Base</span>
                      <span className="tabular-nums">{l.baseDisplay}</span>
                    </div>
                    {l.contributors.map((c, i) => (
                      <div
                        key={i}
                        className={`flex justify-between gap-2 ${feeds(c) ? 'text-amber-200' : c.active ? 'text-slate-300' : 'text-slate-600'}`}
                      >
                        <span className="truncate">
                          {c.label}
                          {!c.active && c.requires && (
                            <span className={`text-rose-400/80 ml-1.5 ${T_MICRO} uppercase tracking-wide`}>
                              offline · needs {c.requires}
                            </span>
                          )}
                        </span>
                        <span className={`tabular-nums shrink-0 ${c.active ? '' : 'line-through'}`}>{c.display}</span>
                      </div>
                    ))}
                    {l.contributors.length === 0 && (
                      <span className="text-slate-600">No modules feed this stat.</span>
                    )}
                    {l.note && <span className={`text-slate-500 ${T_NOTE} mt-0.5`}>{l.note}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  /** Detail strip under the tiles: hex info / install picker (station) or
   *  read-only info (pause) for hex selections; SELL / SCRAP actions for
   *  inventory selections (sell needs a station, scrap works anywhere). */
  const renderModuleDetail = (ctx: 'station' | 'pause') => (
    <div className={`${PANEL_ROW} min-h-[52px] flex items-center justify-between gap-3 flex-wrap`}>
      {!selSlot ? (
        <span className={`text-slate-500 ${T_BODY}`}>
          {ctx === 'station'
            ? (canEditInstalled ? 'Drag modules between tiles, or tap a hex slot to inspect / install.' : 'Tap a hex slot to inspect the outfit.')
            : 'Tap a tile to inspect. Cargo can be rearranged or scrapped here; outfitting needs a station drydock.'}
        </span>
      ) : selSlot.g === 'inventory' ? (
        selInvMod ? (
          <>
            <div className={T_ROW}>
              <span className="text-white font-bold uppercase tracking-wide">{selInvMod.label}</span>
              <span className={`text-slate-500 ml-2 ${T_NOTE} uppercase`}>{selInvMod.kind.replace('-', ' ')}</span>
            </div>
            <div className="flex gap-1.5">
              <button
                disabled={!stats.dock?.docked || selInvMod.sellValue <= 0}
                onClick={() => onSellModule?.(selSlot.i)}
                title={!stats.dock?.docked
                  ? 'Sell-back needs a station — dock anywhere to sell for 90% of cost'
                  : selInvMod.sellValue <= 0 ? 'Worthless — scrap it instead' : 'Sell back for 90% of cost'}
                className={`${BTN_COMPACT} bg-emerald-800/60 hover:bg-emerald-700/70 text-emerald-200`}
              >
                Sell ◈{selInvMod.sellValue.toLocaleString()}
              </button>
              <button
                onClick={() => onScrapModule?.(selSlot.i)}
                title="Break up for scrap — 9% of cost, works anywhere"
                className={`${BTN_COMPACT} bg-slate-800/70 hover:bg-red-900/50 text-slate-400 hover:text-red-200`}
              >
                Scrap ◈{selInvMod.scrapValue.toLocaleString()}
              </button>
            </div>
          </>
        ) : (
          <span className={`text-slate-500 ${T_BODY}`}>Empty inventory tile — purchases land here.</span>
        )
      ) : selHexMod ? (
        <>
          <div className={T_ROW}>
            <span className="text-white font-bold uppercase tracking-wide">{selHexMod.label}</span>
            <span className={`text-slate-500 ml-2 ${T_NOTE} uppercase`}>{selHexMod.kind.replace('-', ' ')}</span>
            {selHexMod.active
              ? <span className={`text-emerald-300 ml-2 font-bold ${T_NOTE} uppercase`}>Online</span>
              : <span className={`text-rose-400 ml-2 font-bold ${T_NOTE} uppercase`}>Offline — must touch {selHexMod.requires}</span>}
            {/* Exact effect (A2): every stat this hex feeds, with the amount
                it contributes.  An OFFLINE module lists the same stats with
                a zero contribution, so "what am I losing" reads directly. */}
            {(() => {
              const eff = (out?.statLines ?? []).flatMap(l =>
                l.contributors
                  .filter(c => c.area === selSlot.g && c.idx === selSlot.i)
                  .map(c => ({ stat: l.label, display: c.display, active: c.active })));
              if (eff.length === 0) {
                return <div className={`text-slate-500 ${T_NOTE} mt-0.5`}>Contributes no ship stats.</div>;
              }
              return (
                <div data-testid="detail-effects" className={`${T_NOTE} mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5`}>
                  {eff.map((e, i) => (
                    <span key={i} className={e.active ? 'text-amber-200' : 'text-slate-600'}>
                      {e.stat} <span className={`tabular-nums font-bold ${e.active ? '' : 'line-through'}`}>{e.display}</span>
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>
          {ctx === 'station' && canEditInstalled && (
            <button
              disabled={firstFreeInv === -1}
              onClick={() => { onMoveModule?.({ area: selSlot.g as 'ship' | 'weapon', idx: selSlot.i }, { area: 'inventory', idx: firstFreeInv }); }}
              title={firstFreeInv === -1 ? 'Inventory full'
                : selHexMod.kind === 'weapon' ? 'Unmount (weaponless flight is allowed — flying light boosts acceleration)'
                : 'Move to inventory'}
              className={`${BTN_COMPACT} bg-slate-800/70 hover:bg-red-900/50 text-slate-400 hover:text-red-200`}
            >
              ✕ To inventory
            </button>
          )}
          {ctx === 'pause' && (
            <span className={`text-slate-500 ${T_NOTE}`}>Installed — reconfigure at a station drydock.</span>
          )}
        </>
      ) : (
        <>
          <span className={`text-slate-400 ${T_BODY} font-bold uppercase tracking-wider shrink-0`}>
            Install · {selSlot.g} module
          </span>
          <div className="flex gap-1.5 flex-wrap">
            {ctx === 'pause' || !canEditInstalled ? (
              <span className={`text-slate-500 ${T_BODY}`}>
                {ctx === 'pause' ? 'Empty slot — outfit at a station drydock.' : 'Outfitting locked — no drydock at this station.'}
              </span>
            ) : candidates.length === 0 ? (
              <span className={`text-slate-500 ${T_BODY}`}>No matching modules in the inventory — buy some at a shop station.</span>
            ) : candidates.map(c => {
              const gunBlocked = c.m!.kind === 'weapon' && gunCount >= maxGuns;
              return (
                <button
                  key={c.idx}
                  disabled={gunBlocked}
                  onClick={() => onMoveModule?.({ area: 'inventory', idx: c.idx }, { area: selSlot.g as 'ship' | 'weapon', idx: selSlot.i })}
                  title={gunBlocked ? `Gun limit reached (${gunCount}/${maxGuns}) — unmount a gun first` : undefined}
                  className={`${BTN_COMPACT} uppercase tracking-wide bg-sky-700/50 hover:bg-sky-600/70 text-sky-100`}
                >
                  {c.m!.label}{gunBlocked ? ' ⛔' : ''}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
  /** Drag ghost — the tile stays a HEX while being dragged: same
   *  clip-path, size, and accent as its source tile, floating just above
   *  the pointer (visible over a finger on touch).  Fixed-positioned, so
   *  it renders once at the overlay root and serves both contexts. */
  const renderDragGhost = () => {
    if (!dragging || !dragging.moved) return null;
    const srcTile = dragging.area === 'inventory' ? out?.inventory?.[dragging.idx]
      : dragging.area === 'ship' ? out?.ship?.[dragging.idx]
      : out?.weapon?.[dragging.idx];
    const GW = dragging.area === 'inventory' ? INVW : HEXW;
    const GH = dragging.area === 'inventory' ? INVH : HEXH;
    const accent = srcTile?.kind === 'weapon' ? '#f59e0b'
      : dragging.area === 'ship' ? '#0284c7'
      : dragging.area === 'weapon' ? '#7c3aed'
      : '#b45309';
    return (
      <div
        className="fixed z-[70] pointer-events-none"
        style={{ left: dragging.x - GW / 2, top: dragging.y - GH * 0.75 - 12, filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.6))' }}
      >
        <div style={{ width: GW, height: GH, clipPath: HEX_CLIP, background: accent, opacity: 0.95, position: 'relative' }}>
          <span
            className="absolute flex items-center justify-center text-center"
            style={{ inset: 2.5, clipPath: HEX_CLIP, background: '#0f172a' }}
          >
            <span className={`${T_MICRO} font-bold uppercase tracking-tight leading-tight px-1 text-slate-100`}>{dragging.label}</span>
          </span>
        </div>
      </div>
    );
  };

  // Labeled grid of map buttons, shared by the main menu and the pause
  // screen.  Selecting one routes through onSetMapType — a no-op-style
  // backdrop swap on the menu, a live switch-and-play mid-game.
  const renderMapGroup = (heading: string, maps: { type: MapType; label: string }[]) => (
    <div className="flex flex-col items-center gap-2">
      {heading && <span className={`text-slate-400 ${T_BODY} uppercase tracking-wider`}>{heading}</span>}
      <div className="flex flex-wrap justify-center gap-2 max-w-xl">
        {maps.map(opt => (
          <button
            key={opt.type}
            onClick={() => onSetMapType && onSetMapType(opt.type)}
            className={`${CHIP_BASE} ${
              mapType === opt.type
                ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg'
                : `${CHIP_OFF} hover:border-indigo-400`
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
  // Enemy-test override row + the collapsed material-field maps.  Shared by
  // the main menu and the pause player-menu so test-switching is one place.
  const renderEnemyTestGroup = () => (
    <div className="flex flex-col items-center gap-2">
      <span className={`text-rose-300 ${T_BODY} uppercase tracking-wider`}>Enemy Test — force one type</span>
      <div className="flex flex-wrap justify-center gap-2 max-w-xl">
        {ENEMY_TEST.map(opt => {
          const active = (stats.forcedEnemy ?? null) === (opt.type ?? null);
          return (
            <button
              key={opt.label}
              onClick={() => onSetForcedEnemy && onSetForcedEnemy(opt.type)}
              className={`${CHIP_BASE} ${
                active
                  ? 'bg-rose-600 border-rose-400 text-white shadow-lg'
                  : `${CHIP_OFF} hover:border-rose-400`
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
  const renderTestPanel = () => (
    <>
      {renderMapGroup('Maps', REAL_MAPS)}
      {renderEnemyTestGroup()}
      <div className="text-center">
        <button
          onClick={() => toggleSection('fieldmaps')}
          className={`${SECTION_TOGGLE} text-slate-500 hover:text-slate-300`}
        >
          Material Field Maps {collapsed.fieldmaps ? '▸' : '▾'}
        </button>
        {!collapsed.fieldmaps && <div className="mt-3">{renderMapGroup('', TEST_MAPS)}</div>}
      </div>
    </>
  );
  /**
   * Control-scheme picker (user directive, G9).  Shared by the main menu —
   * where it is the choice made at game start — and the pause menu, so a
   * player who picked wrong is one tap from fixing it rather than one
   * restart.
   *
   * A 2x2 grid rather than a row: four labels plus a caption each do not fit
   * a 390px row, and the caption is the part that makes the choice
   * legible without reading the help panel.
   */
  const renderSchemePicker = () => {
    const active = stats.controlScheme ?? 'touch';
    return (
      <div data-testid="scheme-picker" className="w-full grid grid-cols-2 gap-2">
        {CONTROL_SCHEMES.map((scheme, i) => (
          <button
            key={scheme.id}
            data-testid={`scheme-${scheme.id}`}
            onClick={() => onSetControlScheme && onSetControlScheme(scheme.id)}
            className={`px-2 py-2 rounded-lg border text-left transition-all active:scale-95 ${TAP} ${
              // An ODD number of options into a 2-up grid: the last one spans
              // the row rather than leaving a hole.  (Six today, so this is
              // inert — kept because the roster has changed twice.)
              i === CONTROL_SCHEMES.length - 1 && CONTROL_SCHEMES.length % 2 === 1 ? 'col-span-2 ' : ''
            }${
              active === scheme.id
                ? 'bg-sky-600 border-sky-400 text-white shadow-lg'
                : `${CHIP_OFF} hover:border-sky-400`
            }`}
          >
            <div className={`${T_ROW} font-bold`}>{scheme.label}</div>
            <div className={`${T_MICRO} leading-tight mt-0.5 ${active === scheme.id ? 'text-sky-100' : 'text-slate-500'}`}>
              {scheme.blurb}
            </div>
          </button>
        ))}
      </div>
    );
  };

  /**
   * The same choice as a DROPDOWN (user directive), for the pause menu.
   *
   * A native `<select>` rather than a custom menu: on a phone it opens the
   * OS picker, which is a better target than anything drawn here, and it
   * comes with keyboard and screen-reader behaviour for free.  The pause menu
   * is already a long scroll — five buttons with captions would push the rest
   * of it further down for a setting most players touch once.
   */
  const renderSchemeDropdown = () => {
    const active = stats.controlScheme ?? 'touch';
    return (
      <div className="w-full flex flex-col gap-1">
        <select
          data-testid="scheme-select"
          value={active}
          onChange={ev => onSetControlScheme && onSetControlScheme(ev.target.value as ControlScheme)}
          className={`w-full bg-slate-900 border border-slate-600 text-white ${T_ROW} rounded-lg px-2 py-2 ${TAP} focus:border-sky-400 focus:outline-none`}
        >
          {CONTROL_SCHEMES.map(scheme => (
            <option key={scheme.id} value={scheme.id}>{scheme.label}</option>
          ))}
        </select>
        <span className={`text-slate-500 ${T_NOTE} leading-tight`}>
          {controlSchemeDef(active).blurb}
        </span>
      </div>
    );
  };

  /**
   * DualSense adaptive triggers (WebHID) — an OPT-IN extra, rendered only
   * where it can work.
   *
   * Three deliberate choices, all of them about not letting a desktop-only
   * enhancement leak into the platforms that cannot have it:
   *
   *  - It renders NOTHING when WebHID is absent (every mobile browser, and
   *    Safari).  A greyed-out row explaining an unavailable feature is worse
   *    than silence: it makes the pause menu longer on exactly the device
   *    where screen space is scarcest, to say "no".
   *  - It sits UNDER the scheme dropdown, not in it.  It is not a control
   *    scheme — the pad plays identically without it — so making it a
   *    sixth option would imply a choice between it and something else.
   *  - The button is a real user gesture, because `requestDevice` requires
   *    one; nothing here can be triggered by the game.
   */
  const renderAdaptiveTriggers = () => {
    if (!stats.adaptiveTriggersSupported) return null;
    // Rendered in BOTH menus (see the call sites).  It is one component with
    // no internal state, so two call sites cost nothing and the alternative —
    // one copy, at the bottom of the pause menu's scroll — is a control
    // players report as missing.
    const on = !!stats.adaptiveTriggersConnected;
    return (
      <div className="w-full flex flex-col gap-1">
        <button
          data-testid="adaptive-triggers-toggle"
          onClick={() => onToggleAdaptiveTriggers && onToggleAdaptiveTriggers()}
          className={`pointer-events-auto w-full ${CHIP_BASE} ${
            on
              ? 'bg-amber-600 border-amber-400 text-white'
              : `${CHIP_OFF} hover:border-amber-400`
          }`}
        >
          {on ? 'Adaptive Triggers — ON' : 'Connect DualSense Triggers'}
        </button>
        <span className={`text-slate-500 ${T_NOTE} leading-tight`}>
          {on
            ? 'The right trigger takes on each weapon’s own resistance.'
            : 'Optional, desktop only. Adds per-weapon trigger resistance on a PS5 pad; everything else works without it.'}
        </span>
      </div>
    );
  };

  /**
   * Controls & basics (Pair C, c1).
   *
   * Shared verbatim by the main menu and the pause menu — same widget in both
   * places, the pattern `renderTestPanel` / `renderShipStatus` already set.
   * It is deliberately a COLLAPSIBLE SECTION rather than a sixth full-screen
   * overlay: the game already has five, and how they cohere is 5d's job, not
   * a help panel's.
   *
   * Everything here describes what SHIPPED.  The gamepad and touch-stick rows
   * are the mappings G2/G3 actually bound, not a wishlist — a help screen that
   * lies is worse than none.  The gamepad block lights up when a pad is
   * actually connected (`stats.gamepadInfo`), which is the one thing here the
   * engine knows and the reader might not.
   */
  const renderHelpPanel = () => {
    const padOn = !!stats.gamepadInfo && stats.gamepadInfo !== 'none';
    const scheme = stats.controlScheme ?? 'touch';

    // The ACTIVE scheme's block is the one the player is reading for, so it
    // is marked; the others stay visible because switching is one tap away
    // and the point of the panel is to make that choice an informed one.
    const group = (
      title: string, accent: string, rows: [string, string][],
      live?: React.ReactNode, activeFor?: ControlScheme[],
    ) => (
      <div className={`w-full ${activeFor && !activeFor.includes(scheme) ? 'opacity-45' : ''}`}>
        <h4 className={`${accent} ${HEADING} mb-1.5 flex items-center gap-2 flex-wrap`}>
          {title}
          {activeFor && activeFor.includes(scheme) && (
            <span className={`${T_MICRO} normal-case tracking-normal bg-white/10 px-1.5 py-0.5 rounded`}>active</span>
          )}
          {live}
        </h4>
        <div className="flex flex-col gap-1">
          {rows.map(([control, what]) => (
            <div key={control} className={`flex gap-2 ${T_BODY} leading-snug`}>
              {/* Fixed-basis control column so the descriptions line up, but
                  `min-w-0` + wrapping on both halves so a 390px screen never
                  pushes the row sideways. */}
              <span className="text-slate-200 font-mono shrink-0 basis-[7.5rem] break-words">{control}</span>
              <span className="text-slate-400 min-w-0">{what}</span>
            </div>
          ))}
        </div>
      </div>
    );

    return (
      <div data-testid="help-panel" className="w-full flex flex-col gap-4 text-left">
        {group('Touch', 'text-sky-300', [
          ['Drag anywhere', 'Fly and aim at once — direction and speed from the screen centre.'],
          ['Tap', 'Shoot where you tapped.'],
          ['Hold 1s, release', 'Charged shot (needs an Overcharge core installed).'],
          ['Tap your ship', 'Dock at a station, or enter a portal you are next to.'],
          ['Tap the minimap', 'Expand it. Tap a weapon slot to switch weapons.'],
        ], null, ['touch'])}

        {group('Joystick touch', 'text-sky-300', [
          ['Stick thumb', 'Drag to fly. The stick appears wherever your thumb lands.'],
          ['Aim', 'The ship points where it flies — the stick aims it. No second gesture.'],
          ['Fire button', 'Shoot. Hold it for a charged shot — the ring shows the charge.'],
          ['Handedness', 'Two versions: stick left + fire right, or the mirror of it.'],
          ['Tap your ship', 'Dock, or enter a portal. Tapping elsewhere does not shoot.'],
        ], null, ['joystick-left', 'joystick-right'])}

        {group('Keyboard & mouse', 'text-emerald-300', [
          ['W A S D / arrows', 'Fly.'],
          ['Mouse', 'Aims. Click to shoot.'],
          ['Hold 1s, release', 'Charged shot.'],
          ['E', 'Dock, enter a portal, or undock. Clicking your ship does the same.'],
          ['Touch', 'Still works alongside: drag to fly, tap to shoot.'],
        ], null, ['keyboard'])}

        {group('Gamepad', 'text-violet-300', [
          ['Left stick / D-pad', 'Fly. On the left-stick scheme it aims too — the ship points where it flies.'],
          ['Right stick', 'Aim. Unused on the left-stick scheme, where one thumb does both.'],
          ['Right trigger', 'Shoot — the moment you reach the break point. Hold for a charged shot. (Bottom face button too.)'],
          ['Bottom face button', 'Shoot. The only gun on the left-stick and trigger-thrust schemes, where the triggers are doing something else or may not exist. ✕ on PlayStation, A on Xbox.'],
          ['Left trigger', 'Throttle, on the trigger-thrust scheme: the stick steers, the trigger decides how hard.'],
          ['Left face button', 'Dock, enter a portal, or undock. □ on PlayStation, X on Xbox.'],
          ['Right shoulder', 'Switch weapon. (Top face button too.)'],
          ['Start / Options', 'Pause.'],
          ['In menus', 'D-pad moves, bottom face button selects, right face button goes back.'],
          ['Touch', 'Still works alongside: drag to fly, tap to shoot.'],
        ], padOn ? (
          <span className={`text-violet-200/80 font-mono ${T_MICRO} normal-case tracking-normal bg-violet-500/15 px-1.5 py-0.5 rounded`}>
            connected
          </span>
        ) : null, ['gamepad', 'gamepad-thrust', 'gamepad-left'])}

        {group('The run', 'text-amber-300', [
          ['Salvage', 'The silver drops are money. Collecting them is the only way to earn.'],
          ['Stations', 'Dock to repair, buy modules, and outfit the ship. Outfitting needs a drydock.'],
          ['Portals', 'The rifts on the hub lead to wave arenas. The return rift brings you home.'],
          ['Waves', 'Clear the field to advance. Every sixth wave is a boss; killing it opens a way down.'],
          ['Death', 'Costs a slice of the salvage you are still carrying — spent money is safe.'],
        ])}
      </div>
    );
  };

  // Human label for the cycling blend-alpha buttons.  Mirrors the
  // four-step cycle Off / Slow / Med / Fast across both Tile and
  // Shard blend knobs; the underlying values differ per cycle (see
  // NEBULA_CONSTANTS.BLEND_*_ALPHA_CYCLE) but the label is shared.
  const blendLabel = (alpha: number | undefined): string => {
    if (!alpha) return 'Off';
    if (alpha < 0.01) return 'Slow';
    if (alpha < 0.10) return 'Med';
    return 'Fast';
  };
  // Plain JSX helper, NOT a sub-component — keeping it as a function
  // means React inlines the returned button into the parent tree
  // instead of seeing a freshly-identitied component type on every
  // render.  Avoiding the unmount/remount churn here was load-bearing
  // for touch responsiveness (UIOverlay re-renders at ~60 Hz with the
  // stats stream).
  const renderSectionHeader = (name: string, label: string) => (
    <button
      onClick={() => toggleSection(name)}
      /* DELIBERATE EXCEPTION to the 40px TAP floor (5d U2).  The debug menu
         is a developer surface behind two collapsed dropdowns, and it trades
         reach for density on purpose — a 40px floor on ~90 rows would make it
         several screens longer, which is the opposite of what a diagnostic
         panel wants.  It still gets a floor, just a smaller one. */
      className="pointer-events-auto mt-1 w-full min-h-[24px] flex items-center justify-between text-slate-400/80 hover:text-amber-300 uppercase tracking-wider text-[8px] transition-colors"
      title={`Toggle ${label} section`}
    >
      <span>{label}</span>
      <span className="text-slate-500">{collapsed[name] ? '▸' : '▾'}</span>
    </button>
  );
  // Two-digit ms formatter for the perf overlay.  Values under 10 ms get a
  // decimal so sub-millisecond jitter is still visible; bigger numbers
  // collapse to whole ms so the grid stays compact.
  const fmtMs = (ms: number | undefined): string => {
    if (ms === undefined) return '—';
    if (ms < 10) return ms.toFixed(2);
    return ms.toFixed(1);
  };
  // Plain JSX helpers (functions, NOT components — same inlining
  // rationale as renderSectionHeader) for the two repeated DBG row
  // shapes: a labelled cycle/toggle button, and a labelled readonly
  // value.  Collapsing every hand-rolled row to one of these is most of
  // the panel cleanup.
  const ctrlRow = (
    label: string,
    onClick: (() => void) | undefined,
    value: React.ReactNode,
    title: string,
  ) => (
    <div className="pointer-events-auto mt-1 flex items-center justify-between gap-1">
      <span className="text-slate-400/80 uppercase tracking-wider text-[8px]">{label}</span>
      <button
        onClick={onClick}
        /* Same deliberate density exception as renderSectionHeader above. */
        className="bg-slate-800/70 border border-slate-600/60 rounded px-1.5 py-1 min-h-[22px] text-[8px] font-bold text-slate-200 hover:border-amber-400/70 hover:text-amber-300 transition-colors"
        title={title}
      >
        {value}
      </button>
    </div>
  );
  const statRow = (label: string, value: React.ReactNode, valueClass = 'text-white') => (
    // whitespace-pre keeps the leading spaces some labels use to show
    // the timing-breakdown hierarchy (updPhys ▸ ·physics ▸ ··grav).
    <div className="flex justify-between"><span className="whitespace-pre">{label}</span><span className={valueClass}>{value}</span></div>
  );
  // Top 'Entities' count under the active display filter.
  const totalEntities = perf ? perf.totalEntities : stats.entityCount;
  const asleepEntities = perf ? perf.perfAsleepCount : 0;
  const entityCountValue =
    entityCountMode === 'asleep' ? asleepEntities
    : entityCountMode === 'active' ? Math.max(0, totalEntities - asleepEntities)
    : totalEntities;
  // ── Debug menu content ────────────────────────────────────────────────
  // Relocated INTO the pause Player Menu as a proper section (station
  // increment decision) — the old floating top-left DBG button + dropdown
  // panel is gone.  Kept as a plain JSX const so the pause overlay slots
  // it under its collapsible "Debug Menu" header.  The 'Overlays' row is
  // the old DBG master toggle: it still gates the renderer's debug
  // overlays (collision polygons, input vector, tile outlines).
  const debugSections = (
    <div className="font-mono text-[9px] leading-tight text-slate-300/90">
              {ctrlRow('Overlays', onToggleDebug,
                stats.debugMode ? 'On' : 'Off',
                'Renderer debug overlays (collision polygons, player input vector). The old DBG master toggle — menu sections below work regardless.')}

              {/* ── Stats (top of menu — default open) ─────────────── */}
              {renderSectionHeader('stats', 'Stats')}
              {!collapsed.stats && (<>
                {statRow('FPS', stats.fps)}
                {statRow('Wave', stats.waveNumber ?? 1)}
                {statRow('State', stats.waveStatus ?? '—')}
                {statRow('Wave timer', stats.waveTimeRemaining !== undefined ? `${stats.waveTimeRemaining}s` : '—')}
                {/* Total entity count with a display-only filter:
                    total / active (awake) / asleep (dynamic-sleeping). */}
                <div className="pointer-events-auto mt-1 flex items-center justify-between gap-1">
                  <span className="text-slate-400/80 uppercase tracking-wider text-[8px]">Entities</span>
                  <span className="flex items-center gap-1">
                    <span className="text-white">{entityCountValue}</span>
                    <select
                      value={entityCountMode}
                      onChange={e => setEntityCountMode(e.target.value as 'total' | 'active' | 'asleep')}
                      className="pointer-events-auto bg-slate-800/70 border border-slate-600/60 rounded text-[8px] font-bold text-slate-200 px-0.5 outline-none hover:border-amber-400/70"
                      title="Entity-count filter (display only): total = all entities, active = awake, asleep = dynamic-sleeping (count of resting shards). Sleeping behaviour itself is the Shards & Physics ▸ Sleep toggle."
                    >
                      <option value="total">total</option>
                      <option value="active">active</option>
                      <option value="asleep">asleep</option>
                    </select>
                  </span>
                </div>
              </>)}

              {/* ── Player ─────────────────────────────────────────── */}
              {renderSectionHeader('player', 'Player')}
              {!collapsed.player && (<>
                {ctrlRow('Thrust', onCyclePlayerThrust, stats.playerThrustName ?? '0.75×',
                  'Player THRUST multiplier (0.75 / 1 / 1.25 / 1.5×) applied live to the per-map acceleration. Terminal cruise = acceleration/(1−friction), so this is the knob that actually changes everyday top speed.')}
                {ctrlRow('Speed', onCyclePlayerSpeed, stats.playerSpeedName ?? '1×',
                  'Player SPEED multiplier (0.5 / 0.75 / 1 / 1.5 / 2 / 3×) applied live to the per-map maxSpeed cap. Only changes top speed when the cap falls below the friction-limited terminal velocity (or thrust raises cruise above it).')}
                {ctrlRow('Snitch catch', onToggleSnitchCatchMode,
                  stats.snitchCatchMode === 'shoot' ? 'Shoot' : 'Collide',
                  'How the golden snitch is caught (testing toggle). Collide: fly into it hull-to-hull. Shoot: any player shot within its catch radius nabs it. Either way the catch pays the snitch bonus and ends the wave immediately.')}
                {ctrlRow('Snitch spd', onCycleSnitchSpeed,
                  stats.snitchSpeedName ?? '1×',
                  'Snitch-speed multiplier (0.5 / 0.75 / 1 / 1.5 / 2×) scaling its speed live on top of the per-CATCH ramp. The first snitch flies at 0.05× player cruise and gains 0.05× each time one is CAUGHT (capped at 1.2×) — deferring the catch keeps it slow. This knob scales that for testing.')}
                {statRow('Gamepad', stats.gamepadInfo ?? 'none',
                  (stats.gamepadInfo && stats.gamepadInfo !== 'none') ? 'text-sky-300' : 'text-slate-400')}
                {statRow('  ↳ axes', stats.gamepadAxes ?? '—', 'text-slate-400')}
                {statRow('  ↳ rumble', stats.rumbleInfo ?? '—',
                  stats.rumbleInfo === 'ready' || stats.rumbleInfo === 'playing'
                    ? 'text-emerald-300' : 'text-slate-400')}
                {/* Adaptive triggers cannot be checked without hardware AND a
                    byte layout that no browser validates — the pad silently
                    drops a malformed report — so the row shows the head of
                    what was actually sent, not just a connected flag. */}
                {statRow('  ↳ triggers', stats.adaptiveTriggerInfo ?? '—',
                  stats.adaptiveTriggersConnected ? 'text-emerald-300' : 'text-slate-400')}
                {statRow('  ↳ report', stats.adaptiveTriggerReport ?? '—', 'text-slate-400')}
                {ctrlRow('  ↳ trig enc', onCycleTriggerEncoding,
                  stats.adaptiveTriggerInfo?.includes('simple') ? 'simple' : 'zones',
                  'Which wire encoding the trigger effects are sent in. TWO conventions are in wide use and a DualSense silently discards the one its firmware does not understand, so this is a diagnostic rather than a preference. "zones" = modes 0x21/0x25, parameters packed into ten travel zones (what the console appears to use). "simple" = modes 0x01/0x02, raw byte parameters (what most samples send). If one gives no resistance, try the other.')}
                {ctrlRow('  ↳ HID buzz', onTestTriggerLink, 'Test',
                  'Pulses the pad MOTORS through the HID output report — the same framing and CRC the trigger effects ride, but with an encoding that is not in dispute. If this buzzes and the triggers stay limp, the transport is fine and the effect encoding is wrong (try "trig enc"). If it does not buzz, nothing is reaching the pad at all — read the error on the triggers row.')}
                {ctrlRow('Enemy scale', onCycleEnemyScale,
                  stats.enemyScaleName ?? '1×',
                  'Multiplier on the per-wave enemy HP+damage growth (1 / 0 / 0.5 / 1.5 / 2×). 0 disables wave scaling; 2× doubles it. Tuned for a comfortable player lead. Applies to enemies spawned after the change.')}
                {statRow('  ↳ live', stats.enemyScaleInfo ?? '—', 'text-slate-400')}
                {ctrlRow('Sim rate', onCycleSimRate, stats.simRateName ?? '120Hz',
                  'Simulation rate: 120Hz (default) or 60Hz. At 120Hz a 60fps frame runs TWO full sim steps, so this is the single biggest lever on sim cost — but it is a TRADE, not a free win: collision resolution is iterative, so half the steps means half the passes untangling dense shard piles. Rate-dependent constants are converted exactly, and the frame delta is vsync-snapped so 60Hz does not judder. Judge it by FEEL in a shard field.')}
                {ctrlRow('Substep cap', onCycleSubstepCap, stats.substepCapName ?? '5',
                  'Max sim substeps one frame may drain (5 / 3 / 2) — the spiral-of-death clamp. Set too HIGH it feeds the spiral: a device capture showed every worst frame pegged at 5 steps with 36-44ms of sim in a 60ms frame, because a long frame pulls in more substeps which make it longer still. A 60fps display with a 120Hz sim only NEEDS 2. Lower caps convert a judder into a brief smooth slow-motion; the excess time is discarded either way.')}
                {ctrlRow('Render scale', onCycleRenderScale, renderScaleName ?? '3x',
                  'Cap on the canvas device-pixel-ratio (3 / 2 / 1.5). At dpr 3 a 440x756 phone viewport rasterises ~3.0 MILLION pixels every frame; capping at 2 cuts that to ~1.3M. This cost is INVISIBLE to the render timer — that measures our JS issuing canvas calls, while rasterisation and compositing happen in the browser compositor afterwards, which is exactly where device captures show the missing 25-36ms going. Trade: a softer image.')}
                {ctrlRow('HUD rate', onCycleHudRate, stats.hudRateName ?? '60Hz',
                  'How often the React HUD re-renders (60 / 30 / 15Hz). Added when the 32ms-of-a-35ms-frame gap in a device capture was blamed on React reconciliation — MEASURED SINCE, and it was not: reconciliation is 0.1ms median in play, 0.3ms with an overlay up, so this knob is worth ~0.05ms. Kept as a harmless A/B, not a lever. The missing time is compositing — see Render scale. Chips and bars do not need 60Hz; the minimap, loadout strip, banners and damage text are canvas-drawn and unaffected. Pause/station/death screens always update immediately.')}
                {ctrlRow('Gnat move', onCycleSwarmMove, stats.swarmMoveName ?? 'boids',
                  'Cycle the Swarm gnat movement: boids (flock) → vortex (orbit + dart) → weave (serpentine) → burst (coast + telegraphed dash). Applies live to all gnats.')}
                {ctrlRow('Corrode', onApplyCorrosion, 'Apply',
                  'Apply a corrosion stack to the player (DBG) to test the damage-over-time + HUD badge. Stacks up to 3; bleeds health past the shield.')}
                {ctrlRow('Disable', onApplyDisable, 'EMP',
                  'EMP the player (DBG) to test the weapon + shield disable (Stage 3c): firing is blocked and the shield goes offline (no absorb / no recharge) for the effect duration. Surfaces as a HUD badge.')}
                {ctrlRow('Traits', onToggleTraits,
                  stats.traitsEnabled === false ? 'Off' : 'On',
                  'Enemy counterplay traits (armor chip-resist, …). ON: the Tank shrugs off small per-hit damage so heavy weapons are demanded — its damage numbers read low when chipped. OFF disables the soft-counter engine.')}
                {ctrlRow('Station', onTeleportStation, 'Go',
                  'Teleport the player to the station\'s doorstep (docking-test harness). Overworld only — no-op on maps without a station.')}
              </>)}

              {/* ── Ship Tilt (the directional-tilt system: what draws at
                     the player's position and how it leans).  Its own
                     section because these seven rows are one subsystem and
                     they are A/B knobs for it — the Player section above is
                     unrelated movement / input / test controls, and reading
                     either was harder with the two interleaved.  The whole
                     thing SHIPS OFF (Hull 'Ship' + Roll feel 'Off'), so
                     turning it on is the first two rows here. ── */}
              {renderSectionHeader('tilt', 'Ship Tilt')}
              {!collapsed.tilt && (<>
                {ctrlRow('Roll feel', onCyclePlayerRoll, stats.rollFeelName ?? 'Off',
                  'Directional-tilt depth preset (SHIPS OFF; Off / Subtle / Default / Deep) stepping how far the hull pitches and rolls into a carved turn, lateral thrust or a throttle change — purely visual (physics, collision and aim never read it). Off levels out through the normal easing rather than snapping flat.')}
                {ctrlRow('Hull', onCyclePlayerHull, stats.hullModeName ?? 'Ship',
                  'What draws at the player\'s position. Ship (DEFAULT): the legacy sprite with the cos-tilt squash — an untouched build looks exactly as it always did. Sheet: PRE-RENDERED tilt art, one authored pose per lean, snapped to the nearest cell with yaw still on the canvas (see docs/SHIP_SPRITE_SHEETS.md); falls back to the squash until art exists, and needs "Roll feel" off Off to show anything. Cube: a flat wireframe cube — at rest a square with the nose face edge-on — rotating for real in yaw + the tilt pitch/roll. Diamond: the same cube stood on a corner for a gem-cut hull. Sphere: three great circles with a nose ring at the forward pole. Dodeca: a dodecahedron with a pentagonal face forward. Rhombic: the rhombic dodecahedron, axis vertex forward. Tri: a triangular dart ship — nose, swept wingtips, dorsal peak and keel.')}
                {ctrlRow('Roll damp', onCycleRollDamping, stats.rollDampName ?? 'Default',
                  'Rotation-damping preset (Floaty 0.5x / Default / Stiff 2x / Snappy 4x): scales the tilt spring\'s natural frequency, so the hull tracks the hand looser or tighter with the same overshoot-and-wobble character. Ship weight also slows the spring (inertia).')}
                {ctrlRow('Tilt mode', onCycleTiltMode, stats.tiltModeName ?? 'Lean',
                  'Lean (default): the hull tilts toward the acceleration and settles back. Tumble (test): thrust drives roll RATE instead — the hull keeps rolling with its travel about the axis perpendicular to the thrust and freezes where it stops; the white aim marker hides and a fixed chevron reticle ahead of the hull carries the aim.')}
                {ctrlRow('Lean dir', onCycleLeanDir, stats.leanDirName ?? 'Default',
                  'A/B for which way the hull tips in Lean mode. Default: bank INTO the acceleration, like an aircraft carving its turn. Reversed: both pitch and roll mirrored — the hull kicked back by its own thrust — and the wireframe re-bases NOSE-UP, so each shape\'s front face/vertex faces the screen at rest. Same signal, easing and clamps; Tumble is unaffected.')}
                {ctrlRow('Tilt src', onCycleTiltSource, stats.tiltSourceName ?? 'Thrust',
                  'What drives the tilt signal, in BOTH tilt modes. Thrust (default): the input vector — no input, no tilt. Velocity: the ship\'s actual motion, normalized by its real cruise speed — a coasting drift holds its lean, a wall bounce reads on the hull, and a tumble keeps rolling as long as the ship moves. Average / Sum: run BOTH and blend the resulting rotation effects (not the raw inputs — each source runs its own throttle gate and slip weighting first). Average is their midpoint, so it stays inside the range either reaches alone; Sum lets them reinforce, so the hull banks SOONER — the magnitude clamp keeps it from ever banking deeper.')}
                {ctrlRow('Vel gain', onCycleVelGain, stats.velGainName ?? '1×',
                  'Sensitivity of the Velocity tilt source (1× / 2× / 4× / 10×): multiplies the cruise-normalized velocity signal before its clamp, so higher steps reach the full tilt at ever lower speeds — 2× at half cruise, 10× on almost any motion. Saturates earlier, never tilts deeper. Thrust mode ignores it.')}
              </>)}

              {/* ── Modules (DBG grants — varieties at fixed marks) ── */}
              {renderSectionHeader('modules', 'Modules')}
              {!collapsed.modules && (<>
                {statRow('Salvage', (stats.credits ?? 0).toLocaleString(), 'text-amber-300')}
                {ctrlRow('+1k Salv', onAddCredits, 'Grant',
                  'Grant 1000 Salvage for testing the station shops.')}
                {([
                  ['hull', 'Hull'], ['plating', 'Plating'], ['capacitor', 'Capacitor'],
                  ['engine', 'Engine'], ['thrusters', 'Thrusters'],
                  ['gunnery', 'Gunnery'], ['autoloader', 'Autoloader'],
                ] as const).map(([fam, label]) => (
                  <div key={fam} className="pointer-events-auto mt-1 flex items-center justify-between gap-1">
                    <span className="text-slate-400/80 uppercase tracking-wider text-[8px]">{label}</span>
                    <span className="flex gap-0.5">
                      {[1, 2, 3].map(mk => (
                        <button
                          key={mk}
                          onClick={() => onGrantModule?.(`${fam}_mk${mk}`)}
                          className="bg-slate-800/70 border border-slate-600/60 rounded px-1 py-0.5 text-[8px] font-bold text-slate-200 hover:border-amber-400/70 hover:text-amber-300 transition-colors"
                          title={`Grant ${label} Mk ${mk} into the inventory (DBG). Auto-installs if a compatible hex is free — modules are fixed items, no levels.`}
                        >
                          M{mk}
                        </button>
                      ))}
                    </span>
                  </div>
                ))}
                {ctrlRow('Shield', () => onGrantModule?.('shield'), 'Grant',
                  'Grant the Shield core module (DBG). Needs to touch a hull module on the ship flower to function.')}
                {ctrlRow('Overcharge', () => onGrantModule?.('overcharge'), 'Grant',
                  'Grant the Overcharge module (DBG). Needs to touch a gun on the weapon flower to function.')}
                {ctrlRow('Light', () => onGrantModule?.('flashlight_kit'), 'Grant',
                  'Grant the Light module (DBG). Needs to touch a hull module to function; then tap your ship in open space to cycle the light off / medium / high (the beam style at the medium / high lighting tiers).')}
                {ctrlRow('Outfit all', onOutfitAll, 'Max',
                  'Outfit a full Mk III loadout in a canonical layout that satisfies every adjacency requirement, spare guns in the inventory (DBG).')}
                {ctrlRow('Reset', onResetOutfit, 'Lean',
                  'Reset to the lean run start: bare hexes, empty inventory, Blaster on gun hex W1.')}
              </>)}

              {/* ── Weapons (DBG grant + equip) ────────────────────── */}
              {/* With commerce station-only, this is the wave-map test
                  path for getting a weapon in hand: click = unlock (if
                  needed) + equip.  S1/S2 = current loadout slot. */}
              {renderSectionHeader('weapons', 'Weapons')}
              {!collapsed.weapons && (stats.weaponCatalog ?? []).map(w =>
                <React.Fragment key={w.id}>
                  {ctrlRow(w.name, () => onGrantWeapon?.(w.id),
                    w.slot !== null ? `S${w.slot + 1}` : w.owned ? 'owned' : '—',
                    `Grant + equip ${w.name} (DBG). Unlocks it if not owned, then mounts it on a gun hex (first empty, else the inactive one). S1/S2 = gun hex.`)}
                </React.Fragment>)}

              {/* ── Dragon mini-boss summon (DBG) ──────────────────── */}
              {renderSectionHeader('dragon', 'Dragon')}
              {!collapsed.dragon && (
                <div className="pointer-events-auto flex flex-wrap gap-2 px-1 py-1">
                  {['glass', 'rock', 'plastic', 'metal', 'mixed'].map(t => (
                    <button
                      key={t}
                      onClick={() => onSpawnDragon && onSpawnDragon(t)}
                      className={`${CHIP_BASE} capitalize ${CHIP_OFF} hover:border-emerald-400`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}

              {/* ── Rival ships summon (DBG) ───────────────────────── */}
              {renderSectionHeader('rival', 'Rivals')}
              {!collapsed.rival && (
                <div className="pointer-events-auto flex flex-wrap gap-2 px-1 py-1">
                  {[
                    { k: 'hostile', c: 'hover:border-red-400' },
                    { k: 'ally', c: 'hover:border-emerald-400' },
                    { k: 'neutral', c: 'hover:border-amber-400' },
                    { k: 'random', c: 'hover:border-sky-400' },
                  ].map(({ k, c }) => (
                    <button
                      key={k}
                      onClick={() => onSpawnRival && onSpawnRival(k)}
                      className={`${CHIP_BASE} capitalize ${CHIP_OFF} ${c}`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              )}

              {/* ── Portals (wormhole tuning, DBG) ─────────────────── */}
              {/* Five live multipliers over PORTAL_CONSTANTS.  All applied at
                  the READ, so each takes effect on the rifts already in the
                  world — fly past one and click.  Index 0 of every cycle is
                  the SHIPPED value, so the first click is always the A/B. */}
              {renderSectionHeader('portal', 'Portals')}
              {!collapsed.portal && (<>
                {ctrlRow('Transit fx', onCyclePortalWarp, stats.portalWarpName ?? '0.9s',
                  'Length of the flight-THROUGH beat played on arrival (0.9 / 0.6 / 1.4s / off) — the tunnel that unrolls the lens into radial streaks, streams the sky outward and decelerates onto the destination. The sim is FROZEN for its duration (the stage-clear pattern), so nothing can shoot you inside the tunnel and the beat costs no simulation; "off" transitions instantly, exactly as before it existed. Takes effect on the next transit.')}
                {ctrlRow('Size', onCyclePortalSize, stats.portalSizeName ?? '1×',
                  'Rift SIZE multiplier (1 / 0.75 / 0.5 / 0.35 / 1.25×) — scales the drawn mouth, the horizon that swallows shards, and the star-lens radius together, live on the portals already placed. Deliberately does NOT change how close you must be to ENTER (USE_RANGE): that is an interaction rule, not a look, and moving it would make the other comparisons unreadable.')}
                {ctrlRow('Gravity', onCyclePortalGravity, stats.portalGravityName ?? '1×',
                  'Portal gravity STRENGTH (1 / 0.5 / 0.25 / off / 1.5×) — how hard the well pulls shards, enemies and drops (the player always feels only GRAVITY_PLAYER_SCALE of it). "off" leaves the art and the lens untouched, so this isolates the pull from the look.')}
                {ctrlRow('  ↳ range', onCyclePortalGravityRange, stats.portalGravityRangeName ?? '1×',
                  'How far the pull REACHES (1 / 0.75 / 0.5 / 1.5× of GRAVITY_RANGE). Separate from strength because a well can be too WIDE without being too strong — a short, firm well reads as a mouth, a long faint one as the whole area sagging.')}
                {ctrlRow('Lens', onCyclePortalLens, stats.portalLensName ?? '1×',
                  'Background star-warp strength (1 / 0.5 / 0.25 / off / 1.5 / 2 / 3×). Scales the radial push off the throat AND the twist, both of which are bounded, so each step visibly flattens the distortion. At "off" the star field takes its original untouched draw path — the cheapest possible A/B against the warp existing at all. The warped region hugs the black disc (4× its radius), so it also shrinks with Size and with a smaller destination.')}
                {ctrlRow('  ↳ radius', onCyclePortalLensRadius, stats.portalLensRadiusName ?? '4×',
                  'How much SKY the warp covers, as a multiple of the rift\'s black-disc radius (4 / 6 / 9 / 14 / 2.5×) — separate from Lens, because how WIDE the bend reaches and how HARD it bends are different questions. It rides the disc, so it also inherits the destination-span scaling and the Size knob: a Pocket rift warps a small patch, Deep Space a wide one.')}
                {ctrlRow('  ↳ spin', onCyclePortalLensSpin, stats.portalLensSpinName ?? '1×',
                  'Star-lens SPIN (1 / 0.5 / 0.25 / frozen / 2×) — the rate the bounded twist BREATHES, nothing else. The twist no longer accumulates over time (that is what used to wind the field into bands), so this changes only how fast the bend swells and relaxes; "frozen" holds it at its standing value for a completely static warp.')}
                {statRow('  ↳ live', stats.portalTuningInfo ?? '—', 'text-slate-400')}
              </>)}

              {/* ── Boss capstone summon ((h), DBG) ────────────────── */}
              {renderSectionHeader('boss', 'Bosses')}
              {!collapsed.boss && (
                <div className="pointer-events-auto flex flex-wrap gap-2 px-1 py-1">
                  {[{ k: 'BOSS_WARDEN', label: 'Warden' }, { k: 'BOSS_SCATTER', label: 'Reaver' },
                    { k: 'BOSS_SIEGE', label: 'Bastion' }].map(({ k, label }) => (
                    <button
                      key={k}
                      onClick={() => onSpawnBoss && onSpawnBoss(k)}
                      title="Warp this boss in with its full phase table (DBG). Each click stacks another."
                      className={`${CHIP_BASE} ${CHIP_OFF} hover:border-rose-400`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* ── Perf recorder (FPS harness, DBG) ───────────────── */}
              {renderSectionHeader('perfrec', 'Perf REC')}
              {!collapsed.perfrec && (
                <div className="pointer-events-auto flex flex-col gap-1.5 px-1 py-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => onPerfRecToggle && onPerfRecToggle()}
                      className={`${CHIP_BASE} ${
                        stats.perfRecording
                          ? 'bg-red-600/80 border-red-400 text-white animate-pulse'
                          : `${CHIP_OFF} hover:border-red-400`
                      }`}
                      title="Start / stop an FPS + perf capture"
                    >
                      {stats.perfRecording ? '● REC' : '○ REC'}
                    </button>
                    <button
                      onClick={() => onPerfRecCycleScene && onPerfRecCycleScene()}
                      className={`${CHIP_BASE} capitalize ${CHIP_OFF} hover:border-amber-400`}
                      title="Cycle the scene label recorded with the capture"
                    >
                      {stats.perfRecScene ?? 'baseline'}
                    </button>
                    <button
                      onClick={handlePerfCopy}
                      disabled={(stats.perfRecSamples ?? 0) === 0}
                      className={`${CHIP_BASE} ${CHIP_OFF} hover:border-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed`}
                      title="Export the capture as a copy-paste report"
                    >
                      {perfCopied ? 'Copied ✓' : 'Copy'}
                    </button>
                    <span className="text-[10px] text-slate-400 tabular-nums">
                      {stats.perfRecording ? 'rec ' : ''}{stats.perfRecSamples ?? 0}f
                    </span>
                  </div>
                  {perfCopyText && (
                    <div className="flex flex-col gap-1">
                      <textarea
                        readOnly
                        value={perfCopyText}
                        onFocus={(e) => e.currentTarget.select()}
                        rows={7}
                        className="w-full bg-slate-950/80 border border-slate-700 rounded text-[9px] leading-tight text-slate-200 font-mono p-1.5 resize-y select-all"
                        title="Tap to select all, then copy"
                      />
                      <button
                        onClick={() => { setPerfCopyText(''); setPerfCopied(false); }}
                        className="self-end px-2 py-0.5 rounded text-[9px] text-slate-400 hover:text-white"
                      >
                        dismiss
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Visual ─────────────────────────────────────────── */}
              {renderSectionHeader('visual', 'Visual')}
              {!collapsed.visual && (<>
                {ctrlRow('Star density', onCycleStarDensity, stats.starDensityName ?? 'Auto',
                  'Star density in stars per 10,000 CSS px². AUTO (default) uses THIS MAP\u0027s own density and shows it beside the label — every map has its own sky, from 90 near a planet up to 729 in deep space (STAR_DENSITY_BY_MAP). The other steps are overrides for comparing two settings on one map. 1200/1800/2700 run PAST the top of the per-map range on purpose — 2700 is roughly the density the field carried before it was derived from area, so the ceiling can be judged by looking at it on a device rather than argued about. The count is DERIVED from viewport area, so a phone and a desktop show the same sky per unit area. Regenerates immediately.')}
                {ctrlRow('Star size', onCycleStarSize, stats.starSizeName ?? 'Device px',
                  'Star size floor. Bands are generated at DEVICE resolution and blitted 1:1 at whole device-pixel offsets, so no resampling filter is in the path — which makes this a real choice for the first time. Device px: a star may be a single device pixel, the finest sky the display can show. CSS px: never smaller than one CSS pixel — the apparent-size floor the field had before, but crisp instead of filtered. IDENTICAL at dpr 1; the knob only differs at dpr ≥ 2.')}
                {ctrlRow('Star depth', onCycleStarBands, stats.starBandsName ?? '240',
                  'Parallax DEPTH LAYERS (240 / 120 / 480 / 60). The star budget is split evenly across them, so this changes how finely depth is quantised, not how many stars there are — more layers means a smoother near-to-far gradient as the camera moves. Frozen at 60 for as long as a layer was a full-viewport canvas (60 of those cost 80–316 MB); a layer is now five numbers, so 240 costs ~10 KB. Regenerates the field immediately.')}
                {ctrlRow('Parallax', onCycleStarParallax, stats.starParallaxName ?? 'Auto',
                  'PARALLAX SPREAD — how much faster the nearest depth layer scrolls than the farthest. AUTO (default) DERIVES it from this map\u0027s density, inversely: sparse skies are NEAR skies and separate more as you move, so 90 density gives 8x spread and 729 gives 1x. Independent of Star depth: the span is set here, so adding LAYERS cuts the same range more finely rather than deepening it — which is why more layers reads as LESS separation, not more. The curve is quadratic, so near layers spread wide and far layers bunch together, the way real distance behaves.')}
                {ctrlRow('Sound burst', onCycleCollapseMode, stats.collapseModeName ?? 'Merge',
                  'How a BURST of the same sound is folded into voices — a single frame can kill 40 enemies or shatter 200 shards. MERGE (shipped): simultaneous triggers of one id collapse into ONE voice whose gain is bumped, so bulk reads as heavier rather than as forty thin copies. SOME: half the retrigger window and double the voices, so a burst of 40 lands as roughly 20 distinct hits. ALL: no collapse at all — every trigger gets a voice, under a much-raised ceiling. This is the honest \u201cwhat does 40-at-once sound like\u201d test and is expected to be ugly; that is the evidence. Three gates move together (window, polyphony, tier ceilings) because loosening one alone just moves the drop a step later.')}
                {ctrlRow('Trail', onCycleTrailShape,
                  stats.trailShape === TrailShape.SQUARE ? 'Square'
                    : stats.trailShape === TrailShape.TRIANGLE ? 'Triangle'
                    : stats.trailShape === TrailShape.LINE ? 'Line'
                    : stats.trailShape === TrailShape.PATH ? 'Path'
                    : stats.trailShape === TrailShape.DOTS ? 'Dots'
                    : stats.trailShape === TrailShape.NONE ? 'None'
                    : 'Circle',
                  'Cycle the player trail shape: Circle → Square → Triangle → Line → Path → Dots → None.')}
                {ctrlRow('Trail dir', onCycleTrailEmitMode,
                  stats.trailEmitMode === TrailEmitMode.THRUST ? 'Thrust' : 'Velocity',
                  'Trail emit direction: Velocity vs Thrust.')}
                {ctrlRow('Screen shake', onToggleScreenShake,
                  stats.screenShakeEnabled === false ? 'Off' : 'On',
                  'Camera screen-shake on impacts. Off keeps the camera anchored and cancels in-flight shakes immediately.')}
                {ctrlRow('Outlines', onToggleTileOutlines,
                  stats.tileOutlinesEnabled === true ? 'On' : 'Off',
                  'Collision-shape outlines on plastic + nebula tiles/shards (soft-gradient variants). Shows the SAT polygon against the gradient fill.')}
                {ctrlRow('Chevrons', onToggleChevronMode,
                  stats.chevronsOffscreenOnly === false ? 'All' : 'Offscreen',
                  'Off-screen indicator chevrons. Offscreen: only nearby-but-offscreen entities get a chevron (on-screen ones are suppressed as redundant). All: also chevron on-screen entities (original behaviour).')}
                {ctrlRow('HP bars', onToggleDamageBars,
                  stats.damageTriggeredBars === false ? 'Always' : 'On damage',
                  'Enemy world-space health bars. On damage (default): a bar appears when the enemy is hit and fades out after, so the bars on screen are the fights in progress rather than a label on every entity. Always: the pre-5d behaviour, every enemy carrying a bar every frame. The PLAYER has no world-space bar either way - the HUD hull/shield readout is the canonical one.')}
                {ctrlRow('Rumble', onToggleRumble,
                  stats.rumbleEnabled === false ? 'Off' : 'On',
                  'Gamepad force feedback. Rides the SCREEN SHAKE — every impact already funnels through one call with magnitudes tuned against each other, so the hand feels what the camera feels. Separate from the Screen shake toggle: the camera lurching and the pad buzzing are different preferences. Only dual-rumble is reachable from a browser; the DualSense adaptive triggers need WebHID (desktop Chromium only).')}
                {ctrlRow('Rock palette', onCycleRockPalette,
                  stats.rockPaletteName ?? 'mixed',
                  'Rock body colour family. Mixed (default): mostly slate with rust and mineral running through it, so a field reads as ROCK with variation. Slate: the old single flat grey. Rust / mineral: the pure warm and cool families, kept for regional-identity work and for judging them side by side. Shades are rolled per instance AT SPAWN — reload the map to repaint a whole field.')}
                {ctrlRow('Fracture', onCycleFractureMode,
                  stats.fractureModeName ?? 'voronoi',
                  'How fracture-capable materials break (voronoi gauntlet A/B). VORONOI (default): the entity carries a seeded Voronoi cell decomposition of its own polygon - the cells are the fragments, so a break flies apart along its own seams and conserves area. LEGACY: the shipped pre-gauntlet model - fresh random star-polygon fragments (powerlaw) and the rock-tile 3-chunk dent break. Applies at the next break; judge on a rock field.')}
                {ctrlRow('Neb spin', onCycleNebulaWakeSpin,
                  stats.nebulaWakeSpinName ?? 'physical',
                  'Which way the player\'s wake spins a passing nebula shard. PHYSICAL: the wake shear — a shard passed on the STARBOARD side turns clockwise, port-side counter-clockwise. INVERTED: the same cross product negated (the A/B). RANDOM: the old per-shard id-parity vortices, with no consistent handedness. Proper rotational mechanics are parked for their own session.')}
                {ctrlRow('Minimap mat', onCycleMinimapMaterial,
                  stats.minimapMaterialName ?? 'Flow',
                  'What the minimap says about MATERIAL. Flow (default): streamlines traced through the asteroid flow field — where material is GOING, drawn as 49 short lines with a pulse running downstream. Dots: the old spray of one dot per mobile shard. Off: neither. Static tiles are unaffected either way (they come from the pre-rendered terrain layer); nebula is off the minimap entirely.')}
                {ctrlRow('Lighting', onCycleLighting,
                  stats.lightingModeName ?? 'legacy',
                  'Unified tile lighting. LEGACY (default) is not "off" — it is the THREE hand-rolled models Omni ships: the player-distance proximity bloom on rock/plastic/indestructible, the repel-impulse glow on glass and metal, and the glass edge tint on its own 120 range. UNIFIED replaces all three with one shadow-casting point light at the ship: a radial falloff with a shadow wedge withheld behind every solid tile in range. Nebula is passThrough and deliberately casts NOTHING, which is why the effect reads strongly on the material showcase maps and faintly on Universe (two thirds of its static tiles are nebula). DEBUG paints a flat grey layer instead of a light — no lighting maths — so the canvas, the single blit and the smoothing restore can be checked on their own.')}
                {ctrlRow('Light tier', onCycleLightingTier,
                  stats.lightingTierName ?? 'low',
                  'Lighting budget. LOW (default) is the 390x844 phone: the light layer renders at a third of screen resolution, 4 lights, 24 occluders each, radius 300, hard shadows. Medium/High halve the divisor and raise every cap. The occluder cap is load-bearing rather than defensive — a radius-300 light can cover ~225 hexes in solid terrain, and the cap takes the NEAREST, which subtend the largest shadow angle, so truncation degrades gracefully.')}
                {ctrlRow('Light bright', onCycleLightBrightness,
                  stats.lightBrightnessName ?? '100%',
                  'How bright the player light is, 100% (default) down to 8%. This is NOT the Light tier row above: that one is a COST ladder — canvas resolution, occluder cap, radius — so dropping it to lowest changes how much work the light does and not how bright it looks. The ladder runs a long way down because the complaint it answers was not that the light was slightly hot.')}
                {ctrlRow('Fog', onCycleFog,
                  stats.fogName ?? 'off',
                  'FOG OF WAR: darkness the player\'s light cuts through. The light layer is already the mask — a lit shape with shadows cut out of it — so the fog is composed FROM it and costs no geometry of its own: a tile\'s shadow stays dark, and a flashlight beam opens exactly the cone it lights. DIM and DARK are the two-layer version (lit or not). MEMORY is the traditional three layers — never seen, seen before but not lit now, and lit — which needs a per-map memory of where the ship has been (one texel per 48 world units, reset on every map load; it is the renderer\'s only piece of per-map persistent state, which is why it is its own rung rather than the default). A clear disc always surrounds the ship: a narrow beam points AWAY from it, so without that the hull sits in the dark it is holding the torch in. OFF is the default — this changes how the whole game reads, and which maps want it is a design question rather than a rendering one.')}
                {ctrlRow('Flashlight', onCycleFlashlight,
                  stats.flashlightName ?? 'radial',
                  'The player\'s light as a directional BEAM instead of a radial glow. Points along the AIM — the same angle shots travel — so the torch goes where the ship is looking and there is no second control to fight over. Widths are the full cone: half 180° (a headlight — everything ahead, nothing behind), wide 120°, beam 80°, narrow 45°, tight 25°, pin 12° (at which point the soft edge is as wide as the beam, so it reads as a spot with no boundary at all). RADIAL (default) is the shipped 360° glow and costs nothing extra. OFF is a zero-width beam rather than a special case: the player\'s light draws nothing, so what is left on the layer is exactly the emitters (to turn the whole layer off, use Lighting: legacy). The beam masks everything the player\'s light does — falloff, shadows and caustics — but NOT the secondary emitters, because a lit metal plate is its own light and radiates in every direction; that is what makes sweeping the beam past one read as the beam finding it. A body outside the cone is also skipped entirely, since a shadow runs radially outward and cannot reach into the beam — which is what makes a narrow beam cheaper than the radial light rather than merely darker.')}
                {ctrlRow('Light color', onCycleLightColor,
                  stats.lightColorName ?? 'ship',
                  'What COLOUR the player\'s light is. SHIP (default) is the engine-glow blue the layer has always used, chosen so the light reads as coming from the ship rather than as a new system announcing itself; white / warm / amber / green / violet / red are there because a flashlight is equipment and equipment has a character — a tungsten beam and a cold blue-white one light the same terrain into two different games. The colour reaches everything the player\'s light does, the REFRACTED cone included, which is right: light that passes through glass keeps the colour it arrived with. The secondary emitters are deliberately unaffected — they radiate the colour of the BODY, not of what lit it.')}
                {ctrlRow('Tint mix', onCycleTintMix,
                  stats.tintMixName ?? 'off',
                  'How much of the MATERIAL\'s colour rides the light it passes on. Light through green glass comes out green, and a body lit by a red torch cannot re-emit blue — the layer got both wrong in opposite directions: transmitted light carried the LIGHT\'s colour with no trace of the material, and an emitter carried the MATERIAL\'s with no trace of what lit it. One knob, two applications. Emission and the refracted caustic take a blend between the two colours (0 = the light\'s, 1 = the body\'s). Straight-through transmission is tinted by MULTIPLYING the umbra by the material colour, because that light is not drawn by the shadow pass — it is what the pass chose not to erase — so it can only be coloured after the fact; 0 changes nothing there. A true product everywhere is the physical answer and it reads too dark (two saturated colours multiply toward black), so a half blend is as far as it goes. SHIPS OFF: the effect is real but subtle, because the materials\' colours sit close to the light\'s (glass indigo, metal steel-blue, both against a sky-blue lamp), and the straight-through path costs a fill per translucent group to buy it.')}
                {ctrlRow('Emissive', onToggleEmissive,
                  stats.emissiveEnabled === true ? 'On' : 'Off',
                  'Do METAL and GLASS re-emit the light that falls on them? ON by default, after device testing. Every lit body of those materials becomes a SECOND light at its own position — half the light it received, uniform in every direction, falling off the way the player\'s does. It replaces the contact-driven glow those two materials used to carry, which lit up when something TOUCHED them rather than when light reached them, so a metal plate across the room stayed dead however brightly it was lit. Secondary lights cast no shadows of their own unless Emit shadow asks them to: each would need its own occluder collection, and the pool is shared and consumed per light, so N emitters cost N collections on the tightest budget in the system.')}
                {ctrlRow('World lights', onToggleWorldLights,
                  stats.worldLightsEnabled === true ? 'On' : 'Off',
                  'A6: do the self-luminous movers — shots and the snitch — light the unified layer in their own colours? These are not emitters: an emitter\'s brightness is what the player\'s light put ON it, where a shot glows because it is on fire, so a bolt lights the walls it passes whether or not the flashlight is pointed there. They spend what is LEFT of the tier\'s maxLights after the player and the emitters (the tier\'s number stays the whole frame\'s light count), budgeted nearest-to-screen-centre, and a light whose disc misses the screen is culled before it costs anything. They cast no shadows — a shadow thrown by a bolt is unreadable at any speed, and each shadowed light is a fresh occluder collection. Off restores the exact pre-A6 layer.')}
                {ctrlRow('Depth dark', onToggleDepthAmbient,
                  stats.depthAmbientEnabled === true ? 'On' : 'Off',
                  'A7: each stage DESCENDED adds the light tier\'s ambientPerStage of fog-darkness (capped at four stages), folded into the fog compositor — so it is cut by the player\'s light, respects shadows, and darkens the minimap\'s memory veil, all through the one mechanism. The hub is depth 0 and never darkens; darkness is a property of going down, not a global mood. When the Fog cycle is also on, whichever of the two wants the world darker wins, so a player already running dark fog only notices depth once it exceeds their setting.')}
                {ctrlRow('Emit bright', onCycleEmitBrightness,
                  stats.emitBrightnessName ?? '1/2',
                  'How much of the light it receives a body re-emits, as a fraction. Only has an effect while Emissive is on. It SCALES the variant\'s own emits value against the 1/2 baseline those variants are authored at, so the default is exactly what the table says and a future material that emits less than metal still emits less than metal. Clamped at 1 in the geometry: a body cannot radiate more light than fell on it, which is the one physical claim this feature rests on.')}
                {ctrlRow('Emit fade', onCycleEmitFade,
                  stats.emitFadeName ?? 'smooth',
                  'How long an emitter takes to FADE in or out. Only has an effect while Emissive is on. Emission FLASHED without this, and not because of its brightness: the emitter set is chosen nearest-first and capped by the tier, so a body crossing that budget was drawn at full strength on one frame and not at all on the next. Both frames were individually right; the swap is what reads as a strobe, and near-equal distances reorder constantly as the ship moves. So a halo now eases toward its alpha and OUTLIVES its selection — a body that drops out of the budget fades where it stood rather than vanishing, and a destroyed tile\'s halo fades out too. Off is the old instantaneous behaviour, kept as the control.')}
                {ctrlRow('Emit shadow', onToggleEmitShadows,
                  stats.emitShadowsEnabled === true ? 'On' : 'Off',
                  'May the SECONDARY lights cast shadows of their own? Off by default, and off for cost rather than correctness. Each shadowing emitter needs its OWN occluder collection — the pool is shared and consumed per light — and its own compositing surface, because destination-out drawn onto the accumulated layer would erase the light already there rather than only the emitter\'s share. So each one composites into a scratch canvas and blits its own box back. Note this is not a TERTIARY bounce: emitters do not light other emitters, since every emitter reads its brightness from the player light\'s falloff alone.')}
                {ctrlRow('Emit shd tier', onCycleEmitShadowTier,
                  stats.emitShadowTierName ?? 'std',
                  'How much shadowing the SECONDARY lights get, when Emit shadow is on — a cost ladder, not a look knob. Each rung moves the two things that drive the cost together: how many emitters shadow at all, and how much geometry each of those sees. Std (default) is 4 emitters at 12 occluders; lite and min step down to 2 and 1 for the cheap end; more and max go up to 6 and 8. Past the count an emitter still LIGHTS, flatly — the tier degrades the treatment and never the count, so a cheaper rung dims no part of the scene.')}
                {ctrlRow('Shadow soft', onCycleShadowSoftness,
                  stats.shadowSoftnessName ?? 'diffuse',
                  'Shadow-edge softness. A point light casts a perfectly HARD shadow, which is what made the first version read as a drawn line rather than as lighting. Softness here is an ANGLE, so the soft band WIDENS with distance from the caster the way a real area light\'s does — tight against the tile, spreading further out — rather than being a uniform blur. DIFFUSE is the default (k=10, four rungs softer than the soft this shipped at); off is the hard-edged original, kept as the control. The PASS COUNT scales with k — a wide band graded over the three passes that suit a narrow one would read as stripes — so the softest rungs cost the most, up to six passes per light.')}
                {ctrlRow('Shard shadows', onToggleShardShadows,
                  stats.shardShadowsEnabled === false ? 'Off' : 'On',
                  'Do MOBILE SHARDS cast shadows too, or only static tiles? Only has an effect while Lighting is unified. On by default: a shard is the same shard family as the tile it broke off and about twice its radius (measured 43.6 median against a tile\'s 22), so leaving them out makes debris read as transparent to a light that solid rock is not. Nebula shards are excluded either way — same soft cloud as a nebula tile. Shards are drawn from the DYNAMIC grid, so this is a second spatial query per light; turn it off to see what that costs.')}
                {ctrlRow('Refraction', onToggleRefraction,
                  stats.refractionEnabled === true ? 'On' : 'Off',
                  'ON by default, after device testing. Off: glass passes light STRAIGHT THROUGH at reduced brightness, which is right for a parallel-faced pane — a slab offsets a ray sideways but does not bend it, and a regular hexagon has three pairs of parallel faces. On (default): each exit face refracts by Snell\'s law and throws an additive cone along the DEVIATED direction, scaled by the Refr bright fraction and never above the source\'s own peak, while the straight-through path is withheld in full — so the light is moved rather than added and the toggle is a real A/B. Only the exit face is refracted (a real ray bends twice, and for parallel faces the two cancel), so this over-states the bend for a tile and is about right for a wedge-shaped shard. Past the critical angle nothing is transmitted at all. The question it existed to answer — whether a caustic is legible on a light layer rendered at a third of screen resolution — was answered on the device, which is why it now ships on.')}
                {ctrlRow('Caustic fade', onCycleCausticFade,
                  stats.causticFadeName ?? 'smooth',
                  'How hard the CAUSTIC edges are. Only has an effect while Refraction is on. Two separate cliffs sit behind one symptom — glass clicking as you drift slowly past it. TOTAL INTERNAL REFLECTION is a step: past the critical angle a face transmits nothing, so its cone used to appear and vanish at full length as the body turned. THE OCCLUDER CAP is a step: in a dense field the pool sits saturated (measured 24 of 24 on the glass showcase), so bodies swap in and out of it as you move and an entering body brought its whole caustic at once. Both now fade the cone\'s THROW rather than its alpha — every cone in a transmit group shares one fill, and since that fill is the light\'s own falloff gradient, a shorter cone is a dimmer one. Off restores both cliffs, and is the control the fix was measured against.')}
                {ctrlRow('Refr bright', onCycleRefractBrightness,
                  stats.refractBrightnessName ?? '1/2',
                  'How bright the REFRACTED cone is, as a fraction of the light\'s own peak. Only has an effect while Refraction is on. Named as fractions because that is the quantity the rule is stated in — refracted light is a redistribution of light that already lost some of itself passing through the body, so it can never out-shine the source, and the geometry clamps at 1/1 regardless of what is selected here. Starts at 1/2 — half the source, which was the original ceiling — and cycles UP first, because a caustic that cannot be seen cannot be judged.')}
                {ctrlRow('Joystick', onToggleJoystickDebug,
                  stats.joystickForceVisible === true ? 'Forced' : 'Touch',
                  'Onscreen touch joystick. Touch: the widget exists only while a thumb is on the glass — the normal behaviour, and why it never ghosts onto mouse or gamepad. Forced: draw it anyway, so its size and placement can be checked on a desktop browser.')}
                {ctrlRow('Goo bond', onToggleShardBlend,
                  stats.shardBlendEnabled === false
                    ? 'Off'
                    : `On · ${stats.shardBlendCount ?? 0}`,
                  'Bonded-pair blend. On: a live cohesion bond draws as ONE blob — each goo body enveloped in a skin of its own hull grown outward, joined by a waisted metaball bridge, all filled under the hulls so a plastic shard stuck to a tile or another shard reads as goo rather than two polygons touching. Only the GOO side is coated: plastic on a glass tile coats the plastic, never the tile. Off restores the un-blended look. Presentation only: the bond itself forms, coheres and breaks the same either way. The number is how many bonds drew something last frame, so a 0 with plastic on screen means nothing is bonded rather than that the pass is broken.')}
                {ctrlRow('Goo coat', onCycleShardCoat,
                  stats.shardCoatName ?? '1x',
                  'Thickness of the goo COAT around each bonded body, as a multiplier over the envelope its variant authors (plastic ships 0.18 of the shard\'s circumradius). Only has an effect while Goo bond is On. Cycles UP from the shipped value because the question it exists to answer is how much thicker it should be; at 6x a shard\'s coat is about as deep as its own radius, which is past useful on purpose — a range whose top is not too far cannot show you where too far is. The variant table stays the statement of how thick that material\'s goo is; this only scales it.')}
                {ctrlRow('Pl shade', onTogglePlasticAutomata,
                  stats.plasticAutomataEnabled === true ? 'On' : 'Off',
                  'Plastic-shard neighbour-brightness automata. On: palette base shade darkened by contact count (like nebula interior-darkening); Off: per-instance random shades.')}
                {ctrlRow('Shade dir', onTogglePlasticAutomataDirection,
                  stats.plasticAutomataBrighten === true ? 'Bright' : 'Dark',
                  'Plastic automata direction: Darken dense cluster interiors (default) or Brighten. Only affects rendering while Pl shade is On.')}
                {ctrlRow('Tile shade', onToggleMaterialAutomata,
                  stats.materialAutomataEnabled === true ? 'On' : 'Off',
                  'Material-tile neighbour-brightness automata (glass/metal/rock). On: dense cluster interiors shift brightness by same-variant hex-neighbour count (per-variant default: metal brightens, rock darkens); cluster edges and lone tiles stay at the base colour.')}
                {ctrlRow('Palette', onCyclePlasticPalette,
                  stats.plasticPaletteName ?? 'litegreen',
                  'Cycle the plastic-TILE palette family. Re-rolls every active plastic-tile colour on toggle. Plastic-shards have their own independent cycle (Shard pal).')}
                {ctrlRow('Shard pal', onCyclePlasticShardPalette,
                  stats.plasticShardPaletteName ?? 'litegreen',
                  'Cycle the plastic-SHARD palette family through the same list as the tile Palette button (independent index). Re-rolls every active plastic-shard colour on toggle so the change is immediate.')}
                {ctrlRow('P glow', onCyclePlasticGlowBrightness,
                  stats.plasticGlowBrightnessName ?? '1x',
                  'Cycle the plastic-tile proximity-glow brightness multiplier (1×–5×). Multiplies the variant peakAlpha so the green bloom lights up from farther away and reads brighter near contact. Plastic-shards are unaffected.')}
                {ctrlRow('Recolor', onTogglePlasticBlend,
                  stats.plasticBlendEnabled === false ? 'Off' : 'On',
                  'Toggle plastic colour equilibration. Off freezes plastic tiles + shards at their spawn/shatter colours; uses the same tile/shard blend alphas as nebula when on.')}
                {ctrlRow('Nebula', onCycleNebulaPalette,
                  stats.nebulaPaletteName ?? 'sky',
                  'Cycle the glass-side nebula palette through the same 11-entry list. Governs glass-tile shatter / merge dust ONLY (randomGlassNebulaComposition). Main background nebula tiles + shards, BG puffs, and NebulaSystem colour drift all stay on the legacy default palette and are NOT affected. Rock-side dust (rock tile original + regenerated + shards) is fixed at white. Default sky.')}
              </>)}

              {/* ── Shards & Physics ───────────────────────────────── */}
              {renderSectionHeader('shardsphys', 'Shards & Physics')}
              {!collapsed.shardsphys && (<>
                {ctrlRow('Local grav', onToggleLocalGravity,
                  stats.localGravityEnabled === false ? 'Off' : 'On',
                  'Toggle player↔asteroid local-gravity scan (PhysicsSystem.applyLocalGravity).')}
                {ctrlRow('Attract grav', onToggleAttractorGravity,
                  stats.attractorGravityEnabled === false ? 'Off' : 'On',
                  'Toggle attractor gravity scan (PhysicsSystem.applyGravity).')}
                {ctrlRow('Collisions', onToggleCollisions,
                  stats.collisionsEnabled === false ? 'Off' : 'On',
                  'Toggle the SAT collision broadphase. OFF is game-breaking — measurement aid only.')}
                {ctrlRow('Tile push', onToggleRepelPush,
                  stats.repelPushEnabled === false ? 'Off' : 'On',
                  'Toggle the tile repel PUSH (glass + metal tiles — the only variants with a repel field). OFF disables only the outward velocity shove; the tile glow still reacts to a nearby player/enemy.')}
                {ctrlRow('Shard grav', onToggleShardGravity,
                  stats.shardGravityEnabled === false ? 'Off' : 'On',
                  'Toggle shard↔shard gravity pull (attractedTo pass in ShardSystem.runMergeBroadphase). Today only nebula-shard has a non-none attractedTo.')}
                {ctrlRow('Bonding', onToggleShardBonding,
                  stats.shardBondingEnabled === false ? 'Off' : 'On',
                  'Toggle shard↔shard bond formation + cohesion. OFF drops existing bonds and prevents new ones — nebula self-compose and cross-variant absorb stop.')}
                {ctrlRow('Neb collide', onToggleNebulaShardCollisions,
                  stats.nebulaShardCollisionsEnabled === true ? 'On' : 'Off',
                  'Toggle hard SAT collisions between nebula-shard pairs (ignores their passThrough flag). Default OFF. A/B-test whether forcing nebula pairs to bounce breaks up large gather-piles.')}
                {ctrlRow('Plr↔neb', onTogglePlayerNebulaCollision,
                  stats.playerNebulaCollisionEnabled === false ? 'Off' : 'On',
                  'Player ↔ nebula-shard hard collision. On (default): the ship physically parts/scatters the cloud (bypasses nebula passThrough → SAT impulse). Off: glide-through with only the applyNebulaPlayerPull swirl.')}
                {ctrlRow('Sleep', onToggleShardSleep,
                  stats.shardSleepEnabled === false ? 'Off' : 'On',
                  'Toggle collision-sleep for mobile shards. ON: resting shards stop resolving against each other (the bulk of a settled field) until disturbed by an awake body. OFF resolves every pair every pass.')}
                {ctrlRow('Vp cull', onToggleShardViewportCull,
                  stats.shardViewportCullEnabled === false ? 'Off' : 'On',
                  'Toggle viewport-gated shard-pair cadence. ON: two offscreen shards resolve only on a periodic catch-up pass (~8× less often); any pair near the camera resolves every pass.')}
                {ctrlRow('Shard LOD', onToggleShardLod,
                  stats.shardLodEnabled === false ? 'Off' : 'On',
                  'Toggle shard render LOD. ON: shards too small for their polygon detail to read blit a cached solid disc instead of the full polygon. Purely visual — collision/physics unaffected.')}
                {ctrlRow('Merge rate', onToggleMergeRate,
                  stats.mergeRateEnabled === false ? 'Off' : 'On',
                  'Toggle the local-density merge/absorption rate. ON: shards in dense pockets merge & absorb faster, consolidating clusters into big rocks that condense to tiles. OFF holds a neutral 1.0×. See the merge-rate readout in Perf.')}
                {ctrlRow('Grace', onCycleShatterGrace,
                  stats.shatterGraceName ?? '0.6s',
                  'Cycle the hot-spot-collapse grace delay (0.6 → 3.6s, 0.6s steps). Freshly-shattered rock/glass shards are exempt from the overlap-collapse pass for this long so debris scatters instead of re-condensing. Applies to tiles destroyed after the change.')}
                {ctrlRow('Neb stretch', onCycleNebulaStretch,
                  stats.nebulaStretchName ?? '0.07',
                  'Cycle nebula-shard velocity-stretch stiffness (K on speed → stretch): off / 0.05 / 0.07 / 0.085 / 0.10. The squash axis aligns to velocity while the sprite keeps its own rotation.')}
                {ctrlRow('Shard↔tile', onToggleShardTileCollisions,
                  stats.shardTileCollisionsEnabled === true ? 'On' : 'Off',
                  'Toggle the mobile-shard ↔ static-tile collision pass.')}
                {ctrlRow('Pair int', onCycleShardPairInterval,
                  stats.shardPairInterval === 0
                    ? `auto (${stats.shardPairEffectiveInterval ?? 1})`
                    : `every ${stats.shardPairInterval ?? 1}`,
                  'Cycle the shard-pair resolution interval. AUTO scales N with shard-cell density; manual pins it.')}
                {ctrlRow('S↔T int', onCycleShardTilePairInterval,
                  stats.shardTilePairInterval === 0
                    ? `auto (${stats.shardTilePairEffectiveInterval ?? 1})`
                    : `every ${stats.shardTilePairInterval ?? 1}`,
                  'Cycle the shard ↔ static-tile interval. Only fires when Shard↔tile is ON.')}
                {ctrlRow('Tile blend', onCycleTileBlendAlpha,
                  blendLabel(stats.tileBlendAlpha),
                  'Cycle nebula tile→tile colour blend (tiles drift toward neighbour-hex weighted hue average each frame): Off / Slow / Med / Fast.')}
                {ctrlRow('Shard blend', onCycleShardBlendAlpha,
                  blendLabel(stats.shardBlendAlpha),
                  'Cycle nebula shard→nearest-tile colour blend (shards drift toward the nearest tile hue each frame): Off / Slow / Med / Fast.')}
                {ctrlRow('Blend int', onCycleColorBlendInterval,
                  stats.colorBlendFrameInterval === 0
                    ? `auto (${stats.colorBlendEffectiveInterval ?? 1})`
                    : `every ${stats.colorBlendFrameInterval ?? 1}`,
                  'Cycle the colour-equilibration cadence. AUTO scales with active-nebula count; manual values pin the interval. Higher = cheaper but slower visual blend.')}
              </>)}

              {/* ── Flow Field (asteroid/shard FF — DBG only) ──────── */}
              {renderSectionHeader('flowfield', 'Flow Field')}
              {!collapsed.flowfield && (<>
                {ctrlRow('Pattern', onCycleFFPattern,
                  stats.ffPatternName ?? 'Map',
                  'Cycle the base-flow pattern: Map (default) → Meander → Circular → Spiral → Well → WavyWell → Outward → Horiz → Vert → WavyH → WavyV. Re-bakes the asteroid field; kernel / tangent / breathing apply on top.')}
                {ctrlRow('Ast flow', onToggleAsteroidFlow,
                  stats.asteroidFlowEnabled === false ? 'Off' : 'On',
                  'Toggle the asteroid/shard flow-field velocity nudge. OFF: asteroids decay to zero velocity and from then on only move via collisions / gravity.')}
                {ctrlRow('Density', onCycleFFDensity,
                  `${stats.ffCellSize ?? 256}u`,
                  'Cycle the FF cell size (world units): 256 → 192 → 128 → 96 → 64 → 48 → 32. Each step rebuilds both flow grids. Pursuit-field BFS range is in cells, so finer densities reduce enemy long-range pathfinding.')}
                {ctrlRow('Kernel R', onCycleFFKernelR,
                  `R=${stats.ffKernelR ?? 3}`,
                  'Cycle the wall-repulsion kernel radius (cells): 0 → 1 → 2 → 3 → 4 → 5. R=0 is the legacy 4-cardinal scan (A/B baseline); R≥1 enables the (2R+1)² kernel with 1/d² falloff — wider kernels curve the flow earlier.')}
                {ctrlRow('Tangent', onCycleFFTangentMix,
                  (stats.ffTangentMix ?? 0.5).toFixed(2),
                  'Cycle the tangent-mix factor: 0.00 → 0.25 → 0.50 → 0.75 → 1.00. 0 = pure radial repulsion (saddle dead-zones at long walls); 1 = pure tangent (slide along walls, both sides flow the same way — no saddle).')}
                {ctrlRow('Breathe', onCycleFFBreathe,
                  !stats.ffBreatheRate ? 'Off'
                    : stats.ffBreatheRate < 0.2 ? 'Slow'
                    : stats.ffBreatheRate < 0.6 ? 'Med'
                    : 'Fast',
                  'Cycle the breathing scroll rate (off / slow / med / fast). Slowly undulates the asteroid flow so convergence/saddle zones drift over time and shard piles dissolve. Re-bakes on a throttled cadence.')}
                {ctrlRow('Lane', onCycleFFLaneJitter,
                  !stats.ffLaneJitter ? 'Off'
                    : stats.ffLaneJitter < 0.15 ? 'Low'
                    : stats.ffLaneJitter < 0.3 ? 'Med'
                    : 'High',
                  'Cycle per-shard lane jitter (off / low / med / high). Each shard gets a stable perpendicular offset to its flow target so shards ride parallel lanes instead of collapsing onto one streamline.')}
                {ctrlRow('Vec overlay', onToggleFFOverlayVectors,
                  stats.ffOverlayVectors === true ? 'On' : 'Off',
                  'Toggle asteroid/shard FF vector arrows. Per-cell unit vector, sampled at the Sample N stride. Pursuit field is intentionally not drawn.')}
                {ctrlRow('Sample N', onCycleFFOverlaySampleN,
                  `every ${stats.ffOverlaySampleN ?? 1}`,
                  'Cycle the vector-overlay sample stride: 1 → 2 → 4 → 8 → 16. Stride 1 draws every cell.')}
                {ctrlRow('Cells', onToggleFFOverlayCells,
                  stats.ffOverlayCells === true ? 'On' : 'Off',
                  'Toggle asteroid/shard FF cell outlines. Draws every cell so the grid resolution and seam are visible.')}
                {ctrlRow('Obstacles', onToggleFFOverlayObstacles,
                  stats.ffOverlayObstacles === true ? 'On' : 'Off',
                  'Toggle the FF obstacle bitmap tint. Red cells are blocked. Nebula tiles should NOT appear as obstacles (PR #54 filter).')}
                {ctrlRow('Rebuilds', onToggleFFOverlayRebuilds,
                  stats.ffOverlayRebuilds === true ? 'On' : 'Off',
                  'Toggle the FF Rebuilds overlay. Cells flash amber when re-baked by onTileDestroyed (destroyed cell + 4 cardinal neighbours). Fades over ~0.6 s.')}
              </>)}

              {perf && (<>
                {/* ── Perf (entity counts + frame-skip controller) ──── */}
                {renderSectionHeader('perf', 'Perf')}
                {!collapsed.perf && (<>
                  {statRow('enemies', perf.enemyCount)}
                  {statRow('asteroids', perf.asteroidCount)}
                  {statRow('projectiles', perf.projectileCount)}
                  {statRow('particles', perf.particleCount)}
                  {statRow('drops/POI', perf.interactableCount)}
                  {statRow('max cell', perf.maxCellDensity,
                    perf.maxCellDensity >= 20 ? 'text-red-400' : perf.maxCellDensity >= 10 ? 'text-amber-300' : 'text-white')}
                  {ctrlRow('Auto', onTogglePerfAuto,
                    stats.perfAutoEnabled === false ? 'Off' : 'On',
                    'Master AUTO toggle for the performance controller. ON: skippable passes self-throttle from the load signal. OFF: every AUTO task runs every step (manual Pair int / S↔T int / Blend int pins still apply).')}
                  <div className="flex justify-between">
                    <span>load</span>
                    <span className={perf.perfLoadLevel >= 0.82 ? 'text-red-400' : perf.perfLoadLevel >= 0.38 ? 'text-amber-300' : 'text-white'}>
                      {perf.perfLoadTier} ({Math.round(perf.perfLoadLevel * 100)}%)
                    </span>
                  </div>
                  {/* Dynamic (mobile) entity count — the throttle driver,
                      with the asleep / offscreen / LOD breakdown. */}
                  <div className="flex justify-between">
                    <span>dyn ents</span>
                    <span className="text-white">
                      {perf.perfDynamicCount}
                      {(perf.perfAsleepCount > 0 || perf.perfOffscreenShards > 0 || perf.perfLodShards > 0) && (
                        <span className="text-slate-500"> ({perf.perfAsleepCount} slp{perf.perfOffscreenShards > 0 ? `, ${perf.perfOffscreenShards} off` : ''}{perf.perfLodShards > 0 ? `, ${perf.perfLodShards} lod` : ''})</span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>merge rate{stats.mergeRateEnabled === false ? ' (off)' : ''}</span>
                    <span className={stats.mergeRateEnabled === false ? 'text-slate-500' : perf.perfMergeRateMult >= 2 ? 'text-emerald-400' : perf.perfMergeRateMult >= 1.3 ? 'text-amber-300' : 'text-white'}>
                      {perf.perfMergeRateMult.toFixed(2)}×
                    </span>
                  </div>
                  {/* Per-task effective frame-skip intervals.  "·N" = AUTO
                      effective N; "·N!" = manual pin.  1 = runs every step. */}
                  {perf.perfTasks?.map(t => (
                    <div key={t.id} className="flex justify-between">
                      <span>&nbsp;·{t.id}</span>
                      <span className={t.eff >= 8 ? 'text-amber-300' : 'text-white'}>
                        {t.eff}{t.manual >= 1 ? '!' : ''}
                      </span>
                    </div>
                  ))}
                </>)}

                {/* ── Timing (ms) ──────────────────────────────────── */}
                {renderSectionHeader('timing', 'Timing (ms)')}
                {!collapsed.timing && (<>
                  {statRow('updPhys', fmtMs(perf.updatePhysicsMs))}
                  {statRow(' ·physics', fmtMs(perf.physicsMs))}
                  {statRow('  ·grav', fmtMs(perf.gravityMs))}
                  {statRow('  ·lgrv', fmtMs(perf.localGravityMs))}
                  {statRow('  ·coll', fmtMs(perf.collisionsMs))}
                  {statRow(' ·ai', fmtMs(perf.aiMs))}
                  {statRow(' ·flow', fmtMs(perf.flowFieldMs))}
                  {statRow(' ·misc', fmtMs(perf.physMiscMs))}
                  {statRow('updLogic', fmtMs(perf.updateLogicMs))}
                  {statRow(' ·shards', fmtMs(perf.shardSysMs))}
                  {statRow(' ·rings', fmtMs(perf.explosionRingsMs))}
                  {statRow(' ·weapons', fmtMs(perf.weaponsMs))}
                  {statRow(' ·drops', fmtMs(perf.dropsMs))}
                  {statRow(' ·homing', fmtMs(perf.homingMs))}
                  {statRow(' ·lightn', fmtMs(perf.lightningMs))}
                  {statRow(' ·misc', fmtMs(perf.logicMiscMs))}
                  {statRow('render', fmtMs(perf.renderMs))}
                  {statRow(' ·neb', fmtMs(perf.nebulaMs))}
                  {statRow(' ·vis-neb', perf.nebulaVisible)}
                  {statRow(' ·neb fast/slow', `${perf.nebulaFast}/${perf.nebulaSlow}`)}
                  {statRow(' ·tLit', fmtMs(perf.tileLightingMs))}
                  {statRow(' ·tLit-N', perf.tileLightingCount)}
                  {statRow(' ·lit', fmtMs(perf.lightingMs))}
                  {statRow(' ·lit-N', perf.lightingLights)}
                  {statRow(' ·fog', fmtMs(perf.fogMs))}
                </>)}
              </>)}
    </div>
  );

  // Is a full-screen overlay up?  The scrims are translucent now, so the HUD
  // behind them is no longer hidden by opacity — and a score chip, wave
  // counter and pause button ghosting through a run summary reads as
  // double-vision, not as depth.  What the transparency is FOR is seeing the
  // MAP, so the DOM HUD steps aside while a menu is open.  (The canvas-drawn
  // minimap and loadout strip stay: those are part of the game view.)
  const overlayUp =
    stats.gameState === GameState.MENU ||
    stats.gameState === GameState.PAUSED ||
    stats.dock?.docked === true ||
    !!stats.runSummary ||
    !!stats.stageClear;

  return (
    /*  p-2, not p-4 (user call: "collapse the hud elements more to the top and
        bottom of the screen").  The in-game HUD is corner furniture — every
        px of padding is play area it takes out of the middle of the screen —
        while the full-screen overlays below carry their own p-4, so this
        only tightens the HUD.  The top stack gains 8px of headroom and the
        chevrons' top safe band (UI_CONSTANTS.INDICATORS.TOP_INSET) is sized
        against the result. */
    <div className="absolute inset-0 pointer-events-none p-2 flex flex-col justify-between">

      {!overlayUp && (<>

      {/* ── Top Bar ──
          A COLUMN, not a row (5d U2, audit finding A1).  The boss bar used to
          be an `absolute top-14` block and the chip stack a separate
          right-aligned column, so the two had no shared idea of the band they
          share: with a capstone alive the health bar landed exactly on top of
          the Salvage chip (measured overlap: 100% vertically, 104px
          horizontally at 390x844).  Putting both in one flex column hands the
          problem to the layout engine — the bar takes the width it needs, the
          chips start below whatever is left, and it holds at every viewport
          without a magic offset to keep in sync. */}
      <div className="flex flex-col gap-2" data-testid="hud-top">

      {/* Boss capstone bar — full width, above the readout row. */}
      {stats.gameState === GameState.PLAYING && stats.boss && (
        <div className="pointer-events-none w-full max-w-[560px] mx-auto px-1" data-testid="boss-bar">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span
              className={`${T_ROW} sm:text-[13px] font-extrabold uppercase tracking-[0.2em] drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] truncate min-w-0`}
              style={{ color: stats.boss.color }}
            >
              {stats.boss.name}
            </span>
            <span className="flex items-center gap-1.5 shrink-0">
              <span className="flex gap-1 items-center">
                {Array.from({ length: stats.boss.phaseCount }).map((_, i) => (
                  <span
                    key={i}
                    className="w-2 h-2 rounded-full border"
                    style={{
                      borderColor: stats.boss!.color,
                      background: i <= stats.boss!.phase ? stats.boss!.color : 'transparent',
                      opacity: i <= stats.boss!.phase ? 1 : 0.4,
                    }}
                  />
                ))}
              </span>
              <span
                className={`${T_ROW} sm:text-[13px] font-extrabold tabular-nums drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]`}
                style={{ color: stats.boss.color }}
              >
                {Math.ceil(stats.boss.healthFrac * 100)}%
              </span>
            </span>
          </div>
          {/* Thicker than a normal HUD bar on purpose — at phone scale a
              2px strip reads as decoration, not as the fight's state. */}
          <div className="h-3.5 sm:h-3 rounded-full bg-slate-900/85 border border-slate-500/70 overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
            <div
              className="h-full transition-[width] duration-150"
              style={{ width: `${stats.boss.healthFrac * 100}%`, background: stats.boss.color }}
            />
          </div>
          {stats.boss.shieldFrac > 0 && (
            <div className="h-1.5 mt-0.5 rounded-full bg-slate-900/70 overflow-hidden">
              <div
                className="h-full bg-cyan-300/90 transition-[width] duration-150"
                style={{ width: `${stats.boss.shieldFrac * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/*  ONE ROW ALONG THE UPPER EDGE (user call), not a left chip plus a
           right-hand STACK.  The readouts are peers — hull, score, salvage,
           wave — and stacking three of them drove the HUD band down the
           screen, which is also what the chevrons' top safe band has to
           clear.  They run along the edge instead and WRAP only when the
           window genuinely cannot hold them (320px does; 390 and up do not).
           The pause button stays outside the wrapping band and `shrink-0`,
           so it is pinned to the corner on the first line whatever the chips
           do — an unshrinkable middle is what evicted it at 320px in 5d. */}
      <div className="flex items-start gap-2">
        <div className="flex flex-wrap items-start gap-1.5 min-w-0 flex-1">
        {/* ── Player vitals (gauntlet 5d, U5) ──────────────────────────
            The top-left used to be empty (the debug menu moved into the
            pause Player Menu), and the player's hull was a floating bar
            drawn UNDER the ship — on top of the thing the player is
            actually looking at, and duplicated by the pause menu.  U5
            removed that bar, so this is now the canonical readout for the
            player's own condition, in the corner status conventionally
            lives in.  A BAR plus the number, because a bar answers "how
            close am I" at a glance and the number answers "how much have
            I got" when it matters.  Shield strip only when a Shield core
            is installed (maxShield is 0 on the lean start). */}
        {stats.gameState === GameState.PLAYING && stats.vitals && (() => {
          const v = stats.vitals!;
          const hp = v.maxHealth > 0 ? Math.max(0, Math.min(1, v.health / v.maxHealth)) : 0;
          const sh = v.maxShield > 0 ? Math.max(0, Math.min(1, v.shield / v.maxShield)) : 0;
          // The hull colour carries urgency — the one place in the HUD where
          // a number changing colour is the point rather than decoration.
          const hull = hp > 0.5 ? 'bg-emerald-400' : hp > 0.25 ? 'bg-amber-400' : 'bg-rose-500';
          const hullText = hp > 0.5 ? 'text-emerald-300' : hp > 0.25 ? 'text-amber-300' : 'text-rose-300';
          return (
            <div
              data-testid="player-vitals"
              /*  WIDTH IS A FLOOR, NOT A FIGURE (user call).  It was a fixed
                  w-[104px], which fits "100/100" and clips the moment hull
                  plating takes the pool into four digits — exactly when the
                  readout starts mattering.  min-w keeps the chip from
                  twitching narrower than a bar worth looking at; the content
                  takes it from there. */
              className={`pointer-events-none ${HUD_CHIP} border-slate-600/30 text-left min-w-[92px] w-auto shrink-0`}
            >
              {/*  NO WORD LABEL in the in-game chip (user call, one row along
                   the edge).  The band is width-bound at 390px and "HULL"
                   cost ~40px of it — the difference between the wave chip
                   fitting on the row and wrapping under it.  What the word
                   was doing is done by the BAR directly beneath: the hull
                   number and its bar carry the same three urgency colours as
                   the bar under the ship, and the shield pair below is cyan,
                   which is the shield's colour everywhere in this game.  The
                   pause menu's CONDITION block keeps the spelled-out
                   version, which is where an unfamiliar player is reading
                   rather than glancing. */}
              <div className="flex items-baseline justify-end">
                <span className={`${hullText} ${T_ROW} font-bold tabular-nums`}>
                  {v.health}<span className="text-slate-500">/{v.maxHealth}</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-800/90 overflow-hidden">
                <div className={`h-full ${hull} transition-[width] duration-150`} style={{ width: `${hp * 100}%` }} />
              </div>
              {v.maxShield > 0 && (
                <>
                  <div className="flex items-baseline justify-end mt-1">
                    <span className={`text-cyan-300 ${T_MICRO} font-bold tabular-nums`}>
                      {v.shield}<span className="text-slate-500">/{v.maxShield}</span>
                    </span>
                  </div>
                  <div className="mt-0.5 h-1 rounded-full bg-slate-800/90 overflow-hidden">
                    <div className="h-full bg-cyan-300/90 transition-[width] duration-150" style={{ width: `${sh * 100}%` }} />
                  </div>
                </>
              )}
            </div>
          );
        })()}

          {/* Readouts — only while playing */}
          {stats.gameState === GameState.PLAYING && (
            <>
              {/* Run score */}
              <div className={`pointer-events-none ${HUD_CHIP} border-slate-600/30`}>
                <span className={`text-amber-300 ${T_ROW} font-bold tracking-widest tabular-nums`}>
                  {(stats.score ?? 0).toLocaleString()} PTS
                </span>
              </div>
              {/* Salvage (money) — silver to match the field drop, distinct
                  from the gold score chip.  Flashes +N on pickup. */}
              <div className={`pointer-events-none ${HUD_CHIP} border-slate-600/30`}>
                <span className={`text-slate-200 ${T_ROW} font-bold tracking-widest tabular-nums`}>
                  ◈ {(stats.credits ?? 0).toLocaleString()}
                </span>
                {stats.salvageFlash && (
                  <span
                    className={`text-slate-50 ${T_ROW} font-extrabold tabular-nums ml-1.5`}
                    style={{ opacity: Math.max(0.25, stats.salvageFlash.fraction) }}
                  >
                    +{stats.salvageFlash.amount.toLocaleString()}
                  </span>
                )}
              </div>
              {/* Kill-combo multiplier — fades out as the window lapses */}
              {(stats.comboMultiplier ?? 1) > 1 && (
                <div
                  className="pointer-events-none text-right -mt-0.5"
                  style={{ opacity: Math.max(0.3, stats.comboFraction ?? 1) }}
                >
                  <span className="text-orange-400 text-sm font-extrabold tracking-wider tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                    ×{stats.comboMultiplier} combo
                  </span>
                  {(stats.comboCount ?? 0) > 0 && (
                    <span className={`text-orange-300/70 ${T_NOTE} font-bold ml-1`}>
                      {stats.comboCount} kills
                    </span>
                  )}
                </div>
              )}
              {/* Active status effects — e.g. CORROSION ×N / DISABLE, fading as it lapses */}
              {(stats.statusEffects ?? []).map(e => {
                const amber = e.kind === 'disable';
                return (
                <div
                  key={e.kind}
                  className={`pointer-events-none ${HUD_CHIP} ${amber ? 'border-amber-500/50' : 'border-lime-500/50'}`}
                  style={{ opacity: Math.max(0.45, e.fraction) }}
                >
                  <span className={`${T_BODY} font-extrabold uppercase tracking-widest tabular-nums ${amber ? 'text-amber-300' : 'text-lime-300'}`}>
                    {e.kind === 'disable' ? 'DISABLED' : `${e.kind} ×${e.stacks}`}
                  </span>
                </div>
              );})}
              {stats.wavesEnabled !== false && (
              <div
                onClick={isGrace ? onSkipWave : undefined}
                className={`${HUD_CHIP} transition-all ${
                  isGrace
                    ? 'pointer-events-auto border-emerald-500/60 cursor-pointer hover:bg-emerald-900/40 active:scale-95'
                    : 'pointer-events-none border-slate-600/50'
                }`}
              >
                {/*  "W1" rather than "WAVE 1", and a bare count rather than
                     "6 left": in a single-row band the wave chip is the one
                     that decides whether the row fits, and it was the widest
                     by 60px.  The colours carry what the words did — rose is
                     the enemy count everywhere in this HUD, cyan the clock —
                     and the tracking is what keeps the abbreviation legible
                     rather than cramped. */}
                <span className={`text-slate-300 ${T_ROW} font-bold uppercase tracking-wide`}>
                  W{stats.waveNumber ?? 1}
                  {stats.enemiesRemaining !== undefined && (
                    <span className="text-rose-300"> · {stats.enemiesRemaining}</span>
                  )}
                  {stats.waveElapsedSec !== undefined && (
                    <span className="text-cyan-300"> · {stats.waveElapsedSec}s</span>
                  )}
                </span>
                {isGrace && (
                  <p className={`text-emerald-400 ${T_NOTE} font-bold mt-0.5 animate-pulse`}>
                    Next in {stats.waveGraceTimer}s · tap to skip
                  </p>
                )}
              </div>
              )}
            </>
          )}
        </div>

          {/* Pause button — hidden while docked or dead (the station UI and
              the run-summary screen already freeze the sim and own the
              screen) */}
          {stats.gameState === GameState.PLAYING && !stats.dock?.docked && !stats.runSummary && (
            <button
              onClick={onPause}
              className={`pointer-events-auto shrink-0 bg-slate-900/35 hover:bg-slate-700/70 text-white rounded-lg p-2.5 ${TAP} min-w-[40px] flex items-center justify-center shadow-lg border border-slate-600/30 backdrop-blur-[2px] transition-all active:scale-95`}
              aria-label="Pause"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            </button>
          )}
      </div>

      </div>

      {/* No dock / portal BUTTON.  The interaction is selecting your own
          ship (tap / click, or E), and the prompt naming that control is
          drawn AT the ship by RenderSystem — one affordance, in the place the
          player is already looking.  A HUD pill on top of it was redundant. */}

      </>)}

      {/* ── Station UI (docked) ── */}
      {/* The sim is frozen while docked (loop short-circuit).  Panels are
          gated by the station's SERVICES: the HOME drydock hosts the hex
          flowers + inventory (drag-and-drop outfitting) + hull repair;
          shop stations sell module ITEMS into the inventory. */}
      {stats.gameState === GameState.PLAYING && stats.dock?.docked && (() => {
        const ps = stats.playerStats;
        const svc = stats.dock?.services;
        const canEdit = canEditInstalled;
        const hasShop = !!(svc?.shipShop || svc?.weaponShop);
        // What this station actually offers, in the order a docked player
        // wants it.  `stationTab` is a preference; this is the authority.
        const tabs: { id: 'shop' | 'outfit' | 'ship'; label: string }[] = [
          ...(hasShop ? [{ id: 'shop' as const, label: 'Shop' }] : []),
          { id: 'outfit' as const, label: 'Outfit' },
          { id: 'ship' as const, label: 'Ship' },
        ];
        const tab = tabs.some(t => t.id === stationTab) ? stationTab : tabs[0].id;
        const cargoUsed = (out?.inventory ?? []).filter(Boolean).length;
        const cargoCap = (out?.inventory ?? []).length;
        const needsRepair = !!svc?.repair && (stats.station?.missingHull ?? 0) > 0;
        return (
        <div
          /* No justify-center: on a scrollable flex column it clips
             overflowing content above the reachable scroll area; the inner
             wrapper's my-auto does the centering when content is short. */
          className={`absolute inset-0 ${OVERLAY_SCRIM} flex flex-col items-center pointer-events-auto z-50 p-4 overflow-y-auto overscroll-contain`} data-overlay="station">
          {/*  TOP-ALIGNED, not `my-auto` like the other overlays: this panel
               has a sticky header, and a vertically centred block puts that
               header in the middle of the screen whenever the active tab is
               shorter than the viewport — which, now that the tabs are
               short, is most of the time. */}
          <div className="w-full max-w-2xl flex flex-col gap-3">

            {/* ── STICKY HEADER (user call) ──────────────────────────────
                The balance used to be a row at the top of one long scroll
                and the shop was at the bottom of it, so buying meant
                scrolling up to read the money and back down to spend it.
                Money is relevant to every job on this screen — buying,
                selling, scrapping, repairing — so it does not scroll.  The
                same goes for CARGO, which is what a purchase actually
                consumes and which the shop could not see at all, and for
                UNDOCK, the way out.
                `-mx-4 px-4` bleeds the bar to the overlay's padding edges so
                content passing behind it is covered rather than showing in
                the gutters. */}
            <div className="sticky -top-4 z-20 -mx-4 px-4 pt-4 pb-2 bg-slate-950/95 backdrop-blur-sm flex flex-col gap-2 border-b border-slate-700/40">

              <div className="flex items-center justify-between gap-2">
                {/*  Smaller than the shared SCREEN_TITLE (a departure, so it
                     says why): this title now shares its line with UNDOCK,
                     and at 2xl "TRADE HUB" ellipsized to "TRADE H…".  A
                     station's name is how the player knows which services
                     they are looking at, so it gets to be complete rather
                     than large. */}
                <h2 className={`text-lg sm:text-xl font-bold tracking-[0.12em] truncate min-w-0 text-sky-300`}>
                  ⬡ {stats.dock?.name ?? 'STATION'}
                </h2>
                <button
                  onClick={onUndock}
                  data-testid="station-undock"
                  className={`${BTN_COMPACT} shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white tracking-widest uppercase flex items-center gap-1.5`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  Undock <span className={`text-emerald-200 ${T_NOTE} font-mono`}>[E]</span>
                </button>
              </div>

              {/* The two running totals every action on this screen spends.
                  `◈` is the money mark everywhere in this game; `⬢` is the
                  inventory tile, so cargo is named in the shape it is stored
                  in rather than in a word. */}
              <div className="flex items-center gap-3">
                <span className={`text-amber-300 ${T_ROW} font-bold tabular-nums`} data-testid="station-balance">
                  ◈ {(stats.credits ?? 0).toLocaleString()}
                </span>
                <span className={`${T_ROW} font-bold tabular-nums ${cargoUsed >= cargoCap ? 'text-rose-300' : 'text-slate-400'}`}>
                  ⬢ {cargoUsed}/{cargoCap}
                </span>
                {/* Repair is CONTEXTUAL: the commonest reason to dock, but
                    only while there is damage to pay for.  A permanently
                    disabled "HULL FULL" button in a header that never
                    scrolls away would be clutter that never resolves. */}
                {needsRepair && (
                  <button
                    disabled={!stats.station?.canRepair}
                    onClick={onRepairHull}
                    className={`${BTN_COMPACT} ml-auto shrink-0 ${
                      stats.station?.canRepair
                        ? 'bg-rose-700/60 hover:bg-rose-600/70 text-rose-100'
                        : 'bg-slate-800/60 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    Repair ◈{(stats.station?.fullRepairCost ?? 0).toLocaleString()}
                  </button>
                )}
              </div>

              {/* Tabs.  `flex-1` so they share the width evenly and stay
                  above the tap floor at 320px, where four of anything would
                  not fit — which is why REPAIR is a header action rather
                  than a fourth tab. */}
              <div className="flex gap-1.5" role="tablist">
                {tabs.map(t => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={tab === t.id}
                    data-testid={`station-tab-${t.id}`}
                    onClick={() => setStationTab(t.id)}
                    className={`${CHIP_BASE} flex-1 min-w-0 text-center ${
                      tab === t.id
                        ? 'bg-sky-600/30 border-sky-400/60 text-sky-100'
                        : CHIP_OFF
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── SHIP: condition + the full derived-stat breakdown ────── */}
            {tab === 'ship' && (
            <>
            {svc?.repair && (
            <div className={`${panelAccent('border-rose-600/30')} flex items-center justify-between gap-3 flex-wrap`}>
              <div className={T_ROW}>
                <h3 className={`text-rose-300 ${HEADING} mb-1`}>Hull Repair</h3>
                <span className="text-slate-400">Hull </span>
                <span className="text-white font-bold tabular-nums">{ps?.health ?? 0} / {ps?.maxHealth ?? 100}</span>
                <span className={`text-slate-500 ml-2 ${T_NOTE}`}>◈{stats.station?.repairCostPerHp ?? 0}/HP · partial repair if short</span>
              </div>
              <button
                disabled={!stats.station?.canRepair}
                onClick={onRepairHull}
                className={`${BTN_COMPACT} ${
                  stats.station?.canRepair
                    ? 'bg-rose-700/60 hover:bg-rose-600/70 text-rose-100'
                    : 'bg-slate-800/60 text-slate-500 cursor-not-allowed'
                }`}
              >
                {(stats.station?.missingHull ?? 0) <= 0
                  ? 'HULL FULL'
                  : `REPAIR ◈${(stats.station?.fullRepairCost ?? 0).toLocaleString()}`}
              </button>
            </div>
            )}

            {/* Full derived-stat set with per-module attribution (A2) — the
                same shared widget the pause menu shows, so an outfitting
                change here can be read back immediately. */}
            {renderShipStatus()}
            </>
            )}

            {/* ── OUTFIT: the two flowers, the inventory, the detail strip ──
                Modules FUNCTION only while their adjacency requirement is met
                (engine⇢hull, thrusters⇢engine, shield/plating⇢hull,
                capacitor⇢shield, weapon-mods⇢gun; hull + guns are the roots).
                Drag tiles between the inventory and the flowers — drydock
                only. */}
            {tab === 'outfit' && out && (
              <div className={`${panelAccent('border-sky-600/30')} flex flex-col gap-2`}>
                {!canEdit && (
                  <p className={`text-slate-500 ${T_NOTE} text-center -mb-1`}>
                    No drydock here — outfitting is locked. Swap modules at the <span className="text-sky-400 font-bold">Home Station</span>.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2 justify-items-center">
                  {renderHexGroup('ship', 'Ship Systems', 'text-sky-300', '#0284c7', true)}
                  {renderHexGroup('weapon', 'Weapon Systems', 'text-violet-300', '#7c3aed', true)}
                </div>

                {/* Inventory — a honeycomb of hex tiles (same tile language
                    as the install flowers): purchases land here; drag a tile
                    onto a flower hex to install it, or tap for sell/scrap. */}
                {renderInventoryHex(true)}

                {/* Detail strip — tap fallback for install/remove/sell (drag works too) */}
                {renderModuleDetail('station')}
              </div>
            )}

            {/* ── SHOP: items are fixed Mk varieties (no upgrades); a
                purchase lands in the inventory, which is why the header
                carries the cargo count beside the money. */}
            {tab === 'shop' && out && hasShop && (
              <div className={`${panelAccent('border-amber-600/30')} flex flex-col gap-3`}>
                {/*  A purchase needs a free cargo tile, and `purchaseModule`
                     silently rejects without one.  Saying so beats a button
                     that looks affordable and does nothing. */}
                {cargoUsed >= cargoCap && (
                  <p className={`text-rose-300 ${T_NOTE} text-center`}>
                    Cargo is full — scrap or install something before buying.
                  </p>
                )}
                {(['ship', 'weapon'] as const).filter(g => (g === 'ship' ? svc?.shipShop : svc?.weaponShop)).map(g => (
                  <div key={g}>
                    <h3 className={`${HEADING} mb-2 ${g === 'ship' ? 'text-sky-300' : 'text-violet-300'}`}>
                      Shop · {g === 'ship' ? 'Ship Modules' : 'Weapon Modules'}
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {out.catalog.filter(c => c.group === g).map(c => (
                        <button
                          key={c.id}
                          disabled={!c.affordable || cargoUsed >= cargoCap}
                          onClick={() => onPurchaseModule?.(c.id)}
                          title={`${c.desc} — bought into the inventory`}
                          className={`${BTN_COMPACT} flex items-center justify-between gap-2 ${
                            c.affordable && cargoUsed < cargoCap
                              ? 'bg-violet-700/40 hover:bg-violet-600/60 text-violet-100'
                              : 'bg-slate-800/60 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          <span className="font-bold">{c.label}</span>
                          <span className="tabular-nums">◈{c.cost.toLocaleString()}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
        );
      })()}

      {/* Drag ghost — fixed-positioned, shared by the station UI and the
          pause cargo panel. */}
      {renderDragGhost()}

      {/* ── Stage clear (boss capstone down) ── */}
      {/* Sim frozen while up (loop short-circuit), but the player is ALIVE —
          so this is a pause with a payoff report, not an ending.  Dismissing
          returns to the cleared arena where two rifts are waiting. */}
      {stats.stageClear && (() => {
        // Fades in (the engine already held the screen back for
        // BOSS_CONSTANTS.STAGE_CLEAR_DELAY_SEC so the explosion could land).
        const sc = stats.stageClear;
        const row = (label: string, value: React.ReactNode, note?: string) => (
          <div className="flex items-baseline justify-between gap-2 py-1 border-b border-slate-700/40 last:border-0">
            <span className={`text-slate-400 ${T_BODY} uppercase tracking-widest`}>{label}</span>
            <span className="text-right">
              <span className={`text-white font-bold tabular-nums ${T_ROW}`}>{value}</span>
              {note && <span className={`text-slate-500 ${T_NOTE} ml-1.5`}>{note}</span>}
            </span>
          </div>
        );
        return (
          <div
            style={OVERLAY_FADE_IN}
            className={`absolute inset-0 ${OVERLAY_SCRIM} flex flex-col items-center pointer-events-auto z-50 p-4 overflow-y-auto overscroll-contain`} data-overlay="stage-clear"
          >
            <style>{OVERLAY_KEYFRAMES}</style>
            <div className="w-full max-w-sm flex flex-col gap-4 my-auto">

              <div className="text-center">
                <h2 className={`${OUTCOME_TITLE} text-amber-300`}>STAGE {sc.stage}</h2>
                <p className={`text-emerald-300 ${T_ROW} font-bold uppercase tracking-[0.2em] mt-1`}>Cleared</p>
                <p className={`text-slate-500 ${T_BODY} uppercase tracking-widest mt-1`}>
                  {sc.bossName} destroyed · {sc.mapName}
                </p>
              </div>

              {/* Salvage leads — it is the money, and it is what the shop
                  speaks.  Score is a separate performance metric that buys
                  nothing, so it is labelled as such and sits below. */}
              <div className={`${PANEL} flex flex-col`}>
                {row('Salvage', `◈${sc.salvageCredits.toLocaleString()}`, 'sprayed on the wreck')}
                {row('Score', `+${sc.scoreAwarded.toLocaleString()}`)}
              </div>

              {/* Capstone reward: a module you carry away. */}
              {(sc.rewardLabel || sc.rewardCredits) && (
                <div className="bg-emerald-950/40 border border-emerald-600/40 rounded-lg p-3">
                  <p className={`text-emerald-300 ${HEADING} mb-1`}>
                    Salvaged from the wreck
                  </p>
                  {sc.rewardLabel ? (
                    <>
                      <p className={`text-white font-bold ${T_ROW}`}>{sc.rewardLabel}</p>
                      {sc.rewardDesc && <p className={`text-slate-400 ${T_BODY} mt-0.5`}>{sc.rewardDesc}</p>}
                      <p className={`text-slate-500 ${T_NOTE} mt-1`}>In your cargo — install it at a drydock.</p>
                    </>
                  ) : (
                    <>
                      <p className={`text-white font-bold ${T_ROW}`}>◈{(sc.rewardCredits ?? 0).toLocaleString()}</p>
                      <p className={`text-slate-400 ${T_BODY} mt-0.5`}>Cargo was full — the module was scrapped for its value.</p>
                    </>
                  )}
                </div>
              )}

              {/* The choice is IN THE WORLD, not on this screen.  The DESCENT
                  rift is switched off for now (user call — that flow is being
                  reworked), so this says what is actually true of the arena
                  the player is about to be returned to: the ladder is done and
                  the way out is the rift they arrived through.  The copy is
                  the first thing that would lie if it were left promising an
                  amber rift that no longer opens. */}
              <div className={`${panelAccent('border-amber-600/30')} ${T_BODY} leading-relaxed text-slate-300`}>
                <p className={`text-amber-300 ${HEADING} mb-1.5`}>The arena is quiet</p>
                <p>
                  No further waves will start here. Mop up what is left, then take the
                  {' '}<span className="text-sky-300 font-bold">sky rift</span> home to repair, sell and refit.
                </p>
              </div>

              <button
                onClick={onDismissStageClear}
                data-testid="stage-continue"
                className={BTN_PRIMARY}
              >
                Continue
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Death / run summary (Phase 3 Pair A) ── */}
      {/* The sim is frozen while `runSummary` is present (loop short-circuit,
          same as the docked station), so the wreck field stays drawn behind
          this overlay.  Presentation only: RESPAWN is the auto-respawn that
          used to fire on its own, so dying still costs nothing but time —
          the death PENALTY question belongs to the economy tuning pass. */}
      {stats.runSummary && (() => {
        const rs = stats.runSummary;
        const mm = Math.floor(rs.timeSec / 60);
        const ss = rs.timeSec % 60;
        const row = (label: string, value: React.ReactNode, note?: string) => (
          <div className="flex items-baseline justify-between gap-2 py-1 border-b border-slate-700/40 last:border-0">
            <span className={`text-slate-400 ${T_BODY} uppercase tracking-widest`}>{label}</span>
            <span className="text-right">
              <span className={`text-white font-bold tabular-nums ${T_ROW}`}>{value}</span>
              {note && <span className={`text-slate-500 ${T_NOTE} ml-1.5`}>{note}</span>}
            </span>
          </div>
        );
        return (
          <div
            style={OVERLAY_FADE_IN}
            className={`absolute inset-0 ${OVERLAY_SCRIM} flex flex-col items-center pointer-events-auto z-50 p-4 overflow-y-auto overscroll-contain`} data-overlay="death"
          >
            <style>{OVERLAY_KEYFRAMES}</style>
            <div className="w-full max-w-sm flex flex-col gap-4 my-auto">

              <div className="text-center">
                <h2 className={`${OUTCOME_TITLE} text-rose-400`}>DESTROYED</h2>
                <p className={`text-slate-500 ${T_BODY} uppercase tracking-widest mt-1`}>{rs.mapName}</p>
              </div>

              {/* Headline — the run's performance metric, big. */}
              <div className={`${panelAccent('border-amber-600/30')} text-center`}>
                <div className={`text-amber-300 ${HEADING}`}>Score</div>
                <div className="text-amber-200 text-4xl font-black tabular-nums leading-tight">
                  {rs.score.toLocaleString()}
                </div>
                {rs.bestCombo > 1 && (
                  <div className={`text-slate-400 ${T_BODY} mt-0.5`}>
                    best combo <span className="text-amber-300 font-bold tabular-nums">×{rs.bestCombo}</span>
                  </div>
                )}
              </div>

              <div className={`${PANEL} flex flex-col`}>
                {rs.wavesEnabled && row('Waves cleared', rs.wavesCleared, `high ${rs.highestWave}`)}
                {row('Enemies destroyed', rs.kills.toLocaleString(), rs.bosses > 0 ? `${rs.bosses} boss${rs.bosses > 1 ? 'es' : ''}` : undefined)}
                {/* Salvage reads as a ledger for THIS life: what the sortie
                    brought in, what the wreck cost, what's left.  The run
                    gross keeps climbing and isn't the question being asked at
                    the wreck, so it's demoted to a note on the earned row. */}
                {row('Salvage earned',
                     `◈${rs.creditsEarnedLife.toLocaleString()}`,
                     'since last death')}
                {rs.creditsLost > 0 && (
                  <div className="flex items-baseline justify-between gap-2 py-1 border-b border-slate-700/40 last:border-0">
                    <span className={`text-rose-400/90 ${T_BODY} uppercase tracking-widest`}>Salvage lost</span>
                    <span className="text-right">
                      <span className={`text-rose-300 font-bold tabular-nums ${T_ROW}`}>−◈{rs.creditsLost.toLocaleString()}</span>
                      {rs.creditsLostRun > rs.creditsLost && (
                        <span className={`text-slate-500 ${T_NOTE} ml-1.5`}>◈{rs.creditsLostRun.toLocaleString()} this run</span>
                      )}
                    </span>
                  </div>
                )}
                {row('Salvage held', `◈${rs.credits.toLocaleString()}`, 'after loss')}
                {row('Run time', `${mm}:${String(ss).padStart(2, '0')}`)}
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={onRespawn}
                  data-testid="death-respawn"
                  className={BTN_PRIMARY}
                >
                  Respawn
                </button>
                <p className={`text-slate-500 ${T_NOTE} text-center -mt-1`}>
                  Continue this run — hull restored at the {rs.mapName} spawn. Score and outfit are kept
                  {rs.creditsLost > 0
                    ? `; the wreck cost you ◈${rs.creditsLost.toLocaleString()} of your unspent Salvage${rs.credits === 0 ? ' — all of it' : ''}.`
                    : '.'}
                </p>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    onClick={onRestartRun}
                    data-testid="death-restart"
                    className={BTN_SECONDARY}
                  >
                    Restart Run
                  </button>
                  <button
                    onClick={onQuitToMenu}
                    data-testid="death-menu"
                    className={BTN_SECONDARY}
                  >
                    Main Menu
                  </button>
                </div>
              </div>

            </div>
          </div>
        );
      })()}

      {/* ── Main Menu ── */}
      {/* Condensed to exactly three controls (user call): DIFFICULTY, START,
          and a collapsed debug dropdown holding the map / enemy-test buttons.
          The run always begins on the OVERWORLD hub now — map choice is a
          debug override, not a front-door decision, so the menu no longer
          asks for one.

          LAYOUT: a fixed-width column centred by `my-auto` inside a
          scrollable flex column — NOT `justify-center`, which clips content
          above the reachable scroll area once the debug dropdown is open (the
          same trap the station and pause panels document).  So the two
          controls that matter sit dead centre at every screen size, and an
          expanded debug list scrolls instead of pushing START off-screen. */}
      {stats.gameState === GameState.MENU && (
        <div className={`absolute inset-0 ${OVERLAY_SCRIM} flex flex-col items-center pointer-events-auto z-50 overflow-y-auto overscroll-contain p-6`} data-overlay="menu">
          <div className="w-full max-w-xs flex flex-col items-center gap-8 my-auto">

            <div className="text-center">
              {/* Steps down on a 320px screen, where 48px monospace-ish
                  display type runs edge to edge. */}
              <h1 className="text-4xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500 tracking-tight drop-shadow-lg">
                OMNIVERSE
              </h1>
              {/* Build version — short git SHA + UTC build time, baked in at
                  build time by vite.config.ts.  Lets you tell at a glance
                  whether a deployed preview is running the latest commit. */}
              <div className="mt-2 font-mono text-[10px] tracking-widest text-slate-500">
                build {__APP_VERSION__} · {__BUILD_TIME__.slice(0, 16).replace('T', ' ')}Z
              </div>
            </div>

            <div className="w-full flex flex-col items-center gap-3">
              <span className="text-slate-200 text-sm tracking-wide">Difficulty</span>
              {/* A 4-up grid rather than a flex row: the buttons then divide
                  the column's width instead of setting it, so the row can
                  never overflow a narrow screen. */}
              <div className="w-full grid grid-cols-4 gap-2">
                {[0, 1, 2, 3].map(level => (
                  <button
                    key={level}
                    onClick={() => onSetDifficulty && onSetDifficulty(level)}
                    className={`${CHIP_BASE} ${
                      difficulty === level
                        ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg'
                        : `${CHIP_OFF} hover:border-indigo-400`
                    }`}
                  >
                    {level === 0 ? 'None' : level === 1 ? 'Low' : level === 2 ? 'Med' : 'High'}
                  </button>
                ))}
              </div>
            </div>

            {/* Controls — the choice made at game start (user directive).
                Sits with DIFFICULTY because it is the same kind of thing: a
                preference that shapes the whole run and survives restarts. */}
            <div className="w-full flex flex-col items-center gap-3">
              <span className="text-slate-200 text-sm tracking-wide">Controls</span>
              {renderSchemePicker()}
              {/* Also here, not only in the pause menu: this is where a
                  player sets their hands up before playing, and the pause
                  menu's copy sits below the whole outfitting panel — far
                  enough down a long scroll to read as missing. */}
              {renderAdaptiveTriggers()}
            </div>

            <button
              data-testid="menu-start"
              onClick={onStart}
              /* DELIBERATE DEPARTURE from BTN_PRIMARY (5d U2).  Every other
                 primary button means "carry on playing" inside a run and wears
                 the shared emerald; START is the one HERO control in the game
                 — the front door, sitting under an indigo title and an indigo
                 difficulty row — and hero is a different job from primary.
                 Kept indigo and rounded-full; the tap floor is shared. */
              className={`w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xl font-bold py-4 rounded-full ${TAP} shadow-2xl transition-all transform hover:scale-105 active:scale-95`}
            >
              START
            </button>

            {/* Controls & basics — the same widget the pause menu shows.
                Collapsed by default: the front door stays DIFFICULTY / START,
                and help is one tap away rather than in the way. */}
            <div className="w-full text-center">
              <button
                data-testid="menu-help-toggle"
                onClick={() => toggleSection('menuhelp')}
                className={`${SECTION_TOGGLE} text-sky-300/80 hover:text-sky-200`}
              >
                Controls &amp; Basics {collapsed.menuhelp ? '▸' : '▾'}
              </button>
              {!collapsed.menuhelp && (
                <div className={`mt-2 w-full ${PANEL_OPAQUE} border border-sky-500/30 rounded-lg px-3 py-3`}>
                  {renderHelpPanel()}
                </div>
              )}
            </div>

            {/* Debug dropdown — the map picker and enemy test rows, collapsed
                by default so they are reachable without being a front-door
                choice.  Same PANEL_OPAQUE treatment as the pause menu's Debug
                Menu, for the same reason: dense rows over a live map. */}
            <div className="w-full text-center">
              <button
                data-testid="menu-debug-toggle"
                onClick={() => toggleSection('menudebug')}
                className={`${SECTION_TOGGLE} text-amber-400/80 hover:text-amber-300`}
              >
                Debug Menu {collapsed.menudebug ? '▸' : '▾'}
              </button>
              {!collapsed.menudebug && (
                <div className={`mt-3 w-full ${PANEL_OPAQUE} border border-amber-500/30 rounded-lg px-3 py-3 flex flex-col items-center gap-5`}>
                  {renderTestPanel()}
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ── Player Menu (pause) ── */}
      {stats.gameState === GameState.PAUSED && (() => {
        const ps = stats.playerStats;
        const statLine = (label: string, value: React.ReactNode) => (
          <div className="flex justify-between gap-2">
            <span className="text-slate-400">{label}</span>
            <span className="text-white font-bold tabular-nums">{value}</span>
          </div>
        );
        return (
        <div
          /* No justify-center: on a scrollable flex column it clips
             overflowing content above the reachable scroll area; the inner
             wrapper's my-auto does the centering when content is short. */
          className={`absolute inset-0 ${OVERLAY_SCRIM} flex flex-col items-center pointer-events-auto z-50 p-4 overflow-y-auto overscroll-contain`} data-overlay="pause">
          <div className="w-full max-w-2xl flex flex-col gap-4 my-auto">

            <div className="flex items-center justify-between gap-3">
              <h2 className={`${SCREEN_TITLE} text-white`}>PLAYER MENU</h2>
              <span className={`text-amber-300 ${T_ROW} font-bold tabular-nums shrink-0`}>◈ {(stats.credits ?? 0).toLocaleString()}</span>
            </div>

            <div className="flex gap-3">
              <button
                onClick={onResume}
                className={`flex-1 ${BTN_PRIMARY} flex items-center justify-center gap-2`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                CONTINUE
              </button>
              <button
                onClick={onRestart}
                className={`flex-1 ${BTN_SECONDARY} hover:bg-red-600 hover:text-white flex items-center justify-center gap-2`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 12" /><path d="M3 3v9h9" /></svg>
                RESTART
              </button>
            </div>

            {/* Live pools (the two stats that MOVE in flight) — the derived
                per-module breakdown lives in the shared Ship Status widget
                right below. */}
            <div className={PANEL}>
              <h3 className={`text-sky-300 ${HEADING} mb-2`}>Condition</h3>
              <div className={`flex flex-col gap-1 ${T_ROW}`}>
                {statLine('Hull', `${ps?.health ?? 0} / ${ps?.maxHealth ?? 100}`)}
                {statLine('Shield', `${ps?.shield ?? 0} / ${ps?.maxShield ?? 0}`)}
                {statLine('Weight', `${(ps?.shipWeight ?? 0).toFixed(1)}`)}
                {statLine('Location', (
                  <>
                    {stats.currentMapName}
                    <span className={`text-slate-500 font-normal ml-1.5 ${T_NOTE}`}>
                      {ps ? `${ps.position.x}, ${ps.position.y}` : ''}
                    </span>
                  </>
                ))}
              </div>
            </div>

            {/* Full derived-stat set with per-module attribution (A2) —
                the SAME widget the docked station shows. */}
            {renderShipStatus()}

            {/* Modules & cargo — the same hex-tile language as the station
                UI, but the flowers are READ-ONLY (no drag source, no drop
                target: outfitting is drydock-only).  The inventory stays
                fully live: drag to rearrange, tap a tile to SCRAP it for
                9% anywhere (sell-back at 90% needs a station). */}
            {stats.outfitting && (
              <div className={`${PANEL} flex flex-col gap-2`}>
                <div className="grid grid-cols-2 gap-2 justify-items-center">
                  {renderHexGroup('ship', 'Ship Systems', 'text-sky-300', '#0284c7', false)}
                  {renderHexGroup('weapon', 'Weapon Systems', 'text-violet-300', '#7c3aed', false)}
                </div>
                {renderInventoryHex(false)}
                {renderModuleDetail('pause')}
              </div>
            )}

            {/* Commerce lives at the stations (economy-pivot 1e): shops
                sell to the inventory; outfitting needs a docked drydock. */}
            <p className={`text-slate-500 ${T_BODY} text-center`}>
              Buy modules at the <span className="text-emerald-400 font-bold">Shipwright</span> / <span className="text-purple-400 font-bold">Armory</span>; outfit &amp; repair at the <span className="text-sky-400 font-bold">Home Station</span> drydock.
            </p>

            {/* Controls — changeable mid-run, so picking wrong at the front
                door costs a tap rather than a restart. */}
            <div className={`${PANEL} flex flex-col gap-2`}>
              <h3 className={`text-sky-300 ${HEADING}`}>Controls</h3>
              {renderSchemeDropdown()}
              {renderAdaptiveTriggers()}
            </div>

            {/* Controls & basics — the same widget the main menu shows, so
                the answer is in the same words wherever you look for it. */}
            <div className="text-center">
              <button
                data-testid="pause-help-toggle"
                onClick={() => toggleSection('pausehelp')}
                className={`${SECTION_TOGGLE} text-sky-300/80 hover:text-sky-200`}
              >
                Controls &amp; Basics {collapsed.pausehelp ? '▸' : '▾'}
              </button>
              {!collapsed.pausehelp && (
                <div className={`mt-2 mx-auto w-full max-w-xs ${PANEL_OPAQUE} border border-sky-500/30 rounded-lg px-3 py-3`}>
                  {renderHelpPanel()}
                </div>
              )}
            </div>
            {/* Audio — master volume + mute.  One row by design: Pair A is
                developing the overlay's structural UI in parallel, so this
                pass keeps its footprint to a single settings strip. */}
            <div className={`mx-auto w-full max-w-xs flex items-center gap-3 ${PANEL_ROW}`}>
              <button
                onClick={onToggleMute}
                aria-label={stats.audio?.muted ? 'Unmute' : 'Mute'}
                className={`pointer-events-auto cursor-pointer shrink-0 w-10 ${TAP} rounded-md
                           bg-slate-800/80 border border-slate-600/60 text-base
                           hover:bg-slate-700/80 active:bg-slate-600/80`}
              >
                {stats.audio?.muted ? '🔇' : '🔊'}
              </button>
              <input
                type="range" min={0} max={100} step={1}
                value={Math.round((stats.audio?.volume ?? 0.7) * 100)}
                onChange={e => onSetVolume?.(Number(e.target.value) / 100)}
                aria-label="Master volume"
                className={`pointer-events-auto cursor-pointer flex-1 accent-sky-400 ${TAP}
                           disabled:opacity-40`}
                disabled={stats.audio?.muted === true}
              />
              <span className={`shrink-0 w-10 text-right text-slate-400 ${T_BODY} tabular-nums`}>
                {stats.audio?.muted ? '—' : `${Math.round((stats.audio?.volume ?? 0.7) * 100)}%`}
              </span>
            </div>

            {/* Recorded-take audition.  Turning the synth DRAFTS off is the
                only way to judge real assets honestly: with a draft under
                every id, a sound that is still synthetic is indistinguishable
                from one that landed, and the coverage count says how much of
                the game goes quiet when they are off. */}
            <div className={`mx-auto w-full max-w-xs flex items-center gap-3 ${PANEL_ROW}`}>
              <button
                onClick={onToggleDrafts}
                aria-label={stats.audio?.drafts ? 'Turn synth drafts off' : 'Turn synth drafts on'}
                className={`pointer-events-auto cursor-pointer shrink-0 px-2 ${TAP} rounded-md ${T_BODY}
                            font-semibold border ${stats.audio?.drafts
                              ? 'bg-slate-800/80 border-slate-600/60 text-slate-200'
                              : 'bg-emerald-900/60 border-emerald-500/50 text-emerald-200'}`}
              >
                {stats.audio?.drafts ? 'Drafts ON' : 'WAV only'}
              </button>
              <span className={`flex-1 ${T_BODY} leading-tight text-slate-400`}>
                {stats.audio?.drafts
                  ? 'Synth drafts fill every sound with no .wav yet.'
                  : 'Only recorded .wav files sound. Everything else is silent.'}
              </span>
              <span className={`shrink-0 text-right text-slate-300 ${T_BODY} tabular-nums`}>
                {stats.audio?.sampled ?? 0}/{stats.audio?.total ?? 0}
              </span>
            </div>

            {/* Output-latency READOUT (playtest: "sounds feel slightly
                delayed").  The engine side is measured tight — tap → play()
                is 3-5ms and every reactive draft is audible within ~3ms — so
                when sound feels late, this device number is where the time
                goes: ~30-45ms is a wired/speaker path, 150-250ms means a
                Bluetooth route, which no code path can shorten. */}
            {stats.audio?.latencyMs != null && (
              <div className={`mx-auto w-full max-w-xs text-center ${T_MICRO} text-slate-500 tabular-nums`}>
                audio output latency ~{stats.audio.latencyMs}ms
                {stats.audio.latencyMs >= 120 ? ' (Bluetooth?)' : ''}
              </div>
            )}

            {/* A filename that matches no sound id is invisible otherwise —
                it looks exactly like an id nobody has recorded yet. */}
            {stats.audio && stats.audio.unmatched.length > 0 && (
              <div className="mx-auto w-full max-w-xs px-3 py-2 rounded-lg
                              bg-amber-950/40 border border-amber-500/40
                              text-[11px] leading-relaxed text-amber-200/90">
                {stats.audio.unmatched.length} file(s) in /assets/sfx/ match no sound id:{' '}
                <span className="font-mono">{stats.audio.unmatched.slice(0, 4).join(', ')}</span>
                {stats.audio.unmatched.length > 4 ? ' …' : ''}
              </div>
            )}

            {/* A file named after a LOOP id is matched but unusable — loops
                have no sampled path yet.  Silence here would read as "my
                recording isn't working" with no way to find out why. */}
            {stats.audio && stats.audio.loopFiles.length > 0 && (
              <div className="mx-auto w-full max-w-xs px-3 py-2 rounded-lg
                              bg-amber-950/40 border border-amber-500/40
                              text-[11px] leading-relaxed text-amber-200/90">
                Sustained sounds can't use .wav yet, so these are ignored:{' '}
                <span className="font-mono">{stats.audio.loopFiles.slice(0, 3).join(', ')}</span>
                {stats.audio.loopFiles.length > 3 ? ' …' : ''}
              </div>
            )}

            {/* Audio diagnostics.  Only shown when audio is NOT audible, so
                it costs nothing in the normal case — but on a phone there is
                no console, and "no sound" has four very different causes that
                are otherwise indistinguishable from the outside. */}
            {stats.audio && !stats.audio.audible && !stats.audio.muted && (
              <div className="mx-auto w-full max-w-xs px-3 py-2 rounded-lg
                              bg-amber-950/40 border border-amber-500/40
                              text-[11px] leading-relaxed text-amber-200/90">
                {stats.audio.state === null ? (
                  <>Audio not started yet — tap anywhere to enable it.</>
                ) : stats.audio.state === 'running' ? (
                  <>Audio is running.</>
                ) : (
                  <>Audio is <span className="font-bold">{stats.audio.state}</span> — tap
                    anywhere to resume it.</>
                )}
                <div className="mt-1 text-amber-200/70">
                  On iPhone, also check the <span className="font-bold">side ring/silent
                  switch</span> — it silences web audio even at full volume.
                </div>
              </div>
            )}

            {/* Live switcher — maps + enemy-test override (controlled
                collapse so it survives the 60 Hz overlay re-render) */}
            <div className="text-center">
              <button
                onClick={() => toggleSection('switchmap')}
                className={`${SECTION_TOGGLE} text-slate-400 hover:text-slate-200`}
              >
                Switch Map / Test {collapsed.switchmap ? '▸' : '▾'}
              </button>
              {!collapsed.switchmap && (
                <div className="mt-4 flex flex-col items-center gap-4">
                  {renderTestPanel()}
                </div>
              )}
            </div>

            {/* Debug menu — the DBG panel's proper pause-menu home (the old
                floating top-left dropdown button is gone). */}
            <div className="text-center">
              <button
                onClick={() => toggleSection('debug')}
                className={`${SECTION_TOGGLE} text-amber-400/80 hover:text-amber-300`}
              >
                Debug Menu {collapsed.debug ? '▸' : '▾'}
              </button>
              {!collapsed.debug && (
                <div className={`mt-3 mx-auto w-full max-w-xs ${PANEL_OPAQUE} border border-amber-500/30 rounded-lg px-3 py-2 text-left`}>
                  {debugSections}
                </div>
              )}
            </div>
          </div>
        </div>
        );
      })()}

    </div>
  );
};

export default UIOverlay;
