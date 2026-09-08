/** Nebula wake spin — a starboard pass turns a shard clockwise.
 *
 *  The player→nebula swirl (`applyNebulaPlayerPull`) used to sign each
 *  shard's rotation by its id's last-character parity ("varied vortices"),
 *  so a pass had NO consistent handedness — which is what read as "the
 *  shards spin the wrong way" (user report: a shard on the starboard side
 *  should rotate clockwise; roughly half did the opposite).
 *
 *  The sign is now a DBG cycle (Visual ▸ "Neb spin") so the two candidate
 *  handednesses can be A/B'd in flight while PROPER rotational mechanics
 *  stay parked for their own session:
 *   - `physical` (default): the wake shear — sign of the ship's velocity
 *     crossed with the ship→shard offset.  Starboard → clockwise (positive
 *     rotationSpeed in this y-down world), port → counter-clockwise.
 *   - `inverted`: the same cross product negated — the A/B case.
 *   - `random`: the shipped id-parity behaviour, kept as the control.
 *
 *  Driven through the REAL swirl pass (harness rules 3 and 6).  Screen
 *  coords are y-DOWN: a ship flying +x has its starboard side at +y, and a
 *  positive rotationSpeed renders clockwise.
 */

import { test, expect } from '@playwright/test';
import { advanceSim, boot, dialByName, engine, startRun, waitForStats } from './helpers';

/** Run one swirl step against a synthetic shard at (ox, oy) from a player
 *  moving along +x, and report the spin it picked up. */
function swirl(page: any, o: { ox: number; oy: number; id?: string; mode: string }) {
  return engine(page, (e, opt: any) => {
    // Park FAR from real nebula so the synthetic shard is the only one in
    // range of the pass (it iterates the list it is given anyway).
    const p = e.player;
    p.velocity.x = 8; p.velocity.y = 0;   // flying +x, well over the wake gate
    const shard: any = {
      id: opt.id ?? 'spin_probe_a',        // parity matters only in random mode
      type: 'STRUCTURE', shardVariant: 'nebula-shard',
      position: { x: p.position.x + opt.ox, y: p.position.y + opt.oy },
      velocity: { x: 0, y: 0 }, rotation: 0, rotationSpeed: 0,
      size: { x: 20, y: 20 }, mass: 0.01, active: true, color: '#a78bfa',
    };
    /*  Walk the DBG 3-cycle to the wanted mode.  The mode lives in module
     *  state inside constants.ts with no getter on the debug handle, so the
     *  test counts cycles from the known shipped default ('physical') — a
     *  per-page counter, reset with the page like the module state it
     *  mirrors. */
    const w: any = window;
    if (w.__spinModeIdx === undefined) w.__spinModeIdx = 0;
    const MODES = ['physical', 'inverted', 'random'];
    while (MODES[w.__spinModeIdx] !== opt.mode) {
      e.dbg.cycleNebulaWakeSpin();
      w.__spinModeIdx = (w.__spinModeIdx + 1) % MODES.length;
    }
    e.physics.applyNebulaPlayerPull([shard], p, 1);
    return { spin: shard.rotationSpeed, mode: MODES[w.__spinModeIdx] };
  }, o);
}

test.describe('wake handedness', () => {
  test('physical: starboard clockwise, port counter-clockwise', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');
    await waitForStats(page, s => s.currentMapType === 'GLASS_FIELD', 'the glass field');

    // Flying +x in a y-down world: starboard is +y.
    const starboard = await swirl(page, { ox: 0, oy: 60, mode: 'physical' });
    const port      = await swirl(page, { ox: 0, oy: -60, mode: 'physical' });
    expect(starboard.spin, 'starboard pass → clockwise').toBeGreaterThan(0);
    expect(port.spin, 'port pass → counter-clockwise').toBeLessThan(0);

    watch.assertClean();
  });

  test('inverted flips both sides — the A/B the report asked for', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');
    await waitForStats(page, s => s.currentMapType === 'GLASS_FIELD', 'the glass field');

    const starboard = await swirl(page, { ox: 0, oy: 60, mode: 'inverted' });
    const port      = await swirl(page, { ox: 0, oy: -60, mode: 'inverted' });
    expect(starboard.spin).toBeLessThan(0);
    expect(port.spin).toBeGreaterThan(0);

    watch.assertClean();
  });

  test('random: the sign is the shard id parity, not the geometry', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');
    await waitForStats(page, s => s.currentMapType === 'GLASS_FIELD', 'the glass field');

    /*  The control: same starboard geometry, two ids of opposite parity,
     *  opposite spins — which is exactly why a pass never read as having a
     *  direction.  'a' is charCode 97 (odd → +1), 'b' is 98 (even → −1). */
    const odd  = await swirl(page, { ox: 0, oy: 60, id: 'spin_probe_a', mode: 'random' });
    const even = await swirl(page, { ox: 0, oy: 60, id: 'spin_probe_b', mode: 'random' });
    expect(odd.spin).toBeGreaterThan(0);
    expect(even.spin).toBeLessThan(0);

    watch.assertClean();
  });
});

/** Nebula DRAG — the DBG "Neb damp" / "Neb spin damp" knobs, and the spawn
 *  gap that made the first of them dead on arrival.
 *
 *  PhysicsSystem's custom-damping branch is gated on the entity carrying a
 *  `linearDamping` FIELD.  A STRUCTURE without one matches neither that
 *  branch nor the player/enemy/POI branch below it, so it free-drifts with
 *  NO drag at all — and the "Neb damp" multiplier is read INSIDE the branch
 *  that never runs, so the knob goes with it.
 *
 *  `SHARD_SPAWN_SHAPE_NEBULA` used to name both damping fields in its own
 *  comment without declaring them.  That was invisible for as long as nebula
 *  shattered only through `shatterNebulaStyle`, which hardcodes the same
 *  constants locally; routing nebula through the shared voronoi recipe —
 *  which copies `childSpawn.linearDamping` like every other material — made
 *  every puff undamped.  Measured at the time: 311 live shards, 311 of them
 *  with `linearDamping === undefined`.
 *
 *  So the first test here is the one that matters, and it asserts on the
 *  FIELD rather than on a speed: a speed assertion passes for whichever
 *  reason and would not have caught this.
 */
test.describe('nebula drag', () => {
  /** Break `count` nebula tiles through the REAL death path and hand back
   *  the shards that exist afterwards. */
  const breakTiles = (page: any, count: number) => engine(page, (e: any, n: number) => {
    const tiles = e.currentMap.entities
      .filter((x: any) => x.active && x.shardVariant === 'nebula-tile').slice(0, n);
    for (const t of tiles) { t.health = 0; e.handleEntityDeath(t); }
    return tiles.length;
  }, count);

  const shardStats = (page: any) => engine(page, (e: any) => {
    const s = e.currentMap.entities
      .filter((x: any) => x.active && x.shardVariant === 'nebula-shard');
    const spin = s.map((x: any) => Math.abs(x.rotationSpeed ?? 0));
    return {
      n: s.length,
      undamped: s.filter((x: any) => x.linearDamping === undefined).length,
      meanSpin: spin.length ? spin.reduce((a: number, b: number) => a + b, 0) / spin.length : 0,
    };
  });

  test('every voronoi nebula shard carries its damping fields', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'NEBULA_FIELD');
    await waitForStats(page, s => s.currentMapType === 'NEBULA_FIELD', 'the nebula field');

    expect(await breakTiles(page, 30)).toBeGreaterThan(0);
    const got = await shardStats(page);

    // The population is real, and not one member of it is undamped.  This is
    // the assertion the regression is about: `undamped` was 100% of the list.
    expect(got.n).toBeGreaterThan(20);
    expect(got.undamped).toBe(0);

    watch.assertClean();
  });

  test('spin damping is its own knob, independent of the linear one', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'NEBULA_FIELD');
    await waitForStats(page, s => s.currentMapType === 'NEBULA_FIELD', 'the nebula field');

    /*  Both runs sit at the SAME linear step, so any difference in spin is
     *  the spin ladder alone.  `match` (index 0) defers to the linear knob,
     *  which is the shipped behaviour — so this is also the check that the
     *  default is a no-op and only a deliberate click departs from it. */
    const spinAfter = async (steps: number, label: string) => {
      await dialByName(page, 'nebulaSpinDampName', label,
        (e: any) => e.dbg.cycleNebulaSpinDamp(), steps);
      await breakTiles(page, 30);
      await advanceSim(page, 2);
      return (await shardStats(page)).meanSpin;
    };

    const matched = await spinAfter(7, 'match');
    const hard    = await spinAfter(7, '10x');

    // 10× the per-step spin LOSS has to leave measurably less tumble than
    // the shipped default does over the same two sim-seconds.
    expect(hard).toBeLessThan(matched);

    watch.assertClean();
  });
});

/** Nebula BONDING — what the "Neb bond" steps actually buy.
 *
 *  A nebula bond's outcome is `compose`: after the contact threshold the
 *  pair is CONSUMED and one new body appears.  At the shipped ~5 s (scaled
 *  by pair size) that window is short enough that the cohesion and break
 *  multipliers barely get to act — and the harder they grip, the sooner the
 *  pair holds together well enough to vanish into a merge.  So "grip harder"
 *  read as changing nothing (user report).
 *
 *  `bondTimeMul` stretches the threshold instead.  The pair sticks and moves
 *  as one for as long as the multiplier says, and then it STILL coalesces —
 *  which matters because compose is also how nebula shards transmute back
 *  into tiles, so suppressing it outright would switch off the whole
 *  self-coalesce loop.
 *
 *  WHAT THESE TESTS ASSERT, AND WHY IT IS NOT THE BOND COUNT.  The obvious
 *  reading — "a stickier step should accumulate bonds" — was written first
 *  and it does not discriminate: the live count churns hard as pairs form
 *  and break (measured 15 → 150 → 19 → 58 → 21 → 13 on the OFF step), so a
 *  tail-beats-head assertion passes by coincidence, and it did, against a
 *  build with the feature reverted.  These read `timer / threshold` on live
 *  bonds instead.  `bond.threshold` is the BASE stamped at formation and the
 *  multiplier is applied at the read, so a live bond whose ratio exceeds 1
 *  is precisely one the shipped step would already have merged away — a
 *  direct read of the line that changed, with no population dynamics in it.
 */
test.describe('nebula bonding', () => {
  const breakTiles = (page: any) => engine(page, (e: any) => {
    const tiles = e.currentMap.entities
      .filter((x: any) => x.active && x.shardVariant === 'nebula-tile').slice(0, 30);
    for (const t of tiles) { t.health = 0; e.handleEntityDeath(t); }
  });

  /** Live nebula↔nebula bonds, as {n, maxRatio, overdue} where `overdue`
   *  counts bonds already past their BASE compose threshold. */
  const bondState = (page: any) => engine(page, (e: any) => {
    const b = e.shards.liveBonds.filter((x: any) =>
      x.a.shardVariant === 'nebula-shard' && x.b.shardVariant === 'nebula-shard');
    const ratios = b.map((x: any) => x.timer / x.threshold);
    return {
      n: b.length,
      maxRatio: ratios.length ? Math.max(...ratios) : 0,
      overdue: ratios.filter((r: number) => r > 1).length,
    };
  });

  test('a stretched threshold holds pairs the shipped step would have merged', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'NEBULA_FIELD');
    await waitForStats(page, s => s.currentMapType === 'NEBULA_FIELD', 'the nebula field');

    /*  OFF first.  A bond is composed in the same iteration its timer
     *  crosses `threshold` — and the merge-budget deferral clamps to
     *  `threshold - dt` — so no bond that is still ALIVE can ever be past
     *  its base threshold.  That makes ratio ≤ 1 an invariant of the
     *  shipped step, and the control for the assertion below. */
    await dialByName(page, 'nebulaBondName', 'off (old)',
      (e: any) => e.dbg.cycleNebulaBond(), 4);
    await breakTiles(page);
    await advanceSim(page, 6, 180_000);
    const off = await bondState(page);
    expect(off.n).toBeGreaterThan(0);
    expect(off.overdue).toBe(0);

    // GOO: 12× the threshold, so pairs sail past the base one and hold.
    await dialByName(page, 'nebulaBondName', 'goo',
      (e: any) => e.dbg.cycleNebulaBond(), 4);
    await breakTiles(page);
    await advanceSim(page, 6, 180_000);
    const goo = await bondState(page);

    expect(goo.n).toBeGreaterThan(0);
    expect(goo.overdue).toBeGreaterThan(0);
    expect(goo.maxRatio).toBeGreaterThan(1);

    watch.assertClean();
  });

  test('merging is delayed, never removed — stepping down composes the held pairs', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'NEBULA_FIELD');
    await waitForStats(page, s => s.currentMapType === 'NEBULA_FIELD', 'the nebula field');

    /*  This is the property that separates a long timer from plastic's
     *  `cohesionOnly`, and it is the whole reason nebula takes the former:
     *  the pairs are not exempt from merging, only deferred.  Pile up bonds
     *  past their base threshold under goo, then step back down — the
     *  multiplier is read at the compose gate rather than stamped at
     *  formation, so every one of them is instantly due and composes. */
    await dialByName(page, 'nebulaBondName', 'goo',
      (e: any) => e.dbg.cycleNebulaBond(), 4);
    await breakTiles(page);
    await advanceSim(page, 8, 180_000);

    const held = await bondState(page);
    expect(held.overdue).toBeGreaterThan(0);

    await dialByName(page, 'nebulaBondName', 'off (old)',
      (e: any) => e.dbg.cycleNebulaBond(), 4);
    await advanceSim(page, 4, 180_000);

    // Nothing overdue survives: each was consumed by the merge it was
    // waiting on.  New bonds keep forming, so this is not "no bonds".
    const after = await bondState(page);
    expect(after.overdue).toBe(0);

    watch.assertClean();
  });
});
