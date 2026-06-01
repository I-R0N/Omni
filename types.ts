

// ShardVariantId is defined in engine/systems/ShardSystem.types.ts
// (the schema lives next to the system implementation).  Imported
// type-only here so the GameEntity field can be strongly typed
// without creating a runtime cycle — types.ts is widely imported
// across the engine, and the type-only import is erased at compile
// time.
import type { ShardVariantId } from './engine/systems/ShardSystem.types';

export enum MapType {
  UNIVERSE    = 'UNIVERSE',
  RING        = 'RING',
  SEVEN_RINGS = 'SEVEN_RINGS',
  // 1 000 × 1 000 sandbox containing every element (asteroids, glass /
  // plastic / metal / indestructible tiles, nebula clusters).  Useful
  // for quickly validating interactions between systems without having
  // to fly across a full-size map to find them.
  POCKET      = 'POCKET',
  // Single-element 6 000 × 6 000 showcase maps.  Each one populates the
  // playfield with exactly one entity type so systems (flow fields,
  // collision, regen, pathing, nebula shatter) can be stressed in
  // isolation without cross-element interference.
  ASTEROID_FIELD       = 'ASTEROID_FIELD',
  GLASS_FIELD          = 'GLASS_FIELD',
  PLASTIC_FIELD        = 'PLASTIC_FIELD',
  METAL_FIELD          = 'METAL_FIELD',
  INDESTRUCTIBLE_FIELD = 'INDESTRUCTIBLE_FIELD',
  NEBULA_FIELD         = 'NEBULA_FIELD',
  // Rock-tile single-element showcase (Stage 7 of shard-system overhaul)
  // — exercises the new tile→shard lineage where a rock-tile cluster
  // shatters into rock-shards that drift / merge / accrete.
  ROCK_FIELD           = 'ROCK_FIELD',
  // Tile-heavy stress map — dense clusters of every destructible /
  // permanent tile variant packed across a 6 k × 6 k playfield.  Used
  // for evaluating tile-glow render cost (the F3 overlay's `·tLit`
  // row) with a representative on-screen tile count.
  TILE_HEAVY           = 'TILE_HEAVY',
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
  // Marks the first point emitted in a fresh thrust event.  PATH rendering
  // breaks the polyline at chain starts so a stop-and-restart doesn't draw
  // a long segment connecting the old tail to the new head.
  chainStart?: boolean;
}

// Player trail shape — selectable from the debug panel.  CIRCLE is the
// production look; the rest are dev-only variants for visual A/B.
export enum TrailShape {
  CIRCLE   = 'CIRCLE',
  SQUARE   = 'SQUARE',
  TRIANGLE = 'TRIANGLE',
  LINE     = 'LINE',
  PATH     = 'PATH',
  DOTS     = 'DOTS',
  NONE     = 'NONE',
}

// Player trail emission gate — debug-only toggle.  THRUST (default) ties
// emission to input/acceleration so coasting at full speed produces no
// trail; VELOCITY ties it to translation so the trail reads off the
// ship's motion regardless of whether thrust is applied.
export enum TrailEmitMode {
  THRUST   = 'THRUST',
  VELOCITY = 'VELOCITY',
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
  // STRUCTURE — the unified shard-family carrier (post-Stage-5
  // EntityType collapse).  Static tiles (mass = ∞) and mobile
  // shards (finite mass) share this type; per-variant behaviour
  // lives in SHARD_VARIANTS, dispatched by the entity's
  // `shardVariant` field.  TODO: rename — semantics broadened
  // beyond "destructible walls/blocks" (covers cloud / rock /
  // glass).  Candidates: MATTER / MATERIAL / BODY.
  STRUCTURE = 'STRUCTURE',
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
  // Shared-ammo deduction per normal (tap) trigger pull.  Blaster = 0
  // (infinite); every other weapon = 1.  Charged shots use chargedAmmoCost.
  ammoCost: number;
  // Shared-ammo deduction for a charged (hold-to-fire) trigger pull.
  // Blaster = 0; every other weapon = 2.  When the shared pool is short of
  // chargedAmmoCost on charge release, WeaponSystem falls back to a normal
  // shot at ammoCost.
  chargedAmmoCost: number;
  // Maximum tile-bounces for a bouncer projectile.  Bouncer is the only
  // weapon that uses this today; absent on other configs.
  bounceCount?: number;
  // Cannon AoE-on-impact primitive.  When set, every entity within
  // `explosionRadius` of the impact (toroidal-corrected) takes
  // `explosionDamage` and a knockback impulse with magnitude scaling from
  // `explosionKnockback` at the centre to 0 at the rim.
  explosionRadius?: number;
  explosionDamage?: number;
  explosionKnockback?: number;
  // Lightning chain overrides — when set, replaces the default
  // LIGHTNING_CHAIN_COUNT / LIGHTNING_CHAIN_RANGE / LIGHTNING_CHAIN_BRANCHES
  // constants for the chain triggered by this projectile's impact.  Used
  // by the charged Lightning variant to amplify all three.
  chainCount?: number;
  chainRange?: number;
  chainBranches?: number;
  // Charged-shot render hint — ProjectileSystem.spawn copies this onto
  // the projectile so RenderSystem can pick a custom visual (today only
  // the charged Blaster fireball uses it).
  isCharged?: boolean;
  // When set with count > 1, ProjectileSystem.spawn distributes the
  // projectiles in an equal-angle ring around the aim direction (every
  // 360°/count) instead of a forward-cone fan.  Used by the charged
  // Bouncer's omnidirectional nova.
  omniDirectional?: boolean;
  homing?: boolean; // Does it track targets?
  // Per-weapon homing turn-rate multiplier (1.0 = full tracking).  Charged
  // Homing volleys reduce this so the missiles fan out rather than all
  // converging on the same target.
  homingStrength?: number;
  burstCount?: number; // How many shots in a burst sequence
  burstDelay?: number; // Time between burst shots
}

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
// Post-d1: ammo is a single shared currency, so ammo entries no longer carry
// a per-weapon tag — `value` is the shared-pool amount the drop will award on
// release.
export type DropCompositionEntry =
  | { type: 'ammo'; value: number }
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
  // Stable per-shard lane bias in [-1, 1] for the asteroid-flow lane
  // jitter (DBG "FF Lane").  Lazily seeded the first time the flow
  // nudge processes the entity; constant thereafter so the shard
  // keeps the same offset lane instead of jittering frame-to-frame.
  flowLane?: number;

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
  // Set on the trigger pull that started the current burst — true if the
  // burst was a charged shot.  Read by tickPlayerBurst so sub-shots inherit
  // the charged config (pierce 3 instead of 2, etc.).
  burstCharged?: boolean;

  // Charge-shot progress: 0 (not charging) … 1 (full).  Updated each frame
  // by GameEngine from InputSystem.getMouseHoldDuration().  Read by
  // RenderSystem to draw the charge ring around the player ship.
  chargeProgress?: number;

  // Powerup pickup
  powerupWeapon?: WeaponType;

  // Shared-pool ammo-pickup flash: timer counts down from FLASH_DURATION → 0;
  // `amount` accumulates +N pickups inside the same flash window.
  ammoPickupFlash?: { timer: number; amount: number };

  // Shared ammo pool — single currency consumed by every non-blaster weapon
  // at its per-weapon `ammoCost`.  Blaster is infinite and bypasses this pool.
  ammo?: number;

  // Player resources (gold kept for drop-system compat until PR 2)
  gold?: number;

  // Drop item fields
  dropType?: 'ammo' | 'health' | 'glass';
  dropValue?: number;
  // Magnet latch: set once a drop first enters the player's pull range.
  // Thereafter it homes to completion regardless of distance.
  magnetized?: boolean;

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

  // ── Unified shard-variant identity ──────────────────────────────────────
  // Single source of truth for which SHARD_VARIANTS entry a shard-family
  // entity belongs to.  Set at every spawn site; resolves via
  // `shardVariantOf()` (engine/systems/ShardSystem.ts) for callers that
  // also accept legacy entities (none today, kept defensive).
  // See docs/SHARD_SYSTEM.md.
  shardVariant?: ShardVariantId;

  // Number of base shards that have composed into this entity (plastic-
  // shard only).  Each tile-break / shatter spawn starts implicitly at 1
  // (undefined === 1); composeEntities sums the two parents' counts on
  // a plastic↔plastic self-merge.  shatterAsteroidStyle reads this on
  // death and breaks the shard into `plasticMergeCount` fragments, so a
  // merged plastic shard always fragments back into roughly the same
  // number of base-sized pieces that built it.
  plasticMergeCount?: number;

  // ── Metal rigid-composite assembly ──────────────────────────────────────
  // A metal-shard entity carrying `metalCells` is a rigid composite: a set
  // of equilateral-triangle cells locked to a shared triangular lattice.
  // Each cell is an integer lattice key (ix,iy) + up/down orientation;
  // its lattice-frame centroid is (ix·R·√3/2, iy·R/2) where R =
  // `metalLatticeR` (the constituent triangle's circumradius).  The entity's
  // `position` is the composite's mass centroid and `rotation` orients the
  // lattice; the body drifts/spins as one via velocity + rotationSpeed.
  // Loose metal triangles snap into the composite's empty hexagon slots
  // (see ShardSystem.tickMetalAssembly); a composite only ever fills the 6
  // cells of one hexagon.  Once all 6 are filled the composite is a complete
  // floating hexagon: `metalFloatTimer` counts down a brief free-float, and
  // when it elapses the hexagon snaps onto the nearest free grid hex as a
  // static metal tile.
  metalCells?: Array<{ ix: number; iy: number; up: boolean }>;
  metalLatticeR?: number;
  metalFloatTimer?: number;

  // ── Density compaction state ────────────────────────────────────────────
  // Tracks how many density-merge steps a shard has accumulated.  0 (or
  // unset) = baseline visual; tier N renders proportionally darker via
  // the per-variant tint ramp.  Bumped by ShardSystem.composeEntities and
  // by the large-shard-collapse pass; capped at the variant's
  // density.maxSteps.  Tier-driven render cache invalidation: any site
  // mutating this MUST also clear `densityCachedTint` and (for nebula
  // variants) `nebulaCachedTinted`/`nebulaTintedKey`.
  densityTier?: number;
  // Per-entity render cache for the resolved density-tinted hex.  Built
  // lazily by RenderSystem on first draw at the current tier; invalidated
  // by ShardSystem at every site that mutates densityTier.  Skips the
  // per-frame RGB multiply when the tier hasn't changed.
  densityCachedTint?: string;

  // Unified fade-out timer for the whole shard family — nebula
  // tiles / shards AND rock / glass / plastic / metal shards all
  // ride this field.  Duration differs by source (nebula uses
  // NEBULA_CONSTANTS.FADE_DURATION, others
  // CLEANUP_CONSTANTS.MERGE_FADE_DURATION), but the lifecycle is
  // identical: PhysicsSystem ticks it down, RenderSystem scales
  // alpha by timer / duration, hitting 0 flips active = false.
  mergeFadeTimer?: number;
  mergeFadeDuration?: number;

  // Hot-spot-collapse grace period (seconds): set on freshly-shattered
  // rock/glass shards so the overlap-collapse pass leaves them alone long
  // enough to scatter, instead of instantly re-condensing a just-destroyed
  // tile.  Ticked down by PhysicsSystem; collapse ignores shards with this
  // still positive.
  collapseGraceTimer?: number;

  // Blended hex color of all absorbed power-up weapons; drives glow tinting
  // in the renderer.  Computed/blended in GameEngine when a power-up is
  // absorbed; undefined means no power-up content.
  powerupGlowColor?: string;

  // Per-substep accumulator of repel-field impulse magnitudes.  Reset
  // to 0 at the start of each PhysicsSystem.handleEntityCollisions
  // broadphase pass.  Written on BOTH sides of each repel pair: the
  // scanner (mobile body being pushed) accumulates incoming impulse
  // from every emitter in range, AND the emitter (static repel-tile)
  // accumulates the same value from every scanner pushing on its
  // field.  RenderSystem reads the emitter side to ramp glass-tile /
  // metal-tile glow off any nearby repellable body, not just the
  // player.
  repelImpulse?: number;

  // Lazily-baked original circumradius² for dent-policy tiles
  // (plastic-tile, metal-tile).  Computed in RenderSystem on first
  // material-tile render as max(polygonPoints[i].r²) × 0.98 (small
  // tolerance for FP jitter).  Used to detect whether a polygon
  // vertex has been pulled inward — vertices below this threshold
  // are "deformed", and their adjacent edges always draw regardless
  // of neighbour presence.
  originalCircumradiusSq?: number;


  // Composite asteroid — tracks every drop (including power-ups) stored
  // inside this asteroid; released as individual drops on destruction.
  dropComposition?: DropCompositionEntry[];

  // Lightning arc rendering — when true, arcPoints holds the chain vertices
  isLightningArc?: boolean;
  arcPoints?: Vector2[];

  // Cannon explosion ring — when true, RenderSystem draws an expanding
  // ring particle whose radius scales from 0 → explosionRadius over its
  // lifetime.  Stroke colour comes from `color`.  Spawned in
  // GameEngine.applyExplosionAoE alongside the existing spark particles.
  isExplosionRing?: boolean;
  // Snapshot of entity ids that were in range AND eligible at the moment
  // the ring spawned.  updateExplosionRings only damages entities whose
  // id is in this set — prevents the expanding wave from re-hitting
  // shards/drops that were spawned **as a result of** the wave's own
  // kills (e.g. glass-shards from a tile the wave shattered earlier in
  // its sweep).  Without this, every cannon hit cascaded into a pile of
  // ammo drops because each newborn shard rolled the asteroid drop
  // table when the wave killed it.
  validHitIds?: Set<string>;

  // Marks a projectile spawned by the lightning weapon (for electric rendering + chain-on-hit)
  isLightningProjectile?: boolean;

  // When true, handleEntityDeath skips drop spawning (e.g. explosion kills)
  suppressDrops?: boolean;

  // Marks a projectile as a bouncer (thin green laser that reflects off tiles)
  isBouncer?: boolean;
  // Remaining tile-bounces for a bouncer projectile (decremented on each
  // reflection in PhysicsSystem; the projectile is deactivated when it
  // would bounce past 0).  Absent on non-bouncer projectiles.
  bouncesRemaining?: number;
  // Cannon AoE-on-impact: copied from WeaponConfig at spawn.  PhysicsSystem
  // raises an onExplosion callback for any projectile with explosionRadius
  // > 0 after the direct-hit damage resolves.
  explosionRadius?: number;
  explosionDamage?: number;
  explosionKnockback?: number;
  // Charged-shot render hint — set on the projectile when the charged
  // variant should render with a custom visual (e.g. fireball gradient
  // for charged Blaster).  Other charged variants (Burst / Shotgun /
  // Homing / Cannon) leave this unset and render with the standard
  // weapon-color gradient.
  isCharged?: boolean;
  // Lightning chain overrides on the projectile (charged-shot only).
  chainCount?: number;
  chainRange?: number;
  chainBranches?: number;
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
  // ── Render fast-path cache (NEBULA tiles only) ──────────────────────────
  // Snapshot of the four inputs to the per-frame nebula draw call:
  //   * `nebulaCachedTinted`  — the pre-tinted offscreen sprite canvas
  //   * `nebulaCachedDx/Dy`   — centroid-corrected sprite-local offsets
  //   * `nebulaCachedSize`    — drawSize (proportional to tileArea)
  // Populated lazily by RenderSystem at the end of the slow path, then
  // read by the fast path in subsequent frames so a steady-state tile
  // collapses to `globalAlpha = 0.55; drawImage(...); globalAlpha = 1`.
  // Invalidated by NebulaSystem at every site that mutates the inputs:
  // composition (merge / regen), neighbour count (neighbour destroyed or
  // regenerated), or tile area (merge).  Mirrors the same per-entity
  // caching pattern `nebulaBlendedHex` already uses.
  nebulaCachedTinted?: HTMLCanvasElement;
  nebulaCachedDx?: number;
  nebulaCachedDy?: number;
  nebulaCachedSize?: number;
  // Per-entity linear and angular damping factors (applied per-frame at 60Hz).
  // Used by NEBULA_SHARD to fake cloud-like drag on both translation and spin.
  linearDamping?: number;
  angularDamping?: number;
  // Per-entity speed/spin floors below which PhysicsSystem snaps the
  // value to zero after damping.  When unset, fall back to
  // NEBULA_CONSTANTS.REST_SPEED / REST_SPIN (tiny — 0.005 / 0.01).
  // Higher values make the entity "static" — it stays at rest unless
  // something pushes it past the threshold.  Today plastic-shard sets
  // these so clusters effectively sleep unless directly disturbed.
  restSpeed?: number;
  restSpin?: number;
  // Collision-sleep state (mobile shard-family entities only).  A shard
  // that stays below SHARD_SLEEP_CONSTANTS speed/spin epsilon for
  // DELAY_SECONDS sets `asleep = true`; resolveShardPairs then skips the
  // SAT+impulse math for asleep↔asleep pairs (the dominant cost in a
  // settled pile).  Any motion above epsilon, or a resolved collision
  // with an awake body, wakes it — so disturbance ripples through a
  // contact island over successive substeps.  Sleeping shards stay
  // rendered, merge-eligible, and collidable against awake bodies; only
  // the asleep↔asleep bounce is elided.  `sleepTimer` is the rest dwell
  // accumulator (seconds).
  asleep?: boolean;
  sleepTimer?: number;
  // Transient local-crowd signal for the merge system: occupancy of this
  // shard's merge-grid cell, stamped each merge-broadphase pass and read
  // by tickBonds to focus absorption acceleration on dense pockets.
  mergeCellCount?: number;
  // Transient per-pass visibility flag for the collision viewport gate.
  // Recomputed each resolveShardPairs grid build (torus-aware): true when
  // the shard sits outside the CULL_MARGIN-padded camera rect.  A pair
  // where both ends are offscreen resolves only on the catch-up phase
  // (SHARD_PAIR_CONSTANTS.OFFSCREEN_RESOLVE_DIVISOR); on/near-screen
  // pairs always resolve.  Not gameplay state — never persisted, only
  // read within the same pass it's written.
  offscreen?: boolean;
  // Number of other plastic-shards currently in contact with this one,
  // computed by ShardSystem off the merge-broadphase grid.  Drives the
  // PAuto neighbour-brightness automata in RenderSystem (more contacts
  // = darker, like nebula interior-darkening).  Plastic-shards only.
  plasticNeighborCount?: number;
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
  // Birth fade-in timer on NEBULA tiles and shards.  While > 0 the
  // entity renders with alpha scaled by 1 − (timer / nebulaSpawnDuration),
  // so newly-created entities fade into existence slowly instead of
  // appearing instantly.  Ticked in PhysicsSystem.update.
  nebulaSpawnTimer?: number;
  // Effective duration for this particular fade-in (see mergeFadeDuration).
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

  // ── Physics SAT caches ─────────────────────────────────────────────────
  // Populated lazily on first collision involving the entity.  For static
  // entities (mass === Infinity) these never invalidate — rotation and
  // polygonPoints are frozen at spawn — so cache hits are 100 % after the
  // first collision pair.  Dynamic entities bypass the cache entirely.
  // _satCacheCos / _satCacheSin replace per-pair Math.cos / Math.sin in
  // fillVertices; _satCacheAxes replaces the per-pair sqrt + inverse-multiply
  // axis normalisation in fillAxes.
  _satCacheCos?: number;
  _satCacheSin?: number;
  _satCacheAxes?: Vector2[];
  // Cached `Math.max(size.x, size.y) / 2` — the bounding-circle radius used
  // by the broadphase pre-check, render layout, and many distance scans
  // across PhysicsSystem / ShardSystem / NebulaSystem / RenderSystem.
  // Lazily computed on first read; invalidated (set undefined) at the few
  // sites that mutate `size` so stale values are impossible.
  _collisionR?: number;

  // True while this static tile is currently rendered to the pre-baked
  // static-tile world canvas managed by RenderSystem.  When true, the
  // per-entity render path skips drawing this entity (the cache has its
  // appearance); when false, the per-entity render runs normally.  Toggled
  // on each frame by RenderSystem.renderEntities when the tile's "fast-
  // path criteria" (no glow active, no hit flash, no regen) changes —
  // entering a slow-path condition erases the tile from the cache, leaving
  // it restores the cache stamp.  Only set on cache-eligible variants
  // (glass-tile, indestructible-tile today).
  _staticCached?: boolean;

  // Original-stamp polygon kept by RenderSystem so the cache erase always
  // covers the full footprint of EVERYTHING this tile ever stamped, not
  // just the current (possibly dent-shrunken) polygonPoints.  Captured
  // once on first cache stamp; without it, a rock-tile that takes a few
  // dent hits and then dies would leave the original outer rim of fill
  // visible in the cache because the death-time erase used the shrunken
  // current polygon and missed it.  Each entry is a fresh {x,y} so future
  // dent-mutations to polygonPoints can't reach back and shrink the
  // stored erase footprint.
  _staticStampPoly?: Vector2[];

  // Per-shard alpha multiplier baked in at spawn — drives the nebula
  // render path's globalAlpha so a caller (e.g. rock-tile shatter) can
  // ask for a softer cloud puff that reads as lighter dust without
  // changing the variant-wide default alpha for every nebula entity.
  // Multiplied into the existing isTile/isShard alpha base in
  // renderEntities; absent values default to 1.0 (no change).
  nebulaAlphaMul?: number;

  // Accumulated damage cracks for rock-tile.  Each crack is an entity-
  // local line segment (rotation is baked in at generation, position is
  // the tile centre).  Appended once per dent hit by PhysicsSystem
  // .applyDentStep and drawn by RenderSystem.stampRockTileToCache on
  // top of the polygon fill so accumulating hits read as visible damage
  // even though rock-tile suppresses hit-flash and renders no edge
  // outline.  Persists for the tile's lifetime — rock-tile has no
  // regen, so cracks don't need to clear on resurrection.
  damageCracks?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
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
  // Wall time of ShardSystem.update — merge broadphase + bonds +
  // density compaction.  Lives in updateGameLogic, NOT physicsMs.
  shardSysMs: number;
  // Wall time of the whole updatePhysics call (includes physicsMs +
  // entity compaction + flow-field nudge + asteroid census).  Gap
  // vs. summed sub-timers reveals untimed work.
  updatePhysicsMs: number;
  // Wall time of the whole updateGameLogic call (includes shardSysMs
  // + drops + weapons + projectile lifetime + wave check + ...).
  updateLogicMs: number;
  // Residual: updPhys minus the explicit physics / ai / flow sub-
  // timers.  Captures the GameEngine-level glue inside updatePhysics
  // (entity compaction, asteroid census, flow-field nudge over
  // asteroids+drops).
  physMiscMs: number;
  // Residual: updLogic minus the explicit logic sub-timers.  Captures
  // the input/HUD/wave-check/projectile-trail/damage-text glue.
  logicMiscMs: number;
  dropsMs: number;
  explosionRingsMs: number;
  weaponsMs: number;
  renderMs: number;
  // Sub-timer for the nebula tile/shard render pass.  Surfaced in the
  // debug overlay alongside renderMs so the contribution of the nebula
  // pass can be A/B'd against the twinkle / background-puff ablation
  // toggles.
  nebulaMs: number;
  // Visible-nebula-entity count post frustum cull (latest frame, not
  // averaged).  Lets the user weigh nebulaMs against how many tiles the
  // pass is actually iterating — at default zoom 0.65 the visible
  // window is ~18 % of a 6 k map, so a 1 200-tile NebulaFieldMap
  // surfaces ~210 tiles per frame.
  nebulaVisible: number;
  // Wall time (ms) accumulated across this frame's renderProximityBloom
  // calls for STATIC tiles (mass = Infinity, with a `glow` config).
  // Excludes mobile-shard bloom calls (today there are none — shard
  // glow configs are off).  Lets the dev overlay A/B tile lighting on
  // its own.
  tileLightingMs: number;
  // Number of tiles that actually drew a bloom this frame (helper got
  // past the range / no-glow early-returns).  Latest frame, not
  // averaged — context for interpreting tileLightingMs.
  tileLightingCount: number;
  // Per-frame split of nebula entities that took the fast path (cached
  // sprite, single drawImage) vs. the slow path (full ctx.save +
  // tint compute + …).  Sum equals nebulaVisible.  Surfaces in the
  // debug overlay so we can tell at a glance whether the fast path
  // is matching for steady-state tiles.
  nebulaFast: number;
  nebulaSlow: number;
  flowFieldMs: number;    // FlowFieldGrid.flushEnemyField
  // Collision broadphase — peak dynamic-grid cell density observed last step
  maxCellDensity: number;
  // Entity counts (snapshot of most recent sim step)
  totalEntities: number;
  enemyCount: number;
  asteroidCount: number;    // Includes mobile shards (shardVariant ∈ {rock-shard, glass-shard})
  projectileCount: number;
  particleCount: number;
  interactableCount: number; // Drops, portals, POIs
  // ── PerfController readouts (central frame-skip coordinator) ──
  // Smoothed load level [0,1] and its quantised tier name (idle … max).
  perfLoadLevel: number;
  perfLoadTier: string;
  // Dynamic (mobile) entity count driving the throttle — the broadphase
  // cost driver, distinct from totalEntities (which counts inert tiles).
  perfDynamicCount: number;
  // Mobile shards currently flagged asleep (skipped from asleep↔asleep
  // pair resolution).  High in a settled field → the sleep win is live.
  perfAsleepCount: number;
  // Mobile shards currently offscreen (both-offscreen pairs resolve at
  // reduced cadence).  Set by the last resolveShardPairs grid build.
  perfOffscreenShards: number;
  // Shards drawn via the LOD disc this frame (too small for full detail).
  perfLodShards: number;
  // Entity-count-driven merge/eat RATE multiplier (sparse fields < 1,
  // crowded > 1).  Separate from throttling — crowded fields merge/eat
  // faster to cull entities, sparse fields merge lazily.
  perfMergeRateMult: number;
  // Per-task effective frame-skip intervals (+ manual pin, 0 = AUTO).
  perfTasks: PerfTaskStat[];
}

// One row of the PerfController per-task readout in the DBG panel.
export interface PerfTaskStat {
  id: string;
  eff: number;     // effective frame-skip interval this step
  manual: number;  // manual override (0 = AUTO)
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
  trailShape?: TrailShape;
  trailEmitMode?: TrailEmitMode;
  // ── Performance toggle state (debug menu) ─────────────────────
  // Mirrors GameEngine's perf-toggle fields so the DBG panel can
  // render the live state.  All default true (production) and flip
  // off for isolated cost measurement in the perf overlay.
  localGravityEnabled?: boolean;
  attractorGravityEnabled?: boolean;
  collisionsEnabled?: boolean;
  // Mobile-shard ↔ static-tile collision pass.  Default false (no
  // pairing — shards drift through tile geometry; only the repel
  // field pushes them).  Toggled via the DBG panel.
  shardTileCollisionsEnabled?: boolean;
  // Shard-shard pair resolution interval.  The manual setting (0 =
  // AUTO; ≥1 = manual override).  Cycled via the DBG panel's
  // "ShPair" button.
  shardPairInterval?: number;
  // Effective interval used by the most recent physics step.  Mirrors
  // shardPairInterval when the manual value is ≥1; in AUTO mode this
  // tracks the density-scaled value selected by PhysicsSystem.
  shardPairEffectiveInterval?: number;
  // Shard ↔ static-tile pair resolution interval — mirrors the
  // shard-pair pair above for the dedicated tile scan.  Only
  // meaningful when shardTileCollisionsEnabled is true.  Cycled via
  // the DBG "Sh↔Tl int" button.
  shardTilePairInterval?: number;
  shardTilePairEffectiveInterval?: number;
  // Shard ↔ shard gravity pull (attractedTo pass).  DBG-toggleable.
  shardGravityEnabled?: boolean;
  // Shard ↔ shard bond formation + cohesion.  DBG-toggleable.
  shardBondingEnabled?: boolean;
  // Hard collisions between nebula-shard pairs (ignores their
  // passThrough flag).  DBG-toggleable; default OFF.
  nebulaShardCollisionsEnabled?: boolean;
  // Collision-sleep for mobile shards — skips asleep↔asleep pair math
  // in resolveShardPairs.  DBG-toggleable; default ON.
  shardSleepEnabled?: boolean;
  // Viewport-gated shard-pair cadence — both-offscreen pairs resolve
  // only on the catch-up phase.  DBG-toggleable; default ON.
  shardViewportCullEnabled?: boolean;
  // Shard render LOD — tiny mobile shards blit a cached disc instead of
  // their full polygon render.  DBG-toggleable; default ON.
  shardLodEnabled?: boolean;
  // Entity-count-driven merge/eat rate multiplier.  DBG-toggleable; when
  // off the multiplier holds at a neutral 1.0×.  Default ON.
  mergeRateEnabled?: boolean;
  // Camera screen-shake on impacts.  Default true.  DBG-toggleable.
  screenShakeEnabled?: boolean;
  // DBG outline overlay for outlineless variants (nebula-tile /
  // nebula-shard cloud sprite).  Default false; DBG-toggleable via
  // the Visual section's Outline button.
  tileOutlinesEnabled?: boolean;
  // When true, plastic-shards render in the active palette's constant
  // base shade, brightness-scaled by their plastic-shard contact
  // count (PAuto automata).  Default true.
  plasticAutomataEnabled?: boolean;
  // PAuto direction: true = brighten dense interiors, false = darken
  // them (default).  Toggled via the PADIR button.
  plasticAutomataBrighten?: boolean;
  // Active plastic palette name (PLASTIC_PALETTES[i].name).  Cycled
  // via the DBG panel's Palette button — switches the colour family
  // used by randomPlasticShade() and re-rolls every active plastic
  // entity's colour on toggle.
  plasticPaletteName?: string;
  // Active plastic-SHARD palette name (independent index into the same
  // PLASTIC_PALETTES list).  Cycled via the DBG Shard pal button —
  // re-rolls every active plastic-shard's colour on toggle.
  plasticShardPaletteName?: string;
  // Brightness multiplier for the plastic-tile / metal-tile proximity
  // glow (MATERIAL_GLOW_BRIGHTNESS_CYCLE, "1x" … "5x").  Independent
  // cycles per material; multiplies the variant peakAlpha and the
  // canvas clamps to 1.0 so the visible-glow range widens.
  plasticGlowBrightnessName?: string;
  metalGlowBrightnessName?: string;
  glassGlowColorName?: string;
  nebulaPaletteName?: string;
  // DBG gate for the plastic colour-equilibration block in
  // NebulaSystem.equilibrateColors.  Independent of the nebula
  // tile/shard blend alphas.  Default true.
  plasticBlendEnabled?: boolean;
  // DBG stiffness step for the nebula-shard velocity stretch
  // (VEL_STRETCH_K_CYCLE name).  off → soft → med → firm → stiff.
  nebulaStretchName?: string;
  // DBG hot-spot-collapse grace delay for freshly-shattered shards
  // (SHATTER_GRACE_CYCLE, "0.6s" … "3.6s").
  shatterGraceName?: string;
  // DBG player-thrust / player-speed multiplier step names
  // (PLAYER_THRUST_CYCLE / PLAYER_SPEED_CYCLE, e.g. "1×").
  playerThrustName?: string;
  playerSpeedName?: string;
  // ── Asteroid/shard flow-field DBG state ───────────────────────
  // Enables the per-asteroid / per-ammo-drop velocity nudge toward
  // the baked asteroid-flow vector.  Default true (production);
  // DBG-toggleable to OFF for A/B-testing zero-flow behaviour
  // (asteroids decay toward zero velocity over a few seconds; only
  // collisions / gravity move them after that).
  asteroidFlowEnabled?: boolean;
  // Overlay toggles — all DBG-only renderer gating.  Default false.
  // FF Vectors: per-cell arrows colored by magnitude.
  // FF Cells:   faint cell-grid outlines.
  // FF Obs:     tint over cells flagged as obstacles.
  // FF Rebuilds: flash cells briefly when re-baked by onTileDestroyed.
  ffOverlayVectors?: boolean;
  ffOverlayCells?: boolean;
  ffOverlayObstacles?: boolean;
  ffOverlayRebuilds?: boolean;
  // Sampling stride for the vector overlay — 1, 2, 4, 8, or 16.
  // Cycled via the DBG "FF SampleN" button.  The cells/obstacles/
  // rebuilds overlays always render every cell.
  ffOverlaySampleN?: number;
  // Active flow-field cell size in world units.  Cycled by the DBG
  // "FF Density" button through the FF_DENSITY_CYCLE values.  Default
  // 256 (production); finer values rebuild both the asteroid and
  // pursuit fields at higher resolution.
  ffCellSize?: number;
  // Asteroid-field wall-repulsion kernel radius (cells).  Cycled by
  // the DBG "FF KernelR" button.  0 = legacy 4-cardinal-only scan;
  // 1..5 = (2R+1)² extended kernel with 1/d² falloff.  Default 3.
  ffKernelR?: number;
  // Tangent-mix factor in [0, 1] for the wall-repulsion contribution.
  // 0 = pure radial (current behaviour, opposing vectors at long
  // walls); 1 = pure tangent (slide along walls — eliminates the
  // saddle dead-zone failure mode).  Default 0.5.  DBG-cycle.
  ffTangentMix?: number;
  // Breathing-field scroll rate (rad/s).  0 = off (static field);
  // > 0 = the asteroid field undulates over time so convergence zones
  // drift and shard piles dissolve.  DBG-cycle "FF Breathe".
  ffBreatheRate?: number;
  // Per-shard flow lane-jitter strength.  0 = off; > 0 = shards ride
  // parallel offset lanes instead of one streamline.  DBG-cycle
  // "FF Lane".
  ffLaneJitter?: number;
  // Short label of the active base-flow pattern (DBG "FF Pattern":
  // Map / Meander / Circular / Spiral / Well / WavyWell / Outward /
  // Horiz / Vert / WavyH / WavyV).
  ffPatternName?: string;
  // Nebula color-equilibration alphas (per-frame circular-hue lerp).
  // Tiles drift toward neighbour average; shards drift toward
  // nearest tile.  Cycled via DBG TileBlend / ShardBlend buttons.
  tileBlendAlpha?: number;
  shardBlendAlpha?: number;
  // Cadence (physics substeps) between color-equilibration passes.
  // 0 = AUTO (active-count thresholds); ≥1 = manual override.
  // Cycled via DBG ColorBlend int button.
  colorBlendFrameInterval?: number;
  // Effective interval used by the most recent pass.  Mirrors
  // colorBlendFrameInterval in manual mode; tracks the density-
  // selected value in AUTO mode.
  colorBlendEffectiveInterval?: number;
  // Master AUTO toggle for the central PerfController.  When false all
  // automatic frame-skipping is disabled (manual pins still apply).
  perfAutoEnabled?: boolean;
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
