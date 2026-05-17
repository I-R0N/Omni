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
  /** When set, overrides polyVerticesMin/Max with a discrete list of
   *  allowed vertex counts (one is picked uniformly per spawn).  Used
   *  for variants that should snap to specific counts rather than fill
   *  a continuous range — today rock-shard uses [5, 7, 9] and
   *  metal-shard uses [6, 8, 10] to keep the silhouettes distinct
   *  from each other and from glass / plastic. */
  polyVerticesOptions?: number[];
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
  /** Per-tile proximity glow visual.  When set, RenderSystem draws a
   *  fill (and, for glass-tile only, an edge stroke) on the static
   *  tile at alpha = `peakAlpha × intensity`, where intensity is the
   *  quadratic-falloff value `(1 − dist/range)²` of the player's
   *  distance to the tile — computed inline by RenderSystem
   *  (`renderProximityBloom` / glass-family layer 2b), not by an
   *  upstream pass.  The same `range` drives the repel field's
   *  falloff in PhysicsSystem when `repel` is also set, so the
   *  visual halo and the push footprint align by construction. */
  glow?: {
    /** Glow color when fully lit, hex string.  This is the base /
     *  "warm-up" layer (e.g. orange for metal). */
    color: string;
    /** Range over which the glow falls off, world units.  Player
     *  distance ≥ `range` → no glow drawn. */
    range: number;
    /** Quadratic-falloff peak alpha (0..1) — multiplied by the
     *  per-tile intensity to produce the rendered alpha. */
    peakAlpha: number;
    /** Optional second "hot core" layer painted ON TOP of the base
     *  layer once the base intensity (the quadratic falloff value,
     *  0..1) climbs past `threshold` — mimics metal heating: orange
     *  first, then red sneaking in over the hottest part of the
     *  field.  The hot layer's own intensity ramps linearly from 0
     *  at `threshold` to 1 at full base intensity, and is rendered
     *  at `peakAlpha × hotIntensity`.  Today: metal-tile only. */
    hot?: {
      /** Hot-core color, hex string (e.g. red). */
      color: string;
      /** Base-intensity value (0..1) at which the hot layer starts
       *  ramping in.  Typical ~0.55 — the red appears only over the
       *  inner, hottest portion of the field. */
      threshold: number;
    };
  };
  /** Outward repel field emitted by the variant's tiles.  Range MUST
   *  stay ≤ 2 × SPATIAL_GRID_SIZE (240) so the static-grid 5×5 outer-
   *  ring scan in PhysicsSystem.handleEntityCollisions reaches every
   *  affected pair.  `strength` is the per-substep velocity delta at
   *  the tile centre; falloff is quadratic to zero at `range` —
   *  `accel = strength * (1 - dist/range)² * timeScale`.  Per
   *  PhysicsSystem rules, projectiles and particles are exempt
   *  unconditionally; mobile-shard variants whose `repelImmune` is
   *  true also drift through the field unimpeded. */
  repel?: { range: number; strength: number };
  /** Variants whose tiles / shards should drift through any `repel`
   *  field — i.e. the same substance as the emitter, so it doesn't
   *  push itself.  Today: glass-shard, plastic-shard.  Projectiles
   *  and particles are exempt regardless of this flag.  Use
   *  `repelImmuneFrom` below for narrower per-emitter immunity. */
  repelImmune?: boolean;
  /** Per-emitter repel immunity — variants whose `repel` field this
   *  variant ignores while still feeling every other emitter.
   *  Implies `repelImmune` for the listed emitters only.  Today:
   *  metal-shard ignores glass-tile (metal "wins" against glass —
   *  see g3 material-interactions design), but still feels the
   *  metal-tile field for the queued attraction work. */
  repelImmuneFrom?: ShardVariantId[];
  /** Pass-through-and-shatter rule (g3 material-interactions).  When
   *  this variant contacts an entity whose variant id is in `targets`,
   *  PhysicsSystem skips collision impulse on the pair (the carrier's
   *  HP and trajectory are unchanged) and immediately triggers the
   *  target's death pipeline — same path the target takes when its
   *  health hits 0 normally, so existing shatter / tier-chain /
   *  drop logic is reused as-is.  Today: metal-shard targets
   *  glass-tile + glass-shard. */
  passthroughShatter?: { targets: ShardVariantId[] };
  /** Dent-in-place policy.  When set, the variant deforms in its grid
   *  cell on each damage event instead of shattering — polygon
   *  vertices are pulled inward by a random fraction in
   *  [0, vertexJitter] of their current radius (toward the polygon
   *  centroid).  The tile's `entity.size` is deliberately NOT touched
   *  so collision footprint stays stable while the visible silhouette
   *  crumples asymmetrically.  When health hits 0 the tile detaches
   *  and spawns the shards listed in `breakShards` (each at a fraction
   *  of the tile's original size, all sharing the dented polygon
   *  shape scaled to fit) and skips the variant's `shatter` policy
   *  entirely.  Dent variants do NOT regen.  Today: plastic-tile and
   *  metal-tile.
   *
   *  Hits-to-break is driven by the variant's STRUCTURE_VARIANTS
   *  health value (a plain HP integer), so adjusting hardness is one
   *  edit there.  Per-hit deformation magnitude differentiates the
   *  materials visually — plastic uses higher vertexJitter than
   *  metal even when their HP matches. */
  dent?: {
    /** Per-vertex inward pull magnitude as a fraction of current
     *  radius.  Random magnitude in [0, vertexJitter] is drawn for
     *  each vertex each hit; cumulative.  Plastic ~0.25 (visibly
     *  warps each hit), metal ~0.13 (subtle per-hit change).  Only
     *  used when `kind` is 'pull'. */
    vertexJitter: number;
    /** Strategy for the per-hit deformation.  Default 'pull' (used
     *  by plastic / metal / their shards): the vertex closest to
     *  the impact direction is pulled inward, polygon shrinks
     *  asymmetrically while the vertex count stays at 6.
     *  'triangle-delete' (used historically by rock-tile): the
     *  closest vertex is REMOVED from the polygon — the two adjacent
     *  vertices stay, forming a new flat edge where the corner used
     *  to be — and a triangle-shaped shard (the deleted corner) is
     *  released at that location. */
    kind?: 'pull' | 'triangle-delete';
    /** When kind === 'pull' (or unset), how many adjacent polygon
     *  vertices to pull inward per damage event.  Default 1
     *  (plastic / metal — pull the closest vertex only).  Rock uses
     *  3 so each hit deforms a wider region (closest vertex + its
     *  two immediate neighbours), creating multiple inverted angles
     *  along one side of the polygon — reads as a fractured-stone
     *  surface rather than a single dimple.  Indices are distributed
     *  symmetrically around the closest vertex (for N=3:
     *  bestIdx - 1, bestIdx, bestIdx + 1; wrapped modulo polygon
     *  length).  Each pulled vertex gets its own random jitter so
     *  the pulls aren't uniform. */
    pullVertexCount?: number;
    /** Multiplier on vertexJitter applied to vertices in the
     *  "deep-pull" subset of the pulled set.  Default 1 (same
     *  jitter as everyone).  Rock uses ~10 so deep-pull vertices
     *  warp dramatically (effective jitter up to ~2.0, clamped by
     *  the K_MIN floor inside applyDentStep) while non-deep
     *  neighbours add softer side warp — reads as a brittle /
     *  jagged fracture compared to plastic / metal's uniform pull.
     *  Which vertices are "deep" is controlled by deepVertexCount
     *  below; the closest-to-impact vertex is always one of them. */
    centerVertexJitterMul?: number;
    /** How many of the pulled vertices receive the
     *  centerVertexJitterMul boost.  Default 1 (just the closest-
     *  to-impact vertex).  Rock uses 2 so each hit produces two
     *  deep notches — the impact vertex plus one randomly-chosen
     *  vertex from the rest of the pulled set — for a more chaotic
     *  brittle fracture pattern.  Capped at pullVertexCount; when
     *  deepVertexCount === pullVertexCount, every pulled vertex
     *  gets the boost (uniform deep pull). */
    deepVertexCount?: number;
    /** Optional shard released on every hit, IN ADDITION TO the
     *  on-death breakShards.  Sized like breakShards entries
     *  (linear sizeFraction × deformed diameter) but spawned at the
     *  impact world position rather than the tile centre.  Today
     *  rock uses this so each hit visibly chips a rock-shard off
     *  the tile (the deformation makes room for it) without
     *  removing any vertex from the polygon. */
    perHitShard?: {
      variant: ShardVariantId;
      sizeFraction: number;
    };
    /** Rotation in radians applied to the impact direction before
     *  searching for the vertex to deform.  0 (default) deforms the
     *  vertex closest to the impact; Math.PI/2 deforms the
     *  perpendicular side; Math.PI deforms the far side. */
    dentVertexAngleOffset?: number;
    /** Optional one-off shard releases that fire WHILE the tile is
     *  still alive in the grid, triggered the first time `health /
     *  maxHealth` falls below the entry's `healthFraction` threshold.
     *  Sized like breakShards (linear sizeFraction × deformed
     *  diameter). */
    intermediateShards?: Array<{
      healthFraction: number;
      variant: ShardVariantId;
      sizeFraction: number;
    }>;
    /** Mobile shards spawned when the tile detaches.  `sizeFraction`
     *  is a LINEAR multiplier on the deformed tile's effective
     *  diameter (2 × avgVertexRadius of the dented polygon).  At
     *  sizeFraction = 1.0 the shard's diameter equals the deformed
     *  tile's diameter, so its area matches the deformed tile.
     *  For a two-shard split that should sum to the deformed area,
     *  pick sizeFractions whose squares sum to 1.0 (e.g. sqrt(2/3)
     *  and sqrt(1/3) → ~0.816 and ~0.577 for a 2:1 area split).
     *
     *  Each shard's polygon shape defaults to the variant's spawn
     *  config (e.g. 4 vertices for plastic, 6/8/10 for metal) so
     *  detached shards have a consistent material silhouette.  When
     *  `inheritParentPolygon: true`, the shard instead clones the
     *  parent tile's dented polygon scaled by `sizeFraction` — used
     *  today by metal-tile so the freed shard's silhouette matches
     *  the deformed tile exactly.  Spawned with a small radial
     *  spread so multiple shards don't pile up at the tile centre.
     *  For 'triangle-delete' variants, the first entry's `variant`
     *  is also used as the variant for per-hit triangle shards. */
    breakShards: Array<{
      variant: ShardVariantId;
      sizeFraction: number;
      /** When true, the spawned shard clones the parent tile's dented
       *  polygon (scaled by sizeFraction) rather than generating a
       *  fresh material-silhouette polygon from the variant's spawn
       *  config.  Use for "the shard IS the broken tile" effects. */
      inheritParentPolygon?: boolean;
    }>;
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
   * Pair-transmute hook fired after a nebula-shard ↔ nebula-shard
   * bond resolves.  ShardSystem has already faded both source shards
   * and computed the blended palette + midpoint; this hook spawns
   * the output (50/50 nebula-tile at nearest free hex vs. glass-
   * shard at the midpoint).  Lives in NebulaSystem because the tile
   * path depends on hex coords + static-grid occupancy checks.
   */
  onComposeNebulaShardPair(
    composition: import('../../types').NebulaColorStop[] | undefined,
    position: import('../../types').Vector2,
    velocity: import('../../types').Vector2,
    entities: import('../../types').GameEntity[],
    physics: import('./PhysicsSystem').PhysicsSystem,
  ): void;
}

// Backwards-compat alias for the Stage 2 type name.  Removed in Stage 6.
export type ShardRegenAdapter = ShardAdapter;

