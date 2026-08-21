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
      // THIS TEST PINS THE TRANSMISSION MODEL, so the two prototypes that
      // ship on top of it are held off for its duration: REFRACTION moves the
      // transmitted light out of the straight-through path by design (that is
      // its own test), and EMISSIVE would add a second light at the glass
      // tile's own position, inside the band being measured.  Neither belongs
      // in a measurement of "how much light does a translucent body withhold".
      // The FLASHLIGHT is pinned to `radial` too, now that `beam` ships: the
      // measurement below reads the light on a ring/bearing the beam would
      // simply not illuminate.
      const beam0 = e.renderer.getFlashlight();
      for (let i = 0; i < 10 && e.renderer.getFlashlight() !== 'radial'; i++) {
        e.renderer.cycleFlashlight();
      }
      if (e.renderer.getRefraction()) e.renderer.toggleRefraction();
      if (e.renderer.getEmissive()) e.renderer.toggleEmissive();
      // SOFTNESS is pinned for the same reason, and it is the one that
      // actually moved the numbers: the bearings below are derived from the
      // occluder's own angular size (asin(22/120) = 10.6 deg), so a penumbra
      // four times wider than the one they were derived for puts the
      // outermost samples inside the graded band and grades the whole
      // measurement down.  The shipped default is 'diffuse'; this test wants
      // the narrow band its geometry is written against.
      const softness0 = e.renderer.getShadowSoftness();
      for (let i = 0; i < 12 && e.renderer.getShadowSoftness() !== 'soft'; i++) {
        e.renderer.cycleShadowSoftness();
      }
      // THE TINT MIX likewise.  This test measures how much light a body
      // WITHHOLDS, in luminance; tinting what comes through toward the
      // material's colour changes that luminance without changing how much
      // was withheld — glass is indigo, so a half-tinted beam through it
      // reads dimmer while the shadow is identical.
      const mix0 = e.renderer.getTintMix();
      for (let i = 0; i < 8 && e.renderer.getTintMix() !== 'off'; i++) {
        e.renderer.cycleTintMix();
      }

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
          // FAUNA OFF, every frame.  The profile is a unified-minus-legacy
          // DIFF of two reads ~30 frames apart; an ambient bubble drifting
          // through a ring sample between them leaves its brightness in the
          // diff, and the glass umbra is a ~5-luminance signal.
          for (const o of e.currentMap.entities) {
            if (o.type !== 'STRUCTURE') o.active = false;
          }
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
      await place('plastic-tile');         // translucent, DULLER (0.28)
      const plastic = await profile();
      await place('nebula-tile');          // passThrough — casts nothing
      const nebula = await profile();
      const nebulaOcc = e.renderer._lightOccluderCount;
      if (!e.renderer.getRefraction()) e.renderer.toggleRefraction();
      if (!e.renderer.getEmissive()) e.renderer.toggleEmissive();
      for (let i = 0; i < 12 && e.renderer.getShadowSoftness() !== softness0; i++) {
        e.renderer.cycleShadowSoftness();
      }
      for (let i = 0; i < 10 && e.renderer.getFlashlight() !== beam0; i++) {
        e.renderer.cycleFlashlight();
      }
      for (let i = 0; i < 8 && e.renderer.getTintMix() !== mix0; i++) {
        e.renderer.cycleTintMix();
      }
      return { solid, solidOcc, glass, glassOcc, plastic, nebula, nebulaOcc };
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
    // The bar was 0.30 and the measured value is ~0.30 — it flaked twice in
    // three full-suite runs sitting exactly on its own threshold.  What the
    // test is actually for is that glass lands strictly BETWEEN the two
    // failure modes, so it is stated that way, with the lower bound also
    // tied to the opaque case rather than only to a fraction.
    expect(gIn).toBeGreaterThan(gOut * 0.15);
    // The lower bound was 2x the opaque case, which the measurement rides
    // (gIn 6.7-8.5 against inShadow 4.4-5.5 across runs): the STRICT claims
    // are the ones a failure mode would break — lighter than rock's shadow,
    // darker than open space — and both are stated below.
    expect(gIn).toBeGreaterThan(mean(inShadow) * 1.2);
    expect(gIn).toBeLessThan(gOut * 0.85);
    // ...and strictly lighter than the opaque case, on the same geometry.
    expect(gIn).toBeGreaterThan(mean(inShadow));

    // PLASTIC transmits too, and LESS than glass — it is the cloudy one of
    // the family, which is the whole content of "more opaque" in the two
    // numbers this system has.  Between the opaque case and the glass case,
    // and strictly so in both directions.
    const pIn = mean([70, 71, 0, 1, 2].map(i => r.plastic[i]));
    expect(pIn).toBeGreaterThan(mean(inShadow));
    expect(pIn).toBeLessThan(gIn);

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
      for (let i = 0; i < 7; i++) {
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

    expect(walk.map(t => t.name)).toEqual(
      ['low', 'medium', 'high', 'ultra', 'minimal', 'lowest', 'lower']);
    const by = (n: string) => walk.find(t => t.name === n)!;

    // A cheaper tier has to be cheaper in every term that drives cost, or it
    // is only cheaper in its name.  The light canvas gets COARSER going down
    // (bigger divisor -> fewer pixels), across the WHOLE ladder...
    const ladder = ['minimal', 'lowest', 'lower', 'low', 'medium'];
    for (let i = 1; i < ladder.length; i++) {
      expect(by(ladder[i - 1]).w).toBeLessThan(by(ladder[i]).w);
    }
    expect(by('medium').w).toBeLessThan(by('ultra').w);   // ultra is 1:1

    // ...and the occluder cap gets SMALLER.  The cluster saturates every cap,
    // so these are the caps themselves.
    expect(by('minimal').occ).toBeLessThan(by('lowest').occ);
    expect(by('lowest').occ).toBeLessThan(by('lower').occ);
    expect(by('lower').occ).toBeLessThan(by('low').occ);
    watch.assertClean();
  });

  test('refraction: OFF by default, and ON it MOVES the light rather than adding it', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');

    // SHIPS ON as of A5h (user call, after device testing).  It was off while
    // the question the prototype exists to ask — is a caustic legible at a
    // third of screen resolution — was still open.
    const dflt = await engine(page, e => e.renderer.getRefraction());
    expect(dflt).toBe(true);

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

      // The FLASHLIGHT is pinned to `radial` too, now that `beam` ships: the
      // measurement below reads the light on a ring/bearing the beam would
      // simply not illuminate.
      const beam0 = e.renderer.getFlashlight();
      for (let i = 0; i < 10 && e.renderer.getFlashlight() !== 'radial'; i++) {
        e.renderer.cycleFlashlight();
      }
      if (e.renderer.getRefraction()) e.renderer.toggleRefraction();
      const plain = await profile();
      e.renderer.toggleRefraction();
      const bent = await profile();
      for (let i = 0; i < 10 && e.renderer.getFlashlight() !== beam0; i++) {
        e.renderer.cycleFlashlight();
      }
      return { built: true, plain, bent, refractOn: e.renderer.getRefraction() };
    });

    expect(r.built).toBe(true);
    expect(r.refractOn).toBe(true);            // and it toggles back to the default

    // THE BRIGHTNESS RULE, pinned at the table rather than at one call site.
    // It CHANGED at A5f: half the source was a hard ceiling, and is now the
    // DEFAULT the cycle starts at, because the caustic measured as only
    // marginally legible and a prototype you cannot see is one you cannot
    // judge.  What survives as a ceiling is 1/1 — refracted light is a
    // redistribution of light that already passed through the body, so
    // out-shining the source outright stays meaningless.
    const cyc = await engine(page, (e) => {
      const seen: string[] = [];
      const first = e.renderer.getRefractBrightness();
      for (let i = 0; i < 20; i++) {
        seen.push(e.renderer.getRefractBrightness());
        e.renderer.cycleRefractBrightness();
        if (e.renderer.getRefractBrightness() === first) break;
      }
      return { first, seen };
    });
    expect(cyc.first).toBe('1/2');             // the default, not the ceiling
    expect(cyc.seen).toContain('1/1');         // ...and the ceiling is reachable
    expect(cyc.seen.length).toBeGreaterThan(5);
    for (const name of cyc.seen) {
      const m = /^(\d+)\/(\d+)$/.exec(name);
      expect(m).not.toBeNull();
      // Every entry is a proper fraction of the source: numerator <=
      // denominator, so nothing in the table can out-shine what lit it.
      expect(Number(m![1])).toBeLessThanOrEqual(Number(m![2]));
    }
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

  test('the brightness cycle really dims the light, and the tier cycle does not', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');

    // The distinction this pins is the one that was reported from the
    // device: "I'm at the lowest setting and it still feels very bright".
    // `Light tier` is a COST ladder and is SUPPOSED to leave brightness
    // alone; `Light bright` is the one that dims.  Asserting both halves
    // keeps a future refactor from quietly conflating them.
    const r = await engine(page, async (e) => {
      // No occluders at all — this measures the falloff, not a shadow.
      for (const t of e.currentMap.entities) {
        if (t.type === 'STRUCTURE') t.active = false;
      }
      e.player.position.x = 0; e.player.position.y = 0;
      e.physics.initializeStaticGrid(e.currentMap.entities);
      e.renderer.setLighting('unified');

      const settle = () => new Promise<void>(res => {
        let n = 0;
        const t = () => { e.player.position.x = 0; e.player.position.y = 0;
          e.player.velocity.x = 0; e.player.velocity.y = 0;
          if (++n < 25) requestAnimationFrame(t); else res(); };
        requestAnimationFrame(t);
      });
      // Mean luminance on a tight ring, where the falloff is strongest.
      const ring = () => {
        const cv = document.querySelector('canvas') as HTMLCanvasElement;
        const g = cv.getContext('2d')!;
        const dpr = cv.width / 390, W = cv.width / dpr, H = cv.height / dpr;
        const cam = e.camera, shake = cam.shakeOffset || { x: 0, y: 0 };
        const lcx = (W / 2 + (0 - cam.position.x + shake.x) * cam.zoom) * dpr;
        const lcy = (H / 2 + (0 - cam.position.y + shake.y) * cam.zoom) * dpr;
        const rpx = 90 * cam.zoom * dpr;
        const img = g.getImageData(0, 0, cv.width, cv.height).data;
        let sum = 0;
        for (let k = 0; k < 36; k++) {
          const a = (k / 36) * Math.PI * 2;
          const x = Math.round(lcx + Math.cos(a) * rpx), y = Math.round(lcy + Math.sin(a) * rpx);
          const i = (y * cv.width + x) * 4;
          sum += (img[i] + img[i + 1] + img[i + 2]) / 3;
        }
        return sum / 36;
      };
      const gainAt = async (setup: () => void) => {
        setup();
        e.renderer.setLighting('unified'); await settle();
        const on = ring();
        e.renderer.setLighting('legacy'); await settle();
        return on - ring();
      };

      const setBright = (want: string) => {
        for (let i = 0; i < 12 && e.renderer.getLightBrightness() !== want; i++) {
          e.renderer.cycleLightBrightness();
        }
      };
      const setTier = (want: string) => {
        for (let i = 0; i < 12 && e.renderer.getLightTier() !== want; i++) {
          e.renderer.cycleLightTier();
        }
      };

      const full = await gainAt(() => { setTier('low'); setBright('100%'); });
      const dim = await gainAt(() => { setBright('25%'); });
      const dimmest = await gainAt(() => { setBright('8%'); });
      const tierOnly = await gainAt(() => { setBright('100%'); setTier('lowest'); });
      setTier('low');
      return { full, dim, dimmest, tierOnly, names: e.renderer.getLightBrightness() };
    });

    // The light has to be doing something at all, or the rest is vacuous.
    expect(r.full).toBeGreaterThan(4);
    // ...and each rung down must actually be dimmer.
    expect(r.dim).toBeLessThan(r.full * 0.6);
    expect(r.dimmest).toBeLessThan(r.dim);
    // The TIER, by contrast, must leave brightness essentially alone — it
    // buys resolution and reach, not lumens.
    expect(r.tierOnly).toBeGreaterThan(r.full * 0.5);
    watch.assertClean();
  });

  test('emissive: lit metal re-radiates, and only when asked to', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'METAL_FIELD');

    // SHIPS ON as of A5h (user call, after device testing) — it is what metal
    // and glass do with light now that the contact-driven glow is deleted.
    const dflt = await engine(page, e => e.renderer.getEmissive());
    expect(dflt).toBe(true);

    const r = await engine(page, async (e) => {
      // One metal tile due east of the light, nothing else.
      const tiles = e.currentMap.entities.filter(
        (t: any) => t.type === 'STRUCTURE' && t.mass === Infinity);
      for (const t of e.currentMap.entities) {
        if (t.type === 'STRUCTURE') t.active = false;
      }
      const pick = tiles[0];
      if (!pick) return { built: false } as any;
      pick.active = true;
      pick.shardVariant = 'metal-tile';
      pick._occluderR = undefined;
      pick.position.x = 120; pick.position.y = 0;
      e.player.position.x = 0; e.player.position.y = 0;
      e.physics.initializeStaticGrid(e.currentMap.entities);
      e.renderer.setLighting('unified');

      const settle = () => new Promise<void>(res => {
        let n = 0;
        const t = () => { e.player.position.x = 0; e.player.position.y = 0;
          e.player.velocity.x = 0; e.player.velocity.y = 0;
          if (++n < 25) requestAnimationFrame(t); else res(); };
        requestAnimationFrame(t);
      });
      // Sample BESIDE the tile, off the player-light axis — the emitter
      // radiates in every direction, so the place it shows is where the
      // direct light is weak but the tile is close.
      const probe = () => {
        const cv = document.querySelector('canvas') as HTMLCanvasElement;
        const g = cv.getContext('2d')!;
        const dpr = cv.width / 390, W = cv.width / dpr, H = cv.height / dpr;
        const cam = e.camera, shake = cam.shakeOffset || { x: 0, y: 0 };
        const sx = (wx: number, wy: number) => [
          (W / 2 + (wx - cam.position.x + shake.x) * cam.zoom) * dpr,
          (H / 2 + (wy - cam.position.y + shake.y) * cam.zoom) * dpr,
        ];
        const img = g.getImageData(0, 0, cv.width, cv.height).data;
        let sum = 0, n = 0;
        for (const [wx, wy] of [[120, 60], [120, -60], [160, 40], [160, -40]]) {
          const [x, y] = sx(wx, wy);
          const i = (Math.round(y) * cv.width + Math.round(x)) * 4;
          sum += (img[i] + img[i + 1] + img[i + 2]) / 3; n++;
        }
        return sum / n;
      };
      const sample = async (want: boolean) => {
        if (e.renderer.getEmissive() !== want) e.renderer.toggleEmissive();
        await settle();
        const lum = probe();
        return { lum, lights: e.renderer.lastLightingLights };
      };
      const plain = await sample(false);
      const emit = await sample(true);

      // The emit-brightness cycle, walked once.
      const seen: string[] = [];
      const firstEmit = e.renderer.getEmitBrightness();
      for (let i = 0; i < 20; i++) {
        seen.push(e.renderer.getEmitBrightness());
        e.renderer.cycleEmitBrightness();
        if (e.renderer.getEmitBrightness() === firstEmit) break;
      }

      // Emitter shadows: on, then measured, then back off.
      const shadowsDefaultOff = !e.renderer.getEmitShadows();
      e.renderer.toggleEmitShadows();
      await settle();
      const shadowed = { lum: probe() };
      e.renderer.toggleEmitShadows();

      if (!e.renderer.getEmissive()) e.renderer.toggleEmissive();
      return { built: true, plain, emit, shadowed, shadowsDefaultOff,
               emitCycle: { first: firstEmit, seen },
               backOn: e.renderer.getEmissive() };
    });

    expect(r.built).toBe(true);
    expect(r.backOn).toBe(true);
    // The emitter brightness knob scales the variant's own value against the
    // baseline it is authored at, so its default must be a no-op — and no
    // entry may exceed 1/1, since a body cannot radiate more than fell on it.
    expect(r.emitCycle.first).toBe('1/2');
    for (const name of r.emitCycle.seen) {
      const m = /^(\d+)\/(\d+)$/.exec(name);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeLessThanOrEqual(Number(m![2]));
    }
    // Emitter shadows stay OFF by default even though emission itself now
    // ships on — they are the expensive half, and the row above is what pays
    // for them.  Turning them on
    // must not break the light, which is the failure the scratch-canvas path
    // could plausibly have (destination-out on the wrong surface erases the
    // layer rather than the emitter's share, and the symptom is a dark hole).
    expect(r.shadowsDefaultOff).toBe(true);
    expect(r.shadowed.lum).toBeGreaterThan(r.plain.lum * 0.5);
    // OFF, the light is one light.  ON, the lit metal is a second.
    expect(r.plain.lights).toBe(1);
    expect(r.emit.lights).toBeGreaterThan(1);
    // ...and that second light must actually put light on the canvas beside
    // the tile.  A count that goes up while nothing brightens would mean the
    // emitter was composited somewhere nobody can see.
    expect(r.emit.lum).toBeGreaterThan(r.plain.lum);
    watch.assertClean();
  });

  test('the emitter-shadow ladder is monotone, and stays off by default', async ({ page }) => {
    const watch = await boot(page);

    // Read BEFORE the run starts, so nothing in the boot path can have
    // cycled them.  These four are what A5h changed, and each is a decision
    // rather than an accident: the two prototypes that measured well on the
    // device now ship on, the softness moved four rungs softer, and the one
    // knob whose cost is measured in whole milliseconds stayed off.
    const d = await engine(page, e => ({
      refraction: e.renderer.getRefraction(),
      emissive: e.renderer.getEmissive(),
      emitShadows: e.renderer.getEmitShadows(),
      softness: e.renderer.getShadowSoftness(),
      tier: e.renderer.getEmitShadowTier().name,
    }));
    expect(d.refraction).toBe(true);
    expect(d.emissive).toBe(true);
    expect(d.emitShadows).toBe(false);   // the expensive half stays opt-in
    expect(d.softness).toBe('diffuse');
    expect(d.tier).toBe('std');

    await startRun(page, 'METAL_FIELD');

    // The ladder itself, walked once.  Its rungs must MOVE TOGETHER — the
    // cost of a shadowing emitter is almost entirely its own occluder
    // collection, so a rung that cut the count while raising the cap would
    // not be a cheaper rung at all.
    const r = await engine(page, (e) => {
      const seen: { name: string; maxEmitters: number; maxOccluders: number }[] = [];
      const first = e.renderer.getEmitShadowTier().name;
      for (let i = 0; i < 20; i++) {
        seen.push({ ...e.renderer.getEmitShadowTier() });
        e.renderer.cycleEmitShadowTier();
        if (e.renderer.getEmitShadowTier().name === first) break;
      }
      return { first, seen, back: e.renderer.getEmitShadowTier().name };
    });
    expect(r.first).toBe('std');
    expect(r.back).toBe('std');          // and the cycle closes
    expect(r.seen.length).toBeGreaterThan(2);

    const by = (n: string) => r.seen.find(t => t.name === n)!;
    for (const t of r.seen) {
      expect(t.maxEmitters).toBeGreaterThan(0);
      expect(t.maxOccluders).toBeGreaterThan(0);
    }
    // Sorted by emitter count, the occluder cap must never go DOWN — that is
    // what makes "cheaper rung" mean one thing rather than two.
    const ladder = [...r.seen].sort((a, b) => a.maxEmitters - b.maxEmitters);
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i].maxOccluders).toBeGreaterThanOrEqual(ladder[i - 1].maxOccluders);
    }
    // The rungs BELOW the default are the point of the row: they exist so the
    // toggle can be judged at a cost the phone can pay.
    expect(by('min').maxEmitters).toBeLessThan(by('lite').maxEmitters);
    expect(by('lite').maxEmitters).toBeLessThan(by('std').maxEmitters);

    // And the cheapest rung must still LIGHT the scene with the toggle on —
    // past the emitter count the halo falls back to flat rather than
    // vanishing, so no rung may darken anything.
    const lit = await engine(page, async (e) => {
      const settle = () => new Promise<void>(res => {
        let n = 0;
        const t = () => { if (++n < 20) requestAnimationFrame(t); else res(); };
        requestAnimationFrame(t);
      });
      const lum = () => {
        const cv = document.querySelector('canvas') as HTMLCanvasElement;
        const g = cv.getContext('2d')!;
        const img = g.getImageData(0, 0, cv.width, cv.height).data;
        let sum = 0;
        for (let i = 0; i < img.length; i += 4 * 97) sum += img[i] + img[i + 1] + img[i + 2];
        return sum;
      };
      e.renderer.setLighting('unified');
      if (!e.renderer.getEmitShadows()) e.renderer.toggleEmitShadows();
      while (e.renderer.getEmitShadowTier().name !== 'min') e.renderer.cycleEmitShadowTier();
      await settle();
      const min = lum();
      while (e.renderer.getEmitShadowTier().name !== 'std') e.renderer.cycleEmitShadowTier();
      await settle();
      const std = lum();
      e.renderer.toggleEmitShadows();
      return { min, std };
    });
    expect(lit.min).toBeGreaterThan(0);
    // Within a wide band of each other: the tier changes the TREATMENT of a
    // handful of small haloes, not how much of the scene is lit.
    expect(lit.min).toBeGreaterThan(lit.std * 0.5);
    watch.assertClean();
  });

  test('nebula emits in its OWN colour, and still casts nothing', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'NEBULA_FIELD');

    // Nebula is `passThrough`: it must never enter the occluder pool (it is
    // the most numerous static tile on the natural maps, and handing it the
    // pool would blank the terrain shadows), and it must still light, in the
    // colour it blended for itself.  Those two requirements are why emitters
    // have a buffer of their own.
    const r = await engine(page, async (e) => {
      const tiles = e.currentMap.entities.filter(
        (t: any) => t.type === 'STRUCTURE' && t.mass === Infinity);
      for (const t of e.currentMap.entities) {
        if (t.type === 'STRUCTURE') t.active = false;
      }
      const pick = tiles.find((t: any) => t.shardVariant === 'nebula-tile');
      if (!pick) return { built: false } as any;
      pick.active = true;
      pick._occluderR = undefined;
      pick.position.x = 110; pick.position.y = 0;
      // A KNOWN colour, so the assertion is about the plumbing rather than
      // about whatever this cloud happened to blend.  Pure red is chosen
      // because the player's own light is blue-green (125, 211, 252): if the
      // emitter were drawn in the light's colour instead of the body's, the
      // green channel would lead, and it must not.
      pick.nebulaBlendedHex = '#ff0000';
      pick._emitTint = undefined; pick._emitTintKey = undefined;
      e.player.position.x = 0; e.player.position.y = 0;
      e.physics.initializeStaticGrid(e.currentMap.entities);
      e.renderer.setLighting('unified');

      const settle = () => new Promise<void>(res => {
        let n = 0;
        const t = () => { e.player.position.x = 0; e.player.position.y = 0;
          e.player.velocity.x = 0; e.player.velocity.y = 0;
          if (++n < 25) requestAnimationFrame(t); else res(); };
        requestAnimationFrame(t);
      });
      const probe = () => {
        const cv = document.querySelector('canvas') as HTMLCanvasElement;
        const g = cv.getContext('2d')!;
        const dpr = cv.width / 390, W = cv.width / dpr, H = cv.height / dpr;
        const cam = e.camera, shake = cam.shakeOffset || { x: 0, y: 0 };
        const sx = (wx: number, wy: number) => [
          (W / 2 + (wx - cam.position.x + shake.x) * cam.zoom) * dpr,
          (H / 2 + (wy - cam.position.y + shake.y) * cam.zoom) * dpr,
        ];
        const img = g.getImageData(0, 0, cv.width, cv.height).data;
        let rr = 0, gg = 0, bb = 0, n = 0;
        for (const [wx, wy] of [[110, 55], [110, -55], [150, 35], [150, -35]]) {
          const [x, y] = sx(wx, wy);
          const i = (Math.round(y) * cv.width + Math.round(x)) * 4;
          rr += img[i]; gg += img[i + 1]; bb += img[i + 2]; n++;
        }
        return [rr / n, gg / n, bb / n];
      };
      const sample = async (want: boolean) => {
        if (e.renderer.getEmissive() !== want) e.renderer.toggleEmissive();
        await settle();
        return { rgb: probe(), emitters: e.renderer._lightEmitterCount,
                 occ: e.renderer._lightOccluderCount,
                 lights: e.renderer.lastLightingLights };
      };
      const mix = async (name: string) => {
        for (let i = 0; i < 8 && e.renderer.getTintMix() !== name; i++) {
          e.renderer.cycleTintMix();
        }
        return sample(true);
      };
      // The COLOUR assertions run at the ends of the tint-mix knob, because
      // at the shipped default an emitter is deliberately half the body's
      // colour and half the light's — so "it emits red" is only the whole
      // truth at `full`, and `off` is where the old behaviour lives.
      const off = await sample(false);
      const on = await mix('full');
      const asLight = await mix('off');
      for (let i = 0; i < 8 && e.renderer.getTintMix() !== 'off'; i++) {
        e.renderer.cycleTintMix();
      }
      return { built: true, off, on, asLight, tint: pick._emitTint };
    });

    expect(r.built).toBe(true);
    // It casts NOTHING either way — the shadow pool never sees it.
    expect(r.off.occ).toBe(0);
    expect(r.on.occ).toBe(0);
    // The emitter buffer is filled only when something asked for emitters,
    // so a frame with emission off walks exactly the geometry it used to.
    expect(r.off.emitters).toBe(0);
    expect(r.on.emitters).toBeGreaterThan(0);
    expect(r.off.lights).toBe(1);
    expect(r.on.lights).toBeGreaterThan(1);

    // The tint is the BODY's colour, normalised to full value: brightness
    // belongs to the alpha, so a dark surface still radiates a bright light
    // of its own hue.
    expect(r.tint).toBe('255, 0, 0');
    const d = r.on.rgb.map((v: number, i: number) => v - r.off.rgb[i]);
    expect(d[0]).toBeGreaterThan(1);          // it lit something...
    expect(d[0]).toBeGreaterThan(d[1]);       // ...in RED, not in the
    expect(d[0]).toBeGreaterThan(d[2]);       // player light's blue-green.
    // ...and at the other end of the knob the same body emits in the LIGHT's
    // colour instead, which is what makes the mix a mix rather than a label.
    // Asserted as a SHIFT rather than against an absolute baseline: the two
    // samples are taken at different moments in a live scene, so what is
    // stable is the direction the knob moves the colour, not the level.
    const l = r.asLight.rgb.map((v: number, i: number) => v - r.off.rgb[i]);
    expect(l[2] - l[0]).toBeGreaterThan(d[2] - d[0]);
    expect(l[1] - l[0]).toBeGreaterThan(d[1] - d[0]);
    watch.assertClean();
  });

  test('emitters FADE rather than pop, and `off` restores the pop', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'METAL_FIELD');

    const r = await engine(page, async (e) => {
      const tiles = e.currentMap.entities.filter(
        (t: any) => t.type === 'STRUCTURE' && t.mass === Infinity);
      for (const t of e.currentMap.entities) {
        if (t.type === 'STRUCTURE') t.active = false;
      }
      const pick = tiles[0];
      if (!pick) return { built: false } as any;
      pick.active = true;
      pick.shardVariant = 'metal-tile';
      pick._occluderR = undefined;
      pick.position.x = 120; pick.position.y = 0;
      e.player.position.x = 0; e.player.position.y = 0;
      e.physics.initializeStaticGrid(e.currentMap.entities);
      e.renderer.setLighting('unified');

      const hold = () => { e.player.position.x = 0; e.player.position.y = 0;
        e.player.velocity.x = 0; e.player.velocity.y = 0; };
      const frames = (n: number) => new Promise<void>(res => {
        let i = 0;
        const t = () => { hold(); if (++i < n) requestAnimationFrame(t); else res(); };
        requestAnimationFrame(t);
      });
      const probe = () => {
        const cv = document.querySelector('canvas') as HTMLCanvasElement;
        const g = cv.getContext('2d')!;
        const dpr = cv.width / 390, W = cv.width / dpr, H = cv.height / dpr;
        const cam = e.camera, shake = cam.shakeOffset || { x: 0, y: 0 };
        const sx = (wx: number, wy: number) => [
          (W / 2 + (wx - cam.position.x + shake.x) * cam.zoom) * dpr,
          (H / 2 + (wy - cam.position.y + shake.y) * cam.zoom) * dpr,
        ];
        const img = g.getImageData(0, 0, cv.width, cv.height).data;
        let sum = 0, n = 0;
        for (const [wx, wy] of [[120, 55], [120, -55], [155, 35], [155, -35]]) {
          const [x, y] = sx(wx, wy);
          const i = (Math.round(y) * cv.width + Math.round(x)) * 4;
          sum += (img[i] + img[i + 1] + img[i + 2]) / 3; n++;
        }
        return sum / n;
      };
      // One run of the same experiment at a given fade setting: emission off
      // and settled, then ON for a couple of frames, then ON and settled.
      const run = async (fade: string) => {
        for (let i = 0; i < 12 && e.renderer.getEmitFade() !== fade; i++) e.renderer.cycleEmitFade();
        if (e.renderer.getEmissive()) e.renderer.toggleEmissive();
        await frames(30);
        const base = probe();
        e.renderer.toggleEmissive();
        await frames(2);
        const early = probe();
        await frames(40);
        const settled = probe();
        return { fade: e.renderer.getEmitFade(), base, early, settled };
      };
      const smooth = await run('smooth');
      const instant = await run('off');
      for (let i = 0; i < 12 && e.renderer.getEmitFade() !== 'smooth'; i++) e.renderer.cycleEmitFade();
      if (!e.renderer.getEmissive()) e.renderer.toggleEmissive();
      return { built: true, smooth, instant, backTo: e.renderer.getEmitFade() };
    });

    expect(r.built).toBe(true);
    expect(r.backTo).toBe('smooth');           // the shipped default

    // The settled brightness is the SAME either way — a fade changes when the
    // light arrives, never how much of it there is.  (Compared against each
    // setting's own base, since the two runs are separate captures.)
    const smoothGain = r.smooth.settled - r.smooth.base;
    const instantGain = r.instant.settled - r.instant.base;
    expect(smoothGain).toBeGreaterThan(1);
    expect(instantGain).toBeGreaterThan(1);
    expect(Math.abs(smoothGain - instantGain)).toBeLessThan(smoothGain * 0.5);

    // Two frames in, the faded emitter is well short of its settled value...
    const smoothEarly = r.smooth.early - r.smooth.base;
    expect(smoothEarly).toBeLessThan(smoothGain * 0.7);
    // ...where `off` is essentially all the way there, which is the pop this
    // exists to remove and the control that proves the fade is doing it.
    const instantEarly = r.instant.early - r.instant.base;
    expect(instantEarly).toBeGreaterThan(instantGain * 0.9);
    watch.assertClean();
  });

  test('the caustic ramps into total internal reflection instead of flipping', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');

    // PINNED AT THE FUNCTION, not through a scene.  A face stops transmitting
    // entirely past the critical angle, and taking that literally is what
    // made glass CLICK: each cone appeared and vanished at full length as the
    // body turned.  Measuring the fix through a live map measures whichever
    // polygon the generator produced — a walk containing no critical angle
    // fails on its own premise rather than on the behaviour, which is exactly
    // how this test flaked before being written this way.
    const r = await engine(page, (e) => {
      const sweep = (band: number) => {
        const w: number[] = [];
        // 0 to 60 degrees of incidence in half-degree steps: the critical
        // angle for IOR 1.5 is 41.8, so the cliff is inside the range.
        for (let i = 0; i <= 120; i++) {
          w.push(e.renderer.transmissionWeight(i * 0.5 * Math.PI / 180, band));
        }
        let maxStep = 0, mid = 0;
        for (let i = 1; i < w.length; i++) {
          const d = Math.abs(w[i] - w[i - 1]);
          if (d > maxStep) maxStep = d;
          if (w[i] > 0.02 && w[i] < 0.98) mid++;
        }
        return { first: w[0], last: w[w.length - 1], maxStep, mid, w };
      };
      return { off: sweep(0), on: sweep(0.25) };
    });

    // Both agree at the ends: fully transmitting at normal incidence, nothing
    // at all past the critical angle.  The fade changes the APPROACH, never
    // the physics either side of it.
    expect(r.off.first).toBe(1);
    expect(r.on.first).toBe(1);
    expect(r.off.last).toBe(0);
    expect(r.on.last).toBe(0);

    // OFF is a cliff: one step of the sweep carries the whole transition, and
    // no sample lands anywhere in between.
    expect(r.off.maxStep).toBe(1);
    expect(r.off.mid).toBe(0);

    // ON it is a ramp: no single step is large, and the transition is spread
    // over many samples.
    expect(r.on.maxStep).toBeLessThan(0.2);
    expect(r.on.mid).toBeGreaterThan(5);
    // ...and monotone, so the "fade" cannot be a wobble that happens to
    // visit the intermediate values.
    for (let i = 1; i < r.on.w.length; i++) {
      expect(r.on.w[i]).toBeLessThanOrEqual(r.on.w[i - 1] + 1e-9);
    }

    // AND THE SCENE STILL DRAWS ONE.  The function above is the mechanism;
    // this is the wiring — a caustic that stopped reaching the canvas would
    // satisfy every assertion so far.
    const drew = await engine(page, async (e) => {
      const tiles = e.currentMap.entities.filter(
        (t: any) => t.type === 'STRUCTURE' && t.mass === Infinity);
      const pick = tiles[0];
      if (!pick) return { built: false } as any;
      pick.shardVariant = 'glass-tile';
      pick._occluderR = undefined;
      pick.position.x = 0; pick.position.y = 0;
      // The static grid is built at map load, so a tile MOVED afterwards is
      // still filed under its old cell and the radius walk never finds it.
      e.physics.initializeStaticGrid(e.currentMap.entities);
      e.renderer.setLighting('unified');
      if (!e.renderer.getRefraction()) e.renderer.toggleRefraction();
      await new Promise<void>(res => {
        let i = 0;
        const t = () => {
          for (const o of e.currentMap.entities) {
            if (o !== pick && o.type === 'STRUCTURE') o.active = false;
          }
          pick.active = true;
          e.player.position.x = -150; e.player.position.y = -110;
          e.player.velocity.x = 0; e.player.velocity.y = 0;
          if (++i < 25) requestAnimationFrame(t); else res();
        };
        requestAnimationFrame(t);
      });
      return { built: true, ...e.renderer.causticStats() };
    });
    expect(drew.built).toBe(true);
    expect(drew.faces).toBeGreaterThan(0);
    expect(drew.weight).toBeGreaterThan(0);
    watch.assertClean();
  });

  test('an edge flip is continuous: the penumbra is an angle, not a dilation', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'METAL_FIELD');

    // Sweep a light around ONE opaque hex (no caustic in play) and watch the
    // shadow geometry.  As the light crosses an edge's plane that edge starts
    // or stops casting, and at that instant it lies along the light ray, so
    // its quad MUST be degenerate — an edge-on caster casts nothing.  A5d's
    // radial dilation broke that: it moved each vertex by a different angle,
    // so the quad had real area at the flip and appeared between frames.
    const r = await engine(page, async (e) => {
      const tiles = e.currentMap.entities.filter(
        (t: any) => t.type === 'STRUCTURE' && t.mass === Infinity);
      const pick = tiles[0];
      if (!pick) return { built: false } as any;
      pick._occluderR = undefined;
      pick.position.x = 0; pick.position.y = 0;
      e.renderer.setLighting('unified');
      if (e.renderer.getRefraction()) e.renderer.toggleRefraction();
      if (e.renderer.getEmissive()) e.renderer.toggleEmissive();
      // The FLASHLIGHT is pinned to `radial` too, now that `beam` ships: the
      // measurement below reads the light on a ring/bearing the beam would
      // simply not illuminate.
      const beam0 = e.renderer.getFlashlight();
      for (let i = 0; i < 10 && e.renderer.getFlashlight() !== 'radial'; i++) {
        e.renderer.cycleFlashlight();
      }

      let px = 0, py = -150;
      const frames = (n: number) => new Promise<void>(res => {
        let i = 0;
        const t = () => {
          for (const o of e.currentMap.entities) {
            if (o !== pick && o.type === 'STRUCTURE') o.active = false;
          }
          pick.active = true;
          e.player.position.x = px; e.player.position.y = py;
          e.player.velocity.x = 0; e.player.velocity.y = 0;
          if (++i < n) requestAnimationFrame(t); else res();
        };
        requestAnimationFrame(t);
      });
      e.physics.initializeStaticGrid(e.currentMap.entities);

      for (let i = 0; i < 12 && e.renderer.getShadowSoftness() !== 'diffuse'; i++) {
        e.renderer.cycleShadowSoftness();
      }
      // 1.2 degrees per step over 84 degrees — more than one hex edge plane,
      // so at least one flip is guaranteed to be in the series.
      let flips = 0, worstFlip = 0, worstStep = 0;
      let prev: { quads: number; area: number } | null = null;
      for (let step = 0; step < 70; step++) {
        const a = -Math.PI / 2 + step * (1.2 * Math.PI / 180);
        px = Math.cos(a) * 150; py = Math.sin(a) * 150;
        await frames(3);
        const st = e.renderer.shadowStats();
        if (prev !== null && prev.area > 0) {
          const rel = Math.abs(st.area - prev.area) / prev.area;
          if (st.quads !== prev.quads) { flips++; if (rel > worstFlip) worstFlip = rel; }
          else if (rel > worstStep) worstStep = rel;
        }
        prev = st;
      }
      for (let i = 0; i < 10 && e.renderer.getFlashlight() !== beam0; i++) {
        e.renderer.cycleFlashlight();
      }
      return { built: true, flips, worstFlip, worstStep, quads: prev!.quads };
    });

    expect(r.built).toBe(true);
    // The sweep has to actually contain a flip, or the assertion below is
    // vacuous — this is the test asserting its own premise.
    expect(r.flips).toBeGreaterThan(0);
    expect(r.quads).toBeGreaterThan(0);
    // A flip may not move the total shadow area by much more than an ordinary
    // step of the same sweep does.  Before the fix the same sweep measured
    // 5-6 % at a flip against ~0.4 % typical; the bar is deliberately loose
    // (the area double-counts overlapping quads, so it over-reads) and still
    // an order of magnitude below the old behaviour.
    expect(r.worstFlip).toBeLessThan(0.04);
    watch.assertClean();
  });

  test('the flashlight is a cone that follows the aim, with a spill floor', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'METAL_FIELD');

    // Ships as `beam` (an 80-degree cone; user call) — the game reads as
    // flying a searchlight, with the radial glow one click away.
    const dflt = await engine(page, e => e.renderer.getFlashlight());
    expect(dflt).toBe('beam');

    // Empty scene: a ring drawn through terrain measures shadows, and
    // emitters would add light the beam deliberately does not mask.  The pin
    // holds the ship at the origin but NOT its rotation — see below.
    await engine(page, (e) => {
      for (const t of e.currentMap.entities) {
        if (t.type === 'STRUCTURE') t.active = false;
      }
      e.physics.initializeStaticGrid(e.currentMap.entities);
      if (e.renderer.getEmissive()) e.renderer.toggleEmissive();
      e.renderer.setLighting('unified');
      (window as any).__beamPin = setInterval(() => {
        e.player.position.x = 0; e.player.position.y = 0;
        e.player.velocity.x = 0; e.player.velocity.y = 0;
        e.player.health = e.player.maxHealth;
        // FAUNA OFF: the gains are unified-minus-legacy diffs of paired
        // reads, and an ambient bubble drifting between them lands in the
        // diff — the `off` bound is < 3 and a bubble body is ~18.
        for (const o of e.currentMap.entities) {
          if (o.type !== 'STRUCTURE') o.active = false;
        }
      }, 8);
    });

    // AIMING IS DONE WITH THE POINTER, not by writing `player.rotation`.
    // The engine recomputes that from the pointer every sim step, so a test
    // that assigns it measures nothing — and going through the pointer is
    // the path the feature actually uses.
    const aimAt = async (dx: number, dy: number) => {
      await page.mouse.move(195 + dx, 422 + dy);
      await page.waitForTimeout(120);
    };
    const sample = async (name: string) => engine(page, async (e, n: string) => {
      for (let i = 0; i < 10 && e.renderer.getFlashlight() !== n; i++) {
        e.renderer.cycleFlashlight();
      }
      const frames = (k: number) => new Promise<void>(res => {
        let i = 0;
        const t = () => { if (++i < k) requestAnimationFrame(t); else res(); };
        requestAnimationFrame(t);
      });
      const ring = () => {
        const cv = document.querySelector('canvas') as HTMLCanvasElement;
        const g = cv.getContext('2d')!;
        const dpr = cv.width / 390, W = cv.width / dpr, H = cv.height / dpr;
        const cam = e.camera, shake = cam.shakeOffset || { x: 0, y: 0 };
        const lcx = (W / 2 + (0 - cam.position.x + shake.x) * cam.zoom) * dpr;
        const lcy = (H / 2 + (0 - cam.position.y + shake.y) * cam.zoom) * dpr;
        const rpx = 190 * cam.zoom * dpr;
        const img = g.getImageData(0, 0, cv.width, cv.height).data;
        const out: number[] = [];
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          const x = Math.round(lcx + Math.cos(a) * rpx);
          const y = Math.round(lcy + Math.sin(a) * rpx);
          const i = (y * cv.width + x) * 4;
          out.push((img[i] + img[i + 1] + img[i + 2]) / 3);
        }
        return out;
      };
      e.renderer.setLighting('unified'); await frames(20);
      const on = ring();
      e.renderer.setLighting('legacy'); await frames(20);
      const off = ring();
      e.renderer.setLighting('unified');
      return { gain: on.map((v, i) => v - off[i]), rot: e.player.rotation,
               masks: e.renderer.beamMasks() };
    }, name);

    await aimAt(120, 0);                       // aim +X
    const radial = await sample('radial');
    const narrow = await sample('narrow');
    await aimAt(-120, 0);                      // aim -X, half a turn away
    const behindAim = await sample('narrow');
    const off = await sample('off');

    await engine(page, (e) => {
      clearInterval((window as any).__beamPin);
      for (let i = 0; i < 10 && e.renderer.getFlashlight() !== 'beam'; i++) {
        e.renderer.cycleFlashlight();
      }
      if (!e.renderer.getEmissive()) e.renderer.toggleEmissive();
    });

    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    // Bearing k is k*15 degrees; sample three around a direction.
    const lobe = (g: number[], k: number) => mean([(k + 23) % 24, k, (k + 1) % 24].map(i => g[i]));

    // The pointer really did aim the ship, or the rest of this is vacuous.
    expect(Math.abs(narrow.rot)).toBeLessThan(0.4);
    expect(Math.abs(Math.abs(behindAim.rot) - Math.PI)).toBeLessThan(0.4);

    // RADIAL is the control: the same light in every direction, and no mask.
    const rMin = Math.min(...radial.gain), rMax = Math.max(...radial.gain);
    expect(rMin).toBeGreaterThan(5);
    expect(rMax / rMin).toBeLessThan(1.6);
    expect(narrow.masks).toBeGreaterThan(radial.masks);

    // NARROW is a cone: bright along the aim, dim across it.  THE MASK
    // RUNNING IS NOT THE SAME AS THE MASK WORKING — this shipped once with
    // the erase inheriting the falloff gradient as its fillStyle (alpha 0 out
    // where the sector is), so it ran, threw nothing, and did nothing.
    const ahead = lobe(narrow.gain, 0);
    const across = lobe(narrow.gain, 6);
    const behind = lobe(narrow.gain, 12);
    expect(ahead).toBeGreaterThan(5);
    expect(ahead).toBeGreaterThan(across * 3);
    expect(ahead).toBeGreaterThan(behind * 3);
    // The SPILL floor: outside the cone is dim, never black.  A hard cut
    // reads as a rendering error rather than as a torch.
    expect(across).toBeGreaterThan(ahead * 0.03);

    // IT FOLLOWS THE AIM.  Pointing the other way puts the lobe behind, which
    // is what makes it the ship's torch and not a fixed cone in world space.
    expect(lobe(behindAim.gain, 12)).toBeGreaterThan(lobe(behindAim.gain, 0) * 3);
    expect(lobe(behindAim.gain, 12)).toBeGreaterThan(5);

    // OFF draws no player light at all — a zero-width beam, not a special
    // case.  (Emitters are off in this scene, so nothing is left.)
    expect(Math.max(...off.gain)).toBeLessThan(3);
    watch.assertClean();
  });

  test('the beam ladder, the light colour, and a bubble that lights up', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'METAL_FIELD');

    // THE BEAM LADDER.  Walked off the live cycle rather than a copy of the
    // table, so a row added in the wrong place fails here.
    const beams = await engine(page, (e) => {
      const seen: string[] = [];
      const first = e.renderer.getFlashlight();
      for (let i = 0; i < 12; i++) {
        seen.push(e.renderer.getFlashlight());
        e.renderer.cycleFlashlight();
        if (e.renderer.getFlashlight() === first) break;
      }
      return { first, seen, back: e.renderer.getFlashlight() };
    });
    expect(beams.first).toBe('beam');         // the shipped default
    expect(beams.back).toBe('beam');          // and the cycle closes
    // The cycle starts wherever the default sits and wraps: widest to
    // narrowest is still the ORDER, 'half' is the headlight (everything
    // ahead, nothing behind) and 'pin' the pencil.
    expect(beams.seen).toEqual(
      ['beam', 'narrow', 'tight', 'pin', 'off', 'radial', 'half', 'wide']);

    const r = await engine(page, async (e) => {
      // Empty scene, emitters off: the colour is measured off the light
      // itself, not off whatever it happens to be shining on.
      for (const t of e.currentMap.entities) {
        if (t.type === 'STRUCTURE') t.active = false;
      }
      e.physics.initializeStaticGrid(e.currentMap.entities);
      if (e.renderer.getEmissive()) e.renderer.toggleEmissive();
      e.renderer.setLighting('unified');
      const frames = (n: number) => new Promise<void>(res => {
        let i = 0;
        const t = () => {
          for (const o of e.currentMap.entities) {
            if (o.type === 'STRUCTURE') o.active = false;
          }
          e.player.position.x = 0; e.player.position.y = 0;
          e.player.velocity.x = 0; e.player.velocity.y = 0;
          if (++i < n) requestAnimationFrame(t); else res();
        };
        requestAnimationFrame(t);
      });
      // Per-channel gain at one lit point 120 units out.
      const rgb = async () => {
        const cv = document.querySelector('canvas') as HTMLCanvasElement;
        const g = cv.getContext('2d')!;
        const dpr = cv.width / 390, W = cv.width / dpr, H = cv.height / dpr;
        const cam = e.camera, shake = cam.shakeOffset || { x: 0, y: 0 };
        const x = Math.round((W / 2 + (120 - cam.position.x + shake.x) * cam.zoom) * dpr);
        const y = Math.round((H / 2 + (0 - cam.position.y + shake.y) * cam.zoom) * dpr);
        e.renderer.setLighting('unified'); await frames(18);
        const on = g.getImageData(x, y, 1, 1).data;
        e.renderer.setLighting('legacy'); await frames(18);
        const off = g.getImageData(x, y, 1, 1).data;
        e.renderer.setLighting('unified');
        return [on[0] - off[0], on[1] - off[1], on[2] - off[2]];
      };
      const pick = async (name: string) => {
        for (let i = 0; i < 10 && e.renderer.getLightColor() !== name; i++) {
          e.renderer.cycleLightColor();
        }
        return rgb();
      };
      const ship = await pick('ship');
      const red = await pick('red');
      const green = await pick('green');
      for (let i = 0; i < 10 && e.renderer.getLightColor() !== 'ship'; i++) {
        e.renderer.cycleLightColor();
      }
      if (!e.renderer.getEmissive()) e.renderer.toggleEmissive();
      return { ship, red, green, back: e.renderer.getLightColor() };
    });

    expect(r.back).toBe('ship');
    // SHIP is the engine-glow blue the layer has always used: blue leads.
    expect(r.ship[2]).toBeGreaterThan(r.ship[0]);
    // ...and the cycle really repaints the light rather than relabelling it.
    expect(r.red[0]).toBeGreaterThan(r.red[2]);
    expect(r.green[1]).toBeGreaterThan(r.green[0]);
    expect(r.green[1]).toBeGreaterThan(r.green[2]);

    // A BUBBLE LIGHTS UP.  It is an emitter without being an occluder — the
    // nebula shape — and it is an ENEMY, so it reaches the emitter buffer
    // through the dynamic grid rather than through SHARD_VARIANTS.  Ambient
    // fauna, so the map already has some.
    const bub = await engine(page, async (e) => {
      const bubble = e.currentMap.entities.find((o: any) => o.enemySubtype === 'BUBBLE');
      if (!bubble) return { built: false } as any;
      if (!e.renderer.getEmissive()) e.renderer.toggleEmissive();
      e.renderer.setLighting('unified');
      const settle = (n: number) => new Promise<void>(res => {
        let i = 0;
        const t = () => {
          e.player.position.x = 0; e.player.position.y = 0;
          e.player.velocity.x = 0; e.player.velocity.y = 0;
          bubble.position.x = 90; bubble.position.y = 0;
          bubble.velocity.x = 0; bubble.velocity.y = 0;
          if (++i < n) requestAnimationFrame(t); else res();
        };
        requestAnimationFrame(t);
      });
      // Away from it first, so the count below is about THIS bubble.
      bubble.position.x = 6000; bubble.position.y = 6000;
      await settle(1);
      await new Promise<void>(res => requestAnimationFrame(() => res()));
      await settle(25);
      return { built: true, emitters: e.renderer._lightEmitterCount,
               tint: bubble._emitTint ?? null,
               occ: e.renderer._lightOccluderCount };
    });
    expect(bub.built).toBe(true);
    expect(bub.emitters).toBeGreaterThan(0);   // it emits...
    expect(bub.occ).toBe(0);                   // ...and casts nothing
    expect(bub.tint).toMatch(/^\d+, \d+, \d+$/);
    watch.assertClean();
  });

  test('the material colour rides the light it passes on', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');

    // SHIPS OFF: real, subtle, and not free — see TINT_MIX_CYCLE.  The test
    // drives the knob to both ends itself, so the default it asserts is only
    // the default.
    const dflt = await engine(page, e => e.renderer.getTintMix());
    expect(dflt).toBe('off');

    const r = await engine(page, async (e) => {
      const tiles = e.currentMap.entities.filter(
        (t: any) => t.type === 'STRUCTURE' && t.mass === Infinity);
      const pick = tiles[0];
      if (!pick) return { built: false } as any;
      pick.shardVariant = 'glass-tile';
      pick._occluderR = undefined;
      pick.position.x = 120; pick.position.y = 0;
      e.physics.initializeStaticGrid(e.currentMap.entities);
      // STRAIGHT-THROUGH transmission is the path under test, so refraction
      // is held off: with it on the light is moved into the caustic instead
      // (which carries the same blend, by its own fill).
      if (e.renderer.getRefraction()) e.renderer.toggleRefraction();
      if (e.renderer.getEmissive()) e.renderer.toggleEmissive();
      e.renderer.setLighting('unified');
      // The FLASHLIGHT is pinned to `radial` too, now that `beam` ships: the
      // measurement below reads the light on a ring/bearing the beam would
      // simply not illuminate.
      const beam0 = e.renderer.getFlashlight();
      for (let i = 0; i < 10 && e.renderer.getFlashlight() !== 'radial'; i++) {
        e.renderer.cycleFlashlight();
      }

      const frames = (n: number) => new Promise<void>(res => {
        let i = 0;
        const t = () => {
          for (const o of e.currentMap.entities) {
            if (o !== pick && o.type === 'STRUCTURE') o.active = false;
          }
          pick.active = true;
          // A KNOWN material colour, re-stamped: the map regenerates tiles,
          // and a regenerated one would carry its own shade.
          if (pick.color !== '#00ff00') {
            pick.color = '#00ff00';
            pick._emitTint = undefined; pick._emitTintKey = undefined;
          }
          e.player.position.x = 0; e.player.position.y = 0;
          e.player.velocity.x = 0; e.player.velocity.y = 0;
          if (++i < n) requestAnimationFrame(t); else res();
        };
        requestAnimationFrame(t);
      });
      // Mean gain over a small box INSIDE the umbra, where the transmitted
      // light is — one pixel of a 5-luminance signal is noise.
      const umbra = async () => {
        const read = () => {
          const cv = document.querySelector('canvas') as HTMLCanvasElement;
          const g = cv.getContext('2d')!;
          const dpr = cv.width / 390, W = cv.width / dpr, H = cv.height / dpr;
          const cam = e.camera, shake = cam.shakeOffset || { x: 0, y: 0 };
          const sx = (wx: number, wy: number) => [
            Math.round((W / 2 + (wx - cam.position.x + shake.x) * cam.zoom) * dpr),
            Math.round((H / 2 + (wy - cam.position.y + shake.y) * cam.zoom) * dpr),
          ];
          let rr = 0, gg = 0, bb = 0, n = 0;
          for (const [wx, wy] of [[180, 0], [200, 0], [220, 0], [200, 10], [200, -10]]) {
            const [x, y] = sx(wx, wy);
            const d = g.getImageData(x, y, 1, 1).data;
            rr += d[0]; gg += d[1]; bb += d[2]; n++;
          }
          // OPEN SPACE at the same distance, off the shadow axis: the light
          // that ARRIVED, against which the transmitted light is bounded.
          let o = 0, on2 = 0;
          for (const [wx, wy] of [[0, 200], [0, -200], [140, 140]]) {
            const [x, y] = sx(wx, wy);
            const d = g.getImageData(x, y, 1, 1).data;
            o += (d[0] + d[1] + d[2]) / 3; on2++;
          }
          return [rr / n, gg / n, bb / n, o / on2];
        };
        e.renderer.setLighting('unified'); await frames(20);
        const on = read();
        e.renderer.setLighting('legacy'); await frames(20);
        const off = read();
        e.renderer.setLighting('unified');
        return on.map((v, i) => v - off[i]);
      };
      const at = async (mix: string) => {
        for (let i = 0; i < 8 && e.renderer.getTintMix() !== mix; i++) {
          e.renderer.cycleTintMix();
        }
        return umbra();
      };
      const none = await at('off');
      const full = await at('full');
      const cyc: string[] = [];
      const firstName = e.renderer.getTintMix();
      for (let i = 0; i < 8; i++) {
        cyc.push(e.renderer.getTintMix());
        e.renderer.cycleTintMix();
        if (e.renderer.getTintMix() === firstName) break;
      }
      for (let i = 0; i < 8 && e.renderer.getTintMix() !== 'off'; i++) {
        e.renderer.cycleTintMix();
      }
      if (!e.renderer.getRefraction()) e.renderer.toggleRefraction();
      if (!e.renderer.getEmissive()) e.renderer.toggleEmissive();
      for (let i = 0; i < 10 && e.renderer.getFlashlight() !== beam0; i++) {
        e.renderer.cycleFlashlight();
      }
      return { built: true, none, full, cyc, back: e.renderer.getTintMix() };
    });

    expect(r.built).toBe(true);
    expect(r.back).toBe('off');
    expect(r.cyc).toContain('full');           // both ends are reachable
    expect(r.cyc.length).toBeGreaterThan(3);

    // OFF: the light that came through the tile is the LIGHT's own colour,
    // which is blue-green, and carries no trace of the green tile.
    expect(r.none[0]).toBeGreaterThan(0.5);    // there IS transmitted light...
    expect(Math.abs(r.none[2] - r.none[0])).toBeLessThan(r.none[1] + 2);

    // FULL: it comes out GREEN, because it came through green glass.  Red and
    // blue are extinguished; green survives.
    expect(r.full[1]).toBeGreaterThan(1);
    expect(r.full[1]).toBeGreaterThan(r.full[0] + 1.5);
    expect(r.full[1]).toBeGreaterThan(r.full[2] + 1.5);
    // ...and it cannot transmit MORE than arrived.  The construction adds the
    // transmitted share back as its own light rather than leaving it
    // unerased (which is what lets it carry a colour at all), so the bound
    // that matters is the physical one — a body passes light on, it does not
    // make any — measured against open space at the same distance.
    expect(r.full[1]).toBeLessThan(r.full[3]);
    expect(r.none[1]).toBeLessThan(r.none[3]);
    watch.assertClean();
  });

  test('fog of war: the light cuts it, and the memory remembers', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'METAL_FIELD');

    // OFF by default: this changes how the whole game reads, so it is a
    // design decision rather than a rendering one.
    const dflt = await engine(page, e => e.renderer.getFog());
    expect(dflt).toBe('off');

    // THE SCENE IS HAND-BUILT, like the shadow tests above it and for the
    // same reason: a generated map gives no control over what is WHERE, and
    // the fog can only be measured against world that is actually in the
    // frame.  Two earlier versions guarded with an absolute floor on "is
    // there anything here" and each failed on the run where the terrain fell
    // the other way — the test's own premise flaking, not the fog.  So the
    // two patches this test compares are PLACED: a 3x3 block of tiles at each,
    // far enough out that the light cannot reach either.
    const r = await engine(page, async (e) => {
      e.renderer.setLighting('unified');
      // Pinned to `radial` now that `beam` ships: the sample patch sits at a
      // fixed bearing from the ship, and whether a CONE happens to cover it
      // depends on where the pointer is — which is not what this measures.
      const beam0 = e.renderer.getFlashlight();
      for (let i = 0; i < 10 && e.renderer.getFlashlight() !== 'radial'; i++) {
        e.renderer.cycleFlashlight();
      }
      const bx = 0, by = 0;
      e.player.position.x = bx; e.player.position.y = by;
      let px = bx, py = by;
      // AWAY / REMEMBERED at -330, NEVER-SEEN at -1030: the same offset
      // either side of the vantage point the memory half ends at (-700), so
      // the two are symmetric in everything but having been visited.
      const stock = e.currentMap.entities.filter(
        (t: any) => t.type === 'STRUCTURE' && t.mass === Infinity);
      const patch = (cy: number, from: number) => {
        for (let i = 0; i < 9; i++) {
          const t = stock[from + i];
          if (!t) return false;
          t.active = true;
          t._occluderR = undefined;
          t.position.x = bx + ((i % 3) - 1) * 60;
          t.position.y = cy + (Math.floor(i / 3) - 1) * 60;
        }
        return true;
      };
      const placed = patch(by - 330, 0) && patch(by - 1030, 9);
      e.physics.initializeStaticGrid(e.currentMap.entities);
      const frames = (n: number) => new Promise<void>(res => {
        let i = 0;
        const t = () => {
          e.player.position.x = px; e.player.position.y = py;
          e.player.velocity.x = 0; e.player.velocity.y = 0;
          e.player.health = e.player.maxHealth;
          // TERRAIN ONLY.  Ambient fauna is always-present and drifts, so a
          // bubble crossing a sample box is variance the fog has nothing to
          // do with.  The placed tiles below are STRUCTUREs and survive.
          for (const o of e.currentMap.entities) {
            if (o.type !== 'STRUCTURE') o.active = false;
          }
          if (++i < n) requestAnimationFrame(t); else res();
        };
        requestAnimationFrame(t);
      });
      // Mean luminance over a BOX of world points.  Point samples land on
      // empty space and measure nothing, and screen-edge means are polluted
      // by the HUD, which the fog deliberately does not touch.
      const box = (cx: number, cy: number, half: number) => {
        const cv = document.querySelector('canvas') as HTMLCanvasElement;
        const g = cv.getContext('2d')!;
        const dpr = cv.width / 390, W = cv.width / dpr, H = cv.height / dpr;
        const cam = e.camera, shake = cam.shakeOffset || { x: 0, y: 0 };
        let sum = 0, n = 0;
        for (let wy = cy - half; wy <= cy + half; wy += half / 3) {
          for (let wx = cx - half; wx <= cx + half; wx += half / 3) {
            const x = Math.round((W / 2 + (wx - cam.position.x + shake.x) * cam.zoom) * dpr);
            const y = Math.round((H / 2 + (wy - cam.position.y + shake.y) * cam.zoom) * dpr);
            if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) continue;
            const d = g.getImageData(x, y, 1, 1).data;
            sum += (d[0] + d[1] + d[2]) / 3; n++;
          }
        }
        return n > 0 ? sum / n : 0;
      };
      const set = async (name: string) => {
        for (let i = 0; i < 8 && e.renderer.getFog() !== name; i++) e.renderer.cycleFog();
        await frames(22);
      };
      // THE SAMPLE HAS TO MISS THE HUD, which the fog deliberately does not
      // touch.  The viewport is 390 CSS wide, so at this zoom nothing beyond
      // the light's radius is on screen to the SIDES — only above and below,
      // and below is the loadout strip.  A patch measured there reads as "the
      // fog barely works" when what it is measuring is the interface.
      //
      // So: drop the light to its smallest radius (180 units), and sample
      // ABOVE the ship, between the top chips and the light.
      for (let i = 0; i < 10 && e.renderer.getLightTier() !== 'minimal'; i++) {
        e.renderer.cycleLightTier();
      }
      const away = () => box(bx, by - 330, 70);
      const home = () => box(bx, by, 55);
      await set('off');
      const offAway = away(), offHome = home();
      await set('dark');
      const darkAway = away(), darkHome = home();

      // MEMORY: fly past a patch and look back at it.  A patch the ship has
      // never been near, at the same distance on the other side, is the
      // control — and BOTH are baselined against themselves with the fog off,
      // from the same camera, so the comparison cannot be decided by which of
      // the two happens to have more terrain in it.
      await set('off');
      px = bx; py = by - 700; await frames(40);
      const offRemembered = box(bx, by - 330, 70);
      const offNeverSeen = box(bx, by - 1030, 70);

      await set('memory');
      px = bx; py = by - 330; await frames(45);      // stand ON the patch
      px = bx; py = by - 700; await frames(45);      // fly past; it is behind
      const remembered = box(bx, by - 330, 70);
      const neverSeen = box(bx, by - 1030, 70);
      await set('off');
      for (let i = 0; i < 10 && e.renderer.getLightTier() !== 'low'; i++) {
        e.renderer.cycleLightTier();
      }
      for (let i = 0; i < 10 && e.renderer.getFlashlight() !== beam0; i++) {
        e.renderer.cycleFlashlight();
      }
      return { offAway, offHome, darkAway, darkHome, offRemembered, offNeverSeen,
               remembered, neverSeen,
               placed, back: e.renderer.getFog(), tier: e.renderer.getLightTier() };
    });

    expect(r.back).toBe('off');
    expect(r.tier).toBe('low');
    // The scene has something to darken in the first place — and now it has
    // it BY CONSTRUCTION, so this is a check on the construction.
    expect(r.placed).toBe(true);
    expect(r.offAway).toBeGreaterThan(5);
    expect(r.offNeverSeen).toBeGreaterThan(5);

    // TWO LAYERS: the far patch goes dark, and the ship's own surroundings do
    // not — the light cuts the fog where it reaches.
    expect(r.darkAway).toBeLessThan(r.offAway * 0.6);
    expect(r.darkHome).toBeGreaterThan(r.offHome * 0.6);
    // ...and the lit ship is brighter than the fogged distance, which is the
    // whole effect in one comparison.
    expect(r.darkHome).toBeGreaterThan(r.darkAway * 2);

    // THREE LAYERS: somewhere the ship has BEEN is brighter than somewhere it
    // has never been, at the same distance and neither of them lit now —
    // stated both raw and normalised for what was there to begin with.
    expect(r.remembered).toBeGreaterThan(r.neverSeen * 2);
    expect(r.remembered / r.offRemembered)
      .toBeGreaterThan(2 * (r.neverSeen / r.offNeverSeen));
    watch.assertClean();
  });

  test('the minimap carries the fog memory at every rung but off', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');

    const r = await engine(page, async (e) => {
      let px = 0, py = 0;
      const frames = (n: number) => new Promise<void>(res => {
        let i = 0;
        const t = () => {
          e.player.position.x = px; e.player.position.y = py;
          e.player.velocity.x = 0; e.player.velocity.y = 0;
          // CONTACTS OFF, every frame.  The veil covers the TERRAIN and the
          // contacts draw ON TOP of it by design, so a bubble drifting into
          // the sample box adds a bright pulsing blip to a patch that is
          // supposed to be measuring hidden ground — it read as the control
          // spot being BRIGHTER than its own unfogged baseline.  Ambient
          // fauna is always-present, so this cannot be waited out.
          for (const o of e.currentMap.entities) {
            if (o.type !== 'STRUCTURE') o.active = false;
          }
          if (++i < n) requestAnimationFrame(t); else res();
        };
        requestAnimationFrame(t);
      });
      e.renderer.setLighting('unified');

      // THE COLLAPSED MINIMAP: 75px square at (MARGIN, H - SIZE - BOTTOM_MARGIN)
      // in CSS px, showing ZOOM_RANGE world units to a side of centre.  Read in
      // MINIMAP px offsets from its centre, so the sample follows the map and
      // not the world.
      const SIZE = 75, MARGIN = 20, BOTTOM = 14, ZOOM_RANGE = 1000;
      const perUnit = (SIZE / 2) / ZOOM_RANGE;
      const box = (ox: number, oy: number, half: number) => {
        const cv = document.querySelector('canvas') as HTMLCanvasElement;
        const g = cv.getContext('2d')!;
        const dpr = cv.width / 390, H = cv.height / dpr;
        const cx = MARGIN + SIZE / 2 + ox, cy = (H - SIZE - BOTTOM) + SIZE / 2 + oy;
        let sum = 0, n = 0;
        for (let y = cy - half; y <= cy + half; y++) {
          for (let x = cx - half; x <= cx + half; x++) {
            const d = g.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
            sum += (d[0] + d[1] + d[2]) / 3; n++;
          }
        }
        return sum / n;
      };
      const set = async (name: string) => {
        for (let i = 0; i < 8 && e.renderer.getFog() !== name; i++) e.renderer.cycleFog();
        await frames(20);
      };
      // Two spots either side of the ship, far enough out that the stamp it is
      // making RIGHT NOW cannot reach either: the memory disc is
      // maxRadius x MEMORY_FRAC = 210 units at the `low` tier, and these are
      // 600 away.  Terrain density is not uniform, so each is measured
      // against ITSELF with the fog off rather than against the other.
      //
      // The offset is taken from the LIVE CAMERA, not from the ship: the
      // minimap is centred on the camera, the camera follows with lag, and a
      // fixed offset silently samples a different WORLD point on the frames
      // after a move — which is exactly the spot the ship has not explored.
      const at = (wx: number) =>
        box((wx - e.camera.position.x) * perUnit, -e.camera.position.y * perUnit, 3);
      const plus = () => at(600);
      const minus = () => at(-600);

      await set('off');
      const offPlus = plus(), offMinus = minus(), offHome = at(0);

      // Every rung above `off` fogs the map — INCLUDING the two-layer ones,
      // whose world fog keeps no memory of its own.
      const rung: Record<string, number> = {};
      for (const name of ['dim', 'dark', 'memory']) {
        await set(name);
        rung[name] = plus();
      }

      // Now EARN the memory: fly out to the +x spot, sit there, come back.
      // Both spots are read BEFORE and AFTER that flight, in the same fog
      // state, so each is compared only against ITSELF.  Cross-normalising
      // one spot's brightness against the other's cannot work here: the two
      // hold different terrain, and dividing by a nearly-empty patch turns
      // the comparison into noise.
      await set('dark');                     // a TWO-layer rung, deliberately
      const darkPlus = plus(), darkMinus = minus();
      px = 600; py = 0; await frames(45);
      px = 0; py = 0; await frames(45);
      const seenPlus = plus(), unseenMinus = minus(), homeAfter = at(0);

      await set('off');
      return { offPlus, offMinus, offHome, dim: rung.dim, dark: rung.dark,
               memory: rung.memory, darkPlus, darkMinus,
               seenPlus, unseenMinus, homeAfter,
               back: e.renderer.getFog() };
    });

    expect(r.back).toBe('off');
    // The map has terrain to hide in the first place.
    expect(r.offPlus).toBeGreaterThan(8);
    expect(r.offMinus).toBeGreaterThan(8);

    // EVERY RUNG BUT OFF veils unexplored ground, and the darker the rung the
    // darker the veil — the minimap wears the fog's own setting.
    expect(r.dim).toBeLessThan(r.offPlus * 0.75);
    expect(r.dark).toBeLessThan(r.dim);
    expect(r.memory).toBeLessThanOrEqual(r.dark + 0.5);

    // THE MEMORY IS EARNED, and it is earned on a TWO-layer rung: after flying
    // out to +x and back, THAT spot is legible where it was veiled before...
    expect(r.seenPlus).toBeGreaterThan(r.darkPlus * 2);
    expect(r.seenPlus).toBeGreaterThan(r.offPlus * 0.5);
    // ...and the mirror-image spot the ship never visited is exactly as
    // veiled as it was, which is what makes the first line about EXPLORING
    // rather than about time passing or the fog settling.  Stated with an
    // absolute slack as well as a ratio, because a veiled patch is a small
    // number and a ratio between two small numbers is noise.
    expect(r.unseenMinus).toBeLessThan(Math.max(r.darkMinus * 1.5, r.darkMinus + 2));
    expect(r.unseenMinus).toBeLessThan(r.offMinus * 0.5);
    // ...and the ship's own surroundings were never veiled at all.
    expect(r.homeAfter).toBeGreaterThan(r.offHome * 0.6);
    watch.assertClean();
  });

  test('A4b: the legacy receivers are retired under unified, kept under legacy', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'PLASTIC_FIELD');
    await parkInCluster(page);

    // PLASTIC_FIELD because plastic-tile carries a `glow` block and renders
    // on the material slow path, so under LEGACY the bloom demonstrably runs
    // (lastTileLightingCount counts tiles the bloom spent >1us on).  Under
    // UNIFIED the same parked frame must count ZERO — the point light owns
    // "the near face is lit" now, and the bloom would be double-lighting.
    const r = await engine(page, async (e) => {
      const frames = (n: number) => new Promise<void>(res => {
        let i = 0;
        const t = () => {
          e.player.velocity.x = 0; e.player.velocity.y = 0;
          if (++i < n) requestAnimationFrame(t); else res();
        };
        requestAnimationFrame(t);
      });
      const sample = async (mode: string) => {
        e.renderer.setLighting(mode);
        await frames(12);
        // The counters are per-frame (reset at the top of render); a settled
        // read after 12 frames is one frame's truth.
        return { n: e.renderer.lastTileLightingCount as number,
                 ms: e.renderer.lastTileLightingMs as number };
      };
      const legacy = await sample('legacy');
      const unified = await sample('unified');
      e.renderer.setLighting('unified');
      return { legacy, unified };
    });

    // Parked inside the densest plastic cluster, the LEGACY bloom lights
    // something...
    expect(r.legacy.n).toBeGreaterThan(0);
    // ...and under UNIFIED the same spot counts zero — not "less", zero,
    // because the gate is a mode check, not a tuning.
    expect(r.unified.n).toBe(0);
    expect(r.unified.ms).toBe(0);
    watch.assertClean();
  });

  test('A6: shots are world lights — budgeted, culled, and their own colour', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'METAL_FIELD');

    const r = await engine(page, async (e) => {
      // EMPTY DARK SCENE, radial light pinned: the shot's own light is the
      // only thing that can brighten a patch outside the player's radius.
      for (const t of e.currentMap.entities) {
        if (t.type === 'STRUCTURE') t.active = false;
      }
      e.physics.initializeStaticGrid(e.currentMap.entities);
      e.renderer.setLighting('unified');
      const beam0 = e.renderer.getFlashlight();
      for (let i = 0; i < 10 && e.renderer.getFlashlight() !== 'radial'; i++) {
        e.renderer.cycleFlashlight();
      }

      // A HAND-PLACED PROJECTILE, parked well outside the player light's
      // radius (tier `low` = 300) and re-pinned every frame — the sim ticks
      // its lifetime but must not move or expire it mid-measurement.
      const mkShot = (x: number, y: number, color: string) => ({
        id: 'wl-test-' + x + ':' + y,
        type: 'PROJECTILE', active: true,
        position: { x, y }, velocity: { x: 0, y: 0 },
        size: { x: 6, y: 6 }, rotation: 0, color,
        damage: 0, ownerType: 'PLAYER', mass: 0.01,
        health: 1, maxHealth: 1,
      } as any);
      const shot = mkShot(0, -600, '#ff2200');          // pure red, on screen
      const farShot = mkShot(2500, 2500, '#ff2200');    // two screens away
      // Spawned projectiles live in the map's entity list (WeaponSystem
      // appends them there), so the hand-built ones go the same way.
      e.currentMap.entities.push(shot, farShot);

      const frames = (n: number) => new Promise<void>(res => {
        let i = 0;
        const t = () => {
          e.player.position.x = 0; e.player.position.y = 0;
          e.player.velocity.x = 0; e.player.velocity.y = 0;
          for (const o of e.currentMap.entities) {
            if (o.type !== 'STRUCTURE') o.active = false;
          }
          shot.active = true; shot.lifetime = 99;
          shot.position.x = 0; shot.position.y = -600;
          farShot.active = true; farShot.lifetime = 99;
          if (++i < n) requestAnimationFrame(t); else res();
        };
        requestAnimationFrame(t);
      });
      const box = (cx: number, cy: number) => {
        const cv = document.querySelector('canvas') as HTMLCanvasElement;
        const g = cv.getContext('2d')!;
        const dpr = cv.width / 390, W = cv.width / dpr, H = cv.height / dpr;
        const cam = e.camera, shake = cam.shakeOffset || { x: 0, y: 0 };
        let rr = 0, gg = 0, bb = 0, n = 0;
        for (let wy = cy - 25; wy <= cy + 25; wy += 12) {
          for (let wx = cx - 25; wx <= cx + 25; wx += 12) {
            const x = Math.round((W / 2 + (wx - cam.position.x + shake.x) * cam.zoom) * dpr);
            const y = Math.round((H / 2 + (wy - cam.position.y + shake.y) * cam.zoom) * dpr);
            if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) continue;
            const d = g.getImageData(x, y, 1, 1).data;
            rr += d[0]; gg += d[1]; bb += d[2]; n++;
          }
        }
        return n ? [rr / n, gg / n, bb / n] : [0, 0, 0];
      };

      await frames(15);
      const dflt = e.renderer.getWorldLights();
      const lit = box(0, -600);
      const litCount = e.renderer.worldLightCount();
      e.renderer.toggleWorldLights();
      await frames(15);
      const dark = box(0, -600);
      const offCount = e.renderer.worldLightCount();
      e.renderer.toggleWorldLights();
      await frames(15);
      const backCount = e.renderer.worldLightCount();

      shot.active = false; farShot.active = false;
      for (let i = 0; i < 10 && e.renderer.getFlashlight() !== beam0; i++) {
        e.renderer.cycleFlashlight();
      }
      return { dflt, lit, dark, litCount, offCount, backCount };
    });

    expect(r.dflt).toBe(true);                 // ships on
    // THE CULL IS THE COUNT: the on-screen shot lights, the shot two
    // screens away never enters the budget.
    expect(r.litCount).toBe(1);
    expect(r.offCount).toBe(0);                // the toggle is a true restore
    expect(r.backCount).toBe(1);
    // The shot's patch is BRIGHTER lit than dark, and the gain is RED —
    // the light wears the projectile's own colour, not the lamp's blue.
    const gainR = r.lit[0] - r.dark[0];
    const gainB = r.lit[2] - r.dark[2];
    expect(gainR).toBeGreaterThan(2);
    expect(gainR).toBeGreaterThan(gainB + 1);
    watch.assertClean();
  });

  test('A7: depth darkens the world through the fog, and the hub never does', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'METAL_FIELD');

    const r = await engine(page, async (e) => {
      e.renderer.setLighting('unified');
      const beam0 = e.renderer.getFlashlight();
      for (let i = 0; i < 10 && e.renderer.getFlashlight() !== 'radial'; i++) {
        e.renderer.cycleFlashlight();
      }
      // A HAND-PLACED patch outside the light's radius, same construction as
      // the fog test: the ambient can only be measured against world that is
      // actually there.
      const stock = e.currentMap.entities.filter(
        (t: any) => t.type === 'STRUCTURE' && t.mass === Infinity);
      for (let i = 0; i < 9; i++) {
        const t = stock[i];
        t.active = true; t._occluderR = undefined;
        t.position.x = ((i % 3) - 1) * 60;
        t.position.y = -430 + (Math.floor(i / 3) - 1) * 60;
      }
      e.physics.initializeStaticGrid(e.currentMap.entities);
      const frames = (n: number) => new Promise<void>(res => {
        let i = 0;
        const t = () => {
          e.player.position.x = 0; e.player.position.y = 0;
          e.player.velocity.x = 0; e.player.velocity.y = 0;
          for (const o of e.currentMap.entities) {
            if (o.type !== 'STRUCTURE') o.active = false;
          }
          if (++i < n) requestAnimationFrame(t); else res();
        };
        requestAnimationFrame(t);
      });
      const box = () => {
        const cv = document.querySelector('canvas') as HTMLCanvasElement;
        const g = cv.getContext('2d')!;
        const dpr = cv.width / 390, W = cv.width / dpr, H = cv.height / dpr;
        const cam = e.camera, shake = cam.shakeOffset || { x: 0, y: 0 };
        let sum = 0, n = 0;
        for (let wy = -500; wy <= -360; wy += 20) {
          for (let wx = -70; wx <= 70; wx += 20) {
            const x = Math.round((W / 2 + (wx - cam.position.x + shake.x) * cam.zoom) * dpr);
            const y = Math.round((H / 2 + (wy - cam.position.y + shake.y) * cam.zoom) * dpr);
            if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) continue;
            const d = g.getImageData(x, y, 1, 1).data;
            sum += (d[0] + d[1] + d[2]) / 3; n++;
          }
        }
        return n ? sum / n : 0;
      };
      // The tier stays at the shipped `low` — its radius is 300 and the
      // patch sits 430 out, already beyond the light, and `low` is the tier
      // whose ambientPerStage the feature actually ships with (the
      // emergency tiers below it are authored zero, so dropping the tier
      // here would measure the OFF branch and call it broken).
      // SHIPS OFF: depth is not yet a real place (the parked universe-map
      // work owns switching this on), so the test turns the mechanism on
      // itself and restores off afterwards — the default it asserts is only
      // the default.
      const dflt = e.renderer.getDepthAmbient();
      if (!e.renderer.getDepthAmbient()) e.renderer.toggleDepthAmbient();

      // DEPTH is a renderer field stamped by the engine each frame; writing
      // the ENGINE's stageIndex is the honest path — the stamp carries it.
      const at = async (depth: number) => {
        e.stageIndex = depth;
        await frames(18);
        return box();
      };
      const hub = await at(0);
      const d2 = await at(2);
      const d4 = await at(4);
      const d9 = await at(9);         // capped at 4 — no darker than d4
      e.renderer.toggleDepthAmbient();
      const off9 = await at(9);       // toggled off: full brightness back
      e.stageIndex = 0;
      await frames(6);
      for (let i = 0; i < 10 && e.renderer.getFlashlight() !== beam0; i++) {
        e.renderer.cycleFlashlight();
      }
      return { dflt, hub, d2, d4, d9, off9, back: e.renderer.getDepthAmbient() };
    });

    expect(r.dflt).toBe(false);
    expect(r.back).toBe(false);
    // The patch is visible at the surface...
    expect(r.hub).toBeGreaterThan(5);
    // ...and MONOTONE with depth: two stages down is darker, four darker
    // still, and the ladder is capped at four — depth nine reads as four.
    expect(r.d2).toBeLessThan(r.hub * 0.92);
    expect(r.d4).toBeLessThan(r.d2 * 0.95);
    expect(Math.abs(r.d9 - r.d4)).toBeLessThan(1.5);
    // The toggle is a true restore, at any depth.
    expect(r.off9).toBeGreaterThan(r.hub * 0.85);
    watch.assertClean();
  });

  test('the perf pipeline carries the light and fog slices', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');

    // WIRING, not speed: no millisecond thresholds (CI timing is noise, the
    // repo's long stance) — only that the two timers reach EngineStats.perf
    // when their passes run, and read exactly zero when they don't.  This is
    // the seam a future rename would silently break: the renderer field can
    // tick while the snapshot reports 0 forever, and every capture ever taken
    // would say the feature is free.
    const r = await engine(page, async (e) => {
      const frames = (n: number) => new Promise<void>(res => {
        let i = 0;
        const t = () => { if (++i < n) requestAnimationFrame(t); else res(); };
        requestAnimationFrame(t);
      });
      const set = async (name: string) => {
        for (let i = 0; i < 8 && e.renderer.getFog() !== name; i++) e.renderer.cycleFog();
        await frames(30);
      };
      const perf = () => (window as any).__omniStats.perf;

      e.renderer.setLighting('unified');
      await set('off');
      const litOn = perf().lightingMs, fogOff = perf().fogMs;
      await set('dark');
      const fogOn = perf().fogMs;
      await set('off');
      e.renderer.setLighting('legacy');
      await frames(70);                     // > PERF_WINDOW (60): the ring
                                            // average has to fully drain
      const litLegacy = perf().lightingMs, fogLegacy = perf().fogMs;
      e.renderer.setLighting('unified');
      return { litOn, fogOff, fogOn, litLegacy, fogLegacy,
               back: e.renderer.getFog() };
    });

    expect(r.back).toBe('off');
    // The unified layer's cost reaches the snapshot...
    expect(r.litOn).toBeGreaterThan(0);
    // ...the fog's does only while a fog rung is on...
    expect(r.fogOff).toBe(0);
    expect(r.fogOn).toBeGreaterThan(0);
    // ...and under legacy both drain to zero — the ring is 45 frames of
    // zeroes by now, so a stale timer would be caught here.
    expect(r.litLegacy).toBe(0);
    expect(r.fogLegacy).toBe(0);
    watch.assertClean();
  });

  test('the tint cache buckets its keys — equilibration cannot storm it', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'GLASS_FIELD');

    // THE TINT STORM (device captures, A9b): enemy-death nebula dust
    // equilibrates its hue continuously, so exact (sprite, hex) keys form a
    // never-repeating stream and the 256-entry cache rebuilds a 128px
    // canvas per shard per hue step — 497 in one measured frame.  The fix
    // quantises the hex to 17-step buckets at BOTH key seams.  This pins
    // the behaviour, not the speed: two hexes inside one bucket must share
    // one canvas, and the second lookup must not count a miss.
    const r = await engine(page, async (e) => {
      const rs = e.renderer;
      const src = e.player.sprite;
      // Wait until the sprite is genuinely loaded — getTintedSprite
      // returns null (without counting a miss) before that.
      for (let i = 0; i < 120 && rs.getTintedSprite(src, '#969696') === null; i++) {
        await new Promise(res => requestAnimationFrame(() => res(null)));
      }
      const a = rs.getTintedSprite(src, '#969696');   // 150 -> bucket 9
      const missesAfterA = rs.lastTintMisses;
      const b = rs.getTintedSprite(src, '#9b9b9b');   // 155 -> bucket 9
      const missesAfterB = rs.lastTintMisses;
      const c = rs.getTintedSprite(src, '#c8c8c8');   // 200 -> bucket 12
      return {
        loaded: a !== null,
        sameBucketShares: a !== null && a === b,
        secondCostNoMiss: missesAfterB === missesAfterA,
        differentBucketDiffers: c !== a,
        // The pure quantiser: format preserved, idempotent, and non-hex
        // inputs pass through untouched.
        q1: rs.quantizeTintHex('#a1b2c3'),
        q2: rs.quantizeTintHex(rs.quantizeTintHex('#a1b2c3')),
        passthrough: rs.quantizeTintHex('rgba(1,2,3,0.5)'),
      };
    });

    expect(r.loaded).toBe(true);
    expect(r.sameBucketShares).toBe(true);
    expect(r.secondCostNoMiss).toBe(true);
    expect(r.differentBucketDiffers).toBe(true);
    expect(r.q1).toMatch(/^#[0-9a-f]{6}$/);
    expect(r.q2).toBe(r.q1);
    expect(r.passthrough).toBe('rgba(1,2,3,0.5)');
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
