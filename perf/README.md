# perf/ — the measurement harness

Headless measurement for the Omni engine, driven through the `window.__omni*`
debug handles (CLAUDE.md §8) against a BUILT app.  Not part of `npm test` and
not run in CI (see DECISIONS D1 in `docs/GAUNTLET_5C_LOG.md`): these runs take
minutes and are deliberately noise-prone, while `npm test` is a merge gate.
The flip side is that nothing type-checks or runs these scripts, so an engine
rename breaks one SILENTLY — a renamed field turns an ablation into a no-op,
a moved method turns a run into a TypeError.  Rename something a script
reaches, and fix the script too.

Every script drives `dist/` on port 4183.  `capture.mjs` and `uiprobe.mjs`
start a `vite preview` there if nothing is listening (and reuse one that is);
the rest exit with a hint unless one is already up:

    npx vite build
    npx vite preview --port 4183 --strictPort &

| script | answers |
|---|---|
| `capture.mjs` + `scenes.mjs` | the scene MATRIX: per-frame sim / render / lighting / fog, worst frame and p99, allocation (exact) and who allocates it; `--ablate` experiments |
| `simbench.mjs` | the cost of one sim SUBSTEP, low-noise (N substeps back to back, nothing rendered) |
| `spike.mjs` | HITCHES while flying: the frame series, outlier spacing, sim vs render vs residual |
| `burst.mjs` | one-frame work bursts: an enemy death, the steps and draw after it, a wave clear, 20 deaths in a frame |
| `probe.mjs` | targeted micro-probes on the live entity objects (allocation per op; the shape-normalisation test CLAUDE.md §4 cites) |
| `uiprobe.mjs` | React reconciliation cost — needs `OMNI_PROFILE_REACT=1 npx vite build`; `--mode attribute` (default) / `ablate` (`validate` needs its ballast re-mounted — see the header) |
| `starfield.mjs` | the star field: structure, density per area, draw calls, blit audit; `--browser webkit`, `--bench`, `--shot` |
| `impact-audit.mjs` | BALANCE, not frame time — below |

Numbers from a real device come from the in-game Perf REC recorder — see the
last section.

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

§7 is the MASS SCALE and answers a different question from the rest: not
what an impact is worth, but whether the four ladders that decide it are on
one scale at all.  It prints every class — player, enemy roster, gun roster,
shard spawn ladders — as size, mass and mass/size², the implied areal
density.  Density rather than mass is the honest comparison: a ship and a
boulder differ in size by design, and only density says whether one of them
is made of a fundamentally different substance.  It found exactly that —
the player at 0.2500 against a 0.0100..0.0300 material band, measured before
`MASS_SCALE`.  `IMPACT_DENSITY` now states the same ratios ten times over
(hull 2.50, materials 0.10..0.30), which is what a run prints today.  Unlike
the sections above it reads the TABLES, through the `window.__omniMass` seam,
because a table read cannot drift from what the sim reads the way a
recomputed number can; the one mass with a DBG ladder, the hull, is read live
off `e.player.mass`.

§8 is PENETRATION and the BLAST, fired through the real resolver because
neither is authored any more.  It counts how many 1-HP gnats each gun's live
round punches, at base and at three Gunnery Mk III — that count IS the bank,
since a body is charged only what it could absorb — and what a Cannon shell's
derived blast costs a bystander 55 units away, on an ACTOR contact and on
ENERGY DEPLETION against terrain.

Its results are recorded in the unified-impact entry of `docs/PARKING_LOT.md`:
§7 is the step-1 baseline, and §8, "What shipped (steps 2–5 and their
follow-ups)", summarises the re-runs since — banks, ram counts, the mass
scale, penetration, the blast, the bank trim.  The detailed per-step
measurements are in git history (that doc at ca0ad8e).  Re-run it rather than
quoting those numbers after any grain, weapon or crash-gate change; a run is
a few seconds and the derived-HP figures are pattern-dependent (tiles vary
±2..11% body to body, shards ±17..38%), so ram counts move a step or two run
to run without anything having changed.

## Lighting columns and scenes

The frame table carries `lit p99 / lit max / fog p99` — the shadow-casting
light layer and the fog compositor, both SLICES of the render column, not
terms beside it.  Three scenes A/B the layer on GLASS_FIELD (its worst case —
every tile is occluder + transmission + caustic + emitter at once):

    node perf/capture.mjs --scene light-legacy    # layer off; lit/fog must read 0
    node perf/capture.mjs --scene light-shipped   # the A8-era shipped config (beam at tier low)
    node perf/capture.mjs --scene light-max       # every lighting feature on at once

`light-shipped` is kept FIXED as a reference rather than tracking the
defaults: the flashlight ships OFF today, and the Light tool runs its beam at
tier medium or high.

As everywhere in this harness: the LEVELS are indicative (software raster),
the DELTAS between the three are the evidence.  The in-game counterpart is
the DBG Perf REC report's `light … · fog …` line, which is the tool for
on-device numbers.

## spike.mjs — hitches, not steady state

    npx vite build
    npx vite preview --port 4183 --strictPort &
    node perf/spike.mjs --map OVERWORLD --sec 25 [--pre '<js against window.__omniEngine>']

`capture.mjs` answers "how heavy is the steady state".  A user-visible HITCH
is a different question: a few frames per second many times the median, with
everything between them fine.  A p99 can look healthy while every second
contains a stall, so this reports the SERIES — which frames are outliers, how
far apart they are (a stable gap is a cadence, a scattered one is not), and
what dominates them.

ATTRIBUTION is the point.  The RESIDUAL (frame - sim - render) is time the
engine did not spend in its own code: GC, rasterisation, layout.  A residual
spike is not fixed by making the sim faster, and a sim spike is not fixed by
allocating less.

The player MOVES throughout, which `hub-idle` never does — a parked camera
re-culls nothing, re-stamps no static tiles and scrolls no stars.  `--pre`
runs one expression against the live engine before the window opens, which is
how a suspected cost gets ablated without building the ablation into the app.

Levels are indicative (software raster) as everywhere here; the DELTA between
two builds is the evidence, and `heapKB/f` is exact.

## capture.mjs — the scene matrix

    npx vite build                    # the harness serves dist/
    node perf/capture.mjs             # whole matrix minus the 5-min soak
    node perf/capture.mjs --scene asteroid-6k --repeat 3
    node perf/capture.mjs --all --out perf/out/x.json
    node perf/capture.mjs --ablate react --scene hub-idle

Scenes (`--scene <id>`; `soak` only with `--all` or by name): hub-idle,
asteroid-6k, tile-shatter-storm, hub-move, nebula-storm, boss-capstone,
roamer-stack, mass-death, stage-descent, light-legacy, light-shipped,
light-max, soak — each carries its own `notes` in `scenes.mjs`.  Ablations
(`--ablate <id>`; each removes ONE suspected cost from the running page, so
the delta IS that cost, and each is commented in the script): react,
simrate60, flowoff, lanejitter0, nebtilepass, nebshatterlegacy, nebbondoff,
statspayload.  Also `--repeat N` (the median run by sim p99), `--out <json>`,
`--label`, and `--deep` / `--depth` / `--interval` for allocation
attribution (below).

## What the numbers mean

Read the header comment of `capture.mjs`, then the "The instrument" section
of `docs/GAUNTLET_5C_LOG.md`. Short version:

- **LEVELS are indicative** — this container rasterizes canvas in software,
  so absolute frame time is not the device's frame time. No "is it 60 fps?"
  verdict comes from here.
- **DELTAS are evidence** — same harness, same host, same session, seeded
  scenes, the median of `--repeat 3` (the default is ONE run).
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

## On-device numbers: Perf REC

Nothing in this directory measures a real device.  That is the in-game
recorder's job (`engine/systems/PerfRecorder.ts`, surfaced as
`GameEngine.perfRec*`), and it works on any device — an iPhone with no
devtools included:

1. Open **DBG ▸ Perf & Diagnostics ▸ Perf REC** — the debug panel opens from
   the DBG launcher, the `` ` `` key or a pad's Select / Share, on any screen.
2. Tap the scene chip to label the capture (baseline / roamer-swarm /
   dragon-stack / dense-wave / custom).
3. Build the scene (e.g. DBG ▸ Enemies & Bosses ▸ Dragon / Rivals / Enemy
   Test), tap **○ REC** (it reads **● REC** while recording), close the
   panel and play ~10–20 s, then reopen it and tap again to stop.  Every
   PLAYING frame is sampled, so a panel left open adds its own re-renders to
   the `ui` column, and ❄ Freeze would record the frames it holds.
4. Tap **Copy** — the report goes to the clipboard (inside the tap, which
   iOS Safari requires) and into a select-all box under the row as a
   fallback.  Paste it into chat.

While recording, the engine folds each PLAYING frame (the true rAF delta plus
the rolling `PerfSnapshot`) into a preallocated buffer — zero cost while
idle, no per-frame allocation.  The report records the viewport / DPR / zoom
and the active DBG settings with the numbers, then: FPS avg / median /
5%-low / 1%-low / min / max and the share of frames at ≥55 and ≥30;
frame-time percentiles; mean render / sim / collisions / ui cost, the light
and fog slice of render and a sim breakdown; the PerfController tier
distribution and peak load; peak entity / enemy / particle counts; the six
worst frames with their render / sim / ui / residual split; and a timeline
of marked events.  How to read the `ui` column, and why captures taken
before 2026-08-16 misreport it, is in CLAUDE.md §8.
