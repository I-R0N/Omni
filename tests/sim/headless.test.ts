/**
 * The headless sim — determinism, in Node, with no browser.
 *
 * These are the S1 replay claims re-asserted on the headless platform, which
 * is the first half of the proof the ports are faithful (the second half is
 * tests/headless.spec.ts: the BROWSER hashes equal these).  Each equality
 * claim carries a control, because a hash that ignored the world would pass
 * the equalities too.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runReplay } from '../../engine/replay';
import {
  createHeadlessEngine, replaySeries, rng,
  PARITY_INPUTS, PARITY_MAPS, PARITY_SEED, PARITY_STEPS, PARITY_EVERY,
} from './harness';

for (const map of PARITY_MAPS) {
  test(`${map}: same seed + same inputs ⇒ the same world, in Node`, () => {
    const a = replaySeries(createHeadlessEngine().engine, map, PARITY_SEED, PARITY_INPUTS);
    const b = replaySeries(createHeadlessEngine().engine, map, PARITY_SEED, PARITY_INPUTS);
    assert.equal(a.steps.length, PARITY_STEPS / PARITY_EVERY + 1);
    assert.deepEqual(b.hash, a.hash);
    // controls: the world is actually in the hash
    const otherSeed = replaySeries(createHeadlessEngine().engine, map, PARITY_SEED + 1, PARITY_INPUTS);
    assert.notDeepEqual(otherSeed.hash, a.hash, 'a different seed must move the hash');
    const otherInput = replaySeries(createHeadlessEngine().engine, map, PARITY_SEED, []);
    assert.notDeepEqual(otherInput.hash, a.hash, 'different input must move the hash');
  });
}

test('cosmetic streams cannot reach the sim (headless)', () => {
  const map = 'POCKET';
  const clean = replaySeries(createHeadlessEngine().engine, map, PARITY_SEED, PARITY_INPUTS);
  const burned = replaySeries(
    createHeadlessEngine().engine, map, PARITY_SEED, PARITY_INPUTS, PARITY_STEPS, PARITY_EVERY,
    (step) => { rng.seedFx(77 + step); rng.burnFx(50); },
  );
  assert.deepEqual(burned.hash, clean.hash);
});

test('a headless step costs nothing the wall clock can see', () => {
  const { engine, platform } = createHeadlessEngine();
  replaySeries(engine, 'POCKET', PARITY_SEED, PARITY_INPUTS, 120, 120);
  assert.equal(platform.clock.now(), 0, 'nothing advanced the manual clock');
});

test('a replay does not depend on what ran before it on the same engine', () => {
  const fresh = replaySeries(createHeadlessEngine().engine, 'UNIVERSE', PARITY_SEED, PARITY_INPUTS, 400, 100);
  const h = createHeadlessEngine();
  replaySeries(h.engine, 'POCKET', PARITY_SEED, PARITY_INPUTS, 400, 100);
  const after = replaySeries(h.engine, 'UNIVERSE', PARITY_SEED, PARITY_INPUTS, 400, 100);
  // Step 0 is the sharp one: it is hashed before any input is applied, so
  // anything the previous run left on the ship (its heading, once) shows there.
  assert.deepEqual(after.player, fresh.player);
  assert.deepEqual(after.hash, fresh.hash);
});

test('a CHARGED shot replays as the release it produced, not the hold that earned it', () => {
  const base = [{ at: 0, keys: [] as string[], aim: [700, 300] as [number, number] }];
  const none = replaySeries(createHeadlessEngine().engine, 'POCKET', PARITY_SEED, base, 300, 50);
  const withCharge = [...base, { at: 100, charge: [[700, 300]] as Array<[number, number]> }];
  const a = replaySeries(createHeadlessEngine().engine, 'POCKET', PARITY_SEED, withCharge, 300, 50);
  const b = replaySeries(createHeadlessEngine().engine, 'POCKET', PARITY_SEED, withCharge, 300, 50);
  assert.deepEqual(b.hash, a.hash, 'the same log replays the same');
  assert.notDeepEqual(a.hash, none.hash, 'and the shot is in the world');
});

test('a log carries its viewport, and a replay at another size is refused by name', () => {
  const log = (viewport?: [number, number]) => ({
    seed: PARITY_SEED, mapType: 'UNIVERSE' as never, inputs: PARITY_INPUTS, viewport,
  });
  const h = createHeadlessEngine();
  assert.doesNotThrow(() => runReplay(h.engine, log([390, 844]), 10, 10));
  const wide = createHeadlessEngine({ viewport: { width: 800, height: 600 } });
  assert.throws(() => runReplay(wide.engine, log([390, 844]), 10, 10), /recorded at 390×844 but is running at 800×600/);
  // CONTROL: the check exists because the run really does depend on the size —
  // the same seed and inputs at another viewport are a different world.
  const at390 = replaySeries(createHeadlessEngine().engine, 'UNIVERSE', PARITY_SEED, PARITY_INPUTS, 600, 100);
  const at800 = replaySeries(wide.engine, 'UNIVERSE', PARITY_SEED, PARITY_INPUTS, 600, 100);
  assert.notDeepEqual(at800.hash, at390.hash);
});

test('the PerfController time term is an input of the log: pinned, reproducible, and visible', () => {
  const map = 'NEBULA_FIELD';
  const idle = replaySeries(createHeadlessEngine().engine, map, PARITY_SEED, PARITY_INPUTS, 600, 100);
  // A heavy scene the way a recorder would write it: 40 ms per substep from step 0.
  const heavy = [{ at: 0, simMs: 40 }, ...PARITY_INPUTS];
  const a = replaySeries(createHeadlessEngine().engine, map, PARITY_SEED, heavy, 600, 100);
  const b = replaySeries(createHeadlessEngine().engine, map, PARITY_SEED, heavy, 600, 100);
  assert.deepEqual(b.hash, a.hash, 'a pinned load replays the same');
  assert.notDeepEqual(a.hash, idle.hash, 'and it changes which periodic tasks run, so it is not decoration');
  // The default is unchanged: a log that never mentions it is the zero-load replay.
  const explicitZero = replaySeries(createHeadlessEngine().engine, map, PARITY_SEED, [{ at: 0, simMs: 0 }, ...PARITY_INPUTS], 600, 100);
  assert.deepEqual(explicitZero.hash, idle.hash);
});

test('the run seed comes from the Entropy port: reproducible headless, different per source', () => {
  const seedOf = (entropySeed: number) => {
    const g = createHeadlessEngine({ entropySeed }).engine as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    g.selectedMapType = 'POCKET';
    g.resetAndLoadSelectedMap();
    return g.arenaSeed as number;
  };
  assert.equal(seedOf(5), seedOf(5));
  assert.notEqual(seedOf(5), seedOf(6));
});
