/**
 * IdAllocator — monotonic, process-scoped unique ID generator.
 *
 * A plain incrementing counter is O(1), collision-free for the session,
 * and avoids the `Date.now()` / `Math.random()` calls per spawn that used
 * to show up in hot allocation loops (particles, shards, projectiles).
 *
 * IDs are not persisted, serialized, or shared across clients — they
 * only need to stay unique for the current game session.
 */

let counter = 0;

/**
 * Return a fresh unique ID prefixed with `prefix`.  Prefixes carry no
 * semantic meaning to the allocator; they exist purely for human-readable
 * debugging (e.g. `proj_42`, `part_1337`).
 */
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}
