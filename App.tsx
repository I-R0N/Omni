
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

  const handleSetForcedEnemy = (subtype: string | null) => {
      if (engineRef.current) engineRef.current.setForcedTestEnemy(subtype);
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

  const handleTogglePlayerNebulaCollision = () => {
      if (engineRef.current) engineRef.current.togglePlayerNebulaCollision();
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

  const handleToggleChevronMode = () => {
      if (engineRef.current) engineRef.current.toggleChevronMode();
  };

  const handleToggleRepelPush = () => {
      if (engineRef.current) engineRef.current.toggleRepelPush();
  };

  const handleTogglePlasticAutomata = () => {
      if (engineRef.current) engineRef.current.togglePlasticAutomata();
  };

  const handleTogglePlasticAutomataDirection = () => {
      if (engineRef.current) engineRef.current.togglePlasticAutomataDirection();
  };

  const handleToggleMaterialAutomata = () => {
      if (engineRef.current) engineRef.current.toggleMaterialAutomata();
  };

  const handleCyclePlasticPalette = () => {
      if (engineRef.current) engineRef.current.cyclePlasticPalette();
  };

  const handleCyclePlasticShardPalette = () => {
      if (engineRef.current) engineRef.current.cyclePlasticShardPalette();
  };

  const handleCyclePlasticGlowBrightness = () => {
      if (engineRef.current) engineRef.current.cyclePlasticGlowBrightness();
  };

  const handleCycleMetalGlowBrightness = () => {
      if (engineRef.current) engineRef.current.cycleMetalGlowBrightness();
  };

  const handleCycleGlassGlowColor = () => {
      if (engineRef.current) engineRef.current.cycleGlassGlowColor();
  };

  const handleCycleMetalGlowColor = () => {
      if (engineRef.current) engineRef.current.cycleMetalGlowColor();
  };

  const handleCycleNebulaPalette = () => {
      if (engineRef.current) engineRef.current.cycleNebulaPalette();
  };

  const handleTogglePlasticBlend = () => {
      if (engineRef.current) engineRef.current.togglePlasticBlend();
  };

  const handleCycleNebulaStretch = () => {
      if (engineRef.current) engineRef.current.cycleNebulaStretch();
  };

  const handleCycleShatterGrace = () => {
      if (engineRef.current) engineRef.current.cycleShatterGrace();
  };

  const handleCyclePlayerThrust = () => {
      if (engineRef.current) engineRef.current.cyclePlayerThrust();
  };

  const handleCyclePlayerSpeed = () => {
      if (engineRef.current) engineRef.current.cyclePlayerSpeed();
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

  const handleToggleAsteroidFlow = () => {
      if (engineRef.current) engineRef.current.toggleAsteroidFlow();
  };

  const handleToggleSnitchCatchMode = () => {
      if (engineRef.current) engineRef.current.toggleSnitchCatchMode();
  };

  const handleCycleSnitchSpeed = () => {
      if (engineRef.current) engineRef.current.cycleSnitchSpeed();
  };

  const handleCycleEnemyScale = () => {
      if (engineRef.current) engineRef.current.cycleEnemyScale();
  };

  const handleCycleSwarmMove = () => {
      if (engineRef.current) engineRef.current.cycleSwarmMove();
  };

  const handleApplyCorrosion = () => {
      if (engineRef.current) engineRef.current.debugApplyCorrosion();
  };

  const handleApplyDisable = () => {
      if (engineRef.current) engineRef.current.debugApplyDisable();
  };

  const handleToggleTraits = () => {
      if (engineRef.current) engineRef.current.toggleTraits();
  };

  const handleCycleUpgrade = (id: string) => {
      if (engineRef.current) engineRef.current.cycleUpgrade(id as any);
  };

  const handleMaxUpgrades = () => {
      if (engineRef.current) engineRef.current.maxAllUpgrades();
  };

  const handleResetUpgrades = () => {
      if (engineRef.current) engineRef.current.resetUpgrades();
  };

  const handleAddCredits = () => {
      if (engineRef.current) engineRef.current.addDebugCredits(1000);
  };

  const handleSpawnDragon = (type: string) => {
      if (engineRef.current) engineRef.current.debugSpawnDragon(type);
  };

  const handleSpawnRival = (disposition: string) => {
      if (engineRef.current) engineRef.current.debugSpawnRival(disposition);
  };

  const handlePerfRecToggle = () => {
      if (engineRef.current) engineRef.current.perfRecToggle();
  };
  const handlePerfRecCycleScene = () => {
      if (engineRef.current) engineRef.current.perfRecCycleScene();
  };
  const handlePerfRecExport = (): string => {
      return engineRef.current ? engineRef.current.perfRecExport() : '';
  };

  const handlePurchaseUnlock = (id: string) => {
      if (engineRef.current) engineRef.current.purchaseUnlock(id);
  };

  const handleEquipWeapon = (slot: number, weaponId: string | null) => {
      if (engineRef.current) engineRef.current.equipWeapon(slot, weaponId);
  };

  const handlePurchaseUpgrade = (id: string) => {
      if (engineRef.current) engineRef.current.purchaseUpgrade(id);
  };

  const handleUnlockAll = () => {
      if (engineRef.current) engineRef.current.debugUnlockAll();
  };

  const handleResetUnlocks = () => {
      if (engineRef.current) engineRef.current.debugResetUnlocks();
  };

  const handleToggleFFOverlayVectors = () => {
      if (engineRef.current) engineRef.current.toggleFFOverlayVectors();
  };

  const handleToggleFFOverlayCells = () => {
      if (engineRef.current) engineRef.current.toggleFFOverlayCells();
  };

  const handleToggleFFOverlayObstacles = () => {
      if (engineRef.current) engineRef.current.toggleFFOverlayObstacles();
  };

  const handleToggleFFOverlayRebuilds = () => {
      if (engineRef.current) engineRef.current.toggleFFOverlayRebuilds();
  };

  const handleCycleFFOverlaySampleN = () => {
      if (engineRef.current) engineRef.current.cycleFFOverlaySampleN();
  };

  const handleCycleFFDensity = () => {
      if (engineRef.current) engineRef.current.cycleFFDensity();
  };

  const handleCycleFFKernelR = () => {
      if (engineRef.current) engineRef.current.cycleFFKernelR();
  };

  const handleCycleFFTangentMix = () => {
      if (engineRef.current) engineRef.current.cycleFFTangentMix();
  };

  const handleCycleFFBreathe = () => {
      if (engineRef.current) engineRef.current.cycleFFBreathe();
  };

  const handleCycleFFLaneJitter = () => {
      if (engineRef.current) engineRef.current.cycleFFLaneJitter();
  };

  const handleCycleFFPattern = () => {
      if (engineRef.current) engineRef.current.cycleFFPattern();
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
        onTogglePlayerNebulaCollision={handleTogglePlayerNebulaCollision}
        onToggleShardSleep={handleToggleShardSleep}
        onToggleShardViewportCull={handleToggleShardViewportCull}
        onToggleShardLod={handleToggleShardLod}
        onToggleMergeRate={handleToggleMergeRate}
        onToggleScreenShake={handleToggleScreenShake}
        onToggleTileOutlines={handleToggleTileOutlines}
        onToggleChevronMode={handleToggleChevronMode}
        onToggleRepelPush={handleToggleRepelPush}
        onTogglePlasticAutomata={handleTogglePlasticAutomata}
        onTogglePlasticAutomataDirection={handleTogglePlasticAutomataDirection}
        onToggleMaterialAutomata={handleToggleMaterialAutomata}
        onCyclePlasticPalette={handleCyclePlasticPalette}
        onCyclePlasticShardPalette={handleCyclePlasticShardPalette}
        onCyclePlasticGlowBrightness={handleCyclePlasticGlowBrightness}
        onCycleMetalGlowBrightness={handleCycleMetalGlowBrightness}
        onCycleGlassGlowColor={handleCycleGlassGlowColor}
        onCycleMetalGlowColor={handleCycleMetalGlowColor}
        onCycleNebulaPalette={handleCycleNebulaPalette}
        onTogglePlasticBlend={handleTogglePlasticBlend}
        onCycleNebulaStretch={handleCycleNebulaStretch}
        onCycleShatterGrace={handleCycleShatterGrace}
        onCyclePlayerThrust={handleCyclePlayerThrust}
        onCyclePlayerSpeed={handleCyclePlayerSpeed}
        onCycleTileBlendAlpha={handleCycleTileBlendAlpha}
        onCycleShardBlendAlpha={handleCycleShardBlendAlpha}
        onCycleColorBlendInterval={handleCycleColorBlendInterval}
        onToggleAsteroidFlow={handleToggleAsteroidFlow}
        onToggleSnitchCatchMode={handleToggleSnitchCatchMode}
        onCycleSnitchSpeed={handleCycleSnitchSpeed}
        onCycleEnemyScale={handleCycleEnemyScale}
        onCycleSwarmMove={handleCycleSwarmMove}
        onApplyCorrosion={handleApplyCorrosion}
        onApplyDisable={handleApplyDisable}
        onToggleTraits={handleToggleTraits}
        onCycleUpgrade={handleCycleUpgrade}
        onMaxUpgrades={handleMaxUpgrades}
        onResetUpgrades={handleResetUpgrades}
        onAddCredits={handleAddCredits}
        onSpawnDragon={handleSpawnDragon}
        onSpawnRival={handleSpawnRival}
        onPerfRecToggle={handlePerfRecToggle}
        onPerfRecCycleScene={handlePerfRecCycleScene}
        onPerfRecExport={handlePerfRecExport}
        onPurchaseUnlock={handlePurchaseUnlock}
        onEquipWeapon={handleEquipWeapon}
        onPurchaseUpgrade={handlePurchaseUpgrade}
        onUnlockAll={handleUnlockAll}
        onResetUnlocks={handleResetUnlocks}
        onToggleFFOverlayVectors={handleToggleFFOverlayVectors}
        onToggleFFOverlayCells={handleToggleFFOverlayCells}
        onToggleFFOverlayObstacles={handleToggleFFOverlayObstacles}
        onToggleFFOverlayRebuilds={handleToggleFFOverlayRebuilds}
        onCycleFFOverlaySampleN={handleCycleFFOverlaySampleN}
        onCycleFFDensity={handleCycleFFDensity}
        onCycleFFKernelR={handleCycleFFKernelR}
        onCycleFFTangentMix={handleCycleFFTangentMix}
        onCycleFFBreathe={handleCycleFFBreathe}
        onCycleFFLaneJitter={handleCycleFFLaneJitter}
        onCycleFFPattern={handleCycleFFPattern}
        onSkipWave={handleSkipWave}
        difficulty={difficulty}
        onSetDifficulty={handleSetDifficulty}
        mapType={mapType}
        onSetMapType={handleSetMapType}
        onSetForcedEnemy={handleSetForcedEnemy}
      />
    </div>
  );
};

export default App;
