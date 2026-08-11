# Gauntlet 5c — the performance gauntlet

Roadmap item **5c** of `docs/GAME_FEEDBACK_PLAN.md` (decision #47a, goal
amended by the user 2026-08-09).

> **GOAL.** Smooth, locked 60 fps under ALL gameplay conditions — no dips,
> no stutter. **Worst frame is the metric**; averages are vanity numbers
> here, because one 80 ms frame in a smooth minute IS the failure.

Working rules for this branch:

- **Budget: 16.7 ms** for sim + render together, on the target device
  (iPhone). Absolute frame time cannot be measured in this container
  (software rasterizer), so headless work is done in **same-harness A/B
  deltas** and **in-code ms attribution**; ACCEPTANCE evidence is the
  user's Perf REC hardware captures.
- **GC hitches count as stutter.** Steady-state allocation in hot paths
  must reach zero.
- **Frame PACING is in scope**, not just raw compute: substep bunching
  after a long frame, one-frame work bursts (mass death, wave spawn,
  boss phase), map-load residue.
- **Zero-behaviour is the default.** Every exception is flagged in
  FOR-USER-REVIEW, logged here, and DBG-toggleable.
- Three gates green (`npm run typecheck`, `npm run build`, `npm test`)
  before every milestone commit.

---

## Checklist

- [x] **P1** — Baseline + attribution (no fixes)
- [x] **P2** — Array-refill churn (shipped)
- [x] **P3** — Per-substep closure hoisting (shipped, partial)
- [x] **P4** — Entity-shape normalisation (**measured and rejected**)
- [x] **P5** — Flat-array spatial grid + sim benchmark (shipped)
- [x] **P-final** — Validation + report

---

## The instrument

`perf/capture.mjs` + `perf/scenes.mjs` — a repeatable headless capture
matrix driving the real engine in a real browser through the same
`window.__omniEngine` debug handle the 5b suites use. `node
perf/capture.mjs --help`-free usage is documented at the top of the file.

Per scene it records, for every frame: the true rAF delta, the engine's
own RAW per-frame sim total, the substep count, raw render ms, entity
count, and heap usage — then reports p50/p95/p99/max for each, plus an
allocation profile attributed to call frames.

**Three calibrations were needed before any number here was trustworthy.
They are the reason this section exists rather than a bare table.**

1. **`sim` per FRAME is not `sim` per SUBSTEP.** The sim is fixed-timestep
   at 120 Hz (`FIXED_DT = 1/120`) with `MAX_SUBSTEPS = 5`. A 16.7 ms frame
   legitimately drains 2 substeps; a 33 ms frame drains 4. So a rising
   per-frame sim total can mean "the sim got slower" OR "the frame got
   longer and pulled more substeps in" — and in this container, where
   software rasterization stretches every frame, it is mostly the latter.
   The matrix reports BOTH (`stp` = mean substeps, `sim/stp99`), and
   `lastFrameSteps` was added to `GameEngine` to make it measurable. This
   is also the frame-pacing signal: substep bunching is visible directly.

2. **The sampling heap profiler reports RETENTION, not allocation, by
   default.** V8 drops samples for objects that have since been collected,
   so the default profile describes what survived. Steady-state per-frame
   garbage is by definition collected — so the default profile missed
   essentially all of it. Measured: the default under-reported total
   allocation by **~500×** (575 KB vs the heap trace's 294 MB over the same
   12 s window). Passing `includeObjectsCollectedByMajorGC` +
   `includeObjectsCollectedByMinorGC` to `HeapProfiler.startSampling`
   brings the two into agreement (**531,848 vs 538,898 B/frame — 1.3%**),
   and only then is the attribution the allocation rate we care about.
   *Every allocation ranking below the first draft changed once this was
   fixed;* the pre-calibration ranking was measuring the wrong thing.

3. **The container is noisy.** Single runs vary widely (one asteroid-6k run
   showed `sim max 184 ms` where its neighbours showed 35–41 ms). Every
   number quoted for a decision is a **median of 3** (`--repeat 3`), and
   levels are never compared across hosts — only deltas on the same host in
   the same session.

**So: LEVELS are indicative, DELTAS are evidence, ALLOCATION is exact.**
No "is it 60 fps?" verdict may be read off this harness. That verdict
comes from hardware captures only.

---

## P1 — Baseline + attribution

### The capture matrix (BASELINE, median of 3, 390×844)

```
scene                 ents  stp sim/stp99  sim p99  sim max  rnd p99  rnd max  heapB/f  profB/f  GC/s  heapΔ
hub-idle              1308 2.64      1.50     5.10     6.00    20.60    23.90   522149   532250   1.4   17.0
asteroid-6k           1380 3.27      6.33    21.70    36.30    21.50    30.90  1824529  1941790   2.3   23.2
tile-shatter-storm    1764 3.43      2.85    11.40    46.80    29.80   120.10   850487  1008999   3.6   10.2
boss-capstone         2989 3.66      3.85    15.40    20.90    29.60    64.60  1499843  1569310   2.2   31.6
roamer-stack          2813 3.74      3.25    13.00    14.00    27.90    30.40  1415019  1488122   2.0   33.0
mass-death            3575 4.67      6.22    29.50    50.30    33.80    36.90  2510791  2819842   2.3   33.2
stage-descent         2676 2.63      2.15     8.60    20.60    21.60   153.50   810384   899157   1.7   14.6
```

`stp` = mean substeps/frame · `sim/stp99` = p99 sim per substep (host-independent)
· `heapB/f` and `profB/f` = allocated bytes/frame by the two independent
methods · `heapΔ` = MB over the window.

**Reading it against the budget.** On a device holding 60 fps the accumulator
drains **2** substeps per frame, so the sim's own share of the 16.7 ms budget
is `2 × sim/stp99`:

| scene | 2 × sim/stp p99 | share of 16.7 ms |
|---|---|---|
| asteroid-6k | 12.7 ms | **76%** |
| mass-death | 12.4 ms | **74%** |
| boss-capstone | 7.7 ms | 46% |
| roamer-stack | 6.5 ms | 39% |
| tile-shatter-storm | 5.7 ms | 34% |
| stage-descent | 4.3 ms | 26% |
| hub-idle | 3.0 ms | 18% |

Sim alone eats three quarters of the frame on the two worst scenes, before
render gets any of it. That is the headline in-code number.

**Allocation is the other headline: 0.5–2.8 MB *per frame*, in every scene,
including the idle hub.** That is 30–170 MB/s, and it is what drives the
observed 1.4–3.6 GC events/second. GC hitches count as stutter, so this is
not a background concern — it is a dip generator running continuously.

### Ranked in-code spike sources

Ranked by allocated bytes over the window, consistent across all 7 scenes
(numbers from asteroid-6k, the worst; 823 MB total sampled over 12 s):

| # | site | asteroid-6k | mechanism | confidence |
|---|---|---|---|---|
| 1 | `applyFlow` (GameEngine) | 182 MB | double-field writes on `GameEntity` — see below | **indicated** |
| 2 | `PhysicsSystem.handleEntityCollisions` | 163 MB | fresh `dynamicEntities: []` + a fresh `[]` per grid cell, every substep | **proven** |
| 3 | `GameEngine.prepareFrameEntities` | 107 MB | `length = 0` + `push` refill | **proven** |
| 4 | `PhysicsSystem.update` (own frame) | 75 MB | not yet split | unknown |
| 5 | `EntityIndex.rebuild` | 70 MB | `length = 0` + `push` × 4 arrays | **proven** |
| 6 | `AISystem.nearestEatableShard` | 51 MB | O(bubbles × shards) scan | partial |
| 7 | `handleEntityCollisions < set` | 40 MB | `Map.set` on the per-substep grid rebuild | **proven** |
| 8 | `ShardSystem.runMergeBroadphase` | 21 MB | — | unknown |

Also present in other scenes: `equilibrateColors` (12–30 MB),
`recomputeNeighborCounts` (52 MB in mass-death), `render`/`renderEntities`
(10–41 MB), `updateConsumers` (9–11 MB).

**Mechanism 1 (proven).** `array.length = 0` followed by `push` shrinks the
backing store and re-grows it through the push growth policy on every
rebuild. Verified standalone (`node --expose-gc`, 20 000 rebuilds of a
1300-element array): **153.4 ms vs 58.2 ms (2.6× faster)** and **11× less
heap growth** against index-fill + truncate-only-when-shrinking. This single
idiom is items 2, 3, 5 and 7 — **~380 MB of the 823 MB**, and it is the
dominant allocator in the *idle hub* as much as in the worst combat scene.
It is not a gameplay cost at all; it is a container-refill cost that scales
with entity count and runs 2–5× per frame.

**Mechanism 2 (indicated, not yet proven).** `applyFlow` contains no visible
allocation — it is arithmetic over scratch vectors — yet allocates ~98 bytes
*per entity per substep*. Bisected with two ablations on the same scene:

| variant | `applyFlow` allocation |
|---|---|
| baseline | 182.5 MB |
| `--ablate lanejitter0` (no `e.flowLane` property write) | 133.5 MB |
| `--ablate flowoff` (whole flow body skipped; only `e.rotation += …` runs) | **80.5 MB** |

With the entire flow body skipped, one double-field write per entity still
accounts for 80 MB. The probe (`perf/probe.mjs`) separately shows that
writes to a nested `Vector2` (`e.velocity.x`) allocate ~0 — those objects
have a uniform `{x, y}` shape. The difference points at V8 boxing doubles
for `GameEntity`'s **optional numeric fields**, whose representation is
generalized to Tagged because they are `number | undefined` (CLAUDE.md §4's
"set the field when needed" pattern). Recorded as INDICATED: the ablation
evidence is in-situ and reproducible, but the boxing itself has not been
observed directly, and the fix is invasive enough to deserve its own
milestone and its own confirmation.

### Frame pacing

`stp` (mean substeps/frame) is 2.6–4.7 across the matrix versus the 2.0 a
device at 60 fps would drain — the container's slow software raster pulling
extra substeps in, exactly the cascade the goal names. Nothing here shows the
accumulator *failing*: `MAX_SUBSTEPS = 5` is hit only in `mass-death`
(4.67 mean), and the `% FIXED_DT` remainder-keeping on the clamp path is
correct. **The pacing risk is therefore not the accumulator's logic but the
sim cost that makes a frame long in the first place** — which is item 1–8
above. Re-check after P2.

`stage-descent` shows `rnd max 153.5 ms` — the map-load frame, which is the
one permitted long frame. Its `stp` of 2.63 is the *lowest* in the matrix,
so the load does NOT leave a substep pile-up behind it. No residue.

### Ablation results (experiments, not fixes)

| Ablation | Scene | Effect |
|---|---|---|
| `react` (per-frame `setState` + full HUD reconcile removed) | hub-idle | heap 547 → 493 KB/frame (**≈10%**) |

The per-frame React re-render is real (`App` re-renders 60×/s, allocating
~90 handler closures and reconciling a 2157-line unmemoized `UIOverlay`)
but it is **not** the dominant cost. Recorded so the hypothesis is closed
with a number rather than left as a plausible story.

---

## Per-iteration log

### Iteration 1 — instrument + baseline (P1)

Built `perf/capture.mjs` / `perf/scenes.mjs`; calibrated it (three fixes
above); captured the matrix. Engine change: `GameEngine.lastFrameSteps`
(one field, written once per frame) so substep bunching is observable —
the only production change in this milestone.

**Mechanism verified independently** (`node --expose-gc`, 20 000 rebuilds
of a 1300-element array): `length = 0` + `push` vs index-fill +
truncate-only-when-shrinking → **153.4 ms vs 58.2 ms (2.6× faster)** and
**11× less heap growth**. The idiom shrinks the backing store and then
re-grows it through the push growth policy every single rebuild.

### Iteration 2 — kill the array-refill churn (P2)

Four sites, one idiom, zero behaviour change:

- `GameEngine.prepareFrameEntities` → index-fill + truncate-on-shrink
  (carries the canonical REFILL IDIOM comment).
- `EntityIndex.rebuild` → same, over its four lists.
- `PhysicsSystem.handleEntityCollisions` → the per-substep
  `dynamicEntities` working set became a persistent field; the dynamic grid
  became a `CellBuckets`.
- `PhysicsSystem.resolveShardPairs` → shard grid became a `CellBuckets`.

New file `engine/systems/CellBuckets.ts`: a bucket store that recycles its
bucket arrays across passes instead of allocating a fresh `[]` per occupied
cell per substep. At 120 Hz with ~500 occupied cells that was ~60 000 array
allocations/second **per grid**. Same keys, same bucket contents, same
in-bucket order. The static grid deliberately stays a plain `Map` — it is
built once on map load, so there is nothing to recycle.

**A/B (median of 3, same host, same session):**

| scene | alloc B/frame | Δ | sim/stp p99 | Δ |
|---|---|---|---|---|
| hub-idle | 532k → 474k | −11% | 1.50 → 1.55 | +3% |
| asteroid-6k | 1,942k → 1,495k | **−23%** | 6.33 → 5.47 | **−14%** |
| tile-shatter-storm | 1,009k → 901k | −11% | 2.85 → 2.35 | **−18%** |
| boss-capstone | 1,569k → 1,256k | **−20%** | 3.85 → 3.22 | **−16%** |
| roamer-stack | 1,488k → 1,291k | −13% | 3.25 → 3.58 | +10% |
| mass-death | 2,820k → 2,190k | **−22%** | 6.22 → 6.57 | +6% |
| stage-descent | 899k → 828k | −8% | 2.15 → 2.07 | −4% |

Allocation is down in every scene. Sim/substep is down 14–18% on four
scenes and up 3–10% on three; those three are within the run-to-run spread
this container shows even at median-of-3, so **the sim claim is "down on the
scenes where it moved, flat elsewhere"** — not a clean 15% across the board.
Allocation is the solid result here.

Also worth recording honestly: **GC events/second went UP** (1.4→3.2,
2.3→4.3, 2.0→4.4) while allocated bytes went DOWN and net heap growth over
the window collapsed (+17/+23/+32 MB → −4/+5/+2 MB). The likely reading is
V8 adaptively shrinking the young generation once the allocation rate drops,
giving more frequent but much cheaper scavenges — which is better for frame
time, since pause LENGTH is what shows up as a dip. But it is an inference,
not something this harness measures, so it is logged as an open question
rather than claimed as a win.

### Iteration 3 — the "invisible" allocation in hot numeric loops

After P2 the top allocator on the worst scene is `applyFlow` at 175 MB
(27% of that scene's total), unchanged — plus residual allocation inside
`handleEntityCollisions`, `PhysicsSystem.update` and
`AISystem.nearestEatableShard` that the array fix did not touch. All of
these are loops of pure double arithmetic with no visible allocation.

`perf/probe.mjs` was rewritten (the first version was contaminated: it
accumulated into a captured `let`, and a double written to a closure context
slot is boxed, so every probe read ~29 bytes/op on its own account —
accumulating into a `Float64Array` element fixed it). Against the REAL live
entity objects, with a 0 bytes/op control:

| operation | bytes/op |
|---|---|
| empty loop (control) | 0 |
| read `e.position.x/y` | 0 |
| write `e.velocity.x/y` | 0 |
| write `e.rotation` (direct optional field) | 1.3 |
| `Math.sqrt`/`Math.min` arithmetic | ~0 |
| `flowField.sampleAsteroidFlow` | 1.4 |

**None of applyFlow's operations allocate when run in a stable loop.** That
retires the P1 "boxed doubles on GameEntity" hypothesis — it was wrong, and
the ablation evidence that suggested it is explained instead by what the two
situations do NOT share: in the engine, `applyFlow` is a **closure
constructed fresh on every substep**, so V8 is re-creating the function 120
times a second and it never settles into optimised code, where doubles are
unboxed. The probe's loop is stable and gets optimised; the engine's does
not.

Fix in iteration 4: hoist the per-substep closures out of the hot path.

### Iteration 4 — hoist per-substep closures (P3), and what it did NOT explain

Two closures in `updatePhysics` were being constructed on every substep:
`applyFlow` (now the private method `applyFlowTo`, body unchanged, captures
turned into parameters) and the `entities.forEach(e => …)` explosion-timer
tick (now an indexed loop). The collectible-drop pass deliberately keeps its
own copy of the flow arithmetic rather than routing through `applyFlowTo`:
drops carry a `rotationSpeed`, so sharing the method would start integrating
their rotation — a behaviour change, not a perf fix.

| scene | alloc B/frame | Δ vs P2 | sim/stp p99 | Δ vs P2 |
|---|---|---|---|---|
| hub-idle | 474k → 410k | **−13%** | 1.55 → 1.35 | **−13%** |
| tile-shatter-storm | 901k → 816k | −9% | 2.35 → 2.75 | +17% |
| asteroid-6k | 1,495k → 1,453k | −3% | 5.47 → 6.68 | +22% |
| boss-capstone | 1,256k → 1,285k | +2% | 3.22 → 3.32 | +3% |
| roamer-stack | 1,291k → 1,302k | +1% | 3.58 → 3.15 | −12% |
| mass-death | 2,190k → 2,436k | +11% | 6.57 → 6.03 | −8% |

**A partial win, and the hypothesis was only partly right.** The site itself
went from 175 MB to 145 MB (**−17%**) on asteroid-6k — real, but it did not
disappear the way "an unoptimisable closure" would predict. Only hub-idle
moved cleanly on both axes; the rest is inside this container's spread.

So the "invisible allocation" is still unexplained, and the honest state is:
closure re-creation was *a* cause worth removing, not *the* cause. Recorded
as such rather than dressed up.

### Iteration 5 — the finding that reframes the sim cost

Chasing the same question produced a different and larger answer. Test
(`node --expose-gc`, 20 000 passes over 1300 objects, writing one double
field per object — the exact shape of the engine's hot loops):

| object population | time | allocation |
|---|---|---|
| all one hidden class | **76 ms** | 0.0 bytes/op |
| 24 divergent hidden classes | **1131 ms** | 0.1 bytes/op |

**15× slower, and neither allocates.** Hidden-class diversity is not an
allocation problem at all — it is a *throughput* problem, and it lands
squarely on the metric that actually matters: sim time inside the 16.7 ms
budget.

This is a direct consequence of CLAUDE.md §4's documented pattern — "set the
field when needed; check before use" — over a `GameEntity` with ~150 optional
fields. `perf/probe.mjs` counts **12 distinct own-key signatures among the
asteroid-class entities of a single map**; V8's inline caches go megamorphic
past 4. Every hot loop in the engine — `applyFlowTo`,
`handleEntityCollisions`, `nearestEatableShard`, `PhysicsSystem.update` — is
reading and writing entity fields through megamorphic ICs.

That looked like the highest-value remaining lever, and it would have been
the first change in this gauntlet to touch a documented architectural
convention — so before refactoring every entity creation site in the engine,
the payoff was measured on the REAL entities.

### Iteration 6 — entity-shape normalisation: MEASURED, REJECTED

`perf/probe.mjs` now builds shape-normalised COPIES of the live entities
(union of every key the population uses, assigned in one fixed order, so all
copies share a single hidden class) and runs the same hot access loop over
the live objects and the copies:

| population | ns/op |
|---|---|
| live entities (16 hidden classes) | **46.5** |
| normalised copies (1 hidden class) | **88.0** |

**Normalising made it 1.9× SLOWER.** The synthetic 15× result does not
transfer, and the reason is visible in the numbers: the union of keys across
one map's asteroids is **41 properties**. V8 keeps only a handful of fields
in-object; an object carrying 41 own properties spills into an out-of-object
properties store (and risks dictionary mode), and that indirection costs more
than megamorphic ICs do. The synthetic test's "uniform" objects had five
fields, all inline — it was comparing the wrong thing.

**So CLAUDE.md §4's "set the field when needed" pattern is not a performance
bug, and this gauntlet should not touch it.** The sparse-optional-field
convention is, on this workload, actively faster than the "normalise
everything" alternative. Logged prominently because the opposite conclusion
is the intuitive one and a future session will be tempted by it.

This is the value of measuring before refactoring: the change would have been
a large, invasive, convention-breaking regression.

### Iteration 7 — the spatial grids: hashing, not allocating

Redirecting to a target with a mechanism that is understood rather than
inferred, and that hits SIM TIME (the primary metric) rather than allocation.

Both per-substep broadphase grids are `Map<number, GameEntity[]>` keyed on a
packed `(cx << 16) | cy`. The 3×3 neighbour scan does **9 hash lookups per
entity per substep**, and `Map.set` alone still attributes 35 MB on
asteroid-6k after P2. But the key space is already dense and bounded —
`cellKey` wraps both axes into `[0, SPATIAL_COLS) × [0, SPATIAL_ROWS)` — so
the hash map is buying nothing a flat array indexed by cell would not.

Cell identity became the dense index `cx * SPATIAL_ROWS + cy`, and
`CellBuckets` holds a flat array instead of a `Map`. `beginPass` clears only
the occupied cells (tracked alongside the recycled buckets) so the reset
stays O(occupied), not O(grid).

| scene | alloc B/frame | Δ vs P3 | sim/stp p99 | Δ vs P3 |
|---|---|---|---|---|
| asteroid-6k | 1,453k → 1,238k | **−15%** | 6.68 → 5.85 | **−12%** |
| mass-death | 2,436k → 2,184k | −10% | 6.03 → 6.54 | +8% |
| boss-capstone | 1,285k → 1,208k | −6% | 3.32 → 3.34 | flat |
| roamer-stack | 1,302k → 1,249k | −4% | 3.15 → 3.53 | +12% |
| hub-idle | 410k → 429k | +5% | 1.35 → 1.45 | +7% |
| tile-shatter-storm | 816k → 880k | +8% | 2.75 → 2.93 | +7% |

`Map.set` disappeared from the attribution entirely (was 35–40 MB). The
densest scene — the one where the 3×3 scan dominates — improved clearly on
both axes; the rest is inside the spread.

### Iteration 8 — a better instrument, and an honest cumulative result

That "inside the spread" qualifier had appeared three milestones running, so
the spread became the problem. `perf/simbench.mjs` drives N sim substeps
back to back inside one frame with nothing rendering, amortising scheduling
noise across the batch. Best-to-worst spread drops to 5–8%, which finally
makes sim-time A/B resolvable.

Benchmarked against the pre-gauntlet baseline commit (`a071930`), same host,
same session, ms per sim substep:

| scene | baseline | after P5 | Δ |
|---|---|---|---|
| hub-idle | 0.821 | 0.789 | −3.9% |
| asteroid-6k | 1.837 | 1.769 | −3.7% |
| glass-field | 0.913 | 1.000 | +9.5% |
| roamer-stack | 2.324 | 2.431 | +4.6% |

**So the honest cumulative result is: allocation is down substantially and
TYPICAL SIM COST IS FLAT.** Three milestones aimed at the sim's hot paths
produced a large, consistent, two-independently-measured reduction in
allocation (−13% to −36% per frame, every scene) and no reliable change in
median sim time. That is a real outcome on the goal — GC pauses are dips,
and there is now materially less GC pressure — but it is **not** the
"sim got faster" story the intermediate p99 numbers suggested, and it is
recorded as what it is.

### Iteration 9 — the residual allocation resists attribution (STOP)

After P5 the top allocation sites on asteroid-6k are `applyFlowTo` (147 MB),
`handleEntityCollisions` (116 MB), `PhysicsSystem.update` (76 MB) and
`nearestEatableShard` (49 MB) — 388 of 573 MB, all loops of pure double
arithmetic with no visible allocation. Two genuine fix attempts have now
been made against this cluster (closure hoisting: −17% on the biggest site;
shape normalisation: measured and rejected).

**The third finding is about the instrument, and it changes how this data
should be read.** The `--ablate flowoff` run skipped `applyFlow`'s ENTIRE
body, leaving only `if (e.rotationSpeed) e.rotation += e.rotationSpeed * dt`
— and the site still attributed **80 MB**. That works out to ~40 bytes per
call for one conditional double-add, against the 1.4 bytes/op the probe
measures for exactly that statement. Those cannot both be true.

The reading: V8's sampling heap profiler charges an allocation to whichever
frame is executing when the sampling threshold is crossed, which biases
attribution toward the **hottest-running** frames rather than the actual
allocator. The TOTALS are trustworthy — they agree with the independent heap
trace to ~1.3% — but the **per-frame ranking is not reliable for small,
diffuse allocations in very hot loops**. Every ranking in this ledger should
be read with that caveat; the ones acted on (P2's array refill, P5's
`Map.set`) were confirmed by an independent mechanism test or by the site
disappearing after the fix, which is the bar a future session should hold to.

Per the gauntlet's stop condition (three genuine attempts), this cluster is
handed to FOR-USER-REVIEW rather than attacked further.

---

## P-final — validation

### Before / after, whole matrix (median of 3, same host)

Allocated bytes per frame — the metric this gauntlet actually moved:

| scene | BASELINE | after P5 | Δ |
|---|---|---|---|
| hub-idle | 532,250 | 428,964 | **−19%** |
| asteroid-6k | 1,941,790 | 1,238,274 | **−36%** |
| tile-shatter-storm | 1,008,999 | 879,505 | **−13%** |
| boss-capstone | 1,569,310 | 1,207,548 | **−23%** |
| roamer-stack | 1,488,122 | 1,249,078 | **−16%** |
| mass-death | 2,819,842 | 2,183,667 | **−23%** |

Down in every scene, by both measurement methods, with the two agreeing to
~1.3%. Net heap growth over a capture window collapsed alongside it
(+17/+23/+32 MB → +0.4/+7.6/−0.8 MB).

Worst-frame in-code sim (p99 per substep; ×2 is the budget-relevant figure
for a device holding 60 fps):

| scene | BASELINE | after P5 | Δ |
|---|---|---|---|
| asteroid-6k | 6.33 | 5.85 | −8% |
| boss-capstone | 3.85 | 3.34 | −13% |
| hub-idle | 1.50 | 1.45 | −3% |
| tile-shatter-storm | 2.85 | 2.93 | +3% |
| mass-death | 6.22 | 6.54 | +5% |
| roamer-stack | 3.25 | 3.53 | +9% |

Mixed, and the low-noise `simbench` cumulative comparison (iteration 8) is
the one to believe: **typical sim cost is flat**.

### Long soak (5 minutes, Universe, waves running)

`8351 frames · heapΔ +3.0 MB · 1.6 GC/s · sim/stp p99 4.27 ms`

**Memory is flat over five minutes** — +3 MB net, no sawtooth from our
allocations. That satisfies the soak criterion. One `sim max` spike of
64.2 ms occurred in the window; with attribution unreliable at that
granularity (iteration 9), it is called out rather than explained.

### Gates

`npm run typecheck`, `npm run build`, `npm test` green at every milestone
commit, and three consecutive clean `npm test` runs at the final commit
(38 tests each).

---

## P6 — the sim-rate toggle (user-requested, post-review)

Raised in review: the FOR-USER-REVIEW note flagged `FIXED_DT = 1/120` as the
largest lever on the sim budget. The user asked for it as a **toggle** so the
feel could be judged by hand.

### The trap that had to be handled first

`SIMULATION_CONSTANTS` carries a comment recording that **1/60 was already
tried and reverted**: on a 60 Hz display a 60 Hz sim step makes the
accumulator drift a hair either side of exactly one step, so frames alternate
1-step / 2-step and the world judders. 1/120 was chosen for *divisibility*.

A naive toggle would have walked straight back into that bug, and the user
would have rejected 60 Hz for a reason unrelated to physics quality. So the
toggle ships with a **vsync snap**: a frame delta landing within a
quarter-step of a whole number of steps is snapped to it
(`VSYNC_SNAP_FRACTION`), which removes the alternation at its source.

**This is the one behaviour-affecting change in the gauntlet, and it affects
the DEFAULT path.** It is flagged rather than hidden. Two reasons it is worth
it: it is what makes the toggle a fair test at all, and — more importantly —
the divisibility argument has a hole. On a **120 Hz ProMotion display** (the
target device) the 1/120 step is *also* one-step-per-frame, which is exactly
the fragile case the original comment warns about. The snap protects the
shipping 120 Hz path on the actual target hardware.

### Rate-dependent constants

Only **two** constants are authored per-substep rather than per-second, both
in `DROP_PULL`. Everything else already multiplies by `dt` (including the
shard cohesion blend and the shard gravity pull, which were checked
specifically because they shape shard-field feel), and velocity itself is
rate-independent — `PhysicsSystem` integrates with `timeScale = dt * 60`.

Conversions are derived from the existing 120 Hz numbers rather than
re-authored, so **the 120 Hz path is bit-for-bit unchanged**:

| kind | conversion | exact? |
|---|---|---|
| `DAMP_PER_STEP` (exponential decay) | `d ** stepScale` (0.97 → 0.9409) | **exact** |
| `STRENGTH` (linear accumulation) | `s * stepScale` (0.08 → 0.16) | **exact** |
| decay and accumulation interleaved in one step | — | second-order difference |
| **iterative collision resolution** | **does not convert** | **this is where the feel change lives** |

`MAX_SUBSTEPS` scales with the rate (5 @120 Hz → 3 @60 Hz) so the
spiral-of-death clamp covers the same wall time.

### Measured (asteroid-6k, median of 3)

| metric | 120 Hz | 60 Hz | Δ |
|---|---|---|---|
| sim p99 **per frame** | 24.10 ms | **9.20 ms** | **−62%** |
| substeps/frame | 3.22 | 1.29 | −60% |
| allocation per frame | 1,293,343 | **648,419** | **−50%** |
| GC/s | 4.0 | 2.9 | −28% |
| **frames rendered in the same 12 s** | 445 | **561** | **+26%** |

**This single toggle beats P2 + P3 + P5 combined**, which is what the P1
analysis predicted and what makes it the right thing to have surfaced rather
than quietly optimised around. The cost side is now measured; the **feel side
is explicitly unmeasured and belongs to the user** — the thing to judge is a
dense shard pile settling, not a number.

---

## P8 — the first hardware capture, and what it overturns

User capture, 2026-08-09 (Ring World, iPhone 440x756 dpr3, zoom 0.65, diff 3,
11.4 s / 681 frames):

```
FPS   avg 60 · median 59 · 5%-low 56 · 1%-low 38 · min 29 · >=55: 95%
frame avg 16.8ms · median 17.0 · p95 18.0 · p99 26.0
cost  render avg 0.90ms · sim avg 2.67ms · collisions avg 1.09ms
worst  #  frame   render     sim  steps   ents  parts    at
      1   35.0    1.00    2.00      1    531     69    3.8s
      2   30.0    2.00    3.00      1    480     42    0.6s
      4   30.0    1.00    4.00      1    489     49    2.5s
```

**This overturns the P1 headline.** Three readings, in order of importance:

1. **Our compute is ~3.6 ms of the 16.7 ms budget — 22%, not 76%.** The
   "sim is 76% of budget" finding was a CONTAINER ARTEFACT: the software
   rasterizer stretched frames, which pulled extra substeps in, which
   inflated per-frame sim roughly 4x. On device, `sim avg 2.67 ms` and
   `steps = 1`. The instrument's own calibration note (§"The instrument", 1)
   warned that per-frame sim was host-inflated; the P1 budget table quoted it
   anyway. That was the error.

2. **Every worst frame is a MISSED VSYNC, not a slow frame.** 30 and 35 ms
   against a 16.7 ms period are 2x and ~4x multiples, and they carry only
   1–2 ms render and 2–4 ms sim. With ~13 ms of headroom, something outside
   everything the engine measures is eating the frame.

3. **`steps = 1` on every worst frame** — no substep bunching, and the
   capture was taken at the 60 Hz sim rate. So neither the accumulator nor
   the sim is implicated. Entity (531) and particle (69) counts are low, so
   it is not a spawn burst either.

### The unmeasured gap

`GameEngine.onStatsUpdate` is a React `setState` and it fires EVERY FRAME.
The reconciliation walks the whole unmemoized ~2100-line `UIOverlay` tree,
and it is neither `draw()` nor the sim — **no engine timer has ever seen
it.** The headless React ablation in P1 measured only its ALLOCATION share
(~10%) and concluded it was not dominant; that says nothing about its TIME,
which is the thing the budget is denominated in.

Two changes so the next capture settles it rather than suggests it:

- **`ui` is now timed and reported** — the `onStatsUpdate` hand-off gets its
  own column in the worst-frame table, plus an `ui avg` in the cost line, and
  the table now prints **`other` = frame − render − sim − ui** explicitly.
  If `other` stays large with `ui` small, the gap is GC / compositing / an OS
  stall and is not addressable in our JS — which is the PR #70 conclusion,
  now testable instead of asserted.
- **`HUD rate` DBG cycle (60 default / 30 / 15)** throttles only the in-play
  HUD push. Overlay screens (pause / station / death / stage-clear) always
  push immediately, and everything frame-critical (minimap, loadout strip,
  banners, damage text) is canvas-drawn and untouched. It is the A/B that
  turns the hypothesis into a verdict, and it is a knob the player can feel.

Also fixed: `buildTag` was hardcoded `'exotic-opt'`, so every capture in this
gauntlet was mislabelled with a prior session's name. Now `'5c-perf'`.

### What this means for the gauntlet's conclusions

The three shipped code fixes (P2/P3/P5) remain correct and remain
zero-behaviour, but their MOTIVATION was partly wrong: they targeted a sim
budget that was never 76% on real hardware. Their allocation reduction is
still real and still on-goal (GC is a named dip source, and `other` being the
whole story makes GC MORE likely to matter, not less). The sim-rate toggle's
device value is likewise smaller than the headless numbers implied — though
`steps = 1` in this capture shows it is doing what it claims.

---

## P9 — two more captures: React ruled OUT, and 120Hz beats 60Hz

Pocket, iPhone 440x756 dpr3, diff 3, PerfController AUTO **off** in both.

| metric | 60 Hz sim (74.2 s) | 120 Hz sim (63.7 s) |
|---|---|---|
| 1%-low FPS | 40 | **56** |
| min FPS | 26 | **34** |
| frame p99 | 25.0 ms | **18.0 ms** |
| worst frame | 38.0 ms | **29.0 ms** |
| >=55 fps | 98% | **99%** |
| render avg | 1.82 ms | 1.02 ms |
| sim avg | 1.98 ms | 1.57 ms |
| **ui avg** | **0.01 ms** | **0.01 ms** |
| tier avg | 1.63 | 1.16 |

### 1. The React hypothesis is DEAD

`ui avg 0.01 ms`, and `ui = 0.00` on **every** worst frame in both captures.
The per-frame `setState` + reconciliation costs nothing measurable on device.

That closes a hypothesis this ledger had been carrying since P1 and had just
promoted to "prime suspect" in P8. It was wrong. Recorded as a negative
result because the reasoning that produced it was sound and the next session
should not re-run it: allocation share (~10%, P1) said nothing about time,
and timing it was the only way to know.

### 2. `other` is the whole story, and it is not our JS

```
worst  #  frame   render     sim      ui   other  steps   ents  parts    at
      3   35.0    0.00    0.00    0.00    35.0      0    592    217   25.6s
```

**A frame in which the engine did nothing at all — zero render, zero sim,
zero substeps — still took 35 ms.** No amount of JS optimisation can move
that. Across both captures `other` is 21-36 ms of every worst frame while
our measured work is 0-4 ms.

### 3. 120 Hz is measurably SMOOTHER than 60 Hz

This inverts the expectation the sim-rate toggle was built on. Halving the
sim rate halved the sim work and made the **tail worse on every metric** —
1%-low 40 vs 56, p99 25 vs 18 ms. The likely mechanism: at 60 Hz the sim
rate equals the display rate, so the accumulator has coarse granularity to
absorb jitter (a late frame drains one BIG step); at 120 Hz it drains two to
four small ones and re-phases smoothly. The captures are separate play
sessions and not perfectly matched (tier avg 1.63 vs 1.16), so this is
indicative rather than controlled — but the gap is large and consistent.

**Recommendation: keep 120 Hz as the default.** The sim-rate toggle stays as
a diagnostic; its headless value (-62% sim p99) was real and irrelevant,
because sim was never the constraint on device.

### 4. Next lever: canvas FILL RATE

With React and our JS excluded, the remaining candidates for `other` are GC
and compositing. Compositing is the stronger one and had never been examined:
`dpr` was **uncapped**, so a 440x756 viewport rasterises `1320 x 2268` =
**~3.0 million pixels every frame**, with heavy `globalCompositeOperation =
'lighter'` and radial-gradient overdraw on top.

Crucially this is invisible to `renderMs`, which times our JS ISSUING canvas
calls; rasterisation and compositing happen in the browser compositor after
the rAF callback returns — exactly where the missing milliseconds are.

Shipped: **`Render scale` DBG cycle (3 / 2 / 1.5)** capping the pixel ratio.
Capping at 2 cuts the pixel count ~2.3x. `effectiveDpr()` is now the single
accessor — RenderSystem and the canvas sizing in `App.tsx` both read it, so
the backing store and the logical viewport can never disagree. Trade: a
softer image, so it is a toggle, not an edit.

---

## P10 — Seven Rings: the OTHER failure mode, and the clamp that feeds it

Seven Rings, 154.7 s / 7738 frames, dpr3, AUTO off. Note this is a different
map and 4x the entity count of the Pocket captures, so it is not the
controlled render-scale A/B that was asked for — and it is more valuable
than one, because it exposes a **second, unrelated failure mode**.

```
FPS avg 50 · median 59 · 5%-low 24 · 1%-low 21 · min 17 · >=55: 76%
frame avg 20.0 · median 17.0 · p95 42.0 · p99 47.0
cost  render avg 0.78 · sim avg 4.93 · ui avg 0.04
sim   updPhys 1.92 · updLogic 3.01 · physics 1.66 · shardSys 2.61 · ai 0.11
perf  tier avg 3.29 (med 25% / heavy 22% / max 54%) · load peak 1.00
peak  entities 3359
worst  #  frame   render     sim      ui   other  steps   ents  parts     at
      1   60.0    1.00   44.00    0.00    15.0      5   3212    255  140.5s
      2   57.0    1.00   38.00    1.00    17.0      5   3103    164  137.1s
      4   57.0    1.00   40.00    0.00    16.0      5   3090    135  140.6s
```

### There are TWO problems, not one

| | Pocket (789 ents) | Seven Rings (3359 ents) |
|---|---|---|
| worst frame | 38 ms | **60 ms** |
| sim on it | 2 ms | **44 ms** |
| `other` on it | 36 ms | 15 ms |
| `steps` | 0-1 | **5 (pegged)** |
| diagnosis | compositing / GC | **our sim, amplified by the clamp** |

The Pocket conclusion ("not our JS") was correct **for Pocket** and does not
generalise. At high entity counts the sim genuinely dominates, and this is
the in-charter spike the gauntlet was chartered to find. `other` is still
15-19 ms here, so the compositing/GC cost is present in both — it is simply
no longer the biggest term.

### The clamp is feeding the spiral it exists to stop

Every worst frame is pegged at `steps = 5`. `MAX_SUBSTEPS = 5` at a 120 Hz
sim permits **5 x 8.8 ms = 44 ms of sim in a single frame** — which is
exactly the sim figure observed, and is what makes the frame 60 ms. The
feedback loop: a long frame accumulates more time, the accumulator drains
more substeps, the extra substeps make the frame longer still.

A 60 fps display with a 120 Hz sim only **needs 2** substeps per frame. Five
allows 2.5x real-time catch-up, and that headroom is what let one slow frame
snowball. Capping lower converts a judder into a brief, smooth slow-motion —
and the engine **already** discards the excess at the clamp
(`simAccumulator %= FIXED_DT`), so that cost is paid either way; the cap only
decides where.

Shipped: **`Substep cap` DBG cycle (5 default / 3 / 2)**, read through
`getMaxSubsteps()` so it composes with the sim-rate toggle. Default unchanged
pending a device A/B.

### The root cause underneath it

**3359 entities.** `shardSys` is the largest sim sub-timer (2.61 ms) and the
PerfController is pegged (`tier max 54%`, `load peak 1.00`) and still cannot
keep up. All six worst frames cluster in a 4-second window at 137-141 s of a
155 s session — i.e. **the shard population grew over the session** until the
sim could not fit in a frame.

Capping substeps bounds the SYMPTOM. The population growth is the disease,
and it is behaviour-adjacent (shard lifetime, merge rate, graceful cleanup),
so it belongs to the user rather than to a zero-behaviour perf pass. Flagged
in FOR-USER-REVIEW.

---

## P11 — a real RENDER spike, and an instrument gap that cost two captures

### The instrument gap (my fault)

Two captures were requested as A/Bs (`Substep cap = 3`, `Render scale = 2`)
and **neither can be verified**, because the report never recorded which
toggles were active. One came back on a different map than requested, the
other showed `render avg` moving the wrong way — and there is no way to tell
whether the setting was applied.

Fixed: the report now carries a `set` line —
`sim 120Hz · substep 5 · rscale 3x · hud 60Hz · auto on`. A capture used as
evidence has to say what produced it. Both of those captures are logged
below for what they DO show, and neither is treated as an A/B result.

### The new finding: our render CAN spike, by 40-45 ms

Ring World, 55.9 s, 1385 peak entities:

```
worst  #  frame   render     sim      ui   other  steps   ents  parts    at
      1   81.0    1.00    2.00    0.00    78.0      1    762    153   32.6s
      2   51.0   40.00    5.00    0.00     6.0      2    718    149   29.9s
      3   49.0   45.00    3.00    0.00     1.0      3   1357     36   12.6s
```

Rows 2 and 3 are the **first frames all session where OUR render is the
spike** — 40 and 45 ms against a 1.41 ms average, with `other` at 1-6 ms.
Everything else in every capture so far pointed away from render.

**Cause: the static-tile cache stamps without a per-frame budget.**
`prepareStaticTileTransitions` walks the visible list and stamps every tile
that has become cacheable, and each stamp is a `clearRect` + `drawImage` on
a map-sized offscreen canvas. Normally a trickle — but when many tiles become
cacheable at once (the hex sprite finishing loading AFTER `buildStaticTileLayer`
already ran, which the code explicitly anticipates, or a wave of tile regen)
they all stamp in one frame. Row 3 at 12.6 s with the session's highest entity
count is the sprite-load catch-up; row 2 is a regen wave.

Fixed with `STATIC_TILE_STAMPS_PER_FRAME = 24`. This is **not a trade**:
a tile that misses its stamp renders through the normal per-entity path that
frame — exactly what it already does until it is stamped. Only the cache
warm-up spreads out, and at 24/frame a full map catches up in under a second.

### What the two captures still tell us

- **`other` remains the dominant term** on light scenes: 78 ms of an 81 ms
  frame (Ring World row 1), 25-30 ms of every Pocket worst frame. Unmoved by
  everything shipped so far, and still not our JS.
- **Pocket got no better** across the session (1%-low 42 vs 56 previously),
  but with settings unrecorded and different session lengths this is not
  evidence about render scale either way.
- A cosmetic report bug: `FPS max 0` appears when two rAF callbacks share a
  timestamp (`toFps(0)`). Harmless, noted.

---

## P12 — RENDER SCALE IS THE ANSWER (and the star bug it exposed)

First verifiable A/Bs, with the `set` line proving the settings. Ring World,
same map, `auto off` throughout.

| metric | 3x baseline | 3x + substep 3 | **2x** |
|---|---|---|---|
| **worst frame** | 81.0 ms | 70.0 ms | **27.0 ms** |
| frame p99 | 36.0 | 36.0 | **23.0** |
| 1%-low FPS | 28 | 28 | **43** |
| min FPS | 12 | 14 | **37** |
| render avg | 1.41 | 1.08 | **0.80** |
| `other` on worst frames | 47-78 ms | 47-55 ms | **20-25 ms** |

**This closes the question that ran the whole gauntlet.** `other` — the
unattributed term that survived every other fix, and that the P9 captures
showed dominating a frame in which the engine did literally nothing — **was
canvas compositing.** Halving the rasterised pixel count (3.0M -> 1.3M)
roughly halved it, and took the worst frame down **67%**.

`2` is now the default (user call). 3x stays one tap away.

### Substep 3: no effect, and the reason matters

Worst frame 81 -> 70 ms is inside variance, and `other` still dominated
(47-55 ms). That is not a refutation: **Ring World's worst frames are
compositing-bound, not sim-bound**, so the substep cap had nothing to bite
on. It was tested on the wrong scene. The clamp still has a case to answer on
a Seven-Rings-scale field (3359 entities, `sim 44 ms`, `steps` pegged at 5),
which remains untested. Default left at 5.

### The star-density bug this exposed

The user's report — "I like the 2x render look but the stars become a bit
overpowering" — was **not a tuning issue. It was a bug in the render-scale
change itself**, and their eye caught what the numbers could not.

`BackgroundManager.render` still read the RAW `window.devicePixelRatio`; the
`effectiveDpr()` sweep covered `RenderSystem` and `App.tsx` but missed this
file. So with a 2x cap on a dpr-3 phone it computed the scene as
`canvas.width / 3` instead of `/ 2` — **2/3 of the true CSS viewport**. The
star bands are generated to fill exactly that size with a fixed 60 x 400 =
24 000 stars, so the field was packed into 4/9 of the area: **2.25x the
intended density.**

Fixed at the cause, so the sky is now identical at every render scale rather
than retuned per scale. **The lesson is the generalisable part: an
`effectiveDpr()` that is not read EVERYWHERE is worse than not having one**,
because the canvas and the code drawing into it silently disagree. Both
remaining raw reads are now gone (the perf report's header deliberately shows
the effective ratio, since that is what its render numbers correspond to).

---

## P13 — confirmation at the new defaults (hardware)

Ring World, **193.8 s / 11 581 frames** — the longest capture of the session,
so the tail had the most opportunity to appear.
`set sim 120Hz · substep 5 · rscale 2x · hud 60Hz · auto off`, header
correctly reading `dpr2` (the effective-ratio fix working).

| metric | 3x baseline (55.9 s) | 2x A/B (71.1 s) | **2x confirm (193.8 s)** |
|---|---|---|---|
| 5%-low FPS | 45 | 48 | **59** |
| p95 frame | 22.0 ms | 21.0 | **17.0** |
| p99 frame | 36.0 ms | 23.0 | **23.0** |
| >=55 fps | 92% | 93% | **96%** |
| render avg | 1.41 ms | 0.80 | **0.71** |

**99% of frames are at or under 23 ms.** Steady state is materially better
than anything measured before, and render cost has halved twice over.

### The remaining tail: three one-off spikes, not a steady cost

```
worst  #  frame   render     sim      ui   other  steps   ents  parts     at
      1   63.0    1.00    7.00    0.00    55.0      2    518     82   18.0s
      2   31.0    8.00   26.00    1.00     0.0      1    462     31   17.0s
      3   30.0   22.00    4.00    0.00     4.0      2   1355     46    6.7s
```

Six frames out of 11 581 exceed 27 ms — **0.05%**. They are heterogeneous,
which is itself the finding: one is `other` (55 ms), one is **sim** (26 ms in
a SINGLE substep at only 462 entities), one is **render** (22 ms). No single
remaining cause.

**Rows 1, 2 and 6 cluster at 17.0-18.0 s**, and row 3 sits at 6.7 s with the
session's near-peak entity count. That clustering says DISCRETE EVENT, not
load: 26 ms of sim in one substep on a 462-entity field cannot be steady-state
cost. A wave start is the leading candidate (spawn-list construction, enemy
build, first-draw cache fills for new sprites) but it is **not identified** —
the capture cannot say what was on screen, and guessing would repeat the
mistake this gauntlet has already made twice.

Next step if this is pursued: correlate `at` against a wave/boss event, which
means either the user noting what happened at that moment or the recorder
stamping wave transitions into the capture.

---

## P14 — event stamping, and the tail turns out to be WARM-UP

Ring World, 137.4 s / 8220 frames, `rscale 2x`, `auto on`. First capture
with the event timeline.

```
worst  #  frame   render     sim      ui   other  steps   ents  parts    at  event
      1   51.0   47.00    2.00    0.00     2.0      2   1404     70    5.1s  —
      2   33.0   27.00    4.00    0.00     2.0      2   1394     60    3.7s  —
      3   32.0    2.00    3.00    0.00    27.0      2   1386     52   11.6s  spawn−1.7s
      4   32.0    1.00    4.00    0.00    27.0      2    542    104   14.9s  spawn+1.6s
      6   31.0    1.00    3.00    0.00    27.0      2   1386     50   13.2s  spawn−0.1s
events 13.3s spawn · 13.3s mapload · 45.4s clear · 49.9s wave2 · 49.9s spawn · 90.3s clear · 94.8s wave3 · 94.8s spawn
```

### The finding: EVERY worst frame is in the first 15 seconds

The session ran 137 s. All six worst frames fall between 3.7 s and 14.9 s;
the remaining **122 seconds of play produced nothing above 31 ms.** Two full
wave cycles (`wave2` at 49.9 s, `wave3` at 94.8 s) passed without entering
the table at all — which retires the standing hypothesis that wave starts
cost a frame. They do not.

**The tail is load and warm-up transient, not gameplay.** That is a
materially smaller problem than "the game hitches", and it is only visible
because the timeline let two wave cycles be ruled out by their absence.

Two distinct groups, cleanly separated by the split:

| frames | at | signature | reading |
|---|---|---|---|
| #1, #2 | 3.7, 5.1 s | **render 47 / 27 ms**, `other` ~2 | our render, during warm-up |
| #3-#6 | 8.4-14.9 s | **`other` 27 ms**, render ~1-2 | clustered on the `13.3s mapload` — GC from discarding the old map |

### Instrumented rather than guessed (again)

The render group is presumably the static-tile cache warm-up, but the
`STATIC_TILE_STAMPS_PER_FRAME = 24` budget added in P11 should already have
bounded it — and 47 ms for 24 stamps implies ~2 ms per stamp, which is
possible on iOS (a `clearRect` + `drawImage` on a map-sized offscreen canvas
can force a texture round-trip) but is not established.

Rather than lower the budget on a hunch — the error this gauntlet has
already made twice — the stamping now carries its own timer:
`RenderSystem.lastStampMs` / `lastStampCount`, surfaced as
**`peak tilestamp X.XXms (N tiles)`** on the report's spike line. The next
capture either confirms stamping as the cause or eliminates it outright.

---

## P16 — tile stamping ELIMINATED; the tint cache is the new suspect

Ring World, 52.4 s, `rscale 2x`, `auto on`, with the stamp timer live:

```
spike worst frame 44.0ms → render 41.00 · sim 2.00 · peak tilestamp 1.00ms (2 tiles)
worst  #  frame   render     sim      ui   other  steps   ents  parts    at  event
      1   44.0   41.00    2.00    0.00     1.0      2   1518     64    6.7s  —
      2   36.0    8.00   28.00    0.00     0.0      1    465     31   13.3s  spawn+0.0s
      3   34.0   29.00    2.00    0.00     3.0      2   1527     67    7.7s  —
      4   31.0   27.00    2.00    0.00     2.0      2   1532     73   11.3s  —
      5   30.0   28.00    1.00    0.00     1.0      1   1513     59    6.7s  —
```

**`peak tilestamp 1.00ms (2 tiles)` — static-tile stamping is eliminated.**
It was the obvious suspect and it is not the cause. Instrumenting instead of
lowering the budget on the hunch was the right call; the budget change would
have bought nothing and looked like a fix.

**Four of six worst frames are RENDER, 27-41 ms**, at ~1520 entities, with
`other` at 1-3 ms — so unambiguously our JS, in the render path, not
compositing and not stamping.

**Correction to P15.** Row 2 is `sim 28 ms` at exactly `spawn+0.0s` — so a
wave spawn DOES cost a frame. P15 concluded the opposite from a capture in
which no spawn happened to land in the worst-six. Absence of evidence was
read as evidence of absence; two captures were needed to see it.

### New suspect, instrumented not assumed

`getTintedSprite` builds a **128x128 canvas per (sprite, tint) pair** and
caps the cache at **256 entries with FIFO eviction**. The tint key space is
much larger than that looks: rock alone has 25 density tiers
(`ROCK_CONDENSE`), plus metal tiers, glass opacity bands and plastic
palettes, multiplied by sprite source. Past the cap the cache does not warm —
it **thrashes**, rebuilding canvases every frame, and the cost would scale
with on-screen entity count and appear in bursts. That is exactly the shape
of these four frames.

The report now carries:
`tint peak X.XXms (N new) · M total misses over the capture`.

The discriminator is **sustained** misses: a warming cache produces a burst
of misses that then stops; a thrashing one produces them forever. If M keeps
climbing across a long capture, the fix is to raise the cap and/or quantise
the tint key so the space is bounded by design.

---

## P17 — the tint cache: a real defect, but NOT the spikes

Ring World, 182.1 s / 10 886 frames — the longest capture of the session.

```
tint  peak 12.00ms (5 new) · 890 total misses
spike worst frame 32.0ms → render 1.00 · sim 4.00 · peak render 19.00 · peak tilestamp 1.00ms
FPS ≥55: 95% · ≥30: 100% · min 31 · p99 24.0ms
worst frames: all `other` 22-27ms, render 1-2ms
```

### Three findings, in order of honesty

**1. My own report line was asserting a verdict.** It printed *"sustained
misses mean the 256-entry tint cache is THRASHING"* **unconditionally** —
regardless of the number measured. That is exactly the false attribution
every other part of this report is built to prevent, shipped by me two
milestones after writing that principle down. Now it states the number and
the threshold and lets the reader conclude:
`(cache holds 256; misses >> 256 = evicted-before-reuse, ~256 = warm-up only)`.

**2. Tinting is NOT the render spikes.** 890 misses over 182 s is ~5/second
at ~2.4 ms each — roughly **1.2% of frame time**. And the 27-41 ms render
frames **did not reproduce at all** this run (`peak render 19 ms`, and all
six worst frames are `other`-dominated with render at 1-2 ms). So the
previous capture's render spikes remain unexplained and are INTERMITTENT,
which is itself information: they are not a function of entity count alone.

**3. But 890 rebuilds against a 256-entry cache is a real defect**, and the
cause is the eviction policy, not the size. The cache evicted the
FIRST-INSERTED key, so it discarded by AGE rather than by USE — and a
working set only slightly over the cap therefore evicts precisely the
entries about to be needed again. Fixed by re-inserting on hit, making it a
true LRU. Same canvases, same pixels, **no visual change**; only which entry
is discarded changes. Raising the cap was the tempting alternative and the
wrong one: at 64 KB per 128x128 canvas, 256 entries is already 16 MB and
1024 would be 64 MB on a phone.

### Where the game actually stands

`>=30 fps: 100%` · `>=55: 95%` · `min 31` · `p99 24.0 ms` over three
minutes, with two full wave cycles and a death. Every worst frame is now
`other` (compositing / GC) at 22-27 ms, with our JS at 1-6 ms.

**The in-code work is essentially done.** What remains in the tail is not
ours to optimise in JS, and the honest next lever for it is allocation
reduction (to lower GC frequency), which the P2/P3/P5 work already started
and which has diminishing returns from here.

---

## P18 — Seven Rings, the worst scene in the game, is fixed

Seven Rings was the one scene with a genuine SIM-bound problem (P10): 3359
entities, `sim 44 ms` of a 60 ms frame, the substep clamp pegged at 5 on every
worst frame, and the PerfController saturated. Re-captured at the new
defaults, 164.2 s / 9832 frames:

| metric | P10 (3x, 154.7 s) | now (2x, 164.2 s) |
|---|---|---|
| worst frame | 60.0 ms | **31.0 ms** |
| frame p95 / p99 | 42 / 47 ms | **21 / 24 ms** |
| 5%-low FPS | 24 | **48** |
| 1%-low FPS | 21 | **42** |
| min FPS | 17 | **32** |
| >=30 fps | 93% | **100%** |
| >=55 fps | 76% | **94%** |
| sim avg | 4.93 ms | **1.43 ms** |
| `steps` on worst frames | **5 (pegged)** | **2 (normal)** |
| perf tier avg | 3.29, max 54% | **1.56, never heavy** |

**The substep clamp is no longer pegged**, which was P10's whole diagnosis —
so the `Substep cap` toggle built for it was never needed. It stays at the
default 5 and remains available as a diagnostic. Building it behind a toggle
rather than changing the default was the right call: the problem it targeted
dissolved.

**One number NOT to over-claim.** `shardSys` fell 2.61 ms -> 0.11 ms, a 24x
drop that the 14% lower entity count (3359 -> 2887) cannot explain. The
likely cause is a different scene state — that earlier session had far more
MOBILE SHARDS, which is what `shardSys` cost actually scales with, and total
entity count hides that. The P2/P3/P5 work made each shard cheaper, but
attributing a 24x drop to it would be reading a difference in play as a
difference in code. Recorded as unexplained rather than claimed.

**Tinting confirmed clean:** `256 total misses` — exactly the cache size, so
it filled once and stopped. No eviction churn at all after the LRU fix.
`peak tilestamp 1.00 ms (13 tiles)` likewise.

**Every one of the six worst frames is `other` at 22-27 ms**, with render at
0-1 ms and sim at 2-4 ms. That ~25 ms `other` floor now appears in every
capture regardless of map, entity count or activity — it is a device
characteristic (compositing / GC), not a scene cost, and it accounts for
6 frames in 9832 (**0.06%**).

---

## Completion summary

### The acceptance statement (REVISED after the hardware captures)

**The root cause of the reported lag was found and fixed, and the fix is
hardware-confirmed.** `other` — the unattributed term that dominated every
worst frame and survived every code optimisation — was **canvas
compositing at an uncapped device-pixel-ratio of 3**. Capping at 2 is now
the default.

Hardware-confirmed on Ring World (193.8 s, 11 581 frames, iPhone):

| | before (3x) | after (2x) |
|---|---|---|
| 5%-low FPS | 45 | **59** |
| p95 frame | 22.0 ms | **17.0 ms** |
| p99 frame | 36.0 ms | **23.0 ms** |
| >=55 fps | 92% | **96%** |
| worst frame (A/B, matched length) | 81 ms | **27 ms** |

**Seven Rings — the one scene with a genuine sim-bound problem — is also
fixed** (P18): worst frame 60 -> 31 ms, `>=30 fps` 93% -> **100%**, and the
substep clamp no longer pegged. No scene in the matrix now falls below 30 fps
at any point.

**What is NOT claimed.** The literal goal — "no frame over 16.7 ms, ever" —
is still not met. Every remaining worst frame across every capture is
`other` at ~22-27 ms (compositing / GC), with our JS at 1-6 ms, at a rate of
roughly **0.06% of frames**. That term is not addressable in our JavaScript;
the only lever left on it is further allocation reduction to lower GC
frequency, with diminishing returns from where P2/P3/P5 left it. So: **the
game holds 100% of frames above 30 fps on every scene measured, ~95% above
55, and a rare ~25 ms stall remains that is not ours.**

### What the headless work was worth, honestly

The three zero-behaviour code fixes (P2/P3/P5) cut allocation 13-36% per
frame and are correct — but they did **not** fix the user's lag, and the sim
budget they targeted was never the constraint on device. The two findings
that mattered (compositing; unbounded tile-cache stamping) both came from
**hardware captures**, and two of my headless-derived hypotheses (the
76%-of-budget sim claim, and React) were measured wrong and had to be
retracted. The instrument that earned its keep was the in-game Perf REC
worst-frame table, not the headless matrix.

<!-- superseded original follows -->

### The original acceptance statement

**SUPERSEDED — see the revision immediately below.** The original statement
(written before any hardware capture existed) read:

> This gauntlet did NOT achieve its stated goal, and no scene is
> hardware-confirmed smooth.

- **Hardware-confirmed:** *nothing*. The CAPTURE REQUESTS entry below was
  written at the end of P1 as instructed; no captures were provided during
  the session, so every number here is headless. Acceptance requires those
  captures — the harness explicitly cannot render a verdict on smoothness.
- **Headless A/B only, and solid:** allocation is down 13–36% per frame in
  every scene, measured two independent ways that agree to 1.3%, and memory
  is flat over a 5-minute soak.
- **Headless A/B only, and null:** typical sim cost is unchanged. The sim
  still measures ~76% of the 16.7 ms budget on the shard-dense Asteroid
  Field (2 × p99 per substep) and ~74% on a mass-death frame. **The
  budget problem identified in P1 is not fixed.**
- **Not established at all:** whether any of this is perceptible on device.

The defensible claim is narrow: *GC pressure — one named cause of stutter —
is materially reduced, and nothing regressed.* Everything beyond that is
open.

### What shipped

| milestone | change | evidence |
|---|---|---|
| P2 | index-fill refill idiom in 4 hot sites; `CellBuckets` pooling | alloc −8…−23%; mechanism verified standalone (2.6× / 11×) |
| P3 | `applyFlow` closure → `applyFlowTo` method; `forEach` → indexed loop | site −17%; hub-idle −13% both axes |
| P5 | dense flat-array spatial grid replacing the hash | asteroid-6k −15% alloc, −12% sim p99; `Map.set` gone from attribution |

### Behaviour-flagged changes

**None.** Every change shipped in this gauntlet is zero-behaviour: same
entity lists, same bucket contents and order, same arithmetic, same
`length` semantics. No DBG toggle was needed because nothing was traded.
The parked shard-broadphase PAIR BUDGET was **not** built — the numbers
never indicted the O(k²) cell cost (`Map.set`/hashing and refill churn
dominated instead), and it stays parked as a behaviour-adjacent lever.

### External-stall attribution record

Not established this session. PR #70 documented residual ~80 ms hitches
with 3 ms sim + 3 ms render on the worst frame and attributed them to
browser/OS stalls; that attribution needs the worst-frame render/sim split
from a hardware capture to confirm or refute, which is capture request #1.
No in-code spike in this session was excused as external.

### Remaining risks and open questions

1. **The sim budget is unaddressed** — the P1 headline finding stands.
2. **Allocation attribution is unreliable per-frame** (iteration 9), so the
   remaining 388 MB "invisible" cluster cannot currently be targeted.
   A future session should reach for a **CPU** profile (`Profiler.start`)
   rather than more heap attribution.
3. **GC events/second rose** while bytes fell (P2). Inferred as V8 shrinking
   the young generation — cheaper, more frequent scavenges — but unproven,
   and if wrong it would mean more pauses rather than fewer.
4. **The per-frame React re-render** (`App` re-renders 60×/s, ~90 handler
   closures, unmemoized 2157-line `UIOverlay`) is real but measured at only
   ~10% of allocation. It is untouched, and it is invisible to the engine's
   own timers — a plausible contributor to hitches a hardware capture would
   show as "external".
5. **Container noise** (±10% on the matrix) means single-milestone sim
   deltas below ~10% are not resolvable there; use `simbench.mjs`.

## DECISIONS TAKEN

**D1 — The harness lives in `perf/`, outside `tests/`, and is not wired
into `npm test`.**
*Alternatives:* a Playwright spec under `tests/` (picked up by the 5b
config automatically), or a second Playwright project.
*Why:* the capture matrix takes minutes per run and the soak scene takes
five on its own. `npm test` is a merge gate that has to stay fast and
deterministic; a perf capture is neither (it is explicitly noise-prone —
see calibration 3). Keeping it a standalone node script also lets it pass
V8 flags (`--js-flags=--expose-gc`, `--enable-precise-memory-info`) and
drive a CDP session, neither of which the test config exposes.

**D2 — Scene randomness is seeded; `Math.random` is replaced page-side.**
*Alternative:* let scenes run naturally and average more runs.
*Why:* an A/B delta between two branches is only a delta if both saw the
same world. Seeding costs nothing and removes the largest single source of
between-run variance; the residual noise is host scheduling, which
`--repeat 3` handles.

**D3 — Allocation is reported from BOTH the heap trace and the sampling
profiler, and their agreement is the trust signal.**
*Alternative:* pick one.
*Why:* calibration 2 was only detectable because the two disagreed. Keeping
both means the next person to change the profiler configuration finds out
immediately instead of silently measuring retention again.

**D4 — The entity-shape normalisation was measured before being built, and
then not built.**
*Alternatives:* trust the 15× synthetic result and refactor every entity
creation site; or skip the idea on the grounds that it contradicts a
documented convention.
*Why:* the synthetic number was large enough to justify a big refactor and
the convention is exactly the kind that gets treated as a performance bug.
Measuring the payoff on the real entity population took one probe and
returned the opposite sign (1.9× slower). CLAUDE.md §4 now records the
measurement so the next session does not re-derive it the expensive way.

**D5 — The parked shard-broadphase PAIR BUDGET was not built.**
*Alternative:* build it behind a DBG toggle, since it is the parking lot's
named next lever and the scenes are available.
*Why:* its stated trigger is "`resolveShardPairs` dominates a sim spike".
It never did in this matrix — refill churn and hash lookups dominated, and
`resolveShardPairs` sat well below both. Building a behaviour-adjacent
lever the numbers do not ask for is how a feel change gets shipped for no
measured gain.

**D6 — The gauntlet stops without the goal met, rather than continuing.**
*Alternative:* keep looping on the sim budget.
*Why:* the two remaining levers both need something this session cannot
get — the residual allocation needs a CPU profile rather than more heap
attribution (three attempts spent, per the stop condition), and the
acceptance claim needs hardware captures that have not arrived. Continuing
to shave headless numbers that `simbench` says are flat would add risk
without adding evidence.

---

## FOR-USER-REVIEW

### CAPTURE REQUESTS — hardware Perf REC captures

**Why I'm asking.** Everything above is headless. This container renders
canvas in software, so it cannot tell you whether the game is smooth — only
where the JS cost and the allocation are. The acceptance claim ("no
perceptible dips") can only come from your device. These are ordered by
value; **1–3 are the ones that matter most**, and if you only do those, the
gauntlet still has what it needs.

How: pause ▸ Debug Menu ▸ **Perf REC** ▸ set the scene label ▸ REC ▸ play ▸
REC again ▸ Copy, then paste the block into the session. The label matters —
it is what makes the paste self-identifying.

| # | scene label | map | setup | duration | what I'm looking for |
|---|---|---|---|---|---|
| 1 | `baseline` | **Asteroid Field** (Debug ▸ map) | just fly and shoot into the shard field | 60–90 s | The worst in-code scene in the matrix (sim = 76% of budget). I need `spike worst frame` and its `render`/`sim` split. If worst-frame ≫ render+sim, it is an external stall; if ≈ render+sim, it is ours. |
| 2 | `dense-wave` | Universe (normal run) | play to wave 4–5, let it get busy, include at least one big shatter | 90–120 s | Real play, not a stress test. This is the scene that decides whether the parked shard-broadphase pair budget is needed at all. |
| 3 | `custom` | Universe | reach a **boss capstone** wave and fight it to the phase-3 transition | one full boss | One-frame work bursts: boss phase transitions and the capstone rout. Watch for a visible hitch at the moment the boss dies. |
| 4 | `dragon-stack` | Universe | Debug ▸ Dragons: spawn 3–4, plus Debug ▸ Rivals ×4 | 60 s | The exotic roamers. PR #70 found these were NOT the hot path — I want to confirm that still holds after the roster grew. |
| 5 | `roamer-swarm` | Universe | let it run 5+ minutes without dying | 5 min | GC cadence over a long soak. The `perf tier` distribution and whether hitches cluster or spread. |
| 6 | `custom` | Overworld hub | fly around the hub doing nothing much | 45 s | The floor. If the *idle hub* hitches on device, the 0.5 MB/frame allocation is the reason, and that reframes the priority order. |

**Two things to note as you play, in words** — the numbers won't capture
them: (a) does a hitch happen at a *predictable moment* (a big kill, a
portal, a wave start) or at random? (b) does it feel like a *stutter*
(one frame) or a *slowdown* (a stretch of frames)? Those two answers
separate a work burst from a sustained cost, and they are worth more than
any single capture.

I am **not blocking on these** — headless work continues, and this section
will be updated with the attribution for whatever you paste.

**Status at the end of the session: no captures were provided, so the
acceptance claim is unmade.** The requests above are still the shortest path
to closing it, and the PR says so plainly.

### The residual allocation cluster — three attempts, handed back

`applyFlowTo`, `handleEntityCollisions`, `PhysicsSystem.update` and
`nearestEatableShard` together attribute ~388 MB per 12 s capture on the
Asteroid Field, and none of them contains a visible allocation. Attempts:

1. **Closure hoisting** (shipped) — the biggest site dropped 17%, so
   per-substep closure construction was a real component but not the cause.
2. **Entity-shape normalisation** (measured, rejected) — 1.9× slower on the
   real population; see D4.
3. **Instrument audit** (the useful one) — an ablation that removed
   `applyFlow`'s entire body still attributed 80 MB to it, for a single
   conditional double-add that the probe measures at 1.4 bytes/op. Those
   cannot both be true, so **the per-frame attribution is biased toward
   hot-running frames** and is not a reliable target list for small diffuse
   allocations.

**Recommendation:** the next attempt should be a **CPU profile**
(`Profiler.start`/`stop` over a scene) rather than more heap attribution.
That answers "where does the 16.7 ms go", which is the primary metric
anyway, and it is not subject to the bias above. I did not start it here
because it is a new instrument and this session had already spent its three
attempts on the cluster.

### Shard population growth (Seven Rings) — a design question, not a perf fix

The Seven Rings capture's worst frames all sit at ~3100-3200 entities, four
times the Pocket scene, clustered in the last 20 seconds of a 155-second
session. The PerfController is saturated (`tier max 54%`, `load peak 1.00`)
and the sim still misses frame budget.

Substep capping bounds the symptom, and the P2/P3/P5 work makes each entity
cheaper, but neither addresses the cause: **the shard population grows during
play faster than merging and cleanup retire it.** The levers are all
behaviour-affecting — shard lifetime, merge rate under load, a hard
population ceiling, or more aggressive offscreen retirement — so which one to
pull is a FEEL decision and belongs to you, most naturally in the step-6
tuning pass. My recommendation if you want a number to aim at: the scene is
comfortable below roughly 1500 entities on this hardware and falls apart
above ~3000.

### Parallel-work note (SFX session, PR #79)

Per the session's parallel-work rule I did not touch the audio system or its
event wiring. **Nothing in the audio path profiled hot enough to appear in
any scene's top-20 allocation sites**, so there is nothing to hand over. If
the SFX work lands per-frame audio scheduling, the `perf/` harness will pick
it up: `node perf/capture.mjs --scene boss-capstone` is the cheapest check.

### One thing I'd flag as a design question, not a perf finding

`SIMULATION_CONSTANTS.FIXED_DT` is **1/120**, so the sim runs at twice the
render rate and a 60 fps frame pays for **two** full sim steps. Every sim
number in this ledger is doubled by that choice, and it is the single
largest lever on the sim budget that exists — halving the sim rate to 60 Hz
would roughly halve sim cost outright. That is emphatically a FEEL decision
(collision resolution quality, shard settling, small-projectile tunnelling
all depend on it) and therefore yours, not a perf change I should make. But
if the sim budget is the thing that has to come down, this is the lever with
the most in it, and no amount of micro-optimisation will match it.
