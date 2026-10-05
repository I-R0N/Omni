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
