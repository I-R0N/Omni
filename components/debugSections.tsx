/** THE DEBUG MENU'S SECTIONS — the one place a debug knob is added.
 *
 *  Every row of the debug panel is DATA here: which GROUP it lives in, which
 *  SECTION of that group, and what the row reads and does.  `DebugMenu.tsx`
 *  renders whatever this file declares, on every screen, so a new section is
 *  one entry in `DEBUG_SECTIONS` and nothing else — no JSX, no App handler,
 *  no UIOverlay prop.  (Before this it was ~800 lines of hand-written JSX in
 *  UIOverlay fed by ~130 one-line forwarding handlers in App, and the menu and
 *  pause hosts each carried their own copy of the parts they showed.)
 *
 *  Three rules keep it honest:
 *
 *  - **A row's LABEL and ACTION are its identity.**  Docs, suites and muscle
 *    memory name rows by label ("pause ▸ Debug Menu ▸ Neb bond"), so moving a
 *    row between sections is free and renaming one is not.  Every row here
 *    was moved verbatim from the old panel — label, readout and tooltip — and
 *    `tests/debugmenu.spec.ts` pins the full set of labels.
 *  - **Rows read ONLY the stats payload** (`c.s`), exactly as the old JSX
 *    did; nothing here polls the engine for data.  Actions call the engine
 *    directly (`dbg(e => e.dbg.cycleX())`) — the same method the old App
 *    handler forwarded to, but type-checked here, where the prop chain never
 *    was (UIOverlay's props reach it untyped: the repo carries no React type
 *    definitions).
 *  - **Groups are by TASK, not by subsystem.**  "Visual" used to hold ~45
 *    rows spanning lighting, stars, trails, input and material colour; a knob
 *    now lives where someone doing that job would look, and the panel's
 *    filter box finds it wherever that is.
 */
import React from 'react';
import type { GameEngine } from '../engine/GameEngine';
import { EngineStats, MapType, EnemySubtype, TrailShape, TrailEmitMode } from '../types';
import { T_MICRO, T_NOTE, CHIP_BASE, CHIP_OFF } from './uiClasses';

// ── Types ────────────────────────────────────────────────────────────────

export type DebugGroupId =
  | 'player' | 'weapons' | 'economy' | 'world'
  | 'enemies' | 'materials' | 'visual' | 'perf';

export interface DebugGroup { id: DebugGroupId; label: string }

export type EntityCountMode = 'total' | 'active' | 'asleep';

/** Everything a row can see.  Rebuilt by DebugMenu on each render. */
export interface DebugCtx {
  /** The latest stats payload — the only GAME DATA a row reads. */
  s: EngineStats;
  /** The live engine, for ACTIONS.  Null only before the engine exists. */
  engine: () => GameEngine | null;
  /** The two actions App owns rather than the engine, because they touch
   *  App state: the canvas backing store, and the menu's map selection. */
  app: DebugAppHost;
  /** Panel-local UI state — not game data, never sent anywhere. */
  ui: DebugUiState;
}

export interface DebugAppHost {
  mapType: MapType;
  setMapType: (t: MapType) => void;
  renderScaleName: string;
  cycleRenderScale: () => void;
}

export interface DebugUiState {
  entityCountMode: EntityCountMode;
  setEntityCountMode: (m: EntityCountMode) => void;
  perfCopyText: string;
  perfCopied: boolean;
  copyPerfReport: () => void;
  dismissPerfReport: () => void;
}

/** One chip in a chip row (maps, enemy test, bosses, dragons, rivals). */
export interface DebugChip {
  key: string;
  label: string;
  act: (c: DebugCtx) => void;
  /** Selected state, for the pickers (the map, the forced enemy). */
  active?: boolean;
  /** Classes while `active`. */
  on?: string;
  /** The hover accent — the only thing an unselected chip varies by group. */
  hover: string;
  title?: string;
  capitalize?: boolean;
}

export interface DebugButton { label: string; title: string; act: (c: DebugCtx) => void }

/** A row.  `ctrl` and `stat` are the two shapes nearly every row takes (the
 *  old `ctrlRow` / `statRow`); the others cover the handful that do not. */
export type DebugRow =
  /** A labelled cycle / toggle: the value IS the button. */
  | { kind: 'ctrl'; label: string; title: string;
      act: (c: DebugCtx) => void; value: (c: DebugCtx) => React.ReactNode }
  /** A labelled read-only value, optionally coloured by `tone`. */
  | { kind: 'stat'; label: string;
      value: (c: DebugCtx) => React.ReactNode; tone?: (c: DebugCtx) => string }
  /** A label with a few small buttons (the module Mk grants). */
  | { kind: 'buttons'; label: string; buttons: readonly DebugButton[] }
  /** A wrap of full-size chips; `label` is what the filter matches. */
  | { kind: 'chips'; label: string; chips: (c: DebugCtx) => readonly DebugChip[] }
  /** Lays itself out; `label` is what the filter matches. */
  | { kind: 'custom'; label: string; render: (c: DebugCtx) => React.ReactNode }
  /** Rows only known at render time (the weapon catalog, perf tasks). */
  | { kind: 'each'; label: string; rows: (c: DebugCtx) => readonly DebugRow[] };

export interface DebugSection {
  /** Stable key — the panel remembers which sections are open by it. */
  id: string;
  label: string;
  group: DebugGroupId;
  rows: readonly DebugRow[];
  /** Open the first time the panel shows it (Stats, as before). */
  defaultOpen?: boolean;
  /** Hide the section entirely while this is false (no perf snapshot yet). */
  when?: (c: DebugCtx) => boolean;
}

// ── Shared row styling (also read by DebugMenu's renderer) ───────────────

/** A row's label.  `whitespace-pre` keeps the leading spaces some labels use
 *  to show hierarchy (`  ↳ range`, the timing tree's `·physics`). */
export const ROW_LABEL = `text-slate-400/80 uppercase tracking-wider ${T_MICRO} whitespace-pre`;
/** A read-only readout row. */
export const STAT_ROW = 'flex justify-between gap-2';

/** `onMouseDown` for every button in the panel.  A MOUSE click must not move
 *  keyboard focus into the panel: keys pressed at a focused debug control
 *  never reach the ship (InputSystem.isUiKeyTarget), so over live play a
 *  clicked row would otherwise leave WASD dead — and the next Space or Enter
 *  would press the row again.  Keyboard focus (Tab) and pad focus (menu nav)
 *  never pass through mousedown, so both still land.  Not for the filter box
 *  or a `<select>`, which need focus. */
export const keepFocus = (e: React.MouseEvent) => e.preventDefault();

// ── Row constructors ─────────────────────────────────────────────────────

/** An engine ACTION.  Rows never cache the engine; they ask for it at click
 *  time, so a row declared at module load works however late the engine is
 *  built. */
const dbg = (f: (e: GameEngine) => void) => (c: DebugCtx) => {
  const e = c.engine();
  if (e) f(e);
};

/** Argument order mirrors the old `ctrlRow(label, onClick, value, title)`. */
const ctrl = (
  label: string,
  act: (c: DebugCtx) => void,
  value: (c: DebugCtx) => React.ReactNode,
  title: string,
): DebugRow => ({ kind: 'ctrl', label, act, value, title });

const stat = (
  label: string,
  value: (c: DebugCtx) => React.ReactNode,
  tone?: (c: DebugCtx) => string,
): DebugRow => ({ kind: 'stat', label, value, tone });

const chips = (label: string, list: (c: DebugCtx) => readonly DebugChip[]): DebugRow =>
  ({ kind: 'chips', label, chips: list });

const custom = (label: string, render: (c: DebugCtx) => React.ReactNode): DebugRow =>
  ({ kind: 'custom', label, render });

const each = (label: string, rows: (c: DebugCtx) => readonly DebugRow[]): DebugRow =>
  ({ kind: 'each', label, rows });

// ── Readout helpers ──────────────────────────────────────────────────────

/** Two-digit ms formatter for the timing tree.  Under 10 ms keeps a decimal
 *  so sub-millisecond jitter is still visible; bigger numbers collapse to
 *  whole-ish ms so the column stays compact. */
const fmtMs = (ms: number | undefined): string => {
  if (ms === undefined) return '—';
  if (ms < 10) return ms.toFixed(2);
  return ms.toFixed(1);
};

/** Label for the cycling nebula blend-alpha rows.  Mirrors the four-step
 *  Off / Slow / Med / Fast cycle across both Tile and Shard blend knobs; the
 *  underlying values differ per cycle (NEBULA_CONSTANTS.BLEND_*_ALPHA_CYCLE)
 *  but the label is shared. */
const blendLabel = (alpha: number | undefined): string => {
  if (!alpha) return 'Off';
  if (alpha < 0.01) return 'Slow';
  if (alpha < 0.10) return 'Med';
  return 'Fast';
};

// ── Tables the chip rows are built from ──────────────────────────────────

/** The full-game maps.  Picking one is a DEBUG override that lasts the run it
 *  starts (CLAUDE.md §3) — from the menu it swaps the backdrop START will
 *  use; mid-game it is a live switch-and-play. */
export const REAL_MAPS: readonly { type: MapType; label: string }[] = [
  // Wave-free home map: station POIs + ambient roamers.  No waves.
  { type: MapType.OVERWORLD,   label: 'Overworld' },
  { type: MapType.UNIVERSE,    label: 'Deep Space' },
  { type: MapType.RING,        label: 'Ring World' },
  { type: MapType.SEVEN_RINGS, label: 'Seven Rings' },
  { type: MapType.POCKET,      label: 'Pocket' },
];

/** The single-element showcase maps (plus the multi-material Tile Heavy
 *  stress map). */
export const TEST_MAPS: readonly { type: MapType; label: string }[] = [
  { type: MapType.ASTEROID_FIELD,       label: 'Asteroid Field' },
  { type: MapType.GLASS_FIELD,          label: 'Glass Field' },
  { type: MapType.PLASTIC_FIELD,        label: 'Plastic Field' },
  { type: MapType.METAL_FIELD,          label: 'Metal Field' },
  { type: MapType.INDESTRUCTIBLE_FIELD, label: 'Indestructible' },
  { type: MapType.NEBULA_FIELD,         label: 'Nebula Field' },
  { type: MapType.ROCK_FIELD,           label: 'Rock Field' },
  { type: MapType.TILE_HEAVY,           label: 'Tile Heavy' },
];

/** Enemy-test override — force every wave to spawn one subtype (or Off).
 *  BUBBLE is ambient fauna (always present in normal play), not a forceable
 *  wave enemy — so it is intentionally absent; any force-selection suppresses
 *  the ambient bubbles for clean single-type isolation. */
export const ENEMY_TEST: readonly { type: EnemySubtype | null; label: string }[] = [
  { type: null,                   label: 'Off' },
  { type: EnemySubtype.RAMMER_1,  label: 'Drone' },
  { type: EnemySubtype.RAMMER_2,  label: 'Charger' },
  { type: EnemySubtype.RAMMER_3,  label: 'Tank' },
  { type: EnemySubtype.SHOOTER_1, label: 'Skirmisher' },
  { type: EnemySubtype.SHOOTER_2, label: 'Orbiter' },
  { type: EnemySubtype.SHOOTER_3, label: 'Sniper' },
  { type: EnemySubtype.KAMIKAZE,  label: 'Kamikaze' },
  { type: EnemySubtype.BULWARK,   label: 'Bulwark' },
  { type: EnemySubtype.TURRET,    label: 'Turret' },
  { type: EnemySubtype.SWARM,     label: 'Swarm' },
  { type: EnemySubtype.NEST,      label: 'Nest' },
];

/** Capstone warp-ins, each click stacking another (the Dragon-menu
 *  pattern). */
const BOSS_SPAWNS: readonly { k: string; label: string }[] = [
  { k: 'BOSS_WARDEN', label: 'Warden' },
  { k: 'BOSS_SCATTER', label: 'Reaver' },
  { k: 'BOSS_SIEGE', label: 'Bastion' },
];

const DRAGON_SPAWNS: readonly string[] = ['glass', 'rock', 'plastic', 'metal', 'mixed'];

const RIVAL_SPAWNS: readonly { k: string; c: string }[] = [
  { k: 'hostile', c: 'hover:border-red-400' },
  { k: 'ally', c: 'hover:border-emerald-400' },
  { k: 'neutral', c: 'hover:border-amber-400' },
  { k: 'random', c: 'hover:border-sky-400' },
];

/** The module families with Mk I..III grant rows (Scanner: Mk I..V). */
const MODULE_MARK_FAMILIES: readonly (readonly [string, string])[] = [
  ['hull', 'Hull'], ['plating', 'Plating'], ['capacitor', 'Capacitor'],
  ['engine', 'Engine'], ['thrusters', 'Thrusters'],
  ['gunnery', 'Gunnery'], ['autoloader', 'Autoloader'],
  ['scanner', 'Scanner'],
];

/** One family's Mk grant row: `M1 M2 M3` buttons, each granting that mark
 *  into the inventory (auto-installs if a compatible hex is free). */
const markRow = (fam: string, label: string, marks: readonly number[]): DebugRow => ({
  kind: 'buttons',
  label,
  buttons: marks.map(mk => ({
    label: `M${mk}`,
    act: dbg(e => e.debugGrantModule(`${fam}_mk${mk}`)),
    title: `Grant ${label} Mk ${mk} into the inventory (DBG). Auto-installs if a compatible hex is free — modules are fixed items, no levels.`,
  })),
});

/** A map picker chip row — the selected map wears the indigo accent. */
const mapChips = (label: string, maps: readonly { type: MapType; label: string }[]): DebugRow =>
  chips(label, c => maps.map(m => ({
    key: m.type,
    label: m.label,
    act: (cc: DebugCtx) => cc.app.setMapType(m.type),
    active: c.app.mapType === m.type,
    on: 'bg-indigo-600 border-indigo-400 text-white shadow-lg',
    hover: 'hover:border-indigo-400',
  })));

// ── The groups, in the order the panel lists them ────────────────────────
//
// ── The sections ─────────────────────────────────────────────────────────
// Order within a group is the order the panel shows.  Rows keep the order
// they had in their old section wherever a section moved whole.

export const DEBUG_GROUPS: readonly DebugGroup[] = [
  { id: 'player', label: 'Player & Ship' },
  { id: 'weapons', label: 'Weapons & Modules' },
  { id: 'economy', label: 'Economy' },
  { id: 'world', label: 'World & Maps' },
  { id: 'enemies', label: 'Enemies & Bosses' },
  { id: 'materials', label: 'Materials' },
  { id: 'visual', label: 'Visual / HUD' },
  { id: 'perf', label: 'Perf & Diagnostics' },
];

export const DEBUG_SECTIONS: readonly DebugSection[] = [
  {
    id: 'flight', label: 'Flight', group: 'player',
    rows: [
      ctrl('Thrust', dbg(e => e.dbg.cyclePlayerThrust()),
        c => c.s.playerThrustName ?? '0.75×',
        'Player THRUST multiplier (0.75 / 1 / 1.25 / 1.5×) applied live to the per-map acceleration. Terminal cruise = acceleration/(1−friction), so this is the knob that actually changes everyday top speed.'),
      ctrl('Speed', dbg(e => e.dbg.cyclePlayerSpeed()),
        c => c.s.playerSpeedName ?? '1×',
        'Player SPEED multiplier (0.5 / 0.75 / 1 / 1.5 / 2 / 3×) applied live to the per-map maxSpeed cap. Only changes top speed when the cap falls below the friction-limited terminal velocity (or thrust raises cruise above it).'),
    ],
  },
  {
    id: 'impact', label: 'Impact Model', group: 'player',
    rows: [
      ctrl('Impact vel', dbg(e => e.dbg.cycleImpactVelocity()),
        c => c.s.impactVelocityName ?? 'muzzle (def)',
        'WHICH VELOCITY a hit\'s damage is measured in. Damage is now KINETIC — a shot carries energy, not an authored number — and energy is frame-dependent, so this is the one judgement call in it. "muzzle" (ships) scores the bolt in its own launch frame: it lands its authored damage however the ship was moving, and still falls off through a bore because that is a real loss of the bolt\'s own speed. "relative" scores true CLOSING energy against the target, which finishes the unification (the crash paths already spend a relative velocity, so a weapon hit and a hull hit become the same formula) — but a charging ship then hits 2.2-5x harder at POCKET cruise and ~9.5x on the big maps, and a shot at a target fleeing at matched speed lands nothing.'),
      ctrl('Crash energy', dbg(e => e.dbg.cycleCrashEnergy()),
        c => c.s.crashEnergyName ?? '1x (def)',
        'How much of a HULL\'s kinetic energy reaches the grain bonds it hits (1 / 0.5 / 0.25 / 2 / 4x over the calibrated coupling). A crash now spends ENERGY like a weapon hit does, so twice the closing speed is four times the bite, and the speed the impactor loses IS what it broke. The coupling is calibrated on ROCK, whose ram count is unchanged at 9; every other material then differs by its own derived toughness rather than by an authored HP (metal used to take 24 to 144 rams across six tiles of identical toughness, because a crash spent one authored HP and metal authors 24 x densityTier). This is the dial for how permeable terrain is; a material\'s own bondStrength is the same question asked of one material.'),
      ctrl('Blast energy', dbg(e => e.dbg.cycleBlastEnergy()),
        c => c.s.blastEnergyName ?? '1x (def)',
        'How much of a SHELL\'s kinetic energy becomes its BLAST (a multiplier over BLAST_ENERGY_COUPLING, which ships at 0.4). The splash was the last damage number in the roster still authored as a flat scalar: the direct bite went kinetic in step 3, the crash in step 4 and the bore in step 5, while explosionDamage sat at 10 as every round\'s bank grew tenfold and terrain started deriving ~50 HP a tile — so the blast shrank into a light show. It is now a fraction of the shell\'s own energy, which means it rides GUNNERY and the charge for free (both buy a heavier round) and the RING grows with the round too, by the square root, so its area is the energy. What it does NOT do is shrink when the shell spent its bank boring: the charge is PAYLOAD, sized at spawn, and travel energy only decides how far the round gets. The coupling is the sibling of "Crash energy" — a hull couples ~11% of a contact into breaking work, a shaped charge this much into the blast — and it is set so the charge is worth about one more hit (measured: peak 20.8 against the Cannon\'s 18 bite). The 0.5x step is the A/B against the pre-doubling blast.'),
      ctrl('Hull density', dbg(e => e.dbg.cycleHullDensity()),
        c => c.s.hullDensityName ?? '0.250 / m100 (def)',
        'How heavy the SHIP is, as a density (mass per unit of d\u00b2) and the mass it derives — a multiplier over IMPACT_DENSITY.HULL, index 0 what ships. Mass used to be an impulse term and nothing else; under the energy model it is half of what every impact SPENDS, so one number moves crash damage, knockback, the body-impact shake and the roll spring together. Read it against the MATERIAL band, which is the scale it is stated in: glass 0.010, plastic 0.013, rock 0.018, metal 0.030. The hull ships at 0.250 — 25x glass and 8x rock, deliberately, because a ship is a machine rather than a rock and should plow through gravel instead of being batted about by it. The steps walk DOWN toward that band (and one up), because the question worth judging in play is whether the hull should sit that far above it at all. Lower = you ram for less and get shoved more.'),
    ],
  },
  {
    id: 'tilt', label: 'Ship Tilt', group: 'player',
    rows: [
      ctrl('Roll feel', dbg(e => e.dbg.cyclePlayerRoll()),
        c => c.s.rollFeelName ?? 'Off',
        'Directional-tilt depth preset (SHIPS OFF; Off / Subtle / Default / Deep) stepping how far the hull pitches and rolls into a carved turn, lateral thrust or a throttle change — purely visual (physics, collision and aim never read it). Off levels out through the normal easing rather than snapping flat.'),
      ctrl('Hull', dbg(e => e.dbg.cyclePlayerHull()),
        c => c.s.hullModeName ?? 'Ship',
        'What draws at the player\'s position. Ship (DEFAULT): the legacy sprite with the cos-tilt squash — an untouched build looks exactly as it always did. Sheet: PRE-RENDERED tilt art, one authored pose per lean, snapped to the nearest cell with yaw still on the canvas (see docs/SHIP_SPRITE_SHEETS.md); falls back to the squash until art exists, and needs "Roll feel" off Off to show anything. Cube: a flat wireframe cube — at rest a square with the nose face edge-on — rotating for real in yaw + the tilt pitch/roll. Diamond: the same cube stood on a corner for a gem-cut hull. Sphere: three great circles with a nose ring at the forward pole. Dodeca: a dodecahedron with a pentagonal face forward. Rhombic: the rhombic dodecahedron, axis vertex forward. Tri: a triangular dart ship — nose, swept wingtips, dorsal peak and keel.'),
      ctrl('Roll damp', dbg(e => e.dbg.cycleRollDamping()),
        c => c.s.rollDampName ?? 'Default',
        'Rotation-damping preset (Floaty 0.5x / Default / Stiff 2x / Snappy 4x): scales the tilt spring\'s natural frequency, so the hull tracks the hand looser or tighter with the same overshoot-and-wobble character. Ship weight also slows the spring (inertia).'),
      ctrl('Tilt mode', dbg(e => e.dbg.cycleTiltMode()),
        c => c.s.tiltModeName ?? 'Lean',
        'Lean (default): the hull tilts toward the acceleration and settles back. Tumble (test): thrust drives roll RATE instead — the hull keeps rolling with its travel about the axis perpendicular to the thrust and freezes where it stops; the white aim marker hides and a fixed chevron reticle ahead of the hull carries the aim.'),
      ctrl('Lean dir', dbg(e => e.dbg.cycleLeanDir()),
        c => c.s.leanDirName ?? 'Default',
        'A/B for which way the hull tips in Lean mode. Default: bank INTO the acceleration, like an aircraft carving its turn. Reversed: both pitch and roll mirrored — the hull kicked back by its own thrust — and the wireframe re-bases NOSE-UP, so each shape\'s front face/vertex faces the screen at rest. Same signal, easing and clamps; Tumble is unaffected.'),
      ctrl('Tilt src', dbg(e => e.dbg.cycleTiltSource()),
        c => c.s.tiltSourceName ?? 'Thrust',
        'What drives the tilt signal, in BOTH tilt modes. Thrust (default): the input vector — no input, no tilt. Velocity: the ship\'s actual motion, normalized by its real cruise speed — a coasting drift holds its lean, a wall bounce reads on the hull, and a tumble keeps rolling as long as the ship moves. Average / Sum: run BOTH and blend the resulting rotation effects (not the raw inputs — each source runs its own throttle gate and slip weighting first). Average is their midpoint, so it stays inside the range either reaches alone; Sum lets them reinforce, so the hull banks SOONER — the magnitude clamp keeps it from ever banking deeper.'),
      ctrl('Vel gain', dbg(e => e.dbg.cycleVelGain()),
        c => c.s.velGainName ?? '1×',
        'Sensitivity of the Velocity tilt source (1× / 2× / 4× / 10×): multiplies the cruise-normalized velocity signal before its clamp, so higher steps reach the full tilt at ever lower speeds — 2× at half cruise, 10× on almost any motion. Saturates earlier, never tilts deeper. Thrust mode ignores it.'),
    ],
  },
  {
    id: 'trail', label: 'Trail', group: 'player',
    rows: [
      ctrl('Trail', dbg(e => e.dbg.cycleTrailShape()),
        c => c.s.trailShape === TrailShape.SQUARE ? 'Square' : c.s.trailShape === TrailShape.TRIANGLE ? 'Triangle' : c.s.trailShape === TrailShape.LINE ? 'Line' : c.s.trailShape === TrailShape.PATH ? 'Path' : c.s.trailShape === TrailShape.DOTS ? 'Dots' : c.s.trailShape === TrailShape.NONE ? 'None' : 'Circle',
        'Cycle the player trail shape: Circle → Square → Triangle → Line → Path → Dots → None.'),
      ctrl('Trail dir', dbg(e => e.dbg.cycleTrailEmitMode()),
        c => c.s.trailEmitMode === TrailEmitMode.THRUST ? 'Thrust' : 'Velocity',
        'Trail emit direction: Velocity vs Thrust.'),
    ],
  },
  {
    id: 'status', label: 'Status Effects', group: 'player',
    rows: [
      ctrl('Corrode', dbg(e => e.debugApplyCorrosion()),
        c => 'Apply',
        'Apply a corrosion stack to the player (DBG) to test the damage-over-time + HUD badge. Stacks up to 3; bleeds health past the shield.'),
      ctrl('Disable', dbg(e => e.debugApplyDisable()),
        c => 'EMP',
        'EMP the player (DBG) to test the weapon + shield disable (Stage 3c): firing is blocked and the shield goes offline (no absorb / no recharge) for the effect duration. Surfaces as a HUD badge.'),
    ],
  },
  {
    id: 'input', label: 'Controls & Input', group: 'player',
    rows: [
      stat('Gamepad', c => c.s.gamepadInfo ?? 'none', c => (c.s.gamepadInfo && c.s.gamepadInfo !== 'none') ? 'text-sky-300' : 'text-slate-400'),
      stat('  ↳ axes', c => c.s.gamepadAxes ?? '—', c => 'text-slate-400'),
      stat('  ↳ rumble', c => c.s.rumbleInfo ?? '—', c => c.s.rumbleInfo === 'ready' || c.s.rumbleInfo === 'playing' ? 'text-emerald-300' : 'text-slate-400'),
      stat('  ↳ triggers', c => c.s.adaptiveTriggerInfo ?? '—', c => c.s.adaptiveTriggersConnected ? 'text-emerald-300' : 'text-slate-400'),
      stat('  ↳ report', c => c.s.adaptiveTriggerReport ?? '—', c => 'text-slate-400'),
      ctrl('  ↳ trig enc', dbg(e => e.cycleTriggerEncoding()),
        c => c.s.adaptiveTriggerInfo?.includes('simple') ? 'simple' : 'zones',
        'Which wire encoding the trigger effects are sent in. TWO conventions are in wide use and a DualSense silently discards the one its firmware does not understand, so this is a diagnostic rather than a preference. "zones" = modes 0x21/0x25, parameters packed into ten travel zones (what the console appears to use). "simple" = modes 0x01/0x02, raw byte parameters (what most samples send). If one gives no resistance, try the other.'),
      ctrl('  ↳ HID buzz', dbg(e => e.testAdaptiveTriggerLink()),
        c => 'Test',
        'Pulses the pad MOTORS through the HID output report — the same framing and CRC the trigger effects ride, but with an encoding that is not in dispute. If this buzzes and the triggers stay limp, the transport is fine and the effect encoding is wrong (try "trig enc"). If it does not buzz, nothing is reaching the pad at all — read the error on the triggers row.'),
      ctrl('Rumble', dbg(e => e.dbg.toggleRumble()),
        c => c.s.rumbleEnabled === false ? 'Off' : 'On',
        'Gamepad force feedback. Rides the SCREEN SHAKE — every impact already funnels through one call with magnitudes tuned against each other, so the hand feels what the camera feels. Separate from the Screen shake toggle: the camera lurching and the pad buzzing are different preferences. Only dual-rumble is reachable from a browser; the DualSense adaptive triggers need WebHID (desktop Chromium only).'),
      ctrl('Joystick', dbg(e => e.dbg.toggleJoystickDebug()),
        c => c.s.joystickForceVisible === true ? 'Forced' : 'Touch',
        'Onscreen touch joystick. Touch: the widget exists only while a thumb is on the glass — the normal behaviour, and why it never ghosts onto mouse or gamepad. Forced: draw it anyway, so its size and placement can be checked on a desktop browser.'),
    ],
  },
  {
    id: 'weapons', label: 'Weapons', group: 'weapons',
    rows: [
      // With commerce station-only, this is the wave-map test path for getting
      // a weapon in hand: click = unlock (if needed) + equip.  S1/S2 = the gun
      // hex it went on.  The catalog is a PANEL-ONLY payload, so these rows
      // exist only while the panel is open, and are expanded per render.
      each('Weapons', c => (c.s.weaponCatalog ?? []).map(w =>
        ctrl(w.name, dbg(e => e.debugGrantWeapon(w.id)),
          () => w.slot !== null ? `S${w.slot + 1}` : w.owned ? 'owned' : '—',
          `Grant + equip ${w.name} (DBG). Unlocks it if not owned, then mounts it on a gun hex (first empty, else the inactive one). S1/S2 = gun hex.`))),
    ],
  },
  {
    id: 'modules', label: 'Modules', group: 'weapons',
    rows: [
      // DBG grants — varieties at fixed marks.  The scanner is the one family
      // with FIVE marks (each adds a detection tier), so its row is wider.
      ...MODULE_MARK_FAMILIES.map(([fam, label]) => markRow(fam, label,
        fam === 'scanner' ? [1, 2, 3, 4, 5] : [1, 2, 3])),
      ctrl('Shield', dbg(e => e.debugGrantModule('shield')),
        c => 'Grant',
        'Grant the Shield core module (DBG). Needs to touch a hull module on the ship flower to function.'),
      ctrl('Overcharge', dbg(e => e.debugGrantModule('overcharge')),
        c => 'Grant',
        'Grant the Overcharge module (DBG). Needs to touch a gun on the weapon flower to function.'),
      ctrl('Light', dbg(e => e.debugGrantModule('flashlight_kit')),
        c => 'Grant',
        'Grant the Light module (DBG). Needs to touch a hull module to function; then tap your ship in open space to cycle the light off / medium / high (the beam style at the medium / high lighting tiers).'),
      ctrl('Outfit all', dbg(e => e.debugOutfitAll()),
        c => 'Max',
        'Outfit a full Mk III loadout in a canonical layout that satisfies every adjacency requirement, spare guns in the inventory (DBG).'),
      ctrl('Reset', dbg(e => e.resetOutfit()),
        c => 'Lean',
        'Reset to the lean run start: bare hexes, empty inventory, Blaster on gun hex W1.'),
    ],
  },
  {
    id: 'salvage', label: 'Salvage & Stations', group: 'economy',
    rows: [
      stat('Salvage', c => (c.s.credits ?? 0).toLocaleString(), c => 'text-amber-300'),
      ctrl('+1M Salv', dbg(e => e.addDebugCredits(1_000_000)),
        c => 'Grant',
        'Grant 1,000,000 Salvage for testing the station shops.'),
      ctrl('Station', dbg(e => e.debugTeleportToStation()),
        c => 'Go',
        'Teleport the player to the station\'s doorstep (docking-test harness). Overworld only — no-op on maps without a station.'),
      ctrl('Lock slots', dbg(e => e.dbg.cycleSlotLock()),
        c => c.s.debugSlotLock ?? '—',
        'A5 — lock hexes off BOTH flowers (7 / 5 / 4 / 3) so the station\'s "+1 Hex Slot" purchase can be flown. A shipped run starts with every hex unlocked, so this is the only way to see the locked state. Modules in a hex that locks go back to the hold (scrapped if it is full — DBG).'),
    ],
  },
  {
    id: 'maps', label: 'Maps', group: 'world',
    rows: [
      mapChips('Maps', REAL_MAPS),
    ],
  },
  {
    id: 'fieldmaps', label: 'Material Field Maps', group: 'world',
    rows: [
      mapChips('Material Field Maps', TEST_MAPS),
    ],
  },
  {
    id: 'portal', label: 'Portals', group: 'world',
    rows: [
      ctrl('Transit fx', dbg(e => e.dbg.cyclePortalWarp()),
        c => c.s.portalWarpName ?? '0.9s',
        'Length of the flight-THROUGH beat played on arrival (0.9 / 0.6 / 1.4s / off) — the tunnel that unrolls the lens into radial streaks, streams the sky outward and decelerates onto the destination. The sim is FROZEN for its duration (the stage-clear pattern), so nothing can shoot you inside the tunnel and the beat costs no simulation; "off" transitions instantly, exactly as before it existed. Takes effect on the next transit.'),
      ctrl('Size', dbg(e => e.dbg.cyclePortalSize()),
        c => c.s.portalSizeName ?? '1×',
        'Rift SIZE multiplier (1 / 0.75 / 0.5 / 0.35 / 1.25×) — scales the drawn mouth, the horizon that swallows shards, and the star-lens radius together, live on the portals already placed. Deliberately does NOT change how close you must be to ENTER (USE_RANGE): that is an interaction rule, not a look, and moving it would make the other comparisons unreadable.'),
      ctrl('Gravity', dbg(e => e.dbg.cyclePortalGravity()),
        c => c.s.portalGravityName ?? '1×',
        'Portal gravity STRENGTH (1 / 0.5 / 0.25 / off / 1.5×) — how hard the well pulls shards, enemies and drops (the player always feels only GRAVITY_PLAYER_SCALE of it). "off" leaves the art and the lens untouched, so this isolates the pull from the look.'),
      ctrl('  ↳ range', dbg(e => e.dbg.cyclePortalGravityRange()),
        c => c.s.portalGravityRangeName ?? '1×',
        'How far the pull REACHES (1 / 0.75 / 0.5 / 1.5× of GRAVITY_RANGE). Separate from strength because a well can be too WIDE without being too strong — a short, firm well reads as a mouth, a long faint one as the whole area sagging.'),
      ctrl('Lens', dbg(e => e.dbg.cyclePortalLens()),
        c => c.s.portalLensName ?? '1×',
        'Background star-warp strength (1 / 0.5 / 0.25 / off / 1.5 / 2 / 3×). Scales the radial push off the throat AND the twist, both of which are bounded, so each step visibly flattens the distortion. At "off" the star field takes its original untouched draw path — the cheapest possible A/B against the warp existing at all. The warped region hugs the black disc (4× its radius), so it also shrinks with Size and with a smaller destination.'),
      ctrl('  ↳ radius', dbg(e => e.dbg.cyclePortalLensRadius()),
        c => c.s.portalLensRadiusName ?? '4×',
        'How much SKY the warp covers, as a multiple of the rift\'s black-disc radius (4 / 6 / 9 / 14 / 2.5×) — separate from Lens, because how WIDE the bend reaches and how HARD it bends are different questions. It rides the disc, so it also inherits the destination-span scaling and the Size knob: a Pocket rift warps a small patch, Deep Space a wide one.'),
      ctrl('  ↳ spin', dbg(e => e.dbg.cyclePortalLensSpin()),
        c => c.s.portalLensSpinName ?? '1×',
        'Star-lens SPIN (1 / 0.5 / 0.25 / frozen / 2×) — the rate the bounded twist BREATHES, nothing else. The twist no longer accumulates over time (that is what used to wind the field into bands), so this changes only how fast the bend swells and relaxes; "frozen" holds it at its standing value for a completely static warp.'),
      stat('  ↳ live', c => c.s.portalTuningInfo ?? '—', c => 'text-slate-400'),
    ],
  },
  {
    id: 'flowfield', label: 'Flow Field', group: 'world',
    rows: [
      ctrl('Pattern', dbg(e => e.dbg.cycleFFPattern()),
        c => c.s.ffPatternName ?? 'Map',
        'Cycle the base-flow pattern: Map (default) → Meander → Circular → Spiral → Well → WavyWell → Outward → Horiz → Vert → WavyH → WavyV. Re-bakes the asteroid field; kernel / tangent / breathing apply on top.'),
      ctrl('Ast flow', dbg(e => e.dbg.toggleShardFlow()),
        c => c.s.shardFlowEnabled === false ? 'Off' : 'On',
        'Toggle the asteroid/shard flow-field velocity nudge. OFF: asteroids decay to zero velocity and from then on only move via collisions / gravity.'),
      ctrl('Density', dbg(e => e.dbg.cycleFFDensity()),
        c => `${c.s.ffCellSize ?? 256}u`,
        'Cycle the FF cell size (world units): 256 → 192 → 128 → 96 → 64 → 48 → 32. Each step rebuilds both flow grids. Pursuit-field BFS range is in cells, so finer densities reduce enemy long-range pathfinding.'),
      ctrl('Kernel R', dbg(e => e.dbg.cycleFFKernelR()),
        c => `R=${c.s.ffKernelR ?? 3}`,
        'Cycle the wall-repulsion kernel radius (cells): 0 → 1 → 2 → 3 → 4 → 5. R=0 is the legacy 4-cardinal scan (A/B baseline); R≥1 enables the (2R+1)² kernel with 1/d² falloff — wider kernels curve the flow earlier.'),
      ctrl('Tangent', dbg(e => e.dbg.cycleFFTangentMix()),
        c => (c.s.ffTangentMix ?? 0.5).toFixed(2),
        'Cycle the tangent-mix factor: 0.00 → 0.25 → 0.50 → 0.75 → 1.00. 0 = pure radial repulsion (saddle dead-zones at long walls); 1 = pure tangent (slide along walls, both sides flow the same way — no saddle).'),
      ctrl('Breathe', dbg(e => e.dbg.cycleFFBreathe()),
        c => !c.s.ffBreatheRate ? 'Off' : c.s.ffBreatheRate < 0.2 ? 'Slow' : c.s.ffBreatheRate < 0.6 ? 'Med' : 'Fast',
        'Cycle the breathing scroll rate (off / slow / med / fast). Slowly undulates the asteroid flow so convergence/saddle zones drift over time and shard piles dissolve. Re-bakes on a throttled cadence.'),
      ctrl('Lane', dbg(e => e.dbg.cycleFFLaneJitter()),
        c => !c.s.ffLaneJitter ? 'Off' : c.s.ffLaneJitter < 0.15 ? 'Low' : c.s.ffLaneJitter < 0.3 ? 'Med' : 'High',
        'Cycle per-shard lane jitter (off / low / med / high). Each shard gets a stable perpendicular offset to its flow target so shards ride parallel lanes instead of collapsing onto one streamline.'),
      ctrl('Vec overlay', dbg(e => e.dbg.toggleFFOverlayVectors()),
        c => c.s.ffOverlayVectors === true ? 'On' : 'Off',
        'Toggle asteroid/shard FF vector arrows. Per-cell unit vector, sampled at the Sample N stride. Pursuit field is intentionally not drawn.'),
      ctrl('Sample N', dbg(e => e.dbg.cycleFFOverlaySampleN()),
        c => `every ${c.s.ffOverlaySampleN ?? 1}`,
        'Cycle the vector-overlay sample stride: 1 → 2 → 4 → 8 → 16. Stride 1 draws every cell.'),
      ctrl('Cells', dbg(e => e.dbg.toggleFFOverlayCells()),
        c => c.s.ffOverlayCells === true ? 'On' : 'Off',
        'Toggle asteroid/shard FF cell outlines. Draws every cell so the grid resolution and seam are visible.'),
      ctrl('Obstacles', dbg(e => e.dbg.toggleFFOverlayObstacles()),
        c => c.s.ffOverlayObstacles === true ? 'On' : 'Off',
        'Toggle the FF obstacle bitmap tint. Red cells are blocked. Nebula tiles should NOT appear as obstacles (PR #54 filter).'),
      ctrl('Rebuilds', dbg(e => e.dbg.toggleFFOverlayRebuilds()),
        c => c.s.ffOverlayRebuilds === true ? 'On' : 'Off',
        'Toggle the FF Rebuilds overlay. Cells flash amber when re-baked by onTileDestroyed (destroyed cell + 4 cardinal neighbours). Fades over ~0.6 s.'),
    ],
  },
  {
    id: 'enemytest', label: 'Enemy Test', group: 'enemies',
    rows: [
      // Force every wave to spawn one subtype (or Off).  BUBBLE is ambient
      // fauna, not a forceable wave enemy, so it is deliberately absent.
      chips('Force one type', c => ENEMY_TEST.map(opt => ({
        key: opt.label, label: opt.label,
        act: dbg(e => e.setForcedTestEnemy(opt.type)),
        active: (c.s.forcedEnemy ?? null) === (opt.type ?? null),
        on: 'bg-rose-600 border-rose-400 text-white shadow-lg', hover: 'hover:border-rose-400',
      }))),
    ],
  },
  {
    id: 'enemytuning', label: 'Enemy Tuning', group: 'enemies',
    rows: [
      ctrl('Enemy scale', dbg(e => e.dbg.cycleEnemyScale()),
        c => c.s.enemyScaleName ?? '1×',
        'Multiplier on the per-wave enemy HP+damage growth (1 / 0 / 0.5 / 1.5 / 2×). 0 disables wave scaling; 2× doubles it. Tuned for a comfortable player lead. Applies to enemies spawned after the change.'),
      stat('  ↳ live', c => c.s.enemyScaleInfo ?? '—', c => 'text-slate-400'),
      ctrl('Traits', dbg(e => e.toggleTraits()),
        c => c.s.traitsEnabled === false ? 'Off' : 'On',
        'Enemy counterplay traits (armor chip-resist, …). ON: the Tank shrugs off small per-hit damage so heavy weapons are demanded — its damage numbers read low when chipped. OFF disables the soft-counter engine.'),
      ctrl('Gnat move', dbg(e => e.dbg.cycleSwarmMove()),
        c => c.s.swarmMoveName ?? 'boids',
        'Cycle the Swarm gnat movement: boids (flock) → vortex (orbit + dart) → weave (serpentine) → burst (coast + telegraphed dash). Applies live to all gnats.'),
    ],
  },
  {
    id: 'snitch', label: 'Snitch', group: 'enemies',
    rows: [
      ctrl('Snitch catch', dbg(e => e.dbg.toggleSnitchCatchMode()),
        c => c.s.snitchCatchMode === 'shoot' ? 'Shoot' : 'Collide',
        'How the golden snitch is caught (testing toggle). Collide: fly into it hull-to-hull. Shoot: any player shot within its catch radius nabs it. Either way the catch pays the snitch bonus and ends the wave immediately.'),
      ctrl('Snitch spd', dbg(e => e.dbg.cycleSnitchSpeed()),
        c => c.s.snitchSpeedName ?? '1×',
        'Snitch-speed multiplier (0.5 / 0.75 / 1 / 1.5 / 2×) scaling its speed live on top of the per-CATCH ramp. The first snitch flies at 0.05× player cruise and gains 0.05× each time one is CAUGHT (capped at 1.2×) — deferring the catch keeps it slow. This knob scales that for testing.'),
    ],
  },
  {
    id: 'boss', label: 'Bosses', group: 'enemies',
    rows: [
      chips('Warp in a boss', () => BOSS_SPAWNS.map(({ k, label }) => ({
        key: k, label,
        act: dbg(e => e.debugSpawnBoss(k)),
        title: 'Warp this boss in with its full phase table (DBG). Each click stacks another.',
        hover: 'hover:border-rose-400',
      }))),
    ],
  },
  {
    id: 'dragon', label: 'Dragon', group: 'enemies',
    rows: [
      chips('Summon a dragon', () => DRAGON_SPAWNS.map(t => ({
        key: t, label: t, capitalize: true,
        act: dbg(e => e.debugSpawnDragon(t)),
        hover: 'hover:border-emerald-400',
      }))),
    ],
  },
  {
    id: 'rival', label: 'Rivals', group: 'enemies',
    rows: [
      chips('Warp in a rival', () => RIVAL_SPAWNS.map(({ k, c: hover }) => ({
        key: k, label: k, capitalize: true,
        act: dbg(e => e.debugSpawnRival(k)),
        hover,
      }))),
    ],
  },
  {
    id: 'grain', label: 'Grain & Fracture', group: 'materials',
    rows: [
      ctrl('Fracture', dbg(e => e.dbg.cycleFractureMode()),
        c => c.s.fractureModeName ?? 'voronoi',
        'How fracture-capable materials break (voronoi gauntlet A/B). VORONOI (default): the entity carries a seeded Voronoi cell decomposition of its own polygon - the cells are the fragments, so a break flies apart along its own seams and conserves area. LEGACY: the shipped pre-gauntlet model - fresh random star-polygon fragments (powerlaw) and the rock-tile 3-chunk dent break. Applies at the next break; judge on a rock field.'),
      ctrl('Frac relax', dbg(e => e.dbg.cycleFractureRelax()),
        c => c.s.fractureRelaxName ?? 'material',
        'LLOYD RELAXATION rounds, forced across EVERY material - the REGULARITY dial. MATERIAL (default) defers to each material\'s own `regularity` in the grain spec, which is what lets metal be near-honeycomb while plastic stays ragged; the numbered entries override every material at once so a setting can be judged everywhere. Each round moves every Voronoi site to its own cell\'s centroid, which evens the piece SIZES out and pulls the shapes toward convex, near-hexagonal chunks. 0 is raw Poisson Voronoi (ragged, some slivers, wildly uneven); 2 (default) measured a cell-area coefficient of variation of 0.28 and roundness 0.77 against 0.53 / 0.69 at zero rounds; 4 is close to a honeycomb. Effectively free - relaxation also stops the sliver-retirement pass re-running. Takes effect on the next hit (cached patterns rebuild).'),
      ctrl('Bnd strength', dbg(e => e.dbg.cycleBoundaryStrength()),
        c => c.s.boundaryStrengthName ?? 'x1',
        'Master multiplier on every material\'s GRAIN-BOUNDARY STRENGTH - the damage it takes to break through one pixel of boundary. Under the grain model a body has no authored HP: its health is DERIVED as the total strength of its own pattern\'s boundaries, so this scales how tough all terrain is at once while the relative hardness of rock against glass stays the variant table\'s job. Ships at x1, which puts a 36px rock tile at 9 Blaster hits and a glass pane at 5. Takes effect on the next hit (cached patterns rebuild).'),
      ctrl('Dmg spread', dbg(e => e.dbg.cycleDamageSpread()),
        c => c.s.damageSpreadName ?? 'material',
        'How DEEP a hit\u0027s damage reaches into the pattern, forced across every material. OFF (the shipped behaviour) is a SEQUENTIAL spend: damage fills the nearest boundary to completion, spills into the next, and repeats - so only ever ONE boundary carries partial damage, a hit is a needle, and grains come away one at a time. A number is a WEIGHTED spend instead, as a fraction of the body\u0027s width: every unbroken boundary takes a share falling off with distance from the contact, so a hit pre-charges a whole ring and several grains can come free together. Conserving by construction - the weights are normalised and the spend is a water-fill, so the same total damage lands wherever it goes and derived HP is untouched. Small values are the useful ones: a LARGE value approaches the uniform spread V10 measured as the failure mode, where damage spread over every cell completes almost none of them. MATERIAL defers to each material\u0027s own value.'),
      ctrl('Frac sep', dbg(e => e.dbg.cycleFractureSeparation()),
        c => c.s.fractureSeparationName ?? 'material',
        'Minimum spacing between fracture sites, as a fraction of the mean cell radius - blue-noise placement BEFORE relaxation. MATERIAL (default) defers to each material\'s own `regularity`; the numbered entries force one value everywhere. Higher means sites refuse to bunch, so cells start out more even. Matters most at Frac relax 0; relaxation largely supersedes it.'),
      ctrl('Frac sites', dbg(e => e.dbg.cycleFractureSiteScale()),
        c => c.s.fractureSiteScaleName ?? 'x1',
        'Multiplier on the per-variant fracture site count - fewer, bigger chunks or more, smaller ones, without editing the variant table. Clamped by each variant\'s own min/max, so a big multiplier saturates rather than exploding the piece count.'),
      ctrl('Frac bias', dbg(e => e.dbg.cycleFractureBias()),
        c => c.s.fractureBiasName ?? 'variant',
        'Impact bias: the fraction of sites crowded toward the hit point, which is what makes the pattern radiate from the impact the way real glass does. VARIANT uses each material\'s own value (rock and glass ship 0.75). Pulls AGAINST Frac relax by design - crowding sites is precisely what makes cell sizes uneven - so 0 plus relaxation gives the most uniform chunks, and 1 plus relax 0 the most chaotic.'),
      ctrl('Chip dust', dbg(e => e.dbg.cycleChipDustPool()),
        c => c.s.chipDustPoolName ?? '1 (ships)',
        'How many chips\u2019 worth of pulverised material bank into ONE dust puff (1 ships / 2 / 4 / 6 / 9 / 14). Dust is banked as AREA, so this moves both halves at once: pooling N chips makes each puff sqrt(N) times bigger and one appear 1/N as often \u2014 larger and less frequent from one number, and FEWER entities than a puff per chip. 1 is a puff per chip: small and constant, which is what ships. Step up for bigger, rarer kicks of dust. A body that breaks before it fills a pool flushes what it has banked, so short-lived debris still throws dust.'),
      ctrl('Grain mat', dbg(e => e.dbg.cycleGrainMaterial()),
        c => c.s.grainMaterialName ?? 'rock',
        'Which MATERIAL the knob rows below read and write. NEBULA is in the list and every geometry knob reaches it; only \u2018bond str\u2019 does nothing there, because nebula takes the grain GEOMETRY without the grain DAMAGE model. The knobs above are GLOBAL - they force one value across every material at once, which is what you want for judging a setting and exactly wrong for tuning one material against another. Selecting a material changes nothing on its own. The key is the MATERIAL, not the variant: writing rock moves rock-tile and rock-shard TOGETHER, because a material\u0027s grain geometry is shared by its tile and its shard (a shard is a smaller body of the same stuff, not a different material) - a tile and its own debris drawn from two different patterns is not something that can be judged.'),
      ctrl('  ↳ grain size', dbg(e => e.dbg.cycleGrainKnob('grainSize')),
        c => c.s.grainKnobNames?.grainSize ?? '—',
        'GRAIN DIAMETER in world units, for the selected material. Site count is bodyArea / (π·(size/2)²), i.e. proportional to AREA, so grains stay the same size whatever body they are in - a tile and its shards are the same material. Smaller means more, finer grains: more interior boundary, so the body is TOUGHER as well as more finely broken, since HP is derived from boundary. A value marked (def) is the variant table\u0027s own; cycling off it shows the number bare, so a default and a deliberately-equal setting still read differently.'),
      ctrl('  ↳ count min', dbg(e => e.dbg.cycleGrainKnob('grainCountMin')),
        c => c.s.grainKnobNames?.grainCountMin ?? '—',
        'FLOOR on the site count - the documented exception to constant grain size. A body small enough to be one or two grains has almost no internal boundary and therefore almost no derived HP, and would die to a single shot; below this floor grains are finer than the material\u0027s own, deliberately. Raising it makes small shards tougher and finer; dropping it to 1 is how to SEE the collapse the floor exists to prevent.'),
      ctrl('  ↳ count max', dbg(e => e.dbg.cycleGrainKnob('grainCountMax')),
        c => c.s.grainKnobNames?.grainCountMax ?? '—',
        'CEILING on the site count - a performance guard, not a look. Decomposition is superlinear in site count, so a very large body takes coarser grains rather than hundreds of cells. Constant grain size holds BETWEEN this and the floor. Raise it to let big tiles keep true grain size (and watch the fracture cost in the Perf section); lower it for coarse chunky breaks on everything big.'),
      ctrl('  ↳ regularity', dbg(e => e.dbg.cycleGrainKnob('regularity')),
        c => c.s.grainKnobNames?.regularity ?? '—',
        'How EVEN the pattern is, 0..1 - one dial over the two knobs that produce regularity (Lloyd relaxation rounds and blue-noise site separation). 0 is raw ragged Poisson Voronoi; 0.95 is metal\u0027s near-honeycomb; plastic ships 0.55, rock and glass 0.5. Calibrated so 0.5 reproduces the old global defaults exactly. This is the per-material counterpart of Frac relax and Frac sep above - those force one value everywhere, this sets one material\u0027s own.'),
      ctrl('  ↳ bond str', dbg(e => e.dbg.cycleGrainKnob('bondStrength')),
        c => c.s.grainKnobNames?.bondStrength ?? '—',
        'Damage to break through ONE PIXEL of grain boundary, for this material alone. Under the grain model a body has no authored HP: its health is DERIVED as the sum of (edge length × strength) over its own pattern, so raising this makes the material tougher AND makes each grain harder to pop off, and a bigger body is tougher for free because it has more boundary. Deliberately NOT normalised by size, which is what lets one number serve a material\u0027s tiles and its shards. Shipped: rock 0.27, glass 0.16, plastic 0.62, metal 0.85. Bnd strength above multiplies whatever this sets.'),
      ctrl('  ↳ size spread', dbg(e => e.dbg.cycleGrainKnob('sizeSpread')),
        c => c.s.grainKnobNames?.sizeSpread ?? '—',
        'How much grain SIZES VARY within one body, 0..1 — a power diagram that shifts each cell boundary off the midpoint, so a body carries a mix of coarse and fine grains instead of one size. Varies the SPREAD around the mean, never the mean itself (that is grain size). NEBULA is the only material that ships it on, at 0.6, which is what makes a broken cloud read as unevenly torn; rock, glass, plastic and metal are parked at 0 pending a deliberate pass over all four together. Measured on a 10-grain body: cell-area CV 0.19 → 0.44 and biggest/smallest 2.0 → 5.0 across 0 → 0.6, with mean grain size unmoved.'),
      ctrl('  ↳ dmg spread', dbg(e => e.dbg.cycleGrainKnob('damageSpread')),
        c => c.s.grainKnobNames?.damageSpread ?? '—',
        'Damage spread for the selected material alone - see Dmg spread above for what it does. Every material ships 0 (sequential) — shown as \u00270 (def)\u0027 — so this is the row to turn up first when judging the effect. Dmg spread above OVERRIDES this when it is not on MATERIAL, the same way Frac relax and Frac sep override regularity. Changing it does NOT rebuild cached patterns: it changes how damage is spent, not how the pattern is built, so a half-broken body keeps the boundaries it has already earned.'),
      ctrl('  ↳ reset all', dbg(e => e.dbg.resetGrainOverrides()),
        c => `${c.s.grainOverrideCount ?? 0} off table`,
        'Drop every per-material override at once and go back to the variant table. The readout counts how many of the twenty values (four materials × five knobs) are currently overridden - with a panel this size there is otherwise no way to tell whether what you are looking at is the shipped tuning or something left set three sessions ago.'),
    ],
  },
  {
    id: 'nebula', label: 'Nebula', group: 'materials',
    rows: [
      ctrl('Neb sprite', dbg(e => e.dbg.cycleNebulaSpriteSize()),
        c => c.s.nebulaSpriteName ?? '1.25x (ships)',
        'Cycle how far a nebula sprite overhangs the body it belongs to — a multiplier over NEBULA_CONSTANTS.SPRITE_OVERSIZE (0.75× / 1× / 1.25× ships / 1.5× / 2×). The constant is calibrated so a full hex tile draws 120 world units at 1×, so the shipped step draws it at 150. Every puff is drawn at its own size × this, so the whole cloud layer scales together and a click lands on clouds already in the world.'),
      ctrl('Neb damp', dbg(e => e.dbg.cycleNebulaDamp()),
        c => c.s.nebulaDampName ?? '1x (old)',
        'How fast a nebula shard bleeds off speed \u2014 a multiplier on the per-step velocity LOSS (1x / 1.5x / 2x / 3x / 5x). Applied where the damping factor is read, so a click slows every puff already drifting. Measured baseline: shard speed does not settle, hovering ~1.3-1.7 with a max near 20.'),
      ctrl('Neb spin damp', dbg(e => e.dbg.cycleNebulaSpinDamp()),
        c => c.s.nebulaSpinDampName ?? 'match',
        'How fast a nebula shard bleeds off SPIN \u2014 its own ladder, separate from \u201cNeb damp\u201d, because linear drag decides how far a puff travels and spin decay decides how long it tumbles where it sits. \u201cmatch\u201d (the shipped default) defers to the linear knob, so the first click is the A/B.'),
      ctrl('Neb bond', dbg(e => e.dbg.cycleNebulaBond()),
        c => c.s.nebulaBondName ?? 'goo',
        'How hard a touching pair of nebula shards grips, and how long it holds before merging: cohesion blend rate, break distance, an inner range inside which the self-gravity stops pulling so cohesion is not fighting it at contact, and a multiplier on the compose threshold (off 1x / firm 2x / strong 5x / goo 12x). GOO ships; \u2018off (old)\u2019 is one click away because the cycle wraps, so the A/B against pre-feature nebula is still the first press. Stretching the timer is what makes the grip legible \u2014 at the base ~5 s a pair merges away before it reads as stuck. Merging is never switched off: compose is also how nebula shards transmute back into tiles. It COSTS entity count, which is frame time: live shard population measured 28 / 75 / 307 / 597 across the four steps.'),
      ctrl('Neb solid', dbg(e => e.dbg.cycleNebulaTileShare()),
        c => c.s.nebulaTileShareName ?? 'rare 1/8',
        'How often a CRYSTALLISING nebula cloud condenses into a solid material shard (rock / glass / plastic / metal) instead of thickening back into a nebula TILE. It was an even 50/50 and measured that way in play (53.9% tile on NEBULA_FIELD, 61.1% on UNIVERSE over 90 s), so nebula leaked into the terrain about as fast as it rebuilt itself; the shipped step makes leaving the family rare. \u2018half (old)\u2019 is the pre-call behaviour. Rock-derived dust is unaffected \u2014 it always returns to rock, which is conservation rather than conversion \u2014 and this never changes WHICH material a cloud picks, only how often it picks one at all.'),
      ctrl('Neb drain', dbg(e => e.dbg.cycleNebulaDrain()),
        c => c.s.nebulaDrainName ?? 'gentle 5u/-10%',
        'The nebula MATERIAL LEDGER: how many condense units a cloud must hold to buy a nebula TILE, and what fraction a coalescence sheds. A tile shatters into 3-4 shards of one unit each, and a tile used to cost only 2 \u2014 so the loop tile \u2192 shatter \u2192 coalesce \u2192 tile ran at ~2x and clouds grew without bound. Every step keeps the cost ABOVE the most a shatter can yield, so the ladder tunes how fast nebula recedes and cannot express growth. The two terms share one row because they are coupled: repeated merging converges on a ceiling of (1-loss)/loss, and a loss too large drops that ceiling under the cost, which reads as tiles never forming.'),
      ctrl('Neb stretch', dbg(e => e.dbg.cycleNebulaStretch()),
        c => c.s.nebulaStretchName ?? '0.10',
        'Cycle nebula-shard velocity-stretch stiffness (K on speed → stretch): off / 0.05 / 0.07 / 0.085 / 0.10 ships. The squash axis aligns to velocity while the sprite keeps its own rotation. The shipped step is the TOP of the ladder, so the cycle wraps to OFF on the first click \u2014 the A/B against no stretch at all is one press away.'),
      ctrl('Neb spin', dbg(e => e.dbg.cycleNebulaWakeSpin()),
        c => c.s.nebulaWakeSpinName ?? 'physical',
        'Which way the player\'s wake spins a passing nebula shard. PHYSICAL: the wake shear — a shard passed on the STARBOARD side turns clockwise, port-side counter-clockwise. INVERTED: the same cross product negated (the A/B). RANDOM: the old per-shard id-parity vortices, with no consistent handedness. Proper rotational mechanics are parked for their own session.'),
      ctrl('Neb collide', dbg(e => e.dbg.toggleNebulaShardCollisions()),
        c => c.s.nebulaShardCollisionsEnabled === true ? 'On' : 'Off',
        'Toggle hard SAT collisions between nebula-shard pairs (ignores their passThrough flag). Default OFF. A/B-test whether forcing nebula pairs to bounce breaks up large gather-piles.'),
      ctrl('Nebula', dbg(e => e.dbg.cycleNebulaPalette()),
        c => c.s.nebulaPaletteName ?? 'sky',
        'Cycle the glass-side nebula palette through the same 11-entry list. Governs glass-tile shatter / merge dust ONLY (randomGlassNebulaComposition). Main background nebula tiles + shards, BG puffs, and NebulaSystem colour drift all stay on the legacy default palette and are NOT affected. Rock-side dust (rock tile original + regenerated + shards) is fixed at white. Default sky.'),
    ],
  },
  {
    id: 'shardsphys', label: 'Shards & Physics', group: 'materials',
    rows: [
      ctrl('Local grav', dbg(e => e.dbg.toggleLocalGravity()),
        c => c.s.localGravityEnabled === false ? 'Off' : 'On',
        'Toggle player↔asteroid local-gravity scan (PhysicsSystem.applyLocalGravity).'),
      ctrl('Attract grav', dbg(e => e.dbg.toggleAttractorGravity()),
        c => c.s.attractorGravityEnabled === false ? 'Off' : 'On',
        'Toggle attractor gravity scan (PhysicsSystem.applyGravity).'),
      ctrl('Collisions', dbg(e => e.dbg.toggleCollisions()),
        c => c.s.collisionsEnabled === false ? 'Off' : 'On',
        'Toggle the SAT collision broadphase. OFF is game-breaking — measurement aid only.'),
      ctrl('Tile push', dbg(e => e.dbg.toggleRepelPush()),
        c => c.s.repelPushEnabled === false ? 'Off' : 'On',
        'Toggle the tile repel PUSH (glass + metal tiles — the only variants with a repel field). OFF disables only the outward velocity shove; the tile glow still reacts to a nearby player/enemy.'),
      ctrl('Shard grav', dbg(e => e.dbg.toggleShardGravity()),
        c => c.s.shardGravityEnabled === false ? 'Off' : 'On',
        'Toggle shard↔shard gravity pull (attractedTo pass in ShardSystem.runMergeBroadphase). Today only nebula-shard has a non-none attractedTo.'),
      ctrl('Bonding', dbg(e => e.dbg.toggleShardBonding()),
        c => c.s.shardBondingEnabled === false ? 'Off' : 'On',
        'Toggle shard↔shard bond formation + cohesion. OFF drops existing bonds and prevents new ones — nebula self-compose and cross-variant absorb stop.'),
      ctrl('Plr↔neb', dbg(e => e.dbg.togglePlayerNebulaCollision()),
        c => c.s.playerNebulaCollisionEnabled === false ? 'Off' : 'On',
        'Player ↔ nebula-shard hard collision. On (default): the ship physically parts/scatters the cloud (bypasses nebula passThrough → SAT impulse). Off: glide-through with only the applyNebulaPlayerPull swirl.'),
      ctrl('Sleep', dbg(e => e.dbg.toggleShardSleep()),
        c => c.s.shardSleepEnabled === false ? 'Off' : 'On',
        'Toggle collision-sleep for mobile shards. ON: resting shards stop resolving against each other (the bulk of a settled field) until disturbed by an awake body. OFF resolves every pair every pass.'),
      ctrl('Vp cull', dbg(e => e.dbg.toggleShardViewportCull()),
        c => c.s.shardViewportCullEnabled === false ? 'Off' : 'On',
        'Toggle viewport-gated shard-pair cadence. ON: two offscreen shards resolve only on a periodic catch-up pass (~8× less often); any pair near the camera resolves every pass.'),
      ctrl('Shard LOD', dbg(e => e.dbg.toggleShardLod()),
        c => c.s.shardLodEnabled === false ? 'Off' : 'On',
        'Toggle shard render LOD. ON: shards too small for their polygon detail to read blit a cached solid disc instead of the full polygon. Purely visual — collision/physics unaffected.'),
      ctrl('Merge rate', dbg(e => e.dbg.toggleMergeRate()),
        c => c.s.mergeRateEnabled === false ? 'Off' : 'On',
        'Toggle the local-density merge/absorption rate. ON: shards in dense pockets merge & absorb faster, consolidating clusters into big rocks that condense to tiles. OFF holds a neutral 1.0×. See the merge-rate readout in Perf.'),
      ctrl('Grace', dbg(e => e.dbg.cycleShatterGrace()),
        c => c.s.shatterGraceName ?? '0.6s',
        'Cycle the hot-spot-collapse grace delay (0.6 → 3.6s, 0.6s steps). Freshly-shattered rock/glass shards are exempt from the overlap-collapse pass for this long so debris scatters instead of re-condensing. Applies to tiles destroyed after the change.'),
      ctrl('Shard↔tile', dbg(e => e.dbg.toggleShardTileCollisions()),
        c => c.s.shardTileCollisionsEnabled === true ? 'On' : 'Off',
        'Toggle the mobile-shard ↔ static-tile collision pass.'),
      ctrl('Pair int', dbg(e => e.dbg.cycleShardPairInterval()),
        c => c.s.shardPairInterval === 0 ? `auto (${c.s.shardPairEffectiveInterval ?? 1})` : `every ${c.s.shardPairInterval ?? 1}`,
        'Cycle the shard-pair resolution interval. AUTO scales N with shard-cell density; manual pins it.'),
      ctrl('S↔T int', dbg(e => e.dbg.cycleShardTilePairInterval()),
        c => c.s.shardTilePairInterval === 0 ? `auto (${c.s.shardTilePairEffectiveInterval ?? 1})` : `every ${c.s.shardTilePairInterval ?? 1}`,
        'Cycle the shard ↔ static-tile interval. Only fires when Shard↔tile is ON.'),
      ctrl('Tile blend', dbg(e => e.dbg.cycleTileBlendAlpha()),
        c => blendLabel(c.s.tileBlendAlpha),
        'Cycle nebula tile→tile colour blend (tiles drift toward neighbour-hex weighted hue average each frame): Off / Slow / Med / Fast.'),
      ctrl('Shard blend', dbg(e => e.dbg.cycleShardBlendAlpha()),
        c => blendLabel(c.s.shardBlendAlpha),
        'Cycle nebula shard→nearest-tile colour blend (shards drift toward the nearest tile hue each frame): Off / Slow / Med / Fast.'),
      ctrl('Blend int', dbg(e => e.dbg.cycleColorBlendInterval()),
        c => c.s.colorBlendFrameInterval === 0 ? `auto (${c.s.colorBlendEffectiveInterval ?? 1})` : `every ${c.s.colorBlendFrameInterval ?? 1}`,
        'Cycle the colour-equilibration cadence. AUTO scales with active-nebula count; manual values pin the interval. Higher = cheaper but slower visual blend.'),
    ],
  },
  {
    id: 'look', label: 'Material Look', group: 'materials',
    rows: [
      ctrl('Rock palette', dbg(e => e.dbg.cycleRockPalette()),
        c => c.s.rockPaletteName ?? 'mixed',
        'Rock body colour family. Mixed (default): mostly slate with rust and mineral running through it, so a field reads as ROCK with variation. Slate: the old single flat grey. Rust / mineral: the pure warm and cool families, kept for regional-identity work and for judging them side by side. Shades are rolled per instance AT SPAWN — reload the map to repaint a whole field.'),
      ctrl('Tile shade', dbg(e => e.dbg.toggleMaterialAutomata()),
        c => c.s.materialAutomataEnabled === true ? 'On' : 'Off',
        'Material-tile neighbour-brightness automata (glass/metal/rock). On: dense cluster interiors shift brightness by same-variant hex-neighbour count (per-variant default: metal brightens, rock darkens); cluster edges and lone tiles stay at the base colour.'),
      ctrl('Pl shade', dbg(e => e.dbg.togglePlasticAutomata()),
        c => c.s.plasticAutomataEnabled === true ? 'On' : 'Off',
        'Plastic-shard neighbour-brightness automata. On: palette base shade darkened by contact count (like nebula interior-darkening); Off: per-instance random shades.'),
      ctrl('Shade dir', dbg(e => e.dbg.togglePlasticAutomataDirection()),
        c => c.s.plasticAutomataBrighten === true ? 'Bright' : 'Dark',
        'Plastic automata direction: Darken dense cluster interiors (default) or Brighten. Only affects rendering while Pl shade is On.'),
      ctrl('Palette', dbg(e => e.dbg.cyclePlasticPalette()),
        c => c.s.plasticPaletteName ?? 'litegreen',
        'Cycle the plastic-TILE palette family. Re-rolls every active plastic-tile colour on toggle. Plastic-shards have their own independent cycle (Shard pal).'),
      ctrl('Shard pal', dbg(e => e.dbg.cyclePlasticShardPalette()),
        c => c.s.plasticShardPaletteName ?? 'litegreen',
        'Cycle the plastic-SHARD palette family through the same list as the tile Palette button (independent index). Re-rolls every active plastic-shard colour on toggle so the change is immediate.'),
      ctrl('P glow', dbg(e => e.dbg.cyclePlasticGlowBrightness()),
        c => c.s.plasticGlowBrightnessName ?? '1x',
        'Cycle the plastic-tile proximity-glow brightness multiplier (1×–5×). Multiplies the variant peakAlpha so the green bloom lights up from farther away and reads brighter near contact. Plastic-shards are unaffected.'),
      ctrl('Recolor', dbg(e => e.dbg.togglePlasticBlend()),
        c => c.s.plasticBlendEnabled === false ? 'Off' : 'On',
        'Toggle plastic colour equilibration. Off freezes plastic tiles + shards at their spawn/shatter colours; uses the same tile/shard blend alphas as nebula when on.'),
      ctrl('Goo bond', dbg(e => e.dbg.toggleShardBlend()),
        c => c.s.shardBlendEnabled === false ? 'Off' : `On · ${c.s.shardBlendCount ?? 0}`,
        'Bonded-pair blend. On: a live cohesion bond draws as ONE blob — each goo body enveloped in a skin of its own hull grown outward, joined by a waisted metaball bridge, all filled under the hulls so a plastic shard stuck to a tile or another shard reads as goo rather than two polygons touching. Only the GOO side is coated: plastic on a glass tile coats the plastic, never the tile. Off restores the un-blended look. Presentation only: the bond itself forms, coheres and breaks the same either way. The number is how many bonds drew something last frame, so a 0 with plastic on screen means nothing is bonded rather than that the pass is broken.'),
      ctrl('Goo coat', dbg(e => e.dbg.cycleShardCoat()),
        c => c.s.shardCoatName ?? '1x',
        'Thickness of the goo COAT around each bonded body, as a multiplier over the envelope its variant authors (plastic ships 0.18 of the shard\'s circumradius). Only has an effect while Goo bond is On. Cycles UP from the shipped value because the question it exists to answer is how much thicker it should be; at 6x a shard\'s coat is about as deep as its own radius, which is past useful on purpose — a range whose top is not too far cannot show you where too far is. The variant table stays the statement of how thick that material\'s goo is; this only scales it.'),
    ],
  },
  {
    id: 'lighting', label: 'Lighting', group: 'visual',
    rows: [
      ctrl('Lighting', dbg(e => e.dbg.cycleLighting()),
        c => c.s.lightingModeName ?? 'legacy',
        'Unified tile lighting. LEGACY (default) is not "off" — it is the THREE hand-rolled models Omni ships: the player-distance proximity bloom on rock/plastic/indestructible, the repel-impulse glow on glass and metal, and the glass edge tint on its own 120 range. UNIFIED replaces all three with one shadow-casting point light at the ship: a radial falloff with a shadow wedge withheld behind every solid tile in range. Nebula is passThrough and deliberately casts NOTHING, which is why the effect reads strongly on the material showcase maps and faintly on Universe (two thirds of its static tiles are nebula). DEBUG paints a flat grey layer instead of a light — no lighting maths — so the canvas, the single blit and the smoothing restore can be checked on their own.'),
      ctrl('Light tier', dbg(e => e.dbg.cycleLightingTier()),
        c => c.s.lightingTierName ?? 'low',
        'Lighting budget. LOW (default) is the 390x844 phone: the light layer renders at a third of screen resolution, 4 lights, 24 occluders each, radius 300, hard shadows. Medium/High halve the divisor and raise every cap. The occluder cap is load-bearing rather than defensive — a radius-300 light can cover ~225 hexes in solid terrain, and the cap takes the NEAREST, which subtend the largest shadow angle, so truncation degrades gracefully.'),
      ctrl('Light bright', dbg(e => e.dbg.cycleLightBrightness()),
        c => c.s.lightBrightnessName ?? '100%',
        'How bright the player light is, 100% (default) down to 8%. This is NOT the Light tier row above: that one is a COST ladder — canvas resolution, occluder cap, radius — so dropping it to lowest changes how much work the light does and not how bright it looks. The ladder runs a long way down because the complaint it answers was not that the light was slightly hot.'),
      ctrl('Fog', dbg(e => e.dbg.cycleFog()),
        c => c.s.fogName ?? 'off',
        'FOG OF WAR: darkness the player\'s light cuts through. The light layer is already the mask — a lit shape with shadows cut out of it — so the fog is composed FROM it and costs no geometry of its own: a tile\'s shadow stays dark, and a flashlight beam opens exactly the cone it lights. DIM and DARK are the two-layer version (lit or not). MEMORY is the traditional three layers — never seen, seen before but not lit now, and lit — which needs a per-map memory of where the ship has been (one texel per 48 world units, reset on every map load; it is the renderer\'s only piece of per-map persistent state, which is why it is its own rung rather than the default). A clear disc always surrounds the ship: a narrow beam points AWAY from it, so without that the hull sits in the dark it is holding the torch in. OFF is the default — this changes how the whole game reads, and which maps want it is a design question rather than a rendering one.'),
      ctrl('Flashlight', dbg(e => e.dbg.cycleFlashlight()),
        c => c.s.flashlightName ?? 'radial',
        'The player\'s light as a directional BEAM instead of a radial glow. Points along the AIM — the same angle shots travel — so the torch goes where the ship is looking and there is no second control to fight over. Widths are the full cone: half 180° (a headlight — everything ahead, nothing behind), wide 120°, beam 80°, narrow 45°, tight 25°, pin 12° (at which point the soft edge is as wide as the beam, so it reads as a spot with no boundary at all). RADIAL (default) is the shipped 360° glow and costs nothing extra. OFF is a zero-width beam rather than a special case: the player\'s light draws nothing, so what is left on the layer is exactly the emitters (to turn the whole layer off, use Lighting: legacy). The beam masks everything the player\'s light does — falloff, shadows and caustics — but NOT the secondary emitters, because a lit metal plate is its own light and radiates in every direction; that is what makes sweeping the beam past one read as the beam finding it. A body outside the cone is also skipped entirely, since a shadow runs radially outward and cannot reach into the beam — which is what makes a narrow beam cheaper than the radial light rather than merely darker.'),
      ctrl('Light color', dbg(e => e.dbg.cycleLightColor()),
        c => c.s.lightColorName ?? 'ship',
        'What COLOUR the player\'s light is. SHIP (default) is the engine-glow blue the layer has always used, chosen so the light reads as coming from the ship rather than as a new system announcing itself; white / warm / amber / green / violet / red are there because a flashlight is equipment and equipment has a character — a tungsten beam and a cold blue-white one light the same terrain into two different games. The colour reaches everything the player\'s light does, the REFRACTED cone included, which is right: light that passes through glass keeps the colour it arrived with. The secondary emitters are deliberately unaffected — they radiate the colour of the BODY, not of what lit it.'),
      ctrl('Tint mix', dbg(e => e.dbg.cycleTintMix()),
        c => c.s.tintMixName ?? 'off',
        'How much of the MATERIAL\'s colour rides the light it passes on. Light through green glass comes out green, and a body lit by a red torch cannot re-emit blue — the layer got both wrong in opposite directions: transmitted light carried the LIGHT\'s colour with no trace of the material, and an emitter carried the MATERIAL\'s with no trace of what lit it. One knob, two applications. Emission and the refracted caustic take a blend between the two colours (0 = the light\'s, 1 = the body\'s). Straight-through transmission is tinted by MULTIPLYING the umbra by the material colour, because that light is not drawn by the shadow pass — it is what the pass chose not to erase — so it can only be coloured after the fact; 0 changes nothing there. A true product everywhere is the physical answer and it reads too dark (two saturated colours multiply toward black), so a half blend is as far as it goes. SHIPS OFF: the effect is real but subtle, because the materials\' colours sit close to the light\'s (glass indigo, metal steel-blue, both against a sky-blue lamp), and the straight-through path costs a fill per translucent group to buy it.'),
      ctrl('Emissive', dbg(e => e.dbg.toggleEmissive()),
        c => c.s.emissiveEnabled === true ? 'On' : 'Off',
        'Do METAL and GLASS re-emit the light that falls on them? ON by default, after device testing. Every lit body of those materials becomes a SECOND light at its own position — half the light it received, uniform in every direction, falling off the way the player\'s does. It replaces the contact-driven glow those two materials used to carry, which lit up when something TOUCHED them rather than when light reached them, so a metal plate across the room stayed dead however brightly it was lit. Secondary lights cast no shadows of their own unless Emit shadow asks them to: each would need its own occluder collection, and the pool is shared and consumed per light, so N emitters cost N collections on the tightest budget in the system.'),
      ctrl('World lights', dbg(e => e.dbg.toggleWorldLights()),
        c => c.s.worldLightsEnabled === true ? 'On' : 'Off',
        'A6: do the self-luminous movers — shots and the snitch — light the unified layer in their own colours? These are not emitters: an emitter\'s brightness is what the player\'s light put ON it, where a shot glows because it is on fire, so a bolt lights the walls it passes whether or not the flashlight is pointed there. They spend what is LEFT of the tier\'s maxLights after the player and the emitters (the tier\'s number stays the whole frame\'s light count), budgeted nearest-to-screen-centre, and a light whose disc misses the screen is culled before it costs anything. They cast no shadows — a shadow thrown by a bolt is unreadable at any speed, and each shadowed light is a fresh occluder collection. Off restores the exact pre-A6 layer.'),
      ctrl('Depth dark', dbg(e => e.dbg.toggleDepthAmbient()),
        c => c.s.depthAmbientEnabled === true ? 'On' : 'Off',
        'A7: each stage DESCENDED adds the light tier\'s ambientPerStage of fog-darkness (capped at four stages), folded into the fog compositor — so it is cut by the player\'s light, respects shadows, and darkens the minimap\'s memory veil, all through the one mechanism. The hub is depth 0 and never darkens; darkness is a property of going down, not a global mood. When the Fog cycle is also on, whichever of the two wants the world darker wins, so a player already running dark fog only notices depth once it exceeds their setting.'),
      ctrl('Emit bright', dbg(e => e.dbg.cycleEmitBrightness()),
        c => c.s.emitBrightnessName ?? '1/2',
        'How much of the light it receives a body re-emits, as a fraction. Only has an effect while Emissive is on. It SCALES the variant\'s own emits value against the 1/2 baseline those variants are authored at, so the default is exactly what the table says and a future material that emits less than metal still emits less than metal. Clamped at 1 in the geometry: a body cannot radiate more light than fell on it, which is the one physical claim this feature rests on.'),
      ctrl('Emit fade', dbg(e => e.dbg.cycleEmitFade()),
        c => c.s.emitFadeName ?? 'smooth',
        'How long an emitter takes to FADE in or out. Only has an effect while Emissive is on. Emission FLASHED without this, and not because of its brightness: the emitter set is chosen nearest-first and capped by the tier, so a body crossing that budget was drawn at full strength on one frame and not at all on the next. Both frames were individually right; the swap is what reads as a strobe, and near-equal distances reorder constantly as the ship moves. So a halo now eases toward its alpha and OUTLIVES its selection — a body that drops out of the budget fades where it stood rather than vanishing, and a destroyed tile\'s halo fades out too. Off is the old instantaneous behaviour, kept as the control.'),
      ctrl('Emit shadow', dbg(e => e.dbg.toggleEmitShadows()),
        c => c.s.emitShadowsEnabled === true ? 'On' : 'Off',
        'May the SECONDARY lights cast shadows of their own? Off by default, and off for cost rather than correctness. Each shadowing emitter needs its OWN occluder collection — the pool is shared and consumed per light — and its own compositing surface, because destination-out drawn onto the accumulated layer would erase the light already there rather than only the emitter\'s share. So each one composites into a scratch canvas and blits its own box back. Note this is not a TERTIARY bounce: emitters do not light other emitters, since every emitter reads its brightness from the player light\'s falloff alone.'),
      ctrl('Emit shd tier', dbg(e => e.dbg.cycleEmitShadowTier()),
        c => c.s.emitShadowTierName ?? 'std',
        'How much shadowing the SECONDARY lights get, when Emit shadow is on — a cost ladder, not a look knob. Each rung moves the two things that drive the cost together: how many emitters shadow at all, and how much geometry each of those sees. Std (default) is 4 emitters at 12 occluders; lite and min step down to 2 and 1 for the cheap end; more and max go up to 6 and 8. Past the count an emitter still LIGHTS, flatly — the tier degrades the treatment and never the count, so a cheaper rung dims no part of the scene.'),
      ctrl('Shadow soft', dbg(e => e.dbg.cycleShadowSoftness()),
        c => c.s.shadowSoftnessName ?? 'diffuse',
        'Shadow-edge softness. A point light casts a perfectly HARD shadow, which is what made the first version read as a drawn line rather than as lighting. Softness here is an ANGLE, so the soft band WIDENS with distance from the caster the way a real area light\'s does — tight against the tile, spreading further out — rather than being a uniform blur. DIFFUSE is the default (k=10, four rungs softer than the soft this shipped at); off is the hard-edged original, kept as the control. The PASS COUNT scales with k — a wide band graded over the three passes that suit a narrow one would read as stripes — so the softest rungs cost the most, up to six passes per light.'),
      ctrl('Shard shadows', dbg(e => e.dbg.toggleShardShadows()),
        c => c.s.shardShadowsEnabled === false ? 'Off' : 'On',
        'Do MOBILE SHARDS cast shadows too, or only static tiles? Only has an effect while Lighting is unified. On by default: a shard is the same shard family as the tile it broke off and about twice its radius (measured 43.6 median against a tile\'s 22), so leaving them out makes debris read as transparent to a light that solid rock is not. Nebula shards are excluded either way — same soft cloud as a nebula tile. Shards are drawn from the DYNAMIC grid, so this is a second spatial query per light; turn it off to see what that costs.'),
      ctrl('Refraction', dbg(e => e.dbg.toggleRefraction()),
        c => c.s.refractionEnabled === true ? 'On' : 'Off',
        'ON by default, after device testing. Off: glass passes light STRAIGHT THROUGH at reduced brightness, which is right for a parallel-faced pane — a slab offsets a ray sideways but does not bend it, and a regular hexagon has three pairs of parallel faces. On (default): each exit face refracts by Snell\'s law and throws an additive cone along the DEVIATED direction, scaled by the Refr bright fraction and never above the source\'s own peak, while the straight-through path is withheld in full — so the light is moved rather than added and the toggle is a real A/B. Only the exit face is refracted (a real ray bends twice, and for parallel faces the two cancel), so this over-states the bend for a tile and is about right for a wedge-shaped shard. Past the critical angle nothing is transmitted at all. The question it existed to answer — whether a caustic is legible on a light layer rendered at a third of screen resolution — was answered on the device, which is why it now ships on.'),
      ctrl('Caustic fade', dbg(e => e.dbg.cycleCausticFade()),
        c => c.s.causticFadeName ?? 'smooth',
        'How hard the CAUSTIC edges are. Only has an effect while Refraction is on. Two separate cliffs sit behind one symptom — glass clicking as you drift slowly past it. TOTAL INTERNAL REFLECTION is a step: past the critical angle a face transmits nothing, so its cone used to appear and vanish at full length as the body turned. THE OCCLUDER CAP is a step: in a dense field the pool sits saturated (measured 24 of 24 on the glass showcase), so bodies swap in and out of it as you move and an entering body brought its whole caustic at once. Both now fade the cone\'s THROW rather than its alpha — every cone in a transmit group shares one fill, and since that fill is the light\'s own falloff gradient, a shorter cone is a dimmer one. Off restores both cliffs, and is the control the fix was measured against.'),
      ctrl('Refr bright', dbg(e => e.dbg.cycleRefractBrightness()),
        c => c.s.refractBrightnessName ?? '1/2',
        'How bright the REFRACTED cone is, as a fraction of the light\'s own peak. Only has an effect while Refraction is on. Named as fractions because that is the quantity the rule is stated in — refracted light is a redistribution of light that already lost some of itself passing through the body, so it can never out-shine the source, and the geometry clamps at 1/1 regardless of what is selected here. Starts at 1/2 — half the source, which was the original ceiling — and cycles UP first, because a caustic that cannot be seen cannot be judged.'),
    ],
  },
  {
    id: 'sky', label: 'Sky', group: 'visual',
    rows: [
      ctrl('Star density', dbg(e => e.dbg.cycleStarDensity()),
        c => c.s.starDensityName ?? 'Auto',
        'Star density in stars per 10,000 CSS px². AUTO (default) uses THIS MAP\u0027s own density and shows it beside the label — every map has its own sky, from 90 near a planet up to 729 in deep space (STAR_DENSITY_BY_MAP). The other steps are overrides for comparing two settings on one map. 1200/1800/2700 run PAST the top of the per-map range on purpose — 2700 is roughly the density the field carried before it was derived from area, so the ceiling can be judged by looking at it on a device rather than argued about. The count is DERIVED from viewport area, so a phone and a desktop show the same sky per unit area. Regenerates immediately.'),
      ctrl('Star size', dbg(e => e.dbg.cycleStarSize()),
        c => c.s.starSizeName ?? 'Device px',
        'Star size floor. Bands are generated at DEVICE resolution and blitted 1:1 at whole device-pixel offsets, so no resampling filter is in the path — which makes this a real choice for the first time. Device px: a star may be a single device pixel, the finest sky the display can show. CSS px: never smaller than one CSS pixel — the apparent-size floor the field had before, but crisp instead of filtered. IDENTICAL at dpr 1; the knob only differs at dpr ≥ 2.'),
      ctrl('Star depth', dbg(e => e.dbg.cycleStarBands()),
        c => c.s.starBandsName ?? '240',
        'Parallax DEPTH LAYERS (240 / 120 / 480 / 60). The star budget is split evenly across them, so this changes how finely depth is quantised, not how many stars there are — more layers means a smoother near-to-far gradient as the camera moves. Frozen at 60 for as long as a layer was a full-viewport canvas (60 of those cost 80–316 MB); a layer is now five numbers, so 240 costs ~10 KB. Regenerates the field immediately.'),
      ctrl('Parallax', dbg(e => e.dbg.cycleStarParallax()),
        c => c.s.starParallaxName ?? 'Auto',
        'PARALLAX SPREAD — how much faster the nearest depth layer scrolls than the farthest. AUTO (default) DERIVES it from this map\u0027s density, inversely: sparse skies are NEAR skies and separate more as you move, so 90 density gives 8x spread and 729 gives 1x. Independent of Star depth: the span is set here, so adding LAYERS cuts the same range more finely rather than deepening it — which is why more layers reads as LESS separation, not more. The curve is quadratic, so near layers spread wide and far layers bunch together, the way real distance behaves.'),
    ],
  },
  {
    id: 'hud', label: 'Camera & HUD', group: 'visual',
    rows: [
      ctrl('Screen shake', dbg(e => e.dbg.toggleScreenShake()),
        c => c.s.screenShakeEnabled === false ? 'Off' : 'On',
        'Camera screen-shake on impacts. Off keeps the camera anchored and cancels in-flight shakes immediately.'),
      ctrl('Chevrons', dbg(e => e.dbg.toggleChevronMode()),
        c => c.s.chevronsOffscreenOnly === false ? 'All' : 'Offscreen',
        'Off-screen indicator chevrons. Offscreen: only nearby-but-offscreen entities get a chevron (on-screen ones are suppressed as redundant). All: also chevron on-screen entities (original behaviour).'),
      ctrl('HP bars', dbg(e => e.dbg.toggleDamageTriggeredBars()),
        c => c.s.damageTriggeredBars === false ? 'Always' : 'On damage',
        'Enemy world-space health bars. On damage (default): a bar appears when the enemy is hit and fades out after, so the bars on screen are the fights in progress rather than a label on every entity. Always: the pre-5d behaviour, every enemy carrying a bar every frame. The PLAYER has no world-space bar either way - the HUD hull/shield readout is the canonical one.'),
      ctrl('Minimap mat', dbg(e => e.dbg.cycleMinimapMaterial()),
        c => c.s.minimapMaterialName ?? 'Flow',
        'What the minimap says about MATERIAL. Flow (default): streamlines traced through the asteroid flow field — where material is GOING, drawn as 49 short lines with a pulse running downstream. Dots: the old spray of one dot per mobile shard. Off: neither. Static tiles are unaffected either way (they come from the pre-rendered terrain layer); nebula is off the minimap entirely.'),
      ctrl('Scan off', dbg(e => e.dbg.toggleScanReveal()),
        c => c.s.scanRevealAll === true ? 'REVEALED' : 'Off',
        'PERF A/B, and it SHIPS OFF \u2014 a fresh run runs the scanner. Stops the scanner\u2019s periodic work \u2014 the discovery walk (a 900-unit sweep of the static grid plus the whole mobile-shard list, on the discover cadence) and the auto sweep \u2014 and reveals every tile and contact on the minimap in exchange, so you are not measuring blind. Off-screen arrows and a pressed scan still work.'),
    ],
  },
  {
    id: 'audio', label: 'Audio', group: 'visual',
    rows: [
      ctrl('Sound burst', dbg(e => e.dbg.cycleCollapseMode()),
        c => c.s.collapseModeName ?? 'Merge',
        'How a BURST of the same sound is folded into voices — a single frame can kill 40 enemies or shatter 200 shards. MERGE (shipped): simultaneous triggers of one id collapse into ONE voice whose gain is bumped, so bulk reads as heavier rather than as forty thin copies. SOME: half the retrigger window and double the voices, so a burst of 40 lands as roughly 20 distinct hits. ALL: no collapse at all — every trigger gets a voice, under a much-raised ceiling. This is the honest \u201cwhat does 40-at-once sound like\u201d test and is expected to be ugly; that is the evidence. Three gates move together (window, polyphony, tier ceilings) because loosening one alone just moves the drop a step later.'),
    ],
  },
  {
    id: 'stats', label: 'Stats', group: 'perf', defaultOpen: true,
    rows: [
      stat('FPS', c => c.s.fps),
      stat('Wave', c => c.s.waveNumber ?? 1),
      stat('State', c => c.s.waveStatus ?? '—'),
      // KEPT AS FOUND, and dead: nothing has published `waveTimeRemaining` since
      // waves became clear-the-field (the clock counts UP now — see the wave
      // chip's `waveElapsedSec`), so this always reads '—'.  Moved, not
      // re-pointed — re-pointing it is a behaviour change for its own PR.
      stat('Wave timer', c => {
        const left = (c.s as { waveTimeRemaining?: number }).waveTimeRemaining;
        return left !== undefined ? `${left}s` : '—';
      }),
      // Total entity count with a display-only filter: total / active (awake) /
      // asleep (dynamic-sleeping).  The filter is panel-local UI state.
      custom('Entities', c => {
        const perf = c.s.perf;
        const total = perf ? perf.totalEntities : c.s.entityCount;
        const asleep = perf ? perf.perfAsleepCount : 0;
        const mode = c.ui.entityCountMode;
        const value = mode === 'asleep' ? asleep
          : mode === 'active' ? Math.max(0, total - asleep)
          : total;
        return (
          <div className="mt-1 flex items-center justify-between gap-1">
            <span className={ROW_LABEL}>Entities</span>
            <span className="flex items-center gap-1">
              <span className="text-white">{value}</span>
              <select
                value={mode}
                onChange={ev => c.ui.setEntityCountMode(ev.target.value as EntityCountMode)}
                className={`bg-slate-800/70 border border-slate-600/60 rounded ${T_MICRO} font-bold text-slate-200 px-0.5 outline-none hover:border-amber-400/70`}
                title="Entity-count filter (display only): total = all entities, active = awake, asleep = dynamic-sleeping (count of resting shards). Sleeping behaviour itself is the Shards & Physics ▸ Sleep toggle."
              >
                <option value="total">total</option>
                <option value="active">active</option>
                <option value="asleep">asleep</option>
              </select>
            </span>
          </div>
        );
      }),
    ],
  },
  {
    id: 'perfstats', label: 'Perf', group: 'perf', when: c => !!c.s.perf,
    rows: [
      stat('enemies', c => c.s.perf!.enemyCount),
      stat('asteroids', c => c.s.perf!.mobileShardCount),
      stat('projectiles', c => c.s.perf!.projectileCount),
      stat('particles', c => c.s.perf!.particleCount),
      stat('drops/POI', c => c.s.perf!.interactableCount),
      stat('max cell', c => c.s.perf!.maxCellDensity, c => c.s.perf!.maxCellDensity >= 20 ? 'text-red-400' : c.s.perf!.maxCellDensity >= 10 ? 'text-amber-300' : 'text-white'),
      ctrl('Auto', dbg(e => e.dbg.togglePerfAuto()),
        c => c.s.perfAutoEnabled === false ? 'Off' : 'On',
        'Master AUTO toggle for the performance controller. ON: skippable passes self-throttle from the load signal. OFF: every AUTO task runs every step (manual Pair int / S↔T int / Blend int pins still apply).'),
      stat('load',
        c => `${c.s.perf!.perfLoadTier} (${Math.round(c.s.perf!.perfLoadLevel * 100)}%)`,
        c => c.s.perf!.perfLoadLevel >= 0.82 ? 'text-red-400' : c.s.perf!.perfLoadLevel >= 0.38 ? 'text-amber-300' : 'text-white'),
      // Dynamic (mobile) entity count — the throttle driver, with the asleep /
      // offscreen / LOD breakdown.
      custom('dyn ents', c => {
        const perf = c.s.perf!;
        return (
          <div className={STAT_ROW}>
            <span>dyn ents</span>
            <span className="text-white">
              {perf.perfDynamicCount}
              {(perf.perfAsleepCount > 0 || perf.perfOffscreenShards > 0 || perf.perfLodShards > 0) && (
                <span className="text-slate-500"> ({perf.perfAsleepCount} slp{perf.perfOffscreenShards > 0 ? `, ${perf.perfOffscreenShards} off` : ''}{perf.perfLodShards > 0 ? `, ${perf.perfLodShards} lod` : ''})</span>
              )}
            </span>
          </div>
        );
      }),
      custom('merge rate', c => {
        const perf = c.s.perf!;
        const off = c.s.mergeRateEnabled === false;
        return (
          <div className={STAT_ROW}>
            <span>merge rate{off ? ' (off)' : ''}</span>
            <span className={off ? 'text-slate-500' : perf.perfMergeRateMult >= 2 ? 'text-emerald-400' : perf.perfMergeRateMult >= 1.3 ? 'text-amber-300' : 'text-white'}>
              {perf.perfMergeRateMult.toFixed(2)}×
            </span>
          </div>
        );
      }),
      // Per-task effective frame-skip intervals.  "N" = AUTO effective N;
      // "N!" = manual pin.  1 = runs every step.
      each('perf tasks', c => (c.s.perf?.perfTasks ?? []).map(t =>
        stat(`\u00a0·${t.id}`, () => `${t.eff}${t.manual >= 1 ? '!' : ''}`,
          () => t.eff >= 8 ? 'text-amber-300' : 'text-white'))),
    ],
  },
  {
    id: 'timing', label: 'Timing (ms)', group: 'perf', when: c => !!c.s.perf,
    rows: [
      stat('updPhys', c => fmtMs(c.s.perf!.updatePhysicsMs)),
      stat(' ·physics', c => fmtMs(c.s.perf!.physicsMs)),
      stat('  ·grav', c => fmtMs(c.s.perf!.gravityMs)),
      stat('  ·lgrv', c => fmtMs(c.s.perf!.localGravityMs)),
      stat('  ·coll', c => fmtMs(c.s.perf!.collisionsMs)),
      stat(' ·ai', c => fmtMs(c.s.perf!.aiMs)),
      stat(' ·flow', c => fmtMs(c.s.perf!.flowFieldMs)),
      stat(' ·misc', c => fmtMs(c.s.perf!.physMiscMs)),
      stat('updLogic', c => fmtMs(c.s.perf!.updateLogicMs)),
      stat(' ·shards', c => fmtMs(c.s.perf!.shardSysMs)),
      stat(' ·rings', c => fmtMs(c.s.perf!.explosionRingsMs)),
      stat(' ·weapons', c => fmtMs(c.s.perf!.weaponsMs)),
      stat(' ·drops', c => fmtMs(c.s.perf!.dropsMs)),
      stat(' ·homing', c => fmtMs(c.s.perf!.homingMs)),
      stat(' ·lightn', c => fmtMs(c.s.perf!.lightningMs)),
      stat(' ·misc', c => fmtMs(c.s.perf!.logicMiscMs)),
      stat('render', c => fmtMs(c.s.perf!.renderMs)),
      stat(' ·neb', c => fmtMs(c.s.perf!.nebulaMs)),
      stat(' ·vis-neb', c => c.s.perf!.nebulaVisible),
      stat(' ·neb fast/slow', c => `${c.s.perf!.nebulaFast}/${c.s.perf!.nebulaSlow}`),
      stat(' ·tLit', c => fmtMs(c.s.perf!.tileLightingMs)),
      stat(' ·tLit-N', c => c.s.perf!.tileLightingCount),
      stat(' ·lit', c => fmtMs(c.s.perf!.lightingMs)),
      stat(' ·lit-N', c => c.s.perf!.lightingLights),
      stat(' ·fog', c => fmtMs(c.s.perf!.fogMs)),
    ],
  },
  {
    id: 'perfrec', label: 'Perf REC', group: 'perf',
    rows: [
      // The FPS capture harness.  Copy exports the report to the clipboard AND
      // into a manual-copy textarea — the fallback matters on iOS Safari,
      // where the async Clipboard API can refuse outside a user gesture.
      custom('Perf REC', c => (
        <div className="flex flex-col gap-1.5 px-1 py-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onMouseDown={keepFocus}
              onClick={() => c.engine()?.perfRecToggle()}
              className={`${CHIP_BASE} ${
                c.s.perfRecording
                  ? 'bg-red-600/80 border-red-400 text-white animate-pulse'
                  : `${CHIP_OFF} hover:border-red-400`
              }`}
              title="Start / stop an FPS + perf capture"
            >
              {c.s.perfRecording ? '● REC' : '○ REC'}
            </button>
            <button
              onMouseDown={keepFocus}
              onClick={() => c.engine()?.perfRecCycleScene()}
              className={`${CHIP_BASE} capitalize ${CHIP_OFF} hover:border-amber-400`}
              title="Cycle the scene label recorded with the capture"
            >
              {c.s.perfRecScene ?? 'baseline'}
            </button>
            <button
              onMouseDown={keepFocus}
              onClick={() => c.ui.copyPerfReport()}
              disabled={(c.s.perfRecSamples ?? 0) === 0}
              className={`${CHIP_BASE} ${CHIP_OFF} hover:border-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed`}
              title="Export the capture as a copy-paste report"
            >
              {c.ui.perfCopied ? 'Copied ✓' : 'Copy'}
            </button>
            <span className={`${T_NOTE} text-slate-400 tabular-nums`}>
              {c.s.perfRecording ? 'rec ' : ''}{c.s.perfRecSamples ?? 0}f
            </span>
          </div>
          {c.ui.perfCopyText && (
            <div className="flex flex-col gap-1">
              <textarea
                readOnly
                value={c.ui.perfCopyText}
                onFocus={ev => ev.currentTarget.select()}
                rows={7}
                className={`w-full bg-slate-950/80 border border-slate-700 rounded ${T_MICRO} leading-tight text-slate-200 font-mono p-1.5 resize-y select-all`}
                title="Tap to select all, then copy"
              />
              <button
                onMouseDown={keepFocus}
                onClick={() => c.ui.dismissPerfReport()}
                className={`self-end px-2 py-0.5 rounded ${T_MICRO} text-slate-400 hover:text-white`}
              >
                dismiss
              </button>
            </div>
          )}
        </div>
      )),
    ],
  },
  {
    id: 'simrender', label: 'Sim & Render', group: 'perf',
    rows: [
      ctrl('Sim rate', dbg(e => e.dbg.cycleSimRate()),
        c => c.s.simRateName ?? '120Hz',
        'Simulation rate: 120Hz (default) or 60Hz. At 120Hz a 60fps frame runs TWO full sim steps, so this is the single biggest lever on sim cost — but it is a TRADE, not a free win: collision resolution is iterative, so half the steps means half the passes untangling dense shard piles. Rate-dependent constants are converted exactly, and the frame delta is vsync-snapped so 60Hz does not judder. Judge it by FEEL in a shard field.'),
      ctrl('Substep cap', dbg(e => e.dbg.cycleSubstepCap()),
        c => c.s.substepCapName ?? '5',
        'Max sim substeps one frame may drain (5 / 3 / 2) — the spiral-of-death clamp. Set too HIGH it feeds the spiral: a device capture showed every worst frame pegged at 5 steps with 36-44ms of sim in a 60ms frame, because a long frame pulls in more substeps which make it longer still. A 60fps display with a 120Hz sim only NEEDS 2. Lower caps convert a judder into a brief smooth slow-motion; the excess time is discarded either way.'),
      ctrl('Render scale', c => c.app.cycleRenderScale(),
        c => c.app.renderScaleName ?? '3x',
        'Cap on the canvas device-pixel-ratio (3 / 2 / 1.5). At dpr 3 a 440x756 phone viewport rasterises ~3.0 MILLION pixels every frame; capping at 2 cuts that to ~1.3M. This cost is INVISIBLE to the render timer — that measures our JS issuing canvas calls, while rasterisation and compositing happen in the browser compositor afterwards, which is exactly where device captures show the missing 25-36ms going. Trade: a softer image.'),
      ctrl('HUD rate', dbg(e => e.dbg.cycleHudRate()),
        c => c.s.hudRateName ?? '60Hz',
        'How often the React HUD re-renders (60 / 30 / 15Hz). Added when the 32ms-of-a-35ms-frame gap in a device capture was blamed on React reconciliation — MEASURED SINCE, and it was not: reconciliation is 0.1ms median in play, 0.3ms with an overlay up, so this knob is worth ~0.05ms. Kept as a harmless A/B, not a lever. The missing time is compositing — see Render scale. Chips and bars do not need 60Hz; the minimap, loadout strip, banners and damage text are canvas-drawn and unaffected. Pause/station/death screens always update immediately.'),
    ],
  },
  {
    id: 'overlays', label: 'Debug Overlays', group: 'perf',
    rows: [
      ctrl('Overlays', dbg(e => e.dbg.toggleDebug()),
        c => c.s.debugMode ? 'On' : 'Off',
        'Renderer debug overlays (collision polygons, player input vector). The old DBG master toggle — every other section works regardless.'),
      ctrl('Outlines', dbg(e => e.dbg.toggleTileOutlines()),
        c => c.s.tileOutlinesEnabled === true ? 'On' : 'Off',
        'Collision-shape outlines on plastic + nebula tiles/shards (soft-gradient variants). Shows the SAT polygon against the gradient fill.'),
    ],
  },
];
