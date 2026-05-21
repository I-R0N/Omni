

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
  // Plastic-shard "jiggle" state — set by collision impulses that
  // exceed restSpeed, ticked down each substep, consumed by
  // RenderSystem's plastic-shard branch to apply a damped-sinusoid
  // scale pulse (visual-only, doesn't touch collision footprint).
  // wigglePhase is set once at spawn from a hash of entity.color so
  // each amber shade has its own oscillation phase — neighbouring
  // shards in a cluster wiggle out of sync.  wiggleAngle is the
  // world-space impact direction (radians) stamped at trigger time
  // so the squash aligns to the impact axis — stretch along, squash
  // perpendicular — reads as polymer absorbing the hit rather than
  // a bubble pulsing radially.
  wiggleTimer?: number;
  wigglePhase?: number;
  wiggleAngle?: number;
  // Plastic-shard impact-stamp cooldown.  After a collision stamps
  // the wiggle/dent deformation, this counts down; further stamps
  // are suppressed until it reaches 0.  Without it, a shard packed
  // among neighbours re-stamps its deformation axis on every
  // substep, making the (radially-symmetric) disc's squash axis
  // flip rapidly — reads as the shard twitching back and forth.
  wiggleCooldown?: number;
  // Plastic-shard impact-dent accumulator (option A).  2D vector
  // representing the sum of recent impact directions (normalised,
  // weighted by PLASTIC_DEFORM_CONSTANTS.DENT_INCREMENT_PER_IMPACT).
  // Decays exponentially per substep in PhysicsSystem.update;
  // renderer applies a squash along the dent direction + small
  // bulge perpendicular.  Persists past the wiggle's 0.4 s window
  // (~4 s recovery from max), reads as polymer "remembering" hits.
  dentX?: number;
  dentY?: number;
  // Plastic-shard sticky-bond anchor (option E).  Per-shard rest
  // position toward which a soft spring pulls each substep —
  // simulates the cluster being tethered to its placement.  Set
  // at every plastic-shard spawn site (hex placement, dent burst,
  // shatter recursion).  Reset to the new centroid on merge so a
  // merged shard "claims" its new resting place.  Spring strength
  // PLASTIC_DEFORM_CONSTANTS.ANCHOR_SPRING_K; toroidal-corrected
  // delta via wrapDeltaX/Y in PhysicsSystem.update.  External
  // force can overcome the spring (shard drifts further), but
  // once the force stops the spring pulls back to the anchor.
  anchorX?: number;
  anchorY?: number;
  // Plastic-shard spawn-time shape variance (option B).  Per-axis
  // random scale rolled at spawn in [1 − V, 1 + V] where V =
  // PLASTIC_DEFORM_CONSTANTS.SPAWN_SHAPE_VARIANCE.  Renderer
  // multiplies through in entity-local space so each shard has
  // its own slightly irregular outline regardless of impact state.
  baseScaleX?: number;
  baseScaleY?: number;
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
  // Camera screen-shake on impacts.  Default true.  DBG-toggleable.
  screenShakeEnabled?: boolean;
  // DBG outline overlay for outlineless variants (plastic-tile /
  // plastic-shard soft gradient + nebula-tile / nebula-shard
  // cloud sprite).  Default false; DBG-toggleable via the Visual
  // section's Outline button.
  tileOutlinesEnabled?: boolean;
  // When true, plastic-shards render in the active palette's constant
  // base shade, brightness-scaled by their plastic-shard contact
  // count (PAuto automata).  Default true.
  plasticAutomataEnabled?: boolean;
  // PAuto direction: true = brighten dense interiors, false = darken
  // them (default).  Toggled via the PADIR button.
  plasticAutomataBrighten?: boolean;
  // Active plastic palette name (PLASTIC_PALETTES[i].name).  Cycled
  // via the DBG panel's Plastic button — switches the colour family
  // used by randomPlasticShade() and re-rolls every active plastic
  // entity's colour on toggle.
  plasticPaletteName?: string;
  // Active globalCompositeOperation used by the plastic-shard render
  // branch.  Cycled via the DBG Blend button (source-over / multiply
  // / darken / screen / lighter).  Live — next-frame effect.
  plasticBlendMode?: string;
  // DBG gate for the plastic colour-equilibration block in
  // NebulaSystem.equilibrateColors.  Independent of the nebula
  // tile/shard blend alphas.  Default true.
  plasticBlendEnabled?: boolean;
  // DBG stiffness step for the nebula-shard velocity stretch
  // (VEL_STRETCH_K_CYCLE name).  off → soft → med → firm → stiff.
  nebulaStretchName?: string;
  // Active opacity (formatted as "NN%") applied to plastic-tile and
  // plastic-shard draws.  Cycled via the DBG Opacity button
  // (25 % → 50 % → 75 % → 100 %).
  plasticOpacity?: string;
  // DBG elastoplastic yield-distance step name for plastic-shards
  // (PLASTIC_YIELD_CYCLE).  putty → soft → med → firm → elastic.
  // Smaller yield = more plastic (less spring-back); 'elastic' (∞)
  // is the original full-return spring.
  plasticYieldName?: string;
  // DBG sticky-bond spring stiffness step name for plastic-shards
  // (PLASTIC_STIFFNESS_CYCLE, 0.01 … 4).  Lower k = gentler
  // recovery and more over-yield flow.
  plasticStiffnessName?: string;
  // DBG linear-damping step name for plastic-shards
  // (PLASTIC_DAMPING_CYCLE, 0.95 … 1.0).  Lower = heavier friction.
  plasticDampingName?: string;
  // DBG impact-stamp cooldown step name for plastic-shards
  // (PLASTIC_IMPACT_COOLDOWN_CYCLE, 0.2 … 1.5 / off).  Longer =
  // calmer deformation; 'off' disables collision-driven deformation.
  plasticImpactCooldownName?: string;
  // DBG soft-disc blend knobs for plastic-shards.  Core = opaque-core
  // radius fraction (PLASTIC_CORE_RADIUS_CYCLE); Blend = disc draw
  // radius as a multiple of collision radius (PLASTIC_BLEND_RADIUS_
  // CYCLE).  Smaller core / larger blend = deeper inter-shard blend.
  plasticCoreRadiusName?: string;
  plasticBlendRadiusName?: string;
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
