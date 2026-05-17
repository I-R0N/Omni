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

11. **g2 design deviations (PR #53)** — three places where what
    shipped diverged from decision #10's spec:
    a. **`repelImpulse` is accumulated but unread.**
       `PhysicsSystem` populates `entity.repelImpulse` per-substep,
       but RenderSystem computes glow proximity inline from the
       player position instead (commit `81c33e0` — "drop
       glowIntensity dep"). The accumulator is currently vestigial.
       Resolution deferred to g2-housekeeping: rip out OR wire to
       glass-tile glow per original spec.
    b. **Metal-tile glow uses a separate heat-bloom / warm-lighting
       model**, not proximity-to-repel as planned. Keeps the look
       distinct from glass; not coupled to repel intensity.
       Accepted as-shipped — visual works.
    c. **Metal-shard `repelImmune` amendment did not land.** The
       in-flight amendment (flip metal-shard off `repelImmune` so
       metal-shards feel the metal-tile repel field, priming g3
       attraction bonds) was not folded into PR #53. Carried into
       g2-housekeeping.
12. **(g3) Material interactions** — queued as a Phase 1 follow-up
    (not a renumbering of original feedback letters). Two pieces:
    metal-shard ↔ metal-shard attraction via the existing gravity
    primitive + new `gravityTargetVariant` filter + runtime
    attractor registration (see CLAUDE.md §8 / `PhysicsSystem
    .applyGravity`); metal-shard damages glass-tile on contact
    (damage model deferred to g3's design phase). Does NOT block
    Phase 2. See decision #14 for revised design notes after PR #54.

13. **g2-housekeeping over-delivery (PR #54)** — task brief was 5
    bullets; what shipped was 29 commits / +1711 / -643 across 15
    files, organized into 11 themes per the PR body. Original scope
    all landed cleanly. Bonus work:
    a. **DBG panel rebuild** — collapsible sections; new toggles for
       ShGrav, ShBond, Sh↔Tl, Neb↔Neb, ShPair/Sh↔Tl/ColorBlend
       cadence cycles (with AUTO threshold tables to N=32), TileBlend,
       ShardBlend, Shake. Inline `React.FC` declaration was causing
       360 unmount/remount cycles per second from stats-driven
       re-renders, swallowing touch input — replaced with a plain
       helper.
    b. **Material tier chain (glass)** — `glass-shard → glass-tile /
       rock-shard` at `GLASS_TIER_DIAMETER = sqrt(HEX_AREA)`, 50/50
       roll. Glass+glass merges bypass density compaction to allow
       growth. Glass-tile timer regen disabled — fresh glass tiles
       appear only via tier-chain transmute.
    c. **Nebula self-coalesce rewrite** — `nebula-shard.bondsWith
       nebula-shard` with `bondTimeSeconds: 5`, pair-consume compose,
       50/50 transmute to nebula-tile / glass-shard. Killed the
       `nebulaTileArea` accumulator + `nebulaCoalesceTimers`
       machinery.
    d. **Continuous color equilibration** — `NebulaSystem
       .equilibrateColors` lerps hues across tiles (anchors) and
       shards (catch-up); TileBlend / ShardBlend alpha cycles in DBG.
    e. **Fade-timer unification** — `nebulaFadeTimer/Duration` deleted
       from `GameEntity`; all consumers on `mergeFadeTimer/Duration`.
       Duration policy stays at the call site.
    f. **Material-palette dust puffs** — glass/rock palettes split
       into non-overlapping sub-arcs of the nebula range; dust puffs
       carry compositions and participate in equilibration.
    g. **Visual cleanups** — tile hit-flash overlay removed; damage
       crack-line render path deleted; indestructible glow
       warm-white → deep purple `#4c1d95`.
    h. **FlowField obstacle filter** — `initObstacles` now requires
       `mass === Infinity && shardVariant !== 'nebula-tile'`.
    i. **Player-tile crash damage** — shield absorbs before health.
    j. **DBG perf knobs** — Sh↔Tl re-activation via dedicated scan +
       cadence cycle; AUTO threshold tables extended to N=16/32.
    Validation status: `npm run build` clean. Manual playtest of
    material tier, nebula coalesce, color equilibration, dust puffs,
    and UNIVERSE/POCKET integrity all explicitly deferred in the PR
    test plan — **playtest pass owed before stacking more visual /
    shard-system work on top.**

14. **g3 design considerations after PR #54** — PR #54 introduced
    three patterns that change how g3 should be designed:
    a. **bondsWith pipeline as the canonical pair-trigger primitive.**
       Glass and nebula tier chains both use `bondsWith` with a bond
       time, then `composeXShards` does a pair-consume + transmute.
    b. **Per-emitter immunity / filter pattern.** `repelImmuneFrom:
       ['glass-tile']` on metal-shard demonstrates per-emitter
       filtering on the repel side. Per-variant declarative list,
       not a runtime attractor registry.
    c. **Tier-chain question for metal.** With glass-shard pairs
       composing into glass-tiles and nebula-shard pairs composing
       into nebula-tiles, the obvious symmetry would be metal-shard
       pairs composing into metal-tiles.
    Superseded by decision #15 — metal-metal attraction was dropped
    by user direction; tier-chain question moot. Per-emitter filter
    pattern is reused below for the metal-passthrough rule.

15. **g3 revised + plastic-softbody retrofit (bundled session)** —
    user direction for one more tile/shard-effect session before
    Phase 2. NO new variants — both pieces retrofit existing
    variant entries. Two pieces in one bundled session:
    a. **g3 revised — metal-passthrough-shatters-glass.** Drop the
       metal-shard ↔ metal-shard attraction piece entirely. Modify
       the EXISTING `metal-shard` variant so ALL metal shards pass
       through `glass-tile` and `glass-shard` with zero (or very
       little) impulse resolution and instantly shatter them on
       overlap. No new sub-variant. Use the per-emitter filter
       pattern from decision #11c / #14b: declarative
       `passthroughShatter: { targets: ['glass-tile',
       'glass-shard'] }` (or equivalent) on the existing
       `metal-shard` `SHARD_VARIANTS` entry, not a runtime
       registry. Existing `metal-shard.repelImmuneFrom:
       ['glass-tile']` (from PR #54) becomes redundant for the
       glass-tile side once passthrough lands — leave it in or
       remove it as the implementing session sees fit.
    b. **Plastic-softbody retrofit.** Modify EXISTING `plastic-tile`
       and `plastic-shard` variants in place. No new variant ids.
       Specifications from user:
       - **Render**: nebula-shard-style. Remove the hard polygon
         outline. Soft-edged texture rendered slightly larger than
         the collision box. Reduced alpha for translucency.
         Implementation choice: canvas radial gradient OR PNG
         texture asset — recommend canvas radial gradient for
         scope control.
       - **Shape**: tiles shatter into circular shards. Shards
         shatter into smaller circles. Polygon shape is either a
         high-segment-count approximation (e.g., 16-gon) or a
         dedicated circle render path; implementing session picks.
         The current `plastic-shard` inherits its parent tile's
         dented polygon (PR #53 over-delivery) — that inheritance
         should be removed since the new shape is always circular.
       - **Bond model**: strong spring-elastic between all
         plastic-shard ↔ plastic-shard and plastic-shard ↔
         plastic-tile pairs. Cluster behavior should morph-and-
         deform when hit/shot, not break into free pieces. Shards
         may break free briefly and get pulled back with high
         force (stretching effect). Beyond a distance threshold
         the bond permanently breaks. This is a NEW bond mode —
         `bondsWith` today is pair-consume + compose; this needs
         persistent spring-coupled pairs. Expect a new schema
         field (`elasticBond?` or similar) and a new tick path in
         ShardSystem.
       - **Friction**: high `linearDamping` to limit standalone
         shard motion (cluster cohesion dominated by spring
         force).
       - **Durability**: HP roughly preserved at current plastic
         level (post-PR-#53 = 24).
       - **Current plastic dent / vertexJitter behaviour**: drop
         it. With softbody cluster deformation via bond
         stretching, per-tile dent is moot.
       - **Out of scope**: interactions with other variants beyond
         what falls out naturally. Don't make metal-shard passthrough
         affect plastic-tile.
    Ordering inside the bundled session: ship metal-piece first
    (smaller, well-specified) so it's a clean commit set even if
    plastic-softbody absorbs more session time. Plastic-softbody's
    elastic-bond model is the most novel piece — expect an
    `AskUserQuestion` round inside the session before
    implementation (stiffness / restDistance / breakDistance
    defaults; render approach if both canvas-gradient and PNG
    are still on the table). Validation will need a manual
    playtest pass before Phase 2 launches.

16. **Flow-field audit + debug tooling (ff-review)** — user
    direction: before (h) Bosses, audit how the flow fields
    actually behave and add DBG-panel inspection tooling so any
    future enemy-AI work has visibility into the field that
    drives pursuit. Two flow systems live side by side
    (CLAUDE.md §2 / `engine/systems/`):
    a. **`FlowField.ts`** — analytical flow vector. Used at
       map-load asteroid seeding only.
    b. **`FlowFieldGrid.ts`** — baked enemy-pursuit grid +
       asteroid-flow field with incremental patching on tile
       destruction. The `initObstacles` filter was fixed in
       PR #54 (`mass === Infinity && shardVariant !==
       'nebula-tile'`) to stop bucketing mobile shards and
       nebula tiles as obstacles.
    Session scope is **tooling + a written audit report** —
    no behavior changes inside this PR unless they're trivial
    one-liners obvious to fix in passing. Anything substantive
    (re-tuning pursuit weight, changing rebuild cadence,
    altering obstacle filter, etc.) is queued as a separate
    follow-up brief informed by the audit findings. Keeps PR
    scope bounded and gives the user a decision point after
    seeing what the audit surfaces. DBG tooling slots into the
    existing collapsible-section panel rebuilt in PR #54 —
    either Physics section or a new FlowField section, the
    implementing session picks.

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
| g2 | Repel field (glass + metal) + glow trigger wiring | shipped (PR #53, merged into plan branch) | `claude/material-tiles-repel-boxIU` | Repel schema + glass/metal tile fields shipped. Three design deviations (see decision #11). Over-delivered with per-variant warm-lighting on rock/plastic/indestructible, TILE_HEAVY stress map, title-screen build-version display, plastic+metal HP 8→24, metal break-shard inherits dented polygon, dev-overlay perf timer split. |
| d2 | Weapon system overhaul | shipped (PRs #48 + #49, merged into plan branch) | `claude/weapon-system-overhaul-LLSqp` (+ `claude/charge-full-gate-7Hk2x`) | Charge model, per-shot ammo cost scaling, cannon shockwave, bouncer fan/nova, green-laser & purple-cannon redesigns. |

### Dependency chain

```
e ──► d1 ──┬──► j ──► g1 ──► g2
           └──► d2  (parallelizable with the j/g1/g2 chain)
```

Each task pulls the merged state of its predecessor(s) before branching.

---

## Phase 1 follow-ups

Small bundled work that fell out of Phase 1 but doesn't gate Phase 2.
Run when convenient; can run in parallel with Phase 2.

| ID | Task | Status | Branch | Notes |
|----|------|--------|--------|-------|
| g2-housekeeping | Resolve g2 deviations | shipped (PR #54, merged into plan branch) | `claude/g2-housekeeping-T1LR6` | Glass + metal glow → `repelImpulse`; metal-tile heat-bloom replaced with layer-2b style (blue `#60a5fa`); `metal-shard.repelImmune = false` + new per-emitter `repelImmuneFrom: ['glass-tile']` pattern; indestructible dropped from UNIVERSE/POCKET random spawn; CLAUDE.md refresh. Massive over-delivery (see decision #13): DBG rebuild, glass/nebula tier chains, nebula self-coalesce rewrite, continuous color equilibration, fade-timer unification, dust-puff palette split, visual cleanups, FlowField obstacle fix, player-tile shield-first crash damage. |
| g3 + plastic-softbody | Metal-passthrough + plastic-softbody retrofit | pending | `claude/material-interactions-plastic-softbody-<suffix>` | **Bundled session per user direction (decision #15).** g3 revised: drop metal-shard ↔ metal-shard attraction; ALL `metal-shard` (existing variant, no sub-variant) passes through `glass-tile` / `glass-shard` with little-to-no impulse resolution and instantly shatters them on overlap. Plus retrofit existing `plastic-tile` / `plastic-shard`: circular shard shape, nebula-style soft textures with reduced alpha, strong spring-elastic bonds (stretch + pullback + threshold break), high translational friction, HP roughly preserved, softbody-cluster aesthetic. No new variants in either piece. Does NOT block Phase 2. |
| ff-review | Flow field audit + debug tooling | pending | `claude/flow-field-debug-<suffix>` | Audit `FlowField.ts` (analytical, map-load asteroid seeding) + `FlowFieldGrid.ts` (baked enemy-pursuit + incremental tile-destroy patching) and add DBG-panel inspection tooling: vector overlay, on/off toggles, obstacle-bitmap visualization, rebuild-event visualization. Session ships tooling + a written audit report; any behavior changes get queued as a separate follow-up. **Must land before (h) Bosses** since boss AI behavior may depend on flow-field correctness; can run in parallel with (f) Timed waves. |

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

- [x] Refresh CLAUDE.md to reflect Stage 6/7 having shipped. **Done in
      PR #54** — variant count corrected 9 → 11, ASTEROID_GENERATION_CONFIG
      references stripped, MAP_POPULATION authority note updated.
- [x] Remove indestructible-tile from random map spawn; reserve for
      deliberate border placement only. **Done in PR #54** for UNIVERSE
      and POCKET; SevenRings outer ring + IndestructibleFieldMap showcase
      preserved as the deliberate-border / showcase cases.
- [ ] CLAUDE.md §4 still lists `nebulaFadeTimer` / `nebulaFadeDuration`
      under the nebula field category; PR #54 deleted those fields and
      unified all consumers onto `mergeFadeTimer` / `mergeFadeDuration`.
      Trivial doc edit; fold into the next CLAUDE.md-touching PR.
- [ ] PR #54's own CLAUDE.md update notes that "natural mixed maps
      (UniverseMap, PocketMap, SevenRingsMap) still hardcode their per-
      variant ratios in their MapClasses subclass" — MAP_POPULATION is
      authoritative for the showcase maps and rock-shard free-spawn
      counts but NOT yet for natural-map tile ratios. Real follow-up,
      not just a comment fix — flip the natural maps to read from
      MAP_POPULATION. Bigger than a punch-list item; queue as a small
      named task if it bites.

---

## Open questions

_(Append as they arise; resolve before relevant task starts.)_

- _none currently_
