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
import { boot, engine, startRun, waitForStats, waitForEngine } from './helpers';

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
    // fracture: a 42px hex maps to ~6 sites (sizePerSite 7, clamp 5-12); sliver
    // retirement may retire a couple, never below 2; cells can exceed
    // sites only on a concave parent, which a hex is not.
    expect(r.voronoi.count).toBeGreaterThanOrEqual(3);
    expect(r.voronoi.count).toBeLessThanOrEqual(12);
    // Legacy: exactly the 3 breakShards rock-tile ships with.
    expect(r.legacy.dead).toBe(true);
    expect(r.legacy.count).toBe(3);

    watch.assertClean();
  });
});

test.describe('cracks are the pattern (V3)', () => {
  test('a damaged rock shows its cell edges, and the break separates along exactly those seams', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ASTEROID_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ASTEROID_FIELD', 'the rock field');

    // Damage a big rock-shard parked ON SCREEN through the real
    // projectile path (rock is hit-counted: −1 HP per hit; the first hit
    // never breaks — ROCK_BREAK's curve is 0 at one hit).
    const shardId = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const t = ents.find((x: any) => x.active && x.shardVariant === 'rock-shard'
        && x.mass !== Infinity && x.size.x >= 100 && (x.mergeCount ?? 1) === 1);
      if (!t) throw new Error('no big rock-shard on the field');
      t.position.x = e.player.position.x + 90;
      t.position.y = e.player.position.y;
      t.velocity.x = 0; t.velocity.y = 0;
      e.physics.resolveCollision(
        {
          id: 'v3_shell', type: 'PROJECTILE',
          position: { x: t.position.x + t.size.x * 0.5 + 4, y: t.position.y },
          velocity: { x: -900, y: 0 }, rotation: Math.PI,
          size: { x: 6, y: 6 }, mass: 0.1, active: true, color: '#fff',
          damage: 1, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
        },
        t, { x: 0, y: 0 }, undefined, e.handleEntityDeath,
      );
      if (t.active !== true) throw new Error('first hit must not kill the rock');
      // Marker for the polls below — waitForEngine's predicate is
      // serialized, so it cannot close over the id.
      t.__v3probe = true;
      return t.id;
    });
    void shardId;

    // The crack overlay computes the decomposition on the next drawn
    // frame — the render path, not a test back door, fills the cache.
    await waitForEngine(page, (e: any) => {
      const t = e.currentMap.entities.find((x: any) => x.__v3probe === true);
      return t !== undefined && t.fractureEdges !== undefined;
    }, 'the crack overlay to build the decomposition');

    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const t = ents.find((x: any) => x.__v3probe === true);
      const cells = t.fractureCells.map((c: any) => ({
        cx: c.centroid.x, cy: c.centroid.y, area: c.area,
      }));
      const edgeCount = t.fractureEdges.length;
      const px = t.position.x, py = t.position.y, rot = t.rotation;
      const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
      // The killing blow, per the killStructureByImpact contract.
      t.lastImpactVelocity = { x: -9, y: 0 };
      t.lastImpactDamage = 2;
      t.health = 0;
      t.active = false;
      e.handleEntityDeath(t);
      const children = ents.filter((x: any) => x.active && !before.has(x.id)
        && x.shardVariant === 'rock-shard' && x.mass !== Infinity);
      // Match each child to its cell: the fragment sits at the cell
      // centroid rotated into world space.
      const cos = Math.cos(rot), sin = Math.sin(rot);
      let matched = 0;
      for (const c of cells) {
        const wx = px + c.cx * cos - c.cy * sin;
        const wy = py + c.cx * sin + c.cy * cos;
        if (children.some((k: any) =>
          Math.abs(k.position.x - wx) < 1 && Math.abs(k.position.y - wy) < 1)) matched++;
      }
      return { cellCount: cells.length, edgeCount, childCount: children.length, matched };
    });

    expect(r.edgeCount).toBeGreaterThan(0);
    expect(r.childCount).toBe(r.cellCount);
    // Every cell produced a fragment AT its own centroid — the pattern
    // the cracks drew is the pattern the pieces fly apart along.
    expect(r.matched).toBe(r.cellCount);

    watch.assertClean();
  });
});

test.describe('partial fracture (V4)', () => {
  test('subtractBoundaryCell: remainder = parent minus the cell, exactly', async ({ page }) => {
    const watch = await boot(page);

    const r = await page.evaluate(`(() => {
      const fr = window.__omniFracture;
      ${STAR_POLY_SRC}
      let attempts = 0, spliced = 0;
      const failures = [];
      for (let seed = 1; seed <= 10; seed++) {
        const poly = starPoly(fr, 40, seed * 13.1);
        const parentArea = fr.polygonArea(poly);
        const res = fr.computeFracture(poly, { siteCount: 7, seed: seed * 2.2 });
        for (const cell of res.cells) {
          attempts++;
          const rem = fr.subtractBoundaryCell(poly, cell.points);
          if (rem === null) continue; // interior / unspliceable — a legal no
          spliced++;
          const err = Math.abs(fr.polygonArea(rem) - (parentArea - cell.area)) / parentArea;
          if (err > 0.02) failures.push('area seed=' + seed + ' err=' + err);
          if (!fr.isSimplePolygon(rem)) failures.push('non-simple seed=' + seed);
        }
      }
      return { attempts, spliced, failures };
    })()`) as any;

    expect(r.failures, r.failures.join('\n')).toEqual([]);
    // Most cells of a convex-ish star are boundary cells; the splice must
    // succeed often enough to carry the chip cadence.
    expect(r.spliced).toBeGreaterThan(r.attempts * 0.5);

    watch.assertClean();
  });

  test('damage highlights the pattern and fully-highlighted pieces break off, ending in the death path', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ASTEROID_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ASTEROID_FIELD', 'the rock field');

    const r = await engine(page, (e: any) => {
      const fr = (window as any).__omniFracture;
      const ents = e.currentMap.entities;
      const w = 42;
      const pts: any[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * w * 0.5, y: Math.sin(a) * w * 0.5 });
      }
      // maxHealth 100 gives the reveal fine granularity so the
      // progressive story is visible step by step.  The id fixes the
      // seed, so this whole test is deterministic.
      const tile: any = {
        id: 'v8_tile', type: 'STRUCTURE', shardVariant: 'rock-tile',
        position: { x: 4200, y: 3000 }, velocity: { x: 0, y: 0 }, rotation: 0,
        size: { x: w, y: w }, mass: Infinity, active: true, color: '#8a8a8a',
        health: 100, maxHealth: 100, polygonPoints: pts,
      };
      ents.push(tile);
      tile.lastImpactVelocity = { x: -9, y: 0 };
      const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
      const chips = () => ents.filter((x: any) => x.active && !before.has(x.id)
        && x.shardVariant === 'rock-shard' && x.mass !== Infinity);

      // The struck point: on the +x face, matching the -x impact
      // velocity.  V12 gates detachment on the piece this point touches.
      const hitAt = { x: tile.position.x + w * 0.5, y: tile.position.y };
      // Undamaged: the pattern is applied but NOTHING detaches.
      e.progressFracture(tile, hitAt);
      const initialCells = tile.fractureCells.length;
      const initialCentroids = tile.fractureCells.map((c: any) =>
        Math.round(c.centroid.x * 10) + ',' + Math.round(c.centroid.y * 10));
      const originalArea = fr.polygonArea(tile.polygonPoints);
      const atZero = {
        patternApplied: initialCells >= 2 && tile.fractureEdges.length > 0,
        chips: chips().length,
      };

      // Step the damage down; each step highlights more boundaries and
      // detaches every piece whose boundary completed.
      const steps: any[] = [];
      for (const hp of [80, 60, 40, 20, 1]) {
        if (!tile.active) break;
        tile.health = hp;
        e.progressFracture(tile, hitAt);
        steps.push({
          hp,
          alive: tile.active === true,
          cellsLeft: tile.active ? tile.fractureCells.length : 0,
          chips: chips().length,
        });
      }

      // Persistence: surviving cells are a SUBSET of the original
      // pattern — nothing was recomputed between detaches.
      let subset = true;
      if (tile.active) {
        for (const c of tile.fractureCells) {
          const key = Math.round(c.centroid.x * 10) + ',' + Math.round(c.centroid.y * 10);
          if (!initialCentroids.includes(key)) subset = false;
        }
      }

      // Conservation: what broke off plus what remains is the shape the
      // pattern was cut from.
      let chipArea = 0;
      for (const c of chips()) chipArea += fr.polygonArea(c.polygonPoints);
      const remainderArea = tile.active ? fr.polygonArea(tile.polygonPoints) : 0;

      return {
        atZero, initialCells, steps, subset,
        finalAlive: tile.active === true,
        totalDebris: chips().length,
        conservationErr: Math.abs((chipArea + remainderArea) - originalArea) / originalArea,
      };
    });

    expect(r.atZero.patternApplied).toBe(true);
    expect(r.atZero.chips).toBe(0);
    // Pieces broke off along the way — the highlight completing is the
    // trigger, no chance roll involved.
    const detached = r.steps.some((s: any) => s.chips > 0);
    expect(detached).toBe(true);
    // Cells only ever leave the pattern, never reshuffle back.
    for (let i = 1; i < r.steps.length; i++) {
      if (r.steps[i].alive) {
        expect(r.steps[i].cellsLeft).toBeLessThanOrEqual(r.steps[i - 1].cellsLeft);
      }
    }
    expect(r.subset).toBe(true);
    if (r.finalAlive) {
      // Alive: every broken piece + the remainder tile the original shape.
      expect(r.conservationErr).toBeLessThan(0.02);
    } else {
      // Dead via min-remainder: chips + death fragments carry the whole
      // pattern.
      expect(r.totalDebris).toBeGreaterThanOrEqual(r.initialCells - 1);
    }

    watch.assertClean();
  });

  test('the min-remainder rule routes the last pieces through the real death path', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ASTEROID_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ASTEROID_FIELD', 'the rock field');

    const r = await engine(page, (e: any) => {
      const fr = (window as any).__omniFracture;
      const ents = e.currentMap.entities;
      const w = 42;
      const pts: any[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * w * 0.5, y: Math.sin(a) * w * 0.5 });
      }
      const tile: any = {
        id: 'v8_tile_b', type: 'STRUCTURE', shardVariant: 'rock-tile',
        position: { x: 4600, y: 3000 }, velocity: { x: 0, y: 0 }, rotation: 0,
        size: { x: w, y: w }, mass: Infinity, active: true, color: '#8a8a8a',
        health: 1, maxHealth: 100, polygonPoints: pts,
      };
      ents.push(tile);
      tile.lastImpactVelocity = { x: -9, y: 0 };
      // A recorded original area far above the polygon puts ANY splice
      // under the min-remainder floor, so the first completed boundary
      // routes the whole entity through the death path deterministically.
      // x12 against the V10 floor of 0.10 (was x5 against 0.25).
      tile.fractureOriginalArea = fr.polygonArea(pts) * 12;
      const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
      e.progressFracture(tile, { x: tile.position.x + w * 0.5, y: tile.position.y });
      const debris = ents.filter((x: any) => x.active && !before.has(x.id)
        && x.shardVariant === 'rock-shard' && x.mass !== Infinity);
      return { died: tile.active === false, debrisCount: debris.length };
    });

    expect(r.died).toBe(true);
    expect(r.debrisCount).toBeGreaterThanOrEqual(2);

    watch.assertClean();
  });

  test('the dent pull stands down for progressive variants under voronoi and runs under legacy', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ASTEROID_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ASTEROID_FIELD', 'the rock field');

    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const w = 42;
      const mk = (id: string, px: number) => {
        const pts: any[] = [];
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          pts.push({ x: Math.cos(a) * w * 0.5, y: Math.sin(a) * w * 0.5 });
        }
        const tile: any = {
          id, type: 'STRUCTURE', shardVariant: 'rock-tile',
          position: { x: px, y: 3400 }, velocity: { x: 0, y: 0 }, rotation: 0,
          size: { x: w, y: w }, mass: Infinity, active: true, color: '#8a8a8a',
          health: 6, maxHealth: 6, polygonPoints: pts,
        };
        ents.push(tile);
        return tile;
      };
      const Physics = Object.getPrototypeOf(e.physics).constructor;
      const dent = (t: any) => {
        const beforePts = JSON.stringify(t.polygonPoints);
        Physics.applyDentStep(t, { x: t.position.x + w * 0.5, y: t.position.y });
        return JSON.stringify(t.polygonPoints) !== beforePts;
      };
      const tV = mk('v8_dent_v', 5200);
      const movedVoronoi = dent(tV);
      e.dbg.cycleFractureMode(); // -> legacy
      const tL = mk('v8_dent_l', 5600);
      const movedLegacy = dent(tL);
      e.dbg.cycleFractureMode(); // -> back
      return { movedVoronoi, movedLegacy };
    });

    // The pattern must stay stable under voronoi - the highlight is the
    // damage read; legacy keeps the shipped dent.
    expect(r.movedVoronoi).toBe(false);
    expect(r.movedLegacy).toBe(true);

    watch.assertClean();
  });
});

test.describe('death is dispatched once (V9 regression)', () => {
  test('a mid-hit min-remainder death does not double-shatter into duplicate fragments', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ASTEROID_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ASTEROID_FIELD', 'the rock field');

    const r = await engine(page, (e: any) => {
      const fr = (window as any).__omniFracture;
      const ents = e.currentMap.entities;
      const w = 42;
      const pts: any[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * w * 0.5, y: Math.sin(a) * w * 0.5 });
      }
      // Full health, 2-hit ceiling: the FIRST hit never triggers the
      // probabilistic rock break (its chance is 0 at one hit taken), so
      // the kill can only come from progressFracture's min-remainder
      // death INSIDE the damage hook — the exact mid-hit shape the
      // double-dispatch bug needs (verified: with the guard disabled
      // this scenario yields 2 dispatches and an exact duplicate of
      // every fragment).
      const tile: any = {
        id: 'v9_dup_tile', type: 'STRUCTURE', shardVariant: 'rock-tile',
        position: { x: 4200, y: 2600 }, velocity: { x: 0, y: 0 }, rotation: 0,
        size: { x: w, y: w }, mass: Infinity, active: true, color: '#8a8a8a',
        health: 2, maxHealth: 2, polygonPoints: pts,
      };
      ents.push(tile);
      tile.lastImpactVelocity = { x: -9, y: 0 };
      // The min-remainder trip: any splice lands under the floor.
      tile.fractureOriginalArea = fr.polygonArea(pts) * 12;
      const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
      // REAL projectile kill path: onDamage (progressFracture -> death)
      // runs BEFORE the outer health<=0 block — the exact double-dispatch
      // shape of the bug.
      e.physics.resolveCollision(
        {
          id: 'v9_shell', type: 'PROJECTILE',
          position: { x: tile.position.x + w * 0.5 + 4, y: tile.position.y },
          velocity: { x: -900, y: 0 }, rotation: Math.PI,
          size: { x: 6, y: 6 }, mass: 0.1, active: true, color: '#fff',
          damage: 1, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
        },
        tile, { x: 0, y: 0 },
        // The REAL damage-feedback hook — the chip/progressFracture site
        // lives inside it, and the bug was exactly its death racing the
        // outer health<=0 dispatch.
        e.spawnDamageText.bind(e),
        e.handleEntityDeath,
      );
      const children = ents.filter((x: any) => x.active && !before.has(x.id)
        && x.shardVariant === 'rock-shard' && x.mass !== Infinity);
      // Duplicate detector: under the bug every fragment spawned twice at
      // the same cell centroid.  Quantise positions and count collisions.
      const seen = new Set<string>();
      let dupes = 0;
      for (const c of children) {
        const key = Math.round(c.position.x) + ',' + Math.round(c.position.y);
        if (seen.has(key)) dupes++;
        seen.add(key);
      }
      return { died: tile.active === false, childCount: children.length, dupes };
    });

    expect(r.died).toBe(true);
    expect(r.childCount).toBeGreaterThanOrEqual(2);
    // The bug spawned an exact overlapping duplicate of EVERY fragment.
    expect(r.dupes).toBe(0);

    watch.assertClean();
  });
});

test.describe('a body shatters exactly once (V13 regression)', () => {
  test('a large rock shard\'s fragments do not multiply on the following frame', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ASTEROID_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ASTEROID_FIELD', 'the rock field');

    // The bug: a legacy census sweep in the sim loop shattered every
    // rock-shard it found deactivated, on top of the death path's own
    // shatter — so the fragment set appeared TWICE, one frame apart.
    // Counting across a real frame boundary is what catches it; counting
    // only at the moment of death does not.
    const r = await engine(page, async (e: any) => {
      const ents = e.currentMap.entities;
      const t = ents.find((x: any) => x.active && x.shardVariant === 'rock-shard'
        && x.mass !== Infinity && x.size.x >= 90);
      if (!t) throw new Error('no large rock shard on the field');
      t.velocity.x = 0; t.velocity.y = 0;
      e.player.position.x = t.position.x + 6000;
      const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
      const kids = () => ents.filter((x: any) => x.active && !before.has(x.id)
        && x.shardVariant === 'rock-shard' && x.mass !== Infinity).length;

      t.lastImpactVelocity = { x: -9, y: 0 };
      t.lastImpactDamage = 2;
      t.health = 0;
      t.active = false;
      e.handleEntityDeath(t);
      const atDeath = kids();
      // Let the sim run real frames — the census swept on the step AFTER
      // the death, which is why one frame has to elapse.
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      return { atDeath, afterFrame: kids() };
    });

    expect(r.atDeath).toBeGreaterThanOrEqual(2);
    // Not "no duplicate positions": the second set drifted before it could
    // be compared, so only the COUNT exposes the doubling.
    expect(r.afterFrame).toBe(r.atDeath);

    watch.assertClean();
  });

  test('shatter refuses a second call on the same body', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ASTEROID_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ASTEROID_FIELD', 'the rock field');

    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const t = ents.find((x: any) => x.active && x.shardVariant === 'rock-shard'
        && x.mass !== Infinity && x.size.x >= 90);
      if (!t) throw new Error('no large rock shard on the field');
      const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
      const kids = () => ents.filter((x: any) => x.active && !before.has(x.id)
        && x.shardVariant === 'rock-shard' && x.mass !== Infinity).length;
      t.lastImpactVelocity = { x: -9, y: 0 };
      t.lastImpactDamage = 2;
      t.health = 0;
      t.active = false;
      e.shards.shatter(t, ents);
      const once = kids();
      e.shards.shatter(t, ents);
      e.shards.shatter(t, ents);
      return { once, thrice: kids() };
    });

    expect(r.once).toBeGreaterThanOrEqual(2);
    expect(r.thrice).toBe(r.once);

    watch.assertClean();
  });

  test('an ordinary merge sprays no debris — only damage breaks a body', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ASTEROID_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ASTEROID_FIELD', 'the rock field');

    // The same census sweep also shattered FULL-HEALTH shards that a
    // merge had just absorbed (measured: 10/10 and 11/11 hp bodies), so
    // a quiet field with nothing being shot still produced debris.
    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      (window as any).__shatteredHealthy = 0;
      const orig = e.shards.shatter.bind(e.shards);
      e.shards.shatter = (p: any, arr: any) => {
        if ((p.health ?? 0) >= (p.maxHealth ?? 0) && (p.maxHealth ?? 0) > 0) {
          (window as any).__shatteredHealthy++;
        }
        return orig(p, arr);
      };
      return { entities: ents.length };
    });
    expect(r.entities).toBeGreaterThan(0);

    // Let the field live: merges happen constantly on a rock field.
    await waitForEngine(page, (e: any) => e.runTimeSec > 4, 'a few seconds of quiet field');

    const healthy = await page.evaluate(() => (window as any).__shatteredHealthy);
    expect(healthy).toBe(0);

    watch.assertClean();
  });
});

test.describe('the glass damage layer (V9)', () => {
  test('a real glass tile survives base blaster hits, webs with cracks, and its shards carry the shard HP', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');
    await waitForStats(page, s => s.currentMapType === 'GLASS_FIELD', 'the glass field');

    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const t = ents.find((x: any) => x.active && x.shardVariant === 'glass-tile'
        && x.mass === Infinity);
      if (!t) throw new Error('no glass tile on the glass field');
      const shoot = (dmg: number) => {
        e.physics.resolveCollision(
          {
            id: 'v9_blaster_' + Math.random(), type: 'PROJECTILE',
            position: { x: t.position.x + t.size.x * 0.5 + 4, y: t.position.y },
            velocity: { x: -900, y: 0 }, rotation: Math.PI,
            size: { x: 6, y: 6 }, mass: 0.1, active: true, color: '#fff',
            damage: dmg, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
          },
          t, { x: 0, y: 0 }, undefined, e.handleEntityDeath,
        );
      };
      const maxHp = t.maxHealth;
      const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
      shoot(4); // one base blaster hit
      const afterOne = { alive: t.active === true, health: t.health };
      shoot(4);
      const afterTwo = { alive: t.active === true, health: t.health };
      // V10: glass chips like rock, so the pane may leave early via the
      // min-remainder rule — keep hitting until it goes, capped.
      let hits = 2;
      while (t.active && hits < 8) { shoot(4); hits++; }
      const dead = t.active === false;
      const children = ents.filter((x: any) => x.active && !before.has(x.id)
        && x.shardVariant === 'glass-shard' && x.mass !== Infinity);
      return {
        maxHp, afterOne, afterTwo, dead,
        childCount: children.length,
        childHp: children.map((c: any) => c.maxHealth),
      };
    });

    // The MAP-SPAWNED tile carries the damage layer (V9: 12 HP; V10: 20,
    // five base blaster hits, so the progressive reveal has room to shed
    // pieces on the way down).
    expect(r.maxHp).toBe(20);
    // It survives base blaster hits and loses exactly the weapon damage.
    expect(r.afterOne.alive).toBe(true);
    expect(r.afterOne.health).toBe(16);
    expect(r.afterTwo.alive).toBe(true);
    expect(r.afterTwo.health).toBe(12);
    // And it does eventually go, leaving its cells behind.
    expect(r.dead).toBe(true);
    expect(r.childCount).toBeGreaterThanOrEqual(2);
    // The debris carries the shard damage layer (V9: 8; V10: 12).
    for (const hp of r.childHp) expect(hp).toBe(12);

    watch.assertClean();
  });
});

test.describe('chip depth and the glass roll-out (V10)', () => {
  test('the rock early-break roll stands down under voronoi and still fires under legacy', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ASTEROID_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ASTEROID_FIELD', 'the rock field');

    const r = await engine(page, (e: any) => {
      const Physics = Object.getPrototypeOf(e.physics).constructor;
      const mk = () => ({
        id: 'v10_roll', type: 'STRUCTURE', shardVariant: 'rock-tile',
        position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, rotation: 0,
        size: { x: 42, y: 42 }, mass: Infinity, active: true, color: '#8a8a8a',
        // hitsTaken = ceiling - health = 7 of 8, i.e. p(break) = 6/7 on
        // the legacy curve.  NOT a certainty — hence the count-over-many
        // shape below rather than a single call, which flaked at ~14%.
        health: 1, maxHealth: 8,
      } as any);
      const rolls = (n: number) => {
        let killed = 0;
        for (let i = 0; i < n; i++) {
          const t = mk();
          Physics.maybeRockEarlyBreak(t);
          if (t.health <= 0) killed++;
        }
        return killed;
      };
      // Voronoi (default): the roll must never end the rock early — the
      // progressive model owns the break.  Deterministic: the stand-down
      // returns before any Math.random call.
      const killedUnderVoronoi = rolls(40);
      e.dbg.cycleFractureMode(); // -> legacy
      // Legacy: p(break) is 6/7 per roll, so 40 rolls yielding zero has
      // probability ~1e-33 — effectively deterministic without pinning a
      // single coin flip.
      const killedUnderLegacy = rolls(40);
      e.dbg.cycleFractureMode(); // -> back
      return { killedUnderVoronoi, killedUnderLegacy };
    });

    expect(r.killedUnderVoronoi).toBe(0);
    expect(r.killedUnderLegacy).toBeGreaterThan(0);

    watch.assertClean();
  });

  test('a real rock tile sheds several pieces across its life before the final break', async ({ page }) => {
    const watch = await boot(page);
    // ROCK_FIELD is the rock-TILE showcase; ASTEROID_FIELD is the mobile
    // rock-shard one.
    await startRun(page, 'ROCK_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ROCK_FIELD', 'the rock-tile field');

    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const t = ents.find((x: any) => x.active && x.shardVariant === 'rock-tile'
        && x.mass === Infinity);
      if (!t) throw new Error('no rock tile on the field');
      e.player.position.x = t.position.x + 4000;
      e.player.position.y = t.position.y + 4000;
      const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
      const debris = () => ents.filter((x: any) => x.active && !before.has(x.id)
        && x.shardVariant === 'rock-shard' && x.mass !== Infinity).length;

      const ceiling = t.maxHealth;
      let hits = 0;
      let debrisWhileAlive = 0;
      // A real shot travels until it overlaps the tile's LIVE polygon, so
      // as pieces chip away the contact point follows the receding face
      // inward.  Firing from a fixed point instead would keep testing a
      // spot the tile no longer occupies — an artefact of the harness,
      // not of the game (V12 gates detachment on that contact point).
      const contactX = () => {
        let mx = -Infinity;
        for (const p of t.polygonPoints) {
          if (Math.abs(p.y) < t.size.y * 0.45) mx = Math.max(mx, p.x);
        }
        return t.position.x + (mx === -Infinity ? t.size.x * 0.5 : mx) - 1;
      };
      while (t.active && hits < 40) {
        e.physics.resolveCollision(
          {
            id: 'v10_shot_' + hits, type: 'PROJECTILE',
            position: { x: contactX(), y: t.position.y },
            velocity: { x: -900, y: 0 }, rotation: Math.PI,
            size: { x: 6, y: 6 }, mass: 0.1, active: true, color: '#fff',
            damage: 1, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
          },
          t, { x: 0, y: 0 }, e.spawnDamageText.bind(e), e.handleEntityDeath,
        );
        hits++;
        if (t.active) debrisWhileAlive = debris();
      }
      return { ceiling, hits, debrisWhileAlive, totalDebris: debris(), died: !t.active };
    });

    // V10 raised the ceiling (4-6 -> 8-12) so the pattern has hits to
    // reveal across; with the early-break roll gone the tile actually
    // reaches them.
    expect(r.ceiling).toBeGreaterThanOrEqual(8);
    expect(r.died).toBe(true);
    // THE ASK: pieces come off DURING its life, not only at the end.
    expect(r.debrisWhileAlive).toBeGreaterThanOrEqual(3);
    expect(r.totalDebris).toBeGreaterThan(r.debrisWhileAlive);
    // It survived more than the old 4-hit floor to do it.
    expect(r.hits).toBeGreaterThanOrEqual(4);

    watch.assertClean();
  });

  test('a real glass tile chips like rock — pieces break off before the pane goes', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');
    await waitForStats(page, s => s.currentMapType === 'GLASS_FIELD', 'the glass field');

    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const t = ents.find((x: any) => x.active && x.shardVariant === 'glass-tile'
        && x.mass === Infinity);
      if (!t) throw new Error('no glass tile on the field');
      e.player.position.x = t.position.x + 4000;
      e.player.position.y = t.position.y + 4000;
      const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
      const debris = () => ents.filter((x: any) => x.active && !before.has(x.id)
        && x.shardVariant === 'glass-shard' && x.mass !== Infinity).length;
      const areaOf = (pts: any[]) => {
        let a = 0;
        for (let i = 0, n = pts.length; i < n; i++) {
          const p = pts[i], q = pts[(i + 1) % n];
          a += p.x * q.y - q.x * p.y;
        }
        return Math.abs(a / 2);
      };
      const area0 = areaOf(t.polygonPoints);
      let hits = 0, debrisWhileAlive = 0, areaWhileAlive = area0;
      const contactX = () => {
        let mx = -Infinity;
        for (const p of t.polygonPoints) {
          if (Math.abs(p.y) < t.size.y * 0.45) mx = Math.max(mx, p.x);
        }
        return t.position.x + (mx === -Infinity ? t.size.x * 0.5 : mx) - 1;
      };
      while (t.active && hits < 12) {
        e.physics.resolveCollision(
          {
            id: 'v10_glass_' + hits, type: 'PROJECTILE',
            position: { x: contactX(), y: t.position.y },
            velocity: { x: -900, y: 0 }, rotation: Math.PI,
            size: { x: 6, y: 6 }, mass: 0.1, active: true, color: '#fff',
            damage: 4, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
          },
          t, { x: 0, y: 0 }, e.spawnDamageText.bind(e), e.handleEntityDeath,
        );
        hits++;
        if (t.active) {
          debrisWhileAlive = debris();
          areaWhileAlive = areaOf(t.polygonPoints);
        }
      }
      return {
        maxHp: t.maxHealth, hits, died: !t.active,
        debrisWhileAlive, totalDebris: debris(),
        shrank: areaWhileAlive < area0 * 0.999,
      };
    });

    expect(r.maxHp).toBe(20);
    expect(r.died).toBe(true);
    // THE ASK: glass now takes rock's breaking behaviour — pieces detach
    // mid-life and the pane's own polygon loses their area.
    expect(r.debrisWhileAlive).toBeGreaterThanOrEqual(1);
    expect(r.shrank).toBe(true);
    expect(r.totalDebris).toBeGreaterThan(r.debrisWhileAlive);

    watch.assertClean();
  });
});

test.describe('materials through the cells (V5)', () => {
  test('glass and plastic tiles break into their own cells under voronoi, legacy fans under legacy', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ASTEROID_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ASTEROID_FIELD', 'the field');

    const r = await engine(page, (e: any) => {
      const fr = (window as any).__omniFracture;
      const ents = e.currentMap.entities;
      let px = 5000;
      const mkTile = (variant: string) => {
        const w = 42;
        const pts: any[] = [];
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          pts.push({ x: Math.cos(a) * w * 0.5, y: Math.sin(a) * w * 0.5 });
        }
        px += 400;
        const tile: any = {
          id: 'v5_' + variant + '_' + px, type: 'STRUCTURE', shardVariant: variant,
          position: { x: px, y: 3200 }, velocity: { x: 0, y: 0 }, rotation: 0,
          size: { x: w, y: w }, mass: Infinity, active: true, color: '#a5f3fc',
          health: 4, maxHealth: 4, polygonPoints: pts,
        };
        ents.push(tile);
        return tile;
      };
      const kill = (variant: string, childVariant: string) => {
        const t = mkTile(variant);
        const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
        const areaBefore = fr.polygonArea(t.polygonPoints);
        t.lastImpactVelocity = { x: -9, y: 0 };
        t.lastImpactDamage = 3;
        t.health = 0;
        t.active = false;
        e.handleEntityDeath(t);
        const children = ents.filter((x: any) => x.active && !before.has(x.id)
          && x.shardVariant === childVariant && x.mass !== Infinity);
        let childArea = 0;
        for (const c of children) childArea += fr.polygonArea(c.polygonPoints);
        return {
          count: children.length,
          areaErr: Math.abs(childArea - areaBefore) / areaBefore,
          healths: children.map((c: any) => c.health),
        };
      };

      const glassV = kill('glass-tile', 'glass-shard');
      const plasticV = kill('plastic-tile', 'plastic-shard');
      e.dbg.cycleFractureMode(); // → legacy
      const glassL = kill('glass-tile', 'glass-shard');
      const plasticL = kill('plastic-tile', 'plastic-shard');
      e.dbg.cycleFractureMode(); // → back to voronoi
      return { glassV, plasticV, glassL, plasticL };
    });

    // Voronoi: cells partition the tile — child polygon area sums to the
    // tile's own polygon area.
    expect(r.glassV.count).toBeGreaterThanOrEqual(3);
    expect(r.glassV.areaErr).toBeLessThan(0.02);
    expect(r.plasticV.count).toBeGreaterThanOrEqual(3);
    expect(r.plasticV.areaErr).toBeLessThan(0.02);
    // Plastic children keep the dent contract's 24-HP durability.
    for (const h of r.plasticV.healths) expect(h).toBe(24);
    // Legacy A/B: the old fans still run (glass 2-12 fresh silhouettes,
    // plastic exactly the 8-12 breakShards burst at 24 HP).
    expect(r.glassL.count).toBeGreaterThanOrEqual(2);
    expect(r.plasticL.count).toBeGreaterThanOrEqual(8);
    expect(r.plasticL.count).toBeLessThanOrEqual(12);
    for (const h of r.plasticL.healths) expect(h).toBe(24);

    watch.assertClean();
  });
});

test.describe('only the struck piece chips (V12)', () => {
  test('shooting one face never pops a piece off the far side', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ROCK_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ROCK_FIELD', 'the rock-tile field');

    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const t = ents.find((x: any) => x.active && x.shardVariant === 'rock-tile'
        && x.mass === Infinity);
      if (!t) throw new Error('no rock tile on the field');
      e.player.position.x = t.position.x + 6000;
      const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));

      // Drive the pattern to FULLY revealed, so every piece in it is
      // boundary-complete and the ONLY thing standing between a far-side
      // piece and detachment is the contact rule under test.
      t.lastImpactVelocity = { x: -9, y: 0 };
      t.health = 1;

      // Always shoot the +x face.  Track the receding surface the way a
      // real projectile does.
      const contactX = () => {
        let mx = -Infinity;
        for (const p of t.polygonPoints) {
          if (Math.abs(p.y) < t.size.y * 0.45) mx = Math.max(mx, p.x);
        }
        return t.position.x + (mx === -Infinity ? t.size.x * 0.5 : mx) - 1;
      };
      const half = t.size.x * 0.5;
      let hits = 0;
      while (t.active && hits < 12) {
        e.progressFracture(t, { x: contactX(), y: t.position.y });
        hits++;
        if (t.active) t.health = 1; // hold the reveal at full
      }
      const chips = ents.filter((x: any) => x.active && !before.has(x.id)
        && x.shardVariant === 'rock-shard' && x.mass !== Infinity);
      // Local x of each chip relative to the tile centre, in half-widths:
      // +1 is the struck face, -1 the far one.
      const sides = chips.map((c: any) => (c.position.x - t.position.x) / half);
      return {
        chipCount: chips.length,
        sides,
        worstFarSide: sides.length ? Math.min(...sides) : 0,
        died: !t.active,
      };
    });

    // It did chip — otherwise the assertion below would pass vacuously.
    expect(r.chipCount).toBeGreaterThan(0);
    // And every piece came off the struck side.  The tolerance admits a
    // cell straddling the centre line (its centroid can sit slightly
    // past it); a far-side piece would land near -1.
    expect(r.worstFarSide).toBeGreaterThan(-0.35);

    watch.assertClean();
  });

  test('a hit with no contact point cracks but never detaches', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ROCK_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ROCK_FIELD', 'the rock-tile field');

    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const t = ents.find((x: any) => x.active && x.shardVariant === 'rock-tile'
        && x.mass === Infinity);
      if (!t) throw new Error('no rock tile on the field');
      e.player.position.x = t.position.x + 6000;
      t.lastImpactVelocity = { x: -9, y: 0 };
      t.health = 1; // fully revealed
      const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
      for (let i = 0; i < 6; i++) {
        e.progressFracture(t); // no contact point supplied
        if (t.active) t.health = 1;
      }
      const chips = ents.filter((x: any) => x.active && !before.has(x.id)
        && x.shardVariant === 'rock-shard' && x.mass !== Infinity);
      return { chipCount: chips.length, alive: t.active === true, cracked: (t.fractureEdges ?? []).length > 0 };
    });

    // The pattern still builds and shows, but nothing is contacted, so
    // nothing breaks off — the hit-ceiling and min-remainder rules stay
    // the only other ways a body ends.
    expect(r.cracked).toBe(true);
    expect(r.chipCount).toBe(0);
    expect(r.alive).toBe(true);

    watch.assertClean();
  });
});

test.describe('cell regularity (V11)', () => {
  test('Lloyd relaxation makes the chunks measurably more regular, and stays deterministic', async ({ page }) => {
    const watch = await boot(page);

    const r = await page.evaluate(`(() => {
      const fr = window.__omniFracture;
      ${STAR_POLY_SRC}
      const perim = (pts) => {
        let p = 0;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          p += Math.hypot(b.x - a.x, b.y - a.y);
        }
        return p;
      };
      // Two shape statistics, both standard:
      //   areaCV   — coefficient of variation of cell areas. Lower means
      //              the pieces are more equally sized.
      //   roundness — 4*pi*A / P^2 per cell. 1 is a circle, 0.907 a
      //              regular hexagon, 0.785 a square; slivers tend to 0.
      const measure = (relax) => {
        let cv = 0, round = 0, cells = 0, polys = 0, areaErr = 0;
        for (let seed = 1; seed <= 14; seed++) {
          const poly = starPoly(fr, 24, seed * 7.3);
          const parentArea = fr.polygonArea(poly);
          const res = fr.computeFracture(poly, {
            siteCount: 8, seed: seed * 3.1,
            impact: { x: 8, y: 0, bias: 0.75 },
            relaxIterations: relax, minSeparation: 0.35,
          });
          areaErr = Math.max(areaErr, Math.abs(res.totalArea - parentArea) / parentArea);
          const areas = res.cells.map(c => c.area);
          const mean = areas.reduce((a, b) => a + b, 0) / areas.length;
          const sd = Math.sqrt(areas.reduce((a, b) => a + (b - mean) ** 2, 0) / areas.length);
          cv += sd / mean;
          polys++;
          for (const c of res.cells) {
            const p = perim(c.points);
            round += (4 * Math.PI * c.area) / (p * p);
            cells++;
            if (!fr.isSimplePolygon(c.points)) return { broken: true };
          }
        }
        return { areaCV: cv / polys, roundness: round / cells, areaErr };
      };
      const poly = starPoly(fr, 24, 99.5);
      const opts = { siteCount: 8, seed: 4.25, relaxIterations: 3, minSeparation: 0.35 };
      return {
        raw: measure(0),
        relaxed: measure(2),
        heavy: measure(4),
        deterministic: JSON.stringify(fr.computeFracture(poly, opts))
                    === JSON.stringify(fr.computeFracture(poly, opts)),
      };
    })()`) as any;

    expect(r.raw.broken).toBeUndefined();
    expect(r.relaxed.broken).toBeUndefined();
    expect(r.heavy.broken).toBeUndefined();

    // More relaxation => more equally sized pieces, and rounder ones.
    // The absolute figures measured here were CV 0.53 / 0.28 / 0.19 and
    // roundness 0.69 / 0.77 / 0.79 — pinned as ORDERING plus loose
    // bounds, so a tuning change moves them without failing the suite
    // but a regression that flattens the effect does fail.
    expect(r.relaxed.areaCV).toBeLessThan(r.raw.areaCV);
    expect(r.heavy.areaCV).toBeLessThanOrEqual(r.relaxed.areaCV);
    expect(r.relaxed.roundness).toBeGreaterThan(r.raw.roundness);
    expect(r.relaxed.areaCV).toBeLessThan(r.raw.areaCV * 0.8);
    expect(r.relaxed.roundness).toBeGreaterThan(0.72);

    // Relaxation must not break the invariants the rest of the system
    // rests on: area still partitions the parent exactly.
    expect(r.raw.areaErr).toBeLessThan(1e-3);
    expect(r.relaxed.areaErr).toBeLessThan(1e-3);
    expect(r.heavy.areaErr).toBeLessThan(1e-3);

    // And it is still a pure function of (polygon, seed, options).
    expect(r.deterministic).toBe(true);

    watch.assertClean();
  });

  test('the shape knobs are live — a cycle rebuilds a cached pattern', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ROCK_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ROCK_FIELD', 'the rock-tile field');

    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const t = ents.find((x: any) => x.active && x.shardVariant === 'rock-tile'
        && x.mass === Infinity);
      if (!t) throw new Error('no rock tile on the field');
      t.lastImpactVelocity = { x: -9, y: 0 };
      // Build a pattern under the current knobs...
      const at = { x: t.position.x + t.size.x * 0.5, y: t.position.y };
      e.progressFracture(t, at);
      const before = t.fractureCells.map((c: any) =>
        Math.round(c.centroid.x * 10) + ',' + Math.round(c.centroid.y * 10)).join('|');
      const genBefore = t.fractureGen;
      // ...turn the site-count multiplier, and read it back.
      e.dbg.cycleFractureSiteScale();
      e.progressFracture(t, at);
      const after = t.fractureCells.map((c: any) =>
        Math.round(c.centroid.x * 10) + ',' + Math.round(c.centroid.y * 10)).join('|');
      const genAfter = t.fractureGen;
      // Restore (the cycle is global state shared with the other specs).
      for (let i = 0; i < 4; i++) e.dbg.cycleFractureSiteScale();
      return { changed: before !== after, genMoved: genAfter !== genBefore };
    });

    expect(r.genMoved).toBe(true);
    expect(r.changed).toBe(true);

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
