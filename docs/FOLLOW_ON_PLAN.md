# Follow-On Plan — Phases B–G

Status and kickoff document for the guidance session that runs the
remaining phases of the game-redesign plan, now that Phase A has merged
to `main` (PR #93, 2026-09-23).

This document says **where the plan stands and what runs next**.  The
detailed per-element specs, gauntlet-vs-session recommendations, decision
arguments and supersession history stay in
`docs/CONFIG_CHANGES_PHASED_PLAN.md` — that document remains the master;
this one is the entry point a new session reads first.  Companion docs
and their precedence are listed in §4.

---

## 1. Where the plan stands

**Phase A — COMPLETE.**  All five elements landed on what is now `main`:

- **A1 — Bubble aggro timeout** (PR #97): the non-aggression timeout
  (`AGGRO_TIMEOUT_SEC`) through the single `stampBubbleAggro` /
  `calmBubble` seam.
- **A2 — Post-attack bubble immovability** (PR #97): root cause was the
  AI speed cap deleting collision recoil — fixed; the caps now bound
  propulsion, never motion.
- **A3 — Penetration module** (PR #96): landed, then **RETIRED by
  PR #102's kinetic model** — penetration is emergent from a round's
  energy, so it stopped being a thing to sell; Gunnery absorbed it
  (a mark buys a denser round).
- **A4 — Scanner module family** (PR #96, then reworked in play-test):
  a TOOL the player operates — the map is found, not given; a scan is a
  ping; marks stack in range; five marks each add a category.  The
  `poiTier` rungs are pre-built for G4's hidden wormholes.
- **A5 — Purchasable module slots** (PR #96): landed without touching
  `HEX_ADJACENCY`; `MODULE_SLOT_UNLOCK.START` equals the cap today, so
  the count is the seam D2's ship catalog cashes in.

**Plus two unlisted windfalls** the plan has already absorbed:

- **Unified impact physics** (PRs #98/#102): damage is kinetic, a round
  carries a bite and an energy bank, penetration and blast derive from
  energy, crashes spend real kinetic energy, `MASS_SCALE` 10×.  Absorbed
  into D1's reframed minor-module list and B1's weapon tuning.
- **The grain/voronoi fracture work** (PR #91 + the material grain
  spec's A1–A5): per-material grain patterns, boundary-derived HP,
  partial-fracture detach.  Absorbed into B1, B2, and decisions #2/#13.

---

## 2. Remaining phases, in running order

**B → C → D → E → G1 → F → G2/G3/G4/G5.**

- **B — Mining foundation** *(GAUNTLET: "mining gauntlet")* — miner
  start (B1), mining yields (B2), material buckets + storage (B3),
  engine gating + fuel (B4).  Best-positioned it has ever been:
  mining-as-chipping is literally shipped mechanics now — the
  partial-fracture detach path and the per-material grain toughness
  ladder are what a mining beam works against.
- **C — Home colony arena** *(sessions)* — home arena map (C1), colony
  defense waves (C2), drones (C3), colony shop (C4).
- **D — Module & ship-catalog reconfiguration** *(GAUNTLET: "outfitting
  gauntlet")* — minor/major module taxonomy (D1 — reframed to kinetic
  terms: round mass, muzzle velocity, fire rate, on-hit effects),
  per-ship slot counts (D2), ship catalog (D3), roguelike portal runs
  (D4), secret/super modules (D5).
- **E — Bubble ecology** *(GAUNTLET: "ecology gauntlet")* — assembler
  bubbles (E1), sexed lifecycle (E2), hive (E3), invasive elders +
  storyline (E4).
- **G1 — Node identity + explicit edges** *(session — promoted to run
  just before Phase F)* — the small schema half of the universe map:
  stable node ids, layer/parent relationships, edges as data.  No
  generation.  What F2, D4 and G4's discovered-state actually need.
- **F — Persistence** *(GAUNTLET: "persistence gauntlet")* — player/run
  save-load (F1), then per-node arena state keyed on G1's ids (F2).
- **G2–G5 — Universe map** *(worldgen GAUNTLET, except G4 as a
  session)* — procedural arena generation (G2), layer-keyed gateways +
  celestial backdrops (G3), hidden wormholes (G4 — already half-shipped:
  the scanner's `poiTier` rungs and the `ENCOUNTER_MAX_POI_TIER`
  concealment rule exist, so the mechanical half is stamping `poiTier`
  on a wormhole portal; what remains is discovery-cue tuning and
  per-node discovered-state), maze/labyrinth modes (G5).

---

## 3. Open decisions

**Three gate Phase B and must be answered before the mining gauntlet
starts** (numbering follows the master plan's §5):

1. **(#1, D-1) Miner slot layout.**  The request list contradicts
   itself ("three module slots … storage module and a blaster" vs. "two
   slots for modules, one weapon and one standard, pre-filled with
   mining beam and hull, respectively, and 3 slots for inventory").
   Pick one; the master plan recommends the second — it matches the
   inventory-bucket design and D2's per-ship slot model.
2. **(#2, B1) Mining weapon identity.**  Mining Beam vs. weak Blaster
   as the starting gun.  **The grain table moved the goalposts**: under
   the shipped play-tested defaults a glass tile takes ~13
   Blaster-class hits, so the originally requested 3–5-hit band is now
   BELOW current glass toughness, not above it.  Either the band is
   renegotiated, or — the more interesting option — the Mining Beam
   hits TERRAIN harder than it hits enemies, which gives the miner a
   real identity (a tool, not a gun) and leaves combat balance
   untouched.
3. **(#13, B2) Mining materials vs. Tier C per-grain materials.**
   MATERIAL_GRAIN_SPEC §4's Tier C (per-grain materials — proposed, not
   built) is the natural substrate for ore/veins: a rock tile carrying
   metal grains IS a deposit, and mining it is the partial-fracture
   detach that already ships.  Decide whether B2 commissions Tier C
   (pulling real rendering-cost work into Phase B) or ships a simpler
   per-variant yield table that stays forward-compatible with it.

**The rest (#3–#12, #14) gate later phases** and are listed with their
full arguments in the master plan's §5: majors-as-gun-transformers (#3,
gates D1), home-arena flavour (#4, C1), elder HP ceiling (#5, E4),
persistence scope (#6, F1), GPS overworld parked (#7), node memory (#8,
gates G1/F2), gateway art source (#9, G3), discovery cue strength (#10,
G4), maze legibility (#11, G5), starting layer (#12, C1/G), and the
bubble mass model (#14, E2/E3).

---

## 4. Companion documents and precedence

- `docs/CONFIG_CHANGES_PHASED_PLAN.md` — the MASTER plan: per-element
  specs, the request-list mapping, Phase A's strike-through history,
  the full decision arguments.  This document defers to it everywhere
  they overlap.
- `docs/PORTAL_AND_WORLD_LAYER_PLAN.md` — owns portal and world-layer
  detail (the layer hierarchy, gateway taxonomy, hidden-wormhole
  design, maze topology).  Takes precedence over both plan documents on
  those subjects.
- `docs/MATERIAL_GRAIN_SPEC.md` — the proposed (not built) grain-model
  generalisation; its Tier C is decision #13's subject.  NOTE its
  A1..C labels are doc-local and do NOT refer to this plan's phase IDs.
- `CLAUDE.md` — the master spec of what is currently implemented; the
  source of truth wherever a plan claim and shipped behaviour disagree.

House pattern: every gauntlet keeps a `docs/GAUNTLET_<NAME>_LOG.md`
with numbered milestones and decisions.
