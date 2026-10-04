/**
 * The canonical parity log: ONE seed, ONE input stream, the maps chosen for
 * coverage of what draws random numbers.  Imports no engine code, so the
 * Playwright suite (tests/headless.spec.ts) can read the same constants the
 * Node harness replays — the two sides cannot drift into replaying different
 * things.
 */
import type { ReplayInput } from '../../engine/replay';

/** Fly right and a little up, fire a few taps off to one side — the same
 *  inputs tests/replay.spec.ts drives, so the two suites cover one thing. */
export const PARITY_INPUTS: ReplayInput[] = [
  { at: 0, keys: ['KeyD'], aim: [700, 300] },
  { at: 100, fire: [[700, 300]] },
  { at: 300, keys: ['KeyD', 'KeyW'], aim: [600, 200] },
  { at: 400, fire: [[600, 200]] },
  { at: 500, fire: [[600, 200]] },
  { at: 700, keys: [], aim: [200, 400] },
  { at: 800, fire: [[200, 400]] },
];

export const PARITY_MAPS = ['POCKET', 'UNIVERSE', 'OVERWORLD', 'NEBULA_FIELD'] as const;
export const PARITY_SEED = 424242;
export const PARITY_STEPS = 1200;
export const PARITY_EVERY = 100;

