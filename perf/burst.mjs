/** Burst probe (gauntlet 5c, P7) — one-frame work spikes.
 *
 *  The capture matrix samples whole frames, which is the right lens for
 *  steady state and the wrong one for a SPIKE: a 40 ms hitch that happens
 *  once per enemy death is a rounding error in a 12-second p99 but is the
 *  most noticeable thing in the game.
 *
 *  User report (2026-08-09): "noticeable lag whether an enemy is killed or
 *  when the wave ends". Both are one-frame work bursts. This probe times
 *  those two events DIRECTLY — call the real handler, measure it, repeat —
 *  so the cost is attributed to the event rather than averaged into a frame.
 *
 *  Usage: node perf/burst.mjs [--map UNIVERSE] [--reps 40]
 */

import { chromium } from '@playwright/test';
import { connect } from 'node:net';

const PORT = 4183;
const BASE = `http://127.0.0.1:${PORT}`;
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const MAP = flag('map', 'UNIVERSE');
const REPS = Number(flag('reps', 40));

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
  console.error(`no preview server on ${PORT} — run: npx vite preview --port ${PORT} --strictPort &`);
  process.exit(1);
}

const browser = await chromium.launch({ args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(BASE);
await page.waitForFunction(() => !!window.__omniEngine);
await page.evaluate(m => { window.__omniEngine.setMapType(m); window.__omniEngine.startGame(); }, MAP);
await page.evaluate(() => window.__omniEngine.debugOutfitAll());
await page.waitForTimeout(3000);

const out = await page.evaluate((reps) => {
  const e = window.__omniEngine;
  const results = [];

  const stat = (name, samples, extra) => {
    const s = samples.slice().sort((a, b) => a - b);
    const sum = samples.reduce((a, b) => a + b, 0);
    results.push({
      name,
      n: samples.length,
      mean: sum / samples.length,
      p50: s[Math.floor(s.length * 0.5)],
      p95: s[Math.floor(s.length * 0.95)],
      max: s[s.length - 1],
      extra: extra || '',
    });
  };

  const spawnOne = () => {
    const a = Math.random() * Math.PI * 2;
    return e.waves.spawnAt(
      'RAMMER_1',
      { x: e.player.position.x + Math.cos(a) * 500, y: e.player.position.y + Math.sin(a) * 500 },
      e.waveContext(), true,
    );
  };

  // ── 1. A single enemy death, through the real death path ───────────────
  {
    const ms = [];
    for (let k = 0; k < reps; k++) {
      const victim = spawnOne();
      if (!victim) continue;
      victim.killedByPlayer = true;
      victim.health = 0;
      const t0 = performance.now();
      e.handleEntityDeath(victim);
      ms.push(performance.now() - t0);
      victim.active = false;
    }
    stat('enemy death (handleEntityDeath)', ms, `entities after: ${e.currentMap.entities.length}`);
  }

  // ── 2. The step that follows a death, with the debris live ─────────────
  // A death's cost is not only the handler: it dumps particles, shards and
  // drops into the world, and the NEXT sim steps pay to move them.  The
  // broadphase is O(k^2) per grid CELL, and a death dumps its debris into
  // one spot — so peak cell density is the number to watch, not the entity
  // total.
  {
    const ms = [];
    const dens = [];
    for (let k = 0; k < 30; k++) {
      const t0 = performance.now();
      e.prepareFrameEntities();
      e.updatePhysics(1 / 120);
      e.updateGameLogic(1 / 120);
      ms.push(performance.now() - t0);
      dens.push(e.physics.lastMaxCellDensity);
    }
    const census = {};
    for (const x of e.currentMap.entities) {
      if (!x.active) continue;
      const k = x.type + (x.shardVariant ? ':' + x.shardVariant : '');
      census[k] = (census[k] || 0) + 1;
    }
    const top = Object.entries(census).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([k, v]) => `${k}=${v}`).join(' ');
    stat('sim step, post-death debris', ms,
      `ents ${e.currentMap.entities.length} · peakCellDensity ${Math.max(...dens)} · ${top}`);
  }

  // ── 2b. RENDER either side of a death ──────────────────────────────────
  // Every newly spawned entity misses its per-entity render caches on its
  // first draw (tinted sprite, shard polygon, body/glow gradients).  A death
  // spawns a burst of them at once, so the FIRST frame after it can pay a
  // pile of one-time cache fills that steady state never shows.  Measure a
  // settled draw, then a draw with a fresh burst in the world.
  {
    const warm = [];
    for (let k = 0; k < 20; k++) {
      const t0 = performance.now();
      e.draw();
      warm.push(performance.now() - t0);
    }
    stat('draw — settled (caches warm)', warm, '');

    const cold = [];
    for (let k = 0; k < 12; k++) {
      // Fresh kills right where the camera is looking, so their debris is
      // on-screen and actually drawn.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const v = e.waves.spawnAt('RAMMER_1', {
          x: e.player.position.x + Math.cos(a) * 120,
          y: e.player.position.y + Math.sin(a) * 120,
        }, e.waveContext(), true);
        if (v) { v.killedByPlayer = true; v.health = 0; e.handleEntityDeath(v); v.active = false; }
      }
      e.prepareFrameEntities();
      const t0 = performance.now();
      e.draw();
      cold.push(performance.now() - t0);
    }
    stat('draw — frame after 6 deaths', cold, 'first draw of fresh debris');
  }

  // ── 3. Wave clear ──────────────────────────────────────────────────────
  {
    const ms = [];
    for (let k = 0; k < 12; k++) {
      const t0 = performance.now();
      e.handleWaveCleared(e.waveIndex, 30, false);
      ms.push(performance.now() - t0);
    }
    stat('wave clear (handleWaveCleared)', ms, `entities after: ${e.currentMap.entities.length}`);
  }

  // ── 4. A mass-death frame: many deaths in ONE frame ────────────────────
  {
    const ms = [];
    for (let k = 0; k < 6; k++) {
      const victims = [];
      for (let i = 0; i < 20; i++) { const v = spawnOne(); if (v) victims.push(v); }
      const t0 = performance.now();
      for (const v of victims) { v.killedByPlayer = true; v.health = 0; e.handleEntityDeath(v); v.active = false; }
      ms.push(performance.now() - t0);
    }
    stat('20 deaths in one frame', ms, `entities after: ${e.currentMap.entities.length}`);
  }

  return { results, entities: e.currentMap.entities.length };
}, REPS);

const p = (s, n) => String(s).padEnd(n);
const pl = (s, n) => String(s).padStart(n);
console.log(`\n### BURST PROBE · ${MAP} · one-frame work spikes (ms)\n`);
console.log(p('event', 32) + pl('n', 4) + pl('mean', 9) + pl('p50', 9) + pl('p95', 9) + pl('max', 9) + '  note');
console.log('-'.repeat(95));
for (const r of out.results) {
  console.log(
    p(r.name, 32) + pl(r.n, 4) + pl(r.mean.toFixed(2), 9) + pl(r.p50.toFixed(2), 9) +
    pl(r.p95.toFixed(2), 9) + pl(r.max.toFixed(2), 9) + '  ' + r.extra,
  );
}
if (errs.length) console.log(`\n!! page errors: ${[...new Set(errs)].slice(0, 3).join(' | ')}`);
console.log('');
await browser.close();
