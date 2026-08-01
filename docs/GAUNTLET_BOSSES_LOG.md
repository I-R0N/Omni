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

- [ ] **B1** — Capstone scheduling + boss chassis (cadence hook, boss
      archetype base, poise, intro rift + banner, model-(d) payout, DBG rows)
- [ ] **B2** — First weapon-boss + `evasive` trait
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
