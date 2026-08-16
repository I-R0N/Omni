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
- [ ] **A1** — Occluder extraction into a single queryable source
- [ ] **A2** — Light-layer scaffolding + debug visualization
- [ ] **A3** — Occluder churn
- [ ] **A4** — One point light, shadow-cast
- [ ] **A4b** — Migrate the legacy receivers
- [ ] **A5** — Soft shadow penumbra
- [ ] **A6** — N lights with culling
- [ ] **A7** — OPTIONAL: depth-scoped ambient darkness
- [ ] **B1** — Prove the static-query duplication
- [ ] **B2** — Unify onto one primitive
- [ ] **B3** — Correct the live radius cases (conditional)
- [ ] **B4** — OPTIONAL: intra-frame query sharing

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
