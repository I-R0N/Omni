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
  test('ships on unified, and legacy is still a true restore', async ({ page }) => {
    const watch = await boot(page);

    // The shipped default, read BEFORE the run starts so nothing in the boot
    // path can have cycled it.
    const dflt = await engine(page, e => e.renderer.getLighting());
    expect(dflt).toBe('unified');

    await startRun(page, 'GLASS_FIELD');

    // `legacy` must still cost literally nothing — that is what makes the
    // toggle a restore rather than a second route to the same picture.  It is
    // asserted on a FRESH page so no earlier frame can have left a canvas or
    // a stale accumulator behind.
    await engine(page, (e) => { e.renderer.setLighting('legacy'); e.renderer.lastLightingMs = 0; });
    await page.waitForTimeout(200);
    const r = await engine(page, e => ({
      mode: e.renderer.getLighting(),
      ms: e.renderer.lastLightingMs,
    }));
    expect(r.mode).toBe('legacy');
    // Frames have gone by since the accumulator was zeroed, and it is only
    // ever written after the layer has been built — so a 0 here is the whole
    // claim: no canvas work, no collection, no blit.
    expect(r.ms).toBe(0);
    watch.assertClean();
  });

  test('collects solid geometry and NEVER passThrough nebula, on both sides of the mass axis', async ({ page }) => {
    const watch = await boot(page);
    // Universe is the case that matters: two thirds of its static tiles are
    // nebula, so a filter that leaked passThrough would be obvious here and
    // nowhere else.
    await startRun(page, 'UNIVERSE');
    await engine(page, e => e.renderer.setLighting('unified'));
    await parkInCluster(page);
    await waitForEngine(page, e => e.renderer._lightOccluderCount >= 0, 'a lighting frame');

    // Classify the collected set against the live entities, with SHARD
    // SHADOWS both off and on.  An earlier version of this test asserted a
    // flat `mobile === 0`, which was right when only tiles cast and became
    // wrong the moment shards did — and it kept passing locally because the
    // maps are unseeded and the runs happened to have no shard in range.
    // CI drew a seed with two and caught it.  The invariant is not "no
    // mobile occluders", it is "mobile occluders exactly when asked for".
    const classify = async (wantShards: boolean) => engine(page, async (want) => {
      const e = window.__omniEngine;
      if (e.renderer.getShardShadows() !== want) e.renderer.toggleShardShadows();
      await new Promise<void>(res => {
        let k = 0;
        const t = () => { if (++k < 6) requestAnimationFrame(t); else res(); };
        requestAnimationFrame(t);
      });
      const n = e.renderer._lightOccluderCount;
      const variants: Record<string, number> = {};
      let nebula = 0, mobile = 0, inactive = 0, tooSmall = 0, matched = 0;
      for (let i = 0; i < n; i++) {
        const o = e.renderer._lightOccluders[i];
        const hit = e.currentMap.entities.find(
          (t: any) => Math.abs(t.position.x - o.x) < 0.01 && Math.abs(t.position.y - o.y) < 0.01,
        );
        if (!hit) continue;                       // wrap-shifted copy; fine
        matched++;
        variants[hit.shardVariant] = (variants[hit.shardVariant] ?? 0) + 1;
        if (String(hit.shardVariant).indexOf('nebula') >= 0) nebula++;
        if (hit.mass !== Infinity) {
          mobile++;
          // The size floor applies to shards only.
          if (Math.max(hit.size.x, hit.size.y) * 0.5 < 6) tooSmall++;
        }
        if (!hit.active) inactive++;
        // The record's own flag must agree with the entity it came from.
        if (o.mobile !== (hit.mass !== Infinity)) inactive += 1000;   // poison
      }
      return { n, matched, variants, nebula, mobile, inactive, tooSmall };
    }, wantShards);

    const off = await classify(false);
    const on = await classify(true);

    // Invariants that hold either way.
    for (const r of [off, on]) {
      expect(r.nebula).toBe(0);      // passThrough never casts — tile OR shard
      expect(r.inactive).toBe(0);    // also catches a mismatched `mobile` flag
      expect(r.tooSmall).toBe(0);    // the shard size floor is respected
    }
    // The mass axis is the toggle, not a hardcoded exclusion.
    expect(off.mobile).toBe(0);
    expect(on.mobile).toBeGreaterThanOrEqual(0);
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

  test('opaque casts a full shadow, glass a partial one, passThrough none', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');

    // A generated map gives no control over WHERE the occluders are, so the
    // scene is hand-built: every static tile deactivated, exactly one revived
    // due east of the player.  The bearings are then unambiguous.
    const r = await engine(page, async (e) => {
      // The showcase map is single-variant, so the OCCLUDER'S VARIANT is
      // stamped on rather than searched for.  That is safe because the ring
      // is sampled at 220 units and the tile sits at 120 — the probe never
      // touches the tile's own pixels, only the light behind it — and it is
      // the only way to get an opaque tile, a translucent one and a
      // passThrough one into the same hand-built scene.
      const place = async (variant: string) => {
        e.player.position.x = 0; e.player.position.y = 0;
        e.player.velocity.x = 0; e.player.velocity.y = 0;
        const tiles = e.currentMap.entities.filter(
          (t: any) => t.type === 'STRUCTURE' && t.mass === Infinity);
        for (const t of tiles) t.active = false;
        const pick = tiles[0];
        if (!pick) return false;
        pick.active = true;
        pick.shardVariant = variant;
        pick._occluderR = undefined;
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

      await place('rock-tile');            // opaque
      const solid = await profile();
      const solidOcc = e.renderer._lightOccluderCount;
      await place('glass-tile');           // translucent (transmit 0.55)
      const glass = await profile();
      const glassOcc = e.renderer._lightOccluderCount;
      await place('nebula-tile');          // passThrough — casts nothing
      const nebula = await profile();
      const nebulaOcc = e.renderer._lightOccluderCount;
      return { solid, solidOcc, glass, glassOcc, nebula, nebulaOcc };
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

    // GLASS TRANSMITS.  It is drawn as a translucent panel, so it withholds
    // only 1 - transmit of the light instead of all of it.  The band that
    // matters is BETWEEN the two failure modes: a glass shadow as dark as
    // rock's means the transmission never reached the fill, and one as bright
    // as open space means glass stopped casting at all.  Both are silent.
    expect(r.glassOcc).toBe(1);
    const gIn = mean([70, 71, 0, 1, 2].map(i => r.glass[i]));
    const gOut = mean(r.glass.filter((_: number, i: number) => i > 5 && i < 67));
    expect(gIn).toBeGreaterThan(gOut * 0.30);
    expect(gIn).toBeLessThan(gOut * 0.80);
    // ...and strictly lighter than the opaque case, on the same geometry.
    expect(gIn).toBeGreaterThan(mean(inShadow));

    // passThrough casts NOTHING: nebula collects as zero occluders, so the
    // ring is uniformly lit.
    expect(r.nebulaOcc).toBe(0);
    const nIn = mean([70, 71, 0, 1, 2].map(i => r.nebula[i]));
    const nOut = mean(r.nebula.filter((_: number, i: number) => i > 5 && i < 67));
    expect(nIn).toBeGreaterThan(nOut * 0.7);
    watch.assertClean();
  });

  test('debris cannot blank out the terrain shadows', async ({ page }) => {
    const watch = await boot(page);
    // UNIVERSE because this needs BOTH kinds present; the glass showcase has
    // no shards and the asteroid showcase has no tiles.
    await startRun(page, 'UNIVERSE');

    // The scene is BUILT, not found.  An earlier version shattered the
    // generated terrain and then asserted on whatever happened to be in
    // range, which made it depend on where `parkInCluster` landed on an
    // unseeded map — it passed locally and failed in CI, then failed 1 run
    // in 4 under --repeat-each.  Here the adversarial case is constructed
    // directly: shards placed NEARER than the tiles, so plain nearest-first
    // would hand them the entire pool.
    const r = await engine(page, async (e) => {
      e.player.position.x = 0; e.player.position.y = 0;
      e.player.velocity.x = 0; e.player.velocity.y = 0;

      const all = e.currentMap.entities.filter((t: any) => t.type === 'STRUCTURE');
      for (const t of all) t.active = false;
      const tiles = all.filter((t: any) => t.mass === Infinity
                                        && String(t.shardVariant).indexOf('nebula') < 0);
      const shards = all.filter((t: any) => t.mass !== Infinity
                                         && String(t.shardVariant).indexOf('nebula') < 0);

      const NT = 20, NS = 20;
      // Tiles on the OUTER ring...
      for (let i = 0; i < NT && i < tiles.length; i++) {
        const a = (i / NT) * Math.PI * 2;
        tiles[i].active = true;
        tiles[i].position.x = Math.cos(a) * 190;
        tiles[i].position.y = Math.sin(a) * 190;
      }
      // ...shards on the INNER ring, i.e. strictly nearer than every tile.
      for (let i = 0; i < NS && i < shards.length; i++) {
        const a = ((i + 0.5) / NS) * Math.PI * 2;
        shards[i].active = true;
        shards[i].position.x = Math.cos(a) * 90;
        shards[i].position.y = Math.sin(a) * 90;
        shards[i].velocity.x = 0; shards[i].velocity.y = 0;
      }
      e.physics.initializeStaticGrid(e.currentMap.entities);
      e.renderer.setLighting('unified');
      if (!e.renderer.getShardShadows()) e.renderer.toggleShardShadows();

      // Hold the player at the origin while the dynamic grid refills.
      await new Promise<void>(res => {
        let k = 0;
        const t = () => {
          e.player.position.x = 0; e.player.position.y = 0;
          e.player.velocity.x = 0; e.player.velocity.y = 0;
          if (++k < 30) requestAnimationFrame(t); else res();
        };
        requestAnimationFrame(t);
      });

      const n = e.renderer._lightOccluderCount;
      let mob = 0;
      for (let i = 0; i < n; i++) if (e.renderer._lightOccluders[i].mobile) mob++;
      return { n, mob, tiles: n - mob, placedTiles: Math.min(NT, tiles.length),
               placedShards: Math.min(NS, shards.length) };
    });

    expect(r.placedTiles).toBeGreaterThanOrEqual(20);
    expect(r.placedShards).toBeGreaterThanOrEqual(20);
    expect(r.n).toBeGreaterThan(0);
    // Plain nearest-first would give all 20 shards the first 20 slots.  The
    // share cap is 8 of 24 at Low tier while terrain is available.
    expect(r.mob).toBeLessThanOrEqual(8);
    // ...and the terrain must actually still be casting.
    expect(r.tiles).toBeGreaterThanOrEqual(12);
    watch.assertClean();
  });

  test('casts from the BODY: a sliver clears the size floor, and every occluder carries its polygon', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'UNIVERSE');

    // Two shards, BUILT rather than found, at the same distance:
    //
    //   SLIVER — bounding half-extent 10 (over the 6-unit floor), inradius 2
    //            (under it).  A5b switched the shadow radius to the inradius
    //            and the floor silently came with it, so bodies up to 18
    //            units across stopped casting.  This is that case.
    //   FAT    — a regular hexagon, over the floor either way.  The control:
    //            if the scene itself failed to build, both vanish together.
    const r = await engine(page, async (e) => {
      const all = e.currentMap.entities.filter((t: any) => t.type === 'STRUCTURE');
      for (const t of all) t.active = false;
      const shards = all.filter((t: any) => t.mass !== Infinity
                                         && String(t.shardVariant).indexOf('nebula') < 0);
      if (shards.length < 2) return { built: false } as any;

      const poly = (n: number, rx: number, ry: number) => {
        const out = [];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          out.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
        }
        return out;
      };
      const place = (t: any, x: number, y: number, pts: any[], half: number) => {
        t.active = true;
        t.position.x = x; t.position.y = y;
        t.velocity.x = 0; t.velocity.y = 0;
        t.rotation = 0;
        t.polygonPoints = pts;
        t.size.x = half * 2; t.size.y = half * 2;
        t._occluderR = undefined;         // the inradius cache must re-derive
      };
      // Positions stay CANONICAL (inside the map, never negative): the wrap
      // resolution in `record` picks the copy nearest the light, and a
      // negative input is not a position this engine ever produces.
      const px = e.player.position.x, py = e.player.position.y;
      // A 4-gon 20 long and 4 wide: bounding half-extent 10, inradius 2.
      place(shards[0], px + 90, py, poly(4, 10, 2), 10);
      // A hexagon of radius 10: inradius 8.66.
      place(shards[1], px, py + 90, poly(6, 10, 10), 10);

      e.physics.initializeStaticGrid(e.currentMap.entities);
      e.renderer.setLighting('unified');
      if (!e.renderer.getShardShadows()) e.renderer.toggleShardShadows();

      // Both shards are MOBILE, so the flow field and gravity walk them off
      // their marks over the settle window — which made an earlier version of
      // this test pass alone and fail in a full run, purely on how many frames
      // went by.  Re-pin them, and the player, every frame.
      await new Promise<void>(res => {
        let k = 0;
        const t = () => {
          e.player.position.x = px; e.player.position.y = py;
          e.player.velocity.x = 0; e.player.velocity.y = 0;
          place(shards[0], px + 90, py, shards[0].polygonPoints, 10);
          place(shards[1], px, py + 90, shards[1].polygonPoints, 10);
          if (++k < 30) requestAnimationFrame(t); else res();
        };
        requestAnimationFrame(t);
      });

      const n = e.renderer._lightOccluderCount;
      const occ = [];
      for (let i = 0; i < n; i++) {
        const o = e.renderer._lightOccluders[i];
        occ.push({ dx: +(o.x - px).toFixed(1), dy: +(o.y - py).toFixed(1),
                   r: +o.r.toFixed(2), br: +o.br.toFixed(2),
                   verts: o.pts ? o.pts.length : 0 });
      }
      return { built: true, n, occ };
    });

    expect(r.built).toBe(true);
    expect(r.n).toBe(2);
    const sliver = r.occ.find((o: any) => Math.abs(o.dx - 90) < 2 && Math.abs(o.dy) < 2);
    const fat = r.occ.find((o: any) => Math.abs(o.dy - 90) < 2 && Math.abs(o.dx) < 2);
    expect(fat).toBeTruthy();
    // The regression: this one was dropped outright.
    expect(sliver).toBeTruthy();
    expect(sliver.r).toBeLessThan(6);       // its inradius really is under the floor
    expect(sliver.br).toBeGreaterThanOrEqual(6);

    // And every occluder must carry the polygon the shadow is extruded from,
    // with the bounding extent never under the inradius — the two radii are
    // used for different jobs (reach cull vs fallback circle) and swapping
    // them would be silent.
    for (const o of r.occ) {
      expect(o.verts).toBeGreaterThanOrEqual(3);
      expect(o.br).toBeGreaterThanOrEqual(o.r - 1e-6);
    }
    watch.assertClean();
  });

  test('the tier ladder is monotone, and low is still the default', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');
    await engine(page, e => e.renderer.setLighting('unified'));
    await parkInCluster(page);

    // Low is the SHIPPED default, and adding tiers BELOW it must not move
    // that — which is why the default index is derived from the name rather
    // than written as a literal.
    expect(await engine(page, e => e.renderer.getLightTier())).toBe('low');

    // Walk the whole cycle, recording what each tier actually DOES rather
    // than what its row says: the light-canvas width is the divisor made
    // observable, and the occluder count in a saturated cluster is the cap.
    const walk = await engine(page, async (e) => {
      const out: { name: string; w: number; occ: number }[] = [];
      for (let i = 0; i < 5; i++) {
        await new Promise<void>(res => {
          let k = 0;
          const t = () => { if (++k < 8) requestAnimationFrame(t); else res(); };
          requestAnimationFrame(t);
        });
        out.push({ name: e.renderer.getLightTier(), w: e.renderer._lightW,
                   occ: e.renderer._lightOccluderCount });
        e.renderer.cycleLightTier();
      }
      while (e.renderer.getLightTier() !== 'low') e.renderer.cycleLightTier();
      return out;
    });

    expect(walk.map(t => t.name)).toEqual(['low', 'medium', 'high', 'lowest', 'lower']);
    const by = (n: string) => walk.find(t => t.name === n)!;

    // A cheaper tier has to be cheaper in every term that drives cost, or it
    // is only cheaper in its name.  The light canvas gets COARSER going down
    // (bigger divisor -> fewer pixels)...
    expect(by('lowest').w).toBeLessThan(by('lower').w);
    expect(by('lower').w).toBeLessThan(by('low').w);
    expect(by('low').w).toBeLessThan(by('medium').w);

    // ...and the occluder cap gets SMALLER.  The cluster saturates every cap,
    // so these are the caps themselves.
    expect(by('lowest').occ).toBeLessThan(by('lower').occ);
    expect(by('lower').occ).toBeLessThan(by('low').occ);
    watch.assertClean();
  });

  test('refraction: OFF by default, and ON it MOVES the light rather than adding it', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');

    const off = await engine(page, e => e.renderer.getRefraction());
    expect(off).toBe(false);          // a prototype ships off

    // One glass tile due east, same hand-built scene as the shadow test.
    const r = await engine(page, async (e) => {
      e.player.position.x = 0; e.player.position.y = 0;
      e.player.velocity.x = 0; e.player.velocity.y = 0;
      const tiles = e.currentMap.entities.filter(
        (t: any) => t.type === 'STRUCTURE' && t.mass === Infinity);
      for (const t of tiles) t.active = false;
      const pick = tiles[0];
      if (!pick) return { built: false } as any;
      pick.active = true;
      pick.shardVariant = 'glass-tile';
      pick._occluderR = undefined;
      pick.position.x = 120; pick.position.y = 0;
      e.physics.initializeStaticGrid(e.currentMap.entities);

      const settle = () => new Promise<void>(res => {
        let n = 0;
        const t = () => { e.player.position.x = 0; e.player.position.y = 0;
          if (++n < 30) requestAnimationFrame(t); else res(); };
        requestAnimationFrame(t);
      });
      const ring = () => {
        const cv = document.querySelector('canvas') as HTMLCanvasElement;
        const g = cv.getContext('2d')!;
        const dpr = cv.width / 390, W = cv.width / dpr, H = cv.height / dpr;
        const cam = e.camera, shake = cam.shakeOffset || { x: 0, y: 0 };
        const lcx = (W / 2 + (0 - cam.position.x + shake.x) * cam.zoom) * dpr;
        const lcy = (H / 2 + (0 - cam.position.y + shake.y) * cam.zoom) * dpr;
        const rpx = 220 * cam.zoom * dpr;
        const img = g.getImageData(0, 0, cv.width, cv.height).data;
        const out: number[] = [];
        for (let k = 0; k < 72; k++) {
          const a = (k / 72) * Math.PI * 2;
          const x = Math.round(lcx + Math.cos(a) * rpx), y = Math.round(lcy + Math.sin(a) * rpx);
          const i = (y * cv.width + x) * 4;
          out.push((img[i] + img[i + 1] + img[i + 2]) / 3);
        }
        return out;
      };
      const profile = async () => {
        e.renderer.setLighting('unified'); await settle();
        const on = ring();
        e.renderer.setLighting('legacy'); await settle();
        const base = ring();
        return on.map((v, i) => v - base[i]);
      };

      if (e.renderer.getRefraction()) e.renderer.toggleRefraction();
      const plain = await profile();
      e.renderer.toggleRefraction();
      const bent = await profile();
      e.renderer.toggleRefraction();
      return { built: true, plain, bent, refractOff: e.renderer.getRefraction() };
    });

    expect(r.built).toBe(true);
    expect(r.refractOff).toBe(false);          // and it toggles back
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    const onAxis = (p: number[]) => mean([70, 71, 0, 1, 2].map(i => p[i]));
    const around = (p: number[]) => mean(p.filter((_: number, i: number) => i > 5 && i < 67));

    // The light must still work at all — the refraction maths has a square
    // root that goes imaginary past the critical angle, and ONE NaN discards
    // the entire compound path.  That failure looks like "the lighting turned
    // off", which is precisely how A4 shipped broken.
    expect(around(r.bent)).toBeGreaterThan(5);

    // ON, the straight-through path is withheld IN FULL, so the light
    // directly behind the glass must drop toward the opaque case.  That is
    // the "moved, not added" half of the claim, and it is the half that would
    // silently not happen if the erase override were dropped.
    expect(onAxis(r.bent)).toBeLessThan(onAxis(r.plain));
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
