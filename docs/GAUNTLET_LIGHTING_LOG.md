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
- [ ] **A4b** — Migrate the legacy receivers
- [ ] **A6** — N lights with culling
- [ ] **A7** — OPTIONAL: depth-scoped ambient darkness
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
