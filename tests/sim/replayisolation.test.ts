import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeadlessEngine, rng } from './harness';
import { runReplay, endReplay, firstDivergence } from '../../engine/replay';
import { MapType } from '../../types';

const INPUTS: any[] = [
  { at: 0, keys: ['KeyD'], aim: [700, 300] }, { at: 100, fire: [[700, 300]] },
  { at: 300, keys: ['KeyD', 'KeyW'], aim: [600, 200] }, { at: 400, fire: [[600, 200]] },
  { at: 500, fire: [[600, 200]] }, { at: 700, keys: [], aim: [200, 400] }, { at: 800, fire: [[200, 400]] },
];

// Two replays back to back on ONE engine must be the same run.  The second
// used to start with the first's wave progress fast-forwarded: unloading the
// previous arena stamped its wave into the memory `beginSeededRun` had just
// cleared.  Level waves put an enemy on the field early enough to show it.
test('a replay starts from nothing held, however the engine was last used (UNIVERSE)', () => {
  const { engine } = createHeadlessEngine({}, 3);
  const run = (burn: boolean) => {
    const before = burn ? () => { (rng as any).seedFx(1037); (rng as any).burnFx(37); } : undefined;
    const res = runReplay(engine, { seed: 4242, mapType: MapType.UNIVERSE, inputs: INPUTS }, 1200, 100, before);
    endReplay(engine);
    return res.hashes;
  };
  const a = run(false), b = run(true);
  assert.equal(firstDivergence(a, b), null);
});
