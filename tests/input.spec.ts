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
function pad(opts: { lx?: number; ly?: number; rx?: number; ry?: number; down?: number[] } = {}) {
  const pressed: boolean[] = new Array(17).fill(false);
  for (const b of opts.down ?? []) pressed[b] = true;
  return {
    axes: [opts.lx ?? 0, opts.ly ?? 0, opts.rx ?? 0, opts.ry ?? 0],
    pressed,
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

test.describe('fire — the pointer model, minus the drag cancel', () => {
  test('press and release queues one shot, clear of the ship', async ({ page }) => {
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

  test('holding past CHARGE_FULL releases a charged shot instead', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // Press, then rewind the hold's start stamp past the charge window rather
    // than sleeping for a real second — the window is measured in wall clock,
    // so this drives the same branch without buying a flake.
    const r = await engine(page, (e, arg: { press: any; release: any; sec: number }) => {
      e.input.getDeviceFireEvents();
      e.input.getDeviceChargeEvents();
      e.input.applyPadSnapshot(arg.press, true);
      e.input.padFireStart -= arg.sec * 1000;
      e.input.applyPadSnapshot(arg.release, true);
      return {
        taps: e.input.getDeviceFireEvents().length,
        charged: e.input.getDeviceChargeEvents().length,
      };
    }, { press: pad({ down: [BTN.R2] }), release: pad(), sec: CHARGE_FULL + 0.05 });

    expect(r.taps).toBe(0);
    expect(r.charged).toBe(1);

    watch.assertClean();
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
    await engine(page, (e, sec: number) => { e.input.padFireStart -= sec * 1000; }, 0.5);
    const held = await engine(page, e => e.input.getMouseHoldDuration());
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
