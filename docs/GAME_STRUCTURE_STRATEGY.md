# Omni — Game Structure & Long-Term Design Vision

Strategy doc of record for decision #34 in `docs/GAME_FEEDBACK_PLAN.md`.
Captured 2026-07-08 from the user's strategy synthesis (developed across
external design discussions). **This is not a feature list** — it is a set
of design principles that guide decisions during the current overhaul so
we don't build systems that later need to be undone.

---

## Core Vision

Omni is evolving from a wave-based space shooter into a **living universe
simulator**. Combat remains a core activity, but it exists within a larger
ecosystem of materials, exploration, evolving landmarks, NPC civilizations,
and persistent locations.

The goal is NOT to add conventional RPG systems (large crafting trees,
loot rarity, hundreds of resources). Instead, the existing material
simulation becomes the foundation for exploration, economy, and world
evolution.

> **The simulation creates opportunities. The player discovers,
> influences, and exploits them.**

---

## The Four Simulation Layers

1. **Physics Layer (implemented)** — flow fields, shards, tiles,
   destruction, merging, mass conservation, material-specific behavior.
   Nothing about this philosophy changes.
2. **Structure Layer (mostly implemented)** — the simulation already
   creates increasingly organized matter: shards → composites → tiles →
   dense formations. This layer continues to expand naturally rather than
   through scripted crafting.
3. **Meaning Layer (next major goal)** — the missing layer. Instead of
   spawning loot or crafting recipes, the engine RECOGNIZES significant
   structures and assigns them meaning (glass ring, metal core, plastic
   web, rock formation, stable nebula vortex) based on topology,
   composition, density, history, scale, and environmental conditions.
   The player discovers these naturally rather than crafting them.
4. **Ecosystem Layer (long-term)** — landmarks become part of living
   ecosystems: NPCs travel to them, wildlife migrates toward them,
   stations build nearby, trade routes emerge, missions originate from
   them. The world continuously evolves while maintaining recognizable
   identities.

---

## Economy Philosophy

**Avoid traditional crafting.** No hundreds of recipes, no massive
inventory management, no long derivative material lists, no resource
spreadsheets.

The player primarily **purchases** — ship hulls, weapons, hardware
upgrades, specialized modules — using currency earned from interacting
with the world. (The shipped Salvage/Drydock spine from PR #64 is the v1
of exactly this.)

**Materials remain physical.** They are terrain, obstacles, ecology, and
resources simultaneously. Players should rarely collect individual
shards; they interact with larger emergent structures.

> The simulation organizes matter. The player harvests opportunities.

**Mining exists** — focused on formations, deposits, and landmarks rather
than vacuuming thousands of shards. NPC mining operations coexist with
the player (protect / raid / compete / ignore).

---

## Exploration Philosophy

Exploration rewards discovering unusual ecosystems, finding landmarks,
observing world evolution, and locating rare natural phenomena.

> Players learn **locations**, not recipes.

Different maps become known for different characteristics: glass-rich
regions, metal graveyards, stable nebula systems, dragon nesting grounds.

---

## World Structure

**Continuous overworld** (preferred direction): the player freely flies
through a continuous universe containing stations, planets, asteroid
belts, NPC traffic, drifting material, simplified material simulation,
landmarks, and portals. The overworld remains alive rather than becoming
a menu.

**High-fidelity submaps**: portals transition into localized simulations —
dense tile simulations, thousands of shards, combat, puzzles, arenas,
special encounters, bosses. These remain toroidal simulations for
performance and gameplay.

**Layered containment** (added 2026-09-03): the overworld is not one map but
a nesting — universe ⊃ galaxy ⊃ solar system ⊃ planet ⊃ moon/station — where
each layer is flown in and is populated by the bodies of the layer beneath
it.  A run starts partway down (planet or solar system), and the layers above
are gated behind engine tiers rather than offered at the start.  This axis is
ORTHOGONAL to the visual-fidelity ladder (open space → planet backdrop →
atmosphere → surface): a layer says what contains what, fidelity says how it
is drawn, and keeping them separate is what stops the art ladder constraining
the world graph.  Detail — including the two portal kinds that serve it — is
in `docs/PORTAL_AND_WORLD_LAYER_PLAN.md`; phasing is in
`docs/CONFIG_CHANGES_PHASED_PLAN.md`.

**Civilizations** emerge as another ecosystem rather than a separate
game: mining companies, researchers, scavengers, traders, military
patrols, smugglers, conservation groups — each interacting with the same
simulation rather than scripted systems. Stations become information
hubs rather than simple vendors.

---

## Persistence Philosophy

| Scale | What persists |
|---|---|
| **Temporary** | combat state, temporary upgrades, consumables, wave progress |
| **Ship** | purchased hardware, owned ships, permanent weapons, installed modules |
| **World** | landmarks, stations, ecosystem state, infrastructure, discoveries |

> The world remembers geography more than individual battles.

**Dynamic equilibrium** — the universe continuously changes while
remaining recognizable. Fast-changing: combat, debris, shards, flow.
Medium: formations, tile clusters, local ecosystems. Slow: landmarks,
stations, migration, regional identity.

---

## Design Principles

1. The simulation creates value. Players discover value.
2. Materials should organize themselves. Players should rarely manage
   individual shards.
3. Recognizable visual forms beat long material names — players identify
   structures by silhouette.
4. Exploration rewards learning ecosystems, not memorizing recipes.
5. Civilization reacts to the simulation rather than replacing it.
6. Meaning emerges from organization rather than scripted recipes.
7. The universe continuously forgets battles but remembers geography.

---

## Development Staging

### Current overhaul (= the game-feedback plan, in flight)

Focus: **high-fidelity submap gameplay**. Aligned additions: improve
material interactions, tile formation, emergence of larger structures,
map generation; design systems so future landmarks can emerge naturally;
keep the data-driven material architecture. **Avoid** large crafting
systems or inventory-heavy economies.

### Next major overhaul (the Overworld plan — post-feedback-plan)

Introduce the continuous overworld: travel, portals, stations, NPC
traffic, localized submaps, map identity, exploration gameplay.

### Future phase (multiplayer)

Expand persistence: evolving ecosystems, civilizations, infrastructure,
multiplayer foundations, location-based persistent maps (real-world
lat/lon anchoring), world-scale economy.

---

## Three Strategic Recommendations for the Current Overhaul

1. **Treat every new mechanic as another expression of the material
   simulation.** If a feature requires a completely separate progression
   or crafting system, question whether it can instead emerge from the
   existing shard/tile framework.
2. **Design for pattern recognition, not recipe memorization.** Favor
   systems where players learn to recognize stable structures,
   environmental conditions, and map identities over systems that
   require remembering lists of crafting combinations or item names.
3. **Preserve clean architectural boundaries.** Keep the current
   overhaul focused on making submaps the best possible high-fidelity
   simulations, but expose extension points (events, detectors,
   metadata, map descriptors) that will let a future overworld recognize
   landmarks, assign meaning, and connect those simulations into a
   living universe without rewriting the core systems.

---

## Implications for the game-feedback plan (orchestration notes)

Resolutions this strategy forces on the plan of record:

- **Decision #34 RESOLVED.** Structure: the current game stays a
  high-fidelity submap/arena game; the continuous overworld is the NEXT
  overhaul, not this one. Economy: purchase-based (Salvage → hulls /
  weapons / hardware / modules), extending the shipped Drydock spine; no
  crafting trees, no inventory-heavy material collection in this plan.
- **(h) Bosses un-gated** — bosses are submap "special encounters",
  squarely in current-overhaul scope. The Mega-Man-X weapon-unlock idea
  must be reconciled with the Drydock purchase model in (h)'s design
  phase (e.g., boss defeat GRANTS the module free vs unlocks its
  purchasability vs unique non-Drydock weapon).
- **(k) Portals un-gated and re-scoped** — portals ship in this plan as
  the submap transition mechanic, built on a **map-descriptor layer**
  (stable map IDs + metadata, not bare enum switching). This is the
  single most important extension point for the overworld phase: the
  future overworld will reference the same descriptors.
- **living-entity task SUPERSEDED** — the Bubble (PR #67) shipped the
  grazer design space (eats shards, grows, splits, ambient fauna).
- **orbital-fields-moons MOVED to the Overworld plan** — planets and
  moving celestial landmarks are overworld features.
- **Landmark detection (Meaning Layer) is NOT in this plan** — but new
  work should avoid foreclosing it: keep structure formation events
  observable (tile snap, composite completion, condensation already
  route through ShardSystem/GameEngine handlers — future detectors can
  hook there).
