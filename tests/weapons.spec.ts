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
import { boot, engine, startRun, waitForStats } from './helpers';

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
