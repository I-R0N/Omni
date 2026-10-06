/**
 * rng.ts — the sim's SEEDED RANDOM STREAMS (engine-core plan, S1).
 *
 * The sim used to draw from `Math.random()`, so no two runs of the same
 * inputs could agree and a bug report could not be replayed.  Every draw now
 * comes from a NAMED STREAM, and the streams are split in two kinds:
 *
 *   `sim`  — what changes the WORLD: terrain, wave composition and spawn
 *            placement, drop rolls and scatter, fracture velocities, nebula
 *            condense rolls, projectile spread, boss / roamer rolls, and AI
 *            jitter (enemy wobble moves bodies, so it is part of the fight —
 *            D-S1-c).  A replay must reproduce these exactly.
 *   `fxRng`   — what only DECORATES it: particles, sprite and palette picks,
 *            nebula twinkle, camera shake, the star field, audio variation,
 *            render-time shape wobble.  Nothing the sim reads may ever come
 *            from an `fxRng` stream, and `tests/replay.spec.ts` proves it by
 *            advancing one without the other.
 *
 * One stream PER SUBSYSTEM, not one per kind: a draw added in the drop code
 * must not shift what the AI rolls next, or an unrelated change would
 * silently reshuffle every replay.  The streams share one root seed
 * (`seedRng`), each derived through a name hash.
 *
 * The generator is mulberry32 — the repo's precedent (`fracture.ts`,
 * `BackgroundManager.starRand`) — with its 32-bit state held in the stream so
 * the replay harness can hash it and a divergence is caught the step it
 * happens.  A stream is a plain `() => number`, so call sites read
 * `sim.drops()` where they used to read `Math.random()`.
 *
 * Module-level singleton: the page runs one engine, and several draw sites
 * (`constants.ts`, `NebulaColor.ts`, `TileGenerator.ts`) are free functions
 * with no engine to inject.  `GameEngine` owns the seeding.  Pure — no
 * platform imports; the default seed comes from the caller.
 */

export interface Stream {
  (): number;
  /** Reset to the state derived from `rootSeed` and this stream's name. */
  seed(rootSeed: number): void;
  /** Current 32-bit state (for the replay hash). */
  state(): number;
  /** Draws since the last `seed` (for diagnostics). */
  count(): number;
}

/** FNV-1a over the stream name, folded with the root seed. */
function deriveState(rootSeed: number, name: string): number {
  let h = 0x811c9dc5 ^ (rootSeed >>> 0);
  h = Math.imul(h, 0x01000193) >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

function makeStream(name: string): Stream {
  let s = deriveState(1, name);
  let n = 0;
  const next = (() => {
    n++;
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Stream;
  next.seed = (rootSeed: number) => { s = deriveState(rootSeed, name); n = 0; };
  next.state = () => s;
  next.count = () => n;
  return next;
}

/** Every stream that can change the world.  Adding one is a line here. */
export const sim = {
  /** Map generation: tile clusters, asteroid placement, nebula clusters. */
  terrain: makeStream('sim.terrain'),
  /** Wave composition, spawn ring placement, enemy spawn stamps. */
  waves: makeStream('sim.waves'),
  /** Drops, debris, shard fans and chip dust scatter. */
  drops: makeStream('sim.drops'),
  /** ShardSystem: fracture velocities, merges, regen, shard shapes. */
  shards: makeStream('sim.shards'),
  /** Nebula: condense rolls, salvage rolls, cloud colour. */
  nebula: makeStream('sim.nebula'),
  /** AISystem: enemy jitter, flock, timers (D-S1-c: part of the fight). */
  ai: makeStream('sim.ai'),
  /** Projectile spread, curl, collision rolls, blast headings. */
  combat: makeStream('sim.combat'),
  /** Bosses, dragons, rivals, snitch, bubbles. */
  roamers: makeStream('sim.roamers'),
  /** The energy layer: arc lanes and pulse lanes. */
  energy: makeStream('sim.energy'),
  /** The orchestrator's own rolls: transit stagger, flow lanes, rock chip. */
  engine: makeStream('sim.engine'),
};

/** Every stream that only decorates.  Nothing the sim reads comes from here. */
export const fxRng = {
  /** ParticleSystem and the callers' spark / burst picks. */
  particles: makeStream('fx.particles'),
  /** Sprite, palette and shade picks rolled at spawn. */
  sprites: makeStream('fx.sprites'),
  /** Render-time wobble: twinkle, bolt tendrils, camera shake. */
  render: makeStream('fx.render'),
  /** Audio variation. */
  audio: makeStream('fx.audio'),
  /** Background nebula puffs and the star field's non-seeded parts. */
  sky: makeStream('fx.sky'),
};

const SIM_LIST: Stream[] = Object.values(sim);
const FX_LIST: Stream[] = Object.values(fxRng);

/** Seed every stream from one root.  Deterministic: same root, same streams. */
export function seedRng(rootSeed: number): void {
  for (const st of SIM_LIST) st.seed(rootSeed);
  for (const st of FX_LIST) st.seed(rootSeed);
}

/** Reseed only the cosmetic streams (tests: prove they cannot move the sim). */
export function seedFx(rootSeed: number): void {
  for (const st of FX_LIST) st.seed(rootSeed);
}

/** The sim streams' states, in a fixed order — folded into the replay hash. */
export function simStates(out: number[] = []): number[] {
  out.length = SIM_LIST.length;
  for (let i = 0; i < SIM_LIST.length; i++) out[i] = SIM_LIST[i].state();
  return out;
}

export function fxStates(out: number[] = []): number[] {
  out.length = FX_LIST.length;
  for (let i = 0; i < FX_LIST.length; i++) out[i] = FX_LIST[i].state();
  return out;
}

/** Draw `n` values from a cosmetic stream and throw them away (test helper). */
export function burnFx(n: number): void {
  for (let i = 0; i < n; i++) {
    for (const st of FX_LIST) st();
  }
}

// Streams start seeded from root 1 so a draw before the engine seeds them is
// still deterministic rather than a NaN.
seedRng(1);
