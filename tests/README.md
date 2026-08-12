# Omni test suites

Headless Playwright smokes that drive the **real engine in a real browser**.
Nothing here stubs, mocks, or reimplements the simulation: a test calls the
same public methods the React shell calls, then reads the same `EngineStats`
payload the HUD renders from. If a suite can observe it, the UI can too.

This is tiers 1–2 of the parking lot's "Automated test suite" entry (roadmap
5b, decision #46a). Tiers 3–5 — unit tests, Node sim tests, visual
regression — stay parked deliberately.

Tier 6 is no longer parked: **these suites run in CI on every pull request**
as the last gate before a merge (`.github/workflows/pr-checks.yml`, job
`typecheck · build · test`; see CLAUDE.md §7). A red run uploads the
Playwright HTML report as a run artifact — read the trace in it before
re-running, because everything here is timing-sensitive and a re-run that
happens to pass has told you nothing.

## Running

```
npx playwright install chromium   # once, per machine
npm test                          # builds, previews, runs everything
```

`npm test` is one command from a clean clone. The `webServer` block in
`playwright.config.ts` runs `npm run build` and then `vite preview` itself,
so there is no separate dev server to remember to start.

**It builds every run, and does not reuse a running server.** That costs
about ten seconds and buys something worth more: `vite preview` serves
`dist/`, and a prior session got a clean pass out of a suite that was
quietly testing week-old code. `npm test` means "test what is in the working
tree" or it means nothing.

Useful variations:

```
npx playwright test tests/economy.spec.ts     # one suite
npx playwright test -g "refold"               # one test by name
npx playwright test --headed                  # watch it happen
npx playwright show-trace test-results/…/trace.zip
```

Traces and screenshots are captured on failure only, under `test-results/`
(gitignored).

## The debug handles

`App.tsx` publishes two globals on mount, and they exist for exactly this
(CLAUDE.md §8):

| handle | what it is |
|---|---|
| `window.__omniEngine` | the live `GameEngine` instance |
| `window.__omniStats` | the most recent `EngineStats` payload |

Nothing in the game reads either one; they cost two assignments and no
per-frame work. Suites reach them through `tests/helpers.ts` rather than
`page.evaluate` directly.

Two things worth knowing:

- **`private` is a compile-time notion.** At runtime the engine's private
  fields and methods are ordinary properties, so a suite can read
  `e.runTimeSec` or call `e.physics.resolveCollision(...)`. That is
  deliberate and is what makes it possible to test the damage arithmetic in
  situ. Suites **read** internals freely; they **write** them only to set up
  a scenario (park a boss, silence its gun), never to fake the behaviour
  under test.
- **The production build minifies class names.** `e.constructor.name` is
  `'_t'`, not `'GameEngine'`. Identify things by capability, never by name.

## The suites

| file | tests | covers |
|---|---|---|
| `boot.spec.ts` | 2 | The harness's own canary: build served, bundle parsed, React mounted, engine constructed, loop running, both handles live, console clean; START reaches a run on the hub with waves off. When everything fails at once, this says whether the problem is the game or the harness. |
| `loop.spec.ts` | 3 | One continuous run through every seam — hub → earn → dock → buy → outfit → portal → waves → capstone → payout → home — asserting CONTINUITY at each one (credits, score, hull damage, slots and inventory compared byte-for-byte across the portal and across the boss kill). Plus: outfitting refused outside the drydock, the capstone landing on wave index 5, a wave ending on clear-the-field rather than on the clock, and arrival home beside the rift rather than across the hub. |
| `economy.spec.ts` | 7 | Salvage is the only thing that mints credits and score mints nothing; resale strictly loses (sell 90%, scrap 9%) so buy-then-sell can never pump; purchases land in the inventory and only ACTIVATE on adjacency; plating with no core is connected-but-contributing-nothing; the death penalty is charged exactly once; a broke pilot is zeroed rather than driven negative; spent money is untouched by the penalty. |
| `attribution.spec.ts` | 7 | **The refold** — the load-bearing suite. Parses the rendered contributor strings back into numbers, folds them the way `applyModuleEffects` folds, and requires equality with the sim, across four outfits. Includes the two DERIVED rows (the fire-rate inverse, the ship-weight drag factor) that sum wrongly if folded additively with the module rows. |
| `traits.spec.ts` | 10 | The counterplay layer: armor, front-shield, regen, evasive, and the arc shield — every damage number measured through the real projectile path. Asserts the deliberate ORDERING (armor and the plate reduce damage before the regen bucket sees it) and that the regen bucket is FIXED rather than sliding. |
| `screens.spec.ts` | 9 | Freeze semantics: death is the one full-screen overlay that leaves the world running, stage-clear freezes it, and both directions are asserted. Plus the summary snapshot, the inert wreck, all three exit paths, the 40px tap-target floor, the halted ladder, the descent rift and the depth stride. |
| `input.spec.ts` | 23 | The gamepad mapping layer and the touch joystick (step 5, Pair C). The Gamepad API cannot be synthesised headless, so the layer is split at exactly that line: `pollGamepad()` finds and reads a pad, `applyPadSnapshot()` takes a plain object a test can write. The joystick half drives **real `TouchEvent`s** dispatched at the canvas, because the whole point of it is a second finger being down at the same time and `page.touchscreen` only does single taps. |
| `help.spec.ts` | 3 | The Controls & Basics panel: reachable from both menus, identical rows in each, and it fits 390px — asserted against the document's scroll width AND every row's rect, since a fixed-basis label column beside wrapping prose is the shape that overflows sideways. |
| `minimap.spec.ts` | 6 | The minimap's material layer and the portal arrow (step 5). Nebula gone from BOTH halves (the terrain layer is proved blank on the nebula-only showcase); the material mode decides whether shards are even collected; drops excluded in every mode; the streamline cache reused across pans and rebuilt across cells. Plus the portal indicator's two brackets — range-gated far, suppressed once on screen. |
| `maps.spec.ts` | 4 | Map composition after `MAP_POPULATION` became the authority: per-variant population bands measured before and after the move, plus Seven Rings asserted exactly (its geometry is deterministic) and its ring ORDER by median radius. |

**74 tests.** All run at **390×844** — the phone this game is played on, and
the size every layout assertion is written against. Every test asserts a
clean console.

## Harness rules

These are not style preferences. Each one is a flake a previous session paid
for, recorded in `docs/GAUNTLET_PAIR_A_LOG.md` and
`docs/GAUNTLET_BOSSES_LOG.md`.

1. **Poll, never sleep.** The sim runs on a fixed timestep and this
   environment renders canvas in software, so sim-seconds elapse *slower*
   than wall-clock seconds. Every `waitForTimeout(n)` that stands in for
   "the world advanced" is a coin flip. Use `waitForStats` /
   `waitForEngine` / `advanceSim`. (`waitForTimeout` is fine for the
   opposite assertion — "wall time passed and nothing happened".)
2. **Sample peaks, not instants.** Short-lived state is gone before a naive
   read lands: a 0.12s hit-stun read 200 ms after the shot is always zero.
   `samplePeak` watches a value across a window. (It and `advanceSim` are
   provided but not used by any current suite — see their comments. Nothing
   in today's net measures a transient; both are kept so the next suite that
   does need one doesn't rediscover the flake first.)
3. **Read the sim, not the pixels**, wherever the sim exposes the same fact.
   Canvas sampling is for things that only exist as pixels.
4. **Plant your own probe.** Don't measure "the world is running" against
   whatever fauna happened to spawn — on a quiet map, *nothing moved* and
   *the sim is frozen* look identical. Plant a drop and watch it drift.
5. **Isolate from the live world.** A boss shooting near the player picks up
   splash from its own shells; a player parked inside a 92-unit hull takes
   crash damage. Park the subject, silence its gun, move the player clear.
6. **Drive the mechanism, not a proxy.** Where a value is computed by engine
   code, route through that code — fire a synthetic shell through
   `resolveCollision` rather than recomputing the damage formula in the
   test. A test that reimplements the thing it is testing asserts that the
   test agrees with itself.
7. **Duplicate the constants you assert against.** `economy.spec.ts` hard-codes
   `CREDITS_PER_DROP` rather than importing it. A test that imports the value
   it checks is asserting that a constant equals itself; hard-coding means a
   tuning change has to touch this file, which is the alarm working.
8. **Feed and read in ONE evaluation for anything queue-shaped.** The
   engine's loop drains the fire queues and the interact latch every frame,
   so injecting input in one `page.evaluate` and reading the queue in the
   next reads an empty queue — a real frame ran in between. `input.spec.ts`'s
   `feedThen` does both in one turn of the event loop. Better still, assert a
   DURABLE consequence (a spawned projectile) rather than the transient.
9. **Predicates are STRINGIFIED, so they cannot close over test state.**
   `waitForStats(page, s => s.currentWeapon !== first, …)` does not fail an
   assertion — it throws `ReferenceError` inside the page and surfaces as an
   unexplained timeout. Spell the expected value out, or pass it as an `arg`
   to `engine()`. This one cost two debugging cycles in step 5.
10. **Respect the phase machine.** A boss's traits are a function of its
   health, and `updateBosses` stamps a phase one frame after the transition.
   Poll for `bossPhase` instead of reading traits in the same breath as
   setting health.

## What is NOT covered

Stated plainly so the gap is not mistaken for a guarantee. See the
completion summary in `docs/GAUNTLET_5B_LOG.md` for the full list and the
reasoning; the headlines:

- **Only 390×844.** No desktop, no landscape, no mid-session resize.
  Parked as the viewport-coverage item, promoted into roadmap 5d.
- **Almost nothing measured by pixel-sampling the canvas** — the off-screen
  indicator legend, the size ramp, the aggro blink, the wave-banner fit, and
  every colour choice in the step-5 minimap faithfulness pass. Those were
  judged from captures, with the verdicts in
  `docs/GAUNTLET_PAIRC_POLISH_LOG.md`. The one exception is
  `minimap.spec.ts`'s nebula test, which reads the pre-rendered terrain
  canvas back: a blank canvas is the only way to prove ABSENCE from a
  pre-rendered layer.
- **Drag-and-drop outfitting.** Suites call `moveModule()` directly.
- **Balance, by construction.** These suites prove the panel agrees with
  the sim and the mechanisms behave as designed. They cannot say whether the
  numbers are any good — that is the step-6 tuning pass.
