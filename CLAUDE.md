# Omni — Master Spec

Session-priming context for working in this repo. Read this first; it's designed
to replace most broad-codebase exploration for routine tasks. File paths below
are relative to the repo root.

---

## 1. What Omni is

A 2D top-down space game built on a bespoke engine. Canvas2D renderer, React
shell for the HUD, Vite bundler, TypeScript throughout. Single-page app — no
server, no backend, no persistence beyond in-memory run state.

- Entry point: `index.tsx` → `App.tsx` (mounts `<canvas>` + `UIOverlay`, owns
  the `GameEngine` instance).
- The engine runs its own `requestAnimationFrame` loop with a fixed-timestep
  sim accumulator (see `SIMULATION_CONSTANTS.FIXED_DT`). Render cadence is
  decoupled from physics cadence.
- The playable world is a **torus**: positions wrap on both axes. Every
  distance / vision / neighbor calculation must use `wrapDeltaX` / `wrapDeltaY`
  from `engine/toroidal.ts`. Rendering handles seam-straddling entities via
  `forEachWrapOffset` / `shiftX`/`shiftY`.

---

## 2. Directory layout

```
App.tsx                     Top-level React component; mounts canvas + UIOverlay
index.tsx / index.html      Vite entry
index.css                   Tailwind v4 import (styling = utility classes only)
types.ts                    All shared TS types; see §4 for the GameEntity shape
constants.ts                ~1000 lines of config-as-code; see §5
assets.ts                   Central asset manifest; auto-discovered nebula images
vite.config.ts              React + Tailwind + virtual:nebula-manifest plugin
tsconfig.json               ES2022, bundler resolution, "@/*" → repo root
package.json                scripts: dev, build, preview (no lint/test script)
netlify.toml                Netlify deploy config (build = dist/)
scripts/inline-build.mjs    Bundles dist/ into single-file omniverse-standalone.html

components/
  UIOverlay.tsx             Entire HUD (menu, pause, wave banner, debug panel)

engine/
  GameEngine.ts             God-class orchestrator (~2200 lines). Owns the
                            player entity, camera, wave state, map state, and
                            the update/render loop. Most new features plug in
                            here.
  toroidal.ts               MAP_WIDTH/HEIGHT, wrap helpers, dimension-change
                            listener registry
  NebulaColor.ts            Palette-aware hex blending for nebula compositions
  maps/
    MapClasses.ts           BaseMapLayer + UniverseMap / RingMap /
                            SevenRingsMap / PocketMap subclasses
    TileGenerator.ts        Hex-grid placement, cluster generation, HEX_* consts
  systems/
    InputSystem.ts          Keyboard/mouse state
    PhysicsSystem.ts        ~1400 lines. Dual spatial grid (static + dynamic),
                            SAT broadphase, collision resolution, gravity,
                            per-entity damping ticks
    RenderSystem.ts         ~2200 lines. Canvas2D draw pass, tint cache,
                            damage text, wave banner, minimap
    AISystem.ts             Per-enemy state machine (idle/chase/flee/hunt/
                            skirmish/orbit/snipe); reaction-time lag targets
    ParticleSystem.ts       Pooled particle FX
    TrailSystem.ts          Generic trail point management
    ProjectileSystem.ts     Projectile lifetime + homing/bouncer/pierce logic
    WeaponSystem.ts         Fire-rate, burst queues, projectile spawning
    DropSystem.ts           Ammo/health/glass drop spawning + collection
    WaveSystem.ts           Wave index, grace timer, spawn geometry
    NebulaSystem.ts         ~950 lines. Shatter, shard dynamics, merge/coalesce,
                            tile regen with rule-based colour
    FlowField.ts            Analytical flow (universe-map default)
    FlowFieldGrid.ts        Baked enemy pathing grid + tile-destroy patching
    EntityIndex.ts          Per-frame filtered lists (enemies, asteroids, …)
    BackgroundManager.ts    Parallax stars + nebula BG layers
    IdAllocator.ts          Monotonic nextId() for entity IDs

public/assets/              Sprites + Nebula*.png (auto-discovered, see §6)
docs/
  POLISH_ARCHITECTURE.md    Planned systems (kinetic energy, asteroid types,
                            shard inheritance, item drops). Some landed,
                            some parking-lot — check git history before
                            re-implementing anything from this doc.
  PARKING_LOT.md            Low-priority ideas
.github/workflows/          pr-preview, publish-standalone
```

---

## 3. Engine lifecycle

1. `new GameEngine(onStatsUpdate, difficulty)` — wires every subsystem,
   creates the player entity, calls `loadMap(buildMap(selectedMapType))`.
2. `initCanvas(ctx)` — hands the renderer its 2D context.
3. `start()` — kicks the rAF loop.
4. `startGame()` / `pauseGame()` / `resumeGame()` / `restartGame()` — state
   transitions driven by `UIOverlay` button callbacks in `App.tsx`.
5. `setMapType(MapType)` — hot-swap map from the main menu; mid-game requires
   restart.

Per-frame:
- `loop()` measures delta, accumulates into `simAccumulator`, runs one or more
  fixed-timestep sim steps, then renders.
- Each sim step: input → AI → weapons/projectiles → physics → nebula dynamics
  → wave tick → drop tick → particle/trail tick.
- `prepareFrameEntities()` rebuilds the flat list the renderer walks; the
  `EntityIndex` caches pre-filtered subsets (enemies, asteroids, etc.) so hot
  loops don't re-scan the master array.

---

## 4. The GameEntity contract

Everything on-screen — player, enemies, tiles, asteroids, projectiles,
particles, drops, nebulas, nebula shards — is a `GameEntity` (see `types.ts`).
Discriminated via `type: EntityType` plus optional role fields
(`enemySubtype`, `structureVariant`, `shardType`, `dropType`, `isBouncer`,
`isLightningArc`, etc.).

Key invariants:
- **`active: boolean`** — false entities are culled in
  `prepareFrameEntities` and ignored by systems. Don't splice from the master
  array mid-loop; flip `active` and let the next sweep drop it.
- **`mass: Infinity`** — marks immovable geometry (tiles, drops). Physics
  skips impulse resolution for pairs where either side is infinite-mass.
- **`position` is canonical torus-wrapped** — every integration step ends
  with `wrapPosition(entity.position)`. Reads happen in world space; renderers
  use `shiftX`/`shiftY` to place the correct wrapped copy near the camera.
- **Per-entity damping** (`linearDamping`, `angularDamping`) is ticked by
  PhysicsSystem, not the subsystem that set it.
- **Optional fields are optional on purpose** — avoid widening the interface
  for one-off feature state; follow the existing "optional field, checked
  before use" pattern.

---

## 5. `constants.ts` — tunable knobs

Config-as-code. Most gameplay balance lives here rather than being hard-coded.
Scan this list before adding a new constant — a relevant block probably
already exists.

- `COLORS`, `SPRITE_CONSTANTS`, `UI_CONSTANTS`, `AMMO_HUD_CONSTANTS`,
  `MINIMAP_CONSTANTS`, `CAMERA_CONSTANTS`
- `INPUT_CONSTANTS`, `PHYSICS_CONSTANTS`, `SIMULATION_CONSTANTS`,
  `LOCAL_GRAVITY_CONSTANTS`, `COLLISION_CONFIG`
- `TRAIL_CONSTANTS`, `SHOOTING_STAR_CONSTANTS`, `GLITTER_TRAIL_CONSTANTS`,
  `EXPLOSION_CONSTANTS`, `PARTICLE_CONSTANTS`, `REGEN_POP_CONSTANTS`
- `PLAYER_MOVEMENT_CONFIG` (per-MapType), `ASTEROID_GENERATION_CONFIG`
  (per-MapType)
- `STRUCTURE_CONSTANTS`, `STRUCTURE_VARIANTS` (glass / reinforced / heavy /
  indestructible health + sprites)
- `NEBULA_CONSTANTS` (~200 lines — fade durations, merge thresholds, palette,
  twinkle cadence, shard physics, drop rates)
- `WEAPONS`, `WEAPON_LIST`, `ENEMY_CONSTANTS`, `ENEMY_VARIANTS`, `ENEMY_ROLE`,
  `ENEMY_BURST_CONFIG`
- `WAVE_CONSTANTS`, `WAVE_ANNOUNCE_CONSTANTS`, `generateWaveDef`,
  `DIFFICULTY_SCALES`, `DIFFICULTY_STAT_SCALES`
- `DROP_CONFIG`, `HEALTH_DROP_INTERVAL`, `PROJECTILE_CONSTANTS`,
  `LIGHTNING_*`, `HOMING_ACQUIRE_RANGE`, `SHIELD_CONSTANTS`,
  `DAMAGE_TEXT_CONSTANTS`, `AI_CONFIG`, `MAX_PROJECTILES`, `MAX_PARTICLES`

Difficulty is a single 0..3 index that feeds both `DIFFICULTY_SCALES` (enemy
count) and `DIFFICULTY_STAT_SCALES` (per-enemy hp/speed/damage).

---

## 6. Assets & Nebula manifest

- Sprites live in `public/assets/` and are referenced via `ASSETS` in
  `assets.ts`. Placeholder 404s are used for any not-yet-sourced art; don't
  hang waiting for them — the canvas fallback draws polygons.
- Nebula images (`Nebula##.png` in `public/assets/`) are **auto-discovered**
  at build time by the `nebulaManifestPlugin` in `vite.config.ts`, exposed as
  the virtual module `virtual:nebula-manifest`, and surfaced as
  `NEBULA_IMAGES_ALL` / `NEBULA_IMAGES_SET_A` / `NEBULA_IMAGES_SET_B`.
  Drop a new file in the folder → dev server hot-reloads; no code change.
- The active set is mutated in place via `setActiveNebulaSet(...)`; the
  single `NEBULA_IMAGES` array reference is shared by all consumers.

---

## 7. Build / run / deploy

- `npm install && npm run dev` — dev server on port 3000 (see `vite.config.ts`).
- `npm run build` → `dist/`. Netlify uses this directly.
- `node scripts/inline-build.mjs` after a build → writes
  `omniverse-standalone.html` (single-file portable build with CSS + JS +
  referenced PNGs inlined as data URIs).
- No test runner or linter is configured; don't invent one unless the user
  asks. TypeScript type-checks via `tsc` implicitly through Vite's build, but
  there's no standalone `tsc --noEmit` script wired up.

---

## 8. Conventions and gotchas

- **Torus math is non-optional.** Any new distance check, nearest-neighbor
  scan, or projectile targeting must go through `wrapDeltaX`/`wrapDeltaY`.
  Non-wrapped `a.x - b.x` will silently break across seams.
- **Fixed-timestep sim.** Systems receive `dt` but it's always
  `SIMULATION_CONSTANTS.FIXED_DT`. Render-side animations can still use real
  wall time via `performance.now()` where smoothness matters (e.g., nebula
  twinkle schedule).
- **Mutate, don't allocate.** Hot paths (physics, render, AI) reuse
  pre-allocated Vector2 buffers and Float64Array ring buffers. Creating
  `{x,y}` objects inside per-frame loops is the #1 perf regression pattern
  in this codebase.
- **No `EntityType` checks in broadphase.** PhysicsSystem uses static vs
  dynamic grids plus pairwise early-outs; add new entity classes to the
  correct grid (stationary tiles → static) rather than branching inside the
  collision loop.
- **Spatial grid cell size** (`SPATIAL_GRID_SIZE = 120`) is tuned for the
  current map sizes. Changing map dimensions goes through
  `setMapDimensions()` which notifies registered listeners to rebuild their
  caches — follow that pattern for any new map-size-dependent state.
- **React re-renders only on stats callback.** `GameEngine` takes an
  `onStatsUpdate` that React uses to drive the HUD. Don't add per-frame
  React state updates for in-game data; pipe everything through
  `EngineStats`.
- **Tailwind v4** — `index.css` imports it; UI styling is utility classes
  only. No bespoke CSS modules.
- **Prefer extending `GameEngine` handlers** (e.g., `handleEntityDeath`,
  `spawnDrops`) over adding a new system unless the concern is genuinely
  cross-cutting. Systems in `engine/systems/` are the right home when state
  and update logic cleanly separate from the engine orchestrator.
- **Don't re-do `docs/POLISH_ARCHITECTURE.md` work blindly** — it's a
  planning doc; several of its systems (kinetic energy, drops, structure
  variants, nebula shards) are already implemented. Check git log / the
  relevant system file before re-building.

---

## 9. Git / workflow

- Default branch: `main`.
- Feature work lives on `claude/<feature-name>-<suffix>` branches.
- Two GitHub Actions: `pr-preview.yml` (Netlify deploy previews),
  `publish-standalone.yml` (releases the single-file standalone build).
- No CI type-check or test gates today — assume local `npm run build` is
  the last-mile validation.

---

## 10. When this file goes stale

Update this spec when any of the following change materially:
- A new top-level directory or major subsystem is added.
- A core invariant shifts (torus → non-torus, fixed → variable timestep,
  entity model rewrite, renderer swap).
- A new build/deploy step enters the pipeline.
- A new category of constant/config becomes load-bearing.

Treat it as a living table-of-contents, not exhaustive docs. Specific
algorithms and per-system rationale belong in file-level comments (and in
`docs/POLISH_ARCHITECTURE.md` for multi-system designs), not here.
