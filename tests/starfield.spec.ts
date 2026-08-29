/** The background star field.
 *
 *  The one invariant worth a merge gate here is DENSITY PER UNIT AREA. The
 *  star count used to be absolute — 60 bands x 400 stars, over whatever the
 *  viewport happened to be — so a 390x844 phone showed 3.95x the stars per
 *  unit area that a 1440x900 desktop window did (measured; see
 *  `docs/GAUNTLET_STARFIELD_LOG.md` S1). That is a visible difference in
 *  something the player looks at constantly, and it is the kind of regression
 *  that reappears the moment someone "just bumps the star count".
 *
 *  These read the derived budget straight off the live `BackgroundManager`
 *  rather than counting lit pixels (harness rule 3: read the sim, not the
 *  pixels, wherever the sim exposes the same fact). Pixel counting is what
 *  `perf/starfield.mjs` is for; it is too slow and too noisy for a gate.
 *
 *  Harness rule 7 applies: the density values are hard-coded here rather than
 *  imported. A test that imports the constant it checks asserts that a
 *  constant equals itself; hard-coding means a tuning change has to touch this
 *  file, which is the alarm working.
 */
import { test, expect } from '@playwright/test';
import { boot, engine, startRun, waitForEngine } from './helpers';

/** Default step of `STAR_DENSITY_CYCLE` — stars per 10 000 CSS px². */
const DEFAULT_DENSITY = 729;
/** Default step of `STAR_BANDS_CYCLE` — parallax depth layers. */
const NUM_BANDS = 240;

/** The star-field budget the live manager derived for its current scene. */
const readField = (page: import('@playwright/test').Page) =>
  engine(page, (e) => {
    const bg = e.renderer.backgroundManager;
    let inGroups = 0;
    for (const g of bg.starGroups) inGroups += g.count;
    return {
      // One depth layer per band PLUS the milky way, which is now just the
      // last layer rather than a special case.
      bands: bg.bandSpeed.length,
      starsPerBand: bg.starsPerBand,
      starCount: bg.starCount,
      milkyWayStarCount: bg.milkyWayStarCount,
      sceneWidth: bg.sceneWidth,
      sceneHeight: bg.sceneHeight,
      sceneDpr: bg.sceneDpr,
      bandPixelWidth: bg.bandPixelWidth,
      bandPixelHeight: bg.bandPixelHeight,
      // Star storage — the arrays the draw loop walks.
      arrayLength: bg.starX.length,
      groups: bg.starGroups.length,
      starsInGroups: inGroups,
      maxStarSize: bg.starSize.length ? Math.max(...Array.from<number>(bg.starSize)) : 0,
      minStarSize: bg.starSize.length ? Math.min(...Array.from<number>(bg.starSize)) : 0,
    };
  });

/** Stars per 10 000 CSS px² for a measured field. */
const densityOf = (f: { starCount: number; sceneWidth: number; sceneHeight: number }) =>
  f.starCount / ((f.sceneWidth * f.sceneHeight) / 1e4);

test.describe('the star field', () => {
  test('derives its star count from viewport AREA at the target density', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await waitForEngine(page, e => e.renderer.backgroundManager.starX.length > 0, 'the star field');

    const f = await readField(page);

    // The parallax structure survives — S2 changed the BUDGET and S4 changed
    // the STORAGE, but neither changed the number of depth layers.
    // (+1 is the milky way, which S4 folded in as the last layer.)
    expect(f.bands).toBe(NUM_BANDS + 1);
    expect(f.starsPerBand).toBeGreaterThan(0);
    // The BUDGET is split across the depth bands; the milky way carries its
    // own width-scaled count on top, so it is not part of this product.
    expect(f.starCount).toBe(f.starsPerBand * NUM_BANDS);

    // Every star reached the draw arrays exactly once. Stars are stored sorted
    // into fill-style groups, so a star lost between generation and grouping
    // would simply never be drawn — silently, and only on some viewports.
    expect(f.arrayLength).toBe(f.starCount + f.milkyWayStarCount);
    expect(f.starsInGroups).toBe(f.arrayLength);
    expect(f.groups).toBeGreaterThan(0);

    // The scene is the CSS viewport, not the device-pixel backing store.
    // These two agreeing is what makes "per CSS px²" a meaningful unit.
    expect(f.sceneWidth).toBe(390);
    expect(f.sceneHeight).toBe(844);

    // The count is the density times the area, up to the per-band rounding
    // the budget is split by (at most NUM_BANDS/2 stars either way).
    const expected = (390 * 844 / 1e4) * DEFAULT_DENSITY;
    expect(Math.abs(f.starCount - expected)).toBeLessThanOrEqual(NUM_BANDS / 2);

    watch.assertClean();
  });

  test('shows the same sky per unit area at two very different viewport sizes', async ({ page }) => {
    // THE REGRESSION THIS FILE EXISTS FOR. Before S2 this ratio was ~3.95;
    // the two viewports below differ in area by 3.5x.
    const watch = await boot(page);
    await startRun(page);
    await waitForEngine(page, e => e.renderer.backgroundManager.starX.length > 0, 'the star field');

    const phone = await readField(page);

    // Resize and wait for the manager to notice: it rebuilds when the scene
    // size stops matching, which happens on the next render after the canvas
    // resize handler runs.
    await page.setViewportSize({ width: 1000, height: 1100 });
    await waitForEngine(
      page,
      e => e.renderer.backgroundManager.sceneWidth === 1000
        && e.renderer.backgroundManager.sceneHeight === 1100,
      'the background to rebuild at the new viewport size',
    );
    const desktop = await readField(page);

    // Areas really are different — otherwise this test proves nothing.
    const phoneArea = phone.sceneWidth * phone.sceneHeight;
    const deskArea = desktop.sceneWidth * desktop.sceneHeight;
    expect(deskArea / phoneArea).toBeGreaterThan(3);

    // …and the star COUNT tracked that area, so the DENSITY did not move.
    expect(desktop.starCount).toBeGreaterThan(phone.starCount * 2.5);
    const ratio = densityOf(desktop) / densityOf(phone);
    expect(ratio).toBeGreaterThan(0.97);
    expect(ratio).toBeLessThan(1.03);

    // The device-pixel scene follows the viewport; the layer COUNT does not.
    expect(desktop.bands).toBe(NUM_BANDS + 1);
    expect(desktop.bandPixelWidth).toBe(Math.round(1000 * desktop.sceneDpr));
    expect(desktop.bandPixelHeight).toBe(Math.round(1100 * desktop.sceneDpr));

    watch.assertClean();
  });

  test('renders bands at DEVICE resolution so no filter is in the blit path', async ({ page }) => {
    // S3. A CSS-px band blitted into a dpr-scaled context at a fractional
    // offset is resampled by whatever filter the engine picks — measured at
    // +114% lit device pixels at 45% the luma, and the filter choice is not
    // specified by the canvas spec, which is how two browsers come to disagree
    // about the same sky. Bands sized in DEVICE pixels are what removes the
    // scale from the blit; the integer offsets in `drawBand` remove the
    // fractional part.
    const watch = await boot(page);
    await startRun(page);
    await waitForEngine(page, e => e.renderer.backgroundManager.starX.length > 0, 'the star field');

    const f = await readField(page);

    // The manager tracked the ratio it generated at, and it is the CAPPED one
    // (`effectiveDpr`), which is the same accessor the canvas was sized with.
    expect(f.sceneDpr).toBeGreaterThan(0);
    const canvasDpr = await engine(page, e => e.renderer.ctx.canvas.width / e.renderer.ctx.canvas.clientWidth);
    expect(Math.abs(f.sceneDpr - canvasDpr)).toBeLessThan(0.01);

    // Star coordinates live in the scene's DEVICE-pixel space.
    expect(f.bandPixelWidth).toBe(Math.round(f.sceneWidth * f.sceneDpr));
    expect(f.bandPixelHeight).toBe(Math.round(f.sceneHeight * f.sceneDpr));
    // Sizes are whole device pixels, never fractional — a fractional size is
    // antialiased at its edges, which is half of the resampling S3 removed.
    expect(f.minStarSize).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(f.minStarSize)).toBe(true);
    expect(Number.isInteger(f.maxStarSize)).toBe(true);

    watch.assertClean();
  });

  test('holds no pre-rendered band canvases — the field is data, not bitmaps', async ({ page }) => {
    // S4. The star field used to be 61 full-viewport canvases blitted 4 ways
    // each: 244 whole-screen blits per frame, and 80 MB of backing store at
    // 390x844 dpr1 rising to 1.26 GB at 1440x900 dpr2 once the bands went
    // device-resolution in S3. Measured, drawing the stars directly is 6-25x
    // faster and holds well under a megabyte.
    //
    // This asserts the STRUCTURE rather than the megabytes, because the
    // megabytes are a consequence: any canvas held per band brings the whole
    // cost back, and it would come back quietly.
    const watch = await boot(page);
    await startRun(page);
    await waitForEngine(page, e => e.renderer.backgroundManager.starX.length > 0, 'the star field');

    const held = await engine(page, (e) => {
      const bg = e.renderer.backgroundManager;
      // Anything canvas-shaped reachable from the manager, other than the
      // nebula puff textures (which are legitimately cached bitmaps).
      const canvasFields: string[] = [];
      let bytes = 0;
      for (const k of Object.keys(bg)) {
        if (k === 'puffTextures' || k === 'nebulaPuffs') continue;
        const v = (bg as any)[k];
        const list = Array.isArray(v) ? v : [v];
        for (const item of list) {
          if (item && typeof item === 'object') {
            const c = item.canvas ?? item;
            if (c && typeof c.width === 'number' && typeof c.getContext === 'function') {
              canvasFields.push(k);
              bytes += c.width * c.height * 4;
            }
          }
        }
      }
      return {
        canvasFields,
        bytes,
        // The star arrays, which are what replaced them.
        starBytes: bg.starX.byteLength + bg.starY.byteLength
                 + bg.starSize.byteLength + bg.starBandIdx.byteLength,
        stars: bg.starX.length,
      };
    });

    expect(held.canvasFields).toEqual([]);
    expect(held.bytes).toBe(0);
    // ~10 bytes per star: two Int32 coordinates, a size byte and a band byte.
    expect(held.starBytes).toBeLessThan(held.stars * 12);
    // Sanity: the whole field costs less than a megabyte, against 80 MB before.
    expect(held.starBytes).toBeLessThan(1e6);

    watch.assertClean();
  });

  test('still parallaxes: layers scroll, and nearer layers scroll faster', async ({ page }) => {
    // S4 replaced 61 scrolling canvases with 61 scrolling offsets, so the
    // scroll arithmetic was rewritten. A static sky would look completely
    // normal in a screenshot — this is the failure a still image cannot catch.
    const watch = await boot(page);
    await startRun(page);
    await waitForEngine(page, e => e.renderer.backgroundManager.starX.length > 0, 'the star field');

    // Park the camera, note where each layer sits, then move a known distance.
    // Reading offsets rather than pixels is harness rule 3, and it also makes
    // the per-layer SPEED observable, which pixels would not.
    const before = await engine(page, e => Array.from<number>(e.renderer.backgroundManager.bandOffsetX));

    await engine(page, e => { e.player.position.x += 400; });
    const near = NUM_BANDS - 1;
    await waitForEngine(
      page,
      new Function('e', `return e.renderer.backgroundManager.bandOffsetX[${near}] !== ${JSON.stringify(before[near])}`) as any,
      'the nearest layer to scroll',
    );

    const after = await engine(page, e => Array.from<number>(e.renderer.backgroundManager.bandOffsetX));
    const speeds = await engine(page, e => Array.from<number>(e.renderer.backgroundManager.bandSpeed));

    // Layer speed rises quadratically with depth index, so a near layer must
    // outrun a far one. Offsets wrap, so compare the SPEED table that drives
    // them plus the fact that the field moved at all.
    expect(speeds[NUM_BANDS - 1]).toBeGreaterThan(speeds[0] * 10);

    // SPREAD and LAYER COUNT are independent knobs, and this is the assertion
    // that says so. The span from farthest to nearest is set by the spread
    // alone, so it must NOT move when the layer count does — adding layers
    // subdivides the same range. Conflating the two is the natural reading of
    // a "depth" control, and it is why more layers looks like LESS separation.
    expect(after.some((v, i) => v !== before[i])).toBe(true);

    // Every offset stays inside the wrap window — an offset that escaped it
    // would push stars off-screen permanently rather than wrapping them.
    const pw = await engine(page, e => e.renderer.backgroundManager.bandPixelWidth);
    for (const v of after) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(pw);
    }

    watch.assertClean();
  });

  test('draws stars SUB-PIXEL, and at integral sizes', async ({ page }) => {
    // Star POSITION is fractional on purpose: that is what makes the field
    // scroll continuously instead of stepping, and stepping is what made it
    // jitter at low ship speeds. If this ever quietly snapped, the jitter
    // would be back with nothing in the code saying so.
    //
    // Star SIZE stays integral in the same breath — a fractional size
    // antialiases the star's EDGES without buying any motion smoothness, so
    // it would be softness for nothing.
    const watch = await boot(page);
    await startRun(page);
    await waitForEngine(page, e => e.renderer.backgroundManager.starX.length > 0, 'the star field');

    const audit = await page.evaluate(() => new Promise<any>(resolve => {
      const e = (window as any).__omniEngine;
      const bg = e.renderer.backgroundManager;
      const ctx = e.renderer.ctx;
      const proto = Object.getPrototypeOf(ctx);
      const real = proto.fillRect;
      let calls = 0, fractionalPos = 0, fractionalSize = 0, sample: any = null;
      let inStars = false;
      const realStars = bg.renderStars.bind(bg);
      bg.renderStars = function (...args: any[]) {
        inStars = true;
        try { return realStars(...args); } finally { inStars = false; }
      };
      proto.fillRect = function (x: number, y: number, w: number, h: number) {
        if (inStars) {
          calls++;
          if (!Number.isInteger(x) || !Number.isInteger(y)) fractionalPos++;
          if (!Number.isInteger(w) || !Number.isInteger(h)) {
            fractionalSize++;
            if (!sample) sample = { x, y, w, h };
          }
        }
        return real.call(this, x, y, w, h);
      };
      let n = 0;
      const tick = () => {
        e.player.velocity.x = 0.05;   // drift: the regime this is about
        if (++n >= 12) {
          proto.fillRect = real;
          bg.renderStars = realStars;
          resolve({ calls, fractionalPos, fractionalSize, sample });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));

    expect(audit.calls).toBeGreaterThan(1000);
    // Genuinely sub-pixel — a zero here means the field silently snapped.
    expect(audit.fractionalPos).toBeGreaterThan(0);
    // …and sizes are whole pixels.
    expect(audit.fractionalSize,
      `star drawn at a fractional SIZE: ${JSON.stringify(audit.sample)}`).toBe(0);

    watch.assertClean();
  });

  test('regenerates the SAME sky — a DBG knob must not reshuffle the stars', async ({ page }) => {
    // Generation used unseeded Math.random, so every regeneration produced a
    // completely new random sky. That made the DBG cycles nearly impossible to
    // judge: changing the depth-layer count reshuffled every star, so it LOOKED
    // like the star count had changed when it was identical to within 0.03%.
    // Knobs that exist to be compared by looking have to hold everything else
    // still, so star generation is seeded per map.
    const watch = await boot(page);
    await startRun(page);
    await waitForEngine(page, e => e.renderer.backgroundManager.starX.length > 0, 'the star field');

    const snapshot = () => engine(page, e => {
      const bg = e.renderer.backgroundManager;
      // A cheap fingerprint of the whole field: positions of a spread sample.
      let h = 0;
      for (let i = 0; i < bg.starX.length; i += 37) {
        h = (Math.imul(h ^ bg.starX[i], 0x01000193) ^ bg.starY[i]) >>> 0;
      }
      return { hash: h, count: bg.starX.length, layers: bg.bandSpeed.length };
    });

    const before = await snapshot();

    // Cycle DEPTH and come all the way back around to the same setting.
    const steps = 4;   // STAR_BANDS_CYCLE length
    for (let i = 0; i < steps; i++) {
      await engine(page, e => e.dbg.cycleStarBands());
      await waitForEngine(page, e => e.renderer.backgroundManager.starX.length > 0, 'regeneration');
    }
    const after = await snapshot();

    expect(after.layers).toBe(before.layers);
    expect(after.count).toBe(before.count);
    // THE POINT: same seed, same sky. An unseeded generator fails this.
    expect(after.hash).toBe(before.hash);

    watch.assertClean();
  });

  test('parallax SPREAD is independent of the layer COUNT', async ({ page }) => {
    // The two were conflated before the spread became its own parameter: the
    // span between the farthest and nearest layer is set by SPREAD, so adding
    // LAYERS cuts the same range more finely rather than deepening it. That is
    // why raising the layer count reads as less separation, not more.
    const watch = await boot(page);
    await startRun(page);
    await waitForEngine(page, e => e.renderer.backgroundManager.starX.length > 0, 'the star field');

    const span = () => engine(page, e => {
      const sp = e.renderer.backgroundManager.bandSpeed;
      // Last entry is the milky way; the depth layers are everything before it.
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < sp.length - 1; i++) { lo = Math.min(lo, sp[i]); hi = Math.max(hi, sp[i]); }
      return { lo, hi, layers: sp.length - 1 };
    });

    const a = await span();

    // Change the LAYER COUNT. The endpoints must hold.
    //
    // The predicate is built with `new Function` so the expected value is
    // INLINED: `waitForEngine` serialises the callback with toString(), so an
    // arrow closing over a test-side variable references a name that does not
    // exist in the page and never resolves.
    await engine(page, e => e.dbg.cycleStarBands());
    await waitForEngine(
      page,
      new Function('e', `return e.renderer.backgroundManager.bandSpeed.length - 1 !== ${a.layers}`) as any,
      'the layer count to change',
    );
    const b = await span();

    expect(b.layers).not.toBe(a.layers);
    // Endpoints move only by the half-step sampling offset ((b+0.5)/N), which
    // shrinks as layers grow — so allow a small tolerance, not equality.
    expect(Math.abs(b.hi - a.hi)).toBeLessThan(a.hi * 0.05);
    expect(Math.abs(b.lo - a.lo)).toBeLessThan(0.05);

    // Now change the SPREAD. THAT must move the far end substantially.
    await engine(page, e => e.dbg.cycleStarParallax());
    await waitForEngine(
      page,
      new Function('e', `return Math.abs(e.renderer.backgroundManager.bandSpeed[e.renderer.backgroundManager.bandSpeed.length - 2] - ${b.hi}) > ${b.hi * 0.2}`) as any,
      'the parallax spread to change',
    );
    const c = await span();

    expect(c.layers).toBe(b.layers);          // spread did not touch the count
    expect(c.hi).toBeGreaterThan(b.hi * 1.5); // …but it moved the near end a lot
    // The floor is the far end and stays put: it is where the sky sits, not
    // how deep it goes.
    expect(Math.abs(c.lo - b.lo)).toBeLessThan(0.05);

    watch.assertClean();
  });

  test('the hub TEST RACK steps density down as it goes down the map', async ({ page }) => {
    // "Lower portals correspond to closer to a planet" — so the rack's vertical
    // order IS the density order, and +Y is DOWN. Two tables encode this (the
    // portal sites and the per-map densities) and nothing but this test stops
    // them drifting apart the moment either is edited.
    const watch = await boot(page);
    await startRun(page);

    const rack = await engine(page, e => {
      // Read the LIVE portals off the hub rather than the constants table, so
      // this checks what the player can actually fly to.
      const seen = e.portals.map((p: any) => ({
        target: p.portalTargetId as string,
        y: p.position.y as number,
      }));
      return seen;
    });

    // The six showcase destinations are the rack.
    const RACK_IDS = ['field_asteroid', 'field_glass', 'field_metal',
                      'field_plastic', 'field_rock', 'field_nebula'];
    const onRack = rack.filter(r => RACK_IDS.includes(r.target));
    expect(onRack.length).toBe(RACK_IDS.length);

    // Densities, read from the engine's own resolver so the test cannot
    // disagree with what the sky will actually be.
    const densities = await engine(page, (e, ids: string[]) => {
      const out: Record<string, number> = {};
      for (const id of ids) {
        const d = e.mapDescriptorFor ? e.mapDescriptorFor(id) : null;
        out[id] = d ? d.mapType : (null as any);
      }
      return out;
    }, RACK_IDS);
    expect(Object.keys(densities).length).toBe(RACK_IDS.length);

    // Sorted top-to-bottom (ascending y = descending altitude), density must
    // never increase.
    const byY = [...onRack].sort((a, b) => a.y - b.y);
    const order = byY.map(r => RACK_IDS.indexOf(r.target));
    // The rack table is declared densest-first, so the y-sorted order must be
    // exactly the declared order.
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);

    watch.assertClean();
  });

  test('every map the hub can reach carries a way home', async ({ page }) => {
    // The test rack made the showcase maps portal-reachable for the first time.
    // A destination you can enter but not leave is a trap, not a test — and it
    // would only be discovered by flying there, which is exactly the kind of
    // thing a suite should catch instead.
    const watch = await boot(page);
    await startRun(page);

    const targets = await engine(page, e => e.portals.map((p: any) => p.portalTargetId as string));
    expect(targets.length).toBeGreaterThanOrEqual(10);   // 4 arenas + 6 rack

    const stranded: string[] = [];
    for (const id of targets) {
      const home = await engine(page, (e, target: string) => {
        e.transitionToMap(target);
        // A return rift is one that points back at the hub.
        return e.portals.some((p: any) => p.portalTargetId === 'overworld');
      }, id);
      if (!home) stranded.push(id);
      // Go home for the next iteration.
      await engine(page, e => e.transitionToMap('overworld'));
    }

    expect(stranded, `maps with no way home: ${stranded.join(', ')}`).toEqual([]);

    watch.assertClean();
  });

  test('rebuilds the bands when the pixel ratio changes, not only the size', async ({ page }) => {
    // Device-resolution bands make the pixel RATIO a generation input, so the
    // render-scale cap (DBG ▸ Player ▸ Render scale) has to rebuild them even
    // though the CSS scene size is unchanged. Without that, the bands keep
    // their old device size and the blit silently stops being 1:1 — the exact
    // defect S3 removes, coming back through a different door.
    //
    // The cap itself is stepped in App.tsx, not on the engine, so this drives
    // the mechanism the cap relies on: stale the manager's recorded ratio and
    // require the next frame to notice. Writing an internal to SET UP a
    // scenario is allowed; the behaviour under test — the rebuild guard in
    // `render` — is still the real one (harness rule 6).
    const watch = await boot(page);
    await startRun(page);
    await waitForEngine(page, e => e.renderer.backgroundManager.starX.length > 0, 'the star field');

    const before = await readField(page);
    expect(before.bandPixelWidth).toBe(Math.round(before.sceneWidth * before.sceneDpr));

    await engine(page, e => {
      const bg = e.renderer.backgroundManager;
      // Pretend the bands were generated at a different ratio, and make the
      // recorded band size visibly wrong so a rebuild is observable rather
      // than assumed. (-1 can never be a real ratio.)
      bg.sceneDpr = -1;
      bg.bandPixelWidth = 1;
    });

    await waitForEngine(
      page,
      e => {
        const bg = e.renderer.backgroundManager;
        return bg.bandPixelWidth === Math.round(bg.sceneWidth * bg.sceneDpr);
      },
      'the field to be regenerated at the canvas ratio',
    );

    const after = await readField(page);
    expect(after.sceneDpr).toBeCloseTo(before.sceneDpr, 5);
    expect(after.bandPixelHeight).toBe(Math.round(after.sceneHeight * after.sceneDpr));
    expect(after.bands).toBe(before.bands);
    // The scene did not resize — only the ratio guard fired.
    expect(after.sceneWidth).toBe(before.sceneWidth);

    watch.assertClean();
  });

  test('scales the milky way with WIDTH — it is a line feature, not an area one', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await waitForEngine(page, e => e.renderer.backgroundManager.starX.length > 0, 'the star field');

    const before = await readField(page);

    // Double the width, halve the height: AREA is roughly unchanged, so an
    // area-scaled feature would not move. The milky way should still roughly
    // double, because its stars are strung along the width.
    await page.setViewportSize({ width: 780, height: 422 });
    await waitForEngine(
      page,
      e => e.renderer.backgroundManager.sceneWidth === 780,
      'the background to rebuild at double width',
    );
    const after = await readField(page);

    expect(after.milkyWayStarCount / before.milkyWayStarCount).toBeGreaterThan(1.8);
    expect(after.milkyWayStarCount / before.milkyWayStarCount).toBeLessThan(2.2);

    watch.assertClean();
  });

  test('the density cycle reaches PAST the per-map range, up to the old sky', async ({ page }) => {
    // S13, user report: a mobile browser handles 1200 easily at the 'device'
    // star size, so the ceiling is worth being able to look at. The cycle's top
    // steps therefore run above STAR_DENSITY_RANGE.MAX (729), up to ~2700 — the
    // density the field carried before S2 derived the count from area.
    //
    // What is asserted is that the high steps are REAL: an override of N puts N
    // stars per 10 000 CSS px² on screen. A step that silently clamped at MAX
    // would still cycle, still show its label, and change nothing — which is
    // exactly the failure mode the seeded sky was introduced to make visible.
    const watch = await boot(page);
    await startRun(page);
    await waitForEngine(page, e => e.renderer.backgroundManager.starX.length > 0, 'the star field');

    // Walk the whole cycle once and record every density it actually produces,
    // rather than assuming which index holds which step.
    //
    // Waiting on `initialized` rather than on the star count: the cycle only
    // invalidates the field and the next RENDER rebuilds it, and two adjacent
    // steps can legitimately produce the same count (AUTO resolves to the hub's
    // own 729, which is also an explicit step). `initialized` goes false on
    // invalidation and true again when the rebuild lands, which is the actual
    // event being waited for.
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      await engine(page, e => {
        e.dbg.cycleStarDensity();
        e.renderer.backgroundManager.initialized = false;
      });
      await waitForEngine(page, e => e.renderer.backgroundManager.initialized === true,
        'the field to regenerate');
      seen.push(densityOf(await readField(page)));
    }

    const top = Math.max(...seen);
    // Well past the top of the per-map range, and close to the pre-gauntlet sky.
    expect(top).toBeGreaterThan(DEFAULT_DENSITY * 1.5);
    expect(top).toBeGreaterThan(2600);
    expect(top).toBeLessThan(2800);

    // Every step lands on the density it names — ±1% for the per-band integer
    // rounding, which is the same tolerance the area test uses.
    for (const want of [1200, 1800, 2700]) {
      const hit = seen.find(d => Math.abs(d - want) < want * 0.01);
      expect(hit, `no cycle step produced ~${want}; got ${seen.map(Math.round).join(', ')}`)
        .toBeDefined();
    }

    watch.assertClean();
  });

  test('the DBG density override takes effect immediately, without a resize', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await waitForEngine(page, e => e.renderer.backgroundManager.starX.length > 0, 'the star field');

    const before = await readField(page);
    // The hub's own density is the top of the range, and AUTO resolves to it.
    expect(densityOf(before)).toBeGreaterThan(DEFAULT_DENSITY * 0.99);
    expect(densityOf(before)).toBeLessThan(DEFAULT_DENSITY * 1.01);

    // Star count is a GENERATION-time input, so the cycle has to invalidate the
    // background rather than only stepping the constant — otherwise the change
    // would not appear until the window was resized. That is what this asserts:
    // same viewport, different sky.
    //
    // Stepping until the count MOVES rather than assuming one step is enough:
    // the cycle leads with AUTO, and its first explicit step happens to equal
    // the hub's own density, so a single cycle legitimately changes nothing.
    let after = before;
    for (let i = 0; i < 4 && after.starCount === before.starCount; i++) {
      await engine(page, e => e.dbg.cycleStarDensity());
      await waitForEngine(page, e => e.renderer.backgroundManager.starX.length > 0, 'regeneration');
      after = await readField(page);
    }

    expect(after.starCount).not.toBe(before.starCount);
    // Viewport unchanged — only the density moved.
    expect(after.sceneWidth).toBe(before.sceneWidth);
    expect(after.sceneHeight).toBe(before.sceneHeight);

    watch.assertClean();
  });

  test('each map gets its OWN sky, and sparser skies parallax harder', async ({ page }) => {
    // The per-map density table is the point of the test rack: flying somewhere
    // else should change the sky. And the inverse relation is DERIVED rather
    // than hand-maintained, so it has to hold for every map without anyone
    // keeping two columns in sync.
    const watch = await boot(page);
    await startRun(page);
    await waitForEngine(page, e => e.renderer.backgroundManager.starX.length > 0, 'the star field');

    const sample = async (target: string) => {
      await engine(page, (e, t: string) => e.transitionToMap(t), target);
      await waitForEngine(page, e => e.renderer.backgroundManager.starX.length > 0, `sky for ${target}`);
      return engine(page, e => {
        const bg = e.renderer.backgroundManager;
        const sp = bg.bandSpeed;
        let hi = -Infinity;
        for (let i = 0; i < sp.length - 1; i++) hi = Math.max(hi, sp[i]);
        return {
          density: bg.starCount / ((bg.sceneWidth * bg.sceneHeight) / 1e4),
          spreadHi: hi,
        };
      });
    };

    // Top of the rack (densest) versus the bottom (sparsest).
    const dense = await sample('field_asteroid');
    const sparse = await sample('field_nebula');

    // Different maps, genuinely different skies.
    expect(dense.density).toBeGreaterThan(sparse.density * 3);

    // …and the spread runs the OTHER way, by construction.
    expect(sparse.spreadHi).toBeGreaterThan(dense.spreadHi * 3);

    watch.assertClean();
  });
});

/** PORTAL_LENS_CYCLE's length — how many clicks can be needed to reach any
 *  step from any other.  Kept here rather than imported: the suites drive the
 *  built app through its debug handles, never the source constants. */
const PORTAL_LENS_STEPS = 4;

test.describe('the wormhole star lens', () => {
  /** The DBG Lens knob has to CHANGE something, and this is the test that
   *  says so — because the shipped lens failed exactly that.
   *
   *  Its shear was `f^2 x (WIND + elapsed x RATE)`: an angle that grew without
   *  bound with wall-clock time.  Every 2*PI of accumulated twist is one
   *  visible band of stars, so the field wound itself into ~4 bands a minute
   *  in and ~10 after three, and scaling a 60-radian twist by 0.25 still left
   *  ~15 radians — far past 2*PI, so the knob could not change the band COUNT
   *  and read as doing nothing.  The shear is capped below one turn now and
   *  BREATHES rather than accumulating, which makes the knob linear in what
   *  the eye actually reads.
   *
   *  Measured off the PIXELS, the exception this suite already makes for the
   *  star field (harness rule 3 — read the sim unless the thing exists only
   *  as pixels).  There is no sim-side number for "how bent the sky looks".
   *
   *  The metric is ONE scalar: the star coverage where the lens PILES stars
   *  up, minus the coverage where it EVACUATES them.  Both halves move the
   *  same way as strength rises, so the difference doubles the signal and
   *  cancels whatever the sky happened to be doing.  Sampled in the UPPER
   *  half only, which is what keeps the destination label and the ship — both
   *  drawn below the rift — out of the numbers. */
  test('the Lens knob monotonically changes the warp, and only near the rift', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    /** Star coverage (% lit) in 20-CSS-px annuli above the rift's centre.
     *
     *  RE-PARKS THE SHIP FIRST, EVERY TIME, and that is not tidiness: the
     *  player sits inside the rift's own gravity well, so between samples it
     *  drifts toward the mouth, the camera follows, and each reading lands on
     *  a DIFFERENT patch of sky.  That confound is bigger than the warp at the
     *  weakest lens setting — it inverted the 0.25x-vs-off comparison in a
     *  full-suite run while passing in isolation, because a busier machine
     *  means more sim time (and so more drift) between readings.  Parking to
     *  the same spot each time makes the sampled sky identical and the knob
     *  the only variable.  Residual drift over the settle below is ~1px. */
    const bands = async (): Promise<number[]> => {
      await engine(page, e => {
        // The hub's Deep Space rift: the biggest horizon, so the warped
        // region is comfortably wider than the sampling bands.
        const p = e.portals.find((x: any) => x.portalTargetId === 'arena_universe');
        e.player.position.x = p.position.x;
        e.player.position.y = p.position.y + 300;
        e.player.velocity.x = 0;
        e.player.velocity.y = 0;
      });
      await page.waitForTimeout(500);
      return page.evaluate(() => {
        const e = (window as any).__omniEngine;
        const cv = document.querySelector('canvas') as HTMLCanvasElement;
        const ctx = cv.getContext('2d')!;
        const dpr = cv.width / cv.clientWidth;
        const p = e.portals.find((x: any) => x.portalTargetId === 'arena_universe');
        const cam = e.camera;
        const sx = (cv.clientWidth / 2 + (p.position.x - cam.position.x) * cam.zoom) * dpr;
        const sy = (cv.clientHeight / 2 + (p.position.y - cam.position.y) * cam.zoom) * dpr;
        const R = Math.round(280 * dpr);
        const x0 = Math.max(0, Math.round(sx - R)), y0 = Math.max(0, Math.round(sy - R));
        const w = Math.min(cv.width - x0, 2 * R), h = Math.min(cv.height - y0, 2 * R);
        const img = ctx.getImageData(x0, y0, w, h).data;
        const BANDS = 14, bandPx = 20 * dpr;
        const lit = new Array(BANDS).fill(0), tot = new Array(BANDS).fill(0);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const dy = (y0 + y) - sy;
            if (dy > 0) continue;                       // upper half only
            const b = Math.floor(Math.hypot((x0 + x) - sx, dy) / bandPx);
            if (b >= BANDS) continue;
            const i = (y * w + x) * 4;
            tot[b]++;
            if (img[i] + img[i + 1] + img[i + 2] > 90) lit[b]++;
          }
        }
        return lit.map((v, i) => (v / Math.max(1, tot[i])) * 100);
      });
    };

    // Band 2 (40-60px) is where the throat is emptied; band 4 (80-100px) is
    // where those stars land.  Band 0 is inside the black disc and band 1
    // straddles its edge, so neither says anything.
    const warp = (b: number[]) => b[4] - b[2];

    /** Drive the Lens knob to a NAMED step and prove it landed there.
     *
     *  Cycling N times from an assumed starting index is what makes a knob
     *  test order-dependent: one stray cycle and every later reading is
     *  silently taken at the wrong setting, which surfaces as a baffling
     *  VALUE failure ("no lens" measuring a full warp) rather than as "the
     *  knob was in the wrong place".  Driving to the label instead makes the
     *  test immune to where the cycle happened to start. */
    const setLens = async (label: string) => {
      for (let i = 0; i < PORTAL_LENS_STEPS + 1; i++) {
        const now = await page.evaluate(() => (window as any).__omniStats?.portalLensName);
        if (now === label) return;
        await engine(page, e => e.dbg.cyclePortalLens());
      }
      throw new Error(`could not reach lens "${label}"`);
    };

    await setLens('1×');
    const full = warp(await bands());
    await setLens('0.5×');
    const half = warp(await bands());
    await setLens('0.25×');
    const quarter = warp(await bands());
    await setLens('off');
    const offBands = await bands();
    const off = warp(offBands);

    // Every step down flattens the sky, by a margin set at roughly HALF the
    // measured gap.  Over four runs with the geometry held still:
    //
    //   1.00x  2.92 - 3.05      0.50x  1.34 - 1.62
    //   0.25x  0.27 - 0.38      off   -0.16 - -0.14
    //
    // so the gaps are ~1.4 / ~1.1 / ~0.47 against the thresholds below.
    expect(full, `full ${full} vs half ${half}`).toBeGreaterThan(half + 0.6);
    expect(half, `half ${half} vs quarter ${quarter}`).toBeGreaterThan(quarter + 0.5);
    expect(quarter, `quarter ${quarter} vs off ${off}`).toBeGreaterThan(off + 0.2);
    // With the lens off there is no warp at all — the field is flat, which is
    // what makes the readings above differences in the LENS and not in the sky.
    expect(Math.abs(off)).toBeLessThan(1);

    // The warp is LOCAL: past the lens radius the field is untouched at every
    // setting.  Without this the test would also pass on a lens that merely
    // dimmed the whole sky.
    await setLens('1×');
    const fullBands = await bands();
    for (const b of [9, 11, 13]) {
      expect(Math.abs(fullBands[b] - offBands[b]),
        `far band ${b}: ${fullBands[b]} vs ${offBands[b]}`).toBeLessThan(1);
    }

    watch.assertClean();
  });
});
