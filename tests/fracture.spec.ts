/** The seeded Voronoi fracture core (voronoi gauntlet, V1).
 *
 *  Drives the pure functions on `window.__omniFracture` (App.tsx, the
 *  __omniHid precedent): no engine, no canvas, no timing dependence — the
 *  suite pins exactly the properties the fracture feature stands on:
 *
 *   1. DETERMINISM — same (polygon, seed) → identical cells.  The crack
 *      overlay and the shatter read the SAME decomposition on different
 *      frames, so any nondeterminism shows up as cracks that disagree with
 *      the break.
 *   2. AREA CONSERVATION — Σ cell areas ≈ parent area.  The merge paths
 *      keep this invariant; fracture must too, or mass leaks on every kill.
 *   3. CELL VALIDITY — simple polygons only (SAT narrowphase chokes on
 *      self-intersection), no slivers below the minimum area (the site-
 *      retirement rule), concave parents survive (rock spawns at radius
 *      0.60±0.55 — NOT convex).
 *   4. COST — µs per decomposition at 4/8/16/30 sites (30 = the current
 *      rock fragment cap), so "compute lazily and cache" has a measured
 *      basis.  Bounds are deliberately loose: this container rasterises in
 *      software and the suite must not flake (perf/README.md — levels are
 *      indicative, deltas are evidence).
 */

import { test, expect } from '@playwright/test';
import { boot, engine, startRun, waitForStats } from './helpers';

/** Build a jittered star polygon in-page with the module's own PRNG —
 *  the same construction generateShardPolygon uses, at the ROCK spawn
 *  shape's parameters (radiusMin 0.60, radiusRange 0.55, angleJitter 0.5,
 *  6–10 vertices).  Serialized into page.evaluate as a string. */
const STAR_POLY_SRC = `
  function starPoly(fr, baseR, seed, opts) {
    opts = opts || {};
    const rand = fr.mulberry32(seed);
    const nMin = opts.nMin ?? 6, nMax = opts.nMax ?? 10;
    const rMin = opts.rMin ?? 0.60, rRange = opts.rRange ?? 0.55;
    const jitter = opts.jitter ?? 0.5;
    const n = nMin + Math.floor(rand() * (nMax - nMin + 1));
    const pts = [];
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + (rand() - 0.5) * (Math.PI / n) * jitter;
      const r = baseR * (rMin + rand() * rRange);
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return pts;
  }
`;

test.describe('fracture core — determinism', () => {
  test('same polygon + seed → identical cells; different seed → different sites', async ({ page }) => {
    const watch = await boot(page);

    const r = await page.evaluate(`(() => {
      const fr = window.__omniFracture;
      ${STAR_POLY_SRC}
      const poly = starPoly(fr, 40, 1234.5);
      const a = fr.computeFracture(poly, { siteCount: 8, seed: 777.25 });
      const b = fr.computeFracture(poly, { siteCount: 8, seed: 777.25 });
      const c = fr.computeFracture(poly, { siteCount: 8, seed: 778.25 });
      return {
        same: JSON.stringify(a) === JSON.stringify(b),
        differs: JSON.stringify(a.sites) !== JSON.stringify(c.sites),
        cellCount: a.cells.length,
      };
    })()`) as any;

    expect(r.same).toBe(true);
    expect(r.differs).toBe(true);
    expect(r.cellCount).toBeGreaterThanOrEqual(2);

    watch.assertClean();
  });
});

test.describe('fracture core — conservation and validity', () => {
  test('area is conserved and cells are simple across the rock-shape matrix', async ({ page }) => {
    const watch = await boot(page);

    const r = await page.evaluate(`(() => {
      const fr = window.__omniFracture;
      ${STAR_POLY_SRC}
      const failures = [];
      let polys = 0, cellsTotal = 0, retiredTotal = 0;
      const counts = [4, 8, 16, 30];
      for (let seed = 1; seed <= 12; seed++) {
        // Sizes spanning chip (12) to map-load boulder (160).
        const baseR = [12, 40, 80, 160][seed % 4] / 2;
        const poly = starPoly(fr, baseR, seed * 17.7);
        const parentArea = fr.polygonArea(poly);
        for (const siteCount of counts) {
          const res = fr.computeFracture(poly, { siteCount, seed: seed * 3.3 + siteCount });
          polys++;
          cellsTotal += res.cells.length;
          retiredTotal += res.retiredSites;
          const err = Math.abs(res.totalArea - parentArea) / parentArea;
          if (err > 1e-3) failures.push('area seed=' + seed + ' n=' + siteCount + ' err=' + err);
          const minArea = 0.15 * parentArea / siteCount;
          for (const cell of res.cells) {
            if (!fr.isSimplePolygon(cell.points)) {
              failures.push('non-simple seed=' + seed + ' n=' + siteCount);
            }
            if (fr.polygonSignedArea(cell.points) <= 0) {
              failures.push('winding seed=' + seed + ' n=' + siteCount);
            }
            if (cell.area < minArea && res.sites.length > 2) {
              failures.push('sliver seed=' + seed + ' n=' + siteCount + ' a=' + cell.area + ' < ' + minArea);
            }
          }
        }
      }
      return { failures, polys, cellsTotal, retiredTotal };
    })()`) as any;

    expect(r.failures, r.failures.join('\n')).toEqual([]);
    expect(r.polys).toBe(48);
    expect(r.cellsTotal).toBeGreaterThan(0);

    watch.assertClean();
  });

  test('a deliberately concave parent survives — disconnection splits, never corrupts', async ({ page }) => {
    const watch = await boot(page);

    const r = await page.evaluate(`(() => {
      const fr = window.__omniFracture;
      // A deep 12-point star: alternating radii 1.0 / 0.42 — far more
      // concave than any spawned rock, so the S-H bridge case actually
      // fires instead of being dodged by mild geometry.
      const poly = [];
      for (let j = 0; j < 12; j++) {
        const a = (j / 12) * Math.PI * 2;
        const r0 = (j % 2 === 0 ? 1.0 : 0.42) * 50;
        poly.push({ x: Math.cos(a) * r0, y: Math.sin(a) * r0 });
      }
      const parentArea = fr.polygonArea(poly);
      const failures = [];
      for (const seed of [3.7, 11.1, 42.9]) {
        for (const siteCount of [6, 12, 24]) {
          const res = fr.computeFracture(poly, { siteCount, seed });
          const err = Math.abs(res.totalArea - parentArea) / parentArea;
          if (err > 1e-3) failures.push('area seed=' + seed + ' n=' + siteCount + ' err=' + err);
          for (const cell of res.cells) {
            if (!fr.isSimplePolygon(cell.points)) failures.push('non-simple seed=' + seed + ' n=' + siteCount);
            if (cell.points.length < 3) failures.push('degenerate seed=' + seed + ' n=' + siteCount);
          }
        }
      }
      return { failures, parentArea };
    })()`) as any;

    expect(r.failures, r.failures.join('\n')).toEqual([]);

    watch.assertClean();
  });

  test('impact bias pulls sites toward the hit point', async ({ page }) => {
    const watch = await boot(page);

    const r = await page.evaluate(`(() => {
      const fr = window.__omniFracture;
      ${STAR_POLY_SRC}
      const poly = starPoly(fr, 50, 9.9);
      const impact = { x: 35, y: 0, bias: 0.6 };
      const meanDist = (sites) => {
        let s = 0;
        for (const p of sites) s += Math.hypot(p.x - impact.x, p.y - impact.y);
        return s / sites.length;
      };
      // Averaged over seeds so the assertion is about the DISTRIBUTION,
      // not one lucky draw (still fully deterministic).
      let biased = 0, uniform = 0, n = 0;
      for (const seed of [1.1, 2.2, 3.3, 4.4, 5.5, 6.6]) {
        biased  += meanDist(fr.computeFracture(poly, { siteCount: 12, seed, impact }).sites);
        uniform += meanDist(fr.computeFracture(poly, { siteCount: 12, seed }).sites);
        n++;
      }
      return { biased: biased / n, uniform: uniform / n };
    })()`) as any;

    expect(r.biased).toBeLessThan(r.uniform);

    watch.assertClean();
  });

  test('interior edges are inside the parent and deduplicated', async ({ page }) => {
    const watch = await boot(page);

    const r = await page.evaluate(`(() => {
      const fr = window.__omniFracture;
      ${STAR_POLY_SRC}
      const poly = starPoly(fr, 45, 21.4);
      const res = fr.computeFracture(poly, { siteCount: 10, seed: 5.5 });
      const edges = fr.collectInteriorEdges(res.cells, poly);
      const failures = [];
      if (edges.length < res.sites.length - 1) {
        failures.push('too few edges: ' + edges.length + ' for ' + res.sites.length + ' sites');
      }
      for (const e of edges) {
        // Midpoint of a bisector edge lies strictly inside the parent
        // (a boundary edge would have been classified out).
        if (!fr.pointInPolygon(e.mx, e.my, poly)) failures.push('edge midpoint outside parent');
      }
      // Dedup: no two edges share both (quantised) endpoints.
      const keys = new Set();
      for (const e of edges) {
        const q = (v) => Math.round(v * 100);
        const k1 = q(e.ax) + ',' + q(e.ay), k2 = q(e.bx) + ',' + q(e.by);
        const key = k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1;
        if (keys.has(key)) failures.push('duplicate edge ' + key);
        keys.add(key);
      }
      return { failures, edgeCount: edges.length };
    })()`) as any;

    expect(r.failures, r.failures.join('\n')).toEqual([]);
    expect(r.edgeCount).toBeGreaterThan(0);

    watch.assertClean();
  });
});

test.describe('voronoi shatter — the sim path (V2)', () => {
  test('a mobile rock-shard breaks into its own cells, area-conserving; legacy A/B still powerlaws', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ASTEROID_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ASTEROID_FIELD', 'the rock field');

    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const kill = (mode: string) => {
        const t = ents.find((x: any) => x.active && x.shardVariant === 'rock-shard'
          && x.mass !== Infinity && x.size.x >= 80 && (x.mergeCount ?? 1) === 1);
        if (!t) throw new Error('no big rock-shard on the field');
        const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
        const parentSizeSq = t.size.x * t.size.x;
        // Drive the death dispatch directly with the stamps the real
        // impact path (killStructureByImpact / the projectile path)
        // leaves — the probabilistic rock hit model would otherwise
        // shed ROCK_CHIP entities into the count.
        // Mirror killStructureByImpact's contract: the CALLER stamps the
        // impact, zeroes health, flips active and drops the grid entry,
        // THEN raises onDeath.
        t.lastImpactVelocity = { x: -9, y: 0 };
        t.lastImpactDamage = 3;
        t.health = 0;
        t.active = false;
        e.handleEntityDeath(t);
        const children = ents.filter((x: any) => x.active && !before.has(x.id)
          && x.shardVariant === 'rock-shard' && x.mass !== Infinity);
        let childSizeSq = 0;
        let polysOk = true;
        for (const c of children) {
          childSizeSq += c.size.x * c.size.x;
          if (!c.polygonPoints || c.polygonPoints.length < 3) polysOk = false;
        }
        return {
          mode, parentSizeSq, childSizeSq,
          count: children.length, polysOk, dead: t.active === false,
        };
      };
      const voronoi = kill('voronoi');
      e.dbg.cycleFractureMode(); // → legacy
      const legacy = kill('legacy');
      e.dbg.cycleFractureMode(); // → back to voronoi
      return { voronoi, legacy };
    });

    // Voronoi: cells conserve the size² metric exactly by construction.
    expect(r.voronoi.dead).toBe(true);
    expect(r.voronoi.count).toBeGreaterThanOrEqual(2);
    expect(r.voronoi.polysOk).toBe(true);
    expect(Math.abs(r.voronoi.childSizeSq - r.voronoi.parentSizeSq) / r.voronoi.parentSizeSq)
      .toBeLessThan(0.01);
    // Legacy A/B: the powerlaw path still runs (even-area split for rock,
    // so it conserves too — the A/B difference is the GEOMETRY).
    expect(r.legacy.dead).toBe(true);
    expect(r.legacy.count).toBeGreaterThanOrEqual(2);

    watch.assertClean();
  });

  test('a rock-tile breaks into cells under voronoi and into its 3 breakShards under legacy', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ASTEROID_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ASTEROID_FIELD', 'the rock field');

    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const mkTile = (px: number, py: number) => {
        // A synthetic rock-tile mirroring TileGenerator.buildStructureTile's
        // shape: canonical hex polygon, mass ∞, hit-ceiling HP.
        const w = 42;
        const pts = [] as any[];
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          pts.push({ x: Math.cos(a) * w * 0.5, y: Math.sin(a) * w * 0.5 });
        }
        const tile: any = {
          id: 'vor_tile_' + px, type: 'STRUCTURE', shardVariant: 'rock-tile',
          position: { x: px, y: py }, velocity: { x: 0, y: 0 }, rotation: 0,
          size: { x: w, y: w }, mass: Infinity, active: true, color: '#8a8a8a',
          health: 4, maxHealth: 4, polygonPoints: pts,
        };
        ents.push(tile);
        return tile;
      };
      const kill = (mode: string, px: number) => {
        const t = mkTile(px, 3000);
        const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
        t.lastImpactVelocity = { x: -9, y: 0 };
        t.lastImpactDamage = 3;
        t.health = 0;
        t.active = false;
        e.handleEntityDeath(t);
        const children = ents.filter((x: any) => x.active && !before.has(x.id)
          && x.shardVariant === 'rock-shard' && x.mass !== Infinity);
        return { mode, count: children.length, dead: t.active === false };
      };
      const voronoi = kill('voronoi', 4000);
      e.dbg.cycleFractureMode(); // → legacy
      const legacy = kill('legacy', 4400);
      e.dbg.cycleFractureMode(); // → back
      return { voronoi, legacy };
    });

    expect(r.voronoi.dead).toBe(true);
    // fracture: siteCountMin 5 (a 42px hex maps to 5 sites); sliver
    // retirement may retire a couple, never below 2; cells can exceed
    // sites only on a concave parent, which a hex is not.
    expect(r.voronoi.count).toBeGreaterThanOrEqual(3);
    expect(r.voronoi.count).toBeLessThanOrEqual(9);
    // Legacy: exactly the 3 breakShards rock-tile ships with.
    expect(r.legacy.dead).toBe(true);
    expect(r.legacy.count).toBe(3);

    watch.assertClean();
  });
});

test.describe('fracture core — cost', () => {
  test('µs per decomposition at 4/8/16/30 sites stays inside the lazy-cache budget', async ({ page }) => {
    const watch = await boot(page);

    const r = await page.evaluate(`(() => {
      const fr = window.__omniFracture;
      ${STAR_POLY_SRC}
      const poly = starPoly(fr, 60, 77.7);
      const out = {};
      for (const siteCount of [4, 8, 16, 30]) {
        // Warm up, then measure.
        for (let i = 0; i < 10; i++) fr.computeFracture(poly, { siteCount, seed: i });
        const REPS = 60;
        const t0 = performance.now();
        for (let i = 0; i < REPS; i++) {
          fr.computeFracture(poly, { siteCount, seed: 100 + i });
        }
        const t1 = performance.now();
        out['n' + siteCount] = ((t1 - t0) / REPS) * 1000; // µs
      }
      return out;
    })()`) as any;

    console.log(`[fracture cost] µs/decomposition: n4=${r.n4.toFixed(1)} n8=${r.n8.toFixed(1)} n16=${r.n16.toFixed(1)} n30=${r.n30.toFixed(1)}`);

    // Loose ceilings — software rasteriser CI container.  The budget rule
    // this pins: a decomposition is a LAZY, CACHED, sub-millisecond-scale
    // event, never a per-frame cost.  A 30-site decomposition past 5 ms
    // would mean the algorithm regressed a complexity class, not a
    // constant factor.
    expect(r.n4).toBeLessThan(2000);
    expect(r.n8).toBeLessThan(2500);
    expect(r.n16).toBeLessThan(3500);
    expect(r.n30).toBeLessThan(5000);

    watch.assertClean();
  });
});
