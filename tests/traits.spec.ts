/** Enemy counterplay traits — armor, evasive, front-shield, regen.
 *
 *  Re-derived from the boss gauntlet's B2/B3 coverage.  These four traits are
 *  the soft-counter engine: they are what makes each weapon the right answer
 *  somewhere (WEAPONS_AMMO_PLAN §7).  They are also the easiest thing in the
 *  repo to break silently, because a broken trait does not crash — it just
 *  quietly makes one weapon strictly better than the others.
 *
 *  Every damage assertion here goes through the REAL projectile path
 *  (`PhysicsSystem.resolveCollision`) with a synthetic shell, rather than
 *  firing across a live map.  That is the boss log's own recorded flake fix:
 *  a shell whose flight depends on the map's terrain layout tests the terrain,
 *  not the trait.  Driving the path directly keeps the thing under test — the
 *  damage arithmetic, in situ — and removes everything that isn't.
 *
 *  ORDERING is asserted explicitly, because it is a design decision and not
 *  an accident: armor and front-shield reduce damage BEFORE the regen burst
 *  bucket sees it, so bursting a plated target means bursting it FROM BEHIND.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, startRun, waitForStats, waitForEngine, waitForTransit } from './helpers';

/** Drop the boss to `frac` health and WAIT for the phase machine to stamp the
 *  matching phase.
 *
 *  This is not test scaffolding to route around — it IS the mechanism.  A
 *  `BossPhaseDef` REPLACES the trait set, so which traits a boss has is a
 *  function of its health, and a Bastion at full health has the plate and no
 *  regen.  `updateBosses` stamps the phase on the health-fraction transition,
 *  one frame later, so reading traits in the same breath as setting health
 *  reads the OLD phase.  Polling for `bossPhase` makes the dependency
 *  explicit instead of racing it. */
async function dropToPhase(page: any, targetId: string, frac: number, phase: number) {
  await engine(page, (e, o: { id: string; frac: number }) => {
    const t = e.currentMap.entities.find((x: any) => x.id === o.id);
    t.health = t.maxHealth * o.frac;
  }, { id: targetId, frac });
  await waitForEngine(
    page,
    new Function('e', `
      const t = e.currentMap.entities.find(x => x.id === ${JSON.stringify(targetId)});
      return !!t && t.bossPhase >= ${phase};
    `) as (e: any) => boolean,
    `the boss to enter phase ${phase}`,
    20_000,
  );
}

/** Warp a capstone in on an arena and return its entity id. */
async function spawnBoss(page: any, id: string) {
  await startRun(page);
  await engine(page, e => e.transitionToMap('arena_universe'));
  await waitForTransit(page);
  await waitForStats(page, s => s.currentMapType === 'UNIVERSE', 'the arena');
  await engine(page, (e, bid: string) => e.debugSpawnBoss(bid), id);
  await waitForStats(page, s => !!s.boss, 'the boss to warp in');
  return engine(page, e => {
    const b = e.currentMap.entities.find((x: any) => x.isBoss && x.active);
    // Park it and silence its gun: a live boss shooting near the player picks
    // up splash from its OWN shells (an enemy ring excludes its direct-hit
    // target, not its owner), which is one of the four flakes the boss log
    // records.  Move the player clear too.
    b.velocity.x = 0; b.velocity.y = 0;
    b.weaponCooldown = 9999;
    e.player.position.x = b.position.x + 3000;
    e.player.position.y = b.position.y + 3000;
    e.player.velocity.x = 0; e.player.velocity.y = 0;
    return b.id;
  });
}

/** Fire one synthetic PLAYER shell of `damage` into `targetId` from bearing
 *  `fromDeg` (0° = hitting the target's FRONT, i.e. travelling against its
 *  facing) and return the health it actually cost.
 *
 *  The shell is a real projectile entity run through the real collision
 *  resolver, so every gate on the way — shield absorption, front-shield
 *  sector, armor chip threshold, the regen bucket — applies exactly as it
 *  does in play. */
async function shell(
  page: any,
  opts: { targetId: string; damage: number; fromDeg?: number; traits?: boolean },
) {
  return engine(
    page,
    (e, o: { targetId: string; damage: number; fromDeg?: number; traits?: boolean }) => {
      const t = e.currentMap.entities.find((x: any) => x.id === o.targetId);
      if (!t) throw new Error('target gone');
      if (o.traits !== undefined) e.physics.traitsEnabled = o.traits;

      // Bearing is relative to the target's FACING, so "from the front" is
      // stable no matter which way the boss happens to be pointing.
      const bearing = t.rotation + ((o.fromDeg ?? 0) * Math.PI) / 180;
      const dist = t.size.x * 0.5 + 4;
      const proj = {
        id: `test_shell_${Math.floor(e.runTimeSec * 1000)}_${o.damage}_${o.fromDeg ?? 0}`,
        type: 'PROJECTILE',
        position: {
          x: t.position.x + Math.cos(bearing) * dist,
          y: t.position.y + Math.sin(bearing) * dist,
        },
        // Travelling INTO the target from that bearing.
        velocity: { x: -Math.cos(bearing) * 900, y: -Math.sin(bearing) * 900 },
        rotation: bearing + Math.PI,
        size: { x: 6, y: 6 },
        mass: 0.1,
        active: true,
        color: '#fff',
        damage: o.damage,
        ownerType: 'PLAYER',
        ownerId: 'player',
        hitEntityIds: [],
      };

      const hpBefore = t.health;
      const shieldBefore = t.shield ?? 0;
      e.physics.resolveCollision(proj, t, { x: 0, y: 0 });
      return {
        dealt: hpBefore - t.health,
        shieldDrained: shieldBefore - (t.shield ?? 0),
        hpAfter: t.health,
      };
    },
    opts,
  );
}

test.describe('armor — chip fire plinks, big hits punch through', () => {
  test('cuts hits below the threshold and leaves hits above it whole', async ({ page }) => {
    const watch = await boot(page);
    const id = await spawnBoss(page, 'BOSS_WARDEN');

    const cfg = await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      // Strip the shield so the armor arithmetic is the only thing measured;
      // the shield gate has its own coverage below.
      t.shield = 0; t.maxShield = 0;
      return t.armor;
    }, id);
    expect(cfg).toEqual({ chipThreshold: 8, reduction: 0.65 });

    // A CHIP hit — below the threshold — is cut by `reduction`.
    const chip = await shell(page, { targetId: id, damage: 4 });
    expect(chip.dealt).toBeCloseTo(4 * (1 - cfg.reduction), 5);

    // A BIG hit — at or above the threshold — lands in full.  This is the
    // whole counterplay: Cannon / Lightning / a charged slug / a
    // Gunnery-boosted Blaster past the threshold all get through.
    const big = await shell(page, { targetId: id, damage: 12 });
    expect(big.dealt).toBe(12);

    // The boundary is inclusive-above: exactly `chipThreshold` is NOT chip.
    const edge = await shell(page, { targetId: id, damage: cfg.chipThreshold });
    expect(edge.dealt).toBe(cfg.chipThreshold);
    const justUnder = await shell(page, { targetId: id, damage: cfg.chipThreshold - 1 });
    expect(justUnder.dealt).toBeCloseTo((cfg.chipThreshold - 1) * (1 - cfg.reduction), 5);

    watch.assertClean();
  });

  test('the DBG traits toggle gates the whole counterplay layer', async ({ page }) => {
    const watch = await boot(page);
    const id = await spawnBoss(page, 'BOSS_WARDEN');
    await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      t.shield = 0; t.maxShield = 0;
    }, id);

    const on = await shell(page, { targetId: id, damage: 4, traits: true });
    const off = await shell(page, { targetId: id, damage: 4, traits: false });

    expect(on.dealt).toBeLessThan(4);
    // With traits off the same chip hit lands in full — one toggle, whole layer.
    expect(off.dealt).toBe(4);

    // AISystem MIRRORS the flag, so ONE toggle gates the whole layer — the
    // damage-side traits and the AI-side dodge together.  Driven through
    // `toggleTraits()` (the DBG row's own path), because the mirroring is what
    // that method does; poking `physics.traitsEnabled` alone would assert
    // nothing about it.
    const first = await engine(page, e => {
      e.toggleTraits();
      return { ai: e.ai.traitsEnabled, physics: e.physics.traitsEnabled };
    });
    expect(first.ai).toBe(first.physics);
    const second = await engine(page, e => {
      e.toggleTraits();
      return { ai: e.ai.traitsEnabled, physics: e.physics.traitsEnabled };
    });
    expect(second.ai).toBe(second.physics);
    expect(second.physics).not.toBe(first.physics);

    watch.assertClean();
  });
});

test.describe('front-shield — a permanent plate with no pool', () => {
  test('cuts hits from the covered side and lets flanking shots through whole', async ({ page }) => {
    const watch = await boot(page);
    const id = await spawnBoss(page, 'BOSS_SIEGE');

    const cfg = await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      t.shield = 0; t.maxShield = 0;
      // Isolate the plate: regen would heal between shells and blur the
      // arithmetic.  Regen has its own tests below.
      t.regen = undefined;
      return { frontShield: t.frontShield, armor: t.armor };
    }, id);
    expect(cfg.frontShield).toEqual({ deg: 150, reduction: 0.75 });
    // The Bastion has NO armor, so the plate is the only reducer in play.
    expect(cfg.armor).toBeUndefined();

    const dmg = 20;
    // Dead ahead: fully covered.
    const front = await shell(page, { targetId: id, damage: dmg, fromDeg: 0 });
    expect(front.dealt).toBeCloseTo(dmg * (1 - cfg.frontShield.reduction), 5);

    // Just inside the sector edge (150° wide → ±75°).
    const edgeIn = await shell(page, { targetId: id, damage: dmg, fromDeg: 70 });
    expect(edgeIn.dealt).toBeCloseTo(dmg * (1 - cfg.frontShield.reduction), 5);

    // Just outside it — one flank step and the shot lands whole.
    const edgeOut = await shell(page, { targetId: id, damage: dmg, fromDeg: 85 });
    expect(edgeOut.dealt).toBe(dmg);

    // From directly behind: whole, obviously.  Face-tanking is never viable,
    // which is the point of a plate with no pool to deplete.
    const behind = await shell(page, { targetId: id, damage: dmg, fromDeg: 180 });
    expect(behind.dealt).toBe(dmg);

    // Symmetric about the facing.
    const mirrored = await shell(page, { targetId: id, damage: dmg, fromDeg: -70 });
    expect(mirrored.dealt).toBeCloseTo(dmg * (1 - cfg.frontShield.reduction), 5);

    watch.assertClean();
  });

  test('lightning chains and shockwave rings bypass the plate for free', async ({ page }) => {
    const watch = await boot(page);
    const id = await spawnBoss(page, 'BOSS_SIEGE');
    await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      t.shield = 0; t.maxShield = 0; t.regen = undefined;
    }, id);

    // A projectile from the front is cut …
    const shot = await shell(page, { targetId: id, damage: 20, fromDeg: 0 });
    expect(shot.dealt).toBeLessThan(20);

    // … while a shockwave ring, which damages in GameEngine OUTSIDE the
    // projectile path, is not.  This is not a special case anywhere: the
    // bypass falls out of WHERE damage is applied, which is why the trait
    // needs no exception list.
    //
    // The ring is ticked by the LIVE loop rather than by stepping
    // `updateExplosionRings` in a tight loop: that method reads the ring's
    // lifetime but does not advance it, so hand-stepping it leaves the
    // wavefront pinned at radius 0 and measures nothing.
    const before = await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      e.spawnShockwave({ x: t.position.x, y: t.position.y }, {
        radius: 400, damage: 20, knockback: 0,
        color: '#fff', lifetime: 0.3,
        ownerType: 'PLAYER', ownerId: 'player',
      });
      return t.health;
    }, id);
    await waitForEngine(
      page,
      e => !e.currentMap.entities.some((x: any) => x.isExplosionRing && x.active),
      'the shockwave ring to finish sweeping',
      20_000,
    );
    const ring = await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      return { dealt: t.health };
    }, id);
    const ringDealt = before - ring.dealt;
    expect(ringDealt).toBeGreaterThan(0);
    // The ring's full damage got through the plate.
    expect(ringDealt).toBeGreaterThan(shot.dealt);

    watch.assertClean();
  });
});

test.describe('regen — a FIXED damage bucket, not a sliding window', () => {
  test('heals over time and shuts off on a burst', async ({ page }) => {
    const watch = await boot(page);
    const id = await spawnBoss(page, 'BOSS_SIEGE');

    // Phase 1 is the plate alone; REGEN arrives in phase 2 ("REPAIR SYSTEMS
    // ONLINE") at 70% health.  A phase REPLACES the trait set, so this is
    // also an assertion that the phase machine hands out the right traits.
    await dropToPhase(page, id, 0.5, 1);
    const cfg = await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      t.shield = 0; t.maxShield = 0;
      t.frontShield = undefined;  // isolate regen from the plate
      return t.regen;
    }, id);
    expect(cfg).toEqual({ perSec: 3.5, burstDamage: 16, windowSec: 0.4, burnSec: 3.0 });

    // Undamaged, it heals at `perSec`.
    const healed = await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      // updateEnemyRegen walks the enemy INDEX, so it must be current.
      e.prepareFrameEntities();
      const before = t.health;
      for (let i = 0; i < 60; i++) e.updateEnemyRegen(1 / 60);
      return { before, after: t.health };
    }, id);
    expect(healed.after - healed.before).toBeCloseTo(cfg.perSec, 1);

    // A BURST past `burstDamage` inside the window shuts it off for `burnSec`.
    // The bucket is fed through the REAL projectile path, not by poking the
    // fields — that is what makes this a test of the trait rather than of the
    // test's own arithmetic.
    await shell(page, { targetId: id, damage: 20 });
    const burned = await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      e.prepareFrameEntities();
      const before = t.health;
      const burning = (t.regenBurnTimer ?? 0) > 0;
      for (let i = 0; i < 60; i++) e.updateEnemyRegen(1 / 60);
      return { before, after: t.health, burning };
    }, id);
    expect(burned.burning).toBe(true);
    expect(burned.after).toBe(burned.before);

    watch.assertClean();
  });

  test('the bucket is FIXED — it expires on schedule regardless of later hits', async ({ page }) => {
    const watch = await boot(page);
    const id = await spawnBoss(page, 'BOSS_SIEGE');
    await dropToPhase(page, id, 0.5, 1);
    await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      t.shield = 0; t.maxShield = 0; t.frontShield = undefined;
    }, id);

    // Chip damage, spread out so no single 0.4s window ever reaches
    // burstDamage=16.  With a FIXED bucket this NEVER stops the healing.
    //
    // That distinction is the entire trait.  A SLIDING window would instead
    // measure "damage until the player pauses", which any sustained weapon
    // clears — so chip fire would stop the regen and the trait would INVERT,
    // rewarding exactly the weapons it is meant to punish.
    const chipped = await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      e.prepareFrameEntities();
      const before = t.health;
      let dealt = 0;
      let everBurned = false;
      const chip = (dmg: number) => {
        const bearing = t.rotation + Math.PI;
        const proj = {
          id: `chip_${dealt}`, type: 'PROJECTILE', active: true,
          position: {
            x: t.position.x + Math.cos(bearing) * (t.size.x * 0.5 + 4),
            y: t.position.y + Math.sin(bearing) * (t.size.x * 0.5 + 4),
          },
          velocity: { x: -Math.cos(bearing) * 900, y: -Math.sin(bearing) * 900 },
          rotation: bearing + Math.PI,
          size: { x: 6, y: 6 }, mass: 0.1, color: '#fff',
          damage: dmg, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
        };
        const hp = t.health;
        e.physics.resolveCollision(proj, t, { x: 0, y: 0 });
        dealt += hp - t.health;
      };
      // 3 seconds of steady 3-damage chips at 5/s — never more than 6 inside
      // any single 0.4s bucket window, so the burst never trips.
      for (let i = 0; i < 180; i++) {
        if (i % 12 === 0) chip(3);
        if ((t.regenBurnTimer ?? 0) > 0) everBurned = true;
        e.updateEnemyRegen(1 / 60);
      }
      return { before, after: t.health, dealt, everBurned };
    }, id);

    // The burst NEVER tripped …
    expect(chipped.everBurned).toBe(false);
    // … so it healed THROUGH the chip fire: net loss is strictly less than
    // the damage dealt, by roughly 3 seconds of healing.
    const netLoss = chipped.before - chipped.after;
    expect(chipped.dealt).toBeGreaterThan(0);
    expect(netLoss).toBeLessThan(chipped.dealt);
    expect(netLoss).toBeCloseTo(chipped.dealt - 3.0 * 3.5, 0);

    watch.assertClean();
  });

  test('armor and the plate reduce damage BEFORE the bucket sees it', async ({ page }) => {
    const watch = await boot(page);
    const id = await spawnBoss(page, 'BOSS_SIEGE');
    // Phase 2 is the one that runs the plate AND regen at once — the hard
    // part of the fight, and the only phase where the ordering is observable.
    await dropToPhase(page, id, 0.5, 1);
    const both = await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      t.shield = 0; t.maxShield = 0;
      return { plate: !!t.frontShield, regen: !!t.regen };
    }, id);
    expect(both).toEqual({ plate: true, regen: true });

    // A shell big enough to trip the burst bucket ON ITS OWN — but fired into
    // the PLATE, which cuts it 75% before the bucket is fed.  20 × 0.25 = 5,
    // well under burstDamage 16, so the regen survives the hit.
    await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      t.regenBucket = 0;
      t.regenBucketTimer = 0;
      t.regenBurnTimer = 0;
    }, id);

    await shell(page, { targetId: id, damage: 20, fromDeg: 0 });
    const afterFront = await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      e.prepareFrameEntities();
      const before = t.health;
      for (let i = 0; i < 60; i++) e.updateEnemyRegen(1 / 60);
      return { healedBy: t.health - before, burn: t.regenBurnTimer ?? 0 };
    }, id);
    // Still healing: the plate ate enough of the hit that the bucket never
    // filled.  BURSTING A PLATED TARGET MEANS BURSTING IT FROM BEHIND.
    expect(afterFront.healedBy).toBeGreaterThan(0);

    // The same shell from behind is NOT reduced, fills the bucket, and stops
    // the healing.
    await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      t.regenBucket = 0; t.regenBucketTimer = 0; t.regenBurnTimer = 0;
    }, id);
    await shell(page, { targetId: id, damage: 20, fromDeg: 180 });
    const afterBehind = await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      e.prepareFrameEntities();
      const before = t.health;
      for (let i = 0; i < 60; i++) e.updateEnemyRegen(1 / 60);
      return { healedBy: t.health - before, burn: t.regenBurnTimer ?? 0 };
    }, id);
    expect(afterBehind.burn).toBeGreaterThan(0);
    expect(afterBehind.healedBy).toBe(0);

    watch.assertClean();
  });
});

test.describe('evasive — a real dodge, blind to homing by design', () => {
  test('jukes out of a closing straight shot, once per cooldown', async ({ page }) => {
    const watch = await boot(page);
    const id = await spawnBoss(page, 'BOSS_SCATTER');

    const cfg = await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      return t.evasive;
    }, id);
    expect(cfg).toEqual({ sense: 340, missRadius: 46, impulse: 7.5, cooldown: 0.85 });

    // Put a PLAYER-owned straight shot on a collision course and run the
    // dodge.  Velocity delta is measured, not position: the juke is an
    // impulse, and position drift would also pick up the boss's own thrust.
    const dodged = await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      t.velocity.x = 0; t.velocity.y = 0;
      t.dodgeTimer = 0;
      t.hitStun = 0;
      const proj = {
        id: 'test_incoming', type: 'PROJECTILE', active: true,
        position: { x: t.position.x - 200, y: t.position.y },
        velocity: { x: 800, y: 0 },
        size: { x: 6, y: 6 }, mass: 0.1, color: '#fff',
        damage: 5, ownerType: 'PLAYER', ownerId: 'player',
      };
      e.currentMap.entities.push(proj);
      e.prepareFrameEntities();
      e.ai.applyEvasiveDodge(1 / 60, t, e.entityIndex.projectiles);
      const first = { x: t.velocity.x, y: t.velocity.y };
      // Immediately again: the cooldown must refuse a second juke, which is
      // why a Shotgun cone and a Lightning chain still land.
      t.velocity.x = 0; t.velocity.y = 0;
      e.ai.applyEvasiveDodge(1 / 60, t, e.entityIndex.projectiles);
      const second = { x: t.velocity.x, y: t.velocity.y };
      return { first, second, cooldownLeft: t.dodgeTimer };
    }, id);

    const speed = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);
    // It moved, and PERPENDICULAR to the incoming shot (which travels +x).
    expect(speed(dodged.first)).toBeGreaterThan(0);
    expect(Math.abs(dodged.first.y)).toBeGreaterThan(Math.abs(dodged.first.x));
    // ONE juke per cooldown.
    expect(speed(dodged.second)).toBe(0);
    expect(dodged.cooldownLeft).toBeGreaterThan(0);

    watch.assertClean();
  });

  test('is blind to HOMING shots — the Seeker is the designated answer', async ({ page }) => {
    const watch = await boot(page);
    const id = await spawnBoss(page, 'BOSS_SCATTER');

    const result = await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      t.velocity.x = 0; t.velocity.y = 0;
      t.dodgeTimer = 0;
      t.hitStun = 0;
      const mk = (homing: boolean) => ({
        id: `test_${homing ? 'homing' : 'straight'}`, type: 'PROJECTILE', active: true,
        position: { x: t.position.x - 200, y: t.position.y },
        velocity: { x: 800, y: 0 },
        size: { x: 6, y: 6 }, mass: 0.1, color: '#fff',
        damage: 5, ownerType: 'PLAYER', ownerId: 'player',
        homing,
      });

      e.currentMap.entities.push(mk(true));
      e.prepareFrameEntities();
      e.ai.applyEvasiveDodge(1 / 60, t, e.entityIndex.projectiles);
      const vsHoming = Math.hypot(t.velocity.x, t.velocity.y);

      // Same geometry, straight shot: it DOES dodge, so the difference is the
      // homing flag and nothing else.
      e.currentMap.entities.pop();
      t.velocity.x = 0; t.velocity.y = 0;
      t.dodgeTimer = 0;
      e.currentMap.entities.push(mk(false));
      e.prepareFrameEntities();
      e.ai.applyEvasiveDodge(1 / 60, t, e.entityIndex.projectiles);
      const vsStraight = Math.hypot(t.velocity.x, t.velocity.y);

      return { vsHoming, vsStraight };
    }, id);

    expect(result.vsHoming).toBe(0);
    expect(result.vsStraight).toBeGreaterThan(0);

    watch.assertClean();
  });
});

test.describe('the arc shield absorbs only from the covered side', () => {
  test('a covered hit drains the shield; a flanking hit reaches the hull', async ({ page }) => {
    const watch = await boot(page);
    const id = await spawnBoss(page, 'BOSS_WARDEN');

    const setup = await engine(page, (e, tid: string) => {
      const t = e.currentMap.entities.find((x: any) => x.id === tid);
      t.armor = undefined;              // isolate the shield from armor
      t.shield = 200; t.maxShield = 200;
      t.shieldArcHalfWidth = Math.PI / 4;  // a 90° sector …
      t.shieldArcAngle = t.rotation;       // … centred on its facing
      return { shield: t.shield, hp: t.health };
    }, id);
    expect(setup.shield).toBe(200);

    // From the covered side: the shield eats it, the hull does not.
    const covered = await shell(page, { targetId: id, damage: 30, fromDeg: 0 });
    expect(covered.shieldDrained).toBe(30);
    expect(covered.dealt).toBe(0);

    // From outside the sector: straight to the hull, shield untouched.
    const flank = await shell(page, { targetId: id, damage: 30, fromDeg: 180 });
    expect(flank.shieldDrained).toBe(0);
    expect(flank.dealt).toBe(30);

    watch.assertClean();
  });
});
