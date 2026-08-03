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

Seven open items.  Each one: what it is in plain terms, what I'd do, and
why.  None was decided silently; all are cheap to reverse.

---

### 1. Dying costs you nothing

**What it is.** When you die you get full hull back at the map's spawn
point and keep your score, your Salvage and your whole outfit.  The
screen says DESTROYED, but nothing was destroyed.  The beat has no
weight because the mechanic behind it has no teeth.  (This was a HARD
CONSTRAINT on the gauntlet — flag it, don't fix it — so it is unchanged.)

**Recommendation.** Leave the penalty decision to step 6 as planned, but
when you get there, the cheapest lever is already built: **stop the free
full-hull heal on respawn.**  Respawn at a fraction of max hull instead.

**Why.** Hull repair is already pay-per-HP at a station, so flying home
damaged is already an economic cost.  A free full heal on death actively
*undercuts* that service — right now dying is the cheapest way to repair
your ship, which is backwards.  Making respawn leave you damaged turns
death into a repair bill using a system that already ships, with no new
punishment mechanic, no credit confiscation and no hub teleport.  I'd
avoid the teleport option specifically: it charges the player in *travel
time*, which punishes patience rather than mistakes, and it fights the
portal loop you just finished building.

---

### 2. "Charged shots" is a stat row

**What it is.** The panel lists eight numeric stats plus one yes/no row
reading Enabled or Locked.  It's there because Overcharge is a
purchasable module, and without this row it would be the only module in
the game whose effect appears nowhere.

**Recommendation.** Keep it.

**Why.** The entire point of A2 is "every module can be traced to what it
does for me."  Deleting the row reintroduces exactly one blind spot, and
it's on a 45,000-credit purchase.  It costs one line and sits last, below
everything numeric.  If it reads oddly among the multipliers, restyle it
as a badge — that's a nicer fix than removing information.

---

### 3. "Fire cooldown ×0.84" instead of "Fire rate ×1.19"

**What it is.** Same fact, inverted.  The old panel said fire *rate*
(higher = better); the new one says fire *cooldown* (lower = better).

**Recommendation.** Go back to **Fire rate** — and I think my original
reasoning here was wrong, not just debatable.

**Why.** Every other row in the panel is "bigger is better": hull 150,
damage ×1.36, top speed ×1.24.  Fire cooldown is the sole row where the
good direction flips, which is a genuine misread risk when you're
scanning it between waves.  I originally switched it to avoid computing a
derived value in React — but that rule is satisfied by having the
**engine** publish the inverted number, which it can do trivially.  I
conflated "don't recompute in the UI" with "don't derive at all."  Revert
the wording, keep the architecture: one line in `statBreakdown()`.

---

### 4. The pause panel split into "Condition" + "Ship Status"

**What it is.** A small box with hull and shield as current-vs-max
(87 / 150), then the big box with the derived stats and their breakdowns.

**Recommendation.** Keep the split — but rename the derived row from
**Hull** to **Max hull**.

**Why.** The split itself is right: "87 / 150" answers *am I hurt*, "150"
answers *how tough did I build this ship*, and those are different
questions that shouldn't share a heading.  But right now the word "Hull"
appears in both boxes against two different numbers, which reads as a
contradiction at a glance.  Naming the derived one "Max hull" removes the
collision for free.  Same for Shield if you want symmetry.

---

### 5. Bosses lost their phase-coloured indicator

**What it is.** A boss's off-screen arrow used to be tinted by its
current phase.  Under the type legend it's the same red as any other
enemy — distinguished instead by being ~1.7× bigger and carrying the
boss's name.

**Recommendation.** Keep the shared red.

**Why.** A colour legend only works if it has no exceptions.  The moment
one enemy is a different colour, the player has to ask "is that a
different *kind* of thing, or the same thing in a different *state*?" —
which is the exact confusion the legend was introduced to kill.  Phase is
already shown twice, in both places it matters: the aura ring on the boss
hull and the phase pips on the HUD boss bar.  A third encoding, on a
12-pixel arrow, buys almost nothing and costs the legend its clarity.

---

### 6. The red blink means "hunting YOU", not "angry"

**What it is.** A bubble that a rival provoked stays purple.  It only
blinks red when *you* are its target.  Same for rivals.

**Recommendation.** Keep it scoped to the player.

**Why.** The blink is a threat warning, and its value is entirely in how
often it's wrong.  A bubble brawling with a rival is a spectacle, not a
danger — blinking for it would teach the player within one session that
the alarm doesn't mean anything.  If you want third-party fights legible,
the minimap is the surface for it, not the threat channel.

---

### 7. Guns still add to ship weight

**What it is.** Weight is now a ship attribute (`SHIP_WEIGHT.HULL_BASE` +
every mounted module), but guns kept their weights, so mounting a Cannon
still drags acceleration.  I did not remove the mechanic when moving the
model.

**Recommendation.** Keep guns contributing; put the ship-class axis in
`HULL_BASE` (which is 0 today and exists exactly for that).

**Why.** Gun weight is the only cost attached to buying a bigger gun.
Remove it and the arsenal becomes strictly additive — every upgrade is a
pure win, the "weaponless flight is +10% acceleration" option loses its
counterpart, and one of the few real trade-offs in the outfit disappears.
Ship classes give you the different-weight-ships axis you're after
without spending that one.  If you *do* want guns weightless, it's a
one-line change (drop `weight` from the gun rows in `MODULE_DEFS`).

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
