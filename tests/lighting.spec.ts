/** Unified tile lighting — occluders and the shadow-cast light (gauntlet A1-A4).
 *
 *  See `docs/GAUNTLET_LIGHTING_LOG.md`.  What is pinned here is the part of
 *  the lighting system that can be WRONG WITH NO SYMPTOM until it is very
 *  wrong indeed — the same motive as `__omniHid` in the input suite:
 *
 *   - The occluder FILTER.  `nebula-tile` is `passThrough` and must never
 *     cast shadow; it is also the most numerous static tile on the natural
 *     maps (1496 of Universe's 2227), so getting this wrong would darken
 *     most of the game and read as an art problem, not a filter bug.
 *   - CHURN.  A tile that died this frame must leave the set immediately.  A
 *     stale shadow under a tile the player just shot is the single most
 *     visible failure this system can have, and `FlowFieldGrid` already
 *     concedes it cannot patch creation incrementally — shadows must not
 *     inherit that.
 *   - The RADIUS-CORRECT walk.  `forEachStaticNear` scans a fixed 3x3 cell
 *     block, which covers at most SPATIAL_GRID_SIZE (120).  Lighting queries
 *     at 300+, where that under-reports by 28-45%.  The symptom would be
 *     "shadows are missing from some tiles", which looks like tuning.
 *   - The TOROIDAL SEAM.  A wedge built across a wrap seam draws a bar of
 *     darkness through the whole arena.  Occluders are resolved into the
 *     light's zone at collection; this asserts they stay there.
 *   - THE SHADOW ITSELF.  A4 shipped with the wedges silently erasing
 *     nothing (the destination-out fill inherited the falloff gradient as
 *     its fillStyle, which reads alpha 0 away from its centre).  Nothing
 *     threw; the geometry was correct; the output was empty.  The shadow
 *     test measures a ring of bearings around the light's OWN centre,
 *     because a two-point probe taken from screen centre reported that as
 *     "the shadow is a bit weak" rather than "there is no shadow".
 *
 *  The lighting MODE is driven through `engine.renderer.setLighting(...)`.
 *  Occluders are read off `renderer._lightOccluders` / `_lightOccluderCount`
 *  — index-filled buffers, so the COUNT is authoritative, never `.length`.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, startRun, waitForEngine } from './helpers';

/** Park the player in the densest static-tile cluster on the current map and
 *  hold it there, so a light actually has occluders around it.  Returns the
 *  collected occluder count for one frame at that spot. */
async function parkInCluster(page: import('@playwright/test').Page) {
  return engine(page, (e) => {
    const tiles = e.currentMap.entities.filter(
      (t: any) => t.type === 'STRUCTURE' && t.mass === Infinity && t.active,
    );
    let best = null, bestN = -1;
    for (let i = 0; i < tiles.length; i += 5) {
      const a = tiles[i];
      let n = 0;
      for (let j = 0; j < tiles.length; j += 3) {
        const dx = a.position.x - tiles[j].position.x;
        const dy = a.position.y - tiles[j].position.y;
        if (dx * dx + dy * dy < 300 * 300) n++;
      }
      if (n > bestN) { bestN = n; best = a; }
    }
    if (best) {
      e.player.position.x = best.position.x;
      e.player.position.y = best.position.y;
      e.player.velocity.x = 0;
      e.player.velocity.y = 0;
    }
    return { tiles: tiles.length, cluster: bestN };
  });
}

test.describe('occluder collection', () => {
  test('is inert at the legacy default — no canvas, no cost, no set', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');

    const r = await engine(page, e => ({
      mode: e.renderer.getLighting(),
      hasCanvas: !!e.renderer._lightCanvas,
      count: e.renderer._lightOccluderCount,
      ms: e.renderer.lastLightingMs,
    }));

    // 'legacy' is the shipped default and it must cost literally nothing —
    // that is what makes the toggle a restore rather than a second route to
    // the same picture.
    expect(r.mode).toBe('legacy');
    expect(r.hasCanvas).toBe(false);
    expect(r.count).toBe(0);
    expect(r.ms).toBe(0);
    watch.assertClean();
  });

  test('collects solid tiles and NEVER passThrough nebula', async ({ page }) => {
    const watch = await boot(page);
    // Universe is the case that matters: two thirds of its static tiles are
    // nebula, so a filter that leaked passThrough would be obvious here and
    // nowhere else.
    await startRun(page, 'UNIVERSE');
    await engine(page, e => e.renderer.setLighting('unified'));
    await parkInCluster(page);
    await waitForEngine(page, e => e.renderer._lightOccluderCount >= 0, 'a lighting frame');

    const r = await engine(page, (e) => {
      const n = e.renderer._lightOccluderCount;
      const occ = e.renderer._lightOccluders.slice(0, n);
      // Match each collected occluder back to a live entity by position, and
      // report what variants came through.
      const variants: Record<string, number> = {};
      let nebula = 0, mobile = 0, inactive = 0;
      for (const o of occ) {
        const hit = e.currentMap.entities.find(
          (t: any) => Math.abs(t.position.x - o.x) < 0.01 && Math.abs(t.position.y - o.y) < 0.01,
        );
        if (!hit) continue;                       // wrap-shifted copy; fine
        variants[hit.shardVariant] = (variants[hit.shardVariant] ?? 0) + 1;
        if (hit.shardVariant === 'nebula-tile') nebula++;
        if (hit.mass !== Infinity) mobile++;
        if (!hit.active) inactive++;
      }
      return { n, variants, nebula, mobile, inactive };
    });

    expect(r.nebula).toBe(0);     // passThrough must never cast shadow
    expect(r.mobile).toBe(0);     // static/dynamic is by MASS, not EntityType
    expect(r.inactive).toBe(0);
    watch.assertClean();
  });

  test('drops a tile from the set the frame it dies — no stale shadows', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');
    await engine(page, e => e.renderer.setLighting('unified'));
    await parkInCluster(page);
    await waitForEngine(page, e => e.renderer._lightOccluderCount > 0, 'occluders around the player');

    const before = await engine(page, e => e.renderer._lightOccluderCount);
    expect(before).toBeGreaterThan(0);

    // Kill the tiles nearest the player through the FULL death path — what a
    // cannon into a cluster does.
    const killed = await engine(page, (e) => {
      const px = e.player.position.x, py = e.player.position.y;
      const cands = e.currentMap.entities
        .filter((t: any) => t.active && t.type === 'STRUCTURE' && t.mass === Infinity
                            && t.shardVariant !== 'indestructible-tile')
        .map((t: any) => ({ t, d: (t.position.x - px) ** 2 + (t.position.y - py) ** 2 }))
        .sort((a: any, b: any) => a.d - b.d)
        .slice(0, 12);
      for (const { t } of cands) {
        t.killedByPlayer = true;
        t.health = 0;
        e.handleEntityDeath(t);
        t.active = false;
      }
      return cands.map((c: any) => c.t.id);
    });
    expect(killed.length).toBeGreaterThan(0);

    // The set is rebuilt per frame from the live static grid, so the dead
    // tiles must be gone immediately — not on some later invalidation.
    await waitForEngine(
      page,
      e => e.renderer._lightOccluderCount >= 0,
      'a lighting frame after the kill',
    );
    const after = await engine(page, (e) => {
      const n = e.renderer._lightOccluderCount;
      const occ = e.renderer._lightOccluders.slice(0, n);
      let stale = 0;
      for (const o of occ) {
        const hit = e.currentMap.entities.find(
          (t: any) => Math.abs(t.position.x - o.x) < 0.01 && Math.abs(t.position.y - o.y) < 0.01,
        );
        if (hit && !hit.active) stale++;
      }
      return { n, stale };
    });

    expect(after.stale).toBe(0);
    watch.assertClean();
  });

  test('survives the wrap seam — occluders stay in the light\'s zone', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'UNIVERSE');
    await engine(page, e => e.renderer.setLighting('unified'));

    // Walk the player along the seam.  A wedge whose apex and base straddle
    // the wrap draws a bar of darkness across the arena, and the failure is
    // silent until it happens — so the invariant is asserted, not eyeballed.
    const worst = await engine(page, async (e) => {
      const W = e.currentMap.width, H = e.currentMap.height;
      let maxDx = 0, maxDy = 0, frames = 0;
      const spots = [
        [W / 2 - 1, H / 2 - 1], [-W / 2 + 1, -H / 2 + 1],
        [W / 2 - 1, -H / 2 + 1], [-W / 2 + 1, H / 2 - 1],
        [W / 2 - 150, H / 2 - 150], [0, H / 2 - 5],
      ];
      for (const [x, y] of spots) {
        e.player.position.x = x; e.player.position.y = y;
        e.player.velocity.x = 0; e.player.velocity.y = 0;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const n = e.renderer._lightOccluderCount;
        frames++;
        for (let i = 0; i < n; i++) {
          const o = e.renderer._lightOccluders[i];
          maxDx = Math.max(maxDx, Math.abs(o.x - e.player.position.x));
          maxDy = Math.max(maxDy, Math.abs(o.y - e.player.position.y));
        }
      }
      return { maxDx, maxDy, frames };
    });

    // The torus-seam detector from the ladder: no occluder may sit further
    // from the light than 3x the light radius.  A seam failure puts one half
    // a map away, so this catches it by orders of magnitude, not by a hair.
    expect(worst.frames).toBeGreaterThan(0);
    expect(worst.maxDx).toBeLessThan(300 * 3);
    expect(worst.maxDy).toBeLessThan(300 * 3);
    watch.assertClean();
  });

  test('casts a real shadow behind an occluder, and none behind passThrough', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');

    // A generated map gives no control over WHERE the occluders are, so the
    // scene is hand-built: every static tile deactivated, exactly one revived
    // due east of the player.  The bearings are then unambiguous.
    const r = await engine(page, async (e) => {
      const place = async (variant: string | null) => {
        e.player.position.x = 0; e.player.position.y = 0;
        e.player.velocity.x = 0; e.player.velocity.y = 0;
        const tiles = e.currentMap.entities.filter(
          (t: any) => t.type === 'STRUCTURE' && t.mass === Infinity);
        for (const t of tiles) t.active = false;
        const pick = variant ? tiles.find((t: any) => t.shardVariant === variant) : tiles[0];
        if (!pick) return false;
        pick.active = true;
        pick.position.x = 120; pick.position.y = 0;
        e.physics.initializeStaticGrid(e.currentMap.entities);
        return true;
      };
      const settle = () => new Promise<void>(res => {
        let n = 0;
        const t = () => { e.player.position.x = 0; e.player.position.y = 0;
          if (++n < 30) requestAnimationFrame(t); else res(); };
        requestAnimationFrame(t);
      });
      // Luminance on a ring around the LIGHT's own centre — computed the way
      // the renderer computes it, not assumed to be screen centre, because
      // the camera follows with lag and a bearing taken from the wrong origin
      // silently probes the wrong place.
      const ring = () => {
        const cv = document.querySelector('canvas') as HTMLCanvasElement;
        const g = cv.getContext('2d')!;
        const dpr = cv.width / 390, W = cv.width / dpr, H = cv.height / dpr;
        const cam = e.camera, shake = cam.shakeOffset || { x: 0, y: 0 };
        const lcx = (W / 2 + (0 - cam.position.x + shake.x) * cam.zoom) * dpr;
        const lcy = (H / 2 + (0 - cam.position.y + shake.y) * cam.zoom) * dpr;
        const rpx = 220 * cam.zoom * dpr;
        const img = g.getImageData(0, 0, cv.width, cv.height).data;
        const lum = (px: number, py: number) => {
          const x = Math.round(px), y = Math.round(py);
          const i = (y * cv.width + x) * 4;
          return (img[i] + img[i + 1] + img[i + 2]) / 3;
        };
        const out: number[] = [];
        for (let k = 0; k < 72; k++) {
          const a = (k / 72) * Math.PI * 2;
          out.push(lum(lcx + Math.cos(a) * rpx, lcy + Math.sin(a) * rpx));
        }
        return out;
      };
      const profile = async () => {
        e.renderer.setLighting('unified'); await settle();
        const on = ring();
        e.renderer.setLighting('legacy'); await settle();
        const off = ring();
        return on.map((v, i) => v - off[i]);
      };

      await place(null);
      const solid = await profile();
      const solidOcc = e.renderer._lightOccluderCount;
      const nebulaOk = await place('nebula-tile');
      const nebula = nebulaOk ? await profile() : null;
      const nebulaOcc = e.renderer._lightOccluderCount;
      return { solid, solidOcc, nebula, nebulaOcc };
    });

    // asin(22/120) = 10.6 deg, so at 5 deg per sample the shadow covers
    // samples 70,71,0,1,2 — bearing 0 plus a sample either side.
    const inShadow = [70, 71, 0, 1, 2].map(i => r.solid[i]);
    const outside = r.solid.filter((_: number, i: number) => i > 5 && i < 67);
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

    expect(r.solidOcc).toBe(1);
    // The light must actually add light somewhere...
    expect(mean(outside)).toBeGreaterThan(5);
    // ...and must not, behind the occluder.  Half the outside gain is a
    // generous bar for a HARD shadow; measured it is ~2.9 vs ~12.7.
    expect(mean(inShadow)).toBeLessThan(mean(outside) * 0.5);

    // passThrough casts NOTHING: nebula collects as zero occluders, so the
    // ring is uniformly lit.
    if (r.nebula) {
      expect(r.nebulaOcc).toBe(0);
      const nIn = mean([70, 71, 0, 1, 2].map(i => r.nebula![i]));
      const nOut = mean(r.nebula!.filter((_: number, i: number) => i > 5 && i < 67));
      expect(nIn).toBeGreaterThan(nOut * 0.7);
    }
    watch.assertClean();
  });

  test('debris cannot blank out the terrain shadows', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');
    await engine(page, (e) => {
      e.renderer.setLighting('unified');
      if (!e.renderer.getShardShadows()) e.renderer.toggleShardShadows();
    });
    await parkInCluster(page);
    await waitForEngine(page, e => e.renderer._lightOccluderCount > 0, 'occluders around the player');

    // Shatter the nearest terrain repeatedly — the debris burst is what
    // makes shards outrank tiles, since fragments land nearer than the
    // intact terrain behind them.  Measured before the share cap existed:
    // 100% of the 24 slots went to debris and the tiles stopped casting.
    const share: Array<{ share: number; tilesInRange: number }> = await engine(page, async (e) => {
      const px = e.player.position.x, py = e.player.position.y;
      const shatter = () => {
        const c = e.currentMap.entities
          .filter((t: any) => t.active && t.type === 'STRUCTURE' && t.mass === Infinity
                              && t.shardVariant !== 'indestructible-tile')
          .map((t: any) => ({ t, d: (t.position.x - px) ** 2 + (t.position.y - py) ** 2 }))
          .sort((a: any, b: any) => a.d - b.d).slice(0, 20);
        for (const { t } of c) { t.killedByPlayer = true; t.health = 0; e.handleEntityDeath(t); t.active = false; }
      };
      // Sample the share ALONGSIDE how much intact terrain is actually in
      // range.  Those two together are the invariant: shards may take the
      // whole pool when there is no terrain left to reserve for (which a
      // sustained shatter eventually causes, and which is correct), but they
      // must NOT crowd terrain out while terrain is there to cast.
      const frames: Array<{ share: number; tilesInRange: number }> = [];
      const R = 300;
      for (let round = 0; round < 3; round++) {
        shatter();
        await new Promise<void>(res => {
          let n = 0;
          const tick = () => {
            e.player.position.x = px; e.player.position.y = py;
            const k = e.renderer._lightOccluderCount;
            if (k > 0) {
              let mob = 0;
              for (let i = 0; i < k; i++) if (e.renderer._lightOccluders[i].mobile) mob++;
              let tilesInRange = 0;
              const ents = e.currentMap.entities;
              for (let i = 0; i < ents.length; i++) {
                const t = ents[i];
                if (!t.active || t.type !== 'STRUCTURE' || t.mass !== Infinity) continue;
                if (t.shardVariant === 'nebula-tile') continue;
                const dx = t.position.x - px, dy = t.position.y - py;
                if (dx * dx + dy * dy < R * R) tilesInRange++;
              }
              frames.push({ share: mob / k, tilesInRange });
            }
            if (++n < 40) requestAnimationFrame(tick); else res();
          };
          requestAnimationFrame(tick);
        });
      }
      return frames;
    });

    expect(share.length).toBeGreaterThan(0);
    // The invariant: on any frame with terrain to spare, debris must not have
    // taken more than its share of the pool.  Low tier gives shards 8 of 24.
    const withTerrain = share.filter(f => f.tilesInRange >= 16);
    expect(withTerrain.length).toBeGreaterThan(0);
    const worst = Math.max(...withTerrain.map(f => f.share));
    expect(worst).toBeLessThanOrEqual(8 / 24 + 0.01);
    watch.assertClean();
  });

  test('the radius-correct walk out-reports the fixed 3x3 walk at light radii', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');
    await parkInCluster(page);

    const r = await engine(page, (e) => {
      const p = e.player.position;
      const count = (fn: string, rad: number) => {
        let n = 0;
        (e.physics as any)[fn](p.x, p.y, rad, () => { n++; });
        return n;
      };
      return {
        near100: count('forEachStaticNear', 100),
        rad100: count('forEachStaticInRadius', 100),
        near300: count('forEachStaticNear', 300),
        rad300: count('forEachStaticInRadius', 300),
      };
    });

    // Under one cell (120) the two walks cover the same ground, so they must
    // agree exactly — that is what makes keeping the fixed span for the
    // legacy callers behaviour-preserving.
    expect(r.rad100).toBe(r.near100);
    // At a lighting radius the fixed span under-reports.  This is the bug
    // that would have shipped had A4 been built on forEachStaticNear.
    expect(r.rad300).toBeGreaterThan(r.near300);
    watch.assertClean();
  });
});
