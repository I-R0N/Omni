/**
 * The module price rule (engine-core S3, D-S3-f): a mark costs its number times
 * the mark below it, and a mark past the shop's reach is an arena reward only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_DEFS, SHOP_MAX_MARK, markCost } from '../../constants';

const families = new Map<string, typeof MODULE_DEFS[number][]>();
for (const d of MODULE_DEFS) if (d.id.includes('_mk') && d.mark >= 1) {
  (families.get(d.family) ?? families.set(d.family, []).get(d.family)!).push(d);
}

test('every Mk family prices each mark at its number times the mark below', () => {
  assert.ok(families.size >= 7, 'the Mk families are all present');
  for (const [fam, marks] of families) {
    marks.sort((a, b) => a.mark - b.mark);
    assert.equal(marks[0].mark, 1, fam);
    for (let i = 1; i < marks.length; i++) {
      assert.equal(marks[i].cost, marks[i - 1].cost * marks[i].mark, `${fam} Mk ${marks[i].mark}`);
    }
  }
  assert.deepEqual([1, 2, 3, 4, 5].map((m) => markCost(1, m)), [1, 2, 6, 24, 120]);
});

test('marks past the shop are reward-only, and nothing else is', () => {
  for (const d of MODULE_DEFS) {
    const expected = d.id.includes('_mk') && d.mark > SHOP_MAX_MARK;
    assert.equal(!!d.rewardOnly, expected, d.id);
  }
  assert.ok(MODULE_DEFS.some((d) => d.rewardOnly), 'the scanner has Mk IV and V');
});

test('a boss drops a reward-only mark rarely, and every shop module still drops', async () => {
  const { bossRewardTable, pickBossReward } = await import('../../constants');
  const table = bossRewardTable();
  const total = table.reduce((a, r) => a + r.weight, 0);
  const rare = table.filter((r) => r.def.rewardOnly).reduce((a, r) => a + r.weight, 0);
  assert.ok(rare > 0, 'reward-only marks are still obtainable');
  assert.ok(rare / total < 0.01, `reward-only share ${(100 * rare / total).toFixed(2)}% is under 1%`);
  // Walk the draw across [0,1): every shop module is reachable, and the observed share matches the weights.
  const seen = new Set<string>(); let hitRare = 0; const N = 20000;
  for (let i = 0; i < N; i++) {
    const d = pickBossReward((i + 0.5) / N)!;
    seen.add(d.id); if (d.rewardOnly) hitRare++;
  }
  for (const r of table) if (!r.def.rewardOnly) assert.ok(seen.has(r.def.id), r.def.id);
  assert.ok(Math.abs(hitRare / N - rare / total) < 0.002);
});
