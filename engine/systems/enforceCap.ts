import { GameEntity, EntityType } from '../../types';

/**
 * FIFO hard cap for a single entity type.  Counts active entities of
 * `type`, and if the population exceeds `cap` deactivates the oldest
 * (lowest-index-in-the-array) entries until back at cap.
 *
 * Hoisted out of ParticleSystem / ProjectileSystem — both classes had
 * identical 13-line cap routines that only differed by EntityType /
 * MAX_* constant.  Single implementation now drives both call sites.
 *
 * The walk is intentionally O(N) over the master entity list rather
 * than over a pre-filtered slice: we want strict insertion order for
 * the FIFO drop, and the type+active check is a couple of branches.
 */
export function enforceTypeCap(
  entities: GameEntity[],
  type: EntityType,
  cap: number,
): void {
  let count = 0;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e.active && e.type === type) count++;
  }
  if (count <= cap) return;
  let toDrop = count - cap;
  for (let i = 0; i < entities.length && toDrop > 0; i++) {
    const e = entities[i];
    if (e.active && e.type === type) {
      e.active = false;
      toDrop--;
    }
  }
}
