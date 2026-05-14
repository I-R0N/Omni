
import React from 'react';
import { EngineStats, MapType, GameState, TrailShape, TrailEmitMode } from '../types';

interface UIOverlayProps {
  stats: EngineStats;
  onCycleWeapon?: () => void;
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRestart?: () => void;
  onToggleDebug?: () => void;
  onToggleNebulaSet?: () => void;
  onCycleTrailShape?: () => void;
  onCycleTrailEmitMode?: () => void;
  onToggleLocalGravity?: () => void;
  onToggleAttractorGravity?: () => void;
  onToggleCollisions?: () => void;
  onCycleShardPairInterval?: () => void;
  onSkipWave?: () => void;
  difficulty?: number;
  onSetDifficulty?: (level: number) => void;
  mapType?: MapType;
  onSetMapType?: (type: MapType) => void;
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
  onCycleTrailShape,
  onCycleTrailEmitMode,
  onToggleLocalGravity,
  onToggleAttractorGravity,
  onToggleCollisions,
  onCycleShardPairInterval,
  onSkipWave,
  difficulty = 3,
  onSetDifficulty,
  mapType = MapType.UNIVERSE,
  onSetMapType,
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
                  title="Cycle ALL → A (baseline 00-08) → B (new art) → N16 (16 only)"
                >
                  {stats.nebulaSet === 'A'
                    ? 'A (baseline)'
                    : stats.nebulaSet === 'B'
                    ? 'B (new art)'
                    : stats.nebulaSet === 'N16'
                    ? 'N16 only'
                    : 'ALL'}
                </button>
              </div>

              {/* Player trail shape selector */}
              <div className="pointer-events-auto mt-1 flex items-center justify-between gap-1">
                <span className="text-slate-400/80 uppercase tracking-wider text-[8px]">Trail</span>
                <button
                  onClick={onCycleTrailShape}
                  className="bg-slate-800/70 border border-slate-600/60 rounded px-1.5 py-0.5 text-[8px] font-bold text-slate-200 hover:border-amber-400/70 hover:text-amber-300 transition-colors"
                  title="Cycle CIRCLE → SQUARE → TRIANGLE → LINE → PATH → DOTS → NONE"
                >
                  {stats.trailShape === TrailShape.SQUARE
                    ? 'Square'
                    : stats.trailShape === TrailShape.TRIANGLE
                    ? 'Triangle'
                    : stats.trailShape === TrailShape.LINE
                    ? 'Line'
                    : stats.trailShape === TrailShape.PATH
                    ? 'Path'
                    : stats.trailShape === TrailShape.DOTS
                    ? 'Dots'
                    : stats.trailShape === TrailShape.NONE
                    ? 'None'
                    : 'Circle'}
                </button>
              </div>

              {/* Trail direction — VELOCITY (extends opposite to velocity) vs THRUST (extends opposite to thrust input) */}
              <div className="pointer-events-auto mt-1 flex items-center justify-between gap-1">
                <span className="text-slate-400/80 uppercase tracking-wider text-[8px]">Dir</span>
                <button
                  onClick={onCycleTrailEmitMode}
                  className="bg-slate-800/70 border border-slate-600/60 rounded px-1.5 py-0.5 text-[8px] font-bold text-slate-200 hover:border-amber-400/70 hover:text-amber-300 transition-colors"
                  title="Toggle trail direction: VELOCITY (trail extends opposite to velocity) vs THRUST (trail extends opposite to thrust input)"
                >
                  {stats.trailEmitMode === TrailEmitMode.THRUST ? 'Thrust' : 'Velocity'}
                </button>
              </div>

              {/* Player↔asteroid local-gravity toggle — pure on/off so the
                  `lgrv` perf timer shows the isolated cost when off. */}
              <div className="pointer-events-auto mt-1 flex items-center justify-between gap-1">
                <span className="text-slate-400/80 uppercase tracking-wider text-[8px]">LGrav</span>
                <button
                  onClick={onToggleLocalGravity}
                  className="bg-slate-800/70 border border-slate-600/60 rounded px-1.5 py-0.5 text-[8px] font-bold text-slate-200 hover:border-amber-400/70 hover:text-amber-300 transition-colors"
                  title="Toggle player↔asteroid local-gravity scan (PhysicsSystem.applyLocalGravity)"
                >
                  {stats.localGravityEnabled === false ? 'Off' : 'On'}
                </button>
              </div>

              {/* POI / attractor gravity toggle — gates PhysicsSystem.applyGravity.
                  When off the master-list outer loop is skipped and the `grav`
                  perf timer drops to zero. */}
              <div className="pointer-events-auto mt-1 flex items-center justify-between gap-1">
                <span className="text-slate-400/80 uppercase tracking-wider text-[8px]">Grav</span>
                <button
                  onClick={onToggleAttractorGravity}
                  className="bg-slate-800/70 border border-slate-600/60 rounded px-1.5 py-0.5 text-[8px] font-bold text-slate-200 hover:border-amber-400/70 hover:text-amber-300 transition-colors"
                  title="Toggle attractor gravity scan (PhysicsSystem.applyGravity).  Outer loop walks the master entity list each frame."
                >
                  {stats.attractorGravityEnabled === false ? 'Off' : 'On'}
                </button>
              </div>

              {/* SAT collision broadphase toggle — gates handleEntityCollisions.
                  Off mode is GAME-BREAKING (projectiles fly through, tiles
                  inert) — strictly for measuring isolated cost in the `coll`
                  perf timer. */}
              <div className="pointer-events-auto mt-1 flex items-center justify-between gap-1">
                <span className="text-slate-400/80 uppercase tracking-wider text-[8px]">Coll</span>
                <button
                  onClick={onToggleCollisions}
                  className="bg-slate-800/70 border border-slate-600/60 rounded px-1.5 py-0.5 text-[8px] font-bold text-slate-200 hover:border-amber-400/70 hover:text-amber-300 transition-colors"
                  title="Toggle SAT collision broadphase.  OFF is game-breaking — measurement aid only."
                >
                  {stats.collisionsEnabled === false ? 'Off' : 'On'}
                </button>
              </div>

              {/* Shard ↔ shard pair-resolution interval — cycle
                  AUTO → 1 → 2 → 4 → 8 → 16 → 32 → 64 → 128 → 256 →
                  512 → 1028.  AUTO scales N with the previous step's
                  peak shard-cell density; manual values pin the
                  interval.  Higher N = cheaper but shards may
                  overlap visibly for longer before separating. */}
              <div className="pointer-events-auto mt-1 flex items-center justify-between gap-1">
                <span className="text-slate-400/80 uppercase tracking-wider text-[8px]">ShPair</span>
                <button
                  onClick={onCycleShardPairInterval}
                  className="bg-slate-800/70 border border-slate-600/60 rounded px-1.5 py-0.5 text-[8px] font-bold text-slate-200 hover:border-amber-400/70 hover:text-amber-300 transition-colors"
                  title="Cycle shard-pair resolution interval.  AUTO scales N with shard-cell density; manual pins it.  Higher = cheaper but laggier separation."
                >
                  {stats.shardPairInterval === 0
                    ? `auto (${stats.shardPairEffectiveInterval ?? 1})`
                    : `every ${stats.shardPairInterval ?? 1}`}
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
                  <div className="flex justify-between"><span>updPhys</span><span className="text-white">{fmtMs(perf.updatePhysicsMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·physics</span><span className="text-white">{fmtMs(perf.physicsMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;&nbsp;·grav</span><span className="text-white">{fmtMs(perf.gravityMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;&nbsp;·lgrv</span><span className="text-white">{fmtMs(perf.localGravityMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;&nbsp;·coll</span><span className="text-white">{fmtMs(perf.collisionsMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·ai</span><span className="text-white">{fmtMs(perf.aiMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·flow</span><span className="text-white">{fmtMs(perf.flowFieldMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·misc</span><span className="text-white">{fmtMs(perf.physMiscMs)}</span></div>
                  <div className="flex justify-between"><span>updLogic</span><span className="text-white">{fmtMs(perf.updateLogicMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·shards</span><span className="text-white">{fmtMs(perf.shardSysMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·rings</span><span className="text-white">{fmtMs(perf.explosionRingsMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·weapons</span><span className="text-white">{fmtMs(perf.weaponsMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·drops</span><span className="text-white">{fmtMs(perf.dropsMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·homing</span><span className="text-white">{fmtMs(perf.homingMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·lightn</span><span className="text-white">{fmtMs(perf.lightningMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·misc</span><span className="text-white">{fmtMs(perf.logicMiscMs)}</span></div>
                  <div className="flex justify-between"><span>render</span><span className="text-white">{fmtMs(perf.renderMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·neb</span><span className="text-white">{fmtMs(perf.nebulaMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·vis-neb</span><span className="text-white">{perf.nebulaVisible}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·neb fast/slow</span><span className="text-white">{perf.nebulaFast}/{perf.nebulaSlow}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·tLit</span><span className="text-white">{fmtMs(perf.tileLightingMs)}</span></div>
                  <div className="flex justify-between"><span>&nbsp;·tLit-N</span><span className="text-white">{perf.tileLightingCount}</span></div>
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
          <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500 mb-2 tracking-tight drop-shadow-lg">
            OMNIVERSE
          </h1>
          {/* Build version — short git SHA + UTC build time, baked in at
              build time by vite.config.ts.  Lets you tell at a glance
              whether a deployed preview is running the latest commit. */}
          <div className="mb-8 font-mono text-[10px] tracking-widest text-slate-500">
            build {__APP_VERSION__} · {__BUILD_TIME__.slice(0, 16).replace('T', ' ')}Z
          </div>
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
          <div className="mb-8 flex flex-col items-center gap-3">
            <span className="text-slate-200 text-sm tracking-wide">Map</span>
            <div className="flex flex-wrap justify-center gap-2 max-w-xl">
              {[
                { type: MapType.UNIVERSE,             label: 'Deep Space' },
                { type: MapType.RING,                 label: 'Ring World' },
                { type: MapType.SEVEN_RINGS,          label: 'Seven Rings' },
                { type: MapType.POCKET,               label: 'Pocket' },
                { type: MapType.ASTEROID_FIELD,       label: 'Asteroid Field' },
                { type: MapType.GLASS_FIELD,          label: 'Glass Field' },
                { type: MapType.PLASTIC_FIELD,        label: 'Plastic Field' },
                { type: MapType.METAL_FIELD,          label: 'Metal Field' },
                { type: MapType.INDESTRUCTIBLE_FIELD, label: 'Indestructible' },
                { type: MapType.NEBULA_FIELD,         label: 'Nebula Field' },
                { type: MapType.ROCK_FIELD,           label: 'Rock Field' },
                { type: MapType.TILE_HEAVY,           label: 'Tile Heavy' },
              ].map(opt => (
                <button
                  key={opt.type}
                  onClick={() => onSetMapType && onSetMapType(opt.type)}
                  className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${
                    mapType === opt.type
                      ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-indigo-400 hover:text-white'
                  }`}
                >
                  {opt.label}
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
