/** THE DEBUG MENU — every toggle and cycle behind pause ▸ Debug Menu.
 *
 *  Extracted from `GameEngine` in gauntlet 5f (see
 *  `docs/GAUNTLET_5F_LOG.md`).  Sixty small methods, none of them gameplay:
 *  they flip a flag, mirror it onto a system, or step a cycle table in
 *  `constants.ts`.  They were the first 714 lines of `GameEngine.ts` — a
 *  reader opening the engine met the whole debug panel before reaching the
 *  constructor, which is the single worst thing about that file's shape.
 *
 *  Unlike the other 5f extractions this one is a CLASS rather than free
 *  functions, because these are called from the UI, not from the engine:
 *  `engine.dbg.toggleCollisions()` reads at the call site, where sixty
 *  imported free functions in `App.tsx` would not.  It is a plain concrete
 *  class with one back-reference and one instance — no interface, no
 *  dispatch, nothing to route through.
 *
 *  `toggleTraits` deliberately stayed on `GameEngine`: the 5b trait suites
 *  call it straight off `window.__omniEngine`, which makes it observable
 *  surface (see the P7 entry in the ledger for how that rule was learned).
 *
 *  STATE STAYS ON THE ENGINE.  Only the methods moved; every flag they set
 *  (`ffPattern`, `collisionsEnabled`, `trailShape`, …) is still a
 *  `GameEngine` field, because the sim reads those every frame and they are
 *  engine state that a debug row happens to write.
 */
import type { GameEngine } from './GameEngine';
import { TrailShape, TrailEmitMode, MapType } from '../types';
import {
    NEBULA_CONSTANTS, SHARD_PAIR_CONSTANTS, SHARD_TILE_PAIR_CONSTANTS,
    STRUCTURE_CONSTANTS, LOCAL_MERGE_CONSTANTS, PERF_CONTROLLER_CONSTANTS,
    cyclePlasticPalette, cyclePlasticShardPalette, cyclePlasticGlowBrightness,
    cycleNebulaPalette, cycleNebulaStretch, togglePlasticAutomataBrighten,
    cyclePlayerThrust, cyclePlayerSpeed, cycleSnitchSpeed, cycleEnemyScale,
    cycleSwarmMove, cycleSubstepCap, cycleHudRate, cycleSimRate, getSimDt,
    cycleMinimapMaterial, cycleRockPalette, cycleLightingMode, cycleLightingTier,
    toggleShardShadows, cycleShadowSoftness, toggleRefraction, cycleRefractBrightness,
    cycleLightBrightness, toggleEmissive,
    cycleShatterGrace, randomPlasticShade, randomPlasticShardShade,
} from '../constants';
import { FlowPattern, samplePattern } from './systems/FlowField';
import { FlowFieldGrid } from './systems/FlowFieldGrid';

/** DBG-only cycle tables.  They lived as private statics on `GameEngine`;
 *  nothing but the cycle methods below ever read them, so they came here
 *  with the methods.  The VALUES they step (`g.ffCellSize`, `g.ffPattern`,
 *  …) are still engine fields — the sim reads those every frame. */
const FF_SAMPLE_N_CYCLE: readonly number[] = [1, 2, 4, 8, 16] as const;
const FF_DENSITY_CYCLE: readonly number[] =
    [256, 192, 128, 96, 64, 48, 32] as const;
const FF_KERNEL_R_CYCLE: readonly number[] =
    [0, 1, 2, 3, 4, 5] as const;
const FF_TANGENT_MIX_CYCLE: readonly number[] =
    [0.0, 0.25, 0.5, 0.75, 1.0] as const;
const FF_BREATHE_RATE_CYCLE: readonly number[] =
    [0, 0.15, 0.4, 0.9] as const;
const FF_LANE_JITTER_CYCLE: readonly number[] =
    [0, 0.1, 0.2, 0.35] as const;
const FF_PATTERN_CYCLE: readonly FlowPattern[] = [
    FlowPattern.DEFAULT,
    FlowPattern.MEANDER,
    FlowPattern.CIRCULAR,
    FlowPattern.SPIRAL,
    FlowPattern.GRAVITY_WELL,
    FlowPattern.WAVY_GRAVITY_WELL,
    FlowPattern.OUTWARD,
    FlowPattern.HORIZONTAL,
    FlowPattern.VERTICAL,
    FlowPattern.WAVY_HORIZONTAL,
    FlowPattern.WAVY_VERTICAL,
];

export class DebugControls {
  constructor(private g: GameEngine) {}

  toggleDebug() {
    this.g.debugMode = !this.g.debugMode;
    this.g.renderer.setDebugMode(this.g.debugMode);
  }

  /**
   * Cycle through player-trail shapes: CIRCLE → SQUARE → TRIANGLE → LINE
   * → NONE → CIRCLE.  Forwards the new shape to the renderer; existing
   * trail points keep their stored emit-time angle, so a shape change is
   * an instant visual swap with no respawn needed.
   */
  cycleTrailShape() {
    const order = [TrailShape.CIRCLE, TrailShape.SQUARE, TrailShape.TRIANGLE, TrailShape.LINE, TrailShape.PATH, TrailShape.DOTS, TrailShape.NONE];
    const i = order.indexOf(this.g.trailShape);
    this.g.trailShape = order[(i + 1) % order.length];
    this.g.renderer.setTrailShape(this.g.trailShape);
  }

  /**
   * Toggle the player-trail direction mode between THRUST and VELOCITY.
   * Both modes emit only while throttle > 0.  VELOCITY (default) places
   * trail points at player.position so the trail extends opposite to
   * velocity as the ship moves; THRUST accumulates an offset in the
   * -input direction each emit so the trail extends opposite to thrust
   * regardless of velocity.  Resets the per-thrust-event offset so the
   * new mode starts cleanly at the ship.
   */
  cycleTrailEmitMode() {
    this.g.trailEmitMode = this.g.trailEmitMode === TrailEmitMode.THRUST
      ? TrailEmitMode.VELOCITY
      : TrailEmitMode.THRUST;
  }

  /**
   * Toggle the player↔asteroid local-gravity scan on/off.  When off,
   * `PhysicsSystem.applyLocalGravity` is skipped entirely and the
   * `lgrv` perf timer should drop to zero.
   */
  toggleLocalGravity() {
    this.g.localGravityEnabled = !this.g.localGravityEnabled;
    this.g.physics.localGravityEnabled = this.g.localGravityEnabled;
  }

  /**
   * Toggle the attractor gravity pass on/off.  When off,
   * `PhysicsSystem.applyGravity` is skipped entirely and the
   * `grav` perf timer should drop to zero.  Used to measure the
   * cost of the full-master-list outer loop in isolation.
   */
  toggleAttractorGravity() {
    this.g.attractorGravityEnabled = !this.g.attractorGravityEnabled;
    this.g.physics.attractorGravityEnabled = this.g.attractorGravityEnabled;
  }

  /**
   * Toggle the SAT collision broadphase on/off.  Off mode is
   * game-breaking (projectiles fly through, tiles are inert) —
   * it's strictly a perf measurement aid for the `coll` timer.
   */
  toggleCollisions() {
    this.g.collisionsEnabled = !this.g.collisionsEnabled;
    this.g.physics.collisionsEnabled = this.g.collisionsEnabled;
  }

  /**
   * Toggle the dedicated mobile-shard ↔ static-tile collision pass.
   * Default OFF — the main broadphase skips this pair (shards drift
   * through tile geometry, only the repel field pushes them away).
   * Flip ON to add hard collisions: the asteroid-crash branch in
   * resolveCollision fires (pressure damage to the tile + elastic
   * bounce off the face).
   */
  toggleShardTileCollisions() {
    this.g.shardTileCollisionsEnabled = !this.g.shardTileCollisionsEnabled;
    this.g.physics.shardTileCollisionsEnabled = this.g.shardTileCollisionsEnabled;
  }

  /**
   * Cycle the shard ↔ shard pair-resolution interval through
   * SHARD_PAIR_CONSTANTS.CYCLE_ORDER (AUTO → 1 → 2 → 4 → 8 → 16 →
   * 32 → 64 → 128 → 256 → 512 → 1028).  AUTO (= 0) lets
   * PhysicsSystem pick N from the previous step's peak collision-
   * cell density; numeric values pin the interval.  The effective
   * N (whether AUTO or manual) is mirrored into EngineStats so the
   * DBG panel can render `auto (3)` or `every 256` accordingly.
   */
  cycleShardPairInterval() {
    const order = SHARD_PAIR_CONSTANTS.CYCLE_ORDER;
    const cur = this.g.physics.shardPairFrameInterval;
    const idx = order.indexOf(cur as (typeof order)[number]);
    const next = order[(idx + 1) % order.length];
    this.g.physics.shardPairFrameInterval = next;
  }

  /**
   * Cycle the shard ↔ static-tile pair-resolution interval through
   * SHARD_TILE_PAIR_CONSTANTS.CYCLE_ORDER.  Mirrors
   * `cycleShardPairInterval` exactly — same order, same AUTO
   * semantics — but gates `resolveShardTilePairs` instead of
   * `resolveShardPairs`.  Only meaningful when the parent
   * `shardTileCollisionsEnabled` toggle is on; cycling while OFF
   * still updates the stored value so the panel reflects it when
   * the user flips back on.
   */
  cycleShardTilePairInterval() {
    const order = SHARD_TILE_PAIR_CONSTANTS.CYCLE_ORDER;
    const cur = this.g.physics.shardTilePairFrameInterval;
    const idx = order.indexOf(cur as (typeof order)[number]);
    const next = order[(idx + 1) % order.length];
    this.g.physics.shardTilePairFrameInterval = next;
  }

  /**
   * Toggle shard ↔ shard gravity pull (the attractedTo pass in
   * ShardSystem.runMergeBroadphase).  Today only nebula-shard has
   * non-'none' attractedTo, so this primarily flips nebula self-
   * coalesce gravity and any cross-variant pull on/off.
   */
  toggleShardGravity() {
    this.g.shards.shardGravityEnabled = !this.g.shards.shardGravityEnabled;
  }

  /**
   * Master AUTO toggle for the central performance controller.  When
   * off, every AUTO task (manual interval 0) runs every step — i.e. all
   * automatic frame-skipping is disabled — while explicit manual pins
   * (set via the ShPair / Sh↔Tl int / ColorBlend int buttons) still
   * apply.  Lets a dev A/B the whole throttling system in one click.
   */
  togglePerfAuto() {
    this.g.perfController.autoEnabled = !this.g.perfController.autoEnabled;
  }

  /**
   * Toggle shard ↔ shard bond formation + cohesion.  When off, any
   * existing bonds drop on the next ShardSystem.update() tick and
   * no new bonds form.  Nebula self-compose (which fires via the
   * zero-time bond path) and cross-variant absorb both stop too.
   */
  toggleShardBonding() {
    this.g.shards.shardBondingEnabled = !this.g.shards.shardBondingEnabled;
  }

  /**
   * Toggle hard collisions between nebula-shard ↔ nebula-shard
   * pairs.  When on, the per-variant passThrough flag is ignored
   * for that specific pair and the SAT impulse path runs as
   * normal.  Default OFF — used to A/B-test whether forcing
   * nebula-pair separation breaks up the "one big pile" symptom.
   */
  toggleNebulaShardCollisions() {
    this.g.physics.nebulaShardCollisionsEnabled = !this.g.physics.nebulaShardCollisionsEnabled;
  }

  /** DBG (Shards & Physics): toggle the PLAYER ↔ nebula-shard hard collision —
   *  the ship physically parts the cloud vs. gliding through with only the pull.
   *  Default on. */
  togglePlayerNebulaCollision() {
    this.g.physics.playerNebulaCollisionEnabled = !this.g.physics.playerNebulaCollisionEnabled;
  }

  /**
   * Toggle collision-sleep for mobile shards.  When on, resolveShardPairs
   * skips the SAT+impulse math for asleep↔asleep pairs (the bulk of a
   * settled field).  Off restores resolving every pair every pass — used
   * to A/B-test the win and confirm sleeping never freezes a shard
   * through a real collision.
   */
  toggleShardSleep() {
    this.g.physics.shardSleepEnabled = !this.g.physics.shardSleepEnabled;
  }

  /**
   * Toggle viewport-gated shard-pair cadence.  When on, both-offscreen
   * shard pairs resolve only on the catch-up phase (every Nth pass);
   * on/near-screen pairs always resolve.  Off resolves every pair
   * regardless of visibility — used to A/B the win and confirm no
   * visible pop when off-screen piles scroll into view.
   */
  toggleShardViewportCull() {
    this.g.physics.shardViewportCullEnabled = !this.g.physics.shardViewportCullEnabled;
  }

  /**
   * Toggle shard render LOD.  When on, mobile shards too small for their
   * polygon detail to read blit a cached solid disc instead of the full
   * polygon fill+stroke+glow.  Purely visual; off restores the full
   * per-vertex render for every shard.
   */
  toggleShardLod() {
    this.g.renderer.shardLodEnabled = !this.g.renderer.shardLodEnabled;
  }

  /**
   * Toggle the local-density-driven merge/absorption rate.  When off, the
   * rate holds at a neutral 1.0× (base merge rate, no acceleration, base
   * per-frame budget) — used to A/B the consolidation feature.  When on,
   * shards in dense pockets merge/absorb faster and big absorbing rocks
   * slow down (see ShardSystem.tickBonds + LOCAL_MERGE_CONSTANTS).
   */
  toggleMergeRate() {
    this.g.perfController.mergeRateEnabled = !this.g.perfController.mergeRateEnabled;
  }

  /**
   * Toggle the camera screen-shake effect on/off.  When off,
   * handleScreenShake early-returns and any in-flight shake decays
   * to zero on the next sim step (the existing decay logic clears
   * shakeOffset once shakeTimer hits 0).
   */
  toggleScreenShake() {
    this.g.screenShakeEnabled = !this.g.screenShakeEnabled;
    if (!this.g.screenShakeEnabled) {
      // Cancel any in-flight shake immediately so the camera
      // returns to centered on the next frame.
      this.g.shakeTimer = 0;
      this.g.shakeIntensity = 0;
      this.g.camera.shakeOffset = { x: 0, y: 0 };
    }
  }

  /**
   * Toggle the DBG outline overlay for tile-and-shard variants
   * whose default render is outlineless — plastic-tile / plastic-
   * shard (soft gradient) and nebula-tile / nebula-shard (cloud
   * sprite).  When ON the renderer draws a thin cyan stroke of
   * each entity's collision polygon over the gradient / sprite,
   * making the SAT footprint visible against the soft fill.
   * Independent of the main DBG-mode toggle.
   */
  toggleTileOutlines() {
    this.g.renderer.tileOutlinesEnabled = !this.g.renderer.tileOutlinesEnabled;
  }

  /** DBG (Visual): flip the off-screen-indicator chevron mode between
   *  "Offscreen" (only nearby-but-offscreen entities get a chevron) and "All"
   *  (also chevron on-screen entities — the original behaviour). */
  toggleChevronMode() {
    this.g.renderer.chevronsOffscreenOnly = !this.g.renderer.chevronsOffscreenOnly;
  }

  /** DBG (Visual): cycle what the minimap says about MATERIAL — Flow
   *  (streamlines through the asteroid field, the default), Dots (the old
   *  per-shard spray) or Off.  Three-way rather than a toggle because the
   *  question decision #43 asked was whether streamlines BEAT dots, and the
   *  honest control for that is showing neither. */
  cycleMinimapMaterial() {
    cycleMinimapMaterial();
  }

  /** DBG (Visual): cycle the ROCK palette — mixed (default) / slate / rust /
   *  mineral.  Shades are rolled per instance AT SPAWN, so this takes effect
   *  on newly generated rock; reload the map to repaint a whole field. */
  cycleRockPalette() {
    cycleRockPalette();
  }

  /** DBG (Visual): cycle the unified tile lighting — legacy / debug /
   *  unified.  Index 0 is 'legacy' and it is named for what it IS rather
   *  than "off": Omni ships THREE hand-rolled lighting models (the
   *  proximity bloom, the repel glow, the glass edge tint) and legacy is
   *  those three, unchanged.  The unified system has to be judged against
   *  them, which is what this control is for.  'debug' paints a flat grey
   *  layer — no lighting maths — so the canvas, the blit and the
   *  smoothing restore can be checked without the light in the way. */
  cycleLighting() {
    cycleLightingMode();
  }

  /** DBG (Visual): cycle the lighting TIER — low / medium / high.  Low is
   *  pinned as the default because it is the 390x844 phone's budget: a
   *  divisor-3 layer, 4 lights, 24 occluders, radius 300, hard shadows. */
  cycleLightingTier() {
    cycleLightingTier();
  }

  /** DBG (Visual): do MOBILE SHARDS cast shadows as well as static tiles?
   *  Only has an effect while Lighting is 'unified'.  On by default —
   *  shards are the same family as tiles and about twice their radius, so
   *  excluding them makes debris read as transparent to a light the rock it
   *  broke off is not.  Off is the cost comparison. */
  toggleShardShadows() {
    toggleShardShadows();
  }

  /** DBG (Visual): REFRACTION through translucent bodies — a prototype.
   *  Off by default.  On, glass stops passing light straight through and
   *  instead bends it: each exit face refracts by Snell's law and throws an
   *  additive cone in the deviated direction, capped at half the source
   *  light's brightness.  The straight-through path is withheld in full, so
   *  the toggle is a real A/B rather than one effect stacked on the other. */
  toggleRefraction() {
    toggleRefraction();
  }

  /** DBG (Visual): how bright the refracted cone is, as a fraction of the
   *  light's own peak — 1/2 down to 1/10.  Only has an effect while
   *  Refraction is on.  Capped at 1/2 in the geometry regardless of what
   *  this returns: refracted light is a redistribution of light that already
   *  lost some of itself passing through the body, so it can never out-shine
   *  the source. */
  cycleRefractBrightness() {
    cycleRefractBrightness();
  }

  /** DBG (Visual): how bright the player light is, 100% down to 8%.  This
   *  is NOT the "Light tier" row — that one is a COST ladder (canvas
   *  resolution, occluder cap, radius) and changes how much work the light
   *  does, not how bright it looks. */
  cycleLightBrightness() {
    cycleLightBrightness();
  }

  /** DBG (Visual): do METAL and GLASS re-emit the light that falls on them?
   *  Off by default.  On, each lit body of those materials becomes a second,
   *  dimmer light at its own position — replacing the contact-driven glow
   *  those materials used to carry, which lit up when something touched them
   *  rather than when light reached them. */
  toggleEmissive() {
    toggleEmissive();
  }

  /** DBG (Visual): shadow-edge softness — soft / softer / off / subtle.
   *  Softness is an ANGLE, so the band widens with distance from the caster
   *  rather than being a uniform blur.  'off' is the hard-shadow control. */
  cycleShadowSoftness() {
    cycleShadowSoftness();
  }

  /** DBG (Visual): gamepad force feedback on/off.  Separate from the
   *  screen-shake toggle on purpose — the camera lurching and the hand
   *  buzzing are different preferences, and only one of them is felt by a
   *  player with no pad. */
  toggleRumble() {
    this.g.input.rumbleEnabled = !this.g.input.rumbleEnabled;
  }

  /** DBG (Visual): force the onscreen joystick to draw with no touch session.
   *  The widget is touch-only by design — it exists while a thumb is on the
   *  glass and nowhere else — which also means its size and placement cannot
   *  be checked on a desktop browser without this. */
  toggleJoystickDebug() {
    this.g.input.joystickForceVisible = !this.g.input.joystickForceVisible;
  }

  /** DBG (Shards & Physics): toggle the tile repel PUSH (glass + metal tiles).
   *  OFF disables only the outward velocity shove — the tile/scanner glow still
   *  reacts to a nearby body. */
  toggleRepelPush() {
    this.g.physics.repelPushEnabled = !this.g.physics.repelPushEnabled;
  }

  /**
   * Toggle the plastic-shard neighbour-brightness automata (PAuto).
   * On: shards render in the active palette's constant base shade,
   * darkened by how many plastic-shards they're in contact with.
   * Off: per-instance random shades (and the contact count isn't
   * computed).  Flips the render flag AND the ShardSystem compute
   * flag together so the count work is skipped when off.
   */
  togglePlasticAutomata() {
    const next = !this.g.renderer.plasticAutomataEnabled;
    this.g.renderer.plasticAutomataEnabled = next;
    this.g.shards.plasticAutomataEnabled = next;
  }

  /**
   * Flip the PAuto automata direction between darkening dense
   * interiors (default) and brightening them.  Live — RenderSystem
   * reads the shared flag in plasticAutomataHex each draw.
   */
  togglePlasticAutomataDirection() {
    togglePlasticAutomataBrighten();
  }

  /**
   * Toggle the material-tile neighbour automata (DBG "Tile shade") for
   * glass / metal / rock static tiles.  Flips the render gate; on enable
   * it bakes the (frozen) neighbour counts once so the tint is correct
   * even if the toggle started off.
   */
  toggleMaterialAutomata() {
    const next = !this.g.renderer.materialAutomataEnabled;
    this.g.renderer.materialAutomataEnabled = next;
    this.g.shards.materialAutomataEnabled = next;
    if (next && this.g.currentMap) this.g.shards.ensureMaterialNeighbors(this.g.currentMap.entities);
  }

  /**
   * Cycle the active plastic-TILE palette (litegreen → amber → black …)
   * and re-roll the colour of every active plastic-tile so the swap
   * is visible without breaking tiles.  Shards have their own
   * independent cycle (cyclePlasticShardPalette) so this method only
   * touches tiles.
   */
  cyclePlasticPalette() {
    cyclePlasticPalette();
    if (!this.g.currentMap) return;
    const ents = this.g.currentMap.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.shardVariant !== 'plastic-tile') continue;
      e.color = randomPlasticShade();
    }
  }

  /**
   * Cycle the DBG plastic-SHARD palette through PLASTIC_PALETTES.
   * Independent of the tile palette (cyclePlasticPalette) — rotates
   * the shard colour family without touching tiles.  Live re-roll:
   * every plastic-shard's colour resamples from the new palette so
   * the change is visible without breaking shards.
   */
  cyclePlasticShardPalette() {
    cyclePlasticShardPalette();
    if (!this.g.currentMap) return;
    const ents = this.g.currentMap.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.shardVariant !== 'plastic-shard') continue;
      e.color = randomPlasticShardShade();
    }
  }

  /**
   * Cycle the plastic-tile proximity-glow brightness multiplier
   * (MATERIAL_GLOW_BRIGHTNESS_CYCLE, 1× … 5×).  RenderSystem reads
   * the multiplier live each frame inside renderProximityBloom for
   * the plastic-tile branch only; metal has its own cycle, and other
   * glow-bearing tiles (rock / indestructible) are unaffected.
   */
  cyclePlasticGlowBrightness() {
    cyclePlasticGlowBrightness();
  }




  /**
   * Cycle the DBG nebula palette through GLASS_GLOW_COLORS.  Now
   * narrowly governs glass-tile shatter / merge dust ONLY
   * (randomGlassNebulaComposition).  Default 'sky'.  Main background
   * nebula clusters, nebula tiles, nebula shards, and BG puffs all
   * stay on the legacy default palette regardless of this cycle, and
   * rock-side dust is fixed at white.  Glass dust is ephemeral
   * (spawned per shatter event), so no entity re-roll is needed — the
   * next dust spawn picks up the new selection.
   */
  cycleNebulaPalette() {
    cycleNebulaPalette();
  }

  /**
   * Toggle the plastic colour-equilibration pipeline (NebulaSystem
   * .equilibrateColors plastic block).  When off, plastic tiles
   * and shards stop drifting toward each other and stay at their
   * spawn / shatter colours.  Nebula blending is unaffected.
   */
  togglePlasticBlend() {
    this.g.nebulas.plasticBlendEnabled = !this.g.nebulas.plasticBlendEnabled;
  }

  /**
   * Cycle the nebula-shard velocity-stretch stiffness through
   * VEL_STRETCH_K_CYCLE (off → soft → med → firm → stiff → off …).
   * The renderer reads getActiveNebulaStretchK() fresh each frame
   * so the change takes effect immediately.  The "free" rotation
   * behaviour (only squash aligns to velocity; sprite keeps its
   * own rotation) is fixed — see RenderSystem nebula-shard branch.
   */
  cycleNebulaStretch() {
    cycleNebulaStretch();
  }

  /**
   * Cycle the DBG player-thrust multiplier (PLAYER_THRUST_CYCLE) applied
   * live to the per-map acceleration.  This is the knob that actually
   * raises everyday top speed, since terminal cruise is
   * acceleration/(1−friction).
   */
  cyclePlayerThrust() {
    cyclePlayerThrust();
  }

  /**
   * Cycle the DBG player-speed multiplier (PLAYER_SPEED_CYCLE) applied
   * live to the per-map maxSpeed cap.  Only bites once the cap drops
   * below the friction-limited terminal velocity (or thrust pushes
   * cruise above it).
   */
  cyclePlayerSpeed() {
    cyclePlayerSpeed();
  }

  /**
   * Toggle the per-asteroid / per-drop flow-field velocity nudge
   * in updatePhysics.  When OFF, the `applyFlow` step early-exits after
   * the rotation update — asteroids retain whatever velocity they had
   * but receive no streamline correction.  Combined with linearDamping
   * they decay toward zero velocity over a few seconds; from then on
   * they only move when collided with or pulled by gravity.  Surfaced
   * in the DBG panel for A/B-testing the contribution of the flow nudge
   * to the asteroid-field "feel".
   */
  toggleAsteroidFlow() {
    this.g.asteroidFlowEnabled = !this.g.asteroidFlowEnabled;
  }

  /** Toggle the snitch catch interaction (collide ↔ shoot) — DBG aid for
   *  playtesting which catch mode feels better. */
  toggleSnitchCatchMode() {
    this.g.snitchCatchMode = this.g.snitchCatchMode === 'collide' ? 'shoot' : 'collide';
  }

  /** Cycle the DBG snitch-speed multiplier (SNITCH_SPEED_CYCLE) — scales
   *  both AI speed states live so the chase feel can be tuned in-game. */
  cycleSnitchSpeed() {
    cycleSnitchSpeed();
  }

  /** Cycle the DBG enemy-scaling multiplier (ENEMY_SCALE_CYCLE) — scales
   *  the per-wave HP+damage growth live to feel the comfortable-lead margin.
   *  Applies to enemies spawned after the change. */
  cycleEnemyScale() {
    cycleEnemyScale();
  }

  /** DBG: cycle the gnat (Swarm) movement mode to feel each side-by-side. */
  cycleSwarmMove() {
    cycleSwarmMove();
  }

  /** DBG: cycle the SUBSTEP CAP (5 default / 3 / 2).
   *
   *  The spiral-of-death clamp, exposed because a device capture showed it
   *  FEEDING the spiral: every worst frame pegged at 5 steps with 36-44ms of
   *  sim.  Lower caps trade a brief slow-motion for a shorter worst frame.
   *  Resets the accumulator so the changeover frame doesn't drain against the
   *  old budget. */
  cycleSubstepCap() {
    cycleSubstepCap();
    this.g.simAccumulator = 0;
    this.g.lastTime = performance.now();
  }

  /** DBG: cycle the HUD (React) update rate — 60Hz default / 30 / 15.
   *
   *  This was added as a diagnostic — the A/B that would say whether the
   *  32ms-of-a-35ms-frame gap in the 2026-08-09 capture was React.  THAT A/B
   *  HAS SINCE BEEN RUN, with a real instrument, and the answer is no:
   *  reconciliation is 0.1ms median in play, and this knob's ceiling is
   *  ~0.05ms (see docs/GAUNTLET_REACT_LOG.md).  It survives as a harmless
   *  A/B convenience, not as a lever worth reaching for.  Overlay screens
   *  always push immediately regardless of this setting. */
  cycleHudRate() {
    cycleHudRate();
    this.g.statsPushAccum = Infinity; // push on the very next frame
  }

  /** DBG: cycle the SIM RATE (120Hz default / 60Hz).
   *
   *  The single largest lever on sim cost that exists — at 120Hz a 60fps
   *  frame pays for two full sim steps — but a TRADE rather than a free win,
   *  because collision resolution is iterative and half the steps means half
   *  the passes untangling a dense shard pile.  Exposed as a toggle so the
   *  feel can be judged by hand at both rates; see SIM_RATE_CYCLE.
   *
   *  Resets the accumulator so the pending fraction of an old-length step
   *  doesn't get re-interpreted against the new one on the changeover frame. */
  cycleSimRate() {
    cycleSimRate();
    this.g.simAccumulator = 0;
    this.g.lastTime = performance.now();
  }

  /** Toggle the FF Vectors overlay (asteroid-flow arrows). */
  toggleFFOverlayVectors() {
    this.g.ffOverlayVectors = !this.g.ffOverlayVectors;
  }

  /** Toggle the FF Cells overlay (per-cell grid outlines). */
  toggleFFOverlayCells() {
    this.g.ffOverlayCells = !this.g.ffOverlayCells;
  }

  /** Toggle the FF Obstacles overlay (blocked-cell tint). */
  toggleFFOverlayObstacles() {
    this.g.ffOverlayObstacles = !this.g.ffOverlayObstacles;
  }

  /** Toggle the FF Rebuilds overlay (flash recently-rebaked cells). */
  toggleFFOverlayRebuilds() {
    this.g.ffOverlayRebuilds = !this.g.ffOverlayRebuilds;
  }

  /**
   * Cycle the vector-overlay sample stride through 1 → 2 → 4 → 8 → 16.
   * Coarser strides reduce arrow density on whichever map is loaded;
   * stride 1 draws every cell.  Cells / obstacles / rebuilds overlays
   * always render every cell — only the vector overlay uses this.g.
   */
  cycleFFOverlaySampleN() {
    const order = FF_SAMPLE_N_CYCLE;
    const idx = order.indexOf(this.g.ffOverlaySampleN);
    this.g.ffOverlaySampleN = order[(idx + 1) % order.length];
  }

  /**
   * Cycle the flow-field cell size through `FF_DENSITY_CYCLE` (256 →
   * 192 → 128 → 96 → 64 → 48 → 32 → 256).  Each step reallocates the
   * grid's typed-array buffers at the new resolution, rebuilds the
   * obstacle bitmap from the live entity list, and re-bakes the
   * asteroid field with the active map's sampleFlow.  The enemy
   * pursuit field is marked dirty so the next `flushEnemyField()`
   * rebuilds it for the new resolution.  All of this happens
   * synchronously inside the cycle — at the highest density (32-unit
   * cells on a 6 k map) the bake is still sub-millisecond.
   *
   * No-op when no map is loaded.
   */
  cycleFFDensity() {
    if (!this.g.currentMap) return;
    const order = FF_DENSITY_CYCLE;
    const idx = order.indexOf(this.g.ffCellSize);
    const next = order[(idx + 1) % order.length];
    this.g.ffCellSize = next;
    this.g.flowField.setCellSize(next);
    this.g.flowField.initObstacles(this.g.currentMap.entities);
    // Re-bake under the active pattern selection (not necessarily the
    // map's own sampler) so the chosen pattern survives density changes.
    this.g.flowField.buildAsteroidField(this.g.flowSamplerFor(this.g.currentMap));
    // The new grid starts with defaults; push the current cycled
    // values back so they survive density changes.
    this.g.flowField.setKernelR(this.g.ffKernelR);
    this.g.flowField.setTangentMix(this.g.ffTangentMix);
  }

  /**
   * Cycle the asteroid-field wall-repulsion kernel radius through
   * `FF_KERNEL_R_CYCLE` (0 → 1 → 2 → 3 → 4 → 5).  R = 0 is the legacy
   * 4-cardinal-only scan kept for A/B testing; R ≥ 1 enables the
   * (2R+1)² kernel with 1/d² falloff so cells several positions away
   * from a wall already start curving the flow.  Each step re-bakes
   * the asteroid field in-place (sub-ms even at the finest density).
   */
  cycleFFKernelR() {
    const order = FF_KERNEL_R_CYCLE;
    const idx = order.indexOf(this.g.ffKernelR);
    const next = order[(idx + 1) % order.length];
    this.g.ffKernelR = next;
    this.g.flowField.setKernelR(next);
  }

  /**
   * Cycle the wall-repulsion tangent-mix factor through
   * `FF_TANGENT_MIX_CYCLE` (0.00 → 0.25 → 0.50 → 0.75 → 1.00).  At 0
   * the kernel pushes purely perpendicular away from walls (creates
   * opposing vectors on either side of a long wall — the saddle
   * dead-zone failure mode).  At 1 each blocked-neighbour
   * contribution is rotated 90° so the flow slides ALONG the wall
   * (both sides flow in the same direction along the wall, no
   * saddle).  Re-bakes the asteroid field in-place.
   */
  cycleFFTangentMix() {
    const order = FF_TANGENT_MIX_CYCLE;
    const idx = order.indexOf(this.g.ffTangentMix);
    const next = order[(idx + 1) % order.length];
    this.g.ffTangentMix = next;
    this.g.flowField.setTangentMix(next);
  }

  /**
   * Cycle the breathing scroll rate through `FF_BREATHE_RATE_CYCLE`
   * (off → slow → med → fast).  When non-zero, the asteroid field's
   * base direction undulates over time (re-baked on a throttled
   * cadence in updatePhysics) so convergence zones drift and shard
   * piles dissolve.  Cycling to a non-zero rate immediately re-bakes
   * at the current phase so the undulation appears; cycling back to
   * off re-bakes once with amplitude 0 to restore the static field.
   */
  cycleFFBreathe() {
    const order = FF_BREATHE_RATE_CYCLE;
    const idx = order.indexOf(this.g.ffBreatheRate);
    const next = order[(idx + 1) % order.length];
    this.g.ffBreatheRate = next;
    const amp = next > 0 ? FlowFieldGrid.BREATHE_AMP : 0;
    this.g.flowField.setBreathe(amp, this.g.ffBreathePhase);
  }

  /**
   * Cycle the per-shard lane-jitter strength through
   * `FF_LANE_JITTER_CYCLE` (off → low → med → high).  Adds a stable
   * per-shard perpendicular offset to the flow target so shards ride
   * slightly different parallel lanes instead of collapsing onto one
   * streamline.  Live — no re-bake (applied at sample time in the
   * per-shard flow nudge).
   */
  cycleFFLaneJitter() {
    const order = FF_LANE_JITTER_CYCLE;
    const idx = order.indexOf(this.g.ffLaneJitter);
    this.g.ffLaneJitter = order[(idx + 1) % order.length];
  }


  /**
   * Cycle the base-flow pattern through `FF_PATTERN_CYCLE` (map default
   * → meander → circular → spiral → gravity well → wavy well → outward
   * → horizontal → vertical → wavy-H → wavy-V).  Re-bakes the asteroid
   * field with the new sampler; current kernel / tangent / breathing
   * settings still apply on top.  The map's spawn-time seeding is
   * unaffected — existing shards re-settle onto the new pattern over a
   * second or two via the per-frame flow nudge.
   */
  cycleFFPattern() {
    if (!this.g.currentMap) return;
    const order = FF_PATTERN_CYCLE;
    const idx = order.indexOf(this.g.ffPattern);
    this.g.ffPattern = order[(idx + 1) % order.length];
    this.g.flowField.buildAsteroidField(this.g.flowSamplerFor(this.g.currentMap));
  }

  /**
   * Cycle the hot-spot-collapse grace delay through SHATTER_GRACE_CYCLE
   * (0.6 → 3.6s).  Freshly-shattered rock/glass shards read
   * getActiveShatterGraceDelay() at spawn, so the new value applies to
   * tiles destroyed after the cycle.
   */
  cycleShatterGrace() {
    cycleShatterGrace();
  }

  /**
   * Cycle the nebula tile→tile color-equilibration alpha through
   * NEBULA_CONSTANTS.BLEND_TILE_ALPHA_CYCLE (Off → Slow → Med →
   * Fast).  Anchors the cluster's structural hue — tiles drift
   * toward their 6-hex-neighbour weighted average each frame at
   * this alpha.
   */
  cycleTileBlendAlpha() {
    const order = NEBULA_CONSTANTS.BLEND_TILE_ALPHA_CYCLE;
    const cur = this.g.nebulas.tileBlendAlpha;
    const idx = order.indexOf(cur as (typeof order)[number]);
    const next = order[(idx + 1) % order.length];
    this.g.nebulas.tileBlendAlpha = next;
  }

  /**
   * Cycle the nebula shard→nearest-tile color-equilibration alpha
   * through NEBULA_CONSTANTS.BLEND_SHARD_ALPHA_CYCLE.  Catch-up
   * blend for shards (anchors don't move).
   */
  cycleShardBlendAlpha() {
    const order = NEBULA_CONSTANTS.BLEND_SHARD_ALPHA_CYCLE;
    const cur = this.g.nebulas.shardBlendAlpha;
    const idx = order.indexOf(cur as (typeof order)[number]);
    const next = order[(idx + 1) % order.length];
    this.g.nebulas.shardBlendAlpha = next;
  }

  /**
   * Cycle the cadence interval for the nebula color-equilibration
   * pass through NEBULA_CONSTANTS.BLEND_FRAME_INTERVAL_CYCLE.
   * Higher values trade smoothness for perf — the per-call work
   * stays the same but fires less often.
   */
  cycleColorBlendInterval() {
    const order = NEBULA_CONSTANTS.BLEND_FRAME_INTERVAL_CYCLE;
    const cur = this.g.nebulas.colorBlendFrameInterval;
    const idx = order.indexOf(cur as (typeof order)[number]);
    const next = order[(idx + 1) % order.length];
    this.g.nebulas.colorBlendFrameInterval = next;
  }
}
