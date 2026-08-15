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

  return {
    devicePixelRatio: dprNow,
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

    // Density, expressed the way the fix has to reason about it.
    litPerBandSampled: sampled,
    meanLitPerBand: +meanLitPerBand.toFixed(1),
    litTotalEstimate: Math.round(meanLitPerBand * bands.length),
    sceneAreaCssPx: bg.sceneWidth * bg.sceneHeight,
    litPer10kCssPx: +((meanLitPerBand * bands.length) / (bg.sceneWidth * bg.sceneHeight) * 1e4).toFixed(2),

    sourceRunHistogram: runHist,

    resampleInteger: resample(dprNow, 0),
    resampleFractional: resample(dprNow, 0.5),
    resampleThird: resample(dprNow, 0.37),
  };
};

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

  if (shotDir) {
    mkdirSync(shotDir, { recursive: true });
    const name = `${label}-${cfg.width}x${cfg.height}-dpr${cfg.dpr}.png`;
    await page.screenshot({ path: `${shotDir}/${name}` });
  }

  results.push({ label, browser: browserName, config: cfg, ...probe, draws, consoleErrors: errors });
  await ctx.close();
}

await browser.close();

// ── report ─────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

console.log(`\n=== star field — ${browserName} — map ${MAP} ===\n`);
console.log(pad('viewport', 14) + rpad('dpr', 4) + rpad('bands', 7) + rpad('band px', 12) +
            rpad('backing MB', 12) + rpad('stars', 8) + rpad('per 10k css px2', 17) + rpad('bg draws/f', 12));
for (const r of results) {
  console.log(
    pad(`${r.config.width}x${r.config.height}`, 14) +
    rpad(r.config.dpr, 4) +
    rpad(r.numBands + (r.hasMilkyWay ? '+mw' : ''), 7) +
    rpad(`${r.bandCanvasW}x${r.bandCanvasH}`, 12) +
    rpad(r.backingStoreMB, 12) +
    rpad(r.litTotalEstimate, 8) +
    rpad(r.litPer10kCssPx, 17) +
    rpad(r.draws.perFrameBackground, 12),
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

console.log(`\n--- resampling: device pixels lit, and their luma spread ---`);
console.log(`(integer offset vs fractional offset; a filter shows up as more lit pixels at lower mean luma)`);
for (const r of results) {
  const a = r.resampleInteger, b = r.resampleFractional, c = r.resampleThird;
  if (!a) continue;
  console.log(`${r.config.width}x${r.config.height} dpr${r.config.dpr}:`);
  console.log(`    offset 0.00 : lit ${rpad(a.lit, 6)}  meanLuma ${rpad(a.meanLuma, 7)}`);
  console.log(`    offset 0.50 : lit ${rpad(b.lit, 6)}  meanLuma ${rpad(b.meanLuma, 7)}   (${((b.lit / a.lit - 1) * 100).toFixed(1)}% more lit px)`);
  console.log(`    offset 0.37 : lit ${rpad(c.lit, 6)}  meanLuma ${rpad(c.meanLuma, 7)}   (${((c.lit / a.lit - 1) * 100).toFixed(1)}% more lit px)`);
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
