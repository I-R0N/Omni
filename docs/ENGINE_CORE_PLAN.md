# Engine Core & Mobile Shipping — Base Plan

> **Status: FORWARD-LOOKING PLAN, and it is LIVE.**  Unlike
> `POLISH_ARCHITECTURE.md` / `PARKING_LOT.md`, this doc is *maintained* —
> it is the working agreement between the planning session and the work
> sessions it drives, and it is amended as decisions land.  Nothing in it
> should be read as shipped.  `CLAUDE.md` stays the source of truth for
> what exists; when an element lands, strike it here and record it there
> per CLAUDE.md §10.

## 0. How this document is used

**The shape of the work.**  One planning session (the "PM session") owns
this plan.  Four work sessions (`S1`–`S4`, plus a deferred `S5`) each run
as a separate Claude Code session against the integration branch, and each
one is built around **gameplay decisions the user makes inside that
session**.  Session IDs are the handles every prompt should use.

**Decisions are NOT pre-made here.**  This plan states the *open
questions*, the options, and the consequence of each option — deliberately
without answers.  The user evaluates and decides **inside the work
session**, with the game in front of them, not in the planning session.
A session that finds itself guessing at a gameplay answer has found a
missing question, not a licence to pick one.

**A session amends the plan.**  Each work session is expected to edit this
document as it goes:

1. Append every decision to **§7 Decision Log**, with the question, the
   options weighed, the call, and its consequences.  IDs are sequential
   (`D1`, `D2`, …), **never reused and never deleted** — a reversal is a
   new entry that supersedes an old one, keeping both visible, per the
   house habit of recording what was tried and thrown away.
2. Freely rewrite **its own session section** in §4 to match what was
   decided.
3. **Never rewrite another session's section.**  When a decision changes
   what a later session should do, append the consequence to **§8 Flagged
   for the planning session** and leave that section alone.

**The PM session reconciles.**  It reads §8, updates the affected session
briefs, resolves the flag, and records the reconciliation in §7.  It also
owns session ordering, the invariants in §2, and the decision of when a
phase is coherent enough to merge to `main`.

**Every session's output is two PRs, in this order** (see §5):

1. **The invisible PR** — behaviour-preserving, the invariant stated in its
   description, full suite green.  The user does not need to play it.
2. **The gameplay PR** — small, built on top, and the only one that needs
   judging by playing it through the preview link.

---

## 1. The goal, sharpened

> **The simulation is a deterministic, platform-free library.  The game is
> a thin shell over it.  Content is data.**

Three consequences worth stating plainly, because each one rules out a
tempting wrong turn:

- **"Engine" does not mean a reusable engine.**  A general-purpose engine
  in the Unity sense is unbounded work with no shipping value.  The target
  is narrower: the sim is a library, the platform sits behind named ports,
  and the tuning lives in data.
- **"Portable to console" does not mean shared code.**  No console runs
  TypeScript, so a console version is a reimplementation either way.  What
  this plan buys is that the reimplementation becomes a **verified
  mechanical translation**: a deterministic sim plus recorded input plus
  data-driven content means a C++/Rust/C# port can replay the same inputs
  against the same seed and be checked for identical state hashes.  A port
  stops being an archaeology project and becomes a test that passes or
  fails.  Console may also simply be a *different game* (user call) — that
  is fine, and this plan does not depend on it happening.
- **Mobile is the near goal; Steam is a later port.**  The game is already
  shaped for a 390×844 phone — touch schemes, tap floors, portrait HUD —
  so the App Store asks nothing of that layout while Steam would require a
  full desktop HUD and input pass.  Steam costs engineering; mobile costs
  paperwork.  Mobile first (`S4`), Steam deferred (`S5`).

**THE DISCIPLINE RULE.**  Every engine item in this plan must pay off for
the mobile game *now*, not only at a hypothetical console port.  Anything
that cannot name its near-term payoff comes off the list.  Each session
section below states its payoff explicitly; if that line stops being true,
the item is wrong.

---

## 2. Invariants — what no session may break

Plan-level invariants.  (The code-level ones — torus math, fixed timestep,
mutate-don't-allocate, the refill idiom — are CLAUDE.md §8's and are
unaffected by any of this.)

1. **The phone preview loop keeps working.**  `pr-preview.yml` →
   `i-r0n/omni-standalone` → githack is the review surface for every
   gameplay change.  No session may break it, and no session may introduce
   a change only reviewable on a desktop.
2. **A refactor PR changes no behaviour and no tuned number.**  The
   invisible PR of each session states its invariant in the description and
   is expected to be dull.  Tuning changes belong in the gameplay PR.
3. **No gameplay may branch on platform.**  No `if (isElectron)`, no
   `if (isNative)` that changes what the sim does.  This is what keeps the
   phone preview a faithful test of the shipped game, and it is the single
   rule that the whole shipping strategy rests on.
4. **CLAUDE.md is updated when something lands**, per its own §10.  A
   session that changes an invariant and leaves CLAUDE.md stale has not
   finished.
5. **The three gates stay green** — `npm run typecheck`, `npm run build`,
   and the test scope CLAUDE.md §7 prescribes for the moment.

---

## 3. Measured baseline

Measured in the planning session so no work session has to re-derive it.

**Determinism — the sim is currently NOT deterministic.**  300
`Math.random()` call sites outside tests:

| file | sites |
|---|---|
| `engine/systems/DropSystem.ts` | 62 |
| `engine/GameEngine.ts` | 46 |
| `engine/systems/ShardSystem.ts` | 42 |
| `engine/systems/AISystem.ts` | 18 |
| `engine/systems/BackgroundManager.ts` | 14 |
| `engine/maps/MapClasses.ts` | 14 |
| `engine/systems/ParticleSystem.ts` | 12 |
| `engine/maps/TileGenerator.ts` | 10 |
| `engine/systems/WaveSystem.ts` | 9 |
| `engine/systems/NebulaSystem.ts` | 8 |
| `constants.ts` | 7 |
| others (render/nebulaTiles, AudioSystem, roamers/snitch, PhysicsSystem, …) | balance |

The seeded-PRNG pattern **already exists in the repo** and is deliberate
where it is used: `mulberry32` in `engine/systems/fracture.ts`, and
`BackgroundManager.starRand` whose comment says "Deliberately NOT
`Math.random`".  `S1` applies the established pattern to the sim; it does
not invent one.

**Platform coupling** — `window.` / `document.` / `performance.now` /
`navigator.` references per module:

| sim / orchestrator | | adapters (leakage correct here) | |
|---|---|---|---|
| `GameEngine.ts` | 40 | `InputSystem.ts` | 56 |
| `PhysicsSystem.ts` | 10 | `RenderSystem.ts` | 17 |
| `constants.ts` | 8 | `AudioSystem.ts` | 13 |
| `ProjectileSystem.ts` | 6 | | |
| `AISystem.ts` / `ShardSystem.ts` | 2 each | | |
| `WaveSystem.ts` / `WeaponSystem.ts` / `toroidal.ts` | **0** | | |

The sim systems are nearly clean already; the work is concentrated in the
orchestrator.

**Already in the target shape** (do not rebuild these):

- fixed-timestep accumulator with `MAX_FRAME_TIME` clamp and `MAX_SUBSTEPS`
  bound — backgrounding on mobile is already safe
- `toroidal.ts` — pure, zero platform references
- `fracture.ts` — pure seeded core, zero engine imports; the model for the
  whole plan
- `EngineStats` — one-way push to React; the UI never reads engine state
- audio behind one id (`audio.play('<id>')`) with per-system sinks
- input: three devices writing one movement vector / pointer / fire queue,
  with nothing downstream branching on device
- iOS audio-interruption and `visibilitychange` handling (`AudioSystem.ts`)

**The renderer is not the bottleneck.**
`docs/GAUNTLET_WEBGPU_LOG.md` §5a measured worst frames at **88%
simulation**, render under 7 ms, and the verdict was to keep the seam and
not build the WebGPU renderer.  That verdict holds for every platform in
this plan.  **No session in this plan may open the renderer-rewrite
question**; performance work belongs in the sim, which is also what the
headless harness in `S2` makes measurable.

---

## 4. The sessions

### S1 — "What is a run?"  (seeded RNG + run structure)

**Why first.**  It is the only item that gets *more expensive with delay* —
every session landing before it adds new `Math.random()` sites to convert —
and the replay harness it produces makes every later refactor verifiable
rather than hoped-at.

**Status (S1, 2026-10-03): BUILT, play-tested, in PR #109 (both halves).**
Every `Math.random()` site in the game code draws from a named seeded stream
(`engine/systems/rng.ts`), the replay harness exists (`engine/replay.ts`,
`tests/replay.spec.ts`), and all of D-S1-a to g are decided (§7 D1–D8).  The
gameplay half is in too, and the user has play-tested it on the phone
preview: death returns the player to the hub's HOME STATION with installed
modules stripped and salvage / cargo / slots / score kept (D4), no credit
penalty (D6), the death screen offers only "Respawn at Home Station" and Main
Menu (Restart Run was removed by user call), seeding is per ARENA entry with
a persistent hub (D8), and the summary shows the arena's seed (D2).
**Closed as S1's item and handed up:** the descent rift (D5 → D9): the user wants
a redesigned, connected tree of arenas rather than random descent, which is
world-design work for the PM to place (§8).  The one `weapons.spec.ts`
bore-test flake is RESOLVED: the test could pick an already-damaged tile
(not a product bug, not a seed-dependent grain pattern — 2400 pinned-seed bores
on pristine tiles all absorbed exactly 14.4/grain); it now selects a pristine
tile.  The full
suite waits for the user's merge notice (CLAUDE.md §7).

**Near-term payoff** (the discipline rule): bug reports become a seed plus
an input log; the existing 430 tests get far stronger; deterministic
lockstep becomes the cheapest netcode path if multiplayer is ever wanted.

**Engine payload.**  Convert all 300 sim `Math.random()` sites to injected,
seeded streams following the `mulberry32` precedent.  Build the replay
harness: record `(seed, input stream)`, replay, compare state hashes every
N steps.

**OPEN DECISIONS — for the user, inside S1.**  State the options, take the
call, log it in §7.

- **D-S1-a — Is the seed visible to the player?**  Hidden entirely /
  shown on the run summary / enterable at run start / a rotating daily
  seed.  Consequence: anything beyond "hidden" makes the seed a UI surface
  and a support burden; a daily seed implies a clock source and therefore
  touches the `Clock` port in `S2`.
- **D-S1-b — What must the seed cover?**  Terrain generation only /
  terrain + wave composition / everything including drop rolls and
  material condense rolls.  Consequence: this is the scope dial on the
  refactor itself.  Wider means a more valuable replay and more sites to
  convert carefully.
- **D-S1-c — Which streams are SIM and which are COSMETIC?**  Proposed
  split, to be confirmed or amended: **sim** = terrain gen, wave
  composition, spawn placement, drop rolls, fracture seeds, nebula
  condense rolls, chip-dust banking; **cosmetic** = particles, nebula
  twinkle, starfield, audio variant selection, damage-text jitter.
  **AI jitter is the genuine judgement call** — Drone jitter and the swarm
  flock read as part of the fight, so they arguably belong to sim.
  Consequence: getting this wrong makes determinism *silently false*,
  which is the one failure mode the harness exists to prevent.
- **D-S1-d — Does a run END?**  Today it does not: death respawns and the
  descent rift is switched off, so a run has no terminator.  Endless with
  death as a soft reset / death ends the run / a descent chain ends at a
  boss / timed.  Consequence: this is the question `S2`'s save-scope
  decision depends on most.
- **D-S1-e — Is the descent rift switched back on?**  It is off pending a
  rework (`openDescentPortal` exists, verbatim and uncalled).  Consequence:
  turning it on is the cheapest way to give a run an arc, and the depth /
  `waveOffset` / stage-stride machinery behind it is already built and
  tested.
- **D-S1-f — What does death cost?**  The current credit penalty is marked
  provisional in CLAUDE.md.  Keep as-is / tune / replace / remove pending
  the economy pass.
- **D-S1-g — Does the player ever see a replay?**  Dev-only harness /
  share a run / a ghost to race.  Consequence: player-facing replay makes
  the recording format a compatibility surface across versions.

**Invariant for the invisible PR.**  No tuned number changes; no behaviour
changes beyond RNG sequence.  The sequence itself will change (that is the
point), so expect any test asserting an exact random outcome to need a
seed rather than a new expectation — and say so in the PR description.

**Acceptance, as tests to write.**
- replay: same seed + same input log ⇒ identical state hash after N steps,
  over several maps
- the cosmetic streams are proven *not* to affect sim state (advance one
  without the other; hashes must match)
- `grep` guard: no `Math.random()` remains in the sim modules

**Must not touch.**  Balance numbers.  The renderer.  `UIOverlay` beyond
whatever D-S1-a requires.

---

### S2 — "What survives?"  (platform ports + persistence + meta-progression)

**Status (S2, 2026-10-03): BOTH PRs are built** — the invisible one (PR #111) and
the gameplay one (persistence + the wreck, D20–D24, stacked on it).  What landed (D16–D19): the five ports plus Viewport / Lifecycle /
Entropy (`engine/ports.ts`), the browser and headless platforms (`platform/`),
every platform reference stripped from the sim (guarded by
`tests/sim/guard.test.ts`), `Escape` and the background-pause path, the
replay format's four wall-clock reads closed, and the HEADLESS NODE HARNESS
(`npm run test:sim` — 22 tests, ~25 s, in CI before the browser suites).
Read D17 before the acceptance list below: the "same hash as the browser"
criterion holds EXACTLY between a headless-platform engine and the live one in
the same JS engine, and holds across JS engines for the random streams and the
player but not the world, because V8 versions disagree on `sin` / `cos` /
`pow` in the last place.  The user took every open decision in-session
(D20–D24): save = character + installed loadout + wreck + records + settings;
pause only, no run save; the wreck pins its arena's seed and is lost on a
second death; saves migrate; the hub is a fixed backdrop.  Persistence itself
is `engine/save.ts` + the `Storage` port; the wreck is `engine/wreck.ts`.

**Near-term payoff.**  Persistence is the single largest product gap and
blocks every store release.  The port work additionally delivers a
**headless sim in Node**, turning a ~19-minute Playwright suite into
sub-second sim tests — which matters disproportionately for a
phone-driven workflow.

**Engine payload.**  Define and thread the ports — `Clock`, `Storage`,
`Renderer`, `Audio`, `Input` — and strip platform references out of the sim
(`GameEngine`'s 40, `PhysicsSystem`'s 10, `constants.ts`'s 8,
`ProjectileSystem`'s 6).  Add the pause / app-lifecycle path, including the
keyboard `Escape` binding that does not currently exist anywhere.  Stand up
the headless Node harness.

**ALREADY SETTLED before S2 starts — read these first.**  D4 / D6 / D8
(S1) and **D10 / D11** (PM) have already fixed the death and persistence
policy, so three of the decisions below are narrower than they look.  The
settled position: progression is the PERSISTENT CHARACTER, not a run; a
death returns the player to their station, wipes INSTALLED modules only,
leaves CARGO and credits intact, and leaves the wiped loadout RECOVERABLE
from a wreck at the death site; the hub is persistent and only ARENAS carry
a seed.  S2's save floor therefore is: credits, cargo contents, the hub
world, an outstanding wreck record, and nothing for an arena beyond its
seed.

Note how much of that is ALREADY BUILT rather than owed: S1's PR 2 shipped
the station return and the installed-only wipe (`GameEngine.returnToStation`
→ `resetOutfit(true)`, which keeps cargo and the purchased slot counts), so
D11 ratifies the build and S2's job there is to PERSIST it.  The only genuinely
new behaviour the death policy still owes is **D10's wreck**.

**SCOPE — CHARACTER AND SETTINGS ONLY** (user call D14, 2026-10-03).  `S2`
persists the things `S6`'s world redesign (D13) cannot move, and defers the
rest: **IN** — settings, credits, cargo contents, purchased hex-slot counts,
and the outstanding wreck record; **OUT** — per-arena world state (which
nodes keep destroyed tiles and `found` flags).  Deferring that is not a gap:
D8 already made arenas regenerate per entry, so today's behaviour IS the
design, and `S6` owns world persistence when it owns the world.  Two
consequences worth stating because each is easy to get wrong:
- **The HUB is the one world item `S2` cannot skip**, since D8 made it
  persistent while arenas are not.  The cheap path is a FIXED hub seed —
  the hub then regenerates identically every launch for zero bytes of save
  file — rather than serializing a world.  Whether destroyed hub terrain
  should also survive a relaunch is a separate question, and a real one to
  put to the user: it is the difference between a stable backdrop and a hub
  the player can permanently strip.
- **The WRECK record is character state, not world state**, which is what
  keeps D10 inside this scope: `{arena id, seed, position, modules, expiry}`
  pins one seed, and S1's seeded generation reproduces that arena's terrain
  from it.  No arena needs to be serialized for a wreck to be recoverable.

**OPEN DECISIONS — for the user, inside S2.**

- **D-S2-a — What is in the save file BEYOND the settled floor?**  The floor
  above is fixed.  What is still open is whether records (bests, high
  scores) and a full run-in-progress join it — the latter being D-S2-c's
  question too.  Consequence: each step up is a migration surface forever.
- **D-S2-b — What SHAPE does the meta-progression take?**  D4 already
  answered *whether* (the user's words: "this is becoming more of an rpg"),
  so "pure arcade, nothing carries" is off the table and a persistent
  character is in.  What is open is the shape: records and unlocks earned by
  achievement, a profile with levels, and/or **death-proof ship capability**
  — the permanent-vs-consumable split PM raised while settling D10, where
  credits buy things a death cannot touch through the two seams already
  shipped as deliberate no-ops (`purchaseSlot` / `MODULE_SLOT_UNLOCK.START`
  for hex slots, `SHIP_WEIGHT.HULL_BASE` for hull classes).  Consequence:
  reaches the economy, the module catalog and the run summary.  The
  permanent/consumable option is the one with existing machinery behind it,
  but tuning its prices is the economy pass's job, not S2's.
- **D-S2-c — Can a run be suspended and resumed?**  This is a
  **mobile-specific expectation** — a phone call or an app switch must not
  cost a run.  Two implementations, and the choice is a real trade:
  serialize sim state (large, version-fragile, exact) versus replay the
  recorded input log from `S1`'s seed (tiny, free once deterministic, but
  replay time grows with run length).  Consequence: the replay option is
  only available because `S1` happened, and it is a strong argument for
  `S1`-before-`S2`.
- ~~**D-S2-d — Does death take anything permanent?**  Interacts with
  D-S1-f; the two must not be decided independently.~~  **SETTLED** by
  D4 / D6 / D10 / D11: nothing permanent — credits and cargo survive, and
  the installed loadout is suspended in a recoverable wreck rather than
  destroyed.  TWO sub-decisions remain and S2 must put both to the user
  before writing the save format (PM's recommendation for each is in D10):
  - **D-S2-d1 — WHERE does the wreck sit?**  This collides with D8, since an
    arena is seeded per ENTRY and does not persist.  Either PIN that arena's
    seed until the wreck is recovered or lost — S1's seeded generation then
    reproduces the terrain exactly, so the death position stays valid and the
    persisted record is only `{arena id, seed, position, modules, expiry}`
    (**recommended**: the seed is what makes this cheap, which is a direct
    dividend of S1) — or surface the wreck at the arena's RETURN RIFT and
    persist arena identity only (cheaper, loses "fly back to where you fell").
  - **D-S2-d2 — HOW is a wreck LOST?**  On a second death before recovery
    (**recommended**) / after a wall-clock timer / never, it waits forever.
    A timer is actively wrong for a mobile game played in short sessions: it
    punishes putting the phone down, which is not a gameplay decision.
- **D-S2-e — Save-version policy.**  Discard on mismatch / migrate /
  refuse to load.  Consequence: "discard" is cheapest now and the most
  expensive to walk back once players have profiles.
- **D-S2-f — Which settings are worth persisting?**  Audio volume,
  control scheme and difficulty are the obvious three; the scanner
  auto-scan toggle and the screen-shake toggle are candidates.  Feeds
  `S3`'s knob triage.

**Invariant for the invisible PR.**  The sim behaves identically; only
*where* it reads the clock, storage, input and output changes.  The
headless harness must produce the same state hashes as the browser build
for the same seed — which is the cleanest possible proof the ports are
faithful, and is only checkable because `S1` landed.

**Acceptance, as tests to write.**
- headless Node sim reaches the same state hash as the browser for a given
  seed and input log
- settings survive a simulated relaunch
- `Escape` opens pause; backgrounding pauses cleanly and resumes without a
  time jump
- `grep` guard: no `window.`/`document.`/`navigator.` in the sim modules

**Must not touch.**  Balance.  The renderer's drawing.  Capacitor (that is
`S4`).

---

### S3 — "The numbers"  (content as data + balance + knob triage)

**STATUS (S3, 2026-10-04).**  PR 1, the invisible one, is BUILT: the three
tables are `data/*.toml`, parsed at build time into `virtual:table/*` modules
through ONE loader (`scripts/toml-tables.mjs`) that `vite.config.ts` and
`scripts/sim-test.mjs` both import; `tests/sim/tables.test.ts` pins the resolved
values against a golden captured BEFORE the move (commit order: golden + test
first, passing on the old literals; extraction second).  PR 2 (`dmath`) is ALSO BUILT, rolled
into the SAME PR at the user's request (to keep the PR count down): separate
commits, so the invisible table move and the behaviour-moving math layer stay
reviewable apart.  `engine/systems/dmath.ts` replaces every native libm call and
`**` in the sim; `tests/sim/guard.test.ts` keeps it out; Node and Chromium now
agree on the WORLD bit for bit (`tests/headless.spec.ts` asserts it
unconditionally), and replay hashes were rebaselined by construction (the suites
compare runs to each other, no hash literals).  simbench before → after is in
CLAUDE.md §8 and is within container noise.  D-S3-d and D-S3-e are
answered (2026-10-05, below); the balance harness is next.  Also in this PR, at
the user's request: a NEW GAME button on the main menu (two-tap confirm; hidden
when there is no progress) and the debug "Erase save" row moved into Save &
Records, where it is found.  Two facts worth carrying forward: a table
NAME that does not resolve (a sprite key, a weapon `extends`, a subtype) fails at
module load, so `test:sim` and the boot smoke catch it and `vite build` does not;
and the golden is a one-time migration check that a deliberate rebalance
re-captures in the same commit.

**Near-term payoff.**  Tuning without a rebuild, and a console port that
inherits every balanced number instead of retyping it.  With `S2`'s
headless harness, balance claims become measurements rather than feelings —
the same move `perf/` already makes for frame time.

**Engine payload.**  Move tuning *tables* out of `constants.ts` into data
files; derivation *logic* (`massFor`, `enemyHpMult`, the DBG ladders) stays
code.  Teach the headless harness to answer balance questions over many
runs.

**ALSO YOURS: `dmath`, THE DETERMINISTIC MATH LAYER** (PM call D30,
2026-10-04, placing S2's D17 hand-up here as S2 recommended).  JS engines'
libm differs in the last place — measured, `Math.pow` disagrees between Node
22 and Chromium 141 on ~10% of non-trivial inputs, and `atan2` / `hypot` /
`exp` / `log` / `sqrt` agree today only because both are V8 sharing fdlibm.
iOS is JavaScriptCore, a THIRD libm.  So replay is bit-exact within one
engine and not across them, which leaves §1/D0b's "a port is a verified
translation checked by replaying inputs against state hashes" — the stated
reason this phase exists — unbacked until this lands.  Build `dmath` (own
`sin` / `cos` / `pow`, then `exp` / `log` / `atan2` against JSC) and route
the ~150 sim call sites through it.
Four things the PM session wants stated rather than discovered:
- **It is a BEHAVIOUR change, so it belongs in the GAMEPLAY-tier PR**, not
  the invisible one.  It moves every number in the last place.
- **It invalidates every existing hash ONCE.**  Say so in the PR
  description, and re-baseline `tests/replay.spec.ts` in the same commit
  rather than leaving a red suite between two.
- **There is a measurable per-call cost on hot paths** — `pow` sits in the
  collision resolver — so take a `perf/` number before and after and put it
  in the PR.  A sim that is correct and slower is a trade the user gets to
  see.
- **It does NOT block the mobile release**, which is why it could wait for
  this session: replay is dev-only (D7) and the save is not replay-based
  (D21), so what JSC costs today is reproducing an iPhone bug report on a
  dev machine.  What it DOES block is cross-device replay and the
  port-verification premise.
D17 also restated `S2`'s own parity acceptance test to what is true — Node
and CI Chromium agree on streams and the player but NOT on world state — so
tightening that assertion back up is a consequence of this work landing,
not a separate task.

**SCOPE WARNING.**  This is the item most likely to sprawl.  `constants.ts`
is **11,359 lines** (MEASURED, PM 2026-10-04 — this brief said "~1000",
which understated the warning by an order of magnitude) of deliberately
mixed data and logic, and much of what looks like data is load-bearing
derivation: it exports ~307 functions, and `WEAPONS` is **30 lines**
because it is COMPUTED from `DELIVERY_BASE` + `COMBOS` — the trap, concretely.
Pick **two or three tables**, land them, stop.  This session is expected to
recur rather than complete.

**OPEN DECISIONS — for the user, inside S3.**

- ~~**D-S3-a — Which tables go first?**~~  **SETTLED (D32):**
  `MAP_POPULATION` (126 lines) + `ENEMY_VARIANTS` (317) + `BOSS_DEFS` (117).
  Held for a later pass, with reasons: `SHARD_VARIANTS` (961 lines, the
  `grainSpecFor` seam and the per-material DBG overrides), `WEAPONS`
  (computed, not data), `MODULE_DEFS` (`BASE_BANK_DIVISOR` pins to it).
- ~~**D-S3-b — Knob triage.**~~  **SETTLED, SCOPED (D32); BOTH CALLS MADE
  (user, in S3 PR 1).**  There are **59** `*_CYCLE` tables, not ~90 (measured, PM
  2026-10-04).  Triage is scoped to the knobs belonging to the tables being
  extracted, so each call lands in the PR for the table it concerns and no session
  faces all 59.  The three tables own two:
  - **`ENEMY_SCALE_CYCLE` ("Enemy scale") → its steps MOVE INTO `enemies.toml`**
    (`enemy_scale_cycle`).  The user chose this over keeping it as code or
    removing it.  The cycle STAYS a cycle: it multiplies `ENEMY_SCALING`, which is
    not an extracted table and stays in `constants.ts`; the resolver requires
    index 0 = 1, so the first click is still the A/B.  Done; DBG row unchanged.
  - **`SWARM_MOVE_MODES` ("Gnat move") stays a cycle, and gains a SEAM.**  The
    user's answer was a question: does it make sense to add enemy types that wear
    the alternate move modes, since the modes were never retired and the variety
    is good?  Yes — it makes sense, and the seam is cheap: `swarmMove?` on an
    `ENEMY_VARIANTS` row pins that archetype to one steer (absent follows the
    cycle).  PR 1 lands ONLY the seam, which no row sets, so the invariant holds
    (`tests/sim/tables.test.ts` pins both halves).  The NEW ENEMY TYPES are
    gameplay content, not an extraction, so they are NOT in PR 1 and are not
    `dmath`'s either: each needs an `EnemySubtype`, `ENEMY_ROLE`/`ENEMY_BEHAVIOR`
    rows, a `shape` (+ `drawEnemyIcon` for the roster dialogue), a sprite, a place
    in `WAVE_DEFINITIONS`, and a balance pass.  FLAGGED in §8 for the PM to place.
- ~~**D-S3-c — Data format.**~~  **SETTLED (D32): TOML**, parsed at BUILD
  time through a Vite virtual-manifest plugin (the `nebulaManifestPlugin` /
  `sfxManifestPlugin` precedent), so the parser is a devDependency and ships
  zero runtime bytes.  See D32 for the three consumers that must all resolve
  it.  **And see D33 before you read W1's `score/index.json` as a conflict:**
  the format follows who WRITES the file — a generator's output is JSON, a
  hand-authored table is TOML — so the two formats are deliberate and
  neither is to be unified into the other.
- ~~**D-S3-d — Does the player get more than the 4-level difficulty index?**~~
  **SETTLED (user, 2026-10-05).**  Yes — and the model changes shape:
  1. **Up to 20 levels, and the new levels EXTEND the range upward.**  Levels
     1–4 stay what today's four are; 5–20 are harder than today, not a
     re-spread of the current range.
  2. **Difficulty belongs to the PORTAL, not the menu.**  Each portal carries
     its own level, shown when the player arrives.  The start-of-game picker
     goes away (it is a saved setting today, `settings.difficulty`, so the
     save needs a migration — S2's file format).
  3. **Separate dials for alternate arenas** where the enemies are present but
     NOT the objective (mazes, timed courses).  So difficulty is a vector of
     dials per arena (enemy count, toughness, income, …), not one scalar.
  4. **RIVALS enter the difficulty calculation.**  They are currently very
     prominent at every level (score-cadenced, `RIVAL_CONSTANTS.SCORE_INTERVAL`
     1000, capped by `MAX_RIVALS`).  The harness must measure how much of a
     run's pressure and loot-theft they account for before they are re-tuned.
  5. **FUTURE (not this phase):** difficulty that scales with the player's
     weapon loadout, harder for stronger loadouts.  Design the dial vector so
     this is one more input, not a rewrite.
  6. **Intended weapon bands:** basic weapons start to struggle above level
     2–3; Mk III above level 10; the 10–20 range is meant for rare Mk IV+
     modules (extremely rare in shops, rare as boss / maze rewards).
- ~~**D-S3-e — Balance targets, stated as numbers.**~~  **SETTLED in part
  (user, 2026-10-05).**  Method: **measure what the game does today and
  report it first**; targets are then judged against the report.  Stated
  targets so far (mobile is the design target):
  - **Run length:** finding a local portal and completing a run takes about
    **1.5–7.5 minutes**.
  - **Wave time escalates** with the wave, because time tracks enemy count.
    Timed arenas (the future mazes) use the same measure.
  - **Basic weapons kill tier-1 enemies in one shot** today; keep that at the
    low levels.
  - **Arenas vary per wave** in difficulty and enemy variety.
  - **Income is NOT settled** (the user finds it hard).  Constraints given:
    modules are lost for good on a double death, so they must not be out of
    reach, and they are powerful, so not cheap; **Mk I–III are never gated
    behind unlocks**; instead each STATION stocks a different variety, and a
    higher mark or a rarer kind (Shield, Overcharge) is harder to find and
    dearer.  That is a per-station catalogue, not an unlock tree.

**D-S3-f (user, settled): module pricing is a factorial, and rare finds are arena
rewards only.**  A mark costs its number times the mark below (Mk II = 2x, Mk III
= 6x, Mk IV = 24x, Mk V = 120x Mk I); each family keeps its current Mk I price.
The shop stops at Mk III; Mk IV and up are `rewardOnly` (boss drops now, maze
completion and other arena rewards later).  Landed in `constants.ts`
(`markCost`, `SHOP_MAX_MARK`, `ModuleDef.rewardOnly`), pinned by
`tests/sim/pricing.test.ts`.  Consequences to carry into the level design: a Mk
III is now 24-60 units against ~85 per level-3 run (about half a run); the
Scanner Mk IV / V cost 168 / 840 units, and because a sell-back is 90% of cost a
rare drop is also a large payout (Mk V sells for 756 units) — whether sell-back
of reward-only finds should be capped is OPEN.

**D-S3-g (user, settled): the shape of difficulty, and what stays put.**
(1) **Sell-back stays at 90% for every mark**, reward-only finds included.
(2) **A boss drops a reward-only mark far more rarely than a uniform draw
would** (it was 1 in 18, "5% is too high"): `BOSS_REWARD_WEIGHT` makes it about
1 boss in 200 (`bossRewardTable` / `pickBossReward`).  (3) **The starter gun
stays relatively hard against the boss, and beatable.**  The bot clears the
boss 1 time in 12 at level 1 and never at level 3; the user has beaten level 3
with the starter gun, so that gap is the bot, not the game — no retune.
(4) **Difficulty adjusts enemy HEALTH and DAMAGE more than it adjusts how many
spawn** (today the levels move spawn count 3x and HP/damage 1.4x), **and it
changes the VARIETY of enemies**: the Bulwark is a hard archetype and is placed
as one, so it belongs to higher levels rather than appearing at every level.
(5) **Stronger enemy AI is a later difficulty axis** and is parked
(PARKING_LOT: "Enemy AI as a difficulty axis"), not designed here.

**D-S3-h (user, settled as a starting point; confirmed by playtest only): enemy
mix is driven by per-enemy ratings and the arena level.**  (1) Provisional,
awaiting playtest.  (2) A level-3 wave no longer carries Bulwarks in numbers:
the wave-5 spike (~49 points against 8-12 elsewhere) is gone; the Tank
(RAMMER_3) stands where the Bulwark was.  (3) Every enemy has a `rating`
(`data/enemy-difficulty.toml`); a wave is a POINT budget; the level sets a
roster CEILING (the hardest rating allowed) and the mix is picked at random
(seeded, `sim.waves`) with evenly split points, 2-4 types a wave, never the
previous wave's mix.  So kamikaze, turret, nest, swarm and the rest vary by
arena and wave.  Difficulty is the PORTAL's (`MapDescriptor.level`: Pocket 2,
Universe 3, Ring 4, Seven Rings 6, field maps 3); the menu picker is gone.
Levels 1-3 are the old Low/Med/High rows; above that HP and damage grow 1.14x a
level and spawn 1.03x (capped 1.5x).  Playtest handle: DBG > World & Maps >
Portals > "Arena level".  Baseline report predates this generator: re-run it.

**D-S3-i (user, settled): the hub layout and arena varieties.**  Each arena map
has three portals (easy / mid / hard: Pocket L1/2/4, Deep Space 2/3/5, Ring
World 3/4/6, Seven Rings 5/6/8 — a starting point for the playtest); the eight
material-field showcase rifts (Indestructible and Tile Heavy included) form a
gravity-free debug ring just outside the home station; arenas and the three
shops are spread at even angles over three rings round the home station, the
easy variety innermost.  The mid variety keeps the original descriptor id.

**PROPOSED (not settled) — the level curve, for the user to confirm.**
Calibration (baseline report §8, mk3 on POCKET + RING, n = 6 a cell): enemy HP
and damage x1.0 -> the fully outfitted bot beats the boss 4 times in 6; x1.5 ->
1 in 6; x2 -> 0; x3 -> 1 (noisy).  The bot is harsher than a person, so
"Mk III struggles" is placed higher than the bot's x1.5.  Shape: levels 1-3 are
today's 1-3 unchanged (spawn 0.35 / 0.65 / 1.0, HP and damage 0.7 / 0.85 / 1.0);
from level 4 the spawn budget grows only gently (about x1.03 a level, capped
x1.5) while HP and damage grow x1.14 a level — x2.5 at level 10, x9 at level
20.  Roster: the Bulwark moves from "every stage's wave 5" to "level 3 and up"
(levels 1-2 put a Shooter 2 there), one Bulwark at level 3 as today, two from
level 6, three from level 10; Kamikaze, Turret and Nest follow the same idea
(introduced by level, then more of them).  Portal difficulty is shown on arrival.

**BUILT in S3: the balance harness and today's baseline.**  Instruments:
`tests/sim/balance.ts` (`playArena`, `duel`, `hubTransit`, `staticTables`),
`tests/sim/balance-cli.ts`, pinned by `tests/sim/balance.test.ts`; driver
`scripts/balance.mjs` (`--seeds N --jobs N`, `--ladder` adds the lean start at difficulty 1-2, `--report` re-renders from the
JSON).  Output: `docs/BALANCE_BASELINE.md` (the table the user judges) and
`docs/balance-baseline.json` (raw).  Not part of `npm test`/CI (about an hour
at 3 seeds).  The bot is a YARDSTICK, not a player (perfect aim, fixed kite,
no dodging, no charged shots); beams are pulled not held; hit attribution
counts projectile hits only; rival loot theft is inferred from salvage per
wave.  **NEXT in S3:** the user judges the baseline against the targets
above; the portal-difficulty model, the level count and the per-station
catalogues are DESIGNED from that, not before it.

**Invariant for the invisible PR.**  **Not one tuned number changes.**
Extraction is a move, not an edit.  Rebalancing happens in the gameplay PR
with the numbers visible in the diff.

**Acceptance, as tests to write.**  *(PR 1: `tests/sim/tables.test.ts` — done.)*
- for each extracted table, the loaded data is byte-equivalent in effect to
  the previous constants (assert the derived values, not the literals)
- the existing suites that pin populations and balance (`maps.spec.ts`,
  `modules.spec.ts`, `weapons.spec.ts`) stay green **unchanged**

**Must not touch.**  Anything outside the chosen tables.

---

### S4 — "The app"  (Capacitor shell + TestFlight CI + mobile feel)

**Near-term payoff.**  It is the release.

**Engine payload.**  Capacitor shell over the existing web build; Fastlane
→ App Store Connect → TestFlight from GitHub Actions macOS runners, so no
Mac is ever required.  Android APK from CI for sideloaded testing.

Note the engine risk here is **zero**: Capacitor on iOS uses WKWebView,
which is what Safari on the review phone already is, so every existing perf
measurement was taken on the shipping engine.  Android's WebView is
Chromium.

**OPEN DECISIONS — for the user, inside S4.**

- **D-S4-a — Default control scheme on a native app.**  Five exist;
  `touch` is the current default.
- **D-S4-b — Haptics mapping.**  Rides the existing
  `handleScreenShake` funnel, which already has magnitudes tuned against
  each other.  Which events buzz, and how hard.
- **D-S4-c — Safe areas and orientation.**  Portrait lock, or support
  landscape?  How the HUD insets handle the notch and home indicator.
  Consequence: landscape is close to the Steam desktop-layout problem in
  miniature; portrait-lock defers it.
- **D-S4-d — Silent-switch behaviour.**  The web build claims the
  `playback` audio session so the ring switch does not mute it.  A native
  app makes this an explicit choice, and players have strong opinions.
- **D-S4-e — The first sixty seconds of a cold launch.**  Straight to the
  hub / a tutorial / a guided first wave.
- **D-S4-f — Store-facing basics** that need a human: app name (note
  "Omni" is crowded — check the App Store and USPTO), icon, screenshots,
  age rating, and the privacy disclosure (currently trivial: no data is
  collected).
- **D-S4-g — AI-asset disclosure.**  `docs/COWORK_SPRITE_GENERATOR_PROMPT.md`
  describes generating sprites with image models.  Confirm the provenance
  of `public/assets/ships/base/` and the enemy PNGs; both Apple and Steam
  ask, and an undisclosed answer is a rejection risk.

**Acceptance.**  A TestFlight build installs on the user's own phone and
plays identically to the preview link.

**Must not touch.**  The sim.  Gameplay balance.

---

### S5 — Steam  (deferred)

Electron shell with an `app://` protocol handler (every asset URL is
absolute today — `/assets/...` — so `file://` would 404 the entire asset
set), `steamworks.js`, a Playwright-Electron smoke suite, and the real cost
of this session: a **desktop HUD, resolution and keyboard pass**, since the
HUD is built for 390×844 with 40px tap floors.

Not scheduled.  Opened only once mobile has shipped, and re-planned then —
nothing in `S1`–`S4` should be shaped around it.

---

### S6 — "The world"  (connected arena graph + arena families + world persistence)

Added by user call **D13** (2026-10-03), which gave D9's hand-up a home: it
runs **after `S4`**, i.e. after the mobile release.  The numbering skips 5
because `S5` was already logged as Steam — see §6.

**Why it is last, and what that costs.**  Running it last means the mobile
release ships on today's arena model.  That is coherent, because D8 already
made arenas regenerate per entry, so "arenas do not persist" is the design
rather than a defect to fix before a store release.  The cost accepted is
that `S6` lands a connected map graph AFTER players have save files, so
D-S2-e's save-version policy is what absorbs it.

**The ask, in the user's own framing (D9).**  Today's maps are mostly test
terrain.  Arenas should be REDESIGNED and purpose-built, and connected as a
TREE with interconnectivity, so the player TRAVELS through arenas to get
home instead of a portal depositing them at their station — the universe
gains physical extent (cf. No Man's Sky).  Arena families the user named:
- **LABYRINTH** — maze maps of indestructible tiles leading to rare items
  or salvage.
- **DENSE** — maps fully enclosed in tile structure that the player DIGS
  through.
- **WAVE ARENAS** — a graded difficulty range using the whole enemy
  catalog in its deeper varieties.

**Engine payload.**  Graph edges on the `MAP_DESCRIPTORS` registry, which
carries none today.  Per-node world persistence (which nodes keep destroyed
tiles and `found` flags) — deferred here from `S2` by D14, so this session
owns it.  Arena layouts as DATA, which `S3` will have made the pattern for.
The descent machinery (`openDescentPortal`, `GameEntity.isDescent`,
`transitionToMap(id, {descend:true})`, depth / `waveOffset` / the stage
stride) is still present, uncalled and tested — D5 and D9 left it switched
off for exactly this session, so this is where it is either wired or
deleted.

**OPEN DECISIONS — for the user, inside `S6`.**  Not to be pre-answered
here; stated so the session knows what to ask.
- What is the graph's SHAPE: a tree, a tree with shortcuts, or a general
  graph?  The user said "tree with interconnectivity", which is a graph —
  the question is whether edges are one-way, and whether the route home is
  ever the route you came.
- Is the graph FIXED or GENERATED per character?  This interacts with D8
  (arenas are seeded per entry) and with D14 (the hub is persistent).
- Does travel cost anything — time, fuel, risk — or is it purely spatial?
  D10 made a death's cost the trip home, so this prices deaths too.
- Which nodes PERSIST their terrain and which regenerate?  The inherited
  constraint from D8/D14 is that the hub persists and arenas do not; a
  connected world has to decide where each new node sits on that line.
- Do the three named families need different generators, or one generator
  with different parameters?

**Must not touch.**  The sim's determinism contract from `S1`.  The ports
from `S2`.

---

## 4a. Workstreams (not sessions)

Work that landed in this phase without being one of `S1`–`S4`.  Recorded
rather than briefed: each entry says what it established, because a later
session inherits that whether it knows it or not.

### W1 — The music pipeline  (landed 2026-10-04, `6b98a25`)

Songs became DATA and gained an import tool.  Ported onto the integration
branch deliberately keeping S2's ports, the 25 kHz decode and the lazy SFX
banks (D31), so it composes with them rather than reverting any.

**What it established, in the order a later session will meet it:**
- **Songs are a folder plus an index.**  `public/assets/audio/score/<id>/`
  holds the six synchronised stems (plus optional `riser` / `victory`), and
  `public/assets/audio/score/index.json` lists the songs AND the music plan
  (which song plays in the hub, a field map, an arena, a boss fight).
  `AdaptiveMusic` loads the index; `scripts/inline-build.mjs` inlines it, so
  the single-file standalone still plays the score.  **The plan is WRITTEN BY
  THE IMPORTER, not hand-kept** — `for (const role of use) index.plan[role] =
  meta.id`, from each song's own `use` array — so the editorial choice is made
  in the KIT and the index is its output.  It only ever ADDS or overwrites the
  roles a song claims and never clears one, so a role nobody claims keeps
  whatever is there.  See D34: this retires half of D33's rationale.
- **`npm run music:import -- <kit>`** takes a GarageBand export, checks
  length against tempo, folds the tail into the loop, applies ONE loudness
  gain across all layers, encodes, and adds or replaces that song in the
  index (`--check` validates only).  `scripts/score/kit.py` builds the
  GarageBand kits.  `docs/MUSIC_PIPELINE.md` is the how-to.
- **One devDependency** (`ffmpeg-static`), so no manual install.  Runtime
  dependencies are still exactly two (`react`, `react-dom`) — the pipeline
  ships no bytes to the player.
- **`AudioPort` grew `music.songList`**, read by the debug panel's "Play
  song" row so an imported song appears without a code change.  That is an
  extension of S2's port surface, consistent with it.
- **It set the GENERATED-DATA format precedent** that D33 then stated as a
  rule for the whole project.  See D33 before extracting any table.
- **THE PIPELINE HAS NOW CARRIED A REAL SONG** (`6558b71`, 2026-10-06):
  "Critical Mass", the BOSS song, re-imported from an actual GarageBand export
  — the first content through `music:import` rather than `scripts/score/`.  So
  the tool is proven end to end, and the three things it leaves behind are
  worth knowing.  (1) The song is now PART authored, PART generated: the six
  loop stems are the export, while `riser.mp3` and `victory.mp3` are the older
  generated one-shots, because "a riser / victory not in this export keeps the
  song's existing one" is the importer's deliberate rule.  (2) `song.json` is
  copied beside the stems as the song's own record, and TWO of its fields are
  INERT — `key` and `phraseBars` are read by nothing, in the engine or in the
  importer.  Latent, like W2's variants: do not assume they are wired.  (3) The
  boss stem grew 532 KB → 852 KB, which is MONO → STEREO (the importer encodes
  80k mono / 128k stereo per layer) and not a length change — all six stems
  measure 53.283 s, so the score is still synchronised.  Gates on it:
  typecheck 0 and `test:sim` 47/47 LOCALLY, CI smoke green — **and the full
  scope CANCELLED, by the very next push.**  An earlier revision of this entry
  claimed "CI green both scopes" and that was wrong: the push-event
  concurrency group is the REF, so my docs commit on top of this one killed the
  full run that was validating it.  See §7's CI note — full green attaches to
  the HEAD of a push burst, never to each commit in it.

**Consequence for `S3`.**  `index.json` is a second data format alongside
`S3`'s TOML tables, and D33 says why that is deliberate rather than drift.
Do not "unify" them.

### W2 — Layer variants  (landed 2026-10-05, `67e8d7c`; BACKED OUT
`ae222f4`, same day, for a dedicated branch)

**THIS DID NOT STAY.**  The whole variants layer was reverted hours after
it landed — 1,390 deletions, `MusicContext.ts` deleted, every
`AUDIO_CONSTANTS.MUSIC_*` it added gone, and `engine/ports.ts` +
`platform/headless.ts` byte-identical to their pre-W2 state (verified).
W1 is UNTOUCHED by the revert: songs-as-data, `music:import` and the index
all survive, so the two are cleanly separable and only the variants layer
went.  The entry is kept rather than deleted because what it ESTABLISHED is
what a dedicated branch will meet again — and because the one durable
lesson is the port rule below, which held this time and is the reason the
revert was clean.  Read the rest as a description of that branch's starting
point, not of this one's contents.

The score gained ALTERNATIVE STEMS per slot.  The intensity model still
decides which slots are ON; a DIRECTOR now decides which variant fills a
slot that is on — atmos from CONTEXT TAGS (station / portal / rare-item /
danger / deep-space, `engine/systems/MusicContext.ts`), a combat slot from
the dominant ENEMY FAMILY, locked on entry.  Changes commit on phrase
boundaries with a centred crossfade; variant buffers live in an LRU cache
under a decode budget; a missing file falls back to the default silently.

**What it established, in the order a later session will meet it:**
- **`AudioPort` grew again** — `setMusicContext`, `cycleMusicContextForce`,
  and five `music` readout fields.  `platform/headless.ts` was updated in
  the SAME commit, which is the thing that broke twice while PR 110 was
  being integrated: a port method added without its `NullAudio` stub is a
  typecheck break for whoever merges next, not for whoever wrote it.
- **A NEW ENGINE FILE IS SIM-GUARDED BY DEFAULT, and this one passes.**
  `MusicContext.ts` reads arrays the engine already owns and names no
  platform global, so it needed NO `guard.test.ts` allow-list entry.
  Verified: `test:sim` 47/47 on the merge.  Anything later that gives it a
  clock or a `performance.now` has to earn an allow-list line instead.
- **`constants.ts` grew ~48 lines of `AUDIO_CONSTANTS.MUSIC_*`.**  That is
  `S3`'s file, so see the §8 hand-up below before rebasing.
- **THE FEATURE IS LATENT TODAY.**  No shipped song declares `variants`
  (all three carry the eight default stems and nothing else), and a song
  without them takes none of these paths — so the director, the cache and
  the budget are all live code over content that does not exist yet.  That
  is the right order to build it in, and it is also why none of it is
  visible in a play-test.

---

## 5. Branch and CI conventions

**One integration branch off `main`** holds all of `S1`–`S4`, **and the
named WORKSTREAMS in §4a**:
**`claude/steam-game-publishing-xhnui2`** (user call, 2026-10-03, replacing
`claude/engine-core`).  Work sessions branch from it and PR back into it; it
merges to `main` when the PM session judges a phase coherent.

This used to read "holds all of `S1`–`S4`" and nothing else, which stopped
being true the moment work arrived that is not one of the four sessions (the
music pipeline, W1).  The branch is the PHASE's branch, not the sessions'
— so anything landing in this phase belongs to a session in §4 or a
workstream in §4a, and PR #108 is as wide as both.  A workstream is work
with no open gameplay decisions of its own: it needs a RECORD so a later
session can see what it established, not a brief.

The two branches were the SAME COMMIT when this was decided (`af3c8ba`), so
the switch moved no code — `claude/engine-core` is simply abandoned at that
commit rather than deleted, and PR #109 was re-based onto the new name.  A
work session branches from the integration branch, never from `main`:

```
git fetch origin claude/steam-game-publishing-xhnui2
git checkout -B <my-work-branch> origin/claude/steam-game-publishing-xhnui2
```

Two things about the NAME, so nobody reads meaning into it.  It is the
planning session's own branch, named for the Steam question that opened that
conversation before D0 settled on mobile — so it describes this phase
BADLY, and that was accepted deliberately as the price of keeping one branch
instead of two.  And it means the plan doc has lived on this branch from the
start, which is why `main` does not carry it yet (PR #108): a work session
must take the plan from the integration branch, not from the default one.

~~**This plan doc must reach `main` early**, because fresh work sessions
clone the default branch and would otherwise not see it.~~  **OVERTAKEN by
user call D15** (2026-10-03): the phase PR (#108) ACCUMULATES `S1`–`S4` and
promotes once, so the plan will NOT reach `main` early and this requirement
is withdrawn rather than left standing as an unmet one.

What replaces it is **brief hygiene, and it is the PM session's
responsibility, not a work session's**.  The hazard is real and has already
fired once: the `S1` brief said `git checkout -B <branch> origin/main`, and
because the plan lived only on this branch that command would have DELETED
`docs/ENGINE_CORE_PLAN.md` from the working tree of a session whose first
instruction was to read it.  It was caught before the session ran it.  So
every brief the PM session writes MUST carry the two commands above
verbatim, naming the integration branch, and must never name `main` as a
branch point.  That is entirely within the PM session's control, which is
why accumulating is safe — the mitigation does not depend on a work session
noticing anything.

**CI maps onto the existing two-scope design** (CLAUDE.md §7) with no new
machinery, and it is already WIRED: `claude/steam-game-publishing-xhnui2`
is in `pr-checks.yml`'s `push.branches`, which is the whole mechanism — the scope
step sends every non-`pull_request` event to `test:full`, so a merge into
the integration branch runs the whole net while PRs INTO it get the cheap
per-push smoke.  Nothing further to configure.

Note the push list is now the ONLY way a run reaches full scope besides the
`full-tests` label: a PR's BASE stopped picking the scope (user call,
2026-09-29), so a PR against `main` runs smoke like any other.  Do not
expect a plain PR into this branch, or out of it, to run the whole suite.

**A work session's own gate** is therefore CLAUDE.md §7's rule verbatim:
typecheck + build + `npm test` (smoke) + the suites the change touches, per
push.  The FULL suite waits for the user's notice that a PR is ready to
merge — a work session does not decide that moment has arrived.

**Private-repo note.**  The repo is going private (user call).  Three
consequences, none blocking: keep `i-r0n/omni-standalone` **public** so
githack previews and PR-comment screenshots keep working; Actions minutes
become quota'd with an OS multiplier (Linux ×1, Windows ×2, macOS ×10), so
macOS jobs belong behind a label or dispatch rather than on every push; and
set short `retention-days` on any build artifact.  Note a public standalone
repo means the playable build is public — revisit before a paid release.

**Each session's two PRs** carry their invariant in the description.  The
invisible PR is reviewed on its tests; the gameplay PR is reviewed by
playing the preview link on a phone.

---

## 6. Session ordering

Current order: **S1 → S2 → S3 → S4 → S6**, S5 (Steam) still deferred
(user call D13, 2026-10-03).  `S6` is the world-design session and sits at
the END, after the mobile release.  The numbering SKIPS 5 on purpose: `S5`
was already logged as Steam and renumbering a decided plan is churn, so the
gap is deliberate rather than a mistake.

Rationale, so a later session can argue with it: `S1` first because it is
the only item that decays (new `Math.random()` sites accrue) and because
its harness makes later refactors verifiable; `S2` second because
D-S2-c's cheap implementation depends on `S1`; `S3` and `S4` may swap
freely.  Flipping `S1` and `S2` is defensible if persistence is wanted
sooner — `S2` is the larger product win and does not decay.

`S6` last (D13) means the mobile release ships on today's arena model, and
that is COHERENT rather than a compromise: D8 already made arenas
regenerate per entry, so "no arena persistence" is the designed behaviour
and not a gap a store release has to close.  What makes it work is D14 —
`S2` persists the CHARACTER and defers world state — so nothing in `S2`
is built against a map model `S6` will replace.  The cost accepted is that
`S6`'s connected map graph arrives after players already have save files,
so D-S2-e's save-version policy is load-bearing: see `S2`.

---

## 7. Decision Log

Append-only.  Sequential IDs, never reused.  A reversal supersedes rather
than deletes.  Every entry: the question, the options weighed, the call,
who made it, and the consequences for other sessions.

| ID | Session | Date | Decision | Consequences |
|---|---|---|---|---|
| D0 | PM | 2026-10-02 | **Mobile first, Steam deferred, console accepted as possibly a different game** (user call).  Weighed against a Steam-first release; rejected because the game is already shaped for a 390×844 phone and Steam's real cost is a desktop HUD and input pass, while mobile's cost is store paperwork. | Sets the whole plan's order.  `S5` is not scheduled and nothing in `S1`–`S4` is shaped around it. |
| D0b | PM | 2026-10-02 | **The portable-core goal is a deterministic, platform-free sim with content as data — not a reusable engine, and not shared code with a console port** (user call, sharpened in planning).  A port is a verified translation checked by replaying inputs against state hashes. | Makes `S1`'s determinism work the keystone.  Imposes the discipline rule in §1. |
| D0c | PM | 2026-10-02 | **Sessions are organised around gameplay decisions, not around refactors** (user call).  Each session pairs invisible plumbing with the gameplay feature it unlocks, and ships two PRs. | Collapses an earlier seven-package plan into four sessions. |
| D1 | S1 | 2026-10-02 | **D-S1-c — the sim/cosmetic split of the random streams** (user call).  Options weighed: AI jitter as SIM / as COSMETIC / split by effect.  **Call: AI jitter is SIM; the rest of the proposed split confirmed as written.**  SIM = terrain / map gen, wave composition + spawn placement, drop rolls + scatter, fracture velocities and seeds, nebula condense rolls, chip dust, boss / rival / dragon / snitch / bubble rolls, projectile spread and curl, the energy layer's lanes, and enemy jitter / flock / timers.  COSMETIC = particles, sprite / palette / shade picks, nebula twinkle, camera shake, damage-text jitter, audio variation, the star field and background nebula, render-time wobble.  Rationale for jitter: it moves bodies, so a replay that did not reproduce it would be silently false. | Streams are one per SUBSYSTEM (`engine/systems/rng.ts`), so a draw added to one cannot shift another.  Anything that mixes both kinds in one function was split site by site (e.g. a death's particle COUNT is cosmetic, the debris it throws is sim).  Entity ids are sim state (they seed fracture patterns), so cosmetic prefixes count on their own id sequence.  AI draw order must stay stable per entity — a later session that reorders enemy iteration reshuffles every replay. |
| D2 | S1 | 2026-10-02 | **D-S1-a — seed visibility** (user call).  Options: hidden / shown on the run summary / enterable at run start / daily seed.  **Call: shown on the run summary** (see D8 for WHICH seed). | The seed becomes a small UI surface on the death/run summary.  Not enterable, so no input validation; no daily seed, so no `Clock` dependency for S2. |
| D3 | S1 | 2026-10-02 | **D-S1-b — what the seed covers** (user call).  Options: everything / terrain + waves / terrain only.  **Call: everything.** | Matches what PR 1 built: a seed plus an input log reproduces the whole arena, drops and AI included. |
| D4 | S1 | 2026-10-02 | **D-S1-d — does a run end** (user call, in the user's words: "this is becoming more of an rpg").  Options: death ends the run / descent chain ends at a boss / timed / endless with soft reset.  **Call: none of the four as written — death RESETS THE PLAYER TO THEIR SPACE STATION and ELIMINATES ALL OF THEIR EQUIPMENT, but KEEPS salvage / currency.**  Progression is the persistent character, not a run. | The central input to S2's save scope: what survives a death is credits only; modules (installed and cargo — to be confirmed in PR 2) do not.  Reverses the old respawn-in-place behaviour (CLAUDE.md §3 Death).  There is no "run terminator" in the roguelike sense, so the run-scoped counters on the summary need a re-think in PR 2. |
| D5 | S1 | 2026-10-02 | **D-S1-e — descent rift** (user call).  Options: switch on / not yet / switch on after a rework.  **Call: switch it on, but rework the flow first**; then, asked what the rework is, **deferred — PR 2 is the death reset only.** | `openDescentPortal` stays uncalled for now.  The rework itself is unspecified and is NOT in PR 2; a later session must put it to the user before wiring it. |
| D6 | S1 | 2026-10-02 | **D-S1-f — death cost** (user call).  Options: keep / tune / replace / remove.  **Call: the credit penalty is REMOVED; equipment loss (D4) is the whole cost.** | Deletes `DEATH_PENALTY_FRACTION` / `DEATH_PENALTY_MIN` charging, `lastDeathCreditsLost` / `runCreditsLost` and the summary's "lost to the wreck" line.  The economy pass loses its provisional penalty to retune. |
| D7 | S1 | 2026-10-02 | **D-S1-g — player-facing replay** (user call).  Options: dev-only / share a run / ghost.  **Call: dev-only.** | The replay format is NOT a compatibility surface; it may change freely.  `__omniReplay` stays a debug handle. |
| D8 | S1 | 2026-10-02 | **Seed scope clarified** (user call): *"the seeds should only be for the mini game arenas, not the overall universe. This shouldn't change based on 'run'."*  Options put: one seed per run / a new seed every life.  **Call (as the PM/S1 reads it — to be confirmed in PR 2): the Overworld hub and the wider universe are PERSISTENT and are not re-seeded per run or per life; only the ARENAS (the mini-game maps reached through portals) carry a seed, and that seed is what the summary shows.** | CHANGES PR 1's shape: `GameEngine.seedRun()` currently reseeds every stream (hub included) at each new run.  PR 2 must move seeding to arena ENTRY and give the hub a fixed or persisted world.  Replay then records (arena seed, inputs) per arena visit.  S2 must persist the hub's generation separately from any arena seed. |
| D9 | S1 | 2026-10-03 | **D-S1-e resolved — the descent rift is NOT S1's; it belongs to a WORLD-DESIGN effort** (user call).  Options put: dive chain to a random deeper arena / choice of deeper-or-home rift (judged the same as the first, since every arena already has a return rift) / leave it off.  **Call: none of them as framed.**  The user wants arenas REDESIGNED rather than random ones, and wants them as a TREE with interconnectivity: the player TRAVELS through arenas to get home rather than a portal dropping them at their station, so the universe has physical extent (cf. No Man's Sky).  Redesigning arenas is not S1's work but is definitely part of the overall plan.  Today's map types are mostly test terrain.  Planned arena families named by the user: LABYRINTH / maze maps of indestructible tiles leading to rare items or salvage; DENSE maps, fully enclosed in tile structure, that the player digs through; and a range of wave-battle arenas of graded difficulty using the whole enemy catalog in its deeper varieties. | `openDescentPortal` and the `descend` / depth / `waveOffset` machinery stay uncalled and untouched; S1 does NOT wire it.  The arena return rift and hub-portal travel (§3 of CLAUDE.md) are today's placeholder and will be superseded by a connected map graph.  No session in this plan owns the world-design work yet: the PM session must decide whether it is a fifth session or sits after S4 (§8).  Constraint it inherits from S1: arenas are seeded per entry (D8) and the hub is persistent, so a connected world must decide which nodes persist and which regenerate; and from D4, death returns to the home station, so a long physical route home raises what a death costs in time, not just equipment. |
| D10 | PM | 2026-10-03 | **The incentive inversion in D4+D6 is resolved by a RECOVERABLE WRECK** (user call).  The problem put to the user, with the numbers: D4 wipes equipment and D6 removed the credit penalty, so a credit in the bank became 100% safe while a credit spent on a module became 100% at risk — the exact reverse of CLAUDE.md §3's stated intent, *"the penalty taxes hoarding, not investment."*  Measured from `MODULE_DEFS`: a full outfit is ≈413,500 credits (ship flower ≈144,000, weapon flower ≈269,500) against combat income of ~8–10k a wave / ~50–60k a six-wave stage — so a FULL wipe would have cost seven to eight stages of play, where D6's deleted penalty cost ~1.5–2 waves and never touched money already spent.  **CORRECTION (PM, same day, after reading the merged code):** that full-wipe figure is NOT what a death costs in the shipped build, and the framing put to the user overstated it.  `GameEngine.returnToStation` calls `resetOutfit(true)`, so CARGO AND PURCHASED HEX SLOTS ALREADY SURVIVE — see D11.  The real exposure is only the value of what was MOUNTED and not also held in cargo.  The inversion is therefore real but SMALLER than measured: what it penalises is MOUNTING a module rather than owning one.  Options weighed: station locker (PM's recommendation — gear left at a station survives) / permanent-vs-consumable split (credits buy death-proof capability through the already-no-op `purchaseSlot` and `SHIP_WEIGHT.HULL_BASE` seams) / **recoverable wreck** / insurance.  **Call: the recoverable wreck** — death leaves the fitted loadout at the site and the player flies back for it. | SUPERSEDES the "ELIMINATES ALL OF THEIR EQUIPMENT" half of D4: equipment is SUSPENDED, not destroyed, and the cost of a death is the trip plus the risk of the trip rather than the gear.  Pairs with D9 — a connected world with physical extent is what makes the trip meaningful.  TWO sub-decisions S2 must put to the user before building the save file: (1) WHERE the wreck sits, which collides with D8 (an arena is seeded per ENTRY and does not persist) — PM's recommendation is to PIN that arena's seed until the wreck is recovered or lost, because S1's seeded generation makes the terrain reproduce exactly, so the wreck's position stays valid and the persisted record is only `{arena id, seed, position, modules, expiry}`; the cheap alternative is surfacing the wreck at the arena's RETURN RIFT, which persists arena identity only; (2) HOW a wreck is LOST — PM's recommendation is **on a second death before recovery, never a wall-clock timer**: this is a mobile game played in short sessions, so a decaying timer punishes putting the phone down.  `moveModule`'s drydock-only guard is now LOAD-BEARING and must stay: with cargo safe (D11) and the fitted loadout at risk, a player able to uninstall mid-arena would strip the ship whenever threatened. |
| D11 | PM | 2026-10-03 | **A death wipes INSTALLED modules only; CARGO survives** (user call).  Options weighed: installed + cargo (PM's recommendation under the locker option) / **installed only, cargo survives** / installed + cargo minus one designated keep.  **This RATIFIES WHAT S1 ALREADY BUILT rather than changing it** — D4's row left it open as *"(installed and cargo — to be confirmed in PR 2)"*, and PR 2 resolved it to cargo-survives without logging the resolution: `returnToStation` calls `resetOutfit(true)`, which keeps the inventory AND the purchased hex-slot counts.  So this row closes D4's open parenthesis; S2 must PERSIST this behaviour, not implement it. | This, not D10, is what actually closes the inversion: the 12 cargo tiles are a safe bench carried aboard, so converting credits into modules is no longer strictly worse than leaving them idle, and D10 then makes even the fitted loss temporary.  The bench is bounded by `INVENTORY_CAPACITY` 12 — and the two flowers hold 14 hexes of which 2 carry the free Base Hull and Projector, so there are exactly **12 purchasable mounted slots against 12 cargo tiles**.  That coincidence matters: a player who buys a DUPLICATE of everything mounted is fully hedged and loses nothing to a death, at double the outfit cost.  So the remaining perverse incentive is not "fly bare" but "buy two of everything", and that ratio is the balance lever for the economy pass — not a number to change here.  The wreck (D10) therefore holds only what was MOUNTED.  S2's save scope from D4/D6/D8/D10/D11: credits, cargo contents, the hub world, an outstanding wreck record, and nothing for an arena beyond its seed.  The run summary needs re-thinking again — D6 deleted its "lost to the wreck" credit line and D10 restores a wreck that holds modules, so the summary should name what the wreck holds and where it is. |
| D12 | PM | 2026-10-03 | **The integration branch is `claude/steam-game-publishing-xhnui2`, not `claude/engine-core`** (user call): *"I would prefer to work off of claude/steam-game-publishing-xhnui2 as the primary branch for this work. Then merge all of that into main."*  The two branches were the SAME commit (`af3c8ba`) when the switch was made, so this moved no code. | §5 rewritten; `claude/engine-core` abandoned at that commit and never pushed to again.  `.github/workflows/pr-checks.yml` lists the new name in `push.branches`, so a push to it runs the FULL suite — verified end to end on `6305ab7` (19m00s, green) alongside the PR-push smoke run (1m23s, green).  Four CLAUDE.md passages describing the full-CI branch list were corrected in the same commit.  PR #109 was retargeted in place rather than reopened. |
| D13 | PM | 2026-10-03 | **D9's world-design workstream becomes its own session, `S6`, placed AFTER `S4`** (user call).  Options weighed: own session next, after `S2` (PM's recommendation — keeps the ports and headless sim moving while the game design is open) / own session BEFORE `S2` (cleanest schema, delays the infrastructure) / fold into `S3` as its first content table / **after `S4`, at the end**. | §4 gains an `S6` brief carrying D9's three named arena families (labyrinth, dig-through, graded wave arenas), the `MAP_DESCRIPTORS` graph-edge work, and five open decisions for the user inside that session.  §6's order becomes `S1 → S2 → S3 → S4 → S6`, SKIPPING 5 because `S5` was already logged as Steam — the gap is deliberate, not an error.  CONSEQUENCE ACCEPTED: the mobile release ships on today's arena model, which is coherent only because D8 already made arenas regenerate per entry, so "arenas do not persist" is the design rather than a gap a store release must close; and `S6`'s map graph arrives AFTER players hold save files, which makes D-S2-e's save-version policy load-bearing.  The descent machinery D5/D9 left switched off is now explicitly `S6`'s to wire or delete. |
| D14 | PM | 2026-10-03 | **`S2` persists the CHARACTER and SETTINGS only; world state is deferred to `S6`** (user call).  Options weighed: **character + settings only** (PM's recommendation) / everything including per-arena world state, migrating later / settings only, deferring all game state. | IN: settings, credits, cargo contents, purchased hex-slot counts, the outstanding wreck record.  OUT: per-arena world state (which nodes keep destroyed tiles and `found` flags) — deferred into `S6` by D13, so nothing in `S2` is built against a map model `S6` replaces.  TWO refinements written into §4 because each is easy to get wrong: the HUB is the one world item `S2` cannot skip (D8 made it persistent while arenas are not), and the cheap path is a FIXED hub seed — identical regeneration for zero save bytes — rather than serializing a world, with "does destroyed hub terrain survive a relaunch" a real question for the user inside `S2`; and the WRECK record is CHARACTER state, not world state, which is what keeps D10 inside this scope, since pinning `{arena id, seed, position, modules, expiry}` lets S1's seeded generation reproduce that arena without serializing it. |
| D15 | PM | 2026-10-03 | **The phase PR (#108) ACCUMULATES `S1`–`S4` and promotes to `main` once** (user call).  Options weighed: merge once CI is green, then open a fresh phase PR (PM's recommendation — removes a standing footgun) / **accumulate the whole phase**. | WITHDRAWS §5's standing requirement that "this plan doc must reach `main` early", which is struck there rather than left as an unmet requirement.  The hazard it existed for is real and has already fired once — the `S1` brief's `git checkout -B <branch> origin/main` would have deleted the plan from the working tree of a session told to read it, caught before it ran — so the mitigation is now BRIEF HYGIENE and it is the PM session's responsibility: every brief carries the integration-branch checkout commands verbatim and never names `main` as a branch point.  That is wholly within the PM session's control, which is what makes accumulating safe.  #108 stays open and its githack preview keeps tracking the integration tip, which is also how the phase stays play-testable on a phone throughout. |
| D16 | S2 | 2026-10-03 | **Ports shape** (S2 engineering call, no gameplay content — recorded so it can be argued with).  Options weighed: thread a platform handle through every system / **module-level Clock and Viewport accessors + a `Platform` bundle the `GameEngine` constructor takes** / keep `window` in the sim behind `typeof` guards.  **Call: the bundle, with `nowMs()` and `viewport()` module-level** (the `rng.ts` shape).  Audio, Input and Renderer are plain interfaces the engine holds; `InputSystem`'s constructor no longer touches the DOM (`attach(window)` does), so the REAL class runs headless. | `engine/ports.ts`, `platform/browser.ts`, `platform/headless.ts`.  `GameEngine`'s signature is now `(platform, onStatsUpdate, difficulty)` — S3 / S4 must construct it that way.  The cost is that two engines in one process share a clock; `activatePlatform()` / `runReplay` re-install.  `tests/sim/guard.test.ts` enforces "no `window` / `document` / `navigator` / `performance` / storage / rAF / `Date.now` in the sim" as an ALLOW-LIST OF ADAPTERS, so new files are guarded by default.  Re-count from the brief: `GameEngine` 40 → 0, `PhysicsSystem` 10 → 0 (all diagnostics timers), `constants.ts` 8 → 0 (`devicePixelRatio`), `ProjectileSystem` 6 → 0, plus roamers / AI / shards / flow-field / debugControls / replay. |
| D17 | S2 | 2026-10-03 | **Cross-engine parity is limited by libm, and the acceptance test is restated to say what is true** (S2 call — **needs PM / user ratification**, because the plan's acceptance wording, "the headless Node sim reaches the same state hash as the browser", is NOT met literally).  MEASURED: Node 22 (V8 12.4) and Chromium 141 (V8 14.1) reproduce the random streams and the player EXACTLY at every checkpoint on all four parity maps, but the WORLD diverges, because `Math.sin`, `Math.cos` and `Math.pow` are not correctly rounded and differ in the last place (Chromium ships glibc-derived trig, Node fdlibm; `--js-flags=--no-use-libm-trig-functions` aligns sin / cos but `pow` differs on ~10% of non-trivial inputs and has no flag).  A one-ULP asteroid velocity is amplified by collisions: POCKET diverges by step 200, NEBULA_FIELD by step 600, the player never.  Options weighed: (a) **a deterministic math layer** — own `sin` / `cos` / `pow` (~120 + ~30 call sites in the sim), the only route to cross-engine bit-exactness; (b) compare quantised hashes — rejected, collision chaos makes the first divergent step unpredictable, so it flakes; (c) the Chromium flag — partial, and it tests a configuration nobody ships; (d) **state it and test what is true**.  **Call: (d) for this PR.**  The ports' faithfulness is proven EXACTLY, in one page: a headless-platform engine and the live engine replay every parity map to identical hashes.  Node-vs-Chromium asserts streams + player exactly, step-0 terrain to 1e-9, and full world equality exactly where a libm probe reports no disagreement. | (a) was NOT done in an invisible PR because it moves every number at the last place (plan invariant 2) and invalidates every hash once; it is flagged to the PM in §8 with the consequences.  Those consequences reach further than the harness: **iOS runs JavaScriptCore (a third libm), so a replay recorded on one device will not reproduce on another, and a replay recorded before an OS update may not reproduce after it.**  That makes **D-S2-c's replay option unsafe as a save format** (a saved run replayed after a WebKit / Chromium update would diverge), and S2 puts that to the user as part of D-S2-c.  A console port's "replay the inputs and compare hashes" test needs (a) first. |
| D18 | S2 | 2026-10-03 | **The replay format closes S1's four wall-clock reads** (S2 call; S1 handed them over in §8).  (1) PerfController's wall-clock load term is now an INPUT of the log (`ReplayInput.simMs`, latched; 0 when absent = the old behaviour), so skip tiers of a heavy real scene are reproducible once a recorder writes them — no recorder exists yet.  (2) A charged shot is recorded as the RELEASE it produced (`ReplayInput.charge`), not the wall-clock hold.  (3) A log carries its `viewport` and `runReplay` refuses a mismatch by name; MEASURED that the run really does depend on it.  (4) The run seed comes from the `Entropy` port.  Found on the way: `beginSeededRun` left the previous run's player heading in place, so the step-0 hash depended on what ran before it on the same engine; it now zeroes the heading (replay entry only). | Replay logs are still dev-only (D7), so the format change breaks nothing.  S1's determinism contract is NOT touched: no stream's draws or order moved. |
| D19 | S2 | 2026-10-03 | **Escape and app-lifecycle semantics** (S2 call).  Escape: close the debug panel; else undock / resume via `menuBack()`; else pause live play; nothing on the menu or on the death / stage-clear screens (decisions, not dismissals).  Backgrounding: release held keys, pause SILENTLY (no audio blip on a suspending context).  Foreground: never resumes by itself — the player taps resume — but always re-anchors the frame clock, including on the death screen, which keeps running. | The help panel's keyboard group now lists Esc.  S4 maps Capacitor's `appStateChange` onto the `Lifecycle` port; nothing in the sim changes. |
| D20 | S2 | 2026-10-03 | **What the save holds** (user calls D-S2-a / b / f, plus the hub question).  **File = CHARACTER + WRECK + RECORDS + SETTINGS.**  Character: credits, cargo, purchased hex-slot counts and — added by S2, because the brief's list left it out and a character that loses its fitted gear on a relaunch would make quitting the app a way to lose a loadout without a wreck — the **INSTALLED loadout**.  Records (call: records, not profile levels): high score, best wave, best combo, lifetime bosses and dragons, deaths.  Meta-progression (call): **records only**; the death-proof seams (`purchaseSlot` / `MODULE_SLOT_UNLOCK.START`, `SHIP_WEIGHT.HULL_BASE`) stay the deliberate no-ops they are, for the economy pass.  Settings (call: **audio volumes + mute, control scheme, difficulty**; NOT the scanner auto-scan or screen-shake toggles).  Hub (call): **a stable backdrop** — the fixed `HUB_WORLD_SEED` regenerates it identically every launch for zero bytes and destroyed hub terrain does NOT persist. | A new run no longer wipes the character: `resetAndLoadSelectedMap` (quit to menu, a DBG map switch) keeps credits, cargo, loadout and slots; `resetCharacter()` is a new character and is what the replay entry and DBG ▸ Economy ▸ **Erase save** use, so a replay never reads the save.  `engine/save.ts` is the pure file (parse / validate / migrate), the `Storage` port is the only I/O, and an autosave runs once a second of FRAME time (settings change while the world is frozen) plus at death, on backgrounding, on `stop()` and on recovery.  Difficulty is applied by the engine and `App` reads it back.  Nothing about any arena's world is saved — D14. |
| D21 | S2 | 2026-10-03 | **D-S2-c — can a run be suspended and resumed?  Pause only, no run save** (user call).  Options: **pause only** / snapshot sim state / replay seed + input log.  The replay option was put to the user with a new fact from PR 1 (D17): replay is bit-exact only within one JS engine, so a replayed run can diverge after a WebKit / Chromium update, which makes it unsafe as a save format. | Backgrounding pauses cleanly (D19, already built).  If the OS kills the app, the relaunch resumes the CHARACTER at the hub, not the arena the player was in.  No sim state, no rng state and no input log is ever written, so the save has no version-fragile payload and S1's streams need no persistence. |
| D22 | S2 | 2026-10-03 | **D-S2-d1 — where does the wreck sit?  PIN the arena's seed** (user call, PM's recommendation).  Options: pin the seed until recovered or lost / surface the wreck at the arena's return rift.  The record is `{arena id, seed, x, y, mounted modules}`; `loadMapSeeded` reads `wreckSeedFor`, so re-entering that arena regenerates the identical terrain and the wreck is exactly where the ship fell.  A death in the HUB leaves a wreck in the hub (no seed — the hub is fixed). | The pinned arena also repeats its WAVE script until the wreck is recovered or lost (a seed covers everything, D3) — an accepted side effect, and a reason a player may want the trip.  A replay's own pinned seed still wins.  S6's connected graph must keep arena identity stable enough for `arenaId` to find the node again; per-node persistence stays S6's (D14). |
| D23 | S2 | 2026-10-03 | **D-S2-d2 — how is a wreck lost?  On a second death** (user call, PM's recommendation).  Options: second death / wall-clock timer / never.  Read LITERALLY: any death before recovery replaces the record, so a bare second death (nothing mounted to leave) also destroys the old wreck, and a second death WITH gear leaves a new wreck in its place — never two.  A wreck is recovered by flying into it (`WRECK_CONSTANTS.RECOVER_RANGE`); each module returns to the slot it was mounted in if that slot is free and accepts it (two-gun cap respected), else to cargo, else pays its resale value — a recovery never destroys a module.  **The record is written and the ship stripped THE MOMENT THE SHIP FALLS**, not at the respawn tap, and saved at once, so quitting on the death screen cannot keep the lost loadout. | The wreck is a plain non-drop INTERACTABLE (the station's recipe) drawn by the existing generic POI path — a disc and the word WRECK — so the renderer needed no change, and the minimap and off-screen arrow come free; a purpose-drawn derelict is a presentation task for whoever owns the art.  The death summary shows the wreck's map and module count and the records line.  `moveModule`'s drydock guard is untouched (recovery is a separate path), as D10 required. |
| D24 | S2 | 2026-10-03 | **D-S2-e — save-version policy: MIGRATE** (user call).  Options: migrate with a version field / discard on mismatch / refuse to load.  `version` integer + `MIGRATIONS[n]` upgrading n → n+1 on plain JSON, run as a chain; unknown module ids are dropped field by field; a bad field costs that field, not the file.  A save from a NEWER build, or one that cannot be parsed, is never overwritten silently: its raw text is parked under `omni.save.unreadable` and the game starts fresh. | S6 adds its world state as a migration, not a wipe.  A downgrade cannot eat a newer player's file.  The chain is tested with a stand-in v3 format in front of a v1 file (`parseSave` takes the target version and migrations as parameters for exactly that). |
| D25 | S2 | 2026-10-03 | **Wreck play-test calls (PR #112 review, user).** (a) Recovery returns modules to CARGO ONLY — nothing is installed. (b) A permanent guide leads back to the wreck: edge arrow + minimap beacon on the wreck, or on the rift toward it from another map. (c) The wave script resumes where the ship fell when the wreck's arena is re-entered (`WreckRecord.wave`); reset by a second death or by the arena's boss dying before recovery. (d) The death screen names an older wreck the death destroyed. (e) The main menu shows CONTINUE + the saved credits / modules / wreck when the save holds progress, and a note that difficulty is saved and only affects arena waves. (f) Debug ▸ Economy ▸ Save & Records shows deaths and bests. | `wave` is an optional save field read as 0 when absent, so no migration was needed (D24 unchanged). Resume restarts the WAVE at its start, not mid-spawn. A resumed boss wave re-spawns the boss fresh. |
| D26 | S2 | 2026-10-03 | **Wreck follow-ups (PR #112 review, user).** (a) The rift toward the wreck is also marked IN THE WORLD (amber ring + tag), not only on the arrow and minimap. (b) The wreck's held wave is REAL-TIME: held whole for 5 minutes after the player last left that arena, then one wave off per hour (3 → 2 at 1 h, → 1 at 2 h), to a fresh start. "Leaving" is the last time the player was in the arena — stamped by every save while there and before any map unload, so a portal, a respawn, quitting the app and an OS kill all read alike. Constants: `WRECK_CONSTANTS.WAVE_GRACE_SEC` / `WAVE_DECAY_SEC`. | Adds `Clock.wallMs()` (epoch ms) to the Clock port — the first epoch read; the sim step never reads it, only saves and the wreck's wave decay (S4: a native Clock must provide it). `leftAt` is an optional save field read as 0. Scope kept to the wreck's arena: general per-arena wave persistence is S6's. Between 5 min and 1 h the wave is unchanged, so the grace window only matters if the decay is later changed to start earlier. |
| D27 | S2 | 2026-10-03 | **Arenas remember their wave script (user call; supersedes D25c and D26b, which were wreck-only).** `g.arenaWaves[arenaId]` = {wave, kills already scored, wall-clock last-there}, kept for EVERY arena (wreck or not), stamped by every save while in it and before any map unloads. Within 5 minutes of leaving the wave returns exactly (same wave, same kills scored); after that it restarts from the top of the same wave, and from a wave earlier for each hour away (3 → fresh 3 at 5 min → fresh 2 at 1 h → fresh 1 at 2 h). A finished ladder (boss dead) is forgotten. Constants `ARENA_WAVE_MEMORY.GRACE_SEC` / `DECAY_SEC`. Replaces the wreck record's `wave` / `leftAt`. | **S6 flag:** this is the first per-arena state in the save (`SaveFile.arenaWaves`, optional → no migration). It is deliberately only the wave script — the arena's world still regenerates per entry (D8) except for the wreck's pinned seed — and S6's arena graph should absorb it as a field on its node record rather than keep two stores. S4: a native Clock must provide `wallMs()`. Live enemies at the moment of leaving are not restored; the spawn stream continues from the slot after the last kill. |
| D28 | S2 | 2026-10-03 | **A wave opens with a ROSTER window (user call).** The wave banner carries `roster` — per-subtype counts of what the wave must kill (the spawn list, plus the boss on a capstone) — drawn by `renderWaveAnnouncements` as a small panel above the banner: each archetype's silhouette (`drawEnemyIcon`, the world's own path, flat) and "xN". Same fade as the banner; cells shrink to fit the width. | Presentation only; the sim reads nothing new. A wave resumed mid-script (D27) shows its full roster, not the remainder. |
| D29 | S2 | 2026-10-03 | **The roster window and wave banner are ONE dialogue (user call, refines D28).** A wave-start announcement with a roster draws a single panel above centre (30% of the height) that gives the enemies the focus — large silhouettes and "xN" — with the wave number as a small heading, and holds 3.2 s (`ROSTER_HOLD`) instead of 1 s. The banner's hold became per-announcement (`maxLifetime`). | Presentation only. Non-roster banners (clear, snitch, phases) are unchanged. |
| D30 | PM | 2026-10-04 | **`dmath` goes to `S3`, in its GAMEPLAY-tier PR** (user call), placing S2's D17 hand-up.  The finding: JS engines' libm differs in the last place (`Math.pow`, Node 22 vs Chromium 141, ~10% of non-trivial inputs; `atan2` / `hypot` / `exp` / `log` / `sqrt` agree only by two V8s sharing fdlibm), and iOS is JavaScriptCore — a third libm — so replay is bit-exact WITHIN an engine and not across them.  Options weighed: **S3, as S2 recommended** (it already touches every constant and is next) / its own session before S3 / defer past the mobile release / drop it and narrow D0b to within-engine determinism. | §4's `S3` brief now carries it, with four things stated up front: it is a BEHAVIOUR change so it rides the gameplay PR; it invalidates every hash ONCE and must re-baseline `tests/replay.spec.ts` in the same commit; it needs a `perf/` number either side because `pow` sits in the collision resolver; and it does NOT block the mobile release — replay is dev-only (D7) and the save is not replay-based (D21), so what JSC costs today is reproducing an iPhone bug report on a dev machine.  What it DOES unblock is cross-device replay and §1/D0b's port-verification premise, which stays UNBACKED until this lands — the honest cost of choosing S3 over a session of its own.  Tightening D17's restated parity assertion back up is a consequence of this landing, not separate work. |
| D31 | PM | 2026-10-04 | **Audio memory: the score decodes at 25 kHz, and the SFX banks decode LAZILY** (user call), after PR #110's adaptive score landed and the resident figure was MEASURED at ~133 MB (70.9 music + ~62 sliced cue buffers) against a mobile-first phase.  Options put to the user: drop the music decode rate / hold fewer layers / decode the banks lazily instead of all four at unlock.  **Call: 25 kHz and lazy.** | Music: `SCORE.DECODE_RATE` 32 → 25 kHz, measured 70.9 → **55.4 MB**; linear, and nothing about the bar grid is rate-dependent.  Banks: only the MENU bank decodes at unlock; `requestBank` starts the others FIRE-AND-FORGET from `play()` / `loop()`, so CLAUDE.md §8's "never a decode inside a frame" rule is kept — the asking trigger plays its procedural draft and returns, which is what every id already did while the eager preload was in flight.  Measured: title screen **4.7 MB** of banks (was ~62), a run that never fires **49.3**, audio in total ~105 MB in play and 16.5 at the title against 133 / ~77.  **Stated honestly: lazy decoding DEFERS rather than reduces** — impacts and world are asked for within seconds of a run, so a few seconds in the steady state is close to what it was; the reduction is the rate cut, and what laziness buys is the PEAK (the whole-bank buffer no longer stacks against the score's decode at unlock) and the menu.  Two consequences were load-bearing and are documented in §8: the WAV pass and the procedural pre-render had to switch from `hasSample` to the MANIFEST, or a not-yet-decoded bank id gets a WAV fetched AND three Offline takes rendered — costing more than the eager decode saved; and a live LOOP is dropped when its bank lands, or `move.thrust` keeps its draft for the whole run.  `tests/audio.spec.ts` gained a laziness regression (verified to FAIL against the eager build) and its whole-manifest test now asks for every bank via `decodeAllBanks()` — the claim is unchanged, only its trigger moved.  **Not a work-session payload:** done here, in the phase branch, because it is a two-constant change plus its guards and it blocked nothing in S3's brief. |
| D32 | PM | 2026-10-04 | **S3's four pre-flight calls, settled before the brief was written** (user).  (a) **FORMAT: TOML.**  Options weighed: TOML / JSON + a TS schema / data-only TS modules.  The decider was COMMENTS — this repo's tables carry the reasoning behind each number (the grain table's "neither is visible in the row", the bank divisor's two factors), and that commentary is a large part of their value, so JSON would either lose it or scatter it into sibling files.  (b) **FIRST TABLES: `MAP_POPULATION` + `ENEMY_VARIANTS` + `BOSS_DEFS`** — ~560 measured lines, all three DESCRIPTIONS rather than derivations, one small / one medium / one nested-shape, and exactly what a balance harness needs to vary.  (c) **ORDER: tables before `dmath`** (D30 placed dmath in S3; this settles its position WITHIN the session, and does not reopen D30).  (d) **KNOB TRIAGE: only the extracted tables' knobs**, riding each extraction. | **The format choice is cheap here only because of an existing precedent, and that is the brief's load-bearing constraint.**  `vite.config.ts` already resolves two BUILD-TIME virtual manifests (`virtual:nebula-manifest`, `virtual:sfx-manifest`), so a TOML table parses at build time into a typed module: the parser is a devDependency, the bundle ships zero parser bytes, and `scripts/inline-build.mjs`'s single-file standalone — which cannot fetch anything — works for free because the data is already in the module.  THREE consumers must all resolve the new virtual ids or the gates break, and the second is the one that gets forgotten: (1) `vite.config.ts`; (2) `scripts/sim-test.mjs`, whose esbuild shim hardcodes `/^virtual:(nebula\|sfx)-manifest$/`, so `npm run test:sim` fails the moment a table becomes virtual; (3) `playwright.config.ts`'s webServer, which builds, so it is covered by (1).  ORDER rationale: extraction is the session's stated payoff and the lower-risk half, so if `dmath` sprawls (~150 call sites plus a `perf/` number either side) the valuable work has landed, and `dmath` explicitly does not block the mobile release.  The honest cost of that order: `dmath` later shifts the extraction's derived-value assertions in the LAST PLACE, so those assertions need tolerances rather than equality — the brief says so, since discovering it as a red suite is how it turns into a day.  MEASURED AND CORRECTED in §4 while settling these: `constants.ts` is 11,359 lines (the brief said ~1000) and there are 59 `*_CYCLE` tables (it said ~90). |
| D33 | PM | 2026-10-05 | **THE FORMAT FOLLOWS WHO WRITES THE FILE, NOT WHO READS IT** (user call, after W1's `score/index.json` landed beside D32's TOML and the two could have read as drift).  **A file a GENERATOR rewrites is JSON.  A file only HUMANS write is TOML.**  So W1's song index stays JSON and `S3`'s tuning tables are TOML, and neither is to be "unified" into the other. | The rule is phrased on the WRITER because that is the property that actually decides it: TOML's one advantage here is COMMENTS, and a comment cannot survive a generator rewriting the file — `npm run music:import` adds or replaces songs in `index.json` on every run, so any commentary in it would be destroyed on the next import.  Phrasing the rule on the reader ("engine data is X") would have given the wrong answer for both files.  **THE INDEX IS HONESTLY A MIXED CASE, and it is the exception that proves the rule rather than a counter-example:** its `songs[]` array is generator-written, but its `plan` block (which song plays in the hub, a field map, an arena, a boss fight) is a HAND-AUTHORED editorial choice — and the file pays for being JSON exactly where you would expect, with an `"about"` STRING KEY doing a comment's job at the top.  That is the cost, it is small, and splitting four lines of `plan` into a separate TOML file to satisfy the rule would be churn for nothing.  If `plan` ever grows into real editorial reasoning, THAT is the moment to split it, and this row is the argument for doing so.  Recorded in CLAUDE.md §8 as well as here, so a session that reads only the master spec still sees it. |
| D34 | PM | 2026-10-06 | **D33's RULE STANDS; ITS "MIXED CASE" CAVEAT IS RETIRED** (PM reconciliation after `6558b71`, not a new call).  The index is NOT a mixed case: `music:import` writes its `plan` block too, so `index.json` is a wholly generator-written file and the rule's own answer for it — JSON — is now the clean case rather than the exception.  Read D33's rule as written and ignore only its mixed-case paragraph. | D33 argued the index "pays for being JSON exactly where you would expect" because `plan` was HAND-AUTHORED editorial choice sitting in generated output.  That was true of the file when D33 was written and is not true of the code: `scripts/music-import.mjs` ends with `for (const role of use) index.plan[role] = meta.id`, so each song's own `use` array decides which roles it claims and the importer stamps them into the index.  **The editorial choice did not disappear — it moved UPSTREAM**, into the kit's hand-authored `song.json`, which is exactly where D33's deciding property says it belongs.  So the rule did better than its own footnote: the one file that looked like a counter-example turned out to obey it.  Two consequences.  (1) `plan` is still hand-EDITABLE (the importer never clears a role), so a human pin survives until a song claims that role — it is generator-written, not generator-owned.  (2) It puts a NEW question where the old caveat was, and that one is the user's, not mine: the kit's `song.json` is hand-written and read by a generator, so comments WOULD survive in it and D33's rule points at TOML — see §8.  Appended rather than editing D33, per §0: the log is append-only, and a correction that rewrites the row it corrects destroys the evidence that the rule was tested. |
| D35 | PM | 2026-10-06 | **THE KIT'S `song.json` STAYS JSON, AND D33 CARRIES THE EXEMPTION** (user call, taking the PM's recommendation (a) on D34's §8 hand-up).  D33's rule points a hand-written file at TOML; the GarageBand kit's `song.json` is hand-written, read only by `music:import`, and stays JSON.  The rule is not weakened — it gains a stated boundary: **a file small enough that its fields need no explanation does not need a format that can explain them.**  The moment a kit carries reasoning worth a comment — WHY a song claims `boss`, why a tempo was chosen — that is the moment to split it, which is D33's own test applied one level up. | Options weighed were (a) leave it JSON and write the exemption into the rule, (b) move it to TOML for the sake of commentary, (c) TOML upstream with the generator's copy staying JSON.  (b) buys a comment nobody has yet wanted to write, against a change to W1's authoring surface and `docs/MUSIC_PIPELINE.md`; (c) is the most honest about the two files having different writers and the least worth its cost, since it means two formats for one shape.  The deciding fact is that the file is FIVE live fields (`id`, `title`, `bpm`, `bars`, `use`), four of which the importer validates by name, plus two inert ones — nothing in it is a judgement that needs defending.  Recorded in CLAUDE.md §8 beside D33, since that is where the rule is read. |
| D36 | PM | 2026-10-06 | **D15 NO LONGER DESCRIBES THE BRANCH TOPOLOGY: `S3` PROMOTED TO `main` ON ITS OWN** (PM reconciliation of what happened, not a new call).  PR #113 (`claude/s3-numbers` → `main`, merged 2026-10-06) carried 62 commits and 155 files — `dmath`, the TOML content tables, the balance harness, factorial pricing, per-arena difficulty and the hub layout — so `main` is now AHEAD of the phase branch, which D15 said would not happen until the phase ended.  The user reports the merge was PREMATURE and that `S3` still has work in flight, so this is a topology change to absorb, not a phase completion. | **What is true now:** `main` holds `S1` + `S2` + `S3`; the phase branch holds W1 (the music pipeline), the W2 revert, the Critical Mass import and this plan's own commits — 14 commits `main` lacks.  The two diverged at `33ac6f3`.  **What was done:** `main` was merged INTO the phase branch (three conflicts: this doc twice, `package.json`, `package-lock.json`), so PR #108 is mergeable again and carries the music work forward rather than stranding it.  Both devDependencies survive — W1's `ffmpeg-static` and `S3`'s `smol-toml` — and the lockfile was REGENERATED with npm rather than hand-merged.  **What this costs:** D15's guarantee was that the phase lands as one reviewable promotion; that is gone and cannot be recovered by anything written here.  What replaces it is weaker and worth stating plainly — the phase branch is now a FOLLOWER of `main`, so every session on it must merge `main` before pushing, and a second premature promotion is now the likely failure rather than a hypothetical one.  **Not decided here:** whether the phase branch should keep accumulating at all, or whether the remaining work should go to `main` in PRs the way `S3`'s did.  That is the user's, and it is the one question this topology actually raises. |

---

## 8. Flagged for the planning session

Work sessions append here when a decision changes what a *later* session
should do.  The PM session reconciles, updates §4, and records the
reconciliation in §7.  Leave resolved items in place, struck, so the
history stays readable.

- ~~**W1 → the user (the kit `song.json`'s format).**~~  *(SETTLED, D35: the
  user took option (a) — it stays JSON, and D33 carries the exemption.)*  D34 moved the music
  pipeline's one hand-authored file out of `index.json` and into the GarageBand
  kit's `song.json` — id, title, bpm, bars, `use`, and the two inert fields.
  That file is WRITTEN BY A HUMAN and only READ by a generator, so comments
  would survive in it, which is the exact property D33 says decides the format:
  by D33's own rule it wants TOML.  It is JSON today.  **Nothing is broken and
  nothing is urgent** — it is five live fields and the importer validates four
  of them — so this is a consistency call, and it is the user's because D33 was
  a user call and because changing it touches W1's authoring surface and
  `docs/MUSIC_PIPELINE.md`, not just a parser.  Three ways to go: (a) leave it
  JSON and write the exemption into D33's rule, since the file is small and the
  importer already carries the only commentary that matters; (b) move it to
  TOML, which buys the ability to say WHY a song claims `boss` beside the claim
  — the kind of reasoning this repo normally keeps next to its numbers; (c) move
  it to TOML *and* keep the generator's copy beside the stems as JSON, which is
  honest about the two files having different writers but means two formats for
  one shape.  My recommendation is (a) until a kit carries reasoning worth a
  comment, on D33's own "that is the moment to split it" logic.  *(PM,
  2026-10-06)*

- **S1 → S2 (Clock port).**  Four wall-clock reads still sit in or beside the
  sim and a replay works around, not through, them: (1) `PerfController`'s load
  signal has a wall-clock sim-time term — a held replay feeds it 0, so skip
  tiers in a REAL recorded run are not reproduced; a bug-report replay of a
  heavy scene needs the tier recorded, or the controller pinned; (2) a charged
  shot's hold time reads `performance.now` in `InputSystem` and is not in the
  replay input format; (3) the replay's aim is a screen position from the
  viewport centre, so it only matches at the recorded viewport; (4) the
  per-run seed is read from `crypto` / `Date.now` in `freshRunSeed` — a daily
  seed (D-S1-a) would route through the `Clock` port.  *(S1, 2026-10-02)*
- **S1 → S2 (save scope).**  `GameEngine.runSeed` is the one number a saved
  run needs to regenerate terrain; the streams' STATES are not saved, so a
  mid-run save restores the world from entities but cannot resume the random
  sequence unless `simStates()` is persisted too.  *(S1, 2026-10-02)*
- **S1 → S3 (content as data).**  Nothing in the content tables may read
  `Math.random` any more; a content row that wants a random roll names its
  stream.  `constants.ts` still owns three roll helpers
  (`randomRockShade` / the plastic shades are cosmetic; the wave-mix roll in
  `buildWaveSpawnList` is sim) — they stay as functions, not data.
  *(S1, 2026-10-02)*
- ~~**S1 → S2 (save scope, from D4/D6/D8).**  What a death keeps is credits only;
  equipment is wiped and the player is returned to the station.  The hub is
  persistent while arenas carry their own seed, so S2's persistence splits
  into (1) the character: credits (and whatever equipment policy PR 2 settles),
  (2) the hub world, and (3) nothing for an arena beyond its seed.~~
  *(S1, 2026-10-02; RESOLVED by D10/D11, PM 2026-10-03 — the equipment policy
  is settled and the save scope grew a wreck record.  See the PM item below.)*
- **PM → S2 (save scope, settled — D10/D11).**  A death wipes INSTALLED modules
  only; CARGO survives; and the wiped loadout is RECOVERABLE from a wreck at the
  death site, so equipment is suspended rather than destroyed.  S2 persists:
  (1) the character — credits and cargo contents, (2) the hub world, (3) an
  outstanding wreck record, and (4) nothing for an arena beyond its seed.
  Cargo survival and the station return are ALREADY SHIPPED (S1 PR 2), so S2
  persists them; **D10's wreck is the only new behaviour the death policy
  still owes.**
  TWO sub-decisions S2 must put to the user before writing the format, both
  stated with PM's recommendation in D10: **where the wreck sits** (pin the
  arena's seed so S1's generation reproduces the terrain and the position stays
  valid — recommended — or surface it at the return rift and persist arena
  identity only), and **how a wreck is lost** (on a second death before
  recovery — recommended — never a wall-clock timer, which punishes putting a
  phone down).  Also for S2: the run summary needs re-thinking a second time,
  since D6 deleted its credit-loss line and D10 restores a wreck holding
  modules.  And `moveModule`'s drydock-only guard is now load-bearing — do not
  relax it, or a threatened player strips the ship into safe cargo.
  *(PM, 2026-10-03)*
- **Process.**  The plan lived only on `claude/steam-game-publishing-xhnui2`
  (PR #108) when S1 began, so `git checkout -B claude/engine-core origin/main`
  would have dropped it.  S1 branched from the plan branch instead.
  *(S1, 2026-10-02)*
- ~~**S1 → PM (world design, D9).**  The descent rift is closed as S1's item and
  handed up: the user wants a redesigned, connected tree of purpose-built
  arenas (labyrinth, dig-through, graded wave arenas) with physical travel
  between them in place of direct portals to the station.  This is a
  gameplay-and-content workstream the four sessions do not cover.  It
  touches S2 (per-node persistence: which arenas keep destroyed tiles and
  `found` flags, today lost on re-entry), S3 (arena layouts as DATA — the
  natural first content table to extract) and the `MAP_DESCRIPTORS` registry,
  which today carries no graph edges.  Needs a home in §4 / §6 and a decision
  on whether it is a fifth session.~~  *(S1, 2026-10-03; RESOLVED by D13, PM
  2026-10-03 — it is its own session `S6`, placed AFTER `S4`, and §4 now
  carries its brief.  The per-node persistence it asked about was deferred
  out of `S2` into `S6` by D14, so `S6` owns both the world and its save
  format.)*
- ~~**S2 → PM (libm: cross-engine determinism needs a math layer — D17).**
  `Math.sin` / `Math.cos` / `Math.pow` differ between JS engines in the last
  place (measured: Node 22 vs Chromium 141, `pow` on ~10% of non-trivial
  inputs), and `atan2` / `hypot` / `exp` / `log` / `sqrt` agree today only by
  luck of two V8s sharing fdlibm.  Replay is therefore bit-exact within one
  engine and not across engines.  Consequences, in order of how much they
  matter: (1) **iOS is JavaScriptCore, a third libm** — a replay does not
  reproduce across devices, nor across an OS update on one device, which makes
  *replay-as-save-format* (D-S2-c's cheap option) unsafe; (2) a console port's
  "replay the inputs and compare hashes" test (§1, D0b) cannot pass without a
  deterministic math layer first; (3) the Node harness and the CI Chromium agree
  on streams and player but not world.  The fix is a `dmath` module (own
  `sin` / `cos` / `pow`, then `exp` / `log` / `atan2` to be safe against JSC):
  ~150 sim call sites, a measurable per-call cost on hot paths (`pow` is in the
  collision resolver), and it moves every number in the last place — so it is a
  BEHAVIOUR change, belongs in a gameplay-tier PR or its own session, and
  invalidates every existing hash once.  PM to place it (S3 is the natural home
  since it already touches every constant); S2 did not do it.~~  *(S2,
  2026-10-03; RESOLVED by D30, PM 2026-10-04 — it goes to `S3`'s GAMEPLAY-tier
  PR, user call, and §4's S3 brief now carries it with the hash re-baseline,
  the `perf/` requirement and the note that it does not block the mobile
  release.)*
- **S2 → S3 (ports in the sim).**  Content tables stay platform-free: the
  guard fails on `window` / `performance` in `constants.ts`, so a data file that
  needs the display size reads `viewport()` from `engine/ports.ts`, and one that
  needs time reads `nowMs()`.  `GameEngine` is constructed with a `Platform`
  now; a balance harness builds `createHeadlessEngine()` from
  `tests/sim/harness.ts` and replays with `replaySeries`.  Throughput, measured
  here for 1,200 steps INCLUDING the map build: POCKET ~2,500 steps/s, NEBULA_FIELD
  ~1,200, OVERWORLD ~630, UNIVERSE ~500 — against the 120 steps/s a real run
  consumes, so 4–20× real time on one core, and a many-runs balance sweep wants
  a worker pool before it wants anything else.  *(S2,
  2026-10-03)*
- **S2 → S4 (Capacitor against the ports).**  Three seams are yours and none
  needs a sim change: `Lifecycle` (map Capacitor's `appStateChange` to
  `'background'` / `'foreground'`; the engine already pauses silently and
  re-anchors the clock), `Storage` (synchronous by contract — Capacitor's
  Preferences is async, so read it once at startup into a `MemoryStorage` and
  write through), and haptics, which still ride `InputPort.rumble`.  Note the
  iOS libm point in the item above: WKWebView is JavaScriptCore.  *(S2,
  2026-10-03)*
- **S2 → PM (replay format).**  `ReplayLog` gained `viewport`, `ReplayInput`
  gained `charge` and `simMs` (D18); all optional, so existing logs replay as
  before.  A recorder that writes `simMs` would make heavy-scene skip tiers
  reproducible; none exists, and none is planned (D7: dev-only).  *(S2,
  2026-10-03)*
- **S2 → S6 (the world must keep the wreck findable).**  A wreck record is
  `{arenaId, seed, x, y, modules}` and `loadMapSeeded` re-pins that arena's seed
  (D22).  A connected graph keeps this working if (1) `arenaId` still names the
  node a wreck fell in, (2) a node's generation is a function of its seed alone,
  and (3) the map a player STARTS a session in is reachable from where a wreck
  lies — otherwise the wreck is saved but unreachable.  Add S6's world state to
  the save as a MIGRATION (D24), never a wipe.  Also: a pinned arena repeats its
  wave script until recovery (a seed covers everything, D3).  *(S2, 2026-10-03)*
- **S2 → PM (economy and the wreck).**  Credits, cargo and slot counts survive a
  death; the fitted loadout waits in the wreck.  The "buy two of everything"
  hedge (D11) is still the lever, but the wreck now makes it cheaper to skip:
  a player who can fly back owes nothing.  Whether the trip is hard enough to
  matter is an S6 / economy question — S2 measured nothing about it.  Also: the
  death-proof seams stay unpriced (D20).  *(S2, 2026-10-03)*
- **S2 → S3 (knob triage input).**  Persisted settings are only audio volumes
  + mute, control scheme and difficulty (D20).  Every other DBG cycle is
  per-session by construction.  *(S2, 2026-10-03)*
- ~~**W2 → S3 (`constants.ts` surface).**~~  *(MOOT, `ae222f4`: those ~48
  lines were reverted with the variants layer, so there is no rebase surface
  for `S3` here after all.  Live again only if that branch lands.)*    Layer variants added ~48 lines of
  `AUDIO_CONSTANTS.MUSIC_*` to `constants.ts` — tag radii, hysteresis, the
  family margin, the dwell, the decode budget and the family table.  `S3`
  extracts tables from that same file, so this is a REBASE surface, not a
  conflict of intent.  None of it is a candidate for extraction: it is
  tuning for a subsystem whose data already lives in `score/index.json`
  (D33 — the index is generator-written JSON, these are hand-authored
  numbers that belong beside the code that reads them).  *(PM, 2026-10-05)*
- ~~**W2 → the audio-memory decision (D31).**~~  *(MOOT, `ae222f4`:
  `MUSIC_DECODE_BUDGET_MB` went with the revert, so D31's measured figures
  stand unchallenged.  The re-measure below becomes a REAL decision the day a
  variants branch lands AND a song declares variants — both, not either.)*    `MUSIC_DECODE_BUDGET_MB` is
  **110**, and it is a ceiling on the score's TOTAL decoded PCM (default
  stems plus the variant cache), not a variant-only allowance.  D31 cut the
  decode rate to 25 kHz on a MEASURED 70.9 → 55.4 MB for the score, with
  total audio ~105-117 MB in play, because iOS Safari kills a tab on peak
  RSS.  So the ceiling sits at about twice the measured base, and if
  variants ever fill it the score roughly doubles and total audio lands
  near ~170 MB.  **Today that cost is zero** — no song declares variants —
  so nothing is regressed and nothing needs undoing.  What needs doing is
  re-measuring when the first variant stems are authored, rather than
  inheriting 110 as a settled number: it was chosen ahead of the content,
  and CLAUDE.md already carries the general form of this lesson from the
  nebula goo step ("a cost measured against one population does not
  survive a change to that population").  A decision for the user when
  variants exist, not now.  *(PM, 2026-10-05)*
- **S3 → PM (new gnat-flock enemy types need a home).**  The user wants VARIETY
  from the "Gnat move" modes (boids / vortex / weave / burst), which were never
  retired: archetypes that each wear one, rather than one global DBG cycle.  S3
  PR 1 landed only the SEAM (`swarmMove?` on an `ENEMY_VARIANTS` row; no row sets
  it).  The enemy types themselves are gameplay content — an `EnemySubtype`,
  role/behaviour rows, a shape + roster icon, a sprite, wave placement and a
  balance pass — and are not part of the extraction or of `dmath`.  PM to place
  them: a third S3 PR, or a content item for after the balance harness exists
  (they would be a natural first customer of it).  *(S3, 2026-10-04)*
- **S3 → all sessions (content tables are files).**  `MAP_POPULATION`,
  `ENEMY_VARIANTS` and `BOSS_DEFS` live in `data/*.toml`.  A balance change is a
  TOML edit that also re-captures `tests/sim/fixtures/tables.golden.json` in the
  same commit (that is what makes it visible); a new table is an entry in
  `scripts/toml-tables.mjs` `TABLES`, and BOTH `vite.config.ts` and
  `scripts/sim-test.mjs` pick it up from there — no second place to register it.
  Arena layouts as data (S1's earlier flag) can use the same mechanism.
  *(S3, 2026-10-04)*
- **S3 → PM (PR 1 and PR 2 are one PR).**  At the user's request `dmath` was
  rolled into the content-tables PR.  Consequences for later sessions: the
  Node-vs-Chromium parity assertion is now EXACT for the world (S2's "streams and
  player only" caveat is retired); any new sim code must use `dmath.*` and avoid
  `**` or the guard fails; a deliberate change to dmath is a rebaseline.  *(S3,
  2026-10-04)*
- **S3 → PM / S2 / S4 (difficulty moves to the portal).**  User call
  2026-10-05: difficulty is per PORTAL (up to 20 levels, shown on arrival), the
  start-of-game picker goes away, alternate arenas get their own dial vector,
  rivals count in the calculation, and weapon-loadout scaling is a later input.
  Consequences: the SAVE FILE's `settings.difficulty` needs a migration (S2);
  `WaveSystem` / `ENEMY_SCALING` / `DIFFICULTY_*` read a per-arena level, not
  `difficultyLevel`; the portal descriptor (`MAP_DESCRIPTORS`) gains a level;
  the arrival UI needs a level readout (S4 if it owns the mobile HUD).  Not
  built yet — S3 reports today's numbers first.  *(S3, 2026-10-05)*
