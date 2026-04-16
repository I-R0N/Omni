

export enum MapType {
  UNIVERSE = 'UNIVERSE',
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
  scale: number; // Width multiplier: 1.0 during thrust, tapers toward 0 during decay
  // Optional per-point drift velocity (per-frame).  Used by the player thrust
  // trail so emitted points stream backward along the thrust direction rather
  // than following the player's motion path.
  vx?: number;
  vy?: number;
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
  BLASTER   = 'BLASTER',
  BURST     = 'BURST',
  SHOTGUN   = 'SHOTGUN',
  BOUNCER   = 'BOUNCER',
  LIGHTNING = 'LIGHTNING',
  HOMING    = 'HOMING',
  CANNON    = 'CANNON',
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
  pierce: number; // How many entities the projectile passes through after the first hit
  homing?: boolean; // Does it track targets?
  burstCount?: number; // How many shots in a burst sequence
  burstDelay?: number; // Time between burst shots
}

// ── Shard type ────────────────────────────────────────────────────────────────
// Discriminates the visual and physical origin of an asteroid-type entity.
// Add new variants here as the game gains new destructible material types.
export type ShardType = 'asteroid' | 'tile';

// ── Drop composition entry ────────────────────────────────────────────────────
// Tracks drops stored inside a composite asteroid, including absorbed power-ups.
export type DropCompositionEntry =
  | { type: 'ammo'; value: number; weapon: WeaponType }
  | { type: 'health'; value: number };

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
  maxSpeed?: number;    // Per-entity speed cap (overrides ENEMY_VARIANTS default when set)
  aggroTimer?: number;  // Remaining seconds of post-kill aggro boost (speed + shorter idle)
  
  // AI Specific Params (Orbiter/Skirmisher)
  orbitRadius?: number;
  orbitSpin?: number; // 1 or -1
  preferredDistance?: number;
  
  // Visuals
  polygonPoints?: Vector2[]; // For physics/collision shape
  rotationSpeed?: number;    // Radians per second (asteroids, debris, etc.)
  hitFlash?: number; // Timer for white flash effect on damage
  shield?: number;
  maxShield?: number;
  shieldRechargeTimer?: number; // Counts down from RECHARGE_DELAY; recharge starts at 0
  shieldHitFlash?: number; // Visual timer for shield ring visibility
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
  targetEntityId?: string; // For homing locking
  pierceCount?: number;    // Remaining penetrations; decremented on each hit; 0 = stops on first hit
  hitEntityIds?: string[]; // IDs already struck by this projectile (prevents re-hitting same entity)

  // Debug Visuals
  inputVector?: Vector2;

  // Player Weapon State
  currentWeapon?: WeaponType;
  weaponCooldown?: number;
  burstQueue?: number; // How many shots left in current burst
  burstTimer?: number; // Timer for next burst shot

  // Powerup pickup
  powerupWeapon?: WeaponType;

  // Per-weapon ammo-pickup flash: timer counts down from FLASH_DURATION → 0; amount shown as +N
  ammoPickupFlash?: Partial<Record<WeaponType, { timer: number; amount: number }>>;

  // Ammo per weapon (undefined key = not owned; BLASTER is always ∞ and has no entry)
  ammo?: Partial<Record<WeaponType, number>>;

  // Player resources (gold kept for drop-system compat until PR 2)
  gold?: number;

  // Drop item fields
  dropType?: 'ammo' | 'health' | 'glass';
  dropValue?: number;
  dropWeapon?: WeaponType;

  // Enemy tier (1 | 2 | 3) — used for drop scaling
  enemyTier?: number;

  // Tile regeneration — regenProgress counts up from 0; tile is a ghost
  // outline when regenProgress < TILE_REGEN_DELAY and active === false.
  regenProgress?: number;

  // Tile regen pop-in scale overshoot timer (counts down from REGEN_POP_DURATION)
  regenPopTimer?: number;

  // ── Shard identity ───────────────────────────────────────────────────────
  // Set on EntityType.ASTEROID entities that originate from a destructible
  // material.  Drives visual style and bonding affinity in the stick system.
  shardType?: ShardType;

  // Blended hex color of all absorbed power-up weapons; drives glow tinting
  // in the renderer.  Computed/blended in GameEngine when a power-up is
  // absorbed; undefined means no power-up content.
  powerupGlowColor?: string;

  // Composite asteroid — tracks every drop (including power-ups) stored
  // inside this asteroid; released as individual drops on destruction.
  dropComposition?: DropCompositionEntry[];

  // Lightning arc rendering — when true, arcPoints holds the chain vertices
  isLightningArc?: boolean;
  arcPoints?: Vector2[];

  // Marks a projectile spawned by the lightning weapon (for electric rendering + chain-on-hit)
  isLightningProjectile?: boolean;

  // When true, handleEntityDeath skips drop spawning (e.g. explosion kills)
  suppressDrops?: boolean;

  // Marks a projectile as a bouncer (thin green laser that reflects off tiles)
  isBouncer?: boolean;
  // Homing turn-rate multiplier: 1.0 = full tracking, 0.2 = very mild
  homingStrength?: number;
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
  shield?: number;
  maxShield?: number;
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

// Full-screen wave announcement banner rendered on the canvas.
export interface WaveAnnouncement {
  text: string;
  subtext?: string;
  color: string;
  lifetime: number;
  maxLifetime: number;
}

// Screen-space messages stacked above the player (damage taken, pickups, unlocks).
export interface PlayerHUDMessage {
  id: string;
  text: string;
  color: string;
  lifetime: number;
  maxLifetime: number;
}
