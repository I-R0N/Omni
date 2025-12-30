

export enum MapType {
  UNIVERSE = 'UNIVERSE',
  SOLAR_SYSTEM = 'SOLAR_SYSTEM',
  LOCAL = 'LOCAL',
  SUB_MAP = 'SUB_MAP',
}

export enum GameState {
  MENU = 'MENU',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED'
}

export interface Vector2 {
  x: number;
  y: number;
}

export interface TrailPoint extends Vector2 {
  lifetime: number;
  maxLifetime: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export enum EntityType {
  PLAYER = 'PLAYER',
  ENEMY = 'ENEMY',
  PROJECTILE = 'PROJECTILE',
  INTERACTABLE = 'INTERACTABLE', // Portals, planets, stations
  ASTEROID = 'ASTEROID',
  STRUCTURE = 'STRUCTURE', // Destructible walls/blocks
  PARTICLE = 'PARTICLE',
}

export enum EnemySubtype {
  BASIC = 'BASIC',
  FAST_CHARGER = 'FAST_CHARGER',
  TANK = 'TANK',
  SKIRMISHER = 'SKIRMISHER',
  ORBITER = 'ORBITER',
  SNIPER = 'SNIPER'
}

export enum WeaponType {
  BLASTER = 'BLASTER',
  SHOTGUN = 'SHOTGUN',
  CANNON = 'CANNON',
  HOMING = 'HOMING',
  BURST = 'BURST'
}

export interface WeaponConfig {
  type: WeaponType;
  name: string;
  cooldown: number; // Time between shots (seconds)
  speed: number;
  damage: number;
  lifetime: number;
  color: string;
  size: number;
  count: number; // Number of projectiles per shot
  spread: number; // Angle spread in degrees
  recoil: number; // Mass multiplier for recoil
  homing?: boolean; // Does it track targets?
  burstCount?: number; // How many shots in a burst sequence
  burstDelay?: number; // Time between burst shots
}

export interface GameEntity {
  id: string;
  type: EntityType;
  name?: string;
  position: Vector2;
  velocity: Vector2;
  size: Vector2; // Treated as bounding box or diameter
  rotation: number;
  color: string;
  active: boolean;
  health: number;
  maxHealth: number;
  
  // Physics
  mass: number;
  friction?: number; // Per-entity friction override
  gravityRange?: number; // Radius of gravitational influence
  gravityStrength?: number; // Force multiplier (G * Mass)

  // AI
  enemySubtype?: EnemySubtype;
  aiState?: 'idle' | 'chase' | 'flee' | 'hunt' | 'skirmish' | 'orbit' | 'snipe';
  aiTimer?: number;
  visionRange?: number;
  
  // AI Specific Params (Orbiter/Skirmisher)
  orbitRadius?: number;
  orbitSpin?: number; // 1 or -1
  preferredDistance?: number;
  
  // Visuals
  polygonPoints?: Vector2[]; // For physics/collision shape
  hitFlash?: number; // Timer for white flash effect on damage
  sprite?: string; // URL or DataURI for image rendering
  trail?: TrailPoint[]; // Path history with lifetime
  
  // Explosion Effect
  isExploding?: boolean;
  explosionTimer?: number;

  // For navigation/portals
  targetMapId?: string;
  targetMapType?: MapType;
  
  // For temporary entities
  lifetime?: number;
  maxLifetime?: number; // For alpha fading

  // Orbital Mechanics
  orbitCenter?: Vector2;
  // orbitRadius used above for AI as well, compatible usage
  orbitSpeed?: number; // radians per second
  orbitAngle?: number; // current angle in radians

  // Projectile specifics
  damage?: number;
  homing?: boolean;
  ownerType?: EntityType; // Who fired the projectile (prevents friendly fire)
  targetEntityId?: string; // For homing locking

  // Debug Visuals
  inputVector?: Vector2;

  // Player Weapon State
  currentWeapon?: WeaponType;
  weaponCooldown?: number;
  burstQueue?: number; // How many shots left in current burst
  burstTimer?: number; // Timer for next burst shot
}

export interface CameraState {
  position: Vector2;
  zoom: number;
  targetId: string | null;
  shakeOffset: Vector2;
}

export interface EngineStats {
  fps: number;
  entityCount: number;
  currentMapName: string;
  currentMapType: MapType;
  currentWeapon: string;
  gameState: GameState;
  difficulty?: number;
}

export interface DamageText {
  id: string;
  position: Vector2;
  text: string;
  velocity: Vector2;
  lifetime: number;
  maxLifetime: number;
  color: string;
  active: boolean;
}
