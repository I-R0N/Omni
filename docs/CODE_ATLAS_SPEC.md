# Code Atlas — spec

A repo-agnostic tool that renders a codebase as a diagram you can read:
major modules as boxes, typed edges as interfaces, named flows you can
trace. Built to work on **any** repo, dogfooded on **Omni** first.

Status: **SPEC — nothing implemented.** Implementation is gauntlet
`docs/GAUNTLET_ATLAS_LOG.md`.

---

## 0. The observation this is built on

The reference images that prompted this are **editorial, not automatic**.

Nobody's dependency-graph generator produced `EDGE / CORE SERVICES /
ASYNC & EVENTS / STATE & DATA` swimlanes with a hand-labelled `paint`
edge into an image provider. A person (or a model) read the system,
decided that ~12 boxes were the ones that mattered, named the groups,
wrote the prose, and **threw the rest away**. The second image is the
same: 20-odd labelled structures, a written explanation beside them, a
legend for what is measurement and what is game.

**The discarding is the product.** Omni is 44,528 lines across ~60
TypeScript modules with 252 internal import statements. Auto-layout of
that graph is a hairball — technically accurate, and nobody looks at it
twice. `types.ts` alone has 26 importers; `constants.ts`, `toroidal.ts`
and `IdAllocator.ts` are close behind. Draw every true edge and the
picture says only "everything touches everything", which is false as
architecture and useless as navigation.

So the tool is **not** a graph generator with nice styling. It is three
separable layers, and the middle one is where the value is:

```
  EXTRACT   automatic, any repo, no judgement    →  atlas.raw.json
     ↓
  CURATE    Claude writes once, human edits      →  atlas.yaml   (committed)
     ↓
  RENDER    static web app, reads both           →  the diagram
```

Extraction is a solved problem worth ~500 lines. Rendering is a
weekend. Curation is the thing that makes it good, and it is exactly
the thing an LLM is good at and a static analyser is not.

### The corollary: curation rots, so drift detection is load-bearing

This repo already knows what happens to hand-written architecture docs.
`CLAUDE.md` opens with a banner warning that `POLISH_ARCHITECTURE.md`
and `PARKING_LOT.md` describe systems that were never shipped or
shipped differently. A curated `atlas.yaml` is the same species of
artifact and will rot the same way.

The difference: **the atlas is checkable against the code, and the
extractor is what checks it.** Every curated node names real files;
every curated edge asserts a real dependency. When they stop matching,
the viewer says so and the CI job fails. This is a first-class feature,
not a later nicety — it is the only reason to trust the picture. See §5.

---

## 1. Goals / non-goals

**Goals**

| # | Goal |
|---|---|
| G1 | Read any repo I own and show major modules + the interfaces between them |
| G2 | Legible at a glance — the picture answers "what is this system" in 30 seconds |
| G3 | Trace a named flow (a request path, a frame, a pipeline) across the diagram |
| G4 | Stay honest — drift from the real code is detected, not silently rendered |
| G5 | Jump from a box to the actual code, in my actual editor |
| G6 | Degrade gracefully on languages the extractor doesn't deeply understand |

**Non-goals** (explicit, so scope stays closed)

- **Not a code editor.** VS Code exists. See §6.
- **Not a UML / class-diagram tool.** Modules and above, never methods.
- **Not a live-runtime tracer.** No instrumentation, no profiler.
- **Not a hosted service.** Static app + committed data files.
- **Not a metrics dashboard.** Hotspots is one view, not the point.

---

## 2. Views

Three views over one graph. Each answers a different question, and each
earns its place by answering it better than the others do.

### 2a. Architecture — *"what is this system?"* (primary)

The reference-image view. Curated boxes, grouped into named bands,
typed edges between them, one legend. This is the default and the one
that gets the design investment.

Layout is **layered, not force-directed.** Force-directed graphs are the
default reach and they are wrong here: no stable layout between runs, no
semantic meaning to position, and the result is a hairball with physics.
Layered assignment (groups are bands, edges flow one way where possible)
gives position *meaning* — up is toward the entry point, down is toward
storage and substrate — and it is stable across re-extractions, so the
diagram you learned yesterday is the diagram you see today.

**The substrate rule.** This is the single transformation that turns
Omni's graph from a hairball into a diagram. A node that is imported by
many and imports almost nothing is not architecture — it is substrate.
Detected automatically (`in-degree ≥ SUBSTRATE_IN`, `out-degree ≤
SUBSTRATE_OUT`, both tunable, both overridable in curation), drawn once
in a band at the bottom, and **its edges are suppressed by default**
with a count badge instead (`types.ts · 26 ←`). Hovering a substrate
node lights up its real edges; nothing is hidden, it is just not drawn
at rest. For Omni this removes ~80 of 252 edges and costs no
information.

### 2b. Flows — *"how does X actually happen?"*

A **flow** is a named, ordered walk through the graph:
`{ id, title, description, steps: [{ from, to, label, note }] }`.
Selecting one dims the canvas and lights its path; stepping advances one
edge at a time with the note in the side panel.

This generalises better than it first looks. In the reference image a
flow is a request path ("Generate a look", 8 steps). In Omni it is the
**per-frame pipeline** — `prepareFrameEntities → PerfController.beginStep
→ updatePhysics(FlowField → AI → enemy shooting → PhysicsSystem) →
updateGameLogic(...) → render`. That ordering *is* Omni's architecture,
it is written in prose in `CLAUDE.md` §3, and **no static analyser will
ever find it**, because it is a sequence of calls inside one method, not
a dependency. Flows are how curated knowledge that isn't in the import
graph gets drawn.

Omni ships with at least: **the frame**, **a death** (`PhysicsSystem`
on-death → `handleEntityDeath` → shatter / drops / explosions /
score attribution), **a portal transit**, and **a purchase**
(station → `purchaseModule` → inventory → `moveModule` → adjacency
fixpoint → `applyModuleEffects` → player stats).

### 2c. Hotspots — *"where is the risk?"*

Treemap. Area = LOC, colour = commit churn from `git log`. Cheap to
build on top of extraction data, and it answers a question the
architecture view cannot: which of these boxes is actually moving. A box
that is large *and* hot is where the bodies are.

### 2d. Raw graph — *"is the pretty picture lying?"*

Uncurated, every node, every edge, no substrate suppression. Ugly on
purpose. Carries the analyses that only make sense on the true graph:
**import cycles**, **layering violations** (an edge pointing the wrong
way through the curated bands), and **orphans** (files in no curated
node). This is the honesty view — you go here when you suspect the
architecture view is flattering you.

### Parked: the isometric skin

The second reference image is a beautiful *skin* over the same data —
extruded blocks, height as a metric, a single-colour palette. It is
worth doing and it is worth doing **after** the graph is right. Parking
it is not a rejection; drawing it before the data model settles would
just mean drawing it twice.

---

## 3. The graph model

One shape, produced by extraction, refined by curation, consumed by the
renderer.

### Nodes

```ts
type AtlasNode = {
  id: string                  // stable: curated slug, or repo-relative path
  label: string               // display name
  kind: 'module' | 'group' | 'external' | 'substrate'
  files: string[]             // repo-relative; a node is 1..n files
  group?: string              // parent group id
  loc?: number
  churn?: number              // commits touching these files, windowed
  summary?: string            // curated prose — the panel text
  detail?: string             // curated prose — "how it's built"
  role?: string               // curated free tag: 'entry' | 'store' | ...
  drift?: DriftReport         // see §5
}
```

A node maps to **one or more files**, and that is deliberate. Omni's
`engine/systems/render/` is eight files that are one concept; the
architecture view should draw one box called "Render sub-domains" and
let you expand it. Conversely `GameEngine.ts` at 4,859 lines is one file
that is several concepts, and curation can split it into several nodes
backed by line ranges. **Neither the file tree nor the module graph is
the right granularity — curation is.**

### Edges

"Lines representing interfaces" is the ask, and interface is richer than
import. Six kinds, each drawn differently:

| kind | meaning | source | drawn |
|---|---|---|---|
| `imports` | static module dependency | extraction | thin solid |
| `calls` | A calls B's exported function; `weight` = call sites | extraction | solid, weighted |
| `types` | A uses only B's *types* — erased at runtime | extraction | thin dashed, dimmed |
| `state` | A and B read/write shared mutable state | extraction (heuristic) + curation | dotted |
| `event` | A dispatches, B handles | curation | dashed + arrowhead |
| `sequence` | ordered runtime step (flows only) | curation | animated on trace |

The `types`-only distinction matters more than it sounds. A large share
of Omni's edges are `import type { GameEntity } from '../../types'` —
a **compile-time** relationship that vanishes in the bundle. Drawing it
identically to a real call edge is what makes naive graphs read as
spaghetti. Separating the two is most of the cleanup, and it is exactly
the thing regex-based tools get wrong and a real TS parse gets right.

```ts
type AtlasEdge = {
  from: string; to: string
  kind: 'imports' | 'calls' | 'types' | 'state' | 'event' | 'sequence'
  weight?: number
  label?: string              // curated: 'REST', 'enqueue', 'dispatch'
  evidence?: { file: string; line: number }[]   // click-through to source
}
```

`evidence` is what makes an edge honest: clicking a line lists the exact
call sites that justify it. An edge you cannot justify is an edge that
gets deleted.

---

## 4. Extraction

A CLI: `atlas extract <repo-path> -o atlas.raw.json`. No config needed
to get a first result; config only to get a better one.

**Per-language resolvers behind a common core.** The core walks the file
tree, applies ignore rules, and asks a resolver for each file's imports,
exports, and call sites. Resolvers ship in tiers:

- **Tier 1 — TypeScript / JavaScript.** The TS compiler API (via
  `ts-morph` or direct). Real module resolution through `tsconfig`
  paths, real `import type` detection, real call-site counting.
  This is Omni and it is the tier that must be excellent.
- **Tier 2 — Python.** Stdlib `ast` via a small helper script. No third-party
  dependency. Covers `MLB-Predictions`, `MLB-Model`, `cbb_predictor`,
  `AutoYNAB`.
- **Tier 3 — everything else.** Regex import scanner. Gets module-level
  boxes and `imports` edges; no call weights, no type/value split.
  Covers the C++ fork and anything future.

Degradation is graceful and **labelled**: the viewer states which tier
produced the graph, so a thin picture is understood as a thin *parse*
rather than a simple system.

**Also extracted:** LOC per file, git churn (`git log --numstat`,
windowed), and the language/tier used. All cheap, all from data already
being walked.

---

## 5. Curation and drift

`atlas.yaml`, committed at the repo root. Hand-editable, and generated
in a first pass by Claude reading the repo.

```yaml
version: 1
groups:
  - { id: shell,   label: "React shell",  order: 0 }
  - { id: engine,  label: "Engine core",  order: 1 }
  - { id: systems, label: "Systems",      order: 2 }
  - { id: render,  label: "Render",       order: 3 }
  - { id: data,    label: "Types & config", order: 4, substrate: true }

nodes:
  - id: engine-core
    label: GameEngine
    group: engine
    files: [engine/GameEngine.ts]
    summary: >
      Owns the frame. After the 5f decomposition what is left here is the
      loop itself, run and map lifecycle, stations, portals, weapons and score.
    role: orchestrator

  - id: roamers
    label: Roamers
    group: engine
    files: [engine/roamers/*.ts]
    summary: >
      Engine-managed entities with bespoke lifecycles the AISystem does
      not drive — dragons, rivals, the snitch, bubbles.

edges:
  - { from: engine-core, to: roamers, kind: calls, label: "ticks each frame" }

flows:
  - id: frame
    title: One simulated frame
    steps:
      - { from: engine-core, to: entity-index, label: prepareFrameEntities }
      - { from: engine-core, to: perf,         label: beginStep }
      # ...
```

### Drift

On every extract, each curated assertion is checked:

| check | failure |
|---|---|
| every `files` glob matches ≥1 real file | `missing-files` |
| every file in the repo lands in ≤1 node | `orphan` / `double-claimed` |
| every curated edge is backed by ≥1 real dependency | `phantom-edge` |
| every real edge crossing groups is curated or substrate-suppressed | `undrawn-edge` |
| every flow step corresponds to a real edge | `broken-flow` |

Findings render as badges on the diagram (a phantom edge draws in
warning colour, not silently). `atlas check` exits non-zero on drift, so
it can be a CI job — the same posture as this repo's existing merge
gate, applied to the picture instead of the tests.

**`undrawn-edge` is the interesting one**: it catches the case where
someone adds a real dependency that the architecture says shouldn't
exist. That is a layering violation reported as a documentation failure,
which is the most useful thing this tool can do beyond looking good.

---

## 6. GitHub, multi-repo, and editing

### Loading a repo

Three paths, in ascending cost:

1. **Local** — `atlas serve .` reads the working tree. Fastest loop,
   full fidelity, what you use while working. Day one.
2. **Committed artifact** — `atlas.yaml` + `atlas.raw.json` are in the
   repo; the static viewer fetches them from
   `raw.githubusercontent.com`. Public repos need no auth. This is what
   makes "any repo I own" cheap: a repo becomes viewable by committing
   two files, and a GitHub Action can regenerate them on push.
3. **Live API extraction** — the viewer pulls source through the GitHub
   API and extracts in-browser. Tempting, and **not recommended**: rate
   limits, no `tsconfig` resolution, and a token in the browser. Path 2
   gets the same result with a build step.

**Private repos** need a token. For personal use a PAT in `localStorage`
is adequate and should be *stated* as the tradeoff it is (a token in
browser storage is readable by anything running on that origin); a
small serverless proxy is the correct fix if this ever leaves your
machine.

> **Session note.** This session is scoped to `i-r0n/omni` — the other
> 15 repos returned `Access denied` when probed. Multi-repo work needs
> either those repos added to a session, or path 2 (committed artifacts,
> read as public URLs). This is a real constraint on the "every repo"
> goal and path 2 is the answer to it.

### Editing — the honest version

**Do not build an editor.** The browser cannot write your disk, VS Code
already exists, and the value of this tool is comprehension. Three rungs
instead, and the first two cover ~all of the actual need:

- **R1 · Deep links** *(day one, ~20 lines)*. Every node and every
  edge-evidence line links to `vscode://file/<abs>:<line>` and to the
  GitHub blob URL. Click a box, your real editor opens at the real file.
  This is most of what "edit from the interface" actually means.
- **R2 · Claude handoff** *(~40 lines)*. A **Copy task brief** button on
  each node: emits the curated summary, the file list, the in/out edges
  and the drift state as a prompt you paste into Claude Code. The
  diagram becomes the place you *decide* what to change; Claude Code
  remains the place it gets changed. Given how this repo is already
  developed, this is the natural fit.
- **R3 · Local write-back** *(only if R1/R2 prove insufficient)*. The
  `atlas serve` process already has the working tree; it could accept
  edits to `atlas.yaml` from the UI — curation edited where you can see
  it, which is genuinely nice. Editing *source* through it is where I'd
  stop: that is a worse VS Code.

---

## 7. Where it lives

Proposal: **`atlas/` inside this repo**, self-contained, zero imports
from game code, targeting any repo via a path argument. It rides the
existing branch and toolchain, and it lifts cleanly into its own repo
later (nothing about it is Omni-specific except the `atlas.yaml` at the
root).

Two constraints that bite at merge time if not planned for:

- **`npm run build` must keep building the game, unchanged.** The atlas
  needs its own Vite entry/config; the game bundle must not gain a byte.
- **`npm run typecheck` covers the repo**, so atlas code either
  typechecks clean under the existing `tsconfig` or gets its own project
  reference. Clean is preferred — a second tsconfig that nothing runs is
  how type errors accumulate unseen (this repo has been bitten by
  exactly that, per `CLAUDE.md` §7).

The alternative — a standalone repo from the start — is cleaner in
principle and costs a new repo, a new toolchain, and losing the
designated branch. Recommend `atlas/` now, extract later if it earns it.

---

## 8. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| D1 | `atlas/` in Omni, or standalone repo? | `atlas/` now; extract later |
| D2 | Node granularity: file, folder, or curated? | Curated, defaulting to folder |
| D3 | Ship the isometric skin? | Park until the graph is right |
| D4 | Private-repo auth: PAT in browser, or proxy? | PAT for personal use, stated as a tradeoff |
| D5 | Is `atlas check` a blocking CI gate for Omni? | Non-blocking first; promote once it has proven it isn't noisy |
| D6 | Curation authored by Claude, or by hand? | Claude drafts, human edits — the draft is the expensive part |
