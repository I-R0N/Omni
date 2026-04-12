// ── Host-side multiplayer session ───────────────────────────────────────────
// Wires a WebRTCTransport to a GameEngine running in HOST mode.
//
// Responsibilities
//   1. Run the signalling handshake (create offer, accept answer).
//   2. Dispatch a SNAPSHOT from the engine to the client on a fixed cadence.
//   3. Forward incoming INPUT messages into engine.feedRemoteInput().
//
// Phase 1 is point-to-point (single remote client).  Phase 2 will track a
// map of clients and loop over them for multi-peer support.

import type { GameEngine } from '../GameEngine';
import { WebRTCTransport, TransportState } from './WebRTCTransport';
import { PLAYER2_ID, PROTOCOL_VERSION, NetMessage } from './Protocol';
import { SignalingRelay, generateRoomCode } from './SignalingRelay';

export type HostStatus =
  | 'idle'
  | 'awaiting-answer'   // offer shown, waiting for user to paste answer
  | 'connecting'
  | 'connected'
  | 'closed'
  | 'error';

// Snapshot send rate: 30 Hz gives a 33ms update cadence that feels noticeably
// smoother than 20 Hz on the joiner without blowing up bandwidth now that we
// strip static entities from the payload.  Between ticks, the client
// extrapolates positions from snapshot velocities to bridge the gap.
const SNAPSHOT_HZ = 30;
const SNAPSHOT_INTERVAL_MS = 1000 / SNAPSHOT_HZ;

export class HostSession {
  private engine: GameEngine;
  private transport: WebRTCTransport;
  private snapshotTimer: number | null = null;
  private _status: HostStatus = 'idle';

  public onStatusChange: ((s: HostStatus) => void) | null = null;

  constructor(engine: GameEngine) {
    this.engine = engine;
    this.transport = new WebRTCTransport();
    this.transport.onStateChange = (ts) => this.handleTransportState(ts);
    this.transport.onMessage = (msg) => this.handleMessage(msg);
    this.transport.onOpen = () => this.handleOpen();
    this.transport.onClose = () => this.setStatus('closed');
  }

  public get status(): HostStatus {
    return this._status;
  }

  /** Run the engine in HOST mode and produce an SDP offer to share with the
   *  peer.  Returns the offer as a base64-encoded JSON string (manual
   *  signalling). */
  public async createOffer(): Promise<string> {
    this.engine.enterHostMode();
    const sdp = await this.transport.createHostOffer();
    this.setStatus('awaiting-answer');
    return btoa(sdp);
  }

  /** Apply an SDP answer copy-pasted back from the peer. */
  public async acceptAnswer(answerB64: string): Promise<void> {
    let decoded: string;
    try {
      decoded = atob(answerB64.trim());
    } catch {
      throw new Error('Answer is not valid base64');
    }
    await this.transport.acceptAnswer(decoded);
    this.setStatus('connecting');
  }

  /** Host a room end-to-end via the ntfy.sh signalling relay.  Generates
   *  a short room code, publishes the offer, and waits for the client to
   *  publish an answer.  Returns the code so the caller can display it.
   *  The optional onCode callback fires as soon as the code is known, so
   *  the UI can show it while ICE is still gathering.
   */
  public async hostRoom(onCode?: (code: string) => void): Promise<string> {
    const relay = new SignalingRelay();
    const code = generateRoomCode();
    if (onCode) onCode(code);
    this.engine.enterHostMode();
    const sdp = await this.transport.createHostOffer();
    this.setStatus('awaiting-answer');
    await relay.publishOffer(code, sdp);
    const answer = await relay.waitForAnswer(code);
    await this.transport.acceptAnswer(answer);
    this.setStatus('connecting');
    return code;
  }

  public close() {
    if (this.snapshotTimer !== null) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    this.transport.close();
    this.engine.exitMultiplayer();
    this.setStatus('closed');
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private handleOpen() {
    this.setStatus('connected');
    // Greet the client with their player id so they can wire up camera /
    // stats mirroring.  The client responds by sending INPUT messages.
    this.transport.send({
      t: 'welcome',
      v: PROTOCOL_VERSION,
      yourId: PLAYER2_ID,
      hostTick: 0,
      worldSeed: this.engine.getWorldSeed(),
    });
    // Start the game immediately — Phase 1 skips any lobby UX.
    this.engine.startMultiplayerGame();
    // Begin periodic snapshot broadcast.
    this.startSnapshotTimer();
  }

  private handleTransportState(ts: TransportState) {
    // Surface transport state transitions as simpler host statuses.  We
    // don't map every state — only the ones that imply a status change.
    if (ts === 'closed' && this._status !== 'closed') {
      this.setStatus('closed');
    }
  }

  private handleMessage(msg: NetMessage) {
    switch (msg.t) {
      case 'input':
        this.engine.feedRemoteInput(msg);
        break;
      case 'hello':
        // Optional: client echo; safe to ignore — welcome is host-initiated.
        break;
      case 'bye':
        this.close();
        break;
      default:
        // Snapshot messages are host-originated; shouldn't arrive here.
        break;
    }
  }

  private startSnapshotTimer() {
    if (this.snapshotTimer !== null) return;
    this.snapshotTimer = window.setInterval(() => {
      try {
        const snap = this.engine.buildSnapshot(PLAYER2_ID);
        this.transport.send(snap);
      } catch (e) {
        console.error('[HostSession] snapshot build/send failed', e);
      }
    }, SNAPSHOT_INTERVAL_MS);
  }

  private setStatus(s: HostStatus) {
    if (this._status === s) return;
    this._status = s;
    this.onStatusChange?.(s);
  }
}
