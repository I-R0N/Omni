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
let fxCounter = 0;

/**
 * Prefixes of COSMETIC entities (particles, trail glints, popups, arcs).
 * They count on their OWN sequence, because an id string is sim state: the
 * fracture pattern of a shard is seeded from its id (`seedFromEntityId`),
 * and a shared counter would let the number of particles a death threw —
 * which rides a cosmetic random stream — shift the id, and so the break, of
 * the next shard.  Engine-core plan S1: cosmetic draws must not reach the sim.
 */
const COSMETIC_PREFIXES = new Set(['part', 'glit', 'score', 'dmg', 'hud', 'lightning']);

/**
 * Return a fresh unique ID prefixed with `prefix`.  Prefixes carry no
 * semantic meaning to the allocator beyond the sim/cosmetic split above;
 * they exist for human-readable debugging (e.g. `proj_42`, `part_1337`).
 */
export function nextId(prefix: string): string {
  if (COSMETIC_PREFIXES.has(prefix)) {
    fxCounter += 1;
    return `${prefix}_${fxCounter}`;
  }
  counter += 1;
  return `${prefix}_${counter}`;
}

/** The sim sequence's position, for the replay hash. */
export function peekIdCounter(): number {
  return counter;
}

/**
 * Reset the counter back to zero.  Intended only for tests and for the
 * engine's own restart path — do NOT call from gameplay code mid-session,
 * as it can produce ID collisions with entities already in flight.
 */
export function resetIdCounter() {
  counter = 0;
  fxCounter = 0;
}
