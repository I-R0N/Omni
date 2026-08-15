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
    return {
      bands: bg.starBands.length,
      starsPerBand: bg.starsPerBand,
      starCount: bg.starCount,
      milkyWayStarCount: bg.milkyWayStarCount,
      sceneWidth: bg.sceneWidth,
      sceneHeight: bg.sceneHeight,
      sceneDpr: bg.sceneDpr,
      bandPixelWidth: bg.bandPixelWidth,
      bandPixelHeight: bg.bandPixelHeight,
      bandCanvasW: bg.starBands.length ? bg.starBands[0].canvas.width : 0,
      bandCanvasH: bg.starBands.length ? bg.starBands[0].canvas.height : 0,
    };
  });

/** Stars per 10 000 CSS px² for a measured field. */
const densityOf = (f: { starCount: number; sceneWidth: number; sceneHeight: number }) =>
  f.starCount / ((f.sceneWidth * f.sceneHeight) / 1e4);

test.describe('the star field', () => {
  test('derives its star count from viewport AREA at the target density', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await waitForEngine(page, e => e.renderer.backgroundManager.starBands.length > 0, 'star bands');

    const f = await readField(page);

    // The parallax structure survives the density change — S2 changed the
    // BUDGET, not the number of depth layers.
    expect(f.bands).toBe(NUM_BANDS);
    expect(f.starsPerBand).toBeGreaterThan(0);
    expect(f.starCount).toBe(f.starsPerBand * f.bands);

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
    await waitForEngine(page, e => e.renderer.backgroundManager.starBands.length > 0, 'star bands');

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

    // Band canvases follow the viewport, and the band COUNT does not.
    expect(desktop.bands).toBe(NUM_BANDS);
    expect(desktop.bandCanvasW).toBe(Math.round(1000 * desktop.sceneDpr));
    expect(desktop.bandCanvasH).toBe(Math.round(1100 * desktop.sceneDpr));

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
    await waitForEngine(page, e => e.renderer.backgroundManager.starBands.length > 0, 'star bands');

    const f = await readField(page);

    // The manager tracked the ratio it generated at, and it is the CAPPED one
    // (`effectiveDpr`), which is the same accessor the canvas was sized with.
    expect(f.sceneDpr).toBeGreaterThan(0);
    const canvasDpr = await engine(page, e => e.renderer.ctx.canvas.width / e.renderer.ctx.canvas.clientWidth);
    expect(Math.abs(f.sceneDpr - canvasDpr)).toBeLessThan(0.01);

    // Band backing store is the scene in DEVICE pixels — the 1:1 blit target.
    expect(f.bandPixelWidth).toBe(Math.round(f.sceneWidth * f.sceneDpr));
    expect(f.bandPixelHeight).toBe(Math.round(f.sceneHeight * f.sceneDpr));
    expect(f.bandCanvasW).toBe(f.bandPixelWidth);
    expect(f.bandCanvasH).toBe(f.bandPixelHeight);

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
    await waitForEngine(page, e => e.renderer.backgroundManager.starBands.length > 0, 'star bands');

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
      'the bands to be regenerated at the canvas ratio',
    );

    const after = await readField(page);
    expect(after.sceneDpr).toBeCloseTo(before.sceneDpr, 5);
    expect(after.bandCanvasW).toBe(after.bandPixelWidth);
    expect(after.bandCanvasH).toBe(after.bandPixelHeight);
    expect(after.bands).toBe(before.bands);
    // The scene did not resize — only the ratio guard fired.
    expect(after.sceneWidth).toBe(before.sceneWidth);

    watch.assertClean();
  });

  test('scales the milky way with WIDTH — it is a line feature, not an area one', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await waitForEngine(page, e => e.renderer.backgroundManager.starBands.length > 0, 'star bands');

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
    await waitForEngine(page, e => e.renderer.backgroundManager.starBands.length > 0, 'star bands');

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
      e => e.renderer.backgroundManager.starCount !== undefined
        && e.renderer.backgroundManager.starBands.length > 0
        && e.renderer.backgroundManager.starsPerBand > 0,
      'the bands to regenerate',
    );
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
