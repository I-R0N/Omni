# Gauntlet ledger — Phase 3 **Pair A** (UI): death screen + stat legibility

Roadmap step 4, Pair A of `docs/GAME_FEEDBACK_PLAN.md` — the (i)
death/completion screen plus the stat-legibility promotion
(decision #40b).  Run as a LOOPED AUTONOMOUS session under the
one-step-per-gauntlet process ruled in decision #41c.

- **Branch**: `claude/gauntlet-pair-a-772nqe`, off the tip of
  `claude/game-feedback-plan-UN3MV` (`b4b9a28`).
- **Target PR**: into `claude/game-feedback-plan-UN3MV`, not merged.
- **Scope fence**: no SFX (Pair B), no controller (Pair C), no polish
  batch, no economy or boss changes.
- **Hard constraint (A1)**: death SEMANTICS do not change.
  `respawnPlayer()` still refills at the current map's spawn and the run
  continues.  The death penalty / return-to-hub question is owned by the
  economy tuning pass (roadmap step 6, decisions #40a/#42d).  The screen
  is PRESENTATION around existing behaviour.

---

## FOR-USER-REVIEW — RESOLVED (user decisions, 2026-08-03)

All seven items ruled by the user and implemented.  The reasoning behind
each recommendation is preserved in the git history of this file
(commit `d2f7dea`); what follows is what was DECIDED and what SHIPPED.

| # | Item | Ruling | Shipped as |
|---|------|--------|-----------|
| 1 | Death costs nothing | **Charge a % of Salvage** (interim; dynamic system later) | `SALVAGE_CONSTANTS.DEATH_PENALTY_FRACTION` = **0.25**, PROVISIONAL |
| 2 | "Charged shots" row | Keep | unchanged |
| 3 | Fire cooldown vs Fire rate | **Revert to Fire rate** | headline is the inverse; a derived "Resulting cooldown" row carries the total |
| 4 | Condition / Ship Status split | Keep + rename | derived rows are "Max hull" / "Max shield"; Condition gained **Location** (map + coords) |
| 5 | Boss indicator colour | Keep shared enemy red | unchanged |
| 6 | Blink = hunting the player | Keep player-scoped | unchanged |
| 7 | Gun weight | **Weight ALL modules**, bump base speed to compensate, put weight in physics, show it in Condition | see below |

**1 — death penalty.**  Charged ONCE on the transition into
`deathPending`, so neither respawning nor restarting can double-charge,
and the summary can report the exact figure (`creditsLost` +
`creditsLostRun`).  It taxes UNSPENT credits only: money already spent on
modules is untouched, so the penalty hits hoarding rather than
investment.  25% is an INVENTED, PROVISIONAL number — meaningful without
ever wiping a run, and placeholder for step 6.

**3 — fire rate.**  Rate is `1/cooldown`, so the per-module cooldown cuts
do NOT sum in rate space.  Rather than restate modules in units they
aren't specified in, the line reuses the shape Acceleration already had:
hex rows stay as "−8% cooldown", and one derived (slot-less) "Resulting
cooldown ×0.76" row carries the total the headline inverts.

**7 — weight on every module.**  Armour is heavy, electronics are light,
and `statMks` scales weight with the mark (Mk III = 3× Mk I) exactly as
it already scales effect and price.  Because totals are now several times
larger, `DRAG_PER_WEIGHT` was HALVED (0.10 → 0.05) and `BASE_BOOST`
raised slightly (1.10 → 1.15) as the compensation the user asked for.
Measured landmarks on the resulting curve:

| loadout | weight | thrust | collision mass |
|---|---|---|---|
| stripped to nothing | 0.0 | ×1.15 | 67 |
| weaponless bare frame | 1.0 | ×1.10 | 83 |
| **lean start** (Base Hull + Blaster) | 2.0 | ×1.05 | **100** (= the old constant) |
| fully outfitted (Outfit all) | 13.9 | ×0.92 | 298 |

So the fly-light hook survives (+10% weaponless), the run starts slightly
faster than before, and a maxed ship is genuinely heavy — it leans on
Engine/Thrusters to stay nimble, which is what weighting everything is
FOR.  Weight is also PHYSICAL: `player.mass` scales with it, normalised
so the lean loadout is exactly the old `PHYSICS_CONSTANTS.PLAYER_MASS`,
which means a full outfit is ≈3× the mass and PhysicsSystem's impulse
solver lets it plow debris while a stripped hull gets shoved around.

**Numbers to watch in step 6** (all provisional, all invented here): the
25% death fraction, the per-module weight table, and the
`BASE_BOOST` / `DRAG_PER_WEIGHT` pair.

---

## Test plan

### Automated — 7 headless Playwright suites, 436 assertions

_(Final count.  The queue itself closed at 4 suites / 238 assertions; the
three suites below the rule were added by the playtest iterations that
followed — see "Post-queue playtest iterations".)_

Scratchpad scripts driving the REAL engine in a REAL browser via
`window.__omniEngine` / `window.__omniStats` (CLAUDE.md §8).  No test
runner was added to the project (§7); `npm run build` remains the gate.
All seven run at a 390×844 viewport and assert a clean console.

| suite | asserts | covers |
|---|---|---|
| `smoke-a1` | 83 | Death screen: summary fields vs engine counters, sim frozen while up, pause blocked, the salvage penalty charged EXACTLY once, the per-life salvage ledger, RESPAWN / RESTART RUN / MAIN MENU paths, a new run zeroing every counter, wave rows hidden on the hub, ≥40px tap targets |
| `smoke-a2` | 110 | Stat attribution: all 9 lines present, every contributor set REFOLDED back to the simulation's own values across 4 outfits, OFFLINE modules and core-less plating reporting zero with the reason named, Fire rate = inverse of the sim cooldown, hex→stat highlighting, the same widget in pause AND station |
| `smoke-a3` | 94 | One continuous run: earn real salvage → dock → buy → outfit → portal → fight → die → summary → respawn → pause → re-dock, with attribution refolded at 4 points and phone-scale layout measured on all three overlays |
| `smoke-ind` | 18 | Off-screen indicators, by PIXEL SAMPLING the canvas: type→colour legend classified by hue, edge placement, the proximity size ramp, the aggro blink cycle, nearest-first buffer order |
| `smoke-sel` | 18 | Ship-select interaction: tap / mouse-click on the hull docks or enters, the tap is CLAIMED out of the fire queue, an off-ship tap still fires, the prompt names the right verb per POI, no HUD pill remains |
| `smoke-stage` | 69 | Stage descent: the delayed stage-clear beat, the payload, the sim freeze, the halted ladder, the descent rift, CONTINUE, descending with hull/credits/score carried, the depth stride, and returning HOME beside the arena's own hub rift |
| `smoke-boss` | 44 | Boss waves: capstone placement (index 5, not 4) and rotation, the escort composition, the death ROUT paying points + salvage while sparing neutrals, the halt, the depth stride, and the wave-banner width fit at 390px |

The load-bearing assertion is A2's **refold**: it parses the rendered
contributor strings back into numbers, folds them the way
`applyModuleEffects` does, and requires the result to equal what the sim
is using.  That is what "matches to the digit" means here, and it is
checked mechanically rather than by eye.

### Manual — what headless cannot reach

**Feel** (no assertion can rule on these):
- Death beat: explosion → summary timing.  Does it land as a beat or an
  interruption?
- The new weight curve.  A maxed ship is ×0.92 thrust and ~3× collision
  mass — sluggish in a *good* way, or just annoying?  Does plowing
  debris feel earned?
- 25% death penalty severity.
- Indicator size ramp at real combat distances; blink rate (2.5 Hz)
  alarming vs irritating.

**Touch + legibility** (geometry is measured, readability is not):
- **Drag-and-drop outfitting** — NOT exercised by any smoke (they call
  `moveModule()` directly).  The Condition and Ship Status blocks moved
  the flowers down the page; worth a real drag on glass.
- Stat-row tap targets — only the death screen's three buttons are
  measured against the 40px floor.
- Indicator arrows in the top corners overlap the score / pause chips.
- **Indigo station vs purple bubble are adjacent hues** — they classify
  cleanly by hue in code, but that is not the same as telling them apart
  on a phone in daylight.

### Known gaps

1. **Boss indicator** — the type-legend smoke covers enemy / station /
   portal / rival / bubble, but not the boss's oversized self-labelled
   red arrow.
2. **`huntingPlayer` in a real run** — the blink test stamps the flag
   synthetically; nothing asserts `updateRivals` actually sets it.
3. **Portal label stacking** — fixed by eye from a screenshot, no
   assertion guards the regression.
4. **Only 390×844** — no desktop viewport, no landscape.  Parked as
   "Viewport coverage — test more than 390×844" in `PARKING_LOT.md`, with
   the specific size-dependent surfaces listed (banner fit, indicator
   inset, boss bar, hex flowers, minimap) and a mid-session RESIZE case
   nothing currently covers.
5. **Balance is unverified by construction.**  The suites prove the
   panel AGREES with the sim; they cannot prove the sim's numbers are
   good.  Every provisional value (25% penalty, the weight table,
   BASE_BOOST / DRAG_PER_WEIGHT, the boss escort tables, the 6-wave stage
   length) is a playtest question — enumerated for the tuning pass in
   `GAME_FEEDBACK_PLAN.md`.
6. **Boss-wave PACING is untested by construction.**  `smoke-boss` proves
   the capstone lands on the right wave with the right escort and that
   killing it routs the field; it cannot say whether a dedicated boss wave
   after five ordinary ones is the right rhythm, or whether the escort
   tables make each fight harder in the way intended.

### Durability

The seven scripts live in the SESSION SCRATCHPAD, not the repo — they die
with the session.  Committing them (e.g. under `scripts/smoke/`) is a
user call, since CLAUDE.md §7 records that this project deliberately has
no test runner.  Raised as a merge risk and parked as "Automated test
suite — investigate a real harness" in `PARKING_LOT.md`, which lays out
six tiers from "promote these smokes into the repo" up to visual
regression, and states plainly that the stance should be decided before
any tier is adopted.

---

## Milestone checklist

- [x] **A1** — Death/run-summary screen (overlay + per-run counters +
      RESPAWN / RESTART RUN / MAIN MENU actions) — commit `9fc6c6b`,
      build green, smoke **61/61**
- [x] **A2** — Stat legibility: per-module attribution on
      `EngineStats.outfitting`, full derived-stat set in the pause Ship
      Status, hex→stat highlighting — commit `33a9cdf`, build green,
      smoke **88/88** (A1 still 61/61)
- [x] **A3** — Validation + presentation pass (phone-scale DOM
      measurement, full-loop smoke, CLAUDE.md final sync) — commit
      `d97b44b`, build green, full-loop smoke **89/89**; all three suites
      green together (**238 assertions**)

**QUEUE COMPLETE** (at 238 assertions / 3 suites).

### Post-queue playtest iterations (user-directed)

The user playtested the branch after the queue closed and directed a
further batch of work on it.  Each item was implemented, built, smoked and
pushed the same way; several **deliberately override constraints from the
original brief**, which is recorded here rather than left as an
inconsistency between this log and the diff.

- [x] **Off-screen indicators** — edge-anchored, size-by-proximity,
      colour-by-TYPE legend, aggro blink, per-type budgets sorted
      nearest-first.  New `smoke-ind` suite (18).
- [x] **Weight is a SHIP attribute** — every module carries a `weight`;
      the ship's total drags thrust and scales physical mass.  Replaced
      per-gun weight attribution, so tapping a gun highlights *Ship
      weight* rather than *Acceleration*.  (The user's framing: "the
      player may get different weight ships in the future" — hence
      `SHIP_WEIGHT.HULL_BASE`, the seam for ship classes.)
- [x] **Ship-select interaction** — docking and portal entry are now
      "select your own ship" (tap / click / E), claimed out of the fire
      queue; the HUD dock and portal pills were REMOVED at the user's
      direction ("prompt on the ship is plenty").  New `smoke-sel` (18).
- [x] **Salvage death penalty** — **OVERRIDES the brief's "death
      SEMANTICS do not change" hard constraint**, on explicit user
      instruction.  `max(25% of balance, 12,500)`, clamped to holdings,
      charged exactly once on the transition into `deathPending`.  The
      summary reports it as a per-LIFE ledger (earned since the last
      death → lost → held), which the user asked for after seeing the
      run-gross figure read as the wrong question at the wreck.
- [x] **Stage descent** — the boss capstone raises a stage-clear screen
      (a PAUSE, not an end — the player is alive) after a deliberate beat,
      halts the arena's ladder, and opens an amber descent rift.
      `stageIndex` drives `WaveSystem.waveOffset` so difficulty and the
      boss rotation continue across a descent.  New `smoke-stage` (69).
- [x] **Return-portal arrival** — coming home surfaces BESIDE the hub rift
      you came out of, not at the base station across the map.
- [x] **Boss payout reworked** — the timed shop discount was REMOVED at
      the user's direction and replaced with a random MODULE dropped into
      the inventory; this also removed a buy/sell money-pump hazard.
      Payouts are reported in CREDITS, not drop counts.
- [x] **Boss waves own their own wave** — a stage is 5 ordinary waves plus
      a dedicated capstone wave (`STAGE_WAVE_COUNT`), the capstone streams
      the boss's OWN escort (`BossDef.companions`), and its death routs the
      field at full value.  Wave banners now fit the viewport.  New
      `smoke-boss` (44).
- [x] **Docs** — `AUDIO_PLAN.md` written (a ~90-cue inventory plus the
      three hard constraints AAA audio collides with: the single-file
      standalone build, the torus, and polyphony).  Five `PARKING_LOT.md`
      entries added: portal indicator behaviour, portal persistence, area
      composition + map graph, an automated test harness, and viewport
      coverage.  **This overrides the brief's "do not modify
      GAME_FEEDBACK_PLAN.md or PARKING_LOT.md"** — the user explicitly
      lifted it for both files.

---

## Per-iteration log

### Iteration 0 — grounding + ledger

Read the plan-doc roadmap step 4, the Phase 3 Pair A table, decisions
#40b (stat legibility promoted into Pair A) / #41c (one roadmap step per
gauntlet, own branch + PR into the plan branch), and the parking-lot
entry "Pause-menu stat legibility — per-module effect attribution" (the
A2 spec sketch).  Confirmed the branch is at the plan tip.  `npm install`
+ `npm run build` green at baseline (the container had no `node_modules`).
Playwright + Chromium confirmed present at
`/opt/node22/lib/node_modules/playwright` / `/opt/pw-browsers`, so the
boss gauntlet's headless-smoke approach carries over.

Surveyed the code the two milestones touch:

- **Death today**: `updatePhysics` routes `player.health <= 0` into
  `handleEntityDeath` → `startExplosion`; when `explosionTimer` runs out
  the loop calls `respawnPlayer()` directly.  There is no death state and
  no UI beat — the run just continues.
- **Sim-freeze precedent**: the `dockedAtStation` short-circuit in
  `loop()` (push stats → `draw()` → `return`) is the pattern A1 copies.
- **Run-scoped reset**: `resetAndLoadSelectedMap()` is where new per-run
  counters must be zeroed (it is deliberately the half `transitionToMap`
  skips, so counters survive a portal — which is correct for a run
  summary).
- **Existing engine paths for the actions**: `startGame()` (→ PLAYING +
  `initWaveSystem` + `seedAmbientBubbles`) and `restartGame()`
  (`resetAndLoadSelectedMap()` → MENU).  Both already wired through
  `App.tsx` (`handleStart` / `handleRestart`).
- **A2 surfaces**: `applyModuleEffects` (sums ACTIVE module effects),
  `outfittingSnapshot()` (builds `EngineStats.outfitting`), and the
  shared hex renderers at `UIOverlay` component scope
  (`renderHexGroup` / `renderInventoryHex` / `renderModuleDetail`).

---

### Iteration 1 — A1: death / run-summary screen

Implemented, built, smoked (61 assertions, 0 failures), committed
(`9fc6c6b`), pushed.

**Shape.** `deathPending` on `GameEngine` replaces the auto-respawn that
used to fire when `explosionTimer` hit 0.  The loop short-circuit is the
`dockedAtStation` branch copied verbatim (push stats → `draw()` →
`return`), plus a `break` at the top of the substep drain so the freeze
lands on the frame the wreck finished rather than a few substeps later.
`EngineStats.runSummary` is built ONLY while the flag is set, so a live
frame pays nothing.

**Counters added** (all run-scoped, reset in
`resetAndLoadSelectedMap()`, untouched by `loadMapFresh()`): `runKills`,
`runCreditsEarned`, `runTimeSec`, `runWavesCleared`, `runHighestWave`,
`runBestCombo`.  `score`, `credits` and `bossesKilled` already existed.

**One real bug the smoke caught.** `resetAndLoadSelectedMap()` did not
clear the wreck state (`isExploding` / `explosionTimer` / `active` /
`sprite`).  It never had to: before this screen existed, the auto-respawn
always cleared it before any reset could be reached.  With RESTART RUN
and MAIN MENU reachable FROM the death screen, a reset that left
`isExploding` set re-raised the death screen on the very next sim step
(the timer is already 0).  Fixed in `resetAndLoadSelectedMap()` next to
the health refill, which is where the rest of the player-state reset
lives.

**One real UI fix the smoke caught.** RESTART RUN / MAIN MENU measured
36px tall at 390×844 — under the 40px tap-target floor.  `py-2.5` →
`py-3`.

Two further smoke failures were test artifacts, not product bugs (the
seeded run clock keeps ticking through the explosion window, so the
floor assertion needed to compare against the live value; and
`runHighestWave` legitimately reads 1 immediately after a restart on an
arena, because the new run is on wave 1).  Both assertions were
corrected to state what they actually mean.

### Iteration 2 — A2: stat legibility / per-module attribution

Implemented, built, smoked (88 new assertions + the 61 A1 assertions
re-run, 0 failures), committed (`33a9cdf`), pushed.

**Shape.** `GameEngine.statBreakdown()` walks `shipSlots` / `weaponSlots`
against `activeShip` / `activeWeapon` — the identical walk
`applyModuleEffects`'s `fold` performs — and files each module's
`ModuleEffect` under the derived stat it feeds.  Published as
`EngineStats.outfitting.statLines`, built only with the rest of the
outfitting snapshot (paused OR docked).  Eight lines: hull, shield,
shield regen, damage, fire cooldown, top speed, acceleration, charged
shots.

**The invariant the smoke enforces.** Every headline `display` is read
off the player entity / the module multipliers, never recomputed.  The
smoke parses the rendered contributor strings back into numbers, refolds
them the way `applyModuleEffects` would, and asserts the result equals
what the SIM is using — across three outfits (lean start, full
`debugOutfitAll`, deliberately stranded modules).  That is what "matches
`applyModuleEffects` to the digit" means here, and it is checked
mechanically rather than by inspection.

**Two states the panel now makes explicit** instead of silently
dropping: an adjacency-OFFLINE module (struck-through amount + the
family it must touch), and shield PLATING with no shield core — whose
hex is legitimately ONLINE but whose contribution is gated to 0 by
`applyModuleEffects`.  Both were previously invisible: the player saw a
number that did not move and nothing explaining why.

**Shared, not forked.** `renderShipStatus()` joins the existing shared
hex renderers at UIOverlay component scope and is called verbatim from
the pause menu and the docked station.  The pause panel keeps a small
`Condition` block for the two pools that move in flight (hull / shield
current-vs-max), because those are live readouts rather than derived
stats and belong next to each other.

**Test-affordance added.** Read-only flowers carried no stable selector
(`data-tile` exists only on interactive flowers, being the drag
drop-target hook).  Added `data-hex="<group>:<idx>"` unconditionally —
one attribute, no behaviour change, and the drag path is untouched.

Two smoke failures on the first run were test bugs, not product bugs:
every ring hex touches the CENTRE hex, so a centre-mounted gun makes the
whole weapon flower online (the "stranded autoloader" fixture had to put
the gun on a ring hex); and refolding two 2-decimal displays can land
one ulp off the sim's own rounding, so the acceleration tolerance is
0.015 rather than 0.01.

### Iteration 3 — A3: validation + presentation pass

**Full-loop smoke (89 assertions).** One continuous run, driving the real
engine through the real paths: start on the hub → collect twelve REAL
salvage drops → dock at the Shipwright → buy a module → install it →
undock → portal to Deep Space → kill live wave enemies through the real
death path → die → assert EVERY `runSummary` field equals its engine
counter → respawn → pause → re-dock.  The stat attribution is refolded
against the simulation at four separate points along that path (after
outfitting, in the pause menu after a death+respawn, and docked again at
the end).

Two economy invariants the loop pins down, both of which would be easy to
regress later:
- Gross earned tracks the balance EXACTLY while nothing is spent, and
  stops tracking it the moment something is bought — the summary shows
  both numbers, and they are supposed to diverge.
- Credits, gross earned, outfit and the run clock all carry across a
  portal; none of them survive a RESTART RUN.

**Phone-scale measurement (390×844).** All three overlays — death
summary, pause menu, docked station — measured for `scrollWidth ≤ 390`
AND for any descendant wider than the viewport.  The pause menu was
re-measured with a stat row expanded (the tallest/widest state the new
widget can reach).  All clean.  Tap targets on the death screen's three
actions are ≥40px tall (this is what caught the 36px secondary buttons
in A1).

**One smoke bug fixed, no product bugs found.** The loop initially read
station services off the station ENTITY; they live in `STATION_VARIANTS`
and reach the UI via `EngineStats.dock.services`.  Corrected to read them
the way the UI does.

**Final suite, run together:** A1 **61/61**, A2 **88/88**, A3 **89/89** —
**238 assertions, 0 failures**, no page errors on any run.  `npm run
build` green throughout (the project's only gate; §7 — no test runner was
added).

**CLAUDE.md** synced in each milestone's own commit: §2 (UIOverlay now
lists the death screen), §3 (death semantics unchanged + the
`deathPending` freeze + the run-scoped counters), §5 (the `statLines`
attribution contract, the shared `renderShipStatus`, `data-hex`), §8
(`earnCredits` and why resale stays out of it).

---

## Completion summary

Phase 3 **Pair A** is complete: both roadmap rows — (i) death/completion
screen and stat-legibility (decision #40b) — are implemented, validated
and pushed, in three commits (one per milestone) plus ledger commits.

**The branch then went beyond Pair A.**  After the queue closed the user
playtested it and directed a further batch of work on the same branch —
indicators, ship weight, ship-select interaction, a death penalty, stage
descent, and a boss-wave rework.  Two of the brief's hard constraints were
explicitly lifted by the user in the process (death semantics may change;
the plan and parking-lot docs may be edited).  The queue's own result is
described first below; everything the playtest added is in "Beyond the
queue" and in the post-queue checklist above.

**A1 — death/run-summary screen.** Player death raises a full-screen
summary instead of silently auto-respawning: score + best combo, waves
cleared and highest wave, enemies destroyed (bosses noted), salvage
earned vs balance, run time, current map.  RESPAWN / RESTART RUN / MAIN
MENU are three EXISTING engine paths, wired not invented.  Death
SEMANTICS were untouched AS SHIPPED IN A1, per the brief's hard
constraint — the penalty question was left to the economy tuning pass.
_(Superseded post-queue: the user then asked for a salvage penalty, and
one now exists — see "Beyond the queue".)_  Six run-scoped counters
added, reset in `resetAndLoadSelectedMap()` and deliberately not in
`loadMapFresh()`, so one summary spans every map a run visited.

**A2 — per-module stat attribution.** `EngineStats.outfitting.statLines`
carries the full derived-stat set built from the same slot walk
`applyModuleEffects` folds, so the panel explains the sim's numbers
rather than deriving its own.  Rows expand to their contributors; tapping
a hex highlights every stat it feeds and lists that module's exact
amounts.  OFFLINE modules and core-less shield plating report ZERO
contribution with the missing piece named — two states that were
previously invisible.  `renderShipStatus()` is shared verbatim by the
pause menu and the docked station; nothing was forked.

**A3 — validation.** 238 headless assertions across three suites,
phone-scale DOM measurement of all three overlays, CLAUDE.md synced.

**Scope held at queue close.** No SFX (Pair B), no controller (Pair C),
no polish-batch items, no economy or boss changes; the two planning docs
untouched; no invented numbers (the only magnitudes were layout, and they
were measured).

---

### Beyond the queue (user-directed playtest work on the same branch)

Everything in this section postdates "QUEUE COMPLETE" and was directed by
the user during playtesting.  It is on this branch and in this PR.

**Constraints the user explicitly lifted.**  Two of the brief's hard
constraints no longer hold, by instruction, not by drift:

1. *"Death SEMANTICS do not change."*  Lifted — "Let's charge the player
   a percentage of their salvage on death for now."  Death now costs
   `max(25% of unspent credits, 12,500)`, clamped to holdings, charged
   once on the transition into `deathPending`.  Money already spent on
   modules is untouched: the penalty taxes hoarding, not investment.
2. *"Do not modify `GAME_FEEDBACK_PLAN.md` or `PARKING_LOT.md`."*  Lifted
   for both.  Five parking-lot entries and a plan update were requested.

**What changed, in one line each.**

- *Indicators.*  Edge-anchored arrows, size by proximity, colour by TYPE
  (not `entity.color`), aggro blink for conditionally-hostile contacts,
  per-type budgets kept nearest-first.
- *Ship weight.*  Every module has a weight; the SHIP's total drags thrust
  and scales physical mass.  Guns file under **Ship weight**, not
  Acceleration — a gun does not make the ship accelerate worse, it makes
  the ship heavier.  This replaced decision **D11** (see below).
- *Ship-select.*  Docking and portal entry are "select your own ship";
  the HUD pills were deleted.
- *Stage descent.*  A capstone kill pauses on a stage-clear screen and
  opens an amber descent rift; `stageIndex` carries difficulty and the
  boss rotation down with it.  Returning home surfaces beside the rift
  you came out of.
- *Boss payout.*  The timed shop discount is gone (it was also a buy/sell
  money pump above a 10% discount); a random module drops into the
  inventory instead, and payouts read in credits.
- *Boss waves.*  A stage is five ordinary waves plus the boss's OWN wave;
  the capstone streams its own escort and its death routs the field at
  full value.
- *Banners.*  Wave/boss banner text now fits the viewport instead of
  clipping off both edges of a 390px phone.

**Numbers WERE invented here, unlike in the queue.**  The penalty
fraction and floor, the ship-weight curve, the boss escort tables and the
6-wave stage length are all provisional balance values.  They are
enumerated as tuning metrics in `GAME_FEEDBACK_PLAN.md` rather than left
implicit in the diff.

**13 decisions recorded below with their alternatives** (D11 superseded
by the ship-weight change).  **The four FOR-USER-REVIEW items at the top
of this file are all RESOLVED** — item 1 (penalty-free respawn) by the
penalty above; the three presentation calls by the user concurring.

---

## Decisions taken

_(Each entry: what was chosen, the alternatives, and why.)_

- **D0 — ledger created before any code.** Alternative: log at the end
  of each milestone only.  Chosen because the loop re-grounds from this
  file every iteration, so it has to exist from iteration 0.

- **D1 — the death screen is a FLAG on the engine, not a `GameState`.**
  Alternatives: (a) a new `GameState.DEAD`, (b) reuse `PAUSED`.  Chose a
  flag because `dockedAtStation` already established exactly this
  pattern for "full-screen React overlay over a frozen sim while
  `gameState` stays PLAYING", and every `gameState === PLAYING` check in
  UIOverlay and the engine would have needed auditing under (a).  (b)
  would have collided with the pause menu's own overlay.
  `pauseGame()` is now a no-op while dead, mirroring the docked guard.

- **D2 — RESPAWN is byte-for-byte the old auto-respawn.** Per the
  brief's hard constraint.  `respawnFromDeath()` clears the flag, calls
  the unchanged `respawnPlayer()`, and resets `lastTime` /
  `simAccumulator` exactly as `resumeGame()` does after a pause.  No
  credit loss, no drop loss, no hub teleport.

- **D3 — RESTART RUN goes straight back into play, not via the menu.**
  Alternative: reuse `restartGame()` for both secondary buttons (it
  resets and lands on MENU), making RESTART RUN and MAIN MENU identical.
  Chose `resetAndLoadSelectedMap()` + `startGame()` — which IS the main
  menu's START path, just without the round trip — because two buttons
  that do the same thing is worse than composing two existing calls.
  MAIN MENU remains `restartGame()` verbatim.

- **D4 — the run clock counts SIM seconds, not wall clock.**
  Alternative: stamp `performance.now()` at run start and subtract.
  Chose accumulating `dt` in `updateGameLogic` because all three freeze
  states (paused, docked, dead) already stop the sim, so time spent in
  menus is excluded with no extra bookkeeping — and it cannot drift from
  the simulation the score was earned in.

- **D5 — "Salvage earned" counts income only; resale does not feed it.**
  Alternative: count every `credits +=`.  Rejected: sell-back and scrap
  refund money that was already counted when the salvage was collected,
  so the gross figure would inflate every time a player churned modules.
  Introduced `earnCredits()` so the two collection paths are the single
  place the counter can be fed; the DBG grant stays out too.  This is
  why the screen shows gross earned AND current balance — they diverge
  on purpose once the player has spent or repaired.

- **D6 — kills counts PLAYER kills, and bosses are reported alongside.**
  The counter increments in the one `handleEntityDeath` branch that
  already filters `killedByRival`, so the number always matches the
  points the player was actually paid — a rival stealing a kill steals
  it from the summary too.  `bossesKilled` (which already existed) is
  shown as a note on the same row rather than as a separate row, since
  a boss is an ordinary counted enemy and is therefore already inside
  the kill total.

- **D7 — waves are reported as "cleared (total)" + "high (best)".**
  Wave progress is fresh per portal entry (`WaveSystem.init` zeroes
  `waveIndex`), so a single "wave reached" number would be a lie for any
  run that used a portal.  Total clears across the run answers "how much
  did I do"; the high-water mark answers "how far did I get".  Both rows
  are hidden entirely when the run died on the wave-free hub, rather
  than reported as zero.

- **D9 — the breakdown is BUILT BY THE ENGINE, including its display
  strings.** Alternatives: (a) publish raw numbers and format in React,
  (b) publish the raw slot arrays and let React fold them.  (b) is what
  the parking-lot entry explicitly warns against (recomputing derived
  stats in the UI, which can then disagree with the sim).  (a) is
  defensible but each stat has its own unit (flat HP vs fraction vs
  multiplier vs boolean capability), so the format table would have had
  to be duplicated per stat in React anyway.  Formatting in the engine
  keeps ONE source of truth and matches how `enemyScaleInfo` and the
  module `desc` strings already work.

- **D10 — a contributor's `active` means "counted in the total", not
  "the hex is online".** These differ in exactly one case today: shield
  plating on a hull-adjacent hex with no shield core.  The hex is
  online; the contribution is zero.  Alternative: add a second boolean.
  Rejected as a field for one case — the UI question is always "is this
  amount in the number above", and `requires` already carries the
  because-clause ('shield core' rather than a module family).  The
  divergence is documented on the type.

- **D11 — weapon-weight drag is ONE derived row, not per-gun shares.**
  **SUPERSEDED post-queue** by the user's call that weight is a SHIP
  attribute: every module now carries a weight, the drag row is
  multiplicative over the ship's TOTAL weight, and guns file under *Ship
  weight* instead of *Acceleration*.  The slot-less derived-row shape D11
  chose is what made that a small change, so the reasoning below still
  holds — only the set of contributors widened.
  The formula is `BASE_BOOST / (1 + DRAG × Σweight)` — multiplicative
  over the whole mounted set, so any per-gun split would be an invented
  attribution.  Alternatives: (a) split the drag evenly, (b) marginal
  attribution (each gun's effect given the others), (c) omit guns from
  the stat entirely.  (a) and (b) both print numbers that do not
  reconstruct the total; (c) breaks the "tap a hex, see what it feeds"
  requirement for guns.  Chose: guns appear as WEIGHT rows (so they
  highlight Acceleration and their weight is visible), plus one
  slot-less row carrying the factor those weights add up to.  The
  slot-less shape is generic — any future non-module term lands the same
  way.

- **D12 — "Charged shots" is included as a stat line.** The brief lists
  seven stats and does not mention overcharge.  Included anyway because
  it is a derived player capability produced by `applyModuleEffects`
  from an installed module, and the panel's whole job is "what is my
  outfit doing for me" — leaving the one capability module unexplained
  would be the odd gap.  It is one row and costs nothing.  Flagging it
  as a scope judgment call rather than deciding silently.

- **D13 — "Fire cooldown", not "Fire rate".** The old panel showed fire
  rate as `×(1/cooldownMult)`, which is a SECOND derived number the
  engine does not hold.  The brief says fire cooldown; showing the
  engine's actual `cooldownMult` keeps the render-don't-recompute rule
  intact, and the row carries a "lower is faster" note so the direction
  reads.  Provisional if the wording tests badly with the user.

- **D8 — no new numbers were invented.** Nothing in A1 is a balance
  knob; the only magnitudes are layout (max-w-sm, py-3 tap targets) and
  they are measured, not guessed.
