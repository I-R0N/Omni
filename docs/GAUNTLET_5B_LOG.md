# Gauntlet 5b — test-harness bootstrap

Session ledger for roadmap item **5b** (decision #46a): promote the
session-scratchpad Playwright smokes into a repo `tests/` directory and add
a `typecheck` script. **Tiers 1–2 only** of the parking lot's "Automated
test suite" entry — tiers 3–6 (unit tests, Node sim tests, visual
regression, CI gating) stay parked.

Branch `claude/gauntlet-5b-harness-7i6xf0` off `claude/plan-completion`.
PR targets `claude/plan-completion`.

**The suites in this session are RE-DERIVED, not moved.** The Pair A
gauntlet's 436 assertions and the boss gauntlet's 147 lived in session
scratchpads and are gone. What survives is the two logs' *descriptions* of
what those suites covered, which is what this session builds against. The
goal is a durable CORE net over load-bearing behaviour, not a
reconstruction of every assertion — see the coverage-gap list in the
completion summary for what was deliberately left out.

---

## Milestone checklist

- [x] **H1 — scaffolding + typecheck.** `@playwright/test` pinned,
      `playwright.config.ts` with a build-then-preview `webServer`, a
      `tests/` directory with a boot smoke, `npm run typecheck` exiting 0,
      CLAUDE.md §7 + README updated in the same commit.
- [x] **H2 — core suites, re-derived.** Loop / economy / stat-attribution
      refold / boss traits / death + stage screens. 38 tests.
- [x] **H3 — stabilize + document.** 3× consecutive clean runs,
      `tests/README.md`, CLAUDE.md consistency pass, completion summary.

**QUEUE COMPLETE.**

---

## COMPLETION SUMMARY

**All three milestones complete.** `npm run build` green; `npm run
typecheck` exits 0 (from six errors on the base commit); **38 Playwright
tests across 6 suites, green on three consecutive full runs** with zero
flakes and a clean console throughout.

### What shipped

The repo's "no test runner" stance ends at tiers 1–2. Validation is now
three commands — `npm run build`, `npm run typecheck`, `npm test` — and
`npm test` is one command from a clean clone, because the config's
`webServer` block builds and previews the app itself.

| suite | tests | covers |
|---|---|---|
| `boot` | 2 | The harness's own canary — build served, engine constructed, loop running, both debug handles live; START reaches a run |
| `loop` | 3 | One continuous run through every seam (hub → earn → dock → buy → outfit → portal → waves → capstone → payout → home), asserting CONTINUITY at each; capstone placement; clear-the-field completion |
| `economy` | 7 | Salvage mints, score doesn't; resale strictly loses; purchase → inventory → adjacency activation; the death penalty charged exactly once |
| `attribution` | 7 | **The refold** — rendered contributor strings parsed, re-folded, required to equal the sim, across four outfits |
| `traits` | 10 | armor / front-shield / regen / evasive / arc shield, every number through the real projectile path; the ordering; the fixed bucket |
| `screens` | 9 | Freeze semantics both directions, the summary snapshot, three exit paths, tap targets, halted ladder, depth stride |

Nothing is stubbed anywhere: every suite drives the same public methods
the React shell drives and reads the same `EngineStats` payload the HUD
renders from.

### The type errors: six, not two

The brief predicted two known errors. There were six — `vite build` does
not type-check (esbuild strips types without checking them), so four more
had accumulated unseen. **Two of the six were stale CODE, not type
noise**, and both would have shipped a wrong payload to the UI:

- `lastStageClear` was still declared in terms of the boss shop discount
  that the module drop replaced.
- `skipWave` hand-rolls an `EngineStats` literal that had drifted from the
  real one (missing `shipWeight` / `position`).

That is the clearest possible argument for the `typecheck` script existing,
and it is why the FOR-USER-REVIEW item below is worth reading.

### What the suites are NOT

They prove the panel agrees with the sim and that the mechanisms behave as
designed. **They cannot say whether the numbers are good.** Every
provisional value — the 25% death penalty, the weight table, the boss
escort tables, the 6-wave stage length, `CREDITS_PER_DROP` — is a playtest
question owned by the step-6 tuning pass, and no assertion here rules on
any of it.

---

## Coverage deliberately NOT re-derived

The prior sessions ran 436 (Pair A) + 147 (bosses) assertions. This session
built 38 tests. That is not a reconstruction and was never meant to be —
the brief asked for a durable CORE net, and assertion counts across
differently-factored suites are not comparable anyway (one `toEqual` on a
whole slot array replaces a dozen field-by-field checks). But the gaps are
real and are listed here so nobody mistakes green for covered.

1. **Everything measured by PIXEL-SAMPLING the canvas.** The Pair A
   `smoke-ind` suite (18 assertions) classified off-screen indicators by
   hue, measured edge placement, the proximity size ramp, the aggro blink
   cycle and nearest-first buffer order. **None of it is re-derived.**
   Reason: it is the flakiest tier by a wide margin (the Pair A session
   burned real time on canvas-sampling flakiness and had to switch to
   dominant-hue histograms on a PAUSED sim), and the indicator surface is
   about to be reworked by the 5d UI gauntlet, which absorbs the portal
   off-screen-indicator decision. Re-deriving a fragile suite against a
   surface scheduled for rework is the worst trade available.
2. **Ship-select interaction** (`smoke-sel`, 18). Tap/click on the hull
   docking or entering, the tap being CLAIMED out of the fire queue, an
   off-ship tap still firing, the prompt naming the right verb per POI.
   Reason: it needs synthetic pointer events against canvas coordinates
   derived from a live camera, which is a different (and more fragile) kind
   of harness than everything else here. Worth adding; not core.
3. **The wave-banner width fit at 390px** (`fitFontPx`). The boss log
   records this as a real fix — "WARDEN DESTROYED" at the design size
   measures ~460px on a 390px phone and clips both edges. It is canvas
   text, so it falls under (1).
4. **Boss escort composition.** `smoke-boss` asserted that a capstone wave
   streams the boss's OWN `companions` rather than the ordinary weighted
   mix. This suite asserts the capstone LANDS on the right wave and that
   killing it routs the field, but not what it brings with it.
5. **The death ROUT's sparing of neutrals.** Killing a capstone kills the
   escort at full value while sparing third parties (bubbles, dragons) and
   rivals. Not covered.
6. **Drag-and-drop outfitting.** Suites call `moveModule()` directly, same
   as the prior sessions — this was already a stated gap there.
7. **`huntingPlayer` in a real run.** Already a stated Pair A gap; still
   open.
8. **Viewport coverage.** 390×844 only. No desktop, no landscape, no
   mid-session resize. Explicitly owned by roadmap 5d.
9. **Exotic roamers.** Dragon, rival, bubble, snitch lifecycles are
   untouched. They have DBG spawners, so they are cheap to add later.
10. **Boss-wave PACING and balance**, by construction — see above.

---

## FOR-USER-REVIEW

1. **`vite build` has been saying less than it appeared to.** Six type
   errors were live on the base commit, two of them stale code that would
   have shipped a wrong payload to the UI (the stage-clear screen's reward
   fields, and `skipWave`'s stats push). Nothing in the pipeline would have
   caught them — the build is green with all six present. `npm run
   typecheck` now catches this class, but only if it is actually run;
   **wiring the three gates into CI is tier 6 and remains parked**, and
   this session is a concrete argument for promoting it. Your call.
2. **The suites hard-code the constants they assert against** (e.g.
   `CREDITS_PER_DROP = 1000` in `economy.spec.ts`) rather than importing
   them. That is deliberate — a test that imports the value it checks
   asserts that a constant equals itself — but it means **the step-6 tuning
   pass will have to edit these files** when it moves economy numbers. That
   is the alarm working as intended, not breakage; flagging it so it isn't
   a surprise mid-tuning.
3. **Coverage gaps are listed above, not hidden.** The two you may care
   most about are the canvas-pixel tier (indicators, banner fit) and the
   boss escort composition. Both were deliberate skips with reasons; both
   are cheap to add if you'd rather have them now.
4. **`npm test` builds every run** (~10s overhead). Bought outright by the
   prior session's stale-`dist` false pass, but if the loop feels slow
   during development, `npx playwright test tests/<one>.spec.ts` is the
   fast path and the build cost is paid once per invocation regardless.

---

## Iteration log

### Iteration 1 — H1: scaffolding + typecheck

**Shipped**

- `@playwright/test@1.56.1` (pinned) as a dev dependency. Browsers install
  via `npx playwright install chromium` — documented in the README rather
  than wired into `postinstall`, so `npm install` stays fast for anyone who
  only wants to run the game.
- `playwright.config.ts` — one `phone-390` project at 390×844 (the size
  every layout assertion the prior gauntlets wrote was authored against),
  `workers: 1`, no retries, and a `webServer` that runs
  `npm run build && npm run preview`. Building every run is deliberate: the
  Pair A log records a **stale-`dist` false pass**, where a suite quietly
  tested week-old code. `reuseExistingServer: false` for the same reason.
- `tests/helpers.ts` — the shared harness. Thin wrappers over
  `window.__omniEngine` / `window.__omniStats`, plus the three anti-flake
  habits both prior logs paid for: poll instead of sleep (`waitForStats` /
  `waitForEngine`), sample peaks instead of instants (`samplePeak`), and
  read the sim rather than the pixels wherever the sim exposes the same
  fact.
- `tests/boot.spec.ts` — 2 tests. The harness's own canary: build served,
  bundle parsed, React mounted, engine constructed, loop running, both
  debug handles live, console clean; and START reaching a live run on the
  hub with waves off.
- `npm run typecheck` (`tsc --noEmit`) and `npm test` (`playwright test`)
  scripts; Playwright output directories gitignored.
- CLAUDE.md §7 rewritten (the stance change) and the README's validation
  note replaced, both in this commit.

**The type errors were not the two the brief predicted — there were six.**
Two were the known pair; four had accumulated since, unseen, because
`vite build` does not type-check (esbuild strips types without checking
them). Every fix is minimal and behaviour-neutral:

| site | error | fix |
|---|---|---|
| `constants.ts` `metal-shard` | `defaultOutcome` missing | added `'compose'` + a comment that it is unreachable while `bondsWith: 'none'` |
| `ShardSystem.types.ts` | `requireSizeDeltaFraction` read but never declared | declared it optional, documented as an inert lever no variant sets today |
| `GameEngine.skipWave` | `playerStats` missing `shipWeight` / `position` | added both, matching the real snapshot |
| `GameEngine.lastStageClear` | declared with the dead discount shape | retyped to the current `salvageCredits` + reward-module shape |
| `GameEngine.statBreakdown` | `base` template missing `display` | typed as `Omit<Contrib, 'display'>` — every use spreads it and supplies its own |

Two of those six are **stale code**, not type noise: `lastStageClear` was
still declared in terms of the boss shop discount that was replaced by the
module drop, and `skipWave` hand-rolls an `EngineStats` literal that drifted
from the real one. Both would have shipped a wrong payload to the UI.

**Decisions taken**

- **D1 — the boot smoke identifies the engine by CAPABILITY, not by class
  name.** The first draft asserted `e.constructor.name === 'GameEngine'` and
  failed against `'_t'`: `vite build` minifies. Asserting on a minified name
  tests the bundler, not the game. *Alternative rejected:* disabling
  minification for the test build — that would mean the suites stop testing
  the artifact that actually deploys, which is the one thing a
  build-then-preview harness exists to guarantee.
- **D2 — `requireSizeDeltaFraction` is declared, not deleted.** The reader
  in `ShardSystem` is live but no variant sets the field, so the gate is
  inert. *Alternative rejected:* deleting the reader. It is cheaper at
  runtime, but it silently removes a designed merge lever, and the comment
  next to it names the variant it was built for. Declaring the field is the
  honest read — the type drifted, the code didn't.
- **D3 — build on every test run, no `dist` reuse.** Costs ~10s per run.
  Bought outright by the prior session's stale-`dist` false pass.
- **D4 — one worker, no retries.** Retries hide flakes, and H3's bar is
  three consecutive clean runs, so a retry would defeat the milestone.
  Software canvas rendering under worker contention is where the prior
  sessions' flakes lived.

**Validation**: `npm run typecheck` exits 0 (from 6 errors). `npm run
build` green. `npm test` — 2/2 passed, console clean.

---

### Iteration 2 — H2: the five core suites

**Shipped** — `economy` (7), `attribution` (7), `screens` (9), `traits`
(10), `loop` (3). 38 tests with the boot canary, green together.

**Decisions taken**

- **D5 — the refold is asserted in the CONTRIBUTOR direction, not the
  headline direction.** Comparing the panel's headline to the sim's value
  would only prove one number was copied. Refolding the contributor rows
  proves the EXPLANATION is true — that the rows a player reads to decide
  what to buy add up to the ship they will actually fly. A panel can lie in
  two ways (wrong total, or right total with a wrong story); only the
  refold catches both. *Alternative rejected:* asserting headlines, which
  is half the work and less than half the value.
- **D6 — trait damage is measured by driving `resolveCollision` with a
  synthetic shell, not by firing across a live map.** This is the boss
  log's own recorded flake fix (#4). A shell whose flight depends on the
  map's terrain layout tests the terrain. *Alternative rejected:* firing a
  real weapon and reading the result — more "realistic", and unreliable for
  reasons that have nothing to do with the trait.
- **D7 — the boss-wave placement test is BEHAVIOURAL.** `isBossWave` is a
  module function the debug handle cannot reach, so the test starts each
  wave for real and looks for a boss on the field. That is strictly better
  anyway: calling the predicate would not prove WaveSystem consults it.
- **D8 — constants asserted against are DUPLICATED in the test, not
  imported.** A test that imports the value it checks asserts that a
  constant equals itself. Hard-coding means a tuning change has to touch
  the test file — which is the alarm working. Recorded as FOR-USER-REVIEW
  #2 so the tuning pass isn't surprised by it.
- **D9 — the loop suite climbs the ladder through the real `startWave`
  rather than `debugSpawnBoss`.** The first draft used `skipWave`, which
  only shortens the grace period between waves and silently did nothing.
  Driving `startWave` means the boss that shows up is the one the LADDER
  produced, which is the thing worth asserting.

**Six harness bugs found and fixed — all mine, none product bugs.** Worth
recording because each one would have read as a game defect:

1. `e.constructor.name` is `'_t'` — the production build minifies. Identify
   by capability, never by name.
2. Collecting a drop is `applyDropEffect(d)` **and** `d.active = false`;
   doing only the first leaves the drop live for the magnet to collect
   again, paying twice.
3. `spawnSalvageDrop` refuses to spawn past `MAX_ACTIVE_DROPS = 100`, and
   collected drops are only swept out on a later frame — so a tight collect
   loop silently stops paying at 100 units.
4. `purchaseModule` gates on the docked station's SERVICES; the default
   teleport lands at HOME (drydock only), where every purchase silently
   returns false. The helper now docks at the Trade Hub.
5. `updateExplosionRings` reads a ring's lifetime but does not advance it,
   so hand-stepping it in a tight loop leaves the wavefront pinned at radius
   0 and measures nothing. The ring must be ticked by the live loop.
6. A boss's traits are a function of its HEALTH — a Bastion at full health
   has the plate and no regen — and `updateBosses` stamps the phase one
   frame after the transition. Reading traits in the same breath as setting
   health reads the old phase. Now polled via `bossPhase`, which turns a
   race into an assertion about the phase machine.

**One flake fixed BEFORE it fired.** The "death does not freeze the sim"
test originally summed live enemy positions to detect motion. On a quiet
hub the enemy index can be empty, and "nothing moved" then reads
identically to "the sim is frozen" — a false PASS on the freeze direction
and a false FAIL on the running direction. Replaced with a planted probe: a
salvage drop parked far from the player (out of magnet range, so it is
never collected) that physics integrates every step.

**Validation**: build green, typecheck 0, 38/38 with a clean console.

---

### Iteration 3 — H3: stabilize + document

**Three consecutive full runs, 38/38 each, zero flakes.** No retries are
configured and none were used — retries would have defeated the milestone's
own bar.

**Shipped**: `tests/README.md` (how to run, how the debug handles work, the
suite map, the eight harness rules with the flake each one prevents, and an
explicit "what is NOT covered"); CLAUDE.md consistency pass (§2 directory
layout, the §8 debug-handles entry whose "without a test runner" rationale
is now superseded, §9's validation line); this completion summary with the
coverage-gap list consolidated.

**Decisions taken**

- **D10 — `advanceSim` and `samplePeak` are kept despite being unused.**
  Both are annotated as such in `helpers.ts` and in the README, so nobody
  mistakes them for load-bearing. The alternative — deleting them — means
  the next suite that needs to wait on sim time, or to catch a 0.12s
  transient, rediscovers the flake first. Twenty lines of documented,
  clearly-labelled harness utility is a cheaper way to carry that knowledge
  than a paragraph in a log nobody reads at the right moment.
- **D11 — the coverage GAP list is part of the deliverable.** A regression
  net whose limits are undocumented is worse than none, because green
  starts to mean "covered". The list above names every prior-log suite that
  was not re-derived and why.
