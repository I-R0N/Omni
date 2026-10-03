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

**Near-term payoff.**  Persistence is the single largest product gap and
blocks every store release.  The port work additionally delivers a
**headless sim in Node**, turning a 13-minute Playwright suite into
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

**This plan doc must reach `main` early**, because fresh work sessions
clone the default branch and would otherwise not see it.

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

Current order: **S1 → S2 → S3 → S4**, S5 deferred.

Rationale, so a later session can argue with it: `S1` first because it is
the only item that decays (new `Math.random()` sites accrue) and because
its harness makes later refactors verifiable; `S2` second because
D-S2-c's cheap implementation depends on `S1`; `S3` and `S4` may swap
freely.  Flipping `S1` and `S2` is defensible if persistence is wanted
sooner — `S2` is the larger product win and does not decay.

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
- **S1 → PM (world design, D9).**  The descent rift is closed as S1's item and
  handed up: the user wants a redesigned, connected tree of purpose-built
  arenas (labyrinth, dig-through, graded wave arenas) with physical travel
  between them in place of direct portals to the station.  This is a
  gameplay-and-content workstream the four sessions do not cover.  It
  touches S2 (per-node persistence: which arenas keep destroyed tiles and
  `found` flags, today lost on re-entry), S3 (arena layouts as DATA — the
  natural first content table to extract) and the `MAP_DESCRIPTORS` registry,
  which today carries no graph edges.  Needs a home in §4 / §6 and a decision
  on whether it is a fifth session.  *(S1, 2026-10-03)*
