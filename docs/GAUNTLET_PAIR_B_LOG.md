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
- [ ] **B2** — `engine/systems/AudioSystem.ts`: gesture-unlocked WebAudio
      manager, procedural registry, polyphony caps, positional pan.
- [ ] **B3** — Wire the inventory tier by tier + the one pause-menu audio
      row.
- [ ] **B4** — Explosion variety per entity class on the existing
      ParticleSystem, paired to inventory SFX ids.
- [ ] **B5** — Validation: perf A/B, phone-scale check, full-loop smoke,
      rebase, CLAUDE.md sync, completion summary.

---

## FOR-USER-REVIEW

*(Consolidated at the top on completion. Items accumulate here as they
arise; nothing here was silently decided.)*

- **Volume preference is in-memory only.** Durable storage is fenced for
  this project (no persistence beyond in-memory run state, CLAUDE.md §1),
  so master volume and mute reset on reload. If you want them to stick,
  that is a `localStorage` decision for you to make, not one this session
  should take unilaterally.
- **Every number in `docs/SFX_INVENTORY.md` is provisional.** Durations,
  frequencies, envelopes and mix levels were derived from the trigger
  sites and mix-budget reasoning, not from listening on your hardware.
  Expect to move mix levels in particular.
- **§9 of the inventory** ranks the drafts most worth an external
  generation budget. That list is the answer to "where do I spend money
  on sound".

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
