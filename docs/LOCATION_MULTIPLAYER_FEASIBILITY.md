# Feasibility Study — Location-Based Multiplayer Omni

> Status: **exploratory**. This is a feasibility/scoping document, not a
> committed design. It evaluates turning Omni from a single-player,
> client-only arena game into a location-based, persistent, multiplayer
> universe where procedurally-generated maps are seeded by real-world
> locations and persist for everyone.
>
> File references point at the code as it exists today so effort estimates
> are grounded in the real architecture, not the aspirational planning docs.

---

## 1. The vision, restated

1. **Real-world locations seed maps.** When a player launches the game at a
   physical place, a procedural map (point of interest — station, planet,
   solar system) is generated for that location.
2. **First visit creates; everyone shares.** The map generated at a location
   persists and is the same map every subsequent player sees there.
3. **Light RPG / exploration loop**, à la a shallow No Man's Sky: there's
   always *somewhere* to go, with light progression — not deep resource
   gathering or base building.
4. **Multiplayer** — players coexist in this shared, location-anchored
   universe.

The core tension: Omni today is a **pure client-side single-player SPA with
no server, no persistence, and no networking** (CLAUDE.md §1). Every one of
the four pillars above requires infrastructure that does not exist yet. The
good news is that the *content-generation* and *simulation* foundations are
unusually well-suited to this pivot. The hard part is everything around the
edges: a backend, accounts, netcode, determinism, and mobile input.

**Verdict up front:** Feasible, but it is a platform build, not a feature.
Pillars 1 and 3 (seeded maps + light RPG) are tractable extensions of the
current engine. Pillars 2 and 4 (persistence + real-time multiplayer) are
greenfield backend/netcode work and dominate the cost and risk. The
recommended path is a **phased build that defers real-time co-op** behind a
shared-but-instanced world model, because that single decision removes the
largest source of risk (MMO-scale authoritative netcode) while still
delivering the "persistent universe seeded by real places" fantasy.

---

## 2. What the current architecture gives us for free

These existing properties are genuine assets for this pivot:

| Asset | Where | Why it helps |
|---|---|---|
| **Procedural map generation already exists** | `engine/maps/TileGenerator.ts`, `MapClasses.ts` | Clustered hex meshes, asteroid streamlines, and nebula clusters are already generated procedurally. We are extending an existing generator, not writing one. |
| **Hex-grid world** | `TileGenerator.ts` (`HEX_*`), odd-r offset coords | The world is *already* a hex grid. Real-world geospatial indexing systems (Uber **H3**) are *also* hex grids. The thematic and technical fit for "location → hex cell → map" is excellent. |
| **Per-map dynamic dimensions** | `engine/toroidal.ts` `setMapDimensions`, `onMapDimensionsChanged` | Maps can be any size; downstream caches rebuild on change. A location's map can be sized to its "importance" without engine surgery. |
| **Fixed-timestep accumulator sim** | `GameEngine.loop()` (`FIXED_DT`, `simAccumulator`) | Deterministic-lockstep netcode *requires* a fixed timestep. We already have one. (We do **not** yet have determinism — see §4.3.) |
| **Decoupled sim vs render** | systems split: Physics/AI/Wave/Shard vs Render | The simulation can in principle run headless (server-authoritative) without the Canvas2D renderer. |
| **Stats-only React bridge** | `onStatsUpdate(EngineStats)` | The HUD already avoids per-frame React churn; adding network state to `EngineStats` follows the existing pattern. |
| **`gold`, `enemyTier`, drops, waves** | `types.ts`, `WaveSystem`, `DropSystem` | Partial RPG scaffolding already exists (`gold` is initialized but unused — CLAUDE.md §4/§8). A progression layer has hooks to attach to. |

---

## 3. What does *not* exist today (the gaps)

Confirmed by inspection of the codebase:

- **No backend / no persistence.** "Single-page app — no server, no backend,
  no persistence beyond in-memory run state" (CLAUDE.md §1). A grep for
  `WebSocket|fetch|socket|server|geolocation` hits only build config and
  comments — there is no networking or storage code anywhere.
- **No accounts / identity.** Nothing distinguishes one player from another.
- **No determinism.** `Math.random()` appears **232 times across 19 files**,
  including the hot sim path (`AISystem`, `PhysicsSystem`, `ShardSystem`,
  `WaveSystem`, `DropSystem`). Map generation alone uses it ~29 times
  (`TileGenerator` ×11, `MapClasses` ×14, `NebulaColor` ×2, `constants` ×2).
  Two *different* determinism problems hide here — see §4.1 and §4.3.
- **Single-player assumptions are baked into the orchestrator.**
  `GameEngine` is a ~2200-line god-class that owns exactly one player
  entity, a camera locked to it, and a `WaveSystem` that spawns enemies
  *relative to that one player*. There is no notion of remote players,
  entity ownership, serialization, or interpolation.
- **Desktop input only.** `InputSystem` is keyboard + mouse. Location-based
  play implies mobile, which means a touch-control workstream.
- **The world is a torus, the Earth is a sphere.** Positions wrap on both
  axes (CLAUDE.md §1). This matters for how literally we map geography (§4.2).

---

## 4. Pillar-by-pillar feasibility

### 4.1 Procedural maps seeded by real-world location — **Feasible (Medium)**

This is the most tractable pillar and the natural first deliverable.

**Location → seed.** Map a real-world coordinate to a stable cell ID, then
hash that to a 32-bit seed:

- Use **H3** (Uber's hexagonal hierarchical geospatial index) at a chosen
  resolution. One H3 cell = one persistent map. Resolution picks the
  granularity (e.g. res 7 ≈ 5 km² "regions"; res 9 ≈ 0.1 km²
  "neighborhood" maps). H3 is a hex grid, which is thematically perfect for
  a hex-tile game.
- `seed = hash(h3Index)`. Same place → same seed → same map, forever, on any
  client, **without storing the geometry** (see §4.4 — this is the key
  insight that shrinks persistence).

**Seeded generation.** Replace `Math.random()` *in the map-gen path only*
with a seeded PRNG (e.g. `mulberry32`/`xorshift128`) threaded through
`TileGenerator` and `MapClasses`. This is a contained, mechanical refactor
of ~29 call sites — it does **not** require making the whole simulation
deterministic. Each map class takes a seed in its constructor;
`GameEngine.buildMap()` (`GameEngine.ts:1102`) passes the location-derived
seed.

**Location flavor (optional polish).** Reverse-geocoding the coordinate
(country, biome, nearby place name, latitude, elevation) can drive
*flavor*: nebula hue from latitude, station name from the nearest town,
map size/POI-type from population density. Core generation stays
seed-driven; metadata only skins it.

**The torus caveat.** Don't try to map literal geography onto the playfield
(coastlines as walls, etc.) — the playfield is a wrap-around torus, not a
plane, and the Earth doesn't tile. The location is an **identity and a
seed**, not a terrain heightmap. "The map *at* Trafalgar Square" means "the
map whose seed is H3(Trafalgar Square)," not "a map shaped like Trafalgar
Square." This is both simpler and avoids the impossible sphere→torus
projection problem.

**Effort:** Medium. Seeded-PRNG refactor of map gen + H3 integration +
geolocation plumbing. No backend strictly required for a *demo* (a client
can regenerate any location's map deterministically offline).

### 4.2 Geolocation & "play at a real place" — **Feasible (Low–Medium), with caveats**

- **Browser Geolocation API** over HTTPS (we already deploy HTTPS on
  Netlify). Straightforward to read a coordinate.
- **Mobile reality.** "Play at a location" is a phone activity. The current
  keyboard/mouse `InputSystem` needs a touch-control layer (virtual stick +
  fire). This is a real, separable workstream — call it out early.
- **Spoofing is a first-class threat.** GPS is trivially spoofed in a
  browser. If *being* somewhere grants ownership/rewards, people will fake
  it. Anti-spoof needs server-side heuristics (impossible-travel checks,
  rate limits, optionally attestation). This pushes toward a server-
  authoritative model for *claims*, even if gameplay is instanced.
- **Privacy.** Storing player locations is sensitive PII. Coarsen to the H3
  cell server-side; never store raw lat/lng tied to identity longer than
  needed. This has legal/compliance weight (GDPR), not just technical.

### 4.3 Multiplayer — **Hard. The dominant cost and risk.**

The engine is single-player to its bones, and **the simulation is not
deterministic** (Math.random in AI/physics/shard/wave/drop). That rules out
naive deterministic lockstep without a large, invasive determinism pass
across *every* sim system — a much bigger job than the map-gen seeding in
§4.1. The realistic options, cheapest to most expensive:

1. **Shared world, solo-instanced ("async multiplayer").** Players share the
   persistent universe — same maps, same POIs, leaderboards, discovery
   credit, asynchronous traces (who's been here, ghost replays, notes) —
   but each person plays their *own* live instance of a location. **No
   real-time netcode at all.** This delivers most of the "persistent shared
   universe" fantasy at a fraction of the risk. Strongly recommended as the
   first multiplayer milestone.
2. **Small-group co-op instances (server-authoritative-lite).** A handful of
   co-located players share one live instance of a location's arena. One
   authoritative host (dedicated server, or an elected client host) runs the
   sim; the local player uses client-side prediction + reconciliation;
   remote players are interpolated. Bounded player counts keep this
   tractable. This is the "real" multiplayer most players will picture, and
   it's a *later* phase.
3. **Full MMO-scale shared live world.** Many strangers in one continuous
   live space. This is a multi-person-year netcode effort (interest
   management, sharding, authoritative anti-cheat at scale). **Out of scope**
   for the foreseeable roadmap; the torus-instance model (option 2) gives
   90% of the feeling without it.

The instancing decision is the single highest-leverage architectural choice
in this whole study. **Persist the *world*; instance the *action*.**

### 4.4 Persistence — **Feasible (Medium), and smaller than it looks**

The naive read of "the map persists for all players" implies storing whole
map snapshots. It doesn't have to:

- **Geometry is free.** If generation is deterministic from the H3-derived
  seed (§4.1), *any client regenerates the identical base map* with zero
  storage. You never persist tiles, asteroids, or nebula layout.
- **Persist only the deltas and the metadata.** What actually needs a
  datastore:
  - **Cell registry**: which locations have been "discovered," by whom,
    when (the "first visitor creates it" record — though with deterministic
    seeds, "creation" is really just *discovery credit*).
  - **POI assignments**: which station/planet/solar-system archetype a cell
    rolled, plus any author-placed or first-visitor-named details.
  - **Mutations**: persistent changes to a cell's base map (structures
    destroyed/built, RPG state), stored as a compact event/diff log keyed by
    cell, replayed over the regenerated base.
  - **Player profiles**: identity, XP, unlocks, inventory, gold (§4.5).
- **Storage shape:** a key-value / document store keyed by H3 cell and by
  player ID fits naturally. No heavyweight relational schema needed at MVP.

**Effort:** Medium — but it is *net-new backend*, which means infra,
deployment, auth, and ops that the project has zero of today.

### 4.5 Light RPG mechanics — **Feasible (Low–Medium)**

Scaffolding already exists: `gold` (initialized, currently unused — CLAUDE.md
§4/§8), `enemyTier`, the drop system, ammo economy, and waves. A light loop —
XP, currency, a few unlockable weapons/ships, per-location objectives —
attaches to these. The new requirement is **persisting the player profile**
(needs §4.4 + accounts), not new core mechanics. Keep it shallow per the
brief: no base building, no deep crafting.

### 4.6 Real-world points of interest inside seeded maps — **Feasible (Medium)**

An enhancement to §4.1: instead of (or alongside) seed-rolled POI archetypes,
populate a cell's map with game objects that correspond to **actual nearby
real-world POIs**. This deepens the "tied to this real place" fantasy and
feeds the exploration loop directly.

**Data source is a licensing decision, not just a technical one.** Because
maps must persist for *everyone*, the POI data has to be stored/derived —
which is exactly what Google Places / Foursquare terms typically forbid.
**OpenStreetMap** (Overpass API) + **Wikidata** are the right choice: open
licenses (ODbL) permit storing and transforming the data, coverage is global
and free, and both are queryable by bounding box / H3-cell area.

**Loose spatial correspondence, not literal terrain.** This is the middle
ground that respects the torus-vs-sphere caveat (§4.1): take each real POI's
lat/lng, normalize it to its position *within* the H3 cell, and place the
corresponding game object at that proportional spot in the map. A museum
north of the player surfaces in the north of the arena. The **seed still
drives terrain/hazards; real POIs drive the destinations.** A taxonomy maps
categories to game objects (museum → archive station, park → garden/nebula
world, transit hub → warp gate, peak → asteroid cluster, place of worship →
monument, …). Avoid surfacing private residences.

**Snapshot at first discovery.** External POI data drifts (closures, OSM
edits). For "same map for everyone forever," snapshot the query result when a
cell is first discovered and persist *that* as part of the cell metadata — it
slots straight into the delta-persistence model of §4.4 (the POI list is just
more cell metadata). OSM/Wikidata licensing permits this snapshot; Google's
generally would not.

**It directly mitigates the cold-start risk (§7).** POI density is wildly
uneven — dense cities overflow, oceans/rural are empty. Resolution: use real
POIs where they exist, and **fall back to seed-generated procedural POIs
where they are sparse**, guaranteeing "always somewhere to go" anywhere on
Earth; cap/cluster in dense areas so a city block isn't 500 stations.

**Effort:** Medium — mostly a backend integration workstream (query →
taxonomy-map → snapshot → persist) layered on Phases 0/1. POIs are public
data, so it adds little privacy burden beyond the §4.2 location concerns.

### 4.7 Grid transit vs torus wrap — the macro-world — **Feasible (Medium) via gates**

The brief asks whether a player could transit from one location's map to a
**neighboring** location's map instead of the edge wrapping back on itself
("maybe only in certain circumstances"). Yes — and the gating instinct is
both better game design and the cheaper build.

**Keep the torus; it is load-bearing.** CLAUDE.md §8 is explicit — "Torus
math is non-optional." The renderer, the physics spatial grid, AI vision,
flow fields, and projectile targeting all assume wrapping. The torus's real
job is keeping entities in a bounded space with **no dead edges** mid-fight.
Don't remove it.

**Model transit as gates, not edges.** The hex fit is elegant: an H3 cell has
exactly **6 neighbors**, so a location-map gets up to **6 warp gates**, one
per hex direction. Fly into a gate → derive the neighbor's seed from its H3
index (the h3 library exposes neighbor lookups directly) → load that map →
spawn at the corresponding opposite gate. The macro-world becomes a hex grid
of location-maps, each of which is itself a hex-tile arena — hexes all the way
down. Normal flight past the world bounds still *wraps* (no death); you only
*leave* via a gate, so the two ideas don't conflict (gates are objects placed
in the world, not edges — a torus has no edges).

**Cheap because the engine already swaps maps.** `loadMap(buildMap(type))`
exists today (`GameEngine.ts:1102`, `:3255`). Gated transit adds a seed
parameter and a spawn-at-gate transition — **not** a simulation rewrite. Gate
topology is automatically consistent: H3 neighbor relations are symmetric
(A's east gate ↔ B's west gate), and seed-determinism means backtracking
regenerates the same neighbor with its persisted state.

**Why "certain circumstances" is the right call:**
- Gating transit (warp fuel, clear-the-wave-first, must-have-discovered-the-
  gate) gives the light-RPG economy something to spend on and reuses the
  dormant `gold`/drop hooks.
- It keeps the live simulation bounded to **one map at a time** — a major win
  for performance *and* for the instancing/netcode model (§4.3): you only
  ever sync one cell's instance.

**Avoid seamless edge streaming.** The alternative — non-wrapping edges that
stream the neighbor in live — breaks the torus invariant, needs two
simulations coexisting at the boundary, entities straddling the seam, live
load/unload, and a camera hand-off. That's an XL effort that fights the
engine for little benefit over gates. Recommend gates; avoid seamless
streaming, likely permanently.

---

## 5. Cross-cutting requirements (the "platform tax")

These are needed regardless of how multiplayer is scoped:

1. **Accounts / identity** — prerequisite for persistence, anti-cheat, and
   any social feature. (Auth provider or anonymous device identity to start.)
2. **Backend service + datastore** — the project has none. This is the
   foundational lift everything else hangs off.
3. **Two determinism efforts, kept separate:**
   - *Map-gen determinism* (§4.1) — small, contained, needed for §4.1. Do
     this first.
   - *Simulation determinism* (§4.3 option 2) — large, invasive, only needed
     if/when we do lockstep co-op. Defer or avoid via host-authoritative
     instancing.
4. **Mobile / touch input** — location play is mobile play.
5. **Anti-cheat & anti-spoof** — server validation of location claims and
   state mutations.
6. **Privacy/compliance** — coarsen and protect location PII.

---

## 6. Recommended phased roadmap

Each phase is independently shippable and de-risks the next.

- **Phase 0 — Seeded generation (no backend).**
  Refactor map-gen `Math.random()` → seeded PRNG; add H3 + Geolocation;
  "play the map at your location" works fully offline/deterministically.
  Proves the core fantasy with near-zero infra. *(Pillar 1; Medium.)*

- **Phase 1 — Backend + accounts + persistence.**
  Stand up the service and datastore. Persist cell discovery, POI rolls, and
  player profiles. Add the RPG profile layer. Still single-player, but the
  universe is now shared and durable: visit a place someone else discovered
  and see *their* named station. *(Pillars 2, 3; Medium-High — first real
  infra.)*

- **Phase 2 — Async/social shared world.**
  Discovery feeds, leaderboards, ghost traces, persistent map mutations
  (diff log). "Multiplayer" in the Journey/Death-Stranding sense, no
  real-time netcode. *(Pillar 4 option 1; Medium.)*

- **Phase 3 — Mobile + touch.**
  First-class phone client. Can overlap earlier phases. *(Cross-cutting;
  Medium.)*

- **Phase 4 — Real-time co-op instances.**
  Host-authoritative small-group instances with prediction/interpolation.
  The big netcode lift, attempted only after the platform is proven.
  *(Pillar 4 option 2; High.)*

---

## 7. Key risks & open questions

| Risk / question | Notes |
|---|---|
| **Sim determinism for lockstep** | 232 `Math.random()` sites; floats; not designed for it. Avoid by choosing host-authoritative instancing (§4.3 opt 2) over lockstep. |
| **Empty-world cold start** | Most H3 cells will never be visited. Need "always somewhere to go" — interesting *unvisited* maps must be generable on demand, and discovery must feel rewarding. Deterministic gen makes this cheap; real-POI placement with procedural fallback (§4.6) covers both dense and empty regions. |
| **External POI data licensing/drift** | "Persist for everyone" requires storing derived POI data — use OSM/Wikidata (ODbL), not Google/Foursquare. Snapshot at first discovery to freeze drift (§4.6). |
| **Location spoofing / griefing** | If location grants ownership/rewards, expect abuse. Needs server-side validation; influences how much authority clients get. |
| **Privacy/legal** | Storing player locations is regulated PII. Coarsen to H3 cell; minimize retention. |
| **Mobile input + performance** | Touch controls are net-new; Canvas2D perf on mid-range phones needs validation (`PerfController` helps but is desktop-tuned). |
| **Torus ≠ sphere** | Resolved by treating location as seed/identity, not terrain — but worth stating explicitly so nobody tries to project coastlines. |
| **Ops burden** | Going from "static Netlify SPA" to "live service with a database and auth" is a permanent operational step-change for the project. |
| **Scope discipline** | The brief says *light* RPG. Easy to balloon into No Man's Sky. Hold the line. |

---

## 8. Bottom line

The pivot is **feasible and the engine is a better starting point than most**
(procedural hex generation, fixed-timestep sim, dynamic map sizing, and a
hex world that maps cleanly onto H3 geospatial indexing). The work splits
cleanly:

- **Cheap & high-value, do first:** seeded location maps (§4.1) — a contained
  refactor that proves the fantasy with no backend.
- **The real platform cost:** backend, accounts, and persistence (§4.4–§5) —
  net-new but bounded, and *smaller than it looks* because deterministic
  generation means you persist deltas, not maps.
- **The thing to defer:** real-time co-op netcode (§4.3) — sidestep it with a
  "persist the world, instance the action" model and an async-multiplayer
  first milestone, attempting live co-op only once the platform is proven.

Recommend proceeding to **Phase 0** as a spike: it's low-risk, validates the
seed→location→map loop end-to-end, and forces the determinism boundary that
every later phase depends on.
