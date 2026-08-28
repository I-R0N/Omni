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
//              Merging is same-material only, so compose is the sole
//              outcome today.  The field is kept as the extension seam
//              for future per-pair outcomes.

export type MergeOutcome = 'compose';

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
  /** Optional per-entity damping stamped at spawn time.  When set,
   *  spawn sites copy these onto the entity so PhysicsSystem.update
   *  ticks them via the existing per-entity damping path (gated by
   *  `entity.linearDamping !== undefined`).  Today metal-assembly
   *  uses this so locked composite cells share the same damping.
   *  Nebula-shards use NEBULA_CONSTANTS values stamped directly at
   *  spawn — they predate this field.  Values are per-second decay
   *  factors — PhysicsSystem applies them via
   *  `Math.pow(damping, timeScale)`. */
  linearDamping?: number;
  angularDamping?: number;
  /** Optional per-entity speed/spin floor stamped at spawn time.
   *  PhysicsSystem snaps |velocity| below this threshold to zero
   *  each substep so tiny residual drifts don't keep the shard
   *  alive.  When unset, the entity falls back to
   *  NEBULA_CONSTANTS.REST_SPEED / REST_SPIN. */
  restSpeed?: number;
  restSpin?: number;
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
  /** Inner annulus boundary — when set, the pull pass ignores
   *  targets whose centre-to-centre distance is BELOW this value.
   *  Together with pullRange this defines an annular ring in which
   *  the puller seeks targets; inside the ring the pull turns off
   *  entirely so bond cohesion (and physics contact) handle the
   *  close-range case without competing with gravity acceleration.
   *  Undefined → 0 → today's behaviour (full disc from contact to
   *  pullRange).  Plastic-shard sets a non-zero value so its heavy
   *  attractedTo gravity hands off cleanly to bond cohesion at
   *  contact distance. */
  pullInnerRange?: number;

  /** Contact-stick candidate set.  'none' disables bond formation. */
  bondsWith: VariantSelector;
  /** Base seconds-to-merge for a min-size pair.  Scaled by size at
   *  resolution time per the bondTimeSize* fields below. */
  bondTimeSeconds?: number;
  bondTimeSizeRef?: number;
  bondTimeSizePower?: number;

  /** Per-partner overrides for bonds.  When a bond resolves a partner
   *  variant id listed here, the entry's fields override the variant
   *  defaults.  Pairs not listed use the variant defaults (default
   *  strength, compose-on-mature).  Used by plastic-shard to bond
   *  cohesion-only with mixed-strength partners (glass = strong, the
   *  rest = default). */
  bondPartners?: ReadonlyArray<BondPartnerConfig>;

  /** Size-disparity gate on bond FORMATION.  When set (> 0), a pair
   *  whose radii differ by less than this fraction of the larger radius
   *  refuses to bond — forcing "smaller merges into larger" by rejecting
   *  near-equal pairs.  Symmetric: applied regardless of which side is
   *  the puller.  Read by ShardSystem's bond-formation pass; NO variant
   *  sets it today (the plastic-shard use the reader's comment names was
   *  tuned away), so the gate is inert until one does.  Declared here
   *  rather than deleted so the lever stays available and typed. */
  requireSizeDeltaFraction?: number;

  /** Per-pair outcome; falls back to defaultOutcome if no rule matches. */
  rules?: MergeRule[];
  defaultOutcome: MergeOutcome;

  /** Cooldown before a freshly-spawned or freshly-merged entity may
   *  participate in another merge.  Today: nebulaMergeCooldown. */
  postMergeCooldown?: number;
}

/** Per-partner bond override entry.  See ShardMergePolicy.bondPartners. */
export interface BondPartnerConfig {
  partner: ShardVariantId;
  /** When true, the bond NEVER matures into compose — it persists
   *  indefinitely for cohesion + threshold-pull behaviour only.
   *  Used for sticky pairs that should not transmute upward. */
  cohesionOnly?: boolean;
  /** Cohesion tier — 'strong' bumps the velocity-blend rate and the
   *  break-factor (slower to detach) vs the 'default' tier.  Today:
   *  plastic-shard ↔ glass-tile / glass-shard use 'strong'. */
  strength?: 'strong' | 'default';
}

// ── Bonded-pair blend policy ────────────────────────────────────────
// Purely PRESENTATIONAL: how a live cohesion bond is DRAWN.  Nothing in
// the sim reads it — bonds form, cohere, mature and break exactly as
// they did before, and turning the whole thing off changes no physics.
//
// 'fillet' draws the smooth-min union of the two bonded hulls the cheap
// way: ONE metaball connector (two cubic curves waisted between the
// bodies) filled UNDER both of them, so a stuck pair reads as one blob
// of goo rather than two polygons touching.  It is a PAIRWISE
// approximation of an SDF union rather than a sampled distance field —
// which is exact here rather than a compromise, because bond formation
// is a MATCHING: both formation sites skip any entity already bonded,
// so a bond is never one edge of a larger cluster.

export interface ShardBlendPolicy {
  kind: 'fillet';
  /** Which bond partners get a bridge.  Same selector grammar as
   *  merge.bondsWith — a partner this does not select renders
   *  unblended, exactly as it does today. */
  appliesTo: VariantSelector;
  /** Where on each body the bridge attaches, as a fraction of how far
   *  that hull reaches TOWARD its partner.  1 anchors it exactly on the
   *  facing surface, which can leave a hairline where the hull curves
   *  away from the join; below 1 buries the join under the body drawn
   *  over it.  A fixed radius is what this deliberately is NOT — plastic
   *  shards are 4-gons with vertex radii jittered 0.65..1.10 of the
   *  base, so one face stands nearly twice as far off the centroid as
   *  another, and any single circle is wrong for most of them.  Default
   *  0.9. */
  attachFraction?: number;
  /** Largest centre-to-centre gap that still draws, as a multiple of
   *  the summed attach radii.  Past it the goo has stretched too thin
   *  to read, and the bridge is dropped rather than drawn as a
   *  filament — bonds stretch to 1.5× (6× on a 'strong' pair) of
   *  contact distance before they snap, so a bond being live is not by
   *  itself evidence the pair still looks joined.  Default 1.35. */
  maxSpan?: number;
  /** Waist softness, 0..1 — how far around each body the bridge wraps
   *  before it necks in.  0 is a taut string between two tangent
   *  points, 1 a nearly straight-sided weld.  Default 0.5. */
  softness?: number;
  /** How far the goo COAT extends past a hull, as a fraction of that
   *  body's circumradius.  0 or absent draws the bridge alone, and the
   *  pair still reads as two bodies welded at a joint; above 0 each
   *  bonded body is also enveloped in a skin of goo that the bridge runs
   *  into, so the pair reads as one coated mass.
   *
   *  The coat is a true rounded OUTWARD OFFSET of the hull (its polygon
   *  filled, then stroked at twice the margin with round joins), not a
   *  circle around it: a circumscribed disc would swallow a jittered
   *  4-gon's silhouette entirely, and the shard's outline is what says
   *  which material the goo is holding.
   *
   *  A body is coated only if ITS OWN variant declares a blend policy
   *  selecting the partner — so plastic stuck to a glass tile coats the
   *  plastic and leaves the tile alone.  Coating the partner would
   *  repaint a tile's whole face in plastic, which says the tile is goo
   *  when it is the thing the goo is stuck to. */
  envelope?: number;
  /** Fill alpha for the bridge and coat.  Default 1 (the goo is as solid
   *  as the shard it belongs to).  Below 1 the coat's own overlaps — its
   *  fill against its stroke, and both against the bridge — stop being
   *  invisible and show as darker seams, so a translucent goo wants
   *  `envelope` left at 0. */
  alpha?: number;
}

// ── Shatter policy ──────────────────────────────────────────────────

export interface ShardShatterPolicy {
  /** 'voronoi' (voronoi gauntlet, V2): on death the entity's cached
   *  seeded Voronoi decomposition (see `ShardFracturePolicy` and
   *  `engine/systems/fracture.ts`) becomes the children — each cell is a
   *  fragment with the CELL's polygon.  While the DBG A/B lives
   *  (`getActiveFractureMode()`), 'legacy' mode routes a 'voronoi'
   *  variant through its OLD path instead: the powerlaw pipeline for
   *  mobile shards, the dent breakShards spawn for dent tiles. */
  kind: 'none' | 'powerlaw' | 'voronoi';
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
  /** Optional non-area-conservative sizing override.  When BOTH
   *  min/max are set, shatterAsteroidStyle bypasses the power-law
   *  area distribution + MIN_SIZE filter and instead sizes each
   *  child as `parent.size.x × random(min, max)`.  Total child
   *  area can (and usually will) exceed parent area — used by
   *  plastic-shard so a break visibly produces a fixed count of
   *  visible-sized children regardless of parent area math.
   *  Termination comes from the parent-size floor at top of
   *  shatterAsteroidStyle (parent < MIN_SIZE doesn't shatter),
   *  so a few generations of shrinking children die cleanly. */
  childSizeFractionMin?: number;
  childSizeFractionMax?: number;
  /** Optional size-keyed count override.  When set, shatter
   *  AsteroidStyle picks `count` from the first entry whose
   *  `maxSize` strictly exceeds `parent.size.x`.  Lets a variant
   *  scale shatter burst size by the parent's diameter — used
   *  today by plastic-shard for "bigger shards break into more
   *  pieces, in 5 size levels."  When unset, count falls back
   *  to the standard `countMin + damageNorm × (countMax − countMin)`
   *  formula. */
  shatterCountBySize?: ReadonlyArray<{ maxSize: number; count: number }>;
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

// ── Voronoi fracture policy ─────────────────────────────────────────
// The decomposition/crack/detach tuning for a fracture-capable variant
// (voronoi gauntlet, D1).  Site count is a function of SIZE and MERGE
// HISTORY only — deliberately NOT of the killing hit's damage, because
// the decomposition is computed at FIRST damage and the cracks it draws
// must be the seams the entity later breaks along.  The killing hit
// still drives scatter speed and (via lastImpactVelocity at compute
// time) the impact bias of the site distribution.

export interface ShardFracturePolicy {
  /** Site count = clamp(round(size / sizePerSite), min, max), raised to
   *  the entity's mergeCount when it was composed from more pieces. */
  siteCountMin: number;
  siteCountMax: number;
  /** Pixels of entity diameter per Voronoi site. */
  sizePerSite: number;
  /** Fraction of sites biased toward the impact point (0..1). */
  impactBias: number;
  /** Outward fling along each cell's centroid direction at shatter, so
   *  the pattern visibly flies apart along its own seams (added on top
   *  of the shared impact-scatter term). */
  radialSpeed: number;
  /** Optional override of the sliver threshold (see fracture.ts). */
  minAreaFraction?: number;
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
  /** Fraction of the unified light layer's contribution that passes
   *  THROUGH this variant instead of being withheld behind it, 0..1.
   *  Absent or 0 means opaque — the body casts a full shadow, which is
   *  every variant's default and the whole of the pre-existing
   *  behaviour.  Glass is the case this exists for: it is drawn as a
   *  translucent panel, so a solid black umbra behind it contradicts
   *  the art.
   *
   *  Distinct from `passThrough`, which is about COLLISION and is
   *  binary: a nebula tile lets a striker pass and casts no shadow at
   *  all, where glass stops a striker dead and casts a faint one. */
  transmit?: number;
  /** Fraction of the unified light layer's contribution that this variant
   *  RE-EMITS, uniformly in every direction, when light falls on it — 0..1,
   *  absent meaning inert.  Metal and glass carry it: one is specular and
   *  one is translucent, and both read wrong as matte bodies that swallow
   *  everything reaching them.
   *
   *  Only consulted while the DBG "Emissive" toggle is on, and it is a
   *  SECOND light rather than a brighter body — see `renderLightLayer`. */
  emits?: number;
  /** Bonded-pair blend policy — how a live cohesion bond between this
   *  variant and a partner is DRAWN.  Absent means today's behaviour:
   *  two hulls that happen to be touching.  Today: plastic-shard. */
  blend?: ShardBlendPolicy;
  /** Draw the body's dark rim line.  Absent means true — the outline
   *  every material has worn since the shard family existed.  False
   *  drops it, which is what a SOFT material wants: a rim line traces
   *  every notch and reads as a hard edge, so plastic (goo) and
   *  rock-tile (whose brittle dent silhouette is cleaner unlined) turn
   *  it off.  Read by the asteroid / mobile-shard branch, which is the
   *  one that draws the rim; the material-tile and glass-family
   *  branches have their own outline rules. */
  outline?: boolean;
  /** Corner rounding of the drawn silhouette, 0..1 — 0 (or absent) is
   *  the hard-cornered polygon it has always been, 1 trims every corner
   *  back to the midpoint of its shorter adjacent edge.  A FRACTION
   *  rather than a radius because these hulls span a 20..200 diameter
   *  range, and a fixed radius would round a big shard's corner subtly
   *  while swallowing a small one whole.
   *
   *  PRESENTATION ONLY: the rounding is traced at draw time and never
   *  written back into `polygonPoints`, so the SAT hull the physics
   *  solver sees is the same sharp polygon it always was.  Rounding the
   *  collision shape too would be a different (and much larger)
   *  change. */
  cornerRounding?: number;
  /** Render fast-path opt-in.  Today only nebula-tile populates the
   *  per-entity tinted-canvas cache (`nebulaCachedTinted`); the
   *  RenderSystem fast-path gating flips from EntityType-keyed to
   *  variant-id-keyed in Stage 5. */
  renderCache?: 'none' | 'composition';
  /** Conway-style neighbour-count automata for STATIC material tiles
   *  (glass / metal / rock).  When set AND the global DBG "Tile shade"
   *  master toggle is on, RenderSystem shifts the tile's render by its
   *  same-variant hex-neighbour count (`materialNeighborCount`): lone
   *  tiles and cluster edges stay at the base appearance, dense
   *  interiors ramp toward saturation.  Mirrors PLASTIC_SHARD_AUTOMATA,
   *  but per-variant and keyed off the static hex grid (ShardSystem
   *  recomputes the count lazily on tile destroy / regen) rather than
   *  the mobile merge broadphase.
   *
   *  The shift mode is per-variant — set EXACTLY ONE of:
   *   - `saturationBrightness`: RGB-multiply for OPAQUE faces (metal /
   *     rock), where recession reads as a colour shift.
   *   - `saturationOpacity`: alpha-multiply for TRANSLUCENT faces
   *     (glass), where recession reads as see-through — a brightness
   *     multiply just muddies the tint. */
  automata?: {
    /** Same-variant neighbour count at which the factor saturates.
     *  Hex tiles have up to 6 immediate neighbours. */
    maxNeighbors: number;
    /** Brightness multiplier at `maxNeighbors` (opaque-face path).
     *  >1 brightens dense interiors, <1 darkens them (the nebula
     *  rule).  Omit when using `saturationOpacity`. */
    saturationBrightness?: number;
    /** Alpha multiplier at the densest interior (translucent-face
     *  path) — the most-transparent endpoint, e.g. 0.45.  The mapping
     *  is BIPOLAR about the neutral 1.0: a half-surrounded tile
     *  (count ≈ maxNeighbors/2) renders at the default opacity (the
     *  range middle), sparser tiles trend more opaque toward the
     *  mirrored endpoint (2 − this, clamped at solid per layer), and
     *  dense interiors fade toward this value.  Omit when using
     *  `saturationBrightness`. */
    saturationOpacity?: number;
  };
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
  /** Seeded Voronoi fracture (voronoi gauntlet).  Present on variants
   *  whose `shatter.kind === 'voronoi'` (and, later milestones, variants
   *  whose CRACK RENDER rides the decomposition).  Shallow named fields
   *  only — ShardSystem reads this, never callbacks.  The decomposition
   *  itself is computed lazily (first damage / death) and cached on
   *  `entity.fractureCells`; every site that mutates the polygon, the
   *  size, or the merge count must invalidate that cache. */
  fracture?: ShardFracturePolicy;

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
    /** When true, applyDentStep captures the polygon's max vertex
     *  radius BEFORE the inward pull and scales every vertex
     *  afterwards so the post-dent max radius matches.  Net effect:
     *  the polygon visibly deforms (the pulled vertex sits at a
     *  smaller radius than its neighbours after scaling) but the
     *  bounding circle stays at its pre-dent extent — the silhouette
     *  doesn't shrink overall as hits accumulate.  Plastic-shard
     *  uses this so a dented shard reads as "squished" rather than
     *  "smaller".  Default false (legacy behaviour: bounding
     *  radius shrinks as the impact vertex pulls in). */
    preserveBoundingRadius?: boolean;
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
      /** Optional inclusive random count range — when set, this
       *  entry is expanded into `countMin..countMax` siblings at
       *  spawn time.  Each sibling re-rolls `sizeFraction` between
       *  `sizeFractionMin` and `sizeFractionMax` if those are set;
       *  otherwise all siblings share the single `sizeFraction`.
       *  Used by plastic-tile to release a burst of 8–12 small
       *  shards on shatter rather than a fixed list.  When unset
       *  the entry spawns exactly one shard at `sizeFraction`. */
      countMin?: number;
      countMax?: number;
      /** Optional sizeFraction randomisation range — when set,
       *  each spawned sibling picks a fresh sizeFraction in
       *  `[sizeFractionMin, sizeFractionMax]` instead of using the
       *  fixed `sizeFraction` above.  Only meaningful alongside
       *  `countMin/countMax`. */
      sizeFractionMin?: number;
      sizeFractionMax?: number;
      /** When true, the shard spawns as a fixed-size equilateral
       *  triangle (side = HEX_SIZE, i.e. 1/6 of a hex tile) at a random
       *  orientation, rather than the variant's silhouette or the parent
       *  polygon.  Used by metal-tile so it breaks into triangular
       *  pieces that snap edge-to-edge.  Overrides sizeFraction /
       *  inheritParentPolygon. */
      equilateralTriangle?: boolean;
    }>;
    /** Optional override for the HP assigned to spawned shards.
     *  When unset, shards inherit `tile.maxHealth` (today's
     *  behaviour).  When set, shards spawn with this HP regardless
     *  of the tile's own health — used by plastic-tile so the
     *  tile face is glass-brittle (1 HP) while the released shards
     *  retain the 24-HP plastic durability. */
    shardHealth?: number;
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
  /**
   * Ring indices this variant occupies on a ring-shaped map (today:
   * SevenRingsMap).  Added by gauntlet step 5 G7, when MAP_POPULATION
   * became the authority for the natural maps' tile-variant mix: a ring
   * map's "ratio" is not a cluster count, it is WHICH RING is made of
   * what, and that is population data even though the geometry is not.
   *
   * The ring GEOMETRY (how many, how far out, how thinned) deliberately
   * stays on the map class — that is the map's shape, not its population,
   * and a map named Seven Rings does not get its ring count from a table.
   */
  tileRings?: readonly number[];
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
    fromRock: boolean,
    material: 'rock-shard' | 'glass-shard' | 'plastic-shard' | 'metal-shard',
    excessUnits: number,
  ): void;
}

// Backwards-compat alias for the Stage 2 type name.  Removed in Stage 6.
export type ShardRegenAdapter = ShardAdapter;

