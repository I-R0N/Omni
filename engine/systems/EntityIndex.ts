import { GameEntity, EntityType } from '../../types';

/**
 * EntityIndex — type-filtered candidate lists rebuilt once per sim step.
 *
 * Phase 4 of the engine upgrade.  Multiple systems used to scan the master
 * entity list independently ("find all active enemies", "find all
 * projectiles", "find all asteroids for gravity"), each a full O(N) walk.
 * EntityIndex performs a single O(N) classification pass and exposes the
 * filtered slices so every downstream consumer stays O(matches) instead
 * of O(all entities).
 *
 * Callers are expected to call {@link rebuild} at the start of each sim
 * step (via GameEngine.prepareFrameEntities).  The lists mutate in place
 * on every rebuild, so consumers must NOT cache them across calls.
 */
export class EntityIndex {
  /** Active enemies (ships, shooters, rammers). */
  public enemies: GameEntity[] = [];

  /** Active asteroids (includes shard debris with type=ASTEROID). */
  public asteroids: GameEntity[] = [];

  /** Active projectiles (both player- and enemy-owned). */
  public projectiles: GameEntity[] = [];

  /**
   * Rebuild all filtered lists from the master entity array.  Inactive
   * entities are skipped so downstream consumers don't need to re-check
   * `active` on the fast path.
   */
  public rebuild(entities: GameEntity[]) {
    this.enemies.length = 0;
    this.asteroids.length = 0;
    this.projectiles.length = 0;

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!e.active) continue;
      switch (e.type) {
        case EntityType.ENEMY:
          this.enemies.push(e);
          break;
        case EntityType.ASTEROID:
          this.asteroids.push(e);
          break;
        case EntityType.PROJECTILE:
          this.projectiles.push(e);
          break;
      }
    }
  }

  /** Clear all lists — used when loading a map / restarting. */
  public clear() {
    this.enemies.length = 0;
    this.asteroids.length = 0;
    this.projectiles.length = 0;
  }
}
