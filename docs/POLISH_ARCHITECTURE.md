# Omni — Future Polish Architecture

This document captures the planned design for each major polish system.
Each system is broken into numbered implementation steps so work can proceed
incrementally without touching everything at once.

---

## System 1 — Kinetic Energy Transfer (Collision Damage)

### Motivation

The current collision model uses ad-hoc flat damage values and a single
hard-coded velocity threshold (`CRASH_VELOCITY_THRESHOLD = 4`) to decide
whether a player breaks through a tile.  This produces inconsistent results:
a heavy slow enemy does the same tile damage as a fast light one; asteroids
bounce off tiles harmlessly regardless of speed; and ramming damage between
entities ignores mass entirely.

The goal is a single physically-motivated formula that drives all impact
damage, allowing entities to crash through tiles at high speed while keeping
projectile damage on its own explicit model (projectiles are treated as
high-energy-density special cases and are not affected by this system).

---

### Conceptual model

#### Impact energy

For a collision between a moving entity A and a target B the impact
energy available to do damage is:

```
E_impact = 0.5 * m_eff * v_rel²

m_eff  = reduced mass = (mA * mB) / (mA + mB)
v_rel  = relative velocity along the collision normal
```

Special case — collision with a tile (mass = ∞):

```
m_eff  = mA                  (tile's infinite mass drops out)
v_rel  = |velAlongNormal|    (tile is stationary)
E_impact = 0.5 * mA * velAlongNormal²
```

`velAlongNormal` is already computed by the current `resolveCollision` as
`rvx * nx + rvy * ny` — no new SAT work is needed.

#### Hardness and damage

Each entity type carries a **hardness** constant H.  Damage dealt to an
entity from a collision is:

```
damage = E_impact / H
```

| Entity type | H (starting value) | Rationale |
|---|---|---|
| `STRUCTURE` (tile) | 80 | health=1; medium asteroid at cruise speed (E≈90) → ~1.1 damage = destroyed |
| `ASTEROID` | `mass * 8` | scales so larger rocks are tougher; min ~160 (small), max ~1280 (large) |
| `ENEMY` | 1500 | survives glancing blows; destroyed by sustained high-energy hits |
| `PLAYER` | 300 | cruise-speed asteroid hit → ~1-6 hp damage (1-6 % of max health) |

These are initial tuning values — expect a balance pass after implementation.

#### Tile breakthrough

When `E_impact` exceeds `BREAKTHROUGH_ENERGY` the tile is **destroyed
rather than deflected**.  The attacker retains a fraction of its velocity
(`BREAKTHROUGH_VELOCITY_RETENTION`) and continues forward.

```
BREAKTHROUGH_ENERGY          = 60   // calibrated: large asteroid (E≈180) passes;
                                     // small asteroid (E≈22) bounces
BREAKTHROUGH_VELOCITY_RETENTION = 0.70  // attacker keeps 70 % of speed per tile hit
```

With these values:
- Small asteroid (mass 20, v ≈ 1.5): E ≈ 22 → **bounces**
- Large asteroid (mass 160, v ≈ 1.5): E ≈ 180 → **breaks through**
- Player at cruise (mass 100, v ≈ 4): E ≈ 800 → **breaks through**
- Enemy rammer-3 (mass 18, v ≈ 11): E ≈ 1089 → **breaks through**

---

### Current state of relevant code

| Location | What it does now |
|---|---|
| `PhysicsSystem.resolveCollision` lines 504–524 | Hard-coded player-vs-tile crash using `CRASH_VELOCITY_THRESHOLD` |
| `PhysicsSystem.resolveCollision` lines 441–453 | Flat `PLAYER_RAM_ENEMY` damage on enemy-player contact |
| `COLLISION_CONFIG.DAMAGE` | Four flat damage constants, no mass/velocity input |
| `STRUCTURE_CONSTANTS.CRASH_VELOCITY_THRESHOLD` | Single global speed threshold |

---

### Implementation steps

#### Step 1 — Add constants to `constants.ts`

```typescript
// Inside COLLISION_CONFIG:
HARDNESS: {
  STRUCTURE: 80,
  ASTEROID_PER_MASS: 8,   // actual hardness = mass * ASTEROID_PER_MASS
  ENEMY: 1500,
  PLAYER: 300,
},
BREAKTHROUGH_ENERGY: 60,
BREAKTHROUGH_VELOCITY_RETENTION: 0.70,
```

Remove (or keep for legacy reference, deprecate):
- `COLLISION_CONFIG.DAMAGE.STRUCTURE_IMPACT`
- `COLLISION_CONFIG.DAMAGE.MINOR_IMPACT`
- `COLLISION_CONFIG.DAMAGE.PLAYER_RAM_ENEMY`
- `STRUCTURE_CONSTANTS.CRASH_VELOCITY_THRESHOLD`

#### Step 2 — Helper: compute hardness per entity

Add a small pure function (e.g. in `PhysicsSystem` or a separate
`CollisionUtils.ts`) so hardness lookup is centralised:

```typescript
function getHardness(e: GameEntity): number {
  switch (e.type) {
    case EntityType.STRUCTURE: return COLLISION_CONFIG.HARDNESS.STRUCTURE;
    case EntityType.ASTEROID:  return e.mass * COLLISION_CONFIG.HARDNESS.ASTEROID_PER_MASS;
    case EntityType.ENEMY:     return COLLISION_CONFIG.HARDNESS.ENEMY;
    case EntityType.PLAYER:    return COLLISION_CONFIG.HARDNESS.PLAYER;
    default:                   return Infinity; // projectiles, particles — handled separately
  }
}
```

#### Step 3 — Rewrite `resolveCollision` non-projectile branches

Replace the player-vs-structure crash block and the enemy-vs-player flat
damage block with a single unified block that runs for any pair of entities
that are not projectiles, interactables, or particles:

```
1. Compute v_rel = velAlongNormal (already exists as the variable)
2. Compute m_eff:
     if either entity has mass=Infinity: m_eff = the finite entity's mass
     else: m_eff = (mA * mB) / (mA + mB)
3. E_impact = 0.5 * m_eff * v_rel²

4. For each entity X in {A, B}:
     damage_to_X = E_impact / getHardness(X)
     if damage_to_X > 0.01:        // skip negligible rounding noise
         X.health -= damage_to_X
         X.hitFlash = 0.1
         if X.health <= 0: trigger onDeath(X)

5. Tile breakthrough check (target is STRUCTURE):
     if E_impact >= BREAKTHROUGH_ENERGY:
         destroy tile (removeStaticEntity, mark inactive, onDeath)
         attacker.velocity *= BREAKTHROUGH_VELOCITY_RETENTION
         return early (skip standard impulse resolution)
     else:
         fall through to standard impulse bounce
```

> **Note:** The existing impulse resolution block beneath this (lines
> 527–540) stays unchanged — it handles the physical bounce for entities
> that did NOT break through.

#### Step 4 — Connect `onTileDestroyed` callback

The `FlowFieldGrid.onTileDestroyed` call in `GameEngine.handleEntityDeath`
already handles flow-field patching.  No extra wiring is needed for the
breakthrough path as long as `onDeath` is invoked for the destroyed tile in
Step 3.

#### Step 5 — Tuning pass

After Step 3 is working, run in-game and adjust:
- `HARDNESS.*` — relative fragility of each entity type
- `BREAKTHROUGH_ENERGY` — which entities punch through vs. bounce
- `BREAKTHROUGH_VELOCITY_RETENTION` — how much speed is lost per tile

Screen shake for breakthroughs can reuse the existing
`onShake(E_impact * SHAKE_SCALE)` pattern.

---

## System 2 — Asteroid Visual Polish

### Motivation

Asteroids currently use a single random sprite from a pool of 5 assets,
have no damage-state visuals beyond procedural `renderCracks()`, and have
no semantic meaning attached to their type.  The goal is a layered visual
system that conveys type (rocky/icy/volcanic/metallic), scale of damage, and
eventually procedurally-generated unique surface detail.

---

### Proposed type taxonomy

```typescript
export enum AsteroidType {
  ROCKY    = 'rocky',     // grey/brown — most common
  ICY      = 'icy',       // blue-white, slightly translucent look
  VOLCANIC = 'volcanic',  // red-orange, faint glow
  METALLIC = 'metallic',  // silver, high reflectance
}
```

#### Per-type config object

```typescript
interface AsteroidTypeConfig {
  sprites: {
    intact:   string[];   // sprite pool, health = max
    damaged:  string[];   // health 34 %–66 %
    critical: string[];   // health < 33 %
  };
  color:               string;  // polygon fallback / tint
  glowColor?:          string;  // for volcanic bloom overlay
  hardnessMultiplier:  number;  // 1.0 baseline; metallic > rocky > icy
  massMultiplier:      number;  // metallic denser, icy lighter
  spawnWeights: Record</* mapZone */ string, number>; // probability by zone
}
```

---

### Implementation steps

#### Step 1 — Add `asteroidType` field to `GameEntity`

```typescript
// types.ts
asteroidType?: AsteroidType;
```

#### Step 2 — Add `AsteroidTypeConfig` table to `constants.ts`

Populate with existing sprite assets as the "rocky" variants.  Leave
`damaged` and `critical` arrays pointing at the same sprites initially —
the table shape is what matters at this stage.

```typescript
export const ASTEROID_TYPE_CONFIG: Record<AsteroidType, AsteroidTypeConfig> = {
  [AsteroidType.ROCKY]:    { sprites: { intact: [ASSETS.ASTEROID_1, ASSETS.ASTEROID_2, ...], ... }, ... },
  [AsteroidType.ICY]:      { sprites: { intact: [ASSETS.ASTEROID_ICE], ... }, ... },
  [AsteroidType.VOLCANIC]: { sprites: { intact: [ASSETS.ASTEROID_VOLCANIC], ... }, ... },
  [AsteroidType.METALLIC]: { sprites: { intact: [ASSETS.ASTEROID_3], ... }, ... },
};
```

#### Step 3 — Update `createAsteroid` in `MapClasses.ts`

- Accept optional `type?: AsteroidType`; default to weighted random from
  a zone-appropriate distribution.
- Store `asteroidType` on the entity.
- Apply `hardnessMultiplier` and `massMultiplier` from the config.
- Select the initial sprite from `config.sprites.intact`.

#### Step 4 — Damage tier sprite swapping

A new `currentDamageTier` field (0 = intact, 1 = damaged, 2 = critical) on
the entity.  On any collision that reduces health:

```typescript
const tier = Math.min(2, Math.floor((1 - e.health / e.maxHealth) * 3));
if (tier !== e.currentDamageTier) {
  e.currentDamageTier = tier;
  const pool = config.sprites[TIER_NAMES[tier]];
  e.sprite = pool[Math.floor(Math.random() * pool.length)];
}
```

This removes the need for the `renderCracks()` procedural overlay on
sprite-based asteroids (it can remain as a fallback for polygon mode).

#### Step 5 — Procedural surface textures (future, not time-sensitive)

When the art asset set is not complete or for unlimited unique asteroids:

1. On entity creation, allocate an `OffscreenCanvas` (or reuse a pooled one)
   sized to the asteroid's bounding box.
2. Fill with a radial gradient matching the type color.
3. Apply a layer of domain-warped hash noise to simulate surface texture.
4. Render a fake-AO rim by stroking the polygon outline with a dark
   semi-transparent brush inset by 2–3 px.
5. For volcanic: add a faint additive glow at cracks (draw during
   `renderCracks()`).
6. Call `canvas.transferToImageBitmap()` and store as `entity.cachedSprite`.
   The render system samples `cachedSprite` preferentially over `sprite`.

Use a Mulberry32 PRNG seeded by the entity ID so the same asteroid always
generates the same surface if it respawns.

---

## System 3 — Asteroid Shard Inheritance

### Motivation

When a large asteroid is destroyed by `createAsteroidShards`, the shards
are currently spawned with default asteroid settings.  They should inherit
the parent's type, orientation, and a degrade of its damage state.

### Implementation steps

1. Pass `parentType: AsteroidType` and `parentDamageTier: number` into
   `createAsteroidShards`.
2. Shard type = parent type (icy stays icy).
3. Shard `currentDamageTier` = `Math.min(2, parentDamageTier + 1)` — shards
   start already damaged.
4. Shard `rotation` seeds from the parent's rotation ± random offset, and
   `rotationSpeed` is amplified (shards tumble faster).

---

## Dependency graph

```
System 1 (energy)
  └── Step 3 reads getHardness()
        └── Step 1 provides hardness constants

System 2 (visuals)
  ├── Step 3 uses ASTEROID_TYPE_CONFIG (Step 2)
  ├── Step 4 fires on System 1's damage events
  └── Step 5 is independent, additive

System 3 (shards)
  └── depends on System 2 Step 3 (type field exists on entity)
```

Recommended implementation order:

1. System 1 Steps 1–3 (energy physics — unblocks balance work)
2. System 2 Steps 1–3 (type taxonomy — required for shard inheritance)
3. System 3 (shard inheritance)
4. System 2 Step 4 (damage-tier sprites — needs art assets)
5. System 1 Step 5 / System 2 Step 5 (tuning / procedural — ongoing)
