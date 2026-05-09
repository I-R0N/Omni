import { GameEntity, EntityType, Vector2, WaveAnnouncement } from '../../types';
import {
  DIFFICULTY_STAT_SCALES,
  ENEMY_VARIANTS,
  ENEMY_CONSTANTS,
  WAVE_CONSTANTS,
  WAVE_ANNOUNCE_CONSTANTS,
  generateWaveDef,
} from '../../constants';
import { PhysicsSystem } from './PhysicsSystem';
import { nextId } from './IdAllocator';
import { wrapPosition } from '../toroidal';

/**
 * WaveSystem — owns wave state (current index, live enemy ids, phase,
 * grace-period countdown) and the wave-spawn routine.
 *
 * Extracted from GameEngine in Phase 3 of the engine upgrade.  Unlike the
 * fully stateless Phase-2 systems, this one owns meaningful state because
 * multiple GameEngine methods need to read/write it (stats reporting, HUD,
 * completion detection, skip).  Keeping it encapsulated here lets the
 * engine treat waves as a black box instead of sprinkling wave fields
 * across the god-class.
 */
export class WaveSystem {
  public waveIndex: number = 0;
  public waveEnemyIds: Set<string> = new Set();
  public waveState: 'inactive' | 'active' | 'cleared' | 'complete' = 'inactive';
  public waveGraceTimer: number = 0;
  public announcements: WaveAnnouncement[] = [];

  /** Reset all wave state and spawn wave 0.  Skipped entirely when
   *  enemyScale is 0 (difficulty "None") — the map loads with waves
   *  disabled: no wave 1 banner, no grace-period cycling, no enemies. */
  public init(ctx: WaveSpawnContext) {
    this.waveIndex = 0;
    this.waveEnemyIds = new Set();
    this.waveState = 'inactive';
    this.waveGraceTimer = 0;
    this.announcements = [];
    if (ctx.enemyScale <= 0) return;
    this.spawn(0, ctx);
  }

  /**
   * Spawn the enemies for a given wave index.  Enemies are flanked from
   * evenly-spaced angles around the player with per-wave rotation so no two
   * waves look the same, and each spawn position is tested against static
   * tiles via the physics system so enemies never materialize inside walls.
   *
   * At enemyScale = 0 (difficulty "None") this is a no-op: waves stay
   * inactive forever so nothing cycles and the "WAVE N" banner never fires.
   */
  public spawn(index: number, ctx: WaveSpawnContext) {
    const { entities, player, physics, enemyScale, difficultyLevel, viewportHalfDiagonal } = ctx;
    if (enemyScale <= 0) return;
    this.waveIndex = index;
    this.waveEnemyIds.clear();

    const statScale = DIFFICULTY_STAT_SCALES[difficultyLevel] ?? DIFFICULTY_STAT_SCALES[3];
    const waveDef = generateWaveDef(index);
    const scaledGroups = waveDef.enemies.map(g => ({ ...g, count: Math.round(g.count * enemyScale) }));
    const totalEnemies = scaledGroups.reduce((s, g) => s + g.count, 0);
    let enemyIdx = 0;

    // Flanking: divide enemies into groups arriving from evenly-spaced angles.
    // A random base rotation ensures no two waves look the same.
    const numFlanks = totalEnemies >= 5 ? 3 : 2;
    const flankSpacing = (Math.PI * 2) / numFlanks;
    const flankBaseRotation = Math.random() * Math.PI * 2;

    for (const group of scaledGroups) {
      for (let i = 0; i < group.count; i++) {
        const flankIdx = enemyIdx % numFlanks;
        const baseAngle = flankBaseRotation + flankIdx * flankSpacing + (Math.random() - 0.5) * flankSpacing * 0.35;
        const enemyHalfSize = ENEMY_VARIANTS[group.subtype].size / 2;
        const safeRadius = enemyHalfSize + 30;
        // Minimum spawn distance keeps the enemy fully outside the visible
        // viewport, padded by the configured offscreen margin and the
        // enemy's own half-size so even its sprite edge stays off-screen.
        const minSpawnDistance = viewportHalfDiagonal + WAVE_CONSTANTS.OFFSCREEN_MARGIN + enemyHalfSize;
        let x = 0, y = 0;
        // Try up to 8 candidate positions; pick first one clear of static tiles.
        // Candidate positions are wrapped into canonical world coords so spawns
        // near a seam don't materialise at ±MAP_WIDTH off the map.
        const pos = { x: 0, y: 0 };
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
        const config = ENEMY_VARIANTS[group.subtype];
        const id = nextId(`wave_${index}_${enemyIdx}`);

        const tierMap: Partial<Record<string, number>> = {
          RAMMER_1: 1, SHOOTER_1: 1,
          RAMMER_2: 2, SHOOTER_2: 2,
          RAMMER_3: 3, SHOOTER_3: 3,
        };
        const enemyTier = tierMap[group.subtype] ?? 1;

        const scaledHealth = Math.max(1, Math.round(config.health * statScale.health));
        entities.push({
          id,
          type: EntityType.ENEMY,
          enemySubtype: group.subtype,
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
        enemyIdx++;
      }
    }

    this.waveState = 'active';

    // Wave start announcement
    const totalLife = WAVE_ANNOUNCE_CONSTANTS.FADEIN + WAVE_ANNOUNCE_CONSTANTS.HOLD + WAVE_ANNOUNCE_CONSTANTS.FADEOUT;
    this.announcements.push({
      text: `WAVE ${index + 1}`,
      subtext: 'GET READY',
      color: '#ffffff',
      lifetime: totalLife,
      maxLifetime: totalLife,
    });
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
   * Check if every tracked enemy in the active wave is dead.  If so,
   * transitions state to 'cleared', starts the grace-period countdown,
   * pushes the clear announcement, and invokes `onCleared` so the caller
   * can drop a reward (e.g. a health drop on milestone waves).
   */
  public checkCompletion(
    entities: GameEntity[],
    onCleared: (waveJustCleared: number) => void,
  ) {
    if (this.waveState !== 'active') return;

    let allDead = true;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (this.waveEnemyIds.has(e.id) && e.active && !e.isExploding) {
        allDead = false;
        break;
      }
    }
    if (!allDead) return;

    this.waveState = 'cleared';

    // Wave clear announcement
    const clearLife = WAVE_ANNOUNCE_CONSTANTS.FADEIN + WAVE_ANNOUNCE_CONSTANTS.HOLD + WAVE_ANNOUNCE_CONSTANTS.FADEOUT;
    this.announcements.push({
      text: `WAVE ${this.waveIndex + 1} CLEAR`,
      color: '#4ade80',
      lifetime: clearLife,
      maxLifetime: clearLife,
    });

    onCleared(this.waveIndex);

    // Always start the grace period — waves are infinite
    this.waveGraceTimer = WAVE_CONSTANTS.GRACE_PERIOD;
  }

  /**
   * Tick the grace-period countdown after a wave is cleared and spawn the
   * next wave when it expires.
   */
  public tickGrace(dt: number, ctx: WaveSpawnContext) {
    if (this.waveState !== 'cleared' || this.waveGraceTimer <= 0) return;
    this.waveGraceTimer -= dt;
    if (this.waveGraceTimer <= 0) {
      this.waveGraceTimer = 0;
      this.spawn(this.waveIndex + 1, ctx);
    }
  }

  /**
   * Manually skip the remaining grace period and immediately spawn the
   * next wave.  Safe to call from a keybinding or UI button during the
   * 'cleared' phase.
   */
  public skip(ctx: WaveSpawnContext): boolean {
    if (this.waveState !== 'cleared' || this.waveGraceTimer <= 0) return false;
    this.waveGraceTimer = 0;
    this.spawn(this.waveIndex + 1, ctx);
    return true;
  }

  /** Clear all queued announcements — used on restart. */
  public resetAnnouncements() {
    this.announcements = [];
  }
}

/**
 * All runtime context needed to spawn a wave.  Passed to every spawn /
 * grace / skip call so the WaveSystem stays decoupled from GameEngine's
 * field layout.
 */
export interface WaveSpawnContext {
  entities: GameEntity[];
  player: GameEntity;
  physics: PhysicsSystem;
  enemyScale: number;
  difficultyLevel: number;
  /** World-unit half-diagonal of the player's current viewport.  Used by
   *  spawn() to compute a minimum radial distance that keeps every enemy
   *  outside the visible window on any aspect ratio.  Computed by the
   *  caller (GameEngine) at spawn time from window size + camera zoom. */
  viewportHalfDiagonal: number;
}

// Re-export for callers that want to destructure a Vector2 from enemy spawn
// positions without pulling from the top-level types module.
export type { Vector2 };
