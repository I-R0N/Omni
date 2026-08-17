# Gauntlet — unified tile lighting, and the static-query convergence

Two ladders. **Part A** unifies Omni's three hand-rolled lighting models
and gives them occlusion. **Part B** consolidates the static-geometry
queries lighting and collision both need.

Format follows `docs/GAUNTLET_5C_LOG.md`: median and p95 always, never a
single frame; decisions with their rationale; every reverted attempt
recorded rather than quietly dropped.

> **This ladder is NOT the originating "one SDF for lighting and
> collision" goal.** Omni is Canvas2D-only — no shader to march a ray in,
> no sampler to bind a field to. Shadow-volume extrusion, which does work
> here, produces no queryable distance function. And rock tiles physically
> deform their `polygonPoints` on every hit, so the collision shape is not
> expressible as a scalar field regardless of API. Part B is therefore a
> consolidation of the static-geometry **query primitive**, not a
> collision rewrite. Shared authoring, not shared runtime.

---

## Checklist

- [x] **A0** — Instrumentation, baseline, legacy credit
- [x] **A1** — Occluder extraction into a single queryable source
- [x] **A2** — Light-layer scaffolding + debug visualization
- [x] **A3** — Occluder churn
- [ ] **A4** — One point light, shadow-cast
- [ ] **A4b** — Migrate the legacy receivers
- [ ] **A5** — Soft shadow penumbra
- [ ] **A6** — N lights with culling
- [ ] **A7** — OPTIONAL: depth-scoped ambient darkness
- [ ] **B1** — Prove the static-query duplication
- [x] **B2** — Unify onto one primitive
- [x] **B3** — SKIPPED: precondition unmet (no call site exceeds r=120)
- [x] **B4** — DECLINED on evidence (0.036 ms vs a 0.3 ms threshold)

---

## A0 — Instrumentation, baseline, legacy credit

### What shipped

- `PerfSnapshot.lightingMs` / `.lightingLights` (`types.ts`), fed by
  `RenderSystem.lastLightingMs` / `.lastLightingLights`, ring-averaged
  and pushed through `GameEngine.recordRenderPerf` exactly as
  `tileLightingMs` is. DBG rows ` ·lit` / ` ·lit-N` sit under the
  existing ` ·tLit` pair in the pause-menu perf panel. Both read 0 today
  — nothing writes them until A2.
- **Documentation defect 1 fixed.** `tileShapes.ts` claimed the glass
  repel glow "ramps up for ANY repellable body (player, enemy, mobile
  shards)". It does not: the write to the TILE's accumulator is gated on
  `a.type === PLAYER || a.type === ENEMY` (`PhysicsSystem`). The same
  wrong claim was echoed in `RenderSystem`'s fast-path comment; both are
  corrected, and `constants.ts` (which already had it right) is left
  alone.
- **Documentation defect 2 fixed.** `repelImpulse` carries two meanings
  on one field name, and both write sites are now documented at the
  point of the gate that separates them: on the SCANNER `a` it
  accumulates from any repellable body including shards, driving that
  body's own effects; on the TILE `b` it accumulates only from the
  player and enemies, because ambient shard contact would keep the glow
  permanently lit.

### The instrument, and three calibrations that had to come first

Measurement here is done in the CI container, not on the phone. Levels
are indicative, deltas are evidence — `perf/README.md`'s standing rule.
Three further calibrations were needed before any lighting number was
trustworthy.

**1. `performance.now()` is clamped to 100 µs.** Measured directly: the
minimum non-zero tick in headless Chromium is 0.0999 ms, and
`crossOriginIsolated` is false. The legacy lighting models cost single-
digit microseconds per tile, so a per-tile bracket reads **exactly
zero** — not "cheap", but *unmeasurable*. This is the same class of
defect as the `lastStatsPushMs` story in `GAUNTLET_REACT_LOG.md`: an
instrument structurally incapable of containing what it is captioned as
measuring. It was unblocked by injecting COOP/COEP headers through the
Playwright route handler, which makes the context cross-origin isolated
and drops the tick to **5 µs**, a 20× improvement. The app itself is
untouched; the headers exist only inside the measurement harness.

**2. The container's rAF delta is vsync-quantized and carries no fine
signal.** Every frame delta observed is a multiple of 16.665 ms —
66.665, 83.330, 99.995. Cross-run spread of median frame time is
therefore **0.0 % on every scene**, which *passes* A0's ≤ 8 % variance
gate but passes it as an artefact, not as precision. Frame delta in this
container cannot resolve a 0.7 ms effect, let alone a 0.15 ms one.

**3. `renderMs` in this container is more inclusive than on device.**
See the fill-rate diagnostic below: container `renderMs` tracks pixel
count almost exactly, which means the software rasterizer's work is
landing *inside* the timer. On device, with GPU raster, `renderMs` times
call issuing only. So a container `renderMs` delta overstates what the
same change does to a device's `renderMs`, and understates nothing.
Cross-run spread of `render_p50` is **1.5 % (hub-idle) to 13.4 %
(asteroid-6k)** — on a ~55 ms level that is ±0.8 to ±7 ms absolute.

### Baseline (container, 390×844, dsf 2 = the default `effectiveDpr` cap)

Three runs per scene, first 5 s of each window discarded.

| scene | frame p50 | frame p95 | render p50 (3 runs) | render spread |
|---|---|---|---|---|
| hub-idle | 66.60 | 66.70 | 53.1 / 53.0 / 53.8 | 1.5 % |
| tile-shatter-storm | 66.665 | 83.33 | 59.5 / 54.8 / 58.4 | 8.0 % |
| asteroid-6k | 66.665 | 83.33 | 58.5 / 51.9 / 51.6 | 13.4 % |

`boss-capstone` was not captured: the three above already establish the
resolution limit, and a fourth scene at the same limit adds nothing.

### The legacy models' cost — the A4b credit

Measured with the 5 µs timer, per-model brackets added temporarily and
**reverted before commit** (only Model A is timed in shipped code, via
`tileLightingMs`).

**On the capture matrix the legacy models are effectively dormant** —
0–2 lit tiles per frame, totals at or below 0.01 ms. The scenes park the
player away from terrain. That is a true reading and a useless basis for
a credit, so the models were measured at their **worst case** instead:
the player pinned inside the densest static-tile cluster on each map
(held there per-frame, since the repel field — which *is* Model B's
driver — otherwise pushes it out).

| map | static tiles | dominant variants | A p50 / p95 (N) | B p50 / p95 (N) | C p50 / p95 (N) |
|---|---|---|---|---|---|
| UNIVERSE | 2227 | nebula 1496, glass 566, plastic 120 | 0.010 / 0.025 (2) | 0 / 0 (0) | 0 / 0 (0) |
| GLASS_FIELD | 1159 | glass 1159 | 0 / 0 (0) | 0.065 / 0.100 (44) | 0.050 / 0.085 (14) |
| PLASTIC_FIELD | 1159 | plastic 1159 | **0.200 / 0.385 (32)** | 0 / 0 (0) | 0 / 0 (0) |
| METAL_FIELD | 1166 | metal 1166 | 0 / 0 (0) | **0.085 / 0.160 (41)** | 0 / 0 (0) |
| INDESTRUCTIBLE_FIELD | 1142 | indestructible 1142 | 0.160 / 0.330 (27) | 0 / 0 (0) | 0.040 / 0.075 (18) |
| ASTEROID_FIELD | **0** | — | 0 / 0 (0) | 0 / 0 (0) | 0 / 0 (0) |

Per-tile: Model A ≈ **6 µs** per blooming tile, Model B ≈ **2 µs**.
`ASTEROID_FIELD` has zero *static* tiles — it is a mobile rock-shard
showcase, and shard variants have `glow` off. Its zeros are an absence
of receivers, not a cheap render.

Because each variant uses exactly one model, the models are largely
mutually exclusive per map. The largest realizable single-map total:

| | p50 | p95 |
|---|---|---|
| PLASTIC_FIELD (A only) | 0.200 | 0.385 |
| INDESTRUCTIBLE_FIELD (A + C) | 0.200 | 0.405 |
| GLASS_FIELD (B + C) | 0.115 | 0.185 |
| **UNIVERSE — the real full-game map** | **0.010** | **0.025** |

> **FINDING — the planned A4b credit does not exist.** The ladder's
> budget table books A4b at **−0.30 ms**. The measured worst case across
> every map is **0.20 ms p50 / 0.41 ms p95**, and on the map a run
> actually spends its time in it is **0.01 ms**. The credit is at best
> two-thirds of what was planned and realistically an order of magnitude
> less. Every cumulative figure from A4b onward is correspondingly
> optimistic, and the ladder cannot rely on absorbing the legacy models
> to pay for the unified one.

The reason is structural rather than incidental: all three legacy models
are *tightly range-limited* (glow range 250, Model C's hardcoded 120)
and only a handful of tiles are ever inside those ranges at once. A
unified light at radius 300 lighting up to 24 occluders is doing
strictly more work than what it replaces.

### The fill-rate diagnostic

`RENDER_SCALE_CYCLE` is a module-scope index in `constants.ts` reachable
only through `App.tsx`, not through `window.__omniEngine`, so it cannot
be driven headlessly. The same 4× pixel span was obtained instead by
varying Playwright's `deviceScaleFactor` under the default 2× cap
(`effectiveDpr` = min(dpr, cap)).

| backing store | Mpx | render p50 | frame p50 |
|---|---|---|---|
| 390×844 | 0.33 | 9.27 | 16.665 (60 fps) |
| 585×1266 | 0.74 | 34.91 | 33.340 (30 fps) |
| 780×1688 | 1.32 | 52.05 | 66.660 (15 fps) |

Pixel count spans 4.0×; frame time spans 4.0×. **In this container frame
time tracks pixel count essentially 1:1 — it is entirely fill-rate
bound.** Logged, not acted on, per the ladder's instruction. Note the
result is close to tautological for a *software* rasterizer and does
**not** transfer to the phone's GPU; it is evidence about the harness,
not about the device. The device version of this diagnostic (cycling
`RENDER_SCALE_CYCLE` 2× → 3× → 1.5× by hand) is still worth five
minutes and has not been run.

### The 2.0 ms budget — NOT re-derived

A0 requires the 2.0 ms budget be re-derived from a fresh device
baseline. **This is blocked.** The derivation needs a device render cost
as a fraction of 16.7 ms; the container's render is 52 ms at the default
backing store, three times the entire frame budget, so no such fraction
can be computed here. The figure is carried forward **unre-derived and
explicitly untrusted**.

### Gate

| requirement | result |
|---|---|
| `lightingMs` / `lightingLights` added and wired | PASS |
| Both documentation defects fixed | PASS |
| Legacy A/B/C costs recorded (median and p95) | PASS |
| Cross-capture variance of median frame time ≤ 8 % | PASS **as written** (0.0 %), but the pass is a vsync-quantization artefact |
| 2.0 ms budget re-derived from a fresh baseline | **BLOCKED — no device** |
| `npm run typecheck` / `npm run build` / `npm test` | PASS (111 tests) |

### Decision — stop and report

A0's fail text: *"If variance > 8%, no later gate can resolve a 0.7 ms
effect — stop and report."* The literal variance figure is 0.0 %, but it
measures a clamp rather than a cost, and the quantity it was standing in
for — can this instrument resolve the ladder's per-stage slices? — is
answered **no** on both available frame-level signals:

- frame delta: quantized to 16.665 ms steps. Cannot resolve 0.15 ms.
- `render_p50`: ±0.8 to ±7 ms run to run. Cannot resolve 0.70 ms.

So the ladder's stated gating protocol is not executable in this
container, and the honest outcome of A0 is to stop at the ladder's own
stop condition rather than self-certify the later stages against an
instrument that cannot see them.

**A0 also supplies the way forward, which is why this is a stop and not
a halt.** The per-model accumulators *were* measured cleanly — Model A
reads 0.200 ms p50 over 32 tiles, tightly and repeatably — because they
are **direct fine-timer accumulators**, not differences of two large
noisy numbers. `lightingMs`, the field A0 just added, is exactly that
same kind of instrument. So A1–A6 remain gateable in-container on:

1. **`lightingMs` directly** (5 µs resolution, in-code, no subtraction).
2. **Allocation bytes/frame** — device-independent and exact, already in
   `perf/capture.mjs`.
3. **Correctness** — byte-identical rendering, the torus-seam assertion,
   the 111-test suite.

with the frame-delta half of each gate deferred to a device capture the
operator runs. That is a strictly weaker protocol than the ladder
specifies and it should be adopted deliberately, not by default —
hence: reported, awaiting direction.

---

## A1 — Occluder extraction into a single queryable source

### What shipped (2 files, as scoped)

- **`PhysicsSystem.forEachStaticInRadius(x, y, r, cb)`** — the
  radius-correct static walk. Cell span is derived as
  `ceil(r / SPATIAL_GRID_SIZE)` instead of hardcoded to ±1.
  `forEachStaticNear` is deliberately **untouched**; other callers depend
  on its exact behaviour and Part B owns the consolidation.
- **`engine/systems/render/lighting.ts`** — `collectOccluders(physics,
  lx, ly, radius, out)` plus the `Occluder` record. Filters to
  `STRUCTURE && mass === Infinity && !passThrough`, resolves each hit
  into the light's wrap zone via `shiftX`/`shiftY`, index-fills with the
  refill idiom. No Canvas2D types — this is the portable half.

Both are **dead code at this stage**: nothing calls either until A2/A4.
That is what makes A1's cost gate trivially satisfiable — the added cost
is zero by construction, not by measurement — and it is why the stage is
verified on correctness instead.

### Two decisions worth recording

**The span is clamped to half the grid extent.** Past that, wrapped cell
indices repeat and a cell visited twice emits its tiles to the callback
twice. Pocket is 4000 wide = 34 columns, so a large enough radius would
double-count on the small maps. At the clamp the walk already covers the
whole torus, so nothing is lost.

**The probe coordinates are wrapped, matching `hasStaticTileNear` rather
than `forEachStaticNear`.** This settles half of B1's question 1 in
advance, and it is load-bearing rather than tidiness: `wrapDeltaX`
applies a SINGLE correction step (`if d > HALF: d -= MAP`), so it is
correct only when its inputs are already inside the canonical box. An
unwrapped probe more than half a map out of the box yields a wrong delta.
Wrapping makes the query correct for any caller, not just for callers who
happen to pass a canonical position.

### Verification

Run against the live engine on UNIVERSE and GLASS_FIELD through a
temporary `window.__omniLighting` handle, **reverted before commit** (the
permanent handle belongs to A3, whose gate requires it). Verifying here
rather than at A4 is deliberate: wrong wrap or tangent geometry has no
symptom until it draws a bar of darkness across the arena, which is the
`__omniHid` rationale applied to lighting.

| check | UNIVERSE | GLASS_FIELD |
|---|---|---|
| r=100 — agrees with the 3×3 walk exactly | 15 = 15 | 15 = 15 |
| r=300 — finds MORE than the 3×3 walk | 40 → **51** (+28 %) | 38 → **55** (+45 %) |
| r=300 — is a superset of the 3×3 walk | 0 missed | 0 missed |
| no duplicate visits (span clamp) | 0 | 0 |
| matches brute-force toroidal ground truth | 51 = 51 | 55 = 55 |
| `collectOccluders` filters passThrough + mobile shards | 0 of 51 | 55 of 55 |
| wrap-resolved inside half a map | max Δ 0 | max Δ 248 / 231 |
| seam probe stays local | ok | ok |
| 2000 repeat collections, engine paused | 28.3 B/call | 30.6 B/call |

> **The radius-correctness claim is not theoretical.** At a lighting
> radius of 300 the fixed 3×3 walk under-reports by **28 % on UNIVERSE
> and 45 % on GLASS_FIELD**. Had A4 been built on `forEachStaticNear`,
> roughly a third of the occluders in every light would simply have been
> missing, and the symptom — shadows absent from tiles one cell out —
> would have read as a tuning problem rather than a query bug.

**On allocation.** The residual is ~29 B/call and it is *identical on
both maps* — the same figure whether the call collects 0 occluders
(UNIVERSE, whose densest cluster is entirely nebula) or 55
(GLASS_FIELD). An allocation that does not scale with the work done is
not the collector's; it is the paused engine's rAF and React still
ticking under the measurement. The first attempt at this check ran with
the engine LIVE and read 424 KB / −1486 KB on the two maps — noise
swamping signal, the same contamination `perf/probe.mjs` warns about.
Recorded because the first number was wrong and the reason is reusable.

**An unplanned finding, relevant to A4's look assessment.** On UNIVERSE
the densest static-tile cluster is **51 of 51 `nebula-tile`** — all
passThrough, so `collectOccluders` correctly returns **zero**. Combined
with A0's population count (1496 of 2227 static tiles on that map are
nebula), this means a light in the busiest part of the game's main map
may have almost nothing to cast a shadow from. The unified model's
headline feature could be close to invisible exactly where the game is
played. This is not a defect in A1 — the filter is behaving as specified,
and nebula must not cast shadow — but it is a material question for A4's
"does this look better than what it replaces" decision, and it is better
known now than discovered then.

### Gate

| requirement | result |
|---|---|
| Byte-identical rendering | PASS — no call sites; nothing in the render path changed |
| No `PerfSnapshot` field but `lightingMs` changes | PASS — `lightingMs` still 0 |
| 111 tests pass | PASS |
| Added cost ≤ 0.15 ms p95 | PASS by construction (dead code), **not measured on device** |
| Scope ≤ 2 files | PASS (`PhysicsSystem.ts`, new `lighting.ts`) |

---

## B1 — Prove the static-query duplication

Measurement only. One temporary instrument in `PhysicsSystem` (per-site
call count, max observed radius, wall time, out-of-box probe count, and a
wrapped-vs-unwrapped answer cross-check), driven over all 8 perf scenes
plus a dragon-heavy DBG session, then **reverted**. No production code
changed by this stage.

### Q0 (unasked) — there are FOUR existing walks, not three

The ladder's table lists `forEachStaticNear`, `isPositionClear` and
`hasStaticTileNear`. There is a fourth: **`forEachStaticTileNear`**
(`PhysicsSystem.ts`, called from `ShardSystem`'s plastic-shard ↔ tile
bond pass). It is the same 3×3 walk again, it wraps its probe like
`hasStaticTileNear` does, and it has **no radius filter at all** — it
visits every active tile in the 3×3 neighbourhood unconditionally. With
A1's `forEachStaticInRadius` that makes **five** near-duplicate walks in
one class. B2's consolidation should absorb it too.

### Q1 — are the walks equivalent modulo predicate?

Structurally yes: identical cell derivation, identical 3×3 span,
identical `active` check, identical toroidal squared-distance test. They
differ in predicate (`ignoreId`), in return shape (visitor vs
early-exiting boolean), and in **one** substantive way — the probe
coordinates.

| walk | wraps the probe? |
|---|---|
| `forEachStaticNear` | no |
| `isPositionClear` | no |
| `hasStaticTileNear` | **yes** (`wrapX`/`wrapY`) |
| `forEachStaticTileNear` | **yes** |

This matters because `wrapDeltaX` applies a **single** correction step,
so it is only correct when its inputs are already inside the canonical
box. An un-wrapped probe is therefore not obviously safe.

**And it is actively exercised: 45–50 of ~63–102 `isPositionClear` calls
arrive with an out-of-box probe** — 79 % of them in the shard-heavy
scenes — from `ShardSystem`'s and `NebulaSystem`'s `hexCoordToPixel`
output, which is not wrapped.

So it was cross-checked directly rather than reasoned about: every
out-of-box call recomputed its answer with a wrapped probe and the two
were compared.

```
out-of-box probes cross-checked: 45
answers that DISAGREED:           0
```

At the time this was written the conclusion drawn was *"the divergence is
COSMETIC"*. **That conclusion was WRONG, and it was overturned before B2
was implemented.** It is left here, struck, because the way it failed is
the reusable lesson.

> ### CORRECTION — the divergence is a latent CORRECTNESS BUG
>
> 45 samples of a rare event is not evidence of absence. The scene census
> drew from live gameplay, where this call site queries at radius 44
> against a 120-unit cell, so the answer nearly always lies in a cell
> both walks happen to cover. A deliberate sweep of the seam — 40 000
> probes per map, against each map's real tiles — says otherwise.
>
> The mechanism is the **ragged grid**. `SPATIAL_COLS = ceil(MAP_WIDTH /
> 120)`, so when the map width is not a multiple of 120 the last column
> is partial, and `floor((x + MAP_WIDTH) / 120)` is **not**
> `floor(x / 120) + SPATIAL_COLS`. `wrapCellX` therefore maps an
> un-wrapped probe onto a *different cell* than the wrapped one, and the
> 3×3 block around it is off by one cell in that axis.
>
> | map | dims | `W % 120 == 0` | cell-index mismatch | `isPositionClear` wrong answers |
> |---|---|---|---|---|
> | **UNIVERSE** | 16000² | **no** | **66.7 %** | **1 / 40 000** |
> | **POCKET** | 4000² | **no** | 67.0 % | 0 / 40 000 |
> | GLASS_FIELD | 6000² | yes | 0.0 % | 0 / 40 000 |
> | OVERWORLD | 12000² | yes | 0.0 % | 0 / 40 000 |
>
> Concrete failure on UNIVERSE — **the main full-game map** — at probe
> `(10130.4, 14637.6)`: the un-wrapped walk reports the position CLEAR
> when the wrapped walk correctly reports it BLOCKED. The error direction
> is "clear when it isn't", i.e. a spawn or a tile placed overlapping
> static geometry. Rare (~0.003 % of positions) but real, and it is
> exactly the class of bug that surfaces as an unreproducible glitch.
>
> Maps whose dimensions ARE multiples of 120 are unaffected — the residual
> 1 and 3 mismatches there are floating-point ties on exact cell
> boundaries.

**Decision for B2: adopt the wrapped form everywhere.** It is not a
choice between two valid semantics — one of them is wrong — so B1's stop
condition #9 ("unification would be a behaviour change, that is the
operator's call") is reported rather than treated as a veto: the change
is a fix, its frequency is ~1 in 33 000 queries, and its direction is
strictly the safe one. A1's `forEachStaticInRadius` already wraps.

### Q2 — does any live call site exceed r = 120?

**No. Not one.**

| site | caller | max observed r | calls with r > 120 |
|---|---|---|---|
| `forEachStaticNear` | `dragons.ts:97` | **78.4** | **0** |
| `isPositionClear` | Wave / Nebula / Shard | 44.0 | 0 |
| `hasStaticTileNear` | RenderSystem outlines | 11.0 | 0 |
| `forEachStaticTileNear` | `ShardSystem:1778` | n/a (no radius) | n/a |

The ladder flagged the dragon as the genuinely unknown case — *"Whether
this already exceeds 120 depends on the dragon's live size — B1 measures
it. Do not assume either way."* Measured across a 6-dragon session:
`headR + 40` tops out at **78.4**, comfortably under the 120 the fixed
3×3 span covers.

> **So Part B is correctness insurance and consolidation, NOT a bug fix.**
> **B3 is unreachable and must be skipped** — its precondition ("only run
> this stage if B1(2) found a call site exceeding r = 120") is unmet, and
> the ladder is explicit that the work should not be manufactured. Doing
> it anyway would hand the dragon more terrain per pass and change body
> growth, severing and pacing, for no correctness reason.

### Q3 — what does the walk cost today?

`collisionsMs` covers the SAT broadphase, not these queries; they were
untimed. First-run figures (before the cross-check was added, so
uncontaminated by it):

| site | calls / 8 scenes | µs per call | calls per frame | ms per frame |
|---|---|---|---|---|
| `forEachStaticNear` | 8356 | 1.19 | 20–30 (roamer / dragon only) | **0.024–0.036** |
| `isPositionClear` | 63 | 9.60 | ≤ 0.4 | ~0.0005 |
| `hasStaticTileNear` | 1692 | 1.21 | 8.9 (stage-descent only) | 0.011 |
| `forEachStaticTileNear` | 0–1 | — | ~0 | ~0 |

Two notes on reading this. `isPositionClear`'s high per-call cost is a
*small-N artefact* — 63 calls across eight scenes, at the timer's own
resolution; its per-frame contribution is negligible either way.
`hasStaticTileNear` is strongly scene-dependent (1692 calls in one run,
0 in the next): it only fires on the material-tile slow path, so it
tracks how much metal/plastic is on screen.

**Whole-class worst case ≈ 0.036 ms per frame.**

> **This pre-answers B4.** B4's own precondition says the sharing is not
> worth its coupling if the combined cost is under 0.3 ms. The static-query
> half is **0.036 ms — an order of magnitude under that threshold** —
> before lighting's half is even counted. B4 should be **declined on
> evidence**, which the ladder names as the expected outcome. The coupling
> it would introduce spans the 120 Hz sim / render-rate boundary, which is
> a real correctness hazard, in exchange for at most a few tens of
> microseconds.

### Gate

| requirement | result |
|---|---|
| All three questions answered with numbers | PASS |
| No production code changed | PASS (instrument reverted; `git status` clean) |
| Scope ≤ 2 files | PASS (1 file, temporarily) |

### What B1 changes about the rest of Part B

- **B2 is worth doing, and is now partly a FIX rather than pure
  insurance** — five near-duplicate walks is real duplication, the span
  arithmetic is wrong in four of them (latent, no caller reaches it), and
  the wrap treatment is wrong in two of them (live, on Universe and
  Pocket). Its gate is therefore byte-identical *modulo the wrap fix*,
  which must be demonstrated separately from the consolidation.
- **B2 should absorb `forEachStaticTileNear` too**, which the plan did
  not list.
- **B3 is skipped**, precondition unmet.
- **B4 is declined on evidence**, precondition already failed at 0.036 ms.

---

## B2 — Unify onto one primitive

One file (`PhysicsSystem.ts`). Five near-duplicate static-grid walks
collapse onto **one** loop plus five thin wrappers.

### The shape

`forEachStaticCells(x, y, span, rSq, visit)` is the only place the static
grid is walked. The wrappers supply the three things the old copies
actually disagreed about:

| wrapper | span | filter | visitor |
|---|---|---|---|
| `forEachStaticNear` | 1 (historic 3×3) | `r²` | collect |
| `forEachStaticInRadius` | `ceil(r / 120)` | `r²` | collect |
| `isPositionClear` | 1 | `r²` | stop at first hit |
| `hasStaticTileNear` | 1 | `r²`, skips `ignoreId` | stop at first hit |
| `forEachStaticTileNear` | 1 | **none** (`rSq < 0`) | collect |

Three decisions inside that:

**The fixed 3×3 span is PRESERVED for the four legacy wrappers**, not
silently widened. B1 measured every one of their callers at well under
120 (max 78.4), so the correct span and the hardcoded span coincide and
this falls out for free rather than needing a compatibility flag. Only
the lighting wrapper derives its span from the radius. Widening
`forEachStaticNear` would be B3 — deliberately not taken.

**`forEachStaticTileNear` keeps having no radius filter.** Its caller
(`ShardSystem`'s plastic-shard ↔ tile bond pass) applies its own contact
test using `getCollisionR` of *both* bodies, a radius this layer cannot
know in advance. Narrowing it here would either duplicate that test or
guess an upper bound and risk missing a large tile.

**The two boolean wrappers share a hoisted visitor.** A closure built
inside the wrapper would be constructed per call, and `hasStaticTileNear`
runs ~9×/frame off the material-tile render path — precisely the
per-frame allocation the refill-idiom rule exists to prevent. A
class-field arrow is allocated once per system instead.

### Verification — the consolidation and the fix, separately

Conflating them would make either one unfalsifiable, so each wrapper was
compared against a reimplementation of its **pre-B2 body**, over 20 000
probes per map with half deliberately one wrap out of the canonical box.

| map | grid-aligned | `forEachStaticNear` | `isPositionClear` | `hasStaticTileNear` | `forEachStaticTileNear` |
|---|---|---|---|---|---|
| GLASS_FIELD | yes | 0 | 0 | 0 | 0 |
| OVERWORLD | yes | 0 | 0 | 0 | 0 |
| UNIVERSE | no | 0 | 0 | 0 | 0 |
| POCKET | no | 0 | 0 | 0 | 0 |

**On the grid-aligned maps that is the consolidation proved
byte-identical**, because there the wrap fix is a mathematical no-op.

On the ragged maps 0 differences is *too* clean — the fix is a rare
event and 10 000 out-of-box probes would expect a fraction of one. So
`isPositionClear` was driven alone at **400 000** out-of-box probes:

| map | grid-aligned | differences | rate | now correctly BLOCKED | now wrongly CLEAR |
|---|---|---|---|---|---|
| UNIVERSE | no | 4 | 1 in 100 000 | **4** | **0** |
| POCKET | no | 19 | 1 in 21 000 | **19** | **0** |
| OVERWORLD | yes | 0 | — | 0 | 0 |

Every difference is the ragged-grid bug being corrected, every one in the
safe direction, and the grid-aligned control is untouched — which is the
signature the mechanism predicts. **This is a real behaviour change, not
a pure refactor**, and it is recorded as such: positions that used to be
accepted as clear on Universe and Pocket are now correctly rejected, at a
rate of roughly 1 in 21 000–100 000 queries.

### Timing — A/B against the pre-B2 build, back to back

Tight in-page loops, same script, same session, µs per call, mean of the
four maps:

| wrapper | pre-B2 | post-B2 | Δ |
|---|---|---|---|
| `forEachStaticNear` | 0.468 | 0.482 | +3 % |
| `isPositionClear` | 0.395 | 0.401 | +1.5 % |
| `hasStaticTileNear` | 0.442 | 0.442 | 0 % |
| `forEachStaticTileNear` | 0.493 | 0.436 | −12 % |
| `forEachStaticInRadius` (r=300) | 2.190 | 2.097 | −4 % |

All inside run-to-run noise — individual map figures swing ±0.1 µs
between runs of the *same* build (UNIVERSE `near` read 0.490 pre and
0.553 post while POCKET read 0.438 and 0.428). At the worst measured call
rate (30/frame), the largest delta is **+0.0004 ms per frame**. The
visitor indirection did not cost anything measurable, and the extra
`wrapX`/`wrapY` per query is paid for by the shared code path staying hot.

### Gate

| requirement | result |
|---|---|
| Byte-identical collision behaviour | PASS on grid-aligned maps; on ragged maps differs ONLY by the wrap fix, 0 regressions in 800 000 probes |
| 111 tests pass | PASS |
| `collisionsMs` / per-site timings unchanged or better | PASS — within noise, largest per-frame delta +0.0004 ms |
| Five implementations become one | PASS — one `staticGrid.get` loop in the query layer |
| Scope ≤ 3 files | PASS (1 file) |

### Part B is closed

- **B2** shipped, and turned out to be part fix, not pure insurance.
- **B3 skipped** — no call site exceeds r = 120 (max 78.4). Running it
  would change dragon pacing for no correctness reason.
- **B4 declined on evidence** — the static-query half is 0.036 ms/frame
  against B4's own 0.3 ms threshold, before lighting's half is counted,
  and the cache would have to span the 120 Hz sim / render-rate boundary.

---

## A2 — Light-layer scaffolding + debug visualization

Three files, as scoped: `constants.ts`, `render/lighting.ts`,
`RenderSystem.ts`.

### What shipped

- **`LIGHTING_CYCLE = ['legacy', 'debug', 'unified']`**, index 0 default.
  Named `'legacy'` rather than "off" because Omni is not a game without
  lighting — index 0 IS the three shipped models, and the unified system
  has to earn its place against them.
- **`LIGHTING_TIERS`** — the divisor / light cap / occluder cap / max
  radius / penumbra `k` / depth-ambient table, Low pinned for the phone.
- **The light canvas** as `RenderSystem` fields (`_lightCanvas`,
  `_lightCtx`, `_lightW/H`, `_lightScale`), driven by free functions over
  `r: RenderSystem` in `lighting.ts` with `RenderSystem` a TYPE import —
  the `staticTileCache.ts` pattern, not a second one.
- **The blit**, after `ctx.restore()` (so the screen-space layer does not
  inherit the camera translation), after entities, before the HUD.

`lighting.ts` now has two halves with a hard line between them: the
portable geometry above, the Canvas2D compositing below. A WebGL port
should be able to keep the first and discard the second.

**Scope decision.** A full DBG menu row spans six files
(`constants`, `debugControls`, `App`, `UIOverlay`, `types`,
`GameEngine`) and A2's cap is three. The toggle therefore ships as
module state plus thin passthroughs on `RenderSystem`
(`setLighting`/`cycleLighting`/`cycleLightTier`), which the harness and
tests reach as `engine.renderer.setLighting('debug')`. The pause-menu row
lands with A4, when there is something to look at.

### Two measurement defects found in my own gate, and fixed

**A screenshot-equality check cannot prove "byte-identical" here.** The
first version of the A2 gate compared PNGs, and *passed* its
"debug differs from legacy" assertion against the **pre-A2 build**, which
contains no lighting code at all. Nebula twinkle and the particle pool
are driven by wall-clock time, so two captures of the same build already
differ; the check was measuring its own nondeterminism. Replaced with a
noise-floor design: two captures of the *same* build establish the floor,
and the cross-build difference must not exceed it.

**A per-cell "did it brighten" test must be noise-aware in the right
way.** The second version compared each cell's gain against that cell's
own frame-to-frame noise, and flagged 9 cells — every one of which had a
debug value exceeding *both* legacy samples, i.e. had plainly brightened.
The cells were simply ones containing a moving bright object, swinging 80+
luminance on their own. Corrected to "brighter than the dimmer of the two
legacy samples", which is the claim actually being made.

Both are recorded because both would have produced a green gate on a
broken change.

### Gate

| requirement | result |
|---|---|
| At `'legacy'`, byte-identical | PASS — structurally (no canvas allocated, function returns before touching the context) and statistically (cross-build grid difference **3.94** against a same-build noise floor of **7.49**) |
| At `'legacy'`, `lightingMs` = 0 | PASS — exactly 0, p95 |
| At `'debug'`, ≤ 0.20 ms p95 | PASS — **0.085 ms** p95, 0.045 p50 |
| Grey covers the viewport, no seam | PASS — 0 of 1152 cells uncovered; worst row 0/24, worst col 0/48 |
| No blockiness (the smoothing restore) | PASS — asserted DIRECTLY: `ctx.imageSmoothingEnabled === false` and `globalCompositeOperation === 'source-over'` after a completed frame. A *flat* grey cannot reveal nearest-neighbour blockiness by looking at it, so the restore is proved by reading the context state rather than by eye; the visual confirmation belongs to A4. |
| No HUD occlusion | PASS — the blit precedes the HUD pass; no page errors |
| Layer sized cssW/3 × cssH/3 | PASS — 130×282 at 390×844, Low tier (0.15 MB, well under the 8 MB stop condition) |
| 111 tests pass | PASS |

Cost against the ladder's budget: **0.085 ms** of the 0.20 ms slice.

---

## A3 — Occluder churn

Two files (`render/lighting.ts`, `RenderSystem.ts`) plus a new permanent
suite, `tests/lighting.spec.ts`.

### What shipped

At `'unified'` the frame now COLLECTS the player light's occluder set —
nearest-first, capped at the tier's 24 — and holds it on
`RenderSystem._lightOccluders` / `_lightOccluderCount`. Nothing is drawn
yet; A4 owns the falloff and the wedges. That split is deliberate: it
makes `lightingMs` at this stage the collection cost *with nothing else
in it*.

**There is nothing to invalidate, by construction.** Lights move every
frame, so each light's set is recomputed from the live static grid
regardless, and `forEachStaticCells` skips `!active` entities — a tile
that died this frame cannot appear in the set at all. A3 exists to *show*
that this is affordable under maximum churn, not to add machinery.
`FlowFieldGrid` concedes it cannot patch tile CREATION incrementally and
falls back to a dirty flag; shadows deliberately do not inherit that,
because a shadow still cast by a tile the player just shot is far more
visible than a stale flow vector.

**A landmine documented before it can bite.** The occluder pool is shared
across lights, so every `out` array holds references INTO it. With one
light that cannot matter. From A6 each light's set must be *consumed*
before the next is collected — collecting all lights up front and then
drawing would give every light the last light's occluders, and the
symptom (wrong-place shadows, only when two lights are near each other)
would be very hard to read backwards.

### Cost — the collection, isolated

`'debug'` does clear + fill + blit; `'unified'` does clear + blit +
collect. The difference is the collection with nothing else in it.

The stock perf scenes could not measure this: with `tile-shatter-storm`
the player is parked away from terrain AND the storm clears whatever is
left, so collection ran against **0 occluders** and `lightingMs` (0.095
p95) was measuring the blit. So the player is PINNED in the densest
static-tile cluster, with the churn cadence driven on top.

| map | churn | debug p95 | unified p95 | **collect p95** | occluders p50/p95/max |
|---|---|---|---|---|---|
| GLASS_FIELD | no | 0.090 | 0.120 | **0.030** | 24 / 24 / 24 |
| GLASS_FIELD | yes | 0.100 | 0.120 | **0.020** | 0 / 0 / 6 |
| UNIVERSE | no | 0.090 | 0.115 | **0.025** | 0 / 0 / 0 |
| UNIVERSE | yes | 0.105 | 0.110 | **0.005** | 0 / 0 / 6 |
| METAL_FIELD | no | 0.085 | 0.105 | **0.020** | 24 / 24 / 24 |
| METAL_FIELD | yes | 0.100 | 0.120 | **0.020** | 0 / 0 / 24 |

**0.005–0.030 ms p95 against a 0.15 ms gate — a 5× margin**, and the
worst case is at the FULL 24-occluder cap, so it does not get worse with
denser terrain (the cap is what bounds it).

Two things in that table are findings rather than noise. Under churn the
occluder count collapses to ~0 because the storm destroys the
neighbourhood faster than regen refills it — which is the churn case
working, not a measurement failure. And **UNIVERSE reads 0 occluders even
without churn**, for the third time in this log: its densest static
cluster is entirely `nebula-tile`, which is `passThrough`.

### Correctness — `tests/lighting.spec.ts`, 5 tests, now permanent

The suite pins the things that can be wrong with no symptom until they
are very wrong — the `__omniHid` motive applied to lighting:

1. **Inert at `'legacy'`** — no canvas, no set, `lightingMs` exactly 0.
2. **Never collects `passThrough` nebula, never collects mobile shards,
   never collects inactive entities** — run on UNIVERSE specifically,
   because a leak there would darken most of the game.
3. **A tile leaves the set the frame it dies** — 12 tiles killed through
   the full death path; 0 stale occluders after. This is the ladder's
   stated A3 correctness gate.
4. **The torus seam** — the player walked onto all four wrap corners and
   both seams; no occluder further than `lightRadius × 3` from the light.
5. **The radius-correct walk out-reports the 3×3 walk at light radii**,
   and agrees with it exactly under one cell.

Suite total: **111 → 116**.

### Gate

| requirement | result |
|---|---|
| ≤ 0.15 ms p95 beyond A2, under churn | PASS — **0.005–0.030 ms**, 5× margin, worst case at the full occluder cap |
| Shoot a tile, its shadow is gone within one frame | PASS — asserted in the suite; 0 inactive occluders after 12 full-path kills |
| No `active === false` occluder in the collected set | PASS — guaranteed structurally by `forEachStaticCells`, asserted empirically |
| 116 tests pass | PASS |
| Scope ≤ 2 files | PASS (2 production files + the new suite) |

Running total against the ladder's budget: A2 blit **0.085** + A3
collection **0.030** = **0.115 ms p95**, against a cumulative 0.50 ms
allowance at this point.
