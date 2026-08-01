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
- [ ] **M3** — Phase 3 Pair A: death/completion screen + stat legibility
- [ ] **M4** — Phase 3 Pair B: SFX, then explosion variety
- [ ] **M5** — Phase 3 Pair C: controller/joystick, then menu help
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

### Open for a human ruling

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
