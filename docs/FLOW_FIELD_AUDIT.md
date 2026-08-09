# Flow Field Audit — Asteroid/Shard FF

Scope: `engine/systems/FlowField.ts` and the asteroid-flow portion of
`engine/systems/FlowFieldGrid.ts`. The enemy pursuit field is covered
only in the differential audit (§3); pursuit-field tooling and
behaviour changes are deferred to a later phase.

---

## 1. What each system does today

### `FlowField.ts` — analytical sampler

A 23-line module that exports one function: `sampleFlow(wx, wy)`. The
formula is direction-only — every sample returns a unit vector chosen
by a periodic angle function (sine over `MAP_WIDTH`, cosine over
`MAP_HEIGHT`, biased by an irrational base angle). The intent is a
non-closing meander that's continuous across the wrap seam, with no
stagnation points anywhere on the torus.

**Where it's actually called** (CLAUDE.md §2 claims "map-load asteroid
seeding only" — the truth is broader):

1. `BaseMapLayer.sampleFlow` default implementation (used by
   `UniverseMap` and `PocketMap`; other maps override with
   `concentricRingFlow`).
2. Through that default, called from:
   - `BaseMapLayer.spawnAsteroids` — once per asteroid at map load
     (streamline integrator + initial velocity bias).
   - `BaseMapLayer.createAsteroid` — also called on every asteroid
     **respawn during gameplay** via `GameEngine.handleAsteroidRespawn`,
     not just at map load.
3. `FlowFieldGrid.flowSampler` initial value — but
   `GameEngine.loadMap` immediately overrides this with the map's own
   `sampleFlow` (see `GameEngine.ts:2435`), so this default is only
   reachable in a degenerate "no map loaded" state.

So the global analytical sampler runs at map load **and on every
asteroid respawn**. CLAUDE.md is approximately right but understates
the live coupling — recommend a one-word correction in the next
CLAUDE.md sweep ("map-load and respawn asteroid seeding").

### `FlowFieldGrid.ts` — asteroid-flow portion

- **Cell size:** `CELL_SIZE = 256` world units. On the default 6 k
  showcase maps this gives `FF_COLS = FF_ROWS = 24`, `TOTAL = 576`
  cells.
- **Storage:** `astFlowX` / `astFlowY` Float32Arrays of size `TOTAL`,
  plus a shared `blocked: Uint8Array(TOTAL)` obstacle bitmap.
- **Computation:** *not* BFS. Each cell samples the active map's
  `sampleFlow()` at the cell centre to get a base direction, then
  deflects away from each blocked cardinal neighbour by `WALL_REPULSE
  = 1.2` along the neighbour's axis. Final vector is normalised; if
  repulsion zeroed the result (inside-corner case) the cell falls back
  to the un-deflected base direction.
- **Rebuild triggers:**
  - **Full rebuild:** once per map load, in `buildAsteroidField` —
    `O(TOTAL)` calls into `_computeAsteroidCell` (≈ 576 on 6 k maps).
  - **Incremental rebuild:** in `onTileDestroyed` — 5 cells (the
    cleared cell + 4 cardinal neighbours) per tile destruction.
- **Obstacle filter** (the PR #54 fix): static tiles only (`mass ===
  Infinity`), and explicitly excludes `shardVariant === 'nebula-tile'`
  because nebula tiles are pass-through to projectiles and shouldn't
  force flow to bend around them.
- **Consumption:** `sampleAsteroidFlow(wx, wy)` is called every frame
  per asteroid and per ammo-drop in `GameEngine.updatePhysics`
  (`applyFlow`). If the cell is blocked or zero, the call falls back
  to the active `flowSampler` (the map's own `sampleFlow`).

---

## 2. Observable issues

Severity tier per finding: **L1** = trivial/cosmetic, **L2** = real
but bounded, **L3** = warrants a follow-up brief. None today are
**L4** (game-breaking).

| # | Finding | Tier |
|---|---------|------|
| 1 | File-header docstring claims "Two separate BFS distance fields" — asteroid field is **vortex-based, not BFS** | **L1** — fixed in passing this PR |
| 2 | No perf timer for the asteroid field. `flowFieldMs` covers only `flushEnemyField`; the once-per-map asteroid bake and per-destruction 5-cell recompute are untimed | **L2** |
| 3 | `applyFlow` zero-flow behaviour: when `sampleAsteroidFlow` returns `{0,0}`, the velocity nudge steers the entity toward zero velocity (because `tx = 0 * speed = 0`). It does **not** "do nothing" — it actively damps. Documented & toggleable via this PR's `AstFF` button | **L2** — documenting |
| 4 | Grid edge vs torus seam: on the 6 k map, `FF_COLS * CELL_SIZE = 6144` > `MAP_WIDTH = 6000`. Column 23 covers world-x `[2888, 3000)` instead of a full 256, so its centre sample is slightly off-centre. `worldToCell` modulo-reduces correctly, so no out-of-bounds, but the effective sample point for one wraparound cell is asymmetric | **L2** — note only; map sizes are tuned to within ~2 % of an integer cell multiple anyway |
| 5 | `sampleAsteroidFlow` fallback path: when a cell is blocked, the live entity gets the analytical sampler value, *not* a deflected version. An asteroid that has been knocked into a tile cell gets the bare vortex direction back, which may push it deeper into the wall before the next collision impulse fires | **L3** — see follow-up brief #FF-1 |
| 6 | Wall-repulsion only considers 4 cardinal neighbours. Inside a 1-cell-wide channel between two parallel walls, both opposing repulsions cancel and the asteroid drifts straight down the channel until it hits something at the end. Diagonal-blocked cases (e.g. corner just past the cell boundary) get no repulsion at all | **L3** — see follow-up brief #FF-1 |
| 7 | Incremental patching for the **asteroid** field is just a 5-cell direct recompute — no wavefront propagation. That's correct (removing a wall only affects the local repulsion of the immediate 4 neighbours), but the same is **not** true if `WALL_REPULSE` were ever made distance-dependent. Note this so a future tuning pass doesn't accidentally break the invariant | **L1** — note |
| 8 | Obstacle filter (`mass === Infinity && shardVariant !== 'nebula-tile'`) correctly handles today's mix. **Risk:** if g3 / sticky-plastic introduces dynamic-but-static-looking tiles (e.g. mass set to finite to enable shove, but logically still "wall-like"), they'd silently drop out of the obstacle bitmap. Worth re-checking once g3 lands | **L3** — see follow-up brief #FF-2 |
| 9 | Torus wrap of the BFS / cell index math: handled correctly via modular `(row + DR4[k] + FF_ROWS) % FF_ROWS`. The asteroid sampler `flowSampler(wx, wy)` uses the analytical formula which is periodic by construction. No seam discontinuity in either field | **L1** — working as intended |
| 10 | Cost of full rebuild vs incremental patch: with `TOTAL = 576` and one `sampleFlow` + 4 `blocked[]` reads per cell, the bake is sub-millisecond at map load and never re-runs. Incremental cost is 5 cells × O(1) work per tile destruction — negligible. No perf concern; only the **enemy** field can pathologically thrash (see §3) | **L1** — working as intended |

---

## 3. Differential audit & consolidation

### What each system produces uniquely

| Capability | `FlowField.ts` (analytical) | `FlowFieldGrid.astFlow` (baked) |
|---|---|---|
| Continuous-domain sample at arbitrary `(wx, wy)` | Yes | No — quantised to 256-unit cells |
| Wall awareness | None | Yes — `WALL_REPULSE` deflection |
| Cost per sample | ~4 trig ops | 2 array reads |
| Used at map-load streamline integration | Yes (`spawnAsteroids` walks the analytical streamline before any grid exists) | No |
| Used as runtime fallback when a cell is blocked or zero | Yes — via the cached `flowSampler` | — |
| Used as the per-cell base direction inside the grid | Yes — `_computeAsteroidCell` calls `flowSampler(wx, wy)` | — |

The two are **complementary, not duplicative**. The grid bakes the
analytical formula + adds wall awareness. The analytical sampler is
still load-bearing for the map-load streamline integration and for
asteroid-respawn velocity biasing, both of which happen before/outside
the per-frame grid loop.

### Could either system be retired?

- **Retire `FlowField.ts` and sample the grid at map load?** No.
  `BaseMapLayer.spawnAsteroids` integrates a streamline path *before*
  the entities array exists, before `FlowFieldGrid.initObstacles` is
  called, before the grid is even allocated for this map's
  dimensions. The grid is a downstream consumer.

  You could in principle move the analytical formula *into*
  `FlowFieldGrid` as a static function and have `BaseMapLayer` call
  it from there, but that's a rename, not consolidation — the formula
  still exists. And `BaseMapLayer` already has an override mechanism
  (concentric rings on three maps), so the formula isn't really
  shared code anyway.

- **Retire the baked grid and call `sampleFlow` per asteroid per
  frame?** No. The grid's wall-repulsion behaviour is the entire
  point — without it, the asteroid field has no awareness of tile
  clusters. And on a 6 k map with ~400 asteroids you'd be doing 400 ×
  4 trig ops per substep where today it's 400 × 2 array reads, plus
  losing the wall-repulsion deflection.

### Pursuit field overlap

The pursuit field shares:

- The same `blocked: Uint8Array` obstacle bitmap (initialised once in
  `initObstacles`).
- The same `worldToCell` coordinate helper.
- The same `DR4` / `DC4` neighbour arrays.
- The same `fullQ` / `inFullQ` BFS scratch buffers (sized for the
  whole grid).
- The same `_ensureCapacity` reallocation path on map-dimension
  change.

It does **not** share:

- The flow-vector storage (`astFlowX/Y` vs `eneFlowX/Y` —
  intentional; the two fields point in totally different directions).
- The compute path (vortex + repulsion vs BFS distance + gradient).
- The incremental update logic (5-cell direct recompute vs
  forward-BFS patch).

The shared parts are well-factored — the obstacle bitmap is a single
source of truth and both fields read it correctly. **Not a candidate
for consolidation.** The fields cohabit cleanly; splitting them into
two classes would force duplication of `initObstacles`, the
ensure-capacity logic, and the coordinate helpers without
meaningfully decoupling anything.

### Recommended consolidation path

**None.** The two flow modules are sized appropriately for what each
does, and the cross-system reads are clean (analytical → baked,
single direction, single call site for the sampler closure).

If we were going to do any unification work, the highest-value move
would be (a) merging the analytical formula into `FlowFieldGrid` as a
static `DEFAULT_FLOW_SAMPLER` constant, removing the standalone
`FlowField.ts` file — **trivial rename, no behavioural change, ~30
LOC saved**. Effort: 30 minutes. **Recommendation: don't bother**
unless you're already touching the file for unrelated reasons. The
current separation reads cleanly and the import surface is tiny.

---

## 4. Recommendations summary

| Finding | Disposition |
|---|---|
| #1 (BFS docstring) | Fixed this PR (one-line edit, doc only) |
| #2 (no asteroid-field perf timer) | Follow-up brief **#FF-3** (low priority — the work isn't hot) |
| #3 (zero-flow = damping toward zero) | Documented; surfaced via the `AstFF` DBG toggle this PR |
| #4 (cell-grid vs map-width mismatch) | Working as intended, just noting it |
| #5 (blocked-cell fallback returns un-deflected base) | Follow-up brief **#FF-1** (re-tune fallback) |
| #6 (4-cardinal-only wall repulsion) | Follow-up brief **#FF-1** (re-tune fallback) |
| #7 (5-cell direct recompute correctness coupling) | Working as intended, noted |
| #8 (g3 plastic-softbody obstacle filter risk) | Follow-up brief **#FF-2** (revisit after g3 lands) |
| #9 (torus seam math) | Working as intended |
| #10 (full-rebuild + incremental patch cost) | Working as intended |
| Consolidation question | **Don't consolidate.** FlowField.ts + FlowFieldGrid.astFlow are complementary, not overlapping |

### Follow-up briefs to queue

- **#FF-1** — Asteroid-field obstacle-aware fallback & diagonal
  repulsion. Two related tweaks: (a) when `sampleAsteroidFlow` hits a
  blocked cell, return the **nearest open cell's** baked vector
  instead of the un-deflected analytical value, and (b) extend
  `WALL_REPULSE` to consider the 4 diagonal neighbours at reduced
  weight. Either change affects asteroid feel in narrow channels and
  near tile-cluster boundaries; needs A/B tuning with the new DBG
  overlays.

- **#FF-2** — Revisit the obstacle filter (`mass === Infinity &&
  shardVariant !== 'nebula-tile'`) once g3 / sticky-plastic ships.
  Specifically, check whether plastic tiles with finite mass that
  still behave as walls should be re-added to the bitmap by some
  flag other than `mass === Infinity`.

- **#FF-3** — Add a perf timer for the asteroid-field bake +
  incremental patch path. Cheap to add; would let us catch
  regressions if the formula ever gets more expensive (e.g. blue-noise
  domain warp, fractal turbulence layer).
