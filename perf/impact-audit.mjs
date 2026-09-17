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
      damage: cfg.damage, count: cfg.count, cooldown: cfg.cooldown,
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
          ownerId: 'player', hitEntityIds: [], pierceHits: 0,
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


// ── 7. THE MASS SCALE: gather ──────────────────────────────────────────────
//  Read as the TABLES the sim reads (via the __omniMass seam) rather than as
//  numbers recomputed here, so this cannot drift from what actually flies.
const scale = await page.evaluate(() => {
  const e = window.__omniEngine;
  const C = window.__omniMass;               // the constants seam
  const rows = [];
  const push = (cls, name, size, mass) =>
    rows.push({ cls, name, size, mass, dens: mass / (size * size) });

  push('player', 'player (lean)', e.player.size.x, e.player.mass);

  for (const [k, v] of Object.entries(C.ENEMY_VARIANTS))
    // ENEMY_VARIANTS states the AUTHORED mass; what actually flies is that
    // number through `scaledMass` (the MASS_SCALE seam), so this must scale
    // it too or the column reports a world nobody plays — measured, it
    // under-read every enemy by the full factor while the classes beside
    // it, which derive or route through the seam already, read right.
    push('enemy', k.toLowerCase(), v.size, C.scaledMass(v.mass));

  for (const w of C.WEAPON_LIST) {
    const cfg = C.WEAPONS[w];
    push('projectile', String(w).toLowerCase(),
         cfg.size ?? 6, C.projectileMassFor(cfg));
  }

  for (const v of ['rock-shard', 'glass-shard', 'plastic-shard', 'metal-shard']) {
    const sp = C.SHARD_VARIANTS[v].spawn;
    for (const d of [12, 36, 160]) push('shard', `${v} d=${d}`, d, sp.sizeToMass(d));
  }
  return { rows, massScale: C.MASS_SCALE };
});

// ── 8. PENETRATION AND THE BLAST (gathered before the browser closes) ───────
//  What a shot gets THROUGH, and what its charge is worth when it goes off.
//  Both are EMERGENT under the energy model — there is no authored pierce
//  count, and since the blast became energy-derived there is no authored
//  splash either — so the only honest way to report them is to fire real
//  shots through the real collision resolver and count.
const pen = await page.evaluate(() => {
  const e = window.__omniEngine;
  e.restartGame(); e.setMapType('POCKET'); e.startGame();
  const p = e.player;
  const ctx = e.waveContext();
  const TYPES = ['BLASTER', 'BURST', 'SHOTGUN', 'BOUNCER', 'LIGHTNING', 'HOMING', 'CANNON'];

  /** Fire ONE real shot from a stationary player and hand back the live
   *  projectile — mass and muzzle speed are the numbers the sim flies. */
  const shotOf = (type, mult) => {
    p.velocity.x = 0; p.velocity.y = 0;
    p.currentWeapon = type;
    p.weaponCooldown = 0;
    p.damageMult = mult;
    const before = new Set(e.currentMap.entities.map(x => x.id));
    e.weapons.firePlayerWeapon(e.currentMap.entities, p,
      { x: p.position.x + 500, y: p.position.y });
    const shot = e.currentMap.entities.find(x => !before.has(x.id) && x.type === 'PROJECTILE');
    for (const x of e.currentMap.entities) if (!before.has(x.id) && x !== shot) x.active = false;
    p.damageMult = 1;
    return shot;
  };

  /** Walk a live bolt through fresh bodies via the REAL resolver — the same
   *  call the broadphase makes — until it can no longer kill one.  That is
   *  what penetration IS now: a bank spending itself one contact at a time. */
  const punchThrough = (shot, makeBody, limit) => {
    if (!shot) return 0;
    let n = 0;
    for (let i = 0; i < limit; i++) {
      if (!shot.active || Math.hypot(shot.velocity.x, shot.velocity.y) < 1e-6) break;
      const body = makeBody(i);
      shot.hitEntityIds = [];
      e.physics.resolveCollision(shot, body, { x: 0, y: 0 }, undefined, e.handleEntityDeath);
      const dead = !body.active || body.health <= 0;
      body.active = false;
      if (!dead) break;
      n++;
    }
    shot.active = false;
    return n;
  };

  const gnat = () => {
    const f = e.waves.spawnAt('SWARM',
      { x: p.position.x + 400, y: p.position.y }, ctx, false);
    f.maxSpeed = 0; f.velocity.x = 0; f.velocity.y = 0;
    f.health = f.maxHealth = 1; f.shield = 0; f.maxShield = 0;
    return f;
  };

  const out = { rows: [], blast: null };
  // statMks('gunnery', … mk => ({ damageFrac: 0.12 * mk })) — Mk III is 0.36.
  out.mk3Frac = 0.36;
  const g3 = 1 + 3 * out.mk3Frac;
  out.g3 = g3;

  // ACTOR penetration, at base and at three Gunnery Mk III.
  for (const mult of [1, g3]) {
    for (const t of TYPES) {
      const shot = shotOf(t, mult);
      out.rows.push({
        type: t, mult,
        mass: shot ? shot.mass : null,
        gnats: punchThrough(shot, gnat, 400),
      });
    }
  }

  // THE BLAST, ISOLATED — and its THREE TRIGGERS.
  //
  // A DIRECT hit at a known point rather than the fuse: the fuse detonates
  // ~450 units downrange after a flight the shot's own spread randomises.
  // The direct-hit target is excluded from its own ring, so what the
  // BYSTANDER loses is purely the shockwave — and the sweep is over in
  // ~0.35 s, so the run is too short for the two bodies to drift together.
  {
    const OFF = 55;
    const mk = (dx, dy) => {
      const f = e.waves.spawnAt('RAMMER_1',
        { x: p.position.x + dx, y: p.position.y + dy }, ctx, false);
      f.maxSpeed = 0; f.velocity.x = 0; f.velocity.y = 0;
      f.health = f.maxHealth = 1e6; f.shield = 0; f.maxShield = 0;
      return f;
    };
    const mkAt = (x, y) => {
      const f = e.waves.spawnAt('RAMMER_1', { x, y }, ctx, false);
      f.maxSpeed = 0; f.velocity.x = 0; f.velocity.y = 0;
      f.health = f.maxHealth = 1e6; f.shield = 0; f.maxShield = 0;
      return f;
    };
    const sweep = (n) => {
      for (let i = 0; i < n; i++) {
        e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120);
      }
    };

    // (1) ACTOR CONTACT.
    const direct = mk(400, 0);
    const bystander = mk(400, OFF);
    const shot = shotOf('CANNON', 1);
    const cfg = e.weapons.getConfig('CANNON');
    const shotMass = shot ? shot.mass : null;
    const shotBlast = shot ? shot.explosionDamage : null;
    if (shot) {
      shot.position.x = direct.position.x;
      shot.position.y = direct.position.y;
      shot.hitEntityIds = [];
      e.physics.resolveCollision(shot, direct, { x: 0, y: 0 }, undefined,
        e.handleEntityDeath, undefined, e.handleProjectileHit);
      shot.active = false;
      sweep(50);
    }
    const onActor = 1e6 - bystander.health;
    direct.active = false; bystander.active = false;

    // (2) ENERGY DEPLETION, THROUGH THE REAL LOOP.  Terrain by design does
    //     not trip the charge on contact, so before the stop rule a witness
    //     beside the tile lost NOTHING.  Driven by the ordinary substep
    //     rather than a direct `resolveCollision` call, because the hand-off
    //     from the stop to the fuse pass is an ORDERING property of that
    //     step — and the first attempt at this feature failed on exactly
    //     that (a deactivated projectile is pooled, and pooling strips the
    //     charge, mid-step, before the fuse pass can read it).
    let onSpent = null, spentWhere = null;
    {
      const tile = e.currentMap.entities.find(x => x.active
        && x.mass === Infinity && x.type === 'STRUCTURE'
        && x.shardVariant && x.shardVariant !== 'nebula-tile');
      if (tile) {
        const witness = mkAt(tile.position.x, tile.position.y + OFF);
        const sh = shotOf('CANNON', 1);
        if (sh) {
          // Park it beside the tile with a bank far below one grain, so the
          // contact the real step finds is a STOP rather than a bore — which
          // is what "ran out of mechanical travel energy" means.
          sh.position.x = tile.position.x - 30;
          sh.position.y = tile.position.y;
          sh.velocity.x = 2; sh.velocity.y = 0;
          sh.mass = 0.02;
          sh.hitEntityIds = [];
          for (let i = 0; i < 120; i++) {
            e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120);
          }
          spentWhere = { detonated: sh.detonated === true };
        }
        onSpent = 1e6 - witness.health;
        witness.active = false;
      }
    }

    out.blast = {
      authoredInConfig: cfg.explosionDamage === undefined ? null : cfg.explosionDamage,
      shotBlast, shotMass, offset: OFF,
      radius: cfg.explosionRadius ?? null,
      muzzleSpeed: cfg.speed,
      sentinelLost: onActor,
      onSpent, spentWhere,
    };
  }
  return out;
});


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
// `bites` is the BANK in bites of the authored damage — energy / damage.
// Step 5 deleted `pierce`; this is the same number, measured off the shot the
// sim actually flies rather than read off a field.
console.log('weapon           dmg  count   bites   mass   speed      KE=½mv²    p=mv    KE/dmg   p/dmg');
for (const w of weapons) {
  const ke = w.mass !== null ? 0.5 * w.mass * w.speed * w.speed : null;
  const p = w.mass !== null ? w.mass * w.speed : null;
  console.log(
    `${w.name.padEnd(16)} ${f(w.damage, 1).padStart(4)} ${String(w.count).padStart(5)} `
    + `${f(ke !== null ? ke / 32 / w.damage : null, 2).padStart(7)}  ${f(w.mass, 1).padStart(5)}  ${f(w.speed, 2).padStart(6)}   `
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
console.log('Step 4 made a crash spend ENERGY, so the authored HP is no longer read at');
console.log('all and this column should be FLAT per material.  It was not: a crash used');
console.log('to spend one authored HP, and metal authors 24 x densityTier against a flat');
console.log('derived HP, so six tiles of identical toughness took 24..144 rams.\n');
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

// ── 7. THE MASS SCALE ───────────────────────────────────────────────────────
//  Every class of body that can collide, reported as size, mass and the
//  IMPLIED AREAL DENSITY (mass / size²).  Under the energy model mass is no
//  longer just an impulse term — it is half of what every impact SPENDS — so
//  whether these classes are on one scale is now a balance question rather
//  than a physics-solver detail.  Density is the honest comparison: a ship
//  and a boulder differ in size by design, and only density says whether one
//  of them is made of a fundamentally different substance.
console.log('\n=== 7. THE MASS SCALE (mass / size², the implied areal density) ===\n');
console.log(`  every mass carries MASS_SCALE = ${scale.massScale}x; sizes are unscaled.\n`);
{
  // (gathered above, before the browser closed)

  const byCls = {};
  for (const r of scale.rows) (byCls[r.cls] ||= []).push(r);
  console.log('class        body                        size     mass    mass/size²');
  for (const cls of ['player', 'enemy', 'projectile', 'shard']) {
    for (const r of byCls[cls] ?? [])
      console.log(`${cls.padEnd(12)} ${r.name.padEnd(26)} ${f(r.size,1).padStart(5)} `
        + `${f(r.mass,2).padStart(8)}   ${f(r.dens,4).padStart(9)}`);
  }
  const dens = c => (byCls[c] ?? []).map(r => r.dens);
  const rng = c => { const d = dens(c); return `${f(Math.min(...d),4)} .. ${f(Math.max(...d),4)}`; };
  console.log('\n  density range per class:');
  for (const c of ['player', 'enemy', 'projectile', 'shard'])
    console.log(`    ${c.padEnd(12)} ${rng(c)}`);
  const all = scale.rows.map(r => r.dens);
  console.log(`\n  ACROSS ALL CLASSES: ${f(Math.min(...all),4)} .. ${f(Math.max(...all),4)}`
    + `  (${f(Math.max(...all)/Math.min(...all),1)}× spread)`);
}
console.log('');

// ── 8. PENETRATION AND THE BLAST ───────────────────────────────────────────
console.log('\n=== 8. PENETRATION AND THE BLAST (fired, not derived) ===\n');
{
  console.log(`  Gunnery Mk III damageFrac ${f(pen.mk3Frac, 3)} -> three of them = x${f(pen.g3, 3)}`);
  console.log('  A bolt is charged only what a body could ABSORB, so 1-HP gnats measure the');
  console.log('  BANK directly: each costs one damage however big the bite is.  The base');
  console.log('  round is sized so three Gunnery Mk III put it back where it was.\n');
  console.log('weapon          base   3x Mk III    ratio     base mass');
  const mults = [...new Set(pen.rows.map(r => r.mult))];
  const at = (t, m) => pen.rows.find(x => x.type === t && x.mult === m);
  for (const t of [...new Set(pen.rows.map(r => r.type))]) {
    const a = at(t, mults[0]), b = at(t, mults[1]);
    console.log(`${t.padEnd(14)} ${String(a ? a.gnats : '-').padStart(5)} ${String(b ? b.gnats : '-').padStart(11)} `
      + `${f(a && b && a.gnats ? b.gnats / a.gnats : null, 2).padStart(8)} ${f(a ? a.mass : null, 2).padStart(13)}`);
  }
  const b = pen.blast;
  if (b) {
    console.log('\n  THE BLAST — direct hit; what a BYSTANDER in the radius loses:');
    console.log(`    shell mass ${f(b.shotMass, 2)}   muzzle ${f(b.muzzleSpeed, 1)} u/step   radius ${f(b.radius, 0)}`);
    console.log(`    explosionDamage authored in the config   ${b.authoredInConfig === null ? 'none — DERIVED' : f(b.authoredInConfig, 2)}`);
    console.log(`    explosionDamage the shell actually flew  ${f(b.shotBlast, 2)}`);
    console.log('    THREE TRIGGERS — what a BYSTANDER ${OFF} off the blast loses:'.replace('${OFF}', f(b.offset,0)));
    console.log(`      on an ACTOR contact                   ${f(b.sentinelLost, 2)}`);
    console.log(`      on ENERGY DEPLETION against terrain   ${f(b.onSpent, 2)}`);
    console.log(`      (the FUSE covers a shell that meets nothing at all)`);
    console.log(`    ENERGY-DEPLETION trigger: a witness beside the tile lost ${f(b.onSpent, 2)}`);
  }
}
console.log('');
