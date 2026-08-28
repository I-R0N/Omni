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
- [ ] **V1 — The fracture core, pure and pinned.**
- [ ] **V2 — Full shatter through the cells.**
- [ ] **V3 — Cracks are the pattern.**
- [ ] **V4 — Partial fracture: shards break OFF tiles.**
- [ ] **V5 — Roll across materials.**
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
