

import { Vector2 } from '../../types';
import { INPUT_CONSTANTS } from '../../constants';

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

  // ── Gamepad state (Pair C, c2) ────────────────────────────────────────
  // The pad is POLLED, not evented: `navigator.getGamepads()` hands back a
  // snapshot, so button EDGES have to be derived here by remembering the
  // previous frame.  Everything below is per-frame mutable state, allocated
  // once (mutate-don't-allocate, CLAUDE.md §8) — `pollGamepad` runs once per
  // rendered frame from GameEngine.loop.
  private padIndex: number | null = null;
  private padId: string = '';
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

    this.mouseDown = true;
    this.touchStartTime = performance.now();
    this.touchStartPos = { x: e.clientX, y: e.clientY };
    // Update pos immediately so rotation is correct
    this.mousePosition = { x: e.clientX, y: e.clientY };
  };

  private handleMouseUp = (e: MouseEvent) => {
    if (this.shouldIgnoreEvent(e)) {
        this.mouseDown = false;
        return;
    }

    this.mouseDown = false;
    this.checkTap(e.clientX, e.clientY);
  };

  private handleTouchStart = (e: TouchEvent) => {
    if (this.shouldIgnoreEvent(e)) return;

    // Prevent browser scrolling/zooming
    if (e.cancelable) e.preventDefault();
    
    if (e.changedTouches.length > 0) {
      const touch = e.changedTouches[0];
      this.mouseDown = true;
      
      this.mousePosition = { x: touch.clientX, y: touch.clientY };
      this.touchStartTime = performance.now();
      this.touchStartPos = { x: touch.clientX, y: touch.clientY };
    }
  };

  private handleTouchMove = (e: TouchEvent) => {
    if (this.shouldIgnoreEvent(e)) return;

    if (e.cancelable) e.preventDefault();
    if (e.changedTouches.length > 0) {
      const touch = e.changedTouches[0];
      this.mousePosition = { x: touch.clientX, y: touch.clientY };
    }
  };

  private handleTouchEnd = (e: TouchEvent) => {
    if (this.shouldIgnoreEvent(e)) {
        this.mouseDown = false;
        return;
    }

    if (e.cancelable) e.preventDefault();
    this.mouseDown = false;

    if (e.changedTouches.length > 0) {
        const touch = e.changedTouches[0];
        this.checkTap(touch.clientX, touch.clientY);
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

  // ── Gamepad ────────────────────────────────────────────────────────────

  /** Clear everything the pad drives, without touching keyboard/pointer
   *  state. Called on disconnect so a yanked cable cannot leave the ship
   *  thrusting or a trigger stuck down. */
  private resetPadState() {
    this.padMove.x = 0;
    this.padMove.y = 0;
    this.padFireDown = false;
    this.padPrev.length = 0;
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
        if (held >= INPUT_CONSTANTS.CHARGE_FULL) this.chargeReleaseEvents.push(target);
        else this.fireEvents.push(target);
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
    return this.padId.length > 20 ? '…' + this.padId.slice(-20) : (this.padId || 'Gamepad');
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

    // 2. Gamepad left stick / D-pad.  Sits between keyboard and pointer: it
    //    is analogue like the pointer branch (magnitude IS throttle) but,
    //    like the keyboard, it does not require a held gesture — so it must
    //    be consulted before the pointer, whose branch is gated on mouseDown.
    if (this.padMove.x !== 0 || this.padMove.y !== 0) {
      return { x: this.padMove.x, y: this.padMove.y };
    }

    // 3. Touch / Mouse Input
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
    return this.keys.has('Space') || this.keys.has('Enter') || this.mouseDown || this.padFireDown;
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
    // The pad's fire hold feeds the same charge ring — one charge model for
    // all three devices, so the ring means the same thing everywhere.
    if (this.padFireDown) return (performance.now() - this.padFireStart) / 1000;
    if (!this.mouseDown) return 0;
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
