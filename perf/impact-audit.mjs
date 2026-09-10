/** IMPACT AUDIT — step 1 of the unified-impact-physics sequencing
 *  (docs/PARKING_LOT.md, "Unified impact physics …" §5.1).
 *
 *  Establishes what a shipped weapon's authored `damage` is WORTH in energy
 *  and momentum terms against each material's DERIVED HP, and what the crash
 *  gates correspond to in those same units — so any future conversion
 *  constant can be FITTED to the game that exists rather than chosen.
 *
 *  Everything here is measured through the REAL engine in a REAL browser via
 *  `window.__omniEngine` / `window.__omniGrain` (CLAUDE.md §8), on the
 *  `perf/probe.mjs` terms.  Nothing re-derives the arithmetic in this file:
 *  derived HP comes out of `applyBoundaryDamage`'s own model build (driven
 *  through `GameEngine.chipStructureAt` at zero damage), weapon numbers come
 *  off a LIVE spawned projectile, and the collision velocity step comes from
 *  `PhysicsSystem.impactStrength` itself.
 *
 *  Usage:  npx vite preview --port 4183 --strictPort &
 *          node perf/impact-audit.mjs [--samples 60]
 */

import { chromium } from '@playwright/test';
import { connect } from 'node:net';

const PORT = 4183;
const BASE = `http://127.0.0.1:${PORT}`;
const SAMPLES = (() => { const i = process.argv.indexOf('--samples'); return i >= 0 ? Number(process.argv[i + 1]) : 60; })();

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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });
page.on('pageerror', e => console.error('[pageerror]', e.message));
await page.goto(BASE);
await page.waitForFunction(() => !!window.__omniEngine);

const MATERIALS = [
  { mat: 'rock',    map: 'ROCK_FIELD',      tile: 'rock-tile',    shard: 'rock-shard' },
  { mat: 'glass',   map: 'GLASS_FIELD',    tile: 'glass-tile',   shard: 'glass-shard' },
  { mat: 'plastic', map: 'PLASTIC_FIELD',  tile: 'plastic-tile', shard: 'plastic-shard' },
  { mat: 'metal',   map: 'METAL_FIELD',    tile: 'metal-tile',   shard: 'metal-shard' },
];

// ── 1. Per material: derived HP and its spread ──────────────────────────────
const materials = [];
for (const m of MATERIALS) {
  await page.evaluate(mapType => {
    const e = window.__omniEngine;
    // setMapType is honoured only from the MAIN MENU, so come back to it
    // between materials rather than switching mid-run.
    e.restartGame();
    e.setMapType(mapType);
    e.startGame();
  }, m.map);
  await page.waitForFunction(v => {
    const e = window.__omniEngine;
    return !!e.currentMap && e.currentMap.entities.some(x => x.shardVariant === v);
  }, m.tile, { timeout: 60_000 });

  const out = await page.evaluate(({ tileV, shardV, n }) => {
    const e = window.__omniEngine;
    const grain = window.__omniGrain.grainSpecFor(tileV);
    const ents = e.currentMap.entities;

    // A body's DERIVED HP is built by `ensureBoundaryModel`, which
    // `applyBoundaryDamage` calls.  Drive it through the one public
    // non-weapon caller of the grain model at ZERO damage: the model is
    // built and `health` is set to the full boundary budget, and no
    // boundary is spent, so nothing breaks and nothing is re-derived here.
    const derive = (b) => {
      const authored = b.maxHealth;
      const ok = e.chipStructureAt(b, { x: b.position.x, y: b.position.y }, 0);
      if (!ok) return null;
      return {
        size: b.size.x,
        authored: b.authoredMaxHealth !== undefined ? b.authoredMaxHealth : authored,
        derived: b.maxHealth,
        edges: b.fractureEdges ? b.fractureEdges.length : 0,
        cells: b.fractureCells ? b.fractureCells.length : 0,
      };
    };

    const tiles = [];
    for (const b of ents) {
      if (tiles.length >= n) break;
      if (b.active && b.shardVariant === tileV && b.mass === Infinity && (b.health ?? 0) > 0) {
        const r = derive(b);
        if (r !== null) tiles.push(r);
      }
    }

    // SHARDS: break real tiles and measure the fragments the real spawn
    // ladder (`ShardSystem.spawnShardHealth`) produced, so the AUTHORED
    // spawn HP and the DERIVED boundary HP can be read side by side.
    const seen = new Set(ents.map(x => x.id));
    let killed = 0;
    for (const b of ents.slice()) {
      if (killed >= 24) break;
      if (b.active && b.shardVariant === tileV && b.mass === Infinity && (b.health ?? 0) > 0
          && !tiles.some(t => false)) {
        b.health = 0;
        b.lastImpactVelocity = { x: 4, y: 0 };
        b.lastImpactDamage = 3;
        e.handleEntityDeath(b);
        killed++;
      }
    }
    const shards = [];
    for (const b of e.currentMap.entities) {
      if (shards.length >= n) break;
      if (b.active && !seen.has(b.id) && b.shardVariant === shardV && b.mass !== Infinity
          && (b.health ?? 0) > 0) {
        const r = derive(b);
        if (r !== null) { r.mass = b.mass; shards.push(r); }
      }
    }
    return { grain, tiles, shards };
  }, { tileV: m.tile, shardV: m.shard, n: SAMPLES });

  materials.push({ ...m, ...out });
}

// ── 2. Per weapon: authored damage, live projectile mass and muzzle speed ───
const weapons = await page.evaluate(() => {
  const e = window.__omniEngine;
  e.setMapType('POCKET');
  e.startGame();
  const p = e.player;
  const out = [];
  const list = e.stats && e.stats.weaponCatalog ? null : null;
  const TYPES = ['BLASTER', 'BURST', 'SHOTGUN', 'BOUNCER', 'LIGHTNING', 'HOMING', 'CANNON'];
  for (const t of TYPES) {
    const cfg = e.weapons.getConfig(t);
    // Spawn a LIVE shot from a stationary player and read the projectile the
    // real spawn path produced — mass and muzzle speed are the numbers the
    // sim actually flies, not the table's intent.
    p.velocity.x = 0; p.velocity.y = 0;
    p.currentWeapon = t;
    p.weaponCooldown = 0;
    const before = new Set(e.currentMap.entities.map(x => x.id));
    e.weapons.firePlayerWeapon(e.currentMap.entities, p,
      { x: p.position.x + 500, y: p.position.y });
    const shot = e.currentMap.entities.find(x => !before.has(x.id) && x.type === 'PROJECTILE');
    out.push({
      type: t, name: cfg.name,
      damage: cfg.damage, pierce: cfg.pierce, count: cfg.count, cooldown: cfg.cooldown,
      cfgSpeed: cfg.speed,
      mass: shot ? shot.mass : null,
      speed: shot ? Math.hypot(shot.velocity.x, shot.velocity.y) : null,
      splash: cfg.explosionDamage,
    });
    for (const x of e.currentMap.entities) if (!before.has(x.id)) x.active = false;
  }
  return out;
});

// ── 3. Crash paths: the real velocity step, at the real gates ──────────────
await page.evaluate(() => {
  const e = window.__omniEngine;
  // The mobile-shard population is what actually meets the momentum gate, so
  // sample it on the map that HAS one rather than on the weapons scratchpad.
  e.restartGame(); e.setMapType('ASTEROID_FIELD'); e.startGame();
});
await page.waitForFunction(() => {
  const e = window.__omniEngine;
  return !!e.currentMap && e.currentMap.entities.filter(
    x => x.active && x.type === 'STRUCTURE' && x.mass !== Infinity).length > 200;
}, undefined, { timeout: 60_000 });

const crashes = await page.evaluate(() => {
  const e = window.__omniEngine;
  const P = e.physics;
  const impactStrength = P.constructor.impactStrength;
  const playerMass = e.player.mass;

  // A static tile: mass Infinity.  A mobile shard: a real one off the map if
  // there is one, else a representative mass.
  const staticTile = { mass: Infinity };
  const mk = m => ({ mass: m });

  const rows = [];
  // Player crash into a static tile, at the gate and at cruise.
  const cruise = e.lastCruiseSpeed ?? null;
  for (const [label, v] of [['gate (4)', 4], ['2× gate', 8], ['cruise', cruise ?? 42.5]]) {
    rows.push({
      path: 'player → static tile', at: label, impactorMass: playerMass, speed: v,
      dv: impactStrength(e.player, staticTile, v),
      ke: 0.5 * playerMass * v * v, p: playerMass * v,
    });
  }
  // Asteroid crash into a static tile, at the momentum gate for three masses.
  for (const m of [40, 100, 400]) {
    const v = 200 / m;                    // SHARD_CRASH_MOMENTUM = 200
    rows.push({
      path: 'shard → static tile', at: `momentum gate, m=${m}`, impactorMass: m, speed: v,
      dv: impactStrength(mk(m), staticTile, v),
      ke: 0.5 * m * v * v, p: m * v,
    });
  }
  // Tile pressure: five sub-threshold nudges from a min-mass shard.
  {
    const m = 40, v = 200 / m * 0.5;      // half the gate, ×5 hits
    rows.push({
      path: 'tile pressure (×5)', at: `m=${m}, half gate`, impactorMass: m, speed: v,
      dv: impactStrength(mk(m), staticTile, v),
      ke: 5 * 0.5 * m * v * v, p: 5 * m * v,
    });
  }
  // What masses and speeds the momentum gate is actually MET at: the live
  // mobile-shard population, so the gate's energy range is the range the
  // game presents rather than three chosen numbers.
  const live = [];
  for (const x of e.currentMap.entities) {
    if (x.active && x.type === 'STRUCTURE' && x.mass !== Infinity && x.mass > 0 && x.mass !== undefined) {
      live.push({ mass: x.mass, speed: Math.hypot(x.velocity.x, x.velocity.y) });
    }
  }
  return { playerMass, cruise, rows, live };
});

// ── 5. How many crashes a tile takes — virgin vs already shot ──────────────
// The crash paths decrement `health` DIRECTLY, while a weapon hit converts
// the body onto the DERIVED boundary budget.  So the same crash is worth a
// wildly different fraction of a tile depending on whether that tile has ever
// been shot.  Driven through the REAL player-crash branch of
// `PhysicsSystem.resolveCollision`.
const crashCounts = [];
for (const m of MATERIALS) {
  if (m.map === 'ROCK_FIELD') { /* rock tiles exist only here */ }
  await page.evaluate(mapType => {
    const e = window.__omniEngine;
    e.restartGame(); e.setMapType(mapType); e.startGame();
  }, m.map);
  await page.waitForFunction(v => {
    const e = window.__omniEngine;
    return !!e.currentMap && e.currentMap.entities.some(x => x.active && x.shardVariant === v);
  }, m.tile, { timeout: 60_000 });

  const r = await page.evaluate(({ tileV, speed }) => {
    const e = window.__omniEngine;
    const P = e.physics;
    // Pick by AUTHORED HP, not "the first tile".  Metal's authored HP is
    // `24 × densityTier` over six tiers while its DERIVED HP is flat, so a
    // first-match pick reports whichever tier happened to be nearest the
    // start of the entity list — which is how the same audit read metal at
    // 120 crashes once and 96 another time with nothing having changed.
    const pick = (authored) => e.currentMap.entities.find(
      x => x.active && x.shardVariant === tileV && x.mass === Infinity && (x.health ?? 0) > 0
        && !x.fractureEdgeFill && (authored === undefined || x.maxHealth === authored));
    const authoredTiers = [...new Set(e.currentMap.entities
      .filter(x => x.active && x.shardVariant === tileV && x.mass === Infinity && (x.health ?? 0) > 0)
      .map(x => x.maxHealth))].sort((a, b) => a - b);
    const crashTo = (t, preShoot) => {
      const p = e.player;
      p.position.x = t.position.x - t.size.x; p.position.y = t.position.y;
      if (preShoot) {
        // One ordinary Blaster bolt: enough to build the boundary model.
        P.resolveCollision({
          id: 'audit_bolt', type: 'PROJECTILE',
          position: { x: t.position.x - t.size.x * 0.5 - 2, y: t.position.y },
          velocity: { x: 16, y: 0 }, rotation: 0, size: { x: 6, y: 6 }, mass: 1,
          active: true, color: '#fff', damage: 4, ownerType: 'PLAYER',
          ownerId: 'player', hitEntityIds: [], pierceCount: 0, pierceHits: 0,
        }, t, { x: -1, y: 0 }, undefined, e.handleEntityDeath);
      }
      const hp0 = t.health, max0 = t.maxHealth;
      let n = 0;
      while (t.active && n < 2000) {
        p.velocity.x = speed; p.velocity.y = 0;
        P.resolveCollision(p, t, { x: 1, y: 0 }, undefined, e.handleEntityDeath);
        n++;
      }
      p.velocity.x = 0; p.velocity.y = 0;
      return { crashes: n, hpBefore: hp0, maxBefore: max0 };
    };
    // The LOWEST authored tier is the deterministic reference row, so the
    // virgin-vs-once-shot claim (step 2) is pinned against a stable number.
    const a = pick(authoredTiers[0]); const virgin = a ? crashTo(a, false) : null;
    const b = pick(authoredTiers[0]); const shot   = b ? crashTo(b, true)  : null;
    // Every tier, so the spread the AUTHORED-HP conversion introduces is
    // visible rather than sampled.  A crash spends one authored HP, so a
    // material whose authored HP is tiered has a ram count that is tiered
    // too — while its derived HP, which is what the grain model calls
    // toughness, does not move at all.
    const tiers = [];
    for (const au of authoredTiers) {
      const t = pick(au);
      if (t) tiers.push({ authored: au, ...crashTo(t, false) });
    }
    return { virgin, shot, tiers };
  }, { tileV: m.tile, speed: 6 });
  crashCounts.push({ mat: m.mat, ...r });
}

await browser.close();

// ── Report ────────────────────────────────────────────────────────────────
const f = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? '—' : Number(x).toFixed(d));
const summarise = xs => {
  if (xs.length === 0) return null;
  const v = xs.slice().sort((a, b) => a - b);
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
  return { n: v.length, min: v[0], max: v[v.length - 1], mean, sd, cv: mean ? sd / mean : 0 };
};

console.log('\n=== 1. DERIVED HP PER MATERIAL (Σ boundary length × bondStrength) ===\n');
console.log('material  body   n   size    authored   derived: min    max    mean     sd    CV      band   edges');
for (const m of materials) {
  for (const [kind, rows] of [['tile', m.tiles], ['shard', m.shards]]) {
    const s = summarise(rows.map(r => r.derived));
    if (s === null) { console.log(`${m.mat.padEnd(9)} ${kind.padEnd(6)} (none sampled)`); continue; }
    const sz = summarise(rows.map(r => r.size));
    const au = summarise(rows.map(r => r.authored));
    const ed = summarise(rows.map(r => r.edges));
    console.log(
      `${m.mat.padEnd(9)} ${kind.padEnd(6)} ${String(s.n).padStart(2)}  ${f(sz.mean, 1).padStart(5)}  `
      + `${f(au.mean, 1).padStart(8)}   ${f(s.min, 1).padStart(6)} ${f(s.max, 1).padStart(6)} `
      + `${f(s.mean, 1).padStart(6)} ${f(s.sd, 2).padStart(6)}  ${f(s.cv * 100, 1).padStart(4)}%  `
      + `±${f((s.max - s.min) / 2 / s.mean * 100, 1)}%  ${f(ed.mean, 1).padStart(5)}`);
  }
}
console.log('\nbondStrength / grainSize per material (the DBG-resolved spec):');
for (const m of materials) {
  const g = m.grain || {};
  console.log(`  ${m.mat.padEnd(8)} bondStrength ${f(g.bondStrength)}  grainSize ${f(g.grainSize, 1)}  `
    + `count ${g.grainCountMin}..${g.grainCountMax}  regularity ${f(g.regularity)}  `
    + `damageSpread ${g.damageSpread === undefined ? '0 (absent)' : f(g.damageSpread)}`);
}

console.log('\n=== 2. WEAPONS: authored damage vs the shot it actually flies ===\n');
console.log('weapon           dmg  count  pierce   mass   speed      KE=½mv²    p=mv    KE/dmg   p/dmg');
for (const w of weapons) {
  const ke = w.mass !== null ? 0.5 * w.mass * w.speed * w.speed : null;
  const p = w.mass !== null ? w.mass * w.speed : null;
  console.log(
    `${w.name.padEnd(16)} ${f(w.damage, 1).padStart(4)} ${String(w.count).padStart(5)} `
    + `${String(w.pierce).padStart(7)}  ${f(w.mass, 1).padStart(5)}  ${f(w.speed, 2).padStart(6)}   `
    + `${f(ke, 1).padStart(9)} ${f(p, 1).padStart(7)}  ${f(ke / w.damage, 1).padStart(7)} ${f(p / w.damage, 2).padStart(7)}`);
}

console.log('\n=== 3. CRASH PATHS: the real velocity step at the real gates ===\n');
console.log(`player mass ${f(crashes.playerMass, 1)} (lean outfit), cruise ${f(crashes.cruise, 1)} u/step\n`);
console.log('path                    at                       m       v      dv=Δv_n       KE       p');
for (const r of crashes.rows) {
  console.log(
    `${r.path.padEnd(23)} ${r.at.padEnd(22)} ${f(r.impactorMass, 0).padStart(5)} ${f(r.speed, 2).padStart(7)} `
    + `${f(r.dv, 2).padStart(9)} ${f(r.ke, 0).padStart(9)} ${f(r.p, 0).padStart(7)}`);
}

console.log('\n=== 3b. THE LIVE MOBILE-SHARD POPULATION (who actually meets the gate) ===\n');
{
  const ms = summarise(crashes.live.map(x => x.mass));
  const sp = summarise(crashes.live.map(x => x.speed));
  if (ms) {
    console.log(`  n=${ms.n}  mass ${f(ms.min,1)}..${f(ms.max,1)} (mean ${f(ms.mean,1)})  `
      + `speed ${f(sp.min,2)}..${f(sp.max,2)} (mean ${f(sp.mean,2)}) u/step`);
    const need = crashes.live.map(x => 200 / x.mass);      // speed needed at the gate
    const ke   = crashes.live.map(x => 0.5 * x.mass * (200 / x.mass) ** 2);
    const ns = summarise(need), ks = summarise(ke);
    console.log(`  speed needed to meet the 200 momentum gate: ${f(ns.min,2)}..${f(ns.max,2)} u/step`);
    console.log(`  ENERGY carried at that gate:                ${f(ks.min,1)}..${f(ks.max,1)}  `
      + `— a ${f(ks.max / Math.max(1e-9, ks.min), 0)}× spread at ONE momentum gate`);
  }
}

console.log('\n=== 4. THE IMPLIED CONVERSION ===\n');
const byMat = Object.fromEntries(materials.map(m => [m.mat, summarise(m.tiles.map(r => r.derived))]));
console.log('Energy that must be paid per derived HP, if a weapon\'s KE were the currency:');
console.log('material   derived HP (tile)   Blaster KE/dmg   hits to break   player-crash KE at gate   KE per HP');
const blaster = weapons.find(w => w.type === 'BLASTER');
const bKe = 0.5 * blaster.mass * blaster.speed * blaster.speed;
const crashGate = crashes.rows.find(r => r.at === 'gate (4)');
for (const m of materials) {
  const s = byMat[m.mat];
  if (!s) continue;
  console.log(
    `${m.mat.padEnd(10)} ${f(s.mean, 1).padStart(16)}   ${f(bKe / blaster.damage, 1).padStart(14)}   `
    + `${f(s.mean / blaster.damage, 1).padStart(13)}   ${f(crashGate.ke, 0).padStart(23)}   ${f(crashGate.ke / s.mean, 1).padStart(9)}`);
}

console.log('\nWhat each crash gate BUYS, converted at each weapon\'s own rate:');
console.log('                                               KE currency                    momentum currency');
console.log('gate                                          KE  ×Blaster  ×Cannon        p  ×Blaster  ×Cannon');
{
  const cannon = weapons.find(w => w.type === 'CANNON');
  const cKe = 0.5 * cannon.mass * cannon.speed * cannon.speed;
  const bP = blaster.mass * blaster.speed, cP = cannon.mass * cannon.speed;
  for (const r of crashes.rows) {
    console.log(
      `${(r.path + ' @ ' + r.at).padEnd(42)} ${f(r.ke,0).padStart(6)}  ${f(r.ke/(bKe/blaster.damage),1).padStart(8)} `
      + `${f(r.ke/(cKe/cannon.damage),1).padStart(8)}   ${f(r.p,0).padStart(6)}  `
      + `${f(r.p/(bP/blaster.damage),1).padStart(8)} ${f(r.p/(cP/cannon.damage),1).padStart(8)}`);
  }
  console.log('\n(“×Blaster” = the damage this crash would deal if the Blaster\'s own KE-per-damage');
  console.log(' (or momentum-per-damage) were the conversion constant; “×Cannon” likewise.)');
  const kes = weapons.map(w => 0.5 * w.mass * w.speed * w.speed / w.damage);
  const ps  = weapons.map(w => w.mass * w.speed / w.damage);
  console.log(`\nROSTER SPREAD of the implied constant:  KE/damage ${f(Math.min(...kes),1)}..${f(Math.max(...kes),1)} `
    + `(${f(Math.max(...kes)/Math.min(...kes),1)}×);  p/damage ${f(Math.min(...ps),2)}..${f(Math.max(...ps),2)} `
    + `(${f(Math.max(...ps)/Math.min(...ps),1)}×)`);
}

console.log('\n=== 5. CRASHES TO BREAK A TILE — VIRGIN vs ALREADY SHOT ===\n');
console.log('(player crash at 6 u/step, 1.5× the CRASH_VELOCITY_THRESHOLD gate)\n');
console.log('material   virgin: hp/max  crashes      after one Blaster bolt: hp/max  crashes');
for (const c of crashCounts) {
  if (!c.virgin || !c.shot) { console.log(`${c.mat.padEnd(10)} (not sampled)`); continue; }
  console.log(
    `${c.mat.padEnd(10)} ${(f(c.virgin.hpBefore,1)+'/'+f(c.virgin.maxBefore,1)).padStart(14)} `
    + `${String(c.virgin.crashes).padStart(8)}      `
    + `${(f(c.shot.hpBefore,1)+'/'+f(c.shot.maxBefore,1)).padStart(14)} ${String(c.shot.crashes).padStart(8)}`);
}

console.log('\n=== 5b. THE SAME TILE, EVERY AUTHORED TIER (what the conversion costs) ===\n');
console.log('A crash spends ONE AUTHORED HP expressed in the derived budget, so a');
console.log('material whose authored HP is tiered has a tiered ram count — while its');
console.log('DERIVED HP, which is what the grain model calls toughness, does not move.\n');
console.log('material   authored   crashes   derived HP   KE per derived HP');
{
  const CRASH_V = 6, PM = crashes.playerMass;
  const crashKe = 0.5 * PM * CRASH_V * CRASH_V;
  for (const c of crashCounts) {
    const s = byMat[c.mat];
    for (const t of (c.tiers || [])) {
      console.log(
        `${c.mat.padEnd(10)} ${f(t.authored, 0).padStart(8)} ${String(t.crashes).padStart(9)}   `
        + `${f(s ? s.mean : null, 1).padStart(10)}   ${f(s ? t.crashes * crashKe / s.mean : null, 0).padStart(17)}`);
    }
  }
}

console.log('\n=== 6. HOW FAR APART THE TWO SIDES ARE ===\n');
{
  const CRASH_V = 6, PM = crashes.playerMass;
  const crashKe = 0.5 * PM * CRASH_V * CRASH_V;
  console.log(`One player crash at ${CRASH_V} u/step carries KE ${f(crashKe, 0)}.\n`);
  console.log('               derived HP    crashes  KE spent   KE per derived HP');
  for (const c of crashCounts) {
    const s = byMat[c.mat];
    if (!s || !c.virgin || !c.shot) continue;
    for (const [label, r] of [['virgin', c.virgin], ['once shot', c.shot]]) {
      console.log(
        `${(c.mat + ' ' + label).padEnd(20)} ${f(s.mean, 1).padStart(6)} ${String(r.crashes).padStart(10)} `
        + `${f(r.crashes * crashKe, 0).padStart(9)}   ${f(r.crashes * crashKe / s.mean, 0).padStart(9)}`);
    }
  }
  const kes = weapons.map(w => 0.5 * w.mass * w.speed * w.speed / w.damage);
  const virginK = crashCounts.filter(c => c.virgin && byMat[c.mat])
    .map(c => c.virgin.crashes * crashKe / byMat[c.mat].mean);
  console.log(`\n  WEAPON side, KE per point of damage (= per derived HP, damage is spent 1:1`);
  console.log(`               on boundaries):        ${f(Math.min(...kes),1)} .. ${f(Math.max(...kes),1)}  (${f(Math.max(...kes)/Math.min(...kes),1)}× spread)`);
  console.log(`  CRASH side, virgin tile, KE per derived HP:  ${f(Math.min(...virginK),0)} .. ${f(Math.max(...virginK),0)}  (${f(Math.max(...virginK)/Math.min(...virginK),1)}× spread)`);
  console.log(`  CRASH side, once shot:  a crash spends exactly 1 HP whatever it brings,`);
  console.log(`               so the constant is ${f(crashKe,0)} KE per HP for EVERY material.`);
}
console.log('');
