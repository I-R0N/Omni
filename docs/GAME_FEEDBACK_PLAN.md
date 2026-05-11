# Game Feedback Plan

Source of truth for the multi-task overhaul kicked off from a long-form
playtest feedback list. This file is **maintained**: the orchestration
session re-reads it on cold start and updates it as PRs land.

> Sibling docs `docs/POLISH_ARCHITECTURE.md` and `docs/PARKING_LOT.md`
> are flagged in CLAUDE.md as historical / out-of-sync. **This file is
> different — keep it accurate.** When a task lands, update its Status
> line and any decisions it forced.

---

## How this works

- **Orchestration session** (planning branch
  `claude/game-feedback-plan-UN3MV`): owns this file, drafts task
  prompts, sequences work. Does not write code.
- **Task sessions** (one per task by default): branch off the latest
  tip of `claude/game-feedback-plan-UN3MV`, implement one task, open
  a PR **against `claude/game-feedback-plan-UN3MV`** (NOT `main`),
  merge, end.
- **Same-session bundling** is allowed when a task is small enough that
  spinning up a fresh session is more overhead than the work. When
  bundled, both tasks land on the same branch in the same PR — note
  this in the Status field of both tasks.

### Branch strategy

To minimize Netlify deploy triggers (only `main` pushes deploy),
`claude/game-feedback-plan-UN3MV` is the **long-lived integration
branch** for all feedback work:

- Every feature task PRs into this branch, never directly into `main`.
- After each feature PR merges in, the orchestration session pulls,
  updates this doc to reflect new state, and commits.
- A single final PR from `claude/game-feedback-plan-UN3MV` → `main`
  ships the entire feedback plan in one deploy.
- Feature sessions branch off the tip of this plan branch, so each
  picks up prior shipped work automatically.

### PR conventions

- Standard PRs (no drafts, no special labels, no required reviewers
  beyond repo defaults).
- **Base branch: `claude/game-feedback-plan-UN3MV`** (until the final
  ship-it PR, which targets `main`).
- Branch naming: `claude/<short-feature>-<suffix>`.
- Each task session pulls the latest plan-branch tip first so prior
  merged tasks are already present.

### Phase rules

- **Phase 1** — strictly sequential. Tasks share types / data /
  shard-system surface; parallel work would force painful rebases.
- **Phase 2** — strictly sequential. All tasks touch `WaveSystem`.
- **Phase 3** — runs as up to three parallel pairs (A / B / C).
  Sequential within each pair, parallel across pairs. Goal: avoid
  Claude Code session timeouts on long single-session work.

---

## Original feedback (verbatim)

```
a. Sound effects (different sound effects for different weapons,
   explosions, enemy explosions, enemy weapons)
b. More variety in enemy explosions
c. Explanation of gameplay and controls (and controller options) in
   start and pause menu. Add on screen joystick and button and/or PS5
   controller. [split into c1 menu help + c2 input]
d. Balance ammo types (power and function as well as ammo drop
   amounts) and update to have plain ammo pickups and health pickups
   instead of a different ammo type for each weapon.
e. Fix enemy spawn — no flashing into existence (always appear
   offscreen for all screen types: iPad, computer, iPhone, etc.)
f. Update waves to be timed waves of different enemy types until time
   is up.
g. Update tiles to rock, glass, metal and plastic types. Used to
   provide variety in enemy explosions (different shard combos per
   enemy type). Metal and plastic dent/deform on hit; glass and rock
   shatter (glass = small shards, rock = large shards). Enables
   per-material SFX too. [split into g1 rename/visuals + g2 dent/break]
h. Add new enemy types and bosses
   - Large shielded boss that opens to shoot or release enemies; smaller
     version as regular enemy that opens to shoot only
   - Bosses that use all the weapon types as their primary weapon
     (slightly more powerful) — Mega Man X-style. Player unlocks the
     weapon after defeating the boss.
i. Completion screen after dying — kills, wave, time elapsed; option
   to restart.
j. Review cleanup actions for excess entities. Under heavy counts,
   large amounts disappear suddenly which looks wrong. Prefer offscreen
   removal, slowed pacing, longer inter-wave gaps, and more aggressive
   merging into denser/heavier-but-smaller entities (darker tint as
   visual cue). Also: large shards should be able to collapse into
   smaller, denser forms.
k. After N waves, spawn a portal to a new map.
```

---

## Decisions log

1. **Shard-system Stage 6/7 (CLAUDE.md flag)** — verified shipped:
   `SHARD_VARIANTS` populated (constants.ts:1146), `MAP_POPULATION`
   live and read by `MapClasses`, `structureVariant`/`shardType` gone.
   CLAUDE.md is stale on this point and should be refreshed (see
   side-cleanup).
2. **(h) Weapon unlocks** — current run only. Reset on restart. Debug
   menu retains its existing unlock-any-weapon affordance.
3. **(j) Density-merge visual** — darker tint is the baseline; the
   implementing session may prototype additional cues but darker tint
   ships.
4. **(g) split into g1 + g2** — too large for one session.
5. **(g2) Break-loose model** — one durable shard per tile when a
   plastic/metal tile finally pops free.
6. **Indestructible-tile** — retained, repurposed for deliberate map
   borders only; remove from random spawn.
7. **Phase 1 reordering** — (j) moved before (g1)/(g2) so density
   compaction lands as a generic capability across existing shards
   first; (g2) then plugs metal/plastic shards into it additively.
8. **(d) split into d1 + d2** — original (d) was framed as "consolidate
   ammo currency + balance drops." User scope expanded it to also
   include a weapon-system overhaul (gamified damage / ROF / function
   variety / charge effects, plus green-laser and purple-cannon
   redesigns). Split:
   - **(d1)** = mechanical refactor: one shared ammo pool, tune
     per-shot costs and max-cap to preserve today's "shots per pickup"
     feel, update HUD/drops. No combat-feel changes. Bundleable with
     (e).
   - **(d2)** = weapon overhaul. Begins with an `AskUserQuestion`
     design phase (taxonomy, per-weapon stat budgets, charge-effect
     model, green-laser + purple-cannon proposals) — user approves
     before implementation. Own branch / PR. Must land before (h)
     since the boss roster references weapon types.
10. **g1 over-delivery; g2 narrowed** — the (g1) session ended up
    shipping most of (g2)'s original scope (dent/deform, break-loose
    physics, plastic-shard / metal-shard variants) inside PR #52
    alongside the rename + glow primitive. Revised (g2) is now
    "repel field for glass (light) + metal (heavy) + wire the
    layer-2b glow to repel intensity for both." Metal now also
    carries a repel field — superseding decision #9's "metal =
    damage-pulse" trigger plan.

9. **PR #45 partial cherry-pick into materials work** — PR #45
   (branch `claude/test-nebulae-textures-Sdp4D`, currently open
   against `main`) bundles four independent changes under a
   misleading "nebula textures" title: nebula-texture test mode,
   rock-shard textures, glass-tile **repel field**, and a
   variant-driven **proximity-glow animation**. Pull only the latter
   two; rock textures and the nebula test mode are explicitly
   excluded. Per user direction:
   - **(g1)** absorbs the **glow visual primitive** (canvas layer 2b
     in `RenderSystem`, including the SHARD_VARIANTS schema field
     for it). Decoupled from triggers; no glow fires yet. Behavior
     and visuals on existing variants unchanged.
   - **(g2)** absorbs the **repel field** (glass-tile only):
     `SHARD_VARIANTS[v].repel: { range, strength }`, `repelImmune`
     opt-out, `PhysicsSystem` 5×5 outer-ring repel-only scan,
     per-entity `repelImpulse` accumulator, DBG strength slider.
     Plus the **glow trigger wiring**: glass-tile → proximity-to-
     repel intensity (PR #45 layer 2b mapping); metal-tile →
     damage-pulse keyed to dent state from g2's main scope.
   - PR #45 itself stays open or gets closed; its diff is reference
     material, not a literal cherry-pick. The implementing sessions
     write fresh code on top of the post-(j) plan-branch tip.

---

## Phase 1 — Foundation (mostly sequential)

| ID | Task | Status | Branch | Notes |
|----|------|--------|--------|-------|
| e | Offscreen-only enemy wave spawns | shipped (PR #47, merged into plan branch) | `claude/offscreen-enemy-spawning-vYW3c` | First task. **Bundled with (d1)** in same session/branch/PR. |
| d1 | Shared-ammo consolidation | shipped (PR #47, merged into plan branch) | (same as e) | Single shared ammo pool, per-shot costs tuned to preserve shots-per-pickup feel, dedicated HUD readout box, ammo-drop visual (black core / white rim / white glow). |
| j | Graceful cleanup + density compaction | shipped (PR #50, merged into plan branch) | `claude/graceful-cleanup-density-Kscjl` | Offscreen-priority cleanup pacing, generic density compaction across rock/glass/nebula shards (`density` policy on `ShardVariantDef`), large-shard collapse, density-tier tint ramp. |
| g1 | Plastic/metal rename + revisualize + glow primitive + dent/break-loose physics | shipped (PR #52, merged into plan branch) | `claude/plastic-metal-rename-glow-YaUkr` | Over-delivered. Plastic/metal rename, glow primitive (`glow?` on `ShardVariantDef`, layer-2b in RenderSystem gated on `entity.glowIntensity`), AND most of (g2)'s original scope: dent/deform policy (`dent` field with vertexJitter, kind, breakShards), `plastic-shard` + `metal-shard` variants, per-material shard counts, HP parity. Plus rock-dent system and drop overhaul as bonus. |
| g2 | Repel field (glass + metal) + glow trigger wiring | pending | `claude/material-tiles-repel-<suffix>` | **Narrowed scope.** Add `repel?: { range, strength }` + `repelImmune?` to `ShardVariantDef`. Glass-tile = light repel (low strength). Metal-tile = heavy repel (matches PR #45's `range: 200, strength: 0.08`). PhysicsSystem 5×5 outer-ring repel scan + per-entity `repelImpulse`. Wire `entity.glowIntensity` from the per-frame repel intensity for both variants so the existing glow primitive lights up on player proximity. Optional: DBG strength slider. Dent/break-loose already shipped under g1 — out of scope here. |
| d2 | Weapon system overhaul | shipped (PRs #48 + #49, merged into plan branch) | `claude/weapon-system-overhaul-LLSqp` (+ `claude/charge-full-gate-7Hk2x`) | Charge model, per-shot ammo cost scaling, cannon shockwave, bouncer fan/nova, green-laser & purple-cannon redesigns. |

### Dependency chain

```
e ──► d1 ──┬──► j ──► g1 ──► g2
           └──► d2  (parallelizable with the j/g1/g2 chain)
```

Each task pulls the merged state of its predecessor(s) before branching.

---

## Phase 2 — Structure (sequential, after Phase 1)

| ID | Task | Status | Branch | Notes |
|----|------|--------|--------|-------|
| f | Timed waves of mixed enemy types | pending | `claude/timed-waves-<suffix>` | Restructure WAVE_DEFINITIONS / WaveSystem. Depends on (e) clean spawn + (j) clean despawn. |
| h | New enemies + bosses | pending | `claude/bosses-<suffix>` | Shielded boss (open/closed states; smaller "shoot-only" variant), Mega-Man-X-style weapon-type bosses. Weapons unlock per-run. Debug menu bypass kept. Likely new aiState `'open'`/`'closed'`. |
| k | Portal to next map after N waves | pending | `claude/map-portal-<suffix>` | New spawnable portal entity + GameEngine.loadMap lifecycle wiring. |

---

## Phase 3 — Polish (parallel pairs)

Run all three pairs concurrently in separate sessions. Sequential within
each pair.

### Pair A — UI

| ID | Task | Status | Branch | Notes |
|----|------|--------|--------|-------|
| i | Death/completion screen | pending | `claude/death-screen-<suffix>` | UIOverlay + EngineStats fields (kills, time elapsed, wave). Independent. |

### Pair B — Audio/FX

| ID | Task | Status | Branch | Notes |
|----|------|--------|--------|-------|
| a | SFX system | pending | `claude/sfx-system-<suffix>` | New cross-cutting system. Depends on Phase 1+2 so all sound categories are known. |
| b | Enemy-explosion variety | pending | `claude/explosion-variety-<suffix>` | Per-material shard composition on enemy death. Pairs with (a). Depends on (g2). |

### Pair C — Input

| ID | Task | Status | Branch | Notes |
|----|------|--------|--------|-------|
| c2 | Onscreen joystick + PS5 controller | pending | `claude/controller-input-<suffix>` | InputSystem extension. Independent. |
| c1 | Controls/gameplay help in menus | pending | `claude/menu-help-<suffix>` | UIOverlay menu copy. Depends on (c2) so layouts are accurate. |

---

## Conflict map

- Phase 1 main chain (e → d1 → j → g1 → g2): all touch shard / drop /
  structure code → strictly sequential.
- (d2) sits outside that chain — touches weapons / projectiles only.
  Safe to run in parallel with j/g1/g2 once d1 has merged.
- Phase 2: all touch WaveSystem → strictly sequential.
- Phase 3 within-pair: A independent; B shares particle/audio; C shares
  input/UI.
- Across-pair (A vs B vs C) collision risk is low → safe to parallelize.

---

## Side-cleanup punch list

These are not full tasks — fold into a relevant PR when convenient.

- [ ] Refresh CLAUDE.md to reflect Stage 6/7 having shipped (remove the
      "today the legacy reads…" notes; remove "Stage 7 wires spawn"
      caveat on rock-tile; remove the stale comment at GameEngine.ts:869
      referencing old field names).
- [ ] Remove indestructible-tile from random map spawn; reserve for
      deliberate border placement only. (Probably folded into g1 or
      whichever map-touching task gets there first.)

---

## Open questions

_(Append as they arise; resolve before relevant task starts.)_

- _none currently_
