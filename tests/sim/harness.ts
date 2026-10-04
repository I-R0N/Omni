/**
 * The headless harness's shared kit: a real GameEngine on the headless
 * platform, and the canonical replay log the browser parity test uses too
 * (tests/headless.spec.ts imports `PARITY_LOG`, so both sides replay the
 * very same inputs).
 *
 * Imports no test runner, so Playwright can load it.
 */
import { GameEngine } from '../../engine/GameEngine';
import { runReplay, endReplay, type ReplayInput, type ReplayHash } from '../../engine/replay';
import { createHeadlessPlatform, type HeadlessOptions, type HeadlessPlatform } from '../../platform/headless';
import * as rng from '../../engine/systems/rng';
import { MapType } from '../../types';
import { PARITY_STEPS, PARITY_EVERY } from './parityLog';
export * from './parityLog';

export interface Headless {
  engine: GameEngine;
  platform: HeadlessPlatform;
}

export function createHeadlessEngine(opts: HeadlessOptions = {}, difficulty = 3): Headless {
  const platform = createHeadlessPlatform(opts);
  const engine = new GameEngine(platform, () => { /* no UI */ }, difficulty);
  return { engine, platform };
}

export interface HashSeries { steps: number[]; hash: number[]; rng: number[]; player: number[]; world: number[]; }

function toSeries(hashes: ReplayHash[]): HashSeries {
  const out: HashSeries = { steps: [], hash: [], rng: [], player: [], world: [] };
  for (const h of hashes) {
    out.steps.push(h.step); out.hash.push(h.hash); out.rng.push(h.rng);
    out.player.push(h.player); out.world.push(h.world);
  }
  return out;
}

/** Replay `inputs` on `map` from `seed` on `engine`; return the hash series. */
export function replaySeries(
  engine: GameEngine, map: string, seed: number, inputs: ReplayInput[],
  steps = PARITY_STEPS, every = PARITY_EVERY, beforeStep?: (step: number) => void,
): HashSeries {
  const res = runReplay(engine, { seed, mapType: map as MapType, inputs }, steps, every, beforeStep);
  endReplay(engine);
  return toSeries(res.hashes);
}

export { rng };
