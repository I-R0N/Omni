// ── Phase 1 Multiplayer Protocol ────────────────────────────────────────────
// Minimal wire format for a host-authoritative 2-player WebRTC prototype.
// JSON-encoded for readability; binary compression is a Phase 2 optimisation.
//
// Roles
//   host   — runs the full simulation, owns all entity state, serves snapshots
//   client — sends its local inputs to the host and renders host snapshots
//
// Flow
//   client → host : HELLO        (handshake)
//   host   → client: WELCOME     (assigns player id)
//   client → host : INPUT (x n)  (sent every tick, ~30 Hz)
//   host   → client: SNAPSHOT(xn)(sent every tick, ~20 Hz)
//   either → other: BYE          (clean shutdown)

import type { SerializedEntity, SerializedDamageText, SerializedWaveAnnouncement, SerializedPlayerStats } from './Snapshot';

export const PROTOCOL_VERSION = 1;

// Fixed entity id used for the host's local player on the wire.  The client's
// player is given PLAYER2_ID.  Deterministic ids keep the client/host in sync
// without needing an allocator.
export const PLAYER1_ID = 'mp_player_1';
export const PLAYER2_ID = 'mp_player_2';

export type NetMessage =
  | HelloMessage
  | WelcomeMessage
  | InputMessage
  | SnapshotMessage
  | ByeMessage;

export interface HelloMessage {
  t: 'hello';
  v: number;
}

export interface WelcomeMessage {
  t: 'welcome';
  v: number;
  yourId: string;  // which player entity belongs to this client
  hostTick: number;
}

export interface InputMessage {
  t: 'input';
  seq: number;       // monotonic sequence number (for ordering / debugging)
  moveX: number;     // [-1, 1] normalised movement vector
  moveY: number;
  aim: number;       // rotation in radians (client's local aim angle)
  fire: boolean;     // latched once per message; host consumes & clears
  weapon?: string;   // optional weapon select
}

export interface SnapshotMessage {
  t: 'snap';
  tick: number;       // host simulation tick counter
  sentAt: number;     // host performance.now() at send time (ms)
  yourId: string;     // the client's player entity id (so client can track self)
  entities: SerializedEntity[];
  damageTexts?: SerializedDamageText[];
  waveAnnouncements?: SerializedWaveAnnouncement[];
  stats: SerializedPlayerStats;
}

export interface ByeMessage {
  t: 'bye';
  reason?: string;
}
