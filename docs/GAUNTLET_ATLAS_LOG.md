# Gauntlet ATLAS — the code-visualization tool

Implements `docs/CODE_ATLAS_SPEC.md`.

> **GOAL.** A diagram of a codebase that a person can read in 30
> seconds and trust. Major modules as boxes, typed edges as interfaces,
> named flows you can trace. Works on any repo; proven on Omni.

Working rules for this branch — they differ from the 5c/5f gauntlets and
the differences are the point:

- **LEGIBILITY is the metric.** Not coverage, not node count. A phase
  that adds true information and makes the picture harder to read has
  regressed. The rejection test at every milestone is the same one:
  *does the picture answer "what is this system" faster than the
  previous milestone did?*
- **THE GAME IS UNTOUCHED.** This gauntlet adds a sibling tool. Zero
  edits to `engine/`, `components/`, `App.tsx`, `constants.ts`,
  `types.ts`. If the atlas seems to need a game change, it doesn't —
  log it in FOR-USER-REVIEW instead. The one permitted exception is
  `atlas.yaml` at the repo root, which is data about the game, not the
  game.
- **THE GAME'S BUNDLE GAINS NOTHING.** `npm run build` output must be
  byte-comparable before and after every milestone. Checked, not
  assumed — the atlas gets its own Vite entry.
- **CURATION IS DATA, NEVER CODE.** No repo-specific branches in the
  extractor or the renderer. Anything Omni-shaped lives in
  `atlas.yaml`. The moment `if (repo === 'omni')` appears, generality is
  gone and G1 with it.
- **EVERY EDGE CARRIES EVIDENCE.** An edge that cannot name the file
  and line justifying it does not get drawn. This is what separates
  this from a diagram that happens to look right.
- **DRIFT IS A FEATURE, NOT A PHASE.** `atlas check` lands with the
  curation format (A3), not bolted on at the end. A curated diagram
  without drift detection is `POLISH_ARCHITECTURE.md` with better
  typography, and this repo already has one of those.
- Three gates green (`npm run typecheck`, `npm run build`, `npm test`)
  before every milestone commit — the atlas must never redden Omni's
  merge gate. The atlas's own checks are added in A2 and run alongside.

---

## Checklist

- [ ] **A1** — Survey + schema freeze (no renderer). Extract Omni's raw
      graph, count what the substrate rule actually removes, and freeze
      `AtlasNode` / `AtlasEdge`. **Exit test:** the substrate rule is
      justified with real numbers from this repo, or it is replaced.
- [ ] **A2** — Extractor core + TS resolver (`atlas extract`).
      Tier-1 parse via the TS compiler API: module resolution through
      `tsconfig` paths, `import type` split, call-site weights,
      evidence records. LOC + git churn. **Exit test:** Omni's 252
      internal imports are all accounted for, and the value/type split
      matches a hand-count on three sampled files.
- [ ] **A3** — Curation format + `atlas check`. `atlas.yaml` schema,
      loader, and all five drift checks from spec §5. **Exit test:** a
      deliberately wrong `atlas.yaml` produces exactly the right five
      failures, and a correct one exits zero.
- [ ] **A4** — Viewer shell + Architecture view. Layered layout, groups
      as bands, typed edge styling, substrate band, legend, pan/zoom,
      node inspector. **Exit test:** Omni's diagram is readable on a
      390px-wide screen. (This repo's UI already holds itself to that;
      the atlas doesn't get an exemption.)
- [ ] **A5** — Flows. Curated flow objects, the flow panel, step-through
      tracing, canvas dimming. **Exit test:** the per-frame flow traces
      correctly against `CLAUDE.md` §3 read side by side.
- [ ] **A6** — **Omni's `atlas.yaml`** — the dogfood, and the phase that
      decides whether any of this worked. Claude drafts curation for the
      whole repo; drift must come back clean. **Exit test:** a reader
      who has never seen Omni can name the four subsystems and say what
      a frame does, from the diagram alone.
- [ ] **A7** — Hotspots + Raw graph views. Treemap, cycle detection,
      layering violations, orphans.
- [ ] **A8** — Multi-repo. `atlas serve <path>` for local trees;
      committed-artifact loading over `raw.githubusercontent.com`; the
      repo switcher; the parse-tier badge. **Exit test:** a second repo
      renders — including a Tier-3 (regex) one, to prove degradation is
      graceful and honestly labelled.
- [ ] **A9** — Deep links + Claude handoff (R1 + R2 from spec §6).
      `vscode://` and GitHub blob links from every node and every
      evidence line; **Copy task brief** per node.
- [ ] **A10** — Python resolver (Tier 2). Lifts four of the other repos
      out of regex fallback. Deliberately after A8, so generality is
      proven by a *second language* rather than assumed.
- [ ] **A-final** — Validation, README, spec reconciliation, and the
      `CLAUDE.md` §2 entry for `atlas/`.

Ordering rationale: **A6 is the pivot.** A1–A5 are the machine; A6 is
the first time the machine is pointed at a real system and asked to
produce something worth looking at. If the Omni diagram isn't good, the
fix is in A1–A5 and it happens before A7+ builds more on top. Everything
after A6 is breadth — more views, more repos, more languages — and none
of it is worth doing on a foundation that failed its own exit test.

---

## Running score

| milestone | atlas LOC | Omni LOC touched | game bundle Δ | drift |
|---|---|---|---|---|
| baseline | 0 | 0 | — | — |

*(filled in as phases land)*

---

## Baseline facts (measured, pre-implementation)

Established at spec time — the numbers A1 must confirm or correct.

| fact | value |
|---|---|
| TS/TSX lines, repo total | 44,528 |
| internal import statements | 252 |
| largest file | `constants.ts` — 5,462 |
| largest engine file | `engine/GameEngine.ts` — 4,859 |
| most-imported module | `types.ts` — 26 importers |
| candidate substrate nodes | `types.ts`, `constants.ts`, `engine/toroidal.ts`, `engine/systems/IdAllocator.ts` |

The substrate hypothesis in numbers: those four modules account for a
large share of all internal imports while importing almost nothing
themselves. A1 measures the exact figure. **If suppressing them removes
less than ~25% of edges, the substrate rule is not carrying its weight
and the layout strategy needs rethinking before A4 draws anything.**

---

## FOR-USER-REVIEW

Anything that would require a game change, a scope increase, or a
decision from §8 of the spec gets logged here rather than actioned.

- **D1** — `atlas/` in this repo vs. standalone. Proceeding with
  `atlas/`; reversible through A-final.
- **D5** — whether `atlas check` becomes a blocking CI gate for Omni.
  Not proposed until it has run non-blocking for a while without noise.
