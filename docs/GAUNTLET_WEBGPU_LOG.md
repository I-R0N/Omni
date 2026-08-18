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

## ⚠️ THE PROBE PAGES HAVE BEEN REMOVED — and here is where they live

The four standalone probe/harness pages this log refers to
(`public/webgpu-probe.html`, `webgpu-harness.html`, `webgpu-stage2.html`,
`webgpu-stage4.html`) were **deleted before merge**. They were throwaway
test rigs, they were never loaded by the app, and leaving them in `public/`
would have shipped ~2,200 lines of them into every `dist/` build.

**They are recoverable in full at commit `c32d790`** (PR #87), e.g.:

```
git show c32d790:public/webgpu-stage2.html > /tmp/webgpu-stage2.html
```

Nothing is lost by their absence: **every measurement they produced, and
every technique they proved, is written down below** — the blend-state
table, the draw-order rule, the premultiplied-alpha requirement, the
triangulation and stroke-expansion approach, and all the device numbers.
A future attempt should read this file, not resurrect the probes.

Every path reference below is kept as written, because it names the file
that *produced* the result being reported.

---

## ⚠️ MERGE DEFERRED — the seam waits for PRs #88 and #89

**Decision: merge this branch LAST, after the two large in-flight PRs land.**
Operator's call, and the measurement below is why.

### What was measured

The seam was trial-merged into both open PRs against the shared base
`claude/plan-completion`:

| PR | Subject | Size |
|---|---|---|
| **#88** | unified tile lighting A0–A5, shard occluders, static-query convergence | 5,122 insertions / 16 files |
| **#89** | gauntlet 5d — UI coherence | 2,849 insertions / 18 files |

**Git merges BOTH cleanly — and the merged tree does NOT typecheck.** A clean
textual merge is not the test; the type-level one is:

| PR | Missing from `Renderer` | Referenced at |
|---|---|---|
| #88 | `lastLightingMs`, `lastLightingLights` | `GameEngine.ts` ×2 |
| #89 | `damageTriggeredBars` | `GameEngine.ts` ×2, `debugControls.ts` ×2 |
| #89 | `bossBarActive` | `GameEngine.ts` ×1 |

Both PRs are green today. Merging the seam first turns whichever merges
*second* red, with errors reading `Property 'lastLightingMs' does not exist
on type 'Renderer'` — a confusing failure on work unrelated to WebGPU.

### Why "last" rather than "now"

The asymmetry decides it. The seam is **4 files and two lines of real
change** with zero behavioural risk, and rebasing it is trivial. Forcing two
large in-flight PRs to absorb an interface change is a far worse trade, and
the seam's value does not decay while it waits.

### THE REAL FINDING: this is the seam's ONGOING cost, and it is larger than
§Stage 3 represented

Stage 3 recorded that **19 of 28** interface members are debug flags and
perf counters, and framed it as a static observation about coupling. The
trial merge turns that into a measured rate:

> **In roughly one day of parallel work, TWO separate PRs each added new
> renderer fields.**

With the seam merged, every renderer feature edits **two** files instead of
one, and forgetting the second **breaks the build** rather than degrading
gracefully. That is a standing tax on the codebase's most active subsystem,
paid by every future renderer change — not a one-off.

**This should be resolved BEFORE the seam lands, not after.** Two options,
both deferred to the operator:

1. **Narrow the interface** to the 9 genuine members (7 rendering API + 2
   sim-wiring) and leave debug flags and perf counters reached through the
   concrete `RenderSystem`. The seam then covers the draw path only — which
   is the part a renderer swap actually needs — and new perf counters stop
   touching it at all.
2. **`RendererStats`** — the object the engine asks for once per frame,
   noted in Stage 3 as the obvious follow-up. Centralises the counters, but
   they still have to be declared somewhere, so it reduces the churn without
   eliminating it.

Option 1 is the cheaper answer to the problem actually measured.

### The sequence when this resumes

1. Merge **#88** and **#89**.
2. Rebase this branch onto the updated `claude/plan-completion`.
3. Decide the interface question above; if the interface stays as-is, add the
   four missing members:
   ```ts
   lastLightingMs: number;
   lastLightingLights: number;
   damageTriggeredBars: boolean;
   bossBarActive: boolean;
   ```
4. Re-run the three gates, confirm the emitted JS is still byte-identical
   (normalise the build timestamp first — see §Stage 3), and merge.

---

## Checklist

- [x] **Stage 0** — Device support (**KG1 PASSED** on iPhone / iOS 26.6)
- [x] **Stage 1** — Throwaway harness (**PASSED** on device)
- [x] **Stage 2** — Hardest primitive (**KG2 PASSED** — parity at 5× throughput)
- [x] **Stage 3** — Renderer seam (**COMPLETE** — byte-identical, 111/111)
- [~] **Stage 4** — *partial*: H4/H5 hazard probes done; `GPURenderSystem` NOT built
- [ ] **Stage 5** — Procedural shapes (**not started** — see the verdict)
- [x] **Stage 6** — **VERDICT RESOLVED (KG3)** — *the prerequisite capture was
      run: Omni is **sim-bound, not render-bound** (worst frames 88% sim, render
      <7 ms). **Keep the seam; do not build the WebGPU renderer.** See §5a*

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

## Stage 6 — THE VERDICT (KILL GATE 3)

> **RECOMMENDATION (RESOLVED): KEEP THE STAGE 3 SEAM, DO NOT BUILD THE
> WEBGPU RENDERER.** The spike proved WebGPU is *faster* (5× on the hardest
> primitive). The prerequisite device capture then showed Omni is **not
> render-bound** — its worst frames are **88% simulation**, with render
> under 7 ms. See §5a. The port would optimise the wrong 6 ms.

### 1. Device support

| | |
|---|---|
| Target | iPhone, **iOS 26.6.0**, Edge iOS 151 — WebKit, i.e. the Safari 26 engine |
| Adapter | `vendor: apple, architecture: apple`, `isFallbackAdapter: false` — a real GPU |
| Backing store | 880×1512 = 1.33 Mpx @ dpr cap 2 |
| Canvas format | `bgra8unorm` |
| `maxTextureDimension2D` | **16384** (needs 3072 → one texture, no tiling) |
| `maxVertexAttributes` / `maxVertexBuffers` / `maxBindGroups` | 30 / 12 / 11 — all ample |
| `timestamp-query` | **available**, and returns real values |

**Player exclusion: ~12% of iOS devices.** WebGPU requires iOS 26+, which is
~85% of iOS devices (plus ~3% on iOS 27). So a WebGPU-only renderer would
drop roughly **1 in 8** iOS players. **This is the single most consequential
number in the verdict**, because it means Canvas2D can never be deleted:
both renderers must be maintained in parallel, indefinitely, for the game's
most polished subsystem. Controls tested: macOS Safari 18.5 (no
`navigator.gpu`, as expected below Safari 26) and container Chromium
(SwiftShader only, behind flags).

### 2. Measured speedup — on hardware

The scene is the brief's dented rock tile: mutable polygon, ear-clipped fill,
miter-joined stroke, radial bloom, 10% re-triangulating per frame.

| Renderer | tiles sustained @60 fps | broke at | frame p95 there |
|---|---|---|---|
| Canvas2D | **500** | 750 | 27 ms |
| WebGPU | **2500** | 2750 | 20 ms |

# 5× the sustained throughput, against a required 2×.

At the 2750-tile scene: frame p50/p95 **17/18 ms**, **gpu 4.18/7.45 ms**,
cpu 5 ms, re-triangulation 1 ms p50.

**Two caveats, in opposite directions, and both matter:**

- **The 5× is a floor.** At 2750 tiles the WebGPU path is **CPU-bound, not
  GPU-bound** (5 ms cpu vs 4.18 ms gpu, GPU at a quarter of budget), and the
  harness re-uploads the *entire* geometry buffer every frame (~4.5 MB,
  ~270 MB/s) instead of the ~10% that changed. Dirty-range uploads would
  raise the ceiling.
- **Frame time could not be used as the metric.** It is vsync-locked at
  17 ms, so any renderer fitting the budget reads as exactly 17 and the
  brief's literal "≤50% of Canvas2D's frame time" gate is unfalsifiable.
  The ramp measures the same *intent* in a form vsync cannot flatten. **No
  Canvas2D-vs-WebGPU frame-time comparison in this repo should be believed
  without checking whether both sides fit in budget.**

### 3. Coverage — stated honestly

**Of the repo's 375 path sites: 0 are ported. 0%.** No `GPURenderSystem`
exists; the Canvas2D renderer is untouched and remains the only
implementation. What exists in the repo is the **seam** (3 files) and four
standalone probe pages that are not loaded by the app.

What was *demonstrated*, in harnesses, is the full technique set the port
needs:

| Demonstrated | Status |
|---|---|
| Textured quads, instanced | ✅ 2000 in 1 draw call, 4.5 ms GPU |
| Arbitrary mutable filled polygon (ear-clipped, dirty-flag) | ✅ |
| Stroked outline, miter joins, real lineWidth | ✅ |
| Radial-gradient bloom confined to a polygon | ✅ analytic, one pass |
| All 4 composite modes | ✅ single blend states |
| HUD text | ✅ Canvas2D overlay, ~0.1 ms |
| MSAA edge parity | ✅ 4×, required |

**Estimate for the remainder: 8–15 working days.** Derived from the modules,
not guessed:

| Work | Estimate |
|---|---|
| Stage 4 proper — sprites, static-tile texture, background, overlay wiring | 1–2 d |
| Stage 5 — the six shape modules (~3,500 lines: `enemyShapes` 915, `tileShapes` 1113, `dropShapes` 384, `projectileShapes` 186, `nebulaTiles` 405, `effects` 460), batched by draw order | 4–7 d |
| Integration — `RendererStats` refactor, DBG toggles, MSAA tuning, dirty-range uploads, test fixes | 2–4 d |
| Device validation across the 8 `perf/scenes.mjs` scenes + polish | 1–2 d |

Two things *reduce* the estimate and are worth knowing: **`hud.ts` (1,080
lines) is screen-space Canvas2D and is REUSED essentially verbatim on the
overlay** rather than ported, and `drawUtils`'s colour maths is
renderer-agnostic. The risk in the remainder is **volume, not novelty** —
every remaining technique is a variation on what Stage 2 already
reproduced.

**Two integration hazards found while estimating, both previously unknown:**

- **`tests/minimap.spec.ts` asserts on renderer INTERNALS** —
  `e.renderer._minimapBuffer` and `e.renderer._indicatorBuffer` (`:29`,
  `:68`). These are *not* in the Stage 3 seam, so a second renderer must
  either reproduce those buffers or the tests must be rewritten against the
  interface.
- **The HUD overlay collides with the input layer's canvas rule.**
  `tests/input.spec.ts` dispatches events via
  `document.querySelector('canvas')` (`:121`, `:1063`), which returns the
  *first* canvas in DOM order — and CLAUDE.md §8's rule is that pointer
  gestures engage game input *only when they start on the canvas*. Adding an
  overlay canvas above the game canvas changes both. `pointer-events: none`
  (used in the probe) handles event delivery, but the selector and the rule
  both need revisiting. **This is a real cost of the H5 mitigation that the
  brief's "removes H5 from the critical path" framing does not capture.**

### 4. What broke — every hazard's ACTUAL outcome

| | Predicted | **Actual** |
|---|---|---|
| **H1** Safari/iOS | *decisive risk* | **Cleared** on iOS 26.6, real GPU, all limits ample. But ~12% of iOS players excluded → dual renderers forever |
| **H2** Path rendering | *"strokes are harder than fills"* | **Cleared.** Fills, miter strokes and the bloom all reproduce at **0.37/255** mean diff. MSAA 4× **required** for edge parity |
| **H3** Draw-call explosion | *"batch one instanced draw per shape family"* | **Cleared, but the brief's rule is WRONG.** Family batching renders overlapping entities incorrectly — an earlier entity's stroke paints over a later entity's fill. **Batch by DRAW ORDER with a per-vertex kind flag**: correct *and* fewer draw calls. A depth buffer does not rescue it, because the rendering is alpha-blended and blending is order-dependent |
| **H4** Composite modes | *"not blend states; need ping-pong or stencil"* | **Cleared, and cheaper than predicted.** All four are single blend states — **provided the shader emits premultiplied alpha.** Straight alpha cannot express `source-atop` at all (a blend factor gives one multiplier; the result needs `Cs·αs·αd`) |
| **H5** Text | *"mitigation removes it from the critical path"* | **Works, ~0.1 ms** for all 14 sites. But it is not free: it collides with the input layer's canvas rule (above), and iOS stacked-canvas compositing is still unverified on device |

**The hazard that actually bit was H3, and not in the way predicted** — not
as a performance failure but as a *correctness* one, from following the
brief's own batching rule.

### 5a. ⚠️ THE PREREQUISITE WAS RUN — and it says **DO NOT PORT**

The verdict below was made conditional on one measurement: *is Omni actually
render-bound?* **That measurement has now been taken on the device, and the
answer is no.** The conditional therefore resolves to **keep the seam, do
not build the WebGPU renderer.**

Device capture, `PerfRecorder`, iPhone, tile-dense scene, difficulty 3,
77.4 s / 3923 frames, 440×756 @ rscale 2x, zoom 0.65, ~5,200 entities:

```
FPS   avg 51 · median 59 · 5%-low 20 · 1%-low 17 · min 12 · ≥55: 80%
frame avg 19.7ms · median 17.0ms · p95 49.0ms · p99 60.0ms
cost  render avg 2.36ms · sim avg 1.95ms · collisions avg 0.61ms · ui 0.00ms
```

**The tail is sim, not render, and it is not close:**

| worst frame | total | **sim** | render | other | steps |
|---|---|---|---|---|---|
| 1 | 81.0 | **71.0** | 6.0 | 4.0 | 5 |
| 2 | 73.0 | **56.0** | 7.0 | 10.0 | 5 |
| 3 | 68.0 | **59.0** | 6.0 | 3.0 | 5 |
| 4 | 68.0 | **46.0** | 6.0 | 16.0 | 5 |
| 5 | 67.0 | **55.0** | 7.0 | 5.0 | 5 |

**Sim is 88% of the worst frame. Render never exceeds 7 ms on any of them.**

The median (17.0 ms / 59 fps) is healthy; the whole problem is the tail
(p95 49 ms, 1%-low 17 fps), and the tail is simulation.

**Why `renderMs` under-reporting does not rescue the port.** `renderMs`
times CPU-side call issuing, not rasterization, so the honest read has to
allow for hidden GPU cost — which would surface in `other`. `other` is
**3–16 ms**. Even trebling render to ~18 ms for unmeasured rasterization
leaves sim's 71 ms dominant. A GPU renderer would attack the 6 ms and leave
the 71 ms untouched.

**The scene choice strengthens the conclusion rather than weakening it.**
This was a *tile-dense* scene at ~5,200 entities — the case most favourable
to a render bottleneck. If rendering were going to be the constraint
anywhere, it would be there, and it was not.

**Two observations that redirect the work:**

1. **Every worst frame reports `steps 5`** — the substep cap
   (`MAX_SUBSTEPS`). That is accumulator bunching: a long frame drains more
   substeps, which lengthens the frame. `Sim rate` and `Substep cap` are
   already DBG rows, so how much of the 71 ms is bunching versus raw
   per-step cost is one more capture away.
2. **`sim avg 1.95 ms` against `peak sim 71 ms`** — a 36× spread. This is a
   spike, not steady load, which usually means it is fixable rather than
   fundamental.

**A correction, recorded because the mistake is instructive.** This section
first claimed the capture's `tint peak 13.00 ms · 1916 total misses` was
"evicted-before-reuse thrashing" and "the plausible source of the
unexplained `peak render 40.00 ms`". **Both halves were wrong**, and the
operator caught it.

- **The eviction policy was already fixed** — gauntlet 5c **P17** changed
  the tint cache from FIFO to **LRU** (`RenderSystem.ts:480–493`), precisely
  so a working set slightly over the cap stops discarding the entries about
  to be reused. It is in the code, with the reasoning in a comment.
- **P17 also established that tinting is NOT the render spikes**, from a
  182 s capture. Attributing a render peak to it here contradicted an
  existing measurement without taking a new one.
- **Worst of all, P17's *first* finding was that this very report line used
  to assert "THRASHING" unconditionally**, and was rewritten to state the
  number and the threshold so the reader draws the conclusion. I read the
  rewritten line and asserted thrashing anyway — the exact false
  attribution the instrument had been rebuilt to prevent, one gauntlet
  later. **A number above a threshold is not a diagnosis.**

**What the number actually shows.** Not a regression: 1916 misses in 77.4 s
(24.8/s) against P17's 890 in 182.1 s (4.9/s) is a **key-space** difference,
not a policy one. P16 documented that the tint key `(sprite, tint)` spans 25
rock density tiers plus metal tiers, glass opacity bands and plastic
palettes — so a tile-dense scene legitimately holds more than 256 distinct
pairs, and a correct LRU still misses. The remaining lever, named in P16 and
deliberately not taken, is to **quantise the tint key** so the space is
bounded by design; raising the cap was rejected (256 × 128² canvases ≈ 16 MB
already, 1024 ≈ 64 MB on a phone).

At ~24.8 misses/s × ~2.4 ms that is **≈1.2 ms/frame** — about half of
`render avg 2.36 ms`, and therefore the named lever if rendering ever needs
to be cheaper. Against 71 ms sim spikes it is noise, which does not change
this section's conclusion.

*(Single scene, single session. The margin is an order of magnitude, so the
conclusion is robust — but a second capture on a different map would cost
minutes and remove the last doubt.)*

### 5. The recommendation

**Complete the port — conditional on one cheap prerequisite.**

The engineering question is settled: WebGPU reproduces Omni's hardest
drawing at parity and 5× the throughput, every hazard is cleared, and the
remaining work is volume rather than discovery. **But this spike measured a
synthetic tile scene, not Omni.** It proves WebGPU is faster; it does not
prove Omni is *render-bound*. Those are different claims, and 8–15 days
plus permanent dual-renderer maintenance should not be spent on the second
without evidence.

**The prerequisite, and it is hours not days:** a `PerfRecorder` capture on
the device across the `perf/scenes.mjs` matrix, establishing whether frames
that miss 60 fps are missing them in *render*. The brief names fill-rate as
the leading hypothesis for the unattributed device residual — **that
hypothesis is still unconfirmed**, and it is the whole business case.

- ~~**If render is the bottleneck** → complete the port.~~
- **✅ THIS IS WHAT HAPPENED — render is NOT the bottleneck** (§5a). Keep
  the seam, keep this log, and spend the 8–15 days on the sim tail the
  capture actually implicates. Re-open this branch if the answer changes —
  nothing here expires except the iOS adoption figure, and the 5× margin
  will still be there if rendering ever becomes the constraint.

**Merge policy:** merge **the Stage 3 seam only**. It is byte-identical
(proven), 111/111 green, and valuable regardless — it is the extraction any
renderer swap needs, and the coupling list in it is the real cost estimate.
The four probe pages under `public/` should be **deleted** if the port is
not pursued; they ship in `dist/` and are dead weight there.

---

## Stage 4 (PARTIAL) — hazard probes for H4 and H5

**Scope note, so this is not overclaimed: the full Stage 4 — a
`GPURenderSystem` behind the seam, URL-selectable, covering the easy 53
draw sites — was NOT built.** What was built is a targeted probe closing the
two hazards the ladder had left with *no* measured outcome. Stage 6 requires
every hazard to report an actual result rather than a predicted one, and both
of these could be settled **without touching repo code**, so they were settled
regardless of whether the port continues.

`public/webgpu-stage4.html`. Touches no game code.

### 🔴 H4 — all four composite modes ARE blend states, **but only in
premultiplied alpha**

The brief predicts `source-atop` and `destination-out` "are **not** blend
states in the general case; they need render-target ping-ponging or stencil
work." **They are both single blend states.** But the condition attached is
the real finding, because getting it wrong fails quietly:

| Canvas2D mode | uses | WebGPU blend (premultiplied source) |
|---|---|---|
| `source-over` | ×6 | src `one`, dst `one-minus-src-alpha` |
| `lighter` | ×9 | src `one`, dst `one` |
| `destination-out` | ×1 **load-bearing** | src `zero`, dst `one-minus-src-alpha` |
| `source-atop` | ×2 | src `dst-alpha`, dst `one-minus-src-alpha` |

**A shader emitting STRAIGHT alpha cannot express `source-atop` at all.** The
correct result needs `Cs·αs·αd`; a blend factor supplies exactly *one*
multiplier, so `dst-alpha` yields `Cs·αd` and silently drops the `αs`. WebGPU
has no combined src-alpha×dst-alpha factor, so **no choice of factors fixes
it** — the fragment shader must emit premultiplied colour (`rgb *= a`), which
folds `αs` in. Measured, against Canvas2D performing the identical sequence
into an offscreen surface with a real alpha channel:

| Source alpha | mean abs diff (premul) | pixels >8 |
|---|---|---|
| Straight | 2.85 / 255 | 6.20% |
| **Premultiplied** | **0.109 / 255** | **0.27%** |

The residual 0.27% is edge antialiasing — this probe deliberately runs
without MSAA, unlike Stage 2. `destination-out`, the load-bearing one
(`staticTileCache.ts:159`, the per-tile erase), reproduces exactly.

**Why the test had to render to a texture rather than to the canvas:** both
modes depend on **destination alpha**, and a canvas configured
`alphaMode: "opaque"` pins `αd` at 1 — which silently degrades `source-atop`
into `source-over` and would have "passed" for the wrong reason. The repo's
`destination-out` runs on an offscreen canvas that *does* have alpha, so the
faithful reproduction is render-to-texture with a real alpha channel.

**H4 CLEARED, and it is cheaper than predicted:** no ping-ponging, no
stencil, no extra passes. One rule: **emit premultiplied alpha everywhere.**

### H5 — the Canvas2D text overlay works, and costs ~0.1 ms

A `<canvas>` layered above the WebGPU canvas, redrawing all 14 of `hud.ts`'s
text sites plus a minimap rect every frame.

| Overlay | frame ms p50 | overlay ms p50 / p95 / max |
|---|---|---|
| ON | 16.7 | 0.1 / 0.2 / 2.8 |
| OFF | 16.7 | 0 / 0.1 / 1.2 |

**No measurable frame-time difference; ~0.1 ms of CPU for the whole HUD text
layer.** The mitigation is sound and cheap, and it removes H5 from the
critical path as the brief predicted.

**Caveat, and it is the reason this is not marked fully cleared:** the
brief's specific worry is *iOS compositing artifacts from stacked canvases* —
tearing, blur, or a compositor promotion penalty. Those are device-specific
and this measurement is from the container. **The device check is a
one-minute look**, and until it is done H5 is "works, cost measured, iOS
compositing unverified".

---

## Stage 3 — The renderer seam

**Cap: 4 hours. Scope: ≤3 files. Status: ✅ COMPLETE — 3 files, +1 new.**
**This is the first stage that touches repo code, and the only one whose
value survives abandonment.**

`engine/systems/Renderer.ts` — a **behaviour-free interface** describing
exactly what `GameEngine` needs from a renderer. `RenderSystem` implements
it unchanged; `GameEngine.renderer` is typed by it. Canvas2D remains the
only implementation and the default.

| File | Change |
|---|---|
| `engine/systems/Renderer.ts` | **new** — the interface |
| `engine/systems/RenderSystem.ts` | `implements Renderer` + one type import |
| `engine/GameEngine.ts` | field typed `Renderer` + one type import |

### The coupling, written down

The extraction is **28 members in three groups**, and the grouping is the
finding — this is the real cost estimate for *any* future renderer swap,
WebGPU or otherwise:

1. **Lifecycle + frame (7)** — `setContext`, `setMapType`,
   `setNebulaClusterCenters`, `buildStaticTileLayer`,
   `buildMinimapStaticLayer`, `render`, `worldToScreen`. The genuine
   renderer API, and the part a second implementation would expect to write.
2. **Wiring back into the sim (2)** — `setPhysics`, `setFlowField`. The
   renderer holds live references to two *simulation* systems so debug
   overlays can draw them. A real back-coupling; a second renderer must
   accept both even if it ignores them.
3. **Debug flags + perf counters (19)** — 5 mutable debug booleans written
   by `DebugControls`, plus **13 perf counters** read directly by
   `GameEngine.buildPerfSnapshot()` and the DBG panel, plus `setDebugMode` /
   `setTrailShape`.

**Group 3 is the awkward two-thirds**, and naming it is the point of doing
this stage carefully. **It is also the seam's standing cost — see the
MERGE DEFERRED section at the top, where a trial merge against two in-flight
PRs measured the rate at which new renderer fields appear.** Those are *fields*, not methods, so the interface must
expose them as mutable properties, and a second renderer has to carry all
thirteen even where they are meaningless to it — a GPU renderer has no "tint
cache miss", and `lastRenderMs` measures CPU-side call issuing, which is
precisely the measure a GPU renderer moves work *out* of (Stage 1). The
obvious next refactor is a `RendererStats` object the engine asks for once
per frame. **It is deliberately not done here**: stage 3's gate is a
byte-identical game, and reshaping the perf plumbing would fail it.

One member was deliberately **excluded**: `debugMode` is set through
`setDebugMode` and never read from outside, so putting the field in the seam
would describe a coupling that does not exist.

### Byte-identical — proven, not asserted

`implements` and type-only imports are erased at compile time, so the
emitted JavaScript should be unchanged. That is an argument, not evidence,
so it was checked by building with and without the seam and comparing.

**A control run first saved this from a false conclusion.** The naive
comparison reported "JS DIFFERS" — but two builds of *identical source* also
differ, so the comparison was meaningless. The cause is a **build timestamp
embedded in the bundle** (`build <sha> · <ISO timestamp>` in the UI): exactly
**4 bytes**, the seconds of the build clock. Normalising that timestamp:

```
with seam:    743720 bytes  md5 befed201cccf0dceb4f2792fd80efa2c
without seam: 743720 bytes  md5 befed201cccf0dceb4f2792fd80efa2c
```

**The emitted JavaScript is byte-identical.** Anything reading "this build
differs" in this repo should check the timestamp first — the bundle is not
reproducible byte-for-byte by design.

**Gates:** `npm run typecheck`, `npm run build`, `npm test` — **111/111**.
The interface typechecked against the real class on the first attempt, which
is itself evidence that it describes the existing coupling rather than an
idealised version of it.

**Effort:** ~1 h of the 4 h cap.

---

## Stage 2 — The hardest primitive (KILL GATE 2)

**Cap: 1 day. Touches no game code** — adds one standalone page under
`public/`. Status: **PASSED on the target device.** Quality parity at
0.37/255, and **5× the sustained tile count at 60 fps** against a required
2×.

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

### ✅ KG2 — **PASS** on the target device

iPhone / iOS 26.6, 880×1512 (1.33 Mpx), MSAA 4×, entity-ordered, 10% dent
churn per frame.

**Quality — three consecutive runs, and they agree:**

| run | mean abs diff (/255) | pixels >8 | max channel |
|---|---|---|---|
| 1 | 0.366 | 1.050% | 33 |
| 2 | 0.365 | 1.034% | 32 |
| 3 | 0.367 | 1.051% | 31 |

**0.37/255 (0.14%), ~1% of pixels differing, max channel 33** — and within
0.02 of the container's 0.383, so the in-container measurement transferred
to hardware essentially unchanged. Condition **met**.

**Cost — THE RAMP (tiles sustained at 60 fps):**

| Renderer | max tiles @60fps | broke at | frame p95 there |
|---|---|---|---|
| **Canvas2D** | **500** | 750 | 27 ms |
| **WebGPU** | **2500** | 2750 | 20 ms |
| *(split — both renderers per frame)* | *500* | *750* | *25 ms* |

# WebGPU sustains 5× the tiles at 60 fps.

The brief's condition is "≤ 50% of Canvas2D's cost", i.e. **2×**. The
measured margin is **5×** — not marginal, and it holds against the same
scene, on the same device, in the same page. *(The `split` row is both
renderers running each frame and is therefore bounded by Canvas2D; it
matches the Canvas2D row exactly, which is a useful consistency check
rather than a third result.)*

**The 2750-tile scene, and why the 5× is a FLOOR rather than a ceiling:**

| Metric | p50 | p95 | p99 | max |
|---|---|---|---|---|
| frame ms | 17 | 18 | 20 | 30 |
| **cpu ms** | **5** | 5 | 6 | 8 |
| **gpu ms** | **4.18** | 7.45 | 8.95 | 9.46 |
| re-triangulate ms | 1 | 2 | 2 | 5 |

At 5.5× the reference scene the WebGPU path is **CPU-bound, not GPU-bound**
— 5 ms of CPU against 4.18 ms of GPU, with the GPU using only a quarter of
the frame budget. And the harness is deliberately naive about that CPU
work: **it re-uploads the entire geometry buffer every frame**
(2750 × 102 verts × 16 B ≈ **4.5 MB/frame, ~270 MB/s**) rather than writing
only the ~10% of slots that dented. The fixed-slot layout was built to make
dirty-range uploads possible and the harness simply does not use it.

So the ceiling is higher than 5×, and the next optimisation for a real port
is **not** shader work — it is CPU-side data marshalling. Re-triangulation,
the thing the brief flagged as the dynamic-geometry hazard, costs **1 ms
p50** for 275 tiles per frame and is not the problem.

**H2's verdict: the hardest primitive is reproducible at parity and at 5×
the throughput.** Fills, miter-joined strokes and the analytic bloom all
land. Proceeding to Stage 3.

### Cost condition — how it was measured

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
| **H2 — Path rendering (375 sites)** | **CLEARED on device.** Ear-clipped fills, miter-joined stroke expansion and an analytic radial bloom match Canvas2D to **0.37/255** (~1% of pixels differing) at **5× the throughput**. MSAA 4× is REQUIRED for edge parity and is included in that result |
| **H3 — Draw-call explosion** | **Mitigation works, but the brief's rule is WRONG.** 2000 instances cost 0 ms p50 CPU in 1 draw call (Stage 1, device). However batching "one draw per SHAPE FAMILY" breaks painter's order and renders overlapping entities incorrectly — batch by DRAW ORDER with a per-vertex kind flag instead, which is both correct and fewer draw calls |
| **H4 — Composite modes** | **CLEARED, and cheaper than predicted.** All four modes the repo uses are SINGLE blend states — no ping-pong, no stencil — *provided the shader emits premultiplied alpha*. Straight alpha cannot express `source-atop` at all (a blend factor gives one multiplier; the result needs `Cs·αs·αd`). Premultiplied: 0.109/255 mean vs Canvas2D. iOS-device confirmation not yet run |
| **H5 — Text (20 sites)** | **Mitigation works and is cheap.** A Canvas2D overlay above the WebGPU canvas draws all 14 `hud.ts` text sites for **~0.1 ms p50** with no measurable frame-time cost. Remaining unknown is iOS-specific stacked-canvas compositing (tearing/blur/promotion), which needs the device |

---

## Abandoned approaches

Recorded so a future attempt does not repeat them.

- **Container-based Canvas2D-vs-WebGPU comparison** — rejected before it
  was attempted. The container's WebGPU adapter is SwiftShader (CPU) and
  its Canvas2D is software-rasterized; comparing the two measures two
  different CPU rasterizers and says nothing about a phone's GPU. The
  brief forbids it and the Stage 0 control confirms why.
