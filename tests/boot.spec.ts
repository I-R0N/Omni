/** Boot smoke — the harness's own canary.
 *
 *  Deliberately shallow.  Its job is to prove the whole chain works before
 *  any suite that depends on it runs: the build served, the bundle parsed,
 *  React mounted, the engine constructed, the rAF loop started, and the two
 *  debug handles the rest of the suites are built on are live.  When
 *  everything else in `tests/` fails at once, this file says whether the
 *  problem is the game or the harness.
 */

import { test, expect } from '@playwright/test';
import { boot, stats, engine, waitForStats } from './helpers';

test.describe('boot', () => {
  test('reaches the main menu with the debug handles live and the console clean', async ({ page }) => {
    const watch = await boot(page);

    // The front door is three controls (CLAUDE.md §3): DIFFICULTY, START and
    // a collapsed debug dropdown.  START is the one a player needs.
    await expect(page.getByTestId('menu-start')).toBeVisible();
    await expect(page.getByTestId('menu-debug-toggle')).toBeVisible();

    // Handle 1: the stats payload the HUD renders from.
    const s = await stats(page);
    expect(s.gameState).toBe('MENU');
    // A run always begins on the hub, and the engine loads it at construction
    // — before START is ever pressed (CLAUDE.md §3).
    expect(s.currentMapType).toBe('OVERWORLD');
    expect(s.entityCount).toBeGreaterThan(0);

    // Handle 2: the live engine.  Identified by CAPABILITY, not by class
    // name — `vite build` minifies constructor names, so `e.constructor.name`
    // is a build artifact ('_t') and asserting on it tests the bundler.
    const shape = await engine(page, e => ({
      canStart: typeof e.startGame === 'function',
      canPause: typeof e.pauseGame === 'function',
      canTransition: typeof e.transitionToMap === 'function',
      hasMap: !!e.currentMap,
      hasPlayer: !!e.player,
      mapHasEntities: (e.currentMap?.entities?.length ?? 0) > 0,
    }));
    expect(shape).toEqual({
      canStart: true,
      canPause: true,
      canTransition: true,
      hasMap: true,
      hasPlayer: true,
      mapHasEntities: true,
    });

    // The loop is actually running: stats are being republished, not frozen
    // at their construction-time values.
    await waitForStats(page, s2 => s2.fps > 0, 'a nonzero frame rate');

    watch.assertClean();
  });

  test('START begins a run on the hub', async ({ page }) => {
    const watch = await boot(page);

    await page.getByTestId('menu-start').click();
    const s = await waitForStats(page, s2 => s2.gameState === 'PLAYING', 'PLAYING');

    expect(s.currentMapType).toBe('OVERWORLD');
    // The hub runs no waves — the registry is the single source of truth for
    // that (CLAUDE.md §6a), and the HUD reads it straight through.
    expect(s.wavesEnabled).toBeFalsy();

    watch.assertClean();
  });
});
