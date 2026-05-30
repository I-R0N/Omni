import { GameEntity, EntityType, Vector2 } from '../../types';
import { GLITTER_TRAIL_CONSTANTS, MAX_PARTICLES } from '../../constants';
import { nextId } from './IdAllocator';
import { enforceTypeCap } from './enforceCap';

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
  // Object pool — particles churn through tens of thousands of spawn/
  // despawn cycles per minute on active play.  Reusing entity objects
  // here eliminates ~all transient GC pressure for particles, which
  // smooths out frame times (no periodic 1-2 ms GC pauses) and saves
  // the literal-allocation cost on every spawn.  Pool is bounded so a
  // long quiet period after a burst doesn't pin a huge heap.
  private _pool: GameEntity[] = [];
  private readonly POOL_CAP = 512;

  /**
   * Return a deactivated particle entity to the pool for later reuse.
   * Called by the GameEngine compaction pass when it would otherwise
   * have left an inactive particle for the GC.  Type-checked here so a
   * mistaken call on a non-particle is a silent no-op.
   *
   * Special-subtype particles (explosion-ring spawned by GameEngine
   * .spawnExplosionRingParticle, lightning-arc spawned by the chain
   * routing) ride on EntityType.PARTICLE but carry render flags
   * (`isExplosionRing`, `isLightningArc`, `arcPoints`, …) that the
   * renderer dispatches on.  Without clearing those flags here, the
   * next normal particle that reuses this slot would render as an
   * explosion ring or arc — visible as stray annular shapes wherever
   * sparkle / glitter / debris bursts spawn.
   */
  public releaseToPool(e: GameEntity): void {
    if (e.type !== EntityType.PARTICLE) return;
    if (this._pool.length >= this.POOL_CAP) return;
    // Clear special-subtype flags so the next reuse starts as a plain
    // particle.  Cheap (~6 undefined writes) compared to the dispatch
    // cost of one frame's mis-render.
    e.isExplosionRing = undefined;
    e.isLightningArc = undefined;
    e.arcPoints = undefined;
    e.explosionRadius = undefined;
    e.explosionDamage = undefined;
    e.explosionKnockback = undefined;
    e.ownerType = undefined;
    e.hitEntityIds = undefined;
    e.validHitIds = undefined;
    this._pool.push(e);
  }

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

      const vx = Math.cos(angle) * speed + (baseVelocity?.x ?? 0);
      const vy = Math.sin(angle) * speed + (baseVelocity?.y ?? 0);
      const pooled = this._pool.pop();
      if (pooled) {
        // Reuse path: mutate the pooled entity in place.  Field order
        // and set is identical to the literal path below so v8 keeps
        // the hidden class stable across both forms.
        pooled.id = nextId('part');
        pooled.type = EntityType.PARTICLE;
        pooled.position.x = px; pooled.position.y = py;
        pooled.velocity.x = vx; pooled.velocity.y = vy;
        pooled.size.x = size; pooled.size.y = size;
        pooled.rotation = 0;
        pooled.color = color;
        pooled.active = true;
        pooled.health = 1;
        pooled.maxHealth = 1;
        pooled.lifetime = life;
        pooled.maxLifetime = life;
        pooled.mass = 0.1;
        entities.push(pooled);
      } else {
        entities.push({
          id: nextId('part'),
          type: EntityType.PARTICLE,
          position: { x: px, y: py },
          velocity: { x: vx, y: vy },
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
    }

    this.enforceCap(entities);
  }

  /**
   * Glitter trail emission — spawns additive sparkles in a short segment
   * aligned with the emitter's velocity vector, starting slightly upstream
   * (ahead of the sprite) and ending slightly downstream (behind it).
   * Particles have zero velocity, so while the emitter moves forward the
   * sparkles appear to flow past it in the direction of travel.
   */
  public spawnGlitterTrail(entities: GameEntity[], emitter: GameEntity) {
    const v = emitter.velocity;
    const speedSq = v.x * v.x + v.y * v.y;
    if (speedSq < GLITTER_TRAIL_CONSTANTS.MIN_SPEED_SQ) return;

    const speed = Math.sqrt(speedSq);
    const fx = v.x / speed;
    const fy = v.y / speed;
    const perpX = -fy;
    const perpY = fx;

    // Line extent slightly exceeds the sprite on each end (±0.65 × size),
    // and spreads across the sprite's full width perpendicular to velocity.
    const axisExtent = emitter.size.x * 0.65;
    const perpExtent = emitter.size.x * 0.5;
    const cx = emitter.position.x;
    const cy = emitter.position.y;

    const { COUNT_PER_FRAME, LIFETIME_MIN, LIFETIME_MAX, SIZE_MIN, SIZE_MAX, COLORS: GCOLORS } = GLITTER_TRAIL_CONSTANTS;

    for (let i = 0; i < COUNT_PER_FRAME; i++) {
      // Uniform along-axis distribution in [-1, 1] so sparkles are evenly
      // spaced from the upstream end to the downstream end of the segment.
      const u = Math.random() * 2 - 1;
      const along = u * axisExtent;
      // Triangular perpendicular spread (peaked at centreline) so sparkles
      // cover the sprite's width without smearing beyond the hull.
      const pu = Math.random() - Math.random();
      const jitter = pu * perpExtent;

      const life = LIFETIME_MIN + Math.random() * (LIFETIME_MAX - LIFETIME_MIN);
      const size = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN);
      const color = GCOLORS[Math.floor(Math.random() * GCOLORS.length)];

      const gpx = cx + fx * along + perpX * jitter;
      const gpy = cy + fy * along + perpY * jitter;
      const pooled = this._pool.pop();
      if (pooled) {
        pooled.id = nextId('glit');
        pooled.type = EntityType.PARTICLE;
        pooled.position.x = gpx; pooled.position.y = gpy;
        pooled.velocity.x = 0; pooled.velocity.y = 0;
        pooled.size.x = size; pooled.size.y = size;
        pooled.rotation = 0;
        pooled.color = color;
        pooled.active = true;
        pooled.health = 1;
        pooled.maxHealth = 1;
        pooled.lifetime = life;
        pooled.maxLifetime = life;
        pooled.mass = 0.01;
        entities.push(pooled);
      } else {
        entities.push({
          id: nextId('glit'),
          type: EntityType.PARTICLE,
          position: { x: gpx, y: gpy },
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
  }

  /**
   * Hard cap on live particles.  If exceeded, deactivates the oldest
   * particles first (FIFO by entity-list order).  Safe because particles are
   * purely decorative — dropping old ones has no gameplay effect.
   * Implementation in `enforceCap.ts` — shared with ProjectileSystem.
   */
  public enforceCap(entities: GameEntity[]) {
    enforceTypeCap(entities, EntityType.PARTICLE, MAX_PARTICLES);
  }
}
