# Portals & World Layering — Design Plan

> **Status: FORWARD-LOOKING PLAN, not implementation description.**  Nothing
> below is shipped except where it says so explicitly and points at
> `CLAUDE.md`.  `CLAUDE.md` remains the source of truth for what exists.
>
> Captured 2026-09-03 from the portal session (PR #92), after the wormhole
> gravity / lensing / transit work landed and the user described where
> portals are going.

---

## 0. How this document relates to the others

There are three documents in play and they do not overlap by accident:

| Doc | Owns |
|---|---|
| `CONFIG_CHANGES_PHASED_PLAN.md` | **The master plan.** Phase order, element IDs (`A1`…`G3`), gauntlet-vs-session calls, the decisions the guidance session owes. |
| **This doc** | **Portals and world layering, in detail.** What a portal *is*, what the layers *are*, how they are found, and which topologies they build. |
| `GAME_STRUCTURE_STRATEGY.md` | The strategy of record — continuous overworld, high-fidelity submaps, the persistence philosophy table. Unchanged by this doc. |

**Precedence, both directions, so a future session does not have to guess:**

- **This doc takes precedence over `CONFIG_CHANGES_PHASED_PLAN.md` on
  PORTALS and OVERWORLD LAYERING where the two overlap** (user directive,
  2026-09-03).  Concretely that means the portal taxonomy in §3, the layer
  model in §2, the discovery rules in §4 and the topologies in §5 supersede
  the one-line portal art direction in that plan's **G3** and the flat
  "Level-1 / Level-2 arena" framing.
- **`CONFIG_CHANGES_PHASED_PLAN.md` takes precedence on everything else** —
  phase ordering, which work is a gauntlet, element IDs, and every system
  this doc does not cover (mining, colony, outfitting, ecology).  Where this
  doc proposes sequencing (§6) it is a *recommendation into* that plan, not
  a replacement for it.
- Element IDs are that plan's.  This doc references them rather than
  inventing a parallel numbering; §7 is the interface table.

---

## 1. What already ships (so the plan is not confused with reality)

Portals are implemented as proximity POIs and are described fully in
`CLAUDE.md` §8 ("The map portal POI follows the station's recipe exactly").
The parts that matter to everything below:

- `portalTargetId` is a **descriptor id**, never a bare `MapType` — the
  seam every future destination scheme reuses.
- A portal is a real **gravity well** (`gravityRange` / `gravityStrength`,
  with `GRAVITY_PLAYER_SCALE` sparing the player), it **lenses the star
  field**, it **swallows** small matter under `portalHorizonRadius(e)`, it
  **ejects** anything too big to fit, and anything that steers itself
  **holds off** it (`avoidsPortals`).
- The shipped well is `SIZE` 70 / `g1500` / range 525 — play-tested down
  from `g6000` / 1050.  **This matters to §4**: at the retuned strength the
  peak pull is 0.15 px/step, which is a current you notice rather than a
  hazard, and the discovery cues are correspondingly subtle.
- `transitionToMap(id, {descend})`, `stageIndex`, the depth stride and the
  amber descent rift all exist and are tested.  **`openDescentPortal` is
  present verbatim and uncalled** — only the one call that puts a rift in
  the world was removed, pending this design.
- There is **no per-map state**: destroyed tiles do not persist, and
  `WaveSystem.init` zeroes the ladder on every entry.

---

## 2. The layer model

The world is a **containment hierarchy**, not a difficulty ladder:

```
  universe
    └── galaxy
          └── solar system
                └── planet            ← a likely starting layer
                      └── moon / station / freighter
```

Each layer is a map the player flies in, populated with the **bodies of the
layer below it**: a galaxy overworld contains solar systems, a solar-system
overworld contains stars, planets and stations, a planet overworld contains
moons and stations.  Travelling *down* means entering one of those bodies.

Two things are deliberate:

- **The player does not start at the top.**  A run begins at a planet or
  solar-system overworld.  The universe and galaxy layers are travel
  destinations gated behind engine tiers (`CONFIG_CHANGES_PHASED_PLAN`
  **B4**: interplanetary engine + fuel), not the opening screen.
- **This axis is orthogonal to visual fidelity.**  The master plan's
  "Level-1 / Level-2 / Level-3 / Level-4 arenas" ladder is about *backdrop
  and player capability* (open space → planet backdrop → atmosphere →
  surface walking).  A layer is about *what contains what*.  A planet
  overworld and a solar-system overworld can share a Level-1 backdrop; a
  Level-2 planet-backdrop arena can sit at several layers.  Keeping them
  separate is what stops the art ladder from constraining the world graph.

### Primary vs. leaf nodes

- **Primary overworlds** are the layer nodes above.  They carry the economy:
  mining, stations, colony, traffic (`CONFIG_CHANGES_PHASED_PLAN` phases
  B and C).  They are relatively safe and relatively persistent.
- **Leaf nodes** are what hidden portals lead to: wave arenas, roguelike
  runs, mazes, labyrinths.  They are transient, dense, combat-shaped, and
  they hang off a primary node rather than sitting in the hierarchy.

That distinction is the one that makes the graph tractable: the hierarchy is
a *tree of primary nodes*, and everything else is a decorated edge off one of
them.

---

## 3. Two portal kinds

Today there is one portal, drawn as a black disc with a name tag.  The design
splits it in two.  They share the same entity recipe, the same
`portalTargetId` seam and the same interaction trigger — what differs is what
they look like, whether they are signposted, and what they connect.

### 3a. The GATEWAY — a celestial body you fly into

The signposted way to travel between primary overworlds.  Rendered as a
**parallax 3-D celestial body** rather than a hole: layered art that shifts
against the camera, so it reads as an object at distance rather than a
doorway.

Its body type is **the layer it leads to**, which is what makes the taxonomy
carry information rather than being decoration:

| Body drawn | Appears in | Leads to |
|---|---|---|
| Galaxy | universe overworld | a galaxy |
| Solar system | galaxy overworld | a solar system |
| Star / planet / station | solar-system overworld | that body's overworld |
| Moon / station / freighter | planet overworld | that body's overworld |

So a player reads their altitude off the sky: if the things you can fly into
are planets, you are in a solar system.

**Rendering constraints, inherited from the star-field gauntlet** — these are
not optional and the gauntlet log explains why:

- Anything pre-rendered and blitted at a fractional or dpr-scaled offset
  reintroduces the `drawImage` filter-kernel browser dependence that
  `docs/GAUNTLET_STARFIELD_LOG.md` S4 removed.  Parallax layers must either
  be drawn analytically or blitted on whole device pixels.
- `BackgroundManager` already owns per-map parallax and a seeded generator;
  a gateway body is closer to that machinery than to `dropShapes.ts`.
- It will want the same A/B knob treatment the lens got (DBG ▸ Portals),
  because "does this read as depth at 390px" is a feel question.

**Art source is an open decision** — see §8.

### 3b. The WORMHOLE — a hidden hole you have to find

What ships today, minus its label.  Leads to leaf nodes: wave arenas,
roguelike runs, mazes, labyrinths.

The change is that a wormhole is **unlabelled and unindicated until
discovered**: no world-space destination tag, no off-screen chevron, no
minimap blip.  It has to be found from its *physics*, which the engine
already simulates:

- **Matter flowing in.**  Shards, drops and debris spiral toward the mouth
  and vanish under the horizon — a convergence visible from outside.
- **Matter flying out.**  Objects too big to fit are flung back
  (`EJECT.SIZE_FRACTION`), and transit debris re-emerges from the mouth.
- **The star lens.**  The background warps around the throat.
- **The pull itself**, felt on the ship at `GRAVITY_PLAYER_SCALE`.

This is the part of the design the existing simulation most nearly gives for
free, and §4 is about the gap.

---

## 4. Discovery — and an honest problem with it

Hidden portals interface with the master plan's **A4 scanner module**: the
scanner is what *reveals* a wormhole (label, chevron, minimap blip), and its
Mk III tier already reads "portals/POIs map-wide" in that plan.  The natural
split:

- **Unscanned**: no label, no indicator, no blip.  Only the physical cues.
- **Scanned** (in range of a sufficient scanner, or previously discovered):
  behaves as portals do today.
- **Discovered state is per node**, which makes it a consumer of node
  identity (§6) and of persistence (**F1/F2**) rather than a render flag.

**The problem, stated plainly rather than assumed away:** the well was just
retuned *down* by a factor of four in strength and two in range (user call —
it read as too powerful).  At `g1500` / 525 the peak pull is 0.15 px/step
against ambient shard drift of ~1, and the lens hugs a disc whose radius at
the hub is ~15 units.  Those cues are subtle *by design now*, and the same
subtlety that fixed the dizziness makes a rift harder to spot.

Three ways out, none of them free, and this wants a play-test rather than a
decision on paper:

1. **Hidden portals get their own, stronger well.**  Keeps the tuned
   overworld gateways comfortable while making leaf-node wormholes read from
   a distance.  Cheapest: the well is already per-entity, stamped by
   `addPortal`.
2. **The cues get louder without the well getting stronger.**  More visible
   in-flow (a debris tail), a wider lens radius at the same push, an audible
   bed at range (`poi.portal.idle` already exists and is distance-driven).
3. **Discovery is scanner-first by design** and the physical cues are a
   bonus for observant players rather than the primary channel.  This is the
   safest and the least interesting.

Recommendation: (1) plus a little of (2), A/B'd on the DBG Portals knobs that
already exist — the knobs were built for exactly this kind of question and
the retune above is the worked precedent.

---

## 5. Topologies — the maze is the general case

Four things the user described are, structurally, one thing with different
edge patterns over the same node/edge graph:

| Mode | Topology | Extra machinery |
|---|---|---|
| **Layer hierarchy** | tree of primary nodes, one edge per contained body | typed nodes; gateway art |
| **Roguelike descent** (**D4**) | a path: node → node → node, depth-scaled | reward choice at each step |
| **Portal maze** | many small nodes, several edges each, some cyclic | minor enemies; a way to not get lost |
| **Labyrinth** | maze + a terminal node holding a boss and a reward | boss placement; a reward node type |

The consequence worth acting on: **build the graph once and mazes are a
generator, not an engine change.**  A maze is a set of nodes with an edge
pattern; a labyrinth is that with one node flagged terminal.  Neither needs
new portal code once portals are edges.

Two things a maze needs that the hierarchy does not:

- **More than one exit edge per node**, and edges that are not simply
  "out and back".  Today `addReturnPortal()` hardcodes exactly one way home;
  a maze node has several doors and possibly no direct route back.
- **Some way to not be lost.**  Either the maze is small enough to hold in
  the head, or there is a map screen (which does not exist), or breadcrumbs
  are physical (the transit-debris trail is a candidate — matter you dragged
  through marks where you have been).  This is a real design question and it
  is not answered here.

---

## 6. Sequencing — split node identity from worldgen

There is a live tension between two documents, and it should be resolved
deliberately rather than by whichever session gets there first:

- `PARKING_LOT.md` §"Area composition — … a real map GRAPH" (2026-08-08):
  *"Building the graph once serves both — it should probably be the first
  piece built, since composition-per-node and persistence-per-node both hang
  off node identity."*
- `CONFIG_CHANGES_PHASED_PLAN.md` puts the graph **last**, as **G1**, after
  mining, colony, outfitting, ecology and persistence — and consequently has
  to note that **F2** "interleaves with G".

Both are right about different halves, because "the graph" is two pieces:

**(a) Node identity + explicit edges — small, and wanted early.**
A schema change to `MAP_DESCRIPTORS`: a stable node id (already there), a
`layer` / parent relationship, and edges declared as data instead of being
hardcoded per map class (`HUB_PORTAL_SITES`, `RETURN_PORTAL_OFFSET`,
`addReturnPortal()`).  **No generation.**  It is a refactor of something that
already exists, over the hand-authored maps that already exist, and it is
what **F2** (per-node arena state), **D4** (which run am I on) and hidden-
portal discovered-state all actually need.

**(b) Procedural generation — large, and fine where it is.**
Seeded per-node generation, population tables as generator output, regional
material composition.  That is **G2**, a gauntlet, and nothing above needs it.

**Recommendation:** promote (a) out of Phase G to sit just before **F**
(persistence), leave (b) in Phase G unchanged.  This removes the documented
F2↔G interleave, honours the parking lot's "build it first" without
reordering the plan's substance, and is a cheap, mechanical change against a
green base.  *Phase ordering is the master plan's call — this is a
recommendation into it, per §0.*

---

## 7. Interface table — this doc ↔ `CONFIG_CHANGES_PHASED_PLAN.md`

| This doc | Element | Relationship |
|---|---|---|
| §2 layer model | **G1**, **G3** | **Supersedes** the flat "Level-1/Level-2 arena" framing for *world structure*. The art ladder stays G3's; the containment axis is new and orthogonal. |
| §3a gateway portals | **G3** | **Supersedes** "portal graphics restyled as planets/stations" with the layer-keyed taxonomy and the star-field rendering constraints. |
| §3b hidden wormholes | — | **New.** No element covers it; needs one. |
| §4 discovery / scanning | **A4** | **Extends.** A4 builds the scanner; this doc says what it is scanning *for* and that discovered-state is per node. A4 ships pre-merge and must not assume hidden portals exist yet — absence of a scanner must still degrade to today's behaviour exactly. |
| §5 maze / labyrinth | — | **New.** No element covers them. |
| §5 roguelike descent | **D4** | **Compatible.** D4 owns the reward loop; this doc says descent is one path shape through the same graph, and that `openDescentPortal` should stay uncalled until node identity lands (see §8). |
| §6 node identity | **G1**, **F2** | **Recommends** splitting G1 and promoting the identity half ahead of F. |
| §6 worldgen | **G2** | Unchanged. |
| Surface / walkable arenas | Parked (L3/L4) | Unchanged — still parked behind G. |

---

## 8. Open decisions

1. **Persistence scope for a node.**  Does a node remember anything, and for
   how long?  This is the decision that shapes the graph's schema, and every
   item in §5 assumes *some* answer.  `GAME_STRUCTURE_STRATEGY.md`'s
   persistence table and `PARKING_LOT.md` §"Portal persistence" Shape 1 /
   Shape 2 are the existing positions; **F1/F2** is where it lands.  Answer
   before §6(a) is built, or it gets built twice.
2. **Gateway art source.**  Hand-authored layered images, or procedurally
   drawn bodies?  Images are prettier and cost assets, an art pipeline and
   bundle size; procedural is cheaper, themeable per node seed, and fits the
   engine's existing habits (every other thing in this game is drawn, not
   blitted).  Recommend procedural for the first cut, precisely so G2's
   seeded generation can drive it.
3. **Discovery cue strength** (§4) — own well, louder cues, or scanner-first.
   A/B on the DBG Portals knobs; do not decide on paper.
4. **Maze legibility** (§5) — small mazes, a map screen, or physical
   breadcrumbs.  A map screen is a genuinely new UI surface and should be
   costed before a maze mode is committed to.
5. **When the descent rift comes back.**  It is one uncommented call away
   (`openDescentPortal`).  Recommendation: leave it off until node identity
   exists, because its destination today is a *random* arena descriptor and
   the hierarchy is about to define what "deeper" means.  Turning it on
   afterwards costs the same one line; turning it on now writes code the
   layer work has to unwrite.
6. **Which layer a run starts at** — planet or solar system.  Interacts with
   **C1** (home colony arena), which currently assumes an isolated station.

---

## 9. What this session deliberately did NOT build

Recorded so the next session does not re-litigate it: no code was written for
any of the above.  The reasoning was that every item hangs off the layer
model or node identity, and building any of them first means building against
a guess — with the one item that *looks* independent (gateway parallax art)
being a door to nowhere until there is a layer behind it.

Portal work that DID ship in this session is in `CLAUDE.md` (wormhole
gravity, star lensing, debris transit, the flight-through beat, the eject and
avoidance rules, the DBG Portals menu, and the play-tested well retune).
