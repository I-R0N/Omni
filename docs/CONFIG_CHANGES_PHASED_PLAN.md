# Configuration Changes — Phased Plan

> **Status: FORWARD-LOOKING PLAN, not implementation description.**  Unlike
> `POLISH_ARCHITECTURE.md` / `PARKING_LOT.md` this doc is *current* as a plan,
> but nothing in it should be read as shipped.  `CLAUDE.md` stays the source
> of truth for what exists.  As elements land, strike them here and record
> them in `CLAUDE.md` per its §10 rules.

## 0. How this document is used

The user supplied a large list of major configuration/design changes to
investigate **before** merging `claude/plan-completion` into `main`.  This
plan:

1. Splits the list into a small **pre-merge set** (Phase A — lands on
   `claude/plan-completion` via this session, one custom prompt per element)
   and a **post-merge sequence** (Phases B–G — parked for a new guidance
   session after `plan-completion` merges to `main`).
2. Marks which elements should run as **gauntlet-style loops** (long
   iterative sessions with a numbered `docs/GAUNTLET_*_LOG.md`, measure →
   change → user-A/B via DBG toggles) versus ordinary single-scoped
   sessions.  The house gauntlet pattern (see GAUNTLET_5C/5D/STARFIELD logs)
   pays off when the work is *feel/tuning-dominated* or
   *invariant-verification-dominated*; a plain session is cheaper when the
   work is a bounded feature with a known seam.
3. Records the **decisions the guidance session must make** before certain
   elements start (contradictions and constraint conflicts inside the
   request list itself — §5).

Element IDs (`A1`, `B2`, …) are the handles the guidance prompts should use.

**Companion doc + precedence (user directive, 2026-09-03).**
`docs/PORTAL_AND_WORLD_LAYER_PLAN.md` (from the PR #92 portal session) owns
PORTALS and OVERWORLD LAYERING in detail — what a portal is, the layer
model, discovery rules, topologies — and **takes precedence over this plan
where the two overlap** (concretely: parts of G3, and the "Level-1/Level-2
arena" framing).  This plan stays authoritative on phase order, element
IDs, gauntlet-vs-session calls, and every system that doc does not cover.
That doc uses this plan's element IDs; its §7 is the interface table.
Where this plan touches portals below, it points at that doc rather than
restating it.

**Second companion doc (from the PR #91 voronoi/grain gauntlet).**
`docs/MATERIAL_GRAIN_SPEC.md` owns MATERIALS, FRACTURE and BONDING: the
grain model (HP *derived* from grain boundaries rather than authored),
unified bonding, per-grain materials (its Tier C).  Its A1–A3/B1 stages
are already SHIPPED — see CLAUDE.md §5/§8 — so unlike the portal doc it
is part reality, part proposal.  It constrains this plan's B1/B2 (mining
is now a fracture interaction, not an HP race) and E1 (assembly runs on
its bonding model); those elements point at it below.
**ID-namespace warning:** that spec's build-order labels (`A1`…`C`) are
doc-LOCAL and collide with this plan's element IDs (its `A3` is
"metal+plastic grain rows"; this plan's `A3` is the penetration module).
Guidance prompts must qualify which doc's IDs they mean; bare IDs default
to this plan's.

One axis distinction from that doc worth internalising before reading
Phase G: this plan's **Level-1..4 arena ladder is about visual fidelity
and player capability** (backdrop → atmosphere → surface walking).  The
portal doc adds an orthogonal **containment hierarchy** — universe ⊃
galaxy ⊃ solar system ⊃ planet ⊃ moon/station — which says what contains
what, not how it is drawn.  A run starts partway down (planet or solar
system), with layers above gated behind engine tiers (B4).  Keeping the
two axes separate is what stops the art ladder constraining the world
graph; nothing in this plan's phases should couple them.

---

## 1. The request list, mapped to elements

| Request | Element(s) | Phase |
|---|---|---|
| Bubble aggro never times out | A1 | **A (pre-merge)** |
| Post-attack "green" bubble is immovable; player slams to a stop | A2 | **A (pre-merge)** |
| Penetration weapon module (+1 pierce per level) | A3 | **A (pre-merge)** |
| Scanner tool/module (materials / enemies / portals, per level) | A4 | **A (pre-merge)** |
| Stations sell additional module slots, capped per ship | A5 | **A (pre-merge, stretch)** |
| Base miner ship start; weak mining blaster; can't portal without engine; fuel | B1–B4 | B |
| Mine tiles for salvage; material buckets; storage/inventory slots | B2, B3 | B |
| Home mining colony arena (safe, training grounds, tower-defense base) | C1–C4 | C |
| Mining drones / defense drones / colony shop / ship major upgrades | C3, C4 | C |
| Weapon+module reconfiguration; minor/major modules; ship catalog with per-ship slot counts; slot power-ups | D1–D3 | D |
| Roguelike portal runs with end-of-wave reward choice | D4 | D |
| Secret / super modules (discovery-only, > Mk III) | D5 | D |
| Bubbles become tile ASSEMBLERS (invasive builders, intricate patterns) | E1 | E |
| Bubble sex-based reproduction (M/F, adult/child, competition, alarm) | E2 | E |
| Bubble hive structure (deposit growth) | E3 | E |
| Near-indestructible slow elder bubbles + invasive storyline | E4 | E |
| Persistence (save game state + per-node arena state) | F1–F2 | F |
| Universe map: node identity + explicit edges (graph schema, no generation) | G1 | **Promoted: runs just before F** |
| Universe map: procedurally generated arenas per node | G2 | G |
| Level 2 arenas (planet backdrop, parallax rotation) / layer-keyed gateways | G3 | G |
| Hidden wormholes (unlabelled leaf-node portals, found from their physics) | G4 | G |
| Maze / labyrinth portal modes | G5 | G |
| Level 3 arenas (atmosphere / near-orbit of station/frigate) | PARKED | — |
| Level 4 arenas (surface landing + walking) | PARKED | — |
| GPS-coordinate-tied shared overworld (all local players' bases) | PARKED | — |
| Portals to adjacent GPS overworlds (intergalactic engine gate) | PARKED | — |

---

## 2. Phase A — pre-merge (this branch → `claude/plan-completion`)

Selection rule: an element goes pre-merge only if it (a) fixes a live bug,
or (b) drops cleanly into an existing seam without prejudging the Phase B–D
redesigns.  Everything here is a bounded session, **not** a gauntlet —
except that A1+A2 together may warrant a short bubble-behavior mini-gauntlet
if the A2 root-cause turns out to be systemic.  (It did not — see A2 below.
A1+A2 have LANDED; A3 and A4 follow in their own sessions.)

### ~~A1 — Bubble aggro timeout~~  *(bug/behavior fix, small)*  — **LANDED**

> **Shipped** on `claude/bubble-aggro-immovability-fixes-lbnozu` →
> `claude/plan-completion`, together with A2.  As planned:
> `BUBBLE_CONSTANTS.AGGRO_TIMEOUT_SEC` (6s), armed and refreshed by every
> fresh act of aggression, ticked on sim time in `updateBubbles`, clearing
> `provoked`/`aggroTargetId` on expiry with no sick state.  One thing was
> added beyond the brief and is worth carrying into Phase E: the arm and the
> clear are now SINGLE SEAMS — `constants.stampBubbleAggro` for all three
> sites that set a target (projectile, AoE ring, ram) and
> `constants.calmBubble` for all four that drop it — because a window can
> otherwise be armed by one path and forgotten by another.  Any Phase-E
> aggression source should stamp through the same seam.  Covered by
> `tests/bubbles.spec.ts`; recorded in `CLAUDE.md` §5.

Today aggro clears only when the target dies/deactivates, flees past
`AGGRO_LOSE_RANGE`, or the latch detaches (`engine/roamers/bubbles.ts` —
`detachLatch` and the target-resolution block both clear
`provoked`/`aggroTargetId`).  In practice bubbles read as permanently
hostile — every fresh hit re-stamps aggro, and a hunting bubble that never
manages a latch never calms.  **Change**: add a non-aggression timer —
`BUBBLE_CONSTANTS.AGGRO_TIMEOUT_SEC` (start ~6s), refreshed by each new
damaging hit / ram, ticked in `updateBubbles`; on expiry clear
`provoked`/`aggroTargetId` and return to ambient drift (no sick state — the
bubble just loses interest).  Applies identically whoever the target is
(player, enemy, rival).  Test: extend `tests/` bubble coverage — provoke,
wait past timeout with no further damage, assert calm; assert a mid-window
hit refreshes the window.

### ~~A2 — Post-attack bubble immovability~~  *(bug fix, repro first)*  — **LANDED**

> **Shipped** with A1.  Reproduced headlessly first, and the root cause is
> NONE of the three suspects below — which matters for Phase E, so it is
> recorded rather than just struck:
>
> - **`massPerEat` growth was never real.**  The bubble's `consume` config
>   sets no `massPerEat` at all, so eating adds no mass: a bubble's `mass` is
>   a constant 9 for its whole life, from 15 units across to 58.  There is no
>   unbounded mass to cap, and no mass shed to audit on split or detach.
>   **E's hive design can assume mass is decoupled from size today** — and
>   should decide deliberately whether it wants to stay that way, since a
>   58-unit blob currently weighs exactly what a 15-unit one does.
> - Leftover attach state: not it (the sick path never latches).
> - The sick branch skipping integration: not it (it integrates and damps).
>
> The actual cause was `AISystem.updateBubble` applying its regime SPEED CAP
> to the bubble's TOTAL velocity every sim step, deleting the collision
> recoil the impulse solver had just computed (measured: a ship at 20 shoves
> the bubble to 23.08 and keeps 13.08 — correct — and the next AI step snapped
> the bubble back to 0.66).  The bubble never left the contact, the player
> re-collided every step and lost ~35% each time: 20 down to 0.65 in ten
> frames.  Fixed by flooring each regime cap at the speed the bubble ARRIVED
> with, so the cap bounds propulsion and never motion.  The impulse
> arithmetic is untouched.  Not systemic beyond the bubble — the other AI
> strategies cap at their own `maxSpeed` while actively thrusting — so the
> mini-gauntlet the Phase A preamble holds in reserve was not needed.

Report: after an attack pass ends and the bubble goes green (sick), the
player colliding with it comes to a sudden stop, as if the bubble were
mass-∞.  Do **not** patch on pattern-match — reproduce first (headless
Playwright via `__omniEngine`, or DBG).  Suspects, in order: (1)
`massPerEat` growth — a long-lived fed bubble's `mass` climbs without
bound, so the impulse solver's inverse-mass split legitimately approaches a
wall; check whether mass is shed on split/detach and whether a cap is
missing; (2) leftover `attachedToId`/attach state pinning position after
detach; (3) the sick branch skipping damping/integration.  Fix at the
root, add a regression test that pins the post-detach collision impulse on
the player (the physics handles let a test call
`physics.resolveCollision` in situ).

### A3 — Penetration module  *(module catalog row, small)*

`pierce` already exists per-weapon (`WEAPONS[*].pierce`,
`GameEntity.pierceCount` / `hitEntityIds` in ProjectileSystem).  **Change**:
a `statMks`-pattern weapon-mod family in `MODULE_DEFS` — `piercing`, Mk
I–III, effect `{ pierceBonus: mk }` (+1 pierce per mark, as requested) —
summed in `applyModuleEffects` into a player stat, added to the
projectile's `pierceCount` at spawn in WeaponSystem.  Adjacency: weapon-mod
family (must touch a gun), like Gunnery/Autoloader.  Price it against the
Gunnery curve.  Statline: appears in `statBreakdown()` with per-module
attribution like every other stat.  Design note for Phase D: this becomes
the model "minor module" — build it the way D1 will want all minor modules
shaped.  Decide one interaction explicitly: Laser (pierce 99) should cap,
not overflow; Lightning/Cannon (pierce 0 by design — chain/AoE instead)
should either be excluded or accept the bonus with eyes open (recommend:
bonus applies to all guns uniformly; the weapon×trait table in
WEAPONS_AMMO_PLAN §7 stays the balance reference).

### A4 — Scanner module family  *(module + HUD gating, medium)*

A ship module (`utility` family, like the Light) whose levels widen what
the minimap + off-screen indicators reveal.  The display plumbing all
exists (indicator type legend, per-type budgets, `INDICATOR_RANGE` gating
on portals, minimap blips); the scanner becomes a *gate/extender* over it,
not a new render system.  Suggested shape: Mk I = materials (mobile-shard
dots on the minimap beyond the current mode), Mk II = + enemies at extended
indicator range, Mk III = + portals/POIs map-wide (lifts
`PORTAL_CONSTANTS.INDICATOR_RANGE`).  Exact tiering is a guidance-prompt
call.  Rules to keep: colours stay the type legend's; scanner absence must
degrade to today's behaviour exactly (so tests written against current
gating keep passing with no scanner installed); adjacency like other ship
modules; effect zeroed when adjacency-offline (the Light's
`applyModuleEffects` pattern).  Phase D note: scanner survives the module
rework as a catalog row.

**Forward constraint (PORTAL_AND_WORLD_LAYER_PLAN §4):** the scanner is
the designated *reveal mechanism for hidden wormholes* (G4) — its Mk III
"portals/POIs map-wide" tier is what will flip an undiscovered wormhole to
labelled/indicated/blipped.  A4 ships long before hidden portals exist, so
it must NOT assume them: with no scanner installed, behaviour degrades to
today's portal gating *exactly* (the degrade rule above, now load-bearing
against the existing test suite).  And note for the A4 design: discovered
state is **per node**, so when G4 lands it becomes a consumer of node
identity (G1) and persistence (F1/F2), never a render-side flag — don't
build A4 state anywhere that would fight that.

### A5 — Purchasable module slots (stretch, only if Phase A goes fast)

The request ("stations sell new module slots, capped per ship") is really
the first brick of Phase D's ship catalog.  A pre-merge version can stay
small: make the *installed slot count* a `GameEngine` field initialised
from a per-ship constant instead of the flat `MODULE_SLOT_COUNT`, with a
station purchase (`purchaseSlot(group)`) that increments it up to a cap,
and the hex-flower UI rendering locked hexes for unpurchased slots.
**Do this only if** it can be done without touching `HEX_ADJACENCY`
semantics; if it starts pulling the adjacency table apart, park it into
Phase D where the ship catalog will rebuild that layer anyway.

**Phase A exit gate**: all three validation gates green (`typecheck`,
`build`, full `npm test`), `CLAUDE.md` updated per element, then merge this
branch to `claude/plan-completion` and proceed with the `plan-completion` →
`main` merge.

---

## 3. Phases B–G — post-merge sequence (new guidance session)

Ordered by dependency, not by excitement.  Each phase is mergeable on its
own; later phases assume earlier ones.  One deliberate out-of-letter-order
exception: **G1 (node identity + edges) runs just before Phase F** — see
Phase G; the ID stays stable, only the sequencing moved.

Running order: **B → C → D → E → G1 → F → G2/G3/G4/G5.**

### Phase B — Mining foundation  *(GAUNTLET: "mining gauntlet")*

The economic ground floor everything else stands on.  Gauntlet because the
deliverable is a *feel* ("start slow and weak, purpose is to mine") plus an
economy curve, both of which need iterated tuning against play.

- **B1 — Miner start.**  New starting loadout: mining-oriented hull +
  a MINING BEAM weapon (or the requested weak Blaster — see §5 D-1
  contradiction).  Uses the existing lean-start seam (`resetOutfit`) —
  the start becomes miner-flavoured config, not new machinery.
  **Rebased onto the grain model (PR #91):** the original "3–5 shots per
  glass tile" spec predates it.  Tile HP is now *derived* from grain
  boundaries (`GrainSpec.bondStrength` × interior boundary length —
  MATERIAL_GRAIN_SPEC §1, shipped), and the per-material hits-to-break
  ladder is already play-tested and ordered (glass lightest → rock →
  plastic → metal; the shipped table is in CLAUDE.md §5).  So B1's tuning
  is the *weapon's damage against that ladder*, not a flat tile HP — the
  starter beam should put glass in the requested 3–5-hit band and let the
  ladder space the harder materials out above it, which is exactly the
  progression a mining game wants and the grain table already provides.
  The beam's *identity* is likewise fracture-shaped now: mining reads as
  progressively chipping grains off (partial fracture / detach), not
  draining a bar.
- **B2 — Mining yields.**  Mining tiles pays salvage (and later,
  materials).  Two seams now, and the second is new with PR #91:
  `handleEntityDeath`'s shard-family branch + `killedByPlayer`
  attribution for whole-body breaks, and the **partial-fracture detach
  path** — a qualifying hit detaches the grain nearest the impact, so
  mining can pay *per chip carved off*, graded by material, rather than
  only on the kill.  Rank by variant (metal > rock > glass…), which
  `shardRichness` already knows how to do.  **Before inventing a
  materials taxonomy, read MATERIAL_GRAIN_SPEC §4 (Tier C, per-grain
  materials — proposed, not built):** it is the natural substrate for
  ore/veins (a rock tile carrying metal grains IS a mining deposit), and
  B2 either consumes it or must stay compatible with it — §5 decision
  #13.
- **B3 — Material buckets + storage.**  New drop/inventory type: mining
  materials held in bucketed inventory tiles (a bucket = one inventory hex
  holding up to N units of one material).  Reuses `DROP_TYPES` registry
  (one new row + effect/render, per the drop-type convention) and the
  existing inventory honeycomb.  Storage modules raise bucket capacity.
- **B4 — Engine gating + fuel.**  Portals check for an installed
  interplanetary-engine module; travel costs fuel (a consumable stat,
  bought at stations — NOT a drop; the ammo-system deletion (pivot 1b) is
  precedent for being careful with consumable pools, so fuel gets one
  number on the player + a station purchase, no drops, no per-shot-style
  bookkeeping).

### Phase C — Home colony arena  *(session series, one element each)*

- **C1 — Home arena map.**  New `MapType` + descriptor (`kind: 'hub'`
  successor or a third kind `'colony'`): small, safe (no waves by
  default), the run's new starting map.  Follows the documented add-a-map
  plumbing list (§6a of CLAUDE.md) exactly.  The "orbiting a planet"
  variant is Phase G3's parallax planet — C1 ships the isolated-station
  variant first so C isn't blocked on G's backdrop work.
- **C2 — Colony defense waves.**  Occasional tower-defense-style raids on
  the home base: a scheduled/triggered wave mode where enemies target the
  station, not the player.  Needs a station-damage model (stations are
  currently indestructible scenery) — scope this deliberately small: a
  station HP pool + repair, enemies with a station-target AI row in
  `ENEMY_BEHAVIOR`.
- **C3 — Drones.**  Auto-mining drones (planet variant: passive
  salvage-per-time; tile variant: seek + chip tiles) and auto-defense
  drones.  Build them as engine-managed roamers (`engine/roamers/` —
  the dragon/rival/snitch pattern), owned by the player.
- **C4 — Colony shop.**  Home station sells mining equipment, drones, and
  the ship *major* upgrades (bigger miner, fighter, interplanetary
  engine).  Ships-as-purchases is Phase D3's catalog; C4 can ship with
  the engine + drones + equipment and take ship purchase when D3 lands.

### Phase D — Module & ship-catalog reconfiguration  *(GAUNTLET: "outfitting gauntlet")*

The single heaviest redesign in the list; gauntlet because it rebuilds a
load-bearing system (outfitting) under live tests and needs staged,
verified milestones.  The connected-module adjacency method is **confirmed
present and kept**: `HEX_ADJACENCY` + `MODULE_REQUIREMENTS` +
`computeActiveSlots` fixpoint (engine⇢hull, thrusters⇢engine,
shield/plating⇢hull, capacitor⇢shield, weapon-mods⇢gun) — D builds on it,
never replaces it.

- **D1 — Minor/major module taxonomy.**  Minor: penetration (A3),
  fire-rate, damage, burn/corrosion on-hit.  Major: burst, bounce, spread,
  electricity, homing, explosion — i.e. the current *gun identities*
  refactored into gun-modifying modules.  This is the big call: majors as
  gun-transformers vs. majors staying separate guns.  Guidance decision
  required before D1 starts (§5).
- **D2 — Per-ship slot counts + slot power-ups.**  Ship hulls define slot
  counts (module + weapon + inventory), purchasable slot expansion to a
  per-hull cap (A5's seam, finished), and per-slot natural multipliers
  ("power-up" hexes).  `SHIP_WEIGHT.HULL_BASE` is the documented seam for
  ship classes — D2 is that seam cashed in.
- **D3 — Ship catalog.**  Buyable ships (miner → larger miner → fighter →
  the current 14-slot ship as a late hull), each a row of base stats +
  slot layout.  Swapping hull moves the outfit through the existing
  inventory (with an overflow rule to decide).
- **D4 — Roguelike portal runs.**  End-of-wave choice-of-3 reward
  (salvage / materials / minor / major modules) inside designated arena
  descriptors.  NOTE: the removed card-choice modal (`cardChoicePending`
  loop short-circuit) is the exact UI/loop pattern this revives — check
  git history before rebuilding it from scratch.  Structurally a roguelike
  descent is one *path-shaped* traversal of the same node/edge graph the
  layer hierarchy and the maze modes use (PORTAL_AND_WORLD_LAYER_PLAN §5)
  — D4 owns the reward loop, not a private topology.  And
  `openDescentPortal` stays UNCALLED until G1's node identity lands (that
  doc's §8.5): its destination today is a random arena descriptor, and the
  layer hierarchy is about to define what "deeper" means; re-enabling is
  the same one line afterwards.
- **D5 — Secret/super modules.**  Mark ≥ IV variants flagged
  `discoveryOnly` — excluded from every shop catalog, granted only by
  drops/discovery (boss module grants are the existing precedent:
  `grantBossModule`).  Cheap once D1 lands.

### Phase E — Bubble ecology  *(GAUNTLET: "ecology gauntlet")*

Gauntlet because it is behavior/feel iteration end to end, with heavy DBG
A/B needs (population, dimorphism readability, hive pacing) and real perf
exposure (many-agent AI).  Depends on nothing above except A1/A2 landing
first (don't build an ecology on top of a physics bug).

- **E1 — Assemblers, not consumers.**  Invert `consume`: bubbles collect
  shards and PLACE tiles/clusters (routes through the existing shard→tile
  transmutation + `TILE_SNAP` machinery rather than a new builder).
  "Intricate patterns" = a per-hive blueprint over the hex grid
  (TileGenerator cluster patterns are the vocabulary).  **Grain-model
  homework before this starts (PR #91):** MATERIAL_GRAIN_SPEC §3's
  unified bonding ("a boundary IS a bond" — three events replacing seven
  mechanisms) is the machinery an assembler would drive, and that spec's
  §6.2 decision was WITHDRAWN with a finding E1 inherits: an assembled
  body does NOT keep its bond geometry on becoming a static tile — the
  hex-snap re-shapes it and the pattern is re-decomposed fresh
  (`position === hexCoord` is load-bearing across three systems).  So
  bubble-built tiles get fresh grain patterns, and any "you can see what
  it was built from" ambition waits on Tier C per-grain materials (the
  "inherit statistics, not geometry" variant).  Related parked items to
  read first: PARKING_LOT §"Polygonal face bonding for metal" and
  §"Grain clusters" — both touch how assembled bodies join.
- **E2 — Sexed lifecycle.**  Male/female + adult/child replace mitosis
  (`multiply` config retires for bubbles).  Behavior rows: males slower
  and stronger, females faster and weaker, male-male competition for
  females, mating → child; children flee + alarm (aggro-broadcast to)
  parents, never fight; adults retaliate as today.  Distinguishing render
  characteristics for all four classes.  Population control must be
  explicit — a birth-rate/food-gated cap replacing `maxPopulation`, or the
  ecology will either die out or explode (measure in the gauntlet).
- **E3 — Hive.**  A hive structure entity per bubble family; adults
  periodically return and deposit growth (size shed → hive growth).
  This is also the natural fix-forever for A2's mass concern: growth
  leaves the bubble and enters the hive.
- **E4 — Invasive elders + storyline.**  Slow, extremely-high-HP (finite,
  ~"hard even for the best loadout") elder assemblers seeded in overworld
  + home arena.  Tie into the C2 colony-defense pressure loop.

### Phase F — Persistence  *(GAUNTLET: "persistence gauntlet")*

Gauntlet because the risk is invariant-shaped: every field either
round-trips or corrupts silently, and the codebase's "no persistence
beyond in-memory run state" assumption is load-bearing in many places
(master-spec §1; in-memory audio prefs; `restartGame` semantics).

- **F1 — Player/run state save-load.**  Versioned serialize/deserialize of
  the run-scoped state (credits, outfit, inventory, ship, counters), to
  `localStorage` first.  Schema versioning from day one.
- **F2 — Arena-state persistence.**  Per-node arena snapshots (destroyed
  tiles, hive growth, station damage, wormhole discovered-state) — this
  *deliberately reverses* the documented "destroyed tiles do NOT persist
  across re-entry" invariant, and it keys on node identity.  With **G1
  promoted to run just before this phase** (see Phase G — accepted
  recommendation from PORTAL_AND_WORLD_LAYER_PLAN §6), the previously
  documented F2↔G interleave is gone: F2 has node ids to key on and runs
  as a normal part of F.  F1 remains independent of the graph (C's colony
  progression is much stronger with F1 in hand — consider pulling F1
  forward, between C and D, if the guidance session wants saves sooner).
  §5's node-memory decision (#8) must be answered before F2 *or G1* is
  built.

### Phase G — Universe map  *(GAUNTLET: "worldgen gauntlet" — except G1)*

Portals and layering detail here is owned by
`PORTAL_AND_WORLD_LAYER_PLAN.md` (precedence note in §0 above); this
section says where each piece sits in the phase order and points there.

- **G1 — Node identity + explicit edges.  PROMOTED: runs just before
  Phase F, as its own bounded session, not part of the worldgen
  gauntlet.**  This accepts the portal doc's §6 recommendation and
  resolves the live conflict with PARKING_LOT §"A real map GRAPH" ("build
  the graph first").  Scope is deliberately the *small* half: a schema
  change to `MAP_DESCRIPTORS` — stable node id (already there), a
  layer/parent relationship, and edges declared as data instead of
  hardcoded per map class (`HUB_PORTAL_SITES`, `RETURN_PORTAL_OFFSET`,
  `addReturnPortal()`).  **No generation.**  A refactor of what already
  exists, over the hand-authored maps that already exist; it is what F2,
  D4 and G4's discovered-state actually need.  `portalTargetId` being a
  descriptor id (never a bare MapType) is the seam it builds on.  §5
  decision #8 (does a node remember anything, and for how long) must be
  answered first or this gets built twice.
- **G2 — Procedural arena generation.**  Seeded generation of open-space
  arenas (population tables parameterised per node; 0–N stations; up to
  ~6 inter-node portals).  `MAP_POPULATION` becomes the generator's
  output rather than a hand table for these.  Unchanged by the portal
  doc, and the large half of what used to be "G1+G2".
- **G3 — Layer-keyed gateways + celestial backdrops.**  *Superseded in
  part* by PORTAL_AND_WORLD_LAYER_PLAN §3a: the old line "portal graphics
  restyled as planets/stations" is replaced by the **gateway taxonomy** —
  a signposted portal is drawn as a parallax celestial body whose TYPE is
  the layer it leads to (galaxy / solar system / star / planet / moon /
  station / freighter), so the player reads their altitude off what they
  can fly into.  The parallax-planet *arena backdrop* (the old "Level-2
  arena" fidelity work) stays G3's alongside it — same BackgroundManager
  machinery.  Hard rendering constraint from
  `GAUNTLET_STARFIELD_LOG.md` S4: anything pre-rendered and blitted at a
  fractional or dpr-scaled offset reintroduces the browser-dependent
  `drawImage` filter bug that gauntlet removed — parallax layers are
  drawn analytically or blitted on whole device pixels.  Art source is §5
  decision #9 (recommend procedural, so G2's seeds can drive it).
- **G4 — Hidden wormholes.**  *(New element, from the portal doc §3b/§4.)*
  The leaf-node door: a portal with no label, no off-screen chevron and no
  minimap blip until discovered — found from the physics the engine
  already simulates (matter spiralling in, ejected objects flung back
  out, the star lens, the pull).  A4's scanner is the reveal mechanism;
  discovered-state is per node (G1 + F1/F2).  Known tension to resolve by
  play-test, not on paper: the shipped well was retuned DOWN (SIZE 70 /
  g1500 / range 525; peak pull 0.15 px/step) because it read as too
  powerful, and the same subtlety makes a rift hard to spot — the portal
  doc recommends hidden portals carry their own stronger well plus
  slightly louder cues, A/B'd on the existing DBG Portals knobs (§5
  decision #10).  Runs as a session with DBG A/B, after G1; can land
  before or alongside G2.
- **G5 — Maze / labyrinth modes.**  *(New element, from the portal doc
  §5.)*  Once portals are edges (G1), a maze is a *generator* over the
  same node/edge graph — many small nodes with several edges each, some
  cyclic; a labyrinth is that plus a terminal boss/reward node.  No new
  portal engine code.  Two things a maze needs that the hierarchy does
  not: **more than one exit edge per node** (`addReturnPortal()` hardcodes
  exactly one way home today — G1 should leave room for this even if G5
  ships later) and **a way to not be lost** (§5 decision #11 — small
  mazes, a map screen, or physical breadcrumbs; a map screen is a new UI
  surface and must be costed before a maze mode is committed).  Sits in
  the worldgen gauntlet after G2.

### Parked (recorded in PARKING_LOT.md when this plan is adopted)

- **Level 3 / Level 4 arenas** — L4 (walking/boarding) is a second game
  mode (new player controller, camera, collision world); L3 is meaningless
  without L4 to descend into.  Park both behind G.
- **GPS-tied shared overworld + adjacent-overworld portals** — requires a
  backend, accounts, and multiplayer sync; the entire architecture is
  currently "single-page app — no server".  This is a product-scale
  decision, not a phase.  The single-player-shaped subset (a *local*
  overworld node keyed to coordinates, portals gated on an engine tier)
  can ride Phase G if wanted.
- **Proper bubble/roamer rotational mechanics** — already parked in
  PARKING_LOT.md; unchanged.

---

## 4. Gauntlet vs. session — summary

| Work | Style | Why |
|---|---|---|
| A1–A5 | Sessions | Bounded fixes/rows on known seams |
| B (mining) | **Gauntlet** | Feel + economy tuning loop |
| C1–C4 | Sessions | Bounded features; C2/C3 medium-sized |
| D (outfitting) | **Gauntlet** | Load-bearing system rebuild, staged milestones |
| E (ecology) | **Gauntlet** | Behavior/feel iteration + perf A/Bs |
| F (persistence) | **Gauntlet** | Invariant verification (round-trip correctness) |
| G1 (node identity) | Session | Bounded schema refactor of what exists; no generation |
| G2/G3/G5 (worldgen) | **Gauntlet** | Seeded-generation iteration + perf |
| G4 (hidden wormholes) | Session + DBG A/B | Bounded feature; cue strength is a play-test on existing knobs |

Every gauntlet keeps a `docs/GAUNTLET_<NAME>_LOG.md` with numbered
milestones and decisions, per house pattern.

---

## 5. Decisions the guidance session owes before phases start

1. **(D1) Miner slot layout contradiction.**  The request list says both
   "three module slots … storage module and a blaster" and "two slots for
   modules, one weapon and one standard, pre-filled with mining beam and
   hull, respectively, and 3 slots for inventory."  Pick one (recommend
   the second — it matches the inventory-bucket design and D2's
   per-ship slot model).
2. **(B1) Mining weapon identity.**  Weak Blaster vs. dedicated Mining
   Beam as the starting gun.  Recommend Mining Beam (distinct identity,
   leaves the Blaster's tuning alone).  **Updated by PR #91:** under the
   play-tested grain defaults a glass tile takes ~13 base-Blaster-class
   hits (CLAUDE.md §5's shipped table), so the requested 3–5-shot band is
   now *below* current glass toughness, not above it.  Either the band is
   renegotiated, or — the interesting option — the Mining Beam hits
   TERRAIN harder than the Blaster while staying weak against enemies,
   which gives the miner a real identity (a tool, not a gun) and leaves
   combat balance untouched.  Decide alongside #2's weapon choice.
3. **(D1) Major modules: gun-transformers or guns?**  Whether
   burst/bounce/spread/homing/etc. become modifiers stacked on a base gun
   or remain the current discrete gun catalog.  This decision shapes all
   of D and should be made against WEAPONS_AMMO_PLAN §7's
   "every weapon a right answer somewhere" table.
4. **(C1) Home arena flavour first ship** — isolated station (cheap) vs.
   planet-orbit (needs G3 backdrop).  Plan assumes isolated first.
5. **(E4) "Basically indestructible" ceiling** — pick the elder HP target
   relative to the best loadout's DPS so "difficult but possible" is a
   number, not a vibe.
6. **(F1) Persistence scope for the first cut** — run-state only, or also
   preferences (difficulty, control scheme, audio), which are documented
   today as deliberately in-memory.
7. **(PARKED) GPS overworld** — confirm parked, or commission a separate
   architecture study; it cannot ride a phase.

Added from `PORTAL_AND_WORLD_LAYER_PLAN.md` §8 (that doc carries the full
argument for each; listed here so the guidance session has one checklist):

8. **(G1/F2) Node memory.**  Does a node remember anything, and for how
   long?  Distinct from #6 (which is about the *player's* save): this one
   shapes the graph schema itself.  Answer **before G1 is built** or it
   gets built twice.  Existing positions: GAME_STRUCTURE_STRATEGY's
   persistence table, PARKING_LOT §"Portal persistence" Shapes 1/2.
9. **(G3) Gateway art source** — procedural bodies vs. authored layered
   images.  Recommend procedural for the first cut, so G2's seeded
   generation can drive it (and every other thing in this game is drawn,
   not blitted).
10. **(G4) Discovery cue strength** — own stronger well, louder cues at
    the same pull, or scanner-first.  A/B on the DBG Portals knobs; do
    not decide on paper.
11. **(G5) Maze legibility** — small mazes, a map screen, or physical
    breadcrumbs (the transit-debris trail is a candidate).  A map screen
    is a genuinely new UI surface: cost it before committing to a maze
    mode.
12. **(C1/G) Starting layer** — planet overworld or solar-system
    overworld.  Interacts with C1, which currently assumes an isolated
    station; decide before C1's map ships a flavour the layer model has
    to unwrite.

Added from `MATERIAL_GRAIN_SPEC.md` (PR #91):

13. **(B2) Mining materials vs. Tier C per-grain materials.**  The grain
    spec's Tier C (per-grain materials + pair function — proposed, not
    built; the spec deliberately holds it as "a separate decision, taken
    with A and B measured") is the natural substrate for ore/veins: a
    rock tile carrying metal grains IS a deposit, and mining it is the
    partial-fracture detach that already ships.  Decide whether B2
    commissions Tier C, or ships a simpler per-variant yield table that
    stays forward-compatible with it.  Commissioning it pulls real
    rendering-cost work into Phase B (the spec's §4 costs it honestly);
    not commissioning it means B2's material taxonomy must not collide
    with the one Tier C would introduce.

## 6. Naming note

"Bubble aliens" needs a real name before E4's storyline work; candidates
to settle in the guidance session (e.g. **Coalescents**, **Tilewrights**,
**the Accretion**).  Pick once — the name will end up in SFX ids, DBG
rows, and docs.
