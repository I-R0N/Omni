/**
 * The extracted content tables (engine-core S3, PR 1) are a MOVE, not an edit.
 *
 * `fixtures/tables.golden.json` is the resolved value of MAP_POPULATION,
 * ENEMY_VARIANTS, BOSS_DEFS and ENEMY_SCALE_CYCLE (plus the functions derived
 * from them) captured from `constants.ts` BEFORE the tables became TOML.  This
 * suite requires what the engine sees now to be the same thing: same keys in
 * the same order, same strings, same numbers.
 *
 * Numbers are compared with a RELATIVE TOLERANCE, not equality.  Nothing in
 * these tables is computed today, so equality would hold — but `BOSS_WEAPONS`
 * is spread from the weapon table, which `dmath` (S3 PR 2) is about to move in
 * the last place, and a table assertion must not be what turns that into a red
 * suite.  The tolerance is far inside any balance-meaningful difference.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../../constants';
import { MapType } from '../../types';

const golden = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'tests/sim/fixtures/tables.golden.json'), 'utf8'),
);

const REL_TOL = 1e-9;

/** Structural comparison: same shape and key ORDER, numbers within REL_TOL. */
function close(actual: unknown, expected: unknown, where: string): void {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', `${where}: expected a number, got ${typeof actual}`);
    const a = actual as number;
    const scale = Math.max(1, Math.abs(expected));
    assert.ok(Math.abs(a - expected) <= REL_TOL * scale, `${where}: ${a} != ${expected}`);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${where}: expected an array`);
    assert.equal((actual as unknown[]).length, expected.length, `${where}: array length`);
    expected.forEach((v, i) => close((actual as unknown[])[i], v, `${where}[${i}]`));
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    assert.ok(actual !== null && typeof actual === 'object', `${where}: expected an object`);
    assert.deepEqual(Object.keys(actual as object), Object.keys(expected), `${where}: keys (order matters)`);
    for (const k of Object.keys(expected)) {
      close((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], `${where}.${k}`);
    }
    return;
  }
  assert.equal(actual, expected, where);
}

/** What the golden file looks like after the same JSON round trip. */
const wire = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

test('MAP_POPULATION resolves to what it was before extraction', () => {
  close(wire(C.MAP_POPULATION), golden.MAP_POPULATION, 'MAP_POPULATION');
});

test('getRockShardFreeSpawn is unchanged for every map', () => {
  const now = Object.fromEntries(
    Object.values(MapType).map((m) => [m, C.getRockShardFreeSpawn(m as MapType)]),
  );
  close(wire(now), golden.rockFreeSpawn, 'rockFreeSpawn');
});

test('ENEMY_VARIANTS resolves to what it was before extraction', () => {
  close(wire(C.ENEMY_VARIANTS), golden.ENEMY_VARIANTS, 'ENEMY_VARIANTS');
});

test('every ENEMY_VARIANTS sprite resolved to a real asset path', () => {
  for (const [id, row] of Object.entries(C.ENEMY_VARIANTS)) {
    assert.equal(typeof row.sprite, 'string', `${id}.sprite`);
    assert.ok(row.sprite.length > 0 && row.sprite !== 'undefined', `${id}.sprite is empty`);
  }
});

test('BOSS_DEFS resolves to what it was before extraction', () => {
  close(wire(C.BOSS_DEFS), golden.BOSS_DEFS, 'BOSS_DEFS');
});

test('boss escorts build the same wave lists', () => {
  const now = Object.fromEntries(
    Object.keys(C.BOSS_DEFS).map((b) => [b, C.buildBossWaveSpawnList(b as never, 11)]),
  );
  close(wire(now), golden.bossWave, 'bossWave');
});

test('ENEMY_SCALE_CYCLE keeps its steps, in order, with 1x first', () => {
  close(wire(C.ENEMY_SCALE_CYCLE), golden.ENEMY_SCALE_CYCLE, 'ENEMY_SCALE_CYCLE');
  assert.equal(C.ENEMY_SCALE_CYCLE[0], 1, 'index 0 must stay "what ships"');
});
