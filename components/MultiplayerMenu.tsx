import React, { useState, useRef, useEffect } from 'react';
import { HostSession, HostStatus } from '../engine/net/HostSession';
import { ClientSession, ClientStatus } from '../engine/net/ClientSession';
import { GameEngine } from '../engine/GameEngine';

// ── Multiplayer Menu ─────────────────────────────────────────────────────────
// Phase 1 prototype: manual SDP copy-paste signalling between two browser
// tabs/devices.  One side clicks "Host", copies the offer to the other side,
// which clicks "Join", pastes the offer, and returns the generated answer.
// Once the host pastes the answer back, the WebRTC data channel opens and
// the game begins.
//
// This UX is intentionally minimal — it's a prototype signalling surface.
// Phase 4 will replace it with a 4-character room code + a small signalling
// relay server so players don't need to transfer SDP blobs by hand.

interface MultiplayerMenuProps {
  engine: GameEngine;
  onClose: () => void;
  // Called when a session reaches 'connected' state.  The session is
  // handed over to the parent so it can be kept alive beyond the modal's
  // lifecycle (timers, transport, etc.) and explicitly closed on app
  // shutdown or user-initiated exit.
  onSessionStart: (kind: 'host' | 'client', session: HostSession | ClientSession) => void;
}

type Mode = 'choose' | 'host' | 'join';

const MultiplayerMenu: React.FC<MultiplayerMenuProps> = ({ engine, onClose, onSessionStart }) => {
  const [mode, setMode] = useState<Mode>('choose');

  // Host flow state
  const hostSessionRef = useRef<HostSession | null>(null);
  // Ref-based "did connect" flag.  React state would be stale-captured by
  // the unmount cleanup (empty-deps useEffect closes over initial state),
  // which previously closed both sessions the instant they reached
  // 'connected' and dumped both devices back to the main menu.
  const hostConnectedRef = useRef<boolean>(false);
  const [hostOffer, setHostOffer] = useState<string>('');
  const [hostAnswerInput, setHostAnswerInput] = useState<string>('');
  const [hostStatus, setHostStatus] = useState<HostStatus>('idle');
  const [hostError, setHostError] = useState<string | null>(null);

  // Client flow state
  const clientSessionRef = useRef<ClientSession | null>(null);
  const clientConnectedRef = useRef<boolean>(false);
  const [clientOfferInput, setClientOfferInput] = useState<string>('');
  const [clientAnswer, setClientAnswer] = useState<string>('');
  const [clientStatus, setClientStatus] = useState<ClientStatus>('idle');
  const [clientError, setClientError] = useState<string | null>(null);

  // Cleanup sessions if the modal unmounts mid-flow without reaching
  // 'connected'.  Once connected, the session survives beyond this modal.
  // We read the ref-based connect flags here (not state) so we see the
  // latest value instead of the stale closure value.
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

  // ── Host flow handlers ────────────────────────────────────────────────────
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
      const offer = await session.createOffer();
      setHostOffer(offer);
    } catch (e) {
      setHostError((e as Error).message || 'Failed to create offer');
      hostSessionRef.current = null;
    }
  };

  const handleSubmitAnswer = async () => {
    if (!hostSessionRef.current) return;
    setHostError(null);
    try {
      await hostSessionRef.current.acceptAnswer(hostAnswerInput);
    } catch (e) {
      setHostError((e as Error).message || 'Failed to accept answer');
    }
  };

  // ── Client flow handlers ──────────────────────────────────────────────────
  const handleStartJoining = () => {
    setClientError(null);
    setMode('join');
    const session = new ClientSession(engine);
    session.onStatusChange = (s) => {
      setClientStatus(s);
      if (s === 'connected') {
        clientConnectedRef.current = true;
        onSessionStart('client', session);
      }
    };
    clientSessionRef.current = session;
  };

  const handleSubmitOffer = async () => {
    if (!clientSessionRef.current) return;
    setClientError(null);
    try {
      const answer = await clientSessionRef.current.acceptOffer(clientOfferInput);
      setClientAnswer(answer);
    } catch (e) {
      setClientError((e as Error).message || 'Failed to process offer');
    }
  };

  // ── Shared helpers ────────────────────────────────────────────────────────
  const handleCopy = (text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  };

  // Web Share API — on iOS this opens the native share sheet (including
  // AirDrop to a nearby device), which is by far the easiest way to move
  // an SDP blob between two iPhones.  Falls back to clipboard copy on
  // browsers without share support.
  const canShare = typeof navigator !== 'undefined' && typeof (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }).share === 'function';
  const handleShare = async (text: string, title: string) => {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title, text });
        return;
      } catch {
        // User cancelled or share failed — fall through to clipboard.
      }
    }
    handleCopy(text);
  };

  // Explicit paste — reads the clipboard and writes the result into the
  // given setter.  Bypasses the focus/long-press/paste dance that's flaky
  // on iOS Safari (especially when the game loop is running).  Requires
  // user activation, which a button click satisfies.
  const canPasteFromClipboard =
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard !== 'undefined' &&
    typeof (navigator.clipboard as Clipboard & { readText?: () => Promise<string> }).readText === 'function';

  const handlePaste = async (setter: (v: string) => void, onError: (msg: string) => void) => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.length > 0) {
        setter(text.trim());
      } else {
        onError('Clipboard is empty.');
      }
    } catch (e) {
      // iOS Safari denies readText() in some contexts (private browsing,
      // missing user gesture, permission denied).  Surface a helpful hint.
      onError('Clipboard read blocked. Tap inside the text field and long-press to paste instead.');
    }
  };

  const handleCancel = () => {
    if (hostSessionRef.current && hostStatus !== 'connected') {
      hostSessionRef.current.close();
      hostSessionRef.current = null;
    }
    if (clientSessionRef.current && clientStatus !== 'connected') {
      clientSessionRef.current.close();
      clientSessionRef.current = null;
    }
    onClose();
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      data-ui-surface
      className="absolute inset-0 bg-slate-950/95 flex items-center justify-center pointer-events-auto z-[60] p-4"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-full overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-500 tracking-wide">
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
                Phase 1 prototype — two-player WebRTC with manual signalling.
                One device hosts the simulation, the other connects via a
                copy-pasted offer / answer. Use two tabs on the same machine
                or two devices on the same network.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <button
                  onClick={handleStartHosting}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-6 px-6 rounded-xl shadow-lg transition-all active:scale-95"
                >
                  <div className="text-lg">HOST GAME</div>
                  <div className="text-xs opacity-80 mt-1 font-normal">Run the simulation on this device</div>
                </button>
                <button
                  onClick={handleStartJoining}
                  className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-6 px-6 rounded-xl shadow-lg transition-all active:scale-95"
                >
                  <div className="text-lg">JOIN GAME</div>
                  <div className="text-xs opacity-80 mt-1 font-normal">Connect to a host's offer</div>
                </button>
              </div>
            </div>
          )}

          {mode === 'host' && (
            <div className="space-y-4">
              <div>
                <div className="text-slate-300 text-xs uppercase tracking-widest mb-2">Status</div>
                <div className="text-slate-100 text-sm font-mono">{hostStatus}</div>
              </div>

              <div>
                <label className="block text-slate-300 text-xs uppercase tracking-widest mb-2">
                  1. Send this offer to the joining device
                </label>
                <textarea
                  readOnly
                  value={hostOffer}
                  placeholder={hostOffer ? '' : 'Generating offer…'}
                  className="w-full h-24 bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono resize-none"
                />
                <div className="mt-2 flex gap-2 flex-wrap">
                  {canShare && (
                    <button
                      disabled={!hostOffer}
                      onClick={() => handleShare(hostOffer, 'Omni multiplayer offer')}
                      className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-1.5 px-3 rounded font-bold"
                    >
                      Share (AirDrop)
                    </button>
                  )}
                  <button
                    disabled={!hostOffer}
                    onClick={() => handleCopy(hostOffer)}
                    className="text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-100 py-1.5 px-3 rounded"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 text-xs uppercase tracking-widest mb-2">
                  2. Paste the answer from the joining device
                </label>
                <textarea
                  value={hostAnswerInput}
                  onChange={(e) => setHostAnswerInput(e.target.value)}
                  placeholder="Tap Paste below, or long-press and Paste…"
                  className="w-full h-24 bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono resize-none"
                />
                <div className="mt-2 flex gap-2 flex-wrap">
                  {canPasteFromClipboard && (
                    <button
                      onClick={() => handlePaste(setHostAnswerInput, setHostError)}
                      className="text-xs bg-purple-600 hover:bg-purple-500 text-white py-1.5 px-3 rounded font-bold"
                    >
                      Paste
                    </button>
                  )}
                  <button
                    disabled={!hostAnswerInput || hostStatus === 'connected'}
                    onClick={handleSubmitAnswer}
                    className="text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white py-1.5 px-3 rounded font-bold"
                  >
                    Accept answer
                  </button>
                  {hostAnswerInput && (
                    <button
                      onClick={() => setHostAnswerInput('')}
                      className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-100 py-1.5 px-3 rounded"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {hostError && (
                <div className="text-xs text-red-400 bg-red-950/40 border border-red-800 rounded p-2">
                  {hostError}
                </div>
              )}

              {hostStatus === 'connected' && (
                <div className="text-sm text-emerald-400 font-bold">
                  ✓ Connected — game starting on both devices.
                </div>
              )}

              <button
                onClick={() => setMode('choose')}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                ← Back
              </button>
            </div>
          )}

          {mode === 'join' && (
            <div className="space-y-4">
              <div>
                <div className="text-slate-300 text-xs uppercase tracking-widest mb-2">Status</div>
                <div className="text-slate-100 text-sm font-mono">{clientStatus}</div>
              </div>

              <div>
                <label className="block text-slate-300 text-xs uppercase tracking-widest mb-2">
                  1. Paste the host's offer
                </label>
                <textarea
                  value={clientOfferInput}
                  onChange={(e) => setClientOfferInput(e.target.value)}
                  placeholder="Tap Paste below, or long-press and Paste…"
                  className="w-full h-24 bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono resize-none"
                />
                <div className="mt-2 flex gap-2 flex-wrap">
                  {canPasteFromClipboard && (
                    <button
                      onClick={() => handlePaste(setClientOfferInput, setClientError)}
                      className="text-xs bg-purple-600 hover:bg-purple-500 text-white py-1.5 px-3 rounded font-bold"
                    >
                      Paste
                    </button>
                  )}
                  <button
                    disabled={!clientOfferInput || clientAnswer.length > 0}
                    onClick={handleSubmitOffer}
                    className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-1.5 px-3 rounded font-bold"
                  >
                    Generate answer
                  </button>
                  {clientOfferInput && !clientAnswer && (
                    <button
                      onClick={() => setClientOfferInput('')}
                      className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-100 py-1.5 px-3 rounded"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {clientAnswer && (
                <div>
                  <label className="block text-slate-300 text-xs uppercase tracking-widest mb-2">
                    2. Send this answer back to the host
                  </label>
                  <textarea
                    readOnly
                    value={clientAnswer}
                    className="w-full h-24 bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono resize-none"
                  />
                  <div className="mt-2 flex gap-2 flex-wrap">
                    {canShare && (
                      <button
                        onClick={() => handleShare(clientAnswer, 'Omni multiplayer answer')}
                        className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white py-1.5 px-3 rounded font-bold"
                      >
                        Share (AirDrop)
                      </button>
                    )}
                    <button
                      onClick={() => handleCopy(clientAnswer)}
                      className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-100 py-1.5 px-3 rounded"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}

              {clientError && (
                <div className="text-xs text-red-400 bg-red-950/40 border border-red-800 rounded p-2">
                  {clientError}
                </div>
              )}

              {clientStatus === 'connected' && (
                <div className="text-sm text-emerald-400 font-bold">
                  ✓ Connected — rendering host state.
                </div>
              )}

              <button
                onClick={() => setMode('choose')}
                className="text-xs text-slate-400 hover:text-slate-200"
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
