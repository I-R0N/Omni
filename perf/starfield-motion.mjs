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
const FRAMES = Number(flag('frames', 150));

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

/** Runs in the page: hold a constant velocity and sample the DRAWN field.
 *
 *  The metric is the SHARE OF STARS THAT MOVED this frame. That is the thing
 *  the eye integrates into "the sky is moving": if a whole depth layer steps at
 *  once every 80 frames, the share is 0 most frames and a big spike
 *  occasionally, and it reads as a lurch. If stars cross pixel boundaries at
 *  staggered moments, a steady trickle moves every frame and it reads as
 *  motion. Mean is set by the speed; it is the SPIKINESS that is the artifact.
 */
const RUN = ([speed, frames]) => new Promise(resolve => {
  const e = window.__omniEngine;
  const bg = e.renderer.backgroundManager;

  // Sample stars spread across the whole array so every depth layer is
  // represented.
  const N = Math.min(2000, bg.starX.length);
  const stride = Math.max(1, Math.floor(bg.starX.length / N));
  const idx = [];
  for (let i = 0; i < bg.starX.length && idx.length < N; i += stride) idx.push(i);

  // …and separately, EVERY star of the NEAREST depth layer. This is where the
  // artifact actually lives. The whole-field average is diluted across 240
  // layers stepping at different times, so it looks calm even when each layer
  // is lurching; the nearest layer holds the brightest, largest stars and
  // scrolls fastest, so it is both the most visible and the first to step.
  // What matters is COHERENCE: undithered, all ~100 of its stars jump on the
  // same frame, which reads as a twitch in one depth plane.
  const nearBand = bg.bandSpeed.length - 2;   // last is the milky way
  const nearIdx = [];
  for (let i = 0; i < bg.starX.length; i++) if (bg.starBandIdx[i] === nearBand) nearIdx.push(i);

  const dither = () => !!(window.__omniStats && window.__omniStats.starDitherEnabled !== false);
  const pw = bg.bandPixelWidth;

  /** Where the renderer will actually draw star i, mirroring renderStars. */
  const drawnX = (i) => {
    const b = bg.starBandIdx[i];
    let x = dither()
      ? (bg.starX[i] + bg.bandOffsetX[b] + bg.starDitherX[i] * (1 / 256)) | 0
      : bg.starX[i] + bg.bandDrawX[b];
    if (x >= pw) x -= pw;
    return x;
  };

  // Start each run from the same place, so the two passes are comparable and
  // neither inherits the other's accumulated drift.
  e.player.position.x = 0;
  e.player.position.y = 0;
  e.camera.position.x = 0;
  e.camera.position.y = 0;

  let prev = idx.map(drawnX);
  let prevNear = nearIdx.map(drawnX);
  const nearMoved = [];
  const movedFrac = [];
  const layerOffsets = [];
  const mid = Math.floor(bg.bandSpeed.length / 2);
  let n = 0;

  const tick = () => {
    // Hold the velocity AND keep the pilot alive. A dead player stops the
    // camera following, which freezes the field and would be misread as the
    // artifact under test — that contaminated the first run of this probe.
    e.player.health = e.player.maxHealth;
    e.player.isExploding = false;
    e.player.velocity.x = speed / 60;
    e.player.velocity.y = 0;

    let moved = 0;
    for (let k = 0; k < idx.length; k++) {
      const x = drawnX(idx[k]);
      if (x !== prev[k]) moved++;
      prev[k] = x;
    }
    movedFrac.push(moved / idx.length);

    let nm = 0;
    for (let k = 0; k < nearIdx.length; k++) {
      const x = drawnX(nearIdx[k]);
      if (x !== prevNear[k]) nm++;
      prevNear[k] = x;
    }
    nearMoved.push(nm);

    layerOffsets.push(bg.bandDrawX[mid]);

    if (++n >= frames) {
      // Drop the first few frames: `prev` starts from a pre-motion sample.
      const d = movedFrac.slice(5);
      const mean = d.reduce((a, b) => a + b, 0) / d.length;
      const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) * (b - mean), 0) / d.length);
      // Fraction of frames in which NOTHING in the sample moved — the direct
      // measure of "the sky froze".
      const still = d.filter(v => v === 0).length / d.length;

      let changed = 0;
      for (let k = 1; k < layerOffsets.length; k++) {
        if (layerOffsets[k] !== layerOffsets[k - 1]) changed++;
      }

      // The nearest layer, which is the one you actually see twitch.
      const nd = nearMoved.slice(5);
      const nearN = nearIdx.length || 1;
      const nearMean = nd.reduce((a, b) => a + b, 0) / nd.length;
      const nearMax = nd.reduce((a, b) => Math.max(a, b), 0);
      // Frames where MOST of the layer moved at once — a coherent jump.
      const lumps = nd.filter(v => v > nearN * 0.5).length / nd.length;

      resolve({
        meanMoved: mean,
        spikiness: mean > 1e-9 ? sd / mean : 0,
        stillPct: still * 100,
        layerChangedPct: (changed / (layerOffsets.length - 1)) * 100,
        nearN,
        nearMeanPct: (nearMean / nearN) * 100,
        nearMaxPct: (nearMax / nearN) * 100,
        lumpPct: lumps * 100,
        dither: dither(),
      });
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const runAll = async (label) => {
  console.log(`\n   --- dither ${label} ---`);
  console.log('   ship speed   whole field/frame   NEAREST LAYER: avg moved   worst frame   coherent jumps');
  for (const sp of SPEEDS) {
    const r = await page.evaluate(RUN, [sp, FRAMES]);
    console.log(
      `   ${String(sp).padStart(8)}   ${(r.meanMoved * 100).toFixed(2).padStart(14)}%` +
      `   ${r.nearMeanPct.toFixed(1).padStart(22)}%` +
      `   ${r.nearMaxPct.toFixed(0).padStart(10)}%` +
      `   ${r.lumpPct.toFixed(0).padStart(13)}%`,
    );
  }
};

console.log(`\n=== star-field motion at low speed — 390x844 dpr2, ${MAP} ===`);
console.log(`(spikiness = sd/mean of the share of stars moving each frame. Low = a steady`);
console.log(` trickle of stars crossing pixels, which reads as motion. High = nothing moves`);
console.log(` for a while and then a whole layer jumps, which reads as jitter.`);
console.log(` The NEAREST LAYER columns are the artifact: 'worst frame' is the largest share`);
console.log(` of that layer that moved on any single frame, and 'coherent jumps' is how often`);
console.log(` MOST of the layer moved together. 100% / high = the layer lurches as one body.)`);

await runAll('ON (shipped)');
await page.evaluate(() => window.__omniEngine.dbg.toggleStarDither());
await page.waitForTimeout(300);
await runAll('OFF (pre-fix)');
await page.evaluate(() => window.__omniEngine.dbg.toggleStarDither());

await browser.close();
console.log('');
