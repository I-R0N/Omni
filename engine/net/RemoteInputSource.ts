// ── Remote input buffer ─────────────────────────────────────────────────────
// Holds the latest input state for a remote player (the client, from the
// host's perspective).  The host's per-frame update loop reads from this
// struct when driving player2 — semantically identical to reading from
// InputSystem, but fed by network messages instead of DOM events.
//
// Phase 1: no buffering/prediction — latest-wins.  Phase 2 will add a
// sequence-numbered input buffer for rollback netcode.

import type { Vector2 } from '../../types';
import type { InputMessage } from './Protocol';

export class RemoteInputSource {
  private moveVec: Vector2 = { x: 0, y: 0 };
  private aim: number = 0;
  private firePending: boolean = false;
  private lastSeq: number = -1;

  /** Apply a newly-received input message from the remote client. */
  public apply(msg: InputMessage): void {
    // Reject stale frames.  Clients may send inputs out of order.
    if (msg.seq <= this.lastSeq) return;
    this.lastSeq = msg.seq;

    this.moveVec.x = msg.moveX;
    this.moveVec.y = msg.moveY;
    this.aim = msg.aim;
    // Fire is latched — once set, stays set until consumed by the game loop.
    if (msg.fire) this.firePending = true;
  }

  public getMovementVector(): Vector2 {
    return this.moveVec;
  }

  public getAim(): number {
    return this.aim;
  }

  /** Returns true once per fire event, then clears the latch. */
  public consumeFire(): boolean {
    if (!this.firePending) return false;
    this.firePending = false;
    return true;
  }

  /** Reset when the remote client disconnects. */
  public reset(): void {
    this.moveVec.x = 0;
    this.moveVec.y = 0;
    this.firePending = false;
    this.lastSeq = -1;
  }
}
