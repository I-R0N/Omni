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
  | 'reinforced-tile'
  | 'heavy-tile'
  | 'indestructible-tile'
  | 'rock-tile'
  | 'nebula-tile'
  // Mobile shard variants (dynamic grid, finite mass)
  | 'rock-shard'
  | 'glass-shard'
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
   *  Replaces the EntityType.NEBULA / NEBULA_SHARD pass-through
   *  branch that exists today.  Striker velocity is unchanged on
   *  contact; the variant still takes damage and may shatter.  Only
   *  the nebula-tile variant uses this. */
  passThrough?: boolean;
  /** Render fast-path opt-in.  Today only nebula-tile populates the
   *  per-entity tinted-canvas cache (`nebulaCachedTinted`); the
   *  RenderSystem fast-path gating flips from EntityType-keyed to
   *  variant-id-keyed in Stage 5. */
  renderCache?: 'none' | 'composition';
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
   *  field.  Today this lives on ASTEROID_GENERATION_CONFIG. */
  speedMultiplier?: number;
  /** Optional spawn radius constraint — entities seed within this
   *  distance of map centre.  Today this lives on
   *  ASTEROID_GENERATION_CONFIG. */
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

// ── Variant-specific completion hook ────────────────────────────────
// Stage 2: the nebula-tile regen path needs neighbourhood-aware
// composition rewrite + cache invalidation + neighbour-counts dirty
// bookkeeping at completion.  ShardSystem invokes this hook only
// when the regen variant's `rewriteColor === 'neighborhood-blend'`,
// keeping non-nebula regens free of any nebula-specific work.
//
// NebulaSystem implements this; ShardSystem accepts it via
// constructor (optional — null-adapter is treated as a no-op so
// non-nebula regens still work).  Other future hooks can extend
// this interface without changing ShardSystem call sites.

export interface ShardRegenAdapter {
  /**
   * Called after ShardSystem revives an entity, when the variant's
   * regen.rewriteColor === 'neighborhood-blend'.  The implementation
   * is responsible for whatever variant-specific completion work is
   * needed (composition rewrite, cache invalidation, grid-index
   * update, neighbour-counts-dirty flagging).
   */
  onNeighborhoodBlendRegen(entity: import('../../types').GameEntity, entities: import('../../types').GameEntity[]): void;
}

