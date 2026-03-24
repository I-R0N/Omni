
import React from 'react';
import { EngineStats, MapType, GameState } from '../types';

interface UIOverlayProps {
  stats: EngineStats;
  onCycleWeapon?: () => void;
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRestart?: () => void;
  onToggleDebug?: () => void;
  difficulty?: number;
  onSetDifficulty?: (level: number) => void;
}

const UIOverlay: React.FC<UIOverlayProps> = ({
  stats,
  onCycleWeapon,
  onStart,
  onPause,
  onResume,
  onRestart,
  onToggleDebug,
  difficulty = 3,
  onSetDifficulty,
}) => {
  return (
    <div className="absolute inset-0 pointer-events-none p-4 flex flex-col justify-between">

      {/* ── Top Bar ── */}
      <div className="flex justify-between items-start">

        {/* Top-left: debug panel (visible only when debug is on) */}
        <div className="flex flex-col gap-1">
          {/* Debug toggle button — always visible */}
          <button
            onClick={onToggleDebug}
            className={`pointer-events-auto self-start px-2 py-1 rounded text-[10px] font-mono font-bold tracking-widest border transition-all ${
              stats.debugMode
                ? 'bg-amber-500/30 border-amber-400/70 text-amber-300'
                : 'bg-slate-800/70 border-slate-600/50 text-slate-500 hover:text-slate-300'
            }`}
          >
            DBG
          </button>

          {/* Debug info panel */}
          {stats.debugMode && (
            <div className="pointer-events-none bg-slate-900/80 border border-slate-700/60 rounded-lg px-3 py-2 text-[11px] font-mono text-slate-300 space-y-0.5 shadow-lg backdrop-blur-sm">
              <p>FPS: <span className="text-white">{stats.fps}</span></p>
              <p>Entities: <span className="text-white">{stats.entityCount}</span></p>
              <p>Wave: <span className="text-white">{stats.waveNumber ?? 1} / {stats.waveTotal ?? '?'}</span></p>
              <p>State: <span className="text-white">{stats.waveStatus}</span></p>
            </div>
          )}
        </div>

        {/* Top-right: wave HUD + pause button */}
        <div className="flex items-start gap-3">

          {/* Wave info — only while playing */}
          {stats.gameState === GameState.PLAYING && (
            <div className="pointer-events-none flex flex-col items-end gap-1">
              {/* Fuel bar */}
              <div className="flex items-center gap-2 bg-slate-900/75 border border-slate-600/50 rounded-lg px-3 py-1 shadow-lg backdrop-blur-sm">
                <span className="text-cyan-400 text-[10px] font-bold uppercase tracking-widest">FUEL</span>
                <div className="w-24 h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.round(((stats.fuel ?? 100) / (stats.maxFuel ?? 100)) * 100)}%`,
                      backgroundColor: '#00e5ff',
                    }}
                  />
                </div>
                <span className="text-cyan-300 text-[10px] font-mono">{Math.round(stats.fuel ?? 100)}</span>
              </div>

              {/* Gold counter */}
              <div className="flex items-center gap-2 bg-slate-900/75 border border-slate-600/50 rounded-lg px-3 py-1 shadow-lg backdrop-blur-sm">
                <span className="text-yellow-400 text-[10px] font-bold uppercase tracking-widest">GOLD</span>
                <span className="text-yellow-300 text-[10px] font-mono font-bold">{Math.round(stats.gold ?? 0)}</span>
              </div>

              {stats.waveStatus === 'complete' ? (
                <div className="bg-yellow-500/20 border border-yellow-400/60 rounded-lg px-4 py-1.5 shadow-lg">
                  <span className="text-yellow-300 font-black text-sm tracking-widest">★ ALL WAVES CLEARED ★</span>
                </div>
              ) : (
                <div className="bg-slate-900/75 border border-slate-600/50 rounded-lg px-4 py-1.5 shadow-lg backdrop-blur-sm text-right">
                  <span className="text-slate-300 text-xs font-bold uppercase tracking-widest">
                    Wave {stats.waveNumber ?? 1} / {stats.waveTotal ?? '?'}
                  </span>
                  {stats.waveStatus === 'cleared' && (
                    <p className="text-emerald-400 text-[10px] font-bold mt-0.5 animate-pulse">
                      ▶ Collect the powerup
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Pause button */}
          {stats.gameState === GameState.PLAYING && (
            <button
              onClick={onPause}
              className="pointer-events-auto bg-slate-800/80 hover:bg-slate-700 text-white rounded-lg p-2.5 shadow-lg border border-slate-600/60 transition-all active:scale-95"
              aria-label="Pause"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Main Menu ── */}
      {stats.gameState === GameState.MENU && (
        <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center pointer-events-auto z-50">
          <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500 mb-8 tracking-tight drop-shadow-lg">
            OMNIVERSE
          </h1>
          <p className="text-slate-400 mb-12 max-w-md text-center leading-relaxed">
            Survive five waves of escalating enemies across an infinite universe.
          </p>
          <div className="mb-8 flex flex-col items-center gap-3">
            <span className="text-slate-200 text-sm tracking-wide">Difficulty</span>
            <div className="flex gap-2">
              {[0, 1, 2, 3].map(level => (
                <button
                  key={level}
                  onClick={() => onSetDifficulty && onSetDifficulty(level)}
                  className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${
                    difficulty === level
                      ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-indigo-400 hover:text-white'
                  }`}
                >
                  {level === 0 ? 'None' : level === 1 ? 'Low' : level === 2 ? 'Med' : 'High'}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={onStart}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xl font-bold py-4 px-12 rounded-full shadow-2xl transition-all transform hover:scale-105 active:scale-95"
          >
            START
          </button>
        </div>
      )}

      {/* ── Pause Menu ── */}
      {stats.gameState === GameState.PAUSED && (
        <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-md flex flex-col items-center justify-center pointer-events-auto z-50">
          <h2 className="text-4xl font-bold text-white mb-8 tracking-widest">PAUSED</h2>
          <div className="flex flex-col gap-4 w-56">
            <button
              onClick={onResume}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
              RESUME
            </button>
            <button
              onClick={onRestart}
              className="bg-slate-700 hover:bg-red-600 text-slate-200 hover:text-white font-bold py-3 px-6 rounded-lg shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 12" />
                <path d="M3 3v9h9" />
              </svg>
              RESTART
            </button>
          </div>
        </div>
      )}

      {/* ── Bottom Bar: Weapon Selector ── */}
      {stats.gameState === GameState.PLAYING && (
        <div className="flex items-end justify-end pointer-events-none">
          {(stats.weaponCount ?? 1) > 1 ? (
            <button
              onClick={onCycleWeapon}
              className="pointer-events-auto bg-slate-800/90 border-2 border-slate-600 hover:border-yellow-400 active:bg-slate-700 text-white rounded-full w-20 h-20 flex flex-col items-center justify-center shadow-2xl transition-all"
            >
              <span className="text-[9px] uppercase text-slate-400 tracking-widest font-bold">Weapon</span>
              <span className="text-xs font-bold text-yellow-400 mt-0.5 text-center leading-tight px-1">{stats.currentWeapon || 'Blaster'}</span>
            </button>
          ) : (
            <div className="bg-slate-800/50 border-2 border-slate-700/50 text-slate-600 rounded-full w-20 h-20 flex flex-col items-center justify-center shadow-2xl">
              <span className="text-[9px] uppercase tracking-widest font-bold">Weapon</span>
              <span className="text-xs font-bold mt-0.5 text-center leading-tight px-1">{stats.currentWeapon || 'Blaster'}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default UIOverlay;
