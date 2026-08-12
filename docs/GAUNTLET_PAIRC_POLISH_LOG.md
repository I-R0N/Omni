# Gauntlet — step 5: Pair C (input) + polish batch + CI gate

Ledger for the third completion-roadmap gauntlet (`docs/GAME_FEEDBACK_PLAN.md`
step 5, decisions #43 / #46b / #51). Process is the standard gauntlet
discipline (decision #41c): one milestone per iteration, one commit each,
three gates green before every commit, every judgment call recorded here with
the alternatives it beat.

Branch: `claude/gauntlet-pairc-polish-p824hy`, off `claude/plan-completion`
at `dab0394`. PR targets `claude/plan-completion`.

**Out of scope, deliberately:** audio (the collaborator's SFX session, PR #79,
is rebasing in parallel — this gauntlet does not touch the audio system or its
wiring), UI coherence beyond the listed items (5d owns that), economy and boss
tuning (step 6).

---

## Checklist

| ID | Milestone | Status |
|----|-----------|--------|
| G1 | CI gate — three gates on PRs + the plan branch, cached, verified | **done** |
| G2 | Gamepad support (Pair C c2, first half) | **done** |
| G3 | Onscreen joystick (c2, second half) | **done** |
| G4 | Menu help panel (c1) | **done** |
| G5 | Minimap rework — nebula out, flow streamlines, faithfulness | **done** |
| G6 | Portal off-screen indicators (decision #46b) | **done** |
| G7 | Polish residuals — palette defaults, MAP_POPULATION authority | pending |
| G8 | OPTIONAL — NPC station shuttles (first to cut) | pending |
| G-final | Validation, docs sync, completion summary | pending |

---

## Iteration log

### G1 — CI gate (2026-08-12)

**Found already shipped.** The milestone brief asks for "one GitHub Actions
workflow" running the three gates; `.github/workflows/pr-checks.yml` already
existed, added at the tail of the 5b harness session (`47b1ab4`, "CI: run the
three validation gates on every PR as the merge gate") and already documented
in CLAUDE.md §7 and `tests/README.md`. Decision #51 (dated 2026-08-11) reads
as if the workflow is still to be written, because it was recorded from the
plan's point of view rather than the branch's. The plan doc is not mine to
edit this session, so the discrepancy is recorded here instead.

So G1 became **completion, not creation** — close the three gaps between what
shipped in 5b and what #51's milestone spec asks for:

1. **Trigger coverage.** `push` guarded only `main`. This gauntlet and the
   SFX session both land on `claude/plan-completion`, and a bad merge into
   that branch was invisible until the next PR opened against it. Added.
2. **Browser caching.** `npx playwright install --with-deps chromium`
   re-downloaded Chromium on every run.
3. **Stale README.** "There is no linter and no CI gating" — half of that
   sentence had been false since 5b.

**Measurements first** (run `31547162287`, the last green run before this
change, 2:23 wall clock):

| step | time |
|---|---|
| Checkout | 3s |
| Setup Node (with `cache: npm`) | 5s |
| `npm ci` | **2s** |
| Typecheck | 4s |
| Build | 2s |
| Install Playwright browser | **26s** |
| Test (38 suites) | 96s |

The run was already at 2:23 against a "well under 10 minutes" target, so
caching here is hygiene, not rescue. The numbers also settle *what* to cache.

**DECISION G1-a — cache the browser, not `node_modules`.**
The brief says "cache node_modules + the browser download keyed on the
lockfile + Playwright version". Implemented as: browser cache keyed on the
resolved `@playwright/test` version, and npm caching left to `setup-node`'s
`cache: npm` (which is already lockfile-keyed, and is why `npm ci` costs 2
seconds).
*Alternative rejected:* an explicit `actions/cache` over `node_modules/` with
`npm ci` skipped on a hit. It would save at most ~2s of a 143s run, and buys
a class of bug the npm cache does not have — a restored `node_modules` that
does not match the lockfile because a postinstall step, a platform-specific
optional dep, or a partial save left it inconsistent. Two seconds is not
worth a cache that can lie about what is installed.

**DECISION G1-b — split `install --with-deps` into two paths.**
A cache hit restores `~/.cache/ms-playwright` but *not* the apt system
libraries Chromium links against, so a naive `if: cache-hit != 'true'` guard
around the whole install step yields a cached browser that cannot launch. On
a hit the workflow runs `npx playwright install-deps chromium` (system
packages only); on a miss, the original `--with-deps` install. The cache key
carries the runner OS as well as the Playwright version, so a runner-image
bump cannot serve a browser build to the wrong libc.
*Alternative rejected:* caching the apt packages too. Fragile, and the deps
step is a few seconds.

**Not touched:** `pr-preview.yml`, `publish-standalone.yml` (brief), and the
`validate` job's structure — step order, the 45-minute timeout, the
failure-only report upload, and the deliberate absence of secrets (which is
what lets the gate run on fork PRs) all stay as 5b shipped them.

Also added the run badge to the README's validation note and corrected the
"no CI gating" sentence; the "no linter" half stands.

**Verification:** GREEN on this branch — run `31554784338`, `typecheck ·
build · test`, 2 m 25 s, on PR #84. That run was a cache MISS by construction
(nothing was stored under the new key yet), so it measures the unchanged path;
the saving shows from the next run onward. Local gates green before the commit
(38/38 tests, 2.2 m).

**DECISION G1-c — the PR is opened NOW, as a draft, not at the end.**
The brief asks for one PR at the end of the queue. But `pr-checks` fires on
`pull_request` events, so with no PR open the gate cannot run on this branch
at all — G1's own acceptance criterion ("verify it passes on your own
branch's first push") is unreachable, and decision #51's stated purpose
("every later milestone of that gauntlet runs under it") is unreachable with
it. Opening it early as a DRAFT satisfies both and is still exactly one PR.
Titled `[WIP — do not merge]`; the body becomes the ledger summary at
G-final.
*Alternative rejected:* adding `workflow_dispatch` or a branch glob to the
workflow purely so this session could trigger it. That widens the gate's
trigger surface permanently to solve a scheduling problem for one session.

---

### G2 — Gamepad support (2026-08-12)

Pair C (c2), first half. A third input device beside keyboard/mouse and
touch, added inside `InputSystem` — no new module, no dispatch layer
(decision #50b).

**The shape of it.** The pad does not get its own channel into the engine.
It writes the *same* three things the mouse writes — the movement vector, the
synthetic pointer, the fire/charge queues — so that nothing downstream of
`InputSystem` knows a pad exists. Two consequences fall out for free rather
than being built: aiming works (rotation is derived from the pointer), and
shooting works (a shot's target is a pointer position). The only new surface
in `GameEngine` is `pollGamepad()`, ~20 lines at the top of `loop`, plus one
`||` in `updateInteractables`.

**DECISION G2-a — the pad writes the SYNTHETIC POINTER rather than an aim
channel.** The right stick parks a virtual cursor `AIM_RADIUS` px out from
screen centre along its heading; `player.rotation` and every pad shot then
travel the paths the mouse already uses.
*Alternative rejected:* a separate `getAimVector()` that `GameEngine` prefers
over the pointer. That means a branch at the rotation site AND another at the
shooting site, and two ways for aim to be defined — the exact "second polling
path" the (#44) ship-select note warned would collide.

**DECISION G2-b — `AIM_RADIUS` (150) is load-bearing, not cosmetic.** It must
exceed `SHIP_SELECT_RADIUS` (46). The ship sits at screen centre and
`claimTapNear` claims taps within 46 px of it out of the fire queue, so a pad
shot synthesised AT the centre would be silently eaten as a dock tap whenever
the player is near a station or portal. The heading also persists when the
stick is released and starts at (1, 0), so there is no frame in which the pad
has no aim. **A test caught the first version of this**: the deadzone helper
wrote (0,0) into the held heading every frame the thumb was off the stick, so
a pad shot fired at the ship itself. Fixed with a separate read buffer; the
assertion (`dist > SHIP_SELECT_RADIUS`) stays as the regression guard.

**DECISION G2-c — fire is the pointer's model exactly, minus the drag
cancel.** Press-and-release is a shot; holding past `CHARGE_FULL` and
releasing is a charged shot; the same charge ring fills. What the pad does
NOT inherit is `TAP_DISTANCE_LIMIT` — a thumb on the right stick moves the
aim hundreds of px during any hold, so the drag cancel would have swallowed
most pad shots.
*Alternative rejected:* auto-repeat while the trigger is held, which is the
usual twin-stick convention. It cannot coexist with hold-to-charge on the
same button, and inventing a second fire model for one device is a worse
answer than one model everywhere. **Routed to FOR-USER-REVIEW** — it is a
feel call, and only a real pad can settle it.

**DECISION G2-d — poll once per FRAME, gate FIRE on the world.**
`navigator.getGamepads()` allocates a fresh snapshot per call and the hardware
reports at 60–125 Hz, so sampling it inside the sim substep loop (up to 5×
per frame) buys nothing but garbage. The poll sits above every freeze
short-circuit in `loop`, because the pause button has to work from inside the
paused state. What IS gated is the fire queue: a trigger held through a
station visit must not bank a shot that lands on undock. INTERACT / CYCLE /
PAUSE still latch — they are how you leave a frozen state — and both CYCLE
and INTERACT are drained every frame whether or not they can be spent, so a
press made against a frozen world cannot fire later out of context.

**DECISION G2-e — adopt the pad by POLLING, not by trusting
`gamepadconnected`.** The spec lets a browser withhold a pad until its first
button press and Safari does exactly that, so an already-paired DualSense may
never fire the event. The poll adopts the first live pad it sees and
synthesises the connect/disconnect hint itself; the events remain as the fast
path. First pad wins — a second one connecting does not steal the seat.

**Mapping** (`INPUT_CONSTANTS.GAMEPAD`, W3C standard-gamepad indices; PS5
names given): left stick + D-pad = thrust, right stick = aim, **R2 / Cross** =
fire and charge, **Square** = interact (dock, portal, undock), **R1 /
Triangle** = cycle weapon, **Options** = pause/resume. Radial deadzone 0.18
with rescale, trigger threshold 0.35. All provisional feel numbers.

- Radial, not per-axis: a per-axis zone leaves a cross-shaped dead region, so
  a gentle diagonal push reads as pure horizontal.
- Rescaled, not just clamped: without the rescale the first live deflection
  jumps to 0.18 of full throttle, which is a visible lurch.
- Triggers are read by analogue `value`, not `pressed` — some drivers only set
  `pressed` at full travel.

**The interact seam closed as designed.** CLAUDE.md §8 and the code comment at
`updateInteractables` both reserved the controller button as "the third path
into `selected`". It is now one `||` against a latched edge, drained only
while a POI is in range — nothing else moved, and the nearest-wins arbitration
between stations and portals is untouched.

**Testing.** `tests/input.spec.ts`, 16 tests. The Gamepad API cannot be
synthesised headless, so the layer is split at exactly that line:
`pollGamepad()` does the untestable part (find a pad, read it) and
`applyPadSnapshot()` — deadzones, pointer, edges, charge window — takes a
plain snapshot object a test can write. Assertions route through real
consumers: the movement vector the player integrates, the rotation the ship
renders at, the station the interact button actually docks at, the weapon name
in the stats payload.

Two harness traps cost a cycle each and are worth recording:
1. **The engine's own loop drains the queues between round-trips.** Feeding
   pad frames in one `page.evaluate` and reading `getFireEvents()` in the next
   reads an empty queue every time, because a real frame ran in between. The
   `feedThen` helper does both in one evaluation. (This is harness rule 2 —
   sample peaks, not instants — wearing a different hat.)
2. **`waitForStats` predicates are stringified**, so a closed-over test-side
   variable does not exist in the page and the predicate throws rather than
   failing an assertion — surfacing as an unexplained timeout. Spell the
   expected value out instead.

**Deliberately NOT changed:** the world-space interact prompt still reads
"TAP SHIP TO DOCK" with a pad connected. Rewriting it per active device is a
legibility question across every prompt in the game, which is 5d's coherence
sweep, not a gamepad milestone.

**Gates:** typecheck, build, and 54/54 tests green (38 existing + 16 new).

---

### G3 — Onscreen joystick (2026-08-12)

Pair C (c2), second half. A left-thumb virtual stick for movement, coexisting
with the tap-to-aim/fire gestures that were already there.

**What was there before:** touch was a SINGLE pointer. One finger drove
movement (screen-centre → touch, radial throttle), aim, tap-to-fire and
hold-to-charge, all at once. Adding a stick means touch has to become
two-handed, which is the real change here; the widget is the easy part.

**DECISION G3-a — the stick FLOATS inside a zone, it does not sit at a fixed
home.** It appears centred wherever the thumb lands. The bottom-left corner,
where a parked stick belongs, is already the minimap's; a fixed stick would
either fight it or sit somewhere a thumb cannot comfortably reach on a 390 px
screen.
*Alternative rejected:* a fixed stick above the minimap. It costs vertical
space permanently, and it is worse ergonomics — a floating stick is always
exactly under the thumb.

**DECISION G3-b — the zone is defined by what it REFUSES, and one of those
refusals is load-bearing.** A touch becomes the stick only in the left
`ZONE_W_FRAC` (0.45) of the screen, below the HUD chips, above the
minimap/loadout strip — and **never inside `SHIP_SELECT_RADIUS` of screen
centre**. That last carve-out is not tidiness: the ship renders at screen
centre and `claimTapNear` docks and enters portals from a tap within 46 px of
it, and the left zone otherwise reaches into that disc. Without it, tapping
the hull's lower-left quadrant would silently stop docking. There is a test
that taps exactly there and requires a dock.

**DECISION G3-c — the minimap rect is PUSHED to InputSystem per frame, not
read from a constant.** The minimap is 75 px collapsed and 280 px expanded;
expanded, it reaches into the thumb zone, and its own tap is what collapses
it again. A constant exclusion could only be right for one of the two sizes.
`GameEngine.tickJoystick` pushes the live rect each frame, which also keeps
HUD-layout knowledge in the engine (where the fire-event handler already
computes the same rect).
*Alternative rejected:* importing MINIMAP_CONSTANTS into InputSystem and
recomputing. Same numbers in two places, and still wrong while expanded
unless the expansion flag is threaded through anyway.

**DECISION G3-d — the aim finger is UNCHANGED, including its movement
role.** When no stick is down, a single touch still does everything it did
before, movement included. Only while a stick touch is live does the aim
finger stop steering (the stick branch returns first). A player who never
discovers the stick loses nothing, and there is no mode to explain.

**Not a ghost.** `getJoystickState()` returns null whenever there is no live
touch session, so the widget never appears under a mouse or a gamepad — which
is also why it needs the DBG toggle (Visual ▸ **Joystick**: `Touch` /
`Forced`) to be checkable on a desktop browser at all. The forced widget
parks itself inside the zone it claims, so what the toggle draws is where a
real thumb would work.

**Rendering** is deliberately quiet — a thin ring at the origin, a filled
knob, a stem between them — and draws LAST in the HUD pass, because it sits
under an actual thumb and anything more elaborate is hidden by the hand
holding it. Alpha rides a `FADE_SEC` release fade so lifting off dissolves
rather than snaps. New shared type `JoystickHUDState` (types.ts), one new
`render()` parameter, one call in `render/hud.ts`. No new module.

**Testing.** Seven more tests in `tests/input.spec.ts` (23 total in the
suite), driving **real `TouchEvent`s dispatched at the canvas** — Playwright's
`page.touchscreen` only does single taps, and the whole point of this feature
is a second finger being down at the same time. The events go to the canvas
so they pass `shouldIgnoreEvent`, which is the rule that keeps overlay menus
scrollable; routing around it would have tested a game that does not exist.
Covered: the zone's refusals (ship disc, right half, both strips, the
expanded minimap), float-to-thumb, the knob clamping at the ring, deadzone,
real thrust, two-finger operation (stick held + aim thumb fires a real
projectile), the ship-select tap still docking, and the DBG toggle.

The same round-trip trap from G2 recurred in a new costume: the aim thumb's
tap was asserted by reading the fire QUEUE, which the engine's loop drains
every frame. Fixed by counting the spawned PROJECTILE instead — durable state
rather than a transient, and closer to what the player actually sees.

**Gates:** typecheck, build, 61/61 tests green.

---

### G4 — Controls & Basics panel (2026-08-12)

Pair C (c1). One help widget, rendered by one function, hosted by both the
main menu and the pause menu.

**DECISION G4-a — a collapsible SECTION, not a sixth full-screen overlay.**
The game already has five full-screen surfaces (menu, pause, station, death,
stage-clear) and how they cohere is 5d's job. A help screen that adds a sixth
would be pre-empting that sweep with the least important surface. It uses the
`PANEL_OPAQUE` treatment the Debug Menu uses, for the same reason: dense rows
over a live map need a panel, not more transparency stacked on transparency.
*Alternative rejected:* a dedicated overlay state, which also means a new
gameState-adjacent flag and a new way to get back.

**DECISION G4-b — one function, two hosts.** `renderHelpPanel()` sits at
UIOverlay component scope beside `renderTestPanel` / `renderShipStatus`, the
pattern already established for widgets shared between menus. The two hosts
keep SEPARATE collapse keys (`menuhelp` / `pausehelp`) so opening it mid-run
does not also unfold the front door. A test asserts the two render identical
rows — "the same panel" is checked, not assumed.

**Accuracy over ambition.** Every row describes what G2 and G3 actually
bound. Where the game has no binding, the panel says nothing rather than
inventing one: there is no keyboard weapon-cycle or pause key today, so
neither appears. The one engine-driven element is the gamepad section's
`connected` badge, from `stats.gamepadInfo` — the single fact in the panel
the engine knows and the reader might not.

Four sections: Touch, Keyboard & mouse, Gamepad, The run (salvage is money,
stations outfit, portals lead to arenas, clear the field, death costs
carried salvage). The last one is the "gameplay help" half of c1.

**Layout.** A fixed-basis control column beside wrapping prose is exactly the
shape that overflows a 390 px screen sideways, so the test asserts document
scrollWidth against clientWidth AND every row's rect against the viewport,
not just the panel's own box.

**Gates:** typecheck, build, 64/64 tests (3 new in `tests/help.spec.ts`).

---

### G5 — Minimap rework (2026-08-12)

The user's two minimap directives (decision #43) plus the faithfulness pass.

#### (1) Nebula is off the minimap

It was on the map in the half nobody would look for: nebula SHARDS were
already excluded from the per-frame buffer, but nebula TILES went into the
pre-rendered terrain layer like any other tile, drawn as hard 2 px dots. The
densest, hardest-edged marks on the map stood for the softest, vaguest thing
in the world. One `continue` in `buildMinimapStaticLayer`.

Proved by test on the NEBULA_FIELD showcase — a map that is nebula and
nothing else, so the terrain layer must come out with **zero** painted
pixels. On a mixed map the same bug would hide behind the rock and glass that
legitimately draw.

#### (2) Shard dots → flow streamlines. VERDICT: flow ships as the default.

`MINIMAP_CONSTANTS.FLOW` + `renderMinimapFlow`, behind the three-way DBG
cycle **Visual ▸ Minimap mat** (`Flow` / `Dots` / `Off`) — three-way because
the question was whether streamlines BEAT dots, and the honest control for
that is a map showing neither.

**Evidence 1 — performance is a wash.** Worst-frame `renderMs` on
ASTEROID_FIELD (≈1 400 mobile shards), 14 interleaved rounds per mode:

| | Flow | Dots | Off |
|---|---|---|---|
| collapsed, p99 / worst | 20.96 / 20.97 | 20.97 / 20.98 | 20.68 / 20.71 |
| expanded, p99 / worst | 21.83 / 21.88 | 22.04 / 22.13 | 22.14 / 22.18 |

All six numbers sit inside a 1.5 ms band on an 18–21 ms software-rendered
headless frame: the material layer is below this harness's noise floor either
way. Read `perf/README.md` before quoting these — headless timings are not
device timings, and the claim here is only the RELATIVE one.

**A methodology note worth keeping.** The first A/B ran the three modes back
to back and had `Off` — which does strictly less work than either other mode
— coming out **3 ms slower than both**. That is not a result, it is drift:
warm-up, an evolving shard field and host CPU noise swamped the effect.
Interleaving (rotate the mode every 500 ms, pool per mode) made the three
collapse onto each other, which is the real answer. A sequential A/B on a
noisy host will confidently report whatever order you sampled in.

**Evidence 2 — legibility, from captures at 390×844.** Since perf does not
decide it, the pictures do:

- **Dots**, expanded: a dense white starfield of ~1 400 marks in which the
  actual CONTACTS — the bubbles, the rival, the portals — are the same size
  and brightness as the shards, and are simply lost. The layer actively
  camouflages the thing the minimap exists to show.
- **Flow**: short curved strokes, quiet grey, describing the field's real
  spiral. The contacts are then the only dots on the map, and the terrain
  reads through it.
- **Off**: contacts are clearest of all, but the map has nothing to say about
  a world made of moving material, and the flow layer costs nothing to keep.

**DECISION G5-a — `flow` is the shipped default; `dots` and `off` stay as DBG
comparisons.** Beat: keeping dots (drowns the contacts), and dropping the
layer entirely (free, but says nothing).

**DECISION G5-b — the geometry is cached in WORLD space and keyed on the seed
CELL.** Seeds sit on a lattice whose spacing scales with the shown range, so
the same 81 lines are traced at either zoom, and they are snapped to world
multiples — which makes them world-ANCHORED (the pattern slides under the
window rather than being painted on the glass) and makes the cache key
obvious: retrace only when the camera crosses a cell, the zoom changes, or the
map reloads. Panning reuses the trace. A test asserts both halves of that.
*Alternative rejected:* stamping streamlines into the pre-rendered terrain
canvas (one blit, zero per-frame cost). That canvas covers the whole map at
280 px, so the collapsed minimap magnifies it ~4× — the strokes would be
blurry smears exactly where the map is used most.

**Two bugs the pictures caught, neither visible in a number:**
1. **Lines four times too long.** `STEPS × STEP_FRAC` was 2.2 lattice cells,
   so every "streamline" ran ~75% of the visible range and the expanded map
   read as long chords crossing everything. The product has to be **under one
   cell** (now 0.84) or the strokes run into each other and stop reading as
   local currents.
2. **Wrap-seam chords.** Streamline points are integrated in unwrapped world
   space and projected through `wrapDeltaX/Y` individually, so a line
   straddling the torus seam had consecutive points resolve to opposite sides
   of the map — drawn naively, a hard straight line across the whole minimap.
   Segments longer than 3 step-lengths now break the path. This is the
   standard toroidal-polyline trap and it is worth stating plainly: **using
   torus math per POINT is not enough; a polyline needs a seam break.**

#### (3) Faithfulness pass

Every remaining contact now wears the identity it has elsewhere:

- **Enemies, bubbles, rivals, bosses** take the INDICATOR LEGEND's colour
  (§8: red / purple / yellow, boss in the shared enemy red with its ring
  doing the distinguishing) instead of `entity.color`. A contact that is red
  on the screen edge and teal on the map is two contacts as far as the player
  is concerned; the minimap and the arrows are the same kind of abstracted
  readout and have to speak one language.
- **Stations** become an indigo SQUARE (`STATION_BLIP`) — the legend's indigo,
  and the only rectilinear mark on a map of dots and diamonds, because a
  station is the one contact that is built, fixed and not alive.
- **The snitch** keeps its own gold rather than borrowing the enemy red.
- **Portals** were already the anomaly diamond with its radar ping; unchanged.
- **Drops** stay excluded, and a test now says so in all three modes.

**Not changed:** the boss keeps its ringed blip but loses the phase colour to
the legend red. The phase colour still reads on the hull aura and the HUD
bar, which are where a phase change is actually legible.

**Gates:** typecheck, build, 69/69 tests (5 new in `tests/minimap.spec.ts`).

---

### G6 — Portal off-screen indicators (2026-08-12)

The parking-lot entry "Portal off-screen indicators behave unlike every other
indicator" (2026-08-05), routed here by decision #46b, which asked for ONE of
its three candidate directions and the reasoning.

**CHOSEN: direction 2 — keep the range gate, drop the redundancy.** The
portal arrow is now suppressed once the rift is on screen, exactly like every
other contact; the `INDICATOR_RANGE` gate stays. Between the two rules the
arrow covers precisely the case it is good for: **close enough to matter, not
yet visible.**

Also folded in, from the entry's third divergence: **portals no longer print
a distance.** They were the wordiest contact on the screen — name AND number,
while an ordinary enemy prints nothing at all — and the number was the
redundant half, since the arrow only appears inside a fixed range and the
size ramp already says how far through that range you are. The NAME stays: an
unlabelled arrow is ambiguous the moment a second rift shares the edge, which
on the four-portal hub is the normal case, not an edge case.

**Why not direction 1** (drop the range gate too, obey the rules completely,
lean entirely on the minimap): the hub has four portals. Fading them in from
across the map means four permanent green arrows on the edge competing with
the threat arrows for the player's attention, for landmarks that do not move
and are not urgent. The range gate is not the anomalous part of the old
behaviour — it is the part that was right.

**Why not direction 3** (a separate waypoint/navigation layer): it is the
most interesting answer and the wrong one to take here. A navigation layer is
a new HUD surface with its own visual language, and this gauntlet has just
finished arguing (G4, G5) that the game should have FEWER competing
languages, not more. If waypoints arrive it should be with the persistence /
overworld work that gives them something to point at beyond four fixed rifts,
not as a fix for one arrow being noisy.

**Consistency with G5, which is what makes this safe.** The entry's own
counter-argument to touching the arrow was "far from one, there is no arrow
to find it by — the minimap anomaly blip is doing that job". G5 made the
minimap materially better at that job in the same session: the shard-dot wash
that used to camouflage every contact is gone, and the portal blip is a
spinning diamond with a radar ping that clamps to the border rather than
being culled. Long-range discovery is the minimap's; approach is the arrow's.

**Testing.** What the sim exposes is the INPUT to the suppression — presence
in the indicator buffer (the range gate) and the `onScreen` flag (the
redundancy gate) — and all three brackets are asserted: 6 000 units away, no
buffer entry at all; 900 units, buffered and off-screen; 40 units, buffered
and flagged on-screen. The one-line rule that consumes those inputs lives
inside a canvas draw and is not reachable from the harness; the test says so
rather than pretending otherwise.

**Gates:** typecheck, build, 70/70 tests.

---

## Decisions taken

Consolidated as they are made; each one names the alternative it beat.

- **G1-a** — cache the Playwright browser; leave npm to `setup-node`'s
  lockfile-keyed cache. Beat: an explicit `node_modules` cache (≈2s saved,
  and a cache that can disagree with the lockfile).
- **G1-b** — a cache hit installs system deps separately rather than skipping
  the install step wholesale. Beat: a single guarded `--with-deps` step (a
  restored browser with no libraries to launch against).
- **G1-c** — the PR opens now as a draft, so the gate can run on this branch
  at all. Beat: widening the workflow's triggers for one session's benefit.
- **G2-a** — the pad writes the synthetic pointer. Beat: a separate aim
  channel plus branches at the rotation and shooting sites.
- **G2-b** — `AIM_RADIUS` > `SHIP_SELECT_RADIUS`, and the aim heading
  persists. Beat: synthesising shots at screen centre (silently eaten by
  `claimTapNear` near any POI — caught by a test).
- **G2-c** — one fire model across all three devices, minus the drag cancel.
  Beat: trigger auto-repeat (incompatible with hold-to-charge; routed to
  FOR-USER-REVIEW as a feel call).
- **G2-d** — poll once per frame above the freeze short-circuits; gate FIRE
  on the world, drain everything else regardless. Beat: polling per sim
  substep (5× the garbage), and latching presses that fire out of context.
- **G2-e** — adopt the pad by polling. Beat: trusting `gamepadconnected`,
  which Safari may never fire for an already-paired pad.
- **G3-a** — the touch stick floats inside a zone. Beat: a fixed stick above
  the minimap (permanent screen cost, worse reach).
- **G3-b** — the zone carves out the ship-select disc. Beat: a plain
  left-half zone, which would silently break docking by tap.
- **G3-c** — the live minimap rect is pushed per frame. Beat: a constant
  exclusion, which cannot be right for both minimap sizes.
- **G3-d** — the aim finger keeps its movement role when no stick is down.
  Beat: making the stick the only way to move on touch (a mode to explain,
  and a regression for anyone who never finds the widget).
- **G4-a** — help is a collapsible section, not a sixth full-screen overlay.
  Beat: a dedicated overlay state (pre-empts 5d, adds a way in and out).
- **G4-b** — one render function, two hosts, separate collapse keys. Beat:
  duplicated copy that can drift between the two menus.
- **G5-a** — flow streamlines are the shipped default. Beat: keeping the
  per-shard dots (which camouflage the contacts), and removing the layer with
  no replacement (free, but the map then says nothing about material).
- **G5-b** — streamline geometry cached in world space, keyed on the seed
  cell. Beat: stamping it into the pre-rendered terrain canvas (one blit, but
  blurred ~4× at the collapsed zoom, which is where the map is used).
- **G6** — portal arrows keep the range gate and lose the on-screen
  exemption and the distance readout. Beat: direction 1, obey-all-the-rules
  (four permanent arrows on the hub's edge competing with threats), and
  direction 3, a waypoint navigation layer (a new HUD language in the session
  that spent G4/G5 reducing them; it belongs with the persistence work).

---

## FOR-USER-REVIEW

Items needing a human — judgment calls, and things only real hardware can
answer. Consolidated in the completion summary at the end.

- **HARDWARE CHECK — the gamepad (G2).** The suite proves the mapping layer
  is correct given a snapshot; it cannot prove a real pad produces the
  snapshot the constants assume. Everything below needs a DualSense and ten
  minutes. Check the DBG readout first — pause ▸ Debug Menu ▸ Player ▸
  **Gamepad** names the adopted pad and **↳ axes** shows live post-deadzone
  thrust, the held aim heading, and a FIRE flag. If that line moves, the pad
  is reaching the sim and everything else is mapping detail.

  | # | Check | What "wrong" looks like |
  |---|---|---|
  | 1 | **iPhone Safari, Bluetooth.** Pair the pad, load the game, press a button. | The DBG row stays `none` — Safari withholds the pad until first input; if it still says `none` after a press, adoption is broken, not the pairing. |
  | 2 | **Desktop, USB and Bluetooth.** Same check in Chrome and Safari. | — |
  | 3 | **Stick directions.** Left stick up = fly up; right stick right = nose right. | Inverted Y, or the axes swapped — some drivers report a non-standard axis order. |
  | 4 | **Deadzone 0.18.** Hands off: does the ship drift? Gentle push: does it creep, or lurch? | Drift = zone too small. Lurch = the rescale is not landing. |
  | 5 | **Fire feel.** Tap R2 for a shot; hold ~1 s and release for a charged one; watch the ring. | See the open question below. |
  | 6 | **Square docks.** Fly next to a station and press Square; press it again to undock. Then a portal. | Nothing happens, or it also fires a shot. |
  | 7 | **Options pauses AND resumes.** | Resume fails — the poll would be sitting below a freeze short-circuit. |
  | 8 | **R1 cycles** with two guns mounted. | — |
  | 9 | **Yank the cable mid-thrust.** | The ship keeps thrusting — the disconnect reset is not firing. |

- **HARDWARE CHECK — the joystick (G3).** On the phone, on the standalone
  preview build the PR bot posts on every push. Every number in
  `INPUT_CONSTANTS.JOYSTICK` is a provisional feel guess: ring radius 56 px,
  knob 22 px, deadzone 6 px, zone = left 45% between 30% and (height − 100 px).
  1. **Reach.** Does the stick land under the left thumb without shifting
     your grip? Is the zone too small (thumb keeps landing outside it and
     firing a shot instead) or too big?
  2. **Throttle.** Is 56 px to full throttle right, or does it want a longer
     travel?
  3. **Two-handed.** Hold the stick and tap-fire with the right thumb at the
     same time. Then hold to charge while steering.
  4. **The three things it must not steal:** tap the ship near a station
     (docks), tap the minimap (expands, and tap again to collapse), tap a
     loadout slot (switches weapon).
  5. **Visibility.** Is the widget too faint under a thumb in daylight, or
     too loud?

- **OPEN QUESTION — should holding the fire trigger auto-repeat?** Today it
  does not: the pad uses the same tap-or-charge model as mouse and touch
  (decision G2-c). Twin-stick convention says a held trigger should stream
  shots, but that cannot coexist with hold-to-charge on the same button. If
  auto-repeat is wanted, the charged shot needs its own button (L2 is free)
  and this is a two-line change plus a help-panel edit. **Judge it on
  hardware** — it is the one gamepad decision that is purely feel.

- **Branch protection is a repo setting, not a file.** The workflow reports;
  it does not refuse a merge. Making `typecheck · build · test` *blocking*
  requires branch protection on `main` (and, while this plan runs, on
  `claude/plan-completion`) listing it as a required status check. CLAUDE.md
  §7 already says this; noting it here because G1 is the milestone that makes
  it actionable, and nothing this session can do will enforce it.
