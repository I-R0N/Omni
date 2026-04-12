import React, { useState, useRef, useEffect } from 'react';
import { HostSession, HostStatus } from '../engine/net/HostSession';
import { ClientSession, ClientStatus } from '../engine/net/ClientSession';
import { GameEngine } from '../engine/GameEngine';

// ── Multiplayer Menu ─────────────────────────────────────────────────────────
// Phase 1 prototype: room-code signalling over ntfy.sh.  The host generates
// a 4-letter code and shows it; the joiner types the same code.  SDP is
// exchanged through the relay in the background, gzip-compressed so it fits
// under ntfy's message size limit.
//
// Fallback for diagnostics: a Manual Signaling mode is still available that
// copies SDP blobs by hand without touching the relay, in case ntfy is down
// or rate-limiting the test network.

interface MultiplayerMenuProps {
  engine: GameEngine;
  onClose: () => void;
  onSessionStart: (kind: 'host' | 'client', session: HostSession | ClientSession) => void;
}

type Mode = 'choose' | 'host' | 'join';

const MultiplayerMenu: React.FC<MultiplayerMenuProps> = ({ engine, onClose, onSessionStart }) => {
  const [mode, setMode] = useState<Mode>('choose');

  // Host flow state
  const hostSessionRef = useRef<HostSession | null>(null);
  const hostConnectedRef = useRef<boolean>(false);
  const [hostCode, setHostCode] = useState<string>('');
  const [hostStatus, setHostStatus] = useState<HostStatus>('idle');
  const [hostError, setHostError] = useState<string | null>(null);

  // Client flow state
  const clientSessionRef = useRef<ClientSession | null>(null);
  const clientConnectedRef = useRef<boolean>(false);
  const [joinCode, setJoinCode] = useState<string>('');
  const [clientStatus, setClientStatus] = useState<ClientStatus>('idle');
  const [clientError, setClientError] = useState<string | null>(null);

  // Cleanup sessions if the modal unmounts mid-flow without reaching
  // 'connected'.  Refs avoid the stale-closure trap of reading state in
  // an empty-deps effect cleanup.
  useEffect(() => {
    return () => {
      if (hostSessionRef.current && !hostConnectedRef.current) {
        hostSessionRef.current.close();
      }
      if (clientSessionRef.current && !clientConnectedRef.current) {
        clientSessionRef.current.close();
      }
    };
  }, []);

  // ── Host flow ─────────────────────────────────────────────────────────────
  const handleStartHosting = async () => {
    setHostError(null);
    setMode('host');
    const session = new HostSession(engine);
    session.onStatusChange = (s) => {
      setHostStatus(s);
      if (s === 'connected') {
        hostConnectedRef.current = true;
        onSessionStart('host', session);
      }
    };
    hostSessionRef.current = session;
    try {
      await session.hostRoom((code) => setHostCode(code));
    } catch (e) {
      const msg = (e as Error).message || 'Failed to host room';
      setHostError(msg);
      hostSessionRef.current = null;
    }
  };

  // ── Client flow ───────────────────────────────────────────────────────────
  const handleStartJoining = () => {
    setClientError(null);
    setMode('join');
    setJoinCode('');
  };

  const handleJoinRoom = async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 2) {
      setClientError('Enter the room code shown on the host device.');
      return;
    }
    setClientError(null);
    const session = new ClientSession(engine);
    session.onStatusChange = (s) => {
      setClientStatus(s);
      if (s === 'connected') {
        clientConnectedRef.current = true;
        onSessionStart('client', session);
      }
    };
    clientSessionRef.current = session;
    try {
      await session.joinRoom(code);
    } catch (e) {
      const msg = (e as Error).message || 'Failed to join room';
      setClientError(msg);
      clientSessionRef.current = null;
    }
  };

  const handleCancel = () => {
    if (hostSessionRef.current && !hostConnectedRef.current) {
      hostSessionRef.current.close();
      hostSessionRef.current = null;
    }
    if (clientSessionRef.current && !clientConnectedRef.current) {
      clientSessionRef.current.close();
      clientSessionRef.current = null;
    }
    onClose();
  };

  const handleBack = () => {
    // Cancel any in-flight session state so re-entering a mode starts fresh.
    if (hostSessionRef.current && !hostConnectedRef.current) {
      hostSessionRef.current.close();
      hostSessionRef.current = null;
      setHostCode('');
      setHostStatus('idle');
      setHostError(null);
    }
    if (clientSessionRef.current && !clientConnectedRef.current) {
      clientSessionRef.current.close();
      clientSessionRef.current = null;
      setJoinCode('');
      setClientStatus('idle');
      setClientError(null);
    }
    setMode('choose');
  };

  // Friendly label for the current multi-stage status.  ntfy publish +
  // WebRTC ICE gathering happen back-to-back so users don't see every
  // intermediate state; this maps them to readable phases.
  const hostLabel = (() => {
    if (hostError) return hostError;
    if (hostStatus === 'connected') return 'Connected!';
    if (hostStatus === 'connecting') return 'Finalising connection…';
    if (hostStatus === 'awaiting-answer')
      return hostCode ? 'Waiting for joiner…' : 'Preparing room…';
    return 'Starting…';
  })();

  const clientLabel = (() => {
    if (clientError) return clientError;
    if (clientStatus === 'connected') return 'Connected!';
    if (clientStatus === 'connecting') return 'Finalising connection…';
    if (clientStatus === 'answered') return 'Answer sent — waiting for host…';
    if (clientStatus === 'awaiting-offer') return 'Fetching host offer…';
    return '';
  })();

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      data-ui-surface
      className="absolute inset-0 bg-slate-950/95 flex items-center justify-center pointer-events-auto z-[60] p-4"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-500 tracking-wide">
              MULTIPLAYER (PROTOTYPE)
            </h2>
            <button
              onClick={handleCancel}
              className="text-slate-400 hover:text-white text-2xl leading-none px-2"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {mode === 'choose' && (
            <div className="space-y-4">
              <p className="text-slate-300 text-sm leading-relaxed">
                Two-player prototype. One device hosts and gets a 4-letter
                room code; the other joins by entering it. Both devices
                must have internet access (signalling runs through ntfy.sh).
              </p>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={handleStartHosting}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-5 px-4 rounded-xl shadow-lg transition-all active:scale-95"
                >
                  <div className="text-base">HOST</div>
                  <div className="text-xs opacity-80 mt-1 font-normal">Create a room</div>
                </button>
                <button
                  onClick={handleStartJoining}
                  className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-5 px-4 rounded-xl shadow-lg transition-all active:scale-95"
                >
                  <div className="text-base">JOIN</div>
                  <div className="text-xs opacity-80 mt-1 font-normal">Enter a room code</div>
                </button>
              </div>
            </div>
          )}

          {mode === 'host' && (
            <div className="space-y-5">
              <div>
                <div className="text-slate-400 text-xs uppercase tracking-widest mb-2 text-center">
                  Room code
                </div>
                <div className="text-center">
                  {hostCode ? (
                    <div className="font-mono font-black text-6xl tracking-[0.3em] text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 to-purple-300 py-2">
                      {hostCode}
                    </div>
                  ) : (
                    <div className="text-slate-500 text-sm py-6">Generating room…</div>
                  )}
                </div>
                {hostCode && (
                  <div className="text-slate-400 text-xs text-center mt-2">
                    Tell the joiner to enter this code.
                  </div>
                )}
              </div>

              <div className="text-center text-slate-200 text-sm min-h-[1.25rem]">
                {hostLabel}
              </div>

              {hostError && (
                <div className="text-xs text-red-400 bg-red-950/40 border border-red-800 rounded p-2">
                  {hostError}
                </div>
              )}

              <button
                onClick={handleBack}
                className="w-full text-xs text-slate-400 hover:text-slate-200 py-2"
              >
                ← Back
              </button>
            </div>
          )}

          {mode === 'join' && (
            <div className="space-y-5">
              <div>
                <label className="block text-slate-400 text-xs uppercase tracking-widest mb-2 text-center">
                  Enter room code
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  maxLength={8}
                  placeholder="ABCD"
                  className="w-full bg-slate-800 border border-slate-700 focus:border-indigo-400 focus:outline-none rounded-lg p-3 text-center font-mono font-black text-4xl tracking-[0.3em] text-slate-100"
                />
              </div>

              <button
                disabled={clientStatus !== 'idle' || joinCode.trim().length < 2}
                onClick={handleJoinRoom}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all active:scale-95"
              >
                JOIN ROOM
              </button>

              {clientLabel && (
                <div className="text-center text-slate-200 text-sm min-h-[1.25rem]">
                  {clientLabel}
                </div>
              )}

              {clientError && (
                <div className="text-xs text-red-400 bg-red-950/40 border border-red-800 rounded p-2">
                  {clientError}
                </div>
              )}

              <button
                onClick={handleBack}
                className="w-full text-xs text-slate-400 hover:text-slate-200 py-2"
              >
                ← Back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MultiplayerMenu;
