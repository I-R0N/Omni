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

## FOR-USER-REVIEW

Four items, none of them decided silently.

- **The penalty-free respawn does make the screen read soft.** Flagged as
  the brief instructed, NOT fixed.  The summary is honest about it — the
  RESPAWN sub-line says "Score, Salvage and outfit are kept" — but a
  player who dies loses only the seconds it takes to fly back, so
  "DESTROYED" is presentation over a non-event.  Everything the screen
  would need to express a penalty (gross-earned vs balance, run time,
  clears) is already on `EngineStats.runSummary`, so whatever the economy
  tuning pass (step 6, decisions #40a/#42d) rules can be shown without
  new plumbing.  **User call, not this gauntlet's.**

- **"Charged shots" was added as an eighth stat line (D12).** The brief
  names seven stats and does not mention Overcharge.  It is included
  because it is a derived capability `applyModuleEffects` produces from
  an installed module, and leaving the one capability module out of a
  panel whose job is "what is my outfit doing for me" would be the odd
  gap.  One row, no cost.  **Say the word and it comes out.**

- **"Fire cooldown" replaced the old "Fire rate" row (D13).** Fire rate
  was `×(1/cooldownMult)` — a second derived number the engine does not
  hold, which would have had to be recomputed in React (the exact thing
  the parking-lot sketch warns against).  The row now shows the engine's
  own `cooldownMult` with a "lower is faster" note.  **Wording is
  provisional** if it reads worse in play.

- **The pause menu's old "Ship Status" block was split in two.** It now
  reads `Condition` (hull / shield current-vs-max — the two pools that
  MOVE in flight) followed by the shared `Ship Status` widget (the eight
  derived stats with attribution).  The alternative was one panel mixing
  live pools with static derived values.  **Reversible in one edit** if
  the split reads as clutter on a phone.

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

**QUEUE COMPLETE.**

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

**A1 — death/run-summary screen.** Player death raises a full-screen
summary instead of silently auto-respawning: score + best combo, waves
cleared and highest wave, enemies destroyed (bosses noted), salvage
earned vs balance, run time, current map.  RESPAWN / RESTART RUN / MAIN
MENU are three EXISTING engine paths, wired not invented.  Death
SEMANTICS are untouched, per the brief's hard constraint — the penalty
question stays with the economy tuning pass.  Six run-scoped counters
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

**Scope held.** No SFX (Pair B), no controller (Pair C), no polish-batch
items, no economy or boss changes.  `docs/GAME_FEEDBACK_PLAN.md` and
`docs/PARKING_LOT.md` were not modified.  No numbers were invented: the
only magnitudes introduced are layout, and they were measured.

**13 decisions recorded below with their alternatives.  Four items are
flagged FOR-USER-REVIEW at the top of this file** — the penalty-free
respawn (flagged, not fixed, as instructed), and three presentation
judgment calls that are each one edit to reverse.

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
