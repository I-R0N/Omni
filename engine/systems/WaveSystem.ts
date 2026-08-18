import { GameEntity, EntityType, EnemySubtype, Vector2, WaveAnnouncement } from '../../types';
import {
  DIFFICULTY_STAT_SCALES,
  ENEMY_VARIANTS,
  ENEMY_CONSTANTS,
  ENEMY_TRAITS,
  enemyHpMult,
  enemyDamageMult,
  WAVE_CONSTANTS,
  WAVE_ANNOUNCE_CONSTANTS,
  SCORE_CONSTANTS,
  SHIELD_CONSTANTS,
  TIMED_WAVE_CONFIG,
  BOSS_CONSTANTS,
  BOSS_DEFS,
  bossForWave,
  isBossWave,
  getWaveDurationSec,
  getWaveSpawnBudget,
  buildWaveSpawnList,
  buildBossWaveSpawnList,
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
  /** STAGE offset added to `waveIndex` for every DIFFICULTY and BOSS-ROTATION
   *  lookup.  Wave progress restarts at 1 in each new arena (WaveSystem.init
   *  zeroes waveIndex), so without this a stage-5 descent would be exactly as
   *  easy as stage 1 and would re-fight the first boss.  GameEngine sets it to
   *  `stageIndex × STAGE_WAVE_COUNT`, which makes the enemy-growth
   *  curve and the boss rotation both continue across a descent as if the
   *  waves had run consecutively.  It deliberately does NOT shift the DISPLAY
   *  wave number — the HUD still counts 1..STAGE_WAVE_COUNT within the stage. */
  public waveOffset: number = 0;
  /** Set once a stage's CAPSTONE BOSS is down: the ladder for this arena is
   *  finished, so no further wave ever starts here.  The player mops up what
   *  is already on the field and then chooses a rift.  Cleared by init(), so
   *  the next arena starts its own ladder normally. */
  public halted: boolean = false;
  /** Is the wave in progress the boss's OWN capstone wave?  Read by
   *  `haltForBoss` to tell a capstone (whose escort IS the fight) from a
   *  boss warped in mid-ladder by the debug menu (whose queued ordinary
   *  spawns are not). */
  private capstoneWave: boolean = false;
  /** The index the scaling / rotation tables see. */
  private get scaledIndex(): number { return this.waveIndex + this.waveOffset; }
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
   *  enemyScale is 0 (difficulty "None") or `enabled` is false (wave-free
   *  maps, e.g. the Overworld) — the map loads with waves disabled: no
   *  wave 1 banner, no grace-period cycling, no enemies. */
  public init(ctx: WaveSpawnContext, enabled: boolean = true) {
    this.halted = false;
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
    if (!enabled || ctx.enemyScale <= 0) return;
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
        if (!this.halted) this.startWave(this.waveIndex + 1, ctx);
      }
    }
  }

  /** Begin a wave: compute the spawn-stream window + difficulty-scaled
   *  budget, build the subtype list and spawn schedule, announce.  Note
   *  `durationSec` is now only the window over which enemies STREAM IN —
   *  it does not end the wave (completion does). */
  private startWave(index: number, ctx: WaveSpawnContext) {
    this.waveIndex = index;
    this.capstoneWave = false;
    this.waveEnemyIds.clear();
    this.elapsedSec = 0;
    this.nextSpawnIdx = 0;
    this.lastSpawnAtSec = -Infinity;
    this.durationSec = getWaveDurationSec(index);

    // Boss capstone ((h)): the LAST wave of every stage is the boss's OWN wave
    // — it warps a boss in immediately and streams only that boss's designed
    // ESCORT (BossDef.companions), on a cut-down budget.  Because it is its own
    // wave, wave `WAVE_INTERVAL` must be fully cleared before the capstone ever
    // starts.  A DBG forced-enemy test suppresses it so enemy-isolation runs
    // stay clean.
    const scaled = index + this.waveOffset;
    const boss = !ctx.forcedEnemy && isBossWave(scaled) ? bossForWave(scaled) : null;
    const budget = Math.max(1, Math.round(
      getWaveSpawnBudget(index) * ctx.enemyScale * (boss ? BOSS_CONSTANTS.COMPANION_BUDGET_FRAC : 1),
    ));
    this.spawnList = boss
      ? buildBossWaveSpawnList(boss, budget)
      : buildWaveSpawnList(index, budget, ctx.forcedEnemy);
    this.scheduleSpawns(this.spawnList.length);

    this.waveState = 'active';
    this.capstoneWave = !!boss;
    const totalLife = WAVE_ANNOUNCE_CONSTANTS.FADEIN + WAVE_ANNOUNCE_CONSTANTS.HOLD + WAVE_ANNOUNCE_CONSTANTS.FADEOUT;
    if (boss) {
      this.spawnBoss(boss, ctx);
      this.announcements.push({
        text: BOSS_DEFS[boss]?.name ?? 'BOSS',
        subtext: `WAVE ${index + 1}  ·  CAPSTONE`,
        color: '#f87171',
        lifetime: totalLife,
        maxLifetime: totalLife,
      });
    } else {
      this.announcements.push({
        text: `WAVE ${index + 1}`,
        subtext: `DESTROY ${budget} HOSTILE${budget === 1 ? '' : 'S'}`,
        color: '#ffffff',
        lifetime: totalLife,
        maxLifetime: totalLife,
      });
    }
  }

  /**
   * Spawn the wave's boss on the offscreen ring and track it like any other
   * COUNTED wave enemy — so the existing clear-the-field completion rule
   * already gates on killing it, with zero boss-specific completion plumbing.
   * The caller's `onBossSpawn` hook fires the entrance rift VFX.
   */
  private spawnBoss(subtype: EnemySubtype, ctx: WaveSpawnContext): GameEntity {
    const id = nextId(`boss_${this.waveIndex}`);
    const pos = this.findSpawnPoint(subtype, ctx);
    const boss = this.buildEnemy(id, subtype, pos.x, pos.y, ctx, true);
    ctx.entities.push(boss);
    this.waveEnemyIds.add(id);
    ctx.onBossSpawn?.(boss);
    return boss;
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

  /** Count tracked wave enemies still alive that gate completion (exploding
   *  ones count as dead, matching the old kill-all semantics).
   *
   *  Stage 2b: an enemy with `countsTowardWave === false` is skipped — these
   *  are entities spawned BY other entities / that replicate (nest brood,
   *  bubble offspring).  The wave ends when the COUNTED enemies (the ones
   *  streamed from the spawn budget — nests, original bubbles, etc.) are all
   *  dead; uncounted brood may still be alive and simply carry over as
   *  survivors.  Non-enemy roamers (Snitch / dragon) are INTERACTABLEs and
   *  never enter `waveEnemyIds`, so they never gate a wave at all.
   *
   *  This also gates the live concurrency cap in emitDueSpawns, so uncounted
   *  brood don't throttle the wave's own spawn stream. */
  private countLiveTracked(entities: GameEntity[]): number {
    let live = 0;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (this.waveEnemyIds.has(e.id) && e.active && !e.isExploding
          && e.countsTowardWave !== false) live++;
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
    const pos = this.findSpawnPoint(subtype, ctx);
    const id = nextId(`wave_${this.waveIndex}_${this.nextSpawnIdx}`);
    const enemy = this.buildEnemy(id, subtype, pos.x, pos.y, ctx, true);
    ctx.entities.push(enemy);
    this.waveEnemyIds.add(id);
  }

  /** Pick an offscreen-ring position clear of static tiles for `subtype`.
   *  Returns the shared `spawnPos` scratch — read it immediately, never keep
   *  the reference.  Shared by the stream spawn and the boss capstone spawn. */
  private findSpawnPoint(subtype: EnemySubtype, ctx: WaveSpawnContext): Vector2 {
    const { player, physics, viewportHalfDiagonal } = ctx;
    const config = ENEMY_VARIANTS[subtype];
    const enemyHalfSize = config.size / 2;
    const safeRadius = enemyHalfSize + 30;
    // Minimum spawn distance keeps the enemy fully outside the visible
    // viewport, padded by the configured offscreen margin and the enemy's
    // own half-size so even its sprite edge stays off-screen.
    const minSpawnDistance = viewportHalfDiagonal + WAVE_CONSTANTS.OFFSCREEN_MARGIN + enemyHalfSize;
    const baseAngle = Math.random() * Math.PI * 2;
    const pos = this.spawnPos;
    // Try up to 8 candidate positions; pick first one clear of static tiles.
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = baseAngle + (attempt / 8) * Math.PI * 2 * 0.25;
      const dist = minSpawnDistance + Math.random() * WAVE_CONSTANTS.SPAWN_RING_SPREAD;
      pos.x = player.position.x + Math.cos(a) * dist;
      pos.y = player.position.y + Math.sin(a) * dist;
      wrapPosition(pos);
      if (physics.isPositionClear(pos.x, pos.y, safeRadius)) break;
    }
    return pos;
  }

  /**
   * Construct an enemy entity at (x, y) with the per-difficulty + per-wave
   * stat scaling and the per-archetype field stamping (shield / arc / detonate)
   * — shared by the offscreen-ring wave spawn and the nest brood spawn.  Does
   * NOT push or track; the caller does.  `counts` → wave-completion accounting
   * (Stage 2b): false marks brood that don't gate the wave.
   */
  private buildEnemy(
    id: string, subtype: EnemySubtype, x: number, y: number,
    ctx: WaveSpawnContext, counts: boolean,
  ): GameEntity {
    const statScale = DIFFICULTY_STAT_SCALES[ctx.difficultyLevel] ?? DIFFICULTY_STAT_SCALES[3];
    const config = ENEMY_VARIANTS[subtype];

    const tierMap: Partial<Record<string, number>> = {
      RAMMER_1: 1, SHOOTER_1: 1,
      RAMMER_2: 2, SHOOTER_2: 2,
      RAMMER_3: 3, SHOOTER_3: 3,
      KAMIKAZE: 2, BULWARK: 2, TURRET: 3,
      SWARM: 1, NEST: 3, BUBBLE: 2,
      // Bosses sit above the tier ladder — the tier only scales the normal
      // kill points; the real payout is the BOSS_CONSTANTS burst on top.
      BOSS_WARDEN: 4, BOSS_SCATTER: 4, BOSS_SIEGE: 4,
    };
    const enemyTier = tierMap[subtype] ?? 1;

    // Per-wave scaling on top of the per-difficulty multipliers (see
    // ENEMY_SCALING).  HP scales at spawn; damage rides a per-enemy
    // damageMult read by the ram + projectile paths.
    const scaledHealth = Math.max(1, Math.round(config.health * statScale.health * enemyHpMult(this.scaledIndex)));
    const dmgMult = (statScale.damage ?? 1) * enemyDamageMult(this.scaledIndex);
    const enemy: GameEntity = {
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
      damageMult: dmgMult,
      armor: ENEMY_TRAITS[subtype]?.armor,
      evasive: ENEMY_TRAITS[subtype]?.evasive,
      frontShield: ENEMY_TRAITS[subtype]?.frontShield,
      regen: ENEMY_TRAITS[subtype]?.regen,
      poise: config.poise,
      contactDamage: config.contactDamage,
      diesOnContact: config.diesOnContact,
      visionRange: ENEMY_CONSTANTS.VISION_RANGE,
      enemyShape: config.shape,
      aimLaser: config.aimLaser,
    };
    // Stage 2b: brood (nest-spawned) don't gate wave completion.  Ambient
    // fauna (Stage 5 bubble) NEVER gate, however they're built.
    if (!counts || config.ambient) enemy.countsTowardWave = false;

    // Bulwark shield (Stage 0): seed shield + maxShield + slow regen.  The
    // generalized PhysicsSystem absorption path soaks hits for any shielded
    // entity; recharge ticks already run for any entity in updatePhysics.
    if (config.shield !== undefined) {
      enemy.shield = config.shield;
      enemy.maxShield = config.shield;
      enemy.shieldRechargeRate = config.shieldRegen ?? SHIELD_CONSTANTS.RECHARGE_RATE;
      enemy.shieldRechargeTimer = 0;
      // Player-tracking directional arc (Bulwark): seed the sector half-width
      // + max slew rate and a random start angle (AISystem then slews it
      // toward the player each step).
      if (config.shieldArc) {
        enemy.shieldArcHalfWidth = (config.shieldArc.deg * Math.PI / 180) / 2;
        enemy.shieldArcSpin = config.shieldArc.slew;
        enemy.shieldArcAngle = Math.random() * Math.PI * 2;
      }
    }

    // Nest spawner (Stage 4): seed the brood spawn timer so it staggers.
    if (config.spawner) {
      enemy.spawnTimer = config.spawner.interval * (0.4 + Math.random() * 0.6);
    }

    // Boss ((h)): mark it so the HUD bar / render aura / payout paths pick it
    // up.  The phase itself is applied by GameEngine.updateBosses on the first
    // tick (phase 0 falls out of the normal health-fraction check), which keeps
    // ONE code path responsible for phase state.
    if (BOSS_DEFS[subtype]) {
      enemy.isBoss = true;
      enemy.bossPhase = -1; // "no phase applied yet" → phase 0 stamps next tick
    }

    // Bubble consumer (Stage 5): copy the consume config onto the entity so
    // GameEngine.updateConsumers feeds it nearby shards (clone so per-entity
    // growth never mutates the shared variant table).
    if (config.consume) {
      enemy.consume = { ...config.consume };
    }
    // Third-party fauna (Stage 5): enemy fire can hit it + it retaliates against
    // any attacker.
    if (config.thirdParty) enemy.thirdParty = true;

    // Kamikaze detonation payload (Stage 0): stamp the AoE config.  Blast
    // damage rides the per-wave damageMult, matching how the ram + projectile
    // paths scale.  Detonation itself is instant on contact (PhysicsSystem).
    if (config.detonate) {
      const d = config.detonate;
      enemy.explosionRadius = d.radius;
      enemy.explosionDamage = d.damage * dmgMult;
      enemy.explosionKnockback = d.knockback;
    }

    return enemy;
  }

  /**
   * Spawn an enemy at a given world position (nest brood) rather than the
   * offscreen ring.  `counts` defaults false → the brood don't gate wave
   * completion (Stage 2b).  Scatters slightly off `pos`.  Returns the entity.
   */
  public spawnAt(subtype: EnemySubtype, pos: Vector2, ctx: WaveSpawnContext, counts: boolean = false): GameEntity {
    const id = nextId(`brood_${this.waveIndex}`);
    const jitter = ENEMY_VARIANTS[subtype].size;
    const x = pos.x + (Math.random() - 0.5) * jitter;
    const y = pos.y + (Math.random() - 0.5) * jitter;
    const enemy = this.buildEnemy(id, subtype, x, y, ctx, counts);
    enemy.velocity.x = (Math.random() - 0.5) * 4;
    enemy.velocity.y = (Math.random() - 0.5) * 4;
    ctx.entities.push(enemy);
    this.waveEnemyIds.add(id);
    return enemy;
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

  /**
   * A BOSS IS ON THE FIELD — stop the ladder (user call).
   *
   * Waves used to keep coming while a boss was alive and to resume after it
   * died: the ordinary stream ran underneath the capstone, and a boss warped
   * in from the debug menu did not interrupt the ladder at all.  A boss
   * fight with a wave arriving on top of it is two encounters at once, and
   * neither reads.
   *
   * So the ladder ENDS here.  `halted` stops the next wave from ever
   * starting — including after the boss dies, which is the second half of
   * the complaint — and it is only cleared by `init`, i.e. by loading a map,
   * which is the deliberate way to get a fresh ladder.
   *
   * The one thing NOT cancelled is a capstone's own escort: `BossDef.
   * companions` is the boss's designed encounter, not the ladder. A boss
   * warped in mid-wave is the opposite case — the ordinary enemies still
   * queued behind it belong to a wave that is now over, so they are dropped
   * and the wave ends when the field clears.
   *
   * This is deliberately blunt while the wave/boss relationship is being
   * redesigned; it is the smallest change that makes a boss fight the only
   * thing happening.
   */
  public haltForBoss() {
    this.halted = true;
    // `halted` alone would already stop the next wave (it is checked at the
    // bottom of the countdown), but a live timer keeps the HUD advertising a
    // wave that is not coming — and offering a "tap to skip" that does
    // nothing.  Zero it.
    this.waveGraceTimer = 0;
    if (!this.capstoneWave && this.waveState === 'active') {
      this.nextSpawnIdx = this.spawnList.length;
    }
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
    if (this.halted) return false;
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
  /** DBG enemy-test override: when set, every spawn is this subtype. */
  forcedEnemy?: EnemySubtype | null;
  /** Fired once when a boss-wave capstone warps in ((h)) — GameEngine uses it
   *  for the entrance rift VFX + the live-boss handle.  Absent → no VFX. */
  onBossSpawn?: (boss: GameEntity) => void;
}

// Re-export for callers that want to destructure a Vector2 from enemy spawn
// positions without pulling from the top-level types module.
export type { Vector2 };
