# Follow-up block — launch prompts (S7 to S11)

Written by the PM session, 2026-10-10.  These are the prompts to paste into
fresh Claude Code sessions.  The design behind them is in
`docs/ENGINE_CORE_PLAN.md`: the briefs are §4 ("The follow-up block"), the branch
rules are §5 ("The follow-up block's branch"), the order is §6, and the decisions
are D40 and D41.  A prompt is a launcher: it carries the setup commands and the
user's own words verbatim and points at the plan for everything else, so it
cannot drift from the briefs.

## Order, in one picture

```
 wave 1   S9 Enemy AI      ‖   S7 Menus & navigation
            │ both merged into claude/s3-followup-docs, one at a time, ≥ 30 min apart
 wave 2   S8 Rotation      ‖   S10 Trails
            │
 wave 3   S11 Maps
            │
          the PM opens ONE PR: claude/s3-followup-docs  →  claude/steam-game-publishing-xhnui2
            │
          S4 (the app) → S6 (the world)
```

`‖` means the two can run as two sessions at once.  A wave starts when the
previous wave has MERGED, not when its PRs are merely open.

## Before you launch anything

1. **Merge the PM plan PR into `claude/s3-followup-docs` first.**  The briefs live
   in that PR.  Every prompt below checks for them and stops if they are missing.
2. **One merge at a time, ≥ ~30 minutes apart.**  The full suite runs on each
   merge into the block branch (~30 minutes) and a second merge inside that window
   cancels the first run, which costs the per-merge verdict.
3. **Bring flags back to the PM session.**  Anything a session writes to §8 is for
   the PM to reconcile — including merging the phase branch into the block branch,
   which keeps the final promotion PR clean.
4. **Judging.**  `S7` is judged on a real gamepad and a real keyboard, which the
   phone preview link cannot show.  `S9`, `S8`, `S10` and `S11` are judged by
   playing the preview link; `S8` and `S10` also come with numbers in the PR.

---

## S9 — Enemy AI  (wave 1)

```
You are work session S9 ("Enemy AI") of the Omni follow-up block.  I am the
product owner and I decide gameplay questions with you, inside this session.

SETUP — run this first, verbatim.  The plan lives on the block branch, NOT on main:
  git fetch origin claude/s3-followup-docs
  git checkout -B <your-work-branch> origin/claude/s3-followup-docs
  git show origin/claude/s3-followup-docs:docs/ENGINE_CORE_PLAN.md | grep -c '^| D4[01] '
The last line must print 2 or more.  If it does not, STOP and tell me: the PM plan
PR has not merged yet.

READ, in this order: CLAUDE.md (§1, §3, §7, §8 — especially the AI-routing,
periodic-passes/PerfController and determinism notes); docs/ENGINE_CORE_PLAN.md §0,
§2, §5 ("The follow-up block's branch"), the follow-up block header and your own
section S9 in §4, D40 and D41, and §8; and docs/PARKING_LOT.md "Enemy AI as a
difficulty axis" and "Tile-mounted turret emplacements (Turret v2)".

THE ASK, in my words: "Enemies struggle to find the player or get stuck easily in
tiles or shards, they always know where the player is instead of needing line of
sight or having any system like that, enemies need to travel in packs."  And: the
sentry / Turret should be allowed to move, but slowly (more slowly if it is
tank-like).

HOW TO WORK:
1. Re-check the brief's survey against the code; correct the brief where it is wrong.
2. MEASURE FIRST: add the stuck-time metric to the balance harness and report
   today's number to me.  That number is what we turn "gets stuck easily" into.
3. Put OPEN DECISIONS D-S9-a to D-S9-f to me with the consequence of each option
   (AskUserQuestion), BEFORE building.  Mind the hazard in D-S9-a: a wave ends only
   when every counted enemy is dead, so an enemy that never finds the player stalls
   the wave.  Record each answer in §7 under the next free D number.
4. Two PRs, invisible first: (1) the perception seam with omniscience as its only
   implementation, byte-identical hashes, plus the metric; (2) the gameplay PR, each
   behaviour behind its own DBG A/B whose index 0 is what ships and whose other end
   is today's behaviour.  The gameplay PR may split into small PRs if I prefer to
   judge them one at a time.

PRs: BOTH are based on claude/s3-followup-docs, never main:
  gh pr create --base claude/s3-followup-docs --head <your-work-branch>
(or the GitHub MCP create_pull_request with the same base and head).  Merge
origin/claude/s3-followup-docs into your branch immediately before opening each PR.
State the invariant in the invisible PR's description.

GATES per push: typecheck + build + npm test (smoke) + npm run test:sim + the suites
you touch.  You change the sim, so the block's shared rule 3 also applies
(determinism, the guards, the balance delta).  Run the FULL suite only when I tell
you I am ready to merge.

DO NOT TOUCH: weapon and damage numbers; boss phase tables except the Turret escort;
the save format; trails (that is S10).  Amend the plan as §0 says: your own §4
section, your decisions in §7, flags for other sessions in §8 — never another
session's section.

DONE WHEN: the stuck-time metric falls by the threshold I set from the baseline; a
hidden player is always found within a bounded time (a test); the A/B off position
reproduces today's hashes; the perception pass runs on a PerfController cadence.
```

## S7 — Menus and navigation  (wave 1)

```
You are work session S7 ("Menus and navigation") of the Omni follow-up block.  I am
the product owner and I decide design questions with you, inside this session.

SETUP — run this first, verbatim.  The plan lives on the block branch, NOT on main:
  git fetch origin claude/s3-followup-docs
  git checkout -B <your-work-branch> origin/claude/s3-followup-docs
  git show origin/claude/s3-followup-docs:docs/ENGINE_CORE_PLAN.md | grep -c '^| D4[01] '
The last line must print 2 or more.  If it does not, STOP and tell me.

READ, in this order: CLAUDE.md (§1, §7, §8 — the menu-navigation, scrim / overlay,
class-vocabulary, debug-panel and input-device notes); docs/ENGINE_CORE_PLAN.md §0,
§2, §5 ("The follow-up block's branch"), the follow-up block header and your own
section S7 in §4, D40 and D41, and §8; docs/PARKING_LOT.md "Controller schemes —
refinement pass" and "Fully customisable control scheme".

THE ASK, in my words: make the game menus higher quality, and make sure every form
of game control can navigate them easily.  "Currently the controller method is very
difficult because there is no indication of what is being selected, no way of
scrolling through menus, etc.  Similar could be said for the keyboard controls."

HOW TO WORK:
1. Re-check the brief's survey (components/menuNav.ts, InputSystem's menu path,
   UIOverlay, uiClasses) against the code; correct the brief where it is wrong.
2. Put OPEN DECISIONS D-S7-a to D-S7-h to me with the consequence of each option
   (AskUserQuestion), BEFORE building.  D-S7-h (how far "higher quality" goes) sets
   the scope of the whole session: settle it first.  Record each answer in §7 under
   the next free D number.
3. Two PRs, invisible first: (1) the unified navigation step queue and a
   reachability test that WALKS every overlay with each input source (D-pad,
   keyboard, and whatever D-S7-b adds) asserting every control is reachable, focus
   is always on a visible element and long panels scroll — D-pad behaviour unchanged;
   (2) the visible work: the focus indicator, the new sources, the dead-end fixes and
   the quality pass.  Remember arrow keys are FLIGHT keys in live play: keyboard menu
   navigation is gated to overlay-up states.

PRs: BOTH are based on claude/s3-followup-docs, never main:
  gh pr create --base claude/s3-followup-docs --head <your-work-branch>
(or the GitHub MCP create_pull_request with the same base and head).  Merge
origin/claude/s3-followup-docs into your branch immediately before opening each PR.
If you add or relabel a debug row, tests/debugmenu.spec.ts pins the labels: edit that list deliberately.

GATES per push: typecheck + build + npm test (smoke) + the suites you touch
(tests/input.spec.ts, tests/debugmenu.spec.ts, the screens suite).  You do not touch
the sim.  Run the FULL suite only when I tell you I am ready to merge.

DO NOT TOUCH: the sim; how the ship flies under any control scheme; the debug
panel's row labels; S4's safe-area and haptics work (flag it in §8 instead).  Amend
the plan as §0 says: your own §4 section, your decisions in §7, flags in §8.

DONE WHEN: with a gamepad only, and separately a keyboard only, I can start, pause and
resume, dock and undock, buy and sell, install / uninstall / swap a module, change the
control scheme and audio, open and close the debug panel, respawn from death and
dismiss stage-clear — always seeing what is selected — and the reachability test is
green on every overlay.
```

## S8 — Rotational dynamics  (wave 2; start after S9 has merged)

```
You are work session S8 ("Rotational dynamics") of the Omni follow-up block.  I am
the product owner and I decide feel questions with you, inside this session.

SETUP — run this first, verbatim.  The plan lives on the block branch, NOT on main:
  git fetch origin claude/s3-followup-docs
  git checkout -B <your-work-branch> origin/claude/s3-followup-docs
  git show origin/claude/s3-followup-docs:docs/ENGINE_CORE_PLAN.md | grep -c '^| D4[01] '
The last line must print 2 or more.  Also confirm S9's PR has merged into
origin/claude/s3-followup-docs; if it has not, STOP and tell me.

READ, in this order: CLAUDE.md (§1, §3, §7, §8 — determinism / dmath, mass scale and
impact physics, the crash model, hot-path and perf rules, shard sleep); docs/ENGINE_
CORE_PLAN.md §0, §2, §5 ("The follow-up block's branch"), the follow-up block header
and your own section S8 in §4, D40 and D41, and §8; docs/PARKING_LOT.md "Rotational
mechanics for shards and asteroids" (its claim that the solver already computes a
contact point is WRONG — the PM plan corrects it; verify for yourself).

THE ASK, in my words: "Use inertia and rotational dynamics for shards instead of
just basic points / particles with random rotation directions."

HOW TO WORK:
1. Re-check the brief against PhysicsSystem (resolveShardPair, checkAndResolveCollision,
   resolveCollision, the two spin integrators), ShardSystem and fracture.  Correct the
   brief where it is wrong.
2. Put OPEN DECISIONS D-S8-a to D-S8-h to me with the consequence of each option
   (AskUserQuestion), BEFORE building, and set the per-pair perf budget with me before
   you choose a contact model (D-S8-b).  Record each answer in §7 under the next free D.
3. Two PRs, invisible first: (1) ONE angular integrator and an inertia field that is
   computed and carried but adds no torque, initial spin unchanged — the hashes must be
   identical, which is the proof; (2) torque, conservation at a break, the spin policy,
   behind a DBG A/B whose other end is today's spin.

PRs: BOTH are based on claude/s3-followup-docs, never main:
  gh pr create --base claude/s3-followup-docs --head <your-work-branch>
(or the GitHub MCP create_pull_request with the same base and head).  Merge
origin/claude/s3-followup-docs into your branch immediately before opening each PR.

GATES per push: typecheck + build + npm test (smoke) + npm run test:sim + the suites
you touch (fracture, knockback, nebulaspin, mass, terrain, headless, replay).  You change
the sim, so the block's shared rule 3 applies: use dmath, name every random stream,
keep Node and Chromium bit-identical, and report the balance --quick delta and the
perf/simbench.mjs numbers in the gameplay PR.  Run the FULL suite only when I tell you
I am ready to merge.

DO NOT TOUCH: static tile behaviour; the crash-energy calibration unless I decide
otherwise; how the player hull handles.  Amend the plan as §0 says.

DONE WHEN: an off-centre glancing impact spins a shard and a centred one does not;
angular momentum is conserved across a break and across a glancing two-body collision
to a tolerance we agree (tests, not screenshots); a heaped pile reaches sleep within a
time we agree; no energy is gained; Node and Chromium agree; the perf numbers are inside
the budget.
```

## S10 — Enemy and rival trails  (wave 2)

```
You are work session S10 ("Enemy and rival trails") of the Omni follow-up block.  I am
the product owner and I judge how it looks by playing the preview link.

SETUP — run this first, verbatim.  The plan lives on the block branch, NOT on main:
  git fetch origin claude/s3-followup-docs
  git checkout -B <your-work-branch> origin/claude/s3-followup-docs
  git show origin/claude/s3-followup-docs:docs/ENGINE_CORE_PLAN.md | grep -c '^| D4[01] '
The last line must print 2 or more.  Also confirm S9's PR has merged (the mobile Turret
needs a trail style); if it has not, STOP and tell me.

READ, in this order: CLAUDE.md (§1, §8 — the trail / effects notes, the pooled-render-
bucket rule, the seeker and kinetic trails, the indicator colour legend, rivals); docs/
ENGINE_CORE_PLAN.md §0, §2, §5 ("The follow-up block's branch"), the follow-up block
header and your own section S10 in §4, D40 and D41, and §8; perf/README.md.

THE ASK, in my words: "Give enemies and rivals trails.  Rival trails shall be coloured
based on their aggro status.  Enemy trails shall be red.  Enemies should have different
style trails depending on enemy type.  This definitely needs to be A/B tested for
performance.  Use existing systems and trail patterns / styles.  Use velocity-based
trails."

HOW TO WORK:
1. Re-check the brief against TrailSystem, render/effects.ts, the TrailShape set, and how
   the player's trail is emitted; correct the brief where it is wrong.
2. Put OPEN DECISIONS D-S10-a to D-S10-e to me (AskUserQuestion) BEFORE building.
   Record each answer in §7 under the next free D number.
3. Two PRs, invisible first: (1) the velocity-based emitter, the renderer and the DBG
   cycle, DEFAULT OFF, with the perf evidence — nothing is drawn by default; (2) the style
   table and the shipped default, chosen from the numbers.
4. Perf is the acceptance: a perf scene with dozens of enemies in perf/scenes.mjs;
   frame time (p99) and heap churn, trails off against on, in the PR description.

PRs: BOTH are based on claude/s3-followup-docs, never main:
  gh pr create --base claude/s3-followup-docs --head <your-work-branch>
(or the GitHub MCP create_pull_request with the same base and head).  Merge
origin/claude/s3-followup-docs into your branch immediately before opening each PR.

GATES per push: typecheck + build + npm test (smoke) + npm run test:sim + the suites you
touch (debugmenu pins row labels).  A trail is presentation: render files may not import
sim, trail state never enters the sim hash, and per-enemy state is pooled.  Run the FULL
suite only when I tell you I am ready to merge.

DO NOT TOUCH: the sim; the player's own trail; projectile and beam trails.  Amend the plan
as §0 says.

DONE WHEN: the A/B numbers are in the PR and the default is chosen from them; a test shows
the sim hash is identical with trails on and off; nothing allocates per frame.
```

## S11 — Map designs  (wave 3; start after S9, S8 and S7 have merged)

```
You are work session S11 ("Map designs") of the Omni follow-up block.  I am the product
owner and I judge a map by flying it.

SETUP — run this first, verbatim.  The plan lives on the block branch, NOT on main:
  git fetch origin claude/s3-followup-docs
  git checkout -B <your-work-branch> origin/claude/s3-followup-docs
  git show origin/claude/s3-followup-docs:docs/ENGINE_CORE_PLAN.md | grep -c '^| D4[01] '
The last line must print 2 or more.  Also confirm S9, S8 and S7 have all merged into
origin/claude/s3-followup-docs; if any has not, STOP and tell me.

READ, in this order: CLAUDE.md (§1, §6a Maps, §5 MAP_POPULATION / STAR_DENSITY_BY_MAP,
§8 determinism and the hub layout); docs/ENGINE_CORE_PLAN.md §0, §2, §5 ("The follow-up
block's branch"), the follow-up block header and your own section S11 in §4, S6 (you build
the layout half of what it names), D40 and D41, and §8; docs/PARKING_LOT.md "Area
composition — material combinations + a real map graph".

THE ASK, in my words: "Some maps could use a large amount of tiles with limited flight
paths (maze-like, but not necessarily labyrinth style); some should be wide open and have
large groups of rivals and enemies spread far apart, lower numbers of tiles and a dense
background star field."

HOW TO WORK:
1. Re-check the brief against MapClasses, MapDescriptors, MAP_POPULATION, WaveSystem's spawn
   geometry and rivals' cadence; correct the brief where it is wrong.
2. Put OPEN DECISIONS D-S11-a to D-S11-g to me (AskUserQuestion) BEFORE building.  Record each
   answer in §7 under the next free D number.  Any generator draws only from the sim.terrain
   stream so a seed reproduces the map.
3. Two PRs, invisible first: (1) the layout seam, every existing map reproducing its current
   hashes; (2) the new arenas and their hub rifts.

PRs: BOTH are based on claude/s3-followup-docs, never main:
  gh pr create --base claude/s3-followup-docs --head <your-work-branch>
(or the GitHub MCP create_pull_request with the same base and head).  Merge
origin/claude/s3-followup-docs into your branch immediately before opening each PR.

GATES per push: typecheck + build + npm test (smoke) + npm run test:sim + the suites you touch
(maps, hublayout).  You change the sim, so the block's shared rule 3 applies, including the
balance harness: add the new arenas to its map list and show they complete a ladder without a
stall.  Run the FULL suite only when I tell you I am ready to merge.

DO NOT TOUCH: graph edges, per-node persistence and the descent machinery (S6); the balance of
the existing arenas.  Amend the plan as §0 says, and rewrite nothing in S6 — flag it in §8.

DONE WHEN: existing maps are hash-identical after PR 1; each new arena is reachable from the
hub, completes a wave ladder in the balance harness, and plays as its family's shape.
```
