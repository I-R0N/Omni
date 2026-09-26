/** THE DEBUG PANEL — one component, reachable from every screen.
 *
 *  It used to exist twice: a map-and-enemy-test dropdown on the main menu, and
 *  ~800 lines of hand-written sections inside the pause menu, which was the
 *  only place most of it could be reached.  Now there is ONE panel, it renders
 *  whatever `debugSections.tsx` declares, and it floats ABOVE whichever screen
 *  is up — main menu, live play, pause, every station tab, death, stage-clear.
 *
 *  Why a FLOAT and not a section inside each screen: a future overlay then
 *  gets the panel with no wiring at all.  The panel is last in the overlay's
 *  DOM and tagged `[data-overlay]`, which is all the gamepad menu driver needs
 *  to navigate it; the launcher reads the same `overlayUp` UIOverlay already
 *  computes to hide the HUD, which a new overlay has to join anyway.
 *
 *  Why a launcher at all (the old floating DBG button was REMOVED in 1e,
 *  commit 8a4b0e2): that button was a 10px chip in the top-left corner that
 *  also switched the renderer's debug overlays on, and the panel it opened
 *  streamed over the play area on a pointer-events-NONE backing — so a tap
 *  between two rows went straight through to the canvas and fired the gun —
 *  with no scroll, on a phone.  Every one of those is answered here: the
 *  launcher clears the 40px tap floor and has its own slot (stacked under
 *  PAUSE, with the arrow band re-measured around it — see
 *  `UI_CONSTANTS.INDICATORS.CONTROL_COLUMN_INSET`); it opens a panel and does
 *  nothing else (the renderer overlays are their own row); the panel catches
 *  every pointer (pointer-events on, over a SEE-THROUGH backing — see
 *  `PANEL_SEE_THROUGH` — with a ◐ toggle to a solid one) and scrolls; and it
 *  docks to the BOTTOM of the screen, leaving the ship and the top half of the
 *  world visible.
 *
 *  WHAT A ROW DOES is one hover, long-press or focus away: every item carries
 *  a one-line summary and its old tooltip behind "More", and `debugHelp.tsx`
 *  shows them in a popup — see that file for why a `title` attribute could
 *  not (a phone has no hover).
 *
 *  OPEN STATE IS THE ENGINE'S (`GameEngine.debugPanelOpen`), not React's:
 *  three devices open it — this launcher, the ` key, a pad's Select/Share —
 *  and three engine paths read it (the ❄ freeze, the pad capture, the
 *  panel-only stats).  Everything else here is panel-local UI state, kept in
 *  memory only, which is what makes it survive the panel closing and the
 *  screen changing under it (this component stays mounted on every screen).
 */
import React, { useEffect, useRef, useState } from 'react';
import type { GameEngine } from '../engine/GameEngine';
import { EngineStats, MapType } from '../types';
import { PANEL_OPAQUE, PANEL_SEE_THROUGH, T_MICRO, T_NOTE, T_BODY, TAP, CHIP_BASE } from './uiClasses';
import {
  DEBUG_GROUPS, DEBUG_SECTIONS, ROW_LABEL, STAT_ROW, DEBUG_CHIP_OFF, keepFocus,
  type DebugCtx, type DebugRow, type DebugSection, type DebugGroupId, type EntityCountMode,
} from './debugSections';
import { useRowHelp } from './debugHelp';

// ── The launcher ─────────────────────────────────────────────────────────

/**
 * The DBG button.  One component, two homes: UIOverlay stacks it under PAUSE
 * in live play (the HUD's top-right control column), and `DebugMenu` floats
 * it in the bottom-right corner over any full-screen overlay.
 *
 * `keepFocus` on mousedown is load-bearing, not cosmetic: a clicked button
 * keeps keyboard focus, and keys pressed at a focused debug control never
 * reach the ship (InputSystem.isUiKeyTarget) — so without it, one click on
 * the launcher would leave WASD dead until something else took focus.
 */
export function DebugLauncher({ open, onToggle, className = '' }: {
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      data-testid="debug-launcher"
      data-debug-ui=""
      onMouseDown={keepFocus}
      onClick={onToggle}
      aria-label="Debug menu"
      aria-expanded={open}
      title="Debug menu — the ` key on a keyboard, Select / Share on a pad"
      className={`pointer-events-auto shrink-0 rounded-lg ${TAP} min-w-[40px] px-1 flex items-center justify-center font-mono font-bold ${T_NOTE} tracking-widest border shadow-lg backdrop-blur-[2px] transition-all active:scale-95 ${
        open
          ? 'bg-amber-500/30 border-amber-400/70 text-amber-200'
          : 'bg-slate-900/35 hover:bg-slate-700/70 border-amber-500/30 text-amber-300/80'
      } ${className}`}
    >
      DBG
    </button>
  );
}

// ── Filtering ────────────────────────────────────────────────────────────

/** Lower-cased, with the tree glyphs the labels use for hierarchy (`↳`, `·`)
 *  and runs of space folded, so "neb bond" finds "Neb bond" and "range" finds
 *  "  ↳ range". */
const norm = (s: string) => s.toLowerCase().replace(/[↳·]/g, ' ').replace(/\s+/g, ' ').trim();

/** What a row is FOUND by.  The first string is its names — its label, and a
 *  chip row's chip labels, so "warden" finds the boss row — and the second is
 *  its descriptions (the one-line summary and the long detail), matched only
 *  when the names are not. */
function rowHaystacks(row: DebugRow, c: DebugCtx): [string, string] {
  switch (row.kind) {
    case 'chips': {
      const list = row.chips(c);
      return [
        `${row.label} ${list.map(x => x.label).join(' ')}`,
        list.map(x => `${x.summary ?? ''} ${x.detail ?? ''}`).join(' '),
      ];
    }
    case 'each': return [row.label, ''];
    default: return [row.label, `${row.summary ?? ''} ${row.detail ?? ''}`];
  }
}

/** Every row a section shows, with the render-time rows (`each`) expanded. */
function flatRows(section: DebugSection, c: DebugCtx): DebugRow[] {
  const out: DebugRow[] = [];
  for (const r of section.rows) {
    if (r.kind === 'each') out.push(...r.rows(c));
    else out.push(r);
  }
  return out;
}

interface Hit { section: DebugSection; rows: DebugRow[] }

/** Sections and their matching rows, in panel order.  A query's words must
 *  ALL appear (in any order) — in the row's names, or in its group and
 *  section names, for a NAME hit; failing that, anywhere in its tooltip for a
 *  DESCRIPTION hit.  Labels are terse ("Local grav", "Plr↔neb"), so the
 *  description tier is what finds a row by the thing it actually does. */
function filterSections(query: string, c: DebugCtx): { names: Hit[]; descriptions: Hit[] } {
  const words = norm(query).split(' ').filter(Boolean);
  const names: Hit[] = [];
  const descriptions: Hit[] = [];
  const groupLabel = (id: DebugGroupId) => DEBUG_GROUPS.find(g => g.id === id)?.label ?? '';
  for (const section of DEBUG_SECTIONS) {
    if (section.when && !section.when(c)) continue;
    const where = norm(`${groupLabel(section.group)} ${section.label}`);
    const n: DebugRow[] = [];
    const d: DebugRow[] = [];
    for (const row of flatRows(section, c)) {
      const [name, desc] = rowHaystacks(row, c);
      const nameHay = `${where} ${norm(name)}`;
      if (words.every(w => nameHay.includes(w))) n.push(row);
      else if (words.every(w => `${nameHay} ${norm(desc)}`.includes(w))) d.push(row);
    }
    if (n.length) names.push({ section, rows: n });
    if (d.length) descriptions.push({ section, rows: d });
  }
  return { names, descriptions };
}

// ── Row rendering ────────────────────────────────────────────────────────
//
// PLAIN FUNCTIONS, NOT COMPONENTS.  The overlay re-renders ~60 times a second
// from the stats stream; a component TYPE declared inside a render is a new
// type every time, and React unmounts and remounts it — the churn that once
// swallowed touch input on this very panel (docs/GAME_FEEDBACK_PLAN.md, the
// g2 DBG rebuild).  A function call inlines its elements into the parent
// tree instead, and the row DATA is module-scope, so nothing here gets a new
// identity per frame.

/** The value BUTTON of a control row.  The 22px floor is the debug menu's
 *  deliberate exception to the 40px tap floor (5d, D4): a developer surface
 *  of ~150 rows trades reach for density.  Its fill is translucent like the
 *  panel's (the see-through backing), and its border and text carry it. */
const CTRL_BUTTON =
  `bg-slate-800/55 border border-slate-600/60 rounded px-1.5 py-1 min-h-[22px] ${T_MICRO} ` +
  'font-bold text-slate-200 hover:border-amber-400/70 hover:text-amber-300 transition-colors ' +
  'text-right break-all';

/** Every row carries two hooks: `data-debug-row` (its label — the row's
 *  identity, which suites address it by) and `data-debug-kind` (which of the
 *  shapes it is, so a suite can sweep the controls without also firing the
 *  map and spawn chips).  A row with a description also carries the three
 *  `data-help*` attributes the description popup reads (`debugHelp.tsx`); a
 *  chip carries its own, since a chip has no row label to press. */
function renderRow(row: DebugRow, c: DebugCtx, key: string): React.ReactNode {
  switch (row.kind) {
    case 'ctrl':
      return (
        <div key={key} data-debug-row={row.label} data-debug-kind="ctrl"
          data-help={row.summary} data-help-title={row.label} data-help-detail={row.detail}
          className="mt-1 flex items-center justify-between gap-2">
          <span className={`${ROW_LABEL} shrink-0`}>{row.label}</span>
          <button
            onMouseDown={keepFocus}
            onClick={() => row.act(c)}
            className={`${CTRL_BUTTON} min-w-0`}
          >
            {row.value(c)}
          </button>
        </div>
      );
    case 'stat':
      return (
        <div key={key} data-debug-row={row.label} data-debug-kind="stat"
          data-help={row.summary} data-help-title={row.label} data-help-detail={row.detail}
          className={STAT_ROW}>
          <span className="whitespace-pre shrink-0">{row.label}</span>
          <span className={`${row.tone ? row.tone(c) : 'text-white'} min-w-0 text-right break-all`}>{row.value(c)}</span>
        </div>
      );
    case 'buttons':
      return (
        <div key={key} data-debug-row={row.label} data-debug-kind="buttons"
          data-help={row.summary} data-help-title={row.label} data-help-detail={row.detail}
          className="mt-1 flex items-center justify-between gap-1">
          <span className={ROW_LABEL}>{row.label}</span>
          <span className="flex gap-0.5">
            {row.buttons.map(b => (
              <button
                key={b.label}
                onMouseDown={keepFocus}
                onClick={() => b.act(c)}
                className={`bg-slate-800/55 border border-slate-600/60 rounded px-1 py-0.5 min-h-[22px] ${T_MICRO} font-bold text-slate-200 hover:border-amber-400/70 hover:text-amber-300 transition-colors`}
              >
                {b.label}
              </button>
            ))}
          </span>
        </div>
      );
    case 'chips':
      // The discrete button GROUPS keep the full chip size: they are ordinary
      // chips and take the 40px floor like every other chip (5d, D4).
      return (
        <div key={key} data-debug-row={row.label} data-debug-kind="chips" className="flex flex-wrap gap-2 px-1 py-1">
          {row.chips(c).map(ch => (
            <button
              key={ch.key}
              onMouseDown={keepFocus}
              onClick={() => ch.act(c)}
              data-help={ch.summary}
              data-help-title={ch.label}
              data-help-detail={ch.detail}
              className={`${CHIP_BASE} ${ch.capitalize ? 'capitalize ' : ''}${
                ch.active ? (ch.on ?? '') : `${DEBUG_CHIP_OFF} ${ch.hover}`
              }`}
            >
              {ch.label}
            </button>
          ))}
        </div>
      );
    case 'custom':
      // `contents`: the wrapper carries the row's hooks without adding a box
      // of its own, so a custom row lays out exactly as its JSX says (the
      // popup measures the row's first child instead).
      return (
        <div key={key} data-debug-row={row.label} data-debug-kind="custom"
          data-help={row.summary} data-help-title={row.label} data-help-detail={row.detail}
          className="contents">
          {row.render(c)}
        </div>
      );
    case 'each':
      return <React.Fragment key={key}>{row.rows(c).map((r, i) => renderRow(r, c, `${key}.${i}`))}</React.Fragment>;
  }
}

// ── The panel ────────────────────────────────────────────────────────────

export interface DebugMenuProps {
  stats: EngineStats;
  /** A full-screen overlay is up — UIOverlay's own `overlayUp`, the predicate
   *  that already hides the HUD.  Decides where the launcher lives: with no
   *  overlay it is in the HUD's control column (UIOverlay renders it there),
   *  with one this component floats it in the bottom-right corner. */
  overlayUp: boolean;
  /** The live engine, for actions.  Rows never read game data from it. */
  engine: () => GameEngine | null;
  mapType: MapType;
  onSetMapType: (t: MapType) => void;
  renderScaleName: string;
  onCycleRenderScale: () => void;
}

/** Panel-local open state for one group or section, by key.  Absent means
 *  "whatever it starts as" — sections that declare `defaultOpen` start open,
 *  everything else closed. */
type OpenMap = Record<string, boolean>;

export default function DebugMenu({
  stats, overlayUp, engine, mapType, onSetMapType, renderScaleName, onCycleRenderScale,
}: DebugMenuProps) {
  // The engine owns open/closed.  A payload WITHOUT the field (the initial
  // placeholder App renders before the first push) must not read as "closed"
  // over a panel that is open, so the last known state is held.
  const lastPanel = useRef(stats.debugPanel);
  if (stats.debugPanel) lastPanel.current = stats.debugPanel;
  const panel = lastPanel.current;
  const open = panel?.open === true;

  // ── In-memory panel state (survives closing, and every screen change) ──
  const [openMap, setOpenMap] = useState<OpenMap>({});
  const [query, setQuery] = useState('');
  const [tall, setTall] = useState(false);
  /** See-through (the default over live play — user call) or solid.
   *  Remembered like the size, in memory only: a scene too bright to read
   *  through is a moment, not a preference.  Over a full-screen overlay the
   *  panel is solid regardless (`seeThrough`, below). */
  const [solid, setSolid] = useState(false);
  const [entityCountMode, setEntityCountMode] = useState<EntityCountMode>('total');
  const [perfCopyText, setPerfCopyText] = useState('');
  const [perfCopied, setPerfCopied] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The description popup: hover, long-press or focus an item to read it.
  const help = useRowHelp(panelRef, open);

  // Opened from the KEYBOARD: put the caret in the filter, so the shortcut is
  // "` then type".  Only for the keyboard — on touch, focusing a text field
  // raises the soft keyboard over the panel that just opened, and a pad user
  // navigates with the D-pad, whose first press adopts focus on its own.
  useEffect(() => {
    if (open && panel?.via === 'key') filterRef.current?.focus();
  }, [open, panel?.via]);

  // Tell the engine WHERE the panel is, so the canvas HUD steps out from
  // under it (`RenderSystem.hudHole`) — the panel is see-through, and a
  // minimap or loadout strip ghosting under its rows is noise, not world.
  // Measured by the DOM on its own schedule — on open, when the panel resizes
  // (the ▴ toggle, a viewport change) and on a window resize, which can move
  // a width-capped panel without resizing it — never by the canvas per frame.
  useEffect(() => {
    const el = panelRef.current;
    if (!open || !el) { engine()?.setDebugPanelRect(null); return; }
    const report = () => {
      const r = el.getBoundingClientRect();
      engine()?.setDebugPanelRect({ x: r.left, y: r.top, w: r.width, h: r.height });
    };
    report();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(report) : null;
    ro?.observe(el);
    window.addEventListener('resize', report);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', report);
      engine()?.setDebugPanelRect(null);
    };
  }, [open]);

  const toggle = () => engine()?.toggleDebugPanel('pointer');
  const close = () => engine()?.setDebugPanelOpen(false);

  if (!open) {
    // Closed.  In live play the launcher is in the HUD's control column
    // (UIOverlay); over a full-screen overlay it floats here, bottom-right,
    // where every overlay leaves room for it (`OVERLAY_FAB_CLEARANCE`).
    return overlayUp
      ? <DebugLauncher open={false} onToggle={toggle} className="absolute bottom-2 right-2 z-[60]" />
      : null;
  }

  const c: DebugCtx = {
    s: stats,
    engine,
    app: { mapType, setMapType: onSetMapType, renderScaleName, cycleRenderScale: onCycleRenderScale },
    ui: {
      entityCountMode,
      setEntityCountMode,
      perfCopyText,
      perfCopied,
      copyPerfReport: () => {
        const text = engine()?.perfRecExport() ?? '';
        setPerfCopyText(text);
        setPerfCopied(false);
        // Best-effort async clipboard write (works on iOS Safari inside the
        // tap); the textarea beneath is the always-available fallback.
        try {
          navigator.clipboard?.writeText(text).then(() => setPerfCopied(true)).catch(() => {});
        } catch { /* fall through to the textarea */ }
      },
      dismissPerfReport: () => { setPerfCopyText(''); setPerfCopied(false); },
    },
  };

  const isOpen = (key: string, dflt = false) => openMap[key] ?? dflt;
  // Folding a group or section moves every row under it, so a description
  // showing for one of them goes too.
  const flip = (key: string, dflt = false) => {
    help.dismiss();
    setOpenMap(prev => ({ ...prev, [key]: !(prev[key] ?? dflt) }));
  };

  const visible = (s: DebugSection) => !s.when || s.when(c);
  const searching = norm(query).length > 0;
  const results = searching ? filterSections(query, c) : null;

  /** ❄ Freeze only means something over LIVE play: every other screen either
   *  freezes on its own or — the death screen — must never freeze. */
  const live = !overlayUp;
  /** SEE-THROUGH ONLY OVER LIVE PLAY.  Over a full-screen overlay (the menu,
   *  pause, a station, death, stage-clear) what would show through the panel
   *  is not the world but that overlay's own rows of text, colliding with the
   *  panel's — the double-vision the DOM HUD is already hidden from behind an
   *  overlay.  So there the backing is solid whatever the ◐ toggle says, and
   *  the toggle, like ❄ Freeze, is only offered over live play. */
  const seeThrough = live && !solid;

  const sectionHeader = (s: DebugSection) => (
    <button
      key={`h:${s.id}`}
      data-debug-section={s.id}
      onMouseDown={keepFocus}
      onClick={() => flip(`s:${s.id}`, s.defaultOpen)}
      aria-expanded={isOpen(`s:${s.id}`, s.defaultOpen)}
      /* Same deliberate density exception as the rows (5d, D4). */
      className={`mt-1 w-full min-h-[24px] flex items-center justify-between text-slate-300/80 hover:text-amber-300 uppercase tracking-wider ${T_MICRO} transition-colors`}
      title={`Toggle ${s.label} section`}
    >
      <span>{s.label}</span>
      <span className="text-slate-500">{isOpen(`s:${s.id}`, s.defaultOpen) ? '▾' : '▸'}</span>
    </button>
  );

  const sectionRows = (s: DebugSection) => s.rows.map((r, i) => renderRow(r, c, `${s.id}:${i}`));

  const hitList = (hits: Hit[], tier: string) => hits.map(h => (
    <div key={`${tier}:${h.section.id}`} className="mt-2">
      <div className={`${T_MICRO} uppercase tracking-wider text-amber-300/70`}>
        {DEBUG_GROUPS.find(g => g.id === h.section.group)?.label} ▸ {h.section.label}
      </div>
      {h.rows.map((r, i) => renderRow(r, c, `${tier}:${h.section.id}:${i}`))}
    </div>
  ));

  return (
    <>
    <div
      ref={panelRef}
      /* THE GAMEPAD DRIVER SCOPES BY THIS TAG: the last visible
         `[data-overlay]` is the live one, and this panel renders after every
         other overlay, so while it is open the D-pad moves inside it.
         `data-debug-ui` is InputSystem's: keys typed in here never reach the
         ship, and a pointer over it never aims it. */
      data-overlay="debug"
      data-debug-ui=""
      data-testid="debug-panel"
      data-backing={seeThrough ? 'see-through' : 'solid'}
      role="dialog"
      aria-label="Debug menu"
      /* The description popup's hover / long-press / focus handlers, one set
         for the whole panel (`debugHelp.tsx`). */
      {...help.panelHandlers}
      /* DOCKED TO THE BOTTOM, 45% tall by default: the ship sits at screen
         centre, so this leaves it — and the top half of the world, and the
         HUD's top row — in view while a knob is turned.  `dvh`, not `vh`, so
         a phone's collapsing toolbar cannot push the panel's foot off the
         screen.  On a TOUCH screen nothing in it selects as text: a
         long-press here asks for a description, and iOS would otherwise
         answer it with a selection handle and a callout first. */
      className={`absolute inset-x-2 bottom-2 z-[60] mx-auto max-w-xl pointer-events-auto flex flex-col ${
        seeThrough ? PANEL_SEE_THROUGH : PANEL_OPAQUE
      } border border-amber-500/40 rounded-xl shadow-2xl overflow-hidden pointer-coarse:select-none [-webkit-touch-callout:none] ${
        tall ? 'h-[85dvh]' : 'h-[45dvh]'
      }`}
    >
      {/* ── Header: never scrolls ── */}
      <div className="flex-none flex flex-col gap-1.5 px-2 pt-2 pb-1.5 border-b border-slate-700/60">
        <div className="flex items-center gap-1.5">
          <span className={`font-mono font-bold ${T_BODY} tracking-[0.2em] text-amber-300 mr-auto`}>DEBUG</span>
          {live && (
            <button
              data-testid="debug-freeze"
              onMouseDown={keepFocus}
              onClick={() => engine()?.setDebugFreeze(!panel?.freeze)}
              aria-pressed={panel?.freeze === true}
              data-help="Hold the game while this panel is open, like pause."
              data-help-title="❄ Freeze"
              data-help-detail="Off (default) keeps the world running so a setting can be watched taking effect. Never holds a dying or dead ship — the death screen always runs live."
              className={`min-h-[32px] px-2 rounded border ${T_NOTE} font-bold uppercase tracking-wider transition-colors ${
                panel?.freeze
                  ? 'bg-sky-600/40 border-sky-400/70 text-sky-100'
                  : 'bg-slate-800/55 border-slate-600/60 text-slate-300 hover:border-sky-400/70'
              }`}
            >
              ❄ Freeze {panel?.freeze ? 'On' : 'Off'}
            </button>
          )}
          {live && (
            <button
              data-testid="debug-solid"
              onMouseDown={keepFocus}
              onClick={() => setSolid(v => !v)}
              aria-pressed={solid}
              aria-label={solid ? 'See-through debug panel' : 'Solid debug panel'}
              data-help={solid
                ? 'The panel has a solid backing. Tap for see-through, to watch the world behind it.'
                : 'The world shows through the panel. Tap for a solid backing, for reading over a bright scene.'}
              data-help-title="Backing"
              data-help-detail="Only offered over live play. Over a menu, pause, a station, death or stage-clear the panel is always solid: what would show through there is that screen's own text, not the world."
              className={`min-h-[32px] min-w-[32px] rounded border ${T_BODY} transition-colors ${
                solid
                  ? 'bg-slate-700/80 border-slate-400/70 text-slate-100'
                  : 'bg-slate-800/55 border-slate-600/60 text-slate-300 hover:border-amber-400/70'
              }`}
            >
              {solid ? '●' : '◐'}
            </button>
          )}
          <button
            data-testid="debug-size"
            onMouseDown={keepFocus}
            onClick={() => { help.dismiss(); setTall(t => !t); }}
            aria-label={tall ? 'Shorter debug panel' : 'Taller debug panel'}
            data-help={tall ? 'Shorter — see more of the world.' : 'Taller — see more rows.'}
            data-help-title="Panel size"
            className={`min-h-[32px] min-w-[32px] rounded border bg-slate-800/55 border-slate-600/60 text-slate-300 hover:border-amber-400/70 ${T_BODY}`}
          >
            {tall ? '▾' : '▴'}
          </button>
          <button
            data-testid="debug-close"
            onMouseDown={keepFocus}
            onClick={close}
            aria-label="Close debug menu"
            title="Close (Esc, the ` key, or the pad's BACK / Select)"
            className={`min-h-[32px] min-w-[32px] rounded border bg-slate-800/55 border-slate-600/60 text-slate-300 hover:border-rose-400/70 hover:text-rose-200 ${T_BODY}`}
          >
            ✕
          </button>
        </div>
        <input
          ref={filterRef}
          type="search"
          data-testid="debug-filter"
          value={query}
          onChange={e => { help.dismiss(); setQuery(e.target.value); }}
          /* Escape in a filter with text in it CLEARS the filter and stops
             there — the engine closes the panel on an Escape that reaches
             the window, and a query typed to find one row should not cost
             the panel.  The next Escape, on an empty box, closes it. */
          onKeyDown={e => {
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              e.stopPropagation();
              setQuery('');
            }
          }}
          placeholder="Filter rows — e.g. neb bond, portal, warden"
          aria-label="Filter debug rows"
          className={`w-full min-h-[32px] bg-slate-900/70 border border-slate-600 rounded px-2 ${T_BODY} text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none`}
        />
      </div>

      {/* ── Body: the groups, or the filter's results.  Scrolling moves
             every row out from under an open description, so it closes it. ── */}
      <div
        onScroll={help.scrolled}
        className={`flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pb-2 font-mono ${T_MICRO} leading-tight text-slate-300/90`}
      >
        {results ? (
          results.names.length === 0 && results.descriptions.length === 0 ? (
            <p className={`mt-3 ${T_NOTE} text-slate-500`}>No row matches “{query.trim()}”.</p>
          ) : (
            <>
              {hitList(results.names, 'n')}
              {results.descriptions.length > 0 && (
                <>
                  <div className={`mt-3 pt-2 border-t border-slate-700/60 ${T_MICRO} uppercase tracking-wider text-slate-500`}>
                    Mentioned in descriptions
                  </div>
                  {hitList(results.descriptions, 'd')}
                </>
              )}
            </>
          )
        ) : (
          DEBUG_GROUPS.map(g => {
            const sections = DEBUG_SECTIONS.filter(s => s.group === g.id && visible(s));
            if (sections.length === 0) return null;
            const gOpen = isOpen(`g:${g.id}`);
            return (
              <div key={g.id} className="border-b border-slate-700/40 last:border-0">
                <button
                  data-debug-group={g.id}
                  onMouseDown={keepFocus}
                  onClick={() => flip(`g:${g.id}`)}
                  aria-expanded={gOpen}
                  className={`w-full min-h-[32px] flex items-center justify-between font-sans ${T_BODY} font-bold uppercase tracking-widest text-amber-300/90 hover:text-amber-200 transition-colors`}
                >
                  <span>{g.label}</span>
                  <span className="text-slate-500">{gOpen ? '▾' : '▸'}</span>
                </button>
                {gOpen && (
                  <div className="pb-2">
                    {sections.length === 1
                      /* A one-section group shows its rows directly — a
                         header that repeats the group's own subject is a tap
                         that buys nothing. */
                      ? sectionRows(sections[0])
                      : sections.map(s => (
                        <React.Fragment key={s.id}>
                          {sectionHeader(s)}
                          {isOpen(`s:${s.id}`, s.defaultOpen) && sectionRows(s)}
                        </React.Fragment>
                      ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
    {help.popup}
    </>
  );
}
