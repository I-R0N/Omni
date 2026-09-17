/** Star-field measurement probe (gauntlet: star field).
 *
 *  The star field renders visibly differently in desktop Edge vs desktop
 *  Safari (user report, side-by-side screenshot).  A prior session produced a
 *  diagnosis by READING `BackgroundManager.ts`.  This file exists so the
 *  diagnosis can be CHECKED instead of believed, and so the S2/S3/S4 changes
 *  have a before/after number rather than an impression.
 *
 *  WHAT IS MEASURED, AND HOW MUCH EACH NUMBER IS WORTH
 *
 *   - STRUCTURE (depth-layer count, device-pixel scene, bytes held) is read
 *     straight off the live BackgroundManager.  Exact, browser independent.
 *   - DENSITY is the manager's own star count (exact), plus lit-pixel coverage
 *     measured by rendering the field ONCE into a scratch canvas of the real
 *     device size and counting what landed — the composed field the player
 *     sees, overlaps included.
 *   - THE REAL BLIT PATH is the S3 acceptance check: `drawImage` is wrapped on
 *     the LIVE context and the transform in force is read back, so "no filter
 *     is in the path" is observed rather than asserted.  Since S4 removed the
 *     band canvases entirely there is no blit left to align, and it reports so.
 *   - `--bench` A/Bs the pre-S4 structure against the shipped one.  It
 *     RECONSTRUCTS the band canvases from live star data, because keeping the
 *     experiment runnable matters more than keeping the old code.
 *   - DRAW CALLS are counted by wrapping `drawImage` for a fixed number of
 *     frames.  Exact.
 *
 *  A clearly-labelled COUNTERFACTUAL section replays the OLD fractional,
 *  dpr-scaled blit so the filter's effect stays visible for comparison.  It
 *  measures what the code no longer does, and says so.
 *
 *  Absolute frame TIME is deliberately not reported here: this container
 *  rasterizes canvas in software (see perf/README.md), so a millisecond
 *  figure for a fill-rate-bound background layer would be the rasterizer's
 *  number and not the device's.  Draw-call count and byte count are the
 *  device-independent halves of that cost, and they are what this reports.
 *
 *  Sibling probe: `starfield-motion.mjs` (the S8 low-speed jitter).
 *  (`starfield-regions.mjs` printed the S7 region field as ASCII; the field
 *  was removed in S13 and the probe went with it.)
 *
 *  Usage:
 *    npx vite build && npx vite preview --port 4183 --strictPort &
 *    node perf/starfield.mjs                                  # chromium, dpr 1+2
 *    node perf/starfield.mjs --browser webkit
 *    node perf/starfield.mjs --dpr 2 --width 1440 --height 900
 *    node perf/starfield.mjs --json perf/out/starfield-before.json
 *    node perf/starfield.mjs --shot /tmp/before          # + PNG per config
 */

import { chromium, webkit } from '@playwright/test';
import { connect } from 'node:net';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PORT = 4183;
const BASE = `http://127.0.0.1:${PORT}`;

const argv = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? true) : def;
};
const has = (name) => argv.includes(`--${name}`);

const browserName = flag('browser', 'chromium');
const jsonOut = flag('json');
const shotDir = flag('shot');
const label = flag('label', browserName);
/** The map to measure against.  A map with NO nebula tile clusters supplies
 *  no background-nebula centers, so the backdrop is pure star field and the
 *  pixel counts below are stars and nothing else. */
const MAP = flag('map', 'ASTEROID_FIELD');
/** Star MOTION mode to measure/shoot in: 'smooth' (default) or 'crisp'. */
const MOTION = flag('motion', 'smooth');

/** Configurations to sweep.  390x844 is the phone the game is played on and
 *  is the default everywhere in this repo; the desktop size is included
 *  because the reported bug is a DESKTOP Edge-vs-Safari delta, and claim (1)
 *  of the diagnosis is specifically that a different-sized window shows a
 *  different sky. */
const CONFIGS = (() => {
  const w = Number(flag('width', 0));
  const h = Number(flag('height', 0));
  const d = Number(flag('dpr', 0));
  if (w && h && d) return [{ width: w, height: h, dpr: d }];
  return [
    { width: 390, height: 844, dpr: 1 },
    { width: 390, height: 844, dpr: 2 },
    { width: 390, height: 844, dpr: 3 },
    { width: 1440, height: 900, dpr: 1 },
    { width: 1440, height: 900, dpr: 2 },
  ];
})();

function portOpen(port) {
  return new Promise(resolve => {
    const s = connect({ host: '127.0.0.1', port });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.setTimeout(1000, () => done(false));
  });
}

if (!(await portOpen(PORT))) {
  console.error(`no preview server on ${PORT} — run: npx vite build && npx vite preview --port ${PORT} --strictPort &`);
  process.exit(1);
}

// Deterministic PRNG so two runs (and two BROWSERS) build the same sky and a
// difference in the pixels is a difference in RASTERIZATION, not in the seed.
// Same mulberry32 the capture matrix installs.
const INIT_SCRIPT = `
(() => {
  let __seed = 0x9e3779b9;
  Math.random = function () {
    __seed = (__seed + 0x6D2B79F5) >>> 0;
    let t = __seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();
`;

/** Runs IN THE PAGE.  Reaches the BackgroundManager off the debug handle
 *  (CLAUDE.md §8) and reports structure, density and the resample histogram. */
const PROBE = () => {
  const e = window.__omniEngine;
  const bg = e.renderer.backgroundManager;
  const canvas = e.renderer.ctx ? e.renderer.ctx.canvas : document.querySelector('canvas');

  // ── structure ───────────────────────────────────────────────────────────
  // As of S4 the field is DATA, not band canvases: the only bytes it holds are
  // the four star arrays, and there is nothing to blit.
  const bandCount = bg.bandSpeed ? bg.bandSpeed.length : 0;
  const bytes = bg.starX
    ? bg.starX.byteLength + bg.starY.byteLength + bg.starSize.byteLength + bg.starBandIdx.byteLength
    : 0;
  const bandW = bg.bandPixelWidth || 0;
  const bandH = bg.bandPixelHeight || 0;

  // ── density: count LIT pixels in the COMPOSED field ─────────────────────
  // Counting drawn pixels (rather than trusting the loop bound) also catches
  // stars that overlap or land out of bounds.
  const litOf = (c) => {
    const g = c.getContext('2d', { willReadFrequently: true });
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let lit = 0, sumA = 0, sumL = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 0) continue;
      lit++;
      sumA += a;
      sumL += (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) * (a / 255);
    }
    return { lit, meanAlpha: lit ? sumA / lit : 0, sumLuma: sumL };
  };

  // With no band canvases to read, the field is measured by rendering it ONCE
  // into a scratch canvas of the real device size and counting what landed.
  // That is strictly better than the old per-band sampling: it measures the
  // composed field the player actually sees, overlaps included.
  const scratch = document.createElement('canvas');
  scratch.width = bandW; scratch.height = bandH;
  const sctx = scratch.getContext('2d', { willReadFrequently: true });
  bg.renderStars(sctx, 0, 0, bg.sceneDpr);
  const composed = litOf(scratch);
  const sampled = [{ band: 'composed', ...composed }];
  const meanLitPerBand = composed.lit;

  // ── star SIZE as actually drawn, in DEVICE pixels ───────────────────────
  // Walk the composed field's alpha mask and measure connected-run widths on a
  // scanline.  Before S3 the field was 93.8% 2px runs — the signature of a 1x1
  // fillRect antialiased at a fractional origin.  Crisp stars are 1px runs,
  // plus whatever `round(size x dpr)` legitimately makes wider.
  const runHist = {};
  if (bandW > 0) {
    const c = scratch;
    const g = sctx;
    const d = g.getImageData(0, 0, c.width, c.height).data;
    for (let y = 0; y < c.height; y++) {
      let run = 0;
      for (let x = 0; x < c.width; x++) {
        const a = d[(y * c.width + x) * 4 + 3];
        if (a !== 0) run++;
        else if (run) { runHist[run] = (runHist[run] || 0) + 1; run = 0; }
      }
      if (run) runHist[run] = (runHist[run] || 0) + 1;
    }
  }

  // ── the resample experiment ─────────────────────────────────────────────
  // Replay the EXACT blit `render()` performs — a CSS-px band canvas drawn
  // into a setTransform(dpr,...) context — at an integer offset and at a
  // fractional one, then read the device-pixel result back.  If a star is
  // landing on whole device pixels there is one opaque device pixel per
  // source pixel at dpr 1, dpr^2 at dpr 2, and the alpha histogram is a
  // single spike.  Spread across the histogram means a filter ran.
  const resample = (dpr, offset) => {
    if (bandW <= 0) return null;
    const src = scratch;
    // A window big enough for a meaningful sample but small enough to read
    // back quickly.  Device-pixel sized, exactly like the real backing store.
    const W = 256, H = 256;
    const out = document.createElement('canvas');
    out.width = Math.round(W * dpr);
    out.height = Math.round(H * dpr);
    const g = out.getContext('2d', { willReadFrequently: true });
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#000000';
    g.fillRect(0, 0, W, H);
    g.drawImage(src, offset, offset);
    const d = g.getImageData(0, 0, out.width, out.height).data;
    // Histogram the LUMA of every non-black device pixel.  Buckets of 16.
    const hist = new Array(16).fill(0);
    let lit = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
      if (l < 0.5) continue;
      lit++;
      sum += l;
      hist[Math.min(15, Math.floor(l / 16))]++;
    }
    return { lit, meanLuma: +(lit ? sum / lit : 0).toFixed(2), hist };
  };

  const dprNow = window.devicePixelRatio;
  // The ratio the BANDS were generated at — the capped `effectiveDpr`, which
  // is what the 1:1 blit depends on and is not always `window.devicePixelRatio`.
  const sceneDpr = bg.sceneDpr ?? dprNow;
  const areaCss = bg.sceneWidth * bg.sceneHeight;

  return {
    devicePixelRatio: dprNow,
    sceneDpr,
    // What the manager itself believes the scene is.
    sceneWidth: bg.sceneWidth,
    sceneHeight: bg.sceneHeight,
    canvasBackingW: canvas.width,
    canvasBackingH: canvas.height,
    canvasCssW: canvas.clientWidth,
    canvasCssH: canvas.clientHeight,

    numBands: bandCount,
    hasMilkyWay: true,
    bandCanvasW: bandW,
    bandCanvasH: bandH,
    heldCanvasCount: 0,
    backingStoreBytes: bytes,
    backingStoreMB: +(bytes / 1e6).toFixed(1),

    // ── density ────────────────────────────────────────────────────────────
    // Star COUNT comes off the manager and is exact; it is also the quantity
    // S2's invariant is stated in, so it is the one to compare across
    // viewports.  Lit-PIXEL coverage is reported separately and as a FRACTION
    // OF DEVICE PIXELS — dividing device pixels by CSS area (as this probe did
    // before S3) silently multiplies coverage by dpr^2 and makes a dpr-2 run
    // look denser than a dpr-1 run of the identical sky.
    starCount: bg.starCount ?? 0,
    starsPerBand: bg.starsPerBand ?? 0,
    starsPer10kCssPx: +(((bg.starCount ?? 0) / areaCss) * 1e4).toFixed(2),
    litPerBandSampled: sampled,
    meanLitPerBand: +meanLitPerBand.toFixed(1),
    litTotalEstimate: Math.round(meanLitPerBand),
    sceneAreaCssPx: areaCss,
    litCoveragePctOfDevicePx: +(
      meanLitPerBand / (areaCss * sceneDpr * sceneDpr) * 100
    ).toFixed(2),

    sourceRunHistogram: runHist,

    // COUNTERFACTUAL CONTROL, not a measurement of the shipped path.  This
    // replays the blit the code used to perform — a band drawn into a
    // dpr-scaled context at a fractional offset — so the filter's effect stays
    // visible for comparison.  What the code ACTUALLY does now is audited by
    // BLIT_PROBE below, against the live render.
    counterfactualInteger: resample(sceneDpr, 0),
    counterfactualFractional: resample(sceneDpr, 0.5),
  };
};

/** Audits the REAL band blit: wraps `drawImage` on the live context and records
 *  the transform in force and the destination coordinates actually used.
 *
 *  This is the check that matters for S3. A star lands on whole device pixels
 *  only if the blit is (a) unscaled — identity transform, because the bands are
 *  already device-resolution — and (b) at integer destination coordinates. Both
 *  are observable from inside `drawImage`, so neither has to be taken on trust. */
const BLIT_PROBE = (frames) => new Promise(resolve => {
  const e = window.__omniEngine;
  const ctx = e.renderer.ctx;
  const proto = Object.getPrototypeOf(ctx);
  const real = proto.drawImage;
  const bg = e.renderer.backgroundManager;
  const realRender = bg.render.bind(bg);
  let inBg = false;
  const seen = { n: 0, identityScale: 0, integerDst: 0, smoothingOff: 0, samples: [] };

  bg.render = function (...args) { inBg = true; try { return realRender(...args); } finally { inBg = false; } };
  proto.drawImage = function (img, ...rest) {
    if (inBg && rest.length === 2) {
      const t = this.getTransform();
      const [dx, dy] = rest;
      seen.n++;
      // Unscaled and unrotated: the band is blitted 1:1.
      if (t.a === 1 && t.d === 1 && t.b === 0 && t.c === 0) seen.identityScale++;
      // Integer DEVICE-pixel destination, after the transform is applied.
      const px = t.a * dx + t.c * dy + t.e;
      const py = t.b * dx + t.d * dy + t.f;
      if (Number.isInteger(px) && Number.isInteger(py)) seen.integerDst++;
      if (this.imageSmoothingEnabled === false) seen.smoothingOff++;
      if (seen.samples.length < 4) {
        seen.samples.push({ dx, dy, devX: +px.toFixed(3), devY: +py.toFixed(3),
                            scaleX: t.a, scaleY: t.d, smoothing: this.imageSmoothingEnabled });
      }
    }
    return real.call(this, img, ...rest);
  };

  let n = 0;
  const tick = () => {
    if (++n >= frames) {
      proto.drawImage = real;
      bg.render = realRender;
      resolve({
        blits: seen.n,
        pctUnscaled: +(seen.n ? (seen.identityScale / seen.n) * 100 : 0).toFixed(1),
        pctIntegerDst: +(seen.n ? (seen.integerDst / seen.n) * 100 : 0).toFixed(1),
        pctSmoothingOff: +(seen.n ? (seen.smoothingOff / seen.n) * 100 : 0).toFixed(1),
        samples: seen.samples,
      });
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

/** Counts drawImage calls issued into the LIVE render context over N frames. */
const DRAWCALL_PROBE = (frames) => new Promise(resolve => {
  const e = window.__omniEngine;
  const ctx = e.renderer.ctx;
  const proto = Object.getPrototypeOf(ctx);
  const real = proto.drawImage;
  let calls = 0;
  let bgCalls = 0;
  let inBg = false;
  const bg = e.renderer.backgroundManager;
  const realRender = bg.render.bind(bg);
  bg.render = function (...args) { inBg = true; try { return realRender(...args); } finally { inBg = false; } };
  proto.drawImage = function (...args) { calls++; if (inBg) bgCalls++; return real.apply(this, args); };
  let n = 0;
  const tick = () => {
    if (++n >= frames) {
      proto.drawImage = real;
      bg.render = realRender;
      resolve({ frames: n, drawImageTotal: calls, drawImageBackground: bgCalls,
                perFrameTotal: +(calls / n).toFixed(1), perFrameBackground: +(bgCalls / n).toFixed(1) });
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

/** DECISIVE EXPERIMENT for S4: is the pre-rendered-band structure still worth
 *  its cost, or has the trade inverted?
 *
 *  The band canvases exist to turn "one fillRect per star per frame" into "a
 *  few drawImage per frame". That was written when there were 8 bands and
 *  12,000 stars (both stale — see the S1 findings). Today it is 61 bands x 4
 *  tiles = 244 FULL-VIEWPORT blits per frame against ~6,000 stars, and at
 *  device resolution each blit moves the whole screen: at 390x844 dpr2 that is
 *  244 x 780 x 1688 = 321 MEGApixels of mostly-transparent overdraw per frame.
 *
 *  So this times both paths against the same context, flushing the queue with a
 *  1px readback so the numbers are rasterization and not just call submission.
 *  Software raster over-weights fill rate relative to a GPU, so the ABSOLUTE
 *  ratio here is not the device's — but the direction and the order of
 *  magnitude are what the structural decision turns on, and a 244x-overdraw
 *  difference is not a close call that noise could flip. */
const BENCH = (iters) => {
  const e = window.__omniEngine;
  const bg = e.renderer.backgroundManager;
  const bw = bg.bandPixelWidth, bh = bg.bandPixelHeight;

  // The band canvases no longer exist (that is the S4 result), so the OLD
  // structure is RECONSTRUCTED here from the live star data — same stars, same
  // device resolution, same 4-way tiled blit.  Keeping the experiment runnable
  // matters more than keeping the old code: a structural decision this large
  // should be re-checkable on any machine, not just believed from a ledger.
  const NUM_BANDS = bg.bandSpeed.length;
  const bands = [];
  for (let b = 0; b < NUM_BANDS; b++) {
    const c = document.createElement('canvas');
    c.width = bw; c.height = bh;
    bands.push({ canvas: c, ctx: c.getContext('2d') });
  }
  for (const grp of bg.starGroups) {
    const end = grp.start + grp.count;
    for (let i = grp.start; i < end; i++) {
      const bc = bands[bg.starBandIdx[i]];
      bc.ctx.fillStyle = grp.fill;
      bc.ctx.fillRect(bg.starX[i], bg.starY[i], bg.starSize[i], bg.starSize[i]);
    }
  }

  // Draw into a scratch canvas the same size as the real backing store, so
  // fill-rate cost is representative and nothing lands on screen.
  const out = document.createElement('canvas');
  out.width = bw; out.height = bh;
  const g = out.getContext('2d', { willReadFrequently: false });

  const flush = () => g.getImageData(0, 0, 1, 1);

  // ── A: the current path — every band blitted 4-ways ────────────────────
  const pathBands = () => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    for (let i = 0; i < bands.length; i++) {
      const ox = (i * 37) % bw, oy = (i * 53) % bh;   // vary the offset per band
      g.drawImage(bands[i].canvas, ox, oy);
      g.drawImage(bands[i].canvas, ox - bw, oy);
      g.drawImage(bands[i].canvas, ox, oy - bh);
      g.drawImage(bands[i].canvas, ox - bw, oy - bh);
    }
  };

  // ── B: the SHIPPED path — the manager's own renderStars ────────────────
  // Not a re-implementation: calling the real method is what makes this an
  // A/B of two structures rather than an A/B of this file's opinion of them
  // (tests/README.md harness rule 6, which applies to probes too).
  const n = bg.starCount + bg.milkyWayStarCount;
  const pathDirect = () => { bg.renderStars(g, 0, 0, bg.sceneDpr); };

  const time = (fn) => {
    for (let w = 0; w < 3; w++) { fn(); flush(); }         // warm up
    const t0 = performance.now();
    for (let k = 0; k < iters; k++) fn();
    flush();                                                // force raster
    return (performance.now() - t0) / iters;
  };

  // Interleave A/B/A/B so a drifting machine biases both equally.
  const a1 = time(pathBands), b1 = time(pathDirect);
  const a2 = time(pathBands), b2 = time(pathDirect);

  const bandsMs = Math.min(a1, a2), directMs = Math.min(b1, b2);
  return {
    stars: n,
    bandCount: bands.length,
    bandBlitsPerFrame: bands.length * 4,
    overdrawMegapixels: +((bands.length * 4 * bw * bh) / 1e6).toFixed(1),
    bandsMsPerFrame: +bandsMs.toFixed(3),
    directMsPerFrame: +directMs.toFixed(3),
    speedup: +(bandsMs / directMs).toFixed(2),
    bandBytes: bands.length * bw * bh * 4,
    directBytes: bg.starX.byteLength + bg.starY.byteLength
               + bg.starSize.byteLength + bg.starBandIdx.byteLength,
  };
};

const launcher = browserName === 'webkit' ? webkit : chromium;
const browser = await launcher.launch();
const results = [];

for (const cfg of CONFIGS) {
  const ctx = await browser.newContext({
    viewport: { width: cfg.width, height: cfg.height },
    deviceScaleFactor: cfg.dpr,
  });
  await ctx.addInitScript(INIT_SCRIPT);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.__omniEngine);
  await page.evaluate(m => { window.__omniEngine.setMapType(m); window.__omniEngine.startGame(); }, MAP);
  if (MOTION === 'crisp') {
    await page.evaluate(() => window.__omniEngine.dbg.cycleStarMotion());
  }
  // Let the background initialise and a few frames land.
  await page.waitForTimeout(2500);

  const probe = await page.evaluate(PROBE);
  const draws = await page.evaluate(DRAWCALL_PROBE, 60);
  const blit = await page.evaluate(BLIT_PROBE, 30);
  const bench = has('bench') ? await page.evaluate(BENCH, 10) : null;

  if (shotDir) {
    mkdirSync(shotDir, { recursive: true });
    const name = `${label}-${cfg.width}x${cfg.height}-dpr${cfg.dpr}.png`;
    await page.screenshot({ path: `${shotDir}/${name}` });
  }

  results.push({ label, browser: browserName, config: cfg, ...probe, draws, blit, bench, consoleErrors: errors });
  await ctx.close();
}

await browser.close();

// ── report ─────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

console.log(`\n=== star field — ${browserName} — map ${MAP} ===\n`);
console.log(pad('viewport', 12) + rpad('dpr', 4) + rpad('bands', 7) + rpad('band px', 12) +
            rpad('backing MB', 12) + rpad('stars', 8) + rpad('stars/10k css', 15) +
            rpad('lit % dev px', 14) + rpad('bg draws/f', 12));
for (const r of results) {
  console.log(
    pad(`${r.config.width}x${r.config.height}`, 12) +
    rpad(r.config.dpr, 4) +
    rpad(r.numBands, 7) +
    rpad(`${r.bandCanvasW}x${r.bandCanvasH}`, 12) +
    rpad(r.backingStoreMB, 12) +
    rpad(r.starCount, 8) +
    rpad(r.starsPer10kCssPx, 15) +
    rpad(r.litCoveragePctOfDevicePx, 14) +
    rpad(r.draws.perFrameBackground, 12),
  );
}

console.log(`\n--- the REAL background blit path (what the shipped code does, per frame) ---`);
console.log(`(a star lands on whole device pixels iff the blit is unscaled AND integer-aligned.`);
console.log(` Since S4 the field is drawn directly, so there is no blit to align at all.)`);
for (const r of results) {
  const b = r.blit;
  const head = pad(`${r.config.width}x${r.config.height} dpr${r.config.dpr}`, 20);
  if (b.blits === 0) {
    console.log(head + `no band blits — stars drawn directly, nothing to resample`);
  } else {
    console.log(head +
      `blits ${rpad(b.blits, 5)}   unscaled ${rpad(b.pctUnscaled + '%', 7)}` +
      `   integer dst ${rpad(b.pctIntegerDst + '%', 7)}   smoothing off ${rpad(b.pctSmoothingOff + '%', 7)}`);
  }
}

console.log(`\n--- star footprint (scanline run lengths in the COMPOSED field, device px) ---`);
for (const r of results) {
  const h = r.sourceRunHistogram;
  const keys = Object.keys(h).map(Number).sort((a, b) => a - b);
  const total = keys.reduce((s, k) => s + h[k], 0);
  const desc = keys.map(k => `${k}px:${h[k]} (${((h[k] / total) * 100).toFixed(1)}%)`).join('  ');
  console.log(`${r.config.width}x${r.config.height} dpr${r.config.dpr}: ${desc}`);
}

console.log(`\n--- COUNTERFACTUAL: what a fractional, dpr-scaled blit would still do ---`);
console.log(`(control only — the shipped path above does neither. A filter shows up as`);
console.log(` more lit device pixels at lower mean luma.)`);
for (const r of results) {
  const a = r.counterfactualInteger, b = r.counterfactualFractional;
  if (!a || !a.lit) continue;
  console.log(
    pad(`${r.config.width}x${r.config.height} dpr${r.config.dpr}`, 20) +
    `offset 0.0: lit ${rpad(a.lit, 5)} luma ${rpad(a.meanLuma, 7)}` +
    `   |  offset 0.5: lit ${rpad(b.lit, 5)} luma ${rpad(b.meanLuma, 7)}` +
    `   (${((b.lit / a.lit - 1) * 100).toFixed(1)}% more lit px)`,
  );
}

if (has('bench')) {
  console.log(`\n--- S4 STRUCTURE BENCH: pre-rendered bands vs direct per-star draw ---`);
  console.log(`(software raster over-weights fill rate, so treat the RATIO as directional,`);
  console.log(` not as the device's. The overdraw column is exact and device independent.)`);
  for (const r of results) {
    const b = r.bench;
    if (!b) continue;
    console.log(`${r.config.width}x${r.config.height} dpr${r.config.dpr}:  ${b.stars} stars, ${b.bandCount} bands`);
    console.log(`    bands : ${rpad(b.bandsMsPerFrame, 8)} ms/frame   ${rpad(b.bandBlitsPerFrame, 4)} blits   ${rpad(b.overdrawMegapixels, 7)} Mpx overdraw   ${(b.bandBytes / 1e6).toFixed(1)} MB`);
    console.log(`    direct: ${rpad(b.directMsPerFrame, 8)} ms/frame   ${rpad(b.stars, 4)} rects   ${rpad((b.stars * 2 / 1e6).toFixed(3), 7)} Mpx           ${(b.directBytes / 1e6).toFixed(3)} MB`);
    console.log(`    -> direct is ${b.speedup}x the band path`);
  }
}

const anyErrors = results.filter(r => r.consoleErrors.length);
if (anyErrors.length) {
  console.log(`\n!!! console errors seen:`);
  for (const r of anyErrors) console.log(`  ${r.config.width}x${r.config.height} dpr${r.config.dpr}: ${r.consoleErrors.join(' | ')}`);
}

if (jsonOut) {
  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(jsonOut, JSON.stringify(results, null, 2));
  console.log(`\nwrote ${jsonOut}`);
}
console.log('');
