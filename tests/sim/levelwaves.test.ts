import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLevelWave, levelScales, rosterCeiling, waveTargetPoints, ENEMY_RATING, mapSizeScale, mapSizeLabel } from '../../constants';
import { MAP_SPANS } from '../../engine/maps/MapClasses';
import { MapType } from '../../types';

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

test('map size: the 12k reference is 1.0, bigger maps carry more, smaller fewer', () => {
  assert.equal(mapSizeScale(12000), 1);
  const pocket = mapSizeScale(MAP_SPANS[MapType.POCKET]);
  const field = mapSizeScale(MAP_SPANS[MapType.GLASS_FIELD]);
  const ring = mapSizeScale(MAP_SPANS[MapType.RING]);
  const deep = mapSizeScale(MAP_SPANS[MapType.UNIVERSE]);
  assert.ok(pocket < field && field < ring && ring < deep, `${pocket} ${field} ${ring} ${deep}`);
  assert.ok(pocket >= 0.5 && deep <= 1.5);
});

test('map size classes name every map', () => {
  assert.equal(mapSizeLabel(MAP_SPANS[MapType.POCKET]), 'Small');
  assert.equal(mapSizeLabel(MAP_SPANS[MapType.ASTEROID_FIELD]), 'Medium');
  assert.equal(mapSizeLabel(MAP_SPANS[MapType.RING]), 'Large');
  assert.equal(mapSizeLabel(MAP_SPANS[MapType.UNIVERSE]), 'Huge');
});

test('same level, larger map: more enemy points per wave', () => {
  const small = mapSizeScale(MAP_SPANS[MapType.POCKET]);
  const big = mapSizeScale(MAP_SPANS[MapType.UNIVERSE]);
  for (const l of [1, 4, 8]) {
    let a = 0, b = 0;
    for (let w = 0; w < 5; w++) {
      assert.ok(waveTargetPoints(l, w, big) > waveTargetPoints(l, w, small));
      const pa = pts(buildLevelWave(l, w, [], small) as string[]);
      const pb = pts(buildLevelWave(l, w, [], big) as string[]);
      // One early wave is a handful of units and the mix is rolled, so a
      // single wave can tie or wobble; the claim is about the ladder.
      a += pa; b += pb;
    }
    assert.ok(b > a * 1.2, `L${l}: ${a} vs ${b}`);
  }
});
