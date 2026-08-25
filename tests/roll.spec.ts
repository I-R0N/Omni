/** Banking roll — the player ship rolls into changing acceleration.
 *
 *  TWO terms feed the signal (PLAYER_ROLL_CONSTANTS documents why both
 *  exist): the STRAFE term — the thrust input's component perpendicular to
 *  the facing axis — and the TURN term — the smoothed rate the nose is
 *  swinging, gated by throttle, added because under the aim-locked schemes
 *  (touch / joystick / gamepad) the ship aims where it flies, thrust is
 *  always along the nose, and a strafe-only signal is zero by construction
 *  (the user report that prompted it: "not noticing the roll").  The roll
 *  is purely presentational — `player.visualRoll` is an eased angle the
 *  renderer projects as a cos(roll) foreshortening across the wing line —
 *  so what is pinned here is the SIGNAL and the EASING, not pixels:
 *
 *   1. DIRECTIONALITY — lateral thrust banks, nose-line thrust does not,
 *      and a left strafe and a right strafe are distinct (signed) banks.
 *   2. CONVERGENCE — a held strafe approaches the authored MAX_ANGLE and
 *      never overshoots it; releasing settles to EXACTLY level (the snap
 *      that keeps the renderer on its plain-rotation path).
 *   3. ASYMMETRY — rolling INTO a bank is faster than settling out, which
 *      is the tuning that tracks the hand without strobing on tap-input.
 *   4. TURN TERM — carving a turn under thrust banks even with thrust
 *      locked along the nose (the aim-locked geometry), a coasting swing
 *      stays level, and the throttle gate scales rather than switches.
 *   5. END TO END — a real held key across live sim steps banks the ship,
 *      and releasing it levels off, with the renderer drawing throughout
 *      (the clean-console assertion is what covers the transform math).
 *
 *  The unit claims drive `tickPlayerRoll` inside a single evaluate so the
 *  live loop cannot interleave its own ticks mid-measurement (the same
 *  atomicity trick the input suite leans on, harness rule 8).
 */

import { test, expect } from '@playwright/test';
import { boot, engine, startRun, waitForEngine, waitForStats } from './helpers';

/** PLAYER_ROLL_CONSTANTS, hard-coded rather than imported (harness rule 7). */
const MAX_ANGLE = 0.85;
const RESPONSE_RATE = 9;
const RETURN_RATE = 4.5;

const DT = 1 / 60;

/** Drive the roll tick N times against a fixed facing + thrust input, all
 *  inside ONE evaluate so live sim steps can't interleave.  Resets the
 *  turn-term trackers first — the live loop has been feeding them its own
 *  facing between evaluates, and a stale prev-facing would spike the yaw
 *  rate on the first measured tick.  Returns the roll after the last
 *  tick. */
function driveRoll(
  page: any,
  o: { facing: number; mx: number; my: number; ticks: number; start?: number },
) {
  return engine(page, (e, a: typeof o) => {
    e.player.rotation = a.facing;
    e.player.visualRoll = a.start ?? 0;
    e._rollPrevFacing = null;
    e._rollYawRate = 0;
    for (let i = 0; i < a.ticks; i++) {
      e.tickPlayerRoll(1 / 60, { x: a.mx, y: a.my });
    }
    return e.player.visualRoll as number;
  }, o);
}

/** Sweep the FACING at a constant rate with thrust locked ALONG it — the
 *  aim-locked schemes' geometry, where the strafe term is identically zero
 *  and only the turn term can bank.  Returns the peak |roll| over the
 *  sweep. */
function driveTurn(
  page: any,
  o: { ratePerSec: number; throttle: number; ticks: number },
) {
  return engine(page, (e, a: typeof o) => {
    e.player.rotation = 0;
    e.player.visualRoll = 0;
    e._rollPrevFacing = null;
    e._rollYawRate = 0;
    let peak = 0;
    for (let i = 0; i < a.ticks; i++) {
      e.player.rotation += a.ratePerSec / 60;
      const f = e.player.rotation;
      e.tickPlayerRoll(1 / 60, {
        x: Math.cos(f) * a.throttle,
        y: Math.sin(f) * a.throttle,
      });
      peak = Math.max(peak, Math.abs(e.player.visualRoll ?? 0));
    }
    return peak;
  }, o);
}

test.describe('the roll signal is the lateral thrust component', () => {
  test('strafing banks, nose-line thrust flies level, and the sign follows the side', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // Facing +x: thrust along +y is a pure strafe, +x is pure nose-line.
    const strafe = await driveRoll(page, { facing: 0, mx: 0, my: 1, ticks: 240 });
    const level = await driveRoll(page, { facing: 0, mx: 1, my: 0, ticks: 240 });
    const other = await driveRoll(page, { facing: 0, mx: 0, my: -1, ticks: 240 });

    expect(Math.abs(strafe), 'a held strafe reaches a deep bank').toBeGreaterThan(MAX_ANGLE * 0.9);
    expect(Math.abs(strafe), 'and never overshoots the authored maximum').toBeLessThanOrEqual(MAX_ANGLE + 1e-9);
    expect(level, 'thrust along the nose never banks').toBe(0);
    // Signed: the two strafe directions are distinct banks, not one squash.
    expect(Math.sign(other)).toBe(-Math.sign(strafe));
    expect(Math.abs(other)).toBeCloseTo(Math.abs(strafe), 5);

    // The decomposition follows the FACING, not the world axes: the same
    // world-space thrust that banked above is nose-line when facing +y.
    // Not a strict 0: cos(π/2) is ~6e-17 in floats, so "level" here means
    // below any visible angle rather than literal zero.
    const rotated = await driveRoll(page, { facing: Math.PI / 2, mx: 0, my: 1, ticks: 240 });
    expect(Math.abs(rotated), 'the lateral axis rotates with the ship').toBeLessThan(1e-9);

    watch.assertClean();
  });

  test('releasing settles to EXACTLY level, and coasting never banks', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // From a full bank with no input the roll must reach literal 0 — the
    // snap that keeps the renderer on its plain-rotation path — not hover
    // at some epsilon forever.
    const settled = await driveRoll(page, { facing: 0, mx: 0, my: 0, ticks: 240, start: MAX_ANGLE });
    expect(settled).toBe(0);

    const coast = await driveRoll(page, { facing: 0, mx: 0, my: 0, ticks: 240 });
    expect(coast, 'no input, no bank').toBe(0);

    watch.assertClean();
  });

  test('rolling into a bank is faster than settling out', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // One tick each way from the two ends of the swing.  The first-tick
    // deltas are the rates themselves (MAX_ANGLE * rate * dt), so this is
    // the asymmetry claim measured where it is largest.
    const into = await driveRoll(page, { facing: 0, mx: 0, my: 1, ticks: 1 });
    const outOf = await driveRoll(page, { facing: 0, mx: 0, my: 0, ticks: 1, start: MAX_ANGLE });

    const deltaIn = Math.abs(into);
    const deltaOut = MAX_ANGLE - outOf;
    expect(deltaIn).toBeCloseTo(MAX_ANGLE * RESPONSE_RATE * DT, 5);
    expect(deltaOut).toBeCloseTo(MAX_ANGLE * RETURN_RATE * DT, 5);
    expect(deltaIn, 'attack outruns release').toBeGreaterThan(deltaOut);

    watch.assertClean();
  });
});

test.describe('the turn term — the aim-locked schemes still bank', () => {
  test('carving under thrust banks; the same sweep coasting stays level', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // 4 rad/s is the authored full-bank rate (1 / YAW_GAIN).  Thrust rides
    // the facing exactly — the touch / joystick / gamepad geometry, where
    // the strafe term is identically zero — so any bank here is the turn
    // term's alone.  This is the case the user's report was about.
    const carve = await driveTurn(page, { ratePerSec: 4, throttle: 1, ticks: 120 });
    expect(carve, 'a full-rate carve reaches a deep bank').toBeGreaterThan(MAX_ANGLE * 0.6);

    // The same sweep with no thrust: a coasting nose-swing changes no
    // acceleration, so the throttle gate must hold it level.
    const coast = await driveTurn(page, { ratePerSec: 4, throttle: 0, ticks: 120 });
    expect(coast, 'a coasting swing stays level').toBeLessThan(0.05);

    // Half throttle banks shallower than full — the gate is a scale, not a
    // switch.
    const half = await driveTurn(page, { ratePerSec: 4, throttle: 0.5, ticks: 120 });
    expect(half).toBeGreaterThan(0.05);
    expect(half).toBeLessThan(carve);

    watch.assertClean();
  });
});

test.describe('the DBG feel cycle steps the bank depth live', () => {
  test('Deep out-banks Default, and Off levels out through the easing', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // The cycle ships on Default (index 2 of Off / Subtle / Default / Deep),
    // so one step lands on Deep and one more wraps to Off.  Each probe runs
    // cycle + ticks inside ONE evaluate so live sim steps can't interleave.
    const deep = await engine(page, e => {
      e.dbg.cyclePlayerRoll(); // Default → Deep
      e.player.rotation = 0;
      e.player.visualRoll = 0;
      e._rollPrevFacing = null;
      e._rollYawRate = 0;
      for (let i = 0; i < 300; i++) e.tickPlayerRoll(1 / 60, { x: 0, y: 1 });
      return e.player.visualRoll as number;
    });
    expect(Math.abs(deep), 'Deep converges past the Default maximum').toBeGreaterThan(MAX_ANGLE + 0.05);

    const off = await engine(page, e => {
      e.dbg.cyclePlayerRoll(); // Deep → Off
      e.player.rotation = 0;
      e.player.visualRoll = 0.5; // mid-bank when the preset flips
      e._rollPrevFacing = null;
      e._rollYawRate = 0;
      for (let i = 0; i < 300; i++) e.tickPlayerRoll(1 / 60, { x: 0, y: 1 });
      return e.player.visualRoll as number;
    });
    // Off's target is 0 even under full strafe, and the settle rides the
    // normal easing + rest snap — literal 0, not an epsilon hover.
    expect(off, 'Off levels a held strafe out completely').toBe(0);

    // The preset name reaches the HUD stats payload the DBG row renders.
    await waitForStats(page, s => s.rollFeelName === 'Off', 'the Off preset to reach stats');

    watch.assertClean();
  });
});

test.describe('the bank happens in real flight', () => {
  test('a held strafe key banks the ship and releasing it levels off', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // Pin the FACING via the aim pointer (the sim re-derives rotation from
    // it every step, so writing rotation directly would not stick): aim
    // dead right of screen centre → facing 0 → KeyS (+y) is a pure strafe.
    await engine(page, e => {
      e.input.mousePosition = { x: window.innerWidth / 2 + 200, y: window.innerHeight / 2 };
      e.player.velocity.x = 0;
      e.player.velocity.y = 0;
      e.input.keys.add('KeyS');
    });

    await waitForEngine(
      page,
      e => Math.abs(e.player.visualRoll ?? 0) > 0.4,
      'the ship to bank into the strafe',
    );

    await engine(page, e => e.input.keys.delete('KeyS'));
    await waitForEngine(
      page,
      e => (e.player.visualRoll ?? 1) === 0,
      'the ship to settle back level',
    );

    // The renderer drew banked frames the whole way — the clean console is
    // what asserts the composed roll transform never threw.
    watch.assertClean();
  });
});
