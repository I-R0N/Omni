# Gauntlet WebGPU — the renderer feasibility spike

A **feasibility spike, not a port.** The expected deliverable is a
**verdict**, not a renderer. It runs on its own branch, in parallel with
the lighting work, and merges only if it wins outright. Abandoning it is a
normal outcome and must leave `main` untouched.

> **THE QUESTION.** Should Omni's ~6,000-line immediate-mode Canvas2D
> renderer move to WebGPU? Answer with numbers, on hardware, or not at all.

Working rules for this branch:

- **Hardest-first.** Stages 0–2 touch no *game* code — they add only
  standalone probe/harness pages and this log. The first stage that
  modifies the renderer is Stage 3, and it is the only stage whose value
  survives abandonment.
- **Three kill gates.** Reaching one is *success*, not failure. A spike
  that returns "no, and here is precisely why" in two days has done its
  job better than one returning a half-finished renderer in three weeks.
- **Effort caps are the deliverable's shape.** Exceeding a cap is a
  stop-and-report condition, not a reason to push on.
- **Hardware or it did not happen.** The CI container rasterizes canvas in
  software, which makes Canvas2D pathologically slow in exactly the way a
  GPU path is not. **No Canvas2D-vs-WebGPU comparison made in this
  container is admissible** (`perf/README.md`).
- Canvas2D stays the default renderer throughout; both paths coexist.

---

## Checklist

- [x] **Stage 0** — Device support (**KG1 PASSED** on iPhone / iOS 26.6)
- [x] **Stage 1** — Throwaway harness (**PASSED** on device)
- [~] **Stage 2** — Hardest primitive (KG2) — *quality MET; cost outstanding*
- [ ] **Stage 3** — Renderer seam
- [ ] **Stage 4** — Sprites, static tiles, HUD overlay
- [ ] **Stage 5** — Procedural shapes
- [ ] **Stage 6** — Verdict (KG3)

---

## Stage 0 — Does the target device support WebGPU at all?

**KILL GATE 1. Cap: 1 hour. Touches no game code** — it adds one
standalone page under `public/` (so a preview can serve it) and this log.
Status: **PASSED.** WebGPU is present and usable on the target iPhone
(iOS 26.6), backed by a real Apple GPU.

### The instrument

`public/webgpu-probe.html` — a single standalone file, zero dependencies,
never loaded by the app, safe to delete when the spike concludes. It
reports, in the order the brief specifies: `navigator.gpu` presence,
`requestAdapter()`, adapter info/features/limits, `requestDevice()`,
`canvas.getContext('webgpu')`, and `getPreferredCanvasFormat()`.

Three design decisions in it are worth recording, because each one exists
to stop a specific wrong answer.

**1. It proves the pipeline, not just the context.** Establishing that
`getContext('webgpu')` returns non-null is weaker evidence than it looks;
it rules out nothing about whether shaders compile or frames present. The
probe therefore compiles a WGSL module, builds a render pipeline, and runs
a **120-frame rAF loop** presenting a triangle. The gate is all five checks
AND-ed together, recorded as one boolean so the log cannot later soften it.

**2. It refuses to answer in an insecure context.** This is the trap that
would have produced a false kill. `navigator.gpu` is **only exposed in a
secure context**. The obvious way to get a page onto a phone — run a dev
server and open `http://192.168.x.x:3000` from the LAN — is *not* a secure
context, so `navigator.gpu` would be `undefined` on an iPhone that supports
WebGPU perfectly well. That reads as "KG1 FAIL, no WebGPU on device" and
ends the entire spike **for the wrong reason**. The probe detects
`window.isSecureContext` and renders an `INVALID` verdict rather than a
`FAIL` one. Any future attempt should keep this check.

**3. It is readable without devtools.** Large type, a copy-to-clipboard
button, and the full JSON rendered on-page — the phone has no inspector.
This is the same constraint `PerfRecorder` was built around, and the same
answer.

It also reproduces `effectiveDpr()`'s dpr cap of 2 and prints the backing
store the renderer would actually have to fill. On a 390×844 dpr-3 iPhone
it independently computed **780×1688 = 1.32 Mpx**, matching the brief's
figure — a small check that the probe is measuring the right device.

### Desktop control (container Chromium)

Run over `localhost` (privileged, so secure-context is satisfied) at a
390×844 / dpr-3 emulated viewport.

| | Stock launch | With software-GPU flags¹ |
|---|---|---|
| `navigator.gpu` | present | present |
| `requestAdapter()` | **null** | ok |
| `requestDevice()` | — | ok |
| `getContext('webgpu')` | **null** ("Failed to create WebGPU Context Provider") | ok |
| WGSL compile + 120-frame present | — | ok, 0 diagnostics |
| Verdict | KG1 FAIL | KG1 PASS |

¹ `--enable-unsafe-webgpu --enable-features=Vulkan,VulkanFromANGLE
`  `--use-angle=swiftshader --use-vulkan=swiftshader`

Adapter under flags: `vendor: google, architecture: swiftshader` —
**CPU rasterization, not a GPU.** Browser: HeadlessChrome/141.0.7390.37.

**This control is a functional check only and carries no performance
meaning whatsoever.** Its 16.7 ms frame times are vsync on a triangle. It
is recorded for exactly two reasons: it proves the probe instrument works
end-to-end before the phone sees it, and it establishes that headless
WebGPU in this container requires explicit flags and a software adapter —
which bounds what any future CI-side WebGPU work could ever be (functional
smoke tests: yes; performance gating: never).

### ✅ KG1 — **PASS** on the target device

Read 2026-08-16 over the Netlify deploy preview (`https:`, secure context
confirmed, device class confirmed *Apple touch device*).

| | |
|---|---|
| Device | **iPhone**, `platform: iPhone`, dpr **3**, `maxTouchPoints` 5 |
| OS | **iOS 26.6.0** |
| Browser | **Edge iOS 151** (`Version/26.0 Mobile/15E148`) — WebKit, so this *is* the Safari 26 engine |
| Screen / viewport | 440×956 css / 440×756 css |
| Omni backing store | **880×1512 = 1.33 Mpx** @ dpr cap 2 |
| `navigator.gpu` → adapter → device → context → 120-frame present | **all ✓** |
| Adapter | `vendor: apple, architecture: apple`, **`isFallbackAdapter: false`** — a real GPU |
| Preferred canvas format | `bgra8unorm` |
| Triangle frame ms | p50 **17.0** / p95 **17.0** / max **59.0** |

**Every hazard-relevant limit clears with room to spare**, and several are
far above the software adapter's:

| Limit | iPhone | Container (SwiftShader) | Consequence |
|---|---|---|---|
| `maxTextureDimension2D` | **16384** | 8192 | Static-tile cache (3072) fits in **one** texture — the tiling cost is **not** incurred |
| `maxVertexAttributes` | **30** | 16 | Ample for per-instance transform + wrap offset + tint |
| `maxVertexBuffers` | **12** | 8 | Ample |
| `maxBindGroups` | **11** | 4 | Far more headroom than the batching design needs |
| `maxBufferSize` | 1 GiB | 1 GiB | Ample |

**Three findings worth more than the pass itself.**

1. **`timestamp-query` is available.** This is the single most useful item
   in the feature list. The repo's existing `renderMs` times *CPU-side call
   issuing, not rasterization* — a known measurement hazard that cuts both
   ways in a GPU port, since a GPU renderer moves work *out* of that timer.
   `timestamp-query` permits **GPU-side** timing, so Stage 2's cost
   comparison can measure the thing it claims to measure instead of
   inferring it. Also present: `shader-f16`, `float32-filterable`, and the
   BC/ETC2/ASTC compression families.
2. **The real device is 440×956, not the 390×844 the brief assumes.** That
   figure is the *Playwright viewport* (`playwright.config.ts:35,47`), not
   this phone. The pixel counts happen to land within 1% (1.33 vs 1.32 Mpx)
   because browser chrome eats the difference, so no downstream number
   moves — but the test viewport is **not** the target device, and any
   future "it fits on the phone" reasoning should use 440×956.
3. **The 59 ms worst frame is not yet a finding.** One frame in 120 on a
   *single triangle*, against a 17.0 ms p50/p95 (a clean 60 Hz vsync). It
   is almost certainly first-frame pipeline compilation or the browser
   settling. It is recorded rather than dismissed because worst-frame is
   this repo's metric (gauntlet 5c), and if the same spike reappears in
   Stage 1's textured-quad loop it becomes a real one.

**Interpretation.** H1 is cleared **for this device**. It is *not* cleared
for the ~12% of iOS players below iOS 26, which is why Canvas2D remains the
default and both renderers must coexist. Proceeding to Stage 1.

### Second control: Safari 18.5 on macOS — **not the target device**

The first real-browser reading came back from a desktop Mac rather than
the iPhone, over the Netlify deploy preview (`https:`, secure context
satisfied). **It is not a KG1 result** and is recorded as a control.

| Field | Value |
|---|---|
| User agent | `Macintosh; Intel Mac OS X 10_15_7 … Version/18.5 Safari/605.1.15` |
| Platform / dpr / touch points | `MacIntel` / `1` / `0` |
| Screen | 1920×1080 css |
| `navigator.gpu` | **absent** |
| WebGL2 | available — **`Apple GPU`**, `MAX_TEXTURE_SIZE` **16384** |

**Why this is the expected result and not a kill.** WebGPU shipped in
**Safari 26**; this is **Safari 18.5**, several major versions earlier. A
missing `navigator.gpu` here confirms the version boundary rather than
contradicting it. The target remains a 390×844 iPhone (`devicePixelRatio`
3, `maxTouchPoints` 5) — none of which this reading shows.

**The design lesson, which is the reason this section exists.** The probe
reports a full environment block alongside the gate booleans. Without
`userAgent` / `platform` / `devicePixelRatio` / `maxTouchPoints`, this
JSON would have read as a clean *"KG1 FAIL — navigator.gpu is absent,
secure context confirmed, so this is a real device answer"* and **ended
the spike on the wrong device and the wrong browser version.** Design
note 2 guards against the wrong *protocol*; this is the same failure mode
one layer up — the wrong *machine* — and the environment block is what
catches it. **Any future probe must report enough about its host to prove
which host it ran on.** A verdict is only as good as its provenance.

**The probe was hardened in response.** It now derives a *device class*
and a *Safari version*, and refuses to report `KG1 FAIL` from a host that
is not the target class — reporting `INCONCLUSIVE` instead, the same shape
as the insecure-context guard. A `PASS` from a non-target host is likewise
downgraded (`gate.VALID = false`): a pass on the wrong machine is no more
a gate result than a fail is.

Two details in that heuristic are worth keeping, both found by testing it
against emulated iPhone / desktop-site / Mac hosts rather than by reading
it:

- **Touch points, not the UA string, identify an iOS device.** iOS Safari
  in "Request Desktop Website" mode reports a *Mac* UA and `MacIntel`
  platform — but still reports `maxTouchPoints > 0`, where a real Mac
  reports `0`.
- **`/Version\/(\d+) Safari/` does not match any iPhone.** iOS inserts
  `Mobile/15E148` between the two tokens, so a regex requiring them
  adjacent parses every *desktop* Safari and *no* iOS device — silently
  returning `null` on precisely the device the gate is about. The pattern
  must not anchor on the trailing `Safari` token.

**A useful by-product.** WebGL2 on this Mac reports a real `Apple GPU`
with `MAX_TEXTURE_SIZE` 16384 — so on Apple hardware a WebGL2 fallback
path clears both the device-support hazard and the 3072 static-tile-cache
limit comfortably. Still a different project; still the operator's call.

### Adapter limits (software adapter — indicative of the API floor only)

| Limit | Value | Why it matters downstream |
|---|---|---|
| `maxTextureDimension2D` | **8192** | Static-tile cache wants **3072** → fits in one texture, no tiling needed |
| `maxBufferSize` | 1,073,741,824 | Ample for instance buffers |
| `maxVertexBuffers` | 8 | Ample |
| `maxVertexAttributes` | 16 | Ample for per-instance transform + wrap offset + tint |
| `maxBindGroups` | 4 | Workable; batching design must respect it |

The WebGPU **spec-guaranteed minimum** for `maxTextureDimension2D` is
8192, comfortably above the 3072 the static-tile cache needs, so the
"cache must tile" hazard is very unlikely to bite on any conformant
device. **Still to be confirmed on the actual iPhone**, since that is the
adapter that counts.

**WebGL2 fallback (informational, per the brief's one-line ask):**
available in the container, `MAX_TEXTURE_SIZE` 8192, ANGLE/SwiftShader. On
iOS, WebGL2 has shipped since iOS 15 and is effectively universal — so a
WebGL2 path would clear the device-support hazard (H1) outright where
WebGPU may not. That is a *different project* and the operator's call; it
is recorded here only so the option is not rediscovered later.

### The API facts, re-verified rather than assumed

The brief asked for these to be checked against current documentation
rather than taken on trust. Checked 2026-08-16:

| Claim | Status |
|---|---|
| WebGPU via `navigator.gpu`, requires secure context | **Confirmed** — and load-bearing, see design note 2 above |
| `canvas.getContext('webgpu')` + `getPreferredCanvasFormat()` | **Confirmed** — container returned `bgra8unorm` |
| WGSL only; **no text, no path, no fill/stroke/arc/gradient primitives** | **Confirmed** — everything is triangles and shaders. H2 and H5 stand exactly as written |
| Chrome/Edge desktop since 2023; Android Chrome has it | **Confirmed** — Chrome 113+ desktop; Android from Chrome 121 on Android 12+, **initially Qualcomm/ARM GPUs only** |
| **Safari shipped WebGPU in Safari 26 / iOS 26 (late 2025)** | **Confirmed** — enabled by default on iOS 26, iPadOS 26, macOS Tahoe 26, visionOS 26. On iOS this covers all browsers, since they all use WebKit |

**One correction to the brief.** It implies WebGPU is broadly shipped
across desktop browsers. Sources disagree about **Firefox** as of mid-2026
— some report it shipped, others that it remains disabled by default
outside Windows. This is *not decisive for Omni* (the target is an iPhone,
i.e. Safari/WebKit) and was not chased further; flagged only so a future
reader does not treat "all major browsers" as settled.

**Player exclusion (a Stage 6 input, captured cheaply while here).**
iOS 26 reached **~85%** of iOS devices by end of July 2026, with iOS 27
adding **~3%**. So roughly **88% of iOS devices are WebGPU-capable**, and
a WebGPU-only renderer would exclude on the order of **12%** of iOS
players — which is precisely why Canvas2D must remain the default path and
both renderers must coexist, exactly as the brief's Stage 4 requires. This
figure is an ecosystem-wide estimate and should be re-checked at Stage 6.

### Delivery (how the device reading was obtained)

The gate could not be read from the container — it is a statement about
one specific iPhone — so the probe had to reach the phone. It must be
opened **over `https://`** — see the
secure-context note above; a LAN `http://` URL will report a false
negative.

**Delivery: two independent HTTPS paths.** The probe lives at
`public/webgpu-probe.html` — in `public/` specifically so the build copies
it to `dist/`, which is what Netlify publishes.

1. **Netlify deploy preview** (first-party, per-PR):
   `https://deploy-preview-<PR>--omnispace.netlify.app/webgpu-probe.html`
2. **`raw.githack.com`** (no build or PR needed — serves the committed
   file directly, and is the *same mechanism the repo's own previews use
   to get builds onto the iPhone*, `pr-preview.yml:21`):
   `https://raw.githack.com/i-r0n/Omni/<branch>/public/webgpu-probe.html`

Notes recorded so they are not rediscovered:

- **`pr-preview.yml` does not publish `dist/`** — only the single inlined
  `omniverse-standalone.html`, copied to `previews/pr-N/index.html`
  (`:92`). The probe is therefore *not* reachable from that particular
  preview URL. It **is** reachable from the Netlify one, which publishes
  `dist/` (`netlify.toml`) — these are two separate preview systems on the
  same PR, and conflating them is an easy mistake to make.
- **`scripts/inline-build.mjs` ignores it.** It reads only
  `dist/index.html` and the assets that file references (`:9,15,16,46`),
  so a standalone page in `dist/` adds nothing to the standalone bundle.
- **`raw.githubusercontent.com` serves `text/plain`**, so the browser
  shows source instead of running the page. It confirms the file is live
  (HTTP 200 — also how the repo's public visibility was verified) but
  cannot host the probe.
- **Clean-up obligation:** the probe ships in `dist/` on this branch. If
  the spike is abandoned, delete `public/webgpu-probe.html` rather than
  letting it reach `main`.

**Effort:** ~50 min of the 1 h cap (research, probe, container control,
this write-up). Within cap.

---

## Stage 2 — The hardest primitive (KILL GATE 2)

**Cap: 1 day. Touches no game code** — adds one standalone page under
`public/`. Status: **built, quality condition met in-container; the COST
condition needs the device.**

`public/webgpu-stage2.html` reproduces a **dented rock tile** in WebGPU and
in Canvas2D, in the same page, drawing the same scene from the same
polygon data, so the comparison is of *renderers* rather than of two
different scenes. All five of the brief's requirements are present:
runtime-mutable polygon triangulated on a dirty flag, stroked outline with
real joins, radial-gradient bloom confined to the polygon, 500 instances,
10% re-triangulating per frame.

**Fidelity was taken from the renderer, not invented** (`tileShapes.ts`):
the bloom is *not* `ctx.clip()` — it fills the polygon path with a radial
gradient as `fillStyle` (`:194–213`), and its centre is the **closest point
on the polygon outline to the player** (`:167–191`), sliding along the
perimeter as the player orbits. Centring the bloom would have made the
WebGPU side cheaper than the thing it claims to reproduce.

Two deliberate choices to avoid flattering the result: **real ear-clipping**
triangulation rather than a centroid fan (a fan is valid for these radial
polygons and nearly free — which is exactly why timing one would understate
the cost being measured), and **miter-joined stroke expansion**, the half of
H2 the brief flags as underestimated.

### 🔴 THE FINDING: batching by shape family produces the WRONG IMAGE

**This is the most consequential result of the spike so far, and it
contradicts the brief's own instruction.**

The brief mandates, for H3: *"one instanced draw per **shape family**, not
per entity."* Implemented literally — all fills in one draw, then all
strokes in another — **the output is visibly wrong**: an earlier entity's
*stroke* paints over a later entity's *fill*, so tiles show through each
other. Canvas2D, drawing fill-then-stroke per entity, occludes correctly.

It was found by looking at three deliberately overlapping tiles rather than
by trusting the aggregate diff, and it is not subtle once isolated. In Omni
tiles, shards and enemies overlap constantly, so this would have shipped as
a pervasive rendering artifact.

**Why a depth buffer does not rescue it:** Omni's rendering is heavily
alpha-blended (blooms, glows, translucent overlays), and blending is
order-dependent by nature. Depth testing fixes opaque overlap only.

**The fix, which is the actual architectural lesson:** sort the vertex
buffer by **entity order**, not by shape family — `[fill₀, stroke₀, fill₁,
stroke₁, …]` — and carry a per-vertex `kind` flag that the fragment shader
branches on. Painter's order is preserved *and* the whole scene collapses to
**one draw call instead of two**. So the correct rule is:

> **Batch by DRAW ORDER and branch in the shader — never by shape family.**

Any future attempt should start from that sentence. Getting it wrong is
cheap to fix in a harness and expensive to discover at Stage 5.

### Quality condition — **MET** (objectively, not by eye)

KG2's quality bar ("visually indistinguishable at 1× zoom") is otherwise a
subjective judgement made on a phone. The harness instead renders the same
frame through both renderers, reads back the **actual GPU texture**, and
compares pixels — so the answer is a number that a future reader can
re-check.

| Configuration | mean abs diff (/255) | pixels differing >8 | max channel |
|---|---|---|---|
| Family-batched, no MSAA | 1.42 | 5.67% | 87 |
| Family-batched, MSAA 4× | 1.26 | 4.10% | 94 |
| Entity-ordered, no MSAA | 1.10 | 4.91% | 83 |
| **Entity-ordered + MSAA 4×** | **0.38** | **0.88%** | **44** |

**0.38/255 mean (0.15%), with under 1% of pixels differing perceptibly.**
The residual is edge antialiasing, which differs by nature. Both fixes are
required and they are independent: ordering fixes overlap, MSAA fixes edges.

**MSAA 4× is not optional for parity** — without it, 4.9% of pixels differ.
Canvas2D antialiases every path edge for free; a `sampleCount: 1` WebGPU
pass does not. Its cost on a mobile GPU must be measured on the device, and
the toggle exists for exactly that. (Apple's TBDR resolves MSAA in tile
memory, so the cost may be modest — but "may be" is not a measurement.)

**A measurement bug worth recording**, because it produced a confident wrong
answer first: the diff initially read **47/255 with 100% of pixels
differing**, which looks like catastrophic failure. The cause was
`drawImage()` from the WebGPU canvas returning **blank** — the compositor
has taken the frame by then. Copying the texture directly
(`copyTextureToBuffer`, `COPY_SRC` usage, 256-byte row alignment, BGRA→RGBA
swizzle) gave 1.49. **A quality gate that screen-scrapes a GPU canvas will
fail for reasons that have nothing to do with rendering.**

### Cost condition — **outstanding, and it needs the device**

Container numbers here are worthless in both directions: WebGPU runs on
SwiftShader (a CPU rasterizer through software Vulkan), while Canvas2D runs
on Skia's heavily optimised software path. That comparison measures two
CPU rasterizers, not a GPU.

**Stage 1 also established that frame time cannot answer this question** —
it is vsync-locked at 17 ms, so any renderer fitting the budget reads as
exactly 17. Two vsync-immune instruments are therefore built in:

1. **GPU work time** per frame via `timestamp-query` (validated on device in
   Stage 1). Canvas2D has no equivalent — its JS issuing cost *under-reports*,
   which the UI states rather than hides.
2. **THE RAMP** — raise the tile count until 60 fps breaks and report where.
   Immune to vsync and to both timers' dishonesty, and it is the number that
   actually answers "which is faster". **This is the primary evidence for
   KG2's cost condition.**

Verified working in-container (ramp terminates and reports; 1 draw call at
all counts; zero console errors). Awaiting the device run.

---

## Stage 1 — Throwaway harness

**Cap: 2 hours. Touches no game code** — adds one standalone page under
`public/`. Status: **built and functionally verified; device reading
outstanding.**

`public/webgpu-harness.html` — initialises WebGPU, clears to a colour, and
draws textured quads from a real game sprite (`assets/drone.png`) at the
device's true backing store, with frame-time percentiles on-screen.

**Four decisions, each carried from an earlier finding rather than chosen
for convenience.**

1. **Nearest-neighbour sampling.** Omni sets `imageSmoothingEnabled =
   false` globally (`RenderSystem.ts:626`). A linear sampler would look
   subtly better and would not be comparing like with like.
2. **GPU-side timing via `timestamp-query`**, the Stage 0 finding. The
   repo's own `renderMs` times *CPU-side call issuing, not
   rasterization* — the precise hazard a GPU port must not inherit, since
   a GPU renderer moves work *out* of that timer. The harness reports
   `frame` (rAF delta, the honest wall-clock number), `cpu` (JS spent
   issuing) and `gpu` (measured on the device) as three separate rows, so
   the three can be seen to disagree. Timing buffers are pooled and
   sampled opportunistically — a mapped buffer cannot be rewritten by the
   next frame's resolve, so an untimed frame is skipped rather than
   stalling the loop.
3. **Percentiles, not averages** — p50/p95/p99/max. Worst frame is this
   repo's metric (gauntlet 5c): one 80 ms frame in a smooth minute *is*
   the failure, and a mean hides exactly that.
4. **One instanced draw call at every instance count.** This is H3's
   required shape, wired in from the first line rather than retrofitted.
   The instance-count control (1 / 100 / 500 / 2000) exists to prove it:
   the "draw calls" readout stays at **1** while instances scale 2000×.
   Discovering instancing was broken at Stage 5 would waste the spike.

### Container functional check (no performance meaning)

Software adapter (SwiftShader), 440×756 @ dpr 3 emulating the real device.
Verified: texture loads and renders, alpha blending correct, rotation and
per-instance tint correct, torus wrapping applied, **1 draw call at all
counts**, GPU timing collecting samples, **zero console errors**.

| Instances | Draw calls | frame p50 | cpu p50 | gpu p50 |
|---|---|---|---|---|
| 1 | **1** | 16.7 | 0.2 | 6.85 |
| 500 | **1** | 33.3 | 0.2 | 22.09 |
| 2000 | **1** | 83.3 | 0.3 | 68.11 |

**These numbers say nothing about the port** — they are a CPU rasterizer
rasterizing, and are recorded only as a correctness trace. The one
*structural* observation that does carry: **`cpu` stays at 0.2–0.3 ms
while `gpu` rises 10×**, i.e. the work is where a GPU renderer should put
it, and the CPU-side cost of instancing is flat in the instance count.
That shape should survive the move to real hardware even though the
magnitudes will not.

**One bug worth recording**, found by re-reading before running rather
than by the error it would have caused: `queue.writeBuffer`'s first
argument is the destination **GPUBuffer**, and it had been passed the
source `ArrayBuffer`. It would have thrown on the first frame.

### ✅ Stage 1 — **PASS** on the target device

iPhone / iOS 26.6, 880×1512 (1.33 Mpx), **2000 instances in 1 draw call**,
885 frames over 14.8 s.

| Metric | p50 | p95 | p99 | max | min |
|---|---|---|---|---|---|
| **frame** ms (rAF delta) | 17.0 | 17.0 | 17.0 | 32.0 | 9.0 |
| **cpu** ms (JS issuing) | 0 | 1 | 1 | 1 | 0 |
| **gpu** ms (`timestamp-query`) | **4.48** | 4.53 | 4.58 | 5.83 | 4.44 |

**2000 textured, rotated, alpha-blended, per-instance-tinted sprites cost
4.5 ms of GPU time** at the real backing store, holding a locked 60 fps —
about **27% of a 16.7 ms budget**, with the CPU side at effectively zero.

**Four results, in descending order of consequence.**

1. **`timestamp-query` returns real values on WebKit/iOS.** p50 4.48
   against a min of 4.44 and a p99 of 4.58 — a distribution far too tight
   and too finely resolved to be a privacy-quantised stub. **Stage 2's
   cost gate is therefore measurable.** This was the open risk flagged
   before the run.
2. **Frame time is VSYNC-LOCKED and cannot answer Stage 2's question.**
   17.0 at p50, p95 *and* p99 is the display's 60 Hz cadence, not the
   renderer's cost — the GPU is doing 4.5 ms of work inside a 16.7 ms
   slot and then waiting. **Any renderer whose work fits in budget reads
   as exactly 17 ms**, so a Canvas2D-vs-WebGPU comparison on frame time
   would report "17 vs 17" and conclude nothing. The brief's "≤ 50% of
   Canvas2D's frame time" gate has to be honoured *in intent* by
   measuring work, not cadence. **This changes Stage 2's design** — see
   the measurement plan there.
3. **The Stage 0 59 ms spike did NOT recur.** One 32 ms frame in 885,
   against a 17 ms p99. The pipeline-compilation hypothesis is confirmed
   and the observation is closed rather than left hanging.
4. **H3's mitigation is real on hardware.** 2000 instances cost **0 ms**
   p50 of CPU time in one draw call. Whatever kills this port, it will
   not be per-entity CPU dispatch — *provided* the port is written
   instanced, which is the condition, not a given.

**Toolchain cost: low.** No Safari-specific quirks, zero WGSL
diagnostics, no compositing issues, and the container's software adapter
proved a faithful enough functional stand-in that the device run
reproduced it first time. The brief's fail-action ("if the toolchain
fights you for more than the cap, that is signal about the port's total
cost") did not trigger — the toolchain was not the problem.

**Effort:** ~1 h of the 2 h cap.

---

## Running record of hazards

Each hazard's *actual* outcome, updated as stages land. Predicted outcomes
are in the brief and are deliberately not repeated here.

| Hazard | Actual outcome so far |
|---|---|
| **H1 — Safari/iOS support** | **CLEARED for the target device.** iPhone on iOS 26.6: real Apple GPU, all five gate checks pass, every downstream limit exceeded (`maxTextureDimension2D` 16384 vs the 3072 needed). Not cleared for the ~12% of iOS players below iOS 26 — hence both renderers coexist. Controls: container Chromium (no adapter without flags), macOS Safari 18.5 (no `navigator.gpu`, as expected below Safari 26) |
| **H2 — Path rendering (375 sites)** | **Reproducible.** Ear-clipped fills, miter-joined stroke expansion and an analytic radial bloom match Canvas2D to 0.38/255 mean (<1% of pixels differing) with MSAA 4×. MSAA is REQUIRED for edge parity. Cost on device outstanding |
| **H3 — Draw-call explosion** | **Mitigation works, but the brief's rule is WRONG.** 2000 instances cost 0 ms p50 CPU in 1 draw call (Stage 1, device). However batching "one draw per SHAPE FAMILY" breaks painter's order and renders overlapping entities incorrectly — batch by DRAW ORDER with a per-vertex kind flag instead, which is both correct and fewer draw calls |
| **H4 — Composite modes** | Untested — Stage 4/5 |
| **H5 — Text (20 sites)** | Confirmed no text primitive; the Canvas2D-overlay mitigation stands. Untested — Stage 4 |

---

## Abandoned approaches

Recorded so a future attempt does not repeat them.

- **Container-based Canvas2D-vs-WebGPU comparison** — rejected before it
  was attempted. The container's WebGPU adapter is SwiftShader (CPU) and
  its Canvas2D is software-rasterized; comparing the two measures two
  different CPU rasterizers and says nothing about a phone's GPU. The
  brief forbids it and the Stage 0 control confirms why.
