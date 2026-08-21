/** The flashlight TOOL — equipment you tap, not a debug setting.
 *
 *  The lighting gauntlet shipped the player's beam always-on ('beam' was the
 *  DBG default). This pass reframed it (user call): the flashlight is an
 *  in-game TOOL — tapping your own ship in open space cycles it
 *  off → medium → high — and the tool exists only while the FLASHLIGHT KIT
 *  module is installed and active, the same everything-is-a-module pattern
 *  as the Shield core. A kit-less ship carries no beam at all: the DBG
 *  flashlight global now ships 'off' and stays as the raw dev override
 *  underneath the tool.
 *
 *  What is pinned:
 *   1. THE KIT GATES THE TOOL — no kit, no cycle, no beam; installed and
 *      hull-adjacent, the cycle walks off/medium/high and the renderer
 *      override follows.
 *   2. THE GESTURE IS THE SHIP TAP, and the arbitration holds — a dock in
 *      range still wins the tap; open space cycles the light instead of
 *      firing a stray shot at your own hull.
 *   3. UNINSTALLING TURNS IT OFF — a removed tool must not leave its beam
 *      burning.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, startRun, waitForStats, waitForEngine } from './helpers';

/** FLASHLIGHT_TOOL_LEVELS, hard-coded (harness rule 7): both ON levels wear
 *  the BEAM style (40-degree half-angle); what separates them is the
 *  LIGHTING TIER — medium runs the light system at 'medium', high at 'high'
 *  (user call). */
const BEAM_HALF_DEG = 40;

async function openSpace(page: any) {
  await startRun(page, 'GLASS_FIELD');
  await waitForStats(page, s => s.currentMapType === 'GLASS_FIELD', 'the glass field');
  await engine(page, e => {
    e.player.position.x += 4000; e.player.position.y += 4000;
    e.player.velocity.x = 0; e.player.velocity.y = 0;
  });
}

test.describe('the kit gates the tool', () => {
  test('no kit: no cycle, no beam — and the DBG global ships off', async ({ page }) => {
    const watch = await boot(page);
    await openSpace(page);

    const r = await engine(page, e => ({
      equipped: e.flashlightEquipped,
      cycled: e.cycleShipLight(),
      level: e.flashlightLevel,
      override: e.renderer.playerLightToolHalfDeg,
      dbgDefault: e.renderer.getFlashlight(),
    }));
    expect(r.equipped, 'the lean start carries no kit').toBe(false);
    expect(r.cycled, 'and the cycle refuses').toBe(false);
    expect(r.level).toBe(0);
    expect(r.override, 'no tool override').toBe(null);
    // The old always-on searchlight is gone: the raw DBG global under the
    // tool ships dark, so a kit-less ship has no player beam at all.
    expect(r.dbgDefault).toBe('off');

    watch.assertClean();
  });

  test('kit installed: the cycle walks off → medium → high and the renderer follows', async ({ page }) => {
    const watch = await boot(page);
    await openSpace(page);

    await engine(page, e => e.debugGrantModule('flashlight_kit'));
    const eq = await engine(page, e => e.flashlightEquipped);
    expect(eq, 'granted next to the Base Hull, the kit is active').toBe(true);

    // Cycle through all three levels; both overrides are written in draw(),
    // so poll a frame behind each step.  MEDIUM and HIGH both wear the BEAM
    // cone — what steps is the LIGHTING TIER, and it steps for the whole
    // light system (getLightTier reads through the override).
    const tier0 = await engine(page, e => e.renderer.getLightTier());
    expect(tier0, 'the DBG tier ships low').toBe('low');

    await engine(page, e => e.cycleShipLight());
    await waitForEngine(page, e => e.renderer.playerLightToolHalfDeg === 40, 'the medium beam');
    expect(await engine(page, e => e.renderer.getLightTier()),
      'medium = the medium lighting tier').toBe('medium');

    await engine(page, e => e.cycleShipLight());
    await waitForEngine(page, e => e.renderer.getLightTier() === 'high', 'the high tier');
    expect(await engine(page, e => e.renderer.playerLightToolHalfDeg),
      'still the beam style — the tier is what stepped').toBe(BEAM_HALF_DEG);

    await engine(page, e => e.cycleShipLight());
    await waitForEngine(page, e => e.renderer.playerLightToolHalfDeg === null, 'back to off');
    expect(await engine(page, e => e.renderer.getLightTier()),
      'and the tier falls back to the DBG global').toBe('low');

    const done = await engine(page, e => ({ level: e.flashlightLevel }));
    expect(done.level, 'the cycle closed').toBe(0);

    watch.assertClean();
  });

  test('uninstalling the kit turns the light off with it', async ({ page }) => {
    const watch = await boot(page);
    await openSpace(page);

    await engine(page, e => {
      e.debugGrantModule('flashlight_kit');
      e.cycleShipLight(); // medium
    });
    const lit = await engine(page, e => e.flashlightLevel);
    expect(lit).toBe(1);

    // Back to the lean outfit — the kit goes with it, and so must the beam.
    await engine(page, e => e.resetOutfit());
    const r = await engine(page, e => ({
      equipped: e.flashlightEquipped, level: e.flashlightLevel,
    }));
    expect(r.equipped).toBe(false);
    expect(r.level, 'a removed tool does not leave its beam burning').toBe(0);
    await waitForEngine(page, e => e.renderer.playerLightToolHalfDeg === null, 'the override cleared');

    watch.assertClean();
  });
});

test.describe('the ship tap is the switch', () => {
  test('a REAL tap on the ship cycles the light instead of firing', async ({ page }) => {
    const watch = await boot(page);
    await openSpace(page);
    await engine(page, e => e.debugGrantModule('flashlight_kit'));

    /*  The ship renders at screen centre (390×844 → 195,422), and under the
     *  default touch scheme a tap fires — unless something claims it.  With
     *  the kit aboard the tap is claimed by the light, so the level steps
     *  AND no projectile is born aimed at your own hull. */
    const before = await engine(page, e => ({
      level: e.flashlightLevel,
      shots: e.currentMap.entities.filter((x: any) => x.active && x.type === 'PROJECTILE').length,
    }));
    await page.mouse.click(195, 422);
    await waitForEngine(page, e => e.flashlightLevel === 1, 'the tap to cycle the light');
    const after = await engine(page, e => ({
      shots: e.currentMap.entities.filter((x: any) => x.active && x.type === 'PROJECTILE').length,
    }));
    expect(after.shots, 'the claimed tap fired nothing').toBe(before.shots);

    watch.assertClean();
  });

  test('a dock in range still wins the tap — the light is the fallback, not a rival', async ({ page }) => {
    const watch = await boot(page);
    // The hub spawns the player beside the HOME station, inside dock range.
    await startRun(page);
    await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');
    await engine(page, e => e.debugGrantModule('flashlight_kit'));
    await waitForEngine(page, e => e.dockInRange === true, 'dock range');

    await page.mouse.click(195, 422);
    await waitForEngine(page, e => e.dockedAtStation === true, 'the dock');
    const r = await engine(page, e => ({ level: e.flashlightLevel }));
    expect(r.level, 'docking took the gesture; the light did not move').toBe(0);
    await engine(page, e => e.undock());

    watch.assertClean();
  });
});
