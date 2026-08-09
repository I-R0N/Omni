
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
    currentMapType: MapType.OVERWORLD,
    currentWeapon: 'Blaster',
    gameState: GameState.MENU,
    difficulty: 3
  });
  const [difficulty, setDifficulty] = useState<number>(3);
  // Menu default mirrors the engine's: a run starts on the Overworld hub
  // (roadmap step (k)); the grid stays a direct-start override.
  const [mapType, setMapType] = useState<MapType>(MapType.OVERWORLD);
  // Mirror difficulty into a ref so the one-shot mount effect below can
  // read the latest value without closing over stale state.
  const difficultyRef = useRef(difficulty);
  difficultyRef.current = difficulty;

  useEffect(() => {
    if (!canvasRef.current) return;

    // Initialize Engine
    const engine = new GameEngine((newStats) => {
        setStats(newStats);
        // Debug handle for the live stats payload — same rationale as
        // __omniEngine below.
        (window as any).__omniStats = newStats;
    }, difficultyRef.current);

    // Debug handle.  The game already ships a full in-game DBG menu (pause ▸
    // Debug Menu), so the engine is deliberately reachable from the console
    // too: it is what the headless smoke scripts drive, and it costs one
    // assignment.  Read/poke at your own risk — nothing in the game reads it.
    (window as any).__omniEngine = engine;

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

  // Death / run-summary screen actions (Phase 3 Pair A).
  const handleRespawn = () => {
      if (engineRef.current) engineRef.current.respawnFromDeath();
  };

  const handleRestartRun = () => {
      if (engineRef.current) engineRef.current.restartRun();
  };

  const handleQuitToMenu = () => {
      if (engineRef.current) engineRef.current.quitToMenu();
  };

  const handleDismissStageClear = () => {
      if (engineRef.current) engineRef.current.dismissStageClear();
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

  const handleCycleHudRate = () => {
      if (engineRef.current) engineRef.current.cycleHudRate();
  };

  const handleCycleSimRate = () => {
      if (engineRef.current) engineRef.current.cycleSimRate();
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

  const handleGrantModule = (id: string) => {
      if (engineRef.current) engineRef.current.debugGrantModule(id);
  };

  const handleOutfitAll = () => {
      if (engineRef.current) engineRef.current.debugOutfitAll();
  };

  const handleResetOutfit = () => {
      if (engineRef.current) engineRef.current.resetOutfit();
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

  const handleSpawnBoss = (id: string) => {
      if (engineRef.current) engineRef.current.debugSpawnBoss(id);
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

  const handleMoveModule = (
      from: { area: 'inventory' | 'ship' | 'weapon'; idx: number },
      to: { area: 'inventory' | 'ship' | 'weapon'; idx: number },
  ) => {
      if (engineRef.current) engineRef.current.moveModule(from, to);
  };

  const handlePurchaseModule = (id: string) => {
      if (engineRef.current) engineRef.current.purchaseModule(id);
  };

  const handleSellModule = (idx: number) => {
      if (engineRef.current) engineRef.current.sellModule(idx);
  };

  const handleScrapModule = (idx: number) => {
      if (engineRef.current) engineRef.current.scrapModule(idx);
  };

  const handleUndock = () => {
      if (engineRef.current) engineRef.current.undock();
  };

  const handleRepairHull = () => {
      if (engineRef.current) engineRef.current.repairHull();
  };

  const handleGrantWeapon = (id: string) => {
      if (engineRef.current) engineRef.current.debugGrantWeapon(id);
  };

  const handleTeleportStation = () => {
      if (engineRef.current) engineRef.current.debugTeleportToStation();
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
        onRespawn={handleRespawn}
        onRestartRun={handleRestartRun}
        onQuitToMenu={handleQuitToMenu}
        onDismissStageClear={handleDismissStageClear}
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
        onCycleSimRate={handleCycleSimRate}
        onCycleHudRate={handleCycleHudRate}
        onCycleSwarmMove={handleCycleSwarmMove}
        onApplyCorrosion={handleApplyCorrosion}
        onApplyDisable={handleApplyDisable}
        onToggleTraits={handleToggleTraits}
        onGrantModule={handleGrantModule}
        onOutfitAll={handleOutfitAll}
        onResetOutfit={handleResetOutfit}
        onAddCredits={handleAddCredits}
        onSpawnDragon={handleSpawnDragon}
        onSpawnRival={handleSpawnRival}
        onSpawnBoss={handleSpawnBoss}
        onPerfRecToggle={handlePerfRecToggle}
        onPerfRecCycleScene={handlePerfRecCycleScene}
        onPerfRecExport={handlePerfRecExport}
        onMoveModule={handleMoveModule}
        onPurchaseModule={handlePurchaseModule}
        onSellModule={handleSellModule}
        onScrapModule={handleScrapModule}
        onUndock={handleUndock}
        onRepairHull={handleRepairHull}
        onGrantWeapon={handleGrantWeapon}
        onTeleportStation={handleTeleportStation}
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
