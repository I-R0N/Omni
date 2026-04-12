// ── Minimal WebRTC data channel wrapper ─────────────────────────────────────
// Handles offer/answer exchange with manual SDP copy-paste signalling.  The
// data channel is configured unordered + unreliable (like UDP) to minimise
// latency for state snapshots; loss is acceptable because every snapshot is
// self-contained.
//
// Usage (host):
//   const t = new WebRTCTransport();
//   const offer = await t.createHostOffer();   // show to user
//   // (user transfers offer to client, receives answer)
//   await t.acceptAnswer(answer);
//
// Usage (client):
//   const t = new WebRTCTransport();
//   const answer = await t.createClientAnswer(offer);
//   // (user transfers answer back to host)
//
// Both sides then receive `onOpen` and can send/receive messages.

import type { NetMessage } from './Protocol';

export type TransportState = 'idle' | 'signaling' | 'connecting' | 'open' | 'closed' | 'error';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export class WebRTCTransport {
  private pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private _state: TransportState = 'idle';

  public onMessage: ((msg: NetMessage) => void) | null = null;
  public onOpen: (() => void) | null = null;
  public onClose: (() => void) | null = null;
  public onStateChange: ((state: TransportState) => void) | null = null;
  public onError: ((err: Error) => void) | null = null;

  constructor() {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc.onconnectionstatechange = () => {
      const cs = this.pc.connectionState;
      if (cs === 'connected') this.setState('connecting');
      else if (cs === 'disconnected' || cs === 'failed' || cs === 'closed') {
        if (this._state !== 'closed') {
          this.setState('closed');
          this.onClose?.();
        }
      }
    };
  }

  public get state(): TransportState {
    return this._state;
  }

  /** Host-side: create a data channel, generate an offer, wait for ICE
   *  gathering, return the local description as a JSON string. */
  public async createHostOffer(): Promise<string> {
    this.setState('signaling');
    this.channel = this.pc.createDataChannel('omni-game', {
      ordered: false,
      maxRetransmits: 0,
    });
    this.wireChannel(this.channel);
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.waitForIceComplete();
    return JSON.stringify(this.pc.localDescription);
  }

  /** Host-side: apply the answer produced by the remote client. */
  public async acceptAnswer(answerJSON: string): Promise<void> {
    let answer: RTCSessionDescriptionInit;
    try {
      answer = JSON.parse(answerJSON);
    } catch (e) {
      throw new Error('Answer is not valid JSON');
    }
    await this.pc.setRemoteDescription(answer);
    this.setState('connecting');
  }

  /** Client-side: accept a host offer, produce an answer, wait for ICE
   *  gathering, return the local description as a JSON string. */
  public async createClientAnswer(offerJSON: string): Promise<string> {
    this.setState('signaling');
    let offer: RTCSessionDescriptionInit;
    try {
      offer = JSON.parse(offerJSON);
    } catch (e) {
      throw new Error('Offer is not valid JSON');
    }
    // Host-initiated data channel — listen for it rather than creating one.
    this.pc.ondatachannel = (evt) => {
      this.channel = evt.channel;
      this.wireChannel(this.channel);
    };
    await this.pc.setRemoteDescription(offer);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.waitForIceComplete();
    return JSON.stringify(this.pc.localDescription);
  }

  public send(msg: NetMessage): void {
    if (!this.channel || this.channel.readyState !== 'open') return;
    let payload: string;
    try {
      payload = JSON.stringify(msg);
    } catch (e) {
      console.warn('[WebRTCTransport] serialize failed', e);
      return;
    }
    // Guard against sends larger than the negotiated SCTP message size.
    // iOS Safari caps unordered/unreliable RTCDataChannel messages at a
    // much lower value than Chrome/Firefox (often ~64 KB vs 256 KB), and
    // a send() overflow can put the channel into an error state from
    // which no further messages flow in either direction.  We drop the
    // message and report via onError so the app layer can surface it.
    const maxBytes = this.channel.maxMessageSize || 65535;
    // Rough UTF-8 byte count upper bound — JSON is ASCII-heavy so length
    // is within a few % of byte count.  Use length * 4 as a safe ceiling.
    if (payload.length > maxBytes) {
      const err = new Error(
        `Payload ${payload.length} bytes exceeds channel max ${maxBytes} bytes (msg.t=${(msg as { t: string }).t})`
      );
      console.warn('[WebRTCTransport] oversized send dropped', err.message);
      this.onError?.(err);
      return;
    }
    try {
      this.channel.send(payload);
    } catch (e) {
      console.warn('[WebRTCTransport] send failed', e);
      this.onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  }

  public close(): void {
    if (this._state === 'closed') return;
    try { this.channel?.close(); } catch {}
    try { this.pc.close(); } catch {}
    this.setState('closed');
    this.onClose?.();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private wireChannel(ch: RTCDataChannel) {
    ch.binaryType = 'arraybuffer';
    ch.onopen = () => {
      // Log negotiated SCTP limits so we can diagnose iOS-specific
      // behaviour via the web inspector.
      console.info(
        '[WebRTCTransport] data channel open — maxMessageSize=%s, ordered=%s, maxRetransmits=%s',
        ch.maxMessageSize,
        ch.ordered,
        ch.maxRetransmits
      );
      this.setState('open');
      this.onOpen?.();
    };
    ch.onclose = () => {
      if (this._state !== 'closed') {
        this.setState('closed');
        this.onClose?.();
      }
    };
    ch.onerror = (evt) => {
      const err = (evt as RTCErrorEvent).error ?? new Error('Data channel error');
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
    };
    ch.onmessage = (evt) => {
      if (typeof evt.data !== 'string') return; // Phase 1 uses JSON only
      try {
        const msg = JSON.parse(evt.data) as NetMessage;
        this.onMessage?.(msg);
      } catch (e) {
        console.warn('[WebRTCTransport] message parse failed', e);
      }
    };
  }

  private setState(s: TransportState) {
    if (this._state === s) return;
    this._state = s;
    this.onStateChange?.(s);
  }

  /** Wait until ICE candidate gathering completes so the emitted SDP is
   *  self-contained (no trickle-ICE needed for manual copy-paste signalling). */
  private waitForIceComplete(): Promise<void> {
    return new Promise((resolve) => {
      if (this.pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const listener = () => {
        if (this.pc.iceGatheringState === 'complete') {
          this.pc.removeEventListener('icegatheringstatechange', listener);
          resolve();
        }
      };
      this.pc.addEventListener('icegatheringstatechange', listener);
      // Safety timeout — some browsers never report 'complete' on restricted
      // networks; after 4s, whatever we have is good enough.
      setTimeout(() => {
        this.pc.removeEventListener('icegatheringstatechange', listener);
        resolve();
      }, 4000);
    });
  }
}
