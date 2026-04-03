

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

export type MultiplayerMode = 'solo' | 'host' | 'client';

export interface MultiplayerStartOptions {
  mode: MultiplayerMode;
  roomId?: string;
  playerName?: string;
}

export interface NetworkPlayerInput {
  movement: Vector2;
  aimAngle: number;
  fireAngles: number[];
}

export interface TrailPoint extends Vector2 {
  lifetime: number;
  maxLifetime: number;
  scale: number; // Width multiplier: 1.0 during thrust, tapers toward 0 during decay
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
  // Ramming enemies — charge into the player
  RAMMER_1 = 'RAMMER_1',
  RAMMER_2 = 'RAMMER_2',
  RAMMER_3 = 'RAMMER_3',
  // Shooting enemies — keep distance and fire
  SHOOTER_1 = 'SHOOTER_1',
  SHOOTER_2 = 'SHOOTER_2',
  SHOOTER_3 = 'SHOOTER_3',
}

export enum EnemyRole {
  RAMMING  = 'RAMMING',
  SHOOTING = 'SHOOTING',
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
  playerId?: string;
  playerName?: string;
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
  rotationSpeed?: number;    // Radians per second (asteroids, debris, etc.)
  hitFlash?: number; // Timer for white flash effect on damage
  sprite?: string; // URL or DataURI for image rendering
  lastImpactVelocity?: Vector2; // Velocity of the entity that destroyed this one (used to bias shard scatter)
  lastImpactDamage?: number;   // Damage of the killing blow (used to scale shard count/size)
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
  ownerId?: string;
  targetEntityId?: string; // For homing locking

  // Debug Visuals
  inputVector?: Vector2;

  // Player Weapon State
  currentWeapon?: WeaponType;
  weaponCooldown?: number;
  burstQueue?: number; // How many shots left in current burst
  burstTimer?: number; // Timer for next burst shot

  // Powerup pickup
  powerupWeapon?: WeaponType;

  // Player resources
  fuel?: number;
  maxFuel?: number;
  gold?: number;

  // Drop item fields
  dropType?: 'fuel' | 'gold' | 'powerup' | 'health' | 'glass';
  dropValue?: number;
  dropWeapon?: WeaponType;

  // Enemy tier (1 | 2 | 3) — used for drop scaling
  enemyTier?: number;

  // Tile regeneration — regenProgress counts up from 0; tile is a ghost
  // outline when regenProgress < TILE_REGEN_DELAY and active === false.
  regenProgress?: number;
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
  waveNumber?: number;
  waveTotal?: number;
  waveStatus?: 'active' | 'cleared' | 'complete';
  waveGraceTimer?: number;
  debugMode?: boolean;
  weaponCount?: number;
  fuel?: number;
  maxFuel?: number;
  gold?: number;
  multiplayerMode?: MultiplayerMode;
  roomId?: string;
  playerName?: string;
  connectedPlayers?: number;
  isHost?: boolean;
  syncState?: 'offline' | 'connecting' | 'connected';
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

export interface MultiplayerPeer {
  playerId: string;
  playerName: string;
}

export interface MultiplayerSnapshot {
  gameState: GameState;
  mapType: MapType;
  currentMapName: string;
  entities: GameEntity[];
  damageTexts: DamageText[];
  connectedPlayers: number;
  difficulty: number;
  waveNumber?: number;
  waveTotal?: number;
  waveStatus?: 'active' | 'cleared' | 'complete';
  waveGraceTimer?: number;
}
