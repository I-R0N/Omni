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

19. **plastic-revert (micro session) — scope revised across
    two turns.** User direction: keep colour-facing affordances
    (DBG palette/colour cycles + the nebula-blend hook on
    plastic shards); strip only the perf-heavy structural
    divergence; add per-partner bond strength so plastic
    sticks to glass strongly. Scope:
    a. Restore plastic-shard to standard polygon-shard render
       and behaviour (mirror glass / rock / metal shard
       treatment). Drop the soft-radial-gradient render.
       Default colour: current plastic-tile fuchsia `#e879f9`;
       implementing session asks the user if the original
       amber `#d97706` is preferred.
    b. **Keep** the DBG palette / colour-cycle controls for
       plastic tiles and shards.
    c. **Keep** the nebula-based shard colour blending that
       plastic shards currently use — the PR #54
       cellular-automata equilibration hook applied to plastic
       (plastic-only at this time; rock + metal extension
       moves to decision #21's material-palette-pass).
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
       compose step never triggers. Recommend option 1.
    f. **Per-partner bond strength.** Plastic-shard's bond to
       `glass-tile` and `glass-shard` is a **strong tier**
       (higher cohesion / pull constant). Other partners
       (`rock-tile` / `rock-shard` / `metal-tile` /
       `metal-shard` / `indestructible-tile` / `plastic-tile`
       / `plastic-shard`) get the default tier. Schema
       picks: a per-partner `strength` field on the
       `bondsWith` partner list, OR two `bondsWith` entries
       (one strong, one default) keyed by partner variant.
       Implementing session picks; recommend per-partner
       strength so the entry list stays compact.
    g. Verify PerfController tasks tied to plastic
       (`plastic-cosmetic`, `plastic-self-break`,
       `plastic-eat`) still make sense after the revert; drop
       any whose body becomes empty / no-op. The
       `plastic-cosmetic` gate likely stays alive because the
       kept colour-blend hook still needs pacing.
    h. No behaviour changes to non-plastic variants.
    Out of scope: redesigning plastic from scratch, changing
    HP, changing spawn rules, extending the colour-blend
    system to other variants (decision #21), shard-count or
    mass retuning (decision #22).

21. **material-palette-pass (expanded from prior decision
    #21).** Originally scoped as "extend nebula colour
    equilibration to rock + metal." Expanded this turn to a
    cohesive material-palette-pass that combines palette
    work with the automata extension. Scope:
    a. **Palette adjustments.** Metal — remove white from
       the palette; add a shiny-ready blue range. Rock — add
       red + blue range so rock can carry warmer / cooler
       reads depending on cluster context. Plastic — verify
       the current palette still works under the
       cohesion-only bond model (post-revert) and the
       automata equilibration; tune if necessary.
    b. **Automata coloring extension.** Extend the
       `NebulaSystem.equilibrateColors` hue-lerp behaviour
       across non-nebula tile families:
       - **Warm sub-arc** applied to rock + plastic.
       - **Cool sub-arc** applied to glass + metal.
       - **Neighbour-tile count gates intensity** — dense
         clusters drift further from the base hue than
         sparse cells. The dust-puff palette split from
         PR #54 established non-overlapping nebula sub-arcs
         for glass and rock; reuse the sub-arc concept.
       - Plastic already has the equilibration hook from
         PR #55 / plastic-revert; this task generalises the
         pattern to rock, glass, metal.
    c. **Performance budget.** Equilibration is a
       PerfController-gated task. Adding rock + glass + metal
       materially increases the active-shard / tile count
       walked per pass. Implementing session must validate
       perf on TILE_HEAVY and the dense natural maps.
    d. Tile-anchor question — should rock / glass / metal
       tiles act as anchor cells the way nebula tiles do
       (anchors don't drift; shards catch up to them), or
       should all material tiles drift together? Design
       phase decision. Recommend anchors-on for visual
       stability.
    e. Out of scope: net-new rock variants (fire / ice — see
       parked items under decision #27), shiny metal render
       (separate visual task, decision #27), per-shard
       mass / collision retune (decision #22).

22. **momentum-collisions (replaces prior material-balance-
    pass).** User direction this turn: scope narrows to just
    the momentum / velocity-in-collisions piece; the prior
    bundled shard-count and per-material mass retune items
    move to parked under decision #27. Scope:
    a. **Momentum in the impulse path.** Verify that today's
       `PhysicsSystem.resolveCollision` impulse calculation
       and the PR #57 composite-collision additions account
       for entity velocity in addition to mass. The user's
       perception is that collisions read mass-dominant —
       light fast things bounce off heavy slow things
       instead of shoving them. Introduce / restore
       velocity into the impulse so a fast small entity can
       shove a heavy slow one (`p = mv` rather than mass-
       only).
    b. Tuning task — no rewrite of the impulse model. If the
       formula already does the right thing on paper, retune
       the elastic / damping constants until play matches
       intent. If the formula is mass-only in practice,
       extend it to use mv.
    c. Out of scope: per-material shard mass retune, per-
       entity shard-count reduction (both parked under
       decision #27), any non-collision physics.
    Runs after plastic-revert so the post-revert plastic
    behaviour is what's being tuned against, not the
    softbody-era behaviour.

23. **map-composition (promoted from side-cleanup).** Two
    pieces:
    a. **MAP_POPULATION authority for natural maps.**
       Flip UniverseMap / PocketMap / SevenRingsMap to read
       per-variant tile ratios from `MAP_POPULATION` instead
       of the hardcoded subclass literals noted in the
       PR #54 CLAUDE.md update. After this, MAP_POPULATION
       is the single source of truth for entity counts
       across all maps.
    b. **Cluster-composition rules.** Rock tiles mixed
       around metal-tile clusters (so metal feels like
       refined material embedded in a rock matrix). Plastic
       tiles mixed with glass-tile clusters (the two
       materials currently feel disjoint; mixing reinforces
       the "manufactured" vs "natural" axis).
       Implementing session picks the schema expression —
       extend MAP_POPULATION cluster entries with an
       optional adjacency / inter-mix descriptor, or wire
       the rule into `TileGenerator` directly.

24. **minimap-faithfulness.** Small UI task to make the
    minimap more representative of what's on screen.
    a. Minimap tile colours should closely match the actual
       on-screen tile colours, not the simplified swatches
       used today. Pull the same `COLORS.STRUCTURE_*`
       constants the renderer uses.
    b. Nebula tiles and shards drawn with reduced alpha on
       the minimap to read as "thin / fog" rather than
       solid blockers.
    c. Touches `MINIMAP_CONSTANTS` + UIOverlay minimap render
       only. No engine changes. Independent of other tasks
       — can slot in anywhere in the sequence.

25. **orbital-fields-moons (deferred / queued).** Net-new
    mechanic, not in current sequence. Specifications:
    a. Flow fields that create circular orbits around a
       central planet entity, replacing or augmenting the
       analytical asteroid flow on planet-bearing maps.
    b. Moons rendered in the background that move along
       their own orbital paths and contribute gravitational
       pull on dynamic entities the way `LOCAL_GRAVITY_*`
       contributes today.
    c. Likely new `EntityType.PLANET` and
       `EntityType.MOON` (or a single CELESTIAL_BODY with
       a role discriminator). Likely a new map (or maps)
       designed around the orbital flow.
    d. Touches FlowField + FlowFieldGrid (planet at centre
       generates the orbital flow), BackgroundManager
       (moons in the parallax layer with gameplay weight),
       LOCAL_GRAVITY_CONSTANTS (moon + planet gravity
       sources), MAP_POPULATION (planet-map population),
       MapClasses (new MapType).
    e. Estimated 2+ sessions. Slots between Phase 2 (k)
       and Phase 3 or alongside Pair B/C polish.

26. **voronoi-rock-fracture (deferred / queued).** New
    rock shatter algorithm. Specifications:
    a. Rock-tile fractures via Voronoi cell decomposition
       — chip a sector off the tile per hit, leaving the
       remainder of the tile mostly intact.
    b. The chipped-off shards have larger count and higher
       ejection velocity than the current break model.
    c. Tile takes several hits before fully breaking;
       cumulative chip-off area drives the break threshold.
    d. Fallback if Voronoi is too heavy on the CPU budget:
       chunkier polygon-decomposition with the same
       feel (multiple hits, partial breakaway, faster
       shards).
    e. Touches the `breakShards` policy on rock-tile +
       new shatter pathway in ShardSystem.
    f. Estimated 1–2 sessions. Slots into Phase 3 polish.
    **Partially covered by PR #65 (material-damage-cracks).** That
    session shipped the `ROCK_BREAK` + `ROCK_CHIP` model: a rock
    entity takes several hits before breaking (size/density hit
    ceiling, 4–6), every non-killing hit chips a piece off (dust
    nebula-shard or solid rock-shard) while the tile/asteroid stays
    mostly intact, and the killing hit breaks the remainder into
    multiple pieces — satisfying (b)/(c) and the (d) "chunkier
    polygon-decomposition, same feel" fallback for the chip-off
    behaviour. **Still wanted (user direction): the true Voronoi cell
    decomposition (a)** — geometric sector chips carved out of the
    tile's own polygon, rather than the separate chip entities PR #65
    spawns alongside an intact tile. Keep this entry QUEUED; the user
    wants to consider the full Voronoi version as a future
    implementation.

27. **Parked items — not in plan, considered but deferred
    indefinitely.** Items the user listed but decided
    against pulling into the current sequence:
    a. **dbg-cleanup + perf-mode preset cycle** — DBG menu
       sweep + a single toggle that cycles through
       performance modes built on PerfController.
       Parked.
    b. **Infinite maps with landmarks (planets)** — would
       replace the bounded-torus model from CLAUDE.md §1.
       Architectural; not in this arc. Distinct from
       orbital-fields-moons (which works inside the
       existing torus).
    c. **Fire-rock / ice-rock variants** — new
       `ShardVariantId` values with distinct palettes /
       behaviour. Content task; revisit after
       material-palette-pass lands and see whether the
       expanded rock palette already scratches the itch.
    d. **Shiny metal render** — substantial visual / shader
       work to give metal a specular / reflective read.
       Revisit after material-palette-pass; the white-removal
       + blue-range palette may be enough.
    e. **Per-entity shard-count reduction** (moved this
       turn from the original material-balance-pass).
       Audit per-material `breakShards` counts and reduce
       where the post-shatter cloud feels excessive.
       Decoupled from momentum-collisions because the user
       narrowed that task to physics only. Revisit during
       a future tuning beat.
    f. **Per-material shard mass retune** (moved this turn
       from the original material-balance-pass). Goal
       was: glass / plastic feel light, metal / rock feel
       heavy. Revisit if momentum-collisions doesn't
       produce the desired material-weight read on its own.
    If any of these get pulled back in, promote from this
    decision to a new Phase 1 follow-up entry and a new
    decision number.

28. **perf-hotpath (PR #58) — clean zero-behaviour perf
    pass.** User-driven perf work alongside the plan,
    similar in posture to PR #57's PerfController. 14
    commits, 14 files, +203 / -129 of substantive code
    (GitHub stats higher due to test scaffolding +
    cleanups). Every change preserves exact semantics —
    same math results, same gameplay behaviour. Audit
    methodology in the PR body: map the surface, fan-out
    audit of RenderSystem / PhysicsSystem / AISystem /
    ProjectileSystem / GameEngine, triage to keep only
    scalar / allocation wins, apply + build + verify
    between batches. Validation: `npm run build` passes
    locally; in-browser smoke-test items deferred to user
    (homing, lightning, shake, trails, HUD labels, gravity).
    **Flagged but not in scope** (good queue for any future
    perf beat):
    - `EntityIndex` conditional rebuild (would change when
      death-routing sees inactive entries).
    - Broadphase dense-cell cap (would change pair
      ordering).
    - Per-entity cached SAT axes (needs invalidation
      discipline as `polygonPoints` mutates for plastic
      dents — moot post-revert).
    - ShardSystem merge-broadphase Map/Set reuse (per-cell
      array pooling needed for real wins).
    Should be documented alongside PerfController in the
    CLAUDE.md refresh (side-cleanup pile, PerfController
    docs item). No new constants or schema; the
    `enforceCap` helper is the only net-new module.

29. **plastic-revert (PR #60) — massive over-delivery across
    six themes beyond the brief.** Original brief was 5 bullet
    points: strip softbody divergence, keep colour
    affordances, add cohesion-only bondsWith with per-partner
    strength. What shipped was 29 commits, +1744 / -2289
    across 12 files, framed in the PR body as Parts A–I.
    Parts A/B/C matched the brief exactly. Parts D–I are
    net-new behaviour:
    a. **Part D — plastic playtest iteration.** Plastic
       self-merge growth; cross-material transmute on
       contact (plastic adopts partner's material — gate
       dropped per user direction); plastic-tile snap at
       ≥1.5× sqrt(HEX_AREA); tougher shards + non-shrinking
       dents + per-dent snap-back recovery with HP/colour
       rewind; tile-colour blend toward shard colour;
       heavy `attractedTo` gravity (pullRange 300,
       pullStrength 500); annular pull gate (`pullInnerRange`
       schema field); 5× flow-field affinity for plastic.
    b. **Part E — generalizations to all shards.** New
       `mergeCount` field on `GameEntity` (replaces
       `plasticMergeCount`); `shatterAsteroidStyle` reads it
       so any merged variant breaks into mergeCount±1
       fragments. Metal composite decomposition (`shatter`
       routes ≥2-cell composites to per-cell loose
       triangles). Unified shard→tile snap across plastic /
       glass / metal (shared `TILE_SNAP` block, 2×
       tile-diameter threshold). Metal excess absorption
       (composites grow past 6 cells as invisible mass).
       Rock condense extended 5 → 25 tiers (top ≈ 1500 px,
       density 2²⁴). Density-aware rock HP (MAX_HP ×
       sqrt(tier+1)); size-keyed fragment counts
       (max(merges, size/40), capped 30); mixed-density
       children (parentTier ± 2).
    c. **Part F — flow field.** Ammo drops follow asteroid
       flow (non-magnetised path). Inverse-mass variability
       on flow correction + terminal speed
       (`massScale = sqrt(MASS_REF / mass)`); light chips
       lead, heavy condensed rocks trail. Plastic's 5×
       boost applied BEFORE mass scale so heavy plastic
       blobs are diluted like heavy rock.
    d. **Part G — ammo drops.** Base value forced to 1
       (~5× ammo reduction per kill). Adjacent-drop merge
       (O(N²) pair scan, value sums, position averages).
       Mutual gravity pull + damping in the merge band so
       pairs spiral cleanly into contact. Mass-weighted
       velocity blend on merge.
    e. **Part H — DBG additions.** `Shard pal` (plastic-
       shard palette cycle independent of tile), `P glow`
       + `M glow` (proximity-glow brightness multipliers),
       `M color` (metal-tile glow colour cycle).
    f. **Part I — perf hot-path sweep.** Set-based plastic
       dent recovery (~360k op/step elimination on dense
       maps); Float64Array delta storage on dent history;
       pooled `_dentPreSnapshot` scratch; mutable scratch
       return from flow samples (mirrors PR #58 pattern);
       cadenced `mergeAmmoDrops` via new PerfController
       `dropMerge` task.
    Multiple Phase 1 follow-up items are now partially or
    fully addressed by this PR — see decision #29.5 below
    for impact on the runway. Validation deferred: PR body
    explicitly defers manual smoke tests to user; `npm run
    build` is the only confirmed gate. PR #58 hot-path
    reductions confirmed intact.

29.5. **PR #60 impact on the planned runway.** Items the
      over-delivery materially affected:
      - **`momentum-collisions` (decision #22) — still
        pending.** Inverse-mass flow variability (Part F)
        and ammo mass-weighted velocity blend (Part G) are
        velocity+mass-aware, but neither audits
        `PhysicsSystem.resolveCollision` impulse. The
        general impulse path was untouched.
      - **`material-balance-pass` parked items (decision
        #27e/f) — partially addressed.** Rock fragment count
        now scales with size (#27e covered for rock).
        Per-material shard mass retune (#27f) was NOT
        touched — plastic shards reverted to free-drift
        baseline, but the rock/glass/metal mass curves
        weren't tuned. Could remain parked or be revisited.
      - **`material-palette-pass` (decision #21) —
        partially addressed.** PR #61 ships the automata
        piece (per-material directions, not warm/cool
        sub-arcs). Palette adjustments still pending — see
        `material-palette-residual` task.
      - **Cross-material transmute on contact.** New
        mechanic not previously in the plan. Plastic-shard
        contacting any non-plastic non-nebula partner adopts
        the partner's material at its current size. This is
        a significant behaviour change; flag if the
        playtest pass reveals unintended interactions.
      - **Plastic-tile snap, dent recovery, tile-colour
        blend.** New mechanics that materially change
        plastic's feel beyond a "standard polygon shard"
        revert. Reasonable interpretation of "preserve the
        plastic sticks to things feel" but worth noting.
      - **Metal as "deliberately lossy"** (PR body language):
        break count = tier × 3, below the 6/tier it took to
        build. About half the metal mass is destroyed on
        break. Material-economy implication for any future
        balance pass.
      - **Ammo base-value=1** halves-or-better the player's
        ammo intake. Worth playtesting before Phase 2 (f)
        Timed waves since it intersects with combat pacing.

30. **material-palette-pass (PR #61) shipped automata only;
    palette work carved into `material-palette-residual`.**
    Decision #21 had two pieces: palette adjustments + the
    automata coloring extension. PR #61 shipped the
    automata piece (605/-61 across 10 files) but skipped
    the palette adjustments entirely. The shipped automata
    diverged from the brief's "warm sub-arc for
    rock+plastic / cool sub-arc for glass+metal,
    neighbour-count gated" — instead each material got its
    own direction:
    - **glass** = opacity bipolar around neutral
      (~3-of-6-neighbour = 1.0× default; sparse edge tiles
      → 1.55×, dense interiors → 0.45×).
    - **rock** = darkens toward shared
      `ROCK_AGGREGATION_TINT_FLOOR` (0.55). Tile
      neighbour-count AND shard density-tier share the
      same floor. Shatter colour-pop fixed: dent shards
      inherit parent tile's density tier
      (`DropSystem.inheritedTileDensityTier`, all three
      spawn paths).
    - **metal** = brightens via shard-layer density
      tiers (6 shards = 1 layer; ceiling at tier 6).
      Density tier drives brightness AND HP (×tier) AND
      break count (tier × 3 — deliberately lossy).
    - **plastic** kept the PR #55 neighbour-brightness
      automata + the nebula-blend hook (from PR #60
      Part B).
    - **indestructible** intentionally excluded — no
      automata, no density.
    Acceptable as shipped — per-material directions read
    correctly in play and the variant-specific behaviour
    (metal density tier as ladder, glass opacity
    bipolar) is richer than the original spec. **Residual
    palette work** queued as `material-palette-residual`:
    metal de-white + shiny-ready blue range; rock red+blue
    palette. The big metal density-tier system from PR #61
    + the planned palette adjustment together would push
    "shiny metal" close to completion — flag for whether
    `shiny-metal-render` (parked under decision #27d)
    still needs its own task afterward.
    Resolved by user direction (branch-review session): the
    original hue-lerp / warm-cool sub-arc equilibration
    extension (decision #21b) is **dropped** — the palette
    adjustments in `material-palette-residual` alone close
    out decision #21's remaining scope.

31. **momentum-collisions (PR #63) — model tight-line
    execution.** 2 commits, +78 / -16 across 2 files,
    exactly the discipline the brief asked for. Audit
    outcome was **(i) coefficient tune** — every impulse
    site (`resolveCollision` full SAT path,
    `resolveAsteroidPair` circle fast path,
    `resolveCompositeShardPair` PR #57 composite path)
    already used the standard normal-impulse
    `j = -(1+e)·(v_rel·n) / (invA + invB)` with both
    velocities + both masses. No gate leaks; `passThrough`
    nebula-only as designed, sleep gate awake↔asleep wakes
    correctly, settled-pair gate requires near-zero
    relative velocity. The mass-dominant *feel* was the
    natural inverse-mass split: light striker hitting 16×
    heavier target transferred only ~9% of closing speed
    at `e=0.5`.
    Two new constants land:
    a. **`COLLISION_CONFIG.MASS_BIAS_EXPONENT = 0.5`** —
       compresses the mass ratio in the velocity split at
       all three sites identically. `effInv = invMass ^ k`
       feeds the impulse calc. 16×-heavier target now
       picks up ~30% of closing speed (3.4× prior). Light
       striker's rebound drops from 1.41× to 1.2× closing
       speed, reading as "pushing through" rather than
       bouncing. **Properties preserved:** equal-mass
       pairs unchanged at any exponent (split is
       normalized, scale-invariant); static entities
       unchanged (`0^k = 0`, so bounces off tiles/walls
       identical); positional correction keeps the true
       mass split so heavy bodies aren't teleported by
       light debris. `1.0` restores exact physics. Tier
       table for retuning: exponent 0.75 → ~17%, 0.5 →
       ~30%, 0.25 → ~50% (1:16 mass ratio, e=0.5).
    b. **`STRUCTURE_CONSTANTS.CRASH_VELOCITY_RETENTION =
       0.65`** (was hardcoded 0.5) — player crash-through
       retains 65% of velocity per broken tile, so plowing
       a 3-tile row retains ~27% of entry speed instead of
       ~12%.
    `ELASTICITY` left at 0.5 — with the bias, light side
    rebound already softens; changing `e` would alter
    equal-mass feel which wasn't the complaint.
    AskUserQuestion calibration: "Moderate ~30%" (the
    target-pickup level) and "Keep 65%" (crash retention).
    Validation: `npm run build` clean; manual smoke tests
    deferred to user playtest.
    **Three deferred follow-ups in PR body:**
    a. Player plow cost rises with the bias — player↔
       light-shard contacts now shed ~19% of closing speed
       each (was ~6%). If dense shard fields feel draggy,
       a per-pair-class exponent (player pairs pinned
       nearer 1.0) is the next knob. Deliberately not
       shipped to keep one global coefficient.
    b. Asteroid→tile crash retention (`×0.85`) and bespoke
       projectile push factors (`massRatio × 0.3` for
       pierce + dent `pushFactor`) are independent
       mini-models that bypass the impulse formula —
       consistent but untuned. Candidates for a later
       pass if projectile shove reads wrong.
    c. `resolveAsteroidPair`'s orphaned doc comment
       ("Cheap circle-only collision resolver…") sits
       ~400 lines above the function it describes. Pure
       cosmetic cleanup.
    Closes the momentum-collisions task; next per the
    tight line is the playtest pass, then Phase 2 (f)
    Timed waves.

32. **exotic-enemy roster (PR #67) — a full third-party ecosystem,
    over-delivering the (h) precursor scope across many sessions.**
    Built as the enemy-content run that precedes Phase 2 (h) bosses.
    Base branch `claude/game-feedback-plan-UN3MV`; ~55 commits over
    several sessions. What shipped is far broader than the original
    (h) "shielded boss + Mega-Man-X weapon bosses" line — it's a
    reusable enemy-behaviour toolkit plus a neutral/third-party fauna
    ecosystem. Stages:
    - **Structural (Stage 2/3)** — AI behavior-dispatch table
      (`ENEMY_BEHAVIOR[subtype].move` → `moveStrategies`);
      `countsTowardWave` wave accounting; three reusable primitives
      (provoked-on-hit, consume-and-grow, attach+disable).
    - **Stage 0** — Kamikaze (instant on-contact AoE) + Bulwark
      (rotating directional arc shield that DEFLECTS covered shots).
    - **Stage 1** — Turret (stationary, rotates to aim, homing missiles).
    - **Stage 4** — Swarm + Nest (pop-on-contact gnats simplified across
      systems; hive that births capped, non-wave-gating brood).
    - **Stage 5** — Bubble: ambient third-party fauna — flow-riding,
      eats/digests shards (mass-conserved, heals), splits, sickens on
      toxic shards, latches+EMPs then knocks free; retaliates against
      any attacker.
    - **Stage 6** — Dragon: engine-managed serpent mini-boss whose body
      is a real Snake of devoured tiles (shootable / severable), neutral
      until attacked; enters/leaves via portal.
    - **Stage 7 — Rivals** (this session's headline): player-like
      privateer ships (bespoke `RivalInstance[]` roamers rendered from
      the retired enemy PNGs) that hunt the WAVE enemies and STEAL the
      player's kill points (`killedByRival` denial) + loot (vacuum),
      with three dispositions (hostile / ally / neutral). Warp in on a
      SCORE cadence (every 1000 pts, capped 6) and roam 280s (10× the
      dragon). Fly with the player's own thrust/friction movement model.
    This session also: redesigned the dragon HEAD (geometric space-
    serpent, iterated from organic → detailed → pared-back per user);
    doubling dragon kill payout (3000 × 2^kills); the dragon PORTAL
    fly-through leave, then abstracted the rift VFX into a reusable
    `GameEngine.openPortal(pos, opts)` (dragon + rivals share it);
    GENERALIZED the hit-reaction scale-punch to `damage / maxHealth`
    (`hitReactStrength`, new `hitReact` field) so chip hits on tanky
    beasts barely flinch. Rival bugfixes worth noting for anyone
    extending them: (a) pooled-projectile flag bleed — the rival-shot
    flags (`hitsEnemies` / `sparesPlayer`) are stamped after spawn, so
    `ProjectileSystem`'s pool-reuse path MUST clear them or recycled
    player/enemy shots inherit them and phase through targets; (b)
    sprite rotation needs the player's 3π/4 art offset
    (`RIVAL_ROTATION_OFFSET`), and rivals draw 1:1 so hull == hitbox;
    (c) hit/damage indication (punchy sprite flash + disposition-coloured
    health bar). **Deviations vs plan:** the whole neutral/third-party
    axis (bubble, dragon, rivals) is net-new mechanics NOT in the (h)
    spec — (h) bosses (shielded open/close boss, weapon-type bosses,
    per-run weapon unlocks) remain UNbuilt and still pending. **Two
    follow-ups queued before continuing the plan:** an
    `exotic-enemies-optimization` perf pass (see the task row) and an
    exotic-enemy BALANCE pass (parking lot — Bulwark shield slew, Sniper
    power, rival/dragon tuning). Validation: `npm run build` per commit;
    manual playtest owed.

33. **exotic-enemies-optimization — zero-behaviour perf pass over the
    heavy roamers (Rivals / Dragons / Bubbles).** Follow-up to PR #67,
    same posture as PR #58/#63: identical gameplay + visuals, only
    cheaper. Four changes, each build-clean:
    - **`rivalScan` PerfController task.** `updateRivals` ran two
      full-list walks per rival every step — the `O(rivals×enemies)`
      target scan and the `O(rivals×drops)` loot vacuum. Both now gate
      on `rivalScan` (`minInterval 1, maxInterval 4`), with the chosen
      target CACHED on `RivalInstance.target`; steering/firing/lifecycle
      still tick every step against the cache, recomputing only the O(1)
      distance. `min 1` → byte-identical at low load; stretches to 4 only
      under real pressure. The deferral of which enemy is re-picked / when
      a drop is snatched is ≤3 steps — imperceptible.
    - **`updateAttachments` full-scan removed.** The bubble latch resolved
      its target through `entityById` — an `O(all-entities)` master-list
      walk (≤~2 700). Swapped for `resolveAggroTarget` (player special-case
      + small enemies index). `entityById` deleted.
    - **Dragon-head + bubble render caches.** The geometric dragon head
      rebuilt 3 `createRadialGradient`s (7 stop-parses) per dragon per
      frame; the bubble membrane rebuilt 1. Skull + maw + membrane
      gradients now cache on the entity (keyed like `enemyBodyGrad`), the
      dragon's per-frame energy pulse riding `globalAlpha` (provably
      equal — the maw/bloom fade to a=0 at the rim). On-screen dragon
      render cost stops scaling with per-frame gradient churn, so the win
      GROWS with FOV (a desktop viewport draws more dragons than a tablet).
    - **Allocation discipline** in the new/touched loops (cached target,
      component-compared bubble cache key — no per-frame string alloc).
    Deviations: **none removed / capped / down-cadenced perceptibly**, so
    no AskUserQuestion approval gate was needed. Deferred to the parking
    lot (zero-behaviour posture): a dynamic-grid query for the
    `updateConsumers` `O(consumers×shards)` scan (needs a new
    `forEachDynamicNear`; already `consume`-gated), and cutting
    portal/death particle-burst counts (a visual change). Verified: `npm
    run build`; headless Chromium smoke (10 DBG dragons + 6 rivals +
    ambient bubbles, ~2.7–2.8k entities, teleported on-screen in
    provoked+flash states, 3.5 s render at 1024×768 AND 2560×1440 → 0
    console/page errors, all render paths correct). Report +
    per-scenario table + parity checklist:
    `docs/EXOTIC_ENEMIES_OPTIMIZATION.md`.
    **Post-merge follow-ups (same PR #69, driven by real-hardware Perf REC
    captures the user pasted back):** (5) cosmetic shockwave rings
    (damage-0/knockback-0 portals) now skip the O(all-entities) `validHitIds`
    snapshot in `spawnShockwave` — kills most of the spawn-burst hitch,
    zero-visual. (6a) `ParticleSystem`'s per-spawn `enforceTypeCap` (two
    O(all-entities) walks per spawn call — ~456k iterations on a mass-death
    frame) batched to ONCE per frame in the engine loop; zero-visual (cap +
    dropped-oldest identical, verified a 20-dragon burst clamps to exactly 400).
    (6b) **APPROVED VISUAL CHANGE** — burst particle counts trimmed ~40 %
    (enemy death 16–24/9 → 10–13/5, portal 30/16 → 18/10, dragon death 40 → 24;
    gnat 5 unchanged). This is the one intentional visual deviation in the PR;
    the user was asked via AskUserQuestion ("Both 2a and 2b") and approved it.
    Finding that reframed it: `MAX_PARTICLES=400` already bounds render, so the
    mass-death hitch was the `enforceCap` rescans (6a), not particle count — the
    count cut (6b) is a minor extra. A separate physics/shard-broadphase perf
    target (a 6k-shard field pegged max tier: sim 4.74ms + collisions 2.56ms)
    was logged to the parking lot as OUT OF SCOPE for this session. Also shipped:
    an in-game Perf REC harness (`engine/systems/PerfRecorder.ts`) for
    iPhone-friendly copy-paste FPS captures. Next per the tight line: the
    exotic-enemy BALANCE pass (parking lot), then Phase 2 (h) bosses.

34. **Game-structure + item-economy strategy workstream
    (design gate for the rest of Phase 2).** Opened by user
    direction 2026-06-14. Context: the (f) stage
    over-committed (the exotic-enemy roster of decision #32 +
    the optimization pass of decision #33), and before
    continuing the main plan the user wants the actual game
    structure decided:
    a. **Structure axis** — survival waves of enemies vs
       discrete levels + bosses vs open-world exploration
       (or a staged/hybrid combination; user flagged "there
       may also be two stages to this").
    b. **Item-economy axis** — ammo/health pickups only
       (today's model) vs mineral/material drops + item
       creation at map hubs vs health/gold drops only, or
       combinations. Note the dormant hooks already in
       code: `gold` on the player entity (unused),
       `enemyTier` (set on spawn, unused by drop scaling),
       `dropComposition` (can in principle hold more
       variants), and the whole material/shard taxonomy
       (rock / glass / metal / plastic) which maps
       naturally onto a material-drop economy.
    c. **Long-term constraint** — user has a post-plan
       roadmap: multiplayer mobile app connecting in-game
       map locations to real-world lat/lon coordinates.
       Implemented AFTER this feedback plan completes, but
       the structure + economy designed now must not
       foreclose it. Implications to weigh during design:
       map identity as a first-class network (portals ↔
       physical locations), durable player progression
       (inventory / upgrades / unlocks that outlive a run —
       today the game has NO persistence beyond in-memory
       run state per CLAUDE.md §1), serializable economy
       (server-authoritative later), mobile input+perf
       (c2 and the ongoing optimization passes align).
       Details of this roadmap to be captured when the
       user provides them.
    d. **Process** — this is an orchestration-owned DESIGN
       workstream, not a code session. Deliverable: a
       strategy doc (`docs/GAME_STRUCTURE_STRATEGY.md`)
       developed with the user, which then re-scopes (h)
       and (k) briefs. Phase 2 rows for (h) and (k) are
       gated on it. Phase 3 pairs are NOT gated (UI /
       SFX / input polish is structure-agnostic), except
       (i) death/completion screen copy may shift with the
       structure choice.

35. **Reconciliation audit 2026-07-06 — four merged PRs were
    never logged in this doc.** Full PR sweep against the plan
    branch surfaced #64 / #65 / #66 / #70 as shipped-but-
    unrecorded (plus #59 closed UNmerged — the nebula-puff
    sprite attempt off the PR-45 feedback merge — and #68, a
    docs-only parking-lot PR sharing #67's head branch).
    a. **PR #64 — (f) shipped, model superseded.** "Timed
       waves" became **completion-based waves** mid-branch:
       wave ends when budget fully spawned AND field cleared;
       the clock only grades an early-clear speed bonus;
       survivors carry over. So original feedback (f)'s
       literal ask ("timed waves … until time is up") was
       consciously replaced — record this as the wave-model
       decision of record. Also shipped, far beyond (f):
       the scoring spine (kill points, combo, ticker,
       killedByPlayer attribution), the golden snitch, the
       run-progression spine (Augments / Modules / Drydock /
       Salvage — the run starts lean, score mirrors 1:1 into
       spendable Salvage), the counterplay layer
       (ENEMY_TRAITS armor + status-effect framework), and a
       ground-up enemy visual redesign. **The progression
       spine is directly load-bearing for decision #34's
       item-economy axis — a v1 economy already exists.**
    b. **PR #65 — material damage system.** Crack overlay,
       probabilistic rock break (hit ceiling model),
       conservation-of-mass chipping (chips shed on every
       non-killing hit; asteroids shrink by chip footprint;
       rock dust re-condenses to rock).
    c. **PR #66 — enemy perf + nebula material condensation.**
       Enemies release colour-matched nebula on death; nebula
       hue selects which material a cloud crystallises into
       (mass-conserved, per-material unit costs).
       **Economy-relevant: enemy deaths already seed the
       material loop.** Combined with #64's Salvage economy,
       the item-economy axis of decision #34 is not a blank
       page — the strategy should decide what to EXTEND, not
       what to invent.
    d. **PR #70 — physics/shard broadphase + render-GC
       pooling** (merged 2026-07-06). Measure-first. Render-
       bucket pooling halved peak render on heavy scenes.
       Four user-approved behaviour changes (player↔nebula-
       shard pass-through + swirl, gnat terrain collisions,
       trail default VELOCITY, tile repel push off by
       default). Remaining O(k²) shard-pair spike at extreme
       density parked with sketch in `docs/PARKING_LOT.md`.
    Process note: these landed while the orchestration
    session was between check-ins — the "enemy pass" and
    "optimization pass" the user referenced on 06-14 turned
    out to be this batch plus #67/#69. Going forward the
    reconciliation default is a full PR-list sweep (not just
    merge-commit reading) whenever the user says work landed.

36. **Strategy adopted — decision #34 RESOLVED
    (2026-07-08).** The user synthesized the structure +
    economy strategy across external design discussions;
    captured verbatim-ish as `docs/GAME_STRUCTURE_STRATEGY.md`
    (the deliverable decision #34d called for). Headlines:
    a. **Vision** — Omni evolves toward a living universe
       simulator in four layers: Physics (shipped), Structure
       (mostly shipped), Meaning (landmark recognition — next
       major goal, NOT this plan), Ecosystem (long-term).
       Guiding principle: the simulation creates
       opportunities; the player discovers, influences, and
       exploits them.
    b. **Structure resolution** — the CURRENT plan stays a
       high-fidelity submap/arena game. The continuous
       overworld (travel, stations, NPC traffic, map
       identity, exploration) is the NEXT overhaul. The
       lat/lon multiplayer phase follows that.
    c. **Economy resolution** — purchase-based, extending the
       shipped Salvage/Drydock spine (hulls, weapons,
       hardware, modules). NO crafting trees, NO
       inventory-heavy material collection. Materials stay
       physical; players interact with emergent structures,
       not shard vacuuming. Mining (formations/deposits, NPC
       operations) is an overworld-phase concern.
    d. **Persistence resolution** — three scales: Temporary
       (combat, wave progress), Ship (purchased hardware,
       owned ships, modules), World (landmarks, stations,
       discoveries). "The world remembers geography more than
       individual battles." Implementation of durable
       persistence is post-plan; nothing in this plan should
       foreclose it.
    e. **Plan impact** — (h) un-gated (bosses = submap
       special encounters; reconcile weapon-unlock with
       Drydock in design phase); (k) un-gated + re-scoped
       (portals ride a new thin map-descriptor layer — the
       plan's one deliberate overworld extension point);
       living-entity closed as superseded by the Bubble;
       orbital-fields-moons moved to the Overworld plan.
       Three strategic guardrails for all remaining sessions:
       (1) every new mechanic should be an expression of the
       material simulation; (2) design for pattern
       recognition, not recipe memorization; (3) preserve
       clean architectural boundaries — expose extension
       points, don't build the overworld early.
    f. **Completion roadmap** — see the "Completion roadmap"
       section before Phase 3. After the final ship-it PR,
       a NEW plan doc + branch opens for the Overworld
       overhaul; this file then goes read-only as history.

37. **Weapons-ammo plan adopted (PR #71) — economy pivot;
    scope flags ruled (2026-07-11).** Roadmap step 0 complete.
    The design session returned a PIVOT, not a tuning pass;
    `docs/WEAPONS_AMMO_PLAN.md` is the design doc of record
    (audit, settled design, per-weapon job statements,
    pricing, trait-counterplay map, sequenced increments).
    Headlines:
    a. **Ammo deleted as a system** — no drops/pool/per-shot
       costs/HUD/dry-fallback. Weapon pressure = cooldown +
       loadout commitment. Magazine augment dies; Autoloader
       becomes the premium (steepest-priced) weapon stat.
    b. **Salvage becomes a physical collectible drop**,
       replacing ammo at every source; the `awardScore` 1:1
       score→Salvage mirror is REMOVED (score = performance,
       Salvage = collected wealth; rival loot-vacuum steals
       money). Health drops unchanged.
    c. **Purchase-only progression** — wave-completion
       upgrade cards + the 18% free-unlock lottery are
       removed; stat upgrades join the shop on a real
       per-level escalating `upgradeCost()` curve.
    d. **Weapons = 2-slot equip loadout** — new run: Blaster
       + empty; any 2 owned weapons equip; Blaster fully
       swappable; swaps are station-only once the station
       lands (interim: pause-menu Drydock — note the
       commitment mechanic has no teeth until 1e ships).
    e. **Boss gate ANSWERED — model (d):** bosses grant
       salvage and/or shop discounts; weapons stay purely
       purchased; NO unlock plumbing. Weapon-bosses wield
       themed variants of the literal player archetypes via
       the existing `Partial<WeaponConfig>` override pattern.
       (h) consumes doc §6 + the §7 trait-counterplay table.
    f. **Scope-flag ruling (user, 2026-07-11): station-poi
       ACCEPTED; waves-to-nodes DEFERRED to the Overworld
       plan.** Rationale: the station is what gives the
       purchase economy + loadout commitment teeth, one
       bounded medium session, and a legitimate guardrail-#3
       extension point; waves-to-nodes restructures where the
       core loop lives (the overworld's layered-map thesis
       arriving early) and would double (k)'s scope — (k)
       stays thin as scoped in #36e. Consequences: (h) bosses
       stay BASE-MAP wave capstones; waves keep running on
       the base map for the rest of this plan (resolves doc
       §9 open question 3); the station-poi brief MUST define
       a mid-wave docking rule (the doc's station design
       assumed a combat-light map).
    g. **Sequencing** — increments land per doc §8 as
       re-scoped: salvage-drops → ammo-removal + loadout-2
       (with the §3 Bouncer/Lightning cooldown compensation
       in the SAME PR) → purchase-only-progression →
       weapon-identity-tuning (incl. Pierce Beam/Bouncer
       naming unification) → station-poi → (h). Remaining
       doc-§9 open questions (salvage death penalty, absolute
       pricing, Overcharge+Cannon ceiling, snitch salvage
       payout) are owned by the implementing sessions at
       tuning time. CLAUDE.md discrepancies found in the
       audit (doc §1.4) go to the punch list.

38. **Economy-pivot increments 1a–1d SHIPPED (PR #72,
    2026-07-12).** All four on one PR (one commit each),
    reviewed against the briefs pre-merge — clean: every
    fence held (Burst/Cannon/Blaster/Shotgun untouched, no
    station code, no enemy scaling), ammo survives only as
    comments, build + headless smokes green. Implementation
    decisions made in-session (recorded in the PR body):
    a. **"Laser"** is the unified player-facing name for
       WeaponType.BOUNCER (user pick — ricochet may later
       generalize to a projectile-vs-shield feature, so the
       weapon shouldn't claim "Bouncer" as identity). Code
       identifiers unchanged. Supersedes WEAPONS_AMMO_PLAN
       §3's "pick Pierce Beam or Bouncer".
    b. Salvage renders **silver scrap-glint**, deliberately
       NOT gold — gold "+N" popups mean score, which no
       longer pays money.
    c. Laser rebalance took the **cooldown lever**
       (0.40→0.55), not per-beam damage — same axis as
       Lightning (0.50→0.65), prices the spam free ammo
       used to tax.
    d. First-pass economy numbers (all provisional pending
       playtest): CREDITS_PER_SALVAGE=1000; wave-clear spray
       3 salvage; snitch catch sprays 8; upgradeCost() =
       base × ratio^level (Hull/Plating 4k@1.45× …
       Autoloader 10k@1.6× steepest). Arithmetic puts the
       first weapon at wave 2–3 (§5 target met) and the §5
       purchase order holds.
    e. Small additions beyond brief, accepted: buying a
       weapon auto-equips into the first empty slot;
       Plating/Capacitor render visible-but-locked
       ("🔒 SHIELD") until Shield is owned; renames
       AMMO_DROP_PULL→DROP_PULL, mergeAmmoDrops→mergeDrops.
    f. **Playtest watches** (flagged, unchanged): pacing
       without the card breather (grace timer + clear spray
       is the beat now); Overcharge+Cannon free-AoE ceiling
       (lever = charged cooldown, never a resource);
       absolute prices/income scale.
    g. Nit for the punch list: stale ShardSystem.ts comment
       still says "Ammo drops" where it means collectible
       drops generally.
    Next: 1e station-poi in a breakout session (separate
    PR), then (h) bosses.

39. **station-poi (PR #73) — 1e shipped + the plan's biggest
    over-delivery: Overworld hub map + hex-module outfitting
    (2026-07-24).** The brief's core landed cleanly (station =
    INTERACTABLE + mass ∞ + no dropType → zero broadphase/
    static-grid/flow-field side effects; sim-freeze docking via
    the old card-modal short-circuit; commerce relocated with
    real commitment teeth — `moveModule` rejects undocked;
    pro-rated pay-per-HP repair; CLAUDE.md + parking lot kept
    in sync; plan doc untouched). Beyond the brief (~2.1k
    insertions, user-driven in-session):
    a. **OVERWORLD map** — new wave-free full-game MapType:
       three stations (HOME center / SHIPWRIGHT / ARMORY, plus
       a TRADE HUB variant defined), ambient fauna + score-
       cadence rivals + an auto-respawning roaming dragon,
       player spawns dock-adjacent at HOME.
    b. **Hex-slot module outfitting REPLACED the 1c
       progression substrate** (UPGRADE_DEFS / UNLOCK_DEFS /
       upgradeCost() DELETED one week after 1c built them —
       churn cost noted): every piece of progression is a
       discrete Mk I/II/III module item; adjacency
       requirements with an active-set fixpoint; 12-tile
       inventory honeycomb + drag-and-drop; weapon weight/
       drag; removable Blaster (weaponless flight); guns
       capped at 2 mounted — `equippedWeapons` is now DERIVED
       from the gun hexes (WeaponSystem untouched); sell-back
       90% docked / scrap 9% anywhere; pause-menu read-only
       cargo panel. Free Base Hull starter (adjacency root).
    c. **Mid-wave docking rule resolved BY ARCHITECTURE**:
       stations exist ONLY on the wave-free Overworld, so
       docking and waves never coexist. Valid — but the
       CONSEQUENCE is a currently DISJOINT game: wave maps
       have no commerce (DBG grants are the test path), the
       Overworld has no waves, and NO in-game path connects
       them. A run cannot yet span earn → outfit → fight.
    d. **(k) is therefore upgraded from "thin extension
       point" to THE KEYSTONE of the loop** — portals must
       connect Overworld ↔ wave maps AND carry run state
       (credits, inventory, outfit, score) across map
       transitions; nothing does that today
       (resetAndLoadSelectedMap resets everything). This is
       (k)'s real scope beyond the portal entity +
       descriptors.
    e. **waves-to-nodes deferral MOOTED in substance** — the
       hub exists, the existing wave maps ARE the nodes, and
       (k) connects them; the WaveSystem re-plumbing we
       deferred turned out unnecessary. (h) bosses converge
       back to "node capstones" naturally (wave-map
       capstones).
    f. **Guardrail tension seen and accepted**: the strategy
       doc says avoid inventory-heavy systems; hex
       cargo/outfitting is EQUIPMENT inventory (purchases —
       materials stay physical), so the economy philosophy's
       letter survives, but this is deliberately close to the
       line. Ship catalog (Option A, parking lot) is the
       chosen future direction; capacity ceilings
       (MAX_INSTALLED_GUNS=2, INVENTORY_CAPACITY=12) are
       ship-stats-in-waiting — no standalone slot purchases
       meanwhile.
    g. New parking-lot entries from the session (triage
       pending user ruling): NPC station traffic, salvage
       death penalty (now with an uninsured-cargo option),
       economy & progression tuning pass (bucket of 5
       provisional-number debts), persistent state (gated on
       the tuning pass; Overworld-plan opening act),
       pause-menu stat legibility.

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
| perf-hotpath | Hot-path allocation + math reductions | shipped (PR #58, merged into plan branch) | `claude/gallant-gauss-btopZ` | **Zero behaviour changes** — pure scalar / allocation rewrites. AISystem reuses `liveIds` Set scratch + mutates `laggedTargets` / `lastPositions` in place; GameEngine mutates `camera.shakeOffset.x/y` in place; PhysicsSystem `fillAxes` folds divisions, `applyGravity` / `applyLocalGravity` hoist `clampedForce/dist`; ProjectileSystem `updateHoming` / `updateLightningGravity` cache winning dx/dy; RenderSystem trail strip pre-computes edge normals into Float32Array scratch, off-screen indicator caches sqrt, glass proximity tints get squared-range early-out, weapon HUD uses pre-computed slot labels. New `engine/systems/enforceCap.ts` consolidates the FIFO hard-cap routine from ParticleSystem + ProjectileSystem. Flagged but not in scope: EntityIndex conditional rebuild, broadphase dense-cell cap, per-entity cached SAT axes, ShardSystem merge-broadphase Map/Set reuse. See decision #28. |
| plastic-revert | Strip plastic-softbody divergence; restore standard shards | shipped — massively over-delivered (PR #60, merged into plan branch) | `claude/plastic-revert-RhPVQ` | Original revert scope (Parts A/B/C) landed clean: softbody render + schemas + DBG cycles + internals stripped; palette cycle + neighbour-brightness + nebula-blend kept; new `BondPartnerConfig` type with cohesion-only flag + per-partner `strength` tier; `plastic-shard.bondsWith = { exclude: nebula }` with per-partner config. THEN iterated across Parts D–I (decision #29): plastic self-merge growth, cross-material transmute on contact, plastic-tile snap at 1.5× hex, per-dent snap-back recovery with HP/colour rewind, heavy `attractedTo` gravity, annular pull gate, 5× flow-field affinity, new `mergeCount` field generalized across all shards, metal composite decomposition, unified shard→tile snap across plastic/glass/metal, metal excess absorption + density-aware build, rock condense extended 5→25 tiers, density-aware rock HP + size-keyed fragment counts + mixed-density children, ammo drops follow flow, inverse-mass flow variability, ammo drops base-value=1 + adjacent merge + mutual pull, new DBG cycles (`Shard pal`, `P glow`, `M glow`, `M color`), perf hot-path sweep. |
| material-balance-pass | ~~Reduced shard counts + per-material mass retune + momentum audit~~ → see `momentum-collisions` | replaced earlier | — | Scope narrowed: shard-count reduction and per-material mass retune dropped from this batch (parked under decision #27); only the momentum / velocity-in-collisions piece carries forward as `momentum-collisions` below. PR #60 incidentally addressed adjacent items (rock fragment count now scales with size, inverse-mass flow variability) but did NOT touch impulse resolution. |
| momentum-collisions | Velocity-aware collision impulse | shipped — model tight-line discipline (PR #63, merged into plan branch) | `claude/momentum-collisions-audit-nnr28e` | Audit outcome **(i) coefficient tune** — all three impulse sites (`resolveCollision` full SAT, `resolveAsteroidPair` circle fast path, `resolveCompositeShardPair` PR #57 per-cell composite) already used the standard normal-impulse formula with both velocities + both masses. No gate leaks. Feel issue was the natural inverse-mass split. Fixed by introducing `COLLISION_CONFIG.MASS_BIAS_EXPONENT = 0.5` — compresses mass ratio in the velocity split at all three sites identically (16× heavier target now picks up ~30% of closing speed, 3.4× prior). Equal-mass pairs unchanged. Static entities unchanged (`0^k = 0`). Positional correction keeps true mass split. Plus `STRUCTURE_CONSTANTS.CRASH_VELOCITY_RETENTION = 0.65` (was hardcoded 0.5) so player crash-through retains more velocity per broken tile. AskUserQuestion chose "Moderate ~30% / Keep 65%". 2 commits, +78/-16 across 2 files. Three deferred follow-ups in PR body. See decision #31. |
| material-palette-pass | Material palette adjustments + automata coloring extension | **automata shipped (PR #61); palette work split out below** | `claude/material-tile-automata-BXXKt` | Automata-coloring extension shipped, but with **per-material directions** instead of warm/cool sub-arcs (see decision #30): glass = opacity bipolar around neutral, rock = darkens toward shared floor (tile neighbour-count + shard density tier aligned), metal = brightens via density-tier ladder (6 shards = 1 layer). Rock shatter colour-pop fixed (dent shards inherit parent tile's density tier). Metal got a full density-tier system: cells track in `densityTier`, render per-cell mixed shades, snap on rest speed, density drives brightness + HP + break count. One master `Tile shade` DBG toggle. **Palette-adjustment piece NOT shipped** — metal still includes white shades; rock palette unchanged. Carved out as `material-palette-residual` below. |
| material-palette-residual | Metal de-white + rock red/blue palette | pending | `claude/material-palette-residual-<suffix>` | Carved out of `material-palette-pass` (decision #21) after PR #61 shipped the automata piece. Small palette-only task: remove white from metal palette and add a shiny-ready blue range; add red+blue to rock palette so the existing rock-aggregation darkening reads warmer/cooler depending on cluster context. No automata changes (already done), and the original hue-lerp / warm-cool sub-arc extension is **dropped per user direction** — this palette work closes decision #21 entirely. See decision #30. |
| map-composition | Mixed clusters + MAP_POPULATION authority | pending | `claude/map-composition-<suffix>` | **Promoted from side-cleanup.** Two pieces: (1) flip natural maps (UniverseMap / PocketMap / SevenRingsMap) to read tile-variant ratios from `MAP_POPULATION` instead of hardcoded subclass literals. (2) New cluster-composition rules — rock mixed around metal-tile clusters; plastic mixed with glass-tile clusters. Touches MapClasses subclasses + MAP_POPULATION schema. See decision #23. |
| minimap-faithfulness | Minimap colors match screen + nebula transparency | pending | `claude/minimap-faithfulness-<suffix>` | Small UI task. Minimap tile colors should closely match the on-screen tile colors (not the simplified swatches today). Nebula tiles and shards drawn with reduced alpha on the minimap to read as "thin / fog" rather than solid. Touches `MINIMAP_CONSTANTS` + UIOverlay minimap render. See decision #24. |
| living-entity | New non-threatening grazer entity | **closed — superseded by the Bubble (PR #67)** | — | Decision #20's design surface (wanders, eats glass/rock/metal shards, grows, splits, non-threatening) shipped in spirit as the Stage-5 Bubble: ambient fauna, consume-and-grow (mass-conserved), split at size, passive-until-provoked. Differences (bubble also eats plastic/nebula variants, and retaliates) accepted. Reopen only if a distinctly different creature is wanted. |

---

## Phase 2 — Structure (sequential, after Phase 1)

> **GATE RESOLVED (decision #36).** The strategy landed as
> `docs/GAME_STRUCTURE_STRATEGY.md`: this plan stays a high-fidelity
> submap/arena game; the continuous overworld is the NEXT overhaul.
> Economy stays purchase-based (Salvage → Drydock), no crafting.
> (h) and (k) are un-gated with the re-scopes noted in their rows.

| ID | Task | Status | Branch | Notes |
|----|------|--------|--------|-------|
| f | Timed waves of mixed enemy types | **shipped — model superseded mid-branch (PR #64, merged into plan branch)** | `claude/timed-waves-mixed-enemies-irpfug` | 44 commits, +3440/-438. The original *timed* model was **superseded by completion-based waves**: a wave ends when its full budget has spawned AND the field is cleared; the clock only grades an early-clear speed bonus (`onCleared`); survivors carry over. Scripted teach-waves 1–3, weighted-random 4+ with variety guarantee. MASSIVE over-delivery beyond (f): scoring spine (tier-scaled kill points, rapid-kill combo, integer ticker chip, `killedByPlayer` attribution for shard/tile points), golden snitch (persists across waves, per-catch speed ramp, catch = wave end + half-value enemy wipe), run progression (**Augments** = per-wave stat cards, **Modules** = Drydock unlocks bought with Salvage mirroring score 1:1, lean run start), counterplay layer (`ENEMY_TRAITS` armor v1 + status-effect framework with corrosion DoT), full enemy visual redesign across 3 styling waves, hit/death FX, render-path GC cuts. See decision #35a. |
| material-damage | Crack overlay + probabilistic rock break + conservation-of-mass chipping | **shipped (PR #65, merged into plan branch)** | `claude/material-damage-cracks-tdwyrn` | Deferred follow-up from #64, standalone task. Seeded stable fracture overlay (`drawDamageCracks`) on rocky/metal destructibles; rock `maxHealth` reinterpreted as a size/density hit ceiling with probabilistic early break (always cracks on hit 1, guaranteed break at ceiling); every non-killing hit sheds a chip (dust nebula-shard or solid rock chunk) with mass conserved — asteroids shrink by the chip footprint; rock-derived dust re-condenses into rock-shards via `fromRock` flag. Field-map dropdown fix. See decision #35b. |
| enemy-perf + nebula-condense | Enemy-behavior perf pass + nebula material condensation | **shipped (PR #66, merged into plan branch)** | `claude/enemy-perf-triage-90ka6s` | Perf: projectile glow-gradient cache (was rebuilding per shot per frame — the term that actually scales with combat intensity) + flow-field scratch vectors. **Condensation system (economy-relevant):** enemies release colour-matched nebula shards on death (`ENEMY_NEBULA_BURST`); when a cloud crystallises, blended hue selects the material via `NEBULA_MATERIAL_BANDS` (rock=red/orange, plastic=yellow/green, glass=cyan/blue, metal=indigo/violet); mass-conserved — a cloud must accumulate `NEBULA_CONDENSE[material].units` (glass/rock 2, plastic 4, metal 6), lock-in + excess-split releases remainder colours. **Enemy deaths now literally seed the material economy.** See decision #35c. |
| exotic-enemies | Exotic-enemy roster (Stages 0–7) | **shipped (PR #67, into plan branch)** | `claude/exotic-enemies-core-z0rfwn` | Precursor to (h). Kamikaze / Bulwark / Turret / Swarm+Nest / reactive Bubble / Dragon mini-boss / Rivals + the AI-dispatch-table + reusable-primitives groundwork. Over-delivered a full neutral/third-party ecosystem beyond the (h) spec (see decision #32). |
| exotic-enemies-optimization | Perf pass over the exotic roster + roamers | **shipped (into plan branch)** | `claude/exotic-enemies-optimization-nty6i8` | Zero-behaviour/zero-visual pass (decision #33). Cadenced the per-rival O(rivals×enemies) targeting + O(rivals×drops) loot vacuum through a new `rivalScan` PerfController task with a cached `RivalInstance.target` (min interval 1 → identical at low load); killed the O(all-entities) `entityById` latch-resolve in `updateAttachments`; cached the geometric dragon-head skull + maw gradients and the bubble-membrane fill gradient on the entity (per-frame pulse → `globalAlpha`), so on-screen dragon/bubble render cost stops scaling with the per-frame `createRadialGradient` churn (the win grows with FOV). Verified via headless Chromium (10 dragons + 6 rivals + ambient bubbles, 0 errors, tablet + desktop FOV). `updateConsumers` spatial-query + particle-burst counts deferred to the parking lot (zero-behaviour posture). Report: `docs/EXOTIC_ENEMIES_OPTIMIZATION.md`. |
| physics-broadphase-opt | Physics/shard broadphase optimization + render-GC pooling | **shipped (PR #70, merged into plan branch 2026-07-06)** | `claude/physics-shard-broadphase-k7m2p` | Measure-first follow-on to #69, driven by iPhone Perf REC captures. Zero-behaviour: per-pair invMass/effInvMass cache + numeric `_pairSeq` dedup in `resolveAsteroidPair`; shatter-path scratch reuse; Perf REC sim sub-timer breakdown + spike attribution. **Big win:** render-bucket pooling (steady-state bucket allocation zero; peak render 17→9 ms). **User-approved behaviour changes:** player↔nebula-shard now pass-through + soft swirl (hard collision = DBG toggle, default off); swarm gnats take standard terrain collisions; player trail default → VELOCITY; tile repel push off by default (glow retained); DBG accessible while paused. Conclusion: steady state vsync-bound; residual hitches are external browser/GC stalls; the one genuine in-code spike (O(k²) shard-pair at 8k+ entities) parked in `docs/PARKING_LOT.md` with an implementation sketch. See decision #35d. |
| h | New enemies + bosses (bosses proper) | pending — un-gated, next up | `claude/bosses-<suffix>` | **Still UNbuilt** — the exotic roster above is the enemy-content precursor, NOT the bosses. Remaining: shielded boss (open/closed states; smaller "shoot-only" variant), weapon-type bosses. Debug menu bypass kept. Likely new aiState `'open'`/`'closed'`. Reuse the Stage-2/3 AI-dispatch table + reusable primitives from PR #67. **Re-scope per strategy (decision #36):** bosses are submap "special encounters" as wave capstones. Design-phase knob: reconcile the Mega-Man-X defeat-unlocks-weapon idea with the Drydock purchase model (grant Module free vs unlock purchasability vs unique boss weapon). No new progression system — everything routes through the shipped Augments/Modules/Salvage spine. |
| k | Portal to next map after N waves | pending — un-gated, re-scoped | `claude/map-portal-<suffix>` | New spawnable portal entity + GameEngine.loadMap lifecycle wiring (PR #67 already shipped the reusable `GameEngine.openPortal(pos, opts)` rift VFX; (k) builds the traversable-portal entity on top). **Two portal flavors:** cross-map AND intra-map. **Re-scope per strategy (decision #36):** destinations reference a new lightweight **map-descriptor layer** (stable map IDs + metadata), NOT bare MapType enum switching — this is the plan's one deliberate extension point for the future overworld (which will reference the same descriptors). Keep the descriptor layer thin: id, display name, MapType, spawn-point, optional traits. No overworld features in this plan. |

---

## Deferred — queued but not in current sequence

These are real follow-up tasks, not parking-lot ideas. They have committed
scope and slot into the work after Phase 2 or alongside Phase 3 polish,
but they don't gate the current sequence and should not be spawned ahead
of the items in Phase 1 follow-ups.

| ID | Task | Notes |
|----|------|-------|
| waves-to-nodes | Wave gameplay relocates into portal-node sub-maps; base map goes combat-light | **DEFERRED to the Overworld plan** (decision #37f) — the design lives in `docs/WEAPONS_AMMO_PLAN.md` §2.4/§8.6. Rejected for this plan because it restructures where the core loop happens and would double (k)'s scope; in this plan a combat-light base map is mostly empty space. The overworld plan (whose thesis IS layered maps) is the right home; WaveSystem activation re-plumbing happens there. |
| orbital-fields-moons | Orbital flow fields + moving moons with gravity | **MOVED to the Overworld plan** (decision #36) — planets and moving celestial landmarks are overworld features per `docs/GAME_STRUCTURE_STRATEGY.md`. Original sketch preserved in decision #25; it becomes an early task of the next plan, not this one. |
| voronoi-rock-fracture | Voronoi-style rock shatter, mostly-intact tile | New rock shatter algorithm. Rock shards explode off the tile in larger numbers and at higher velocities, but the tile remains mostly intact through several hits before fully breaking. Voronoi cell-based fracture if feasible; fallback to a chunkier polygon-decomposition if not. 1–2 sessions. **Partially covered by PR #65** — the `ROCK_BREAK`/`ROCK_CHIP` model already delivers the *feel* (per-hit chip-off, several hits to break, multi-piece final break). Still QUEUED for the true Voronoi cell decomposition (geometric sector chips from the tile polygon); user wants to keep it for consideration. See decision #26. |

---

## Completion roadmap (adopted 2026-07-08, decision #36)

The path to closing this plan WITHOUT growing scope. Every session below
observes the three strategy guardrails (decision #36e).

0. ~~**weapons-ammo design session**~~ — **DONE** (PR #71,
   2026-07-11; decision #37). Deliverable `docs/WEAPONS_AMMO_PLAN.md`;
   economy pivot adopted; scope flags ruled (station-poi accepted,
   waves-to-nodes deferred to the Overworld plan).
1. **Economy-pivot increments** (from WEAPONS_AMMO_PLAN §8):
   - ~~1a. **salvage-drops**~~ — **DONE** (PR #72, decision #38).
   - ~~1b. **ammo-removal + loadout-2**~~ — **DONE** (PR #72). Ammo
     deleted; 2-slot loadout; Laser/Lightning cooldown compensation
     landed same-PR per the §8 rule.
   - ~~1c. **purchase-only-progression**~~ — **DONE** (PR #72). Cards
     + lottery removed; real `upgradeCost()` curve; wave-clear salvage
     spray is the reward beat.
   - ~~1d. **weapon-identity-tuning**~~ — **DONE** (PR #72). Seeker
     6→8; player-facing name unified to **"Laser"** (decision #38a).
   - ~~1e. **station-poi**~~ — **DONE** (PR #73, decision #39) — plus
     the Overworld hub map + the hex-module outfitting rework that
     replaced the 1c substrate. Original sub-item text below kept for
     history; see decision #39 for what actually shipped.
     station entity at map center; dock
     interaction; shop UI relocates out of the pause menu; hull repair
     + station-only loadout swap. MUST define the mid-wave docking rule
     (waves stay on the base map this plan). Medium. Accepted scope
     flag, decision #37f.
2. **(h) Bosses** — BASE-MAP wave capstones (waves-to-nodes deferred).
   Consumes doc §6 (model (d): salvage/discount payouts, NO unlock
   plumbing; weapon-bosses wield themed player archetypes) + §7
   (wire evasive / front-shield / regen traits against the
   counterplay table).
3. **(k) Portals + map descriptors** — the traversable portal entity on
   the thin descriptor layer. **Upgraded to THE KEYSTONE of the game
   loop by PR #73 (decision #39d)**: the Overworld hub and the wave
   maps are currently disjoint (no in-game path; wave maps have no
   commerce), so (k) must connect Overworld ↔ wave maps via portals
   AND carry run state (credits / inventory / outfit / score) across
   map transitions — nothing does that today. Descriptor layer stays
   thin as scoped in #36e; the run-state carry is the real added
   scope.
4. **Phase 3 pairs in parallel** (below): A = (i) death screen;
   B = (a) SFX → (b) explosion variety; C = (c2) controller/joystick →
   (c1) menu help.
5. **Polish batch** — material-palette-residual + map-composition +
   minimap-faithfulness bundled into 1–2 small sessions (map-composition
   doubles as regional-identity groundwork per the strategy's
   "maps become known for characteristics").
6. **Final playtest + ship-it PR** — `claude/game-feedback-plan-UN3MV`
   → `main`, one deploy.

Explicitly OUT of this plan (moved to the Overworld plan): continuous
overworld, multi-station networks / NPC traffic / civilizations
(the single station POI of 1e is the in-plan stand-in), landmark
detection (Meaning Layer), mining operations, orbital-fields-moons,
**waves-to-nodes** (portal nodes hosting wave gameplay; decision #37f),
durable persistence. Still parked (decision #27 + parking lot):
unchanged. voronoi-rock-fracture stays deferred-optional — pull in only
if a material session has spare room; PR #65 already delivers the feel.

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
- [x] CLAUDE.md §4 still lists `nebulaFadeTimer` / `nebulaFadeDuration`
      under the nebula field category; PR #54 deleted those fields and
      unified all consumers onto `mergeFadeTimer` / `mergeFadeDuration`.
      **Done in the branch-review punch-list pass** — §4 now points
      at the shared fields.
- [x] PR #57 introduced `PerfController` as load-bearing infra; not
      yet documented in CLAUDE.md (§2 directory layout, §3 per-frame
      order, §5 constants list, §8 conventions). **Done in the
      branch-review punch-list pass** — documented in all four
      sections, plus `enforceCap.ts` (PR #58) in §2. Note: PR #57's
      `MERGE_RATE_CONSTANTS` was since replaced by
      `LOCAL_MERGE_CONSTANTS` (local-density boost); documented
      under its current name.
- [x] `ShardSystem.completeRegen` references nonexistent
      `this.regenAdapter` (field is `adapter`). `tsc --noEmit` flags
      it; `vite build` ignores it. Silent no-op on nebula-tile regen
      colour rewrite (off by default). **Fixed in the branch-review
      punch-list pass** — now calls `this.adapter`.
- [x] CLAUDE.md staleness from PRs #60/#61 (`TILE_SNAP`, `mergeCount`
      shatter generalization, `densityTier` system, per-variant
      `automata` blocks, ammo-drop value=1 + adjacent-drop merging,
      `bondPartners`/`cohesionOnly` schema, `dropMerge` task,
      `FLOW_VARIABILITY`, missing plastic-shard / metal-shard
      variant ids in §4). **Done in the branch-review punch-list
      pass** — §4 field categories, §5 constant blocks, §8
      conventions all refreshed.
- [x] CLAUDE.md discrepancies found by the weapons-ammo audit
      (`docs/WEAPONS_AMMO_PLAN.md` §1.4). **Resolved by PR #72's
      in-PR CLAUDE.md refresh**: `upgradeCost()` is now real (1c);
      the dead ammo-economy prose (incl. `ENEMY_AMMO_DROP` /
      `ASTEROID_AMMO_PROGRESSION` references) died with the ammo
      system (1b); naming unified to "Laser" (1d); the stale
      `mergeAmmoDrops` cap comment vanished in the `mergeDrops`
      rename.
- [ ] Stale comment in `ShardSystem.ts` (~line 1446) says "Ammo
      drops are no longer merge candidates" — should say collectible
      drops generally (salvage/health); ammo drops no longer exist.
      One-line cosmetic fix; ride any future PR (decision #38g).
- [ ] FF audit follow-ups #FF-1 (asteroid obstacle-aware fallback +
      diagonal wall-repulsion), #FF-2 (re-examine obstacle filter
      once any finite-mass wall-like variants ship), #FF-3 (perf
      timer for asteroid-bake path). Track via the audit doc
      `docs/FLOW_FIELD_AUDIT.md`.
- [x] **Compounded playtest debt.** PR #54's deferred manual
      playtest pass + PR #57 + PR #60 + PR #61 + PR #63. **Closed
      by user this turn** — playtest done, no regressions flagged.
      PR #63's three deferred follow-ups (per-pair-class exponent,
      asteroid/projectile bespoke push factors, orphaned doc
      comment) remain deferred. Combat-pacing read on ammo
      base-value=1 + cluster shove + crash retention was acceptable
      enough to proceed into Phase 2 (f) Timed waves.
- [x] MAP_POPULATION authority for natural maps. **Promoted this
      turn** to a real Phase 1 follow-up (`map-composition`); see
      decision #23.
- [x] Cellular-automata colour equilibration extension to rock +
      metal. **Promoted this turn** to a real Phase 1 follow-up
      (`material-palette-pass`); see decision #21 (rewritten).

---

## Open questions

_(Append as they arise; resolve before relevant task starts.)_

- _none currently_
