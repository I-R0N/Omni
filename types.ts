

export enum MapType {
  UNIVERSE    = 'UNIVERSE',
  RING        = 'RING',
  SEVEN_RINGS = 'SEVEN_RINGS',
  // 1 000 × 1 000 sandbox containing every element (asteroids, glass /
  // reinforced / heavy / indestructible tiles, nebula clusters).  Useful
  // for quickly validating interactions between systems without having
  // to fly across a full-size map to find them.
  POCKET      = 'POCKET',
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
  // Emit-time orientation (radians) — captured for shape-aware player-trail
  // rendering (e.g. LINE / TRIANGLE need a fixed direction per point).
  angle?: number;
}

// Player trail shape — selectable from the debug panel.  CIRCLE is the
// production look; the rest are dev-only variants for visual A/B.
export enum TrailShape {
  CIRCLE   = 'CIRCLE',
  SQUARE   = 'SQUARE',
  TRIANGLE = 'TRIANGLE',
  LINE     = 'LINE',
  NONE     = 'NONE',
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
  // Nebula tile: occupies a hex grid cell like STRUCTURE, but is pass-through
  // (no collision impulse) and shatters into NEBULA_SHARDs on player/enemy contact.
  NEBULA = 'NEBULA',
  // Cloud-like debris spawned from a destroyed nebula tile.  Heavily damped
  // translation and rotation; pass-through to all entities.
  NEBULA_SHARD = 'NEBULA_SHARD',
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
export type ShardType = 'asteroid' | 'tile' | 'nebula';

// ── Nebula colour composition ────────────────────────────────────────────────
// Weighted list of base-palette hexes that make up a nebula tile or shard.
// Weights sum to 1 (within rounding).  Stored rather than pre-blended so that
// a shatter → merge cycle is lossless and future coalescence logic can
// recombine hues without drifting toward gray.
export interface NebulaColorStop {
  hex: string;
  weight: number;
}

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

  // ── Tile asteroid-pressure accumulator ───────────────────────────────────
  // Set on STRUCTURE tiles to track repeated sub-crash-threshold asteroid
  // impacts.  When `asteroidHitCount` reaches STRUCTURE_CONSTANTS
  // .ASTEROID_PRESSURE_HITS within the decaying `asteroidHitTimer` window,
  // the tile breaks permanently the same way a single above-threshold
  // momentum crash would.  `asteroidHitCooldown` debounces multi-substep
  // re-hits from a single bouncing rock so one glancing bounce counts as
  // one pressure event, not several.
  asteroidHitCount?: number;
  asteroidHitTimer?: number;
  asteroidHitCooldown?: number;

  // ── Tile variant ─────────────────────────────────────────────────────────
  // Set on STRUCTURE tiles. Identifies which STRUCTURE_VARIANTS entry drives
  // health, sprite selection, and destructibility.  Unset = glass (legacy).
  // 'indestructible' tiles ignore all damage paths and never queue for
  // regen; tiered variants ('reinforced', 'heavy') pick a damage-state
  // sprite from their variant's `sprites` list based on health/maxHealth.
  structureVariant?: 'glass' | 'reinforced' | 'heavy' | 'indestructible';

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

  // ── Nebula fields ────────────────────────────────────────────────────────
  // Set on NEBULA tiles and NEBULA_SHARD shards; carries the palette-blended
  // colour composition and the total polygon area (in world units²) that
  // drives the coalescence merge threshold.
  nebulaColorComposition?: NebulaColorStop[];
  // Render-time cache of blendCompositionToHex(nebulaColorComposition).
  // Populated lazily by RenderSystem on first draw and invalidated by
  // NebulaSystem whenever the composition mutates (merge, regen).
  // Avoids the per-shard per-frame composition-key string rebuild that
  // blendCompositionToHex's own cache keys on.
  nebulaBlendedHex?: string;
  // Render-time cache of the composite `${sprite}|${hex}` key used to
  // look up the tinted-sprite canvas in RenderSystem._tintedSprites.
  // Skips the per-frame key-string rebuild that getTintedSprite's
  // default path pays.  Populated lazily on NEBULA_SHARD draws and
  // invalidated when composition changes (NebulaSystem.mergeNebulas).
  // Only used for shards — tiles fall through the darken branch which
  // produces a neighbour-count-dependent key.
  nebulaTintedKey?: string;
  // Cached polygon area (used as merge target for shards).  Shards inherit
  // this from their parent tile so they know the reassembly threshold.
  nebulaTileArea?: number;
  // Hex grid coordinate (odd-r offset) of the source tile — preserved on
  // shards so coalescence can snap back to the same column/row layout.
  nebulaGridCol?: number;
  nebulaGridRow?: number;
  // Number of active nebula-tile neighbours in the 6 hex cells around this
  // tile (0 = isolated, 6 = fully interior).  Drives the interior-darken
  // render rule: edge tiles stay bright, interior tiles get progressively
  // darker.  NebulaSystem recomputes this lazily whenever tiles are
  // destroyed, regenerated, or transmuted from shards.
  nebulaNeighborCount?: number;
  // Per-entity linear and angular damping factors (applied per-frame at 60Hz).
  // Used by NEBULA_SHARD to fake cloud-like drag on both translation and spin.
  linearDamping?: number;
  angularDamping?: number;
  // Per-entity cooldown for nebula shatter triggering.  Set to
  // NEBULA_CONSTANTS.IMPACT_COOLDOWN on PLAYER/ENEMY strikers when they
  // shatter a nebula; ticked down each frame in PhysicsSystem.update.
  // While > 0, subsequent nebula contacts pass through without shattering.
  nebulaImpactCooldown?: number;
  // Per-shard cooldown before the shard can participate in a merge.
  // Set to NEBULA_CONSTANTS.MERGE_COOLDOWN at spawn (from shatter or
  // as the larger party of a previous merge) and ticked each substep
  // by PhysicsSystem.  NebulaSystem.updateDynamics skips any pair
  // where either party has a positive cooldown, so fresh shards stay
  // visible as distinct polygons for ~1.8 s before they can coalesce.
  nebulaMergeCooldown?: number;
  // Post-shatter fade timer on NEBULA tiles and shards.  While > 0 the
  // entity stays rendered but with alpha scaled by timer / nebulaFadeDuration.
  // On reaching 0, tiles become inactive and enter the regen wait;
  // shards are compacted out.
  nebulaFadeTimer?: number;
  // Effective duration for this particular fade-out (i.e., the value
  // nebulaFadeTimer starts at).  Stored per-entity so fast-collision
  // shatters can use a shorter duration than the base constant while
  // still letting the renderer compute alpha = timer / duration.
  nebulaFadeDuration?: number;
  // Birth fade-in timer on NEBULA tiles and shards.  While > 0 the
  // entity renders with alpha scaled by 1 − (timer / nebulaSpawnDuration),
  // so newly-created entities fade into existence slowly instead of
  // appearing instantly.  Ticked in PhysicsSystem.update.
  nebulaSpawnTimer?: number;
  // Effective duration for this particular fade-in (see nebulaFadeDuration).
  nebulaSpawnDuration?: number;
  // Twinkle scheduling — each nebula tile and shard hosts an occasional
  // fading-in/out star at a random in-sprite position.  The renderer
  // lazily initializes these fields on first draw, then advances the
  // schedule itself (no sim cost).  nebulaTwinkleNextAt is an absolute
  // time (seconds since epoch) at which the next twinkle starts; the
  // twinkle is "active" while now ∈ [nextAt, nextAt + TWINKLE_DURATION].
  // nebulaTwinkleX/Y are normalized [-1, 1] offsets within the sprite,
  // rerolled at the start of each twinkle cycle.
  nebulaTwinkleNextAt?: number;
  nebulaTwinkleX?: number;
  nebulaTwinkleY?: number;
}

export interface CameraState {
  position: Vector2;
  zoom: number;
  targetId: string | null;
  shakeOffset: Vector2;
}

// Per-frame performance sample set surfaced to the dev overlay.  All timing
// values are running averages in milliseconds over the last ~60 sim frames;
// counts are snapshots of the most recent sim step.  Every field is optional
// so the stats snapshot remains usable before the first sim tick populates
// the ring buffers (and so the main HUD can ignore it entirely).
export interface PerfSnapshot {
  // System update durations (ms, averaged)
  physicsMs: number;
  aiMs: number;
  homingMs: number;
  lightningMs: number;
  gravityMs: number;      // PhysicsSystem.applyGravity (attractor fields)
  localGravityMs: number; // PhysicsSystem.applyLocalGravity (player↔asteroid)
  collisionsMs: number;   // PhysicsSystem.handleEntityCollisions (broadphase + SAT)
  renderMs: number;
  flowFieldMs: number;    // FlowFieldGrid.flushEnemyField
  // Collision broadphase — peak dynamic-grid cell density observed last step
  maxCellDensity: number;
  // Entity counts (snapshot of most recent sim step)
  totalEntities: number;
  enemyCount: number;
  asteroidCount: number;    // Includes asteroid shards (shardType='asteroid'|'tile')
  projectileCount: number;
  particleCount: number;
  interactableCount: number; // Drops, portals, POIs
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
  nebulaSet?: 'A' | 'B' | 'ALL' | 'N16';
  trailShape?: TrailShape;
  weaponCount?: number;
  shield?: number;
  maxShield?: number;
  // Performance instrumentation — populated every frame, only displayed by
  // the dev-only F3 overlay so the normal HUD stays uncluttered.
  perf?: PerfSnapshot;
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
