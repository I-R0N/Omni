# Gauntlet Log — completing the game-feedback plan

Ledger for the LOOPED autonomous "gauntlet" session that closes out the
remaining roadmap of `docs/GAME_FEEDBACK_PLAN.md` on a sandbox branch.

- **Branch:** `claude/gauntlet-completion-wq2uv2`
- **Base commit:** `8c68285` — the tip of `claude/game-feedback-plan-UN3MV`
  after the portals PR #74 merge.
- **Started:** 2026-08-01
- **Never pushed to:** `claude/game-feedback-plan-UN3MV`, `main`.

This file is the gauntlet's ledger. `docs/GAME_FEEDBACK_PLAN.md` and
`docs/PARKING_LOT.md` are owned by the orchestration session and are NOT
edited here.

---

## Milestone queue

- [x] **M1** — (h) Bosses: framework + first boss (+ `evasive` trait)
- [x] **M2** — (h) Bosses: second boss + `front-shield` / `regen` traits
- [x] **M3** — Phase 3 Pair A: death/completion screen + stat legibility
- [x] **M4** — Phase 3 Pair B: SFX, then explosion variety
- [x] **M5** — Phase 3 Pair C: controller/joystick, then menu help
- [x] **M6** — Polish batch: palette residual + map composition + minimap
      faithfulness + NPC station traffic (the optional item — NOT cut)
- [x] **M7** — Economy & progression tuning pass (incl. salvage death penalty)
- [x] **M8** — Performance pass (measure first, PR #69/#70 methodology)
- [ ] **M9** — Visual quality pass
- [ ] **M10** — Mechanical quality pass + final validation

---

## Iteration log

_(newest last)_

### Iteration 0 — 2026-08-01 — setup

Created this log. Re-grounded on `docs/GAME_FEEDBACK_PLAN.md` (completion
roadmap + decisions #36–#40) and `docs/WEAPONS_AMMO_PLAN.md` §6–§7.
Confirmed the branch is at the base commit with no drift, `npm install`
clean, `npm run build` green. Playwright is available globally
(`/opt/node22/lib/node_modules/playwright`) with Chromium at
`/opt/pw-browsers` — smokes drive `vite preview` headlessly.

### Iteration 1 — 2026-08-01 — M1: boss framework + REAVER

**Shipped** (commit `1097082`):

- `BOSS_CONSTANTS` / `BOSS_DEFS` / `BOSS_ROTATION` / `isBossWave()` /
  `bossForWave()` / `BOSS_WEAPONS` in `constants.ts`; `BossPhaseDef` /
  `BossDef` / `EnemyTraitSet` / `SpawnerConfig` types.
- WaveSystem: boss-wave cadence (every 5th wave), `spawnBoss` +
  `findSpawnPoint` extraction, `onBossSpawn` context hook, boss stamping in
  `buildEnemy`.
- GameEngine: `updateBosses` / `applyBossPhase` / `payBossBounty` /
  `bossStatsSnapshot` / `handleBossSpawn` / `debugSpawnBoss` / `modulePrice`
  (the boss shop discount).
- AISystem: `applyEvasiveDodge` — the `evasive` trait as a real dodge.
- WeaponSystem: per-entity `weaponOverride` merge.
- RenderSystem: `'talon'` hull + the phase-coloured boss aura ring.
- UIOverlay: boss HUD bar (name, phase pips, health, shield strip) + the
  DBG "Bosses" section; `App.tsx` prop wiring + the `__omniEngine` /
  `__omniStats` debug handles.
- CLAUDE.md updated in the same commit (§4 entity fields, §5 constants,
  §8 debug handles).

**Validation**: `npm run build` green; `npx tsc --noEmit` shows only the
two PRE-EXISTING errors (`constants.ts` `defaultOutcome`,
`ShardSystem.ts` `requireSizeDeltaFraction` — both present on the base
commit, untouched here).  Headless Playwright smoke: 25 assertions, all
pass — spawn, phase 0/1/2 stamping (shield raised then dropped, evasion
traded for armor, weapon override, escort brood), the evasive juke
firing on a straight shot and NOT on a homing one, the HUD readout, the
model-(d) payout with no weapon unlocks, and the wave-5 capstone cadence.

**Watches**: boss HP (130 base) and the payout numbers are first-pass —
they get tuned against real income in M7.  The Reaver's phase-3 armor
(`chipThreshold` 6) is the same threshold as the Tank; if the Tank's
number moves in M7 the boss should move with it.

### Iteration 2 — 2026-08-01 — M2: BASTION + front-shield / regen

**Shipped** (commit `22cf376`):

- `EnemySubtype.BOSS_SIEGE` + the `'bastion'` hull, `BOSS_WEAPONS.SIEGE`
  (spreads the player `WEAPONS[CANNON]`), the archetype row (2-shell
  `burst`, 1.0s telegraph) and a 3-phase `BOSS_DEFS` entry.
- `EnemyTraitSet.frontShield` + `PhysicsSystem.frontShieldCoversHit` +
  the reduction in the projectile damage path.
- `EnemyTraitSet.regen` + `noteTraitDamage()` (constants) called from all
  three player damage paths (projectile, lightning chain, shockwave ring)
  + `GameEngine.updateEnemyRegen`.
- `BOSS_ROTATION` now cycles Reaver → Bastion; DBG row for each.
- RenderSystem: the `'bastion'` hull and the front-shield sector arc.
- CLAUDE.md updated in the same commit.

**Validation**: build green; M1's smoke still passes unchanged (25
assertions); a new M2 smoke adds 21 — hull, all three phase stamps,
directional reduction MEASURED front vs rear through the real physics
path (20.0 rear vs 5.0 front), regen healing, chip healing through, a
burst gating it, the turret escort, payout, and the boss rotation.

**A real bug the smoke caught**: the first pass used a SLIDING burst
window (every hit refreshed the timer). That measures "damage until the
player pauses", so a sustained Blaster stream reaches the threshold in
four shots and chip damage stops healing through — the trait inverted.
Changed to a FIXED bucket (only the first hit arms the timer). The
arithmetic then lands on the §7 table by construction; the numbers are
in the code comment.

**Weapon × live-trait coverage** — every weapon is a right answer
somewhere in the table as SHIPPED (WEAPONS_AMMO_PLAN §7 asks for this):

| Weapon | Its live answer | Where that lives now |
|---|---|---|
| Blaster | armor (charged slug ≥ threshold) | Tank, Reaver p3 |
| Burst Rifle | stationary high-HP sustained DPS | Turret, Nest, Bastion p3 escort |
| Shotgun | evasive (cone forgives juking) + regen (18-21/bucket burst) | Reaver p1-2, Bastion p2-3 |
| Pierce Beam / Bouncer | front-shield (ricochets arrive from behind) | Bastion p1-2 |
| Lightning | armor + evasive + front-shield (chain damage bypasses the projectile path entirely) | all four |
| Seeker | evasive — the designated answer (dodge is blind to homing) | Reaver p1-2 |
| Cannon | armor (designated) + front-shield (AoE ring bypasses) + regen (28 burst) | all four |

**Watches**: Bastion's 220 HP against phase-2 regen 3.5/s is a real DPS
floor — a weaponless or single-Blaster loadout may not be able to kill
it at all. That is arguably correct for a capstone, but it interacts
with the weaponless-flight watch and belongs in the M10 mechanical pass.

### Iteration 3 — 2026-08-01 — M3: death screen + stat legibility

**Shipped** (commit `b439494`):

- `GameState.GAME_OVER`; the loop's existing not-PLAYING early-out
  freezes the sim behind the screen (no new freeze path).
- Run-scoped tallies `runKills` / `runWavesCleared` / `runCreditsEarned` /
  `runSeconds` + `runSummarySnapshot()` → `EngineStats.runSummary`.
- `respawnFromDeath()` (RESPAWN, run intact) alongside the existing
  `restartGame()` (END RUN).
- `moduleContributions(def)` + `ModuleStatKey` (constants);
  `OutfitSlotSnapshot.contrib` on every installed hex;
  `playerStatsSnapshot()` with the full derived set (adds `thrustMult`,
  `gunWeight`, `shieldRegen`, `overcharge`) — and the two duplicated
  inline `playerStats` literals collapsed into it.
- UIOverlay: the death screen, and Ship Status rebuilt as an
  attribution-aware row list.
- CLAUDE.md updated in the same commit (§3 lifecycle, §2 layout, §8).

**Validation**: build green; new 28-assertion smoke all passing; M1 and
M2 smokes still green.

**Watches**: `runSeconds` is SIM time, so it excludes pauses and station
visits — correct for "how long did the run take" but it will read lower
than wall clock, which may surprise. Noted rather than changed.

### Iteration 4 — 2026-08-01 — M4: SFX + explosion variety

**Shipped** (commit `5a39ddb`):

- `engine/systems/AudioSystem.ts` — lazy gesture-unlocked `AudioContext`,
  master gain + mute, per-def rate limit, global voice cap, tone/noise
  synthesis. ~200 lines, owns no game state.
- `AUDIO_CONSTANTS` / `SfxId` / `SfxDef` / `SFX_DEFS` (23 voices) /
  `WEAPON_SFX` in constants.
- 13 `audio.play` call sites: weapon fire (per family) + charged, enemy
  hit, player hull vs shield hit, three death weights, both pickups,
  dock, portal, wave start (an edge detector on `waves.waveIndex`) and
  clear, boss spawn / phase / death.
- `EXPLOSION_PROFILES` (8 classes) + `EXPLOSION_HEAVY_MASS`;
  `explosionClassOf` + a profile-driven `startExplosion`.
- Sound settings row in the pause menu (`EngineStats.audio`), engine API
  `setVolume` / `toggleMute`.
- CLAUDE.md updated in the same commit (§2 layout, §8 two new notes).

**Validation**: build green; new 17-assertion smoke all passing (the
gesture unlock is verified with a real Playwright click, not an engine
call); M1-M3 smokes still green.

**Watches**: 23 synthesized voices mixed by ear against silence, not
against the game running. The M9 coherence pass should re-check levels
with everything firing at once — the likeliest problem is that
`hitEnemy` at 0.10 gain is still too present during a sustained
Burst-Rifle stream.

### Iteration 5 — 2026-08-01 — M5: gamepad + controls reference

**Shipped** (commit `73ab607`):

- `GAMEPAD_CONSTANTS` (deadzone / move curve / aim radius / trigger
  threshold / standard-layout button indices).
- `InputSystem.pollGamepad()` + `takeCycleRequests()` + `takeKeyEdges()` +
  `gamepadId`; pad state folded into `getMovementVector` /
  `getMousePosition` / the fire queues / `isKeyDown`.
- `GameEngine.pollGamepad()` — per-frame service, connection announcement,
  and the Escape / Q / shoulder edge drain.
- `EngineStats.gamepad`; the shared `renderControls()` panel in both the
  main menu (collapsible) and the pause screen.
- CLAUDE.md updated in the same commit (§2 layout, §8 two new notes).

**Validation**: build green; new 22-assertion smoke against a stubbed
Gamepad API, all passing; M1-M4 smokes re-run and still green.

**A real bug the smoke caught**: pause was polled via `isKeyDown` once
per rendered frame, and a genuine `Escape` tap is often shorter than a
frame — so presses were silently dropped. Fixed by recording press
EDGES in `handleKeyDown` and draining them, which also unified the
keyboard and pad paths.

**Watches**: the pad's aim holds its last heading when the right stick
re-centres (rather than snapping to the mouse). That is the right feel
for a twin-stick, but it means a player who switches from pad back to
mouse mid-run keeps the pad heading until they move the mouse. Minor;
noted for M10.

### Iteration 6 — 2026-08-01 — M6: the polish batch (all four items)

**Shipped** (commit `8a6a020`):

- `TileRingConfig` + `PerMapVariantSpawn.tileRing`;
  `BaseMapLayer.populateTilesFromPopulation()`; Overworld, Universe,
  Pocket, Ring and SevenRings all route through it; MAP_POPULATION
  updated to the values the maps actually produced.
- `MINIMAP_CONSTANTS.BOSS_BLIP` / `RIVAL_BLIP` / `STATION_BLIP` + the
  shape-per-class contact rendering.
- Palette sweep: plastic-automata comment/code reconciled; metal glow
  fuchsia → amber in BOTH the baked `SHARD_VARIANTS['metal-tile'].glow`
  and the DBG cycle default.
- `STATION_TRAFFIC` + `GameEngine.seedStationTraffic` /
  `updateStationTraffic` — the optional NPC-traffic item.
- CLAUDE.md updated in the same commit.

**Validation**: build green; new 27-assertion smoke all passing; the five
earlier smokes re-run and still green. The composition refactor is
asserted to be visually neutral (per-map variant counts and the
glass > plastic > metal ratio checked directly).

**A real bug the smoke caught**: shuttles didn't move. `mass: Infinity`
is what makes them inert scenery, but mass-∞ entities are by definition
not integrated by PhysicsSystem — so an engine-managed mover has to own
its own position, exactly as the snitch and dragon head do.

**Watches**: SevenRings' four ring variants are now listed as radii in
the table, which is more legible but also means the ring COUNT is no
longer derived from `RING_COUNT`. If someone wants nine rings they edit
the table, not a constant — intended, but worth knowing.

### Iteration 7 — 2026-08-01 — M7: economy & progression tuning

Driven by a scripted auto-pilot harness (`measure-economy.mjs`) that runs
real 2-minute sessions and reports credits/minute, kills, waves and
time-to-afford. Everything below is measured, not estimated.

**BEFORE / AFTER (same harness, same pilot, ~80s of sim per run)**

| | before | after |
|---|---|---|
| arena income | 37,808 /min | 5,651 /min |
| hub income | 5,185 /min | 1,432 /min |
| income split (combat / terrain) | 22 % / 78 % | ≈55 % / 45 % |
| time to Hull Mk I (arena) | 6 s | 42 s |
| time to Cannon (arena) | 1.6 min | 10.6 min |
| full hull repair | 5 s of income | 32 s of income |
| whole catalog | ≈3 min | ≈60 min |

**Changed**

- `CREDITS_PER_DROP` 1000 → 100. One constant instead of re-pricing 25
  modules; the price curve is deliberate and readable, so income moved.
- `SALVAGE_DROP_CHANCE_ASTEROID` 0.45 → 0.28,
  `_DENT_SHARD` 0.85 → 0.55, `_ENEMY_PRIMARY` 0.55 → 0.85,
  `_ENEMY_SECONDARY` 0.25 → 0.55, plus a new
  `SALVAGE_UNITS_PER_ENEMY_TIER` (2) making enemy drops tier-scaled.
- `WAVE_CLEAR_DROPS` 3 → 10, `SNITCH_CATCH_DROPS` 8 → 30,
  `BOSS_CONSTANTS.SALVAGE_DROPS` 36 → 90 — all re-sized against the
  MEASURED ≈35 units/wave of combat income, which the old comments
  predated (they assumed 4.8-7.2).
- `resaleValue` + the inventory snapshot now price off `modulePrice()`.
- `DEATH_PENALTY_CYCLE` + `applyDeathPenalty` + the DBG "Death cost" row.

**Reviewed and deliberately NOT changed** — see the decisions below for
each: per-wave enemy growth, weapon-weight numbers, resale fractions,
Mk trade-in.

**Validation**: build green; new 21-assertion economy smoke passing; the
before/after measured twice with the harness.

### Iteration 8 — 2026-08-01 — M8: performance pass

Measure-first, per the PR #69/#70 methodology. The base commit
(`8c68285`) was built in a throwaway worktree and run through an
IDENTICAL four-scene harness (`measure-perf.mjs`), so the comparison is
same-machine, same-browser, same-scene.

**Caveat stated up front**: headless Chromium software-renders, so
render dominates at ~50 ms and the ABSOLUTE numbers mean nothing about
real hardware. The base-vs-HEAD delta in the same environment is what is
being read.

**BEFORE / AFTER (ms per frame, mean)**

| scene | render base→head | updPhys base→head | updLogic base→head |
|---|---|---|---|
| dense shards | 48.12 → 48.62 | 1.52 → 1.59 | 0.31 → 0.35 |
| boss fight + SFX* | 49.31 → 55.36 | 1.15 → 1.41 | 0.25 → 0.30 |
| overworld + traffic | 48.74 → 48.25 | 0.55 → 1.44 | 0.20 → 0.40 |
| portal churn | 51.28 → 51.17 | 0.51 → 1.39 | 0.18 → 0.47 |

\* not a like-for-like scene: the base has no bosses, so it ran a
nest+swarm cloud instead. Listed for completeness, not attribution.

**No render regression on comparable content** — the new draw work
(boss aura, front-shield arc, minimap contact shapes) allocates nothing
per frame and doesn't show up.

**Fixed (zero-behaviour)**

1. `navigator.getGamepads()` ran every rendered frame and allocates a
   fresh snapshot array per call — 60 allocations/second of garbage on
   any session without a pad. Now gated on `padPresent`, driven by the
   browser's own `gamepadconnected`/`disconnected` events.
2. `updateBosses` and `updateEnemyRegen` each walked the enemy index
   every sim step; merged into `updateBossesAndTraits`.

`updateGameLogic` fell ~25 % on the affected scenes (0.55 → 0.40,
0.64 → 0.47).

**Attributed, deliberately NOT "fixed"**: the residual Overworld
`updPhys` gap (0.55 → 1.44) is intended CONTENT — M4's explosion
profiles (5-54 particles per death where the base spawned none from
`startExplosion`) and M7's higher enemy drop rate (0.80 → 1.40 expected
drops per kill). Both feed passes already bounded by `MAX_PARTICLES` /
`MAX_ACTIVE_DROPS` and cadenced by the `dropScan` / `dropMerge`
PerfController tasks, so the cost scales with the caps rather than with
the content. Reducing it would mean reducing the feature, which is a
behaviour change and out of scope for a perf pass.

**Validation**: all seven smokes re-run and pass. The M5 gamepad smoke
was updated to dispatch `gamepadconnected` — which is what a real
browser does and what the new gate requires.

---

## Decisions taken

_(every judgment call: what was chosen, why, the alternatives, how to revert)_

### M1-D1 — A boss is an archetype + a phase table, not a new system

**Chosen**: `EnemySubtype.BOSS_SCATTER` is an ordinary `ENEMY_VARIANTS`
row with an `ENEMY_BEHAVIOR` entry; boss-ness is a `BOSS_DEFS` row read
by one ~40-line `GameEngine.updateBosses` pass.  Every phase field maps
onto machinery that already existed.

**Alternatives**: (a) a `BossSystem` with its own state machine and
scripted attack sequences; (b) engine-managed instances like the
dragon/rival (`BossInstance[]` with bespoke lifecycle).  Both were
rejected against strategy guardrail #3 (clean boundaries — don't grow a
subsystem where a table will do) and because (b) would have re-created
the wave-tracking plumbing that "a boss is a counted wave enemy" gets
for free.  The dragon/rival pattern is right for roamers with a
lifecycle *outside* waves; a capstone lives *inside* one.

**Revert**: delete the `BOSS_*` block in `constants.ts`, the
`updateBosses` call in `updateGameLogic`, and the boss branch in
`WaveSystem.startWave`.  Nothing else depends on them.

### M1-D2 — Phases CLEAR absent fields instead of patching

**Chosen**: `applyBossPhase` treats a phase as a full description of the
boss's current state — no shield in the phase means the shield is
dropped, no traits means traits are cleared.

**Why**: it makes "phase 3 trades evasion for armor" and "phase 3 drops
the shield" expressible without an explicit removal syntax, and it means
reading one phase tells you the whole boss.  **Alternative**: patch
semantics (merge over the previous phase), which is more concise for
additive phases but makes removals invisible and order-dependent.

**Revert**: make each stamp conditional (`if (phase.shield) …` with no
else branch).

### M1-D3 — Shop discount applies to purchases, not to resale

**Chosen**: `modulePrice()` discounts catalog prices and
`purchaseModule`; `sellModule`/`scrapModule` keep valuing items at the
FULL `def.cost`.

**Why**: pricing sell-back off the discounted price is fine, but pricing
it off the FULL cost while buying at a discount would let a player buy
at 75% and sell at 90% — a credit pump.  Buying discounted and selling
at 90% of full is *still* a small pump at max discount (25% off buy vs
90% sell-back = a 15%-of-cost loss, so it does NOT actually invert).
Verified the arithmetic: sell-back is 0.90 × cost, discounted buy is
0.75 × cost at the cap, so buy-sell-buy always loses money.  Flagged for
M7 anyway since resale fractions are in that bucket.

**Revert**: drop the `modulePrice` indirection.

### M1-D4 — Boss discount is run-scoped, not persistent

**Chosen**: `bossDiscount` resets with credits/score in
`resetAndLoadSelectedMap`, and CARRIES across portal transitions (it is
not in the map-scoped teardown).

**Why**: it matches exactly how credits behave, which is the thing it
modifies.  Durable persistence is fenced off (decision #36d).

### M1-D5 — Smoke scripts stay OUT of the repo

**Chosen**: the Playwright smokes live in the session scratchpad, not in
`scripts/`.

**Why**: the standing convention is "`npm run build` is the validation
gate (no test runner exists — do not invent one)".  A checked-in
`scripts/smoke/` directory reads as the start of a suite and would need
maintaining.  The two-line `window.__omniEngine` handle IS committed,
because it is what makes any future smoke (or console debugging) possible
and it costs nothing.

**Revert**: delete the two assignments in `App.tsx`.

### M2-D1 — front-shield is a REDUCTION on facing, not a second shield pool

**Chosen**: `frontShield` is a permanent damage reduction over a sector
centred on the entity's `rotation`, with no pool.

**Alternatives**: (a) reuse the Bulwark's `shieldArc*` pool with a big
capacity — rejected because a pool always depletes, so face-tanking
eventually works and the trait teaches nothing; (b) a separate slewing
angle like `shieldArcAngle` — rejected because centring on `rotation`
makes flanking a *movement* problem the AI already participates in (the
boss turns to face you), which is the readable version.

**Revert**: delete the `frontShield` branch in the PhysicsSystem damage
path and the trait entries.

### M2-D2 — the regen burst window is a FIXED bucket

**Chosen**: the first hit opens the window; later hits inside it
accumulate but do NOT re-arm the timer.

**Why**: the sliding version (the first pass) measures cumulative damage
until the player stops shooting, so every sustained weapon eventually
gates it and the "chip heals through" half of the trait disappears. The
fixed bucket makes the threshold a genuine damage-per-0.35s test. The
smoke caught this — the failing assertion was "spread-out chip never
trips the burst gate".

**Revert**: move `regenBurstTimer = r.burstWindow` back outside the
`if` in `noteTraitDamage`.

### M2-D3 — mitigation is applied BEFORE the burst window

**Chosen**: `noteTraitDamage` is fed the POST-armor, POST-front-shield
damage.

**Why**: the gate should measure what actually landed, and the
consequence is a good one — bursting a plated target means bursting it
from behind, which is precisely the "both lessons at once" difficulty
Bastion's phase 2 is for. **Alternative**: feed raw damage, which would
make the front-shield irrelevant to the regen check and let a player
burst through the plate face-on.

### M2-D4 — boss escorts seed at 15% of their cadence

**Chosen**: `applyBossPhase` seeds `spawnTimer = interval * 0.15` (the
Nest's own randomised 0.4-1.0 seed is unchanged).

**Why**: a phase that announces reinforcements and then makes the player
wait a full 9s interval doesn't read as a phase change. Caught by the
smoke, which found the escort missing at 3.4s of sim time.

### M3-D1 — death shows a summary but respawn stays FREE

**Chosen**: death enters `GAME_OVER` and shows the run summary; RESPAWN
returns the player to the map spawn with the entire run intact (credits,
score, outfit, tallies); END RUN clears it.

**Alternatives**: (a) death ENDS the run outright, arcade-style — which
is what a "death screen" usually means and what the run-scoped economy
implies; (b) keep the silent free respawn and show the summary only on a
manual quit. (a) was rejected under the standing decision rule: the
salvage death penalty severity is explicitly reserved for the user
(decision #40a), and ending the run is the HARSHEST possible penalty,
not the mildest. Shipping free respawn keeps today's behaviour exactly
and leaves `respawnFromDeath()` as the one hook M7 attaches a cost to.
(b) was rejected because the milestone asks for a death screen.

**Revert**: replace the `gameState = GAME_OVER` line in the explosion
branch with the old `this.respawnPlayer()` call.

### M3-D2 — attribution is derived from `ModuleEffect`, not authored

**Chosen**: `moduleContributions(def)` reads the def's own `effect`
object (plus a gun's `weight`) and emits `{key, text}` pairs.

**Why**: the failure mode of an attribution panel is drift — a hand-kept
table that stops matching what the sim sums. Deriving from the same
object `applyModuleEffects` folds makes that impossible, and it means a
new `ModuleEffect` field is a one-line addition in two places rather
than a hunt. **Alternative**: a `MODULE_ATTRIBUTION` table keyed by
module id, which reads more freely but drifts.

**Revert**: delete `moduleContributions` and the `contrib` field.

### M3-D3 — offline modules still report contributions

**Chosen**: `contrib` is populated for INACTIVE modules too; the UI
renders them struck through in rose.

**Why**: "this hex is dim" is a weak signal. "this hex would give you
+40 hull and gives you nothing" is the actual lesson of the adjacency
system, and it is the cheapest possible way to teach it.

### M4-D1 — synthesized audio, no asset pipeline

**Chosen**: every effect is built from an oscillator sweep and/or a
filtered noise burst at play time, described by an `SFX_DEFS` row.

**Alternatives**: (a) sampled audio files in `public/assets` — rejected
because it adds a download budget, a manifest to keep in sync, and a
licensing question, for a game whose entire visual language is already
procedural; (b) a third-party audio library — rejected on the same
no-dependencies grounds the rest of the engine is built on. The
milestone itself specified "synthesized/procedural, no external asset
pipeline", so this is the plan's call as much as mine.

**Revert**: delete `AudioSystem.ts`, the `SFX_*` block, and the 13 call
sites (all one-liners).

### M4-D2 — one fire voice per weapon FAMILY, not per weapon

**Chosen**: `WEAPON_SFX` maps each `WeaponType` to one of seven family
voices.

**Why**: the loadout should be audible, but seven near-identical "pew"
variants read as noise rather than as information. The seven families
(clean pew / rapid tick / noisy boom / bright ping / crackle / whoosh /
low thump) are genuinely distinct instruments.

### M4-D3 — the `heavy` explosion class is selected by MASS

**Chosen**: `explosionClassOf` sorts an enemy into `heavy` when
`mass >= EXPLOSION_HEAVY_MASS` (16), rather than from a list of
archetypes.

**Why**: mass is already the game's "how substantial is this" number,
so a NEW enemy archetype gets a correct death for free instead of
needing a row in yet another table. Today it catches Tank / Bulwark /
Turret / Nest and leaves the light tier on `ship`. **Alternative**: an
explicit `ENEMY_EXPLOSION_CLASS` record — more control, more drift.

**Revert**: replace the mass check with a subtype switch.

### M4-D4 — audio settings are NOT persisted

**Chosen**: volume and mute live on the AudioSystem for the session
only.

**Why**: CLAUDE.md §1 is explicit that there is no persistence beyond
in-memory run state, and durable persistence is fenced off for the
Overworld plan (decision #36d). Adding `localStorage` for one slider
would be the first crack in that. Flagged as a real usability cost
below.

---

## For user review

_(anything provisional or needing a human ruling)_

> **M7 note:** the provisional-number table below was M7's own input. Rows
> marked ✔ were revisited and set against measured data in iteration 7;
> unmarked rows were reviewed and deliberately left.

### Provisional numbers introduced in M1 (all named in constants, all for M7)

| Constant | Value | Note |
|---|---|---|
| `BOSS_CONSTANTS.WAVE_INTERVAL` | 5 | boss every 5th wave |
| `BOSS_CONSTANTS.COMPANION_BUDGET_FRAC` | 0.55 | boss-wave normal spawn budget |
| `BOSS_CONSTANTS.SCORE` | 2500 | on top of tier kill points |
| `BOSS_CONSTANTS.SALVAGE_DROPS` | ✔ 36 → 90 | re-sized against measured per-wave income |
| `BOSS_CONSTANTS.DISCOUNT_PER_KILL` / `_MAX` | 0.05 / 0.25 | shop discount |
| `BOSS_SCATTER` health / size / speed | 130 / 76 / 6.2 | first-pass boss stats |
| `BOSS_WEAPONS.SCATTER` damage / count | 5 / 7 | 35 on a full cone |
| `ENEMY_TRAITS[BOSS_SCATTER].evasive` | sense 340, miss 46, impulse 7.5, cd 0.85 | dodge feel |
| `BOSS_SIEGE` health / size / speed | 220 / 92 / 2.6 | first-pass boss stats |
| `BOSS_WEAPONS.SIEGE` damage / AoE | 13 + 8 splash @ r120 | 2-shell salvo |
| `frontShield` | 190°, 0.75 reduction | plate strength |
| `regen` p2 / p3 | 3.5 / 6 hp/s, window 0.35s, threshold 16, pause 2.5s | burst gate |
| `AUDIO_CONSTANTS` | vol 0.55, ceiling 0.5, 24 voices | mixed by ear; recheck in M9 |
| `SFX_DEFS` (23 rows) | see constants | every gain/duration is first-pass |
| `EXPLOSION_PROFILES` (8 rows) | see constants | counts bounded by the M8 perf pass |
| `EXPLOSION_HEAVY_MASS` | 16 | catches Tank/Bulwark/Turret/Nest |
| `GAMEPAD_CONSTANTS` | deadzone 0.22, aim radius 240, trigger 0.4 | untested on real hardware |
| `MINIMAP_CONSTANTS.BOSS_BLIP` / `RIVAL_BLIP` / `STATION_BLIP` | see constants | sized by eye at 75px and 280px |
| `STATION_TRAFFIC` | 2 shuttles, speed 2.4, dock 6s | ambience only |

### M5-D1 — the right stick synthesises a cursor instead of setting rotation

**Chosen**: the pad's right stick writes `mousePosition` at a fixed
radius from screen centre; the existing aim line reads it.

**Why**: it means ONE aim path serves mouse, touch and pad, and the
charge ring / aim telegraph / minimap all keep working with zero
changes. **Alternative**: a separate `padAimAngle` consumed by a new
branch in `updatePlayerMovement` — more direct, but it forks the aim
code and every future aim feature has to remember the fork exists.

**Revert**: delete the `padAim` block in `pollGamepad`.

### M5-D2 — pad buttons map to virtual KEY CODES

**Chosen**: interact is `'KeyE'` and pause is `'Escape'`, pushed into
the same sets/queues the keyboard feeds.

**Why**: CLAUDE.md's standing rule is that stations and portals share
the E key and any new proximity interactable must join the nearest-wins
arbitration rather than adding a second handler. Mapping the pad to the
same code keeps that rule true for free; a separate `padInteract`
boolean would have needed a second check at every latch.

### M5-D3 — key edges are queued, not polled

**Chosen**: `handleKeyDown` records press edges; edge-triggered actions
drain them.

**Why**: correctness — a sub-frame tap was being dropped (found by the
smoke). It also means adding a new edge action is one `case` in the
drain rather than another `xHeld` latch field.

**Revert**: replace the drain with `isKeyDown` + per-action latches
(and reintroduce the dropped-tap bug).

### M5-D4 — Escape and Q became real keyboard bindings

**Chosen**: the edge drain handles both devices, so keyboard players
gained Esc (pause/resume) and Q (cycle weapon).

**Why**: the milestone asks for a help panel covering keyboard, and the
keyboard genuinely had no pause or cycle binding — the panel would have
had two "—" cells for actions the pad could do. Small scope addition,
logged here rather than assumed.

### M6-D1 — MAP_POPULATION was updated to match the MAPS, not the reverse

**Chosen**: the table's numbers were corrected to what the inline map
code actually produced (e.g. Deep Space glass 14 → 27), then the maps
were pointed at the table.

**Why**: "make the table authoritative" could mean either direction, and
taking the table's stale numbers literally would have silently halved
Deep Space's terrain — a balance change smuggled in under a refactor.
Preserving the shipped look and fixing the documentation is the
reversible, honest reading. The smoke asserts the ratios survived.

### M6-D2 — ring maps got a second composition shape rather than being forced into clusters

**Chosen**: `TileRingConfig { radii, keepEvery }` alongside
`tileCluster`.

**Why**: a ring map's composition genuinely IS a list of radii; encoding
it as clusters would have been a lie that produced the wrong geometry.
The upside is that SevenRings' difficulty gradient is now readable off
the table. **Alternative**: leave the ring maps hardcoded — rejected,
that's exactly the drift the milestone is about.

### M6-D3 — the metal glow moved to amber

**Chosen**: `SHARD_VARIANTS['metal-tile'].glow.color` and the DBG cycle
default both moved from fuchsia to amber.

**Why**: this is the only item in the batch that changes how the game
LOOKS, so it needs a reason beyond taste. The glow is a damage pulse on
a steel slab; heated metal glows amber, and guardrail #1 says a mechanic
should express the material simulation. Magenta read as an energy field
belonging to some other material. The secondary win is that glass (cold
sky) and metal (hot amber) now contrast by temperature rather than by
arbitrary hue. **Revert**: two constants, both named in the commit.

### M6-D4 — the optional NPC traffic was BUILT, not cut

**Chosen**: shipped the cheap version.

**Why**: the milestone says "optional if all three land clean" and they
did — clean build, clean smokes, no regressions. The cheap version is
~90 lines of engine code with no new entity category and no gameplay
surface. **What was deliberately NOT built**: health, damage, cargo,
interaction, or any second station network — each would turn scenery
into a system, and multi-station networks are explicitly the Overworld
plan's (decision #36e).

**Revert**: delete `STATION_TRAFFIC`, the two engine methods and the
`seedStationTraffic()` call in `loadMap`.

### M7-D1 — income moved, not prices

**Chosen**: `CREDITS_PER_DROP` 1000 → 100.

**Alternatives**: (a) multiply all 25 module costs by ~10 — same effect,
25 edits, and it turns a clean curve (4,000 / 10,000 / 18,000) into
ugly numbers; (b) leave it and accept that the catalog is a three-minute
shopping trip. **Revert**: one constant.

### M7-D2 — enemy salvage is tier-scaled

**Chosen**: `spawnSalvageDrop` gained a `units` parameter; enemy kills
pass `SALVAGE_UNITS_PER_ENEMY_TIER × enemyTier`.

**Why**: the measured 22/78 combat/terrain split meant the optimal
strategy was to ignore the enemies the game is about. Raising the enemy
drop *chances* alone couldn't fix it (they cap at 2 drops per kill), and
cutting terrain to nothing would have contradicted the material-sim
guardrail — materials SHOULD be worth something. Scaling by tier fixes
the ratio and adds a legible incentive: fight the hard thing.

**Revert**: drop the `units` argument (defaults to 1) and the constant.

### M7-D3 — the resale money pump (a real exploit, closed)

**Found**: purchases were discounted by the boss bonus, sell-back was
priced off FULL catalog cost. At the 25 % cap: buy at 0.75 × cost, sell
at 0.90 × cost → **+15 % of cost per cycle, infinitely repeatable**.

**This corrects M1-D3 in this log**, which asserted the arithmetic was
safe. It wasn't — I compared the sell fraction against the discount
instead of against the discounted price.

**Fixed**: `resaleValue` and the inventory snapshot both price off
`modulePrice()`. The invariant is now smoke-asserted at 0/5/15/25 %
discount rather than argued about in prose.

### M7-D4 — death penalty: four candidates, mildest default

**Chosen**: `none` (today's free respawn) ships as the default; `repair`,
`tithe` (25 %) and `uninsured` (all) are live DBG choices.

**Why this shape**: the plan reserves the severity for a human, and the
gauntlet's own rule is "implement the MILDEST candidate behind a
DBG-cycle knob with all candidates selectable". `repair` is deliberately
priced with `STATION_CONSTANTS.REPAIR_COST_PER_HP` rather than a fresh
number — that guarantees dying is never cheaper than the repair it
skipped, which is the exact inversion decision #40a warns about. Every
mode clamps at held credits and keeps the run going.

### M7-D5 — enemy growth vs module power: measured, unchanged

**Analysis**: enemy HP +6 %/wave capped 2.5× and damage +4 %/wave capped
2.0×, both caps landing at wave 25. Against that, ~25 min of arena
income (≈141,000) buys roughly Hull Mk III + Gunnery Mk III + Autoloader
Mk II + Cannon: ≈2× DPS and 1.75× effective HP. Player power and enemy
power track each other closely, and because the enemy caps at wave 25
while purchases continue, the player ends with the "comfortable lead"
the constants already aim for. **No change** — the right outcome of a
tuning pass is sometimes a confirmation.

### M7-D6 — weapon weight and resale fractions: reviewed, unchanged

Weapon weight spans 1.10× (weaponless) to ≈0.76× (Cannon + Homing), but
a realistic 2-gun loadout sits in 0.80-0.88×, so the live spread is
~10 % — present as a trade, not punishing. Resale at 90 % is generous
but suits a game whose whole progression is rearranging modules;
scrap at 9 % is the intended field penalty. Both left alone.

### M7-D7 — Mk trade-in NOT implemented

The milestone says to build it "only if buy-sell-buy is clunky in play —
otherwise log". With sell-back at 90 % of current price, upgrading Hull
Mk I → Mk II is: tap the tile, Sell, tap Mk II, Buy — two clicks in the
same panel, net 6,400 vs 10,000 direct. Not clunky. **Logged, not
built.**

### M8-D1 — the gamepad poll is gated on browser events, not on a frame counter

**Chosen**: `padPresent`, set by `gamepadconnected` / `gamepaddisconnected`.

**Alternatives**: (a) poll every N frames — cheaper, but it adds input
latency and is a behaviour change; (b) leave it — a per-frame allocation
for every player who never touches a pad. The events fire exactly when a
pad appears, so gating on them is free AND behaviour-identical.

**Consequence worth knowing**: a test double that only replaces
`navigator.getGamepads` no longer works; it has to dispatch the event
too. The M5 smoke was updated accordingly, which arguably makes it a
more faithful stub than it was.

### M8-D2 — the residual sim cost was attributed, not optimised away

**Chosen**: report the Overworld `updPhys` delta as intended content
(M4 particles + M7 drop rate) and leave it.

**Why**: the milestone is explicit — "fix with zero-behaviour changes
… no behaviour-changing perf edits without logging them as such". The
only ways to close that gap are fewer explosion particles or fewer
drops, both of which are the features themselves. Both are already
bounded by hard caps and cadenced tasks, so the cost has a ceiling. If a
human later decides the explosion counts are too rich, the numbers are
one table (`EXPLOSION_PROFILES`) — but that is a design call, not a perf
one.

### Open for a human ruling

- **The gamepad is untested on real hardware.** The smoke drives a
  stubbed Gamepad API, which verifies our polling and mapping but not
  any actual controller's axis ranges, button indices or deadzone
  behaviour. The mapping assumes the W3C Standard Gamepad layout, which
  most modern pads report. Worth one pass with a physical pad before
  ship.

- **Audio settings don't persist.** Volume/mute reset every page load,
  because this game deliberately has no storage layer (CLAUDE.md §1,
  decision #36d). That is a genuine annoyance for a muted player. The
  fix is three lines of `localStorage` — but it would be the first
  persisted state in the project, so it needs a ruling rather than a
  quiet decision.

- **Death consequence.** M3 ships free respawn behind a summary screen
  (mildest candidate, per the decision rules). The real ruling —
  free respawn / salvage cost / uninsured cargo / run over — is M7's,
  and `respawnFromDeath()` is the single hook. Worth deciding before M7
  runs so the tuning pass can price it.

- **Boss cadence vs. wave length.** Every 5th wave was chosen because it
  matches the existing scripted-wave teaching block (7 authored waves) and
  gives the first boss at wave 5, after the Bulwark intro at wave 5 —
  i.e. the first boss lands ON the Bulwark teaching wave, replacing most
  of it.  Playable, but a human may prefer the cadence offset (e.g. every
  6th) so the scripted intros finish first.  One constant.
- **Bastion's DPS floor.** 220 HP with phase-2 regen at 3.5 hp/s means a
  loadout below ~4 sustained DPS literally cannot kill it, and a
  Blaster-only loadout (16 DPS gross, but chip damage heals through the
  burst gate by design) has to lean on charged shots. That is defensible
  for a capstone, but it collides with the standing "weaponless flight
  viability" watch. Flagged for M10; the fix, if wanted, is a lower
  `perSec` rather than more HP.
