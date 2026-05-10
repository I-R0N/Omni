// ShardSystem schema interfaces.  See docs/SHARD_SYSTEM.md for the
// full design rationale.  This file defines the data shapes only —
// the system implementation lives in ShardSystem.ts and the variant
// table itself in constants.ts as SHARD_VARIANTS.
//
// The schema mirrors STRUCTURE_VARIANTS / ENEMY_VARIANTS — a frozen
// Record<id, def> consumed by switches inside the shared system.
// No callbacks; behavioural axes are named fields.

import { EntityType } from '../../types';

// ── Variant ids ─────────────────────────────────────────────────────
// Every shard-family entity (tile or shard, glass or rock or nebula)
// declares its variant via a `shardVariant` field on GameEntity.
// Adding a new variant ("ice", "crystal") is one new id plus a
// SHARD_VARIANTS entry.

export type ShardVariantId =
  // STRUCTURE-tile variants (static, hex-clustered, mass = ∞)
  | 'glass-tile'
  | 'plastic-tile'
  | 'metal-tile'
  | 'indestructible-tile'
  | 'rock-tile'
  | 'nebula-tile'
  // Mobile shard variants (dynamic grid, finite mass)
  | 'rock-shard'
  | 'glass-shard'
  | 'plastic-shard'
  | 'metal-shard'
  | 'nebula-shard';

// ── Carrier EntityType ──────────────────────────────────────────────
// All shard-family entities live on a single carrier per the §6.C
// decision in docs/SHARD_SYSTEM.md.  The static-vs-dynamic axis is
// encoded by `mass` (Infinity → static grid, finite → dynamic grid);
// pass-through is encoded by the variant's `passThrough` flag.
//
// TODO: rename EntityType.STRUCTURE — the semantic broadened from
// "destructible walls/blocks" to "any tile or shard regardless of
// substance" (cloud, rock, glass).  Candidates: MATTER / MATERIAL /
// BODY.  Deferred per direction.

export type ShardCarrier = EntityType.STRUCTURE;

// ── Variant selectors ───────────────────────────────────────────────
// Used by the merge policy to declare which other variants a puller
// is attracted to and / or bonds with.  Evaluated O(1) against an id.

export type VariantSelector =
  | 'none'
  | 'self'
  | 'all'
  | { include: ShardVariantId[] }
  | { exclude: ShardVariantId[] };

// ── Merge outcomes ──────────────────────────────────────────────────
// 'compose'  — both same variant: one larger entity of this variant.
// 'absorb'   — smaller entity → inactive; larger entity logs a small
//              visual side-effect (e.g. nebula-shard absorbed into a
//              glass-shard sets the glass-shard's powerupGlowColor).
//              Two flat entities merging via the standard stick-bond
//              mechanism — no parenting, no passenger model.

export type MergeOutcome = 'compose' | 'absorb';

// ── Per-pair merge rule ─────────────────────────────────────────────
// The puller's merge.rules is walked by the resolver (see §3) to find
// the rule that applies to a given pair.  Falls back to defaultOutcome
// if no rule matches.

export interface MergeRule {
  /** 'self' = same-variant pair; otherwise the partner's variant id. */
  partner: ShardVariantId | 'self';
  outcome: MergeOutcome;
  /** Multiplier on the pair's bond seconds.  Defaults to 1. */
  thresholdScale?: number;
  /** Optional gate: rule only fires once partner has grown to at least
   *  this fraction of its variant's spawn.sizeMax.  Default 0 — no
   *  gate.  Used by nebula-shard's absorb rule against glass-shard
   *  (set to 1.0) to keep absorption a relatively unique event while
   *  cohesion + floating-along stays common. */
  requirePartnerSizeFraction?: number;
}

// ── Spawn shape (used by the shatter policy) ────────────────────────
// Tile variants don't use these fields directly — tiles spawn through
// TileGenerator at HEX_SIZE.  Shatter children for any variant pull
// their polygon shape and mass from here.

export interface ShardSpawnShape {
  sizeMin: number;
  sizeMax: number;
  polyVerticesMin: number;
  polyVerticesMax: number;
  /** Per-vertex angle jitter strength, fraction of (2π / verts). */
  angleJitter: number;
  /** Radial range for jitter, fraction of base radius. */
  radiusMin: number;
  radiusRange: number;
  /** mass = sizeToMass(diameter).  Default for asteroid / tile-shard
   *  is `d => d`; nebula-shard overrides to `() => 0.01` (negligible
   *  striker impulse).  Tiles are mass = Infinity (passed in by the
   *  caller, not via this fn). */
  sizeToMass: (diameter: number) => number;
}

// ── Regen policy ────────────────────────────────────────────────────

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
  /** Optional rule-based colour rewrite at completion (nebula uses
   *  this).  Implementation lives in NebulaSystem and is invoked by
   *  ShardSystem on regen completion when set to neighborhood-blend. */
  rewriteColor?: 'none' | 'neighborhood-blend';
}

// ── Merge policy ────────────────────────────────────────────────────

export interface ShardMergePolicy {
  /** Gravity-pull candidate set.  'none' disables pull. */
  attractedTo: VariantSelector;
  pullRange?: number;
  pullStrength?: number;
  pullMinDist?: number;

  /** Contact-stick candidate set.  'none' disables bond formation. */
  bondsWith: VariantSelector;
  /** Base seconds-to-merge for a min-size pair.  Scaled by size at
   *  resolution time per the bondTimeSize* fields below. */
  bondTimeSeconds?: number;
  bondTimeSizeRef?: number;
  bondTimeSizePower?: number;

  /** Per-pair outcome; falls back to defaultOutcome if no rule matches. */
  rules?: MergeRule[];
  defaultOutcome: MergeOutcome;

  /** Cooldown before a freshly-spawned or freshly-merged entity may
   *  participate in another merge.  Today: nebulaMergeCooldown. */
  postMergeCooldown?: number;
}

// ── Shatter policy ──────────────────────────────────────────────────

export interface ShardShatterPolicy {
  kind: 'none' | 'powerlaw';
  /** Output count — for nebula today: 2..3, for asteroid: 2..5. */
  countMin: number;
  countMax: number;
  /** Power-law alpha range.  damageNorm 0 → alphaMin, 1 → alphaMax. */
  alphaMin: number;
  alphaMax: number;
  /** Variant the children belong to. */
  childVariant: ShardVariantId;
  /** Fraction of impact speed inherited by scatter. */
  forwardDrag: number;
  perpScatter: number;
  /** Half-cone of scatter spread, radians. */
  scatterHalfCone: number;
  /** Optional birth-time fade-in (nebula uses this). */
  fadeInSeconds?: number;
  /** Optional merge cooldown stamped on each child. */
  postShatterMergeCooldown?: number;
  /** Shatter geometry strategy.  Two flavours today:
   *
   *    'asteroid' — children scattered in a cone around the impact
   *                 direction, count and area driven by impact damage,
   *                 each child sized via power-law over the parent's
   *                 area budget.  Used by rock/glass/tile-family.
   *    'nebula'   — children spawned in a rear-cone fan behind the
   *                 striker, tangent-rule spin, parallel/perp velocity
   *                 model, fixed count regardless of damage, child
   *                 area = GLASS_TILE_HALF² (constant) so shards are
   *                 visually small regardless of parent tile size.
   *
   *  Only meaningful when `kind === 'powerlaw'`.  Variants with
   *  `kind === 'none'` ignore this field. */
  style?: 'asteroid' | 'nebula';
}

// ── Density compaction policy ───────────────────────────────────────
// Generalizes the "merge clusters into fewer, denser-but-smaller
// entities" mechanism across mobile shard families.  When
// `density` is present and `enabled`, the variant participates in
// density compaction — successful compose merges produce a single
// output shard whose mass and damage value are the sum of inputs,
// whose density tier is one above the larger input (capped at
// `maxSteps`), and whose physical size is slightly smaller than the
// larger input ("denser but smaller").  The same shrink path is
// reused for single-input large-shard collapse when an entity's
// size meets `largeShardCollapseSize`.
//
// Tier 0 must match the variant's pre-density visual exactly so
// existing screenshots / videos read the same.  The tint ramp
// darkens proportionally with tier, capped at `tintFloor` (RGB
// multiplier at max tier) to keep shards readable against the
// active background palette.

export interface ShardDensityPolicy {
  /** Variant participates in density compaction when true.  When
   *  false (or `density` absent) compose follows the legacy
   *  area-conserving grow path. */
  enabled: boolean;
  /** Maximum density tier a shard can climb to.  Once tier ===
   *  maxSteps the entity refuses further density merges (the merge
   *  pair stays separate); pull / cohesion / non-density merges
   *  still apply. */
  maxSteps: number;
  /** Combined-area floor below which a density merge is skipped.
   *  Stops trivial sub-pixel shards from cascading.  Compared
   *  against (sizeA² + sizeB²) for compose, against (size²) alone
   *  for large-shard collapse. */
  areaThreshold: number;
  /** Diameter at/above which a shard collapses inward in the next
   *  ShardSystem tick (single-input density step).  Used to compress
   *  freshly-spawned giant rocks into the field's denser-but-smaller
   *  baseline. */
  largeShardCollapseSize: number;
  /** Per-channel RGB multiplier at max tier (e.g. 0.55 = 45 %
   *  darker).  Tier 0 multiplier is always 1.0 (no change).
   *  Linearly interpolates from 1 → tintFloor across tiers. */
  tintFloor: number;
  /** Output diameter = max(inputs).size × shrinkFactor.  Below 1
   *  to enforce the "smaller-but-denser" rule.  Typical: 0.85–0.92. */
  shrinkFactor: number;
}

// ── Variant definition ──────────────────────────────────────────────

export interface ShardVariantDef {
  id: ShardVariantId;
  carrier: ShardCarrier;
  spawn: ShardSpawnShape;
  regen: ShardRegenPolicy;
  merge: ShardMergePolicy;
  shatter: ShardShatterPolicy;
  /** Hooks delegated to existing systems; the variant config does
   *  not re-implement drops or particles. */
  onShatterParticles?: 'inherit' | 'none' | { color: string; count: number };
  spawnsDropsOnDeath: boolean;
  /** When true, PhysicsSystem skips collision impulse on contact.
   *  Replaces the legacy nebula-only pass-through
   *  branch that exists today.  Striker velocity is unchanged on
   *  contact; the variant still takes damage and may shatter.  Only
   *  the nebula-tile variant uses this. */
  passThrough?: boolean;
  /** Render fast-path opt-in.  Today only nebula-tile populates the
   *  per-entity tinted-canvas cache (`nebulaCachedTinted`); the
   *  RenderSystem fast-path gating flips from EntityType-keyed to
   *  variant-id-keyed in Stage 5. */
  renderCache?: 'none' | 'composition';
  /** Density compaction policy.  Absent (or `enabled: false`) opts
   *  the variant out of the smaller-but-denser merge / collapse
   *  pipeline; legacy compose math continues to apply.  Today set
   *  on rock-shard, glass-shard, nebula-shard. */
  density?: ShardDensityPolicy;
  /** Per-tile additive glow visual.  When set, RenderSystem's
   *  static-tile draw loop (layer 2b) fills the polygon with `color`
   *  at alpha = `peakAlpha * entity.glowIntensity`.  Activation is
   *  externally driven — whatever system owns the trigger writes
   *  `glowIntensity` (0..1) on the entity each frame and resets it
   *  next frame.  `range` is informational metadata for trigger
   *  systems that compute a quadratic-falloff `glowIntensity`
   *  relative to a source position; the renderer itself does not
   *  read it.  Unset on every variant today — (g2) populates it
   *  for the variants that should glow. */
  glow?: {
    /** Glow color when fully lit, hex string. */
    color: string;
    /** Range over which the glow falls off, world units.  Used by
     *  external trigger systems; not read by the renderer. */
    range: number;
    /** Quadratic-falloff peak alpha (0..1) — multiplied by
     *  `entity.glowIntensity` to produce the rendered alpha. */
    peakAlpha: number;
  };
  /** Dent-in-place policy.  When set, the variant deforms in its grid
   *  cell on each damage event instead of shattering — polygon
   *  vertices are pushed inward (random magnitude × `vertexJitter` of
   *  current size) and the entity's collision size shrinks by
   *  `scalePerHit`.  When health hits 0 the tile detaches, becomes a
   *  single mobile shard of `breakChildVariant` at the current dented
   *  size, and skips the variant's `shatter` policy entirely.  Dent
   *  variants do NOT regen.  Today: plastic-tile (deforms heavily),
   *  metal-tile (deforms slowly).  Glass / indestructible / rock /
   *  nebula tiles leave this unset and continue to shatter or
   *  passthrough on death. */
  dent?: {
    /** Multiplier on entity.size and polygon scale per damage event.
     *  Plastic ~0.7 (visibly squashes), metal ~0.85 (subtle). */
    scalePerHit: number;
    /** Per-vertex inward perturbation magnitude as a fraction of
     *  current size.  Random offset is drawn each hit; cumulative.
     *  Plastic ~0.18 (warps a lot), metal ~0.06 (barely warps). */
    vertexJitter: number;
    /** Variant id of the mobile shard spawned when the tile detaches.
     *  Must be a member of ShardVariantId — typically the matching
     *  '${material}-shard'. */
    breakChildVariant: ShardVariantId;
  };
}

// ── Map population entry ────────────────────────────────────────────
// MAP_POPULATION (in constants.ts) maps MapType → variant id → one of
// these shapes.  freeSpawn is for mobile variants seeded into open
// space at map init (today's drifting asteroids); tileCluster is for
// static-tile variants placed in hex-grid clusters.  Exactly one of
// the two is set per (map, variant) entry.

export interface FreeSpawnConfig {
  /** Number of entities to spawn at map init. */
  count: number;
  minSize: number;
  maxSize: number;
  /** Multiplier on the spawn-time velocity from the analytical flow
   *  field.  Today this lives on MAP_POPULATION. */
  speedMultiplier?: number;
  /** Optional spawn radius constraint — entities seed within this
   *  distance of map centre.  Today this lives on
   *  MAP_POPULATION. */
  spawnRadius?: number;
}

export interface TileClusterConfig {
  /** Number of clusters. */
  clusterCount: number;
  /** Tiles per cluster (range). */
  minClusterSize: number;
  maxClusterSize: number;
  /** Optional second pass of clusters at a different scale (used
   *  today by nebula's OUTER_* fields). */
  outer?: { clusterCount: number; minClusterSize: number; maxClusterSize: number };
}

export interface PerMapVariantSpawn {
  freeSpawn?: FreeSpawnConfig;
  tileCluster?: TileClusterConfig;
}

// ── Variant-specific completion hooks ──────────────────────────────
// Stage 2: nebula-tile regen needs neighbourhood-aware composition
// rewrite + cache invalidation + grid-index update.
// Stage 4: nebula-shard 'compose' merges need a transmutation check
// (when accumulated effective area ≥ HEX_AREA, replace the merged
// shard with a new nebula-tile at the nearest free hex cell).
//
// ShardSystem invokes these hooks only for the relevant variants /
// outcomes; non-nebula entities never call into the adapter.
//
// NebulaSystem implements this; ShardSystem accepts it via
// constructor (optional — null-adapter is treated as a no-op so
// non-nebula regens / merges still work).

export interface ShardAdapter {
  /**
   * Regen-completion hook.  Called when the variant's
   * regen.rewriteColor === 'neighborhood-blend' (today: nebula-tile).
   */
  onNeighborhoodBlendRegen(entity: import('../../types').GameEntity, entities: import('../../types').GameEntity[]): void;

  /**
   * Compose-completion hook for nebula-shard self-compose.  After
   * two nebula-shards merge, the host's accumulated nebulaTileArea
   * may have crossed HEX_AREA — at which point a new nebula-tile
   * is spawned at the nearest free hex cell and the host shard
   * dissolves.  The implementation lives in NebulaSystem
   * (`tryTransmuteShardToTile`) since it depends on hex coords +
   * nebula tile creation + the static grid; ShardSystem just
   * invokes it via this hook for variants whose merge.rules
   * compose-outcome targets the nebula-shard variant.  PhysicsSystem
   * is passed through because the implementation queries the
   * static grid for cell occupancy and adds the new tile to it.
   */
  onComposeNebulaShard(
    host: import('../../types').GameEntity,
    entities: import('../../types').GameEntity[],
    physics: import('./PhysicsSystem').PhysicsSystem,
  ): void;
}

// Backwards-compat alias for the Stage 2 type name.  Removed in Stage 6.
export type ShardRegenAdapter = ShardAdapter;

