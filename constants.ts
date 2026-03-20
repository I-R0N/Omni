

import { WeaponConfig, WeaponType, MapType, EnemySubtype } from './types';
import { ASSETS } from './assets';

export const CHUNK_SIZE = 16; // 16x16 tiles
export const SPATIAL_GRID_SIZE = 120; // Physics optimization bucket size

export const CANVAS_WIDTH = window.innerWidth;
export const CANVAS_HEIGHT = window.innerHeight;

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
  REACTION_TIME_BASE: 0.3,
  REACTION_TIME_VAR: 0.5,
  
  // State switching timers
  IDLE_TIME_BASE: 1.0,
  IDLE_TIME_VAR: 1.5,
  CHASE_TIME_BASE: 2.0,
  CHASE_TIME_VAR: 2.0,

  // Flight Physics
  ROTATION_THRESHOLD: 20, // Speed at which enemy rotates to face velocity instead of target

  // Skirmisher specific behavior
  SKIRMISHER: {
    PREFERRED_DIST: 300,
    DEADZONE: 50,
    STRAFE_MODIFIER: 0.5
  }
};

export const COLLISION_CONFIG = {
  // Physics Resolution
  ELASTICITY: 0.5, // Bounciness (0 to 1)
  CORRECTION_PERCENT: 0.2, // How much overlap to fix per frame
  SLOP: 0.01, // Penetration allowance to prevent jitter

  // Damage Values
  DAMAGE: {
    ASTEROID_CRUSH: 999, // Instant kill
    PLAYER_RAM_ENEMY: 5,
    STRUCTURE_IMPACT: 10,
    MINOR_IMPACT: 1
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

export const MINIMAP_CONSTANTS = {
  SIZE: 75,            // Smaller Default
  EXPANDED_SIZE: 280,  // Larger when touched
  MARGIN: 20,          // Distance from screen edge
  RANGE: 8000,         // World units radius shown in minimap (universe is large)
  BG_COLOR: 'rgba(15, 23, 42, 0.85)',
  BORDER_COLOR: 'rgba(56, 189, 248, 0.4)',
  PLAYER_DOT_COLOR: '#ffffff'
};

export const INPUT_CONSTANTS = {
  TAP_THRESHOLD: 200,     // ms: Time to differentiate tap vs hold (delay before moving)
  TAP_DISTANCE_LIMIT: 20,  // px: Max movement allowed for a tap
  ZERO_DELAY_SHOOTING: false, // If true, movement is instant (no delay), checkTap ignores duration
  THROTTLE_DISTANCE: 150, // px: Distance drag to reach max acceleration
  MIN_THROTTLE: 0.1,     // Absolute minimum floor (reduced to allow radial logic to take over)
  RADIAL_ACCEL_FACTOR: 0.0006 // Factor to convert pixel distance from center to base acceleration
};

export const PHYSICS_CONSTANTS = {
  FRICTION: 0.999, // Fallback default
  ACCELERATION: 0.02, // Fallback default (Reduced from 0.04)
  MAX_SPEED: 15,
  PLAYER_MASS: 100, // Heavier player = less recoil
  RECOIL_FORCE: 0 // Legacy, unused now that mass is implemented
};

export const LOCAL_GRAVITY_CONSTANTS = {
  RANGE: 400,          // Pixel radius where gravity takes effect
  STRENGTH: 0.00015,     // Reduced 100x again (1000x total reduction)
  MIN_DIST: 50,        // Clamp to prevent infinite force at center
  PLAYER_INFLUENCE: 0.00001 // Reduced 100x again
};

export const TRAIL_CONSTANTS = {
  LIFETIME: 1.2, // Seconds until trail part fades completely
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
    acceleration: 0.04,
    friction: 0.994
  },
  [MapType.SOLAR_SYSTEM]: {
    maxSpeed: 100,
    acceleration: 0.04,
    friction: 0.994
  },
  [MapType.LOCAL]: {
    maxSpeed: 38,
    acceleration: 0.04,
    friction: 0.983
  },
  [MapType.SUB_MAP]: {
    maxSpeed: 6,
    acceleration: 0.3,
    friction: 0.84
  }
};

export const ASTEROID_GENERATION_CONFIG: Record<MapType, { count: number, minSize: number, maxSize: number, radius: number, speedMultiplier: number }> = {
  [MapType.UNIVERSE]: {
    count: 280,
    minSize: 20,
    maxSize: 160,
    radius: 5000,
    speedMultiplier: 1.5
  },
  // Unused map types — kept for type completeness
  [MapType.SOLAR_SYSTEM]: { count: 0, minSize: 0, maxSize: 0, radius: 0, speedMultiplier: 0 },
  [MapType.LOCAL]:        { count: 0, minSize: 0, maxSize: 0, radius: 0, speedMultiplier: 0 },
  [MapType.SUB_MAP]:      { count: 0, minSize: 0, maxSize: 0, radius: 0, speedMultiplier: 0 }
};

export const STRUCTURE_CONSTANTS = {
  SIZE: 30,
  HEALTH: 1, // Single shot destroy
  MASS: Infinity, // Immovable walls
  CRASH_VELOCITY_THRESHOLD: 4 // Speed needed to break through
};

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

export const PROJECTILE_CONSTANTS = {
  SPEED: 3, // Reduced from 12
  SIZE: 8,
  COLOR: '#facc15', // Yellow
  LIFETIME: 1.5, // Seconds
  MASS: 1, // Light projectile
};

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

export const WEAPONS: Record<WeaponType, WeaponConfig> = {
  [WeaponType.BLASTER]: {
    type: WeaponType.BLASTER,
    name: 'Blaster',
    cooldown: 0.005,
    speed: 9, // Reduced from 12
    damage: 2, // Buffed to ensure 1-shot kill (Enemy Health is 1)
    lifetime: 1.5,
    color: '#facc15', // Yellow
    size: 6,
    count: 1,
    spread: 2,
    recoil: 0.5
  },
  [WeaponType.SHOTGUN]: {
    type: WeaponType.SHOTGUN,
    name: 'Shotgun',
    cooldown: 0.005,
    speed: 12, // Reduced from 10
    damage: 1,
    lifetime: 0.4, // Short range
    color: '#f87171', // Red
    size: 5,
    count: 6,
    spread: 35,
    recoil: 3.0
  },
  [WeaponType.CANNON]: {
    type: WeaponType.CANNON,
    name: 'Plasma Cannon',
    cooldown: 0.005,
    speed: 10, // Reduced from 8
    damage: 5,
    lifetime: 2.5,
    color: '#22d3ee', // Cyan
    size: 16,
    count: 1,
    spread: 0,
    recoil: 8.0
  },
  [WeaponType.HOMING]: {
    type: WeaponType.HOMING,
    name: 'Seeker Missiles',
    cooldown: 0.005,
    speed: 7, // Reduced from 6
    damage: 2,
    lifetime: 3.0,
    color: '#c084fc', // Purple
    size: 8,
    count: 1,
    spread: 10,
    recoil: 0.5,
    homing: true
  },
  [WeaponType.BURST]: {
    type: WeaponType.BURST,
    name: 'Burst Rifle',
    cooldown: 0.005,
    speed: 12, // Reduced from 14
    damage: 1,
    lifetime: 3.0,
    color: '#4ade80', // Green
    size: 5,
    count: 1,
    spread: 1,
    recoil: 0.3,
    burstCount: 3,
    burstDelay: 0.05
  }
};

export const WEAPON_LIST = [
  WeaponType.BLASTER,
  WeaponType.BURST,
  WeaponType.SHOTGUN,
  WeaponType.HOMING,
  WeaponType.CANNON
];

// Simple enemy blaster (separate so we can tune independently of player weapons)
export const ENEMY_WEAPON: WeaponConfig = {
  type: WeaponType.BLASTER,
  name: 'Enemy Blaster',
  cooldown: 1.2,
  speed: 0.8, // 10× slower than original 8 — baseline to increase per wave
  damage: 5,
  lifetime: 2.0,
  color: '#f97316',
  size: 6,
  count: 1,
  spread: 4,
  recoil: 0
};

// --- ASSETS ---
export { ASSETS };

// Difficulty (enemy count multiplier) 0 = none, 3 = full
export const DIFFICULTY_SCALES: Record<number, number> = {
  0: 0,    // No enemies
  1: 0.35, // Low
  2: 0.65, // Moderate
  3: 1     // High (current default)
};

// Distinct configurations for different enemy types
export const ENEMY_VARIANTS: Record<EnemySubtype, any> = {
  [EnemySubtype.BASIC]: {
    color: '#f87171', // Red
    size: 30,
    health: 1,
    maxSpeed: 3,
    accel: 2,
    turnRate: 1.2,
    sprite: ASSETS.ENEMY_DRONE,
    mass: 10
  },
  [EnemySubtype.FAST_CHARGER]: {
    color: '#60a5fa', // Blue
    size: 30,
    health: 1,
    maxSpeed: 6,
    accel: 3.5,
    turnRate: 1.3,
    sprite: ASSETS.ENEMY_CHARGER,
    mass: 8
  },
  [EnemySubtype.TANK]: {
    color: '#94a3b8', // Grey/Black
    size: 34,
    health: 4,
    maxSpeed: 2.5,
    accel: 1.5,
    turnRate: 0.4,
    sprite: ASSETS.ENEMY_TANK,
    mass: 30
  },
  [EnemySubtype.SKIRMISHER]: {
    color: '#4ade80', // Green
    size: 30,
    health: 1,
    maxSpeed: 5,
    accel: 2.5,
    turnRate: 1.3,
    sprite: ASSETS.ENEMY_SKIRMISHER,
    mass: 12
  },
  [EnemySubtype.ORBITER]: { color: '#c084fc', size: 30, health: 1, maxSpeed: 4, accel: 2, turnRate: 1.0, sprite: ASSETS.ENEMY_ORBITER, mass: 10 },
  [EnemySubtype.SNIPER]: { color: '#fbbf24', size: 30, health: 1, maxSpeed: 3.5, accel: 2, turnRate: 1.0, sprite: ASSETS.ENEMY_SNIPER, mass: 10 }
};

// 5 escalating waves of enemies. powerup: weapon unlocked when wave is cleared (null = victory, no powerup)
export const WAVE_DEFINITIONS: { enemies: { subtype: EnemySubtype; count: number }[]; powerup: WeaponType | null }[] = [
  // Wave 1: Three basic drones — easy introduction
  {
    enemies: [{ subtype: EnemySubtype.BASIC, count: 3 }],
    powerup: WeaponType.BURST
  },
  // Wave 2: More basics + agile skirmishers
  {
    enemies: [{ subtype: EnemySubtype.BASIC, count: 3 }, { subtype: EnemySubtype.SKIRMISHER, count: 2 }],
    powerup: WeaponType.SHOTGUN
  },
  // Wave 3: Fast chargers join the mix
  {
    enemies: [{ subtype: EnemySubtype.FAST_CHARGER, count: 2 }, { subtype: EnemySubtype.SKIRMISHER, count: 2 }, { subtype: EnemySubtype.BASIC, count: 2 }],
    powerup: WeaponType.HOMING
  },
  // Wave 4: Armored tank leads the charge
  {
    enemies: [{ subtype: EnemySubtype.TANK, count: 1 }, { subtype: EnemySubtype.FAST_CHARGER, count: 2 }, { subtype: EnemySubtype.SKIRMISHER, count: 3 }],
    powerup: WeaponType.CANNON
  },
  // Wave 5: Full assault — all enemy types
  {
    enemies: [
      { subtype: EnemySubtype.TANK, count: 2 },
      { subtype: EnemySubtype.FAST_CHARGER, count: 2 },
      { subtype: EnemySubtype.SKIRMISHER, count: 2 },
      { subtype: EnemySubtype.ORBITER, count: 1 },
      { subtype: EnemySubtype.SNIPER, count: 1 }
    ],
    powerup: null // Victory — no more waves
  }
];
