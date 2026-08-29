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
| Universe map: node/edge network of procedurally generated arenas | G1–G2 | G |
| Level 2 arenas (planet backdrop, parallax rotation) | G3 | G |
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
if the A2 root-cause turns out to be systemic.

### A1 — Bubble aggro timeout  *(bug/behavior fix, small)*

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

### A2 — Post-attack bubble immovability  *(bug fix, repro first)*

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
own; later phases assume earlier ones.

### Phase B — Mining foundation  *(GAUNTLET: "mining gauntlet")*

The economic ground floor everything else stands on.  Gauntlet because the
deliverable is a *feel* ("start slow and weak, purpose is to mine") plus an
economy curve, both of which need iterated tuning against play.

- **B1 — Miner start.**  New starting loadout: mining-oriented hull +
  a MINING BEAM weapon (or the requested weak Blaster — see §5 D-1
  contradiction) tuned so a glass tile takes 3–5 shots.  Uses the existing
  lean-start seam (`resetOutfit`) — the start becomes miner-flavoured
  config, not new machinery.
- **B2 — Mining yields.**  Mining tiles pays salvage (and later,
  materials).  Seam: `handleEntityDeath`'s shard-family branch +
  `SCORE_CONSTANTS`' existing `killedByPlayer` attribution — extend to
  drop salvage/materials scaled by variant (metal > rock > glass…), which
  `shardRichness` already knows how to rank.
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
  git history before rebuilding it from scratch.
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
  (TileGenerator cluster patterns are the vocabulary).
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
  tiles, hive growth, station damage) — this *deliberately reverses* the
  documented "destroyed tiles do NOT persist across re-entry" invariant,
  so it lands only with Phase G's node identity to key on.  F2 therefore
  interleaves with G, but F1 is independent and comes first (C's colony
  progression is much stronger with F1 in hand — consider pulling F1
  forward, between C and D, if the guidance session wants saves sooner).

### Phase G — Universe map  *(GAUNTLET: "worldgen gauntlet")*

- **G1 — Node/edge graph.**  `MAP_DESCRIPTORS` generalised: descriptors
  become node instances (stable node id + generator params + seed) in a
  graph; portals become edges.  The descent-target "placeholder seam for
  procedural AREAS" called out in CLAUDE.md §3 is exactly this.
- **G2 — Procedural Level-1 arenas.**  Seeded generation of open-space
  arenas (population tables parameterised per node; 0–N stations; up to
  ~6 inter-node portals).  `MAP_POPULATION` becomes the generator's
  output rather than a hand table for these.
- **G3 — Level-2 arenas.**  Planet/celestial backdrop: a parallax body in
  `BackgroundManager` (respect the star-field gauntlet's device-pixel and
  blit-filter findings before drawing anything pre-rendered), portal
  graphics restyled as planets/stations.

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
| G (worldgen) | **Gauntlet** | Seeded-generation iteration + perf |

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
   leaves the Blaster's tuning alone).
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

## 6. Naming note

"Bubble aliens" needs a real name before E4's storyline work; candidates
to settle in the guidance session (e.g. **Coalescents**, **Tilewrights**,
**the Accretion**).  Pick once — the name will end up in SFX ids, DBG
rows, and docs.
