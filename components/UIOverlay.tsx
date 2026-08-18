
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
  onToggleTileOutlines?: () => void;
  onToggleChevronMode?: () => void;
  onToggleJoystickDebug?: () => void;
  onCycleMinimapMaterial?: () => void;
  onCycleLighting?: () => void;
  onCycleLightingTier?: () => void;
  onToggleShardShadows?: () => void;
  onToggleRefraction?: () => void;
  onCycleRefractBrightness?: () => void;
  onCycleShadowSoftness?: () => void;
  onCycleRockPalette?: () => void;
  onToggleRumble?: () => void;
  onSetControlScheme?: (scheme: ControlScheme) => void;
  onToggleAdaptiveTriggers?: () => void;
  onCycleTriggerEncoding?: () => void;
  onTestTriggerLink?: () => void;
  onToggleRepelPush?: () => void;
  onTogglePlasticAutomata?: () => void;
  onTogglePlasticAutomataDirection?: () => void;
  onToggleMaterialAutomata?: () => void;
  onCyclePlasticPalette?: () => void;
  onCyclePlasticShardPalette?: () => void;
  onCyclePlasticGlowBrightness?: () => void;
  onCycleMetalGlowBrightness?: () => void;
  onCycleGlassGlowColor?: () => void;
  onCycleMetalGlowColor?: () => void;
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
  onCycleEnemyScale?: () => void;
  onCycleSimRate?: () => void;
  onCycleHudRate?: () => void;
  onCycleSubstepCap?: () => void;
  onCycleRenderScale?: () => void;
  renderScaleName?: string;
  onCycleSwarmMove?: () => void;
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
  onToggleTileOutlines,
  onToggleChevronMode,
  onToggleJoystickDebug,
  onCycleMinimapMaterial,
  onCycleLighting,
  onCycleLightingTier,
  onToggleShardShadows,
  onToggleRefraction,
  onCycleRefractBrightness,
  onCycleShadowSoftness,
  onCycleRockPalette,
  onToggleRumble,
  onSetControlScheme,
  onToggleAdaptiveTriggers,
  onCycleTriggerEncoding,
  onTestTriggerLink,
  onToggleRepelPush,
  onTogglePlasticAutomata,
  onTogglePlasticAutomataDirection,
  onToggleMaterialAutomata,
  onCyclePlasticPalette,
  onCyclePlasticShardPalette,
  onCyclePlasticGlowBrightness,
  onCycleMetalGlowBrightness,
  onCycleGlassGlowColor,
  onCycleMetalGlowColor,
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
  onCycleEnemyScale,
  onCycleSimRate,
  onCycleHudRate,
  onCycleSubstepCap,
  onCycleRenderScale,
  renderScaleName,
  onCycleSwarmMove,
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
    player: true, modules: true, weapons: true, visual: true, shardsphys: true, flowfield: true,
    perf: true, timing: true, dragon: true, rival: true, boss: true, perfrec: true,
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
  const HEXW = 76, HEXH = 66;
  const INVW = 66, INVH = 57; // small flat-top hexes, H ≈ 0.866 W
  const INV_COLS = 6;
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
        <h3 className={`text-[11px] font-bold uppercase tracking-widest ${accentText}`}>
          {title}
          {g === 'weapon' && (
            <span
              className={`ml-2 px-1.5 py-0.5 rounded text-[9px] tabular-nums ${gunCount >= maxGuns ? 'bg-amber-600/40 text-amber-200' : 'bg-slate-700/70 text-slate-300'}`}
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
                  {isGun && <span className="text-[7px] font-bold text-amber-400/90 tracking-widest leading-none mb-0.5">W{(gunOrder.get(i) ?? 0) + 1}</span>}
                  {m ? (
                    <>
                      <span className={`text-[9px] font-bold uppercase tracking-tight leading-tight px-1.5 ${offline ? 'text-rose-400' : 'text-slate-100'}`}>{m.label}</span>
                      {offline && <span className="text-[7px] text-rose-400/90 font-bold leading-none mt-0.5">OFFLINE</span>}
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
        <h3 className="text-amber-300 text-[11px] font-bold uppercase tracking-widest">Inventory</h3>
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
                    <span className="text-[8px] font-bold uppercase tracking-tight leading-tight px-1.5 text-slate-100">{m.label}</span>
                  ) : (
                    <span className="text-slate-600 text-xs font-bold leading-none">·</span>
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
      <div className="bg-slate-800/60 border border-slate-600/40 rounded-lg p-3">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sky-300 text-[11px] font-bold uppercase tracking-widest">Ship Status</h3>
          <span className="text-slate-500 text-[10px]">
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
                  className="w-full flex items-baseline justify-between gap-2 px-1.5 py-1.5 text-left hover:bg-slate-700/30 rounded transition-colors"
                >
                  <span className="text-slate-400 text-xs flex items-baseline gap-1.5">
                    {l.label}
                    <span className="text-slate-600 text-[9px]">{open ? '▾' : '▸'}</span>
                  </span>
                  <span className="flex items-baseline gap-1.5">
                    {counted > 0 && (
                      <span className={`text-[9px] font-bold tabular-nums ${lit ? 'text-amber-300' : 'text-slate-600'}`}>
                        {counted} mod{counted > 1 ? 's' : ''}
                      </span>
                    )}
                    <span className="text-white font-bold tabular-nums text-xs">{l.display}</span>
                  </span>
                </button>
                {open && (
                  <div
                    data-testid={`stat-detail-${l.id}`}
                    className="px-1.5 pb-2 pt-0.5 flex flex-col gap-0.5 text-[11px]"
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
                            <span className="text-rose-400/80 ml-1.5 text-[9px] uppercase tracking-wide">
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
                    {l.note && <span className="text-slate-500 text-[10px] mt-0.5">{l.note}</span>}
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
    <div className="bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 min-h-[52px] flex items-center justify-between gap-3 flex-wrap">
      {!selSlot ? (
        <span className="text-slate-500 text-[11px]">
          {ctx === 'station'
            ? (canEditInstalled ? 'Drag modules between tiles, or tap a hex slot to inspect / install.' : 'Tap a hex slot to inspect the outfit.')
            : 'Tap a tile to inspect. Cargo can be rearranged or scrapped here; outfitting needs a station drydock.'}
        </span>
      ) : selSlot.g === 'inventory' ? (
        selInvMod ? (
          <>
            <div className="text-xs">
              <span className="text-white font-bold uppercase tracking-wide">{selInvMod.label}</span>
              <span className="text-slate-500 ml-2 text-[10px] uppercase">{selInvMod.kind.replace('-', ' ')}</span>
            </div>
            <div className="flex gap-1.5">
              <button
                disabled={!stats.dock?.docked || selInvMod.sellValue <= 0}
                onClick={() => onSellModule?.(selSlot.i)}
                title={!stats.dock?.docked
                  ? 'Sell-back needs a station — dock anywhere to sell for 90% of cost'
                  : selInvMod.sellValue <= 0 ? 'Worthless — scrap it instead' : 'Sell back for 90% of cost'}
                className="px-3 py-1 rounded text-[11px] font-bold bg-emerald-800/60 hover:bg-emerald-700/70 text-emerald-200 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Sell ◈{selInvMod.sellValue.toLocaleString()}
              </button>
              <button
                onClick={() => onScrapModule?.(selSlot.i)}
                title="Break up for scrap — 9% of cost, works anywhere"
                className="px-3 py-1 rounded text-[11px] font-bold bg-slate-800/70 hover:bg-red-900/50 text-slate-400 hover:text-red-200 transition-all active:scale-95"
              >
                Scrap ◈{selInvMod.scrapValue.toLocaleString()}
              </button>
            </div>
          </>
        ) : (
          <span className="text-slate-500 text-[11px]">Empty inventory tile — purchases land here.</span>
        )
      ) : selHexMod ? (
        <>
          <div className="text-xs">
            <span className="text-white font-bold uppercase tracking-wide">{selHexMod.label}</span>
            <span className="text-slate-500 ml-2 text-[10px] uppercase">{selHexMod.kind.replace('-', ' ')}</span>
            {selHexMod.active
              ? <span className="text-emerald-300 ml-2 font-bold text-[10px] uppercase">Online</span>
              : <span className="text-rose-400 ml-2 font-bold text-[10px] uppercase">Offline — must touch {selHexMod.requires}</span>}
            {/* Exact effect (A2): every stat this hex feeds, with the amount
                it contributes.  An OFFLINE module lists the same stats with
                a zero contribution, so "what am I losing" reads directly. */}
            {(() => {
              const eff = (out?.statLines ?? []).flatMap(l =>
                l.contributors
                  .filter(c => c.area === selSlot.g && c.idx === selSlot.i)
                  .map(c => ({ stat: l.label, display: c.display, active: c.active })));
              if (eff.length === 0) {
                return <div className="text-slate-500 text-[10px] mt-0.5">Contributes no ship stats.</div>;
              }
              return (
                <div data-testid="detail-effects" className="text-[10px] mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
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
              className="px-3 py-1 rounded text-[11px] font-bold bg-slate-800/70 hover:bg-red-900/50 text-slate-400 hover:text-red-200 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ✕ To inventory
            </button>
          )}
          {ctx === 'pause' && (
            <span className="text-slate-500 text-[10px]">Installed — reconfigure at a station drydock.</span>
          )}
        </>
      ) : (
        <>
          <span className="text-slate-400 text-[11px] font-bold uppercase tracking-wider shrink-0">
            Install · {selSlot.g} module
          </span>
          <div className="flex gap-1.5 flex-wrap">
            {ctx === 'pause' || !canEditInstalled ? (
              <span className="text-slate-500 text-[11px]">
                {ctx === 'pause' ? 'Empty slot — outfit at a station drydock.' : 'Outfitting locked — no drydock at this station.'}
              </span>
            ) : candidates.length === 0 ? (
              <span className="text-slate-500 text-[11px]">No matching modules in the inventory — buy some at a shop station.</span>
            ) : candidates.map(c => {
              const gunBlocked = c.m!.kind === 'weapon' && gunCount >= maxGuns;
              return (
                <button
                  key={c.idx}
                  disabled={gunBlocked}
                  onClick={() => onMoveModule?.({ area: 'inventory', idx: c.idx }, { area: selSlot.g as 'ship' | 'weapon', idx: selSlot.i })}
                  title={gunBlocked ? `Gun limit reached (${gunCount}/${maxGuns}) — unmount a gun first` : undefined}
                  className="px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wide bg-sky-700/50 hover:bg-sky-600/70 text-sky-100 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
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
            <span className="text-[9px] font-bold uppercase tracking-tight leading-tight px-1.5 text-slate-100">{dragging.label}</span>
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
      {heading && <span className="text-slate-400 text-[11px] uppercase tracking-wider">{heading}</span>}
      <div className="flex flex-wrap justify-center gap-2 max-w-xl">
        {maps.map(opt => (
          <button
            key={opt.type}
            onClick={() => onSetMapType && onSetMapType(opt.type)}
            className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${
              mapType === opt.type
                ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-indigo-400 hover:text-white'
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
      <span className="text-rose-300 text-[11px] uppercase tracking-wider">Enemy Test — force one type</span>
      <div className="flex flex-wrap justify-center gap-2 max-w-xl">
        {ENEMY_TEST.map(opt => {
          const active = (stats.forcedEnemy ?? null) === (opt.type ?? null);
          return (
            <button
              key={opt.label}
              onClick={() => onSetForcedEnemy && onSetForcedEnemy(opt.type)}
              className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${
                active
                  ? 'bg-rose-600 border-rose-400 text-white shadow-lg'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-rose-400 hover:text-white'
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
          className="pointer-events-auto cursor-pointer text-slate-500 text-[10px] uppercase tracking-widest select-none hover:text-slate-300"
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
            className={`px-2 py-2 rounded-lg border text-left transition-all ${
              // Five options into a 2-up grid: the odd one out spans the row
              // rather than leaving a hole.
              i === CONTROL_SCHEMES.length - 1 && CONTROL_SCHEMES.length % 2 === 1 ? 'col-span-2 ' : ''
            }${
              active === scheme.id
                ? 'bg-sky-600 border-sky-400 text-white shadow-lg'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-sky-400 hover:text-white'
            }`}
          >
            <div className="text-xs font-bold">{scheme.label}</div>
            <div className={`text-[9px] leading-tight mt-0.5 ${active === scheme.id ? 'text-sky-100' : 'text-slate-500'}`}>
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
          className="w-full bg-slate-900 border border-slate-600 text-white text-xs rounded-lg px-2 py-2 focus:border-sky-400 focus:outline-none"
        >
          {CONTROL_SCHEMES.map(scheme => (
            <option key={scheme.id} value={scheme.id}>{scheme.label}</option>
          ))}
        </select>
        <span className="text-slate-500 text-[10px] leading-tight">
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
          className={`pointer-events-auto cursor-pointer w-full px-2 py-2 rounded-lg border text-xs font-bold transition-all ${
            on
              ? 'bg-amber-600 border-amber-400 text-white'
              : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-amber-400 hover:text-white'
          }`}
        >
          {on ? 'Adaptive Triggers — ON' : 'Connect DualSense Triggers'}
        </button>
        <span className="text-slate-500 text-[10px] leading-tight">
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
        <h4 className={`${accent} text-[11px] font-bold uppercase tracking-widest mb-1.5 flex items-center gap-2`}>
          {title}
          {activeFor && activeFor.includes(scheme) && (
            <span className="text-[9px] normal-case tracking-normal bg-white/10 px-1.5 py-0.5 rounded">active</span>
          )}
          {live}
        </h4>
        <div className="flex flex-col gap-1">
          {rows.map(([control, what]) => (
            <div key={control} className="flex gap-2 text-[11px] leading-snug">
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
          ['Left stick / D-pad', 'Fly.'],
          ['Right stick', 'Aim.'],
          ['Right trigger', 'Shoot — the moment you reach the break point. Hold for a charged shot. (Bottom face button too.)'],
          ['Left trigger', 'Throttle, on the trigger-thrust scheme: the stick steers, the trigger decides how hard.'],
          ['Left face button', 'Dock, enter a portal, or undock. □ on PlayStation, X on Xbox.'],
          ['Right shoulder', 'Switch weapon. (Top face button too.)'],
          ['Start / Options', 'Pause.'],
          ['In menus', 'D-pad moves, bottom face button selects, right face button goes back.'],
          ['Touch', 'Still works alongside: drag to fly, tap to shoot.'],
        ], padOn ? (
          <span className="text-violet-200/80 font-mono text-[9px] normal-case tracking-normal bg-violet-500/15 px-1.5 py-0.5 rounded">
            connected
          </span>
        ) : null, ['gamepad', 'gamepad-thrust'])}

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
      className="pointer-events-auto mt-1 w-full flex items-center justify-between text-slate-400/80 hover:text-amber-300 uppercase tracking-wider text-[8px] transition-colors"
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
        className="bg-slate-800/70 border border-slate-600/60 rounded px-1.5 py-0.5 text-[8px] font-bold text-slate-200 hover:border-amber-400/70 hover:text-amber-300 transition-colors"
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
                      className="px-2.5 py-1.5 rounded-md text-[11px] font-bold border transition-all capitalize bg-slate-800 border-slate-700 text-slate-300 hover:border-emerald-400 hover:text-white"
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
                      className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold border transition-all capitalize bg-slate-800 border-slate-700 text-slate-300 hover:text-white ${c}`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              )}

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
                      className="px-2.5 py-1.5 rounded-md text-[11px] font-bold border transition-all bg-slate-800 border-slate-700 text-slate-300 hover:border-rose-400 hover:text-white"
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
                      className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold border transition-all ${
                        stats.perfRecording
                          ? 'bg-red-600/80 border-red-400 text-white animate-pulse'
                          : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-red-400 hover:text-white'
                      }`}
                      title="Start / stop an FPS + perf capture"
                    >
                      {stats.perfRecording ? '● REC' : '○ REC'}
                    </button>
                    <button
                      onClick={() => onPerfRecCycleScene && onPerfRecCycleScene()}
                      className="px-2.5 py-1.5 rounded-md text-[11px] font-bold border transition-all capitalize bg-slate-800 border-slate-700 text-slate-300 hover:border-amber-400 hover:text-white"
                      title="Cycle the scene label recorded with the capture"
                    >
                      {stats.perfRecScene ?? 'baseline'}
                    </button>
                    <button
                      onClick={handlePerfCopy}
                      disabled={(stats.perfRecSamples ?? 0) === 0}
                      className="px-2.5 py-1.5 rounded-md text-[11px] font-bold border transition-all bg-slate-800 border-slate-700 text-slate-300 hover:border-emerald-400 hover:text-white disabled:opacity-40"
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
                {ctrlRow('Rumble', onToggleRumble,
                  stats.rumbleEnabled === false ? 'Off' : 'On',
                  'Gamepad force feedback. Rides the SCREEN SHAKE — every impact already funnels through one call with magnitudes tuned against each other, so the hand feels what the camera feels. Separate from the Screen shake toggle: the camera lurching and the pad buzzing are different preferences. Only dual-rumble is reachable from a browser; the DualSense adaptive triggers need WebHID (desktop Chromium only).')}
                {ctrlRow('Rock palette', onCycleRockPalette,
                  stats.rockPaletteName ?? 'mixed',
                  'Rock body colour family. Mixed (default): mostly slate with rust and mineral running through it, so a field reads as ROCK with variation. Slate: the old single flat grey. Rust / mineral: the pure warm and cool families, kept for regional-identity work and for judging them side by side. Shades are rolled per instance AT SPAWN — reload the map to repaint a whole field.')}
                {ctrlRow('Minimap mat', onCycleMinimapMaterial,
                  stats.minimapMaterialName ?? 'Flow',
                  'What the minimap says about MATERIAL. Flow (default): streamlines traced through the asteroid flow field — where material is GOING, drawn as 49 short lines with a pulse running downstream. Dots: the old spray of one dot per mobile shard. Off: neither. Static tiles are unaffected either way (they come from the pre-rendered terrain layer); nebula is off the minimap entirely.')}
                {ctrlRow('Lighting', onCycleLighting,
                  stats.lightingModeName ?? 'legacy',
                  'Unified tile lighting. LEGACY (default) is not "off" — it is the THREE hand-rolled models Omni ships: the player-distance proximity bloom on rock/plastic/indestructible, the repel-impulse glow on glass and metal, and the glass edge tint on its own 120 range. UNIFIED replaces all three with one shadow-casting point light at the ship: a radial falloff with a shadow wedge withheld behind every solid tile in range. Nebula is passThrough and deliberately casts NOTHING, which is why the effect reads strongly on the material showcase maps and faintly on Universe (two thirds of its static tiles are nebula). DEBUG paints a flat grey layer instead of a light — no lighting maths — so the canvas, the single blit and the smoothing restore can be checked on their own.')}
                {ctrlRow('Light tier', onCycleLightingTier,
                  stats.lightingTierName ?? 'low',
                  'Lighting budget. LOW (default) is the 390x844 phone: the light layer renders at a third of screen resolution, 4 lights, 24 occluders each, radius 300, hard shadows. Medium/High halve the divisor and raise every cap. The occluder cap is load-bearing rather than defensive — a radius-300 light can cover ~225 hexes in solid terrain, and the cap takes the NEAREST, which subtend the largest shadow angle, so truncation degrades gracefully.')}
                {ctrlRow('Shadow soft', onCycleShadowSoftness,
                  stats.shadowSoftnessName ?? 'soft',
                  'Shadow-edge softness. A point light casts a perfectly HARD shadow, which is what made the first version read as a drawn line rather than as lighting. Softness here is an ANGLE, so the soft band WIDENS with distance from the caster the way a real area light\'s does — tight against the tile, spreading further out — rather than being a uniform blur. Off is the hard-edged original, kept as the control. Costs two extra wedge passes per light when on.')}
                {ctrlRow('Shard shadows', onToggleShardShadows,
                  stats.shardShadowsEnabled === false ? 'Off' : 'On',
                  'Do MOBILE SHARDS cast shadows too, or only static tiles? Only has an effect while Lighting is unified. On by default: a shard is the same shard family as the tile it broke off and about twice its radius (measured 43.6 median against a tile\'s 22), so leaving them out makes debris read as transparent to a light that solid rock is not. Nebula shards are excluded either way — same soft cloud as a nebula tile. Shards are drawn from the DYNAMIC grid, so this is a second spatial query per light; turn it off to see what that costs.')}
                {ctrlRow('Refraction', onToggleRefraction,
                  stats.refractionEnabled === true ? 'On' : 'Off',
                  'PROTOTYPE. Off (default): glass passes light STRAIGHT THROUGH at reduced brightness, which is right for a parallel-faced pane — a slab offsets a ray sideways but does not bend it, and a regular hexagon has three pairs of parallel faces. On: each exit face refracts by Snell\'s law and throws an additive cone along the DEVIATED direction, capped at half the source light\'s brightness, while the straight-through path is withheld in full — so the light is moved rather than added and the toggle is a real A/B. Only the exit face is refracted (a real ray bends twice, and for parallel faces the two cancel), so this over-states the bend for a tile and is about right for a wedge-shaped shard. Past the critical angle nothing is transmitted at all. The open question it exists to answer is whether a caustic is legible on a light layer rendered at a third of screen resolution.')}
                {ctrlRow('Refr bright', onCycleRefractBrightness,
                  stats.refractBrightnessName ?? '1/2',
                  'How bright the REFRACTED cone is, as a fraction of the light\'s own peak. Only has an effect while Refraction is on. Named as fractions because that is the quantity the rule is stated in — refracted light is a redistribution of light that already lost some of itself passing through the body, so it can never out-shine the source, and the geometry clamps at 1/2 regardless of what is selected here. Starts at the ceiling, so tuning only goes down.')}
                {ctrlRow('Joystick', onToggleJoystickDebug,
                  stats.joystickForceVisible === true ? 'Forced' : 'Touch',
                  'Onscreen touch joystick. Touch: the widget exists only while a thumb is on the glass — the normal behaviour, and why it never ghosts onto mouse or gamepad. Forced: draw it anyway, so its size and placement can be checked on a desktop browser.')}
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
                {ctrlRow('M glow', onCycleMetalGlowBrightness,
                  stats.metalGlowBrightnessName ?? '1x',
                  'Cycle the metal-tile proximity-glow brightness multiplier (1×–5×). Multiplies the variant peakAlpha so the fuchsia repel-glow lights up from farther away and reads brighter near contact.')}
                {ctrlRow('Recolor', onTogglePlasticBlend,
                  stats.plasticBlendEnabled === false ? 'Off' : 'On',
                  'Toggle plastic colour equilibration. Off freezes plastic tiles + shards at their spawn/shatter colours; uses the same tile/shard blend alphas as nebula when on.')}
                {ctrlRow('Glass', onCycleGlassGlowColor,
                  stats.glassGlowColorName ?? 'sky',
                  'Cycle the glass-tile proximity glow ONLY through the 11-entry colour list (cyan / yellow / amber / gold / magenta / rose / lime / emerald / sky / violet / white). Glass shatter dust + main background nebula clusters now live on the Nebula cycle. Default sky.')}
                {ctrlRow('M color', onCycleMetalGlowColor,
                  stats.metalGlowColorName ?? 'magenta',
                  'Cycle the metal-tile proximity glow through the same 11-entry colour list as Glass (independent index). Default magenta — closest match to the legacy fuchsia. Range + peakAlpha stay with the variant; the M glow brightness multiplier is independent.')}
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
    <div className="absolute inset-0 pointer-events-none p-4 flex flex-col justify-between">

      {!overlayUp && (<>

      {/* ── Top Bar ── */}
      <div className="flex justify-between items-start">
        {/* Top-left intentionally empty — the debug menu now lives in the
            pause Player Menu (Debug Menu section). */}
        <div />

        {/* Top-right: wave HUD + pause button */}
        <div className="flex items-start gap-3">

          {/* Wave info — only while playing */}
          {stats.gameState === GameState.PLAYING && (
            <div className="flex flex-col items-end gap-1">
              {/* Run score */}
              <div className="pointer-events-none bg-slate-900/75 border border-slate-600/50 rounded-lg px-4 py-1.5 shadow-lg backdrop-blur-sm text-right">
                <span className="text-amber-300 text-xs font-bold tracking-widest tabular-nums">
                  {(stats.score ?? 0).toLocaleString()} PTS
                </span>
              </div>
              {/* Salvage (money) — silver to match the field drop, distinct
                  from the gold score chip.  Flashes +N on pickup. */}
              <div className="pointer-events-none bg-slate-900/75 border border-slate-600/50 rounded-lg px-4 py-1.5 shadow-lg backdrop-blur-sm text-right">
                <span className="text-slate-200 text-xs font-bold tracking-widest tabular-nums">
                  ◈ {(stats.credits ?? 0).toLocaleString()}
                </span>
                {stats.salvageFlash && (
                  <span
                    className="text-slate-50 text-xs font-extrabold tabular-nums ml-1.5"
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
                    <span className="text-orange-300/70 text-[10px] font-bold ml-1">
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
                  className={`pointer-events-none bg-slate-900/75 border rounded-lg px-3 py-1 shadow-lg backdrop-blur-sm text-right ${amber ? 'border-amber-500/50' : 'border-lime-500/50'}`}
                  style={{ opacity: Math.max(0.45, e.fraction) }}
                >
                  <span className={`text-[11px] font-extrabold uppercase tracking-widest tabular-nums ${amber ? 'text-amber-300' : 'text-lime-300'}`}>
                    {e.kind === 'disable' ? 'DISABLED' : `${e.kind} ×${e.stacks}`}
                  </span>
                </div>
              );})}
              {stats.wavesEnabled !== false && (
              <div
                onClick={isGrace ? onSkipWave : undefined}
                className={`bg-slate-900/75 border rounded-lg px-4 py-1.5 shadow-lg backdrop-blur-sm text-right transition-all ${
                  isGrace
                    ? 'pointer-events-auto border-emerald-500/60 cursor-pointer hover:bg-emerald-900/40 active:scale-95'
                    : 'pointer-events-none border-slate-600/50'
                }`}
              >
                <span className="text-slate-300 text-xs font-bold uppercase tracking-widest">
                  Wave {stats.waveNumber ?? 1}
                  {stats.enemiesRemaining !== undefined && (
                    <span className="text-rose-300"> · {stats.enemiesRemaining} left</span>
                  )}
                  {stats.waveElapsedSec !== undefined && (
                    <span className="text-cyan-300"> · {stats.waveElapsedSec}s</span>
                  )}
                </span>
                {isGrace && (
                  <p className="text-emerald-400 text-[10px] font-bold mt-0.5 animate-pulse">
                    Next in {stats.waveGraceTimer}s · tap to skip
                  </p>
                )}
              </div>
              )}
            </div>
          )}

          {/* Pause button — hidden while docked or dead (the station UI and
              the run-summary screen already freeze the sim and own the
              screen) */}
          {stats.gameState === GameState.PLAYING && !stats.dock?.docked && !stats.runSummary && (
            <button
              onClick={onPause}
              className="pointer-events-auto bg-slate-800/80 hover:bg-slate-700 text-white rounded-lg p-2.5 shadow-lg border border-slate-600/60 transition-all active:scale-95"
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

      {/* ── Boss bar ((h)) ──────────────────────────────────────────
          Present only while a capstone boss is alive.  Sized for PHONE
          scale: the name and the percent readout are the two things
          that have to survive a 390px-wide screen, so they anchor the
          two ends of the row and the pips sit under them rather than
          competing for the same line.  Pure EngineStats — no per-frame
          React state. */}
      {stats.gameState === GameState.PLAYING && stats.boss && (
        <div className="absolute top-14 sm:top-16 left-1/2 -translate-x-1/2 pointer-events-none w-[min(560px,92vw)] px-1">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span
              className="text-[12px] sm:text-[13px] font-extrabold uppercase tracking-[0.2em] drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] truncate"
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
                className="text-[12px] sm:text-[13px] font-extrabold tabular-nums drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
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
        return (
        <div
          /* No justify-center: on a scrollable flex column it clips
             overflowing content above the reachable scroll area; the inner
             wrapper's my-auto does the centering when content is short. */
          className={`absolute inset-0 ${OVERLAY_SCRIM} flex flex-col items-center pointer-events-auto z-50 p-4 overflow-y-auto overscroll-contain`} data-overlay="station">
          <div className="w-full max-w-2xl flex flex-col gap-4 my-auto">

            <div className="flex items-center justify-between">
              <h2 className="text-3xl font-bold text-sky-300 tracking-[0.2em]">⬡ {stats.dock?.name ?? 'STATION'}</h2>
              <span className="text-amber-300 text-sm font-bold tabular-nums">◈ {(stats.credits ?? 0).toLocaleString()} Salvage</span>
            </div>

            <button
              onClick={onUndock}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-lg shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              UNDOCK <span className="text-emerald-200 text-[10px] font-mono">[E]</span>
            </button>

            {/* Hull repair — pay-per-HP, pro-rated (repair-service stations) */}
            {svc?.repair && (
            <div className="bg-slate-800/60 border border-rose-600/30 rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs">
                <h3 className="text-rose-300 text-[11px] font-bold uppercase tracking-widest mb-1">Hull Repair</h3>
                <span className="text-slate-400">Hull </span>
                <span className="text-white font-bold tabular-nums">{ps?.health ?? 0} / {ps?.maxHealth ?? 100}</span>
                <span className="text-slate-500 ml-2 text-[10px]">◈{stats.station?.repairCostPerHp ?? 0}/HP · partial repair if short</span>
              </div>
              <button
                disabled={!stats.station?.canRepair}
                onClick={onRepairHull}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  stats.station?.canRepair
                    ? 'bg-rose-700/60 hover:bg-rose-600/70 text-rose-100 active:scale-95'
                    : 'bg-slate-800/60 text-slate-500 cursor-not-allowed'
                }`}
              >
                {(stats.station?.missingHull ?? 0) <= 0
                  ? 'HULL FULL'
                  : `REPAIR ◈${(stats.station?.fullRepairCost ?? 0).toLocaleString()}`}
              </button>
            </div>
            )}

            {/* Hex outfitting + inventory.  Modules FUNCTION only while
                their adjacency requirement is met (engine⇢hull,
                thrusters⇢engine, shield/plating⇢hull, capacitor⇢shield,
                weapon-mods⇢gun; hull + guns are the roots).  Drag tiles
                between the inventory and the flowers — drydock only. */}
            {/* Full derived-stat set with per-module attribution (A2) — the
                same shared widget the pause menu shows, so an outfitting
                change here can be read back immediately. */}
            {renderShipStatus()}

            {out && (
              <div className="bg-slate-800/60 border border-sky-600/30 rounded-lg p-3 flex flex-col gap-2">
                {!canEdit && (
                  <p className="text-slate-500 text-[10px] text-center -mb-1">
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

            {/* Module shops — items are fixed Mk varieties (no upgrades);
                a purchase lands in the inventory. */}
            {out && (svc?.shipShop || svc?.weaponShop) && (
              <div className="bg-slate-800/60 border border-amber-600/30 rounded-lg p-3 flex flex-col gap-3">
                {(['ship', 'weapon'] as const).filter(g => (g === 'ship' ? svc?.shipShop : svc?.weaponShop)).map(g => (
                  <div key={g}>
                    <h3 className={`text-[11px] font-bold uppercase tracking-widest mb-2 ${g === 'ship' ? 'text-sky-300' : 'text-violet-300'}`}>
                      Shop · {g === 'ship' ? 'Ship Modules' : 'Weapon Modules'}
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {out.catalog.filter(c => c.group === g).map(c => (
                        <button
                          key={c.id}
                          disabled={!c.affordable}
                          onClick={() => onPurchaseModule?.(c.id)}
                          title={`${c.desc} — bought into the inventory`}
                          className={`flex items-center justify-between gap-2 px-2 py-1 rounded text-[11px] transition-all ${
                            c.affordable
                              ? 'bg-violet-700/40 hover:bg-violet-600/60 text-violet-100 active:scale-95'
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
            <span className="text-slate-400 text-[11px] uppercase tracking-widest">{label}</span>
            <span className="text-right">
              <span className="text-white font-bold tabular-nums text-sm">{value}</span>
              {note && <span className="text-slate-500 text-[10px] ml-1.5">{note}</span>}
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
                <h2 className="text-4xl font-black text-amber-300 tracking-[0.2em]">STAGE {sc.stage}</h2>
                <p className="text-emerald-300 text-sm font-bold uppercase tracking-[0.2em] mt-1">Cleared</p>
                <p className="text-slate-500 text-[11px] uppercase tracking-widest mt-1">
                  {sc.bossName} destroyed · {sc.mapName}
                </p>
              </div>

              {/* Salvage leads — it is the money, and it is what the shop
                  speaks.  Score is a separate performance metric that buys
                  nothing, so it is labelled as such and sits below. */}
              <div className="bg-slate-800/60 border border-slate-600/40 rounded-lg p-3 flex flex-col">
                {row('Salvage', `◈${sc.salvageCredits.toLocaleString()}`, 'sprayed on the wreck')}
                {row('Score', `+${sc.scoreAwarded.toLocaleString()}`)}
              </div>

              {/* Capstone reward: a module you carry away. */}
              {(sc.rewardLabel || sc.rewardCredits) && (
                <div className="bg-emerald-950/40 border border-emerald-600/40 rounded-lg p-3">
                  <p className="text-emerald-300 font-bold uppercase tracking-widest text-[10px] mb-1">
                    Salvaged from the wreck
                  </p>
                  {sc.rewardLabel ? (
                    <>
                      <p className="text-white font-bold text-sm">{sc.rewardLabel}</p>
                      {sc.rewardDesc && <p className="text-slate-400 text-[11px] mt-0.5">{sc.rewardDesc}</p>}
                      <p className="text-slate-500 text-[10px] mt-1">In your cargo — install it at a drydock.</p>
                    </>
                  ) : (
                    <>
                      <p className="text-white font-bold text-sm">◈{(sc.rewardCredits ?? 0).toLocaleString()}</p>
                      <p className="text-slate-400 text-[11px] mt-0.5">Cargo was full — the module was scrapped for its value.</p>
                    </>
                  )}
                </div>
              )}

              {/* The choice is IN THE WORLD, not on this screen — so the screen
                  explains where the two rifts are rather than offering buttons
                  that would bypass flying to them. */}
              <div className="bg-slate-800/40 border border-amber-600/30 rounded-lg p-3 text-[11px] leading-relaxed text-slate-300">
                <p className="text-amber-300 font-bold uppercase tracking-widest text-[10px] mb-1.5">A rift has opened</p>
                <p>
                  <span className="text-amber-300 font-bold">Descend</span> through the new amber rift to
                  {' '}<span className="text-white font-bold">Stage {sc.nextStage}</span> — five more waves and a tougher capstone.
                  Your hull carries through as-is.
                </p>
                <p className="mt-1.5">
                  Or take the <span className="text-sky-300 font-bold">sky rift</span> home to repair, sell and refit — the
                  ladder restarts at Stage 1 when you do.
                </p>
              </div>

              <button
                onClick={onDismissStageClear}
                data-testid="stage-continue"
                className="bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 rounded-lg shadow-lg transition-all active:scale-95 tracking-widest uppercase"
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
            <span className="text-slate-400 text-[11px] uppercase tracking-widest">{label}</span>
            <span className="text-right">
              <span className="text-white font-bold tabular-nums text-sm">{value}</span>
              {note && <span className="text-slate-500 text-[10px] ml-1.5">{note}</span>}
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
                <h2 className="text-4xl font-black text-rose-400 tracking-[0.2em]">DESTROYED</h2>
                <p className="text-slate-500 text-[11px] uppercase tracking-widest mt-1">{rs.mapName}</p>
              </div>

              {/* Headline — the run's performance metric, big. */}
              <div className="bg-slate-800/60 border border-amber-600/30 rounded-lg p-3 text-center">
                <div className="text-amber-300 text-[10px] font-bold uppercase tracking-widest">Score</div>
                <div className="text-amber-200 text-4xl font-black tabular-nums leading-tight">
                  {rs.score.toLocaleString()}
                </div>
                {rs.bestCombo > 1 && (
                  <div className="text-slate-400 text-[11px] mt-0.5">
                    best combo <span className="text-amber-300 font-bold tabular-nums">×{rs.bestCombo}</span>
                  </div>
                )}
              </div>

              <div className="bg-slate-800/60 border border-slate-600/40 rounded-lg p-3 flex flex-col">
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
                    <span className="text-rose-400/90 text-[11px] uppercase tracking-widest">Salvage lost</span>
                    <span className="text-right">
                      <span className="text-rose-300 font-bold tabular-nums text-sm">−◈{rs.creditsLost.toLocaleString()}</span>
                      {rs.creditsLostRun > rs.creditsLost && (
                        <span className="text-slate-500 text-[10px] ml-1.5">◈{rs.creditsLostRun.toLocaleString()} this run</span>
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
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-lg shadow-lg transition-all active:scale-95 tracking-widest uppercase"
                >
                  Respawn
                </button>
                <p className="text-slate-500 text-[10px] text-center -mt-1">
                  Continue this run — hull restored at the {rs.mapName} spawn. Score and outfit are kept
                  {rs.creditsLost > 0
                    ? `; the wreck cost you ◈${rs.creditsLost.toLocaleString()} of your unspent Salvage${rs.credits === 0 ? ' — all of it' : ''}.`
                    : '.'}
                </p>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    onClick={onRestartRun}
                    data-testid="death-restart"
                    className="bg-slate-700/70 hover:bg-slate-600/70 text-slate-200 font-bold py-3 rounded-lg text-xs tracking-widest uppercase transition-all active:scale-95"
                  >
                    Restart Run
                  </button>
                  <button
                    onClick={onQuitToMenu}
                    data-testid="death-menu"
                    className="bg-slate-700/70 hover:bg-slate-600/70 text-slate-200 font-bold py-3 rounded-lg text-xs tracking-widest uppercase transition-all active:scale-95"
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
                    className={`py-3 rounded-lg text-xs font-bold border transition-all ${
                      difficulty === level
                        ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-indigo-400 hover:text-white'
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
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xl font-bold py-4 rounded-full shadow-2xl transition-all transform hover:scale-105 active:scale-95"
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
                className="pointer-events-auto cursor-pointer text-sky-300/80 text-[11px] uppercase tracking-widest select-none hover:text-sky-200 py-2 px-3"
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
                className="pointer-events-auto cursor-pointer text-amber-400/80 text-[11px] uppercase tracking-widest select-none hover:text-amber-300"
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

            <div className="flex items-center justify-between">
              <h2 className="text-3xl font-bold text-white tracking-[0.2em]">PLAYER MENU</h2>
              <span className="text-amber-300 text-sm font-bold tabular-nums">◈ {(stats.credits ?? 0).toLocaleString()} Salvage</span>
            </div>

            <div className="flex gap-3">
              <button
                onClick={onResume}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-lg shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                CONTINUE
              </button>
              <button
                onClick={onRestart}
                className="flex-1 bg-slate-700 hover:bg-red-600 text-slate-200 hover:text-white font-bold py-3 rounded-lg shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 12" /><path d="M3 3v9h9" /></svg>
                RESTART
              </button>
            </div>

            {/* Live pools (the two stats that MOVE in flight) — the derived
                per-module breakdown lives in the shared Ship Status widget
                right below. */}
            <div className="bg-slate-800/60 border border-slate-600/40 rounded-lg p-3">
              <h3 className="text-sky-300 text-[11px] font-bold uppercase tracking-widest mb-2">Condition</h3>
              <div className="flex flex-col gap-1 text-xs">
                {statLine('Hull', `${ps?.health ?? 0} / ${ps?.maxHealth ?? 100}`)}
                {statLine('Shield', `${ps?.shield ?? 0} / ${ps?.maxShield ?? 0}`)}
                {statLine('Weight', `${(ps?.shipWeight ?? 0).toFixed(1)}`)}
                {statLine('Location', (
                  <>
                    {stats.currentMapName}
                    <span className="text-slate-500 font-normal ml-1.5 text-[10px]">
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
              <div className="bg-slate-800/60 border border-slate-600/40 rounded-lg p-3 flex flex-col gap-2">
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
            <p className="text-slate-500 text-[11px] text-center">
              Buy modules at the <span className="text-emerald-400 font-bold">Shipwright</span> / <span className="text-purple-400 font-bold">Armory</span>; outfit &amp; repair at the <span className="text-sky-400 font-bold">Home Station</span> drydock.
            </p>

            {/* Controls — changeable mid-run, so picking wrong at the front
                door costs a tap rather than a restart. */}
            <div className="bg-slate-800/60 border border-slate-600/40 rounded-lg p-3 flex flex-col gap-2">
              <h3 className="text-sky-300 text-[11px] font-bold uppercase tracking-widest">Controls</h3>
              {renderSchemeDropdown()}
              {renderAdaptiveTriggers()}
            </div>

            {/* Controls & basics — the same widget the main menu shows, so
                the answer is in the same words wherever you look for it. */}
            <div className="text-center">
              <button
                data-testid="pause-help-toggle"
                onClick={() => toggleSection('pausehelp')}
                className="pointer-events-auto cursor-pointer text-sky-300/80 text-[11px] uppercase tracking-widest select-none hover:text-sky-200 py-2 px-3"
              >
                Controls &amp; Basics {collapsed.pausehelp ? '▸' : '▾'}
              </button>
              {!collapsed.pausehelp && (
                <div className={`mt-2 mx-auto w-full max-w-xs ${PANEL_OPAQUE} border border-sky-500/30 rounded-lg px-3 py-3`}>
                  {renderHelpPanel()}
                </div>
              )}
            </div>

            {/* Live switcher — maps + enemy-test override (controlled
                collapse so it survives the 60 Hz overlay re-render) */}
            <div className="text-center">
              <button
                onClick={() => toggleSection('switchmap')}
                className="pointer-events-auto cursor-pointer text-slate-400 text-[11px] uppercase tracking-widest select-none hover:text-slate-200"
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
                className="pointer-events-auto cursor-pointer text-amber-400/80 text-[11px] uppercase tracking-widest select-none hover:text-amber-300"
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
