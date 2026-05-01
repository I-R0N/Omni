
import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from './engine/GameEngine';
import { EngineStats, MapType, GameState } from './types';
import UIOverlay from './components/UIOverlay';
import { VIBE_JAM_MODE, JAM_DIFFICULTY } from './vibejam';

const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  // Vibe Jam build skips the menu, so seed initial difficulty and the
  // initial gameState directly to the in-game values.
  const initialDifficulty = VIBE_JAM_MODE ? JAM_DIFFICULTY : 3;
  const initialGameState  = VIBE_JAM_MODE ? GameState.PLAYING : GameState.MENU;

  const [stats, setStats] = useState<EngineStats>({
    fps: 0,
    entityCount: 0,
    currentMapName: 'Initializing',
    currentMapType: MapType.UNIVERSE,
    currentWeapon: 'Blaster',
    gameState: initialGameState,
    difficulty: initialDifficulty,
  });
  const [difficulty, setDifficulty] = useState<number>(initialDifficulty);
  const [mapType, setMapType] = useState<MapType>(MapType.UNIVERSE);
  // Mirror difficulty into a ref so the one-shot mount effect below can
  // read the latest value without closing over stale state.
  const difficultyRef = useRef(difficulty);
  difficultyRef.current = difficulty;

  useEffect(() => {
    if (!canvasRef.current) return;

    // Initialize Engine
    const engine = new GameEngine((newStats) => {
        setStats(newStats);
    }, difficultyRef.current);

    const handleResize = () => {
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const dpr = window.devicePixelRatio || 1;
        const width = window.innerWidth;
        const height = window.innerHeight;

        // Match CSS size
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        // Set internal resolution for HiDPI displays
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);

        // Reset transform before scaling
        const context = canvas.getContext('2d');
        if (context) {
          context.setTransform(1, 0, 0, 1, 0, 0);
          context.scale(dpr, dpr);
        }
      }
    };

    const ctx = canvasRef.current.getContext('2d')!;
    engine.initCanvas(ctx);
    handleResize(); // Set initial size before first frame
    engine.start();
    engineRef.current = engine;

    // Vibe Jam build: drop straight into the arena without a menu.
    if (VIBE_JAM_MODE) {
      engine.startGame();
    }

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      engine.stop();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const handleCycleWeapon = () => {
      if (engineRef.current) {
          engineRef.current.cycleWeapon();
      }
  };

  const handleStart = () => {
      if (engineRef.current) engineRef.current.startGame();
  };

  const handlePause = () => {
      if (engineRef.current) engineRef.current.pauseGame();
  };

  const handleResume = () => {
      if (engineRef.current) engineRef.current.resumeGame();
  };

  const handleRestart = () => {
      if (engineRef.current) engineRef.current.restartGame();
  };

  const handleSetDifficulty = (level: number) => {
      setDifficulty(level);
      if (engineRef.current) {
          engineRef.current.setDifficulty(level);
      }
  };

  const handleToggleDebug = () => {
      if (engineRef.current) engineRef.current.toggleDebug();
  };

  const handleSetMapType = (type: MapType) => {
      setMapType(type);
      if (engineRef.current) engineRef.current.setMapType(type);
  };

  const handleToggleNebulaSet = () => {
      if (engineRef.current) engineRef.current.toggleNebulaSet();
  };

  const handleCycleTrailShape = () => {
      if (engineRef.current) engineRef.current.cycleTrailShape();
  };

  const handleCycleTrailEmitMode = () => {
      if (engineRef.current) engineRef.current.cycleTrailEmitMode();
  };

  const handleSkipWave = () => {
      if (engineRef.current) engineRef.current.skipWave();
  };

  const handleConfirmJamPortal = () => {
      if (engineRef.current) engineRef.current.confirmJamPortal();
  };

  const handleCancelJamPortal = () => {
      if (engineRef.current) engineRef.current.cancelJamPortal();
  };

  return (
    <div className="relative w-full h-screen bg-slate-950 overflow-hidden select-none">
      <canvas 
        ref={canvasRef} 
        className="block w-full h-full"
      />
      <UIOverlay
        stats={stats}
        onCycleWeapon={handleCycleWeapon}
        onStart={handleStart}
        onPause={handlePause}
        onResume={handleResume}
        onRestart={handleRestart}
        onToggleDebug={handleToggleDebug}
        onToggleNebulaSet={handleToggleNebulaSet}
        onCycleTrailShape={handleCycleTrailShape}
        onCycleTrailEmitMode={handleCycleTrailEmitMode}
        onSkipWave={handleSkipWave}
        onConfirmJamPortal={handleConfirmJamPortal}
        onCancelJamPortal={handleCancelJamPortal}
        difficulty={difficulty}
        onSetDifficulty={handleSetDifficulty}
        mapType={mapType}
        onSetMapType={handleSetMapType}
      />
    </div>
  );
};

export default App;
