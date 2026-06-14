import { GameEntity, EntityType, EnemySubtype, Vector2, WaveAnnouncement } from '../../types';
import {
  DIFFICULTY_STAT_SCALES,
  ENEMY_VARIANTS,
  ENEMY_CONSTANTS,
  WAVE_CONSTANTS,
  WAVE_ANNOUNCE_CONSTANTS,
  SCORE_CONSTANTS,
  TIMED_WAVE_CONFIG,
  getWaveDurationSec,
  getWaveSpawnBudget,
  buildWaveSpawnList,
} from '../../constants';
import { PhysicsSystem } from './PhysicsSystem';
import { nextId } from './IdAllocator';
import { wrapPosition } from '../toroidal';

/**
 * WaveSystem — owns wave state (current index, live enemy ids, phase,
 * grace-period countdown) and the timed-wave spawn scheduler.
 *
 * Waves are timed windows (feedback (f)): each wave runs a fixed clock
 * (scaling 30s + 5s/wave, capped) while a precomputed spawn schedule
 * streams enemies in one at a time — steady through the first three
 * quarters, denser over the final quarter.  The wave ends when the clock
 * expires ("WAVE N ENDED") or earlier when the full spawn budget has
 * been emitted and killed ("WAVE N CLEARED EARLY").  Either way the
 * existing grace countdown then rolls into the next wave — waves are
 * infinite.  Survivors are NEVER despawned: enemies that outlive their
 * wave simply carry over and keep fighting alongside the next wave's
 * stream (per playtest feedback — enemies vanishing at the wave
 * boundary read as a bug).
 */
export class WaveSystem {
  public waveIndex: number = 0;
  /** Ids of every enemy spawned by the current wave (dead ones included —
   *  liveness is re-checked against the entity list each tick). */
  public waveEnemyIds: Set<string> = new Set();
  public waveState: 'inactive' | 'active' | 'cleared' = 'inactive';
  public waveGraceTimer: number = 0;
  public announcements: WaveAnnouncement[] = [];

  // ── Timed-wave internals ──────────────────────────────────────────────
  private durationSec: number = 0;
  private elapsedSec: number = 0;
  /** Ordered subtypes this wave will spawn (length = scaled budget). */
  private spawnList: EnemySubtype[] = [];
  /** Per-slot scheduled spawn time (seconds since wave start). */
  private spawnTimesSec: number[] = [];
  private nextSpawnIdx: number = 0;
  private lastSpawnAtSec: number = -Infinity;

  // Reusable spawn-position scratch — never allocate inside the spawn loop.
  private readonly spawnPos: Vector2 = { x: 0, y: 0 };

  /** Seconds elapsed in the active wave (0 outside 'active').  The clock no
   *  longer ends the wave — it only grades the completion speed bonus. */
  public get elapsedSecPublic(): number {
    return this.waveState === 'active' ? this.elapsedSec : 0;
  }

  /** Enemies still standing between the player and wave completion: the
   *  not-yet-spawned remainder of the budget PLUS the live tracked count.
   *  Reaching 0 (while 'active') completes the wave. */
  public enemiesRemaining(entities: GameEntity[]): number {
    if (this.waveState !== 'active') return 0;
    return (this.spawnList.length - this.nextSpawnIdx) + this.countLiveTracked(entities);
  }

  /** Reset all wave state and start wave 0.  Skipped entirely when
   *  enemyScale is 0 (difficulty "None") — the map loads with waves
   *  disabled: no wave 1 banner, no grace-period cycling, no enemies. */
  public init(ctx: WaveSpawnContext) {
    this.waveIndex = 0;
    this.waveEnemyIds = new Set();
    this.waveState = 'inactive';
    this.waveGraceTimer = 0;
    this.announcements = [];
    this.durationSec = 0;
    this.elapsedSec = 0;
    this.spawnList = [];
    this.spawnTimesSec = [];
    this.nextSpawnIdx = 0;
    this.lastSpawnAtSec = -Infinity;
    if (ctx.enemyScale <= 0) return;
    this.startWave(0, ctx);
  }

  /**
   * Per-sim-step tick.  COMPLETION model: the wave is only over once the
   * full budget has been spawned AND every spawned enemy is dead — the
   * player must clear the field to advance.  The clock keeps counting but
   * no longer ends the wave; `onCleared` receives the elapsed seconds so
   * the caller can pay a speed-graded time bonus.  The grace countdown
   * then rolls into the next wave.
   */
  public update(
    dt: number,
    ctx: WaveSpawnContext,
    onCleared: (waveJustCleared: number, elapsedSec: number, bySnitch: boolean) => void,
  ) {
    if (this.waveState === 'active') {
      this.elapsedSec += dt;
      this.emitDueSpawns(ctx);
      if (
        this.nextSpawnIdx >= this.spawnList.length &&
        this.countLiveTracked(ctx.entities) === 0
      ) {
        this.endWave(onCleared);
      }
    } else if (this.waveState === 'cleared' && this.waveGraceTimer > 0) {
      this.waveGraceTimer -= dt;
      if (this.waveGraceTimer <= 0) {
        this.waveGraceTimer = 0;
        this.startWave(this.waveIndex + 1, ctx);
      }
    }
  }

  /** Begin a wave: compute the spawn-stream window + difficulty-scaled
   *  budget, build the subtype list and spawn schedule, announce.  Note
   *  `durationSec` is now only the window over which enemies STREAM IN —
   *  it does not end the wave (completion does). */
  private startWave(index: number, ctx: WaveSpawnContext) {
    this.waveIndex = index;
    this.waveEnemyIds.clear();
    this.elapsedSec = 0;
    this.nextSpawnIdx = 0;
    this.lastSpawnAtSec = -Infinity;
    this.durationSec = getWaveDurationSec(index);

    const budget = Math.max(1, Math.round(getWaveSpawnBudget(index) * ctx.enemyScale));
    this.spawnList = buildWaveSpawnList(index, budget);
    this.scheduleSpawns(budget);

    this.waveState = 'active';
    const totalLife = WAVE_ANNOUNCE_CONSTANTS.FADEIN + WAVE_ANNOUNCE_CONSTANTS.HOLD + WAVE_ANNOUNCE_CONSTANTS.FADEOUT;
    this.announcements.push({
      text: `WAVE ${index + 1}`,
      subtext: `DESTROY ${budget} HOSTILE${budget === 1 ? '' : 'S'}`,
      color: '#ffffff',
      lifetime: totalLife,
      maxLifetime: totalLife,
    });
  }

  /**
   * Precompute per-slot spawn timestamps from the piecewise spawn density:
   * 1× through the first (1 - q) of the window, FINAL_QUARTER_RATE_MULT×
   * through the last q.  Slots are placed at the inverse-CDF midpoints so
   * the full budget lands inside the window with the crescendo applied and
   * the total count exact.
   */
  private scheduleSpawns(budget: number) {
    const q = TIMED_WAVE_CONFIG.FINAL_QUARTER_FRACTION;
    const m = TIMED_WAVE_CONFIG.FINAL_QUARTER_RATE_MULT;
    const total = (1 - q) + q * m; // integrated density over the unit window
    this.spawnTimesSec.length = 0;
    for (let k = 0; k < budget; k++) {
      const u = ((k + 0.5) / budget) * total;
      const t = u <= 1 - q ? u : (1 - q) + (u - (1 - q)) / m;
      this.spawnTimesSec.push(t * this.durationSec);
    }
  }

  /** Spawn every schedule slot whose time has come, subject to the live
   *  concurrency cap and the backlog drain gap (so a freed cap releases
   *  held spawns one at a time instead of dumping a clump). */
  private emitDueSpawns(ctx: WaveSpawnContext) {
    if (this.nextSpawnIdx >= this.spawnList.length) return;
    if (this.spawnTimesSec[this.nextSpawnIdx] > this.elapsedSec) return;
    let live = this.countLiveTracked(ctx.entities);
    while (
      this.nextSpawnIdx < this.spawnList.length &&
      this.spawnTimesSec[this.nextSpawnIdx] <= this.elapsedSec &&
      live < TIMED_WAVE_CONFIG.MAX_CONCURRENT_ENEMIES &&
      this.elapsedSec - this.lastSpawnAtSec >= TIMED_WAVE_CONFIG.BACKLOG_MIN_GAP_SEC
    ) {
      this.spawnEnemy(this.spawnList[this.nextSpawnIdx], ctx);
      this.lastSpawnAtSec = this.elapsedSec;
      this.nextSpawnIdx++;
      live++;
    }
  }

  /** Count tracked wave enemies still alive (exploding ones count as dead,
   *  matching the old kill-all completion semantics). */
  private countLiveTracked(entities: GameEntity[]): number {
    let live = 0;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (this.waveEnemyIds.has(e.id) && e.active && !e.isExploding) live++;
    }
    return live;
  }

  /**
   * Spawn a single enemy on the offscreen ring around the player.  Stream
   * spawns use a fresh random bearing per enemy (the flank grouping of the
   * old all-at-once spawn doesn't apply to a trickle); each position is
   * tested against static tiles via the physics system so enemies never
   * materialize inside walls, and candidates are wrapped into canonical
   * world coords so seam spawns don't land at ±MAP_WIDTH off the map.
   */
  private spawnEnemy(subtype: EnemySubtype, ctx: WaveSpawnContext) {
    const { entities, player, physics, difficultyLevel, viewportHalfDiagonal } = ctx;
    const statScale = DIFFICULTY_STAT_SCALES[difficultyLevel] ?? DIFFICULTY_STAT_SCALES[3];
    const config = ENEMY_VARIANTS[subtype];
    const enemyHalfSize = config.size / 2;
    const safeRadius = enemyHalfSize + 30;
    // Minimum spawn distance keeps the enemy fully outside the visible
    // viewport, padded by the configured offscreen margin and the enemy's
    // own half-size so even its sprite edge stays off-screen.
    const minSpawnDistance = viewportHalfDiagonal + WAVE_CONSTANTS.OFFSCREEN_MARGIN + enemyHalfSize;
    const baseAngle = Math.random() * Math.PI * 2;
    const pos = this.spawnPos;
    let x = 0, y = 0;
    // Try up to 8 candidate positions; pick first one clear of static tiles.
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = baseAngle + (attempt / 8) * Math.PI * 2 * 0.25;
      const dist = minSpawnDistance + Math.random() * WAVE_CONSTANTS.SPAWN_RING_SPREAD;
      pos.x = player.position.x + Math.cos(a) * dist;
      pos.y = player.position.y + Math.sin(a) * dist;
      wrapPosition(pos);
      x = pos.x;
      y = pos.y;
      if (physics.isPositionClear(x, y, safeRadius)) break;
    }
    const id = nextId(`wave_${this.waveIndex}_${this.nextSpawnIdx}`);

    const tierMap: Partial<Record<string, number>> = {
      RAMMER_1: 1, SHOOTER_1: 1,
      RAMMER_2: 2, SHOOTER_2: 2,
      RAMMER_3: 3, SHOOTER_3: 3,
    };
    const enemyTier = tierMap[subtype] ?? 1;

    const scaledHealth = Math.max(1, Math.round(config.health * statScale.health));
    entities.push({
      id,
      type: EntityType.ENEMY,
      enemySubtype: subtype,
      enemyTier,
      position: { x, y },
      velocity: { x: 0, y: 0 },
      size: { x: config.size, y: config.size },
      rotation: Math.random() * Math.PI * 2,
      color: config.color,
      active: true,
      health: scaledHealth,
      maxHealth: scaledHealth,
      maxSpeed: config.maxSpeed * statScale.speed,
      mass: config.mass,
      visionRange: ENEMY_CONSTANTS.VISION_RANGE,
      sprite: config.sprite,
    });

    this.waveEnemyIds.add(id);
  }

  /** Transition to 'cleared' once the field is empty: announce, hand the
   *  elapsed time to the caller (it pays a speed-graded bonus), and start
   *  the grace countdown into the next wave. */
  private endWave(onCleared: (waveJustCleared: number, elapsedSec: number, bySnitch: boolean) => void) {
    this.waveState = 'cleared';
    const life = WAVE_ANNOUNCE_CONSTANTS.FADEIN + WAVE_ANNOUNCE_CONSTANTS.HOLD + WAVE_ANNOUNCE_CONSTANTS.FADEOUT;
    this.announcements.push({
      text: `WAVE ${this.waveIndex + 1} CLEARED`,
      subtext: `${Math.round(this.elapsedSec)}S`,
      color: '#4ade80',
      lifetime: life,
      maxLifetime: life,
    });
    onCleared(this.waveIndex, this.elapsedSec, false);
    this.waveGraceTimer = WAVE_CONSTANTS.GRACE_PERIOD;
  }

  /** Tick down all active wave announcements and splice expired ones. */
  public tickAnnouncements(dt: number) {
    for (let i = this.announcements.length - 1; i >= 0; i--) {
      this.announcements[i].lifetime -= dt;
      if (this.announcements[i].lifetime <= 0) {
        this.announcements.splice(i, 1);
      }
    }
  }

  /**
   * Manually skip the remaining grace period and immediately start the
   * next wave.  Safe to call from a keybinding or UI button during the
   * 'cleared' phase.  Survivors carry over, same as the natural rollover.
   */
  public skip(ctx: WaveSpawnContext): boolean {
    if (this.waveState !== 'cleared' || this.waveGraceTimer <= 0) return false;
    this.waveGraceTimer = 0;
    this.startWave(this.waveIndex + 1, ctx);
    return true;
  }

  /**
   * Snitch caught — immediately end the active wave.  GameEngine awards
   * SCORE_CONSTANTS.SNITCH_POINTS before calling this; `points` is only
   * echoed into the banner subtext.  Same 'cleared' semantics as the
   * natural completion paths: onCleared fires (early = false, so the
   * early-clear bonus does NOT stack on the snitch payout) and survivors
   * carry over into the next wave.
   */
  public endWaveBySnitch(
    points: number,
    onCleared: (waveJustCleared: number, elapsedSec: number, bySnitch: boolean) => void,
  ): boolean {
    if (this.waveState !== 'active') return false;
    this.waveState = 'cleared';
    const life = WAVE_ANNOUNCE_CONSTANTS.FADEIN + WAVE_ANNOUNCE_CONSTANTS.HOLD + WAVE_ANNOUNCE_CONSTANTS.FADEOUT;
    this.announcements.push({
      text: 'SNITCH CAUGHT',
      subtext: `WAVE ${this.waveIndex + 1} CLEARED  +${points} PTS`,
      color: '#fde047',
      lifetime: life,
      maxLifetime: life,
    });
    onCleared(this.waveIndex, this.elapsedSec, true);
    this.waveGraceTimer = WAVE_CONSTANTS.GRACE_PERIOD;
    return true;
  }

  /** Clear all queued announcements — used on restart. */
  public resetAnnouncements() {
    this.announcements = [];
  }
}

/**
 * All runtime context needed to run a wave tick.  Passed to every update /
 * skip call so the WaveSystem stays decoupled from GameEngine's field
 * layout.
 */
export interface WaveSpawnContext {
  entities: GameEntity[];
  player: GameEntity;
  physics: PhysicsSystem;
  enemyScale: number;
  difficultyLevel: number;
  /** World-unit half-diagonal of the player's current viewport.  Used by
   *  spawnEnemy() to compute a minimum radial distance that keeps every
   *  enemy outside the visible window on any aspect ratio.  Computed by the
   *  caller (GameEngine) at spawn time from window size + camera zoom. */
  viewportHalfDiagonal: number;
}

// Re-export for callers that want to destructure a Vector2 from enemy spawn
// positions without pulling from the top-level types module.
export type { Vector2 };
