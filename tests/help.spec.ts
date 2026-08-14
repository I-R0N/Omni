/** The Controls & Basics panel (Pair C, c1).
 *
 *  Two questions only, because they are the two that a help panel gets wrong:
 *
 *  1. **Is it reachable, and is it the same panel in both places?**  It is
 *     rendered by one function shared by the main menu and the pause menu, so
 *     "the same" is asserted as identical row text rather than as a hunch.
 *  2. **Does it fit the phone?**  390 px wide, at the bottom of a scrolling
 *     overlay, with a fixed-width control column beside wrapping prose — the
 *     exact shape that overflows sideways if the column is too wide.
 *
 *  What it deliberately does NOT assert: that the described controls are the
 *  controls. No test can — a help panel is prose. That accuracy is a review
 *  matter, which is why the copy was written from the mappings G2/G3 bound
 *  rather than from a plan.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, stats, startRun, waitForStats } from './helpers';

const PHONE_W = 390;

/** Every control-column label in the open panel, in order. */
async function helpRows(page: any): Promise<string[]> {
  return page.$$eval(
    '[data-testid="help-panel"] .font-mono',
    (els: Element[]) => els.map(e => (e.textContent || '').trim()),
  );
}

test.describe('controls & basics — reachable from both menus', () => {
  test('opens from the main menu and fits 390px', async ({ page }) => {
    const watch = await boot(page);

    // Collapsed by default: the front door stays DIFFICULTY / START.
    await expect(page.getByTestId('help-panel')).toHaveCount(0);

    const toggle = page.getByTestId('menu-help-toggle');
    await expect(toggle).toBeVisible();
    // The toggle is itself a tap target on glass.
    const tb = await toggle.boundingBox();
    expect(tb!.height).toBeGreaterThanOrEqual(28);

    await toggle.click();
    const panel = page.getByTestId('help-panel');
    await expect(panel).toBeVisible();

    const box = await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE_W);

    // Nothing inside pushes the page sideways — the failure mode for a
    // fixed-basis label column next to prose.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Every row is inside the viewport too, not just the panel's own box.
    const rows = await page.$$eval('[data-testid="help-panel"] .font-mono', (els: Element[]) =>
      els.map(e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; }));
    expect(rows.length).toBeGreaterThan(15);
    for (const r of rows) {
      expect(r.l).toBeGreaterThanOrEqual(0);
      expect(r.r).toBeLessThanOrEqual(PHONE_W);
    }

    watch.assertClean();
  });

  test('opens from the pause menu with the same content', async ({ page }) => {
    const watch = await boot(page);

    await page.getByTestId('menu-help-toggle').click();
    const fromMenu = await helpRows(page);
    await page.getByTestId('menu-help-toggle').click();

    await startRun(page);
    await engine(page, e => e.pauseGame());
    await waitForStats(page, s => s.gameState === 'PAUSED', 'the pause menu');

    await expect(page.getByTestId('help-panel')).toHaveCount(0);
    await page.getByTestId('pause-help-toggle').click();
    await expect(page.getByTestId('help-panel')).toBeVisible();

    const fromPause = await helpRows(page);
    expect(fromPause).toEqual(fromMenu);

    const box = await page.getByTestId('help-panel').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE_W);

    watch.assertClean();
  });

  test('covers every scheme and the run basics', async ({ page }) => {
    const watch = await boot(page);
    await page.getByTestId('menu-help-toggle').click();

    const text = (await page.getByTestId('help-panel').textContent()) ?? '';
    // One section per control scheme, plus the run. If a device section is
    // ever dropped, the panel silently stops answering the question it
    // exists for.
    for (const heading of ['Touch', 'Joystick touch', 'Keyboard & mouse', 'Gamepad', 'The run']) {
      expect(text, `missing section: ${heading}`).toContain(heading);
    }

    const rows = await helpRows(page);
    // Spot-check the three controls a player cannot discover by poking at
    // the screen, one per device.
    expect(rows).toContain('E');
    expect(rows).toContain('Start / Options');
    expect(rows).toContain('Hold 1s, release');
    // Pad buttons are named by POSITION, not by PlayStation glyph: the
    // bindings are positional, so "□" reads wrong in an Xbox player's hands.
    expect(rows).toContain('Right trigger');

    // No pad is attached in this browser, so the live badge must be absent —
    // one of the two parts of this panel the engine drives.
    expect(text).not.toContain('connected');

    watch.assertClean();
  });

  test('the panel follows the picked scheme, and the picker changes it', async ({ page }) => {
    const watch = await boot(page);

    // The picker is on the front door, next to Difficulty, because it is the
    // same kind of choice: a preference that shapes the whole run.
    await expect(page.getByTestId('scheme-picker')).toBeVisible();
    for (const id of ['touch', 'joystick-left', 'joystick-right', 'keyboard', 'gamepad']) {
      const box = await page.getByTestId(`scheme-${id}`).boundingBox();
      expect(box, `${id} button should be laid out`).not.toBeNull();
      // Thumb-sized on the phone, and inside it.
      expect(box!.height).toBeGreaterThanOrEqual(36);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE_W);
    }

    await page.getByTestId('scheme-joystick-left').click();
    await waitForStats(page, s => s.controlScheme === 'joystick-left', 'the joystick scheme');

    // The help panel marks the active scheme, so the block a player reads is
    // the one describing the controls they actually have.
    await page.getByTestId('menu-help-toggle').click();
    const active = await page.$$eval('[data-testid="help-panel"] h4', els =>
      els.filter(e => (e.textContent || '').includes('active')).map(e => (e.textContent || '').trim()));
    expect(active).toHaveLength(1);
    expect(active[0]).toContain('Joystick');

    // And it survives a restart, like difficulty — it describes the player's
    // hands, not the run.
    await engine(page, e => { e.startGame(); e.restartGame(); });
    expect((await stats(page)).controlScheme).toBe('joystick-left');

    watch.assertClean();
  });

  test('the pause menu changes it through a dropdown', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await engine(page, e => e.pauseGame());
    await waitForStats(page, s => s.gameState === 'PAUSED', 'the pause menu');

    // A native <select>: on a phone it opens the OS picker, which is a better
    // target than anything drawn here, and the pause menu is already a long
    // scroll without five captioned buttons in it.
    const select = page.getByTestId('scheme-select');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('touch');

    const box = await select.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(30);
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE_W);

    // Every scheme is reachable from it, including both handednesses.
    const options = await select.locator('option').evaluateAll(
      els => els.map(e => (e as HTMLOptionElement).value));
    expect(options).toEqual(['touch', 'joystick-left', 'joystick-right', 'keyboard', 'gamepad']);

    await select.selectOption('joystick-right');
    await waitForStats(page, s => s.controlScheme === 'joystick-right', 'the mirrored scheme');

    // Mid-run, so it takes effect on resume rather than at the next restart.
    await engine(page, e => e.resumeGame());
    await waitForStats(page, s => s.gameState === 'PLAYING', 'the resumed run');
    expect((await stats(page)).controlScheme).toBe('joystick-right');

    watch.assertClean();
  });
});
