

import { WeaponConfig, WeaponType, MapType, EnemySubtype } from './types';

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
    PLAYER_WIDTH: 32, PLAYER_HEIGHT: 4,
    ENEMY_WIDTH: 20, ENEMY_HEIGHT: 3,
    OFFSET_MODIFIER: 0.75, // Multiplier of entity size
    OFFSET_BASE: 8 // Pixel padding
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
  RANGE: 50000,         // World units radius shown in minimap
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
  PLAYER_INFLUENCE: 0.000005 // Reduced 100x again
};

export const TRAIL_CONSTANTS = {
  LIFETIME: 3.0, // Seconds until trail part fades completely
  MIN_DISTANCE_SQ: 50 // Minimum squared distance (10px) to move before recording a new trail point
};

export const SHOOTING_STAR_CONSTANTS = {
  MIN_TIMER: 100,
  MAX_TIMER: 300,
  SPEED_MIN: 800,
  SPEED_MAX: 3200
};

export const PLAYER_MOVEMENT_CONFIG: Record<MapType, { maxSpeed: number, acceleration: number, friction: number }> = {
  [MapType.UNIVERSE]: {
    maxSpeed: 300, // Fast travel across galaxy
    acceleration: 0.05, // Reduced from 0.125
    friction: 0.995 // Drag to stop from high speeds
  },
  [MapType.SOLAR_SYSTEM]: {
    maxSpeed: 250, // Dogfighting speed
    acceleration: 0.05, // Reduced from 0.125
    friction: 0.995 // High drift (low drag)
  },
  [MapType.LOCAL]: {
    maxSpeed: 80, // Controlled maneuvering
    acceleration: 0.05, // Reduced from 0.125
    friction: 0.985 // Atmospheric drag
  },
  [MapType.SUB_MAP]: {
    maxSpeed: 10, // Increased slightly from 6 to prevent stuck feeling
    acceleration: 0.375, // Reduced from 0.75
    friction: 0.85 // Reduced drag (was 0.75) to make movement cleaner
  }
};

export const ASTEROID_GENERATION_CONFIG: Record<MapType, { count: number, minSize: number, maxSize: number, radius: number, speedMultiplier: number }> = {
  [MapType.UNIVERSE]: {
    count: 200, 
    minSize: 20,   // Tiny debris
    maxSize: 180,  // Massive planet-killers
    radius: 3000,  // Reduced radius to concentrate asteroids
    speedMultiplier: 3.0
  },
  [MapType.SOLAR_SYSTEM]: {
    count: 400,
    minSize: 20,   // Standard small
    maxSize: 120,  // Large rocks
    radius: 5000,
    speedMultiplier: 2.0
  },
  [MapType.LOCAL]: {
    count: 80,
    minSize: 15,   // Surface rocks
    maxSize: 80,   // Large boulders
    radius: 2000,
    speedMultiplier: 0.5
  },
  [MapType.SUB_MAP]: {
    count: 0,
    minSize: 0,
    maxSize: 0,
    radius: 0,
    speedMultiplier: 0
  }
};

export const STRUCTURE_CONSTANTS = {
  SIZE: 40,
  HEALTH: 1, // Single shot destroy
  MASS: Infinity, // Immovable walls
  CRASH_VELOCITY_THRESHOLD: 4 // Speed needed to break through
};

export const EXPLOSION_CONSTANTS = {
  DURATION: 0.3, // Seconds
  SIZE_MULTIPLIER: -1.8
};

export const PARTICLE_CONSTANTS = {
  LIFETIME_MIN: 0.4,
  LIFETIME_MAX: 0.8,
  SPEED_MIN: 3,  // Reduced by 10x
  SPEED_MAX: 8,  // Reduced by 10x
  SIZE_MIN: 2,
  SIZE_MAX: 5
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

// --- ASSETS ---
export const ASSETS = {
  NEBULA_PUFF: 'generated_puff', // Key for procedural texture

  PLAYER_SHIP: "https://storage.googleapis.com/omniverse-assets/ship.png", 
  ENEMY_SHIP: "https://via.placeholder.com/64/FF0000/FFFFFF?text=Drone",
  ENEMY_BLUE: "https://via.placeholder.com/64/0000FF/FFFFFF?text=Charger",
  ENEMY_BLACK: "https://via.placeholder.com/64/000000/FFFFFF?text=Tank",
  ENEMY_GREEN: "https://via.placeholder.com/64/00FF00/000000?text=Skirm",
  EXPLOSION: "https://via.placeholder.com/128/FF4400/FFFFFF?text=BOOM",
  
  // Placeholder images for demo. REPLACE THESE with your hosted URLs from Google Cloud Storage.
  ASTEROID_1: "https://via.placeholder.com/100/808080/FFFFFF?text=Ast1",
  ASTEROID_2: "https://via.placeholder.com/100/606060/FFFFFF?text=Ast2",
  ASTEROID_3: "https://via.placeholder.com/100/404040/FFFFFF?text=Ast3",
  ASTEROID_ICE: "https://via.placeholder.com/100/A0FFFF/000000?text=Ice",
  ASTEROID_VOLCANIC: "https://via.placeholder.com/100/502020/FFFFFF?text=Lava",

  SUN: "https://via.placeholder.com/120/FFFF00/000000?text=Sun",
  PLANET_TERRAN: "https://via.placeholder.com/80/44FF44/000000?text=Terran",
  PLANET_RED: "https://via.placeholder.com/70/FF4444/000000?text=Mars",
  PLANET_ICE: "https://via.placeholder.com/100/88FFFF/000000?text=IceG",
  PORTAL: "https://via.placeholder.com/90/AA00FF/FFFFFF?text=Portal",
  HEX_STRUCTURE: "https://via.placeholder.com/80/4444FF/FFFFFF?text=Hex"
};

// Distinct configurations for different enemy types
export const ENEMY_VARIANTS: Record<EnemySubtype, any> = {
  [EnemySubtype.BASIC]: {
    color: '#f87171', // Red
    size: 20,
    health: 1,
    maxSpeed: 10,
    accel: 6,
    turnRate: 1.25,
    sprite: ASSETS.ENEMY_SHIP,
    mass: 10
  },
  [EnemySubtype.FAST_CHARGER]: {
    color: '#60a5fa', // Blue
    size: 18,
    health: 1,
    maxSpeed: 16, // Faster than basic
    accel: 10,
    turnRate: 1.5,
    sprite: ASSETS.ENEMY_BLUE,
    mass: 8
  },
  [EnemySubtype.TANK]: {
    color: '#94a3b8', // Grey/Black
    size: 28,
    health: 4, // Takes multiple hits
    maxSpeed: 5, // Slow
    accel: 2,
    turnRate: 0.5,
    sprite: ASSETS.ENEMY_BLACK,
    mass: 30
  },
  [EnemySubtype.SKIRMISHER]: {
    color: '#4ade80', // Green
    size: 20,
    health: 1,
    maxSpeed: 12,
    accel: 8,
    turnRate: 1.5,
    sprite: ASSETS.ENEMY_GREEN,
    mass: 12
  },
  // Map others to basic for now
  [EnemySubtype.ORBITER]: { color: '#c084fc', size: 20, health: 1, maxSpeed: 10, accel: 6, turnRate: 1.25, mass: 10 },
  [EnemySubtype.SNIPER]: { color: '#fbbf24', size: 20, health: 1, maxSpeed: 10, accel: 6, turnRate: 1.25, mass: 10 }
};
