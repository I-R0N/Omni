/** ENERGY MODULES — delivery × energy × material.
 *
 *  Weapons are a DELIVERY module (projectile / beam / spread / homing /
 *  radial) plus an optional ENERGY MODIFIER (kinetic / electric / thermal /
 *  magnetic / explosive), and what they deliver is answered by the MATERIAL
 *  it lands in.  Two halves, two kinds of test:
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
import { boot, engine, quietScene, startRun, waitForStats } from './helpers';

const DELIVERIES = ['projectile', 'beam', 'spread', 'homing', 'radial'];
const ENERGIES = ['kinetic', 'electric', 'thermal', 'magnetic', 'explosive'];
/** The retired Blaster: a 4 bite every 0.14 s. */
const OLD_BASE_DPS = 4 / 0.14;

async function onMap(page: any, map: string) {
  await startRun(page, map);
  await waitForStats(page,
    new Function('s', `return s.currentMapType === ${JSON.stringify(map)}`) as any, map);
  await quietScene(page);
}

test.describe('the weapon module table', () => {
  test('all 30 weapons exist, and every bare delivery is weaker than the old base', async ({ page }) => {
    const watch = await boot(page);
    const r = await page.evaluate(([ds, es]) => {
      const E = (window as any).__omniEnergy;
      const out: any = { missing: [], bare: {}, keys: Object.keys(E.WEAPONS).length };
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
    expect(r.keys).toBe(30);
    for (const d of DELIVERIES) {
      // ~60% of the old base, and clearly below it.
      expect(r.bare[d], d).toBeLessThan(OLD_BASE_DPS * 0.7);
      expect(r.bare[d], d).toBeGreaterThan(OLD_BASE_DPS * 0.5);
    }
    watch.assertClean();
  });

  test('a modifier changes WHAT a delivery emits, not just how much', async ({ page }) => {
    await boot(page);
    const sigs = await page.evaluate(([ds, es]) => {
      const E = (window as any).__omniEnergy;
      // The payload SHAPE: which energy channels a weapon carries.
      const shape = (c: any) => [
        c.heat ? 'heat' : '', c.electric ? 'electric' : '', c.magnetic ? 'magnetic' : '',
        c.explosionRadius ? 'blast' : '', c.damage > 0 ? 'bite' : '',
      ].filter(Boolean).join('|');
      const out: Record<string, string[]> = {};
      for (const d of ds) out[d] = es.map((e: string) => shape(E.WEAPONS[`${d}+${e}`]));
      return out;
    }, [DELIVERIES, ENERGIES]);
    for (const d of DELIVERIES) {
      // Five modifiers → five distinct payload shapes on every delivery.
      expect(new Set(sigs[d]).size, `${d}: ${sigs[d].join(', ')}`).toBe(5);
    }
  });

  test('old weapon ids map onto their combination, and garbage fails safe', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const E = (window as any).__omniEnergy;
      return {
        map: ['BLASTER', 'BURST', 'SHOTGUN', 'BOUNCER', 'LIGHTNING', 'HOMING', 'CANNON', 'wpn_cannon']
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
      CANNON: 'projectile+explosive', wpn_cannon: 'projectile+explosive',
    });
    // The Cannon's combination IS the old Cannon.
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
        huge: E.clampHeat(1e9), nan: E.clampHeat(NaN), neg: E.heatGain('glass', -5),
        nanGain: E.heatGain('rock', NaN), unknown: E.responseOf('unobtanium').conductivity,
        coldScale: E.mechanicalScale('metal', 0), hotMetal: E.mechanicalScale('metal', 1),
        hotRock: E.mechanicalScale('rock', 1), hotHuge: E.mechanicalScale('metal', 1e9),
      };
    });
    expect(r.first).toBeGreaterThan(0);
    expect(r.cooledTo).toBe(0);                  // cold bodies leave the active set
    expect(r.steps).toBeLessThan(120 * 60);      // within a minute of sim time
    expect(r.huge).toBeLessThanOrEqual(2.5);
    expect(r.nan).toBe(0);
    expect(r.neg).toBe(0);
    expect(r.nanGain).toBe(0);
    expect(r.unknown).toBeGreaterThan(0);        // unknown material → the generic default
    expect(r.coldScale).toBe(1);
    expect(r.hotMetal).toBeGreaterThan(r.hotRock);
    expect(r.hotRock).toBeGreaterThan(1);
    expect(r.hotHuge).toBeLessThanOrEqual(4);
  });

  test('magnetism moves metal only, within its radius, and never without bound', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const E = (window as any).__omniEnergy;
      const body = (variant: string, extra: any = {}) => ({ shardVariant: variant, ...extra });
      return {
        metal: E.magneticSusceptibility(body('metal-shard'), 0),
        glass: E.magneticSusceptibility(body('glass-shard'), 0),
        plastic: E.magneticSusceptibility(body('plastic-shard'), 0),
        rock: E.magneticSusceptibility(body('rock-shard'), 0),
        nebulaCold: E.magneticSusceptibility(body('nebula-shard'), 10),
        nebulaEnergized: E.magneticSusceptibility(body('nebula-shard', { energizedUntil: 20 }), 10),
        beyond: E.magneticDv(10, 400, 300, 50, 1),
        huge: E.magneticDv(1e9, 0, 300, 0.001, 1),
        immovable: E.magneticDv(10, 10, 300, Infinity, 1),
        nanMass: E.magneticDv(10, 10, 300, NaN, 1),
      };
    });
    expect(r.metal).toBe(1);
    expect(r.glass).toBe(0);
    expect(r.plastic).toBe(0);
    expect(r.rock).toBe(0);
    expect(r.nebulaCold).toBe(0);
    expect(r.nebulaEnergized).toBeGreaterThan(0);
    expect(r.beyond).toBe(0);
    expect(r.huge).toBeLessThanOrEqual(14);
    expect(r.immovable).toBe(0);
    expect(r.nanMass).toBe(0);
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
      out.packets = E.explosivePackets(0, 0, 20).map((p: any) => [p.domain, p.magnitude]);
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
    // Explosive = a dominant mechanical packet plus a smaller thermal one.
    expect(r.packets.map((p: any) => p[0])).toEqual(['mechanical', 'thermal']);
    expect(r.packets[1][1]).toBeLessThan(r.packets[0][1]);
    expect(r.packets[1][1]).toBeGreaterThan(0);
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
    expect(r.keys).toBe(30);
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

  test('MAGNETIC: a pulse moves metal and leaves glass exactly where it was', async ({ page }) => {
    const watch = await boot(page);
    for (const [map, v, expectMove] of [['METAL_FIELD', 'metal', true], ['GLASS_FIELD', 'glass', false]] as const) {
      await onMap(page, map);
      // Break a cluster of tiles so there is loose debris of this material.
      await engine(page, (e, mat: string) => {
        const tiles = e.currentMap.entities.filter((x: any) => x.active && x.shardVariant === `${mat}-tile`);
        const c = tiles[0].position;
        const near = tiles.filter((t: any) => Math.hypot(t.position.x - c.x, t.position.y - c.y) < 200).slice(0, 10);
        for (const t of near) {
          t.health = 0; t.lastImpactVelocity = { x: 0, y: 0 };
          e.physics.removeStaticEntity(t); e.handleEntityDeath(t); t.active = false;
        }
        (window as any).__debrisAt = { x: c.x, y: c.y };
      }, v);
      await page.waitForTimeout(250);   // a few substeps: the grids see the debris
      const moved = await engine(page, (e, mat: string) => {
        const p = e.player, at = (window as any).__debrisAt;
        p.position.x = at.x; p.position.y = at.y + 60; p.velocity.x = 0; p.velocity.y = 0;
        const shards = e.currentMap.entities.filter((x: any) => x.active && x.shardVariant === `${mat}-shard`);
        const v0 = shards.map((s: any) => [s.velocity.x, s.velocity.y]);
        p.currentWeapon = 'radial+magnetic'; p.weaponCooldown = 0;
        e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: p.position.x + 10, y: p.position.y }, undefined, false);
        let changed = 0;
        shards.forEach((s: any, i: number) => {
          if (Math.hypot(s.velocity.x - v0[i][0], s.velocity.y - v0[i][1]) > 1e-6) changed++;
        });
        return { changed, count: e.energy.lastMagneticCount, shards: shards.length };
      }, v);
      expect(moved.shards, `${v} debris`).toBeGreaterThan(0);
      if (expectMove) {
        expect(moved.count, `${v}: ${JSON.stringify(moved)}`).toBeGreaterThan(0);
        expect(moved.count).toBeLessThanOrEqual(40);
        expect(moved.changed).toBeGreaterThan(0);
      } else {
        expect(moved.changed).toBe(0);
        expect(moved.count).toBe(0);
      }
    }
    watch.assertClean();
  });

  test('NEBULA: only an ENERGISED cloud answers to a magnet', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'NEBULA_FIELD');
    // Break a patch of cloud into drifting puffs.
    await engine(page, e => {
      const tiles = e.currentMap.entities.filter((x: any) => x.active && x.shardVariant === 'nebula-tile');
      const c = tiles[0].position;
      const near = tiles.filter((t: any) => Math.hypot(t.position.x - c.x, t.position.y - c.y) < 160).slice(0, 12);
      for (const t of near) {
        t.health = 0; t.lastImpactVelocity = { x: 0, y: 0 };
        e.physics.removeStaticEntity(t); e.handleEntityDeath(t); t.active = false;
      }
      (window as any).__cloudAt = { x: c.x, y: c.y };
    });
    // Past the puffs' fade-in (a fading body is kept out of the grid).
    await page.waitForTimeout(1500);
    // ONE evaluate: the puffs are measured where the grid already has them,
    // so nothing can merge or drift between the setup and the pulse.
    const out = await engine(page, e => {
      const p = e.player, at = (window as any).__cloudAt;
      p.position.x = at.x; p.position.y = at.y; p.velocity.x = 0; p.velocity.y = 0;
      const puffs = e.currentMap.entities.filter((x: any) => x.active && x.shardVariant === 'nebula-shard'
        && x.mergeFadeTimer === undefined
        && Math.hypot(x.position.x - at.x, x.position.y - at.y) < 250);
      const on = puffs.filter((_: any, i: number) => i % 2 === 0);
      const off = puffs.filter((_: any, i: number) => i % 2 === 1);
      for (const q of puffs) { q.velocity.x = 0; q.velocity.y = 0; q.energizedUntil = undefined; }
      for (const q of on) q.energizedUntil = e.simClock + 10;
      p.currentWeapon = 'radial+magnetic'; p.weaponCooldown = 0;
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: p.position.x + 10, y: p.position.y }, undefined, false);
      const sp = (q: any) => Math.hypot(q.velocity.x, q.velocity.y);
      return { on: on.length, off: off.length,
               onMoved: on.filter((q: any) => sp(q) > 0).length,
               offMoved: off.filter((q: any) => sp(q) > 0).length };
    });
    expect(out.on, 'energised puffs to test').toBeGreaterThan(0);
    expect(out.off, 'plain puffs to test').toBeGreaterThan(0);
    expect(out.onMoved, 'an energised cloud is steered').toBeGreaterThan(0);
    expect(out.offMoved, 'a plain cloud is untouched').toBe(0);
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
      // A thermal radial pulse centred on it.
      const p = e.player;
      p.position.x = s.position.x; p.position.y = s.position.y + 40;
      p.currentWeapon = 'radial+thermal'; p.weaponCooldown = 0;
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: s.position.x, y: s.position.y }, undefined, false);
      const after = e.shards.liveBonds.filter((b: any) => b.a === s || b.b === s).length;
      return { before, after, heat: s.heat };
    }, bonded.id);
    expect(r.before).toBeGreaterThan(0);
    expect(r.after).toBe(0);
    expect(r.heat).toBeGreaterThan(0.3);
    watch.assertClean();
  });

  test('EXPLOSIVE: a blast is impulse AND heat, and reaches a capped set', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'GLASS_FIELD');
    await engine(page, e => {
      const p = e.player;
      const t = e.currentMap.entities.find((x: any) => x.active && x.shardVariant === 'glass-tile');
      p.position.x = t.position.x - 60; p.position.y = t.position.y;
      p.currentWeapon = 'radial+explosive'; p.weaponCooldown = 0;
      e.weapons.firePlayerWeapon(e.currentMap.entities, p, { x: t.position.x, y: t.position.y }, undefined, false);
    });
    await page.waitForTimeout(200);
    const r = await engine(page, e => {
      const rings = e.currentMap.entities.filter((x: any) => x.isExplosionRing && x.validHitIds && x.validHitIds.size > 0);
      const heated = e.energy.heated.length;
      return { maxRing: Math.max(0, ...rings.map((x: any) => x.validHitIds.size)), heated };
    });
    expect(r.maxRing).toBeLessThanOrEqual(64);
    expect(r.heated).toBeGreaterThan(0);
    watch.assertClean();
  });

  test('the module path: a modifier touching a gun changes what it fires', async ({ page }) => {
    const watch = await boot(page);
    await onMap(page, 'GLASS_FIELD');
    const r = await engine(page, e => {
      const start = e.player.currentWeapon;
      e.debugGrantWeapon('beam+thermal');
      const afterBeam = [...e.equippedWeapons];
      e.debugGrantWeapon('CANNON');   // an OLD id: the projector gets the explosive modifier
      const afterCannon = [...e.equippedWeapons];
      return { start, afterBeam, afterCannon, current: e.player.currentWeapon };
    });
    expect(r.start).toBe('projectile');
    expect(r.afterBeam).toContain('beam+thermal');
    expect(r.afterBeam).toContain('projectile');    // the modifier did NOT bleed onto the other gun
    expect(r.afterCannon).toContain('projectile+explosive');
    expect(r.afterCannon).toContain('beam+thermal');
    expect(r.current).toBe('projectile+explosive');  // still firing the same gun, now modified
    watch.assertClean();
  });
});
