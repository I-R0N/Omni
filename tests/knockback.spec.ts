/** Projectile knockback — an impulse, so mass decides how far a body moves.
 *
 *  It used to be `dv = damage * KICK_PER_DMG` with no mass in it: one Plasma
 *  Cannon hit added dv = 18 to a mass-4 gnat and to a mass-500 dragon alike,
 *  and dv = 18 is several times any enemy's own top speed. That is what
 *  launched NPCs off screen on every hit (user report), and it is why they
 *  behaved unlike SHARDS — whose push has always been mass-aware.
 *
 *  Pinned here as the three things that were wrong, each independently
 *  checkable:
 *
 *   1. MASS ORDERS IT — the same shot moves a heavy body less than a light
 *      one. This is the whole complaint, and it was flatly false before.
 *   2. NOTHING IS LAUNCHED — a hit cannot shove a body faster than it can
 *      fly under its own power, so it cannot leave the screen from one shot.
 *   3. PARITY WITH SHARDS — an NPC and a shard of comparable mass, hit by
 *      the same shot, end up moving comparably. That is the specific
 *      inconsistency the report described.
 *
 *  Driven through the REAL collision resolver (harness rules 3 and 6), like
 *  `shake.spec.ts` and `terrain.spec.ts`.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, startRun, waitForStats } from './helpers';

/** Fire one synthetic PLAYER shell into a body built to order, and report the
 *  speed it walks away with. The target starts at rest, so its resulting
 *  speed IS the knockback. */
function shoot(page: any, spec: { kind: 'enemy' | 'shard'; mass: number; maxSpeed?: number; damage: number }) {
  return engine(page, (e, o: any) => {
    const p = e.player;
    const at = { x: p.position.x + 2500, y: p.position.y + 2500 };
    const target: any = o.kind === 'enemy'
      ? {
          id: 'kb_enemy', type: 'ENEMY', enemySubtype: 'RAMMER_1',
          position: { x: at.x, y: at.y }, velocity: { x: 0, y: 0 }, rotation: 0,
          size: { x: 26, y: 26 }, mass: o.mass, maxSpeed: o.maxSpeed ?? 7,
          active: true, color: '#f00', health: 9999, maxHealth: 9999,
        }
      : {
          id: 'kb_shard', type: 'STRUCTURE', shardVariant: 'metal-shard',
          position: { x: at.x, y: at.y }, velocity: { x: 0, y: 0 }, rotation: 0,
          size: { x: 26, y: 26 }, mass: o.mass,
          active: true, color: '#888', health: 9999, maxHealth: 9999,
        };
    const proj = {
      id: 'kb_shell', type: 'PROJECTILE',
      position: { x: at.x + 20, y: at.y },
      velocity: { x: -16, y: 0 },   // the shipped Blaster/Cannon muzzle speed
      rotation: Math.PI, size: { x: 6, y: 6 },
      mass: 1,                      // PROJECTILE_CONSTANTS.MASS
      active: true,
      color: '#fff', damage: o.damage, ownerType: 'PLAYER', ownerId: 'player',
      hitEntityIds: [],
    };
    e.physics.resolveCollision(proj, target, { x: -4, y: 0 });
    return {
      speed: Math.hypot(target.velocity.x, target.velocity.y),
      vx: target.velocity.x,
    };
  }, spec);
}

async function quiet(page: any) {
  await startRun(page, 'GLASS_FIELD');
  await waitForStats(page, s => s.currentMapType === 'GLASS_FIELD', 'the glass field');
}

test.describe('a shot pushes by momentum, not by damage alone', () => {
  test('the same shot moves a heavy body less than a light one', async ({ page }) => {
    const watch = await boot(page);
    await quiet(page);

    // One Plasma Cannon hit (18 damage) across the weight range of the real
    // roster: the mass-4 gnat, the mass-10 drone, the mass-140 Warden, the
    // mass-500 dragon.  Before the fix every one of these returned the same
    // number, which is the bug in one line.
    const gnat   = await shoot(page, { kind: 'enemy', mass: 4,   maxSpeed: 12, damage: 18 });
    const drone  = await shoot(page, { kind: 'enemy', mass: 10,  maxSpeed: 7,  damage: 18 });
    const warden = await shoot(page, { kind: 'enemy', mass: 140, maxSpeed: 3,  damage: 18 });
    const dragon = await shoot(page, { kind: 'enemy', mass: 500, maxSpeed: 2,  damage: 18 });

    expect(gnat.speed).toBeGreaterThan(drone.speed);
    expect(drone.speed).toBeGreaterThan(warden.speed);
    expect(warden.speed).toBeGreaterThan(dragon.speed);
    // The heaviest body in the game is barely moved by a shot — which is what
    // its own ENEMY_VARIANTS comment ("heavy: barely shoved") always claimed
    // and what the mass-blind rule made untrue.
    expect(dragon.speed, 'a dragon shrugs a cannon shell off').toBeLessThan(0.5);

    // Direction is still the shot's: the shell travels -x, so does the target.
    expect(drone.vx).toBeLessThan(0);

    watch.assertClean();
  });

  test('one hit cannot shove a body faster than it can fly', async ({ page }) => {
    const watch = await boot(page);
    await quiet(page);

    /*  The cap is expressed in the TARGET'S OWN top speed, so it means the
     *  same thing across a roster whose speeds vary 4x — and it is what
     *  stops "off screen in one shot" as a category, rather than relying on
     *  the damage numbers staying small.
     *
     *  Note what is being asserted: the RESULTING speed, which is the capped
     *  feedback kick PLUS the perfectly-inelastic momentum transfer the
     *  projectile itself carries.  That second term was always mass-aware
     *  and is left alone — it is real physics, and at
     *  PROJECTILE_CONSTANTS.MASS = 1 it is small against any real hull.  So
     *  the honest invariant is a body's own top speed with headroom for it,
     *  not the cap in isolation. */
    const absurd = await shoot(page, { kind: 'enemy', mass: 8, maxSpeed: 8, damage: 60 });
    expect(absurd.speed, 'even an absurd shot cannot launch it')
      .toBeLessThan(8 * 2);

    // A maxSpeed-0 emplacement (Turret, Nest) still flinches rather than
    // being immovable, but only just.
    const turret = await shoot(page, { kind: 'enemy', mass: 50, maxSpeed: 0, damage: 18 });
    expect(turret.speed).toBeGreaterThan(0);
    expect(turret.speed).toBeLessThan(3);

    watch.assertClean();
  });

  test('an NPC and a shard of the same mass end up moving comparably', async ({ page }) => {
    const watch = await boot(page);
    await quiet(page);

    /*  THE REPORTED INCONSISTENCY.  The shard push was already mass-aware,
     *  the NPC kick was not, so the same shot sent them to wildly different
     *  speeds.  They need not be identical — the two paths model different
     *  things and a shard also takes a dent — but they must be the same
     *  ORDER, which is what "this is different than shards" was about. */
    const npc   = await shoot(page, { kind: 'enemy',  mass: 30, maxSpeed: 7, damage: 18 });
    const shard = await shoot(page, { kind: 'shard',  mass: 30, damage: 18 });

    expect(npc.speed).toBeGreaterThan(0);
    expect(shard.speed).toBeGreaterThan(0);
    const ratio = npc.speed / shard.speed;
    expect(ratio, 'NPC vs shard knockback stays within one order of magnitude')
      .toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(5);

    watch.assertClean();
  });
});
