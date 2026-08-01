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
- [ ] **M2** — (h) Bosses: second boss + `front-shield` / `regen` traits
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

### Open for a human ruling

- **Boss cadence vs. wave length.** Every 5th wave was chosen because it
  matches the existing scripted-wave teaching block (7 authored waves) and
  gives the first boss at wave 5, after the Bulwark intro at wave 5 —
  i.e. the first boss lands ON the Bulwark teaching wave, replacing most
  of it.  Playable, but a human may prefer the cadence offset (e.g. every
  6th) so the scripted intros finish first.  One constant.
