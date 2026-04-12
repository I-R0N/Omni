// ── Seeded pseudorandom ─────────────────────────────────────────────────────
// Lets the host and client generate byte-identical static scenery (asteroid
// placements, tile clusters, nebula puffs, star fields) from a shared seed.
// Uses mulberry32 — small, fast, and good enough for visual determinism.
//
// The map and background managers call Math.random() throughout their init
// code.  Refactoring all those call sites to thread an explicit rand
// argument would touch dozens of files; instead we temporarily replace
// Math.random with a seeded generator via withSeededRandom() and restore
// the real Math.random afterwards.  Any code that runs synchronously
// inside the fn sees the seeded stream, then normal random is back.

export function makeSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  // Guard against a zero seed — mulberry32 degenerates if every bit is 0.
  if (state === 0) state = 0x9E3779B9;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Run `fn` with Math.random replaced by a seeded generator.  Use for
 * synchronous world-generation code only — any async work inside the
 * callback will land outside the override window and see real randomness.
 */
export function withSeededRandom<T>(seed: number, fn: () => T): T {
  const saved = Math.random;
  const rng = makeSeededRandom(seed);
  // The cast is necessary because Math.random's type is a bound method
  // rather than a plain function-typed property.
  (Math as { random: () => number }).random = rng;
  try {
    return fn();
  } finally {
    (Math as { random: () => number }).random = saved;
  }
}

/** Generate a random 32-bit seed using real randomness (not the seeded
 *  PRNG) — used by the host to pick a fresh seed each session. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
}
