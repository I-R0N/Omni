/** SPIKE probe — periodic frame-time hitches, which the capture matrix cannot see.
 *
 *  `capture.mjs` reports p99 and max over a window: it answers "how heavy is
 *  the steady state".  A user-visible HITCH is a different question — a few
 *  frames per second that are many times the median, with everything between
 *  them fine.  A p99 can look healthy while every second contains a 200 ms
 *  stall, and a raised p99 can be invisible in play.  So this reports the
 *  SERIES: which frames are outliers, how far apart they are (a stable gap is
 *  a cadence, a scattered one is not), and what dominates them.
 *
 *  ATTRIBUTION is the point.  Each frame carries sim and render timers, so
 *  the RESIDUAL (frame - sim - render) is time the engine did not spend in
 *  its own code — GC, rasterisation, layout.  A spike that is residual is not
 *  fixed by making sim faster, and a spike that is sim is not fixed by
 *  allocating less; telling them apart before touching anything is the whole
 *  job.
 *
 *  The player MOVES throughout, because the report this exists for is
 *  "immediately upon moving" — a parked camera never re-stamps the static
 *  tile cache, never re-culls, and never scrolls the star field.
 *
 *  Usage: npx vite build && node perf/spike.mjs [--map OVERWORLD] [--sec 25]
 */
import { chromium } from '@playwright/test';
import { connect } from 'node:net';

const PORT = 4183;
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const map = arg('map', 'OVERWORLD');
const sec = Number(arg('sec', 25));
const label = arg('label', 'head');
// --pre runs one expression against the live engine before the window opens.
// Ablations belong here rather than in the page bundle: the question is
// always "does removing this suspected cost move the number", and an
// ablation that has to be built into the app is one nobody runs twice.
const pre = arg('pre', '');

function portOpen(p) {
  return new Promise(r => { const s = connect({ host: '127.0.0.1', port: p });
    const d = o => { s.destroy(); r(o); };
    s.once('connect', () => d(true)); s.once('error', () => d(false)); s.setTimeout(1000, () => d(false)); });
}
if (!(await portOpen(PORT))) { console.error(`no preview on ${PORT} — npx vite preview --port ${PORT} --strictPort &`); process.exit(1); }

const browser = await chromium.launch({ args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });
await page.goto(`http://127.0.0.1:${PORT}`);
await page.waitForFunction(() => !!window.__omniEngine);
await page.evaluate(m => { window.__omniEngine.setMapType(m); window.__omniEngine.startGame(); }, map);
await page.waitForTimeout(3000);
if (pre) { await page.evaluate(src => { // eslint-disable-next-line no-eval
  (0, eval)(src); }, pre); await page.waitForTimeout(600); }

const out = await page.evaluate(async (secs) => {
  const e = window.__omniEngine;
  const N = Math.ceil(secs * 70);
  const f = new Float64Array(N), s = new Float64Array(N), r = new Float64Array(N), h = new Float64Array(N);
  let n = 0, last = 0, t = 0;
  // Drive the ship with the SAME channel every device writes: the movement
  // vector the engine reads each frame.  Circling rather than a straight line
  // so the camera keeps entering fresh terrain instead of settling.
  const realGet = e.input.getMovementVector.bind(e.input);
  e.input.getMovementVector = () => { t += 0.016; return { x: Math.cos(t * 0.6), y: Math.sin(t * 0.6) }; };
  await new Promise(res => {
    const tick = (ts) => {
      if (last > 0 && n < N) {
        const i = n++;
        f[i] = ts - last;
        s[i] = e.lastFrameSimMs || 0;
        r[i] = (e.renderer && e.renderer.lastRenderMs) || 0;
        h[i] = (performance.memory && performance.memory.usedJSHeapSize) || 0;
      }
      last = ts;
      if (n >= N) { res(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  e.input.getMovementVector = realGet;

  const fr = Array.from(f.slice(0, n));
  const sorted = [...fr].sort((a, b) => a - b);
  const q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const p50 = q(0.5);
  const thresh = Math.max(p50 * 2, p50 + 8);
  const spikes = [];
  for (let i = 0; i < n; i++) {
    if (fr[i] > thresh) spikes.push({ i, frame: +fr[i].toFixed(1), sim: +s[i].toFixed(1),
      render: +r[i].toFixed(1), resid: +(fr[i] - s[i] - r[i]).toFixed(1) });
  }
  const gaps = [];
  for (let k = 1; k < spikes.length; k++) gaps.push(spikes[k].i - spikes[k - 1].i);
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  // GC events: a heap DROP between consecutive frames.
  let gc = 0, gcBytes = 0, rise = 0;
  for (let i = 1; i < n; i++) { const d = h[i] - h[i - 1]; if (d < 0) { gc++; gcBytes -= d; } else rise += d; }
  return {
    frames: n, seconds: +(fr.reduce((a, b) => a + b, 0) / 1000).toFixed(1),
    p50: +p50.toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), max: +sorted[sorted.length - 1].toFixed(1),
    spikeThreshold: +thresh.toFixed(1), spikeCount: spikes.length,
    spikesPerSec: +(spikes.length / (fr.reduce((a, b) => a + b, 0) / 1000)).toFixed(2),
    gapFrames: { mean: +mean(gaps).toFixed(1), min: gaps.length ? Math.min(...gaps) : 0, max: gaps.length ? Math.max(...gaps) : 0 },
    spikeAvg: { frame: +mean(spikes.map(x => x.frame)).toFixed(1), sim: +mean(spikes.map(x => x.sim)).toFixed(1),
                render: +mean(spikes.map(x => x.render)).toFixed(1), resid: +mean(spikes.map(x => x.resid)).toFixed(1) },
    normalAvg: { sim: +mean(Array.from(s.slice(0, n))).toFixed(2), render: +mean(Array.from(r.slice(0, n))).toFixed(2) },
    heapKBPerFrame: +(rise / n / 1024).toFixed(0), gcEvents: gc, gcFreedMB: +(gcBytes / 1048576).toFixed(1),
    worst: spikes.sort((a, b) => b.frame - a.frame).slice(0, 8),
  };
}, sec);
console.log(`[${label}] map=${map}`);
console.log(JSON.stringify(out, null, 1));
await browser.close();
