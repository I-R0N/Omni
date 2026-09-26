/** THE DEBUG PANEL'S DESCRIPTION POPUP — what an item does, on demand.
 *
 *  Every debug item carries a one-line SUMMARY and, for most, the long
 *  explanation it used to show as a `title` tooltip (`DebugHelp` in
 *  `debugSections.tsx`).  A `title` tooltip only ever existed for a MOUSE: a
 *  phone has no hover, so on the device this game is designed for (390×844,
 *  played on an iPhone) not one of those descriptions could be read.  This
 *  popup replaces them, and one popup answers every device:
 *
 *  - MOUSE / PEN HOVER — rest on an item for `DWELL_MS`.  Once a popup is up,
 *    moving onto the next item swaps it at once (`WARM_MS`), so reading down
 *    a column does not re-pay the wait; moving INTO the popup keeps it open,
 *    with `GRACE_MS` to cross the gap, so its "More" is reachable.
 *  - TOUCH LONG-PRESS — hold an item for `LONG_PRESS_MS` without drifting
 *    more than `SLOP_PX` (further is a scroll).  The popup then STAYS until
 *    the next tap anywhere, and the press does NOT also act: the click a
 *    browser sends when the finger lifts is swallowed, so long-pressing a
 *    boss chip to read it does not warp a boss in.  Android's own long-press
 *    (`contextmenu`) takes the same road.  A mouse right-click is left alone
 *    — on a desktop that is the browser's menu, and hover already answers.
 *  - KEYBOARD / PAD FOCUS — rest focus on an item (Tab, or the D-pad's menu
 *    driver) for `DWELL_MS`.  Panel buttons only ever take focus from a key
 *    or a pad (every one refuses mouse focus — `keepFocus`), so this cannot
 *    fire from a click.
 *
 *  THE POPUP LIVES OUTSIDE THE PANEL'S DOM, on purpose.  The panel clips its
 *  children (rounded, `overflow-hidden`), and a popup for a row near the
 *  panel's top edge has to sit ABOVE it, over the world; and outside
 *  `[data-overlay]` the gamepad's menu driver never walks into it.  It
 *  carries `data-debug-ui`, so InputSystem treats it as part of the panel: a
 *  pointer resting on it never aims the ship and a tap on it never fires.
 *
 *  ITEMS ARE FOUND BY DELEGATION, not by per-row handlers.  The panel
 *  re-renders ~60 times a second from the stats stream, and nine handler
 *  closures on every row every frame would be garbage for nothing.  An item
 *  is any element carrying `data-help` (its summary), with `data-help-title`
 *  and `data-help-detail` beside it; React writes those once and then diffs
 *  identical strings, so they cost nothing per frame either.
 */
import React, { useEffect, useRef, useState } from 'react';
import { T_MICRO, T_NOTE, T_BODY } from './uiClasses';
import { keepFocus } from './debugSections';

/** A resting pointer or focus waits this long — long enough that sweeping the
 *  mouse across the panel on the way to a button does not trail popups. */
export const DWELL_MS = 500;
/** How long a finger must rest before a press asks for the description
 *  instead of acting — the platform's own long-press length. */
export const LONG_PRESS_MS = 500;
/** How far a resting finger may drift before the press is read as a scroll. */
const SLOP_PX = 10;
/** Time to cross from an item into its popup before a hover popup closes. */
const GRACE_MS = 150;
/** After a hover popup closes, the next item opens at once for this long. */
const WARM_MS = 400;
/** Gap between an item and its popup, and the popup's margin from an edge. */
const GAP_PX = 6;
const EDGE_PX = 8;
/** With less room than this above an item, the popup opens BELOW it. */
const MIN_ROOM_PX = 120;
const MAX_WIDTH_PX = 340;

/** The popup's element id — also what `aria-describedby` points at while a
 *  focused control's description is showing. */
export const HELP_ID = 'debug-help';

type Via = 'hover' | 'press' | 'focus';

interface Placement { left: number; top: number; width: number; maxHeight: number; above: boolean }

interface Tip extends Placement {
  anchor: HTMLElement;
  title: string;
  summary: string;
  detail: string | null;
  via: Via;
}

const itemOf = (t: EventTarget | null): HTMLElement | null =>
  t instanceof Element ? t.closest<HTMLElement>('[data-help]') : null;

/** Text fields and pickers keep their own long-press (select, paste). */
const isField = (t: EventTarget | null): boolean =>
  t instanceof Element && t.closest('input, select, textarea') !== null;

const inPopup = (t: EventTarget | null): boolean =>
  t instanceof Element && t.closest(`#${HELP_ID}`) !== null;

/** Labels carry their hierarchy in leading glyphs (`  ↳ range`, the timing
 *  tree's ` ·physics`); the popup's heading drops them. */
const cleanTitle = (s: string): string => s.replace(/^[\s ↳·]+/, '');

/** Where the popup goes: ABOVE the item when there is room (the finger or
 *  cursor is on the item, and the next row down is where it is headed), else
 *  below; as wide as the panel allows up to `MAX_WIDTH_PX`, never outside the
 *  panel's own edges.  Viewport coordinates, for `position: fixed`. */
function place(anchor: HTMLElement, panel: HTMLElement): Placement {
  let r = anchor.getBoundingClientRect();
  // A `display: contents` wrapper (the custom rows) has no box of its own.
  if (r.width === 0 && r.height === 0 && anchor.firstElementChild) {
    r = anchor.firstElementChild.getBoundingClientRect();
  }
  const p = panel.getBoundingClientRect();
  const width = Math.max(160, Math.min(p.width - 2 * EDGE_PX, MAX_WIDTH_PX));
  const left = Math.max(p.left + EDGE_PX, Math.min(r.left, p.right - EDGE_PX - width));
  const roomAbove = r.top - GAP_PX - EDGE_PX;
  const roomBelow = window.innerHeight - r.bottom - GAP_PX - EDGE_PX;
  const above = roomAbove >= MIN_ROOM_PX || roomAbove >= roomBelow;
  // Above: `top` is the item's top edge and the popup is lifted by its own
  // height (translateY(-100%)), so a popup of any length ends just above the
  // item without being measured first.
  return above
    ? { left, width, above, top: r.top - GAP_PX, maxHeight: Math.max(48, roomAbove) }
    : { left, width, above, top: r.bottom + GAP_PX, maxHeight: Math.max(48, roomBelow) };
}

interface HelpState {
  tip: Tip | null;
  hoverItem: HTMLElement | null;
  openTimer: number;
  openVia: Via | null;
  closeTimer: number;
  pressTimer: number;
  pressItem: HTMLElement | null;
  pressId: number;
  pressX: number;
  pressY: number;
  lastPointerType: string;
  swallowClick: boolean;
  closedAt: number;
  describedEl: HTMLElement | null;
}

export interface RowHelp {
  /** Spread on the panel's root element. */
  panelHandlers: Record<string, (e: any) => void>;
  /** Close whatever is showing — the filter changed, a section folded, the
   *  panel resized: anything that moves or removes the item under it. */
  dismiss: () => void;
  /** For the panel's scrolling body: close what is showing, but let a
   *  pending keyboard / pad focus open through. */
  scrolled: () => void;
  /** The popup itself, rendered beside (not inside) the panel. */
  popup: React.ReactNode;
}

export function useRowHelp(panelRef: { current: HTMLElement | null }, panelOpen: boolean): RowHelp {
  const [tip, setTip] = useState<Tip | null>(null);
  const [more, setMore] = useState(false);

  // Everything the handlers read lives in ONE mutable record, so the
  // handlers are built once and can never go stale.  Lazily, because a
  // `useRef({...})` literal would still be allocated on every render.
  const stRef = useRef<HelpState | null>(null);
  if (!stRef.current) {
    stRef.current = {
      tip: null, hoverItem: null,
      openTimer: 0, openVia: null, closeTimer: 0,
      pressTimer: 0, pressItem: null, pressId: -1, pressX: 0, pressY: 0,
      lastPointerType: '', swallowClick: false, closedAt: -Infinity, describedEl: null,
    };
  }
  const st = stRef.current;

  const apiRef = useRef<{
    panelHandlers: RowHelp['panelHandlers'];
    dismiss: () => void;
    scrolled: () => void;
    hide: (warm?: boolean) => void;
    popupEnter: (e: any) => void;
    popupLeave: (e: any) => void;
  } | null>(null);
  if (!apiRef.current) {
    const cancelOpen = () => { window.clearTimeout(st.openTimer); st.openVia = null; };
    const cancelPress = () => { window.clearTimeout(st.pressTimer); st.pressItem = null; st.pressId = -1; };

    const unDescribe = () => {
      if (st.describedEl) { st.describedEl.removeAttribute('aria-describedby'); st.describedEl = null; }
    };

    const show = (item: HTMLElement, via: Via) => {
      cancelOpen();
      window.clearTimeout(st.closeTimer);
      const panel = panelRef.current;
      const summary = item.getAttribute('data-help');
      if (!panel || !summary || !item.isConnected) return;
      if (st.tip && st.tip.anchor === item) {
        // Already showing this item's description: a long-press on a hovered
        // item PINS it, and that is the only thing that changes.
        if (st.tip.via !== via && via === 'press') { st.tip = { ...st.tip, via }; setTip(st.tip); }
        return;
      }
      unDescribe();
      const next: Tip = {
        anchor: item,
        title: cleanTitle(item.getAttribute('data-help-title') ?? ''),
        summary,
        detail: item.getAttribute('data-help-detail'),
        via,
        ...place(item, panel),
      };
      st.tip = next;
      setTip(next);
      setMore(false);
    };

    /** `warm` only when a HOVER popup closes because the pointer moved on —
     *  the next item then opens at once.  A dismissal (a tap, a scroll, the
     *  filter) is not a pointer moving on, and must not make the next hover
     *  skip its dwell.  `keepFocusOpen` spares a PENDING focus open — see
     *  `scrolled`. */
    const hide = (warm = false, keepFocusOpen = false) => {
      if (!(keepFocusOpen && st.openVia === 'focus')) cancelOpen();
      window.clearTimeout(st.closeTimer);
      st.hoverItem = null;
      if (!st.tip) return;
      st.closedAt = warm && st.tip.via === 'hover' ? performance.now() : -Infinity;
      unDescribe();
      st.tip = null;
      setTip(null);
    };

    const leaveSoon = () => {
      if (!st.tip || st.tip.via !== 'hover') return;
      window.clearTimeout(st.closeTimer);
      st.closeTimer = window.setTimeout(() => hide(true), GRACE_MS);
    };

    const pin = (item: HTMLElement) => {
      show(item, 'press');
      st.swallowClick = true;
    };

    const panelHandlers = {
      // ── Mouse / pen hover ──────────────────────────────────────────────
      onPointerOver: (e: any) => {
        st.lastPointerType = e.pointerType;
        if (e.pointerType === 'touch' || e.buttons !== 0) return;
        const item = itemOf(e.target);
        if (item === st.hoverItem) {
          // Back onto the item whose popup is closing: keep it.
          if (item && st.tip && st.tip.anchor === item) window.clearTimeout(st.closeTimer);
          return;
        }
        st.hoverItem = item;
        if (st.openVia === 'hover') cancelOpen();
        if (!item) { leaveSoon(); return; }
        window.clearTimeout(st.closeTimer);
        // A pinned (long-pressed) popup waits for a tap, not for a passing pen.
        if (st.tip && st.tip.via === 'press') return;
        const warm = st.tip !== null || performance.now() - st.closedAt < WARM_MS;
        if (warm) { show(item, 'hover'); return; }
        st.openVia = 'hover';
        st.openTimer = window.setTimeout(() => show(item, 'hover'), DWELL_MS);
      },
      onPointerOut: (e: any) => {
        if (e.pointerType === 'touch') return;
        const to = e.relatedTarget;
        // Still inside the panel: the pointerover that follows decides.
        if (to instanceof Node && (e.currentTarget as Element).contains(to)) return;
        if (inPopup(to)) return;
        st.hoverItem = null;
        if (st.openVia === 'hover') cancelOpen();
        leaveSoon();
      },

      // ── Touch / pen long-press ─────────────────────────────────────────
      onPointerDown: (e: any) => {
        st.lastPointerType = e.pointerType;
        if (e.pointerType === 'mouse') return;
        const item = itemOf(e.target);
        if (!item || isField(e.target)) return;
        cancelPress();
        st.pressItem = item;
        st.pressId = e.pointerId;
        st.pressX = e.clientX;
        st.pressY = e.clientY;
        st.pressTimer = window.setTimeout(() => { st.pressItem = null; pin(item); }, LONG_PRESS_MS);
      },
      onPointerMove: (e: any) => {
        if (!st.pressItem || e.pointerId !== st.pressId) return;
        if (Math.abs(e.clientX - st.pressX) > SLOP_PX || Math.abs(e.clientY - st.pressY) > SLOP_PX) cancelPress();
      },
      onPointerUp: (e: any) => { if (e.pointerId === st.pressId) cancelPress(); },
      onPointerCancel: (e: any) => { if (e.pointerId === st.pressId) cancelPress(); },
      onContextMenu: (e: any) => {
        // A mouse right-click keeps the browser's own menu.  From a finger it
        // is the platform's long-press (Android), which means the same as ours.
        if (st.lastPointerType === 'mouse' || st.lastPointerType === '' || isField(e.target)) return;
        e.preventDefault();
        const item = itemOf(e.target);
        if (!item) return;
        cancelPress();
        pin(item);
      },
      /** The click a long-press would otherwise deliver when the finger lifts.
       *  Capture phase, so the row's own onClick never sees it. */
      onClickCapture: (e: any) => {
        if (!st.swallowClick) return;
        st.swallowClick = false;
        e.preventDefault();
        e.stopPropagation();
      },

      // ── Keyboard / pad focus ───────────────────────────────────────────
      onFocus: (e: any) => {
        const t = e.target;
        if (!(t instanceof HTMLButtonElement)) return;
        const item = itemOf(t);
        if (!item) return;
        cancelOpen();
        st.openVia = 'focus';
        st.openTimer = window.setTimeout(() => {
          st.openVia = null;
          if (document.activeElement !== t || !t.isConnected) return;
          show(item, 'focus');
          if (st.tip && st.tip.anchor === item) {
            t.setAttribute('aria-describedby', HELP_ID);
            st.describedEl = t;
          }
        }, DWELL_MS);
      },
      onBlur: (e: any) => {
        if (inPopup(e.relatedTarget)) return;
        if (st.openVia === 'focus') cancelOpen();
        if (st.tip && st.tip.via === 'focus') hide();
      },
    };

    apiRef.current = {
      panelHandlers,
      dismiss: () => { cancelPress(); hide(); },
      /** The panel's body scrolled: whatever is showing now points at the
       *  wrong place, and a pending HOVER open would land on whatever the
       *  content scrolled under the pointer.  A pending FOCUS open survives —
       *  focusing a row scrolls it into view, so its own scroll must not
       *  cancel it (it measures where the row is when it opens). */
      scrolled: () => { cancelPress(); hide(false, true); },
      hide,
      popupEnter: (e: any) => { if (e.pointerType !== 'touch') window.clearTimeout(st.closeTimer); },
      popupLeave: (e: any) => {
        if (e.pointerType === 'touch') return;
        const to = e.relatedTarget;
        if (st.tip && to instanceof Node && st.tip.anchor.contains(to)) return;
        st.hoverItem = null;
        leaveSoon();
      },
    };
  }
  const api = apiRef.current;

  // Panel-wide listeners, only while the panel is open: a new gesture starts
  // with no click owed (and closes a popup it did not land on), and a resize
  // moves every item out from under its popup.
  useEffect(() => {
    if (!panelOpen) { api.hide(); return; }
    const down = (e: PointerEvent) => {
      st.swallowClick = false;
      if (st.tip && !inPopup(e.target)) api.hide();
    };
    const resize = () => api.hide();
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('resize', resize);
    };
  }, [panelOpen]);

  // The item a popup belongs to can vanish under it (a section folded by a
  // key, the weapon catalog changing): then so does the popup.
  useEffect(() => {
    if (st.tip && !st.tip.anchor.isConnected) api.hide();
  });

  // Timers must not outlive the component.
  useEffect(() => () => {
    window.clearTimeout(st.openTimer);
    window.clearTimeout(st.closeTimer);
    window.clearTimeout(st.pressTimer);
  }, []);

  const popup = tip ? (
    <div
      id={HELP_ID}
      role="tooltip"
      data-testid="debug-help"
      data-debug-ui=""
      data-help-via={tip.via}
      onPointerEnter={api.popupEnter}
      onPointerLeave={api.popupLeave}
      style={{
        left: tip.left,
        top: tip.top,
        width: tip.width,
        maxHeight: tip.maxHeight,
        transform: tip.above ? 'translateY(-100%)' : undefined,
      }}
      /* A popup is read, not glanced at: it takes a near-solid backing
         whichever backing the panel under it has. */
      className={`fixed z-[65] pointer-events-auto overflow-y-auto overscroll-contain rounded-lg border border-amber-400/60 bg-slate-900/95 shadow-2xl px-2.5 py-2 text-left ${T_BODY}`}
    >
      <div className={`font-mono font-bold ${T_MICRO} uppercase tracking-wider text-amber-300`}>{tip.title}</div>
      <p className="mt-0.5 leading-snug text-slate-100">{tip.summary}</p>
      {tip.detail && (more ? (
        <p data-testid="debug-help-detail" className={`mt-1.5 ${T_NOTE} leading-snug text-slate-300`}>{tip.detail}</p>
      ) : (
        <button
          type="button"
          data-testid="debug-help-more"
          /* Out of the Tab order — the popup is not a place focus lives —
             and refusing mouse focus like every panel button, so a click
             here never strands the keyboard. */
          tabIndex={-1}
          onMouseDown={keepFocus}
          onClick={() => setMore(true)}
          className={`mt-1 ${T_NOTE} font-bold uppercase tracking-wider text-sky-300 hover:text-sky-200`}
        >
          More ▾
        </button>
      ))}
    </div>
  ) : null;

  return { panelHandlers: api.panelHandlers, dismiss: api.dismiss, scrolled: api.scrolled, popup };
}
