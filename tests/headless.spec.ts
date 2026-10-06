/** THE PORTS ARE FAITHFUL — and the browser shell's two new inputs work.
 *
 *  `tests/sim/*.test.ts` run the real GameEngine in Node on the headless
 *  platform (`npm run test:sim`).  That is only worth anything if it is the
 *  SAME simulation the browser runs.  Two questions, and they have different
 *  answers, which is the part worth reading:
 *
 *   1. Do the PORTS change the sim?  Replay one seed in the live engine (the
 *      real RenderSystem / AudioSystem / InputSystem / performance clock) and
 *      in a second engine on the headless platform (null renderer, silent
 *      audio, manual clock) — in the SAME page, so the same JS engine and the
 *      same libm — and every hash must match to the bit.  This is the proof
 *      the plan asks for, and it holds exactly.
 *
 *   2. Does a DIFFERENT JS ENGINE reproduce the sim?  Node 22 (V8 12.4) against
 *      Chromium 141 (V8 14.1), same seed, same log: the random streams, the
 *      player AND THE WORLD must match bit for bit at every checkpoint on every
 *      map.  This used to hold only for streams and player, because `Math.sin`,
 *      `Math.cos` and `Math.pow` are not specified to be correctly rounded and
 *      the two V8s disagreed in the last place.  The sim now calls
 *      `engine/systems/dmath.ts` (engine-core S3, D30), built only from
 *      operations every engine rounds identically, so the assertion is
 *      unconditional.  The native-libm probe below is kept as INFORMATION: it
 *      says whether this machine would have failed without dmath.
 *
 *  Harness rule 9 applies: page functions are stringified, so everything they
 *  need is inlined or passed as `arg`.
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, stats, waitForStats, startRun } from './helpers';
import {
  PARITY_INPUTS, PARITY_MAPS, PARITY_SEED, PARITY_STEPS, PARITY_EVERY,
} from './sim/parityLog';

test.describe.configure({ timeout: 300_000 });

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface Series { steps: number[]; hash: number[]; rng: number[]; player: number[]; world: number[]; }
type Row = [string, string, number, number, number, number, number, number, number];
interface NodeOut { series: Record<string, Series>; world0: Record<string, Row[]>; libm: Record<string, number>; }

function nodeOut(): NodeOut {
  const out = execFileSync(process.execPath, ['scripts/sim-hash.mjs'], {
    cwd: root, maxBuffer: 1 << 28, encoding: 'utf8',
  });
  return JSON.parse(out);
}

/** Runs in the page: the whole replay, returning the hash series. */
const REPLAY_IN_PAGE = `(function (g, a) {
  const R = window.__omniReplay;
  const res = R.runReplay(g, { seed: a.seed, mapType: a.map, inputs: a.inputs }, a.steps, a.every);
  R.endReplay(g);
  const o = { steps: [], hash: [], rng: [], player: [], world: [] };
  for (const h of res.hashes) {
    o.steps.push(h.step); o.hash.push(h.hash); o.rng.push(h.rng);
    o.player.push(h.player); o.world.push(h.world);
  }
  return o;
})`;

test.describe('the ports do not change the sim (same JS engine, bit for bit)', () => {
  test('a headless-platform engine replays every parity map to the same hashes as the live browser engine', async ({ page }) => {
    await boot(page);
    const arg = (map: string) => ({ seed: PARITY_SEED, map, steps: PARITY_STEPS, every: PARITY_EVERY, inputs: PARITY_INPUTS });

    // The live engine first (real renderer / audio / input / clock) …
    const live: Record<string, Series> = {};
    for (const map of PARITY_MAPS) {
      live[map] = await page.evaluate(`(${REPLAY_IN_PAGE})(window.__omniEngine, ${JSON.stringify(arg(map))})`) as Series;
    }
    // … then stop it (the clock and viewport are module-level: the second
    // engine installs its own) and replay on the headless platform.
    const headless: Record<string, Series> = await page.evaluate(`(function () {
      window.__omniEngine.stop();
      const h = window.__omniHeadless.createEngine();
      const out = {};
      for (const map of ${JSON.stringify([...PARITY_MAPS])}) {
        const a = { seed: ${PARITY_SEED}, map, steps: ${PARITY_STEPS}, every: ${PARITY_EVERY}, inputs: ${JSON.stringify(PARITY_INPUTS)} };
        out[map] = (${REPLAY_IN_PAGE})(h, a);
      }
      return out;
    })()`) as Record<string, Series>;

    for (const map of PARITY_MAPS) {
      expect(headless[map].rng, `${map}: rng streams`).toEqual(live[map].rng);
      expect(headless[map].player, `${map}: player`).toEqual(live[map].player);
      expect(headless[map].world, `${map}: world`).toEqual(live[map].world);
      expect(headless[map].hash, `${map}: combined`).toEqual(live[map].hash);
      // Not vacuous: the series moved.
      expect(new Set(live[map].hash).size).toBeGreaterThan(5);
    }
  });
});

test.describe('Node (V8 12) vs Chromium (V8 14): what reproduces, and what dmath guarantees', () => {
  test('the random streams and the player match at every checkpoint; the world matches exactly', async ({ page }) => {
    const node = nodeOut();
    await boot(page);

    // What the two engines' libm disagree on, measured on the same inputs.
    const libm: Record<string, number> = await page.evaluate(`(function () {
      let s = 12345; const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
      const f64 = new Float64Array(1), u = new Uint32Array(f64.buffer);
      const bits = (x) => { f64[0] = x; return u[0] ^ Math.imul(u[1], 31); };
      const fns = {
        sin: (a) => Math.sin(a * 20), cos: (a) => Math.cos(a * 20), pow: (a, b) => Math.pow(a * 10, b * 3),
        atan2: (a, b) => Math.atan2(a - 0.5, b - 0.5), hypot: (a, b) => Math.hypot(a * 100, b * 100),
        exp: (a) => Math.exp(a * 5), log: (a) => Math.log(a * 100 + 0.01), sqrt: (a) => Math.sqrt(a * 1000),
      };
      const out = {};
      for (const k in fns) { let h = 0x811c9dc5; s = 99; for (let i = 0; i < 20000; i++) { const a = r(), b = r(); h = Math.imul(h ^ bits(fns[k](a, b)), 16777619) >>> 0; } out[k] = h; }
      return out;
    })()`);
    const libmDiffers = Object.keys(libm).filter((k) => libm[k] !== node.libm[k]);
    test.info().annotations.push({
      type: 'libm',
      description: libmDiffers.length === 0
        ? 'Node and this Chromium agree on every native libm function probed (dmath is not being tested by a disagreement here).'
        : `Node and this Chromium DISAGREE natively on ${libmDiffers.join(', ')}; dmath is what makes the sim agree anyway.`,
    });

    for (const map of PARITY_MAPS) {
      const arg = { seed: PARITY_SEED, map, steps: PARITY_STEPS, every: PARITY_EVERY, inputs: PARITY_INPUTS };
      const b = await page.evaluate(`(${REPLAY_IN_PAGE})(window.__omniEngine, ${JSON.stringify(arg)})`) as Series;
      const n = node.series[map];
      expect(b.rng, `${map}: rng streams`).toEqual(n.rng);
      expect(b.player, `${map}: player`).toEqual(n.player);
      expect(b.world, `${map}: world`).toEqual(n.world);
      expect(b.hash, `${map}: combined`).toEqual(n.hash);
      expect(new Set(b.hash).size).toBeGreaterThan(5);
    }

    // Terrain generation, step 0: the same bodies in the same order with
    // IDENTICAL numbers.
    const world0: Record<string, Row[]> = await page.evaluate(`(function () {
      const R = window.__omniReplay, g = window.__omniEngine, out = {};
      for (const map of ${JSON.stringify([...PARITY_MAPS])}) {
        g.beginSeededRun(${PARITY_SEED}, map);
        out[map] = g.currentMap.entities.filter((e) => e.active && e.type !== 'PARTICLE')
          .map((e) => [e.id, e.type, e.position.x, e.position.y, e.velocity ? e.velocity.x : 0, e.velocity ? e.velocity.y : 0, e.rotation, e.health, e.size ? e.size.x : 0]);
        R.endReplay(g);
      }
      return out;
    })()`);
    for (const map of PARITY_MAPS) {
      const a = world0[map], n = node.world0[map];
      expect(a.length, `${map}: step-0 entity count`).toBe(n.length);
      for (let i = 0; i < a.length; i++) {
        expect(a[i][0], `${map}[${i}] id`).toBe(n[i][0]);
        expect(a[i][1], `${map}[${i}] type`).toBe(n[i][1]);
        for (let k = 2; k < 9; k++) expect(a[i][k], `${map}[${i}] field ${k}`).toBe(n[i][k]);
      }
    }
  });

  test('this engine reproduces the pinned dmath bit table', async ({ page }) => {
    await boot(page);
    const fixture = fs.readFileSync(path.join(root, 'tests/sim/fixtures/dmath.bits.json'), 'utf8');
    const bad: string[] = await page.evaluate(`(function () {
      const fx = ${fixture}, D = window.__omniDmath;
      const f64 = new Float64Array(1), u = new Uint32Array(f64.buffer);
      f64[0] = 1; const HI = u[1] === 0x3ff00000 ? 1 : 0;
      const bits = (x) => { f64[0] = x; return (u[HI] >>> 0).toString(16).padStart(8, '0') + (u[1 - HI] >>> 0).toString(16).padStart(8, '0'); };
      const dec = (h) => { u[HI] = parseInt(h.slice(0, 8), 16); u[1 - HI] = parseInt(h.slice(8), 16); return f64[0]; };
      const I = fx.inputs.map(dec), N = I.length, bad = [];
      const one = { sin: D.sin, cos: D.cos, tan: D.tan, exp: (x) => D.exp(x / 100), log: (x) => D.log(Math.abs(x) + 1e-3),
        atan: D.atan, cbrt: D.cbrt, asin: (x) => D.asin(x / (Math.abs(x) + 1)), acos: (x) => D.acos(x / (Math.abs(x) + 1)) };
      const got = {};
      for (const k in one) got[k] = I.map((x) => bits(one[k](x)));
      got.pow = I.map((x, i) => bits(D.pow(Math.abs(x) + 0.01, I[(i + 7) % N] / 400)));
      got.powInt = I.map((x, i) => bits(D.pow(x / 50, (i % 17) - 8)));
      got.atan2 = I.map((y, i) => bits(D.atan2(y, I[(i * 5 + 3) % N])));
      got.hypot = I.map((x, i) => bits(D.hypot(x, I[(i * 3 + 1) % N])));
      for (const k in fx.table) for (let i = 0; i < N; i++) if (got[k][i] !== fx.table[k][i]) bad.push(k + '[' + i + ']');
      return bad;
    })()`);
    expect(bad, 'dmath bits that differ in this browser').toEqual([]);
  });
});

test.describe('Escape and the app lifecycle, in the real browser', () => {
  test('Escape pauses live play and resumes from the pause menu', async ({ page }) => {
    await boot(page);
    await startRun(page, 'POCKET');
    await waitForStats(page, s => s.gameState === 'PLAYING', 'live play');
    await page.keyboard.press('Escape');
    await waitForStats(page, s => s.gameState === 'PAUSED', 'Escape to pause');
    await page.keyboard.press('Escape');
    await waitForStats(page, s => s.gameState === 'PLAYING', 'Escape to resume');
  });

  test('Escape closes the debug panel before it pauses', async ({ page }) => {
    await boot(page);
    await startRun(page, 'POCKET');
    await page.keyboard.press('Backquote');
    await waitForStats(page, s => s.debugPanel?.open === true, 'the panel to open');
    await page.keyboard.press('Escape');
    await waitForStats(page, s => s.debugPanel?.open === false, 'Escape to close the panel');
    expect((await stats(page)).gameState).toBe('PLAYING');
  });

  test('hiding the page pauses; showing it does not resume', async ({ page }) => {
    await boot(page);
    await startRun(page, 'POCKET');
    const setHidden = (hidden: boolean) => page.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
    await setHidden(true);
    await waitForStats(page, s => s.gameState === 'PAUSED', 'the page to pause on hide');
    await setHidden(false);
    await page.waitForTimeout(300);
    expect((await stats(page)).gameState, 'coming back leaves the pause menu up').toBe('PAUSED');
  });
});
