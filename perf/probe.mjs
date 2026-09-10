/** Targeted in-page probes (gauntlet 5c).
 *
 *  The capture matrix says WHERE allocation happens. Some of those sites have
 *  no visible allocation in their source — `applyFlow` is pure arithmetic over
 *  scratch vectors and still shows ~98 bytes per entity per substep. A probe
 *  answers WHY, by running a minimal loop against the REAL live entity objects
 *  and measuring the heap under it.
 *
 *  Usage: node perf/probe.mjs [--map ASTEROID_FIELD]
 */

import { chromium } from '@playwright/test';
import { connect } from 'node:net';

const PORT = 4183;
const BASE = `http://127.0.0.1:${PORT}`;
const map = (() => { const i = process.argv.indexOf('--map'); return i >= 0 ? process.argv[i + 1] : 'ASTEROID_FIELD'; })();

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
  console.error(`no preview server on ${PORT} — run: npx vite preview --port ${PORT} --strictPort &`);
  process.exit(1);
}

const browser = await chromium.launch({ args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });
await page.goto(BASE);
await page.waitForFunction(() => !!window.__omniEngine);
await page.evaluate(m => { window.__omniEngine.setMapType(m); window.__omniEngine.startGame(); }, map);
await page.waitForTimeout(3000);

const out = await page.evaluate(() => {
  const e = window.__omniEngine;
  const ents = e.entityIndex.asteroids.slice();
  const N = ents.length;
  const ITER = 600;

  // CONTAMINATION WARNING, learned the hard way: accumulating into a
  // captured `let sink` makes the probe allocate on its OWN account — a
  // double written to a closure Context slot is boxed, so every probe reads
  // ~29 bytes/op regardless of what it is measuring. Accumulate into a
  // Float64Array element instead: typed-array stores are unboxed, so the
  // sink costs nothing and the number is the subject's.
  const sink = new Float64Array(4);

  const heap = () => performance.memory.usedJSHeapSize;
  const run = (name, fn) => {
    for (let w = 0; w < 3; w++) fn(); // let V8 optimise this exact loop shape
    const h0 = heap();
    const t0 = performance.now();
    for (let k = 0; k < ITER; k++) fn();
    const t1 = performance.now();
    const bytes = (heap() - h0) / (ITER * N);
    return { name, bytesPerOp: +bytes.toFixed(1), nsPerOp: +(((t1 - t0) * 1e6) / (ITER * N)).toFixed(1) };
  };

  const results = [];
  results.push(run('empty loop (control)', () => {
    for (let i = 0; i < N; i++) sink[0] += 1;
  }));
  results.push(run('read e.position.x/y', () => {
    for (let i = 0; i < N; i++) { const t = ents[i]; sink[0] += t.position.x + t.position.y; }
  }));
  results.push(run('write e.velocity.x/y', () => {
    for (let i = 0; i < N; i++) { const t = ents[i]; t.velocity.x += 1e-9; t.velocity.y += 1e-9; }
  }));
  results.push(run('write e.rotation (direct fld)', () => {
    for (let i = 0; i < N; i++) { ents[i].rotation += 1e-9; }
  }));
  results.push(run('Math.sqrt/min arithmetic', () => {
    for (let i = 0; i < N; i++) {
      const t = ents[i];
      const m = Math.sqrt(7 / Math.max(t.mass, 0.7));
      sink[1] += Math.min(0.8, 0.08 * m);
    }
  }));
  results.push(run('sampleAsteroidFlow', () => {
    for (let i = 0; i < N; i++) {
      const t = ents[i];
      const f = e.flowField.sampleAsteroidFlow(t.position.x, t.position.y);
      sink[2] += f.x + f.y;
    }
  }));
  // The suspected mechanism for the "invisible" allocation in the hot scan
  // loops: passing doubles across a call the compiler does not inline.
  results.push(run('wrapDeltaX/Y cross-call', () => {
    const w = window.__omniWrap;
    if (!w) return;
    for (let i = 0; i < N; i++) {
      const t = ents[i];
      sink[3] += w.dx(0, t.position.x) + w.dy(0, t.position.y);
    }
  }));

  const shapes = new Set();
  for (let i = 0; i < N; i++) shapes.add(Object.keys(ents[i]).join(','));

  // ── Shape-normalisation payoff, measured on the REAL entities ──────────
  //
  // A synthetic test says hidden-class diversity costs ~15x on hot field
  // access. Before refactoring every entity creation site in the engine on
  // the strength of that, measure the prize HERE: build shape-normalised
  // COPIES of the live entities (every key the population uses, assigned in
  // one fixed order, so all copies share one hidden class) and run the same
  // loop over both. The gap is the payoff actually available.
  const allKeys = [];
  const seen = new Set();
  for (let i = 0; i < N; i++) {
    const k = Object.keys(ents[i]);
    for (let j = 0; j < k.length; j++) if (!seen.has(k[j])) { seen.add(k[j]); allKeys.push(k[j]); }
  }
  allKeys.sort();
  const norm = new Array(N);
  for (let i = 0; i < N; i++) {
    const src = ents[i];
    const o = {};
    for (let j = 0; j < allKeys.length; j++) o[allKeys[j]] = src[allKeys[j]];
    norm[i] = o;
  }
  const normShapes = new Set();
  for (let i = 0; i < N; i++) normShapes.add(Object.keys(norm[i]).join(','));

  // The access pattern the engine's hot loops actually run: a handful of
  // optional-field reads, a guard, and a nested-vector write.
  const hotLoop = (arr) => () => {
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if (t.shardVariant === 'nebula-shard') { sink[0] += 1; continue; }
      if (t.mass === Infinity) { sink[0] += 2; continue; }
      const m = t.mass, r = t.rotationSpeed;
      if (r) sink[1] += r * 0.008;
      sink[2] += m + t.position.x + t.velocity.y;
      t.velocity.x += 1e-12;
    }
  };
  const shapeCmp = [
    run(`hot loop / live (${shapes.size} shapes)`, hotLoop(ents)),
    run(`hot loop / normalised (${normShapes.size} shape)`, hotLoop(norm)),
  ];

  return {
    N, results, shapeCmp,
    distinctKeySignatures: shapes.size,
    normalisedSignatures: normShapes.size,
    unionKeyCount: allKeys.length,
    sinkGuard: sink[0] === -1 ? 1 : 0,
  };
});

console.log(`\n### PROBE · ${map} · ${out.N} asteroid-class entities`);
console.log(`distinct own-key signatures among them: ${out.distinctKeySignatures}\n`);
console.log('probe'.padEnd(30) + 'bytes/op'.padStart(10) + 'ns/op'.padStart(10));
console.log('-'.repeat(50));
for (const r of out.results) {
  console.log(r.name.padEnd(30) + String(r.bytesPerOp).padStart(10) + String(r.nsPerOp).padStart(10));
}
console.log(`\nshape-normalisation payoff (union of ${out.unionKeyCount} keys):`);
for (const r of out.shapeCmp) {
  console.log(r.name.padEnd(30) + String(r.bytesPerOp).padStart(10) + String(r.nsPerOp).padStart(10));
}
if (out.shapeCmp.length === 2 && out.shapeCmp[1].nsPerOp > 0) {
  console.log(`\n  => ${(out.shapeCmp[0].nsPerOp / out.shapeCmp[1].nsPerOp).toFixed(2)}x speedup available on this access pattern`);
}
console.log('');

await browser.close();
