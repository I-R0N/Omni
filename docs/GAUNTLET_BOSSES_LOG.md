# Gauntlet Log — (h) Bosses

Ledger for the LOOPED autonomous "gauntlet" session implementing **ONE**
roadmap step of `docs/GAME_FEEDBACK_PLAN.md`: **(h) Bosses**. Nothing
else (process ruling, decision #41c: one step per gauntlet, its own
branch and PR).

- **Branch:** `claude/gauntlet-bosses-2d6vuj`
- **Base commit:** `18beec1` — the tip of `claude/game-feedback-plan-UN3MV`
  (plan-doc commit on top of the PR #74 portals merge, `8c68285`).
- **Started:** 2026-08-01
- **Never pushed to:** `claude/game-feedback-plan-UN3MV`, `main`.
- **PR target:** `claude/gauntlet-bosses-2d6vuj` → `claude/game-feedback-plan-UN3MV`.

`docs/GAME_FEEDBACK_PLAN.md` and `docs/PARKING_LOT.md` are owned by the
orchestration session and are NOT edited here.

### Design anchors (locked upstream, not relitigated)

- **Model (d)** (decision #37e / WEAPONS_AMMO_PLAN §6): bosses pay
  SALVAGE and/or shop DISCOUNTS. Weapons stay purely purchased — no
  unlock plumbing, no per-boss weapon flags, no MODULE_DEFS grants.
- **Wave-map capstones** (decision #39e): bosses are capstone
  encounters on the wave arenas, on a cadence taken from the existing
  wave machinery. The Overworld hub gets none.
- **Weapon parity** (WEAPONS_AMMO_PLAN §6): a weapon-boss WIELDS a
  themed variant of the literal player archetype, via the existing
  `Partial<WeaponConfig>` override pattern. No parallel weapon table.
- **Existing machinery only** (guardrail #36e): a boss is a big ENEMY
  that COUNTS toward wave completion, expressed through
  ENEMY_VARIANTS / ENEMY_BEHAVIOR / ENEMY_TRAITS / shields / spawners /
  `openPortal` / the wave-announce banner. No bespoke scripting.

### Prior art

PR #76 (`claude/gauntlet-completion-wq2uv2`, closed UNMERGED) attempted
the whole roadmap in one session and contains boss work. It is a design
note from a colleague, NOT reviewed code and NOT pre-approved. Where
this gauntlet lands on the same shape, it is because the shape was
re-derived against the current tip; every divergence is logged below.

---

## FOR USER REVIEW

_(consolidated at the top; each item is a judgment call this session
could not ask about)_

1. **Boss cadence lands on the scripted teaching waves.** Bosses arrive
   every `BOSS_CONSTANTS.WAVE_INTERVAL` = 5 waves, so the first capstone
   is wave 5 — which is currently the Bulwark intro
   (`WAVE_DEFINITIONS[4]`). The boss REPLACES most of that wave's
   budget, so the Bulwark lesson is diluted. Alternative: 6, so all
   seven scripted intro waves finish before the first capstone. One
   constant.
2. **Every boss tuning number is provisional.** HP pools, payout size,
   discount rate/duration, trait thresholds — all named in
   `BOSS_CONSTANTS` / `BOSS_DEFS` / `ENEMY_TRAITS` and commented
   PROVISIONAL. The plan reserves economy/progression tuning for
   roadmap step 6; these numbers are sized against today's income
   (≈5–7 salvage/wave, 1000 credits each, modules 25k–60k) but not
   playtested.
3. **The shop discount is TIMED, not permanent.** See DECISION D3 —
   a permanent discount plus full-price resale is a money pump. This
   session chose a timed window AND priced resale off the same
   discounted price. If you prefer a permanent discount, the resale
   coupling must stay.

---

## Milestone queue

- [x] **B1** — Capstone scheduling + boss chassis (cadence hook, boss
      archetype base, poise, intro rift + banner, model-(d) payout, DBG rows)
- [x] **B2** — First weapon-boss + `evasive` trait
- [ ] **B3** — Second weapon-boss + `front-shield` and `regen` traits
- [ ] **B4** — Presentation + validation pass (bosses only)

---

## Iteration log

_(newest last)_

### Iteration 0 — 2026-08-01 — setup

Created this log. Re-grounded on `docs/GAME_FEEDBACK_PLAN.md`
(completion roadmap step 3 + decisions #36e, #37e, #39e, #41c) and
`docs/WEAPONS_AMMO_PLAN.md` §6–§7, then the CLAUDE.md sections for the
enemy/wave/trait machinery. Confirmed the branch sits at the plan-branch
tip with no drift; `npm install` clean; `npm run build` green
(653.99 kB bundle). Playwright is available globally
(`/opt/node22/lib/node_modules/playwright`) with Chromium at
`/opt/pw-browsers` — smokes drive `vite preview` headlessly.

Read the prior-art branch's boss commits (`1097082`, `22cf376`) and its
`GAUNTLET_LOG.md` M1/M2 entries as reference. Its code base is the same
commit as this one (`8c68285`), so it applies cleanly in principle —
which is exactly why nothing is cherry-picked: the two recorded pitfalls
(a sliding regen window that inverted its own trait; a discount/resale
money pump) are inputs to the design here, not fixes to inherit.

### Iteration 1 — 2026-08-01 — B1: capstone framework + WARDEN

**Shipped** (commit `876f374`):

- `constants.ts`: `BOSS_CONSTANTS` / `BossPhaseDef` / `BossDef` /
  `BOSS_DEFS` / `BOSS_ROTATION` / `isBossWave()` / `bossForWave()`;
  `EnemyTraitSet` extracted (ENEMY_TRAITS retyped onto it); the
  `BOSS_WARDEN` archetype row; `poise` added to the ENEMY_VARIANTS
  schema; ENEMY_ROLE / ENEMY_BEHAVIOR rows.
- `types.ts`: `EnemySubtype.BOSS_WARDEN`, the `'warden'` hull,
  `SpawnerConfig` + `PoiseConfig` interfaces, `GameEntity.isBoss` /
  `bossPhase` / `weaponOverride` / `spawner` / `poise`,
  `EngineStats.boss` / `bossDiscount`.
- `WaveSystem`: the boss-wave cadence + companion-budget cut,
  `spawnBoss`, `findSpawnPoint` extracted out of `spawnEnemy` (shared by
  both spawn paths), the `onBossSpawn` context hook, boss + poise
  stamping in `buildEnemy`, tier row.
- `GameEngine`: `updateBosses` / `applyBossPhase` / `payBossBounty` /
  `bossStatsSnapshot` / `bossDiscountSnapshot` / `handleBossSpawn` /
  `debugSpawnBoss` / `modulePrice`; the per-entity spawner in
  `updateNests`; run-scoped reset; `liveBoss` dropped on map load.
- `PhysicsSystem`: poise in the hit-feedback block.
  `WeaponSystem`: the per-entity `weaponOverride` merge.
  `RenderSystem`: the boss aura ring + the `'warden'` hull.
- `UIOverlay`: the boss HUD bar (name, phase pips, health, shield strip),
  the shop's discount banner, the DBG "Bosses" section. `App.tsx`: prop
  wiring + the `__omniEngine` / `__omniStats` debug handles.
- CLAUDE.md updated in the SAME commit (§4 entity fields, §5 the boss
  tables + poise + the ENEMY_TRAITS rewrite, §8 three new notes).

**Validation**: `npm run build` green. `npx tsc --noEmit` shows only the
two PRE-EXISTING errors (`constants.ts` `defaultOutcome`,
`ShardSystem.ts` `requireSizeDeltaFraction`) — both verified present on
the base commit by stashing. Headless Playwright smoke: **50 assertions,
all pass** — the wave-5/10 cadence and its budget cut, forced-enemy
suppression, the boss as a counted+tracked wave enemy, phase 0 and
phase 1 stamping (shield raised then dropped, armor traded away, weapon
override, escort spawner, speed, banner), poise measured through the
REAL projectile+physics path, the escort brood arriving via
`updateNests`, the HUD readout, the model-(d) payout with the owned-set
and loadout asserted UNCHANGED, the buy/sell pricing invariant, wave
completion, and a hub with no bosses.

**Decisions taken** (alternatives considered):

- **D1 — the chassis boss is a NEW plain archetype (WARDEN), not the
  first weapon-boss.** The milestone splits "boss chassis" (B1) from
  "first weapon-boss" (B2), and B1 needs something to spawn. Alternative
  considered: ship the Shotgun boss in B1 and make B2 only the `evasive`
  trait — rejected because it collapses two milestones and leaves B2
  with no encounter of its own. Cost: the rotation carries three bosses
  by B3 instead of two. Each is one archetype row + one BOSS_DEFS row,
  so the cost is table data, not code.
- **D2 — POISE is a plain archetype field, not a boss branch.** The
  generic hit-feedback block re-arms a 0.12 s stun on EVERY projectile
  hit and applies an un-mass-scaled knockback, so sustained chip fire
  would hold any boss in permanent hit-stun and walk it around the
  arena. Alternative: special-case `isBoss` in PhysicsSystem — rejected,
  it is exactly the kind of type-branch the codebase avoids, and the
  problem is not boss-specific (the Turret and Nest have the same
  latent issue). Now any heavy archetype can opt in.
- **D3 — the shop discount is TIMED, and resale is priced off the SAME
  discounted number.** The brief allowed skipping the discount; it is
  cheap enough to keep, and model (d) names it. But a permanent discount
  against full-price sell-back is an infinite money pump: buy at
  `cost × (1 - d)`, sell at `cost × 0.9`, profit `d - 0.1` per cycle
  (the prior-art branch shipped exactly this bug and caught it two
  milestones later). Both fixes applied — the window expires, and
  `resaleValue` routes through `modulePrice()` so buy-then-sell always
  loses money at any discount. Smoke-asserted.
- **D4 — the boss is spawned by `startWave`, not by a separate
  scheduler.** It enters `waveEnemyIds` as a counted enemy, so wave
  completion needed NO change. Alternative: an engine-managed roamer
  like the dragon/snitch — rejected by the brief and by the fact that a
  capstone must gate the wave, which the roamer path explicitly does not.
- **D5 — payout sizing.** `SALVAGE_DROPS: 12` (≈12,000 credits) against
  today's ≈5–7 units/wave combat income and 25k–60k modules: worth about
  two waves of fighting. `SCORE: 2500` sits between a dragon (3000) and
  a snitch catch (1500). Both PROVISIONAL and logged for the tuning pass.

**Watches**:

- The Warden's 120 base HP × per-wave HP growth is a first-pass number.
  At wave 5 that is ≈134 HP with phase-1 armor at 65% chip reduction —
  a light early loadout may find it a long fight. Revisit in B4 with a
  real playthrough, and it is squarely in the plan's step-6 tuning pass.
- Boss waves currently land on scripted teaching waves 5 (Bulwark intro).
  See FOR-USER-REVIEW item 1.
- `debugSpawnBoss` stacks bosses; `bossStatsSnapshot` shows only the
  most-wounded one. Fine for DBG, but if a design ever wants two live
  bosses the HUD needs a list, not a single bar.

### Iteration 2 — 2026-08-01 — B2: REAVER + the evasive trait

**Shipped** (commit `a978ed9`):

- `BOSS_WEAPONS.SCATTER` — spreads `WEAPONS[WeaponType.SHOTGUN]` and
  overrides the enemy-facing numbers (§6 weapon parity, no parallel
  table); `EnemySubtype.BOSS_SCATTER` + the `'talon'` hull; the
  archetype row (weapon, 0.45s telegraph, lighter poise than the
  Warden); ENEMY_ROLE / ENEMY_BEHAVIOR rows; the 3-phase `BOSS_DEFS`
  entry; `BOSS_ROTATION` now cycles Warden → Reaver.
- `EnemyTraitSet.evasive` + `GameEntity.evasive` / `dodgeTimer` +
  `AISystem.applyEvasiveDodge` + `AISystem.traitsEnabled` (mirrored by
  `GameEngine.toggleTraits`); `ai.update` now receives the projectile
  index; `WaveSystem.buildEnemy` stamps it; `applyBossPhase` re-stamps
  and clears it per phase.
- `RenderSystem`: the `'talon'` hull. `UIOverlay`: the DBG Reaver row.
- CLAUDE.md updated in the SAME commit (§5 roster + the ENEMY_TRAITS
  evasive paragraph).

**Validation**: build green; `tsc --noEmit` unchanged (two pre-existing
errors). B1's smoke re-run, still 50/50. New B2 smoke: **30 assertions,
all pass**.

**Decisions taken** (alternatives considered):

- **D6 — Shotgun was the right first weapon-boss**, as the brief's
  default suggested. It pairs with `evasive` in the way §7 wants: a cone
  is the weapon that *forgives* juking, so a shotgun boss that jukes
  teaches the trait by inversion (it does to you what your own shotgun
  would do to it). Alternative considered: a Lightning boss — deferred
  to B3's slot precisely because chains ignore dodging, which would
  have made the trait invisible in its introducing fight.
- **D7 — the evasive dodge is blind to homing, deliberately.** §7 names
  the Seeker as "the designated answer". Alternatives: dodge homing too
  but at reduced impulse (makes the Seeker merely better, not the
  answer), or reduce damage from straight shots (a fudge, not a dodge —
  and it would double-count with armor). Chose the literal reading:
  the trait cannot see homing shots at all.
- **D8 — one juke per cooldown, and cones/chains are unaffected by
  construction.** Lightning arcs never exist as travelling projectiles,
  so they need no special case to keep connecting. A shotgun cone lands
  because the boss can only step out of one pellet's line. Both fall
  out of the design rather than being special-cased — worth noting
  because a naive "reduce incoming accuracy" implementation would have
  needed exceptions for both.
- **D9 — Reaver's phase-3 escort is KAMIKAZE, not SWARM.** The Warden
  already ends on a swarm escort; reusing it would make the two
  capstones' finales read the same. Bombers also suit a brawler that
  wants you at close range.
- **D10 — poise is tuned lighter on the Reaver** (`stunDamage` 9 /
  `knockScale` 0.3, vs the Warden's 12 / 0.12). It is a duellist, not a
  fortress; a real hit should still rock it. Provisional.

**Watches**:

- The evasive impulse (7.5) is applied as a raw velocity add, so it is
  NOT mass-scaled — a lighter enemy given this trait later would juke
  proportionally harder. Fine for the one boss that has it; worth a
  mass divisor if the trait spreads to rank-and-file enemies.
- Reaver phase 2 stacks a tracking arc shield ON TOP of evasion. That is
  two soft counters at once and could read as frustrating; the flank
  answer still works, and the arc slew (2.4 rad/s) is beatable. Flagged
  for the B4 playthrough.
