
import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from './engine/GameEngine';
import { EngineStats, MapType, GameState } from './types';
import UIOverlay from './components/UIOverlay';
import MultiplayerMenu from './components/MultiplayerMenu';

const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  
  const [stats, setStats] = useState<EngineStats>({
    fps: 0,
    entityCount: 0,
    currentMapName: 'Initializing',
    currentMapType: MapType.UNIVERSE,
    currentWeapon: 'Blaster',
    gameState: GameState.MENU,
    difficulty: 3
  });
  const [difficulty, setDifficulty] = useState<number>(3);
  const [showMultiplayer, setShowMultiplayer] = useState<boolean>(false);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Initialize Engine
    const engine = new GameEngine((newStats) => {
        setStats(newStats);
    }, difficulty);

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

  const handleSkipWave = () => {
      if (engineRef.current) engineRef.current.skipWave();
  };

  const handleOpenMultiplayer = () => {
      setShowMultiplayer(true);
  };

  const handleCloseMultiplayer = () => {
      setShowMultiplayer(false);
  };

  const handleSessionStart = (_kind: 'host' | 'client') => {
      // Session established by the menu — close the modal so gameplay is visible.
      // HostSession / ClientSession own their own lifecycle from here; they call
      // engine.startMultiplayerGame() on transport open.
      setShowMultiplayer(false);
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
        onSkipWave={handleSkipWave}
        difficulty={difficulty}
        onSetDifficulty={handleSetDifficulty}
        onOpenMultiplayer={handleOpenMultiplayer}
      />
      {showMultiplayer && engineRef.current && (
        <MultiplayerMenu
          engine={engineRef.current}
          onClose={handleCloseMultiplayer}
          onSessionStart={handleSessionStart}
        />
      )}
    </div>
  );
};

export default App;
