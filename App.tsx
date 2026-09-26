
import React, { Profiler, useEffect, useRef, useState } from 'react';
import { GameEngine } from './engine/GameEngine';
import { EngineStats, MapType, GameState, ControlScheme } from './types';
import { effectiveDpr, cycleRenderScale, getActiveRenderScaleName,
         computeMinimapRect, computeLoadoutHUDLayout, computeIndicatorRect,
         detectionAlpha,
         GRAIN_REGULARITY, grainRelaxFor, grainSeparationFor, grainRegularityOf,
         grainSpecFor, grainLadder, grainTableValue, breakYieldsNothing, type GrainKnob,
         nebulaSpriteSize,
         NEBULA_MATERIAL, NEBULA_TILE_SHATTER_YIELD_MAX, NEBULA_DRAIN_CYCLE,
         nebulaTileCost, nebulaMergeLoss,
         ENEMY_VARIANTS, WEAPONS, WEAPON_LIST, SHARD_VARIANTS,
         projectileMassFor, PHYSICS_CONSTANTS,
         IMPACT_DENSITY, massFor, hullDensity,
         MASS_SCALE, scaledMass, IMPACT_ENERGY_PER_DAMAGE,
         STRUCTURE_CONSTANTS, FLOW_VARIABILITY, AUDIO_CONSTANTS,
         PROJECTILE_CONSTANTS, HIT_FEEDBACK,
         BASE_BANK_DIVISOR, BASE_BANK_TRIM, GUNNERY_MK3_TRIPLE_MULT,
         GUNNERY_MK3_DAMAGE_FRAC, MODULE_DEFS,
         blastDamageFor, BLAST_ENERGY_COUPLING } from './constants';
import UIOverlay from './components/UIOverlay';
import { crc32, buildTriggerData, buildRumbleData, buildOutputReport } from './engine/systems/DualSenseHID';
import { fitFontPx } from './engine/systems/render/hud';
import { buildFilletPath, blendAttachRadius, coatMargin } from './engine/systems/render/shardBlend';
import { roundedPolyPath } from './engine/systems/render/drawUtils';
import { bondVariance, BOND_SPREAD_RANGE } from './engine/systems/fractureCache';
import { installMenuNav, pickNext } from './components/menuNav';
import {
  enumerateCells, resolveTiltCell, cellIndex, cellMatrix,
} from './engine/systems/render/shipSprites';
import { drawPlayerCube } from './engine/systems/render/playerCube';
import { SHIP_SHEETS } from './assets';
import { mulberry32, polygonArea, polygonSignedArea, polygonCentroid, pointInPolygon,
         isSimplePolygon, placeFractureSites, computeFracture, collectInteriorEdges,
         subtractBoundaryCell, pointToPolygonDistance2, unionOfCells,
       } from './engine/systems/fracture';

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

    // Debug handle.  The game already ships a full in-game debug menu (the DBG
    // button, on every screen), so the engine is deliberately reachable from the console
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

    // Debug handle #5 (gauntlet 5d, U4) — the canvas HUD's LAYOUT functions,
    // exposed for the same reason as __omniHid and on the same terms: they are
    // pure, and they are wrong in a way nothing reports.  A banner that clips
    // off both edges at 320px, a minimap rect that disagrees with the tap
    // handler that catches its expand tap, a loadout strip that leaves the
    // viewport — none of those throw, none of them log, and none of them are
    // visible at the one viewport the suites used to run at.  Exposing the
    // three functions lets the viewport matrix pin them at every width without
    // sampling pixels off a starfield.  Nothing in the game reads this.
    // `detectionAlpha` (A4) joins them on identical terms: the Scanner's
    // extended enemy range is a FADE ramp that exists only as a globalAlpha
    // inside the draw, so a tier that reveals nothing — or reveals at the
    // wrong mark — is silent.
    (window as any).__omniHud = { fitFontPx, computeMinimapRect, computeLoadoutHUDLayout, computeIndicatorRect, detectionAlpha };
    // Debug handle #4: the menu driver's geometric step rule, so a suite can
    // pin it against a synthetic layout instead of against whatever the menu
    // happens to contain this week.
    (window as any).__omniMenuNav = { pickNext };
    // Debug handle #6 (voronoi gauntlet, V1) — the seeded fracture core, on
    // the __omniHid terms: pure functions with no engine imports, pinned by
    // tests/fracture.spec.ts for determinism, area conservation, cell
    // validity and cost.  Nothing in the game reads this handle.
    (window as any).__omniFracture = {
      mulberry32, polygonArea, polygonSignedArea, polygonCentroid, pointInPolygon,
      isSimplePolygon, placeFractureSites, computeFracture, collectInteriorEdges,
      subtractBoundaryCell, pointToPolygonDistance2, unionOfCells,
    };
    // Debug handle #7 (material grain spec, A1) — the material-side
    // resolvers, on the __omniFracture terms: pure, and wrong in a way
    // nothing reports.  If the regularity mapping drifts, every
    // material's pattern silently changes shape and nothing throws; and
    // "A1 changes no behaviour" is exactly the claim that needs pinning
    // against a number rather than against a screenshot.
    (window as any).__omniGrain = {
      GRAIN_REGULARITY, grainRelaxFor, grainSeparationFor, grainRegularityOf,
      bondVariance, BOND_SPREAD_RANGE,
      // The per-material DBG override resolver.  Pure, and wrong in a way
      // nothing reports: an override that lands in the table but never
      // reaches this resolver reads back perfectly from the panel and
      // changes nothing on screen.
      grainSpecFor, grainLadder, grainTableValue,
      // WHAT A BREAK LEAVES BEHIND — the predicate the blast ring reads to
      // decide whether it may damage a body at all.  It belongs on the
      // __omniFracture terms for a sharp reason: it is DERIVED from the
      // variant table, so the way it goes wrong is a future variant
      // silently joining or leaving the exempt set with nothing on screen
      // to say so.  A table-walk test is the only thing that can see that.
      breakYieldsNothing, SHARD_VARIANTS,
    };

    // Debug handle #6 — the ship tilt-sheet grid.  Same terms as the two
    // above: `enumerateCells` / `resolveTiltCell` / `cellMatrix` are pure,
    // and they are wrong in a way nothing reports — a cell order that
    // disagrees with the authoring guide, or a mirror that folds the wrong
    // half of the azimuth circle, draws a plausible ship in the WRONG pose,
    // which no exception and no log will ever mention.  Exposing them lets
    // the suite pin the contract, and lets scripts/gen-ship-sheet.mjs render
    // placeholder art against the very table the engine indexes (which is
    // also what keeps docs/SHIP_SPRITE_SHEETS.md honest).  `drawPlayerCube`
    // rides along because the generator draws its placeholder poses with it.
    // Nothing in the game reads this.
    (window as any).__omniShip = {
      enumerateCells, resolveTiltCell, cellIndex, cellMatrix, drawPlayerCube, SHIP_SHEETS,
    };

    // Debug handle #8 — the nebula sprite scale, on the __omniHid terms.
    // `nebulaSpriteSize` is pure, and it is WRONG IN A WAY NOTHING
    // REPORTS: the sprite is deliberately larger than the body under it,
    // so a rule that stops tracking the body's size does not look broken
    // — it looks like a cloud.  That is exactly how the rule it replaced
    // rotted unnoticed (it keyed off `nebulaTileArea`, which no shard
    // ever carried, so every shard drew a full-tile sprite whatever its
    // size).  Nothing in the game reads this handle.
    // The nebula MATERIAL LEDGER joins it on the same terms, and with a
    // motive of its own: a ledger that inverts does not throw, does not log
    // and does not look wrong in any single frame — it just means the clouds
    // creep outward over minutes, which is precisely how it shipped growing
    // at ~2x a cycle without anyone seeing it.  The yield side is deliberately
    // NOT exposed: a test has to MEASURE it off real shattered tiles, or the
    // inequality is being checked against a second opinion rather than against
    // what the fracture core actually produces.
    (window as any).__omniNebula = {
      nebulaSpriteSize,
      NEBULA_MATERIAL, NEBULA_TILE_SHATTER_YIELD_MAX, NEBULA_DRAIN_CYCLE,
      nebulaTileCost, nebulaMergeLoss,
    };

    // Debug handle #9 — the MASS SCALE, on the __omniHid terms and with the
    // sharpest motive of the set.  Under the energy model a body's mass is
    // half of what its every impact SPENDS, so the masses authored across
    // the player, the enemy roster, the gun roster and the shard spawn
    // ladders are a balance surface rather than four unrelated impulse
    // terms — and they are WRONG IN A WAY NOTHING REPORTS: a projectile a
    // twentieth the density of the hull that fires it produces perfectly
    // plausible play, throws no exception and logs nothing.  The only way
    // to see it is to put all four ladders in one table, which is what
    // `perf/impact-audit.mjs` §7 does with this.  Exposed as the TABLES
    // rather than as computed numbers so the audit cannot drift from what
    // the sim reads.  Nothing in the game reads this handle.
    (window as any).__omniMass = {
      ENEMY_VARIANTS, WEAPONS, WEAPON_LIST, SHARD_VARIANTS,
      projectileMassFor, PHYSICS_CONSTANTS,
      // The scale's own definitions, so a suite can pin that the shipped
      // hull really is the table's number and that the shard ladders really
      // read from it — the two claims that make this ONE scale rather than
      // a comment beside five unrelated literals.
      IMPACT_DENSITY, massFor, hullDensity, MASS_SCALE, scaledMass,
      // The three shapes mass takes (see tests/mass.spec.ts): the energy
      // conversion it is measured against, and the absolute thresholds it
      // is compared to.  Both must carry MASS_SCALE, and both are wrong
      // with no symptom if they stop.
      IMPACT_ENERGY_PER_DAMAGE, STRUCTURE_CONSTANTS, FLOW_VARIABILITY, AUDIO_CONSTANTS,
      PROJECTILE_CONSTANTS, HIT_FEEDBACK,
      // The BANK re-base and the DERIVED blast, on the same terms as the rest
      // of this handle: both are relationships between two tables that no
      // symptom reports if they drift apart.  `BASE_BANK_DIVISOR` is only
      // correct relative to what a Gunnery Mk III actually grants, so
      // MODULE_DEFS is here to be read rather than restated; `blastDamageFor`
      // is here because a blast that silently stopped deriving still draws a
      // perfectly good explosion.  The divisor's two HALVES are published
      // separately because only one of them is pinned to the catalog: the
      // Gunnery anchor must keep tracking MODULE_DEFS, the feel trim over it
      // is free to move.
      BASE_BANK_DIVISOR, BASE_BANK_TRIM, GUNNERY_MK3_TRIPLE_MULT,
      GUNNERY_MK3_DAMAGE_FRAC, MODULE_DEFS,
      blastDamageFor, BLAST_ENERGY_COUPLING,
    };

    // Debug handle #7 — the bonded-pair blend geometry, on the __omniHid
    // rationale exactly: it is pure, and it is WRONG IN A WAY NOTHING
    // REPORTS.  Every failure mode of a metaball connector is silent — a
    // degenerate pair traces no path, an out-of-domain acos yields NaN
    // coordinates that Canvas2D discards without a word, and an attach
    // radius outside the hull leaves a seam nobody can see at one zoom
    // level, and a corner fillet that overshoots its edge quietly turns a
    // polygon inside out.  None of it throws or logs.  Nothing in the game
    // reads this.
    (window as any).__omniBlend = {
      buildFilletPath, blendAttachRadius, coatMargin, roundedPolyPath,
    };

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

  const handleSetMapType = (type: MapType) => {
      setMapType(type);
      if (engineRef.current) engineRef.current.setMapType(type);
  };

  // Audio settings.  The slider is a live user gesture, so it doubles as
  // an unlock trigger on the rare path where the AudioContext is still
  // locked when the pause menu opens.
  const handleSetVolume = (v: number) => {
      const e = engineRef.current;
      if (!e) return;
      e.audio.unlock();
      e.audio.setVolume(v);
  };

  const handleToggleMute = () => {
      const e = engineRef.current;
      if (!e) return;
      e.audio.unlock();
      e.audio.toggleMute();
  };

  // Synth drafts on/off — the audition switch for recorded takes.
  const handleToggleDrafts = () => {
      const e = engineRef.current;
      if (!e) return;
      e.audio.unlock();
      e.audio.draftsEnabled = !e.audio.draftsEnabled;
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

  // The debug panel's rows call the engine DIRECTLY (components/
  // debugSections.tsx) — this one stable accessor replaced ~130 one-line
  // `handleCycleX` forwarders and the props that threaded them through
  // UIOverlay.  An accessor rather than the instance, because the engine is
  // built in the mount effect above, after the first render.
  const getEngine = useRef(() => engineRef.current).current;

  // Render scale stays an App handler because it is App's to do: the cap
  // changes the canvas backing store, which only the resize routine owns.
  const handleCycleRenderScale = () => {
      cycleRenderScale();
      setRenderScaleName(getActiveRenderScaleName());
      resizeRef.current();
  };

  const handleScan = () => {
      if (engineRef.current) engineRef.current.fireScan();
  };

  const handleSetAutoScan = (on: boolean) => {
      if (engineRef.current) engineRef.current.setAutoScan(on);
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

  const handlePurchaseSlot = (group: 'ship' | 'weapon') => {
      if (engineRef.current) engineRef.current.purchaseSlot(group);
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
        onAudioCue={id => engineRef.current?.audio.play(id)}
        onSetSfxVolume={v => { engineRef.current?.audio.unlock(); engineRef.current?.audio.setSfxVolume(v); }}
        onSetMusicVolume={v => { engineRef.current?.audio.unlock(); engineRef.current?.audio.setMusicVolume(v); }}
        onSetVolume={handleSetVolume}
        onToggleMute={handleToggleMute}
            onToggleDrafts={handleToggleDrafts}
        onSetControlScheme={handleSetControlScheme}
        onToggleAdaptiveTriggers={handleToggleAdaptiveTriggers}
        engine={getEngine}
        onCycleRenderScale={handleCycleRenderScale}
        renderScaleName={renderScaleName}
        onScan={handleScan}
        onSetAutoScan={handleSetAutoScan}
        onMoveModule={handleMoveModule}
        onPurchaseModule={handlePurchaseModule}
        onPurchaseSlot={handlePurchaseSlot}
        onSellModule={handleSellModule}
        onScrapModule={handleScrapModule}
        onUndock={handleUndock}
        onRepairHull={handleRepairHull}
        onSkipWave={handleSkipWave}
        difficulty={difficulty}
        onSetDifficulty={handleSetDifficulty}
        mapType={mapType}
        onSetMapType={handleSetMapType}
      />
      </Profiler>
    </div>
  );
};

export default App;
