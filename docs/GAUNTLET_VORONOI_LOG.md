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
- [ ] **V6 — The asteroid rename.**
- [ ] **V7 — Ship it.**

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
