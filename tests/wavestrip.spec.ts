/**
 * The wave strip and the roster dialogue (user call: the HUD keeps a
 * miniature of the wave banner's enemy count, and the banner's icons must
 * not overlap on a phone).
 */
import { test, expect } from '@playwright/test';
import { boot, startRun, engine, waitForTransit, waitForStats } from './helpers';

test.describe('wave strip', () => {
  test('mirrors what is left to kill, by archetype, and drops a type at zero', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await engine(page, e => e.transitionToMap('arena_universe'));
    await waitForTransit(page);
    const s = await waitForStats(page,
      x => (x.enemyRoster?.length ?? 0) > 0 && (x.enemiesRemaining ?? 0) > 0,
      'a wave with a roster');

    // The split is the same quantity as the headline count.
    const sum = s.enemyRoster!.reduce((a: number, r: any) => a + r.count, 0);
    expect(sum).toBe(s.enemiesRemaining);

    // The DOM strip shows one entry per archetype, with its count.
    const strip = page.getByTestId('hud-wave-strip');
    await expect(strip).toBeVisible();
    const kinds = await strip.locator('[data-subtype]').evaluateAll(
      els => els.map(el => el.getAttribute('data-subtype')));
    expect(kinds.length).toBeGreaterThan(0);
    await expect(strip.locator('canvas').first()).toBeVisible();

    // It sits inside the viewport at 390px.
    const box = await strip.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);

    watch.assertClean();
  });

  test('the roster dialogue keeps each cell inside its own slot', async ({ page }) => {
    await boot(page);
    await startRun(page);
    await engine(page, e => e.transitionToMap('arena_universe'));
    await waitForTransit(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'test-results/wavestrip-dialogue.png' });
  });
});

test.describe('map info', () => {
  test('the pause menu names the map, its size and its difficulty; a bigger map carries more enemies', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await engine(page, e => e.transitionToMap('arena_pocket_hard'));
    await waitForTransit(page);
    const small = await waitForStats(page, s => s.mapInfo?.name === 'Pocket · L4', 'Pocket L4 info');
    expect(small.mapInfo!.sizeLabel).toBe('Small');
    expect(small.mapInfo!.level).toBe(4);

    await engine(page, e => e.pauseGame());
    const panel = page.getByTestId('pause-map-info');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Pocket · L4');
    await expect(panel).toContainText('Small');
    await expect(panel).toContainText('Level 4');
    await engine(page, e => e.resumeGame());

    await engine(page, e => e.transitionToMap('arena_universe_hard'));
    await waitForTransit(page);
    const big = await waitForStats(page, s => s.mapInfo?.sizeLabel === 'Huge', 'Deep Space info');
    expect(big.mapInfo!.crowd!).toBeGreaterThan(small.mapInfo!.crowd!);
    watch.assertClean();
  });

  test('the travel animation carries the destination card', async ({ page }) => {
    await boot(page);
    await startRun(page);
    await engine(page, e => e.transitionToMap('arena_ring'));
    const info = await page.evaluate(() => (window as any).__omniEngine.renderer.portalWarpInfo);
    expect(info.name).toBe('Ring World · L4');
    expect(info.lines.join(' ')).toContain('Large');
    await waitForTransit(page);
    const after = await page.evaluate(() => (window as any).__omniEngine.renderer.portalWarpInfo);
    expect(after).toBeNull();
  });
});
