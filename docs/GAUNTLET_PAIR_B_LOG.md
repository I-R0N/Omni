# Gauntlet Log — Phase 3 Pair B (SFX + explosion variety)

Ledger for the LOOPED autonomous "gauntlet" session implementing **ONE**
roadmap step of `docs/GAME_FEEDBACK_PLAN.md`: **Phase 3 Pair B** —
(a) the game's first SFX system and (b) enemy-explosion variety.
Nothing else (process ruling, decision #41c: one step per gauntlet, its
own branch and PR).

- **Branch:** `claude/gauntlet-pair-b-sfx-7oxdrc`
- **Base commit:** `73a86c2` — the tip of `claude/game-feedback-plan-UN3MV`
  (plan-doc commit recording decision #43).
- **Started:** 2026-08-03
- **Never pushed to:** `claude/game-feedback-plan-UN3MV`, `main`.
- **PR target:** `claude/gauntlet-pair-b-sfx-7oxdrc` → `claude/game-feedback-plan-UN3MV`.

`docs/GAME_FEEDBACK_PLAN.md` and `docs/PARKING_LOT.md` are owned by the
orchestration session and are NOT edited here.

### Parallel-work constraint (decision #43)

Pair A (death screen + stat legibility) is being developed by the user
**concurrently** on another branch, and it owns UIOverlay/EngineStats.
So this session's UI footprint is deliberately **one row** — master
volume + mute in the pause menu — and one EngineStats field to carry it.
Before the PR opens, this branch rebases onto the latest plan-branch tip
and re-runs its smokes.

### Design anchors (locked upstream, not relitigated)

- **`docs/SFX_INVENTORY.md` is the deliverable** (decision #43), and it
  ships FIRST so the user can start generating externally while the
  later milestones run.
- **Drafts are procedural.** WebAudio synthesis, no audio asset files —
  `scripts/inline-build.mjs` and the standalone build stay untouched, and
  real assets drop in later keyed by the same inventory id.
- **Ids are the contract.** `AudioSystem.play(id)` at the trigger site;
  swapping a synth for an asset never touches a call site.
- **Existing machinery only.** Explosion variety uses the EXISTING
  ParticleSystem (per-class palettes/shapes/counts), respects
  `MAX_PARTICLES` and the PR #69 trimmed-burst budgets, and caches any
  gradient on the entity (the `enemyBodyGrad` pattern).

---

## Milestone checklist

- [x] **B1** — `docs/SFX_INVENTORY.md`: every player-audible action with
      per-effect generation parameters.
- [x] **B2** — `engine/systems/AudioSystem.ts`: gesture-unlocked WebAudio
      manager, procedural registry, polyphony caps, positional pan.
- [x] **B3** — Wire the inventory tier by tier + the one pause-menu audio
      row.
- [x] **B4** — Explosion variety per entity class on the existing
      ParticleSystem, paired to inventory SFX ids.
- [x] **B5** — Validation: perf A/B, phone-scale check, full-loop smoke,
      rebase, CLAUDE.md sync, completion summary.

---

## COMPLETION SUMMARY

**All five milestones complete.** `npm run build` green; `npx tsc
--noEmit` shows only the two errors already present on the base commit
(`constants.ts` `defaultOutcome`, `ShardSystem.ts`
`requireSizeDeltaFraction` — confirmed by stashing and re-running).
Four headless Playwright suites, **113 assertions** (B2 26, B3 32, B4 28,
B5 27), green across consecutive full rounds.

The plan branch had NOT moved from the base commit (`73a86c2`) when the
PR was opened, so the required rebase was a no-op; the smokes were
re-run against the final tree regardless.

### What shipped

**`docs/SFX_INVENTORY.md` — the deliverable.** 81 entries across
weapons, enemy weapons, impacts, destruction, movement/material,
pickups, station, portals, waves, roamers, status effects and UI.  Each
carries a stable id, its trigger site, a mix tier, target duration,
sonic character in words, frequency range + envelope, variation scheme,
polyphony cap + throttle rule, relative mix level, and positional vs
UI-flat.  §9 ranks which drafts are worth an external generation budget.
It is a generation brief AND the implementation map, and it is
**enforced**: a smoke parses the document and asserts registry↔document
parity in both directions.

**`AudioSystem` — event-driven, gesture-unlocked, torus-correct.**  The
AudioContext is built on the first user gesture (own capture-phase
window listeners, because InputSystem only sees canvas-targeted events
and would miss the menu tap that is usually a phone session's first
gesture).  Nothing audio-related runs per frame beyond `setListener`
and `setActive`.  Three mechanisms keep a mass-death frame sane: per-id
polyphony caps, a retrigger window that COLLAPSES simultaneous triggers
while bumping the survivor's gain with saturation, and a global ceiling
that thins tier 3 then tier 2 while tier 1 always plays.  A frozen sim
silences the world but not the UI.

**`SfxRegistry` — 81 procedural drafts.**  No audio asset files, so the
standalone build pipeline is untouched and real assets drop in later by
id without any call site changing.

**Wiring** across GameEngine / PhysicsSystem / WeaponSystem /
ShardSystem / DropSystem, riding existing dispatch where one existed
(`handleProjectileHit`, `handleEntityDeath`) and one generic `sfx` sink
per system where none did.  One pause-menu row: mute, slider, readout.

**`EXPLOSION_PROFILES` — classes that die differently.**  Before this,
every enemy death was the same burst tinted by `entity.color`.  Now ring
shape, debris count/speed/size/lifetime, an accent HUE and the screen
punch all vary per class, and `deathFx()` is the SINGLE classification
returning both the profile and the sound so they cannot drift apart.

### Measured results

- **Audio is free.**  `play()` costs **0.1–0.3 µs** per call (1000 calls
  in 0.1–0.3 ms).  In a same-harness A/B on a heavy scene (50 live
  enemies, 4 mass deaths per frame, 150 frames, fresh field per run),
  the UNMUTED median frame time came in **below** the muted baseline on
  every run (−3.4%, −7.7%, −11.6%) — i.e. the difference is lost in
  noise, with muted-run drift of 2.6–11.9% bounding that noise.
- **Explosion budget spent differently, not more.**  Particles per
  death: gnat 7 (down from ~15), standard 16 (the same envelope as the
  PR #69 trimmed burst it replaces), bubble 17, heavy 22, bomber 29.
  The class that dies in BULK got cheaper.  `MAX_PARTICLES` still holds
  after 60 simultaneous deaths.
- **Class differentiation is real, not nominal.**  Heavy hulls throw
  slower/bigger/longer-lived debris than standard kills; bombers throw
  the fastest; bubbles the slowest with no hot core.  Materials: glass
  debris averages 7.5 units/step, metal 6.0, rock 2.9.
- **Phone scale.**  At 390×844 the audio row fits inside the viewport,
  the mute button is a 36×36 touch target, the slider is 194 px wide,
  the pause menu does not scroll horizontally, and tapping mute toggles
  the mixer.

---

## FOR-USER-REVIEW

0. **iOS SILENT-SWITCH TRADEOFF — decide this one.** The no-sound-on-iPhone
   fix claims the `playback` audio session. That is what makes the game
   audible with the ring/silent switch on, but on iOS `playback` also
   **stops whatever the user was already listening to** (music, a podcast).
   The alternative, `ambient`, mixes politely with other audio but is
   silenced by the mute switch — i.e. the bug. There is no iOS category
   that both ignores the mute switch and mixes. I chose audible-by-default
   because "no sound" was the reported problem; if you would rather the
   game never interrupt music, the change is one string in
   `claimPlaybackSession`.

1. **Where to spend an external generation budget: `docs/SFX_INVENTORY.md`
   §9.** Ranked by (importance × how badly synthesis handles it), not by
   importance alone. Top of the list: `destroy.player` (the run ends on
   it), `snitch.catch` (the game's best moment, and a cascade chime is
   what additive synthesis does worst), `boss.death` / `boss.intro`,
   `dragon.arrive` (a creature roar has formant structure oscillators
   cannot fake), `destroy.tile.glass` (the most-heard destruction sound),
   the Cannon and Shotgun, and `move.thrust` (a loop that plays for a
   whole session — the bar there is *tolerability*).

2. **Volume and mute are IN-MEMORY only.** This project keeps no state
   across reloads (CLAUDE.md §1), so the preference resets with the
   page. Making it stick is a `localStorage` decision — a durability
   choice for you, not one this session should take unilaterally.

3. **Every number in this pass is PROVISIONAL.** All of
   `AUDIO_CONSTANTS` (voice ceilings 24/20/14, collapse bump 1.22
   saturating at 2.2, near 420 / far 2600 / pan-width 900 world units,
   default volume 0.7), all 11 `EXPLOSION_PROFILES`, the three
   call-site constants (`SALVAGE_STREAK_WINDOW_MS` 1500,
   `SALVAGE_STREAK_MAX` 11, `SNITCH_NEAR_RANGE` 1200), and every
   synthesis parameter in the registry. They were reasoned about against
   the mix-budget model in inventory §2, not listened to on your
   hardware. **Expect to move mix levels first** — the relative levels
   are the designed part, the absolute ones are a starting point.

4. **Three judgment calls worth a second opinion:**
   - **Plastic and nebula still make NO death particles.** Both were
     deliberate existing looks (plastic has never sparked; nebulae fade
     via `mergeFadeTimer`), so I treated "the material that makes no
     spark" as differentiation rather than an omission to fix. If you
     want them differentiated visually too, that is a one-row change
     each.
   - **A refused outfit move now BUZZES** (`poi.reject` on the
     drydock guard). It is the most common thing a player tries and
     cannot do, so it fires often while the adjacency rules are being
     learned. If it grates, the fix is the 250 ms throttle or the 0.38
     mix level, not removing it.
   - **The snitch has a proximity SHIMMER loop** audible within 1200
     units. It is pure carrot and it is quiet (mix 0.18), but it is also
     the only always-on world loop besides thrust and the portal hum. If
     three ambient loops is one too many, the snitch is the one to cut.

5. **Enemy fire is voiced APART from player fire** (darker, duller).
   That was a deliberate legibility call — incoming vs outgoing is
   information the player acts on, and a busy screen loses it visually.
   Worth confirming it reads that way to you in play.

6. **One transient smoke failure worth knowing about.** During a
   back-to-back run of all four suites, B5 failed one assertion once
   (the perf A/B's baseline-stability check) under container load. Three
   consecutive isolated re-runs were 27/27 with drift 2.6–11.9% against
   a 25% threshold. The conclusive evidence for "audio is free" is the
   microbenchmark, which is not load-sensitive.

---

## Retarget + AUDIO_PLAN reconciliation (2026-08-08, plan decision #45a)

The plan branch `claude/game-feedback-plan-UN3MV` merged to main (PR #51)
and was retired.  This branch was rebased onto
**`claude/plan-completion`** (cut from main) and PR #79 retargeted there.

**Rebase.** 11 commits replayed; five conflicts, all mechanical and all
resolved by KEEPING BOTH sides:

| File | Conflict | Resolution |
|---|---|---|
| `engine/GameEngine.ts` | `transitionToMap` gained a `descend` option upstream | upstream signature + this branch's doc comment |
| `engine/GameEngine.ts` | constants import — upstream renamed `WEAPON_WEIGHT`→`SHIP_WEIGHT` and added `UI_CONSTANTS` / `HUB_PORTAL_SITES` / `STAGE_WAVE_COUNT` | upstream's import line, with `AUDIO_CONSTANTS` / `EXPLOSION_PROFILES` / `ExplosionProfile` grafted on |
| `engine/GameEngine.ts` | death branch — upstream added a `> 0` re-fire guard (the sim keeps running after death now) | guard kept AND the engine-loop cut kept |
| `CLAUDE.md` | UIOverlay description — Pair A added the death/run-summary screen | both listed |

**Validation after rebase.** `npm run build` green.  `npx tsc --noEmit`
produces the EXACT SAME six errors as `origin/claude/plan-completion`
does on a clean worktree — verified by diffing the two error sets, which
are identical.  This branch introduces no type errors.  All six smoke
suites green (B2 28, B3 49, B4 28, B5 27, iOS 12, tone 21 = **165**).
B5's perf A/B failed once at +23% and passed at +6.7% / +1.4% on
immediate re-runs; the `play()` microbenchmark held at 0.1–0.2 µs, which
is the load-insensitive evidence.

### Reconciliation with `docs/AUDIO_PLAN.md`

`AUDIO_PLAN.md` arrived via PR #78, written independently in the Pair A
session before decision #43 made `SFX_INVENTORY.md` the Pair B
deliverable.  Its own header already states the division: **SFX_INVENTORY
is the one that ships** (it carries the per-effect generation parameters),
and AUDIO_PLAN is read for what it adds on top — §2's hard constraints,
§3's architecture, §5's music beds, §6's open decisions.  That division
is adopted unchanged.  AUDIO_PLAN's §2 is treated as **architecture
requirements**, not suggestions.  Status of each:

| AUDIO_PLAN requirement | Status | Where |
|---|---|---|
| **§2a** standalone-build fork | **SIDESTEPPED, not resolved** — see below | — |
| **§2b** torus, not `PannerNode` Euclidean space | **MET** | `AudioSystem.play`/`loop` use `wrapDeltaX`/`wrapDeltaY`, listener-first, and pan via `StereoPannerNode` on the wrapped delta. An inverted-pan bug from getting the argument order backwards was caught by smoke and is now called out in CLAUDE.md §8. |
| **§2c** voice pool + hard cap, FIFO/priority eviction | **MET** | `AUDIO_CONSTANTS.MAX_VOICES` (24) with tier thinning: tier 3 stops being admitted at 14, tier 2 at 20, tier 1 always plays. |
| **§2c** distance culling — no voice allocated beyond audible radius | **MET** | `attenuation() <= 0` drops before any node is created; positional LOOPS out of earshot are treated as off so they hold no oscillators. |
| **§2c** same-step coalescing — N identical cues become one with a level bump | **MET** | Per-id retrigger window with `collapse`, which bumps the live voice's gain with saturation. Exactly the "shard shatters and gnat pops" case the plan names. |
| **§2c** per-cue cooldowns | **MET** | `SfxDef.minInterval`, per id, transcribed from the inventory. |
| **§2d** iOS gesture unlock | **MET, and extended** | Own capture-phase window listeners (NOT `once`), plus the ring/silent-switch fix (`navigator.audioSession` → `playback`, with a silent-WAV element fallback) and recovery from iOS's non-standard `'interrupted'` state. The plan did not anticipate the silent switch; it was the first thing playtest hit. |
| **§2e** trigger from the sim, SCHEDULE on the audio clock | **PARTIAL** | Cues are triggered from sim paths and scheduled against `ctx.currentTime` at call time. The retrigger collapse absorbs the machine-gun case the plan is worried about, but there is no explicit per-FRAME schedule time, so several sim steps in one rAF frame can schedule a few ms apart. Listed as remaining work. |
| **§3** not via `EngineStats` | **MET** | Cues fire from `handleEntityDeath`, the PhysicsSystem damage paths, `WeaponSystem`, `ShardSystem`, `transitionToMap`, `dockAtStation`. `EngineStats.audio` carries ONLY the settings-row state (volume / muted / context state), which is UI data and belongs there. |
| **§3** bus structure (music / sfx / ui / ambience) + ducking | **NOT DONE** | One master gain today. Remaining work. |
| **§5** music beds, music director | **NOT STARTED** | Out of scope as this pass ran; the inventory covers SFX only. |

**§2a is the one that matters for what happens next.**  The plan calls the
standalone-build fork "a real fork, not a detail" and the decision that
should be settled first, because it sets the asset budget.  This
implementation makes it *temporarily* moot: every sound is PROCEDURAL, so
there are zero audio assets, `scripts/inline-build.mjs` is untouched, and
the standalone build is a faithful copy of the game.  That is not the same
as answering the question — AUDIO_PLAN §1's stated direction is **sampled,
AAA**, and the moment a real asset lands the fork is live again.

What this pass contributes to that decision is the **migration path**: the
inventory id is the contract, and a synth draft is replaced by a sample by
re-registering the same id in `SfxRegistry` — no trigger site changes.
So the fork can be decided later without re-plumbing, and inventory §9
ranks which cues are worth an external generation budget first.  It
remains OPEN and is the first thing the next person should raise with the
repo owner.

**§6 open decisions, as they now stand:** (1) standalone fork — still
open, above.  (4) HRTF vs equal-power — decided as equal-power
`StereoPannerNode` + linear distance attenuation, on the plan's own
reasoning that HRTF is indistinguishable for a top-down 2D game and costs
per voice.  (5) listener at ship or camera — decided as **camera**
(`audio.setListener(camera.position)`).  (6) settings home — done, one
row in the pause menu; per-bus sliders await the bus structure.

---

## Per-iteration log

### Iteration 0 — B1: the SFX inventory

**Done.** `docs/SFX_INVENTORY.md`, ~85 entries across 8 categories, each
with id / trigger site / tier / duration / character / frequency +
envelope / variation scheme / polyphony + throttle / mix level /
positional flag.

**How the sweep was done.** Read the engine's dispatch points rather
than grepping for nouns, so the inventory maps to real hooks:
`GameEngine.handleEntityDeath` (every destruction row),
`GameEngine.handleProjectileHit` (almost every impact row — it already
switches on `target.type` and shard variant),
`WeaponSystem.firePlayerWeapon` / `tickPlayerBurst` /
`updateEnemyShooting` (weapons), `updateGameLogic`'s drop-collection
scan (pickups), `updateInteractables` + the commerce methods (POI and
portals), `WaveSystem.startWave` / `endWave` (waves),
`applyBossPhase` / `payBossBounty` (bosses), and the roamer lifecycles
(`updateSnitch`, `updateDragons`, `updateRivals`, `updateBubbles`).

**DECISIONS TAKEN**

1. **Id scheme `category.subject.action`.**
   *Alternatives:* flat `SCREAMING_SNAKE` constants (matches
   `constants.ts` style); a TypeScript enum.
   *Chosen because* the ids are a data contract shared with a document
   and, later, with asset filenames — a dotted string namespace reads
   correctly in all three places and lets the registry be a plain
   `Record<string, …>`. An enum would force every future asset drop-in
   to touch a type.

2. **Three mix tiers, not per-sound priority numbers.**
   *Alternatives:* a 0–100 priority integer per sound; no priority at
   all (pure polyphony caps).
   *Chosen because* the only decision the manager actually has to make
   under contention is *which class of sound to thin first*, and three
   buckets express that with no tuning surface. A per-sound integer
   invites endless fiddling for no audible gain.

3. **Collapse-with-gain-bump (`+gain`) as the mass-event rule.**
   *Alternatives:* hard-drop the extra triggers (thin and weak — 40
   shard breaks would sound like one); play them all (400 voices,
   distortion).
   *Chosen because* it makes a mass death sound *heavier* rather than
   *louder or thinner*, which is the actual perceptual goal, and it
   costs one number per id. Flagged on every row that can fire in bulk.

4. **Enemy weapons voiced apart from player weapons.**
   *Alternative:* reuse the player's family sounds for enemies (cheaper,
   fewer entries).
   *Chosen because* incoming-vs-outgoing is information the player acts
   on, and it is exactly the information a busy screen loses visually.
   Darker/duller enemy voices give it back for free.

5. **`portal.transit` covers arrival too — no separate arrival cue.**
   *Alternative:* `portal.transit` + `portal.arrive` as two ids fired
   either side of `transitionToMap`.
   *Chosen because* the map swap is instantaneous and in-place; two
   sounds across a zero-length gap just phase against each other. The
   single sound has the silence and the arrival bloom built into its
   envelope.

6. **Pickup pitch climbs on a streak.** `pickup.salvage` steps up a
   semitone per pickup within 1.5 s, resetting after.
   *Alternative:* fixed pitch with jitter.
   *Chosen because* salvage arrives in magnetised clusters — a fixed
   pitch reads as a machine-gun rattle, a climbing scale reads as a
   reward. Same trick the drop-merge economy already implies visually.
   **Provisional:** the 1.5 s window and one-semitone step are invented
   numbers.

7. **Charge is a tracked loop plus a discrete "ready" ping**, not a
   one-shot at release.
   *Alternative:* one sound at the charged shot only.
   *Chosen because* `player.chargeProgress` already exists for the HUD
   ring; tracking it in audio means the player can charge without
   watching their own ship, which is the whole point of the mechanic.

8. **`move.thrust` is specified to be deliberately bland.**
   Recorded as a design constraint in the row itself because it is the
   one loop that plays for an entire session, and "interesting" is a
   liability there.

9. **§9 "where to spend budget" ranks by (importance × synthesis
   weakness), not by importance alone.** Weapon fire is heard far more
   than the death sound but synthesises acceptably; a creature roar does
   not. The user asked for the inventory to double as a generation
   brief, so the brief has to say where generation actually helps.

**Numbers invented in this milestone** (all provisional, all in the doc):
every duration, frequency, envelope, variation percentage, polyphony
cap, retrigger window and mix level. They are internally consistent
against the tier/frequency budget in §2, not measured.

**No code touched.** Build gate not applicable to a docs-only milestone;
`npm run build` still run as a guard that the tree is clean.

---

### Iteration 2 — B3: wire the inventory + the audio row

**Done.** The full `SfxRegistry` (all 81 inventory ids), trigger wiring
across GameEngine / PhysicsSystem / WeaponSystem / ShardSystem /
DropSystem, and the one pause-menu audio row.  `npm run build` green;
B3 smoke **31/31**, B2 re-run **26/26**.

**Registry ↔ inventory parity is ASSERTED, not assumed.** The smoke
parses `docs/SFX_INVENTORY.md` for every id in the tables' first column
and checks two directions: every documented id is registered, AND
`registeredCount` equals the documented count (no undocumented extras).
That is what keeps the document a real source of truth rather than a
stale sibling of the code.

**DECISIONS TAKEN**

16. **One generic `sfx` hook per system, not one callback per sound.**
    `PhysicsSystem.sfx`, `ShardSystem.sfx`, `DropSystem.sfx` and
    `WeaponSystem.onEnemyFire` are settable fields assigned once in the
    GameEngine constructor.
    *Alternatives:* thread more callbacks through `physics.update(...)`
    alongside `onDamage`/`onDeath`/`onShake`/`onHit`; import the audio
    manager directly into each system.
    *Chosen because* the update signature is already four callbacks wide
    and every new sound would widen it further, while a direct import
    would put audio state inside a physics system.  A settable field
    matches the existing `setPhysics` / `setRegenAdapter` /
    `setTileFormedHandler` / `traitsEnabled` style, and adding a
    physics-side sound is now a call rather than a signature change.

17. **Impacts and destruction ride the EXISTING dispatch.**
    `handleProjectileHit` already switches on target class and shard
    variant for its particle layer; `handleEntityDeath` already
    dispatches by entity class.  The sounds hang off those same
    branches.
    *Alternative:* a separate audio pass over the frame's events.
    *Chosen because* audio and visual then land on the same frame from
    the same branch by construction — they cannot drift apart — which is
    also what B4 needs when it differentiates the explosion visuals.

18. **One `MATERIAL_SFX` table drives BOTH chip and break.** A material
    can never sound like glass when shot and like rock when destroyed,
    because both ids are built from the same row.

19. **Unknown enemy archetypes fall back to `destroy.enemy.standard`,
    and `poise` picks the heavy voice.**
    *Alternative:* an exhaustive subtype→sound map.
    *Chosen because* an exhaustive map goes stale silently — a new
    archetype would be MUTE until someone noticed.  Falling back means a
    new enemy is audible on day one, and reading the `poise` trait for
    "heavy" beats maintaining a second list that drifts from the traits
    it duplicates.

20. **A chain, a fan, and a shatter each get ONE trigger.** The lightning
    chain fires `impact.lightning.arc` once at the impact rather than
    per arc; the Bulwark's 3-shot fan is one `enemy.shot.fan`; a
    40-fragment shatter collapses into one bumped voice.
    *Chosen because* each is ONE gesture visually, and the collapse rule
    already makes bulk read as heavier rather than louder.

21. **`portal.open` is fired inside `openPortal` itself**, which the
    player's own transit also calls (twice).
    *Alternative:* fire it only at roamer arrival/departure sites.
    *Chosen because* every rift in the game routes through `openPortal`,
    so one call site covers dragons, rivals, bosses and any future
    roamer for free — and the id's 400 ms retrigger window collapses the
    player's own two calls into the `portal.transit` voice rather than
    stacking a third layer on it.

22. **A refused outfit move is audible.** `moveModule` plays
    `poi.reject` on the drydock guard and on a failed internal move.
    *Chosen because* outfitting away from a drydock is the single most
    common thing a player tries and cannot do, and a silent `return
    false` is indistinguishable from a broken button.

23. **The UI footprint is exactly one strip** — a mute button, a range
    slider and a percentage readout, inserted between the shop hint and
    the map switcher in the pause menu, plus `EngineStats.audio` and two
    props.  Menu-level sounds (`ui.confirm` / `ui.back`) are fired from
    `startGame` / `pauseGame` / `resumeGame` on the ENGINE side rather
    than from UIOverlay handlers, specifically to keep the overlay diff
    minimal while Pair A is working it (decision #43).

24. **`startGame()` also calls `audio.unlock()`**, on top of the window
    listeners, because it is a user gesture by construction and belt-and-
    braces costs one idempotent call.

**Numbers invented in this milestone:** `SALVAGE_STREAK_WINDOW_MS`
(1500), `SALVAGE_STREAK_MAX` (11 semitones), `SNITCH_NEAR_RANGE` (1200
world units), and every synthesis parameter in the ~70 new registry
entries.  Provisional.

**Smoke coverage (31 assertions):** registry↔document parity in both
directions; all seven player weapons fire their own voice through the
real click path; dragon arrival, rift open, boss intro and rival warp-in;
corrosion, EMP and the EMP dead-air loop; the thrust loop rising and
falling with throttle; dock / purchase / undock all audible WHILE THE SIM
IS FROZEN; a refused outfit move playing the reject; portal transit;
volume set + clamp and mute toggling both ways; `EngineStats.audio`
populated; the slider and mute button actually present in the pause menu;
and the global voice ceiling holding during live play.

---

### Iteration 3 — B4: explosion variety

**Done.** `EXPLOSION_PROFILES` (11 profiles) in `constants.ts`, a single
`deathFx()` classification returning BOTH the visual profile and the
sound, and `playDeathFx()` rendering a burst from a profile on the
EXISTING ParticleSystem.  `npm run build` green; `npx tsc --noEmit`
shows only the two errors already on the base commit
(`constants.ts` `defaultOutcome`, `ShardSystem` `requireSizeDeltaFraction`
— confirmed by stashing and re-running).  B4 smoke **28/28**.

**What was actually wrong before.** Every enemy death ran the same code
tinted by `entity.color`, with exactly two special cases (gnats got a
lighter burst, everything else the standard one).  A gnat, a tank and a
bomber were the same event at three sizes.  A profile now varies the
four things the eye reads: ring shape, debris count/speed/size/lifetime,
an accent HUE mixed into the burst, and the screen punch.

**Measured result** (from the smoke, particles per death): gnat 7,
standard 16, bubble 17, heavy 22, bomber 29 — and the relationships hold
in the right directions: the heavy hull throws slower, bigger,
longer-lived debris than a standard kill; the bomber throws the fastest;
the bubble is the slowest with the fattest droplets and no hot core at
all.  Materials: glass debris averages 7.5 units/step, metal 6.0, rock
2.9 — glass shatters, rock crumbles, metal sits between with a spark
layer.

**DECISIONS TAKEN**

25. **One classification, two outputs.** `deathFx(entity)` returns
    `{ fx, sfx }` and both the burst and the sound come from it.
    *Alternative:* keep the separate `deathSfxId()` from B3 and add a
    parallel profile lookup.
    *Chosen because* B4's brief is that audio and visual land as ONE
    beat, and two lookups over the same entity is exactly how they drift
    apart later.  The profile table even carries the `sfx` id itself, so
    a new class is one row.

26. **The particle budget is spent DIFFERENTLY, not spent MORE.**
    STANDARD lands on 16 particles — the same envelope as the 15–18 the
    PR #69 trimmed burst used — and the gnat DROPPED from ~15 to 7.
    Only the three rare deaths (heavy 22, bomber 29, boss 34) spend
    more.
    *Alternative:* scale every profile up for impact.
    *Chosen because* the classes that spend more are the ones that
    happen once in a while, and the class that happens in BULK now costs
    less than before — so the worst case (a flock popping) improved.
    `MAX_PARTICLES` is still the backstop and the smoke asserts it holds
    after 60 simultaneous deaths.

27. **Plastic and nebula keep their deliberate NON-burst.** Plastic has
    never sparked on death and nebulae fade out through `mergeFadeTimer`
    in the renderer.
    *Alternative:* give every material a burst for consistency.
    *Chosen because* both are existing deliberate looks, and "the
    material that makes no spark" is itself differentiation.  They
    resolve to a null profile rather than being special-cased at the
    call site.

28. **The accent layer is what makes a class read by HUE.** Amber embers
    on a heavy hull, orange on a bomber, cyan droplets on a bubble, the
    player's own cyan on a rival.
    *Chosen because* tinting one burst by body colour cannot
    differentiate classes that happen to share a palette, and hue is the
    cheapest signal the eye picks up in peripheral vision.

29. **A boss dies in its PHASE colour**, since the phase tint is already
    on `entity.color` when it dies — so the last thing you see is the
    state you beat.  The `payBossBounty` payoff beat layers on top; the
    profile deliberately carries no `sfx` for bosses so the two do not
    both fire a death sound.

30. **No gradients were added.** The brief's caching requirement
    (`enemyBodyGrad` pattern) is satisfied by construction: profiles are
    plain numbers and colour strings handed to the existing
    `ParticleSystem.spawn`, so there is nothing per-frame to cache.

**Numbers invented in this milestone:** every field of all 11 profiles.
Provisional — the ratios between profiles are the designed part; the
absolute values are a starting point.

**Smoke coverage (28 assertions):** every class produces a burst; gnat
cheaper than standard; ring counts per class (gnat and bubble have no
white core, standard does); heavy slower/bigger/longer-lived than
standard; bomber fastest; bubble slowest; accent classes read in ≥2 hues
while a plain kill stays two-tone; the standard burst inside the trimmed
budget and the gnat burst below its old cost; burst-and-SFX firing
together for four classes; `MAX_PARTICLES` holding after 60 simultaneous
deaths; and glass > metal > rock on debris speed across three showcase
maps.

---

### Iteration 4 — B5: validation

**Done.** Perf A/B, phone-scale check, full-loop smoke, rebase check,
CLAUDE.md sync, and this summary.  B5 smoke **27/27**, and all four
suites green across consecutive rounds (**113 assertions** total).

**DECISIONS TAKEN**

31. **The perf harness was REBUILT after its first result was
    unusable.** The first cut reported a 34% median regression — but it
    ran the muted and unmuted passes over a SHARED, GROWING field
    (entities accumulated between runs, so the later run was strictly
    heavier) and compared a fixed WALL-CLOCK window with unequal frame
    counts.  The rebuilt harness restarts the field before each run,
    measures a fixed FRAME COUNT, holds the population stable by
    replacing each kill 1:1, and runs muted → unmuted → muted again so
    container drift is visible rather than assumed away.  With those
    fixed, the unmuted run measures BELOW the muted baseline on every
    round.
    *Recorded because* the first number was wrong in a way that would
    have looked like a real regression, and the fix was the harness.

32. **The load-bearing perf evidence is the MICROBENCHMARK.**
    `play()` at 0.1–0.3 µs is not load-sensitive and does not depend on
    a noisy container; the frame-time A/B corroborates it.  A
    frame-time comparison alone would have been the weaker claim.

33. **One B5 assertion was WRONG and was corrected, not tuned away.**
    "Mass deaths are collapsed/dropped rather than all voiced" failed
    because headless frames here run ~300 ms — longer than every
    retrigger window in the table — so most triggers legitimately get
    their own voice.  Collapse is a WITHIN-ONE-STEP mechanism and this
    harness has no dense steps.  Replaced with what the scene can
    actually show (suppression engages; peak concurrency stays low),
    with a comment pointing at B2's 200-trigger burst as the direct
    proof of the collapse itself.

34. **A too-weak B3 assertion was found and tightened.** The station
    test read `!bought || purchase >= 1`, which passed VACUOUSLY because
    the purchase was silently failing: `debugTeleportToStation` lands at
    the HOME station first, which is drydock-only, and the module id was
    wrong.  Now the smoke cycles until a station with a ship shop is in
    range and asserts the purchase actually succeeded.
    *Recorded because* a test that cannot fail is worse than no test,
    and this one hid a real gap in coverage for two milestones.

35. **CLAUDE.md was synced in ONE commit at B5 rather than per
    milestone.** The iteration discipline asks for same-commit sync; the
    milestone queue schedules "CLAUDE.md final sync" in B5.  I followed
    the queue.  Flagging the tension rather than leaving it implicit.

**Rebase.** `origin/claude/game-feedback-plan-UN3MV` was still at
`73a86c2` — the base commit — so there was nothing to rebase onto.  The
smokes were re-run against the final tree anyway.

---

## Handoff (final entry)

**`scripts/smoke/` was committed.** The six suites had lived only in the
session's scratch directory — 165 assertions that nothing in the repo
could re-run. They are now plain Node scripts under `scripts/smoke/`
with a README, parameterised by two env vars (`SMOKE_URL`,
`CHROME_PATH`) instead of the hardcoded paths they carried.
*Recorded because* this is a scope call: the project has no test runner
and roadmap item 5b (test-harness bootstrap, parallel session) may
absorb or relocate them. Committing them anyway is the cheaper mistake —
an unused directory is recoverable, re-deriving 165 assertions is not.

**`docs/HANDOFF_PR79.md` was written** for whoever takes PR #79 next:
what the PR is, the reading order, branch state with commit ids, the
remaining work as a checklist with files and a validation step each, the
working agreement, and what audio validation is possible headless versus
what needs a human with headphones. It is deliberately harness-generic —
no tooling assumptions, so it reads the same to a person or to another
agent.

**The milestone queue stops here.** B1–B5 are complete, playtest feedback
through five rounds is folded in, and the branch is retargeted onto
`claude/plan-completion`. Everything still open is in the handoff's §4
and in the FOR-USER-REVIEW block at the top of this file.
