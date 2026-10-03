/** THE SAVE FILE, in the real browser (plan D10, D14, D20–D24).
 *
 *  `tests/sim/persistence.test.ts` pins the logic headless against a
 *  `MemoryStorage`.  This suite is the part only a browser can say: that the
 *  Storage port really is `localStorage`, that a RELOAD is a relaunch (the page
 *  is thrown away; only what was written survives), and that the death screen
 *  shows the wreck.  A fresh Playwright context starts with empty storage, so
 *  every other suite still begins on a new character.
 */
import { test, expect } from '@playwright/test';
import { boot, engine, stats, startRun, waitForStats } from './helpers';

test.describe.configure({ timeout: 180_000 });

test('credits, cargo, hex slots and settings survive a reload', async ({ page }) => {
  await boot(page);
  await engine(page, e => {
    e.credits = 4321;
    e.inventory[2] = 'plating_mk1';
    e.shipSlotsUnlocked = 5;
    e.audio.setVolume(0.3);
    e.setControlScheme('joystick-left');
    e.setDifficulty(1);
    e.saveNow();
  });
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__omniEngine && !!(window as any).__omniStats);
  const after = await engine(page, e => ({
    credits: e.credits, cargo: e.inventory[2], slots: e.shipSlotsUnlocked,
    volume: e.audio.volume, scheme: e.input.getControlScheme(), difficulty: e.getDifficulty(),
  }));
  expect(after).toEqual({ credits: 4321, cargo: 'plating_mk1', slots: 5, volume: 0.3, scheme: 'joystick-left', difficulty: 1 });
  // The menu's difficulty control shows the saved value, not the default.
  expect((await stats(page)).difficulty).toBe(1);
});

test('the autosave writes on its own, with nothing calling saveNow', async ({ page }) => {
  await boot(page);
  await engine(page, e => { e.credits = 555; });
  await page.waitForFunction(() => {
    const raw = window.localStorage.getItem('omni.save');
    return raw !== null && JSON.parse(raw).character.credits === 555;
  }, null, { timeout: 15_000 });
});

test('a corrupt save is parked, not eaten, and the game starts fresh', async ({ page }) => {
  await page.addInitScript(() => { window.localStorage.setItem('omni.save', '{{{ not json'); });
  const watch = await boot(page);
  expect(await engine(page, e => e.credits)).toBe(0);
  expect(await page.evaluate(() => window.localStorage.getItem('omni.save.unreadable'))).toBe('{{{ not json');
  watch.assertClean();
});

test.describe('the death wreck', () => {
  /** Mount gear, fly to an arena and die in it; leave the death screen up. */
  async function fall(page: any) {
    await startRun(page);
    await engine(page, e => {
      e.debugGrantModule('hull_mk2');
      e.debugGrantModule('gunnery_mk1');
      e.credits = 900;
    });
    await engine(page, e => { e.transitionToMap('arena_pocket'); });
    await engine(page, e => { e.player.health = 0; });
    await waitForStats(page, s => !!s.runSummary, 'the death screen', 90_000);
  }

  test('the death screen names the wreck; respawn keeps credits and strips the ship', async ({ page }) => {
    await boot(page);
    await fall(page);
    await expect(page.getByTestId('death-wreck')).toBeVisible();
    const rs = (await stats(page)).runSummary!;
    expect(rs.wreck!.modules).toBeGreaterThanOrEqual(2);
    expect(rs.wreck!.mapName).toBe('Pocket');
    await page.getByTestId('death-respawn').click();
    await waitForStats(page, s => !s.runSummary, 'respawn');
    const after = await engine(page, e => ({
      credits: e.credits,
      mounted: [...e.shipSlots, ...e.weaponSlots].filter((s: string | null) => s && s !== 'hull_base' && s !== 'dlv_projectile').length,
      wreck: !!e.wreck,
    }));
    expect(after).toEqual({ credits: 900, mounted: 0, wreck: true });
  });

  test('quitting on the death screen and relaunching keeps the strip AND the wreck, pinned to its arena', async ({ page }) => {
    await boot(page);
    await fall(page);
    const seed = await engine(page, e => e.wreck.seed);
    await page.reload();
    await page.waitForFunction(() => !!(window as any).__omniEngine && !!(window as any).__omniStats);
    const relaunched = await engine(page, e => ({
      mounted: [...e.shipSlots, ...e.weaponSlots].filter((s: string | null) => s && s !== 'hull_base' && s !== 'dlv_projectile').length,
      wreck: e.wreck && { arena: e.wreck.arenaId, seed: e.wreck.seed },
    }));
    expect(relaunched.mounted).toBe(0);
    expect(relaunched.wreck).toEqual({ arena: 'arena_pocket', seed });
    // Fly back: the arena is pinned, and touching the wreck gives the gear back.
    await startRun(page);
    await engine(page, e => { e.transitionToMap('arena_pocket'); });
    const pinned = await engine(page, e => e.arenaSeed);
    expect(pinned).toBe(seed);
    await engine(page, e => { const w = e.wreckEntity; e.player.position = { x: w.position.x, y: w.position.y }; });
    await page.waitForFunction(() => (window as any).__omniEngine.wreck === null, null, { timeout: 15_000 });
    const back = await engine(page, e => [...e.shipSlots, ...e.weaponSlots].filter((s: string | null) => s && s !== 'hull_base' && s !== 'dlv_projectile').length);
    expect(back).toBeGreaterThanOrEqual(2);
  });
});
