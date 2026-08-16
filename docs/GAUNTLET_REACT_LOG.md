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
- [x] **Phase 2** — Attribute the cost (container only; device captures outstanding)
- [ ] **Phase 3** — **NOT STARTED — stop condition 2 reached.** The ~32 ms
      does not reproduce. Awaiting operator.

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

## Phase 2 — attribution

Container, production **profiling** build, 390×844 @ dpr 3, median of 3 runs
× 6 s each, first 500 ms discarded. `ui` is per-frame reconciliation;
`sched` is the old `lastStatsPushMs` bracket, kept as the control.

| state | HUD | ui med | ui p95 | base med | sched med | frame med | commit % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| in-play (hub) | 60 | 0.10 | 0.20 | 0.10 | 0.00 | 59.0 | 100 |
| in-play (hub) | 30 | 0.10 | 0.20 | 0.10 | 0.00 | 61.1 | 100 |
| in-play (hub) | 15 | 0.10 | 0.20 | 0.10 | 0.00 | 60.5 | 100 |
| in-play (boss) | 60 | 0.10 | 0.20 | 0.10 | 0.00 | 61.6 | 100 |
| in-play (boss) | 30 | 0.10 | 0.20 | 0.10 | 0.10 | 63.8 | 100 |
| in-play (boss) | 15 | 0.10 | 0.20 | 0.10 | 0.10 | 63.5 | 100 |
| pause menu | 60 | **0.30** | 0.40 | 0.20 | 0.10 | 59.6 | 100 |
| pause menu | 30 | 0.20 | 0.40 | 0.20 | 0.10 | 55.4 | 100 |
| pause menu | 15 | 0.20 | 0.40 | 0.20 | 0.10 | 55.5 | 100 |
| docked (Trade Hub) | 60 | **0.30** | **0.50** | 0.30 | 0.10 | 71.1 | 100 |
| docked (Trade Hub) | 30 | 0.30 | 0.50 | 0.30 | 0.10 | 68.9 | 100 |
| docked (Trade Hub) | 15 | 0.30 | 0.50 | 0.30 | 0.10 | 73.0 | 100 |
| death screen | 60 | 0.10 | 0.20 | 0.10 | 0.00 | 58.9 | 100 |
| death screen | 30 | 0.10 | 0.20 | 0.10 | 0.10 | 59.2 | 100 |
| death screen | 15 | 0.10 | 0.20 | 0.10 | 0.10 | 61.9 | 100 |

### Independent cross-check — cut React out entirely

The table above depends on the Profiler being right. This one does not use it
at all: it nulls `onStatsUpdate` (the existing `perf/capture.mjs` `react`
ablation) and reads frame time. If reconciliation were 32 ms, deleting it
would be impossible to miss.

| state | frame med | frame p95 |
| --- | ---: | ---: |
| in-play (hub) — normal | 65.6 ms | 73.0 ms |
| in-play (hub) — **React cut** | 64.2 ms | 71.3 ms |
| pause menu — normal | 57.1 ms | 60.6 ms |
| pause menu — **React cut** | 59.0 ms | 67.4 ms |

Removing React entirely moves in-play frame time by **1.4 ms (~2 %)**, and on
the pause menu it moves the *wrong way* (−1.9 ms, i.e. slower without React) —
which is the signature of a difference buried in noise. Two independent
instruments agree.

### The six questions

1. **Real per-frame reconciliation cost, in play.** **0.10 ms median /
   0.20 ms p95** (hub and boss alike; the boss capstone does not move it, the
   HUD is the same handful of chips either way). Against the 32 ms figure:
   **it does not reproduce — the gap is ~300×.** Container CPU is not phone
   CPU, but container-vs-device spreads run 2–5×, not 300×, and this container
   is already ~4× slower per frame than the device target.
2. **With each overlay up.** Pause 0.30 / 0.40 ms, docked Trade Hub 0.30 /
   0.50 ms, death 0.10 / 0.20 ms. F2's prediction is directionally right —
   the overlay trees cost **2–3× the in-play HUD** and are the most expensive
   thing React does here — but the absolute figure is still **sub-millisecond**.
   Nothing here dominates a frame.
3. **Does the HUD rate knob help?** **UNANSWERABLE IN THIS CONTAINER, and the
   reason is instructive.** Commit rate is 100 % at every rung. For the four
   overlay states that is F2 confirmed empirically — they bypass the throttle
   by construction. For in-play it is a container artifact: frame time here is
   ~60 ms (≈16 fps), so `statsPushAccum` clears even the 15 Hz period
   (66.7 ms) almost every frame. A throttle cannot engage below its own rate.
   On a device holding 60 fps, 30 Hz and 15 Hz would genuinely halve and
   quarter the in-play commit count — but against a 0.10 ms median, that is a
   0.05 ms saving. **The knob's ceiling is now known even though its effect is
   not measurable here, and the ceiling is negligible.**
4. **Where inside the tree does the time go?** **Deliberately not measured,
   and the scaffolding was not built.** Subdividing a 0.30 ms total across six
   sections yields per-section numbers at or below this Chromium's 0.1 ms
   `performance.now()` quantum — noise dressed as attribution. Doing it would
   have produced exactly the kind of confident meaningless number this
   investigation exists to eliminate. Worth revisiting only if a device
   capture puts the total somewhere worth splitting.
5. **How much would memoization buy?** `baseDuration - actualDuration` is
   **0.00 ms** at every state (0.10/0.10, 0.20/0.20, 0.30/0.30). **F4 holds:
   nothing is memoized and memoization is currently buying nothing.** The
   corollary is that the theoretical ceiling of the entire Phase 3 memoization
   programme (3a + 3b + 3c) is the ui column itself — **at most 0.1–0.3 ms**.
6. **Is the payload itself a cost?** **No, and this is measured rather than
   argued.** The `EngineStats` object literal is constructed as the ARGUMENT
   to `onStatsUpdate`, so it falls *inside* the `tStats0` bracket — i.e.
   `uiScheduleMs` is payload construction **plus** setState scheduling
   together, and it reads **0.00–0.10 ms** everywhere. The allocation
   attribution run (`perf/capture.mjs --scene hub-idle`) puts the top per-frame
   allocators at `handleEntityCollisions` (39 MB), `prepareFrameEntities`
   (30 MB), `update` (28 MB) and `rebuild` (22 MB); the stats push does not
   appear. F5's `buildPerfSnapshot()` is real and should still be moved inside
   the guard, but it is housekeeping, not a win.

---

## Superseded: early signal (retained for the record)

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

---

## VERDICT — stop condition 2

> **The ~32 ms attributed to React reconciliation does not reproduce.**

Measured at **0.10 ms median / 0.20 ms p95 in play** and **0.30 ms / 0.50 ms**
with the heaviest overlay up, by an instrument that passed a proportionality
gate, and corroborated by an ablation that removes React entirely and moves
frame time by ~2 %. The brief names this outcome explicitly: *"This is a
legitimate and valuable outcome: it means the cost was misattributed or has
since been fixed incidentally. Report it and stop — do not go looking for
something to optimize."*

**Phase 3 is therefore not started.** F1–F5 are, individually, all true as
stated — the throttle is inert, the overlays bypass it, the timer was
meaningless, nothing is memoized, and the snapshot allocates unguarded. What
is false is the premise underneath them: that these add up to 32 ms. They add
up to a fraction of one.

### What the 32 ms probably was

Not established — this needs a device and is a re-scope, not a conclusion.
The reasoning that makes it worth looking:

The 2026-08-09 capture recorded a 35 ms frame with 1 ms render + 2 ms sim. But
`renderMs` times the **CPU-side canvas call issuing**, not the rasterization
those calls queue. On an iPhone at 390×844 with dpr 3 the backing store is
~1170×2532 ≈ 3.0 Mpx, and Omni composites nebula sprites, gradients and bloom
over large areas of it. GPU/compositor time, vsync waiting, and Safari's own
frame overhead all land in the rAF delta and in **none** of the engine's
timers — which is exactly the shape of the observed residual, and the same
shape React had, which is presumably why React was the suspect.

Recommended next step, if the operator wants the residual chased: capture on
device with the new `ui` column live, and read the PerfRecorder worst-frame
table's **`other`** column (frame − render − sim − ui). That column now has an
honest `ui` subtracted from it for the first time. If `other` is still ~30 ms
with `ui` at ~0.3 ms, the answer is outside JS entirely and the next
instrument is a rasterization/fill-rate experiment (render-scale and
zoom ablations), not a React one.

---

## Caveat on all of the above

Every number here is from the **container**, which rasterizes canvas in
software. Per `perf/README.md`, levels are indicative and deltas are evidence.

React reconciliation transfers better than most container measurements — it is
pure main-thread JS with no rasterization in it — but it is still a desktop
CPU. The device captures the brief asks for (three 60 s `PerfRecorder` runs
per state on the 390×844 phone) have **not** been taken, because this session
has no iPhone. The instrument is built, validated and shipped for exactly that
purpose; taking those captures needs the operator.

The conclusion is stated at 300× margin, which is why it is stated at all. If
device captures contradict it, they win.
