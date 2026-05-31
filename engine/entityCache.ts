import { GameEntity } from '../types';

/**
 * Cached bounding-circle radius — `Math.max(size.x, size.y) / 2`.
 *
 * Used by ~20 hot-path call sites across the engine (physics broadphase,
 * shard merge scan, nebula neighbour search, render layout).  Computing
 * it inline meant Math.max + division per call site per pair — cheap
 * individually but a meaningful slice of the per-frame budget at high
 * entity counts.  The cache survives forever for most entities (size is
 * set at spawn and never touched); the few callers that mutate `size`
 * (plastic shard growth, nebula tier change) clear `_collisionR` on the
 * entity to force the next access to recompute.
 */
export function getCollisionR(e: GameEntity): number {
  let r = e._collisionR;
  if (r === undefined) {
    r = Math.max(e.size.x, e.size.y) * 0.5;
    e._collisionR = r;
  }
  return r;
}

/**
 * Mark the bounding-radius cache stale.  Call after any `size.x` / `size.y`
 * write so the next `getCollisionR` recomputes from the new dimensions.
 */
export function invalidateCollisionR(e: GameEntity): void {
  e._collisionR = undefined;
}
