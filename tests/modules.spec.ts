/** PENETRATION (A3) and SCANNER (A4) — the two Phase-A module families.
 *
 *  Both drop into the outfitting system as it ships: a `statMks` row in
 *  MODULE_DEFS, an effect summed by `applyModuleEffects`, and one consumer
 *  reading the folded value.  Neither adds a subsystem, and that is exactly
 *  what makes them easy to break quietly — an effect that stops being folded,
 *  or an adjacency-offline module that keeps contributing, changes no shape
 *  on screen and throws nothing.
 *
 *  What is pinned:
 *   1. PENETRATION RAISES EFFECTIVE PIERCE, through the real weapon path —
 *      the spawned projectile's `pierceCount`, not the module's effect field.
 *   2. THE LASER'S OWN BUDGET.  It ships `pierce: 4` (99 → 4 in the same
 *      rework), and the module's marks add on top of that.
 *   3. A BOLT ACTUALLY PASSES THROUGH.  A real Blaster shot, resolved through
 *      the real collision path, damages a second enemy with Mk I installed
 *      and stops on the first without it — for a FALLOFF-STEPPED bite, not
 *      the full one.
 *   3b. THE OPTION-C SEMANTICS, all four of them: the falloff curve read
 *      across successive hits; a bolt BORING several grains inside ONE tile
 *      and stopping there when its charges run out; a bolt leaving a body
 *      with charges left and striking the next; and an indestructible tile
 *      stopping a bolt dead while spending nothing.  Plus the two the same
 *      rework decided: the Laser's base pierce (99 → 4) and a RICOCHET
 *      re-hitting a body it had already struck.
 *   4. EACH SCANNER MARK REVEALS ITS OWN TIER, measured against the
 *      no-scanner baseline in the same scene.
 *   5. OFFLINE IS ZERO.  An adjacency-offline module of either family
 *      contributes exactly nothing — which for the scanner means the
 *      baseline, to the pixel.
 *
 *  Every reveal assertion reads the BASELINE first and the scanner state
 *  second in the same scene, because "today's behaviour exactly" is the load-
 *  bearing half of A4: the existing indicator/minimap/portal suites are
 *  written against the no-scanner gating and must keep passing.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, startRun, stats, waitForStats, waitForEngine, quietScene } from './helpers';

/** WEAPONS[BOUNCER].pierce and the falloff cycle, hard-coded (harness rule:
 *  a test that imports the constant it is checking pins nothing).
 *
 *  The falloff is a RATE, and it SHIPS OFF (user call): damage at hit ordinal
 *  n is `base x (1 - rate)^n`, and at the shipped rate of 0 every penetration
 *  hit lands full damage.  One click of DBG "Pierce falloff" reaches 0.05,
 *  which is where the decay can be observed. */
const LASER_PIERCE = 4;
const SHIPPED_RATE = 0;
const FIRST_CLICK_RATE = 0.05;
const falloffAt = (ordinal: number, rate = FIRST_CLICK_RATE) =>
  ordinal <= 0 ? 1 : Math.pow(1 - rate, ordinal);

/** Park the player in empty space on a quiet showcase map. */
async function quietField(page: any, map = 'GLASS_FIELD') {
  await startRun(page, map);
  // Built as a string, never a closure: `waitForStats` serialises the
  // predicate with toString(), so a captured `map` would be undefined in the
  // page and the poll would throw rather than wait (helpers.ts, rule 1).
  await waitForStats(
    page,
    new Function('s', `return s.currentMapType === ${JSON.stringify(map)}`) as any,
    `the ${map}`);
  await quietScene(page);
  await engine(page, e => {
    e.player.position.x += 4000; e.player.position.y += 4000;
    e.player.velocity.x = 0; e.player.velocity.y = 0;
  });
}

/** Fire ONE real player shot through WeaponSystem and hand back the
 *  projectile it spawned.  The cooldown is zeroed first so the shot is never
 *  swallowed by cadence, and the shot is taken straight off the weapon path
 *  rather than synthesised — the whole point is that the module reaches the
 *  projectile through the code the game fires with. */
function fireOne(page: any) {
  return engine(page, e => {
    e.player.weaponCooldown = 0;
    const before = e.currentMap.entities.length;
    e.weapons.firePlayerWeapon(
      e.currentMap.entities, e.player,
      { x: e.player.position.x + 500, y: e.player.position.y },
      undefined, false,
    );
    const spawned = e.currentMap.entities
      .slice(before)
      .filter((x: any) => x.type === 'PROJECTILE');
    return { count: spawned.length, pierceCount: spawned[0]?.pierceCount ?? null };
  });
}

/** Install a module of `family` at `mk` and return whether it came out
 *  ACTIVE.  `debugGrantModule` drops it in the first free hex of its group,
 *  which on a lean outfit touches the Base Hull / the starter Blaster — so
 *  the default placement is a CONNECTED one. */
function grant(page: any, id: string) {
  return engine(page, (e, mid: string) => {
    e.debugGrantModule(mid);
    const ship = e.shipSlots.indexOf(mid), wpn = e.weaponSlots.indexOf(mid);
    return {
      installed: ship !== -1 || wpn !== -1,
      active: ship !== -1 ? e.activeShip[ship] : wpn !== -1 ? e.activeWeapon[wpn] : false,
    };
  }, id);
}

/** Move the named module so it is INSTALLED but touches nothing that
 *  satisfies its requirement, by the REAL move path (`moveModuleInternal` —
 *  the DBG bypass of the drydock guard).
 *
 *  Hex 0 is the flower's CENTRE and touches all six ring hexes, so a root
 *  (hull / gun) parked there can never leave anything offline.  The module
 *  goes out to ring hex 4 and the root to ring hex 2, which HEX_ADJACENCY
 *  says are not neighbours — the smallest arrangement that isolates it. */
function isolate(page: any, group: 'ship' | 'weapon', rootId: string, modId: string) {
  return engine(page, (e, o: { group: string; rootId: string; modId: string }) => {
    const slots = o.group === 'ship' ? e.shipSlots : e.weaponSlots;
    const active = o.group === 'ship' ? e.activeShip : e.activeWeapon;
    const move = (from: number, to: number) =>
      e.moveModuleInternal({ area: o.group, idx: from }, { area: o.group, idx: to });
    move(slots.indexOf(o.modId), 4);
    move(slots.indexOf(o.rootId), 2);
    return {
      rootAt: slots.indexOf(o.rootId), modAt: slots.indexOf(o.modId),
      rootActive: active[2], modActive: active[4],
    };
  }, { group, rootId, modId });
}


/** Turn the decay ON.  It SHIPS OFF, so a test about the curve has to click
 *  the DBG cycle once — index 0 is the shipped 0, index 1 is 0.05. */
async function decayOn(page: any) {
  await engine(page, e => { e.dbg.cyclePierceFalloff(); });
  const s = await stats(page);
  expect(s.pierceFalloffName, 'one click reaches the first real rate')
    .toBe(FIRST_CLICK_RATE.toFixed(2));
}

// ── A3 — Penetration ────────────────────────────────────────────────────────

test.describe('penetration module', () => {
  test('the lean start pierces nothing; each mark adds one', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);

    // BASELINE. The Blaster ships `pierce: 0` — it stops on what it hits.
    expect(await engine(page, e => e.player.pierceBonus ?? 0),
      'a lean outfit carries no penetration').toBe(0);
    expect((await fireOne(page)).pierceCount,
      'so a Blaster bolt spawns with the gun\'s own pierce').toBe(0);

    const mk1 = await grant(page, 'piercing_mk1');
    expect(mk1.active, 'granted beside the starter Blaster, it is connected').toBe(true);
    expect(await engine(page, e => e.player.pierceBonus), 'Mk I = +1').toBe(1);
    expect((await fireOne(page)).pierceCount, 'and the SHOT carries it').toBe(1);

    // Marks are ordinary stat items: a second one stacks, the way two Hull
    // modules stack.  (The scanner is the deliberate exception — see below.)
    await grant(page, 'piercing_mk2');
    expect(await engine(page, e => e.player.pierceBonus), 'Mk I + Mk II = +3').toBe(3);
    expect((await fireOne(page)).pierceCount).toBe(3);

    watch.assertClean();
  });

  test('offline contributes nothing', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);
    await grant(page, 'piercing_mk3');
    expect(await engine(page, e => e.player.pierceBonus), 'connected: +3').toBe(3);

    // Same module, same flower, no gun contact.
    const iso = await isolate(page, 'weapon', 'wpn_blaster', 'piercing_mk3');
    expect(iso.rootActive, 'the gun is a root — always active').toBe(true);
    expect(iso.modActive, 'the mod is not touching it').toBe(false);
    expect(await engine(page, e => e.player.pierceBonus),
      'an OFFLINE module contributes zero, not its effect').toBe(0);
    expect((await fireOne(page)).pierceCount, 'and the shot is the bare gun again').toBe(0);

    watch.assertClean();
  });

  test('the Laser flies with its own budget, and the module adds to it', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);
    await engine(page, e => e.debugGrantWeapon('BOUNCER'));
    // Select the Laser explicitly — the grant mounts it but the active gun
    // is whatever the loadout sync landed on.
    await engine(page, e => e.selectWeapon('BOUNCER'));
    expect(await engine(page, e => e.player.currentWeapon)).toBe('BOUNCER');
    expect((await fireOne(page)).pierceCount,
      'the bare Laser carries its own authored budget').toBe(LASER_PIERCE);

    await engine(page, e => e.debugGrantModule('piercing_mk3'));
    expect(await engine(page, e => e.player.pierceBonus)).toBe(3);

    const shot = await fireOne(page);
    // 99 -> 4 (user call): "effectively infinite" pre-dated there being any
    // COST to piercing.  With the falloff curve in place a beam already gives
    // up damage per body, so an unbounded budget just made the Laser the
    // answer to every line of targets.  Mk III's +3 lands on top, nowhere
    // near the MAX_PIERCE sanity clamp.
    expect(shot.pierceCount,
      'the Laser\'s own 4 plus Mk III\'s +3').toBe(LASER_PIERCE + 3);

    watch.assertClean();
  });

  test('a Blaster bolt with Mk I passes through the first enemy and hits a second',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);

      /** Fire one real shot and walk it through TWO parked enemies with the
       *  real collision resolver — the traits suite's rule: a shell whose
       *  flight depends on the terrain layout tests the terrain. */
      const run = async () => engine(page, e => {
        const ctx = e.waveContext();
        const a = e.waves.spawnAt('RAMMER_1',
          { x: e.player.position.x + 300, y: e.player.position.y }, ctx, false);
        const b = e.waves.spawnAt('RAMMER_1',
          { x: e.player.position.x + 600, y: e.player.position.y }, ctx, false);
        a.maxSpeed = 0; b.maxSpeed = 0;
        a.health = a.maxHealth = 1e6;
        b.health = b.maxHealth = 1e6;

        e.player.weaponCooldown = 0;
        const before = e.currentMap.entities.length;
        e.weapons.firePlayerWeapon(
          e.currentMap.entities, e.player,
          { x: e.player.position.x + 500, y: e.player.position.y },
          undefined, false,
        );
        const proj = e.currentMap.entities.slice(before)
          .find((x: any) => x.type === 'PROJECTILE');

        const aBefore = a.health;
        e.physics.resolveCollision(proj, a, { x: 0, y: 0 });
        const firstHit = aBefore - a.health;
        const survived = proj.active === true;
        let secondHit = 0;
        if (survived) {
          const bBefore = b.health;
          e.physics.resolveCollision(proj, b, { x: 0, y: 0 });
          secondHit = bBefore - b.health;
        }
        a.active = false; b.active = false;
        proj.active = false;
        return { firstHit, survived, secondHit };
      });

      const bare = await run();
      expect(bare.firstHit, 'the bolt lands').toBeGreaterThan(0);
      expect(bare.survived, 'and with no module it stops there').toBe(false);
      expect(bare.secondHit).toBe(0);

      await grant(page, 'piercing_mk1');
      const pierced = await run();
      expect(pierced.firstHit).toBeGreaterThan(0);
      expect(pierced.survived, 'Mk I: the bolt carries on').toBe(true);
      // The decay SHIPS OFF, so at the default the second body takes the
      // same bite as the first.  Stated as the RATIO rather than an absolute
      // so it tracks the Blaster's damage, not this tuning of it; the curve
      // itself is pinned by the falloff tests below, which turn it on.
      expect(pierced.secondHit / pierced.firstHit,
        'and at the shipped rate the second enemy takes the SAME bite')
        .toBeCloseTo(1, 5);

      watch.assertClean();
    });

  // ── Option C: the falloff curve and the bore track ────────────────────────
  //
  // These read the DAMAGE the real collision path applies, not a flag: an
  // effect that silently stops being folded, a curve read backwards off the
  // count-DOWN charge counter, or a bore that spends its whole shot on the
  // entry grain all leave the same shapes on screen.

  test('the falloff RATE is a live knob, and 0 means full damage every hit',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);

      /*  The whole reason the authored table became a rate: it has to be
       *  sweepable in play.  Two targets, one bolt, read the second bite —
       *  once at the shipped rate and once with the cycle walked to `off`. */
      const bite = () => engine(page, e => {
        const ctx = e.waveContext();
        const foes: any[] = [];
        for (let i = 1; i <= 2; i++) {
          const a = e.waves.spawnAt('RAMMER_1',
            { x: e.player.position.x + i * 200, y: e.player.position.y }, ctx, false);
          a.maxSpeed = 0; a.health = a.maxHealth = 1e6;
          foes.push(a);
        }
        const proj: any = {
          id: 'rate_' + Math.random(), type: 'PROJECTILE',
          position: { x: e.player.position.x, y: e.player.position.y },
          velocity: { x: 900, y: 0 }, rotation: 0,
          size: { x: 6, y: 6 }, mass: 0.1, active: true, color: '#fff',
          damage: 10, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
          pierceCount: 1, pierceHits: 0,
        };
        const bites: number[] = [];
        for (const f of foes) {
          if (!proj.active) break;
          const before = f.health;
          e.physics.resolveCollision(proj, f, { x: 0, y: 0 }, undefined, e.handleEntityDeath);
          bites.push(before - f.health);
        }
        foes.forEach(f => { f.active = false; });
        proj.active = false;
        return bites;
      });

      // SHIPPED: the decay is off, so a penetration hit lands full damage.
      const s0 = await stats(page);
      expect(s0.pierceFalloffName, 'the readout names the shipped control')
        .toContain('off');
      const shipped = await bite();
      expect(shipped[0], 'contact hit, full').toBeCloseTo(10, 6);
      expect(shipped[1], 'and at the shipped rate so is the penetration hit')
        .toBeCloseTo(10, 6);

      // One click turns it on — the knob is the whole point of the rate.
      await decayOn(page);
      const on = await bite();
      expect(on[0], 'the contact hit is never scaled').toBeCloseTo(10, 6);
      expect(on[1] / 10, 'and the penetration hit now decays')
        .toBeCloseTo(falloffAt(1), 6);

      watch.assertClean();
    });

  test('successive bodies take the falloff rate, at every depth', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);
    await decayOn(page);   // the decay ships OFF; this test is about the curve

    // SIX parked, effectively immortal targets on one line and one bolt with
    // five charges.  A RATE has no tail to fall off — it just keeps decaying —
    // so what this pins is that every depth reads (1 - rate)^n rather than
    // flattening or stopping.  Synthesised projectile (the fracture suite's
    // idiom) so the damage is a round number the ratios can be read off.
    const r = await engine(page, e => {
      const ctx = e.waveContext();
      const foes: any[] = [];
      for (let i = 1; i <= 6; i++) {
        const a = e.waves.spawnAt('RAMMER_1',
          { x: e.player.position.x + i * 200, y: e.player.position.y }, ctx, false);
        a.maxSpeed = 0; a.health = a.maxHealth = 1e6;
        foes.push(a);
      }
      const proj: any = {
        id: 'falloff_' + Math.random(), type: 'PROJECTILE',
        position: { x: e.player.position.x, y: e.player.position.y },
        velocity: { x: 900, y: 0 }, rotation: 0,
        size: { x: 6, y: 6 }, mass: 0.1, active: true, color: '#fff',
        damage: 10, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
        pierceCount: 5, pierceHits: 0,
      };
      const bites: number[] = [];
      for (const f of foes) {
        if (!proj.active) break;
        const before = f.health;
        e.physics.resolveCollision(proj, f, { x: 0, y: 0 }, undefined, e.handleEntityDeath);
        bites.push(before - f.health);
      }
      foes.forEach(f => { f.active = false; });
      proj.active = false;
      return { bites, left: proj.pierceCount };
    });

    // Five charges buys SIX damage events — the contact plus five
    // continuations — and every one of them is a real, scaled bite.
    expect(r.bites.length, 'five charges = six damage events').toBe(6);
    for (let i = 0; i < 6; i++) {
      expect(r.bites[i] / 10, `hit ${i} decays to (1 - rate)^${i}`)
        .toBeCloseTo(falloffAt(i), 6);
    }
    // The first contact is ALWAYS full: only penetration hits decay, so a
    // bolt with no charges is untouched by any of this.
    expect(r.bites[0], 'the contact hit is never scaled').toBeCloseTo(10, 6);
    expect(r.left, 'and the budget is spent').toBe(0);

    watch.assertClean();
  });

  test('inside a grain body a charge buys a GRAIN, not the whole tile', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);
    await decayOn(page);   // the decay ships OFF; these expectations are the curve

    /** Fire one synthesised 4-damage bolt into a fresh glass tile from just
     *  outside its left face, straight along +x, and report what the tile
     *  and the bolt look like afterwards. */
    const bore = (pierce: number) => engine(page, (e, p: number) => {
      const ents = e.currentMap.entities;
      const t = ents.find((x: any) => x.active && x.shardVariant === 'glass-tile'
        && x.mass === Infinity && !x.__bored);
      if (!t) throw new Error('no fresh glass tile');
      t.__bored = true;
      const proj: any = {
        id: 'bore_' + Math.random(), type: 'PROJECTILE',
        position: { x: t.position.x - t.size.x * 0.5 - 2, y: t.position.y },
        velocity: { x: 900, y: 0 }, rotation: 0,
        size: { x: 6, y: 6 }, mass: 0.1, active: true, color: '#fff',
        damage: 4, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
        pierceCount: p, pierceHits: 0,
      };
      e.physics.resolveCollision(proj, t, { x: 0, y: 0 }, undefined, e.handleEntityDeath);
      // maxHealth is the DERIVED boundary total the first hit installs, and
      // health mirrors the unbroken budget — so their difference IS the
      // damage this bolt actually poured into the pattern.
      return {
        dealt: t.maxHealth - t.health,
        steps: proj.pierceHits, left: proj.pierceCount, alive: proj.active === true,
        grainSize: (window as any).__omniGrain?.grainSpecFor('glass-tile')?.grainSize,
        halfExtent: t.size.x * 0.5,
        partials: (t.fractureEdgeFill ?? []).filter((f: number) => f > 0).length,
      };
    }, pierce);

    // No charges: the body-level rule, unchanged — one contact, one bite.
    const none = await bore(0);
    expect(none.steps, 'a bolt with no penetration does not bore').toBe(0);
    expect(none.dealt).toBeCloseTo(4, 6);
    expect(none.alive, 'and it stops on the tile').toBe(false);

    // The step is a grain diameter, and the tile is several of them across —
    // the property the whole model rests on.  Stated rather than assumed,
    // because if it were false the bore below would be trivially one step.
    expect(none.grainSize).toBeGreaterThan(0);
    expect(none.halfExtent).toBeGreaterThan(none.grainSize);

    // ONE charge: the bolt bores a SECOND grain and runs dry inside the pane.
    // Under the old body-level rule this same charge carried it clean
    // through the whole tile for one bite of 4.
    const one = await bore(1);
    expect(one.steps, 'one charge = one extra grain').toBe(2);
    expect(one.dealt, 'each grain stepping down the curve')
      .toBeCloseTo(4 * (falloffAt(0) + falloffAt(1)), 6);
    expect(one.left, 'the charge is spent').toBe(0);
    expect(one.alive, 'and out of charges INSIDE the body, the bolt stops there')
      .toBe(false);
    // Successive stamps erode successive grains rather than pouring the whole
    // shot into the entry cell — with damageSpread 0 the spend runs
    // sequentially, so more than one boundary is carrying damage.
    expect(one.partials, 'the track is spread across the pattern')
      .toBeGreaterThan(1);

    watch.assertClean();
  });

  test('a bolt that reaches the far side keeps flying, and hits what is behind', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);
    await decayOn(page);   // the decay ships OFF; these expectations are the curve

    const r = await engine(page, e => {
      const ents = e.currentMap.entities;
      const t = ents.find((x: any) => x.active && x.shardVariant === 'glass-tile'
        && x.mass === Infinity && !x.__bored);
      t.__bored = true;
      const ctx = e.waveContext();
      const behind = e.waves.spawnAt('RAMMER_1',
        { x: t.position.x + 400, y: t.position.y }, ctx, false);
      behind.maxSpeed = 0; behind.health = behind.maxHealth = 1e6;

      const proj: any = {
        id: 'through_' + Math.random(), type: 'PROJECTILE',
        position: { x: t.position.x - t.size.x * 0.5 - 2, y: t.position.y },
        velocity: { x: 900, y: 0 }, rotation: 0,
        size: { x: 6, y: 6 }, mass: 0.1, active: true, color: '#fff',
        damage: 4, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
        pierceCount: 8, pierceHits: 0,
      };
      e.physics.resolveCollision(proj, t, { x: 0, y: 0 }, undefined, e.handleEntityDeath);
      const exited = {
        alive: proj.active === true, steps: proj.pierceHits, left: proj.pierceCount,
        tileTook: t.maxHealth - t.health,
      };
      let nextBite = 0;
      if (proj.active) {
        const before = behind.health;
        e.physics.resolveCollision(proj, behind, { x: 0, y: 0 }, undefined, e.handleEntityDeath);
        nextBite = before - behind.health;
      }
      behind.active = false; proj.active = false;
      return { ...exited, nextBite };
    });

    expect(r.steps, 'the chord is more than one grain long').toBeGreaterThan(1);
    expect(r.alive, 'charges left when the chord ran out: it comes out the far side')
      .toBe(true);
    expect(r.left, 'and it has not spent more than the track cost')
      .toBe(8 - r.steps);
    // Each grain took its own step of the curve, so the tile's total is the
    // running sum — not `steps` full-damage hits.
    let expected = 0;
    for (let i = 0; i < r.steps; i++) expected += 4 * falloffAt(i);
    expect(r.tileTook).toBeCloseTo(expected, 6);
    // And the thing behind the tile is struck, further down the curve.
    expect(r.nextBite / 4).toBeCloseTo(falloffAt(r.steps), 6);

    watch.assertClean();
  });

  test('an indestructible tile stops the bolt dead and costs it nothing', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page, 'INDESTRUCTIBLE_FIELD');

    const r = await engine(page, e => {
      const t = e.currentMap.entities.find((x: any) => x.active
        && x.shardVariant === 'indestructible-tile');
      if (!t) throw new Error('no indestructible tile');
      const hp = t.health;
      const proj: any = {
        id: 'wall_' + Math.random(), type: 'PROJECTILE',
        position: { x: t.position.x - t.size.x * 0.5 - 2, y: t.position.y },
        velocity: { x: 900, y: 0 }, rotation: 0,
        size: { x: 6, y: 6 }, mass: 0.1, active: true, color: '#fff',
        damage: 4, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
        pierceCount: 5, pierceHits: 0,
      };
      e.physics.resolveCollision(proj, t, { x: 0, y: 0 }, undefined, e.handleEntityDeath);
      return {
        alive: proj.active === true, left: proj.pierceCount, steps: proj.pierceHits,
        tileAlive: t.active === true, hpMoved: t.health !== hp,
      };
    });

    // The worst artifact of the shipped build: the tile took no damage and
    // still let the bolt through, spending a charge on the way.
    expect(r.alive, 'impenetrable: the bolt dies on contact').toBe(false);
    expect(r.left, 'and spends nothing — it took no damage, so it costs none')
      .toBe(5);
    expect(r.steps, 'nor does it step the falloff curve').toBe(0);
    expect(r.tileAlive).toBe(true);
    expect(r.hpMoved, 'the tile is unmarked').toBe(false);

    watch.assertClean();
  });

  test('a ricochet may re-hit what it already struck; sustained contact may not', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);
    await decayOn(page);   // the decay ships OFF; these expectations are the curve

    const r = await engine(page, e => {
      const ctx = e.waveContext();
      const foe = e.waves.spawnAt('RAMMER_1',
        { x: e.player.position.x + 300, y: e.player.position.y }, ctx, false);
      foe.maxSpeed = 0; foe.health = foe.maxHealth = 1e6;
      const tile = e.currentMap.entities.find((x: any) => x.active
        && x.shardVariant === 'glass-tile' && x.mass === Infinity);

      const beam = () => ({
        id: 'beam_' + Math.random(), type: 'PROJECTILE',
        position: { x: foe.position.x, y: foe.position.y },
        velocity: { x: 900, y: 0 }, rotation: 0,
        size: { x: 6, y: 6 }, mass: 0.1, active: true, color: '#fff',
        damage: 5, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
        pierceCount: 4, pierceHits: 0, isBouncer: true, bouncesRemaining: 3,
      } as any);
      const strike = (p: any) => {
        const before = foe.health;
        e.physics.resolveCollision(p, foe, { x: 0, y: 0 }, undefined, e.handleEntityDeath);
        return before - foe.health;
      };

      // (a) SUSTAINED overlap — the same beam meeting the same body again
      // with nothing in between.
      const held = beam();
      strike(held);
      strike(held);
      const sustained = { alive: held.active === true, steps: held.pierceHits,
                          left: held.pierceCount };

      // (b) The same two contacts with a REFLECTION between them.
      const bounced = beam();
      strike(bounced);
      bounced.position.x = tile.position.x - tile.size.x * 0.5 - 2;
      bounced.position.y = tile.position.y;
      e.physics.resolveCollision(bounced, tile, { x: 0, y: 0 }, undefined, e.handleEntityDeath);
      const reflected = { vx: bounced.velocity.x, ids: bounced.hitEntityIds.length,
                          bounces: bounced.bouncesRemaining };
      const secondBite = strike(bounced);

      // Snapshot BEFORE tidying the scene up — reading `active` after
      // clearing it is how a passing test lies.
      const after = { alive: bounced.active === true, steps: bounced.pierceHits,
                      left: bounced.pierceCount };
      foe.active = false; bounced.active = false;
      return { sustained, reflected, secondBite, after };
    });

    // The reflection happened, and it emptied the struck-ID list — which is
    // where the re-hit is bought, NOT by weakening the `alreadyHit` guard
    // (that guard is what stops a beam in sustained overlap grinding a body
    // at 120Hz, and it is still doing that job below).
    expect(r.reflected.vx, 'the beam turned around').toBeLessThan(0);
    expect(r.reflected.bounces).toBe(2);
    expect(r.reflected.ids, 'a bounce clears what it has struck').toBe(0);

    // (a) Held against the body, the beam does NOT carry on: it stops on the
    // re-contact and its budget freezes where it was.
    expect(r.sustained.alive, 'sustained contact ends the beam').toBe(false);
    expect(r.sustained.steps, 'and buys it no further step of the curve').toBe(1);
    expect(r.sustained.left).toBe(3);

    // (b) After a bounce the same beam strikes the same body again and
    // survives to keep going.
    expect(r.after.alive, 'a returning beam carries on').toBe(true);
    expect(r.after.steps, 'and its second damage event is its second step').toBe(2);
    expect(r.secondBite / 5, 'at the falloff curve\'s next entry')
      .toBeCloseTo(falloffAt(1), 6);
    // PIERCE IS A LIFETIME BUDGET: bounces buy COVERAGE, not extra damage
    // events.  Four charges is four continuations however many times the
    // beam turns around.
    expect(r.after.left, 'the bounce did not refresh the budget').toBe(2);

    watch.assertClean();
  });

  test('the speed-decay knob ships OFF and is reachable from the debug menu', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);

    // A DBG cycle is three separate wirings (constants accessor, dbg method,
    // stats field) and a break in any one of them is silent — the row just
    // shows a stale string.  Drive the real method and read the real payload.
    const shipped = await stats(page);
    expect(shipped.pierceSpeedRetainName,
      'shipped at 1.00 — the damage falloff is the change; this is the A/B')
      .toContain('(def)');

    /** Walk one bolt through two parked, immortal enemies and report the
     *  speed it carries out of the first. */
    const retained = () => engine(page, e => {
      const ctx = e.waveContext();
      const foe = e.waves.spawnAt('RAMMER_1',
        { x: e.player.position.x + 300, y: e.player.position.y }, ctx, false);
      foe.maxSpeed = 0; foe.health = foe.maxHealth = 1e6;
      const proj: any = {
        id: 'decay_' + Math.random(), type: 'PROJECTILE',
        position: { x: foe.position.x, y: foe.position.y },
        velocity: { x: 900, y: 0 }, rotation: 0,
        size: { x: 6, y: 6 }, mass: 0.1, active: true, color: '#fff',
        damage: 5, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
        pierceCount: 3, pierceHits: 0,
      };
      e.physics.resolveCollision(proj, foe, { x: 0, y: 0 }, undefined, e.handleEntityDeath);
      const out = proj.velocity.x;
      foe.active = false; proj.active = false;
      return out;
    });

    expect(await retained(), 'at the shipped setting a pierced bolt keeps its speed')
      .toBeCloseTo(900, 6);

    await engine(page, e => e.dbg.cyclePierceSpeedRetain());
    const stepped = await stats(page);
    expect(stepped.pierceSpeedRetainName, 'the cycle moves off the default')
      .not.toBe(shipped.pierceSpeedRetainName);
    const slowed = await retained();
    expect(slowed, 'and the bolt now leaves the body slower').toBeLessThan(900);
    expect(slowed, 'by exactly one step of the cycle').toBeCloseTo(900 * 0.95, 6);

    watch.assertClean();
  });

  test('the Ship Status panel attributes it like every other stat', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);
    await grant(page, 'piercing_mk2');

    const online = await engine(page, e => {
      const l = e.outfittingSnapshot().statLines ?? [];
      return l.find((x: any) => x.id === 'pierce');
    });
    expect(online, 'the panel carries a Penetration line').toBeTruthy();
    expect(online.display).toBe('+2');
    expect(online.baseDisplay).toBe('+0');
    expect(online.contributors.length).toBe(1);
    expect(online.contributors[0].active).toBe(true);
    expect(online.contributors[0].display).toBe('+2');

    await isolate(page, 'weapon', 'wpn_blaster', 'piercing_mk2');
    const offline = await engine(page, e => {
      const l = e.outfittingSnapshot().statLines ?? [];
      return l.find((x: any) => x.id === 'pierce');
    });
    expect(offline.display, 'offline: the headline drops to the base').toBe('+0');
    expect(offline.contributors[0].active).toBe(false);
    expect(offline.contributors[0].requires, 'and names the contact it wants').toBe('gun');

    watch.assertClean();
  });
});

// ── Scanner (rework) ────────────────────────────────────────────────────────
//
// The A4 suite asserted the OPPOSITE contract and is replaced wholesale
// rather than extended: A4's rule was "no scanner degrades to today's
// behaviour exactly", and the rework's is that a scannerless ship sees
// NOTHING.  A test written for the first cannot be adapted into a test for
// the second; keeping it would pin the behaviour the rework removed.

/** Is a portal in the off-screen indicator buffer this frame? */
const portalIndicated = (page: any) => engine(page, e =>
  e.renderer._indicatorBuffer.some((i: any) => i.entity.isPortal === true));

/** Complete one full ping, polling the wavefront rather than sleeping — this
 *  environment renders in software, so sim-seconds run slower than wall
 *  seconds and any computed sleep is a coin flip (harness rule 1). */
async function scanOnce(page: any) {
  // The cooldown is cleared first and the fire is ASSERTED.  Without both,
  // a refused scan makes this helper a silent no-op: `scanPingRadius` is
  // already 0 when no ping started, so the wait below would return
  // immediately and the test would go on to measure an unscanned world and
  // report it as a reveal failure.  (That is not hypothetical — it is how the
  // category-ladder test first "failed": its second scan landed inside the
  // cooldown left by its first.)  The cooldown has its own test.
  const fired = await engine(page, e => { e.scanCooldown = 0; return e.fireScan(); });
  if (!fired) throw new Error('fireScan refused — is a scanner installed and ACTIVE?');
  await page.waitForFunction(
    () => (window as any).__omniEngine?.scanPingRadius === 0,
    undefined, { timeout: 15000 },
  );
}

test.describe('scanner module', () => {
  test('no scanner: nothing is on either readout', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');
    await page.waitForTimeout(400);

    const r = await engine(page, e => ({
      mk: e.scannerMk,
      ranges: e.scanRanges,
      arrows: e.renderer._indicatorBuffer.length,
      // Contacts on the map, EXCLUDING the two always-charted landmarks —
      // those are the one thing a scannerless ship is given.
      uncharted: e.renderer._minimapBuffer.filter((i: any) =>
        !(i.entity.isStation && i.entity.stationKind === 'home')
        && !(i.entity.isPortal && i.entity.id === e.arrivalPortalId)).length,
      scannerStat: (window as any).__omniStats?.scanner,
    }));

    expect(r.mk, 'a lean outfit carries no scanner').toBe(0);
    // Tier 1 is the widest reach there is, so zero there is zero everywhere.
    expect(r.ranges[1] ?? 0, 'no scanner reaches nowhere').toBe(0);
    expect(r.arrows, 'THE HUD CARRIES NO ARROWS AT ALL without a scanner').toBe(0);
    expect(r.uncharted, 'and the minimap carries nothing but the landmarks').toBe(0);
    // The HUD's scan button is absent, not merely disabled: a control for a
    // tool you do not own is a control that does nothing.
    expect(r.scannerStat, 'no scanner, no scan button').toBeUndefined();

    // And the tool refuses to fire, so there is no ping to draw either.
    expect(await engine(page, e => e.fireScan()), 'nothing to scan with').toBe(false);
    expect(await engine(page, e => e.scanPingRadius)).toBe(0);

    watch.assertClean();
  });

  test('the home station and the arrival rift are charted without a scanner',
    async ({ page }) => {
      const watch = await boot(page);
      await startRun(page);
      await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');
      await page.waitForTimeout(400);

      // In the HUB the landmark is the home station.  There is no arrival
      // rift — the run started here rather than arriving through anything —
      // which is itself the rule: `arrivalPortalId` is set by a TRANSIT.
      const hub = await engine(page, e => ({
        arrival: e.arrivalPortalId,
        home: e.renderer._minimapBuffer.some((i: any) =>
          i.entity.isStation && i.entity.stationKind === 'home'),
      }));
      expect(hub.arrival, 'a fresh run arrived through nothing').toBeNull();
      expect(hub.home, 'home is on the map with no scanner').toBe(true);

      // Travel through a rift.  The return portal in the destination — the
      // one pointing back at the hub — is then charted, and it is the ONLY
      // portal that is.
      // Driven through `transitionToMap` — which is what `enterPortal` is a
      // two-line wrapper over, and the thing that actually resolves the
      // arrival rift.  Parking on a hub portal and using the real gesture was
      // tried and is not sound here: the hub's TEST RACK sits beside the home
      // station, so the shared nearest-wins arbitration hands the press to
      // the STATION and the rift never becomes `nearestPortal`.  Fighting the
      // arbitration would be testing station proximity, not charting.
      await engine(page, e => {
        const p = e.portals.find((x: any) => x.portalTargetId && !x.isDescent);
        e.transitionToMap(p.portalTargetId);
      });
      // The transit freezes the loop for the warp beat, so poll the map
      // rather than sleeping through it.
      await waitForStats(page, s => s.currentMapType !== 'OVERWORLD', 'the destination');
      await page.waitForTimeout(300);

      const after = await engine(page, e => ({
        map: e.currentMap.type,
        arrival: e.arrivalPortalId,
        charted: e.renderer._minimapBuffer.filter((i: any) => i.entity.isPortal)
          .map((i: any) => i.entity.id),
        portals: e.portals.length,
        arrows: e.renderer._indicatorBuffer.length,
      }));
      expect(after.map, 'the transit happened').not.toBe('OVERWORLD');
      expect(after.arrival, 'the rift we came out of is remembered').not.toBeNull();
      expect(after.charted, 'exactly the arrival rift, charted with no scanner')
        .toEqual([after.arrival]);
      // The user's own words: "no arrows will point to it still on the HUD".
      expect(after.arrows, 'a charted landmark gets a MAP mark, never an arrow').toBe(0);

      watch.assertClean();
    });

  test('the mark is a CATEGORY ladder: the same contact, one mark apart',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);

      // A RIVAL is tier 3 (rare), so it is the cleanest ladder probe there
      // is: the SAME contact at the SAME distance is invisible to a Mk II and
      // found by a Mk III.  Spawned through the real engine path and then
      // parked beside the player, rather than hand-rolled — the detection
      // sweep walks `entityIndex.enemies`, and a synthetic entity would be
      // asserting that the test agrees with itself (harness rule 6).
      const park = async () => engine(page, e => {
        const r = e.entityIndex.enemies.find((x: any) => x.isRival === true);
        if (!r) return false;
        r.position.x = e.player.position.x + 500;
        r.position.y = e.player.position.y;
        r.velocity.x = 0; r.velocity.y = 0;
        r.detectedAt = undefined;
        return true;
      });

      await engine(page, e => { e.resetOutfit(); e.debugSpawnRival('neutral'); });
      await waitForEngine(page, e =>
        e.entityIndex.enemies.some((x: any) => x.isRival === true), 'a rival');

      // Mk II: its ladder stops at enemies, and a rival is a rung above.
      await engine(page, e => e.debugGrantModule('scanner_mk2'));
      await waitForEngine(page, e => e.scannerMk === 2, 'Mk II');
      expect(await park(), 'the rival is parked in reach').toBe(true);
      await scanOnce(page);
      const mk2 = await engine(page, e => e.entityIndex.enemies
        .some((x: any) => x.isRival === true && x.detectedAt !== undefined));
      expect(mk2, 'a Mk II does not find a rival').toBe(false);

      // Mk III: same scene, same distance, one mark higher.
      await engine(page, e => { e.resetOutfit(); e.debugGrantModule('scanner_mk3'); });
      await waitForEngine(page, e => e.scannerMk === 3, 'Mk III');
      expect(await park()).toBe(true);
      await scanOnce(page);
      const mk3 = await engine(page, e => e.entityIndex.enemies
        .some((x: any) => x.isRival === true && x.detectedAt !== undefined));
      expect(mk3, 'a Mk III does').toBe(true);

      watch.assertClean();
    });

  test('marks STACK in range: a tier reaches as far as every scanner that sees it',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);

      // The user's own worked example: a Mk III plus two Mk I should reach
      // ~3x as far for Mk I features as for Mk III ones, because all three
      // scanners can see tier 1 and only the Mk III sees tier 3.
      await engine(page, e => {
        e.resetOutfit();
        e.debugGrantModule('scanner_mk3');
        e.debugGrantModule('scanner_mk1');
        e.debugGrantModule('scanner_mk1');
      });
      await waitForEngine(page, e => e.scannerMk === 3, 'the rack');

      const r = await engine(page, e => ({
        mk: e.scannerMk,
        t1: e.scanRanges[1], t2: e.scanRanges[2], t3: e.scanRanges[3],
        t4: e.scanRanges[4],
      }));

      // CATEGORY is still the highest mark aboard — stacking buys range, not
      // tiers.  Three scanners do not add up to a Mk IV.
      expect(r.mk).toBe(3);
      expect(r.t4, 'no scanner aboard reaches tier 4').toBe(0);

      // Tier 1 collects all three; tiers 2 and 3 collect only the Mk III, so
      // they are equal to each other and about a third of tier 1.
      expect(r.t2).toBeCloseTo(r.t3, 5);
      expect(r.t1 / r.t3).toBeGreaterThan(2.5);
      expect(r.t1 / r.t3).toBeLessThan(3.1);

      // A SECOND Mk III widens every tier it can see, which is the point of
      // stacking — and leaves tier 4 alone, which is the point of the ladder.
      const before = r.t3;
      await engine(page, e => e.debugGrantModule('scanner_mk3'));
      await waitForEngine(page, e => e.scanRanges[3] > 0, 'the fold');
      const after = await engine(page, e => ({ t3: e.scanRanges[3], t4: e.scanRanges[4] }));
      expect(after.t3, 'a second Mk III doubles tier-3 reach').toBeCloseTo(before * 2, 3);
      expect(after.t4).toBe(0);

      watch.assertClean();
    });

  test('a mark fades, and an OFFLINE scanner is no scanner', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');

    await engine(page, e => { e.resetOutfit(); e.debugGrantModule('scanner_mk5'); });
    await waitForEngine(page, e => e.scannerMk === 5, 'Mk V');
    // Park on a rift so the ping is certain to cross it.
    await engine(page, e => {
      const p = e.portals[0];
      e.player.position.x = p.position.x + 600;
      e.player.position.y = p.position.y;
      e.camera.position.x = e.player.position.x;
      e.camera.position.y = e.player.position.y;
    });
    await scanOnce(page);

    // FRESH: full strength.  The alpha ramp is the ONE freshness definition
    // and both readouts call it, so measuring it here covers both.
    const fresh = await engine(page, e =>
      e.renderer.detectAlpha(e.portals[0].detectedAt));
    expect(fresh).toBeCloseTo(1, 2);

    // STALE: past LINGER_SEC the mark is gone entirely, so "faded out" and
    // "not drawn" are the same state rather than two that can disagree.
    const stale = await engine(page, e =>
      e.renderer.detectAlpha(e.simClock - 1000));
    expect(stale).toBe(0);

    // An adjacency-OFFLINE scanner contributes nothing at all — the same
    // rule every other module obeys, and the reason the fold reads ACTIVE
    // slots rather than filled ones.
    await engine(page, e => { e.resetOutfit(); e.debugGrantModule('scanner_mk3'); });
    await waitForEngine(page, e => e.scannerMk === 3, 'a scanner to isolate');
    const iso = await isolate(page, 'ship', 'hull_base', 'scanner_mk3');
    expect(iso.modActive, 'the arrangement really did isolate it').toBe(false);
    const off = await engine(page, e => ({ mk: e.scannerMk, t1: e.scanRanges[1] ?? 0 }));
    expect(off.mk, 'an OFFLINE scanner is no scanner').toBe(0);
    expect(off.t1, 'and reaches nowhere').toBe(0);

    watch.assertClean();
  });

  test('the cooldown is real, and the ping is one at a time', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await engine(page, e => { e.resetOutfit(); e.debugGrantModule('scanner_mk3'); });
    await waitForEngine(page, e => e.scannerMk === 3, 'a scanner');

    const first = await engine(page, e => e.fireScan());
    expect(first, 'the first press scans').toBe(true);
    const second = await engine(page, e => e.fireScan());
    expect(second, 'the second press is refused while the cooldown runs').toBe(false);

    // The stat the HUD button reads agrees with the engine that refused it.
    const st = await stats(page);
    expect(st.scanner?.cooldown ?? 0).toBeGreaterThan(0);
    expect(st.scanner?.mk).toBe(3);

    watch.assertClean();
  });

  test('a portal arrow needs a scan, whatever the mark', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');

    await engine(page, e => { e.resetOutfit(); e.debugGrantModule('scanner_mk5'); });
    await waitForEngine(page, e => e.scannerMk === 5, 'Mk V');
    await engine(page, e => {
      const p = e.portals[0];
      e.player.position.x = p.position.x + 700;
      e.player.position.y = p.position.y;
      e.camera.position.x = e.player.position.x;
      e.camera.position.y = e.player.position.y;
    });
    await page.waitForTimeout(250);

    // Fitted but not fired: still nothing.  The scanner is a TOOL — owning it
    // is not using it, which is the whole reversal from A4.
    expect(await portalIndicated(page), 'a scanner you never fire reveals nothing').toBe(false);

    await scanOnce(page);
    expect(await portalIndicated(page), 'the ping is what puts it there').toBe(true);

    watch.assertClean();
  });
});

// ── A5 — purchasable hex slots ──────────────────────────────────────────────

/** Fly to the hub's TRADE HUB (the one station stocking both shops) and dock
 *  through the real path — `dockAtStation` reads `nearestStation`, which is
 *  stamped by the per-step proximity pass, so the position write has to land
 *  a frame before the dock. */
async function dockAtTradeHub(page: any) {
  await startRun(page);
  await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');
  await engine(page, e => {
    const st = e.stations.find((s: any) => s.stationKind === 'tradehub');
    e.player.position.x = st.position.x;
    e.player.position.y = st.position.y;
    e.player.velocity.x = 0; e.player.velocity.y = 0;
  });
  await waitForEngine(page, e => e.nearestStation?.stationKind === 'tradehub',
    'the trade hub to come into range');
  await engine(page, e => e.dockAtStation());
  await waitForEngine(page, e => e.dockedAtStation === true, 'the dock');
}

test.describe('purchasable hex slots', () => {
  test('a shipped run has every hex, and the shop offers none', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);

    const r = await engine(page, e => ({
      ship: e.shipSlotsUnlocked, weapon: e.weaponSlotsUnlocked,
      snap: e.outfittingSnapshot(),
    }));
    // MODULE_SLOT_UNLOCK.START is the CAP today — the count is the seam for
    // the ship catalog, not a balance number set here — so a shipped run is
    // byte-identical to the one before A5 existed.
    expect(r.ship).toBe(7);
    expect(r.weapon).toBe(7);
    expect(r.snap.shipUnlocked).toBe(7);
    expect(r.snap.weaponUnlocked).toBe(7);
    expect(r.snap.shipSlotOffer, 'a full flower has nothing to sell').toBeUndefined();
    expect(r.snap.weaponSlotOffer).toBeUndefined();

    watch.assertClean();
  });

  test('a locked hex refuses every way in, and the adjacency table never moved',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);

      // Lock the flowers down to three hexes each (DBG — a shipped run has
      // nothing locked, so this is the only way to reach the state).
      await engine(page, e => { while (e.shipSlotsUnlocked !== 3) e.dbg.cycleSlotLock(); });

      const r = await engine(page, e => {
        // A DRAG onto a locked hex: refused by the move path itself, not just
        // by the missing [data-tile] in the DOM.  Placed straight into the
        // hold rather than granted, since `debugGrantModule` would auto-install
        // it into an unlocked hex — which is the NEXT claim, not this one.
        e.inventory[0] = 'plating_mk1';
        const intoLocked = e.moveModuleInternal(
          { area: 'inventory', idx: 0 }, { area: 'ship', idx: 5 });
        const intoUnlocked = e.moveModuleInternal(
          { area: 'inventory', idx: 0 }, { area: 'ship', idx: 1 });
        // …and an AUTO-install skips it: `debugGrantModule` fills the first
        // free hex, which must never be one that does not exist yet.
        e.shipSlots.fill(null);
        e.shipSlots[0] = 'hull_base';
        e.syncOutfitAfterDebugSlotLock();
        for (let i = 0; i < 6; i++) e.debugGrantModule('plating_mk1');
        return {
          intoLocked, intoUnlocked,
          lockedOccupied: e.shipSlots.slice(3).filter((x: any) => x !== null).length,
          filled: e.shipSlots.slice(0, 3).filter((x: any) => x !== null).length,
          // The fixpoint's inputs are untouched: a locked hex is an EMPTY hex,
          // and an empty hex was always invisible to it.
          hullActive: e.activeShip[0],
          platingActive: e.activeShip[1] && e.activeShip[2],
          shieldGated: e.player.maxShield,
        };
      });
      expect(r.intoLocked, 'the move path refuses a locked destination').toBe(false);
      expect(r.intoUnlocked, 'the same move into an unlocked hex still works').toBe(true);
      expect(r.lockedOccupied, 'nothing ever lands past the unlocked count').toBe(0);
      expect(r.filled, 'the unlocked hexes fill normally').toBe(3);
      expect(r.hullActive, 'the hull root is still a root').toBe(true);
      expect(r.platingActive, 'and adjacency still resolves inside the flower').toBe(true);
      expect(r.shieldGated, 'plating with no core still contributes nothing').toBe(0);

      watch.assertClean();
    });

  test('a station sells the next hex; nowhere else does', async ({ page }) => {
    const watch = await boot(page);
    await dockAtTradeHub(page);
    await engine(page, e => { while (e.shipSlotsUnlocked !== 5) e.dbg.cycleSlotLock(); });

    const offer = await engine(page, e => e.outfittingSnapshot().shipSlotOffer);
    expect(offer, 'a flower with room has an offer').toBeTruthy();
    expect(offer.available, 'the trade hub stocks both flowers').toBe(true);
    expect(offer.affordable, 'and a fresh run cannot afford it').toBe(false);

    const bought = await engine(page, (e, price: number) => {
      e.credits = price;
      const ok = e.purchaseSlot('ship');
      return { ok, unlocked: e.shipSlotsUnlocked, credits: e.credits };
    }, offer.cost);
    expect(bought.ok).toBe(true);
    expect(bought.unlocked, 'one more hex').toBe(6);
    expect(bought.credits, 'paid for at the offered price').toBe(0);

    // The newly bought hex takes a module the locked one refused.
    const usable = await engine(page, e => {
      e.debugGrantModule('plating_mk1');
      return e.shipSlots[5] !== null || e.shipSlots.indexOf('plating_mk1') !== -1;
    });
    expect(usable, 'and it is a real hex the moment it is paid for').toBe(true);

    // UNDOCKED it is refused, like every other commerce method.
    const away = await engine(page, e => {
      e.undock();
      e.credits = 1e9;
      return { ok: e.purchaseSlot('ship'), unlocked: e.shipSlotsUnlocked };
    });
    expect(away.ok, 'commerce is station-only').toBe(false);
    expect(away.unlocked).toBe(6);

    watch.assertClean();
  });

  test('the cap is the flower, and money cannot pass it', async ({ page }) => {
    const watch = await boot(page);
    await dockAtTradeHub(page);
    await engine(page, e => { while (e.shipSlotsUnlocked !== 3) e.dbg.cycleSlotLock(); });

    const r = await engine(page, e => {
      e.credits = 1e9;
      let bought = 0;
      for (let i = 0; i < 20; i++) if (e.purchaseSlot('ship')) bought++;
      return {
        bought, unlocked: e.shipSlotsUnlocked,
        offer: e.outfittingSnapshot().shipSlotOffer,
        // The OTHER flower is bought separately — the two counts are
        // independent, which is what "per ship, per group" means.
        weapon: e.weaponSlotsUnlocked,
      };
    });
    expect(r.unlocked, 'stops at the seven hexes a flower has').toBe(7);
    expect(r.bought, 'four purchases got there, and nothing more sold').toBe(4);
    expect(r.offer, 'a full flower offers nothing').toBeUndefined();
    expect(r.weapon, 'the weapon flower was not bought along the way').toBe(3);

    watch.assertClean();
  });

  test('a run reset puts the counts back', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);
    await engine(page, e => { while (e.shipSlotsUnlocked !== 4) e.dbg.cycleSlotLock(); });
    expect(await engine(page, e => e.shipSlotsUnlocked)).toBe(4);

    await engine(page, e => e.resetOutfit());
    const r = await engine(page, e => ({
      ship: e.shipSlotsUnlocked, weapon: e.weaponSlotsUnlocked,
    }));
    expect(r.ship, 'unlocks are RUN state, reset with the outfit they belong to').toBe(7);
    expect(r.weapon).toBe(7);

    watch.assertClean();
  });
});
