/**
 * The balance harness's instruments still work (engine-core S3, D-S3-e).
 *
 * This is NOT the baseline (`node scripts/balance.mjs`, minutes long); it is
 * the fast check that each instrument runs, is deterministic, and measures
 * what it claims — so a renamed engine field breaks THIS test instead of
 * silently producing a baseline full of zeros.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { playArena, duel, hubTransit, staticTables } from './balance';

test('the static tables read the live constants', () => {
  const s = staticTables();
  assert.equal(s.creditsPerUnit, 1000);
  assert.equal(s.waves.length, 6);
  assert.equal(s.waves[0].hpMult, 1, 'wave 1 is unscaled');
  assert.ok(s.waves[5].hpMult > s.waves[0].hpMult, 'enemy HP grows with the wave');
  assert.ok(s.modules.length > 10 && s.modules.every((m) => m.cost > 0));
  assert.ok(s.enemies.some((e) => e.subtype === 'RAMMER_1'));
});

test('a tier-1 enemy dies to the starter weapon in a couple of shots (the user\'s "one shot" claim)', () => {
  const d = duel('projectile', 'RAMMER_1', false);
  assert.ok(d.killed, 'RAMMER_1 dies to the Projector');
  assert.ok(d.targetHp <= 1, `RAMMER_1 has ${d.targetHp} HP`);
  assert.ok(d.shots <= 3, `took ${d.shots} shots`);
});

test('Gunnery makes a tougher target die in fewer shots', () => {
  const base = duel('projectile', 'RAMMER_3', false);
  const gun = duel('projectile', 'RAMMER_3', true);
  assert.ok(base.killed && gun.killed);
  assert.ok(gun.shots <= base.shots, `gunned ${gun.shots} vs base ${base.shots}`);
});

test('the hub transit reaches a rift', () => {
  const t = hubTransit('arena_pocket');
  assert.ok(t.reached, 'the bot reaches the Pocket rift');
  assert.ok(t.seconds > 1 && t.seconds < 120, `${t.seconds}s`);
});

test('an arena run is deterministic and records its waves, deaths and rivals', () => {
  const a = playArena({ map: 'POCKET', seed: 5, loadout: 'lean', maxSec: 25 });
  const b = playArena({ map: 'POCKET', seed: 5, loadout: 'lean', maxSec: 25 });
  assert.deepEqual(a, b, 'same seed, same bot => same report');
  assert.ok(a.waves.length >= 1 && a.waves[0].wave === 1);
  assert.ok(a.waves[0].spawned > 0, 'the wave-1 census saw enemies');
  assert.ok(a.endSec > 20 || a.endedBy !== 'timeout');
  const off = playArena({ map: 'POCKET', seed: 5, loadout: 'lean', rivals: false, maxSec: 25 });
  assert.equal(off.rivalsSeen, 0, 'rivals:false really switches them off');
});
