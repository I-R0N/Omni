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
    direction: ahead of enemy-AI work in Phase 2 / Phase 3,
    audit the **asteroid/shard flow field** specifically and
    add DBG-panel inspection tooling for it. Two flow systems
    live side by side (CLAUDE.md §2 / `engine/systems/`):
    a. **`FlowField.ts`** — analytical flow vector. Used at
       map-load asteroid seeding only.
    b. **`FlowFieldGrid.ts`** — baked enemy-pursuit grid +
       asteroid-flow field with incremental patching on tile
       destruction. The `initObstacles` filter was fixed in
       PR #54 (`mass === Infinity && shardVariant !==
       'nebula-tile'`) to stop bucketing mobile shards and
       nebula tiles as obstacles.
    Scope refinements per user direction:
    - **AI / pursuit flow field stays out of scope for behavior
      changes and tooling.** It is touched only in a
      differential audit — what differs between the analytical
      asteroid FF and the baked asteroid-flow grid, and
      whether the two could be consolidated into one
      representation.
    - **Enemy AI behaviors are deferred** to the next phase of
      the overall plan (likely under (h) Bosses or a dedicated
      AI follow-up).
    - **DBG tooling targets the asteroid/shard FF only**:
      on/off toggle, vector overlay (with sample-N cycle),
      grid cell outlines (separate toggle from vectors so the
      user can inspect grid resolution without arrow clutter),
      obstacle-bitmap visualization, rebuild-event flash.
    Session ships tooling + a written audit report (path
    `docs/FLOW_FIELD_AUDIT.md`). No flow-field behavior changes
    or consolidation work inside this PR unless trivial.
    Consolidation, if recommended, becomes a separate follow-up
    brief informed by the audit. DBG tooling slots into the
    existing collapsible-section panel rebuilt in PR #54 —
    either Physics section or a new FlowField section, the
    implementing session picks.

17. **PR #55 plastic-softbody drifted from spec — to be reverted.**
    The brief specified persistent spring-coupled `elasticBond`
    pairs. Mid-session the schema field was added (commit
    `bf84916`) and then effectively orphaned (commit `ca73f77`
    "scrap elasticBond, use bondsWith + nebula-level damping").
    ~30 follow-up tuning commits explored alternative bond
    formulations and visual treatments, finally landing on a
    "polymer chain" model with hex-shape tile render, soft
    radial-gradient shard render, per-instance amber/black/
    green/purple/gray palette cycles, opacity cycle,
    composite-op cycle, restSpeed/restSpin sleep gate, hook
    into the nebula color-blend pipeline, and a tile→shard
    tier-chain merge. The PR also flagged a visual asymmetry:
    plastic-tile renders as polygon hex with cluster-boundary
    outline + bloom; plastic-shard renders as soft gradient
    with no outline. Half-broken clusters mix the two looks.
    User direction (this turn): the divergence is perf-heavy
    and out of plan. Revert plastic-shard to a standard
    polygon-shard treatment (same family as glass / rock /
    metal shards) using the plastic-tile color scheme, and
    add a cohesion-only bondsWith behavior that sticks to all
    variants except nebula. Tracked as the `plastic-revert`
    task in Phase 1 follow-ups; see decision #19.

18. **PR #57 PerfController — unplanned infra add.** Net-new
    system `engine/systems/PerfController.ts` shipped outside
    the plan structure. Coordinates frame-skipping across
    shard-pair, shard-tile-pair, color-blend, plastic-cosmetic,
    AI state machine, flow-field pursuit flush, nebula
    neighbour recompute, drop-collection scan, plastic
    self-break. Adds an entity-count-driven merge-rate ladder
    (0.6× sparse → 3.5× crowded) applied to plastic-eat /
    cohesion / merge timers. New DBG "Perf" section + new
    constants (`PERF_CONTROLLER_CONSTANTS`, `PERF_TASKS`,
    `MERGE_RATE_CONSTANTS`). Not documented in CLAUDE.md as
    of merge — load-bearing infra without spec coverage.
    Future periodic sim passes should route through
    PerfController instead of rolling their own AUTO interval.
    Pre-existing bug surfaced but not fixed:
    `ShardSystem.completeRegen` references nonexistent
    `this.regenAdapter` (silent no-op on nebula-tile regen
    colour rewrite). Tracked in the side-cleanup punch list.

19. **plastic-revert (micro session) — scope revised this
    turn.** User direction: keep colour-facing affordances
    (DBG palette/colour cycles + the nebula-blend hook on
    plastic shards); strip only the perf-heavy structural
    divergence. Scope:
    a. Restore plastic-shard to standard polygon-shard render
       and behaviour (mirror glass / rock / metal shard
       treatment). Drop the soft-radial-gradient render.
       Default colour: current plastic-tile fuchsia `#e879f9`;
       implementing session asks the user if the original
       amber `#d97706` is preferred.
    b. **Keep** the DBG palette / colour-cycle controls for
       plastic tiles and shards (the per-instance palette
       cycle, the plastic-specific colour picker if any).
       These let the user iterate plastic colours without a
       code change.
    c. **Keep** the nebula-based shard colour blending that
       plastic shards currently use — the PR #54
       cellular-automata equilibration hook applied to plastic
       (plastic-only at this time; see decision #21 for the
       deferred rock/metal extension).
    d. **Drop** the rest of the plastic-softbody divergence:
       opacity cycle, composite-op cycle, stretch-stiffness
       cycle, snap/free toggle, plastic-specific outline
       toggle, polymer-chain bond model, sleep gate
       (restSpeed / restSpin), hex-shape tile render diff
       (revert plastic-tile to the standard tile render
       path), `elasticBond` schema field if no longer
       referenced anywhere.
    e. Add bondsWith behaviour: plastic-shard sticks
       (cohesion-only, NOT pair-consume transmute) to every
       variant EXCEPT `nebula-tile` and `nebula-shard`.
       Implementing session picks the schema expression — a
       new `cohesionOnly: true` flag on the bond entry, or
       reuse existing fields with a very long bondTime so the
       compose step never triggers. Whichever is cleaner.
    f. Verify PerfController tasks tied to plastic
       (`plastic-cosmetic`, `plastic-self-break`,
       `plastic-eat`) still make sense after the revert; drop
       any whose body becomes empty / no-op. The
       `plastic-cosmetic` gate likely stays alive because the
       kept colour-blend hook still needs pacing.
    g. No behaviour changes to non-plastic variants.
    Out of scope: redesigning plastic from scratch, changing
    HP, changing spawn rules, extending the colour-blend
    system to other variants (see decision #21).

21. **Cellular-automata colour equilibration extension to
    rock + metal (deferred follow-up).** User flagged
    interest this turn in extending the PR #54-style
    nebula-based colour blending — the lerp-toward-neighbours
    equilibration in `NebulaSystem.equilibrateColors` — to
    rock and metal shard families. Explicitly deferred to a
    later session ("only plastic at this time"). Queued in
    the side-cleanup punch list as a real follow-up, not a
    trivial one. When the time comes, the brief should
    cover: per-material palette sub-arcs (the dust-puff
    palette split from PR #54 already established
    non-overlapping sub-arcs of the nebula range for glass
    and rock — extend the same concept to metal); whether
    rock and metal tiles act as anchor cells the way nebula
    tiles do; performance budget (the equilibration pass is
    a PerfController-gated task — adding rock + metal
    materially increases the active-shard count it walks).

20. **living-entity (new content task).** New non-threatening
    entity type that grazes on game material. Specifications:
    - New `EntityType` value (default name `CREATURE`;
      implementing session may rename: `GRAZER`, `ORGANISM`,
      etc.).
    - Spawns in small numbers (2–5 per map, exact count is a
      design-phase question).
    - Wanders the map idly; pursues nearby shards when
      detected.
    - Consumes `glass-shard`, `rock-shard`, `metal-shard` on
      contact. Does NOT consume plastic-shard or any nebula
      entity. Does NOT consume tiles.
    - Grows with each consumption (size, mass, possibly HP).
      Above a size threshold, splits into N offspring (N is
      a design question; suggest 2).
    - Non-threatening: doesn't damage the player, doesn't
      damage enemies. Whether the player can damage it is a
      design question (default suggestion: yes, with high HP
      so casual play doesn't wipe them out).
    - New AI states (`'wander'` / `'pursue'` / `'eat'`) —
      first new aiState branches in AISystem since the
      foundation work, per CLAUDE.md §8. Existing `'idle'` /
      `'chase'` stay untouched.
    - Render style: open. Candidates include nebula-style
      soft blob (reuses existing render path), polygon
      amoeba, or custom shape. Implementing session picks
      and runs an AskUserQuestion if uncertain.
    - Population control: cap per-map maximum (split halts
      above the cap). Replenishment rule on death (none?
      slow respawn? consumption pressure-driven?) is a
      design question.
    Substantial design surface — expect an AskUserQuestion
    round before implementation covering: spawn count,
    growth curve, split threshold and offspring count,
    eat radius / contact mechanic, player interaction model,
    visual treatment, population cap, despawn / respawn
    rules. Implementation invariants from CLAUDE.md still
    apply: torus math, fixed-timestep sim, allocation
    discipline. Stats payload may need new fields for HUD /
    debug. Out of scope: enemies attacking the creature,
    creature reproduction by means other than split, drops
    on creature death. Does NOT block Phase 2.

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
| g3 + plastic-softbody | Metal-passthrough + plastic-softbody retrofit | shipped (PR #55, merged into plan branch) | `claude/plastic-softbody-retrofit-sTxYR` | Metal piece landed per spec (`passthroughShatter: { targets: ['glass-tile', 'glass-shard'] }` on existing metal-shard). Plastic piece **drifted heavily** from the brief (see decision #17): elasticBond schema added then scrapped mid-session in favor of bondsWith + nebula-level damping; ~30 follow-up tuning commits; ended with hex-tile render, radial-gradient shards, palette/opacity/composite-op DBG cycles, polymer-chain bond, sleep gate, color-blend hook into nebula equilibration. Visual asymmetry between polygon-rendered plastic-tile and gradient-rendered plastic-shard. Known perf cost. **To be reverted** by `plastic-revert` task below. |
| ff-review | Asteroid/shard flow field audit + debug tooling | shipped (PR #56, merged into plan branch) | `claude/flow-field-debug-audit-IcwCq` | Audit doc at `docs/FLOW_FIELD_AUDIT.md` — 10 findings (4 L1 / 3 L2 / 3 L3). Consolidation answer: **don't consolidate** — analytical `FlowField.ts` is load-bearing for map-load streamline integration + per-respawn velocity bias before the grid exists; baked grid adds wall-repulsion the analytical formula can't provide. DBG overlays added: `AstFF` toggle, `FF Vec` arrows with sample-N cycle, `FF Cells` outlines, `FF Obs` obstacle tint, `FF Reb` rebuild flash. Three follow-ups deferred (#FF-1 obstacle-aware fallback, #FF-2 obstacle filter re-examination, #FF-3 asteroid-bake perf timer). One trivial doc fix in passing. |
| perf-controller | Unified frame-skipping `PerfController` | shipped unplanned (PR #57, merged into plan branch) | `claude/omni-perf-controller-6ScG1` | **Not in original plan — user-initiated infra add (see decision #18).** New `engine/systems/PerfController.ts` replaces scattered AUTO interval tables with one coordinator. Each substep samples a load signal (entity count + collision-cell density + EWMA sim time), quantises to tiers with hysteresis, schedules tasks with phase offsets. Migrated gates: shard-pair, shard-tile-pair, color-blend, plastic-cosmetic. Newly skippable: AI state machine, flow-field pursuit flush, nebula neighbour recompute, drop-collection scan, plastic self-break. Dynamic merge-rate ladder by entity count (0.6× sparse → 3.5× crowded). New DBG "Perf" section. New constants: `PERF_CONTROLLER_CONSTANTS`, `PERF_TASKS`, `MERGE_RATE_CONSTANTS`. Pre-existing bug flagged but not fixed: `ShardSystem.completeRegen` references nonexistent `this.regenAdapter`. |
| plastic-revert | Strip plastic-softbody divergence; restore standard shards | pending | `claude/plastic-revert-<suffix>` | **Micro session, scope revised this turn.** Revert plastic-shard to standard polygon-shard render and behavior. Keep plastic-tile color scheme. **Keep** the DBG palette / color-cycle controls for plastic tiles and shards. **Keep** the nebula-based color-blend hook that plastic shards currently use (PR #54-style cellular-automata equilibration, plastic-only for now). **Drop** the soft-radial-gradient render, opacity cycle, composite-op cycle, polymer-chain bond, sleep gate, hex-shape tile render diff, stretch-stiffness cycle, snap/free toggle. Add new bondsWith behavior: plastic-shard sticks (cohesion-only, NOT pair-consume transmute) to all variants EXCEPT `nebula-tile` / `nebula-shard`. See decision #19. |
| living-entity | New non-threatening grazer entity | **paused** | `claude/living-entity-<suffix>` | Brief drafted, implementation paused per user direction this turn. Decision #20 captures the design surface for whenever this resumes. |

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
- [ ] PR #57 introduced `PerfController` as load-bearing infra; not
      yet documented in CLAUDE.md (§2 directory layout, §3 per-frame
      order, §5 constants list, §8 conventions). Real follow-up.
- [ ] `ShardSystem.completeRegen` references nonexistent
      `this.regenAdapter` (field is `adapter`). `tsc --noEmit` flags
      it; `vite build` ignores it. Silent no-op on nebula-tile regen
      colour rewrite (off by default). Trivial fix.
- [ ] FF audit follow-ups #FF-1 (asteroid obstacle-aware fallback +
      diagonal wall-repulsion), #FF-2 (re-examine obstacle filter
      once any finite-mass wall-like variants ship), #FF-3 (perf
      timer for asteroid-bake path). Track via the audit doc
      `docs/FLOW_FIELD_AUDIT.md`.
- [ ] **Cellular-automata colour equilibration extension to rock +
      metal shard families** (decision #21). User-flagged future
      work to extend the PR #54 `NebulaSystem.equilibrateColors`
      hue-lerp behaviour beyond plastic (which keeps it after
      `plastic-revert`). Per-material palette sub-arcs; whether
      rock / metal tiles act as anchor cells; PerfController budget
      impact. Real task, not a punch-list one — queue as a small
      named task when ready.

---

## Open questions

_(Append as they arise; resolve before relevant task starts.)_

- _none currently_
