import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLevelWave, levelScales, rosterCeiling, waveTargetPoints, ENEMY_RATING } from '../../constants';

const pts = (l: string[]) => l.reduce((a, s) => a + (ENEMY_RATING as any)[s], 0);

test('no Bulwark below its unlock level', () => {
  for (let seed = 0; seed < 5; seed++) for (let w = 0; w < 5; w++) {
    assert.ok(!buildLevelWave(3, w, []).includes('BULWARK' as any));
  }
});

test('levelScales: 1-3 are the old rows, above grows', () => {
  assert.ok(levelScales(6).health > levelScales(3).health);
  assert.ok(levelScales(20).spawn <= 1.5 * levelScales(3).spawn + 1e-9);
});

test('ceiling rises with level and wave', () => {
  assert.ok(rosterCeiling(6, 3) > rosterCeiling(2, 3));
  assert.ok(rosterCeiling(4, 4) > rosterCeiling(4, 0));
});

test('waves approach their point target', () => {
  for (const l of [1, 3, 6, 10]) for (let w = 0; w < 5; w++) {
    const list = buildLevelWave(l, w, []) as string[];
    assert.ok(list.length > 0);
    const t = waveTargetPoints(l, w);
    assert.ok(pts(list) > t * 0.5 && pts(list) < t * 1.8, `L${l} w${w} ${pts(list)} vs ${t}`);
  }
});
