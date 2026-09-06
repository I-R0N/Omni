/** The SNITCH — the quidditch-style bonus target.
 *
 *  Extracted verbatim from `GameEngine` in gauntlet 5f (see
 *  `docs/GAUNTLET_5F_LOG.md`); same technique as `dragons.ts` / `rivals.ts` —
 *  plain free functions taking `g: GameEngine`, with `GameEngine` imported as
 *  a TYPE so it is erased at compile time and there is no runtime cycle.
 *
 *  There is only ever ONE live snitch, so its AI state lives as flat fields on
 *  the engine rather than in a per-instance struct the way the dragon's and
 *  the rival's do.  That asymmetry is deliberate and is why this file has no
 *  `SnitchInstance`.
 */
import type { GameEngine } from '../GameEngine';
import { GameEntity, EntityType } from '../../types';
import {
    SNITCH_CONSTANTS, SCORE_CONSTANTS, SALVAGE_CONSTANTS, TRAIL_CONSTANTS,
    PLAYER_MOVEMENT_CONFIG, getActivePlayerThrustMult, getActiveSnitchSpeedMult,
} from '../../constants';
import { wrapDeltaX, wrapDeltaY, wrapPosition } from '../toroidal';
import { nextId } from '../systems/IdAllocator';

// ── Snitch — quidditch-style bonus target ───────────────────────────────
//
// The snitch rides the asteroid flow field with a burst/coast AI and
// PERSISTS across wave boundaries — one keeps flying until the player
// catches it.  Catching it (colliding with it or shooting it, per the
// DBG-toggleable catch mode) pays SCORE_CONSTANTS.SNITCH_POINTS and ends
// the current wave; the next wave then spawns a fresh one.

/** Per-sim-step snitch tick: lifecycle, flow-field steering, comet-tail
 *  emission, and the catch check.  Called from updateGameLogic after the
 *  wave tick so waveState is fresh. */
// The snitch's presence loop is driven UNCONDITIONALLY from its live
// position, exactly like the station and portal beds.  It used to be gated
// on a 1200-unit range check while the sound's own far radius was the
// 2600-unit default, so it snapped on at two-thirds volume and never faded
// below that — audible, panned, and yet not remotely positional.
// `AudioSystem.loop` already treats an out-of-earshot positional loop as OFF,
// so the range check was never what stopped it holding oscillators; the
// attenuation is.  Radii live in AUDIO_CONSTANTS.SNITCH_*.

export function updateSnitch(g: GameEngine, dt: number) {
  if (!g.currentMap) return;
  g.snitchTime += dt;

  // Persist across wave boundaries: the snitch is never despawned at a
  // wave end, so an uncaught one keeps flying into the next wave.  A
  // fresh one only spawns when a wave is active and none is live — the
  // first wave, or the wave after a catch removed the previous snitch.
  if (g.waves.waveState === 'active' && (!g.snitch || !g.snitch.active)) {
    spawnSnitch(g);
  }

  const s = g.snitch;
  if (!s || !s.active) return;

  // ── Burst/coast AI ──────────────────────────────────────────────────
  // The snitch is interactive prey, not a constant-speed rail rider:
  // it coasts slow enough to close on (the catch window), then darts —
  // on a random timer, or the moment the player gets near (panic dart,
  // biased away from the player).  See the SNITCH_CONSTANTS doc block.
  g.snitchPanicCooldown = Math.max(0, g.snitchPanicCooldown - dt);
  g.snitchAiTimer -= dt;
  const toPlayerX = wrapDeltaX(s.position.x, g.player.position.x);
  const toPlayerY = wrapDeltaY(s.position.y, g.player.position.y);
  const playerDistSq = toPlayerX * toPlayerX + toPlayerY * toPlayerY;
  if (g.snitchAiState === 'coast') {
    const panic = g.snitchPanicCooldown <= 0
        && !g.player.isExploding
        && playerDistSq < SNITCH_CONSTANTS.PANIC_RADIUS * SNITCH_CONSTANTS.PANIC_RADIUS;
    if (panic || g.snitchAiTimer <= 0) {
      g.audio.play('snitch.dart', { x: s.position.x, y: s.position.y });
      g.snitchAiState = 'dart';
      g.snitchAiTimer = SNITCH_CONSTANTS.DART_DURATION_MIN
          + Math.random() * (SNITCH_CONSTANTS.DART_DURATION_MAX - SNITCH_CONSTANTS.DART_DURATION_MIN);
      g.snitchDartAway = false;
      if (panic) {
        g.snitchPanicCooldown = SNITCH_CONSTANTS.PANIC_COOLDOWN;
        const d = Math.sqrt(playerDistSq);
        if (d > 1e-4) {
          g.snitchDartAwayX = -toPlayerX / d;
          g.snitchDartAwayY = -toPlayerY / d;
          g.snitchDartAway = true;
        }
      }
    }
  } else if (g.snitchAiTimer <= 0) {
    g.snitchAiState = 'coast';
    g.snitchDartAway = false;
    g.snitchAiTimer = SNITCH_CONSTANTS.COAST_DURATION_MIN
        + Math.random() * (SNITCH_CONSTANTS.COAST_DURATION_MAX - SNITCH_CONSTANTS.COAST_DURATION_MIN);
  }
  // Speed eases toward the state target — near-instant on the way up
  // (the burst), visibly slower on the way back down (the catch window
  // opens gradually as the dart bleeds off).
  // Treasure chatter — the carrot.  Always ON with a live position; the
  // sound's own far radius decides when it is audible, so the approach
  // swells instead of switching on.
  g.audio.loop('snitch.near', true, { x: s.position.x, y: s.position.y });

  const darting = g.snitchAiState === 'dart';
  // Per-wave speed ramp: headline (dart) speed grows WAVE_SPEED_STEP×
  // cruise per wave, capped; coast is a fixed fraction of it.  Read live
  // from the wave counter so the persistent snitch speeds up each wave.
  const waveBase = Math.min(
    SNITCH_CONSTANTS.WAVE_SPEED_MAX,
    SNITCH_CONSTANTS.WAVE_SPEED_STEP * (g.snitchCatchCount + 1),
  );
  const speedTarget = waveBase * (darting ? SNITCH_CONSTANTS.DART_RATIO : SNITCH_CONSTANTS.COAST_RATIO);
  const ease = darting ? SNITCH_CONSTANTS.SPEED_EASE_DART : SNITCH_CONSTANTS.SPEED_EASE_COAST;
  g.snitchSpeedMult += (speedTarget - g.snitchSpeedMult) * Math.min(1, ease * dt);

  // Steering: sampled flow direction rotated by the wander oscillation;
  // panic darts blend the away-from-player escape vector on top.  Speed
  // derives from the player's friction-limited terminal cruise (same
  // formula as the DBG thrust tooltip: acceleration/(1−friction),
  // clamped by maxSpeed) so the chase tracks thrust-mult changes.
  const flow = g.flowField.sampleShardFlow(s.position.x, s.position.y);
  const wob = Math.sin(g.snitchTime * SNITCH_CONSTANTS.WANDER_FREQ + (s.snitchWanderPhase ?? 0))
      * SNITCH_CONSTANTS.WANDER_AMPLITUDE;
  const cosW = Math.cos(wob), sinW = Math.sin(wob);
  let dirX = flow.x * cosW - flow.y * sinW;
  let dirY = flow.x * sinW + flow.y * cosW;
  if (g.snitchDartAway) {
    const b = SNITCH_CONSTANTS.PANIC_AWAY_BIAS;
    const bx = dirX * (1 - b) + g.snitchDartAwayX * b;
    const by = dirY * (1 - b) + g.snitchDartAwayY * b;
    const bm = Math.sqrt(bx * bx + by * by) || 1;
    dirX = bx / bm;
    dirY = by / bm;
  }
  const moveCfg = PLAYER_MOVEMENT_CONFIG[g.currentMap.type];
  const cruise = Math.min(
    moveCfg.maxSpeed,
    (moveCfg.acceleration * getActivePlayerThrustMult()) / (1 - moveCfg.friction),
  );
  const targetSpeed = cruise * g.snitchSpeedMult * getActiveSnitchSpeedMult();
  const steerRate = darting ? SNITCH_CONSTANTS.DART_STEER_RATE : SNITCH_CONSTANTS.COAST_STEER_RATE;
  const alpha = Math.min(1, steerRate * dt * 60);
  s.velocity.x += (dirX * targetSpeed - s.velocity.x) * alpha;
  s.velocity.y += (dirY * targetSpeed - s.velocity.y) * alpha;
  s.rotation = Math.atan2(s.velocity.y, s.velocity.x);

  // Comet tail: decay + emit trail-strip points (rendered like a
  // projectile trail in gold) and sprinkle sparkle motes behind the core.
  if (!s.trail) s.trail = [];
  g.trails.tickTrail(s.trail, dt);
  const last = s.trail.length > 0 ? s.trail[s.trail.length - 1] : null;
  const tdx = last ? wrapDeltaX(last.x, s.position.x) : 1;
  const tdy = last ? wrapDeltaY(last.y, s.position.y) : 1;
  if (!last || tdx * tdx + tdy * tdy > TRAIL_CONSTANTS.MIN_DISTANCE_SQ) {
    s.trail.push({
      x: s.position.x,
      y: s.position.y,
      lifetime: SNITCH_CONSTANTS.TRAIL_LIFETIME,
      maxLifetime: SNITCH_CONSTANTS.TRAIL_LIFETIME,
      scale: SNITCH_CONSTANTS.TRAIL_SCALE,
    });
  }
  const sparkColors = SNITCH_CONSTANTS.SPARKLE_COLORS;
  g.spawnParticles(s.position, 1, sparkColors[(Math.random() * sparkColors.length) | 0], {
    speedMin: 0, speedMax: 1.5,
    sizeMin: 0.5, sizeMax: 1.6,
    lifetimeMin: 0.15, lifetimeMax: 0.4,
    positionJitter: SNITCH_CONSTANTS.SIZE * 0.5,
  });

  // Catch check (toPlayer deltas already computed by the AI block above).
  if (g.snitchCatchMode === 'collide') {
    if (g.player.isExploding) return;
    const r = Math.max(g.player.size.x, g.player.size.y) / 2
        + SNITCH_CONSTANTS.SIZE / 2 + SNITCH_CONSTANTS.COLLIDE_GRACE;
    if (playerDistSq <= r * r) catchSnitch(g, s);
  } else {
    const r = SNITCH_CONSTANTS.SHOOT_RADIUS;
    const projs = g.entityIndex.projectiles;
    for (let i = 0; i < projs.length; i++) {
      const p = projs[i];
      if (!p.active || p.ownerType !== EntityType.PLAYER) continue;
      const dx = wrapDeltaX(s.position.x, p.position.x);
      const dy = wrapDeltaY(s.position.y, p.position.y);
      if (dx * dx + dy * dy <= r * r) {
        p.active = false; // the shot is spent on the catch
        catchSnitch(g, s);
        break;
      }
    }
  }
}

/** Spawn a snitch on the off-screen ring around the player (same
 *  viewport-derived contract as wave-enemy spawns).  Non-drop
 *  INTERACTABLE → the physics broadphase ignores it entirely; it flies
 *  through everything and only the manual catch check can end it. */
function spawnSnitch(g: GameEngine) {
  if (!g.currentMap) return;
  const zoom = g.camera.zoom || 1;
  const halfDiag = Math.hypot((window.innerWidth / 2) / zoom, (window.innerHeight / 2) / zoom);
  const angle = Math.random() * Math.PI * 2;
  const dist = halfDiag + SNITCH_CONSTANTS.SPAWN_MARGIN;
  const pos = {
    x: g.player.position.x + Math.cos(angle) * dist,
    y: g.player.position.y + Math.sin(angle) * dist,
  };
  wrapPosition(pos);
  const s: GameEntity = {
    id: nextId('snitch'),
    type: EntityType.INTERACTABLE,
    isSnitch: true,
    snitchWanderPhase: Math.random() * Math.PI * 2,
    position: pos,
    velocity: { x: 0, y: 0 },
    size: { x: SNITCH_CONSTANTS.SIZE, y: SNITCH_CONSTANTS.SIZE },
    rotation: 0,
    color: SNITCH_CONSTANTS.CORE_COLOR,
    active: true,
    health: 1,
    maxHealth: 1,
    mass: SNITCH_CONSTANTS.MASS,
    trail: [],
  };
  g.currentMap.entities.push(s);
  g.snitch = s;
  // Re-seed the burst/coast AI for the fresh snitch: open on a coast
  // window so the spawn reads as a wandering glint, not an escape.
  g.snitchAiState = 'coast';
  g.snitchAiTimer = SNITCH_CONSTANTS.COAST_DURATION_MIN
      + Math.random() * (SNITCH_CONSTANTS.COAST_DURATION_MAX - SNITCH_CONSTANTS.COAST_DURATION_MIN);
  g.snitchPanicCooldown = 0;
  const waveBase = Math.min(
    SNITCH_CONSTANTS.WAVE_SPEED_MAX,
    SNITCH_CONSTANTS.WAVE_SPEED_STEP * (g.snitchCatchCount + 1),
  );
  g.snitchSpeedMult = waveBase * SNITCH_CONSTANTS.COAST_RATIO;
  g.snitchDartAway = false;
}

/** Snitch caught: big gold payout + burst, then end the wave through
 *  the shared cleared path (no early-clear bonus stacks on top). */
function catchSnitch(g: GameEngine, s: GameEntity) {
g.audio.play('snitch.catch');
  s.active = false;
  g.snitch = null;
  g.snitchCatchCount++; // the NEXT snitch spawns faster — catching ramps speed, not waves
  g.awardScore(SCORE_CONSTANTS.SNITCH_POINTS, s.position);
  // Salvage spray — score no longer mints credits, so the catch pays money
  // as physical drops (they scatter, merge, and magnetise like any salvage;
  // sized against the per-wave income arithmetic in SALVAGE_CONSTANTS).
  for (let i = 0; i < SALVAGE_CONSTANTS.SNITCH_CATCH_DROPS; i++) {
    g.spawnSalvageDrop(s.position, s.velocity);
  }
  g.spawnParticles(s.position, SNITCH_CONSTANTS.CATCH_BURST_COUNT, SNITCH_CONSTANTS.CORE_COLOR, {
    speedMin: 1, speedMax: 6,
    sizeMin: 1, sizeMax: 3,
    lifetimeMin: 0.3, lifetimeMax: 0.8,
  });
  // Board clear: the catch wipes every live enemy on the field, each
  // worth half its normal kill value (full death path — explosions,
  // enemy shards, half-point "+N" popups).  Snapshot the count first so
  // the shards/particles those deaths append aren't re-scanned.
  if (g.currentMap) {
    const ents = g.currentMap.entities;
    const n = ents.length;
    for (let i = 0; i < n; i++) {
      const e = ents[i];
      if (e.type === EntityType.ENEMY && e.active && !e.isExploding) {
        g.handleEntityDeath(e, { scoreScale: SCORE_CONSTANTS.SNITCH_SWEEP_KILL_FRACTION });
      }
    }
  }
  g.waves.endWaveBySnitch(SCORE_CONSTANTS.SNITCH_POINTS, g.handleWaveCleared);
}
