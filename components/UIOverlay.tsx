
import React, { useEffect, useRef, useState } from 'react';
import { EngineStats, MapType, GameState, ControlScheme } from '../types';
import { CONTROL_SCHEMES, controlSchemeDef } from '../constants';
import type { GameEngine } from '../engine/GameEngine';
import DebugMenu, { DebugLauncher } from './DebugMenu';
import {
  OVERLAY_SCRIM, PANEL_OPAQUE, OVERLAY_FADE_IN, OVERLAY_KEYFRAMES,
  T_MICRO, T_NOTE, T_BODY, T_ROW, PANEL, PANEL_ROW, panelAccent, HEADING,
  SCREEN_TITLE, OUTCOME_TITLE, TAP, BTN_PRIMARY, BTN_SECONDARY, BTN_COMPACT,
  CHIP_BASE, CHIP_OFF, HUD_CHIP, SECTION_TOGGLE, OVERLAY_FAB_CLEARANCE,
} from './uiClasses';

interface UIOverlayProps {
  stats: EngineStats;
  onCycleWeapon?: () => void;
  onStart?: () => void;
  onPause?: () => void;
  onScan?: () => void;
  onSetAutoScan?: (on: boolean) => void;
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
  // Audio settings (Phase 3 Pair B).  Deliberately the ONLY UI surface
  // this pass adds — Pair A owns the overlay's structural work.
  onAudioCue?: (id: 'ui.nav' | 'ui.drag.pick' | 'ui.drag.drop') => void;
  onSetSfxVolume?: (v: number) => void;
  onSetMusicVolume?: (v: number) => void;
  onSetVolume?: (v: number) => void;
  onToggleMute?: () => void;
  onToggleDrafts?: () => void;
  onSetControlScheme?: (scheme: ControlScheme) => void;
  onToggleAdaptiveTriggers?: () => void;
  // ── The debug panel (components/DebugMenu.tsx) ─────────────────────────
  // Rows are declared in components/debugSections.tsx and call the engine
  // directly, so the ~130 per-row callbacks that used to be threaded through
  // here are gone.  What is left is the engine accessor they use, and the two
  // debug actions App owns because they touch App state: the render-scale cap
  // (it resizes the canvas App owns) and the menu's map selection.
  engine?: () => GameEngine | null;
  onCycleRenderScale?: () => void;
  renderScaleName?: string;
  // Hex-slot outfitting — STATION-ONLY: the station UI is the sole caller;
  // the engine rejects installs/purchases while undocked.  purchase routes
  // leveled modules to the per-level cost curve, one-time to their price.
  onMoveModule?: (
    from: { area: 'inventory' | 'ship' | 'weapon'; idx: number },
    to: { area: 'inventory' | 'ship' | 'weapon'; idx: number },
  ) => void;
  onPurchaseModule?: (id: string) => void;
  /** A5 — buy the next hex of one flower.  Station commerce like a module
   *  purchase; the engine gates it on the matching shop. */
  onPurchaseSlot?: (group: 'ship' | 'weapon') => void;
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
  onSkipWave?: () => void;
  difficulty?: number;
  onSetDifficulty?: (level: number) => void;
  mapType?: MapType;
  onSetMapType?: (type: MapType) => void;
}

/* The shared class vocabulary (OVERLAY_SCRIM, PANEL_OPAQUE, the T_* type
 * scale, PANEL, the BTN_* and CHIP_* families, HUD_CHIP, SECTION_TOGGLE …)
 * lives in `./uiClasses` — a leaf module, because the debug menu now draws
 * the same things from its own file.  The rationale for each constant is
 * written beside it there. */

const UIOverlay: React.FC<UIOverlayProps> = ({
  stats,
  onCycleWeapon,
  onStart,
  onPause,
  onScan,
  onSetAutoScan,
  onResume,
  onRestart,
  onRespawn,
  onRestartRun,
  onQuitToMenu,
  onDismissStageClear,
  onAudioCue,
  onSetSfxVolume,
  onSetMusicVolume,
  onSetVolume,
  onToggleMute,
  onToggleDrafts,
  onSetControlScheme,
  onToggleAdaptiveTriggers,
  engine = () => null,
  onCycleRenderScale,
  renderScaleName,
  onMoveModule,
  onPurchaseModule,
  onPurchaseSlot,
  onSellModule,
  onScrapModule,
  onUndock,
  onRepairHull,
  onSkipWave,
  difficulty = 3,
  onSetDifficulty,
  mapType = MapType.OVERWORLD,
  onSetMapType,
}) => {
  const isGrace = stats.waveStatus === 'cleared' && (stats.waveGraceTimer ?? 0) > 0;
  // Collapse state for the two Controls & Basics widgets (Pair C, c1) —
  // controlled (not native <details>) so it survives the ~60 Hz
  // stats-driven re-render of this overlay.  Two keys rather than one so
  // opening it to read the controls mid-run does not also unfold the front
  // door.  (The debug menu's own open/closed state lives in DebugMenu, which
  // stays mounted on every screen.)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => ({
    menuhelp: true, pausehelp: true,
  }));
  const toggleSection = (name: string) =>
    setCollapsed(prev => ({ ...prev, [name]: !prev[name] }));
  // The debug panel's open state is the ENGINE's (three devices open it); the
  // HUD launcher asks for the toggle like the other two do.
  const debugPanelOpen = stats.debugPanel?.open === true;
  const toggleDebugPanel = () => engine()?.toggleDebugPanel('pointer');
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
      onAudioCue?.('ui.drag.drop');
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
      onAudioCue?.('ui.drag.pick');
      setDragging({ area, idx, label, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false });
    };
  /** One 7-hex flower.  `interactive: false` (pause menu) renders a
   *  read-only display: still tap-selectable for info, but no drag
   *  source and no [data-tile] drop target. */
  const renderHexGroup = (g: 'ship' | 'weapon', title: string, accentText: string, accentBg: string, interactive: boolean) => {
    const slots = g === 'ship' ? (out?.ship ?? []) : (out?.weapon ?? []);
    // A5: hexes at or past the unlocked count are LOCKED — empty hexes that
    // cannot be filled.  Defaults to every hex unlocked, so a stats payload
    // without the field (or a shipped run) draws exactly what it always did.
    const unlocked = (g === 'ship' ? out?.shipUnlocked : out?.weaponUnlocked) ?? slots.length;
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
            const locked = i >= unlocked;
            const lifted = dragging?.moved === true && dragging.area === g && dragging.idx === i;
            return (
              <button
                key={i}
                /* `data-tile` is the DRAG drop-target hook, so it only
                   exists on interactive flowers; `data-hex` is a stable
                   identity for every hex (read-only flowers included). */
                data-hex={`${g}:${i}`}
                /* A LOCKED hex carries no [data-tile], so the drag resolver
                   simply cannot land a module on it — the engine's move guard
                   is the second line, not the only one. */
                data-tile={interactive && !locked ? `${g}:${i}` : undefined}
                onPointerDown={interactive && !locked && m !== null ? beginDrag(g, i, m.label) : undefined}
                onClick={() => { if (suppressClickRef.current || locked) return; setSelSlot(sel ? null : { g, i }); }}
                disabled={locked}
                className="absolute transition-transform active:scale-95"
                style={{
                  width: HEXW, height: HEXH, touchAction: 'none',
                  opacity: lifted ? 0.35 : locked ? 0.4 : undefined,
                  left: cw / 2 + off.x * HEXW - HEXW / 2,
                  top: ch / 2 + off.y * HEXH - HEXH / 2,
                  clipPath: HEX_CLIP,
                  background: locked ? '#1e293b'
                    : sel ? '#f8fafc'
                    : offline ? '#9f1239'
                    : m ? (isGun ? '#f59e0b' : accentBg) : '#475569',
                }}
                title={locked
                  ? `Locked ${g} slot — buy it at a station that stocks ${g === 'ship' ? 'ship' : 'weapon'} modules`
                  : m
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
                  {locked ? (
                    <span className="text-slate-600 text-base font-bold leading-none">🔒</span>
                  ) : m ? (
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
   * places, the pattern `renderShipStatus` already set.
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
          ['Scan button', 'Sweeps for contacts (needs a Scanner). Top right, beside pause.'],
        ], null, ['touch'])}

        {group('Joystick touch', 'text-sky-300', [
          ['Stick thumb', 'Drag to fly. The stick appears wherever your thumb lands.'],
          ['Aim', 'The ship points where it flies — the stick aims it. No second gesture.'],
          ['Fire button', 'Shoot. Hold it for a charged shot — the ring shows the charge.'],
          ['Handedness', 'Two versions: stick left + fire right, or the mirror of it.'],
          ['Tap your ship', 'Dock, or enter a portal. Tapping elsewhere does not shoot.'],
          ['Scan button', 'Sweeps for contacts (needs a Scanner). Top right, beside pause.'],
        ], null, ['joystick-left', 'joystick-right'])}

        {group('Keyboard & mouse', 'text-emerald-300', [
          ['W A S D / arrows', 'Fly.'],
          ['Mouse', 'Aims. Click to shoot.'],
          ['Hold 1s, release', 'Charged shot.'],
          ['E', 'Dock, enter a portal, or undock. Clicking your ship does the same.'],
          ['Q', 'Scan — sweeps for contacts. Needs a Scanner module installed.'],
          ['Touch', 'Still works alongside: drag to fly, tap to shoot.'],
        ], null, ['keyboard'])}

        {group('Gamepad', 'text-violet-300', [
          ['Left stick / D-pad', 'Fly. On the left-stick scheme it aims too — the ship points where it flies.'],
          ['Right stick', 'Aim. Unused on the left-stick scheme, where one thumb does both.'],
          ['Right trigger', 'Shoot — the moment you reach the break point. Hold for a charged shot. (Bottom face button too.)'],
          ['Bottom face button', 'Shoot. The only gun on the left-stick and trigger-thrust schemes, where the triggers are doing something else or may not exist. ✕ on PlayStation, A on Xbox.'],
          ['Left trigger', 'Throttle, on the trigger-thrust scheme: the stick steers, the trigger decides how hard.'],
          ['Left face button', 'Dock, enter a portal, or undock. □ on PlayStation, X on Xbox.'],
          ['Left shoulder', 'Scan — sweeps for contacts. Needs a Scanner. (Right face button too.)'],
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
          ['Scanner', 'Finds things beyond what you can see. Higher marks find rarer things; fitting more scans further. Mk II and up also sweeps on its own — switch it in the pause menu.'],
          ['Found', 'Stations and rifts stay on the minimap once you find them — by flying past, or by scanning. Anything that MOVES is only tracked for a few seconds.'],
          ['Salvage', 'The silver drops are money. Collecting them is the only way to earn.'],
          ['Stations', 'Dock to repair, buy modules, and outfit the ship. Outfitting needs a drydock.'],
          ['Portals', 'The rifts on the hub lead to wave arenas. The return rift brings you home.'],
          ['Waves', 'Clear the field to advance. Every sixth wave is a boss; killing it opens a way down.'],
          ['Death', 'Costs a slice of the salvage you are still carrying — spent money is safe.'],
        ])}
      </div>
    );
  };

  // Is a full-screen overlay up?  The scrims are translucent now, so the HUD
  // behind them is no longer hidden by opacity — and a score chip, wave
  // counter and pause button ghosting through a run summary reads as
  // double-vision, not as depth.  What the transparency is FOR is seeing the
  // MAP, so the DOM HUD steps aside while a menu is open.  (The canvas-drawn
  // minimap and loadout strip stay: those are part of the game view.)
  //
  // A NEW FULL-SCREEN OVERLAY JOINS THIS PREDICATE — and that one line is all
  // it takes to get the debug menu too: DebugMenu floats its launcher over
  // any screen this says is up, and the panel itself floats over everything.
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
    <div className="absolute inset-0 pointer-events-none p-2 flex flex-col justify-between"
      onFocusCapture={e => { if ((e.target as HTMLElement).matches('button, input, select')) onAudioCue?.('ui.nav'); }}
      onClickCapture={e => { if ((e.target as HTMLElement).closest('button')) onAudioCue?.('ui.nav'); }}>

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

          {/* SCAN button — the touch device's dedicated scan control (the
              keyboard has Q, the pad has L1/Circle).  Rendered ONLY with a
              scanner aboard: a control for a tool you do not own is a control
              that does nothing.  It sits beside PAUSE, outside the wrapping
              readout band and `shrink-0` for the same reason pause is — an
              unshrinkable middle pushes the last item off a 320px screen.
              Its ring fills as the cooldown runs down, so "not yet" is
              visible without a number. */}
          {stats.gameState === GameState.PLAYING && !stats.dock?.docked && !stats.runSummary && stats.scanner && (
            <button
              onClick={onScan}
              disabled={stats.scanner.cooldown > 0}
              className={`pointer-events-auto shrink-0 rounded-lg p-2.5 ${TAP} min-w-[40px] flex items-center justify-center shadow-lg border backdrop-blur-[2px] transition-all active:scale-95 ${
                stats.scanner.cooldown > 0
                  ? 'bg-slate-900/25 border-slate-700/30 text-slate-500'
                  : 'bg-slate-900/35 hover:bg-slate-700/70 border-cyan-500/40 text-cyan-300'
              }`}
              aria-label={`Scan (Mk ${'I'.repeat(stats.scanner.mk)}, range ${stats.scanner.range})`}
              title={`Scan · Mk ${'I'.repeat(stats.scanner.mk)} · range ${stats.scanner.range}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                   fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
                <circle cx="12" cy="12" r="6" opacity={stats.scanner.ready > 0.5 ? 1 : 0.25} />
                <circle cx="12" cy="12" r="10" opacity={stats.scanner.ready >= 1 ? 1 : 0.25} />
              </svg>
            </button>
          )}

          {/* THE CONTROL COLUMN — PAUSE, with the DEBUG launcher stacked
              under it (the debug overhaul).  Under rather than beside: the
              readout row to the left is already width-bound — it wraps onto a
              second line at 390px in an arena — so a third fixed button in
              the row would push the chips onto more lines, while a column
              costs the chips nothing.  What it does cost is the top of the
              arrow band, which computeIndicatorRect reserves for it
              (UI_CONSTANTS.INDICATORS.CONTROL_COLUMN_INSET).  `shrink-0` for
              the reason pause always had it: an unshrinkable middle pushes
              the last item off a 320px screen. */}
          <div className="flex flex-col items-stretch gap-1 shrink-0" data-testid="hud-controls">
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
          <DebugLauncher open={debugPanelOpen} onToggle={toggleDebugPanel} />
          </div>
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
          className={`absolute inset-0 ${OVERLAY_SCRIM} flex flex-col items-center pointer-events-auto z-50 p-4 ${OVERLAY_FAB_CLEARANCE} overflow-y-auto overscroll-contain`} data-overlay="station">
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
                      {/*  A5 — the next HEX of this flower, sold beside the
                           things that go in it.  Absent once the flower is
                           full, which is every shipped run today, so the
                           grid is unchanged unless something locked a hex.
                           It costs no cargo: a slot is not an item. */}
                      {(() => {
                        const o = g === 'ship' ? out.shipSlotOffer : out.weaponSlotOffer;
                        if (!o) return null;
                        const buyable = o.available && o.affordable;
                        return (
                          <button
                            disabled={!buyable}
                            onClick={() => onPurchaseSlot?.(g)}
                            title={o.available
                              ? 'Unlock one more hex on this flower — it holds no cargo and needs no room'
                              : 'This station does not stock hardware for that flower'}
                            className={`${BTN_COMPACT} flex items-center justify-between gap-2 ${
                              buyable
                                ? 'bg-emerald-700/40 hover:bg-emerald-600/60 text-emerald-100'
                                : 'bg-slate-800/60 text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            <span className="font-bold">+1 Hex Slot</span>
                            <span className="tabular-nums">◈{o.cost.toLocaleString()}</span>
                          </button>
                        );
                      })()}
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
            className={`absolute inset-0 ${OVERLAY_SCRIM} flex flex-col items-center pointer-events-auto z-50 p-4 ${OVERLAY_FAB_CLEARANCE} overflow-y-auto overscroll-contain`} data-overlay="stage-clear"
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
            className={`absolute inset-0 ${OVERLAY_SCRIM} flex flex-col items-center pointer-events-auto z-50 p-4 ${OVERLAY_FAB_CLEARANCE} overflow-y-auto overscroll-contain`} data-overlay="death"
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
        <div className={`absolute inset-0 ${OVERLAY_SCRIM} flex flex-col items-center pointer-events-auto z-50 overflow-y-auto overscroll-contain p-6 ${OVERLAY_FAB_CLEARANCE}`} data-overlay="menu">
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
          className={`absolute inset-0 ${OVERLAY_SCRIM} flex flex-col items-center pointer-events-auto z-50 p-4 ${OVERLAY_FAB_CLEARANCE} overflow-y-auto overscroll-contain`} data-overlay="pause">
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

            {/* Scanner — the one setting the instrument has.  A player-facing
                row rather than a debug one (user call): auto-scan changes how
                the game plays, not how it is developed.  Rendered only with a
                scanner aboard that can actually do it, so the row is never a
                switch for something that would not happen either way. */}
            {stats.scanner && stats.scanner.autoCapable && (
              <div className={`${PANEL} flex flex-col gap-2`}>
                <h3 className={`text-sky-300 ${HEADING}`}>Scanner</h3>
                <div className={`flex items-center justify-between gap-3 ${PANEL_ROW}`}>
                  <span className="text-left">
                    <span className={`block text-slate-200 ${T_ROW}`}>Auto-scan</span>
                    <span className={`block text-slate-400 ${T_MICRO}`}>
                      Sweeps for moving contacts on its own. Minimap only — no arrows.
                    </span>
                  </span>
                  <button
                    data-testid="auto-scan-toggle"
                    onClick={() => onSetAutoScan?.(!stats.scanner!.autoOn)}
                    aria-pressed={stats.scanner.autoOn}
                    className={`${BTN_COMPACT} shrink-0 ${
                      stats.scanner.autoOn
                        ? 'bg-cyan-600/80 border-cyan-400/60 text-white'
                        : 'bg-slate-800/70 border-slate-600/60 text-slate-300'
                    }`}
                  >
                    {stats.scanner.autoOn ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
            )}

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

            {(['SFX', 'Music'] as const).map(category => {
              const value = category === 'SFX' ? stats.audio?.sfxVolume : stats.audio?.musicVolume;
              return <label key={category} className={`mx-auto w-full max-w-xs flex items-center gap-3 ${PANEL_ROW}`}>
                <span className={`w-12 text-slate-300 ${T_BODY}`}>{category}</span>
                <input type="range" min={0} max={100} step={1}
                  aria-label={`${category} volume`} value={Math.round((value ?? 1) * 100)}
                  onChange={e => (category === 'SFX' ? onSetSfxVolume : onSetMusicVolume)?.(Number(e.target.value) / 100)}
                  className={`min-w-0 flex-1 pointer-events-auto accent-sky-400 ${TAP}`} />
                <span className={`w-10 text-right text-slate-400 ${T_BODY}`}>{Math.round((value ?? 1) * 100)}%</span>
              </label>;
            })}
            <p className={`mx-auto max-w-xs text-slate-500 ${T_BODY}`}>Music: <a href="https://opengameart.org/content/space-ambient" target="_blank" rel="noreferrer" className="pointer-events-auto underline">Space ambient — Osmic</a> · <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer" className="pointer-events-auto underline">CC BY 3.0</a></p>
            {/* The battle playlist is three separately-licensed CC-BY tracks,
                and AUDIO_CREDITS.md promises their attribution is visible
                HERE — so every one is named with its own creator and its own
                licence version.  Two of the three are CC BY 3.0 and one is
                4.0; a single shared licence link would misattribute one of
                them. */}
            <p className={`mx-auto max-w-xs text-slate-500 ${T_BODY}`}>Battle: <a href="https://opengameart.org/content/techno-space" target="_blank" rel="noreferrer" className="pointer-events-auto underline">Fly — Alexandr Zhelanov</a> · <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer" className="pointer-events-auto underline">CC BY 3.0</a> — <a href="https://opengameart.org/content/tracers" target="_blank" rel="noreferrer" className="pointer-events-auto underline">Tracers — Sygil</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer" className="pointer-events-auto underline">CC BY 4.0</a> — <a href="https://opengameart.org/content/countdown-0" target="_blank" rel="noreferrer" className="pointer-events-auto underline">Countdown — Alexandr Zhelanov</a> · <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer" className="pointer-events-auto underline">CC BY 3.0</a></p>

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

          </div>
        </div>
        );
      })()}

      {/* ── The debug panel ── LAST, on purpose.  It floats above every
          screen above (z-[60] over their z-50), and the gamepad menu driver
          treats the last visible [data-overlay] as the live one, so while the
          panel is open the D-pad moves inside it whatever is underneath.
          Its launcher is in the HUD's control column during live play and
          floats bottom-right over any overlay — keyed on the same
          `overlayUp` that hides the HUD, so a new overlay that joins that
          predicate (which it must) gets the debug menu with no wiring. */}
      <DebugMenu
        stats={stats}
        overlayUp={overlayUp}
        engine={engine}
        mapType={mapType}
        onSetMapType={t => onSetMapType?.(t)}
        renderScaleName={renderScaleName ?? '3x'}
        onCycleRenderScale={() => onCycleRenderScale?.()}
      />

    </div>
  );
};

export default UIOverlay;
