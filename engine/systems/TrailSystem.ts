import { GameEntity, EntityType, TrailPoint } from '../../types';
import { TRAIL_CONSTANTS } from '../../constants';
import { wrapDeltaX, wrapDeltaY } from '../toroidal';

/**
 * TrailSystem — ticks down all trail-point arrays and handles projectile
 * trail emission.  Extracted from GameEngine in Phase 2.  Stateless; all
 * data lives on the entities themselves.
 */
export class TrailSystem {
  private static readonly PROJECTILE_TRAIL_LIFETIME = 0.25;
  private static readonly PROJECTILE_TRAIL_SCALE = 0.5;
  // Bouncer beams are visualized entirely by their trail, which fades
  // almost instantly so the beam reads as a short moving line segment.
  // Target visible beam length ≈ 50 units at speed 9 ≈ 540 units/sec.
  private static readonly BOUNCER_TRAIL_LIFETIME = 0.09;
  private static readonly BOUNCER_TRAIL_SCALE = 0.55;

  /**
   * Tick a trail array: decrement each point's lifetime, apply per-point
   * drift velocity, and drop expired entries.  Shared between the active
   * player trail and detached trails from prior thrust events.
   *
   * Uses a write-index compaction pass instead of splice-in-reverse so the
   * worst case (many simultaneous expirations, e.g. when a sustained thrust
   * ends and the tail of the trail rolls over) is O(n) rather than O(n²).
   */
  public tickTrail(trail: TrailPoint[], dt: number) {
    let writeIdx = 0;
    for (let i = 0; i < trail.length; i++) {
      const tp = trail[i];
      tp.lifetime -= dt;
      if (tp.vx !== undefined) tp.x += tp.vx;
      if (tp.vy !== undefined) tp.y += tp.vy;
      if (tp.lifetime > 0) {
        trail[writeIdx++] = tp;
      }
    }
    trail.length = writeIdx;
  }

  /**
   * Update trail points on every active projectile: decay existing points
   * and emit a new point when the projectile has moved far enough.
   */
  public updateProjectileTrails(entities: GameEntity[], dt: number) {
    const MIN_DIST_SQ = TRAIL_CONSTANTS.MIN_DISTANCE_SQ;

    for (let i = 0; i < entities.length; i++) {
      const p = entities[i];
      if (!p.active || p.type !== EntityType.PROJECTILE) continue;

      const lifetime = p.isBouncer ? TrailSystem.BOUNCER_TRAIL_LIFETIME : TrailSystem.PROJECTILE_TRAIL_LIFETIME;
      const scale    = p.isBouncer ? TrailSystem.BOUNCER_TRAIL_SCALE    : TrailSystem.PROJECTILE_TRAIL_SCALE;

      // Decay existing trail points (write-index avoids O(n) splice shifts)
      if (p.trail) {
        let writeIdx = 0;
        for (let j = 0; j < p.trail.length; j++) {
          p.trail[j].lifetime -= dt;
          if (p.trail[j].lifetime > 0) {
            p.trail[writeIdx++] = p.trail[j];
          }
        }
        p.trail.length = writeIdx;
      } else {
        p.trail = [];
      }

      // Add new trail point if far enough from last.  Toroidal delta so
      // a projectile that just wrapped across a seam doesn't read as a
      // giant jump and emit a runaway burst of trail points.
      const t = p.trail;
      const lastPos = t.length > 0 ? t[t.length - 1] : null;
      const dx = lastPos ? wrapDeltaX(lastPos.x, p.position.x) : 1;
      const dy = lastPos ? wrapDeltaY(lastPos.y, p.position.y) : 1;
      if (!lastPos || (dx * dx + dy * dy > MIN_DIST_SQ)) {
        t.push({
          x: p.position.x,
          y: p.position.y,
          lifetime,
          maxLifetime: lifetime,
          scale,
        });
      }
    }
  }
}
