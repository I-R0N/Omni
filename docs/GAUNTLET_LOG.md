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
- [ ] **M6** — Polish batch: palette residual + map composition + minimap
      faithfulness (optional: NPC station traffic — first to cut)
- [ ] **M7** — Economy & progression tuning pass (incl. salvage death penalty)
- [ ] **M8** — Performance pass (measure first, PR #69/#70 methodology)
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

### Provisional numbers introduced in M1 (all named in constants, all for M7)

| Constant | Value | Note |
|---|---|---|
| `BOSS_CONSTANTS.WAVE_INTERVAL` | 5 | boss every 5th wave |
| `BOSS_CONSTANTS.COMPANION_BUDGET_FRAC` | 0.55 | boss-wave normal spawn budget |
| `BOSS_CONSTANTS.SCORE` | 2500 | on top of tier kill points |
| `BOSS_CONSTANTS.SALVAGE_DROPS` | 36 | ≈3× the wave-clear spray |
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
