// ── Client-side multiplayer session ─────────────────────────────────────────
// Wires a WebRTCTransport to a GameEngine running in CLIENT mode.
//
// Responsibilities
//   1. Accept the host's SDP offer and produce an answer (signalling).
//   2. Forward local inputs upstream to the host at ~30 Hz.
//   3. Apply incoming SNAPSHOT messages onto the engine.

import type { GameEngine } from '../GameEngine';
import { WebRTCTransport, TransportState } from './WebRTCTransport';
import { NetMessage, PLAYER2_ID, PROTOCOL_VERSION } from './Protocol';
import { SignalingRelay, normalizeRoomCode } from './SignalingRelay';

export type ClientStatus =
  | 'idle'
  | 'awaiting-offer'    // waiting for user to paste offer
  | 'answered'          // answer produced, waiting for host to accept
  | 'connecting'
  | 'connected'
  | 'closed'
  | 'error';

// Send inputs at 30 Hz — half the render rate.  Phase 2 may move this to
// per-frame (60 Hz) once delta encoding reduces the per-message overhead.
const INPUT_HZ = 30;
const INPUT_INTERVAL_MS = 1000 / INPUT_HZ;

export class ClientSession {
  private engine: GameEngine;
  private transport: WebRTCTransport;
  private inputTimer: number | null = null;
  private inputSeq: number = 0;
  private _status: ClientStatus = 'idle';

  public onStatusChange: ((s: ClientStatus) => void) | null = null;

  constructor(engine: GameEngine) {
    this.engine = engine;
    this.transport = new WebRTCTransport();
    this.transport.onStateChange = (ts) => this.handleTransportState(ts);
    this.transport.onMessage = (msg) => this.handleMessage(msg);
    this.transport.onOpen = () => this.handleOpen();
    this.transport.onClose = () => this.setStatus('closed');
  }

  public get status(): ClientStatus {
    return this._status;
  }

  /** Accept a base64-encoded SDP offer from the host, produce an answer,
   *  and enter CLIENT mode.  Returns the answer as a base64 JSON string. */
  public async acceptOffer(offerB64: string): Promise<string> {
    let decoded: string;
    try {
      decoded = atob(offerB64.trim());
    } catch {
      throw new Error('Offer is not valid base64');
    }
    this.setStatus('awaiting-offer');
    const answer = await this.transport.createClientAnswer(decoded);
    this.engine.enterClientMode(PLAYER2_ID);
    this.setStatus('answered');
    return btoa(answer);
  }

  /** Join a room end-to-end via the ntfy.sh signalling relay.  Fetches
   *  the host's offer, produces an answer, publishes it back.  Resolves
   *  once the answer has been sent; the data channel will open shortly
   *  after once the host accepts.
   */
  public async joinRoom(rawCode: string): Promise<void> {
    const code = normalizeRoomCode(rawCode);
    if (code.length === 0) throw new Error('Enter a room code first');
    const relay = new SignalingRelay();
    this.setStatus('awaiting-offer');
    const offer = await relay.fetchOffer(code);
    if (!offer) {
      throw new Error(`No offer found for room ${code}. Ask the host to start a new game.`);
    }
    const answer = await this.transport.createClientAnswer(offer);
    this.engine.enterClientMode(PLAYER2_ID);
    await relay.publishAnswer(code, answer);
    this.setStatus('answered');
  }

  public close() {
    if (this.inputTimer !== null) {
      clearInterval(this.inputTimer);
      this.inputTimer = null;
    }
    try {
      this.transport.send({ t: 'bye' });
    } catch {}
    this.transport.close();
    this.engine.exitMultiplayer();
    this.setStatus('closed');
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private handleOpen() {
    this.setStatus('connected');
    this.engine.startMultiplayerGame();
    // Greet host (optional — welcome is host-initiated, but a hello confirms
    // a live channel at the application layer).
    this.transport.send({ t: 'hello', v: PROTOCOL_VERSION });
    this.startInputTimer();
  }

  private handleTransportState(ts: TransportState) {
    if (ts === 'closed' && this._status !== 'closed') {
      this.setStatus('closed');
    }
  }

  private handleMessage(msg: NetMessage) {
    switch (msg.t) {
      case 'snap':
        this.engine.applySnapshot(msg);
        break;
      case 'welcome':
        // Apply the host's world seed so our static scenery regenerates
        // byte-identically.  Other fields (yourId, hostTick) confirm the
        // provisional values we already set in enterClientMode().
        if (typeof msg.worldSeed === 'number') {
          this.engine.applyWorldSeed(msg.worldSeed);
        }
        break;
      case 'bye':
        this.close();
        break;
      default:
        break;
    }
  }

  private startInputTimer() {
    if (this.inputTimer !== null) return;
    this.inputTimer = window.setInterval(() => {
      try {
        const msg = this.engine.getLocalInputMessage(++this.inputSeq);
        this.transport.send(msg);
      } catch (e) {
        console.error('[ClientSession] input build/send failed', e);
      }
    }, INPUT_INTERVAL_MS);
  }

  private setStatus(s: ClientStatus) {
    if (this._status === s) return;
    this._status = s;
    this.onStatusChange?.(s);
  }
}
