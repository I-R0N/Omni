import { MultiplayerPeer, MultiplayerSnapshot, NetworkPlayerInput } from '../types';

type HostMessage =
  | { type: 'join'; playerId: string; playerName: string }
  | { type: 'leave'; playerId: string }
  | { type: 'input'; playerId: string; input: NetworkPlayerInput };

type ClientMessage =
  | { type: 'join-ack'; to: string; accepted: boolean; peers: MultiplayerPeer[] }
  | { type: 'peer-joined'; peer: MultiplayerPeer }
  | { type: 'peer-left'; playerId: string }
  | { type: 'snapshot'; snapshot: MultiplayerSnapshot };

type SessionMessage = HostMessage | ClientMessage;

interface SessionConfig {
  mode: 'host' | 'client';
  roomId: string;
  self: MultiplayerPeer;
  maxPlayers: number;
}

interface SessionCallbacks {
  onConnected?: () => void;
  onPeerJoined?: (peer: MultiplayerPeer) => void;
  onPeerLeft?: (playerId: string) => void;
  onInput?: (playerId: string, input: NetworkPlayerInput) => void;
  onSnapshot?: (snapshot: MultiplayerSnapshot) => void;
  onRejected?: () => void;
}

export class BroadcastMultiplayerSession {
  private readonly channel: BroadcastChannel;
  private readonly config: SessionConfig;
  private readonly callbacks: SessionCallbacks;
  private readonly peers = new Map<string, MultiplayerPeer>();

  constructor(config: SessionConfig, callbacks: SessionCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.channel = new BroadcastChannel(`omni-room:${config.roomId}`);
    this.channel.onmessage = this.handleMessage;

    if (config.mode === 'host') {
      this.peers.set(config.self.playerId, config.self);
      this.callbacks.onConnected?.();
    } else {
      this.post({
        type: 'join',
        playerId: config.self.playerId,
        playerName: config.self.playerName,
      });
    }
  }

  public destroy() {
    if (this.config.mode === 'client') {
      this.post({ type: 'leave', playerId: this.config.self.playerId });
    } else {
      for (const peer of this.peers.values()) {
        if (peer.playerId === this.config.self.playerId) continue;
        this.post({ type: 'peer-left', playerId: peer.playerId });
      }
    }
    this.channel.close();
  }

  public getPeerCount(): number {
    return this.peers.size;
  }

  public sendInput(input: NetworkPlayerInput) {
    if (this.config.mode !== 'client') return;
    this.post({
      type: 'input',
      playerId: this.config.self.playerId,
      input,
    });
  }

  public broadcastSnapshot(snapshot: MultiplayerSnapshot) {
    if (this.config.mode !== 'host') return;
    this.post({ type: 'snapshot', snapshot });
  }

  private post(message: SessionMessage) {
    this.channel.postMessage(message);
  }

  private handleMessage = (event: MessageEvent<SessionMessage>) => {
    const message = event.data;
    if (!message) return;

    if (this.config.mode === 'host') {
      this.handleHostMessage(message);
      return;
    }

    this.handleClientMessage(message);
  };

  private handleHostMessage(message: SessionMessage) {
    if (message.type === 'join') {
      if (message.playerId === this.config.self.playerId) return;
      if (this.peers.has(message.playerId)) return;

      const peerCountWithoutHost = Math.max(0, this.peers.size - 1);
      if (peerCountWithoutHost >= this.config.maxPlayers - 1) {
        this.post({
          type: 'join-ack',
          to: message.playerId,
          accepted: false,
          peers: Array.from(this.peers.values()),
        });
        return;
      }

      const peer: MultiplayerPeer = {
        playerId: message.playerId,
        playerName: message.playerName,
      };
      this.peers.set(peer.playerId, peer);
      this.post({
        type: 'join-ack',
        to: peer.playerId,
        accepted: true,
        peers: Array.from(this.peers.values()),
      });
      this.post({ type: 'peer-joined', peer });
      this.callbacks.onPeerJoined?.(peer);
      return;
    }

    if (message.type === 'leave') {
      if (!this.peers.has(message.playerId)) return;
      this.peers.delete(message.playerId);
      this.post({ type: 'peer-left', playerId: message.playerId });
      this.callbacks.onPeerLeft?.(message.playerId);
      return;
    }

    if (message.type === 'input') {
      this.callbacks.onInput?.(message.playerId, message.input);
    }
  }

  private handleClientMessage(message: SessionMessage) {
    if (message.type === 'join-ack') {
      if (message.to !== this.config.self.playerId) return;
      if (!message.accepted) {
        this.callbacks.onRejected?.();
        return;
      }

      this.peers.clear();
      for (const peer of message.peers) {
        this.peers.set(peer.playerId, peer);
      }
      this.callbacks.onConnected?.();
      return;
    }

    if (message.type === 'peer-joined') {
      this.peers.set(message.peer.playerId, message.peer);
      if (message.peer.playerId !== this.config.self.playerId) {
        this.callbacks.onPeerJoined?.(message.peer);
      }
      return;
    }

    if (message.type === 'peer-left') {
      this.peers.delete(message.playerId);
      this.callbacks.onPeerLeft?.(message.playerId);
      return;
    }

    if (message.type === 'snapshot') {
      this.callbacks.onSnapshot?.(message.snapshot);
    }
  }
}
