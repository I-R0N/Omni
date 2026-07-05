

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
  // Core-roster additions (Stage 0) — no new AI role:
  //  - KAMIKAZE: a RAMMING suicide bomber that self-destructs on contact (AoE).
  //  - BULWARK:  a SHOOTING fan-gunner behind a regenerating shield.
  KAMIKAZE = 'KAMIKAZE',
  BULWARK  = 'BULWARK',
  // Stage 1 — TURRET: a stationary SHOOTING emplacement (maxSpeed 0, no-move
  // AI branch) that rotates to aim and lobs slow homing missiles.
  TURRET   = 'TURRET',
  // Stage 4 — SWARM: a cheap, weak, fast flocker (boids 'swarm' behavior).
  //           NEST:  a near-static spawner that periodically births SWARM brood.
  SWARM    = 'SWARM',
  NEST     = 'NEST',
  // Stage 5 — BUBBLE: a passive soft-body blob that wanders, eats shards, grows
  //           and splits — until SHOT, after which it homes in and latches onto
  //           the player, EMPing weapon + shield ('bubble' behavior).
  BUBBLE   = 'BUBBLE',
  // Stage 6 — DRAGON: a big segmented serpent mini-boss that enters via a
  //           portal, rides the flow field devouring tiles to grow, and leaves
  //           via portal.  Engine-managed (GameEngine.updateDragon); the AI
  //           'dragon' strategy is a no-op.
  DRAGON   = 'DRAGON',
}

// Distinct procedural polygon shapes for native enemy rendering — chosen so
// each enemy archetype reads as a different silhouette without sprite art.
export type EnemyShape =
  | 'triangle' | 'arrow' | 'hexagon' | 'octagon' | 'diamond' | 'pentagon' | 'chevron' | 'star' | 'cross' | 'circle' | 'nest' | 'bubble' | 'dragon';

// Drop item kinds.  Per-type properties (collectible vs environmental debris,
// …) live in the DROP_TYPES registry in constants.ts — the single source of
// truth so a new drop type is one table entry, not a hunt across systems.
export type DropType = 'ammo' | 'health' | 'glass';

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

// ── Status effects ────────────────────────────────────────────────────────────
// Generic player debuff framework.  Today: 'corrosion' (a stacking
// damage-over-time) and 'disable' (weapon + shield offline for a duration —
// an EMP, used by the reactive bubble).  The kind union + EffectPayload are
// shaped so new effects (scramble / slow) drop in without restructuring.
export type StatusEffectKind = 'corrosion' | 'disable';

// Carried on an attack (WeaponConfig / projectile); applied to the player on hit.
export interface EffectPayload {
  kind: StatusEffectKind;
  duration: number;   // seconds (refreshed on re-hit)
  dmgPerSec: number;  // per stack (corrosion)
  maxStacks: number;
}

// Consume-and-grow config (Stage 3b).  A consumer absorbs nearby consumable
// entities and grows.  `eats` selects the candidate family:
//   'shard' — mobile shard-family STRUCTURE entities (finite mass) — the bubble
//   'tile'  — static tiles (mass Infinity), routed through the tile-destroy
//             patch — the dragon
export interface ConsumeConfig {
  eats: 'shard' | 'tile';
  range: number;          // SENSE radius (world units, toroidal): within it a
                          // mobile candidate is pulled (see `pull`); the actual
                          // eat only fires on MEMBRANE CONTACT (radii overlap).
  growthPerEat: number;   // size (diameter) added per consumed entity
  maxSize: number;        // growth cap on size.x / size.y
  hpPerEat?: number;      // optional max-health gained per eat
  massPerEat?: number;    // optional mass gained per eat (Infinity-safe: skip)
  pull?: number;          // optional inward tug (accel) on mobile candidates in
                          // sense range — the suck-in before the swallow.  Tiles
                          // (static) are never pulled.
}

// Live instance on the player (GameEntity.statusEffects).
export interface StatusEffect {
  kind: StatusEffectKind;
  remaining: number;
  maxDuration: number; // for the HUD countdown fraction
  stacks: number;
  dmgPerStack: number;
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
  // Render hint: when true the projectile draws a larger, brighter radial
  // bloom (used to telegraph heavy / status enemy shots — Tank, Orbiter,
  // Sniper).  Purely cosmetic; copied onto the spawned projectile entity.
  glow?: boolean;
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
  // Status effect this shot applies to the player on hit (e.g. corrosion).
  // ProjectileSystem.spawn copies it onto the projectile.
  appliesEffect?: EffectPayload;
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
  // Visual hit-reaction magnitude (0..1): the last hit's damage as a fraction
  // of maxHealth, latched at damage time.  RenderSystem scales the sprite's
  // scale-punch by it, so a chip on a big-HP beast (dragon / bubble) barely
  // flinches while a heavy hit on a frail gnat snaps hard.  Unset → full punch
  // (1), preserving the original feel for any un-wired damage path.
  hitReact?: number;
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
  // Upgrade-derived stat modifiers (player only; set by GameEngine
  // .applyUpgrades from the run's upgrade levels).  Read at the existing
  // stat-hook sites with a sensible fallback so a fresh entity is unchanged:
  //  - maxAmmo: ammo-pool cap (DropSystem clamp; default AMMO MAX_POOL)
  //  - damageMult / cooldownMult: weapon scaling (WeaponSystem; default 1)
  //  - shieldRechargeRate: shield regen/sec (PhysicsSystem; default SHIELD rate)
  maxAmmo?: number;
  damageMult?: number;
  cooldownMult?: number;
  shieldRechargeRate?: number;
  // Unlock gating (player only; set by GameEngine.syncUnlocksToPlayer):
  //  - ownedWeapons: which weapons cycle/select may pick (always ≥ Blaster)
  //  - overchargeUnlocked: whether charged shots are allowed
  ownedWeapons?: WeaponType[];
  overchargeUnlocked?: boolean;
  // Explosion-knockback overshoot allowance (player).  An AoE blast can drive
  // the player above the normal maxSpeed cap; this holds the temporarily-raised
  // cap, which decays back to maxSpeed each step (updatePlayerMovement) so the
  // launch bleeds off instead of being snapped away by the hard cap.
  overSpeedAllow?: number;
  // Status effects: `appliesEffect` is set on a projectile that should debuff
  // the player on hit; `statusEffects` is the player's live debuff list.
  appliesEffect?: EffectPayload;
  statusEffects?: StatusEffect[];
  // Counterplay trait: armored enemies shrug off per-hit damage below
  // `chipThreshold`, scaled by `(1 - reduction)` — demands big-hit weapons.
  armor?: { chipThreshold: number; reduction: number };
  // Hit-feedback stagger: while > 0 the AI applies no movement force, so a
  // projectile knockback reads as a brief reel.  Set on hit, ticked by AISystem.
  hitStun?: number;
  // Kamikaze self-destruct (Stage 0).  A bomber stamps explosionRadius/
  // explosionDamage/explosionKnockback at spawn; the moment it touches the
  // player (PhysicsSystem contact path) it deals `contactDamage`, sets
  // `detonateOnDeath`, and routes its death immediately — handleEntityDeath
  // fires the AoE shockwave at the contact point (instant, no bounce-away).
  // Bombers killed before they touch the player never set the flag, so they
  // pop harmlessly — the kill-early counter.
  detonateOnDeath?: boolean;
  // Directional arc shield (Stage 0 Bulwark).  When `shieldArcHalfWidth` is
  // set the shield only absorbs hits arriving within ±halfWidth of
  // `shieldArcAngle` (a sector, not a full bubble).  AISystem slews
  // `shieldArcAngle` toward the player bearing at up to `shieldArcSpin` rad/s
  // (the max turn rate), so the shield tries to face the threat but a fast
  // flank gets behind it.  Absent → a full bubble (player).
  shieldArcAngle?: number;
  shieldArcHalfWidth?: number;
  shieldArcSpin?: number;
  // Native polygon silhouette for enemy rendering (set at spawn from the
  // archetype) — RenderSystem draws this instead of a sprite.
  enemyShape?: EnemyShape;
  // Damage dealt to the player on contact (rushers > 0; ranged enemies 0).
  // Scaled by the per-wave damageMult in the collision path.
  contactDamage?: number;
  // Die-on-contact (Stage 4 Swarm): the enemy pops on its first touch of the
  // player — deals `contactDamage` once (ignoring the impact-speed threshold)
  // then dies.  A discrete hit + pop instead of a clinging friction-chip.
  diesOnContact?: boolean;
  // Cosmetic render cache: a stable per-entity phase (radians) for the
  // pulsing enemy "core eye", lazily derived from the id on first draw so a
  // pack doesn't throb in unison.  Render-only; never read by the sim.
  glowPhase?: number;
  // Cosmetic render cache: the enemy body radial-gradient object, reused
  // across frames to avoid re-allocating it every draw.  Rebuilt only when
  // the cached radius/colour key changes (e.g. during a hit-flash scale
  // punch).  Render-only; never read by the sim.
  enemyBodyGrad?: CanvasGradient;
  enemyBodyGradR?: number;
  enemyBodyGradCol?: string;
  // PhysicsSystem shard-pair hot-path caches (transient, sim-internal — never
  // read outside the broadphase).  `_pairSeq` is a pass-local dedup index set
  // during the shard-grid build (numeric, cheaper than the old id-string
  // compare).  `_invMassCache` / `_effInvMassCache` memoise 1/mass and
  // pow(1/mass, MASS_BIAS_EXPONENT) — recomputed only when `mass` differs from
  // `_massCacheKey`, so a dense awake-shard pile skips 2 divisions + 2 Math.pow
  // per resolved pair.
  _pairSeq?: number;
  _invMassCache?: number;
  _effInvMassCache?: number;
  _massCacheKey?: number;
  // Cosmetic render cache for the geometric Dragon head (Stage 6): the big
  // faceted-skull body gradient + the plasma-maw unit gradient, both reused
  // across frames.  Rebuilt only when the size/colour/flash key changes; the
  // per-frame energy pulse is applied via globalAlpha (the maw / bloom fade to
  // a=0 at the rim, so a scalar alpha is exactly equivalent to baking the pulse
  // into the stops).  Render-only; never read by the sim.
  dragonSkullGrad?: CanvasGradient;
  dragonMawGrad?: CanvasGradient;
  dragonGradR?: number;
  dragonGradCol?: string;
  dragonGradFlash?: boolean;
  dragonGradProvoked?: boolean;
  // Cosmetic render cache for the Bubble membrane (Stage 5) fill gradient,
  // keyed on the membrane radius + colour + visibility (all change only on a
  // state transition, not per frame).  Render-only.
  bubbleFillGrad?: CanvasGradient;
  bubbleFillGradR?: number;
  bubbleFillGradCol?: string;
  bubbleFillGradVis?: number;
  // Attack-telegraph charge, 0→1, set by WeaponSystem over the archetype's
  // `telegraph` window as a shot winds up (and cleared when not charging /
  // out of range).  RenderSystem draws a muzzle charge glow scaled by it on
  // every telegraphing archetype (Tank/Sniper/Charger).
  aimCharge?: number;
  // Sniper-only lock-on: when stamped (from the archetype's `aimLaser`), the
  // enemy holds still while aimCharge > 0 (AISystem) and RenderSystem draws a
  // full-length laser sight snapped onto the player at `aimDist` (the locked
  // distance, refreshed by WeaponSystem each charging frame).
  aimLaser?: boolean;
  aimDist?: number;

  // Player resources (gold kept for drop-system compat until PR 2)
  gold?: number;

  // Drop item fields
  dropType?: DropType;
  dropValue?: number;
  // Magnet latch: set once a drop first enters the player's pull range.
  // Thereafter it homes to completion regardless of distance.
  magnetized?: boolean;

  // Enemy tier (1 | 2 | 3) — used for drop scaling
  enemyTier?: number;
  // ── Stage 3 reusable mechanics (infrastructure; wired by Stage 4/5/6) ────
  // Provoked-on-hit (3a): set true the first time the entity takes damage
  // (PhysicsSystem projectile path + AoE).  A passive-until-provoked enemy
  // (the bubble) wanders until this flips, then engages.  Harmless on every
  // other enemy (unread).
  provoked?: boolean;
  // Third-party / neutral (Stage 5, bubble): a `thirdParty` entity can be
  // damaged by projectiles of ANY owner (the friendly-fire filter is bypassed,
  // so enemy fire hits it too) and RETALIATES against whoever last hit it.
  // `aggroTargetId` is that current target — the id of the most recent attacker
  // (the player as 'player', or an enemy by id).  The bubble seeks + latches
  // this target instead of always the player, switching as new attackers hit
  // it.  Cleared when the target dies (→ back to passive).
  thirdParty?: boolean;
  aggroTargetId?: string;
  // Firing entity id stamped on a projectile (ProjectileSystem.spawn) so a
  // third-party victim can blame the exact shooter.  'player' for player shots,
  // the enemy's id for enemy shots.
  ownerId?: string;
  // Rival ship (Stage 7): a player-like EntityType.ENEMY roamer that fights the
  // WAVE enemies (denying the player their points + drops) and—per disposition—
  // may also fight the player.  Engine-managed (GameEngine.updateRivals), so
  // AISystem skips it.  Renders from `sprite` (an old enemy PNG) with a
  // disposition-coloured ring.
  isRival?: boolean;
  // Projectile flags for rival fire: `hitsEnemies` lets an ENEMY-owned shot
  // damage other ENEMY targets (so a rival can shoot the wave enemies), and
  // `sparesPlayer` makes an ENEMY-owned shot pass THROUGH the player (so an
  // ally/neutral rival's stray fire can't hurt the player).  Both unset on
  // normal enemy fire — original behaviour preserved.
  hitsEnemies?: boolean;
  sparesPlayer?: boolean;
  // Stamped on an enemy killed by a rival's projectile so handleEntityDeath
  // withholds the kill points + combo from the player (the rival "steals" them).
  killedByRival?: boolean;
  // Attach + disable (3c): when set, GameEngine.updateAttachments snaps this
  // entity's position onto the target every frame (a latch/grapple).  Cleared
  // when the target dies.  `attachOffset` is an optional fixed world offset.
  attachedToId?: string;
  attachOffset?: Vector2;
  // Derived each tick from an active 'disable' status effect
  // (GameEngine.tickStatusEffects): while true the entity's weapon can't fire
  // and its shield neither absorbs nor recharges.  Read in hot paths so they
  // don't rescan statusEffects.
  systemsDisabled?: boolean;
  // Consume-and-grow (3b): a consumer eats nearby consumable shards/tiles and
  // grows.  Config drives GameEngine.updateConsumers (a PerfController-gated
  // neighbour pass).  Absent → not a consumer.
  consume?: ConsumeConfig;
  // Nest brood spawn timer (Stage 4): seconds until the next batch; ticked by
  // GameEngine.updateNests for an enemy whose archetype has a `spawner` config.
  spawnTimer?: number;
  // Swarm movement scratch (Stage 4): per-gnat timer/phase reused by the
  // DBG-selectable swarm modes (vortex dart cadence, weave phase accumulator,
  // burst coast/dash cadence) — see AISystem.updateSwarm.
  swarmTimer?: number;
  // Reactive bubble (Stage 5).  `bubbleLatchTimer` counts down the seconds a
  // provoked bubble stays latched onto the player (attachedToId='player')
  // EMPing it, after which it releases and pops — ticked by
  // GameEngine.updateBubbles.  (Passive movement rides the asteroid flow field
  // / chases shards directly in AISystem.updateBubble — no stored heading.)
  bubbleLatchTimer?: number;
  // Burst/coast cadence for bubble locomotion (AISystem.updateBubble): counts
  // down through a slow coast then a short fast dart, so a bubble normally
  // creeps but periodically lunges.
  bubbleBurstTimer?: number;
  // Feed pulse: stamped when a bubble swallows a shard; the membrane briefly
  // bulges (RenderSystem) while it ticks down in GameEngine.updateBubbles.
  bubbleFeedTimer?: number;
  // Digest (Stage 5): a bubble holding a shard inside it.  On membrane contact
  // the shard is swallowed (deactivated) and its look snapshotted here; the
  // bubble renders a shrinking ghost of it INSIDE the transparent membrane while
  // the timer runs, then grows.  Mirrors the latch (a held target processed over
  // a timer) — the bubble just can't engulf the too-big player/enemy, so that
  // path clings + EMPs instead.  Ticked in GameEngine.updateBubbles.
  // `bubbleDigestDuration` is the per-shard digest time (= DIGEST_DURATION ×
  // richness) — stored for the render progress ratio AND to recover the richness
  // at finish (heal/grow scale).
  bubbleDigestTimer?: number;
  bubbleDigestDuration?: number;
  bubbleDigestColor?: string;
  bubbleDigestSize0?: number;
  // Sickness (Stage 5): set after breaking a latch or eating a toxic shard —
  // the bubble turns green, moves sluggishly, and can't eat until it ticks out
  // (GameEngine.updateBubbles).  Loses aggro on entry.
  bubbleSickTimer?: number;
  // Set on a LATCHED bubble when a projectile hits it (PhysicsSystem) so
  // updateBubbles shakes it loose next tick.  Consumed there.
  bubbleKnockFree?: boolean;
  // Stamped on the PLAYER when it slams a tile/asteroid at ≥ KNOCK_SPEED
  // (PhysicsSystem); updateBubbles reads it to shake any latched bubble free.
  terrainSlamTimer?: number;

  // ── Stage 6: dragon mini-boss ───────────────────────────────────────────
  // Recent head-position history (newest first), recorded by
  // GameEngine.updateDragon; RenderSystem walks it to draw the trailing body
  // segments.  Only the dragon head carries this.
  dragonPath?: Vector2[];
  // Phase-through (gnat-style): the entity ignores collision with everything
  // except the player + player projectiles (so the dragon glides through terrain
  // and eats it via the consume pass instead of bouncing).  PhysicsSystem early
  // out.
  phasesTerrain?: boolean;
  // Dragon body segment (Stage 6): a real tile-variant STRUCTURE that the dragon
  // has eaten, chain-followed behind the head (position hard-set each frame by
  // GameEngine.positionDragonBody).  Finite mass so it's shootable + collides;
  // EntityIndex excludes it from the shard indices so ShardSystem / flow-drift /
  // consume leave it alone.  Cleared when it's severed off (→ free shard).
  dragonSegment?: boolean;
  // Dragon leave animation (Stage 6): the head has crossed its exit portal and
  // is being swallowed tail-first — RenderSystem stops drawing it while the body
  // segments collapse through the portal one by one.
  dragonHidden?: boolean;
  // Wave-completion accounting (Stage 2b).  A tracked wave enemy counts toward
  // "is the field clear?" UNLESS this is explicitly false.  Set false for
  // entities spawned BY other entities or that replicate — nest brood, bubble
  // offspring — so they don't keep a wave open forever (the wave ends when the
  // counted enemies, e.g. the nests / original bubbles, are dead; leftover
  // brood carry over as survivors).  Absent → counts (every current enemy).
  // Non-enemy roamers (Snitch, the future dragon) are EntityType.INTERACTABLE
  // and never tracked, so they bypass this entirely.
  countsTowardWave?: boolean;

  // ── Snitch (quidditch-style wave bonus target) ───────────────────────────
  // Marks the one-per-wave snitch entity (EntityType.INTERACTABLE, no
  // dropType, so the physics broadphase ignores it entirely).  Steering /
  // catch logic lives in GameEngine.updateSnitch; RenderSystem keys the
  // golden-comet draw + trail strip off this flag.
  isSnitch?: boolean;
  // Stable per-snitch phase offset (radians) for the wander oscillation so
  // two consecutive snitches don't weave identically.
  snitchWanderPhase?: number;

  // Stamped by the damage paths when the killing blow came from the player
  // (projectile, crash, lightning chain, cannon AoE).  handleEntityDeath
  // awards shard/tile destruction points only when set, then clears it so
  // a regen-reused tile entity can't re-award without a fresh player kill.
  killedByPlayer?: boolean;

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

  // Set on nebula-shards that formed from ROCK material (per-hit chip dust
  // and rock death bursts).  Propagated through nebula-shard self-merges and
  // read at condensation time so rock-derived dust condenses into a small
  // rock-shard instead of the default glass-shard / nebula-tile outcome.
  fromRock?: boolean;

  // Number of base shards that have composed into this entity.
  // Tile-break / shatter spawns start implicitly at 1 (undefined ===
  // 1); composeEntities sums the two parents' counts on every merge
  // (rock condense / glass-self / plastic-self).  shatter
  // AsteroidStyle reads this on death and breaks the shard into ~
  // mergeCount fragments with even per-fragment sizing, so a merged
  // shard always fragments back into roughly the same number of
  // base-sized pieces that built it — applies to every variant going
  // through shatterAsteroidStyle (rock-shard, glass-shard, plastic-
  // shard); metal-shard.shatter.kind is 'none' so the field exists
  // but the override path doesn't fire there.
  mergeCount?: number;

  // Per-dent snap-back history for plastic-tile / plastic-shard.
  // applyDentStep pushes one entry per hit holding the polygon
  // delta this dent applied (post - pre, including the preserve-
  // bounding-radius rescale).  Delta layout: Float64Array of
  // length 2N (alternating x, y per vertex) so each entry is one
  // typed-array allocation, no per-vertex objects.  When the
  // timer expires, tickPlasticDentRecovery subtracts the delta
  // from polygonPoints — one hit's worth of deformation snaps
  // back instantly.  Cleared on compose (polygon regenerates at
  // a new size) and on cross-material transmute (no longer
  // plastic).
  plasticDentHistory?: Array<{ timer: number; delta: Float64Array }>;

  // Plastic-tile damage colour blend — set on first hit, sticky for
  // the tile's life.  applyDentStep lerps tile.color from
  // plasticTileOriginalColor toward plasticTileTargetColor as
  // health/maxHealth falls, so a tile visibly shifts from its
  // palette shade to a shard shade across its HP curve.  At HP=0
  // the tile.color === plasticTileTargetColor (full shard colour)
  // and the existing break path releases shards.
  plasticTileOriginalColor?: string;
  plasticTileTargetColor?: string;

  // ── Metal rigid-composite assembly ──────────────────────────────────────
  // A metal-shard entity carrying `metalCells` is a rigid composite: a set
  // of equilateral-triangle cells locked to a shared triangular lattice.
  // Each cell is an integer lattice key (ix,iy) + up/down orientation;
  // its lattice-frame centroid is (ix·R·√3/2, iy·R/2) where R =
  // `metalLatticeR` (the constituent triangle's circumradius).  The entity's
  // `position` is the composite's mass centroid and `rotation` orients the
  // lattice; the body drifts/spins as one via velocity + rotationSpeed.
  // Loose metal triangles snap into the composite's empty hexagon slots
  // (see ShardSystem.tickMetalAssembly); a composite shows 6 lattice cells
  // when complete.  Beyond that it continues absorbing loose triangles as
  // `metalExcessCells` (invisible mass accumulation) until the composite
  // has soaked 2 × HEX_AREA worth of mass — then it snaps to a static
  // metal tile and releases the 6 lattice triangles as overflow debris.
  metalCells?: Array<{ ix: number; iy: number; up: boolean }>;
  metalLatticeR?: number;
  metalExcessCells?: number;

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
  // Per-entity render cache for the resolved material-automata tint hex
  // (metal/rock brightness path).  Built lazily by RenderSystem and
  // invalidated by ShardSystem.recomputeMaterialNeighbors whenever
  // materialNeighborCount changes — so the per-frame RGB multiply runs
  // once per neighbour-count change, not every frame.  Mirrors
  // densityCachedTint.
  materialAutomataCachedColor?: string;

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
  // Projectile render hint copied from WeaponConfig.glow — draws a larger,
  // brighter bloom so heavy / status shots read at a glance.
  glow?: boolean;
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
  // Conservation-of-mass accumulator for the nebula→material condense
  // path: how many base nebula-shards' worth of mass this shard carries
  // (base shard = 1; grows by summing when two nebula-shards coalesce).
  // A cloud must accumulate NEBULA_CONDENSE[material].units before it can
  // crystallise into the hue's solid material, so tougher materials
  // (metal / plastic) cost more nebula than rock / glass.
  nebulaCondenseUnits?: number;
  // Committed condensation target — once a coalescing cloud is big enough
  // to matter it LOCKS the material its dominant hue points at, so later
  // off-hue bonds can't drag it into a cheaper material (hue-drift
  // cheap-out).  The crystallise gate then uses the committed material's
  // cost, not the live hue.
  nebulaTargetMaterial?: 'rock-shard' | 'glass-shard' | 'plastic-shard' | 'metal-shard';
  // Anti-stuck "patience": coalescences this cloud has made without
  // reaching its committed target's cost.  Past NEBULA_CONDENSE_STALL_BONDS
  // the cloud force-crystallises into its committed material with whatever
  // it has, so an expensive target (metal) in a thin field can't balloon
  // forever without resolving.
  nebulaStallCount?: number;
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
  // ── Material-tile automata (glass / metal / rock STATIC tiles) ──────────
  // Odd-r offset hex-grid coordinate of a material STRUCTURE tile, stamped
  // at build time by TileGenerator.buildStructureTile.  Used by ShardSystem
  // to count same-variant hex neighbours (parallels nebulaGridCol/Row).
  tileGridCol?: number;
  tileGridRow?: number;
  // Number of same-variant material-tile neighbours in the 6 hex cells
  // around this tile (0 = isolated / cluster edge, 6 = fully interior).
  // Drives the per-variant neighbour-brightness automata in RenderSystem
  // (SHARD_VARIANTS[v].automata).  ShardSystem recomputes it lazily
  // whenever a static tile is destroyed or regenerated — never per frame.
  materialNeighborCount?: number;
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

  // Cosmetic render cache: a stable per-entity seed for the material
  // damage-crack overlay (rock / metal tiles + shards), lazily derived
  // from the id on first draw.  Mirrors the enemy `glowPhase` seed but
  // for the shared seeded crack pattern in RenderSystem.drawDamageCracks
  // so fractures hold still frame-to-frame and only accrue as HP drops.
  // Render-only; never read by the sim.
  crackSeed?: number;
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
  waveStatus?: 'active' | 'cleared';
  waveGraceTimer?: number;
  /** Seconds elapsed in the active wave (count-up scoring timer); undefined
   *  outside the 'active' phase. */
  waveElapsedSec?: number;
  /** Enemies left to destroy this wave (unspawned remainder + alive).
   *  Completion model: the wave ends only when this reaches 0. */
  enemiesRemaining?: number;
  /** Run score — animated integer ticker toward the true run total. */
  score?: number;
  /** Kill-combo readout: active multiplier (1 = no combo), the kill
   *  count feeding it, and the remaining-window fraction for fade. */
  comboMultiplier?: number;
  comboCount?: number;
  comboFraction?: number;
  /** Spendable Salvage currency (earns 1:1 with score; score stays the
   *  permanent high-score).  Spent on upgrades / unlocks. */
  credits?: number;
  /** Per-upgrade level snapshot for the DBG Upgrades panel. */
  upgrades?: { id: string; label: string; level: number; max: number }[];
  /** Pending between-wave upgrade-card choice (undefined when not
   *  choosing).  The sim is paused while this is set; the player picks
   *  one card to apply. */
  cardChoice?: UpgradeCard[];
  /** Wave interval between card offers (DBG-cyclable; 1 = every wave). */
  cardInterval?: number;
  /** Effective player stats for the player menu (pause screen). */
  playerStats?: {
    health: number; maxHealth: number;
    shield: number; maxShield: number;
    damageMult: number; cooldownMult: number; speedMult: number; maxAmmo: number;
  };
  /** Current run unlocks for the player menu (real ownership). */
  unlocks?: { weapons: string[]; shield: boolean; overcharge: boolean };
  /** Drydock shop catalog (populated only while paused).  Unlocks only —
   *  stat upgrades come exclusively from wave-completion cards. */
  shop?: {
    unlocks: { id: string; label: string; desc: string; owned: boolean; cost: number; affordable: boolean }[];
  };
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
  // DBG (Shards & Physics): PLAYER ↔ nebula-shard hard collision. true = the
  // ship physically parts/scatters the cloud; false = glide-through (pull only).
  playerNebulaCollisionEnabled?: boolean;
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
  // DBG (Visual): off-screen-indicator chevron mode. true = chevrons only for
  // nearby-but-offscreen entities (on-screen ones are suppressed); false = the
  // original "chevron everything past the centre ring" behaviour.
  chevronsOffscreenOnly?: boolean;
  // DBG (Shards & Physics): tile repel PUSH (glass + metal). true = tiles shove
  // nearby bodies; false = push off (glow feedback still reacts).
  repelPushEnabled?: boolean;
  // When true, plastic-shards render in the active palette's constant
  // base shade, brightness-scaled by their plastic-shard contact
  // count (PAuto automata).  Default true.
  plasticAutomataEnabled?: boolean;
  // PAuto direction: true = brighten dense interiors, false = darken
  // them (default).  Toggled via the PADIR button.
  plasticAutomataBrighten?: boolean;
  // When true, material STATIC tiles (glass / metal / rock) shift render
  // brightness by their same-variant hex-neighbour count (per-variant
  // darken/brighten default from SHARD_VARIANTS[v].automata).  Master
  // on/off; DBG-toggleable via the "Tile shade" button.  Default true.
  materialAutomataEnabled?: boolean;
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
  metalGlowColorName?: string;
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
  // Snitch catch mode — DBG-toggleable while playtesting which catch
  // interaction feels better.  'collide' (default): fly into the snitch.
  // 'shoot': any player-owned projectile within its catch radius nabs it.
  snitchCatchMode?: 'collide' | 'shoot';
  // DBG snitch-speed multiplier step name (SNITCH_SPEED_CYCLE, e.g. "1×").
  snitchSpeedName?: string;
  // DBG enemy-scaling multiplier step name + the live per-wave HP/dmg mults.
  enemyScaleName?: string;
  enemyScaleInfo?: string;
  swarmMoveName?: string;
  // DBG: enemy counterplay traits (armor, …) enabled.
  traitsEnabled?: boolean;
  // DBG enemy-test override: the forced spawn subtype (null = normal mix).
  forcedEnemy?: string | null;
  // Active player status effects for the HUD (kind, stacks, remaining frac).
  statusEffects?: { kind: string; stacks: number; fraction: number }[];
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
  // ── Perf recorder (DBG FPS harness) ──────────────────────────────────
  // Live capture state for the "Perf REC" DBG section: whether a capture is
  // running, how many frames it holds, and the current scene label.
  perfRecording?: boolean;
  perfRecSamples?: number;
  perfRecScene?: string;
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
  // Set on gold "+N" points popups (vs. white damage chips).  Score
  // popups merge nearby spawns into one growing total via `scoreValue`.
  isScore?: boolean;
  scoreValue?: number;
  // Per-text render size multiplier (points tier bigger by magnitude;
  // damage chips render small).  Folded into the grow-animation scale.
  fontScale?: number;
}

// One option in a between-wave upgrade-card choice.  `kind` discriminates
// the payload: 'stat' bumps an upgrade level (`id`), 'salvage' grants
// currency (`amount`).  'unlock' is reserved for the weapons/shield/
// overcharge unlocks (built next) — the card pool is already shaped for it.
export interface UpgradeCard {
  kind: 'stat' | 'salvage' | 'unlock';
  label: string;
  desc: string;
  id?: string;       // upgrade id (stat) or unlock id
  amount?: number;   // salvage granted
  levels?: number;   // stat-card level grant (1 normal; 2–4 on powerful waves)
  rarity?: 'common' | 'rare';
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
