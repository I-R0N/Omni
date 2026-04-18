

import { WeaponConfig, WeaponType, MapType, EnemySubtype, EnemyRole } from './types';
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
  SLOT_W_MAX:    44,   // shrinks on narrow screens to clear the minimap
  SLOT_W_MIN:    24,
  SLOT_H:        48,
  SLOT_GAP:      4,
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
  TAP_THRESHOLD: 200,      // ms: max hold duration for a tap-to-fire
  TAP_DISTANCE_LIMIT: 20,  // px: max finger travel for a tap-to-fire
  ZERO_DELAY_SHOOTING: false, // if true, checkTap ignores hold duration
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

export const TRAIL_CONSTANTS = {
  LIFETIME: 2.5, // Seconds until trail part fades completely (longer = exhaust-like plume)
  MIN_DISTANCE_SQ: 30 // Minimum squared distance to move before recording a new trail point
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
};

export const ASTEROID_GENERATION_CONFIG: Record<MapType, { count: number, minSize: number, maxSize: number, radius: number, speedMultiplier: number }> = {
  [MapType.UNIVERSE]: {
    // Doubled on 2026-04-18 to 280 — denser belt now that pressure
    // breaking and the 50 % on-path spawn distribution keep collision
    // costs bounded even at higher population.  Same density as the
    // original 15k map but on the current 6k map, so cluster
    // encounters and traffic dynamics are visibly busier.
    count: 280,
    minSize: 20,
    maxSize: 160,
    // Spawn radius also halved so asteroids stay inside the wrap box
    // rather than being pushed across a seam immediately.
    radius: 2500,
    speedMultiplier: 1.5
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
  // damping = shards drift longer.  At 0.991, velocity halves in ~77
  // frames (~1.28 s) — paired with the reduced launch velocities below,
  // the total coast distance is preserved while making shards *move*
  // more slowly (same travel distance, ~33 % longer wall-clock time).
  LINEAR_DAMPING: 0.991,
  ANGULAR_DAMPING: 0.991,
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
  // Tuned low so shards drift toward merges over a few seconds instead
  // of snapping together on the first substep.
  GRAVITY_RANGE: 380,
  GRAVITY_STRENGTH: 300,
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
  // Cluster generation — tuned for heavy coverage across the map so that
  // nebula clusters naturally fill empty gaps between glass-tile clusters
  // and statistically overlap with some of the procedurally placed
  // background nebula puffs (which live in world space at ±~20 000 units).
  // The generator shares an "occupied coords" set with the glass pass so
  // adjacency conflicts are avoided; empty cells get priority naturally.
  CLUSTER_COUNT: 65,    // halved for 7.5k map (was 130)
  MIN_CLUSTER_SIZE: 14,
  MAX_CLUSTER_SIZE: 42,
  // Outer-zone cluster pass (sparser landmarks spread across the full map).
  OUTER_CLUSTER_COUNT: 120, // halved for 7.5k map (was 240)
  OUTER_MIN_CLUSTER_SIZE: 7,
  OUTER_MAX_CLUSTER_SIZE: 26,
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
  // alongside the usual shards.  Ammo type follows the same
  // wave-scaled ASTEROID_AMMO_PROGRESSION used by asteroids.
  AMMO_DROP_CHANCE: 0.06, // 6 % per shatter (tile OR shard)
  AMMO_PER_NEBULA: 3,     // ammo units per nebula drop
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


// ── Lightning chain tuning ───────────────────────────────────────────────────
export const LIGHTNING_CHAIN_RANGE = 200;           // hop range for subsequent chains
export const LIGHTNING_CHAIN_COUNT = 2;             // additional chain hops after projectile impact (up to 3 targets total)
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
  COUNT_PER_FRAME: 3,     // particles spawned per frame while moving
  MIN_SPEED_SQ: 0.04,     // below this (per-frame speed²), stop emitting
  LIFETIME_MIN: 0.25,
  LIFETIME_MAX: 0.55,
  SIZE_MIN: 0.4,
  SIZE_MAX: 1.2,
  // Palette of bright, cool-white hues for the sparkle
  COLORS: ['#ffffff', '#e0f2fe', '#bae6fd'] as string[],
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
export const WEAPONS: Record<WeaponType, WeaponConfig> = {
  [WeaponType.BLASTER]: {
    type: WeaponType.BLASTER,
    name: 'Blaster',
    cooldown: 0.005,
    speed: 9,
    damage: 2,
    lifetime: 1.5,
    color: '#ef4444', // Red — infinite ammo starter
    size: 6,
    count: 1,
    spread: 2,
    recoil: 0.5,
    pierce: 0
  },
  [WeaponType.BURST]: {
    type: WeaponType.BURST,
    name: 'Burst Rifle',
    cooldown: 0.005,
    speed: 12,
    damage: 3,
    lifetime: 3.0,
    color: '#f97316', // Orange
    size: 5,
    count: 1,
    spread: 1,
    recoil: 0.3,
    pierce: 2,
    burstCount: 3,
    burstDelay: 0.05
  },
  [WeaponType.SHOTGUN]: {
    type: WeaponType.SHOTGUN,
    name: 'Shotgun',
    cooldown: 0.005,
    speed: 12,
    damage: 1,
    lifetime: 0.4,
    color: '#facc15', // Yellow
    size: 5,
    count: 6,
    spread: 35,
    recoil: 3.0,
    pierce: 1
  },
  [WeaponType.BOUNCER]: {
    type: WeaponType.BOUNCER,
    name: 'Bouncer',
    cooldown: 0.005,   // matches BLASTER
    speed: 9,          // matches BLASTER
    damage: 2,         // matches BLASTER
    lifetime: 7,       // bounded beam life — cuts steady-state count ~3× vs 20s
    color: '#22c55e',  // Green — thin laser beam that bounces off tiles
    size: 6,
    count: 1,
    spread: 2,
    recoil: 0.5,
    pierce: 0,
  },
  [WeaponType.LIGHTNING]: {
    type: WeaponType.LIGHTNING,
    name: 'Lightning',
    cooldown: 0.2,     // fast fire rate
    speed: 3,          // slow drifting projectile; gravity pull curves it toward targets
    damage: 1,         // direct hit; chain hops scale down by 1/(totalHops-1) per hop
    lifetime: 15,      // bounded — prevents unbounded accumulation in target-poor areas
    color: '#22d3ee',  // Cyan — projectile that chains on impact
    size: 6,
    count: 1,
    spread: 3,
    recoil: 0.3,
    pierce: 0          // stops on first hit, then chains
  },
  [WeaponType.HOMING]: {
    type: WeaponType.HOMING,
    name: 'Seeker Missiles',
    cooldown: 0.005,
    speed: 7,
    damage: 2,
    lifetime: 3.0,
    color: '#3b82f6', // Blue
    size: 8,
    count: 1,
    spread: 10,
    recoil: 0.5,
    pierce: 0,
    homing: true
  },
  [WeaponType.CANNON]: {
    type: WeaponType.CANNON,
    name: 'Plasma Cannon',
    cooldown: 0.005,
    speed: 10,
    damage: 5,
    lifetime: 2.5,
    color: '#a855f7', // Purple
    size: 16,
    count: 1,
    spread: 0,
    recoil: 8.0,
    pierce: 5
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
  pierce: 0
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
  GRACE_PERIOD: 3.0, // Seconds between wave clear and next wave spawn
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

export const DROP_CONFIG = {
  // Ammo drop values
  AMMO_PER_ENEMY_OWN:         3,    // own-color ammo units per enemy drop
  AMMO_PER_ENEMY_NEXT:        2,    // next-color ammo units per enemy drop
  AMMO_PER_ASTEROID:          4,    // ammo units per asteroid drop
  // Drop-spawn probabilities
  AMMO_DROP_CHANCE_ASTEROID:  0.45, // 45 % chance an asteroid drops ammo
  AMMO_DROP_CHANCE_ENEMY_OWN: 0.55, // 55 % chance an enemy drops its own-color ammo
  AMMO_DROP_CHANCE_ENEMY_NEXT:0.25, // 25 % chance an enemy drops next-tier ammo
  // Health
  HEALTH_HEAL_AMOUNT:        100,   // HP restored per health drop
  // General
  COLLECT_RADIUS:             30,   // world units
  LIFETIME:                20.0, // seconds before drop despawns
  MAX_ACTIVE_DROPS:       100,   // hard cap
};

// Maps each enemy subtype to the ammo type they drop (own-color) and the next tier.
// RAMMER_1 is red (blaster color) — blaster is infinite, so they drop the first
// ammo-based weapon (BURST) instead.
export const ENEMY_AMMO_DROP: Record<EnemySubtype, { own: WeaponType; next: WeaponType }> = {
  [EnemySubtype.RAMMER_1]:  { own: WeaponType.BURST,     next: WeaponType.SHOTGUN   },
  [EnemySubtype.RAMMER_2]:  { own: WeaponType.BURST,     next: WeaponType.SHOTGUN   },
  [EnemySubtype.RAMMER_3]:  { own: WeaponType.SHOTGUN,   next: WeaponType.BOUNCER   },
  [EnemySubtype.SHOOTER_1]: { own: WeaponType.BOUNCER,   next: WeaponType.LIGHTNING },
  [EnemySubtype.SHOOTER_2]: { own: WeaponType.LIGHTNING, next: WeaponType.HOMING    },
  [EnemySubtype.SHOOTER_3]: { own: WeaponType.HOMING,    next: WeaponType.CANNON    },
};

// Wave-scaled asteroid ammo progression — earlier waves give cheaper ammo,
// later waves give rarer ammo.  Index into WEAPON_LIST (skip BLASTER at 0).
export const ASTEROID_AMMO_PROGRESSION: WeaponType[] = [
  WeaponType.BURST,     // waves 1–3
  WeaponType.BURST,     // waves 4–6
  WeaponType.SHOTGUN,   // waves 7–9
  WeaponType.SHOTGUN,   // waves 10–12
  WeaponType.BOUNCER,     // waves 13–15
  WeaponType.LIGHTNING, // waves 16–18
  WeaponType.HOMING,    // waves 19–21
  WeaponType.CANNON,    // waves 22+
];

/**
 * Compute the ammo-HUD slot layout for a given screen size.
 * Slots live to the right of the minimap, scaled to fit the available space.
 */
export function computeAmmoHUDLayout(screenWidth: number, screenHeight: number): {
  startX: number; startY: number; slotW: number; totalW: number;
} {
  const { SLOT_W_MAX, SLOT_W_MIN, SLOT_H, SLOT_GAP, BOTTOM_MARGIN } = AMMO_HUD_CONSTANTS;
  const { MARGIN: MM, SIZE: MS } = MINIMAP_CONSTANTS;

  // Horizontal: start just right of the minimap, leave symmetric margin on the right
  const leftClear   = MM + MS + SLOT_GAP * 2;   // minimap right edge + small gap
  const rightEdge   = screenWidth - MM;
  const availableW  = rightEdge - leftClear;

  // Scale slot width to fill available space without overflowing
  const slotW = Math.max(
    SLOT_W_MIN,
    Math.min(SLOT_W_MAX, Math.floor((availableW - (WEAPON_LIST.length - 1) * SLOT_GAP) / WEAPON_LIST.length))
  );
  const totalW = WEAPON_LIST.length * (slotW + SLOT_GAP) - SLOT_GAP;

  // Center the scaled group within the available width
  const startX = leftClear + Math.max(0, (availableW - totalW) / 2);
  const startY = screenHeight - SLOT_H - BOTTOM_MARGIN;

  return { startX, startY, slotW, totalW };
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
