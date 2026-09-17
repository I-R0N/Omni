/** Sim-step benchmark (gauntlet 5c).
 *
 *  WHY THIS EXISTS.  `capture.mjs` samples the real rAF loop, which is the
 *  honest way to measure a running game — but in this container that loop is
 *  at the mercy of a software rasterizer and host scheduling, and the
 *  run-to-run spread on `sim/stp99` is around +-10%.  That is wider than most
 *  single optimisations, so milestone-to-milestone A/B on sim time was not
 *  resolvable from the matrix alone.
 *
 *  This benchmark removes the loop.  It drives N sim substeps BACK TO BACK
 *  inside a single frame and reports the mean, so per-frame scheduling noise
 *  is amortised across the whole batch instead of landing on each sample.
 *  Nothing renders during the batch.  What it measures is exactly the number
 *  the 16.7 ms budget cares about: the cost of one fixed-timestep sim step.
 *
 *  It is NOT a replacement for the matrix: it cannot see render cost, frame
 *  pacing, or substep bunching, and by stepping without rendering it lets the
 *  world evolve slightly differently. Use it for "did this change make the
 *  sim cheaper?", and the matrix for everything else.
 *
 *  Usage:
 *    node perf/simbench.mjs                  # default scenes
 *    node perf/simbench.mjs --map ASTEROID_FIELD --steps 400 --batches 8
 */

import { chromium } from '@playwright/test';
import { connect } from 'node:net';

const PORT = 4183;
const BASE = `http://127.0.0.1:${PORT}`;

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const STEPS = Number(flag('steps', 300));
const BATCHES = Number(flag('batches', 7));
const only = flag('map', null);

/** Scenes: map + a setup that puts the world in the state being measured.
 *  Deliberately the same shapes as the capture matrix so the two agree on
 *  what "the asteroid field" or "a boss fight" means. */
const SCENES = only
  ? [{ id: only.toLowerCase(), map: only, setup: 'e => { e.startGame(); }' }]
  : [
      { id: 'hub-idle', map: 'OVERWORLD', setup: 'e => { e.startGame(); }' },
      { id: 'asteroid-6k', map: 'ASTEROID_FIELD', setup: 'e => { e.startGame(); }' },
      { id: 'glass-field', map: 'GLASS_FIELD', setup: 'e => { e.startGame(); e.debugOutfitAll(); }' },
      {
        id: 'roamer-stack', map: 'UNIVERSE',
        setup: `e => {
          e.startGame(); e.debugOutfitAll();
          for (let i = 0; i < 4; i++) e.debugSpawnDragon(['glass','rock','metal','mixed'][i]);
          for (let i = 0; i < 6; i++) e.debugSpawnRival(['hostile','ally','neutral'][i % 3]);
        }`,
      },
    ];

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
const results = [];

for (const scene of SCENES) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Same deterministic PRNG as capture.mjs, for the same reason: two runs of
  // a scene must build the same world or the delta is not a delta.
  await ctx.addInitScript(`(() => {
    let s = 0x9e3779b9;
    Math.random = function () {
      s = (s + 0x6D2B79F5) >>> 0; let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();`);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message)));
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.__omniEngine);
  await page.evaluate(m => window.__omniEngine.setMapType(m), scene.map);
  await page.evaluate(b => { new Function(`return (${b});`)()(window.__omniEngine); }, scene.setup);
  await page.waitForTimeout(3000);

  const r = await page.evaluate(([steps, batches]) => {
    const e = window.__omniEngine;
    const dt = 1 / 120;
    // One batch = `steps` substeps driven back to back, exactly as the
    // accumulator drains them: refresh the working set, sample load, then
    // the two sim phases. Rendering is not called.
    const batch = () => {
      for (let k = 0; k < steps; k++) {
        e.prepareFrameEntities();
        e.perfController.beginStep(
          e.perfCounts.totalEntities,
          e.physics.lastDynamicCount,
          e.physics.lastMaxCellDensity,
          e.lastUpdatePhysicsMs + e.lastUpdateGameLogicMs,
        );
        e.updatePhysics(dt);
        e.updateGameLogic(dt);
      }
    };
    batch(); // warm up: let V8 tier up the whole sim path before timing
    const ms = [];
    for (let b = 0; b < batches; b++) {
      const t0 = performance.now();
      batch();
      ms.push((performance.now() - t0) / steps);
    }
    ms.sort((a, b) => a - b);
    return {
      median: ms[Math.floor(ms.length / 2)],
      best: ms[0],
      worst: ms[ms.length - 1],
      entities: e.perfCounts.totalEntities,
    };
  }, [STEPS, BATCHES]);

  results.push({ scene: scene.id, ...r, errs });
  await ctx.close();
}
await browser.close();

const p = (s, n) => String(s).padEnd(n);
const pl = (s, n) => String(s).padStart(n);
console.log(`\n### SIM BENCH · ${STEPS} steps x ${BATCHES} batches · ms per sim SUBSTEP`);
console.log('# A device holding 60fps drains 2 substeps/frame, so the budget-relevant');
console.log('# figure is 2 x median, against a 16.7ms whole-frame budget.\n');
console.log(p('scene', 16) + pl('ents', 6) + pl('median', 9) + pl('best', 9) + pl('worst', 9) + pl('2x median', 11));
console.log('-'.repeat(60));
for (const r of results) {
  console.log(
    p(r.scene, 16) + pl(r.entities, 6) + pl(r.median.toFixed(3), 9) +
    pl(r.best.toFixed(3), 9) + pl(r.worst.toFixed(3), 9) + pl((2 * r.median).toFixed(2), 11),
  );
  if (r.errs.length) console.log(`   !! ${r.errs.slice(0, 2).join(' | ')}`);
}
console.log('');
