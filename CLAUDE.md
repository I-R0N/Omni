# Omni — Master Spec

Session-priming context for this repo. Read this first; it describes only
what is currently implemented. File paths are relative to the repo root.

> **About `docs/POLISH_ARCHITECTURE.md` and `docs/PARKING_LOT.md`** — these
> are historical planning docs and are **out of sync with the code**. Do not
> treat them as canonical. Specifically: the kinetic-energy "hardness" model,
> `AsteroidType`/`asteroidType`, fuel/gold drop currencies, and several AI
> states described there were never shipped, or were shipped differently.
> Use this file (and the source) as the source of truth.

---

## 1. What Omni is

A 2D top-down arena game. Bespoke engine, Canvas2D renderer, React shell for
the HUD, Vite bundler, TypeScript throughout. Single-page app — no server, no
backend, no persistence beyond in-memory run state.

- Entry: `index.tsx` → `App.tsx` mounts a `<canvas>` + `UIOverlay` and owns a
  single `GameEngine` instance.
- The engine runs its own `requestAnimationFrame` loop. Sim is fixed-timestep
  via an accumulator (`SIMULATION_CONSTANTS.FIXED_DT`); render cadence is
  decoupled from physics cadence.
- The world is a **torus**: positions wrap on both axes. Every distance /
  vision / nearest-neighbor calculation must use `wrapDeltaX`/`wrapDeltaY`
  from `engine/toroidal.ts`. The renderer translates world→screen with
  `shiftX`/`shiftY`; off-screen-but-near-seam draw uses `forEachWrapOffset`.

---

## 2. Directory layout

```
App.tsx                   Top-level React component; mounts canvas + UIOverlay
index.tsx / index.html    Vite entry
index.css                 Tailwind v4 import (utility classes only)
types.ts                  All shared TS types; see §4
constants.ts              ~1000 lines of config-as-code; see §5
assets.ts                 Asset manifest + auto-discovered nebula image sets
vite.config.ts            React + Tailwind + virtual:nebula-manifest plugin
tsconfig.json             ES2022, bundler resolution, "@/*" → repo root
package.json              Scripts: dev, build, preview (no lint/test script)
netlify.toml              Netlify deploy config (publish = dist/)
scripts/inline-build.mjs  Bundles dist/ into omniverse-standalone.html

components/
  UIOverlay.tsx           Entire HUD (menu, pause, wave banner, debug panel)

engine/
  GameEngine.ts           God-class orchestrator (~2200 lines). Owns the
                          player entity, camera, map, regen queues, drop
                          cache, and the rAF loop.
  toroidal.ts             MAP_WIDTH/HEIGHT, wrap helpers, dimension-change
                          listener registry
  NebulaColor.ts          Palette-aware hex blending for nebula compositions
  maps/
    MapClasses.ts         BaseMapLayer + UniverseMap / RingMap /
                          SevenRingsMap / PocketMap subclasses
    TileGenerator.ts      Hex-grid placement, cluster gen, HEX_* constants
  systems/
    InputSystem.ts        Keyboard/mouse state
    PhysicsSystem.ts      Static + dynamic spatial grids, SAT broadphase,
                          collision resolution, gravity, per-entity damping
    RenderSystem.ts       Canvas2D draw pass, tint cache, damage text,
                          wave banner, minimap
    AISystem.ts           Per-enemy state machine (states currently used:
                          'idle', 'chase' — see §8); reaction-time lag
                          targets, pack-sync, stuck detection
    ParticleSystem.ts     Pooled particle FX
    TrailSystem.ts        Generic trail point management
    ProjectileSystem.ts   Projectile lifetime, homing, lightning gravity,
                          bouncer, pierce
    WeaponSystem.ts       Fire-rate, burst queues, projectile spawning
    DropSystem.ts         Ammo + health drop spawn / collection
    WaveSystem.ts         Wave index, grace timer, spawn geometry
    NebulaSystem.ts       Shatter, shard merge, shard→tile transmutation,
                          twinkle scheduling
    FlowField.ts          Analytical flow vector (used at map-load asteroid
                          seeding only)
    FlowFieldGrid.ts      Baked enemy-pursuit grid + asteroid-flow field;
                          incremental tile-destroy patching
    EntityIndex.ts        Per-frame filtered lists (enemies, asteroids, …)
    BackgroundManager.ts  Parallax stars + nebula BG layers
    IdAllocator.ts        Monotonic nextId() for entity IDs

public/assets/            Sprites + Nebula*.png (auto-discovered, see §6)
docs/                     Planning docs — out of date; see banner above
.github/workflows/        pr-preview, publish-standalone
```

---

## 3. Engine lifecycle and per-frame order

Construction:

1. `new GameEngine(onStatsUpdate, difficulty)` wires every subsystem, builds
   the player entity, and calls `loadMap(buildMap(selectedMapType))`.
2. `initCanvas(ctx)` hands the renderer its 2D context.
3. `start()` kicks the rAF loop.

State transitions (driven by `UIOverlay` callbacks): `startGame()` /
`pauseGame()` / `resumeGame()` / `restartGame()`. `setMapType(MapType)` is
only honored from the main menu; mid-game requires `restartGame()`.

Per-frame `loop()`:

1. Measure delta, accumulate into `simAccumulator`.
2. Drain the accumulator one `FIXED_DT` step at a time. Each sim step:
   - `prepareFrameEntities()` — rebuild master entity list + `EntityIndex`
   - `updatePhysics(dt)`:
     1. FlowField rebuild check (enemy pursuit grid)
     2. `AISystem.update()` — enemy AI
     3. `handleEnemyShooting()` — enemy projectiles
     4. `PhysicsSystem.update()` — gravity, collisions, on-death dispatch
   - `updateGameLogic(dt)`:
     1. Camera shake tick
     2. Glass-tile regen (queue lives on `GameEngine`)
     3. Wave-announcement timers
     4. `NebulaSystem.update()` — nebula regen / merge / transmute
     5. `WaveSystem.update()` — completion check, grace countdown
     6. Drop-collection scan (`activeDrops` cache)
     7. Player weapon tick + input
     8. Projectile lifetime tick
3. Final `prepareFrameEntities()` after sim steps.
4. `RenderSystem.draw()`.

Note that **AI runs inside `updatePhysics`**, not as a separate top-level
phase. Drop collection and waves run in `updateGameLogic`, **after**
physics has resolved deaths.

---

## 4. The GameEntity contract

Everything on-screen — player, enemies, tiles, asteroids, projectiles,
particles, drops, nebulas, nebula shards — is a `GameEntity` (see
`types.ts`). Discriminated by `type: EntityType` plus optional role fields
(`enemySubtype`, `structureVariant`, `shardType`, `dropType`,
`isBouncer`, `isLightningArc`, `isLightningProjectile`, …).

Key invariants:

- **`active: boolean`** — false entities are culled in
  `prepareFrameEntities` and ignored by systems. Don't splice from the
  master array mid-loop; flip `active` and let the next sweep drop it.
- **`mass: Infinity`** — marks immovable geometry (tiles, drops). Physics
  skips impulse resolution when either side is infinite-mass.
- **`position` is canonical torus-wrapped** — every integration step ends
  with `wrapPosition(entity.position)`. Reads happen in world space; the
  renderer uses `shiftX`/`shiftY` to draw the correct wrapped copy.
- **Per-entity damping** (`linearDamping`, `angularDamping`) is ticked by
  PhysicsSystem, not the subsystem that set it.
- **Optional fields are optional on purpose** — follow the existing "set
  the field when needed; check before use" pattern rather than widening
  the interface for one-off feature state.

Notable existing field categories on `GameEntity`:

- Visual: `sprite`, `color`, `polygonPoints`, `rotationSpeed`, `hitFlash`,
  `trail`, `shardType`, `powerupGlowColor`
- AI: `enemySubtype`, `aiState`, `aiTimer`, `visionRange`, `maxSpeed`,
  `aggroTimer`, `orbitRadius`/`orbitSpin`/`preferredDistance`
- Projectile: `damage`, `homing`, `homingStrength`, `ownerType`,
  `targetEntityId`, `pierceCount`, `hitEntityIds`, `isBouncer`,
  `isLightningProjectile`, `isLightningArc`, `arcPoints`
- Drop / reward: `dropType` (`'ammo' | 'health' | 'glass'`), `dropValue`,
  `dropWeapon`, `powerupWeapon`, `ammoPickupFlash`, `ammo`,
  `dropComposition`. Note: `gold` exists on the player entity but is
  **not currently consumed** anywhere.
- Structure / regen: `structureVariant` (`'glass' | 'reinforced' |
  'heavy' | 'indestructible'`), `asteroidHitCount`, `asteroidHitTimer`,
  `asteroidHitCooldown`, `regenProgress`, `regenPopTimer`
- Nebula: `nebulaColorComposition`, `nebulaBlendedHex`, `nebulaTintedKey`,
  `nebulaTileArea`, `nebulaGridCol/Row`, `nebulaNeighborCount`,
  `nebulaImpactCooldown`, `nebulaMergeCooldown`,
  `nebulaFadeTimer`/`Duration`, `nebulaSpawnTimer`/`Duration`,
  `nebulaTwinkleNextAt/X/Y`
- Player resources: `health`/`maxHealth`, `shield`/`maxShield`/
  `shieldRechargeTimer`/`shieldHitFlash`, `ammo`, `enemyTier` (set on
  spawn but currently unused by drop scaling), `suppressDrops`

There is **no `asteroidType`** field today. Variant differentiation for
asteroid-class entities goes through `shardType` (`'asteroid' | 'tile' |
'nebula'`) only.

---

## 5. `constants.ts` — tunable knobs

Config-as-code. Most balance lives here. Existing top-level blocks:

- `CHUNK_SIZE`, `SPATIAL_GRID_SIZE`
- `COLORS`, `CAMERA_CONSTANTS`, `SPRITE_CONSTANTS`
- `AI_CONFIG`, `COLLISION_CONFIG`
- `UI_CONSTANTS`, `AMMO_HUD_CONSTANTS`, `MINIMAP_CONSTANTS`,
  `INPUT_CONSTANTS`
- `PHYSICS_CONSTANTS`, `SIMULATION_CONSTANTS`, `LOCAL_GRAVITY_CONSTANTS`
- `TRAIL_CONSTANTS`, `SHOOTING_STAR_CONSTANTS`, `GLITTER_TRAIL_CONSTANTS`
- `PLAYER_MOVEMENT_CONFIG` (per-MapType), `ASTEROID_GENERATION_CONFIG`
  (per-MapType)
- `STRUCTURE_CONSTANTS`, `STRUCTURE_VARIANTS` (glass / reinforced /
  heavy / indestructible)
- `NEBULA_CONSTANTS`
- `EXPLOSION_CONSTANTS`, `PARTICLE_CONSTANTS`, `REGEN_POP_CONSTANTS`,
  `WAVE_ANNOUNCE_CONSTANTS`
- `LIGHTNING_CHAIN_RANGE/COUNT`, `LIGHTNING_ARC_LIFETIME`,
  `LIGHTNING_GRAVITY_STRENGTH/RANGE`, `HOMING_ACQUIRE_RANGE`
- `PROJECTILE_CONSTANTS`, `MAX_PROJECTILES`, `MAX_PARTICLES`
- `ENEMY_CONSTANTS`, `ENEMY_VARIANTS`, `ENEMY_ROLE`, `ENEMY_BURST_CONFIG`,
  `ENEMY_WEAPON`
- `WEAPONS`, `WEAPON_LIST`
- `SHIELD_CONSTANTS`, `DAMAGE_TEXT_CONSTANTS`
- `WAVE_CONSTANTS`, `WAVE_CONFIG`, `WAVE_DEFINITIONS`, `generateWaveDef()`
- `DIFFICULTY_SCALES` (enemy count), `DIFFICULTY_STAT_SCALES` (per-enemy
  hp/speed/damage)
- `DROP_CONFIG`, `HEALTH_DROP_INTERVAL`, `ENEMY_AMMO_DROP`,
  `ASTEROID_AMMO_PROGRESSION`

Difficulty is a single `0..3` index that feeds both `DIFFICULTY_SCALES`
and `DIFFICULTY_STAT_SCALES`.

---

## 6. Assets and the nebula manifest

- Sprites live in `public/assets/` and are referenced by URL string via
  `ASSETS` in `assets.ts`. Several fields are still placeholder paths;
  the canvas fallback draws polygons when a sprite 404s.
- Nebula images (`Nebula##.png` in `public/assets/`) are
  **auto-discovered** at build time by the `nebulaManifestPlugin` in
  `vite.config.ts`, exposed as the virtual module
  `virtual:nebula-manifest`, and re-exported as `NEBULA_IMAGES_ALL`,
  `NEBULA_IMAGES_SET_A`, `NEBULA_IMAGES_SET_B`. Drop a new file in the
  folder → dev server hot-reloads; no code change needed.
- `setActiveNebulaSet(...)` mutates the shared `NEBULA_IMAGES` array in
  place. Every consumer reads the same array reference; the DBG panel
  cycles `ALL → A → B → N16`.

---

## 7. Build / run / deploy

- `npm install && npm run dev` — dev server on port 3000 (set in
  `vite.config.ts`).
- `npm run build` → `dist/`. Netlify uses this directly.
- `node scripts/inline-build.mjs` after a build → writes
  `omniverse-standalone.html`, a single-file portable build with CSS, JS,
  and referenced PNGs inlined as data URIs.
- **No test runner or linter is configured.** Don't invent one unless the
  user asks. There is no standalone `tsc --noEmit` script either; type
  errors surface during `vite build`.

---

## 8. Conventions and gotchas

- **Torus math is non-optional.** Any new distance check, nearest-neighbor
  scan, or projectile targeting must go through `wrapDeltaX`/`wrapDeltaY`.
  Naïve `a.x - b.x` will silently break across seams.
- **Fixed-timestep sim.** Systems receive `dt` but it's always
  `SIMULATION_CONSTANTS.FIXED_DT`. Render-side animations may use
  `performance.now()` where smoothness across variable frame intervals
  matters (e.g. nebula twinkle).
- **Mutate, don't allocate.** Hot paths (physics, render, AI) reuse
  pre-allocated `Vector2` buffers and `Float64Array` ring buffers.
  Allocating `{x,y}` inside per-frame loops is the #1 perf-regression
  pattern in this codebase.
- **Spatial grid layout.** PhysicsSystem keeps a `staticGrid` (built once
  on map load — STRUCTURE tiles) and a `dynamicGrid` (rebuilt every
  frame). Cell size is `SPATIAL_GRID_SIZE = 120`. Add new entity classes
  to the correct grid; don't branch on `EntityType` inside the broadphase.
- **Map dimensions are dynamic per-map.** `setMapDimensions(w, h)` is
  called from `loadMap` before any system rebuilds. Modules that cache
  map-size-derived state (e.g. `SPATIAL_COLS` in PhysicsSystem) register
  via `onMapDimensionsChanged(...)` to rebuild on change.
- **AI states currently used in code are `'idle'` and `'chase'`.** The
  `aiState` type union in `types.ts` lists more, but the others have no
  active branches in `AISystem.ts`. Don't assume a missing state is wired.
- **Drop types currently shipped: `'ammo'` and `'health'`** (collected by
  the player). `'glass'` is a `dropType` value used internally for
  shattered structure visuals; there is no fuel, gold-pickup, or
  mid-wave-powerup drop entity in code today, even though `gold` is
  initialized on the player and `dropComposition` can in principle hold
  more variants.
- **Enemy death routing.** `PhysicsSystem` raises an on-death callback
  that `GameEngine.handleEntityDeath` dispatches: explosions for
  player/enemy, regen-queue for non-indestructible structures, shard
  spawn for enemies, route-through to `NebulaSystem.handleDeath()` for
  nebula entities. Drops are spawned by `spawnDrops(entity)` only for
  asteroids and structures (and only when `suppressDrops` is unset and
  the entity isn't a nebula).
- **Nebula tile regen is off by default.** `NEBULA_CONSTANTS
  .TILE_REGEN_ENABLED` is `false`; shattered nebula tiles do not respawn
  on a timer. New tiles only appear via shard→tile transmutation when
  shards merge past the area threshold.
- **React re-renders only on the stats callback.** `GameEngine` calls
  `onStatsUpdate(stats)` which drives the HUD. Do not add per-frame
  React state updates for in-game data; pipe everything through
  `EngineStats`.
- **Tailwind v4** — `index.css` imports it; UI styling is utility classes
  only. No bespoke CSS modules.
- **Prefer extending `GameEngine` handlers** (`handleEntityDeath`,
  `spawnDrops`, the `updateGameLogic` step) over adding a new system
  unless the concern is genuinely cross-cutting. Systems in
  `engine/systems/` are the right home only when state and update logic
  separate cleanly from the orchestrator.

---

## 9. Git / workflow

- Default branch: `main`.
- Feature work lives on `claude/<feature-name>-<suffix>` branches.
- Two GitHub Actions: `pr-preview.yml` (Netlify deploy previews),
  `publish-standalone.yml` (releases the single-file standalone build).
- No CI type-check or test gates today — local `npm run build` is the
  last-mile validation.

---

## 10. Keeping this file accurate

This spec describes current implementation only. Update it when any of
the following change:

- A new top-level directory or major subsystem is added or removed.
- A core invariant shifts (torus → non-torus, fixed → variable timestep,
  entity model rewrite, renderer swap).
- A new build/deploy step enters the pipeline.
- A new category of constant/config becomes load-bearing.
- New `dropType`, `aiState`, `EntityType`, `WeaponType`, or `MapType`
  values become wired up — or existing ones are removed.

Aspirational designs and parking-lot ideas belong in
`docs/POLISH_ARCHITECTURE.md` / `docs/PARKING_LOT.md` (which are not
maintained for accuracy and should not be referenced by this spec).
