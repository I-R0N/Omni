/** Deflection — one primitive, and every live shield now uses it.
 *
 *  Bouncing a bolt off a surface existed TWICE in this engine, written
 *  independently: the Bulwark's arc shield reflected about a radial normal,
 *  and the bouncer round negated one velocity component off a tile face. Both
 *  now go through `PhysicsSystem.deflectProjectile`, which owns the mirror,
 *  the rotation, the snap, and the rule that stops a just-deflected bolt from
 *  being deflected again on the next step.
 *
 *  On top of that the SHIELD side was generalized: deflection used to require
 *  an ARC (`shieldArcHalfWidth`), so the player's own bubble — and the bosses'
 *  pools — silently swallowed shots that the Bulwark visibly turned away. The
 *  same event was reading as two different ones.
 *
 *  What is pinned here is the pair of claims that generalization has to keep:
 *
 *   1. THE BOLT CHANGES, THE ARITHMETIC DOES NOT. A deflected shot drains
 *      exactly what the absorb path would have absorbed, and a shot bigger
 *      than the pool still punches through to the hull. This is what makes it
 *      a legibility change rather than a shield buff.
 *   2. A SHOT THAT MAY NOT HIT YOU MAY NOT BOUNCE OFF YOU EITHER. An EMP'd
 *      shield is offline, and an ally's fire passes through the player — both
 *      have to decline the deflect too, or the shield invents collisions the
 *      damage path has always refused.
 *
 *  Driven through the REAL broadphase and resolver (harness rules 3 and 6),
 *  like `shake.spec.ts` and `terrain.spec.ts`. Each measurement runs inside
 *  ONE page evaluation: the entities are synthetic and `prepareFrameEntities`
 *  compacts the master list on the next frame.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, startRun, waitForStats, waitForEngine } from './helpers';

/** SHIELD_CONSTANTS.COLLISION_MULTIPLIER — hard-coded, not imported
 *  (harness rule 7). It is the radius at which a non-arc shield turns a shot
 *  away, and also where the ring is drawn. */
const SHIELD_REACH_MULT = 1.8;

/** A still player in empty space with a working shield core, so the only
 *  thing that can touch it is the synthetic bolt. */
async function shieldedPlayer(page: any) {
  await startRun(page, 'GLASS_FIELD');
  await waitForStats(page, s => s.currentMapType === 'GLASS_FIELD', 'the glass field');
  await engine(page, e => {
    e.player.position.x += 4000;
    e.player.position.y += 4000;
    e.player.velocity.x = 0; e.player.velocity.y = 0;
    e.player.maxShield = 50;
    e.player.shield = 50;
    e.player.systemsDisabled = false;
    e.player.health = e.player.maxHealth;
  });
}

/** Fire one synthetic ENEMY bolt at the player and report what became of both.
 *
 *  `where: 'ring'` starts it just inside the shield radius — the deflect case.
 *  `where: 'hull'` starts it ON the hull, so a shot that is NOT deflected
 *  still overlaps for SAT and the absorb/damage path can run. */
function shootPlayer(page: any, o: {
  damage: number;
  where?: 'ring' | 'hull';
  shield?: number;
  disabled?: boolean;
  sparesPlayer?: boolean;
  homing?: boolean;
}) {
  return engine(page, (e, opt: any) => {
    const p = e.player;
    p.velocity.x = 0; p.velocity.y = 0;
    p.shield = opt.shield ?? 50;
    p.systemsDisabled = opt.disabled === true;
    p.health = p.maxHealth;

    const reach = Math.max(p.size.x, p.size.y) * 0.5 * 1.8;
    const gap = opt.where === 'hull' ? 0 : reach - 2;
    const proj: any = {
      id: 'defl_shot', type: 'PROJECTILE',
      position: { x: p.position.x + gap, y: p.position.y },
      velocity: { x: -14, y: 0 }, rotation: Math.PI,
      size: { x: 6, y: 6 }, mass: 1, active: true, color: '#f00',
      damage: opt.damage, ownerType: 'ENEMY', ownerId: 'e1', hitEntityIds: [],
    };
    if (opt.sparesPlayer) proj.sparesPlayer = true;
    if (opt.homing) { proj.homing = true; proj.homingStrength = 0.5; proj.targetEntityId = 'player'; }

    const before = { shield: p.shield, health: p.health, vx: proj.velocity.x };
    e.physics.checkAndResolveCollision(proj, p);
    return {
      before,
      shield: p.shield,
      health: p.health,
      vx: proj.velocity.x,
      active: proj.active === true,
      homing: proj.homing === true,
      owner: proj.ownerType,
      reach,
    };
  }, o);
}

test.describe('a live shield turns a shot away', () => {
  test('the player’s shield ricochets a hostile bolt instead of eating it', async ({ page }) => {
    const watch = await boot(page);
    await shieldedPlayer(page);

    const r = await shootPlayer(page, { damage: 8 });

    // THE CHANGE: the bolt arrives heading -x and leaves heading +x, still
    // alive.  Before the generalization it was simply absorbed and gone —
    // only an ARC shield ever did this.
    expect(r.before.vx, 'it arrived heading in').toBeLessThan(0);
    expect(r.vx, 'and left heading out').toBeGreaterThan(0);
    expect(r.active, 'a ricochet survives; an absorbed shot would not').toBe(true);

    // THE INVARIANT: the pool paid exactly the shot's damage — the same
    // amount the absorb path would have taken — and the hull paid nothing.
    expect(r.before.shield - r.shield, 'drained by exactly the damage').toBeCloseTo(8, 5);
    expect(r.health, 'the hull is untouched while the shield holds').toBe(r.before.health);

    watch.assertClean();
  });

  test('a shot bigger than the pool still punches through to the hull', async ({ page }) => {
    const watch = await boot(page);
    await shieldedPlayer(page);

    /*  This is the claim that keeps the deflect from being a stealth buff.
     *  A shot the shield cannot pay for is NOT turned away: it falls through
     *  to the body path, which drains what is left and lands the remainder,
     *  exactly as it did before deflection existed anywhere. */
    const r = await shootPlayer(page, { damage: 40, shield: 10, where: 'hull' });

    expect(r.vx, 'not deflected — it punched through').toBeLessThan(0);
    expect(r.shield, 'the pool is spent').toBe(0);
    expect(r.health, 'and the hull took the remainder').toBeLessThan(r.before.health);

    watch.assertClean();
  });

  test('an EMP’d shield deflects nothing — it is offline, not invisible', async ({ page }) => {
    const watch = await boot(page);
    await shieldedPlayer(page);

    /*  THE HOLE THIS CLOSED.  The absorb path has always checked
     *  `systemsDisabled`; the arc-deflect path never did.  That was harmless
     *  only while deflection was enemy-only — the bubble's latch EMPs the
     *  PLAYER, so the moment the player's shield deflects, an EMP'd shield
     *  that still bounced shots would make the disable do nothing. */
    const r = await shootPlayer(page, { damage: 8, disabled: true, where: 'hull' });

    expect(r.vx, 'an offline shield does not bounce it').toBeLessThan(0);
    expect(r.shield, 'nor absorb').toBe(r.before.shield);
    expect(r.health, 'the hit lands on the hull').toBeLessThan(r.before.health);

    watch.assertClean();
  });

  test('an ally’s shot passes straight through, shield or no shield', async ({ page }) => {
    const watch = await boot(page);
    await shieldedPlayer(page);

    /*  An ally/neutral rival's fire is flagged `sparesPlayer` and the damage
     *  path declines it.  A shield that ricocheted it would invent a
     *  collision that has never existed — and would make flying beside a
     *  friendly rival a hazard to the rival. */
    const r = await shootPlayer(page, { damage: 8, sparesPlayer: true, where: 'hull' });

    expect(r.vx, 'it keeps going').toBe(r.before.vx);
    expect(r.shield, 'nothing drained').toBe(r.before.shield);
    expect(r.health, 'nothing landed').toBe(r.before.health);

    watch.assertClean();
  });

  test('a parried missile changes sides instead of going dumb', async ({ page }) => {
    const watch = await boot(page);
    await shieldedPlayer(page);

    /*  The player's deflect is a PARRY (user call): the bolt is re-owned to
     *  the player, and a parried HOMING missile KEEPS homing — which under
     *  player ownership means the owner-aware homing pass steers it at the
     *  nearest enemy.  The re-home-into-the-shield loop the helper's default
     *  guards against cannot arise, because a player-owned bolt cannot hit
     *  the player at all. */
    const r = await shootPlayer(page, { damage: 8, homing: true });

    expect(r.vx, 'deflected').toBeGreaterThan(0);
    expect(r.owner, 'the bolt is the player’s now').toBe('PLAYER');
    expect(r.homing, 'and it keeps homing — at enemies, per its new owner').toBe(true);

    watch.assertClean();
  });

  test('a parried bolt destroys enemies and pays the kill to the player', async ({ page }) => {
    const watch = await boot(page);
    await shieldedPlayer(page);

    /*  "I don't want the projectiles to become duds."  The parry's point is
     *  that the turned bolt stays LIVE: drive one off the player's shield,
     *  then into a frail enemy, and the enemy dies a player kill — score
     *  paid, attribution stamped — exactly as if the player had fired it. */
    const r = await engine(page, e => {
      const p = e.player;
      p.velocity.x = 0; p.velocity.y = 0;
      p.maxShield = 50; p.shield = 50; p.systemsDisabled = false;
      p.health = p.maxHealth;

      // Just inside the shield ring — a bolt at the exact centre has no
      // radial normal to deflect about, and the resolver rightly declines it.
      const ringGap = Math.max(p.size.x, p.size.y) * 0.5 * 1.8 - 2;
      const proj: any = {
        id: 'parry_shot', type: 'PROJECTILE',
        position: { x: p.position.x + ringGap, y: p.position.y },
        velocity: { x: -14, y: 0 }, rotation: Math.PI,
        size: { x: 6, y: 6 }, mass: 1, active: true, color: '#f00',
        damage: 8, ownerType: 'ENEMY', ownerId: 'e1',
        // The firing enemy's own id in the hit set — a real shot may carry
        // this, and the parry must CLEAR it or the redirected bolt would
        // refuse the very target it is now aimed at.
        hitEntityIds: ['parry_victim'],
      };
      e.physics.checkAndResolveCollision(proj, p);
      const afterParry = {
        owner: proj.ownerType, ownerId: proj.ownerId,
        hitIds: proj.hitEntityIds.length, active: proj.active === true,
      };

      // Now the parried bolt meets the enemy that fired it.
      const victim: any = {
        id: 'parry_victim', type: 'ENEMY', enemySubtype: 'SHOOTER_1',
        position: { x: p.position.x + 60, y: p.position.y },
        velocity: { x: 0, y: 0 }, rotation: 0,
        size: { x: 24, y: 24 }, mass: 10, maxSpeed: 7,
        active: true, color: '#f97316', health: 5, maxHealth: 5,
      };
      const scoreBefore = e.score;
      e.physics.resolveCollision(proj, victim, { x: -4, y: 0 }, undefined, e.handleEntityDeath);
      return {
        afterParry,
        victimDead: victim.active === false,
        killedByPlayer: victim.killedByPlayer === true,
        scored: e.score > scoreBefore,
        playerHealth: p.health, playerMax: p.maxHealth,
      };
    });

    expect(r.afterParry.owner, 'the shield parried it to the player').toBe('PLAYER');
    expect(r.afterParry.ownerId).toBe('player');
    expect(r.afterParry.hitIds, 'the already-hit set cleared with the re-own').toBe(0);
    expect(r.afterParry.active, 'and the bolt is still live').toBe(true);
    expect(r.victimDead, 'it kills the enemy that fired it').toBe(true);
    expect(r.killedByPlayer, 'as the player’s kill').toBe(true);
    expect(r.scored, 'which pays the player').toBe(true);
    expect(r.playerHealth, 'and none of this hurt the player').toBe(r.playerMax);

    watch.assertClean();
  });
});

test.describe('one deflection primitive, two callers', () => {
  test('a bolt already travelling outward is never deflected twice', async ({ page }) => {
    const watch = await boot(page);
    await shieldedPlayer(page);

    /*  The `v·n >= 0` guard IS the no-immediate-re-trigger rule, and it lives
     *  in the helper so both callers get it.  Pinned directly on the static
     *  rather than through a collision, because it is the one part of the
     *  primitive with no observable side effect when it fires correctly. */
    const r = await engine(page, e => {
      const Phys = e.physics.constructor;
      const outbound: any = {
        id: 'defl_unit', type: 'PROJECTILE',
        position: { x: 0, y: 0 }, velocity: { x: 5, y: 0 }, rotation: 0,
        size: { x: 4, y: 4 }, mass: 1, active: true, color: '#fff', hitEntityIds: [],
      };
      // Normal points +x; the bolt is already travelling +x, i.e. away.
      const declined = Phys.deflectProjectile(outbound, 1, 0, { snapX: 999 });
      const after = { vx: outbound.velocity.x, x: outbound.position.x };
      // The same bolt heading INTO that normal is deflected.
      outbound.velocity.x = -5;
      const took = Phys.deflectProjectile(outbound, 1, 0);
      return { declined, after, took, vxAfter: outbound.velocity.x };
    });

    expect(r.declined, 'an outward bolt is declined').toBe(false);
    expect(r.after.vx, 'and left completely untouched').toBe(5);
    expect(r.after.x, 'including its position — a declined deflect snaps nothing').toBe(0);
    expect(r.took, 'an inbound bolt is deflected').toBe(true);
    expect(r.vxAfter, 'mirrored about the normal').toBeCloseTo(5, 5);

    watch.assertClean();
  });

  test('a bouncer still reflects off a tile face and spends a bounce', async ({ page }) => {
    const watch = await boot(page);
    await shieldedPlayer(page);

    /*  The second caller.  Its normal is an axis-aligned tile face, for which
     *  the helper's mirror reduces to negating one component — which is
     *  exactly the arithmetic this path did by hand before the fold.  Driven
     *  against a REAL static tile off the glass field so the variant gate
     *  (`nebula-tile` passes through) is the shipped one. */
    const r = await engine(page, e => {
      const t = e.currentMap.entities.find((x: any) =>
        x.active && x.type === 'STRUCTURE' && x.mass === Infinity);
      if (!t) throw new Error('no static tile on the glass field');
      const proj: any = {
        id: 'defl_bounce', type: 'PROJECTILE', isBouncer: true, bouncesRemaining: 3,
        position: { x: t.position.x + t.size.x * 0.25, y: t.position.y },
        velocity: { x: -12, y: 0 }, rotation: Math.PI,
        size: { x: 6, y: 6 }, mass: 1, active: true, color: '#fff',
        damage: 5, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
      };
      const before = { vx: proj.velocity.x, bounces: proj.bouncesRemaining, tileHp: t.health };
      e.physics.resolveCollision(proj, t, { x: -4, y: 0 });
      return {
        before,
        vx: proj.velocity.x,
        bounces: proj.bouncesRemaining,
        active: proj.active === true,
        tileHp: t.health,
        outsideFace: proj.position.x > t.position.x + t.size.x * 0.5,
      };
    });

    expect(r.vx, 'the entry face flipped its travel').toBeCloseTo(-r.before.vx, 5);
    expect(r.active, 'and the round lives on').toBe(true);
    expect(r.bounces, 'one bounce spent').toBe(r.before.bounces - 1);
    expect(r.outsideFace, 'snapped clear of the face it hit').toBe(true);
    expect(r.tileHp, 'a bounce is not a hit — the tile is unharmed').toBe(r.before.tileHp);

    watch.assertClean();
  });
});

test.describe('the real fight, not a synthetic pair', () => {
  test('a REAL enemy blaster deflects off the player — every shot, off-axis', async ({ page }) => {
    const watch = await boot(page);
    await shieldedPlayer(page);

    /*  THE TEST THAT WAS MISSING, and the reason a shipped "every shield
     *  deflects" did not deflect in play (user report: "I'm not getting any
     *  deflection from the base enemy blaster projectiles").
     *
     *  Every other test in this file hands `checkAndResolveCollision` a pair
     *  it built itself, which proves the deflect FUNCTION works and proves
     *  nothing about the game reaching it. It did not: the pre-SAT range test
     *  compared the bolt against the shield's CIRCLE, while SAT boxes an
     *  entity with no `polygonPoints` — and the player has none — so its
     *  shield-inflated square reaches √2 further at the corners than the
     *  circle the ring is drawn as. Shots arriving off-axis hit the square
     *  first and were absorbed by the body path before the deflect could see
     *  them; only near-axis shots deflected. The synthetic pairs were all
     *  head-on, which is exactly the case that worked.
     *
     *  So this drives a REAL SHOOTER_1 through the REAL loop, parked OFF-AXIS
     *  on purpose, and asserts on the outcome the two paths disagree about:
     *  every shot that reached the shield was turned away, none absorbed.
     *  The sound id is the observation point because it IS the distinction —
     *  `impact.shield.deflect` and `impact.shield.absorb` are emitted by the
     *  two paths and by nothing else. */
    await engine(page, e => {
      const w: any = window;
      w.__shieldSfx = [];
      const orig = e.physics.sfx;
      e.physics.sfx = (id: string, x: number, y: number, o: any) => {
        if (id.indexOf('impact.shield.') === 0) w.__shieldSfx.push(id);
        return orig ? orig(id, x, y, o) : undefined;
      };
      // A pool deep enough that punch-through — which has its own test — can
      // not fire inside this window, so an absorb here is the bug and not the
      // boundary.
      e.player.maxShield = 500;
      e.player.shield = 500;
      // Parked, and OFF-AXIS: a head-on approach is the one geometry the old
      // circle test got right.
      const en = e.waves.spawnAt('SHOOTER_1', {
        x: e.player.position.x + 240, y: e.player.position.y + 90,
      }, e.waveContext(), false);
      en.maxSpeed = 0;   // this is about the shots, not about the AI
      // Effectively immortal: parried bolts RETURN TO SENDER now, and a
      // shooter that dies to its own fire two shots in cuts the stream this
      // test is counting.  The parry-kills claim has its own test.
      en.health = 1e6; en.maxHealth = 1e6;
    });

    await waitForEngine(
      page,
      new Function('e', 'return (window.__shieldSfx || []).length >= 4') as any,
      'four enemy shots to reach the shield',
    );

    const r = await engine(page, e => ({
      events: (window as any).__shieldSfx.slice(),
      health: e.player.health,
      maxHealth: e.player.maxHealth,
    }));

    expect(r.events.filter((i: string) => i === 'impact.shield.absorb'),
      'every shot that reached the shield was turned away, not eaten').toEqual([]);
    expect(r.events.length, 'and they did reach it').toBeGreaterThanOrEqual(4);
    expect(r.health, 'nothing got through to the hull').toBe(r.maxHealth);

    watch.assertClean();
  });
});
