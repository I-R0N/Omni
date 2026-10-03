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

**Near-term payoff.**  Tuning without a rebuild, and a console port that
inherits every balanced number instead of retyping it.  With `S2`'s
headless harness, balance claims become measurements rather than feelings —
the same move `perf/` already makes for frame time.

**Engine payload.**  Move tuning *tables* out of `constants.ts` into data
files; derivation *logic* (`massFor`, `enemyHpMult`, the DBG ladders) stays
code.  Teach the headless harness to answer balance questions over many
runs.

**SCOPE WARNING.**  This is the item most likely to sprawl.  `constants.ts`
is ~1000 lines of deliberately mixed data and logic, and much of what looks
like data is load-bearing derivation.  Pick **two or three tables**, land
them, stop.  This session is expected to recur rather than complete.

**OPEN DECISIONS — for the user, inside S3.**

- **D-S3-a — Which tables go first?**  Candidates: material grain
  (`SHARD_VARIANTS` + grain specs), enemies (`ENEMY_VARIANTS`), weapons
  (`WEAPONS`), modules (`MODULE_DEFS`), bosses (`BOSS_DEFS`), map
  population (`MAP_POPULATION`), scoring (`SCORE_CONSTANTS`).
- **D-S3-b — Knob triage.**  For each of the ~90 DBG cycles: a
  player-facing setting, baked at its play-tested value, or dev-only.
  Consequence: this is the biggest single legibility win available to the
  project, and only the user can make the calls.
- **D-S3-c — Data format.**  JSON / TOML / data-only TS modules.
  Consequence: a non-TS format is what a console port can actually read;
  data-only TS is cheaper now and re-does this work later.
- **D-S3-d — Does the player get more than the 4-level difficulty index?**
- **D-S3-e — Balance targets, stated as numbers.**  How long should wave 5
  take?  What is a healthy run length?  Consequence: without stated
  targets the harness has nothing to measure against and the session
  degenerates into taste.

**Invariant for the invisible PR.**  **Not one tuned number changes.**
Extraction is a move, not an edit.  Rebalancing happens in the gameplay PR
with the numbers visible in the diff.

**Acceptance, as tests to write.**
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

## 5. Branch and CI conventions

**One integration branch off `main`** holds all of `S1`–`S4`:
**`claude/steam-game-publishing-xhnui2`** (user call, 2026-10-03, replacing
`claude/engine-core`).  Work sessions branch from it and PR back into it; it
merges to `main` when the PM session judges a phase coherent.

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

---

## 8. Flagged for the planning session

Work sessions append here when a decision changes what a *later* session
should do.  The PM session reconciles, updates §4, and records the
reconciliation in §7.  Leave resolved items in place, struck, so the
history stays readable.

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
- **S2 → PM (libm: cross-engine determinism needs a math layer — D17).**
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
  since it already touches every constant); S2 did not do it.  *(S2,
  2026-10-03)*
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
