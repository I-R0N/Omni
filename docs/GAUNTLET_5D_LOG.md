# Gauntlet 5d — UI coherence + legibility pass

Ledger for roadmap item **5d** (`docs/GAME_FEEDBACK_PLAN.md`, decision
#47b): ONE coherence / legibility sweep over the COMPLETE UI surface, run
after step 5 (Pair C + polish) and the Pair B SFX merge, and before the
step-6 tuning pass.

**This is not a redesign.** The game has a flat, functional visual
language — restrained glows, Tailwind utilities on the DOM side, a
canvas-drawn world HUD — and the job is to make every surface speak that
language *consistently*, not to invent a new one.

**Scope boundaries** (from the session brief):

- UI only. `EngineStats` may grow fields to surface data; no game-logic,
  physics, economy or audio-engine changes. A UI fix that seems to need a
  sim change goes to FOR-USER-REVIEW instead.
- Coherence WITH the existing language. No new CSS frameworks, no
  animation libraries, no fonts.
- Aesthetics are judgment calls: prefer the smallest unifying change and
  log the call; anything larger goes to FOR-USER-REVIEW with a
  before/after pair rather than being decided silently.

Branch `claude/gauntlet-5d-ui-coherence-idqcdk`, off the
`claude/plan-completion` tip (96efa03). PR targets
`claude/plan-completion`.

---

## Checklist

| # | Milestone | State |
|---|---|---|
| U1 | Audit every surface, no fixes | **done** |
| U2 | DOM coherence fixes (`components/UIOverlay.tsx`) | **done** |
| U3 | Canvas HUD coherence (`engine/systems/render/hud.ts`) | **done** |
| U4 | Viewport coverage matrix + mid-session resize | **done** |
| U5 | OPTIONAL — damage-triggered health/shield bars | **done** |
| U-final | Validation + handoff | **done** |

Three gates green before every commit: `npm run build`,
`npm run typecheck`, `npm test`. CI green on the branch before the PR.

---

## Iteration log

### U1 — Audit (no fixes)

**Harness.** A standalone Playwright script (scratchpad, deliberately NOT
committed — it is a one-off audit tool, and the parameterised viewport
work that *is* worth keeping lands in `tests/` at U4) drives the same
`window.__omniEngine` / `window.__omniStats` debug handles the smoke
suites use, walks all 13 surfaces, screenshots each, and measures the DOM
it just photographed: every visible interactive element's rect (tap-target
floor + horizontal overflow), a font-size histogram over
`[data-overlay]` subtrees, and the class-string "recipe" of every panel
and heading. Nothing is eyeballed that could be counted.

**Screenshot inventory** (390×844, dpr 2; stored in the scratchpad, not
the repo, per the brief):

| # | Surface | How it was reached |
|---|---|---|
| 01 | Main menu | boot |
| 02 | Main menu ▸ Controls & Basics | `menu-help-toggle` |
| 03 | Main menu ▸ Debug Menu | `menu-debug-toggle` |
| 04 | In-game HUD, hub | `startGame`, score + salvage seeded |
| 05 | In-game HUD, arena: boss bar + wave banner + status badges + indicators | `transitionToMap('arena_universe')`, `debugSpawnBoss`, corrosion + EMP |
| 06 | HUD, minimap | `minimapExpanded` |
| 07 | Pause menu | `pauseGame` |
| 08 | Pause ▸ Debug Menu | section toggle |
| 09 | Pause ▸ Controls & Basics | `pause-help-toggle` |
| 10 | Station / outfitting + shop | dock at the Trade Hub, hull at 40% |
| 11 | Station, stat row expanded | `stat-*` row |
| 12 | Stage-clear | boss killed through the real death path |
| 13 | Death / run summary | `startExplosion(player)` |

Console clean (0 errors) across the whole walk. Document scroll width
never exceeded the viewport on any surface — the *horizontal* overflow
guard the suites already assert holds; every finding below is something
that guard cannot see.

Also captured at 320×568 and 1024×768 to inform ranking; those feed U4.

#### Findings, ranked by reader impact

**A — misinforms or blocks the player**

**A1. The boss bar lands on top of the Salvage chip.** (390×844, during
every capstone fight.) Measured rects: boss bar
`[15, 56, 374, 100]`, salvage chip `[216, 58, 320, 96]` — the chip is
100% vertically and 104 px horizontally inside the bar. The boss bar is
`absolute top-14 … w-[min(560px,92vw)]`, positioned against a top bar
that was one or two chips deep; the chip stack now runs score → salvage →
combo → status effects → wave and grows *downward* into it. Screenshot
05 shows `◈ 50,000` bisected by the boss health bar. Two independently
correct components with no shared idea of the band they share.

**A2. The two hex flowers overlap by 20 px.** (Pause AND station, 390×844.)
Measured: ship flower spans x `[15, 205]`, weapon flower `[185, 375]`,
inside a 332 px panel. `renderHexGroup` sizes its inner box at a fixed
`HEXW * 2.5 + 10 = 200 px`; the `grid-cols-2 gap-2` column is ~162 px, so
each flower overflows its column and they meet in the middle. This is not
only cosmetic: the flowers are pointer drag-and-drop targets and
`document.elementFromPoint` resolves the *topmost* `[data-tile]`, so an
overlapping region can take a drop meant for its neighbour.
At **320×568** the same root cause gets worse: the outer hexes leave the
viewport on *both* sides (measured x `-2.5` and `322.5` against a 320 px
window) — the only element that overflows horizontally anywhere in the
whole walk, at any viewport.

**A3. `data-overlay` is swapped between the death and stage-clear panels.**
`UIOverlay.tsx:2064` tags the stage-clear panel `data-overlay="death"`;
`:2156` tags the death panel `data-overlay="stage-clear"`. That attribute
is the scoping key for the gamepad menu driver (`components/menuNav.ts`,
CLAUDE.md §8: "the driver scopes itself by `[data-overlay]` CONTAINER").
Harmless today only because `menuBack()` deliberately does nothing on
either screen — i.e. the bug is masked by an unrelated decision, which is
exactly the kind of thing that bites the next person to touch it.

**B — layout breaks on the design target (390×844)**

**B1. Screen titles wrap to two lines.** `PLAYER MENU` measures 72 px tall
against a 36 px line-height; the station's `⬡ TRADE HUB` does the same.
`text-3xl` + `tracking-[0.2em]` is wider than 390 px for both. Screenshots
07 and 10.

**B2. The salvage chip beside those titles wraps too** — `◈ 50,000 Salvage`
is 40 px tall against a 20 px line-height. The header row is a
`justify-between` flex with two items that both want more width than the
row has.

**B3. The `Guns n/2` chip wraps out of its heading.** The Weapon Systems
`h3` measures 33 px instead of ~15 px, which is what pushes the weapon
flower down relative to the ship flower in screenshots 07 and 10.

**C — token and vocabulary drift**

**C1. The primary action button is three different colours.** Station
UNDOCK, pause CONTINUE and death RESPAWN are `emerald-600`; stage-clear
CONTINUE is `amber-600`; main-menu START is `indigo-600`. Two shapes as
well (`rounded-lg py-3` vs `rounded-full py-4 text-xl`) and two label
treatments (`tracking-widest uppercase` vs plain). Five overlays, five
answers to "what does the button you are supposed to press look like".

**C2. Three neutral-panel recipes that mean the same thing.** Counted
across the walk: `bg-slate-800/60 border-slate-600/40 p-3` (×16),
`bg-slate-900/70 border-slate-700/60 px-3 py-2` (×6),
`bg-slate-900/60 border-slate-700/60 px-3 py-2` (×5). Plus five accent
variants that *are* meaningful (amber shop, rose repair, sky outfitting,
emerald reward, `PANEL_OPAQUE` debug) and should stay.

**C3. HUD chip padding differs inside one vertical stack.** Score,
salvage and wave chips are `px-4 py-1.5`; the status-effect badges are
`px-3 py-1`. Same family, same column, ragged left edges (screenshot 05).

**C4. Eleven distinct type sizes.** Histogram over visible text nodes:
36/30/20/16/14/12/11/10/9/8/7 px. The 12 px (×235), 11 px (×338) and
10 px (×35) bands do the same job with no rule separating them, and 7 px
(the `W1`/`W2` gun badge and the `OFFLINE` tag) is below any readability
floor on glass.

**C5. Four treatments for one control.** The collapsible section toggle
appears as sky-300/80 with `py-2 px-3` (Controls & Basics), amber-400/80
with no padding (Debug Menu), slate-400 with no padding (Switch Map /
Test), and slate-500 at 10 px (Material Field Maps). The padding
difference is also a tap-target difference — see D.

**C6. Section-heading class strings vary in token ORDER** (colour first
vs colour last) while being otherwise identical. Cosmetic in the source,
but it is the reason the drift above went unnoticed: two spellings of one
recipe defeat a grep.

**D — tap targets under the 40 px floor**

`screens.spec.ts` already asserts a 40 px floor, but only on the three
death-screen buttons. Everything else measured below it:

| Control | Measured | Surface |
|---|---|---|
| `menu-debug-toggle` | 98 × **16.5** | main menu |
| Switch Map / Test, Debug Menu toggles | same shape | pause |
| Shop purchase rows | 163 × **24.5** | station |
| Ship Status stat rows | 332 × 28 | pause + station |
| Mute | **36 × 36** | pause |
| Master volume slider | 194 × 16 | pause |
| Repair | 131 × 32 | station |
| `scheme-select`, adaptive-triggers toggle | 332 × 34 | both menus |
| Help toggles | 170 × 32.5 | both menus |
| Map / enemy-test buttons | ~34 tall | debug panels |

The 16.5 px front-door debug toggle and the 24.5 px shop rows are the two
that matter most: one is on the main menu, the other is the primary
commerce action.

**E — canvas HUD**

**E1. The wave banner is positioned against the COLLAPSED minimap.**
`renderWaveAnnouncements` computes `baseY = height - MINIMAP.MARGIN -
MINIMAP.SIZE - 30` — i.e. 75 px of clearance — while the expanded minimap
is 280 px tall. With the map open the banner draws *inside* it.

**E2. One screen corner, three margins.** The minimap's bottom offset is
`LOADOUT_HUD_CONSTANTS.BOTTOM_MARGIN` (14), its left offset is
`MINIMAP_CONSTANTS.MARGIN` (20), and the banner derives its clearance
from `MARGIN`. Nothing agrees.

**E3. Canvas type is its own scale** — 8 / 9 / 11 / 14 px monospace
against the DOM's 7–12 px sans. Defensible as a world-vs-chrome
distinction, but the sizes were picked independently rather than derived.

**E4. The indicator/minimap colour legend is the one thing that is
already coherent.** `UI_CONSTANTS.INDICATORS.COLORS` is a real single
source and `renderMinimap` genuinely reads it (G5's faithfulness pass).
The exceptions are hardcoded one-offs outside it: the wave-banner subtext
`#22d3ee`, the fire-button charge `#fde047` / `#fca5a5`, and the loadout
strip's `#475569` / `#64748b` / `#cbd5e1`.

#### What the audit did NOT find

Worth recording, so the absence is not mistaken for a gap in the audit:

- **Terminology is clean.** "Salvage" is the word on every player-visible
  surface; `credits` survives only as an engine field name; the `◈` glyph
  is used consistently for money in all 15 places it appears. There is no
  Augment/Module drift — "module" is uniform. The single wobble is the
  HUD score chip saying `PTS` where every other surface says "Score".
- **No horizontal document overflow** on any surface at 390×844.
- **Console clean** across the whole walk.
- **The five overlays already share one scrim** (`OVERLAY_SCRIM`) and one
  dense-panel backing (`PANEL_OPAQUE`); that part of the vocabulary
  works and should be the model for the rest.

### U2 — DOM coherence

One named class vocabulary at module scope in `UIOverlay.tsx`, following the
pattern `OVERLAY_SCRIM` and `PANEL_OPAQUE` already set: when more than one
surface needs to look like the same thing, the class string becomes a
constant so the surfaces cannot drift apart. Everything else in this
milestone is either routing a call site through that vocabulary or fixing
one of U1's A/B defects.

**The vocabulary.** Type scale (`T_MICRO` 9 / `T_NOTE` 10 / `T_BODY` 11 /
`T_ROW` 12), named for what each is FOR rather than how big it is, because
"10px or 11px?" is the question that produced the drift. `PANEL` /
`PANEL_ROW` / `panelAccent()`. `HEADING`, `SCREEN_TITLE`, `OUTCOME_TITLE`.
`BTN_PRIMARY` / `BTN_SECONDARY` / `BTN_COMPACT`, `CHIP_BASE` / `CHIP_OFF`,
`HUD_CHIP`, `SECTION_TOGGLE`, and `TAP` (the 40px floor).

**The defects, and what the numbers say afterwards** — same probes, same
viewport, before → after:

| Defect | Before | After |
|---|---|---|
| A1 boss bar vs Salvage chip | overlap `[216,58,320,96]` inside `[15,56,374,100]` | no overlapping element |
| A2 hex flowers | 20 px overlap; off-viewport at 320 | 0 px overlap; `ship [33,186]` / `weapon [203,356]` |
| A3 `data-overlay` | swapped | `stage-clear` on STAGE, `death` on DESTROYED |
| B1 pause title | 72 px tall / 36 px line-height (2 lines) | 32 / 32 (1 line) |
| B2 salvage chip | 40 / 20 (2 lines) | 16 / 16 (1 line) |
| B3 `Guns n/2` chip | wrapped the weapon heading out of alignment | both headings share a 38 px block |
| D tap targets < 40 px | 3 / 21 / 17 / 32 / 31 per surface | **0** on every player-facing surface |

Console still clean; document scroll width still never exceeds the viewport;
all 111 existing tests pass **unmodified** — no test's meaning changed, so
no test was touched.

**A1 is the one structural change.** The boss bar was an `absolute top-14`
block and the chip stack a separate right-aligned column, so neither knew
about the band they share. Both now live in one flex COLUMN in the top bar,
which hands the problem to the layout engine: the bar takes the width it
needs, the chips start below whatever is left, and it holds at every
viewport with no magic offset to keep in sync.

**A2 made the hex sizing responsive.** `HEXW` / `INVW` are now derived from
the width actually available (`Math.min(vw, 672) - 32 - 24`, mirroring the
`max-w-2xl` + `p-4` + `p-3` the layout really uses), capped at the shipped
76 px so nothing changes at tablet and desktop. `vw` is `useState` fed by a
`resize` / `orientationchange` listener — that is a per-RESIZE read, not a
per-frame one, so the EngineStats-only rule (which is about per-frame sim
data) is untouched.

### U3 — Canvas HUD coherence

Same treatment as U2, one layer down. The canvas layer had no named
vocabulary at all, so its sizes were chosen per draw site and its greys were
hex literals at the point of use.

**Two palettes, and they are now explicitly different things.**
`UI_CONSTANTS.INDICATORS.COLORS` is the **type legend** — what a contact IS,
wherever it is drawn. `UI_CONSTANTS.HUD` is the new **chrome palette** —
text, rules, outlines and affordances, which carry no type meaning. Both
are documented as such at their definitions, and the rule is that nothing in
the canvas layer introduces a third. (One site was caught by that rule while
writing it: the loadout strip's inactive slot NUMBER had been routed through
the type legend's `OTHER`, which is chrome wearing a contact colour. It now
reads `HUD.DIM_COLOR`.)

`UI_CONSTANTS.HUD.TEXT` mirrors the DOM's four named steps
(MICRO 9 / BODY 11 / ROW 12 / LOUD 14). Canvas HUD text stays MONOSPACE —
that is a deliberate world-vs-chrome distinction, not drift — but the sizes
are now one set rather than eight independent choices.

**E1/E2 — one screen corner, one rect.** `computeMinimapRect(height,
expanded)` joins `computeLoadoutHUDLayout` in `constants.ts`. Four call
sites computed this independently: the renderer, the fire-event handler that
catches the expand tap, the joystick exclusion zone, and the wave banner.
The banner was the one that had it wrong — it reserved the COLLAPSED 75 px
height unconditionally, so with the map open the banner drew **inside** the
280 px expanded one. `minimapExpanded` is now a banner parameter rather than
an assumption, and the baseline is clamped so a short landscape window keeps
the banner on screen instead of pushing it off the top.

Verified by capture: the banner now sits clear above the expanded map.

**fitFontPx at the extremes** (checked, unchanged): at 1440–1920 nothing
shrinks, which is right — `basePx` is the design size and the function only
ever reduces. At 320 the widest real banner ("WARDEN DESTROYED", ~460 px at
the 48 px design size) fits to ~30 px, comfortably above the 18 px
readability floor, so the floor is a guard rather than a routine outcome.
The `Math.max(80, …)` on the safe width keeps a degenerate viewport from
inverting the ratio. Pinned as an assertion in U4 rather than left as a
reading.

### U4 — Viewport coverage (the absorbed parking-lot item)

`tests/viewports.spec.ts` — **44 tests**, taking the suite from 111 to 155.
The same handful of LAYOUT questions asked at six sizes instead of one, plus
the mid-session resize nothing covered before.

Per viewport (320×568 / 390×844 / 430×932 / 768×1024 / 1024×768 / 1440×900):
nothing laid out past either edge; no interactive control under the 40px
floor; screen titles on one line; the hex flowers never overlapping; the
boss bar clear of the HUD readout stack **with the stack at its tallest**
(score + salvage + two status effects — the state the collision actually
happened in); the canvas HUD's minimap and loadout rects on screen; and the
banner envelope.

The **resize** case rotates portrait → landscape → desktop → 320 → back,
watching a planted probe keep drifting at every stop. That is the assertion
that matters for caches keyed on canvas size (nebula fast-path, gradient
caches, minimap terrain + streamline caches, static-tile cache): one that
survives a resize incorrectly shows up either as a throw inside the draw
pass — the console watch catches that — or as a world that stopped, which
the probe catches. A second test pins that the hex flowers actually GROW
between 320 and 1024, because a cached size would pass every overlap check
while looking wrong at both ends.

**The banner test found that my first assertion was wrong, not the code.**
I asserted a fitted banner always fits the window. `fitFontPx` does not
promise that: it floors at a readability minimum and lets the text clip
below it, on the deliberate grounds that unreadable is worse than clipped.
Three viewports failed on a deliberately absurd 53-character string. The
test now pins two real things instead: the ENVELOPE — every string the game
can actually produce (boss names read out of the sim by spawning each
capstone, not from a list duplicated in the test) fits **without reaching
the floor**, at every viewport — and the INVARIANT that a fitted line either
measures inside the safe band or stopped exactly at the floor, never in
between. Stated as an invariant because the pathological string floors at
phone widths and fits at 768+, so any single number would only have been
true somewhere.

**`window.__omniHud`** (App.tsx, debug handle #4) exposes the three pure
layout functions — `fitFontPx`, `computeMinimapRect`,
`computeLoadoutHUDLayout`. Same rationale and same precedent as
`__omniHid`: they are pure, and they are wrong in a way NOTHING REPORTS. A
banner clipping at 320px, a minimap rect disagreeing with the tap handler
that catches its expand tap, a loadout strip off the viewport — none throw,
none log, and none are visible at the one viewport the suites used to run
at. The alternative was sampling pixels off a starfield, which is neither
robust nor honest.

Deliberately NOT done: re-running the 111 behavioural tests at six sizes
(behaviour is not a function of viewport — that buys a six-times-longer
merge gate and no information), and screenshotting (visual regression is
parked at tiers 3–5, and a capture with no assertion is not a test).

### U5 — Damage-triggered health bars (the optional milestone)

Taken rather than cut: U1–U4 did not run long. The parked item's design was
followed closely; three things changed on screen.

1. **The bar is a hit reaction.** `healthBarTimer` is stamped by
   `markDamaged()` at every damage path and ticked beside `hitFlash` in
   PhysicsSystem. A separate field on purpose, per the parking lot's own
   note: `hitFlash` is a ~0.1–0.3 s whiten-and-punch, and a bar living that
   long would strobe rather than inform. Each site keeps its own flash
   duration; only the bar window is shared.
2. **The player has no floating bar.** It was the number the pause menu
   already showed, drawn under the thing the player is looking at.
   `EngineStats.vitals` now carries hull + shield EVERY frame (`playerStats`
   is menu-only) and the HUD renders it in the top-left — which was empty,
   and is where status conventionally lives.
3. **The shield strip is no longer player-only**, since shield absorption
   has been entity-agnostic since the Bulwark.

`alwaysShowHealthBar` opts a priority target back into a permanent bar. The
dragon takes it; capstone bosses deliberately do NOT, because they have the
dedicated HUD bar and a second readout under the hull is the same redundancy
point 2 removed. DBG ▸ Visual ▸ "HP bars" restores the pre-5d always-on
behaviour, because a visible change should ship with its own A/B.

**The suite earned its keep immediately.** `healthbars.spec.ts` caught that
a hit fully ABSORBED BY A SHIELD never armed the bar — so the shield strip
could only appear once the shield had already failed, which is precisely
backwards for a readout whose job is to be watched draining. Fixed in the
engine (`markShieldDamaged()` at every shield-drain site), not by weakening
the assertion.

**And it produced one regression, caught by U4's matrix.** Adding the vitals
chip to the top bar squeezed it: `justify-between` with an unshrinkable
middle SHOVES THE LAST ITEM OUT, and at 320 px the pause button left the
screen. Fixed by letting the readout column shrink and pinning the pause
button, and the viewport test now asserts both ends of that row at every
size — so the matrix built in U4 caught a defect introduced in U5, which is
the whole point of building it first.

---

## Validation

Three gates green at every milestone commit, and on the final tree:

| gate | result |
|---|---|
| `npm run typecheck` | clean |
| `npm run build` | clean |
| `npm test` | **161 passed** |

The suite grew 111 → 161: `viewports.spec.ts` (+44) and
`healthbars.spec.ts` (+6), plus one assertion added to an existing
viewport test. **No existing test was modified.** Nothing in U1–U4 changed
any test's meaning — the layout fixes made previously-unasserted things
true rather than changing what was asserted — and U5's behaviour change is
covered by its own new file. (Harness rule: no test edited without a ledger
note explaining why its meaning legitimately changed. None needed one.)

Re-captured the full 13-surface inventory after every milestone. Final
state at 390×844: **0 sub-40px tap targets on every player-facing surface**
(down from 3 / 21 / 17 / 32 / 31), 0 elements past either viewport edge, 0
console errors, and the four A/B defects measured closed.

Render-path cost: U5 is a net REDUCTION in draw calls — most entities draw
no bar on most frames — against one timer decrement per entity, which rides
the `hitFlash` loop that already existed. Nothing else in this pass touched
a per-frame path; the class-vocabulary work is all module-scope string
constants evaluated once.

---

## Decisions taken

**D1 — The audit tool is not committed; the viewport matrix is.**
The U1 harness is a throwaway that walks 13 surfaces and dumps PNGs. Its
*measurements* (tap-target floor, overflow, panel recipes) are worth
keeping as assertions, and that is what U4 lands in `tests/`. Committing a
second screenshot-driving script beside the smoke suites would give the
repo two harnesses with one purpose. Alternative considered: promote the
whole script to `tests/audit.spec.ts` — rejected because screenshot
capture with no assertion is not a test, and visual regression is
explicitly parked (tiers 3–5).

**D2 — Screenshots live in the scratchpad, never the repo.** Per the
brief. Before/after pairs go in the PR body and this ledger by
description + measurement, not by committed binary.

**D3 — The primary action button unifies on EMERALD; START stays the
indigo hero.** Three of the five were already emerald and all four in-run
ones mean the same thing ("carry on playing"), so emerald wins on both
count and meaning. The stage-clear CONTINUE moved off amber, and that one
is more than taste: amber on that screen is the DESCENT RIFT colour — the
panel above the button says "A rift has opened", "**Descend**", "**Stage
2**" all in amber — so an amber button reads as "descend", which is exactly
what it does not do (it dismisses the screen; the choice is made by flying
to a rift). START keeps indigo and `rounded-full`: it is the one HERO
control in the game, sitting under an indigo title and an indigo difficulty
row, and hero is a different job from primary. Both departures are
commented at their call sites. **Flagged for review** — a colour token
change is exactly the "taste could reasonably differ" case.

**D4 — The debug menu keeps its density and gets a smaller floor.** The
40px tap floor is a player-facing legibility rule; the debug menu is a
developer surface behind two collapsed dropdowns with ~90 rows, and a 40px
floor there would add several screens of scroll to a diagnostic panel. Its
rows get 22–24px instead, and the exception is commented where it is taken.
The discrete button GROUPS inside it (dragon / rivals / bosses / perf-rec)
are ordinary chips and do take the full floor. Alternative considered:
apply the floor everywhere — rejected on the above; the residual 15
sub-40px controls in the after-metrics are all this exception.

**D5 — The type scale is NAMED, not fully normalised.** U1 counted eleven
sizes. The four-step vocabulary is applied at every call site this
milestone touched, and 7px (below any readability floor on glass) is gone.
The remaining `text-sm` / `text-base` / display sizes on outcome headlines
were left alone: converting every last one is a large mechanical diff with
real regression surface and little reader benefit, and the vocabulary now
exists for the next person either way. Recorded rather than done quietly.

---

## For user review

*(Consolidated at U-final. Aesthetic judgment calls raised as they arise.)*

> **PARKED (2026-08-20, user call):** R1–R5 moved to `docs/PARKING_LOT.md`
> ("5d aesthetic calls") for a dedicated look pass rather than piecemeal
> adjudication.  The full arguments below remain the reference text.

**R1 — Stage-clear CONTINUE moved from amber to the shared emerald** (D3).
The argument for changing it is that amber on that screen is the descent
rift's colour, so an amber button reads as "descend" when it actually just
dismisses the screen. The argument for leaving it is that the screen is
amber-themed throughout and the button tied it together. Taste could
reasonably differ; before/after pair in the PR body.

**R2 — A portal is GREEN on the screen edge and VIOLET/SKY on the minimap.**
Not introduced here, and it is *documented* as deliberate (CLAUDE.md §5:
the arrow wears the type legend, the blip carries the rift's own colour so
an outbound rift and a return rift are tellable apart). But it is the one
contact still exempt from the G5 faithfulness rule — "a contact that is red
on the screen edge and teal on the map is two contacts as far as the player
is concerned" — and this pass is where that inconsistency would be resolved
if it is one. Left alone because reversing a documented decision silently is
worse than either option. Two ways out if you want one: tint the arrow to
match the rift, or keep the legend green and distinguish outbound from
return by SHAPE on the minimap rather than by fill.

**R3 — The expanded minimap and the loadout strip overlap.** Observed while
verifying E1 (screenshot in the PR body). The loadout strip's horizontal
clearance is computed from the COLLAPSED minimap width, the same class of
assumption E1 fixed in the banner — but here the fix is not obviously right:
moving the strip when the map opens makes it jump, and the map auto-collapses
after five seconds. The loadout draws on top, so nothing is unreadable; what
is occluded is the middle-bottom of a transient overlay. Left as-is because
every fix I can see is a bigger aesthetic change than the problem.

**R4 — The player's hull readout is new, and where it goes is a taste call.**
U5 removed the player's floating world-space bar, so the readout had to land
somewhere; it went to the top-left, which was empty and is where status
conventionally lives. The hull number changes colour with urgency
(emerald → amber → rose), which is the one place in this HUD where a colour
change is the information rather than decoration. If it reads as too loud, or
belongs bottom-left near the minimap instead, that is a one-line move.

**R5 — At 320px, the longest station title ellipsizes.** Measured: every
station title fits EXACTLY at 390×844, the design target
(`⬡ HOME STATION` needs 283px and has 283px). At 320 with a six-figure
salvage balance beside it, `⬡ HOME STATION` needs 283px and has 254px, so
`truncate` does its job and shows an ellipsis. That is graceful, bounded
degradation on a viewport the brief says must be *functional*, not designed
for — and the station's name is also on the dock prompt in the world and in
the pause menu's Location row. Every alternative I tried trades a guarantee
for it: dropping `min-w-0` so the header wraps instead would let a future
longer name overflow the viewport outright. Recorded so it reads as a
decision rather than an oversight.

---

## Completion summary

**5d is done.** Six milestones, six commits, no milestone skipped and no
stop-condition hit.

**What the pass actually was.** The game's UI surface was complete but had
been built across a dozen sessions, so it had drifted the way a surface does
when each addition is locally right: the primary action button was three
colours across five overlays, three panel recipes meant one thing, eleven
type sizes did four jobs, and one collapsible-section control had four
treatments. Underneath that were four things that were simply broken at the
design viewport — the boss bar landing on the Salvage chip, the hex flowers
overlapping their drop targets, two screen titles wrapping, and the death
and stage-clear panels wearing each other's `data-overlay` identity.

**The method that made it tractable** was measuring rather than looking. U1
photographed 13 surfaces and then measured the DOM it had just photographed
— every interactive rect, a font-size histogram, the class-string recipe of
every panel and heading. That turned "these menus feel inconsistent" into a
ranked list with numbers attached, and it is why every fix below can be
stated as a before → after rather than as an opinion.

**Headline numbers:**

| | before | after |
|---|---|---|
| sub-40px tap targets (player-facing) | 3 / 21 / 17 / 32 / 31 per surface | **0** |
| boss bar vs Salvage chip | overlapping | clear |
| hex-flower overlap | 20px (off-viewport at 320) | **0** |
| screen titles wrapping | 2 | **0** |
| neutral panel recipes | 3 | **1** |
| primary-button colours | 3 | **1** (+ one commented hero) |
| viewports covered by tests | 1 | **6 + a resize** |
| tests | 111 | **162** (161 at the PR, +1 in U6) |

**Three findings the work produced that the audit could not have:**

1. **A test of mine was wrong before the code was.** The banner test
   asserted that a fitted line always fits the window; `fitFontPx` promises
   no such thing — it floors at a readability minimum and lets text clip
   below it, deliberately. Rewritten to pin the ENVELOPE (every string the
   game can actually produce fits without reaching the floor) and the
   INVARIANT (fits, or floors, never in between).
2. **U5's own suite caught a real gap in U5.** A hit fully absorbed by a
   shield never armed the health bar, so the shield strip could only appear
   once the shield had already failed — backwards for a readout whose job is
   to be watched draining. Fixed in the engine, not the test.
3. **U4's matrix caught a regression introduced in U5.** Adding the vitals
   chip to the top bar pushed the pause button off screen at 320px, because
   `justify-between` evicts its last item when the middle cannot shrink.
   Building the matrix before the optional milestone is what caught it.

**Scope held.** No game-logic, physics, economy or audio change. The engine
edits are the `healthBarTimer` / `markDamaged` visual stamp (nothing in the
sim reads either field), the shared `computeMinimapRect`, the canvas HUD
vocabulary, and two new `EngineStats` fields — which the brief explicitly
allows for surfacing data. `docs/GAME_FEEDBACK_PLAN.md` and
`docs/PARKING_LOT.md` were not modified.

**Five aesthetic calls are in FOR-USER-REVIEW above**, led by the one with
the widest blast radius (R1, the stage-clear button colour). Two of them
(R2, R3) are pre-existing inconsistencies this pass deliberately did NOT
resolve, because reversing a documented decision silently is worse than
either option.

**Follow-on for step 6:** nothing here is balance, so nothing here should be
re-litigated in the tuning pass — but the tuning pass is now judging feel on
final presentation, which is what decision #47b sequenced 5d before it for.

---

## U6 — the play-test follow-up (user list, post-PR)

Seven items off one round of play on the 5d build, in the order they were
given. Not a new milestone in the 5d sense — no audit, no queue — but they
are all 5d-shaped (coherence and legibility, no balance), so they land on the
same branch and the same PR rather than opening a second one.

Two of them REVERSE decisions this gauntlet made. Both reversals are recorded
below with what the original argument was and why it did not survive contact
with play, because "the ledger said so" is not a reason to keep something that
reads wrong on a phone.

### 1. The chevrons hid behind the HUD  ← the real defect in this list

The off-screen arrows ride an inset viewport rect, and that rect was
SYMMETRIC: `EDGE_INSET` (26px) on all four sides. So the top edge sat at
y=26 — under the readout chip stack, which measures down to **y=118** at
390×844 and to **y=168** with a capstone bar up — and the bottom edge sat
under the loadout strip and the minimap.

The bearings that landed there are not incidental ones. A near-vertical
bearing is "directly ahead of you" and "directly behind you"; the arrow was
invisible on exactly the two bearings it is most needed for.

`computeIndicatorRect(width, height, bossBar)` now returns an ASYMMETRIC
rect, and the ray→edge intersection takes the distance to the side the ray is
actually heading for instead of a half-extent. Three things about it are
deliberate:

- **The bands are MEASURED, not guessed.** 118 and 168 are read off the live
  DOM (scratchpad capture), not estimated from the class names.
- **Each band adds ~`SIZE_NEAR` on top of the measurement**, because an arrow
  is CENTRED on the rect edge — a rect that merely reaches the bottom of the
  chips leaves the top half of every arrow tangent to them. This was visible
  in the first capture and is why `TOP_INSET` is 108 rather than 96.
- **The boss band comes and goes.** Reserving the capstone bar's 46px
  permanently costs every ordinary fight play area for a widget that is not
  on screen, so `RenderSystem.bossBarActive` (one boolean, set in
  `GameEngine.draw` from `liveBoss`) widens the band only while it is up.
  That is the ONE input the canvas layer takes from the HUD's shape, and it
  is deliberately a fact the sim already knows rather than a DOM measurement:
  the canvas layer must not start reading React's layout every frame.

Pinned in `viewports.spec.ts` at all six sizes — the rect must clear the
loadout strip and the minimap, stay on screen, and still leave a band worth
drawing arrows in.

### 2–3. Transparency, and collapsing to the edges

One rule for both, and it is the rule `OVERLAY_SCRIM` already argued for its
deliberately tiny blur: **the FILL goes translucent, the MARKS do not.**
`HUD_CHIP` 0.75 → **0.35** (and `px-4 py-1.5` → `px-3 py-1`), the minimap
ground 0.85 → **0.55** with its border 0.4 → 0.30, a resting loadout slot
0.6 → **0.32**. Text, strokes, pips and blips all stay at full strength and
the chips keep their drop shadow, so legibility comes from the marks rather
than from hiding the map — which is what the transparency is FOR.

Edges: the DOM overlay's root padding `p-4` → **`p-2`** (the five full-screen
overlays carry their own `p-4`, so this tightens the in-game HUD only), the
minimap's `MARGIN` 20 → **10**, and `LOADOUT_HUD_CONSTANTS.BOTTOM_MARGIN`
14 → **8** — which is also the minimap's bottom offset, since
`computeMinimapRect` reads it, so the two bottom widgets stay on one baseline
by construction rather than by two numbers that happen to match.

### 4. The vitals chip is a floor now, not a figure

It shipped as `w-[104px]`, which fits "100/100" and clips the moment hull
plating takes the pool into four digits — i.e. exactly when the readout
starts mattering. `min-w-[104px] w-auto`: the floor keeps the chip from
twitching narrower than a bar worth looking at, the content takes it from
there.

### 5. The player's bar is back — REVERSES U5

U5 removed the floating bar under the ship, arguing it was the HUD chip's
number twice, drawn on top of the thing the player is looking at.

In play it is not the same number twice, because the two answer at different
costs: the bar is where the eye already is (on the ship, mid-fight) and the
chip is where the exact figure is (in the corner, when you can look). The
removal traded a glance for a saccade. So both ship.

What keeps it from being genuine duplication is that they cannot disagree:
same field, and the SAME three urgency bands (emerald > 50% / amber > 25% /
rose). The bar is ALWAYS on rather than damage-triggered — your own condition
is the one thing you must never have to provoke into view — and the shield
strip rides under it only once `maxShield > 0`, since an empty strip is a
permanent advert for a module the player has not bought ("whichever is
active").

Tested by driving the real draw call with a RECORDING context and reading the
rects it asks for: below the ship, fill = hull fraction, full fills the
track, empty draws nothing, and the shield pair appears only with a pool.
That is the honest way to assert canvas geometry without sampling pixels.

### 6–7. Two shipped defaults that were the wrong way round

- **Minimap material: Flow → DOTS.** Flow won the G5 comparison as a
  READING of the field; the question the map is asked in play is "what is out
  there", which a dot answers directly. Flow is one step of the DBG cycle
  away and every mode test still covers it.
- **Screen shake: OFF → ON.** It is the game's primary impact feedback and it
  shipped disabled, so the default build had no camera reaction to a crash, a
  detonation or a boss landing. (Rumble was never affected — `handleScreenShake`
  fires it ABOVE this gate on purpose.)

Both are now asserted in `boot.spec.ts`, because a default nobody opts into
is precisely the thing that drifts unnoticed.

### A test-harness bug the default change exposed

`minimap.spec.ts`'s `setMaterial` ran a whole cycle lap INSIDE one
`engine()` call, comparing against `window.__omniStats` between clicks — but
that payload is republished once a frame, so every comparison after the first
read a stale name and the lap overshot. It had worked only while the wanted
mode WAS the shipped default, i.e. while the loop did nothing.

Rewritten to one click per step with a wait for the published mode to change.
The wait then exposed a second, sharper version of the same class of bug: a
predicate passed to `waitForStats` is SERIALISED into the page, so it cannot
close over a local — the inlined-value form `healthbars.spec.ts` already uses
is the pattern.

Worth recording as a harness rule in its own right: **anything that reads
`__omniStats` in a loop is reading a once-a-frame snapshot**, and anything
handed to `waitForStats` crosses a process boundary.

### Validation

`npm run typecheck` ✅ · `npm run build` ✅ · `npm test` **162 passed** ✅
(161 → 162: the U5 player-bar test split into two, one for the bar and one
for the shield strip). One existing test's ASSERTION changed meaning
legitimately — `minimap.spec.ts`'s shipped-default test now expects Dots —
and its rewrite says why in the file. Captures at 390×844 with and without a
capstone bar confirm the arrows clear both bands.

### Still open after this pass

- **The expanded minimap (280px) still reaches above the arrows' bottom
  band.** The band is sized for the COLLAPSED map, deliberately: the expanded
  map is a temporary takeover the player asks for, and sizing the permanent
  rect around it would cost 200px of arrow space for a mode that is open for
  seconds. This is the same family as R3 in FOR-USER-REVIEW and is left with
  it.
- **R1–R5 are unchanged** — none of the seven items touched them.

---

## U7 — second play-test round (user list)

Three items. The first is UI; the other two are WAVE/BOSS behaviour, which
5d's brief put out of scope — the user asked for them directly, and both are
explicitly interim ("I'll adjust this system more thoroughly later"), so they
are written to be easy to undo rather than to be right forever.

### 1. The readouts run along the top edge instead of stacking

Hull sat top-left; score, salvage and wave stacked downward top-right. Three
chips stacked is a 118px band at 390×844 — and that band is exactly what the
chevrons' top safe inset has to clear, so the stack was costing the play area
twice over.

They are peers, so they now run along the edge as ONE wrapping row, with the
pause button OUTSIDE the wrapping band and `shrink-0` (an unshrinkable middle
is what evicted it at 320px during U4). Measured band: **118 → 50px**, and
`TOP_INSET` drops 108 → 40 with it, returning ~68px of play area.

The row is width-bound, which forced two calls:

- **The wave chip is terse**: `W1 · 6 · 12s` rather than `WAVE 1 · 6 LEFT ·
  12S`. It was the widest chip by 60px and decided whether the row fit. The
  colours carry what the words did — rose is the enemy count everywhere in
  this HUD, cyan the clock.
- **The vitals chip lost its word labels.** "HULL" alone cost ~40px, the
  difference between fitting and wrapping. What the word was doing is done by
  the bar directly under the number, which wears the same three urgency
  colours as the bar under the ship; the shield pair below it is cyan, the
  shield's colour throughout. The pause menu's CONDITION block keeps the
  spelled-out version, which is where an unfamiliar player reads rather than
  glances.

Below `NARROW_WIDTH` (372px) the row genuinely cannot fit and wraps — measured
50 → 84px — so `WRAP_INSET` widens the band there. A width threshold, not a
DOM measurement, for the same reason the rest of that block is one.

The viewport matrix now asserts the indicator rect clears the **live** top
band (`[data-testid="hud-top"]`), not the constant that was tuned to it: a
constant agreeing with itself is not the property that matters.

### 2. A boss ends the ladder

Waves kept arriving while a boss was on the field and resumed after it died.
A boss fight with a wave landing on top of it is two encounters at once.

`GameEngine.handleBossSpawn` is the ONE seam both routes pass through — the
capstone wave's own spawn and the debug menu's warp-in — so the halt goes
there: `WaveSystem.haltForBoss()` sets `halted`, zeroes any grace countdown
(otherwise the HUD keeps advertising a wave that is not coming, and offers a
"tap to skip" that does nothing), and drops the ordinary spawns still queued
behind a boss warped in MID-wave.

Two deliberate non-changes:

- **A capstone's own escort survives.** `BossDef.companions` is the boss's
  designed encounter, not the ladder. `WaveSystem.capstoneWave` is what tells
  the two cases apart — both bosses land in `waveEnemyIds`, so tracking alone
  cannot distinguish them.
- **Nothing clears `halted` except `WaveSystem.init`**, i.e. loading a map.
  That is what makes "does not restart after the boss dies" true without a
  second flag, and it keeps a fresh arena running its own ladder.

The test that matters is the second half: dismiss the stage-clear screen, let
the arena run *longer than a grace period* with the sim live, and assert no
wave started. The old behaviour only showed up at that moment, which is
precisely when nobody is watching.

### 3. The descent rift is switched off

`openDescentPortal` is kept verbatim and uncalled; `GameEntity.isDescent`, the
amber portal colours and the whole `transitionToMap(id, {descend:true})` path
(depth, `waveOffset`, the stage stride) are untouched and still tested. What
was removed is the one CALL that puts a rift in the world — the smallest
possible switch-off for something the user intends to rework.

Two things had to follow it or they would have been lying: the stage-clear
screen's copy (it promised an amber rift by name) now says the arena is quiet
and points home, and `screens.spec.ts`'s rift assertion is INVERTED rather
than deleted, so a rift cannot come back silently.

### Validation

`npm run typecheck` ✅ · `npm run build` ✅ · `npm test` **164 passed** ✅
(162 → 164: two new ladder tests). Two existing assertions changed meaning by
user directive and say so in the file — the descent rift, and the minimap
default from U6. Captures at 390×844 and 320×568, with and without a capstone
bar, confirm the chevrons clear both bands.

---

## U8 — the docked station: a requirements pass, then tabs

> "I have to scroll from the bottom of the menu to the top to see how much
> salvage I have left and then scroll all the way back to the bottom to buy
> something."

### The requirements, first

The docked screen was one long column: title + balance, UNDOCK, repair, the
full stat breakdown, the flowers + inventory + detail strip, and then the
shops **last**. At 390×844 that is roughly three screens of scroll with the
money at the top and the spending at the bottom.

What a docked player actually does is four things — **buy**, **outfit**,
**sell/scrap**, **repair** — and reading the ship's stats, which is a
reference for the first two rather than a job of its own. Two facts fall out
of that list and neither was expressed in the layout:

1. **Money is relevant to every one of those jobs.** It is not a header
   ornament; it is the constraint. So it must not be able to scroll away.
2. **Cargo is the second constraint and was invisible.** A purchase lands in
   the inventory, `purchaseModule` silently rejects with no free tile, and
   the shop could not see the inventory at all — an affordable-looking button
   that does nothing.

### What shipped

**A sticky header**, bled to the overlay's padding edges so content passes
behind rather than beside it: station name, `◈ balance`, `⬢ used/capacity`,
UNDOCK, and repair. Repair is **contextual** — it appears only while there is
damage to pay for, because a permanently disabled "HULL FULL" button in a bar
that never scrolls away is clutter that never resolves.

**Three tabs** — SHOP / OUTFIT / SHIP — so no page is longer than a phone
screen. Measured at 390×844: Outfit and Ship are exactly one screen (844px,
no scroll at all); Shop is 1005px, one short scroll, with the balance pinned.

Four decisions worth recording:

- **Repair is a header action, not a fourth tab.** Four tabs do not clear the
  40px tap floor at 320px, and repair is one control rather than a panel.
- **The tab list comes from the station's SERVICES**, and `stationTab` is only
  a remembered preference — the home drydock sells nothing, so it falls back
  to the first tab it does offer. No effect, no normalisation, no state that
  can disagree with the station you are docked at.
- **The panel is TOP-aligned**, unlike every other overlay's `my-auto`. A
  vertically centred block puts a sticky header in the middle of the screen
  whenever the tab is shorter than the viewport — which, now that the tabs
  are short, is most of the time.
- **The station title dropped from `SCREEN_TITLE` to `text-lg`** — a
  documented departure from the shared vocabulary. It shares its line with
  UNDOCK now, and at 2xl "TRADE HUB" ellipsized to "TRADE H…". A station's
  name is how you know which services you are looking at, so it gets to be
  complete rather than large.

**Cargo is now enforced in the UI**, not just in the engine: purchase buttons
disable when cargo is full and the shop says why.

### Validation

`npm run typecheck` ✅ · `npm run build` ✅ · `npm test` **164 passed** ✅.
The viewport matrix's station test was rewritten rather than left alone: it
now asks its layout questions **once per tab** (a panel that only fits while
it is hidden is not a panel that fits) and adds the complaint itself as an
assertion — scroll the longest tab to the bottom, the balance must still be
on screen.

### Not done, deliberately

- **The pause menu's cargo panel is untouched.** It has the same shape and
  probably the same problem, but the user asked about stations and the pause
  panel is read-only where the station is transactional.
- **The shop is still one list per group.** It is 160px past the fold at 390
  with the header pinned, which is a scroll, not a hunt. Splitting it further
  (sub-tabs per family) would add taps to buy one thing.

---

## U9 — a crushed tile now breaks instead of vanishing

> "When asteroids collide with static tiles with enough momentum they break
> the tiles. When this happens currently, the tile just disappears."

### The cause

Three places in `PhysicsSystem.resolveCollision` can take a structure's last
hit point by CONTACT: the player crashing into it, an asteroid crashing into
it, and an asteroid grinding it down through the sub-threshold pressure
accumulator. All three did the same three things — `health = 0`,
`active = false`, `removeStaticEntity` — but only the PLAYER's went on to
call `onDeath`.

Without that call `GameEngine.handleEntityDeath` never runs, and that handler
IS the break: the variant shatter, the glass-shard fan, the debris burst, the
regen queue, the flow-field patch and the destruction sound all hang off it.
So the tile was deleted rather than destroyed.

The player's path calling it is why this survived: crashing into a tile
yourself looked completely right, and that is the case a developer tests.

### The fix

One shared `killStructureByImpact(structure, impactor, impactDamage,
byPlayer, onDeath)`, used by all three sites so they cannot drift again. It
does what the projectile path already did:

- **`lastImpactVelocity`** — the fragments scatter along the impact instead of
  puffing symmetrically.
- **`lastImpactDamage`**, which `ShardSystem.shatterAsteroidStyle` and
  `DropSystem.spawnGlassShards` read as 1..5 → few-and-large .. many-and-fine.
  Derived from how far OVER the threshold the hit was (`momentum /
  ASTEROID_CRASH_MOMENTUM - 1`, clamped over 3×), so a bare-threshold nudge
  leaves chunks and a real slam powders it. The pressure path passes 1
  outright: that is the slow grind, not a smash.
- **`killedByPlayer` only when it is** — a tile crushed by a drifting rock is
  nobody's kill and scores nothing, which is the existing rule for the score
  stamp, not a new one.

The player's crash gained the two stamps as a side effect (it had neither, so
its breaks defaulted to the blandest shatter). A hard crash now breaks a tile
more finely than a scrape.

**No economy change.** `DropSystem.spawnDrops` only rolls salvage for MOBILE
shards; a static tile's "drops" are its physical debris. So this adds
destruction, not income.

### Making sure the test could fail

The first draft of `tests/terrain.spec.ts` **passed with the fix reverted**.
The synthetic impactor is itself a mobile shard, and it sat inside the radius
the test counted debris in — so the count went up by one whatever happened to
the tile. Fixed by creating the impactor BEFORE the baseline is taken, and
then verified the honest way: revert the fix, watch the crush case fail,
restore it, watch it pass.

Two other things the file records because they cost time: `resolveCollision`
returns before the crash branch when handed a degenerate MTV (so a test must
pass a real separation vector, not `{0,0}`), and `prepareFrameEntities`
compacts `currentMap.entities`, so neither an index nor an id into that array
survives a round trip once the entity it names is dead — each measurement
runs inside one page evaluation.

### Validation

`npm run typecheck` ✅ · `npm run build` ✅ · `npm test` **167 passed** ✅.

### Footnote: the U9 push did not rebuild the preview

Worth recording because it looked exactly like a caching problem and was not
one. After `7448811` was pushed, the branch ref on GitHub WAS `7448811`
(`git ls-remote` confirms it), but PR #89 still reported `dcddabb` as its
head, and neither `PR checks` nor `PR preview` ran for the new commit — so
the standalone preview kept serving U8. The user checked in a second browser
first, which ruled out their cache and pointed at the publish side.

The tell is that the PR's own metadata was internally inconsistent: `commits`
had already gone 8 → 9 and the diffstat had grown to include U9, while
`head.sha` still named the previous commit. GitHub had ingested the push but
not emitted the `pull_request: synchronize` event both workflows trigger on.

Fix: push again with a new commit so a fresh event fires. Nothing to change
in the workflows — `pr-preview.yml` already guards against building a STALE
sha (it re-reads the PR head and skips if the event commit is behind), which
is the opposite failure and the one worth having.

---

## U10 — screen shake follows the impact, not the closing speed

> "The screen shake effect is triggered by very small shards moving at high
> enough speeds, but this feels overpowered. Can you review the screen shake
> magnitude calculation and see if it aligns with the energy/momentum we use
> in the rest of the collision physics?"

### The review

It did not align. The player-collision shake was:

```
onShake(min(impactSpeed, SHAKE.HEAVY) * SHAKE.CAP_MULTIPLIER)
```

**Speed alone.** Mass appears nowhere in it, while it appears everywhere
around it: the crash gate is `asteroid.mass * impactSpeed >
ASTEROID_CRASH_MOMENTUM`, and the impulse solver splits by bias-compressed
inverse mass. Shake was the one place the model was dropped, so a 15px glass
chip and an immovable wall shook the camera *identically* at the same closing
speed — and since the term saturates at `HEAVY`, both pinned the maximum.

### The quantity to use

Not momentum and not energy, but the one the solver is about to apply anyway:
**how much the player's own velocity changes along the normal.**

```
dv = (1 + ELASTICITY) * |v_n| * effInv_player / (effInv_player + effInv_other)
```

It is the sim's own velocity step, mirrored line for line including the mass-
bias exponent, so it agrees with the physics *by construction* rather than
being a second model to keep in sync. It is also the physically right thing
for a camera bolted to the ship: what you feel is how hard *you* were moved.

Three properties fall out rather than being written:

- **A static body has `effInv = 0`**, so `dv = (1+e)|v_n|` — a wall is the
  hardest hit there is, and with `IMPACT_DV_SCALE` 1.0 / `IMPACT_MAX` 30 the
  wall curve is **identical to the old one at every speed**, threshold
  included (`IMPACT_DV_MIN` 3.0 is exactly the old `impactSpeed > 2`). The
  change is isolated to light bodies; crashing into terrain is untouched.
- **A light body attenuates by the true mass ratio.** Measured at |v_n| = 20,
  where every row used to read 30:

  | impactor | mass | old | new |
  |---|---|---|---|
  | static tile | ∞ | 30 | **30** |
  | 40px metal shard | 48 | 30 | 12.3 |
  | 40px rock shard | 28.8 | 30 | 10.5 |
  | 25px rock shard | 11.2 | 30 | 7.5 |
  | 15px glass shard | 2.25 | 30 | 3.9 |
  | 8px glass chip | 0.64 | 30 | **silent** |

- **A heavier SHIP shrugs hits off**, because `player.mass` scales with ship
  weight (`SHIP_WEIGHT`). Free, and it ties the camera to the outfitting
  system: a laden hull is harder to shove, so it is harder to shake.

### Direction

`handleScreenShake(amount, { dirX, dirY, rumble })`. A directional shake is a
decaying **oscillation along the impact axis** — the camera lurches the way
the ship was actually shoved and rings back — with `DIR_JITTER` of isotropic
noise on top so it does not read as a mechanical slide. The axis is the
impulse direction on the player (`±n`, sign by which body the player is), so
it is the same vector the solver uses.

The projectile hit on the player takes the **shot's travel direction** for the
same reason, while keeping its damage-driven magnitude: a bolt's momentum is
negligible against the hull, so what the player feels there is the hit, not
the shove.

Callers with no meaningful axis — explosions, warp-ins, boss beats, wave
banners — pass a bare number and keep the isotropic jitter unchanged. The
options object replaced a positional `rumbleKind` argument that would
otherwise have collided with the direction parameters.

### Validation

`npm run typecheck` ✅ · `npm run build` ✅ · `npm test` **172 passed** ✅.
`tests/shake.spec.ts` pins the three claims separately because they fail
independently — and the PARITY test is the one that matters most: it fails if
someone ever "fixes" an overpowered shake by scaling the whole curve down.

---

## U11 — the ear reads the shake's dial; NPC knockback becomes an impulse

Two requests in one round, and they turned out to be the same defect twice:
a feedback channel that ignored mass while the physics around it did not.

### 1. Impact sound follows impact strength (delegated, then amended)

A subagent updated `docs/SFX_INVENTORY.md` §4.4 to define ONE quantity for
both the camera and the ear — `dv`, the struck body's own velocity step,
which `COLLISION_CONFIG.SHAKE` already computes. Its key finding is the one
worth keeping: at a span of 18 the tile-crash gain law reproduces the shipped
`impactSpeed / 12` curve **exactly**, so the wall crash is bit-for-bit
unchanged and only lighter impactors get quieter — the same isolating claim
the shake change makes, verified numerically at both ends.

**I amended the spec on one point**, and it is worth recording as a case of
a good rule producing a bad outcome. The agent specified ONE global span
(`I / 0.6`, i.e. `dv / 18`) for every crash row. Measured against the range
each row actually covers, that pinned essentially every shard contact to its
0.25 floor: the shard voice is gated at closing speed 1.2 — a loose rock is
audible long before it is destructive — and tops out near `dv` 7, so
dividing it by 18 left a voice with no dynamics at all. Quieter, and worse.
The span is per row now (tile 18, shard 6, enemy 12), so "harder is louder"
holds WITHIN a row while the absolute ordering BETWEEN rows stays where the
mix column puts it. Doc updated to match, with both the old failure and the
reason stated in it.

Also wired, which the agent deliberately left alone per its brief: the three
`crash.*` call sites now pass `impactVoice(...)` instead of speed-derived
numbers. It needed no signature changes — `resolveCollision` already computed
this `dv` a few lines above for the shake, so the change is a shared helper
(`PhysicsSystem.impactStrength`) and three call sites. `crash.player.enemy`
gained per-instance parameters it never had: ramming a gnat and ramming a
Bastion are now different events to the ear.

Two smaller things fell out: the agent found a stale sentence in the doc
(player↔shard contact attributed to `crash.player.tile`, which predates the
tile/shard voice split) and flagged that CLAUDE.md §8 carried the same claim.
Both fixed.

### 2. NPC knockback is an impulse, not a velocity

> "NPCs take significant momentum hits when the player shoots them. This is
> different than the behavior when the player shoots shards."

Exactly right, and the diff is one term. The feedback kick was
`dv = damage * KICK_PER_DMG` (1.0) — **a velocity step with no mass in it**
— so one Plasma Cannon hit (18 damage) added `dv = 18` to a mass-4 gnat and
to a mass-500 dragon alike. Enemy top speeds are 2–12, so a single hit was
several times a body's own top speed, and hits stack. Meanwhile the shard
push twenty lines away is `projSpeed * 0.20 / max(1, mass/10)` — mass-aware,
landing in the 0.7–3.2 range. The dragon's own `ENEMY_VARIANTS` row says
"heavy: barely shoved", documenting an intent the code did not implement.

Momentum in, velocity out: `dv = damage * KICK_IMPULSE_PER_DMG / mass`,
capped at a fraction of the target's OWN top speed. `dv` from one Cannon hit,
was 18 for every row:

| target | mass | was | now |
|---|---|---|---|
| Swarm gnat | 4 | 18 | 9.0 |
| Charger | 8 | 18 | 4.5 |
| Drone | 10 | 18 | 3.6 |
| Tank | 18 | 18 | 2.0 |
| Turret | 50 | 18 | 0.72 |
| Warden boss | 140 | 18 | 0.26 |
| Dragon | 500 | 18 | 0.07 |

The cap is expressed in the target's own `maxSpeed` rather than as an
absolute, so it means the same thing across a roster whose speeds vary 4×: a
hit can never shove a body faster than it can fly under its own power. A
floor keeps a bolted-down emplacement (`maxSpeed` 0: Turret, Nest) flinching
rather than immovable.

**What was already right and is left alone:** the perfectly-inelastic
momentum transfer the projectile itself carries
(`target.velocity += proj.velocity * projMass / targetMass`). That is real
physics and was always mass-aware; at `PROJECTILE_CONSTANTS.MASS = 1` it is
small against any real hull. The tests assert the RESULTING speed, so they
account for both terms rather than pretending the feedback kick is the whole
story.

The player's own shot-knockback got the same treatment, normalised so the
LEAN ship is unchanged (`12 / PLAYER_MASS` = the old 0.12 per damage point).
Only a laden hull differs, and it differs the way the screen shake already
does.

### Validation

`npm run typecheck` ✅ · `npm run build` ✅ · `npm test` **175 passed** ✅ ·
`node scripts/smoke/b3.mjs` **49 passed** (the doc↔registry parity smoke,
including "every documented id is registered" in both directions).

`tests/knockback.spec.ts` was verified NON-VACUOUS by reverting the fix and
watching all three fail.

**A harness note worth keeping:** the subagent ran `vite preview` on port
4173 while a full `npm test` was in flight, and Playwright's `webServer` uses
that port with `--strictPort` and `reuseExistingServer: false`. The run
collapsed to 87 passed with the rest never starting — which reads like a mass
failure rather than a port conflict. Re-run clean it was 175. If a suite run
ever reports a large number of tests simply not running, check for something
else on 4173 before believing the failures.

---

## U12 — a shot must not rival a collision

> "The screen shake on player hit by projectile is very strong. Can we reduce
> this within the framework without adjusting projectile damage or speed?"

Yes, and the framework is what makes it a two-line change rather than a
guess. `HIT_FEEDBACK.PLAYER_SHAKE_*` predates the impact model and lived on
its own scale, so it landed far up the body-impact range:

| event | shake (before) |
|---|---|
| Drone pellet (5 dmg) | 10.0 |
| Charger fan (7) | 12.4 |
| Sniper slug (16) | 23.2 |
| Bastion shell (18) | 24.0 (cap) |
| — *the scale it sits inside* — | |
| wall crash at the break threshold (speed 4) | 6.0 |
| 40px rock shard at speed 20 | 10.5 |
| wall crash at speed 12 | 18.0 |
| wall crash, full tilt | 30.0 |

A five-damage PELLET shook the camera as hard as a 40px rock hitting the hull
at speed 20, and a slug nearly as hard as flying into terrain at full speed.

**Why the input stays damage.** A projectile's actual momentum against the
hull is `mass 1 × speed 16 / mass 100` = `dv` 0.16 — an order of magnitude
under `SHAKE.IMPACT_DV_MIN`, so on the physical model a bolt would shake the
camera not at all. This shake is deliberately a LEGIBILITY signal ("you got
hurt"), not a physical one, and damage is the right input for it. What it
lacked was a place in the same scale, which is exactly what the impact model
now provides to compare against.

Re-pointed so the range lands under collisions: base 4 → 1.5, per-damage
1.2 → 0.5, cap 24 → 11.

| event | now | reads as |
|---|---|---|
| pellet (5) | 4.0 | less than a scrape |
| Charger (7) | 5.0 | |
| slug (16) | 9.5 | |
| Bastion shell (18) | 10.5 | about a 40px rock at speed 20 |
| cap | 11 | under a wall crash at speed 8 (12) |

So the heaviest shell in the game feels like a real rock hitting you, a
pellet feels like less than a scrape, and nothing fired can approach ramming
terrain. Direction is unchanged (the shot's travel axis), and the player's
knockback KICK is untouched — the complaint was the camera.

Pinned in `shake.spec.ts` as an ORDERING against LIVE body-impact numbers
rather than against constants copied into the test, so it keeps meaning if
either scale is retuned later. Verified non-vacuous: it fails with the old
values restored.

`npm run typecheck` ✅ · `npm run build` ✅ · `npm test` **176 passed** ✅.

---

## U13 — `gamepad-left`: one thumb flies and aims

> "There should be a gamepad controller scheme where the left analog stick and
> left d-pad is directional aim and thrust, and the down button on the right
> side button pad is shoot (left button on right pad remains action button)."

A seventh scheme rather than a toggle, for the reason the scheme list exists:
it changes what a stick deflection MEANS, and two answers to that cannot be
live at once. It sits one flag away from the schemes either side of it:

| scheme | left stick | aim | gun |
|---|---|---|---|
| `gamepad` | thrust | RIGHT stick | right trigger (or face) |
| **`gamepad-left`** | **thrust AND aim** | **left stick / D-pad** | **bottom face button** |
| `gamepad-thrust` | heading only | either stick | bottom face button |

**What actually changed is only the aim.** The left stick's magnitude is
still the throttle — the ordinary `gamepad` meaning — so flying is untouched;
what is added is that the same deflection writes the synthetic pointer, which
is how the hull's rotation and every shot's target are already derived. The
D-PAD rides along for free: it has always written a unit vector into
`padMove`, so it now aims in its eight directions at full throttle without a
line of its own.

Three decisions worth recording:

- **The right stick is IGNORED, not merged.** Two channels writing one
  reticle is a fight the player feels as it snapping between their thumbs.
  `gamepad-thrust` is the deliberate exception *within* that rule — it lets
  whichever stick is deflected further win, because on a minimal pad the one
  stick may be either.
- **The fire group got its own rule.** It used to be derived from
  `triggerThrust`, which was true only by coincidence. `fireFace` now says it
  directly, and both schemes that give up the triggers set it.
- **The triggers go slack under both.** `usesFaceFire()` gates the adaptive
  weapon profile off, on the argument the code already made for
  trigger-thrust: resistance on a control that fires nothing is just a stiff
  trigger.

Buttons are unchanged from the request: bottom face (`FIRE_FACE`, index 0) is
the gun, left face (`INTERACT`, index 2) is still dock / portal / undock.

**One existing test legitimately changed meaning**: `help.spec.ts` enumerates
the scheme dropdown's options, and there is a seventh now. The list stays
written out rather than derived from `CONTROL_SCHEMES` — a scheme that exists
in the table but never reaches the picker is unreachable to the player, and
nothing else would say so.

**Customisable bindings parked**, as asked — `docs/PARKING_LOT.md` now carries
the entry, including what already exists (the button table is already
action → indices, and `padGroupValue` already takes a GROUP), and the three
things genuinely missing: persistence (the game keeps no state across reloads
by design, so this needs the first real answer to where user config lives), a
binding UI with capture and conflict detection, and the axis question — what a
stick MEANS is semantics rather than a binding, so the honest design is
probably custom BUTTONS on top of a chosen axis model.

`npm run typecheck` ✅ · `npm run build` ✅ · `npm test` **178 passed** ✅.

---

## P1 — Parking-lot review + housekeeping

A read of all 23 entries against the current code. One structural defect, five
entries stale, four partly overtaken.

**The defect:** the Swarm-gnat / Bubble tuning checklist had lost its `##`
heading and was rendering *inside* the "Weapon ammo model — SUPERSEDED" entry
above it. A live tuning list filed under a superseded banner reads as dead.
Heading restored, with a note saying why it moved.

**Closed as shipped**, each with what shipped it:

| entry | shipped by |
|---|---|
| Damage-triggered health / shield bars | gauntlet 5d, U5 |
| Viewport coverage — more than 390×844 | gauntlet 5d, U4 |
| Portal off-screen indicators | step 5, G6 (option 2 + no distance) |
| Exotic enemies + AI taxonomy / wave accounting | Stages 0–7 |
| Pause-menu per-module stat attribution | Phase 3 Pair A |

The health-bar entry is the interesting one: it shipped, but one of its
prescriptions was **reversed** in U6 — it argued the player's floating bar was
redundant with the HUD readout, and in play it is not. Closing it silently
would have left a design argument on file that the game now contradicts, so
the note records the reversal and the reason (the bar is where the eye already
is; the chip is where the exact figure is).

**Amended rather than closed:** the test-suite entry (its "is this wanted at
all" stance is decided — tiers 1/2/6 shipped, 3–5 still parked), the salvage
death penalty (an interim 25%-or-12,500 charge is live; the corpse-run and
uninsured-cargo variants are what remain), the one-stick/two-button scheme
(`gamepad-left` took the hard half of its premise), and the controller
refinement pass (three pad schemes now, not two).

**What is actually live** clusters harder than a flat list suggests: portal
persistence, area composition and the map graph are ONE project sequenced
behind stable node identity — and the descent rift is switched off, so nothing
downstream of it is reachable today.

---

## P2/P3 — One deflection primitive, and every shield uses it

> "do the deflection helper and apply it to the player shield and any other
> existing shields right now."

Bouncing a bolt off a surface existed **twice**, written independently: the
Bulwark's arc shield reflected about a radial normal; the bouncer round
negated one velocity component off a tile face. Both now call
`PhysicsSystem.deflectProjectile(proj, nx, ny, opts)`, which owns the mirror,
the rotation, the snap, and the rule that a bolt already travelling outward is
never deflected again. For an axis-aligned normal the general mirror reduces
to negating one component, so the bouncer's arithmetic is unchanged by the
fold — `deflect.spec.ts` pins that rather than asserting it.

`DeflectOptions` carries the axes the parked entry named as future use cases —
`reownType`/`reownId` (a parry: the bolt becomes yours, and the already-hit
set clears or it would refuse the targets it is now aimed at), `speedScale`,
`spread`. Nothing ships using them; they are the seam, and they cost nothing
unset.

**Then the shield side generalized.** Deflection required an ARC
(`shieldArcHalfWidth`), so the player's own bubble and the bosses' pools
silently swallowed shots the Bulwark visibly turned away — the same event
reading as two different ones. `shieldReach()` now answers for both: an arc
keeps its own ring, any other pool uses the shield's physical standoff, which
is the same `COLLISION_MULTIPLIER` the player's inflated collision shape and
its rendered ring already use — so the ricochet happens exactly where the
player sees the bubble. The enemy bubble ring moved from `r * 1.4` to that
same figure (a ~3.7% change) so the drawn ring and the deflect radius cannot
drift; it is also now derived from `size` rather than the hit-punched `r`,
because physics does not punch.

**The arithmetic is deliberately untouched.** A deflected shot drains exactly
the damage the absorb path would have absorbed; a shot bigger than the pool
still falls through to that path and lands its remainder on the hull. This is
a legibility change, not a shield buff — which is why the punch-through case
is a test rather than a comment.

**Three things the generalization forced, none of them cosmetic:**

- **An EMP'd shield now declines.** The absorb path has always checked
  `systemsDisabled`; the arc-deflect path never did. Harmless while deflection
  was enemy-only — the bubble's latch EMPs the *player* — so the hole only
  became live the moment the player's shield started deflecting.
- **A shot that may not hit you may not bounce off you.** An ally rival's fire
  is `sparesPlayer` and the damage path declines it; ricocheting it off the
  player's shield would invent a collision that has never existed. Same for a
  rival's `hitsEnemies` shot against another rival.
- **A deflected bolt stops homing.** Enemy missiles home on the player with no
  range gate, so a deflected missile that kept steering would turn straight
  back into the shield and grind the pool down in a loop — a case that could
  not arise while only enemy shields deflected. `keepHoming` opts out; the
  bouncer sets it, because a tile bounce is the weapon working as designed.

Also: a deflect that empties the pool plays the louder `impact.shield.break`
instead of `impact.shield.deflect`. "That was the last of it" outranks "that
bounced", and the absorb path has always said it.

**Not done, deliberately:** deflected enemy fire is a plain ricochet, not a
parry — it keeps its owner, so it flies off without hitting anything (the
friendly-fire filter still applies). Re-owning is a module-sized decision, and
the option exists for whoever makes it.

`tests/deflect.spec.ts` — 7 tests. Each gate was verified non-vacuous by
reverting it and watching the matching test fail: restoring the arc-only gate
fails 1 and 5; dropping the EMP gate fails 3; dropping `sparesPlayer` fails 4;
dropping the `v·n` guard fails 6.

---

## P5 — The deflect did not fire in play (playtest fix)

> "I'm not getting any deflection from the base enemy blaster projectiles."

Correct, and the suite said otherwise. Worth recording as a **testing**
failure first and a geometry bug second.

**What the tests proved.** Every case in `deflect.spec.ts` handed
`checkAndResolveCollision` a pair it had built itself. That proves the deflect
FUNCTION works. It proves nothing about the game reaching it — and the game
mostly did not. Measured on a real SHOOTER_1 against a shielded player:
**four absorbs to one deflect.**

**The geometry.** The pre-SAT path tested the bolt against the shield's
CIRCLE (`shieldReach`), then let SAT decide the body hit. Those two have to
agree about where the shield is, and they do not: `fillVertices` falls back to
a BOX for an entity with no `polygonPoints`, and **the player has none** — so
its shield-inflated square reaches √2 further at the corners (25.5) than the
circle the ring is drawn as (18). Any shot arriving off-axis hit the square
first and was absorbed by the body path before the deflect could see it. The
Bulwark hid this completely: its arc ring stands at 0.99·maxDim, far outside
its hull, so the ring always wins. And the synthetic test pairs were all
head-on — the one geometry the circle test got right.

**The fix is structural, not a bigger radius.** Widening the circle by the
projectile's radius helped (4:1 → about 7:1) but could never be right, because
no circle covers a square. So the two shield kinds now deflect where each
actually is:

- **Arc** — keeps the pre-SAT ring interception. A ring that stands OFF the
  hull *must* intercept early or the bolt flies through the gap between ring
  and hull untouched.
- **Non-arc** (player, boss bubbles) — deflects **at contact**, in
  `resolveCollision`, immediately before the absorb it replaces. A bubble
  pool's ring IS the shield-inflated collision shape, so a SAT contact means
  the bolt is at the shield. Reacting to the contact instead of predicting it
  makes "every live shield deflects" true *by construction*: it runs at
  exactly the moments the absorb would have.

One path per shield kind, so no pair can be charged twice. A bolt already
travelling outward relative to a shielded target is now neither deflected
again nor absorbed — it is one this shield already turned away.

After: **zero absorbs** across repeated real-fight runs, all deflects.

**The regression net that was missing** is the real deliverable here:
`deflect.spec.ts` gains a test that spawns a REAL `SHOOTER_1` through the real
wave path, parks it **off-axis on purpose**, runs the real loop, and asserts on
the thing the two paths disagree about — every shot that reached the shield was
turned away, none absorbed. The sound id is the observation point because it
IS the distinction: `impact.shield.deflect` and `impact.shield.absorb` are
emitted by those two paths and by nothing else.

Verified non-vacuous the honest way: with the shipped 32a2d67 behaviour
restored, the new test FAILS and all seven original tests still PASS — which
is the whole lesson in one line.

---

## P6 — The waves that "continued" were the dead boss's own escort

> "U7 — The waves still continue after defeating a boss."

Reproduced headlessly through the real ladder: kill the capstone, dismiss the
stage-clear screen, and watch — the boss died with **7 escort spawns still
queued**, and they kept warping in for the next twenty seconds (`liveCounted`
climbing, `pendingSpawns` draining). The LADDER was in fact down — `halted`
held and no wave 7 ever started — but the player cannot tell a queued escort
from a new wave, and should not have to.

The hole was the deliberate exception in `haltForBoss`: a capstone's escort is
KEPT while the boss is alive, because that escort is the designed encounter.
Right — until the boss dies. The rout (`payBossBounty`) wipes every enemy
STANDING, but nothing cancelled the not-yet-spawned tail of the escort, so
reinforcements streamed into a fight that was over.

**Fix:** `WaveSystem.cancelPendingSpawns()` — ends the spawn stream — called
at the rout, beside the `halted` flag. The capstone wave then completes the
normal clear-the-field way the moment the routed field is empty. After the
fix the same repro shows zero pending spawns, zero arrivals, wave `cleared`,
and no next wave across four grace windows.

**Pinned in `loop.spec.ts`** (new § 9b in the full-loop test): after the
stage-clear dismiss, no pending spawns, ladder halted, and — held across more
than a full grace window of sim time — no next wave, no counted arrivals, the
capstone wave completed. Verified non-vacuous: with the one-line cancel
removed, the new assertion fails on exactly the queued-escort count.

---

## P7 — The deflect is a PARRY: turned bolts stay live

> "Deflect feels good but I don't want the projectiiles to become duds after
> colliding with shields, let's make them active and make them able to
> destroy enemies."

The `reownType` seam built in P2 gets its first user. When the PLAYER'S
shield deflects a hostile bolt, the bolt is **re-owned to the player**: it
keeps flying, damages enemies, pays their kills (the `killedByPlayer`
attribution comes free from ownership), and its already-hit set clears so it
may strike the very shooter it was refused before — a head-on shot literally
returns to sender.

Two consequences fell out of existing machinery rather than being built:

- **A parried homing missile turns on its makers.** The owner-aware homing
  pass steers PLAYER-owned homing shots at the nearest enemy, so keeping
  `homing` alive through the re-own (`keepHoming: true`) is the entire
  implementation. The re-home-into-the-shield loop the default guards against
  cannot arise — a player-owned bolt cannot hit the player at all.
- **Enemy shields deliberately do NOT parry.** A Warden that re-owned your
  cannon shell would turn your own gun on you — a design decision nobody has
  made. Their deflect stays a plain ricochet, which for the Bulwark case
  already leaves the turned player bolt live against other enemies.

Tests: the "deflected missile stops homing" test was rewritten — its premise
was the pre-parry world — as "a parried missile changes sides", and a new
test drives a bolt off the shield into a frail enemy and asserts the kill,
the attribution, the score, and the cleared hit set. The real-fight streamer
got a hardening its own subject forced: parried bolts return to sender, so
its shooter is now effectively immortal or it dies to its own fire two
shots in and cuts the stream the test is counting. Parry gates verified
non-vacuous: with the re-own disabled, both parry tests fail.

---

## P8 — R1–R5 parked

The five aesthetic calls raised at U-final moved to `docs/PARKING_LOT.md`
("5d aesthetic calls") as one bundle for a dedicated look pass (user call).
The ledger section above stays as the reference text; a banner there points
at the parking lot.

---

## P9 — CI red on f727615: the streamer test measured the weather

CI failed the real-fight deflect test with `99.017/100` hull while the event
log showed zero absorbs and every shot deflected — the deflection was
correct; the test's bonus assertion ("nothing got through to the hull") was
not a property the world offers. The test parks the player in a LIVE glass
field for several seconds, and a drifting mobile shard that grazes the hull
deals environmental damage that **bypasses the shield by design**
(`PhysicsSystem`, the mobile-shard `ENV_DAMAGE` branch). A ~1 HP ambient
graze is the same signature as the one unexplained local flake earlier in
P7 — one root cause, now understood.

Dropped the hull assertion with the reasoning inline; the event list is the
whole claim (deflect and absorb are emitted by the two paths a shield-up hit
can take, and by nothing else). Suite-local reruns cannot catch this class —
it is flow-field timing — which is why the comment names the CI failure.

Noted, not changed: tile bumps route environmental damage through the shield
first, shard bumps bypass it. Both are commented as deliberate; whether they
should agree is a design question for the shield/feel pass, not a test fix.

---

## P11 — The flashlight is equipment, and the wake gets a handedness

Two pre-merge asks in one push.

**The flashlight tool + kit** ("make the flashlight an in-game tool that can
be turned on and off by touching the player ship … then add a kit item to
make this a module"). The lighting gauntlet shipped the beam always-on;
light is now EQUIPMENT:

- `flashlight_kit` — the first `utility`-family module (requires hull
  contact, like every ship system). Cost 9,000, weight 0.3, sold as a ship
  module. DBG grant row beside Shield/Overcharge.
- With the kit installed, the SELECT-YOUR-SHIP gesture (tap / E / pad
  action) in open space cycles `off → medium → high`
  (`FLASHLIGHT_TOOL_LEVELS`: 0° / 40° / 75° half-angles — low beam and high
  beam). The gesture stays ONE arbitration: a dock or portal in range still
  wins; the light claims only the tap nothing else wanted — which also means
  a ship-tap with the kit aboard no longer fires a stray shot at your own
  hull.
- The tool overrides the DBG flashlight global
  (`RenderSystem.playerLightToolHalfDeg`, written per frame beside
  `stageDepth`); the global itself now ships **'off'**, so a kit-less ship
  carries no player beam and the debug row survives as the raw dev override
  underneath. Uninstalling the kit — adjacency-offline included — zeroes the
  level in `applyModuleEffects`: a removed tool must not leave its beam
  burning.
- Two lighting-suite pins updated deliberately (the beam-default was a
  documented user call, superseded by this one): the DBG default is 'off'
  and the cycle order starts there.

**The nebula wake handedness** ("shards on the starboard side should rotate
clockwise — I think it is rotating counterclockwise"). The report was
half-right in an interesting way: the swirl pass signed each shard's spin by
its id's LAST-CHARACTER PARITY ("varied vortices"), so a pass had no
consistent handedness at all — roughly half of any cloud turned against the
wake. The sign is now the DBG cycle Visual ▸ "Neb spin":

- `physical` (default): the wake shear — the ship's velocity crossed with
  the ship→shard offset — so a starboard pass turns a shard clockwise on
  screen and a port pass counter-clockwise. Below a small speed floor the
  parity fallback keeps an idle cloud varied (a parked ship sheds no wake).
- `inverted`: the same cross product negated — the A/B the report asked for.
- `random`: the shipped parity behaviour, kept as the control.

**Proper rotational mechanics parked**, as advised and agreed: moment of
inertia + off-centre impact torque in the impulse solver is its own session
(the per-pair solver is the engine's hottest and most delicate code — spin
jitter at rest, the shard sleep gates, and a perf recapture all come with
it). `docs/PARKING_LOT.md` carries the full plan and sequencing.

`tests/flashlight.spec.ts` (5) + `tests/nebulaspin.spec.ts` (3), each gate
verified non-vacuous: removing the kit gate fails the no-kit test; flipping
the cross product fails both directional tests. 214 → 222.

---

## P12 — "Light", and the levels are lighting tiers

Two corrections to P11 from the user's review (nebula `physical` spin
approved as-is):

- **The module is called "Light"** (catalog label + DBG grant row; the id
  stays `flashlight_kit` — ids are internal and every reference already
  points there).
- **Medium and high were meant as LIGHTING TIERS, not cone widths.** Both ON
  levels now wear the BEAM style (the 80° cone); what separates them is the
  tier: medium runs the light system at the 'medium' rung, high at 'high' —
  longer reach, bigger occluder budget, soft penumbra, the whole ladder step.
  Implemented as `setLightingTierOverride`, written per frame in draw beside
  the cone override, and read INSIDE `getActiveLightingTier` so every
  consumer of the tier — occluder collection, canvas divisor, light budget —
  agrees. The DBG tier row (default 'low') stays the raw dev override
  underneath, exactly the flashlight-width arrangement.

`flashlight.spec.ts` re-pinned: medium asserts tier 'medium' with the beam
cone; high asserts the cone UNCHANGED and the tier stepped; off asserts the
tier falls back to the DBG global's 'low'.

---

## P13 — The light speaks headlight, not debug

The over-ship message on a light cycle was `Light: off / medium / high` —
the tier vocabulary, which is debugging language (user call). The levels now
carry a player-facing `label` beside the internal `name`: **Light off / Low
beam / High beam**. `name` keeps naming the TIER the level runs (that is
what it is), and nothing but the message reads the label.

---

## P14 — The full suite moves to the merge seams

> "set them up such that they only run at major branch merges instead of
> after every commit. They currently take a significant amount of time."

`pr-checks.yml` now runs in two scopes under ONE check name (so branch
protection keeps pointing at `typecheck · build · test`):

- **SMOKE, every PR push** — typecheck + build + `boot.spec.ts` +
  `loop.spec.ts` (~3 minutes). The canary and the full-game loop: proves
  the game boots and IS a game before a merge-point run proves the rest.
- **FULL, at the seams** — the whole suite on pushes to `main` /
  `claude/plan-completion` (right after a merge lands), on PRs based on
  `main`, on the **`full-tests` label** (drop it on any PR to demand the
  whole net before merging — `labeled` is a trigger, so it re-runs
  immediately), and on `workflow_dispatch`.

The honest trade is written into the workflow header: a regression outside
the smoke now surfaces at the merge point rather than per push; the label is
the escape hatch. Local practice moves the same way (CLAUDE.md §7/§9):
touched suites per commit, the full run before a PR is called
ready-to-merge or after a base sync.

---

## P15 — "Sounds feel slightly delayed": measured, and the app side is tight

Investigated end-to-end before the merge. Three measurements, all through
the real build:

1. **Draft onset** (offline render of all 98 registered ids, time until the
   waveform reaches 50% of its own peak): every reactive combat sound —
   weapon fire, impacts, crashes, destroys — is there within **~3ms**. The
   slow tail (dock chord 552ms, repair 382ms, boss-phase sting 202ms) is
   deliberately staged jingles, not reactions.
2. **Dispatch** (real CDP input through the live loop): pointerdown →
   `play()` call is **3–5ms**, eight taps out of eight, at a 16.7ms median
   frame.
3. **Pipeline**: the context is default-latency ('interactive'), voices
   start at `ctx.currentTime`, attacks are 1–4ms, there is no compressor or
   scheduling offset anywhere in the chain. Retrigger windows are all well
   under their triggers' real cadences (blaster 40ms vs a 143ms fire rate).

So the time is going to one or both of the two things OUTSIDE the app:

- **Device output latency** — `baseLatency + outputLatency`, ~40ms on the
  probe browser; iPhone speaker similar; **Bluetooth adds 150–250ms** and no
  code path can shorten it. Now surfaced as a READOUT in the pause menu's
  audio section (`EngineStats.audio.latencyMs`), so the number can be read
  on the exact device that feels late — it labels ≥120ms as likely
  Bluetooth.
- **The touch tap fires on RELEASE** (G13, deliberate: until the finger
  lifts, a tap and a drag are the same gesture). The shot — and therefore
  its sound, which is faithful to the shot — happens a finger-lift after
  the contact the ear expects. The fire button and the pad trigger fire on
  press and do not carry this.

No engine change recommended; the readout is the deliverable. If the number
on-device reads ~40ms and it still feels late on the SPEAKER, the next lever
is the G13 tap-on-release call, which is a feel decision, not a bug.

### P15b — the readout rides the PerfRecorder capture

The pause-menu spot cannot be read while the sound is happening (user
call), so the same number now travels with a recorded session:
`PerfReportContext.audioLatencyMs`, printed in the capture header —
`audio out ~42ms`, flagged `(Bluetooth?)` at ≥120ms. Report-time rather
than per-frame: the route is quasi-static, and a session recorded to
answer "why is sound late" wants the route it ended on. The pause-menu
line stays as the at-a-glance copy.
