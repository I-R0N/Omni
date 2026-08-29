# Gauntlet log — Voronoi fracture, and the asteroid rename

Working ledger for the `claude/gauntlet-loop-session-uz91o1` branch
(the voronoi-fracture gauntlet).  Prompt: `GAUNTLET_VORONOI_PROMPT.md`
(session upload).  Format follows `docs/GAUNTLET_5C_LOG.md` /
`docs/GAUNTLET_5F_LOG.md`: one milestone per iteration, findings before
changes, every reverted attempt recorded.

**Goal.** Replace the simulated shatter with a real one: every
fracture-capable material carries a SEEDED VORONOI CELL DECOMPOSITION of
its own polygon — the cells are the fragments when it shatters, the cell
boundaries are the cracks it shows as it takes damage, and a hard-enough
hit carves the cell(s) nearest the impact OFF the entity while the
remainder survives.  Alongside it, the legacy "asteroid" vocabulary is
renamed out of the sim-side APIs.  Closes `docs/GAME_FEEDBACK_PLAN.md`
item 26 (`voronoi-rock-fracture`), whose status note records the user
direction: PR #65's `ROCK_BREAK`/`ROCK_CHIP` satisfied the feel goals
(b)–(d); still wanted is the true Voronoi cell decomposition (a).

## Checklist

- [x] **V0 — Survey, baseline, seam plan.**
- [x] **V1 — The fracture core, pure and pinned.**
- [x] **V2 — Full shatter through the cells.**
- [x] **V3 — Cracks are the pattern.**
- [x] **V4 — Partial fracture: shards break OFF tiles.**
- [x] **V5 — Roll across materials.**
- [x] **V6 — The asteroid rename.**
- [x] **V7 — Ship it.**

(Full milestone descriptions are in the prompt; each entry below opens
with what was measured/read, then what was done, then the evidence.)

---

## V0 — Survey, baseline, seam plan (2026-08-28)

No code changes in this milestone; this entry is the survey.

### The seven findings, verified

1. **Fragment count and geometry are decoupled — CONFIRMED.**
   `ShardSystem.shatterAsteroidStyle` is `ShardSystem.ts:785-1057`.
   Count logic at `:838-860` has FOUR modes stacked: a rock-shard
   override (`max(mergeBased, min(30, max(2, floor(size/40))))`,
   `:842-846`), a merge-count override (`merges ± 1` wobble, `:847-849`),
   a size-table override (`shatterCountBySize`, `:850-856`), and the
   base damage formula (`countMin + damageNorm × (countMax − countMin)`,
   `:858`) with `damageNorm = (lastImpactDamage − 1) / 4` (`:815-816`).
   Sizes at `:862-902`: even area-per-fragment for merged/rock parents,
   fraction-sized for plastic, power-law (`alphaMin..alphaMax`) budget
   otherwise.  Positions: random scatter cone around the impact angle
   (`:960-988`).  Geometry: every child calls `generateShardPolygon`
   (`:738-776`, `Math.random()` throughout) — **nothing inherits the
   parent's polygon**.  The finding stands exactly as stated.

2. **Rock-tile never reaches `shatter()` — CONFIRMED.**
   `GameEngine.handleEntityDeath` gates at `GameEngine.ts:2695-2699`:
   `isDentSpawn = dent !== undefined && dent.breakShards.length > 0`
   skips `shards.shatter` entirely; the dent variants break via
   `DropSystem.spawnDrops → spawnDentShard` (`DropSystem.ts:129-137`,
   `:452`).  rock-tile's `shatter.kind` is `'none'`
   (`constants.ts:7337-7345`) with `breakShards` = 3× rock-shard @ 0.75
   (`:7369-7373`).  The routing decision is D2 below.  Key precedent
   discovered: **plastic-shard has `dent` with EMPTY `breakShards`**
   (`constants.ts:7616`) and the death path routes it to the standard
   shatter — dent-and-shatter already coexist on one variant.

3. **The crack overlay is already seeded per entity — CONFIRMED.**
   `crackSeedFor` caches `entity.crackSeed` (`drawUtils.ts:127-133`;
   field `types.ts:1251`).  `overlayMaterialCracks`
   (`tileShapes.ts:341-365`) computes
   `count = min(cap, floor((maxHealth − health) / freq))` from
   `MATERIAL_DAMAGE_CRACKS` (`constants.ts:3544-3551`; rock freq 1 cap 6,
   metal freq 5 cap 5) and calls `drawDamageCracks`
   (`drawUtils.ts:142-179`) — seeded radial spokes via `hash01`
   (`drawUtils.ts:85-88`, the sin-fract hack, as warned).  The repo's
   real seeded-PRNG precedent is `BackgroundManager.starRand` —
   **mulberry32** at `BackgroundManager.ts:274-280`.  Reuse seam stands.
   Call sites of the crack machinery: `tileShapes.ts:364` (material
   tiles), `:864` (metal composite), `:1044/:1057` (mobile shards),
   `enemyShapes.ts:568` (enemy hulls — stays on spokes, out of scope).

4. **`inheritParentPolygon` exists and nothing uses it — CONFIRMED,
   with a stale-comment correction.**  Schema at
   `ShardSystem.types.ts:591-598`, full plumbing in
   `DropSystem.spawnDentShard` (`DropSystem.ts:458-711`).  **No variant
   sets it** (grep: only schema, plumbing, and comments).  The schema
   doc-comment at `ShardSystem.types.ts:584-587` claiming "used today by
   metal-tile" is STALE — metal-tile uses `equilateralTriangle: true`
   (`constants.ts:7275-7277`), which overrides it.  Fix the comment when
   the file is next touched.

5. **Metal is ALREADY cell-decomposed — CONFIRMED.**  The metal
   composite short-circuit is `ShardSystem.ts:706-721`: a dying
   metal-shard with `metalCells.length >= 2` routes to
   `decomposeMetalComposite` (one loose triangle per lattice cell),
   bypassing the powerlaw pipeline.  metal-shard's `shatter.kind` is
   `'none'`.  The presumption HOLDS: metal keeps the lattice as its cell
   set; only its crack RENDER moves onto lattice edges (V5).

6. **Simulated chipping = `releaseRockChip` — CONFIRMED.**
   `GameEngine.ts:4461+`, called from the non-lethal rock damage path at
   `:4445`.  `ROCK_CHIP` (`constants.ts:3511-3532`): CHIP_CHANCE 0.7,
   ROCK_FRACTION 0.5 (solid chunk vs dust roll), DUST_CHANCE 0.5,
   ROCK_SIZE_FRAC 0.45, conservation shrink for mobile parents
   (MIN_SHARD_DIAM 12), SOLID_MIN_PARENT_DIAM 30.  A chip entity spawns
   BESIDE the still-intact parent — this is what V4's partial fracture
   replaces.

7. **"Asteroid" is a name, not a thing — CONFIRMED.**  `EntityType`
   (`types.ts:103`) has no ASTEROID member; there is no `isAsteroid`.
   The only enum survivor is `MapType.ASTEROID_FIELD` (kept as flavour
   per the prompt).  `EntityIndex.asteroids` and
   `EntityIndex.shardCandidates` are **byte-identical** — both filled
   from the same entity in the same branch of `rebuild`
   (`EntityIndex.ts:136-137`); the comment at `:36` ("type=ASTEROID")
   references the deleted type.  The `asteroidHitCount/Timer/Cooldown`
   trio is confirmed a TILE PRESSURE accumulator (`types.ts:833-841`,
   `PhysicsSystem.ts:3877-3885`): sub-threshold impacts ON a tile within
   a decaying window, nothing to do with rock hit progression.  Full
   rename inventory below.

### Baselines

**simbench** (`node perf/simbench.mjs`, 300 steps × 7 batches, this
container, ms per sim substep; LEVELS indicative, DELTAS evidence —
perf/README.md):

| scene        | ents | median | best  | worst | 2×median |
|--------------|------|--------|-------|-------|----------|
| hub-idle     | 1337 | 0.862  | 0.681 | 0.913 | 1.72     |
| asteroid-6k  | 1323 | 1.708  | 1.441 | 1.847 | 3.42     |
| glass-field  | 1450 | 1.193  | 0.598 | 1.901 | 2.39     |
| roamer-stack | 3109 | 2.076  | 1.730 | 2.246 | 4.15     |

**Fragment-count baseline** (analytic, from the code cited in finding 1;
this container is headless, so the "visual reference" is this table plus
the V2 A/B captures taken through the Playwright harness):

| material / path | count | geometry |
|---|---|---|
| rock-shard, base | max(2, min(30, ⌊size/40⌋)): size 40→2 · 120→3 · 160→4 · cap 30 ≥1200 | fresh random star polys, even area split |
| rock-shard, merged N | max(max(2, N±1), size term) | same |
| rock-tile (dent break) | exactly 3 @ 0.75 × deformed diam (Σareas = 1.69× parent, deliberate) | fresh rock-shard silhouettes |
| glass-tile (`spawnGlassShards`) | round(4 + 6·damageNorm) + rand(0..2) → 4–12, power-law α 0.3–1.8, MIN_RADIUS 2 filter | fresh glass silhouettes |
| glass-shard | merged: N±1; else 2–5 via damageNorm, α 0.4–2.0 | fresh |
| plastic-tile (dent break) | 8–12 @ 0.44–0.64 (shardHealth 24) | fresh 4-gons |
| plastic-shard | 2–5 via damageNorm, α 1.0–1.6 | fresh |
| metal-tile (dent break) | 5–6 equilateral triangles (side = HEX_SIZE) | fixed triangles |
| metal-shard composite | one triangle per `metalCells` cell (cell-exact) | lattice cells |
| nebula-tile | 2–3, GLASS_TILE_HALF² budget — EXCLUDED from this gauntlet | cloud puffs |
| rock chip (non-lethal hit) | 0.7 chance: 50% solid chunk @0.45 / 50% dust roll @0.5 | spawned beside intact parent |

**Rock hit ceilings** (context for V4 thresholds): `rockHitCeiling`
(`constants.ts:3483-3491`) maps size 20→4 hits … 160→6 hits, +1 per 8
density tiers, clamped 4–6.  `MATERIAL_DAMAGE_CRACKS.rock` shows one
crack per hit up to that ceiling.

### The asteroid rename inventory (V6 worklist)

478 occurrences across 33 TS files (excluding docs + the standalone
build artifact).  By identifier, classified:

**RENAME (sim-side APIs — the `rock-shard` vocabulary,
`getRockShardFreeSpawn` precedent):**
- `spawnAsteroids` / `createAsteroid` (MapClasses.ts) → rock-shard spawn vocabulary
- `handleAsteroidRespawn` (GameEngine.ts) → rock-shard respawn
- `EntityIndex.asteroids` → FOLD into `shardCandidates` (byte-identical; one list, not two names)
- `buildAsteroidField` / `sampleAsteroidFlow` / `_computeAsteroidCell` / `_rebakeAsteroidKernel` (FlowFieldGrid.ts) → shard-flow vocabulary
- `asteroidFlowEnabled` / `toggleAsteroidFlow` / `onToggleAsteroidFlow` / `handleToggleAsteroidFlow` (GameEngine / debugControls / UIOverlay / App) → shard-flow
- `resolveAsteroidPair` (PhysicsSystem.ts) → rock/shard pair vocabulary
- `asteroidHitCount` / `asteroidHitTimer` / `asteroidHitCooldown` (types.ts, PhysicsSystem.ts) → tile PRESSURE vocabulary (`tilePressure*`)
- `ASTEROID_CRASH_MOMENTUM`, `ASTEROID_PRESSURE_WINDOW/HITS/COOLDOWN/MIN_MASS`, `ASTEROID_CRUSH` (constants.ts / STRUCTURE_CONSTANTS)
- `SALVAGE_DROP_CHANCE_ASTEROID`, `COLORS.ASTEROID`, `ASTEROID_GENERATION_CONFIG` (constants.ts)
- `PerfCounts.asteroidCount` / `currentAsteroidCount` (types.ts, GameEngine.ts, hud.ts)
- `shatterAsteroidStyle` + `style: 'asteroid'` (ShardSystem[.types].ts) — renamed as part of V2's new kind work
- `AsteroidStyle` misc + stale comments (`createAsteroidShards` exists only in comments — the function is already deleted)

**KEEP (player-facing flavour / registry ids, per the prompt):**
- `MapType.ASTEROID_FIELD`, descriptor id `field_asteroid` /
  `asteroid_field_*`, `AsteroidFieldMap` class name + display names,
  DBG row labels, `asteroidAssets` (`ASTEROID_ICE` / `ASTEROID_VOLCANIC`
  — asset manifest keys), test-id strings already shipped in
  tests (`tests/*.spec.ts` reference map names, not sim APIs).

**DELETE (fall out of V2/V4/V7):**
- `releaseRockChip` + `ROCK_CHIP` (replaced by partial fracture; V7
  decides dust-only cosmetic remnant)
- stale comments citing `createAsteroidShards`, `type=ASTEROID`

### Decisions (D1–D4)

- **D1 — where the config lives.**  `shatter.kind` gains `'voronoi'`
  beside `'none' | 'powerlaw'` (`ShardShatterPolicy.kind`) — the death-
  path switch.  The decomposition/crack/detach tuning lives in ONE new
  optional shallow named block on `ShardVariantDef`: `fracture?:
  ShardFracturePolicy` — named fields only (site counts, impact bias,
  detach thresholds, min remainder), never callbacks — because cracks
  (V3) and partial detach (V4) act on a LIVING entity, not just at
  death, so the config cannot live inside `shatter` alone.  A variant
  without the block keeps legacy behaviour end to end.
- **D2 — rock-tile routing.**  Rock-tile keeps `dent` (the per-hit
  deform + pressure contract) and opts into `shatter.kind: 'voronoi'`.
  The death gate keys off the kind: a dent variant whose shatter kind is
  `'voronoi'` routes to `ShardSystem.shatter` (the plastic-shard
  empty-breakShards precedent proves dent + shatter coexist).  While the
  DBG A/B lives, `breakShards` STAYS POPULATED as the legacy
  config — the gate checks the live fracture mode, so legacy mode still
  dent-spawns.  V7 empties it when the user calls the A/B.
- **D3 — the PRNG.**  mulberry32, reimplemented as a pure function in
  the new fracture module (V1 forbids engine imports; the
  BackgroundManager instance is engine-side).  `crackSeedFor`'s cached
  per-entity seed is the site-placement seed, so cracks and fragments
  share one pattern by construction.
- **D4 — baseline visuals.**  Headless container: the analytic table
  above + before/after captures via the Playwright debug handles at V2
  stand in for device screenshots; on-device judgement rides the DBG
  A/B toggle (prompt requirement) whenever the user plays a build.

Gates at V0: `npm run typecheck` ✓, `npm run build` ✓ (2.78s), no test
run needed (no code change).

---

## V1 — The fracture core, pure and pinned (2026-08-28)

**What was built.**  `engine/systems/fracture.ts` — pure geometry, zero
imports (the DualSenseHID precedent), no `Math.random` anywhere.
Exports: `mulberry32` (the BackgroundManager mixer restated as a pure
factory, D3), polygon primitives (`polygonArea` / `polygonSignedArea` /
`polygonCentroid` / `pointInPolygon` / `isSimplePolygon`),
`placeFractureSites` (rejection sampling with a soft min-separation rule
+ optional impact-biased fraction), `computeFracture` (the
decomposition), `collectInteriorEdges` (the bisector segments — V3's
crack input, deduped, midpoints carried for impact ordering).  Debug
handle #6: `window.__omniFracture` (App.tsx), pinned by
`tests/fracture.spec.ts` (6 tests).

**The clipping decision — measured, not assumed.**  The prompt's V1
hazard was real.  First cut: Sutherland–Hodgman (concave parent ×
convex Voronoi region) + a post-split at duplicated vertices.  The
suite's deep-star case (alternating radii 1.0/0.42, 12 vertices, 24
sites, seed 42.9) produced **self-intersecting cells** — S-H bridges a
disconnected intersection along the clip line but subdivides the doubled
edge differently in each direction, so the bridge is not findable by
vertex identity.  REPLACED with repeated LINE SPLITTING
(`splitPolygonKeepNeg`): each cell is the parent split by every
bisector, keeping the near side, using the sorted-crossing algorithm
(crossings of a simple polygon along the cut line alternate
inside/outside, so pairing sorted crossings 0-1, 2-3… yields the
interior bridges exactly; chains stitched across bridges close real
disjoint pieces, each simple BY CONSTRUCTION).  On-line vertices snap to
the keep side (eps = 1e-5·√area) so tangencies never leave odd crossing
counts; the residual same-kind-pair degeneracy falls back to
single-polygon S-H (area-conserving even when bridged).  The failing
case now passes.

**Sliver rule.**  A cell piece below
`minAreaFraction (0.15) × parentArea / siteCount` retires its SITE and
the decomposition recomputes — neighbours absorb the territory, which is
the "merge slivers into neighbours" rule with no polygon union.  Bounded
loop, never below 2 sites.

**Pinned by the suite** (all six green, `npx playwright test
tests/fracture.spec.ts`):
- determinism: same (polygon, seed) → JSON-identical result;
- area conservation: 48 decompositions (12 rock-shape polygons spanning
  chip 12px → boulder 160px × site counts 4/8/16/30), Σcells within
  0.1% of parent;
- validity: every cell simple, positive winding, no sliver below the
  minimum (deep-concave star included);
- impact bias: biased sites measurably nearer the hit across 6 seeds;
- interior edges: midpoints strictly inside the parent, deduplicated;
- cost (software-raster container): **n4 = 77 µs, n8 = 62 µs,
  n16 = 125 µs, n30 = 495 µs** per decomposition — comfortably inside
  the lazy-compute-and-cache budget (a decomposition is a per-damage
  event, never per-frame).

Boot/loop canaries stay green (the App.tsx handle is one assignment).
Gates: typecheck ✓ · build ✓ · fracture + boot + loop suites ✓.

---

## V2 — Full shatter through the cells (2026-08-28)

**Schema (per D1).**  `ShardShatterPolicy.kind` gains `'voronoi'`;
decomposition tuning lives in the new shallow `fracture?:
ShardFracturePolicy` block on the variant def (`siteCountMin/Max`,
`sizePerSite`, `impactBias`, `radialSpeed`, optional
`minAreaFraction`) — named fields, no callbacks.  Site count is a
function of SIZE + MERGE HISTORY only, deliberately NOT the killing
hit's damage: the decomposition is computed at first damage and the
cracks it will draw (V3) must be the seams of the eventual break.  The
killing hit still drives scatter speed and, at compute time, the impact
bias.

**Cache.**  `GameEntity.fractureCells`, computed lazily by
`ShardSystem.ensureFracture` (seed = the crackSeedFor hash, restated
pure as `fracture.seedFromEntityId` so sim and render derive the same
value; impact point projected from `lastImpactVelocity` into the
entity's local frame).  Invalidated at every input mutation found:
`composeEntities` (merge/condense), `PhysicsSystem.applyDentStep`
(polygon dent), the plastic snap-back beside `_satCacheAxes` (the
existing invalidation cluster — fractureCells joined it).

**Routing.**  `ShardSystem.shatter` dispatches `'voronoi'` →
`shatterVoronoiStyle`; under the DBG 'legacy' A/B the same variant takes
its OLD path (dent tiles stand down here and spawn breakShards via
DropSystem; mobile shards run the powerlaw pipeline).  The dent detour
is gated at BOTH its ends — `handleEntityDeath.isDentSpawn` and
`DropSystem.spawnDrops`' `spawnDentShard` call — so the two paths never
double-spawn.  Opt-ins: rock-shard and rock-tile.  DBG A/B: pause ▸
Debug Menu ▸ Visual ▸ **Fracture** (voronoi default / legacy), live from
this milestone per the working rules.

**The fragments.**  Each cell → one child with the CELL's polygon
(re-centred on its centroid, world position rotated with the parent so
the pattern lands where it rendered), `size = parentSize ×
√(cellArea/Σ)` (Σ child size² = parent size² — conservation by
construction), rock hit-ceiling HP, legacy density-tier mixing (±2
around the parent for rock), velocity = capped impact-scatter term (the
legacy magnitude curve, narrower cone — the geometry already scatters)
+ `radialSpeed` along each cell's own centroid direction so the pattern
flies apart along its seams.  Dust burst extracted verbatim into
`spawnShatterDust`, shared by both styles; drops / `killedByPlayer` /
grace timers untouched.

**Found while wiring** — the tiny-parent guard: the powerlaw guard
(`parent² < 2×childSizeMin²`) blocked rock-TILE fracture entirely (a
42px hex < two 30px rock minimums → tiles vanished without debris; the
legacy dent path never had a size gate).  The guard now applies to
MOBILE parents only, which keeps rock-shard behaviour identical to
legacy and lets tiles always break into their cells.

**Rebalance table (old → new, voronoi mode):**
| path | legacy | voronoi |
|---|---|---|
| rock-shard count | max(2, min(30, ⌊size/40⌋)), merged: ±1 wobble | same mapping via sizePerSite 40 (wobble dropped — determinism), merge raise kept |
| rock-shard geometry | fresh random stars, even-area | own cells, exact partition |
| rock-tile count | exactly 3 @ 0.75× (Σarea 1.69× parent — material creation) | ~5 cells (42px hex / sizePerSite 9), Σarea = parent exactly |
| killing-hit damage → count | rock: already ignored | ignored (cracks must predict the break) |

**Evidence.**  Two new sim-path tests in `tests/fracture.spec.ts` (8/8
green): a mobile rock-shard breaks into ≥2 cells with Σ size² within 1%
of the parent and real polygons, and the legacy A/B still powerlaws;
a rock-tile yields 3–9 cells under voronoi and EXACTLY its 3 breakShards
under legacy.  Full gates: typecheck ✓ · build ✓ · fracture (8) + boot +
loop + terrain + attribution + economy (22) ✓.  simbench after V2 (vs
the V0 baseline — deltas are the evidence; the shatter path is
death-frame only):

| scene | V0 median | V2 medians (3 runs) |
|---|---|---|
| hub-idle | 0.862 | 0.736 / 0.737 / — |
| asteroid-6k | 1.708 | 1.658 / 1.520 / 1.564 |
| glass-field | 1.193 | 1.228 / 1.202 / 1.243 |
| roamer-stack | 2.076 | 2.470 / 1.934 / 2.388 |

roamer-stack's first read (+19%) triggered the >10% rule; two re-runs
bracket the baseline (1.93–2.47 around 2.08) — scene noise from the
stochastic roamers, not a regression, and asteroid-6k (the scene where
a voronoi cost would live) sits BELOW baseline on all three runs.  The
shatter path runs only inside death frames, as budgeted.

---

## V3 — Cracks are the pattern (2026-08-28)

**The shared accessor.**  New `engine/systems/fractureCache.ts` —
`ensureFractureCells` / `ensureFractureEdges`, the ONE cache policy both
layers read (the sim consumes cells at death, the render draws edges as
cracks; neither layer may own it, or they could disagree).
`ShardSystem.ensureFracture` (V2) moved here verbatim; pure geometry
stays in `fracture.ts`.  Edges are sorted at build — nearest-the-impact
first when `lastImpactVelocity` gives an impact point, centre-out
otherwise — so the progressive reveal grows outward from the hits and
NEVER reshuffles between frames.  `GameEntity.fractureEdges` caches the
sorted list; every site clearing `fractureCells` clears it too.

**The render swap.**  `overlayMaterialCracks` branches once: a variant
with a `fracture` block draws the first `⌈edges × count/cap⌉` interior
cell edges via the new `drawUtils.drawFractureCracks` (same scorch,
stroke style and glint treatment as the spokes — CrackStyle survives as
styling); everything else falls through to `drawDamageCracks` unchanged.
So rock-tile + rock-shard show their seams; metal (tiles, composites,
loose shards) and enemy hulls keep the legacy spoke look, per the plan.
The `MATERIAL_DAMAGE_CRACKS` freq/cap pacing survives — the full pattern
is visible exactly at the old crack cap.  The LOD bail
(`MIN_APPARENT_RADIUS_PX`) and the static-tile-cache invalidation
(damage flips `_staticCached`, PhysicsSystem:~1686) are untouched — the
tile stamp already re-runs on every HP change.

**The killing-blow subtlety (found by reading, fixed by ordering).**
`applyDentStep` runs on EVERY damage event, the killing blow included —
and the damage path decrements health BEFORE the dent.  A naive
invalidation there would recompute the decomposition on the final
(never-rendered) dented polygon, so the fragments would separate along a
SLIGHTLY different pattern than the cracks just shown.  The dent-step
invalidation now skips when `health ≤ 0`: the shatter consumes exactly
the decomposition whose edges were on screen.  Acceptance is pinned by a
new test that damages a rock through the REAL projectile path, waits for
the REAL render frame to build the cache, kills it, and asserts every
cell produced a fragment at that cell's own centroid (9/9 fracture tests
green).

Gates: typecheck ✓ · build ✓ · fracture (9) + boot + loop + terrain +
healthbars + shake + knockback + lighting (51) ✓.

---

## V4 — Partial fracture: shards break OFF tiles (2026-08-28)

**The subtraction — arc splicing, not general booleans (logged choice).**
`fracture.subtractBoundaryCell`: a boundary cell's outline is one
contiguous run of vertices ON the parent boundary (the arc) plus one
interior chain (its bisector edges), so the remainder is the parent
boundary walked the long way between the arc's endpoints, closed through
the chain.  Both complementary walks are built; the one that is simple
AND matches parentArea − cellArea (2% tolerance) wins; anything else —
interior cell, multi-arc contact, validation failure — returns null,
which callers treat as "no chip this hit".  The prompt's alternative
("simply loses the detached cells") is what this is: an exact per-cell
subtraction with a validity-gated refusal, no polygon union library.

**The detach** (`GameEngine.detachFractureChip`, called from the rock
chip site under the same `ROCK_CHIP.CHIP_CHANCE` cadence roll): the cell
nearest the impact detaches via `ShardSystem.spawnDetachedCell` (the V2
fragment recipe, chip-flavoured motion, parent's density tier inherited
unchanged), the parent takes the spliced remainder, mobile parents scale
mass by the area removed, and the full dent-machinery invalidation
cluster fires (SAT axes, occluder radius, collision radius,
`_staticCached`, both fracture caches).  `entity.size` and `position`
stay untouched (the dent contract: stable footprint, `position ===
hexCoord`) so the static grid never rebuilds; the tile cache re-stamps
through the flip it already does on every damage event.  Legacy
`releaseRockChip` survives untouched as the DBG 'legacy' path and as the
fallback for parents too small for 3 cells (their dust cadence in
voronoi mode is CHIP_CHANCE² — noted, accepted).

**Min-remainder rule.**  `FRACTURE_DETACH.MIN_REMAINDER_FRAC` (0.25) of
the entity's ORIGINAL area (`fractureOriginalArea`, stamped at first
detach): a detach that would leave less routes the WHOLE entity through
the normal death path — health 0, `removeStaticEntity` for tiles
(public), `handleEntityDeath` — so the last cells detach as the final
break, and the flow-field patch, drops and scoring all ride the existing
plumbing.  This is feedback item 26c verbatim: cumulative chip-off area
drives the break threshold, alongside the untouched hit-ceiling model
(each qualifying hit ≈ one cell of area, so the two thresholds track).

**Found by measurement — the splice wedge.**  A 42px hex stalled at 70%
area after 4 bites: the jagged remainder put every cached cell's
boundary contact into multiple runs, nothing spliced, and with the cache
kept the entity could never chip again.  Two fixes: candidate cells are
tried in nearest-impact order until one splices, and a TOTAL failure
drops the caches (the next hit's fresh impact bias re-seeds the
distribution) and falls back to the legacy chip for that hit.  Regen
interaction: N/A today (rock has `regen: none`); logged for V5+: regen
respawns the canonical tile, so partial loss never touches the regen
queue — only full death enqueues.

**Evidence.**  Two new tests (11/11 fracture green): the pure splice
across 10 decomposed rock polygons (remainder = parent − cell within 2%,
simple, >50% of cells spliceable), and the sim path — first detach
carves exactly one chip whose area equals the parent's loss, caches
invalidate, and a deterministic min-remainder case dies through the real
death path with ≥2 cells as debris.  Wider suites: boot + loop + terrain
+ economy + attribution + shake + knockback (31) ✓.  typecheck ✓ ·
build ✓ · simbench (medians): hub-idle 0.730 / asteroid-6k 1.772 /
glass-field 1.225 / roamer-stack 2.132 — all inside the noise band
established at V2 (asteroid-6k's V2 spread was 1.52–1.71; +3.7% over the
V0 single read is within it, and the detach path runs only on damage
events).

---

## V5 — Roll across materials (2026-08-28)

**Glass.**  glass-tile opts into `shatter.kind: 'voronoi'` with the
HIGHEST impact bias of any material (`impactBias 0.75`) — most sites
crowd the hit, so cells are small at the impact and grow outward, which
is the radial/Voronoi hybrid look real glass has.  The two legacy gates
open together: `handleEntityDeath`'s `variant !== 'glass-tile'` skip
gains `|| voronoiShatter`, and `DropSystem`'s `isGlassFamilyTile`
branch (the `spawnGlassShards` fan) stands down under voronoi —
mirrored gates, same pattern as the dent detour.  The fan survives as
the DBG 'legacy' path.  Glass-SHARD (mobile debris) deliberately keeps
powerlaw — the prompt names the tile path, and glass debris is 1–2 HP
one-shot chaff whose decomposition would never be seen.  Rebalance:
4–12 damage-scaled fresh silhouettes → 5–10 area-exact cells.

**Plastic.**  plastic-tile and plastic-shard opt in; the dent +
snap-back per-hit behaviour is UNTOUCHED and the decomposition rides
the deformed polygon (the V2/V3 invalidation sites already cover dent
and snap-back), so only the full break uses the cells.  Two child
contracts preserved in `shatterVoronoiStyle`: the dent
`shardHealth` override (plastic-tile children keep their 24-HP dent
life, pinned by test) and the per-child plastic shade re-roll.
Rebalance: 8–12 @ 0.44–0.64 fresh 4-gons (Σareas ≈ 2.3× tile — more
material creation) → 6–12 area-exact cells.

**Metal — the V0 presumption held.**  Metal keeps
`decomposeMetalComposite` as its fracture; what moved is the COMPOSITE's
crack render: instead of seeded spokes it now strokes a
crackSeed-rotated, damage-revealed prefix of its OWN lattice-cell
outlines (scorch kept) — the exact seams the decomposition breaks it
into, inside the existing cell-union clip, allocation-free.  metal-TILE
keeps the spoke look, logged deliberately: its death spawns 5–6
equilateral triangles at RANDOM orientations (`equilateralTriangle`
breakShards), so there is no fixed cell set for tile cracks to
predict — routing them onto an invented lattice would be the exact
"cracks lie about the break" defect this gauntlet removes.

**Nebula / indestructible: excluded** (a cloud has no cracks;
`shatterNebulaStyle` untouched — still the only `'powerlaw'`+`'nebula'`
consumer — and indestructible never dies).

**Evidence.**  New V5 test (12/12 fracture green): glass + plastic tiles
under voronoi break into ≥3 cells whose polygon areas sum to the tile's
own polygon area within 2%, plastic children all at 24 HP; under legacy
the old fans still run (glass fan, plastic 8–12 @ 24 HP).  Wider: boot +
loop + terrain + lighting + economy + attribution + healthbars (56) ✓ —
terrain's glass-field parity tests now exercise the VORONOI glass path
and hold unchanged.  typecheck ✓ · build ✓.

---

## V6 — The asteroid rename (2026-08-28)

Zero behaviour change; scripted word-boundary renames over the V0
inventory (21 files).  The applied map:

| old (sim API) | new |
|---|---|
| `spawnAsteroids` / `createAsteroid` / `handleAsteroidRespawn` | `spawnRockShards` / `createRockShard` / `handleRockShardRespawn` |
| `EntityIndex.asteroids` | **FOLDED into `shardCandidates`** (was byte-identical; one list, one name — consumers: gravity, homing, roamer food scans, merge broadphase) |
| `buildAsteroidField` / `sampleAsteroidFlow` / `_computeAsteroidCell` / `_rebakeAsteroidKernel` | `buildShardFlowField` / `sampleShardFlow` / `_computeShardFlowCell` / `_rebakeShardFlowKernel` |
| `asteroidFlowEnabled` + toggle/handler chain | `shardFlowEnabled` + `toggleShardFlow` / `onToggleShardFlow` / `handleToggleShardFlow` |
| `resolveAsteroidPair` | `resolveShardPair` |
| `asteroidHitCount/Timer/Cooldown` | `tilePressureCount/Timer/Cooldown` (it IS a tile pressure accumulator) |
| `ASTEROID_CRASH_MOMENTUM` / `ASTEROID_PRESSURE_*` / `DAMAGE.ASTEROID_CRUSH` | `SHARD_CRASH_MOMENTUM` / `TILE_PRESSURE_*` / `SHARD_CRUSH` |
| `COLORS.ASTEROID` / `SALVAGE_DROP_CHANCE_ASTEROID` | `COLORS.ROCK_SHARD` / `SALVAGE_DROP_CHANCE_ROCK_SHARD` |
| `PerfCounts.asteroidCount` / `currentAsteroidCount` | `mobileShardCount` / `currentMobileShardCount` (the folded list's length) |
| `shatterAsteroidStyle` + `style: 'asteroid'` | `shatterPowerlawStyle` + `style: 'scatter'` (the type union too) |

**KEPT, per the prompt** (flavour, registry ids, asset keys):
`MapType.ASTEROID_FIELD`, descriptor id `field_asteroid`,
`AsteroidFieldMap`, display names, DBG row labels (the perf panel still
prints "asteroids"), `asteroidAssets` + `ASTEROID_ICE` /
`ASTEROID_VOLCANIC`, and prose comments where "asteroid" means a big
rock.  Also deliberately untouched: DropSystem's function-local
`SlotKind = 'asteroid'` literal (an internal enumeration inside one
function, not an API), and `ASTEROID_GENERATION_CONFIG` mentions in
comments that describe deleted history.  Stale comments naming the
deleted `createAsteroidShards` / `AsteroidStyle` updated; the
`type=ASTEROID` ghost in EntityIndex died with the fold.

The bare-token rule that made the script safe: `\bASTEROID\b(?!_)`
cannot match `ASTEROID_FIELD` (underscore is a word character), so the
keep-set needed no exclusion logic.

**Evidence of zero change: the FULL suite — 249/249 green** (build +
`npx playwright test`, 9.1m), typecheck ✓.  No pinned value moved.

---

## V7 — Ship it (2026-08-28)

**What was NOT deleted, and why.**  The prompt gates both deletions on
a user call that has not occurred, so the DBG A/B (Visual ▸ Fracture)
STAYS for the play-test, and with it every legacy path it routes: the
powerlaw pipeline (`shatterPowerlawStyle` — also still the live path
for glass-shard, metal-tile snap debris sizing and the nebula style's
sibling), the dent `breakShards` spawns, the `spawnGlassShards` fan,
and `releaseRockChip` + `ROCK_CHIP` (doubly alive: the legacy A/B AND
the voronoi mode's small-rock dust fallback — the V4 outcome).  An
unused-code sweep found nothing deletable that the A/B does not still
reach.  Collapsing the A/B to voronoi-only is a one-milestone follow-up
once the user calls it: flip the gates' `getActiveFractureMode()` reads
to constants, delete the legacy branches they guarded, empty rock-tile's
`breakShards`, and reduce `ROCK_CHIP` to the dust roll.

**Docs synced** (part of the deliverable): CLAUDE.md §2 (fracture.ts /
fractureCache.ts rows, EntityIndex row), §4 (fracture cache fields, the
tile-pressure rename), §5 (the SHARD_VARIANTS fracture axis +
FRACTURE_DETACH + the A/B), §8 (death routing gates, "cracks ARE the
pattern", partial fracture, `sampleShardFlow`);
`docs/SHARD_SYSTEM.md` §2b (the fracture axis, same shallow-table
rule); `docs/GAME_FEEDBACK_PLAN.md` item 26 CLOSED with a pointer here
(spec kept for the record).

**Final gates.**  typecheck ✓ · build ✓ · FULL `npx playwright test`
**249/249** ✓ (twice this session: after V6 and after V7's doc-only
changes).  Final simbench vs the V0 baseline (ms/substep, medians):

| scene | V0 | V7 |
|---|---|---|
| hub-idle | 0.862 | 0.694 |
| asteroid-6k | 1.708 | 1.624 |
| glass-field | 1.193 | 1.005 |
| roamer-stack | 2.076 | 2.313 (inside the 1.93–2.47 noise band measured at V2) |

No scene regressed beyond noise; the three deterministic scenes all
read AT or BELOW baseline, consistent with the budget rule holding —
the decomposition is computed only at damage/death events and cached.
Per D4, the before/after "visual capture" is the analytic evidence in
this log (the V0 fragment table vs the V2/V5 rebalance tables + the
pinned conservation/centroid-match tests); on-device judgement rides
the DBG A/B, which is the control built for exactly that.

**Gauntlet complete.**  V0–V7 all ticked.  Open item for the user:
judge the A/B on a device (rock field for chips + full breaks, glass
field for the radial shatter, a plastic cluster for the burst), then
call the collapse.

---

## V8 — Fracture propagation (2026-08-28, user correction of V4)

**The correction.**  The user's read of V4 was right: it used the cells
as fragment GEOMETRY while the old fracture system still decided WHEN
things broke (the `CHIP_CHANCE` roll picked detach moments, the
decomposition recomputed after every bite, and the crack reveal was a
parallel readout).  The intended mechanic: the pattern is applied ONCE;
damage progressively HIGHLIGHTS the cell boundaries; and a piece breaks
off exactly when its boundary is fully highlighted — the cracks are not
a preview of the break, they are its progress meter.

**What changed.**
- `FractureEdge` gains `cells` (edge→cell adjacency, built during the
  dedupe walk in `collectInteriorEdges`; a T-junction twin that fails
  to dedupe leaves a single-owner edge that simply binds its owner).
- `ShardFracturePolicy.progressive` — rock-tile + rock-shard opt in.
- `fractureCache.fractureRevealedEdgeCount` — the ONE reveal formula,
  shared verbatim by the crack render and the detach sim.  FLOOR-paced
  over the entity's hit life so the LAST boundary completes exactly at
  the hit ceiling: a 2-cell rock (one interior edge) never halves on an
  early hit, while larger patterns shed their early-completed pieces
  hit by hit.  (First cut used ceil; the V3 suite caught a 2-cell
  100px rock splitting — and dying — on its first hit.)
- `GameEngine.progressFracture` replaces `detachFractureChip`: after
  each hit, every cell whose BINDING edges are all revealed detaches
  (arc-splice; boundary-complete-but-unspliceable cells wait); an edge
  stops binding once its partner cell has departed, so interior pieces
  free up as neighbours leave; the loop cascades.  NO `CHIP_CHANCE`
  roll — the legacy dust fallback remains only for degenerate polygons.
- **The pattern PERSISTS**: a detach removes its cell from
  `fractureCells` and splices the polygon but never recomputes — the
  survivors are the same cells the player has been watching.  Only
  compose/merge invalidates now; `applyDentStep` stands down entirely
  for progressive variants under voronoi (a per-hit polygon pull would
  drift the fixed pattern off the shape and wedge the splice), so the
  V3 killing-blow special case is moot for rock and stays only for the
  non-progressive dent materials.
- Death (hit ceiling, or min-remainder — also triggered when the last
  piece would leave) breaks the REMAINING cells; `shatterVoronoiStyle`
  and `spawnDetachedCell` size fragments against `fractureOriginalArea`
  so pieces stay area-true to the shape the pattern was cut from even
  after earlier pieces left (fixes a latent V4 inflation).

**Rebalance (old → new, voronoi rock):** chips per hit 0.7-chance
random-cell → deterministic boundary-completion (0 on early hits while
the pattern highlights, cascading later); rock-tile dent pull under
voronoi → none (the highlight is the damage read; legacy mode keeps
the dent, pinned by test); small-rock dust fallback now only for
degenerate polygons.

**Tests** (old → new, logged per the working rules): the V4 sim test
("a hit carves the nearest cell OFF a rock-tile", chance-roll driven)
is REPLACED by three: the progressive story (pattern applied undamaged
with zero detaches; pieces break off as HP steps down with no chance
roll; surviving cells a SUBSET of the original pattern — no recompute;
chips + remainder tile the original area within 2%), the deterministic
min-remainder death (unchanged trick), and the dent stand-down A/B.
The pure splice test and every other suite stand unchanged.  14/14
fracture green; boot + loop + terrain + economy + attribution + shake +
knockback + healthbars (38) green; typecheck ✓ · build ✓ · simbench
medians 0.816 / 1.682 / 1.012 / 2.004 — all at or below the V0
baseline.  CLAUDE.md §4/§8 and SHARD_SYSTEM.md §2b re-synced.

---

## V9 — Play-test round 2 (2026-08-28, user feedback)

Four items from the user's second play-test.

**1. The duplicate-fragment bug (root-caused, regression-pinned).**
"Large rock shards release duplicate shards after shattering."  Cause:
in the projectile path, `onDamage` (the damage-feedback hook that hosts
`progressFracture`) runs BEFORE the `health <= 0` death block — so a
min-remainder death raised INSIDE the hook returned to a handler that
saw zero health and dispatched `onDeath` a SECOND time, and with the
decomposition cached the second shatter spawned an exact duplicate of
every fragment.  Fix: STRUCTURE deaths are idempotent —
`GameEntity.deathDispatched`, stamped by `handleEntityDeath`'s
structure branch, cleared by `completeRegen` (regen REUSES the entity
object).  The regression test was VERIFIED against the bug: with the
guard disabled the scenario (full-health 2-hit rock-tile, first hit —
the probabilistic rock break is 0% at one hit, so only the mid-hook
death can kill — with a preset original area tripping min-remainder)
produces 2 dispatches and 6 duplicated positions out of 12 children;
with the guard, 6 children, 0 duplicates.  (A first repro attempt
failed for two instructive reasons, both logged: the test wasn't
passing the REAL `onDamage` into `resolveCollision`, and a
99-hits-taken tile died to the rock-break roll before the hook ran.)

**2. The glass damage layer.**  `STRUCTURE_VARIANTS.glass.health`
1 → 12 and new `GLASS_SHARD_HP` = 8, wired at every glass-shard spawn
site (the spawnGlassShards debris, snap debris, voronoi + powerlaw
children — the HP is durability, not fracture geometry, so it is NOT
part of the A/B): three / two base Blaster (damage 4) hits, heavier
weapons still one-shot.  New `MATERIAL_DAMAGE_CRACKS.glass`
(freq 4, cap 3) + `GLASS_CRACK_STYLE` — BRIGHT hairlines, near-zero
scorch (glass webs, it doesn't char) — drawn in the glass-tile vector
path, the glass-shard branch, and baked into the static-cache stamp
(future-proofing: the placeholder sprite keeps glass on the vector path
today).  glass-shard OPTS INTO voronoi with its own fracture block so
the cracks its damage layer shows are the exact seams it breaks into.
BRITTLENESS PRESERVED: physical smashes — the player/shard crash over
the momentum threshold and the tile-pressure trigger — take the whole
pane, exactly as at 1 HP; the damage layer meters WEAPON hits.  (Found
by the terrain crush-parity suite going red: a 12-HP pane surviving a
boulder slam; the "glass dies in one" pressure comment is now enforced
explicitly.)

**3. Rock fractures like glass.**  The user's read: rock shattered into
big sharp-angular chunks; glass's impact-crowded radial pattern is the
look.  rock-tile: sizePerSite 9 → 7, siteCountMax 9 → 12, impactBias
0.5 → 0.75.  rock-shard: sizePerSite 40 → 22, siteCountMin 2 → 3,
impactBias 0.5 → 0.75.

**4. Rock shards chip like rock tiles.**  Fell out of 3: the old
2–4-site patterns on mobile rocks left too few edges for the floor-paced
reveal to complete any boundary before the hit ceiling — a 100px rock
now carries ~5 sites / enough edges that pieces highlight and break off
mid-life exactly like tiles.

Gates: typecheck ✓ · build ✓ · fracture (16, two new) + terrain re-green
after the brittleness fix · FULL suite **253/253** (13.8m) ✓.
CLAUDE.md §5 re-synced (glass damage layer, glass-shard opt-in, the
rock pattern retune).

---

## V10 — Chip depth, and rock's model as the default for glass (2026-08-29, user feedback)

> "I really like the way rock tiles chip in general. I would prefer they
> chip more now before they shatter fully. Then I would like to make the
> rock breaking behavior the default for rock and glass."

**Why so little chipping was happening (measured, not guessed).**  Three
compounding causes, found by instrumenting a real rock tile through the
real projectile path:

1. **The legacy early-break roll ended most rocks at hit 2-3.**
   `maybeRockEarlyBreak` gives a rising random chance of instant death
   from the second hit on (a 4-hit rock: ~33% at hit 2, ~67% at hit 3).
   The progressive model never got the hits it needed to reveal
   anything.  It now STANDS DOWN under progressive fracture — the
   pattern owns the break rule (hit ceiling + min-remainder).  Legacy
   mode keeps it, pinned by an A/B test (40 rolls at the guaranteed-break
   end kill nothing under voronoi; one roll kills under legacy).
2. **The reveal ORDER completed almost nothing until the end.**  Edges
   were revealed nearest-the-impact first, globally.  But a cell leaves
   only when its LAST-ranked binding edge is revealed, and under a global
   distance sort most cells' last edge sits near the end of the list — so
   a 9-hit tile shed ONE piece mid-life and dumped the other five at
   death (measured).  The reveal is now grouped CELL BY CELL, nearest
   cell first: the highlight traces one piece's outline, that piece
   breaks off, then the next — which is the mechanic as described rather
   than a presentation tweak.
3. **The reveal finished exactly ON the killing hit**, so the last cells
   never had a chance to leave individually.  New
   `FRACTURE_DETACH.REVEAL_COMPLETE_FRAC` (0.55) finishes the pattern
   early and leaves the tail of the hit life for them.

**Tuning** (all one-line knobs): `ROCK_BREAK` 4/6 → 8/12 hits (every one
of them now visibly sheds material, so this is chipping, not sponge);
`MIN_REMAINDER_FRAC` 0.25 → 0.10; rock-tile pattern denser (sizePerSite
7 → 5, count 5-12 → 7-16) so more cells sit on the boundary and can
splice off.

Measured on real map tiles, six samples each, real projectile hits:

| | hits | pieces total | broken off WHILE ALIVE |
|---|---|---|---|
| rock tile, before V10 | ~2-3 (early-break roll) | 3-6 | ~0-1 |
| rock tile, after | 9 | 8 | 2-5 |
| glass tile, after | 5 | 7 | 2-3 |

**Rock's behaviour is now the default for glass too.**  glass-tile and
glass-shard carry `fracture.progressive`, and the chip call site is
generalised from a rock-only branch to any variant with the flag (via
the new shared `isProgressiveFracture` predicate, which the dent
stand-down and the early-break stand-down also read, so "progressive"
means one thing everywhere).  Reveal pacing is per material through the
new `crackConfigForVariant` lookup — the sim no longer hardcodes rock's
freq — so glass paces one step per Blaster hit and rock one per HP, both
from the same table the crack render reads.  Glass durability rose to
20 HP / 12 HP (5 / 3 Blaster hits) to give the reveal room to land
pieces.

**Found while wiring**: a damaged glass pane would have rendered as a
pristine full hex.  Glass has BOTH a static-cache stamp and a
hex-sprite fast path, and neither draws crack lines or a chipped
polygon.  New `tileShowsDamage` predicate now excludes a damaged tile
from both (it sits beside `hitFlash` / `regenPopTimer` in the same
acceptance checks, so the existing erase-on-flip path handles the
transition); the V9 crack-baking in the stamp is deleted as unreachable.

**Tests** (old → new): the min-remainder trick's recorded area ×5 → ×12
(the floor moved 0.25 → 0.10); the glass damage-layer test's pinned HP
12/8/4 → 20/16/12 and shard HP 8 → 12, and its final-hit loop now tolerates
the pane leaving early via chipping.  Three NEW tests: the early-break
A/B, a real rock tile shedding ≥3 pieces mid-life across ≥4 hits, and a
real glass tile chipping (pieces off + its own polygon area shrinking)
before the pane goes.  19/19 fracture green.

---

## V11 — Regular chunks, and the shape knobs (2026-08-29, user request)

> "Can we adjust the voronoi parameters to get more regularly shaped
> chunks? And perhaps provide some debugging toggles for these
> parameters if possible."

**LLOYD RELAXATION is the answer, and it is nearly free.**  Voronoi over
a purely random (Poisson) site set is *supposed* to look ragged — that is
what makes the cells uneven and sliver-prone.  The textbook cure is to
iterate toward a CENTROIDAL Voronoi tessellation: decompose, move every
site to its own cell's area-weighted centroid, repeat.  `computeFracture`
now takes `relaxIterations` and does exactly that (deterministic — no
PRNG use, so the seed still fixes the result; a site whose new centroid
lands outside a concave parent keeps its old position rather than
jumping into a hole).

Measured over 14 seeded rock polygons at 8 sites — cell-area coefficient
of variation, and mean roundness `4πA/P²` (regular hexagon 0.907,
square 0.785, slivers → 0):

| rounds | area CV | roundness | ms/decomposition |
|---|---|---|---|
| 0 (the V10 look) | 0.533 | 0.687 | 0.32 |
| 1 | 0.365 | 0.753 | 0.36 |
| **2 (shipped)** | **0.284** | **0.772** | 0.32 |
| 3 | 0.230 | 0.781 | 0.26 |
| 4 | 0.191 | 0.787 | 0.29 |

The cost column is the surprise and it is real: relaxation pays for its
own extra decompositions by removing slivers, which is what the
retirement loop was re-running the whole decomposition to fix.  The
suite's cost ceiling (5 ms at 30 sites) is untouched — measured 0.77 ms.

**Four DBG knobs** (pause ▸ Debug Menu ▸ Visual), all global rather than
per-variant because they are dials you turn while looking at the game:
`Frac relax` (0-4, default 2), `Frac sep` (site spacing before
relaxation, 0.2-0.75, default 0.45), `Frac sites` (×0.5-×2 on the
variant's site count) and `Frac bias` (force the impact crowding, or
leave it to the variant).  Every cycle bumps a TUNING GENERATION stamped
on each entity's cached pattern, so a knob change rebuilds patterns on
their next hit instead of only affecting freshly-spawned terrain — a
mid-life rebuild resets that body's chip progress, which is the right
trade for a debug control.  `Frac bias` deliberately pulls against
`Frac relax`: crowding sites toward the impact is precisely what makes
cell sizes uneven, so bias 0 + relax 4 is the most uniform look
available and bias 1 + relax 0 the most chaotic.

**Found while wiring**: `ensureFractureEdges` returned its cached edges
BEFORE consulting `ensureFractureCells`, which is the call that drops
both caches on a generation change — so a knob change would have left
the crack lines belonging to a pattern that no longer existed.  Cells
are consulted first now (still O(1) on a hit).

Chip behaviour is unchanged by the retune (rock 2-4 pieces shed mid-life
of 8 total, glass 1-2 of 7 — the V10 figures).  Two new tests: the
regularity statistics (ordering plus loose bounds, so tuning may move
the numbers but a regression that flattens the effect fails), and a
live-knob test proving a cycle rebuilds a cached pattern.  21/21
fracture green.

**Flake found and fixed in the V10 suite** (surfaced by the full run,
not by the file alone): the early-break A/B pinned a SINGLE legacy roll
at `hitsTaken` 7 of ceiling 8, which the curve puts at p = 6/7 — an
85.7% assertion, i.e. a ~14% flake, and the comment claiming a
"guaranteed-break end" was simply wrong.  Both sides now count 40 rolls:
voronoi must kill exactly 0 (deterministic — the stand-down returns
before any `Math.random`), legacy must kill at least one (p ≈ 1e-33 of a
false failure).  Verified with `--repeat-each 6`.

`tests/input.spec.ts` "the charge ring reads the pad hold" also failed
once in the same 14-minute run and passes on re-run; it is timing-
sensitive and untouched by this work, so it is noted rather than chased.

---

## V12 — Only the struck piece chips (2026-08-29, user request)

> "Ensure that shards that chip off are only shards that are contacted
> by a projectile.  This is intended to avoid shards chipping from
> internal to a cluster or shard."

**The impact point was never the impact point.**  Root cause, and it had
been there since V3: `fractureCache.localImpactPoint` SYNTHESISED a
contact position from `lastImpactVelocity` — a unit direction pushed out
to 0.4 × size — even though the damage path has the projectile's actual
position and was already passing it to `spawnDamageText`.  So the
pattern's site bias, the crack reveal order and (from V8) the detach
order were all anchored on a guess about where the shot came FROM rather
than where it landed.  `progressFracture` now takes the contact point,
converts it to entity-local (torus-safe, un-rotated) and stamps
`GameEntity.lastImpactLocal` BEFORE the pattern is built;
`localImpactPoint` prefers it and keeps the old proxy only for damage
sources that carry no contact point.

**The rule.**  A cell may detach only if the contact point touches it.
Distance is measured to each cell's OWN OUTLINE
(`fracture.pointToPolygonDistance2`, zero inside), not its centroid: a
projectile stops at the surface, so the contact sits just outside the
hull and a centroid comparison on a large body happily nominates a piece
on the far side — which is exactly the reported defect.  The struck cell
scores zero and wins outright.

**One relaxation, bounded.**  The struck cell can be boundary-complete
yet not spliceable off the current remainder (`subtractBoundaryCell`
needs one contiguous boundary run, which a piece flanking an earlier bay
may lack).  Measured: with a strict single-candidate rule, one rock tile
in five shed NOTHING before its final break.  So the search may walk to
the next-nearest candidate, but only within
`FRACTURE_DETACH.CONTACT_RADIUS_FRAC` (0.45 of the body's max dimension)
of the contact — far enough to reach a neighbour on the struck face,
never far enough to cross the body.  Truly interior cells were already
unreachable: `subtractBoundaryCell` refuses a cell that does not touch
the outer boundary, so "internal" in the strict sense was never
chippable; what this milestone removes is FAR-SIDE chipping.

**Measured** (real rock tiles, real projectile path, five samples):
2-4 pieces shed mid-life of 8 total — the V10 range (2-5), with every
chip now at the impact.

**Two harness corrections, both honest rather than convenient.**  The
chip-depth tests fired from a FIXED point outside the tile; a real
projectile travels until it overlaps the live polygon, so as pieces chip
away the contact follows the receding face inward.  The fixed point kept
testing a spot the tile no longer occupied, which under the new rule
reads as "no contact" — an artefact of the harness, not the game.  They
now track the surface.  Separately, the call-site edit that passes the
contact point silently no-opped on its first application (the search
string omitted a trailing clause); the instrumented probe caught it
immediately because `lastImpactLocal` came back undefined.

**Tests.**  Two new pins: shooting one face repeatedly with the pattern
held FULLY revealed — so the contact rule is the only thing standing
between a far-side piece and detachment — must leave every chip on the
struck side (verified against the regression: widening
CONTACT_RADIUS_FRAC to 5.0 fails it at -0.47 of a half-width, i.e. a
far-side piece); and a hit carrying no contact point cracks the body but
never detaches.  23/23 fracture green.

Full suite: 259 passed, 1 failed — `tests/shake.spec.ts` "a head-on hit
lurches the camera along the shove", which passes 3/3 on re-run and sits
in code this milestone does not touch.  Logged as a load flake in the
14-minute run, alongside the `input.spec` charge-ring one noted at V10;
neither is chased here, but two different timing-sensitive suites
flaking under full-run load is worth a dedicated pass if it recurs.
