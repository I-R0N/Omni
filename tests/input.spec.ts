/** The gamepad mapping layer (Pair C, c2).
 *
 *  The Gamepad API cannot be synthesised in a headless browser — there is no
 *  way to make `navigator.getGamepads()` return a device, and Playwright has
 *  no pad emulation.  So the layer is split for exactly this reason:
 *  `pollGamepad()` does the untestable part (find the pad, read it) and
 *  `applyPadSnapshot()` does everything else — deadzones, the synthetic
 *  pointer, button edges, the charge window.  This suite drives the second
 *  half with hand-written snapshots, which covers every line of the mapping
 *  the player actually feels.
 *
 *  What it therefore CANNOT say: whether a real DualSense reports the axis
 *  order and button indices the constants assume, over USB or over Bluetooth
 *  on iOS Safari.  That is a hardware check and it is written up in
 *  docs/GAUNTLET_PAIRC_POLISH_LOG.md under FOR-USER-REVIEW.
 *
 *  Assertions route through the real consumers wherever one exists — the
 *  movement vector the player integrates, the rotation the ship renders at,
 *  the dock the interact button reaches — rather than reading the mapping's
 *  own private fields back out (harness rule 6).
 */

import { test, expect } from '@playwright/test';
import { boot, engine, stats, startRun, waitForStats } from './helpers';

// Mirrors of INPUT_CONSTANTS, duplicated on purpose (harness rule 7): if a
// tuning pass moves one, this file should have to change.
const STICK_DEADZONE = 0.18;
const AIM_RADIUS = 150;
const CHARGE_FULL = 1.0;
const SHIP_SELECT_RADIUS = 46;

// W3C standard-gamepad indices, as bound in INPUT_CONSTANTS.GAMEPAD.BUTTONS.
const BTN = {
  CROSS: 0, SQUARE: 2, TRIANGLE: 3,
  R1: 5, R2: 7, OPTIONS: 9,
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
};

/** One frame of pad state: sticks at rest, nothing pressed, unless overridden. */
function pad(opts: {
  lx?: number; ly?: number; rx?: number; ry?: number;
  down?: number[];
  /** Partial ANALOG trigger travel, e.g. { 7: 0.2 } for R2 barely moved.  A
   *  real DualSense also reports `pressed` true at that deflection, which is
   *  the trap the fire point exists to avoid, so this sets BOTH. */
  analog?: Record<number, number>;
} = {}) {
  const pressed: boolean[] = new Array(17).fill(false);
  const values: number[] = new Array(17).fill(0);
  for (const b of opts.down ?? []) { pressed[b] = true; values[b] = 1; }
  for (const [b, v] of Object.entries(opts.analog ?? {})) {
    const i = Number(b);
    values[i] = v;
    pressed[i] = v > 0;
  }
  return {
    axes: [opts.lx ?? 0, opts.ly ?? 0, opts.rx ?? 0, opts.ry ?? 0],
    pressed,
    values,
  };
}

/** Feed frames to the mapping layer. Frames are applied in order, so a
 *  press/release pair is two entries — which is also how button EDGES are
 *  exercised, since the layer derives them by remembering the last frame. */
async function feed(page: any, frames: any[], fireEnabled = true) {
  return engine(
    page,
    (e, arg: { frames: any[]; fireEnabled: boolean }) => {
      for (const f of arg.frames) e.input.applyPadSnapshot(f, arg.fireEnabled);
    },
    { frames, fireEnabled },
  );
}

/** Reset the pad's remembered edge state so one test's held buttons cannot
 *  leak into the next assertion inside the same page. */
async function releaseAll(page: any) {
  await feed(page, [pad()]);
}

/** Feed frames AND read the result inside ONE page evaluation.
 *
 *  Required for anything queue-shaped. The engine's loop drains the fire
 *  queues (and the interact latch) every frame, so feeding in one round-trip
 *  and reading in the next is racing the game — the queue is usually empty by
 *  the time the read lands. Injecting and reading in the same turn of the
 *  event loop is the only way to observe them. `read` is stringified and
 *  rebuilt in the page, so it must not close over test-side state.
 */
function feedThen<R>(
  page: any,
  frames: any[],
  read: (e: any) => R,
  fireEnabled = true,
): Promise<R> {
  return engine(
    page,
    (e, arg: { frames: any[]; fireEnabled: boolean; read: string }) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function('e', `return (${arg.read})(e)`);
      for (const f of arg.frames) e.input.applyPadSnapshot(f, arg.fireEnabled);
      return fn(e);
    },
    { frames, fireEnabled, read: read.toString() },
  );
}

/** Dispatch a real TouchEvent at the canvas.
 *
 *  Playwright's `page.touchscreen` only does single taps, and the joystick's
 *  whole point is that a SECOND finger can be down at the same time — so the
 *  events are constructed by hand.  They go to the canvas because
 *  `shouldIgnoreEvent` engages game input only for gestures that start there
 *  (that rule is what keeps overlay menus scrollable, and this suite must not
 *  route around it). */
async function touch(page: any, type: string, points: { id: number; x: number; y: number }[]) {
  await page.evaluate(
    ([t, pts]: [string, { id: number; x: number; y: number }[]]) => {
      const canvas = document.querySelector('canvas')!;
      const list = pts.map(p => new Touch({
        identifier: p.id, target: canvas, clientX: p.x, clientY: p.y,
      }));
      canvas.dispatchEvent(new TouchEvent(t, {
        changedTouches: list, touches: list, targetTouches: list,
        bubbles: true, cancelable: true,
      }));
    },
    [type, points] as [string, { id: number; x: number; y: number }[]],
  );
}

/** The joystick only exists in its own control scheme (G9) — selecting it is
 *  now part of the setup for every stick assertion. */
async function useJoystickScheme(page: any) {
  await engine(page, e => e.setControlScheme('joystick-left'));
}

test.describe('joystick zone — what it refuses to claim', () => {
  test('never takes a gesture that already meant something', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await useJoystickScheme(page);

    const z = await engine(page, e => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const at = (x: number, y: number) => e.input.inJoystickZone(x, y);
      return {
        w, h,
        // A left-thumb spot, clear of everything.
        thumb: at(w * 0.2, h * 0.6),
        // The ship sits at screen centre and `claimTapNear` docks from a tap
        // within SHIP_SELECT_RADIUS of it — and the left zone reaches it.
        shipDisc: at(w / 2 - 20, h / 2),
        shipJustOutside: at(w / 2 - 60, h / 2),
        // The aim / fire hand.
        rightHalf: at(w * 0.8, h * 0.6),
        // HUD chips live up here; the loadout strip and collapsed minimap
        // live down there.
        topStrip: at(w * 0.2, h * 0.1),
        bottomStrip: at(w * 0.2, h - 20),
      };
    });

    expect(z.thumb).toBe(true);
    expect(z.shipDisc).toBe(false);
    expect(z.shipJustOutside).toBe(true);
    expect(z.rightHalf).toBe(false);
    expect(z.topStrip).toBe(false);
    expect(z.bottomStrip).toBe(false);

    watch.assertClean();
  });

  test('yields to the EXPANDED minimap, which is 3.7x the collapsed one', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await useJoystickScheme(page);

    // The collapsed map is below the zone already. Expanded, it reaches up
    // into the thumb area — and its tap is what collapses it again, so the
    // stick must not swallow that. The rect is pushed to InputSystem per
    // frame precisely because it is not a constant.
    const probe = { x: 60, y: 0 };
    const before = await engine(page, (e, p: any) => {
      p.y = window.innerHeight - 200;   // inside the expanded map, above the collapsed one
      return e.input.inJoystickZone(p.x, p.y);
    }, probe);

    const after = await engine(page, e => {
      e.minimapExpanded = true;
      e.tickJoystick(1 / 60);           // the per-frame push
      return e.input.inJoystickZone(60, window.innerHeight - 200);
    });

    expect(before).toBe(true);
    expect(after).toBe(false);

    await engine(page, e => { e.minimapExpanded = false; e.tickJoystick(1 / 60); });
    watch.assertClean();
  });
});

test.describe('joystick — a floating left-thumb stick', () => {
  test('does not exist until a thumb lands, and flies the ship once it does', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await useJoystickScheme(page);

    // No touch session: nothing to draw. This is the mouse/pad case, and the
    // widget must not ghost there.
    expect(await engine(page, e => e.input.getJoystickState())).toBeNull();

    const origin = await engine(page, e => ({
      x: Math.round(window.innerWidth * 0.2),
      y: Math.round(window.innerHeight * 0.6),
    }));

    await touch(page, 'touchstart', [{ id: 1, ...origin }]);
    const held = await engine(page, e => e.input.getJoystickState());
    expect(held).not.toBeNull();
    expect(held.held).toBe(true);
    // It floats: the widget is centred where the thumb landed, not at some
    // fixed home the thumb has to find.
    expect(held.originX).toBeCloseTo(origin.x, 0);
    expect(held.originY).toBeCloseTo(origin.y, 0);

    // Drag right, past the ring.
    await touch(page, 'touchmove', [{ id: 1, x: origin.x + 90, y: origin.y }]);
    const move = await engine(page, e => e.input.getMovementVector());
    expect(move.x).toBeCloseTo(1, 2);
    expect(move.y).toBeCloseTo(0, 2);

    // The knob stops at the ring even though the thumb went past it.
    const knob = await engine(page, e => e.input.getJoystickState());
    expect(Math.hypot(knob.knobX - knob.originX, knob.knobY - knob.originY)).toBeCloseTo(56, 0);

    // And it actually thrusts.
    const flown = await engine(page, e => {
      e.player.velocity.x = 0;
      e.player.velocity.y = 0;
      for (let i = 0; i < 30; i++) e.updateGameLogic(1 / 120);
      return e.player.velocity.x;
    });
    expect(flown).toBeGreaterThan(0);

    // Lift: thrust stops immediately, the widget fades rather than snapping.
    await touch(page, 'touchend', [{ id: 1, x: origin.x + 90, y: origin.y }]);
    const after = await engine(page, e => ({
      move: e.input.getMovementVector(),
      state: e.input.getJoystickState(),
    }));
    expect(after.move.x).toBe(0);
    expect(after.state === null || after.state.held === false).toBe(true);

    watch.assertClean();
  });

  test('a nudge inside the deadzone is not thrust', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await useJoystickScheme(page);

    const o = await engine(page, () => ({
      x: Math.round(window.innerWidth * 0.2), y: Math.round(window.innerHeight * 0.6),
    }));
    await touch(page, 'touchstart', [{ id: 3, ...o }]);
    await touch(page, 'touchmove', [{ id: 3, x: o.x + 4, y: o.y }]);
    const dead = await engine(page, e => e.input.getMovementVector());
    expect(dead.x).toBe(0);

    // Just past it: a nudge, not a lurch — the same rescale the pad does.
    await touch(page, 'touchmove', [{ id: 3, x: o.x + 12, y: o.y }]);
    const nudge = await engine(page, e => e.input.getMovementVector());
    expect(nudge.x).toBeGreaterThan(0);
    expect(nudge.x).toBeLessThan(0.35);

    await touch(page, 'touchend', [{ id: 3, x: o.x + 12, y: o.y }]);
    watch.assertClean();
  });

  test('the ship aims where it flies, and only the button shoots', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await useJoystickScheme(page);

    const pts = await engine(page, () => ({
      stick: { x: Math.round(window.innerWidth * 0.2), y: Math.round(window.innerHeight * 0.6) },
      aim:   { x: Math.round(window.innerWidth * 0.8), y: Math.round(window.innerHeight * 0.4) },
      fire:  { x: Math.round(window.innerWidth - 58),  y: Math.round(window.innerHeight - 110) },
    }));

    // Fly RIGHT. The nose must follow, with no aim gesture anywhere.
    await touch(page, 'touchstart', [{ id: 10, ...pts.stick }]);
    await touch(page, 'touchmove', [{ id: 10, x: pts.stick.x + 80, y: pts.stick.y }]);
    await engine(page, e => { e.updateGameLogic(1 / 120); });
    expect(Math.abs(await engine(page, e => e.player.rotation))).toBeLessThan(0.01);

    // Fly UP: the nose comes with it.
    await touch(page, 'touchmove', [{ id: 10, x: pts.stick.x, y: pts.stick.y - 80 }]);
    await engine(page, e => { e.updateGameLogic(1 / 120); });
    expect(await engine(page, e => e.player.rotation)).toBeCloseTo(-Math.PI / 2, 2);

    // A finger on the far side does NOT steal the aim — under this scheme
    // there is no second aim channel to fight the stick.
    const before = await engine(page, e =>
      e.currentMap.entities.filter((x: any) => x.active && x.type === 'PROJECTILE' && x.ownerType === 'PLAYER').length);
    await touch(page, 'touchstart', [{ id: 11, ...pts.aim }]);
    await touch(page, 'touchmove', [{ id: 11, x: pts.aim.x, y: pts.aim.y + 40 }]);
    await touch(page, 'touchend', [{ id: 11, x: pts.aim.x, y: pts.aim.y + 40 }]);
    const afterStray = await engine(page, (e, n: number) => {
      for (let i = 0; i < 4; i++) e.updateGameLogic(1 / 120);
      return {
        rotation: e.player.rotation,
        fired: e.currentMap.entities.filter((x: any) => x.active && x.type === 'PROJECTILE' && x.ownerType === 'PLAYER').length - n,
      };
    }, before);
    expect(afterStray.rotation).toBeCloseTo(-Math.PI / 2, 2);
    // ...and it does not shoot either: that is the fire button's job.
    expect(afterStray.fired).toBe(0);

    // The BUTTON shoots, with the stick still held — the two-thumb hold the
    // scheme exists to make possible.
    await touch(page, 'touchstart', [{ id: 12, ...pts.fire }]);
    await touch(page, 'touchend', [{ id: 12, ...pts.fire }]);
    const r = await engine(page, (e, n: number) => {
      for (let i = 0; i < 4; i++) e.updateGameLogic(1 / 120);
      return {
        fired: e.currentMap.entities.filter((x: any) => x.active && x.type === 'PROJECTILE' && x.ownerType === 'PLAYER').length - n,
        move: e.input.getMovementVector(),
        stickHeld: !!e.input.getJoystickState()?.held,
      };
    }, before);

    expect(r.fired).toBeGreaterThan(0);
    expect(r.move.y).toBeLessThan(0);
    expect(r.stickHeld).toBe(true);

    await touch(page, 'touchend', [{ id: 10, x: pts.stick.x, y: pts.stick.y - 80 }]);
    watch.assertClean();
  });

  test('the left-handed scheme is the mirror of it, and works the same', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await engine(page, e => e.setControlScheme('joystick-right'));

    const geo = await engine(page, e => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const btn = e.input.getFireButtonState();
      return {
        w, h,
        rightThumb: e.input.inJoystickZone(w * 0.8, h * 0.6),
        leftThumb: e.input.inJoystickZone(w * 0.2, h * 0.6),
        btnX: btn.x,
        btnY: btn.y,
        // The minimap owns the bottom-left corner, so the mirrored button
        // must sit clear of it rather than on top of the map toggle.
        minimapTop: h - 75 - 14,
      };
    });

    // The stick has swapped sides...
    expect(geo.rightThumb).toBe(true);
    expect(geo.leftThumb).toBe(false);
    // ...and so has the button.
    expect(geo.btnX).toBeLessThan(geo.w / 2);
    expect(geo.btnY + 38).toBeLessThan(geo.minimapTop);

    // And it still flies: same stick, other hand.
    const spot = { x: Math.round(geo.w * 0.8), y: Math.round(geo.h * 0.6) };
    await touch(page, 'touchstart', [{ id: 70, ...spot }]);
    await touch(page, 'touchmove', [{ id: 70, x: spot.x - 80, y: spot.y }]);
    const flown = await engine(page, e => {
      e.player.velocity.x = 0;
      e.player.velocity.y = 0;
      for (let i = 0; i < 30; i++) e.updateGameLogic(1 / 120);
      return { vx: e.player.velocity.x, rotation: e.player.rotation };
    });
    expect(flown.vx).toBeLessThan(0);
    // Flying LEFT points the nose left (π), whichever hand holds the stick.
    expect(Math.abs(Math.abs(flown.rotation) - Math.PI)).toBeLessThan(0.05);

    await touch(page, 'touchend', [{ id: 70, x: spot.x - 80, y: spot.y }]);
    watch.assertClean();
  });

  test('the ship-select tap still docks — the stick never takes it', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await useJoystickScheme(page);

    await engine(page, e => {
      const st = e.stations[0];
      e.player.position.x = st.position.x;
      e.player.position.y = st.position.y + 40;
      e.player.velocity.x = 0;
      e.player.velocity.y = 0;
    });
    await waitForStats(page, s => !!s.dock?.inRange, 'dock range');

    // A tap on the hull's lower-LEFT quadrant: inside the left zone's x and y
    // bounds, so without the ship-disc carve-out the stick would claim it and
    // docking would silently stop working near a station.
    const p = await engine(page, () => ({
      x: Math.round(window.innerWidth / 2 - 20),
      y: Math.round(window.innerHeight / 2 + 20),
    }));
    await touch(page, 'touchstart', [{ id: 20, ...p }]);
    await touch(page, 'touchend', [{ id: 20, ...p }]);
    await waitForStats(page, s => !!s.station, 'the station UI, from a tap on the ship');

    watch.assertClean();
  });

  test('the DBG toggle forces the widget visible with no touch', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await useJoystickScheme(page);

    expect(await engine(page, e => e.input.getJoystickState())).toBeNull();
    await engine(page, e => e.dbg.toggleJoystickDebug());
    const forced = await engine(page, e => e.input.getJoystickState());
    expect(forced).not.toBeNull();
    expect(forced.held).toBe(false);
    // Parked inside the zone it claims, so what the DBG draw shows is where
    // a real thumb would work.
    expect(await engine(page, (e, s: any) => e.input.inJoystickZone(s.originX, s.originY), forced)).toBe(true);

    await engine(page, e => e.dbg.toggleJoystickDebug());
    expect(await engine(page, e => e.input.getJoystickState())).toBeNull();

    watch.assertClean();
  });
});

test.describe('deadzone — a radial cut with a rescale', () => {
  test('kills drift, rescales the live range, and clamps the diagonals', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    const r = await engine(page, (e, dz: number) => {
      const out = { x: 0, y: 0 };
      const call = (x: number, y: number) => {
        const mag = e.input.applyStickDeadzone(x, y, dz, out);
        return { mag, x: out.x, y: out.y };
      };
      return {
        rest: call(0, 0),
        // Inside the zone in BOTH axes but outside it radially — the case a
        // per-axis deadzone gets wrong.
        diagonalDrift: call(0.13, 0.13),
        justInside: call(dz * 0.99, 0),
        justOutside: call(dz + 0.01, 0),
        half: call(0.5, 0),
        full: call(1, 0),
        // Sticks over-report on the diagonals; the mapping must not let a
        // corner push out-run a cardinal one.
        corner: call(1, 1),
      };
    }, STICK_DEADZONE);

    expect(r.rest.mag).toBe(0);
    expect(r.justInside.mag).toBe(0);
    expect(r.justInside.x).toBe(0);

    // Radial, not per-axis: 0.13/0.13 is a magnitude of 0.184, just live.
    expect(r.diagonalDrift.mag).toBeGreaterThan(0);
    expect(r.diagonalDrift.mag).toBeLessThan(0.02);

    // The rescale is the point: the first live deflection must be NEAR ZERO,
    // not a jump to the deadzone value.
    expect(r.justOutside.mag).toBeGreaterThan(0);
    expect(r.justOutside.mag).toBeLessThan(0.02);

    // Full deflection still reaches full throttle, and the corner is clamped
    // to the same 1.0 rather than √2.
    expect(r.full.mag).toBeCloseTo(1, 5);
    expect(r.corner.mag).toBeCloseTo(1, 5);

    // Direction survives the rescale.
    expect(r.half.x).toBeGreaterThan(0);
    expect(r.half.y).toBe(0);
    expect(r.half.mag).toBeGreaterThan(0.35);
    expect(r.half.mag).toBeLessThan(0.45);

    watch.assertClean();
  });
});

test.describe('left stick and D-pad — thrust', () => {
  test('the stick feeds the same movement vector the player integrates', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    await feed(page, [pad({ lx: 1, ly: 0 })]);
    const right = await engine(page, e => e.input.getMovementVector());
    expect(right.x).toBeCloseTo(1, 5);
    expect(right.y).toBeCloseTo(0, 5);

    // +y is DOWN in screen space, and the pad reports a stick pushed toward
    // the player as +y — so "pull back" must read as down, not up.
    await feed(page, [pad({ lx: 0, ly: 1 })]);
    const down = await engine(page, e => e.input.getMovementVector());
    expect(down.y).toBeCloseTo(1, 5);

    // Partial deflection is partial throttle — this is what the pointer
    // branch's THROTTLE_DISTANCE ramp buys, and the stick must not lose it.
    await feed(page, [pad({ lx: 0.5, ly: 0 })]);
    const half = await engine(page, e => e.input.getMovementVector());
    expect(half.x).toBeGreaterThan(0.3);
    expect(half.x).toBeLessThan(0.5);

    await feed(page, [pad()]);
    const rest = await engine(page, e => e.input.getMovementVector());
    expect(rest.x).toBe(0);
    expect(rest.y).toBe(0);

    watch.assertClean();
  });

  test('the stick actually moves the ship', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // Park the ship and hold the stick across real sim steps.  This is the
    // end-to-end claim — not "the vector is right" but "the pad flies".
    const before = await engine(page, e => {
      e.player.velocity.x = 0;
      e.player.velocity.y = 0;
      return { x: e.player.position.x, y: e.player.position.y };
    });

    // The engine re-polls the real (absent) pad every frame, which would zero
    // the stick between our injections — so re-inject as we go.
    for (let i = 0; i < 40; i++) {
      await feed(page, [pad({ lx: 1, ly: 0 })]);
      await engine(page, e => { e.updateGameLogic(1 / 120); });
    }

    const after = await engine(page, e => ({
      x: e.player.position.x, y: e.player.position.y, vx: e.player.velocity.x,
    }));
    expect(after.vx).toBeGreaterThan(0);
    expect(after.x).not.toBe(before.x);

    watch.assertClean();
  });

  test('the D-pad thrusts only while the stick is at rest', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    await feed(page, [pad({ down: [BTN.DPAD_LEFT] })]);
    const left = await engine(page, e => e.input.getMovementVector());
    expect(left.x).toBeCloseTo(-1, 5);

    // Diagonal D-pad is normalised, not √2 fast.
    await feed(page, [pad({ down: [BTN.DPAD_UP, BTN.DPAD_RIGHT] })]);
    const diag = await engine(page, e => e.input.getMovementVector());
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(1, 5);

    // Stick wins: the two never sum into an over-unit vector.
    await feed(page, [pad({ lx: 1, down: [BTN.DPAD_LEFT] })]);
    const both = await engine(page, e => e.input.getMovementVector());
    expect(both.x).toBeCloseTo(1, 5);

    await releaseAll(page);
    watch.assertClean();
  });

  test('the keyboard still overrides the pad', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    await feed(page, [pad({ lx: 1, ly: 0 })]);
    // The keyboard branch is documented as an immediate override; the pad was
    // inserted BELOW it, so a key held while a stick is deflected must win.
    const kb = await engine(page, e => {
      e.input.keys.add('KeyA');
      const v = e.input.getMovementVector();
      e.input.keys.delete('KeyA');
      return v;
    });
    expect(kb.x).toBeCloseTo(-1, 5);

    await releaseAll(page);
    watch.assertClean();
  });
});

test.describe('right stick — aim through the synthetic pointer', () => {
  test('parks the pointer AIM_RADIUS out and turns the ship', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    await feed(page, [pad({ rx: 1, ry: 0 })]);
    const p = await engine(page, e => {
      const m = e.input.getMousePosition();
      return { x: m.x, y: m.y, cx: window.innerWidth / 2, cy: window.innerHeight / 2 };
    });
    expect(Math.hypot(p.x - p.cx, p.y - p.cy)).toBeCloseTo(AIM_RADIUS, 3);

    // Rotation is derived from the pointer, so aiming right faces the ship
    // right (0 rad) — the pad reuses the mouse's path rather than its own.
    await engine(page, e => { e.updateGameLogic(1 / 120); });
    const rot = await engine(page, e => e.player.rotation);
    expect(Math.abs(rot)).toBeLessThan(0.01);

    await feed(page, [pad({ rx: 0, ry: 1 })]);
    await engine(page, e => { e.updateGameLogic(1 / 120); });
    const rotDown = await engine(page, e => e.player.rotation);
    expect(rotDown).toBeCloseTo(Math.PI / 2, 2);

    // Releasing the stick HOLDS the heading — a released stick is a hand off
    // the mouse, not a snap back to centre.
    await feed(page, [pad()]);
    const held = await engine(page, e => {
      const m = e.input.getMousePosition();
      return Math.hypot(m.x - window.innerWidth / 2, m.y - window.innerHeight / 2);
    });
    expect(held).toBeCloseTo(AIM_RADIUS, 3);

    watch.assertClean();
  });
});

test.describe('fire — on the PRESS for a device control', () => {
  test('a press queues one shot, clear of the ship', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    const trigger = await feedThen(page, [pad({ down: [BTN.R2] }), pad()], e => {
      // The DEVICE queue, not the tap queue (G9): a synthesised shot must
      // not be offered to the minimap toggle or the loadout slots on its way
      // to the weapon, which is what `fireEvents` exists for.
      const evts = e.input.getDeviceFireEvents();
      return {
        n: evts.length,
        // Load-bearing: the shot's target must sit outside SHIP_SELECT_RADIUS
        // of screen centre, or `claimTapNear` would swallow every pad shot
        // fired within dock range as a tap on the ship.
        dist: evts.length
          ? Math.hypot(evts[0].x - window.innerWidth / 2, evts[0].y - window.innerHeight / 2)
          : -1,
      };
    });
    expect(trigger.n).toBe(1);
    expect(trigger.dist).toBeGreaterThan(SHIP_SELECT_RADIUS);
    expect(trigger.dist).toBeCloseTo(AIM_RADIUS, 3);

    // A face button is bound to the same action.
    const face = await feedThen(page, [pad({ down: [BTN.CROSS] }), pad()],
      e => e.input.getDeviceFireEvents().length);
    expect(face).toBe(1);

    watch.assertClean();
  });

  test('the shot lands on the PRESS, and a hold adds a charged shot on release', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // Press, then rewind the hold's start stamp past the charge window rather
    // than sleeping for a real second — the window is measured in wall clock,
    // so this drives the same branch without buying a flake.
    const r = await engine(page, (e, arg: { press: any; release: any; sec: number }) => {
      e.input.getDeviceFireEvents();
      e.input.getDeviceChargeEvents();

      e.input.applyPadSnapshot(arg.press, true);
      // Read BEFORE the release: this is the whole point of the directive —
      // the shot must already be queued while the trigger is still down.
      const onPress = e.input.getDeviceFireEvents().length;

      e.input.padFireStart -= arg.sec * 1000;
      e.input.applyPadSnapshot(arg.release, true);
      return {
        onPress,
        onRelease: e.input.getDeviceFireEvents().length,
        charged: e.input.getDeviceChargeEvents().length,
      };
    }, { press: pad({ down: [BTN.R2] }), release: pad(), sec: CHARGE_FULL + 0.05 });

    expect(r.onPress).toBe(1);
    // The release owes only the CHARGED shot now — the ordinary one was paid
    // at the press, and paying it twice would double every held shot.
    expect(r.onRelease).toBe(0);
    expect(r.charged).toBe(1);

    watch.assertClean();
  });

  test('a half-pulled trigger holds fire until the profile\'s break point', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // The bug this replaces: `pressed` is set by Chrome as soon as a
    // DualSense trigger leaves rest, so reading the boolean fired the gun on
    // the first millimetre — before the adaptive clutch had resisted
    // anything, which made the whole per-weapon feel table meaningless.
    const r = await engine(page, (e: any, arg: any) => {
      e.input.getDeviceFireEvents();
      const firePoint = e.input.padFirePoint();

      // Just off rest: `pressed` is true, travel is not.
      e.input.applyPadSnapshot(arg.creep, true);
      const onCreep = e.input.getDeviceFireEvents().length;

      // Short of the break.
      e.input.applyPadSnapshot(arg.partial, true);
      const onPartial = e.input.getDeviceFireEvents().length;

      // Through it.
      e.input.applyPadSnapshot(arg.full, true);
      const onFull = e.input.getDeviceFireEvents().length;

      return { firePoint, onCreep, onPartial, onFull };
    }, {
      creep: pad({ analog: { 7: 0.05 } }),
      partial: pad({ analog: { 7: 0.2 } }),
      full: pad({ analog: { 7: 1 } }),
    });

    // The starting Blaster is a RATTLE, not a click — it has no break, so
    // the fire point is where its buzz starts (0.30), inside the clamp band.
    expect(r.firePoint).toBeCloseTo(0.30, 5);
    // And the shape's moment differs by shape, which is the point of the
    // switch: a slope fires at the TOP of its ramp, not the bottom.
    expect(r.onCreep).toBe(0);
    expect(r.onPartial).toBe(0);
    expect(r.onFull).toBe(1);

    watch.assertClean();
  });

  test('the fire point is CLAMPED, so no profile can strand the shot', async ({ page }) => {
    await boot(page);
    await startRun(page);

    // A deep profile must still be reachable on a pad with NO adaptive
    // triggers, where there is no physical cue that the break has arrived —
    // and it is the same number in both cases, because branching on whether
    // the WebHID link is open would put an optional desktop-only transport
    // underneath the sim.
    const r = await engine(page, (e: any) => {
      const read = (p: any) => { e.input.setTriggerProfile(p); return e.input.padFirePoint(); };
      return {
        tooDeep: read({ kind: 'weapon', start: 0.9, end: 1, strength: 1 }),
        tooShallow: read({ kind: 'weapon', start: 0, end: 0.02, strength: 1 }),
        held: read({ kind: 'resistance', start: 0.35, end: 0, strength: 0.6 }),
        buzz: read({ kind: 'vibration', start: 0.4, end: 0, strength: 0.5, frequency: 0.3 }),
        ramp: read({ kind: 'slope', start: 0.3, end: 0.7, strength: 0.2, endStrength: 0.9 }),
        notched: read({ kind: 'texture', start: 0.3, end: 0, strength: 0.6, zones: [0, 0, 0.7, 0, 0.7] }),
        none: read({ kind: 'off', start: 0, end: 0, strength: 0 }),
      };
    });

    expect(r.tooDeep).toBeCloseTo(0.75, 5);
    expect(r.tooShallow).toBeCloseTo(0.25, 5);
    // A held weapon has no break — the wall it puts up at `start` is the cue,
    // and a buzz is the same story.
    expect(r.held).toBeCloseTo(0.35, 5);
    expect(r.buzz).toBeCloseTo(0.40, 5);
    // A ramp's moment is the TOP of the pull, not where it starts climbing.
    expect(r.ramp).toBeCloseTo(0.70, 5);
    // A texture fires past its LAST notch (zone 4 of 9), so every notch is
    // felt on the way in rather than after the shot.
    expect(r.notched).toBeCloseTo(4 / 9, 5);
    // No gun, no profile: the plain threshold.
    expect(r.none).toBeCloseTo(0.35, 5);
  });

  test('the aim moving during a hold does NOT cancel the shot', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    // The pointer's tap path cancels on TAP_DISTANCE_LIMIT of travel.  A
    // thumb on the right stick moves the aim 300px across a hold, so
    // inheriting that rule would have swallowed most pad shots.
    const n = await feedThen(page, [
      pad({ rx: 1, down: [BTN.R2] }),
      pad({ rx: -1, down: [BTN.R2] }),
      pad({ rx: -1 }),
    ], e => e.input.getDeviceFireEvents().length);
    expect(n).toBe(1);

    watch.assertClean();
  });

  test('a trigger held against a frozen world banks nothing', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    // fireEnabled=false is what the engine passes while docked / paused /
    // stage-clear / dead.  The press must not queue a shot that lands the
    // instant the world resumes.
    const r = await feedThen(page, [pad({ down: [BTN.R2] }), pad()], e => ({
      taps: e.input.getDeviceFireEvents().length,
      charged: e.input.getDeviceChargeEvents().length,
    }), false);
    expect(r.taps).toBe(0);
    expect(r.charged).toBe(0);

    watch.assertClean();
  });

  test('the charge ring reads the pad hold, same as a pointer hold', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    await feed(page, [pad({ down: [BTN.R2] })]);
    // Rewind the hold and READ IT IN THE SAME EVALUATE.  The duration is
    // measured against the wall clock, so a round-trip between the rewind and
    // the read is added straight onto it — on a loaded machine that is a
    // quarter of a second, which is the whole width of the window below.  (It
    // failed three runs in four locally while passing CI, from a hold that was
    // behaving perfectly.)  Nothing about the harness's own latency is under
    // test here; the rewind is a stand-in for holding the trigger.
    const held = await engine(page, (e, sec: number) => {
      e.input.padFireStart -= sec * 1000;
      return e.input.getMouseHoldDuration();
    }, 0.5);
    expect(held).toBeGreaterThan(0.45);
    expect(held).toBeLessThan(0.75);

    await feed(page, [pad()]);
    expect(await engine(page, e => e.input.getMouseHoldDuration())).toBe(0);
    await engine(page, e => { e.input.getFireEvents(); e.input.getChargeReleaseEvents(); });

    watch.assertClean();
  });
});

test.describe('buttons — edges, not levels', () => {
  test('a held button latches exactly one press', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    const presses = await feedThen(page, [
      pad({ down: [BTN.SQUARE] }),
      pad({ down: [BTN.SQUARE] }),
      pad({ down: [BTN.SQUARE] }),
    ], e => {
      let n = 0;
      while (e.input.consumeInteractPress()) n++;
      return n;
    });
    expect(presses).toBe(1);

    await releaseAll(page);
    watch.assertClean();
  });

  test('INTERACT docks at a station in range — the third path into `selected`', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // Park beside the hub's home station, exactly as the tap path would need.
    await engine(page, e => {
      const st = e.stations[0];
      e.player.position.x = st.position.x;
      e.player.position.y = st.position.y + 40;
      e.player.velocity.x = 0;
      e.player.velocity.y = 0;
    });
    await waitForStats(page, s => !!s.dock?.inRange, 'dock range');

    await feed(page, [pad({ down: [BTN.SQUARE] }), pad()]);
    await engine(page, e => { e.updateGameLogic(1 / 120); });
    await waitForStats(page, s => !!s.station, 'the station UI, opened from the pad');

    // And the same button undocks — the docked branch is its other consumer.
    await feed(page, [pad({ down: [BTN.SQUARE] }), pad()]);
    await waitForStats(page, s => !s.station, 'undocked from the pad');

    watch.assertClean();
  });

  test('a press made in open space is not banked for the next station', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // Far from anything: the press is drained and discarded.
    await engine(page, e => {
      const st = e.stations[0];
      e.player.position.x = st.position.x + 3000;
      e.player.position.y = st.position.y + 3000;
    });
    await feed(page, [pad({ down: [BTN.SQUARE] }), pad()]);
    await engine(page, e => { e.updateGameLogic(1 / 120); });

    // Now fly into range. Nothing should dock without a fresh press.
    await engine(page, e => {
      const st = e.stations[0];
      e.player.position.x = st.position.x;
      e.player.position.y = st.position.y + 40;
    });
    await waitForStats(page, s => !!s.dock?.inRange, 'dock range');
    for (let i = 0; i < 5; i++) await engine(page, e => { e.updateGameLogic(1 / 120); });
    expect((await stats(page)).station).toBeFalsy();

    watch.assertClean();
  });

  test('PAUSE toggles the game state from the pad', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    await feed(page, [pad({ down: [BTN.OPTIONS] }), pad()]);
    await waitForStats(page, s => s.gameState === 'PAUSED', 'paused from the pad');

    // And back — the poll runs BEFORE the loop's freeze short-circuit for
    // exactly this reason.
    await feed(page, [pad({ down: [BTN.OPTIONS] }), pad()]);
    await waitForStats(page, s => s.gameState === 'PLAYING', 'resumed from the pad');

    watch.assertClean();
  });

  test('CYCLE_WEAPON walks the equipped slots', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // The lean start mounts one gun; cycling a single slot is a no-op, so
    // grant a second and assert the selection actually moves.  Names are
    // spelled out rather than captured into the predicate: `waitForStats`
    // stringifies it, so a closed-over variable does not exist in the page.
    await engine(page, e => e.debugGrantWeapon('SHOTGUN'));
    await waitForStats(page, s => s.currentWeapon === 'Blaster', 'the lean start weapon');

    // Fed through the ENGINE's own poll, not called directly: this asserts
    // that the edge survives the round trip GameEngine.pollGamepad makes.
    await feed(page, [pad({ down: [BTN.R1] }), pad()]);
    await waitForStats(page, s => s.currentWeapon === 'Shotgun', 'the weapon to cycle');

    watch.assertClean();
  });
});

test.describe('control schemes — the touch models are mutually exclusive', () => {
  /** Park the ship, run the sim, report the velocity it picked up. */
  async function flyFor(page: any, steps = 30) {
    return engine(page, (e, n: number) => {
      e.player.velocity.x = 0;
      e.player.velocity.y = 0;
      for (let i = 0; i < n; i++) e.updateGameLogic(1 / 120);
      return { vx: e.player.velocity.x, vy: e.player.velocity.y };
    }, steps);
  }

  test('the default is standard touch, with no stick and no button', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    expect((await stats(page)).controlScheme).toBe('touch');
    const r = await engine(page, e => ({
      stick: e.input.getJoystickState(),
      button: e.input.getFireButtonState(),
      tapFires: e.input.tapFires(),
    }));
    expect(r.stick).toBeNull();
    expect(r.button).toBeNull();
    expect(r.tapFires).toBe(true);

    watch.assertClean();
  });

  test('a touch in the stick zone flies the ship in ONE scheme and aims in the other', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    const spot = await engine(page, () => ({
      x: Math.round(window.innerWidth * 0.2), y: Math.round(window.innerHeight * 0.6),
    }));

    // Standard touch: the same touch is the drag-to-fly gesture, and there
    // is no widget under it. It flies the ship toward the touch point —
    // down-left of centre, so both components are negative-x / positive-y.
    await touch(page, 'touchstart', [{ id: 40, ...spot }]);
    const standardMove = await engine(page, e => e.input.getMovementVector());
    expect(Math.hypot(standardMove.x, standardMove.y)).toBeGreaterThan(0.2);
    expect(await engine(page, e => e.input.getJoystickState())).toBeNull();
    await touch(page, 'touchend', [{ id: 40, ...spot }]);

    // Joystick scheme: the identical touch becomes the STICK — at rest until
    // dragged, and now with a widget under it.
    await engine(page, e => e.setControlScheme('joystick-left'));
    await touch(page, 'touchstart', [{ id: 41, ...spot }]);
    const stickAtRest = await engine(page, e => ({
      move: e.input.getMovementVector(),
      stick: e.input.getJoystickState(),
    }));
    expect(stickAtRest.move.x).toBe(0);
    expect(stickAtRest.move.y).toBe(0);
    expect(stickAtRest.stick).not.toBeNull();
    await touch(page, 'touchend', [{ id: 41, ...spot }]);

    watch.assertClean();
  });

  test('keyboard and controller keep touch alive but stop the MOUSE dragging the ship', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    const spot = await engine(page, () => ({
      x: Math.round(window.innerWidth * 0.8), y: Math.round(window.innerHeight * 0.3),
    }));

    for (const scheme of ['keyboard', 'gamepad'] as const) {
      await engine(page, (e, sc: string) => e.setControlScheme(sc), scheme);

      // A MOUSE drag must not steer: on these schemes the keys or the stick
      // do that, and a click is only a shot.
      await page.mouse.move(spot.x, spot.y);
      await page.mouse.down();
      const mouseMove = await engine(page, e => e.input.getMovementVector());
      expect(mouseMove.x, `${scheme}: mouse should not steer`).toBe(0);
      expect(mouseMove.y, `${scheme}: mouse should not steer`).toBe(0);
      await page.mouse.up();

      // A FINGER still does — "simultaneous touch control".
      await touch(page, 'touchstart', [{ id: 50, ...spot }]);
      const touchMove = await engine(page, e => e.input.getMovementVector());
      expect(Math.hypot(touchMove.x, touchMove.y), `${scheme}: touch should steer`).toBeGreaterThan(0.2);
      await touch(page, 'touchend', [{ id: 50, ...spot }]);

      // And no touch widgets in either scheme.
      const widgets = await engine(page, e => ({
        stick: e.input.getJoystickState(), button: e.input.getFireButtonState(),
      }));
      expect(widgets.stick).toBeNull();
      expect(widgets.button).toBeNull();
    }

    watch.assertClean();
  });

  test('the keyboard still flies the ship under every scheme', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    for (const scheme of ['touch', 'joystick-left', 'joystick-right', 'keyboard', 'gamepad'] as const) {
      await engine(page, (e, sc: string) => e.setControlScheme(sc), scheme);
      await engine(page, e => e.input.keys.add('KeyD'));
      const v = await flyFor(page);
      await engine(page, e => e.input.keys.delete('KeyD'));
      expect(v.vx, `${scheme}: WASD should always fly`).toBeGreaterThan(0);
    }

    watch.assertClean();
  });

  test('the fire button charges on a hold and is drawn from the first frame', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await engine(page, e => e.setControlScheme('joystick-left'));

    // Visible with no touch session at all — unlike the joystick, a button
    // that only appears once pressed cannot be found.
    const btn = await engine(page, e => e.input.getFireButtonState());
    expect(btn).not.toBeNull();
    expect(btn.pressed).toBe(false);

    // Hold past the charge window: a charged shot, not a tap shot, and the
    // ring the ship draws reads the same hold.
    const r = await engine(page, (e, sec: number) => {
      e.input.getDeviceFireEvents();
      e.input.getDeviceChargeEvents();
      const b = e.input.getFireButtonState();
      e.input.handleMouseDown({ target: document.querySelector('canvas'), clientX: b.x, clientY: b.y });
      e.input.fireBtnStart -= sec * 1000;
      const held = e.input.getMouseHoldDuration();
      const charge = e.input.getFireButtonState().charge;
      e.input.handleMouseUp({ target: document.querySelector('canvas'), clientX: b.x, clientY: b.y });
      return {
        held,
        charge,
        taps: e.input.getDeviceFireEvents().length,
        charged: e.input.getDeviceChargeEvents().length,
      };
    }, CHARGE_FULL + 0.05);

    expect(r.held).toBeGreaterThan(CHARGE_FULL);
    expect(r.charge).toBe(1);
    expect(r.taps).toBe(0);
    expect(r.charged).toBe(1);

    watch.assertClean();
  });

  test('switching scheme mid-run releases whatever the old one held', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await engine(page, e => e.setControlScheme('joystick-left'));

    const spot = await engine(page, () => ({
      x: Math.round(window.innerWidth * 0.2), y: Math.round(window.innerHeight * 0.6),
    }));
    await touch(page, 'touchstart', [{ id: 60, ...spot }]);
    await touch(page, 'touchmove', [{ id: 60, x: spot.x + 80, y: spot.y }]);
    expect((await engine(page, e => e.input.getMovementVector())).x).toBeGreaterThan(0.5);

    // Switch with the stick still deflected: it must not leave the ship
    // thrusting forever with no widget on screen to explain it.
    await engine(page, e => e.setControlScheme('touch'));
    const after = await engine(page, e => ({
      move: e.input.getMovementVector(),
      stick: e.input.getJoystickState(),
    }));
    expect(after.move.x).toBe(0);
    expect(after.stick).toBeNull();

    await touch(page, 'touchend', [{ id: 60, x: spot.x + 80, y: spot.y }]);
    watch.assertClean();
  });
});

test.describe('rumble — force feedback rides the screen shake', () => {
  // Mirrors INPUT_CONSTANTS.RUMBLE (harness rule 7).
  const MIN_SHAKE = 1;
  const FULL_SHAKE = 20;
  const MIN_MAGNITUDE = 0.14;
  const MIN_INTERVAL_MS = 70;
  const WEAPON_TICK = 2;

  test('every impact ticks, and the curve runs tick → thump', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // `rumbleParamsFor` takes `nowMs` so the throttle can be driven without
    // sleeping — the same split as the pad's snapshot mapping: the decision
    // is testable, the device is not.
    const r = await engine(page, (e, arg: { full: number }) => {
      const at = (amount: number, now: number) => e.input.rumbleParamsFor(amount, now);
      return {
        // MICRO (1) — a shard ping, the smallest thing the game emits.
        micro: at(1, 0),
        // The plain Blaster's haptic-only tick.
        weapon: at(2, 10_000),
        // A tier-1 kill.
        tierOneKill: at(3.5, 20_000),
        // MEDIUM (10) — an enemy collision.
        medium: at(10, 30_000),
        // HEAVY (20) — a high-speed crash, the loudest thing in the game.
        heavy: at(arg.full, 40_000),
        // Beyond the top of the curve stays clamped rather than overdriving.
        beyond: at(arg.full * 3, 50_000),
      };
    }, { full: FULL_SHAKE });

    // The three the user asked for all fire now, where they were cut off
    // before. Each is FELT — a floor, not a zero-strength effect timed
    // correctly, which is what the first curve produced at its threshold.
    for (const k of ['micro', 'weapon', 'tierOneKill'] as const) {
      expect(r[k], `${k} should produce an effect`).not.toBeNull();
      const total = r[k].strongMagnitude + r[k].weakMagnitude;
      expect(total, `${k} should be felt`).toBeGreaterThan(MIN_MAGNITUDE);
      // ...and felt as a TICK: the high-frequency motor leads.
      expect(r[k].weakMagnitude, `${k} should be buzz-dominant`)
        .toBeGreaterThan(r[k].strongMagnitude);
    }

    // A crash is the other end of the same curve: low-frequency thump.
    expect(r.heavy.strongMagnitude).toBeCloseTo(1, 5);
    expect(r.heavy.strongMagnitude).toBeGreaterThan(r.heavy.weakMagnitude);
    expect(r.heavy.duration).toBeGreaterThan(r.micro.duration);

    // Monotonic in between, so the hand can tell a scratch from a wreck.
    expect(r.medium.strongMagnitude).toBeGreaterThan(r.tierOneKill.strongMagnitude);
    expect(r.heavy.strongMagnitude).toBeGreaterThan(r.medium.strongMagnitude);
    expect(r.beyond.strongMagnitude).toBeCloseTo(1, 5);

    watch.assertClean();
  });

  test('the plain Blaster ticks the pad and shakes NO camera', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // The fastest gun in the game: a camera shake per shot would be
    // unplayable, so this is the one feedback path that is haptic-only.
    const r = await engine(page, e => {
      const calls: any[] = [];
      e.input.currentActuator = () => ({
        playEffect: (t: string, p: any) => { calls.push(p); return Promise.resolve(); },
      });
      e.input.rumbleUntilMs = -Infinity;
      e.input.rumbleT = 0;
      e.shakeIntensity = 0;
      e.shakeTimer = 0;
      e.player.weaponCooldown = 0;

      const fired = e.weapons.firePlayerWeapon(
        e.currentMap.entities, e.player,
        { x: e.player.position.x + 400, y: e.player.position.y },
        e.handleScreenShake, false, e.handleRumble,
      );
      return { fired, rumbles: calls.length, shake: e.shakeIntensity, weak: calls[0]?.weakMagnitude ?? 0 };
    });

    expect(r.fired).toBe(true);
    expect(r.rumbles).toBe(1);
    // The camera did not move.
    expect(r.shake).toBe(0);
    // And it is a tick, not a thump.
    expect(r.weak).toBeGreaterThan(0);

    watch.assertClean();
  });

  test('a stream of small hits does not become one long drone', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    const r = await engine(page, (e, gap: number) => {
      const at = (amount: number, now: number) => {
        const p = e.input.rumbleParamsFor(amount, now);
        // rumbleParamsFor is pure; the engine records the effect when it
        // actually plays one, so mirror that here.
        if (p) {
          e.input.rumbleUntilMs = now + p.duration;
          e.input.rumbleT = (amount - 1) / (20 - 1);   // mirrors the engine's own bookkeeping
        }
        return p;
      };
      // -Infinity is the "nothing has ever played" sentinel; a plain 0 would
      // be read as "one just finished at time zero" and eat the first hit.
      e.input.rumbleUntilMs = -Infinity;
      e.input.rumbleT = 0;
      const first = at(10, 0);
      return {
        first,
        // Same-strength hit while the first is still playing: ignored.
        during: at(10, 20),
        // A much stronger one DOES cut in — a crash mid-scrap should be felt.
        strongerDuring: at(20, 30),
        // And right after an effect ends there is still a gap, or separate
        // impacts blur into a continuous buzz.
        immediatelyAfter: at(10, 30 + 300),
        wellAfter: at(10, 30 + 300 + gap + 1),
      };
    }, MIN_INTERVAL_MS);

    expect(r.first).not.toBeNull();
    expect(r.during).toBeNull();
    expect(r.strongerDuring).not.toBeNull();
    expect(r.immediatelyAfter).toBeNull();
    expect(r.wellAfter).not.toBeNull();
  });

  test('an impact reaches the device, and an unsupported browser is asked once', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // The actuator is the ONE part of this a headless browser cannot supply,
    // so it is stood in for — exactly as the pad snapshot is. Everything in
    // front of it is the real code path, driven by a real screen shake.
    const r = await engine(page, e => {
      const calls: any[] = [];
      e.input.currentActuator = () => ({
        playEffect: (type: string, params: any) => { calls.push({ type, params }); return Promise.resolve(); },
      });
      e.input.rumbleUntilMs = -Infinity;
      e.input.rumbleT = 0;
      // A high-speed crash, through the engine's own shake funnel.
      e.handleScreenShake(20);
      return { calls, n: calls.length };
    });

    expect(r.n).toBe(1);
    expect(r.calls[0].type).toBe('dual-rumble');
    expect(r.calls[0].params.strongMagnitude).toBeCloseTo(1, 5);
    expect(r.calls[0].params.duration).toBeGreaterThan(0);

    // A browser that knows the method but not the effect REJECTS. That must
    // not reach the console (every suite asserts it clean), and it must not
    // be retried on every impact for the rest of the run.
    const after: { attempts: number; unsupported: boolean } = await engine(page, e => {
      let n = 0;
      e.input.currentActuator = () => ({
        playEffect: () => { n++; return Promise.reject(new Error('unsupported')); },
      });
      e.input.rumbleUntilMs = -Infinity;
      e.input.rumbleT = 0;
      e.handleScreenShake(20);
      return new Promise(resolve => setTimeout(() => {
        e.input.rumbleUntilMs = -Infinity;
        e.handleScreenShake(20);
        e.handleScreenShake(20);
        resolve({ attempts: n, unsupported: e.input.rumbleUnsupported });
      }, 50)) as any;
    });

    expect(after.attempts).toBe(1);
    expect(after.unsupported).toBe(true);

    watch.assertClean();
  });


  test('a weapon shot kicks the TRIGGER where the pad has one, and thumps where it does not', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // Which effect an event plays is a pure decision — testable without a
    // pad that has trigger motors, which is every pad available here.
    const choice = await engine(page, e => ({
      triggerOnCapablePad: e.input.rumbleEffectFor('trigger', ['dual-rumble', 'trigger-rumble']),
      triggerOnPlainPad: e.input.rumbleEffectFor('trigger', ['dual-rumble']),
      impactOnCapablePad: e.input.rumbleEffectFor('impact', ['dual-rumble', 'trigger-rumble']),
    }));
    expect(choice.triggerOnCapablePad).toBe('trigger-rumble');
    // The fallback is the whole point: most pads and most browsers lack it.
    expect(choice.triggerOnPlainPad).toBe('dual-rumble');
    // A crash is not a trigger event even on a pad that could play one.
    expect(choice.impactOnCapablePad).toBe('dual-rumble');

    // End to end, with a stand-in actuator that CLAIMS trigger motors.
    const withTriggers = await engine(page, e => {
      const calls: any[] = [];
      const act: any = {
        effects: ['dual-rumble', 'trigger-rumble'],
        playEffect: (type: string, params: any) => { calls.push({ type, params }); return Promise.resolve(); },
      };
      e.input.currentActuator = () => act;
      // The readout reports "no pad" before it looks at the actuator, and in
      // real life the two agree — only a stubbed actuator can decouple them.
      e.input.padIndex = 0;
      const reset = () => { e.input.rumbleUntilMs = -Infinity; e.input.rumbleT = 0; };

      reset();
      e.player.weaponCooldown = 0;
      e.weapons.firePlayerWeapon(
        e.currentMap.entities, e.player,
        { x: e.player.position.x + 400, y: e.player.position.y },
        e.handleScreenShake, false, e.handleRumble,
      );
      const shot = calls[calls.length - 1];

      reset();
      e.handleScreenShake(20);          // a crash — impact kind
      const crash = calls[calls.length - 1];

      const readout = e.input.rumbleDebugInfo();
      e.input.padIndex = null;
      return { shot, crash, readout };
    });

    // The shot reaches the trigger under the finger that pulled it...
    expect(withTriggers.shot.type).toBe('trigger-rumble');
    expect(withTriggers.shot.params.rightTrigger).toBeGreaterThan(0);
    expect(withTriggers.shot.params.leftTrigger).toBe(0);
    // ...and the crash stays in the handles.
    expect(withTriggers.crash.type).toBe('dual-rumble');
    expect(withTriggers.crash.params.rightTrigger).toBe(0);
    // The DBG row names what the pad offers, so "can it do triggers" is
    // answered by looking rather than by guessing at support tables.
    expect(withTriggers.readout).toContain('trigger-rumble');

    // And on an ordinary pad the same shot is an ordinary thump.
    const plain = await engine(page, e => {
      const calls: any[] = [];
      e.input.currentActuator = () => ({
        effects: ['dual-rumble'],
        playEffect: (type: string, params: any) => { calls.push({ type, params }); return Promise.resolve(); },
      });
      e.input.rumbleUntilMs = -Infinity;
      e.input.rumbleT = 0;
      e.player.weaponCooldown = 0;
      e.weapons.firePlayerWeapon(
        e.currentMap.entities, e.player,
        { x: e.player.position.x + 400, y: e.player.position.y },
        e.handleScreenShake, false, e.handleRumble,
      );
      return calls[calls.length - 1];
    });
    expect(plain.type).toBe('dual-rumble');
    expect(plain.params.strongMagnitude).toBeGreaterThan(0);

    watch.assertClean();
  });

  test('the DBG readout says WHY there is no rumble', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // Silence has four different causes and a player checking on hardware
    // cannot tell them apart. Each one gets its own answer.
    const noPad = await engine(page, e => e.input.rumbleDebugInfo());
    expect(noPad).toBe('no pad');

    const rest = await engine(page, e => {
      const out: Record<string, string> = {};
      e.dbg.toggleRumble();
      out.toggledOff = e.input.rumbleDebugInfo();
      e.dbg.toggleRumble();

      // Pretend a pad is adopted, so the later states are reachable.
      e.input.padIndex = 0;
      e.input.currentActuator = () => null;
      out.noActuator = e.input.rumbleDebugInfo();

      e.input.currentActuator = () => ({ playEffect: () => Promise.resolve() });
      out.ready = e.input.rumbleDebugInfo();

      e.input.rumbleUnsupported = true;
      out.refused = e.input.rumbleDebugInfo();

      e.input.rumbleUnsupported = false;
      e.input.padIndex = null;
      return out;
    });

    expect(rest.toggledOff).toBe('off (DBG)');
    expect(rest.noActuator).toBe('pad has no actuator');
    expect(rest.ready).toContain('ready');
    expect(rest.refused).toBe('browser refused');

    watch.assertClean();
  });

  test('the DBG toggle silences it, and it is independent of screen shake', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    const r = await engine(page, e => {
      const calls: any[] = [];
      e.input.currentActuator = () => ({
        playEffect: (t: string, p: any) => { calls.push(p); return Promise.resolve(); },
      });
      const fire = () => { e.input.rumbleUntilMs = -Infinity; e.input.rumbleT = 0; e.handleScreenShake(20); };

      fire();
      const withRumble = calls.length;

      // Screen shake OFF, rumble ON: the hand still feels it. The two are
      // different preferences and only one of them needs eyes.
      e.dbg.toggleScreenShake();
      fire();
      const shakeOff = calls.length;
      e.dbg.toggleScreenShake();

      // Rumble OFF: silent.
      e.dbg.toggleRumble();
      fire();
      const rumbleOff = calls.length;
      e.dbg.toggleRumble();

      return { withRumble, shakeOff, rumbleOff, enabled: e.input.rumbleEnabled };
    });

    expect(r.withRumble).toBe(1);
    expect(r.shakeOff).toBe(2);
    expect(r.rumbleOff).toBe(2);
    expect(r.enabled).toBe(true);

    watch.assertClean();
  });
});

/**
 * ADAPTIVE TRIGGERS — the DualSense output report (WebHID).
 *
 * These tests deliberately stop at the page boundary: no browser in CI has a
 * pad, and `navigator.hid` may not exist at all.  What they DO cover is the
 * half that can be silently wrong on real hardware with no symptom to read —
 * the pad discards a report with a bad CRC or a bad byte layout without
 * complaint, so a malformed report and an absent pad are indistinguishable by
 * feel.  The builders are pure, and CRC-32 has a published vector, so both
 * are pinnable here.
 *
 * The BYTE OFFSETS themselves come from public reverse-engineering and cannot
 * be verified without hardware — see engine/systems/DualSenseHID.ts.  These
 * tests pin the SHAPE (which bytes move, and to what) so a corrected offset
 * changes one table and one expectation rather than being unrecoverable.
 */
test.describe('left-stick scheme — one thumb flies and aims', () => {
  /*  User call: a scheme where the LEFT stick (and the left D-pad) carries
   *  heading, aim AND throttle together, with the gun on the bottom face
   *  button and the action button unchanged.  What separates it from the two
   *  pad schemes either side of it is worth pinning, because each pair is
   *  one flag apart:
   *
   *    `gamepad`        left stick = thrust only, RIGHT stick aims
   *    `gamepad-left`   left stick = thrust AND aim, right stick ignored
   *    `gamepad-thrust` a TRIGGER is the thrust, the stick's magnitude is
   *                     discarded, either stick may steer
   */

  test('the left stick supplies heading, aim and throttle at once', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    const r = await engine(page, (e: any, arg: any) => {
      const read = (scheme: string, snap: any) => {
        e.setControlScheme(scheme);
        e.input.applyPadSnapshot(snap, true);
        const v = e.input.getMovementVector();
        const aim = e.input.getMousePosition();
        return {
          move: { x: +v.x.toFixed(4), y: +v.y.toFixed(4) },
          aimX: Math.sign(+(aim.x - window.innerWidth / 2).toFixed(2)),
          aimY: Math.sign(+(aim.y - window.innerHeight / 2).toFixed(2)),
        };
      };
      return {
        half:  read('gamepad-left', arg.halfLeft),
        full:  read('gamepad-left', arg.fullLeft),
        dpad:  read('gamepad-left', arg.dpadRight),
        // The RIGHT stick must not steer the aim here: one thumb owns it.
        rightOnly: read('gamepad-left', arg.rightStickOnly),
      };
    }, {
      halfLeft: pad({ lx: 0.5 }),
      fullLeft: pad({ lx: 1 }),
      dpadRight: pad({ down: [15] }),     // D-pad right
      rightStickOnly: pad({ rx: 1 }),
    });

    // THROTTLE is the stick's own magnitude, exactly as under `gamepad` —
    // this scheme changes what the stick AIMS, not how it flies.
    expect(Math.hypot(r.half.move.x, r.half.move.y), 'half deflection = part throttle')
      .toBeGreaterThan(0.3);
    expect(Math.hypot(r.half.move.x, r.half.move.y))
      .toBeLessThan(Math.hypot(r.full.move.x, r.full.move.y) - 0.2);

    // AIM follows the same stick: pushed +x, the synthetic pointer sits to
    // the RIGHT of screen centre, which is how the hull's rotation and every
    // shot's target are derived.
    expect(r.full.aimX, 'the ship points where it flies').toBe(1);
    expect(r.full.aimY).toBe(0);

    // The D-PAD rides along: a unit vector at full throttle, aiming in its
    // own direction.
    expect(r.dpad.move.x, 'd-pad right flies right').toBeCloseTo(1, 3);
    expect(r.dpad.aimX, 'and aims right').toBe(1);

    // The right stick is ignored — no thrust and, crucially, no aim, so the
    // two thumbs cannot fight over the reticle.
    expect(Math.hypot(r.rightOnly.move.x, r.rightOnly.move.y), 'right stick does not fly')
      .toBe(0);

    watch.assertClean();
  });

  test('the gun is the bottom face button, and the action button is unchanged', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    const r = await engine(page, (e: any, arg: any) => {
      const fireCount = (scheme: string, snap: any) => {
        e.setControlScheme(scheme);
        // Release first: the fire edge is a press, so a snapshot that starts
        // held would be swallowed as "already down".
        e.input.applyPadSnapshot(arg.idle, true);
        e.input.getDeviceFireEvents();
        e.input.applyPadSnapshot(snap, true);
        return e.input.getDeviceFireEvents().length;
      };
      const interactCount = (scheme: string, snap: any) => {
        e.setControlScheme(scheme);
        e.input.applyPadSnapshot(arg.idle, true);
        e.input.consumeInteractPress();
        e.input.applyPadSnapshot(snap, true);
        return e.input.consumeInteractPress() ? 1 : 0;
      };
      return {
        faceFires:      fireCount('gamepad-left', arg.face),
        triggerSilent:  fireCount('gamepad-left', arg.trigger),
        // The control it is contrasted with: under plain `gamepad` the right
        // trigger IS the gun.
        plainTrigger:   fireCount('gamepad', arg.trigger),
        interact:       interactCount('gamepad-left', arg.square),
      };
    }, {
      idle: pad(),
      face: pad({ down: [0] }),                 // bottom face button
      trigger: pad({ analog: { 7: 1 } }),       // R2 fully pulled
      square: pad({ down: [2] }),               // left face button
    });

    expect(r.faceFires, 'the bottom face button shoots').toBe(1);
    expect(r.triggerSilent, 'the right trigger does not').toBe(0);
    expect(r.plainTrigger, 'whereas under plain `gamepad` it does').toBe(1);
    expect(r.interact, 'the left face button is still the action button').toBe(1);

    watch.assertClean();
  });
});

test.describe('trigger thrust — the stick steers, the trigger throttles', () => {
  test('the stick supplies DIRECTION and the trigger supplies magnitude', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    const r = await engine(page, (e: any, arg: any) => {
      const read = (scheme: string, snap: any) => {
        e.setControlScheme(scheme);
        e.input.applyPadSnapshot(snap, true);
        const v = e.input.getMovementVector();
        return { x: +v.x.toFixed(4), y: +v.y.toFixed(4) };
      };
      return {
        // Plain `gamepad`: the stick's own magnitude is the throttle, so a
        // half-deflected stick is half thrust and L2 does nothing.
        padHalf: read('gamepad', arg.halfStick),
        // `gamepad-thrust`: same half-deflected stick, but the magnitude now
        // comes from the trigger — full stick or half, the answer is the
        // trigger's number along the stick's heading.
        thrustHalfStickFullPull: read('gamepad-thrust', arg.halfStickFullPull),
        thrustFullStickHalfPull: read('gamepad-thrust', arg.fullStickHalfPull),
        // A heading with no throttle is aiming, not flying.
        thrustNoPull: read('gamepad-thrust', arg.halfStick),
        // A throttle with no heading has nothing to push against.
        thrustNoStick: read('gamepad-thrust', arg.pullOnly),
        // EITHER trigger throttles — a minimal pad may have only the right
        // one, and which one it has cannot be detected.
        thrustRightTrigger: read('gamepad-thrust', arg.stickRightPull),
      };
    }, {
      halfStick: pad({ lx: 0.5 }),
      halfStickFullPull: pad({ lx: 0.5, analog: { 6: 1 } }),
      fullStickHalfPull: pad({ lx: 1, analog: { 6: 0.5 } }),
      pullOnly: pad({ analog: { 6: 1 } }),
      stickRightPull: pad({ lx: 1, analog: { 7: 1 } }),
    });

    // Deadzone rescale: 0.5 deflection past an 0.18 radial deadzone.
    expect(r.padHalf.x).toBeCloseTo((0.5 - 0.18) / (1 - 0.18), 3);
    expect(r.padHalf.y).toBeCloseTo(0, 5);

    // Full pull, half stick → full thrust, because the stick only steers now.
    expect(r.thrustHalfStickFullPull.x).toBeCloseTo(1, 3);
    // Half pull → half thrust, regardless of how far the stick went.
    expect(r.thrustFullStickHalfPull.x)
      .toBeCloseTo((0.5 - 0.06) / (1 - 0.06), 3);

    expect(r.thrustNoPull).toEqual({ x: 0, y: 0 });
    expect(r.thrustNoStick).toEqual({ x: 0, y: 0 });
    expect(r.thrustRightTrigger.x).toBeCloseTo(1, 3);

    watch.assertClean();
  });

  test('EITHER stick steers and aims — a one-stick pad is a whole pad', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    const r = await engine(page, (e: any, arg: any) => {
      const read = (scheme: string, snap: any) => {
        e.setControlScheme(scheme);
        e.input.applyPadSnapshot(snap, true);
        const v = e.input.getMovementVector();
        const aim = e.input.padAim;
        return {
          move: { x: +v.x.toFixed(3), y: +v.y.toFixed(3) },
          aim: { x: +aim.x.toFixed(3), y: +aim.y.toFixed(3) },
        };
      };
      return {
        // RIGHT stick only, full pull: it flies the ship, which under the
        // plain gamepad scheme it never would.
        rightOnly: read('gamepad-thrust', arg.rightStick),
        // LEFT stick only: same answer, the other way round.
        leftOnly: read('gamepad-thrust', arg.leftStick),
        // BOTH, disagreeing: the larger deflection is the player's intent.
        both: read('gamepad-thrust', arg.bothSticks),
      };
    }, {
      rightStick: pad({ ry: -1, analog: { 6: 1 } }),
      leftStick: pad({ lx: -1, analog: { 6: 1 } }),
      bothSticks: pad({ lx: 0.4, ry: -1, analog: { 6: 1 } }),
    });

    // Right stick pushed UP flies up — and the ship AIMS where it flies,
    // because a one-stick pad has no second stick to aim with.
    expect(r.rightOnly.move.y).toBeCloseTo(-1, 2);
    expect(r.rightOnly.aim.y).toBeCloseTo(-1, 2);

    expect(r.leftOnly.move.x).toBeCloseTo(-1, 2);
    expect(r.leftOnly.aim.x).toBeCloseTo(-1, 2);

    // Right stick at full deflection beats a left stick at 0.4.
    expect(r.both.move.y).toBeCloseTo(-1, 2);
    expect(r.both.move.x).toBeCloseTo(0, 2);

    watch.assertClean();
  });

  test('the gun moves to the FACE button, because both triggers are the throttle',
    async ({ page }) => {
      const watch = await boot(page);
      await startRun(page);

      const r = await engine(page, (e: any, arg: any) => {
        const fires = (scheme: string, snap: any) => {
          e.setControlScheme(scheme);
          e.input.applyPadSnapshot(pad0, true);
          e.input.getDeviceFireEvents();
          e.input.applyPadSnapshot(snap, true);
          return e.input.getDeviceFireEvents().length;
        };
        const pad0 = arg.rest;
        return {
          // Plain gamepad: R2 is the gun.
          plainR2: fires('gamepad', arg.r2),
          // Trigger-thrust: R2 is a throttle, so it must NOT fire — a pad
          // with only a right trigger would otherwise shoot every time it
          // accelerated.
          thrustR2: fires('gamepad-thrust', arg.r2),
          thrustFace: fires('gamepad-thrust', arg.cross),
        };
      }, {
        rest: pad(),
        r2: pad({ analog: { 7: 1 } }),
        cross: pad({ down: [0] }),
      });

      expect(r.plainR2).toBe(1);
      expect(r.thrustR2).toBe(0);
      expect(r.thrustFace).toBe(1);

      watch.assertClean();
    });

  test('the left trigger is released under every scheme that does not use it', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    const r = await engine(page, (e: any) => {
      const seen: any[] = [];
      e.input.setThrustTriggerProfile = (p: any) => { seen.push(p); };
      const last = () => seen[seen.length - 1];

      e.setControlScheme('gamepad');
      e.updateGameLogic(1 / 120);
      const plain = last();

      e.setControlScheme('gamepad-thrust');
      e.updateGameLogic(1 / 120);
      const thrust = last();

      return { plainKind: plain.kind, thrustKind: thrust.kind, usesThrust: e.input.usesTriggerThrust() };
    });

    // A clutch on a control that does nothing is just a stiff trigger.
    expect(r.plainKind).toBe('off');
    // And where it IS the throttle, it ramps with the ship's speed.
    expect(r.thrustKind).toBe('slope');
    expect(r.usesThrust).toBe(true);

    watch.assertClean();
  });
});

test.describe('adaptive triggers — the DualSense output report', () => {
  test('CRC-32 matches the published check vector', async ({ page }) => {
    const watch = await boot(page);

    const r = await page.evaluate(() => {
      const hid = (window as any).__omniHid;
      const bytes = (s: string) => Array.from(s, c => c.charCodeAt(0));
      return {
        // The standard IEEE-802.3 check value.  This is what separates "a
        // CRC" from "the CRC the pad expects" — a reflected/unreflected mixup
        // produces a plausible-looking number that the pad rejects.
        check: hid.crc32(bytes('123456789')),
        empty: hid.crc32([]),
      };
    });

    expect(r.check).toBe(0xcbf43926);
    expect(r.empty).toBe(0);

    watch.assertClean();
  });

  test('the trigger blocks sit at 10 and 21 — the report id is NOT in the data', async ({ page }) => {
    const watch = await boot(page);

    const r = await page.evaluate(() => {
      const hid = (window as any).__omniHid;
      const off = { kind: 'off', start: 0, end: 0, strength: 0 };
      const d = Array.from(hid.buildTriggerData(
        { kind: 'weapon', start: 0.6, end: 0.9, strength: 1 }, off, 'zones') as Uint8Array);
      return {
        len: d.length,
        flag0: d[0],
        // The single most likely way for this whole feature to be silently
        // dead: most published samples index a buffer whose byte 0 is the
        // REPORT ID, so their "11" is this array's 10.  WebHID takes the data
        // without that byte, and one byte of drift is a discarded report.
        modeAt10: d[10],
        modeAt11: d[11],
        leftAt21: d[21],
        rumbleBytesClear: d[2] === 0 && d[3] === 0,
      };
    });

    expect(r.len).toBe(47);
    expect(r.flag0).toBe(0x04 | 0x08);
    expect(r.modeAt10).toBe(0x25);
    expect(r.modeAt11).not.toBe(0x25);
    // OFF is all zeroes — which is what RELEASES the clutch, so it is a real
    // instruction and not a skipped write.
    expect(r.leftAt21).toBe(0);
    // A trigger report must not also drive the motors: those bytes belong to
    // the Gamepad API path, and setting them here would fight it.
    expect(r.rumbleBytesClear).toBe(true);

    watch.assertClean();
  });

  test('both wire encodings are reachable and produce different bytes', async ({ page }) => {
    await boot(page);

    const r = await page.evaluate(() => {
      const hid = (window as any).__omniHid;
      const off = { kind: 'off', start: 0, end: 0, strength: 0 };
      const weapon = { kind: 'weapon', start: 0.6, end: 0.9, strength: 1 };
      const resist = { kind: 'resistance', start: 0.3, end: 0, strength: 0.5 };
      const block = (p: any, enc: string) =>
        Array.from(hid.buildTriggerData(p, off, enc) as Uint8Array).slice(10, 21);
      return {
        weaponZones: block(weapon, 'zones'),
        weaponSimple: block(weapon, 'simple'),
        resistZones: block(resist, 'zones'),
        resistSimple: block(resist, 'simple'),
      };
    });

    // 'zones': a weapon effect names its start and stop zones as a bitmask.
    // start 0.6 -> zone 5, end 0.9 -> zone 8, strength 1 -> 8, encoded as 7.
    expect(r.weaponZones.slice(0, 4)).toEqual([0x25, (1 << 5), 0x01, 7]);
    // 'simple': the same intent as raw bytes over the full travel.
    expect(r.weaponSimple.slice(0, 4)).toEqual([0x02, 153, 230, 255]);

    // Resistance takes a different mode in each, and neither writes a break.
    expect(r.resistZones[0]).toBe(0x21);
    expect(r.resistSimple.slice(0, 3)).toEqual([0x01, 77, 128]);
    expect(r.resistSimple[3]).toBe(0);

    // The whole point of shipping both: they must actually differ on the wire.
    expect(r.weaponZones).not.toEqual(r.weaponSimple);
  });

  test('the three richer shapes each pack their own zone table', async ({ page }) => {
    const watch = await boot(page);

    const r = await page.evaluate(() => {
      const hid = (window as any).__omniHid;
      const off = { kind: 'off', start: 0, end: 0, strength: 0 };
      const block = (p: any) =>
        Array.from(hid.buildTriggerData(p, off, 'zones') as Uint8Array).slice(10, 21);

      // Decode the 10-bit active mask + ten 3-bit forces back out, so the
      // assertions read as "which zones push, and how hard" rather than as
      // four opaque bytes.  Two 16-bit halves on the way out for the same
      // reason they go in that way: `<<` is signed 32-bit in JS.
      const decode = (b: number[]) => {
        const active = b[1] | (b[2] << 8);
        const lo = b[3] | (b[4] << 8) | (b[5] << 16);
        const hi = b[6];
        const forces: number[] = [];
        for (let z = 0; z < 10; z++) {
          if (!(active & (1 << z))) { forces.push(0); continue; }
          const bit = 3 * z;
          forces.push(bit < 24 ? (lo >>> bit) & 0x7 : (hi >>> (bit - 24)) & 0x7);
        }
        return { mode: b[0], active, forces };
      };

      return {
        buzz: block({ kind: 'vibration', start: 0.4, end: 0, strength: 1, frequency: 0.5 }),
        ramp: decode(block({ kind: 'slope', start: 0, end: 1, strength: 0, endStrength: 1 })),
        notches: decode(block({ kind: 'texture', start: 0, end: 0, strength: 1, zones: [0, 0, 1, 0, 1] })),
        wall: decode(block({ kind: 'resistance', start: 0.5, end: 0, strength: 1 })),
      };
    });

    // VIBRATION is the one shape whose character is not a force: mode 0x26,
    // and the frequency rides its own byte rather than the packed table.
    expect(r.buzz[0]).toBe(0x26);
    expect(r.buzz[9]).toBe(128);

    // SLOPE ramps across the travel and holds at the top.
    expect(r.ramp.mode).toBe(0x21);
    expect(r.ramp.forces[0]).toBe(0);          // zero force = inactive zone
    expect(r.ramp.forces[9]).toBe(7);          // 8 levels, encoded 0..7
    for (let z = 2; z < 10; z++) {
      expect(r.ramp.forces[z]).toBeGreaterThanOrEqual(r.ramp.forces[z - 1]);
    }

    // TEXTURE is authored zone by zone: exactly the named ones push.
    expect(r.notches.active).toBe((1 << 2) | (1 << 4));
    expect(r.notches.forces[2]).toBe(7);
    expect(r.notches.forces[3]).toBe(0);
    expect(r.notches.forces[4]).toBe(7);

    // And the plain WALL is still a wall: everything from its zone onward,
    // at one force.
    expect(r.wall.active).toBe(0b1111100000);
    expect(r.wall.forces[5]).toBe(7);
    expect(r.wall.forces[4]).toBe(0);

    watch.assertClean();
  });

  test('the simple encoding DEGRADES the rich shapes rather than dropping them', async ({ page }) => {
    await boot(page);

    // A firmware that only speaks 0x01/0x02 should still feel something per
    // weapon.  Silence would be indistinguishable from the bug this whole
    // encoding switch exists to diagnose.
    const r = await page.evaluate(() => {
      const hid = (window as any).__omniHid;
      const off = { kind: 'off', start: 0, end: 0, strength: 0 };
      const block = (p: any) =>
        Array.from(hid.buildTriggerData(p, off, 'simple') as Uint8Array).slice(10, 14);
      return {
        buzz: block({ kind: 'vibration', start: 0.4, end: 0, strength: 0.5, frequency: 0.3 }),
        ramp: block({ kind: 'slope', start: 0.2, end: 0.8, strength: 0.2, endStrength: 1 }),
        notches: block({ kind: 'texture', start: 0, end: 0, strength: 1, zones: [0, 0, 0.5, 0, 1] }),
      };
    });

    // All three collapse to a constant wall — mode 0x01, never mode 0.
    expect(r.buzz[0]).toBe(0x01);
    expect(r.ramp[0]).toBe(0x01);
    expect(r.notches[0]).toBe(0x01);
    // A slope's stand-in firmness is its STRONGEST point, not its start —
    // otherwise the Cannon would degrade to the lightest gun in the table.
    expect(r.ramp[2]).toBe(255);
    // A texture starts where its first notch is, not at zone 0.
    expect(r.notches[1]).toBe(Math.round((2 / 9) * 255));
  });

  test('an OFF profile clears all eleven bytes — releasing is an instruction', async ({ page }) => {
    await boot(page);

    const r = await page.evaluate(() => {
      const hid = (window as any).__omniHid;
      const off = { kind: 'off', start: 0, end: 0, strength: 0 };
      const d = Array.from(hid.buildTriggerData(off, off, 'zones') as Uint8Array);
      return {
        right: d.slice(10, 21),
        left: d.slice(21, 32),
        // The enable bits stay SET: the pad has to be listening to the
        // trigger actuators to be told to let go of them.
        flag0: d[0],
      };
    });

    expect(r.right).toEqual(new Array(11).fill(0));
    expect(r.left).toEqual(new Array(11).fill(0));
    expect(r.flag0).toBe(0x04 | 0x08);
  });

  test('the rumble self-test drives the motors and leaves the triggers alone', async ({ page }) => {
    await boot(page);

    const r = await page.evaluate(() => {
      const hid = (window as any).__omniHid;
      const d = Array.from(hid.buildRumbleData(1, 0.5) as Uint8Array);
      return {
        flag0: d[0],
        strong: d[3],
        weak: d[2],
        triggersClear: d.slice(10, 32).every((b: number) => b === 0),
      };
    });

    // COMPATIBLE_VIBRATION | HAPTICS_SELECT — both, or the motors stay idle.
    expect(r.flag0).toBe(0x01 | 0x02);
    expect(r.strong).toBe(255);
    expect(r.weak).toBe(128);
    // The bisection only works if this report says nothing about the
    // triggers: otherwise a buzz would prove nothing about them either way.
    expect(r.triggersClear).toBe(true);
  });

  test('USB sends the block bare; Bluetooth pads to full length and appends a CRC', async ({ page }) => {
    await boot(page);

    const r = await page.evaluate(() => {
      const hid = (window as any).__omniHid;
      const data = hid.buildTriggerData(
        { kind: 'weapon', start: 0.25, end: 0.45, strength: 0.35 },
        { kind: 'off', start: 0, end: 0, strength: 0 },
        'zones',
      ) as Uint8Array;

      const usb = hid.buildOutputReport(data, false, 0);
      const bt = hid.buildOutputReport(data, true, 3);
      const btBytes = Array.from(bt.bytes as Uint8Array);

      // Recompute the CRC the way the pad does: over the 0xA2 seed byte, the
      // report id, and everything ahead of the trailing four bytes.
      const crcInput = [0xa2, 0x31, ...btBytes.slice(0, btBytes.length - 4)];
      const expected = hid.crc32(crcInput);
      const at = btBytes.length - 4;
      const trailer = (btBytes[at] | (btBytes[at + 1] << 8) | (btBytes[at + 2] << 16) | (btBytes[at + 3] << 24)) >>> 0;

      return {
        usbId: usb.reportId,
        usbLen: (usb.bytes as Uint8Array).length,
        usbBare: (usb.bytes as Uint8Array) === data,
        btId: bt.reportId,
        btLen: btBytes.length,
        seqByte: btBytes[0],
        tagByte: btBytes[1],
        crcMatches: trailer === expected,
      };
    });

    expect(r.usbId).toBe(0x02);
    expect(r.usbLen).toBe(47);
    expect(r.usbBare).toBe(true);

    expect(r.btId).toBe(0x31);
    // 2 framing bytes + the 47-byte block + 24 reserved + a 4-byte CRC = 77,
    // i.e. 78 with the report id.  The reserved span is padding, but its
    // LENGTH is not optional: a short report is a DROPPED report, not a
    // partial one, and leaving it out was the second of this feature's two
    // silent-failure bugs.
    expect(r.btLen).toBe(77);
    // The sequence counter lives in the HIGH nibble, so 3 reads as 0x30 — a
    // low-nibble version is the kind of mistake the pad answers with silence.
    expect(r.seqByte).toBe(0x30);
    expect(r.tagByte).toBe(0x10);
    expect(r.crcMatches).toBe(true);
  });

  test('the sync follows what the player is HOLDING — gun, charge, or nothing', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // The profile is pushed unconditionally; whether it reaches a pad is the
    // HID layer's business, so this asserts on what InputSystem was TOLD.
    const r = await engine(page, (e: any) => {
      const seen: any[] = [];
      e.input.setTriggerProfile = (p: any) => { seen.push(p); };
      const last = () => seen[seen.length - 1];

      e.updateGameLogic(1 / 120);
      const armed = last();

      // EMP: the trigger goes slack, which is the disable made physical.
      // Applied as a real status effect, not by poking the flag —
      // `systemsDisabled` is DERIVED and recomputed from the effect list on
      // every step, so a poked value is gone before the sync reads it.
      e.debugApplyDisable();
      e.updateGameLogic(1 / 120);
      const disabled = last();
      e.player.statusEffects = [];

      // Weaponless flight is legal (the Blaster is removable) — nothing to
      // fire, nothing to resist.
      const weapon = e.player.currentWeapon;
      e.player.currentWeapon = undefined;
      e.updateGameLogic(1 / 120);
      const weaponless = last();
      e.player.currentWeapon = weapon;

      return {
        armedKind: armed.kind, armedStrength: armed.strength,
        disabledKind: disabled.kind,
        weaponlessKind: weaponless.kind,
      };
    });

    // The starting Blaster: a low rattle, because a click 7x/s is fatigue.
    expect(r.armedKind).toBe('vibration');
    expect(r.armedStrength).toBeCloseTo(0.45, 5);
    expect(r.disabledKind).toBe('off');
    expect(r.weaponlessKind).toBe('off');

    watch.assertClean();
  });

  test('an unsupported browser offers no control and reports why', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // Headless Chromium exposes no `navigator.hid`, which is exactly the
    // shape every mobile browser and Safari present — so the DEFAULT state
    // here is the one that matters most: the enhancement is invisible and
    // inert, and nothing else about the input layer has changed.
    const r = await engine(page, (e: any) => ({
      supported: e.input.adaptiveTriggersSupported(),
      connected: e.input.adaptiveTriggersConnected(),
      info: e.input.adaptiveTriggerDebugInfo(),
    }));

    expect(r.connected).toBe(false);
    if (!r.supported) {
      expect(r.info).toContain('unsupported');
    } else {
      // A browser that HAS WebHID still starts disconnected — nothing is
      // opened without the player asking.
      expect(r.info).toContain('not connected');
    }

    // The control renders only where it can work.
    await engine(page, (e: any) => e.pauseGame());
    await expect(page.getByTestId('scheme-select')).toBeVisible();
    await expect(page.getByTestId('adaptive-triggers-toggle'))
      .toHaveCount(r.supported ? 1 : 0);

    watch.assertClean();
  });

  test('where WebHID EXISTS the control is in BOTH menus', async ({ page }) => {
    // Headless Chromium has no `navigator.hid`, so the supported branch was
    // never exercised — which is how the control could go missing from a menu
    // without a single test noticing.  A stub is enough: the button only ever
    // asks `isSupported()` before rendering, and what it calls on click is
    // covered by the picker's own permission flow, not by this.
    await page.addInitScript(() => {
      (navigator as any).hid = { requestDevice: async () => [] };
    });
    const watch = await boot(page);

    // MAIN MENU — where a player sets their hands up before playing.
    await expect(page.getByTestId('adaptive-triggers-toggle')).toHaveCount(1);

    // PAUSE MENU — the same widget, so a mid-run change costs no restart.
    await startRun(page);
    await engine(page, (e: any) => e.pauseGame());
    await waitForStats(page, s => s.gameState === 'PAUSED', 'the pause menu');
    await expect(page.getByTestId('adaptive-triggers-toggle')).toHaveCount(1);

    watch.assertClean();
  });
});

/**
 * GAMEPAD MENU NAVIGATION — a D-pad and two buttons over every overlay.
 *
 * Driven end to end through the REAL DOM: the driver's whole design premise
 * is that focus is the browser's focus and movement is geometric over
 * whatever the panels happen to render, so a test that stubbed either would
 * be testing something else.  The pad half still goes through
 * `applyPadSnapshot`, which is the only part of a gamepad that is reachable
 * headless.
 */
test.describe('menu navigation — the pad reaches every control', () => {
  /** Press a D-pad direction and let the driver's rAF pass run. */
  async function navPress(page: any, button: number) {
    await engine(page, (e: any, b: number) => {
      e.input.applyPadSnapshot({ axes: [0, 0, 0, 0], pressed: [], values: [] }, false);
      const pressed: boolean[] = new Array(17).fill(false);
      pressed[b] = true;
      e.input.applyPadSnapshot({ axes: [0, 0, 0, 0], pressed, values: [] }, false);
    }, button);
    // Two frames: one for the driver to drain, one for focus to settle.
    await page.evaluate(() => new Promise(r =>
      requestAnimationFrame(() => requestAnimationFrame(r))));
  }

  test('the D-pad moves focus inside the live overlay, and CONFIRM activates it',
    async ({ page }) => {
      const watch = await boot(page);

      // The main menu: START is the control that matters, and it must be
      // reachable without a single tap.
      const first = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? el.tagName : 'NONE';
      });
      expect(first).toBe('BODY');

      // First press adopts focus rather than moving it — there is nothing to
      // move FROM, and skipping the topmost control would be a silent loss.
      await navPress(page, 13); // D-pad down
      const adopted = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return {
          inOverlay: !!el?.closest('[data-overlay="menu"]'),
          tag: el?.tagName ?? 'NONE',
        };
      });
      expect(adopted.inOverlay).toBe(true);
      expect(adopted.tag).toBe('BUTTON');

      // Walk to START and press Cross.  Driving the real buttons rather than
      // asserting a focus index: the menu's contents are free to change, and
      // a test that pinned "the fourth control" would break on a rename.
      await page.evaluate(() => {
        const start = Array.from(document.querySelectorAll('button'))
          .find(b => /start/i.test(b.textContent || ''));
        (start as HTMLElement | undefined)?.focus();
      });
      await engine(page, (e: any) => {
        const pressed: boolean[] = new Array(17).fill(false);
        e.input.applyPadSnapshot({ axes: [0, 0, 0, 0], pressed, values: [] }, false);
        pressed[0] = true; // Cross
        e.input.applyPadSnapshot({ axes: [0, 0, 0, 0], pressed, values: [] }, false);
      });
      await waitForStats(page, s => s.gameState === 'PLAYING', 'the run started by the pad');

      watch.assertClean();
    });

  test('BACK resumes a paused run, and is inert with no overlay up', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // Inert in flight: BACK must not do anything to a running game, or a
    // stray thumb pauses the fight.
    await engine(page, (e: any) => {
      const pressed: boolean[] = new Array(17).fill(false);
      e.input.applyPadSnapshot({ axes: [0, 0, 0, 0], pressed, values: [] }, false);
      pressed[1] = true; // Circle
      e.input.applyPadSnapshot({ axes: [0, 0, 0, 0], pressed, values: [] }, false);
    });
    await page.evaluate(() => new Promise(r =>
      requestAnimationFrame(() => requestAnimationFrame(r))));
    expect((await stats(page)).gameState).toBe('PLAYING');

    await engine(page, (e: any) => e.pauseGame());
    await waitForStats(page, s => s.gameState === 'PAUSED', 'the pause menu');

    await engine(page, (e: any) => {
      const pressed: boolean[] = new Array(17).fill(false);
      e.input.applyPadSnapshot({ axes: [0, 0, 0, 0], pressed, values: [] }, false);
      pressed[1] = true;
      e.input.applyPadSnapshot({ axes: [0, 0, 0, 0], pressed, values: [] }, false);
    });
    await waitForStats(page, s => s.gameState === 'PLAYING', 'the resumed run');

    watch.assertClean();
  });

  test('a held direction steps ONCE, then repeats', async ({ page }) => {
    const watch = await boot(page);

    // The repeat is resolved in InputSystem, where every frame is visible —
    // a consumer that renders on a stats push would miss both the edge and
    // the window.  Held for one frame is one step, not one per frame.
    const r = await engine(page, (e: any) => {
      e.input.consumeNavSteps();
      const held: boolean[] = new Array(17).fill(false);
      held[13] = true;
      const snap = { axes: [0, 0, 0, 0], pressed: held, values: [] };

      e.input.applyPadSnapshot(snap, false);
      const onEdge = e.input.consumeNavSteps().length;

      // Three more frames inside the repeat delay: still nothing.
      for (let i = 0; i < 3; i++) e.input.applyPadSnapshot(snap, false);
      const duringDelay = e.input.consumeNavSteps().length;

      // Rewind past the delay rather than sleeping for it.
      e.input.padNavNextAt = performance.now() - 1;
      e.input.applyPadSnapshot(snap, false);
      const afterDelay = e.input.consumeNavSteps().length;

      // A CHANGE of direction restarts the clock, so rolling a thumb around
      // the pad steps once per direction rather than machine-gunning.
      const right: boolean[] = new Array(17).fill(false);
      right[15] = true;
      e.input.applyPadSnapshot({ axes: [0, 0, 0, 0], pressed: right, values: [] }, false);
      const onTurn = e.input.consumeNavSteps();

      return { onEdge, duringDelay, afterDelay, onTurn };
    });

    expect(r.onEdge).toBe(1);
    expect(r.duringDelay).toBe(0);
    expect(r.afterDelay).toBe(1);
    expect(r.onTurn).toEqual([{ x: 1, y: 0 }]);

    watch.assertClean();
  });

  test('geometry, not DOM order, decides where a direction goes', async ({ page }) => {
    await boot(page);

    // The panels are grids of hexes, rows of chips and columns of rows on one
    // screen; DOM order is the right answer for none of them.  Pinned against
    // a synthetic 2x2 so the expectation is about the RULE rather than about
    // whatever the menu currently contains.
    const r = await page.evaluate(() => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:200px';
      const at = (x: number, y: number, id: string) => {
        const b = document.createElement('button');
        b.id = id;
        b.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:80px;height:40px`;
        host.appendChild(b);
        return b;
      };
      // Appended in an order that DISAGREES with the layout, so a DOM-order
      // implementation would give different answers.
      const br = at(100, 100, 'br');
      const tl = at(0, 0, 'tl');
      const bl = at(0, 100, 'bl');
      const tr = at(100, 0, 'tr');
      document.body.appendChild(host);

      const { pickNext } = (window as any).__omniMenuNav;
      const list = [br, tl, bl, tr];
      const out = {
        rightOfTL: pickNext(tl, list, 1, 0)?.id,
        downOfTL: pickNext(tl, list, 0, 1)?.id,
        leftOfBR: pickNext(br, list, -1, 0)?.id,
        upOfBR: pickNext(br, list, 0, -1)?.id,
        // Nothing above the top row: movement never wraps or reverses.
        upOfTL: pickNext(tl, list, 0, -1)?.id ?? null,
      };
      host.remove();
      return out;
    });

    expect(r.rightOfTL).toBe('tr');
    expect(r.downOfTL).toBe('bl');
    expect(r.leftOfBR).toBe('bl');
    expect(r.upOfBR).toBe('tr');
    expect(r.upOfTL).toBeNull();
  });
});
