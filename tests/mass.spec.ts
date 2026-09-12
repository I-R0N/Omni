/** THE IMPACT DENSITY SCALE — one statement of how heavy everything is.
 *
 *  Mass used to be an IMPULSE term and nothing else, so its numbers only had
 *  to be right relative to each other inside the collision solver.  The
 *  energy model changed that: mass is half of what every impact SPENDS, so
 *  what a body weighs decides what it BREAKS — and the numbers became a
 *  balance surface that nothing made readable.
 *
 *  MEASURED before the scale existed (`perf/impact-audit.mjs` §7): the four
 *  shard ladders spanned 0.0100..0.0300 in mass per d², a coherent 3× band
 *  reading exactly as material density; enemies sat inside it; and the
 *  PLAYER sat alone at 0.2500 — 25× glass, 8× rock, twice the dragon.  A
 *  20-unit hull massing 100 was as dense as nothing else in the game.
 *
 *  The hull is MEANT to be the densest thing here (user call) — a ship is a
 *  machine, not a rock.  What this suite pins is that the figure is now
 *  DERIVED from a stated density rather than being a bare literal, that
 *  deriving it re-priced nothing, and that the DBG ladder really moves it.
 *
 *  Why these need pinning at all: every one of them is wrong in a way
 *  nothing reports.  A hull density that silently stopped feeding
 *  `player.mass` leaves a perfectly playable ship at the old constant; a
 *  shard ladder that drifted off the table changes only how hard gravel
 *  shoves; and a ladder wired to a read nobody performs reads back
 *  correctly from the panel and changes nothing on screen.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, startRun, waitForStats } from './helpers';

/** The lean loadout is what `SHIP_WEIGHT.MASS_REFERENCE` normalises onto, so
 *  a fresh run is the one state where the ship's mass is exactly the
 *  shipped constant with no outfit term on top. */
async function leanRun(page: any) {
  await startRun(page, 'POCKET');
  await waitForStats(page, s => s.currentMapType === 'POCKET', 'the pocket map');
}

test.describe('mass is stated as a density, on one scale', () => {
  test('the shipped hull is exactly the table, and the lean ship is the scale',
    async ({ page }) => {
      const watch = await boot(page);
      await leanRun(page);

      const r = await engine(page, (e: any) => {
        const M = (window as any).__omniMass;
        return {
          scale: M.MASS_SCALE,
          tableHull: M.IMPACT_DENSITY.HULL,
          liveHull: M.hullDensity(),
          derived: M.PHYSICS_CONSTANTS.PLAYER_MASS,
          fromTable: M.massFor(20, M.IMPACT_DENSITY.HULL),
          playerMass: e.player.mass,
          playerSize: e.player.size.x,
        };
      });

      // The hull is 100 x MASS_SCALE (user call: every mass 10x, every size
      // unchanged).  Written against the SCALE rather than as a bare 1000,
      // so moving the factor moves this with it and only a change that
      // breaks the DERIVATION fails here.
      expect(r.derived, 'the shipped constant is 100 x the scale')
        .toBe(100 * r.scale);
      expect(r.fromTable, 'and it is the table that produces it').toBe(r.derived);
      expect(r.playerMass, 'a lean ship carries exactly it').toBeCloseTo(r.derived, 6);
      // At index 0 the live density IS the table's — the ladder multiplies,
      // it does not replace.
      expect(r.liveHull).toBe(r.tableHull);
      expect(r.liveHull * r.playerSize * r.playerSize).toBeCloseTo(r.derived, 6);
      // SIZE IS UNSCALED.  The whole factor lands in density, which is what
      // "areas and sizes stay constant" means in one assertion.
      expect(r.playerSize, 'the hull is the same size it always was').toBe(20);
    });

  test('the shard ladders read from the same table, so glass:rock:metal stays 1:1.8:3',
    async ({ page }) => {
      const watch = await boot(page);
      await leanRun(page);

      const r = await engine(page, () => {
        const M = (window as any).__omniMass;
        const at = (v: string, d: number) => M.SHARD_VARIANTS[v].spawn.sizeToMass(d);
        return {
          // Read at two diameters: the ladder is mass ∝ d², so a single
          // diameter cannot tell a density change from a formula change.
          d36: {
            glass: at('glass-shard', 36), plastic: at('plastic-shard', 36),
            rock: at('rock-shard', 36), metal: at('metal-shard', 36),
          },
          d12: { glass: at('glass-shard', 12), metal: at('metal-shard', 12) },
          table: M.IMPACT_DENSITY,
          massFor: M.massFor(36, M.IMPACT_DENSITY.ROCK),
        };
      });

      // Each ladder IS the table entry — this is the claim that makes the
      // scale one thing rather than five literals with a comment.
      for (const [mat, key] of [['glass', 'GLASS'], ['plastic', 'PLASTIC'],
                                ['rock', 'ROCK'], ['metal', 'METAL']] as const) {
        expect((r.d36 as any)[mat], `${mat} is its table density`)
          .toBeCloseTo(36 * 36 * (r.table as any)[key], 9);
      }
      expect(r.massFor, 'and massFor is the one derivation').toBeCloseTo(r.d36.rock, 9);
      // The documented ratio, which is what a player actually feels when
      // one material shoves another.
      expect(r.d36.rock / r.d36.glass).toBeCloseTo(1.8, 6);
      expect(r.d36.metal / r.d36.glass).toBeCloseTo(3.0, 6);
      // Quadratic, not linear: a third the diameter is a ninth the mass.
      expect(r.d12.glass * 9).toBeCloseTo(r.d36.glass, 9);
      expect(r.d12.metal * 9).toBeCloseTo(r.d36.metal, 9);

      watch.assertClean();
    });

  test('the hull ships far above the material band, on purpose',
    async ({ page }) => {
      const watch = await boot(page);
      await leanRun(page);

      const r = await engine(page, () => {
        const M = (window as any).__omniMass;
        return { hull: M.IMPACT_DENSITY.HULL, ...M.IMPACT_DENSITY };
      });

      // Not a tolerance — a STATEMENT.  The audit's finding was that the
      // hull sits 25x glass and 8x rock, and that this was invisible.  It
      // is deliberate, so it is written down where a change to either side
      // has to come past it.
      expect(r.hull / r.GLASS).toBeCloseTo(25, 6);
      expect(r.hull / r.METAL).toBeCloseTo(8.333, 2);
      expect(r.hull).toBeGreaterThan(r.METAL);

      watch.assertClean();
    });
});

test.describe('the hull-density ladder moves the ship, at the read', () => {
  test('cycling it re-derives the live mass, and index 0 is what ships',
    async ({ page }) => {
      const watch = await boot(page);
      await leanRun(page);

      const r = await engine(page, (e: any) => {
        const M = (window as any).__omniMass;
        const sample = () => ({ dens: M.hullDensity(), mass: e.player.mass });
        const steps = [sample()];
        // Walk the whole ladder and come back round to the start: a cycle
        // that wrapped to a different value than it began at would mean the
        // default is not reachable in play, which is the one property a
        // "(def)" marker is claiming.
        for (let i = 0; i < 5; i++) { e.dbg.cycleHullDensity(); steps.push(sample()); }
        return { steps, shipped: M.PHYSICS_CONSTANTS.PLAYER_MASS };
      });

      const [first, ...rest] = r.steps;
      const last = r.steps[r.steps.length - 1];

      // Index 0 is the shipped ship.
      expect(first.mass, 'index 0 is exactly what ships').toBeCloseTo(r.shipped, 6);
      // THE LADDER IS LIVE.  This is the assertion that fails if the cycle
      // writes an index nobody reads — `player.mass` is derived inside
      // `applyModuleEffects`, so the cycle has to re-fold the outfit rather
      // than just moving a number in constants.
      const moved = rest.filter(st => Math.abs(st.mass - first.mass) > 1e-9);
      expect(moved.length, 'every step off the default really moves the ship')
        .toBe(4);
      // Mass tracks density exactly — the ladder multiplies the density and
      // the mass follows through the ONE derivation, rather than the two
      // drifting apart.
      for (const st of r.steps) {
        expect(st.mass / st.dens).toBeCloseTo(first.mass / first.dens, 6);
      }
      // And it wraps home.
      expect(last.mass, 'the cycle returns to the default').toBeCloseTo(first.mass, 6);

      watch.assertClean();
    });

  test('a lighter hull really rams for less — the ladder reaches the energy model',
    async ({ page }) => {
      const watch = await boot(page);

      // The POINT of the ladder, and the thing a mass readout cannot show:
      // under the energy model the hull's mass is half of what a ram SPENDS,
      // so a lighter hull has to take a smaller bite at the same speed.
      // Driven through the real collision branch at a fixed 12 u/step, so
      // the only thing differing between the arms is the ship's mass.
      //
      // A FRESH FIELD PER ARM, and this is not hygiene — it is the
      // measurement.  Resetting `health` does NOT reset `fractureEdgeFill`,
      // so a second ram on the same tile spends against boundaries the
      // first one already saturated and `hp0 - health` then reports
      // ACCUMULATED erosion rather than this arm's bite.  Measured that way
      // the arms read 21.3 / 31.9 / 37.2 as the hull got LIGHTER, which is
      // the running total climbing, not a heavier bite.
      const ramDamage = async () => {
        await startRun(page, 'ROCK_FIELD');
        await waitForStats(page, s => s.currentMapType === 'ROCK_FIELD', 'the rock field');
        return engine(page, (e: any) => {
          const P: any = e.physics, DT = 1 / 120;
          const t = e.currentMap.entities.find((x: any) => x.active
            && x.shardVariant === 'rock-tile' && x.mass === Infinity
            && x.fractureEdgeFill === undefined);
          if (!t) throw new Error('no untouched rock tile');
          for (const x of e.currentMap.entities) if (x !== t) x.active = false;
          t.position.x = 400; t.position.y = 0; t.active = true;
          // Build the model at zero damage so `health` is already the
          // DERIVED total — otherwise the first contact's "damage" also
          // contains the rewrite from the authored value.
          e.chipStructureAt(t, { x: t.position.x, y: t.position.y }, 0);
          t.health = t.maxHealth;
          P.initializeStaticGrid(e.currentMap.entities);
          const p = e.player;
          p.health = p.maxHealth = 1e9;
          p.position.x = 0; p.position.y = 0;
          p.velocity.x = 12; p.velocity.y = 0;
          const hp0 = t.health;
          // ONE CONTACT: stop at the first frame that moves the tile's
          // health.  Running the ship to rest instead lets it bounce and
          // come back for more, so the total would count RAMS rather than
          // measure a bite — and a lighter ship comes off faster.
          for (let i = 0; i < 2000; i++) {
            e.prepareFrameEntities(); e.updatePhysics(DT); p.velocity.y = 0;
            if (!t.active || t.health < hp0 - 1e-9) break;
            if (Math.abs(p.velocity.x) < 0.05) break;
            if (p.position.x > t.position.x + 80) break;
          }
          // The FRACTION of the tile taken, not the raw damage: derived HP
          // varies tile to tile by construction, and the arms are
          // necessarily different tiles.
          return {
            frac: (hp0 - Math.max(0, t.health)) / hp0,
            mass: p.mass,
          };
        });
      };

      const heavy = await ramDamage();
      await engine(page, (e: any) => { e.dbg.cycleHullDensity(); });   // → 0.5x
      const light = await ramDamage();
      await engine(page, (e: any) => {                                  // back to 0
        for (let i = 0; i < 4; i++) e.dbg.cycleHullDensity();
      });

      expect(light.mass / heavy.mass, 'the arms really differ in mass')
        .toBeCloseTo(0.5, 6);
      expect(heavy.frac, 'a full-density ram takes a real bite').toBeGreaterThan(0.1);
      // Reduced mass against a STATIC body degrades to the impactor's own
      // mass, so the bite is linear in hull mass here: half the density,
      // half the damage.  A band, since the arms are different tiles with
      // their own derived HP.
      expect(light.frac / heavy.frac, 'and half the hull density takes about half of it')
        .toBeGreaterThan(0.35);
      expect(light.frac / heavy.frac).toBeLessThan(0.7);

      watch.assertClean();
    });
});

/** THE 10x SCALE IS A UNIT CHANGE, NOT A BALANCE CHANGE (user call: every
 *  mass 10x, every size and area constant).
 *
 *  Mass appears in this engine in three shapes and only one survives a
 *  uniform scale untouched:
 *    1. RATIOS (the impulse split, the shake, the roll spring) — cancel.
 *    2. ABSOLUTE THRESHOLDS (`SHARD_CRASH_MOMENTUM`, `TILE_PRESSURE_MIN_MASS`,
 *       `FLOW_VARIABILITY.MASS_REF`, the audio pitch reference, two knockback
 *       divisors) — each compares a mass against a NUMBER, so each must move
 *       with the scale or it silently re-prices.
 *    3. THE ENERGY CONVERSION (`IMPACT_ENERGY_PER_DAMAGE`) — every impact in
 *       the game is worth `mass / C`, so C carries the factor too.
 *
 *  (3) is the load-bearing one and is WRONG IN A WAY NOTHING REPORTS: leaving
 *  C at its old value gives a perfectly playable game in which every crash
 *  and every round's energy bank is TEN TIMES larger.  Measured that way, a
 *  rock tile fell from nine rams to one — and no exception, no log and no
 *  ratio test anywhere would have mentioned it.  That is what this describe
 *  block exists for.
 */
test.describe('the mass scale is a unit, so nothing re-prices', () => {
  test('the energy conversion carries the scale, so mass/C is invariant',
    async ({ page }) => {
      const watch = await boot(page);
      await leanRun(page);

      const r = await engine(page, () => {
        const M = (window as any).__omniMass;
        const C = M.IMPACT_ENERGY_PER_DAMAGE;
        return {
          scale: M.MASS_SCALE, C,
          // What a body of each class is WORTH in an impact: mass / C is the
          // quantity every crash and every projectile bank is measured in,
          // so it is the thing that must not have moved.
          hullWorth: M.PHYSICS_CONSTANTS.PLAYER_MASS / C,
          rockWorth: M.SHARD_VARIANTS['rock-shard'].spawn.sizeToMass(36) / C,
          boltWorth: M.projectileMassFor(M.WEAPONS[M.WEAPON_LIST[0]]) / C,
        };
      });

      // C is 32 x the scale.  Both halves are asserted, because a C that
      // stopped tracking the factor is exactly the silent 10x re-price.
      expect(r.C, 'the conversion carries the factor').toBe(32 * r.scale);
      // The PRE-SCALE worths, which are what the whole combat model was
      // tuned against: a 100-mass hull and a 32 conversion gave 3.125, a
      // 36px rock shard 0.729, a Blaster bolt 0.03125.  These numbers are
      // the balance, and they are unchanged.
      expect(r.hullWorth, 'a hull is worth what it always was').toBeCloseTo(3.125, 6);
      expect(r.rockWorth, 'and so is a rock shard').toBeCloseTo(0.729, 6);
      expect(r.boltWorth, 'and so is a bolt').toBeCloseTo(0.03125, 6);

      watch.assertClean();
    });

  test('every absolute mass threshold carries the scale too',
    async ({ page }) => {
      const watch = await boot(page);
      await leanRun(page);

      const r = await engine(page, () => {
        const M = (window as any).__omniMass;
        const S = M.STRUCTURE_CONSTANTS, F = M.FLOW_VARIABILITY, A = M.AUDIO_CONSTANTS;
        return {
          scale: M.MASS_SCALE,
          shardCrash: S.SHARD_CRASH_MOMENTUM,
          tilePressure: S.TILE_PRESSURE_MIN_MASS,
          flowRef: F.MASS_REF,
          pitchRef: A.IMPACT_PITCH_REF_MASS,
        };
      });

      // Each of these compares a mass against a number.  Left unscaled, each
      // would quietly admit ten times as much: SHARD_CRASH_MOMENTUM is the
      // gate deciding which drifting shards destroy terrain at all, and
      // TILE_PRESSURE_MIN_MASS which ones can grind a tile down by leaning
      // on it.  A ratio test cannot see either.
      expect(r.shardCrash, 'the destructive-impactor gate').toBe(200 * r.scale);
      expect(r.tilePressure, 'the pressure-accumulator gate').toBe(40 * r.scale);
      expect(r.flowRef, 'the flow-drift mass reference').toBe(7 * r.scale);
      expect(r.pitchRef, 'the impact-pitch reference').toBe(25 * r.scale);

      watch.assertClean();
    });

  test('a ram still takes the same number of goes, which is the whole claim',
    async ({ page }) => {
      const watch = await boot(page);

      // The end-to-end statement, driven through the real collision branch:
      // rock is the material `CRASH_ENERGY_COUPLING` was calibrated on and
      // its ram count is the one number a person actually played.  If the
      // scale had leaked into the energy model this reads 1, not 9.
      await startRun(page, 'ROCK_FIELD');
      await waitForStats(page, s => s.currentMapType === 'ROCK_FIELD', 'the rock field');

      const rams = await engine(page, (e: any) => {
        const P: any = e.physics, DT = 1 / 120;
        const t = e.currentMap.entities.find((x: any) => x.active
          && x.shardVariant === 'rock-tile' && x.mass === Infinity);
        if (!t) throw new Error('no rock tile');
        for (const x of e.currentMap.entities) if (x !== t) x.active = false;
        t.position.x = 400; t.position.y = 0; t.active = true;
        e.chipStructureAt(t, { x: t.position.x, y: t.position.y }, 0);
        t.health = t.maxHealth;
        P.initializeStaticGrid(e.currentMap.entities);
        const p = e.player;
        p.health = p.maxHealth = 1e9;
        let n = 0;
        while (t.active && n < 200) {
          p.position.x = 0; p.position.y = 0;
          p.velocity.x = 6; p.velocity.y = 0;      // the audit's own ram speed
          n++;
          for (let i = 0; i < 400; i++) {
            e.prepareFrameEntities(); e.updatePhysics(DT); p.velocity.y = 0;
            if (!t.active) break;
            if (Math.abs(p.velocity.x) < 0.05) break;
            if (p.position.x > t.position.x + 80) break;
          }
        }
        return n;
      });

      // A band rather than exactly 9: derived HP varies tile to tile by
      // construction.  What matters is that it is nowhere near 1.
      expect(rams, 'rock still takes real punishment').toBeGreaterThan(5);
      expect(rams, 'and not dramatically more either').toBeLessThan(16);

      watch.assertClean();
    });
});
