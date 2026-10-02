/** ENERGY MODULES — delivery × energy × material.
 *
 *  Weapons are a DELIVERY module (projectile / beam / spread / homing /
 *  cannon) plus an optional ENERGY MODIFIER (kinetic / electric / thermal),
 *  and what they deliver is answered by the MATERIAL it lands in — through
 *  its PROPERTIES, never its name.  Two halves, two kinds of test:
 *
 *   - PURE (`window.__omniEnergy`): the tables, the heat arithmetic, the
 *     bounded chain planner, the fracture profiles.  Each of these can be
 *     wrong with no symptom on screen, which is why they are pinned here.
 *   - ENGINE: the real weapons fired through the real WeaponSystem into the
 *     real world, reading what changed.
 *
 *  Constants the claims are ABOUT are written out, not imported (harness
 *  rule: a test that imports the constant it checks pins nothing).
 */
import { test, expect } from '@playwright/test';
import { advanceSim, boot, engine, quietScene, startRun, waitForStats } from './helpers';

const DELIVERIES = ['projectile', 'beam', 'spread', 'homing', 'cannon'];
const ENERGIES = ['kinetic', 'electric', 'thermal'];
/** The retired Blaster: a 4 bite every 0.14 s. */
const OLD_BASE_DPS = 4 / 0.14;

async function onMap(page: any, map: string) {
  await startRun(page, map);
  await waitForStats(page,
    new Function('s', `return s.currentMapType === ${JSON.stringify(map)}`) as any, map);
  await quietScene(page);
}

test.describe('the weapon module table', () => {
  test('all 20 weapons exist, and every bare delivery is weaker than the old base', async ({ page }) => {
    const watch = await boot(page);
    const r = await page.evaluate(([ds, es]) => {
      const E = (window as any).__omniEnergy;
      const out: any = { missing: [], bare: {}, keys: Object.keys(E.WEAPONS).length,
                         cannonBlast: E.WEAPONS.cannon.explosionRadius ?? 0 };
      for (const d of ds) {
        out.bare[d] = E.nominalDps(E.WEAPONS[d]);
        for (const e of es) {
          const c = E.WEAPONS[`${d}+${e}`];
          if (!c || c.delivery !== d || c.energy !== e) out.missing.push(`${d}+${e}`);
        }
      }
      return out;
    }, [DELIVERIES, ENERGIES]);
    expect(r.missing).toEqual([]);
    expect(r.keys).toBe(20);
    for (const d of DELIVERIES) {
      // ~60% of the old base, and clearly below it.
      expect(r.bare[d], d).toBeLessThan(OLD_BASE_DPS * 0.7);
      // The CANNON's direct bite sits lower: its blast carries the rest.
      if (d !== 'cannon') expect(r.bare[d], d).toBeGreaterThan(OLD_BASE_DPS * 0.5);
    }
    expect(r.cannonBlast).toBeGreaterThan(0);
    watch.assertClean();
  });

  test('a modifier changes WHAT a delivery emits, not just how much', async ({ page }) => {
    await boot(page);
    const sigs = await page.evaluate(([ds, es]) => {
      const E = (window as any).__omniEnergy;
      // The payload SHAPE: which energy channels a weapon carries.
      const shape = (c: any) => [
        c.heat || c.blastHeat ? 'heat' : '', c.electric ? 'electric' : '',
        c.explosionRadius ? 'blast' : '', c.damage > 0 ? 'bite' : '',
      ].filter(Boolean).join('|');
      const out: Record<string, string[]> = {};
      for (const d of ds) out[d] = es.map((e: string) => shape(E.WEAPONS[`${d}+${e}`]));
      return out;
    }, [DELIVERIES, ENERGIES]);
    for (const d of DELIVERIES) {
      // Three modifiers → three distinct payload shapes on every delivery.
      expect(new Set(sigs[d]).size, `${d}: ${sigs[d].join(', ')}`).toBe(3);
    }
  });

  test('old weapon ids map onto their combination, and garbage fails safe', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const E = (window as any).__omniEnergy;
      return {
        map: ['BLASTER', 'BURST', 'SHOTGUN', 'BOUNCER', 'LIGHTNING', 'HOMING', 'CANNON', 'wpn_cannon',
              'projectile+explosive', 'radial', 'radial+thermal', 'beam+magnetic']
          .map(id => [id, E.resolveWeaponKey(id)]),
        cannonFuse: E.weaponConfig('CANNON').fuseSeconds,
        cannonDamage: E.weaponConfig('CANNON').damage,
        garbage: E.weaponConfig('no-such-gun').delivery,
        badKey: E.parseWeaponKey('beam+plasma'),
      };
    });
    expect(Object.fromEntries(r.map)).toEqual({
      BLASTER: 'projectile', BURST: 'projectile+kinetic', SHOTGUN: 'spread+kinetic',
      BOUNCER: 'beam+thermal', LIGHTNING: 'projectile+electric', HOMING: 'homing+kinetic',
      CANNON: 'cannon', wpn_cannon: 'cannon',
      // Removed keys: the old shell is the cannon; the Pulse became the cannon;
      // a removed energy falls back to its bare delivery.
      'projectile+explosive': 'cannon', radial: 'cannon', 'radial+thermal': 'cannon+thermal',
      'beam+magnetic': 'beam',
    });
    // The bare Cannon is a time-fused penetrator: the old fuse, a tiny bite.
    expect(r.cannonFuse).toBe(0.42);
    expect(r.cannonDamage).toBe(3);
    expect(r.garbage).toBe('projectile');
    expect(r.badKey).toBeNull();
  });
});

test.describe('energy arithmetic (pure)', () => {
  test('heat accumulates, cools to exactly zero, and never runs away', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const E = (window as any).__omniEnergy;
      let h = E.clampHeat(E.heatGain('metal', 30));
      const first = h;
      let steps = 0;
      while (h > 0 && steps < 100000) { h = E.coolHeat('metal', h, 1 / 120); steps++; }
      return {
        first, cooledTo: h, steps,
        huge: E.clampHeat(1e9), hugeMetal: E.clampHeat(1e9, E.maxHeatOf('metal')),
        nan: E.clampHeat(NaN), neg: E.heatGain('glass', -5),
        nanGain: E.heatGain('rock', NaN), unknown: E.responseOf('unobtanium').conductivity,
        coldScale: E.mechanicalScale('metal', 0), hotMetal: E.mechanicalScale('metal', 1),
        hotRock: E.mechanicalScale('rock', 1), hotHuge: E.mechanicalScale('metal', 1e9),
      };
    });
    expect(r.first).toBeGreaterThan(0);
    expect(r.cooledTo).toBe(0);                  // cold bodies leave the active set
    expect(r.steps).toBeLessThan(120 * 60);      // within a minute of sim time
    expect(r.huge).toBeLessThanOrEqual(5);
    expect(r.hugeMetal).toBeLessThan(1.5);       // metal's own ceiling (specific heat 0.45)
    expect(r.nan).toBe(0);
    expect(r.neg).toBe(0);
    expect(r.nanGain).toBe(0);
    expect(r.unknown).toBeGreaterThan(0);        // unknown material → the generic default
    expect(r.coldScale).toBe(1);
    expect(r.hotMetal).toBeGreaterThan(r.hotRock);
    expect(r.hotRock).toBeGreaterThan(1);
    expect(r.hotHuge).toBeLessThanOrEqual(4);
  });

  test('MATERIAL PROPERTIES drive heat: specific heat sets capacity and ceiling, conductivity sets spread and transfer', async ({ page }) => {
    // User calls, pinned as ORDERINGS that follow the real materials, not as
    // the table's own numbers (a test that restates its constants pins
    // nothing):  specific heat — plastic > glass > rock > metal; thermal
    // conductivity — metal > rock > glass > plastic; and a hull conducts
    // electricity exactly as well as metal, so an arc on a metal tile jumps
    // to the ship beside it at full strength.
    await boot(page);
    const r = await page.evaluate(() => {
      const E = (window as any).__omniEnergy;
      const mats = ['metal', 'rock', 'glass', 'plastic'];
      const o: any = {};
      for (const m of mats) {
        o[m] = { cap: E.heatCapacityOf(m), max: E.maxHeatOf(m), spread: E.thermalDiffusivityOf(m),
                 self: E.conductShare(m, m) };
      }
      o.metalRock = E.conductShare('metal', 'rock');
      o.rockRock = E.conductShare('rock', 'rock');
      o.gasSpread = E.thermalDiffusivityOf('nebula');
      o.cond = { metal: E.responseOf('metal').conductivity, generic: E.responseOf('generic').conductivity };
      // The same thermal packet heats metal more than plastic (real heat capacity).
      o.gain = { metal: E.heatGain('metal', 10), plastic: E.heatGain('plastic', 10) };
      o.nameFree = E.responseOf('nebula').gas === true && E.responseOf('metal').gas === false;
      return o;
    });
    // Specific heat → how much energy a unit of heat costs, and the ceiling.
    expect(r.plastic.cap).toBeGreaterThan(r.glass.cap);
    expect(r.glass.cap).toBeGreaterThan(r.rock.cap);
    expect(r.rock.cap).toBeGreaterThan(r.metal.cap);
    expect(r.plastic.max).toBeGreaterThan(r.rock.max);
    expect(r.rock.max).toBeGreaterThan(r.metal.max);
    expect(r.gain.metal).toBeGreaterThan(r.gain.plastic * 2);
    // Thermal conductivity → hot-spot spreading and neighbour transfer.
    expect(r.metal.spread).toBeGreaterThan(r.rock.spread);
    expect(r.rock.spread).toBeGreaterThan(r.glass.spread);
    expect(r.glass.spread).toBeGreaterThan(r.plastic.spread);
    expect(r.metal.self).toBeGreaterThan(r.metalRock);     // an insulator throttles the pair
    expect(r.metalRock).toBeGreaterThan(r.rockRock);
    expect(r.rockRock).toBeGreaterThan(0);                   // every material conducts now
    // Metal and a hull conduct electricity equally.
    expect(r.cond.generic).toBe(r.cond.metal);
    expect(r.nameFree).toBe(true);
  });

  test('ONE MATERIAL TABLE: every shard row names its material, tile and shard share its grain, and a new material needs no code', async ({ page }) => {
    // The central table (MATERIALS, energy.ts) is where a material's grain,
    // density, energy response, break shapes, heat look and voice live.  The
    // variant rows point at it; nothing parses a variant's NAME.
    await boot(page);
    const r = await page.evaluate(() => {
      const E = (window as any).__omniEnergy;
      const M = (window as any).__omniMass;
      const V = M.SHARD_VARIANTS;
      const rows = Object.keys(V).map(id => ({ id, mat: V[id].material }));
      const unnamed = rows.filter(x => !x.mat || !E.MATERIALS[x.mat]).map(x => x.id);
      const misread = rows.filter(x => E.materialOf({ shardVariant: x.id }) !== x.mat).map(x => x.id);
      // Tile and shard grain agree on everything but the scatter speed.
      const grainDiff: string[] = [];
      for (const m of ['rock', 'glass', 'plastic', 'metal']) {
        const a = { ...V[`${m}-tile`].grain }, b = { ...V[`${m}-shard`].grain };
        delete a.radialSpeed; delete b.radialSpeed;
        if (JSON.stringify(a) !== JSON.stringify(b)) grainDiff.push(m);
        for (const k of Object.keys(E.MATERIALS[m].grain)) {
          if (a[k] !== E.MATERIALS[m].grain[k]) grainDiff.push(`${m}.${k}`);
        }
      }
      const density = ['glass', 'plastic', 'rock', 'metal']
        .map(m => M.IMPACT_DENSITY[m.toUpperCase()] === E.MATERIALS[m].density);
      // A NEW material, added as data only: an insulating, fragile metal.
      E.MATERIALS.test_ceramic = { ...E.MATERIALS.metal, conductivity: 0.02, specificHeat: 0.9 };
      const body = { id: 'c1', active: true, material: 'test_ceramic', position: { x: 0, y: 0 }, size: { x: 10, y: 10 } };
      const caps = { maxHops: 3, maxTargets: 6, maxRadius: 400, hopRange: 150, branches: 2 };
      const chain = E.planChain(body, { x: 0, y: 0 }, 20, caps, () => {}, () => 0).length;
      const newMax = E.maxHeatOf('test_ceramic'), metalMax = E.maxHeatOf('metal');
      delete E.MATERIALS.test_ceramic;
      return {
        unnamed, misread, grainDiff, density, chain, newMax, metalMax,
        indestructibleSfx: E.materialDef(E.materialOf({ shardVariant: 'indestructible-tile' })).sfx,
        nebulaGas: E.materialDef('nebula').gas, nebulaFracture: E.materialDef('nebula').fracture,
      };
    });
    expect(r.unnamed, 'every row names a real material').toEqual([]);
    expect(r.misread, 'materialOf reads the row, not the name').toEqual([]);
    expect(r.grainDiff, 'a material has ONE grain geometry').toEqual([]);
    expect(r.density.every(Boolean), 'the density scale reads the table').toBe(true);
    // The new material behaves by its properties: an insulator ends the arc
    // where it lands, and its heat ceiling follows its specific heat.
    expect(r.chain).toBe(1);
    expect(r.newMax).toBeGreaterThan(r.metalMax);
    // Indestructible terrain is the hull material — and sounds like it
    // (it used to be `generic` to the energy layer and `metal` to audio).
    expect(r.indestructibleSfx).toBe('metal');
    expect(r.nebulaGas).toBe(true);
    expect(r.nebulaFracture).toBeNull();
  });

  test('an electric chain is bounded: hops, targets, radius, no repeats, loops end', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const E = (window as any).__omniEnergy;
      // A dense clique of 200 metal plates, all within one hop of each other
      // — the worst case for a naive recursive chain.
      const bodies: any[] = [];
      for (let i = 0; i < 200; i++) {
        bodies.push({ id: `m${i}`, active: true, shardVariant: 'metal-tile',
                      position: { x: (i % 20) * 12, y: Math.floor(i / 20) * 12 }, size: { x: 10, y: 10 } });
      }
      const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
      const neighbours = (x: number, y: number, rr: number, out: any[]) => {
        for (const b of bodies) if (dist(x, y, b.position.x, b.position.y) <= rr) out.push(b);
      };
      const caps = { maxHops: 4, maxTargets: 12, maxRadius: 400, hopRange: 150, branches: 3 };
      const nodes = E.planChain(bodies[0], { x: 0, y: 0 }, 50, caps, neighbours, dist);
      const ids = nodes.map((n: any) => n.e.id);
      // A POOR conductor first (glass, 0.1): the arc lands and passes on only
      // weakly — low but not zero conductivity (user call).
      const glass = { id: 'g', active: true, shardVariant: 'glass-tile', position: { x: 0, y: 0 }, size: { x: 10, y: 10 } };
      const weak = E.planChain(glass, { x: 0, y: 0 }, 50, caps, neighbours, dist);
      // A TRUE insulator first: the arc lands and stops there.
      const ins = { id: 'i', active: true, material: 'test_insulator', position: { x: 0, y: 0 }, size: { x: 10, y: 10 } };
      E.MATERIALS.test_insulator = { ...E.MATERIALS.metal, conductivity: 0.005 };
      const stopped = E.planChain(ins, { x: 0, y: 0 }, 50, caps, neighbours, dist);
      delete E.MATERIALS.test_insulator;
      const metalHop = nodes.filter((n: any) => n.depth === 1).map((n: any) => n.mag);
      const glassHop = weak.filter((n: any) => n.depth === 1).map((n: any) => n.mag);
      const none = E.planChain(null, { x: 5000, y: 5000 }, 50, caps, neighbours, dist);
      const nan = E.planChain(bodies[0], { x: 0, y: 0 }, NaN, caps, neighbours, dist);
      return {
        count: nodes.length, unique: new Set(ids).size,
        maxDepth: Math.max(...nodes.map((n: any) => n.depth)),
        attenuates: nodes.every((n: any) => n.depth === 0 || n.mag < 50),
        stopped: stopped.length, none: none.length, nan: nan.length,
        weak: weak.length, metalHop: Math.max(...metalHop), glassHop: Math.max(0, ...glassHop),
      };
    });
    expect(r.count).toBeLessThanOrEqual(12);
    expect(r.count).toBeGreaterThan(1);
    expect(r.unique).toBe(r.count);          // nobody processed twice
    expect(r.maxDepth).toBeLessThanOrEqual(4);
    expect(r.attenuates).toBe(true);
    expect(r.stopped).toBe(1);               // an insulator: the arc lands, no chain
    expect(r.weak, 'glass passes the arc on').toBeGreaterThan(1);
    // ...but weakly: the arc out of glass carries glass's conductivity.
    expect(r.glassHop).toBeGreaterThan(0);
    expect(r.glassHop).toBeLessThan(r.metalHop * 0.15);
    expect(r.none).toBe(0);                  // nothing in range: nothing, safely
    expect(r.nan).toBe(0);
  });

  test('fracture profiles: glass breaks differently under heat, metal breaks big, nebula never', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const E = (window as any).__omniEnergy;
      const out: any = {};
      for (const m of ['glass', 'rock', 'metal', 'plastic', 'generic']) {
        out[m] = { mech: E.fractureProfile(m, 'mechanical', 10), heat: E.fractureProfile(m, 'thermal', 10) };
      }
      out.nebula = E.fractureProfile('nebula', 'mechanical', 10);
      out.crazy = E.fractureProfile('glass', 'mechanical', 1e12);
      // THE HOT-BREAK RULE: a body already hot breaks under the thermal
      // profile whatever lands the blow; a cold one keeps the mechanical.
      const cold: any = { shardVariant: 'glass-tile' };
      const hot: any = { shardVariant: 'glass-tile', heat: 0.8 };
      E.stampFractureProfile(cold, 'mechanical', 10);
      E.stampFractureProfile(hot, 'mechanical', 10);
      out.coldStamp = cold.fractureProfile; out.hotStamp = hot.fractureProfile;
      const puff: any = { shardVariant: 'nebula-shard' };
      E.stampFractureProfile(puff, 'mechanical', 10);
      out.puffStamp = puff.fractureProfile ?? null;
      return out;
    });
    const g = r.glass;
    expect(g.mech).not.toEqual(g.heat);
    // Thermal glass: fewer, larger, quieter pieces.
    expect(g.heat.siteScale).toBeLessThan(g.mech.siteScale);
    expect(g.heat.impulse).toBeLessThan(g.mech.impulse);
    // A COLD mechanical break keeps every material's own grain (site scale
    // 1, bias its own) — the play-tested grain table is material identity.
    for (const m of ['glass', 'rock', 'metal', 'plastic']) {
      expect(r[m].mech.siteScale, m).toBe(1);
      expect(r[m].mech.bias, m).toBeUndefined();
    }
    // Rock is not glass: its pieces carry less scatter (and its grain is its own).
    expect(r.rock.mech).not.toEqual(g.mech);
    expect(r.rock.mech.impulse).toBeLessThan(g.mech.impulse);
    // Metal favours the fewest, largest, slowest fragments of the solids.
    for (const m of ['glass', 'rock', 'plastic']) {
      expect(r.metal.heat.siteScale, m).toBeLessThan(r[m].heat.siteScale);
      expect(r.metal.mech.impulse, m).toBeLessThan(r[m].mech.impulse);
    }
    expect(r.nebula).toBeNull();
    expect(r.puffStamp).toBeNull();
    expect(r.coldStamp).toEqual(g.mech);
    expect(r.hotStamp.siteScale).toBe(g.heat.siteScale);
    for (const k of ['siteScale', 'impulse']) expect(Number.isFinite(r.crazy[k])).toBe(true);
    expect(r.crazy.impulse).toBeLessThanOrEqual(2.5);
  });
});

test.describe('the weapons, fired into the world', () => {
  test('every delivery × energy fires and runs without errors or NaN', async ({ page }) => {
    test.setTimeout(180_000);
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    const r = await engine(page, (e, arg: any) => {
      const [ds, es] = arg;
      const p = e.player;
      const bad: string[] = [];
      const keys: string[] = [];
      for (const d of ds) { keys.push(d); for (const x of es) keys.push(`${d}+${x}`); }
      // Aim at the nearest metal tile so every weapon has something to hit.
      const tile = e.currentMap.entities.find((t: any) => t.active && t.shardVariant === 'metal-tile');
      for (const k of keys) {
        p.position.x = tile.position.x - 150; p.position.y = tile.position.y;
        p.velocity.x = 0; p.velocity.y = 0; p.rotation = 0;
        p.currentWeapon = k; p.weaponCooldown = 0;
        e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: tile.position.x, y: tile.position.y }, undefined, false);
        // And its charged variant.
        p.weaponCooldown = 0; p.overchargeUnlocked = true;
        e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: tile.position.x, y: tile.position.y }, undefined, true);
      }
      return { keys: keys.length, bad };
    }, [DELIVERIES, ENERGIES]);
    expect(r.keys).toBe(20);
    // Let the world run through every beam, arc, field, burn and blast.
    await page.waitForTimeout(3000);
    const nan = await engine(page, e => {
      const bad: string[] = [];
      const chk = (x: any, what: string) => { if (!Number.isFinite(x)) bad.push(what); };
      for (const t of e.currentMap.entities) {
        if (!t.active) continue;
        chk(t.position.x, `${t.id}.x`); chk(t.position.y, `${t.id}.y`);
        chk(t.velocity.x, `${t.id}.vx`); chk(t.velocity.y, `${t.id}.vy`);
        if (t.health !== undefined && t.type !== 'PARTICLE') chk(t.health, `${t.id}.hp`);
        if (t.heat !== undefined) chk(t.heat, `${t.id}.heat`);
      }
      return { bad: bad.slice(0, 5), heated: e.energy.heated.length };
    });
    expect(nan.bad).toEqual([]);
    expect(nan.heated).toBeLessThanOrEqual(400);
    watch.assertClean();
  });

  test('HEAT: metal heated first takes far more from the same slug', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    const r = await engine(page, e => {
      const P = e.physics, p = e.player;
      const tiles = e.currentMap.entities.filter((t: any) => t.active && t.shardVariant === 'metal-tile'
        && t.mass === Infinity && !t.fractureEdgeFill).slice(0, 2);
      const hit = (t: any) => {
        p.currentWeapon = 'projectile+kinetic'; p.weaponCooldown = 0;
        const before = e.currentMap.entities.length;
        e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: p.position.x + 500, y: p.position.y }, undefined, false);
        const proj = e.currentMap.entities.slice(before).find((x: any) => x.type === 'PROJECTILE');
        const hp0 = t.health;
        proj.position.x = t.position.x - t.size.x * 0.5 - 2; proj.position.y = t.position.y;
        proj.velocity.x = Math.abs(proj.velocity.x) || 20; proj.velocity.y = 0;
        P.resolveCollision(proj, t, { x: 0, y: 0 },
          e.spawnDamageText, e.handleEntityDeath, e.handleScreenShake, e.handleProjectileHit);
        // Health is DERIVED at first damage — so compare against the
        // derived total, which the second body's first hit also produced.
        return { took: (t.maxHealth - t.health), hp0 };
      };
      const cold = hit(tiles[0]);
      tiles[1].heat = 1; // a fully heated plate
      const hot = hit(tiles[1]);
      return { cold: cold.took, hot: hot.took };
    });
    expect(r.cold).toBeGreaterThan(0);
    expect(r.hot).toBeGreaterThan(r.cold * 2);
    watch.assertClean();
  });

  test('HEAT radiates from where it went in, and spreads at the material\'s own rate', async ({ page }) => {
    // Presentation state, but it is physics: heat lands at the contact
    // point, a new deposit merges by moment matching (heat-weighted centre,
    // second moment kept), and the spot diffuses as sigma^2 += 4*alpha*t —
    // so metal smears across a plate while glass holds the spot where it
    // landed.  Each half below fails on the old centre-of-mass rendering.
    const watch = await boot(page);
    const pure = await page.evaluate(() => {
      const E = (window as any).__omniEnergy;
      const out = { x: 0, y: 0, spread: 0 };
      // Equal heat at two points: centre is the midpoint, spread widens.
      E.mixHeatSpot(1, -10, 0, 3, 1, 10, 0, 3, out);
      const mid = { ...out };
      // A tiny deposit barely moves a big spot.
      E.mixHeatSpot(10, 0, 0, 5, 0.1, 20, 0, 3, out);
      const small = { ...out };
      return {
        mid, small,
        metal: E.diffuseSpread('metal', 3, 0.5, 1e9), glass: E.diffuseSpread('glass', 3, 0.5, 1e9),
        capped: E.diffuseSpread('metal', 3, 100, 40),
        peakTight: E.heatPeak(0.5, 3, 18), peakWide: E.heatPeak(0.5, 36, 18),
        radCold: E.heatRadiance(0), radWarm: E.heatRadiance(0.3), radHot: E.heatRadiance(1),
      };
    });
    expect(pure.mid.x).toBeCloseTo(0, 6);
    expect(pure.mid.spread).toBeGreaterThan(10);         // sqrt(9 + 100)
    expect(pure.small.x).toBeLessThan(1);
    expect(pure.metal).toBeGreaterThan(pure.glass * 2);  // metal spreads far faster
    expect(pure.capped).toBe(40);
    expect(pure.peakTight).toBeGreaterThan(pure.peakWide);
    expect(pure.peakWide).toBeCloseTo(0.5, 6);           // a filled spot is the mean
    expect(pure.radCold).toBe(0);
    expect(pure.radWarm).toBeLessThan(0.15);             // T^4: warm barely glows
    expect(pure.radHot).toBeCloseTo(1, 6);

    await onMap(page, 'METAL_FIELD');
    const r = await engine(page, e => {
      const t = e.currentMap.entities.find((o: any) => o.active
        && o.shardVariant === 'metal-tile' && o.mass === Infinity);
      // Heat arriving from due LEFT of the plate.
      e.debugHeat(t, 10, { x: t.position.x - 80, y: t.position.y });
      const cs = Math.cos(t.rotation || 0);
      return { spotX: t.heatSpotX * cs, spotY: t.heatSpotY, s0: t.heatSpread, id: t.id };
    });
    expect(r.spotX).toBeLessThan(-5);                    // on the side it came from
    expect(Math.abs(r.spotY)).toBeLessThan(3);
    await advanceSim(page, 0.5);
    const later = await engine(page, (e, id) => {
      const t = e.currentMap.entities.find((o: any) => o.id === id);
      return t.heatSpread;
    }, r.id);
    expect(later).toBeGreaterThan(r.s0 * 2);             // it diffused
    watch.assertClean();
  });

  test('HEAT fades in and out, metal holds it longest, and a burn never flashes', async ({ page }) => {
    // Two play-test reports.  A burning body STROBED: the thermal DoT went
    // through the hit path, which whitens a body for a blow, on a 5 Hz
    // cadence (rock is the material that burns and shows it).  And heat
    // FLASHED as it faded in and out — deposits, conduction and the cold
    // snap all step the true peak, and it was drawn raw.  The drawn value
    // now eases toward the real one, and a burn is not a hit.
    const watch = await boot(page);
    const pure = await page.evaluate(() => {
      const E = (window as any).__omniEnergy;
      const up = E.easeShownHeat(0, 1, 0.05);
      const down = 1 - E.easeShownHeat(1, 0, 0.05);
      let h = 0.5, steps = 0;
      while (h > 0 && steps < 100000) { h = E.easeShownHeat(h, 0, 1 / 120); steps++; }
      const cool = (m: string) => E.responseOf(m).coolingPerSec;
      return { up, down, faded: h, steps, metal: cool('metal'), rock: cool('rock'), glass: cool('glass') };
    });
    expect(pure.up).toBeGreaterThan(0);
    expect(pure.up).toBeLessThan(1);                     // a step BLENDS in
    expect(pure.down).toBeLessThan(pure.up);             // and fades out slower
    expect(pure.faded).toBe(0);                          // but does reach cold
    expect(pure.steps).toBeLessThan(120 * 10);
    expect(pure.metal).toBeLessThan(pure.glass);         // metal holds heat longest
    expect(pure.metal).toBeLessThan(pure.rock);

    await onMap(page, 'ASTEROID_FIELD');
    const id = await engine(page, e => {
      const rocks = e.currentMap.entities.filter((o: any) => o.active && o.shardVariant === 'rock-shard');
      rocks.sort((a: any, b: any) => b.size.x - a.size.x);
      const t = rocks[0];
      // Record every flash the body is given from here on.
      let v = t.hitFlash;
      (window as any).__flashes = 0;
      Object.defineProperty(t, 'hitFlash', {
        configurable: true,
        get: () => v,
        set: (x: number) => { if (x > 0) (window as any).__flashes++; v = x; },
      });
      e.debugHeat(t, 20, { x: t.position.x - 200, y: t.position.y });
      return t.id;
    });
    const early = await engine(page, (e, id) => {
      const t = e.currentMap.entities.find((o: any) => o.id === id);
      return t.heatShown ?? 0;
    }, id);
    await advanceSim(page, 1);
    const r = await engine(page, (e, id) => {
      const t = e.currentMap.entities.find((o: any) => o.id === id);
      return {
        flashes: (window as any).__flashes, shown: t?.heatShown ?? 0, heat: t?.heat ?? 0,
        // Health is DERIVED from the grain boundaries at first damage, so
        // compare against the body's own max, not the authored spawn value.
        burned: !t || !t.active || t.health < t.maxHealth,
      };
    }, id);
    expect(r.burned, 'the burn really ran').toBe(true);
    expect(r.flashes, 'a burn is not a hit').toBe(0);
    expect(early, 'heat fades in, it does not pop').toBeLessThan(r.shown + 1e-9);
    watch.assertClean();
  });

  test('HEAT: only the active set carries heat — a full set refuses more, a map change leaves bodies cold', async ({ page }) => {
    // Cooling walks the active set and nothing else, so heat on a body
    // OUTSIDE it would never leave: permanently weakened, and breaking under
    // the thermal profile for good.  Both ways that could happen are pinned.
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    const r = await engine(page, e => {
      const CAP = 400;   // ENERGY_CONSTANTS.MAX_HEATED, written out
      const tiles = e.currentMap.entities.filter((t: any) => t.active
        && t.shardVariant === 'metal-tile' && t.mass === Infinity);
      for (let i = 0; i < CAP && i < tiles.length; i++) e.debugHeat(tiles[i], 5);
      const full = e.energy.heated.length;
      const extra = tiles[CAP];
      if (extra) e.debugHeat(extra, 5);
      const refused = extra !== undefined && extra.heat === undefined
        && e.energy.heated.length === CAP;
      const body = tiles[0];
      const hotBefore = (body.heat ?? 0) > 0;
      // Leaving the map runs the same reset every map load does.
      const left = e.transitionToMap('overworld');
      return {
        n: tiles.length, full, refused, hotBefore, left,
        coldAfter: body.heat === undefined && body.heatTracked === undefined,
        setAfter: e.energy.heated.length,
      };
    });
    expect(r.n, 'enough metal on the map to fill the set').toBeGreaterThan(400);
    expect(r.full).toBe(400);
    expect(r.refused, 'a full set takes no heat it could never cool').toBe(true);
    expect(r.hotBefore).toBe(true);
    expect(r.left).toBe(true);
    expect(r.coldAfter, 'a body leaves the set cold, not merely untracked').toBe(true);
    expect(r.setAfter).toBe(0);
    watch.assertClean();
  });

  test('HEAT: a thermal beam makes glass FAIL under the thermal profile', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'GLASS_FIELD');
    // Whatever pane the beam FIRST touches is the one under test — in a
    // cluster that is not necessarily the one aimed at.
    const fire = () => engine(page, e => {
      const p = e.player;
      const aim = (window as any).__aim;
      p.currentWeapon = 'beam+thermal'; p.weaponCooldown = 0;
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, aim, undefined, false);
    });
    await engine(page, e => {
      const p = e.player;
      const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === 'glass-tile' && x.mass === Infinity);
      p.position.x = t.position.x - 120; p.position.y = t.position.y;
      p.velocity.x = 0; p.velocity.y = 0;
      (window as any).__aim = { x: t.position.x, y: t.position.y };
    });
    await fire();
    await page.waitForTimeout(200);
    const id = await engine(page, e => {
      const hit = e.currentMap.entities.find((x: any) => x.id === e.energy.lastBeamHitId);
      (window as any).__glassT = hit;
      return hit ? hit.shardVariant : null;
    });
    expect(id).toBe('glass-tile');
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(450);
      if (!(await engine(page, e => (window as any).__glassT.active))) break;
      await fire();
    }
    const out = await engine(page, e => {
      const t = (window as any).__glassT;
      return { active: t.active, profile: t.fractureProfile };
    });
    expect(out.active).toBe(false);
    // It went under the THERMAL profile: few, large, quiet pieces.
    expect(out.profile.impulse).toBeLessThan(0.5);
    expect(out.profile.siteScale).toBeLessThan(1);
    watch.assertClean();
  });

  test('ELECTRIC: an arc beam finds conductors and stays inside its caps', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    const r = await engine(page, e => {
      const p = e.player;
      const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === 'metal-tile');
      p.position.x = t.position.x - 120; p.position.y = t.position.y; p.rotation = 0;
      p.velocity.x = 0; p.velocity.y = 0;
      p.currentWeapon = 'beam+electric'; p.weaponCooldown = 0;
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: t.position.x, y: t.position.y }, undefined, false);
      return true;
    });
    await page.waitForTimeout(300);
    const hit = await engine(page, e => ({ id: e.energy.lastBeamHitId, chain: e.energy.lastChainSize }));
    expect(hit.id).not.toBeNull();
    expect(hit.chain).toBeGreaterThan(0);
    expect(hit.chain).toBeLessThanOrEqual(12);
    // GLASS conducts, weakly (user call: low but not zero): the arc beam
    // lands on a pane and cracks it, where it used to fizzle.
    await onMap(page, 'GLASS_FIELD');
    const glass = await engine(page, e => {
      const p = e.player;
      const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === 'glass-tile'
        && x.mass === Infinity);
      (window as any).__gl = t;
      p.position.x = t.position.x - 100; p.position.y = t.position.y; p.rotation = 0;
      p.velocity.x = 0; p.velocity.y = 0;
      p.currentWeapon = 'beam+electric'; p.weaponCooldown = 0;
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: t.position.x, y: t.position.y }, undefined, false);
      return t.id;
    });
    await page.waitForTimeout(400);
    const g = await engine(page, e => {
      // Judged on whatever the arc actually struck: in a glass field the
      // nearest conductor in its cone may be a neighbouring pane.
      const id = e.energy.lastBeamHitId;
      const t = e.currentMap.entities.find((x: any) => x.id === id);
      return { hit: id, cracked: !!t && (!t.active
        || (t.fractureEdgeFill ?? []).some((f: number) => f > 0)) };
    });
    expect(g.hit, 'the arc found glass').not.toBeNull();
    expect(g.cracked, 'and the pane took damage').toBe(true);
    void glass;
    // With NOTHING in range at all: a fizzle and nothing else, safely.
    await engine(page, e => {
      const p = e.player;
      for (const x of e.currentMap.entities) if (x.type === 'STRUCTURE' || x.type === 'ENEMY') x.active = false;
      e.physics.initializeStaticGrid(e.currentMap.entities);
      e.energy.lastBeamHitId = 'sentinel';
      p.currentWeapon = 'beam+electric'; p.weaponCooldown = 0;
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: p.position.x + 100, y: p.position.y }, undefined, false);
    });
    await page.waitForTimeout(250);
    const empty = await engine(page, e => e.energy.lastBeamHitId);
    expect(empty).toBeNull();
    expect(r).toBe(true);
    watch.assertClean();
  });

  test('ELECTRIC: an arc on a metal tile jumps over the next tile to an enemy beyond it', async ({ page }) => {
    // User call: a hull conducts exactly as well as metal, so an arc on a
    // metal plate reaches the ship on the far side of the neighbouring plate.
    // The enemy is placed PAST one hop's reach from the struck plate, so the
    // only way to it is through the plate in between.
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    const r = await engine(page, e => {
      const all = e.currentMap.entities.filter((x: any) => x.active && x.shardVariant === 'metal-tile');
      // A plate with a neighbour 30..60 away.
      let t0: any = null, t1: any = null;
      for (const a of all) {
        const b = all.find((o: any) => o !== a
          && Math.hypot(o.position.x - a.position.x, o.position.y - a.position.y) > 30
          && Math.hypot(o.position.x - a.position.x, o.position.y - a.position.y) < 60);
        if (b) { t0 = a; t1 = b; break; }
      }
      // Clear everything else around them so the chain has one route.
      for (const o of all) {
        if (o === t0 || o === t1) continue;
        if (Math.hypot(o.position.x - t0.position.x, o.position.y - t0.position.y) < 500) {
          e.physics.removeStaticEntity(o); o.active = false;
        }
      }
      const dx = t1.position.x - t0.position.x, dy = t1.position.y - t0.position.y;
      const d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
      const foe = e.waves.spawnAt('RAMMER_1',
        { x: t1.position.x + ux * 130, y: t1.position.y + uy * 130 }, e.waveContext(), false);
      foe.velocity.x = 0; foe.velocity.y = 0;
      const p = e.player;
      p.position.x = t0.position.x - ux * 110; p.position.y = t0.position.y - uy * 110;
      p.velocity.x = 0; p.velocity.y = 0; p.rotation = Math.atan2(uy, ux);
      (window as any).__foe = foe;
      (window as any).__hp = foe.health;
      p.currentWeapon = 'beam+electric'; p.weaponCooldown = 0;
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: t0.position.x, y: t0.position.y }, undefined, false);
      return { gap: Math.hypot(foe.position.x - t0.position.x, foe.position.y - t0.position.y) };
    });
    await page.waitForTimeout(400);
    const after = await engine(page, e => {
      const foe = (window as any).__foe;
      return { hit: e.energy.lastBeamHitId, lost: (window as any).__hp - foe.health, chain: e.energy.lastChainSize };
    });
    expect(r.gap, 'the enemy is out of one hop from the struck plate').toBeGreaterThan(150);
    expect(after.hit).not.toBeNull();
    expect(after.chain).toBeGreaterThanOrEqual(3);
    expect(after.lost, 'the arc reached the enemy through the next plate').toBeGreaterThan(0);
    watch.assertClean();
  });

  test('GAS: kinetic rounds shove a drifting puff and break up a static cloud tile; an arc energises gas', async ({ page }) => {
    // Nebula is a GAS (`gas: true` in the material table): it takes no damage
    // from any energy.  A kinetic round passing through a DRIFTING puff shoves
    // it along the round's travel (as a kinetic beam always has); a STATIC
    // cloud tile is broken up into puffs, as a ship flying through it does;
    // an arc energises a puff rather than damaging it.
    const watch = await boot(page);
    await onMap(page, 'NEBULA_FIELD');
    // Break a patch of cloud into drifting puffs, well away from the ship.
    await engine(page, e => {
      const p = e.player;
      const tiles = e.currentMap.entities.filter((x: any) => x.active && x.shardVariant === 'nebula-tile'
        && Math.hypot(x.position.x - p.position.x, x.position.y - p.position.y) > 600);
      const c = tiles[0].position;
      for (const t of tiles.filter((t: any) => Math.hypot(t.position.x - c.x, t.position.y - c.y) < 160).slice(0, 12)) {
        t.health = 0; t.lastImpactVelocity = { x: 0, y: 0 };
        e.physics.removeStaticEntity(t); e.handleEntityDeath(t); t.active = false;
      }
    });
    await page.waitForTimeout(1500);   // past the puffs' fade-in
    const shoot = async (key: string) => {
      await engine(page, (e, k: string) => {
        const p = e.player;
        const s = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === 'nebula-shard'
          && x.mergeFadeTimer === undefined);
        (window as any).__s = s; (window as any).__max = 0; (window as any).__hp = s.health;
        // An arc goes to the NEAREST conductor in its cone, which in a
        // cloud bank may be a neighbouring puff rather than \`s\` — so the
        // arc's claims are judged on whatever it actually struck.
        const hp = new Map<string, number>();
        for (const x of e.currentMap.entities) if (x.active) hp.set(x.id, x.health);
        (window as any).__hpAll = hp;
        s.velocity.x = 0; s.velocity.y = 0;
        p.position.x = s.position.x - 90; p.position.y = s.position.y;
        p.velocity.x = 0; p.velocity.y = 0; p.rotation = 0;
        p.currentWeapon = k; p.weaponCooldown = 0;
        e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: s.position.x, y: s.position.y }, undefined, false);
        // The puff's own drag bleeds a shove off quickly, so watch its PEAK.
        // Sampled after EVERY physics step, not on a wall-clock timer: a slow
        // frame drains several substeps at once, and a timer then only ever
        // sees the puff after its drag has already bled the shove off.
        const up = e.updatePhysics;
        (window as any).__up = up;
        e.updatePhysics = function (this: any, dt: number) {
          up.call(this, dt);
          const v = Math.hypot(s.velocity.x, s.velocity.y);
          if (v > (window as any).__max) (window as any).__max = v;
        };
      }, key);
      await page.waitForTimeout(500);
      return engine(page, e => {
        e.updatePhysics = (window as any).__up;
        const s = (window as any).__s;
        const hitId = e.energy.lastBeamHitId;
        const h = hitId ? e.currentMap.entities.find((x: any) => x.id === hitId) : null;
        return { peak: (window as any).__max, active: s.active, lostHp: (window as any).__hp - s.health,
                 hit: h ? { variant: h.shardVariant, active: h.active,
                            lostHp: ((window as any).__hpAll.get(h.id) ?? h.health) - h.health,
                            energized: (h.energizedUntil ?? 0) > e.simClock } : null };
      });
    };
    const slug = await shoot('projectile+kinetic');
    expect(slug.peak, 'a kinetic round shoves the puff it passes through').toBeGreaterThan(1.2);
    expect(slug.active).toBe(true);
    expect(slug.lostHp).toBe(0);
    const arc = await shoot('beam+electric');
    expect(arc.hit, 'the arc found a conductor in the cloud').not.toBeNull();
    expect(arc.hit!.variant, 'and in a cloud bank that conductor is gas').toMatch(/^nebula-/);
    expect(arc.hit!.energized, 'an arc energises a gas').toBe(true);
    expect(arc.hit!.active).toBe(true);
    expect(arc.hit!.lostHp, 'and never damages it').toBe(0);
    // A static cloud TILE: a kinetic round breaks it up the way a ship flying
    // through it does (user call) — into drifting puffs — and flies on.
    const tile = await engine(page, e => {
      const p = e.player;
      const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === 'nebula-tile'
        && Math.hypot(x.position.x - p.position.x, x.position.y - p.position.y) > 400);
      (window as any).__t = t;
      (window as any).__n0 = e.currentMap.entities.length;
      p.position.x = t.position.x - 140; p.position.y = t.position.y;
      p.velocity.x = 0; p.velocity.y = 0;
      p.currentWeapon = 'projectile+kinetic'; p.weaponCooldown = 0;
      const before = new Set(e.currentMap.entities.map((x: any) => x.id));
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: t.position.x, y: t.position.y }, undefined, false);
      (window as any).__round = e.currentMap.entities.find((x: any) => !before.has(x.id) && x.type === 'PROJECTILE');
      return t.id;
    });
    await page.waitForTimeout(500);
    const t = await engine(page, e => {
      const x = (window as any).__t, r = (window as any).__round;
      return { hp: x.health, broken: x.health <= 0 || !x.active,
               roundHit: (r.hitEntityIds ?? []).includes(x.id) };
    });
    expect(t.broken, `tile ${tile} is broken up by the round`).toBe(true);
    expect(t.roundHit, 'by that round').toBe(true);
    watch.assertClean();
  });

  test('SEEKER: a homing round locks the nearest ENEMY, never terrain, and the lock is drawn', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    const r = await engine(page, e => {
      const p = e.player;
      // An enemy 250 away, with metal plates nearer the ship than it is.
      const foe = e.waves.spawnAt('RAMMER_1', { x: p.position.x + 250, y: p.position.y }, e.waveContext(), false);
      foe.velocity.x = 0; foe.velocity.y = 0;
      (window as any).__foe = foe;
      p.velocity.x = 0; p.velocity.y = 0;
      for (const k of ['homing', 'homing+electric']) {
        p.currentWeapon = k; p.weaponCooldown = 0;
        e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: p.position.x + 250, y: p.position.y - 150 }, undefined, false);
      }
      return true;
    });
    await page.waitForTimeout(120);
    const lock = await engine(page, e => {
      const foe = (window as any).__foe;
      const seekers = e.entityIndex.projectiles.filter((x: any) => x.active && x.homing && x.ownerType === 'PLAYER');
      return {
        seekers: seekers.length,
        lockedFoe: seekers.filter((x: any) => x.homingTarget === foe).length,
        lockedOther: seekers.filter((x: any) => x.homingTarget && x.homingTarget.type !== 'ENEMY').length,
        drawn: e._energyFx.locks.includes(foe),
      };
    });
    expect(r).toBe(true);
    expect(lock.seekers).toBeGreaterThan(0);
    expect(lock.lockedOther, 'never terrain').toBe(0);
    expect(lock.lockedFoe).toBe(lock.seekers);
    expect(lock.drawn, 'the renderer is handed the lock').toBe(true);
    watch.assertClean();
  });

  test('PLASTIC: heat releases the bonds holding it', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'PLASTIC_FIELD');
    // Let plastic debris bond: break a few tiles and give it time.
    await engine(page, e => {
      const tiles = e.currentMap.entities.filter((x: any) => x.active && x.shardVariant === 'plastic-tile').slice(0, 30);
      for (const t of tiles) { t.health = 0; t.lastImpactVelocity = { x: 0, y: 0 }; e.physics.removeStaticEntity(t); e.handleEntityDeath(t); t.active = false; }
    });
    // Find a live bond and heat its shard in ONE evaluate.  The sim keeps
    // stepping between evaluates, so a bond found in one can have broken by
    // the next — which read `before` as 0 (measured: 1 run in 16).
    let r: any = null;
    for (let i = 0; i < 20 && !r; i++) {
      await page.waitForTimeout(500);
      r = await engine(page, e => {
        const b = e.shards.liveBonds.find((x: any) => x.a.shardVariant === 'plastic-shard' && x.a.active);
        if (!b) return null;
        const s = b.a;
        const before = e.shards.liveBonds.filter((x: any) => x.a === s || x.b === s).length;
        // Heat it past its release point (the rule under test is the
        // material's `bondReleaseAt`, whatever delivers the heat).
        e.debugHeat(s, 40, { x: s.position.x - 30, y: s.position.y });
        const after = e.shards.liveBonds.filter((x: any) => x.a === s || x.b === s).length;
        return { before, after, heat: s.heat };
      });
    }
    test.skip(!r, 'no plastic bond formed in this run');
    expect(r.before).toBeGreaterThan(0);
    expect(r.after).toBe(0);
    expect(r.heat).toBeGreaterThan(0.3);
    watch.assertClean();
  });

  test('CANNON: an incendiary shell heats what its blast reaches, on a capped set', async ({ page }) => {
    // The blast belongs to the CANNON delivery now (the Pulse became it);
    // heat on the blast is a property of the thermal shell (`blastHeat`),
    // not of every explosion — so the bare cannon's blast leaves nothing hot.
    const watch = await boot(page);
    await onMap(page, 'GLASS_FIELD');
    const fire = async (key: string) => {
      await engine(page, (e, k: string) => {
        for (const h of [...e.energy.heated]) { h.heat = 0; }
        const p = e.player;
        const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === 'glass-tile');
        p.position.x = t.position.x - 90; p.position.y = t.position.y;
        p.velocity.x = 0; p.velocity.y = 0;
        p.health = p.maxHealth = 1e9;
        // An ACTOR in front of the pane trips the incendiary shell there, so
        // its blast lands on glass (a shell bores clean through panes, and
        // left alone it would go off on its fuse past the cluster).
        const foe = e.waves.spawnAt('RAMMER_1', { x: t.position.x - 40, y: t.position.y }, e.waveContext(), false);
        foe.position.x = t.position.x - 40; foe.position.y = t.position.y;
        foe.maxSpeed = 0; foe.velocity.x = 0; foe.velocity.y = 0;
        foe.health = foe.maxHealth = 1e6; foe.shield = 0; foe.maxShield = 0;
        p.currentWeapon = k; p.weaponCooldown = 0;
        e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: t.position.x, y: t.position.y }, undefined, false);
      }, key);
      // Sample PEAKS across the fuse (0.42 s) and the ring's whole life: the
      // shell bores through panes before it goes off, and heat on the glass it
      // reaches is already cooling by the end of the window.
      let maxRing = 0, hot = 0;
      for (let i = 0; i < 9; i++) {
        await advanceSim(page, 0.1);
        const r = await engine(page, e => {
          const rings = e.currentMap.entities.filter((x: any) => x.isExplosionRing && x.validHitIds);
          return { ring: Math.max(0, ...rings.map((x: any) => x.validHitIds.size)),
                   hot: e.energy.heated.filter((x: any) => (x.heat ?? 0) > 0.01).length };
        });
        maxRing = Math.max(maxRing, r.ring); hot = Math.max(hot, r.hot);
      }
      return { maxRing, hot };
    };
    const bare = await fire('cannon');
    const hot = await fire('cannon+thermal');
    expect(bare.hot, 'a plain blast is not a fire').toBe(0);
    expect(hot.hot, 'the incendiary shell heats what it reaches').toBeGreaterThan(0);
    expect(hot.maxRing).toBeLessThanOrEqual(64);
    watch.assertClean();
  });

  test('CANNON: the bare shell is white and weak, and only its FUSE sets it off — not an enemy, not terrain', async ({ page }) => {
    // User call: the bare cannon is weaker, white, explodes after a set time,
    // and its shell is a deep, low-damage penetrator that does not blast the
    // moment it stops.  The Heavy Shell keeps the old shell rules, so it is
    // the control: into the same wall it stops and blasts early.
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    const cfg = await page.evaluate(() => {
      const E = (window as any).__omniEnergy;
      const c = E.weaponConfig('cannon');
      return { color: c.color, detonateOn: c.detonateOn, damage: c.damage };
    });
    const hex = cfg.color.replace('#', '');
    for (let i = 0; i < 3; i++) expect(parseInt(hex.slice(i * 2, i * 2 + 2), 16), 'white').toBeGreaterThan(225);
    expect(cfg.detonateOn).toBe('fuse');

    // A clean lane: a row of SIX metal tiles, nothing else in the world.
    await engine(page, e => {
      const tiles = e.currentMap.entities.filter((x: any) => x.active && x.shardVariant === 'metal-tile'
        && x.mass === Infinity).slice(0, 6);
      for (const x of e.currentMap.entities) if (x.type === 'STRUCTURE' && !tiles.includes(x)) x.active = false;
      (window as any).__wall = tiles.map((t: any) => ({ t, snap: JSON.parse(JSON.stringify({
        poly: t.polygonPoints, size: t.size })) }));
      e.player.health = e.player.maxHealth = 1e9;
    });
    const shoot = (key: string, withFoe: boolean) => engine(page, (e, a: any) => {
      const p = e.player, P: any = e.physics;
      const rings = () => e.currentMap.entities.filter((x: any) => x.active && x.isExplosionRing);
      for (const r0 of rings()) r0.active = false;
      // Rebuild the wall fresh for every shot: same place, whole, unhit.
      const wall = (window as any).__wall;
      const x0 = 2000, y0 = 2000;
      wall.forEach((w: any, i: number) => {
        const t = w.t;
        t.active = true; t.position.x = x0 + i * 34; t.position.y = y0;
        t.polygonPoints = w.snap.poly; t.size = w.snap.size; t.rotation = 0;
        delete t.fractureCells; delete t.fractureEdges; delete t.fractureEdgeFill;
        delete t.fractureBoundaryHp; delete t.shattered; delete t.deathDispatched;
        t.health = t.maxHealth = t.authoredMaxHealth ?? t.maxHealth;
      });
      P.initializeStaticGrid(e.currentMap.entities);
      p.position.x = x0 - 150; p.position.y = y0; p.velocity.x = 0; p.velocity.y = 0;
      let foe: any = null;
      if (a.withFoe) {
        foe = e.waves.spawnAt('RAMMER_1', { x: x0 - 70, y: y0 }, e.waveContext(), false);
        foe.position.x = x0 - 70; foe.position.y = y0;
        foe.maxSpeed = 0; foe.velocity.x = 0; foe.velocity.y = 0;
        foe.health = foe.maxHealth = 1e6; foe.shield = 0; foe.maxShield = 0;
      }
      p.currentWeapon = a.key; p.weaponCooldown = 0;
      const before = new Set(e.currentMap.entities.map((x: any) => x.id));
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: x0 + 400, y: y0 }, undefined, false);
      const sh = e.currentMap.entities.find((x: any) => !before.has(x.id) && x.type === 'PROJECTILE');
      const blast = sh.explosionDamage, sx = sh.position.x;
      let ringAt = -1, maxTravel = 0;
      for (let i = 0; i < 90 && ringAt < 0; i++) {
        e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120);
        if (sh.active && !sh.detonated) {
          let d = sh.position.x - sx; d -= Math.round(d / e.currentMap.width) * e.currentMap.width;
          maxTravel = Math.max(maxTravel, d);
        }
        if (rings().length > 0) ringAt = (i + 1) / 120;
      }
      const tilesHit = wall.filter((w: any) => w.t.fractureEdgeFill
        && w.t.fractureEdgeFill.some((f: number) => f > 0)).length;
      const foeLost = foe ? 1e6 - foe.health : 0;
      if (foe) foe.active = false;
      return { ringAt, maxTravel, tilesHit, blast, foeLost, bite: sh.damage };
    }, { key, withFoe });

    const bare = await shoot('cannon', true);
    // Its bite is tiny against its bank, so it passes through the foe (the
    // overkill rule) — and the contact does not set it off.
    expect(bare.foeLost, 'it struck the foe').toBeGreaterThan(0);
    expect(bare.ringAt, 'an enemy does not set it off: it goes off on its fuse (0.42 s)').toBeGreaterThan(0.38);
    expect(bare.ringAt).toBeLessThan(0.5);
    // The blast is the weapon's damage, but weaker than the old Plasma Cannon (20.8 peak).
    expect(bare.blast).toBeGreaterThan(bare.bite * 2);
    expect(bare.blast).toBeLessThan(20.8 * 0.75);

    const heavy = await shoot('cannon+kinetic', false);
    const deep = await shoot('cannon', false);
    expect(heavy.ringAt, 'control: the Heavy Shell stops in the metal and blasts before its fuse').toBeLessThan(0.38);
    expect(deep.ringAt, 'the bare shell does not blast because it met terrain').toBeGreaterThan(0.38);
    expect(deep.tilesHit, 'it bores on through the wall').toBeGreaterThanOrEqual(4);
    expect(deep.maxTravel).toBeGreaterThan(heavy.maxTravel + 100);
    watch.assertClean();
  });

  test('the module path: a modifier touching a gun changes what it fires', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'GLASS_FIELD');
    const r = await engine(page, e => {
      const start = e.player.currentWeapon;
      e.debugGrantWeapon('beam+thermal');
      const afterBeam = [...e.equippedWeapons];
      e.debugGrantWeapon('CANNON');   // an OLD id: resolves to the Cannon delivery
      const afterCannon = [...e.equippedWeapons];
      return { start, afterBeam, afterCannon, current: e.player.currentWeapon };
    });
    expect(r.start).toBe('projectile');
    expect(r.afterBeam).toContain('beam+thermal');
    expect(r.afterBeam).toContain('projectile');    // the modifier did NOT bleed onto the other gun
    expect(r.afterCannon).toContain('cannon');
    watch.assertClean();
  });

  test('BEAM: stops where it touches the drawn shape, not a bounding circle', async ({ page }) => {
    // User report: the beam ended short of the shard it hit, because the
    // raycast tested a circle sized to the body's LONGEST extent.  A thin
    // bar 8 wide and 80 tall has a 40-radius circle, so the circle stops the
    // beam 36 units short of the bar's face; the polygon test must not.
    const watch = await boot(page);
    await onMap(page, 'ROCK_FIELD');
    const setup = await engine(page, e => {
      const p = e.player, P: any = e.physics;
      const s = e.currentMap.entities.find((x: any) => x.active
        && x.shardVariant === 'rock-tile' && x.mass === Infinity);
      for (const x of e.currentMap.entities) if (x !== s && x.type === 'STRUCTURE') x.active = false;
      s.polygonPoints = [{ x: -4, y: -40 }, { x: 4, y: -40 }, { x: 4, y: 40 }, { x: -4, y: 40 }];
      s.size.x = 80; s.size.y = 80;
      s.rotation = 0; s.rotationSpeed = 0; s.angularVelocity = 0;
      s.health = s.maxHealth = 1e9;
      delete s.fractureCells; delete s.fractureEdges; delete s.fractureEdgeFill;
      P.initializeStaticGrid(e.currentMap.entities);
      p.position.x = s.position.x - 200; p.position.y = s.position.y;
      p.velocity.x = 0; p.velocity.y = 0; p.rotation = 0;
      p.currentWeapon = 'beam'; p.weaponCooldown = 0;
      (window as any).__bar = s;
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: s.position.x, y: s.position.y }, undefined, false);
      return { sx: s.position.x };
    });
    // Snapshot in the SAME poll that sees the hit: the pulse lasts 0.3 s,
    // so a separate read afterwards can find the beam already gone.
    await page.waitForFunction(() => {
      const e = (window as any).__omniEngine;
      const b = e.energy.beam;
      if (!(b && b.hit)) return false;
      (window as any).__beamHit = { x1: b.x1, hitId: e.energy.lastBeamHitId };
      return true;
    }, null, { timeout: 5000, polling: 'raf' });
    const r = await engine(page, e => {
      const b = (window as any).__beamHit, s = (window as any).__bar;
      // The beam's end point is in the SHIP's frame, so a bar near the torus
      // seam has it a map-width away; measure the gap wrapped.
      const W = e.currentMap.width;
      let gap = s.position.x - b.x1;
      gap -= Math.round(gap / W) * W;
      return { gap, hitId: b.hitId, id: s.id };
    });
    expect(r.hitId, 'the beam hit the bar').toBe(r.id);
    // The face is 4 in front of the bar's centre.  A circle hit would sit
    // near 40 in front (plus half the beam's width).
    expect(r.gap, 'the beam ends on the face, not on a bounding circle')
      .toBeLessThan(8);
    expect(r.gap).toBeGreaterThan(0);
    watch.assertClean();
  });

  test('LIGHT: a beam reflects off metal, passes through glass (bending, splitting, leaving a little on each grain boundary), and stops in rock', async ({ page }) => {
    // User call: beams split, pass through and reflect by MATERIAL PROPERTY
    // (reflectivity, transmissivity, refractive index, per-boundary scatter /
    // loss / split).  One lane, one tile, three materials.
    const watch = await boot(page);
    const lane = async (map: string, variant: string) => {
      await onMap(page, map);
      await engine(page, (e, v: string) => {
        const p = e.player, P: any = e.physics;
        const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === v && x.mass === Infinity);
        for (const x of e.currentMap.entities) if (x !== t && (x.type === 'STRUCTURE' || x.type === 'ENEMY')) x.active = false;
        t.rotation = 0; t.health = t.maxHealth = 1e9;
        delete t.fractureCells; delete t.fractureEdges; delete t.fractureEdgeFill;
        P.initializeStaticGrid(e.currentMap.entities);
        p.position.x = t.position.x - 160; p.position.y = t.position.y + 3;
        p.velocity.x = 0; p.velocity.y = 0; p.rotation = 0;
        p.currentWeapon = 'beam'; p.weaponCooldown = 0;
        (window as any).__lt = t;
        (window as any).__light = null;
        e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: t.position.x, y: t.position.y + 3 }, undefined, false);
      }, variant);
      await page.waitForFunction(() => {
        const e = (window as any).__omniEngine, b = e.energy.beam;
        // The blade EXTENDS over 0.1 s: judge the path once it is fully out.
        if (!(b && b.hit && b.light.nSeg > 0 && !b.retracting && b.reach >= b.config.beamRange)) return false;
        (window as any).__light = { segs: b.light.segs.slice(0, b.light.nSeg * 5), n: b.light.nSeg };
        return true;
      }, null, { timeout: 5000, polling: 'raf' });
      return engine(page, e => {
        const L = (window as any).__light, t = (window as any).__lt;
        const W = e.currentMap.width;
        const rel = (x: number) => { let d = x - t.position.x; return d - Math.round(d / W) * W; };
        const segs = [] as any[];
        for (let k = 0; k < L.n; k++) {
          const o = k * 5;
          segs.push({ x0: rel(L.segs[o]), x1: rel(L.segs[o + 2]),
                      dx: L.segs[o + 2] - L.segs[o], dy: L.segs[o + 3] - L.segs[o + 1], f: L.segs[o + 4] });
        }
        const edges = (t.fractureEdgeFill ?? []).filter((f: number) => f > 0);
        return { segs, n: L.n, boundariesHit: edges.length,
                 maxOnOne: edges.length ? Math.max(...edges) : 0, r: Math.max(t.size.x, t.size.y) / 2 };
      });
    };
    const metal = await lane('METAL_FIELD', 'metal-tile');
    // A MIRROR: a second segment leaves the face heading back toward the ship.
    expect(metal.n, 'the beam reflected').toBeGreaterThan(1);
    expect(metal.segs[1].dx, 'back the way it came').toBeLessThan(0);
    expect(metal.segs[1].f, 'carrying most of the light').toBeGreaterThan(0.6);

    const glass = await lane('GLASS_FIELD', 'glass-tile');
    // Through the pane and out of the far side.
    expect(Math.max(...glass.segs.map((q: any) => q.x1)), 'the beam came out of the far side').toBeGreaterThan(glass.r + 20);
    // Bent and split inside: several segments within the pane, not one.
    expect(glass.segs.filter((q: any) => Math.abs(q.x0) < glass.r && Math.abs(q.x1) < glass.r + 2).length,
      'it crossed grain boundaries inside').toBeGreaterThan(1);
    expect(glass.n, 'and split').toBeGreaterThan(4);
    // A little energy on EACH boundary it crossed — low damage per boundary.
    expect(glass.boundariesHit, 'it left energy on several grain boundaries').toBeGreaterThan(1);
    expect(glass.maxOnOne, 'but only a little on each').toBeLessThan(1);

    const rock = await lane('ROCK_FIELD', 'rock-tile');
    // Opaque and dull: the light ends at the face.
    expect(Math.max(...rock.segs.map((q: any) => q.x1)), 'nothing gets through rock').toBeLessThan(rock.r);
    expect(Math.max(0, ...rock.segs.slice(1).map((q: any) => q.f)), 'and almost nothing comes back').toBeLessThan(0.1);
    watch.assertClean();
  });

  test('LIGHT: the kinetic beam is a burst of pulses that FLY, reflect off metal and chip rock', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    const r = await engine(page, e => {
      const p = e.player, P: any = e.physics;
      const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === 'metal-tile' && x.mass === Infinity);
      for (const x of e.currentMap.entities) if (x !== t && (x.type === 'STRUCTURE' || x.type === 'ENEMY')) x.active = false;
      t.rotation = 0; t.health = t.maxHealth = 1e9;
      P.initializeStaticGrid(e.currentMap.entities);
      p.position.x = t.position.x - 200; p.position.y = t.position.y;
      p.velocity.x = 0; p.velocity.y = 0; p.rotation = 0;
      p.currentWeapon = 'beam+kinetic'; p.weaponCooldown = 0;
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: t.position.x, y: t.position.y }, undefined, false);
      const alive = () => e.energy.pulses.filter((q: any) => q.alive);
      const W = e.currentMap.width;
      const rel = (x: number) => { let d = x - t.position.x; return d - Math.round(d / W) * W; };
      let most = 0, firstX: number[] = [], back = false;
      for (let i = 0; i < 60; i++) {
        e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120);
        const a = alive();
        most = Math.max(most, a.length);
        if (i < 6 && a.length) firstX.push(rel(a[0].x));
        if (a.some((q: any) => q.ux < -0.5 && rel(q.x) < 0)) back = true;
      }
      return { most, firstX, back, burst: e.energy.burst === null };
    });
    expect(r.most, 'several pulses in flight at once').toBeGreaterThan(2);
    // A pulse is not instantaneous: it advances step by step.
    expect(r.firstX[r.firstX.length - 1]).toBeGreaterThan(r.firstX[0]);
    expect(r.back, 'a pulse reflected off the metal and flew back').toBe(true);
    expect(r.burst, 'the burst finished leaving').toBe(true);

    await onMap(page, 'ROCK_FIELD');
    const rock = await engine(page, e => {
      const p = e.player;
      const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === 'rock-tile' && x.mass === Infinity);
      p.position.x = t.position.x - 150; p.position.y = t.position.y;
      p.velocity.x = 0; p.velocity.y = 0;
      p.currentWeapon = 'beam+kinetic'; p.weaponCooldown = 0;
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: t.position.x, y: t.position.y }, undefined, false);
      for (let i = 0; i < 60; i++) { e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120); }
      // Judged on whatever the pulses actually struck first.
      const h = e.currentMap.entities.find((x: any) => x.id === e.energy.lastPulseHitId);
      return { hit: e.energy.lastPulseHitId,
               dmg: !!h && (!h.active || (h.fractureEdgeFill ?? []).some((f: number) => f > 0)) };
    });
    expect(rock.hit).not.toBeNull();
    expect(rock.dmg, 'the pulses chipped the rock').toBe(true);
    watch.assertClean();
  });

  test('LIGHT CARRIES HEAT: a hot body burns a hull that touches it, and heats a hull near it by radiation', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    const setup = (gap: number) => engine(page, (e, gp: number) => {
      const p = e.player, P: any = e.physics;
      const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === 'metal-tile' && x.mass === Infinity);
      for (const x of e.currentMap.entities) if (x !== t && (x.type === 'STRUCTURE' || x.type === 'ENEMY')) x.active = false;
      P.initializeStaticGrid(e.currentMap.entities);
      for (const h of [...e.energy.heated]) h.heat = 0;
      p.heat = 0; p.health = p.maxHealth = 1000; p.shield = 0; p.maxShield = 0;
      const tr = Math.max(t.size.x, t.size.y) / 2, pr = Math.max(p.size.x, p.size.y) / 2;
      p.position.x = t.position.x - tr - pr - gp; p.position.y = t.position.y;
      p.velocity.x = 0; p.velocity.y = 0;
      (window as any).__src = t;
      e.debugHeat(t, 200);
      t.burnTimer = 6; t.burnRate = 30;   // keep it glowing
    }, gap);
    const hold = async () => {
      let peak = 0;
      for (let i = 0; i < 12; i++) {
        await engine(page, e => {
          const p = e.player, t = (window as any).__src;
          const tr = Math.max(t.size.x, t.size.y) / 2;
          // Park the ship where the setup put it (fauna and drift move it).
          p.velocity.x = 0; p.velocity.y = 0;
          void tr;
        });
        await advanceSim(page, 0.15);
        peak = Math.max(peak, await engine(page, e => e.player.heat ?? 0));
      }
      return { peak, hp: await engine(page, e => e.player.health) };
    };
    await setup(2);
    const touching = await hold();
    expect(touching.peak, 'a hull touching a hot plate heats up').toBeGreaterThan(0.1);
    expect(touching.hp, 'and burns').toBeLessThan(1000);
    await setup(45);
    const near = await hold();
    expect(near.peak, 'at a distance, with nothing touching, radiant heat still reaches it').toBeGreaterThan(0.01);
    expect(near.peak).toBeLessThan(touching.peak);
    watch.assertClean();
  });

  test('ELECTRIC: a charged tile jumps to a ship close by — an enemy or the player — and hurts it', async ({ page }) => {
    // User call: electrified tiles and shards jump to ships.  An arc leaves a
    // conductor CHARGED; while charged it arcs to the nearest hull in reach.
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    // An arc through a metal plate leaves it charged.
    const charged = await engine(page, e => {
      const p = e.player, P: any = e.physics;
      const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === 'metal-tile' && x.mass === Infinity);
      for (const x of e.currentMap.entities) if (x !== t && (x.type === 'STRUCTURE' || x.type === 'ENEMY')) x.active = false;
      P.initializeStaticGrid(e.currentMap.entities);
      (window as any).__t = t;
      p.position.x = t.position.x - 150; p.position.y = t.position.y;
      p.velocity.x = 0; p.velocity.y = 0;
      p.currentWeapon = 'beam+electric'; p.weaponCooldown = 0;
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: t.position.x, y: t.position.y }, undefined, false);
      return true;
    });
    void charged;
    await page.waitForTimeout(250);
    const c = await engine(page, e => {
      const t = (window as any).__t;
      return { until: (t.energizedUntil ?? 0) - e.simClock, charge: t.charge ?? 0,
               tracked: e.energy.energized.includes(t) };
    });
    expect(c.tracked, 'the arc left the plate charged').toBe(true);
    expect(c.charge).toBeGreaterThan(0.4);

    const jump = (who: 'enemy' | 'player', gap: number) => engine(page, (e, a: any) => {
      const p = e.player, t = (window as any).__t;
      const W = e.currentMap.width;
      e.energy.beam = null;
      // Charge the plate by hand so the claim is the JUMP, not the chain.
      t.charge = 8; t.energizedUntil = e.simClock + 5;
      if (!t.energizedTracked) { t.energizedTracked = true; e.energy.energized.push(t); }
      const tr = Math.max(t.size.x, t.size.y) / 2;
      let hull: any;
      if (a.who === 'enemy') {
        p.position.x = (t.position.x + 900) % W; p.position.y = t.position.y;
        hull = e.waves.spawnAt('RAMMER_1', { x: t.position.x, y: t.position.y }, e.waveContext(), false);
        hull.maxSpeed = 0; hull.health = hull.maxHealth = 1e6; hull.shield = 0; hull.maxShield = 0;
      } else {
        hull = p;
        p.health = p.maxHealth = 1000; p.shield = 0; p.maxShield = 0;
      }
      const hr = Math.max(hull.size.x, hull.size.y) / 2;
      hull.position.x = t.position.x - tr - hr - a.gap; hull.position.y = t.position.y;
      hull.velocity.x = 0; hull.velocity.y = 0;
      const hp0 = hull.health;
      for (let i = 0; i < 60; i++) {
        hull.position.x = t.position.x - tr - hr - a.gap; hull.position.y = t.position.y;
        hull.velocity.x = 0; hull.velocity.y = 0;
        e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120);
      }
      const lost = hp0 - hull.health;
      if (a.who === 'enemy') hull.active = false;
      return { lost, charge: t.charge ?? 0 };
    }, { who, gap });

    const enemy = await jump('enemy', 10);
    expect(enemy.lost, 'the charge jumped to an enemy beside it').toBeGreaterThan(1);
    const player = await jump('player', 10);
    expect(player.lost, 'and to the player beside it').toBeGreaterThan(1);
    const far = await jump('player', 200);
    expect(far.lost, 'but not across open space').toBe(0);
    watch.assertClean();
  });

  test('ENERGY DAMAGE SHOWS: a shock crackles on the hull and lights the HUD bolt; a burn sheds embers and lights the flame', async ({ page }) => {
    // User call: electric and heat damage need a visual and a felt read on
    // what they hit, and a HUD flame / bolt while the player is taking them.
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    // A charged plate beside the ship: the jump shocks the PLAYER.
    const setup = () => engine(page, e => {
      const p = e.player, P: any = e.physics;
      const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === 'metal-tile' && x.mass === Infinity);
      for (const x of e.currentMap.entities) if (x !== t && (x.type === 'STRUCTURE' || x.type === 'ENEMY')) x.active = false;
      P.initializeStaticGrid(e.currentMap.entities);
      p.health = p.maxHealth = 5000; p.shield = 0; p.maxShield = 0;
      t.charge = 50; t.energizedUntil = e.simClock + 30;
      if (!t.energizedTracked) { t.energizedTracked = true; e.energy.energized.push(t); }
      const tr = Math.max(t.size.x, t.size.y) / 2, hr = Math.max(p.size.x, p.size.y) / 2;
      p.position.x = t.position.x - tr - hr - 10; p.position.y = t.position.y;
      p.velocity.x = 0; p.velocity.y = 0;
      (window as any).__t = t;
    });
    await setup();
    const shock = await engine(page, e => {
      const p = e.player;
      for (let i = 0; i < 40 && !((p.shockTimer ?? 0) > 0); i++) {
        e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120);
      }
      return { timer: p.shockTimer ?? 0, listed: e.energy.shocked.includes(p) };
    });
    expect(shock.timer, 'the jump left the ship shocked').toBeGreaterThan(0);
    expect(shock.listed, 'and crackling on screen').toBe(true);
    // With the live loop running, the HUD shows the bolt.
    await setup();
    await expect(page.getByTestId('hud-shock')).toBeVisible({ timeout: 4000 });

    // A BURN: heat the ship's hull; it sheds embers and the HUD shows the flame.
    const burn = await engine(page, e => {
      const p = e.player;
      const t = (window as any).__t;
      t.charge = 0; t.energizedUntil = 0;
      p.position.x += 400;
      const before = e.currentMap.entities.filter((x: any) => x.active && x.type === 'PARTICLE').length;
      e.debugHeat(p, 6);
      for (let i = 0; i < 60; i++) { e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120); }
      const after = e.currentMap.entities.filter((x: any) => x.active && x.type === 'PARTICLE'
        && (x.color === '#ffb347' || x.color === '#ff6a2b')).length;
      e.debugHeat(p, 6);
      return { indicator: p.burnIndicator ?? 0, embers: after, before };
    });
    expect(burn.indicator, 'the burning hull reads as burning').toBeGreaterThan(0);
    expect(burn.embers, 'and sheds embers').toBeGreaterThan(0);
    await expect(page.getByTestId('hud-burn')).toBeVisible({ timeout: 4000 });
    watch.assertClean();
  });

  test('HEAT: a metal tile breaks into pieces as hot as it was', async ({ page }) => {
    // User report: metal fragments came off a glowing tile cold — a metal
    // tile breaks into ~22 grains, and dividing the heat left each ~1/22.
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    const r = await engine(page, e => {
      const P: any = e.physics;
      const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === 'metal-tile' && x.mass === Infinity);
      e.debugHeat(t, 40);
      const h = t.heat;
      const before = e.currentMap.entities.length;
      t.health = 0; P.removeStaticEntity(t); e.handleEntityDeath(t); t.active = false;
      const kids = e.currentMap.entities.slice(before).filter((x: any) => x.active && x.shardVariant === 'metal-shard');
      return { h, n: kids.length, heat: kids.map((k: any) => k.heat ?? 0) };
    });
    expect(r.h).toBeGreaterThan(0.5);
    expect(r.n, 'the tile broke into many grains').toBeGreaterThan(5);
    for (const k of r.heat) expect(k).toBeCloseTo(r.h, 6);
    watch.assertClean();
  });

  test('SEEKER: every round drops a trail of dots that fade, and outlive the round', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    const r = await engine(page, e => {
      const p = e.player, P: any = e.physics;
      for (const x of e.currentMap.entities) if (x.type === 'STRUCTURE' || x.type === 'ENEMY') x.active = false;
      P.initializeStaticGrid(e.currentMap.entities);
      p.velocity.x = 0; p.velocity.y = 0;
      p.currentWeapon = 'homing'; p.weaponCooldown = 0;
      const D = e.energy.dots;
      const t0 = e.simClock;
      const live = () => { let n = 0; for (let i = 0; i < D.born.length; i++) if (D.born[i] >= t0 && e.simClock - D.born[i] < 2.0) n++; return n; };
      const before = new Set(e.currentMap.entities.map((x: any) => x.id));
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: p.position.x + 300, y: p.position.y }, undefined, false);
      const m = e.currentMap.entities.find((x: any) => !before.has(x.id) && x.type === 'PROJECTILE');
      for (let i = 0; i < 30; i++) { e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120); }
      const flying = live();
      // Gap between consecutive dots.
      const idx: number[] = [];
      for (let i = 0; i < D.born.length; i++) if (D.born[i] >= t0) idx.push(i);
      idx.sort((a, b) => D.born[a] - D.born[b]);
      const gaps: number[] = [];
      for (let k = 1; k < idx.length; k++) gaps.push(Math.hypot(D.x[idx[k]] - D.x[idx[k - 1]], D.y[idx[k]] - D.y[idx[k - 1]]));
      m.active = false;
      for (let i = 0; i < 24; i++) { e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120); }
      const afterHit = live();
      // The trail lasts 2 s (user call): still there at 1.5 s, gone by 2.1 s.
      for (let i = 0; i < 150; i++) { e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120); }
      const lingering = live();
      for (let i = 0; i < 90; i++) { e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120); }
      return { flying, afterHit, lingering, gone: live(), gaps };
    });
    expect(r.flying, 'the round is laying dots').toBeGreaterThan(5);
    for (const g of r.gaps) { expect(g).toBeGreaterThan(8); expect(g).toBeLessThan(30); }
    expect(r.afterHit, 'they outlive the round').toBeGreaterThan(0);
    expect(r.lingering, 'they last well past a second').toBeGreaterThan(0);
    expect(r.gone, 'and fade out').toBe(0);
    watch.assertClean();
  });

  test('ELECTRIC SPREAD: a ring around the ship lasts a moment, and whatever it touches in that moment is struck', async ({ page }) => {
    // User call: the electric spread throws a short-lived ring around the
    // ship; a body the ship reaches a beat AFTER the trigger still triggers a
    // chain, while the ring lasts.
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    const run = (delay: number) => engine(page, (e, d: number) => {
      const p = e.player, P: any = e.physics;
      const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === 'metal-tile' && x.mass === Infinity);
      for (const x of e.currentMap.entities) if (x !== t && (x.type === 'STRUCTURE' || x.type === 'ENEMY')) x.active = false;
      P.initializeStaticGrid(e.currentMap.entities);
      e.energy.ring = null;
      t.energizedUntil = undefined; t.charge = undefined;
      // Far from the plate, aiming AWAY from it: the cone's forks find nothing.
      p.position.x = t.position.x - 400; p.position.y = t.position.y;
      p.velocity.x = 0; p.velocity.y = 0;
      p.currentWeapon = 'spread+electric'; p.weaponCooldown = 0;
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: p.position.x - 300, y: p.position.y }, undefined, false);
      const ringUp = e.energy.ring !== null;
      let struck = false;
      const steps = Math.round(d * 120);
      for (let i = 0; i < steps + 20; i++) {
        // A fast pass: after `d` seconds the ship arrives beside the plate.
        if (i >= steps) { p.position.x = t.position.x - 40; p.position.y = t.position.y; }
        p.velocity.x = 0; p.velocity.y = 0;
        e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120);
        if ((t.energizedUntil ?? 0) > e.simClock) struck = true;
      }
      return { ringUp, struck };
    }, delay);
    const early = await run(0.15);
    expect(early.ringUp, 'firing throws the ring').toBe(true);
    expect(early.struck, 'reaching the plate while the ring lasts strikes it').toBe(true);
    const late = await run(0.8);
    expect(late.struck, 'after the ring has gone, reaching it does nothing').toBe(false);
    watch.assertClean();
  });

  test('SEEKER: steers along a smooth curve onto its target instead of orbiting it', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    const r = await engine(page, e => {
      const p = e.player, P: any = e.physics;
      for (const x of e.currentMap.entities) if (x.type === 'STRUCTURE' || x.type === 'ENEMY') x.active = false;
      P.initializeStaticGrid(e.currentMap.entities);
      p.velocity.x = 0; p.velocity.y = 0;
      const foe = e.waves.spawnAt('RAMMER_1', { x: p.position.x + 220, y: p.position.y }, e.waveContext(), false);
      foe.position.x = p.position.x + 220; foe.position.y = p.position.y;
      foe.maxSpeed = 0; foe.health = foe.maxHealth = 1e6; foe.shield = 0; foe.maxShield = 0;
      p.currentWeapon = 'homing+kinetic'; p.weaponCooldown = 0;
      const before = new Set(e.currentMap.entities.map((x: any) => x.id));
      // Fired straight UP, with the target off to the side.
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: p.position.x, y: p.position.y - 300 }, undefined, false);
      const m = e.currentMap.entities.find((x: any) => !before.has(x.id) && x.type === 'PROJECTILE');
      let path = 0, hitAt = -1, lx = m.position.x, ly = m.position.y, maxTurn = 0, lastA = Math.atan2(m.velocity.y, m.velocity.x);
      const hp0 = foe.health;
      for (let i = 0; i < 240 && hitAt < 0; i++) {
        foe.velocity.x = 0; foe.velocity.y = 0;
        e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120);
        path += Math.hypot(m.position.x - lx, m.position.y - ly); lx = m.position.x; ly = m.position.y;
        const a = Math.atan2(m.velocity.y, m.velocity.x);
        let da = Math.abs(a - lastA); if (da > Math.PI) da = 2 * Math.PI - da;
        maxTurn = Math.max(maxTurn, da); lastA = a;
        if (foe.health < hp0) hitAt = (i + 1) / 120;
      }
      foe.active = false;
      return { hitAt, path, straight: 220, maxTurn };
    });
    expect(r.hitAt, 'it reaches the target').toBeGreaterThan(0);
    expect(r.path, 'by a short curve, not a loop around it').toBeLessThan(r.straight * 2.2);
    watch.assertClean();
  });

  test('FLAMER: every pellet curls; a plain spread flies straight', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    const turn = (key: string) => engine(page, (e, k: string) => {
      const p = e.player, P: any = e.physics;
      for (const x of e.currentMap.entities) if (x.type === 'STRUCTURE' || x.type === 'ENEMY') x.active = false;
      P.initializeStaticGrid(e.currentMap.entities);
      p.velocity.x = 0; p.velocity.y = 0;
      p.currentWeapon = k; p.weaponCooldown = 0;
      const before = new Set(e.currentMap.entities.map((x: any) => x.id));
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: p.position.x + 300, y: p.position.y }, undefined, false);
      const shots = e.currentMap.entities.filter((x: any) => !before.has(x.id) && x.type === 'PROJECTILE');
      const a0 = shots.map((x: any) => Math.atan2(x.velocity.y, x.velocity.x));
      // Total TURNING (Σ|dθ|): a curl that weaves back still curls.
      const turned = shots.map(() => 0), last = a0.slice();
      for (let i = 0; i < 24; i++) {
        e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120);
        shots.forEach((x: any, j: number) => {
          if (!x.active) return;
          const a = Math.atan2(x.velocity.y, x.velocity.x);
          let d = Math.abs(a - last[j]); if (d > Math.PI) d = 2 * Math.PI - d;
          turned[j] += d; last[j] = a;
        });
      }
      return turned;
    }, key);
    const flame = await turn('spread+thermal');
    const plain = await turn('spread');
    expect(flame.length).toBeGreaterThan(2);
    expect(Math.min(...flame), 'every flame pellet has turned').toBeGreaterThan(0.2);
    expect(Math.max(...plain), 'a plain pellet has not').toBeLessThan(0.03);
    watch.assertClean();
  });

  test('LIGHT: a beam keeps its full strength through glass and off a mirror, and its reach is the weapon range', async ({ page }) => {
    const watch = await boot(page);
    const lane = async (map: string, variant: string) => {
      await onMap(page, map);
      await engine(page, (e, v: string) => {
        const p = e.player, P: any = e.physics;
        const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === v && x.mass === Infinity);
        for (const x of e.currentMap.entities) if (x !== t && (x.type === 'STRUCTURE' || x.type === 'ENEMY')) x.active = false;
        t.rotation = 0; t.health = t.maxHealth = 1e9;
        P.initializeStaticGrid(e.currentMap.entities);
        p.position.x = t.position.x - 120; p.position.y = t.position.y;
        p.velocity.x = 0; p.velocity.y = 0; p.rotation = 0;
        p.currentWeapon = 'beam'; p.weaponCooldown = 0;
        (window as any).__light = null;
        e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: t.position.x, y: t.position.y }, undefined, false);
      }, variant);
      await page.waitForFunction(() => {
        const e = (window as any).__omniEngine, b = e.energy.beam;
        // The blade EXTENDS over 0.1 s: judge the path once it is fully out.
        if (!(b && b.hit && b.light.nSeg > 0 && !b.retracting && b.reach >= b.config.beamRange)) return false;
        (window as any).__light = { segs: b.light.segs.slice(0, b.light.nSeg * 5), n: b.light.nSeg,
                                    range: b.config.beamRange };
        return true;
      }, null, { timeout: 5000, polling: 'raf' });
      return engine(page, () => {
        const L = (window as any).__light;
        // The MAIN path is every segment still at full strength: a split
        // branch leaves at a share (< 1), so the full-strength ones are the
        // beam itself however the trace interleaved them.
        let len = 0, full = 0;
        for (let k = 0; k < L.n; k++) {
          const o = k * 5;
          if (L.segs[o + 4] < 0.999) continue;
          full++;
          len += Math.hypot(L.segs[o + 2] - L.segs[o], L.segs[o + 3] - L.segs[o + 1]);
        }
        return { len, full, range: L.range };
      });
    };
    const glass = await lane('GLASS_FIELD', 'glass-tile');
    expect(glass.full, 'into, through and out of the pane at full strength').toBeGreaterThanOrEqual(3);
    expect(glass.len, 'and out to the weapon range').toBeGreaterThan(glass.range * 0.9);
    expect(glass.len).toBeLessThan(glass.range * 1.05);
    const metal = await lane('METAL_FIELD', 'metal-tile');
    expect(metal.full, 'to the mirror and back off it at full strength').toBeGreaterThanOrEqual(2);
    expect(metal.len, 'and the bounce spends range, nothing else').toBeGreaterThan(metal.range * 0.9);
    watch.assertClean();
  });

  test('BEAM: a blade that extends from the muzzle, stays out while held, follows the aim and retracts', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    const r = await engine(page, e => {
      const p = e.player, P: any = e.physics, I: any = e.input;
      for (const x of e.currentMap.entities) if (x.type === 'STRUCTURE' || x.type === 'ENEMY') x.active = false;
      P.initializeStaticGrid(e.currentMap.entities);
      p.velocity.x = 0; p.velocity.y = 0;
      p.currentWeapon = 'beam'; p.weaponCooldown = 0;
      // Aim straight RIGHT, then hold the trigger.
      I.mousePosition = { x: window.innerWidth / 2 + 200, y: window.innerHeight / 2 };
      let held = true;
      const real = I.isFireHeld;
      I.isFireHeld = () => held;
      const step = () => { e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120); };
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: p.position.x + 300, y: p.position.y }, undefined, false);
      const range = e.energy.beam.config.beamRange;
      const reaches: number[] = [];
      for (let i = 0; i < 14; i++) { step(); reaches.push(e.energy.beam.reach); }
      // Held for a second — long past the pull's own 0.3 s.
      for (let i = 0; i < 120; i++) step();
      const heldOut = !!e.energy.beam && !e.energy.beam.retracting;
      // Swing the aim DOWN while holding: the blade follows.
      I.mousePosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 + 200 };
      for (let i = 0; i < 4; i++) step();
      const angle = e.energy.beam.angle;
      // Let go: it retracts into the muzzle and is gone in about 0.1 s.
      held = false;
      const back: number[] = [];
      let goneAt = -1;
      for (let i = 0; i < 30 && goneAt < 0; i++) {
        step();
        if (!e.energy.beam) goneAt = (i + 1) / 120; else back.push(e.energy.beam.reach);
      }
      I.isFireHeld = real;
      return { reaches, range, heldOut, angle, back, goneAt };
    });
    expect(r.reaches[0], 'it starts at the muzzle').toBeLessThan(r.range * 0.2);
    for (let i = 1; i < r.reaches.length; i++) expect(r.reaches[i]).toBeGreaterThanOrEqual(r.reaches[i - 1]);
    expect(r.reaches[12], 'and is fully out within ~0.1 s').toBeCloseTo(r.range, 3);
    expect(r.heldOut, 'held, it stays out past the pull').toBe(true);
    expect(r.angle, 'and follows the aim').toBeCloseTo(Math.PI / 2, 2);
    for (let i = 1; i < r.back.length; i++) expect(r.back[i]).toBeLessThan(r.back[i - 1]);
    expect(r.goneAt, 'released, it retracts and is gone').toBeGreaterThan(0);
    expect(r.goneAt).toBeLessThanOrEqual(0.11);
    watch.assertClean();
  });

  test('LIGHT: kinetic pulses fly parallel, from random points across a narrow lane', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    const r = await engine(page, e => {
      const p = e.player, P: any = e.physics;
      for (const x of e.currentMap.entities) if (x.type === 'STRUCTURE' || x.type === 'ENEMY') x.active = false;
      P.initializeStaticGrid(e.currentMap.entities);
      p.velocity.x = 0; p.velocity.y = 0;
      p.currentWeapon = 'beam+kinetic'; p.weaponCooldown = 0;
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: p.position.x + 300, y: p.position.y }, undefined, false);
      // A pulse's first step covers speed x dt (12.5 units), so one that has
      // travelled no further than that left the muzzle THIS step — which
      // counts launches even though the pool reuses pulse objects.
      const seen: { y: number; ux: number; uy: number; length: number }[] = [];
      for (let i = 0; i < 50; i++) {
        e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120);
        for (const q of e.energy.pulses) if (q.alive && q.travelled <= 13) seen.push({ y: q.y - p.position.y, ux: q.ux, uy: q.uy, length: q.length });
      }
      return seen;
    });
    // A tap: the guaranteed 8 pulses, one every third step, each 13 long.
    expect(r.length, 'the whole burst left').toBe(8);
    for (const q of r) expect(q.length).toBeCloseTo(13, 3);
    const ys = r.map(q => q.y);
    // ±1.8 either side of the aim line (user call: tighter than the old ±3),
    // not a sweep in firing order: some pair of consecutive pulses steps BACK
    // across the lane.
    for (const y of ys) expect(Math.abs(y)).toBeLessThanOrEqual(1.801);
    expect(Math.max(...ys) - Math.min(...ys), 'from points spread across the lane').toBeGreaterThan(0.9);
    for (let i = 1; i < ys.length; i++) expect(Math.abs(ys[i] - ys[i - 1]), 'two in a row never overlap').toBeGreaterThan(0.3);
    for (const q of r) { expect(q.ux).toBeCloseTo(1, 3); expect(q.uy).toBeCloseTo(0, 3); }
    watch.assertClean();
  });

  test('LIGHT: kinetic pulses pass THROUGH glass and split in it, like the base beam', async ({ page }) => {
    // User report: the pulses stopped in glass.  A pulse flies only one step's
    // length per trace, so a pulse that ran out of length inside a pane was
    // dropped; it now carries on through the body from where it reached.
    const watch = await boot(page);
    await onMap(page, 'GLASS_FIELD');
    const r = await engine(page, e => {
      const p = e.player, P: any = e.physics;
      const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === 'glass-tile' && x.mass === Infinity);
      for (const x of e.currentMap.entities) if (x !== t && (x.type === 'STRUCTURE' || x.type === 'ENEMY')) x.active = false;
      t.rotation = 0; t.health = t.maxHealth = 1e9;
      P.initializeStaticGrid(e.currentMap.entities);
      p.position.x = t.position.x - 150; p.position.y = t.position.y;
      p.velocity.x = 0; p.velocity.y = 0; p.rotation = 0;
      p.currentWeapon = 'beam+kinetic'; p.weaponCooldown = 0;
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: t.position.x, y: t.position.y }, undefined, false);
      const W = e.currentMap.width;
      const rel = (x: number) => { let d = x - t.position.x; return d - Math.round(d / W) * W; };
      const half = Math.max(t.size.x, t.size.y) / 2;
      let beyond = 0, inside = 0, most = 0, split = 0, deep = 0;
      for (let i = 0; i < 90; i++) {
        e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120);
        const a = e.energy.pulses.filter((q: any) => q.alive);
        most = Math.max(most, a.length);
        for (const q of a) {
          if (q.inside === t) inside++;
          if (rel(q.x) > half + 5) beyond++;
          if (q.gen === 1) split++;
          if (q.gen > 1) deep++;
        }
      }
      return { beyond, inside, most, split, deep, lit: (t.fractureEdgeFill ?? []).some((f: number) => f > 0) };
    });
    expect(r.inside, 'pulses carried on INSIDE the pane between steps').toBeGreaterThan(0);
    expect(r.beyond, 'and came out the far side').toBeGreaterThan(0);
    expect(r.split, 'the pane split pulses off').toBeGreaterThan(0);
    // User call: far too many beams came out of glass.  A split branch never
    // splits again, and the pool never holds more than a handful at once.
    expect(r.deep, 'a split branch never splits again').toBe(0);
    expect(r.most, 'a modest number of beams in flight').toBeLessThanOrEqual(16);
    expect(r.lit, 'and left a little on the boundaries they crossed').toBe(true);
    watch.assertClean();
  });

  test('LIGHT: held, the kinetic beam is a stream of short beams joined by a line trail that follows the aim', async ({ page }) => {
    // User calls: a line of short beams flowing for as long as the trigger is
    // held; then FEWER of them, with a line trail in the beam's colour.
    const watch = await boot(page);
    await onMap(page, 'METAL_FIELD');
    const r = await engine(page, e => {
      const p = e.player, P: any = e.physics, I: any = e.input;
      for (const x of e.currentMap.entities) if (x.type === 'STRUCTURE' || x.type === 'ENEMY') x.active = false;
      P.initializeStaticGrid(e.currentMap.entities);
      p.velocity.x = 0; p.velocity.y = 0; p.rotation = 0;
      p.currentWeapon = 'beam+kinetic'; p.weaponCooldown = 0;
      let held = true;
      I.mousePosition = { x: window.innerWidth / 2 + 200, y: window.innerHeight / 2 };
      const orig = I.isFireHeld;
      I.isFireHeld = () => held;
      const step = () => { e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120); };
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: p.position.x + 300, y: p.position.y }, undefined, false);
      // Well past the 8-pulse tap: still flowing.
      for (let i = 0; i < 60; i++) step();
      const flowing = e.energy.burst !== null;
      // The pulses: heads along the aim, and the gaps between them.
      const W = e.currentMap.width;
      const rel = (x: number) => { let d = x - p.position.x; return d - Math.round(d / W) * W; };
      const xs = e.energy.pulses.filter((q: any) => q.alive).map((q: any) => rel(q.x)).sort((a: number, b: number) => a - b);
      const gaps: number[] = [];
      for (let k = 1; k < xs.length; k++) gaps.push(xs[k] - xs[k - 1]);
      const len = e.energy.pulses.find((q: any) => q.alive)?.length ?? 0;
      // The trail: every live segment, as an interval along the aim.  Their
      // union from the muzzle to the lead pulse must have no hole in it.
      const T = e.energy.pulseTrail, now = e.simClock;
      const iv: [number, number][] = [];
      let colours = new Set<string>();
      for (let i = 0; i < T.born.length; i++) {
        if (now - T.born[i] >= 1.5 || now < T.born[i]) continue;
        const a = rel(T.x0[i]), b = rel(T.x1[i]);
        iv.push([Math.min(a, b), Math.max(a, b)]);
        colours.add(T.color[i]);
      }
      iv.sort((a, b) => a[0] - b[0]);
      let hole = 0, reach = iv.length ? iv[0][1] : 0;
      for (const [a, b] of iv) { if (a > reach + 0.5) hole = Math.max(hole, a - reach); reach = Math.max(reach, b); }
      const lead = xs[xs.length - 1];
      // Aim down: the ship turns and the stream follows.
      I.mousePosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 + 200 };
      const fresh: any[] = [];
      for (let i = 0; i < 40; i++) {
        step();
        // A pulse leaves every third step; collect the launches of the last few.
        if (i >= 34) for (const q of e.energy.pulses) if (q.alive && q.gen === 0 && q.travelled <= 13) fresh.push({ uy: q.uy });
      }
      const followed = fresh.length > 0 && fresh.every((q: any) => q.uy > 0.99);
      // Let go: the stream stops, and the trail has faded shortly after.
      held = false;
      for (let i = 0; i < 4; i++) step();
      const stopped = e.energy.burst === null;
      // Pulses in flight lay trail for up to ~0.3 s after release, then it
      // lives its 1.5 s.
      for (let i = 0; i < 260; i++) step();
      let left = 0;
      for (let i = 0; i < T.born.length; i++) if (e.simClock - T.born[i] < 1.5) left++;
      I.isFireHeld = orig;
      return { flowing, gaps, n: xs.length, len, segs: iv.length, hole, reach, lead,
               colours: [...colours], beam: e.energy.pulses[0]?.color, followed, stopped, left };
    });
    expect(r.flowing, 'held past the tap, the stream keeps flowing').toBe(true);
    // Fewer, spaced beams: one every third step, ~37 apart against 13 long.
    // 420 range at 1500 u/s is 0.28 s of flight, so ~11 alive.
    expect(r.n, 'a line of pulses in flight').toBeGreaterThanOrEqual(6);
    expect(r.n, 'but not a crowd of them').toBeLessThanOrEqual(14);
    for (const g of r.gaps) expect(g).toBeGreaterThan(r.len);
    // The trail joins them into one line, in the beam's colour.
    expect(r.segs, 'a trail behind the pulses').toBeGreaterThan(10);
    expect(r.hole, 'with no hole along it').toBe(0);
    expect(r.reach, 'reaching the lead pulse').toBeGreaterThanOrEqual(r.lead - 1);
    expect(r.colours, 'in the beam colour').toEqual([r.beam]);
    expect(r.followed, 'the stream follows the aim').toBe(true);
    expect(r.stopped, 'and stops when released').toBe(true);
    expect(r.left, 'and its trail fades out').toBe(0);
    watch.assertClean();
  });

  test('HEAT: a break keeps the TEMPERATURE in every piece, and the energy — heat × capacity × material — is conserved', async ({ page }) => {
    // User calls: a break conserves heat energy (copying heat onto pieces
    // whose capacity did not scale with their size multiplied it, and fed
    // the plastic chain reaction), AND a piece is as hot as what it came off
    // (dividing the heat itself left a 22-grain metal tile's fragments cold).
    // Capacity scales with how much material a body is, so both hold.
    const watch = await boot(page);
    await onMap(page, 'ROCK_FIELD');
    const r = await engine(page, e => {
      const P: any = e.physics;
      const area = (x: any) => {
        const p = x.polygonPoints; let a = 0;
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j].x * p[i].y - p[i].x * p[j].y;
        return Math.abs(a) / 2;
      };
      const tiles = e.currentMap.entities.filter((x: any) => x.active
        && x.shardVariant === 'rock-tile' && x.mass === Infinity).slice(0, 2);
      const [a, b] = tiles;
      // A DETACH: heat a tile and chip one grain off it.
      e.debugHeat(a, 40);
      const heatA = a.heat;
      let before = e.currentMap.entities.length;
      let areaBefore = 0;
      for (let i = 0; i < 20 && e.currentMap.entities.length === before; i++) {
        areaBefore = area(a);
        e.chipStructureAt(a, { x: a.position.x + 6, y: a.position.y }, 6);
      }
      const chips = e.currentMap.entities.slice(before)
        .filter((x: any) => x.shardVariant === 'rock-shard');
      // A body's heat capacity scales with its material (area), so what a
      // break must conserve is Σ heat × the material's capacity × area.
      const E = (window as any).__omniEnergy;
      const energyOf = (x: any) => (x.heat ?? 0) * E.heatCapacityOf(E.materialOf(x)) * area(x);
      const detach = {
        before: heatA * E.heatCapacityOf('rock') * areaBefore,
        after: energyOf(a) + chips.reduce((s: number, c: any) => s + energyOf(c), 0),
        tileAfter: a.heat, chipHeat: chips.map((c: any) => c.heat ?? 0),
        tracked: chips.every((c: any) => c.heatTracked === true),
      };
      // A SHATTER: heat a tile and break it outright.
      e.debugHeat(b, 40);
      const heatB = b.heat;
      const areaB = area(b);
      before = e.currentMap.entities.length;
      b.health = 0; P.removeStaticEntity(b); e.handleEntityDeath(b); b.active = false;
      const all = e.currentMap.entities.slice(before).filter((x: any) => x.active);
      const kids = all.filter((x: any) => x.shardVariant === 'rock-shard');
      return {
        heatA, detach, heatB, n: kids.length,
        shatterBefore: heatB * E.heatCapacityOf('rock') * areaB,
        shatterAfter: kids.reduce((s: number, c: any) => s + energyOf(c), 0),
        kidHeat: kids.map((c: any) => c.heat ?? 0),
        dustHeat: all.filter((x: any) => x.shardVariant === 'nebula-shard').map((c: any) => c.heat ?? 0),
      };
    });
    expect(r.heatA).toBeGreaterThan(0.1);
    expect(r.detach.chipHeat.length, 'a grain came off').toBeGreaterThan(0);
    expect(r.detach.tracked, 'the warm grain joined the heated set, so it will cool').toBe(true);
    // A detach: the tile and the grain it lost are both still at its temperature,
    // and the energy is conserved (the break's own area check holds it to ~2%).
    expect(r.detach.tileAfter, 'the tile keeps its temperature').toBeCloseTo(r.heatA, 6);
    for (const h of r.detach.chipHeat) expect(h, 'the grain comes off as hot as the tile').toBeCloseTo(r.heatA, 6);
    expect(r.detach.after / r.detach.before).toBeGreaterThan(0.97);
    expect(r.detach.after / r.detach.before).toBeLessThan(1.03);
    expect(r.n, 'the tile shattered').toBeGreaterThan(1);
    // A shatter: every piece at the tile's temperature, the energy carried by
    // the pieces the tile's own (the cells tile the parent), and the dust cold.
    for (const h of r.kidHeat) expect(h).toBeCloseTo(r.heatB, 6);
    expect(r.shatterAfter / r.shatterBefore).toBeGreaterThan(0.9);
    expect(r.shatterAfter / r.shatterBefore).toBeLessThan(1.05);
    for (const h of r.dustHeat) expect(h).toBe(0);
    watch.assertClean();
  });

  test('HEAT: incendiary fire on plastic does not chain-react', async ({ page }) => {
    // The user report this pins: a thermal cannon on plastic tiles broke them
    // into an enormous number of hot pieces that burned, broke and re-heated
    // their pieces in turn.  With heat divided on every break the cascade dies
    // out: measured ~47 plastic-shard deaths over six seconds of fire, against
    // ~1000 when every piece copied its parent's heat.
    const watch = await boot(page);
    await onMap(page, 'PLASTIC_FIELD');
    await engine(page, e => {
      const w: any = window; w.__deaths = 0;
      const orig = e.handleEntityDeath;
      e.handleEntityDeath = (x: any, o: any) => { if (x.shardVariant === 'plastic-shard') w.__deaths++; return orig(x, o); };
      e.player.health = e.player.maxHealth = 1e9;
    });
    for (let s = 0; s < 4; s++) {
      await engine(page, e => {
        const p = e.player;
        const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === 'plastic-tile');
        p.position.x = t.position.x - 160; p.position.y = t.position.y;
        p.velocity.x = 0; p.velocity.y = 0;
        for (let i = 0; i < 3; i++) {
          p.currentWeapon = 'cannon+thermal'; p.weaponCooldown = 0;
          e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: t.position.x, y: t.position.y + (i - 1) * 40 }, undefined, false);
        }
      });
      await advanceSim(page, 1);
    }
    await advanceSim(page, 2);
    const deaths = await engine(page, () => (window as any).__deaths);
    expect(deaths, 'hot plastic pieces do not burn, break and re-ignite without end').toBeLessThan(250);
    watch.assertClean();
  });

  test('HEAT: glass that failed from heat hands on its heat, and its pieces do not fail again', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'GLASS_FIELD');
    const n = await engine(page, e => {
      const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === 'glass-tile' && x.mass === Infinity);
      const before = e.currentMap.entities.length;
      e.debugHeat(t, 400);            // past critical: the pane fails
      const kids = e.currentMap.entities.slice(before).filter((x: any) => x.shardVariant === 'glass-shard');
      (window as any).__kids = kids;
      return { failed: !t.active, n: kids.length, heat: kids.map((k: any) => k.heat ?? 0) };
    });
    expect(n.failed, 'the pane failed').toBe(true);
    expect(n.n).toBeGreaterThan(0);
    expect(Math.max(...n.heat), 'the pieces are warm').toBeGreaterThan(0.05);
    for (const h of n.heat) expect(h).toBeLessThan(1);
    await page.waitForTimeout(1500);
    const alive = await engine(page, () => (window as any).__kids.filter((k: any) => k.active).length);
    expect(alive, 'no cascade: the warm pieces are still there').toBe(n.n);
    watch.assertClean();
  });

  test('DBG: weapon modules add, remove and clear without a shop, and outfit anywhere is a toggle', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'GLASS_FIELD');
    const r = await engine(page, e => {
      const cat = () => e.weaponModuleSnapshot();
      const ten = cat().map((m: any) => m.id);
      // Add a second delivery and an energy modifier: both land on the flower.
      e.debugAddWeaponModule('dlv_beam');
      e.debugAddWeaponModule('nrg_electric');
      const afterAdd = [...e.equippedWeapons];
      // A third gun is over the 2-gun cap, so it goes to cargo.
      e.debugAddWeaponModule('dlv_cannon');
      const cannon = cat().find((m: any) => m.id === 'dlv_cannon');
      // Remove takes the installed copy first.
      e.debugRemoveWeaponModule('nrg_electric');
      const afterRemove = [...e.equippedWeapons];
      // Away from any drydock, installing is refused... until the toggle.
      const inv = e.inventory.indexOf('dlv_cannon');
      const beamAt = e.weaponSlots.indexOf('dlv_beam');
      const refused = e.moveModule({ area: 'weapon', idx: beamAt }, { area: 'inventory', idx: e.inventory.indexOf(null) });
      e.debugToggleOutfitAnywhere();
      const freed = e.moveModule({ area: 'weapon', idx: beamAt }, { area: 'inventory', idx: e.inventory.indexOf(null) });
      const mounted = e.moveModule({ area: 'inventory', idx: inv }, { area: 'weapon', idx: beamAt });
      const afterMove = [...e.equippedWeapons];
      e.debugToggleOutfitAnywhere();
      // Clear strips every delivery and modifier; weaponless flight is legal.
      e.debugClearWeaponModules();
      const left = cat().reduce((n: number, m: any) => n + m.installed + m.stored, 0);
      return { ten, afterAdd, cannon, afterRemove, refused, freed, mounted, afterMove,
               left, current: e.player.currentWeapon ?? null };
    });
    expect([...r.ten].sort()).toEqual(['dlv_beam', 'dlv_cannon', 'dlv_homing', 'dlv_projectile', 'dlv_spread',
      'nrg_electric', 'nrg_kinetic', 'nrg_thermal']);
    expect(r.afterAdd.some((k: string | null) => k?.includes('+electric'))).toBe(true);
    expect(r.afterAdd.some((k: string | null) => k?.startsWith('beam'))).toBe(true);
    expect(r.cannon).toMatchObject({ installed: 0, stored: 1 });
    expect(r.afterRemove.some((k: string | null) => k?.includes('+electric'))).toBe(false);
    expect(r.refused, 'no drydock, no toggle: the flower stays committed').toBe(false);
    expect(r.freed).toBe(true);
    expect(r.mounted).toBe(true);
    expect(r.afterMove).toContain('cannon');
    expect(r.left).toBe(0);
    expect(r.current).toBeNull();
    watch.assertClean();
  });
});
