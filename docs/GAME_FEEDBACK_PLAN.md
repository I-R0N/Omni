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
    Partially superseded by decision #30 — PR #61 shipped a
    neighbour/density brightness+opacity automata model in this
    slot instead of the hue-lerp extension. The hue-lerp
    extension was subsequently dropped per user direction;
    remaining scope is the palette work only (see #30).

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
    Note (post-PR #60): rock density-aware HP, size-based
    fragment counts, and deeper density-mass tiers shipped
    inside PR #60 partially re-enter (e)/(f) territory without
    formally unparking them — see decision #29f.

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

29. **plastic-revert shipped with major over-delivery (PR #60).**
    The "micro session" became 29 commits / +1744 / −2289 across
    12 files. Decision #19's core checklist (a–g) all landed and
    were verified in code post-merge:
    - (a) Soft-disc / gradient render deleted; plastic-tile back
      on the standard material-tile path, plastic-shard on the
      standard polygon-shard path. Default colour stayed fuchsia
      `#e879f9`.
    - (b)/(c) DBG palette + colour-cycle controls and the
      nebula-based colour-blend hook kept, per spec.
    - (d) `elasticBond` schema field fully removed (zero code
      references remain).
    - (e) Cohesion-only bonds via new `BondPartnerConfig` +
      per-partner `cohesionOnly: true` flag (the recommended
      option); `bondsWith` excludes nebula-tile / nebula-shard.
    - (g) `plasticSelfBreak` PerfController task removed;
      `plasticCosmetic` kept; new `dropMerge` task added.
    Two spec deviations (both playtest-driven, accepted):
    a. **(f) strength tiers widened.** Spec said glass-tile /
       glass-shard get the strong tier, everything else default.
       Shipped: glass, rock, metal, AND indestructible partners
       (tiles + shards) are all `strength: 'strong'`; only
       plastic-tile is default (commit `bfb3a4c`). Glass is no
       longer special on the bond axis.
    b. **Cross-material transmute on contact.** Plastic-shard
       touching any non-plastic non-nebula partner converts to
       the partner's material at its current size + shape
       (`PhysicsSystem.tryPlasticTransmuteOnContact`); the
       relative-size gate was dropped mid-session per user
       direction. Goes beyond (e)'s "cohesion-only, NOT
       pair-consume transmute" framing.
    Over-delivery — decision #19h said "no behaviour changes to
    non-plastic variants" and was exceeded system-wide:
    c. **Generic merge bookkeeping.** `mergeCount` on GameEntity
       (replaces `plasticMergeCount`); `shatterAsteroidStyle`
       breaks merged parents into `mergeCount ± 1` fragments for
       every variant on the asteroid-style path.
    d. **Unified shard→tile `TILE_SNAP`** for plastic + glass +
       metal: shared 2× tile-diameter threshold + rest-speed
       gate, debris release on snap; absorbed
       `tryConvertOversizedGlassShard` and `tickPlasticTileSnap`.
    e. **Metal composite decomposition.** Multi-cell metal shards
       die into per-cell loose triangles; composites grow past
       the 6-cell lattice via invisible `metalExcessCells`.
    f. **Rock condense deepened 5 → 25 tiers** with
       density-scaled HP (`MAX_HP × sqrt(tier+1)`),
       size-proportional fragment counts (cap 30), and
       mixed-density children. **Partially re-enters territory
       parked under decision #27e/f** (shard counts +
       per-material mass) without formally unparking it.
    g. **Flow field.** Ammo drops follow the asteroid flow;
       inverse-mass variability (`FLOW_VARIABILITY`) replaces
       lockstep convergence; plastic keeps a 5× flow affinity
       applied before the mass scale.
    h. **Ammo-drop overhaul.** `spawnAmmoDrop` hard-forces
       value = 1 (ignores the `AMMO_PER_*` tunables — ~5× ammo
       reduction per kill) + O(N²) adjacent-drop merging with
       mutual pull / damping / mass-weighted velocity blend,
       cadenced by the new `dropMerge` PerfController task.
       **The value=1 change cuts against (d1)'s recorded goal of
       preserving shots-per-pickup feel; recorded here as the new
       intended baseline (playtest-driven).**
    i. **DBG additions.** `Shard pal`, `P glow`, `M glow`,
       `M color` cycles.
    j. **Perf sweep.** Set-based plastic-dent recovery,
       Float64Array dent deltas, pooled dent scratch, mutable
       flow-sample returns, cadenced drop merge.
    Validation: `npm run build` clean; the PR's 15-item manual
    test plan was deferred — **stacks on the playtest debt
    already owed from PR #54** (see punch list).

30. **material-tile-automata (PR #61) — unplanned session that
    partially supersedes material-palette-pass.** User-initiated
    visual/balance session occupying decision #21's conceptual
    slot but with a different model: neighbour-count /
    density-tier **brightness + opacity** automata, NOT the
    planned hue-lerp extension of
    `NebulaSystem.equilibrateColors`. Shipped:
    a. **Glass** — bipolar opacity automata around neutral 1.0×
       (sparse / edge tiles trend opaque up to 1.55×, dense
       interiors fade toward 0.45×).
    b. **Rock** — tile neighbour automata + shard density tier
       both darken toward one shared
       `ROCK_AGGREGATION_TINT_FLOOR` (0.55); shatter colour-pop
       fixed by inheriting a density tier onto dent-spawned
       shards across all three spawn paths
       (`DropSystem.inheritedTileDensityTier`). Tint only.
    c. **Metal density tiers.** `densityTier` counted in 6-shard
       hexagon layers drives brightness, **HP (×tier)** and
       **break count (tier × 3 — deliberately lossy, ~half the
       metal destroyed on break)**; per-cell composite render
       shows mixed shades mid-layer; map-load tiles seed their
       tier from cluster neighbour count; the interim metal
       neighbour-brightness automata was dropped in favour of
       tiers. The HP / break-count changes are gameplay balance
       beyond a "coloring" scope — accepted as shipped.
    d. **DBG.** Master `Tile shade` toggle gating both render and
       neighbour compute. New per-variant `automata` block on
       `SHARD_VARIANTS` (`maxNeighbors` +
       `saturationBrightness` / `saturationOpacity`).
       `indestructible-tile` deliberately excluded.
    NOT shipped (still owned by material-palette-pass):
    - Palette adjustments — metal white-removal + shiny-ready
      blue range, rock red + blue range, plastic palette
      verification.
    - The hue-lerp / warm-cool sub-arc equilibration extension.
    **material-palette-pass is rescoped** to the palette piece.
    Resolved the following turn: the hue-lerp extension is
    **dropped** per user direction — the palette adjustments
    alone close the task.

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
| plastic-revert | Strip plastic-softbody divergence; restore standard shards | shipped (PR #60, merged into plan branch) | `claude/plastic-revert-RhPVQ` | Core decision #19 scope (a–g) landed and verified post-merge. Two playtest-driven deviations: strength tiers widened beyond glass (rock / metal / indestructible also strong; only plastic-tile default), and cross-material transmute-on-contact added. Major over-delivery across shards / drops / flow / DBG / perf (mergeCount shatter generalization, unified TILE_SNAP, metal composite decomposition, rock condense 25 tiers + density HP/fragments, flow inverse-mass variability, ammo drops hard-forced to value 1 + adjacent-drop merging). **Ammo value=1 supersedes d1's shots-per-pickup tuning as the new baseline.** Manual test plan deferred — playtest debt. See decision #29. |
| material-tile-automata | Neighbour/density automata coloring (glass / rock / metal) | shipped unplanned (PR #61, merged into plan branch) | `claude/material-tile-automata-BXXKt` | **Not in original plan — user-initiated (see decision #30).** Glass bipolar opacity automata; rock darkening unified on a shared tint floor + shatter colour-pop fix via inherited density tier; metal reworked onto 6-shard-layer density tiers driving brightness + HP (×tier) + break count (tier×3, deliberately lossy). Master `Tile shade` DBG toggle. Partially supersedes material-palette-pass's automata piece; palette work still outstanding. |
| material-balance-pass | ~~Reduced shard counts + per-material mass retune + momentum audit~~ → see `momentum-collisions` | replaced this turn | — | Scope narrowed: shard-count reduction and per-material mass retune dropped from this batch (parked under decision #27); only the momentum / velocity-in-collisions piece carries forward as `momentum-collisions` below. |
| momentum-collisions | Velocity-aware collision impulse | pending (unblocked) | `claude/momentum-collisions-<suffix>` | Audit `PhysicsSystem.resolveCollision` + the PR #57 composite-collision additions and ensure the impulse calculation accounts for entity velocity in addition to mass. Today's collisions read mass-dominant to the player; this task introduces velocity into the impulse path so a fast small entity can shove a heavy slow one. Tuning task — no rewrite of the impulse model. **Unblocked**: plastic-revert shipped (PR #60), and the impulse path was verified untouched by PRs #60/#61, so the audit baseline is current. See decision #22 (rewritten). |
| material-palette-pass | Material palette adjustments (rescoped) | pending (rescoped after PR #61) | `claude/material-palette-pass-<suffix>` | **Rescoped — see decisions #21 + #30.** PR #61 shipped neighbour/density brightness+opacity automata in this slot, and the original hue-lerp warm/cool sub-arc extension is **dropped per user direction**. Remaining scope: palette adjustments only — metal loses white / gains a shiny-ready blue range; rock gains red + blue range; plastic palette verified under the post-revert cohesion-bond model. |
| map-composition | Mixed clusters + MAP_POPULATION authority | pending | `claude/map-composition-<suffix>` | **Promoted from side-cleanup.** Two pieces: (1) flip natural maps (UniverseMap / PocketMap / SevenRingsMap) to read tile-variant ratios from `MAP_POPULATION` instead of hardcoded subclass literals. (2) New cluster-composition rules — rock mixed around metal-tile clusters; plastic mixed with glass-tile clusters. Touches MapClasses subclasses + MAP_POPULATION schema. See decision #23. |
| minimap-faithfulness | Minimap colors match screen + nebula transparency | pending | `claude/minimap-faithfulness-<suffix>` | Small UI task. Minimap tile colors should closely match the on-screen tile colors (not the simplified swatches today). Nebula tiles and shards drawn with reduced alpha on the minimap to read as "thin / fog" rather than solid. Touches `MINIMAP_CONSTANTS` + UIOverlay minimap render. See decision #24. |
| living-entity | New non-threatening grazer entity | **paused** | `claude/living-entity-<suffix>` | Brief drafted, implementation paused per user direction. Decision #20 captures the design surface for whenever this resumes. |

---

## Phase 2 — Structure (sequential, after Phase 1)

| ID | Task | Status | Branch | Notes |
|----|------|--------|--------|-------|
| f | Timed waves of mixed enemy types | pending | `claude/timed-waves-<suffix>` | Restructure WAVE_DEFINITIONS / WaveSystem. Depends on (e) clean spawn + (j) clean despawn. |
| h | New enemies + bosses | pending | `claude/bosses-<suffix>` | Shielded boss (open/closed states; smaller "shoot-only" variant), Mega-Man-X-style weapon-type bosses. Weapons unlock per-run. Debug menu bypass kept. Likely new aiState `'open'`/`'closed'`. |
| k | Portal to next map after N waves | pending | `claude/map-portal-<suffix>` | New spawnable portal entity + GameEngine.loadMap lifecycle wiring. **Two portal flavors:** cross-map (original scope) AND intra-map (teleport to another location on the same map). Per-portal config picks destination. |

---

## Deferred — queued but not in current sequence

These are real follow-up tasks, not parking-lot ideas. They have committed
scope and slot into the work after Phase 2 or alongside Phase 3 polish,
but they don't gate the current sequence and should not be spawned ahead
of the items in Phase 1 follow-ups.

| ID | Task | Notes |
|----|------|-------|
| orbital-fields-moons | Orbital flow fields + moving moons with gravity | New mechanic. Flow fields that create circular orbits around a central planet entity; moving moons rendered in the background that contribute gravitational pull like the central planet. Touches FlowField + FlowFieldGrid + BackgroundManager + LOCAL_GRAVITY_CONSTANTS. Likely 2+ sessions. Fits between Phase 2 (k) and Phase 3, or alongside Pair B/C polish. See decision #25. |
| voronoi-rock-fracture | Voronoi-style rock shatter, mostly-intact tile | New rock shatter algorithm. Rock shards explode off the tile in larger numbers and at higher velocities, but the tile remains mostly intact through several hits before fully breaking. Voronoi cell-based fracture if feasible; fallback to a chunkier polygon-decomposition if not. 1–2 sessions. See decision #26. |

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
      **Done in the branch-review punch-list pass** — §4 now points at
      the shared fields.
- [x] PR #57 introduced `PerfController` as load-bearing infra; not
      yet documented in CLAUDE.md (§2 directory layout, §3 per-frame
      order, §5 constants list, §8 conventions). **Done in the
      branch-review punch-list pass** — documented in all four
      sections plus `enforceCap.ts` (PR #58) in §2.
- [x] `ShardSystem.completeRegen` references nonexistent
      `this.regenAdapter` (field is `adapter`). `tsc --noEmit` flags
      it; `vite build` ignores it. Silent no-op on nebula-tile regen
      colour rewrite (off by default). **Fixed in the branch-review
      punch-list pass** — now calls `this.adapter`.
- [ ] FF audit follow-ups #FF-1 (asteroid obstacle-aware fallback +
      diagonal wall-repulsion), #FF-2 (re-examine obstacle filter
      once any finite-mass wall-like variants ship), #FF-3 (perf
      timer for asteroid-bake path). Track via the audit doc
      `docs/FLOW_FIELD_AUDIT.md`.
- [x] CLAUDE.md staleness grew in PRs #60/#61: no mention of
      `TILE_SNAP`, `mergeCount` shatter generalization, the
      `densityTier` system, per-variant `automata` blocks,
      ammo-drop value=1 + adjacent-drop merging,
      `bondPartners`/`cohesionOnly` schema, `dropMerge`
      PerfController task, or `FLOW_VARIABILITY`. **Done in the
      branch-review punch-list pass** — §4 field categories
      (incl. the missing plastic-shard / metal-shard variant ids),
      §5 constant blocks, §8 conventions all refreshed. Note:
      PR #57's `MERGE_RATE_CONSTANTS` was since replaced by
      `LOCAL_MERGE_CONSTANTS` (local-density boost); documented
      under its current name.
- [ ] **Compounded playtest debt.** PR #54's deferred manual
      playtest pass was never recorded as done, and PR #60
      deferred a 15-item test plan on top of it. A consolidated
      in-browser playtest pass is owed before stacking further
      shard-system / visual work.
- [x] MAP_POPULATION authority for natural maps. **Promoted this
      turn** to a real Phase 1 follow-up (`map-composition`); see
      decision #23.
- [x] Cellular-automata colour equilibration extension to rock +
      metal. **Promoted this turn** to a real Phase 1 follow-up
      (`material-palette-pass`); see decision #21 (rewritten).

---

## Open questions

_(Append as they arise; resolve before relevant task starts.)_

- _none currently_ (hue-lerp question resolved — dropped; see
  decisions #21 / #30)
