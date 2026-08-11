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
package.json              Scripts: dev, build, preview, typecheck, test
                          (no lint script)
playwright.config.ts      Test harness: one 390×844 project, a webServer
                          that builds then previews.  See §7
netlify.toml              Netlify deploy config (publish = dist/)
scripts/inline-build.mjs  Bundles dist/ into omniverse-standalone.html

tests/                    Playwright smoke suites (roadmap 5b) — boot,
                          loop, economy, attribution, traits, screens,
                          plus helpers.ts (the shared harness over the
                          debug handles) and README.md (suite map +
                          the anti-flake rules).  38 tests

components/
  UIOverlay.tsx           Entire HUD (menu, pause, wave banner, station
                          UI, dock affordance, death/run-summary screen,
                          audio settings row; debug panel lives inside
                          the pause menu)

engine/
  GameEngine.ts           Orchestrator (~4900 lines).  Owns the player
                          entity, camera, map, regen queues, drop cache,
                          and the rAF loop.  What is LEFT here after the
                          5f decomposition is the frame itself —
                          `loop` / `updatePhysics` / `updateGameLogic` /
                          `handleEntityDeath` — plus run + map lifecycle,
                          stations/portals, weapons, score and the stats
                          push.  Concerns with a life of their own live
                          in the sibling modules below; they are plain
                          free functions taking `g: GameEngine`, so the
                          engine calls them directly with no dispatch
                          (see docs/GAUNTLET_5F_LOG.md, decision D1)
  bosses.ts               Boss capstones: phase stamping, the live-boss
                          HUD snapshot, the bounty + stage-clear beat,
                          the module grant, the descent rift
  explosions.ts           Shockwaves, the expanding AoE ring, and the
                          direct player-blast path (the player is not in
                          `currentMap.entities`, so the ring can never
                          reach it — see §8)
  outfitting.ts           Hex-slot machinery: the adjacency fixpoint,
                          the fold into player stats, the derived gun
                          loadout, tile move/swap, pricing,
                          `statBreakdown`, the UI snapshots.  The
                          COMMERCE API (moveModule / purchaseModule /
                          sellModule / scrapModule) stays on GameEngine
  debugControls.ts        `DebugControls` — every toggle and cycle behind
                          pause ▸ Debug Menu, reached as `engine.dbg.*`.
                          A class, not free functions, because the UI is
                          the caller.  The flags it writes are still
                          GameEngine fields; only the methods moved
  roamers/                The engine-managed roamers — each a bespoke
                          lifecycle the AISystem does not drive
    dragons.ts            Stage-6 serpent: flow-weave roam, the Snake
                          body it eats out of the terrain, sever/detach,
                          portal entry + exit, kill payout
    rivals.ts             Stage-7 privateers: score-cadence warp-in,
                          cached hunt target, strafe, loot vacuum
    snitch.ts             The persistent golden comet: burst/coast AI,
                          per-catch speed ramp, the catch board-clear
    bubbles.ts            Stage-5 ambient fauna + the eat/latch
                          machinery it owns (Stage-3b consume-and-grow,
                          Stage-3c attach)
  toroidal.ts             MAP_WIDTH/HEIGHT, wrap helpers, dimension-change
                          listener registry
  NebulaColor.ts          Palette-aware hex blending for nebula compositions
  maps/
    MapClasses.ts         BaseMapLayer + full-game maps (OverworldMap,
                          UniverseMap, RingMap, SevenRingsMap,
                          PocketMap) and the
                          single-element 6k showcase maps
                          (AsteroidFieldMap, GlassFieldMap,
                          PlasticFieldMap, MetalFieldMap,
                          IndestructibleFieldMap, NebulaFieldMap)
                          sharing the abstract
                          SingleVariantTileFieldMap base.  BaseMapLayer
                          also owns the portal factory
                          (addPortal / addReturnPortal)
    MapDescriptors.ts     MAP_DESCRIPTORS registry — the thin typed map
                          layer portals + transitions reference (stable
                          id, name, MapType, kind, wavesEnabled) plus
                          mapDescriptor() / descriptorForMapType() /
                          HUB_DESCRIPTOR.  Wraps the MapType plumbing;
                          does NOT replace it
    TileGenerator.ts      Hex-grid placement, cluster gen, HEX_* constants
  systems/
    InputSystem.ts        Keyboard/mouse/touch state.  Pointer gestures
                          engage game input ONLY when they start on the
                          CANVAS — overlay-targeted events are skipped
                          entirely so menus keep native touch scrolling
    PhysicsSystem.ts      Static + dynamic spatial grids, SAT broadphase,
                          collision resolution, gravity, per-entity damping
    RenderSystem.ts       Canvas2D draw pass (~1580 lines).  After the 5f
                          split and the renderEntities decomposition that
                          followed it, this is the WORLD pass — `render`,
                          `renderEntities`, the sprite/tint/bitmap caches,
                          the flow-field overlay — plus the frame
                          orchestration that calls the render/ modules
                          below.  `renderEntities` is now the per-entity
                          FRAME: the guards, the glass-family static-tile
                          fast path, the shared per-entity setTransform,
                          the sprite path, and a 5-way `entity.type`
                          dispatch into the four *Shapes modules
    render/               Render sub-domains, split out of RenderSystem
                          by what they draw.  Free functions; the ones
                          taking the RenderSystem (`r`, or `rs` where the
                          moved body already binds `r` as a radius) do so
                          only for state that persists between frames
      drawUtils.ts        The shared floor every direction imports so no
                          two of them import each other: colour maths
                          (hexToRgb / rgbToHex / liftCh / sinkCh /
                          densityTintForRender), the seeded damage-crack
                          overlay + its style table, the torus
                          shiftX/shiftY, roundRectPath
      enemyShapes.ts      Procedural enemy silhouettes — one drawn shape
                          per archetype, boss aura, engine flame, damage
                          cracks.  Takes no engine and no renderer
      tileShapes.ts       The STRUCTURE arm: glass-family tile, material
                          tile, regen ghost, asteroid / mobile shard +
                          LOD chips — plus the helpers only terrain
                          calls (tileFillColor + the materialAutomata*
                          chain, overlayMaterialCracks, timedTileBloom /
                          renderProximityBloom, drawMetalDebugOutline)
      nebulaTiles.ts      The cloud layer, both doors: the cached
                          fast path (one drawImage) and the slow path
                          (tint chain, sprite, twinkle) that refills it
      projectileShapes.ts The four shot silhouettes — lightning, bouncer
                          head, charged fireball, standard glow — and
                          the two unit-radius gradient caches
      dropShapes.ts       Collectible drops (salvage / health / glass
                          debris) and the proximity-interactable POIs
                          (station, portal, snitch).  Like enemyShapes,
                          takes no engine and no renderer
      hud.ts              The SCREEN-SPACE layer: minimap + its static
                          layer, off-screen indicators, loadout strip,
                          player messages, wave banners, damage text,
                          fitFontPx
      effects.ts          World-space ephemera: player + projectile
                          trails, pooled particles, lightning arcs
      staticTileCache.ts  The pre-rendered immovable-terrain layer —
                          budgeted stamping, per-tile erase, single-draw
                          blit
    AISystem.ts           Per-enemy behavior-dispatch table (ENEMY_BEHAVIOR →
                          moveStrategies); idle/chase state machine,
                          reaction-time lag targets, pack-sync, stuck
                          detection, arc-shield slew
    ParticleSystem.ts     Pooled particle FX
    TrailSystem.ts        Generic trail point management
    ProjectileSystem.ts   Projectile lifetime, homing, lightning gravity,
                          bouncer, pierce
    WeaponSystem.ts       Fire-rate, burst queues, projectile spawning
    DropSystem.ts         Salvage + health drop spawn / collection
    WaveSystem.ts         Completion-wave spawn scheduler + grace
                          timer + spawn geometry.  A wave ends only when
                          its full budget has spawned AND every spawned
                          COUNTED enemy is dead (clear-the-field;
                          `countsTowardWave !== false`); the clock just
                          grades the speed bonus.  Survivors carry over.
    ShardSystem.ts        Tile / shard regen + shatter + merge orchestrator;
                          driven by SHARD_VARIANTS variant table
    ShardSystem.types.ts  ShardVariantId / ShardVariantDef / merge schema
    NebulaSystem.ts       Slim nebula adapter: neighbour-count refresh,
                          shard→tile transmutation, regen-completion hook,
                          salvage-drop roll
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
    CellBuckets.ts        Allocation-free spatial-hash bucket store —
                          flat array indexed by DENSE cell index, with
                          recycled bucket arrays.  Backs the two
                          per-substep broadphase grids (gauntlet 5c)
    AudioSystem.ts        SFX manager — gesture-unlocked WebAudio,
                          per-id polyphony caps + retrigger collapse,
                          tier-thinned global voice ceiling, torus-
                          wrapped pan/attenuation, synthesis primitives
    SfxRegistry.ts        The procedural draft of every sound in
                          docs/SFX_INVENTORY.md, keyed by its stable id
    PerfRecorder.ts       DBG in-game FPS/perf capture harness — records
                          the per-frame timing + PerfSnapshot stream over a
                          window and exports a copy-paste report (DBG panel
                          "Perf REC" section; iPhone-friendly, no devtools)

perf/                     Headless capture harness (gauntlet 5c) —
                          capture.mjs (scene matrix: worst-frame / p99 /
                          allocation attribution), simbench.mjs (low-noise
                          ms-per-sim-substep), probe.mjs (targeted in-page
                          micro-probes), scenes.mjs, README.md.
                          Deliberately NOT part of `npm test`: runs take
                          minutes and are noise-prone; the test suite is a
                          merge gate.  Read perf/README.md before quoting
                          any number out of it
public/assets/            Sprites + Nebula*.png (auto-discovered, see §6)
docs/                     Planning docs — out of date; see banner above
                          EXCEPT docs/SFX_INVENTORY.md, which IS current
                          and IS the source of truth for sound (see §8)
.github/workflows/        pr-checks (the merge gate: typecheck + build +
                          Playwright on every PR), pr-preview,
                          publish-standalone
```

---

## 3. Engine lifecycle and per-frame order

Construction:

1. `new GameEngine(onStatsUpdate, difficulty)` wires every subsystem, builds
   the player entity, and calls `loadMap(buildMap(selectedMapType))`.
   `selectedMapType` defaults to `HUB_DESCRIPTOR.mapType` — a run starts
   on the OVERWORLD hub (roadmap step (k)).
2. `initCanvas(ctx)` hands the renderer its 2D context.
3. `start()` kicks the rAF loop.

State transitions (driven by `UIOverlay` callbacks): `startGame()` /
`pauseGame()` / `resumeGame()` / `restartGame()`. `setMapType(MapType)` is
only honored from the main menu; mid-game requires `restartGame()`.

**A run ALWAYS begins on the OVERWORLD hub.**  `selectedMapType` starts at
`HUB_DESCRIPTOR.mapType` AND `restartGame()` resets it back there, so
returning to the menu returns to the default — map choice is a DEBUG
override that lasts the run it starts, never a preference that sticks to
the front door.  The main menu is correspondingly three controls:
DIFFICULTY, START, and a collapsed Debug Menu dropdown holding the map
picker and the enemy-test rows (user call).  So `setMapType` from the menu
is now reachable only through that dropdown.

**Map loading comes in two flavours** (roadmap step (k)).  Both share
`loadMapFresh(type)` — the MAP-SCOPED teardown + `loadMap(buildMap(type))`
— and differ only in what they layer on top:

- `resetAndLoadSelectedMap()` (new run: menu start / restart / mid-game
  map switch) adds the RUN-SCOPED reset — credits, outfit
  (`resetOutfit()`), score + combo, hull/shield refill, status effects,
  camera zoom, and the per-run counters (`snitchCatchCount`,
  `dragonsKilled`, `nextRivalScore`).
- `transitionToMap(descriptorId)` (portal travel) adds NOTHING of the
  sort — that is the whole point.  Run state CARRIES: credits, score
  (+ `displayScore`), `shipSlots` / `weaponSlots` / `inventory`, owned +
  equipped weapons, and the player's CURRENT hull.  Hull damage crossing
  a portal is deliberate: repairing at a station is the loop.  It then
  re-inits WaveSystem from the DESTINATION descriptor's `wavesEnabled`,
  re-seeds ambient bubbles, and fires the arrival `openPortal` burst.
  ARRIVAL is BESIDE THE RIFT YOU CAME OUT OF: if the destination holds a
  portal pointing back at the map just left — which is exactly the hub's
  per-arena rift — the player surfaces `PORTAL_CONSTANTS.ARRIVAL_OFFSET`
  from its mouth instead of at the map's declared `playerSpawn`
  (`arrivalBesideRift`, read off the LIVE portal entities so it survives
  placement changes).  Coming home used to dump the player at their base
  station across the hub, throwing the trip away.  No matching rift — a
  descent into a fresh arena, or a new run — falls back to `playerSpawn`.
  Combat leftovers (shield timers, status effects, HUD messages) clear.
  Wave progress is FRESH per entry — `WaveSystem.init` zeroes
  `waveIndex`, so leaving an arena abandons the ladder; there is NO
  per-map run state.

Death: `respawnPlayer()` refills at the current map's spawn and the run
continues.  There IS now an interim death PENALTY (user call): raising the
summary charges `min(balance, max(DEATH_PENALTY_FRACTION × balance,
DEATH_PENALTY_MIN))` of the player's UNSPENT credits — whichever of the
percentage and the flat floor is HIGHER, clamped to what they hold, so a
broke pilot is zeroed and never driven negative.  Charged ONCE, on the
transition into `deathPending`, so neither respawning nor restarting can
double-charge, and money already spent on modules is untouched (the
penalty taxes hoarding, not investment).  `lastDeathCreditsLost` /
`runCreditsLost` carry it to the summary, which reports salvage as a
LEDGER FOR THIS LIFE: earned since the last death
(`lifeCreditsEarned`, snapshotted + zeroed at each death), lost to the
wreck, and held after the loss.  The run gross (`runCreditsEarned`)
stays on `EngineStats` but is deliberately NOT the headline — it keeps
climbing and isn't the question being asked at the wreck.  Both numbers are PROVISIONAL
and the fuller dynamic system still belongs to the economy tuning pass
(step 6).
The screen itself is PRESENTATION around the respawn behaviour — when
the wreck's `explosionTimer` runs out the engine no longer respawns; it
arms `deathDelay` (`UI_CONSTANTS.DEATH_SCREEN_DELAY_SEC`), the boss
capstone's reward-moment BEAT applied to the player's own death, and only
then sets `deathPending`, which publishes `EngineStats.runSummary` for
the full-screen UIOverlay run summary (which FADES in).  DEATH IS THE ONE
FULL-SCREEN OVERLAY THAT DOES NOT FREEZE THE SIM (user call) — there is
deliberately no `deathPending` short-circuit in `loop()` and it is
excluded from the substep-drain break, so the field keeps fighting behind
the (translucent) summary.  Three things make that safe: the dead player
is already inert (`updateGameLogic` returns early while `isExploding`, so
no input / weapons / docking / drop collection / wave progress), the
explosion-timer branch is guarded on `explosionTimer > 0` so the PENALTY
cannot be re-charged every step, and the summary is a SNAPSHOT
(`deathSummary`, taken at the moment of death and republished verbatim)
so nothing behind the screen can move the numbers on it.  `runTimeSec`
likewise stops explicitly while `deathDelay > 0 || deathPending` — reading
your own obituary is not play time.  Its three buttons are three existing
paths: `respawnFromDeath()` (→ `respawnPlayer()`, the old auto-respawn),
`restartRun()` (`resetAndLoadSelectedMap()` + `startGame()` — the menu
START path without the menu), and `quitToMenu()` (→ `restartGame()`).
The RUN-SUMMARY COUNTERS (`runKills` / `runCreditsEarned` / `runTimeSec`
/ `runWavesCleared` / `runHighestWave` / `runBestCombo`, alongside the
existing `score` / `credits` / `bossesKilled`) are RUN-scoped: zeroed in
`resetAndLoadSelectedMap()`, deliberately untouched by `loadMapFresh()`,
so one summary spans every map a run visited.  `runTimeSec` accumulates
SIM seconds, so paused / docked time is excluded for free (both freeze
the loop); DEAD time is excluded by the explicit gate above, since death
no longer freezes anything.

**STAGE DESCENT** (boss capstone → deeper stage).  A STAGE is one arena's
ladder: `BOSS_CONSTANTS.WAVE_INTERVAL` ordinary waves and then the boss's
OWN dedicated capstone wave — `STAGE_WAVE_COUNT` (= WAVE_INTERVAL + 1)
waves in all.  The capstone is its own wave, not a boss bolted onto wave
5, so wave 5 must be fully CLEARED before the boss ever warps in, and the
capstone wave streams only that boss's designed escort
(`BossDef.companions` → `buildBossWaveSpawnList`) instead of the ordinary
weighted mix.  Killing
that boss freezes the loop on a STAGE-CLEAR screen — the same
short-circuit the death screen uses, but the player is ALIVE, so it
PAUSES the fight rather than ending it — after a deliberate
`BOSS_CONSTANTS.STAGE_CLEAR_DELAY_SEC` BEAT during which the sim keeps
running so the explosion, debris and salvage spray land before control is
taken away (the overlay then fades in).  Killing the capstone also ROUTS
its forces: every enemy still standing dies through the FULL death path
at FULL value (the snitch board-clear, minus the half-value scale), so
the escort explodes, pays its kill points and sprays its salvage rather
than being left to mop up after the fight is over — NEUTRAL third
parties (`thirdParty`: bubbles, dragons) and RIVALS are spared, since
they are not the boss's forces.  It also HALTS
the arena's ladder (`WaveSystem.halted`) — no further wave starts there,
so the choice between the two rifts is made in quiet.  It opens a DESCENT
rift beside the wreck (`openDescentPortal`, `GameEntity.isDescent`, amber
`PORTAL_CONSTANTS.DESCENT_COLOR`).  `dismissStageClear()` resumes the
cleared arena; the CHOICE is then made IN THE WORLD by flying to a rift,
which is why the screen offers no travel buttons: down the amber rift to
stage N+1, or back through the arena's return rift to the hub.
`GameEngine.stageIndex` is 0-based DEPTH — incremented by
`transitionToMap(id, {descend:true})`, zeroed on arrival at the HUB (the
hub is the surface), and reset per run.  It drives
`WaveSystem.waveOffset` (`stageIndex × STAGE_WAVE_COUNT`), which is added to
`waveIndex` for every `enemyHpMult`/`enemyDamageMult` lookup AND for
`isBossWave`/`bossForWave`, so enemy growth and the boss rotation
continue across a descent instead of restarting with the arena's wave
counter.  The DISPLAY wave number is deliberately unshifted — the HUD
still counts 1..6 within the stage.  The descent target is a RANDOM arena
descriptor: the existing maps are test terrain and interchangeable, so
this is the placeholder seam for the procedural AREAS that will
eventually pick terrain / enemies / flow parameters — swapping a
generator in changes one line, because the target is a descriptor id like
every other portal.

Per-frame `loop()`:

1. Measure delta, accumulate into `simAccumulator`.  BUT FIRST: if
   `dockedAtStation` is set (station POI, increment 1e) the loop pushes
   stats, draws a static frame, and returns — the sim FREEZES while the
   React station UI is up (same short-circuit the removed
   `cardChoicePending` card modal used).  The E key undocks from inside
   this branch.  `stageClearPending` (the boss stage-clear screen) freezes
   the loop the same way, immediately after — and the accumulator drain
   below breaks out of the substep loop the moment it is raised mid-frame.
   `deathPending` is deliberately NOT in this list: the death screen is
   the one full-screen overlay that leaves the world running (see §3's
   Death paragraph).  So the freezing overlays are PAUSED / docked /
   stage-clear; death is not one.
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
     5b. `updateInteractables()` — the two E-key POIs in one pass: a
        handful of O(1) torus-wrapped distances to the station POIs
        (`DOCK_RANGE`) and the map portals (`USE_RANGE`), ARBITRATED BY
        NEAREST so only one wins.  Stamps `stationDockReady` /
        `portalReady` (the world-space halo affordances) on the winner
        only, and on the shared TRIGGER either docks
        (`dockedAtStation`) or travels (`enterPortal()` →
        `transitionToMap`).  The trigger is SELECTING YOUR OWN SHIP —
        a tap/click within `INPUT_CONSTANTS.SHIP_SELECT_RADIUS` of the
        hull, CLAIMED out of the fire queue by
        `InputSystem.claimTapNear` so using a portal never also shoots
        (claiming only runs while something is in range, so a tap on
        the ship in open space still fires) — or the E key.  A portal entry swaps the map IN PLACE from
        here — every later step in the same substep re-reads
        `currentMap`, so the rest of the step runs against the
        destination.  Followed by the Overworld roaming-dragon keeper
        (auto-respawn on `OVERWORLD_CONSTANTS` timers; OVERWORLD only).
     6. Drop-collection scan (`activeDrops` cache; `dropScan` task) +
        same-type drop merge pass (`DropSystem.mergeDrops`;
        `dropMerge` task)
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
  the interface for one-off feature state.  This has been MEASURED and it
  is the fast option, which is worth knowing because the opposite is the
  intuitive conclusion: gauntlet 5c tested normalising every entity to a
  single hidden class (to avoid megamorphic inline caches) and it came out
  **1.9× SLOWER** on the real entity population — the union of keys across
  one map's shards is ~41 properties, and an object that wide spills out of
  V8's in-object slots, which costs more than the megamorphic access does.
  Do not "fix" this pattern for performance without re-running
  `perf/probe.mjs`.

Notable existing field categories on `GameEntity`:

- Visual: `sprite`, `color`, `polygonPoints`, `rotationSpeed`, `hitFlash`,
  `hitReact` (0..1 damage-as-%-of-maxHealth, latched at damage time via
  `hitReactStrength()`; RenderSystem scales the sprite scale-punch by it so a
  chip on a big-HP beast barely flinches — unset → full punch), `trail`,
  `powerupGlowColor`
- AI: `enemySubtype`, `aiState`, `aiTimer`, `visionRange`, `maxSpeed`,
  `aggroTimer`, `orbitRadius`/`orbitSpin`/`preferredDistance`
- Projectile: `damage`, `homing`, `homingStrength`, `ownerType`,
  `targetEntityId`, `pierceCount`, `hitEntityIds`, `isBouncer`,
  `isLightningProjectile`, `isLightningArc`, `arcPoints`
- Drop / reward: `dropType` (`'health' | 'glass' | 'salvage'`),
  `dropValue`, `dropWeapon`, `powerupWeapon`, `salvagePickupFlash`,
  `dropComposition`. Note: `gold` exists on the player entity but is
  **not currently consumed** anywhere.  (The ammo pool, `ammoPickupFlash`,
  and the `'ammo'` drop type were deleted with the ammo system, pivot 1b.)
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
- Station POI: `isStation` (station entities — INTERACTABLE + mass ∞ +
  no dropType, so broadphase / static grid / flow-field obstacles all
  skip them), `stationKind` (`'home' | 'shipwright' | 'armory'` →
  STATION_VARIANTS services/name/colour), `stationDockReady` (stamped
  per step by the dock proximity check; drives the render-side dock
  halo)
- Map portal: `isPortal` (portal entities — the SAME recipe as the
  station: INTERACTABLE + mass ∞ + no dropType, so broadphase / static
  grid / flow-field obstacles all skip them), `portalTargetId` (the
  destination's MAP-DESCRIPTOR ID — never a bare MapType; `name` carries
  the destination's display name for the world-space tag),
  `portalReady` (stamped per step by the interaction check when this
  portal wins the nearest-in-range arbitration; drives the render-side
  entry halo)
- Boss ((h)): `isBoss` (drives the HUD boss bar, the render aura ring and
  the model-(d) payout in `handleEntityDeath`), `bossPhase` (index of the
  applied `BOSS_DEFS` phase; `-1` = spawned, no phase stamped yet).  Two
  GENERIC extension points fall out and are reusable beyond bosses:
  `weaponOverride` (a `Partial<WeaponConfig>` merged over the archetype
  weapon by `WeaponSystem.updateEnemyShooting`) and `spawner` (a
  `SpawnerConfig` `updateNests` reads BEFORE the archetype's own).  Plus
  `poise` (see §5) — stagger resistance, not boss-only.
- Player resources: `health`/`maxHealth`, `shield`/`maxShield`/
  `shieldRechargeTimer`/`shieldHitFlash`, `ownedWeapons`/
  `equippedWeapons` (the 2-slot loadout — see §5 WEAPONS note),
  `enemyTier` (set on
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
- `UI_CONSTANTS`, `LOADOUT_HUD_CONSTANTS`, `MINIMAP_CONSTANTS`,
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
- `AUDIO_CONSTANTS` — mixer + voice-budget tuning for AudioSystem
  (master volume, the three tier-thinned voice ceilings, the retrigger
  COLLAPSE bump + its saturation cap, near/far attenuation radii, pan
  width).  WHAT plays and with what per-sound parameters lives in
  `docs/SFX_INVENTORY.md` and, in code, in `SfxRegistry`.
- `EXPLOSION_PROFILES` / `ExplosionProfile` — per-entity-class death FX
  on the EXISTING ParticleSystem: ring shape, debris count/speed/size/
  lifetime, an accent HUE, screen punch, and the profile's SFX id.  11
  profiles (swarm / standard / heavy / kamikaze / bubble / rival /
  player / boss + glass / rock / metal).  `GameEngine.deathFx()` is the
  SINGLE classification returning both the profile and the sound, so a
  class's look and its voice cannot drift apart.  Plastic and nebula
  resolve to a NULL profile — their existing deliberate non-burst
  (plastic never sparks; nebulae fade via `mergeFadeTimer`) is itself
  differentiation.
- `EXPLOSION_CONSTANTS`, `PARTICLE_CONSTANTS`, `REGEN_POP_CONSTANTS`,
  `WAVE_ANNOUNCE_CONSTANTS`
- `LIGHTNING_CHAIN_RANGE/COUNT`, `LIGHTNING_ARC_LIFETIME`,
  `LIGHTNING_GRAVITY_STRENGTH/RANGE`, `HOMING_ACQUIRE_RANGE`
- `PROJECTILE_CONSTANTS`, `MAX_PROJECTILES`, `MAX_PARTICLES`
- `ENEMY_CONSTANTS`, `ENEMY_VARIANTS` (per-archetype `weapon` override +
  optional `burst` fire pattern + `glow` shot hint — the per-archetype
  `cooldown` is the real fire cadence; the old global burst config is gone),
  `ENEMY_ROLE`, `ENEMY_WEAPON`.  Roster today: 6 base archetypes
  (RAMMER_1-3 / SHOOTER_1-3) plus 3 additions — KAMIKAZE
  (RAMMING star bomber that detonates an AoE shockwave INSTANTLY on player
  contact; `shoots:false`), BULWARK (SHOOTING octagon fortress with a
  rotating directional arc shield + a 3-shot fan), TURRET (Stage 1: a
  STATIONARY SHOOTING cross emplacement — `maxSpeed:0` → AISystem no-move
  branch — that rotates to aim and lobs slow HOMING missiles), and the Stage-4
  pair SWARM (cheap fast 'swarm'-boids gnat that POPS on contact —
  `diesOnContact`: deals its small bite once then dies, a discrete hit + light
  pop instead of a clinging friction-chip; skips debris/drop spray.  For a big
  flock to stay cheap, a `diesOnContact` gnat is simplified across systems:
  collision is skipped for every pair except player + player-projectile
  (`PhysicsSystem.checkAndResolveCollision` early-out — gnats phase through
  terrain + each other), the render is a flat-fill silhouette with no flame/
  gradients (`RenderSystem.drawEnemyShape` early path), and off-screen
  indicator chevrons are suppressed (minimap still shows them)) + NEST
  (near-static hive whose `spawner` config births SWARM brood via
  `GameEngine.updateNests` → `WaveSystem.spawnAt(..., counts:false)`, capped at
  `maxBrood`), and the Stage-5 BUBBLE (an AMBIENT PASSIVE soft-body blob,
  'bubble' behavior — `ambient:true`, so it's ALWAYS-PRESENT fauna, NOT a wave
  enemy: `countsTowardWave` is forced false however it spawns, and
  `GameEngine.maintainAmbientBubbles` keeps `BUBBLE_CONSTANTS.AMBIENT_POPULATION`
  alive — seeded in `startGame`, topped up offscreen on a timer, suppressed
  while a DBG enemy-test forces another type).  Passive movement
  (`AISystem.updateBubble`) rides the asteroid flow field
  (`flowField.sampleAsteroidFlow`), peeling OFF the flow to chase + eat the
  nearest mobile shard within `AI_CONFIG.BUBBLE.SHARD_VISION` (consume-and-grow
  via `GameEngine.updateConsumers`).  Eating is MASS/ENERGY CONSERVED
  (`shardRichness`): denser/bigger shards (metal > rock > glass/plastic/nebula,
  scaled by size) take proportionally LONGER to digest
  (`DIGEST_DURATION × richness`) and give more growth + maxHealth + heal
  (`growConsumer(…, rich)`) — so a bubble heals from feeding and slowly tanks up.
  PLASTIC and GREEN-nebula shards are TOXIC (`isToxicShard`): eating one makes
  the bubble SICK (`bubbleSickTimer`) — it turns green, goes sluggish
  (`SICK_SPEED_MULT`), and can't eat until it recovers.  It starts SMALL
  (half-size) and grows slowly; once grown to `multiply.atSize` it SPLITS into
  two base-size bubbles (`updateBubbles`, capped at `multiply.maxPopulation`).
  It's a TRUE THIRD PARTY (`thirdParty:true`): passive until ATTACKED — by the
  player OR another enemy.  Enemy fire can hit it (the PhysicsSystem
  friendly-fire filter is bypassed for `thirdParty` targets), and any damaging
  hit — OR a MODERATE body collision (relative impact ≥ `COLLIDE_AGGRO_SPEED`,
  `PhysicsSystem.maybeBubbleCollisionAggro`) — stamps `aggroTargetId` to the
  attacker/collider (`proj.ownerId`, the AoE ring's `ownerId`, or the rammer's
  id) — so it retaliates against whoever last hit/rammed it, retargeting on each
  new hit (`AISystem.resolveBubbleTarget`).  It LOSES aggro if the target flees
  past `AGGRO_LOSE_RANGE` or when the attacker dies.  Once provoked it homes its
  target and, on contact, LATCHES (`attachedToId` → `updateAttachments`) for
  `LATCH_DURATION`, draining `LATCH_DPS × size/baseSize` (a bigger bubble bites
  harder); on the PLAYER it also EMPs weapon + shield (`'disable'`, re-applied at
  `EMP_REFRESH`).  The latch breaks — and the bubble falls off + goes SICK
  (`detachLatch`, it NO LONGER dies) — on the timer, on ANY projectile hit
  (`bubbleKnockFree`, PhysicsSystem), or when the player SLAMS a tile/asteroid at
  ≥ `KNOCK_SPEED` (`terrainSlamTimer`).  Provoked bubbles stop breeding/eating.
  Tanky: base `health` 50 with maxHealth scaling LINEARLY with size as it grows
  (`syncBubbleMaxHealth`), so a big well-fed bubble takes real damage to kill.
  Locomotion: SLOW while passive (drift / shard-chase); only when
  HUNTING (provoked/aggro) does it move fast — a high sustained cap
  (`PROVOKED_SPEED_MULT`) plus periodic LUNGES (`BURST_*`, aggro-only) so it can
  run a fleeing enemy/player down.  Brightness tracks AGGRO only — feeding does
  NOT brighten the membrane (the held meal reads instead); calm bubbles render
  faint (`BUBBLE_CONSTANTS.CALM_VISIBILITY`), provoked ones full opacity, and a
  hit-flash always reads.  Renders with NO health bar; its off-screen
  indicator is PURPLE under its own small budget, blinking red once it is
  hunting the player (see the off-screen-indicator note in §8).
  Feel tuning lives in `AI_CONFIG.BUBBLE` (drift / chase / seek / burst),
  engagement + ambient payload in `BUBBLE_CONSTANTS`).  Finally the Stage-6
  DRAGON (an engine-managed serpent MINI-BOSS — `'dragon'` AI strategy is a
  NO-OP; `GameEngine.updateDragon`/`spawnDragon` own its lifecycle like the
  snitch).  It ENTERS via a portal (`openDragonPortal` — a violet rift
  shockwave), rides the asteroid flow field on a SLOW serpentine WEAVE
  (`SPEED_FRAC` ≈ 0.13).  Its BODY is a real Snake of tiles: each static tile it
  devours in its path (`physics.forEachStaticNear`) is APPENDED as a body segment
  (`appendDragonSegment`) — a real finite-mass tile-variant STRUCTURE,
  chain-followed behind the head (`positionDragonBody` snaps each along the head's
  recorded `dragonPath`, `SEGMENT_SPACING` apart, up to `MAX_SEGMENTS`).  So the
  dragon's body IS the material it ate (glass / rock / metal / plastic / mixes)
  and each segment behaves like a tile (shootable / dents / breaks).  Segments are
  kept OUT of the shard indices (EntityIndex `dragonSegment` gate → ShardSystem /
  flow-drift / consume skip them) and `phasesTerrain` (glide through terrain +
  each other; still SOLID to the player + shootable).  It SPAWNS WITH a starting
  body (`START_SEGMENTS` tiles of one random material, `makeDragonSegment` —
  never a bare head; becomes mixed as it eats).  SEVER: shooting a body segment
  dead (`dragonSegmentDeath`) drops it AND everything AFT of it (`severDragon` →
  `detachDragonSegment` turns each into a free drifting shard of its material).
  It's a NEUTRAL THIRD PARTY (`thirdParty:true`, like the bubble): passive —
  just roams + eats — until ATTACKED by the player OR an enemy (head shot /
  rammed → `provoked` via PhysicsSystem; a body-segment hit provokes too).  ONLY
  once provoked does the HEAD deploy attacks: spit SWARM gnats + lob HOMING
  missiles (`GNAT_INTERVAL`/`MISSILE_INTERVAL`/`fireDragonMissile`).  Deals
  contact damage; a tanky, heavy, damageable ENEMY (`health` 500, `mass` 500 →
  bespoke `dragonDeath`: payoff + rift collapse + body scatters).  Kill payout
  DOUBLES per dragon killed this run (`DRAGON_CONSTANTS.SCORE` × 2^`dragonsKilled`
  — 3000 / 6000 / 12000 …; `dragonsKilled` resets per run).  LEAVES via the exit
  portal after `ROAM_DURATION` if not killed — it flies HEAD-FIRST into a rift
  opened `PORTAL_AHEAD` of it and is swallowed tail-to-head (head hides on entry,
  each body segment puffs as it crosses; `LEAVE_DURATION` is a safety cap).  Body segments are IMMUNE to crash
  damage (PhysicsSystem treats a `dragonSegment` like an indestructible wall on
  player contact) — they only break when SHOT, so crashing into the body just
  bounces.  ANY NUMBER of dragons can be alive at once — each is a
  `DragonInstance` (head + body + per-dragon lifecycle/attack timers) in
  `GameEngine.dragons`, ticked by `updateDragons`.  DBG: a dedicated Dragon menu
  (glass / rock / plastic / metal / mixed buttons; each click stacks another).
  Tuning in `DRAGON_CONSTANTS`.  And the Stage-7 RIVAL (player-like privateer
  ships — NOT an ENEMY_VARIANTS archetype but a bespoke engine-managed roamer
  like the dragon/snitch: `GameEngine.rivals` = `RivalInstance[]`, ticked by
  `updateRivals`, AISystem skips them via the `isRival` flag).  They WARP IN via
  the abstracted portal on a SCORE cadence (one random rival every
  `RIVAL_CONSTANTS.SCORE_INTERVAL` = 1000 points earned, capped at `MAX_RIVALS`
  alive) — the only auto-spawned roamer (the dragon stays DBG-only) — and roam
  for `ROAM_DURATION` (280s, 10× the dragon) before warping out.  A rival is a lean `EntityType.ENEMY` +
  `isRival`, RENDERED FROM AN OLD ENEMY PNG (`RIVAL_CONSTANTS.SPRITES` —
  drone/charger/tank/skirmisher/orbiter/sniper; the sprite-first RenderSystem
  path handles it, at `RIVAL_ROTATION_OFFSET` = the player's 3π/4 art angle and
  a 1:1 `drawScale` so the hull matches the `size` hitbox).  It HUNTS the nearest WAVE
  enemy, strafes to hold `PREFERRED_DIST`, and fires a blaster bolt flagged
  `hitsEnemies` (a new projectile flag that lets an ENEMY-owned shot damage other
  ENEMY targets — bypassing the friendly-fire filter — but never another rival)
  + `sparesPlayer` (ally/neutral shots pass THROUGH the player).  Killing a wave
  enemy with a rival shot stamps `killedByRival`, so `handleEntityDeath`
  WITHHOLDS the kill points + combo from the player (the rival STEALS them); the
  rival also VACUUMS collectible drops within `LOOT_RANGE` (denying + self-heal).
  THREE dispositions (`RivalDisposition`, spawn-weighted, team colour →
  `RIVAL_CONSTANTS.COLORS`): `hostile` (red — fights the player AND enemies),
  `ally` (green — fights enemies only, never the player), `neutral` (amber —
  fights enemies for loot, ignores the player UNTIL attacked → `provoked` flips
  it to hunt the player).  A rival is a normal damageable ENEMY: the PLAYER can
  down it for a `TIER`-scaled bounty + a loot spray (enemies/other rivals can't
  damage it — friendly-fire filter), and it WARPS OUT via portal after
  `ROAM_DURATION`.  DBG: a dedicated Rivals menu (hostile / ally / neutral /
  random).  Tuning in `RIVAL_CONSTANTS`.  The rift-portal VFX itself is now the
  reusable `GameEngine.openPortal(pos, {color,radius,duration})` (layered
  core-flash + rift ring + echo ring + vortex embers + sparks + a soft shake);
  `openDragonPortal` is a thin wrapper over it.
  And the (h) BOSSES — WAVE-ARENA CAPSTONES, and the ONLY
  addition here that is not a bespoke engine-managed roamer: a boss is an
  ORDINARY `EntityType.ENEMY` built from these same tables and tracked as a
  COUNTED wave enemy, so the existing clear-the-field rule already gates the
  wave on killing it.  What makes it a boss is a `BOSS_DEFS` row of PHASES
  (see §5) plus the WaveSystem cadence.  Roster today: BOSS_WARDEN
  ("Warden", the chassis boss — a slow shielded bastion that shells you from
  mid-range, phase 2 blows the barrier + plating off and calls a SWARM
  escort) and BOSS_SCATTER ("Reaver", the first WEAPON-boss — a fast brawler
  that wields a themed variant of the PLAYER'S OWN Shotgun via
  `BOSS_WEAPONS.SCATTER`, spread from `WEAPONS[SHOTGUN]` so the cone, colour
  and pellet family are the ones the player knows: WEAPONS_AMMO_PLAN §6
  weapon parity, no parallel weapon table.  Its identity is the EVASIVE
  trait; phase 2 raises a tracking arc shield on top, phase 3 trades evasion
  for ARMOR and calls a KAMIKAZE escort, so the right answer flips from
  Seeker to a big-hit weapon mid-fight) and BOSS_SIEGE ("Bastion", the
  Reaver's inverse on every axis — slow, huge and plated, lobbing the
  PLAYER'S OWN Plasma Cannon (`BOSS_WEAPONS.SIEGE`, splash and all) in
  2-shell salvos from a LONG stand-off.  It is the only archetype that
  overrides the shared skirmisher stand-off, via the ENEMY_VARIANTS
  `preferredDistance` field — that is what gives it its own RANGE BAND.
  Its traits are FRONT-SHIELD over REGEN; phase 2 runs both at once and
  phase 3 blows the plate off and adds a TURRET escort).  Optional ENEMY_VARIANTS
  fields drive them: `detonate: {radius,damage,knockback}` (stamped at spawn
  onto `explosionRadius/Damage/Knockback`), `shield`/`shieldRegen`
  (seeds `shield`/`maxShield`/`shieldRechargeRate`) + optional
  `shieldArc: {deg,spin}` (seeds `shieldArcHalfWidth`/`shieldArcSpin`/
  `shieldArcAngle` — a sweeping sector that only absorbs hits from the
  covered side), `consume`/`multiply`/`ambient` (the bubble's
  eat-grow-split + always-present fauna flag), and `poise:
  {stunDamage,knockScale}` (stagger resistance — a heavy hull ignores the
  per-hit hit-stun below `stunDamage` and takes a scaled-down knockback, so
  chip fire can neither lock a boss up nor shove it off its line; a plain
  archetype field, NOT a boss branch).
- `WEAPONS`, `WEAPON_LIST`.  Ammo is DELETED as a system (pivot 1b): no
  drops, pool, per-shot costs, HUD strip, select gating, or dry-fallback —
  weapon pressure is cooldown + the 2-SLOT EQUIP LOADOUT.
  `GameEngine.equippedWeapons` holds exactly 2 slots — DERIVED from the
  weapon hex group's GUN slots since the module system (see MODULE_DEFS
  below): `weaponSlots[0..WEAPON_GUN_SLOTS-1]` are the gun hexes, and
  `syncLoadoutFromSlots()` rebuilds the 2-slot loadout from them (more
  gun slots is the designed future major upgrade; WeaponSystem is
  untouched).  Cycle/select run over the slots only
  (`WeaponSystem.cycleWeapon`/`selectWeapon`); outfit moves are
  DRYDOCK-ONLY (`GameEngine.moveModule`, REJECTS elsewhere — undocked =
  committed outfit; DBG paths bypass via `moveModuleInternal`).  Gun
  purchases land in the INVENTORY like every module.  The HUD is a
  2-slot readout
  (`RenderSystem.renderLoadoutHUD` + `computeLoadoutHUDLayout`; active
  slot highlighted, charge ring unchanged on the ship).  Charged shots
  cost only the 1.0s hold.  Bouncer/Lightning cooldowns were raised
  (0.40→0.55, 0.50→0.65) in the same change to replace the ammo tax they
  leaned on.
- `SHIELD_CONSTANTS`, `DAMAGE_TEXT_CONSTANTS`
- `WAVE_CONSTANTS`, `TIMED_WAVE_CONFIG`, `WAVE_DEFINITIONS` (7 scripted
  teaching waves, one per wave-enemy archetype; the BUBBLE is ambient fauna,
  not a wave enemy, so it has no intro wave), `getWaveDurationSec()`,
  `getWaveSpawnBudget()`, `buildWaveSpawnList()`
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
- The run starts LEAN (free Base Hull on the center ship hex — the
  adjacency root, zero stats — + Blaster on gun hex W1, empty
  inventory, no shield, no charged shots); everything else is bought as
  module items at the shop stations and outfitted at the drydock (see
  MODULE_DEFS above).  `applyModuleEffects` gates `maxShield` to 0
  until an ACTIVE Shield core is installed; Overcharge enables charged
  shots only while installed-and-active.  DBG "Outfit all" / "Reset" +
  the per-variety grant rows + per-weapon grant rows cover wave-map
  testing (grants bypass the drydock guard and auto-install when a hex
  is free).
- Wave-clear reward beat (pivot 1c): with the cards gone,
  `handleWaveCleared` sprays `SALVAGE_CONSTANTS.WAVE_CLEAR_DROPS`
  salvage drops beside the player on every clear (alongside the
  milestone health drop); the early-clear SPEED bonus stays score-only.
  The grace timer + this spray is the between-wave breather now.
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
  "Snitch spd").  Catching it pays `SCORE_CONSTANTS.SNITCH_POINTS`
  plus a spray of `SALVAGE_CONSTANTS.SNITCH_CATCH_DROPS` salvage drops
  (score no longer mints credits, so the catch pays money physically),
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
- `ENEMY_TRAITS` / `EnemyTraitSet` — enemy counterplay traits (the
  soft-counter engine; the weapon x trait map that keeps every weapon a
  "right answer" somewhere is `docs/WEAPONS_AMMO_PLAN.md` §7).
  Today = `armor` (Tank / RAMMER_3 + the Warden boss): per-hit damage below
  `chipThreshold` is cut by `reduction`, so chip weapons (Blaster,
  Shotgun) plink while heavy hits (Cannon, Lightning, charged, a
  Gunnery-boosted Blaster past the threshold) punch through.  Stamped
  at spawn (`WaveSystem.buildEnemy`), applied in the PhysicsSystem
  projectile-damage path (gated by `physics.traitsEnabled`, DBG
  "Traits"); armored enemies show the REDUCED hit number as feedback.
  A trait SET is also what a boss PHASE carries (`BossPhaseDef.traits`) — a
  phase REPLACES the set, so a boss can trade a defence away as it breaks
  down.  `evasive` (Reaver) is the AI-side trait: `AISystem.applyEvasiveDodge`
  scans player-owned projectiles for one CLOSING on a collision course and
  kicks the enemy perpendicular to it, once per `cooldown`.  It is blind to
  HOMING shots BY DESIGN (the Seeker is the designated §7 answer), lightning
  arcs never travel so chains always connect, and one juke per cooldown is
  why a Shotgun cone still lands.  `AISystem.traitsEnabled` mirrors
  `PhysicsSystem.traitsEnabled` so ONE DBG "Traits" toggle gates the whole
  counterplay layer.
  `frontShield` (Bastion) is a PERMANENT directional plate centred on the
  entity's FACING with NO pool to deplete — the Bulwark's arc geometry
  generalized through the shared `PhysicsSystem.sectorCoversHit`, so
  face-tanking never becomes viable.  Its answers fall out of WHERE damage
  is applied rather than from special cases: lightning chains and shockwave
  rings damage in GameEngine, OUTSIDE the projectile path, so they bypass
  the plate for free; a Laser ricochet arrives from behind; and a slow
  fortress can be flanked.
  `regen` heals `perSec` unless a damage BURST shuts it off, and the burst
  window is a FIXED BUCKET, not a sliding one — THAT is the mechanic.  The
  first damaging hit arms the bucket and it expires on schedule regardless
  of what lands inside; a refreshing window would instead measure "damage
  until the player pauses", which any sustained weapon clears, so chip
  damage would stop healing through and the trait would INVERT.  With fixed
  buckets the arithmetic lands on the §7 table by construction.
  `constants.noteTraitDamage()` feeds the bucket from EVERY player damage
  path (projectile, lightning chain, shockwave ring), so splash and chain
  damage count toward a burst like pellets do;
  `GameEngine.updateEnemyRegen` ticks it.  Deliberate ORDERING: armor and
  front-shield reduce damage BEFORE the bucket sees it, so bursting a
  plated target means bursting it FROM BEHIND.
- `BOSS_CONSTANTS` / `BOSS_DEFS` / `BOSS_ROTATION` / `STAGE_WAVE_COUNT` /
  `isBossWave()` / `bossForWave()` / `buildBossWaveSpawnList()` — the (h)
  BOSS capstone tables.  A stage is `BOSS_CONSTANTS.WAVE_INTERVAL`
  ordinary waves plus the boss's OWN wave, so every
  `STAGE_WAVE_COUNT`-th wave of an ARENA is a boss wave
  (decision #39e; the Overworld hub runs no waves, so it gets none for
  free): `WaveSystem.startWave` spawns the rotation's next boss on the
  offscreen ring, fires the shared `openPortal` entrance rift via the
  `onBossSpawn` context hook, streams the boss's OWN escort
  (`BossDef.companions`, cycled to a budget cut by
  `COMPANION_BUDGET_FRAC` — a capstone wave is a designed encounter, not
  the weighted mix with a boss added), and banners the boss name.
  `STAGE_WAVE_COUNT` is the ONE stride the rotation, `isBossWave` and
  `GameEngine.initWaveSystem`'s `waveOffset` all read, so stage length is
  a single edit.  A `BossPhaseDef` is
  a FULL description of the boss's current state — colour, `speedMult`,
  `weapon` (`Partial<WeaponConfig>` → `GameEntity.weaponOverride`),
  `shield` (bubble or tracking arc), `spawner` (`GameEntity.spawner` →
  `updateNests`), `traits` — and fields ABSENT from a phase are CLEARED, so
  a phase can drop a shield or stop escorts.  `GameEngine.updateBosses`
  stamps a phase ONCE on the health-fraction transition
  (`applyBossPhase`); nothing about a boss is bespoke scripting.
  PAYOUT: `payBossBounty` pays score + a PHYSICAL salvage spray
  (`SALVAGE_DROPS`) + a RANDOM MODULE dropped into the inventory
  (`grantBossModule`; pays the item's catalog value in Salvage instead
  when cargo is full).  The module REPLACED the old timed shop discount
  (user call): a countdown you must be near a shop to spend is worse than
  a thing you carry away, and dropping it also removes the buy/sell
  money-pump hazard the discount created.  It stages the payoff BEAT on the dragon's
  precedent: a rift collapse via `openPortal`, a `DEATH_DEBRIS` burst in
  the phase colour, a heavy shake and a banner naming the boss and what
  it just paid.  There is deliberately NO weapon-unlock plumbing —
  weapons stay purely purchased.
  LEGIBILITY: `EngineStats.boss` drives the HUD capstone bar (name,
  phase pips, health bar + a numeric %, shield strip — sized so all of it
  survives a 390px-wide screen); RenderSystem draws a phase-coloured aura ring
  (`AURA_SCALE`/`AURA_ALPHA`) on the boss hull, an oversized SELF-LABELLED
  off-screen indicator that is exempt from both the enemy budget and the
  distance fade (losing the boss arrow behind a crowd of stragglers is
  the case the arrow exists for; it wears the shared enemy RED — its size
  and self-label are what set it apart), and a ringed `MINIMAP_CONSTANTS.BOSS_BLIP`
  contact that clamps to the border instead of being culled.  DBG: pause ▸
  Debug Menu ▸ Bosses.
- `CORROSION` / `DISABLE` / `ENEMY_ATTACK_EFFECTS` — status-effect
  framework (generic: `StatusEffectKind` / `EffectPayload` /
  `StatusEffect` in `types.ts`).  An attack with `appliesEffect`
  (the Orbiter / Shooter-tier-2, green acid rounds) debuffs the player
  on hit (`GameEngine.handleProjectileHit` → `applyStatusEffect`);
  `tickStatusEffects` applies per-kind effects, counts down, drops
  expired.  Two kinds today: `'corrosion'` (stacking DoT, bleeds past
  the shield, ×3) and `'disable'` (EMP — sets the derived
  `systemsDisabled` flag so the weapon can't fire and the shield neither
  absorbs nor recharges, Stage 3c).  HUD badge (amber for disable); DBG
  "Corrode" / "Disable" self-apply (`EngineStats.statusEffects`).
- `MODULE_DEFS` / `moduleDef()` / `moduleFitsSlot()` /
  `MODULE_SLOT_COUNT` / `WEAPON_GUN_SLOTS` / `INVENTORY_CAPACITY` /
  `MODULE_REQUIREMENTS` / `HEX_ADJACENCY` — the hex-slot outfitting
  system (module-config increment).  EVERY piece of progression is a
  discrete NON-UPGRADEABLE module ITEM: stat families come in fixed
  Mk I/II/III varieties (own price ≈ the cumulative old level-curve
  cost, own fixed effect — no levels, no in-place upgrades), guns and
  Shield/Overcharge are single varieties.  Purchases land in the
  INVENTORY (12 tiles rendered as a honeycomb of hex tiles, duplicates
  allowed and stacking); outfitting is moving hex tiles between the
  inventory and the two 7-hex groups — SHIP and WEAPON.  GUN placement
  is SLOT-AGNOSTIC: guns mix freely with weapon mods anywhere in the
  weapon flower, capped at `MAX_INSTALLED_GUNS` (2) MOUNTED at once
  (a count guard in `moveModuleInternal`, surfaced as the "Guns N/2"
  chip; the ≤2 mounted guns in slot order ARE `equippedWeapons` via
  `syncLoadoutFromSlots`, badged W1/W2 dynamically).  WEAPONLESS flight
  is allowed (the Blaster is removable): firing gates off while
  `player.currentWeapon` is undefined, and every gun carries a
  `weight` — and so does EVERY OTHER MODULE.  WEIGHT IS A SHIP
  ATTRIBUTE: the ship's total is `SHIP_WEIGHT.HULL_BASE + Σ (weight of
  every ACTIVE module)`, and thrust scales by `SHIP_WEIGHT.BASE_BOOST /
  (1 + DRAG × ship weight)`.  Armour is heavy, electronics are light,
  and a Mk III weighs 3× its Mk I (`statMks` scales weight with the mark
  like effect and price).  Live total on `GameEngine.shipWeight`.
  Landmarks on the curve: stripped hull ×1.15, weaponless bare frame
  ×1.10, lean start (Base Hull + Blaster) ×1.05, fully outfitted ×0.92
  even WITH Thrusters Mk III — so a maxed ship is genuinely heavy and
  leans on Engine/Thrusters to stay nimble.  WEIGHT IS ALSO PHYSICAL:
  `applyModuleEffects` scales `player.mass` with it
  (`MASS_BASE`/`MASS_REFERENCE`, normalised so the lean loadout is
  exactly `PHYSICS_CONSTANTS.PLAYER_MASS`), so PhysicsSystem's impulse
  solver shoves a heavy ship less and lets it plow debris — a full
  outfit is ≈3× the lean mass.  `HULL_BASE` is 0 today — the seam for
  SHIP CLASSES, where a heavier hull starts the curve further along with
  no other code moving.  ADJACENCY REQUIREMENTS: an installed module
  FUNCTIONS only while it touches an ACTIVE module of its required
  family — engine⇢hull, thrusters⇢engine, shield/plating⇢hull,
  capacitor⇢shield, weapon-mods⇢gun; hull + guns are the roots, so a
  hull module is the prerequisite of the whole ship tree.  Activity is
  a fixpoint over `HEX_ADJACENCY` (`GameEngine.computeActiveSlots`);
  inactive modules contribute nothing and render dimmed/OFFLINE with
  the missing contact named.  `applyModuleEffects` sums ACTIVE effects
  into the player's stats.  Engine API: `moveModule(from, to)`
  (drydock-only EXCEPT pure inventory↔inventory reorders — rearranging
  cargo is legal anywhere; swap semantics; gun-count guard;
  inventory-full guard on uninstall) + `purchaseModule` (shop-station
  only, lands in inventory) + the `MODULE_RESALE` pair: `sellModule(idx)`
  (SELL-BACK at 90% of cost, inventory tiles only, needs to be DOCKED at
  any station — every station drydocks; cost-0 items rejected) and
  `scrapModule(idx)` (SCRAP at 9% from ANYWHERE on the map — the steep
  cut is the price of not flying to a station; also the only way to shed
  cost-0 items).  `EngineStats.outfitting` (slots +
  inventory + catalog; inventory items carry `sellValue`/`scrapValue`)
  drives the station UI: two hex flowers, the
  inventory tile grid, pointer-based DRAG-AND-DROP (touch + mouse; a
  <8px press falls through to tap-select), and the shop.  The PAUSE menu
  hosts the same widgets as a CARGO panel: READ-ONLY flowers (tap to
  inspect; no drag source / drop target — outfitting stays drydock-only)
  + the fully live inventory honeycomb (drag-reorder + tap → a detail
  strip with Scrap enabled and Sell disabled-until-docked).  The shared
  hex renderers (`renderHexGroup`/`renderInventoryHex`/
  `renderModuleDetail`/`renderDragGhost`/`renderShipStatus`) live at
  UIOverlay component
  scope, parameterised by context.  STAT LEGIBILITY (Phase 3 Pair A):
  `EngineStats.outfitting.statLines` carries the full derived-stat set
  (max hull / max shield / shield regen / damage / fire rate / top speed
  / acceleration / ship weight / charged shots) with PER-MODULE
  ATTRIBUTION, built by
  `GameEngine.statBreakdown()` from the SAME slot walk
  `applyModuleEffects` folds — the UI renders, it never recomputes, so
  the panel cannot disagree with the sim.  A contributor's `active`
  means "this amount is IN the total": false for an adjacency-OFFLINE
  module (`requires` names the family it must touch) AND for shield
  plating with no shield core (connected but with nothing to plate).  A
  contributor with no `area`/`idx` is a DERIVED row with no hex behind
  it — today the SHIP-WEIGHT drag factor, which is MULTIPLICATIVE over
  the ship's total weight and so belongs to no hex, and the FIRE-RATE
  line's "Resulting cooldown" row (same shape: per-module rows stay in
  the units modules are specified in — "−8% cooldown" — and the derived
  row carries the total the headline rate inverts, because rate is
  1/cooldown and does not sum additively).  The weighted
  modules instead file under the **Ship weight** stat line, so tapping a
  gun highlights Ship weight rather than Acceleration: a gun does not
  make the ship accelerate worse, it makes the ship HEAVIER, and weight
  is what drags thrust.  That indirection is the whole reason weight is
  modelled as a ship attribute.  The pause menu pairs it with a small CONDITION block — the readouts
  that MOVE in flight rather than derive from the outfit: hull and shield
  current-vs-max, the ship's weight, and the player's map + coordinates.
  (Hence "Max hull"/"Max shield" on the derived lines: the same word
  against two different numbers reads as a contradiction.)
  `renderShipStatus()` is
  shared verbatim by the pause menu and the docked station: rows expand
  to their contributors (`openStat`), and tapping a hex in either flower
  highlights every stat it feeds (the shared `selSlot`) while the detail
  strip lists that module's exact per-stat amounts.  Every hex button
  carries a stable `data-hex="<group>:<idx>"` (the interactive-only
  `data-tile` stays the drag drop-target hook).  Kind
  `'ship-part'` stays reserved schema; the two competing ship-design
  directions (ship catalog CHOSEN vs modular physical ship SUPERSEDED)
  are recorded in docs/PARKING_LOT.md.  The old leveling substrate
  (UPGRADE_DEFS / UNLOCK_DEFS / upgradeCost / upgradeLevels /
  unlockedWeapons) is DELETED.
- `STATION_CONSTANTS` / `STATION_VARIANTS` / `OVERWORLD_STATIONS` /
  `OVERWORLD_CONSTANTS` — the space-station POIs (size / `DOCK_RANGE` /
  placement `CLEARANCE` / `REPAIR_COST_PER_HP` — hull repair is
  pay-per-HP, PRO-RATED) and the wave-free Overworld's roaming-dragon
  respawn timers.  EVERY station has (at minimum) DRYDOCK functionality
  — dock anywhere and reconfigure the ship; hull repair rides along as
  part of drydock work.  FOUR stations with per-variant SERVICES
  (`StationServices`) on top of that baseline: HOME STATION at map
  center (drydock only — the future persistent state's player-created
  base), SHIPWRIGHT (+ ship-module shop), ARMORY (+ weapon-module
  shop), TRADE HUB (+ both shops).  Docking = proximity to the NEAREST
  in-range station + SELECTING YOUR SHIP (tap/click it) or the E key;
  docked = sim frozen (loop
  short-circuit); the docked UI shows only the panels the station's
  services offer.  Purchases land in the inventory and can be
  outfitted on the spot.
- `PORTAL_CONSTANTS` / `HUB_PORTAL_SITES` / `RETURN_PORTAL_OFFSET` — the
  map portals (roadmap step (k)): rift size / colours (violet out, sky
  home) / `USE_RANGE` / placement `CLEARANCE` / the `openPortal` transit
  burst.  `HUB_PORTAL_SITES` places one rift per full-game arena on the
  Overworld (targets are DESCRIPTOR IDS, and the map's existing
  clearance filter drops terrain seeded on top of them);
  `RETURN_PORTAL_OFFSET` places each arena's single return rift relative
  to its `playerSpawn`, inside the spawn safe zone those maps already
  clear.  `USE_RANGE` sits just under the station's `DOCK_RANGE` so the
  shared-E nearest-wins arbitration has a clear winner at the boundary.
  `INDICATOR_RANGE` gates the off-screen indicator: a portal is a FIXED
  landmark, so its arrow only appears once the player is within range,
  and inside that range it is PERSISTENT (exempt from the
  offscreen-only suppression) and labelled with the
  destination name.  The ARROW is green (the type legend, §8); the rift's
  own violet/sky colours still drive the world-space + minimap art.  Because the chevron is range-gated, the MINIMAP is
  how a portal gets found: `MINIMAP_CONSTANTS.PORTAL_BLIP` draws it as an
  ANOMALY — a spinning colour-filled diamond with an expanding radar
  ping — and, like an enemy blip, it CLAMPS to the minimap border when
  out of range instead of being culled the way other POI dots are.  The
  fill carries the portal colour, so an outbound rift (violet) and a
  return rift (sky) read differently at a glance.
  Showcase maps get NO portals — they stay debug-only.
- `SALVAGE_CONSTANTS` (the money economy: credits-per-drop conversion,
  drop colour, snitch-catch + wave-clear spray sizes — includes the
  income arithmetic
  behind the pricing), `DROP_CONFIG` (per-source salvage/health drop
  chances + magnet/lifetime), `HEALTH_DROP_INTERVAL`, `DROP_PULL`
  (mutual drop attraction + merge band, any same-type collectible)
- `PERF_CONTROLLER_CONSTANTS`, `PERF_TASKS` (per-task min/max
  interval, cost weight, auto curve; includes `rivalScan` — the
  cadenced rival target re-acquire + loot-vacuum, see §8),
  `LOCAL_MERGE_CONSTANTS` (local-density merge-rate boost; replaced
  the global entity-count merge-rate ladder)
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

Every map is named by a row in the **`MAP_DESCRIPTORS` registry**
(`engine/maps/MapDescriptors.ts`) — a THIN typed layer of stable string
ids over the MapType plumbing (roadmap step (k), strategy guardrail #3).
A descriptor carries exactly five fields, all with live consumers:
`id` (portal targets + `transitionToMap`), `name` (portal tag + entry
affordance), `mapType` (what `buildMap` instantiates), `kind`
(`'hub' | 'arena'` — `HUB_DESCRIPTOR` is where a run starts and where
every return portal leads), and `wavesEnabled` (handed straight to
`WaveSystem.init`; the engine's `wavesEnabled` getter reads it, so the
registry is the ONE source of truth for which maps run waves).
Descriptors WRAP the MapType keying — `PLAYER_MOVEMENT_CONFIG` and
`MAP_POPULATION` stay `Record<MapType, …>`.  Deliberately absent: any
procedural parameter, per-map persistent world state, or spawn table.
Destroyed tiles do NOT persist across re-entry.

Two families of maps live in `engine/maps/MapClasses.ts`, all subclasses
of `BaseMapLayer`:

- **Full-game maps** — `OverworldMap` (`OVERWORLD`), `UniverseMap`
  (`UNIVERSE`), `RingMap` (`RING`), `SevenRingsMap` (`SEVEN_RINGS`),
  `PocketMap` (`POCKET`). These mix
  asteroids, structures (multiple variants), and nebulae and are the
  ones a normal play session uses.  The **Overworld** is the WAVE-FREE
  home HUB (increment 1e): `WaveSystem.init(ctx, enabled=false)` — no
  waves, no snitch; population is the ambient systems (bubbles, score-
  cadence rivals, an engine-respawned roaming dragon) plus FOUR station
  POIs (HOME at center + SHIPWRIGHT + ARMORY + TRADE HUB at
  OVERWORLD_STATIONS offsets; cluster counts read from `MAP_POPULATION`
  — the authoritative pattern) and FOUR map PORTALS at
  `HUB_PORTAL_SITES`, one per arena.  Player spawns beside the home
  station, inside dock range.  The other four full-game maps are the
  portal-linked ARENAS: each calls `addReturnPortal()` at the end of its
  `init()` (after its spawn-clearance filter, so the rift isn't swept
  up) for the always-active way home.
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
`types.ts`, add a row to `MAP_DESCRIPTORS` in `MapDescriptors.ts`, add
the subclass in `MapClasses.ts`, switch on it in `GameEngine.buildMap()`,
add per-map config in `constants.ts` (`PLAYER_MOVEMENT_CONFIG`,
`MAP_POPULATION`), and add the button to `renderMapGroup` in
`UIOverlay.tsx` (which now renders inside the main menu's DEBUG dropdown
and the pause menu's Switch Map section — the front door offers no map
choice).  To make it portal-reachable as well, add a `HUB_PORTAL_SITES`
entry pointing at its descriptor id and call `this.addReturnPortal()` at
the end of its `init()` — showcase maps skip both and stay debug-only.

---

## 7. Build / run / deploy

- `npm install && npm run dev` — dev server on port 3000 (set in
  `vite.config.ts`).
- `npm run build` → `dist/`. Netlify uses this directly.
- `node scripts/inline-build.mjs` after a build → writes
  `omniverse-standalone.html`, a single-file portable build with CSS, JS,
  and referenced PNGs inlined as data URIs.
- **THREE validation gates, and all three are expected to be green
  before a commit** (roadmap 5b, decision #46a — this REPLACES the old
  "no test runner is configured; don't invent one" stance, which held
  until the repo went public and gained a collaborator with no session
  history):
  - `npm run build` — the bundle. Still the last-mile check.
  - `npm run typecheck` — `tsc --noEmit`. Note that **`vite build` does
    NOT type-check** (esbuild strips types without checking them), which
    is how six type errors accumulated unseen before 5b; the build being
    green says nothing about the types.
  - `npm test` — `playwright test`. The suites in `tests/` drive the
    REAL engine in a REAL browser through the `window.__omniEngine` /
    `window.__omniStats` debug handles; nothing is stubbed. The config's
    `webServer` block runs `npm run build` itself and previews the
    result, so `npm test` is one command from a clean clone — but it
    means the browser must be present: `npx playwright install chromium`
    once. See `tests/README.md` for the suite map and the harness rules.
- **The same three gates run in CI on EVERY pull request, and they are the
  LAST STEP BEFORE A MERGE** — `.github/workflows/pr-checks.yml`, job
  `validate`, in this order: typecheck → build → `npx playwright install
  --with-deps chromium` → test.  Running them locally is still expected
  (a red CI run is a slow way to learn something `npm run typecheck`
  would have told you in five seconds); CI is the backstop that makes
  green non-optional rather than remembered.  Rules that go with it:
  - **Do not merge a PR while `PR checks` is pending or red.**  The
    workflow is the merge gate; "it passed locally" does not substitute,
    because local runs skip the clean-clone `npm ci` and the CI browser.
  - It is deliberately SECRET-FREE, so unlike `pr-preview` it also runs
    on fork PRs.  Keep it that way — a merge gate that silently skips for
    outside contributors is not a gate.
  - It also runs on pushes to `main`, so a bad merge is visible
    immediately instead of at the next PR.
  - On failure the Playwright HTML report uploads as a run artifact
    (`playwright-report-<run id>`, 7-day retention) — read that before
    re-running, since the suites are timing-sensitive and the report
    carries the trace.
  - Making the check *blocking* at the GitHub level is a REPO SETTING,
    not a file in this tree: branch protection on `main` must list
    `typecheck · build · test` as a required status check.  The workflow
    alone reports; branch protection is what refuses the merge button.
- **Still no linter.**  Tiers 3–5 of the parking lot's "Automated test
  suite" entry (unit tests, Node sim tests, visual regression) remain
  parked deliberately; 5b adopted tiers 1–2, and tier 6 (CI gating) is
  now the workflow above.

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
- **The REFILL IDIOM (gauntlet 5c).**  `arr.length = 0` followed by
  `push` is NOT a free way to refill a per-frame list: setting the
  length down shrinks the backing store and the pushes re-grow it,
  allocating on every refill.  Index-fill instead and truncate only
  when the count actually shrank:
  `for (…) arr[n++] = x;  if (arr.length !== n) arr.length = n;`
  Measured 2.6× faster and 11× less heap churn over a 1300-element
  list, and this idiom was the single largest allocator in the engine
  before it was fixed (see `GameEngine.prepareFrameEntities`, which
  carries the canonical comment, plus `EntityIndex.rebuild`).  Same
  rule for per-frame closures: a function CONSTRUCTED inside a
  per-substep path is rebuilt 120×/s — hoist it to a method and pass
  its captures as parameters (`GameEngine.applyFlowTo`).
- **Spatial grid layout.** PhysicsSystem keeps a `staticGrid` (a `Map`,
  built once on map load) and two per-substep `CellBuckets` grids
  (`dynamicGrid`, `shardGrid`) — a FLAT ARRAY indexed by the dense cell
  index `cx * SPATIAL_ROWS + cy`, with pooled bucket arrays, so a
  steady-state field rebuilds them without allocating and every lookup
  is an array index rather than a hash (the 3×3 neighbour scan does
  nine per entity per substep).  All three are keyed on the same dense
  index, so they agree cell for cell.  Cell size is
  `SPATIAL_GRID_SIZE = 120`.  Static-vs-dynamic dispatch is
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
- **AI routing is a behavior-dispatch table.** `AISystem.update` routes each
  enemy through `ENEMY_BEHAVIOR[subtype].move` (a movement-strategy id) via the
  `moveStrategies` lookup map — NOT an `ENEMY_ROLE` if/else.  Adding a new
  behavior is a row in `ENEMY_BEHAVIOR` (constants) + a strategy fn in the
  `moveStrategies` table, not a growing switch.  The strategies today are
  the original `updateBasicDogfighter` (`'dogfighter'`), `updateSkirmisher`
  (`'skirmisher'`), `updateSwarm` (`'swarm'` — Stage 4; separation + jitter
  flock with a DBG-selectable base steer via `getActiveSwarmMove`: weave
  (serpentine — the default) / boids / vortex (orbit + dart) / burst (coast +
  telegraphed dash), cycled by the Player ▸ "Gnat move" DBG row), and
  `updateBubble` (`'bubble'` — Stage 5; passive flow-field drift / shard-chase
  while UNprovoked, floaty player-seek once `provoked`, skipped entirely while
  latched — receives the `shards` list so it can target food); the
  per-subtype quirks (Drone jitter,
  Orbiter true-orbit, Sniper lock, Turret no-move) still live INSIDE those
  routines.  Strategies receive the filtered `enemies` list (so a flock can scan
  neighbours) AND the `shards` list (so the bubble can target food).  `ENEMY_ROLE`
  is still the RAMMING/SHOOTING category used by pack-sync + wave-building.
- **Stationary enemies use the no-move guard.** `AISystem.updateSkirmisher`
  branches on `config.maxSpeed === 0` (Turret): it applies no thrust, bleeds
  residual velocity, and skips the speed cap, but still runs the
  rotate-to-aim + telegraph block.  (A sub-behavior of the skirmisher
  strategy, not its own table entry.)
- **Wave completion honors `countsTowardWave`.** `WaveSystem.countLiveTracked`
  (which gates both completion AND the spawn-stream concurrency cap) skips
  tracked enemies with `countsTowardWave === false` — entities spawned by other
  entities / that replicate (nest brood) and the AMBIENT bubble fauna (every
  bubble, via the `ambient` variant flag → `buildEnemy` forces the flag false
  however it spawns).  A wave ends when the COUNTED enemies are dead; uncounted
  brood / bubbles carry over.  Non-enemy roamers (Snitch, future dragon) are
  `EntityType.INTERACTABLE` and never enter `waveEnemyIds`, so they never gate a
  wave; the bubble stays `EntityType.ENEMY` (it takes damage / attacks / eats —
  all the enemy machinery) but opts out of wave accounting via the flag.  Every
  WAVE enemy leaves the flag unset (counts).
- **Homing is owner-aware.** `ProjectileSystem.updateHoming` steers
  PLAYER-owned homing shots toward the nearest enemy (acquire range) and
  ENEMY-owned homing missiles (Turret) toward the player (no range gate) —
  so it takes the player entity as an argument.
- **Drop types currently shipped: `'salvage'` and `'health'`** (collected
  by the player; weapons-ammo pivot — salvage replaced ammo in EVERY
  drop source in 1a, and 1b deleted the ammo system entirely).  Both
  are collectible drops with the SAME physics — finite
  mass, scatter off the kill, asteroid-flow drift, player magnetisation,
  and same-type merge — and both are kept OUT of the dynamic collision grid,
  so projectiles/ships pass through them and they can't be shot or destroyed;
  collection is purely the GameEngine magnet/proximity scan. The
  "collectible" rule is centralized: `DROP_TYPES` (constants) is the
  per-drop-type registry and `isCollectibleDrop(e)` is the single predicate
  the cross-cutting sites (grid skip, flow-drift, merge) call — so a new drop
  type is one registry row + its effect/render, not a hunt across systems.
  `'glass'` is a `dropType` value used internally for
  shattered structure visuals.  There is no fuel, gold-pickup, or
  mid-wave-powerup drop entity in code today, even though `gold` is
  initialized on the player and `dropComposition` can in principle hold
  more variants.
- **Salvage is the money.** Collecting a salvage drop is the ONLY way to
  earn `GameEngine.credits` — the old `awardScore` 1:1 score→Salvage
  mirror is REMOVED (score stays the pure performance metric).  Each
  collected unit pays `SALVAGE_CONSTANTS.CREDITS_PER_DROP` (conversion
  happens once at collection; `dropValue` counts units so merges stay
  value-conserving).  Both drop paths credit through
  `GameEngine.earnCredits()`, which also feeds the run summary's
  "Salvage earned" counter — resale (sell/scrap) and the DBG grant
  deliberately do NOT, since a refund of money already earned would
  double-count.  Pickup feedback: `player.salvagePickupFlash`
  (accumulating "+N credits" window)
  → `EngineStats.salvageFlash` → the in-game HUD Salvage chip (silver,
  under the score chip in `UIOverlay`; credits are on `EngineStats` every
  frame, not just while paused).  Salvage renders as a silver scrap-glint
  chunk (steel core, white glint rim) — deliberately NOT gold, because
  gold "+N" popups mean score, which no longer pays money.  The rival
  loot-vacuum steals salvage via the generic `isCollectibleDrop` path —
  rivals literally steal money.  The snitch catch sprays
  `SALVAGE_CONSTANTS.SNITCH_CATCH_DROPS` salvage on top of its score
  payout.
- **Health drops mirror the salvage economy.** `spawnEnemyShards` rolls a
  health drop INDEPENDENTLY at the same two chances as each salvage slot, so
  enemy-kill pickups roughly double and split ~50/50 salvage/health (added
  because the expanded roster hits harder). Each heals
  `DROP_CONFIG.HEALTH_PER_ENEMY` (merges sum it); the wave-clear milestone
  drop still heals `HEALTH_HEAL_AMOUNT`. Health drops render as a red
  circle shard (`generateShardPolygon('health')` is a 16-gon; RenderSystem
  drop-shard branch tints it red) — the old static glowing heart is gone.
  Drops (salvage + health) are excluded from the minimap to avoid clutter.
- **Salvage drops carry value 1 and merge.** `DropSystem.spawnSalvageDrop`
  always spawns value = 1 (no per-source amount). Nearby drops
  mutually attract, damp, and fuse via `mergeDrops` (any same-type
  collectible, salvage↔salvage / health↔health;
  `DROP_PULL`), conserving total value — a wave-kill cluster
  collapses into one fatter pickup. Non-magnetised drops also
  drift with the asteroid flow field.
- **Periodic passes route through PerfController.** Any new skippable
  per-frame work (scans, cosmetic ticks, O(N²) passes) must register
  a task in `PERF_TASKS` and gate on `perfController.shouldRun(id)` —
  do NOT roll a private frame-counter or AUTO interval table. The
  controller samples load per sim step, applies tier hysteresis, and
  staggers task phases so skipped work doesn't bunch up.  The exotic
  roamers follow this: `updateRivals` gates its `O(rivals×enemies)`
  target re-acquire + `O(rivals×drops)` loot vacuum on the `rivalScan`
  task (min interval 1 → identical at low load), CACHING the chosen
  target on `RivalInstance.target` and recomputing only the O(1)
  distance to it every step for steering/firing.  `updateConsumers`
  (bubble/dragon eating) uses the `consume` task.  Cosmetic gradient
  builds for the heavy render paths are cached ON THE ENTITY, keyed
  like `enemyBodyGrad`: the geometric Dragon head caches its skull +
  plasma-maw gradients (`dragonSkullGrad`/`dragonMawGrad`, invalidated
  on size/colour/flash/provoked; the per-frame energy pulse rides
  `globalAlpha` instead of the colour stops), and the Bubble membrane
  caches its fill gradient (`bubbleFillGrad`, keyed on radius/colour/
  visibility).  `updateAttachments` resolves latch targets through the
  player special-case + the small enemies index, never a full
  master-list scan.
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
  enemies, salvage-drop roll via `NebulaSystem.handleDeath()` for nebula
  variants.  Drops are spawned by `spawnDrops(entity)` for shard-
  family STRUCTURE entities (and only when `suppressDrops` is unset
  and the variant isn't a nebula).
- **Shield absorption is generalized.** The PhysicsSystem projectile-
  damage path (and the GameEngine shockwave-AoE path) absorb into
  `shield` for ANY entity with `shield`/`maxShield` > 0 — not just the
  player.  This is what makes the Bulwark's shield soak hits; the
  shield-recharge tick in `updatePhysics` was already entity-agnostic.
  A DIRECTIONAL arc shield (`shieldArcHalfWidth` set) only absorbs hits
  whose bearing falls in the covered sector — gated by the shot's TRAVEL
  direction, not its position, so a fast bolt that overshoots can't tunnel
  past (`PhysicsSystem.shieldCoversHit`, toroidal).  A covered hostile shot
  is DEFLECTED off the ring (`tryArcShieldIntercept`, broadphase reach
  extended via `arcShieldReach`): its velocity reflects about the radial
  normal and the shield drains by the shot's damage, so the bolt ricochets
  away (and can hit other enemies) while the shield still wears down.
  Open-side shots — and shots bigger than the remaining shield — fall
  through to the normal body hit.  AISystem slews `shieldArcAngle` toward the player at up to
  `shieldArcSpin` rad/s, so the shield tries to face the threat but a fast
  flank gets behind it — the Bulwark's soft counter.
- **Stage-3 reusable mechanics (all three now wired by the Stage-5 BUBBLE).**
  Three build-once primitives for the exotic enemies:
  (3a) **Provoked-on-hit** — the PhysicsSystem projectile path + the AoE
  ring stamp `entity.provoked = true` on any ENEMY they damage; the BUBBLE
  reads this sticky flag to flip from passive to hostile.  A `thirdParty` entity
  (the bubble) ALSO records WHO hit it (`aggroTargetId = proj.ownerId` / the AoE
  ring's `ownerId`) and can be damaged by ANY owner — the PhysicsSystem
  friendly-fire filter (`ENEMY + ownerType ENEMY`) is bypassed for `thirdParty`
  targets, so enemy fire hits it and it retaliates against the attacker (player
  or enemy), a genuine third party.  Projectiles carry `ownerId` (the firing
  entity's id, `'player'` for the player) for exactly this.
  (3b) **Consume-and-grow** — `GameEngine.updateConsumers` (PerfController
  `consume` task) grows an entity carrying a `consume` ConsumeConfig by
  eating nearby shards (`eats:'shard'` — the bubble) or tiles (`eats:'tile'`,
  routed through the tile-destroy + flow-field patch — the future dragon),
  capped at `maxSize`.  Two-phase feeding inside the SENSE radius (`cfg.range`):
  mobile candidates are PULLED inward (`cfg.pull` tug) and only SWALLOWED on
  MEMBRANE CONTACT (radii overlap) — `consumeEntity` then sprays an inward
  shard-colour implosion + a membrane feed-bulge (`bubbleFeedTimer`), so shards
  stream in and pop on contact instead of vanishing from afar.  Shards (bubble)
  are then DIGESTED over `BUBBLE_CONSTANTS.DIGEST_DURATION` (`beginDigest` →
  ticked in `updateBubbles` → `growConsumer`): the shard is swallowed
  (deactivated, its look snapshotted onto `bubbleDigest*`) and RenderSystem draws
  a shrinking ghost of it INSIDE the transparent membrane, one meal at a time.
  This mirrors the LATCH (a held target processed over a timer); the bubble just
  can't engulf the too-big player/enemy, so that path clings to the hull
  (squash-cling render + EMP-arc crackle on the player) and drains instead.
  Tiles (the future dragon) are eaten instantly (`consumeTile`).  The entity-COUNT
  cap for self-replication is a live-subtype census at the child-spawn site
  (`updateBubbles` for the bubble, `updateNests` for nest brood — both
  pattern-match `enforceTypeCap`).
  (3c) **Attach + disable** — `GameEntity.attachedToId` snaps an entity onto
  its target each frame (`updateAttachments`, over the enemies index); the
  `'disable'` status effect EMPs the target (see the status-framework note).
  The bubble uses both (latch onto player + EMP).  All three are exercised by
  Stage 4/5 (swarm/nest/bubble); the dragon (Stage 6) will reuse 3b for tiles.
- **Kamikaze detonation.** A KAMIKAZE detonates the INSTANT it touches the
  player: the PhysicsSystem contact path deals contact damage, sets
  `detonateOnDeath`, and routes the death immediately, so
  `GameEngine.handleEntityDeath` detonates.  The PLAYER is hit DIRECTLY
  (`applyKamikazeBlastToPlayer`: shield-respecting damage + a launch via the
  `overSpeedAllow` cap-overshoot) so the shove lands instantly at the contact
  point; the ENEMY-owned AoE shockwave (player excluded) only sweeps
  collateral onto nearby enemies/structures + the normal death-explosion.
  Bombers killed before they touch the player never set the flag, so they pop
  harmlessly — the kill-early counter.
- **Nebula tile regen is off by default.** `NEBULA_CONSTANTS
  .TILE_REGEN_ENABLED` is `false`; shattered nebula tiles do not respawn
  on a timer. New tiles only appear via shard→tile transmutation when
  shards merge past the area threshold.
- **The station POI is a non-drop INTERACTABLE.** Like the snitch:
  `EntityType.INTERACTABLE` + no `dropType` means the physics broadphase
  skips every pair it's in; `mass: Infinity` + INTERACTABLE keeps it out
  of the static grid too, and the flow-field obstacle bake only reads
  STRUCTUREs — so the station is pure scenery + a dock zone with zero
  collision/flow side effects.  The existing POI paths give it a minimap
  dot, an off-screen chevron, and `handleAsteroidRespawn` avoidance for
  free.  Docking state lives on `GameEngine` (`stations` /
  `nearestStation` / `dockedStation` / `dockedAtStation` /
  `dockInRange`); commerce methods gate on the docked station's
  SERVICES (`moveModule` needs a drydock, `purchaseModule` the matching
  shop, `repairHull` the repair service — all REJECT while undocked),
  and `pauseGame()` is a no-op while docked (one full-screen overlay at
  a time).
- **The map portal POI follows the station's recipe exactly** (roadmap
  step (k)).  `EntityType.INTERACTABLE` + no `dropType` + `mass:
  Infinity` → broadphase, static grid, and flow-field obstacle bake all
  skip it; minimap dot, off-screen chevron, and `handleAsteroidRespawn`
  avoidance come free from the same POI paths.  A NEW portal type is a
  descriptor row + a placement entry, never a new entity category.
  Portal state lives on `GameEngine` (`portals` / `nearestPortal`),
  cached in `loadMap` beside `stations`.  Two rules to keep:
  (1) **Destinations are descriptor IDS, not MapType values** —
  `portalTargetId` is what the future overworld phase will reuse.
  (2) **Stations and portals share ONE trigger** — selecting the player's
  own ship (tap/click, `INPUT_CONSTANTS.SHIP_SELECT_RADIUS`), plus E as
  the keyboard equivalent — so any new proximity-interactable must join
  `updateInteractables`' nearest-wins arbitration rather than adding a
  second handler; otherwise two affordances fight over one gesture.  The
  ship-select tap is CLAIMED from the fire queue before the weapon tick
  drains it (sim step 5b runs ahead of step 7), which is why using a
  portal doesn't also fire a shot.  There is NO HUD dock/enter button —
  the ship prompt is the whole affordance (a pill on top of it was
  redundant), so `UIOverlay` has no `onDock`/`onEnterPortal` prop.  A CONTROLLER button is the third
  intended path and is deliberately NOT wired here — Pair C (c2) owns the
  gamepad layer in InputSystem; OR its button into the `selected` flag
  when it lands.  The prompt naming the control is drawn AT the ship
  (`GameEntity.interactPrompt`, stamped per step, rendered via
  `RenderSystem.worldToScreen`) and echoed in the HUD pill.  The idle rift is pure render-side
  animation (zero particle cost); `openPortal` only fires on an actual
  transit.
- **The debug menu lives in the pause Player Menu** ("Debug Menu"
  collapsible section) — the old floating top-left DBG button/panel is
  gone.  The 'Overlays' row inside is the old master toggle (renderer
  debug overlays only).  DBG **Weapons** rows (grant + equip per weapon,
  `debugGrantWeapon`) are the wave-map test path for weapons now that
  commerce is station-only; `EngineStats.weaponCatalog` (paused-only)
  feeds them.  DBG **Bosses** rows (`debugSpawnBoss`) warp a capstone in
  with its full phase table, each click stacking another (the Dragon-menu
  pattern).
- **Sound goes through one id, and the id is the contract.**  Every
  trigger site calls `audio.play('<inventory id>')` (or
  `audio.loop(id, on, …)` for sustained sounds) and nothing else.
  `docs/SFX_INVENTORY.md` is the source of truth for WHAT plays and with
  what parameters — trigger site, mix tier, duration, sonic character,
  frequency + envelope, variation, polyphony + throttle, mix level,
  positional vs UI-flat.  `SfxRegistry` holds the procedural draft for
  each id; replacing a draft with a recorded asset is a registry change
  and NEVER a call-site change.  A headless smoke parses the document
  and asserts registry↔document parity in BOTH directions, so adding a
  sound means adding its row first.  Systems that need to make a sound
  expose ONE generic sink (`PhysicsSystem.sfx`, `ShardSystem.sfx`,
  `DropSystem.sfx`, `WeaponSystem.onEnemyFire`) assigned once in the
  GameEngine constructor — the same settable-field style as
  `setPhysics` / `traitsEnabled` — so no system imports audio state and
  adding a sound is a call rather than a signature change.  The engine
  modules extracted in gauntlet 5f (`engine/roamers/*`, `engine/bosses.ts`,
  `engine/explosions.ts`) need no sink at all: they are free functions
  taking `g: GameEngine`, so a voice there is `g.audio.play(id, …)` — the
  roamer/boss/AoE cues live beside the behaviour that causes them rather
  than being routed back through the orchestrator.
- **Audio is EVENT-DRIVEN; nothing audio-related runs per frame** except
  `audio.setListener(camera)` and `audio.setActive(...)`, two number
  writes and a boolean.  Voice lifetimes come from the duration each
  synth returns and are pruned lazily inside `play()` — no timers, no
  `onended` handlers.  Measured: `play()` costs ~0.3 µs, and a heavy
  mass-death scene shows no frame-time difference between muted and
  unmuted.  Three mechanisms keep a 400-death frame sane: per-id
  polyphony caps, a per-id retrigger window that COLLAPSES simultaneous
  triggers while bumping the survivor's gain (so bulk reads as HEAVIER,
  not thinner or louder), and a global ceiling that thins tier 3 then
  tier 2 — tier 1 always plays.  Positional pan and attenuation use
  `wrapDeltaX`/`wrapDeltaY` (listener-first: `wrapDeltaX(from, to)`
  returns `to - from`, so source-first inverts the stereo image).
  A FROZEN SIM (paused / docked / menu) silences the WORLD — loops and
  positional one-shots — but deliberately NOT flat/UI sounds, because
  the station and pause screens are exactly where docking cues,
  purchases and menu clicks have to be heard.  The AudioContext is
  created on the FIRST USER GESTURE (AudioSystem arms its own
  capture-phase window listeners rather than hooking InputSystem, which
  only sees canvas-targeted events and so misses the menu tap that is
  usually a phone session's first gesture).  Master volume + mute are
  IN-MEMORY only, consistent with the project keeping no state across
  reloads.
- **Material chatter lives BELOW ~2 kHz, and Q matters as much as pitch.**
  Sounds that fire in BULK (tile chips, shard breaks, tile snaps, merges)
  are judged by what a hundred of them sound like, not one — up in the
  fatiguing band a hundred is a whine however quiet each is.  A HIGH-Q
  bandpass on noise rings, and ringing is what reads as whining, so
  lowering Q turns the same filter into a knock.  Materials keep their
  relative ORDER (glass brightest → metal → rock dullest) so they stay
  tellable apart.  A headless smoke renders every material voice through
  an OfflineAudioContext and asserts a dominant-frequency proxy stays
  under the band AND that the ordering survives — so this is a guarded
  invariant, not a one-off tuning.
- **Sustained loops are judged far more harshly than one-shots, and the
  POI beds are voiced APART.**  Every "whine" reported in playtest was a
  LOOP or a bulk-fired chip, never a single event.  So every loop is low:
  `portal.idle` is a TONAL 55 Hz beat, `poi.station.idle` a BROADBAND
  ~300 Hz noise bed, `move.thrust` a 36 Hz rumble.  Portal and station are
  deliberately opposite in CHARACTER (tonal vs broadband) rather than just
  different in pitch, so the two POIs are tellable apart without looking;
  a headless smoke measures both the dominant frequency and the
  zero-crossing regularity to hold that.  Both are driven by the NEAREST
  POI of their kind at ANY distance so volume swells on approach, and
  `AudioSystem.loop` treats an out-of-earshot positional loop as OFF so a
  far POI holds no oscillators.
- **Player contact is split by WHAT was hit, at two different speeds.**
  `crash.player.tile` (static wall) fires above
  `STRUCTURE_CONSTANTS.CRASH_VELOCITY_THRESHOLD`; `crash.player.shard`
  (mobile shard) fires above the much lower `SHARD_CONTACT_SPEED`,
  because a loose rock knocking off the hull is audible long before it is
  destructive — sharing one voice at the break threshold made ordinary
  shard bumping SILENT and hard shard hits sound like masonry.  The shard
  voice is pitched by the shard's SIZE and gained by impact speed at the
  call site (`PhysicsSystem.sfx` takes `{gain, pitch}`), so one id spans
  pebble-tap to boulder-slam.
- **Ambient shard chatter is NEAR-FIELD; the player's own shards are not.**
  A dense field collides/merges/snaps constantly, so `destroy.shard.*`,
  `move.tilesnap`, `move.merge` and `crash.shard.tile` carry only to
  `AUDIO_CONSTANTS.SHARD_FAR_RADIUS` instead of the normal `FAR_RADIUS`.
  The exception is the point: a shard destroyed BY the player is played at
  the NORMAL radius, keyed off the `killedByPlayer` stamp that already
  exists for scoring (set by the projectile / crash / lightning / AoE
  paths) — so a shard you shot from range is still yours to hear.  Direct
  player↔shard contact is covered by `crash.player.tile` at full range,
  because mobile shards are `STRUCTURE`s.  Radii resolve caller → def →
  global default (`SfxDef.near`/`.far`, `play(id, {near, far})`).
- **The engine loop IDLES; it does not switch on and off.**
  `move.thrust` runs continuously while the player is alive and THROTTLE
  MODULATES it (gain and filter cutoff together, both heavily smoothed) —
  gating the loop on `throttle > 0` snapped the whole bed on and off with
  the input and read as jarring.  It stops only on death, pause and dock.
- **iOS needs three things desktop does not.**  (1) The ring/silent switch
  silences WebAudio, because Safari puts it in the "ambient" session by
  default — the game claims the `playback` session instead, via
  `navigator.audioSession` on 16.4+ and, on older iOS, by playing a
  detached-proof silent WAV data URI from an in-document
  `<audio playsinline>` element (a data URI, so the standalone build is
  still asset-free; it MUST be appended to the document or iOS ignores it).
  (2) iOS uses a non-standard `'interrupted'` AudioContext state after a
  call / Siri / app switch, so `unlock()` resumes on anything that is not
  `'running'`, never on `'suspended'` alone.  (3) The gesture listeners are
  NOT `once` — an interruption after the first gesture would otherwise
  leave the game permanently silent — and `visibilitychange` re-unlocks on
  tab return.  `audio.audible` (context exists AND running) is the honest
  "can this be heard" check; `unlocked` alone is not.
- **`window.__omniEngine` / `window.__omniStats` are debug handles.**
  `App.tsx` assigns the live engine and the latest `EngineStats` payload to
  `window`.  NOTHING in the game reads them — they exist so the headless
  Playwright suites in `tests/` can drive the real engine in a real browser
  (§7; the "without a test runner being added" rationale is superseded —
  roadmap 5b adopted one, and these handles are what it drives).  Two
  assignments, no per-frame cost beyond the stats one already happening.
  Note that `private` is compile-time only: at runtime a suite can read
  engine internals (`runTimeSec`, `waves.waveOffset`) and call private
  methods (`physics.resolveCollision`) straight off the handle.  That is
  intended, and is what lets a test measure damage arithmetic in situ
  instead of reimplementing it.
- **The player is NOT in `currentMap.entities`.** It is appended to
  `frameEntities` each step instead.  So the shockwave ring
  (`spawnShockwave` / `updateExplosionRings`, both of which walk
  `currentMap.entities`) can never reach the player: every ENEMY-owned AoE
  that should hurt the player routes through `applyBlastToPlayer(pos,
  radius, damage, knockback)` — a direct, shield-respecting blast with
  distance falloff.  The kamikaze detonation and the (h) Bastion's siege
  shells are its two callers.  Landing it at the impact point also makes
  the shove instant instead of gated on the ring's wavefront arriving.
- **`modulePrice` is the ONE pricing seam.**  It is identity today (the
  boss shop-discount that used to live there was removed — the capstone
  drops a module instead), but `purchaseModule` and `resaleValue` (sell +
  scrap) both still route through it.  Any future price modifier must
  join it rather than add a second path: when buying was discounted and
  sell-back was not, buy-then-sell netted `discount - (1 - SELL_FRACTION)`
  of cost per cycle — an infinite money pump above a 10% discount.
- **Off-screen indicators are EDGE-anchored, size-coded and typed.**
  `RenderSystem.renderIndicators` draws one arrow glyph per contact on an
  INSET VIEWPORT RECT (`UI_CONSTANTS.INDICATORS.EDGE_INSET`) — the screen
  edge, not the old fixed 120px centre ring.  DISTANCE is carried by SIZE
  (`SIZE_NEAR`→`SIZE_FAR` ramped over `NEAR_DIST`→`FAR_DIST`), which is why
  ordinary enemies no longer print a distance number: a dozen little
  "1234m" strings were most of the old clutter, and the glyph already says
  it.  POIs keep the far-only readout; portals and bosses keep their
  self-labels (an unlabelled arrow is ambiguous the moment a second one is
  on the edge), and label LINES stack vertically — stacking them radially
  puts line 2 on top of line 1 at a near-horizontal bearing.
  COLOUR IS BY TYPE, never `entity.color` (`INDICATORS.COLORS`): red enemy
  / indigo station / green portal / yellow rival / purple bubble, plus
  slate for any other POI.  A rival or a bubble is only CONDITIONALLY
  hostile, so those two cross-fade to red on `AGGRO_BLINK_HZ` while
  hunting the PLAYER specifically — the bubble reads `provoked &&
  aggroTargetId === 'player'`, the rival reads `GameEntity.huntingPlayer`
  (a mirror of the `RivalInstance.disposition` logic stamped by
  `updateRivals`, since disposition lives on the instance, not the hull).
  Budgets are per type (`MAX_VISIBLE` / `MAX_VISIBLE_ENEMY` /
  `MAX_VISIBLE_BUBBLE`, portals with their own) and the buffer is sorted
  NEAREST-FIRST so a budget keeps the closest contacts.  Bubbles ARE
  indicated now (they used to be excluded as clutter) — the small separate
  budget is what keeps a bloom of fauna from starving the enemy arrows.
  Gnats (`diesOnContact`) stay excluded; the minimap still shows them.

- **Wave banners FIT the viewport, they don't assume it.**  Banner text is
  authored content — boss names, phase announcements, reward labels — so its
  width isn't known at design time, and the game is played on a 390px-wide
  phone where "WARDEN DESTROYED" at the 48px design size measures ~460px and
  clips off BOTH edges.  `RenderSystem.fitFontPx` shrinks a line until it
  measures inside `width - WAVE_ANNOUNCE_CONSTANTS.SIDE_MARGIN × 2`, floored
  at the `*_MIN_PX` readability floor; monospace advance width is linear in
  font size, so it's ONE `measureText`, not a binary search in a draw path.
  Any new canvas string built from authored/variable content should go
  through it rather than hardcoding a px size.
- **Every full-screen overlay shares ONE scrim, and it is TRANSLUCENT.**
  `UIOverlay`'s module-scope `OVERLAY_SCRIM` (`bg-slate-950/55` +
  `backdrop-blur-[3px]`) is used by all five — main menu, pause, station,
  death, stage-clear — so the game never has two ideas of how much world
  shows through (user call: menus keep displaying the dynamic map).  Two
  things about it are load-bearing rather than taste: the ALPHA is a
  legibility floor (the map behind is arbitrary bright colour under
  arbitrary text), and the BLUR is deliberately tiny — a heavy
  `backdrop-blur` is the usual way to buy legibility but it turns motion
  into a smear, which is the exact thing the transparency exists to show.
  It is NOT coupled to whether the sim is running: the pause menu freezes
  the world and still shows it.  Dense information panels that must stay
  readable regardless of what is behind them use `PANEL_OPAQUE` instead
  (today: the debug menu) — a panel ON the scrim, not more transparency
  stacked on transparency.  And because the scrim no longer hides what is
  under it, the DOM HUD is gated off while any overlay is up
  (`overlayUp`): a score chip ghosting through a run summary reads as
  double-vision, not depth.  The canvas-drawn minimap and loadout strip
  stay — those are the game view, which is the point.
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
- Three GitHub Actions: `pr-checks.yml` (the merge gate — typecheck +
  build + Playwright on every PR and on pushes to `main`),
  `pr-preview.yml` (Netlify deploy previews),
  `publish-standalone.yml` (releases the single-file standalone build).
- **`PR checks` is the default gate on every PR and the final step before
  a merge.**  Run the same three commands locally first (`npm run
  typecheck`, `npm run build`, `npm test` — §7); merge only once the CI
  run on the PR's CURRENT head is green.  Never merge past a pending or
  failing `typecheck · build · test`.  The other two workflows still gate
  nothing — a preview build or a standalone release is not validation.

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
