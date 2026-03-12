
import { BaseMapLayer } from './MapClasses';
import { MapType } from '../../types';

/**
 * InfiniteSpaceMap - Phase 1 Space Game Engine
 *
 * A single, boundless space map used by SpaceGameEngine.
 * No portals, no layer transitions, no planets.
 * Asteroids populate the area around the player and are managed
 * dynamically by SpaceGameEngine (despawn when far, respawn nearby).
 *
 * Uses MapType.SOLAR_SYSTEM so PLAYER_MOVEMENT_CONFIG and physics
 * constants remain tuned for fast dogfighting-style space movement.
 */
export class InfiniteSpaceMap extends BaseMapLayer {
  constructor() {
    super('infinite_space', 'Deep Space', MapType.SOLAR_SYSTEM);
  }

  public init(): void {
    this.entities = [];
    // Scatter initial asteroids outward from origin so the player spawns
    // in a sparse field rather than on top of geometry.
    this.spawnAsteroids(100, 20, 120, 3000, 2.0);
    this.initialized = true;
  }

  /**
   * Public wrapper around the protected BaseMapLayer.createAsteroid().
   * SpaceGameEngine calls this to dynamically respawn asteroids near
   * the player as they drift away or are destroyed.
   */
  public spawnAsteroid(
    x: number,
    y: number,
    size: number,
    speedMultiplier: number = 2.0
  ) {
    return this.createAsteroid(x, y, size, speedMultiplier);
  }
}
