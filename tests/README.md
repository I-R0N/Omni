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

`App.tsx` publishes these globals on mount, and they exist for exactly this
(CLAUDE.md §8).  `__omniHid` (the DualSense output-report builders) is
documented with `input.spec.ts`:

| handle | what it is |
|---|---|
| `window.__omniEngine` | the live `GameEngine` instance |
| `window.__omniStats` | the most recent `EngineStats` payload |
| `window.__omniHud` | the canvas HUD's three PURE layout functions (`fitFontPx`, `computeMinimapRect`, `computeLoadoutHUDLayout`) — same rationale as `__omniHid`: they are wrong in a way nothing reports. A banner that clips at 320px, a minimap rect that disagrees with the tap handler catching its expand tap, and a loadout strip off the viewport all fail silently, and none of them are visible at the single viewport the suites used to run at. |

Nothing in the game reads any of them; they cost one assignment each and no
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
| `boot.spec.ts` | 2 | The harness's own canary: build served, bundle parsed, React mounted, engine constructed, loop running, both handles live, console clean, and the two SHIPPED DEFAULTS a player never opts into (screen shake ON, minimap dots); START reaches a run on the hub with waves off. When everything fails at once, this says whether the problem is the game or the harness. |
| `loop.spec.ts` | 3 | One continuous run through every seam — hub → earn → dock → buy → outfit → portal → waves → capstone → payout → home — asserting CONTINUITY at each one (credits, score, hull damage, slots and inventory compared byte-for-byte across the portal and across the boss kill). Plus: outfitting refused outside the drydock, the capstone landing on wave index 5, a wave ending on clear-the-field rather than on the clock, and arrival home beside the rift rather than across the hub. |
| `economy.spec.ts` | 7 | Salvage is the only thing that mints credits and score mints nothing; resale strictly loses (sell 90%, scrap 9%) so buy-then-sell can never pump; purchases land in the inventory and only ACTIVATE on adjacency; plating with no core is connected-but-contributing-nothing; the death penalty is charged exactly once; a broke pilot is zeroed rather than driven negative; spent money is untouched by the penalty. |
| `attribution.spec.ts` | 7 | **The refold** — the load-bearing suite. Parses the rendered contributor strings back into numbers, folds them the way `applyModuleEffects` folds, and requires equality with the sim, across four outfits. Includes the two DERIVED rows (the fire-rate inverse, the ship-weight drag factor) that sum wrongly if folded additively with the module rows. |
| `traits.spec.ts` | 10 | The counterplay layer: armor, front-shield, regen, evasive, and the arc shield — every damage number measured through the real projectile path. Asserts the deliberate ORDERING (armor and the plate reduce damage before the regen bucket sees it) and that the regen bucket is FIXED rather than sliding. |
| `screens.spec.ts` | 11 | Freeze semantics: death is the one full-screen overlay that leaves the world running, stage-clear freezes it, and both directions are asserted. Plus the summary snapshot, the inert wreck, all three exit paths, the 40px tap-target floor, and the depth stride. Plus **a boss ends the ladder** (user call): waves stop the moment a boss appears and do NOT resume once it dies — the second half is asserted after dismissing the stage-clear screen and letting the arena run longer than a grace period, because that is the only moment the old behaviour showed. A fresh arena still runs its own ladder. The descent-rift assertion is INVERTED, not deleted: the rift is switched off pending a rework, so "none appears" is the behaviour, and the descent TRANSITION behind it is still tested. |
| `input.spec.ts` | 60 | The gamepad mapping layer and the touch joystick (step 5, Pair C). The Gamepad API cannot be synthesised headless, so the layer is split at exactly that line: `pollGamepad()` finds and reads a pad, `applyPadSnapshot()` takes a plain object a test can write. The joystick half drives **real `TouchEvent`s** dispatched at the canvas, because the whole point of it is a second finger being down at the same time and `page.touchscreen` only does single taps. Also the seven CONTROL SCHEMES (including both handednesses): the same touch in the same place flies the ship under one and becomes the stick under another; keyboard/controller keep touch alive while stopping the mouse from dragging; switching mid-run releases whatever the old scheme held; the ship aims where it flies under the stick; the mirrored layout puts the button clear of the minimap. Plus **`gamepad-left`**, the one-thumb scheme: the left stick (and the left D-pad) supplies heading, aim AND throttle at once while the right stick is ignored, and the gun sits on the bottom face button with the left face button still the action — each claim contrasted against the neighbouring scheme it is one flag away from, and the aim half verified non-vacuous by disabling the branch. Plus RUMBLE: the shake→effect curve, the throttle and interrupt rules, and — with a stand-in actuator, the one thing headless cannot supply — that an impact reaches the device and an unsupported browser is asked exactly once. Plus the DualSense ADAPTIVE TRIGGERS (WebHID, G12), which stop at the page boundary on purpose: no browser in CI has a pad, so what is pinned is the half that can be wrong with no symptom — a pad discards a report with a bad CRC or layout in silence, so the suite checks CRC-32 against its published vector (`0xCBF43926`) and the report SHAPE (which bytes move, and that no others do) via `window.__omniHid`. It also pins the sync (gun / charge / released-when-EMP'd) and that an unsupported browser offers no control at all. The offset test earns its keep: it pins the trigger blocks at data offsets 10/21 rather than the 11/22 most published samples quote, which are indices into a buffer that includes the report ID. Plus the FIRE POINT (an analogue read against the profile's own break, per shape, clamped so no profile strands the shot), the TRIGGER-THRUST scheme (stick steers, trigger throttles), and GAMEPAD MENU NAVIGATION — driven through the real DOM, because the driver's premise is that focus is the browser's focus and movement is geometric over whatever the panels render, so stubbing either would test something else. |
| `help.spec.ts` | 5 | The Controls & Basics panel: reachable from both menus, identical rows in each, the active scheme marked, and it fits 390px — asserted against the document's scroll width AND every row's rect, since a fixed-basis label column beside wrapping prose is the shape that overflows sideways. |
| `minimap.spec.ts` | 6 | The minimap's material layer and the portal arrow (step 5). Nebula gone from BOTH halves (the terrain layer is proved blank on the nebula-only showcase); the material mode decides whether shards are even collected; drops excluded in every mode; the streamline cache reused across pans and rebuilt across cells. Plus the portal indicator's two brackets — range-gated far, suppressed once on screen. The shipped material default is DOTS (user call), pinned here because a default is exactly what drifts unwatched. |
| `viewports.spec.ts` | 44 | **The viewport matrix** (roadmap 5d, the absorbed parking-lot item). The same handful of LAYOUT questions asked at six sizes instead of one — 320×568, 390×844, 430×932, 768×1024, 1024×768, 1440×900 — plus the case nothing covered before: a mid-session RESIZE. Per size: nothing laid out past either edge, no interactive control under the 40px floor, screen titles on one line, the two hex flowers never overlapping (they are pointer drop targets, so an overlap can take a drop meant for its neighbour), the boss bar clear of the HUD readout row with the row at its tallest, the docked station checked ON EVERY TAB (a panel that only fits while hidden is not a panel that fits) with the sticky balance still on screen at the bottom of the longest tab, and the canvas HUD's minimap, loadout and off-screen-INDICATOR rects on screen — the indicator rect additionally asserted to clear both HUD bands, which is the geometry that stops an edge arrow drawing under a chip. Plus the banner ENVELOPE: every string the game can really put in a banner — boss names read out of the sim by spawning each capstone, not from a list duplicated here — fits without reaching `fitFontPx`'s readability floor. The resize case rotates portrait → landscape → desktop → 320 → back, watching a planted probe keep drifting at every stop, because a cache keyed on canvas size that survives a resize incorrectly shows up either as a throw in the draw pass or as a world that stopped. |
| `healthbars.spec.ts` | 7 | **Damage-triggered health bars** (roadmap 5d, U5 — the parked item). A bar is a HIT REACTION now, not a permanent label, which is behaviour-visible, so what it does is pinned rather than left to a screenshot: an untouched enemy shows nothing, a real shell through `resolveCollision` arms the window, it decays and expires, a fresh hit RE-ARMS rather than accumulating. Plus the PLAYER, who is the standing exception and keeps a permanent bar under the ship ALONGSIDE the HUD chip (a later user call reversed U5's removal): both are pinned, the bar by driving the real draw call with a RECORDING context and reading the rects it asks for, and the shield strip is pinned to appear only once a Shield core is installed. Plus the shield strip on other entities — no longer player-only, and a shield-ABSORBED hit arms the bar too (which is what makes a drain watchable — the suite caught that gap and it was fixed in the engine, not the test). Plus the opt-out: the dragon keeps a permanent bar, a capstone boss deliberately does not (it has the HUD bar), and the DBG toggle restores the pre-5d always-on behaviour as an honest A/B. |
| `knockback.spec.ts` | 3 | **Projectile knockback is an impulse** (user report: NPCs launched off screen on every hit, unlike shards). `dv = damage * KICK_PER_DMG` had no mass in it, so one Cannon hit added dv 18 to a mass-4 gnat and a mass-500 dragon alike. Pinned: MASS ORDERS IT (the same shot moves a heavy body less), NOTHING IS LAUNCHED (a hit cannot shove a body past its own top speed, cap expressed in the target's own maxSpeed so it means the same across a 4x speed range), and PARITY WITH SHARDS (an NPC and a shard of equal mass end up within one order of magnitude — the specific inconsistency reported). Verified non-vacuous: all three fail with the fix reverted. |
| `shake.spec.ts` | 6 | **Screen shake follows the impact, not the speed** (user report: small shards at speed felt overpowered). The player-collision shake had no mass in it, so a chip and a wall shook identically. Three claims pinned separately because they fail independently: ORDERING (heavier impactor shakes more; a light enough one not at all), PARITY (the STATIC-body curve is unchanged, which is what makes this targeted rather than a global nerf — a "just lower the numbers" fix fails here), and DIRECTION (the axis is the shove direction, the camera's excursion along it dwarfs the off-axis jitter, and a caller with no axis still gets isotropic jitter). Plus the emergent one: a heavier SHIP shrugs the same hit off. Plus **a shot never rivals a collision**: the heaviest enemy shell shakes less than a moderate wall crash and a pellet less than the crash threshold itself, compared against LIVE body-impact numbers rather than constants copied into the test. |
| `terrain.spec.ts` | 3 | **A tile breaks the same way whatever killed it** (user report). A tile shot with a projectile shatters; a tile crushed by a drifting asteroid used to vanish, because the two asteroid kill sites never called `onDeath`. Both causes are driven through the real collision resolver and the same observable is measured either side — debris in the world where the tile was — plus the one thing that legitimately differs: a crush is nobody's kill and scores nothing. Verified NON-VACUOUS by reverting the fix and watching the crush case fail (the first draft passed without it, because the synthetic impactor is itself a mobile shard inside the debris radius). |
| `deflect.spec.ts` | 9 | **One deflection primitive, and every live shield uses it.** Bouncing a bolt off a surface existed twice — the arc shield's radial mirror and the bouncer's tile-face component flip — and both now call `PhysicsSystem.deflectProjectile`. Deflection also stopped requiring an ARC, so the player's own bubble and the bosses' pools turn shots away instead of swallowing them. Pinned as the pair of claims that generalization has to keep: THE BOLT CHANGES BUT THE ARITHMETIC DOES NOT (a deflected shot drains exactly what the absorb path would have absorbed; a shot bigger than the pool still punches through to the hull — the test that keeps this from being a stealth buff), and A SHOT THAT MAY NOT HIT YOU MAY NOT BOUNCE OFF YOU EITHER (an EMP'd shield is offline; an ally's `sparesPlayer` fire passes through). Plus the PLAYER PARRY — a bolt turned by the player's shield is re-owned to the player, stays live, kills the enemy that fired it as the player's kill, and a parried homing missile keeps homing at its new owner's targets — the `v·n` no-double-deflect rule pinned directly on the static, and the bouncer's tile bounce unchanged by the fold. Every gate verified non-vacuous by reverting it and watching the matching test fail. **And one test drives the REAL fight** — a real SHOOTER_1 spawned through the real wave path, parked OFF-AXIS, asserting every shot that reached the shield was turned away. That one exists because the other seven passed while the shipped build absorbed four shots for every one it deflected: they all handed the resolver a pair they built themselves, head-on, which proves the deflect function works and nothing about the game reaching it. |
| `flashlight.spec.ts` | 5 | **The ship's light is equipment you tap.** The player beam became a module-gated in-game tool (user call): tapping your own ship in open space cycles off/medium/high, and the tool exists only while the Light module (`flashlight_kit`) is installed and hull-adjacent — a module-less ship carries no beam at all (the DBG flashlight global now ships `off` and stays as the raw dev override under the tool). Both ON levels wear the BEAM style; what steps is the LIGHTING TIER — medium/high run the whole light system at the 'medium'/'high' rungs through the tier override, and the suite pins that `getLightTier` reads through it and falls back to 'low' at off. Also pinned: a REAL tap on the ship cycles the light and fires nothing (the claim eats the gesture); a dock in range still wins the tap; uninstalling turns the beam off with it. Gate verified non-vacuous: with it removed, the no-kit test fails. |
| `nebulaspin.spec.ts` | 3 | **A starboard pass spins a nebula shard clockwise.** The wake swirl used to sign each shard's rotation by id parity, so a pass had no consistent handedness (user report). The sign is now the DBG cycle Visual ▸ "Neb spin": `physical` (default — the ship's velocity crossed with the ship→shard offset; starboard → clockwise in this y-down world), `inverted` (the A/B), `random` (the old parity vortices, kept as the control and pinned as parity-not-geometry). Driven through the real `applyNebulaPlayerPull`. Sign verified non-vacuous: flipping the cross product fails both directional tests. Proper rotational mechanics are parked (PARKING_LOT). |
| `maps.spec.ts` | 4 | Map composition after `MAP_POPULATION` became the authority: per-variant population bands measured before and after the move, plus Seven Rings asserted exactly (its geometry is deterministic) and its ring ORDER by median radius. |
| `roll.spec.ts` | 11 | **The player ship pitches and rolls into changing acceleration, full 360°** (user request). `player.visualRoll` is a purely presentational eased angle — the renderer foreshortens the hull across its wing line by cos(roll) — so the suite pins the SIGNAL and the EASING rather than pixels: DIRECTIONALITY (lateral thrust banks, nose-line thrust flies level, left and right strafes are distinct signed banks, and the lateral axis rotates with the FACING rather than the world), CONVERGENCE (a held strafe approaches `PLAYER_ROLL_CONSTANTS.MAX_ANGLE` without overshoot; releasing settles to literal 0 — the snap that keeps the renderer on its plain-rotation path), ASYMMETRY (rolling in outruns settling out, measured as the first-tick deltas), the TURN TERM (a carve under thrust banks even with thrust locked along the nose — the aim-locked schemes' geometry, where the strafe term is zero by construction and the roll was invisible until the term was added (user report); a coasting swing stays level, and the throttle gate scales rather than switches), the PITCH half (nose-line thrust directly, the washout removed on a later user call: a held throttle HOLDS the lean, cutting it settles to literal level, reverse thrust leans the other way, pure nose-line thrust never rolls, a diagonal fires both axes, and the combined tilt VECTOR respects the authored maximum where a per-axis clamp would reach √2 of it), the two PHYSICS terms (CENTRIPETAL: a standing pivot banks at the floor while the same stick motion at full speed carves the full bank, because real bank is tan(bank) ∝ v·ω; SLIP: a powered sideways drift banks into the slide while the same drift coasting stays exactly level), the WIREFRAME HULL (the flat cube ships as the default — pinned because a default is what drifts unwatched — with the corner-up DIAMOND orientation and the sprite each one DBG step away, and a live bank driven on BOTH wireframe orientations so the clean console covers each projection and the ring-restore transform), the ROTATION-DAMPING cycle (one multiplier over both ease rates, measured as first-tick deltas at three presets, with the attack/release ratio pinned to survive), and one END-TO-END case: a real held key across live sim steps banks the ship and releasing levels it, with the clean-console assertion covering the composed tilt transform in the draw path. The unit claims drive `tickPlayerRoll` inside a single evaluate so live sim ticks cannot interleave mid-measurement. Plus the DBG feel cycle (Player ▸ "Roll feel", `PLAYER_ROLL_CYCLE`): Deep converges past the Default maximum, Off levels a held strafe out to literal 0 through the same easing, and the preset name reaches the stats payload the row renders. |

**233 tests.** CI runs them in two scopes (user call): every PR push gets the
SMOKE — `boot.spec.ts` + `loop.spec.ts` — and the FULL suite runs at the merge
seams (pushes to `main` / `claude/plan-completion`, PRs into `main`, the
`full-tests` PR label, manual dispatch). Locally the same split applies: the
touched suites per commit, the full run before a PR is called ready.
 All but `viewports.spec.ts` run at **390×844** — the phone
this game is played on, and the size every layout assertion is written
against. `viewports.spec.ts` sets its own viewport per describe block and
covers six sizes plus a mid-session resize (roadmap 5d). 390×844 remains the
DESIGN TARGET: the other five must be functional and unbroken, not designed
for, and nothing in that suite asserts how they should look. Every test
asserts a clean console.

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
   `waitForEngine` / `waitForStats` serialise the callback with `toString()`
   and re-create it inside the page, so `waitForStats(page, s => s.currentWeapon
   !== first, …)` does not fail an assertion — it throws `ReferenceError` in the
   page and surfaces as an *unexplained timeout*, which reads like a product
   bug. Spell the expected value out (`new Function('e', \`return … \${expected}\`)`),
   or pass it as an `arg` to `engine()`.

   **Two independent sessions hit this and each wrote its own rule** — step 5
   and the star-field gauntlet — costing two debugging cycles apiece before it
   was written down here. That it was rediscovered rather than read is the
   argument for this file.
10. **Respect the phase machine.** A boss's traits are a function of its
   health, and `updateBosses` stamps a phase one frame after the transition.
   Poll for `bossPhase` instead of reading traits in the same breath as
   setting health.

## What is NOT covered

Stated plainly so the gap is not mistaken for a guarantee. See the
completion summary in `docs/GAUNTLET_5B_LOG.md` for the full list and the
reasoning; the headlines:

- **Layout only, across viewports.** `viewports.spec.ts` (5d) closed the
  "only 390×844" gap for LAYOUT — six sizes and a resize. It deliberately
  does NOT re-run the behavioural suites at six sizes: behaviour is not a
  function of viewport, so that would buy a six-times-longer merge gate and
  no information. It also does not screenshot; visual regression stays
  parked.
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
