# perf/ — the gauntlet-5c capture harness

Headless performance capture for the Omni engine. Not part of `npm test`
(see DECISIONS D1 in `docs/GAUNTLET_5C_LOG.md`): these runs take minutes and
are deliberately noise-prone, while `npm test` is a merge gate.

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
