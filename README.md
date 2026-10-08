# Omni

A 2D top-down space arena game on a bespoke TypeScript engine: a
toroidal world of destructible materials — glass, rock, metal, plastic,
nebula — simulated as physical tiles and shards, with a salvage-driven
outfitting economy layered on top.

Launch from the Overworld hub, dock at stations to outfit a hex-grid
ship, take portals into wave arenas, fight escalating waves and boss
capstones, and haul the salvage home.

## Tech

Bespoke fixed-timestep engine · Canvas2D renderer · React HUD shell ·
Vite · TypeScript. Single-page app, no backend.

## Quickstart

Prerequisite: Node.js.

```
npm install
npm run dev         # dev server on port 3000
npm run build       # production build to dist/
npm run typecheck   # tsc --noEmit
npm test            # SMOKE scope: the boot + loop suites, ~1 min
                    # (builds + previews first)
npm run test:full   # every Playwright suite (~20 min) — for merge time
npm run test:audio  # the audio suite on its own
```

Before the first `npm test`, install the browser once:

```
npx playwright install chromium
```

Optional single-file build (inlines all assets into one HTML file):

```
npm run build && node scripts/inline-build.mjs
```

## Documentation

- `CLAUDE.md` — what is implemented; engine architecture ground truth.
  Start here.
- `docs/CONFIG_CHANGES_PHASED_PLAN.md` — the forward plan (Phase A done,
  Phases B–G queued). `docs/PORTAL_AND_WORLD_LAYER_PLAN.md` owns portals
  and world layering; `docs/GAME_STRUCTURE_STRATEGY.md` is the long-term
  vision.
- `docs/GAME_FEEDBACK_PLAN.md` — the CLOSED plan of record for the first
  overhaul (roadmap and decisions log). History; no longer maintained.
- `docs/PARKING_LOT.md` — deferred ideas. A scrapbook, not a
  commitment; some entries are stale by design.
- `docs/SFX_INVENTORY.md` — every sound id and its spec, the source of
  truth for sound. `docs/CINEMATIC_AUDIO.md` describes the shipped
  sample-bank audio and mix; `docs/AUDIO_AUTHORING.md` covers the adaptive
  score and adding sound; `scripts/score/` generates the music.
- `tests/README.md` — the Playwright suites: how to run them, what each
  covers, and the harness rules that keep them from flaking.

[![PR checks](https://github.com/I-R0N/Omni/actions/workflows/pr-checks.yml/badge.svg)](https://github.com/I-R0N/Omni/actions/workflows/pr-checks.yml)

Validation is three commands — `npm run build`, `npm run typecheck`,
`npm test` — and all three are expected green before a commit, together
with the suites your change touches
(`npx playwright test tests/<suite>.spec.ts`); `npm run test:full` is the
whole net, for merge time. The Playwright suites drive the real engine in
a real browser through the `window.__omniEngine` debug handle; nothing is
stubbed.

CI (`.github/workflows/pr-checks.yml`) runs typecheck, build and then the
tests on every pull request, on pushes to `main` (the workflow still also
lists the merged `claude/plan-completion` branch) and on manual runs, and
it is the gate before a merge. It picks one of two scopes: the SMOKE
scope (boot + loop) on every pull-request push, whatever its base, and
the FULL suite for pushes, manual runs and PRs labelled `full-tests` — so
a regression outside the smoke surfaces when the merge lands, unless the
PR asks for the whole net first. There is still no linter.

## Deploying

Every push to `main` builds the single-file standalone and publishes it
to the `i-r0n/omni-standalone` mirror
(`.github/workflows/publish-standalone.yml`). Pull requests from this
repository get the same build as a preview: `pr-preview.yml` publishes it
to that mirror under `previews/pr-<N>/`, links it (via a SHA-pinned rawcdn.githack URL) in a
PR comment, and removes it when the PR closes. Fork PRs get no preview,
since publishing needs a secret. Netlify deploys are separate and come
from `netlify.toml` (build `npm run build`, publish `dist/`). To make the
single file yourself, run `node scripts/inline-build.mjs` after a build; it
writes `omniverse-standalone.html` at the repo root, which is gitignored.

## License

All rights reserved — the source is public for reference and
collaboration, not for reuse. See `LICENSE`.

Third-party music (CC BY) and sound effects (CC0) in
`public/assets/audio/` are used under their own licenses; see
`public/assets/audio/AUDIO_CREDITS.md`.
