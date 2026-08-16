# Gauntlet WebGPU — the renderer feasibility spike

A **feasibility spike, not a port.** The expected deliverable is a
**verdict**, not a renderer. It runs on its own branch, in parallel with
the lighting work, and merges only if it wins outright. Abandoning it is a
normal outcome and must leave `main` untouched.

> **THE QUESTION.** Should Omni's ~6,000-line immediate-mode Canvas2D
> renderer move to WebGPU? Answer with numbers, on hardware, or not at all.

Working rules for this branch:

- **Hardest-first.** Stages 0–2 touch no repo code. The first stage that
  modifies the repo is Stage 3, and it is the only stage whose value
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

- [x] **Stage 0** — Device support (KG1) — *instrument validated; **device
      result outstanding** (see "The blocking dependency")*
- [ ] **Stage 1** — Throwaway harness
- [ ] **Stage 2** — Hardest primitive (KG2)
- [ ] **Stage 3** — Renderer seam
- [ ] **Stage 4** — Sprites, static tiles, HUD overlay
- [ ] **Stage 5** — Procedural shapes
- [ ] **Stage 6** — Verdict (KG3)

---

## Stage 0 — Does the target device support WebGPU at all?

**KILL GATE 1. Cap: 1 hour. Touches no repo code.** Status: **instrument
built and validated; the decisive device reading is outstanding.**

### The instrument

`docs/webgpu-probe.html` — a single standalone file, zero dependencies,
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

### The blocking dependency

**Stage 0's gate is a statement about one specific iPhone, and I cannot
reach it from this container.** The probe is built and proven; what is
missing is a reading from the device.

This is a genuine blocker rather than something to assume past, because
the two outcomes are opposite and both are plausible:

- iPhone on **iOS 26+** → WebGPU present, KG1 passes, spike proceeds to
  Stage 1.
- iPhone on **iOS 18 or earlier** → **no WebGPU at all**, flagged or
  otherwise. KG1 fails, and the correct action is to stop and write the
  verdict, re-asking the question when the device updates.

To run it, the probe must be opened **over `https://`** — see the
secure-context note above; a LAN `http://` URL will report a false
negative. Delivery options are recorded in the handoff below.

**Effort:** ~50 min of the 1 h cap (research, probe, container control,
this write-up). Within cap.

---

## Stages 1–6

Not started. Blocked on Stage 0's device reading.

---

## Running record of hazards

Each hazard's *actual* outcome, updated as stages land. Predicted outcomes
are in the brief and are deliberately not repeated here.

| Hazard | Actual outcome so far |
|---|---|
| **H1 — Safari/iOS support** | API confirmed shipped on iOS 26+ (~88% of iOS devices). **Target-device reading outstanding** — this is the open kill gate |
| **H2 — Path rendering (375 sites)** | Confirmed unchanged: WebGPU has no path, fill, stroke, arc or gradient primitive. Untested — Stage 2 |
| **H3 — Draw-call explosion** | Untested — Stage 2/5 |
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
