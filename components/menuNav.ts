/** GAMEPAD MENU NAVIGATION — a D-pad and two buttons, over every menu.
 *
 *  A pad has to reach every control the game has, not just the ones in
 *  flight; a controller that can fly but cannot buy a module is half a
 *  controller.  There are five full-screen overlays (main menu, pause,
 *  station, death, stage-clear) and between them several hundred controls,
 *  most of them generated — the hex flowers, the inventory honeycomb, the
 *  debug rows — so a hand-authored focus ORDER per screen would be wrong
 *  within a week of anyone touching the UI.
 *
 *  So this drives the DOM instead:
 *
 *  - **Focus is DOM focus**, not React state.  It is already the browser's
 *    job, it already survives re-renders, it already brings a focus ring and
 *    screen-reader behaviour with it, and a `<select>` focused this way opens
 *    with the OS picker exactly as a tap opens it.  Nothing here re-renders
 *    anything.
 *  - **Movement is GEOMETRIC**, not DOM order.  The panels are grids of
 *    hexes, rows of chips and columns of rows all on one screen; DOM order
 *    is the right answer for none of them, and the same geometric rule is
 *    the right answer for all three.
 *  - **The candidate set is read live** on every step.  Overlays swap,
 *    sections collapse, and the inventory changes as things are bought — a
 *    cached list is a list that points at removed nodes.
 */

/** Everything a player can activate.  Deliberately broad: the panels use
 *  buttons for nearly everything, but the control-scheme picker is a native
 *  `<select>` and the debug rows are buttons inside scroll containers. */
const FOCUSABLE = [
  'button:not([disabled])',
  'select:not([disabled])',
  'input:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Weight applied to drift ACROSS the direction of travel.  Above 1 so a
 *  candidate that is slightly further along the axis but well aligned beats
 *  one that is closer but off to the side — without it, pressing "down" in a
 *  two-column grid slides diagonally. */
const CROSS_AXIS_PENALTY = 2.5;

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  // Collapsed sections stay in the DOM; an element scrolled out of its own
  // panel is still reachable, but one with no box is not.
  const style = window.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

/** The overlay currently on screen, or null when the HUD is bare.
 *
 *  Scoped by CONTAINER rather than by game state: the driver then needs to
 *  know nothing about which screen is up, and a new overlay is navigable the
 *  day it is added. */
function activeOverlay(): HTMLElement | null {
  const panels = document.querySelectorAll<HTMLElement>('[data-overlay]');
  // Last wins: overlays are rendered in a fixed order and only one is ever
  // mounted, but if that ever stops being true the topmost is the live one.
  let found: HTMLElement | null = null;
  panels.forEach(p => { if (isVisible(p)) found = p; });
  return found;
}

function candidates(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>(FOCUSABLE).forEach(el => {
    if (isVisible(el)) out.push(el);
  });
  return out;
}

function centerOf(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * The best candidate in direction (dx, dy) from `from`.
 *
 * Scored as distance along the direction plus a penalised cross-axis drift,
 * which is what makes one rule serve a 2-up grid, a row of chips and a
 * column of rows. Candidates behind the direction of travel are excluded
 * outright rather than scored, so movement never reverses.
 */
export function pickNext(
  from: HTMLElement,
  list: HTMLElement[],
  dx: number,
  dy: number,
): HTMLElement | null {
  const a = centerOf(from);
  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of list) {
    if (el === from) continue;
    const b = centerOf(el);
    const along = (b.x - a.x) * dx + (b.y - a.y) * dy;
    // A tolerance rather than `> 0`: rows of equal-height chips have centres
    // that differ by fractions of a pixel, and an exact test makes a
    // horizontal move between them a coin flip.
    if (along <= 1) continue;
    const cross = Math.abs((b.x - a.x) * dy - (b.y - a.y) * dx);
    const score = along + cross * CROSS_AXIS_PENALTY;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/**
 * Install the driver.  Returns a cleanup function.
 *
 * `nav` / `confirm` / `back` are pulled from the engine each frame rather
 * than pushed from it, because the engine already runs the only loop that
 * sees every frame and the alternative — routing discrete presses through
 * `EngineStats` — would put edge events into a per-frame snapshot, where two
 * presses in one frame become one.
 */
export function installMenuNav(source: {
  steps(): { x: number; y: number }[];
  confirm(): boolean;
  back(): boolean;
  onBack(): void;
}): () => void {
  let raf = 0;

  const focusFirst = (root: HTMLElement): HTMLElement | null => {
    const list = candidates(root);
    if (list.length === 0) return null;
    // Topmost-then-leftmost, which is where a reader starts.
    list.sort((p, q) => {
      const a = centerOf(p), b = centerOf(q);
      return a.y - b.y || a.x - b.x;
    });
    list[0].focus();
    return list[0];
  };

  const step = (dx: number, dy: number) => {
    const root = activeOverlay();
    if (!root) return;
    const active = document.activeElement as HTMLElement | null;
    if (!active || !root.contains(active)) { focusFirst(root); return; }
    const next = pickNext(active, candidates(root), dx, dy);
    if (next) {
      next.focus();
      // Panels scroll; a focused control the player cannot see is not
      // focused as far as they are concerned.
      next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };

  const tick = () => {
    raf = requestAnimationFrame(tick);

    // Drain unconditionally.  A press made with no overlay up must not be
    // banked and spent on the next one — the same rule the in-flight edges
    // follow.
    const steps = source.steps();
    const confirm = source.confirm();
    const back = source.back();

    const root = activeOverlay();
    if (!root) return;

    for (const s of steps) {
      if (s.x) step(Math.sign(s.x), 0);
      if (s.y) step(0, Math.sign(s.y));
    }

    if (confirm) {
      const active = document.activeElement as HTMLElement | null;
      if (active && root.contains(active)) active.click();
      else focusFirst(root);
    }

    if (back) source.onBack();
  };

  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
