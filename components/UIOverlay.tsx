
import React, { useState } from 'react';
import { EngineStats, MapType, GameState, TrailShape, TrailEmitMode } from '../types';

// Map menu is split into two labeled groups: the full-game "Maps" and the
// single-element "Test Maps" showcases (plus the multi-material Tile Heavy
// stress map).  Both the main menu and the pause screen render the same
// groups via renderMapGroup().
const REAL_MAPS: { type: MapType; label: string }[] = [
  { type: MapType.UNIVERSE,    label: 'Deep Space' },
  { type: MapType.RING,        label: 'Ring World' },
  { type: MapType.SEVEN_RINGS, label: 'Seven Rings' },
  { type: MapType.POCKET,      label: 'Pocket' },
];
const TEST_MAPS: { type: MapType; label: string }[] = [
  { type: MapType.ASTEROID_FIELD,       label: 'Asteroid Field' },
  { type: MapType.GLASS_FIELD,          label: 'Glass Field' },
  { type: MapType.PLASTIC_FIELD,        label: 'Plastic Field' },
  { type: MapType.METAL_FIELD,          label: 'Metal Field' },
  { type: MapType.INDESTRUCTIBLE_FIELD, label: 'Indestructible' },
  { type: MapType.NEBULA_FIELD,         label: 'Nebula Field' },
  { type: MapType.ROCK_FIELD,           label: 'Rock Field' },
  { type: MapType.TILE_HEAVY,           label: 'Tile Heavy' },
];

interface UIOverlayProps {
  stats: EngineStats;
  onCycleWeapon?: () => void;
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRestart?: () => void;
  onToggleDebug?: () => void;
  onCycleTrailShape?: () => void;
  onCycleTrailEmitMode?: () => void;
  onToggleLocalGravity?: () => void;
  onToggleAttractorGravity?: () => void;
  onToggleCollisions?: () => void;
  onToggleShardTileCollisions?: () => void;
  onToggleShardGravity?: () => void;
  onToggleShardBonding?: () => void;
  onToggleNebulaShardCollisions?: () => void;
  onToggleShardSleep?: () => void;
  onToggleShardViewportCull?: () => void;
  onToggleShardLod?: () => void;
  onToggleMergeRate?: () => void;
  onToggleScreenShake?: () => void;
  onToggleTileOutlines?: () => void;
  onTogglePlasticAutomata?: () => void;
  onTogglePlasticAutomataDirection?: () => void;
  onToggleMaterialAutomata?: () => void;
  onCyclePlasticPalette?: () => void;
  onCyclePlasticShardPalette?: () => void;
  onCyclePlasticGlowBrightness?: () => void;
  onCycleMetalGlowBrightness?: () => void;
  onCycleGlassGlowColor?: () => void;
  onCycleMetalGlowColor?: () => void;
  onCycleNebulaPalette?: () => void;
  onTogglePlasticBlend?: () => void;
  onCycleNebulaStretch?: () => void;
  onCycleShatterGrace?: () => void;
  onCyclePlayerThrust?: () => void;
  onCyclePlayerSpeed?: () => void;
  onCycleTileBlendAlpha?: () => void;
  onCycleShardBlendAlpha?: () => void;
  onCycleColorBlendInterval?: () => void;
  onCycleShardPairInterval?: () => void;
  onCycleShardTilePairInterval?: () => void;
  onToggleAsteroidFlow?: () => void;
  onToggleSnitchCatchMode?: () => void;
  onCycleSnitchSpeed?: () => void;
  onCycleUpgrade?: (id: string) => void;
  onMaxUpgrades?: () => void;
  onResetUpgrades?: () => void;
  onAddCredits?: () => void;
  onToggleFFOverlayVectors?: () => void;
  onToggleFFOverlayCells?: () => void;
  onToggleFFOverlayObstacles?: () => void;
  onToggleFFOverlayRebuilds?: () => void;
  onCycleFFOverlaySampleN?: () => void;
  onCycleFFDensity?: () => void;
  onCycleFFKernelR?: () => void;
  onCycleFFTangentMix?: () => void;
  onCycleFFBreathe?: () => void;
  onCycleFFLaneJitter?: () => void;
  onCycleFFPattern?: () => void;
  onTogglePerfAuto?: () => void;
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
  onCycleTrailShape,
  onCycleTrailEmitMode,
  onToggleLocalGravity,
  onToggleAttractorGravity,
  onToggleCollisions,
  onToggleShardTileCollisions,
  onToggleShardGravity,
  onToggleShardBonding,
  onToggleNebulaShardCollisions,
  onToggleShardSleep,
  onToggleShardViewportCull,
  onToggleShardLod,
  onToggleMergeRate,
  onToggleScreenShake,
  onToggleTileOutlines,
  onTogglePlasticAutomata,
  onTogglePlasticAutomataDirection,
  onToggleMaterialAutomata,
  onCyclePlasticPalette,
  onCyclePlasticShardPalette,
  onCyclePlasticGlowBrightness,
  onCycleMetalGlowBrightness,
  onCycleGlassGlowColor,
  onCycleMetalGlowColor,
  onCycleNebulaPalette,
  onTogglePlasticBlend,
  onCycleNebulaStretch,
  onCycleShatterGrace,
  onCyclePlayerThrust,
  onCyclePlayerSpeed,
  onCycleTileBlendAlpha,
  onCycleShardBlendAlpha,
  onCycleColorBlendInterval,
  onCycleShardPairInterval,
  onCycleShardTilePairInterval,
  onToggleAsteroidFlow,
  onToggleSnitchCatchMode,
  onCycleSnitchSpeed,
  onCycleUpgrade,
  onMaxUpgrades,
  onResetUpgrades,
  onAddCredits,
  onToggleFFOverlayVectors,
  onToggleFFOverlayCells,
  onToggleFFOverlayObstacles,
  onToggleFFOverlayRebuilds,
  onCycleFFOverlaySampleN,
  onCycleFFDensity,
  onCycleFFKernelR,
  onCycleFFTangentMix,
  onCycleFFBreathe,
  onCycleFFLaneJitter,
  onCycleFFPattern,
  onTogglePerfAuto,
  onSkipWave,
  difficulty = 3,
  onSetDifficulty,
  mapType = MapType.UNIVERSE,
  onSetMapType,
}) => {
  const isGrace = stats.waveStatus === 'cleared' && (stats.waveGraceTimer ?? 0) > 0;
  const perf = stats.perf;
  // DBG-panel section collapse state.  Each named section has its
  // own bool; default expanded.  Local-only (no persistence — page
  // refresh resets), which is fine for a dev panel.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => ({
    // 'stats' stays open by default; every other section starts collapsed.
    player: true, upgrades: true, visual: true, shardsphys: true, flowfield: true,
    perf: true, timing: true,
  }));
  const toggleSection = (name: string) =>
    setCollapsed(prev => ({ ...prev, [name]: !prev[name] }));
  // Read-only filter for the top 'Entities' readout: total / active
  // (awake) / asleep (dynamic-sleeping).  Display only — does not change
  // sleeping behaviour (that's the Shards & Physics ▸ Sleep toggle).
  const [entityCountMode, setEntityCountMode] = useState<'total' | 'active' | 'asleep'>('total');

  // Labeled grid of map buttons, shared by the main menu and the pause
  // screen.  Selecting one routes through onSetMapType — a no-op-style
  // backdrop swap on the menu, a live switch-and-play mid-game.
  const renderMapGroup = (heading: string, maps: { type: MapType; label: string }[]) => (
    <div className="flex flex-col items-center gap-2">
      <span className="text-slate-400 text-[11px] uppercase tracking-wider">{heading}</span>
      <div className="flex flex-wrap justify-center gap-2 max-w-xl">
        {maps.map(opt => (
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
  );
  // Human label for the cycling blend-alpha buttons.  Mirrors the
  // four-step cycle Off / Slow / Med / Fast across both Tile and
  // Shard blend knobs; the underlying values differ per cycle (see
  // NEBULA_CONSTANTS.BLEND_*_ALPHA_CYCLE) but the label is shared.
  const blendLabel = (alpha: number | undefined): string => {
    if (!alpha) return 'Off';
    if (alpha < 0.01) return 'Slow';
    if (alpha < 0.10) return 'Med';
    return 'Fast';
  };
  // Plain JSX helper, NOT a sub-component — keeping it as a function
  // means React inlines the returned button into the parent tree
  // instead of seeing a freshly-identitied component type on every
  // render.  Avoiding the unmount/remount churn here was load-bearing
  // for touch responsiveness (UIOverlay re-renders at ~60 Hz with the
  // stats stream).
  const renderSectionHeader = (name: string, label: string) => (
    <button
      onClick={() => toggleSection(name)}
      className="pointer-events-auto mt-1 w-full flex items-center justify-between text-slate-400/80 hover:text-amber-300 uppercase tracking-wider text-[8px] transition-colors"
      title={`Toggle ${label} section`}
    >
      <span>{label}</span>
      <span className="text-slate-500">{collapsed[name] ? '▸' : '▾'}</span>
    </button>
  );
  // Two-digit ms formatter for the perf overlay.  Values under 10 ms get a
  // decimal so sub-millisecond jitter is still visible; bigger numbers
  // collapse to whole ms so the grid stays compact.
  const fmtMs = (ms: number | undefined): string => {
    if (ms === undefined) return '—';
    if (ms < 10) return ms.toFixed(2);
    return ms.toFixed(1);
  };
  // Plain JSX helpers (functions, NOT components — same inlining
  // rationale as renderSectionHeader) for the two repeated DBG row
  // shapes: a labelled cycle/toggle button, and a labelled readonly
  // value.  Collapsing every hand-rolled row to one of these is most of
  // the panel cleanup.
  const ctrlRow = (
    label: string,
    onClick: (() => void) | undefined,
    value: React.ReactNode,
    title: string,
  ) => (
    <div className="pointer-events-auto mt-1 flex items-center justify-between gap-1">
      <span className="text-slate-400/80 uppercase tracking-wider text-[8px]">{label}</span>
      <button
        onClick={onClick}
        className="bg-slate-800/70 border border-slate-600/60 rounded px-1.5 py-0.5 text-[8px] font-bold text-slate-200 hover:border-amber-400/70 hover:text-amber-300 transition-colors"
        title={title}
      >
        {value}
      </button>
    </div>
  );
  const statRow = (label: string, value: React.ReactNode, valueClass = 'text-white') => (
    // whitespace-pre keeps the leading spaces some labels use to show
    // the timing-breakdown hierarchy (updPhys ▸ ·physics ▸ ··grav).
    <div className="flex justify-between"><span className="whitespace-pre">{label}</span><span className={valueClass}>{value}</span></div>
  );
  // Top 'Entities' count under the active display filter.
  const totalEntities = perf ? perf.totalEntities : stats.entityCount;
  const asleepEntities = perf ? perf.perfAsleepCount : 0;
  const entityCountValue =
    entityCountMode === 'asleep' ? asleepEntities
    : entityCountMode === 'active' ? Math.max(0, totalEntities - asleepEntities)
    : totalEntities;
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

              {/* ── Stats (top of menu — default open) ─────────────── */}
              {renderSectionHeader('stats', 'Stats')}
              {!collapsed.stats && (<>
                {statRow('FPS', stats.fps)}
                {statRow('Wave', stats.waveNumber ?? 1)}
                {statRow('State', stats.waveStatus ?? '—')}
                {statRow('Wave timer', stats.waveTimeRemaining !== undefined ? `${stats.waveTimeRemaining}s` : '—')}
                {/* Total entity count with a display-only filter:
                    total / active (awake) / asleep (dynamic-sleeping). */}
                <div className="pointer-events-auto mt-1 flex items-center justify-between gap-1">
                  <span className="text-slate-400/80 uppercase tracking-wider text-[8px]">Entities</span>
                  <span className="flex items-center gap-1">
                    <span className="text-white">{entityCountValue}</span>
                    <select
                      value={entityCountMode}
                      onChange={e => setEntityCountMode(e.target.value as 'total' | 'active' | 'asleep')}
                      className="pointer-events-auto bg-slate-800/70 border border-slate-600/60 rounded text-[8px] font-bold text-slate-200 px-0.5 outline-none hover:border-amber-400/70"
                      title="Entity-count filter (display only): total = all entities, active = awake, asleep = dynamic-sleeping (count of resting shards). Sleeping behaviour itself is the Shards & Physics ▸ Sleep toggle."
                    >
                      <option value="total">total</option>
                      <option value="active">active</option>
                      <option value="asleep">asleep</option>
                    </select>
                  </span>
                </div>
              </>)}

              {/* ── Player ─────────────────────────────────────────── */}
              {renderSectionHeader('player', 'Player')}
              {!collapsed.player && (<>
                {ctrlRow('Thrust', onCyclePlayerThrust, stats.playerThrustName ?? '0.75×',
                  'Player THRUST multiplier (0.75 / 1 / 1.25 / 1.5×) applied live to the per-map acceleration. Terminal cruise = acceleration/(1−friction), so this is the knob that actually changes everyday top speed.')}
                {ctrlRow('Speed', onCyclePlayerSpeed, stats.playerSpeedName ?? '1×',
                  'Player SPEED multiplier (0.5 / 0.75 / 1 / 1.5 / 2 / 3×) applied live to the per-map maxSpeed cap. Only changes top speed when the cap falls below the friction-limited terminal velocity (or thrust raises cruise above it).')}
                {ctrlRow('Snitch catch', onToggleSnitchCatchMode,
                  stats.snitchCatchMode === 'shoot' ? 'Shoot' : 'Collide',
                  'How the golden snitch is caught (testing toggle). Collide: fly into it hull-to-hull. Shoot: any player shot within its catch radius nabs it. Either way the catch pays the snitch bonus and ends the wave immediately.')}
                {ctrlRow('Snitch spd', onCycleSnitchSpeed,
                  stats.snitchSpeedName ?? '1×',
                  'Snitch-speed multiplier (0.5 / 0.75 / 1 / 1.5 / 2×) scaling its speed live on top of the per-wave ramp. The snitch starts at 0.05× player cruise on wave 1 and gains 0.05× each wave (capped at 1.2×); this knob scales that for testing. Lower = easier to catch.')}
              </>)}

              {/* ── Upgrades (progression spine — DBG) ─────────────── */}
              {renderSectionHeader('upgrades', 'Upgrades')}
              {!collapsed.upgrades && (<>
                {statRow('Salvage', (stats.credits ?? 0).toLocaleString(), 'text-amber-300')}
                {(stats.upgrades ?? []).map(u =>
                  ctrlRow(u.label, () => onCycleUpgrade?.(u.id), `Lv ${u.level}/${u.max}`,
                    `Cycle ${u.label} upgrade level (DBG). Click bumps the level and wraps back to 0 at max; applies live to the player's effective stats.`))}
                {ctrlRow('+1k Salv', onAddCredits, 'Grant',
                  'Grant 1000 Salvage for testing the (future) shop.')}
                {ctrlRow('Max all', onMaxUpgrades, 'Max',
                  'Set every upgrade to its max level.')}
                {ctrlRow('Reset', onResetUpgrades, 'Clear',
                  'Reset every upgrade back to level 0.')}
              </>)}

              {/* ── Visual ─────────────────────────────────────────── */}
              {renderSectionHeader('visual', 'Visual')}
              {!collapsed.visual && (<>
                {ctrlRow('Trail', onCycleTrailShape,
                  stats.trailShape === TrailShape.SQUARE ? 'Square'
                    : stats.trailShape === TrailShape.TRIANGLE ? 'Triangle'
                    : stats.trailShape === TrailShape.LINE ? 'Line'
                    : stats.trailShape === TrailShape.PATH ? 'Path'
                    : stats.trailShape === TrailShape.DOTS ? 'Dots'
                    : stats.trailShape === TrailShape.NONE ? 'None'
                    : 'Circle',
                  'Cycle the player trail shape: Circle → Square → Triangle → Line → Path → Dots → None.')}
                {ctrlRow('Trail dir', onCycleTrailEmitMode,
                  stats.trailEmitMode === TrailEmitMode.THRUST ? 'Thrust' : 'Velocity',
                  'Trail emit direction: Velocity vs Thrust.')}
                {ctrlRow('Screen shake', onToggleScreenShake,
                  stats.screenShakeEnabled === false ? 'Off' : 'On',
                  'Camera screen-shake on impacts. Off keeps the camera anchored and cancels in-flight shakes immediately.')}
                {ctrlRow('Outlines', onToggleTileOutlines,
                  stats.tileOutlinesEnabled === true ? 'On' : 'Off',
                  'Collision-shape outlines on plastic + nebula tiles/shards (soft-gradient variants). Shows the SAT polygon against the gradient fill.')}
                {ctrlRow('Pl shade', onTogglePlasticAutomata,
                  stats.plasticAutomataEnabled === true ? 'On' : 'Off',
                  'Plastic-shard neighbour-brightness automata. On: palette base shade darkened by contact count (like nebula interior-darkening); Off: per-instance random shades.')}
                {ctrlRow('Shade dir', onTogglePlasticAutomataDirection,
                  stats.plasticAutomataBrighten === true ? 'Bright' : 'Dark',
                  'Plastic automata direction: Darken dense cluster interiors (default) or Brighten. Only affects rendering while Pl shade is On.')}
                {ctrlRow('Tile shade', onToggleMaterialAutomata,
                  stats.materialAutomataEnabled === true ? 'On' : 'Off',
                  'Material-tile neighbour-brightness automata (glass/metal/rock). On: dense cluster interiors shift brightness by same-variant hex-neighbour count (per-variant default: metal brightens, rock darkens); cluster edges and lone tiles stay at the base colour.')}
                {ctrlRow('Palette', onCyclePlasticPalette,
                  stats.plasticPaletteName ?? 'litegreen',
                  'Cycle the plastic-TILE palette family. Re-rolls every active plastic-tile colour on toggle. Plastic-shards have their own independent cycle (Shard pal).')}
                {ctrlRow('Shard pal', onCyclePlasticShardPalette,
                  stats.plasticShardPaletteName ?? 'litegreen',
                  'Cycle the plastic-SHARD palette family through the same list as the tile Palette button (independent index). Re-rolls every active plastic-shard colour on toggle so the change is immediate.')}
                {ctrlRow('P glow', onCyclePlasticGlowBrightness,
                  stats.plasticGlowBrightnessName ?? '1x',
                  'Cycle the plastic-tile proximity-glow brightness multiplier (1×–5×). Multiplies the variant peakAlpha so the green bloom lights up from farther away and reads brighter near contact. Plastic-shards are unaffected.')}
                {ctrlRow('M glow', onCycleMetalGlowBrightness,
                  stats.metalGlowBrightnessName ?? '1x',
                  'Cycle the metal-tile proximity-glow brightness multiplier (1×–5×). Multiplies the variant peakAlpha so the fuchsia repel-glow lights up from farther away and reads brighter near contact.')}
                {ctrlRow('Recolor', onTogglePlasticBlend,
                  stats.plasticBlendEnabled === false ? 'Off' : 'On',
                  'Toggle plastic colour equilibration. Off freezes plastic tiles + shards at their spawn/shatter colours; uses the same tile/shard blend alphas as nebula when on.')}
                {ctrlRow('Glass', onCycleGlassGlowColor,
                  stats.glassGlowColorName ?? 'sky',
                  'Cycle the glass-tile proximity glow ONLY through the 11-entry colour list (cyan / yellow / amber / gold / magenta / rose / lime / emerald / sky / violet / white). Glass shatter dust + main background nebula clusters now live on the Nebula cycle. Default sky.')}
                {ctrlRow('M color', onCycleMetalGlowColor,
                  stats.metalGlowColorName ?? 'magenta',
                  'Cycle the metal-tile proximity glow through the same 11-entry colour list as Glass (independent index). Default magenta — closest match to the legacy fuchsia. Range + peakAlpha stay with the variant; the M glow brightness multiplier is independent.')}
                {ctrlRow('Nebula', onCycleNebulaPalette,
                  stats.nebulaPaletteName ?? 'sky',
                  'Cycle the glass-side nebula palette through the same 11-entry list. Governs glass-tile shatter / merge dust ONLY (randomGlassNebulaComposition). Main background nebula tiles + shards, BG puffs, and NebulaSystem colour drift all stay on the legacy default palette and are NOT affected. Rock-side dust (rock tile original + regenerated + shards) is fixed at white. Default sky.')}
              </>)}

              {/* ── Shards & Physics ───────────────────────────────── */}
              {renderSectionHeader('shardsphys', 'Shards & Physics')}
              {!collapsed.shardsphys && (<>
                {ctrlRow('Local grav', onToggleLocalGravity,
                  stats.localGravityEnabled === false ? 'Off' : 'On',
                  'Toggle player↔asteroid local-gravity scan (PhysicsSystem.applyLocalGravity).')}
                {ctrlRow('Attract grav', onToggleAttractorGravity,
                  stats.attractorGravityEnabled === false ? 'Off' : 'On',
                  'Toggle attractor gravity scan (PhysicsSystem.applyGravity).')}
                {ctrlRow('Collisions', onToggleCollisions,
                  stats.collisionsEnabled === false ? 'Off' : 'On',
                  'Toggle the SAT collision broadphase. OFF is game-breaking — measurement aid only.')}
                {ctrlRow('Shard grav', onToggleShardGravity,
                  stats.shardGravityEnabled === false ? 'Off' : 'On',
                  'Toggle shard↔shard gravity pull (attractedTo pass in ShardSystem.runMergeBroadphase). Today only nebula-shard has a non-none attractedTo.')}
                {ctrlRow('Bonding', onToggleShardBonding,
                  stats.shardBondingEnabled === false ? 'Off' : 'On',
                  'Toggle shard↔shard bond formation + cohesion. OFF drops existing bonds and prevents new ones — nebula self-compose and cross-variant absorb stop.')}
                {ctrlRow('Neb collide', onToggleNebulaShardCollisions,
                  stats.nebulaShardCollisionsEnabled === true ? 'On' : 'Off',
                  'Toggle hard SAT collisions between nebula-shard pairs (ignores their passThrough flag). Default OFF. A/B-test whether forcing nebula pairs to bounce breaks up large gather-piles.')}
                {ctrlRow('Sleep', onToggleShardSleep,
                  stats.shardSleepEnabled === false ? 'Off' : 'On',
                  'Toggle collision-sleep for mobile shards. ON: resting shards stop resolving against each other (the bulk of a settled field) until disturbed by an awake body. OFF resolves every pair every pass.')}
                {ctrlRow('Vp cull', onToggleShardViewportCull,
                  stats.shardViewportCullEnabled === false ? 'Off' : 'On',
                  'Toggle viewport-gated shard-pair cadence. ON: two offscreen shards resolve only on a periodic catch-up pass (~8× less often); any pair near the camera resolves every pass.')}
                {ctrlRow('Shard LOD', onToggleShardLod,
                  stats.shardLodEnabled === false ? 'Off' : 'On',
                  'Toggle shard render LOD. ON: shards too small for their polygon detail to read blit a cached solid disc instead of the full polygon. Purely visual — collision/physics unaffected.')}
                {ctrlRow('Merge rate', onToggleMergeRate,
                  stats.mergeRateEnabled === false ? 'Off' : 'On',
                  'Toggle the local-density merge/absorption rate. ON: shards in dense pockets merge & absorb faster, consolidating clusters into big rocks that condense to tiles. OFF holds a neutral 1.0×. See the merge-rate readout in Perf.')}
                {ctrlRow('Grace', onCycleShatterGrace,
                  stats.shatterGraceName ?? '0.6s',
                  'Cycle the hot-spot-collapse grace delay (0.6 → 3.6s, 0.6s steps). Freshly-shattered rock/glass shards are exempt from the overlap-collapse pass for this long so debris scatters instead of re-condensing. Applies to tiles destroyed after the change.')}
                {ctrlRow('Neb stretch', onCycleNebulaStretch,
                  stats.nebulaStretchName ?? '0.07',
                  'Cycle nebula-shard velocity-stretch stiffness (K on speed → stretch): off / 0.05 / 0.07 / 0.085 / 0.10. The squash axis aligns to velocity while the sprite keeps its own rotation.')}
                {ctrlRow('Shard↔tile', onToggleShardTileCollisions,
                  stats.shardTileCollisionsEnabled === true ? 'On' : 'Off',
                  'Toggle the mobile-shard ↔ static-tile collision pass.')}
                {ctrlRow('Pair int', onCycleShardPairInterval,
                  stats.shardPairInterval === 0
                    ? `auto (${stats.shardPairEffectiveInterval ?? 1})`
                    : `every ${stats.shardPairInterval ?? 1}`,
                  'Cycle the shard-pair resolution interval. AUTO scales N with shard-cell density; manual pins it.')}
                {ctrlRow('S↔T int', onCycleShardTilePairInterval,
                  stats.shardTilePairInterval === 0
                    ? `auto (${stats.shardTilePairEffectiveInterval ?? 1})`
                    : `every ${stats.shardTilePairInterval ?? 1}`,
                  'Cycle the shard ↔ static-tile interval. Only fires when Shard↔tile is ON.')}
                {ctrlRow('Tile blend', onCycleTileBlendAlpha,
                  blendLabel(stats.tileBlendAlpha),
                  'Cycle nebula tile→tile colour blend (tiles drift toward neighbour-hex weighted hue average each frame): Off / Slow / Med / Fast.')}
                {ctrlRow('Shard blend', onCycleShardBlendAlpha,
                  blendLabel(stats.shardBlendAlpha),
                  'Cycle nebula shard→nearest-tile colour blend (shards drift toward the nearest tile hue each frame): Off / Slow / Med / Fast.')}
                {ctrlRow('Blend int', onCycleColorBlendInterval,
                  stats.colorBlendFrameInterval === 0
                    ? `auto (${stats.colorBlendEffectiveInterval ?? 1})`
                    : `every ${stats.colorBlendFrameInterval ?? 1}`,
                  'Cycle the colour-equilibration cadence. AUTO scales with active-nebula count; manual values pin the interval. Higher = cheaper but slower visual blend.')}
              </>)}

              {/* ── Flow Field (asteroid/shard FF — DBG only) ──────── */}
              {renderSectionHeader('flowfield', 'Flow Field')}
              {!collapsed.flowfield && (<>
                {ctrlRow('Pattern', onCycleFFPattern,
                  stats.ffPatternName ?? 'Map',
                  'Cycle the base-flow pattern: Map (default) → Meander → Circular → Spiral → Well → WavyWell → Outward → Horiz → Vert → WavyH → WavyV. Re-bakes the asteroid field; kernel / tangent / breathing apply on top.')}
                {ctrlRow('Ast flow', onToggleAsteroidFlow,
                  stats.asteroidFlowEnabled === false ? 'Off' : 'On',
                  'Toggle the asteroid/shard flow-field velocity nudge. OFF: asteroids decay to zero velocity and from then on only move via collisions / gravity.')}
                {ctrlRow('Density', onCycleFFDensity,
                  `${stats.ffCellSize ?? 256}u`,
                  'Cycle the FF cell size (world units): 256 → 192 → 128 → 96 → 64 → 48 → 32. Each step rebuilds both flow grids. Pursuit-field BFS range is in cells, so finer densities reduce enemy long-range pathfinding.')}
                {ctrlRow('Kernel R', onCycleFFKernelR,
                  `R=${stats.ffKernelR ?? 3}`,
                  'Cycle the wall-repulsion kernel radius (cells): 0 → 1 → 2 → 3 → 4 → 5. R=0 is the legacy 4-cardinal scan (A/B baseline); R≥1 enables the (2R+1)² kernel with 1/d² falloff — wider kernels curve the flow earlier.')}
                {ctrlRow('Tangent', onCycleFFTangentMix,
                  (stats.ffTangentMix ?? 0.5).toFixed(2),
                  'Cycle the tangent-mix factor: 0.00 → 0.25 → 0.50 → 0.75 → 1.00. 0 = pure radial repulsion (saddle dead-zones at long walls); 1 = pure tangent (slide along walls, both sides flow the same way — no saddle).')}
                {ctrlRow('Breathe', onCycleFFBreathe,
                  !stats.ffBreatheRate ? 'Off'
                    : stats.ffBreatheRate < 0.2 ? 'Slow'
                    : stats.ffBreatheRate < 0.6 ? 'Med'
                    : 'Fast',
                  'Cycle the breathing scroll rate (off / slow / med / fast). Slowly undulates the asteroid flow so convergence/saddle zones drift over time and shard piles dissolve. Re-bakes on a throttled cadence.')}
                {ctrlRow('Lane', onCycleFFLaneJitter,
                  !stats.ffLaneJitter ? 'Off'
                    : stats.ffLaneJitter < 0.15 ? 'Low'
                    : stats.ffLaneJitter < 0.3 ? 'Med'
                    : 'High',
                  'Cycle per-shard lane jitter (off / low / med / high). Each shard gets a stable perpendicular offset to its flow target so shards ride parallel lanes instead of collapsing onto one streamline.')}
                {ctrlRow('Vec overlay', onToggleFFOverlayVectors,
                  stats.ffOverlayVectors === true ? 'On' : 'Off',
                  'Toggle asteroid/shard FF vector arrows. Per-cell unit vector, sampled at the Sample N stride. Pursuit field is intentionally not drawn.')}
                {ctrlRow('Sample N', onCycleFFOverlaySampleN,
                  `every ${stats.ffOverlaySampleN ?? 1}`,
                  'Cycle the vector-overlay sample stride: 1 → 2 → 4 → 8 → 16. Stride 1 draws every cell.')}
                {ctrlRow('Cells', onToggleFFOverlayCells,
                  stats.ffOverlayCells === true ? 'On' : 'Off',
                  'Toggle asteroid/shard FF cell outlines. Draws every cell so the grid resolution and seam are visible.')}
                {ctrlRow('Obstacles', onToggleFFOverlayObstacles,
                  stats.ffOverlayObstacles === true ? 'On' : 'Off',
                  'Toggle the FF obstacle bitmap tint. Red cells are blocked. Nebula tiles should NOT appear as obstacles (PR #54 filter).')}
                {ctrlRow('Rebuilds', onToggleFFOverlayRebuilds,
                  stats.ffOverlayRebuilds === true ? 'On' : 'Off',
                  'Toggle the FF Rebuilds overlay. Cells flash amber when re-baked by onTileDestroyed (destroyed cell + 4 cardinal neighbours). Fades over ~0.6 s.')}
              </>)}

              {perf && (<>
                {/* ── Perf (entity counts + frame-skip controller) ──── */}
                {renderSectionHeader('perf', 'Perf')}
                {!collapsed.perf && (<>
                  {statRow('enemies', perf.enemyCount)}
                  {statRow('asteroids', perf.asteroidCount)}
                  {statRow('projectiles', perf.projectileCount)}
                  {statRow('particles', perf.particleCount)}
                  {statRow('drops/POI', perf.interactableCount)}
                  {statRow('max cell', perf.maxCellDensity,
                    perf.maxCellDensity >= 20 ? 'text-red-400' : perf.maxCellDensity >= 10 ? 'text-amber-300' : 'text-white')}
                  {ctrlRow('Auto', onTogglePerfAuto,
                    stats.perfAutoEnabled === false ? 'Off' : 'On',
                    'Master AUTO toggle for the performance controller. ON: skippable passes self-throttle from the load signal. OFF: every AUTO task runs every step (manual Pair int / S↔T int / Blend int pins still apply).')}
                  <div className="flex justify-between">
                    <span>load</span>
                    <span className={perf.perfLoadLevel >= 0.82 ? 'text-red-400' : perf.perfLoadLevel >= 0.38 ? 'text-amber-300' : 'text-white'}>
                      {perf.perfLoadTier} ({Math.round(perf.perfLoadLevel * 100)}%)
                    </span>
                  </div>
                  {/* Dynamic (mobile) entity count — the throttle driver,
                      with the asleep / offscreen / LOD breakdown. */}
                  <div className="flex justify-between">
                    <span>dyn ents</span>
                    <span className="text-white">
                      {perf.perfDynamicCount}
                      {(perf.perfAsleepCount > 0 || perf.perfOffscreenShards > 0 || perf.perfLodShards > 0) && (
                        <span className="text-slate-500"> ({perf.perfAsleepCount} slp{perf.perfOffscreenShards > 0 ? `, ${perf.perfOffscreenShards} off` : ''}{perf.perfLodShards > 0 ? `, ${perf.perfLodShards} lod` : ''})</span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>merge rate{stats.mergeRateEnabled === false ? ' (off)' : ''}</span>
                    <span className={stats.mergeRateEnabled === false ? 'text-slate-500' : perf.perfMergeRateMult >= 2 ? 'text-emerald-400' : perf.perfMergeRateMult >= 1.3 ? 'text-amber-300' : 'text-white'}>
                      {perf.perfMergeRateMult.toFixed(2)}×
                    </span>
                  </div>
                  {/* Per-task effective frame-skip intervals.  "·N" = AUTO
                      effective N; "·N!" = manual pin.  1 = runs every step. */}
                  {perf.perfTasks?.map(t => (
                    <div key={t.id} className="flex justify-between">
                      <span>&nbsp;·{t.id}</span>
                      <span className={t.eff >= 8 ? 'text-amber-300' : 'text-white'}>
                        {t.eff}{t.manual >= 1 ? '!' : ''}
                      </span>
                    </div>
                  ))}
                </>)}

                {/* ── Timing (ms) ──────────────────────────────────── */}
                {renderSectionHeader('timing', 'Timing (ms)')}
                {!collapsed.timing && (<>
                  {statRow('updPhys', fmtMs(perf.updatePhysicsMs))}
                  {statRow(' ·physics', fmtMs(perf.physicsMs))}
                  {statRow('  ·grav', fmtMs(perf.gravityMs))}
                  {statRow('  ·lgrv', fmtMs(perf.localGravityMs))}
                  {statRow('  ·coll', fmtMs(perf.collisionsMs))}
                  {statRow(' ·ai', fmtMs(perf.aiMs))}
                  {statRow(' ·flow', fmtMs(perf.flowFieldMs))}
                  {statRow(' ·misc', fmtMs(perf.physMiscMs))}
                  {statRow('updLogic', fmtMs(perf.updateLogicMs))}
                  {statRow(' ·shards', fmtMs(perf.shardSysMs))}
                  {statRow(' ·rings', fmtMs(perf.explosionRingsMs))}
                  {statRow(' ·weapons', fmtMs(perf.weaponsMs))}
                  {statRow(' ·drops', fmtMs(perf.dropsMs))}
                  {statRow(' ·homing', fmtMs(perf.homingMs))}
                  {statRow(' ·lightn', fmtMs(perf.lightningMs))}
                  {statRow(' ·misc', fmtMs(perf.logicMiscMs))}
                  {statRow('render', fmtMs(perf.renderMs))}
                  {statRow(' ·neb', fmtMs(perf.nebulaMs))}
                  {statRow(' ·vis-neb', perf.nebulaVisible)}
                  {statRow(' ·neb fast/slow', `${perf.nebulaFast}/${perf.nebulaSlow}`)}
                  {statRow(' ·tLit', fmtMs(perf.tileLightingMs))}
                  {statRow(' ·tLit-N', perf.tileLightingCount)}
                </>)}
              </>)}
            </div>
          )}
        </div>

        {/* Top-right: wave HUD + pause button */}
        <div className="flex items-start gap-3">

          {/* Wave info — only while playing */}
          {stats.gameState === GameState.PLAYING && (
            <div className="flex flex-col items-end gap-1">
              {/* Run score */}
              <div className="pointer-events-none bg-slate-900/75 border border-slate-600/50 rounded-lg px-4 py-1.5 shadow-lg backdrop-blur-sm text-right">
                <span className="text-amber-300 text-xs font-bold tracking-widest tabular-nums">
                  {(stats.score ?? 0).toLocaleString()} PTS
                </span>
              </div>
              {/* Kill-combo multiplier — fades out as the window lapses */}
              {(stats.comboMultiplier ?? 1) > 1 && (
                <div
                  className="pointer-events-none text-right -mt-0.5"
                  style={{ opacity: Math.max(0.3, stats.comboFraction ?? 1) }}
                >
                  <span className="text-orange-400 text-sm font-extrabold tracking-wider tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                    ×{stats.comboMultiplier} combo
                  </span>
                  {(stats.comboCount ?? 0) > 0 && (
                    <span className="text-orange-300/70 text-[10px] font-bold ml-1">
                      {stats.comboCount} kills
                    </span>
                  )}
                </div>
              )}
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
                  {stats.waveTimeRemaining !== undefined && (
                    <span className="text-cyan-300"> — {stats.waveTimeRemaining}s</span>
                  )}
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
          <div className="mb-8 flex flex-col items-center gap-5">
            {renderMapGroup('Maps', REAL_MAPS)}
            {renderMapGroup('Test Maps', TEST_MAPS)}
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
          {/* Live map picker — selecting one switches maps and drops
              straight into a fresh run (switch-and-play). */}
          <div className="mt-10 flex flex-col items-center gap-5">
            {renderMapGroup('Maps', REAL_MAPS)}
            {renderMapGroup('Test Maps', TEST_MAPS)}
          </div>
        </div>
      )}

    </div>
  );
};

export default UIOverlay;
