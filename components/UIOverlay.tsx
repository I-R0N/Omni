
import React from 'react';
import { EngineStats, MapType, GameState } from '../types';

interface UIOverlayProps {
  stats: EngineStats;
  onCycleWeapon?: () => void;
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRestart?: () => void;
  difficulty?: number;
  onSetDifficulty?: (level: number) => void;
}

const UIOverlay: React.FC<UIOverlayProps> = ({ stats, onCycleWeapon, onStart, onPause, onResume, onRestart, difficulty = 3, onSetDifficulty }) => {
  const getBadgeColor = (type: MapType) => {
    switch(type) {
        case MapType.UNIVERSE: return 'bg-indigo-600 text-indigo-100';
        case MapType.SOLAR_SYSTEM: return 'bg-blue-600 text-blue-100';
        case MapType.LOCAL: return 'bg-emerald-600 text-emerald-100';
        case MapType.SUB_MAP: return 'bg-amber-600 text-amber-100';
        default: return 'bg-gray-600';
    }
  };

  return (
    <div className="absolute inset-0 pointer-events-none p-4 flex flex-col justify-between">
      {/* Top Bar */}
      <div className="flex justify-between items-start pointer-events-auto">
        <div className="text-sm text-slate-300 font-bold shadow-lg pointer-events-none">
          <h1 className="text-white mb-1 text-lg drop-shadow-md">OmniVerse Engine</h1>
          <div className="space-y-1 drop-shadow-md">
            <p>FPS: <span className="font-mono text-white">{stats.fps}</span></p>
            <p>Entities: <span className="font-mono text-white">{stats.entityCount}</span></p>
          </div>
        </div>

        <div className="flex items-start gap-4">
            <div className="flex flex-col items-end gap-2 pointer-events-none">
                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider shadow-md ${getBadgeColor(stats.currentMapType)}`}>
                    {stats.currentMapType.replace('_', ' ')}
                </span>
                <div className="bg-slate-900/80 px-4 py-2 rounded-lg border border-slate-700 text-slate-200 shadow-lg backdrop-blur-sm">
                    {stats.currentMapName}
                </div>
            </div>
            
            {/* Pause Button */}
            {stats.gameState === GameState.PLAYING && (
                <button 
                    onClick={onPause}
                    className="bg-slate-800 hover:bg-slate-700 text-white rounded-lg p-3 shadow-lg border border-slate-600 pointer-events-auto transition-all active:scale-95"
                    aria-label="Pause Game"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="4" width="4" height="16" rx="1" />
                        <rect x="14" y="4" width="4" height="16" rx="1" />
                    </svg>
                </button>
            )}
        </div>
      </div>

      {/* Main Menu Overlay */}
      {stats.gameState === GameState.MENU && (
        <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center pointer-events-auto z-50">
            <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500 mb-8 tracking-tight drop-shadow-lg">
                OMNIVERSE
            </h1>
            <p className="text-slate-400 mb-12 max-w-md text-center leading-relaxed">
                Explore an infinite procedural universe. From galaxies to surface caves.
            </p>
            <div className="mb-8 flex flex-col items-center gap-3">
                <span className="text-slate-200 text-sm tracking-wide">Difficulty</span>
                <div className="flex gap-2">
                    {[0,1,2,3].map(level => (
                        <button
                          key={level}
                          onClick={() => onSetDifficulty && onSetDifficulty(level)}
                          className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${difficulty === level ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg' : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-indigo-400 hover:text-white'}`}
                        >
                          {level}: {level === 0 ? 'None' : level === 1 ? 'Low' : level === 2 ? 'Moderate' : 'High'}
                        </button>
                    ))}
                </div>
                <p className="text-[11px] text-slate-500">Enemy count scales with difficulty (3 = current default).</p>
            </div>
            <button 
                onClick={onStart}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xl font-bold py-4 px-12 rounded-full shadow-2xl transition-all transform hover:scale-105 active:scale-95"
            >
                START ENGINE
            </button>
        </div>
      )}

      {/* Pause Menu Overlay */}
      {stats.gameState === GameState.PAUSED && (
        <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-md flex flex-col items-center justify-center pointer-events-auto z-50">
            <h2 className="text-4xl font-bold text-white mb-8 tracking-widest">PAUSED</h2>
            <div className="flex flex-col gap-4 w-64">
                <button 
                    onClick={onResume}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z"/>
                    </svg>
                    RESUME
                </button>
                <button 
                    onClick={onRestart}
                    className="bg-slate-700 hover:bg-red-600 text-slate-200 hover:text-white font-bold py-3 px-6 rounded-lg shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 12" />
                        <path d="M3 3v9h9" />
                    </svg>
                    RESTART
                </button>
            </div>
        </div>
      )}

      {/* Bottom Bar / Weapon Selector (Hidden in Menus) */}
      {stats.gameState === GameState.PLAYING && (
        <div className="flex items-end justify-center relative pointer-events-none">
            {/* Weapon Selector */}
            <div className="absolute right-0 bottom-4 pointer-events-auto">
                <button 
                    onClick={onCycleWeapon}
                    className="bg-slate-800/90 border-2 border-slate-600 hover:border-yellow-400 active:bg-slate-700 text-white rounded-full w-24 h-24 flex flex-col items-center justify-center shadow-2xl transition-all"
                >
                    <span className="text-[10px] uppercase text-slate-400 tracking-widest font-bold">Weapon</span>
                    <span className="text-sm font-bold text-yellow-400 mt-1">{stats.currentWeapon || 'Blaster'}</span>
                    <span className="text-[10px] text-slate-500 mt-1">Tap to Cycle</span>
                </button>
            </div>
        </div>
      )}
    </div>
  );
};

export default UIOverlay;
