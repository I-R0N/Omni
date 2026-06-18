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
    MapClasses.ts         BaseMapLayer + full-game maps (UniverseMap,
                          RingMap, SevenRingsMap, PocketMap) and the
                          single-element 6k showcase maps
                          (AsteroidFieldMap, GlassFieldMap,
                          PlasticFieldMap, MetalFieldMap,
                          IndestructibleFieldMap, NebulaFieldMap)
                          sharing the abstract
                          SingleVariantTileFieldMap base
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
    WaveSystem.ts         Completion-wave spawn scheduler + grace
                          timer + spawn geometry.  A wave ends only when
                          its full budget has spawned AND every spawned
                          enemy is dead (clear-the-field); the clock just
                          grades the speed bonus.  Survivors carry over.
    ShardSystem.ts        Tile / shard regen + shatter + merge orchestrator;
                          driven by SHARD_VARIANTS variant table
    ShardSystem.types.ts  ShardVariantId / ShardVariantDef / merge schema
    NebulaSystem.ts       Slim nebula adapter: neighbour-count refresh,
                          shard→tile transmutation, regen-completion hook,
                          ammo-drop roll
    FlowField.ts          Analytical flow vector (used at map-load asteroid
                          seeding only)
    FlowFieldGrid.ts      Baked enemy-pursuit grid + asteroid-flow field;
                          incremental tile-destroy patching
    EntityIndex.ts        Per-frame filtered lists (enemies, asteroids, …)
    BackgroundManager.ts  Parallax stars + nebula BG layers
    IdAllocator.ts        Monotonic nextId() for entity IDs
    PerfController.ts     Load-driven frame-skip coordinator for every
                          skippable periodic pass (see §3 and §8)
    enforceCap.ts         Shared FIFO hard-cap helper (particles,
                          projectiles)

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
   - `PerfController.beginStep(...)` — samples a load signal
     (dynamic-entity count + collision-cell density + EWMA sim time),
     quantises it to a tier with hysteresis, and decides which periodic
     tasks run this step. Gated call sites check
     `perfController.shouldRun(taskId)`; tasks and cadences live in
     `PERF_TASKS` (see §8).
   - `updatePhysics(dt)`:
     1. FlowField rebuild check (enemy pursuit grid; `flowField` task)
     2. `AISystem.update()` — enemy AI (`ai` task)
     3. `handleEnemyShooting()` — enemy projectiles
     4. `PhysicsSystem.update()` — gravity, collisions, on-death dispatch
   - `updateGameLogic(dt)`:
     1. Camera shake tick
     2. `ShardSystem.update()` — drains the unified regen queue, ticks
        existing stick-bonds (cohesion + threshold), runs the merge
        broadphase (gravity-pull + bond formation).  Variant config
        (SHARD_VARIANTS) drives every policy decision.  Pair scans are
        cadenced via the `shardPair` / `shardTilePair` tasks.
     3. Wave-announcement timers
     4. `NebulaSystem.update()` — neighbour-count refresh + lazy
        grid-index reset (nebula-specific bookkeeping only;
        merge/regen/shatter all moved to ShardSystem)
     5. `WaveSystem.update()` — completion-wave tick: spawn stream
        (the clock is now only the spawn-stream window), wave ends
        when budget spawned + field cleared, grace countdown
        (survivors carry into the next wave; clock grades the speed
        bonus via `onCleared(wave, elapsedSec)`).
        Followed by `updateSnitch()` — persistent-snitch lifecycle:
        burst/coast AI + flow-field steering, comet-tail emission,
        catch check (collide/shoot per DBG toggle), wave-end on catch
        (the snitch entity persists across waves)
     6. Drop-collection scan (`activeDrops` cache; `dropScan` task) +
        ammo-drop merge pass (`DropSystem.mergeAmmoDrops`; `dropMerge`
        task)
     7. Player weapon tick + input
     8. Projectile lifetime tick
3. Final `prepareFrameEntities()` after sim steps.
4. `RenderSystem.draw()`.

Note that **AI runs inside `updatePhysics`**, not as a separate top-level
phase. Drop collection and waves run in `updateGameLogic`, **after**
physics has resolved deaths.

---

## 4. The GameEntity contract

Everything on-screen — player, enemies, tiles (glass / plastic /
metal / rock / indestructible / nebula), mobile shards (rock / glass /
plastic / metal / nebula), projectiles, particles, drops — is a
`GameEntity` (see
`types.ts`). Discriminated by `type: EntityType` plus optional role
fields (`enemySubtype`, `shardVariant`, `dropType`, `isBouncer`,
`isLightningArc`, `isLightningProjectile`, …).

Every shard-family entity (tiles AND shards, glass / rock / nebula)
shares a single `EntityType.STRUCTURE` carrier; per-variant behaviour
lives in `SHARD_VARIANTS` (see §5) keyed by the entity's
`shardVariant` field.  The static-vs-dynamic axis is encoded by
`mass`: `Infinity` → static grid, finite → dynamic grid.  See §8.

Key invariants:

- **`active: boolean`** — false entities are culled in
  `prepareFrameEntities` and ignored by systems. Don't splice from the
  master array mid-loop; flip `active` and let the next sweep drop it.
- **`mass: Infinity`** — marks immovable geometry (static tiles).
  PhysicsSystem inserts mass-∞ entities into the static grid (built
  once on map load) and skips them from dynamic-grid integration.
  Mobile shards have finite mass and live in the dynamic grid.
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
  `trail`, `powerupGlowColor`
- AI: `enemySubtype`, `aiState`, `aiTimer`, `visionRange`, `maxSpeed`,
  `aggroTimer`, `orbitRadius`/`orbitSpin`/`preferredDistance`
- Projectile: `damage`, `homing`, `homingStrength`, `ownerType`,
  `targetEntityId`, `pierceCount`, `hitEntityIds`, `isBouncer`,
  `isLightningProjectile`, `isLightningArc`, `arcPoints`
- Drop / reward: `dropType` (`'ammo' | 'health' | 'glass'`), `dropValue`,
  `dropWeapon`, `powerupWeapon`, `ammoPickupFlash`, `ammo`,
  `dropComposition`. Note: `gold` exists on the player entity but is
  **not currently consumed** anywhere.
- Shard family (tiles + shards): `shardVariant`
  (`'glass-tile' | 'plastic-tile' | 'metal-tile' |
  'indestructible-tile' | 'rock-tile' | 'nebula-tile' | 'rock-shard' |
  'glass-shard' | 'plastic-shard' | 'metal-shard' | 'nebula-shard'`),
  `asteroidHitCount`, `asteroidHitTimer`, `asteroidHitCooldown`,
  `regenProgress`, `regenPopTimer`.  Per-variant policy
  (regen / merge / shatter / dent / repel / glow / automata /
  passThrough) lives in `SHARD_VARIANTS` (see §5).  Shared
  merge/density bookkeeping: `mergeCount` (accumulated by
  `composeEntities`; drives fragment count on asteroid-style
  shatter), `densityTier` + `densityCachedTint` (tint cache —
  invalidate when tier or neighbour count mutates),
  `materialNeighborCount` (automata input, frozen at map-load
  bake), `mergeFadeTimer`/`mergeFadeDuration` (all fade-in
  consumers).  Material-specific: `metalCells`/`metalExcessCells`
  (metal composite lattice + invisible excess mass),
  `plasticDentHistory` (per-dent snap-back queue),
  `plasticNeighborCount`.
- Nebula: `nebulaColorComposition`, `nebulaBlendedHex`, `nebulaTintedKey`,
  `nebulaTileArea`, `nebulaGridCol/Row`, `nebulaNeighborCount`,
  `nebulaImpactCooldown`, `nebulaMergeCooldown`,
  `nebulaSpawnTimer`/`Duration`,
  `nebulaTwinkleNextAt/X/Y`. (Fade-out uses the shared
  `mergeFadeTimer`/`Duration` fields — the old
  `nebulaFadeTimer`/`Duration` pair was deleted.) **Render fast-path cache** (nebula-tile
  variant only): `nebulaCachedTinted`, `nebulaCachedDx`, `nebulaCachedDy`,
  `nebulaCachedSize` — populated by RenderSystem after a slow-path
  draw and invalidated at every site that mutates the inputs
  (composition, neighbour count, tile area).
- Player resources: `health`/`maxHealth`, `shield`/`maxShield`/
  `shieldRechargeTimer`/`shieldHitFlash`, `ammo`, `enemyTier` (set on
  spawn but currently unused by drop scaling), `suppressDrops`

Variant differentiation for shard-family entities goes through
`shardVariant` only.  The legacy `shardType` and `structureVariant`
fields are deleted (Stage 6 of the shard-system overhaul).

---

## 5. `constants.ts` — tunable knobs

Config-as-code. Most balance lives here. Existing top-level blocks:

- `CHUNK_SIZE`, `SPATIAL_GRID_SIZE`
- `COLORS`, `CAMERA_CONSTANTS`, `SPRITE_CONSTANTS`
- `AI_CONFIG`, `COLLISION_CONFIG`
- `UI_CONSTANTS`, `AMMO_HUD_CONSTANTS`, `MINIMAP_CONSTANTS`,
  `INPUT_CONSTANTS`
- `PHYSICS_CONSTANTS`, `SIMULATION_CONSTANTS`, `LOCAL_GRAVITY_CONSTANTS`
- `TRAIL_CONSTANTS`, `PLAYER_TRAIL_CONSTANTS`, `SHOOTING_STAR_CONSTANTS`,
  `GLITTER_TRAIL_CONSTANTS`
- `PLAYER_MOVEMENT_CONFIG` (per-MapType)
- `STRUCTURE_CONSTANTS`, `STRUCTURE_VARIANTS` (glass / plastic /
  metal / indestructible — visual/health config; behavioural policy
  lives in `SHARD_VARIANTS` below)
- `NEBULA_CONSTANTS` (palette / cluster / fade-rate / drop tuning;
  twinkle scheduling)
- `SHARD_VARIANTS` — per-variant regen / merge / shatter / dent /
  repel / glow / automata / passThrough / renderCache policy.
  Source of truth for the shard-family behaviour table.  11 variants
  today:
  glass-tile / plastic-tile / metal-tile / indestructible-tile /
  rock-tile / nebula-tile / rock-shard / glass-shard / plastic-shard
  / metal-shard / nebula-shard.  The `merge.bondsWith` entry
  supports per-partner `bondPartners` config (`cohesionOnly` flag +
  `strength: 'strong' | 'default'` tier); the `automata` block
  (`maxNeighbors` + `saturationBrightness` / `saturationOpacity`)
  drives the aggregation-coloring rules.  See
  `engine/systems/ShardSystem.types.ts` for the schema and
  `docs/SHARD_SYSTEM.md` for the design rationale.
- `MAP_POPULATION` — central per-MapType per-ShardVariantId entity-
  count table.  Source of truth for rock-shard free-spawn counts
  (read via `getRockShardFreeSpawn()`); per-map tile-cluster
  entries are read by `MapClasses.populate()` for the nebula-cluster
  sizing and the single-variant showcase maps.  Some natural maps
  (UniverseMap, PocketMap, SevenRingsMap) still hardcode their own
  tile-variant ratios; treat MAP_POPULATION as authoritative for
  documentation but verify the relevant `MapClasses` subclass too.
- `EXPLOSION_CONSTANTS`, `PARTICLE_CONSTANTS`, `REGEN_POP_CONSTANTS`,
  `WAVE_ANNOUNCE_CONSTANTS`
- `LIGHTNING_CHAIN_RANGE/COUNT`, `LIGHTNING_ARC_LIFETIME`,
  `LIGHTNING_GRAVITY_STRENGTH/RANGE`, `HOMING_ACQUIRE_RANGE`
- `PROJECTILE_CONSTANTS`, `MAX_PROJECTILES`, `MAX_PARTICLES`
- `ENEMY_CONSTANTS`, `ENEMY_VARIANTS` (per-archetype `weapon` override +
  optional `burst` fire pattern + `glow` shot hint — the per-archetype
  `cooldown` is the real fire cadence; the old global burst config is gone),
  `ENEMY_ROLE`, `ENEMY_WEAPON`
- `WEAPONS`, `WEAPON_LIST`
- `SHIELD_CONSTANTS`, `DAMAGE_TEXT_CONSTANTS`
- `WAVE_CONSTANTS`, `TIMED_WAVE_CONFIG`, `WAVE_DEFINITIONS` (3 scripted
  teaching waves), `getWaveDurationSec()`, `getWaveSpawnBudget()`,
  `buildWaveSpawnList()`
- `SCORE_CONSTANTS` (tier-scaled kill points; player-attributed
  shard/tile destruction points — flat per shard, per-maxHealth for
  tiles, nebula variants excluded, attribution via the
  `GameEntity.killedByPlayer` stamp set by the projectile / crash /
  lightning / cannon-AoE damage paths; snitch catch payout;
  early-clear wave bonus.  Gold "+N" popups are magnitude-tiered
  (`styleScorePopup`) and accumulate into ONE live popup
  (`_livePointsPopup`, O(1) — no per-award array scan) so
  cluster/AoE/sweep kills read as one growing total; the HUD chip is
  an integer ticker (`displayScore` eases toward `score` by
  `DISPLAY_CATCHUP_FRAC`/frame).  Kill combo: rapid SHIP kills build a
  points multiplier (`COMBO_*` — steps up per N kills, capped,
  resets after the window; ship kills only) that scales enemy-kill
  points and shows next to the score chip.  World damage numbers
  (`spawnDamageText`) are gated to non-lethal hits on multi-HP
  survivors — lethal hits and dent tiles show nothing, so the
  one-shot majority and the kill-frame overlap are gone; damage chips
  render small + muted-red, distinct from gold points.)
- `UPGRADE_DEFS` / `UPGRADE_EFFECTS` (`UpgradeId`) — in-run progression
  spine.  8 leveled stat upgrades (hull / plating / capacitor / engine /
  thrusters / gunnery / autoloader / magazine) earned ONLY from
  wave-completion cards (every wave); a normal card grants 1 level, and
  every 4th wave (`POWERFUL_WAVE_INTERVAL`) the cards roll "powerful"
  variants worth +2/+3/+4 levels (`UpgradeCard.levels`).  Levels are
  UNCAPPED (`max` on `UpgradeDef` is a DBG-cycle bound only).  Salvage
  (`GameEngine.credits`,
  a spendable mirror of score earned 1:1 in `awardScore`) funds the
  Drydock UNLOCKS, not these.  `GameEngine.applyUpgrades`
  folds the run's `upgradeLevels` into the player's effective stats —
  maxHealth, maxShield, `shieldRechargeRate`, `damageMult` (read in
  WeaponSystem), `cooldownMult` (WeaponSystem), `maxAmmo` (DropSystem
  clamp), plus speed/accel via `upgradeSpeedMult()`/`upgradeThrustMult()`
  multiplied into the movement line.  At all-zero the game is identical
  to before; all reset per run in `resetAndLoadSelectedMap`.  Surfaced +
  testable via the DBG **Upgrades** panel (per-stat level cycle, +1k
  Salvage, Max-all, Reset; `EngineStats.upgrades` / `.credits`).
  PLAYER-FACING TERMS: stat-upgrade cards are **Augments**, the one-time
  unlocks are **Modules**.  An augment with a `requires` (shield /
  anyWeapon) is withheld from the card pool (`GameEngine.augmentEligible`)
  until its module is installed — never offer a card for a system the
  player can't use (Plating/Capacitor need Shield; Magazine needs a
  non-Blaster weapon).
- `UNLOCK_DEFS` / `upgradeCost()` — one-time run unlocks + the stat-
  upgrade Salvage cost curve.  The run starts LEAN (Blaster only, no
  shield, no charged shots); unlocks (Shield, Overcharge, the 6
  non-Blaster weapons) are bought in the **Drydock** (a shop section in
  the player menu, `GameEngine.purchaseUnlock` spending `credits`) or,
  rarely, granted free via an `'unlock'` card.  The Drydock sells
  ONLY these unlocks — the 8 stat upgrades come exclusively from
  wave-completion cards.
  Unlock state lives on `GameEngine` (`unlockedWeapons` / `shieldUnlocked`
  / `overchargeUnlocked`), synced to the player entity
  (`ownedWeapons` / `overchargeUnlocked`) so WeaponSystem gates weapon
  cycle/select + charged shots; `applyUpgrades` gates `maxShield` to 0
  until Shield is owned.  `EngineStats.shop` / `.unlocks` (built only
  while paused) drive the player-menu Drydock + Unlocks panels; DBG
  "Unlock all" / "Relock" cover testing.  NOTE: per-wave enemy stat
  scaling is still a planned increment.
- `UPGRADE_CARD_CONSTANTS` — free between-wave upgrade-card pick.  Every
  `cardWaveInterval` waves (DBG "Card int", default 1) `handleWaveCleared`
  calls `GameEngine.openCardChoice`, which pauses the sim
  (`cardChoicePending` short-circuits the loop's accumulator) and offers
  `CARD_COUNT` cards (`UpgradeCard[]` on `EngineStats.cardChoice`).  Pool
  today: stat-upgrade cards (a free level of a not-maxed `UPGRADE_DEFS`
  entry) + occasional Salvage cards; the `'unlock'` card kind is reserved
  for the weapons/shield/overcharge unlocks (next).  `selectUpgradeCard`
  applies the pick and resumes.  Modal lives in `UIOverlay`
  (`stats.cardChoice`); DBG "Test cards" force-triggers a choice.
- `SNITCH_CONSTANTS` — golden-comet snitch that PERSISTS across waves
  (one keeps flying until caught): a non-drop INTERACTABLE (`isSnitch`)
  riding the asteroid flow field with a sinusoidal weave and a
  burst/coast AI.  Speed ramps PER CATCH (not per wave): headline
  (dart) speed = 0.05× player cruise × (catchCount + 1) (capped at
  1.2×), with coast drifting at 0.30× of that — so the first snitch is
  nearly stationary and each CATCH makes the next one faster, letting
  the player defer the catch to keep it slow.  Darts fire on a random
  timer or when the player closes
  inside PANIC_RADIUS (panic darts bias away from the player; a
  cooldown guarantees coast windows between them).  The whole ramp is
  scaled live by the DBG `SNITCH_SPEED_CYCLE` multiplier (Player ▸
  "Snitch spd").  Catching it pays `SCORE_CONSTANTS.SNITCH_POINTS`,
  wipes every live enemy for `SNITCH_SWEEP_KILL_FRACTION` (half) of its
  normal kill value via the full death path, and ends the current wave
  via `WaveSystem.endWaveBySnitch` (no early-clear bonus on top); the
  next wave spawns a fresh one.  Catch mode is the DBG "Snitch catch"
  toggle, surfaced as `EngineStats.snitchCatchMode`.  Lifecycle lives
  in `GameEngine.updateSnitch` / `spawnSnitch`.
- `DIFFICULTY_SCALES` (wave spawn-budget scale), `DIFFICULTY_STAT_SCALES` (per-enemy
  hp/speed/damage)
- `ENEMY_SCALING` / `enemyHpMult()` / `enemyDamageMult()` — per-wave
  enemy growth on top of difficulty: HP scales at spawn, damage rides a
  per-enemy `damageMult` (read by the ram path + enemy-projectile spawn).
  Tuned gentle for a comfortable player lead; `ENEMY_SCALE_CYCLE` is the
  DBG "Enemy scale" knob (Player section) with a live hp/dmg-mult readout.
- `ENEMY_TRAITS` — enemy counterplay traits (the soft-counter engine).
  v1 = `armor` only (Tank / RAMMER_3): per-hit damage below
  `chipThreshold` is cut by `reduction`, so chip weapons (Blaster,
  Shotgun) plink while heavy hits (Cannon, Lightning, charged, a
  Gunnery-boosted Blaster past the threshold) punch through.  Stamped
  at spawn (`WaveSystem.spawnEnemy`), applied in the PhysicsSystem
  projectile-damage path (gated by `physics.traitsEnabled`, DBG
  "Traits"); armored enemies show the REDUCED hit number as feedback.
  evasive / front-shield / regen join with their enemies + the bosses.
- `CORROSION` / `ENEMY_ATTACK_EFFECTS` — status-effect framework (v1 =
  corrosion DoT only, but generic: `StatusEffectKind` / `EffectPayload`
  / `StatusEffect` in `types.ts`).  An attack with `appliesEffect`
  (the Orbiter / Shooter-tier-2, green acid rounds) debuffs the player
  on hit (`GameEngine.handleProjectileHit` → `applyStatusEffect`);
  `tickStatusEffects` bleeds health past the shield, stacks ×3, refresh
  on re-hit.  HUD badge + acid drip; DBG "Corrode" self-apply
  (`EngineStats.statusEffects`).  Duration-only — no mitigation yet.
- `DROP_CONFIG`, `HEALTH_DROP_INTERVAL`, `ENEMY_AMMO_DROP`,
  `ASTEROID_AMMO_PROGRESSION`, `AMMO_CONSTANTS`, `AMMO_DROP_PULL`
  (mutual drop attraction + merge band)
- `PERF_CONTROLLER_CONSTANTS`, `PERF_TASKS` (per-task min/max
  interval, cost weight, auto curve), `LOCAL_MERGE_CONSTANTS`
  (local-density merge-rate boost; replaced the global
  entity-count merge-rate ladder)
- `TILE_SNAP` (unified shard→tile snap for plastic / glass /
  metal), `FLOW_VARIABILITY` (inverse-mass flow-correction +
  terminal-speed scaling)
- `ROCK_CONDENSE` (25 density tiers), `ROCK_AGGREGATION_TINT_FLOOR`,
  `METAL_ASSEMBLY`, `METAL_HEX_CELLS`, `METAL_MAX_DENSITY_TIER`,
  `METAL_AGGREGATION_BRIGHT_CEIL`, `METAL_BREAK_SHARDS_PER_TIER`
- `PLASTIC_PALETTES`, `PLASTIC_SHARD_AUTOMATA`,
  `PLASTIC_DENT_RECOVERY`, `MATERIAL_GLOW_BRIGHTNESS_CYCLE`,
  `GLASS_GLOW_COLORS`

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

## 6a. Maps

Two families of maps live in `engine/maps/MapClasses.ts`, all subclasses
of `BaseMapLayer`:

- **Full-game maps** — `UniverseMap` (`UNIVERSE`), `RingMap` (`RING`),
  `SevenRingsMap` (`SEVEN_RINGS`), `PocketMap` (`POCKET`). These mix
  asteroids, structures (multiple variants), and nebulae and are the
  ones a normal play session uses.
- **Single-element 6 000 × 6 000 showcase maps** — `AsteroidFieldMap`
  (`ASTEROID_FIELD`), `GlassFieldMap` (`GLASS_FIELD`),
  `PlasticFieldMap` (`PLASTIC_FIELD`), `MetalFieldMap` (`METAL_FIELD`),
  `IndestructibleFieldMap` (`INDESTRUCTIBLE_FIELD`),
  `NebulaFieldMap` (`NEBULA_FIELD`). Each populates the playfield with
  exactly one entity type so a single system (flow field, regen, nebula
  shatter, etc.) can be stress-tested in isolation. The five tile-only
  showcases share an abstract `SingleVariantTileFieldMap` base; entity
  counts are tuned to ≈1 200 per map so the debug HUD's render-time
  numbers compare apples-to-apples across showcases.
- Background-nebula puffs (`BackgroundManager.setMapType`) now key off
  the map's `nebulaClusterCenters` list; maps without nebula tiles
  render no BG nebulae (no canvas-size-random fallback). Keep new maps
  honest by populating that list when, and only when, you spawn nebula
  tiles.
- Per-map gameplay knobs live in `PLAYER_MOVEMENT_CONFIG` (movement
  feel) and `MAP_POPULATION` (entity counts) in `constants.ts` —
  both are `Record<MapType, …>`, so adding a new MapType requires
  entries in both.  Showcase maps (single-variant fields) read
  cluster sizing directly from `MAP_POPULATION`; natural mixed maps
  hardcode their per-variant ratios in their `MapClasses` subclass.

Engine plumbing for adding a map: register the `MapType` value in
`types.ts`, add the subclass in `MapClasses.ts`, switch on it in
`GameEngine.buildMap()`, add per-map config in `constants.ts`
(`PLAYER_MOVEMENT_CONFIG`, `MAP_POPULATION`), and add the menu
button in `UIOverlay.tsx`.

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
- **Spatial grid layout.** PhysicsSystem keeps a `staticGrid` (built
  once on map load) and a `dynamicGrid` (rebuilt every frame). Cell
  size is `SPATIAL_GRID_SIZE = 120`.  Static-vs-dynamic dispatch is
  by `mass`: `Infinity` → static grid, finite → dynamic grid.  Don't
  branch on `EntityType` inside the broadphase.
- **Static vs dynamic via mass.** Setting a tile's mass to a finite
  value puts it in the dynamic grid and lets strikers shove it off
  its hex coordinate — breaks the regen / neighbour-count /
  transmutation logic that all assume `position === hexCoord`.  Use
  `passThrough: true` on the SHARD_VARIANTS entry for tiles that
  should not bounce strikers (today: nebula-tile only).
- **passThrough flag.** PhysicsSystem skips collision-impulse
  resolution when either party's variant sets passThrough.  Today
  that's nebula-tile (mass=∞ + passThrough=true → striker passes
  through and shatters on contact) and nebula-shard (mass=0.01 +
  passThrough=true → bond-formation works without elastic-bounce
  feedback in the dynamic-grid fast-path).
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
- **Ammo drops carry value 1 and merge.** `DropSystem.spawnAmmoDrop`
  hard-forces value = 1 (the per-source `amount` argument and
  `AMMO_PER_*` tunables are intentionally ignored). Nearby drops
  mutually attract, damp, and fuse via `mergeAmmoDrops`
  (`AMMO_DROP_PULL`), conserving total ammo — a wave-kill cluster
  collapses into one fatter pickup. Non-magnetised ammo drops also
  drift with the asteroid flow field.
- **Periodic passes route through PerfController.** Any new skippable
  per-frame work (scans, cosmetic ticks, O(N²) passes) must register
  a task in `PERF_TASKS` and gate on `perfController.shouldRun(id)` —
  do NOT roll a private frame-counter or AUTO interval table. The
  controller samples load per sim step, applies tier hysteresis, and
  staggers task phases so skipped work doesn't bunch up.
- **Shard→tile snap is unified.** Merged plastic / glass / metal
  shards snap onto the hex grid through the shared `TILE_SNAP` policy
  (≥ 2× tile diameter + rest-speed gate) and release debris on snap.
  Metal grows as a rigid 6-cell composite (`metalCells`) that keeps
  absorbing shards as invisible `metalExcessCells`; its `densityTier`
  (1 tier = 6 shards) drives brightness, HP (×tier), and break count
  (`METAL_BREAK_SHARDS_PER_TIER` × tier — deliberately lossy).
- **`mergeCount` drives shatter.** `composeEntities` accumulates
  `mergeCount` on every merge path; the asteroid-style shatter breaks
  a merged parent into ~`mergeCount` fragments (rock additionally
  scales with size and inherits mixed density tiers onto children).
- **Aggregation-coloring automata.** Per-variant `automata` blocks
  map neighbour count / density tier to colour: glass = bipolar
  opacity around neutral, rock = darkens toward
  `ROCK_AGGREGATION_TINT_FLOOR` (tiles and shards share the floor),
  metal = brightens by `densityTier`. Neighbour counts are frozen at
  map-load bake (`materialNeighborCount`); `densityCachedTint` must
  be invalidated at every site that mutates its inputs. Master DBG
  `Tile shade` toggle gates both compute and render.
- **Death routing.** `PhysicsSystem` raises an on-death callback
  that `GameEngine.handleEntityDeath` dispatches: explosions for
  player/enemy, variant-driven shatter + regen-queue via
  `ShardSystem` for shard-family entities (gated by
  `SHARD_VARIANTS[v].shatter` / `.regen`), enemy-shard spawn for
  enemies, ammo-drop roll via `NebulaSystem.handleDeath()` for nebula
  variants.  Drops are spawned by `spawnDrops(entity)` for shard-
  family STRUCTURE entities (and only when `suppressDrops` is unset
  and the variant isn't a nebula).
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
