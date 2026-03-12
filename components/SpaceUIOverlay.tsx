
/**
 * SpaceUIOverlay - Phase 1 mobile-first HUD for the space survival game.
 *
 * Layout (portrait & landscape iPhone safe-area aware):
 *
 *  ┌─────────────────────────────────────────────────────┐
 *  │  [Health ██████░░░░]            [⏸ Pause]           │  ← top bar
 *  │                                                     │
 *  │              (game canvas)                          │
 *  │                                                     │
 *  │  [FPS debug]          [DRAG move • TAP shoot hint]  │  ← bottom bar
 *  │                              [⊙ Weapon cycle btn]   │
 *  └─────────────────────────────────────────────────────┘
 *
 * State overlays (full-screen, centred):
 *   MENU      → title + START button
 *   PAUSED    → RESUME / RESTART
 *   GAME_OVER → score (future) + RESTART
 *
 * Phase notes:
 *   Phase 2 — add a right-side FIRE button and auto-fire toggle
 *   Phase 3 — add wave counter + enemy count
 *   Phase 4 — add score + high-score
 */

import React, { useEffect, useState } from 'react';
import { EngineStats, GameState } from '../types';

interface SpaceUIOverlayProps {
  stats: EngineStats;
  onCycleWeapon?: () => void;
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRestart?: () => void;
}

const SpaceUIOverlay: React.FC<SpaceUIOverlayProps> = ({
  stats,
  onCycleWeapon,
  onStart,
  onPause,
  onResume,
  onRestart
}) => {
  // Fade out the controls hint after a few seconds of gameplay
  const [showHint, setShowHint] = useState(false);
  const [hintOpacity, setHintOpacity] = useState(1);

  useEffect(() => {
    if (stats.gameState === GameState.PLAYING && !showHint) {
      setShowHint(true);
      setHintOpacity(1);
      const fadeStart = setTimeout(() => {
        const interval = setInterval(() => {
          setHintOpacity(prev => {
            if (prev <= 0) { clearInterval(interval); return 0; }
            return prev - 0.05;
          });
        }, 100);
      }, 4000); // start fading after 4 s
      return () => clearTimeout(fadeStart);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats.gameState]);

  const healthPct = Math.max(
    0,
    ((stats.playerHealth ?? 100) / (stats.playerMaxHealth ?? 100)) * 100
  );

  const healthColor =
    healthPct > 60 ? '#22c55e'   // green-500
    : healthPct > 30 ? '#eab308' // yellow-500
    : '#ef4444';                 // red-500

  const isPlaying = stats.gameState === GameState.PLAYING;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      // Respect iOS safe areas (notch / home-indicator)
      style={{ padding: 'env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)' }}
    >

      {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 flex justify-between items-start p-4 pointer-events-auto"
           style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>

        {/* Health bar */}
        {isPlaying && (
          <div className="flex flex-col gap-1 min-w-32">
            <div className="flex justify-between text-xs text-slate-400 font-mono">
              <span>HP</span>
              <span style={{ color: healthColor }}>{Math.round(stats.playerHealth ?? 100)}</span>
            </div>
            <div className="w-32 h-2 rounded-full bg-slate-800 overflow-hidden border border-slate-700">
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{ width: `${healthPct}%`, backgroundColor: healthColor }}
              />
            </div>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Pause button */}
        {isPlaying && (
          <button
            onClick={onPause}
            className="bg-slate-800/90 hover:bg-slate-700 text-white rounded-xl p-3 shadow-lg border border-slate-600 active:scale-95 transition-all"
            aria-label="Pause"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6"  y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Bottom Bar ──────────────────────────────────────────────────────── */}
      {isPlaying && (
        <div
          className="absolute bottom-0 left-0 right-0 flex justify-between items-end p-4 pointer-events-none"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          {/* FPS debug (left) */}
          <div className="text-[10px] font-mono text-slate-600 pointer-events-none">
            {stats.fps} fps · {stats.entityCount} ents
          </div>

          {/* Controls hint (centre, fades out) */}
          {showHint && hintOpacity > 0 && (
            <div
              className="absolute bottom-16 left-1/2 -translate-x-1/2 text-center text-xs text-slate-400 pointer-events-none"
              style={{ opacity: hintOpacity, transition: 'opacity 0.3s' }}
            >
              <p>DRAG to move</p>
              <p>TAP to fire</p>
            </div>
          )}

          {/* Weapon cycle button (right) */}
          <div className="pointer-events-auto">
            <button
              onClick={onCycleWeapon}
              className="bg-slate-800/90 border-2 border-slate-600 hover:border-yellow-400 active:bg-slate-700 active:scale-95 text-white rounded-full w-20 h-20 flex flex-col items-center justify-center shadow-2xl transition-all"
            >
              <span className="text-[9px] uppercase text-slate-400 tracking-widest font-bold">Weapon</span>
              <span className="text-xs font-bold text-yellow-400 mt-0.5 text-center leading-tight px-1">
                {stats.currentWeapon || 'Blaster'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ── MENU overlay ────────────────────────────────────────────────────── */}
      {stats.gameState === GameState.MENU && (
        <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center pointer-events-auto z-50 gap-6 px-8">
          <div className="text-center mb-2">
            <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-500 tracking-tight drop-shadow-lg mb-3">
              DEEP SPACE
            </h1>
            <p className="text-slate-400 text-sm leading-relaxed max-w-xs">
              Survive endless waves of enemy ships.{'\n'}
              Drag to thrust • Tap to fire • Tap weapon to cycle
            </p>
          </div>

          <button
            onClick={onStart}
            className="bg-sky-600 hover:bg-sky-500 active:scale-95 text-white text-xl font-bold py-4 px-14 rounded-full shadow-2xl transition-all"
          >
            LAUNCH
          </button>

          <p className="text-[11px] text-slate-600 mt-2">Phase 1 — Movement Engine</p>
        </div>
      )}

      {/* ── PAUSED overlay ──────────────────────────────────────────────────── */}
      {stats.gameState === GameState.PAUSED && (
        <div className="absolute inset-0 bg-slate-900/85 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-auto z-50 gap-4">
          <h2 className="text-4xl font-bold text-white tracking-widest mb-4">PAUSED</h2>
          <button
            onClick={onResume}
            className="bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold py-3 px-10 rounded-xl shadow-lg transition-all w-52 flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            RESUME
          </button>
          <button
            onClick={onRestart}
            className="bg-slate-700 hover:bg-red-700 active:scale-95 text-slate-200 hover:text-white font-bold py-3 px-10 rounded-xl shadow-lg transition-all w-52 flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 12" />
              <path d="M3 3v9h9" />
            </svg>
            RESTART
          </button>
        </div>
      )}

    </div>
  );
};

export default SpaceUIOverlay;
