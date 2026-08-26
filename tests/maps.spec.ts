/** Map composition (gauntlet step 5 G7).
 *
 *  G7 moved the natural maps' tile-variant mix out of the map classes and
 *  into `MAP_POPULATION`, which CLAUDE.md §5 had already flagged as only
 *  half-true ("treat MAP_POPULATION as authoritative for documentation but
 *  verify the relevant MapClasses subclass too"). It was a DATA MOVE, so the
 *  thing to prove is that nothing about the generated worlds changed.
 *
 *  Cluster generation is random — counts and sizes both — so equivalence is
 *  asserted as BANDS around the populations measured before the move, wide
 *  enough to swallow the natural run-to-run spread and narrow enough that a
 *  real change in a count or a size range falls outside. The bands are
 *  hard-coded rather than derived (harness rule 7): a rebalance SHOULD have
 *  to come here and say so.
 *
 *  Seven Rings is the strong case — its geometry is deterministic, so its
 *  counts are asserted exactly, and the ring ORDER is asserted directly
 *  against the table's intent (soft inside, indestructible wall outside).
 *
 *  Measured baseline, 8 builds per map, before and after the move:
 *
 *    UNIVERSE     glass 584→566   plastic 142→148  metal  50→47   nebula 1623→1641
 *    POCKET       glass  75→72    plastic  37→36   metal  15→17   nebula  103→102
 *    SEVEN_RINGS  glass 234→234   plastic 528→528  metal 762→762  indestructible 477→477
 */

import { test, expect } from '@playwright/test';
import { boot, engine, startRun } from './helpers';

/** Rebuild `map` `runs` times and return per-variant min/max/mean. */
function populations(page: any, runs = 4) {
  return engine(page, (e, n: number) => {
    const samples: Record<string, number>[] = [];
    for (let i = 0; i < n; i++) {
      e.resetAndLoadSelectedMap();
      const by: Record<string, number> = {};
      for (const en of e.currentMap.entities) {
        if (!en.shardVariant) continue;
        by[en.shardVariant] = (by[en.shardVariant] || 0) + 1;
      }
      samples.push(by);
    }
    const keys = new Set<string>();
    samples.forEach(s => Object.keys(s).forEach(k => keys.add(k)));
    const out: Record<string, { min: number; max: number; mean: number }> = {};
    for (const k of keys) {
      const v = samples.map(s => s[k] || 0);
      out[k] = {
        min: Math.min(...v),
        max: Math.max(...v),
        mean: v.reduce((a, b) => a + b, 0) / v.length,
      };
    }
    return out;
  }, runs);
}

function expectBand(
  pops: Record<string, { min: number; max: number; mean: number }>,
  variant: string,
  lo: number,
  hi: number,
) {
  const p = pops[variant];
  expect(p, `${variant} should be generated at all`).toBeTruthy();
  expect(p.mean, `${variant} mean ${p.mean} outside [${lo}, ${hi}]`).toBeGreaterThanOrEqual(lo);
  expect(p.mean, `${variant} mean ${p.mean} outside [${lo}, ${hi}]`).toBeLessThanOrEqual(hi);
}

test.describe('map composition — MAP_POPULATION is the authority', () => {
  test('Deep Space populates to its recorded mix', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'UNIVERSE');
    const pops = await populations(page);

    expectBand(pops, 'glass-tile', 440, 700);
    expectBand(pops, 'plastic-tile', 100, 200);
    expectBand(pops, 'metal-tile', 30, 70);
    expectBand(pops, 'nebula-tile', 1350, 1950);
    // Free-spawned rock is a fixed count, not a cluster roll.
    expect(pops['rock-shard'].min).toBe(pops['rock-shard'].max);

    // Decision #6: indestructible tiles are for deliberate borders, never
    // random clusters in a natural map.
    expect(pops['indestructible-tile']).toBeUndefined();

    watch.assertClean();
  });

  test('Pocket populates to its recorded mix', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'POCKET');
    const pops = await populations(page);

    expectBand(pops, 'glass-tile', 50, 100);
    expectBand(pops, 'plastic-tile', 22, 55);
    expectBand(pops, 'metal-tile', 8, 28);
    expectBand(pops, 'nebula-tile', 70, 135);
    expect(pops['indestructible-tile']).toBeUndefined();

    watch.assertClean();
  });

  test('Seven Rings is unchanged to the tile, and reads soft-inside-hard-outside', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'SEVEN_RINGS');
    const pops = await populations(page, 2);

    // Ring geometry is deterministic, so this is exact — the strongest form
    // of "the data move changed nothing".
    expect(pops['glass-tile'].min).toBe(234);
    expect(pops['glass-tile'].max).toBe(234);
    expect(pops['plastic-tile'].min).toBe(528);
    expect(pops['plastic-tile'].max).toBe(528);
    expect(pops['metal-tile'].min).toBe(762);
    expect(pops['metal-tile'].max).toBe(762);
    expect(pops['indestructible-tile'].min).toBe(477);
    expect(pops['indestructible-tile'].max).toBe(477);

    // And the ORDER, which is what the table's `tileRings` entries actually
    // say: difficulty readable by radius. Median radius per variant, since a
    // ring is a band rather than a single distance.
    const radii = await engine(page, e => {
      const byVariant: Record<string, number[]> = {};
      for (const en of e.currentMap.entities) {
        if (!en.shardVariant || !String(en.shardVariant).endsWith('-tile')) continue;
        const r = Math.hypot(en.position.x, en.position.y);
        (byVariant[en.shardVariant] ||= []).push(r);
      }
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(byVariant)) {
        v.sort((a, b) => a - b);
        out[k] = v[Math.floor(v.length / 2)];
      }
      return out;
    });

    expect(radii['glass-tile']).toBeLessThan(radii['plastic-tile']);
    expect(radii['plastic-tile']).toBeLessThan(radii['metal-tile']);
    expect(radii['metal-tile']).toBeLessThan(radii['indestructible-tile']);

    watch.assertClean();
  });

  test('the Overworld hub still builds its terrain, stations and rifts', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // The hub was already reading the table; it goes through the same shared
    // helpers now, so it is worth one assertion that nothing fell out.
    const r = await engine(page, e => ({
      stations: e.stations.length,
      portals: e.portals.length,
      arenaRifts: e.portals.filter((p: any) => String(p.portalTargetId).startsWith('arena_')).length,
      rackRifts: e.portals.filter((p: any) => String(p.portalTargetId).startsWith('field_')).length,
      glass: e.currentMap.entities.filter((x: any) => x.shardVariant === 'glass-tile').length,
      nebula: e.currentMap.entities.filter((x: any) => x.shardVariant === 'nebula-tile').length,
      centers: e.currentMap.nebulaClusterCenters.length,
    }));

    expect(r.stations).toBe(4);
    // Four arena rifts PLUS the six-portal test rack beside the home station
    // (the star-field gauntlet's S12). Asserted as its parts rather than as
    // the total, so this says WHICH rifts are expected instead of restating a
    // number that changes whenever one is added.
    expect(r.arenaRifts).toBe(4);
    expect(r.rackRifts).toBe(6);
    expect(r.portals).toBe(r.arenaRifts + r.rackRifts);
    expect(r.glass).toBeGreaterThan(50);
    expect(r.nebula).toBeGreaterThan(300);
    // The background puff layer is driven by these, so an empty list means
    // a nebula map with no backdrop.
    expect(r.centers).toBeGreaterThan(0);

    watch.assertClean();
  });
});
