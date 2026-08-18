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
