# Gauntlet — the unmeasured frame: React reconciliation cost

Diagnosis-first investigation into the ~32 ms of unaccounted frame time
recorded by the 2026-08-09 hardware capture (`constants.ts:1383–1385`,
Ring World, iPhone, 390×844) and attributed to React reconciliation.

> **PREMISE.** The existing instrumentation reports a number that cannot be
> correct. A fix applied against bad instrumentation would be scored against
> the same bad instrumentation. **Nothing is fixed until the instrument
> validates itself.**

Working rules for this branch:

- **Levels vs deltas.** `perf/` runs in a container that rasterizes canvas in
  SOFTWARE (`perf/README.md`), so frame-time levels here are not the device's.
  React reconciliation, unlike canvas, is pure main-thread JS — its levels
  transfer far better than `renderMs` does — but it is still a desktop
  container's CPU, not a phone's. Every container number below is labelled.
- Every measurement is reported as **median and p95**, never a single frame.
- Every hypothesis carries a verdict, **including the refuted ones**.
- Three gates green (`npm run typecheck`, `npm run build`, `npm test`)
  before every commit.

---

## Checklist

- [x] **Phase 1** — Build an instrument that can see the cost (gate passed)
- [ ] **Phase 2** — Attribute the cost (blocked: needs device captures)
- [ ] **Phase 3** — Propose, then fix in gated order (not started)

---

## Phase 1 — the instrument

### Why no existing timer could see this

`GameEngine.onStatsUpdate` is a `setState` called from inside a
`requestAnimationFrame` callback. React 18/19 **batches** that update and
performs the reconciliation **after the callback returns**. So a timer
bracketing the `onStatsUpdate` call closes before any of the work it was
captioned as measuring has begun. This is F3, and it is confirmed below.

Chrome DevTools and the React DevTools Profiler are both out of reach on the
target device (an iPhone runs Safari; remote inspection needs macOS Safari Web
Inspector and cannot feed this repo's capture harness). React's own
`<Profiler>` component was used instead — it is part of React proper, needs no
devtools attached, and matches the repo's existing on-device `PerfRecorder`
philosophy.

### What was built

| File | Change |
| --- | --- |
| `App.tsx` | `<Profiler id="ui">` wrapped around `<UIOverlay>`; `onRender` writes **plain engine fields** via `noteUiRender()` — never a `setState`, or the instrument becomes its own load. |
| `engine/GameEngine.ts` | `noteUiRender()` + per-frame consume-and-reset accumulators; the four new figures folded into `buildPerfSnapshot()`; `lastStatsPushMs` renamed and re-captioned (see F3). |
| `types.ts` | `uiActualMs`, `uiBaseMs`, `uiCommits`, `uiScheduleMs`, `uiProfiled` on `PerfSnapshot`. |
| `vite.config.ts` | **Scope overrun — one file beyond the stated cap of 3.** See "The build that strips the instrument" below; without it the instrument reads exactly 0 in any production build and the whole exercise fails silently. |
| `perf/uiprobe.mjs` | Phase 1/2 measurement scaffolding (new file, not app code; to be deleted). |

Two design points worth keeping:

- **Consume-and-reset, not sticky-last-value.** A frame that committed
  nothing records `0`, not a repeat of the previous commit's cost. At a
  throttled HUD rate most frames genuinely commit nothing, and a sticky value
  would silently multiply the reported cost by the throttle ratio.
- **One frame of lag, on purpose and documented.** React commits after the
  rAF callback that scheduled the work, so the engine consumes the figures at
  the top of the *following* frame. Fine for the distributions this is read as
  (median / p95); wrong for "which single frame owned this". Noted in
  `types.ts` so it cannot be misread later.

### The build that strips the instrument

The first production-build run reported `onRender` firing **zero times**.
This is the assignment's anticipated fail branch, and the diagnosis is exact:
React's shipping `react-dom` build **compiles the profiler timers out**.
`react-dom/profiling` (present in React 19.2.3, exports `createRoot`) is the
production build with them kept.

Resolution: an **opt-in alias** in `vite.config.ts`, so the shipping bundle is
byte-for-byte unaffected and a measurement build is one env var —
the same pattern the repo already uses for allocation attribution
(`vite build --minify false`):

    OMNI_PROFILE_REACT=1 npx vite build

This is the single most dangerous failure mode in this whole investigation,
because **a stripped profiler reads 0.00 ms, which is indistinguishable from
"reconciliation is free"** — precisely the trap the brief exists to escape.
So `PerfSnapshot.uiProfiled` was added: it is `false` in a normal build, and
any consumer quoting a ui figure must report it alongside. A zero is now
readable as either "measured, and cheap" or "not measured at all".

### Gate — self-validation against a deliberately expensive component

A ballast component (N throwaway spans) was temporarily mounted inside the
profiled tree and swept. Container, production **profiling** build,
390×844 @ dpr 3, median of 3 runs × 6 s each, first 500 ms discarded.

| ballast | ui median | ui p95 | base median | **sched median** (control) | frame median |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 0.10 ms | 0.20 ms | 0.10 ms | 0.00 ms | 58.8 ms |
| 250 | 0.20 ms | 0.40 ms | 0.20 ms | 0.10 ms | 63.4 ms |
| 1 000 | 0.50 ms | 0.70 ms | 0.30 ms | 0.10 ms | 61.2 ms |
| 4 000 | 1.50 ms | 1.90 ms | 1.10 ms | 0.00 ms | 63.0 ms |

**Marginal cost per 1 000 ballast nodes: 0.40 / 0.40 / 0.35 ms** — flat across
a 16× sweep. The response is linear in the size of the tree.

**VERDICT: GATE PASSED**, with one honest qualification.

- *Proportionality* — passes decisively (15× swing, constant marginal cost).
- *"Frame time moves with it"* — **not resolvable in this container.** Frame
  time sits at ~59–63 ms (≈16 fps) because of the software rasterizer, so a
  1.4 ms UI delta is ~2 % of a frame and the response (58.8 → 63.0 ms) is not
  monotonic across the sweep. It moves in the right direction and by roughly
  the right magnitude, but this half of the gate needs the device to be called
  cleanly. Recorded rather than glossed.

### Timer resolution floor

`performance.now()` in this Chromium is quantised to **0.1 ms**. Individual
commits in play land at 0.1–0.4 ms, i.e. within a few ticks of the floor, so
single-frame ui values are coarse. Medians and p95s over thousands of frames
remain sound; do not read one frame's `uiActualMs`.

---

## Findings — verdicts

### F1 — The HUD throttle is inert at default settings. **CONFIRMED**

`HUD_RATE_CYCLE = [60, 30, 15]` (`constants.ts:1391`) with
`activeHudRateIndex = 0` → `hudPeriod = 1/60`. At 60 fps `statsPushAccum`
reaches it every frame, so `pushStats` is true every frame. The constant's own
comment says this is deliberate ("60 is index 0 and stays the default, so the
shipping path is unchanged until someone chooses"). Confirmed by reading; the
throttle never engages on the shipped default. Commit rate measured at 100 %
of frames in the gate runs above.

### F2 — The throttle is bypassed where the tree is largest. **CONFIRMED (by construction)**

`GameEngine.ts:1488–1490`: `pushStats = overlayUp || statsPushAccum >= hudPeriod`.
`overlayUp` covers pause, docked station, death and stage-clear — the screens
that mount the two hex flowers, the 12-tile inventory honeycomb, the debug
rows and `statBreakdown` output. Those push unconditionally every frame at any
HUD rate. The code path is unambiguous; the *cost* of it is a Phase 2
measurement and is not yet taken.

### F3 — `lastStatsPushMs` cannot measure what it was added to measure. **CONFIRMED**

The highest-priority finding, and it holds. Measured directly: while ballast
drove `uiActualMs` from 0.10 → 1.50 ms (**15×**), the setState bracket
(`sched`) stayed pinned at **0.00–0.10 ms** and showed no trend. In the
in-play dev-build spot check the gap was starker still: **4.5 ms of real
reconciliation reported as 0.1 ms** — a ~45× understatement.

The number was not merely imprecise; it was **structurally incapable** of
containing the work, and it was feeding the `ui` column of every PerfRecorder
report in the repo's history. That is why those captures showed a ui cost of
~0 alongside an unexplained `other` residual.

**Disposition: relabelled, not deleted.** It measures `setState` scheduling,
which is a real if small cost, and it is now the *control* that demonstrates
the batching claim — it should stay near zero while `uiActualMs` moves.
Renamed `lastStatsScheduleMs`, re-commented at the definition and the
assignment, and surfaced as `PerfSnapshot.uiScheduleMs` with an explicit "do
not read this as the React cost" caption. The PerfRecorder `ui` column is now
fed the profiler's `uiActualMs` instead — which also means **every historical
`ui avg` figure in this repo's captures should be read as ~0 and disregarded.**

### F4 — There is no memoization anywhere in the UI layer. **CONFIRMED**

`grep` for `React.memo` / `useMemo` / `useCallback` across `App.tsx` (662
lines), `components/UIOverlay.tsx` (2 498 lines) and `components/menuNav.ts`
returns **zero matches**. Corroborated by the instrument: `baseDuration` and
`actualDuration` are equal to the timer's resolution at every ballast level
(0.10/0.10, 0.20/0.20, and 1.50/1.10 at the top of the sweep, where base runs
slightly *below* actual — base excludes commit-phase overhead that actual
includes). Memoization is currently buying ≈ 0 ms, exactly as predicted.

The consequence stands and is worth restating for Phase 3: **`React.memo(UIOverlay)`
alone would be completely inert.** Every handler prop is a fresh arrow
function per render, and `stats` is a new object every frame, so props never
compare equal. Prop stabilization is a prerequisite, not an optimization.

### F5 — Unconditional per-frame allocation. **CONFIRMED, not yet fixed**

`buildPerfSnapshot()` is called at `GameEngine.ts:1492`, outside the
`if (pushStats)` guard, building a ~25-field object (plus a fresh
`perfTasks` array) every frame regardless of consumption. Deliberately left
in place — it is Phase 3e, and Phase 1 applies no fixes.

---

## Early signal (NOT a conclusion)

In-play container measurement puts reconciliation at **~0.1 ms median /
0.2 ms p95 per frame** with the HUD alone mounted. That is three orders of
magnitude below the 32 ms the 2026-08-09 capture attributed here, which points
toward **stop condition 2 (the cost does not reproduce)**.

It is deliberately **not** recorded as a verdict yet, for three reasons:

1. Container CPU is not phone CPU, and a thermally-throttled iPhone is the
   machine the original capture came from.
2. In play, most of `UIOverlay` is **unmounted** — the menus, station panels,
   hex flowers and debug rows that F2 identifies as the heavy trees are not in
   the tree at all. The original capture's conditions (what was on screen) are
   not recorded.
3. Phase 2's overlay states have not been measured.

---

## Blocker

Phase 2's pass gate requires device captures ("median and p95 number attached,
from device captures, not container runs"). This session has no iPhone — only
the software-rasterizing container. Phase 2 is therefore **paused pending the
operator**, with the instrument built, validated and ready to capture.
