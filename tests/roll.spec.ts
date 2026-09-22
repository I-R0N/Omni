/** Directional tilt — the player ship pitches and rolls into changing
 *  acceleration, full 360°.
 *
 *  The ROLL half (lateral) has two terms (PLAYER_ROLL_CONSTANTS documents
 *  why both exist): the STRAFE term — the thrust input's component
 *  perpendicular to the facing axis — and the TURN term — the smoothed
 *  rate the nose is swinging, gated by throttle, added because under the
 *  aim-locked schemes (touch / joystick / gamepad) the ship aims where it
 *  flies, thrust is always along the nose, and a strafe-only signal is
 *  zero by construction (the user report that prompted it: "not noticing
 *  the roll").  Two physics terms refine the roll: the turn gate is
 *  CENTRIPETAL (tan(bank) ∝ v·ω — bank scales with real speed, floored),
 *  and a SLIP term reads the velocity's drift off the nose under power,
 *  so a hard turn stays banked through its slide.  The PITCH half
 *  (longitudinal) is nose-line thrust directly (the washout was removed —
 *  user call): a held throttle holds the lean, cutting it settles level,
 *  reverse thrust leans the other way.  Easing is a SECOND-ORDER SPRING
 *  whose frequency divides by the square root of the ship's mass ratio,
 *  and a TUMBLE test mode turns the signal into continuous roll RATE.
 *  Both halves are purely
 *  presentational — `visualRoll` + `visualPitch` are eased angles the
 *  renderer combines into ONE tilt toward the acceleration and projects
 *  as a cos(tilt) foreshortening along it — so what is pinned here is the
 *  SIGNAL and the EASING, not pixels:
 *
 *   1. DIRECTIONALITY — lateral thrust banks, nose-line thrust does not,
 *      and a left strafe and a right strafe are distinct (signed) banks.
 *   2. CONVERGENCE — a held strafe SETTLES on the authored MAX_ANGLE
 *      (the transient overshoots — that is claim 3's point — but the
 *      settle lands on it); releasing settles to EXACTLY level (the snap
 *      that keeps the renderer on its plain-rotation path).
 *   3. SPRING — the first tick carries the ω²·A·dt² signature of a
 *      second-order spring, and a step OVERSHOOTS and comes back — the
 *      wobble that reads as inertia.  Ship WEIGHT slows the spring
 *      (ω ∝ 1/√mass), pinned as an exact first-tick ratio.
 *   4. TURN TERM — carving a turn under thrust banks even with thrust
 *      locked along the nose (the aim-locked geometry), a coasting swing
 *      stays level, and the throttle gate scales rather than switches.
 *   5. PITCH — a held throttle holds the lean, cutting it settles to
 *      literal level, reverse thrust leans the other way, pure nose-line
 *      thrust never rolls, a diagonal fires BOTH axes, and the combined
 *      tilt vector respects the authored maximum (a per-axis clamp would
 *      let a diagonal reach √2 of it).
 *   5b. PHYSICS TERMS — a standing pivot banks at the floor while a
 *      full-speed carve banks fully (centripetal), and a powered drift
 *      banks into the slide while a coasting one stays level (slip).
 *   5c. TUMBLE — the DBG tilt mode where thrust drives roll RATE: the
 *      angle sails past any lean maximum and keeps advancing while
 *      thrust holds, and freezes mid-roll when it drops.
 *   5d. LEAN DIR — the DBG A/B that negates both axes: one sign over the
 *      signal vector, so each axis's first tick mirrors EXACTLY, and
 *      Tumble deliberately keeps its own direction.
 *   5e. TILT SOURCE — the DBG cycle choosing what drives the signal:
 *      Thrust (default — no input, no tilt) vs Velocity (the ship's
 *      motion — a coasting drift banks, thrust at rest is silent, and
 *      coasting motion keeps a tumble rolling), plus AVERAGE and SUM,
 *      which blend the two rotation EFFECTS: Average is exactly their
 *      midpoint, Sum exactly their total (so twice Average), and Sum
 *      saturates on the authored maximum where Average is still short.
 *   6. END TO END — a real held key across live sim steps banks the ship,
 *      and releasing it levels off, with the renderer drawing throughout
 *      (the clean-console assertion is what covers the transform math).
 *
 *  The unit claims drive `tickPlayerRoll` inside a single evaluate so the
 *  live loop cannot interleave its own ticks mid-measurement (the same
 *  atomicity trick the input suite leans on, harness rule 8).
 */

import { test, expect } from '@playwright/test';
import { boot, enableTilt, engine, startRun, waitForEngine, waitForStats } from './helpers';

/** PLAYER_ROLL_CONSTANTS, hard-coded rather than imported (harness rule 7). */
const MAX_ANGLE = 0.85;
const SPRING_OMEGA = 12;
const SPRING_ZETA = 0.55;

const DT = 1 / 60;

/** Drive the roll tick N times against a fixed facing + thrust input, all
 *  inside ONE evaluate so live sim steps can't interleave.  Resets the
 *  turn-term trackers first — the live loop has been feeding them its own
 *  facing between evaluates, and a stale prev-facing would spike the yaw
 *  rate on the first measured tick.  Returns the roll after the last
 *  tick. */
function driveRoll(
  page: any,
  o: { facing: number; mx: number; my: number; ticks: number; start?: number; peak?: boolean },
) {
  return engine(page, (e, a: typeof o) => {
    e.player.rotation = a.facing;
    e.player.visualRoll = a.start ?? 0;
    e._rollPrevFacing = null;
    e._rollYawRate = 0;
    e._rollVel = 0;
    e._pitchVel = 0;
    e.player.visualPitch = 0;
    e.player.velocity.x = 0;
    e.player.velocity.y = 0;
    let pk = 0;
    for (let i = 0; i < a.ticks; i++) {
      e.tickPlayerRoll(1 / 60, { x: a.mx, y: a.my });
      pk = Math.max(pk, Math.abs(e.player.visualRoll ?? 0));
    }
    return (a.peak ? pk : e.player.visualRoll) as number;
  }, o);
}

/** Sweep the FACING at a constant rate with thrust locked ALONG it — the
 *  aim-locked schemes' geometry, where the strafe term is identically zero
 *  and only the turn term can bank.  `speedFrac` pins the VELOCITY along
 *  the facing each tick (as a fraction of the speed cap), because the
 *  turn gate is centripetal — bank scales with real speed — and keeping
 *  the velocity on the nose keeps the slip term silent.  Returns the peak
 *  |roll| over the sweep. */
function driveTurn(
  page: any,
  o: { ratePerSec: number; throttle: number; ticks: number; speedFrac: number },
) {
  return engine(page, (e, a: typeof o) => {
    e.player.rotation = 0;
    e.player.visualRoll = 0;
    e._rollPrevFacing = null;
    e._rollYawRate = 0;
    e._rollVel = 0;
    e._pitchVel = 0;
    e.player.visualPitch = 0;
    let peak = 0;
    for (let i = 0; i < a.ticks; i++) {
      e.player.rotation += a.ratePerSec / 60;
      const f = e.player.rotation;
      const spd = a.speedFrac * e.lastMaxSpeed;
      e.player.velocity.x = Math.cos(f) * spd;
      e.player.velocity.y = Math.sin(f) * spd;
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
    await enableTilt(page);

    // Facing +x: thrust along +y is a pure strafe, +x is pure nose-line.
    const strafe = await driveRoll(page, { facing: 0, mx: 0, my: 1, ticks: 240 });
    const level = await driveRoll(page, { facing: 0, mx: 1, my: 0, ticks: 240 });
    const other = await driveRoll(page, { facing: 0, mx: 0, my: -1, ticks: 240 });

    expect(Math.abs(strafe), 'a held strafe reaches a deep bank').toBeGreaterThan(MAX_ANGLE * 0.9);
    expect(Math.abs(strafe), 'and the settle lands ON the maximum').toBeLessThanOrEqual(MAX_ANGLE + 1e-6);
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
    await enableTilt(page);

    // From a full bank with no input the roll must reach literal 0 — the
    // snap that keeps the renderer on its plain-rotation path — not hover
    // at some epsilon forever.
    const settled = await driveRoll(page, { facing: 0, mx: 0, my: 0, ticks: 240, start: MAX_ANGLE });
    expect(settled).toBe(0);

    const coast = await driveRoll(page, { facing: 0, mx: 0, my: 0, ticks: 240 });
    expect(coast, 'no input, no bank').toBe(0);

    watch.assertClean();
  });

  test('the tilt is a second-order spring: it overshoots and settles', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await enableTilt(page);

    // First tick from rest: semi-implicit Euler picks up v = ω²·A·dt and
    // moves the angle by v·dt — the ω²·A·dt² signature of a SPRING (a
    // first-order lerp's first step is rate·A·dt, linear in the rate).
    const first = await driveRoll(page, { facing: 0, mx: 0, my: 1, ticks: 1 });
    expect(Math.abs(first)).toBeCloseTo(SPRING_OMEGA ** 2 * MAX_ANGLE * DT * DT, 6);

    // The transient OVERSHOOTS the target and comes back — ζ < 1 by
    // design, because the wobble is what reads as a hull with inertia.
    const peak = await driveRoll(page, { facing: 0, mx: 0, my: 1, ticks: 240, peak: true });
    expect(peak, 'a step overshoots the target').toBeGreaterThan(MAX_ANGLE * 1.03);
    expect(peak, 'and stays bracketed').toBeLessThan(MAX_ANGLE * 1.35);

    watch.assertClean();
  });
});

test.describe('the turn term — the aim-locked schemes still bank', () => {
  test('carving under thrust banks; the same sweep coasting stays level', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await enableTilt(page);

    // 4 rad/s is the authored full-bank rate (1 / YAW_GAIN).  Thrust rides
    // the facing exactly — the touch / joystick / gamepad geometry, where
    // the strafe term is identically zero — so any bank here is the turn
    // term's alone.  This is the case the user's report was about.
    const carve = await driveTurn(page, { ratePerSec: 4, throttle: 1, ticks: 120, speedFrac: 1 });
    expect(carve, 'a full-speed carve reaches a deep bank').toBeGreaterThan(MAX_ANGLE * 0.6);

    // The same sweep with no thrust: a coasting nose-swing curves no
    // path, so the throttle gate must hold it level.
    const coast = await driveTurn(page, { ratePerSec: 4, throttle: 0, ticks: 120, speedFrac: 1 });
    expect(coast, 'a coasting swing stays level').toBeLessThan(0.05);

    // Half throttle banks shallower than full — the gate is a scale, not a
    // switch.
    const half = await driveTurn(page, { ratePerSec: 4, throttle: 0.5, ticks: 120, speedFrac: 1 });
    expect(half).toBeGreaterThan(0.05);
    expect(half).toBeLessThan(carve);

    // CENTRIPETAL (physics: tan(bank) ∝ v·ω): the same stick motion while
    // barely moving banks at the TURN_SPEED_FLOOR, not the full carve — a
    // pivot in place curves almost no path.
    const pivot = await driveTurn(page, { ratePerSec: 4, throttle: 1, ticks: 120, speedFrac: 0 });
    expect(pivot, 'a standing pivot still reads').toBeGreaterThan(0.1);
    expect(pivot, 'but banks shallower than the full-speed carve')
      .toBeLessThan(carve * 0.6);

    watch.assertClean();
  });
});

test.describe('the slip term — the drift of a hard turn holds the bank', () => {
  test('drifting sideways under power banks; the same drift coasting does not', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await enableTilt(page);

    /** Hold a fixed facing + thrust with the VELOCITY pinned per tick —
     *  the post-hard-turn state, where the nose points one way and the
     *  path still runs another. */
    const drive = (mx: number, my: number, vLatFrac: number) =>
      engine(page, (e, a: { mx: number; my: number; vf: number }) => {
        e.player.rotation = 0;
        e.player.visualRoll = 0;
        e.player.visualPitch = 0;
        e._rollPrevFacing = null;
        e._rollYawRate = 0;
        e._rollVel = 0;
        e._pitchVel = 0;
      e._rollVel = 0;
      e._pitchVel = 0;
    e._rollVel = 0;
    e._pitchVel = 0;
        for (let i = 0; i < 240; i++) {
          e.player.velocity.x = 0;
          e.player.velocity.y = a.vf * e.lastMaxSpeed;
          e.tickPlayerRoll(1 / 60, { x: a.mx, y: a.my });
        }
        return e.player.visualRoll as number;
      }, { mx, my, vf: vLatFrac });

    // Full lateral drift under nose-line thrust: the strafe term is zero
    // and the nose is steady, so the lateral half is the slip term's
    // alone — SLIP_GAIN (0.5), shared with the held pitch through the
    // vector clamp, so the realized bank sits between the floor'd and
    // unclamped values rather than at an exact figure.
    const drift = await drive(1, 0, 1);
    expect(Math.abs(drift), 'a powered drift banks into the slide')
      .toBeGreaterThan(MAX_ANGLE * 0.35);
    expect(Math.abs(drift)).toBeLessThan(MAX_ANGLE * 0.55);

    // The same drift with no thrust: the throttle gate holds it level —
    // the "no input, no tilt" rule survives the new term.
    const coast = await drive(0, 0, 1);
    expect(coast, 'a coasting drift stays level').toBe(0);

    watch.assertClean();
  });
});

test.describe('the pitch half — thrust holds the lean, cutting it settles', () => {
  test('held throttle holds the lean, cutting settles to level, reverse leans back', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await enableTilt(page);

    const r = await engine(page, e => {
      e.player.rotation = 0;
      e.player.visualRoll = 0;
      e.player.visualPitch = 0;
      e._rollPrevFacing = null;
      e._rollYawRate = 0;
      e._rollVel = 0;
      e._pitchVel = 0;
    e._rollVel = 0;
    e._pitchVel = 0;
      e.player.velocity.x = 0;
      e.player.velocity.y = 0;
      // Hold the throttle straight along the nose: with the washout gone
      // (user call), the lean CONVERGES and HOLDS rather than pulsing.
      for (let i = 0; i < 300; i++) e.tickPlayerRoll(1 / 60, { x: 1, y: 0 });
      const held = e.player.visualPitch as number;
      const rollDuring = Math.abs(e.player.visualRoll ?? 0);
      // Cut the throttle: the target is exactly 0, so the lean settles to
      // literal level through the same easing + rest snap.
      for (let i = 0; i < 300; i++) e.tickPlayerRoll(1 / 60, { x: 0, y: 0 });
      const settled = e.player.visualPitch as number;
      // Reverse thrust leans the OTHER way — the sign keeps the easing
      // continuous through the reversal.
      for (let i = 0; i < 300; i++) e.tickPlayerRoll(1 / 60, { x: -1, y: 0 });
      const reversed = e.player.visualPitch as number;
      return { held, rollDuring, settled, reversed };
    });

    expect(Math.abs(r.held), 'a held throttle holds a deep lean').toBeGreaterThan(MAX_ANGLE * 0.9);
    expect(Math.abs(r.held), 'without overshooting the maximum').toBeLessThanOrEqual(MAX_ANGLE + 1e-9);
    expect(r.rollDuring, 'pure nose-line thrust never rolls').toBeLessThan(1e-9);
    expect(r.settled, 'cutting thrust settles to literal level').toBe(0);
    expect(Math.sign(r.reversed), 'reverse thrust leans the other way').toBe(-Math.sign(r.held));
    expect(Math.abs(r.reversed)).toBeCloseTo(Math.abs(r.held), 5);

    watch.assertClean();
  });

  test('a diagonal thrust tilts on BOTH axes, inside the authored maximum', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await enableTilt(page);

    const r = await engine(page, e => {
      e.player.rotation = 0;
      e.player.visualRoll = 0;
      e.player.visualPitch = 0;
      e._rollPrevFacing = null;
      e._rollYawRate = 0;
      e._rollVel = 0;
      e._pitchVel = 0;
    e._rollVel = 0;
    e._pitchVel = 0;
      e.player.velocity.x = 0;
      e.player.velocity.y = 0;
      let roll = 0, pitch = 0, maxTilt = 0;
      for (let i = 0; i < 300; i++) {
        e.tickPlayerRoll(1 / 60, { x: Math.SQRT1_2, y: Math.SQRT1_2 });
        const rr = Math.abs(e.player.visualRoll ?? 0);
        const pp = Math.abs(e.player.visualPitch ?? 0);
        roll = Math.max(roll, rr);
        pitch = Math.max(pitch, pp);
        maxTilt = Math.max(maxTilt, Math.sqrt(rr * rr + pp * pp));
      }
      const fr = Math.abs(e.player.visualRoll ?? 0);
      const fp = Math.abs(e.player.visualPitch ?? 0);
      return { roll, pitch, maxTilt, finalTilt: Math.sqrt(fr * fr + fp * fp) };
    });

    expect(r.roll, 'the lateral half fires').toBeGreaterThan(0.1);
    expect(r.pitch, 'the longitudinal half fires').toBeGreaterThan(0.1);
    // The SIGNAL VECTOR is magnitude-clamped, so the SETTLED tilt stays
    // inside the authored maximum instead of reaching √2 of it on a
    // diagonal; the spring's transient may overshoot, bracketed by the
    // MAX_TILT mirror ceiling (1.45).
    expect(r.finalTilt, 'the settled tilt respects the maximum')
      .toBeLessThanOrEqual(MAX_ANGLE + 1e-6);
    expect(r.maxTilt, 'and the transient never crosses the mirror ceiling')
      .toBeLessThanOrEqual(1.45 + 1e-9);

    watch.assertClean();
  });
});

test.describe('the DBG feel cycle steps the bank depth live', () => {
  test('Deep out-banks Default, and Off levels out through the easing', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await enableTilt(page);

    // The cycle SHIPS on Off (an untouched build has no tilt at all);
    // enableTilt above stepped it to Default, so one step from here lands
    // on Deep and one more wraps back to Off.  Each probe runs
    // cycle + ticks inside ONE evaluate so live sim steps can't interleave.
    const deep = await engine(page, e => {
      e.dbg.cyclePlayerRoll(); // Default → Deep
      e.player.rotation = 0;
      e.player.visualRoll = 0;
      e._rollPrevFacing = null;
      e._rollYawRate = 0;
      e._rollVel = 0;
      e._pitchVel = 0;
    e._rollVel = 0;
    e._pitchVel = 0;
      e.player.visualPitch = 0;
      e.player.velocity.x = 0;
      e.player.velocity.y = 0;
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
      e._rollVel = 0;
      e._pitchVel = 0;
    e._rollVel = 0;
    e._pitchVel = 0;
      e.player.visualPitch = 0;
      e.player.velocity.x = 0;
      e.player.velocity.y = 0;
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

test.describe('the hull cycle', () => {
  test('the sprite ships as the default, and every hull renders a live bank', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await enableTilt(page);

    // The legacy SPRITE is the shipped default (user call): an untouched
    // build must look exactly as it did before any of the tilt work
    // existed.  Pinned here because a default is exactly what drifts
    // unwatched — and because the whole point of the Off/Ship pair is that
    // a player who never opens the debug menu sees none of this.
    await waitForStats(page, s => s.hullModeName === 'Ship', 'the sprite default');

    // Hold a strafe for the whole walk, so every wireframe shape renders
    // BANKED live frames — the clean-console assertion is what covers
    // each shape's vertex/edge table and projection.
    await engine(page, e => {
      e.input.mousePosition = { x: window.innerWidth / 2 + 200, y: window.innerHeight / 2 };
      e.input.keys.add('KeyS');
    });
    await waitForEngine(
      page,
      e => Math.abs(e.player.visualRoll ?? 0) > 0.3,
      'a live bank on the sprite',
    );

    // Unrolled rather than looped: waitForStats SERIALIZES its predicate
    // into the page (harness rule — no closure variables survive), so each
    // shape's name must be a literal.  The stats push between steps
    // implies rendered frames — each shape drew banked.
    // ORDER IS THE POINT: 'Sheet' sits immediately after the default, so
    // switching to the pre-rendered art is ONE step of this row.  The
    // wireframes are the experimental tail behind it.
    await engine(page, e => e.dbg.cyclePlayerHull());
    await waitForStats(page, s => s.hullModeName === 'Sheet', 'the tilt-sheet hull, one step from the default');
    await engine(page, e => e.dbg.cyclePlayerHull());
    await waitForStats(page, s => s.hullModeName === 'Cube', 'the Cube hull');
    await engine(page, e => e.dbg.cyclePlayerHull());
    await waitForStats(page, s => s.hullModeName === 'Diamond', 'the Diamond hull');
    await engine(page, e => e.dbg.cyclePlayerHull());
    await waitForStats(page, s => s.hullModeName === 'Sphere', 'the Sphere hull');
    await engine(page, e => e.dbg.cyclePlayerHull());
    await waitForStats(page, s => s.hullModeName === 'Dodeca', 'the Dodeca hull');
    await engine(page, e => e.dbg.cyclePlayerHull());
    await waitForStats(page, s => s.hullModeName === 'Rhombic', 'the Rhombic hull');
    await engine(page, e => e.dbg.cyclePlayerHull());
    await waitForStats(page, s => s.hullModeName === 'Tri', 'the Tri dart ship');

    await engine(page, e => e.input.keys.delete('KeyS'));
    await engine(page, e => e.dbg.cyclePlayerHull());
    await waitForStats(page, s => s.hullModeName === 'Ship', 'wrapping back to the default');

    watch.assertClean();
  });
});

test.describe('the rotation-damping cycle', () => {
  test('one multiplier scales the spring frequency, keeping its character', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await enableTilt(page);

    /** One tick into a full strafe from level, at the current damping —
     *  the first-tick delta IS the effective attack rate. */
    const oneTick = () => driveRoll(page, { facing: 0, mx: 0, my: 1, ticks: 1 });

    // Cycle order is Floaty / Default / Stiff / Snappy, shipped at
    // Default — so one step lands on Stiff, and two more wrap to Floaty.
    // The multiplier scales the spring's ω, so the first-tick step
    // (ω²·A·dt²) scales with the SQUARE of the preset.
    const base = SPRING_OMEGA ** 2 * MAX_ANGLE * DT * DT;
    const atDefault = Math.abs(await oneTick());
    await engine(page, e => e.dbg.cycleRollDamping()); // Default → Stiff
    const atStiff = Math.abs(await oneTick());
    await engine(page, e => e.dbg.cycleRollDamping()); // Stiff → Snappy
    await engine(page, e => e.dbg.cycleRollDamping()); // Snappy → Floaty
    const atFloaty = Math.abs(await oneTick());

    expect(atDefault).toBeCloseTo(base, 6);
    expect(atStiff, 'Stiff doubles ω, quadrupling the first step').toBeCloseTo(base * 4, 6);
    expect(atFloaty, 'Floaty halves ω, quartering it').toBeCloseTo(base * 0.25, 6);

    // The release moves by the SAME spring — one ω, one ζ — so the
    // wobble character survives every preset.
    const outFloaty = await driveRoll(page, { facing: 0, mx: 0, my: 0, ticks: 1, start: MAX_ANGLE });
    expect(MAX_ANGLE - outFloaty, 'Floaty release').toBeCloseTo(base * 0.25, 6);

    await engine(page, e => e.dbg.cycleRollDamping()); // Floaty → Default
    await waitForStats(page, s => s.rollDampName === 'Default', 'the name reaches stats');

    watch.assertClean();
  });
});

test.describe('tilt inertia rides ship weight', () => {
  test('a heavier ship tilts more ponderously — an exact first-tick ratio', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await enableTilt(page);

    // ω divides by √(mass ratio), so the first-tick step (∝ ω²) divides
    // by the ratio itself.  The lean start's mass IS the reference mass,
    // so ×9 gives exactly a ninth of the response — the same physics that
    // makes a laden hull shrug off shoves makes it tilt slowly.
    const lean = await driveRoll(page, { facing: 0, mx: 0, my: 1, ticks: 1 });
    await engine(page, e => { e._testSavedMass = e.player.mass; e.player.mass *= 9; });
    const laden = await driveRoll(page, { facing: 0, mx: 0, my: 1, ticks: 1 });
    await engine(page, e => { e.player.mass = e._testSavedMass; });

    expect(Math.abs(laden), 'nine times the mass, a ninth the response')
      .toBeCloseTo(Math.abs(lean) / 9, 6);

    watch.assertClean();
  });
});

test.describe('the tumble tilt mode — thrust drives continuous roll', () => {
  test('held thrust keeps the hull rolling; cutting it freezes mid-roll', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await enableTilt(page);

    const r = await engine(page, e => {
      e.dbg.cycleTiltMode(); // Lean → Tumble
      e.player.rotation = 0;
      e.player.visualRoll = 0;
      e.player.visualPitch = 0;
      e._rollPrevFacing = null;
      e._rollYawRate = 0;
      e._rollVel = 0;
      e._pitchVel = 0;
      e.player.velocity.x = 0;
      e.player.velocity.y = 0;
      // Hold forward thrust: the pitch angle keeps ADVANCING — past any
      // lean-mode maximum — instead of converging on a target.
      let past = 0;
      let early = 0;
      for (let i = 0; i < 180; i++) {
        e.tickPlayerRoll(1 / 60, { x: 1, y: 0 });
        past = Math.max(past, Math.abs(e.player.visualPitch ?? 0));
        // Sampled before the first ±π wrap, where the sign is unambiguous.
        if (i === 14) early = e.player.visualPitch as number;
      }
      const mid = e.player.visualPitch as number;
      for (let i = 0; i < 60; i++) e.tickPlayerRoll(1 / 60, { x: 1, y: 0 });
      const later = e.player.visualPitch as number;
      // Cut thrust: the roll rate decays and the hull FREEZES where it
      // stopped, like a rolled object — no spring pulling it level.
      for (let i = 0; i < 120; i++) e.tickPlayerRoll(1 / 60, { x: 0, y: 0 });
      const frozen1 = e.player.visualPitch as number;
      for (let i = 0; i < 60; i++) e.tickPlayerRoll(1 / 60, { x: 0, y: 0 });
      const frozen2 = e.player.visualPitch as number;
      e.dbg.cycleTiltMode(); // Tumble → back to Lean
      return { past, early, mid, later, frozen1, frozen2 };
    });

    // 1.2 rad is past the Deep preset's 1.15 — unreachable in lean mode.
    expect(r.past, 'the angle sails past any lean maximum').toBeGreaterThan(1.2);
    // The tumble rolls OPPOSITE to the lean's tilt (user call): forward
    // thrust — a positive lean pitch — tumbles the angle negative.
    expect(r.early, 'and it rolls the opposite way to the lean').toBeLessThan(0);
    // One more second of thrust moved it ~4 rad (mod 2π) — still rolling.
    expect(Math.abs(r.later - r.mid), 'and it keeps advancing under thrust')
      .toBeGreaterThan(0.5);
    expect(r.frozen1, 'cutting thrust freezes it mid-roll').toBeCloseTo(r.frozen2, 10);

    // And LIVE: render some tumbling frames — the marker hides and the aim
    // reticle draws in this mode, and the clean-console assertion is what
    // covers that draw path.
    await engine(page, e => {
      e.dbg.cycleTiltMode(); // Lean → Tumble
      e.input.mousePosition = { x: window.innerWidth / 2 + 200, y: window.innerHeight / 2 };
      e.input.keys.add('KeyD');
    });
    await waitForEngine(
      page,
      e => Math.abs(e.player.visualPitch ?? 0) > 0.2,
      'a live tumble on screen',
    );
    await engine(page, e => {
      e.input.keys.delete('KeyD');
      e.dbg.cycleTiltMode(); // back to Lean
    });
    await waitForStats(page, s => s.tiltModeName === 'Lean', 'the mode restored');

    watch.assertClean();
  });
});

test.describe('the lean-direction A/B', () => {
  test('Reversed mirrors both axes exactly; Tumble keeps its own direction', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await enableTilt(page);

    // One tick into a diagonal (both axes firing) at each direction — the
    // reversal is ONE sign over the whole signal vector, so each axis's
    // first tick mirrors EXACTLY: same spring, same magnitude, opposite
    // sign.  Anything less than exact would mean a second code path.
    const probe = () => engine(page, e => {
      e.player.rotation = 0;
      e.player.visualRoll = 0;
      e.player.visualPitch = 0;
      e._rollPrevFacing = null;
      e._rollYawRate = 0;
      e._rollVel = 0;
      e._pitchVel = 0;
      e.player.velocity.x = 0;
      e.player.velocity.y = 0;
      e.tickPlayerRoll(1 / 60, { x: 0.6, y: 0.8 });
      return { roll: e.player.visualRoll as number, pitch: e.player.visualPitch as number };
    });

    const fwd = await probe();
    await engine(page, e => e.dbg.cycleLeanDir()); // Default → Reversed
    const rev = await probe();
    await engine(page, e => e.dbg.cycleLeanDir()); // Reversed → back to Default

    expect(fwd.roll, 'the default strafe bank keeps the shipped sign').toBeGreaterThan(0);
    expect(fwd.pitch, 'and the default throttle lean').toBeGreaterThan(0);
    expect(rev.roll, 'Reversed mirrors the roll exactly').toBeCloseTo(-fwd.roll, 12);
    expect(rev.pitch, 'and the pitch').toBeCloseTo(-fwd.pitch, 12);

    // Tumble is deliberately UNAFFECTED — its direction (roll WITH the
    // travel) was its own user call, and the lean sign must not
    // double-negate it.  Same early-sample claim the tumble suite pins.
    const tumbleEarly = await engine(page, e => {
      e.dbg.cycleLeanDir();  // Default → Reversed
      e.dbg.cycleTiltMode(); // Lean → Tumble
      e.player.rotation = 0;
      e.player.visualRoll = 0;
      e.player.visualPitch = 0;
      e._rollPrevFacing = null;
      e._rollYawRate = 0;
      e._rollVel = 0;
      e._pitchVel = 0;
      e.player.velocity.x = 0;
      e.player.velocity.y = 0;
      for (let i = 0; i < 15; i++) e.tickPlayerRoll(1 / 60, { x: 1, y: 0 });
      const p = e.player.visualPitch as number;
      e.dbg.cycleTiltMode(); // back to Lean
      e.dbg.cycleLeanDir();  // back to Default
      return p;
    });
    expect(tumbleEarly, 'Tumble keeps its own direction under Reversed').toBeLessThan(0);

    // And LIVE under Reversed: the wireframe RE-BASES nose-up (the nose
    // feature faces the viewer at rest — user call) — render banked
    // frames so the clean-console assertion covers the re-based path.
    await engine(page, e => {
      e.dbg.cycleLeanDir(); // Default → Reversed
      e.input.mousePosition = { x: window.innerWidth / 2 + 200, y: window.innerHeight / 2 };
      e.input.keys.add('KeyS');
    });
    await waitForEngine(
      page,
      e => Math.abs(e.player.visualRoll ?? 0) > 0.3,
      'a live reversed bank on the nose-up hull',
    );
    await engine(page, e => {
      e.input.keys.delete('KeyS');
      e.dbg.cycleLeanDir(); // back to Default
    });

    await waitForStats(page, s => s.leanDirName === 'Default', 'the name reaches stats');

    watch.assertClean();
  });
});

test.describe('the tilt-source A/B', () => {
  test('Velocity leans with motion: a coasting drift banks, thrust at rest is silent', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await enableTilt(page);

    const r = await engine(page, e => {
      const reset = () => {
        e.player.rotation = 0;
        e.player.visualRoll = 0;
        e.player.visualPitch = 0;
        e._rollPrevFacing = null;
        e._rollYawRate = 0;
        e._rollVel = 0;
        e._pitchVel = 0;
        e.player.velocity.x = 0;
        e.player.velocity.y = 0;
      };
      e.dbg.cycleTiltSource(); // Thrust → Velocity

      // A coasting sideways drift — ZERO input — banks under the
      // velocity source.  The exact case the slip test pins to literal 0
      // under the Thrust default, so together the two tests prove the
      // A/B is a real behavioural flip rather than a renamed knob.
      // Pinned at the ship's real CRUISE speed, not the cap: the signal
      // must read FULL-strength at speeds the ship actually reaches
      // (normalising by the cap ran it ~3× weak — user report), so this
      // drift must settle a DEEP bank, and the normaliser itself must
      // sit well under the cap or it has regressed to the cap.
      reset();
      e.player.velocity.y = e.lastCruiseSpeed;
      for (let i = 0; i < 240; i++) e.tickPlayerRoll(1 / 60, { x: 0, y: 0 });
      const coastBank = e.player.visualRoll as number;
      const cruiseFrac = e.lastCruiseSpeed / e.lastMaxSpeed;

      // Full thrust from a standstill: velocity is zero, so the first
      // tick moves NOTHING — the input stopped being the signal.
      reset();
      e.tickPlayerRoll(1 / 60, { x: 0, y: 1 });
      const restTick = e.player.visualRoll as number;

      // TUMBLE under the velocity source: coasting motion alone keeps
      // the hull rolling — the source reaches both tilt modes.
      e.dbg.cycleTiltMode(); // Lean → Tumble
      reset();
      e.player.velocity.x = e.lastCruiseSpeed;
      for (let i = 0; i < 30; i++) e.tickPlayerRoll(1 / 60, { x: 0, y: 0 });
      const tumblePitch = e.player.visualPitch as number;
      e.dbg.cycleTiltMode();   // back to Lean

      // VEL GAIN — the sensitivity cycle multiplies the normalised
      // signal BEFORE the clamp, so a step moves WHERE the tilt
      // saturates, never how deep it goes.  First-tick arithmetic at a
      // pinned drift makes each step exact (SLIP_GAIN 0.5 rides along:
      // at gain 1× and half cruise the target is (0.5 + 0.5·0.5·0.5)
      // = 0.625 of max; any gain-saturated case is exactly full).
      const oneTick = (vy: number) => {
        reset();
        e.player.velocity.y = vy;
        e.tickPlayerRoll(1 / 60, { x: 0, y: 0 });
        return e.player.visualRoll as number;
      };
      const halfAt1 = oneTick(e.lastCruiseSpeed / 2);      // gain 1×
      e.dbg.cycleVelGain();                                 // 1× → 2×
      const halfAt2 = oneTick(e.lastCruiseSpeed / 2);      // saturates
      e.dbg.cycleVelGain();                                 // 2× → 4×
      e.dbg.cycleVelGain();                                 // 4× → 10×
      const tinyAt10 = oneTick(e.lastCruiseSpeed * 0.15);  // extreme: saturates
      e.dbg.cycleVelGain();                                 // 10× → back to 1×

      // The cycle is FOUR long now (Thrust / Velocity / Average / Sum), so
      // getting back to Thrust from Velocity is three steps, not one.
      e.dbg.cycleTiltSource(); // Velocity → Average
      e.dbg.cycleTiltSource(); // Average → Sum
      e.dbg.cycleTiltSource(); // Sum → wraps to Thrust
      return { coastBank, restTick, tumblePitch, cruiseFrac, halfAt1, halfAt2, tinyAt10 };
    });

    // The spring's first-tick signature at a full-strength target.
    const base = SPRING_OMEGA ** 2 * MAX_ANGLE * DT * DT;
    expect(r.halfAt1, 'half cruise at 1× is the un-gained 0.625 signal')
      .toBeCloseTo(base * 0.625, 6);
    expect(r.halfAt2, '2× saturates the same drift to full').toBeCloseTo(base, 6);
    expect(r.tinyAt10, '10× saturates a 15%-cruise drift to full').toBeCloseTo(base, 6);

    expect(r.coastBank, 'a drift at real cruise speed settles a DEEP bank')
      .toBeGreaterThan(MAX_ANGLE * 0.9);
    expect(r.cruiseFrac, 'the normaliser is the terminal speed, well under the cap')
      .toBeLessThan(0.5);
    expect(r.restTick, 'thrust at rest moves nothing — velocity is the signal now').toBe(0);
    expect(Math.abs(r.tumblePitch), 'and coasting motion drives the tumble').toBeGreaterThan(0.2);

    await waitForStats(page, s => s.tiltSourceName === 'Thrust', 'the name reaches stats');
    // AVERAGE and SUM blend the two rotation EFFECTS, not the two input
    // vectors — each source runs its own throttle gate and slip weighting
    // first, which is the whole difference the A/B exists to show.  Probed
    // at a gentle thrust + drift so NOTHING saturates: every step is then
    // exactly checkable against the two it is built from.
    const blend = await engine(page, e => {
      const reset = () => {
        e.player.rotation = 0;
        e.player.visualRoll = 0;
        e.player.visualPitch = 0;
        e._rollPrevFacing = null;
        e._rollYawRate = 0;
        e._rollVel = 0;
        e._pitchVel = 0;
      };
      // One tick from level at each source: the first-tick delta is
      // proportional to the target, so the deltas carry the signals.
      const tick = () => {
        reset();
        e.player.velocity.x = 0;
        e.player.velocity.y = 0.2 * e.lastCruiseSpeed; // gentle lateral drift
        e.tickPlayerRoll(1 / 60, { x: 0, y: 0.4 });    // gentle strafe
        return e.player.visualRoll as number;
      };
      const thrust = tick();
      e.dbg.cycleTiltSource();               // Thrust → Velocity
      const velocity = tick();
      e.dbg.cycleTiltSource();               // Velocity → Average
      const average = tick();
      e.dbg.cycleTiltSource();               // Average → Sum
      const sum = tick();
      // And a case sized so the PAIR crosses the clamp while NEITHER half
      // does: each source alone signals 0.625 of the maximum (0.5 strafe +
      // 0.125 slip), so Average stays there while Sum's 1.25 saturates.
      // Picking a bigger pair would clamp them both and prove nothing.
      const big = () => {
        reset();
        e.player.velocity.x = 0;
        e.player.velocity.y = 0.5 * e.lastCruiseSpeed;
        e.tickPlayerRoll(1 / 60, { x: 0, y: 0.5 });
        return e.player.visualRoll as number;
      };
      const sumBig = big();
      e.dbg.cycleTiltSource();               // Sum → wraps to Thrust
      e.dbg.cycleTiltSource(); e.dbg.cycleTiltSource(); // → Average
      const avgBig = big();
      e.dbg.cycleTiltSource();               // Average → Sum
      e.dbg.cycleTiltSource();               // Sum → Thrust
      return { thrust, velocity, average, sum, sumBig, avgBig };
    });

    // Both halves contribute, and differently — otherwise the blends below
    // would be vacuous.
    expect(blend.thrust).toBeGreaterThan(0);
    expect(blend.velocity).toBeGreaterThan(0);
    expect(blend.velocity, 'the gentler source reads lower').toBeLessThan(blend.thrust);

    // THE BLEND CLAIMS, exact: Average is the midpoint of the two effects
    // and Sum is their total.  Blending the raw INPUT vectors instead would
    // miss both, because the throttle gate is nonlinear in the vector.
    expect(blend.average, 'Average is the midpoint of the two effects')
      .toBeCloseTo((blend.thrust + blend.velocity) / 2, 12);
    expect(blend.sum, 'Sum is their total').toBeCloseTo(blend.thrust + blend.velocity, 12);
    expect(blend.sum, 'so Sum is exactly twice Average').toBeCloseTo(blend.average * 2, 12);

    // Sum banks SOONER, never deeper: with a bigger pair it saturates on the
    // authored maximum while Average is still climbing toward it.
    const firstTickAtMax = SPRING_OMEGA ** 2 * MAX_ANGLE * DT * DT;
    expect(blend.sumBig, 'Sum saturates on the authored maximum').toBeCloseTo(firstTickAtMax, 10);
    // 0.625 of the maximum, exactly — Average is unclamped and is the
    // midpoint, so the arithmetic is fully determined.
    expect(blend.avgBig, 'while Average is still short of it')
      .toBeCloseTo(firstTickAtMax * 0.625, 10);

    await waitForStats(page, s => s.tiltSourceName === 'Thrust', 'back to the Thrust default');
    await waitForStats(page, s => s.velGainName === '1×', 'the gain name reaches stats');


    watch.assertClean();
  });
});

test.describe('the bank happens in real flight', () => {
  test('a held strafe key banks the ship and releasing it levels off', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await enableTilt(page);

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
