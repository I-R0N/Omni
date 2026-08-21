/** Headless capture driver (gauntlet 5c).
 *
 *  WHAT THIS MEASURES, AND WHAT IT DOES NOT
 *
 *  This container renders canvas through a software rasterizer, so ABSOLUTE
 *  frame time here is not the target device's frame time and no "is it 60
 *  fps?" verdict may be read off it.  What IS meaningful headlessly:
 *
 *    - `sim` ms — pure JS CPU work (physics, AI, shards, logic).  Real, and
 *      the number the 16.7 ms budget is mostly spent on.  Comparable across
 *      branches on the same host.
 *    - `render` ms — inflated by software raster, but the JS-side cost
 *      (culling, gradient builds, path assembly) still moves it, so an A/B
 *      DELTA on the same harness is evidence even though the level is not.
 *    - `alloc` bytes/frame — device independent.  Steady-state allocation is
 *      what buys GC pauses, and a GC pause is a dip.  This is the metric the
 *      "zero allocation in hot paths" goal is judged on, and it is exact.
 *
 *  So: LEVELS are indicative, DELTAS are evidence, and ALLOCATION is a hard
 *  number.  Acceptance for "smooth on device" rests on the user's Perf REC
 *  hardware captures, never on this file.
 *
 *  Usage:
 *    node perf/capture.mjs                       # whole matrix, minus soak
 *    node perf/capture.mjs --scene asteroid-6k   # one scene
 *    node perf/capture.mjs --all                 # include the 5-min soak
 *    node perf/capture.mjs --out perf/out/x.json # also write raw JSON
 *    node perf/capture.mjs --repeat 3            # median-of-N per scene
 */

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCENES, sceneById } from './scenes.mjs';

const PORT = 4183;
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 390, height: 844 }; // the phone the game is played on

// ── CLI ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? true) : def;
};
const has = (name) => argv.includes(`--${name}`);

const only = flag('scene');
const includeSoak = has('all') || only === 'soak';
const repeat = Number(flag('repeat', 1));
const outPath = flag('out');
const label = flag('label', 'run');
const ablate = flag('ablate', 'none');
/** Stack frames kept per allocation site. 4 reads cleanly in the matrix
 *  table; 7 is for a `--deep` drill-down against an UNMINIFIED build
 *  (`npx vite build --minify false`), where names are real and the extra
 *  depth is what turns "something in updatePhysics allocates" into a line. */
const STACK_DEPTH = Number(flag('depth', has('deep') ? 7 : 4));
const SAMPLE_INTERVAL = Number(flag('interval', has('deep') ? 4096 : 16384));

/** ABLATIONS — decisive experiments, not fixes.
 *
 *  An ablation removes one suspected cost from the running page and re-runs
 *  the identical scene, so the difference IS that cost.  This is how a
 *  suspicion ("the per-frame React re-render is expensive") becomes a number,
 *  without first doing the work to make it cheap.  Ablated builds are never
 *  shipped and never measured as a "fix"; they only size the prize. */
const ABLATIONS = {
  none: '() => {}',
  // Cut React out of the frame entirely: the engine still builds its stats
  // payload, but nothing re-renders.  Difference = the cost of the per-frame
  // setState + full HUD reconciliation.
  react: `() => { const e = window.__omniEngine; e.onStatsUpdate = () => {}; }`,
  // Sim rate at 60Hz instead of the 120Hz default — the DBG "Sim rate"
  // toggle, driven headlessly so the cost side of the trade can be measured
  // while the feel side is judged by hand.
  simrate60: `() => { window.__omniEngine.cycleSimRate(); }`,
  // applyFlow bisect: the flow body vs. the bare `e.rotation +=` tail that
  // runs even when asteroid flow is off. Splits "the arithmetic allocates"
  // from "writing a double field on a GameEntity allocates".
  flowoff: `() => { window.__omniEngine.asteroidFlowEnabled = false; }`,
  // Same body, but with the per-shard lane jitter (the only branch in
  // applyFlow that WRITES a new property onto an entity) disabled.
  lanejitter0: `() => { window.__omniEngine.ffLaneJitter = 0; }`,
  // Keep React, cut the payload build: isolates the cost of assembling the
  // ~120-field stats object (and its nested snapshots) from the cost of
  // React consuming it.
  statspayload: `() => {
    const e = window.__omniEngine;
    const real = e.onStatsUpdate;
    let cached = null;
    e.buildPerfSnapshot = () => (cached = cached || {});
  }`,
};

const scenes = only
  ? [sceneById(only)]
  : SCENES.filter(s => includeSoak || s.id !== 'soak');

// ── Preview server ─────────────────────────────────────────────────────────
/** Raw TCP probe rather than `fetch`.  This container injects an agent HTTP
 *  proxy into the environment and Node's global fetch dispatcher honours it,
 *  so a `fetch('http://127.0.0.1:…')` readiness check hangs against a
 *  loopback server that is already answering.  A socket connect asks the
 *  only question we actually have — is the port accepting? */
function portOpen(port) {
  return new Promise(resolve => {
    const s = connect({ host: '127.0.0.1', port });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.setTimeout(1000, () => done(false));
  });
}

async function startServer() {
  // Reuse a preview server already on the port.  Repeated matrix runs are the
  // normal working loop of this gauntlet, and re-spawning vite each time is
  // pure latency.  (`--strictPort` means a second spawn would fail anyway.)
  if (await portOpen(PORT)) {
    process.stderr.write(`… reusing preview server on ${PORT}\n`);
    return null;
  }
  // stdio is fully IGNORED, not inherited: an inherited stderr keeps this
  // process's output pipe open for as long as the server lives, so piping the
  // driver into anything (`| tail`) hangs forever after the driver exits.
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await portOpen(PORT)) return proc;
    await new Promise(r => setTimeout(r, 250));
  }
  proc.kill();
  throw new Error('vite preview did not come up');
}

// ── Page-side instrumentation ──────────────────────────────────────────────
//
// Installed before the app boots.  Two pieces:
//   1. A deterministic PRNG replacing Math.random, so two runs of a scene
//      build the same world and an A/B delta is a delta and not noise.
//   2. A per-frame sampler that records the RAW (unsmoothed) per-frame sim
//      and render costs the engine already computes, plus the true rAF
//      delta.  Raw, because the whole point is the worst frame, and a
//      rolling average is exactly the thing that hides one.
const INIT_SCRIPT = `
(() => {
  // Deterministic PRNG (mulberry32).  Seeded per scene by the driver.
  let __seed = 0x9e3779b9;
  window.__perfSeed = (s) => { __seed = s >>> 0; };
  Math.random = function () {
    __seed = (__seed + 0x6D2B79F5) >>> 0;
    let t = __seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const CAP = 40000; // ~11 min at 60fps
  const cap = {
    on: false, n: 0,
    frameMs: new Float64Array(CAP),
    simMs:   new Float64Array(CAP),
    steps:   new Float64Array(CAP),
    renderMs: new Float64Array(CAP),
    lightMs: new Float64Array(CAP),
    fogMs:   new Float64Array(CAP),
    ents:    new Float64Array(CAP),
    heap:    new Float64Array(CAP),
    last: 0,
    hooks: null,
    t0: 0,
    state: {},
  };
  window.__perfCap = cap;

  const tick = (ts) => {
    requestAnimationFrame(tick);
    if (!cap.on) { cap.last = ts; return; }
    const e = window.__omniEngine;
    if (!e) return;
    if (cap.last > 0 && cap.n < CAP) {
      const i = cap.n++;
      cap.frameMs[i] = ts - cap.last;
      // Raw per-frame totals the engine records for spike attribution.
      cap.simMs[i] = e.lastFrameSimMs || 0;
      cap.steps[i] = e.lastFrameSteps || 0;
      cap.renderMs[i] = (e.renderer && e.renderer.lastRenderMs) || 0;
      // Slices OF renderMs, not terms beside it — the lighting layer and the
      // fog compositor.  Raw per-frame (same policy as the totals above).
      cap.lightMs[i] = (e.renderer && e.renderer.lastLightingMs) || 0;
      cap.fogMs[i] = (e.renderer && e.renderer.lastFogMs) || 0;
      cap.ents[i] = (e.perfCounts && e.perfCounts.totalEntities) || 0;
      cap.heap[i] = (performance.memory && performance.memory.usedJSHeapSize) || 0;
    }
    cap.last = ts;
    if (cap.hooks) {
      try { cap.hooks(e, (ts - cap.t0)); } catch (err) { console.error('[perf during]', err); }
    }
  };
  requestAnimationFrame(tick);
})();
`;

// ── Scene-hook API (page side) ─────────────────────────────────────────────
//
// The helpers a scene's `during` may call.  Defined here rather than in
// scenes.mjs because they reach into engine internals, and keeping that
// reach in ONE place is what stops the scene list turning into engine glue.
const HOOK_API = `
({
  everyMs(ms) {
    const s = window.__perfCap.state;
    const now = performance.now();
    if (!s._every) s._every = {};
    const k = 'k' + ms;
    if (s._every[k] === undefined) { s._every[k] = now; return false; }
    if (now - s._every[k] < ms) return false;
    s._every[k] = now;
    return true;
  },
  once(key, cond) {
    const s = window.__perfCap.state;
    if (!s._once) s._once = {};
    if (s._once[key]) return false;
    if (!cond) return false;
    s._once[key] = true;
    return true;
  },
  /** Kill the N tiles/shards nearest the player through the FULL death path
   *  (shatter + regen queue + drops), i.e. what a cannon into a cluster does. */
  shatterNearestTiles(n) {
    const e = window.__omniEngine;
    if (!e || !e.currentMap) return;
    const px = e.player.position.x, py = e.player.position.y;
    const cands = [];
    const ents = e.currentMap.entities;
    for (let i = 0; i < ents.length; i++) {
      const t = ents[i];
      if (!t.active || t.type !== 'STRUCTURE') continue;
      if (!t.shardVariant || t.shardVariant.indexOf('indestructible') >= 0) continue;
      const dx = t.position.x - px, dy = t.position.y - py;
      cands.push([dx * dx + dy * dy, t]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < Math.min(n, cands.length); i++) {
      const t = cands[i][1];
      t.killedByPlayer = true;
      t.health = 0;
      e.handleEntityDeath(t);
      t.active = false;
    }
  },
  /** Wipe every live enemy in one frame through the full death path — the
   *  snitch board-clear / capstone rout shape. */
  routField() {
    const e = window.__omniEngine;
    if (!e || !e.currentMap) return;
    const ents = e.currentMap.entities.slice();
    for (let i = 0; i < ents.length; i++) {
      const x = ents[i];
      if (!x.active || x.type !== 'ENEMY') continue;
      x.killedByPlayer = true;
      x.health = 0;
      e.handleEntityDeath(x);
      x.active = false;
    }
  },
  /** Portal-travel to a random arena (the map-load long frame + its residue). */
  travel() {
    const e = window.__omniEngine;
    if (!e || !e.portals || e.portals.length === 0) return;
    const p = e.portals[0];
    if (p && p.portalTargetId) e.transitionToMap(p.portalTargetId);
  },
})
`;

// ── Statistics ─────────────────────────────────────────────────────────────
function summarize(arr) {
  const n = arr.length;
  if (n === 0) return { n: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const s = Float64Array.from(arr).sort();
  const q = (p) => s[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))];
  let sum = 0;
  for (let i = 0; i < n; i++) sum += arr[i];
  return { n, mean: sum / n, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[n - 1] };
}

/** Allocation, measured two independent ways, because neither alone is
 *  trustworthy and their AGREEMENT is what makes the number evidence.
 *
 *   - Heap trace: sum the positive frame-to-frame steps of
 *     `usedJSHeapSize`.  Catches everything, but the counter is coarse and
 *     a GC landing mid-frame hides the rise that preceded it.
 *   - Sampling profiler: exact and attributable to a call frame, but it is
 *     a SAMPLE (one per `samplingInterval` bytes) so small allocators can
 *     fall below its resolution.
 *
 *  We report both. When they agree, the level is real; when they diverge,
 *  the profiler's attribution is still the actionable half.  `gcEvents`
 *  counts heap drops — the GC CADENCE, which is the thing that actually
 *  shows up as a dip regardless of which byte count is closer. */
function allocStats(heap) {
  let rise = 0, gcEvents = 0, maxDrop = 0;
  for (let i = 1; i < heap.length; i++) {
    const d = heap[i] - heap[i - 1];
    if (d > 0) rise += d;
    else if (d < 0) { gcEvents++; if (-d > maxDrop) maxDrop = -d; }
  }
  const frames = Math.max(1, heap.length - 1);
  return { bytesPerFrame: rise / frames, gcEvents, maxDropMB: maxDrop / 1048576 };
}

// ── Allocation attribution (CDP sampling heap profiler) ────────────────────
//
// The sampling profiler attributes allocated bytes to the call frame that
// allocated them.  That turns "something allocates" into a ranked list of
// functions, which is the only form of the fact you can act on.
async function collectAllocProfile(cdp) {
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  const byFn = new Map();
  const byStack = new Map();
  let total = 0;
  // Leaf name alone is not actionable: the top allocator in every scene is
  // `next`, and "an iterator allocated" tells you nothing without the caller.
  // So aggregate BOTH — by leaf (what allocates) and by the last few frames of
  // the stack (where it is called from), which is the half you can fix.
  const walk = (node, stack) => {
    const f = node.callFrame;
    // Against an unminified build, line numbers are real and worth keeping;
    // against the production bundle they point at column soup, so only the
    // name (which esbuild preserves for methods) carries information.
    const name = (f.functionName || '(anon)') +
      (has('deep') && f.lineNumber >= 0 ? `:${f.lineNumber + 1}` : '');
    const here = stack.length >= STACK_DEPTH ? [...stack.slice(1), name] : [...stack, name];
    if (node.selfSize > 0) {
      byFn.set(name, (byFn.get(name) || 0) + node.selfSize);
      const key = here.join(' < ');
      byStack.set(key, (byStack.get(key) || 0) + node.selfSize);
      total += node.selfSize;
    }
    for (const c of node.children || []) walk(c, here);
  };
  walk(profile.head, []);
  const rank = (m, n) => [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([fn, bytes]) => ({ fn, kb: +(bytes / 1024).toFixed(1) }));
  return { top: rank(byFn, 16), stacks: rank(byStack, 16), totalKB: +(total / 1024).toFixed(1) };
}

// ── One scene run ──────────────────────────────────────────────────────────
async function runScene(browser, scene, seed) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(String(e.message)));

  await page.goto(BASE);
  await page.waitForFunction(() => !!window.__omniEngine && !!window.__omniStats, null, { timeout: 60_000 });
  await page.evaluate(s => window.__perfSeed(s), seed);

  // Map choice + setup, then let the world settle so we sample steady state
  // and not the first-frame warm-up (asset decode, first gradient builds).
  if (scene.map) await page.evaluate(m => window.__omniEngine.setMapType(m), scene.map);
  await page.evaluate(body => {
    // eslint-disable-next-line no-new-func
    new Function('e', `return (${body})(e)`)(window.__omniEngine);
  }, scene.setup.toString());
  await page.waitForTimeout(2500);

  if (ablate !== 'none') {
    const body = ABLATIONS[ablate];
    if (!body) throw new Error(`unknown ablation "${ablate}" (have: ${Object.keys(ABLATIONS).join(', ')})`);
    // eslint-disable-next-line no-new-func
    await page.evaluate(b => { new Function(`return (${b});`)()(); }, body);
  }

  // Arm the during-hook (if any) and the sampler, then run the window.
  await page.evaluate(([body, api]) => {
    const cap = window.__perfCap;
    cap.n = 0; cap.last = 0; cap.state = {}; cap.t0 = performance.now();
    if (body) {
      // eslint-disable-next-line no-new-func
      const fn = new Function('e', 'frac', 'api', `return (${body})(e, frac, api)`);
      // eslint-disable-next-line no-new-func
      // Parenthesised on the SAME line as `return`: the API source starts with
      // a newline, and `return\n(...)` is an automatic-semicolon-insertion trap
      // that silently returns undefined.
      const a = new Function(`return (${api});`)();
      cap.hooks = (e, elapsed) => fn(e, elapsed / (cap.windowMs || 1), a);
    } else cap.hooks = null;
    cap.on = true;
  }, [scene.during ? scene.during.toString() : null, HOOK_API]);
  await page.evaluate(ms => { window.__perfCap.windowMs = ms; }, scene.windowSec * 1000);

  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  // `includeObjectsCollectedBy*GC` is load-bearing, not a detail.  By default
  // V8's sampling heap profiler DROPS samples for objects that have since been
  // collected, so the profile describes what SURVIVED — retention, not
  // allocation.  Steady-state per-frame garbage is by definition collected, so
  // the default profile misses essentially all of it: measured here, the
  // default under-reported total allocation by ~500x against the heap trace.
  // With both flags on, the profile is the allocation rate we actually care
  // about, attributed to the call frame that produced it.
  await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: SAMPLE_INTERVAL,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });

  await page.waitForTimeout(scene.windowSec * 1000);

  await page.evaluate(() => { window.__perfCap.on = false; window.__perfCap.hooks = null; });
  const alloc = await collectAllocProfile(cdp);

  const raw = await page.evaluate(() => {
    const c = window.__perfCap;
    const cut = (a) => Array.from(a.subarray(0, c.n));
    return {
      frameMs: cut(c.frameMs), simMs: cut(c.simMs), steps: cut(c.steps),
      renderMs: cut(c.renderMs), lightMs: cut(c.lightMs), fogMs: cut(c.fogMs),
      ents: cut(c.ents), heap: cut(c.heap),
    };
  });

  await context.close();

  // Sim cost per SUBSTEP.  This container's software raster stretches frames,
  // which pulls extra substeps in, which inflates per-FRAME sim — so the
  // per-frame number here is partly an artefact of the host.  Per-substep is
  // the host-independent measure of the sim's own cost; per-frame is what the
  // budget actually sees.  Both are reported, and mixing them up is the
  // easiest way to misread this whole matrix.
  const perStep = [];
  for (let i = 0; i < raw.simMs.length; i++) {
    if (raw.steps[i] > 0) perStep.push(raw.simMs[i] / raw.steps[i]);
  }
  const alloc2 = allocStats(raw.heap);
  const frames = Math.max(1, raw.frameMs.length);

  return {
    scene: scene.id,
    seed,
    frames: raw.frameMs.length,
    entitiesMax: Math.max(0, ...raw.ents),
    frame: summarize(raw.frameMs),
    sim: summarize(raw.simMs),
    simPerStep: summarize(perStep),
    steps: summarize(raw.steps),
    render: summarize(raw.renderMs),
    light: summarize(raw.lightMs),
    fog: summarize(raw.fogMs),
    alloc: alloc2,
    allocProfileKB: alloc.totalKB,
    allocProfileBytesPerFrame: Math.round((alloc.totalKB * 1024) / frames),
    allocTop: alloc.top,
    allocStacks: alloc.stacks,
    heapStartMB: raw.heap.length ? raw.heap[0] / 1048576 : 0,
    heapEndMB: raw.heap.length ? raw.heap[raw.heap.length - 1] / 1048576 : 0,
    consoleErrors,
  };
}

// ── Reporting ──────────────────────────────────────────────────────────────
const f2 = (x) => x.toFixed(2);
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

function printReport(results) {
  console.log(`\n### PERF MATRIX · ${label} · ${VIEWPORT.width}x${VIEWPORT.height}` +
    (ablate !== 'none' ? ` · ABLATION=${ablate}` : ''));
  console.log('# sim/render ms are IN-CODE cost. Levels are indicative (software raster);');
  console.log('# deltas are evidence; alloc bytes/frame is exact.\n');
  console.log(pad('scene', 20) + padL('ents', 6) + padL('stp', 5) +
    padL('sim/stp99', 10) + padL('sim p99', 9) + padL('sim max', 9) +
    padL('rnd p99', 9) + padL('rnd max', 9) +
    padL('lit p99', 9) + padL('lit max', 9) + padL('fog p99', 9) +
    padL('heapB/f', 9) + padL('profB/f', 9) + padL('GC/s', 6) + padL('heapΔ', 7));
  console.log('-'.repeat(139));
  for (const r of results) {
    const secs = Math.max(1e-3, (r.frame.mean * r.frames) / 1000);
    console.log(
      pad(r.scene, 20) + padL(r.entitiesMax, 6) + padL(f2(r.steps.mean), 5) +
      padL(f2(r.simPerStep.p99), 10) +
      padL(f2(r.sim.p99), 9) + padL(f2(r.sim.max), 9) +
      padL(f2(r.render.p99), 9) + padL(f2(r.render.max), 9) +
      padL(f2(r.light.p99), 9) + padL(f2(r.light.max), 9) + padL(f2(r.fog.p99), 9) +
      padL(Math.round(r.alloc.bytesPerFrame), 9) + padL(r.allocProfileBytesPerFrame, 9) +
      padL((r.alloc.gcEvents / secs).toFixed(1), 6) +
      padL((r.heapEndMB - r.heapStartMB).toFixed(1), 7),
    );
  }
  console.log('\n## Allocation attribution (sampling profiler, whole window)');
  for (const r of results) {
    console.log(`\n[${r.scene}] sampled total ${r.allocProfileKB} KB over ${r.frames} frames`);
    console.log('  by call stack (caller < … < allocator):');
    for (const a of r.allocStacks.slice(0, 10)) console.log(`   ${padL(a.kb, 9)} KB  ${a.fn}`);
    console.log('  by leaf:');
    for (const a of r.allocTop.slice(0, 8)) console.log(`   ${padL(a.kb, 9)} KB  ${a.fn}`);
    if (r.consoleErrors.length) {
      const uniq = [...new Set(r.consoleErrors.map(e => e.split('\n')[0]))];
      console.log(`   !! console errors (${r.consoleErrors.length}): ${uniq.slice(0, 3).join(' | ')}`);
    }
  }
  console.log('');
}

// ── Main ───────────────────────────────────────────────────────────────────
const server = await startServer();
const browser = await chromium.launch({
  args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'],
});
const results = [];
try {
  for (const scene of scenes) {
    const runs = [];
    for (let i = 0; i < repeat; i++) {
      process.stderr.write(`… ${scene.id} (${i + 1}/${repeat}, ${scene.windowSec}s)\n`);
      runs.push(await runScene(browser, scene, 12345));
    }
    // Median run by sim p99 — one representative run, not a blended average
    // that could hide a bimodal result.
    runs.sort((a, b) => a.sim.p99 - b.sim.p99);
    results.push(runs[Math.floor(runs.length / 2)]);
  }
} finally {
  await browser.close();
  if (server) server.kill();
}

printReport(results);
if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ label, viewport: VIEWPORT, results }, null, 2));
  console.error(`wrote ${outPath}`);
}
