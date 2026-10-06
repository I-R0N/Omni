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
import { MapType, EnemySubtype } from '../../types';
import { createHeadlessEngine } from './harness';

const golden = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'tests/sim/fixtures/tables.golden.json'), 'utf8'),
);

const REL_TOL = 1e-9;

/**
 * Structural comparison: same shape, numbers within REL_TOL.  Key ORDER is
 * enforced for the first `ordered` levels only — the levels that are TABLES
 * (which maps, which variants, which archetypes, in what order the engine
 * iterates them).  Below that, the fields of one row are a set: the TOML puts
 * `sprite` where the file reads best, not where the old literal had it.
 */
function close(actual: unknown, expected: unknown, where: string, ordered = 0): void {
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
    expected.forEach((v, i) => close((actual as unknown[])[i], v, `${where}[${i}]`, ordered));
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    assert.ok(actual !== null && typeof actual === 'object', `${where}: expected an object`);
    const got = Object.keys(actual as object);
    const want = Object.keys(expected);
    if (ordered > 0) assert.deepEqual(got, want, `${where}: keys (order matters here)`);
    else assert.deepEqual([...got].sort(), [...want].sort(), `${where}: keys`);
    for (const k of want) {
      close((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], `${where}.${k}`, ordered - 1);
    }
    return;
  }
  assert.equal(actual, expected, where);
}

/** What the golden file looks like after the same JSON round trip. */
const wire = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

test('MAP_POPULATION resolves to what it was before extraction', () => {
  close(wire(C.MAP_POPULATION), golden.MAP_POPULATION, 'MAP_POPULATION', 2); // maps, then variants
});

test('getRockShardFreeSpawn is unchanged for every map', () => {
  const now = Object.fromEntries(
    Object.values(MapType).map((m) => [m, C.getRockShardFreeSpawn(m as MapType)]),
  );
  close(wire(now), golden.rockFreeSpawn, 'rockFreeSpawn');
});

test('ENEMY_VARIANTS resolves to what it was before extraction', () => {
  close(wire(C.ENEMY_VARIANTS), golden.ENEMY_VARIANTS, 'ENEMY_VARIANTS', 1); // archetypes
});

test('every ENEMY_VARIANTS sprite resolved to a real asset path', () => {
  for (const [id, row] of Object.entries(C.ENEMY_VARIANTS)) {
    assert.equal(typeof row.sprite, 'string', `${id}.sprite`);
    assert.ok(row.sprite.length > 0 && row.sprite !== 'undefined', `${id}.sprite is empty`);
  }
});

test('BOSS_DEFS resolves to what it was before extraction', () => {
  close(wire(C.BOSS_DEFS), golden.BOSS_DEFS, 'BOSS_DEFS', 1); // bosses
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

// ── The gnat-steer seam ──────────────────────────────────────────────────────
// `swarmMove` on an ENEMY_VARIANTS row pins that archetype to one steer; a row
// without it follows the DBG "Gnat move" cycle.  No shipped row sets it, so the
// shipped game is unchanged — this pins the seam for the day one does.  The
// tell is `swarmTimer`: 'burst' arms it, 'boids' (a straight seek) never does.
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function gnatAfterOneStep(): Any {
  const h = createHeadlessEngine();
  const g = h.engine as Any;
  g.beginSeededRun(5, MapType.POCKET);
  const gnat = {
    id: 'gnat-seam', enemySubtype: EnemySubtype.SWARM, type: 'ENEMY',
    position: { x: 100, y: 100 }, velocity: { x: 0, y: 0 }, size: { x: 16, y: 16 }, rotation: 0,
  };
  const player = { id: 'player', position: { x: 600, y: 100 }, velocity: { x: 0, y: 0 } };
  g.ai.updateSwarm(1 / 120, gnat, player, []);
  return gnat;
}

test('a row without swarmMove follows the DBG cycle; a pinned row ignores it', () => {
  const row = C.ENEMY_VARIANTS[EnemySubtype.SWARM];
  assert.equal(row.swarmMove, undefined, 'no shipped row pins a steer');
  const start = C.getActiveSwarmMoveName();
  try {
    while (C.getActiveSwarmMoveName() !== 'burst') C.cycleSwarmMove();
    assert.notEqual(gnatAfterOneStep().swarmTimer, undefined, 'unpinned: burst arms its timer');
    row.swarmMove = 'boids';
    assert.equal(gnatAfterOneStep().swarmTimer, undefined, 'pinned to boids: the global burst is ignored');
  } finally {
    delete row.swarmMove;
    while (C.getActiveSwarmMoveName() !== start) C.cycleSwarmMove();
  }
});
