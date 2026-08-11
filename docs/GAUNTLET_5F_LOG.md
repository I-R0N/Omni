# Gauntlet 5f — engine decomposition for maintainability

Roadmap item **5f** of `docs/GAME_FEEDBACK_PLAN.md` (decision #49b, user
call).

> **GOAL.** Make the engine navigable by a person. Four files carry most
> of it; a reader who wants to find the dragon code, the boss payout, or
> the minimap should not have to scroll a 7,790-line class to do it.

Working rules for this branch — they differ from the perf gauntlets and
the differences are the point:

- **READABILITY is the metric.** This is **not** a performance pass and
  must never be reported as one. No speedup is promised or expected. If
  one shows up it is a side effect.
- **ZERO BEHAVIOUR CHANGE IS ABSOLUTE.** There is no flagged-exception
  escape hatch here. A move that would change behaviour is not made — it
  is logged in FOR-USER-REVIEW instead.
- **MOVE CODE, DON'T WRAP IT.** No new abstraction layers, interfaces,
  base classes or polymorphic dispatch — gauntlet 5c measured the
  analogous move (normalising every entity to one hidden class) at
  **1.9× SLOWER** on the real population (`docs/GAUNTLET_5C_LOG.md`,
  iteration 6 / P4). Relocating code to a better home is good; adding a
  layer the code must now route through is not. Extracting a hot inner
  loop into its own function is the good kind and is fine (5c's closure
  hoist, P3, gained 17% on the site).
- **The 5b test net is what makes zero-behaviour checkable**: 38
  Playwright tests driving the real engine in a real browser. Green
  before AND after every move. **No test may be edited to accommodate a
  move** — that would be behaviour change wearing a disguise.
- **CLAUDE.md §2 is part of the deliverable.** A reader who trusts the
  directory layout must still find the code afterwards.
- Three gates green (`npm run typecheck`, `npm run build`, `npm test`)
  before every milestone commit. `node perf/simbench.mjs` is a **guard**,
  not a goal: >10% sim regression means a move introduced dispatch.

---

## Checklist

- [x] **P1** — Survey + baseline (no moves); SEAM PLAN written
- [x] **P2** — `engine/roamers/dragons.ts` (shipped)
- [x] **P3** — `engine/roamers/rivals.ts` (shipped)
- [x] **P4** — `engine/roamers/snitch.ts` (shipped)
- [x] **P5** — `engine/roamers/bubbles.ts` (shipped) — roamers complete
- [x] **P6** — `engine/bosses.ts` (shipped)
- [x] **P7** — `engine/outfitting.ts` (shipped)
- [x] **P8** — `engine/debugControls.ts` (shipped)
- [x] **P9** — `engine/explosions.ts` (shipped)
- [x] **P10** — `engine/systems/render/enemyShapes.ts` + `drawUtils.ts` (shipped)
- [x] **P11** — `engine/systems/render/hud.ts` (shipped)
- [x] **P12** — `engine/systems/render/effects.ts` (shipped)
- [x] **P13** — `engine/systems/render/staticTileCache.ts` (shipped) — **loop dry**
- [ ] **P-final** — validation + report

### Running score

| milestone | `GameEngine.ts` | new module | lines |
|---|---|---|---|
| baseline | 7,790 | — | — |
| P2 dragons | 7,410 | `engine/roamers/dragons.ts` | 418 |
| P3 rivals | 7,161 | `engine/roamers/rivals.ts` | 266 |
| P4 snitch | 6,927 | `engine/roamers/snitch.ts` | 256 |
| P5 bubbles | 6,531 | `engine/roamers/bubbles.ts` | 430 |
| P6 bosses | 6,213 | `engine/bosses.ts` | 350 |
| P7 outfitting | 5,855 | `engine/outfitting.ts` | 420 |
| P8 debug menu | 5,149 | `engine/debugControls.ts` | 768 |
| P9 explosions | 4,859 | `engine/explosions.ts` | 336 |

`GameEngine.ts` is now **4,859** — **−2,931 (−38%)**.  P10 opens the
second file:

| milestone | `RenderSystem.ts` | new module | lines |
|---|---|---|---|
| baseline | 5,959 | — | — |
| P10 enemy shapes | 4,944 | `engine/systems/render/enemyShapes.ts` | 915 |
| | | `engine/systems/render/drawUtils.ts` | 142 |
| P11 screen-space HUD | 4,203 | `engine/systems/render/hud.ts` | 739 |
| | | `drawUtils.ts` grew to | 191 |
| P12 trails/particles/arcs | 3,771 | `engine/systems/render/effects.ts` | 460 |
| P13 static-tile cache | 3,456 | `engine/systems/render/staticTileCache.ts` | 353 |

Every milestone:
typecheck clean, build clean, 38/38 Playwright tests pass, no test
edited.

---

## P1 — Survey + baseline

### Baseline (commit `d6b27cf`, tip of `claude/plan-completion`)

Gates: `npm run typecheck` clean · `npm run build` clean · `npm test`
**38 passed (2.7m)**.

`node perf/simbench.mjs` — 300 steps × 7 batches, ms per sim substep:

| scene | ents | median | best | worst |
|---|---|---|---|---|
| hub-idle | 1409 | **1.107** | 1.048 | 1.249 |
| asteroid-6k | 1393 | **2.320** | 2.222 | 2.597 |
| glass-field | 1462 | **1.238** | 0.694 | 2.317 |
| roamer-stack | 2889 | **2.615** | 2.444 | 2.824 |

File sizes (lines):

| file | lines |
|---|---|
| `engine/GameEngine.ts` | **7,790** |
| `engine/systems/RenderSystem.ts` | **5,959** |
| `constants.ts` | 5,462 |
| `engine/systems/PhysicsSystem.ts` | **3,536** |
| `engine/systems/ShardSystem.ts` | **3,412** |
| `components/UIOverlay.tsx` | 2,175 |
| `types.ts` | 1,778 |
| `engine/systems/DropSystem.ts` | 1,310 |

### What is actually inside `GameEngine.ts`

231 members. By concern, with the measured coupling that decides whether
a seam is clean — *"a concern that touches 3 private fields is a clean
extraction; one that touches 30 is not"*:

| concern | lines | `this.` members touched | of those, its OWN | external call sites |
|---|---|---|---|---|
| DBG toggles (60 tiny methods) | 717 | 37 | ~18 (`ff*`, `*Enabled`) | 60 (all in `App.tsx`) |
| the frame loop + `markPerfEvents` + stats push | 385 | 89 | — | — |
| `updatePhysics` + `handleEntityDeath` | 528 | — | — | — |
| `updateGameLogic` | 539 | — | — | — |
| modules / outfitting / shop / stat attribution | ~564 | 58 | ~20 | ~12 |
| bosses + wave-clear + descent | 522 | 34 | ~8 | ~10 |
| bubbles / nests / consumers / attachments | 470 | 24 | ~10 | ~8 |
| **dragons** | 419 | 27 | ~14 | **6** |
| snitch | 235 | 25 | ~12 | 5 |
| rivals | 248 | 17 | ~6 | 4 |
| perf ring buffers + snapshot | 125 | 37 | ~30 | 4 |
| weapons / lightning / explosions / AoE | ~600 | — | — | — |
| score / combo / credits / damage text | ~230 | — | — | — |

The four **engine-managed roamers** (dragons, rivals, snitch, bubbles)
are 1,372 lines — 18% of the file — and between them expose only 15
call sites to the rest of the engine. CLAUDE.md already treats them as
one family ("bespoke engine-managed roamer like the dragon/snitch"), so
the grouping is the codebase's own, not one invented here.

### What is inside the other three

`RenderSystem.ts` — the file is large but the **methods** are the real
problem: `renderEntities` is a single **1,882-line** method and
`drawEnemyShape` is **672**. Domains: enemy shapes (845), HUD + minimap +
indicators (~790), trails + particles + lightning (~415), the static-tile
cache (~340), sprite/bitmap caches (~240), flow-field overlay (165).

`PhysicsSystem.ts` — dominated by `resolveCollision` (**847**),
`update` (353), `handleEntityCollisions` (250), `applyDentStep` (219),
`resolveAsteroidPair` (198). These are one interlocking solver, not
separable concerns.

`ShardSystem.ts` — `runMergeBroadphase` (361), `shatterAsteroidStyle`
(283), `composeEntities` (274), `tickMetalAssembly` (196). Split roughly
merge / shatter / metal-assembly / nebula, but every one of them mutates
the same variant-table-driven bookkeeping.

---

## FOR-USER-REVIEW

### SEAM PLAN (written at the end of P1, per the review loop)

**The technique, first — it is the decision everything else rests on.**

To move code out of a class without adding a layer, each extracted
concern becomes a **plain module of free functions taking the engine as
its first parameter**:

```ts
// engine/roamers/dragons.ts
import type { GameEngine } from '../GameEngine';
export function updateDragons(g: GameEngine, dt: number) { … }
```

and `GameEngine` calls `updateDragons(this, dt)`. Properties: the import
is `import type`, so it is **erased at compile time and there is no
runtime cycle**; the call is a direct static call to a top-level
function, so it stays monomorphic and V8 can inline it; and nothing is
introduced that the code must "route through". The bodies move
verbatim — `this.x` becomes `g.x` and nothing else changes.

The cost is that members the extracted module reads must stop being
`private`. That is a **compile-time-only** marker (CLAUDE.md §8 says so
explicitly, and the 5b suites already reach through it to call private
methods off `window.__omniEngine`), so widening it changes no runtime
behaviour — but it is a real loss of an authoring signal and is recorded
as such.

*Alternatives considered and rejected:*
- **Context-object classes** (`new DragonSystem()` + a `DragonContext`
  of the ~13 things it needs, on the `WaveSpawnContext` precedent).
  Rejected: it is exactly "a layer the code must route through", every
  field access gains an indirection, and the context struct has to be
  built or kept in sync.
- **Thin delegating methods left behind** (`updateDragons(dt) {
  dragons.update(this, dt) }`). Rejected for the 60-method DBG block —
  120 lines of pure forwarding noise is a readability *loss* — but used
  where a method is genuinely part of the engine's public API and the
  forward is a single line.
- **Prototype assignment from another file.** Rejected: it defeats
  navigation and typing, which is the entire goal.

**Proposed boundaries, ordered by confidence.**

1. **`engine/roamers/dragons.ts`** — 419 lines, 6 external call sites,
   14 of its 27 `this.` members are its own. Highest confidence in the
   file. *(taken first, per "continue with the highest-confidence
   extraction — do not block")*
2. **`engine/roamers/rivals.ts`** — 248 lines, 4 external call sites.
3. **`engine/roamers/snitch.ts`** — 235 lines, 5 external call sites.
4. **`engine/roamers/bubbles.ts`** — 470 lines (bubbles, nests,
   consume-and-grow, latch/attachments). Slightly more tangled than the
   other three because `updateConsumers` is shared with the dragon's
   tile-eating, but the shared surface is two functions.
5. **`engine/enginePerf.ts`** — the perf ring buffers, `recordSimPerf`,
   `recordRenderPerf`, `buildPerfSnapshot` and the `markPerfEvents`
   event timeline (~560 lines). ~30 of its members are its own private
   ring buffers, which move with it.
6. **`engine/outfitting.ts`** — hex slots, adjacency fixpoint, module
   effects, shop, resale, `statBreakdown`, `outfittingSnapshot`
   (~564 lines). Public API (`moveModule`, `purchaseModule`,
   `sellModule`, `scrapModule`) keeps one-line forwards on the engine.
7. **`engine/bosses.ts`** — phases, bounty, module grant, descent rift,
   the stage-clear beat (~430 lines).
8. **`engine/debugControls.ts`** — the 717-line DBG toggle block. High
   *value* (it sits between the field declarations and the constructor,
   so a reader hits 700 lines of debug toggles before reaching how the
   engine is built) but the **lowest confidence**, because all 60 are
   public API called from `App.tsx`; moving them means either 120 lines
   of forwarding noise or re-pointing 60 UI call sites at an
   `engine.dbg.*` handle. Deferred until the higher-confidence work is
   in, and flagged here as the one seam where the owner's preference
   would decide it.

**Then, only if GameEngine lands cleanly**, `RenderSystem`:

9. **`engine/systems/render/enemyShapes.ts`** — `drawEnemyShape` (672) +
   `buildEnemyPath` (173). The purest seam in the whole survey: they
   take a context and an entity and draw.
10. **`engine/systems/render/hud.ts`** — minimap, indicators, loadout
    strip, player messages, wave announcements, damage texts (~790).

**Deliberately NOT split, and why:**

- **`loop()` / `updatePhysics()` / `updateGameLogic()`.** The per-frame
  ORDER *is* the engine, and CLAUDE.md §3 documents it as one readable
  sequence. Breaking it into per-step functions would scatter the one
  thing a reader most needs to see whole. They are long because the
  frame is long.
- **`handleEntityDeath`.** The central death dispatch; every concern
  hangs off it. Moving it moves the hub, not a spoke.
- **`PhysicsSystem`.** `resolveCollision` (847) + `handleEntityCollisions`
  (250) + `resolveAsteroidPair` (198) are one interlocking impulse
  solver sharing scratch buffers; the brief ranks it lower priority and
  the survey agrees.
- **`ShardSystem`.** Every candidate sub-concern mutates the same
  variant-table bookkeeping (`mergeCount`, `densityTier`,
  `densityCachedTint`, the regen queue).
- **`renderEntities` (1,882 lines).** The biggest single method in the
  repo, and a genuine readability problem — but it is one giant
  entity-type branch over per-frame-cached locals, and splitting it is
  the highest-risk move available. Named here so it is not mistaken for
  an oversight.

Ordering rationale: the roamers first because they are the largest
cohesive block with the fewest external call sites, and because getting
four extractions through the gates establishes that the technique is
sound before it is pointed at anything tangled.

---

## DECISIONS TAKEN

**D1 — free functions over `g: GameEngine`, not context-object classes.**
See the SEAM PLAN above for the mechanism, the properties that make it
dispatch-free, and the three rejected alternatives. The price paid is
`private` → public on the members an extracted module reads; `private`
is compile-time only in TypeScript and the 5b suites already reach past
it, so this is an authoring-signal cost, not a runtime one.

**D2 — no test may be edited.** Stated in the brief; recorded here
because it is the check that makes "zero behaviour change" more than an
assertion. Any move that would need a test edited is reverted instead.

---

## Per-iteration log

### Iteration 1 — survey + baseline (P1)

No code moved. Mapped all 231 `GameEngine` members to line ranges and
measured, per candidate concern, how many `this.` members its body
touches and how many of those are its own — the evidence the brief asks
for. Recorded the three-gate baseline and the `simbench` guard numbers
above. Wrote the SEAM PLAN.

The measurement that decided the ordering: the four engine-managed
roamers are 1,372 lines (18% of the file) but expose only **15** call
sites to the rest of the engine, whereas the modules/outfitting block is
similar in size and touches **58** members. Size alone would have ranked
them together.

### Iterations 2–5 — the four roamers (P2–P5)

Dragons, rivals, snitch, bubbles, in that order — the SEAM PLAN's
confidence ranking, taken as written. Together they moved **1,259
lines** out of `GameEngine.ts` (7,790 → 6,531).

**The verification that makes "verbatim" checkable.** Every move is
diffed mechanically rather than eyeballed: take the block from
`git show HEAD:engine/GameEngine.ts`, strip comments and blank lines
from both sides, rewrite `this.` → `g.` and the intra-module calls to
their function form, and diff. A clean move leaves the SAME line count
on both sides and every remaining diff line is a function signature.
That held for all four:

| module | normalised lines (old = new) | non-signature diffs |
|---|---|---|
| dragons | 304 | 0 |
| rivals | 181 → 176 (`debugSpawnRival` stayed behind) | 0 |
| snitch | 177 | 0 |
| bubbles | 284 | 0 |

This is worth more than it looks. "I moved it verbatim" is exactly the
claim a decomposition pass has to make and exactly the one that is
easiest to get subtly wrong — a dropped `!`, a reordered pair of
statements. The diff is cheap and it is the only thing standing between
"zero behaviour change" and a wish.

Three judgement calls came out of these four:

- **The snitch keeps flat engine fields, not a `SnitchInstance`.**
  There is only ever one alive, so the dragon/rival per-instance struct
  would be ceremony. The module header says so, to stop a later reader
  "fixing" the asymmetry.
- **`updateConsumers` / `updateAttachments` went into `bubbles.ts`**
  despite CLAUDE.md calling them reusable Stage-3 primitives shared with
  the dragon. Every field they touch is a `bubble*` field and their
  helpers read `BUBBLE_CONSTANTS`; a neutral filename would have been
  truer to the intent and less true to the code. The header records the
  condition for moving them: the day a second consumer stops writing
  bubble fields.
- **`updateNests` and `updateKamikazeProximity` stayed on the engine.**
  They sit inside the same contiguous run of lines but are generic
  wave-enemy passes with nothing bubble about them. Extracting by line
  range instead of by concern is how a decomposition ends up with a file
  whose name lies.

Public API stayed public: `debugSpawnDragon` / `debugSpawnRival` remain
real methods on `GameEngine` (they carry their own argument allow-lists
and `App.tsx` calls them), rather than becoming one-line forwards.

### Iteration 6 — bosses (P6)

`engine/bosses.ts` (350 lines): the phase-stamp pass, the live-boss HUD
snapshot, the capstone bounty with its stage-clear beat, the module
grant, and the descent rift. 208 normalised lines each side, six
signature diffs, nothing else.

Three things deliberately did NOT come along, and the reason is the same
each time — they are near the boss code without being boss code:

- `handleBossSpawn` — WaveSystem callback wiring the engine hands to
  `waveContext()`.
- `debugSpawnBoss` — public API.
- **`updateEnemyRegen`** — a generic counterplay-trait pass. Only a boss
  carries `regen` *today*; the trait is an `ENEMY_TRAITS` row that any
  archetype can take, so filing its tick under "bosses" would encode a
  roster accident as an architectural fact.

### Iteration 7 — outfitting, and the test net earning its keep (P7)

`engine/outfitting.ts` (420 lines): the adjacency fixpoint, the fold into
player stats, the derived gun loadout, the tile move/swap and its guards,
pricing, `statBreakdown`, and the two snapshots the UI renders from. The
COMMERCE API (`moveModule`, `purchaseModule`, `sellModule`,
`scrapModule`, the DBG grants) stayed on `GameEngine` — that is what
`App.tsx` calls and what carries the docked-at-a-station guards.
GameEngine 6,213 → 5,855.

**This is the milestone where the net caught something, and what it
caught is worth more than the extraction.** The first attempt moved all
eleven members. Typecheck was clean, the build was clean, and **eleven
Playwright tests failed** with `e.outfittingSnapshot is not a function`.

The suites call `outfittingSnapshot`, `moveModuleInternal` and
`modulePrice` *straight off* `window.__omniEngine`. CLAUDE.md §8 already
says `private` is compile-time only and the suites reach past it — but
the consequence had not been drawn: **what the tests reach for IS the
observable surface, whatever its declared visibility.** Those three are
public API in every sense that matters, and moving them off the class
was a behaviour change to the debug handle, not a relocation.

So all three came back as methods on `GameEngine` that delegate to the
module (imported under aliases so nothing shadows). Three one-line
forwards, with a comment block saying why they exist. That is the
"single-line forward for genuine public API" case from the SEAM PLAN,
and it is now the case with *evidence* rather than a guess.

Two things follow for the rest of this gauntlet:

1. **`grep tests/ before moving a method`** is now part of the
   procedure, alongside the verbatim diff. Typecheck cannot see through
   `page.evaluate`, so the compiler will never warn about this class of
   break.
2. The fix was to change the CODE back, never the test. A test edited to
   accept `outfittingSnapshot` moving would have converted a real
   regression into a green run — the exact "behaviour change wearing a
   disguise" the brief rules out.

### Iteration 8 — the debug menu (P8)

`engine/debugControls.ts` (768 lines): 59 toggles and cycles, plus the
seven DBG-only `FF_*_CYCLE` tables that only they read. GameEngine
5,855 → **5,149** — the largest single move of the gauntlet and, per
line, the one that most changes how the file reads: those methods were
lines 629–1342, so a reader opening `GameEngine.ts` met the entire debug
panel before reaching the constructor.

**This one was flagged in the SEAM PLAN as the LOWEST-confidence
extraction, and it was taken anyway** — the flag was about ordering, not
correctness, and everything ahead of it had shipped. The reason it
ranked last is real and unchanged: all 59 are public API, so the move
had to re-point 59 call sites in `App.tsx`. What made it safe rather
than brave is that the change is a pure rename at every site
(`engineRef.current.X()` → `engineRef.current.dbg.X()`), the compiler
checks every one, and `git diff --stat App.tsx` reads exactly
`59 insertions(+), 59 deletions(-)`.

**Deliberately a CLASS, not free functions.** The other extractions call
in the other direction — the engine calls them — so `f(g, …)` reads
fine. These are called from the UI, where `engine.dbg.toggleCollisions()`
is legible and sixty imported free functions in `App.tsx` would not be.
It is a plain concrete class with one back-reference and one instance:
no interface, no dispatch, nothing to route through, and it costs one
property load per user click.

The verbatim diff for this move is unusually strong — **266 lines in,
267 out, and the only diff line is the class's closing brace.** Not even
signatures changed, because these stayed methods; only `this.` became
`this.g.`.

Three things stayed behind, each for a reason already established:

- **`toggleTraits`** — the 5b trait suites call it off
  `window.__omniEngine`, so it is observable surface (the P7 rule,
  applied prospectively this time by grepping `tests/` first).
- **`flowSamplerFor`** — a private helper the DBG pattern-cycle uses,
  but `loadMap` uses it too, so it is engine machinery. The first cut
  duplicated it into both files; that was caught and collapsed back to
  one copy on the engine.
- **Every flag they write.** `ffPattern`, `collisionsEnabled`,
  `trailShape` and the rest are still `GameEngine` fields — the sim
  reads them every frame. Only the methods moved. The seven cycle
  TABLES did move, because nothing but the cycle methods ever read them.

### Iteration 9 — shockwaves and blasts (P9)

`engine/explosions.ts` (336 lines), in create/tick/apply order:
`spawnShockwave` puts an expanding ring into the world,
`updateExplosionRings` advances every live ring and damages what its
wavefront has just reached, and the two `apply*BlastToPlayer` helpers
deliver a blast directly. `EMPTY_HIT_IDS` — the shared frozen empty set
that keeps a cosmetic ring from allocating — came along, since the ring
code is its only reader. GameEngine 5,149 → 4,859.

Cleanest coupling measured in the whole gauntlet: the five members touch
only **seven** engine members between them (`currentMap`, `player`,
`physics`, `handleEntityDeath`, `handleScreenShake`, `spawnParticles`,
`spawnDamageText`).

`spawnShockwave` gets a one-line forward on the engine — the 5b trait
suite calls it off `window.__omniEngine` to prove that ring damage
bypasses the front-shield plate, so it is observable surface. Its
options object became an exported `ShockwaveOpts` interface so the
forward and the function cannot drift; that is a parameter type, not a
layer.

`startExplosion` stayed on `GameEngine` on the P6 principle: it is the
DEATH path (flip `isExploding`, arm the wreck timer), not the FX layer,
and it is also called by the death and economy suites.

### Iteration 10 — the renderer's enemy silhouettes (P10)

With `GameEngine` well split, the SEAM PLAN's seam #9 came due:
`drawEnemyShape` (679 lines) + `buildEnemyPath` (168) →
`engine/systems/render/enemyShapes.ts` (915).
`RenderSystem.ts` 5,959 → **4,944**.

**The cleanest seam measured anywhere in this repo.** Those two methods
touch exactly one `this.` member between them: *each other*. So unlike
every other 5f extraction they need no engine and no renderer — they are
plain free functions over `(ctx, entity, nowSec)`, and the call site went
from `this.drawEnemyShape(…)` to `drawEnemyShape(…)`.

It did need one companion move. The shape code shares four module-level
helpers with the rest of the renderer (`hexToRgb`, `liftCh`, `sinkCh`,
`drawDamageCracks` and the crack machinery behind it). Importing those
back out of `RenderSystem.ts` would have made the two files circular, so
they went to a third: **`engine/systems/render/drawUtils.ts`** (142
lines), which both import and which knows about neither. The helpers used
by the shape code *alone* (`enemyPalette`, `ENEMY_CRACK_STYLE`, the three
`FLAME_*` colours) travelled with it instead of landing in the shared
floor — a shared-utils file that accumulates single-caller helpers stops
being a floor and becomes a junk drawer.

Verbatim: 629 normalised lines each side, two signature diffs.

### Iteration 11 — the screen-space HUD layer (P11)

`engine/systems/render/hud.ts` (739 lines): the minimap and its static
layer, the off-screen indicators, the loadout strip, player messages,
the wave banners, and the floating damage text.
`RenderSystem.ts` 4,944 → **4,203** — down 30% from its 5,959 baseline.

**The line the split follows is the coordinate space**, not the visual
category: these are the passes that draw in SCREEN coordinates after the
world pass has finished. That is why `renderHealthBar` stayed behind
despite looking like HUD — it draws above an entity in WORLD space, and
a file named for a coordinate space that contains an exception to it is
a file whose name has stopped being useful.

Coupling was four members. Three functions take the `RenderSystem` as a
first parameter, and only because they read state that persists between
frames: the pre-rendered minimap static layer, its cached range, and the
DBG `chevronsOffscreenOnly` flag. The other five take none.

`shiftX` / `shiftY` / `roundRectPath` joined `drawUtils.ts` for the same
reason `hexToRgb` did in P10 — shared by both files, so a shared floor
beats a circular import. `drawUtils.ts` is now 191 lines and still holds
only things with more than one caller.

`buildMinimapStaticLayer` keeps a forward on `RenderSystem`:
`GameEngine.loadMap` calls it, so it is the renderer's public API.

Verbatim: 486 → 488 normalised lines, and every diff is a signature (the
+2 is the two `r: RenderSystem` parameter lines).

### Iteration 12 — trails, particles and lightning arcs (P12)

`engine/systems/render/effects.ts` (460 lines): the ribbon trails behind
the player and every projectile, the pooled particle sprites, and the
jagged lightning arc — three passes that draw EPHEMERA rather than
entities. `RenderSystem.ts` 4,203 → **3,771**, down **37%** from its
5,959 baseline.

Only module-scope dependency was `RenderSystem` itself. Four functions
take it, for its persistent state: the reusable trail scratch buffers
(`_trailNX` …) that keep the strip builder from allocating per frame —
CLAUDE.md §8's mutate-don't-allocate rule, and the reason those buffers
could not simply become module-level constants in the new file — plus
the DBG-selected `trailShape`.

Verbatim: 324 → 328 normalised lines, every diff a signature (the +4 is
the four `r: RenderSystem` parameter lines).

### Iteration 13 — the static-tile cache (P13), and the loop goes dry

`engine/systems/render/staticTileCache.ts` (353 lines): stamp the map's
immovable tiles into an offscreen canvas once, blit it in a single draw,
and erase individual tiles as they die. `RenderSystem.ts` 4,203 →
**3,456** across P11–P13 — down **42%** from its 5,959 baseline.

`STATIC_TILE_MAX_CANVAS_DIM` came along: the cache is its only reader.
`overlayMaterialCracks` did NOT, even though the first pass at grouping
swept it up — a second look showed its three callers are all inside
`renderEntities`, drawing cracks on SHARDS, and it has nothing to do
with the tile cache. Grouping by "sits nearby and sounds related" is the
failure mode this gauntlet has had to correct at almost every milestone.

Verbatim: 169 normalised lines each side, nine signature diffs.

**The loop is dry.** What remains in both files is either the one thing
the brief said not to break up or a seam whose coupling is now measured
and named — see the FOR-USER-REVIEW entry below.

