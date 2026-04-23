import { GameEntity, EntityType, Vector2 } from '../../types';
import { GLITTER_TRAIL_CONSTANTS, MAX_PARTICLES } from '../../constants';
import { nextId } from './IdAllocator';

/**
 * ParticleSystem — spawns and manages decorative particle entities.
 *
 * Extracted from GameEngine in Phase 2 of the engine upgrade.  Owns no state
 * of its own; callers pass the current map's entity list so particles can be
 * appended alongside other world entities.  A hard cap on live particles is
 * enforced after each burst via {@link enforceCap} — purely visual entities,
 * so FIFO dropping is safe.
 */
export class ParticleSystem {
  /**
   * Push `count` particle entities into `entities` around `position`.
   * Options mirror the previous GameEngine helper so all existing call sites
   * port over verbatim.
   */
  public spawn(
    entities: GameEntity[],
    position: Vector2,
    count: number,
    color: string,
    options?: {
      speedMin?: number;
      speedMax?: number;
      sizeMin?: number;
      sizeMax?: number;
      lifetimeMin?: number;
      lifetimeMax?: number;
      spreadAngle?: number; // center angle (radians); undefined = full circle
      spreadCone?: number;  // half-cone in radians; undefined = Math.PI (full circle)
      baseVelocity?: Vector2;
      positionJitter?: number; // uniform random offset radius around `position`; default 0
    }
  ) {
    const {
      speedMin = 2, speedMax = 5,
      sizeMin = 1, sizeMax = 3,
      lifetimeMin = 0.2, lifetimeMax = 0.45,
      spreadAngle, spreadCone,
      baseVelocity,
      positionJitter = 0,
    } = options ?? {};

    const halfCone = spreadCone ?? Math.PI;

    for (let i = 0; i < count; i++) {
      const angle = spreadAngle !== undefined
        ? spreadAngle + (Math.random() - 0.5) * 2 * halfCone
        : Math.random() * Math.PI * 2;
      const speed = speedMin + Math.random() * (speedMax - speedMin);
      const size  = sizeMin + Math.random() * (sizeMax - sizeMin);
      const life  = lifetimeMin + Math.random() * (lifetimeMax - lifetimeMin);

      // Optional position scatter — useful for spawning glittery clouds
      // over an area (e.g. nebula merge glimmer) instead of a single point.
      let px = position.x;
      let py = position.y;
      if (positionJitter > 0) {
        const jAngle = Math.random() * Math.PI * 2;
        const jDist  = Math.sqrt(Math.random()) * positionJitter; // uniform area
        px += Math.cos(jAngle) * jDist;
        py += Math.sin(jAngle) * jDist;
      }

      entities.push({
        id: nextId('part'),
        type: EntityType.PARTICLE,
        position: { x: px, y: py },
        velocity: {
          x: Math.cos(angle) * speed + (baseVelocity?.x ?? 0),
          y: Math.sin(angle) * speed + (baseVelocity?.y ?? 0),
        },
        size:      { x: size, y: size },
        rotation:  0,
        color,
        active:    true,
        health:    1,
        maxHealth: 1,
        lifetime:  life,
        maxLifetime: life,
        mass:      0.1,
      });
    }

    this.enforceCap(entities);
  }

  /**
   * Glitter trail emission — spawns additive sparkles trailing behind a
   * moving entity along its velocity vector.  Density is triangularly
   * distributed across the emitter's width (denser center, sparser edges).
   * Particles have zero velocity so they stay put while the emitter moves
   * forward, naturally forming a trail.
   */
  public spawnGlitterTrail(entities: GameEntity[], emitter: GameEntity) {
    // Temporarily disabled while tuning the thrust-ring trail.
    return;
    const v = emitter.velocity;
    const speedSq = v.x * v.x + v.y * v.y;
    if (speedSq < GLITTER_TRAIL_CONSTANTS.MIN_SPEED_SQ) return;

    const speed = Math.sqrt(speedSq);
    const fx = v.x / speed;
    const fy = v.y / speed;
    const perpX = -fy;
    const perpY = fx;

    const halfWidth = emitter.size.x / 2;
    // Spawn at the emitter's tail so particles appear behind, not on top of, the sprite
    const tailX = emitter.position.x - fx * halfWidth;
    const tailY = emitter.position.y - fy * halfWidth;

    const { COUNT_PER_FRAME, LIFETIME_MIN, LIFETIME_MAX, SIZE_MIN, SIZE_MAX, COLORS: GCOLORS } = GLITTER_TRAIL_CONSTANTS;

    for (let i = 0; i < COUNT_PER_FRAME; i++) {
      // Triangular distribution in [-1, 1] peaked at 0 — dense center, sparse edges
      const u = Math.random() - Math.random();
      const lateral = u * halfWidth;

      const life = LIFETIME_MIN + Math.random() * (LIFETIME_MAX - LIFETIME_MIN);
      const size = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN);
      const color = GCOLORS[Math.floor(Math.random() * GCOLORS.length)];

      entities.push({
        id: nextId('glit'),
        type: EntityType.PARTICLE,
        position: {
          x: tailX + perpX * lateral,
          y: tailY + perpY * lateral,
        },
        velocity: { x: 0, y: 0 },
        size: { x: size, y: size },
        rotation: 0,
        color,
        active: true,
        health: 1,
        maxHealth: 1,
        lifetime: life,
        maxLifetime: life,
        mass: 0.01,
      });
    }
  }

  /**
   * Hard cap on live particles.  If exceeded, deactivates the oldest
   * particles first (FIFO by entity-list order).  Safe because particles are
   * purely decorative — dropping old ones has no gameplay effect.
   */
  public enforceCap(entities: GameEntity[]) {
    let count = 0;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.active && e.type === EntityType.PARTICLE) count++;
    }
    if (count <= MAX_PARTICLES) return;
    let toDrop = count - MAX_PARTICLES;
    for (let i = 0; i < entities.length && toDrop > 0; i++) {
      const e = entities[i];
      if (e.active && e.type === EntityType.PARTICLE) {
        e.active = false;
        toDrop--;
      }
    }
  }
}
