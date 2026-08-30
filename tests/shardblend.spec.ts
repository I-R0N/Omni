/** The bonded-pair blend — a cohesion bond drawn as ONE blob.
 *
 *  Plastic's cross-material bonds are `cohesionOnly`: the pair never
 *  matures into the single re-polygonised entity every other variant's
 *  bond resolves to, so it stays two polygons touching for as long as
 *  the bond lives.  `render/shardBlend.ts` fills a metaball connector
 *  underneath them so it reads as goo instead.
 *
 *  Two things are pinned, and they are different KINDS of claim:
 *
 *   1. THE GEOMETRY, through `window.__omniBlend` (CLAUDE.md §8) — the
 *      connector is pure and every one of its failure modes is SILENT.
 *      A degenerate pair traces nothing, an out-of-domain `acos` yields
 *      NaN coordinates Canvas2D discards without a word, and an attach
 *      radius outside the hull leaves a seam that is invisible at most
 *      zoom levels.  None of it throws, logs, or shows up in a stats
 *      payload.  Traced into a recording context, all of it is exact.
 *   2. THE WIRING, through the real engine — a bond that forms in the
 *      sim reaches the draw pass, and the DBG toggle takes it away
 *      WITHOUT taking the bond with it, which is the whole claim that
 *      this layer is presentation only.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, startRun, waitForEngine } from './helpers';

/** Trace one connector and report the anchors, plus the midpoint of the
 *  first flank curve and of the straight chord it spans. */
async function trace(page: any, args: {
  ar: number; br: number; d: number; softness?: number;
}) {
  return page.evaluate((a: any) => {
    const rec: any[] = [];
    const ctx: any = {
      beginPath()  { rec.push(['begin']); },
      moveTo(x: number, y: number) { rec.push(['move', x, y]); },
      lineTo(x: number, y: number) { rec.push(['line', x, y]); },
      bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
        rec.push(['bez', c1x, c1y, c2x, c2y, x, y]);
      },
      closePath()  { rec.push(['close']); },
    };
    const ok = (window as any).__omniBlend.buildFilletPath(
      ctx, 0, 0, a.ar, a.d, 0, a.br, a.softness ?? 0.5,
    );
    if (!ok) return { ok, ops: rec.map(r => r[0]) };

    const move = rec.find(r => r[0] === 'move')!;
    const bezs = rec.filter(r => r[0] === 'bez');
    const line = rec.find(r => r[0] === 'line')!;
    const p1 = [move[1], move[2]];
    const b1 = bezs[0];
    const c1 = [b1[1], b1[2]], c2 = [b1[3], b1[4]], p3 = [b1[5], b1[6]];
    const p4 = [line[1], line[2]];
    const p2 = [bezs[1][5], bezs[1][6]];
    const at = (t: number, i: number) => {
      const u = 1 - t;
      return u * u * u * p1[i] + 3 * u * u * t * c1[i] + 3 * u * t * t * c2[i] + t * t * t * p3[i];
    };
    return {
      ok,
      ops: rec.map(r => r[0]),
      p1, p2, p3, p4,
      curveMid: [at(0.5, 0), at(0.5, 1)],
      chordMid: [(p1[0] + p3[0]) / 2, (p1[1] + p3[1]) / 2],
      finite: rec.every(r => r.slice(1).every((v: number) => Number.isFinite(v))),
    };
  }, args);
}

test.describe('the connector geometry', () => {
  test('attaches ON both bodies and waists BETWEEN them', async ({ page }) => {
    const watch = await boot(page);

    const r = await trace(page, { ar: 30, br: 30, d: 50 });
    expect(r.ok, 'a touching pair draws').toBe(true);
    expect(r.finite, 'no NaN reached the path').toBe(true);
    expect(r.ops).toEqual(['begin', 'move', 'bez', 'line', 'bez', 'close']);

    // The ends sit exactly on each attach circle — that is what lets the
    // bodies drawn over the bridge cover the join.
    expect(Math.hypot(r.p1[0], r.p1[1]), 'near end on body A').toBeCloseTo(30, 6);
    expect(Math.hypot(r.p3[0] - 50, r.p3[1]), 'far end on body B').toBeCloseTo(30, 6);

    // THE WAIST — the property that makes this a smooth-min union rather
    // than a capsule: the flank bows IN toward the axis, so the bridge is
    // narrower in the middle than a straight taper between the same two
    // attach points would be.
    expect(Math.abs(r.curveMid[1]), 'the flank necks inward')
      .toBeLessThan(Math.abs(r.chordMid[1]));

    // Symmetric about the axis joining the centres.
    expect(r.p2[1]).toBeCloseTo(-r.p1[1], 6);
    expect(r.p4[1]).toBeCloseTo(-r.p3[1], 6);

    watch.assertClean();
  });

  test('a wider gap necks harder — the goo thins as it stretches', async ({ page }) => {
    const watch = await boot(page);

    const near = await trace(page, { ar: 30, br: 30, d: 50 });
    const far  = await trace(page, { ar: 30, br: 30, d: 70 });
    expect(far.ok).toBe(true);
    // Waist width as a fraction of the chord it spans: strictly smaller
    // at range.  Stated as a ratio because the absolute half-width falls
    // for a second, uninteresting reason (the attach points slide toward
    // the axis as the tangent angle closes).
    const ratio = (t: any) => Math.abs(t.curveMid[1]) / Math.abs(t.chordMid[1]);
    expect(ratio(far), 'stretched thinner').toBeLessThan(ratio(near));

    watch.assertClean();
  });

  test('a swallowed pair draws NOTHING rather than a degenerate path', async ({ page }) => {
    const watch = await boot(page);

    // B sits wholly inside A: there is no waist, and it is also the case
    // that puts the half-angle acos out of domain.
    const r = await trace(page, { ar: 40, br: 5, d: 10 });
    expect(r.ok, 'refused').toBe(false);
    expect(r.ops, 'and left the path untouched').toEqual([]);

    watch.assertClean();
  });

  test('the attach radius follows the hull TOWARD the partner', async ({ page }) => {
    const watch = await boot(page);

    // A regular hexagon of circumradius 50 with a vertex at angle 0.  Its
    // reach is 50 toward that vertex and 50·cos(30°) toward the edge
    // midpoint between two — the spread a single fixed radius cannot
    // represent, and the reason this is a ray cast rather than a number.
    const r = await page.evaluate(() => {
      const pts = [];
      for (let i = 0; i < 6; i++) {
        pts.push({ x: Math.cos(i * Math.PI / 3) * 50, y: Math.sin(i * Math.PI / 3) * 50 });
      }
      const hex = (rot: number) => ({ size: { x: 100, y: 100 }, polygonPoints: pts, rotation: rot });
      const f = (window as any).__omniBlend.blendAttachRadius;
      const s30 = Math.sin(Math.PI / 6), c30 = Math.cos(Math.PI / 6);
      return {
        toVertex: f(hex(0), 1, 1, 0),
        toEdge:   f(hex(0), 1, c30, s30),
        // Rotating the BODY moves its faces: at 30° the +x ray that used
        // to leave through a vertex leaves through an edge instead.
        rotated:  f(hex(Math.PI / 6), 1, 1, 0),
        // The fraction biases the anchor inward, under the hull.
        biased:   f(hex(0), 0.9, 1, 0),
        // Direction is a DIRECTION — its length must not scale the reach.
        unnormalised: f(hex(0), 1, 37, 0),
        // No polygon means a disc: the same reach every way round.
        disc:     f({ size: { x: 100, y: 100 } }, 1, 1, 0),
      };
    });
    expect(r.toVertex, 'reaches the vertex').toBeCloseTo(50, 6);
    expect(r.toEdge, 'reaches the edge, not the vertex').toBeCloseTo(50 * Math.cos(Math.PI / 6), 6);
    expect(r.rotated, 'the body\'s rotation turns its faces').toBeCloseTo(50 * Math.cos(Math.PI / 6), 6);
    expect(r.biased).toBeCloseTo(45, 6);
    expect(r.unnormalised, 'direction length is irrelevant').toBeCloseTo(50, 6);
    expect(r.disc).toBeCloseTo(50, 6);

    watch.assertClean();
  });

  test('only the GOO side of a bond is coated', async ({ page }) => {
    const watch = await boot(page);

    // The coat envelops each bonded body in its own hull grown outward.
    // Which bodies get one is the claim: a body wears a coat on its OWN
    // variant's policy, never on its partner's. Coating the partner would
    // repaint a glass tile's face in plastic green — saying the tile is
    // goo, when it is the thing the goo is stuck to.
    const r = await page.evaluate(() => {
      const f = (window as any).__omniBlend.coatMargin;
      return {
        // Plastic ↔ plastic: both sides are goo, both coated.
        plasticSelf:  f('plastic-shard', 'plastic-shard', 100),
        // Plastic ↔ glass tile: the plastic is coated…
        plasticOnGlass: f('plastic-shard', 'glass-tile', 100),
        // …and the tile is not, though it is half of the same bond.
        glassUnderPlastic: f('glass-tile', 'plastic-shard', 100),
        // A pair with no blend policy on either side wears nothing.
        rockOnRock: f('rock-shard', 'rock-shard', 100),
        // Thickness scales with the body, so one number fits the 20..200
        // diameter range plastic shards really span.
        small: f('plastic-shard', 'plastic-shard', 10),
      };
    });
    expect(r.plasticSelf, 'plastic is goo').toBeGreaterThan(0);
    expect(r.plasticOnGlass, 'plastic stuck to glass is still goo').toBeGreaterThan(0);
    expect(r.glassUnderPlastic, 'the TILE is not goo').toBe(0);
    expect(r.rockOnRock, 'rock declares no blend').toBe(0);
    expect(r.small).toBeCloseTo(r.plasticSelf / 10, 6);

    watch.assertClean();
  });

  test('the DBG coat cycle scales the authored envelope and wraps', async ({ page }) => {
    const watch = await boot(page);

    // The knob multiplies what the variant authored rather than replacing
    // it, so the variant table stays the statement of how thick that
    // material's goo is. Pinned by walking the whole cycle and coming
    // back to the start — a cycle that does not wrap is a one-way trip.
    const seen = await engine(page, e => {
      const margin = () =>
        (window as any).__omniBlend.coatMargin('plastic-shard', 'plastic-shard', 100);
      const out = [margin()];
      for (let i = 0; i < 8; i++) { e.dbg.cycleShardCoat(); out.push(margin()); }
      return out;
    }) as number[];

    const start = seen[0];
    expect(start, 'the authored value is where it starts').toBeGreaterThan(0);
    expect(seen[1], 'the first step goes UP').toBeGreaterThan(start);
    expect(Math.max(...seen), 'several levels higher are reachable')
      .toBeGreaterThanOrEqual(start * 4);
    // SHARD_COAT_CYCLE has 6 entries, so the 6th step lands back on the
    // first — and the walk above runs past that to prove it keeps going.
    expect(seen[6], 'the cycle wraps').toBeCloseTo(start, 6);
    expect(seen[7]).toBeCloseTo(seen[1], 6);

    // Leave the cycle where the suite found it: this is module-level
    // state on a shared page, and a later test reading a coat margin
    // would otherwise inherit whatever step this one stopped on.
    await engine(page, e => { for (let i = 0; i < 4; i++) e.dbg.cycleShardCoat(); });
    expect(await engine(page, () =>
      (window as any).__omniBlend.coatMargin('plastic-shard', 'plastic-shard', 100),
    )).toBeCloseTo(start, 6);

    watch.assertClean();
  });

});

test.describe('a bond in the sim reaches the draw pass', () => {
  test('a bonded plastic pair draws a bridge, and the DBG toggle takes only the DRAWING', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'PLASTIC_FIELD');

    // Two plastic shards beside the player — inside the viewport, since the
    // pass culls to it — and 42 apart, just inside the 44-unit contact
    // distance for a 40/40 pair, so the broadphase bonds them without the
    // SAT solver having anything to push apart first.
    await engine(page, e => {
      const p = e.player.position;
      e.player.velocity.x = 0; e.player.velocity.y = 0;
      const shard = (dx: number, dy: number, id: string) => ({
        id, type: 'STRUCTURE', shardVariant: 'plastic-shard',
        position: { x: p.x + dx, y: p.y + dy },
        velocity: { x: 0, y: 0 }, rotation: 0,
        size: { x: 40, y: 40 }, mass: 20.8, active: true, color: '#7fbf5f',
        health: 30, maxHealth: 30,
      });
      e.currentMap.entities.push(shard(-21, 200, 'blend_a'));
      e.currentMap.entities.push(shard(21, 200, 'blend_b'));
    });

    await waitForEngine(page, e => e.shards.liveBonds.length > 0,
                        'the pair to bond');
    await waitForEngine(page, e => e.renderer.lastShardBlendCount > 0,
                        'a bridge to be drawn');

    // Toggling the pass off stops the DRAWING and nothing else: the bond
    // is still there, still holding the pair together.
    const off = await engine(page, e => {
      e.dbg.toggleShardBlend();
      return { enabled: e.renderer.shardBlendEnabled, bonds: e.shards.liveBonds.length };
    });
    expect(off.enabled).toBe(false);
    expect(off.bonds, 'the bond survived the visual toggle').toBeGreaterThan(0);
    await waitForEngine(page, e => e.renderer.lastShardBlendCount === 0,
                        'the bridge to stop being drawn');

    watch.assertClean();
  });
});
