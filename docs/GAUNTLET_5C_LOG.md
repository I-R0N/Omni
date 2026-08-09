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
- [ ] **P2** — Fix, worst spike first; loop until dry
- [ ] **P-final** — Validation + report

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

That makes entity-shape normalisation the highest-value remaining lever, and
it is the P4 milestone. It is also the first change in this gauntlet that
touches a documented architectural convention, so it needs its own careful
treatment rather than being folded in here.

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
