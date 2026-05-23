
import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from './engine/GameEngine';
import { EngineStats, MapType, GameState } from './types';
import UIOverlay from './components/UIOverlay';

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

  const handleCycleTrailShape = () => {
      if (engineRef.current) engineRef.current.cycleTrailShape();
  };

  const handleCycleTrailEmitMode = () => {
      if (engineRef.current) engineRef.current.cycleTrailEmitMode();
  };

  const handleToggleLocalGravity = () => {
      if (engineRef.current) engineRef.current.toggleLocalGravity();
  };

  const handleToggleAttractorGravity = () => {
      if (engineRef.current) engineRef.current.toggleAttractorGravity();
  };

  const handleToggleCollisions = () => {
      if (engineRef.current) engineRef.current.toggleCollisions();
  };

  const handleToggleShardTileCollisions = () => {
      if (engineRef.current) engineRef.current.toggleShardTileCollisions();
  };

  const handleCycleShardPairInterval = () => {
      if (engineRef.current) engineRef.current.cycleShardPairInterval();
  };

  const handleCycleShardTilePairInterval = () => {
      if (engineRef.current) engineRef.current.cycleShardTilePairInterval();
  };

  const handleTogglePerfAuto = () => {
      if (engineRef.current) engineRef.current.togglePerfAuto();
  };

  const handleToggleShardGravity = () => {
      if (engineRef.current) engineRef.current.toggleShardGravity();
  };

  const handleToggleShardBonding = () => {
      if (engineRef.current) engineRef.current.toggleShardBonding();
  };

  const handleToggleNebulaShardCollisions = () => {
      if (engineRef.current) engineRef.current.toggleNebulaShardCollisions();
  };

  const handleToggleShardSleep = () => {
      if (engineRef.current) engineRef.current.toggleShardSleep();
  };

  const handleToggleShardViewportCull = () => {
      if (engineRef.current) engineRef.current.toggleShardViewportCull();
  };

  const handleToggleShardLod = () => {
      if (engineRef.current) engineRef.current.toggleShardLod();
  };

  const handleToggleMergeRate = () => {
      if (engineRef.current) engineRef.current.toggleMergeRate();
  };

  const handleToggleScreenShake = () => {
      if (engineRef.current) engineRef.current.toggleScreenShake();
  };

  const handleToggleTileOutlines = () => {
      if (engineRef.current) engineRef.current.toggleTileOutlines();
  };

  const handleTogglePlasticAutomata = () => {
      if (engineRef.current) engineRef.current.togglePlasticAutomata();
  };

  const handleTogglePlasticAutomataDirection = () => {
      if (engineRef.current) engineRef.current.togglePlasticAutomataDirection();
  };

  const handleCyclePlasticEatAttract = () => {
      if (engineRef.current) engineRef.current.cyclePlasticEatAttract();
  };

  const handleTogglePlasticReach = () => {
      if (engineRef.current) engineRef.current.togglePlasticReach();
  };

  const handleCyclePlasticPalette = () => {
      if (engineRef.current) engineRef.current.cyclePlasticPalette();
  };

  const handleCyclePlasticBlendMode = () => {
      if (engineRef.current) engineRef.current.cyclePlasticBlendMode();
  };

  const handleTogglePlasticBlend = () => {
      if (engineRef.current) engineRef.current.togglePlasticBlend();
  };

  const handleCycleNebulaStretch = () => {
      if (engineRef.current) engineRef.current.cycleNebulaStretch();
  };

  const handleCyclePlasticOpacity = () => {
      if (engineRef.current) engineRef.current.cyclePlasticOpacity();
  };

  const handleCyclePlasticCoreRadius = () => {
      if (engineRef.current) engineRef.current.cyclePlasticCoreRadius();
  };

  const handleCyclePlasticBlendRadius = () => {
      if (engineRef.current) engineRef.current.cyclePlasticBlendRadius();
  };

  const handleCyclePlasticYield = () => {
      if (engineRef.current) engineRef.current.cyclePlasticYield();
  };

  const handleCyclePlasticStiffness = () => {
      if (engineRef.current) engineRef.current.cyclePlasticStiffness();
  };

  const handleCyclePlasticDamping = () => {
      if (engineRef.current) engineRef.current.cyclePlasticDamping();
  };

  const handleCyclePlasticImpactCooldown = () => {
      if (engineRef.current) engineRef.current.cyclePlasticImpactCooldown();
  };

  const handleCycleTileBlendAlpha = () => {
      if (engineRef.current) engineRef.current.cycleTileBlendAlpha();
  };

  const handleCycleShardBlendAlpha = () => {
      if (engineRef.current) engineRef.current.cycleShardBlendAlpha();
  };

  const handleCycleColorBlendInterval = () => {
      if (engineRef.current) engineRef.current.cycleColorBlendInterval();
  };

  const handleSkipWave = () => {
      if (engineRef.current) engineRef.current.skipWave();
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
        onCycleTrailShape={handleCycleTrailShape}
        onCycleTrailEmitMode={handleCycleTrailEmitMode}
        onToggleLocalGravity={handleToggleLocalGravity}
        onToggleAttractorGravity={handleToggleAttractorGravity}
        onToggleCollisions={handleToggleCollisions}
        onToggleShardTileCollisions={handleToggleShardTileCollisions}
        onCycleShardPairInterval={handleCycleShardPairInterval}
        onCycleShardTilePairInterval={handleCycleShardTilePairInterval}
        onTogglePerfAuto={handleTogglePerfAuto}
        onToggleShardGravity={handleToggleShardGravity}
        onToggleShardBonding={handleToggleShardBonding}
        onToggleNebulaShardCollisions={handleToggleNebulaShardCollisions}
        onToggleShardSleep={handleToggleShardSleep}
        onToggleShardViewportCull={handleToggleShardViewportCull}
        onToggleShardLod={handleToggleShardLod}
        onToggleMergeRate={handleToggleMergeRate}
        onToggleScreenShake={handleToggleScreenShake}
        onToggleTileOutlines={handleToggleTileOutlines}
        onTogglePlasticAutomata={handleTogglePlasticAutomata}
        onTogglePlasticAutomataDirection={handleTogglePlasticAutomataDirection}
        onCyclePlasticEatAttract={handleCyclePlasticEatAttract}
        onTogglePlasticReach={handleTogglePlasticReach}
        onCyclePlasticPalette={handleCyclePlasticPalette}
        onCyclePlasticBlendMode={handleCyclePlasticBlendMode}
        onTogglePlasticBlend={handleTogglePlasticBlend}
        onCycleNebulaStretch={handleCycleNebulaStretch}
        onCyclePlasticOpacity={handleCyclePlasticOpacity}
        onCyclePlasticCoreRadius={handleCyclePlasticCoreRadius}
        onCyclePlasticBlendRadius={handleCyclePlasticBlendRadius}
        onCyclePlasticYield={handleCyclePlasticYield}
        onCyclePlasticStiffness={handleCyclePlasticStiffness}
        onCyclePlasticDamping={handleCyclePlasticDamping}
        onCyclePlasticImpactCooldown={handleCyclePlasticImpactCooldown}
        onCycleTileBlendAlpha={handleCycleTileBlendAlpha}
        onCycleShardBlendAlpha={handleCycleShardBlendAlpha}
        onCycleColorBlendInterval={handleCycleColorBlendInterval}
        onSkipWave={handleSkipWave}
        difficulty={difficulty}
        onSetDifficulty={handleSetDifficulty}
        mapType={mapType}
        onSetMapType={handleSetMapType}
      />
    </div>
  );
};

export default App;
