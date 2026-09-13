/** WEAPON BEHAVIOUR — what a shot does that is not simply "deal its damage".
 *
 *  The first tenant is the Plasma Cannon's FUSE (unified impact physics,
 *  step 5a).  The Cannon was always meant to be a heavy round with ONE blast
 *  at the end of it, and the penetration system quietly made it something
 *  else: `applyExplosionAoE` fired on EVERY hit, so a shell carrying N
 *  penetration detonated N+1 times.  Making penetration universal would have
 *  made that far worse — a full blast on every pebble the shell passed
 *  through — so the charge is now tripped only by an ACTOR, with a fuse as
 *  the fallback for a shell that meets nothing.
 *
 *  Three independently checkable claims, and the first is the one the whole
 *  change exists for:
 *
 *   1. TERRAIN DOES NOT TRIP IT — a shell through a tile deposits its
 *      penetration damage and does NOT detonate.  That is what lets a heavy
 *      round be heavy rather than being spent by the first chip of gravel.
 *   2. AN ACTOR DOES — contact with an enemy detonates it exactly once.
 *   3. NOTHING STILL ENDS IN A BLAST — the fuse goes off on schedule, so a
 *      shell fired into open space is not silently wasted.
 *
 *  Driven through the REAL collision resolver and the REAL fuse tick
 *  (harness rules 3 and 6).  Note `resolveCollision` takes the on-hit
 *  callback as its SEVENTH argument — the AoE lives in
 *  `GameEngine.handleProjectileHit`, so a call that stops at `onDeath`
 *  silently measures a world with no explosions in it at all.
 */

import { test, expect } from '@playwright/test';
import { boot, dialByName, engine, quietScene, startRun, stats, waitForStats } from './helpers';

/*  THE REST OF THIS FILE IS THE ENERGY MODEL'S OWN SUITE (step 5), moved here
 *  from `tests/modules.spec.ts` when the Penetration module was deleted.
 *  These were never module claims — they are claims about what a SHOT does,
 *  and they only lived under a module because Penetration was what made them
 *  reachable.  Every one of them reads the DAMAGE the real collision path
 *  applies rather than a flag: an effect that silently stops being folded, a
 *  bore that spends its whole shot on the entry grain, or an overkill that is
 *  quietly eaten all leave the same shapes on screen.
 *
 *  The model in one paragraph.  A round carries two numbers: `damage` is the
 *  BITE one contact deposits at the muzzle, and `mass` with `speed` fixes the
 *  ENERGY it launches with — its BANK.  A hit is measured from the speed the
 *  bolt still has, and the bolt is slowed by exactly what it deposited, so
 *  the falloff is arithmetic rather than a table.  How far it gets is then
 *  whatever it can afford: terrain charges per GRAIN, an actor charges only
 *  what it could absorb.
 */

/** The energy model, written out rather than imported (harness rule: a test
 *  that imports the constant it is checking pins nothing).
 *
 *  It is deliberately NOT multiplied by `constants.MASS_SCALE`.  Every mass
 *  in the game is 10x and this conversion is what turns mass into damage, so
 *  scaling it too would cancel the whole thing — bigger numbers, identical
 *  game.  Impacts are meant to be ten times harder; this constant staying
 *  put is how. */
const ENERGY_PER_DAMAGE = 32;
/** A bolt's bank, in bites of its own authored damage. */
const bankInBites = (damage: number, speed: number, mass: number) =>
  (0.5 * mass * speed * speed) / ENERGY_PER_DAMAGE / damage;
/** The mass that gives a round a bank of `bites`. */
const massForBank = (damage: number, speed: number, bites: number) =>
  (2 * ENERGY_PER_DAMAGE * damage * bites) / (speed * speed);
/** The bite at hit ordinal n for a round with that bank, when every contact
 *  costs a full bite (an immortal target, which is what these tests park). */
const biteAt = (damage: number, bites: number, ordinal: number) =>
  damage * Math.pow((bites - 1) / bites, ordinal);

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

/** Dial the impact-velocity ladder to 'relative'.  Index 0 ('muzzle') is what
 *  ships, so a test about closing energy has to click once.
 *
 *  WAIT for the readout rather than reading it once: `__omniStats` is
 *  republished by the rAF loop, so a read taken in the same breath as the
 *  click that changes it can still carry the pre-click payload (helpers.ts,
 *  rules 12 and 13). */
async function relativeMode(page: any) {
  await dialByName(page, 'impactVelocityName', 'relative',
    e => e.dbg.cycleImpactVelocity(), 1);
}

async function glassField(page: any) {
  await startRun(page, 'GLASS_FIELD');
  await waitForStats(page, s => s.currentMapType === 'GLASS_FIELD', 'the glass field');
}

/** WEAPONS[CANNON].fuseSeconds, hard-coded (harness rule: a test that
 *  imports the constant it is checking pins nothing). */
const CANNON_FUSE = 0.42;
const SIM_DT = 1 / 120;

test.describe('the Plasma Cannon is a heavy round, not a contact mine', () => {
  test('terrain does not trip the charge — the shell spends energy instead',
    async ({ page }) => {
      const watch = await boot(page);
      await glassField(page);

      const r = await engine(page, e => {
        const P = e.physics, p = e.player;
        const rings = () => e.currentMap.entities
          .filter((x: any) => x.active && x.isExplosionRing).length;
        const t = e.currentMap.entities.find((x: any) => x.active
          && x.shardVariant === 'glass-tile' && x.mass === Infinity
          && (x.health ?? 0) > 0 && !x.fractureEdgeFill);
        if (!t) throw new Error('no fresh glass tile');

        p.velocity.x = 0; p.velocity.y = 0;
        p.currentWeapon = 'CANNON'; p.weaponCooldown = 0;
        const before = e.currentMap.entities.length;
        e.weapons.firePlayerWeapon(e.currentMap.entities, p,
          { x: p.position.x + 500, y: p.position.y }, undefined, false);
        const proj = e.currentMap.entities.slice(before)
          .find((x: any) => x.type === 'PROJECTILE');

        const ringsBefore = rings();
        proj.position.x = t.position.x - t.size.x * 0.5 - 2;
        proj.position.y = t.position.y;
        // SEVEN arguments: the AoE hangs off the on-hit callback.
        P.resolveCollision(proj, t, { x: 0, y: 0 },
          e.spawnDamageText, e.handleEntityDeath, e.handleScreenShake, e.handleProjectileHit);

        const out = {
          ringsSpawned: rings() - ringsBefore,
          tileTook: t.maxHealth - t.health,
          detonateOn: proj.detonateOn,
          hasFuse: proj.fuseTimer !== undefined,
        };
        for (const x of e.currentMap.entities.slice(before)) x.active = false;
        return out;
      });

      // THE CLAIM.  A tile takes the shell's damage and the charge stays shut.
      expect(r.ringsSpawned, 'a tile does not set the charge off').toBe(0);
      expect(r.tileTook, 'but the shell still spends its energy on the tile')
        .toBeGreaterThan(0);
      // The two fields that make it so, so a silent loss of either is caught
      // here rather than as a mysteriously quiet Cannon.
      expect(r.detonateOn, 'the shell flies with its detonation rule').toBe('enemy');
      expect(r.hasFuse, 'and with a fuse armed').toBe(true);

      watch.assertClean();
    });

  test('an ACTOR trips it, exactly once', async ({ page }) => {
    const watch = await boot(page);
    await glassField(page);

    const r = await engine(page, e => {
      const P = e.physics, p = e.player;
      const rings = () => e.currentMap.entities
        .filter((x: any) => x.active && x.isExplosionRing).length;
      const ctx = e.waveContext();
      const foe = e.waves.spawnAt('RAMMER_1',
        { x: p.position.x + 300, y: p.position.y }, ctx, false);
      foe.maxSpeed = 0; foe.health = foe.maxHealth = 1e6;

      p.velocity.x = 0; p.velocity.y = 0;
      p.currentWeapon = 'CANNON'; p.weaponCooldown = 0;
      const before = e.currentMap.entities.length;
      e.weapons.firePlayerWeapon(e.currentMap.entities, p,
        { x: p.position.x + 500, y: p.position.y }, undefined, false);
      const proj = e.currentMap.entities.slice(before)
        .find((x: any) => x.type === 'PROJECTILE');

      const ringsBefore = rings();
      proj.position.x = foe.position.x; proj.position.y = foe.position.y;
      P.resolveCollision(proj, foe, { x: 0, y: 0 },
        e.spawnDamageText, e.handleEntityDeath, e.handleScreenShake, e.handleProjectileHit);

      const out = { ringsSpawned: rings() - ringsBefore };
      foe.active = false;
      for (const x of e.currentMap.entities.slice(before)) x.active = false;
      return out;
    });

    expect(r.ringsSpawned, 'an enemy sets it off, and once').toBe(1);

    watch.assertClean();
  });

  test('a shell that meets nothing still ends in a blast, on the fuse',
    async ({ page }) => {
      const watch = await boot(page);
      await glassField(page);

      const r = await engine(page, (e, dt: number) => {
        const p = e.player;
        const rings = () => e.currentMap.entities
          .filter((x: any) => x.active && x.isExplosionRing).length;

        p.velocity.x = 0; p.velocity.y = 0;
        p.currentWeapon = 'CANNON'; p.weaponCooldown = 0;
        const before = e.currentMap.entities.length;
        e.weapons.firePlayerWeapon(e.currentMap.entities, p,
          { x: p.position.x + 500, y: p.position.y }, undefined, false);
        const proj = e.currentMap.entities.slice(before)
          .find((x: any) => x.type === 'PROJECTILE');

        // Park it far from anything so nothing can trip it by contact.
        proj.position.x = p.position.x + 2000;
        proj.position.y = p.position.y + 2000;
        const ringsBefore = rings();
        const armed = proj.fuseTimer;

        // The REAL tick, and the index it walks has to be rebuilt or the
        // pass sees an empty list and the fuse never burns.
        let ticks = 0;
        while (proj.active && ticks < 400) {
          e.entityIndex.rebuild(e.currentMap.entities);
          e.updateProjectileFuses(dt);
          ticks++;
        }
        const out = {
          armed, ticks, ringsSpawned: rings() - ringsBefore,
          stillActive: proj.active === true,
        };
        for (const x of e.currentMap.entities.slice(before)) x.active = false;
        return out;
      }, SIM_DT);

      expect(r.armed, 'the shell launches with its fuse armed')
        .toBeCloseTo(CANNON_FUSE, 6);
      expect(r.stillActive, 'and the fuse consumes it').toBe(false);
      expect(r.ringsSpawned, 'leaving a blast behind').toBe(1);
      // Burned on SIM time, not on a frame count that happens to be close.
      expect(r.ticks * SIM_DT, 'after exactly its fuse')
        .toBeCloseTo(CANNON_FUSE, 1);

      watch.assertClean();
    });
});

// ── The energy model: what a shot can afford ────────────────────────────────

test.describe('a hit is measured from the speed the bolt still has', () => {
  test('the contact hit is the authored damage, and every hit after it decays',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);

      /*  The two claims the model rests on, in one measurement: damage is
       *  kinetic, and it is DAY-ONE NEUTRAL — a bolt at its launch speed
       *  still lands exactly the number the weapon authors — while every hit
       *  after the first decays on its own, because the bolt paid for the
       *  first one in speed.  Three targets, one bolt, read all three bites. */
      const bites = (bank: number) => engine(page, (e, a: any) => {
        const ctx = e.waveContext();
        const foes: any[] = [];
        for (let i = 1; i <= 3; i++) {
          const f = e.waves.spawnAt('RAMMER_1',
            { x: e.player.position.x + i * 200, y: e.player.position.y }, ctx, false);
          f.maxSpeed = 0; f.health = f.maxHealth = 1e6;
          foes.push(f);
        }
        const proj: any = {
          id: 'bite_' + Math.random(), type: 'PROJECTILE',
          position: { x: e.player.position.x, y: e.player.position.y },
          velocity: { x: a.speed, y: 0 }, rotation: 0,
          size: { x: 6, y: 6 }, mass: a.mass, active: true, color: '#fff',
          damage: a.damage, ownerType: 'PLAYER', ownerId: 'player',
          hitEntityIds: [], pierceHits: 0,
        };
        const out: number[] = [];
        for (const f of foes) {
          if (!proj.active) break;
          const before = f.health;
          e.physics.resolveCollision(proj, f, { x: 0, y: 0 }, undefined, e.handleEntityDeath);
          out.push(before - f.health);
        }
        foes.forEach(f => { f.active = false; });
        proj.active = false;
        return out;
      }, { damage: 10, speed: 900, mass: massForBank(10, 900, bank) });

      // NEUTRALITY: whatever the bank, the FIRST hit is the authored figure.
      // This is the property that let the whole roster keep its numbers when
      // damage became kinetic.
      const three = await bites(3);
      expect(three[0], 'the contact hit is the authored damage, exactly')
        .toBeCloseTo(10, 6);

      // And the decay is the bank's own reciprocal — no rate authored
      // anywhere, no global knob consulted.  These targets are immortal, so
      // every contact costs a full bite.
      expect(three[1], 'second bite').toBeCloseTo(biteAt(10, 3, 1), 6);
      expect(three[2], 'third bite').toBeCloseTo(biteAt(10, 3, 2), 6);

      watch.assertClean();
    });

  test('the falloff rate is PER WEAPON, because it comes out of the round\'s own mass',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);

      /*  The sharp end of retiring `PIERCE_FALLOFF_RATE`: it was ONE global
       *  number applied to every weapon equally, so under it these two bolts
       *  would decay identically.  They must not.
       *
       *  REAL SHOTS, deliberately — an earlier draft synthesised the bolts
       *  with a test-computed mass and therefore never touched the weapon
       *  table at all: it passed unchanged with the mass stripped out of the
       *  roster.  Firing the real guns pins the whole chain. */
      const walk = (weapon: string) => engine(page, (e, w: string) => {
        const ctx = e.waveContext();
        const foes: any[] = [];
        for (let i = 1; i <= 2; i++) {
          const f = e.waves.spawnAt('RAMMER_1',
            { x: e.player.position.x + i * 200, y: e.player.position.y }, ctx, false);
          f.maxSpeed = 0; f.health = f.maxHealth = 1e6;
          foes.push(f);
        }
        e.player.currentWeapon = w;
        e.player.weaponCooldown = 0;
        e.player.velocity.x = 0; e.player.velocity.y = 0;
        const before = e.currentMap.entities.length;
        e.weapons.firePlayerWeapon(e.currentMap.entities, e.player,
          { x: e.player.position.x + 500, y: e.player.position.y }, undefined, false);
        const proj = e.currentMap.entities.slice(before)
          .find((x: any) => x.type === 'PROJECTILE');
        const out = {
          mass: proj.mass, damage: proj.damage,
          speed: Math.hypot(proj.velocity.x, proj.velocity.y),
          bites: [] as number[],
        };
        for (const f of foes) {
          if (!proj.active) break;
          const hp = f.health;
          e.physics.resolveCollision(proj, f, { x: 0, y: 0 }, undefined, e.handleEntityDeath);
          out.bites.push(hp - f.health);
        }
        foes.forEach(f => { f.active = false; });
        for (const x of e.currentMap.entities.slice(before)) x.active = false;
        return out;
      }, weapon);

      // The densest round in the roster against a mid-weight one.  Same
      // damage path, different banks — and the bank is the only thing that
      // can separate their decay.
      const beam = await walk('BOUNCER');
      const burst = await walk('BURST');
      // The authored SOLVE (5 bites / 3 bites), times MASS_SCALE, over the
      // base-bank divisor — three factors now, so both are read live rather
      // than written as one product that silently means the wrong thing the
      // next time any of them moves.
      const k = await engine(page, () => {
        const M: any = (window as any).__omniMass;
        return { scale: M.MASS_SCALE, divisor: M.BASE_BANK_DIVISOR };
      });
      expect(bankInBites(beam.damage, beam.speed, beam.mass),
        'the Laser launches with the solve\'s five bites, scaled and re-based')
        .toBeCloseTo(5 * k.scale / k.divisor, 2);
      expect(bankInBites(burst.damage, burst.speed, burst.mass),
        'the Burst Rifle with three, likewise')
        .toBeCloseTo(3 * k.scale / k.divisor, 2);

      const beamDecay = beam.bites[1] / beam.bites[0];
      const burstDecay = burst.bites[1] / burst.bites[0];
      // The decay is `1 - bite/bank`, so it follows the bank wherever the
      // bank goes: MASS_SCALE made it far gentler, the base-bank divisor
      // pulled some of that back.  DERIVED from the same two constants as
      // the banks above rather than restated as a fraction, because a decay
      // written as `49/50` is a claim about a bank that has now moved twice.
      // The CLAIM is untouched and is the line below: the rate comes out of
      // the round's OWN mass, so the two weapons differ — which is exactly
      // what the retired global `PIERCE_FALLOFF_RATE` could not say.
      const beamBites = 5 * k.scale / k.divisor;
      const burstBites = 3 * k.scale / k.divisor;
      expect(beamDecay, 'the beam gave up one bite out of its own bank')
        .toBeCloseTo((beamBites - 1) / beamBites, 4);
      expect(burstDecay, 'and the burst round one out of its smaller one')
        .toBeCloseTo((burstBites - 1) / burstBites, 4);
      // The claim the retired global rate could not make at all.
      expect(beamDecay, 'a beam gives up LESS per body than a burst round')
        .toBeGreaterThan(burstDecay);

      watch.assertClean();
    });

  test('a spent bolt leaves SLOWER, and the impact-velocity ladder is live',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);

      // A DBG cycle is three separate wirings (constants accessor, dbg
      // method, stats field) and a break in any one of them is silent — the
      // row just shows a stale string.  Drive the real method and read the
      // real payload.
      const shipped = await stats(page);
      expect(shipped.impactVelocityName,
        "ships in the bolt's own launch frame, so the roster kept its numbers")
        .toContain('(def)');
      expect(shipped.impactVelocityName).toContain('muzzle');

      /** Walk one bolt through a parked, immortal enemy and report the speed
       *  it carries out — and what it hit for. */
      const through = () => engine(page, (e, a: any) => {
        const ctx = e.waveContext();
        const foe = e.waves.spawnAt('RAMMER_1',
          { x: e.player.position.x + 300, y: e.player.position.y }, ctx, false);
        foe.maxSpeed = 0; foe.health = foe.maxHealth = 1e6;
        const proj: any = {
          id: 'decay_' + Math.random(), type: 'PROJECTILE',
          position: { x: foe.position.x, y: foe.position.y },
          velocity: { x: a.speed, y: 0 }, rotation: 0,
          size: { x: 6, y: 6 }, mass: a.mass, active: true, color: '#fff',
          damage: 5, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
          pierceHits: 0,
        };
        const before = foe.health;
        e.physics.resolveCollision(proj, foe, { x: 0, y: 0 }, undefined, e.handleEntityDeath);
        const out = { speed: proj.velocity.x, bite: before - foe.health };
        foe.active = false; proj.active = false;
        return out;
      }, { speed: 900, mass: massForBank(5, 900, 4) });

      // THE RETIRED KNOB, NOW ARITHMETIC.  `PIERCE_SPEED_RETAIN` shipped at
      // 1.00 — a bolt kept all its speed through a body, and the damage
      // falloff was a SEPARATE authored rate.  Spending energy is now the
      // one mechanism behind both: the bolt leaves slower BY EXACTLY the
      // energy it deposited, which is what makes its next bite smaller.
      const r = await through();
      expect(r.bite, 'the hit is the authored damage').toBeCloseTo(5, 6);
      expect(r.speed, 'and the bolt leaves slower for having paid')
        .toBeLessThan(900);
      // Energy conservation, stated as the speed it must land on: the bank
      // was 4 bites, one is gone, so v^2 falls to 3/4 of its launch.
      expect(r.speed, 'by exactly the energy it spent')
        .toBeCloseTo(900 * Math.sqrt(3 / 4), 4);

      // One click reaches the other frame.  It is not a no-op: a bolt
      // measured against a target CLOSING on it lands harder.
      await relativeMode(page);
      const closing = await engine(page, (e, a: any) => {
        const ctx = e.waveContext();
        const foe = e.waves.spawnAt('RAMMER_1',
          { x: e.player.position.x + 300, y: e.player.position.y }, ctx, false);
        foe.maxSpeed = 0; foe.health = foe.maxHealth = 1e6;
        // Driving straight INTO the bolt: closing speed is the sum.
        foe.velocity.x = -a.speed; foe.velocity.y = 0;
        const proj: any = {
          id: 'closing_' + Math.random(), type: 'PROJECTILE',
          position: { x: foe.position.x, y: foe.position.y },
          velocity: { x: a.speed, y: 0 }, rotation: 0,
          size: { x: 6, y: 6 }, mass: a.mass, active: true, color: '#fff',
          damage: 5, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
          pierceHits: 0, spawnSpeed: a.speed,
        };
        const before = foe.health;
        e.physics.resolveCollision(proj, foe, { x: 0, y: 0 }, undefined, e.handleEntityDeath);
        const bite = before - foe.health;
        foe.active = false; proj.active = false;
        return bite;
      }, { speed: 900, mass: massForBank(5, 900, 4) });

      // Closing at 2x the launch speed is 4x the energy — the quadratic is
      // the whole of the model, and this is the property that makes the
      // ladder a real A/B rather than a relabelling.
      expect(closing, 'relative frame: a head-on target takes four times the bite')
        .toBeCloseTo(20, 4);

      watch.assertClean();
    });
});

test.describe('how far a round gets is what it can afford', () => {
  test('inside a grain body it bores GRAIN BY GRAIN, and the material sets the price',
    async ({ page }) => {
      const watch = await boot(page);

      /** Fire one synthesised bolt of `bank` bites into a fresh tile of the
       *  map's material, from just outside its left face, straight along +x. */
      const bore = (bank: number, variant: string) => engine(page, (e, a: any) => {
        const ents = e.currentMap.entities;
        const t = ents.find((x: any) => x.active && x.shardVariant === a.variant
          && x.mass === Infinity && !x.__bored);
        if (!t) throw new Error('no fresh ' + a.variant);
        t.__bored = true;
        const proj: any = {
          id: 'bore_' + Math.random(), type: 'PROJECTILE',
          position: { x: t.position.x - t.size.x * 0.5 - 2, y: t.position.y },
          velocity: { x: 900, y: 0 }, rotation: 0,
          size: { x: 6, y: 6 }, mass: a.mass, active: true, color: '#fff',
          damage: 4, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
          pierceHits: 0,
        };
        e.physics.resolveCollision(proj, t, { x: 0, y: 0 }, undefined, e.handleEntityDeath);
        const g = (window as any).__omniGrain?.grainSpecFor(a.variant);
        // maxHealth is the DERIVED boundary total the first hit installs, and
        // health mirrors the unbroken budget — so their difference IS the
        // damage this bolt actually poured into the pattern.
        return {
          dealt: t.maxHealth - t.health,
          steps: proj.pierceHits, alive: proj.active === true,
          grainSize: g?.grainSize, bondStrength: g?.bondStrength,
          halfExtent: t.size.x * 0.5,
          partials: (t.fractureEdgeFill ?? []).filter((f: number) => f > 0).length,
        };
      }, { mass: massForBank(4, 900, bank), variant });

      await quietField(page, 'GLASS_FIELD');

      // A ONE-BITE round: it can afford one grain and stops inside the pane.
      // Under a body-level rule this same round crossed the whole tile for
      // the price of one contact.
      const one = await bore(1, 'glass-tile');
      expect(one.steps, 'a one-bite round buys one grain').toBe(1);
      expect(one.dealt, 'and deposits exactly its bite').toBeCloseTo(4, 6);
      expect(one.alive, 'out of energy INSIDE the body, it stops there').toBe(false);

      // The step is a grain diameter, and the tile is several of them across —
      // the property the whole model rests on.  Stated rather than assumed,
      // because if it were false the bore would be trivially one step.
      expect(one.grainSize).toBeGreaterThan(0);
      expect(one.halfExtent).toBeGreaterThan(one.grainSize);

      // A round with real energy behind it walks the chord, paying the
      // material's own price per grain.
      const glassDeep = await bore(20, 'glass-tile');
      expect(glassDeep.steps, 'more energy, more grains').toBeGreaterThan(one.steps);
      // Successive stamps erode successive grains rather than pouring the
      // whole shot into the entry cell — with damageSpread 0 the spend runs
      // sequentially, so more than one boundary is carrying damage.
      expect(glassDeep.partials, 'the track is spread across the pattern')
        .toBeGreaterThan(1);

      // THE ENERGY-BOUND ROUND is where the material shows, and the bank has
      // to be small enough that the CHORD is not what stops it — otherwise
      // the step count is just `tileWidth / grainSize` and a finer-grained
      // material reads as SOFTER for having more grains in the way.  That is
      // exactly what a first draft of this test measured: at 20 bites both
      // rounds ran out of tile, and metal took MORE steps than glass (5 vs 3)
      // despite charging nearly three times as much a grain.
      const glass = await bore(3, 'glass-tile');
      expect(glass.alive, 'energy-bound, not chord-bound').toBe(false);

      await quietField(page, 'METAL_FIELD');
      const metal = await bore(3, 'metal-tile');
      expect(metal.alive, 'energy-bound, not chord-bound').toBe(false);

      const glassPrice = glass.grainSize! * glass.bondStrength!;
      const metalPrice = metal.grainSize! * metal.bondStrength!;
      expect(metalPrice, 'metal charges more per grain than glass')
        .toBeGreaterThan(glassPrice);
      expect(metal.steps, 'so the same round gets fewer grains into it')
        .toBeLessThan(glass.steps);

      // AND IT SPENT THE SAME ENERGY EITHER WAY.  The bank is what the round
      // has; the material only decides how many grains that buys.  This is
      // the invariant that says the price is a property of the TARGET rather
      // than a per-weapon depth authored somewhere.
      expect(metal.dealt, 'the round spends its whole bank whatever it meets')
        .toBeCloseTo(glass.dealt, 6);

      // The price itself, read back out of what each tile absorbed per grain
      // — chord-bound rounds are fine for this, since every step but possibly
      // the last is a full grain.
      const metalDeep = await bore(20, 'metal-tile');
      expect(metalDeep.dealt / metalDeep.steps, "metal's tile absorbed metal's price")
        .toBeCloseTo(metalPrice, 6);
      expect(glassDeep.dealt / glassDeep.steps, "glass's absorbed glass's")
        .toBeCloseTo(glassPrice, 6);

      watch.assertClean();
    });

  test('a round that reaches the far side keeps flying, and hits what is behind',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);
      const r = await engine(page, (e, a: any) => {
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
          size: { x: 6, y: 6 }, mass: a.mass, active: true, color: '#fff',
          damage: 4, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
          pierceHits: 0,
        };
        e.physics.resolveCollision(proj, t, { x: 0, y: 0 }, undefined, e.handleEntityDeath);
        const exited = {
          alive: proj.active === true, steps: proj.pierceHits,
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
      }, { mass: massForBank(4, 900, 60) });

      expect(r.steps, 'the chord is more than one grain long').toBeGreaterThan(1);
      expect(r.alive, 'energy left when the chord ran out: it comes out the far side')
        .toBe(true);
      // It paid the material's price per grain, not its own bite per grain —
      // and the tile's total is what it absorbed, which is that price times
      // the steps it took (the tile is not destroyed, so nothing is capped).
      expect(r.tileTook, 'the tile took the whole track').toBeGreaterThan(0);
      // And the thing behind the tile is struck, further down the curve: the
      // bolt spent real energy getting through, so it bites less than the 4
      // it launched with.
      expect(r.nextBite, 'what is behind is hit').toBeGreaterThan(0);
      expect(r.nextBite, 'but for less than the muzzle bite').toBeLessThan(4);

      watch.assertClean();
    });

  test('an indestructible tile stops the bolt dead and costs it nothing',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page, 'INDESTRUCTIBLE_FIELD');

      const r = await engine(page, (e, a: any) => {
        const t = e.currentMap.entities.find((x: any) => x.active
          && x.shardVariant === 'indestructible-tile');
        if (!t) throw new Error('no indestructible tile');
        const hp = t.health;
        const proj: any = {
          id: 'wall_' + Math.random(), type: 'PROJECTILE',
          position: { x: t.position.x - t.size.x * 0.5 - 2, y: t.position.y },
          velocity: { x: 900, y: 0 }, rotation: 0,
          size: { x: 6, y: 6 }, mass: a.mass, active: true, color: '#fff',
          damage: 4, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
          pierceHits: 0,
        };
        const v0 = Math.hypot(proj.velocity.x, proj.velocity.y);
        e.physics.resolveCollision(proj, t, { x: 0, y: 0 }, undefined, e.handleEntityDeath);
        return {
          alive: proj.active === true, steps: proj.pierceHits,
          speedKept: Math.hypot(proj.velocity.x, proj.velocity.y) / v0,
          tileAlive: t.active === true, hpMoved: t.health !== hp,
        };
      }, { mass: massForBank(4, 900, 6) });

      // The worst artifact of the body-level rule: the tile took no damage
      // and still let the bolt through, charging it on the way.
      expect(r.alive, 'impenetrable: the bolt dies on contact').toBe(false);
      expect(r.speedKept, 'and spends nothing — it took no damage, so it costs none')
        .toBeCloseTo(1, 9);
      expect(r.steps, 'nor does it step the falloff curve').toBe(0);
      expect(r.tileAlive).toBe(true);
      expect(r.hpMoved, 'the tile is unmarked').toBe(false);

      watch.assertClean();
    });

  test('overkill carries through: a body is charged only what it could take',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);

      /*  The actor-side half of "pay for what you broke".  A 10-damage bolt
       *  against a 1-HP body deposits 1, not 10 — so a shot through a swarm
       *  keeps going, and penetration falls out of the arithmetic for ACTORS
       *  exactly as the bore makes it fall out for terrain.
       *
       *  Measured as the SPEED the bolt keeps, because that is where the
       *  charge actually lands; the kill count is the visible consequence and
       *  is pinned in the Gunnery suite. */
      const r = await engine(page, (e, a: any) => {
        const ctx = e.waveContext();
        const mk = (hp: number, i: number) => {
          const f = e.waves.spawnAt('SWARM',
            { x: e.player.position.x + 300 + i * 40, y: e.player.position.y }, ctx, false);
          f.maxSpeed = 0; f.velocity.x = 0; f.velocity.y = 0;
          f.health = f.maxHealth = hp; f.shield = 0; f.maxShield = 0;
          return f;
        };
        const shoot = (hp: number, i: number) => {
          const f = mk(hp, i);
          const proj: any = {
            id: 'ok_' + Math.random(), type: 'PROJECTILE',
            position: { x: f.position.x, y: f.position.y },
            velocity: { x: a.speed, y: 0 }, rotation: 0,
            size: { x: 6, y: 6 }, mass: a.mass, active: true, color: '#fff',
            damage: 10, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
            pierceHits: 0,
          };
          const before = f.health;
          e.physics.resolveCollision(proj, f, { x: 0, y: 0 }, undefined, e.handleEntityDeath);
          const out = {
            dealt: before - Math.max(0, f.health),
            kept: Math.hypot(proj.velocity.x, proj.velocity.y) / a.speed,
          };
          f.active = false; proj.active = false;
          return out;
        };
        // A body that can take the whole bite, and one that cannot.
        return { full: shoot(1e6, 0), frail: shoot(1, 1) };
      }, { speed: 900, mass: massForBank(10, 900, 4) });

      // A body with room for the whole bite is charged for the whole bite:
      // the bank was 4, one is gone, so v^2 falls to 3/4.
      expect(r.full.dealt, 'the full bite lands').toBeCloseTo(10, 6);
      expect(r.full.kept, 'and the bolt pays for all of it')
        .toBeCloseTo(Math.sqrt(3 / 4), 6);

      // A 1-HP body absorbs 1 and the bolt is charged 1 — so it keeps
      // 39/40 of its energy rather than 3/4 of it.
      expect(r.frail.dealt, 'a frail body absorbs only what it had')
        .toBeCloseTo(1, 6);
      expect(r.frail.kept, 'and the bolt is charged only that')
        .toBeCloseTo(Math.sqrt(39 / 40), 6);

      watch.assertClean();
    });

  test('a ricochet may re-hit what it already struck; sustained contact may not',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);
      const r = await engine(page, (e, a: any) => {
        const ctx = e.waveContext();
        const foe = e.waves.spawnAt('RAMMER_1',
          { x: e.player.position.x + 300, y: e.player.position.y }, ctx, false);
        foe.maxSpeed = 0; foe.health = foe.maxHealth = 1e6;
        const tile = e.currentMap.entities.find((x: any) => x.active
          && x.shardVariant === 'glass-tile' && x.mass === Infinity);

        const beam = () => ({
          id: 'beam_' + Math.random(), type: 'PROJECTILE',
          position: { x: foe.position.x, y: foe.position.y },
          velocity: { x: a.speed, y: 0 }, rotation: 0,
          size: { x: 6, y: 6 }, mass: a.mass, active: true, color: '#fff',
          damage: 5, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
          pierceHits: 0, isBouncer: true, bouncesRemaining: 3,
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
        const afterFirst = Math.hypot(held.velocity.x, held.velocity.y);
        strike(held);
        const sustained = { alive: held.active === true, steps: held.pierceHits,
                            kept: Math.hypot(held.velocity.x, held.velocity.y) / afterFirst };

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
        const after = { alive: bounced.active === true, steps: bounced.pierceHits };
        foe.active = false; bounced.active = false;
        return { sustained, reflected, secondBite, after };
      }, { speed: 900, mass: massForBank(5, 900, 5) });

      // The reflection happened, and it emptied the struck-ID list — which is
      // where the re-hit is bought, NOT by weakening the `alreadyHit` guard
      // (that guard is what stops a beam in sustained overlap grinding a body
      // at 120Hz, and it is still doing that job below).
      expect(r.reflected.vx, 'the beam turned around').toBeLessThan(0);
      expect(r.reflected.bounces).toBe(2);
      expect(r.reflected.ids, 'a bounce clears what it has struck').toBe(0);

      // (a) Held against the body, the beam does NOT carry on: it stops on
      // the re-contact and is charged nothing for it.
      expect(r.sustained.alive, 'sustained contact ends the beam').toBe(false);
      expect(r.sustained.steps, 'and buys it no further step of the curve').toBe(1);
      expect(r.sustained.kept, 'nor does the re-contact cost it energy')
        .toBeCloseTo(1, 9);

      // (b) After a bounce the same beam strikes the same body again and
      // survives to keep going.
      expect(r.after.alive, 'a returning beam carries on').toBe(true);
      expect(r.after.steps, 'and its second damage event is its second step').toBe(2);
      expect(r.secondBite, 'at the derived curve\'s next entry')
        .toBeCloseTo(biteAt(5, 5, 1), 6);
      // ENERGY IS A LIFETIME BANK: bounces buy COVERAGE, not extra damage.
      // A beam that turns around still lands only what it can afford.
      expect(r.secondBite, 'the bounce did not refill the bank').toBeLessThan(5);

      watch.assertClean();
    });
});

/** THE BASE BANK, AND THE BLAST THAT IS NOW DERIVED FROM IT.
 *
 *  Two user calls, one model.  MASS_SCALE multiplied every round's BANK by
 *  ten along with every mass, and penetration is bank-shaped — so a base
 *  Blaster bolt punched thirty-one one-HP gnats where the pre-scale round
 *  managed four (audit §8).  The call was that TODAY'S reach is what a
 *  fully-gunned ship should have, so the base round is today's divided by
 *  what three Gunnery Mk III multiply it by.
 *
 *  And the blast was the last damage number in the roster still authored as
 *  a flat scalar while everything around it went kinetic, so it shrank into
 *  a light show.  It is a fraction of the shell's own energy now.
 *
 *  Four claims, each independently checkable and each wrong in a way nothing
 *  else reports:
 *
 *   1. THE DIVISOR IS THE GUNNERY RELATIONSHIP, read off the real catalog —
 *      the whole calibration is a claim about two tables agreeing, and
 *      `BASE_BANK_DIVISOR` is a literal that cannot see MODULE_DEFS.
 *   2. THREE MARKS PUT THE BANK BACK, measured on the round the sim flies.
 *   3. ONLY THE BANK MOVED — the BITE is untouched at every mark, so no
 *      enemy takes longer to kill and no §7 threshold shifted.
 *   4. THE BLAST IS DERIVED from the flown round, and rides the mark with it
 *      exactly ONCE (scaling it in `withGunnery` as well would double it —
 *      the authored-units bug this file already pins for `mass`).
 */
test.describe('the base bank, and the blast derived from it', () => {
  test('the divisor IS what three Gunnery Mk III grant', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);

    const r = await engine(page, () => {
      const M: any = (window as any).__omniMass;
      // Read the GRANT off the real catalog rather than restating it: the
      // constant is a literal (MODULE_DEFS is declared after the weapon
      // table and cannot be read from there), so this is the only thing
      // standing between a Gunnery retune and a silently wrong base round.
      const mk3 = M.MODULE_DEFS.find((m: any) =>
        m.family === 'gunnery' && m.mark === 3);
      return {
        catalogFrac: mk3 ? mk3.effect.damageFrac : null,
        constFrac: M.GUNNERY_MK3_DAMAGE_FRAC,
        divisor: M.BASE_BANK_DIVISOR,
      };
    });

    expect(r.catalogFrac, 'a Gunnery Mk III is in the catalog').not.toBeNull();
    expect(r.constFrac, 'and the constant matches what it actually grants')
      .toBeCloseTo(r.catalogFrac as number, 9);
    expect(r.divisor, 'so the divisor is three of them')
      .toBeCloseTo(1 + 3 * (r.catalogFrac as number), 9);

    watch.assertClean();
  });

  test('three marks put the bank back, and move only the bank', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);

    /*  Measured on the round the sim FLIES, not on the table: the authored
     *  figure passes through `projectileMassFor` (which applies MASS_SCALE)
     *  and through `withGunnery`, and the whole point of the re-base is that
     *  those two compose back to one. */
    const r = await engine(page, () => {
      const e: any = (window as any).__omniEngine;
      const M: any = (window as any).__omniMass;
      const p = e.player;
      const fire = (type: string, mult: number) => {
        p.velocity.x = 0; p.velocity.y = 0;
        p.currentWeapon = type; p.weaponCooldown = 0; p.damageMult = mult;
        const before = new Set(e.currentMap.entities.map((x: any) => x.id));
        e.weapons.firePlayerWeapon(e.currentMap.entities, p,
          { x: p.position.x + 500, y: p.position.y });
        const shot = e.currentMap.entities.find(
          (x: any) => !before.has(x.id) && x.type === 'PROJECTILE');
        const out = { mass: shot ? shot.mass : null, damage: shot ? shot.damage : null };
        for (const x of e.currentMap.entities) if (!before.has(x.id)) x.active = false;
        p.damageMult = 1;
        return out;
      };
      const g3 = 1 + 3 * M.GUNNERY_MK3_DAMAGE_FRAC;
      const types = ['BLASTER', 'BURST', 'SHOTGUN', 'BOUNCER', 'LIGHTNING', 'HOMING', 'CANNON'];
      return types.map(t => ({ type: t, base: fire(t, 1), gunned: fire(t, g3), g3 }));
    });

    for (const w of r) {
      // (2) the bank comes back to exactly what the pre-rebase solve flew.
      expect(w.gunned.mass! / w.base.mass!, `${w.type}: three marks restore the bank`)
        .toBeCloseTo(w.g3, 6);
      // (3) and the BITE is the mark's ordinary effect, untouched by any of
      // this — the re-base must not have quietly nerfed damage.
      expect(w.gunned.damage! / w.base.damage!, `${w.type}: the bite is the mark's own`)
        .toBeCloseTo(w.g3, 6);
    }

    watch.assertClean();
  });

  test('the blast is derived from the shell, and rides a mark exactly once',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);

      const r = await engine(page, () => {
        const e: any = (window as any).__omniEngine;
        const M: any = (window as any).__omniMass;
        const p = e.player;
        const fire = (mult: number) => {
          p.velocity.x = 0; p.velocity.y = 0;
          p.currentWeapon = 'CANNON'; p.weaponCooldown = 0; p.damageMult = mult;
          const before = new Set(e.currentMap.entities.map((x: any) => x.id));
          e.weapons.firePlayerWeapon(e.currentMap.entities, p,
            { x: p.position.x + 500, y: p.position.y });
          const shot = e.currentMap.entities.find(
            (x: any) => !before.has(x.id) && x.type === 'PROJECTILE');
          const out = {
            mass: shot ? shot.mass : null,
            blast: shot ? shot.explosionDamage : null,
            speed: shot ? Math.hypot(shot.velocity.x, shot.velocity.y) : null,
          };
          for (const x of e.currentMap.entities) if (!before.has(x.id)) x.active = false;
          p.damageMult = 1;
          return out;
        };
        const g3 = 1 + 3 * M.GUNNERY_MK3_DAMAGE_FRAC;
        return {
          authored: M.WEAPONS.CANNON.explosionDamage ?? null,
          base: fire(1), gunned: fire(g3), g3,
          coupling: M.BLAST_ENERGY_COUPLING,
          perDamage: M.IMPACT_ENERGY_PER_DAMAGE,
        };
      });

      // (4a) the config authors NO splash — absent is what "derive it" means.
      expect(r.authored, 'the player Cannon authors no explosionDamage').toBeNull();

      // (4b) the shell flies a blast derived from its OWN energy.
      const expected = 0.5 * r.base.mass! * r.base.speed! * r.base.speed!
        / r.perDamage * r.coupling;
      expect(r.base.blast!, 'the blast is a fraction of the shell\'s energy')
        .toBeCloseTo(expected, 4);

      // (4c) a mark reaches it exactly ONCE, through the round's mass.  The
      // bank grows by g3 and the blast is linear in mass, so the blast grows
      // by g3 too — g3² would be `withGunnery` scaling it a second time.
      expect(r.gunned.blast! / r.base.blast!, 'a mark reaches the blast once')
        .toBeCloseTo(r.g3, 6);

      watch.assertClean();
    });

  test('a charged shell is heavier in AUTHORED units, not scaled twice',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);

      /*  `WeaponConfig.mass` is the AUTHORED figure and `projectileMassFor`
       *  is what converts it, so writing that function's RESULT back into the
       *  field makes the next conversion scale it again.  `withGunnery` had
       *  exactly this bug and it was fixed; `chargedConfigOf` had it too and
       *  kept it, so every charged shot flew MASS_SCALE times too heavy —
       *  invisible except as a charge that punched through the world. */
      const r = await engine(page, () => {
        const e: any = (window as any).__omniEngine;
        const p = e.player;
        // A charged shot needs the Overcharge unlock, or `chargedConfigOf`
        // never runs and both arms measure the same ordinary round.
        p.overchargeUnlocked = true;
        const fire = (type: string, charged: boolean) => {
          p.velocity.x = 0; p.velocity.y = 0;
          p.currentWeapon = type; p.weaponCooldown = 0;
          const before = new Set(e.currentMap.entities.map((x: any) => x.id));
          // `charged` is the FIFTH argument — onShake sits between.
          e.weapons.firePlayerWeapon(e.currentMap.entities, p,
            { x: p.position.x + 500, y: p.position.y }, undefined, charged);
          const shot = e.currentMap.entities.find(
            (x: any) => !before.has(x.id) && x.type === 'PROJECTILE');
          const mass = shot ? shot.mass : null;
          for (const x of e.currentMap.entities) if (!before.has(x.id)) x.active = false;
          return mass;
        };
        return {
          blasterBase: fire('BLASTER', false), blasterCharged: fire('BLASTER', true),
          homingBase: fire('HOMING', false), homingCharged: fire('HOMING', true),
        };
      });

      // The authored multipliers are 20 (Blaster) and 2 (Seeker).  Scaled
      // twice they would read 200 and 20 — which is what shipped.
      expect(r.blasterCharged! / r.blasterBase!, 'a charged Blaster is 20x, not 200x')
        .toBeCloseTo(20, 6);
      expect(r.homingCharged! / r.homingBase!, 'a charged Seeker is 2x, not 20x')
        .toBeCloseTo(2, 6);

      watch.assertClean();
    });
});

/** THE THIRD DETONATION CRITERION: a shell that STOPS, blasts.
 *
 *  `detonateOn: 'enemy'` is what stops a heavy round being a contact mine —
 *  terrain does not trip the charge, the shell bores instead.  The gap that
 *  left is what the user reported: a Cannon fired into tiles or shards simply
 *  VANISHED.  The fuse could never reach it, because a projectile deactivated
 *  where it stopped is pooled by the entity-compaction pass at the end of
 *  `updatePhysics` — and `releaseToPool` strips `explosionRadius` and
 *  `explosionDamage`, so by the time `updateProjectileFuses` ran there was
 *  nothing left to detonate.  That mid-step pooling is the whole reason the
 *  stop site leaves the round ALIVE and lets the fuse pass end it.
 *
 *  Two claims, and the second is the one that keeps the first honest:
 *
 *   1. A round whose BANK runs dry against terrain blasts where it stopped.
 *   2. A round detonates AT MOST ONCE — an actor contact already fires the
 *      charge, and the stop rule must not fire a second one on top.
 */
test.describe('a shell that runs out of travel energy blasts where it stops', () => {
  test('terrain stops the round, and the charge goes off there', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);

    const r = await engine(page, () => {
      const e: any = (window as any).__omniEngine;
      const p = e.player;
      const ctx = e.waveContext();
      const tile = e.currentMap.entities.find((x: any) => x.active
        && x.mass === Infinity && x.type === 'STRUCTURE'
        && x.shardVariant && x.shardVariant !== 'nebula-tile');
      if (!tile) return { witnessLost: -1, detonated: false };

      // A WITNESS inside the blast radius but not the thing struck, so what
      // it loses is purely the shockwave.
      const witness = e.waves.spawnAt('RAMMER_1',
        { x: tile.position.x, y: tile.position.y + 55 }, ctx, false);
      witness.maxSpeed = 0; witness.velocity.x = 0; witness.velocity.y = 0;
      witness.health = witness.maxHealth = 1e6;
      witness.shield = 0; witness.maxShield = 0;

      p.velocity.x = 0; p.velocity.y = 0;
      p.currentWeapon = 'CANNON'; p.weaponCooldown = 0;
      const before = new Set(e.currentMap.entities.map((x: any) => x.id));
      e.weapons.firePlayerWeapon(e.currentMap.entities, p,
        { x: p.position.x + 500, y: p.position.y });
      const sh = e.currentMap.entities.find(
        (x: any) => !before.has(x.id) && x.type === 'PROJECTILE');
      for (const x of e.currentMap.entities) {
        if (!before.has(x.id) && x !== sh) x.active = false;
      }
      if (!sh) return { witnessLost: -1, detonated: false };

      // Park it beside the tile with a bank far below ONE GRAIN of the
      // material, so the contact the real step finds is a STOP rather than a
      // bore.  That is what "ran out of mechanical travel energy" means, and
      // it is reached long before the 0.42s fuse — so a blast here can only
      // be the stop rule.
      sh.position.x = tile.position.x - 30;
      sh.position.y = tile.position.y;
      sh.velocity.x = 2; sh.velocity.y = 0;
      sh.mass = 0.02;
      sh.hitEntityIds = [];

      // The REAL substep, because the hand-off from the stop to the fuse pass
      // is an ordering property of it: physics arms the round, the compaction
      // would pool it, the fuse pass ends it.
      let detonatedWhile = false;
      for (let i = 0; i < 40; i++) {
        e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120);
        if (sh.detonated) detonatedWhile = true;
      }
      const witnessLost = 1e6 - witness.health;
      witness.active = false;
      // Well inside the 0.42s fuse (50 substeps), so nothing here is the fuse.
      return { witnessLost, detonated: detonatedWhile, substeps: 40 };
    });

    expect(r.witnessLost, 'a tile was found to stop the round on').toBeGreaterThanOrEqual(0);
    expect(r.detonated, 'the stopped round fired its charge').toBe(true);
    expect(r.witnessLost, 'and a bystander in the radius actually took it')
      .toBeGreaterThan(0);

    watch.assertClean();
  });

  test('a round detonates at most once, however it ends', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);

    /*  An ACTOR contact already fires the charge.  A round drained to nothing
     *  then takes BOTH paths — it hit an actor AND it stopped — so a naive
     *  "detonate wherever it is deactivated" blasts twice.  `detonated` is
     *  checked in TWO places (the stop site refuses to arm, and the fuse pass
     *  refuses to fire), so this goes red only when BOTH are removed —
     *  measured: two damaging rings instead of one.  That is defence in
     *  depth rather than a redundant check, and worth knowing before
     *  "simplifying" either one away. */
    const r = await engine(page, () => {
      const e: any = (window as any).__omniEngine;
      const p = e.player;
      const ctx = e.waveContext();
      const mk = (dx: number, dy: number) => {
        const f = e.waves.spawnAt('RAMMER_1',
          { x: p.position.x + dx, y: p.position.y + dy }, ctx, false);
        f.maxSpeed = 0; f.velocity.x = 0; f.velocity.y = 0;
        f.health = f.maxHealth = 1e6; f.shield = 0; f.maxShield = 0;
        return f;
      };
      const direct = mk(400, 0);
      const bystander = mk(400, 55);
      p.velocity.x = 0; p.velocity.y = 0;
      p.currentWeapon = 'CANNON'; p.weaponCooldown = 0;
      const before = new Set(e.currentMap.entities.map((x: any) => x.id));
      e.weapons.firePlayerWeapon(e.currentMap.entities, p,
        { x: p.position.x + 500, y: p.position.y });
      const sh = e.currentMap.entities.find(
        (x: any) => !before.has(x.id) && x.type === 'PROJECTILE');
      for (const x of e.currentMap.entities) {
        if (!before.has(x.id) && x !== sh) x.active = false;
      }
      if (!sh) return { rings: -1, blast: 0, lost: 0 };
      // Drain it so the SAME contact is both "hit an actor" and "stopped".
      sh.position.x = direct.position.x; sh.position.y = direct.position.y;
      sh.mass = 0.02; sh.velocity.x = 2; sh.velocity.y = 0;
      sh.hitEntityIds = [];
      const blast = sh.explosionDamage;
      for (let i = 0; i < 40; i++) {
        e.prepareFrameEntities(); e.updatePhysics(1 / 120); e.updateGameLogic(1 / 120);
      }
      // Rings are the countable artefact: one detonation, one damaging ring.
      const rings = e.currentMap.entities.filter(
        (x: any) => x.isExplosionRing && (x.explosionDamage ?? 0) > 0).length;
      const lost = 1e6 - bystander.health;
      direct.active = false; bystander.active = false;
      return { rings, blast, lost };
    });

    expect(r.rings, 'exactly one damaging ring, not two').toBe(1);
    // And the bystander took at most ONE blast's worth — the ring's own
    // distance falloff halves it at half the radius, so two would exceed it.
    expect(r.lost, 'so the bystander cannot have taken two blasts')
      .toBeLessThanOrEqual(r.blast);

    watch.assertClean();
  });
});
