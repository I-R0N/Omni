/** The minimap's material layer (decision #43, gauntlet step 5 G5).
 *
 *  The minimap is mostly PIXELS, and this suite deliberately does not try to
 *  assert what those pixels look like — the shape-and-colour faithfulness pass
 *  was judged from captures, and the verdict lives in the ledger. What is
 *  asserted here is everything the SIM exposes about it, which turns out to be
 *  all the load-bearing parts (harness rule 3):
 *
 *   · nebula is gone from BOTH halves of the map (the pre-rendered terrain
 *     layer and the per-frame buffer);
 *   · the material mode decides whether shards reach the buffer at all, so a
 *     mode that draws no dots is not paying to collect them either;
 *   · drops stay excluded, as they always were;
 *   · the streamline geometry cache rebuilds when the seed lattice moves and
 *     NOT when the camera merely pans — which is the whole reason a per-frame
 *     field trace is affordable.
 *
 *  The one pixel assertion is the nebula one, and only because a blank canvas
 *  is the only way to prove absence from a pre-rendered layer.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, stats, startRun, waitForStats } from './helpers';

/** Fit the widest scanner and complete ONE full ping.
 *
 *  Every readout this suite measures is now gated on a SCAN (scanner rework):
 *  with no scanner the minimap draws neither terrain nor contacts and the HUD
 *  carries no arrows at all, so a test that does not scan is measuring the
 *  blank baseline rather than the thing it names.
 *
 *  The ping is driven to completion by POLLING the engine's own wavefront
 *  rather than by sleeping a computed duration — this environment renders in
 *  software, so sim-seconds and wall-seconds are not the same and a sleep
 *  long enough here would be a coin flip (harness rule 1).  `scanPingRadius`
 *  returns to 0 exactly when the front finishes. */
async function scanOnce(page: any) {
  // The cooldown is cleared first and the fire is ASSERTED.  Without both,
  // a refused scan makes this helper a silent no-op: `scanPingRadius` is
  // already 0 when no ping started, so the wait below would return
  // immediately and the test would go on to measure an unscanned world and
  // report it as a reveal failure.  (That is not hypothetical — it is how the
  // category-ladder test first "failed": its second scan landed inside the
  // cooldown left by its first.)  The cooldown has its own test.
  const fired = await engine(page, e => {
    // Fit ONE scanner, not one per call.  Marks STACK in range now, so a
    // helper that granted unconditionally would silently widen the ship's
    // reach every time a test scanned — which is exactly how the far-side
    // assertion below first 'passed' a rift 6000 units away.
    if (e.scannerMk <= 0) e.debugGrantModule('scanner_mk5');
    e.scanCooldown = 0;
    return e.fireScan();
  });
  if (!fired) throw new Error('fireScan refused — is a scanner installed and ACTIVE?');
  await page.waitForFunction(
    () => (window as any).__omniEngine?.scanPingRadius === 0,
    undefined, { timeout: 15000 },
  );
}

/** Count the per-frame minimap contacts by kind. */
function bufferByKind(page: any) {
  return engine(page, e => {
    const out: Record<string, number> = {};
    for (const item of e.renderer._minimapBuffer) {
      const en = item.entity;
      const k = en.shardVariant && String(en.shardVariant).startsWith('nebula') ? 'nebula'
        : en.dropType ? 'drop'
        : en.isStation ? 'station'
        : en.isPortal ? 'portal'
        : en.type === 'STRUCTURE' ? 'shard'
        : String(en.type).toLowerCase();
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  });
}

/** Step the DBG cycle until the named mode is active (max one full lap).
 *
 *  The whole lap used to run INSIDE one `engine()` call, comparing against
 *  `window.__omniStats` between clicks — but that payload is only republished
 *  once a frame, so every comparison after the first read a stale name and the
 *  lap overshot. It happened to work only while the wanted mode was already
 *  the shipped default, i.e. while the loop did nothing. It stopped working
 *  the moment the default moved (Flow → Dots).
 *
 *  One click per step, then WAIT for the published mode to change: drive the
 *  mechanism, poll for the result, never sleep (harness rules 1 and 6). */
async function setMaterial(page: any, name: 'Flow' | 'Dots' | 'Off') {
  for (let i = 0; i < 4; i++) {
    const current = (await stats(page)).minimapMaterialName;
    if (current === name) return;
    await engine(page, e => e.dbg.cycleMinimapMaterial());
    // The predicate is SERIALISED into the page, so it cannot close over
    // `current` — the name would be undefined on the other side. Inline the
    // value, the way healthbars.spec.ts does.
    await waitForStats(
      page,
      new Function('s', `return s.minimapMaterialName !== ${JSON.stringify(current)};`) as (s: any) => boolean,
      `the material mode to leave ${current}`,
    );
  }
  throw new Error(`material mode never reached ${name}`);
}

test.describe('off-screen indicators — portals', () => {
  /** Park the player `dist` world units east of the first hub portal and let
   *  a frame rebuild the indicator buffer.
   *
   *  Scoped to THAT portal by target id, not to "any portal in the buffer".
   *  The hub now carries a six-portal TEST RACK beside the home station on top
   *  of the four arena rifts, and at the far-side standoff below one of the
   *  rack portals sits 1345 units away — inside INDICATOR_RANGE (1500). A
   *  buffer-wide `find(isPortal)` would return that one and report an arrow
   *  for a rift the test is not asking about. */
  async function standOff(page: any, dist: number) {
    const target = await engine(page, (e, d: number) => {
      const p = e.portals[0];
      e.player.position.x = p.position.x + d;
      e.player.position.y = p.position.y;
      e.player.velocity.x = 0;
      e.player.velocity.y = 0;
      e.camera.position.x = e.player.position.x;
      e.camera.position.y = e.player.position.y;
      return p.portalTargetId as string;
    }, dist);
    await page.waitForTimeout(250);
    return engine(page, (e, id: string) => {
      const entry = e.renderer._indicatorBuffer.find(
        (i: any) => i.entity.isPortal && i.entity.portalTargetId === id);
      return entry ? { present: true, onScreen: entry.onScreen } : { present: false, onScreen: false };
    }, target);
  }

  test('the arrow is bracketed: within scan reach, not yet visible', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');

    // THE ARROWS BELONG TO THE SCANNER now (rework).  With nothing fitted the
    // HUD carries no arrows at any distance — that is the baseline, and it is
    // asserted first because everything below is a departure from it.
    // 1400, not 900: inside SCANNER.ENCOUNTER_RANGE the rift is seen with the
    // naked eye (which is the point of encounters), so a claim about the
    // SCANNER has to be made from outside it.
    expect((await standOff(page, 1400)).present,
      'a scannerless ship gets no arrow at instrument range').toBe(false);

    // This asserts the INPUTS the suppression rule reads — presence in the
    // buffer (now the detection stamp) and the `onScreen` flag (the
    // redundancy gate).  The rule that consumes them is one line inside a
    // canvas draw and is not reachable from here; it is stated plainly
    // rather than pretended at.

    // Inside scan reach but well outside the viewport: the case the arrow
    // exists for.  The scan has to happen at THIS standoff — a stamp records
    // where the front crossed the rift, so scanning from elsewhere would
    // measure a stale mark.
    await standOff(page, 1400);
    await scanOnce(page);
    const approach = await standOff(page, 1400);
    expect(approach.present).toBe(true);
    expect(approach.onScreen).toBe(false);

    // On top of it: still buffered, but now flagged on-screen — which is what
    // suppresses it (G6). The rift and its own world-space tag are right
    // there; a third naming of the same place was the complaint.
    await standOff(page, 40);
    await scanOnce(page);
    const arrived = await standOff(page, 40);
    expect(arrived.present).toBe(true);
    expect(arrived.onScreen).toBe(true);

    // A MARK OUTLIVES THE PING that made it — that is the whole reveal-and-
    // fade model, and it is why the far-side check below has to clear the
    // stamps first rather than just flying away.  Retreating out of reach
    // leaves the arrow up until the mark goes stale.
    expect((await standOff(page, 6000)).present,
      'a mark persists after the contact leaves scan reach').toBe(true);

    // Far side of the map, scanned FRESH: still no arrow, and now for a
    // reason the player can act on — it is past what the scanner reaches (a
    // single Mk V tops out near 3200 units) rather than past a fixed
    // INDICATOR_RANGE.  Fitting more scanners is what moves this line.
    await engine(page, e => { for (const p of e.portals) p.detectedAt = undefined; });
    await standOff(page, 6000);
    await scanOnce(page);
    expect((await standOff(page, 6000)).present).toBe(false);

    watch.assertClean();
  });
});

test.describe('minimap — material layer', () => {
  /*  The default MOVED from Flow to Dots (user call).  This assertion is
   *  rewritten rather than deleted because what it pins is still the thing
   *  that matters — which of the three modes a player who never opens the
   *  debug menu actually gets — and it is exactly the kind of default that
   *  drifts silently.  Flow is one step of the cycle away and is still
   *  covered by the mode tests below. */
  test('ships with the dot layer as the default', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    expect((await stats(page)).minimapMaterialName).toBe('Dots');
    watch.assertClean();
  });

  test('nebula is off the map entirely — terrain layer and buffer both', async ({ page }) => {
    const watch = await boot(page);
    // The nebula showcase field is nebula and nothing else, so the terrain
    // layer must come out completely blank. On a mixed map the same bug would
    // hide behind the rock and glass that legitimately draw.
    await startRun(page, 'NEBULA_FIELD');
    await waitForStats(page, s => s.currentMapType === 'NEBULA_FIELD', 'the nebula field');

    const r = await engine(page, e => {
      const nebulaTiles = e.currentMap.entities
        .filter((x: any) => x.shardVariant === 'nebula-tile').length;
      const canvas = e.renderer._minimapStaticCanvas;
      let painted = 0;
      if (canvas) {
        const cx = canvas.getContext('2d');
        const d = cx.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) painted++;
      }
      return { nebulaTiles, painted, hasCanvas: !!canvas };
    });

    expect(r.hasCanvas).toBe(true);
    // There is definitely nebula out there to have drawn.
    expect(r.nebulaTiles).toBeGreaterThan(50);
    // And not one pixel of it reached the map.
    expect(r.painted).toBe(0);

    const kinds = await bufferByKind(page);
    expect(kinds.nebula ?? 0).toBe(0);

    watch.assertClean();
  });

  test('the material mode decides whether shards are even collected', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'ASTEROID_FIELD');
    await waitForStats(page, s => s.currentMapType === 'ASTEROID_FIELD', 'the asteroid field');

    // The scene genuinely has thousands of mobile shards to draw.
    const mobile = await engine(page, e => e.currentMap.entities
      .filter((x: any) => x.active && x.type === 'STRUCTURE' && x.mass !== Infinity).length);
    expect(mobile).toBeGreaterThan(200);

    // TWO GATES, and they answer different questions (rework + the encounter
    // pass).  The DBG cycle picks WHICH material layer is drawn; visibility is
    // then per shard — NEAR ones are seen with the naked eye, and a scan
    // reveals a wider bubble around where it was fired.
    await setMaterial(page, 'Dots');
    await page.waitForTimeout(300);
    const near = await engine(page, e => {
      const px = e.player.position.x, py = e.player.position.y;
      let worst = 0, n = 0;
      for (const item of e.renderer._minimapBuffer) {
        if (item.entity.type !== 'STRUCTURE') continue;
        n++;
        const d = Math.hypot(item.entity.position.x - px, item.entity.position.y - py);
        if (d > worst) worst = d;
      }
      return { n, worst };
    });
    // Eyesight alone puts material on the map…
    expect(near.n, 'shards within eyeshot are collected with no scan').toBeGreaterThan(0);
    // …and ONLY nearby material, which is what makes it a radius rather than
    // a free reveal of the whole field.  (Slack for the frame of drift
    // between the buffer fill and this read.)
    expect(near.worst, 'and only the near ones').toBeLessThan(1100);

    // A scan reaches further than eyesight, so it must collect strictly more.
    await scanOnce(page);
    const withDots = await bufferByKind(page);
    expect(withDots.shard ?? 0).toBeGreaterThan(near.n);

    // In FLOW mode they are not collected at all — the cost of the dot layer
    // is the per-frame push, not just the fill, which is what makes the mode
    // a real choice rather than a different way of drawing the same buffer.
    await setMaterial(page, 'Flow');
    await page.waitForTimeout(300);
    expect((await bufferByKind(page)).shard ?? 0).toBe(0);

    await setMaterial(page, 'Off');
    await page.waitForTimeout(300);
    expect((await bufferByKind(page)).shard ?? 0).toBe(0);

    await setMaterial(page, 'Flow');
    watch.assertClean();
  });

  test('terrain is CHARTED as the ship flies, and a scan charts it at range',
    async ({ page }) => {
      const watch = await boot(page);
      await startRun(page, 'ASTEROID_FIELD');
      await waitForStats(page, s => s.currentMapType === 'ASTEROID_FIELD', 'the asteroid field');
      await page.waitForTimeout(400);

      // The charted memory is a render-side alpha surface, so this reads its
      // COVERAGE rather than sampling the minimap's pixels: the mask is what
      // the terrain blit is filtered by, so coverage is the honest measure of
      // "how much of the map is drawable" (harness rule 3 — read the sim
      // where the sim exposes the same fact).
      const coverage = () => engine(page, e => {
        const mem = e.renderer._chartedMem;
        if (!mem) return -1;
        const c = mem.getContext('2d');
        const d = c.getImageData(0, 0, mem.width, mem.height).data;
        let lit = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
        return lit / (mem.width * mem.height);
      });

      const start = await coverage();
      expect(start, 'the memory surface exists').toBeGreaterThanOrEqual(0);
      // A fresh map is charted only where the ship SPAWNED — one encounter
      // disc.  The expected figure is arithmetic rather than a guess:
      // pi * ENCOUNTER_RANGE^2 / (6000 * 6000) = pi * 900^2 / 36e6 = 7.1%,
      // and it measures 7.5% with the drift of a few frames.  The bound is
      // set at 12% so it still fails loudly if the whole map were charted,
      // which is the regression that matters here.
      expect(start, 'a fresh map is charted only where the ship spawned')
        .toBeLessThan(0.12);

      // FLY.  Charting is stamped once per drawn frame from the ship's
      // position, so moving the ship and letting frames run is the real path.
      for (let i = 0; i < 6; i++) {
        await engine(page, e => {
          e.player.position.x += 700;
          e.camera.position.x = e.player.position.x;
          e.camera.position.y = e.player.position.y;
        });
        await page.waitForTimeout(120);
      }
      const flown = await coverage();
      // A corridor 1800 wide across the map, against one 1800 disc: a real
      // multiple, not a rounding difference.
      expect(flown, 'flying charts the ground you pass').toBeGreaterThan(start * 1.5);

      // SCAN.  A ping charts its whole bubble at once, which is the
      // instrument's navigational job — and it must beat walking.
      const beforeScan = await coverage();
      await scanOnce(page);
      await page.waitForTimeout(200);
      const scanned = await coverage();
      expect(scanned, 'a scan charts its bubble').toBeGreaterThan(beforeScan);

      // And charting is MAP-scoped: a new map is a new memory.
      await startRun(page, 'GLASS_FIELD');
      await waitForStats(page, s => s.currentMapType === 'GLASS_FIELD', 'the glass field');
      await page.waitForTimeout(300);
      expect(await coverage(), 'a fresh map forgets').toBeLessThan(scanned);

      watch.assertClean();
    });

  test('drops stay off the minimap in every mode', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    await engine(page, e => {
      for (let i = 0; i < 6; i++) {
        e.drops.spawnSalvageDrop(
          e.currentMap.entities,
          e.activeDrops,
          { x: e.player.position.x + 60 + i * 8, y: e.player.position.y + 60 },
        );
      }
    });
    await page.waitForTimeout(300);

    for (const mode of ['Flow', 'Dots', 'Off'] as const) {
      await setMaterial(page, mode);
      await page.waitForTimeout(200);
      expect((await bufferByKind(page)).drop ?? 0, `drops leaked in ${mode} mode`).toBe(0);
    }

    await setMaterial(page, 'Flow');
    watch.assertClean();
  });

  test('the streamline trace is cached across pans and rebuilt across cells', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await setMaterial(page, 'Flow');
    // The flow layer only runs while a scan's material bubble is fresh, so
    // the cache this test is about does not exist until something scans.
    await scanOnce(page);
    await page.waitForTimeout(400);

    const first = await engine(page, e => {
      const c = e.renderer._minimapFlowCache;
      return c ? { cellX: c.cellX, cellY: c.cellY, spacing: c.spacing, n: c.data.length } : null;
    });
    expect(first, 'the flow cache should exist once the map has drawn').not.toBeNull();
    expect(first.n).toBeGreaterThan(0);

    // Nudge the camera well within one lattice cell: the trace must be reused
    // verbatim, or a per-frame field integration is happening every frame.
    const panned = await engine(page, (e, arg: { step: number }) => {
      e.player.position.x += arg.step;
      e.camera.position.x += arg.step;
      return { cellX: e.renderer._minimapFlowCache.cellX };
    }, { step: 10 });
    await page.waitForTimeout(300);
    const afterPan = await engine(page, e => ({
      cellX: e.renderer._minimapFlowCache.cellX,
      cellY: e.renderer._minimapFlowCache.cellY,
    }));
    expect(afterPan.cellX).toBe(first.cellX);
    expect(afterPan.cellY).toBe(first.cellY);
    expect(panned.cellX).toBe(first.cellX);

    // Cross several cells: now it must retrace.
    await engine(page, (e, arg: { jump: number }) => {
      e.player.position.x += arg.jump;
      e.camera.position.x += arg.jump;
    }, { jump: 3000 });
    await page.waitForTimeout(400);
    const afterJump = await engine(page, e => e.renderer._minimapFlowCache.cellX);
    expect(afterJump).not.toBe(first.cellX);

    watch.assertClean();
  });
});
