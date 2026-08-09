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
  const ITER = 400;

  const heap = () => performance.memory.usedJSHeapSize;
  // Each probe runs the same shape of loop over the same objects; the only
  // difference is WHAT it touches. Bytes are per (entity x iteration), which
  // is the same unit the capture matrix reports for applyFlow.
  const run = (name, fn) => {
    fn(); // warm up / let V8 settle on a shape for this loop
    const h0 = heap();
    const t0 = performance.now();
    for (let k = 0; k < ITER; k++) fn();
    const t1 = performance.now();
    const bytes = (heap() - h0) / (ITER * N);
    return { name, bytesPerOp: +bytes.toFixed(1), nsPerOp: +(((t1 - t0) * 1e6) / (ITER * N)).toFixed(1) };
  };

  const results = [];
  // 1. Read-only doubles off the entity — baseline for "touching entities".
  let sink = 0;
  results.push(run('read e.position.x/y', () => {
    for (let i = 0; i < N; i++) { const t = ents[i]; sink += t.position.x + t.position.y; }
  }));
  // 2. Write a double back into a nested Vector2 (what applyFlow does most).
  results.push(run('write e.velocity.x/y', () => {
    for (let i = 0; i < N; i++) { const t = ents[i]; t.velocity.x += 1e-9; t.velocity.y += 1e-9; }
  }));
  // 3. Write a double into a DIRECT optional field on the entity.
  results.push(run('write e.rotation', () => {
    for (let i = 0; i < N; i++) { ents[i].rotation += 1e-9; }
  }));
  // 4. The arithmetic applyFlow does, with no entity write at all.
  results.push(run('pure arithmetic (no write)', () => {
    for (let i = 0; i < N; i++) {
      const t = ents[i];
      const m = Math.sqrt(7 / Math.max(t.mass, 0.7));
      sink += Math.min(0.8, 0.08 * m) + Math.sqrt(Math.max(0, t.velocity.x * t.velocity.x));
    }
  }));
  // 5. The real flow sample (scratch-returning) with no write.
  results.push(run('sampleAsteroidFlow only', () => {
    for (let i = 0; i < N; i++) {
      const t = ents[i];
      const f = e.flowField.sampleAsteroidFlow(t.position.x, t.position.y);
      sink += f.x + f.y;
    }
  }));

  // How many distinct hidden classes (shapes) are these entities in? V8 gives
  // no direct API, so approximate by the distinct own-key signature — the
  // thing that drives shape divergence in the first place.
  const shapes = new Set();
  for (let i = 0; i < N; i++) shapes.add(Object.keys(ents[i]).join(','));

  return { N, sink: sink === Infinity ? 1 : 0, results, distinctKeySignatures: shapes.size };
});

console.log(`\n### PROBE · ${map} · ${out.N} asteroid-class entities`);
console.log(`distinct own-key signatures among them: ${out.distinctKeySignatures}\n`);
console.log('probe'.padEnd(30) + 'bytes/op'.padStart(10) + 'ns/op'.padStart(10));
console.log('-'.repeat(50));
for (const r of out.results) {
  console.log(r.name.padEnd(30) + String(r.bytesPerOp).padStart(10) + String(r.nsPerOp).padStart(10));
}
console.log('');

await browser.close();
