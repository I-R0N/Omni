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
    // The bare Cannon IS the old Plasma Cannon.
    expect(r.cannonFuse).toBe(0.42);
    expect(r.cannonDamage).toBe(18);
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
      // An insulator first: the arc lands and stops there.
      const glass = { id: 'g', active: true, shardVariant: 'glass-tile', position: { x: 0, y: 0 }, size: { x: 10, y: 10 } };
      const stopped = E.planChain(glass, { x: 0, y: 0 }, 50, caps, neighbours, dist);
      const none = E.planChain(null, { x: 5000, y: 5000 }, 50, caps, neighbours, dist);
      const nan = E.planChain(bodies[0], { x: 0, y: 0 }, NaN, caps, neighbours, dist);
      return {
        count: nodes.length, unique: new Set(ids).size,
        maxDepth: Math.max(...nodes.map((n: any) => n.depth)),
        attenuates: nodes.every((n: any) => n.depth === 0 || n.mag < 50),
        stopped: stopped.length, none: none.length, nan: nan.length,
      };
    });
    expect(r.count).toBeLessThanOrEqual(12);
    expect(r.count).toBeGreaterThan(1);
    expect(r.unique).toBe(r.count);          // nobody processed twice
    expect(r.maxDepth).toBeLessThanOrEqual(4);
    expect(r.attenuates).toBe(true);
    expect(r.stopped).toBe(1);               // glass: the arc lands, no chain
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
    // Now among INSULATORS only (a glass field, enemies cleared): no
    // conductor in range — a fizzle and nothing else, safely.
    await onMap(page, 'GLASS_FIELD');
    await engine(page, e => {
      const p = e.player;
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

  test('GAS: kinetic rounds displace a drifting cloud but never break it; an arc energises it', async ({ page }) => {
    // Nebula is a GAS (`gas: true` in the material table): it takes no damage
    // from any energy.  A kinetic round passing through a DRIFTING puff shoves
    // it along the round's travel (as a kinetic beam always has); a STATIC
    // cloud tile has nowhere to go and is left alone; an arc energises a
    // puff rather than damaging it.
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
        (window as any).__iv = setInterval(() => {
          const v = Math.hypot(s.velocity.x, s.velocity.y);
          if (v > (window as any).__max) (window as any).__max = v;
        }, 4);
      }, key);
      await page.waitForTimeout(500);
      return engine(page, e => {
        clearInterval((window as any).__iv);
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
    // A static cloud TILE: a round passes through and leaves it whole.
    const tile = await engine(page, e => {
      const p = e.player;
      const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === 'nebula-tile'
        && Math.hypot(x.position.x - p.position.x, x.position.y - p.position.y) > 400);
      (window as any).__t = t;
      p.position.x = t.position.x - 140; p.position.y = t.position.y;
      p.velocity.x = 0; p.velocity.y = 0;
      p.currentWeapon = 'projectile+kinetic'; p.weaponCooldown = 0;
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: t.position.x, y: t.position.y }, undefined, false);
      return t.id;
    });
    await page.waitForTimeout(500);
    const t = await engine(page, e => { const x = (window as any).__t; return { active: x.active, hp: x.health }; });
    expect(t.active, `tile ${tile} survives a round`).toBe(true);
    expect(t.hp).toBe(1);
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
    let bonded: any = null;
    for (let i = 0; i < 20 && !bonded; i++) {
      await page.waitForTimeout(500);
      bonded = await engine(page, e => {
        const b = e.shards.liveBonds.find((x: any) => x.a.shardVariant === 'plastic-shard' && x.a.active);
        return b ? { id: b.a.id } : null;
      });
    }
    test.skip(!bonded, 'no plastic bond formed in this run');
    const r = await engine(page, (e, id: string) => {
      const s = e.currentMap.entities.find((x: any) => x.id === id);
      const before = e.shards.liveBonds.filter((b: any) => b.a === s || b.b === s).length;
      // Heat it past its release point (the rule under test is the
      // material's `bondReleaseAt`, whatever delivers the heat).
      e.debugHeat(s, 40, { x: s.position.x - 30, y: s.position.y });
      const after = e.shards.liveBonds.filter((b: any) => b.a === s || b.b === s).length;
      return { before, after, heat: s.heat };
    }, bonded.id);
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
        p.currentWeapon = k; p.weaponCooldown = 0;
        e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: t.position.x, y: t.position.y }, undefined, false);
      }, key);
      await advanceSim(page, 0.9);   // the fuse (0.42 s) and the ring's whole life
      return engine(page, e => {
        const rings = e.currentMap.entities.filter((x: any) => x.isExplosionRing && x.validHitIds);
        const hot = e.energy.heated.filter((x: any) => (x.heat ?? 0) > 0.01).length;
        return { maxRing: Math.max(0, ...rings.map((x: any) => x.validHitIds.size)), hot };
      });
    };
    const bare = await fire('cannon');
    const hot = await fire('cannon+thermal');
    expect(bare.hot, 'a plain blast is not a fire').toBe(0);
    expect(hot.hot, 'the incendiary shell heats what it reaches').toBeGreaterThan(0);
    expect(hot.maxRing).toBeLessThanOrEqual(64);
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

  test('HEAT: a fragment is as hot as the body it broke off', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'ROCK_FIELD');
    const r = await engine(page, e => {
      const P: any = e.physics;
      const tiles = e.currentMap.entities.filter((x: any) => x.active
        && x.shardVariant === 'rock-tile' && x.mass === Infinity).slice(0, 2);
      const [a, b] = tiles;
      // A DETACH: heat a tile and chip one grain off it.
      e.debugHeat(a, 40);
      const heatA = a.heat;
      let before = e.currentMap.entities.length;
      for (let i = 0; i < 20 && e.currentMap.entities.length === before; i++) {
        e.chipStructureAt(a, { x: a.position.x + 6, y: a.position.y }, 6);
      }
      const chips = e.currentMap.entities.slice(before)
        .filter((x: any) => x.shardVariant === 'rock-shard');
      // A SHATTER: heat a tile and break it outright.
      e.debugHeat(b, 40);
      const heatB = b.heat;
      before = e.currentMap.entities.length;
      b.health = 0; P.removeStaticEntity(b); e.handleEntityDeath(b); b.active = false;
      const kids = e.currentMap.entities.slice(before)
        .filter((x: any) => x.shardVariant === 'rock-shard');
      return {
        heatA, heatB,
        chipHeat: chips.map((c: any) => c.heat ?? 0),
        chipTracked: chips.every((c: any) => c.heatTracked === true),
        kidHeat: kids.map((c: any) => c.heat ?? 0),
      };
    });
    expect(r.heatA).toBeGreaterThan(0.1);
    expect(r.chipHeat.length, 'a grain came off').toBeGreaterThan(0);
    for (const h of r.chipHeat) expect(h).toBeCloseTo(r.heatA, 5);
    expect(r.chipTracked, 'and joined the heated set, so it will cool').toBe(true);
    expect(r.kidHeat.length, 'the tile shattered').toBeGreaterThan(1);
    for (const h of r.kidHeat) expect(h).toBeCloseTo(r.heatB, 5);
    watch.assertClean();
  });

  test('HEAT: glass that failed from heat hands on heat, but its pieces do not fail again', async ({ page }) => {
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
    for (const h of n.heat) { expect(h).toBeGreaterThan(0.5); expect(h).toBeLessThan(1); }
    await page.waitForTimeout(1500);
    const alive = await engine(page, () => (window as any).__kids.filter((k: any) => k.active).length);
    expect(alive, 'no cascade: the hot pieces are still there').toBe(n.n);
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
