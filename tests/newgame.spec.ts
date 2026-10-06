/** NEW GAME on the main menu — the front door's way to erase a character.
 *
 *  Only offered when the save holds progress, asks twice (arm, then confirm),
 *  erases the character, records and wreck, keeps settings, and begins a run.
 */
import { test, expect } from '@playwright/test';
import { boot, stats, engine, waitForStats } from './helpers';

test.describe('new game', () => {
  test('is hidden on a fresh character, offered once there is progress, and asks twice', async ({ page }) => {
    await boot(page);
    await expect(page.getByTestId('menu-new-game')).toHaveCount(0);

    await engine(page, e => { e.addDebugCredits(500); e.saveNow(); });
    await waitForStats(page, s => !!s.savedGame?.progress, 'a saved character');
    await expect(page.getByTestId('menu-new-game')).toBeVisible();

    // First tap only arms it: nothing is erased, no run has started.
    await page.getByTestId('menu-new-game').click();
    await expect(page.getByTestId('menu-new-game-confirm')).toBeVisible();
    expect((await stats(page)).gameState).toBe('MENU');
    expect((await stats(page)).credits).toBeGreaterThan(0);

    // Cancel backs out with the character intact.
    await page.getByTestId('menu-new-game-cancel').click();
    await expect(page.getByTestId('menu-new-game')).toBeVisible();
    expect((await stats(page)).credits).toBeGreaterThan(0);
  });

  test('confirming erases the character, keeps settings, and starts a run', async ({ page }) => {
    await boot(page);
    await engine(page, e => { e.addDebugCredits(500); e.saveNow(); });
    await waitForStats(page, s => !!s.savedGame?.progress, 'a saved character');
    const before = await engine(page, e => e.difficultyLevel);

    await page.getByTestId('menu-new-game').click();
    await page.getByTestId('menu-new-game-yes').click();
    await waitForStats(page, s => s.gameState === 'PLAYING', 'a started run');

    const s = await stats(page);
    expect(s.credits).toBe(0);
    expect(await engine(page, e => e.difficultyLevel)).toBe(before);
    // The wipe was written at once, so it survives a relaunch.
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('omni.save') ?? '{}'));
    expect(saved.character?.credits ?? 0).toBe(0);
  });
});
