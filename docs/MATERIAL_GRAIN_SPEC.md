# Material Grain Spec

**Status: A1 IMPLEMENTED; the rest PROPOSED.**  A1 (the GrainSpec types
and per-material regularity) shipped — see §7 for what that covered and
what is still ahead.  V15
shipped the grain-boundary model for rock and glass (see
`docs/GAUNTLET_VORONOI_LOG.md`); this spec generalises it into a material
system and folds BONDING into the same object, so that adding a material
is filling in a row rather than writing a mechanic.

Read `CLAUDE.md` §8 "DAMAGE LANDS ON GRAIN BOUNDARIES" first — this
document assumes that model and extends it.

---

## 0. Vocabulary

Four terms, deliberately distinct.  GRAINS DO NOT REPLACE SHARDS — they
are what a shard is made of, and what a shard was before it left.

| term | what it is | lifetime |
|---|---|---|
| **material** | a row in the spec (rock, glass, metal, plastic…) | config |
| **grain** | one internal cell of a body's pattern | lives inside a body |
| **shard** | a MOBILE entity (finite mass).  A grain that detaches becomes one | an entity |
| **tile** | a STATIC entity (mass ∞) | an entity |

So a grain becomes a shard when it breaks off, and a shard is itself made
of grains — the model applies to tiles and shards alike, which is what
V15 already ships (`rock-tile`, `rock-shard`, `glass-tile`, `glass-shard`
all carry it).  `SHARD_VARIANTS`, `shardVariant` and `ShardVariantId`
keep their names and meanings; what A1 renames is the POLICY that
describes a body's internal grain structure
(`ShardFracturePolicy` → `GrainSpec`, and the variant field
`fracture` → `grain`), which hangs off tile and shard rows equally.

---

## 1. The one idea: a boundary IS a bond

V15 made a body a set of GRAINS held together by BOUNDARIES, where a
boundary carries a strength, absorbs damage, and fails.  A grain leaves
when nothing binds it any more.

Joining is that same relationship, formed instead of broken.  Two grains
that come to rest against each other and stick have created a boundary;
the body they now form is a set of grains held together by boundaries.
Breaking and joining are one mechanic viewed from two directions:

| | breaking | joining |
|---|---|---|
| the object | a boundary between two grains | a boundary between two grains |
| the event | damage fills it until it fails | contact holds until it forms |
| the number | `bondStrength × length` | `bondStrength × length` |
| the result | the grain leaves the body | the grain joins the body |

Everything below follows from taking that literally.  Three things fall
out that are otherwise separate features:

- **Metal's lattice stops being bespoke code.**  "Small, highly regular
  grains that stick to each other very hard" is a parameter row, not the
  `METAL_ASSEMBLY` / `metalCells` machinery.
- **Composite materials (per-grain material) become cheap.**  If a
  boundary's strength is a function of the two grains it separates, a
  body whose grains carry different materials needs no new mechanic —
  only a pair function.
- **The seven joining mechanisms below collapse toward one.**

### 1.1 What "joining" is today

Seven parallel mechanisms, none aware of the others:

| # | mechanism | where | materials |
|---|---|---|---|
| 1 | gravity pull (`merge.attractedTo`, pull range/strength/inner) | ShardSystem | all mobile |
| 2 | contact stick bonds (`merge.bondsWith`, bond seconds, `bondPartners` with `cohesionOnly` + strength tiers) | ShardSystem | all mobile |
| 3 | compose (the single `MergeOutcome`, accumulates `mergeCount`) | ShardSystem | all |
| 4 | rock density condensation (`ROCK_CONDENSE`, 25 size×density tiers, top cell → static tile) | ShardSystem | rock |
| 5 | metal composite lattice (`METAL_ASSEMBLY`, `metalCells` 6-cell hexagon, `metalExcessCells` invisible mass, per-cell SAT colliders) | ShardSystem + PhysicsSystem | metal |
| 6 | tile snap (`TILE_SNAP`, merged area ≥ 2× tile diameter + rest speed → static tile + debris) | ShardSystem | plastic, glass, metal |
| 7 | nebula transmutation (area threshold → nebula tile) | NebulaSystem | nebula |

Note `MergeOutcome` is a union with exactly one member (`'compose'`).
The seam for "a merge can end differently" was cut and never used; 4, 5,
6 and 7 all grew as separate code paths beside it instead.

---

## 2. The GrainSpec

A material is a row.  Four groups of parameters, each answering one
question, and every one of them a number rather than a branch.

### 2.1 Grain geometry — what the pattern looks like

| field | meaning | range |
|---|---|---|
| `grainSize` | px of body diameter per grain.  Small = many grains | 4–40 |
| `grainCountMin` / `Max` | clamp on the count the size implies | 2–40 |
| `regularity` | 0 = raw Poisson (ragged, uneven), 1 = near-honeycomb | 0–1 |
| `sizeSpread` | 0 = every grain the same size, 1 = a wide mix of coarse and fine in one body | 0–1 |
| `impactBias` | fraction of grains crowded toward the hit — the radial "glass star" look | 0–1 |

**`regularity` is the blocking change.**  The two dials that produce it
already exist — Lloyd relaxation rounds and blue-noise minimum
separation — but they are read from GLOBAL DBG accessors
(`getFractureRelax()` / `getFractureSeparation()` in
`fractureCache.ensureFractureCells`).  Per-material regularity is not
expressible today at all, and it is exactly what "metal highly regular,
plastic irregular" needs.  The fix is small: move both into the spec,
keep the DBG cycles as an override rather than the source.

**`sizeSpread` is a new axis** and the one that buys "equal amounts of
smaller and larger grains".  Implementation: place a `spread`-determined
fraction of sites with a large minimum separation (the coarse
population) and the rest with a small one (the fines), then relax.  At 0
this reduces exactly to today's single-separation placement, so it costs
nothing when unused.

### 2.2 Bond strength — how hard it is to break, and to form

| field | meaning |
|---|---|
| `bondStrength` | damage per PIXEL of boundary.  The material's toughness, one number (V15) |
| `bondSpread` | 0..1 seeded per-boundary variance, so some grains pop early and some hold |
| `bondFormSeconds` | contact time before a touching grain sticks (today's `bondTimeSeconds`) |
| `cohesion` | how strongly a formed bond drags its partner's velocity (today's `strength: 'strong' \| 'default'`, made continuous) |

`bondSpread` is the cheap 80% of the composite feature: varied breaking
WITHIN one material, with no per-grain material and no matrix.  It is
worth shipping before Tier C for exactly that reason.

### 2.3 Deformation — what a hit does before anything breaks

| field | meaning |
|---|---|
| `grainDent` | per-hit inward pull on the STRUCK GRAIN's own outline, as a fraction of its radius |
| `dentRecovery` | seconds to spring back, 0 = permanent |

This is the "deformation applied at each voronoi shard within a tile"
ask.  The mechanism it replaces (`applyDentStep`) pulls the WHOLE body's
outline and stands down entirely under progressive fracture, which is
why plastic and metal currently cannot be both dentable and grained.

Per-grain denting composes with V15 cleanly because the parent's outline
is already **derived** from its grains (`unionOfCells`): dent a grain,
re-derive the union, and the body's silhouette follows for free.  The one
real cost is §5.2 below.

### 2.4 Coupling — parameters that track entity state

| field | meaning |
|---|---|
| `densityCouplesGrainSize` | grain size scales DOWN with `densityTier` |
| `densityCouplesStrength` | bond strength scales UP with `densityTier` |

This is how metal gets "small to large grains based on metal colouring":
`densityTier` already drives metal's brightness, so grain size tracking
the same number means the colour IS the readout of the grain structure.
A pale, low-tier plate has coarse grains and breaks up easily; a bright,
dense one is fine-grained and very hard — visible before you shoot it.

### 2.5 The archetype table

The point of the axes is that materials are positions in the space, not
code.  Shipped today, requested now, and illustrative:

| material | grainSize | regularity | sizeSpread | bondStrength | grainDent | notes |
|---|---|---|---|---|---|---|
| glass *(shipped)* | 6 | 0.3 | 0.2 | 0.16 | 0 | brittle, radial, dies in 5 |
| rock *(shipped)* | 5 | 0.5 | 0.4 | 0.27 | 0 | the reference |
| **metal** *(new)* | 4→10 by tier | **0.95** | 0.1 | **1.2** | 0.06 | fine regular grains, very tough, dents slightly |
| **plastic** *(new)* | 14 | 0.55 | 0.6 | **0.9** | 0.25 | few large grains, visibly warps, tough |
| *sand* | 3 | 0.2 | 0.3 | 0.04 | 0 | crumbles on contact |
| *ceramic armour* | 3 | 0.9 | 0.1 | 2.0 | 0 | many fine grains, each hard — the "super tough" case |
| *aggregate* | 8 | 0.4 | **0.95** | 0.5 | 0 | coarse chunks in a fine matrix |
| *rubber* | 20 | 0.7 | 0.2 | 0.6 | 0.4 | few grains, mostly deforms |

Two of those rows are the request; the rest exist to show the space is
actually spanned.  Derived HP for a 36px tile is roughly
`Σ boundary length × bondStrength`, and Σ length runs ~130px at
grainSize 5, so ceramic armour lands near 260 damage and sand near 5 —
a 50× toughness range from one number.

---

## 3. Bonding, unified

### 3.1 The bond record

```
Bond {
  a, b        the two grains (or bodies) it joins
  strength    pairStrength(materialOf(a), materialOf(b)) × length
  fill        damage absorbed so far          // V15's fractureEdgeFill
  state       forming | bound | broken
}
```

A body is then: a set of grains, plus the bonds between them, plus the
outline derived from the grains that remain (`unionOfCells`).  That is
already true post-V15 for rock and glass — the bonds are just called
`fractureEdges` + `fractureEdgeFill` and can only be broken, never
formed.

### 3.2 Three events, replacing seven mechanisms

| event | what happens | replaces |
|---|---|---|
| **APPROACH** | a body pulls candidates within range | 1 (unchanged, already generic) |
| **FORM** | contact held for `bondFormSeconds` creates a bond; the two bodies become one body of N grains | 2, 3, 5-form, 7 |
| **BEAR** | a bond drags its partner (cohesion) and carries load | 2's cohesion tiers |
| **BREAK** | damage fills a bond past its strength; a grain with no bonds left leaves | V15, 5-break |

What the mechanisms become:

- **Metal's lattice (5)** → `regularity` 0.95 + a very high self bond +
  `densityCouplesGrainSize`.  The hexagon shape it enforces today is
  what a highly-relaxed Voronoi pattern produces anyway.
- **Rock condensation (4)** → density coupling: bonding raises
  `densityTier`, which shrinks grain size and raises strength, which IS
  "denser but smaller and harder".
- **Tile snap (6)** → an outcome of FORM, not a separate pass: when a
  grained body's area passes the tile threshold at rest, it becomes
  static.  This is the `MergeOutcome` seam finally being used.
- **Nebula (7)** → stays out.  Nebula is a cloud with `passThrough` and
  no fracture block; it does not want grains and should keep its own
  transmutation.

### 3.3 The cost, stated honestly

`metalCells` is not only an assembly mechanic — PhysicsSystem carries
**per-cell SAT colliders** for composites (~10 call sites: broadphase
pair selection, the composite-vs-composite path, sub-collider counting).
Unifying metal means either (a) keeping per-grain colliders for grained
bodies generally, which is a real narrowphase change, or (b) accepting
the union outline as the collider, which is what rock and glass already
do and is strictly cheaper.

**Recommendation: (b).**  The union outline is one convex-ish polygon per
body instead of N, matches what V15 already ships, and the fidelity lost
is a concave notch in a composite's silhouette.  If per-grain collision
is later wanted it can be reintroduced for grained bodies generally
rather than for metal specifically — which is the whole point of
unifying.

---

## 4. Per-grain materials (Tier C), and why the foundation is nearly free

Once a bond's strength comes from `pairStrength(A, B)`, a body whose
grains carry different materials needs no new mechanic.  Two design
notes make it affordable:

**The matrix does not need authoring.**  Default
`pairStrength(A, B) = min(A.bondStrength, B.bondStrength) × MIX_PENALTY`
— an interface between unlike materials is weaker than either, which is
both physically right and the interesting gameplay case (a composite
fails at its seams).  A sparse override table handles the exceptions
(metal-to-metal welds stronger than the rule; glass-to-plastic is
already a special pair today via `bondPartners`).  M² authoring is never
required; the matrix is a lookup with a default.

**The real cost is RENDER, not simulation.**  A per-grain material means
per-grain fill colour, which means a body can no longer be one path fill.
Tiles are the game's most numerous entity and currently ride a
pre-rendered static cache plus a hex-sprite fast path — both of which a
multicoloured body leaves (`tileShowsDamage` already does this for
damaged glass).  This is the piece with genuine performance risk and it
is why C should follow A and B rather than ship with them.

Mitigation if C proceeds: cache the composite body's rendered bitmap and
invalidate on grain loss (bodies change rarely; they are drawn every
frame), and cap per-grain materials to bodies above a size threshold so
the numerous small chips stay single-material.

---

## 5. What changes in code

### 5.1 Where the spec lives

`ShardFracturePolicy` (in `engine/systems/ShardSystem.types.ts`) becomes
`GrainSpec` and absorbs the strength/regularity/spread/dent fields.  The
existing `boundaryStrength` is renamed `bondStrength` — same number, and
the rename is the point: it is now also the JOIN strength.
`SHARD_VARIANTS[..].merge` keeps the approach/pull half and hands its
bond half to the spec.

### 5.2 Files, in dependency order

| file | change | size |
|---|---|---|
| `ShardSystem.types.ts` | `GrainSpec`, `Bond`, the pair function's type | small |
| `constants.ts` | the archetype table; metal + plastic rows | small |
| `fractureCache.ts` | per-material relax/separation (currently global); `sizeSpread` placement; `bondSpread` | **medium** |
| `fracture.ts` | two-population site placement for `sizeSpread` | small |
| `GameEngine.progressFracture` | already generic — reads strengths per bond | none expected |
| per-grain dent | new: dent the struck grain, re-derive union, invalidate SAT | **medium** |
| `tileShapes.ts` | draw per-grain outlines when dented (grains no longer tile the parent exactly) | **medium** |
| PhysicsSystem metal composite | delete or retire per-cell colliders (§3.3) | **large, separable** |

### 5.3 The one genuine technical risk

Per-grain denting breaks an invariant V15 relies on: that grains TILE
the parent exactly, which is what makes `unionOfCells` work (an edge
shared by two survivors is interior, everything else is boundary).  Dent
a grain inward and it no longer shares vertices with its neighbour, so
the shared-edge test stops matching and the union walk fails.

Three options, in preference order:

1. **Dent only the OUTER boundary vertices of a grain** — those on the
   body's outline.  Interior vertices stay shared, the union walk keeps
   working unchanged, and the visible result is the same (an inward
   dimple on the silhouette where the shot landed).  Cheapest and safest.
2. Keep the tiling and apply the dent at RENDER only, leaving collision
   on the undented union.  Visually right, physically a lie; acceptable
   for a small dent depth.
3. Replace vertex matching with a spatial-hash union tolerant of small
   displacement.  Most general, most likely to produce subtle geometry
   bugs of the kind the tail case in V15 already demonstrated.

**Recommendation: option 1**, with option 2 as the fallback if the
dimple reads too weakly.

---

## 6. Decisions needed before building

1. **Metal composite retirement** (§3.3) — confirmed as intended; the
   spec assumes the union outline replaces per-cell colliders.
2. ~~**Does a formed bond survive a body becoming static?**~~
   **WITHDRAWN — it does not survive contact with the hex grid.**  A
   tile is a FIXED hex at a grid coordinate (`position === hexCoord` is
   the invariant regen, neighbour counts and transmutation all assume —
   CLAUDE.md §8), while an assembled body is arbitrary-shaped and ~4× a
   tile's area, which is why tile snap already discards ~75% as debris.
   Becoming a tile therefore RE-SHAPES the body to a hex, the assembled
   grains no longer tile that outline, and the hex has to be
   re-decomposed — so what the player would get is a FRESH pattern, not
   the seams they built it from.  The idea was under-thought.

   Three coherent variants, none worth taking now:
   - **inherit statistics, not geometry** — the new hex pattern's grain
     count and bond strengths derive from what was assembled (mixed
     materials → mixed strengths).  Cheap, but it only MEANS anything
     once per-grain materials exist, so it is a Tier C footnote;
   - **drop the hex constraint** for assembled bodies — breaks the
     `position === hexCoord` invariant across three systems;
   - **clip the assembled grains to the hex** — geometrically doable
     with the polygon splitter already in `fracture.ts`, but which 75%
     is discarded is arbitrary.
3. ~~**Do grains inherit damage across a break?**~~  **RESOLVED: THERE
   IS NOTHING TO INHERIT.**  The decision was yes (user call, and right
   in principle) — but implementing it at A2 showed the quantity is
   exactly zero, and structurally so.

   A first measurement said otherwise (0.132 of a departing grain's
   boundary strength carried on average, 30 of 34 detaches) and that
   number is WRONG for this question: it snapshotted the boundary fills
   BEFORE the hit that freed the grain, which measures what was
   unfinished when the hit landed, not what is unfinished when the grain
   leaves.  Measured at the moment of detach, partial is **0 on every
   grain, every time**.

   It has to be.  A grain leaves only once every boundary BINDING it is
   broken; its non-binding boundaries were broken too, because that is
   how the neighbour on the other side left.  So its whole boundary is
   spent as it comes away, and a cleanly-detached grain is undamaged —
   which is also what a grain popping out of a real surface is.

   The code was written and then removed rather than kept with an
   invented number.  The property is pinned by a test, so if the spend
   order or the detach rule ever changes such that partial boundaries do
   survive a detach, this decision reopens loudly instead of silently.
   A separate INTERIOR grain stress (damage to a grain's body rather
   than its boundaries) would deliver the original intent, but it is a
   second damage pool competing with the derived-HP invariant and wants
   its own decision.

4. **`bondSpread` before or with Tier C?**  It delivers most of the
   visual variety of composites at a fraction of the cost.

## 7. Build order

- **A1** GrainSpec types + per-material regularity — **DONE.**
  `ShardFracturePolicy` → `GrainSpec`, the variant field `fracture` →
  `grain`, `sizePerSite` → `grainSize`, `siteCountMin/Max` →
  `grainCountMin/Max`, `boundaryStrength` → `bondStrength` (the rename is
  the point: it is now also the JOIN strength).  `regularity` added and
  wired, with the DBG cycles demoted to overrides.  Verified to generate
  BYTE-FOR-BYTE identical patterns to the previous commit across
  rock/glass/plastic tiles and shards, so the capability landed with zero
  behaviour change; the measured dial runs cell-area CV 0.404 → 0.185 →
  0.093 and roundness 0.650 → 0.779 → 0.790 across regularity 0 → 0.5 → 1.
- **A2** `sizeSpread` placement + `bondSpread` — **DONE.**  `sizeSpread`
  is a POWER DIAGRAM (additive site weights shifting each bisector), not
  the per-site separation a first attempt used: separation was measured
  to do almost nothing (cell-area CV 0.425 → 0.423), because a bigger
  exclusion radius does not give a site a bigger CELL — the neighbours
  it pushes away just pack elsewhere.  Weight gain 0.25 swept against the
  constraint that spread must widen the size distribution WITHOUT
  thinning the grain count: cv 0.228 → 0.383 → 0.552 and coarse/fine
  ratio 2.2 → 4.5 → 8.7 across spread 0 → 0.5 → 1, with the count holding
  at 12 → 12 → 11.3.  `bondSpread` is a pure, exported, unbiased ±60%
  law, exactly 1 at spread 0.  Carried damage was cut — see §6.3.
- **A3** metal + plastic rows, tuned and measured like V15 was
- **B1** per-grain dent, outer-vertices-only (§5.3 option 1) — **DONE.**
  Shipped inert (no material carried `grainDent` until A3) and sequenced
  BEFORE A3 deliberately: opting metal and plastic into the grain model
  without it would have taken their deformation away, since
  `applyDentStep` stands down under progressive fracture.  Option 1 held
  — displacement goes to the SHARED VERTEX SET (welded by position, only
  outline vertices move, identically in every grain that references
  them), so the tiling `unionOfCells` needs is preserved by
  construction.  Verified on rock with a temporary `grainDent`: 25 hits
  dented with nothing detaching, 45.6% of body area lost to denting
  alone, and critically ZERO outline self-intersections and ZERO
  derived-HP drift.  Required caching boundary STRENGTHS at model build
  (`fractureEdgeNeed`): denting moves endpoints, so a strength taken
  from the live length would drift derived HP on every dent.
- **A3** metal + plastic rows — **DONE.**  Measured, then solved:

  | | grains on a 36px tile | regularity | bondStrength | Blaster hits |
  |---|---|---|---|---|
  | glass | 7 | 0.5 | 0.16 | 5 |
  | rock | 8 | 0.5 | 0.27 | 9 |
  | plastic | 4 (large) | 0.55 + sizeSpread 0.6 | 0.62 | 12–13 |
  | metal | 7–15 by tier | 0.95 | 0.85 | 45–95 by tier |

  Metal's DENSITY COUPLING is the piece worth keeping in view: grain size
  and bond strength both track `densityTier`, which is also what drives a
  plate's brightness — so how a plate LOOKS is the readout of how hard it
  will be to break.  Measured t1: 7 grains / 123 hp → t6: 15 grains / 384
  hp, monotonic throughout.  Metal tiles had no `shatter` policy at all
  before A3 (they broke via `dent.breakShards`, which the voronoi gates
  stand down); they now break into their cells like every other grain
  material.  metal-SHARD composites are untouched — that is B2.
- **A3 follow-up** (user report) — **DONE.**  Metal SHARDS joined the
  grain model (they had no `grain` block and died on one hit), both
  shards' grains were made finer so they carry real internal boundary and
  therefore real derived HP (plastic ~27, metal ~17, against a couple of
  damage before), and three defects in per-grain deformation were fixed:
  a deformed grain reported its CUT area and centroid rather than its
  live ones (so a shrivelled grain spawned a full-size fragment — 2.06x
  measured); deformation had no floor (now two thirds of the cut area or
  an absolute minimum, whichever is greater); and a break did not
  CONSERVE (a hit could shed a 157-area shard while the tile GREW by 6.7
  — the invariant is now enforced at the detach seam rather than assumed,
  after chasing two wrong geometric explanations for it).  A fragment now
  breaks off carrying its deformed shape, and plastic — being elastic —
  springs linearly back to the shape its grain was cut at over
  `dentRecoverSeconds`, while metal keeps its dent.
- **B2** retire the metal composite lattice onto the union outline
- **C** per-grain materials + pair function, behind a render cache

A1–A3 are the material system and the two new materials.  B1–B2 are the
deformation ask and the bonding unification.  C stays a separate
decision, taken with A and B measured.
