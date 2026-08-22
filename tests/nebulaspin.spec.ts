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
import { boot, engine, startRun, waitForStats } from './helpers';

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
