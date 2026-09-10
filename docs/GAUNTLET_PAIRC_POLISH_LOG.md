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
| G7 | Polish residuals — palette defaults, MAP_POPULATION authority | **done** |
| G8 | OPTIONAL — NPC station shuttles (first to cut) | **cut** |
| G-final | Validation, docs sync, completion summary | **done** |
| G9 | Control-scheme selection (user directive, post-queue) | **done** |
| G10 | Stick-driven aim, handedness, pause dropdown (user directive) | **done** |
| G11 | Gamepad rumble + two pad legibility fixes (user directive) | **done** |
| G12 | DualSense adaptive triggers over WebHID (user directive) | **done** |
| G12b | Trigger report corrections + the bisection tooling (hardware report) | **done** |
| G13 | Fire on trigger PRESS, not release (user directive) | **done** |
| G14 | Fire AT the break point + the three richer trigger shapes | **done** |
| G15 | Trigger thrust, gamepad menu navigation, parking-lot entry | **done** |
| G16 | Minimal-pad thrust scheme + the adaptive control in both menus | **done** |

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

### G7 — Polish residuals (2026-08-12)

Two unrelated leftovers, bundled because neither is a session on its own.

#### (1) material-palette-residual

Decision #30 carved this out of the material-palette pass and named exactly
two things: **"metal de-white + shiny-ready blue range; rock red+blue
palette."** Both were done, and a third fell out of doing them.

**DECISION G7-a — metal brightens toward a COLOUR, not toward white.**
Density brightening multiplied every channel by the same factor. That reads
as brightening but is really a march toward the ceiling on all three channels
at once: as the top channel clips, the gaps between channels close,
saturation drains, and dense metal ends up pale near-white — which is the
"de-white" complaint, restated as arithmetic. It now interpolates toward an
explicit `METAL_BRIGHT_TARGET` (`#a5d8f0`), so metal is recognisably BLUE at
every density and the "shiny metal" direction has a colour to aim at instead
of a brightness knob to turn up. The density CURVE is unchanged (the factor
is remapped onto a 0→1 mix), and the lattice cells — which are the density
readout — climb toward the same target.

**DECISION G7-b — rock gets a palette, defaulting to `mixed`.** Rock was one
flat slate, which made the most common material in the game the least
characterful. `ROCK_PALETTES` adds slate / rust / mineral families and a
`mixed` default that is mostly slate with rust and mineral running through
it — a field then reads as ROCK WITH VARIATION rather than as three
materials. Same mechanism as the plastic palettes (rolled once at spawn,
stored on the entity, inherited by shards), so it survives the
tile→shard→tile cycle and costs nothing per frame; the density tint still
multiplies the base, so every shade darkens to the same floor.
*Alternative rejected:* pure `rust` or `mineral` as the default. Both read as
a themed map rather than as rock, and they are more useful kept for the
regional-identity work the map-composition item is groundwork for.

**DECISION G7-c — the metal glow default changes magenta → cyan.** Not in
#30's list; it became visible the moment metal stopped drifting white.
Magenta was never a choice — the comment says it was "the closest match to
the legacy fuchsia" baked into an older constant — and it left the game's
coldest material wearing a hot pink halo whenever the player came near.
Cyan is the body's own family, and it is deliberately NOT the glass glow's
`sky`, so the two tile glows still read apart: glass a soft sky, metal an icy
cyan.

Every DBG row stays, and rock gains one (Visual ▸ **Rock palette**).
Verified by capture at 390×844 on the METAL / ROCK / ASTEROID field
showcases with the camera parked in the densest cluster — the whole point of
these changes is what they look like, so "it typechecks" would not have been
an answer.

#### (2) map-composition — MAP_POPULATION becomes the authority

CLAUDE.md §5 already carried the warning: *"treat MAP_POPULATION as
authoritative for documentation but verify the relevant MapClasses subclass
too."* Three natural maps hardcoded their own mix while the table said
something else. Deep Space is the worst case: the class generated 27 / 10 / 5
glass / plastic / metal clusters and 75 nebula, while the table claimed 14 /
5 / 3 and 65+120. **The table was describing a map that had not existed for a
long time.**

**DECISION G7-d — the CODE's numbers won; the table was corrected to them.**
This was specified as a data move, not a rebalance, so the population that
ships is the population that shipped. Deep Space's 42-cluster budget split
64/23/13 is written out as explicit counts, because a percentage split of a
budget is a second thing to keep in sync. Deep Space's unused inner/outer
nebula split was DELETED rather than carried across — the class stopped
applying it long ago and merely averaged the two size ranges, and carrying a
field nothing reads is how the entry drifted in the first place.

**DECISION G7-e — Seven Rings expresses its mix as `tileRings`, a new
optional field.** A ring map's "tile-variant ratio" is not a cluster count,
it is WHICH RING is made of what. The ring GEOMETRY (count, radii, thinning)
deliberately stays on the class: that is the map's shape, and a map named
Seven Rings should not get its ring count from a population table. This is
also the one place `indestructible-tile` appears in a natural map, which is
exactly what decision #6 reserves it for — deliberate border placement,
never a random cluster.

Overworld, which already read the table inline, now goes through the same two
shared helpers on `BaseMapLayer`, so there is one implementation rather than
four similar ones. (De-duplication, not an abstraction layer — no interface,
no dispatch; decision #50b.)

**Equivalence, measured 8 builds per map before and after:**

| | glass | plastic | metal | nebula / indestructible |
|---|---|---|---|---|
| Deep Space | 584 → 566 | 142 → 148 | 50 → 47 | 1623 → 1641 |
| Pocket | 75 → 72 | 37 → 36 | 15 → 17 | 103 → 102 |
| Seven Rings | 234 → 234 | 528 → 528 | 762 → 762 | 477 → 477 |

The two random maps move less than their own run-to-run spread (Deep Space's
glass alone ranges 511–624 across builds). Seven Rings is deterministic and
came out **identical to the tile**, which is the strongest form of the claim.
`tests/maps.spec.ts` now holds those bands, plus the ring ORDER — glass
inside, indestructible outside — asserted by median radius per variant.

**Gates:** typecheck, build, 74/74 tests (4 new in `tests/maps.spec.ts`).

---

### G8 — NPC station shuttles: CUT (2026-08-12)

The brief marked this optional and first to cut, and it is the milestone
that got cut. Not because it is hard — it is a lean roamer in
`engine/roamers/`, reusing the rival sprite pool and `openPortal`, and the
pattern is well worn by now — but because the session's budget went into two
milestones that grew past their briefs and earned it:

- **G5** was three directives, and answering the streamline question
  honestly meant an A/B, then discovering the A/B was drift-dominated,
  re-running it interleaved, then judging the result from captures because
  the perf answer turned out to be "no difference" — plus two real rendering
  bugs (over-long lines, wrap-seam chords) that only the pictures showed.
- **G7** turned out to be a correctness problem wearing a data-move's
  clothes: `MAP_POPULATION` was describing a Deep Space that had not existed
  for a long time, so "move the numbers" had to become "establish which
  numbers are real, then prove the move changed nothing".

Spending the remainder on ambience while G-final's validation and CLAUDE.md
sync were still owed would have been the wrong trade. The parking-lot entry
is untouched and the work is unchanged in scope.

---

### G11b — The rumble curve, retuned to feel the small stuff (user directive, 2026-08-14)

The user, testing on an iPhone, asked for "a small rumble for blaster shots,
small shard hits and killing tier 1 enemies" — all three of which the first
curve deliberately cut off below `MIN_SHAKE` 4.

**DECISION G11b-a — the answer was a FLOOR and a motor bias, not a lower
threshold alone.** `MIN_SHAKE` drops to 1 (the smallest amount the game
emits), but two other changes are what make that good rather than annoying:

- **A magnitude floor.** The old curve started at magnitude 0, so the
  smallest qualifying event played a correctly-timed effect at zero
  strength — silence dressed up as a feature. There is now a
  `MIN_MAGNITUDE` floor: anything worth playing is worth feeling.
- **The two motors crossfade.** They are different instruments — strong is a
  low-frequency THUMP, weak a high-frequency BUZZ — so the balance now moves
  with magnitude instead of being a fixed ratio. A shard ping is nearly all
  buzz; a crash is nearly all thump with some transient left on top. That is
  what makes a tick read as a tick rather than as a feeble thump.

**DECISION G11b-b — the Blaster gets a HAPTIC-ONLY path.** Lowering the
threshold could not have delivered blaster shots on its own: the plain
Blaster emits **no screen shake at all** (only the charged variant does), so
there was nothing on the funnel to hook. Shaking the camera on the fastest
gun in the game would be unplayable, so `GameEngine.handleRumble(amount)`
now exists beside `handleScreenShake` — same destination, no camera.
*Alternative rejected:* adding a tiny `onShake` for the Blaster. It would
have bought the rumble by making every shot lurch the view.

This qualifies G11-a rather than overturning it: shake and rumble still
coincide almost everywhere, and `handleScreenShake` still implies rumble. The
invariant was a means (one tuned list, not two), and one deliberate exception
with a name is cheaper than a parallel table.

**Tests changed, and why.** The G11 test asserted that MICRO and everything
below 4 produce NOTHING — the exact behaviour this directive reverses. It is
now "every impact ticks, and the curve runs tick → thump", asserting the
three events the user named all fire, that each is buzz-dominant, that a
crash is thump-dominant, and that the curve is monotonic in between so a hand
can tell a scratch from a wreck. Plus a new test that the plain Blaster fires
a rumble and moves the camera **zero**.

**Still unverifiable here, and now more consequential:** on the user's actual
device — iPhone — none of this may be felt at all, because Edge on iOS is
WebKit and gamepad haptics there are uncertain. The `↳ rumble` DBG row
distinguishes "browser refused" from "ready", which is the difference between
a tuning problem and a platform one.

**Gates:** typecheck, build, 89/89 tests.

---

### G11c — Trigger feedback, where the pad has it (user directive, 2026-08-15)

**Rumble confirmed working** in desktop Edge and desktop Safari with the
user's DualSense — the first hardware confirmation this feature has had, and
it also confirms the iPhone result was a platform wall rather than a bug: iOS
WebKit exposes no `vibrationActuator` at all (`pad has no actuator`), and
every iOS browser is WebKit.

The user then asked whether trigger feedback is reachable. **Two different
things share that name**, and only one of them is:

- **`trigger-rumble`** — a Gamepad API effect type, vibration in the trigger.
  Reachable, IF the actuator lists it.
- **Adaptive trigger RESISTANCE** — the DualSense's headline feature, a
  physical clutch. Not in the Gamepad API at any version; WebHID only.

**DECISION G11c-a — ask the actuator, do not consult a support table.**
`GamepadHapticActuator.effects` is the authority on what a given pad in a
given browser can play, so `actuatorEffects()` reads it and
`rumbleEffectFor(kind, supported)` picks. The published compatibility
picture for `trigger-rumble` is muddled — it was designed around Xbox trigger
motors, some sources claim DualSense support, and Chromium shipped parts of
it behind a flag — which is exactly the situation where reading the device
beats reading the docs.

**DECISION G11c-b — weapon fire is the `'trigger'` kind; impacts stay
handles.** A shot is felt in the trigger under the finger that pulled it; a
crash is felt in the whole pad. `trigger-rumble`'s parameters are a SUPERSET
of `dual-rumble`'s, so one effect carries both and there is no double call to
throttle against. Everywhere the effect is unavailable — which is most
places — it degrades to exactly the handle thump that shipped in G11b, so
nothing regresses for a pad without trigger motors.

The DBG row now NAMES the effects (`ready · dual-rumble+trigger-rumble`), so
"can this pad do trigger feedback" is answered by looking at the panel rather
than by guessing.

**Not built: adaptive trigger resistance.** It needs WebHID — desktop
Chromium/Edge only, a permission click, and on Bluetooth the CRC-checked 0x31
report that some firmware rejects. It stays in FOR-USER-REVIEW as its own
milestone, because it is a desktop-only enhancement layer and the input path
must not depend on it.

**Gates:** typecheck, build, 90/90 tests.

---

### G12 — Adaptive triggers over WebHID (user directive, 2026-08-15)

The user asked for the WebHID path explicitly, with one condition attached:
*"this should not hinder mobile functionality at all, whether using a
controller plus touch or any other control method."* That condition is the
design, not a caveat on it — every decision below falls out of it.

**DECISION G12-a — quarantine it in its own module, importing nothing.**
`engine/systems/DualSenseHID.ts` holds the CRC-32, the report builders and
the device wrapper, and depends on no other file in the repo. Two things fall
out: `constants.ts` can take the trigger-mode vocabulary from it without a
cycle (those mode numbers are WIRE VALUES, not game config, so they belong
with the transport), and the whole platform-specific surface is one file
somebody can read end to end.

*Alternative rejected:* folding it into `InputSystem`. That file is the one
place where "three input devices, one set of inputs" is enforced; putting a
desktop-Chromium-only transport inside it invites the next change to branch
on platform in the middle of the shared path.

**DECISION G12-b — output only. Input is ALWAYS the Gamepad API.**
This module never reads the pad. Besides keeping the input path single, it
sidesteps a known hazard: opening a DualSense over Bluetooth can flip its
input-report mode and disturb what the Gamepad API sees. The failure mode
that would have caused — connect for triggers, lose your sticks — is exactly
the "hinders other control methods" outcome the user ruled out.

**DECISION G12-c — nothing in the sim may branch on it, so it is not a
control scheme.** The pad plays identically with the link open or closed;
only the FEEL of the right trigger changes. So it is a button under the
scheme dropdown rather than a sixth scheme (a sixth scheme would imply a
choice between it and something else), and `EngineStats.adaptiveTriggers-
Supported` gates whether the control renders AT ALL.

*Alternative rejected:* rendering it disabled-with-explanation on
unsupported browsers. That makes the pause menu longer on precisely the
device where screen space is scarcest, in order to say "no".

**DECISION G12-d — the profile syncs from what the player is HOLDING, beside
the charge ring.** Not from a weapon-change event: "charging" is a state no
such event fires for, and it is the single best use of a clutch. Precedence
is no-gun-or-EMP'd → released, charging → a hard wall, else the gun's own
profile. Releasing the trigger under an EMP is the disable made physical, for
free. Cost when nothing changed is one struct compare — the redundant-write
check lives inside `applyTriggers`, so no promise is created.

**DECISION G12-e — the byte offsets are UNVERIFIED, and the design says so
out loud.** They come from public reverse-engineering; there is no pad in
this environment or in CI. What makes that acceptable rather than reckless is
that a pad **silently discards** a report with a bad CRC or a bad layout — so
"wrong offsets" and "no pad" feel identical, and guessing would be
unfalsifiable. Three mitigations: every offset lives in ONE `REPORT` table,
the DBG row shows the head of the report ACTUALLY SENT, and the pure builders
are exposed on `window.__omniHid` so the suite can pin CRC-32 against its
published vector (`0xCBF43926`) and pin the report SHAPE — which bytes move,
and that no others do (a stray byte in this report is another feature
entirely: lightbar, mic LED, volume).

**Profiles** (`WEAPON_TRIGGERS`): written to make the guns distinguishable by
feel, not to make each maximally dramatic. The Blaster fires 7×/s, so it gets
the lightest force and earliest break in the table — a stiff click 7×/s is
fatigue, not feedback. Laser and Lightning are HELD, so they take constant
resistance with no break, because a per-shot click would fight the cadence.
The Cannon is the deepest pull in the game.

**Tests: +6.** CRC-32 against the published vector, the weapon-mode byte
layout (including that nothing outside the two effect blocks moves),
resistance mode plus the degenerate-break guard, USB-bare vs Bluetooth
framing with an independently recomputed CRC, the sync's three cases, and —
the one that guards the user's actual condition — that an unsupported browser
offers no control and reports why. Headless Chromium has no `navigator.hid`,
which is the same shape every mobile browser and Safari present, so the
DEFAULT test state is the mobile state.

**Gates:** typecheck, build, 96/96 tests.

---

### G12b — Three bugs, and a way to stop guessing (hardware report, 2026-08-15)

**Hardware result: no trigger feedback**, Edge, pad connected over HID, every
weapon tried. G12 shipped with its offsets flagged UNVERIFIED; that flag was
the correct disclosure and the wrong amount of work. Checking the layout
properly against the Linux kernel's `dualsense_output_report_common`
(hid-playstation — a maintained driver against real hardware, not a forum
post) turns up three defects, two of them certain.

**BUG 1 — every field was one byte late.** The trigger blocks were written at
data offsets 11 and 22. Those are the numbers nearly every published sample
quotes, and they are indices into a buffer whose byte 0 is the REPORT ID.
WebHID's `sendReport(reportId, data)` carries the id SEPARATELY, so a literal
transcription puts the mode byte in `power_save_control` and the parameters
in the top of the trigger block. Correct data offsets are **10 and 21**.
Pinned by a test that asserts the mode byte is at 10 AND is not at 11 — the
failure mode is a one-byte shift, so an assertion that only checks the right
place would pass on the wrong data if the block were ever widened.

**BUG 2 — the Bluetooth report was 24 bytes short.** The BT frame is
report_id + seq_tag + tag + the 47-byte common block + **24 reserved bytes** +
CRC-32, i.e. 77 data bytes. The reserved span is padding, but its LENGTH is
not optional: a short HID report is dropped, not truncated. The CRC was also
computed over the pre-padding payload, so it was wrong as well as short.

**BUG 3 (SUSPECTED, and the reason for the rest of this milestone) — the
effect encoding may be the wrong convention entirely.** Two are in wide use:
`'simple'` (modes 0x01/0x02, raw byte parameters) and `'zones'` (modes
0x21/0x25, parameters packed into ten 0–9 travel zones with a 0–8 strength).
Both are reported working, on different firmware. G12 shipped 0x01/0x02 with
byte parameters in the 0–255 range, which under the zones convention is not
merely different but out of range.

**DECISION G12b-a — ship BOTH encodings behind a DBG cycle instead of picking
one.** A DualSense answers an effect it does not understand with silence, so
every guess costs a full hardware round trip, and there is no instrument here
that can distinguish a wrong guess from a wrong offset. Two encodings and a
switch turns an unbounded series of commits into one sitting with the pad.

*Alternative rejected:* pick the more likely one (`zones`) and ship again.
That is the move that produced this milestone.

**DECISION G12b-b — profiles move to NORMALISED units.** `start`/`end` as
fractions of travel, `strength` as 0..1. The two encodings disagree about
ranges (0–255 bytes vs 0–9 zones and 0–8 force); the design intent — "the
Cannon is the deepest pull in the game" — is true in both. Wire units in
`constants.ts` were what let an out-of-range value look reasonable.

**DECISION G12b-c — a rumble self-test over the SAME HID path.** DBG ▸ "HID
buzz" drives the pad's motors through the identical framing, length and CRC
the trigger effects ride, but their two bytes are not in dispute. This
BISECTS the feature: buzz + no resistance = transport correct, encoding
wrong; no buzz = nothing is reaching the pad, read the error. Nothing else
can tell those apart, and they need opposite fixes. It is a DIAGNOSTIC, not a
feature — force feedback ships through the portable Gamepad API and always
will.

Also: the DBG row now reports transport, encoding, and either the last error
or how long ago a report went out — Chrome REJECTS a report whose length
disagrees with the descriptor and says why, which would have caught bug 2
immediately had the string been on screen.

**Tests: +2 (net), all six HID tests rewritten.** Offsets 10/21 with the
off-by-one explicitly excluded, both encodings' bytes, the OFF profile
clearing all eleven bytes (releasing is an instruction, not a skipped write),
the rumble block leaving the trigger bytes alone (or the bisection proves
nothing), and BT framing at 77 bytes with an independently recomputed CRC.

**Gates:** typecheck, build, 98/98 tests.

---

### G13 — The shot lands on the press (user directive, 2026-08-15)

*"The player should fire at trigger press, not trigger release. This may need
to only happen for the controller settings."*

**DECISION G13-a — the rule is about the CONTROL, not the device.** G2-c made
the pad copy the pointer's press-and-RELEASE model in the name of "one fire
model across all three devices". That was the wrong thing to be consistent
about. A TAP fires on release because it **must**: until the finger lifts, a
tap and a drag are the same gesture, and the game uses the drag to fly. A
trigger has no such ambiguity, so the release-wait buys nothing and every
millisecond of it reads as lag. The consistency worth keeping is that all
three devices agree on WHAT a shot is; when they agree on WHEN, one of them
has to be wrong.

*Alternative rejected:* gating this on the `gamepad` control scheme. The pad
is polled under every scheme (that is the whole point of G9's "controller and
keyboard keep touch alive"), so a scheme gate would leave the trigger firing
on release for anyone using a pad while the scheme said `touch`.

**DECISION G13-b — the press pays the ordinary shot, the release still pays
the charged one.** A hold now yields an immediate shot AND, past
`CHARGE_FULL`, a charged shot on release. The alternative — suppressing the
press shot whenever a charge might follow — is unimplementable: nothing at
press time knows whether the player intends to hold. Paying the ordinary shot
on release as well was the other option, and it doubles every held shot.

**This also repairs the adaptive triggers.** A `weapon` profile resists and
then GIVES WAY at a point in the travel. With the shot on release, that break
had no relationship to when the gun fired — the clutch let go, and then some
time later, whenever the finger came up, a shot came out. The break is now
the shot. G12's profile table was describing a feel the game did not have.

**Not changed: the onscreen FIRE button.** Same argument does not obviously
apply — it is a thumb on a 38px target, and committing at first contact
rather than when the thumb has settled is a different trade. Routed to
FOR-USER-REVIEW as a feel call rather than assumed.

**TEST MEANING CHANGED (declared per the gauntlet rules).**
`input.spec.ts` "holding past CHARGE_FULL releases a charged shot instead"
asserted `taps === 0` after a press-hold-release. That assertion encoded
G2-c's model, which this directive overturns — it was correct for the old
behaviour and is wrong for the new one, so it was rewritten rather than
accommodated: the replacement reads the fire queue BETWEEN the press and the
release (the actual claim: the shot exists while the trigger is still down),
and still pins `onRelease === 0` so the doubling bug has a guard. The
describe block is renamed from "the pointer model, minus the drag cancel" to
"on the PRESS for a device control", because the old name now describes the
opposite of what the code does.

**Gates:** typecheck, build, 98/98 tests.

---

### G14 — Fire at the break, and three shapes the clutch can make (2026-08-15)

**Hardware result: `zones` works, and so does the HID buzz.** The transport,
the corrected offsets and the Bluetooth framing are all confirmed; `zones` is
now the default and `simple` stays on the DBG cycle for a firmware that
disagrees. That closes G12/G12b.

**BUG — the gun fired as the trigger left its rest position**, on both
encodings. Cause: `pollGamepad` reduced a trigger to `value > TRIGGER_THRESHOLD
|| b.pressed`, and Chrome sets `pressed` on a DualSense trigger at a hair's
deflection — so the `||` collapsed the threshold to nearly zero. G13 had made
the shot land on the press; this made "the press" mean "any movement at all".

**DECISION G14-a — the fire point IS the profile's break.** The snapshot now
carries ANALOG button values and fire tests `value >= padFirePoint()`, read
off the live `TriggerProfile`. Which END of the effect that is depends on the
shape, and this is the part worth getting right rather than averaging:
`weapon` and `slope` fire at the FAR end (a click is felt when it gives way; a
ramp's payoff is the top of the pull), `texture` past its LAST notch (firing
on the first would leave two more notches after the shot with nothing to
mean), `resistance` and `vibration` at the NEAR end (neither has a break, so
the moment is where the wall or the buzz begins).

*Alternative rejected:* a fixed threshold around 0.4. It fixes the bug and
throws away the reason the profile table exists — the clutch would give way
somewhere and the gun would go off somewhere else.

**DECISION G14-b — clamp the fire point, do not branch on the HID link.** A
deep profile has to stay reachable on a pad with NO adaptive triggers, where
there is no physical cue that the break arrived. The tempting fix is
"profile break when connected, fixed threshold otherwise", which would put an
optional, desktop-only, permission-gated transport underneath a sim rule.
Instead the same number serves both, clamped to `FIRE_POINT_MIN/MAX`
(0.25–0.75), and the two profiles that sat outside the band were retuned.

**The three richer shapes.** `vibration` (mode 0x26 — a buzz whose character
is a FREQUENCY, the one parameter in the feature that is not a force),
`slope` (0x21 with a ramped zone table) and `texture` (0x21 with a
hand-authored one). All three are per-zone by nature, so they exist only
under `zones`; under `simple` they degrade to their nearest constant wall
rather than vanishing, because silence is indistinguishable from the bug this
whole encoding switch exists to diagnose.

Retuned with them: the Blaster is a low RATTLE, not a click (a click 7x/s is
fatigue, and it also lies — the gun is not asking you to commit per shot);
Burst is three NOTCHES; Lightning is a fast fine buzz over its wall; Homing
and the Cannon are RAMPS. Shotgun keeps the honest click.

**DECISION G14-c — two profiles are STATE-DRIVEN, and quantised.**
`chargeTrigger(t)` stiffens as the charge ring fills; `THRUST_TRIGGER(speed)`
stiffens as the ship nears its cap. This is the thing an adaptive trigger can
say that no other output in the game can — a static profile is just a nicer
button. Both quantise to five steps at the CALLER, because each distinct
profile is an HID write and the pad's endpoint is not a frame buffer.

**BUG found by the new tests:** the OFF early-out tested `strength <= 0`,
which silently swallowed a slope ramping UP from nothing — the most natural
way to author one. Now tests EFFECTIVE strength.

**Gates:** typecheck, build, 104/104 tests.

---

### G15 — Trigger thrust, and a pad that can reach the menus (2026-08-15)

**Trigger thrust.** `gamepad-thrust`: the left stick supplies DIRECTION only
and L2 supplies magnitude.

**DECISION G15-a — a scheme, not a toggle.** It changes what a stick
deflection MEANS — under `gamepad` the deflection IS the throttle, here it is
discarded — and two answers to that cannot be live at once. It matches
`gamepad` in every touch respect, because the trigger changes what a STICK
means, not what a finger means.

**DECISION G15-b — the throttle's resistance reports SPEED, not throttle
position.** The trigger already knows where it is; the hand is holding it.
What it does not know is whether the ship is doing anything with it, so the
clutch stiffens as the ship approaches its cap and "already flat out" becomes
something felt rather than read. Every other scheme leaves the left trigger
RELEASED — a clutch on a control that does nothing is just a stiff trigger.

**Menu navigation.** A D-pad and two buttons over every overlay.

**DECISION G15-c — drive DOM FOCUS, not React state.** Focus is already the
browser's job: it survives re-renders, brings a focus ring and screen-reader
behaviour, and opens a `<select>` with the OS picker exactly as a tap does.
Nothing in the driver re-renders anything.

**DECISION G15-d — move GEOMETRICALLY, not in DOM order.** There are five
overlays and several hundred controls, most of them generated — the hex
flowers, the inventory honeycomb, the debug rows. A hand-authored focus order
per screen would be wrong within a week of anyone touching the UI, and DOM
order is the right answer for none of the 2-up grids, chip rows and row
columns that share a screen. One scored rule (distance along the direction,
plus cross-axis drift at a penalty) serves all three.

*Alternative rejected:* `roving tabindex` with authored order. More code, per
screen, and it goes stale silently.

**DECISION G15-e — scope by CONTAINER, never by game state.** The driver
finds the live `[data-overlay]` element. It therefore knows nothing about
which screen is up, and a new overlay is navigable the day it is tagged.

**DECISION G15-f — CONFIRM is generic, BACK is not.** CONFIRM clicks whatever
has focus, which needs no game knowledge at all. BACK means something
different per screen, so it lives on `GameEngine.menuBack()` — and does
NOTHING on the death and stage-clear screens, because those are decisions
(respawn / restart / quit; descend / return) and a button that quietly picks
one for you is worse than no button.

The reused buttons (Cross, the D-pad) are safe because menu edges are only
ever SPENT while an overlay is up and the world is frozen: the FIRE queue is
gated on the world, and the D-pad cannot thrust.

**Parking lot: the one-stick two-button scheme** (user request) is written up
in `docs/PARKING_LOT.md` — including that its pieces mostly exist already
(the joystick schemes' aim-where-you-fly rule, the arbitrated interact
trigger), that pause with no Options button is the one genuinely new gap, and
that it is parked rather than built because nobody here has such a pad and
G12 is a standing lesson in what shipping an untestable input path costs.
NOTE: the gauntlet brief froze `docs/PARKING_LOT.md`; this edit is on the
explicit later instruction to park the item, which supersedes it.

**Gates:** typecheck, build, 108/108 tests.

---

### G16 — Any stick, any trigger (user directive, 2026-08-15)

*"The new control with one stick for direction and left trigger for thrust
should use both/either of the joysticks... This allows controllers with one
stick and left and/or right triggers to be able to play."*

G15 shipped `gamepad-thrust` bound to the LEFT stick and the LEFT trigger,
which quietly assumed a full standard pad — the exact assumption the scheme
exists to remove. It is now the MINIMAL-PAD scheme in fact as well as in
intent.

**DECISION G16-a — either stick, larger deflection wins, and it AIMS too.**
A one-stick pad has no second stick to aim with, so the ship aims where it
flies. That rule is not new: it is what the joystick touch schemes already
do (`pointerAims: false` — the stick writes the synthetic pointer), so this
reuses a shipped mechanism rather than adding a second aim model. On a full
pad the two sticks now do the same job rather than fighting; the larger
deflection is the intent, and the other being centred costs nothing.

**DECISION G16-b — either trigger, and therefore the gun moves to the FACE
button.** This is the consequence worth stating plainly: if EITHER trigger
may be the throttle, then NEITHER can be the gun, or a pad with only a right
trigger would fire every time it accelerated. `FIRE_FACE` ([0]) replaces
`FIRE` ([7, 0]) under this scheme. Full-pad players who want R2-as-gun have
the plain `gamepad` scheme, which is untouched.

*Alternative rejected:* detect which triggers the pad has and bind
accordingly. The Gamepad API reports a fixed 17 buttons under the standard
mapping whether or not the hardware has them, so "has an L2" is not
answerable — and a non-standard pad reports an arbitrary layout. Reading zero
forever from a control that is not there is the honest version of the same
thing, and needs no detection at all.

Both triggers therefore carry the speed-ramped `THRUST_TRIGGER` under this
scheme; a weapon profile on the right trigger would be describing a control
the player is not using.

**BUG (reported) — the adaptive-triggers control "no longer appears".** NOT
REPRODUCED as a code fault: the control's source is unchanged since G12, and
a test that stubs `navigator.hid` before boot confirms it renders. What IS
true is that it only ever existed in ONE place — the bottom of the pause
menu's Controls block, below the entire cargo/outfitting panel — and the
headless suites have no `navigator.hid`, so **every existing assertion about
it was asserting the ABSENT branch**. The feature had no coverage at all in
the state where it does something.

Fixed on both counts: it now renders in the MAIN MENU too (beside the scheme
picker, where a player sets their hands up before playing — a short screen,
not a long scroll), and a new test stubs WebHID and pins its presence in
BOTH menus. That test is the durable part; the placement is what the user
actually asked for.

**Gates:** typecheck, build, 111/111 tests.

---

### G-final — Validation (2026-08-12)

- **Three gates × 3 consecutive runs: green.** typecheck, build, and 74/74
  tests, three times over, ~3.4 minutes per test run.
- **CI green on the branch** — the gate this gauntlet's own first milestone
  finished. Verified on PR #84.
- **Phone-scale.** Everything new was built and asserted at 390×844: the
  help panel's fit (document scroll width AND every row's rect), the
  joystick's zone and thumb-sized geometry, the minimap captures, the
  material captures.
- **Durable tests: +36.** 38 → 74. `input.spec.ts` (23), `minimap.spec.ts`
  (6), `maps.spec.ts` (4), `help.spec.ts` (3).
- **Docs synced.** CLAUDE.md §2 (InputSystem, hud.ts, the tests line), §5
  (both new INPUT_CONSTANTS blocks, `MINIMAP_CONSTANTS.FLOW` /
  `STATION_BLIP`, ROCK_PALETTES / METAL_BRIGHT_TARGET, MAP_POPULATION's
  promotion to authority), §6a (no map hardcodes a ratio), §7 + §9 (the
  cached CI gate and its new push trigger), §8 (a new input-devices
  convention, a new minimap convention, the portal-arrow change, the new DBG
  rows, the help panel). `tests/README.md` gained four suite rows and two
  new harness rules — both of them flakes this session actually paid for.

**Two harness rules were learned the hard way and are now written down**, in
`tests/README.md` as rules 8 and 9, because both cost real debugging time:

1. Anything queue-shaped must be fed and read in ONE page evaluation — the
   engine's loop drains the fire queues and the interact latch every frame,
   so a read in the next round-trip sees an empty queue. Better still, assert
   a durable consequence (a spawned projectile) instead of the transient.
2. `waitForStats` predicates are STRINGIFIED, so a closed-over test variable
   does not exist in the page: the predicate throws `ReferenceError` and
   surfaces as an unexplained timeout, not as a failed assertion.

---

### G9 — Control schemes (user directive, 2026-08-12)

Added AFTER the queue closed, on the user's direction: *"the onscreen touch
joystick controls and the standard touch controls should be separate. Let's
include a control type selection at game start and have separate options for
standard touch/mouse and joystick touch controls (use a button for shooting)
as well as the other existing control options. The physical controller and
keyboard option should also allow simultaneous touch control."*

**What G3 got wrong.** The joystick shipped as a LAYER on top of the existing
touch model — a stick in the left zone, the old drag-to-fly gesture
everywhere else. G3's own decision G3-d argued for that ("a player who never
discovers the stick loses nothing"), and it is the thing this milestone
undoes. The two models compete for the same finger: with both live, whether a
touch flies the ship *directly* or moves a stick depends on which side of an
invisible boundary it landed on, and the player is never told which mode they
are in. They are two ways to drive the same ship, so they are two SCHEMES.

**DECISION G9-a — the scheme is a PREFERENCE, shaped like difficulty.**
Picked on the main menu next to DIFFICULTY, changeable from the pause menu
(picking wrong at the front door should cost a tap, not a restart), and it
survives `restartGame()` and every map load — it describes the player's
hands, not the run. No new persistence layer: this repo has none, and
difficulty already sets the precedent for a menu preference living on the
engine.

**DECISION G9-b — one rules TABLE, not a scheme name compared in five
places.** `CONTROL_SCHEME_RULES` has a row per scheme and five booleans:

| scheme | joystick+button | mouse drags ship | touch drags ship | tap fires |
|---|---|---|---|---|
| `touch` | no | yes | yes | yes |
| `joystick` | **yes** | no | no (stick) | no (button) |
| `keyboard` | no | **no** | yes | yes |
| `gamepad` | no | **no** | yes | yes |

**DECISION G9-c — keyboard and controller keep touch, and lose the MOUSE
drag.** "Should also allow simultaneous touch control" is honoured
literally: a finger still flies the ship on both. What they additionally do
is stop the *mouse* from dragging the ship, which required tracking whether
the live pointer session came from a finger or a mouse (they share
`mouseDown` / `mousePosition`). That is a real improvement in its own right —
on a keyboard you steer with WASD, and holding the mouse to move while
clicking to shoot is the worst of both. `keyboard` and `gamepad` are
therefore identical in TOUCH behaviour; what differs is which block the help
panel marks as active. Recorded rather than papered over.

**DECISION G9-d — the fire button is visible from the first frame, and
clickable.** The joystick can afford to appear only under a thumb because it
appears WHERE the thumb lands. A button cannot: invisible until pressed means
unfindable, and in this scheme it is the only way to shoot. It follows that
it also takes a mouse press — a control the player can see is one they will
try to click — which incidentally makes the scheme testable on a desktop.
It sits above the loadout strip on the right, mirroring the stick's side, and
its rect is carved out of both the joystick zone and the aim gesture. Its
ring doubles as the charge readout, filling over the same window as the ring
on the ship.

**DECISION G9-e — the fire button keeps the one shooting model.** Tap =
shot; hold past `CHARGE_FULL` and release = charged shot. Same as tap-to-fire,
same as the pad trigger. A fire button that auto-repeats is the obvious
alternative and it is the SAME open question already logged for the pad
trigger — it cannot coexist with hold-to-charge on one control. Both stay in
FOR-USER-REVIEW as one decision, not two.

**A latent bug fixed on the way.** Device-raised shots (the fire button, and
the pad trigger since G2) now go into their own queue that bypasses the tap
handler. They used to enter `fireEvents`, which the engine first offers to
the minimap toggle, the loadout slots and `claimTapNear` — so a pad shot
aimed straight DOWN with the minimap expanded toggled the map instead of
firing. A synthesised shot is aimed at the world; only a real tap can be
meant for a HUD widget.

**Tests changed, and why the change is legitimate** (the standing rule is
that no test may be edited to accommodate a change unless the ledger says why
its meaning legitimately changed):

- **Seven joystick tests now select the joystick scheme first.** The widget
  is no longer unconditional, which is the entire point of the milestone; the
  assertions themselves are untouched.
- **Three pad-fire tests read `getDeviceFireEvents()` instead of
  `getFireEvents()`.** The queue a device shot lands in changed, deliberately
  and for correctness — see the bug above.
- **One test was rewritten rather than repaired.** "The aim thumb still fires
  while the stick is held" asserted behaviour the user has now ruled out. It
  is now "the aim thumb AIMS and the button SHOOTS, both while the stick is
  held", which asserts the three-way the scheme exists to make possible —
  and it asserts the tap does NOT fire, so the old behaviour cannot creep
  back.

Six new scheme tests cover the rest: the default, the same touch in the same
place behaving differently under two schemes, the mouse/finger split on
keyboard and controller, WASD working under every scheme, the button's charge
hold, and switching mid-run releasing whatever the old scheme held (a stick
deflected through a switch would otherwise thrust forever with no widget on
screen to explain it).

**Gates:** typecheck, build, **81/81** tests (74 + 7).

---

### G10 — Aim from the stick, handedness, and a dropdown (user directive, 2026-08-13)

Three follow-ups on G9, all from the user: *"Joystick on screen controls
should aim wherever the player is flying. There should also be two different
handed versions (joystick left and button right, joystick right and button
left). Controls should be changeable in the pause menu - preferably a drop
down menu."*

**DECISION G10-a — the stick writes the SYNTHETIC POINTER, so the ship aims
where it flies.** This is G2-a's trick applied to the third device: the stick
parks the virtual cursor `AIM_RADIUS` out along its heading, and the hull's
rotation and every shot's target follow through the paths the mouse already
drives. Nothing in the engine changed. The heading persists when the thumb
lifts, exactly as a released pad stick does.
*Alternative rejected:* rotating the ship from `stickVec` at the engine's
rotation site. That is a second definition of "where is the ship aiming", and
the shooting site would need the same branch — the exact split G2-a avoided.

**DECISION G10-b — the joystick schemes turn POINTER AIMING off.** With the
stick aiming, a drag on the far side of the screen would fight it, and the
old right-side aim drag now has nothing to do. So `pointerAims` is false in
both joystick schemes: a stray finger cannot yank the nose. The touch is
still TRACKED, because a tap still docks the ship and still reaches the
minimap and the loadout slots — it just no longer aims or fires.

**DECISION G10-c — handedness is two SCHEMES, not a second setting.**
`joystick-left` (stick left, fire right) and `joystick-right` (mirrored).
They share one rules row shape with a `stickSide` field; the zone test and
the button's centre both read it.
*Alternative rejected:* a separate handedness toggle beside the scheme
picker. It is a second control for something the player picks once, and it
only means anything for two of the five schemes — a setting that is inert
most of the time is a setting that confuses.

**A layout consequence worth stating:** on the LEFT the fire button cannot
use the same margin, because the minimap already owns that corner — a button
on top of the map toggle costs the player their map. The mirrored layout
sits it higher (`MARGIN_Y_MIRRORED`), clear of the collapsed minimap, and a
test asserts that clearance rather than trusting the arithmetic.

**DECISION G10-d — a native `<select>` in the pause menu; the grid stays on
the main menu.** The dropdown was asked for and it is right there: on a phone
a native select opens the OS picker, which is a better target than anything
drawn in-canvas, and it brings keyboard and screen-reader behaviour for free.
The pause menu is already a long scroll and five captioned buttons would push
the rest of it down for a setting most players touch once. The MAIN menu keeps
the grid, because game start is where the alternatives should be visible with
their one-line blurbs rather than hidden behind a closed control.

**Tests.** The "aim thumb AIMS and the button SHOOTS" test from G9 was
rewritten again — its premise (a right-side drag aims) is what this milestone
removes. It is now "the ship aims where it flies, and only the button
shoots", asserting the nose follows the stick through two headings, that a
stray finger changes neither the aim nor fires, and that the button still
shoots with the stick held. Plus a mirroring test (zone swapped, button
swapped AND clear of the minimap, and it still flies) and a dropdown test
(every scheme reachable, including both handednesses, and the change lands
mid-run).

**Gates:** typecheck, build, **83/83** tests.

---

### G11 — Force feedback (user directive, 2026-08-14)

The user asked whether the PS5 pad's force feedback is usable. It is, in the
one form the web exposes, and it now ships.

**DECISION G11-a — rumble rides the SCREEN SHAKE.**
`GameEngine.handleScreenShake(amount)` is already the funnel every impact in
the game goes through — crashes, explosions, cannon recoil, boss deaths, a
dozen call sites — with magnitudes long since tuned against each other.
`InputSystem.rumble(amount)` hangs off that one call, so the hand feels what
the camera feels and there is no second list of "things that should buzz" to
drift out of sync with the first.
*Alternative rejected:* a per-event rumble table. It is the same information
twice, and the second copy is the one that goes stale.

It is called ABOVE the screen-shake early-return and has its own DBG row:
wanting a crash in the hand and wanting the camera to lurch are different
preferences, and only one of them is felt by a player with no pad.

**DECISION G11-b — `dual-rumble` only; no WebHID.** Two magnitudes, a strong
low-frequency motor and a weak high-frequency one, which is the whole of what
the Gamepad API offers. The DualSense's actual party tricks — adaptive
trigger resistance, the voice-coil haptics, the light bar — need raw HID
output reports, i.e. WebHID: Chrome/Edge **desktop only**, never Safari, never
mobile, and on Bluetooth it needs the CRC-checked 0x31 report that some
firmware rejects. A control that works on the desktop browser and nowhere
else is not the game's input layer; it is a separate optional enhancement,
and it is recorded in FOR-USER-REVIEW rather than built.

**DECISION G11-c — the same split as the pad mapping: pure decision, opaque
device.** `rumbleParamsFor(amount, nowMs)` is pure and takes the clock as an
argument, so the threshold (below MEDIUM nothing buzzes — a pad that rattles
on every projectile plink is a pad you switch off), the curve, the minimum
gap and the interrupt rule are all testable headlessly. Only the actuator is
stood in for, because a headless browser has no motors.

**Two bugs, both found by writing the tests:**
1. **The first impact of the session was swallowed.** `rumbleUntilMs`
   initialised to `0`, and the minimum-gap rule read that as "an effect just
   finished at time zero". It is `-Infinity` now — an explicit "never played"
   sentinel.
2. **A rejected `playEffect` would have failed every suite.** The promise
   rejects on a browser that knows the method but not the effect type, and an
   unhandled rejection lands in the console, which every test asserts is
   clean. It is swallowed, and the flag it sets means an unsupported browser
   is asked exactly once rather than on every impact for the rest of the run.

**Two legibility fixes rode along**, both from the same question ("what else
works?"):
- **Non-standard pads are flagged.** Every binding is an INDEX into the W3C
  standard layout, so a pad the browser cannot map to it has its buttons
  wherever its firmware put them. It is still adopted — a scrambled pad that
  flies beats no pad — but the DBG readout now shows `⚠non-std`, which is the
  difference between "the pad is broken" and "this pad is non-standard".
- **The help panel names buttons by POSITION.** It said "R2 or ✕" and "□";
  the bindings are positional, so an Xbox player was reading glyphs their pad
  does not have. Now "Right trigger", "Left face button (□ on PlayStation, X
  on Xbox)".

**Gates:** typecheck, build, **87/87** tests (83 + 4).

**Unverifiable by construction:** there is no pad in this environment and none
headless, so every assertion here is about the code in front of the motors.
Whether a DualSense actually buzzes, and whether the curve feels right, is on
the hardware checklist.

Which is why a **third DBG line** was added, Player ▸ **↳ rumble**: silence has
four different causes on real hardware — the toggle is off, no pad is adopted,
the pad has no actuator, or the browser refused the effect — and "nothing
happened" covers all four identically. The row names which one. It is the
only diagnostic in the input layer that exists purely because the thing it
describes cannot be tested here.

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
- **G7-a** — metal brightens toward an explicit steel-blue. Beat: scaling
  every channel (arithmetically a march toward white, which was the bug).
- **G7-b** — rock ships the `mixed` palette. Beat: pure rust or mineral
  (reads as a themed map, not as rock).
- **G7-c** — metal's proximity glow goes magenta → cyan. Beat: keeping a
  legacy fuchsia on the game's coldest material.
- **G7-d** — the table was corrected to the code's populations, not the
  reverse. Beat: "fixing" the maps to match a table nothing had read for
  months, which would have been a silent rebalance.
- **G11-a** — rumble rides `handleScreenShake`. Beat: a per-event rumble
  table (the same information twice, with one copy going stale).
- **G11-b** — `dual-rumble` only; WebHID left to FOR-USER-REVIEW. Beat:
  building adaptive triggers into the input layer for a desktop-Chromium-only
  path that Safari and every mobile browser lack.
- **G11-c** — pure `rumbleParamsFor(amount, nowMs)`, stand-in actuator. Beat:
  an untestable device call, which would have shipped both bugs above.
- **G10-a** — the stick writes the synthetic pointer, so aim follows flight.
  Beat: rotating from the stick vector at the engine's rotation site (a second
  definition of aim, needing the same branch at the shooting site).
- **G10-b** — pointer aiming is off under the joystick schemes. Beat: leaving
  a right-side drag able to fight the stick for the nose.
- **G10-c** — handedness is two schemes. Beat: a separate toggle that is inert
  for three of the five schemes.
- **G10-d** — dropdown in the pause menu, grid on the main menu. Beat: one
  widget everywhere (either a long scroll mid-run, or hidden alternatives at
  game start).
- **G9-a** — the scheme is a preference shaped like difficulty (menu + pause,
  survives restarts). Beat: a new persistence layer this repo does not have.
- **G9-b** — one `CONTROL_SCHEME_RULES` table. Beat: the scheme name compared
  at each of the five sites that care.
- **G9-c** — keyboard/controller keep touch and lose the mouse drag. Beat:
  making them touch-free (contradicts the directive) or leaving the mouse
  dragging the ship while you steer with keys.
- **G9-d** — the fire button draws from the first frame and takes a mouse
  press. Beat: the joystick's appear-under-a-thumb rule, which makes an
  unfindable button.
- **G9-e** — the fire button uses the one shooting model. Beat: auto-repeat,
  which is the same open question as the pad trigger and belongs with it.
- **G7-e** — Seven Rings' mix is `tileRings`; its geometry stays on the
  class. Beat: pushing ring count and radii into the population table too.
- **G6** — portal arrows keep the range gate and lose the on-screen
  exemption and the distance readout. Beat: direction 1, obey-all-the-rules
  (four permanent arrows on the hub's edge competing with threats), and
  direction 3, a waypoint navigation layer (a new HUD language in the session
  that spent G4/G5 reducing them; it belongs with the persistence work).
- **G12-a** — WebHID lives in its own module that imports nothing. Beat:
  folding it into `InputSystem`, i.e. a platform branch inside the one file
  that enforces "three devices, one set of inputs".
- **G12-b** — output only; input stays the Gamepad API. Beat: reading the pad
  over HID too, which can flip a Bluetooth DualSense's input-report mode and
  cost the player their sticks to gain trigger resistance.
- **G12-c** — a button under the scheme dropdown, rendered only where WebHID
  exists. Beat: a sixth control scheme (implies a trade-off that does not
  exist), and a disabled row explaining itself (longer pause menu on the
  device with the least room, to say "no").
- **G12-d** — sync the profile from what is HELD, beside the charge ring.
  Beat: a weapon-change hook, which cannot see "charging" — the state a
  clutch is best at.
- **G12-e** — pin CRC-32 and the report SHAPE via `window.__omniHid`, and put
  the sent bytes in the DBG row. Beat: shipping unverifiable offsets with no
  way to correct them, on hardware that answers a malformed report with
  silence.
- **G12b-a** — ship both wire encodings behind a DBG cycle. Beat: picking the
  likelier one and shipping again, which is the move that made this milestone
  necessary.
- **G12b-b** — profiles in normalised units, converted at the wire. Beat: wire
  units in `constants.ts`, where an out-of-range value looks reasonable.
- **G12b-c** — bisect with a rumble pulse over the same HID path. Beat:
  another round of "try it now", which cannot separate a dead transport from
  a wrong encoding.
- **G13-a** — dedicated fire controls fire on PRESS; pointer gestures fire on
  release. Beat: G2-c's "one fire model across all three devices", which made
  the pad inherit a release-wait that only the tap's drag ambiguity justifies.
- **G14-a** — the fire point IS the adaptive profile's break, per shape.
  Beat: a fixed threshold, which fixes the bug and throws away the reason the
  profile table exists.
- **G14-b** — clamp the fire point rather than branching on the HID link.
  Beat: "profile break when connected, fixed threshold otherwise", which puts
  an optional desktop-only transport underneath a sim rule.
- **G14-c** — charge and thrust profiles are state-driven and quantised at the
  caller. Beat: static profiles (a nicer button), and per-frame writes (the
  pad's endpoint is not a frame buffer).
- **G16-a** — either stick steers AND aims under trigger-thrust. Beat: a
  second aim model; the joystick schemes' aim-where-you-fly rule already
  existed and is what a one-stick pad needs.
- **G16-b** — either trigger throttles, so the gun moves to the face button.
  Beat: detecting which triggers the pad has (the Gamepad API reports 17
  buttons whether or not the hardware has them, so it is not answerable).
- **G16-c** — the adaptive control renders in BOTH menus, and a test stubs
  WebHID to pin it. Beat: leaving it in one place at the bottom of a long
  scroll, with every existing assertion covering only the ABSENT branch.
- **G15-a** — trigger thrust is a SCHEME. Beat: a toggle, which would leave
  two readings of a stick deflection live at once.
- **G15-b** — the throttle's resistance reports the ship's SPEED. Beat:
  reporting throttle position, which the hand already knows.
- **G15-c/d/e** — menu nav drives DOM focus, moves geometrically, and scopes
  itself by `[data-overlay]` container. Beat: roving tabindex with an
  authored order per screen (more code, goes stale silently), DOM order (right
  for none of the layouts on a single screen), and switching on game state
  (a new overlay would need driver changes).
- **G15-f** — CONFIRM is generic, BACK is per-screen and inert on the two
  DECISION screens. Beat: a back button that quietly picks respawn or
  descend for you.
- **G13-b** — the press pays the ordinary shot, the release still pays the
  charged one. Beat: suppressing the press shot when a charge might follow
  (nothing at press time knows), and paying both (doubles every held shot).

---

## Completion summary

Eight milestones queued, seven shipped, one cut (G8, the optional ambience
item — see its entry for why). 74 tests, up from 38. Three gates green ×3;
CI green on PR #84.

**What shipped, in one line each:**

| | |
|---|---|
| **G1** | The CI gate finished: it already existed, so this added the plan-branch push trigger, a keyed Chromium cache, and a corrected README. |
| **G2** | Gamepad support. The pad writes the same movement vector, synthetic pointer and fire queues the mouse writes, so aiming and shooting work without being built — and the controller button closed the `selected` seam CLAUDE.md §8 had reserved for it. |
| **G3** | A floating touch joystick, and touch became two-handed. Its zone is defined by what it refuses — above all the ship-select disc, without which docking-by-tap silently breaks. |
| **G4** | One Controls & Basics panel, hosted by both menus, accurate to what G2/G3 actually bound. |
| **G5** | The minimap stopped drawing every rock and started drawing the current: nebula gone, shard dots replaced by flow streamlines, contacts wearing the indicator legend's colours. |
| **G6** | The portal arrow stopped naming a place already on screen, and stopped being the only contact exempt from the rules. |
| **G7** | Metal de-whited toward a real steel-blue, rock got a palette, and `MAP_POPULATION` became the authority it had only been documented as. |

**Three things worth carrying forward beyond this branch:**

1. **A sequential A/B on a noisy host reports whatever order you sampled
   in.** G5's first measurement had the mode that does strictly LESS work
   coming out 3 ms slower than the others. Interleave, always.
2. **Per-point torus math is not enough for a polyline.** Consecutive points
   either side of the wrap seam draw a chord across the whole map. The
   streamline layer needed an explicit seam break; anything else that draws
   a path in world space will too.
3. **Some things are only decidable by looking.** G5's default and G7's
   palettes were both settled from captures at 390×844, and two rendering
   bugs (over-long streamlines, a hot pink halo on cold metal) were invisible
   to every number available.

---

## FOR-USER-REVIEW

Items needing a human — judgment calls, and things only real hardware can
answer. **Led by the hardware checklist, which is the one thing this session
could not do for itself.**

The standalone preview build for this PR (posted by the preview bot on every
push, opens on an iPhone) is the fastest way to run these:
`https://raw.githack.com/i-r0n/omni-standalone/main/previews/pr-84/index.html`

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

- **JUDGMENT CALL — the minimap's material default (G5).** Shipped as
  `flow`. Perf did not decide it (all three modes are inside the noise
  floor), so it was decided from captures: `dots` camouflages the actual
  contacts among ~1 400 identical marks. Flip Visual ▸ "Minimap mat" in
  motion and see whether you agree — the DBG cycle exists exactly so this
  can be overturned by looking rather than by arguing.

- **JUDGMENT CALL — the material palettes (G7).** Rock ships `mixed` (mostly
  slate, with rust and mineral running through it); the pure `rust` and
  `mineral` families are on the DBG cycle and are the obvious raw material
  for regional identity later. Metal now brightens toward `#a5d8f0` and
  glows cyan instead of magenta. All four are aesthetic calls made from
  captures; every one is a constant and a DBG row away from being changed.

- **HARDWARE CHECK — rumble (G11). PARTLY ANSWERED.** Confirmed working in
  desktop Edge and desktop Safari; confirmed IMPOSSIBLE on iPhone (iOS WebKit
  exposes no actuator, and every iOS browser is WebKit — the route there is a
  native build). Still open: (b) the
  curve feels right — nothing below an enemy collision buzzes, a high-speed
  crash is the loudest thing; (c) a firefight does not become one continuous
  drone (there is a minimum gap and a stronger-only interrupt rule, but they
  are guesses).

- **PARKED — controller-scheme refinement (user call, 2026-08-15).** The
  trigger-feel questions (are the seven profiles well authored? do the two
  state-driven ones land?) and the minimal-pad questions (does
  stick-plus-trigger beat the stick doing both? is losing R2-as-gun a
  problem?) are moved to `docs/PARKING_LOT.md` — "Controller schemes —
  refinement pass". Both schemes are shipped, tested and untuned; the
  remaining work is looking-and-feeling, not building, and the user has
  called it good for now.
- **SUPERSEDED — the encoding question (G12b).** Two certain bugs are fixed (trigger blocks were one byte late; the
  Bluetooth report was 24 bytes short, so it was being dropped outright).
  What remains is a genuine fork nothing here can resolve. Do this in order:
  1. Connect (pause ▸ Controls ▸ *Connect DualSense Triggers*). **USB-C
     first** — it removes the CRC and the BT framing from the picture
     entirely.
  2. Pause ▸ Debug Menu ▸ **"↳ HID buzz"** ▸ Test. **If the pad does not
     buzz, stop** — nothing is reaching it, and the answer is on the
     "↳ triggers" row (Chrome names a length mismatch or a refused open;
     Steam or DS4Windows holding the device exclusively is the usual
     culprit). Report that string.
  3. If it buzzes, the transport is proven and only the effect encoding is in
     question. Fly with the Blaster, then cycle **"↳ trig enc"** between
     `zones` and `simple`. One of them should make the right trigger stiffen.
  4. With the working one selected: do the guns feel DIFFERENT — Blaster
     light and early, Cannon deep and heavy, Laser and Lightning a constant
     push with no click? Does a charged hold put up a wall, and does an EMP
     make the trigger go slack?
  Report which encoding won and it becomes the default, with the cycle kept
  as a DBG row. **Not built, still available:** the voice-coil haptics and the
  light bar, over the same transport.

- **FEEL CALL — should the ONSCREEN FIRE BUTTON also fire on press?** G13
  moved the pad trigger to press-to-fire; the button was deliberately left on
  release. The trigger's case is clean (no gesture ambiguity, and the delay
  reads as lag); the button's is not, because it is a thumb on a 38px target
  and committing at first contact rather than when the thumb has settled may
  read as misfiring. One line to change if you want it.

- **OPEN QUESTION — should a held FIRE CONTROL auto-repeat?** Today none of
  them do: the pad trigger and the onscreen fire button both use the same
  tap-or-charge model as mouse and touch (decisions G2-c, G9-e). Convention
  says a held trigger — and especially a held fire BUTTON — should stream
  shots, but that cannot coexist with hold-to-charge on the same control. If
  auto-repeat is wanted, the charged shot needs its own control (L2 is free
  on the pad; a second, smaller button beside the fire button on touch), and
  it is a small change plus a help-panel edit. **Judge it on hardware** — it
  is one decision covering both controls, not two.

- **HARDWARE CHECK — the control schemes (G9).** Pick each on the main menu
  and play a minute. Specifically: does *Joystick* feel better than *Touch*
  on the phone, and is the fire button in the right place for a right thumb
  (it sits above the loadout strip, 58 px in from the right, 110 px up)? Is
  the default right — should a phone open on *Joystick* rather than *Touch*?
  Nothing detects the device today; the default is standard touch because it
  is what the game has always done.

- **Branch protection is a repo setting, not a file.** The workflow reports;
  it does not refuse a merge. Making `typecheck · build · test` *blocking*
  requires branch protection on `main` (and, while this plan runs, on
  `claude/plan-completion`) listing it as a required status check. CLAUDE.md
  §7 already says this; noting it here because G1 is the milestone that makes
  it actionable, and nothing this session can do will enforce it.
