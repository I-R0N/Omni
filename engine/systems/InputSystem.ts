

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

    // 2. Hybrid Touch Input
    // Direction: Radial from screen center -> current touch
    // Throttle: 
    //   Part A: Initial Radial Distance (Base Throttle)
    //   Part B: Drag Slide Distance (Additional Throttle)
    if (this.mouseDown) {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;

      // Calculate Current Direction (Screen Center -> Current Touch)
      const radialRx = this.mousePosition.x - cx;
      const radialRy = this.mousePosition.y - cy;
      const radialDist = Math.sqrt(radialRx * radialRx + radialRy * radialRy);

      let nx = 0;
      let ny = 0;
      
      if (radialDist > 0.001) {
          nx = radialRx / radialDist;
          ny = radialRy / radialDist;
      }

      // A. Calculate Base Throttle from Initial Touch Position
      //    Touches further from the center give a higher starting speed immediately.
      const startRx = this.touchStartPos.x - cx;
      const startRy = this.touchStartPos.y - cy;
      const startRadialDist = Math.sqrt(startRx * startRx + startRy * startRy);
      
      const baseRadialThrottle = startRadialDist * INPUT_CONSTANTS.RADIAL_ACCEL_FACTOR;

      // B. Calculate Drag Throttle from Slide Action
      const slideDx = this.mousePosition.x - this.touchStartPos.x;
      const slideDy = this.mousePosition.y - this.touchStartPos.y;
      const slideDist = Math.sqrt(slideDx * slideDx + slideDy * slideDy);

      const deadzone = INPUT_CONSTANTS.TAP_DISTANCE_LIMIT; 
      
      let dragThrottle = 0;
      // Only apply drag throttle if outside deadzone to allow for small movements/taps without altering course significantly
      if (slideDist > deadzone) {
          const maxSlide = INPUT_CONSTANTS.THROTTLE_DISTANCE;
          const range = Math.max(1, maxSlide - deadzone);
          const rawDrag = (slideDist - deadzone) / range;
          // Apply MIN_THROTTLE floor only to the drag component
          dragThrottle = Math.max(INPUT_CONSTANTS.MIN_THROTTLE, rawDrag);
      }

      // C. Combine (Base + Drag)
      // The base radial throttle is unaffected by the minimum floor.
      const totalThrottle = baseRadialThrottle + dragThrottle;

      return {
        x: nx * totalThrottle,
        y: ny * totalThrottle
      };
    }

    return { x: 0, y: 0 };
  }

  public isActionPressed(): boolean {
    return this.keys.has('Space') || this.keys.has('Enter') || this.mouseDown;
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
