/** Star-REGION visualiser (gauntlet star field, S7).
 *
 *  The region field varies star density by where in the MAP the camera is, so
 *  a single screenshot cannot show it — the whole point is what changes as you
 *  travel. This walks the player across the map, screenshots at each stop, and
 *  reports the field value and the drawn-star fraction at each one.
 *
 *  It also prints a coarse ASCII map of the field, which is the fastest way to
 *  see whether the region SCALE is producing structures at a sensible travel
 *  distance rather than something too fine or too coarse to notice in play.
 *
 *  Usage:
 *    npx vite build && npx vite preview --port 4183 --strictPort &
 *    node perf/starfield-regions.mjs
 *    node perf/starfield-regions.mjs --shot perf/out/shots/regions
 */

import { chromium } from '@playwright/test';
import { connect } from 'node:net';
import { mkdirSync } from 'node:fs';

const PORT = 4183;
const BASE = `http://127.0.0.1:${PORT}`;
const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] ?? true) : d; };
const shotDir = flag('shot');
const MAP = flag('map', 'ASTEROID_FIELD');

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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await ctx.addInitScript(`(() => {
  let __seed = 0x9e3779b9;
  Math.random = function () {
    __seed = (__seed + 0x6D2B79F5) >>> 0;
    let t = __seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();`);
const page = await ctx.newPage();
await page.goto(BASE);
await page.waitForFunction(() => !!window.__omniEngine);
await page.evaluate(m => { window.__omniEngine.setMapType(m); window.__omniEngine.startGame(); }, MAP);
await page.waitForTimeout(2000);

// ── the field, as a coarse map ─────────────────────────────────────────────
const field = await page.evaluate(() => {
  const e = window.__omniEngine;
  const bg = e.renderer.backgroundManager;
  const W = e.currentMap.width, H = e.currentMap.height;
  const N = 28;
  const rows = [];
  for (let j = 0; j < N; j++) {
    let row = '';
    for (let i = 0; i < N; i++) {
      const d = bg.regionDensityAt((i / N - 0.5) * W, (j / N - 0.5) * H);
      row += ' .:-=+*#%@'[Math.min(9, Math.floor(d * 10))];
    }
    rows.push(row);
  }
  return { rows, W, H };
});

console.log(`\n=== star-region field (active step), map ${MAP} ${field.W}x${field.H} ===`);
console.log(`(' ' = emptiest, '@' = richest — one cell is ~${Math.round(field.W / 28)} world units)\n`);
for (const r of field.rows) console.log('   ' + r);

// ── walk the map, sampling and shooting ────────────────────────────────────
const STOPS = 8;
console.log(`\n=== walking the map (${STOPS} stops along the diagonal) ===\n`);
console.log('   stop      world pos        field   drawn stars   of budget');

if (shotDir) mkdirSync(shotDir, { recursive: true });

for (let k = 0; k < STOPS; k++) {
  const out = await page.evaluate((k) => {
    const e = window.__omniEngine;
    const bg = e.renderer.backgroundManager;
    const W = e.currentMap.width, H = e.currentMap.height;
    const x = (k / 8 - 0.5) * W;
    const y = (k / 8 - 0.5) * H * 0.6;
    e.player.position.x = x;
    e.player.position.y = y;
    e.camera.position.x = x;
    e.camera.position.y = y;
    const region = { minFrac: 0.30 };            // the 'Medium' default
    const d = bg.regionDensityAt(x, y);
    const frac = region.minFrac + (1 - region.minFrac) * d;
    let drawn = 0, total = 0;
    for (const g of bg.starGroups) {
      const gated = g.count - g.mwCount;
      drawn += g.mwCount + Math.round(gated * frac);
      total += g.count;
    }
    return { x: Math.round(x), y: Math.round(y), d, frac, drawn, total };
  }, k);
  await page.waitForTimeout(250);
  if (shotDir) await page.screenshot({ path: `${shotDir}/region-${k}-d${out.d.toFixed(2)}.png` });
  console.log(
    `   ${String(k).padStart(4)}   ${String(out.x).padStart(6)},${String(out.y).padStart(6)}` +
    `      ${out.d.toFixed(3)}   ${String(out.drawn).padStart(7)}` +
    `      ${((out.drawn / out.total) * 100).toFixed(1)}%`,
  );
}

// ── the two extremes, which is what a reviewer actually wants to look at ────
// The diagonal walk above is a fair sample; it is not guaranteed to pass
// through the richest and emptiest places on the map. These two do.
if (shotDir) {
  for (const want of ['richest', 'emptiest']) {
    const at = await page.evaluate((want) => {
      const e = window.__omniEngine;
      const bg = e.renderer.backgroundManager;
      const W = e.currentMap.width, H = e.currentMap.height;
      let best = null;
      const N = 60;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const x = (i / N - 0.5) * W, y = (j / N - 0.5) * H;
          const d = bg.regionDensityAt(x, y);
          if (!best || (want === 'richest' ? d > best.d : d < best.d)) best = { x, y, d };
        }
      }
      e.player.position.x = best.x; e.player.position.y = best.y;
      e.camera.position.x = best.x; e.camera.position.y = best.y;
      let drawn = 0, total = 0;
      const frac = 0.30 + 0.70 * best.d;
      for (const g of bg.starGroups) {
        drawn += g.mwCount + Math.round((g.count - g.mwCount) * frac);
        total += g.count;
      }
      return { ...best, drawn, total };
    }, want);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${shotDir}/extreme-${want}-d${at.d.toFixed(2)}.png` });
    console.log(`   ${want.padEnd(9)} field ${at.d.toFixed(3)} at ${Math.round(at.x)},${Math.round(at.y)}` +
                ` — ${at.drawn} stars (${((at.drawn / at.total) * 100).toFixed(1)}% of budget)`);
  }
}

await browser.close();
console.log('');
