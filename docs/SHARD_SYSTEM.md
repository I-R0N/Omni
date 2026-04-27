# Shard System Overhaul — Phase 1 Plan

> Status: **plan only — no code changes outside this document.** Phase 2
> implementation does not begin until the recommendations below are
> approved.

This document is the source of truth for the planned consolidation of
asteroid / tile-shard / nebula behaviour into a single, data-driven
`ShardSystem`. It supersedes the relevant sections of
`docs/POLISH_ARCHITECTURE.md` (which is stale per `CLAUDE.md`).

The goal — restated from the task brief — is that **adding a new
shard variant ("ice", "crystal", "obsidian") becomes a new entry in
`SHARD_VARIANTS` plus optionally a sprite, and adding a new
cross-variant interaction (e.g. "ice attracted to asteroid") becomes
a config edit on the puller's variant — no engine code.**

The new behaviour the architecture must enable: nebula shards drift
toward nearby asteroid / tile / glass / heavy / future-variant shards
via gravity pull, and on long contact bond with the host. The host
keeps its identity and physics; the bonded nebula rides along as a
visible glow layer. Two nebulas still coalesce. Two asteroids still
accrete.

---

## 1. Current state — quick map

Three "shard" concepts share the word `shard` and discriminate via the
`shardType: 'asteroid' | 'tile' | 'nebula'` field. The same three
behaviours are implemented in two or three places each:

| Behaviour | STRUCTURE tile | Asteroid / tile-shard | Nebula tile / shard |
|-----------|----------------|------------------------|---------------------|
| Regen     | `GameEngine.pendingRegens` (~`GameEngine.ts:114`, populate `:780`, tick `:912–935`) | n/a (shards never regen) | `NebulaSystem.pendingRegens` (`NebulaSystem.ts:57`, populate `:139`, tick `tickRegens` `:856`) |
| Shatter   | STRUCTURE branch of `handleEntityDeath` (`GameEngine.ts:765–781`) — flow-field patch + regen queue, no shards spawned in death itself | `createAsteroidShards` (`GameEngine.ts:1876–1983`) | `NebulaSystem.spawnShards` (`NebulaSystem.ts:244–408`) |
| Merge     | n/a | `stickBonds` queue (`GameEngine.ts:125`, populate/tick in `handleEntitySticking` `:1551–1684`, completion `mergeEntities` `:1689–1817`) — contact-timer threshold | gravity-pull-then-coalesce in `NebulaSystem.updateDynamics` (`:426–555`) — proximity merge with cooldowns |

Other current cross-cuts the new system inherits:

- **Bouncer reflection** (`PhysicsSystem.ts:932–934`) special-cases
  `target.type === STRUCTURE || (ASTEROID && shardType === 'tile')`.
- **Death-burst particles per shardType** (`GameEngine.ts:824–831`):
  tile shards puff their tile colour; asteroid shards puff slate.
- **Polygon style per shardType** at spawn / merge (`GameEngine.ts:1737`,
  `:1914`): blocky 4–6 verts for tile, jagged 5–7 verts for asteroid.
- **Render fast-path cache** for nebula tiles
  (`nebulaCachedTinted/Dx/Dy/Size`) — invalidated by NebulaSystem at
  every site that mutates composition / neighbour count / tile area
  (`NebulaSystem.ts:202`, `:217`, `:634`, `:893`).
- **EntityIndex.asteroids** (`engine/systems/EntityIndex.ts`) is
  shardType-agnostic — both `'asteroid'` and `'tile'` shards live in
  the same flat list.

The detailed per-line citations for every behaviour above are captured
in the research pass that produced this plan; this document only
re-cites where ambiguity matters.

---

## 2. The `SHARD_VARIANTS` schema

Mirrors the shape of `STRUCTURE_VARIANTS` and `ENEMY_VARIANTS`:
a frozen `Record<ShardVariantId, ShardVariantDef>`. All variant logic
in the new `ShardSystem` is a switch on a small number of
config-driven cases — no per-variant `if (variant === 'nebula')`
branches in the engine.

```ts
// engine/systems/ShardSystem/types.ts (new file)

/** Stable string id for a variant. Adding "ice" only adds an id here. */
export type ShardVariantId =
  | 'glass'           // STRUCTURE tile, single-shot
  | 'reinforced'      // STRUCTURE tile, 3 hp
  | 'heavy'           // STRUCTURE tile, 5 hp
  | 'indestructible'  // STRUCTURE tile, never breaks
  | 'asteroid'        // free-floating rock
  | 'tile-shard'      // shard spawned from a STRUCTURE tile death
  | 'nebula-tile'     // hex-grid nebula tile
  | 'nebula-shard';   // free-floating nebula debris

/** What carrier EntityType this variant rides on.  See decision §6.B. */
export type ShardCarrier =
  | EntityType.STRUCTURE      // glass / reinforced / heavy / indestructible
  | EntityType.ASTEROID       // asteroid, tile-shard
  | EntityType.NEBULA         // nebula-tile
  | EntityType.NEBULA_SHARD;  // nebula-shard

/** Selector for "which other variants do I interact with". */
export type VariantSelector =
  | 'none'
  | 'self'                    // same variant id only
  | 'all'                     // every variant in SHARD_VARIANTS
  | { include: ShardVariantId[] }
  | { exclude: ShardVariantId[] };

/** Outcome of a successful merge between A (puller / passenger) and B (host). */
export type MergeOutcome =
  | 'compose'   // both same variant: one larger entity of this variant
  | 'attach'    // A becomes a passenger riding host B
  | 'absorb';   // A is consumed, B is unchanged but logs a side-effect
                //   (currently used by ammo/health drop → asteroid)

/** Per-pair override; the resolver (see §3) walks this table. */
export interface MergeRule {
  partner: ShardVariantId | 'self';   // 'self' means same-variant pair
  outcome: MergeOutcome;
  /** Threshold scaler; applied on top of base bondTimeSeconds. */
  thresholdScale?: number;
}

export interface ShardSpawnShape {
  /** Half-open size range for fresh spawns from shatter. */
  sizeMin: number;
  sizeMax: number;
  /** Number of polygon vertices. */
  polyVerticesMin: number;
  polyVerticesMax: number;
  /** Per-vertex angle jitter strength (0..1, in fractions of step). */
  angleJitter: number;
  /** Radial range for jitter — fraction of base radius. */
  radiusMin: number;
  radiusRange: number;
  /** Mass = sizeMass(diameter). The map stays simple: mass = diameter
   *  for both asteroid and nebula variants today; named here so future
   *  density variants ("dense ice") can override without touching the
   *  shatter code. */
  sizeToMass: (diameter: number) => number;
}

export interface ShardRegenPolicy {
  kind: 'none' | 'timer' | 'merge-only';
  /** Used when kind === 'timer'. */
  delaySeconds?: number;
  /** Optional pop-in particle burst at completion. */
  popBurst?: {
    chipCount: number;
    chipSpeedMin: number;
    chipSpeedMax: number;
    chipLifetime: number;
  };
  /** Optional rule-based colour rewrite at completion (nebula uses this). */
  rewriteColor?: 'none' | 'neighborhood-blend';
}

export interface ShardMergePolicy {
  /** Gravity-pull candidate set. 'none' disables pull. */
  attractedTo: VariantSelector;
  pullRange?: number;
  pullStrength?: number;
  pullMinDist?: number;

  /** Contact-stick candidate set. 'none' disables bond formation. */
  bondsWith: VariantSelector;
  /** Base seconds-to-merge for a min-size pair. Scaled by size, see §3. */
  bondTimeSeconds?: number;
  bondTimeSizeRef?: number;
  bondTimeSizePower?: number;

  /** Per-pair outcome; falls back to `defaultOutcome` if no rule matches. */
  rules?: MergeRule[];
  defaultOutcome: MergeOutcome;

  /** Cooldown before a freshly-spawned or freshly-merged entity may
   *  participate in another merge.  (Today: nebulaMergeCooldown.) */
  postMergeCooldown?: number;
}

export interface ShardShatterPolicy {
  kind: 'none' | 'powerlaw';
  /** Output count; for nebula today: count = 2..3, for asteroid: 2..5. */
  countMin: number;
  countMax: number;
  /** Power-law alpha range. damageNorm 0 → alphaMin, 1 → alphaMax. */
  alphaMin: number;
  alphaMax: number;
  /** Variant the children belong to. */
  childVariant: ShardVariantId;
  /** Fraction of impact speed inherited by scatter (forward & perp). */
  forwardDrag: number;
  perpScatter: number;
  /** Half-cone of scatter spread. */
  scatterHalfCone: number;
  /** Optional birth-time fade-in (nebula uses this). */
  fadeInSeconds?: number;
  /** Optional merge cooldown stamped on each child. */
  postShatterMergeCooldown?: number;
}

export interface ShardPassengerVisual {
  kind: 'none' | 'nebula-tint';
  /** Render layer offset relative to host; positive = above. */
  zOffset: number;
}

export interface ShardVariantDef {
  id: ShardVariantId;
  carrier: ShardCarrier;
  spawn: ShardSpawnShape;
  regen: ShardRegenPolicy;
  merge: ShardMergePolicy;
  shatter: ShardShatterPolicy;
  /** Drawn on top of a host when this variant is the passenger
   *  (mergeOutcome 'attach' with this variant on the small side). */
  passengerVisual: ShardPassengerVisual;
  /** Hooks delegated to existing systems; the variant config does not
   *  re-implement drops or particles. */
  onShatterParticles?: 'inherit' | 'none' | { color: string; count: number };
  spawnsDropsOnDeath: boolean;
}

export const SHARD_VARIANTS: Readonly<Record<ShardVariantId, ShardVariantDef>>;
```

The data structure is intentionally **shallow and explicit** — every
behavioural axis the engine reads is a named field on the variant
def, not a callback bag. Adding a new axis means adding a field and
having ShardSystem read it; existing variants pick up the default.

---

## 3. The merge-rule resolver

Resolving the outcome of a contact between entities A and B uses the
puller's `merge.rules`, in order. This keeps cross-variant interaction
**unilateral and locally configurable** — adding "ice attracted to
asteroid" only edits the `ice` variant, never `asteroid`.

```ts
// Pseudocode that ShardSystem calls on every candidate pair
function resolveMerge(a: GameEntity, b: GameEntity): {
  host: GameEntity;        // surviving entity
  passenger: GameEntity;   // consumed / attached entity
  outcome: MergeOutcome;
  threshold: number;       // bond seconds for this pair
} | null {
  const va = SHARD_VARIANTS[shardVariantOf(a)];
  const vb = SHARD_VARIANTS[shardVariantOf(b)];

  // The "puller" is the one who cares about the other.
  // Symmetric same-variant case: pick larger entity as host.
  const aWantsB = selects(va.merge.bondsWith, vb.id);
  const bWantsA = selects(vb.merge.bondsWith, va.id);
  if (!aWantsB && !bWantsA) return null;

  const [puller, target] = aWantsB ? [a, b] : [b, a];
  const pullerDef = aWantsB ? va : vb;

  // Per-pair rule lookup; falls back to default outcome.
  const rule =
       pullerDef.merge.rules?.find(r => r.partner === SHARD_VARIANTS[shardVariantOf(target)].id)
    ?? pullerDef.merge.rules?.find(r => r.partner === 'self' && shardVariantOf(target) === pullerDef.id)
    ?? { partner: 'self' as const, outcome: pullerDef.merge.defaultOutcome };

  // Same-variant 'compose' picks larger entity as host.
  // Cross-variant 'attach' makes the puller (small) the passenger
  // and the target (host) keeps identity.
  const [host, passenger] = rule.outcome === 'compose'
    ? (a.size.x >= b.size.x ? [a, b] : [b, a])
    : [target, puller];

  const baseTime = pullerDef.merge.bondTimeSeconds ?? 10;
  const sizeRef  = pullerDef.merge.bondTimeSizeRef ?? 20;
  const power    = pullerDef.merge.bondTimeSizePower ?? 1.5;
  const avgSize  = (a.size.x + b.size.x) * 0.5;
  const baseScaled = baseTime * Math.pow(Math.max(1, avgSize / sizeRef), power);
  const threshold  = baseScaled * (rule.thresholdScale ?? 1);

  return { host, passenger, outcome: rule.outcome, threshold };
}
```

`shardVariantOf(entity)` is a single dispatch from existing entity
state to `ShardVariantId` — no new fields required for STRUCTURE
tiles (the existing `structureVariant` already maps 1:1) and no new
fields for asteroid/tile-shard either (`shardType` maps 1:1). The
only new optional field on `GameEntity` is `attachedHostId?: string`
for passengers (see §6.A).

`selects(VariantSelector, id)` evaluates `'none' | 'self' | 'all' |
{include: [...]} | {exclude: [...]}` against an id with no allocation.

---

## 4. Per-variant config — populated from current behaviour

Every config below is **the existing behaviour transcribed into the
schema** — Phase 2 stages 2–4 are pure refactors. Stage 5 (the only
new behaviour) only edits `nebula-shard`.

### glass / reinforced / heavy (STRUCTURE tiles)

Identical schema, only `health` / `sprite` / `color` / damage states
differ — those keep living in `STRUCTURE_VARIANTS` since they're
also read by RenderSystem's damage-state sprite picker. The
ShardSystem entry covers regen + shatter + merge:

```ts
glass: {
  id: 'glass',
  carrier: EntityType.STRUCTURE,
  spawn: { /* not used — STRUCTURE tiles spawn via TileGenerator */ },
  regen: {
    kind: 'timer',
    delaySeconds: 12,                           // STRUCTURE_CONSTANTS.TILE_REGEN_DELAY
    popBurst: REGEN_POP_CONSTANTS,              // chip count/speed/lifetime
    rewriteColor: 'none',
  },
  merge: {
    attractedTo: 'none', bondsWith: 'none',
    defaultOutcome: 'compose',                  // unused: tiles cannot bond
  },
  shatter: { kind: 'none', /* tiles do not produce shards on death today */ },
  passengerVisual: { kind: 'none', zOffset: 0 },
  spawnsDropsOnDeath: true,                     // delegates to GameEngine.spawnDrops
},
reinforced: { ...glass, id: 'reinforced' },
heavy:      { ...glass, id: 'heavy' },
indestructible: {
  ...glass,
  id: 'indestructible',
  regen: { kind: 'none' },
  spawnsDropsOnDeath: false,
},
```

> Note: STRUCTURE death today does **not** spawn shard children — it
> queues regen and emits a small particle puff. The `tile-shard`
> variant exists separately because it's the asteroid-side artefact
> of an asteroid splitting via `createAsteroidShards` with a parent
> whose `shardType === 'tile'`. Keeping these distinct means
> "STRUCTURE shatter" stays a degenerate `kind: 'none'` and we don't
> change tile death semantics.

### asteroid

```ts
asteroid: {
  id: 'asteroid',
  carrier: EntityType.ASTEROID,
  spawn: {
    sizeMin: 12, sizeMax: 200,                  // map config drives actual range
    polyVerticesMin: 5, polyVerticesMax: 7,
    angleJitter: 0.8, radiusMin: 0.55, radiusRange: 0.70,
    sizeToMass: d => d,
  },
  regen: { kind: 'none' },
  merge: {
    // Today asteroid stick-bonds: same-shardType always, cross-type 50%.
    // Cross-type bonding is preserved by listing both 'self' and the
    // tile-shard partner with separate timing.
    attractedTo: 'none',                        // contact-stick only, no pull
    bondsWith: { include: ['asteroid', 'tile-shard'] },
    bondTimeSeconds: 10,                        // SAME_THRESHOLD
    bondTimeSizeRef: 20,                        // SIZE_REF
    bondTimeSizePower: 1.5,                     // SIZE_POWER
    rules: [
      { partner: 'self',       outcome: 'compose' },
      { partner: 'tile-shard', outcome: 'compose', thresholdScale: 2.0 },
    ],
    defaultOutcome: 'compose',
  },
  shatter: {
    kind: 'powerlaw',
    countMin: 2, countMax: 5,                   // 2 + round(damageNorm*3)
    alphaMin: 0.4, alphaMax: 2.0,               // 0.4 + damageNorm*1.6
    childVariant: 'asteroid',                   // self-similar shatter
    forwardDrag: 0.35, perpScatter: 0.0,
    scatterHalfCone: Math.PI * 0.55,
  },
  passengerVisual: { kind: 'none', zOffset: 0 },
  onShatterParticles: { color: '#94a3b8', count: 5 }, // dust puff
  spawnsDropsOnDeath: true,
},
```

### tile-shard

```ts
tile-shard: {
  id: 'tile-shard',
  carrier: EntityType.ASTEROID,                 // rides same physics as asteroid
  spawn: {
    sizeMin: 12, sizeMax: 200,
    polyVerticesMin: 4, polyVerticesMax: 6,     // blocky
    angleJitter: 0.25, radiusMin: 0.60, radiusRange: 0.55,
    sizeToMass: d => d,
  },
  regen: { kind: 'none' },
  merge: {
    attractedTo: 'none',
    bondsWith: { include: ['asteroid', 'tile-shard'] },
    bondTimeSeconds: 10, bondTimeSizeRef: 20, bondTimeSizePower: 1.5,
    rules: [
      { partner: 'self',     outcome: 'compose' },
      { partner: 'asteroid', outcome: 'compose', thresholdScale: 2.0 },
    ],
    defaultOutcome: 'compose',
  },
  shatter: {
    kind: 'powerlaw',
    countMin: 2, countMax: 5,
    alphaMin: 0.4, alphaMax: 2.0,
    childVariant: 'tile-shard',
    forwardDrag: 0.35, perpScatter: 0.0,
    scatterHalfCone: Math.PI * 0.55,
  },
  passengerVisual: { kind: 'none', zOffset: 0 },
  onShatterParticles: 'inherit',                // tile-color puff
  spawnsDropsOnDeath: true,
},
```

> Bouncer reflection on `tile-shard` is a property of the **carrier**
> (`EntityType.ASTEROID` with `shardType === 'tile'`) read by the
> projectile system, not by ShardSystem. After the rename, projectile
> code reads `shardVariantOf(target) === 'tile-shard'` directly — no
> behavioural change.

### nebula-tile

```ts
'nebula-tile': {
  id: 'nebula-tile',
  carrier: EntityType.NEBULA,
  spawn: { /* tiles spawn via TileGenerator at HEX_SIZE; size is fixed */ },
  regen: {
    kind: NEBULA_CONSTANTS.TILE_REGEN_ENABLED ? 'timer' : 'none',
    delaySeconds: 3,                            // NEBULA_CONSTANTS.REGEN_DELAY
    popBurst: undefined,                        // nebulae fade in instead
    rewriteColor: 'neighborhood-blend',         // computeRegeneratedComposition
  },
  merge: {
    // Tiles are immutable sinks: shards merge INTO tiles via shard→tile
    // transmutation, not the other way around.  Tiles themselves do not
    // pull or bond.
    attractedTo: 'none', bondsWith: 'none',
    defaultOutcome: 'compose',
  },
  shatter: {
    kind: 'powerlaw',
    countMin: 2, countMax: 3,                   // count = 2 + floor(rand*2)
    alphaMin: 1.0, alphaMax: 1.0,               // uniform
    childVariant: 'nebula-shard',
    forwardDrag: NEBULA_CONSTANTS.FORWARD_DRAG_FACTOR,    // 0.9
    perpScatter: NEBULA_CONSTANTS.PERP_SCATTER_FACTOR,    // 0.03
    scatterHalfCone: NEBULA_CONSTANTS.FAN_HALF_ANGLE,
    fadeInSeconds: NEBULA_CONSTANTS.FADE_IN_DURATION,
    postShatterMergeCooldown: NEBULA_CONSTANTS.MERGE_COOLDOWN,
  },
  passengerVisual: { kind: 'none', zOffset: 0 },
  spawnsDropsOnDeath: false,                    // NebulaSystem.handleDeath rolls its own
},
```

### nebula-shard (today's behaviour, no cross-variant interaction yet)

```ts
'nebula-shard': {
  id: 'nebula-shard',
  carrier: EntityType.NEBULA_SHARD,
  spawn: {
    sizeMin: 8, sizeMax: 44,                    // diameter = radius*4 from spawnShards
    polyVerticesMin: 4, polyVerticesMax: 6,
    angleJitter: 0.25, radiusMin: 0.6, radiusRange: 0.55,
    sizeToMass: d => d,
  },
  regen: { kind: 'merge-only' },                // tiles regrow only via transmutation
  merge: {
    // Same-variant gravity pull only — today's behaviour.
    attractedTo: 'self',
    pullRange:    NEBULA_CONSTANTS.GRAVITY_RANGE,    // 380
    pullStrength: NEBULA_CONSTANTS.GRAVITY_STRENGTH, // 380
    pullMinDist:  NEBULA_CONSTANTS.GRAVITY_MIN_DIST, // 15
    bondsWith: 'self',
    bondTimeSeconds: 0,                         // proximity-merge, not contact-timer
    rules: [{ partner: 'self', outcome: 'compose' }],
    defaultOutcome: 'compose',
    postMergeCooldown: NEBULA_CONSTANTS.MERGE_COOLDOWN, // 1.8
  },
  shatter: { kind: 'none' },                    // shards never re-shatter
  passengerVisual: { kind: 'nebula-tint', zOffset: +1 }, // unused at this stage
  spawnsDropsOnDeath: false,
},
```

The only fields on `NEBULA_CONSTANTS` that **don't** move into the
variant def stay there because they are render-side or shared:
twinkle scheduling, palette colours, fade-rate scaling
(`nebulaFadeRateScale`), the cluster generator, and the
`AMMO_DROP_CHANCE` consumed by NebulaSystem.handleDeath (which stays
where it is — DropSystem's scope is unchanged per task brief).

---

## 5. Worked example — the "nebula glow rides an asteroid" config

This is the only behavioural change in the whole overhaul, and the
test that the architecture is data-driven. **The diff is a single
config edit on `nebula-shard`.** No other variant changes; no engine
code changes after stage 5.

```ts
'nebula-shard': {
  ...previous,
  merge: {
    // BEFORE: attractedTo: 'self'
    // AFTER: attracted to every asteroid-class shard too.
    attractedTo: { include: ['nebula-shard', 'asteroid', 'tile-shard'] },
    pullRange:    NEBULA_CONSTANTS.GRAVITY_RANGE,
    pullStrength: NEBULA_CONSTANTS.GRAVITY_STRENGTH,
    pullMinDist:  NEBULA_CONSTANTS.GRAVITY_MIN_DIST,

    // BEFORE: bondsWith: 'self'
    // AFTER: bonds with the same set, but the outcome differs per partner.
    bondsWith: { include: ['nebula-shard', 'asteroid', 'tile-shard'] },
    bondTimeSeconds: 0,                         // still proximity-merge

    rules: [
      { partner: 'self',        outcome: 'compose' },  // unchanged
      { partner: 'asteroid',    outcome: 'attach' },   // new — host asteroid
      { partner: 'tile-shard',  outcome: 'attach' },   // new — host tile shard
    ],
    defaultOutcome: 'compose',
    postMergeCooldown: NEBULA_CONSTANTS.MERGE_COOLDOWN,
  },
  passengerVisual: {
    kind: 'nebula-tint',
    zOffset: +1,
  },
},
```

What ShardSystem does with this config (no per-variant code path):

1. **Pull pass**: each `nebula-shard` scans its 3×3 spatial-hash
   neighbourhood for entities matching `attractedTo`. The broadphase
   key set widens to include asteroid-carrier entities — see §6.D for
   why this stays cheap on maps with no nebulae or no asteroids.
2. **Bond pass**: the same 3×3 scan returns proximity-merge candidates
   (using `bondTimeSeconds === 0` semantics — overlap immediately
   resolves; no contact-timer). The `resolveMerge` walk finds rule
   `{ partner: 'asteroid', outcome: 'attach' }`.
3. **Attach** (the new outcome): `host = asteroid`, `passenger =
   nebula-shard`. ShardSystem sets `passenger.attachedHostId =
   host.id`, deactivates the passenger's physics participation
   (excluded from PhysicsSystem dynamic-grid insertion via the
   existing `active` field path — see §6.A) but **keeps it in the
   entities list** for rendering and host-death cleanup. The host
   gains an entry in a `passengersByHost: Map<id, GameEntity[]>`
   maintained by ShardSystem (one Map per frame, populated from the
   EntityIndex pass — no new field on the host entity).
4. **Render**: `RenderSystem` already iterates the entity list. After
   drawing a host (asteroid), it checks `passengersByHost.get(host.id)`
   and dispatches each passenger's `passengerVisual.kind` —
   `'nebula-tint'` reuses the existing tinted-sprite + composition
   path (`getTintedSprite` + nebula colour blend), drawn at the
   host's screen position with its own size, **but the cached tinted
   canvas (`nebulaCachedTinted`) is keyed on composition only and
   stays valid frame-to-frame as the host moves.**
5. **Host death**: in `handleEntityDeath`, ShardSystem looks up
   `passengersByHost.get(deadEntity.id)`, marks each passenger
   inactive and routes through `nebula-shard`'s shatter policy
   (`kind: 'none'`) → they fade out via the existing
   `nebulaFadeTimer` path, so the eye reads "the glow puffs apart
   when the rock breaks".
6. **Same-variant case unchanged**: two `nebula-shard`s still hit
   the `partner: 'self', outcome: 'compose'` rule — today's
   coalesce + transmute behaviour is preserved bit-for-bit.
7. **Asteroid + asteroid** stays homogeneous compose: the asteroid
   variant's `bondsWith` doesn't include nebula-shard, so the new
   pull/bond is unilateral.

Adding "ice attracted to asteroid shards" later is the same shape
applied to a new `'ice'` entry — one schema entry, no engine code.

---

## 6. Open decisions — recommendations

### A. How attached passengers ride the host

**Recommendation: Option (b), but stricter — the passenger stays a
flat `GameEntity` with `attachedHostId?: string`, gets pulled out of
the dynamic physics grid for the duration of the bond, has its
position overwritten from the host each substep via a single
ShardSystem pass, and renders normally as part of the entity list.
ShardSystem maintains `passengersByHost: Map<string, GameEntity[]>`
rebuilt once per frame from EntityIndex; no new field on the host.**

Rejected:
- *Option (a)* — moving passengers onto a `host.passengers` array
  would force every system that walks `currentMap.entities`
  (PhysicsSystem, RenderSystem, EntityIndex, NebulaSystem,
  GameEngine death/drop scans) to recurse into a nested array. That
  is exactly the "OOP entity tree" the codebase deliberately
  avoids. It also breaks the spatial-grid model.
- *Option (c)* — making the passenger a render-only sprite on the
  host loses identity: drop composition, ammo carriage, future
  passengers-of-passengers all become special cases. And it forces
  damage to a "host" to choose between also damaging the rider or
  not, with no clean answer.

Why (b) wins:
- **Zero new fields on the host.** Host-side state lives in the
  per-frame `passengersByHost` Map maintained by ShardSystem.
- **Passenger keeps its identity.** Death routing, render paths,
  composition all flow through the same code as a free-floating
  shard.
- **One new optional field on `GameEntity`** (`attachedHostId`),
  matching the task brief's "one new field at most" constraint.
- **Damage routing is unambiguous**: passengers are pass-through
  (already true for nebula shards — `EntityType.NEBULA_SHARD`
  doesn't impart impulse). Damage to the host doesn't flow to the
  passenger; the passenger still takes damage from its own
  collisions but, while attached, those collisions are routed at
  the host's position so they're effectively impossible against
  anything but a colliding-into-host striker.
- **Host destruction**: ShardSystem subscribes to the same
  `handleEntityDeath` dispatch the engine already has, looks up
  `passengersByHost.get(deadId)`, and detaches each passenger
  (clear `attachedHostId`, restamp dynamic-grid eligibility). The
  detached passenger then routes through the variant's shatter
  policy — for `nebula-shard` that's `kind: 'none'`, which simply
  drops them back into a free fade.
- **Render fast-path stays valid.** The cached
  `nebulaCachedTinted` is composition-keyed, not position-keyed.
  As the host moves frame-to-frame, only the draw position
  changes; the cached canvas is reused. Composition mutations
  (further passenger-on-passenger merges) hit the existing
  invalidation site.
- **Per-substep cost is one writeback**: `passenger.position.x =
  host.position.x; passenger.position.y = host.position.y` after
  PhysicsSystem integrates the host. Done in one tight loop over
  the `passengersByHost` map values.

Tradeoff acknowledged: passengers stay in the master entity list
and the per-frame compaction sweep, so for very large passenger
populations there's a constant per-entity walk cost. This is the
same cost a free-floating shard incurs today, so net new cost is
zero on existing maps. If we ever ship "1000 nebulae glommed onto
1000 asteroids" we revisit.

### B. Tile shards' EntityType

**Recommendation: keep `tile-shard` carriers as `EntityType.ASTEROID`
with `shardType: 'tile'` (renamed to `shardVariant: 'tile-shard'`
internally; the existing `shardType` field is repurposed — see §7).
Do not introduce a new EntityType.**

Migrating to a separate `EntityType.TILE_SHARD` would cascade into
the PhysicsSystem static/dynamic broadphase, EntityIndex
filter predicates, RenderSystem polygon dispatch, and the bouncer
reflect check. Every benefit would be cosmetic. The two-axis model
("EntityType = physics carrier; shardVariant = behavioural variant")
is exactly the discrimination the new `SHARD_VARIANTS` table makes
explicit.

### C. Whether nebula tiles themselves become "shards" of a variant

**Recommendation: yes, conceptually — `nebula-tile` is a
SHARD_VARIANTS entry with carrier `EntityType.NEBULA` — but no, the
EntityType stays distinct because it carries pass-through-collision
semantics nothing else does.**

The variant table is the unification point; the EntityType is the
physics-carrier. Nebula tiles are pass-through (PhysicsSystem skips
impulse for `EntityType.NEBULA / NEBULA_SHARD`), and STRUCTURE tiles
are not. Forcing those onto the same EntityType would either lose
nebula's pass-through (regression) or push a per-variant branch
into PhysicsSystem (regression of intent). Keep EntityType as the
collision-class axis; let SHARD_VARIANTS be the behavioural axis.

### D. Broadphase for cross-variant gravity pull

**Recommendation: ShardSystem owns a single per-frame spatial hash
over `EntityIndex.shardCandidates` — a new prebuilt list that
filters the master entity list to the union of "active and has a
carrier in {ASTEROID, NEBULA_SHARD}" (i.e. movable shard-carriers).
STRUCTURE / NEBULA tiles are never pull/bond candidates so they're
not indexed.**

The hash is built once per simulation step, with cell size =
`max(SHARD_VARIANTS[v].merge.pullRange ?? bondContactDist for v)`
which today is `NEBULA_CONSTANTS.GRAVITY_RANGE = 380`. The hash is
the **only** broadphase data structure for shard pull + bond — it
unifies (and replaces) today's two separate per-frame grids:

- `GameEngine.handleEntitySticking` builds a 110-cell stick grid.
- `NebulaSystem.updateDynamics` builds a 380-cell gravity grid.

Per-map cost analysis for the unified pass (cell-radius scan + per-pair
torus-wrapped delta), assuming the existing torus / wrap helpers and
the per-puller `attractedTo` / `bondsWith` filters short-circuit non-
candidate cells:

| Map | Today | After |
|-----|-------|-------|
| AsteroidFieldMap | builds stick grid (~1200 candidates), no nebula-shard pass | builds one shard-hash (~1200 candidates), no nebula-shard candidates → empty pull pass; bond pass equivalent in candidate set |
| NebulaFieldMap   | builds nebula gravity grid only (~3-shards-per-shatter), no stick grid | builds one shard-hash; no asteroid candidates → pull pass over self only (matches today) |
| GlassFieldMap    | builds stick grid over zero asteroid candidates → empty | builds shard-hash over zero candidates → empty |
| UniverseMap      | both grids built; both passes run | one grid built; one combined pass — strictly fewer Map allocations and inserts than today |

Crucially the hash cell size = 380 already comfortably covers the
asteroid stick-bond contact distance (max ~104 = (200+200)/2 +
buffer), so no second smaller grid is needed. The per-pair candidate
test is `selects(va.merge.bondsWith, vb.id) || selects(vb.merge.bondsWith, va.id)`
— evaluated O(1) on the variant's selector struct, no allocation.

To preserve today's UniverseMap cost we colocate the pull and bond
passes inside one cell-walk so each candidate pair is evaluated once
for both interactions. Pre-resolved selectors per variant pair
(`PAIR_TABLE[vA][vB]`) cached at module init mean the inner loop
does a flat array indexing + a couple of branches per pair —
strictly cheaper than today's two passes.

The recommendation is "single shared spatial hash" because it gives
the new cross-variant interaction for free, removes one per-frame
Map allocation, and the cost is bounded by the same `n` the two
existing systems already pay together.

---

## 7. File-level diff plan — what moves, what stays

New files:

```
constants.ts                       (+) SHARD_VARIANTS table appended
engine/systems/ShardSystem.ts      (+) new — orchestrator
engine/systems/ShardSystem.types.ts (+) new — schema interfaces
```

Per-file move plan (Phase 2 staging is in §9 — this section is just
"end-state where each piece of code lives"):

### `engine/GameEngine.ts` — code that **moves out**

| Loses | Reason |
|-------|--------|
| `pendingRegens: { entity, timer }[]` field (`:114`) and its tick (`:912–935`) and populate (`:780`) | Replaced by `ShardSystem.regen.queue` driven by `SHARD_VARIANTS[variant].regen` |
| `stickBonds` field (`:125`), `handleEntitySticking` (`:1551–1684`), `mergeEntities` (`:1689–1817`), `spawnCompositeAsteroid` (`:1819–1874`) | Replaced by `ShardSystem.merge` pass over `EntityIndex.shardCandidates` |
| `createAsteroidShards` (`:1876–1983`) | Replaced by `ShardSystem.shatter(entity, parentVariant)` reading `SHARD_VARIANTS[variant].shatter` |
| Per-shardType branches in death-burst particles (`:824–831`) | Replaced by `SHARD_VARIANTS[variant].onShatterParticles` driven dispatch |

### `engine/GameEngine.ts` — code that **stays**

- `handleEntityDeath` remains the entry point — it now calls
  `ShardSystem.onDeath(entity)` instead of inlining the regen /
  shard branches. The dispatch shape is preserved (PLAYER/ENEMY
  explosion → ShardSystem.onDeath → spawnDrops gate).
- `spawnDrops`, `spawnEnemyShards`, `startExplosion`, particle
  burst calls all stay — `ShardSystem.onDeath` only handles regen
  / shatter / merge cleanup; it returns whether it consumed the
  drops path so `handleEntityDeath` can skip `spawnDrops` for
  variants whose `spawnsDropsOnDeath: false` (i.e. nebulae and
  indestructibles, matching today).
- `flowField.onTileDestroyed` still fires from `handleEntityDeath`
  for STRUCTURE — flow-field state isn't shard-system concern.
- Wave / weapon / camera / drop-collection loops — untouched.

### `engine/systems/PhysicsSystem.ts`

- Bouncer reflect at `:932` keeps its check, rephrased to use the
  variant id: `target.type === STRUCTURE || (target.type === ASTEROID
  && shardVariantOf(target) === 'tile-shard')` — no behavioural
  change.
- `applyLocalGravity`-style code stays where it is. The new shard
  pull pass lives inside ShardSystem and is driven by ShardSystem's
  own broadphase.
- `addStaticEntity` — still called by ShardSystem on regen completion
  (today both GameEngine and NebulaSystem call it; the refactor
  centralises the call site).
- Per-substep tick of `nebulaImpactCooldown`, `nebulaMergeCooldown`,
  `nebulaFadeTimer`, `nebulaSpawnTimer`, `linearDamping`,
  `angularDamping` — stays in PhysicsSystem (these are velocity-
  integration-adjacent ticks, per CLAUDE.md §4 "Per-entity damping is
  ticked by PhysicsSystem"). ShardSystem **reads** the cooldowns to
  gate pull/bond eligibility; it doesn't decrement them.

### `engine/systems/NebulaSystem.ts` — code that **moves out**

| Loses | Goes to |
|-------|---------|
| `pendingRegens` and `tickRegens` (`:57`, `:856–915`) | `ShardSystem.regen` (timer-kind variants) |
| `spawnShards` (`:244–408`) | `ShardSystem.shatter` (powerlaw kind) |
| `updateDynamics` and `mergeNebulas` (`:426–649`) | `ShardSystem.merge` (pull + bond + compose) |
| `tryTransmuteShardToTile` and `isGridCellFreeForNebula` (`:672–769`) | Stays in a new `ShardSystem.NebulaTransmuter` adapter — see below |

### `engine/systems/NebulaSystem.ts` — code that **stays**

NebulaSystem stays as a slim **nebula-specific adapter** that owns
behaviour the variant table can't generically express:

- `recomputeNeighborCounts` and `buildNebulaGridIndex` — interior-
  darken render input, only meaningful for nebula tiles.
- `computeRegeneratedComposition` — the nebula-specific
  neighbourhood-blend rule, invoked by ShardSystem when
  `regen.rewriteColor === 'neighborhood-blend'`.
- `tryTransmuteShardToTile` — the shard→tile transmutation is a
  nebula-specific outcome of `mergeOutcome: 'compose'` (today's
  behaviour: when a composed shard's `nebulaTileArea ≥ HEX_AREA`).
  ShardSystem invokes a hook `variant.onComposeComplete?(host)` for
  the `nebula-shard` variant, which routes to NebulaSystem.
- `handleDeath`'s ammo-drop roll — DropSystem boundary stays
  unchanged per the task brief.
- All cache invalidation sites move with the code that mutates the
  inputs: composition writes inside ShardSystem.merge (compose
  outcome) explicitly clear `nebulaCachedTinted`, `nebulaBlendedHex`,
  and `nebulaTintedKey`; neighbour-count writes stay inside the
  NebulaSystem adapter.

### `engine/systems/RenderSystem.ts`

- Nebula fast-path read at `:1077–1118` — unchanged.
- Slow-path cache populate at `:1260–1271` — unchanged.
- New: after drawing each `EntityType.ASTEROID` (and any future host
  carrier), call `shardSystem.drawPassengers(host, ctx)` which
  iterates `passengersByHost.get(host.id)` and dispatches each
  passenger's `passengerVisual.kind`. For `'nebula-tint'` the path
  reuses the existing tinted-sprite + composition draw — no new
  pixel pipeline.
- Counter `lastNebulaFastCount` / `lastNebulaSlowCount` — increment
  on passenger draws too so the DBG `·neb fast/slow` numbers stay
  comparable.

### `engine/systems/EntityIndex.ts`

- Adds one new prebuilt list: `shardCandidates` — active entities
  whose carrier is in `{ASTEROID, NEBULA_SHARD}`. The existing
  `asteroids` list stays so callers that only need asteroid-class
  entities (e.g. weapon homing) keep their narrow filter.
- The new list is filled by the same single-pass entity walk that
  fills the existing lists — no extra pass.

### `types.ts`

- `ShardType` (`:143`) is renamed to `ShardVariantId` and gets new
  members `'nebula-tile'`, `'glass'`, `'reinforced'`, `'heavy'`,
  `'indestructible'`. `shardType` field on `GameEntity` is renamed
  to `shardVariant` (single sweep, callers updated). Maintaining a
  `ShardType` alias for one PR for grep-friendliness is fine; it
  goes away in stage 6.
- One new optional field: `attachedHostId?: string`.
- Dead optional fields removed in stage 6 (after all code paths
  migrate): none expected — every field is still used by render,
  physics, or persisted state. We do **not** widen `GameEntity`.

### `constants.ts`

- New `SHARD_VARIANTS` Record appended (the bulk of §4 above).
- `STRUCTURE_VARIANTS` keeps its visual fields (sprite / color /
  borderColor / damage states / `health` / `mass` / `indestructible`)
  — those stay the source of truth for STRUCTURE-tile rendering.
  `SHARD_VARIANTS[id]` only carries the regen / merge / shatter
  policy.
- `NEBULA_CONSTANTS` keeps render / palette / cluster / drop fields.
  Numeric values used by the variant table reference the same
  constants — no duplication.

### `components/UIOverlay.tsx`

- DBG overlay unchanged. The same `nebulaMs / nebulaVisible /
  nebulaFast / nebulaSlow` numbers continue to surface; the
  passenger-render contribution shows up inside `nebulaMs` (which
  is now "nebula-style render time, including passengers").

### `engine/maps/MapClasses.ts` and `engine/maps/TileGenerator.ts`

- Untouched. Spawn shapes flow through the variant table on
  shatter only; map generation keeps producing `STRUCTURE / NEBULA
  / ASTEROID` entities exactly as today, with the appropriate
  `structureVariant` / `shardVariant` field pre-set.

---

## 8. Spec drift identified during planning

Two `CLAUDE.md` claims need updating during this branch:

1. The §4 "Notable existing field categories" list calls out
   `shardType` — after the rename it becomes `shardVariant`. The
   spec edit is mechanical.
2. The §8 "shardType discrimination" gotcha section disappears once
   discrimination is centralised in SHARD_VARIANTS. Replace with a
   short paragraph pointing readers at the variant table.

Both edits land in the same commit as stage 6 (delete dead code).

---

## 9. Perf validation plan

The DBG overlay (toggle: F3 / debug-mode keypress) surfaces
per-frame ring-buffer averages from `EngineStats.perf` (`PerfSnapshot`
in `types.ts:423–461`). Before any code change, capture the
following numbers on each map after the world settles into a steady
state — drift the player into open space, leave the gas pedal off
for ~5 seconds, then read the overlay.

### What to capture

| Field (from `PerfSnapshot`) | Overlay label | Why it matters |
|----------|------|----------------|
| `physicsMs` | `physics` | Combined cost of integration + collisions + the new shard pull/bond pass (cross-cuts everything we touch) |
| `aiMs`     | `ai`      | Sentinel — must not change |
| `flowFieldMs` | `flow` | Sentinel — must not change (flow grid only changes on tile destroy) |
| `renderMs` | `render`  | Total render; includes nebula passenger draws after stage 5 |
| `nebulaMs` | `·neb`    | Nebula render sub-timer; should not regress (passenger pass is included here) |
| `nebulaVisible` | `·vis-neb` | Drives nebulaMs's per-tile cost characterisation |
| `nebulaFast / nebulaSlow` | `·neb fast/slow` | Fast-path hit ratio — must not regress, especially after stage 5 (the cache is composition-keyed; passenger movement should not invalidate) |
| `totalEntities` | `Ents` | Sanity — passenger entities stay live, so this should be stable across stages 1–4 and may rise modestly after stage 5 |
| `asteroidCount` | `asteroids` | Sanity for stick-bond / shatter migrations |

### Maps to capture on (in order)

1. **AsteroidFieldMap** (`MapType.ASTEROID_FIELD`) — exercises
   shard accretion / stick-bonds. Sensitive to the `merge` pass
   refactor. Capture also after firing a few rockets to trigger
   `createAsteroidShards` and observe the shatter path.
2. **NebulaFieldMap** (`MapType.NEBULA_FIELD`) — exercises shard
   merge / shard→tile transmutation / fast-path render cache.
   Capture also after smashing through a cluster to trigger
   shatter + merge.
3. **GlassFieldMap** (`MapType.GLASS_FIELD`) — exercises tile
   regen. Capture after smashing a few clusters to populate the
   regen queue, then again 12s later when the queue drains.
4. **UniverseMap** (`MapType.UNIVERSE`) — mixed baseline; the
   only map where the new cross-variant attach behaviour actually
   fires. Capture also after intentionally driving a nebula shard
   into an asteroid (stage 5+ only).

### Capture procedure

For each map / each stage:

1. `npm run dev`, open the game, pick the map, wait for map load.
2. Press F3 (or debug toggle) to surface DBG overlay.
3. Drift to open space, hands off keys, wait ~5 s for ring buffers
   to stabilise.
4. Record the eight numbers above into the table below. Each cell:
   `physMs / renderMs / nebMs / fast/slow / vis-neb / Ents`.
5. Run a 10-second "active" pass: fire weapons / smash a cluster
   / let nebula shards merge — record peak values during the pass.

### Pre-change baseline (filled in before stage 1 lands)

| Map | Steady physics / render / neb | nebFast / nebSlow / vis-neb | Ents |
|-----|--------------------------------|-----------------------------|------|
| AsteroidFieldMap | _baseline_ | _baseline_ | _baseline_ |
| NebulaFieldMap | _baseline_ | _baseline_ | _baseline_ |
| GlassFieldMap | _baseline_ | _baseline_ | _baseline_ |
| UniverseMap | _baseline_ | _baseline_ | _baseline_ |

This baseline is captured from `main` (or the parent commit on this
branch before stage 1) and committed in the stage-1 commit body.

### Post-stage targets

- **Stages 1–4 (refactor only)**: every cell **must match baseline
  ±5%** on `physicsMs / renderMs / nebulaMs`. `nebulaFast/Slow`
  ratio must match exactly (cache invalidation hasn't changed).
  `Ents` exactly matches.
- **Stage 5 (cross-variant attach)**:
  - On AsteroidFieldMap, NebulaFieldMap, GlassFieldMap: must still
    match baseline ±5%. There is nothing on those maps for the new
    interaction to fire on, so the only cost is one extra
    `selects(...)` evaluation per pair plus passenger-list
    iteration over an empty list.
  - On UniverseMap: `physicsMs` is allowed to rise by ≤10% during
    the active pass when many nebula shards are bonding to
    asteroids; steady-state must still be within ±5%.
    `nebulaFast/Slow` ratio must not regress (passengers ride
    composition-keyed cached canvases — moving the host doesn't
    invalidate).
- **Stage 6 (delete dead code)**: identical to stage 5 numbers; this
  stage is purely subtractive.

If any stage misses the target, **the stage does not land** —
debug, fix, recapture. The before/after table goes in the final
commit message of the stage and accumulates into the PR body.

### Allocation budget

Stages 1–6 must add **zero new per-frame `{x,y}` allocations**.
ShardSystem broadphase reuses pre-allocated `Map<number, number[]>`
buckets in the same idiom as `handleEntitySticking` and
`updateDynamics` today (allocate on first use, clear in place
between frames). Per-shard pull-pass scratch state lives on
pre-allocated `Float64Array(PERF_WINDOW)` ring buffers — same
pattern as the existing perf samples.

---

## 10. Implementation staging — Phase 2

Each stage is a separately reviewable commit that keeps `npm run
build` green and includes a DBG-numbers table in the commit body.

### Stage 1 — additive: SHARD_VARIANTS table + ShardSystem skeleton

- Add `engine/systems/ShardSystem.ts` and `ShardSystem.types.ts`,
  exporting an instance wired into `GameEngine` constructor. The
  skeleton has `update(dt, entities)`, `onDeath(entity)`,
  `drawPassengers(host, ctx)` — all of them no-ops returning
  defaults that mean "the existing engine code should still
  handle this".
- Add `SHARD_VARIANTS` to `constants.ts` with the per-variant
  configs from §4 — purely data, not yet read.
- Add the `shardCandidates` filter to `EntityIndex` — populated
  but not yet read.
- Add `attachedHostId?: string` to `GameEntity` in `types.ts`.

End state: zero behavioural change. Build green. Numbers identical.

### Stage 2 — migrate regen

- Move `GameEngine.pendingRegens` populate / tick into
  `ShardSystem.regen` driven by `SHARD_VARIANTS[v].regen`.
- Move `NebulaSystem.tickRegens` and `pendingRegens` into the same
  `ShardSystem.regen` queue. The neighbourhood-blend colour rule
  is invoked via the `rewriteColor: 'neighborhood-blend'` hook
  which calls into the surviving NebulaSystem method.
- Re-wire `handleEntityDeath` STRUCTURE branch to populate the
  unified queue.

End state: STRUCTURE tiles regenerate exactly as before; nebula
tile regen still gated behind `TILE_REGEN_ENABLED` (stays off).
Pop-burst particles fire from the variant config.

### Stage 3 — migrate shatter

- Move `createAsteroidShards`, the STRUCTURE death-burst (no
  shards today, just particles), and `NebulaSystem.spawnShards`
  into `ShardSystem.shatter(entity, parentVariant)` driven by
  `SHARD_VARIANTS[v].shatter`.
- Polygon generation lives in a single helper inside ShardSystem
  parameterised by `spawn.polyVerticesMin/Max`, `angleJitter`,
  `radiusMin`, `radiusRange`.
- The death-burst particle dispatch reads
  `SHARD_VARIANTS[v].onShatterParticles`.

End state: every shatter looks identical. NebulaSystem.spawnShards
becomes an empty wrapper (deleted in stage 6).

### Stage 4 — migrate homogeneous merge

- Move `GameEngine.handleEntitySticking` and `mergeEntities` into
  `ShardSystem.merge`, driven by `SHARD_VARIANTS[v].merge` with
  `mergeOutcome: 'compose'` only (no attach yet — config has no
  `attach` rules at this stage).
- Move `NebulaSystem.updateDynamics` and `mergeNebulas` into the
  same `ShardSystem.merge` pass.
- Both passes share the unified spatial hash (§6.D).
- Shard→tile transmutation routes through a `variant
  .onComposeComplete?(host)` hook that calls
  `NebulaSystem.tryTransmuteShardToTile`.
- `GameEngine.spawnCompositeAsteroid` (the asteroid-from-two-drops
  path) folds into ShardSystem.merge as a special case of the
  drop+drop compose outcome on the existing drop variants —
  drops aren't shards but the compose math is identical, so the
  tidiest approach is to keep `spawnCompositeAsteroid` for now
  and revisit in stage 6.

End state: stick bonds between asteroids and nebula merge both
fire from one code path. No visible change.

### Stage 5 — heterogeneous merge (the only behavioural change)

- Edit `nebula-shard.merge.attractedTo` and `.bondsWith` to include
  `'asteroid'` and `'tile-shard'`; add the two `attach` rules.
- Implement `mergeOutcome: 'attach'` in `ShardSystem.merge`:
  pulls `passenger.attachedHostId = host.id`, takes the passenger
  out of the dynamic-grid candidate set on the next
  `prepareFrameEntities`, and registers it in
  `passengersByHost` for the frame.
- Implement `ShardSystem.applyPassengerPositions(dt)` called once
  per substep after PhysicsSystem integrates: writes
  `passenger.position = host.position` for every entry in
  `passengersByHost`. (Passenger velocity is irrelevant while
  attached; cleared on detach.)
- Implement `RenderSystem.drawPassengers(host)` hook for the
  `'nebula-tint'` passenger visual, reusing the existing tinted-
  sprite path. **Do not invalidate `nebulaCachedTinted`** on host
  movement — the cache is composition-keyed, position-independent.
- Implement host-death detach: `ShardSystem.onDeath(host)` walks
  `passengersByHost.get(host.id)`, clears each passenger's
  `attachedHostId`, restores it to dynamic-grid eligibility, and
  routes through its variant shatter (no-op for `nebula-shard`).

End state: nebula glow rides asteroids. AsteroidFieldMap and
NebulaFieldMap unchanged because there's nothing for the
interaction to fire on.

### Stage 6 — delete dead code & spec drift

- Delete `pendingRegens`, `stickBonds`, `mergeEntities`,
  `createAsteroidShards`, `handleEntitySticking`,
  `spawnCompositeAsteroid` from GameEngine.
- Delete `pendingRegens`, `tickRegens`, `spawnShards`,
  `updateDynamics`, `mergeNebulas` from NebulaSystem.
- Rename `shardType → shardVariant` everywhere; update bouncer
  reflect check (`PhysicsSystem:932`) to use `shardVariantOf(target)
  === 'tile-shard'`.
- Update `CLAUDE.md` §4 and §8 per §8 above.
- Sweep for dead optional fields on `GameEntity` (none expected).

End state: net line reduction in `GameEngine.ts` and
`NebulaSystem.ts`. Behaviour matches stage 5.

---

## 11. Approval gate

This document is the Phase 1 deliverable. Phase 2 implementation
**does not begin** until the recommendations in §6 are explicitly
approved (or amended). Each stage in §10 lands in its own commit on
`claude/shard-system-overhaul-ihtzu`.




