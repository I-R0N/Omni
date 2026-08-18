
import React, { Profiler, useEffect, useRef, useState } from 'react';
import { GameEngine } from './engine/GameEngine';
import { EngineStats, MapType, GameState, ControlScheme } from './types';
import { effectiveDpr, cycleRenderScale, getActiveRenderScaleName } from './constants';
import UIOverlay from './components/UIOverlay';
import { crc32, buildTriggerData, buildRumbleData, buildOutputReport } from './engine/systems/DualSenseHID';
import { installMenuNav, pickNext } from './components/menuNav';

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
  // The canvas resize routine, exposed so the render-scale DBG toggle can
  // re-run it: changing the pixel-ratio cap has to resize the backing store,
  // and only this effect owns the canvas element.
  const resizeRef = useRef<() => void>(() => {});
  const [renderScaleName, setRenderScaleName] = useState<string>(getActiveRenderScaleName());

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

    // Debug handle #3, and the one with the strongest case: the DualSense
    // output-report builders are the only code in the input layer that can be
    // WRONG IN A WAY NOTHING REPORTS — a pad silently discards a report with
    // a bad CRC or a bad byte layout, so "no trigger resistance" and "no pad
    // connected" look identical.  They are pure, and CRC-32 has a published
    // test vector, so a suite can pin them without hardware.  Nothing in the
    // game reads this.
    (window as any).__omniHid = { crc32, buildTriggerData, buildRumbleData, buildOutputReport };
    // Debug handle #4: the menu driver's geometric step rule, so a suite can
    // pin it against a synthetic layout instead of against whatever the menu
    // happens to contain this week.
    (window as any).__omniMenuNav = { pickNext };

    const handleResize = () => {
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        // Capped device pixel ratio — see RENDER_SCALE_CYCLE.  RenderSystem
        // reads the SAME accessor, so the canvas it draws into and the logical
        // viewport it computes always agree.
        const dpr = effectiveDpr();
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

    resizeRef.current = handleResize;
    const ctx = canvasRef.current.getContext('2d')!;
    engine.initCanvas(ctx);
    handleResize(); // Set initial size before first frame
    engine.start();
    engineRef.current = engine;

    window.addEventListener('resize', handleResize);

    // Gamepad menu navigation (G15).  Installed here rather than inside
    // UIOverlay because it drives DOM FOCUS, not React state: it must not be
    // torn down and rebuilt every time the HUD re-renders, which is every
    // stats push.
    const uninstallNav = installMenuNav({
      steps: () => engine.input.consumeNavSteps(),
      confirm: () => engine.input.consumeConfirmPress(),
      back: () => engine.input.consumeBackPress(),
      onBack: () => engine.menuBack(),
    });

    // Cleanup
    return () => {
      engine.stop();
      uninstallNav();
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
      if (engineRef.current) engineRef.current.dbg.toggleDebug();
  };

  const handleSetMapType = (type: MapType) => {
      setMapType(type);
      if (engineRef.current) engineRef.current.setMapType(type);
  };

  const handleSetForcedEnemy = (subtype: string | null) => {
      if (engineRef.current) engineRef.current.setForcedTestEnemy(subtype);
  };

  const handleCycleTrailShape = () => {
      if (engineRef.current) engineRef.current.dbg.cycleTrailShape();
  };

  const handleCycleTrailEmitMode = () => {
      if (engineRef.current) engineRef.current.dbg.cycleTrailEmitMode();
  };

  const handleToggleLocalGravity = () => {
      if (engineRef.current) engineRef.current.dbg.toggleLocalGravity();
  };

  const handleToggleAttractorGravity = () => {
      if (engineRef.current) engineRef.current.dbg.toggleAttractorGravity();
  };

  const handleToggleCollisions = () => {
      if (engineRef.current) engineRef.current.dbg.toggleCollisions();
  };

  const handleToggleShardTileCollisions = () => {
      if (engineRef.current) engineRef.current.dbg.toggleShardTileCollisions();
  };

  const handleCycleShardPairInterval = () => {
      if (engineRef.current) engineRef.current.dbg.cycleShardPairInterval();
  };

  const handleCycleShardTilePairInterval = () => {
      if (engineRef.current) engineRef.current.dbg.cycleShardTilePairInterval();
  };

  const handleTogglePerfAuto = () => {
      if (engineRef.current) engineRef.current.dbg.togglePerfAuto();
  };

  const handleToggleShardGravity = () => {
      if (engineRef.current) engineRef.current.dbg.toggleShardGravity();
  };

  const handleToggleShardBonding = () => {
      if (engineRef.current) engineRef.current.dbg.toggleShardBonding();
  };

  const handleToggleNebulaShardCollisions = () => {
      if (engineRef.current) engineRef.current.dbg.toggleNebulaShardCollisions();
  };

  const handleTogglePlayerNebulaCollision = () => {
      if (engineRef.current) engineRef.current.dbg.togglePlayerNebulaCollision();
  };

  const handleToggleShardSleep = () => {
      if (engineRef.current) engineRef.current.dbg.toggleShardSleep();
  };

  const handleToggleShardViewportCull = () => {
      if (engineRef.current) engineRef.current.dbg.toggleShardViewportCull();
  };

  const handleToggleShardLod = () => {
      if (engineRef.current) engineRef.current.dbg.toggleShardLod();
  };

  const handleToggleMergeRate = () => {
      if (engineRef.current) engineRef.current.dbg.toggleMergeRate();
  };

  const handleToggleScreenShake = () => {
      if (engineRef.current) engineRef.current.dbg.toggleScreenShake();
  };

  const handleToggleTileOutlines = () => {
      if (engineRef.current) engineRef.current.dbg.toggleTileOutlines();
  };

  const handleToggleChevronMode = () => {
      if (engineRef.current) engineRef.current.dbg.toggleChevronMode();
  };

  const handleToggleJoystickDebug = () => {
      if (engineRef.current) engineRef.current.dbg.toggleJoystickDebug();
  };

  const handleCycleMinimapMaterial = () => {
      if (engineRef.current) engineRef.current.dbg.cycleMinimapMaterial();
  };

  const handleCycleRockPalette = () => {
      if (engineRef.current) engineRef.current.dbg.cycleRockPalette();
  };

  const handleCycleLighting = () => {
      if (engineRef.current) engineRef.current.dbg.cycleLighting();
  };

  const handleCycleLightingTier = () => {
      if (engineRef.current) engineRef.current.dbg.cycleLightingTier();
  };

  const handleToggleShardShadows = () => {
      if (engineRef.current) engineRef.current.dbg.toggleShardShadows();
  };

  const handleToggleRefraction = () => {
      if (engineRef.current) engineRef.current.dbg.toggleRefraction();
  };

  const handleCycleShadowSoftness = () => {
      if (engineRef.current) engineRef.current.dbg.cycleShadowSoftness();
  };

  const handleToggleRumble = () => {
      if (engineRef.current) engineRef.current.dbg.toggleRumble();
  };

  const handleSetControlScheme = (scheme: ControlScheme) => {
      if (engineRef.current) engineRef.current.setControlScheme(scheme);
  };

  const handleToggleAdaptiveTriggers = () => {
      // Fire-and-forget: the outcome arrives on the next EngineStats push
      // (`adaptiveTriggersConnected`), so there is no result to hold here, and
      // a cancelled device picker is a rejected-then-swallowed promise rather
      // than an error state to render.
      if (engineRef.current) void engineRef.current.toggleAdaptiveTriggers();
  };

  const handleCycleTriggerEncoding = () => {
      if (engineRef.current) engineRef.current.cycleTriggerEncoding();
  };

  const handleTestTriggerLink = () => {
      if (engineRef.current) engineRef.current.testAdaptiveTriggerLink();
  };

  const handleToggleRepelPush = () => {
      if (engineRef.current) engineRef.current.dbg.toggleRepelPush();
  };

  const handleTogglePlasticAutomata = () => {
      if (engineRef.current) engineRef.current.dbg.togglePlasticAutomata();
  };

  const handleTogglePlasticAutomataDirection = () => {
      if (engineRef.current) engineRef.current.dbg.togglePlasticAutomataDirection();
  };

  const handleToggleMaterialAutomata = () => {
      if (engineRef.current) engineRef.current.dbg.toggleMaterialAutomata();
  };

  const handleCyclePlasticPalette = () => {
      if (engineRef.current) engineRef.current.dbg.cyclePlasticPalette();
  };

  const handleCyclePlasticShardPalette = () => {
      if (engineRef.current) engineRef.current.dbg.cyclePlasticShardPalette();
  };

  const handleCyclePlasticGlowBrightness = () => {
      if (engineRef.current) engineRef.current.dbg.cyclePlasticGlowBrightness();
  };

  const handleCycleMetalGlowBrightness = () => {
      if (engineRef.current) engineRef.current.dbg.cycleMetalGlowBrightness();
  };

  const handleCycleGlassGlowColor = () => {
      if (engineRef.current) engineRef.current.dbg.cycleGlassGlowColor();
  };

  const handleCycleMetalGlowColor = () => {
      if (engineRef.current) engineRef.current.dbg.cycleMetalGlowColor();
  };

  const handleCycleNebulaPalette = () => {
      if (engineRef.current) engineRef.current.dbg.cycleNebulaPalette();
  };

  const handleTogglePlasticBlend = () => {
      if (engineRef.current) engineRef.current.dbg.togglePlasticBlend();
  };

  const handleCycleNebulaStretch = () => {
      if (engineRef.current) engineRef.current.dbg.cycleNebulaStretch();
  };

  const handleCycleShatterGrace = () => {
      if (engineRef.current) engineRef.current.dbg.cycleShatterGrace();
  };

  const handleCyclePlayerThrust = () => {
      if (engineRef.current) engineRef.current.dbg.cyclePlayerThrust();
  };

  const handleCyclePlayerSpeed = () => {
      if (engineRef.current) engineRef.current.dbg.cyclePlayerSpeed();
  };

  const handleCycleTileBlendAlpha = () => {
      if (engineRef.current) engineRef.current.dbg.cycleTileBlendAlpha();
  };

  const handleCycleShardBlendAlpha = () => {
      if (engineRef.current) engineRef.current.dbg.cycleShardBlendAlpha();
  };

  const handleCycleColorBlendInterval = () => {
      if (engineRef.current) engineRef.current.dbg.cycleColorBlendInterval();
  };

  const handleToggleAsteroidFlow = () => {
      if (engineRef.current) engineRef.current.dbg.toggleAsteroidFlow();
  };

  const handleToggleSnitchCatchMode = () => {
      if (engineRef.current) engineRef.current.dbg.toggleSnitchCatchMode();
  };

  const handleCycleSnitchSpeed = () => {
      if (engineRef.current) engineRef.current.dbg.cycleSnitchSpeed();
  };

  const handleCycleEnemyScale = () => {
      if (engineRef.current) engineRef.current.dbg.cycleEnemyScale();
  };

  const handleCycleSubstepCap = () => {
      if (engineRef.current) engineRef.current.dbg.cycleSubstepCap();
  };

  const handleCycleRenderScale = () => {
      cycleRenderScale();
      setRenderScaleName(getActiveRenderScaleName());
      resizeRef.current();
  };

  const handleCycleHudRate = () => {
      if (engineRef.current) engineRef.current.dbg.cycleHudRate();
  };

  const handleCycleSimRate = () => {
      if (engineRef.current) engineRef.current.dbg.cycleSimRate();
  };

  const handleCycleSwarmMove = () => {
      if (engineRef.current) engineRef.current.dbg.cycleSwarmMove();
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
      if (engineRef.current) engineRef.current.dbg.toggleFFOverlayVectors();
  };

  const handleToggleFFOverlayCells = () => {
      if (engineRef.current) engineRef.current.dbg.toggleFFOverlayCells();
  };

  const handleToggleFFOverlayObstacles = () => {
      if (engineRef.current) engineRef.current.dbg.toggleFFOverlayObstacles();
  };

  const handleToggleFFOverlayRebuilds = () => {
      if (engineRef.current) engineRef.current.dbg.toggleFFOverlayRebuilds();
  };

  const handleCycleFFOverlaySampleN = () => {
      if (engineRef.current) engineRef.current.dbg.cycleFFOverlaySampleN();
  };

  const handleCycleFFDensity = () => {
      if (engineRef.current) engineRef.current.dbg.cycleFFDensity();
  };

  const handleCycleFFKernelR = () => {
      if (engineRef.current) engineRef.current.dbg.cycleFFKernelR();
  };

  const handleCycleFFTangentMix = () => {
      if (engineRef.current) engineRef.current.dbg.cycleFFTangentMix();
  };

  const handleCycleFFBreathe = () => {
      if (engineRef.current) engineRef.current.dbg.cycleFFBreathe();
  };

  const handleCycleFFLaneJitter = () => {
      if (engineRef.current) engineRef.current.dbg.cycleFFLaneJitter();
  };

  const handleCycleFFPattern = () => {
      if (engineRef.current) engineRef.current.dbg.cycleFFPattern();
  };

  const handleSkipWave = () => {
      if (engineRef.current) engineRef.current.skipWave();
  };

  // ── The React-cost instrument ────────────────────────────────────────────
  //
  // The engine times its own sim and render, but the third per-frame cost —
  // reconciling this tree, once per `onStatsUpdate` — was never measurable
  // from inside the engine: a setState called from a rAF callback is batched,
  // and the render happens after that callback has returned.  A timer around
  // the setState (GameEngine's `lastStatsScheduleMs`) therefore reads ~0
  // regardless of what the tree costs.
  //
  // React's own `<Profiler>` is the instrument that CAN see it: it is part of
  // React proper rather than devtools, it survives a production build, and it
  // needs no inspector attached — which matters because the target device is
  // an iPhone, where the whole devtools route is out of reach and the repo
  // already measures via the on-device PerfRecorder for exactly that reason.
  //
  // The callback writes PLAIN FIELDS on the engine.  It must never setState:
  // an instrument that re-renders the tree it measures is its own load, and
  // would also loop.
  const handleUiRender = (
      _id: string,
      _phase: 'mount' | 'update' | 'nested-update',
      actualDuration: number,
      baseDuration: number,
  ) => {
      engineRef.current?.noteUiRender(actualDuration, baseDuration);
  };

  return (
    <div className="relative w-full h-screen bg-slate-950 overflow-hidden select-none">
      <canvas 
        ref={canvasRef} 
        className="block w-full h-full"
      />
      {/* Children deliberately left at their original indentation: wrapping
          them is a two-line change, reindenting them is a hundred-line diff
          through the middle of a measurement commit. */}
      <Profiler id="ui" onRender={handleUiRender}>
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
        onToggleJoystickDebug={handleToggleJoystickDebug}
        onCycleMinimapMaterial={handleCycleMinimapMaterial}
        onCycleLighting={handleCycleLighting}
        onCycleLightingTier={handleCycleLightingTier}
        onToggleShardShadows={handleToggleShardShadows}
        onToggleRefraction={handleToggleRefraction}
        onCycleShadowSoftness={handleCycleShadowSoftness}
        onCycleRockPalette={handleCycleRockPalette}
        onToggleRumble={handleToggleRumble}
        onSetControlScheme={handleSetControlScheme}
        onToggleAdaptiveTriggers={handleToggleAdaptiveTriggers}
        onCycleTriggerEncoding={handleCycleTriggerEncoding}
        onTestTriggerLink={handleTestTriggerLink}
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
        onCycleRenderScale={handleCycleRenderScale}
        onCycleSubstepCap={handleCycleSubstepCap}
        renderScaleName={renderScaleName}
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
      </Profiler>
    </div>
  );
};

export default App;
