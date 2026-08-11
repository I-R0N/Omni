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
- [ ] **P2..Pn** — one extraction per milestone, loop until dry
- [ ] **P-final** — validation + report

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
