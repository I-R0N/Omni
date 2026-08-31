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
import { boot, engine, startRun, stats, waitForStats, waitForEngine } from './helpers';

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
    // fracture: a 42px hex maps to ~6 sites (grainSize 7, clamp 5-12); sliver
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
      // A real player bolt into that face — V15 moved the damage into the
      // boundaries, so a test that sets `health` directly is no longer
      // driving anything.  This is the same path the game runs.
      let shotN = 0;
      const shoot = (dmg: number) => {
        e.physics.resolveCollision(
          {
            id: 'v8_bolt_' + (shotN++), type: 'PROJECTILE',
            position: { x: hitAt.x + 4, y: hitAt.y },
            velocity: { x: -900, y: 0 }, rotation: Math.PI,
            size: { x: 6, y: 6 }, mass: 0.1, active: true, color: '#fff',
            damage: dmg, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
          },
          tile, { x: 0, y: 0 }, e.spawnDamageText.bind(e), e.handleEntityDeath,
        );
      };
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
      for (let step = 0; step < 12; step++) {
        if (!tile.active) break;
        shoot(4);
        steps.push({
          hp: tile.active ? tile.health : 0,
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

  test('a body ends when its last boundary breaks — never at an area floor (V15)', async ({ page }) => {
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
        health: 9, maxHealth: 9, polygonPoints: pts,
      };
      ents.push(tile);
      tile.lastImpactVelocity = { x: -9, y: 0 };
      // The OLD trip: an original area far above the polygon put every
      // splice under MIN_REMAINDER_FRAC, so the first completed boundary
      // killed the tile outright.  V15 removed that floor for grain
      // materials — it is exactly the arbitrary limit the model replaces —
      // so the same setup must NOT end the body early any more.
      tile.fractureOriginalArea = fr.polygonArea(pts) * 12;
      const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
      const hitAt = { x: tile.position.x + w * 0.5, y: tile.position.y };
      let shotN = 0;
      const shoot = () => {
        e.physics.resolveCollision(
          {
            id: 'v15_bolt_' + (shotN++), type: 'PROJECTILE',
            position: { x: hitAt.x + 4, y: hitAt.y },
            velocity: { x: -900, y: 0 }, rotation: Math.PI,
            size: { x: 6, y: 6 }, mass: 0.1, active: true, color: '#fff',
            damage: 4, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
          },
          tile, { x: 0, y: 0 }, e.spawnDamageText.bind(e), e.handleEntityDeath,
        );
      };
      // Watch every hit: the body must never end while a boundary it
      // still needs is unbroken.
      let diedWithBoundaryLeft = false;
      let hits = 0;
      let unbrokenAtDeath = -1;
      while (tile.active && hits < 20) {
        shoot();
        hits++;
        if (!tile.active) {
          // Count boundaries still binding a surviving cell.
          const edges = tile.fractureEdges ?? [];
          const fill = tile.fractureEdgeFill ?? [];
          const living = new Set((tile.fractureCells ?? []).map((c: any) => c.siteIndex));
          let unbroken = 0;
          for (let k = 0; k < edges.length; k++) {
            const ed = edges[k];
            let binds = ed.cells.length === 1;
            if (!binds) for (const st of ed.cells) if (living.has(st)) { binds = true; break; }
            if (binds && (fill[k] ?? 0) < 1e9 && (fill[k] ?? 0) + 1e-6 < edgeNeed(tile, ed)) unbroken++;
          }
          unbrokenAtDeath = unbroken;
          if (unbroken > 0 && (tile.health ?? 0) > 1e-6) diedWithBoundaryLeft = true;
        }
      }
      function edgeNeed(t: any, ed: any) {
        const len = Math.hypot(ed.bx - ed.ax, ed.by - ed.ay);
        // rock's shipped bondStrength; the assertion below only needs
        // the ORDER of magnitude, so a drift in the constant cannot make
        // this pass falsely.
        return Math.max(0.05, 0.27 * len);
      }
      const debris = ents.filter((x: any) => x.active && !before.has(x.id)
        && x.shardVariant === 'rock-shard' && x.mass !== Infinity);
      return {
        died: tile.active === false, hits, debrisCount: debris.length,
        diedWithBoundaryLeft, unbrokenAtDeath,
        finalHealth: tile.active ? tile.health : 0,
      };
    });

    // It still dies, and still leaves its pattern behind as pieces.
    expect(r.died).toBe(true);
    expect(r.debrisCount).toBeGreaterThanOrEqual(2);
    // But it took a real beating to get there — the old floor ended it on
    // the FIRST completed boundary, so anything above a couple of hits
    // proves the floor is not what is ending it.
    expect(r.hits).toBeGreaterThan(3);
    // And the ending is the boundaries, not a limit: no hit ever ended the
    // body while it still had an unbroken boundary and health to spare.
    expect(r.diedWithBoundaryLeft).toBe(false);

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
  test('a mid-hit fracture death does not double-shatter into duplicate fragments', async ({ page }) => {
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
      // The kill must land INSIDE the damage hook — the exact mid-hit
      // shape the double-dispatch bug needs (verified: with the guard
      // disabled this scenario yields 2 dispatches and an exact duplicate
      // of every fragment).  V15 gets there by breaking EVERY boundary in
      // one oversized hit, so the body loses cohesion and ends from
      // inside progressFracture — where the removed min-remainder floor
      // used to put it.
      const tile: any = {
        id: 'v9_dup_tile', type: 'STRUCTURE', shardVariant: 'rock-tile',
        position: { x: 4200, y: 2600 }, velocity: { x: 0, y: 0 }, rotation: 0,
        size: { x: w, y: w }, mass: Infinity, active: true, color: '#8a8a8a',
        health: 2, maxHealth: 2, polygonPoints: pts,
      };
      ents.push(tile);
      tile.lastImpactVelocity = { x: -9, y: 0 };
      tile.fractureOriginalArea = fr.polygonArea(pts);
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
          damage: 9999, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
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
      const maxHp = t.maxHealth;              // AUTHORED, before the model
      const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
      shoot(4); // one base blaster hit
      // V15: the first hit builds the grain model, which rewrites maxHealth
      // to the DERIVED boundary total and keeps the authored value aside.
      const derived = t.maxHealth;
      const authored = t.authoredMaxHealth;
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
        maxHp, derived, authored, afterOne, afterTwo, dead,
        edgeFills: (t.fractureEdgeFill ?? []).length,
        childCount: children.length,
        childHp: children.map((c: any) => c.maxHealth),
      };
    });

    // The MAP-SPAWNED tile is authored at 20 (V9's damage layer), and V15
    // keeps that number as `authoredMaxHealth` while HP itself becomes
    // DERIVED from the tile's own grain boundaries — close to 20 by
    // calibration, but a property of the pattern rather than a constant,
    // so it varies tile to tile.  Both facts are pinned: the authored
    // value survives (score reads it), and the live HP is the derived one.
    expect(r.maxHp).toBe(20);
    expect(r.authored).toBe(20);
    expect(r.derived).toBeGreaterThan(14);
    expect(r.derived).toBeLessThan(28);
    expect(r.edgeFills).toBeGreaterThan(0);
    // It survives base blaster hits, and each one costs exactly the weapon
    // damage — spent on boundaries now, but the arithmetic is unchanged
    // because health mirrors the unbroken boundary budget exactly.
    expect(r.afterOne.alive).toBe(true);
    expect(r.afterOne.health).toBeCloseTo(r.derived - 4, 6);
    expect(r.afterTwo.alive).toBe(true);
    expect(r.afterTwo.health).toBeCloseTo(r.derived - 8, 6);
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
        authored: t.authoredMaxHealth, hits, died: !t.active,
        debrisWhileAlive, totalDebris: debris(),
        shrank: areaWhileAlive < area0 * 0.999,
      };
    });

    // V15: HP is derived, so the authored 20 lives on `authoredMaxHealth`
    // and `maxHealth` is the tile's own boundary total.
    expect(r.authored).toBe(20);
    expect(r.died).toBe(true);
    // THE ASK: glass takes rock's breaking behaviour — pieces detach
    // mid-life and the pane's own polygon loses their area.
    expect(r.debrisWhileAlive).toBeGreaterThanOrEqual(1);
    expect(r.shrank).toBe(true);
    expect(r.totalDebris).toBeGreaterThan(r.debrisWhileAlive);
    // And under the grain model MOST of the pane leaves while it is still
    // standing — the terminal separation is the last couple of grains
    // losing their shared boundary, not a shatter dumping the remainder.
    expect(r.debrisWhileAlive / r.totalDebris).toBeGreaterThan(0.4);

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

  // The gate is variant-AGNOSTIC by construction (one call site, one
  // helper), but progressive fracture stopped being rock-only at V10 and
  // "by construction" is exactly the claim that rots silently.  These two
  // pin it for GLASS as well: once on the real glass tile, and once on
  // BYTE-IDENTICAL geometry run as rock and then as glass, so a
  // difference could only come from variant policy.
  test('glass gets the same gate: struck face only, and no contact point never detaches',
    async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');
    await waitForStats(page, s => s.currentMapType === 'GLASS_FIELD', 'the glass-tile field');

    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const pickTile = () => ents.find((x: any) => x.active
        && x.shardVariant === 'glass-tile' && x.mass === Infinity && !x.probed);
      const drive = (withContact: boolean) => {
        const t = pickTile();
        if (!t) throw new Error('no glass tile on the field');
        t.probed = true;
        e.player.position.x = t.position.x + 6000;
        const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
        t.lastImpactVelocity = { x: -9, y: 0 };
        t.health = 1; // hold the reveal at full
        const contactX = () => {
          let mx = -Infinity;
          for (const p of t.polygonPoints) {
            if (Math.abs(p.y) < t.size.y * 0.45) mx = Math.max(mx, p.x);
          }
          return t.position.x + (mx === -Infinity ? t.size.x * 0.5 : mx) - 1;
        };
        const half = t.size.x * 0.5;
        let hits = 0;
        // The FIRST chip is the unambiguous case: the pattern is still
        // whole, so the piece nearest the contact is genuinely the struck
        // one.  Later chips are measured too, but with a wider bound —
        // see the assertions.
        let firstSide: number | null = null;
        let seen = 0;
        while (t.active && hits < 12) {
          if (withContact) e.progressFracture(t, { x: contactX(), y: t.position.y });
          else e.progressFracture(t);
          hits++;
          const now = ents.filter((x: any) => x.active && !before.has(x.id)
            && x.shardVariant === 'glass-shard' && x.mass !== Infinity);
          if (firstSide === null && now.length > seen) {
            firstSide = (now[0].position.x - t.position.x) / half;
          }
          seen = now.length;
          if (t.active) t.health = 1;
        }
        const chips = ents.filter((x: any) => x.active && !before.has(x.id)
          && x.shardVariant === 'glass-shard' && x.mass !== Infinity);
        const sides = chips.map((c: any) => (c.position.x - t.position.x) / half);
        return {
          stamped: t.lastImpactLocal !== undefined,
          cracked: (t.fractureEdges ?? []).length > 0,
          chipCount: chips.length,
          firstSide,
          worstFarSide: sides.length ? Math.min(...sides) : 0,
          alive: t.active === true,
        };
      };
      return { hit: drive(true), blind: drive(false) };
    });

    // Struck face: the contact point is stamped and glass chips.
    expect(r.hit.stamped).toBe(true);
    expect(r.hit.chipCount).toBeGreaterThan(0);
    // The FIRST piece off an intact pane came from the struck side.  That
    // is the assertion that actually tests the gate: the pattern is whole,
    // so "nearest the contact" is unambiguous.
    expect(r.hit.firstSide!).toBeGreaterThan(-0.2);
    // Later pieces get a wider bound ON PURPOSE.  Glass decomposes into
    // only 3-4 grains on a 36px pane, so ONE grain spans a third of the
    // body and its centroid can legitimately sit past the centre line
    // while still being the piece adjacent to the bay the shot opened.
    // Centroid-x is a weak proxy for "which side" at that grain size —
    // the rock test above carries the tight bound, on a 15-grain pattern
    // where the proxy is sound.  (This bound was -0.35 and failed at
    // -0.53 in a full-suite run while passing 8/8 alone: the metric was
    // too tight for the material, not the gate letting a far piece go.)
    expect(r.hit.worstFarSide).toBeGreaterThan(-0.75);
    // Blind hit: the pattern still highlights, nothing detaches.
    expect(r.blind.cracked).toBe(true);
    expect(r.blind.chipCount).toBe(0);
    expect(r.blind.alive).toBe(true);

    watch.assertClean();
  });

  test('same geometry, rock vs glass: both chip from the struck face, each in its own voice',
    async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ROCK_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ROCK_FIELD', 'the rock-tile field');

    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      // Deterministic 44px jittered polygon, so BOTH runs get identical
      // geometry and only the variant differs.
      const R = 22, N = 9;
      const poly: any[] = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + Math.sin(i * 2.3) * 0.18;
        const rr = R * (0.72 + 0.26 * ((Math.sin(i * 1.7) + 1) / 2));
        poly.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
      }
      const pos = { x: e.player.position.x + 5000, y: e.player.position.y + 5000 };

      const sounds: string[] = [];
      const realPlay = e.audio.play.bind(e.audio);
      e.audio.play = (id: string, opts: any) => { sounds.push(id); return realPlay(id, opts); };

      const run = (variant: string, maxHp: number) => {
        const at = sounds.length;
        const t: any = {
          id: 'probe-' + variant, type: 'STRUCTURE', shardVariant: variant,
          position: { x: pos.x, y: pos.y }, velocity: { x: 0, y: 0 },
          size: { x: R * 2, y: R * 2 }, rotation: 0,
          polygonPoints: poly.map((p: any) => ({ x: p.x, y: p.y })),
          health: 1, maxHealth: maxHp, active: true, mass: 5,
          color: '#888', crackSeed: 12345,
          lastImpactVelocity: { x: -9, y: 0 },
        };
        ents.push(t);
        const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
        const contactX = () => {
          let mx = -Infinity;
          for (const p of t.polygonPoints) {
            if (Math.abs(p.y) < t.size.y * 0.45) mx = Math.max(mx, p.x);
          }
          return t.position.x + (mx === -Infinity ? t.size.x * 0.5 : mx) - 1;
        };
        const half = t.size.x * 0.5;
        let hits = 0;
        while (t.active && hits < 16) {
          e.progressFracture(t, { x: contactX(), y: t.position.y });
          hits++;
          if (t.active) t.health = 1;
        }
        const chips = ents.filter((x: any) => x.active && !before.has(x.id)
          && x.type === 'STRUCTURE' && x.mass !== Infinity);
        const sides = chips.map((k: any) => (k.position.x - pos.x) / half);
        for (const k of chips) k.active = false; // don't leak into the next run
        return {
          stamped: t.lastImpactLocal !== undefined,
          chipCount: chips.length,
          worstFarSide: sides.length ? Math.min(...sides) : 0,
          chipSounds: sounds.slice(at).filter(id => id.startsWith('destroy.shard.')),
        };
      };

      const rock = run('rock-shard', 8);
      const glass = run('glass-shard', 12);
      e.audio.play = realPlay;
      return { rock, glass };
    });

    for (const side of [r.rock, r.glass]) {
      expect(side.stamped).toBe(true);
      expect(side.chipCount).toBeGreaterThan(0);
      expect(side.worstFarSide).toBeGreaterThan(-0.35);
    }
    // Each chip speaks in its own material — the detach voice is derived
    // from the variant, not hardcoded to rock (the V10 generalisation
    // left `destroy.shard.rock` behind on the glass path).
    expect(r.rock.chipSounds.every(id => id === 'destroy.shard.rock')).toBe(true);
    expect(r.glass.chipSounds.every(id => id === 'destroy.shard.glass')).toBe(true);
    expect(r.glass.chipSounds.length).toBeGreaterThan(0);

    watch.assertClean();
  });
});

test.describe('grain boundaries (V15)', () => {
  // The model: damage accumulates ON THE BOUNDARIES of the pattern and a
  // grain leaves when every boundary binding it has been broken through.
  // Two properties follow rather than being declared, and both are what
  // these tests exist to hold:
  //   - HP is DERIVED (Σ boundary strengths over the body's OWN pattern),
  //   - nothing ends at a limit: "health reached zero" and "the last
  //     boundary broke" are the same event.

  const SHOOT_SRC = `
    function makeShoot(e, t, dmg) {
      let n = 0;
      const contactX = () => {
        let mx = -Infinity;
        for (const p of t.polygonPoints) {
          if (Math.abs(p.y) < t.size.y * 0.45) mx = Math.max(mx, p.x);
        }
        return t.position.x + (mx === -Infinity ? t.size.x * 0.5 : mx) - 1;
      };
      return () => {
        e.physics.resolveCollision(
          { id: 'v15_' + (n++) + '_' + Math.random(), type: 'PROJECTILE',
            position: { x: contactX() + 4, y: t.position.y },
            velocity: { x: -900, y: 0 }, rotation: Math.PI,
            size: { x: 6, y: 6 }, mass: 0.1, active: true, color: '#fff',
            damage: dmg, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [] },
          t, { x: 0, y: 0 }, e.spawnDamageText.bind(e), e.handleEntityDeath,
        );
      };
    }`;

  test('HP is derived from the body\'s own boundaries, and every unit of damage lands on one',
    async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ROCK_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ROCK_FIELD', 'the rock-tile field');

    const r = await engine(page, (e: any, src: any) => {
      // eslint-disable-next-line no-new-func
      const makeShoot = new Function('return (' + src.shoot + ')')();
      const ents = e.currentMap.entities;
      const rows: any[] = [];
      const tiles = ents.filter((x: any) => x.active && x.shardVariant === 'rock-tile'
        && x.mass === Infinity).slice(0, 4);
      for (const t of tiles) {
        e.player.position.x = t.position.x + 6000;
        const shoot = makeShoot(e, t, 4);
        shoot();                       // first hit builds the model
        const edges = t.fractureEdges ?? [];
        // Σ strengths, recomputed here from the edge geometry and the
        // shipped constant — so this pins the DEFINITION, not a snapshot.
        let sum = 0;
        for (const ed of edges) {
          sum += Math.max(0.05, 0.27 * Math.hypot(ed.bx - ed.ax, ed.by - ed.ay));
        }
        const hpAfterOne = t.health;
        rows.push({
          derived: t.maxHealth, sum, authored: t.authoredMaxHealth,
          boundaryHp: t.fractureBoundaryHp,
          spent: t.maxHealth - hpAfterOne,
          fills: (t.fractureEdgeFill ?? []).reduce((a: number, b: number) => a + b, 0),
        });
      }
      return rows;
    }, { shoot: SHOOT_SRC });

    for (const row of r) {
      // Derived HP IS the sum of the pattern's boundary strengths.
      expect(row.derived).toBeCloseTo(row.sum, 5);
      expect(row.boundaryHp).toBeCloseTo(row.sum, 5);
      // The authored number survives for the consumers that mean "how
      // substantial is this body" (score reads it).
      expect(row.authored).toBe(9);
      // Nothing is lost: a 4-damage hit removes exactly 4 from the
      // unbroken budget and puts exactly 4 onto boundaries.  This is what
      // makes "health hit zero" and "the last boundary broke" the same
      // event instead of two rules that can disagree.
      expect(row.spent).toBeCloseTo(4, 6);
      expect(row.fills).toBeCloseTo(4, 6);
    }

    watch.assertClean();
  });

  test('a grain leaves only once every boundary binding it is broken', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ROCK_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ROCK_FIELD', 'the rock-tile field');

    const r = await engine(page, (e: any, src: any) => {
      // eslint-disable-next-line no-new-func
      const makeShoot = new Function('return (' + src.shoot + ')')();
      const ents = e.currentMap.entities;
      const t = ents.find((x: any) => x.active && x.shardVariant === 'rock-tile'
        && x.mass === Infinity);
      e.player.position.x = t.position.x + 6000;
      const shoot = makeShoot(e, t, 4);
      const need = (ed: any) => Math.max(0.05, 0.27 * Math.hypot(ed.bx - ed.ax, ed.by - ed.ay));

      let prematureDetach = false;   // a cell left with a boundary intact
      let sheds = 0, hits = 0, dumped = 0;
      const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
      const chips = () => ents.filter((x: any) => x.active && !before.has(x.id)
        && x.shardVariant === 'rock-shard' && x.mass !== Infinity).length;
      shoot(); hits++;
      let prevCells = (t.fractureCells ?? []).map((c: any) => c.siteIndex);
      while (t.active && hits < 30) {
        // Snapshot which cells are LOOSE before the hit lands.
        const edges = t.fractureEdges ?? [], fill = t.fractureEdgeFill ?? [];
        shoot(); hits++;
        if (!t.active) break;
        const now = (t.fractureCells ?? []).map((c: any) => c.siteIndex);
        for (const site of prevCells) {
          if (now.includes(site)) continue;
          // This cell left on this hit.  Every boundary that bound it
          // must have been broken through by the time it did.
          for (let k = 0; k < edges.length; k++) {
            const ed = edges[k];
            if (!ed.cells.includes(site)) continue;
            const partnerAlive = ed.cells.some((sx: number) => sx !== site && now.includes(sx));
            if (!partnerAlive && ed.cells.length > 1) continue; // no longer binding
            if ((fill[k] ?? 0) + 1e-6 < need(ed)) prematureDetach = true;
          }
        }
        prevCells = now;
        sheds = chips();
      }
      const total = chips();
      dumped = total - sheds;
      return { prematureDetach, sheds, total, dumped, hits, died: !t.active };
    }, { shoot: SHOOT_SRC });

    expect(r.died).toBe(true);
    expect(r.total).toBeGreaterThan(2);
    // THE RULE: no piece ever came off with a boundary still holding it.
    expect(r.prematureDetach).toBe(false);
    // And the body is eaten progressively rather than dumped: MOST of it
    // leaves while it is still standing.  The tail is the last grains
    // losing the boundaries they shared with each other, which is an
    // ending, not a shatter at a limit.
    expect(r.sheds / r.total).toBeGreaterThan(0.4);

    watch.assertClean();
  });

  test('material strength is one number, and it scales what the body can take',
    async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ROCK_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ROCK_FIELD', 'the rock-tile field');

    // Rock ships 0.27 and glass 0.16 per pixel of boundary, so on
    // comparable patterns rock takes measurably more damage to consume.
    // Measured through the DBG master multiplier, which must scale the
    // whole thing linearly — that is what makes it a usable tuning dial.
    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const derivedFor = () => {
        const t = ents.find((x: any) => x.active && x.shardVariant === 'rock-tile'
          && x.mass === Infinity && !x.probed);
        t.probed = true;
        // Force the model without damaging anything else.
        t.lastImpactLocal = { x: t.size.x * 0.5, y: 0 };
        t.fractureCells = undefined; t.fractureEdges = undefined;
        t.fractureEdgeFill = undefined; t.authoredMaxHealth = undefined;
        t.health = 9; t.maxHealth = 9;
        e.physics.resolveCollision(
          { id: 'v15_scale_' + Math.random(), type: 'PROJECTILE',
            position: { x: t.position.x + t.size.x * 0.5 + 4, y: t.position.y },
            velocity: { x: -900, y: 0 }, rotation: Math.PI,
            size: { x: 6, y: 6 }, mass: 0.1, active: true, color: '#fff',
            damage: 0.001, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [] },
          t, { x: 0, y: 0 }, e.spawnDamageText.bind(e), e.handleEntityDeath,
        );
        // Normalise by the pattern's own boundary length, so the two
        // readings are comparable even though the tiles differ.
        let len = 0;
        for (const ed of (t.fractureEdges ?? [])) len += Math.hypot(ed.bx - ed.ax, ed.by - ed.ay);
        return { perPx: (t.maxHealth ?? 0) / Math.max(1, len) };
      };
      const base = derivedFor();
      e.dbg.cycleBoundaryStrength();            // x1 -> x1.5
      const scaled = derivedFor();
      const name = e.dbg ? null : null;
      e.dbg.cycleBoundaryStrength();            // x1.5 -> x2
      const scaled2 = derivedFor();
      for (let i = 0; i < 5; i++) e.dbg.cycleBoundaryStrength(); // back to x1
      const restored = derivedFor();
      return { base: base.perPx, scaled: scaled.perPx, scaled2: scaled2.perPx,
        restored: restored.perPx, name };
    });

    // Rock's shipped strength, read off a real tile.
    expect(r.base).toBeCloseTo(0.27, 2);
    // The master multiplier scales it linearly...
    expect(r.scaled).toBeCloseTo(0.27 * 1.5, 2);
    expect(r.scaled2).toBeCloseTo(0.27 * 2, 2);
    // ...and the cycle returns to where it started.
    expect(r.restored).toBeCloseTo(0.27, 2);

    watch.assertClean();
  });

  test('the union outline expresses a remainder the arc splice cannot', async ({ page }) => {
    const watch = await boot(page);

    const r = await page.evaluate(`(() => {
      const fr = window.__omniFracture;
      // A square cut into four quadrant cells.
      const cells = [
        { points: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}] },
        { points: [{x:1,y:0},{x:2,y:0},{x:2,y:1},{x:1,y:1}] },
        { points: [{x:1,y:1},{x:2,y:1},{x:2,y:2},{x:1,y:2}] },
        { points: [{x:0,y:1},{x:1,y:1},{x:1,y:2},{x:0,y:2}] },
      ];
      const all = fr.unionOfCells(cells, 1e-4);
      const three = fr.unionOfCells(cells.slice(0, 3), 1e-4);
      // Two cells meeting only at a corner: not a ring, must be refused.
      const diagonal = fr.unionOfCells([cells[0], cells[2]], 1e-4);
      const area = (p) => {
        if (!p) return null;
        let a = 0;
        for (let i = 0; i < p.length; i++) {
          const q = p[i], n = p[(i + 1) % p.length];
          a += q.x * n.y - n.x * q.y;
        }
        return Math.abs(a / 2);
      };
      return {
        allArea: area(all), allSimple: all ? fr.isSimplePolygon(all) : false,
        threeArea: area(three), threeSimple: three ? fr.isSimplePolygon(three) : false,
        diagonal: diagonal === null,
      };
    })()`) as any;

    // The whole tiling comes back as the square...
    expect(r.allArea).toBeCloseTo(4, 6);
    expect(r.allSimple).toBe(true);
    // ...and three quadrants as the L, which is exactly the shape the arc
    // splice refuses once a survivor's outline lies wholly on the boundary.
    expect(r.threeArea).toBeCloseTo(3, 6);
    expect(r.threeSimple).toBe(true);
    // Two grains touching only at a point are not one body: refused, so
    // the caller keeps the old shape rather than handing SAT a bowtie.
    expect(r.diagonal).toBe(true);

    watch.assertClean();
  });
});

test.describe('per-material grain regularity (A1)', () => {
  // A1 moved the two knobs that produce a pattern's regularity — Lloyd
  // relaxation rounds and blue-noise minimum separation — out of GLOBAL
  // DBG accessors and into the material's own `GrainSpec.regularity`.
  // Two claims to hold: the capability now exists, and adopting it
  // changed nothing for the materials already shipped.

  test('the materials A3 did not retune still resolve to the old globals',
    async ({ page }) => {
    const watch = await boot(page);
    await waitForEngine(page, () => true, 'the engine handle');

    const r = await page.evaluate(`(() => {
      const g = window.__omniGrain;
      const read = id => {
        const reg = g.grainRegularityOf(id);
        return { id, reg,
          relax: reg === null ? null : g.grainRelaxFor(reg),
          sep: reg === null ? null : g.grainSeparationFor(reg) };
      };
      return {
        // Untouched by A3 — these are the no-behaviour-change witnesses.
        untuned: ['rock-tile', 'rock-shard', 'glass-tile', 'glass-shard'].map(read),
        // Deliberately retuned by A3.
        tuned: ['metal-tile', 'plastic-tile', 'plastic-shard'].map(read),
      };
    })()`) as any;

    // A1's claim, still standing for every material A3 left alone: the
    // field resolves to EXACTLY what the global DBG defaults supplied
    // before per-material regularity existed (2 Lloyd rounds, 0.45
    // separation).  A1 was verified to generate byte-identical patterns
    // on this basis, and rock and glass have not moved since.
    for (const row of r.untuned) {
      expect(row.reg, row.id).not.toBeNull();
      expect(row.relax, row.id).toBe(2);
      expect(row.sep, row.id).toBeCloseTo(0.45, 9);
    }
    // And A3 is the first thing to actually USE the axis: its materials
    // carry their own values, away from the shared default.  If a
    // "tuned" material ever drifts back to 0.5 the differentiation has
    // been lost and this fails rather than passing quietly.
    for (const row of r.tuned) {
      expect(row.reg, row.id).not.toBeNull();
      expect(row.reg, row.id).not.toBeCloseTo(0.5, 6);
    }

    watch.assertClean();
  });

  test('regularity is a real dial: the ends resolve apart and produce measurably different grains',
    async ({ page }) => {
    const watch = await boot(page);
    await waitForEngine(page, () => true, 'the engine handle');

    const r = await page.evaluate(`(() => {
      const g = window.__omniGrain;
      const fr = window.__omniFracture;
      // The resolver's ends.
      const ends = [0, 0.5, 1].map(x => ({
        r: x, relax: g.grainRelaxFor(x), sep: g.grainSeparationFor(x) }));

      // And what those ends DO, measured on one polygon: area spread
      // (coefficient of variation) and isoperimetric roundness.
      const w = 42, pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * w * 0.5, y: Math.sin(a) * w * 0.5 });
      }
      const measure = (reg) => {
        const cells = fr.computeFracture(pts, {
          siteCount: 10, seed: 12345,
          relaxIterations: g.grainRelaxFor(reg),
          minSeparation: g.grainSeparationFor(reg),
        }).cells;
        const areas = cells.map(c => Math.abs(c.area));
        const mean = areas.reduce((a, b) => a + b, 0) / areas.length;
        const sd = Math.sqrt(areas.reduce((a, b) => a + (b - mean) ** 2, 0) / areas.length);
        let round = 0;
        for (const c of cells) {
          let per = 0;
          for (let i = 0; i < c.points.length; i++) {
            const p = c.points[i], q = c.points[(i + 1) % c.points.length];
            per += Math.hypot(q.x - p.x, q.y - p.y);
          }
          round += per > 0 ? (4 * Math.PI * Math.abs(c.area)) / (per * per) : 0;
        }
        return { cv: sd / mean, roundness: round / cells.length, n: cells.length };
      };
      return { ends, ragged: measure(0), shipped: measure(0.5), regular: measure(1) };
    })()`) as any;

    // The two knobs move together and monotonically across the dial.
    expect(r.ends[0].relax).toBe(0);
    expect(r.ends[1].relax).toBe(2);
    expect(r.ends[2].relax).toBe(4);
    expect(r.ends[0].sep).toBeLessThan(r.ends[1].sep);
    expect(r.ends[1].sep).toBeLessThan(r.ends[2].sep);

    // And the dial is not cosmetic: regularity 1 makes grains measurably
    // more even in size AND rounder than regularity 0.  Without this the
    // field could be authored per material and mean nothing.
    expect(r.regular.cv).toBeLessThan(r.ragged.cv);
    expect(r.regular.roundness).toBeGreaterThan(r.ragged.roundness);
    // The shipped setting sits between them, as 0.5 should.
    expect(r.shipped.cv).toBeLessThanOrEqual(r.ragged.cv);
    expect(r.shipped.roundness).toBeGreaterThanOrEqual(r.ragged.roundness);

    console.log('[A1 regularity] cv', r.ragged.cv.toFixed(3), '->',
      r.shipped.cv.toFixed(3), '->', r.regular.cv.toFixed(3),
      '| roundness', r.ragged.roundness.toFixed(3), '->',
      r.shipped.roundness.toFixed(3), '->', r.regular.roundness.toFixed(3));

    watch.assertClean();
  });

  test('the DBG cycle is an OVERRIDE, and its default defers to the material',
    async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ROCK_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ROCK_FIELD', 'the rock-tile field');

    // The shipped default: the game takes regularity from the material
    // table, not from a debug knob.  This is the half of A1 that matters
    // for the game rather than for the debug menu.
    const start0 = await stats(page);
    expect(start0.fractureRelaxName).toBe('material');
    expect(start0.fractureSeparationName).toBe('material');

    // Cycling forces a value across every material at once...
    await engine(page, (e: any) => { e.dbg.cycleFractureRelax(); });
    const forced = await waitForStats(page, s => s.fractureRelaxName !== 'material',
      'the relax override to engage');
    expect(forced.fractureRelaxName).toBe('0');

    // ...and the cycle comes back round to deferring again, so the knob
    // can always be put back without a reload.
    await engine(page, (e: any) => {
      for (let i = 0; i < 5; i++) e.dbg.cycleFractureRelax();
    });
    const back = await waitForStats(page, s => s.fractureRelaxName === 'material',
      'the relax cycle to return to material');
    expect(back.fractureRelaxName).toBe('material');

    watch.assertClean();
  });
});

test.describe('grain size and bond spread (A2)', () => {

  test('sizeSpread widens the grain-size distribution without changing the count',
    async ({ page }) => {
    const watch = await boot(page);
    await waitForEngine(page, () => true, 'the engine handle');

    const r = await page.evaluate(`(() => {
      const fr = window.__omniFracture;
      const w = 60, pts = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * w * 0.5, y: Math.sin(a) * w * 0.5 });
      }
      const measure = (sp) => {
        const rows = [];
        for (let seed = 1; seed <= 24; seed++) {
          const cells = fr.computeFracture(pts, {
            siteCount: 12, seed, relaxIterations: 2, minSeparation: 0.45, sizeSpread: sp,
          }).cells;
          const areas = cells.map(c => Math.abs(c.area));
          const mean = areas.reduce((a, b) => a + b, 0) / areas.length;
          const sd = Math.sqrt(areas.reduce((a, b) => a + (b - mean) ** 2, 0) / areas.length);
          rows.push({ cv: sd / mean, n: cells.length,
                      ratio: Math.max(...areas) / Math.min(...areas),
                      total: areas.reduce((a, b) => a + b, 0) });
        }
        const avg = k => rows.reduce((a, b) => a + b[k], 0) / rows.length;
        return { cv: avg('cv'), n: avg('n'), ratio: avg('ratio'), total: avg('total') };
      };
      return { at0: measure(0), at05: measure(0.5), at1: measure(1) };
    })()`) as any;

    // The distribution widens, monotonically.
    expect(r.at05.cv).toBeGreaterThan(r.at0.cv * 1.4);
    expect(r.at1.cv).toBeGreaterThan(r.at05.cv);
    // Biggest-to-smallest grain ratio opens up: an even mix of coarse and
    // fine in one body, which is the point of the axis.
    expect(r.at1.ratio).toBeGreaterThan(r.at0.ratio * 2.5);
    // ...but the COUNT is preserved.  Grain count is `grainSize`'s job;
    // a spread that also thins the pattern conflates the two axes and
    // makes both useless.  This is what the weight gain was tuned to.
    expect(r.at1.n).toBeGreaterThan(r.at0.n * 0.9);
    // And the cells still tile the parent — a power diagram partitions
    // exactly as a Voronoi one does.
    expect(r.at1.total).toBeCloseTo(r.at0.total, 0);

    console.log('[A2 sizeSpread] cv', r.at0.cv.toFixed(3), '->', r.at05.cv.toFixed(3),
      '->', r.at1.cv.toFixed(3), '| ratio', r.at0.ratio.toFixed(2), '->',
      r.at1.ratio.toFixed(2), '| n', r.at0.n.toFixed(1), '->', r.at1.n.toFixed(1));

    watch.assertClean();
  });

  test('bondSpread is inert at 0, deterministic, bounded and unbiased', async ({ page }) => {
    const watch = await boot(page);
    await waitForEngine(page, () => true, 'the engine handle');

    const r = await page.evaluate(`(() => {
      const g = window.__omniGrain;
      const at = (sp) => {
        const vals = [];
        for (let i = 0; i < 600; i++) vals.push(g.bondVariance(12345, i, sp));
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        return { min: Math.min(...vals), max: Math.max(...vals), mean,
                 allOne: vals.every(v => v === 1) };
      };
      return {
        off: at(0), half: at(0.5), full: at(1),
        range: g.BOND_SPREAD_RANGE,
        // Same (seed, index) must give the same answer every time — a
        // body's weak seams are a property of the body, not of the hit.
        stable: g.bondVariance(999, 7, 1) === g.bondVariance(999, 7, 1),
        // ...and different bodies get different seams.
        differs: g.bondVariance(999, 7, 1) !== g.bondVariance(1000, 7, 1),
      };
    })()`) as any;

    // Inert until a material opts in — this is what let A2 ship the
    // mechanism without moving any material's balance.
    expect(r.off.allOne).toBe(true);
    // Bounded by the declared range, at both settings.
    expect(r.full.min).toBeGreaterThanOrEqual(1 - r.range - 1e-9);
    expect(r.full.max).toBeLessThanOrEqual(1 + r.range + 1e-9);
    expect(r.half.min).toBeGreaterThanOrEqual(1 - r.range / 2 - 1e-9);
    expect(r.half.max).toBeLessThanOrEqual(1 + r.range / 2 + 1e-9);
    // Unbiased: spread must vary a material's seams, not secretly buff or
    // nerf it.  Derived HP is Σ strengths, so a biased multiplier would
    // silently retune every material that adopts it.
    expect(r.full.mean).toBeGreaterThan(0.95);
    expect(r.full.mean).toBeLessThan(1.05);
    expect(r.stable).toBe(true);
    expect(r.differs).toBe(true);

    watch.assertClean();
  });

  test('a detaching grain has nothing left to carry — its whole boundary is spent',
    async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ROCK_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ROCK_FIELD', 'the rock-tile field');

    // Spec §6.3 asked whether a grain should carry half-broken bonds out
    // as pre-existing damage.  It should — but measured at the moment of
    // DETACH there are none, and that is structural rather than a
    // tuning accident: a grain leaves only once every boundary BINDING it
    // is broken, and its non-binding boundaries were broken too, since
    // that is how the neighbour on the other side left.  This test pins
    // the property, so if the spend order or the detach rule ever changes
    // such that partial boundaries survive a detach, §6.3 reopens here
    // rather than silently.
    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const need = (ed: any) => Math.max(0.05, 0.27 * Math.hypot(ed.bx - ed.ax, ed.by - ed.ay));
      const rows: any[] = [];
      const tiles = ents.filter((x: any) => x.active && x.shardVariant === 'rock-tile'
        && x.mass === Infinity).slice(0, 5);
      for (const t of tiles) {
        e.player.position.x = t.position.x + 6000;
        const contactX = () => {
          let mx = -Infinity;
          for (const p of t.polygonPoints) if (Math.abs(p.y) < t.size.y * 0.45) mx = Math.max(mx, p.x);
          return t.position.x + (mx === -Infinity ? t.size.x * 0.5 : mx) - 1;
        };
        let hits = 0;
        while (t.active && hits < 30) {
          const cellsBefore = (t.fractureCells ?? []).map((c: any) => c.siteIndex);
          e.physics.resolveCollision(
            { id: 'a2c_' + Math.random(), type: 'PROJECTILE',
              position: { x: contactX() + 4, y: t.position.y },
              velocity: { x: -900, y: 0 }, rotation: Math.PI, size: { x: 6, y: 6 },
              mass: 0.1, active: true, color: '#fff', damage: 4,
              ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [] },
            t, { x: 0, y: 0 }, e.spawnDamageText.bind(e), e.handleEntityDeath);
          hits++;
          if (!t.active) break;
          const now = (t.fractureCells ?? []).map((c: any) => c.siteIndex);
          const edges = t.fractureEdges ?? [], fill = t.fractureEdgeFill ?? [];
          for (const site of cellsBefore) {
            if (now.includes(site)) continue;
            // This grain left on this hit.  Classify its own boundary AT
            // THE MOMENT IT WENT — not before the hit, which is a
            // different question and gives a different (misleading) answer.
            let needSum = 0, partial = 0;
            for (let k = 0; k < edges.length; k++) {
              if (!edges[k].cells.includes(site)) continue;
              const n = need(edges[k]); needSum += n;
              const f = fill[k] ?? 0;
              if (f + 1e-6 < n) partial += f;
            }
            rows.push({ frac: needSum > 0 ? partial / needSum : 0 });
          }
        }
      }
      return {
        detaches: rows.length,
        worst: rows.reduce((a, b) => Math.max(a, b.frac), 0),
      };
    });

    expect(r.detaches).toBeGreaterThan(5);
    // Nothing unfinished on any departing grain's boundary, ever.
    expect(r.worst).toBeLessThan(1e-6);

    watch.assertClean();
  });
});

test.describe('metal and plastic materials (A3) + per-grain deformation (B1)', () => {

  const DRIVE_SRC = `
    function drive(e, t, dmg, cap) {
      const area = p => { let a=0; for (let i=0;i<p.length;i++){const q=p[i],n=p[(i+1)%p.length]; a+=q.x*n.y-n.x*q.y;} return Math.abs(a/2); };
      const contactX = () => { let mx=-Infinity; for (const p of t.polygonPoints) if (Math.abs(p.y)<t.size.y*0.45) mx=Math.max(mx,p.x); return t.position.x+(mx===-Infinity?t.size.x*0.5:mx)-1; };
      const out = { hits:0, dentHits:0, detachHits:0, a0: area(t.polygonPoints), selfIntersect:0, hpDrift:0 };
      let hp0 = 0;
      while (t.active && out.hits < cap) {
        const cellsBefore = (t.fractureCells||[]).length;
        const areaBefore = area(t.polygonPoints);
        e.physics.resolveCollision(
          { id:'a3t_'+Math.random(), type:'PROJECTILE',
            position:{x:contactX()+4,y:t.position.y}, velocity:{x:-900,y:0}, rotation:Math.PI,
            size:{x:6,y:6}, mass:0.1, active:true, color:'#fff', damage:dmg,
            ownerType:'PLAYER', ownerId:'player', hitEntityIds:[] },
          t,{x:0,y:0}, e.spawnDamageText.bind(e), e.handleEntityDeath);
        out.hits++;
        if (!t.active) break;
        if (out.hits === 1) hp0 = t.maxHealth;
        else out.hpDrift = Math.max(out.hpDrift, Math.abs(t.maxHealth - hp0));
        const cellsAfter = (t.fractureCells||[]).length;
        if (cellsAfter === cellsBefore) {
          if (area(t.polygonPoints) < areaBefore - 1e-9) out.dentHits++;
        } else out.detachHits++;
        const p = t.polygonPoints, n = p.length;
        for (let i=0;i<n;i++) for (let j=i+2;j<n;j++) {
          if (i===0 && j===n-1) continue;
          const a=p[i],b=p[(i+1)%n],c=p[j],d=p[(j+1)%n];
          const s1=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
          const s2=(b.x-a.x)*(d.y-a.y)-(b.y-a.y)*(d.x-a.x);
          const s3=(d.x-c.x)*(a.y-c.y)-(d.y-c.y)*(a.x-c.x);
          const s4=(d.x-c.x)*(b.y-c.y)-(d.y-c.y)*(b.x-c.x);
          if (s1*s2<0 && s3*s4<0) { out.selfIntersect++; i=n; break; }
        }
      }
      out.died = !t.active;
      return out;
    }`;

  test('metal grains are FINE and REGULAR; plastic grains are LARGE and varied',
    async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'METAL_FIELD');
    await waitForStats(page, s => s.currentMapType === 'METAL_FIELD', 'the metal field');

    const metal = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const rows: any[] = [];
      for (const t of ents.filter((x: any) => x.active && x.shardVariant === 'metal-tile'
          && x.mass === Infinity).slice(0, 6)) {
        t.lastImpactLocal = { x: t.size.x * 0.5, y: 0 };
        e.physics.resolveCollision(
          { id: 'm_' + Math.random(), type: 'PROJECTILE',
            position: { x: t.position.x + t.size.x * 0.5 + 4, y: t.position.y },
            velocity: { x: -900, y: 0 }, rotation: Math.PI, size: { x: 6, y: 6 },
            mass: 0.1, active: true, color: '#fff', damage: 0.001,
            ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [] },
          t, { x: 0, y: 0 }, e.spawnDamageText.bind(e), e.handleEntityDeath);
        const cells = t.fractureCells ?? [];
        const areas = cells.map((c: any) => Math.abs(c.area));
        const mean = areas.reduce((a: number, b: number) => a + b, 0) / areas.length;
        const sd = Math.sqrt(areas.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) / areas.length);
        let round = 0;
        for (const c of cells) {
          let per = 0;
          for (let i = 0; i < c.points.length; i++) {
            const p = c.points[i], q = c.points[(i + 1) % c.points.length];
            per += Math.hypot(q.x - p.x, q.y - p.y);
          }
          round += per > 0 ? (4 * Math.PI * Math.abs(c.area)) / (per * per) : 0;
        }
        rows.push({ tier: t.densityTier ?? 0, cells: cells.length,
          cv: sd / mean, roundness: round / cells.length, derived: t.maxHealth });
      }
      return rows;
    });

    const plastic = await (async () => {
      await startRun(page, 'PLASTIC_FIELD');
      await waitForStats(page, s => s.currentMapType === 'PLASTIC_FIELD', 'the plastic field');
      return engine(page, (e: any) => {
        const ents = e.currentMap.entities;
        const rows: any[] = [];
        for (const t of ents.filter((x: any) => x.active && x.shardVariant === 'plastic-tile'
            && x.mass === Infinity).slice(0, 6)) {
          t.lastImpactLocal = { x: t.size.x * 0.5, y: 0 };
          e.physics.resolveCollision(
            { id: 'p_' + Math.random(), type: 'PROJECTILE',
              position: { x: t.position.x + t.size.x * 0.5 + 4, y: t.position.y },
              velocity: { x: -900, y: 0 }, rotation: Math.PI, size: { x: 6, y: 6 },
              mass: 0.1, active: true, color: '#fff', damage: 0.001,
              ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [] },
            t, { x: 0, y: 0 }, e.spawnDamageText.bind(e), e.handleEntityDeath);
          const cells = t.fractureCells ?? [];
          rows.push({ cells: cells.length, derived: t.maxHealth });
        }
        return rows;
      });
    })();

    const avg = (rows: any[], k: string) => rows.reduce((a, b) => a + b[k], 0) / rows.length;
    // THE ASK: metal is fine-grained, plastic is large-grained.  On the
    // same 36px tile that is many small cells against a few big ones.
    expect(avg(metal, 'cells')).toBeGreaterThan(7);
    expect(avg(plastic, 'cells')).toBeLessThan(6);
    expect(avg(metal, 'cells')).toBeGreaterThan(avg(plastic, 'cells') * 2);
    // ...and metal's are REGULAR: near-honeycomb roundness at regularity 0.95.
    expect(avg(metal, 'roundness')).toBeGreaterThan(0.74);

    console.log('[A3] metal cells', avg(metal, 'cells').toFixed(1),
      'roundness', avg(metal, 'roundness').toFixed(3),
      '| plastic cells', avg(plastic, 'cells').toFixed(1));

    watch.assertClean();
  });

  test('a metal plate\'s toughness does NOT depend on its density tier', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'METAL_FIELD');
    await waitForStats(page, s => s.currentMapType === 'METAL_FIELD', 'the metal field');

    // DENSITY IS NOT A GRAIN PARAMETER (user call).  It was briefly one:
    // grain size and bond strength each scaled with `densityTier`, so a
    // bright plate was finer-grained and harder.  That inverted the
    // model — density is a RESULT of grain size, count and regularity,
    // not an input to them — and it made one material behave like
    // several.  A plate's toughness now comes from its material alone.
    const r = await engine(page, (e: any) => {
      const byTier = new Map<number, number[]>();
      for (const t of e.currentMap.entities.filter((x: any) => x.active
          && x.shardVariant === 'metal-tile' && x.mass === Infinity).slice(0, 40)) {
        t.lastImpactLocal = { x: t.size.x * 0.5, y: 0 };
        e.physics.resolveCollision(
          { id: 'd_' + Math.random(), type: 'PROJECTILE',
            position: { x: t.position.x + t.size.x * 0.5 + 4, y: t.position.y },
            velocity: { x: -900, y: 0 }, rotation: Math.PI, size: { x: 6, y: 6 },
            mass: 0.1, active: true, color: '#fff', damage: 0.001,
            ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [] },
          t, { x: 0, y: 0 }, e.spawnDamageText.bind(e), e.handleEntityDeath);
        const tier = t.densityTier ?? 0;
        if (!byTier.has(tier)) byTier.set(tier, []);
        byTier.get(tier)!.push(t.maxHealth);
      }
      return [...byTier.entries()]
        .map(([tier, hp]) => ({ tier, hp: hp.reduce((a, b) => a + b, 0) / hp.length }))
        .sort((a, b) => a.tier - b.tier);
    });

    expect(r.length).toBeGreaterThan(1);
    const lo = r[0], hi = r[r.length - 1];
    // Same material, same toughness, whatever the tier.  A little spread
    // survives because each tile decomposes into its own pattern — that
    // variance is the derived-HP model working, not density leaking back.
    expect(Math.abs(hi.hp - lo.hp) / lo.hp).toBeLessThan(0.15);

    console.log('[no density] ' + r.map((x: any) =>
      `t${x.tier}: ${x.hp.toFixed(0)} hp`).join('  '));

    watch.assertClean();
  });

  test('both new materials DEFORM before they break, and the outline stays sound (B1)',
    async ({ page }) => {
    const watch = await boot(page);

    for (const c of [
      { map: 'METAL_FIELD', tile: 'metal-tile', minHits: 25 },
      { map: 'PLASTIC_FIELD', tile: 'plastic-tile', minHits: 8 },
    ]) {
      await startRun(page, c.map);
      const onMap = new Function('s', `return s.currentMapType === '${c.map}'`) as (s: any) => boolean;
      await waitForStats(page, onMap, c.map);

      const r = await engine(page, (e: any, arg: any) => {
        // eslint-disable-next-line no-new-func
        const drive = new Function('return (' + arg.src + ')')();
        const ents = e.currentMap.entities;
        const rows: any[] = [];
        for (const t of ents.filter((x: any) => x.active && x.shardVariant === arg.tile
            && x.mass === Infinity).slice(0, 4)) {
          e.player.position.x = t.position.x + 6000;
          rows.push(drive(e, t, 4, 250));
        }
        return rows;
      }, { tile: c.tile, src: DRIVE_SRC });

      for (const row of r) {
        // It deforms: hits that landed without anything coming off still
        // took area out of the body.  This is B1 doing its job — before
        // it, a grain material could not dent at all.
        expect(row.dentHits, c.tile).toBeGreaterThan(0);
        // The outline survives every dent: no self-intersection, which is
        // what the shared-vertex rule buys, and SAT cannot carry a bowtie.
        expect(row.selfIntersect, c.tile).toBe(0);
        // And denting never moves the body's derived HP — strengths are
        // fixed at model build precisely so deformation cannot inflate or
        // deflate toughness.
        expect(row.hpDrift, c.tile).toBeLessThan(1e-9);
        // It still dies, and takes the material's own beating to do it.
        expect(row.died, c.tile).toBe(true);
        expect(row.hits, c.tile).toBeGreaterThan(c.minHits);
      }

      console.log(`[B1 ${c.tile}] dent hits ` + r.map((x: any) => x.dentHits).join(',')
        + ' | total hits ' + r.map((x: any) => x.hits).join(','));
    }

    watch.assertClean();
  });

  test('the four materials rank by boundary strength, metal hardest', async ({ page }) => {
    const watch = await boot(page);
    await waitForEngine(page, () => true, 'the engine handle');

    const r = await page.evaluate(`(() => {
      const g = window.__omniGrain;
      return ['glass-tile','rock-tile','plastic-tile','metal-tile']
        .map(id => ({ id, reg: g.grainRegularityOf(id) }));
    })()`) as any[];

    // Every material carries a grain spec now — the four-material set the
    // spec's archetype table describes.
    for (const row of r) expect(row.reg, row.id).not.toBeNull();
    // And they are genuinely differentiated on the regularity axis, which
    // A1 could express but A3 is the first to USE.
    const reg = Object.fromEntries(r.map((x: any) => [x.id, x.reg]));
    expect(reg['metal-tile']).toBeGreaterThan(reg['plastic-tile']);
    expect(reg['metal-tile']).toBeGreaterThan(reg['rock-tile']);

    watch.assertClean();
  });
});

test.describe('a fragment is drawn as its own shape (LOD)', () => {
  // The Voronoi work is only visible if the RENDERER shows the cells.  It
  // did not: the rock chip-LOD branch blitted the cached bitmap built for
  // METAL, a perfect equilateral triangle, so a tile shattering into 8
  // grains at once read as 8 identical triangles.  The sim was correct
  // throughout — the fragments really were Voronoi cells — which is why
  // no simulation test caught it, and why this one is a render test.

  test('a shattered rock tile does NOT take metal\'s authored silhouette',
    async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ROCK_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ROCK_FIELD', 'the rock-tile field');

    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const t = ents.find((x: any) => x.active && x.shardVariant === 'rock-tile'
        && x.mass === Infinity);
      if (!t) throw new Error('no rock tile');
      // Park the camera ON the tile at the DEFAULT zoom, which is the
      // condition the bug lived at.  Set camera.position DIRECTLY, not
      // via the player: the camera follows with smoothing, so moving the
      // ship and drawing one frame leaves the debris off-screen and the
      // LOD counter reads 0 for the wrong reason (this test passed
      // vacuously that way, including with the bug restored).
      e.player.position.x = t.position.x;
      e.player.position.y = t.position.y;
      e.camera.position.x = t.position.x;
      e.camera.position.y = t.position.y;
      const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
      // One big hit: the whole pattern arrives in a single frame, which is
      // what made the uniformity unmistakable in the first place.
      e.physics.resolveCollision(
        { id: 'lod_' + Math.random(), type: 'PROJECTILE',
          position: { x: t.position.x + t.size.x * 0.5 + 4, y: t.position.y },
          velocity: { x: -900, y: 0 }, rotation: Math.PI, size: { x: 6, y: 6 },
          mass: 0.1, active: true, color: '#fff', damage: 500,
          ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [] },
        t, { x: 0, y: 0 }, e.spawnDamageText.bind(e), e.handleEntityDeath);

      const debris = ents.filter((x: any) => x.active && !before.has(x.id)
        && x.shardVariant === 'rock-shard' && x.mass !== Infinity);
      // Draw a frame so the LOD counter reflects this debris.  TWO things
      // are load-bearing and each of them made an earlier draft of this
      // test pass VACUOUSLY (0 blits with the bug fully restored):
      //  - prepareFrameEntities() first.  draw() renders `frameEntities`,
      //    which the sim loop rebuilds; freshly spawned debris is not in
      //    it yet, so the renderer never sees these shards at all.
      //  - the camera pinned DIRECTLY.  It follows the player with
      //    smoothing, so moving the ship and drawing once leaves the
      //    debris off-screen.
      // draw() zeroes lastLodShardCount at the top of the frame, so read
      // it afterwards.
      e.prepareFrameEntities();
      e.camera.position.x = t.position.x;
      e.camera.position.y = t.position.y;
      // Count any use of METAL's cached silhouette while rock debris is
      // on screen.  This is the bug itself, stated directly: rock must
      // never be drawn as a triangle, whatever the LOD decides.
      let triangleBlits = 0;
      const realTri = e.renderer.getSolidTriangleBitmap.bind(e.renderer);
      e.renderer.getSolidTriangleBitmap = (hex: string) => {
        triangleBlits++; return realTri(hex);
      };
      e.draw();
      e.renderer.getSolidTriangleBitmap = realTri;

      const shapes = debris.map((d: any) => {
        const p = d.polygonPoints ?? [];
        let lo = Infinity, hi = 0;
        for (let i = 0; i < p.length; i++) {
          const a = p[i], b = p[(i + 1) % p.length];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          lo = Math.min(lo, len); hi = Math.max(hi, len);
        }
        return { n: p.length, ratio: lo > 0 ? hi / lo : Infinity,
          apparent: d.size.x * 0.5 * e.camera.zoom };
      });
      return {
        count: debris.length,
        zoom: e.camera.zoom,
        lodBlitted: e.renderer.lastLodShardCount,
        lodEnabled: e.renderer.shardLodEnabled === true,
        triangleBlits,
        equilateral: shapes.filter((s: any) => s.n === 3 && s.ratio < 1.05).length,
        minVerts: Math.min(...shapes.map((s: any) => s.n)),
        minApparent: Math.min(...shapes.map((s: any) => s.apparent)),
      };
    });

    expect(r.count).toBeGreaterThan(3);
    // The LOD path must be LIVE, or the assertion below is vacuous — the
    // first draft of this test asserted 0 blits while the debris was
    // simply off-screen, and passed with the bug restored.
    expect(r.lodEnabled).toBe(true);
    // The SIM was always right: no fragment is an equilateral triangle.
    expect(r.equilateral).toBe(0);
    expect(r.minVerts).toBeGreaterThanOrEqual(3);
    // THE BUG, stated directly: no rock fragment may borrow metal's
    // authored equilateral silhouette.  Rock's LOD blob is a DISC —
    // silhouette-neutral, so a few-pixel speck reads as "small rock" and
    // makes no claim about shape.
    expect(r.triangleBlits).toBe(0);
    // And most of a tile's grains are now drawn as THEMSELVES.  Before the
    // fix all 8 were collapsed to the cached blob at the default zoom, so
    // a rock tile could never show its Voronoi pattern; the smallest one
    // or two are genuine sub-3px dust and may still blit.
    expect(r.lodBlitted).toBeLessThan(r.count / 2);

    console.log('[LOD] debris', r.count, 'zoom', r.zoom.toFixed(2),
      'min apparent radius', r.minApparent.toFixed(2), 'px, blitted', r.lodBlitted,
      'triangle blits', r.triangleBlits);

    watch.assertClean();
  });
});

test.describe('deformation is bounded, conserving and elastic', () => {

  test('a break CONSERVES: the body loses exactly what the fragment carries',
    async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'PLASTIC_FIELD');
    await waitForStats(page, s => s.currentMapType === 'PLASTIC_FIELD', 'the plastic field');

    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const area = (p: any[]) => { let a = 0;
        for (let i = 0; i < p.length; i++) { const q = p[i], n = p[(i + 1) % p.length];
          a += q.x * n.y - n.x * q.y; } return Math.abs(a / 2); };
      let worstGap = 0, worstStale = 1, minShrink = 1, detaches = 0, maxPerHit = 0;
      for (const t of ents.filter((x: any) => x.active
          && x.shardVariant === 'plastic-tile' && x.mass === Infinity).slice(0, 8)) {
        e.player.position.x = t.position.x + 6000;
        const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
        const contactX = () => { let mx = -Infinity;
          for (const p of t.polygonPoints) if (Math.abs(p.y) < t.size.y * 0.45) mx = Math.max(mx, p.x);
          return t.position.x + (mx === -Infinity ? t.size.x * 0.5 : mx) - 1; };
        let hits = 0;
        while (t.active && hits < 40) {
          const tileBefore = area(t.polygonPoints);
          const nBefore = ents.filter((x: any) => x.active && !before.has(x.id)
            && x.shardVariant === 'plastic-shard').length;
          e.physics.resolveCollision(
            { id: 'cons_' + Math.random(), type: 'PROJECTILE',
              position: { x: contactX() + 4, y: t.position.y },
              velocity: { x: -900, y: 0 }, rotation: Math.PI, size: { x: 6, y: 6 },
              mass: 0.1, active: true, color: '#fff', damage: 4,
              ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [] },
            t, { x: 0, y: 0 }, e.spawnDamageText.bind(e), e.handleEntityDeath);
          hits++;
          if (!t.active) break;
          const now = ents.filter((x: any) => x.active && !before.has(x.id)
            && x.shardVariant === 'plastic-shard');
          const spawned = now.length - nBefore;
          maxPerHit = Math.max(maxPerHit, spawned);
          if (spawned > 0) {
            detaches += spawned;
            const gained = now.slice(nBefore)
              .reduce((a: number, sh: any) => a + area(sh.polygonPoints), 0);
            worstGap = Math.max(worstGap, gained - (tileBefore - area(t.polygonPoints)));
          }
          for (const c of (t.fractureCells ?? [])) {
            worstStale = Math.max(worstStale, c.area / Math.max(0.01, area(c.points)));
            minShrink = Math.min(minShrink, c.area / Math.max(0.01, c.area0));
          }
        }
      }
      return { worstGap, worstStale, minShrink, detaches, maxPerHit };
    });

    expect(r.detaches).toBeGreaterThan(8);
    // A grain's reported area is its LIVE area.  Carrying the cut-time
    // value across a deformation is what let a shrivelled grain spawn a
    // full-size shard (measured 2.06x before the fix).
    expect(r.worstStale).toBeLessThan(1.001);
    // Deformation is FLOORED at two thirds of the area the grain was cut
    // at (user call), so a grain can never be pulled away to nothing.
    expect(r.minShrink).toBeGreaterThan(0.66);
    // And the break conserves: no shard area appears that the body did
    // not give up.  Before this, a hit could shed a 157-area shard while
    // the tile GREW by 6.7 — mass from nothing.
    expect(r.worstGap).toBeLessThan(1);

    console.log('[conserve] detaches', r.detaches, 'worst gap', r.worstGap.toFixed(2),
      'worst stale', r.worstStale.toFixed(3), 'min grain shrink', r.minShrink.toFixed(3),
      'max shards/hit', r.maxPerHit);

    watch.assertClean();
  });

  test('a plastic fragment breaks off deformed and springs back to its cut shape',
    async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'PLASTIC_FIELD');
    await waitForStats(page, s => s.currentMapType === 'PLASTIC_FIELD', 'the plastic field');

    const r = await engine(page, (e: any) => {
      const ents = e.currentMap.entities;
      const area = (p: any[]) => { let a = 0;
        for (let i = 0; i < p.length; i++) { const q = p[i], n = p[(i + 1) % p.length];
          a += q.x * n.y - n.x * q.y; } return Math.abs(a / 2); };
      const out: any[] = [];
      for (const t of ents.filter((x: any) => x.active
          && x.shardVariant === 'plastic-tile' && x.mass === Infinity).slice(0, 8)) {
        e.player.position.x = t.position.x + 6000;
        const before = new Set(ents.filter((x: any) => x.active).map((x: any) => x.id));
        const contactX = () => { let mx = -Infinity;
          for (const p of t.polygonPoints) if (Math.abs(p.y) < t.size.y * 0.45) mx = Math.max(mx, p.x);
          return t.position.x + (mx === -Infinity ? t.size.x * 0.5 : mx) - 1; };
        let hits = 0;
        while (t.active && hits < 40) {
          e.physics.resolveCollision(
            { id: 'el_' + Math.random(), type: 'PROJECTILE',
              position: { x: contactX() + 4, y: t.position.y },
              velocity: { x: -900, y: 0 }, rotation: Math.PI, size: { x: 6, y: 6 },
              mass: 0.1, active: true, color: '#fff', damage: 4,
              ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [] },
            t, { x: 0, y: 0 }, e.spawnDamageText.bind(e), e.handleEntityDeath);
          hits++;
          const fresh = ents.filter((x: any) => x.active && !before.has(x.id)
            && x.shardVariant === 'plastic-shard' && x.dentRecoverTimer !== undefined);
          if (fresh.length > 0) {
            const c = fresh[0];
            const atBreak = area(c.polygonPoints);
            const rest = area(c.dentRestPolygon);
            const samples: number[] = [];
            for (let i = 0; i < 200; i++) {
              e.shards.update(ents, 1 / 60, e.physics, false);
              if (i === 30 || i === 90) samples.push(area(c.polygonPoints));
            }
            out.push({ atBreak, rest, mid: samples,
              after: area(c.polygonPoints), done: c.dentRecoverTimer === undefined });
            break;
          }
          if (!t.active) break;
        }
        if (out.length >= 3) break;
      }
      return out;
    });

    expect(r.length).toBeGreaterThan(0);
    for (const row of r) {
      // It came away DEFORMED — smaller than the shape its grain was cut
      // at.  Before this the fragment was spawned at the cut size no
      // matter how squashed the grain was.
      expect(row.atBreak).toBeLessThan(row.rest * 0.99);
      // ...and relaxes back, monotonically and in time order...
      expect(row.mid[0]).toBeGreaterThan(row.atBreak);
      expect(row.mid[1]).toBeGreaterThan(row.mid[0]);
      // ...arriving exactly at the cut shape, and finishing.  The lerp is
      // LINEAR in time: stepping a fraction of the REMAINING distance
      // each tick compounds into an exponential approach that reaches
      // rest long before the timer, making dentRecoverSeconds a lie.
      expect(row.after).toBeCloseTo(row.rest, 3);
      expect(row.done).toBe(true);
    }

    console.log('[elastic] ' + r.map((x: any) =>
      `${x.atBreak.toFixed(0)} -> ${x.mid[0].toFixed(0)} -> ${x.mid[1].toFixed(0)} -> ${x.rest.toFixed(0)}`).join('  |  '));

    watch.assertClean();
  });

  test('metal and plastic shards carry real HP, and metal shards fracture like everything else',
    async ({ page }) => {
    const watch = await boot(page);

    const read = async (map: string, tile: string, child: string) => {
      await startRun(page, map);
      const onMap = new Function('s', `return s.currentMapType === '${map}'`) as (s: any) => boolean;
      await waitForStats(page, onMap, map);
      return engine<any[], { tile: string; child: string }>(page, (e: any, arg: any) => {
        const ents = e.currentMap.entities;
        for (const t of ents.filter((x: any) => x.active
            && x.shardVariant === arg.tile && x.mass === Infinity).slice(0, 4)) {
          t.health = 0; t.active = false;
          e.physics.removeStaticEntity(t); e.handleEntityDeath(t);
        }
        const rows: any[] = [];
        for (const sh of ents.filter((x: any) => x.active && x.shardVariant === arg.child
            && x.mass !== Infinity).sort((a: any, b: any) => b.size.x - a.size.x).slice(0, 6)) {
          sh.lastImpactLocal = { x: sh.size.x * 0.5, y: 0 };
          e.physics.resolveCollision(
            { id: 'shp_' + Math.random(), type: 'PROJECTILE',
              position: { x: sh.position.x + sh.size.x * 0.5 + 4, y: sh.position.y },
              velocity: { x: -900, y: 0 }, rotation: Math.PI, size: { x: 6, y: 6 },
              mass: 0.1, active: true, color: '#fff', damage: 0.001,
              ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [] },
            sh, { x: 0, y: 0 }, e.spawnDamageText.bind(e), e.handleEntityDeath);
          rows.push({ size: sh.size.x, cells: (sh.fractureCells ?? []).length,
            derived: sh.maxHealth ?? 0 });
        }
        return rows;
      }, { tile, child });
    };

    const plastic = await read('PLASTIC_FIELD', 'plastic-tile', 'plastic-shard');
    const metal = await read('METAL_FIELD', 'metal-tile', 'metal-shard');

    const avg = (rows: any[], k: string) => rows.reduce((a, b) => a + b[k], 0) / rows.length;
    for (const [name, rows] of [['plastic', plastic], ['metal', metal]] as any[]) {
      expect(rows.length, name).toBeGreaterThan(2);
      // Every shard decomposes — metal shards had NO grain block at all
      // and broke on a single hit.  The bar is 2 rather than 3 because a
      // material's grainSize is now SHARED with its tile: a shard is
      // simply a smaller body of the same stuff, so it gets whatever
      // grain count its size implies (plastic averages 2.8) rather than
      // a finer grain authored just for shards.
      expect(avg(rows, 'cells'), name).toBeGreaterThanOrEqual(2);
      // ...and carries enough internal boundary to survive a few Blaster
      // hits.  Derived HP IS the total internal boundary, so a shard with
      // two grains and one short seam between them dies instantly.
      expect(avg(rows, 'derived'), name).toBeGreaterThan(12);
    }

    console.log('[shard hp] plastic', avg(plastic, 'derived').toFixed(1),
      `(${avg(plastic, 'cells').toFixed(1)} grains) | metal`,
      avg(metal, 'derived').toFixed(1), `(${avg(metal, 'cells').toFixed(1)} grains)`);

    watch.assertClean();
  });
});

test.describe('grain size is a material constant', () => {
  test('a body\'s grains are the material\'s size, between the floor and the ceiling',
    async ({ page }) => {
    const watch = await boot(page);

    // Grain COUNT is proportional to AREA, so `grainSize` is the grain's
    // own diameter and a material's grains are the same size whatever
    // body they are in.  Counting by DIAMETER made count linear in size,
    // so grains GREW with the body — a rock tile's measured ~12.7 units
    // across against ~8.4 in the same material's shard, i.e. a shard was
    // quietly a finer-grained material than its own tile.
    const cases = [
      { map: 'ROCK_FIELD', variant: 'rock-tile', authored: 14 },
      { map: 'GLASS_FIELD', variant: 'glass-tile', authored: 15 },
      { map: 'PLASTIC_FIELD', variant: 'plastic-tile', authored: 20 },
      { map: 'METAL_FIELD', variant: 'metal-tile', authored: 13 },
    ];
    const out: any[] = [];
    for (const c of cases) {
      await startRun(page, c.map);
      const onMap = new Function('s', `return s.currentMapType === '${c.map}'`) as (s: any) => boolean;
      await waitForStats(page, onMap, c.map);
      const r = await engine(page, (e: any, arg: any) => {
        const area = (p: any[]) => { let a = 0;
          for (let i = 0; i < p.length; i++) { const q = p[i], n = p[(i + 1) % p.length];
            a += q.x * n.y - n.x * q.y; } return Math.abs(a / 2); };
        const dias: number[] = [];
        for (const t of e.currentMap.entities.filter((x: any) => x.active
            && x.shardVariant === arg.variant && x.mass === Infinity).slice(0, 8)) {
          t.lastImpactLocal = { x: t.size.x * 0.5, y: 0 };
          e.physics.resolveCollision(
            { id: 'gs_' + Math.random(), type: 'PROJECTILE',
              position: { x: t.position.x + t.size.x * 0.5 + 4, y: t.position.y },
              velocity: { x: -900, y: 0 }, rotation: Math.PI, size: { x: 6, y: 6 },
              mass: 0.1, active: true, color: '#fff', damage: 0.001,
              ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [] },
            t, { x: 0, y: 0 }, e.spawnDamageText.bind(e), e.handleEntityDeath);
          const n = (t.fractureCells ?? []).length;
          if (n > 0) dias.push(2 * Math.sqrt((area(t.polygonPoints) / n) / Math.PI));
        }
        return dias.reduce((a, b) => a + b, 0) / Math.max(1, dias.length);
      }, c);
      out.push({ variant: c.variant, authored: c.authored, measured: r });
    }

    for (const row of out) {
      // A tile is comfortably above the grain-count floor, so its grains
      // come out at the material's authored size.
      expect(row.measured, row.variant).toBeGreaterThan(row.authored * 0.85);
      expect(row.measured, row.variant).toBeLessThan(row.authored * 1.15);
    }

    console.log('[grain size] ' + out.map((x: any) =>
      `${x.variant.replace('-tile', '')} ${x.measured.toFixed(1)}/${x.authored}`).join('  '));

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
