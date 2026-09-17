# Cowork session prompt — AI sprite generator for Omni

> Paste everything below the line into a fresh Cowork session with the
> `I-R0N/Omni` repo attached.

---

## Mission

Build **`tools/spritegen/`** — a local, reproducible sprite generator for this
game that uses **open-source image/3D models** (no paid APIs, no per-image
service calls) to produce two kinds of art:

1. **Single sprites** — one PNG for an asset: enemy ships, asteroids, hex
   tiles, shards, nebula puffs, drops, explosions, station/portal props.
2. **Tilt sheets** — the full **35-pose rotation suite** for a player ship
   hull, exactly matching the contract in `docs/SHIP_SPRITE_SHEETS.md` and the
   layout of `public/assets/ships/base/`.

The generator is a dev tool, not shipped game code. It must not add runtime
dependencies to the game bundle.

## Read these first

- **`docs/SHIP_SPRITE_SHEETS.md`** — the sprite contract. This is binding.
- **`engine/systems/render/shipSprites.ts`** — the grid, the mirror fold, the
  cell order the engine actually indexes.
- **`scripts/gen-ship-sheet.mjs`** — existing tooling. `--table` prints the
  authoritative angle list; `--placeholder` renders the stand-in cells that
  are in `public/assets/ships/base/` today. **Your generator replaces those
  placeholders with real art.** Do not re-derive the angle table by hand —
  read it from `--table` or from `enumerateCells`, so it can never drift.
- **`assets.ts`** — `ASSETS` shows which art exists (`ship.png` 512², six
  500² enemy PNGs) and which is `PLACEHOLDER` (asteroids, hex tiles, portal,
  explosion, planets). `SHIP_SHEETS` is where a new hull registers.
- **`CLAUDE.md` §2, §5, §8** — project conventions.

## Scope: what needs rotations and what does not

**Only player ship hulls need the 35-cell tilt sheet.** The tilt sheet exists
because the player hull pitches and rolls in 3D (`GameEngine.tickPlayerRoll`).

Everything else needs at most **one sprite**: enemies, tiles, shards, bubbles
and drops are drawn **procedurally** today (`render/enemyShapes.ts`,
`tileShapes.ts`, `dropShapes.ts`) and only yaw, which the canvas handles
exactly. Do not build 35-pose pipelines for tiles. If you want enemy art with
tilt later, it reuses the same sheet machinery — but that is not this task.

## The hard problem — read before choosing an approach

**Diffusion models are not multi-view consistent.** Generating 35 images from
35 prompts like "spaceship tilted 45° rolled left" produces **35 different
ships**: the hull changes shape, the colours drift, panel lines move. Snapped
together at 20 poses/second that is not a banking ship, it is a strobing mess.
It is also impossible to hit the exact angles the engine indexes — the table
has cells at ψ = 315°, θ = 60°, and no text prompt lands there.

So do **not** treat this as "35 text-to-image calls". The pipeline that works:

```
prompt ──▶ [1] concept sprite (2D, one image, top-down, level pose)
                    │
                    ▼
           [2] single-image → 3D asset (mesh or splat)
                    │
                    ▼
           [3] ORTHOGRAPHIC render at the exact 35 angles ──▶ cells
                    │
                    ▼
           [4] post: alpha, trim-free centring, downscale, QA
                    │
                    ▼
           [5] install into public/assets/ships/<id>/ + register in assets.ts
```

Stage 3 is a **renderer**, not a model: consistency is then true *by
construction*, and the angles are exact because you dial them in. Stages 1–2
are where the AI lives.

**Fallback for 2D-native styles** (pixel art, flat vector) where meshing
destroys the look: monocular depth estimation on the concept sprite → build a
heightfield / 2.5D mesh → render the same way in stage 3. Weaker at steep
tilts (disocclusion holes) but preserves the drawn style. Implement stage 2
as a **pluggable backend** so both live behind one interface, and say honestly
in the docs which looks better at which tilt.

Evaluate at least the mesh route and the depth route before committing, and
write down what you actually observed.

## Model selection

Pick concrete open-source models, but **verify licences yourself** — several
popular weights are non-commercial and this is a game that may ship. Prefer
Apache-2.0 / MIT weights. Flag anything restrictive in the README rather than
silently baking it in.

- **Stage 1 (text→image):** SDXL / SD 3.5 / FLUX.1-schnell / Qwen-Image class
  models. Note that some FLUX variants are non-commercial.
- **Transparency:** native-alpha approaches (LayerDiffuse-style) or
  background removal (`rembg`, BiRefNet, InSPyReNet). Diffusion output is
  RGB — you must solve alpha deliberately, and avoid dark matting halos.
- **Stage 2 (image→3D):** TRELLIS, TripoSR, InstantMesh, Hunyuan3D, or
  similar. **Depth fallback:** Depth Anything V2 (check the size-tier
  licences).
- **Stage 3 (render):** headless Blender (`bpy`), or `trimesh` + `pyrender`,
  or a headless three.js pass. Must support a true **orthographic** camera —
  the game's projection has no perspective, so a perspective render will not
  match the wireframe hulls it sits beside.

## GPU reality — structure the work around it

This Cowork container most likely has **no GPU**. Do not let that block you,
and do not fake progress by pretending images were generated.

Split the tool so the **deterministic half is fully built and tested here**:
the angle table, the orthographic render rig, centring, alpha handling,
downscaling, validation, the manifest writer and the game integration are all
GPU-free and are also the half that must be *exactly* right. Stage 3 can run
on CPU (Blender/pyrender do). Behind the AI stages put a
`--backend=stub` that emits a deterministic placeholder mesh (a parametric
hull, or reuse the wireframe dart geometry) so the **entire pipeline runs
end-to-end, in CI, without a GPU**.

Then make the GPU path a clean `--backend=<model>` the user runs on their own
machine: document VRAM needs, model download size, and expected runtime per
ship. Make the pipeline **resumable and cached** (hash the prompt+seed+config;
never re-generate a stage whose inputs are unchanged).

## The contract every cell must satisfy

Non-negotiable, from `docs/SHIP_SPRITE_SHEETS.md`:

- **35 cells** for a mirrored hull, named `tilt_t{θ}_a{ψ}.png` with θ and ψ
  zero-padded to 3 digits, ψ normalised 0–359, in
  `public/assets/ships/<id>/`. 57 cells if `mirrorRoll: false`.
- **Square cells, all the same size**, transparent background, straight
  (non-premultiplied) alpha, no dark fringe.
- **Pivot at the exact cell centre in every cell.** This is the one that
  bites: the pivot is what the ship rotates and orbits about, so drift
  between cells reads as jitter. A fixed orthographic camera aimed at the
  mesh origin gives this for free — then *assert* it anyway.
- **Cell size set by the widest pose**, not the level one: a hull with depth
  sweeps wider when tilted. Frame once from the bounding sphere so no pose
  ever clips.
- **Nose points +x (right)** so the manifest keeps `artOffset: 0`.
- **Lighting fixed in world/camera space, not parented to the hull** — the
  shading *should* change as the ship tilts. That is what sells the 3D.
- **Consistent scale and exposure across cells.** The engine cuts between
  poses with no crossfade, so a cell 5% larger than its neighbour reads as a
  pulse.

Also: the player draws at roughly **30 px on screen**. A gorgeous 1024²
render turns to mush at that size. Design for **silhouette first** — strong
outline, high contrast against dark space, minimal interior detail — and
include a **downscale preview at true game size** in the QA output. Judge the
art at 30px, not at 1024.

## Deliverables

1. `tools/spritegen/` — a Python (or Node) CLI, isolated from the game build:
   ```
   spritegen ship  --id=interceptor --prompt="..." --seed=42 [--backend=...]
   spritegen asset --kind=hex-tile-metal --prompt="..." --out=public/assets/...
   spritegen validate public/assets/ships/interceptor
   ```
2. **A style config** (shared prompt suffix / negative prompts / palette /
   seed policy) so a whole asset family looks like one game rather than one
   generator. Pull the palette from `constants.ts` `COLORS`.
3. **Validator** — mechanical, not eyeball: cell count and names match
   `enumerateCells`; every cell is square, same-sized, has alpha; the alpha
   bounding-box centre is within tolerance of the cell centre; no pose
   clips the frame; per-cell mean luminance/scale within tolerance of its
   ring neighbours. Non-zero exit on failure.
4. **QA contact sheet** — all 35 cells laid out ring × azimuth, plus a
   game-size strip, written to a file the user can open.
5. **Docs**: `tools/spritegen/README.md` — install, model choices *and their
   licences*, hardware needs, runtimes, how to add a backend, and an honest
   "what this does badly" section.
6. **A real generated example**: at least one complete ship sheet installed
   at `public/assets/ships/<id>/`, registered in `SHIP_SHEETS`, and verified
   in-game (see below). If no GPU is available, deliver it through the stub
   backend and say plainly that the AI stages are untested on hardware.
7. **Tests** — the deterministic layers, runnable without a GPU: angle table
   agreement with `enumerateCells`, naming, centring, the validator's own
   pass/fail behaviour.

## Acceptance criteria

- `spritegen ship --backend=stub` produces a complete, valid sheet, and
  `spritegen validate` passes on it — with no GPU present.
- The sheet loads in the real game: build, run, open **pause ▸ Debug Menu ▸
  Ship Tilt ▸ "Hull" ▸ Sheet** (and step "Roll feel" off Off — the tilt
  ships disabled), then confirm the ship banks through the poses.
  The suites already do exactly this — `tests/shipsprites.spec.ts` and the
  hull walk in `tests/roll.spec.ts` are your working examples of driving the
  engine headlessly and screenshotting it.
- `npm run typecheck`, `npm run build` and `npx playwright test` stay green.
  The game bundle must not grow a dependency on the tool.
- Nothing in the tool re-derives the 35 angles independently; the table comes
  from `enumerateCells` / `--table`.

## Constraints

- **Open-source models only**, run locally. No paid image APIs.
- **Do not modify the sprite contract** (`shipSprites.ts`,
  `docs/SHIP_SPRITE_SHEETS.md`) to make generation easier. If you find a real
  problem with the contract, say so and propose the change — do not just
  change it.
- Keep the tool out of the Vite build; it is dev tooling.
- Follow `CLAUDE.md` conventions for anything you touch inside the game, and
  update `CLAUDE.md` §2 if you add a top-level directory.
- Work on a branch, commit in logical steps, and report honestly what was
  verified on real hardware versus what was only exercised through the stub.

## Suggested order

1. Read the contract and run `node scripts/gen-ship-sheet.mjs --table`.
2. Build stage 3 first — the orthographic render rig + centring + naming +
   validator — against the stub mesh. Prove a valid 35-cell sheet in-game
   before any model is downloaded.
3. Add stage 2 backends (mesh, depth) behind one interface; compare them.
4. Add stage 1 and the style config.
5. Generate one real ship, install it, screenshot it in the game, and write
   the README with what actually worked.

Start by asking me anything genuinely ambiguous — art direction, target
hardware, whether to prioritise the mesh or depth route — then build.
