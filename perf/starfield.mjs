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
 *   - STRUCTURE (band count, canvas dimensions, star count, backing-store
 *     bytes) is read straight off the live BackgroundManager.  Exact, and
 *     browser independent.
 *   - DENSITY (lit source pixels per band, stars per 10k CSS px^2) is counted
 *     out of the band canvases themselves with getImageData.  Exact.
 *   - RESAMPLING is the interesting one.  A band canvas is CSS-px sized and
 *     blitted into a `setTransform(dpr,0,0,dpr,0,0)` context at a FRACTIONAL
 *     scroll offset, so a 1-CSS-px star lands across several device pixels
 *     with partial alpha, by whatever filter the browser chose.  The probe
 *     replays exactly that blit at an integer offset and at a fractional one,
 *     reads the device-pixel result back, and reports the alpha histogram.
 *     Run it under two engines and the difference in those histograms IS the
 *     cross-browser delta, measured rather than inferred.
 *   - DRAW CALLS are counted by wrapping `drawImage` on the live render
 *     context for a fixed number of frames.  Exact.
 *
 *  Absolute frame TIME is deliberately not reported here: this container
 *  rasterizes canvas in software (see perf/README.md), so a millisecond
 *  figure for a fill-rate-bound background layer would be the rasterizer's
 *  number and not the device's.  Draw-call count and byte count are the
 *  device-independent halves of that cost, and they are what this reports.
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
  const bands = bg.starBands || [];
  const mw = bg.milkyWayBand;
  const all = mw ? bands.concat([mw]) : bands.slice();
  let bytes = 0;
  for (const b of all) bytes += b.canvas.width * b.canvas.height * 4;

  const bandW = bands.length ? bands[0].canvas.width : 0;
  const bandH = bands.length ? bands[0].canvas.height : 0;

  // ── density: count LIT pixels in the source band canvases ───────────────
  // Every star is drawn with fillRect/arc into its band canvas, so a lit
  // source pixel is a star pixel.  Counting them (rather than trusting the
  // loop bound) also catches stars that overlap or land out of bounds.
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

  // Sample a few bands rather than all 60: getImageData over 60 full-viewport
  // canvases is slow enough to time the probe out on a big viewport, and the
  // bands are generated by the same loop with the same star count.
  const sampleIdx = bands.length ? [0, bands.length >> 1, bands.length - 1] : [];
  const sampled = sampleIdx.map(i => ({ band: i, ...litOf(bands[i].canvas) }));
  const meanLitPerBand = sampled.length
    ? sampled.reduce((s, x) => s + x.lit, 0) / sampled.length
    : 0;

  // ── star SIZE as actually drawn, in source (CSS) pixels ─────────────────
  // Walk one band's alpha mask and measure connected-run widths on a scanline.
  // A star floored to `Math.max(1, size)` is a 1x1 fillRect, so a field of
  // exclusively 1-px runs is the claim "every star is one CSS pixel".
  const runHist = {};
  if (bands.length) {
    const c = bands[bands.length - 1].canvas;
    const g = c.getContext('2d', { willReadFrequently: true });
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
    if (!bands.length) return null;
    const src = bands[bands.length - 1].canvas;
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

    numBands: bands.length,
    hasMilkyWay: !!mw,
    bandCanvasW: bandW,
    bandCanvasH: bandH,
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
    litTotalEstimate: Math.round(meanLitPerBand * bands.length),
    sceneAreaCssPx: areaCss,
    litCoveragePctOfDevicePx: +(
      (meanLitPerBand * bands.length) / (areaCss * sceneDpr * sceneDpr) * 100
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
  // Let the background initialise and a few frames land.
  await page.waitForTimeout(2500);

  const probe = await page.evaluate(PROBE);
  const draws = await page.evaluate(DRAWCALL_PROBE, 60);
  const blit = await page.evaluate(BLIT_PROBE, 30);

  if (shotDir) {
    mkdirSync(shotDir, { recursive: true });
    const name = `${label}-${cfg.width}x${cfg.height}-dpr${cfg.dpr}.png`;
    await page.screenshot({ path: `${shotDir}/${name}` });
  }

  results.push({ label, browser: browserName, config: cfg, ...probe, draws, blit, consoleErrors: errors });
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
    rpad(r.numBands + (r.hasMilkyWay ? '+mw' : ''), 7) +
    rpad(`${r.bandCanvasW}x${r.bandCanvasH}`, 12) +
    rpad(r.backingStoreMB, 12) +
    rpad(r.starCount, 8) +
    rpad(r.starsPer10kCssPx, 15) +
    rpad(r.litCoveragePctOfDevicePx, 14) +
    rpad(r.draws.perFrameBackground, 12),
  );
}

console.log(`\n--- the REAL blit path (what the shipped code does, per frame) ---`);
console.log(`(a star lands on whole device pixels iff the blit is unscaled AND integer-aligned)`);
for (const r of results) {
  const b = r.blit;
  console.log(
    pad(`${r.config.width}x${r.config.height} dpr${r.config.dpr}`, 20) +
    `blits ${rpad(b.blits, 5)}   unscaled ${rpad(b.pctUnscaled + '%', 7)}` +
    `   integer dst ${rpad(b.pctIntegerDst + '%', 7)}   smoothing off ${rpad(b.pctSmoothingOff + '%', 7)}`,
  );
}

console.log(`\n--- source star footprint (scanline run lengths, CSS px, top band) ---`);
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
