# Gauntlet prompt — Voronoi fracture, and the asteroid rename

This is the PROMPT for a gauntlet session, in the format of the previous
ladders (`docs/GAUNTLET_5C_LOG.md`, `docs/GAUNTLET_LIGHTING_LOG.md`,
`docs/GAUNTLET_5F_LOG.md`). Paste it into a fresh session on a
`claude/voronoi-fracture-*` branch. The session's first act is to create
`docs/GAUNTLET_VORONOI_LOG.md` as its working ledger and copy the
checklist below into it.

---

> **GOAL.** Replace the simulated shatter with a real one. Today a
> tile or shard that dies is swapped for N fresh random star polygons —
> fragment COUNT and fragment GEOMETRY are decided independently
> (`ShardSystem.shatterAsteroidStyle`), the damage cracks drawn on a
> hurt entity are seeded radial spokes with no relationship to where it
> will actually break (`drawUtils.drawDamageCracks`), and "a shard
> breaking OFF a tile" is faked by spawning a chip entity beside an
> intact tile (`ROCK_CHIP` / `releaseRockChip`). After this gauntlet,
> every fracture-capable material carries a SEEDED VORONOI CELL
> DECOMPOSITION of its own polygon: the cells are the fragments when it
> shatters, the cell boundaries are the cracks it shows as it takes
> damage, and a hard-enough hit carves the cell(s) nearest the impact
> OFF the entity while the remainder survives with its clipped shape.
> Cracks predict the break, partial fracture replaces all-or-nothing
> shattering and the fake chip, and the pattern is deterministic per
> entity. Alongside it, the legacy "asteroid" vocabulary — an old
> remnant meaning nothing but "a large rock-shard spawned at map load"
> — is renamed out of the sim-side APIs.
>
> This closes `docs/GAME_FEEDBACK_PLAN.md` item 26
> (`voronoi-rock-fracture`), whose status note records the user
> direction explicitly: PR #65's `ROCK_BREAK`/`ROCK_CHIP` satisfied the
> feel goals (b)–(d), but "still wanted: the true Voronoi cell
> decomposition (a) — geometric sector chips carved out of the tile's
> own polygon, rather than the separate chip entities PR #65 spawns
> alongside an intact tile."

---

## Working rules for this branch

- **One milestone per iteration; findings before changes.** Each
  milestone opens with what was measured or read, then what was done,
  then the evidence. Every reverted attempt is recorded, never quietly
  dropped.
- **This is a BEHAVIOUR-CHANGE gauntlet**, unlike 5f. Tests that pin
  the old fragment arithmetic may be updated — but each such edit is
  logged with the old and new pinned values and WHY the new value is
  right, so a test change is a visible rebalance, not an accommodation.
  Tests unrelated to fracture must stay green untouched.
- **Three gates green before every milestone commit**: `npm run
  typecheck`, `npm run build`, `npm test` (the suites the change
  touches per commit; the FULL suite before calling the PR ready —
  §7 of CLAUDE.md).
- **Perf is a GUARD, not a goal.** Fracture runs inside death frames,
  and the worst death frames in this game are bulk — the boss rout, the
  snitch sweep, a cannon shell into a cluster. `node perf/simbench.mjs`
  before and after; a >10% sim regression means the decomposition is
  being computed somewhere hot. Budget rule: the Voronoi decomposition
  is computed LAZILY (first damage, or first crack draw) and CACHED on
  the entity, invalidated only when its inputs change (polygon deform,
  merge, dent). Never per frame, never at map load for thousands of
  tiles that may never be hit.
- **Repo invariants hold**: torus math via `wrapDeltaX`/`wrapDeltaY`
  for anything spatial; mutate-don't-allocate in per-frame paths (the
  refill idiom, hoisted closures); tiles stay `mass: Infinity` with
  `position === hexCoord`; every structure death still routes through
  `onDeath` → `handleEntityDeath`; area/mass conservation on every
  fracture (the sum of the children ≈ the parent, same rule the merge
  paths already keep).
- **`SHARD_VARIANTS` stays a shallow named-field table**
  (`docs/SHARD_SYSTEM.md` §2): the new fracture axis is a named config
  block on the variant def that ShardSystem reads — never a callback
  bag. A variant without the block keeps the legacy behaviour.
- **A DBG A/B toggle from day one** (pause ▸ Debug Menu ▸ Visual):
  `Fracture: voronoi / legacy`, so every milestone can be judged on a
  device against the shipped look. The legacy path is deleted only at
  the final milestone, after the user has called it.
- **CLAUDE.md and `docs/SHARD_SYSTEM.md` are part of the deliverable.**
  §4/§5/§8 of CLAUDE.md describe the shatter, chip, and crack machinery
  in detail; a reader who trusts them must still find the truth after.

---

## What the survey must verify first (V0 findings, not assumptions)

The seam map below was produced by a prior research pass. V0 confirms
or corrects it before anything moves:

1. **Fragment count and geometry are decoupled.**
   `ShardSystem.shatterAsteroidStyle` (~`ShardSystem.ts:785-1057`):
   count from `mergeCount` / size / `damageNorm`
   (`lastImpactDamage` 1..5), sizes from an equal-area or power-law
   budget, positions from a random scatter cone, and every child gets a
   FRESH random polygon from `generateShardPolygon`. Nothing inherits
   the parent's geometry.
2. **Rock-tile never reaches `shatter()`.** `handleEntityDeath` gates
   it out when the variant has `dent.breakShards`, so rock-tile,
   plastic-tile and metal-tile break via `DropSystem.spawnDentShard`
   instead. The Voronoi path must either become a third `shatter.kind`
   that these variants opt into, or replace `breakShards` — decide in
   V0 and log the reasoning.
3. **The crack overlay is already seeded per entity** —
   `crackSeedFor(entity)` caches a stable seed on `entity.crackSeed`,
   and `overlayMaterialCracks` reveals `(maxHp − hp) / freq` cracks as
   HP falls. This is the reuse seam: the SAME seed places the Voronoi
   sites, so the cracks the player watched grow are the boundaries the
   entity actually breaks along. (Note `hash01` is a sin-fract hack;
   `BackgroundManager`'s `0x6D2B79F5` mixer is the repo's real seeded
   PRNG precedent.)
4. **`inheritParentPolygon` exists and nothing uses it**
   (`ShardSystem.types.ts` breakShards schema) — the one existing hook
   for "children derive geometry from the parent".
5. **Metal is ALREADY cell-decomposed** — `metalCells` is a rigid
   triangular lattice, assembled shard by shard and taken apart
   cell-exact by `decomposeMetalComposite`. Metal's cells ARE its
   fracture pattern; the presumption is metal KEEPS the lattice and
   only its crack RENDER moves onto the lattice edges. Overturning that
   presumption requires findings.
6. **Simulated chipping** = `releaseRockChip` (`ROCK_CHIP`): a
   70%-chance chip entity spawned beside the still-intact rock on every
   non-lethal hit, with a conservation shrink for mobile rock. This is
   what partial fracture replaces.
7. **"Asteroid" is a name, not a thing.** There is no
   `EntityType.ASTEROID` and no `isAsteroid`; `BaseMapLayer
   .createAsteroid` returns a plain `rock-shard` STRUCTURE, just large.
   Survivors to inventory in V0: `spawnAsteroids` / `createAsteroid` /
   `handleAsteroidRespawn` / `EntityIndex.asteroids` (byte-identical to
   `shardCandidates` today) / `asteroidFlowEnabled` /
   `buildAsteroidField` + `sampleAsteroidFlow` / `ASTEROID_CRASH_MOMENTUM`
   + the `ASTEROID_PRESSURE_*` block / `COLORS.ASTEROID` /
   `SALVAGE_DROP_CHANCE_ASTEROID` / `PerfCounts.asteroidCount` / render
   comments and DBG labels. Special case: `asteroidHitCount/Timer/
   Cooldown` is a MISNOMER twice over — it is a tile PRESSURE
   accumulator counting sub-threshold impacts ON a tile, nothing to do
   with rock hit progression.

---

## Checklist

Copy into `docs/GAUNTLET_VORONOI_LOG.md`; work strictly in order; tick
with evidence.

- [ ] **V0 — Survey, baseline, seam plan.** Verify/correct the seven
      findings above with file:line citations. Capture baselines:
      `simbench` numbers; fragment counts and visual reference
      (screenshots or a short capture) for each material's current
      break at small/large size and light/heavy impact; the full grep
      inventory of `asteroid` (case-insensitive) with each hit
      classified rename / keep / delete. Decide and log: where the
      Voronoi config lives in `SHARD_VARIANTS`, which `shatter.kind`
      name it takes, and how rock-tile's `breakShards` path routes into
      it. No code changes beyond the log.
- [ ] **V1 — The fracture core, pure and pinned.** A seeded PRNG (the
      mulberry-style mixer, not `hash01`) + a bounded Voronoi
      decomposition of an arbitrary game polygon: N sites placed from
      the entity's `crackSeed` (optionally density-biased toward an
      impact point), cells clipped to the parent polygon. HAZARD to
      resolve here, not discover in V2: the jittered star polygons are
      NOT guaranteed convex (rock spawns at radius 0.60±0.55 with 0.5
      angle jitter), so clipping must survive concave parents — clip
      per-cell against the parent via a robust routine or triangulate
      first; decide on measurement. Pure functions, no engine imports,
      exposed on a debug handle (the `__omniHid` precedent) and pinned
      by a headless suite: determinism (same seed → same cells), area
      conservation (Σ cell areas ≈ parent area within ε), cell validity
      (no self-intersection, no degenerate slivers below a minimum
      area — merge slivers into neighbours), and a cost measurement
      (µs per decomposition at 4/8/16/30 sites — 30 is the current
      rock fragment cap).
- [ ] **V2 — Full shatter through the cells.** New `shatter.kind:
      'voronoi'` beside `'powerlaw'`; opted in by rock-shard and
      rock-tile first. On death, the cached decomposition (computed
      lazily at first damage; computed on the spot for a one-shot kill)
      becomes the children: each cell is a fragment with the CELL'S
      polygon (translated to the cell centroid), area-proportional mass
      and HP, velocity = impact scatter + a small radial term from the
      parent centroid so the pattern visibly flies apart along its own
      seams. Site count carries what `mergeCount`/size/damageNorm carry
      today — log the mapping as a rebalance. `densityTier` mixing,
      dust burst, drops and `killedByPlayer` attribution all preserved.
      DBG A/B judged on device. Update the pinned counts in the touched
      suites with the old→new table in the log.
- [ ] **V3 — Cracks are the pattern.** `overlayMaterialCracks` (and the
      shard/composite call sites) draw INTERIOR CELL EDGES of the same
      decomposition instead of radial spokes, revealed progressively as
      HP falls — nearest-the-impact edges first when an impact point is
      known. Per-material `CrackStyle` tables survive as stroke
      styling; the LOD bail (`MIN_APPARENT_RADIUS_PX`) survives; enemy
      hulls (`enemyShapes`) keep the OLD spoke look — they have no
      decomposition and are out of scope. Acceptance: kill a cracked
      tile and the fragments separate along the lines the player was
      just shown. Perf note: crack drawing is a per-frame render path —
      the decomposition cache must make this a lookup, and the static
      tile cache (`staticTileCache.ts`) must be invalidated when a
      tile's crack state changes exactly as it is today.
- [ ] **V4 — Partial fracture: shards break OFF tiles.** The headline
      feature. On a qualifying hit (threshold decided from the V0
      baseline feel; cumulative chip-area still drives the break
      threshold, per item 26c), the cell(s) nearest the impact DETACH
      as real mobile shards and the parent KEEPS the remainder: its
      polygon becomes the union of surviving cells (or simply loses the
      detached cells if union proves fragile — log the choice), its
      mass/HP scale by area removed, and the decomposition cache
      invalidates. This REPLACES `releaseRockChip`'s
      spawn-beside-an-intact-tile chips for rock, and the rock-tile
      `breakShards` all-at-once break becomes "the last cells
      detaching". Hazards to clear one by one, each with evidence:
      SAT/broadphase against the mutated polygon (the dent machinery
      already mutates `polygonPoints` in place — follow its rules,
      including the winding/K_MIN lesson); static grid + static tile
      cache erase/restamp on shape change; flow-field obstacle patching
      if the tile fully dies; regen (a regenerating tile regrows its
      FULL polygon — decide and log how partial loss interacts with
      the regen queue); minimum-remainder rule (a tile below ~25% area
      routes to full death rather than lingering as a sliver).
- [ ] **V5 — Roll across materials.** Glass: `spawnGlassShards` routes
      through the cells (glass is the material whose real-world
      fracture IS a Voronoi/radial hybrid — consider a site
      distribution biased radially from the impact for the look).
      Plastic: dents deform the polygon, so the decomposition is
      computed on the DEFORMED shape and invalidated per dent; plastic
      keeps its snap-back, and only a full break uses the cells.
      Metal: per the V0 presumption, keeps the lattice as its cell set
      — route its crack render (V3) along lattice edges and leave
      `decomposeMetalComposite` as the fracture; log the decision.
      Nebula: EXCLUDED — a soft cloud has no cracks; `shatterNebulaStyle`
      stays. Indestructible: excluded by definition.
- [ ] **V6 — The asteroid rename.** Sim-side APIs from the V0
      inventory rename to the `rock-shard` vocabulary
      (`getRockShardFreeSpawn` is the established precedent):
      `spawnAsteroids`/`createAsteroid`/`handleAsteroidRespawn`/
      `EntityIndex.asteroids` (fold into `shardCandidates` if still
      byte-identical — one list, not two names for it)/
      `buildAsteroidField`+`sampleAsteroidFlow`/the constants. The
      `asteroidHitCount` trio renames to what it IS (tile pressure).
      KEEP: `MapType.ASTEROID_FIELD` + descriptor id + display names +
      DBG row labels — "asteroid" is fine as FLAVOUR for a big rock in
      player-facing text; the cleanup target is the type system and
      the APIs, where the word implies a distinct entity kind that
      does not exist. Zero behaviour change in this milestone; gates
      green prove it.
- [ ] **V7 — Ship it.** Legacy `'powerlaw'` paths that no variant uses
      any more are deleted (the ones nebula still uses stay); the DBG
      A/B collapses to the shipped behaviour only if the user has
      called it — otherwise it stays for the play-test. `ROCK_CHIP`
      deleted or reduced to dust-only cosmetics per the V4 outcome.
      Docs synced: CLAUDE.md §4/§5/§8 (crack overlay, shatter, chip,
      the renames), `docs/SHARD_SYSTEM.md` (new fracture axis),
      `docs/GAME_FEEDBACK_PLAN.md` item 26 closed with a pointer to
      the log. Full `npm test`, `simbench` vs the V0 baseline, and a
      final before/after visual capture in the log.

---

## Out of scope

Angular momentum / off-centre impact torque (parked in
`docs/PARKING_LOT.md`, its own session); enemy-hull crack styling
beyond keeping the current look; any change to regen TIMING or the
merge system beyond cache invalidation; WebGL/WebGPU anything.
