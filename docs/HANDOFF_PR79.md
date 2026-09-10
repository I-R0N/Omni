# Handoff — PR #79 (Phase 3 Pair B: SFX system + explosion variety)

You are picking up an in-flight pull request. This document is the whole
briefing: it assumes you have never seen this repository and cannot ask
the person who wrote the branch anything. Everything you need is here or
in the files named below.

---

## 1. What this PR is

Omni is a 2D top-down arena game with a bespoke engine (Canvas2D
renderer, React shell for the HUD, Vite, TypeScript) — you fly a ship
around a toroidal map, fight waves of enemies, break up material tiles
for salvage, and outfit the ship at space stations between runs. It had
**no audio at all** before this branch.

This PR is **Phase 3 Pair B** of `docs/GAME_FEEDBACK_PLAN.md`: (a) the
game's first sound-effects system, and (b) differentiating the death /
explosion visuals so different enemy and material classes no longer die
identically.

---

## 2. Read these first, in this order

Do not skip these. The engine has several invariants that are easy to
violate and hard to notice, and this branch's design only makes sense
against them.

1. **`CLAUDE.md`** — engine ground truth, and the single most important
   file in the repo. Pay particular attention to:
   - **§3, the per-frame loop** — a fixed-timestep accumulator; one
     rendered frame can run several simulation steps.
   - **§8 "React re-renders only on the stats callback"** — UI data
     flows through `EngineStats` and nothing else. Do not add per-frame
     React state.
   - **§8 torus math** — the map wraps on both axes. Every distance,
     nearest-neighbour and direction calculation must go through
     `wrapDeltaX` / `wrapDeltaY` from `engine/toroidal.ts`. Plain
     `a.x - b.x` is silently wrong near the seam. This bit the audio work
     once already (inverted stereo).
   - **§8 mutate, don't allocate** — hot paths reuse buffers; allocating
     objects inside per-frame loops is the top performance regression in
     this codebase.
   - **§8 PerfController** — any new *periodic* work registers a task and
     gates on it rather than rolling a private frame counter.
   - The audio-specific conventions in §8 (the id contract, the
     event-driven property, the material frequency rule, near-field shard
     chatter, the iOS notes) describe what this branch built.

2. **`docs/GAME_FEEDBACK_PLAN.md`** — read the "How this works" section
   and the completion roadmap. This gives you the process and the
   conventions the project runs on, and shows where Pair B sits among the
   other work in flight. **Never edit this file** — it is owned by the
   orchestration session that coordinates the parallel work.

3. **`docs/GAUNTLET_PAIR_B_LOG.md`** — the ledger for *this* work. It is
   long and it is the thing that replaces the previous author's memory:
   every milestone, every decision with the alternatives that were
   rejected and why, the numbers that were invented rather than measured,
   and a consolidated **FOR-USER-REVIEW** section of open questions at
   the top. Read the FOR-USER-REVIEW block and the "Retarget + AUDIO_PLAN
   reconciliation" section at minimum.

4. **`docs/SFX_INVENTORY.md`** — the cue inventory that drives the
   implementation, and the PR's headline deliverable. Every sound in the
   game is a row: stable id, trigger site, mix tier, duration, sonic
   character in prose, frequency range and envelope, variation scheme,
   polyphony cap and throttle rule, mix level, and positional-vs-UI. It
   doubles as a commission brief you can hand to a sound designer or a
   generation tool.

5. **`docs/AUDIO_PLAN.md`** — **binding architecture constraints.** Its
   §2 (the standalone-build fork, the torus vs `PannerNode`, polyphony,
   iOS, the fixed-timestep/audio-clock split) is a correctness
   requirement, not a wish list. §3 sketches a bus structure and music
   director; §5 lists music beds; §6 lists open decisions. Where it
   overlaps `SFX_INVENTORY.md`, the inventory wins — see the
   reconciliation table in the gauntlet log for a requirement-by-
   requirement status.

---

## 3. State of the branch

Branch: `claude/gauntlet-pair-b-sfx-7oxdrc`. PR #79, targeting
`claude/plan-completion`. Fourteen commits, ~5.8k lines added, merged up
to date with the integration branch.

### Complete

| Milestone | Commit | What landed |
|---|---|---|
| **B1** inventory | `32e16d9` | `docs/SFX_INVENTORY.md` — every player-audible action with per-effect generation parameters. |
| **B2** audio engine | `aa0a3b8` | `engine/systems/AudioSystem.ts` — gesture-unlocked, event-driven WebAudio manager with voice budgeting and torus-correct positioning. |
| **B3** wiring | `9bb1d06` | `engine/systems/SfxRegistry.ts` (procedural drafts) + trigger sites across the engine + one pause-menu audio row. |
| **B4** explosion variety | `4476729` | `EXPLOSION_PROFILES` in `constants.ts`; `GameEngine.deathFx()` / `playDeathFx()`. |
| **B5** validation | `9323717` | Perf A/B, phone-scale check, full-loop smoke, completion summary. |
| CLAUDE.md sync | `d3256b0` | Audio + explosion conventions documented. |
| iOS fix | `ae39d92` | Silent-switch, `interrupted` state, persistent gesture listeners, diagnostic strip. |
| Playtest tuning | `c5924e4`, `05e1efd`, `6ba05ea`, `674d5ce` | Material whine fix, engine idle, near-field shard rule, POI voices, player↔shard contact. |
| Retarget | `7db950c` | Rebase onto `claude/plan-completion` + AUDIO_PLAN reconciliation. |
| Smokes + handoff | `813f1e5` | `scripts/smoke/` — the six suites, previously session-local — plus this document. |
| Second retarget | *this commit* | Merge of `claude/plan-completion` after the 5c / 5f / render-split work landed (50 commits). |

**105 sound ids** are registered (98 one-shots, 7 loops) and the same 105
are documented. A smoke asserts that parity in both directions, so the
document cannot silently drift from the code.

### Wired vs stubbed

Most ids fire from real trigger sites. **11 are registered and fully
specified but have no call site** — they make no sound today:

```
crash.shard.tile     move.merge          move.dent.recover
pickup.merge         wave.start          wave.grace
bubble.drain         ui.nav              ui.error
ui.drag.pick         ui.drag.drop
```

Two of those are deliberate: `crash.shard.tile` and `move.merge` are
shard-on-shard chatter, which is precisely what the near-field rule
exists to suppress — wiring them would work against it. The other nine
are simply unfinished; see the checklist below.

### Known rough edges

- **Everything is procedurally synthesised.** No audio asset files. This
  is why the standalone build still works untouched — and it is *not*
  what `AUDIO_PLAN.md` §1 asks for (sampled, AAA). See §4 item 1.
- **All numbers are provisional.** Frequencies, envelopes, mix levels,
  radii, thresholds — reasoned about against a mix budget, not measured
  on real hardware. Expect to move mix levels first.
- **No bus structure.** One master gain; no music/sfx/ui/ambience split
  and therefore no ducking (`AUDIO_PLAN.md` §3).
- **`AUDIO_PLAN.md` §2e is only partly met.** Cues are triggered from the
  sim and scheduled against `ctx.currentTime` at call time, but there is
  no single per-frame schedule time, so several sim steps inside one
  rendered frame can schedule a few milliseconds apart. The per-id
  retrigger collapse hides the audible symptom.
- **Volume and mute do not persist.** In-memory only, consistent with the
  project keeping no state across reloads. Making them stick is a
  deliberate, unmade decision.
- **`npm run typecheck` is clean** and `npm test` (38 Playwright specs,
  the project's own harness from roadmap 5b) passes on this branch. Both
  are enforced by the `pr-checks` merge gate, so a red one blocks the PR.
- **`scripts/smoke/` predates `tests/`.** The six audio suites were
  written before the project had a runner; roadmap 5b then built one
  (`tests/`, `playwright.config.ts`, `npm test`). Both currently pass and
  the audio assertions are *not* in the gate. Folding them into `tests/`
  is worthwhile and listed as remaining work.
- **The perf A/B assertion is load-sensitive** and can fail as noise on a
  busy machine. See `scripts/smoke/README.md`.

---

## 4. Remaining work

Each item is independently committable. They are ordered so that the
blocking decision comes first; after that they are largely independent.

### 1. Settle the standalone-build fork — *decision, not code*

**Raise with the repo owner before authoring or importing any audio
asset.** `scripts/inline-build.mjs` inlines every referenced asset as a
base64 data URI, and the `publish-standalone` workflow ships that single
file. Sampled audio (`AUDIO_PLAN.md` §1's stated direction) is tens of
megabytes; base64 inflates it further. `AUDIO_PLAN.md` §2a lays out three
options: audio external and the standalone silent, two divergent builds,
or drop the standalone build.

Procedural synthesis has made this *temporarily* moot, not answered. The
migration path is already built: the inventory id is the contract, so a
sample replaces a synth by re-registering the same id in `SfxRegistry` —
no trigger site changes. `docs/SFX_INVENTORY.md` §9 ranks which cues are
worth an external budget first.

*Files:* none until decided. *Validation:* record the decision in
`docs/GAUNTLET_PAIR_B_LOG.md` under FOR-USER-REVIEW.

### 2. Wire the nine unfinished cues

`wave.start`, `wave.grace`, `pickup.merge`, `move.dent.recover`,
`bubble.drain`, `ui.nav`, `ui.error`, `ui.drag.pick`, `ui.drag.drop`.
Each row in `docs/SFX_INVENTORY.md` names its intended trigger site.
Follow the existing pattern: call `audio.play(id, opts)` from the engine
path that already handles the event; for a system that has no audio hook
yet, add **one** generic sink field (see `PhysicsSystem.sfx`,
`ShardSystem.sfx`, `DropSystem.sfx`, `WeaponSystem.onEnemyFire`) assigned
once in the `GameEngine` constructor, rather than importing audio state
into that system or widening an `update()` signature.

The UI cues are the exception noted in `AUDIO_PLAN.md` §3 and may fire
from React in `components/UIOverlay.tsx`.

*Files:* `engine/GameEngine.ts`, `engine/systems/WaveSystem.ts`,
`engine/systems/DropSystem.ts`, `components/UIOverlay.tsx`.
*Validation:* a `playsOf(id) >= 1` assertion per newly wired cue, driven
through the real game path — in `tests/` if item 8 has landed, otherwise
in `scripts/smoke/b3.mjs`.

### 3. Bus structure and ducking

Split the single master gain into `music` / `sfx` / `ui` / `ambience`
sub-buses per `AUDIO_PLAN.md` §3, so each can have its own level and so
music can duck under a boss death or stage-clear sting. `SfxDef` already
carries a `tier`; a bus is a separate axis and needs its own field.

*Files:* `engine/systems/AudioSystem.ts`, `constants.ts`
(`AUDIO_CONSTANTS`), `engine/systems/SfxRegistry.ts` (a bus per def).
*Validation:* `scripts/smoke/b2.mjs` — assert per-bus gain changes affect
only that bus's ids.

### 4. Per-bus volume sliders in the pause menu

Once (3) lands, extend the audio row. Keep the footprint small and drive
it through `EngineStats.audio` — no new React state.

*Files:* `components/UIOverlay.tsx`, `App.tsx`, `types.ts`
(`EngineStats.audio`), `engine/GameEngine.ts` (stats snapshot).
*Validation:* `scripts/smoke/b5.mjs` phone-scale section — the row must
still fit 390 px without horizontal scroll.

### 5. Per-frame scheduling (`AUDIO_PLAN.md` §2e)

Capture one `AudioContext` time at the top of each rendered frame and
schedule every cue triggered during that frame's sim steps against it, so
simultaneous events are genuinely simultaneous.

*Files:* `engine/systems/AudioSystem.ts` (a `beginFrame(now)` or
equivalent), `engine/GameEngine.ts` (call it once per `loop()`).
*Validation:* new assertion in `scripts/smoke/b2.mjs` — cues triggered
across sim steps within one frame share a start time.

### 6. Listen-test the provisional numbers

The tuning that headless cannot judge. See §6 below for what to listen
for. Every item is a single constant.

*Files:* `constants.ts` (`AUDIO_CONSTANTS`, `EXPLOSION_PROFILES`,
`STRUCTURE_CONSTANTS.SHARD_CONTACT_SPEED`),
`engine/systems/SfxRegistry.ts`. *Validation:* by ear, plus re-run
`scripts/smoke/tone.mjs` so a retune does not push anything back into the
fatiguing band.

### 7. Fold the audio suites into `tests/`

`scripts/smoke/` was written before the project had a runner; roadmap 5b
has since built one. The audio assertions are therefore green but *not
gated*, which is how they will eventually rot. Port them to
`tests/audio.spec.ts` (and a sibling for the offline tonal guard) using
the helpers in `tests/helpers.ts`, then delete `scripts/smoke/`.

Two of them do not translate one-for-one and need thought rather than
transcription: `tone.mjs` renders through an `OfflineAudioContext` rather
than driving the game, and `b5.mjs`'s perf A/B is load-sensitive and will
flake in CI — gate it behind an env var or drop it in favour of the
`play()` microbenchmark beside it.

*Files:* `tests/`, `scripts/smoke/`. *Validation:* `npm test` covers the
audio assertions and the suite count goes up by roughly 165.

### 8. Music beds and the music director

The largest remaining piece and effectively its own project.
`AUDIO_PLAN.md` §3 lists the game state that would drive it (all of which
already exists) and §5 lists the minimum bed set. Gated behind item 1,
since music is the bulk of the asset budget.

---

## 5. Working agreement

- **Branch:** `claude/gauntlet-pair-b-sfx-7oxdrc`. PR #79 targets
  **`claude/plan-completion`**.
- **Never push to, or target, `main`.** `main` deploys to Netlify.
- **`npm run typecheck`, `npm run build` and `npm test` must all be green
  before every commit.** The `pr-checks` workflow runs exactly these on
  every PR and they are the merge gate. Also run the six audio suites in
  `scripts/smoke/` when you touch audio — they are not in the gate yet.
- **Update `docs/GAUNTLET_PAIR_B_LOG.md` as you go.** It is this work's
  ledger, not a summary written at the end. Record what you did, and
  record *decisions with the alternatives you rejected* — that is what
  makes it useful to the next person.
- **Keep `CLAUDE.md` in sync in the same commit** as any change it
  describes. If you change an invariant, the file that states the
  invariant changes with it.
- **Judgment calls go in the ledger's FOR-USER-REVIEW section and get
  raised with the repo owner** — not silently decided. Anything that
  trades one player-visible behaviour for another qualifies.
- **Never edit `docs/GAME_FEEDBACK_PLAN.md` or `docs/PARKING_LOT.md`.**
  Owned by the orchestration session.
- **Two parallel sessions are running** (test harness 5b, performance
  5c). If `claude/plan-completion` moves, rebase onto it and re-validate
  *before* opening or updating the PR. Expect conflicts in
  `engine/GameEngine.ts` around the constants import and in `CLAUDE.md`;
  the previous rebase resolved every conflict by keeping both sides, and
  that is usually right.

---

## 6. How to validate audio work here

### Headless

`App.tsx` assigns the live engine to `window.__omniEngine` and the latest
stats payload to `window.__omniStats`. Nothing in the game reads them —
they exist so tests can drive the real engine in a real browser without a
test runner. `AudioSystem` exposes `counts` (played / dropped /
collapsed), `playsOf(id)`, `liveVoices`, `liveVoicesOf(id)`,
`isLooping(id)`, `contextState`, `audible` and `resetCounters()` for
exactly this.

There are two suites of tests, and you want both. The project's own
harness is `tests/` (38 specs, run with `npm test`, part of the merge
gate). The audio assertions are separate — six suites in `scripts/smoke/`
(165 assertions), not yet gated; see `scripts/smoke/README.md` for what
each covers and §4 item 7 for folding them in. The short version:

```bash
npm test                                          # the gated harness

npm run build                                     # the audio suites
npx vite preview --port 4173 --host 127.0.0.1 &
node scripts/smoke/b2.mjs   # …b3, b4, b5, ios, tone
```

Three techniques there are worth reusing:

- **Registry ↔ document parity.** `b3.mjs` parses
  `docs/SFX_INVENTORY.md` and asserts both directions — every documented
  id is registered, and the registry has no undocumented extras. This is
  what keeps the inventory a source of truth rather than a stale sibling.
- **Offline rendering for tonal properties.** `tone.mjs` renders each
  sound through its real `render()` / `start()` into an
  `OfflineAudioContext` and measures it. This is how "does it whine" and
  "are the portal and station distinguishable" became assertions instead
  of opinions.
- **Compare classes against each other, not against a constant.**
  `b4.mjs` asserts a heavy hull's debris is slower and bigger *than a
  standard kill's*, which stays true under retuning; absolute thresholds
  would not.

### By ear — what headless cannot judge

Every assertion above tests structure, never *quality*. These need a
human with headphones, ideally on a phone (the game is played on one):

- **Fatigue.** The single most common failure here. A sound that is fine
  once can be intolerable after two minutes, and the offenders have all
  been loops or bulk-fired chips. `tone.mjs` guards the frequency band
  that caused it, but "annoying" is not a frequency.
- **Mix balance.** Whether combat drowns pickups, whether the engine bed
  sits under everything or on top of it, whether the station bed is too
  present when parked at a drydock. All relative levels; the `mix` column
  in the inventory is the knob.
- **Density.** Flying through dense rubble now knocks continuously —
  whether that reads as grinding or as a machine gun is a judgement call.
  `SHARD_CONTACT_SPEED` is the lever.
- **Legibility.** Enemy fire is deliberately voiced apart from player
  fire so incoming and outgoing are tellable apart on a busy screen.
  Confirm that actually works in play.
- **Whether the drafts are good enough.** They are drafts.
  `docs/SFX_INVENTORY.md` §9 ranks which are weakest relative to how much
  they matter — that list is the answer to "where do I spend a budget on
  sound".
- **On an actual iPhone:** that sound plays with the ring/silent switch
  **on** (the audio session claim is what makes that work), and that it
  survives a call or an app switch and comes back. The pause menu shows a
  diagnostic strip naming the context state whenever audio is not
  audible — that is the first thing to read if a phone is silent.
