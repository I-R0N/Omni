/** Shared harness for the Omni smoke suites.
 *
 *  Everything here is a thin wrapper over the two debug handles the app
 *  publishes on mount (App.tsx; CLAUDE.md §8):
 *
 *    window.__omniEngine  — the live GameEngine instance
 *    window.__omniStats   — the most recent EngineStats payload
 *
 *  Nothing in the game reads either one, and the suites never stub the sim:
 *  a test drives the same public methods the React shell drives, then reads
 *  the same stats payload the HUD renders from.  That is the whole design —
 *  if a suite can observe it, the UI can too.
 *
 *  Three habits are baked in here because a prior session lost real time to
 *  each of them (GAUNTLET_PAIR_A_LOG / GAUNTLET_BOSSES_LOG, "harness flakes"):
 *
 *   1. POLL, never sleep.  The sim runs on a fixed timestep and this browser
 *      renders canvas in software, so sim-seconds elapse slower than
 *      wall-clock seconds and every `waitForTimeout(n)` is a coin flip.
 *      `waitForStats` / `waitForEngine` poll a predicate with a timeout.
 *   2. Sample PEAKS, not instants.  Short-lived state (hit stun, a flash,
 *      a flicker) is gone by the time a naive read lands.  `samplePeak`
 *      watches a value across a window and returns its maximum.
 *   3. Read the SIM, not the pixels, wherever the sim exposes the same fact.
 *      Canvas sampling is reserved for things that only exist as pixels.
 */

import { expect, type Page, type ConsoleMessage } from '@playwright/test';
import type { EngineStats } from '../types';

/** Anything the engine exposes that a suite drives.  Deliberately loose:
 *  this is a debug handle, not an API surface, and typing it strictly here
 *  would just duplicate GameEngine's signature list. */
type Engine = any;

declare global {
  interface Window {
    __omniEngine?: Engine;
    __omniStats?: EngineStats;
  }
}

/** Console / pageerror sink.  Every suite asserts a clean console; this is
 *  what it asserts against. */
export interface ConsoleWatch {
  errors: string[];
  /** Fails the test if anything landed in `errors`. */
  assertClean(): void;
}

/** Messages that are noise rather than product defects.  Keep this list
 *  SHORT and justified — an entry here is a hole in the console assertion. */
const IGNORED_CONSOLE = [
  // Vite preview serves hashed assets; a favicon 404 is a static-server
  // artifact of the harness, not of the game.
  'favicon',
];

export function watchConsole(page: Page): ConsoleWatch {
  const errors: string[] = [];
  const record = (text: string) => {
    if (IGNORED_CONSOLE.some(p => text.includes(p))) return;
    errors.push(text);
  };
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') record(`console.error: ${m.text()}`);
  });
  page.on('pageerror', e => record(`pageerror: ${e.message}`));
  return {
    errors,
    assertClean() {
      expect(errors, `console should be clean, got:\n${errors.join('\n')}`).toEqual([]);
    },
  };
}

/** Load the app and wait until the engine handle exists and the main menu
 *  has rendered.  Returns the console watch so the caller can assert on it. */
export async function boot(page: Page): Promise<ConsoleWatch> {
  const watch = watchConsole(page);
  await page.goto('/');
  await page.waitForFunction(() => !!window.__omniEngine && !!window.__omniStats);
  await expect(page.getByTestId('menu-start')).toBeVisible();
  return watch;
}

/** Read the latest stats payload. */
export function stats(page: Page): Promise<EngineStats> {
  return page.evaluate(() => window.__omniStats!);
}

/** Evaluate `fn` against the live engine.  The engine is passed in rather
 *  than reached for, so a caller can't accidentally close over test-side
 *  state that doesn't exist in the page. */
export function engine<R, A = undefined>(
  page: Page,
  fn: (e: Engine, arg: A) => R,
  arg?: A,
): Promise<R> {
  return page.evaluate(
    ([body, a]) =>
      // eslint-disable-next-line no-new-func
      new Function('e', 'arg', `return (${body})(e, arg)`)(window.__omniEngine, a),
    [fn.toString(), arg ?? null] as [string, A],
  );
}

/** Poll `pred` against successive stats payloads until it holds.
 *  ALWAYS use this instead of a fixed wait: the sim's clock is not the
 *  wall clock here. */
export async function waitForStats(
  page: Page,
  pred: (s: EngineStats) => boolean,
  what: string,
  timeoutMs = 60_000,
): Promise<EngineStats> {
  await page
    .waitForFunction(
      body =>
        // eslint-disable-next-line no-new-func
        !!window.__omniStats && new Function('s', `return (${body})(s)`)(window.__omniStats),
      pred.toString(),
      { timeout: timeoutMs, polling: 100 },
    )
    .catch(() => {
      throw new Error(`timed out waiting for: ${what}`);
    });
  return stats(page);
}

/** Same, but the predicate sees the ENGINE rather than the stats payload —
 *  for internals the HUD has no reason to publish. */
export async function waitForEngine(
  page: Page,
  pred: (e: Engine) => boolean,
  what: string,
  timeoutMs = 60_000,
): Promise<void> {
  await page
    .waitForFunction(
      body =>
        // eslint-disable-next-line no-new-func
        !!window.__omniEngine && new Function('e', `return (${body})(e)`)(window.__omniEngine),
      pred.toString(),
      { timeout: timeoutMs, polling: 100 },
    )
    .catch(() => {
      throw new Error(`timed out waiting for: ${what}`);
    });
}

/** Advance the world by `seconds` of SIM time (not wall time).
 *
 *  NOT USED by any suite today — the suites all have a specific condition to
 *  poll for, which is strictly better than waiting a fixed amount. Kept
 *  because "let the world run for a bit" is a real need the moment a suite
 *  tests something time-driven, and re-deriving the runTimeSec trick below is
 *  exactly the kind of wheel this harness exists to stop being reinvented.
 *
 *  `runTimeSec` is the engine's own sim-second accumulator — the one the run
 *  summary reports — so it already excludes paused, docked and dead time,
 *  which is exactly the definition a test wants for "let the world run".
 *  It is a private TS field, but private is a compile-time notion: at
 *  runtime it is an ordinary property on the debug handle.  Reading engine
 *  internals this way is the point of the handle; the suites never WRITE
 *  them. */
export async function advanceSim(page: Page, seconds: number, timeoutMs = 120_000) {
  const start = await engine(page, e => e.runTimeSec as number);
  await waitForEngine(
    page,
    // The target is inlined by toString(), so this closure serialises fine.
    new Function('e', `return e.runTimeSec >= ${start + seconds}`) as (e: Engine) => boolean,
    `${seconds}s of sim time`,
    timeoutMs,
  );
}

/** Watch `read` for `windowMs` of wall time and return the LARGEST value
 *  seen.  For transient state (hit stun, a flash timer, a peak count) that a
 *  single read will usually miss.
 *
 *  NOT USED by any suite today, for the same reason as `advanceSim`: nothing
 *  in the current net measures a transient.  Kept because the flake it
 *  prevents — a 0.12s hit-stun read 200 ms after the shot, which comes back
 *  zero and reads as a product bug — cost a previous session real time, and
 *  the fix should not have to be rediscovered. */
export async function samplePeak(
  page: Page,
  read: (e: Engine) => number,
  windowMs = 1500,
): Promise<number> {
  return page.evaluate(
    ([body, ms]) => {
      // eslint-disable-next-line no-new-func
      const f = new Function('e', `return (${body})(e)`) as (e: any) => number;
      return new Promise<number>(resolve => {
        let peak = -Infinity;
        const t0 = performance.now();
        const tick = () => {
          const v = f(window.__omniEngine);
          if (typeof v === 'number' && v > peak) peak = v;
          if (performance.now() - t0 >= (ms as number)) resolve(peak);
          else requestAnimationFrame(tick);
        };
        tick();
      });
    },
    [read.toString(), windowMs] as [string, number],
  );
}

// ── Common run drivers ────────────────────────────────────────────────────

/** Start a run.  Defaults to the hub, which is where a real run begins. */
export async function startRun(page: Page, mapType?: string) {
  if (mapType) await engine(page, (e, m) => e.setMapType(m), mapType);
  await engine(page, e => e.startGame());
  await waitForStats(page, s => s.gameState === 'PLAYING', 'game to reach PLAYING');
}

/** Wait out the portal ARRIVAL BEAT (PORTAL_CONSTANTS.WARP).
 *
 *  A transit freezes the sim for the length of the flight-through animation,
 *  the same way the stage-clear screen does — so a suite that calls
 *  `transitionToMap` and immediately pokes the world is racing it.  That is
 *  not a harness quirk to route around: a PLAYER cannot act during the beat
 *  either, so a test that acts is testing a state the game never presents.
 *
 *  The specific bite, which cost a full-suite run: boss phases are stamped by
 *  `updateBosses`, which does not run while the sim is held.  A test that
 *  transitted, zeroed the boss's shield and fired found its shield back —
 *  the phase landed after the freeze lifted and re-stamped it.
 *
 *  Cheap when the beat is off (DBG "Transit fx: off"): the timer is already 0
 *  and this returns on the first poll. */
export async function waitForTransit(page: Page, timeoutMs = 15_000) {
  await waitForEngine(page, e => (e.portalWarpTimer ?? 0) === 0,
    'the portal arrival beat to finish', timeoutMs);
}

/** Put the player next to a station of `kind` and dock.  Flies nothing —
 *  "can the ship reach it" is not what any suite using this is testing.
 *
 *  Defaults to the TRADE HUB, the one station carrying BOTH shops: most
 *  callers want to buy something, and `purchaseModule` gates on the docked
 *  station's services, so docking at HOME (drydock only) silently returns
 *  false on every purchase. */
export async function dockAtStation(page: Page, kind = 'tradehub') {
  const found = await engine(
    page,
    (e, k: string) => {
      const st = e.stations.find((s: any) => s.stationKind === k);
      if (!st) return false;
      // Just inside DOCK_RANGE, mirroring debugTeleportToStation's offset.
      e.player.position.x = st.position.x;
      e.player.position.y = st.position.y + 40;
      e.player.velocity.x = 0;
      e.player.velocity.y = 0;
      return true;
    },
    kind,
  );
  if (!found) throw new Error(`no station of kind "${kind}" on this map`);
  await waitForStats(page, s => !!s.dock?.inRange, `dock range at the ${kind}`);
  await engine(page, e => e.dockAtStation());
  await waitForStats(page, s => !!s.station, 'the station UI');
}
