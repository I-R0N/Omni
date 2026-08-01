

import { Vector2 } from '../../types';
import { INPUT_CONSTANTS, GAMEPAD_CONSTANTS } from '../../constants';

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
  
  // ── Gamepad (Phase 3 Pair C) ────────────────────────────────────────────
  // Polled once per frame by GameEngine (`pollGamepad`), never event-driven:
  // the Gamepad API only exposes state snapshots, and a per-frame poll is
  // exactly what a fixed-timestep sim wants anyway.  Everything the pad
  // produces is folded into the SAME channels keyboard and touch feed, so no
  // downstream consumer branches on input device.
  /** Virtual key codes held by pad buttons — merged into `isKeyDown`. */
  private padKeys: Set<string> = new Set();
  /** Left-stick movement, already deadzoned and curved.  Zero when centred. */
  private padMove: Vector2 = { x: 0, y: 0 };
  /** Right-stick aim as a virtual cursor position, or null when centred. */
  private padAim: Vector2 | null = null;
  /** Fire-button hold, mirroring the mouse's tap-vs-charge state machine. */
  private padFiring = false;
  private padFireStart = 0;
  /** Connected pad id, or null.  Surfaced so the HUD can announce it. */
  private padId: string | null = null;
  /** Edge-triggered cycle-weapon requests, drained by the engine. */
  private cycleEvents = 0;
  /** Key-press edges since the last drain — keyboard AND pad buttons that map
   *  to virtual codes.  See `handleKeyDown` for why this exists. */
  private keyEdges: string[] = [];

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
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    // Record the PRESS EDGE, not just the held state.  Polling `isKeyDown`
    // once per rendered frame misses a tap shorter than a frame — which a
    // real Escape/Q tap routinely is — so edge-triggered actions drain this
    // queue instead.  Auto-repeat keydowns are filtered by the has() check.
    if (!this.keys.has(e.code)) this.keyEdges.push(e.code);
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

  /**
   * Poll the connected gamepad and fold its state into the shared input
   * channels.  Called once per rendered frame by GameEngine, BEFORE the sim
   * substeps.  A no-op (and cheap) when no pad is attached.
   *
   * Returns the pad's id on the frame it first appears, so the caller can
   * announce it once — the HUD hint the milestone asks for.
   */
  public pollGamepad(): { justConnected: string | null } {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (!nav || typeof nav.getGamepads !== 'function') return { justConnected: null };
    const pads = nav.getGamepads();
    let pad: Gamepad | null = null;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected) { pad = p; break; }
    }
    if (!pad) {
      // Disconnected: drop every pad-owned bit of state so a yanked cable
      // can't leave the ship thrusting or a virtual key stuck down.
      if (this.padId !== null) {
        this.padId = null;
        this.padKeys.clear();
        this.padMove.x = 0; this.padMove.y = 0;
        this.padAim = null;
        this.padFiring = false;
      }
      return { justConnected: null };
    }
    const justConnected = this.padId === null ? pad.id : null;
    this.padId = pad.id;

    const B = GAMEPAD_CONSTANTS.BUTTONS;
    const dz = GAMEPAD_CONSTANTS.DEADZONE;
    const pressed = (i: number) => (pad!.buttons[i]?.pressed ?? false)
      || (pad!.buttons[i]?.value ?? 0) >= GAMEPAD_CONSTANTS.TRIGGER_THRESHOLD;

    // ── Left stick → movement.  Rescaled from the deadzone edge so the
    // throttle starts at 0 just outside it rather than snapping to ~0.22.
    const lx = pad.axes[0] ?? 0, ly = pad.axes[1] ?? 0;
    const lmag = Math.sqrt(lx * lx + ly * ly);
    if (lmag > dz) {
      const t = Math.min(1, (lmag - dz) / (1 - dz)) ** GAMEPAD_CONSTANTS.MOVE_CURVE;
      this.padMove.x = (lx / lmag) * t;
      this.padMove.y = (ly / lmag) * t;
    } else {
      this.padMove.x = 0; this.padMove.y = 0;
    }

    // ── Right stick → a virtual cursor, which the existing aim line reads.
    const rx = pad.axes[2] ?? 0, ry = pad.axes[3] ?? 0;
    const rmag = Math.sqrt(rx * rx + ry * ry);
    if (rmag > dz) {
      const r = GAMEPAD_CONSTANTS.AIM_RADIUS;
      this.padAim = {
        x: window.innerWidth / 2 + (rx / rmag) * r,
        y: window.innerHeight / 2 + (ry / rmag) * r,
      };
      this.mousePosition = this.padAim;
    } else if (this.padAim) {
      // Released: keep the last aim (the ship holds its heading) rather than
      // snapping back to whatever the mouse last was.
      this.mousePosition = this.padAim;
    }

    // ── Fire: the same tap-vs-charge state machine the mouse uses, so a pad
    // charges shots identically.  Fires at the current aim point.
    const fireDown = pressed(B.FIRE) || pressed(B.TRIGGER_R);
    if (fireDown && !this.padFiring) {
      this.padFiring = true;
      this.padFireStart = performance.now();
    } else if (!fireDown && this.padFiring) {
      this.padFiring = false;
      const held = (performance.now() - this.padFireStart) / 1000;
      const at = { x: this.mousePosition.x, y: this.mousePosition.y };
      if (held >= INPUT_CONSTANTS.CHARGE_FULL) this.chargeReleaseEvents.push(at);
      else this.fireEvents.push(at);
    }

    // ── Virtual keys: interact shares the dock/portal 'KeyE' latch and pause
    // shares 'Escape', so neither needs a second handler anywhere.
    this.setPadKey('KeyE', pressed(B.INTERACT));
    // Pause is EDGE-triggered like its keyboard twin, and pushes the same
    // virtual code, so one drain in GameEngine covers both devices.
    const pauseDown = pressed(B.PAUSE);
    if (pauseDown && !this.padKeys.has('Escape')) this.keyEdges.push('Escape');
    this.setPadKey('Escape', pauseDown);

    // ── Shoulders cycle the loadout (edge-triggered, either shoulder).
    const cycleDown = pressed(B.CYCLE_L) || pressed(B.CYCLE_R);
    if (cycleDown && !this.padKeys.has('__cycle')) this.cycleEvents++;
    this.setPadKey('__cycle', cycleDown);

    return { justConnected };
  }

  private setPadKey(code: string, down: boolean) {
    if (down) this.padKeys.add(code); else this.padKeys.delete(code);
  }

  /** True while a gamepad is attached — drives the HUD hint. */
  public get gamepadId(): string | null { return this.padId; }

  /** Drain queued cycle-weapon requests (shoulder buttons). */
  public takeCycleRequests(): number {
    const n = this.cycleEvents;
    this.cycleEvents = 0;
    return n;
  }

  /** Drain the key-press edges recorded since the last call (keyboard keydowns
   *  and pad buttons that map to virtual codes).  Reuses one array so the
   *  drain allocates nothing in the common empty case. */
  public takeKeyEdges(): string[] {
    if (this.keyEdges.length === 0) return this.keyEdges;
    const out = this.keyEdges.slice();
    this.keyEdges.length = 0;
    return out;
  }

  /** Keyboard OR pad — pad buttons map to virtual key codes (see
   *  GAMEPAD_CONSTANTS), so every existing `isKeyDown` call site accepts a
   *  pad press for free. */
  public isKeyDown(code: string): boolean {
    return this.keys.has(code) || this.padKeys.has(code);
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

    // 1b. Gamepad left stick — same priority tier as the keyboard (an analog
    // stick is a direct movement command), and ahead of touch so a pad in
    // hand always wins over a stale pointer position.
    if (this.padMove.x !== 0 || this.padMove.y !== 0) return this.padMove;

    // 2. Touch / Mouse Input
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
    return this.keys.has('Space') || this.keys.has('Enter') || this.mouseDown || this.padFiring;
  }

  /** Returns true only when a keyboard fire key (Space/Enter) is held — excludes mouse/touch. */
  public isFireKeyHeld(): boolean {
    return this.keys.has('Space') || this.keys.has('Enter');
  }
  
  public getMousePosition(): Vector2 {
    return this.mousePosition;
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
    // Pointer OR pad trigger — the charge ring shouldn't care which is held.
    if (this.padFiring) return (performance.now() - this.padFireStart) / 1000;
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
  }
}
