

import { Vector2, JoystickHUDState, FireButtonHUDState, ControlScheme, RumbleKind } from '../../types';
import { INPUT_CONSTANTS, CONTROL_SCHEME_RULES } from '../../constants';
import { DualSenseHID, TriggerProfile, TriggerEncoding, TRIGGER_ENCODINGS, TRIGGER_OFF } from './DualSenseHID';

/** One frame of pad state, reduced to what the mapping layer cares about.
 *  `applyPadSnapshot` takes this rather than a live `Gamepad` so the whole
 *  mapping is drivable from a test — the Gamepad API cannot be synthesised in
 *  a headless browser, but this shape can. */
export interface PadSnapshot {
  axes: readonly number[];
  /** Pressed state per button index. */
  pressed: readonly boolean[];
  /** ANALOG position per button, 0..1.  Digital buttons report 0 or 1; the
   *  two triggers report their real travel, which `pressed` cannot express —
   *  Chrome sets `pressed` on a DualSense trigger at a tiny deflection, so a
   *  boolean read fires the gun the instant the trigger moves. */
  values?: readonly number[];
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

  // ── Menu navigation (G15) ─────────────────────────────────────────────
  // A pad has to be able to reach every control the game has, not just the
  // ones in flight.  These are latched the same way the in-flight edges are —
  // counters and steps, drained by the engine — so the menu layer never
  // reads raw pad state and a press cannot be silently lost between frames.
  /** Queued nav steps, most recent last.  A STEP, not a held direction: the
   *  repeat is resolved here so the consumer sees discrete moves. */
  private padNavSteps: { x: number; y: number }[] = [];
  /** Which direction is currently held, and when it next repeats. */
  private padNavHeld: { x: number; y: number } = { x: 0, y: 0 };
  private padNavNextAt: number = 0;
  private padConfirmPresses: number = 0;
  private padBackPresses: number = 0;

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
  /** Normalised intensity (0..1) of the effect currently playing — what the
   *  interrupt rule compares against, so it is the same quantity on both
   *  sides rather than a magnitude versus a curve input. */
  private rumbleT: number = 0;
  /** Set once a `playEffect` call has been rejected or thrown, so an
   *  unsupported browser is asked exactly once instead of every impact. */
  private rumbleUnsupported: boolean = false;

  // ── Adaptive triggers (DualSense over WebHID) ─────────────────────────
  // A SECOND, OPTIONAL transport to the same pad, and deliberately the only
  // thing in the input layer that is allowed to be platform-specific.  It is
  // output-only and opt-in, it never becomes a source of input, and every
  // method below is a no-op until the player has connected a pad through the
  // browser's device picker — so touch, keyboard and the Gamepad API behave
  // identically on a platform where WebHID does not exist (every mobile
  // browser, and Safari).  See engine/systems/DualSenseHID.ts.
  private hid: DualSenseHID = new DualSenseHID();
  /** Analogue throttle from the LEFT trigger, 0..1.  Only read under a
   *  scheme with `triggerThrust`. */
  private padThrottle: number = 0;
  /** Left-trigger profile — the throttle's own resistance. */
  private thrustProfile: TriggerProfile = TRIGGER_OFF;
  /** The profile currently pushed to the pad, so the per-frame sync can
   *  compare before touching an async path at all. */
  private triggerProfile: TriggerProfile = TRIGGER_OFF;

  /** Is the adaptive-trigger path even reachable in this browser?  The UI
   *  uses this to decide whether to OFFER the control, since a button that
   *  can only ever fail is worse than no button. */
  public adaptiveTriggersSupported(): boolean {
    return DualSenseHID.isSupported();
  }

  public adaptiveTriggersConnected(): boolean {
    return this.hid.isConnected();
  }

  /** Open a pad.  MUST be called from a user gesture (the browser enforces
   *  it), which is why this is a UI callback and not something the engine
   *  attempts on its own. */
  public async connectAdaptiveTriggers(): Promise<boolean> {
    const ok = await this.hid.connect();
    if (ok) {
      // Push the current profile immediately, so connecting mid-flight is
      // felt at once rather than at the next weapon change.
      this.hid.applyTriggers(this.triggerProfile, TRIGGER_OFF, true);
    }
    return ok;
  }

  /** Close the pad, releasing the clutch on the way out. */
  public async disconnectAdaptiveTriggers(): Promise<void> {
    await this.hid.disconnect();
  }

  /**
   * Set the right trigger's feel.  Called every frame by the engine with the
   * profile for what the player is currently holding; the redundant-write
   * check lives inside `DualSenseHID.applyTriggers`, so an unchanged profile
   * costs one struct compare and creates no promise.
   *
   * The left trigger is always released — the game binds nothing to it, and a
   * clutch on a control that does nothing is just a stiff trigger.
   */
  public setTriggerProfile(profile: TriggerProfile): void {
    this.triggerProfile = profile;
    if (!this.hid.isConnected()) return;
    void this.hid.applyTriggers(profile, this.thrustProfile);
  }

  /** Set the LEFT trigger's feel.  Separate setter because the two triggers
   *  are driven by different things — the right by what gun is held, the left
   *  by how fast the ship is going — and neither should have to know the
   *  other's state to write its own. */
  public setThrustTriggerProfile(profile: TriggerProfile): void {
    this.thrustProfile = profile;
    if (!this.hid.isConnected()) return;
    void this.hid.applyTriggers(this.triggerProfile, profile);
  }

  /** Is the left trigger the throttle right now? */
  public usesTriggerThrust(): boolean {
    return !!this.rules.triggerThrust;
  }

  /** Is the GUN on a face button right now?  Read by the adaptive-trigger
   *  sync: a weapon profile on the right trigger describes a control the
   *  player is not using under these schemes, and a clutch on a control that
   *  does nothing is just a stiff trigger. */
  public usesFaceFire(): boolean {
    return !!this.rules.fireFace;
  }

  /** DBG readout: whether the WebHID path is unsupported, idle, or live —
   *  and, when live, the head of the last report actually sent, because a
   *  wrong byte layout is otherwise indistinguishable from a dead pad. */
  public adaptiveTriggerDebugInfo(): string {
    return this.hid.debugInfo();
  }

  public adaptiveTriggerReportHex(): string {
    return this.hid.lastReportHex();
  }

  public triggerEncoding(): TriggerEncoding {
    return this.hid.encoding;
  }

  /** Step to the next wire encoding.  A DIAGNOSTIC, not a preference: the two
   *  conventions are both reported working on different firmware, a pad
   *  discards the one it does not understand in silence, and the only
   *  instrument that can tell them apart is a pad in a hand. */
  public cycleTriggerEncoding(): void {
    const i = TRIGGER_ENCODINGS.indexOf(this.hid.encoding);
    this.hid.setEncoding(TRIGGER_ENCODINGS[(i + 1) % TRIGGER_ENCODINGS.length]);
  }

  /** Run the pad's motors through the HID report rather than the Gamepad API.
   *  This BISECTS the feature: the motors ride the same framing and the same
   *  CRC as the triggers, but their encoding is not in dispute — so a buzz
   *  here with no trigger resistance means the wire format is right and the
   *  effect encoding is wrong, while silence on both means nothing is
   *  reaching the pad at all. */
  public testAdaptiveTriggerLink(): void {
    void this.hid.pulseRumble();
  }

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

    // Normalised intensity, 0 at the smallest event the game emits and 1 at a
    // high-speed crash.
    const t = Math.max(0, Math.min(1,
      (amount - R.MIN_SHAKE) / Math.max(1e-6, R.FULL_SHAKE - R.MIN_SHAKE)));

    // An effect already playing is interrupted only by a MEANINGFULLY
    // stronger one.  Without this, a crash's long thump is chopped up by the
    // stream of small hits that always follows it.
    if (nowMs < this.rumbleUntilMs) {
      if (t < this.rumbleT + R.INTERRUPT_DELTA) return null;
    } else if (nowMs < this.rumbleUntilMs + R.MIN_INTERVAL_MS) {
      // Just finished: leave a gap, or a stream of small hits reads as one
      // continuous drone rather than as separate impacts.
      return null;
    }

    // Overall strength rides a FLOOR, so the smallest qualifying event is
    // still felt; the balance between the two motors crossfades, so small
    // events read as a high-frequency tick and big ones as a low thump.
    const mag = R.MIN_MAGNITUDE + (1 - R.MIN_MAGNITUDE) * t;
    return {
      duration: R.MIN_MS + (R.MAX_MS - R.MIN_MS) * t,
      strongMagnitude: mag * (R.STRONG_AT_MIN + (1 - R.STRONG_AT_MIN) * t),
      weakMagnitude: mag * (1 - (1 - R.WEAK_AT_MAX) * t),
    };
  }

  /** Effect types this pad's actuator says it supports.  Chromium exposes
   *  `effects`; where it is absent, assume the one effect every actuator
   *  has.  Read rather than assumed, because `trigger-rumble` depends on the
   *  pad having trigger motors AND the browser having shipped it. */
  public actuatorEffects(): readonly string[] {
    const act = this.currentActuator() as unknown as { effects?: readonly string[] } | null;
    const list = act?.effects;
    return Array.isArray(list) && list.length ? list : ['dual-rumble'];
  }

  /** Which effect type an event of this kind should actually play.  Pure, so
   *  the fallback is testable without a pad that has trigger motors. */
  public rumbleEffectFor(kind: RumbleKind, supported: readonly string[]): string {
    if (kind === 'trigger' && supported.includes('trigger-rumble')) return 'trigger-rumble';
    return 'dual-rumble';
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
  public rumble(amount: number, kind: RumbleKind = 'impact') {
    const now = performance.now();
    const params = this.rumbleParamsFor(amount, now);
    if (!params) return;

    const act = this.currentActuator();
    if (!act) return;

    // A weapon shot wants the TRIGGER to kick, which is what the trigger
    // motors are for.  `trigger-rumble`'s parameters are a superset of
    // `dual-rumble`'s, so one effect drives the handles and the trigger
    // together — and where the pad or the browser lacks it, this silently
    // becomes the ordinary handle thump.
    const effect = this.rumbleEffectFor(kind, this.actuatorEffects());
    const triggerForce = effect === 'trigger-rumble'
      ? Math.min(1, params.strongMagnitude * INPUT_CONSTANTS.RUMBLE.TRIGGER_FORCE_MULT)
      : 0;

    const R = INPUT_CONSTANTS.RUMBLE;
    this.rumbleUntilMs = now + params.duration;
    this.rumbleT = Math.max(0, Math.min(1,
      (amount - R.MIN_SHAKE) / Math.max(1e-6, R.FULL_SHAKE - R.MIN_SHAKE)));

    try {
      // The promise REJECTS on a browser that knows the method but not the
      // effect type.  Swallow it: an unhandled rejection would put an error
      // in the console, which every suite asserts is clean — and more to the
      // point, a missing motor is not a game problem.
      const p = act.playEffect(effect, {
        startDelay: 0,
        duration: params.duration,
        strongMagnitude: params.strongMagnitude,
        weakMagnitude: params.weakMagnitude,
        // Ignored by `dual-rumble`; the fire trigger is the right one.
        leftTrigger: 0,
        rightTrigger: triggerForce,
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
    this.padThrottle = 0;
    this.padNavSteps.length = 0;
    this.padNavHeld.x = 0;
    this.padNavHeld.y = 0;
    this.padConfirmPresses = 0;
    this.padBackPresses = 0;
    this.padFireDown = false;
    this.padPrev.length = 0;
    // A different pad may well support what the last one did not.
    this.rumbleUntilMs = -Infinity;
    this.rumbleT = 0;
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

  /**
   * Turn the held D-pad into discrete NAV STEPS, with auto-repeat.
   *
   * Resolved here rather than in the menu layer for the same reason button
   * edges are: `pollGamepad` is the only thing that sees every frame, and a
   * consumer that renders on a stats push would miss both the edge and the
   * repeat window.
   */
  private tickMenuNav(snap: PadSnapshot) {
    const G = INPUT_CONSTANTS.GAMEPAD;
    const [up, down, left, right] = G.BUTTONS.DPAD;
    let x = 0, y = 0;
    if (snap.pressed[up]) y -= 1;
    if (snap.pressed[down]) y += 1;
    if (snap.pressed[left]) x -= 1;
    if (snap.pressed[right]) x += 1;

    if (x === 0 && y === 0) {
      this.padNavHeld.x = 0;
      this.padNavHeld.y = 0;
      return;
    }
    const now = performance.now();
    // A CHANGE of direction restarts the repeat clock, so rolling the thumb
    // around the pad steps once per direction rather than machine-gunning.
    if (x !== this.padNavHeld.x || y !== this.padNavHeld.y) {
      this.padNavHeld.x = x;
      this.padNavHeld.y = y;
      this.padNavSteps.push({ x, y });
      this.padNavNextAt = now + G.MENU_REPEAT_DELAY_MS;
      return;
    }
    if (now >= this.padNavNextAt) {
      this.padNavSteps.push({ x, y });
      this.padNavNextAt = now + G.MENU_REPEAT_INTERVAL_MS;
    }
  }

  /** Drain queued menu nav steps.  Returns the array and empties it. */
  public consumeNavSteps(): { x: number; y: number }[] {
    if (this.padNavSteps.length === 0) return this.padNavSteps;
    const out = this.padNavSteps.slice();
    this.padNavSteps.length = 0;
    return out;
  }

  public consumeConfirmPress(): boolean {
    if (this.padConfirmPresses === 0) return false;
    this.padConfirmPresses--;
    return true;
  }

  public consumeBackPress(): boolean {
    if (this.padBackPresses === 0) return false;
    this.padBackPresses--;
    return true;
  }

  /** Deepest ANALOG position across a group, 0..1.  Falls back to the
   *  boolean when a snapshot carries no values (older tests, odd drivers). */
  private padGroupValue(snap: PadSnapshot, indices: readonly number[]): number {
    let v = 0;
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      const analog = snap.values ? (snap.values[idx] ?? 0) : (snap.pressed[idx] ? 1 : 0);
      if (analog > v) v = analog;
    }
    return v;
  }

  /**
   * How far the trigger must be pulled to fire, 0..1 — THE SAME POINT the
   * adaptive-trigger profile breaks at.
   *
   * This is the whole reason G13 (fire on press) and G12 (adaptive triggers)
   * belong together.  A `weapon` profile resists and then GIVES WAY at `end`;
   * a `resistance` profile puts up a wall at `start`.  Either way the trigger
   * has a physical moment, and the gun should go off AT it — reading the
   * browser's `pressed` flag instead fires the shot as the trigger leaves its
   * rest position, before the clutch has done anything at all.
   *
   * Clamped to a band on purpose: this must ALSO feel right on a pad with no
   * WebHID and therefore no physical cue, and it is the same number in both
   * cases.  Branching on whether the HID link is open would make the sim
   * depend on an optional desktop-only transport, which is the one thing that
   * layer is not allowed to do.
   */
  private padFirePoint(): number {
    const p = this.triggerProfile;
    const T = INPUT_CONSTANTS.GAMEPAD;
    // Each shape has one moment that reads as "now" to the hand, and it is
    // not always the same end of the effect:
    //   weapon / slope — the far end.  A click is felt when it GIVES WAY; a
    //                    ramp's payoff is the top of the pull.
    //   texture        — past the LAST notch: you push through the whole
    //                    texture, and firing on the first one would leave two
    //                    more notches after the shot with nothing to mean.
    //   resistance /
    //   vibration      — the near end.  Neither has a break, so the moment is
    //                    where the wall or the buzz begins.
    let raw: number;
    switch (p.kind) {
      case 'weapon':
      case 'slope':
        raw = p.end;
        break;
      case 'texture': {
        const z = p.zones ?? [];
        let last = -1;
        for (let i = 0; i < z.length; i++) if (z[i] > 0) last = i;
        raw = last >= 0 ? last / 9 : p.start;
        break;
      }
      case 'resistance':
      case 'vibration':
        raw = p.start;
        break;
      default:
        raw = T.TRIGGER_THRESHOLD;
    }
    return Math.max(T.FIRE_POINT_MIN, Math.min(T.FIRE_POINT_MAX, raw));
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
    // Suppressed entirely under `stickAims`: those schemes give the aim to the
    // MOVE stick, and two channels writing one pointer is a fight the player
    // feels as the reticle snapping between their thumbs.  `gamepad-thrust`
    // is the exception WITHIN that — it lets whichever stick is deflected
    // further win, because on a minimal pad the one stick may be either.
    if (aimMag > 0 && (!this.rules.stickAims || this.rules.triggerThrust)) {
      // Keep `padAim` a UNIT heading — magnitude is throttle for the left
      // stick, but for aim it is only "is the player steering".  Committed
      // only while the stick is live, so releasing it holds the heading.
      this.padAim.x = this.padAimRead.x / aimMag;
      this.padAim.y = this.padAimRead.y / aimMag;
      this.writePadPointer();
    }

    // 2b. EITHER STICK, under the trigger-thrust scheme (user directive).
    //
    // The scheme exists for MINIMAL pads — the cheap clip-on Bluetooth
    // controllers that have one stick and one or two triggers — so it must
    // not care WHICH stick that one is.  Whichever is deflected further wins
    // and supplies BOTH heading and aim: the ship aims where it flies, the
    // same rule the joystick touch schemes already use, because a one-stick
    // pad has no second stick to aim with.
    //
    // On a full pad this means the two sticks do the same job rather than
    // fighting; the larger deflection is the player's actual intent, and the
    // other one being centred costs nothing.
    // 2c. LEFT STICK CARRIES EVERYTHING (`gamepad-left`, user call).
    //
    // Heading, aim and throttle from one thumb: the deflection's DIRECTION
    // steers and aims, its MAGNITUDE is the throttle — which is the ordinary
    // `gamepad` meaning of the left stick, so nothing about flying changes,
    // only that the ship now points where it flies.  The D-pad rides along
    // for free: it has already written a unit vector into `padMove` above, so
    // it aims in its eight directions at full throttle.
    //
    // `padMove` KEEPS its magnitude here — that is the whole difference from
    // the trigger-thrust branch below, which normalises it away because a
    // trigger owns the throttle there.
    if (this.rules.stickAims && !this.rules.triggerThrust) {
      const mag = Math.sqrt(this.padMove.x * this.padMove.x + this.padMove.y * this.padMove.y);
      if (mag > 0) {
        this.padAim.x = this.padMove.x / mag;
        this.padAim.y = this.padMove.y / mag;
        this.writePadPointer();
      }
    }

    if (this.rules.triggerThrust) {
      const moveMag = Math.sqrt(this.padMove.x * this.padMove.x + this.padMove.y * this.padMove.y);
      const useAim = aimMag > moveMag;
      const hx = useAim ? this.padAimRead.x : this.padMove.x;
      const hy = useAim ? this.padAimRead.y : this.padMove.y;
      const mag = useAim ? aimMag : moveMag;
      if (mag > 0) {
        this.padMove.x = hx / mag;
        this.padMove.y = hy / mag;
        this.padAim.x = this.padMove.x;
        this.padAim.y = this.padMove.y;
        this.writePadPointer();
      }
    }

    // 3. Buttons.
    if (this.padGroupEdge(snap, G.BUTTONS.CONFIRM)) this.padConfirmPresses++;
    if (this.padGroupEdge(snap, G.BUTTONS.BACK)) this.padBackPresses++;
    this.tickMenuNav(snap);
    if (this.padGroupEdge(snap, G.BUTTONS.INTERACT)) this.padInteractPresses++;
    if (this.padGroupEdge(snap, G.BUTTONS.CYCLE_WEAPON)) this.padCyclePresses++;
    if (this.padGroupEdge(snap, G.BUTTONS.PAUSE)) this.padPausePresses++;

    // FIRE ON PRESS (user directive, G13).  The pad used to mirror the
    // pointer's press-and-RELEASE model for consistency's sake, and that was
    // the wrong thing to be consistent about: the tap fires on release
    // because it MUST — until the finger lifts, a tap and a drag are the same
    // gesture — while a trigger has no such ambiguity and every millisecond
    // between the pull and the shot is felt as lag.  The rule is therefore
    // about the CONTROL, not the device: a dedicated fire control fires when
    // it is pressed, a pointer gesture fires when it resolves.
    //
    // It also makes the adaptive trigger mean something.  A `weapon` profile
    // resists and then GIVES WAY at a point in the travel; with the shot on
    // release, that break had no relationship to when the gun went off.  Now
    // the break IS the shot.
    //
    // Holding still charges: the press shot goes out immediately and a hold
    // past CHARGE_FULL adds the charged shot on release.  Nothing is lost,
    // and the release no longer owes the player an ordinary shot.
    //
    // What the pad does NOT inherit is the tap's drag-cancel: a thumb on the
    // right stick moves the aim far past TAP_DISTANCE_LIMIT during any hold,
    // which would swallow every pad shot.
    // 3b. THROTTLE (trigger-thrust scheme).  Read every frame regardless of
    // scheme — the read is one array index, and gating it would mean the
    // value is stale on the frame a scheme change makes it live.
    const throttleRaw = this.padGroupValue(snap, G.BUTTONS.THROTTLE);
    this.padThrottle = throttleRaw < G.THROTTLE_DEADZONE ? 0
      : (throttleRaw - G.THROTTLE_DEADZONE) / (1 - G.THROTTLE_DEADZONE);

    // ANALOG, not the boolean: `pressed` goes true almost as soon as a
    // DualSense trigger leaves rest, so reading it fires the gun before the
    // clutch has resisted anything.  A digital face button reports 1, which
    // clears any threshold, so it is unaffected.
    // `fireFace` schemes put the gun on the bottom face button: under
    // trigger-thrust because both triggers are the THROTTLE there, and under
    // `gamepad-left` because the user asked for it — the left thumb flies
    // and the right thumb shoots, with the trigger left free.
    const fireGroup = this.rules.fireFace ? G.BUTTONS.FIRE_FACE : G.BUTTONS.FIRE;
    const fireHeld = fireEnabled && this.padGroupValue(snap, fireGroup) >= this.padFirePoint();
    if (fireHeld && !this.padFireDown) {
      this.padFireDown = true;
      this.padFireStart = performance.now();
      this.writePadPointer();
      // DEVICE queue, not the tap queue: a pad shot must not be offered to
      // the minimap toggle or the loadout slots on its way to the weapon.
      // Aiming straight down with the map expanded used to toggle the map
      // instead of firing, because the synthetic target landed on it.
      this.deviceFireEvents.push(this.padPointerTarget());
    } else if (!fireHeld && this.padFireDown) {
      this.padFireDown = false;
      // Only the CHARGED shot is owed on release now — the ordinary one was
      // paid at the press.
      if (fireEnabled && (performance.now() - this.padFireStart) / 1000 >= INPUT_CONSTANTS.CHARGE_FULL) {
        this.deviceChargeEvents.push(this.padPointerTarget());
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
    const values: number[] = this.padValuesBuf;
    const btns = pad.buttons;
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      pressed[i] = b.value > INPUT_CONSTANTS.GAMEPAD.TRIGGER_THRESHOLD || b.pressed;
      // A digital button with no analogue reading at all is promoted to 1;
      // anything that reports real travel keeps it.  Both DualSense triggers
      // report travel, so they are never promoted.
      values[i] = b.value > 0 ? b.value : (b.pressed ? 1 : 0);
    }
    if (pressed.length > btns.length) pressed.length = btns.length;
    if (values.length > btns.length) values.length = btns.length;

    this.padSnapshot.axes = pad.axes;
    this.padSnapshot.pressed = pressed;
    this.padSnapshot.values = values;
    this.applyPadSnapshot(this.padSnapshot, fireEnabled);
  }

  /** Reused across frames — see the refill idiom, CLAUDE.md §8. */
  private padPressedBuf: boolean[] = [];
  private padValuesBuf: number[] = [];
  private padSnapshot: { axes: readonly number[]; pressed: readonly boolean[]; values?: readonly number[] } =
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

  /**
   * DBG readout, line 3: WHY there is or is not force feedback.
   *
   * Rumble is the one thing in the input layer that cannot be checked
   * anywhere but on real hardware, so the panel has to distinguish the four
   * different reasons a pad might sit silent — a toggle, no pad, a pad with
   * no motors, and a browser that refused the effect — rather than leaving
   * "nothing happened" to cover all of them.
   */
  public rumbleDebugInfo(): string {
    if (!this.rumbleEnabled) return 'off (DBG)';
    if (this.padIndex === null) return 'no pad';
    if (this.rumbleUnsupported) return 'browser refused';
    if (!this.currentActuator()) return 'pad has no actuator';
    // Name the effects, so "can this pad do trigger feedback" is answered by
    // looking rather than by guessing at browser support tables.
    const effects = this.actuatorEffects().join('+');
    return (performance.now() < this.rumbleUntilMs ? 'playing · ' : 'ready · ') + effects;
  }

  /** DBG readout, line 2: the numbers that tell you whether the pad is
   *  actually reaching the sim — post-deadzone thrust, held aim heading, and
   *  a live FIRE flag.  This is the one thing a hardware check needs to see. */
  public padDebugAxes(): string {
    if (this.padIndex === null) return '—';
    return `L ${this.padMove.x.toFixed(2)},${this.padMove.y.toFixed(2)}` +
           ` A ${this.padAim.x.toFixed(2)},${this.padAim.y.toFixed(2)}` +
           (this.rules.triggerThrust ? ` T ${this.padThrottle.toFixed(2)}` : '') +
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
    //
    //    Under `gamepad-thrust` the stick's MAGNITUDE is discarded and the
    //    left trigger supplies it instead: the stick says where, the throttle
    //    says how hard.  That is why this is a scheme and not a toggle — the
    //    two readings of a stick deflection cannot both be live.
    if (this.rules.triggerThrust) {
      const mag = Math.sqrt(this.padMove.x * this.padMove.x + this.padMove.y * this.padMove.y);
      if (mag > 0 && this.padThrottle > 0) {
        return {
          x: (this.padMove.x / mag) * this.padThrottle,
          y: (this.padMove.y / mag) * this.padThrottle,
        };
      }
      // A throttle with no heading has nothing to push against; a heading
      // with no throttle is aiming, not flying.  Either way: no thrust.  The
      // pointer branch below is still reachable, so touch keeps working.
      if (mag > 0 || this.padThrottle > 0) return { x: 0, y: 0 };
    } else if (this.padMove.x !== 0 || this.padMove.y !== 0) {
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

    // A pad left holding a stiff trigger stays stiff in whatever the player
    // opens next — the clutch is physical state, not page state.
    void this.hid.disconnect();
  }
}
