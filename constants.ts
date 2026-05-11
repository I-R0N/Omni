

import { WeaponConfig, WeaponType, MapType, EnemySubtype, EnemyRole, EntityType } from './types';
import {
  ShardVariantId,
  ShardVariantDef,
  PerMapVariantSpawn,
} from './engine/systems/ShardSystem.types';
import { ASSETS } from './assets';

export const CHUNK_SIZE = 16; // 16x16 tiles
export const SPATIAL_GRID_SIZE = 120; // Physics optimization bucket size

export const COLORS = {
  UNIVERSE_BG: '#020617', // Slate 950
  SOLAR_BG: '#0f172a',    // Slate 900
  LOCAL_BG: '#1e293b',    // Slate 800
  SUB_BG: '#0f172a',      // Darker for interiors
  PLAYER: '#38bdf8',      // Sky 400
  ENEMY: '#f87171',       // Red 400
  STAR: '#fbbf24',        // Amber 400
  PLANET: '#4ade80',      // Green 400
  ASTEROID: '#94a3b8',    // Slate 400
  STRUCTURE: '#6366f1',   // Indigo 500
  STRUCTURE_BORDER: '#818cf8', // Indigo 400
  // Plastic — matte warm-orange polymer.  Mid-saturation, low-contrast
  // outline so the surface reads as soft injection-moulded plastic
  // rather than the violet sheen of the prior reinforced tile.
  STRUCTURE_PLASTIC: '#d97706',           // Amber 600 — matte polymer body
  STRUCTURE_PLASTIC_BORDER: '#fbbf24',    // Amber 400 — gentle highlight, not specular
  // Metal — cool steel-blue with a brighter edge, so silhouettes pop
  // against the indigo glass tiles.  Higher outline contrast than
  // plastic to read as a hard surface.
  STRUCTURE_METAL: '#64748b',             // Slate 500 — gunmetal body
  STRUCTURE_METAL_BORDER: '#e2e8f0',      // Slate 200 — chrome edge highlight
  STRUCTURE_INDESTRUCTIBLE: '#475569',        // Slate 600 — dull steel
  STRUCTURE_INDESTRUCTIBLE_BORDER: '#94a3b8', // Slate 400
};

// --- SYSTEM CONFIGURATIONS ---

export const CAMERA_CONSTANTS = {
  DEFAULT_ZOOM: 0.65,
  TRANSITION_DURATION: 0.8,
  TRANSITION_ZOOM_IN_FACTOR: 14, // Zoom multiplier when entering map
  TRANSITION_ZOOM_OUT_FACTOR: 0.95, // Zoom factor when leaving
  SHAKE_DECAY: 0.3, // Duration of shake falloff
  CULL_MARGIN: 150 // Pixels outside screen to still render
};

export const SPRITE_CONSTANTS = {
  // Adjust this to align the player ship art with the facing direction.
  PLAYER_ROTATION_OFFSET: Math.PI*(3/4), // Radians
  ENEMY_ROTATION_OFFSET: Math.PI*(3/4), // Match player art orientation
  PLAYER_BASE_SIZE: 20 // Default visual/physics size for player (x/y)
};

export const AI_CONFIG = {
  // Reaction time simulation
  REACTION_TIME_BASE: 0.2,
  REACTION_TIME_VAR: 0.3,

  // State switching timers (used by SHOOTING enemies and default)
  IDLE_TIME_BASE: 1.0,
  IDLE_TIME_VAR: 1.5,
  CHASE_TIME_BASE: 2.0,
  CHASE_TIME_VAR: 2.0,

  // Flight Physics
  ROTATION_THRESHOLD: 20, // Speed at which enemy rotates to face velocity instead of target

  // Rammer-specific overrides: short idle pause, long aggressive charge bursts
  RAMMER: {
    IDLE_TIME_BASE: 0.4,
    IDLE_TIME_VAR: 0.3,
    CHASE_TIME_BASE: 4.0,
    CHASE_TIME_VAR: 1.5,
    ROTATION_THRESHOLD: Infinity, // Always steer toward the player, even at speed
    // Retreat arc: when transitioning chase→idle within this distance, apply a
    // lateral impulse so the rammer circles away instead of stopping dead.
    RETREAT_TRIGGER_DIST: 280,
    RETREAT_IMPULSE: 0.6,        // perpendicular kick as fraction of maxSpeed
  },

  // Pack behavior — rammers within PACK_SYNC_RANGE of a chasing rammer get
  // their idle timer capped to PACK_SYNC_WINDOW, forcing a near-simultaneous charge.
  PACK_SYNC_RANGE: 450,
  PACK_SYNC_WINDOW: 0.2,

  // Skirmisher specific behavior
  SKIRMISHER: {
    PREFERRED_DIST: 300,
    DEADZONE: 50,
    STRAFE_MODIFIER: 0.75,
    LEAD_FACTOR: 0.8,      // fraction of perfect aim-lead (0 = no lead, 1 = perfect)
    PROJECTILE_SPEED: 5.0, // must match ENEMY_WEAPON.speed
  },

  // Aggro awareness: enemies within AGGRO_RANGE of a killed enemy get a
  // temporary speed boost and shortened idle for AGGRO_DURATION seconds.
  AGGRO_RANGE: 500,
  AGGRO_DURATION: 4.0,
  AGGRO_SPEED_MULT: 1.35,
  AGGRO_IDLE_MULT: 0.35, // idle time multiplier while aggroed (shorter pauses)

  // Distance beyond which enemies always seek the player, overriding idle state.
  // Prevents waves from stalling when the player moves away from the spawn location.
  LONG_RANGE_SEEK_DIST: 700,

  // Stuck detection: if an enemy travels less than STUCK_DIST_THRESHOLD units
  // over STUCK_CHECK_INTERVAL seconds while chasing, it gets a random nudge.
  STUCK_CHECK_INTERVAL: 1.5,
  STUCK_DIST_THRESHOLD: 50,
};

export const COLLISION_CONFIG = {
  // Physics Resolution
  ELASTICITY: 0.5, // Bounciness (0 to 1)
  CORRECTION_PERCENT: 0.2, // How much overlap to fix per frame
  SLOP: 0.01, // Penetration allowance to prevent jitter

  // Damage Values
  DAMAGE: {
    ASTEROID_CRUSH: 999, // Instant kill
    PLAYER_RAM_ENEMY: 15,
    STRUCTURE_IMPACT: 10,
    MINOR_IMPACT: 1
  },
  // Environmental damage (tiles & asteroids) — speed-gated so being
  // stuck between objects doesn't drain health.
  ENV_DAMAGE: {
    SPEED_THRESHOLD: 1.5,  // Minimum impact speed to take any damage
    MULTIPLIER: 0.15,      // damage = impactSpeed × multiplier (fractional HP)
  },

  // Screen Shake Intensity
  SHAKE: {
    MICRO: 1, // Projectile hit
    MEDIUM: 10, // Enemy collision
    HEAVY: 20, // High speed crash
    CAP_MULTIPLIER: 1.5 // Multiplier for velocity-based shake
  }
};

export const UI_CONSTANTS = {
  HEALTH_BAR: {
    PLAYER_WIDTH: 44, PLAYER_HEIGHT: 5,
    ENEMY_WIDTH: 22, ENEMY_HEIGHT: 3,
    OFFSET_MODIFIER: 0.85, // Multiplier of entity size
    OFFSET_BASE: 10 // Pixel padding
  },
  INDICATORS: {
    RADIUS: 120, // Distance from center of screen
    TEXT_THRESHOLD_ENEMY: 250000, // Distance sq to show text
    TEXT_THRESHOLD_POI: 160000,
    MAX_VISIBLE: 5 // Max arrows per type
  }
};

export const AMMO_HUD_CONSTANTS = {
  SLOT_W_MAX:    36,   // shrunk post-d1 — per-slot ammo number moved to a dedicated box
  SLOT_W_MIN:    22,
  SLOT_H:        48,
  SLOT_GAP:      4,
  // Wider gap separating the always-firable blaster from the rest of the
  // bar.  The ammo readout + ammo-gated weapons sit on the right, glued
  // together by the regular SLOT_GAP, so the ammo box reads as belonging
  // to the weapon group rather than floating between two halves.
  SLOT_SEP:      14,
  SLOT_RADIUS:   5,
  BOTTOM_MARGIN: 14,
};

export const MINIMAP_CONSTANTS = {
  SIZE: 75,            // Smaller Default
  EXPANDED_SIZE: 280,  // Larger when touched
  MARGIN: 20,          // Distance from screen edge
  ZOOM_RANGE: 1000,    // World units radius shown in small (zoomed-in) minimap
  RANGE: 8000,         // World units radius shown in expanded (overview) map
  BG_COLOR: 'rgba(15, 23, 42, 0.85)',
  BORDER_COLOR: 'rgba(56, 189, 248, 0.4)',
  PLAYER_DOT_COLOR: '#ffffff',
  VIEWPORT_COLOR: 'rgba(56, 189, 248, 0.25)',
  VIEWPORT_BORDER_COLOR: 'rgba(56, 189, 248, 0.8)',
};

export const INPUT_CONSTANTS = {
  // Charge-to-fire model (post-d2): tap (release before CHARGE_FULL) =
  // normal shot via fireEvents; hold for the full CHARGE_FULL duration
  // and release = charged shot via chargeReleaseEvents.  The ring HUD
  // fills 0 → 1 over the same window so the player only sees a charged
  // shot land when the ring is visibly complete.  Same TAP_DISTANCE_LIMIT
  // applies to the tap path — dragging the cursor cancels a tap.
  CHARGE_FULL: 1.0,        // seconds: hold time required for a charged shot AND for the ring to read "full"
  TAP_DISTANCE_LIMIT: 20,  // px: max finger travel for a tap to register
  THROTTLE_DISTANCE: 150,  // px from screen center that maps to full throttle (1.0)
};

export const PHYSICS_CONSTANTS = {
  FRICTION: 0.999, // Fallback default
  ACCELERATION: 0.02, // Fallback default (Reduced from 0.04)
  MAX_SPEED: 15,
  PLAYER_MASS: 100, // Heavier player = less recoil
  RECOIL_FORCE: 0 // Legacy, unused now that mass is implemented
};

// ─── Fixed-timestep simulation ───────────────────────────────────────────────
// Engine upgrade Phase 1: the simulation (physics/AI/game logic) now runs at a
// fixed timestep independent of frame rate so gameplay is deterministic across
// devices.  We use 1/120 s instead of the spec's example 1/60 s so that on a
// 60 Hz display every frame reliably runs exactly 2 sim steps and on a 120 Hz
// display every frame runs exactly 1 — the divisibility avoids the 1-vs-2
// alternation that caused visual jitter in the prior 1/60 accumulator attempt.
export const SIMULATION_CONSTANTS = {
  FIXED_DT: 1 / 120,       // Deterministic simulation timestep (seconds)
  MAX_SUBSTEPS: 5,         // Spiral-of-death clamp: max sim steps per rendered frame
  MAX_FRAME_TIME: 0.25,    // Safety clamp on raw frame delta before accumulating (s)
};

export const LOCAL_GRAVITY_CONSTANTS = {
  RANGE: 400,          // Pixel radius where gravity takes effect
  STRENGTH: 0.00015,     // Reduced 100x again (1000x total reduction)
  MIN_DIST: 50,        // Clamp to prevent infinite force at center
  PLAYER_INFLUENCE: 0.00001 // Reduced 100x again
};

// Asteroid clustering force model removed — see git history for the
// pairwise + density-bias implementations.  Today the chaotic-debris
// feel relies on the flow-field nudge and stick-bond cohesion alone.

// ── Shard-pair collision pacing ─────────────────────────────────────
// Shard ↔ shard pairs run through the cheap `resolveAsteroidPair`
// (circle-only, no SAT) but still pay O(k²) per cell × hundreds of
// shards in dense fields — the dominant cost of the collision pass
// during cannon spam.  Two lightweight optimisations applied:
//
//   1. FRAME_INTERVAL — resolve shard-shard pairs only every Nth
//      physics substep.  Other dynamic-vs-dynamic pairs (player,
//      enemy, projectile) still resolve every frame.  N=1 matches
//      pre-optimisation behaviour; N=3 default cuts work to ~1/3
//      with at most ~50 ms of visible overlap (3 frames @ 60 Hz)
//      before separation kicks in next interval frame.
//   2. STABLE_REL_VEL_SQ + STABLE_OVERLAP_FRACTION — inside the
//      resolver, skip the impulse + position correction when both
//      relative velocity² is below threshold AND overlap is below
//      a fraction of contact distance.  Settled piles become free
//      to evaluate.
export const SHARD_PAIR_CONSTANTS = {
  // Physics substeps between shard-shard resolution passes.  Cycled
  // via the DBG panel ShPair button (AUTO → 1 → 2 → 3 → 4 → 6 → 8).
  // 0 = AUTO (scaled by previous frame's maxCellDensity per the
  // table below); ≥1 = manual override.  Default AUTO so the field
  // self-tunes to dense fights without dev intervention.
  FRAME_INTERVAL: 0,
  // (rel-vel)² gate for stable-pair skip.  Combines with the overlap
  // gate below — both must be true to bail early inside
  // resolveAsteroidPair.  0.04 ≈ 0.2 px/frame relative drift.
  STABLE_REL_VEL_SQ: 0.04,
  // Overlap fraction of (rA + rB) below which a pair is considered
  // settled.  0.04 = 4 % of contact distance — visually unnoticeable.
  STABLE_OVERLAP_FRACTION: 0.04,
  // ── AUTO-mode density → interval mapping ────────────────────────
  // In AUTO mode the effective interval is selected from the
  // previous step's `maxCellDensity` (the peak shard count in any
  // single 3x3 collision cell — direct signal for shard-pair
  // pressure).  Steps are deliberately coarse so the active interval
  // doesn't hop every frame as density fluctuates by 1-2.  Light
  // fields (a few drifting shards) keep N=1 so impact response
  // feels crisp; dense piles (cannon spam) climb to N=4 so settled
  // clusters don't dominate the frame budget.  First entry whose
  // `maxDensity` ≥ observed wins.
  AUTO_THRESHOLDS: [
    { maxDensity: 8,   interval: 1 },
    { maxDensity: 16,  interval: 2 },
    { maxDensity: 28,  interval: 3 },
    { maxDensity: 999, interval: 4 },
  ] as const,
  // Manual cycle order, including AUTO sentinel (0).  Spans 1..1028
  // so dense fields can pin a very high interval for stress testing.
  // Powers-of-2 progression keeps the cycle short while still giving
  // 1-frame granularity at the low end where it matters most.  At
  // 1028 substeps (~17 s @ 60 Hz) shards effectively never resolve
  // each other — useful for measuring the absolute floor of collision
  // cost.
  CYCLE_ORDER: [0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1028] as const,
};

export const TRAIL_CONSTANTS = {
  LIFETIME: 2.5, // Seconds until trail part fades completely (longer = exhaust-like plume)
  MIN_DISTANCE_SQ: 30 // Minimum squared distance to move before recording a new trail point
};

// Player thrust trail — small rings emitted from the player position that
// expand outward and fade as they age.  Replaces the older polygon-strip
// exhaust plume.  Each emission is independent (no detached-trail bookkeeping).
export const PLAYER_TRAIL_CONSTANTS = {
  LIFETIME: 3.0,         // Seconds for each ring to expand and fade out
  EMIT_INTERVAL: 0.09,   // Seconds between emissions at full throttle (~11/sec)
  START_RADIUS: 3,       // Ring radius at birth
  END_RADIUS: 32,        // Ring radius at death
  PEAK_ALPHA: 0.75,      // Alpha at birth, linearly fades to 0
  LINE_WIDTH: 2.0,       // Stroke width in world units
  COLOR: '125, 211, 252',// RGB triplet (brighter cyan)
};

export const SHOOTING_STAR_CONSTANTS = {
  MIN_TIMER: 300,
  MAX_TIMER: 700,
  SPEED_MIN: 300,
  SPEED_MAX: 900
};

export const PLAYER_MOVEMENT_CONFIG: Record<MapType, { maxSpeed: number, acceleration: number, friction: number }> = {
  [MapType.UNIVERSE]: {
    maxSpeed: 140,
    acceleration: 0.077,
    friction: 0.998
  },
  [MapType.RING]: {
    maxSpeed: 140,
    acceleration: 0.077,
    friction: 0.998
  },
  [MapType.SEVEN_RINGS]: {
    maxSpeed: 140,
    acceleration: 0.077,
    friction: 0.998
  },
  [MapType.POCKET]: {
    maxSpeed: 140,
    acceleration: 0.077,
    friction: 0.998
  },
  // Single-element 6k showcase maps — keep movement identical to the
  // other full-size maps so the element under test is the only variable.
  [MapType.ASTEROID_FIELD]: {
    maxSpeed: 140,
    acceleration: 0.077,
    friction: 0.998
  },
  [MapType.GLASS_FIELD]: {
    maxSpeed: 140,
    acceleration: 0.077,
    friction: 0.998
  },
  [MapType.PLASTIC_FIELD]: {
    maxSpeed: 140,
    acceleration: 0.077,
    friction: 0.998
  },
  [MapType.METAL_FIELD]: {
    maxSpeed: 140,
    acceleration: 0.077,
    friction: 0.998
  },
  [MapType.INDESTRUCTIBLE_FIELD]: {
    maxSpeed: 140,
    acceleration: 0.077,
    friction: 0.998
  },
  [MapType.NEBULA_FIELD]: {
    maxSpeed: 140,
    acceleration: 0.077,
    friction: 0.998
  },
  [MapType.ROCK_FIELD]: {
    maxSpeed: 140,
    acceleration: 0.077,
    friction: 0.998
  },
};

export const STRUCTURE_CONSTANTS = {
  SIZE: 30,
  HEALTH: 1, // Single shot destroy
  MASS: Infinity, // Immovable walls
  CRASH_VELOCITY_THRESHOLD: 4, // Player speed needed to break through
  // Momentum threshold (asteroid.mass × impactSpeed) above which an
  // asteroid plows through a tile permanently.  At 200 a cruising
  // size-100 merged cluster just barely crashes, while a 20-mass
  // shard at drift speed doesn't.
  ASTEROID_CRASH_MOMENTUM: 200,
  // Pressure accumulator — sustained sub-crash-momentum impacts from
  // "large enough" asteroids also break a tile permanently, simulating
  // repeated-impact pressure without a full stress model.  A tile
  // breaks the first time its accumulator reaches ASTEROID_PRESSURE_HITS
  // within the rolling ASTEROID_PRESSURE_WINDOW.  Only asteroids with
  // mass ≥ ASTEROID_PRESSURE_MIN_MASS contribute, so trivial drift
  // shards don't count.  ASTEROID_PRESSURE_COOLDOWN debounces multi-
  // substep re-hits from a single bouncing rock.
  ASTEROID_PRESSURE_HITS: 5,
  ASTEROID_PRESSURE_WINDOW: 2.0,
  ASTEROID_PRESSURE_MIN_MASS: 40,
  ASTEROID_PRESSURE_COOLDOWN: 0.1,
  TILE_REGEN_DELAY: 12, // Seconds before a destroyed tile reappears
};

// ── Tile variants ───────────────────────────────────────────────────────────
// Every STRUCTURE tile belongs to one variant. The variant drives how much
// damage the tile can soak, its sprite, and whether it can be destroyed at
// all.  Damage-state visualisation is procedural (see renderCracks in
// RenderSystem) — same approach asteroids use — so variants only need one
// sprite each, not a per-tier atlas.
//
// Glass (default) is single-hit to match the original behaviour.
// Plastic and metal add intermediate HP.  Indestructible tiles never
// take damage and never regenerate — they're permanent walls.
export const STRUCTURE_VARIANTS = {
  glass: {
    health: 1,
    mass: Infinity,
    indestructible: false,
    sprite: ASSETS.HEX_STRUCTURE,
    color: COLORS.STRUCTURE,
    borderColor: COLORS.STRUCTURE_BORDER,
  },
  plastic: {
    // 8 HP — same hits-to-break as metal.  Differentiation is purely
    // visual: plastic deforms more per hit (higher dent.vertexJitter)
    // and detaches as a single ~1/3-size shard; metal warps subtly
    // and breaks into a 1/3 + 1/6 pair.
    health: 8,
    mass: Infinity,
    indestructible: false,
    // sprite left empty so RenderSystem's sprite branch falls through
    // to the polygon-based material-tile branch — that's the only
    // path that draws the dented polygonPoints.  ASSETS.HEX_STRUCTURE_PLASTIC
    // is kept in the manifest for a future per-variant sprite.
    sprite: '',
    color: COLORS.STRUCTURE_PLASTIC,
    borderColor: COLORS.STRUCTURE_PLASTIC_BORDER,
  },
  metal: {
    // 8 HP → 7 dent steps while alive, 8th detaches.  Same hit count
    // as plastic but reads as harder via the subtle per-hit dent and
    // the post-break fragmentation (two shards instead of one).
    health: 8,
    mass: Infinity,
    indestructible: false,
    // sprite left empty so the polygon fallback fires — see plastic above.
    sprite: '',
    color: COLORS.STRUCTURE_METAL,
    borderColor: COLORS.STRUCTURE_METAL_BORDER,
  },
  indestructible: {
    // Sentinel health — tile is never destroyed, but keep a finite positive
    // value so any stray damage arithmetic doesn't flip it negative.
    health: 9999,
    mass: Infinity,
    indestructible: true,
    sprite: ASSETS.HEX_STRUCTURE_INDESTRUCTIBLE,
    color: COLORS.STRUCTURE_INDESTRUCTIBLE,
    borderColor: COLORS.STRUCTURE_INDESTRUCTIBLE_BORDER,
  },
  // Stage 7: rock-tile family — clusters of solid rock that shatter
  // into rock-shards on death (the unified "tile is the parent of
  // every shard" architecture, see docs/SHARD_SYSTEM.md).  Visual:
  // slate / gray to read as rock; HP between glass (1) and heavy (5).
  // Sprite intentionally unset so the renderer falls through to the
  // asteroid polygon path (solid entity.color fill).  This makes
  // rock-tiles read with the same texture as rock-shards rather than
  // the glass-aesthetic translucent hex.
  rock: {
    health: 3,
    mass: Infinity,
    indestructible: false,
    sprite: '',
    color: COLORS.ASTEROID,
    borderColor: '#cbd5e1', // slate-300 — slightly lighter for the edge tint
  },
} as const;

export type StructureVariant = keyof typeof STRUCTURE_VARIANTS;

// ── Nebula tile configuration ──────────────────────────────────────────────
// Nebula tiles share the same hex grid as glass (STRUCTURE) tiles but are
// pass-through debris: players and enemies drift through them, shattering
// them into cloud-like shards with heavy linear & angular damping.  Each
// collision spawns SHARDS_PER_SHATTER children whose total disc area equals
// the parent's area (scaled by SHARD_TOTAL_AREA_RATIO) — the cloud keeps
// coverage constant on impact, and a gravity-driven merge pass re-absorbs
// small shards back into larger neighbours to re-form tiles over time.
export const NEBULA_CONSTANTS = {
  // Per-shatter child count and explicit linear size ratio.
  // child_diameter = parent_diameter × SHARD_LINEAR_RATIO.  At 0.60 with
  // N = 3, total child area = 3 × 0.36 = 1.08 × parent — a modest 8 %
  // growth per shatter.  Permanent area inflation is checked by tile
  // regeneration (grown tiles revert to canonical hex size on respawn).
  SHARDS_PER_SHATTER: 3,
  SHARD_LINEAR_RATIO: 0.60,
  // Minimum diameter below which a shard is no longer shatter-able.  Keeps
  // the system bounded under repeated impacts — sub-min shards simply
  // pass-through without fragmenting further.
  MIN_SHATTER_DIAMETER: 10,
  // Seconds a PLAYER/ENEMY must wait after shattering a nebula before they
  // can shatter another.  Prevents a single fly-through from ripping an
  // entire cluster apart simultaneously.  140 px/s × 0.2 s ≈ 28 px traversal
  // ≈ one tile width, so roughly every other tile gets broken in a row.
  IMPACT_COOLDOWN: 0.2,
  // How far from the destroyed parent's centre to spawn new shards, in
  // multiples of the parent's radius.  At 1.5 they sit ~0.75 tile-widths
  // behind the striker — close enough that the "dragged along" visual
  // reads well, far enough that the re-collision cooldown (IMPACT_COOLDOWN)
  // safely clears before the player overlaps the shard again.
  SHARD_SPAWN_OFFSET_RATIO: 1.5,
  // Regen delay: nebula tiles reappear after this many seconds.  Much
  // shorter than the glass-tile cadence (12 s) — nebulae are the
  // "soft" cloud layer, they should heal quickly so clusters don't
  // stay punched-out behind the player for long.
  REGEN_DELAY: 3,
  // Base (slow-collision) fade durations.  Actual per-entity durations
  // scale inversely with impact speed via nebulaFadeRateScale() — a
  // fast collision produces a shorter, snappier fade while a gentle
  // drift-through keeps the slow graceful dissolution.
  FADE_DURATION: 1.0,
  FADE_IN_DURATION: 1.5,
  // Impact-speed → fade-rate mapping.  impactSpeed/REFERENCE_SPEED gives
  // the rate scale, clamped to [1, MAX_SCALE].  At rateScale = 1 the
  // base durations above are used; higher scales divide the duration
  // (faster fade).  REFERENCE_SPEED is in px/frame — a "moderate"
  // collision (about half player max thrust) maps to rateScale > 1.
  FADE_RATE_REFERENCE_SPEED: 1.0,
  FADE_RATE_MAX_SCALE: 3.0,
  // Per-frame damping (60Hz reference).  Applied as
  //   velocity *= Math.pow(damping, dt * 60)
  // so behaviour is framerate-independent.  Values closer to 1.0 = less
  // damping = shards drift longer.  LINEAR at 0.97 → velocity halves
  // in ~23 frames (~0.38 s), heavier than angular so shards translate
  // less freely (counterweights the stronger GRAVITY_STRENGTH above)
  // while keeping the softer tumble on spin.
  LINEAR_DAMPING: 0.97,
  ANGULAR_DAMPING: 0.98,
  // Speed-based opacity falloff for shards — fast shards read slightly
  // translucent, settled shards are fully opaque.  Applied as
  //   mul = max(SHARD_SPEED_OPACITY_MIN, 1 − speedSq × SHARD_SPEED_OPACITY_K)
  // in RenderSystem.  Uses speed-squared so we skip the sqrt; the
  // coefficient K is tuned against typical launch speeds (2–5 px/frame
  // → speedSq 4–25) to drop opacity by ~0.25 at peak scatter.
  SHARD_SPEED_OPACITY_K:   0.01,
  SHARD_SPEED_OPACITY_MIN: 0.75,
  // Velocity below which shards snap to rest (prevents infinite micro-drift).
  REST_SPEED: 0.005,
  REST_SPIN: 0.01,
  // Rotation magnitude applied to shards at shatter.  Scales with striker speed.
  SPIN_PER_UNIT_SPEED: 1.2,
  MAX_SPIN: 6.0,  // rad/s cap
  // Post-shatter shard velocity: shards are "dragged along" in the
  // striker's direction of travel (forward-biased) rather than pushed
  // away perpendicular to it.  Parallel component dominates; a tiny
  // perpendicular push based on tangent side gives each shard a slight
  // lateral drift that matches its rotation direction.
  //
  // At FORWARD_DRAG_FACTOR = 0.9 with LINEAR_DAMPING = 0.991, shards
  // launch a bit slower than the striker and decay more gently, so the
  // total coast distance is preserved while per-frame motion feels
  // noticeably slower.  The 0.75× scaling of launch velocities is
  // matched by a 0.75× scaling of (1 − damping), keeping
  // ∫V₀·d^t·dt = V₀/(1−d) constant.
  //
  // parallel_velocity = max(MIN_PARALLEL_SPEED,
  //                         impactSpeed × FORWARD_DRAG_FACTOR)
  // perp_velocity     = impactSpeed × PERP_SCATTER_FACTOR
  FORWARD_DRAG_FACTOR: 0.9,
  PERP_SCATTER_FACTOR: 0.03,
  MIN_PARALLEL_SPEED: 0.225,
  // Shatter fan half-angle — 3 children are spread symmetrically around
  // the striker's forward direction within ±FAN_HALF_ANGLE.
  FAN_HALF_ANGLE: Math.PI / 3,  // 60° (so ±60° → 120° full fan)
  // Gravity pull: each shard is attracted to the nearest larger nebula
  // entity within GRAVITY_RANGE.  The force curve is G / max(dist, MIN).
  // Stronger pull shortens the drift-to-merge beat; paired with heavier
  // LINEAR_DAMPING below so shards don't overshoot their target.
  GRAVITY_RANGE: 380,
  GRAVITY_STRENGTH: 380,
  GRAVITY_MIN_DIST: 15,
  // Merge proximity: when (dist < (r_large + r_small) × MERGE_PROXIMITY_K)
  // the larger nebula absorbs the smaller one.  K = 0.55 means the
  // shards must substantially OVERLAP, not merely touch, before a merge
  // fires — keeps shards visible as distinct polygons for longer.
  MERGE_PROXIMITY_K: 0.55,
  // Per-shard merge cooldown — a freshly-spawned shard (from a tile
  // shatter OR a recent merge) cannot participate in another merge for
  // this many seconds.  Prevents the cascade where 4–6 shards spawn
  // together and all collapse into one circle on frame 1–2.  The
  // cooldown is ticked each substep by PhysicsSystem and consulted by
  // NebulaSystem.updateDynamics before considering any merge pair.
  MERGE_COOLDOWN: 1.8,
  // Tile regeneration toggle.  When false, shattered tiles are gone
  // forever (no respawn at their original grid cell) and the ONLY way
  // new tiles appear is via shard → tile transmutation.  Combined with
  // per-shard effective-area accumulation (see NebulaSystem spawn /
  // merge / tryTransmute), this keeps total tile population bounded:
  // 1 tile shatter produces ≤1 new tile via transmutation.  Clusters
  // can SHRINK (player kills shards mid-merge) but never GROW.
  TILE_REGEN_ENABLED: false,
  // Reference sprite world size for a FULL nebula tile (effective area
  // = HEX_AREA).  Every nebula sprite — tile or shard — is drawn at
  //     drawSize = TILE_SPRITE_WORLD_SIZE × sqrt(nebulaTileArea / HEX_AREA)
  // so visual size scales proportionally with the effective area the
  // entity carries.  A fresh shard from a 3-way shatter draws at
  //   120 × sqrt(1/3) ≈ 69 world units
  // and grows as it merges:
  //   half-merged → 120 × sqrt(0.5) ≈ 85
  //   fully-merged (about to transmute) → 120
  // Tune this one number to make nebula tiles visually bigger or smaller;
  // shard sprites follow automatically.
  TILE_SPRITE_WORLD_SIZE: 120,
  // Cluster generation moved to MAP_POPULATION (Stage 7) — see the
  // 'nebula-tile' tileCluster entries per map for cluster counts +
  // size ranges.  Inner / outer split lives on the per-map record.
  // Base palette — nebula tiles draw from the full 360° hue wheel
  // (blue / indigo / violet / pink / red / yellow / green all available).
  // Regen uses circular hue math so wraparound is handled correctly.
  // SATURATION and LIGHTNESS match the background nebula aesthetic
  // (BackgroundManager.createPuffVariants uses 100%/60%).
  PALETTE_SATURATION: 100,
  PALETTE_LIGHTNESS: 62,
  // Minimum hue delta (in degrees) a regenerated nebula tile must have
  // from its previous hue.  If the rule-based blend produces a result
  // closer than this to the old hue, the regen code forces a step of
  // at least this many degrees along the palette arc so every
  // regeneration is visibly distinct from the last.
  REGEN_MIN_HUE_SHIFT: 40,
  // Default composition hex used if a tile spawns with no palette selection.
  DEFAULT_HEX: '#a78bfa',
  // ── Twinkle (random fading-in/out star within the sprite) ────────
  // Each tile and shard maintains its own next-twinkle schedule; the
  // renderer draws a pre-rendered star bitmap at a random position
  // within the sprite, alpha-curved as sin(t·π) so it smoothly fades
  // in and out over TWINKLE_DURATION seconds, then waits a random
  // interval in [TWINKLE_INTERVAL_MIN, TWINKLE_INTERVAL_MAX] before
  // the next one.  Star positions reroll per cycle.
  TWINKLE_DURATION: 1.2,
  TWINKLE_INTERVAL_MIN: 4.0,
  TWINKLE_INTERVAL_MAX: 9.0,
  TWINKLE_STAR_SIZE: 10,
  TWINKLE_PLACEMENT_RANGE: 0.35,
  // ── Standard drops (ammo) ────────────────────────────────────────
  // Nebula tiles and shards occasionally release a standard ammo
  // drop on shatter — low frequency so breaking a cluster yields the
  // occasional reward without flooding the map.  The roll is
  // independent of shard creation: shard count/size math is
  // untouched, the ammo drop (if any) is a bonus that spawns
  // alongside the usual shards.  Post-d1 every ammo drop awards the
  // shared currency, so there is no per-weapon variant here.
  AMMO_DROP_CHANCE: 0.06, // 6 % per shatter (tile OR shard)
  AMMO_PER_NEBULA: 3,     // shared-pool ammo units per nebula drop
};

/**
 * Map an impact speed (px/frame) to a nebula fade rate scale in
 * [1, NEBULA_CONSTANTS.FADE_RATE_MAX_SCALE].  Higher scales produce
 * faster fade-out AND fade-in durations (duration = base / scale).
 *
 * Shared by PhysicsSystem (when arming a tile/shard's fade-out timer)
 * and GameEngine (when arming a newly-spawned shard's fade-in timer)
 * so destruction and rebirth feel synchronized for the same hit.
 */
export function nebulaFadeRateScale(impactSpeed: number): number {
  const raw = impactSpeed / NEBULA_CONSTANTS.FADE_RATE_REFERENCE_SPEED;
  if (raw <= 1) return 1;
  if (raw >= NEBULA_CONSTANTS.FADE_RATE_MAX_SCALE) return NEBULA_CONSTANTS.FADE_RATE_MAX_SCALE;
  return raw;
}

export const EXPLOSION_CONSTANTS = {
  DURATION: 0.6, // Seconds
  SIZE_MULTIPLIER: -1.8
};

export const PARTICLE_CONSTANTS = {
  LIFETIME_MIN: 0.25,
  LIFETIME_MAX: 0.45,
  SPEED_MIN: 2,
  SPEED_MAX: 5,
  SIZE_MIN: 1,
  SIZE_MAX: 3
};


// ── Charge-shot HUD tuning ───────────────────────────────────────────────────
// Visual feedback for the hold-to-charge model.  Ring is drawn around the
// player ship while `player.chargeProgress` > 0; fills from 0 → 1 over
// INPUT_CONSTANTS.CHARGE_FULL seconds.  Two visual states only:
// "priming" while filling, "full" at completion (matches the firing
// gate — charged shot only fires when the ring is full).
export const CHARGE_CONSTANTS = {
  RING_RADIUS_OFFSET: 14,    // px past player half-extent for the ring
  RING_WIDTH: 3,             // line width
  RING_COLOR_PRIMING: '#94a3b8', // slate-400 — held but not yet full
  RING_COLOR_FULL:    '#ffffff', // white — held to full (charged shot armed)
};

// ── Lightning chain tuning ───────────────────────────────────────────────────
export const LIGHTNING_CHAIN_RANGE = 280;           // hop range for subsequent chains
export const LIGHTNING_CHAIN_COUNT = 3;             // additional chain hops (depth) after projectile impact — depth 0 is the direct hit
export const LIGHTNING_CHAIN_BRANCHES = 2;          // simultaneous jumps per chain node — turns the chain into a branching tree (saturated tree: 1+2+4+8 = 15 entities)
// Mobile shard variants the lightning chain refuses to hop to.  Conductive
// targets (enemies, glass-shards, nebula-shards) still chain freely — only
// inert/dielectric materials sit this dance out.  Static tiles are already
// excluded structurally (entityIndex.asteroids holds mobile shards only).
//
// NOTE for future material work (Phase 1 g2 — plastic-shard / metal-shard):
//   - 'plastic-shard' SHOULD be added here (plastic is an insulator).
//   - 'metal-shard'   should NOT be added (metal conducts — let it chain).
// Update this set when those variants are introduced.
export const LIGHTNING_CHAIN_EXCLUDED_VARIANTS: ReadonlySet<ShardVariantId> = new Set<ShardVariantId>([
  'rock-shard',
]);
export const LIGHTNING_ARC_LIFETIME = 0.5;          // seconds the visual arc persists
export const LIGHTNING_GRAVITY_STRENGTH = 400;      // acceleration toward nearest target (gravity-like pull)
export const LIGHTNING_GRAVITY_RANGE = 300;         // max range for gravity attraction

// ── Homing projectile tuning ─────────────────────────────────────────────────
export const HOMING_ACQUIRE_RANGE = 400;            // max range at which a homing projectile locks onto an enemy

// Tile regeneration pop-in burst
export const REGEN_POP_CONSTANTS = {
  DURATION: 0.2,      // seconds for scale overshoot animation
  CHIP_COUNT: 6,      // particles on regen complete
  CHIP_SPEED_MIN: 40,
  CHIP_SPEED_MAX: 80,
  CHIP_LIFETIME: 0.4,
};

// Wave announcement banners
export const WAVE_ANNOUNCE_CONSTANTS = {
  FADEIN: 0.3,
  HOLD: 1.0,
  FADEOUT: 0.5,
};

// Glitter trail — bright points trailing behind the player along travel path.
// Separate from the thrust trail; emits whenever the player is in motion.
export const GLITTER_TRAIL_CONSTANTS = {
  COUNT_PER_FRAME: 1,     // particles spawned per frame while moving
  MIN_SPEED_SQ: 0.04,     // below this (per-frame speed²), stop emitting
  LIFETIME_MIN: 0.08,
  LIFETIME_MAX: 0.18,
  SIZE_MIN: 0.4,
  SIZE_MAX: 1.2,
  // Bright multi-hue palette — white + saturated rainbow sparks
  COLORS: [
    '#ffffff', // white
    '#f9a8d4', // pink
    '#c084fc', // purple
    '#7dd3fc', // cyan
    '#86efac', // green
    '#fde047', // yellow
    '#fb923c', // orange
    '#f87171', // red
  ] as string[],
};

export const PROJECTILE_CONSTANTS = {
  SPEED: 3, // Reduced from 12
  SIZE: 8,
  COLOR: '#facc15', // Yellow
  LIFETIME: 1.5, // Seconds
  MASS: 1, // Light projectile
};

// ── Global entity caps ───────────────────────────────────────────────────────
// Hard ceilings on live projectiles and particles to bound per-frame cost.
// When exceeded, oldest entries of that type are dropped first (FIFO).
export const MAX_PROJECTILES = 600;
export const MAX_PARTICLES   = 400;

export const ENEMY_CONSTANTS = {
  HEALTH: 30,
  SIZE: 20,
  COLOR: '#f87171',
  VISION_RANGE: 2500,
  ACCELERATION: 100, 
  MAX_SPEED: 200,    
  MASS: 10
};

export const DAMAGE_TEXT_CONSTANTS = {
  LIFETIME: 1.2, // Seconds
  SPEED: 35, // Pixels per second upward
  SIZE: 14,
  COLOR: '#ffffff',
  CRIT_COLOR: '#facc15'
};

// ── Rainbow weapon order: Red → Orange → Yellow → Green → Cyan → Blue → Purple ──
//
// Stat budgeting (d2 weapon overhaul):
//   Each weapon owns a distinct tactical niche.  ROF spans ~10× across the
//   lineup (Blaster 7/s vs Cannon ~0.7/s); damage trades inversely with ROF
//   so per-shot damage spans ~5× (Blaster 4 vs Cannon 18).  Each weapon
//   composes existing primitives (homing / pierce / bounce / lightning /
//   spread / burst) plus the new `explosionRadius` AoE primitive on the
//   Cannon.  Charged-shot variants (held mouse for the full INPUT_CONSTANTS
//   .CHARGE_FULL window then released) consume `chargedAmmoCost` instead
//   and are dispatched per-weapon in WeaponSystem.firePlayerWeaponCharged().
export const WEAPONS: Record<WeaponType, WeaponConfig> = {
  [WeaponType.BLASTER]: {
    type: WeaponType.BLASTER,
    name: 'Blaster',
    cooldown: 0.14,    // 7 shots/s — all-rounder cadence
    speed: 9,
    damage: 4,
    lifetime: 1.5,
    color: '#ef4444', // Red — infinite ammo starter
    size: 6,
    count: 1,
    spread: 2,
    recoil: 0.5,
    pierce: 0,
    ammoCost: 0,
    chargedAmmoCost: 0,
  },
  [WeaponType.BURST]: {
    type: WeaponType.BURST,
    name: 'Burst Rifle',
    cooldown: 0.45,    // ~2.2 bursts/s
    speed: 12,
    damage: 5,
    lifetime: 3.0,
    color: '#f97316', // Orange
    size: 5,
    count: 1,
    spread: 1,
    recoil: 0.3,
    pierce: 2,
    burstCount: 3,
    burstDelay: 0.04,
    ammoCost: 2,
    chargedAmmoCost: 3,
  },
  [WeaponType.SHOTGUN]: {
    type: WeaponType.SHOTGUN,
    name: 'Shotgun',
    cooldown: 0.65,    // 1.5 shots/s — close-range slug, commits per shot
    speed: 12,
    damage: 3,
    lifetime: 0.8,     // doubled — pellets reach further before fading
    color: '#facc15', // Yellow
    size: 5,
    count: 6,
    spread: 17.5,      // halved — tighter cone, more focused damage
    recoil: 3.0,
    pierce: 1,
    ammoCost: 4,
    chargedAmmoCost: 6,
  },
  [WeaponType.BOUNCER]: {
    type: WeaponType.BOUNCER,
    name: 'Pierce Beam',
    cooldown: 0.40,    // 2.5 shots/s
    speed: 18,         // ~2× Blaster — fast straight beam
    damage: 5,
    lifetime: 4,       // bounded; the bounceCount cap usually ends it sooner
    color: '#22c55e',  // Green — beam that pierces enemies + bounces off tiles
    size: 6,
    count: 3,          // 3-beam forward fan
    spread: 30,        // ±15° cone
    recoil: 0.5,
    pierce: 99,        // effectively infinite enemy penetration; tile bounces still cap via bounceCount
    bounceCount: 3,    // reflects up to 3 times off tiles before dissipating
    ammoCost: 6,
    chargedAmmoCost: 9,
  },
  [WeaponType.LIGHTNING]: {
    type: WeaponType.LIGHTNING,
    name: 'Lightning',
    cooldown: 0.50,    // 2 shots/s
    speed: 16,         // gravity pull curves the projectile toward targets
    damage: 9,         // direct hit; chain hops scale down by 1/(totalHops-1) per hop
    lifetime: 15,      // bounded — prevents unbounded accumulation in target-poor areas
    color: '#22d3ee',  // Cyan — projectile that chains on impact
    size: 6,
    count: 1,
    spread: 3,
    recoil: 0.3,
    pierce: 0,         // stops on first hit, then chains
    ammoCost: 8,
    chargedAmmoCost: 12,
  },
  [WeaponType.HOMING]: {
    type: WeaponType.HOMING,
    name: 'Seeker Missiles',
    cooldown: 0.65,    // 1.5 shots/s — slow ROF in exchange for guaranteed hits
    speed: 7,
    damage: 6,
    lifetime: 3.0,
    color: '#3b82f6', // Blue
    size: 8,
    count: 1,
    spread: 10,
    recoil: 0.5,
    pierce: 0,
    homing: true,
    ammoCost: 10,
    chargedAmmoCost: 15,
  },
  [WeaponType.CANNON]: {
    type: WeaponType.CANNON,
    name: 'Plasma Cannon',
    cooldown: 1.40,    // ~0.7 shots/s — heavy artillery
    speed: 10,
    damage: 18,
    lifetime: 2.5,
    color: '#a855f7', // Purple
    size: 16,
    count: 1,
    spread: 0,
    recoil: 4.0,       // halved from 8.0 — a slower ROF + AoE makes huge recoil punitive
    pierce: 0,
    explosionRadius: 110,   // world units of radial AoE on impact
    explosionDamage: 10,    // damage applied to every entity in radius (excluding the direct-hit target which already took config.damage)
    explosionKnockback: 6,  // velocity impulse magnitude at the impact point (falls off with distance)
    ammoCost: 12,
    chargedAmmoCost: 18,
  },
};

// Full rainbow order — used for ammo HUD slot layout and weapon cycling
export const WEAPON_LIST = [
  WeaponType.BLASTER,
  WeaponType.BURST,
  WeaponType.SHOTGUN,
  WeaponType.BOUNCER,
  WeaponType.LIGHTNING,
  WeaponType.HOMING,
  WeaponType.CANNON,
];

// Burst-fire parameters for shooting enemies.
// Pattern: BURST_SIZE rapid shots (BURST_GAP apart), then BURST_RELOAD reload.
export const ENEMY_BURST_CONFIG = {
  BURST_SIZE: 2,        // shots per burst
  BURST_GAP: 0.15,      // seconds between shots within a burst
  BURST_RELOAD: 2.5,    // seconds between bursts
};

// Simple enemy blaster (separate so we can tune independently of player weapons)
export const ENEMY_WEAPON: WeaponConfig = {
  type: WeaponType.BLASTER,
  name: 'Enemy Blaster',
  cooldown: 1.2,
  speed: 5.0,
  damage: 10,
  lifetime: 3.5,
  color: '#f97316',
  size: 6,
  count: 1,
  spread: 4,
  recoil: 0,
  pierce: 0,
  ammoCost: 0,        // unused — enemies don't draw from a shared pool
  chargedAmmoCost: 0, // unused — enemies don't charge
};

// --- ASSETS ---
export { ASSETS };

export const SHIELD_CONSTANTS = {
  MAX_CHARGE: 50,            // Shield capacity (half of 100 HP)
  RECHARGE_RATE: 10,          // Points/sec — full recharge in ~5s
  RECHARGE_DELAY: 2.0,       // Brief pause after last hit before recharge kicks in
  HIT_FLASH_DURATION: 1.3,   // How long the shield ring stays visible after a hit
  CONTACT_FLASH_DURATION: 0.45, // Shorter flash for non-damaging contact
  COLOR: '#60a5fa',          // Blue-400
  COLLISION_MULTIPLIER: 1.8, // Player collision radius multiplier when shield > 0
  DAMAGE_THRESHOLD: 2.0,     // Min impact speed to actually drain shield (below = flash only)
};

export const WAVE_CONSTANTS = {
  // Bumped from 3.0 → 4.5 so the post-wave graceful cleanup window
  // (offscreen-first, paced shard removal in ShardSystem) has time to
  // drain pressure before the next wave lands.  Keeps reaction-time
  // budget unchanged for the player while letting the field breathe.
  GRACE_PERIOD: 4.5, // Seconds between wave clear and next wave spawn
  // Extra world-unit buffer beyond the visible half-diagonal when picking
  // wave-spawn radii.  Guarantees enemies materialise comfortably outside
  // the player's viewport on every aspect ratio.
  OFFSCREEN_MARGIN: 120,
  // Radial depth of the spawn ring (added on top of the viewport-derived
  // minimum distance).  Keeps the ring visually varied without bringing
  // any spawn point on-screen.
  SPAWN_RING_SPREAD: 200,
};

// Infinite wave scaling — applies to all waves beyond WAVE_DEFINITIONS.
// The pattern is always: rammer → shooter → mixed (every PATTERN_LENGTH waves).
// Enemy count starts at INFINITE_BASE_COUNT and grows by INFINITE_COUNT_PER_SET
// each set (group of PATTERN_LENGTH waves), capped at INFINITE_MAX_COUNT.
export const WAVE_CONFIG = {
  PATTERN_LENGTH: 3,           // waves per set (rammer, shooter, mixed)
  INFINITE_BASE_COUNT: 4,      // enemy count for the first infinite set
  INFINITE_COUNT_PER_SET: 1,   // +1 enemy per set (every 3 waves)
  INFINITE_MAX_COUNT: 12,      // hard cap on enemies per wave
};

// Shared-ammo pool config (post-d1).  Caps the player's single ammo number
// and provides the canonical pickup colour used by every ammo drop entity
// (enemy / asteroid / nebula sources all reuse this).
//
// MAX_POOL rationale: pre-refactor there was no explicit per-weapon cap;
// debug fills filled to 999 and a typical playthrough stockpiled ~30-60 per
// weapon across ~6 weapons (~200-360 total).  200 in shared form keeps the
// "well-stocked" feel without drifting into infinite-ammo territory.
export const AMMO_CONSTANTS = {
  MAX_POOL:    200,
  DROP_COLOR: '#facc15', // canonical ammo-pickup yellow
};

export const DROP_CONFIG = {
  // Per-pickup ammo amounts — chosen to keep today's per-encounter expected
  // ammo close to the per-weapon-pool model (asteroid 1.80, enemy 2.15,
  // nebula 0.18 — see also NEBULA_CONSTANTS.AMMO_PER_NEBULA).
  AMMO_PER_ENEMY_PRIMARY:   3,    // primary enemy ammo drop (paired with AMMO_DROP_CHANCE_ENEMY_PRIMARY)
  AMMO_PER_ENEMY_SECONDARY: 2,    // secondary enemy ammo drop (independent roll)
  AMMO_PER_ASTEROID:        4,    // ammo units per asteroid drop
  // Dent-policy mobile shards (plastic-shard, metal-shard) take
  // multiple hits to destroy, so their drop rate + payload run
  // higher than a single-hit asteroid to reward the effort.
  AMMO_PER_DENT_SHARD:      6,
  // Drop-spawn probabilities
  AMMO_DROP_CHANCE_ASTEROID:        0.45, // 45 % chance an asteroid drops ammo
  AMMO_DROP_CHANCE_DENT_SHARD:      0.85, // 85 % chance a dent shard drops ammo
  AMMO_DROP_CHANCE_ENEMY_PRIMARY:   0.55, // 55 % chance an enemy drops its primary ammo
  AMMO_DROP_CHANCE_ENEMY_SECONDARY: 0.25, // 25 % chance an enemy drops its secondary ammo
  // Health
  HEALTH_HEAL_AMOUNT:        100,   // HP restored per health drop
  // General
  COLLECT_RADIUS:             30,   // world units
  LIFETIME:                20.0, // seconds before drop despawns
  MAX_ACTIVE_DROPS:       100,   // hard cap
};

/**
 * Compute the ammo-HUD slot layout for a given screen size.
 *
 * Slot order (post-d1): [BLASTER]  ⎢SLOT_SEP⎥  [AMMO]⎢SLOT_GAP⎥[BURST][SHOTGUN]…
 *
 * The blaster sits alone on the left (infinite ammo, never gated).  The
 * shared-pool readout joins the ammo-gated weapons on the right, glued
 * together by the regular SLOT_GAP so the readout reads as part of that
 * group rather than floating in between.  Only one wider SLOT_SEP gap
 * separates blaster from the ammo+weapons cluster.
 *
 * Total cells = 1 (blaster) + 1 (ammo) + (WEAPON_LIST.length - 1) (other
 * weapons).  One SLOT_SEP gap (after blaster) + (WEAPON_LIST.length - 1)
 * SLOT_GAP gaps (ammo→burst + the inter-weapon gaps).
 */
export function computeAmmoHUDLayout(screenWidth: number, screenHeight: number): {
  startY: number;
  slotW: number;
  blasterX: number;
  ammoX: number;
  weaponsStartX: number;
  totalW: number;
} {
  const { SLOT_W_MAX, SLOT_W_MIN, SLOT_H, SLOT_GAP, SLOT_SEP, BOTTOM_MARGIN } = AMMO_HUD_CONSTANTS;
  const { MARGIN: MM, SIZE: MS } = MINIMAP_CONSTANTS;

  // Horizontal: start just right of the minimap, leave symmetric margin on the right
  const leftClear   = MM + MS + SLOT_GAP * 2;   // minimap right edge + small gap
  const rightEdge   = screenWidth - MM;
  const availableW  = rightEdge - leftClear;

  // Cells: blaster (1) + ammo (1) + non-blaster weapons (WEAPON_LIST.length - 1)
  const cells           = WEAPON_LIST.length + 1;
  // Gaps: 1 SLOT_SEP after the blaster + (cells - 2) regular gaps between
  // every other adjacent pair (ammo→burst + the inter-weapon gaps).
  const standardGaps    = cells - 2;
  const fixedGapsW      = SLOT_SEP + standardGaps * SLOT_GAP;

  // Scale slot width to fit
  const slotW = Math.max(
    SLOT_W_MIN,
    Math.min(SLOT_W_MAX, Math.floor((availableW - fixedGapsW) / cells))
  );
  const totalW = cells * slotW + fixedGapsW;

  // Center the scaled group within the available width
  const groupStartX = leftClear + Math.max(0, (availableW - totalW) / 2);
  const blasterX       = groupStartX;
  const ammoX          = blasterX + slotW + SLOT_SEP;
  const weaponsStartX  = ammoX + slotW + SLOT_GAP;
  const startY         = screenHeight - SLOT_H - BOTTOM_MARGIN;

  return { startY, slotW, blasterX, ammoX, weaponsStartX, totalW };
}

// Difficulty (enemy count multiplier) 0 = none, 3 = full
export const DIFFICULTY_SCALES: Record<number, number> = {
  0: 0,    // No enemies
  1: 0.35, // Low
  2: 0.65, // Moderate
  3: 1     // High (current default)
};

// Health drop wave interval per difficulty — spawn one health drop every N waves.
// Lower values = more frequent healing.  Add new keys here when adding difficulty levels.
export const HEALTH_DROP_INTERVAL: Record<number, number> = {
  0: 10,   // No enemies — same as easy (health drops still spawn for asteroid damage)
  1: 10,   // Easy — every 10 waves
  2: 15,   // Medium — every 15 waves
  3: 20,   // Hard — every 20 waves
};

// Difficulty stat multipliers — scale individual enemy health and speed
export const DIFFICULTY_STAT_SCALES: Record<number, { health: number; speed: number }> = {
  0: { health: 1.0, speed: 1.0 }, // N/A (no enemies)
  1: { health: 0.7, speed: 0.8 }, // Low — weaker, slower enemies
  2: { health: 0.85, speed: 0.9 }, // Moderate
  3: { health: 1.0, speed: 1.0 }, // Full difficulty
};

// ── Enemy variant configs ─────────────────────────────────────────────────────
// Two roles: RAMMING (charge into player) and SHOOTING (keep distance, fire).
// Three tiers per role — each tier is strictly faster/tougher than the last.
// To add a new enemy type: add entries to EnemySubtype, EnemyRole, ENEMY_ROLE,
// and ENEMY_VARIANTS, then reference the new subtype in WAVE_DEFINITIONS.

export const ENEMY_VARIANTS: Record<EnemySubtype, {
  color: string; size: number; health: number;
  maxSpeed: number; accel: number; turnRate: number;
  sprite: string; mass: number;
}> = {
  // ── Ramming — red → orange → yellow ──
  [EnemySubtype.RAMMER_1]: {
    color: '#ef4444', size: 28, health: 1,
    maxSpeed: 5,   accel: 3.5, turnRate: 2.8,
    sprite: ASSETS.ENEMY_DRONE,    mass: 10
  },
  [EnemySubtype.RAMMER_2]: {
    color: '#f97316', size: 28, health: 1,
    maxSpeed: 8,   accel: 5.5, turnRate: 3.2,
    sprite: ASSETS.ENEMY_CHARGER,  mass: 8
  },
  [EnemySubtype.RAMMER_3]: {
    color: '#facc15', size: 32, health: 3,
    maxSpeed: 11,  accel: 8,   turnRate: 3.0,
    sprite: ASSETS.ENEMY_TANK,     mass: 18
  },
  // ── Shooting — green → cyan → blue ──
  [EnemySubtype.SHOOTER_1]: {
    color: '#4ade80', size: 28, health: 1,
    maxSpeed: 4,   accel: 2.5, turnRate: 1.3,
    sprite: ASSETS.ENEMY_SKIRMISHER, mass: 12
  },
  [EnemySubtype.SHOOTER_2]: {
    color: '#22d3ee', size: 28, health: 2,
    maxSpeed: 5.5, accel: 3,   turnRate: 1.2,
    sprite: ASSETS.ENEMY_ORBITER,  mass: 10
  },
  [EnemySubtype.SHOOTER_3]: {
    color: '#3b82f6', size: 26, health: 2,
    maxSpeed: 7,   accel: 4,   turnRate: 1.5,
    sprite: ASSETS.ENEMY_SNIPER,   mass: 9
  },
};

// Maps each subtype to its role — used by AI routing and shooting logic.
export const ENEMY_ROLE: Record<EnemySubtype, EnemyRole> = {
  [EnemySubtype.RAMMER_1]:  EnemyRole.RAMMING,
  [EnemySubtype.RAMMER_2]:  EnemyRole.RAMMING,
  [EnemySubtype.RAMMER_3]:  EnemyRole.RAMMING,
  [EnemySubtype.SHOOTER_1]: EnemyRole.SHOOTING,
  [EnemySubtype.SHOOTER_2]: EnemyRole.SHOOTING,
  [EnemySubtype.SHOOTER_3]: EnemyRole.SHOOTING,
};

// ── Wave definitions ──────────────────────────────────────────────────────────
// 18 waves across 6 sets of 3.  Each set: [Ramming-only, Shooting-only, Mixed].
// Difficulty blend per set:
//   Set 1: L1       Set 2: ½L1+½L2   Set 3: L2
//   Set 4: ⅓L1+⅓L2+⅓L3   Set 5: ½L2+½L3   Set 6: L3
//
// powerup: weapon dropped when the wave is cleared (null = no drop, auto-advance;
//          on the final wave null also triggers the victory state).
export const WAVE_DEFINITIONS: { enemies: { subtype: EnemySubtype; count: number }[]; powerup: WeaponType | null }[] = [

  // ── Set 1 — Level 1 only ──────────────────────────────────────────────────
  { enemies: [{ subtype: EnemySubtype.RAMMER_1,  count: 4 }], powerup: null },                                                    // W1  Ramming
  { enemies: [{ subtype: EnemySubtype.SHOOTER_1, count: 4 }], powerup: null },                                                    // W2  Shooting
  { enemies: [{ subtype: EnemySubtype.RAMMER_1,  count: 2 }, { subtype: EnemySubtype.SHOOTER_1, count: 2 }], powerup: WeaponType.BURST },   // W3  Mixed

  // ── Set 2 — ½ L1, ½ L2 ───────────────────────────────────────────────────
  { enemies: [{ subtype: EnemySubtype.RAMMER_1,  count: 2 }, { subtype: EnemySubtype.RAMMER_2,  count: 2 }], powerup: null },     // W4  Ramming
  { enemies: [{ subtype: EnemySubtype.SHOOTER_1, count: 2 }, { subtype: EnemySubtype.SHOOTER_2, count: 2 }], powerup: null },     // W5  Shooting
  { enemies: [{ subtype: EnemySubtype.RAMMER_1,  count: 1 }, { subtype: EnemySubtype.RAMMER_2,  count: 1 },
              { subtype: EnemySubtype.SHOOTER_1, count: 1 }, { subtype: EnemySubtype.SHOOTER_2, count: 1 }], powerup: WeaponType.SHOTGUN }, // W6  Mixed

  // ── Set 3 — Level 2 only ─────────────────────────────────────────────────
  { enemies: [{ subtype: EnemySubtype.RAMMER_2,  count: 4 }], powerup: null },                                                    // W7  Ramming
  { enemies: [{ subtype: EnemySubtype.SHOOTER_2, count: 4 }], powerup: null },                                                    // W8  Shooting
  { enemies: [{ subtype: EnemySubtype.RAMMER_2,  count: 2 }, { subtype: EnemySubtype.SHOOTER_2, count: 2 }], powerup: WeaponType.HOMING }, // W9  Mixed

  // ── Set 4 — ⅓ L1, ⅓ L2, ⅓ L3 ────────────────────────────────────────────
  { enemies: [{ subtype: EnemySubtype.RAMMER_1,  count: 2 }, { subtype: EnemySubtype.RAMMER_2,  count: 2 }, { subtype: EnemySubtype.RAMMER_3,  count: 2 }], powerup: null },    // W10 Ramming
  { enemies: [{ subtype: EnemySubtype.SHOOTER_1, count: 2 }, { subtype: EnemySubtype.SHOOTER_2, count: 2 }, { subtype: EnemySubtype.SHOOTER_3, count: 2 }], powerup: null },    // W11 Shooting
  { enemies: [{ subtype: EnemySubtype.RAMMER_1,  count: 1 }, { subtype: EnemySubtype.RAMMER_2,  count: 1 }, { subtype: EnemySubtype.RAMMER_3,  count: 1 },
              { subtype: EnemySubtype.SHOOTER_1, count: 1 }, { subtype: EnemySubtype.SHOOTER_2, count: 1 }, { subtype: EnemySubtype.SHOOTER_3, count: 1 }], powerup: WeaponType.CANNON }, // W12 Mixed

  // ── Set 5 — ½ L2, ½ L3 ───────────────────────────────────────────────────
  { enemies: [{ subtype: EnemySubtype.RAMMER_2,  count: 2 }, { subtype: EnemySubtype.RAMMER_3,  count: 2 }], powerup: null },     // W13 Ramming
  { enemies: [{ subtype: EnemySubtype.SHOOTER_2, count: 2 }, { subtype: EnemySubtype.SHOOTER_3, count: 2 }], powerup: null },     // W14 Shooting
  { enemies: [{ subtype: EnemySubtype.RAMMER_2,  count: 1 }, { subtype: EnemySubtype.RAMMER_3,  count: 1 },
              { subtype: EnemySubtype.SHOOTER_2, count: 1 }, { subtype: EnemySubtype.SHOOTER_3, count: 1 }], powerup: null },     // W15 Mixed

  // ── Set 6 — Level 3 only ─────────────────────────────────────────────────
  { enemies: [{ subtype: EnemySubtype.RAMMER_3,  count: 4 }], powerup: null },                                                    // W16 Ramming
  { enemies: [{ subtype: EnemySubtype.SHOOTER_3, count: 4 }], powerup: null },                                                    // W17 Shooting
  { enemies: [{ subtype: EnemySubtype.RAMMER_3,  count: 2 }, { subtype: EnemySubtype.SHOOTER_3, count: 2 }], powerup: null },     // W18 Mixed
];

/**
 * Returns the wave definition for any wave index (0-based, infinite).
 *
 * Indices 0–17 map directly to the hand-authored WAVE_DEFINITIONS above.
 * Indices 18+ enter the infinite phase: pure tier-3 enemies, all-rammer →
 * all-shooter → mixed pattern, with enemy count increasing by
 * WAVE_CONFIG.INFINITE_COUNT_PER_SET each set, capped at INFINITE_MAX_COUNT.
 */
export function generateWaveDef(index: number): { enemies: { subtype: EnemySubtype; count: number }[]; powerup: WeaponType | null } {
  if (index < WAVE_DEFINITIONS.length) return WAVE_DEFINITIONS[index];

  const infiniteIdx = index - WAVE_DEFINITIONS.length;
  const set     = Math.floor(infiniteIdx / WAVE_CONFIG.PATTERN_LENGTH);
  const pattern = infiniteIdx % WAVE_CONFIG.PATTERN_LENGTH;

  const count = Math.min(
    WAVE_CONFIG.INFINITE_BASE_COUNT + set * WAVE_CONFIG.INFINITE_COUNT_PER_SET,
    WAVE_CONFIG.INFINITE_MAX_COUNT,
  );

  const half = Math.ceil(count / 2);
  const enemies: { subtype: EnemySubtype; count: number }[] =
    pattern === 0 ? [{ subtype: EnemySubtype.RAMMER_3,  count }]
    : pattern === 1 ? [{ subtype: EnemySubtype.SHOOTER_3, count }]
    : [{ subtype: EnemySubtype.RAMMER_3, count: half }, { subtype: EnemySubtype.SHOOTER_3, count: count - half }];

  return { enemies, powerup: null };
}

/**
 * Precomputed per-(variant, tier) density multiplier table.  Looked
 * up at render time in O(1).  Shape: variantId → number[tier].
 *
 * Each entry is the RGB multiplier applied to the variant's base
 * colour at the given tier.  Tier 0 is exactly 1.0 (no change —
 * preserves the variant's pre-density visual identity), tier
 * `density.maxSteps` is exactly the variant's `density.tintFloor`
 * (max-allowed-darkness against the active background palette),
 * intermediate tiers linearly interpolate.
 *
 * Built once at module init from SHARD_VARIANTS so the renderer
 * pays no per-frame allocation.  Variants without `density` (today:
 * tile families) get a single-entry [1.0] array — calling sites
 * that hit a missing variant or out-of-range tier degrade to 1.0.
 */
export function densityTintMultiplier(variantId: ShardVariantId, tier: number): number {
  if (tier <= 0) return 1.0;
  if (!_densityTintTableInit) ensureDensityTintTable();
  const table = DENSITY_TINT_TABLE[variantId];
  if (!table) return 1.0;
  if (tier >= table.length) return table[table.length - 1];
  return table[tier];
}

const DENSITY_TINT_TABLE: Partial<Record<ShardVariantId, number[]>> = (() => {
  const out: Partial<Record<ShardVariantId, number[]>> = {};
  // SHARD_VARIANTS is declared further down in this module, but the
  // factory closure runs at module-init AFTER all top-level decls
  // (the Record literal initialiser executes once when SHARD_VARIANTS
  // is queried — this IIFE runs eagerly).  Defer the actual read to
  // first call via a lazy lookup so the cyclic-ish structure resolves.
  return out;
})();

let _densityTintTableInit = false;
function ensureDensityTintTable(): void {
  if (_densityTintTableInit) return;
  _densityTintTableInit = true;
  const ids: ShardVariantId[] = Object.keys(SHARD_VARIANTS) as ShardVariantId[];
  for (const id of ids) {
    const variant = SHARD_VARIANTS[id];
    const density = variant.density;
    if (!density?.enabled) continue;
    // Tier indices [0..maxSteps].  Linear ramp 1.0 → tintFloor.
    const arr = new Array<number>(density.maxSteps + 1);
    for (let t = 0; t <= density.maxSteps; t++) {
      const frac = density.maxSteps === 0 ? 0 : t / density.maxSteps;
      arr[t] = 1.0 - frac * (1.0 - density.tintFloor);
    }
    DENSITY_TINT_TABLE[id] = arr;
  }
}

// Eager init at import time — `SHARD_VARIANTS` is fully constructed
// before any consumer of `densityTintMultiplier` actually runs (the
// renderer is built after constants imports complete), so calling
// this at the bottom of the constants module (after SHARD_VARIANTS
// is declared) is safe.  Done via a lazy guard so test paths that
// import bits of this module in isolation still work.

// ── Graceful cleanup tuning ─────────────────────────────────────────
// Knobs for the offscreen-first, paced shard cleanup pipeline that
// keeps high-density shard fields from popping out of existence on
// the player.  `MAX_REMOVALS_PER_FRAME` caps the per-tick fade-out
// budget so removals bleed down over ~0.5–1.5 s rather than instantly;
// `LARGE_COLLAPSE_BUDGET_PER_FRAME` similarly throttles the
// large-shard-collapse pass.  `MERGE_FADE_DURATION` is the per-entity
// fade-out window when a density compaction retires the smaller
// party (replaces today's instantaneous `b.active = false` for
// non-nebula compose merges).
export const CLEANUP_CONSTANTS = {
  // Per ShardSystem tick — how many shards may begin a fade-out due to
  // count-pressure cleanup.  Conservative default: 2 starts/frame at
  // 60Hz ≈ 120 starts/s, well above natural attrition while still
  // visibly paced when a sudden cleanup is triggered.
  MAX_REMOVALS_PER_FRAME: 2,
  // Per ShardSystem tick — how many shards may collapse inward via
  // the large-shard-collapse pass.  Caps the cascade rate so a giant
  // field doesn't all snap to the dense baseline in a single frame.
  LARGE_COLLAPSE_BUDGET_PER_FRAME: 4,
  // Fade-out duration (seconds) for the smaller party of a density
  // compose merge.  Chosen to read as a smooth dissolve without
  // dragging out the merge feedback.  Matches the spirit of the
  // existing nebula `FADE_DURATION` (1.0 s) but at half the length
  // — non-nebula merges shouldn't linger like a cloud puff.
  MERGE_FADE_DURATION: 0.5,
};

// ── ShardSystem variant table ───────────────────────────────────────
// See docs/SHARD_SYSTEM.md for the design rationale.  This table is
// the source of truth for tile / shard regen, merge, shatter and
// pass-through behaviour.  Stage 1 lands the table as data only;
// the existing GameEngine / NebulaSystem code paths still drive
// behaviour at runtime.  Subsequent stages migrate the read sites.
//
// All shard-family entities share `carrier: EntityType.STRUCTURE`;
// static-vs-dynamic dispatch is by `mass` (Infinity → static grid,
// finite → dynamic grid).  pass-through is per-variant flag.

const TILE_REGEN_POP_BURST = {
  chipCount:    REGEN_POP_CONSTANTS.CHIP_COUNT,
  chipSpeedMin: REGEN_POP_CONSTANTS.CHIP_SPEED_MIN,
  chipSpeedMax: REGEN_POP_CONSTANTS.CHIP_SPEED_MAX,
  chipLifetime: REGEN_POP_CONSTANTS.CHIP_LIFETIME,
};

// Spawn shape used by tile variants whose shatter spawns mobile
// glass-shards (today's "tile-shard" debris from STRUCTURE death).
// sizeMin = 20 matches the per-map rock-shard minSize universally
// (see MAP_POPULATION) so the asteroid-style shatter's MIN_SIZE
// gate is consistent with the spawn population.
// Glass shards: 3 or 4 vertices.  Sharp/narrow silhouettes from
// high angle jitter and high radius variance — splinter-like.  When
// 4 verts roll, the irregular jitter produces kite-like / asymmetric
// quads that don't overlap with plastic-shard's near-square shape.
const GLASS_SHARD_SPAWN_SHAPE = {
  sizeMin: 20, sizeMax: 200,
  polyVerticesMin: 3, polyVerticesMax: 4,
  polyVerticesOptions: [3, 4],
  angleJitter: 0.5, radiusMin: 0.45, radiusRange: 0.75,
  sizeToMass: (d: number) => d,
};

// Base config shared by glass / plastic / metal STRUCTURE tiles.
// indestructible-tile and rock-tile override pieces of this.
const STRUCTURE_TILE_BASE: Omit<ShardVariantDef, 'id'> = {
  carrier: EntityType.STRUCTURE,
  // Tiles spawn via TileGenerator at HEX_SIZE; the schema's spawn
  // shape is unused on the tile entity itself but populated with
  // sensible defaults so downstream code can read it without a
  // null-check.
  spawn: GLASS_SHARD_SPAWN_SHAPE,
  regen: {
    kind: 'timer',
    delaySeconds: STRUCTURE_CONSTANTS.TILE_REGEN_DELAY,
    popBurst: TILE_REGEN_POP_BURST,
    rewriteColor: 'none',
  },
  merge: {
    attractedTo: 'none',
    bondsWith: 'none',
    defaultOutcome: 'compose',
  },
  shatter: {
    // Today: STRUCTURE tile death does NOT spawn shards directly —
    // the visual debris comes from DropSystem.spawnGlassShards.  Once
    // Stage 3 migrates shatter into ShardSystem this becomes the
    // canonical path; the policy below mirrors today's glass-shard
    // population.
    kind: 'powerlaw',
    style: 'asteroid',
    countMin: 4, countMax: 6,
    alphaMin: 1.0, alphaMax: 1.0,
    childVariant: 'glass-shard',
    forwardDrag: 0.0, perpScatter: 0.0,
    scatterHalfCone: Math.PI,
  },
  passThrough: false,
  spawnsDropsOnDeath: true,
};

// Rock shards: 5, 7, or 9 vertices (odd counts only).  Organic /
// irregular silhouette with moderate jitter and moderate radius
// variance.  Discrete odd counts keep the visual distinct from
// metal's even counts (6/8/10) so a player can tell rock from metal
// at a glance.
const SHARD_SPAWN_SHAPE_ROCK = {
  sizeMin: 20, sizeMax: 200,                  // matches MAP_POPULATION rock-shard minSize
  polyVerticesMin: 5, polyVerticesMax: 9,
  polyVerticesOptions: [5, 7, 9],
  angleJitter: 0.5, radiusMin: 0.60, radiusRange: 0.55,
  sizeToMass: (d: number) => d,
};

const SHARD_SPAWN_SHAPE_NEBULA = {
  sizeMin: 8, sizeMax: 44,                    // diameter = radius*4 from spawnShards
  polyVerticesMin: 4, polyVerticesMax: 6,
  angleJitter: 0.25, radiusMin: 0.6, radiusRange: 0.55,
  // Near-zero mass: striker impulse drops by ~3 orders of magnitude
  // vs. today's `mass = size` (~8–44).  Combined with linearDamping /
  // angularDamping fields the shard reads as "cloud being shoved
  // aside" without slowing the striker.
  sizeToMass: () => 0.01,
};

// Plastic shards: always 4 vertices.  Near-square — low angle
// jitter keeps vertices close to a regular quadrilateral and low
// radius variance keeps side lengths similar, producing
// ~70–90° angles consistent with stamped / extruded polymer.
const SHARD_SPAWN_SHAPE_PLASTIC = {
  sizeMin: 20, sizeMax: 120,
  polyVerticesMin: 4, polyVerticesMax: 4,
  angleJitter: 0.15, radiusMin: 0.85, radiusRange: 0.20,
  sizeToMass: (d: number) => d * 0.7,
};

// Metal shards: 6, 8, or 10 vertices (even counts only).  Low
// jitter + low radius variance for a clean, hex-like or polygon-
// machined silhouette.  Discrete even counts pair with rock's odd
// counts so the two materials read as visually distinct families.
const SHARD_SPAWN_SHAPE_METAL = {
  sizeMin: 20, sizeMax: 120,
  polyVerticesMin: 6, polyVerticesMax: 10,
  polyVerticesOptions: [6, 8, 10],
  angleJitter: 0.20, radiusMin: 0.88, radiusRange: 0.18,
  sizeToMass: (d: number) => d * 1.3,
};

export const SHARD_VARIANTS: Readonly<Record<ShardVariantId, ShardVariantDef>> = {
  'glass-tile': {
    ...STRUCTURE_TILE_BASE,
    id: 'glass-tile',
  },
  'plastic-tile': {
    ...STRUCTURE_TILE_BASE,
    id: 'plastic-tile',
    // Plastic deforms heavily per hit — each closest-to-impact vertex
    // pulled inward by up to 25 % of its current radius.  Same hit
    // count as metal (STRUCTURE_VARIANTS.plastic.health = 8) but
    // visibly more dramatic per-hit warp.  Detaches into 3
    // plastic-shards whose areas sum to the deformed tile's area.
    regen: { kind: 'none' },
    dent: {
      vertexJitter: 0.25,
      breakShards: [
        // 3 equal-area shards — each carries 1/3 of the deformed
        // tile's area.  Linear sizeFraction = sqrt(1/3) ≈ 0.577
        // (relative to the deformed tile's diameter), so the three
        // shards sum to a full-area split.  More fragments than
        // metal's 2-shard break to play up plastic's lower
        // structural integrity on the killing hit.
        { variant: 'plastic-shard', sizeFraction: 0.577 },
        { variant: 'plastic-shard', sizeFraction: 0.577 },
        { variant: 'plastic-shard', sizeFraction: 0.577 },
      ],
    },
  },
  'metal-tile': {
    ...STRUCTURE_TILE_BASE,
    id: 'metal-tile',
    // Metal deforms subtly — each closest-to-impact vertex pulled
    // inward by up to 13 % per hit.  Same 8-hit lifetime as plastic
    // but the surface reads as harder via the smaller per-hit warp
    // and the post-break fragmentation: a 2-shard pair split 2:1 by
    // area, summing to the deformed tile's area.
    regen: { kind: 'none' },
    dent: {
      vertexJitter: 0.13,
      breakShards: [
        // Areas sum to the deformed tile's area (≈ half original
        // area at break, per playtest).  Primary takes 2/3, secondary
        // 1/3 — keeps the original "1/3 vs 1/6 of the tile" intent
        // (those are fractions of the ORIGINAL tile area, and
        // 1/3 + 1/6 = 1/2 = deformed area).
        // Linear sizeFraction = sqrt(area fraction of deformed),
        // so primary uses sqrt(2/3) ≈ 0.816, secondary sqrt(1/3)
        // ≈ 0.577.
        { variant: 'metal-shard', sizeFraction: 0.816 },
        { variant: 'metal-shard', sizeFraction: 0.577 },
      ],
    },
  },
  'indestructible-tile': {
    ...STRUCTURE_TILE_BASE,
    id: 'indestructible-tile',
    regen:   { kind: 'none' },
    shatter: {
      kind: 'powerlaw',
      style: 'asteroid',
      countMin: 0, countMax: 0,
      alphaMin: 1.0, alphaMax: 1.0,
      childVariant: 'glass-shard',
      forwardDrag: 0.0, perpScatter: 0.0,
      scatterHalfCone: Math.PI,
    },
    spawnsDropsOnDeath: false,
  },
  'rock-tile': {
    ...STRUCTURE_TILE_BASE,
    id: 'rock-tile',
    // Rock-tile uses the 'pull' dent kind (default) with
    // pullVertexCount = 3: each hit pulls the closest vertex AND
    // both immediate neighbours inward, each by its own random
    // jitter.  The wider 3-vertex pull creates multiple inverted
    // angles along one side of the polygon per hit, reading as
    // fractured stone rather than a single dimple.  No per-hit
    // shard release (unlike the previous triangle-delete approach);
    // the freed material accumulates and is delivered on the
    // killing hit via breakShards.  No regen.  Shatter stays
    // kind='none' so ShardSystem.shatter doesn't double-spawn on
    // top of dent's breakShards (GameEngine.handleEntityDeath skips
    // shatter for any dent variant).
    regen: { kind: 'none' },
    shatter: {
      kind: 'none',
      style: 'asteroid',
      countMin: 0, countMax: 0,
      alphaMin: 1.0, alphaMax: 1.0,
      childVariant: 'rock-shard',
      forwardDrag: 0, perpScatter: 0,
      scatterHalfCone: 0,
    },
    dent: {
      // 3 adjacent vertices pulled per hit.  vertexJitter is the
      // base per-vertex max pull (0.20 = up to 20 % inward).  Two
      // of the three (the closest-to-impact vertex plus one
      // randomly-chosen neighbour, via deepVertexCount = 2) draw
      // jitter × centerVertexJitterMul = 0.20 × 10.0 = up to 2.0
      // nominal jitter — capped by applyDentStep's K_MIN floor so
      // an "infinitely deep" roll bottoms out at 5 % of the vertex's
      // current radius.  Every hit produces two deep notches plus
      // one softer side warp, reading as a chaotic brittle fracture
      // (cracks branch unevenly rather than dimpling at a single
      // point).
      vertexJitter: 0.20,
      centerVertexJitterMul: 10.0,
      pullVertexCount: 3,
      deepVertexCount: 2,
      // Each hit also chips off a rock-shard at the impact location.
      // sizeFraction 0.5 is linear relative to the deformed tile
      // diameter (~44 at start), so the chip is ~22 wide on hit 1
      // and shrinks as deformation accumulates — visibly chunky
      // rather than the previous 0.25 (~11 wide) which read as
      // barely-there debris.
      perHitShard: { variant: 'rock-shard', sizeFraction: 0.5 },
      // Final break: 3 roughly equal rock-shards whose areas sum to
      // ~the deformed tile's area.  sqrt(1/3) ≈ 0.577 linear.
      breakShards: [
        { variant: 'rock-shard', sizeFraction: 0.577 },
        { variant: 'rock-shard', sizeFraction: 0.577 },
        { variant: 'rock-shard', sizeFraction: 0.577 },
      ],
    },
  },
  'nebula-tile': {
    id: 'nebula-tile',
    carrier: EntityType.STRUCTURE,
    spawn: SHARD_SPAWN_SHAPE_NEBULA,
    regen: {
      kind: NEBULA_CONSTANTS.TILE_REGEN_ENABLED ? 'timer' : 'none',
      delaySeconds: NEBULA_CONSTANTS.REGEN_DELAY,
      // Nebulae fade in instead of pop-burst.
      rewriteColor: 'neighborhood-blend',
    },
    merge: {
      // Tiles are immutable sinks: shards merge INTO tiles via shard→tile
      // transmutation, not the other way around.
      attractedTo: 'none', bondsWith: 'none',
      defaultOutcome: 'compose',
    },
    shatter: {
      kind: 'powerlaw',
      style: 'nebula',
      countMin: 2, countMax: 3,                 // count = 2 + floor(rand*2)
      alphaMin: 1.0, alphaMax: 1.0,
      childVariant: 'nebula-shard',
      forwardDrag: NEBULA_CONSTANTS.FORWARD_DRAG_FACTOR,
      perpScatter: NEBULA_CONSTANTS.PERP_SCATTER_FACTOR,
      scatterHalfCone: NEBULA_CONSTANTS.FAN_HALF_ANGLE,
      fadeInSeconds: NEBULA_CONSTANTS.FADE_IN_DURATION,
      postShatterMergeCooldown: NEBULA_CONSTANTS.MERGE_COOLDOWN,
    },
    // Mass = ∞ alone makes the tile a solid wall.  passThrough lets
    // strikers fly through and shatter on contact while the tile
    // keeps its static-grid placement.  See docs/SHARD_SYSTEM.md §6.C.
    passThrough: true,
    // Slow-path tint compute is expensive enough to merit caching.
    renderCache: 'composition',
    spawnsDropsOnDeath: false,                  // NebulaSystem handles its own ammo roll
  },
  'rock-shard': {
    id: 'rock-shard',
    carrier: EntityType.STRUCTURE,
    spawn: SHARD_SPAWN_SHAPE_ROCK,
    regen: { kind: 'none' },
    merge: {
      attractedTo: 'none',                      // contact-stick only
      bondsWith: { include: ['rock-shard', 'glass-shard'] },
      bondTimeSeconds: 10, bondTimeSizeRef: 20, bondTimeSizePower: 1.5,
      rules: [
        { partner: 'self',        outcome: 'compose' },
        { partner: 'glass-shard', outcome: 'compose', thresholdScale: 2.0 },
      ],
      defaultOutcome: 'compose',
    },
    shatter: {
      kind: 'powerlaw',
      style: 'asteroid',
      countMin: 2, countMax: 5,
      alphaMin: 0.4, alphaMax: 2.0,
      childVariant: 'rock-shard',
      forwardDrag: 0.35, perpScatter: 0.0,
      scatterHalfCone: Math.PI * 0.55,
    },
    onShatterParticles: { color: '#94a3b8', count: 5 },
    passThrough: false,
    spawnsDropsOnDeath: true,
    // Density compaction: rocks are the canonical "many small chunks"
    // family, so 4 tiers of darkening with an aggressive shrink let a
    // packed cluster condense into a few dark, dense fragments instead
    // of a single oversized rock.  largeShardCollapseSize=130 catches
    // map-spawned giants (sizeMax=160) and trims them on first tick.
    density: {
      enabled: true,
      maxSteps: 4,
      areaThreshold: 32 * 32, // ~MIN_SIZE² × 2.5 — micro chips stay separate
      largeShardCollapseSize: 130,
      tintFloor: 0.55,
      shrinkFactor: 0.88,
    },
  },
  'glass-shard': {
    id: 'glass-shard',
    carrier: EntityType.STRUCTURE,
    spawn: GLASS_SHARD_SPAWN_SHAPE,
    regen: { kind: 'none' },
    merge: {
      attractedTo: 'none',
      bondsWith: { include: ['rock-shard', 'glass-shard'] },
      bondTimeSeconds: 10, bondTimeSizeRef: 20, bondTimeSizePower: 1.5,
      rules: [
        { partner: 'self',       outcome: 'compose' },
        { partner: 'rock-shard', outcome: 'compose', thresholdScale: 2.0 },
      ],
      defaultOutcome: 'compose',
    },
    shatter: {
      kind: 'powerlaw',
      style: 'asteroid',
      countMin: 2, countMax: 5,
      alphaMin: 0.4, alphaMax: 2.0,
      childVariant: 'glass-shard',
      forwardDrag: 0.35, perpScatter: 0.0,
      scatterHalfCone: Math.PI * 0.55,
    },
    onShatterParticles: 'inherit',
    passThrough: false,
    spawnsDropsOnDeath: true,
    // Density compaction: glass shards already render with a soft
    // translucent tint, so the floor stays at 0.55 (matches rock).
    // Glass tiles spawn shards in a power-law area distribution
    // (DropSystem.spawnGlassShards), so most live below the
    // largeShardCollapseSize and only the rare big chunk collapses.
    density: {
      enabled: true,
      maxSteps: 4,
      areaThreshold: 32 * 32,
      largeShardCollapseSize: 130,
      tintFloor: 0.55,
      shrinkFactor: 0.88,
    },
  },
  'plastic-shard': {
    id: 'plastic-shard',
    carrier: EntityType.STRUCTURE,
    spawn: SHARD_SPAWN_SHAPE_PLASTIC,
    regen: { kind: 'none' },
    // Self-bond only for now — plastic shards stick to other plastic
    // shards via the standard rock-style cohesion.  No cross-material
    // bonds with rock / glass / metal yet (kept narrow until we see
    // how the dent system shakes out).
    merge: {
      attractedTo: 'none',
      bondsWith: { include: ['plastic-shard'] },
      bondTimeSeconds: 10, bondTimeSizeRef: 20, bondTimeSizePower: 1.5,
      rules: [
        { partner: 'self', outcome: 'compose' },
      ],
      defaultOutcome: 'compose',
    },
    // Plastic shards are dent-driven: they deform per hit and are
    // destroyed cleanly on health = 0 (no recursive sub-shards).
    // Drops + particles fire via the mobile-shard path in
    // DropSystem.spawnDrops.
    shatter: {
      kind: 'none',
      style: 'asteroid',
      countMin: 0, countMax: 0,
      alphaMin: 1.0, alphaMax: 1.0,
      childVariant: 'plastic-shard',
      forwardDrag: 0, perpScatter: 0,
      scatterHalfCone: 0,
    },
    // Warm amber particle puff matches the matte-polymer body colour.
    onShatterParticles: { color: '#fbbf24', count: 5 },
    passThrough: false,
    spawnsDropsOnDeath: true,
    density: {
      enabled: true,
      maxSteps: 4,
      areaThreshold: 32 * 32,
      largeShardCollapseSize: 130,
      tintFloor: 0.60,                         // slightly higher floor — plastic stays warmer when dense
      shrinkFactor: 0.88,
    },
    // Free-floating plastic shards deform on hit just like plastic
    // tiles — each impact pulls one vertex inward.  Slightly lower
    // jitter than the tile (0.22 vs 0.25) since the shard is already
    // smaller and we want a few hits' worth of cumulative warp before
    // destruction.  breakShards is empty: when health hits 0 the
    // shard is destroyed cleanly and drops fall via the mobile-shard
    // path in DropSystem.spawnDrops.
    dent: {
      vertexJitter: 0.22,
      breakShards: [],
    },
  },
  'metal-shard': {
    id: 'metal-shard',
    carrier: EntityType.STRUCTURE,
    spawn: SHARD_SPAWN_SHAPE_METAL,
    regen: { kind: 'none' },
    merge: {
      attractedTo: 'none',
      bondsWith: { include: ['metal-shard'] },
      bondTimeSeconds: 10, bondTimeSizeRef: 20, bondTimeSizePower: 1.5,
      rules: [
        { partner: 'self', outcome: 'compose' },
      ],
      defaultOutcome: 'compose',
    },
    // Metal shards are dent-driven: deform per hit, destroyed cleanly
    // on health = 0 with drops + particles.  No recursive sub-shards.
    shatter: {
      kind: 'none',
      style: 'asteroid',
      countMin: 0, countMax: 0,
      alphaMin: 1.0, alphaMax: 1.0,
      childVariant: 'metal-shard',
      forwardDrag: 0, perpScatter: 0,
      scatterHalfCone: 0,
    },
    // Cool slate particle puff matches the gunmetal body colour.
    onShatterParticles: { color: '#cbd5e1', count: 5 },
    passThrough: false,
    spawnsDropsOnDeath: true,
    density: {
      enabled: true,
      maxSteps: 4,
      areaThreshold: 32 * 32,
      largeShardCollapseSize: 130,
      tintFloor: 0.50,                         // metal goes darker when packed dense
      shrinkFactor: 0.88,
    },
    // Metal shards deform subtly per hit (vertexJitter 0.10 vs
    // tile's 0.13) — the surface still reads as hard even after
    // detaching from the grid.  Empty breakShards: clean destruction
    // on health = 0.
    dent: {
      vertexJitter: 0.10,
      breakShards: [],
    },
  },
  'nebula-shard': {
    id: 'nebula-shard',
    carrier: EntityType.STRUCTURE,
    spawn: SHARD_SPAWN_SHAPE_NEBULA,
    regen: { kind: 'merge-only' },              // tiles regrow only via transmutation
    merge: {
      // Stage 5b: cross-variant gravity pull from nebula-shards
      // toward all mobile shard variants (self + rock-shard +
      // glass-shard).  Pull is unilateral — only nebula-shards have
      // attractedTo set; rock and glass shards are dragged toward
      // nebulae but don't pull each other or pull toward nebulae.
      attractedTo: { include: ['nebula-shard', 'rock-shard', 'glass-shard'] },
      pullRange:    NEBULA_CONSTANTS.GRAVITY_RANGE,
      pullStrength: NEBULA_CONSTANTS.GRAVITY_STRENGTH,
      pullMinDist:  NEBULA_CONSTANTS.GRAVITY_MIN_DIST,
      // Stick-bonds with self → compose (existing coalesce / transmute);
      // with glass-shard → absorb after long contact, gated on partner
      // reaching its variant sizeMax (rare, "unique event").
      // bondTimeSeconds: 0 fires self-compose instantly on contact
      // (matches today's nebula proximity-merge); glass-shard absorb
      // uses thresholdScale to scale to ~5× the self-compose time.
      bondsWith: { include: ['nebula-shard', 'glass-shard'] },
      bondTimeSeconds: 0,
      bondTimeSizeRef: 20,
      bondTimeSizePower: 1.5,
      rules: [
        { partner: 'self', outcome: 'compose' },
        {
          partner: 'glass-shard',
          outcome: 'absorb',
          // bondTimeSeconds=0 + thresholdScale would still be 0.  We
          // use NEBULA_CONSTANTS.MERGE_COOLDOWN × 5 as the absorb
          // threshold base by setting thresholdScale to a value the
          // resolver multiplies AGAINST a stand-in baseTime — handled
          // inside ShardSystem (see tickBonds gate).  In practice the
          // partner-size gate dominates: bonds persist (cohesion) and
          // never fire the absorb until the glass-shard reaches
          // sizeMax, which is a rare event regardless of timer.
          thresholdScale: 5.0,
          requirePartnerSizeFraction: 1.0,
        },
      ],
      defaultOutcome: 'compose',
      postMergeCooldown: NEBULA_CONSTANTS.MERGE_COOLDOWN,
    },
    shatter: { kind: 'none', countMin: 0, countMax: 0, alphaMin: 1, alphaMax: 1, childVariant: 'nebula-shard', forwardDrag: 0, perpScatter: 0, scatterHalfCone: 0 },
    // passThrough = true so shard-vs-shard and shard-vs-striker
    // contacts skip collision impulse entirely.  Mass = 0.01 alone
    // would let strikers pass with negligible impulse, but
    // shard-vs-shard pairs (both low-mass) would bounce apart
    // elastically — breaking the gravity-pull-then-merge cycle.
    // The flag is the cleanest fix and matches today's "shards are
    // INDESTRUCTIBLE — they pass through unchanged" behaviour.
    passThrough: true,
    spawnsDropsOnDeath: false,
    // Density compaction: nebula shards already grow toward
    // transmutation (HEX_AREA accumulation).  Density layers a
    // visual signal — successive merges darken the cloud — without
    // touching the existing area-based tile transmutation, which is
    // gated on `nebulaTileArea`, not size or tier.  Lower maxSteps
    // (3) since most shards transmute well before reaching the cap;
    // gentler shrinkFactor (0.92) preserves the cloud-style growth
    // feel while still trimming the merged shard slightly so it
    // reads as compaction.  areaThreshold=0 keeps every nebula
    // merge eligible — transmutation depends on it.
    density: {
      enabled: true,
      maxSteps: 3,
      areaThreshold: 0,
      largeShardCollapseSize: 110,
      tintFloor: 0.55,
      shrinkFactor: 0.92,
    },
  },
};

// ── Per-map entity-count table ──────────────────────────────────────
// Source of truth for "how many of variant X spawn on map Y", see
// docs/SHARD_SYSTEM.md §6.E.  Source of truth for rock-shard
// free-spawn counts (read via getRockShardFreeSpawn) and per-map
// tile-cluster sizing (read by MapClasses.populate).  Replaces
// the legacy ASTEROID_GENERATION_CONFIG + NEBULA_CONSTANTS.CLUSTER_*
// fields, both deleted in Stage 7.

export const MAP_POPULATION: Record<MapType, Partial<Record<ShardVariantId, PerMapVariantSpawn>>> = {
  [MapType.UNIVERSE]: {
    'rock-shard': { freeSpawn: { count: 140, minSize: 20, maxSize: 160, speedMultiplier: 1.5, spawnRadius: 3000 } },
    // STRUCTURE / NEBULA cluster counts.  Stage 7 inlines the
    // numbers that previously lived on NEBULA_CONSTANTS (CLUSTER_*
    // / OUTER_*); MAP_POPULATION is now the single source of truth.
    'glass-tile':          { tileCluster: { clusterCount: 14, minClusterSize: 10, maxClusterSize: 34 } },
    'plastic-tile':        { tileCluster: { clusterCount:  5, minClusterSize:  8, maxClusterSize: 22 } },
    'metal-tile':          { tileCluster: { clusterCount:  3, minClusterSize:  6, maxClusterSize: 14 } },
    'indestructible-tile': { tileCluster: { clusterCount:  1, minClusterSize:  3, maxClusterSize:  8 } },
    'nebula-tile': {
      tileCluster: {
        clusterCount:    65,    // halved for 7.5k map (was 130)
        minClusterSize:  14,
        maxClusterSize:  42,
        outer: {
          clusterCount:   120,  // halved for 7.5k map (was 240)
          minClusterSize: 7,
          maxClusterSize: 26,
        },
      },
    },
  },
  [MapType.RING]: {
    'rock-shard': { freeSpawn: { count: 280, minSize: 20, maxSize: 160, speedMultiplier: 1.5, spawnRadius: 2500 } },
  },
  [MapType.SEVEN_RINGS]: {
    'rock-shard': { freeSpawn: { count: 280, minSize: 20, maxSize: 160, speedMultiplier: 1.5, spawnRadius: 2500 } },
  },
  [MapType.POCKET]: {
    'rock-shard': { freeSpawn: { count: 1, minSize: 20, maxSize: 80, speedMultiplier: 1.5, spawnRadius: 800 } },
    'glass-tile':          { tileCluster: { clusterCount: 8, minClusterSize: 6, maxClusterSize: 14 } },
    'plastic-tile':        { tileCluster: { clusterCount: 5, minClusterSize: 5, maxClusterSize: 10 } },
    'metal-tile':          { tileCluster: { clusterCount: 3, minClusterSize: 4, maxClusterSize:  8 } },
    'indestructible-tile': { tileCluster: { clusterCount: 2, minClusterSize: 3, maxClusterSize:  5 } },
    'nebula-tile': {
      tileCluster: { clusterCount: 12, minClusterSize: 6, maxClusterSize: 20 },
    },
  },
  [MapType.ASTEROID_FIELD]: {
    'rock-shard': { freeSpawn: { count: 1200, minSize: 20, maxSize: 160, speedMultiplier: 1.5, spawnRadius: 2500 } },
  },
  [MapType.GLASS_FIELD]: {
    'glass-tile': { tileCluster: { clusterCount: 100, minClusterSize: 10, maxClusterSize: 30 } },
  },
  [MapType.PLASTIC_FIELD]: {
    'plastic-tile': { tileCluster: { clusterCount: 100, minClusterSize: 10, maxClusterSize: 30 } },
  },
  [MapType.METAL_FIELD]: {
    'metal-tile': { tileCluster: { clusterCount: 100, minClusterSize: 10, maxClusterSize: 30 } },
  },
  [MapType.INDESTRUCTIBLE_FIELD]: {
    'indestructible-tile': { tileCluster: { clusterCount: 100, minClusterSize: 10, maxClusterSize: 30 } },
  },
  [MapType.NEBULA_FIELD]: {
    'nebula-tile': {
      tileCluster: { clusterCount: 65, minClusterSize: 14, maxClusterSize: 42 },
    },
  },
  [MapType.ROCK_FIELD]: {
    'rock-tile': { tileCluster: { clusterCount: 100, minClusterSize: 10, maxClusterSize: 30 } },
  },
};

/**
 * Helper: read the rock-shard freeSpawn config for a map type.
 * Returns the MAP_POPULATION values; falls back to defaults for
 * maps that don't free-spawn rock-shards (e.g. tile-only showcases)
 * so the respawn-loop's count/size arithmetic doesn't blow up on
 * undefined.  Shape mirrors the legacy ASTEROID_GENERATION_CONFIG
 * record so call sites read like simple field accesses.
 */
export function getRockShardFreeSpawn(mapType: MapType): {
  count: number;
  minSize: number;
  maxSize: number;
  radius: number;
  speedMultiplier: number;
} {
  const cfg = MAP_POPULATION[mapType]?.['rock-shard']?.freeSpawn;
  return {
    count:           cfg?.count           ?? 0,
    minSize:         cfg?.minSize         ?? 20,
    maxSize:         cfg?.maxSize         ?? 160,
    radius:          cfg?.spawnRadius     ?? 2500,
    speedMultiplier: cfg?.speedMultiplier ?? 1.5,
  };
}
