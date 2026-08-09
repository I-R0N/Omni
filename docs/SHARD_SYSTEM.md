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
  // ── STRUCTURE-tile variants (static, hex-clustered, mass = ∞) ───────
  | 'glass-tile'           // single-shot
  | 'plastic-tile'      // 3 hp
  | 'metal-tile'           // 5 hp
  | 'indestructible-tile'  // never breaks
  | 'rock-tile'            // NEW — clustered like glass / nebula tiles
  | 'nebula-tile'          // hex-grid, passThrough (see §6.C)
  // ── Mobile shard variants (dynamic grid, finite mass) ───────────────
  | 'rock-shard'           // RENAMED from 'asteroid' — drift / merge / shatter
  | 'glass-shard'          // RENAMED from 'tile-shard' — debris from glass-tile shatter
  | 'nebula-shard';        // free-floating cloud debris, mass = 0.01

/** All shard-family entities live on a single carrier per §6.C.
 *  TODO: rename EntityType.STRUCTURE — the semantic broadened from
 *  "destructible walls/blocks" to "any tile or shard regardless of
 *  substance" (cloud, rock, glass).  Candidates: MATTER / MATERIAL /
 *  BODY.  Deferred per direction; tracked as spec drift in §8. */
export type ShardCarrier = EntityType.STRUCTURE;
// EntityType.ASTEROID, EntityType.NEBULA, EntityType.NEBULA_SHARD are all
// removed in Stage 6.  The static-vs-dynamic axis moves to a mass check
// (mass === Infinity → static grid; finite → dynamic grid); the
// pass-through axis moves to the per-variant `passThrough` flag below.

/** Selector for "which other variants do I interact with". */
export type VariantSelector =
  | 'none'
  | 'self'                    // same variant id only
  | 'all'                     // every variant in SHARD_VARIANTS
  | { include: ShardVariantId[] }
  | { exclude: ShardVariantId[] };

/** Outcome of a successful merge between two stick-bonded entities. */
export type MergeOutcome =
  | 'compose'   // both same variant: one larger entity of this variant
  | 'absorb';   // smaller entity → inactive; larger entity logs a small
                // visual side-effect (e.g. nebula-shard absorbed into a
                // glass-shard sets the glass-shard's powerupGlowColor to
                // the closest weapon-palette colour, blended with any
                // existing glow).  Two flat entities merging via the
                // standard stick-bond mechanism — no parenting, no
                // passenger model, no per-frame position writebacks.

/** Per-pair override; the resolver (see §3) walks this table. */
export interface MergeRule {
  partner: ShardVariantId | 'self';   // 'self' means same-variant pair
  outcome: MergeOutcome;
  /** Threshold scaler; applied on top of base bondTimeSeconds. */
  thresholdScale?: number;
  /** Optional gate: rule only fires once partner has grown to at least
   *  this fraction of its variant's spawn.sizeMax.  Default 0 — no gate.
   *  Used by nebula-shard's absorb rule against glass-shard: the absorb
   *  only fires when the glass-shard has accreted to maximum size, so
   *  nebula-shards can stick-bond and float along with smaller glass
   *  fragments indefinitely (cohesion preserved) while absorption stays
   *  a relatively unique event.  Below the gate the bond persists but
   *  the merge does not trigger; the moment the partner reaches the
   *  size threshold (or the bond breaks), the merge fires. */
  requirePartnerSizeFraction?: number;
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

export interface ShardVariantDef {
  id: ShardVariantId;
  carrier: ShardCarrier;        // always EntityType.STRUCTURE post-unification
  spawn: ShardSpawnShape;
  regen: ShardRegenPolicy;
  merge: ShardMergePolicy;
  shatter: ShardShatterPolicy;
  /** Hooks delegated to existing systems; the variant config does not
   *  re-implement drops or particles. */
  onShatterParticles?: 'inherit' | 'none' | { color: string; count: number };
  spawnsDropsOnDeath: boolean;

  /** When true, PhysicsSystem skips collision impulse on contact.
   *  Replaces the EntityType.NEBULA / NEBULA_SHARD pass-through branch
   *  that exists today.  Striker velocity is unchanged on contact;
   *  the variant still takes damage and may shatter.  Only the
   *  nebula-tile variant uses this — nebula-shard achieves "barely
   *  affects the striker" via near-zero mass instead (see §6.C
   *  recommendation).  Mass alone cannot express tile pass-through
   *  because tiles must remain mass = ∞ to stay pinned to the static
   *  grid; setting them to low mass would let strikers shove them
   *  off the hex grid and break the regen / neighbor-count /
   *  transmutation logic that all assume position == hexCoord. */
  passThrough?: boolean;

  /** How many of this variant a render-fast-path cache should be
   *  prepared for.  Lazy: today only nebula-tile populates the
   *  per-entity tinted-canvas cache (`nebulaCachedTinted`); the
   *  fast-path gating in RenderSystem (`:1077`) flips from
   *  `entity.type === NEBULA` to `entity.shardVariant === 'nebula-tile'`
   *  — same cost, same shape.  Other variants do not opt in
   *  because their slow-path render is already cheap (raw sprite +
   *  optional polygon stroke, no per-entity tint compute).
   *
   *  Future variants ("crystal", "ice") that need a per-entity tint
   *  can opt in by setting renderCache to 'composition' — at that
   *  point the cache mechanism gets generalised in RenderSystem.
   *  Deferred until a second consumer exists. */
  renderCache?: 'none' | 'composition';
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
// Pseudocode that ShardSystem calls on every candidate pair at bond
// formation (to record the threshold) and at threshold completion
// (to evaluate `requirePartnerSizeFraction` against current sizes).
function resolveMerge(a: GameEntity, b: GameEntity): {
  host: GameEntity;        // surviving entity (larger)
  consumed: GameEntity;    // entity that goes inactive on merge
  outcome: MergeOutcome;   // 'compose' or 'absorb'
  threshold: number;       // bond seconds for this pair
  rule: MergeRule;         // kept around so the gate can be re-checked
} | null {
  const va = SHARD_VARIANTS[shardVariantOf(a)];
  const vb = SHARD_VARIANTS[shardVariantOf(b)];

  // Either side may want the bond; selectors are evaluated on both.
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

  // Larger entity is always the host.  For 'compose' the host's size
  // grows; for 'absorb' the host is unchanged except for a small
  // visual side-effect (see §5).
  const [host, consumed] = a.size.x >= b.size.x ? [a, b] : [b, a];

  const baseTime = pullerDef.merge.bondTimeSeconds ?? 10;
  const sizeRef  = pullerDef.merge.bondTimeSizeRef ?? 20;
  const power    = pullerDef.merge.bondTimeSizePower ?? 1.5;
  const avgSize  = (a.size.x + b.size.x) * 0.5;
  const baseScaled = baseTime * Math.pow(Math.max(1, avgSize / sizeRef), power);
  const threshold  = baseScaled * (rule.thresholdScale ?? 1);

  return { host, consumed, outcome: rule.outcome, threshold, rule };
}

// At bond-completion (timer >= threshold), gate the merge:
function shouldMergeFire(bond: Bond): boolean {
  const gate = bond.rule.requirePartnerSizeFraction ?? 0;
  if (gate <= 0) return true;
  const partnerVariant = SHARD_VARIANTS[shardVariantOf(bond.host)];
  const partnerMax = partnerVariant.spawn.sizeMax;
  return bond.host.size.x >= partnerMax * gate;
}
// If the gate is unmet, the bond persists with cohesion active but
// the merge does not fire.  The next substep re-checks the gate.
```

`shardVariantOf(entity)` reads the post-Stage-5 `shardVariant` field
on `GameEntity` (see §7 `types.ts`). Stage 1 establishes the field
as a getter aliased over today's `shardType` and `structureVariant`
fields so reads return the post-rename ids without forcing a single
big sweep; Stage 5 stamps the field directly on every shard-family
spawn site; Stage 6 deletes the legacy fields. `shardVariant`
replaces existing fields rather than widening the type — no new
optional fields on `GameEntity` for the merge architecture.

`selects(VariantSelector, id)` evaluates `'none' | 'self' | 'all' |
{include: [...]} | {exclude: [...]}` against an id with no allocation.

---

## 4. Per-variant config — populated from current behaviour

Every config below mirrors **the existing behaviour transcribed into
the schema**, with three structural changes that fall out of §6.C:

- `'asteroid'` is renamed to `'rock-shard'` — same physics, same
  drift, same merge / shatter, just a name that fits the
  tile→shard family. Stage-1 alias preserves grep-ability.
- `'tile-shard'` is renamed to `'glass-shard'` — what it actually
  is (debris from glass / reinforced / heavy tile shatter).
- A new `'rock-tile'` variant is **added** so rock material has the
  same tile→shard lineage as glass and nebula. Maps that today
  free-spawn drifting `'asteroid'` entities continue to free-spawn
  drifting `'rock-shard'` entities directly (the lineage is
  architectural, not a runtime constraint — see §6.E).

All variants set `carrier: EntityType.STRUCTURE` (per §6.C), and the
static-vs-dynamic axis is encoded by `mass`: tiles are `mass: ∞`
and live in the static grid; shards are finite-mass and live in
the dynamic grid. STRUCTURE-tile visual fields (sprite / color /
borderColor / damage states) keep living in `STRUCTURE_VARIANTS`
since they're also read by RenderSystem's damage-state sprite
picker; the ShardSystem entry covers regen + merge + shatter only.

### glass-tile / plastic-tile / metal-tile / indestructible-tile

```ts
'glass-tile': {
  id: 'glass-tile',
  carrier: EntityType.STRUCTURE,
  spawn: { /* not used — tiles spawn via TileGenerator at HEX_SIZE */ },
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
  shatter: {
    // Glass / reinforced / heavy tiles spawn glass-shards via
    // DropSystem.spawnGlassShards today.  In Stage 3 that call site
    // moves into ShardSystem.shatter and routes via this policy.
    kind: 'powerlaw',
    countMin: 4, countMax: 6,
    alphaMin: 1.0, alphaMax: 1.0,
    childVariant: 'glass-shard',
    forwardDrag: 0.0, perpScatter: 0.0,
    scatterHalfCone: Math.PI,
  },
  passThrough: false,
  spawnsDropsOnDeath: true,                     // delegates to GameEngine.spawnDrops
},
'plastic-tile':     { ...glass-tile, id: 'plastic-tile' },
'metal-tile':          { ...glass-tile, id: 'metal-tile' },
'indestructible-tile': {
  ...glass-tile,
  id: 'indestructible-tile',
  regen: { kind: 'none' },
  shatter: { kind: 'none' },                    // never breaks
  spawnsDropsOnDeath: false,
},
```

### rock-tile (new — clustered like glass / nebula)

```ts
'rock-tile': {
  id: 'rock-tile',
  carrier: EntityType.STRUCTURE,
  spawn: { /* tiles spawn via TileGenerator at HEX_SIZE; clustered per §6.E */ },
  regen: {
    // Rock-tiles regen on the STRUCTURE_CONSTANTS cadence so that a
    // smashed rock cluster slowly recoheres, mirroring glass-tile
    // behaviour today.  Could be tuned to 'merge-only' if we want
    // them to only regrow via shard→tile transmutation; deferred
    // until we ship and playtest.
    kind: 'timer',
    delaySeconds: 12,
    popBurst: REGEN_POP_CONSTANTS,
    rewriteColor: 'none',
  },
  merge: {
    attractedTo: 'none', bondsWith: 'none',
    defaultOutcome: 'compose',
  },
  shatter: {
    // Rock-tiles shatter into rock-shards on death (unlike asteroid
    // shatter today which is mid-air on damage; this is a tile
    // breaking from cluster).  Same power-law shape as asteroid
    // shatter so the resulting shards drift identically.
    kind: 'powerlaw',
    countMin: 2, countMax: 5,
    alphaMin: 0.4, alphaMax: 2.0,
    childVariant: 'rock-shard',
    forwardDrag: 0.35, perpScatter: 0.0,
    scatterHalfCone: Math.PI * 0.55,
  },
  passThrough: false,
  spawnsDropsOnDeath: true,
},
```

### rock-shard (renamed from `asteroid` — same physics, same drift)

```ts
'rock-shard': {
  id: 'rock-shard',
  carrier: EntityType.STRUCTURE,                // single carrier post-§6.C
  spawn: {
    sizeMin: 12, sizeMax: 200,                  // map config drives actual range
    polyVerticesMin: 5, polyVerticesMax: 7,
    angleJitter: 0.8, radiusMin: 0.55, radiusRange: 0.70,
    sizeToMass: d => d,
  },
  regen: { kind: 'none' },
  merge: {
    // Today's stick-bonds: same-variant always, cross-variant 50% chance.
    // Cross-variant bonding is preserved by listing both 'self' and the
    // glass-shard partner with separate timing.
    attractedTo: 'none',                        // contact-stick only, no pull
    bondsWith: { include: ['rock-shard', 'glass-shard'] },
    bondTimeSeconds: 10,                        // SAME_THRESHOLD
    bondTimeSizeRef: 20,                        // SIZE_REF
    bondTimeSizePower: 1.5,                     // SIZE_POWER
    rules: [
      { partner: 'self',        outcome: 'compose' },
      { partner: 'glass-shard', outcome: 'compose', thresholdScale: 2.0 },
    ],
    defaultOutcome: 'compose',
  },
  shatter: {
    kind: 'powerlaw',
    countMin: 2, countMax: 5,                   // 2 + round(damageNorm*3)
    alphaMin: 0.4, alphaMax: 2.0,               // 0.4 + damageNorm*1.6
    childVariant: 'rock-shard',                 // self-similar shatter
    forwardDrag: 0.35, perpScatter: 0.0,
    scatterHalfCone: Math.PI * 0.55,
  },
  passThrough: false,
  onShatterParticles: { color: '#94a3b8', count: 5 }, // dust puff
  spawnsDropsOnDeath: true,
},
```

### glass-shard (renamed from `tile-shard`)

```ts
'glass-shard': {
  id: 'glass-shard',
  carrier: EntityType.STRUCTURE,
  spawn: {
    sizeMin: 12, sizeMax: 200,
    polyVerticesMin: 4, polyVerticesMax: 6,     // blocky
    angleJitter: 0.25, radiusMin: 0.60, radiusRange: 0.55,
    sizeToMass: d => d,
  },
  regen: { kind: 'none' },
  merge: {
    attractedTo: 'none',
    bondsWith: { include: ['rock-shard', 'glass-shard'] },
    bondTimeSeconds: 10, bondTimeSizeRef: 20, bondTimeSizePower: 1.5,
    rules: [
      { partner: 'self',       outcome: 'compose' },
      { partner: 'rock-shard', outcome: 'compose', thresholdScale: 2.0 },
    ],
    defaultOutcome: 'compose',
  },
  shatter: {
    kind: 'powerlaw',
    countMin: 2, countMax: 5,
    alphaMin: 0.4, alphaMax: 2.0,
    childVariant: 'glass-shard',
    forwardDrag: 0.35, perpScatter: 0.0,
    scatterHalfCone: Math.PI * 0.55,
  },
  passThrough: false,
  onShatterParticles: 'inherit',                // tile-color puff
  spawnsDropsOnDeath: true,
},
```

> Bouncer reflection (`PhysicsSystem:932`) reads
> `shardVariantOf(target) === 'glass-shard'` directly post-rename.
> Behaviour unchanged: bouncers reflect off STRUCTURE tiles and
> glass-shards; they pass through rock-shards and nebula entities.

### nebula-tile

```ts
'nebula-tile': {
  id: 'nebula-tile',
  carrier: EntityType.STRUCTURE,                // unified per §6.C
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
  // Striker passes through nebula tiles without bouncing.  Mass = ∞
  // alone would make the tile a solid wall (immovable = full reflect);
  // mass = 0.01 would let strikers shove tiles off the hex grid (and
  // would put them in the dynamic grid, regressing per-frame cost).
  // The flag explicitly skips collision impulse; the tile still takes
  // damage and shatters on contact.
  passThrough: true,
  // Render fast-path: the slow-path tint compute is expensive enough
  // (composition blend + interior-darken multiplier + offscreen-canvas
  // build via getTintedSprite) to merit a per-entity composition-keyed
  // cache.  Other variants do not opt in — their slow path is cheap.
  renderCache: 'composition',
  spawnsDropsOnDeath: false,                    // NebulaSystem.handleDeath rolls its own
},
```

### nebula-shard

Nebula shards drift like every other mobile shard (flow-field-driven
free-body translation + the standard stick-bond cohesion mechanism)
and are gravity-pulled toward nearby mobile shards of any variant.
The gravity brings them in from a distance; on contact, stick-bond
cohesion takes over; eventually the bond fires either same-variant
compose (with another nebula-shard, leading to the existing tile
transmutation) or, against a max-size glass-shard, the new
`'absorb'` outcome — described in §5.

```ts
'nebula-shard': {
  id: 'nebula-shard',
  carrier: EntityType.STRUCTURE,                // unified per §6.C
  spawn: {
    sizeMin: 8, sizeMax: 44,                    // diameter = radius*4 from spawnShards
    polyVerticesMin: 4, polyVerticesMax: 6,
    angleJitter: 0.25, radiusMin: 0.6, radiusRange: 0.55,
    // Near-zero mass: striker impulse drops by ~3 orders of magnitude
    // vs. today's `mass = size` (~8–44).  Combined with the existing
    // linearDamping/angularDamping fields on the entity, the shard still
    // reads as "cloud being shoved aside" without slowing the striker.
    sizeToMass: () => 0.01,
  },
  regen: { kind: 'merge-only' },                // tiles regrow only via transmutation
  merge: {
    // Unilateral gravity pull from nebula-shards toward all mobile
    // shard variants (self + cross-variant).  Range / strength /
    // min-distance match today's nebula self-gravity tuning so the
    // existing "cloud drifts toward neighbours" feel is preserved.
    // Other variants don't have attractedTo set, so this remains a
    // one-way pull — rock-shards and glass-shards drift normally,
    // and only the nebula-shard receives the velocity update.
    attractedTo: { include: ['nebula-shard', 'rock-shard', 'glass-shard'] },
    pullRange:    NEBULA_CONSTANTS.GRAVITY_RANGE,    // 380
    pullStrength: NEBULA_CONSTANTS.GRAVITY_STRENGTH, // 380
    pullMinDist:  NEBULA_CONSTANTS.GRAVITY_MIN_DIST, // 15

    // Stick-bonds form on contact with self (homogeneous coalesce →
    // bigger nebula-shard → eventually transmute back to a tile via
    // the existing nebulaTileArea threshold) and with glass-shards
    // (cohesion lets the nebula float along with the cluster; absorb
    // fires only when the partner has grown to its variant max size,
    // making absorption a relatively unique event).
    bondsWith: { include: ['nebula-shard', 'glass-shard'] },
    bondTimeSeconds: 1.8,                       // matches today's MERGE_COOLDOWN scale for self
    bondTimeSizeRef: 20,
    bondTimeSizePower: 1.5,
    rules: [
      { partner: 'self',        outcome: 'compose' },
      { partner: 'glass-shard', outcome: 'absorb',
        thresholdScale: 5.0,                    // ~5× longer than self-compose
        requirePartnerSizeFraction: 1.0,        // partner must be at sizeMax
      },
    ],
    defaultOutcome: 'compose',
    postMergeCooldown: NEBULA_CONSTANTS.MERGE_COOLDOWN, // 1.8
  },
  shatter: { kind: 'none' },                    // shards never re-shatter
  // Mass alone (0.01) handles "striker barely affected" for shards;
  // pass-through is only needed for tiles (see nebula-tile).
  passThrough: false,
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

## 5. Worked example — nebula shards drift, pull, clump, and absorb

The only behavioural change in the whole overhaul. **The diff is the
nebula-shard variant config in §4** — widen `attractedTo` to include
all mobile shard variants, opt into the standard stick-bond mechanism
with a glass-shard absorb rule. No engine code beyond the shared
`'absorb'` outcome handler (implemented once in ShardSystem, used by
every future cross-variant absorption).

The story, frame-by-frame:

1. **A nebula-tile shatters** (player drifts through it). Per the
   variant's `shatter` policy, it produces 2–3 nebula-shards with
   the existing rear-cone fan velocity profile and a 1.8 s spawn
   cooldown.
2. **Drift + gravity pull**: the shards integrate normally under
   PhysicsSystem (`linearDamping = 0.97`, `angularDamping = 0.98`
   give the same "cloud floating" feel). On top of free-body drift,
   ShardSystem's per-frame pull pass scans each nebula-shard's 3×3
   spatial-hash neighbourhood for entities matching its
   `attractedTo` selector — `nebula-shard | rock-shard | glass-shard`.
   The nearest qualifying neighbour applies a force on the
   nebula-shard (range 380 / strength 380 / min-dist 15, today's
   nebula-self-gravity tuning preserved). Pull is unilateral —
   only the nebula-shard's velocity updates; the target's physics
   is unchanged.
3. **Contact with a glass-shard cluster**: gravity pull eventually
   brings a nebula-shard into touch range of a glass-shard.
   ShardSystem's stick-bond formation pass evaluates
   `selects(nebulaShardDef.bondsWith, 'glass-shard')` → match. A
   bond is recorded with the resolved threshold (5× the base
   compose time, scaled for size).
4. **Cohesion active**: the standard stick-bond per-substep velocity
   blend pulls both entities toward shared momentum. To the eye:
   the nebula-shard floats along with the glass cluster instead of
   drifting past it. This works for every glass-shard size — the
   bond doesn't care whether the partner is at max yet.
5. **Glass-shards keep merging**: per their own `compose` rules,
   touching glass-shards merge into bigger glass-shards (existing
   asteroid-stick-bond accretion). The cluster's biggest piece
   grows. The nebula-shard's bond-target may itself merge into a
   bigger glass-shard mid-bond — ShardSystem re-evaluates
   resolveMerge against the new entity each frame, so the bond
   simply re-targets.
6. **Threshold reached, partner not at max yet**: the bond timer
   crosses its threshold but `requirePartnerSizeFraction = 1.0`
   gates it. `shouldMergeFire` returns false. The bond persists,
   timer caps at threshold; cohesion stays active. Next frame
   re-checks.
7. **Partner reaches max size** (via continued accretion) and the
   bond is still active. `shouldMergeFire` returns true. The
   `'absorb'` outcome fires:
   - The nebula-shard goes inactive (no shatter, no drop, no
     fade). ShardSystem's compaction sweep removes it next frame.
   - The host glass-shard's `powerupGlowColor` is set to the
     nearest weapon-palette colour to the absorbed nebula's
     blended hex. If a glow was already present, the two are
     blended via the existing `blendHexColors` helper.
   - A small glimmer particle burst plays at the absorption
     point (reuse `NebulaSystem.spawnGlimmer` for visual
     continuity).
8. **Same-variant case**: two nebula-shards drawn together by the
   pull pass eventually touch and stick-bond. The
   `{ partner: 'self', outcome: 'compose' }` rule fires at the
   short self-compose threshold — they coalesce into a bigger
   nebula-shard, accumulating `nebulaTileArea`. Once the
   accumulator reaches `HEX_AREA`, `tryTransmuteShardToTile`
   fires and the merged shard becomes a new nebula-tile. Today's
   transmutation behaviour is preserved bit-for-bit; the merge
   path is now driven by gravity-pull → contact → stick-bond
   instead of today's gravity-pull → proximity-merge.

The "closest power-up colour" math, kept simple per direction:

```ts
// Pre-tabulate per weapon at module init — no per-frame allocation.
const POWERUP_PALETTE: Array<{ rgb: [number, number, number]; hex: string }> =
  WEAPON_LIST.map(w => ({ rgb: hexToRgb(WEAPONS[w].color), hex: WEAPONS[w].color }));

function closestPowerupHex(targetHex: string): string {
  const [tr, tg, tb] = hexToRgb(targetHex);
  let best = POWERUP_PALETTE[0].hex;
  let bestDist = Infinity;
  for (let i = 0; i < POWERUP_PALETTE.length; i++) {
    const [r, g, b] = POWERUP_PALETTE[i].rgb;
    const d = (r - tr) * (r - tr) + (g - tg) * (g - tg) + (b - tb) * (b - tb);
    if (d < bestDist) { bestDist = d; best = POWERUP_PALETTE[i].hex; }
  }
  return best;
}
```

Plain Euclidean distance in RGB space against the pre-tabulated
weapon palette — no per-frame allocation, no perceptual-luminance
weighting, no edge cases. If a future variant wants a different
mapping it overrides the absorb side-effect via a per-variant hook.

Adding "ice attracted to glass" later is the same shape applied to
a new `'ice'` variant — one schema entry, no engine code.

---

## 6. Open decisions — recommendations

### A. How nebula-shards "ride along" with glass-shards

**Decision (per user direction): there is no parenting / passenger
mechanism. Nebula-shards drift on the same flow-field paths as every
other mobile shard, and clump with glass-shards through the standard
stick-bond cohesion mechanism (the velocity-blend pass that already
pulls bonded entities toward shared momentum). After the bond's
absorb threshold elapses against a max-size glass-shard, the
nebula-shard merges into it via the `'absorb'` outcome (smaller
entity → inactive; host gets a small visual glow update). Both
entities remain flat `GameEntity` structs at all times.**

This replaces an earlier "passenger riding host" model that was
considered before the user clarified intent. That model would have
introduced an `attachedHostId?: string` field, a per-frame
`passengersByHost: Map<string, GameEntity[]>` lookup table, a
per-substep position-writeback pass, a `passengerVisual` schema
field, and a render-time host→passenger draw dispatch. **All of
that is dropped** — the existing stick-bond mechanism (cohesion +
threshold-fired merge) already produces the desired "float along
with the cluster, eventually merge with the largest piece"
behaviour without any of the parent/child machinery.

Why this is cleaner:

- **Zero new fields on `GameEntity`**. The merge architecture
  reuses `shardVariant` (replacing `shardType` /
  `structureVariant`); no `attachedHostId`, no host-side
  passenger reference. The earlier amendment's "one new optional
  field" budget is now unused.
- **Damage routing is whatever it already is.** Both entities
  participate in collisions / weapons fire as themselves; there
  is no "host vs passenger" question to answer.
- **Host destruction is automatic.** When a glass-shard
  shatters or is otherwise removed, any nebula-shard bonded to
  it sees the partner go inactive on the next frame, the bond
  is dropped, and the nebula-shard resumes free drift. No
  detach pass.
- **Render fast-path is untouched.** Nebula-shards render at
  their own positions like any other shard. The
  `nebulaCachedTinted` cache stays nebula-tile-only.
- **Per-substep cost shrinks.** No position writeback pass over
  passenger entries. The new cost is one extra
  `requirePartnerSizeFraction` evaluation when a stick-bond
  reaches threshold — single multiply + compare per qualifying
  bond, executed at most once per bond-completion event.

Tradeoff: the absorb side-effect (set host's `powerupGlowColor`
to the closest weapon-palette colour to the nebula's blended
hex) is a one-time small visual change. There's no continuous
glow that "rides" the host pre-absorb — the cohesion phase is
just two shapes drifting together. If a more theatrical pre-
absorb visual is wanted later, it adds as a separate variant
hook (`onBondActive?: (host, partner) => void`) without
changing the merge architecture.

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

### C. Full EntityType collapse — every shard-family entity on one carrier

**Decision (per user direction): every shard-family entity — tiles
and shards, glass and rock and nebula — lives on a single carrier
EntityType (currently named `EntityType.STRUCTURE`; rename
deferred, see §8). `EntityType.ASTEROID`, `EntityType.NEBULA`, and
`EntityType.NEBULA_SHARD` are all removed in Stage 6. The
static-vs-dynamic axis encodes via `mass` (Infinity → static grid,
finite → dynamic grid). The pass-through axis encodes via the
per-variant `passThrough: boolean` flag.**

Why one carrier works:

- **EntityType becomes the material family, not the static/dynamic
  axis.** Tiles and shards within a family share visual + drop +
  death-routing behaviour; the variant table already encodes their
  behavioural differences. Encoding "static or dynamic" in mass and
  "pass-through or solid" in a flag pulls those orthogonal axes out
  of the EntityType union where they were tangled.
- **PhysicsSystem dispatch becomes mass-based.** Today insertion
  branches on EntityType (STRUCTURE → static grid, ASTEROID →
  dynamic, NEBULA / NEBULA_SHARD → skip). After: insertion branches
  on `entity.mass === Infinity ? staticGrid : dynamicGrid`, and
  collision-impulse branches on
  `SHARD_VARIANTS[entity.shardVariant].passThrough`.
- **One broadphase (§6.D) over one carrier.** EntityIndex filters
  shard candidates by `entity.type === EntityType.STRUCTURE &&
  entity.mass !== Infinity` — all movable shards in one bucket.
- **Bouncer reflect (`PhysicsSystem:932`)** uses the variant id
  directly: reflect iff
  `SHARD_VARIANTS[shardVariantOf(target)].carrier === STRUCTURE &&
   isReflectiveVariant(target)` — concretely, glass-tile /
  plastic-tile / metal-tile / indestructible-tile / glass-shard.
  Rock and nebula variants are not reflective; bouncers pass
  through them (matching today: bouncers reflect off STRUCTURE
  tiles + tile-shards, pass through asteroids and nebula).
- **Damage / death routing** in `handleEntityDeath` collapses to
  one branch on the unified carrier — variant-driven shatter +
  particles + drops.

Why mass alone cannot replace `passThrough` for nebula tiles:

- `mass = Infinity` tiles are *maximum* collision reaction in
  standard 2D impulse (immovable wall — striker reflects fully).
  That's the wrong direction for nebula tiles, which today let
  strikers fly through and shatter on contact.
- `mass = 0.01` tiles would land in the **dynamic grid** — rebuilt
  + broadphased every frame for hundreds of tiles on
  NebulaFieldMap (a real per-frame cost regression). They'd also
  be integrated each substep, so any striker contact would launch
  the tile off its hex coordinate, breaking the regen / neighbour-
  count / transmutation logic that all assume `position ===
  hexCoordToPixel(col, row)`. A "snap back to hex coord" pass each
  substep would express the same semantics indirectly at cost.
- The **clean expression** is two orthogonal axes:
  `mass === Infinity` (static-grid placement, free per-frame) +
  `passThrough: true` (skip impulse, allow strike-through). Same
  cost as today's EntityType-keyed branch, expressed as data.

How "barely, if at all, slow down" is expressed for shards:

- `nebula-shard.spawn.sizeToMass` returns `0.01`. Striker impulse
  is reduced by ~3 orders of magnitude vs. today's `mass = size`
  (~8–44). The shard takes the equal-and-opposite kick, which
  combined with `linearDamping = 0.97` and `angularDamping = 0.98`
  (already on the entity, ticked by PhysicsSystem) gives the
  existing "cloud being shoved aside" feel.
- Mass is finite (not Infinity, not zero), so the standard
  collision-resolution path treats the shard as a normal mobile
  body — no per-variant branch in PhysicsSystem.

Render fast-path under unification:

- The slow-path tint compute for nebula tiles is expensive
  (composition blend + interior-darken multiplier + offscreen-
  canvas build via `getTintedSprite`). The per-entity
  `nebulaCachedTinted` cache keeps the steady-state draw at one
  `drawImage` per tile. The fast-path gating predicate at
  `RenderSystem.ts:1077` flips from `entity.type === NEBULA` to
  `entity.shardVariant === 'nebula-tile'` — same cost, same shape.
- Other variants do not opt in (rock-shard, glass-shard, etc.
  render as polygon stroke + raw sprite — already cheap). The
  schema reserves `renderCache: 'composition'` as the per-variant
  opt-in for any future variant ("crystal", "ice") that needs a
  per-entity tint; generalising the cache mechanism in
  RenderSystem is deferred until a second consumer exists.

Costs we accept:

- Nebula shards now participate in PhysicsSystem broadphase + SAT
  narrowphase (today they're skipped). Population is bounded
  (typically 2–3 per shatter, with `nebulaMergeCooldown` capping
  peak count) so cost is small.
- Nebula tiles still register in the static grid (mass =
  Infinity), so per-frame insertion cost is unchanged from today.
  The narrowphase step that would normally compute impulse is
  short-circuited by the `passThrough` flag — same number of
  branches as today's EntityType skip.

Cascading changes from this decision (every existing system
touchpoint):

- `EntityType.ASTEROID`, `EntityType.NEBULA`,
  `EntityType.NEBULA_SHARD` enum values are all removed in Stage 6.
- `ShardCarrier` collapses to `EntityType.STRUCTURE` (§2).
- `EntityIndex.shardCandidates` filter narrows to "active entities
  with `EntityType.STRUCTURE && mass !== Infinity`".
- All variant configs set `carrier: EntityType.STRUCTURE`.
- PhysicsSystem static-grid insertion keys on `mass === Infinity`,
  not EntityType.
- PhysicsSystem collision-impulse skip keys on
  `SHARD_VARIANTS[entity.shardVariant].passThrough === true`.
- RenderSystem nebula fast-path gating keys on
  `entity.shardVariant === 'nebula-tile'`.
- Bouncer reflect check keys on the variant id (specifically:
  glass-family tile or shard).
- `handleEntityDeath`'s NEBULA / NEBULA_SHARD branch collapses
  into the single STRUCTURE branch driven by the variant table.

### D. Broadphase for cross-variant gravity pull

**Recommendation: ShardSystem owns a single per-frame spatial hash
over `EntityIndex.shardCandidates` — a new prebuilt list filtered
to "active entities with `EntityType.STRUCTURE && mass !==
Infinity`" (post-§6.C unification, that is every movable shard
variant — `rock-shard`, `glass-shard`, `nebula-shard`, plus any
future mobile variant). Static tiles (`mass === Infinity`) are
never pull/bond candidates so they're not indexed.**

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
| AsteroidFieldMap | builds stick grid (~1200 candidates), no nebula-shard pass | builds one shard-hash (~1200 candidates, all rock-shards), no nebula-shard candidates → empty pull pass; bond pass equivalent in candidate set |
| NebulaFieldMap   | builds nebula gravity grid only (~3-shards-per-shatter), no stick grid | builds one shard-hash; no rock-shard candidates → pull pass over self only (matches today) |
| GlassFieldMap    | builds stick grid over zero shard candidates → empty | builds shard-hash over zero candidates → empty |
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

### E. Parametric per-map entity counts

**Decision (per user direction): every variant's contribution to
each map type is described by a single `MAP_POPULATION` record in
`constants.ts`, indexed by `MapType` then by `ShardVariantId`. This
makes "how many of X are on map Y" answerable at a glance and
trivially adjustable.**

Today the equivalent state is fragmented:

- `ASTEROID_GENERATION_CONFIG` (`constants.ts`, per-`MapType`):
  count / minSize / maxSize / speedMultiplier for free-spawned
  drifting asteroids.
- `NEBULA_CONSTANTS.CLUSTER_COUNT / MIN_CLUSTER_SIZE /
  MAX_CLUSTER_SIZE` (and OUTER_* counterparts): nebula tile cluster
  counts. Same constants apply to every map that has nebulae —
  there is no per-map nebula tuning today.
- Per-map `MapClasses.ts` code: glass / reinforced / heavy /
  indestructible cluster counts hard-coded inside each map's
  `populate()` method. No central config.

Proposed end-state schema:

```ts
// constants.ts (post-Phase-2)

interface FreeSpawnConfig {
  count: number;                    // entities to spawn at map init
  minSize: number;
  maxSize: number;
  speedMultiplier?: number;         // for drift speeds (rock-shard only today)
}

interface TileClusterConfig {
  clusterCount: number;             // number of clusters
  minClusterSize: number;           // tiles per cluster (min)
  maxClusterSize: number;           // tiles per cluster (max)
  // Optional second pass (used today by nebula's OUTER_* fields).
  outer?: { clusterCount: number; minClusterSize: number; maxClusterSize: number };
}

interface PerMapVariantSpawn {
  // Only ONE of these is present per (map, variant) entry.
  freeSpawn?: FreeSpawnConfig;        // mobile variant, drifting at init
  tileCluster?: TileClusterConfig;    // static-tile variant, hex-clustered
}

export const MAP_POPULATION: Record<MapType, Partial<Record<ShardVariantId, PerMapVariantSpawn>>>;
```

Examples (transcribed from today's behaviour where it exists, with
new entries for rock-tile clusters):

```ts
[MapType.UNIVERSE]: {
  'rock-shard':     { freeSpawn: { count: 60, minSize: 24, maxSize: 120, speedMultiplier: 1.0 } },
  'glass-tile':     { tileCluster: { clusterCount: 22, minClusterSize: 3, maxClusterSize: 9 } },
  'plastic-tile':{ tileCluster: { clusterCount: 8,  minClusterSize: 2, maxClusterSize: 5 } },
  'metal-tile':     { tileCluster: { clusterCount: 4,  minClusterSize: 2, maxClusterSize: 4 } },
  'rock-tile':      { tileCluster: { clusterCount: 12, minClusterSize: 3, maxClusterSize: 7 } },
  'nebula-tile':    { tileCluster: {
                       clusterCount: 65, minClusterSize: 14, maxClusterSize: 42,
                       outer: { clusterCount: 120, minClusterSize: 7, maxClusterSize: 26 },
                     } },
},
[MapType.ASTEROID_FIELD]: {
  'rock-shard':     { freeSpawn: { count: 1200, minSize: 12, maxSize: 80, speedMultiplier: 1.0 } },
},
[MapType.GLASS_FIELD]: {
  'glass-tile':     { tileCluster: { clusterCount: /* tuned to ≈1200 tiles */ ... } },
},
[MapType.METAL_FIELD]: {
  'metal-tile':     { tileCluster: { ... } },
},
[MapType.INDESTRUCTIBLE_FIELD]: {
  'indestructible-tile': { tileCluster: { ... } },
},
[MapType.NEBULA_FIELD]: {
  'nebula-tile':    { tileCluster: { ... } },
},
[MapType.RING]: { ... },
[MapType.SEVEN_RINGS]: { ... },
[MapType.POCKET]: {
  // POCKET is the "every-element sandbox" — small counts of each.
  'rock-shard':     { freeSpawn:   { count: 6, ... } },
  'glass-tile':     { tileCluster: { clusterCount: 3, ... } },
  'plastic-tile':{ tileCluster: { clusterCount: 2, ... } },
  'metal-tile':     { tileCluster: { clusterCount: 2, ... } },
  'rock-tile':      { tileCluster: { clusterCount: 3, ... } },
  'indestructible-tile': { tileCluster: { clusterCount: 1, ... } },
  'nebula-tile':    { tileCluster: { clusterCount: 4, ... } },
},
```

What this enables:

- **One file to grep** for "how many tiles of variant X spawn on
  map Y". Before this refactor the answer is split across three
  config blocks plus map-specific code in `MapClasses.ts`.
- **Per-map nebula tuning** falls out for free — today all maps
  share `NEBULA_CONSTANTS.CLUSTER_COUNT`. After the refactor, each
  map's nebula counts are independent.
- **Adding a new map** is one entry in `MAP_POPULATION` plus the
  `MapType` enum and a thin map-class subclass.
- **Adding a new variant** doesn't require touching every map —
  unmentioned variants in `MAP_POPULATION[map]` simply don't spawn
  there.
- **Map-load entity totals** are computable at glance:
  `Object.values(MAP_POPULATION[map]).reduce((sum, e) =>
   sum + (e.freeSpawn?.count ?? 0)
       + (e.tileCluster?.clusterCount ?? 0) * /* avg cluster size */)`.
  ShardSystem (or a one-line helper) can expose this on map load
  to surface in the DBG panel as "expected entity budget".

What stays where:

- Cluster-placement geometry (hex grid, scatter rules,
  no-overlap-with-POI checks) stays in `TileGenerator` and per-map
  `populate()` methods. `MAP_POPULATION` is the *count* config;
  the *placement* remains in code because it's geometry, not data.
- Tile size is still globally constant (`HEX_SIZE` from
  `TileGenerator`); it isn't part of `MAP_POPULATION`.

Migration: Stage 1 lands `MAP_POPULATION` as a new constant
populated with today's values (free-spawn from
`ASTEROID_GENERATION_CONFIG`, nebula from `NEBULA_CONSTANTS`,
glass/reinforced/heavy from extracting the per-map literals in
`MapClasses.ts`). The old constants stay in place until Stage 6
deletes them. Each map's `populate()` is rewritten to read
`MAP_POPULATION[this.type]` instead of inlining counts. No
behavioural change at land time — just centralisation.

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

- **Static-vs-dynamic-grid insertion becomes mass-based.** Today
  the dispatch branches on EntityType (STRUCTURE → static grid,
  ASTEROID → dynamic, NEBULA → static + skip-collision, NEBULA_SHARD
  → skip). After Stage 5: `entity.mass === Infinity ? staticGrid :
  dynamicGrid`, regardless of which variant family the entity
  belongs to. Tiles (any variant) live in static; shards (any
  variant) live in dynamic. One predicate, no per-EntityType
  branches.
- **Collision-impulse skip becomes flag-based.** The today's
  `EntityType.NEBULA / NEBULA_SHARD` skip is replaced by reading
  `SHARD_VARIANTS[entity.shardVariant].passThrough`. Nebula tiles
  set the flag (preserves today's "fly through and shatter" feel);
  no other variant uses it. Mass alone covers nebula shards
  (`mass = 0.01` → negligible striker impulse).
- **Bouncer reflect at `:932`** rewrites to a variant filter:
  reflect iff the target's variant is in
  `{glass-tile, plastic-tile, metal-tile, indestructible-tile,
   glass-shard}`. Today's behaviour preserved — bouncers reflect
  off STRUCTURE tiles + tile-shards (now glass-shards), pass
  through asteroids (now rock-shards) and nebula entities. The
  reflective set lives as a small constant in PhysicsSystem (or
  hangs off the variant config as `reflectsBouncers: true`).
- **`applyLocalGravity`-style code stays where it is.** The new
  shard pull pass lives inside ShardSystem and is driven by
  ShardSystem's own broadphase.
- **Dynamic-grid population** post-§6.C grows on NebulaFieldMap by
  the per-frame nebula-shard count (typically 0–~30 with merge
  cooldown). §9 captures the delta.
- **`addStaticEntity`** — still called by ShardSystem on regen
  completion (today both GameEngine and NebulaSystem call it; the
  refactor centralises the call site).
- **Per-substep ticks** of `nebulaImpactCooldown`,
  `nebulaMergeCooldown`, `nebulaFadeTimer`, `nebulaSpawnTimer`,
  `linearDamping`, `angularDamping` — stay in PhysicsSystem
  (velocity-integration-adjacent ticks, per CLAUDE.md §4
  "Per-entity damping is ticked by PhysicsSystem"). ShardSystem
  **reads** the cooldowns to gate pull/bond eligibility; it
  doesn't decrement them.

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

- **Nebula fast-path gating** at `:1077` flips from
  `entity.type === EntityType.NEBULA` to
  `entity.shardVariant === 'nebula-tile'`. Same cost (single
  string compare instead of EntityType compare), same shape, same
  cache invalidation sites. The nebula slow-path tint compute
  (composition blend + interior-darken multiplier + offscreen
  canvas via `getTintedSprite`) is the only render path expensive
  enough to warrant a per-entity cache, so other variants don't
  opt in. The `renderCache: 'composition'` field on the variant
  schema (§2) reserves the capability for future variants.
- Slow-path cache populate at `:1260–1271` — unchanged in shape;
  the cache fields remain on `GameEntity` (`nebulaCachedTinted /
  Dx / Dy / Size`) and only nebula-tile variants ever populate
  them. Future opt-ins via `renderCache` would generalise the
  populate site.
- **No new render hooks.** The earlier amendment proposed a
  passenger-on-host draw dispatch; per §6.A revision it's been
  dropped. Nebula-shards render at their own positions like any
  other shard. The `'absorb'` outcome's visual side-effect is a
  one-time mutation of the host's `powerupGlowColor` (read by the
  existing glow-render path) plus a `spawnGlimmer` particle burst
  at the absorption point — no new render branches.
- Counter `lastNebulaFastCount` / `lastNebulaSlowCount` — unchanged
  semantics. Cache stays nebula-tile-only.

### `engine/systems/EntityIndex.ts`

- Adds one new prebuilt list: `shardCandidates` — active entities
  with `type === EntityType.STRUCTURE && mass !== Infinity`
  (i.e. all mobile shard variants, post-§6.C unification).
- The existing `asteroids` list either stays as a backwards-compat
  alias filtering by variant family (`shardVariant` ∈
  {rock-shard, glass-shard}) for callers like weapon homing, or
  gets replaced by direct `shardCandidates` filtering at each call
  site — whichever is shorter; deferred until Stage 5/6 sweep.
- The new list is filled by the same single-pass entity walk that
  fills the existing lists — no extra pass.

### `types.ts`

- `ShardType` (`:143`) is **renamed to `ShardVariantId`** with the
  new full member list: glass-tile / plastic-tile / metal-tile /
  indestructible-tile / rock-tile / nebula-tile / rock-shard /
  glass-shard / nebula-shard. The `shardType` field on
  `GameEntity` is renamed to `shardVariant`. A `ShardType` type
  alias and per-renamed-member alias-string lookup live for one
  stage as a migration aid; both are deleted in Stage 6.
- The existing `structureVariant` field merges into
  `shardVariant` — every `structureVariant: 'glass'` becomes
  `shardVariant: 'glass-tile'`, etc. Single source of truth for
  variant identity. Stage 6 deletes `structureVariant`.
- **Zero new fields on `GameEntity`** for the merge architecture.
  The earlier `attachedHostId` field is dropped along with the
  passenger model (§6.A revision). `shardVariant` replaces
  existing fields rather than widening the type.
- **`EntityType.ASTEROID`, `EntityType.NEBULA`,
  `EntityType.NEBULA_SHARD` enum values are all removed in Stage
  6.** After Stage 5, no entity in any system carries them —
  every shard-family entity spawns with `type:
  EntityType.STRUCTURE`. Removal is mechanical (three enum
  entries + remaining dead branches in `NebulaSystem.handleDeath` /
  `handleEntityDeath` / `prepareFrameEntities`).
- Dead optional fields removed in stage 6 (after all code paths
  migrate): expected zero — every field is still used by render,
  physics, or persisted state. We do **not** widen `GameEntity`.

### `constants.ts`

- New `SHARD_VARIANTS` Record appended (the bulk of §4 above).
- New `MAP_POPULATION` Record appended (per §6.E) — central
  per-map per-variant entity-count table.
- `STRUCTURE_VARIANTS` keeps its visual fields (sprite / color /
  borderColor / damage states / `health` / `mass` /
  `indestructible`) keyed by the `-tile`-suffixed ids — those
  stay the source of truth for STRUCTURE-tile rendering. The
  `SHARD_VARIANTS[id]` entries only carry the regen / merge /
  shatter / passThrough / renderCache policy.
- `NEBULA_CONSTANTS` keeps render / palette / fade-rate / drop
  fields; cluster counts (`CLUSTER_COUNT`, `OUTER_*`, etc.) move
  to `MAP_POPULATION` and are deleted from `NEBULA_CONSTANTS` in
  Stage 6.
- `ASTEROID_GENERATION_CONFIG` is deleted in Stage 6 — its data
  lives in `MAP_POPULATION[*]['rock-shard'].freeSpawn`.

### `components/UIOverlay.tsx`

- DBG overlay unchanged in shape. The same `nebulaMs /
  nebulaVisible / nebulaFast / nebulaSlow` numbers continue to
  surface with the same semantics.
- Optional add (Stage 5 or later): a "expected entity budget"
  summary derived from `MAP_POPULATION[currentMap]` — surfaces
  next to the live `Ents` count so it's obvious when the map is
  populating outside its budget. Not a perf gate; a developer
  comfort.

### `engine/maps/MapClasses.ts` and `engine/maps/TileGenerator.ts`

- **`MapClasses.ts`** — every map subclass's `populate()` method
  is rewritten to read `MAP_POPULATION[this.type]` instead of
  inlining counts. Geometry (cluster placement rules, no-overlap-
  with-POI, hex-coord pinning) stays in the subclass. New variant
  spawn dispatch:
    - `freeSpawn` entries → `currentMap.createRockShard(...)`
      (renamed from `createAsteroid`) with the configured count /
      size / speed.
    - `tileCluster` entries → existing `TileGenerator.placeCluster`
      with the configured cluster count / size range, stamping
      the appropriate `shardVariant`.
  Each map's `populate()` becomes a small loop over the entries
  in its `MAP_POPULATION` row.
- **A new map** `RockFieldMap` (`MapType.ROCK_FIELD`) joins the
  single-element showcase set — exercises rock-tile clusters in
  isolation. Tuned to ≈1200 tiles like the other showcases for
  comparable DBG numbers.
- **`TileGenerator.ts`** — adds variant-id parameterisation to
  `createTileEntity` so a single helper produces tiles of any
  variant (today there's `createNebulaTileEntity` and inline
  STRUCTURE-tile creation in `MapClasses`). Same geometry, one
  shape.
- Spawn shapes for **shards** flow through the variant table at
  shatter time only; map init for shards goes through
  `createRockShard` (the renamed `createAsteroid`).

---

## 8. Spec drift identified during planning

`CLAUDE.md` claims that need updating during this branch (all in
the Stage 6 commit):

1. **§2 directory layout** — note `MAP_POPULATION` as a new
   load-bearing config. Add `RockFieldMap` to the map list.
2. **§4 entity-type list** — replace `ASTEROID / NEBULA /
   NEBULA_SHARD` with the single unified shard-family carrier.
   Document `shardVariant` as the variant axis (replaces both
   `shardType` and `structureVariant`).
3. **§6a maps** — add `MapType.ROCK_FIELD`. Document the
   `MAP_POPULATION` per-map record as the source of truth for
   entity counts; flag that adding a new MapType requires an
   entry in both `MAP_POPULATION` and `PLAYER_MOVEMENT_CONFIG`
   (the brief currently calls out the latter only).
4. **§8 gotchas** —
   - Replace the "shardType discrimination" gotcha with a
     pointer to `SHARD_VARIANTS`.
   - Drop "EntityType.NEBULA / NEBULA_SHARD carry pass-through"
     (now expressed via the per-variant `passThrough` flag).
   - Add: "Static vs dynamic grid placement is controlled by
     `mass`: `Infinity` → static, finite → dynamic. Setting a
     tile's mass to a finite value puts it in the dynamic grid
     and lets strikers shove it off its hex coordinate — break
     the regen / neighbour-count / transmutation logic. Use
     `passThrough: true` on the variant for tiles that should
     not bounce strikers."
5. **EntityType naming** — the `STRUCTURE` carrier semantically
   broadened from "destructible walls/blocks" to "any tile or
   shard regardless of substance" (cloud, rock, glass). Rename is
   deferred per direction; left as an inline `// TODO: rename
   this enum value once we settle on a name (MATTER / MATERIAL /
   BODY)` in `types.ts`.

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
| `renderMs` | `render`  | Total render; should be stable across all stages (no new render hooks per §6.A revision) |
| `nebulaMs` | `·neb`    | Nebula render sub-timer; should not regress |
| `nebulaVisible` | `·vis-neb` | Drives nebulaMs's per-tile cost characterisation |
| `nebulaFast / nebulaSlow` | `·neb fast/slow` | Fast-path hit ratio — must not regress (gating predicate flips from EntityType to variant id; same hit pattern) |
| `totalEntities` | `Ents` | Sanity — should be stable across stages 1–4. Stage 5 may show a modest *decrease* on UniverseMap as nebula-shards absorb into max-size glass-shards (compaction removes them) |
| `asteroidCount` | `asteroids` | Sanity for stick-bond / shatter migrations |

### Maps to capture on (in order)

1. **AsteroidFieldMap** (`MapType.ASTEROID_FIELD`) — exercises
   shard accretion / stick-bonds. Sensitive to the `merge` pass
   refactor. Capture also after firing a few rockets to trigger
   shatter and observe the shatter path. Post-Stage-5: every
   asteroid here is a `rock-shard` on `EntityType.STRUCTURE`,
   spawned via `MAP_POPULATION` instead of
   `ASTEROID_GENERATION_CONFIG`.
2. **NebulaFieldMap** (`MapType.NEBULA_FIELD`) — exercises shard
   merge / shard→tile transmutation / fast-path render cache.
   Capture also after smashing through a cluster to trigger
   shatter + merge. Post-Stage-5: nebula shards register in the
   dynamic grid (small `physicsMs` rise expected).
3. **GlassFieldMap** (`MapType.GLASS_FIELD`) — exercises tile
   regen. Capture after smashing a few clusters to populate the
   regen queue, then again 12s later when the queue drains.
4. **RockFieldMap** (`MapType.ROCK_FIELD`, NEW in Stage 5) —
   exercises rock-tile clusters + rock-tile shatter → rock-shard
   spawn. Baselined fresh in Stage 5 (the map doesn't exist
   pre-stage). Tuned to ≈1200 tiles like the other showcases.
5. **UniverseMap** (`MapType.UNIVERSE`) — mixed baseline; the
   only map (besides RockFieldMap on its own terms) where the
   new cross-variant attach behaviour actually fires. Capture
   also after intentionally driving a nebula shard into a rock
   shard (stage 5+ only).

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
| RockFieldMap (Stage 5+ only) | _Stage 5 baseline_ | _Stage 5 baseline_ | _Stage 5 baseline_ |

This baseline is captured from `main` (or the parent commit on this
branch before stage 1) and committed in the stage-1 commit body.

### Post-stage targets

- **Stages 1–4 (refactor only)**: every cell **must match baseline
  ±5%** on `physicsMs / renderMs / nebulaMs`. `nebulaFast/Slow`
  ratio must match exactly (cache invalidation hasn't changed).
  `Ents` exactly matches.
- **Stage 5 (full EntityType collapse + heterogeneous attach)**:
  - On AsteroidFieldMap: must match baseline ±5% across the
    board. The map's rock-shards are now `EntityType.STRUCTURE`
    instead of `EntityType.ASTEROID`, but mass-based dispatch
    routes them to the same dynamic grid with the same
    population — physically equivalent.
  - On GlassFieldMap: must match baseline ±5%. Same story —
    glass tiles still mass=∞ → static grid; static-grid cost
    unchanged.
  - On NebulaFieldMap: `physicsMs` allowed to rise by ≤10%
    steady-state and ≤15% during an active shatter pass —
    nebula shards (now finite mass) register in the dynamic
    grid. All other fields within ±5%. `nebulaFast / Slow`
    ratio must match exactly (the unification flips the fast-
    path gate from EntityType to variant id; same cost, same
    cache hit pattern).
  - On UniverseMap: `physicsMs` allowed to rise by ≤10% during
    the active pass (nebula shards entering the dynamic grid +
    new stick-bond candidates against glass-shards); steady-state
    within ±5%. `nebulaFast / Slow` ratio must not regress (the
    cache is nebula-tile-only; nebula-shards have no per-entity
    tint cache and don't affect the ratio).
  - On RockFieldMap: fresh baseline established at Stage 5.
    Tuned to ≈1200 tiles, target similar `physicsMs` profile to
    GlassFieldMap (both are static-tile-only showcases).
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

### Stage 1 — additive: SHARD_VARIANTS table + ShardSystem skeleton + MAP_POPULATION

- Add `engine/systems/ShardSystem.ts` and `ShardSystem.types.ts`,
  exporting an instance wired into `GameEngine` constructor. The
  skeleton has `update(dt, entities)` and `onDeath(entity)` —
  both no-ops returning defaults that mean "the existing engine
  code should still handle this".
- Add `SHARD_VARIANTS` to `constants.ts` with the per-variant
  configs from §4 — purely data, not yet read. Variant ids use
  the post-rename names (rock-shard / glass-shard / glass-tile /
  rock-tile / etc.).
- Add `MAP_POPULATION` to `constants.ts` per §6.E, populated from
  today's values. Old constants (`ASTEROID_GENERATION_CONFIG`,
  nebula `CLUSTER_COUNT`, in-`MapClasses` literals) stay until
  Stage 6 deletion — Stage 1 only adds the central record.
- Add the `shardCandidates` filter to `EntityIndex` (predicate
  staged: today filters `type === ASTEROID`; flips to `type ===
  STRUCTURE && mass !== Infinity` in Stage 5). For Stage 1 it
  uses today's predicate so the additive change is truly no-op.
- Add a `shardVariant` field to `GameEntity` aliased over the
  existing `shardType` / `structureVariant` (a getter / runtime
  lookup that returns the renamed id from the legacy fields).
  Lets later stages read the variant id without forcing a single
  big sweep. **Zero genuinely-new fields** on `GameEntity` per
  the §6.A revision — the merge architecture reuses existing
  state.

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

### Stage 5 — full EntityType collapse + heterogeneous attach

This is the only stage that introduces new behaviour, and the stage
that lands the §6.C unification across every shard-family entity.
It bundles three changes that share a test surface:

**5a. Mass-based static/dynamic dispatch + passThrough flag**:

- Replace `PhysicsSystem`'s EntityType-keyed insertion branch with
  a mass check: `mass === Infinity → staticGrid`, finite →
  `dynamicGrid`. Today's STRUCTURE / NEBULA tiles all have
  `mass = Infinity`, so static-grid placement is unchanged.
- Replace `PhysicsSystem`'s collision-impulse skip for NEBULA /
  NEBULA_SHARD with a check on
  `SHARD_VARIANTS[entity.shardVariant].passThrough`. Only
  `nebula-tile` sets the flag; behaviour preserved for nebula
  tiles, and `nebula-shard` (now finite mass) goes through
  standard impulse with negligible striker effect.
- Replace bouncer reflect at `PhysicsSystem:932` with the
  variant-id check (reflect iff the target's variant is in the
  glass-family or is a glass-shard).

**5b. EntityType collapse for shards/tiles**:

- Map all live shard-family spawns to `type: EntityType.STRUCTURE`:
  - Free-spawned drifting "asteroid" entities (today
    `EntityType.ASTEROID, shardType: 'asteroid'`) → STRUCTURE,
    `shardVariant: 'rock-shard'`. Same physics, same drift, same
    merge / shatter.
  - Tile shards (today `EntityType.ASTEROID, shardType: 'tile'`)
    → STRUCTURE, `shardVariant: 'glass-shard'`.
  - Nebula shards (today `EntityType.NEBULA_SHARD`) → STRUCTURE,
    `shardVariant: 'nebula-shard'`, `mass = 0.01`.
  - Nebula tiles (today `EntityType.NEBULA`) → STRUCTURE,
    `shardVariant: 'nebula-tile'`, `mass = Infinity`,
    `passThrough = true`.
  - Glass / reinforced / heavy / indestructible tiles stay on
    `EntityType.STRUCTURE`; their `structureVariant` field merges
    into `shardVariant` ('glass' → 'glass-tile', etc.).
- Add `rock-tile` variant: new spawn path in `MapClasses` reads
  `MAP_POPULATION[map]['rock-tile']` and places clusters via
  `TileGenerator.placeCluster` like the other tile families.
- Add new showcase map `RockFieldMap` (`MapType.ROCK_FIELD`) with
  ≈1200 rock tiles; menu button added in `UIOverlay.tsx`.
- Update `EntityIndex.shardCandidates` predicate to its final form
  (`type === STRUCTURE && mass !== Infinity`).
- Update `RenderSystem.ts:1077` fast-path gating from
  `entity.type === NEBULA` to `entity.shardVariant ===
  'nebula-tile'`.
- Update `handleEntityDeath` to dispatch by variant rather than
  EntityType for shard-family entities. The
  `NebulaSystem.handleDeath` ammo-drop roll is keyed on
  `shardVariant === 'nebula-tile' || 'nebula-shard'` (or moved
  to a `spawnsAmmoDrop?: boolean` variant hook).
- All map population reads from `MAP_POPULATION` instead of
  `ASTEROID_GENERATION_CONFIG` / `NEBULA_CONSTANTS` cluster
  fields. Old constants stay in place as orphans until Stage 6.

**5c. Cross-variant absorb behaviour**:

- Edit the `nebula-shard` variant config per §4: widen
  `attractedTo` to `{ include: ['nebula-shard', 'rock-shard',
   'glass-shard'] }` (gravity pull from nebula-shards toward
  every mobile shard variant; pull tuning at today's nebula-
  self-gravity values — range 380, strength 380, min-dist 15).
  Set `bondsWith: { include: ['nebula-shard', 'glass-shard'] }`
  and add the two rules — `{ partner: 'self', outcome:
  'compose' }` and `{ partner: 'glass-shard', outcome:
  'absorb', thresholdScale: 5.0, requirePartnerSizeFraction:
   1.0 }`.
- Pull pass implementation lives in `ShardSystem.merge`'s
  cell-walk per §6.D: for each mobile shard, evaluate
  `selects(va.merge.attractedTo, vb.id)` against neighbours in
  the 3×3 spatial-hash neighbourhood; on match, apply the
  variant's `pullStrength / max(dist, pullMinDist)` force to
  the puller only. Today's NebulaSystem.updateDynamics
  gravity loop is the template; the only change is the per-
  pair selector check (one indirect lookup) and the wider
  candidate set (any mobile shard, not just other nebula-
  shards). No new allocation; existing pre-allocated
  `Map<number, number[]>` cell buckets (§6.D) are reused.
- Implement the `'absorb'` outcome in `ShardSystem.merge`:
  - `consumed.active = false` (compaction sweep removes it).
  - `host.powerupGlowColor = closestPowerupHex(consumed.color
     ?? blendCompositionToHex(consumed.nebulaColorComposition))`,
    blended with any existing host glow via `blendHexColors`.
  - `spawnGlimmer` particle burst at the absorption point
    (reuse `NebulaSystem.spawnGlimmer`).
  - Done. No parenting, no per-frame writeback, no render hook.
- Implement `closestPowerupHex(targetHex)`: pre-tabulate
  `WEAPON_LIST.map(w => ({ rgb: hexToRgb(WEAPONS[w].color), hex:
   WEAPONS[w].color }))` at module init; per-call walk the small
  array with squared-Euclidean RGB distance and return the
  closest hex. ~10 lines total, zero per-call allocations.
- Implement the `requirePartnerSizeFraction` gate in the bond-
  completion path: at threshold, evaluate
  `host.size.x >= SHARD_VARIANTS[shardVariantOf(host)].spawn.sizeMax * gate`.
  If false, the bond persists (cohesion stays active, timer
  caps at threshold) and the next frame re-checks. If true,
  fire the merge.
- Confirm no glass-shard variant changes are needed: glass-shards
  themselves don't `bondsWith` nebula-shards, so the absorb is
  unilateral — driven entirely by the nebula-shard rule.

End state: nebula shards drift along flow paths with glass
clusters, eventually absorbing into the largest piece via a
small visual glow update on the host. Rock-tile clusters appear
on maps that opt in via `MAP_POPULATION`. All shard-family
entities live on one EntityType with mass-based dispatch.
NebulaFieldMap shows a small `physicsMs` rise from nebula shards
entering the dynamic grid (target: ≤10% steady-state, ≤15%
active — per §9). AsteroidFieldMap unchanged. RockFieldMap is
a new map; baselined fresh.

### Stage 6 — delete dead code & spec drift

- Delete `pendingRegens`, `stickBonds`, `mergeEntities`,
  `createAsteroidShards`, `handleEntitySticking`,
  `spawnCompositeAsteroid` from GameEngine.
- Delete `pendingRegens`, `tickRegens`, `spawnShards`,
  `updateDynamics`, `mergeNebulas` from NebulaSystem.
- Drop the `shardType` field on `GameEntity` and the `ShardType`
  type alias; keep only `shardVariant`. Delete `structureVariant`
  (merged into `shardVariant` in Stage 5).
- **Remove `EntityType.ASTEROID`, `EntityType.NEBULA`, and
  `EntityType.NEBULA_SHARD`** from the enum in `types.ts`. Stage
  5 already migrated the live spawns; this is the formal removal
  of the now-unreferenced enum values plus any remaining dead
  branches that referenced them.
- Delete `ASTEROID_GENERATION_CONFIG` from `constants.ts`. Delete
  `CLUSTER_COUNT / MIN_CLUSTER_SIZE / MAX_CLUSTER_SIZE /
  OUTER_*` from `NEBULA_CONSTANTS` (data is now in
  `MAP_POPULATION`).
- Update `CLAUDE.md`:
  - §2 directory layout: note that EntityType list narrows; add
    the `MAP_POPULATION` constant.
  - §4 entity-type list: replace `ASTEROID / NEBULA / NEBULA_SHARD`
    with the unified `STRUCTURE` carrier. Document the
    `shardVariant` field as the variant axis. Drop `shardType`
    and `structureVariant` from the field-categories list.
  - §6a maps: document `MapType.ROCK_FIELD` and the
    `MAP_POPULATION` per-map table.
  - §8: replace the "shardType discrimination" gotcha with a
    pointer to `SHARD_VARIANTS`. Add a "static-vs-dynamic via
    mass" gotcha. Drop the "EntityType.NEBULA carries
    pass-through" gotcha (now expressed via the variant flag).
- Sweep for dead optional fields on `GameEntity` (expected zero
  net removals; the cache fields stay on the entity because
  the renderer still uses them).

End state: net line reduction in `GameEngine.ts`, `NebulaSystem.ts`,
and `constants.ts`. EntityType union shrinks by 3. Behaviour
matches stage 5.

---

## 11. Approval gate

This document is the Phase 1 deliverable. Phase 2 implementation
**does not begin** until the recommendations in §6 are explicitly
approved (or amended). Each stage in §10 lands in its own commit on
`claude/shard-system-overhaul-ihtzu`.




