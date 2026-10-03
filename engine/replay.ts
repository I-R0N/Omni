/**
 * replay.ts — the REPLAY HARNESS (engine-core plan, S1).
 *
 * A run is `(seed, input log)`.  This file records the log, replays it by
 * stepping the REAL engine by hand (`GameEngine.stepSim` — no rAF, no wall
 * clock) and reduces the world to a hash every N steps, so two runs can be
 * compared step for step and a divergence is reported at the first step it
 * appears, with the section (rng / player / world) that moved.
 *
 * What the hash covers is the SIM, on purpose: the random streams' states and
 * the id sequence, the player, and every non-particle entity's identity,
 * position, velocity, rotation, size and health, in list order.  Particles,
 * popups and every other cosmetic entity are excluded, as is anything the
 * renderer owns — that exclusion is what `tests/replay.spec.ts` proves safe
 * by advancing the cosmetic streams alone and requiring the hashes to match.
 *
 * Dev-only today (D-S1-g): nothing player-facing reads or writes a log, so
 * the format below is not yet a compatibility surface.
 *
 * Known limits of a replay, so a bug report knows what it can promise:
 *  - input is keys + pointer + tap fires; a HELD charge reads the wall clock
 *    and is not recorded;
 *  - aim is a screen position measured from the viewport centre, so a replay
 *    only matches at the viewport it was recorded at;
 *  - the PerfController's load EWMA is wall-clock, so a held replay feeds it
 *    no time term (`GameEngine.simStep`).
 */
import type { GameEngine } from './GameEngine';
import { EntityType, MapType } from '../types';
import { peekIdCounter } from './systems/IdAllocator';
import { simStates } from './systems/rng';

/** One change to the input state, taking effect at `at` (a sim step index).
 *  `keys` and `aim` LATCH until the next entry that sets them; `fire` taps
 *  apply to that one step only. */
export interface ReplayInput {
  at: number;
  keys?: string[];
  aim?: [number, number];
  fire?: Array<[number, number]>;
}

export interface ReplayLog {
  seed: number;
  mapType: MapType;
  inputs: ReplayInput[];
}

export interface ReplayHash {
  step: number;
  /** Everything below folded together — the one number to compare. */
  hash: number;
  /** The sections, so a mismatch names what moved. */
  rng: number;
  player: number;
  world: number;
}

export interface ReplayResult {
  steps: number;
  hashes: ReplayHash[];
  final: ReplayHash;
}

/** A root seed for a run nobody asked to pin.  Hidden from the player
 *  (D-S1-a); the platform clock is read here and nowhere in the sim. */
export function freshRunSeed(): number {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const a = new Uint32Array(1);
    c.getRandomValues(a);
    return a[0];
  }
  return (Date.now() ^ ((typeof performance !== 'undefined' ? performance.now() : 0) * 1000)) >>> 0;
}

// ── hashing ─────────────────────────────────────────────────────────────

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

class Fnv {
  h = 0x811c9dc5;
  u(x: number): void { this.h = Math.imul(this.h ^ (x >>> 0), 0x01000193) >>> 0; }
  n(x: number | undefined): void {
    f64[0] = x === undefined || x !== x ? -0.123456789 : x;
    this.u(u32[0]);
    this.u(u32[1]);
  }
  s(x: string | undefined): void {
    if (!x) { this.u(0); return; }
    for (let i = 0; i < x.length; i++) this.u(x.charCodeAt(i));
    this.u(0xff);
  }
}

type Anyish = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Hash the sim state of `g` right now. */
export function hashSimState(g: GameEngine, step: number): ReplayHash {
  const e = g as unknown as Anyish;

  const r = new Fnv();
  const st = simStates();
  for (let i = 0; i < st.length; i++) r.u(st[i]);
  r.u(peekIdCounter());

  const p = new Fnv();
  const pl = e.player as Anyish;
  p.n(pl.position.x); p.n(pl.position.y);
  p.n(pl.velocity.x); p.n(pl.velocity.y);
  p.n(pl.rotation); p.n(pl.health); p.n(pl.shield);
  p.n(e.score); p.n(e.credits); p.n(e.simClock); p.n(e.runTimeSec);

  const w = new Fnv();
  const ents = e.currentMap?.entities as Anyish[] | undefined;
  let n = 0;
  if (ents) {
    for (let i = 0; i < ents.length; i++) {
      const en = ents[i];
      if (!en.active || en.type === EntityType.PARTICLE) continue;
      n++;
      w.s(en.id);
      w.n(en.position.x); w.n(en.position.y);
      w.n(en.velocity?.x); w.n(en.velocity?.y);
      w.n(en.rotation); w.n(en.health);
      w.n(en.size?.x);
    }
  }
  w.u(n);

  const hash = new Fnv();
  hash.u(r.h); hash.u(p.h); hash.u(w.h);
  return { step, hash: hash.h, rng: r.h, player: p.h, world: w.h };
}

// ── driving ─────────────────────────────────────────────────────────────

/** Run `log` for `steps` fixed substeps on the real engine, hashing every
 *  `hashEvery` steps (and once at step 0).  Leaves the engine held
 *  (`replayHold`); call `endReplay` to hand it back to the frame loop. */
export function runReplay(
  g: GameEngine, log: ReplayLog, steps: number, hashEvery: number,
  /** Called before each step — the cosmetic-isolation test advances the
   *  fx streams here and requires the hashes not to notice. */
  beforeStep?: (step: number) => void,
): ReplayResult {
  g.beginSeededRun(log.seed, log.mapType);
  const input = (g as unknown as { input: { applyReplayFrame: (k: readonly string[], x: number, y: number, f: ReadonlyArray<readonly [number, number]>) => void } }).input;
  const inputs = log.inputs.slice().sort((a, b) => a.at - b.at);
  let next = 0;
  let keys: string[] = [];
  let aim: [number, number] = [window.innerWidth / 2 + 200, window.innerHeight / 2];
  const hashes: ReplayHash[] = [hashSimState(g, 0)];

  for (let step = 0; step < steps; step++) {
    let fire: Array<[number, number]> = [];
    while (next < inputs.length && inputs[next].at <= step) {
      const i = inputs[next++];
      if (i.keys) keys = i.keys;
      if (i.aim) aim = i.aim;
      if (i.fire && i.at === step) fire = i.fire;
    }
    input.applyReplayFrame(keys, aim[0], aim[1], fire);
    if (beforeStep) beforeStep(step);
    g.stepSim(1);
    if ((step + 1) % hashEvery === 0) hashes.push(hashSimState(g, step + 1));
  }
  return { steps, hashes, final: hashSimState(g, steps) };
}

/** Hand the engine back to the frame loop and drop the held keys. */
export function endReplay(g: GameEngine): void {
  g.replayHold = false;
  (g as unknown as { input: { applyReplayFrame: (k: readonly string[], x: number, y: number, f: []) => void } })
    .input.applyReplayFrame([], window.innerWidth / 2, window.innerHeight / 2, []);
}

/** First step at which two hash series disagree, and which section moved;
 *  null when they agree throughout. */
export function firstDivergence(a: ReplayHash[], b: ReplayHash[]): { step: number; section: string } | null {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i].hash === b[i].hash) continue;
    const section = a[i].rng !== b[i].rng ? 'rng' : a[i].player !== b[i].player ? 'player' : 'world';
    return { step: a[i].step, section };
  }
  return a.length === b.length ? null : { step: n, section: 'length' };
}
