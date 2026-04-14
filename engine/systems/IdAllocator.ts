/**
 * IdAllocator — monotonic, process-scoped unique ID generator.
 *
 * Phase 5 of the engine upgrade.  Replaces the previous
 * `${prefix}_${Date.now()}_${Math.random()}` pattern used throughout the
 * engine for entity / message / announcement IDs.
 *
 * Rationale:
 *   - `Date.now()` is a syscall on most JS runtimes; calling it once per
 *     spawned entity burns cycles in hot loops that allocate hundreds of
 *     particles / projectiles / shards per frame.
 *   - `Math.random()` adds another call and a long fractional suffix to
 *     every ID string, which is pure overhead for unique-id purposes.
 *   - A simple monotonically incrementing counter is O(1), collision-free
 *     within a process lifetime, and produces short stable strings that
 *     are friendly to logs and debuggers.
 *
 * IDs generated here are NOT persisted, serialized, or shared across
 * clients — they only need to stay unique for the current game session,
 * so a process-local counter is sufficient.
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

/**
 * Reset the counter back to zero.  Intended only for tests and for the
 * engine's own restart path — do NOT call from gameplay code mid-session,
 * as it can produce ID collisions with entities already in flight.
 */
export function resetIdCounter() {
  counter = 0;
}
