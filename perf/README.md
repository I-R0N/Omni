# perf/ — the gauntlet-5c capture harness

Headless performance capture for the Omni engine. Not part of `npm test`
(see DECISIONS D1 in `docs/GAUNTLET_5C_LOG.md`): these runs take minutes and
are deliberately noise-prone, while `npm test` is a merge gate.

## impact-audit.mjs — not a performance capture

The odd one out in this directory, and it is here because it shares the
harness rather than the subject: `impact-audit.mjs` measures BALANCE, not
frame time.  It reads what a shipped weapon's authored `damage` is worth in
ENERGY and MOMENTUM against each material's DERIVED HP, and what the crash
gates correspond to in the same units — step 1 of the unified-impact-physics
sequencing in `docs/PARKING_LOT.md`.

    npx vite preview --port 4183 --strictPort &
    node perf/impact-audit.mjs [--samples 60]

Everything is read out of the REAL engine: derived HP through
`applyBoundaryDamage`'s own model build (driven at zero damage via
`GameEngine.chipStructureAt`), weapon numbers off a LIVE spawned projectile,
the collision velocity step from `PhysicsSystem.impactStrength` itself, and
the ram counts through the real player-crash branch of `resolveCollision`.
Nothing in it re-derives the arithmetic — that is the whole point, since the
question it answers is what the game DOES, not what the tables say.

Its results are recorded in `docs/PARKING_LOT.md` §7 of the unified-impact
entry.  Re-run it rather than quoting those numbers after any grain, weapon
or crash-gate change; a run is a few seconds and the derived-HP figures are
pattern-dependent (tiles vary ±2..11% body to body, shards ±17..38%).

## Lighting columns and scenes

The frame table carries `lit p99 / lit max / fog p99` — the shadow-casting
light layer and the fog compositor, both SLICES of the render column, not
terms beside it.  Three scenes A/B the layer on GLASS_FIELD (its worst case —
every tile is occluder + transmission + caustic + emitter at once):

    node perf/capture.mjs --scene light-legacy    # layer off; lit/fog must read 0
    node perf/capture.mjs --scene light-shipped   # the shipped defaults, stated explicitly
    node perf/capture.mjs --scene light-max       # every lighting feature on at once

As everywhere in this harness: the LEVELS are indicative (software raster),
the DELTAS between the three are the evidence.  The in-game counterpart is
the DBG Perf REC report's `light … · fog …` line, which is the tool for
on-device numbers.

## Usage

    npx vite build                    # the harness serves dist/
    node perf/capture.mjs             # whole matrix minus the 5-min soak
    node perf/capture.mjs --scene asteroid-6k --repeat 3
    node perf/capture.mjs --all --out perf/out/x.json
    node perf/capture.mjs --ablate react --scene hub-idle

A `vite preview` on port 4183 is started if one isn't already up, and reused
if it is.

## What the numbers mean

Read the header comment of `capture.mjs`, then the "The instrument" section
of `docs/GAUNTLET_5C_LOG.md`. Short version:

- **LEVELS are indicative** — this container rasterizes canvas in software,
  so absolute frame time is not the device's frame time. No "is it 60 fps?"
  verdict comes from here.
- **DELTAS are evidence** — same harness, same host, same session, seeded
  scenes, median of 3.
- **ALLOCATION is exact** — and it is the metric the "zero allocation in hot
  paths" goal is judged on.

Always quote `sim/stp99` (per SUBSTEP) rather than `sim p99` (per frame) when
comparing against the 16.7 ms budget: the sim runs at a fixed 120 Hz, so a
device holding 60 fps drains 2 substeps per frame and the budget-relevant
figure is `2 x sim/stp99`.

## Attribution runs

For allocation attribution, build unminified first so function names and line
numbers are real, then use `--deep`:

    npx vite build --minify false
    node perf/capture.mjs --deep --scene asteroid-6k
    npx vite build                    # restore before timing runs

`perf/probe.mjs` runs targeted in-page micro-probes against the real live
entity objects, for questions the matrix can't answer (e.g. "does writing
this field allocate?").
