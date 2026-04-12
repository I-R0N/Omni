import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from '../engine/GameEngine';
import { NetDebugInfo, NetRole } from '../types';

// ── Net Debug Overlay ────────────────────────────────────────────────────────
// Floating panel pinned to the top-right when the engine is in a non-SOLO
// role.  Polls the engine once per frame via requestAnimationFrame and shows
// the relevant state for diagnosing multiplayer sync issues from the phone.
//
// Visibility:
//   SOLO    — hidden entirely
//   HOST    — shows host tick, remote input vector, entity count
//   CLIENT  — shows last snapshot tick, selfId, camera/player position,
//             entity count, so we can verify snapshots are flowing and the
//             camera is tracking the right entity
//
// This is a prototype diagnostic surface — toggle off in the menu once the
// multiplayer handshake stabilises.

interface NetDebugOverlayProps {
  engine: GameEngine;
}

const NetDebugOverlay: React.FC<NetDebugOverlayProps> = ({ engine }) => {
  const [info, setInfo] = useState<NetDebugInfo | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      try {
        setInfo(engine.getNetDebugInfo());
      } catch {
        // ignore — engine may be mid-reset
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [engine]);

  if (!info || info.role === NetRole.SOLO) return null;

  const fmt = (n: number | undefined) =>
    n === undefined ? '—' : Number.isFinite(n) ? n.toFixed(0) : String(n);

  return (
    <div
      data-ui-surface
      className="absolute top-2 right-2 pointer-events-none z-40 font-mono text-[10px] leading-tight text-slate-200 bg-slate-900/80 backdrop-blur-sm border border-slate-700 rounded px-2 py-1.5 min-w-[140px]"
    >
      <div className="text-indigo-300 font-bold tracking-widest">NET · {info.role}</div>
      <div>state: {info.gameState}</div>
      {info.role === NetRole.HOST && (
        <>
          <div>tick: {info.hostTick}</div>
          <div>ents: {info.entityCount}</div>
          <div>
            p2: {info.player2Present ? `${fmt(info.player2X)},${fmt(info.player2Y)}` : 'null'}
          </div>
          <div>
            rmv: {fmt(info.remoteMoveX && info.remoteMoveX * 100)},{fmt(info.remoteMoveY && info.remoteMoveY * 100)}
          </div>
        </>
      )}
      {info.role === NetRole.CLIENT && (
        <>
          <div>snap: {info.clientLastTick}</div>
          <div>ents: {info.entityCount}</div>
          <div>self: {info.selfId.slice(-4)}</div>
          <div>
            pos: {fmt(info.selfX)},{fmt(info.selfY)}
          </div>
          <div>
            cam: {fmt(info.cameraX)},{fmt(info.cameraY)}
          </div>
        </>
      )}
    </div>
  );
};

export default NetDebugOverlay;
