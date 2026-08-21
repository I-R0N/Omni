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
- [x] **A4** — One point light, shadow-cast (look confirmed on device at A5)
- [x] **A4s** — Shard occluders (user request)
- [x] **A5** — Soft shadow penumbra (brought forward by user request)
- [x] **A5b** — Cast from the polygon inradius, not the bounding box
- [x] **A5c** — Cast from the BODY (per-edge shadow volume); ship on unified
- [x] **A5d** — Penumbra as a cone, not an offset; glass transmits light
- [x] **A5e** — Two tiers below Low; refraction prototype behind a DBG toggle
- [x] **A5f** — Light brightness; softer shadows; brighter caustics; metal/glass emit
- [x] **A5g** — Seven tiers; an emission knob; optional (costly) emitter shadows
- [x] **A4b** — Migrate the legacy receivers
- [x] **A6** — N lights with culling
- [x] **A7** — Depth-scoped ambient darkness
- [x] **B1** — Prove the static-query duplication
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

---

## A4 — One point light, shadow-cast

Two files (`render/lighting.ts`, `RenderSystem.ts`), plus one more test in
the suite.

### What shipped

One light at the player, radius 300 (Low tier), coloured with the ship's
own engine glow (`PLAYER_TRAIL_CONSTANTS.COLOR`) so it reads as coming
FROM the ship. Per light, per frame, exactly the Core Technique:

1. A cached radial falloff, created at the origin and moved by the
   transform so the cache key is the RADIUS alone — a moving light reuses
   one gradient object. Camera zoom is the only thing that changes the
   radius, so the map holds a handful of entries.
2. **One** compound path of every shadow wedge — two tangents from the
   light to the occluder's circumcircle, extruded to 1.6× the light
   radius, closed with a far arc — filled **once** under
   `destination-out`. Overlapping wedges union under nonzero winding, so
   no per-wedge state change.
3. Blitted with `'lighter'`.

**Four draw operations per light regardless of occluder count.** The cost
is path construction, bounded by the tier's occluder cap.

Two simplifications worth recording. **No clip is set**: the falloff is
alpha 0 beyond its radius and `destination-out` against alpha 0 is a
no-op, so wedges running past the light's edge cost and harm nothing —
which removes the per-light `save`/`restore` a scissor rect would have
needed. And `setTransform` is used instead of `save`/`translate`/
`restore`: same effect, no state stack.

### The bug that would have shipped as "shadows don't work"

The first implementation drew no shadows at all — and threw no error,
produced no wrong-looking geometry, and passed every structural check.
Measured, the light gain was a uniform **12.5 luminance at every bearing,
including directly behind the occluder**.

The cause: at the `destination-out` fill, `fillStyle` was still the
falloff **gradient** from step 1. Under `destination-out` only the source
ALPHA matters, and that gradient — created in user space at the origin,
then used under the identity transform — sits centred on the canvas
corner and reads alpha 0 everywhere near the wedges. It erased exactly
nothing. Setting `fillStyle = '#000'` before the fill is the whole fix.

It is recorded because the failure mode is the dangerous one: the
geometry was correct, the path was correct, the composite mode was
correct, and the output was silently empty.

**It was only caught by changing the measurement, not the code.** The
first probe compared two points assuming the player sits at exact screen
centre; that gave "behind 14.2 vs clear 14.8" — a 0.6 difference readable
as "the shadow is too weak, tune it". Sweeping 72 bearings around the
light's *actual* computed centre instead produced a flat 12.5 everywhere,
which is not a tuning problem at all.

### Shadow profile, measured

One tile due east at 120 u, probes on a ring at 220 u, gain = lit − unlit:

| bearing | 0° | 5° | 10° | 15° | 90° | 180° | 270° | 345° | 350° | 355° |
|---|---|---|---|---|---|---|---|---|---|---|
| gain | **0.0** | **0.0** | 10.3 | 12.7 | 12.3 | 12.8 | 12.9 | 12.8 | **4.1** | **0.0** |

Mean gain inside the predicted shadow **2.88**, outside **12.70**.
Predicted half-angle `asin(22/120)` = **10.6°**; the observed transition
sits between 5° and 10–15° on one side and 345°–355° on the other. The
geometry is doing what the arithmetic says.

### Gate

| requirement | result |
|---|---|
| ≤ 0.70 ms p95 beyond A3 | PASS — **0.28–0.31 ms** (GLASS 0.290, METAL 0.280, UNIVERSE 0.305), at the full 24-occluder cap |
| No wedge vertex beyond `lightRadius × 3` | PASS — far edge is 1.6×; asserted in the suite across all four wrap corners |
| An occluder leaves the point behind it strictly darker | PASS — behind **0.0** vs clear **12.8** at equal radius |
| Additive-only: never darker than the unlit world | PASS — behind-lit 0.0 vs unlit 0.0 |
| `passThrough` variants cast nothing | PASS — nebula collects 0 occluders; ring uniformly lit |
| 117 tests pass | PASS (suite 116 → 117) |

Running total: A2 blit **0.085** + A3 collect **0.030** + A4 light
**0.310** = **0.425 ms p95** against a 1.20 ms cumulative allowance.

### THE LOOK DECISION — operator's call, evidence attached

Screenshots captured per map at `'legacy'` and `'unified'` from the same
camera. What they show:

- **On the showcase maps (metal / glass / plastic) the effect is strong
  and correct.** Clear umbra cones radiate away from the ship behind each
  tile cluster; the near faces of the clusters are lit and the far sides
  fall off. It reads as a real light source rather than a tint.
- **On UNIVERSE — the map a run actually plays — it is muted.** The
  nebula that makes up two thirds of that map's static tiles is already
  bright, is `passThrough`, and therefore both swamps the additive light
  and casts no shadow. The glass tiles that *would* cast are typically
  outside the strong part of the falloff.

This is the third independent confirmation of the same structural fact
(A0's population count, A1's all-nebula densest cluster, A3's zero-
occluder reading): **the unified model's headline feature is strongest
exactly where the game is not played.**

On Model A parity: the ladder required the unified light reproduce the
proximity bloom's read — the highlight sliding along a tile's perimeter
as the player orbits. It does so *by construction* rather than by
imitation, since a true point light lights the near face and that IS the
same phenomenon. But it is not identical: Model A tinted one tile face
and nothing else, where this brightens the tile AND the space around it.
That difference is a matter of taste, not correctness, and belongs to the
same decision.

**A4 is complete and gated. A4b (migrating the legacy receivers, and
deleting them) is deliberately NOT started**, because it is the
irreversible half and its precondition is the operator confirming the
unified look is at least as good.

### The DBG rows, landed here rather than at A2

A2 deferred the pause-menu control because a DBG row spans six files and
that stage's cap was three. It lands now, because A4 is the first stage
with something to look at — and without it the only way to reach the
feature is `renderer.setLighting()` from a console, which is not a thing
that can be done on the phone this is built for.

Two rows under Visual, following the `Minimap mat` pattern exactly:
**Lighting** (legacy / debug / unified) and **Light tier** (low / medium
/ high), surfaced through `EngineStats.lightingModeName` /
`.lightingTierName`.

Verified end to end through the real UI: the row renders (nested five
collapsibles deep in the pause menu), the cycle runs
legacy → debug → unified → legacy, the tier steps low → medium, and the
console stays clean.

---

## A4s — Shard occluders (user request)

> *"This works well for tiles but can we also apply this shadow effect to
> the shards? There can be large amounts of these on screen at one time."*

### What the data said before anything was written

Three things had to be sized first, and one of them inverted the
assumption behind the request.

**Shards are BIG, not small.** Measured radii: **43.6 median / 72.2 p90**
on the asteroid showcase, **47.1 median** on Universe — against a tile's
22. A median shard at 150 units subtends a **33.8°** shadow. So the
feared "hundreds of tiny slivers = visual noise" is not the shape of this
problem; shards cast *larger* shadows than tiles do.

**Density inside a light radius is modest.** Only **25 shards within
r=300** on the asteroid showcase (1202 shards over a 6000² map), and
**1** on Universe. The volume concern is real for the *query*, not for
the wedge count — the occluder cap already bounds the drawing.

**The budget was the actual risk.** The pool is 24, selected
nearest-first, and debris lands nearer than the terrain behind it almost
by definition.

### What shipped

- **`PhysicsSystem.forEachDynamicInRadius`** — the same walk B2 built,
  pointed at the other grid. The two grids are keyed on the same dense
  cell index and expose the same `get(idx)`, so this is one added
  parameter rather than a sixth near-duplicate. The dynamic grid is
  rebuilt every collision substep and the render pass runs after the sim
  drains, so at draw time it holds exactly the state being drawn.
- **`visitShard`** beside `visit`, sharing a `record()` so the wrap
  resolution and refill idiom exist once. `passThrough` still excludes
  nebula on both sides — a nebula shard is the same soft cloud as a
  nebula tile.
- **`MIN_SHARD_OCCLUDER_R = 6`** — a size floor, since debris arrives in
  bursts and a 6-unit body subtends 4.6° at 150 units, a couple of pixels
  on a third-resolution layer. Given the measured median of 43.6 this
  excludes genuine dust and nothing else.
- **A `Shard shadows` DBG row**, On by default, its own switch rather
  than part of `LIGHTING_CYCLE` because "should debris occlude" is
  independent of "is unified better than legacy" and wants its own A/B.

### The failure this found, and the fix

Plain nearest-first was implemented first and measured. On the glass
showcase under a shatter cadence:

> **100 % of the 24 occluder slots went to debris**, at both p50 and max.
> The intact tiles around the player stopped casting entirely — at exactly
> the moment the player is looking at an explosion.

So shards get a **share**, not the run of the pool (`selectOccluders`):
at most `maxShardOccluders` (8 of 24 at Low) *while there is terrain to
fill the rest*, and the whole pool when there is not — the asteroid
showcase has no static tiles at all, and reserving slots for tiles that
do not exist would just throw shadows away. Within each kind the choice
is still nearest-first, so truncation still degrades gracefully. The
compaction is in place; nothing is allocated.

After the fix, glass showcase with terrain standing: **exactly 33 %**
(8/24), the cap binding precisely.

### Cost

`lightingMs` p95, player held beside the densest cluster, shards off vs on:

| map | churn | tiles only | + shards | delta |
|---|---|---|---|---|
| ASTEROID_FIELD | no | 0.175 | 0.430 | +0.255 |
| ASTEROID_FIELD | yes | 0.180 | 0.430 | +0.250 |
| UNIVERSE | no | 0.285 | 0.210 | −0.075 (noise; 0–1 shards in range) |
| UNIVERSE | yes | 0.205 | 0.250 | +0.045 |
| GLASS_FIELD | no | 0.345 | 0.450 | +0.105 |
| GLASS_FIELD | yes | 0.205 | 0.605 | **+0.400** |

**Worst total 0.605 ms p95**, against A4's cumulative 1.20 ms allowance.
The expensive case is a sustained shatter storm, where the second
spatial query runs against a field of fresh debris — which is also the
case the `Shard shadows` toggle exists to let you price.

### Gate

| requirement | result |
|---|---|
| Total lighting cost within the A4 allowance | PASS — 0.605 ms p95 worst case vs 1.20 ms |
| Debris cannot blank out terrain shadows | PASS — asserted per frame: on any frame with ≥16 tiles in range, the mobile share never exceeds 8/24 |
| Nebula shards cast nothing | PASS — `passThrough` filter is shared by both sides |
| Off by toggle, no cost when off | PASS — the dynamic query is skipped entirely |
| 118 tests pass | PASS (suite 117 → 118) |

The test is written around the real invariant rather than a flat
threshold, because a first version asserting "share < 60 %" failed at
100 % — correctly. A sustained shatter eventually leaves *no* terrain in
range, and shards taking the whole pool then is right. The invariant is
conditional: the cap binds while there is terrain to reserve for.

---

## A5 — Soft shadow penumbra (brought forward by user request)

> *"The lighting lines on tiles are harsh — can we soften these and perhaps
> add some curvature to the line?"*

A5 was specced to be a no-op on the phone (`penumbraK: 0` at Low) and to
be gated on Medium/High only. The request is for it ON the phone, so it
is brought forward and Low gets a real softness.

### TWO different defects made the edge read as a drawn line

They needed different fixes, and only one of them was the penumbra.

**(a) The terminator was a straight CHORD.** The wedge closed from one
tangent point straight back to the other. That chord cuts across the
occluder and leaves its far bulge OUTSIDE the shadow path — so the body's
own dark side stayed lit, with a hard straight cut across the tile face
exactly where the shadow began. That straight cut across a hex is, I
believe, most of what "harsh line on tiles" was describing, and no amount
of softening would have removed it. Closing around the circle's FAR ARC
instead puts the terminator where it belongs and curves it around the
body — which is also the "curvature" half of the request.

**(b) The edges were perfectly hard**, because a point light has no
penumbra at all. Fixed by widening the wedge by a CONSTANT ANGLE per
pass, which fakes an area light of that angular size. Constant angular
widening is what makes the soft band grow with distance from the caster —
tight against the tile, spreading further out — which is the physical
behaviour rather than a uniform blur. Three graded passes, with erase
fractions chosen so the surviving light steps linearly across the band
(`f_i = 1 − R_{i+1}/R_i`; for N=3 that is ⅓, ½, 1).

### Cost, and the cut that paid for it

Softening every occluder triples the wedge work:

| | hard p95 | soft p95 | delta |
|---|---|---|---|
| METAL_FIELD | 0.425 | 0.990 | +0.565 |
| ASTEROID_FIELD | 0.565 | 1.215 | +0.650 |
| GLASS_FIELD (churn) | 0.720 | 1.340 | +0.620 |

**+0.46 to +0.66 ms** — most of the entire lighting budget spent on an
edge treatment, against A5's 0.10 ms slice. So the ladder's own documented
fail action was taken: **penumbra on the nearest 8 occluders only, the
rest hard**. The near casters are the ones whose shadow edges are large
on screen and actually being looked at; a distant one's penumbra is a
couple of pixels wide and indistinguishable from a hard edge. Every
occluder still ends fully dark in its umbra — the far ones just reach it
in one pass instead of three.

| | hard p95 | soft p95 | delta |
|---|---|---|---|
| METAL_FIELD | 0.435 | 0.670 | +0.235 |
| METAL_FIELD (churn) | 0.660 | 0.855 | +0.195 |
| ASTEROID_FIELD | 0.500 | 0.890 | +0.390 |
| GLASS_FIELD | 0.545 | 0.795 | +0.250 |
| GLASS_FIELD (churn) | 0.760 | 0.950 | +0.190 |

**Roughly halved: +0.19 to +0.39 ms, worst total 0.96 ms p95** against
the 2.0 ms overall budget.

### The knob

`Shadow soft` under Visual — **soft** (default) / **softer** / **off** /
**subtle**. Cycling rather than a fixed constant because this is a look
call that wants making on the device against real terrain, and `off`
restores the hard-edged original exactly, which is also A5's control
case.

### Gate

| requirement | result |
|---|---|
| Softness present at Low | PASS — brought forward deliberately; Low was specced at k=0 |
| Hard output at `off` byte-identical to pre-A5 | PASS by construction — `steps` collapses to 1 and the erase fraction to 1, i.e. the original single pass |
| Cost | PASS — +0.19 to +0.39 ms; worst total 0.96 ms of 2.0 ms |
| 118 tests pass | PASS |

---

## CI red on A5, and the class of bug behind it

The merge gate failed on `0febf43` with one test:
`lighting.spec.ts` › *collects solid tiles and NEVER passThrough nebula*,
asserting `mobile === 0` and receiving `2`.

**Not a flake — a stale assertion, and my own.** That line was written at
A3, when only static tiles cast. A4s made shards cast *deliberately*, and
the assertion still said they must not. It is the exact defect the test
was supposed to guard against, inverted.

**It passed locally and failed in CI, and the reason matters more than
the fix.** The maps are unseeded. The test parked the player in whatever
the densest cluster happened to be and asserted on whatever was in range;
my local runs drew clusters with no shard nearby, CI drew one with two.
A test that depends on generated world state is a coin flip, and it will
land on the side that says "green" often enough to ship.

Two fixes, in that order:

1. **The assertion now states the real invariant** — not "no mobile
   occluders" but "mobile occluders *exactly when asked for*". It
   classifies the set with `Shard shadows` both off and on, and checks
   what actually holds either way: nebula never casts on either side of
   the mass axis, nothing inactive is collected, the shard size floor is
   respected, and each record's own `mobile` flag agrees with the entity
   it came from.

2. **`--repeat-each` was then run, and found a SECOND one.** The
   debris-share test failed 1 run in 4 on `tilesInRange >= 16` — the same
   dependence on where the cluster happened to be. It now **builds its
   scene**: everything deactivated, 20 tiles on a ring at 190 and 20
   shards at 90, so the shards are strictly nearer and plain nearest-first
   would hand them the whole pool. Deterministic, and a sharper test of
   the cap than the found scene ever was.

56/56 across `--repeat-each 8` afterwards.

**The lesson for the rest of this ladder:** these suites drive a
procedurally generated, unseeded world. Any lighting test that *finds* its
subject rather than *placing* it is sampling, not asserting. The shadow
test and the share-cap test both build their scenes now; the churn and
seam tests still use found scenes, but assert properties that hold for
any population (nothing stale in the set, nothing beyond `radius × 3`),
which is the distinction that makes that safe.

---

## A5b — the occluder radius was the bounding box, not the body

> *"The shards cast shadows well but they each have a small circle of light
> around them where the shadow starts from. This circle matches the largest
> dimension of the polygonal shards."*

Exactly right, and the discrepancy is larger than it looks. The occluder
radius was `max(size) * 0.5` — half the BOUNDING BOX. For an irregular
polygon that is nowhere near the body:

| map | kind | n | bounding half-extent (p50) | polygon inradius (p50) | ratio p50 | ratio min |
|---|---|---|---|---|---|---|
| ASTEROID_FIELD | shard | 1204 | 44.2 | 21.6 | **0.50** | 0.32 |
| UNIVERSE | shard | 145 | 45.9 | 22.3 | **0.50** | 0.35 |
| GLASS_FIELD | tile | 1170 | 20.9 | 19.1 | 0.91 | 0.91 |
| UNIVERSE | tile | 791 | 20.9 | 19.1 | 0.91 | 0.91 |

**Shards were casting from a circle twice their real size.** The shadow
therefore sprang from a boundary well outside the visible body, leaving a
lit ring around every shard before its own shadow began — which is
precisely what was reported. Tiles hid it because a hex fills its cell, so
its bounding box is close to its true extent (0.91).

Now the **INRADIUS**: the largest circle centred on the centroid that fits
inside `polygonPoints`, computed as the distance to the nearest EDGE (the
nearest *vertex* overshoots on anything not regular, which is exactly this
case). The error now runs the other way — corners poke very slightly out
of their own shadow — and that is the better error, bounded by the gap
between the two radii and reading as the shadow hugging the body rather
than floating off it.

Cached on `GameEntity._occluderR` and invalidated wherever
`polygonPoints` is mutated, beside `_satCacheAxes`. That matters because
rock tiles deform theirs on every hit, and the walk is O(edges) on a path
that runs for every candidate in range, not only the ones that survive the
cap.

The shard size floor now measures the same radius the shadow uses, so it
stays honest — at a median inradius of 21.6 a floor of 6 still excludes
only genuine dust.

Tiles shift by 9 %, so the tile look this ladder was gated on is
essentially unchanged.

---

## A5c — cast from the BODY, and ship on unified

Three things, from one round of device testing:

> *"Let's default to the unified lighting system for one. Then the shadows
> look great on polygonal asteroids but I still see a circle lighting effect
> show up on these. Additionally, the shadow effects are not working on the
> small shards."*

### The default

`activeLightingIndex` now starts at `unified`. Nothing else about the
toggle changes — `legacy` still allocates no canvas, draws nothing, and
leaves `lightingMs` at exactly 0, and the first test in the suite is
rewritten to assert both halves separately: that the shipped default IS
`unified`, and that switching to `legacy` still costs nothing.

### The circle, and the small shards, are the SAME defect

They read as two bugs and are one. A5 approximated every occluder as a
**circle**, and the bodies are visibly polygonal, so whichever radius that
circle takes, its outline is printed across the scene as the terminator:

| circle radius | what you see |
|---|---|
| bounding half-extent (A4s) | a lit ring around the body before its shadow starts — reported |
| inradius (A5b) | a bright crescent of body standing OUTSIDE its own shadow, bounded by a circular arc — reported |

Both reports are the same mismatch seen from either side. And because
the inradius runs about **half** the bounding extent on real shards (0.50
median, 0.32 worst — the A5b table), casting from it also halved every
small shard's shadow width, which at a light layer rendered at a third of
screen resolution is the difference between a visible shadow and none.
That is the third complaint, and it needed no separate fix.

Measured on the hub, mobile shards inside the light radius had inradii of
5.3 / 6.6 / 7.1 / 7.9 / 9.9 / 12.9 … against a `MIN_SHARD_OCCLUDER_R` of
6 — so the floor was cutting real bodies too, because A5b moved the
radius the floor measures without moving the number. The floor now reads
the **bounding half-extent**, which is what its own comment always
reasoned about ("a 6-unit body"), and is the cheaper test besides: `size`
is already there, where the inradius costs a walk over the edges of a body
that may be about to be rejected.

### What shipped — one quad per back-facing edge

The textbook 2D shadow volume, replacing the tangents-and-far-arc wedge:

- Each occluder now carries a **live reference** to its `polygonPoints`
  plus its `rotation`, and the bounding half-extent alongside the inradius.
  A reference, not a copy, because rock tiles rewrite their polygon on
  every hit and a copy would be one more thing to invalidate.
- An edge is **back-facing** when the light and the body's own centre lie
  on the SAME side of the edge's line. That test needs no knowledge of the
  vertex order, which matters: the shard family's polygons come from
  several generators and their winding is not guaranteed.
- Each back-facing edge is extruded to a quad. Their union IS the umbra;
  adjacent quads share their extruded vertices **to the bit** (extrusion is
  computed once per vertex, never once per edge) so no sliver opens down
  the middle of a shadow. The near half of the body is left uncovered, so a
  body still lights up on the side facing the light — which a whole-body
  erase would have thrown away, since mobile shards have no legacy glow of
  their own to fall back on.
- **Winding is canonical per quad.** Under nonzero winding two overlapping
  subpaths of opposite orientation cancel, which would punch a bright hole
  wherever two shadows crossed. Ordering each edge's pair so `b` is
  counter-clockwise of `a` about the light fixes the sign by construction —
  no signed-area pass, and correct even between two occluders whose
  polygons wind opposite ways. The circle fallback's wedge was re-ordered
  to match, because the two can overlap.
- The **penumbra widens by dilating the body**, not by rotating the
  extrusion rays. Rotating rays is right for a circle and wrong for a
  polygon: adjacent quads would push their shared vertex in two different
  directions and leave a bright sliver between them. A penumbra is the
  shadow of a slightly larger caster, so dilation is both the correct model
  and free — one multiply on the transform scale. Clamped at 2x, and
  clamped again so a dilated body can never swallow the light.
- The circle path survives as the fallback for a body with no polygon.

### Cost

Same harness as A5 (`softcost.mjs`), same maps, ship parked in the densest
cluster. `soft p95` is the total `lightingMs` per frame with the graded
penumbra on — the number to compare.

| | A5 soft p95 | A5c soft p95 | delta |
|---|---|---|---|
| METAL_FIELD | 0.670 | 0.870 | +0.200 |
| METAL_FIELD (churn) | 0.855 | 1.020 | +0.165 |
| ASTEROID_FIELD | 0.890 | 1.230 | +0.340 |
| GLASS_FIELD | 0.795 | 0.925 | +0.130 |
| GLASS_FIELD (churn) | 0.950 | 1.055 | +0.105 |

and on the maps the game is actually played on:

| | hard p95 | soft p95 | occluders |
|---|---|---|---|
| UNIVERSE | 0.360 | 0.270 | 0 |
| OVERWORLD | 0.260 | 0.340 | 5 |
| OVERWORLD (churn) | 0.710 | 1.145 | 24 |

So: **~0.3 ms in normal play, 1.2 ms p95 in the worst synthetic scene**
against a 2.0 ms budget. The first cut of this was 1.61 ms on
ASTEROID_FIELD; two changes took it to 1.23 without touching the output —
extruding once per vertex instead of twice per edge, and fusing the
classify and emit passes whenever the light provably cannot be inside the
body (`d > bounding radius`, i.e. essentially always). The safe two-pass
form is kept for the case where it can, because "every edge faces away" is
how the light-inside case is recognised and a fused loop would have
emitted half the quads before finding out.

### Gate

- `npm run typecheck`, `npm run build`, `npm test` — 119 passed
  (118 + one new).
- **New test**: *casts from the BODY*. Two shards BUILT rather than found —
  a sliver whose bounding half-extent clears the size floor but whose
  inradius does not, and a fat hexagon as the control — asserting the
  sliver is collected, and that every occluder carries a polygon with
  `br >= r`. That is exactly the A5b regression, pinned.
- The new test flaked once in a full run and passed alone: both shards are
  MOBILE, so the flow field walked them off their marks over the settle
  window. They are re-pinned every frame now. Same lesson as the CI-red
  entry above — a lighting test that lets its subject move is sampling.
- Look confirmed by screenshot on OVERWORLD and ASTEROID_FIELD: the
  terminator now follows each body's own outline, there is no arc printed
  on any face, and small shards cast shadows the width of the shard.

---

## A5d — the penumbra was fattening the body; and glass transmits

Two from device testing:

> *"For some of the smallest shards, the light still appears to be blocked by
> a larger shape than the actual polygon of the shard."*
>
> *"Is it possible to add a reduced light that passes through the glass
> tiles / shards / asteroids to simulate light passing through these objects
> since they technically represent something transparent?"*

### 1. A penumbra is a CONE, not an offset

A5c widened the soft passes by DILATING the whole body — "a penumbra is the
shadow of a slightly larger caster". That is a true sentence and the wrong
construction, and the way it is wrong is exactly what was reported: a real
penumbra is **zero wide at the caster's own surface** and opens out with
distance from it, where a uniform dilation is equally wide everywhere —
including right at the body, where it reads as the shadow being thrown by
something bigger than the thing you can see.

It is worst on the smallest bodies, because the widening is an ANGLE and a
small body's own angle is small. `k = 1 + widen·d/rad`, so k goes up as the
body goes down. Measured on a live frame at the shipped defaults:

| body radius | inradius | distance | dilation k | raw (pre-clamp) |
|---|---|---|---|---|
| 15.6 | 7.7 | 302 | **2.00** | 3.72 |
| 20.9 | 19.1 | 291 | **2.00** | 2.07 |
| 28.9 | 11.4 | 197 | **2.00** | 2.21 |
| 41.0 | 21.9 | 104 | 1.33 | 1.33 |
| 74.5 | 42.4 | 48 | 1.00 | 1.08 |

Anything small or far pinned the `DILATE_MAX` clamp — a 15-unit shard was
casting its widest pass from a silhouette **twice its size**, and that pass
erases a third of the light.

**The fix is one line of placement, not a new model.** The dilation now
applies to the EXTRUDED FAR POINTS only: the near boundary of each quad
stays on the true outline, and the far point's BEARING is taken from the
dilated vertex. The extra bearing works out to `(k-1)·r/d`, which is the
intended widening angle by construction — so the band opens from zero at the
body to `widen·D` at distance D, which is the cone. Every vertex still has
exactly ONE far point, so the quads still share their edges and no sliver
opens down the umbra.

### 2. Glass transmits

New optional variant field, `SHARD_VARIANTS[v].transmit` (0..1), set to
**0.55** on `glass-tile` and `glass-shard` and absent everywhere else.
Deliberately distinct from `passThrough`, which is about COLLISION and is
binary: a nebula tile lets a striker pass and casts no shadow at all, where
glass stops a striker dead and casts a faint one.

Shadows are withheld with `destination-out`, whose strength is the fill's
ALPHA — one number for the whole fill — so bodies that transmit different
fractions cannot share a compound path. Each distinct value gets its own
path and its own fill at `erase × (1 - transmit)`. With every variant opaque
the group count is 1 and the output is byte-identical to before. A fifth
distinct value would be SNAPPED onto the nearest existing group rather than
dropped, because a body that fell out of every group would cast no shadow at
all — a much worse failure than a slightly wrong translucency.

Not done, and worth knowing it was considered: the transmitted light is not
TINTED by the glass. That needs an additive pass in the variant's colour
behind the body, which is a second light-layer draw per translucent occluder
rather than a change to the erase alpha.

### Cost

`PENUMBRA_NEAREST` cut from 8 to 5. The polygon silhouette costs one quad
per back-facing edge where the circle cost one wedge full stop, so a graded
pass buys roughly three times the path work it did at A5, and eight of them
is no longer affordable. Before the cut, ASTEROID_FIELD measured 1.92–1.97
ms p95.

Same harness, ship parked in the densest cluster. **Occluder count is the
dominant term and the harness picks a random cluster per run**, so rows are
only comparable at equal counts — that is why the count is in the table:

| map | churn | hard p95 | soft p95 | occluders |
|---|---|---|---|---|
| ASTEROID_FIELD | no | 1.055 | 1.175 | 15 |
| ASTEROID_FIELD | yes | 1.115 | **1.725** | 24 |
| GLASS_FIELD | no | 0.760 | 1.070 | 24 |
| GLASS_FIELD | yes | 0.995 | 1.400 | 24 |
| METAL_FIELD | yes | 0.865 | 1.140 | 24 |
| UNIVERSE | no | 0.585 | 1.115 | 24 |
| OVERWORLD | no | 0.490 | 0.565 | 2 |

The A5c baseline re-measured on the same container read 1.645 at 24
occluders on ASTEROID_FIELD, so this is **parity with A5c once the occluder
count is matched** — and the 1.230 quoted in the A5c entry was a
low-occluder sample that flattered it. The honest figure for both is
**~1.7 ms p95 at the 24-occluder cap in the worst synthetic scene**, and
0.35–0.6 ms in normal play.

That is close enough to the 2.0 ms budget to say plainly: **the budget has
still never been re-derived, and it now matters.** The next lever if a
device capture says it is too tight is the tier's `maxOccluders` (24 at
Low), which scales the umbra pass directly.

### Gate

- `npm run typecheck`, `npm run build`, `npm test` — 119 passed.
- The shadow test is rewritten to cover all three cases on one hand-built
  scene, stamping the variant onto the placed tile rather than searching for
  one (the showcase maps are single-variant). Opaque erases nearly
  everything, glass lands strictly between the two failure modes — as dark
  as rock means the transmission never reached the fill, as bright as open
  space means glass stopped casting — and passThrough still collects zero
  occluders.
- That test previously placed a GLASS tile and asserted a full umbra, so it
  would have failed on this change. Worth noting as a small win for the
  suite: the assertion that had to move was the one that was accidentally
  wrong about which material it was measuring.

---

## A5e — two tiers below Low, and a refraction prototype

> *"Let's test it behind the debug toggle. Include the low light setting too
> and add two more levels that are lower than the current low light.
> Additionally, refracted light shall have a half or less the brightness of
> the source light."*

### Two tiers below Low

`LIGHTING_TIERS` is now five rows. Every knob that drives cost moves
together on the way down — a coarser light canvas, fewer occluders, a
shorter radius — because the point is a real step, not a nudge:

| tier | divisor | maxOccluders | maxShard | maxRadius |
|---|---|---|---|---|
| **lowest** | 5 | 8 | 3 | 220 |
| **lower** | 4 | 14 | 5 | 260 |
| low | 3 | 24 | 8 | 300 |
| medium | 2 | 48 | 16 | 400 |
| high | 2 | 96 | 32 | 500 |

Measured on the glass showcase, ship parked in the densest cluster:

| tier | p50 | p95 | occluders |
|---|---|---|---|
| lowest | 0.370 | **0.460** | 8 |
| lower | 0.465 | 0.595 | 14 |
| low | 0.615 | 0.975 | 20 |

So `lowest` runs at roughly **half** the cost of `low`. It is meant to be
the setting that keeps the light at all on a device that cannot afford
`low`, not one anyone would pick for looks.

**Low remains the shipped default**, and the default index is now derived
from the name (`findIndex(t => t.name === 'low')`) rather than written as a
literal — inserting rows above it would otherwise have silently changed what
ships. `tests/lighting.spec.ts` asserts both the default and that each step
down really is coarser and really does cast from fewer bodies, read off the
live light canvas and occluder count rather than off a copy of the table.

### Refraction, behind DBG ▸ Refraction (off by default)

The shipped translucency sends light STRAIGHT THROUGH glass at reduced
brightness. That is the right first-order model for a parallel-faced pane —
a slab offsets a ray sideways but does not deviate it, and a regular hexagon
has three pairs of parallel faces — but a wedge-shaped shard is a prism, and
a prism bends light.

ON, each exit face refracts by Snell's law and throws an additive cone along
the deviated direction. Three things make it a real A/B rather than a
decoration:

- **The energy is MOVED, not added.** With refraction on, translucent bodies
  erase in full — the straight-through path is withheld — and the caustic
  carries the transmitted light. Stacking the cone on top of the existing
  transmission would just read as "glass got brighter", and the umbra it is
  supposed to be visible against would already be lit.
- **Brightness is structural.** The caustic is filled with the light's OWN
  falloff gradient scaled by at most `REFRACT.MAX_BRIGHTNESS_FRAC = 0.5`, so
  "no brighter than half the source" is a property of the construction
  rather than a number to keep in step, and the deviated light fades with
  distance exactly as the direct light does.
- **Total internal reflection is a branch, not a guard.** Past the critical
  angle (41.8° at IOR 1.5) nothing is transmitted and the discriminant goes
  negative. An unguarded `sqrt` would put NaN into the compound path, and
  ONE NaN discards the whole path — which is precisely how A4 shipped with
  no shadows at all. `refractTo` returns false instead.

**The approximation, stated plainly:** only the EXIT face is refracted. A
ray really bends twice, and for a body with parallel faces the two bends
cancel exactly. Finding the entry face needs a ray-polygon intersection per
vertex. So this over-states the deviation for a hex tile and is about right
for a wedge-shaped shard — the useful direction to be wrong in for a
prototype whose question is "can you see it at all".

### The answer to that question, measured

Same frame, refraction off then on, differenced pixel by pixel:

| tier | pixels changed by >4 luminance | p99.9 change |
|---|---|---|
| low (divisor 3) | 2.2 % | 78 |
| high (divisor 2) | 9.2 % | 134 |

**At `high` it clearly reads** — full-strength umbra with brighter wedges
between, banding visibly through a glass cluster. **At `low` it is
marginal**: the deviation is there and measurable, but at a third of screen
resolution most of it lands within a couple of pixels of where the straight
line would have gone. That is the honest finding, and it is why this stays a
toggle rather than becoming a tier flag: the look call belongs on the device.

Cost, glass showcase (where EVERY occluder is translucent, so this is the
worst case for it — a map with little glass pays almost nothing):

| tier | off p95 | on p95 | delta |
|---|---|---|---|
| lowest | 0.460 | 0.585 | +0.125 |
| lower | 0.595 | 0.865 | +0.270 |
| low | 0.975 | 1.280 | +0.305 |

### The brightness is a knob, not a number

DBG ▸ **Refr bright** cycles the caustic's brightness: `1/2` (default) →
`1/3` → `1/4` → `1/6` → `1/10`, as fractions of the light's own peak.

Named as fractions because that is the quantity the rule is stated in, and
it starts at the CEILING so tuning only ever goes down from the brightest
the rule allows. The ceiling lives in TWO places on purpose:
`REFRACT_BRIGHTNESS_CYCLE` is where the look is chosen, and
`REFRACT.MAX_BRIGHTNESS_FRAC` clamps on top of whatever it returns — so
adding a row above 1/2 makes that row dead rather than makes the rule wrong.
The test pins the TABLE itself (every entry is `1/N` with N >= 2), because
that is where the intent is visible and the call site is where it is not.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **121 passed** (119 + two
new). The refraction test asserts the light still works AT ALL with the
toggle on (the NaN case above), that the on-axis gain DROPS when the
straight-through path is withheld, that the brightness table respects the
half-the-source rule, and that the toggle returns to off.

---

## A5f — dimmer, softer, brighter caustics; and metal/glass now light UP

Five, from one round of device testing.

### 1. The tier cycle was never a brightness control

> *"I'm at the lowest setting now and it still feels very bright."*

Exactly right, and exactly what that cycle does. **Light tier** is a COST
ladder — canvas divisor, occluder cap, radius — so `lowest` changes how much
work the light does and nothing about how bright it looks. There was no
brightness control at all; `PLAYER_LIGHT.PEAK` was a hardcoded 0.34.

New **Light bright** cycle: 100% (default, today's look) → 70 → 50 → 35 → 25
→ 15 → **8%**. The ladder runs a long way down because the complaint was not
that the light was slightly hot.

One thing about it is load-bearing rather than obvious: the gradient bakes
its alphas into COLOUR STOPS, and the gradient cache is keyed on radius. A
cache keyed on radius alone would keep serving the old brightness after the
cycle moved — a stale-cache bug whose symptom is "the setting does nothing",
which is the hardest kind to see. The cache now clears when the brightness
changes: one compare per light per frame, and the clear happens on a
keypress, never in steady state.

### 2. Softer than 'softer', and the passes to make it read

Three rungs past `softer`: **softest** (k=7), **diffuse** (10), **hazy**
(14).

They are usable rather than decorative because `SOFT_STEPS` is now a
FUNCTION of k. Three graded passes is the point where banding stops reading
as banding at k=2.5 — but a band five times as wide graded over the same
three steps reads as three stripes, not as a soft edge. `softSteps(k)` buys
gradations only where they are needed, and `softSteps(2.5) === 3` exactly,
so the shipped default is bit-for-bit what it was.

### 3. The refraction ceiling becomes a default

The caustic measured as only marginally legible at Low (2.2 % of pixels),
and a prototype you cannot see is one you cannot judge. **Refr bright** now
runs `1/2` (still the default) → 2/3 → 3/4 → **1/1** → 1/3 → 1/4 → 1/6 →
1/10 → 1/16, cycling UP first because that is the direction the question was
asked in.

"No brighter than half the source" was the right physical instinct, and it
survives as the DEFAULT rather than as the ceiling. What remains a ceiling
is 1/1: refracted light is a redistribution of light that already passed
through the body, so out-shining the source outright stays meaningless. The
test moved with it — it pinned `1/N` with N ≥ 2, and now pins that every
entry is a proper fraction.

### 4. The metal and glass contact glow is gone

Both were driven by `repelImpulse` — a per-substep CONTACT accumulator. So a
pane lit up when something touched it, and a pane across the room stayed
dead however brightly it was lit. That is the wrong way round, and the
unified light answers the question it was standing in for.

Deleted: the glass-tile layer-2b glow, the metal-tile glow block, and
`repelGlowIntensity`. **Two `inGlowRange` gates went with them**, and that is
a quiet perf win: glass tiles used to DROP OUT of the static tile cache
whenever something touched them, and now stay cached.

Three DBG cycles tuned only those glows and had zero call sites left — glass
glow colour, metal glow colour, metal glow brightness. They are removed
rather than left as controls that do nothing. `GLASS_GLOW_COLORS` itself
stays: the nebula palette indexes the same table through its own index.

### 5. Lit metal and glass RE-EMIT — DBG ▸ Emissive, off by default

New optional variant field `SHARD_VARIANTS[v].emits` (0..1), **0.5** on
`metal-tile` / `metal-shard` / `glass-tile` / `glass-shard`. ON, every lit
body of those materials becomes a SECOND light at its own position: half the
light it received, uniform in every direction, falling off exactly as the
player's does.

Three things worth knowing:

- **How much light a body receives is EVALUATED, never sampled.** The
  falloff is a known piecewise ramp, so `falloffFrac` answers in three
  operations. Reading it back off the canvas would be a CPU readback of the
  light layer, which this system does not do at any price.
- **The emitter IS the player light, smaller and dimmer** — same cached
  gradient, scaled by received × `emits`. So it tracks the brightness cycle
  for free and can never out-shine what lit it.
- **Secondary lights cast no shadows, deliberately.** Each would need its
  own occluder collection, and the pool is shared and consumed per light, so
  N emitters would cost N collections on the tightest budget in the system.
  They are dim and small; the price is a halo bleeding a little through a
  wall, which is a far better trade than the frame time. The emitter count
  is bounded by `tier.maxLights - 1` — the tier's budget is shared with the
  player's own light rather than added to.

Cost, ship parked in the densest cluster at Low:

| map | emissive off p95 | on p95 | delta |
|---|---|---|---|
| METAL_FIELD | 0.885 | 1.215 | **+0.330** |
| GLASS_FIELD | 1.515 | 1.435 | −0.080 (noise) |

So ~+0.3 ms worst case for three emitters, bounded by the tier.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **123 passed** (121 + two
new). The brightness test pins BOTH halves of the distinction that prompted
it: the brightness cycle must dim, and the tier cycle must not. The emissive
test pins that the light count goes up AND that something beside the tile
actually brightens — a count that rose while nothing brightened would mean
the emitter was composited where nobody can see it.

---

## A5g — seven tiers, an emission knob, and optional emitter shadows

### 1. Two more rungs, one at each end

`LIGHTING_TIERS` is now seven, and the ends are the interesting ones:

| tier | divisor | maxLights | maxOccluders | maxRadius |
|---|---|---|---|---|
| **minimal** | 7 | 1 | 4 | 180 |
| lowest | 5 | 2 | 8 | 220 |
| lower | 4 | 3 | 14 | 260 |
| low *(default)* | 3 | 4 | 24 | 300 |
| medium | 2 | 8 | 48 | 400 |
| high | 2 | 16 | 96 | 500 |
| **ultra** | 1 | 32 | 160 | 650 |

`minimal` renders the light layer at a SEVENTH of screen resolution with one
light and four occluders — the setting for a device that cannot afford
`lowest`, where the question is whether to have a light at all. `ultra` runs
it at FULL screen resolution with 32 lights: not a play setting, but the one
that answers "what would this look like without the budget". The emissive
prototype in particular is bounded by `maxLights`, so it had nowhere to show
itself above three emitters before this.

### 2. Emit bright — the emission knob

`EMIT_BRIGHTNESS_CYCLE`, the emissive sibling of `Refr bright`: `1/2`
(default) → 2/3 → 3/4 → 1/1 → 1/3 → 1/4 → 1/6 → 1/10.

It SCALES the variant's own `emits` against `EMIT_BASELINE` (the 1/2 those
variants are authored at) rather than replacing it, so the default is exactly
what the table says and a future material that emits less than metal still
emits less than metal. Clamped at 1 in the geometry: **a body cannot radiate
more light than fell on it**, which is the one physical claim the whole
feature rests on.

### 3. Emit shadow — secondary lights that occlude, and what it costs

A5f declined this on cost. It is now a toggle, off by default, because the
question "what would it look like" deserves an answer even when the answer is
"more than we can afford".

Two things had to be built rather than switched on:

- **Its own compositing surface.** An emitter's shadows cannot be drawn onto
  the accumulated light layer: `destination-out` there erases the light
  already present, not just the emitter's share. So each shadowing emitter
  composites into a scratch canvas and blits its own box back with `lighter`.
  Clearing and blitting only the emitter's box keeps the cost proportional to
  the halo rather than to the screen.
- **A snapshot before the second collection.** Emitters are chosen by walking
  the player light's occluder set, and collecting occluders for an emitter
  OVERWRITES the shared pool that set points into. So the choosing now
  finishes into `Float64Array` storage that owns its values before any second
  collection happens. Reading `o.x` in the drawing loop would silently read
  whatever the last collection left there — emitters drifting onto other
  bodies' positions, and only when shadows are on. This is precisely the
  hazard the pool comment has warned about since A3, arriving on schedule.

Measured on the metal showcase, Emissive on, before any cap:

| tier | shadows off p95 | shadows on p95 | emitters |
|---|---|---|---|
| low | 0.865 | 2.130 | 3 |
| medium | 1.590 | **7.145** | 7 |
| high | 2.310 | **14.865** | 15 |

**14.9 ms from a debug toggle** — an entire frame budget, and it scales with
the emitter count because the cost is almost entirely the per-emitter
occluder collection. So `EMIT_SHADOW_MAX = 4` caps how many may SHADOW,
whatever the tier allows to exist; the rest fall back to the flat halo rather
than vanishing, so the light count is still what the tier promised and only
the treatment degrades. After the cap:

| tier | off p95 | on p95 |
|---|---|---|
| low | 1.260 | 2.560 |
| medium | 2.365 | 5.975 |
| high | 3.225 | **7.200** |

Still heavy, and still a debug toggle. What it buys is roughly constant now
rather than growing with the tier, which is the shape a cap is for.

**This is not a TERTIARY bounce**, despite the phrasing that prompted it.
Emitters do not light other emitters: every emitter reads its brightness from
the player light's falloff alone. A real second bounce needs the emitters
resolved in dependency order and re-lit, which is a different problem and a
much larger one.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **123 passed**. The tier
test walks all seven rungs and asserts the divisor and occluder ladders are
monotone across the whole range. The emissive test gained the brightness
table's proper-fraction rule and a check that turning emitter shadows ON does
not darken the scene — the plausible failure of the scratch-canvas path is a
`destination-out` landing on the wrong surface, whose symptom is a hole.

---

## A5h — the prototypes become the defaults, and the expensive one gets a ladder

Four changes, all of them decisions rather than discoveries: the device
testing that A5e and A5f were built to enable came back, and it liked what it
saw. Refraction and emissive re-radiation SHIP ON; shadow softness ships four
rungs softer at `diffuse`; emitter shadows stay OFF and gain a cost ladder of
their own.

### What moved

| knob | was | now |
|---|---|---|
| Refraction | off | **on** |
| Emissive | off | **on** |
| Shadow soft | `soft` (k 2.5) | **`diffuse`** (k 10) |
| Emit shadow | off | off — unchanged, and deliberately |
| Emit shd tier | — | **new row**: std / lite / min / more / max |

The softness default is found by NAME (`findIndex(s => s.name === 'diffuse')`)
rather than written as an index, the same guard the lighting tier's default
already carries: inserting a rung above it would otherwise silently change
what ships, which is the class of mistake nobody notices until a look call
mysteriously regresses.

### The emitter-shadow ladder

The row that was added is a COST ladder, not a look knob, and it moves the two
things that drive the cost together — how many emitters shadow, and how much
geometry each of those sees:

| tier | maxEmitters | maxOccluders |
|---|---|---|
| **std** (default) | 4 | 12 |
| lite | 2 | 8 |
| min | 1 | 6 |
| more | 6 | 12 |
| max | 8 | 16 |

Both numbers move because the cost of a shadowing emitter is almost entirely
its own occluder collection: a rung that cut the count while raising the cap
would not be a cheaper rung at all. Cycling from the default goes DOWN first,
because the question asked of this ladder is whether the cheap end can still
be seen — the fixed `EMIT_SHADOW_MAX = 4` and `EMIT_MAX_OCCLUDERS = 12` of
A5g are now simply the `std` row, so the default behaviour is unchanged.

Past `maxEmitters` an emitter still LIGHTS, flatly. The tier degrades the
TREATMENT and never the count, so no rung darkens any part of the scene —
which is what the suite asserts rather than trusting.

### Cost

Container-measured at 390×844, ship parked in the densest cluster, all rows
in ONE page at the SAME cluster so the occluder count (the dominant term) is
identical down each column. p95 `lightingMs`:

| config | METAL_FIELD p95 | GLASS_FIELD p95 |
|---|---|---|
| A5g defaults (soft / no refr / no emit) | 0.785 | 1.045 |
| + `diffuse` alone | 1.045 | 1.470 |
| + refraction alone | 0.815 | 1.490 |
| + emissive alone | 0.890 | 1.130 |
| **A5h defaults (all three)** | **1.150** | **1.710** |
| ...+ emit shadows, `std` | 3.345 | 3.540 |
| ...+ emit shadows, `min` | 1.760 | 1.710* |

*(both at 24 occluders except the last GLASS row, which drifted to 16 and is
not comparable — noted rather than quietly tabulated.)*

Three things worth reading off it:

- **The softness rung is the biggest single contributor**, +0.26 ms on metal
  and +0.43 on glass. That is the pass count doing exactly what A5f built it
  to do: `softSteps` scales with k and `diffuse` buys six passes where `soft`
  bought three, because a band four times wider graded over three passes
  would read as stripes.
- **Refraction is nearly free where there is no glass** (+0.03 on metal) and
  the dominant cost where everything is glass (+0.45). Only bodies with
  `transmit > 0` enter the pass, so the map decides the bill.
- **The emit-shadow ladder earns its place.** On metal, `std` costs +2.2 ms
  over the defaults and `min` costs +0.6 — roughly a quarter. That is the
  difference between "unaffordable" and "judgeable on a phone", which is
  what the row exists for.

**The worst case is now over the notional 2.0 ms budget in the worst
synthetic scene.** ASTEROID_FIELD's occluder count drifts run to run (its
occluders are mobile shards), so its rows do not compare cleanly, but at 18
occluders the `diffuse` rung alone measured 2.63 p95 there. The levers are
already built and unchanged — the `lower` / `lowest` / `minimal` tiers and
the softness cycle itself — and the missing measurement is still the same
one: a `PerfRecorder` capture on the device, where the software rasterizer
in this container is not the thing being measured.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **124 passed** (a new test
pins the four defaults and walks the emitter-shadow ladder). Two existing
tests needed real changes rather than re-baselining:

- The **transmission** test now holds refraction, emissive AND softness at
  known values for its duration. It measures how much light a translucent
  body withholds along a bearing derived from the occluder's own angular
  size (`asin(22/120)` = 10.6°) — and a penumbra four times wider puts the
  outermost samples inside the graded band, which graded the whole
  measurement down to 3.80 against a 3.83 bar. The failure was arithmetic,
  not flake: the test asserts a geometry, so it now pins the geometry.
- The **refraction** and **emissive** tests assert the new defaults and
  restore them, instead of asserting "a prototype ships off".

---

## A5i — nebula emits, and every emitter is its OWN colour

Two requests, one mechanism. Emission was white — the player light's own
blue-green — and it was available only to bodies that already cast shadows.
Nebula is neither: it is the game's one glowing material, and it is
`passThrough`, so it never enters the occluder pool at all.

### Emitters are no longer a by-product of being an occluder

A5g chose emitters by walking the shadow-caster set, which is exactly right
while every emitter is also an occluder. Nebula breaks that from both ends,
and the obvious fix is the wrong one: putting nebula into the shadow pool so
the emitter walk can see it would hand it the pool. **1496 of Universe's 2227
static tiles are nebula**, all nearer than the terrain behind them, so
nearest-first selection would spend the entire 24-slot budget on bodies that
deliberately cast nothing — the same starvation the shard share cap in
`selectOccluders` exists to prevent, arriving from the other direction.

So passThrough emitters get a buffer of their own, filled **during the same
grid walk** — no second spatial query — and the emitter pass merges the two
lists nearest-first. They cost the shadow pool nothing, the shadow pass never
sees them, and the merge keeps the rule one rule: the nearest emitters win the
budget, whichever list they came from, so a cloud you are standing inside
cannot be out-ranked by a metal plate across the room.

The buffer is kept nearest-first **by insertion** rather than collect-then-
sort, because the candidate count on a nebula map is in the hundreds and the
budget consuming it is single digits: an insertion whose first compare
usually fails is cheaper than sorting a list that is then thrown away. The
record evicted from the tail is the one reused for the insert, so a full
buffer allocates nothing.

`collectOccluders` takes the emitter array as an OPTIONAL out-parameter.
Omit it — as the nested collection for a shadowing emitter does — and the
walk behaves exactly as it did before; an emitter's own light does not go
looking for more emitters.

### Colour

Each emitter now radiates in the body's own colour, resolved in this order:

1. `nebulaBlendedHex` — a nebula blends its colour from its own composition,
   so this is the one material whose emission colour is per-BODY rather than
   per-variant.
2. the entity's render colour.
3. the variant's legacy `glow.color`, as a last resort.

**The order matters, and measuring it is what set it.** Taking `glow.color`
first was the first implementation, and it is visibly wrong: those are VFX
leftovers from the contact glow A5f deleted, and metal's is **magenta**
(`#d946ef`) — so a lit steel plate radiated magenta while its own surface
stayed steel. Reading the entity's colour instead gives glass its indigo
(`#6366f1`) and metal its steel (`#5b8499`), which is what "the tile's
colour" means.

Two properties of the tint are deliberate:

- **Normalised to full value.** A surface colour is dark by nature — steel is
  `#5b8499` — and a dark gradient reads as a smudge rather than as light.
  Scaling the channels so the largest is 255 keeps the HUE and leaves the
  brightness where it belongs, in the alpha (`received × emits`).
- **Quantised to 32-step channels**, because the gradient cache is keyed on
  colour then radius and nebula would otherwise mint a cache entry per body
  on a map that has 1496 of them. The tint is built on a colour CHANGE and
  cached on the entity (`_emitTint` / `_emitTintKey`), never per frame.

`lightGradient` gained the tint parameter and both emitter paths use it — the
flat halo and the shadowed scratch-canvas composite — so a shadowing nebula
emitter is the right colour too.

Measured on a hand-built scene, one tile due east, emission off vs on:

| map | body | tint | Δ R,G,B |
|---|---|---|---|
| NEBULA_FIELD | nebula-tile `#ff3d94` | `255, 64, 160` | +6.8, +1.5, +4.3 |
| GLASS_FIELD | glass-tile `#6366f1` | `96, 96, 255` | +2.3, +2.5, +7.2 |
| METAL_FIELD | metal-tile `#5b8499` | `160, 224, 255` | +4.3, +6.0, +7.2 |

Pink stays pink, glass leads in blue, steel is a pale blue-white. The nebula
row also reports `occluders 0` with `lights 2` — it lit the scene while
casting nothing, which is the whole point.

### Cost

Container-measured, and the counts drift on these maps (nebula maps have few
or no occluders and the ship drifts between rows), so these are indicative
rather than a ladder:

| map | A5h defaults, emission off | A5i defaults | note |
|---|---|---|---|
| NEBULA_FIELD | ~0.30 p95 | ~1.39 p95 | the light had nothing to draw before |
| UNIVERSE | ~0.34 p95 | ~1.73 p95 | two thirds of its tiles are nebula |

The nebula showcase is where this change does the most work, and it is the
map where the old layer did the least: `passThrough` meant a bare falloff
with no shadows and no emitters, which is why Universe read as "muted" in
every earlier measurement. The emitter budget is still `maxLights - 1`, so
the cost is bounded by the tier rather than by how much nebula is on screen.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **125 passed**. The new
test pins the three things that could each be silently wrong: nebula
collects as ZERO occluders (it must never eat the shadow pool), the emitter
buffer fills only when emission asked for it, and the light it adds is RED
for a body stamped red — the player's own light is blue-green, so a
mis-plumbed tint would show up as the green channel leading.

---

## A5j — emission flashed; halos now outlive their selection

Reported from the device: the emitters "turn on and off instantly". They did,
and the cause is not brightness — it is **membership**.

The emitter set is chosen nearest-first and capped by the tier (`maxLights -
1`, so three at Low). Bodies cross that budget constantly as the ship moves,
because near-equal distances reorder every frame; a body drawn at full
strength on one frame and not at all on the next reads as a strobe. Both
frames were individually correct. The SWAP is the artefact.

A second, smaller pop came from `EMIT_MIN_RECEIVED`: a hard cutoff, so a body
drifting toward the rim of the light switched off mid-glow.

### The fix: a halo that outlives its selection

The lightweight version of this is tempting and wrong — easing the alpha of
the CHOSEN emitters smooths a fade-in but does nothing for a fade-out, because
a body that leaves the budget is simply not drawn any more. There is nothing
left to ease.

So emitters got a small persistent table (`EmitSlot`), keyed on the emitting
entity's id:

- Chosen bodies ease toward their computed alpha.
- A body that drops out keeps its **last known position** and eases toward
  zero — it fades out where it stood. Deliberately the last position rather
  than the entity's live one: a fading emitter may have been destroyed, and a
  dead tile's halo fading over a quarter-second is exactly right.
- `chosen` gates the expensive treatment: only a body in THIS frame's budget
  may cast emitter shadows. A fading halo losing its shadow detail for 250 ms
  is not visible to anyone.
- The ease is WALL-CLOCK (`performance.now()`, render side only — the sim
  never sees it), so the fade takes the same time at any frame rate, with the
  step clamped so a stalled tab does not jump.

The rim cutoff became a smoothstep band over `EMIT_MIN_RECEIVED` → 3x that,
so entering the light is a fade rather than a switch.

New DBG row **Emit fade**: `smooth` (0.25 s, default) / `slow` / `languid` /
`fast` / `off`. `off` is a JUMP, not a very fast ease — a control case has to
be the thing it controls for.

### Bounding it

**A halo that is fading still costs a fill.** The budget refills every frame
while a fade lasts a quarter of a second, so an unbounded table would let a
sweep through dense terrain accumulate roughly a fade's worth of frames —
about fifteen times the budget — of gradient fills. Live halos are therefore
capped at `3x` the tier's emitter budget, and at the cap the DIMMEST fading
halo is recycled (never a chosen one — the budget is smaller than the cap by
construction, so there is always a fading slot to take).

Measured FLYING through the terrain, which is the worst case for this
(parked, the chosen set is stable and the fade costs nothing):

| map | fade off | `smooth` | live halos |
|---|---|---|---|
| METAL_FIELD | 1.205 p95 | 1.635 p95 | 3 → 9 |
| UNIVERSE | 0.510 p95 | 1.235 p95 | 1 → 1..5 |

At 2x the cap instead of 3x the same scene measured +0.42 vs +0.43 ms, so the
halo COUNT is not the term that costs — which is why the larger, smoother
bound is the one kept.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **126 passed**. The new
test runs the same experiment at two fade settings and asserts the shape
rather than a level: two frames after emission is switched on the faded
emitter is well short of its settled value, `off` is essentially all the way
there, and both settle to the SAME brightness — a fade changes when the light
arrives, never how much of it there is.

---

## A5k — glass clicked; the caustic had two cliffs in it

Reported from the device, with a hypothesis attached: a click or flash on
**glass tiles** while drifting slowly past them, guessed to be "the refraction
beam exciting a single side of the hex tile at a time". The guess was right
about the mechanism and there turned out to be a second one behind it.

### Measuring it first

The first metric was wrong in an instructive way. A box-mean of the canvas
gave a max frame-to-frame jump of **30 luminance against a median of 0.075** —
which looked like the pop, and was the run's first frame settling. Per-pixel
deltas were worse: the star field scrolls under a moving camera, so **12 % of
pixels change by >8 every frame even on `legacy`**. Anything measured off the
main canvas while the camera moves is measuring parallax.

What worked was differencing the same camera position twice (unified minus
legacy — the trick the shadow tests already use) and, better, instrumenting
the caustic directly: `causticStats()` reports the face count and the
effective THROW being drawn. A cliff is then a step change in a number
instead of a judgement about pixels.

That trace answered it immediately. Stepping the ship past a single glass
tile, per-face transmission moved **1 → 0 in a single step**, in weight
increments of exactly 0.5 — one endpoint of one face going from fully
transmitting to nothing between one frame and the next.

### Cliff 1 — total internal reflection

Past the critical angle (41.8° for IOR 1.5) a face transmits nothing, and the
code took that literally: `refractTo` returned a boolean and the face was
skipped. So a cone appeared and disappeared at full length as the body turned
relative to the light. Real transmission does not do that — the Fresnel
coefficient falls to zero AT the critical angle, so the light is already gone
by the time the cliff arrives.

`refractTo` now returns a WEIGHT, read off `k` — the discriminant the Snell
solve already computes, which is 0 exactly at the critical angle and 1 at
normal incidence. The fade costs one compare and a multiply, and is zero at
precisely the angle where the boolean flipped. Total internal reflection is
still a real branch: `k < 0` must never reach the `sqrt`, because one NaN
discards the whole compound path, which is how A4 shipped with no shadows.

**The weight rides the cone's THROW, not its alpha.** Every cone in a transmit
group shares one compound path and therefore one fill, so a per-face opacity
would cost a fill per face. A face approaching the critical angle reaches less
far instead, and since the fill is the light's own falloff gradient, a shorter
cone is a dimmer one. At weight 0 the far points coincide with the near ones
and the quad is degenerate — the same result the old `continue` produced,
arrived at continuously.

### Cliff 2 — the occluder cap

The trace also showed face counts jumping by three to five at a time, and more
faces than a hexagon has: other bodies were entering and leaving the pool. On
the real glass showcase the pool sits **saturated at 24 of 24 translucent
bodies**, so membership churns constantly as the ship moves — and an entering
body brought its ENTIRE caustic at full strength.

This is the emitter flash of A5j from the other direction, and it is why the
report was about glass and only glass: a shadow at the cap boundary is far
away and subtle, a bright cone appearing out of nowhere is not.

So a body approaching eviction fades its caustic out first. Two things about
how, both from measurement:

- **Rank, not distance.** A distance band was the first attempt and it is the
  wrong shape: a band of 25 % of the cut distance dimmed the whole caustic by
  **40 %** on the glass showcase, because in packed terrain that band holds
  most of the pool. The last few SLOTS are a handful of bodies however dense
  the terrain is.
- **Per kind.** `selectOccluders` reserves a share of the pool for mobile
  shards, so a TILE can be evicted while a NEARER shard keeps its slot. The
  ranking has to be per kind or tiles keep popping at their own boundary.

### What is proven and what is not

Stated plainly, because the two halves of this fix have very different
evidence:

- The **TIR taper** removes a cliff that was measured directly, and the trace
  after it shows the same faces ramping over several steps instead of
  flipping. That is the mechanism the report described.
- The **cap fade** is mechanically sound but its benefit could NOT be
  separated from the ordinary churn of 24 bodies moving: on a same-map A/B
  the aggregate step-to-step change did not improve, while the cost is
  measurable (a third of the caustic's throw at a quarter of the ranks). So
  it ships LIGHT — 8 % of the ranks, a couple of bodies — with stronger
  settings one click away.

New DBG row **Caustic fade**: `smooth` (default) / `soft` / `heavy` /
`light` (TIR only) / `off`. `off` restores both cliffs exactly and is the
control the fix was measured against.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **127 passed**. The new
test walks a ship past one glass tile at two fade settings and asserts the
shape: with `off` some single step moves the caustic by more than a quarter
of everything it draws, and with `smooth` the worst step is smaller — the
same geometry, arrived at continuously. It re-quiets the scene every frame,
because the map regenerates tiles and one drifting into the pool would put a
second body's caustic in the series and read as a cliff.

---

## A5l — the click was the penumbra, and the perf report could not see the light

Two reports in one message, and they wanted opposite treatment: one was a
real bug found by following the reporter's own hypothesis, the other was a
suspicion the evidence did not support.

### The click: "a shadow cone appears and disappears from one edge to an
### adjacent edge"

That is exactly what was happening, and it is not the caustic — A5k fixed a
different cliff on the same symptom. This one is in the SHADOW, and it is
the penumbra's construction.

As a light crosses an edge's plane, that edge starts or stops casting. At
that instant the edge lies along the light ray, so its quad must be
DEGENERATE — an edge-on caster casts nothing, and the transition is
continuous. Instrumenting the shadow geometry (`shadowStats()` — quads
emitted and their total area) and sweeping a light around one hex tile
showed it was not:

| shadow soft | at an edge flip | total shadow area change |
|---|---|---|
| `off` (no widening) | 4 quads → 3 | **0.8 %** |
| `diffuse` (shipped) | 24 → 18 | **5–6 % in one step** |

Hard shadows behave correctly. The widening is what breaks it, and the
reason is the CONSTRUCTION A5d chose: it scaled each vertex radially away
from the body's CENTRE and read the far bearing off the scaled point. That
delivers the right average widening, but it moves each vertex by a DIFFERENT
angle — the amount depends on where the vertex sits relative to the centre.
So for an edge about to flip, the two endpoints landed at different bearings
and the quad had real area at the exact moment it should have had none.

**A penumbra is a rotation, not a dilation.** The far point's bearing is now
rotated by the widening angle directly, with the sign taken from which side
of the body's own bearing the vertex falls (so the widening is always
outward). Both endpoints of a nearly-edge-on edge are on the same flank and
therefore take the SAME shift, so the quad stays degenerate through the flip
— while the terminator vertices, which are the shadow's lateral boundary and
where the penumbra actually reads, still get their full ± widening. After it,
the same sweep measures **0.6–2.4 %** at a flip, against ~0.4 % for an
ordinary step of the same sweep.

It also retires two clamps. `DILATE_MAX` and the "never let a dilated vertex
reach the light" guard both existed to bound a radial SCALE; a bearing
rotation has nothing to bound, and small or distant bodies — the ones that
used to pin those clamps — now get the same soft band as everything else.

The measurement route is worth recording, because two metrics measured the
wrong thing first. Differencing unified against legacy at a FIXED camera is
clean (noise floor 0.00 with the light held still), but with the camera
following the ship it measures the pan, and per-pixel deltas off a moving
camera are swamped by the star field. What worked was instrumenting the
geometry: a pop is a step change in a number, not a judgement about pixels.

### The frame rate: the report cannot answer that question yet

The capture supplied with the report (`Tile Heavy`, 1507x960, 680 frames)
does not show the drops it was offered as evidence of:

- **FPS avg 60, median 59, 1 %-low 56, min 53, ≥55 for 100 % of frames.**
- Worst frame **19.0 ms** — one missed vsync at most.

And the line that reads like a smoking gun is not one: that worst frame is
`render 4.00 · sim 1.00 · other 14.0`, and OTHER at a locked frame rate is
mostly IDLE. The frame clock is wall time between rAF callbacks, so a 16.7 ms
frame containing 5 ms of our JS necessarily carries ~11 ms of vsync wait in
that column. The report's own caption said "GC pause, compositing or an OS
stall, i.e. NOT our JS", which invites exactly the misreading — fixed, in the
same spirit as A0's `ui` correction.

The capture ALSO cannot attribute anything to the lighting, because it never
printed it: `lightingMs` has been on `PerfSnapshot` since A0 and is inside
`renderMs` like everything else the renderer does. So the recorder now prints

    light avg X ms of render · peak Y ms · lights avg Z

on its own line — a SLICE of render rather than a term beside it — plus the
light's share of the worst frame in the spike line. `lights` is the mean
number composited per frame, because the cost is per light and a mean of 4
against a mean of 1 is most of any answer about it.

A capture taken while approaching a cluster will now say whether the light
layer is what costs, in the same units as everything else.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **128 passed**. The new
test sweeps a light around one hex and asserts that a flip may not move the
shadow area much more than an ordinary step of the same sweep does — and
asserts its own premise first, that the sweep contains a flip at all.

---

## A5m — a flashlight: the player's light as a directional beam

Requested as a prototype behind a toggle, alongside the radial glow and off.

### What it is

`FLASHLIGHT_CYCLE` (DBG "Flashlight"): `radial` (default, the shipped
360-degree glow) / `wide` 120 / `beam` 80 / `narrow` 45 / `tight` 25 / `off`.
Values are full cone angles; the table stores half-angles.

Three decisions worth their own lines:

- **The aim is `player.rotation`**, which is the angle shots travel along, so
  the torch points where the ship is looking and there is no second control
  to fight over. It follows the pointer, the stick, and the pad, for free.
- **`off` is a zero-width beam, not a special case.** The player's light draws
  nothing, so what remains on the layer is exactly the emitters — a useful
  thing to look at rather than a way to disable the feature (`Lighting:
  legacy` is that).
- **`radial` is a half-angle of 180**, so the beam costs nothing at all when
  it is not in use: no mask, no cull, no branch beyond one compare.

### The mask masks the LIGHT, not the layer

The beam is applied at the END of `compositeLight`, after the shadows and the
caustic, and it erases the complement of a cone. Two consequences fall out of
that placement, both deliberate:

- Everything the player's light does is masked TOGETHER — falloff, shadows
  and caustics. A caustic added after the mask would put light outside the
  beam and unmake it.
- The **emitters are not masked**, because they are composited afterwards. A
  lit metal plate is its own light and radiates in every direction; that is
  what makes sweeping a beam past one read as the beam FINDING it. What the
  emitters do take from the beam is how much light they RECEIVE: an emitter's
  `received` is scaled by the beam's own profile, with the same soft edge and
  spill floor, so a body at the cone's edge fades in rather than switching —
  the A5j lesson applied at the source instead of at the halo.

The complement of a cone is ONE sector of more than half a circle, so the
mask is one path per pass rather than a winding trick, graded over
`FLASHLIGHT.PASSES` erases for a soft angular edge. `SPILL` (0.14) is why the
ship is not standing in a void: a torch is held by someone who can still see
their own hands, and a hard cut at the cone's edge reads as a rendering error.

### It is CHEAPER, not just darker

A shadow runs radially outward from its caster, so a body outside the beam
cannot cast into it — those bodies are skipped entirely, with a margin
covering the body's own angular size, the penumbra, and the deviation a
refracted cone leaves with. Measured on the metal showcase, parked in a
cluster at 24 occluders throughout:

| beam | lightingMs p50 | p95 |
|---|---|---|
| radial | 0.850 | 1.075 |
| wide | 0.755 | 0.975 |
| beam / narrow / tight | 0.41–0.46 | 0.50–0.54 |
| off | 0.115 | 0.165 |

**Roughly half the cost of the radial light** from `beam` inward, at the same
occluder count.

### The bug it shipped with, for one build

The first working version ran the mask and did nothing: the ring measured
identical at `radial` and `narrow`, to the decimal. The cause is worth
recording because it is the SAME failure A4 shipped with — `destination-out`
erases by the SOURCE's alpha, and the fillStyle in hand at that point is the
light's own falloff gradient, which is anchored at the canvas origin and
reads alpha 0 out where the sector is. The mask ran 25 times a second and
erased nothing.

What found it was instrumentation, not inspection: a counter proving the mask
was called, against a ring proving the picture had not changed. "It runs" and
"it works" are different claims and the gap between them is exactly where
this class of bug lives — so the test now asserts BOTH.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **129 passed**. The new
test aims the ship WITH THE POINTER rather than by writing `player.rotation`
(the sim recomputes that from the pointer every step, so a test that assigns
it measures nothing), then asserts: radial is uniform and unmasked, narrow is
bright along the aim and at least 3x dimmer across and behind it, the spill
floor is present rather than a hard cut, the lobe follows the aim through
half a turn, and `off` draws no player light at all.

---

## A5n — two more beam widths, two more translucent materials, a coloured
## light, and bubbles that glow

Four requests, and one flaky test that had to be rewritten rather than
re-run.

### The beam ladder gains both ends

`radial` / **`half` 180** / `wide` 120 / `beam` 80 / `narrow` 45 / `tight` 25
/ **`pin` 12** / `off`.

`half` is not a torch — everything ahead of the ship and nothing behind it,
which is what a headlight does and a useful middle ground between the glow
and a beam. `pin` is where the soft edge (12 degrees) is as wide as the beam
itself, so it reads as a spot with no boundary at all rather than as a
narrower `tight`.

### Plastic and indestructible transmit and emit

| variant | transmit | emits |
|---|---|---|
| glass | 0.55 | 0.50 |
| indestructible | 0.50 | 0.45 |
| plastic | **0.28** | **0.25** |

Plastic is the cloudy one, and "more opaque" has exactly two numbers to live
in. Measured behind one tile with HARD shadows, where the residual light in
the umbra IS the transmit: rock 0.15, plastic 0.38, glass 0.71,
indestructible 0.82 (the probe carries a constant offset and cannot separate
0.50 from 0.55 — glass and indestructible are within its noise, and the
ordering that matters, rock < plastic < the translucent pair, is not).

Plastic's colour is per INSTANCE, so a plastic field emits in its own greens
and pinks rather than in one authored tint — the per-body tint resolution
from A5i pays for itself here with no new code.

One thing to know before adding a sixth: `_transmits` holds FOUR distinct
values and snaps the rest to the nearest. The shipped set is exactly four
(opaque / 0.28 / 0.50 / 0.55), so a fifth would silently merge into a
neighbour rather than misbehave — but it would merge.

### The light has a colour

`LIGHT_COLOR_CYCLE`: `ship` (the engine-glow blue the layer has always used,
and still the default) / white / warm / amber / green / violet / red.

It reaches everything the player's light does, the REFRACTED cone included —
light that passes through glass keeps the colour it arrived with. The
emitters are deliberately unaffected: they radiate the colour of the BODY,
not of what lit it, which is the approximation A5i settled on. Measured as
per-channel gain at a lit point: ship 22/36/44, warm 44/37/26, green
26/44/29, red 44/21/19.

The gradient cache was already keyed on colour (A5i), so this cost nothing
but a table.

### Bubbles glow

A lit bubble is a paper lantern, and it now re-emits `BUBBLE_CONSTANTS.EMITS`
(0.35) of what falls on it, in its own membrane colour — which drifts as it
feeds and sickens, and the tint cache notices because it is keyed on that
colour.

It emits WITHOUT occluding: the nebula shape exactly, and for the same reason
— a soft blob has no business casting a hard shadow volume. A bubble is an
ENEMY rather than a shard-family body, so it has no `shardVariant` and its
numbers come from `BUBBLE_CONSTANTS`; the dynamic grid holds every moving
body, so it was already in hand and cost no extra query. `recordEmitter` now
takes the two numbers and a tint rather than a variant id, which is what let
a non-variant body join without a second path.

One consequence worth naming: the dynamic walk now runs when EMITTERS are
wanted, not only when shard SHADOWS are on. Turning shard shadows off is a
statement about what casts, not about what glows.

### The test that had to be rewritten

A5k's caustic test passed alone and failed in the full suite. Two attempts to
stabilise it by changing the WALK (straight line, then a 120-degree orbit)
made it worse — the second failed three runs in four.

The cause is that it measured a mechanism through a generated scene. The
cliff it exists to pin lives in one pure function; whether a given walk
crosses a critical angle at all depends on the polygon the map happened to
generate, so the test kept failing on its own premise rather than on the
behaviour.

So `transmissionWeight` is now factored out and exported, `refractTo` calls
it (the suite pins what the draw path runs, not a copy), and the test sweeps
incidence from 0 to 60 degrees: with the fade off exactly one step carries
the whole transition and no sample lands in between; with it on no step
exceeds 0.2, the transition spans many samples, and the series is monotone.
A scene-level check follows it, because a caustic that stopped reaching the
canvas would satisfy every assertion about the function.

That scene check found its own bug immediately: a tile MOVED after map load
is still filed under its old cell in the static grid, so the radius walk
never finds it. Every hand-built scene in this suite has to rebuild the grid,
and now they all do.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **130 passed**.

---

## A5o — the material's colour rides the light it passes on

Asked with the right question attached: is this complicated and bloating?
Split three ways, the answer is different for each — which is why it is
worth writing down rather than just saying "done".

The layer had the physics wrong in OPPOSITE directions. Transmitted light
carried the LIGHT's colour with no trace of the material it passed through;
an emitter carried the MATERIAL's colour with no trace of what lit it. Light
through green glass comes out green, and a body under a red torch cannot
re-emit blue.

One knob — `TINT_MIX_CYCLE` (DBG "Tint mix"), default `1/2` — two
applications, each monotone with the old behaviour at an end:

| path | what the mix does | cost |
|---|---|---|
| Emission | `lerp(light, material, mix)` on the halo's tint | **nothing** |
| Refracted caustic | the same blend, into the fill it already does | **nothing** |
| Straight-through transmission | tints the umbra after the fact | one fill per translucent group |

The first two are free because the colour was already a parameter: A5i made
the gradient cache colour-keyed and resolves a tint per body, so both are a
different string reaching an existing fill. The blend itself is memoised
against the body tint and dropped wholesale when the light colour or the mix
changes — a keypress, never a frame.

The third is the one with a real cost, and the reason is structural: the
transmitted light is **not drawn** by the shadow pass. It is what the pass
chose not to erase, so it cannot be given a colour at fill time; it has to be
coloured afterwards. That means a second fill over the same geometry — free
of geometry, since `fill()` does not consume the path, and taken only on the
UMBRA pass so the tint lands once rather than once per graded pass.

Measured at 24 occluders and one light, on the showcase where EVERY occluder
is translucent:

| config | p95 |
|---|---|
| refraction **on**, mix off | 3.070 |
| refraction **on**, mix full | 2.950 |
| refraction off, mix off | 2.480 |
| refraction off, mix full | 2.955 |

**With refraction on — the shipped default — it costs nothing at all**,
because the straight-through path does not run: the light is moved into the
caustic, which carries the blend in its own fill. With refraction off it is
+0.47 ms p95 in the all-glass worst case, and unmeasurable on metal (nothing
translucent, so no group qualifies).

### Two bugs it shipped through on the way

**`multiply` is wrong on a mostly-transparent layer.** It is the operation
this wants physically, and where the destination alpha is 0 the formula
reduces to the SOURCE — so it painted solid colour across the unlit part of
the umbra rather than tinting the light in it. Measured as a gain of
**(0, 255, 0)** behind a green tile: a green hole, not green glass.
`source-atop` is the one that means "colour what is already there": clipped
to the destination, keeping its alpha, with the strength carried in the
fill's own alpha.

**A shared parse scratch aliased the two colours.** `parseRgb` wrote into one
module-level triple, so parsing the body colour and then the light colour
left both names pointing at the light's channels, and the blend returned the
light's colour at every mix. The nebula test caught it: a body stamped pure
red emitted blue-green. Two destinations now, and the note says why.

### And two tests that had to be re-aimed rather than re-baselined

Both were measuring something the new knob legitimately changes:

- The **transmission** test measures how much light a body WITHHOLDS, in
  luminance — and tinting what comes through toward the material's colour
  changes that luminance without changing what was withheld (glass is
  indigo, so a half-tinted beam reads dimmer through an identical shadow).
  It now pins the mix `off` for its duration, beside the refraction,
  emissive and softness pins it already had.
- The **nebula emission** test asserted "a body stamped red emits red",
  which is only the whole truth at `full` now. It asserts the two ENDS
  instead — red at `full`, the light's colour at `off` — and states the
  second as a SHIFT rather than against an absolute baseline, since the two
  samples come from different moments of a live scene.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **131 passed**.

---

## A5p — the tint was invisible, and the blend operation was the smaller half

Reported as "I'm not seeing the mixing — can we use a different blend
operation than multiply?". The operation had already stopped being multiply
in A5o (it shipped as `source-atop`), so the report was right about the
symptom and the diagnosis had to go elsewhere. Two causes, and the bigger
one is not a blend mode at all.

### Cause 1: in the shipped configuration the tint never ran

The straight-through tint was gated `!refract`, and **refraction ships on**.
With it on, A5e's prototype MOVES all of a body's transmitted light into the
deviated caustic — "the energy is moved, not added" — so there is no
straight-through light left to colour, and the umbra behind glass is simply
dark. A feature can be correct, tested, and invisible at the same time, and
this one was all three.

`TRANSMIT_STRAIGHT_FRAC` (0.5) now splits it: the caustic carries the
deviated share and the straight-through path carries the rest. That is also
closer to the physics than either extreme — a prism sends light sideways, a
parallel-faced pane sends it straight, and glass tiles are panes.

### Cause 2: light you did not draw cannot be given a colour

The deeper problem is that "transmitted light" was never DRAWN. It was the
light's own light, sitting where the shadow pass declined to erase it, and
every operation that tints in place fails on it in a different way:

- `multiply` is the physically right one and paints solid colour where the
  destination alpha is 0 — a green hole instead of green glass (A5o).
- `source-atop` can only pull what is already there toward the tint, so its
  effect scales with how DIFFERENT the two colours are. Glass is indigo
  (`#6366f1`) and the lamp is sky blue: at a half mix that is a few
  luminance levels on a dim umbra. Invisible, and correctly so.

So transmitted light is now ERASED IN FULL and ADDED BACK as its own light,
in the blended colour, filled with the light's own falloff gradient — the
construction the caustic has used since A5e. The colour goes in at fill time,
where it can actually be chosen. At mix `off` the old partial-erase runs
instead, so the control case stays exact.

Measured behind a glass tile stamped pure green, as R,G,B gain in the umbra:

| config | mix off | mix 1/2 | mix full |
|---|---|---|---|
| refraction off | 3, 5, 5 | 3, **10**, 6 | 0, **11**, 0 |
| refraction **on** (shipped) | 5, 9, 10 | 2, **10**, 5 | 0, **11**, 0 |

Both rows now carry the material's colour, and the transmitted light is
brighter than it was — it is added deliberately rather than left over.

### Two tests corrected rather than re-baselined

- The A5o test asserted "the tint does not ADD light", which was true of
  `source-atop` and is false of the new construction by design. The bound
  that survives is the physical one — a body passes light on, it does not
  make any — so it now samples OPEN SPACE at the same distance and asserts
  the transmitted light stays under it.
- The transmission test's lower bound was `0.30` against a measured ~0.30:
  it flaked twice in three full-suite runs sitting exactly on its own
  threshold. It now states what it is for — glass strictly BETWEEN the two
  failure modes — with the lower bound tied to the opaque case as well as to
  a fraction.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **131 passed**, twice in
a row including the previously flaky one.

---

## A5q — the tint ships OFF, and a fog of war the light cuts through

Two changes: the colour-blend knob from A5p defaults to `off`, and there is
now a fog pass composed from the light layer.

### The tint mix defaults to off

A5p's answer to "why can't I see it" was right about the mechanism and did
not change the answer to "is it worth it". Measured, the effect is a few
luminance levels: the materials that transmit are indigo glass, grey-blue
plastic and steel-blue metal, all of which sit close to the lamp's own sky
blue, so the blend has little distance to travel. What it costs is not
nothing — at any mix above zero the straight-through path stops being a
partial erase and becomes a full erase plus a gradient FILL per translucent
group, which is real work in the pass that is already the frame's most
expensive.

So `TINT_MIX_CYCLE` is reordered with `off` first. Nothing is deleted: the
whole ladder is still one DBG row away, and the test still drives both ends
and asserts the shipped default is the default rather than the only value.
This is the same shape as emitter shadows — built, measured, correct, and
off, because a cost/benefit that lands this way is a default, not a bug.

### Fog of war: `engine/systems/render/fog.ts`

The request was three layers — dark, greyed, clear — with a two-layer
fallback for maps where memory does not fit. Both are shipped, as tiers of
one cycle: `off` / `dim` / `dark` (two-layer) / `memory` (three-layer).

The construction is the point. The fog is not a second visibility model; it
is **composed from the light canvas**, which means it is occlusion-aware for
free — a corridor of shadow behind a tile stays fogged because the light
pass already declined to light it, and every feature the light layer has
(the flashlight cone, the beam width, the radius, refraction spill) shapes
the fog with no code that knows about any of them.

Four steps per frame, all on offscreen canvases, one blit out:

1. **Boost the light into a mask.** The light layer peaks at
   `PLAYER_LIGHT_PEAK` (0.34) and a mask has to reach ~1. Each additive
   redraw of a canvas onto itself doubles its alpha, so the boost is
   `ceil(log2(MASK_TARGET / (PEAK · brightness)))` doublings, clamped at
   `MASK_MAX_DOUBLINGS` — three or four `drawImage`s of a screen-sized
   canvas, not a per-pixel pass. Cheap, and it inherits the light's exact
   shape including its falloff.
2. **Fill the dark.** `FOG.COLOR` is `0, 0, 0`. It was `4, 8, 18` first,
   which is ~10 luminance — brighter than the ~3 of empty space, so the
   "fog" lightened the screen. Empty space in this game is nearly black
   already; anything a fog is allowed to be must be darker than that.
3. **Erase what is remembered** (`memory` only). A world-space explored
   texture, one texel per `FOG.CELL` (48 world units), stamped with a disc
   at the player each frame across all nine wrap offsets, and drawn back
   scaled over the camera window at the same nine offsets. Torus-wrapped on
   both ends, and reset in `GameEngine.loadMap` — a new map has never been
   seen. Remembered ground erases only `MEMORY_FRAC` of the dark, which is
   what makes it the middle layer rather than a second clear one.
4. **Erase what is lit**, then a small feathered self-bubble at the hull so
   the ship is never inside its own fog, then one `drawImage` to the main
   canvas with `globalAlpha` and the composite operation both set
   explicitly.

Measured on GLASS_FIELD, differencing fog on against fog off at a fixed
camera:

| | away from the ship | at the ship |
|---|---|---|
| off | 8.73 | — |
| dark | **1.13** | unchanged |
| memory — remembered | 2.7 | |
| memory — never seen | **0.0** | |

Cost: `off` 0 ms, `dark` 0.3–0.5 ms p95, `memory` 0.5–0.7 ms p95, on
`lastFogMs`, which every early return zeroes so a disabled pass cannot leave
a stale number in the recorder.

### The test that measured the interface

The first version of the fog test sampled near the screen edge and read
31.0 → 26.2 — "the fog barely works" — while a direct probe of the same
build read 8.73 → 1.13. The sample box was landing on the bottom loadout
strip, which the fog deliberately does not darken, so the patch was mostly
HUD. The fix is in the test, not the fog: drop the light to its `minimal`
tier so there is unlit world on screen, sample ABOVE the ship between the
top chips and the light, and restore the tier afterwards.

Also removed: a stray `expect(r.tier).toBe('low')` copy-pasted into the A5p
tint test, whose returned object has no `tier` field — an assertion that
could never have passed, and did not, on the first full-suite run.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **132 passed**.

---

## A5r — the minimap carries the fog's memory

> "the minimap should reflect the memory of the fog for all fog modes except
> off"

### What moved

The explored memory used to be recorded only on the three-layer rung,
because that was the only rung that spent it. It is now recorded at **every
rung above `off`**, and the minimap veils its terrain with it at all of them.
The split the change makes explicit: RECORDING is cheap and unconditional
(one arc into a 125×125 canvas), SPENDING it on the world fog is what the
`memory` rung buys.

`renderMinimapFog` draws a veil in the fog's own colour at the fog's own
darkness, cut by the memory, between the terrain layers and the contacts.
Measured on the collapsed map, mean luminance of a patch the ship has never
been near:

| rung | minimap terrain | at the ship |
|---|---|---|
| off | 34.3 | 60.8 |
| dim | 15.5 | unchanged |
| dark | 4.0 | unchanged |
| memory | 2.5 | unchanged |

### Three decisions inside it

**Terrain only — the contacts read straight through.** Enemies, the boss,
portals, stations and the snitch are drawn after the veil. They are live
sensor contacts, not map knowledge, and wave enemies spawn on an offscreen
ring: a minimap that hid them until you had flown there would not be a fog of
war, it would be a broken threat display. The fog hides the MAP, not the
radar.

**Cut with the memory, never with the light.** The lit region moves every
frame; a minimap that lit and unlit itself at walking pace would strobe at
75px. The world fog is the live layer, the map is the remembered one.

**Gated on `_fogActive`, not on `getFog()`.** The fog is composed from the
light layer and does not draw at all under legacy lighting — and nothing
stamps the memory on a frame the fog pass skipped. A minimap that fogged
itself off a memory nobody was writing would black out entirely.

### Two bugs found on the way

**The memory's wrap period was the canvas width.** It is the map's extent in
cells, which is that rounded UP: 15000/48 = 312.5 against a 313-wide canvas.
Wrapping on the canvas width put the seam half a cell off and would have slid
the world fog against the minimap fog. Both consumers now read
`fogMemoryPeriodX/Y`, and the world draw samples `0..period` rather than the
whole texture, so the never-stamped padding column is never sampled.

**One wrapped blit, two copies.** The pre-rendered terrain layer and the fog
veil both sample a camera-centred window out of a texture that repeats with
the map, splitting into up to four draws at the seam. `wrapBlit` in `hud.ts`
is now the one copy — with the period as a parameter, since the terrain
layer's period is its canvas size and the fog memory's is not.

### Three tests, and the same lesson twice

The full-suite run failed on the fog test's own guard — `offAway > 2` against
a measured 1.91 — the third time in this gauntlet that a measurement of a
mechanism has been decided by what the map generator happened to put in the
sample box. Parking in the densest cluster raised it to 5.5–20 but did not
fix the class of problem, so the fog test's scene is now **hand-built** like
the shadow tests above it: a 3×3 block of tiles placed at the remembered
patch and another at the never-visited control, symmetric about the vantage
point, both outside the light's reach.

The minimap test then flaked on the same underlying mistake wearing different
clothes: it sampled a FIXED minimap offset while the camera was still lerping
home from the exploration flight, so on a slow-camera run the probe landed on
world +850 instead of +600 — outside the disc it had just stamped, reading as
"the memory did not take". The offset is now computed from the LIVE camera
position, which is the rule the shadow test already states in its own comment
about taking bearings from the light's real centre rather than from screen
centre.

Both patches also baseline each spot against ITSELF with the fog off, so
neither comparison can be decided by which of the two happens to hold more
terrain.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **133 passed**. The two
fog tests were additionally run four times each on their own.

---

## A5s — the CI flake, and `beam` becomes the default

### The minimap test flaked in CI on a cause its own design created

The A5r gate was green locally and red in CI: `seenPlus / offPlus >
2 × (unseenMinus / offMinus)` failed with the CONTROL patch reading
brighter veiled than its own unfogged baseline.  The veil covers the
TERRAIN and the contacts draw on top of it BY DESIGN — so an ambient
bubble drifting through the sample box adds a bright pulsing blip to a
patch that is supposed to be measuring hidden ground.  Fauna is
always-present, so it cannot be waited out; the test now deactivates every
non-STRUCTURE entity each frame, and the assertions compare each spot only
against ITSELF in the same fog state (cross-normalising against the other
spot divides by a nearly-empty patch and turns the comparison into noise).

The same suppression went into the world-fog test and — once the flake was
understood as "moving fauna between paired reads" — into the shadow test's
settle loop, whose profile is a unified-minus-legacy DIFF of two reads ~30
frames apart: a bubble that moves between them leaves its brightness in
the diff, and the glass umbra is a ~5-luminance signal.  Its `gIn >
2 × inShadow` bound also rode the measurement (6.7–8.5 against a doubled
4.4–5.5 across runs) and is now 1.2×, with the strict claims — lighter
than rock's shadow, darker than open space — unchanged.

### `beam` ships as the flashlight default (user call)

`FLASHLIGHT_CYCLE` still starts with `radial` in table order; the default
INDEX now points at `beam` (an 80° cone).  The cone test and the ladder
test assert the new default, and the ladder asserts the cycle from where
the default sits.  FIVE other tests — the shadow profile, refraction, the
edge flip, the tint, and the world fog — measure light on rings and
bearings a cone would simply not illuminate, so each now pins the
flashlight to `radial` for its duration and restores it, exactly as they
already pin refraction, emissive, softness and tint mix.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **133 passed**; the
formerly flaky shadow test run six times green on its own, the two fog
tests four times each.

---

## A4b + A6 + A7 — the ladder's last three rungs

The precondition A4 left on A4b — "the operator confirming the unified look
is at least as good" — was met sessions ago ("Lighting looks good"), and
with the fog and world-light machinery in place the remaining stages are
small.  All three land here, each behind its own toggle restoring the exact
pre-stage picture.

### A4b — the legacy receivers, retired under unified

Model B (the repel-impulse glow) died at A5f.  What remained were Model A —
`renderProximityBloom`, the near-face bloom on plastic / rock /
indestructible — and Model C, the glass slow-path proximity tint
(`PROX_RANGE` 120).  Both are stand-ins for a light the game did not have:
"the face near the player is lit".  The point light says that by
construction, so under `unified` both were double-lighting.

Both are now gated on the lighting mode: they run under `legacy` (the true
restore) and `debug` (which renders the world as legacy under the
diagnostic fill) and not under `unified`.  Nothing is deleted — `legacy` is
still byte-for-byte the old renderer.  The A0 finding stands: the credit is
small (0.01 ms on UNIVERSE, 0.2 ms worst-case).  Where it actually lands is
the fast path: the `inGlowRange` bail that forced near-player indestructible
tiles onto the slow path every frame is also mode-gated, so those tiles now
stay in the static cache under unified.

One instrument fixed en route: `lastTileLightingCount` counted "bloom calls
that took >1 µs", which reads zero wherever `performance.now()` is clamped
to 100 µs — headless test contexts, the A0 story again.  It now counts
PAINTS (`renderProximityBloom` returns whether it drew), which is also
simply the truer number.

### A6 — world lights: shots and the snitch, budgeted and culled

The self-luminous movers are now first-class lights on the unified layer,
in their own colours — a red bolt lights the corridor red as it passes.
They are deliberately NOT emitters: an emitter's brightness is what the
player's light put on it (`received × emits`, beam-gated), where a shot
glows because it is on fire — no received factor, no beam gate, alive
outside the player light's radius entirely.  `WORLD_LIGHTS` in constants
carries the radii and alphas.

The two halves of the stage's name:

- **Budget** — they spend what is LEFT of the tier's `maxLights` after the
  player and the emitters, nearest-to-screen-centre first, so the tier's
  number stays the whole frame's light count.  In open space (where shots
  fly) emitters are few and shots get the budget; deep in a lit glass field
  they lose it.
- **Culling** — a candidate whose light disc misses the layer rect is
  dropped before any budget is spent: one rectangle test per off-screen
  shot.

No shadows, deliberately: a shadow thrown by a bolt is unreadable at any
speed, and each shadowed light is a fresh occluder collection (the A3
landmine — the pool is shared and must be consumed per light; the comment
at the pass names the emit-shadow scratch-canvas path as the only legal
route if this ever changes).  Lightning ARC segments are excluded — one
bolt must not become a rope of lights.  DBG Visual ▸ "World lights";
`renderer.worldLightCount()` instruments the pick.

### A7 — depth-scoped ambient darkness

Each descent (`GameEngine.stageIndex`) adds the tier's `ambientPerStage` of
darkness, capped at `AMBIENT_DEPTH_CAP` (4) stages.  The hub is depth 0 and
never darkens: darkness is a property of going DOWN, not a global mood.

The mechanism is the fog compositor: `fogEffectiveDark` returns
`max(fog cycle dark, depth ambient)` — whichever wants the world darker
wins — and both the world fog and the minimap's memory veil read it.  So
depth darkness is cut by the player's light, respects shadows, inherits the
beam, and darkens the map, all through machinery that already existed; the
implementation is one function, one renderer field (`stageDepth`, stamped
by the engine before each draw — the renderer still never reads sim state),
and a fold at two call sites.

`ambientPerStage` was authored 0 at Low when ambient was expected to need
its own pass; the fog compositor costs 0.3–0.5 ms, so Low now carries 0.08
and only the emergency tiers below it stay zero.  DBG Visual ▸ "Depth
dark", on by default — it changes nothing until the first descent.

### Tests, and the flake class closed suite-wide

Three new tests: A4b pins the bloom count at zero under unified and nonzero
under legacy on a plastic cluster; A6 hand-places two projectiles and pins
the count (on-screen shot lights, two-screens-away shot culled, toggle
restores) and that the gain is RED — the shot's colour, not the lamp's;
A7 pins monotone darkening over depth 0 → 2 → 4, the cap (depth 9 reads as
depth 4), and the toggle restore.  The A7 test's first draft cycled the
light tier down to keep its patch outside the radius — to `minimal`, whose
`ambientPerStage` is zero, measuring the OFF branch and calling it broken.
The shipped `low` radius already misses the patch, so the tier stays put.

The full suite then flaked once more on the fauna-drift class A5s
identified — the flashlight test's `off < 3` bound against a ~18-luminance
bubble that drifted between the paired reads — and its pin now suppresses
non-STRUCTURE entities like every other paired-read test.  That is every
paired-read measurement in the suite now fenced.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **136 passed**; the
three new tests three times green in a row on their own.

---

## A7b — depth darkness ships OFF, parked for the universe map structure

User call, after reviewing how depth is actually reached today. The A7
mechanism is unchanged — built, tested, one toggle away — but
`depthAmbientEnabled` now defaults to `false`.

The reasoning, recorded in full in `docs/PARKING_LOT.md` ("Depth-scoped
darkness belongs to the universe map structure"): the `stageIndex` the
darkness keys on is not yet a real place. A post-boss descent rift just
moves the player between arenas that all hang off the one Overworld — the
target is a random interchangeable descriptor — and nothing persists:
leave a "deep" arena through its overworld return portal and come back,
and `stageIndex` was zeroed at the hub, so the darkness is gone. A
darkness that evaporates on a round trip reads as a bug, not as depth.
The sub-layer portal system is planned future work, and that is where
this switches on — re-point the `stageDepth` stamp at the node's real
depth coordinate and flip the default; the compositor, cap, tier scaling
and tests all carry over.

The A7 test now turns the mechanism on itself (and restores off), and
asserts the shipped default is `false`.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **136 passed**.

---

## A8 — the lighting perf pipeline is closed end to end

Two gaps stood between "instrumented" and "monitorable", both now closed so
an on-device capture can be pasted back and read without follow-up
questions.

### The fog timer reaches the recorder

`lastFogMs` existed on the renderer but stopped there — a device capture
would have shown the fog's cost buried in the render total. It now flows
the same path as the light timer: a `perfFog` ring in the engine →
`PerfSnapshot.fogMs` (ring-averaged, zero while the fog is off) → the DBG
overlay (`·fog` row) → the Perf REC report, whose light line reads

    light avg X ms of render · peak Y ms · lights avg Z · fog avg F ms · peak P ms

The report's `set` line also carries the full lighting vocabulary now —
`light unified/low · soft diffuse · beam beam · refr on · emis on ·
eshd off · fog off` — so a pasted capture says which configuration
produced its columns.

### A real bug found on the way

The four lighting accumulators (`sumLighting`, `maxRawLighting`,
`worstFrameLighting`, `sumLights`) were missing from `PerfRecorder.reset()`
from the day they were added: the SECOND capture of a session inherited the
first one's sums and reported a light average diluted or inflated by frames
outside its own window. Any session's first capture was correct; any later
one was not. Fixed, with the fog pair registered in the same block.

### The headless matrix has lighting scenes

`perf/capture.mjs` now samples `lastLightingMs` / `lastFogMs` per frame and
prints `lit p99 / lit max / fog p99` beside the render columns, and
`perf/scenes.mjs` gains a three-rung ladder on GLASS_FIELD (the lighting's
worst case — every tile is occluder + transmission + caustic + emitter at
once), same map, same seed, so the deltas are the features' cost and
nothing else:

| scene | what it states | this container, lit p99 / fog p99 |
|---|---|---|
| `light-legacy` | the floor: layer off, columns must read 0 | 0.00 / 0.00 |
| `light-shipped` | the shipped defaults, stated explicitly | 1.70 / 0.00 |
| `light-max` | everything on: emit shadows, memory fog, radial, full tint | 0.60 / 1.40 |

(Levels indicative — software raster; deltas are the evidence, and the
shipped-vs-max light comparison mostly reflects `radial` skipping the beam
mask passes.)

### The wiring is pinned, the speed is not

A new merge-gate test asserts the SEAM, deliberately without a millisecond
threshold (CI timing is noise — the repo's long stance): `lightingMs`
reaches `EngineStats.perf` and is non-zero under unified; `fogMs` is
exactly 0 with fog off, non-zero at `dark`; and after 70 frames of legacy
(> the 60-frame ring) both drain to exactly 0. This is the failure mode
the test exists for: a renamed field would leave the renderer's timer
ticking while every capture ever taken reports the feature as free.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **137 passed**.

---

## A9 — the device numbers: the budget is met with 5× headroom

Five PerfRecorder captures from real hardware (440×756 @ dpr 2, Glass
Field, difficulty 3 — the lighting's worst-case map), taken 2026-08-21 on
the A8 build, one configuration per capture.  These are the numbers the
whole gauntlet was provisionally quoting container deltas about; they
supersede every container LEVEL in the entries above.

### The lighting slice, per configuration

| configuration | light avg | light peak | fog avg | fog peak | lights avg |
|---|---|---|---|---|---|
| legacy (layer off) | 0.00 | 0.00 | 0.00 | 0.00 | 0 |
| unified, shipped defaults | 0.09 | 0.35 | 0.00 | 0.00 | 5.97 |
| + fog `dark` | 0.09 | 0.27 | 0.01 | 0.07 | 5.52 |
| + fog `memory` | 0.13 | 0.38 | 0.01 | 0.05 | 5.59 |
| + emit shadows `std` (fog off) | 0.09 | 0.23 | 0.00 | 0.00 | 5.05 |

(ms, of the render pass.  `lights avg` counts every halo DRAWN, fading
slots included — the choose budget at `low` is player + 3, and ~3 more
mid-fade is the A5 anti-pop fade's steady state.)

Readings:

- **The A0 budget (2.0 ms) is met with ~5× headroom.**  The whole stack —
  shadows, refraction, caustics, emission, the beam, the fog compositor —
  never exceeded 0.38 ms in any frame of any capture, under 1% of a 60 Hz
  frame.
- **The unified layer replaced the legacy glow for net ≈ zero.**  Render
  averaged 2.05 ms under unified against 2.19 ms under legacy in the two
  comparable captures — A4b's deletion of the per-tile proximity bloom
  paid for the new layer.
- **Frame statistics under the shipped config are equal-or-better than
  legacy**: 59 fps median both; 5%-low 48 vs 45; ≥55 fps 91% vs 88%.
- **The two features shipped OFF on cost grounds measure FREE on
  hardware.**  Emit shadows at `std` and the three-layer memory fog were
  both container-expensive and both vanish on a phone GPU (the container's
  software rasterizer pays per-pixel for what real compositors do in
  hardware — its levels were never to be trusted, and now the same lesson
  is measured).  Their defaults are now DESIGN calls, not perf calls: the
  ledger for flipping either on is how the game should look, and the fog
  additionally waits on the universe-map depth work (A7b).

### What the captures actually caught (not lighting)

The five FPS averages — 59, 59, 48, 36, 39 — track ENTITY COUNT, not
toggles: the captures ran progressively deeper into one session (peak
2 092 → 2 580 → 3 415 → 4 072 → 5 327 entities as the waves layered
debris), and every worst frame in the three degraded captures is 24–57 ms
of SIM with the light column at ≤ 0.30.  Two concrete pre-existing items,
now quantified on device for the first time:

- **The sim wall**: physics + collisions reach ~55 ms/frame at ~5.2 k
  entities (the parked O(k²) shard-pair shape, `perf/README.md`).
- **Tint-cache thrash**: at ~4 k glass entities the 256-entry density-tint
  cache evicts before reuse — 228 misses/s sustained, one frame building
  81 tints for 5 ms.

Both belong to the planned desktop/perf session, and both were invisible
until the light column existed to EXONERATE the lighting — a capture that
only said "36 fps" would have read as the fog's fault.

### A sixth capture: `radial`, and the tint storm it exposed

A radial-flashlight capture from the deepest window of the session (5 586
peak entities) put the last flashlight datum on the table: **radial costs
about twice the beam in the light column — 0.20 ms avg / 0.40 ms peak,
8.17 halos against the beam's ~5.5** — exactly the shape the beam cull
predicts, and still ~5× under budget.

The window itself ran at 25 fps, and neither number above owns any of it.
Two mechanisms do, both now diagnosed:

1. **The sim death spiral.**  Worst frames carry 117–126 ms of SIM at 5
   substeps: a long frame pulls more substeps in, which lengthens the next
   frame, until the substep cap is the only floor.  This is the ~5 k-entity
   sim wall from the previous section at its terminal state.
2. **The nebula-dust tint storm** — the diagnosis behind the "tint-cache
   thrash" noted earlier, found by reading the code rather than guessing:
   Glass Field has NO nebula terrain, yet the capture built 374 new sprite
   tints in one frame (41 450 misses in 36 s).  The source is
   `ENEMY_NEBULA_BURST` — every enemy death sprays cosmetic nebula dust
   tinted to the enemy's body colour — and `NebulaSystem.equilibrateColors`
   then drifts every shard's hue toward its neighbours continuously.  Every
   hue step mints a NEW `(sprite, hex)` key against the 256-entry
   tinted-sprite cache, and each miss builds a 128² canvas.  A heavy
   late-run fight therefore feeds the cache an unbounded stream of
   never-to-repeat keys — it cannot converge by construction.  Cheapest
   candidate fix, parked with the rest: QUANTISE the hex in the cache key
   so equilibration steps land on reusable buckets.

### Addendum: a beam capture from an even deeper window

A seventh capture (beam, 7 222 peak entities — the session's terminal
state, sim cycled to 60 Hz) bounds the light column from above: **0.17 ms
avg / 0.55 ms peak** with 6.09 halos.  So across every capture the light
slice spans 0.09–0.20 avg by scene depth and beam width, never past
0.55 ms in any single frame — while the frames around it reached 289 ms
(render 111 + sim 172).  The same window put harder numbers on the two
parked items: the tint storm sustained ~1 119 misses/s (120 642 over the
capture, 497 new tints in one frame, 15 ms peak) — and note the render
worst-frames of 111–123 ms are largely its DOWNSTREAM cost, since every
evicted nebula-dust shard falls back to the slow tint-chain draw path;
the sim wall reached 184 ms peak at ~6 k entities.

### Method note for future captures

A slice timer (`light`, `fog`) is valid at any load — that is why the
pipeline measures slices.  FPS rows are only comparable between captures
taken at similar game states; captures 3–6 are not an FPS A/B against 1–2.

---

## A10 — the tint storm fixed: bucket the key

The A9b diagnosis made the fix obvious, and it is as small as promised:
`RenderSystem.quantizeTintHex` rounds a `#rrggbb` tint to 16 levels per
channel (17-step buckets), and `getTintedSprite` quantises BEFORE building
its key — with the quantised value also being what gets painted, since key
and pixels must agree or two callers in one bucket would share a canvas
painted for only one of them.  The one other place that constructs a store
key — the nebula-shard fast path's cached `nebulaTintedKey` — applies the
same quantisation, or the fast path would become a guaranteed miss against
the bucketed store.

Why this works: the storm was equilibration feeding the cache a
never-repeating hue stream — every drift step a new key, 497 fresh 128²
canvases in one measured frame.  Bucketed, a drifting hue crosses a
handful of buckets instead of minting hundreds of keys, and the live
working set (paths between a few anchor colours) fits a 256-entry LRU.
A ~6.7%-per-channel step is invisible on a soft translucent cloud sprite;
anything not `#rrggbb` passes through untouched.

Pinned by a merge-gate test (behaviour, not milliseconds): two hexes
inside one bucket share ONE canvas and the second lookup counts no miss;
different buckets differ; the quantiser is idempotent, format-preserving,
and passes non-hex strings through.  The definitive before/after is a
device capture's tint line — the A9c numbers (1 119 misses/s, 15 ms peak)
are the baseline to beat.

Also this entry: the ~5 k sim wall's parking-lot item now carries the
user's design direction — GRAVITY COLLAPSE, shrinking k with a mechanic
(threshold-triggered rapid collapse of dense shard fields into tile
knots, riding the existing merge/TILE_SNAP/mass-conservation pipeline)
rather than only making k cheaper.

### Gate

`npm run typecheck`, `npm run build`, `npm test` — **138 passed**.
