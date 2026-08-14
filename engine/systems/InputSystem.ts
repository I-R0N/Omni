

import { Vector2, JoystickHUDState, FireButtonHUDState, ControlScheme } from '../../types';
import { INPUT_CONSTANTS, CONTROL_SCHEME_RULES } from '../../constants';

/** One frame of pad state, reduced to what the mapping layer cares about.
 *  `applyPadSnapshot` takes this rather than a live `Gamepad` so the whole
 *  mapping is drivable from a test — the Gamepad API cannot be synthesised in
 *  a headless browser, but this shape can. */
export interface PadSnapshot {
  axes: readonly number[];
  /** Pressed state per button index. */
  pressed: readonly boolean[];
}

export class InputSystem {
  private keys: Set<string>;
  private mousePosition: Vector2;
  private mouseDown: boolean;

  // Tap / charge detection
  private touchStartTime: number = 0;
  private touchStartPos: Vector2 = { x: 0, y: 0 };
  // Tap (release before INPUT_CONSTANTS.CHARGE_FULL, no drag): normal shot.
  private fireEvents: Vector2[] = [];
  // Charge release (held for the full CHARGE_FULL duration then released):
  // charged shot.  Drag-cancel does NOT apply — the same gesture doubles
  // as the movement input, so a long held + dragged release should still
  // fire the charged shot.
  private chargeReleaseEvents: Vector2[] = [];

  // ── Control scheme (user directive, G9) ───────────────────────────────
  // The picked scheme decides which touch model is live.  Every read goes
  // through `rules`, which is the CONTROL_SCHEME_RULES row — so a scheme's
  // behaviour is one table lookup rather than a name compared in five
  // places.
  private scheme: ControlScheme = 'touch';
  private rules = CONTROL_SCHEME_RULES.touch;
  /** Whether the live pointer session came from a FINGER or a mouse.  The
   *  two share `mouseDown` / `mousePosition`, but the keyboard and gamepad
   *  schemes let touch drag the ship while the mouse may not, so the source
   *  has to be remembered. */
  private pointerIsTouch: boolean = false;

  // ── Fire button (joystick scheme) ─────────────────────────────────────
  private fireTouchId: number | null = null;
  private fireBtnDown: boolean = false;
  private fireBtnStart: number = 0;
  /** Fire events raised by a DEVICE (pad trigger, fire button) rather than
   *  by a tap on the world.  Kept apart from `fireEvents` on purpose: the
   *  engine's tap handler first offers a tap to the minimap toggle, the
   *  loadout slots and `claimTapNear`, and a synthetic shot must not be
   *  eaten by any of them just because the aim happened to point at the
   *  minimap.  (That was a live bug for the pad before this queue existed.) */
  private deviceFireEvents: Vector2[] = [];
  private deviceChargeEvents: Vector2[] = [];

  // ── Onscreen joystick (Pair C, c2 second half) ────────────────────────
  // Touch is two-handed now.  These track the LEFT thumb; the aim finger
  // keeps using mousePosition / mouseDown, so the existing single-touch
  // model is still exactly itself when no stick is down.
  private stickTouchId: number | null = null;
  private aimTouchId: number | null = null;
  private stickOrigin: Vector2 = { x: 0, y: 0 };
  /** Knob position, clamped to RADIUS from the origin — what gets drawn. */
  private stickKnob: Vector2 = { x: 0, y: 0 };
  /** Post-deadzone thrust, direction × throttle. */
  private stickVec: Vector2 = { x: 0, y: 0 };
  /** 1 while held, decaying to 0 after release (drives the widget fade). */
  private stickFade: number = 0;
  /** Rect the stick must not claim, in CSS px — the LIVE minimap, pushed in
   *  by GameEngine each frame.  The collapsed map is inside ZONE_BOTTOM_PX
   *  already; the expanded one is 280px tall and would otherwise swallow the
   *  tap that collapses it again. */
  private stickExclusion: { x: number; y: number; w: number; h: number } | null = null;
  /** DBG: draw the widget even with no touch session, so the layout can be
   *  checked on a desktop browser. */
  public joystickForceVisible: boolean = false;

  // ── Gamepad state (Pair C, c2) ────────────────────────────────────────
  // The pad is POLLED, not evented: `navigator.getGamepads()` hands back a
  // snapshot, so button EDGES have to be derived here by remembering the
  // previous frame.  Everything below is per-frame mutable state, allocated
  // once (mutate-don't-allocate, CLAUDE.md §8) — `pollGamepad` runs once per
  // rendered frame from GameEngine.loop.
  private padIndex: number | null = null;
  private padId: string = '';
  /** The browser's `Gamepad.mapping`.  Every binding in INPUT_CONSTANTS.GAMEPAD
   *  is an INDEX into the W3C "standard gamepad" layout, so a pad the browser
   *  cannot map to that layout reports `''` here and its buttons land wherever
   *  its firmware put them.  We still adopt it — a scrambled pad that flies is
   *  better than no pad — but the DBG readout says so, which is the difference
   *  between "the pad is broken" and "this pad is non-standard". */
  private padMapping: string = '';
  /** Previous frame's pressed state, indexed by button. Length grows to fit. */
  private padPrev: boolean[] = [];
  /** Left-stick thrust after deadzone + rescale; zero when at rest. */
  private padMove: Vector2 = { x: 0, y: 0 };
  /** Persisted unit aim direction. Survives the right stick returning to
   *  centre — releasing the stick holds the last heading, exactly as lifting
   *  a hand off a mouse does. Starts pointing "right" so the very first pad
   *  shot has a real direction and lands at AIM_RADIUS, never at the ship. */
  private padAim: Vector2 = { x: 1, y: 0 };
  /** Scratch for reading the right stick.  `padAim` must NOT be the deadzone
   *  helper's output buffer: the helper writes (0,0) whenever the stick is
   *  inside the zone, which would erase the held heading every frame the
   *  thumb is off the stick — and then a shot would target the screen centre,
   *  i.e. the ship itself. */
  private padAimRead: Vector2 = { x: 0, y: 0 };
  private padFireDown: boolean = false;
  private padFireStart: number = 0;
  /** Latched edge presses, drained by the engine. Counters, not booleans, so
   *  two presses inside one frame cannot silently become one. */
  private padInteractPresses: number = 0;
  private padCyclePresses: number = 0;
  private padPausePresses: number = 0;
  /** Connect / disconnect, drained once by the engine to raise a HUD hint. */
  private padConnectionEvent: { connected: boolean; id: string } | null = null;

  constructor() {
    this.keys = new Set();
    // Initialize to center of screen so player looks forward/neutral initially
    this.mousePosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.mouseDown = false;

    this.initListeners();
  }

  private initListeners() {
    // Keyboard
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);

    // Mouse
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);

    // Note: We removed 'click' listener to handle timing manually in mouseup

    // Touch (Passive false allows us to prevent scrolling)
    window.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    window.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    window.addEventListener('touchend', this.handleTouchEnd);
    window.addEventListener('touchcancel', this.handleTouchEnd);

    // Gamepad.  These two events only announce arrival/departure — the state
    // itself is polled.  Safari on iOS fires them for a Bluetooth DualSense.
    window.addEventListener('gamepadconnected', this.handleGamepadConnected);
    window.addEventListener('gamepaddisconnected', this.handleGamepadDisconnected);
  }

  private handleGamepadConnected = (e: Event) => {
    const gp = (e as GamepadEvent).gamepad;
    if (!gp) return;
    // First pad wins; a second one connecting does not steal the seat.
    if (this.padIndex !== null && this.padIndex !== gp.index) return;
    this.padIndex = gp.index;
    this.padId = gp.id || 'Gamepad';
    this.padMapping = gp.mapping || '';
    this.padPrev.length = 0;
    this.padConnectionEvent = { connected: true, id: this.padId };
  };

  private handleGamepadDisconnected = (e: Event) => {
    const gp = (e as GamepadEvent).gamepad;
    if (!gp || gp.index !== this.padIndex) return;
    this.padIndex = null;
    this.padConnectionEvent = { connected: false, id: this.padId };
    this.padId = '';
    this.resetPadState();
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private handleMouseMove = (e: MouseEvent) => {
    if (!this.rules.pointerAims) return;
    this.mousePosition = { x: e.clientX, y: e.clientY };
  };

  // Game input engages ONLY when the gesture starts on the game CANVAS.
  // Everything else is the React overlay (menus, buttons, scroll panes):
  // skipping those events entirely — instead of only skipping <button>
  // targets, as before — leaves native behaviour intact, most importantly
  // TOUCH SCROLLING inside the overlay menus (the window-level
  // preventDefault below was eating every scroll gesture on touch
  // devices).  Touch events retarget to the element the touch STARTED
  // on, so a game drag that began on the canvas keeps driving movement
  // even when the finger crosses a HUD element.
  private shouldIgnoreEvent(e: Event): boolean {
    return !(e.target instanceof HTMLCanvasElement);
  }

  private handleMouseDown = (e: MouseEvent) => {
    if (this.shouldIgnoreEvent(e)) return;

    // The fire button is drawn in this scheme, so it is clickable in it too.
    if (this.inFireButton(e.clientX, e.clientY)) {
      this.fireBtnDown = true;
      this.fireBtnStart = performance.now();
      return;
    }

    this.mouseDown = true;
    this.pointerIsTouch = false;
    this.touchStartTime = performance.now();
    this.touchStartPos = { x: e.clientX, y: e.clientY };
    // Update pos immediately so rotation is correct
    if (this.rules.pointerAims) this.mousePosition = { x: e.clientX, y: e.clientY };
  };

  private handleMouseUp = (e: MouseEvent) => {
    if (this.fireBtnDown) {
        this.releaseFireButton();
        this.mouseDown = false;
        return;
    }
    if (this.shouldIgnoreEvent(e)) {
        this.mouseDown = false;
        return;
    }

    this.mouseDown = false;
    this.checkTap(e.clientX, e.clientY);
  };

  // Touch is now TWO-HANDED, and the split is by where a finger LANDS.
  //
  // A touch starting inside the joystick zone becomes the STICK and drives
  // movement only.  Every other touch is the AIM finger and behaves exactly
  // as the single-touch model always did — aim, tap-to-fire, hold-to-charge —
  // including driving movement itself WHEN NO STICK IS DOWN, so a player who
  // never discovers the stick loses nothing.  A third finger is ignored.
  private handleTouchStart = (e: TouchEvent) => {
    if (this.shouldIgnoreEvent(e)) return;

    // Prevent browser scrolling/zooming
    if (e.cancelable) e.preventDefault();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];

      // The FIRE button claims first: it is the smallest target on the
      // screen and it sits inside the half the aim finger owns, so anything
      // else claiming ahead of it would swallow the press.
      if (this.rules.fireButton && this.fireTouchId === null
          && this.inFireButton(touch.clientX, touch.clientY)) {
        this.fireTouchId = touch.identifier;
        this.fireBtnDown = true;
        this.fireBtnStart = performance.now();
        continue;
      }

      if (this.rules.joystick && this.stickTouchId === null
          && this.inJoystickZone(touch.clientX, touch.clientY)) {
        this.stickTouchId = touch.identifier;
        this.stickOrigin.x = touch.clientX;
        this.stickOrigin.y = touch.clientY;
        this.stickKnob.x = touch.clientX;
        this.stickKnob.y = touch.clientY;
        this.stickVec.x = 0;
        this.stickVec.y = 0;
        this.stickFade = 1;
        continue;
      }

      if (this.aimTouchId === null) {
        this.aimTouchId = touch.identifier;
        this.mouseDown = true;
        this.pointerIsTouch = true;
        // Under the joystick schemes the aim belongs to the STICK, so a
        // stray finger must not yank the nose toward wherever it landed.
        // The touch is still tracked, because a TAP still docks the ship and
        // still reaches the minimap and the loadout slots.
        if (this.rules.pointerAims) this.mousePosition = { x: touch.clientX, y: touch.clientY };
        this.touchStartTime = performance.now();
        this.touchStartPos = { x: touch.clientX, y: touch.clientY };
      }
    }
  };

  private handleTouchMove = (e: TouchEvent) => {
    if (this.shouldIgnoreEvent(e)) return;

    if (e.cancelable) e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === this.stickTouchId) {
        this.updateStick(touch.clientX, touch.clientY);
      } else if (touch.identifier === this.aimTouchId && this.rules.pointerAims) {
        this.mousePosition = { x: touch.clientX, y: touch.clientY };
      }
    }
  };

  private handleTouchEnd = (e: TouchEvent) => {
    if (this.shouldIgnoreEvent(e)) {
        // The gesture began off-canvas (an overlay), so it never owned game
        // input — but a cancel can arrive without a matching start, so drop
        // the pointer latch rather than leaving the ship thrusting.
        this.mouseDown = false;
        this.aimTouchId = null;
        this.fireTouchId = null;
        this.fireBtnDown = false;
        return;
    }

    if (e.cancelable) e.preventDefault();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === this.fireTouchId) {
        this.fireTouchId = null;
        this.releaseFireButton();
      } else if (touch.identifier === this.stickTouchId) {
        this.stickTouchId = null;
        this.stickVec.x = 0;
        this.stickVec.y = 0;
      } else if (touch.identifier === this.aimTouchId) {
        this.aimTouchId = null;
        this.mouseDown = false;
        this.checkTap(touch.clientX, touch.clientY);
      }
    }
  };

  private checkTap(x: number, y: number) {
    const duration = (performance.now() - this.touchStartTime) / 1000; // seconds

    // Charged shot path: only fires when the player has held for the full
    // CHARGE_FULL window (the visible ring is also complete at this
    // point, so what they see and what fires match exactly).  Drag is
    // not a cancel signal — the mouse hold + drag gesture also drives
    // movement, so gating on drag would break charging while moving.
    if (duration >= INPUT_CONSTANTS.CHARGE_FULL) {
        this.chargeReleaseEvents.push({ x, y });
        return;
    }

    // Tap-shot path: any release before full charge.  Keep the drag-
    // cancel so a fast swipe doesn't accidentally tap-fire.
    const dx = x - this.touchStartPos.x;
    const dy = y - this.touchStartPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= INPUT_CONSTANTS.TAP_DISTANCE_LIMIT) return;

    this.fireEvents.push({ x, y });
  }

  // ── Rumble ─────────────────────────────────────────────────────────────

  /** DBG: force feedback on/off.  Separate from the screen-shake toggle —
   *  wanting the hand to feel a crash and wanting the camera to lurch are
   *  different preferences. */
  public rumbleEnabled: boolean = true;
  /** When the effect currently playing ends, and how strong it was.
   *  `-Infinity` means NONE HAS EVER PLAYED — a plain 0 would be read by the
   *  minimum-gap rule below as "one just finished at time zero", which
   *  swallows the first impact of the session. */
  private rumbleUntilMs: number = -Infinity;
  private rumbleMag: number = 0;
  /** Set once a `playEffect` call has been rejected or thrown, so an
   *  unsupported browser is asked exactly once instead of every impact. */
  private rumbleUnsupported: boolean = false;

  /**
   * Map a SCREEN-SHAKE amount onto a dual-rumble effect, or null if this one
   * should not play.
   *
   * Pure, and separated from the device call for the same reason the pad's
   * mapping is (`applyPadSnapshot`): the actuator cannot exist in a headless
   * browser, but every decision in front of it — the threshold, the curve,
   * the throttle, the interrupt rule — is exactly what needs testing.
   *
   * `nowMs` is passed in rather than read, so a test can drive the throttle
   * without sleeping.
   */
  public rumbleParamsFor(amount: number, nowMs: number):
      { duration: number; strongMagnitude: number; weakMagnitude: number } | null {
    const R = INPUT_CONSTANTS.RUMBLE;
    if (!this.rumbleEnabled || this.rumbleUnsupported) return null;
    if (amount < R.MIN_SHAKE) return null;

    const t = Math.max(0, Math.min(1,
      (amount - R.MIN_SHAKE) / Math.max(1e-6, R.FULL_SHAKE - R.MIN_SHAKE)));

    // An effect already playing is interrupted only by a MEANINGFULLY
    // stronger one.  Without this, a crash's long thump is chopped up by the
    // stream of small hits that always follows it.
    if (nowMs < this.rumbleUntilMs) {
      // Still playing: only a meaningfully stronger hit cuts in.
      if (t < this.rumbleMag + R.INTERRUPT_DELTA) return null;
    } else if (nowMs < this.rumbleUntilMs + R.MIN_INTERVAL_MS) {
      // Just finished: leave a gap, or a stream of small hits reads as one
      // continuous drone rather than as separate impacts.
      return null;
    }

    const duration = R.MIN_MS + (R.MAX_MS - R.MIN_MS) * t;
    return {
      duration,
      strongMagnitude: t,
      weakMagnitude: t * R.WEAK_FRAC,
    };
  }

  /** The adopted pad's haptic actuator, or null.  Its own method so a test
   *  can stand a fake device in front of it — the one part of this that a
   *  headless browser cannot provide. */
  public currentActuator(): { playEffect(type: string, params: object): Promise<unknown> } | null {
    if (this.padIndex === null) return null;
    const nav = navigator as Navigator & { getGamepads?: () => (Gamepad | null)[] };
    if (typeof nav.getGamepads !== 'function') return null;
    const pad = nav.getGamepads()[this.padIndex];
    const act = (pad as unknown as { vibrationActuator?: { playEffect?: unknown } } | null)?.vibrationActuator;
    if (!act || typeof act.playEffect !== 'function') return null;
    return act as { playEffect(type: string, params: object): Promise<unknown> };
  }

  /**
   * Play force feedback for a screen shake of `amount`.  A no-op with no pad,
   * with no actuator, or in a browser that does not implement the effect —
   * which today is most of them, so this must never be load-bearing.
   */
  public rumble(amount: number) {
    const now = performance.now();
    const params = this.rumbleParamsFor(amount, now);
    if (!params) return;

    const act = this.currentActuator();
    if (!act) return;

    this.rumbleUntilMs = now + params.duration;
    this.rumbleMag = params.strongMagnitude;

    try {
      // The promise REJECTS on a browser that knows the method but not the
      // effect type.  Swallow it: an unhandled rejection would put an error
      // in the console, which every suite asserts is clean — and more to the
      // point, a missing motor is not a game problem.
      const p = act.playEffect('dual-rumble', {
        startDelay: 0,
        duration: params.duration,
        strongMagnitude: params.strongMagnitude,
        weakMagnitude: params.weakMagnitude,
      });
      if (p && typeof (p as Promise<unknown>).catch === 'function') {
        (p as Promise<unknown>).catch(() => { this.rumbleUnsupported = true; });
      }
    } catch {
      this.rumbleUnsupported = true;
    }
  }

  // ── Control scheme ─────────────────────────────────────────────────────

  /** Set the active scheme.  Anything the outgoing scheme owned is released
   *  immediately, so switching mid-run cannot leave a stick deflected or a
   *  fire button stuck down. */
  public setControlScheme(scheme: ControlScheme) {
    if (!CONTROL_SCHEME_RULES[scheme] || scheme === this.scheme) return;
    this.scheme = scheme;
    this.rules = CONTROL_SCHEME_RULES[scheme];
    this.stickTouchId = null;
    this.stickVec.x = 0;
    this.stickVec.y = 0;
    this.stickFade = 0;
    this.fireTouchId = null;
    this.fireBtnDown = false;
  }

  public getControlScheme(): ControlScheme {
    return this.scheme;
  }

  /** Does a TAP on the world fire a shot in this scheme?  False under the
   *  joystick scheme, where shooting is the button's job.  The engine asks
   *  before spending a tap — the tap still reaches the minimap toggle, the
   *  loadout slots and `claimTapNear`, which are not weapons. */
  public tapFires(): boolean {
    return this.rules.tapFires;
  }

  // ── Fire button ────────────────────────────────────────────────────────

  /** Centre of the fire button in CSS px.  Computed rather than stored so it
   *  follows a resize with no listener. */
  private fireButtonCenter(out: Vector2): Vector2 {
    const B = INPUT_CONSTANTS.FIRE_BUTTON;
    // Opposite side from the stick.  On the LEFT it also sits higher: the
    // minimap already owns that corner, and a fire button on top of the map
    // toggle would cost the player their map.
    const mirrored = this.rules.stickSide === 'right';
    out.x = mirrored ? B.MARGIN_X : window.innerWidth - B.MARGIN_X;
    out.y = window.innerHeight - (mirrored ? B.MARGIN_Y_MIRRORED : B.MARGIN_Y);
    return out;
  }
  private _fbScratch: Vector2 = { x: 0, y: 0 };

  public inFireButton(x: number, y: number): boolean {
    if (!this.rules.fireButton) return false;
    const c = this.fireButtonCenter(this._fbScratch);
    const dx = x - c.x;
    const dy = y - c.y;
    const r = INPUT_CONSTANTS.FIRE_BUTTON.RADIUS;
    return dx * dx + dy * dy <= r * r;
  }

  /** Release the button, raising the shot.  Same model as every other
   *  device: a press-and-release is a shot, holding past CHARGE_FULL and
   *  releasing is a charged shot, and the ring fills over the same window —
   *  so the joystick scheme teaches nothing new about shooting. */
  private releaseFireButton() {
    if (!this.fireBtnDown) return;
    this.fireBtnDown = false;
    const held = (performance.now() - this.fireBtnStart) / 1000;
    // Fire along the CURRENT aim, wherever the aim finger last left it —
    // the button says when, the aim says where.
    const target = { x: this.mousePosition.x, y: this.mousePosition.y };
    if (held >= INPUT_CONSTANTS.CHARGE_FULL) this.deviceChargeEvents.push(target);
    else this.deviceFireEvents.push(target);
  }

  /**
   * Render-side view.  Null unless the scheme HAS a button — and non-null
   * from the first frame otherwise, unlike the joystick.
   *
   * The joystick can afford to appear only under a thumb because it appears
   * WHERE the thumb lands; a button that is invisible until pressed cannot
   * be found, and in this scheme it is the only way to shoot.  It follows
   * that the button also accepts a MOUSE press: a control the player must be
   * able to see is a control they will try to click.
   */
  public getFireButtonState(): FireButtonHUDState | null {
    if (!this.rules.fireButton) return null;
    const c = this.fireButtonCenter(this._fbScratch);
    const held = this.fireBtnDown
      ? (performance.now() - this.fireBtnStart) / 1000 / INPUT_CONSTANTS.CHARGE_FULL
      : 0;
    return {
      x: c.x,
      y: c.y,
      radius: INPUT_CONSTANTS.FIRE_BUTTON.RADIUS,
      pressed: this.fireBtnDown,
      charge: Math.max(0, Math.min(1, held)),
    };
  }

  /** Shots raised by a DEVICE (fire button, pad trigger) rather than by a
   *  tap on the world.  Drained straight into the weapon by the engine —
   *  they must not pass the tap handler's minimap / loadout / ship-select
   *  intercepts, which exist for taps the PLAYER aimed at the HUD. */
  public getDeviceFireEvents(): Vector2[] {
    const out = [...this.deviceFireEvents];
    this.deviceFireEvents.length = 0;
    return out;
  }
  public getDeviceChargeEvents(): Vector2[] {
    const out = [...this.deviceChargeEvents];
    this.deviceChargeEvents.length = 0;
    return out;
  }

  // ── Onscreen joystick ──────────────────────────────────────────────────

  /**
   * Can a touch landing here become the movement stick?
   *
   * Everything this excludes is a gesture that was already there, and the
   * order of the tests is the order of how much it would hurt to break:
   *  - the SHIP DISC, because `claimTapNear` docks and enters portals from a
   *    tap within SHIP_SELECT_RADIUS of the hull, and the hull sits at screen
   *    centre — which the left zone otherwise reaches;
   *  - the live MINIMAP rect, whose tap toggles it open and closed;
   *  - the bottom strip (loadout slots, collapsed minimap) and the top strip
   *    (HUD chips);
   *  - the whole right half, which is the aim/fire hand.
   */
  public inJoystickZone(x: number, y: number): boolean {
    if (!this.rules.joystick) return false;
    const J = INPUT_CONSTANTS.JOYSTICK;
    const w = window.innerWidth;
    const h = window.innerHeight;

    const cx = w / 2;
    const cy = h / 2;
    const sr = INPUT_CONSTANTS.SHIP_SELECT_RADIUS;
    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= sr * sr) return false;

    const ex = this.stickExclusion;
    if (ex && x >= ex.x && x <= ex.x + ex.w && y >= ex.y && y <= ex.y + ex.h) return false;

    if (this.inFireButton(x, y)) return false;

    // MIRRORED for a left-handed grip: the zone is whichever HALF the stick
    // lives on, and the fire button takes the other.
    if (this.rules.stickSide === 'right') {
      if (x < w * (1 - J.ZONE_W_FRAC)) return false;
    } else {
      if (x > w * J.ZONE_W_FRAC) return false;
    }
    if (y < h * J.ZONE_TOP_FRAC) return false;
    if (y > h - J.ZONE_BOTTOM_PX) return false;
    return true;
  }

  /** GameEngine pushes the LIVE minimap rect here once per frame; the
   *  expanded map is 3.7× the collapsed one, so this cannot be a constant. */
  public setStickExclusion(x: number, y: number, w: number, h: number) {
    if (!this.stickExclusion) this.stickExclusion = { x, y, w, h };
    else {
      this.stickExclusion.x = x;
      this.stickExclusion.y = y;
      this.stickExclusion.w = w;
      this.stickExclusion.h = h;
    }
  }

  private updateStick(x: number, y: number) {
    const J = INPUT_CONSTANTS.JOYSTICK;
    let dx = x - this.stickOrigin.x;
    let dy = y - this.stickOrigin.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= J.DEAD_PX) {
      this.stickVec.x = 0;
      this.stickVec.y = 0;
      this.stickKnob.x = this.stickOrigin.x;
      this.stickKnob.y = this.stickOrigin.y;
      return;
    }

    const nx = dx / dist;
    const ny = dy / dist;
    // Throttle ramps from the deadzone edge to RADIUS, so the first live
    // movement is a nudge rather than a jump — the same rescale the pad's
    // stick deadzone does, for the same reason.
    const throttle = Math.min(1, (dist - J.DEAD_PX) / (J.RADIUS - J.DEAD_PX));
    this.stickVec.x = nx * throttle;
    this.stickVec.y = ny * throttle;

    // THE SHIP AIMS WHERE IT FLIES (user directive).  The stick writes the
    // synthetic POINTER — the same trick the gamepad uses — so the hull's
    // rotation and every shot's target follow the flight direction through
    // the paths the mouse already drives, with nothing else to keep in sync.
    // The heading persists when the thumb lifts, exactly as a released stick
    // or a hand off the mouse does.
    this.mousePosition.x = window.innerWidth / 2 + nx * INPUT_CONSTANTS.GAMEPAD.AIM_RADIUS;
    this.mousePosition.y = window.innerHeight / 2 + ny * INPUT_CONSTANTS.GAMEPAD.AIM_RADIUS;

    // The knob rides the thumb but stops at the ring; past that the thumb
    // can wander without the widget chasing it off into the corner.
    const knobDist = Math.min(dist, J.RADIUS);
    this.stickKnob.x = this.stickOrigin.x + nx * knobDist;
    this.stickKnob.y = this.stickOrigin.y + ny * knobDist;
  }

  /** Advance the release fade. Called once per rendered frame. */
  public tickJoystick(dtSec: number) {
    if (this.stickTouchId !== null) {
      this.stickFade = 1;
    } else if (this.stickFade > 0) {
      const fade = INPUT_CONSTANTS.JOYSTICK.FADE_SEC;
      this.stickFade = fade > 0 ? Math.max(0, this.stickFade - dtSec / fade) : 0;
    }
  }

  /** Render-side view of the stick.  Returns null when there is nothing to
   *  draw — which is the normal case on mouse and pad, so the widget never
   *  ghosts onto a device that has no thumb. */
  public getJoystickState(): JoystickHUDState | null {
    if (!this.rules.joystick) return null;
    if (this.joystickForceVisible && this.stickTouchId === null && this.stickFade <= 0) {
      // DBG: park a neutral stick where a right-handed thumb would land.
      const J = INPUT_CONSTANTS.JOYSTICK;
      const x = this.rules.stickSide === 'right'
        ? window.innerWidth * (1 - J.ZONE_W_FRAC * 0.55)
        : window.innerWidth * J.ZONE_W_FRAC * 0.55;
      const y = window.innerHeight - J.ZONE_BOTTOM_PX - J.RADIUS - 20;
      return { originX: x, originY: y, knobX: x, knobY: y, fade: 1, held: false };
    }
    if (this.stickFade <= 0) return null;
    return {
      originX: this.stickOrigin.x,
      originY: this.stickOrigin.y,
      knobX: this.stickKnob.x,
      knobY: this.stickKnob.y,
      fade: this.stickFade,
      held: this.stickTouchId !== null,
    };
  }

  // ── Gamepad ────────────────────────────────────────────────────────────

  /** Clear everything the pad drives, without touching keyboard/pointer
   *  state. Called on disconnect so a yanked cable cannot leave the ship
   *  thrusting or a trigger stuck down. */
  private resetPadState() {
    this.padMove.x = 0;
    this.padMove.y = 0;
    this.padFireDown = false;
    this.padPrev.length = 0;
    // A different pad may well support what the last one did not.
    this.rumbleUntilMs = -Infinity;
    this.rumbleMag = 0;
    this.rumbleUnsupported = false;
  }

  /**
   * Radial deadzone with rescale, written into `out` (no allocation).
   *
   * Radial rather than per-axis: a per-axis deadzone leaves a cross-shaped
   * dead region, so a stick pushed diagonally-but-gently reads as pure
   * horizontal.  The rescale matters as much as the cut — clamping alone
   * would make the first live deflection jump straight to `deadzone`, which
   * is a visible lurch on a 0.18 zone.
   *
   * Returns the post-deadzone magnitude (0 when inside the zone).
   */
  public applyStickDeadzone(x: number, y: number, deadzone: number, out: Vector2): number {
    const mag = Math.sqrt(x * x + y * y);
    if (mag <= deadzone) {
      out.x = 0;
      out.y = 0;
      return 0;
    }
    // Rescale (deadzone, 1] → (0, 1], and clamp: sticks over-report past 1.0
    // on the diagonals, which would otherwise beat a cardinal push.
    const scaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
    out.x = (x / mag) * scaled;
    out.y = (y / mag) * scaled;
    return scaled;
  }

  /** True if ANY of `indices` is pressed in this snapshot. */
  private padAnyPressed(snap: PadSnapshot, indices: readonly number[]): boolean {
    for (let i = 0; i < indices.length; i++) {
      if (snap.pressed[indices[i]]) return true;
    }
    return false;
  }

  /** Rising edge across the whole group: true only on the frame the group
   *  goes from "none held" to "one held", so holding R1 cycles once. */
  private padGroupEdge(snap: PadSnapshot, indices: readonly number[]): boolean {
    let now = false;
    let before = false;
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      if (snap.pressed[idx]) now = true;
      if (this.padPrev[idx]) before = true;
    }
    return now && !before;
  }

  /**
   * Map one frame of pad state onto the same inputs the mouse and keyboard
   * feed.  Split out from `pollGamepad` so a test can drive the entire
   * mapping — deadzones, aim, edges, the charge window — with a synthetic
   * snapshot, which is the only part of a gamepad that is testable headless.
   *
   * `fireEnabled` is false whenever the world is frozen (paused, docked,
   * stage-clear, death), so a trigger held through a station visit does not
   * queue up a shot that lands on undock.  INTERACT / CYCLE / PAUSE still
   * latch — those are how you leave a frozen state.
   */
  public applyPadSnapshot(snap: PadSnapshot, fireEnabled: boolean) {
    const G = INPUT_CONSTANTS.GAMEPAD;
    const ax = snap.axes;

    // 1. Left stick → thrust.  The vector is in the same screen-space
    //    convention as the pointer branch: +y is DOWN, which is already how
    //    the Gamepad API reports a stick pushed toward the player.
    this.applyStickDeadzone(
      ax[G.AXES.LX] ?? 0, ax[G.AXES.LY] ?? 0, G.STICK_DEADZONE, this.padMove,
    );

    // D-pad adds digital thrust on top — full deflection, normalised, and
    // only consulted when the stick is at rest so the two cannot fight.
    if (this.padMove.x === 0 && this.padMove.y === 0) {
      const [up, down, left, right] = G.BUTTONS.DPAD;
      let dx = 0, dy = 0;
      if (snap.pressed[up]) dy -= 1;
      if (snap.pressed[down]) dy += 1;
      if (snap.pressed[left]) dx -= 1;
      if (snap.pressed[right]) dx += 1;
      if (dx !== 0 || dy !== 0) {
        const len = Math.sqrt(dx * dx + dy * dy);
        this.padMove.x = dx / len;
        this.padMove.y = dy / len;
      }
    }

    // 2. Right stick → aim.  Writing the SYNTHETIC POINTER rather than a
    //    separate aim channel is the whole trick: the engine derives both
    //    the hull's rotation and every shot's target from the pointer, so a
    //    pad aims and shoots through the paths the mouse already uses.
    const aimMag = this.applyStickDeadzone(
      ax[G.AXES.RX] ?? 0, ax[G.AXES.RY] ?? 0, G.STICK_DEADZONE, this.padAimRead,
    );
    if (aimMag > 0) {
      // Keep `padAim` a UNIT heading — magnitude is throttle for the left
      // stick, but for aim it is only "is the player steering".  Committed
      // only while the stick is live, so releasing it holds the heading.
      this.padAim.x = this.padAimRead.x / aimMag;
      this.padAim.y = this.padAimRead.y / aimMag;
      this.writePadPointer();
    }

    // 3. Buttons.
    if (this.padGroupEdge(snap, G.BUTTONS.INTERACT)) this.padInteractPresses++;
    if (this.padGroupEdge(snap, G.BUTTONS.CYCLE_WEAPON)) this.padCyclePresses++;
    if (this.padGroupEdge(snap, G.BUTTONS.PAUSE)) this.padPausePresses++;

    // FIRE mirrors the pointer's model exactly — press-and-release is a shot,
    // holding past CHARGE_FULL and releasing is a charged shot — so the pad
    // teaches nothing new.  What it does NOT inherit is the tap's drag-cancel:
    // a thumb on the right stick moves the aim far past TAP_DISTANCE_LIMIT
    // during any hold, which would swallow every pad shot.
    const fireHeld = fireEnabled && this.padAnyPressed(snap, G.BUTTONS.FIRE);
    if (fireHeld && !this.padFireDown) {
      this.padFireDown = true;
      this.padFireStart = performance.now();
      this.writePadPointer();
    } else if (!fireHeld && this.padFireDown) {
      this.padFireDown = false;
      if (fireEnabled) {
        const held = (performance.now() - this.padFireStart) / 1000;
        const target = this.padPointerTarget();
        // DEVICE queue, not the tap queue: a pad shot must not be offered to
        // the minimap toggle or the loadout slots on its way to the weapon.
        // Aiming straight down with the map expanded used to toggle the map
        // instead of firing, because the synthetic target landed on it.
        if (held >= INPUT_CONSTANTS.CHARGE_FULL) this.deviceChargeEvents.push(target);
        else this.deviceFireEvents.push(target);
      }
    }

    // Remember this frame for the next frame's edges.
    for (let i = 0; i < snap.pressed.length; i++) this.padPrev[i] = !!snap.pressed[i];
    if (this.padPrev.length > snap.pressed.length) this.padPrev.length = snap.pressed.length;
  }

  /** Where the pad's synthetic pointer sits: AIM_RADIUS out from screen
   *  centre along the held heading. Deliberately never AT the centre — the
   *  ship is there, and `claimTapNear` would eat the shot as a dock tap. */
  private padPointerTarget(): Vector2 {
    return {
      x: window.innerWidth / 2 + this.padAim.x * INPUT_CONSTANTS.GAMEPAD.AIM_RADIUS,
      y: window.innerHeight / 2 + this.padAim.y * INPUT_CONSTANTS.GAMEPAD.AIM_RADIUS,
    };
  }

  private writePadPointer() {
    this.mousePosition.x = window.innerWidth / 2 + this.padAim.x * INPUT_CONSTANTS.GAMEPAD.AIM_RADIUS;
    this.mousePosition.y = window.innerHeight / 2 + this.padAim.y * INPUT_CONSTANTS.GAMEPAD.AIM_RADIUS;
  }

  /**
   * Poll the connected pad once per RENDERED frame (not per sim substep —
   * `navigator.getGamepads()` returns a fresh snapshot object per call and
   * the pad hardware reports at ~60–125 Hz, so sampling it five times inside
   * one frame buys nothing but garbage).
   */
  public pollGamepad(fireEnabled: boolean) {
    const nav = navigator as Navigator & { getGamepads?: () => (Gamepad | null)[] };
    if (typeof nav.getGamepads !== 'function') return;

    const pads = nav.getGamepads();
    let pad: Gamepad | null = this.padIndex !== null ? (pads[this.padIndex] ?? null) : null;

    if (!pad) {
      if (this.padIndex !== null) {
        // Vanished without a disconnect event (Safari does this on sleep).
        this.padIndex = null;
        this.padConnectionEvent = { connected: false, id: this.padId };
        this.padId = '';
        this.resetPadState();
      }
      // Adopt the first live pad.  Polling for it rather than trusting
      // `gamepadconnected` alone matters: the spec lets a browser withhold
      // the pad until the first button press, and Safari does exactly that,
      // so a pad that was already paired never fires the event.
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (p && p.connected) {
          this.padIndex = p.index;
          this.padId = p.id || 'Gamepad';
          this.padMapping = p.mapping || '';
          this.padPrev.length = 0;
          this.padConnectionEvent = { connected: true, id: this.padId };
          pad = p;
          break;
        }
      }
      if (!pad) return;
    }

    // Reduce to the snapshot shape.  A trigger is an analogue button: use its
    // `value` against TRIGGER_THRESHOLD rather than `pressed`, which some
    // drivers only set at full travel.
    const pressed: boolean[] = this.padPressedBuf;
    const btns = pad.buttons;
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      pressed[i] = b.value > INPUT_CONSTANTS.GAMEPAD.TRIGGER_THRESHOLD || b.pressed;
    }
    if (pressed.length > btns.length) pressed.length = btns.length;

    this.padSnapshot.axes = pad.axes;
    this.padSnapshot.pressed = pressed;
    this.applyPadSnapshot(this.padSnapshot, fireEnabled);
  }

  /** Reused across frames — see the refill idiom, CLAUDE.md §8. */
  private padPressedBuf: boolean[] = [];
  private padSnapshot: { axes: readonly number[]; pressed: readonly boolean[] } =
    { axes: [], pressed: [] };

  /** True while a pad is adopted. */
  public isPadConnected(): boolean {
    return this.padIndex !== null;
  }

  /** Drain the pending connect/disconnect, if any. */
  public consumePadConnectionEvent(): { connected: boolean; id: string } | null {
    const e = this.padConnectionEvent;
    this.padConnectionEvent = null;
    return e;
  }

  public consumeInteractPress(): boolean {
    if (this.padInteractPresses <= 0) return false;
    this.padInteractPresses--;
    return true;
  }

  public consumeCyclePress(): boolean {
    if (this.padCyclePresses <= 0) return false;
    this.padCyclePresses--;
    return true;
  }

  public consumePausePress(): boolean {
    if (this.padPausePresses <= 0) return false;
    this.padPausePresses--;
    return true;
  }

  /** DBG readout, line 1: which pad is adopted.  Pad ids are long
   *  ("054c-0ce6-DualSense Wireless Controller") and the tail is the
   *  human-readable part, so trim from the FRONT. */
  public padDebugName(): string {
    if (this.padIndex === null) return 'none';
    const name = this.padId.length > 16 ? '…' + this.padId.slice(-16) : (this.padId || 'Gamepad');
    // A non-standard pad is the single most likely reason for "the buttons
    // are wrong", and it is invisible without this.
    return this.padMapping === 'standard' ? name : `${name} ⚠non-std`;
  }

  /** DBG readout, line 2: the numbers that tell you whether the pad is
   *  actually reaching the sim — post-deadzone thrust, held aim heading, and
   *  a live FIRE flag.  This is the one thing a hardware check needs to see. */
  public padDebugAxes(): string {
    if (this.padIndex === null) return '—';
    return `L ${this.padMove.x.toFixed(2)},${this.padMove.y.toFixed(2)}` +
           ` A ${this.padAim.x.toFixed(2)},${this.padAim.y.toFixed(2)}` +
           (this.padFireDown ? ' FIRE' : '');
  }

  public isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }

  public getMovementVector(): Vector2 {
    // 1. Keyboard Input (Immediate override)
    const kDir = { x: 0, y: 0 };
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) kDir.y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) kDir.y += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kDir.x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kDir.x += 1;

    if (kDir.x !== 0 || kDir.y !== 0) {
      const length = Math.sqrt(kDir.x * kDir.x + kDir.y * kDir.y);
      return { x: kDir.x / length, y: kDir.y / length };
    }

    // 2. Onscreen joystick.  Above the pad only because a thumb on glass is
    //    a deliberate act on the device that has one; the two cannot both be
    //    deflected on the same machine in practice.
    if (this.stickVec.x !== 0 || this.stickVec.y !== 0) {
      return { x: this.stickVec.x, y: this.stickVec.y };
    }

    // 3. Gamepad left stick / D-pad.  Sits between keyboard and pointer: it
    //    is analogue like the pointer branch (magnitude IS throttle) but,
    //    like the keyboard, it does not require a held gesture — so it must
    //    be consulted before the pointer, whose branch is gated on mouseDown.
    if (this.padMove.x !== 0 || this.padMove.y !== 0) {
      return { x: this.padMove.x, y: this.padMove.y };
    }

    // 4. Touch / Mouse Input — gated by the SCHEME.  The joystick scheme
    //    steers with its stick and nothing else; the keyboard and gamepad
    //    schemes let a FINGER drag the ship but not the mouse, because on
    //    those schemes steering belongs to the keys or the pad and a click
    //    should only shoot.
    if (this.pointerIsTouch ? !this.rules.touchDragMoves : !this.rules.mouseDragMoves) {
      return { x: 0, y: 0 };
    }

    // Direction: screen center → current touch position (normalized).
    // Throttle: current radial distance from screen center, clamped to
    //           [0, THROTTLE_DISTANCE] and normalised to [0, 1].
    // This makes direction and magnitude fully independent of where the
    // touch started, so sweeping past 180° never drops acceleration.
    if (this.mouseDown) {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;

      const dx = this.mousePosition.x - cx;
      const dy = this.mousePosition.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 1) return { x: 0, y: 0 };

      const nx = dx / dist;
      const ny = dy / dist;

      // Throttle = 0 at center, 1 at THROTTLE_DISTANCE px, capped beyond.
      const throttle = Math.min(1, dist / INPUT_CONSTANTS.THROTTLE_DISTANCE);

      return { x: nx * throttle, y: ny * throttle };
    }

    return { x: 0, y: 0 };
  }

  public isActionPressed(): boolean {
    return this.keys.has('Space') || this.keys.has('Enter') || this.mouseDown
        || this.padFireDown || this.fireBtnDown;
  }

  /** Returns true only when a keyboard fire key (Space/Enter) is held — excludes mouse/touch. */
  public isFireKeyHeld(): boolean {
    return this.keys.has('Space') || this.keys.has('Enter');
  }
  
  public getMousePosition(): Vector2 {
    return this.mousePosition;
  }

  /**
   * Claim a queued TAP that landed within `radius` CSS px of (x, y), removing
   * it from the fire queue so it does NOT also shoot.  Returns true if one was
   * claimed.
   *
   * This is how "tap your own ship to use the thing you're next to" works
   * without inventing a second gesture: a canvas tap is already the fire
   * gesture, so the interaction has to take the tap BEFORE the weapon does.
   * GameEngine calls this from updateInteractables (sim step 5b), which runs
   * ahead of the weapon tick (step 7) that drains the rest of the queue.
   *
   * Only ONE event is claimed per call, and only when something is actually
   * in range — so a tap on the ship in open space still fires normally.
   */
  public claimTapNear(x: number, y: number, radius: number): boolean {
    const r2 = radius * radius;
    for (let i = 0; i < this.fireEvents.length; i++) {
      const dx = this.fireEvents[i].x - x;
      const dy = this.fireEvents[i].y - y;
      if (dx * dx + dy * dy <= r2) {
        this.fireEvents.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  public getFireEvents(): Vector2[] {
    const events = [...this.fireEvents];
    this.fireEvents = [];
    return events;
  }

  /** Drain queued charge-release events (held for the full CHARGE_FULL window). */
  public getChargeReleaseEvents(): Vector2[] {
    const events = [...this.chargeReleaseEvents];
    this.chargeReleaseEvents = [];
    return events;
  }

  /**
   * Live hold duration (seconds) of the current mouse/touch press.  Returns
   * 0 only when the press isn't active.  Drag distance is intentionally
   * NOT a cancel signal here: in this game the same mouse-hold gesture
   * doubles as the movement input (held + dragged from screen centre),
   * so cancelling on drag would break charging while moving.  Used by
   * GameEngine to drive `player.chargeProgress` for the charge-ring HUD.
   */
  public getMouseHoldDuration(): number {
    // Every device's fire hold feeds the SAME charge ring — one charge model
    // everywhere, so the ring means the same thing whichever control you are
    // holding.  The fire button reads first: in the joystick scheme the aim
    // finger is not a trigger, so its hold must not fill the ring.
    if (this.fireBtnDown) return (performance.now() - this.fireBtnStart) / 1000;
    if (this.padFireDown) return (performance.now() - this.padFireStart) / 1000;
    if (!this.mouseDown) return 0;
    if (!this.rules.tapFires) return 0;
    return (performance.now() - this.touchStartTime) / 1000;
  }

  public cleanup() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);

    window.removeEventListener('touchstart', this.handleTouchStart);
    window.removeEventListener('touchmove', this.handleTouchMove);
    window.removeEventListener('touchend', this.handleTouchEnd);
    window.removeEventListener('touchcancel', this.handleTouchEnd);

    window.removeEventListener('gamepadconnected', this.handleGamepadConnected);
    window.removeEventListener('gamepaddisconnected', this.handleGamepadDisconnected);
  }
}
