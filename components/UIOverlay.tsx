
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
  onToggleNebulaSet?: () => void;
  onSkipWave?: () => void;
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
  onToggleNebulaSet,
  onSkipWave,
  difficulty = 3,
  onSetDifficulty,
}) => {
  const isGrace = stats.waveStatus === 'cleared' && (stats.waveGraceTimer ?? 0) > 0;
  const perf = stats.perf;
  // Two-digit ms formatter for the perf overlay.  Values under 10 ms get a
  // decimal so sub-millisecond jitter is still visible; bigger numbers
  // collapse to whole ms so the grid stays compact.
  const fmtMs = (ms: number | undefined): string => {
    if (ms === undefined) return '—';
    if (ms < 10) return ms.toFixed(2);
    return ms.toFixed(1);
  };
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

          {/* Debug info + perf instrumentation panel.  Shown only while
              debug mode is active (DBG button).  Deliberately small and
              semi-transparent (~35% bg opacity, 8-9 px font, tight leading)
              so it never hides the player ship while dev stats stream. */}
          {stats.debugMode && (
            <div className="pointer-events-none bg-slate-900/35 border border-amber-500/30 rounded px-1.5 py-1 text-[9px] leading-tight font-mono text-slate-300/90 min-w-[132px]">
              <div className="text-amber-400/90 font-bold tracking-wider text-[8px]">DEBUG</div>

              {/* Nebula-set A/B toggle — compares Nebula00-08 vs Nebula09-16 */}
              <div className="pointer-events-auto mt-1 flex items-center justify-between gap-1">
                <span className="text-slate-400/80 uppercase tracking-wider text-[8px]">Nebulas</span>
                <button
                  onClick={onToggleNebulaSet}
                  className="bg-slate-800/70 border border-slate-600/60 rounded px-1.5 py-0.5 text-[8px] font-bold text-slate-200 hover:border-amber-400/70 hover:text-amber-300 transition-colors"
                  title="Cycle A (00-08) → B (09-17) → ALL (00-17) → N16 (16 only)"
                >
                  {stats.nebulaSet === 'B'
                    ? 'B (09-17)'
                    : stats.nebulaSet === 'ALL'
                    ? 'ALL (00-17)'
                    : stats.nebulaSet === 'N16'
                    ? 'N16 (16 only)'
                    : 'A (00-08)'}
                </button>
              </div>

              <div className="flex justify-between"><span>FPS</span><span className="text-white">{stats.fps}</span></div>
              <div className="flex justify-between"><span>Wave</span><span className="text-white">{stats.waveNumber ?? 1}</span></div>
              <div className="flex justify-between"><span>State</span><span className="text-white">{stats.waveStatus ?? '—'}</span></div>
              {perf ? (
                <>
                  <div className="mt-1 text-slate-400/80 uppercase tracking-wider text-[8px]">Entities</div>
                  <div className="flex justify-between"><span>total</span><span className="text-white">{perf.totalEntities}</span></div>
                  <div className="flex justify-between"><span>enemies</span><span className="text-white">{perf.enemyCount}</span></div>
                  <div className="flex justify-between"><span>asteroids</span><span className="text-white">{perf.asteroidCount}</span></div>
                  <div className="flex justify-between"><span>projectiles</span><span className="text-white">{perf.projectileCount}</span></div>
                  <div className="flex justify-between"><span>particles</span><span className="text-white">{perf.particleCount}</span></div>
                  <div className="flex justify-between"><span>drops/POI</span><span className="text-white">{perf.interactableCount}</span></div>
                  <div className="mt-1 text-slate-400/80 uppercase tracking-wider text-[8px]">Broadphase</div>
                  <div className="flex justify-between"><span>max cell</span><span className={perf.maxCellDensity >= 20 ? 'text-red-400' : perf.maxCellDensity >= 10 ? 'text-amber-300' : 'text-white'}>{perf.maxCellDensity}</span></div>
                  <div className="mt-1 text-slate-400/80 uppercase tracking-wider text-[8px]">Timing (ms)</div>
                  <div className="flex justify-between"><span>physics</span><span className="text-white">{fmtMs(perf.physicsMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·grav</span><span className="text-white">{fmtMs(perf.gravityMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·lgrv</span><span className="text-white">{fmtMs(perf.localGravityMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·coll</span><span className="text-white">{fmtMs(perf.collisionsMs)}</span></div>
                  <div className="flex justify-between"><span>ai</span><span className="text-white">{fmtMs(perf.aiMs)}</span></div>
                  <div className="flex justify-between"><span>homing</span><span className="text-white">{fmtMs(perf.homingMs)}</span></div>
                  <div className="flex justify-between"><span>lightn</span><span className="text-white">{fmtMs(perf.lightningMs)}</span></div>
                  <div className="flex justify-between"><span>flow</span><span className="text-white">{fmtMs(perf.flowFieldMs)}</span></div>
                  <div className="flex justify-between"><span>render</span><span className="text-white">{fmtMs(perf.renderMs)}</span></div>
                </>
              ) : (
                <div className="flex justify-between"><span>Ents</span><span className="text-white">{stats.entityCount}</span></div>
              )}
            </div>
          )}
        </div>

        {/* Top-right: wave HUD + pause button */}
        <div className="flex items-start gap-3">

          {/* Wave info — only while playing */}
          {stats.gameState === GameState.PLAYING && (
            <div className="flex flex-col items-end gap-1">
              <div
                onClick={isGrace ? onSkipWave : undefined}
                className={`bg-slate-900/75 border rounded-lg px-4 py-1.5 shadow-lg backdrop-blur-sm text-right transition-all ${
                  isGrace
                    ? 'pointer-events-auto border-emerald-500/60 cursor-pointer hover:bg-emerald-900/40 active:scale-95'
                    : 'pointer-events-none border-slate-600/50'
                }`}
              >
                <span className="text-slate-300 text-xs font-bold uppercase tracking-widest">
                  Wave {stats.waveNumber ?? 1}
                </span>
                {isGrace && (
                  <p className="text-emerald-400 text-[10px] font-bold mt-0.5 animate-pulse">
                    Next in {stats.waveGraceTimer}s · tap to skip
                  </p>
                )}
              </div>
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
            Survive endless waves of escalating enemies across an infinite universe.
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

    </div>
  );
};

export default UIOverlay;
