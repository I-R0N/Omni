/** Star-field MOTION probe (gauntlet star field, S8).
 *
 *  S3 snapped every star to whole device pixels, which is what removed the
 *  browser-dependent resampling. The cost of that is a motion artifact nobody
 *  measured at the time: a pixel-snapped field can only move in whole-pixel
 *  steps, so at low scroll speeds it holds still for several frames and then
 *  jumps a pixel. At high speed the jump is smaller than the motion and
 *  invisible; at low speed it is the motion, and it reads as jitter.
 *
 *  This measures it directly. The player is driven at a constant slow velocity
 *  and, every frame, the probe recomputes where each star WILL BE DRAWN,
 *  mirroring `renderStars`, then compares against the previous frame.
 *
 *  THE METRIC IS COHERENCE, AND GETTING THERE TOOK TWO WRONG TURNS THAT ARE
 *  WORTH KNOWING ABOUT (both recorded in the S8 section of the ledger):
 *
 *   - The first metric was the share of ALL stars moving each frame, and it
 *     showed the fix doing almost nothing. That was the metric being wrong.
 *     With 240 depth layers stepping at independent times, the whole-field
 *     average is a smooth trickle even when every individual layer is lurching.
 *   - The first before/after run showed the undithered path frozen 100% of
 *     frames at EVERY speed including cruise — impossible, and the probe's
 *     fault: the player had died mid-sweep, and a stationary camera looks
 *     exactly like a stuck field. Hence `player.health` being topped up below.
 *
 *  So the numbers that matter are about the NEAREST depth layer — brightest,
 *  largest, fastest-scrolling, and therefore the first to step and the one you
 *  actually see twitch:
 *
 *   - `worst frame` — the largest share of that layer that moved on any single
 *     frame. 100% means the layer moves as one body; that is the artifact.
 *   - `coherent jumps` — how often MOST of the layer moved together. At drift
 *     speeds this should be 0: stars crossing pixel boundaries at staggered
 *     moments read as motion, a lump of them crossing at once reads as a jerk.
 *
 *  Both converge to 100% at high speed, which is correct rather than a
 *  regression: there the layer genuinely advances a pixel every frame.
 *
 *  The whole-field column is kept as context, not as the verdict.
 *
 *  Usage:
 *    npx vite build && npx vite preview --port 4183 --strictPort &
 *    node perf/starfield-motion.mjs
 *    node perf/starfield-motion.mjs --speed 8
 */

import { chromium } from '@playwright/test';
import { connect } from 'node:net';

const PORT = 4183;
const BASE = `http://127.0.0.1:${PORT}`;
const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] ?? true) : d; };
const MAP = flag('map', 'ASTEROID_FIELD');
/** World units per second. The player's cruise is ~120, so these are the
 *  "drifting" speeds the report is about. */
const SPEEDS = flag('speed') ? [Number(flag('speed'))] : [2, 6, 15, 40, 120];
const FRAMES = Number(flag('frames', 90));

function portOpen(port) {
  return new Promise(resolve => {
    const s = connect({ host: '127.0.0.1', port });
    const done = ok => { s.destroy(); resolve(ok); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.setTimeout(1000, () => done(false));
  });
}
if (!(await portOpen(PORT))) {
  console.error(`no preview server on ${PORT}`);
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(BASE);
await page.waitForFunction(() => !!window.__omniEngine);
await page.evaluate(m => { window.__omniEngine.setMapType(m); window.__omniEngine.startGame(); }, MAP);
await page.waitForTimeout(1500);

/** Runs in the page: hold a constant velocity and measure QUANTISATION ERROR —
 *  how far each star is drawn from where continuous motion says it should be.
 *
 *  This replaced an earlier coherence metric, and the reason is worth keeping.
 *  That metric was built for a per-star DITHER hypothesis: it scored a layer
 *  badly when all its stars stepped on the same frame. The dither shipped,
 *  measured well, and looked worse in the hand — uncorrelated per-star stepping
 *  reads as the whole sky fizzing, which is more objectionable than a coherent
 *  step. So the metric was rewarding the wrong thing, and a metric you have
 *  disproved is worse than none.
 *
 *  Quantisation error has no such ambiguity and describes the actual trade:
 *
 *   - SMOOTH draws at the exact fractional position, so the error is 0 by
 *     construction and motion is continuous at any speed. The cost is paid in
 *     sharpness, not in position — canvas antialiases the rect.
 *   - CRISP snaps to whole device pixels, so the error is a sawtooth up to half
 *     a pixel. That IS the jitter: at low speed the error ramps for many frames
 *     (the star visibly lags where it should be) and then resets when it steps.
 *
 *  `stalled frames` is the same artifact seen from the other side: how often the
 *  drawn position did not change at all despite the field having moved.
 */
const RUN = ([speed, frames]) => new Promise(resolve => {
  const e = window.__omniEngine;
  const bg = e.renderer.backgroundManager;

  const N = Math.min(800, bg.starX.length);
  const stride = Math.max(1, Math.floor(bg.starX.length / N));
  const idx = [];
  for (let i = 0; i < bg.starX.length && idx.length < N; i += stride) idx.push(i);

  const crisp = () => (window.__omniStats && window.__omniStats.starMotionName) === 'Crisp';
  const pw = bg.bandPixelWidth;

  e.player.position.x = 0; e.player.position.y = 0;
  e.camera.position.x = 0; e.camera.position.y = 0;

  const errs = [];
  const stalls = [];
  let prev = null;
  let n = 0;

  const tick = () => {
    // Keep the pilot alive: a dead player stops the camera, and a stationary
    // camera looks exactly like a stuck field. That contaminated an earlier run.
    e.player.health = e.player.maxHealth;
    e.player.isExploding = false;
    e.player.velocity.x = speed / 60;
    e.player.velocity.y = 0;

    const c = crisp();
    let sumErr = 0;
    const now = [];
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const b = bg.starBandIdx[i];
      const ideal = bg.starX[i] + bg.bandOffsetX[b];
      const drawn = c ? bg.starX[i] + bg.bandDrawX[b] : ideal;
      sumErr += Math.abs(drawn - ideal);
      now.push(drawn);
    }
    errs.push(sumErr / idx.length);

    if (prev) {
      let same = 0;
      for (let k = 0; k < now.length; k++) if (now[k] === prev[k]) same++;
      stalls.push(same / now.length);
    }
    prev = now;

    if (++n >= frames) {
      const eSlice = errs.slice(5);
      const sSlice = stalls.slice(5);
      resolve({
        meanErr: eSlice.reduce((a, b) => a + b, 0) / eSlice.length,
        maxErr: eSlice.reduce((a, b) => Math.max(a, b), 0),
        stalledPct: (sSlice.reduce((a, b) => a + b, 0) / sSlice.length) * 100,
        crisp: c,
      });
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const runAll = async (label) => {
  console.log(`\n   --- ${label} ---`);
  console.log('   ship speed   mean position error (dev px)   worst    stars not moving');
  for (const sp of SPEEDS) {
    const r = await page.evaluate(RUN, [sp, FRAMES]);
    console.log(
      `   ${String(sp).padStart(8)}   ${r.meanErr.toFixed(3).padStart(24)}` +
      `   ${r.maxErr.toFixed(3).padStart(6)}   ${r.stalledPct.toFixed(0).padStart(14)}%`,
    );
  }
};

console.log(`\n=== star-field motion at low speed — 390x844 dpr2, ${MAP} ===`);
console.log(`(position error = how far stars are drawn from where continuous motion puts`);
console.log(` them. SMOOTH is 0 by construction. CRISP is a sawtooth up to half a pixel,`);
console.log(` and 'stars not moving' is the same artifact from the other side: the share`);
console.log(` of stars whose drawn position did not change at all this frame.)`);

await runAll('SMOOTH (shipped default)');
await page.evaluate(() => window.__omniEngine.dbg.cycleStarMotion());
await page.waitForTimeout(300);
await runAll('CRISP (pixel-snapped)');
await page.evaluate(() => window.__omniEngine.dbg.cycleStarMotion());

await browser.close();
console.log('');
