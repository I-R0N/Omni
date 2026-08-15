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
const DEFAULT_DENSITY = 185;
/** `STARFIELD_CONSTANTS.NUM_BANDS`. */
const NUM_BANDS = 60;

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
    await waitForEngine(
      page,
      new Function('e', `return e.renderer.backgroundManager.bandOffsetX[59] !== ${JSON.stringify(before[59])}`) as any,
      'the nearest layer to scroll',
    );

    const after = await engine(page, e => Array.from<number>(e.renderer.backgroundManager.bandOffsetX));
    const speeds = await engine(page, e => Array.from<number>(e.renderer.backgroundManager.bandSpeed));

    // Layer speed rises quadratically with depth index, so a near layer must
    // outrun a far one. Offsets wrap, so compare the SPEED table that drives
    // them plus the fact that the field moved at all.
    expect(speeds[59]).toBeGreaterThan(speeds[0] * 10);
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

  test('the DBG density cycle takes effect immediately, without a resize', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await waitForEngine(page, e => e.renderer.backgroundManager.starX.length > 0, 'the star field');

    const before = await readField(page);
    // Within 1% of the nominal density: the budget is split into a WHOLE
    // number of stars per band, so the realised density lands slightly under
    // the target (6060 stars rather than 6089 at 390x844).
    expect(densityOf(before)).toBeGreaterThan(DEFAULT_DENSITY * 0.99);
    expect(densityOf(before)).toBeLessThanOrEqual(DEFAULT_DENSITY);

    // Star count is a GENERATION-time input, so the cycle has to invalidate
    // the background rather than only stepping the constant — otherwise the
    // change would not appear until the window was resized. That is exactly
    // what this asserts: same viewport, new density.
    await engine(page, e => e.dbg.cycleStarDensity());
    await waitForEngine(
      page,
      new Function('e', `return e.renderer.backgroundManager.starCount !== ${before.starCount}`) as any,
      'the star count to change',
    );

    const after = await readField(page);
    // Viewport unchanged — only the density moved.
    expect(after.sceneWidth).toBe(before.sceneWidth);
    expect(after.sceneHeight).toBe(before.sceneHeight);
    // Second step of the cycle is denser than the default.
    expect(after.starCount).toBeGreaterThan(before.starCount);

    watch.assertClean();
  });
});
