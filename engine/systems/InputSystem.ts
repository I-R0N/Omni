

import { Vector2 } from '../../types';
import { INPUT_CONSTANTS } from '../../constants';

export class InputSystem {
  private keys: Set<string>;
  private mousePosition: Vector2;
  private mouseDown: boolean;
  
  // Tap detection
  private touchStartTime: number = 0;
  private touchStartPos: Vector2 = { x: 0, y: 0 };
  private fireEvents: Vector2[] = [];
  
  constructor() {
    this.keys = new Set();
    // Initialize to center of screen so player looks forward/neutral initially
    this.mousePosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.mouseDown = false;

    this.initListeners();
  }

  private initListeners() {
    // Keyboard
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    
    // Mouse
    window.addEventListener('mousemove', (e) => {
      this.mousePosition = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    
    // Note: We removed 'click' listener to handle timing manually in mouseup

    // Touch (Passive false allows us to prevent scrolling)
    window.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    window.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    window.addEventListener('touchend', this.handleTouchEnd);
    window.addEventListener('touchcancel', this.handleTouchEnd);
  }

  // Helper to detect if we should ignore input (e.g. clicking UI buttons)
  private shouldIgnoreEvent(e: Event): boolean {
    const target = e.target as HTMLElement;
    // Check if clicking on a button or inside a button (e.g. span inside button)
    if (target && (target.tagName === 'BUTTON' || target.closest('button'))) {
      return true;
    }
    return false;
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
    const duration = performance.now() - this.touchStartTime;
    
    // Calculate distance moved during the hold
    const dist = Math.sqrt(
        Math.pow(x - this.touchStartPos.x, 2) +
        Math.pow(y - this.touchStartPos.y, 2)
    );

    // It is a tap if held for short time AND didn't drag far
    // OR if ZERO_DELAY_SHOOTING is on, we allow "taps" even if they took longer, provided distance is short
    if (dist < INPUT_CONSTANTS.TAP_DISTANCE_LIMIT) {
        if (INPUT_CONSTANTS.ZERO_DELAY_SHOOTING || duration < INPUT_CONSTANTS.TAP_THRESHOLD) {
             this.fireEvents.push({ x, y });
        }
    }
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

  public getFireEvents(): Vector2[] {
    const events = [...this.fireEvents];
    this.fireEvents = [];
    return events;
  }

  public cleanup() {
    window.removeEventListener('keydown', (e) => this.keys.add(e.code));
    window.removeEventListener('keyup', (e) => this.keys.delete(e.code));
    window.removeEventListener('mousemove', (e) => {
        this.mousePosition = { x: e.clientX, y: e.clientY };
    });
    window.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);
    
    window.removeEventListener('touchstart', this.handleTouchStart);
    window.removeEventListener('touchmove', this.handleTouchMove);
    window.removeEventListener('touchend', this.handleTouchEnd);
    window.removeEventListener('touchcancel', this.handleTouchEnd);
  }
}
