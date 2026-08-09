

import { Vector2 } from '../../types';
import { INPUT_CONSTANTS } from '../../constants';

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
    return this.keys.has('Space') || this.keys.has('Enter') || this.mouseDown;
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
