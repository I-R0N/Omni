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
npm run dev        # dev server on port 3000
npm run build      # production build to dist/
```

Optional single-file build (inlines all assets into one HTML file):

```
npm run build && node scripts/inline-build.mjs
```

## Documentation

- `CLAUDE.md` — engine architecture ground truth. Start here.
- `docs/GAME_FEEDBACK_PLAN.md` — the maintained plan of record:
  roadmap, decisions log, and process conventions for contributors.
- `docs/PARKING_LOT.md` — deferred ideas. A scrapbook, not a
  commitment; some entries are stale by design.

There is no test runner or linter; `npm run build` is the validation
gate. Headless Playwright smokes drive the real engine via the
`window.__omniEngine` debug handle when a change warrants it.

## Deploying

`netlify.toml` is configured (build `npm run build`, publish `dist/`);
pushes to `main` deploy.

## License

All rights reserved — the source is public for reference and
collaboration, not for reuse. See `LICENSE`.
