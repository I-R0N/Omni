/** THE DEBUG PANEL — one component, reachable from every screen.
 *
 *  The debug menu used to live in two places: ~800 lines of hand-written
 *  sections inside the pause menu (the only place most of it could be
 *  reached) and a map / enemy-test dropdown on the main menu.  It is now ONE
 *  panel, rendered from a declared registry (`components/debugSections.tsx`)
 *  and floated above whichever screen is up.  This suite pins the properties
 *  that change made, and that nothing else would notice losing:
 *
 *  - REACH.  The panel opens from the main menu, live play, pause, every
 *    station tab, the death screen and the stage-clear screen, and a row
 *    clicked there reaches the engine.
 *  - FREEZE.  Over live play it runs the world by default and holds it only
 *    on request; it never holds a dying or dead ship, because death is the
 *    one full-screen overlay that deliberately keeps the world running.
 *  - INPUT.  Nothing done to the panel flies the ship — no mouse click, no
 *    touch tap (including the compatibility mouse events a tap leaves
 *    behind), no key typed into it, no pad button while it has the pad.
 *  - PAYLOAD.  The panel-only data (the weapon catalog) is published only
 *    while the panel is open, on every screen — it used to ride every
 *    paused frame whether or not anyone was looking.
 *  - IDENTITY.  Every row the old menu had survives under its old label.
 *
 *  Layout at six viewport sizes lives in `viewports.spec.ts`, with the rest
 *  of the viewport matrix.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  boot, engine, stats, startRun, waitForStats, waitForEngine, waitForTransit,
  waitForStatsKeyChange, dockAtStation, advanceSim,
} from './helpers';

// ── Duplicated on purpose (harness rule 7) ────────────────────────────────

/** `INPUT_CONSTANTS.DEBUG_KEY` — the ` key. */
const DEBUG_KEY = 'Backquote';

/** W3C standard-gamepad indices, as bound in INPUT_CONSTANTS.GAMEPAD.BUTTONS. */
const PAD = { CROSS: 0, CIRCLE: 1, R2: 7, SELECT: 8, DPAD_DOWN: 13 };

/** Every labelled row of the OLD panel, read off the `ctrlRow` / `statRow`
 *  calls in the pre-overhaul UIOverlay, in the order it listed them.  A
 *  MULTISET: two rows are called "  ↳ live" and the timing tree has two
 *  "·misc".  Labels are identity — suites, docs and muscle memory name rows
 *  by them — so a rename has to be a deliberate edit to this list.  BYTE for
 *  byte, too: most of the timing tree indents with NO-BREAK spaces and three
 *  of its rows with plain ones, exactly as the old panel had them. */
const OLD_ROWS = [
  'Overlays', 'FPS', 'Wave', 'State', 'Wave timer', 'Thrust', 'Speed',
  'Snitch catch', 'Snitch spd', 'Gamepad', '  ↳ axes', '  ↳ rumble',
  '  ↳ triggers', '  ↳ report', '  ↳ trig enc', '  ↳ HID buzz', 'Impact vel',
  'Crash energy', 'Blast energy', 'Hull density', 'Enemy scale', '  ↳ live',
  'Sim rate', 'Substep cap', 'Render scale', 'HUD rate', 'Gnat move',
  'Corrode', 'Disable', 'Traits', 'Station', 'Roll feel', 'Hull',
  'Roll damp', 'Tilt mode', 'Lean dir', 'Tilt src', 'Vel gain', 'Salvage',
  '+1M Salv', 'Shield', 'Overcharge', 'Light', 'Lock slots', 'Outfit all',
  'Reset', 'Transit fx', 'Size', 'Gravity', '  ↳ range', 'Lens',
  '  ↳ radius', '  ↳ spin', '  ↳ live', 'Fracture', 'Frac relax',
  'Bnd strength', 'Dmg spread', 'Frac sep', 'Frac sites', 'Frac bias',
  'Chip dust', 'Grain mat', '  ↳ grain size', '  ↳ count min',
  '  ↳ count max', '  ↳ regularity', '  ↳ bond str', '  ↳ size spread',
  '  ↳ dmg spread', '  ↳ reset all', 'Neb sprite', 'Neb damp',
  'Neb spin damp', 'Neb bond', 'Neb solid', 'Neb drain', 'Neb stretch',
  'Neb spin', 'Neb collide', 'Nebula', 'Scan off', 'Star density',
  'Star size', 'Star depth', 'Parallax', 'Sound burst', 'Trail', 'Trail dir',
  'Screen shake', 'Outlines', 'Chevrons', 'HP bars', 'Rumble',
  'Rock palette', 'Minimap mat', 'Lighting', 'Light tier', 'Light bright',
  'Fog', 'Flashlight', 'Light color', 'Tint mix', 'Emissive', 'World lights',
  'Depth dark', 'Emit bright', 'Emit fade', 'Emit shadow', 'Emit shd tier',
  'Shadow soft', 'Shard shadows', 'Refraction', 'Caustic fade',
  'Refr bright', 'Joystick', 'Goo bond', 'Goo coat', 'Pl shade', 'Shade dir',
  'Tile shade', 'Palette', 'Shard pal', 'P glow', 'Recolor', 'Local grav',
  'Attract grav', 'Collisions', 'Tile push', 'Shard grav', 'Bonding',
  'Plr↔neb', 'Sleep', 'Vp cull', 'Shard LOD', 'Merge rate', 'Grace',
  'Shard↔tile', 'Pair int', 'S↔T int', 'Tile blend', 'Shard blend',
  'Blend int', 'Pattern', 'Ast flow', 'Density', 'Kernel R', 'Tangent',
  'Breathe', 'Lane', 'Vec overlay', 'Sample N', 'Cells', 'Obstacles',
  'Rebuilds', 'enemies', 'asteroids', 'projectiles', 'particles',
  'drops/POI', 'max cell', 'Auto', 'updPhys', '\u00a0·physics',
  '\u00a0\u00a0·grav', '\u00a0\u00a0·lgrv', '\u00a0\u00a0·coll', '\u00a0·ai',
  '\u00a0·flow', '\u00a0·misc', 'updLogic', '\u00a0·shards', '\u00a0·rings',
  '\u00a0·weapons', '\u00a0·drops', '\u00a0·homing', '\u00a0·lightn',
  '\u00a0·misc', 'render', '\u00a0·neb', '\u00a0·vis-neb',
  '\u00a0·neb fast/slow', '\u00a0·tLit', '\u00a0·tLit-N', ' ·lit', ' ·lit-N',
  ' ·fog',
  // Hand-laid rows (no ctrlRow/statRow): the Perf block's three readouts,
  // the entity counter with its filter, and the module Mk grant rows (so
  // "Hull" appears twice — the Ship Tilt hull and the Hull Mk grants).
  'load', 'dyn ents', 'merge rate', 'Entities',
  'Hull', 'Plating', 'Capacitor', 'Engine', 'Thrusters', 'Gunnery', 'Autoloader', 'Scanner',
];

/** The button GROUPS of the old panel, by the label on each button. */
const OLD_CHIPS = [
  // Maps (main menu dropdown + pause ▸ Switch Map / Test)
  'Overworld', 'Deep Space', 'Ring World', 'Seven Rings', 'Pocket',
  'Asteroid Field', 'Glass Field', 'Plastic Field', 'Metal Field',
  'Indestructible', 'Nebula Field', 'Rock Field', 'Tile Heavy',
  // Enemy Test — force one type
  'Off', 'Drone', 'Charger', 'Tank', 'Skirmisher', 'Orbiter', 'Sniper',
  'Kamikaze', 'Bulwark', 'Turret', 'Swarm', 'Nest',
  // Bosses, Dragon, Rivals
  'Warden', 'Reaver', 'Bastion',
  'glass', 'rock', 'plastic', 'metal', 'mixed',
  'hostile', 'ally', 'neutral', 'random',
  // Perf REC
  '○ REC', 'Copy',
];

// ── Panel drivers ─────────────────────────────────────────────────────────

async function openPanel(page: Page) {
  await page.getByTestId('debug-launcher').click();
  await expect(page.getByTestId('debug-panel')).toBeVisible();
  await waitForStats(page, s => s.debugPanel?.open === true, 'the engine to hold the panel open');
}

async function closePanel(page: Page) {
  await page.getByTestId('debug-close').click();
  await expect(page.getByTestId('debug-panel')).toHaveCount(0);
  await waitForStats(page, s => s.debugPanel?.open === false, 'the engine to close the panel');
}

/** Open a group (and one of its sections) without toggling an open one
 *  shut — the panel remembers what was open, so "click it" is not "open
 *  it". */
async function expand(page: Page, group: string, section?: string) {
  const g = page.locator(`[data-debug-group="${group}"]`);
  if ((await g.getAttribute('aria-expanded')) !== 'true') await g.click();
  await expect(g).toHaveAttribute('aria-expanded', 'true');
  if (!section) return;
  const s = page.locator(`[data-debug-section="${section}"]`);
  if ((await s.getAttribute('aria-expanded')) !== 'true') await s.click();
  await expect(s).toHaveAttribute('aria-expanded', 'true');
}

/** Open every group and every section, so every row is in the DOM. */
async function expandAll(page: Page) {
  await page.evaluate(async () => {
    const frame = () => new Promise(r => requestAnimationFrame(() => r(null)));
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('[data-debug-group]'))) {
      if (b.getAttribute('aria-expanded') !== 'true') { b.click(); await frame(); }
    }
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('[data-debug-section]'))) {
      if (b.getAttribute('aria-expanded') !== 'true') { b.click(); await frame(); }
    }
  });
}

/** THE ONE ROW every screen test toggles: Visual / HUD ▸ Camera & HUD ▸
 *  Screen shake.  A plain boolean with a published readout, so the proof is
 *  the ENGINE's flag moving, not the button's caption. */
async function toggleScreenShake(page: Page) {
  await expand(page, 'visual', 'hud');
  const button = page.locator('[data-debug-row="Screen shake"] button');
  const was = (await stats(page)).screenShakeEnabled !== false;
  await expect(button).toHaveText(was ? 'On' : 'Off');
  await button.click();
  await waitForStatsKeyChange(page, 'screenShakeEnabled', was, 'the screen-shake flag to flip');
  await expect(button).toHaveText(was ? 'Off' : 'On');
}

/** A PROBE the sim must move (screens.spec.ts's recipe): a salvage drop
 *  parked far from the player, integrated every step and drifting with the
 *  flow field, so it moves if and only if the world is stepping. */
async function plantProbe(page: Page) {
  await engine(page, e => {
    const p = e.player.position;
    e.drops.spawnSalvageDrop(
      e.currentMap.entities, e.activeDrops,
      { x: p.x + 4000, y: p.y + 4000 }, { x: 60, y: 45 },
    );
    e.currentMap.entities[e.currentMap.entities.length - 1].__probe = true;
  });
}

function worldClock(page: Page) {
  return engine(page, e => {
    const probe = e.currentMap.entities.find((x: any) => x.__probe);
    return {
      runTimeSec: e.runTimeSec as number,
      motion: probe ? probe.position.x + probe.position.y : null,
    };
  });
}

/** Largest number of live player shots seen over `ms` of wall time — a shot
 *  lives long enough to be seen, and a peak cannot miss it the way one read
 *  can (harness rule 2). */
function peakShots(page: Page, ms = 700) {
  return page.evaluate(ms => new Promise<number>(resolve => {
    let peak = 0;
    const t0 = performance.now();
    const tick = () => {
      const e = (window as any).__omniEngine;
      const n = e.currentMap.entities.filter(
        (x: any) => x.active && x.type === 'PROJECTILE' && x.ownerType === 'PLAYER').length;
      if (n > peak) peak = n;
      if (performance.now() - t0 >= ms) resolve(peak); else requestAnimationFrame(tick);
    };
    tick();
  }), ms);
}

function frames(page: Page, n = 3) {
  return page.evaluate(n => new Promise(resolve => {
    let k = 0;
    const step = () => (++k >= n ? resolve(null) : requestAnimationFrame(step));
    requestAnimationFrame(step);
  }), n);
}

/** Warp a capstone in on an ARENA and kill it through the real death path
 *  (screens.spec.ts's recipe). */
async function clearAStage(page: Page) {
  await startRun(page);
  await engine(page, e => e.transitionToMap('arena_universe'));
  await waitForTransit(page);
  await waitForStats(page, s => s.currentMapType === 'UNIVERSE', 'the arena');
  await engine(page, e => e.debugSpawnBoss('BOSS_WARDEN'));
  await waitForStats(page, s => !!s.boss, 'the boss to warp in');
  await engine(page, e => {
    const boss = e.currentMap.entities.find((x: any) => x.isBoss && x.active);
    boss.killedByPlayer = true;
    e.handleEntityDeath(boss);
  });
  await waitForStats(page, s => !!s.stageClear, 'the stage-clear screen');
}

// ══════════════════════════════════════════════════════════════════════════

test.describe('reachable from every screen', () => {
  test('main menu: the launcher floats, a row toggles, and the map picker still swaps the backdrop', async ({ page }) => {
    const watch = await boot(page);

    // Over a full-screen overlay the launcher floats bottom-right.
    const fab = (await page.getByTestId('debug-launcher').boundingBox())!;
    expect(fab.x + fab.width, 'launcher on screen').toBeLessThanOrEqual(390);
    expect(fab.y + fab.height, 'launcher on screen').toBeLessThanOrEqual(844);
    expect(fab.y, 'launcher in the bottom corner').toBeGreaterThan(844 / 2);

    await openPanel(page);
    await toggleScreenShake(page);

    // The old front-door dropdown's job: pick the map START will use, WITHOUT
    // starting.  Same route (App's setMapType), now from the panel.
    await expand(page, 'world', 'maps');
    await page.locator('[data-debug-row="Maps"] button', { hasText: 'Ring World' }).click();
    const s = await waitForStats(page, s2 => s2.currentMapType === 'RING', 'the backdrop to swap');
    expect(s.gameState, 'picking a map from the menu does not start a run').toBe('MENU');

    await closePanel(page);
    await expect(page.getByTestId('debug-launcher')).toBeVisible();
    watch.assertClean();
  });

  test('live play: the launcher sits under PAUSE, and a row toggles with the world running', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // In the HUD's control column, directly under the pause button — not the
    // floating corner copy.
    const column = page.getByTestId('hud-controls');
    await expect(column.getByTestId('debug-launcher')).toBeVisible();
    const pause = (await page.getByRole('button', { name: 'Pause' }).boundingBox())!;
    const launcher = (await page.getByTestId('debug-launcher').boundingBox())!;
    expect(launcher.y, 'launcher below pause').toBeGreaterThanOrEqual(pause.y + pause.height);
    expect(Math.abs(launcher.x - pause.x), 'same column as pause').toBeLessThan(1);

    await openPanel(page);
    await toggleScreenShake(page);
    expect((await stats(page)).gameState).toBe('PLAYING');
    await closePanel(page);

    watch.assertClean();
  });

  test('pause menu: the panel floats over it and leaves it paused', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await engine(page, e => e.pauseGame());
    await waitForStats(page, s => s.gameState === 'PAUSED', 'the pause menu');

    await openPanel(page);
    await toggleScreenShake(page);
    await closePanel(page);
    expect((await stats(page)).gameState, 'still paused underneath').toBe('PAUSED');
    await expect(page.locator('[data-overlay="pause"]')).toBeVisible();

    watch.assertClean();
  });

  test('docked station: every tab reaches the panel, and the tab survives it', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await dockAtStation(page);

    let tabs = 0;
    for (const tabId of ['shop', 'outfit', 'ship'] as const) {
      const tab = page.getByTestId(`station-tab-${tabId}`);
      if (!(await tab.count())) continue;
      tabs++;
      await tab.click();
      await openPanel(page);
      await toggleScreenShake(page);
      await closePanel(page);
      // Still docked, still on the same tab.
      expect((await stats(page)).dock?.docked, `${tabId}: still docked`).toBe(true);
      await expect(tab).toHaveAttribute('aria-selected', 'true');
    }
    expect(tabs, 'the trade hub offers all three tabs').toBe(3);

    watch.assertClean();
  });

  test('death screen: a row toggles and the field keeps fighting behind it', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await plantProbe(page);
    await engine(page, e => e.startExplosion(e.player));
    await waitForStats(page, s => !!s.runSummary, 'the run summary');

    await openPanel(page);
    await toggleScreenShake(page);

    // The panel is open over death, and death is still not frozen.
    const t0 = await worldClock(page);
    await page.waitForTimeout(800);
    const t1 = await worldClock(page);
    expect(t1.motion, 'the world moves behind the panel').not.toBe(t0.motion);
    expect(t1.runTimeSec, 'dead time is still not play time').toBe(t0.runTimeSec);

    await closePanel(page);
    await expect(page.getByTestId('death-respawn')).toBeVisible();
    watch.assertClean();
  });

  test('stage-clear screen: a row toggles and the screen stays up', async ({ page }) => {
    const watch = await boot(page);
    await clearAStage(page);

    await openPanel(page);
    await toggleScreenShake(page);
    await closePanel(page);
    expect(!!(await stats(page)).stageClear, 'still on the stage-clear screen').toBe(true);

    watch.assertClean();
  });
});

// ══════════════════════════════════════════════════════════════════════════

test.describe('freeze while open', () => {
  /*  THE DECISION: the panel does NOT freeze the world by default.  Most of
   *  its rows are tuning knobs whose effect is only visible while the world
   *  runs — a flow pattern, a lens, a tilt spring, a gravity well — so a
   *  default freeze would hide the very thing being tuned.  "❄ Freeze" holds
   *  it on request, like pause, and it only ever means something over LIVE
   *  play: every other screen already freezes on its own, except death,
   *  which must never freeze. */

  test('off by default: the world keeps running behind the panel', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await plantProbe(page);
    await openPanel(page);

    const s = await stats(page);
    expect(s.debugPanel?.freeze, 'freeze ships off').toBe(false);
    expect(s.debugPanel?.holding).toBe(false);

    const t0 = await worldClock(page);
    await advanceSim(page, 0.3);
    const t1 = await worldClock(page);
    expect(t1.motion).not.toBe(t0.motion);

    watch.assertClean();
  });

  test('on: the world holds while the panel is open, and resumes when it closes', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await plantProbe(page);
    await openPanel(page);

    await page.getByTestId('debug-freeze').click();
    await waitForStats(page, s => s.debugPanel?.holding === true, 'the freeze to take hold');
    await expect(page.getByTestId('debug-freeze')).toHaveText(/Freeze On/);

    const t0 = await worldClock(page);
    await page.waitForTimeout(800);   // wall time passing with nothing moving
    const t1 = await worldClock(page);
    expect(t1.runTimeSec, 'no sim time passes').toBe(t0.runTimeSec);
    expect(t1.motion, 'nothing moves').toBe(t0.motion);
    // Knobs still work while held: the ENGINE state moves, only the sim does not.
    await toggleScreenShake(page);

    await closePanel(page);
    await advanceSim(page, 0.2);   // throws if the clock stayed stopped
    // The preference outlives the panel: reopening holds again at once.
    await openPanel(page);
    await waitForStats(page, s => s.debugPanel?.holding === true, 'the freeze to hold again');

    watch.assertClean();
  });

  test('never holds a dying or dead ship — death keeps its live semantics', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await plantProbe(page);
    await openPanel(page);
    await page.getByTestId('debug-freeze').click();
    await waitForStats(page, s => s.debugPanel?.holding === true, 'the freeze to take hold');

    // The ship dies with the freeze ON and the panel OPEN.  The explosion,
    // the beat and the summary must all still arrive: a freeze that caught
    // the wreck would hang the death screen forever.
    await engine(page, e => e.startExplosion(e.player));
    await waitForStats(page, s => s.debugPanel?.holding === false, 'the freeze to let go of the wreck');
    await waitForStats(page, s => !!s.runSummary, 'the run summary, freeze and all');

    const s = await stats(page);
    expect(s.debugPanel?.freeze, 'the preference is untouched').toBe(true);
    expect(s.debugPanel?.holding, 'but it holds nothing').toBe(false);
    // No freeze toggle over a full-screen overlay — it could only mislead.
    await expect(page.getByTestId('debug-freeze')).toHaveCount(0);

    const t0 = await worldClock(page);
    await page.waitForTimeout(800);
    const t1 = await worldClock(page);
    expect(t1.motion, 'the field keeps fighting').not.toBe(t0.motion);
    expect(t1.runTimeSec, 'and dead time is still not play time').toBe(t0.runTimeSec);

    // Respawning puts the ship back in play — and the freeze back in force.
    await engine(page, e => e.respawnFromDeath());
    await waitForStats(page, s2 => s2.debugPanel?.holding === true, 'the freeze to hold the live ship again');

    watch.assertClean();
  });

  test('the toggle is offered over live play only', async ({ page }) => {
    const watch = await boot(page);

    // Main menu.
    await openPanel(page);
    await expect(page.getByTestId('debug-freeze')).toHaveCount(0);
    await closePanel(page);

    // Live play.
    await startRun(page);
    await openPanel(page);
    await expect(page.getByTestId('debug-freeze')).toHaveCount(1);
    await closePanel(page);

    // Pause.
    await engine(page, e => e.pauseGame());
    await waitForStats(page, s => s.gameState === 'PAUSED', 'the pause menu');
    await openPanel(page);
    await expect(page.getByTestId('debug-freeze')).toHaveCount(0);

    watch.assertClean();
  });
});

// ══════════════════════════════════════════════════════════════════════════

test.describe('input: the panel never flies the ship', () => {
  test('mouse: clicking the launcher and the rows fires nothing, moves nothing and turns nothing', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // Aim somewhere definite first, over the canvas: straight up.
    await page.mouse.move(195, 200);
    await frames(page, 4);
    const aim0 = await engine(page, e => e.player.rotation as number);
    expect(aim0, 'the pointer aims over the canvas').toBeCloseTo(-Math.PI / 2, 1);

    await openPanel(page);   // a real click on the launcher
    await expand(page, 'visual', 'hud');
    await page.locator('[data-debug-row="Chevrons"] button').click();
    await page.locator('[data-debug-row="Chevrons"] button').click();
    // And wander across the panel, as a hand does.
    await page.mouse.move(40, 800, { steps: 6 });
    await page.mouse.move(350, 520, { steps: 6 });
    await frames(page, 4);

    const after = await engine(page, e => ({
      rotation: e.player.rotation as number,
      move: e.input.getMovementVector(),
    }));
    expect(after.rotation, 'the ship did not swing toward the panel').toBeCloseTo(aim0, 5);
    expect(after.move, 'nothing is steering').toEqual({ x: 0, y: 0 });
    expect(await peakShots(page), 'nothing fired').toBe(0);
    // And no click left keyboard focus in the panel, where it would swallow
    // WASD (keys at a focused debug control never reach the ship).
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-debug-ui]')),
      'mouse clicks do not take keyboard focus').toBe(false);

    // CONTROLS — the same hand on the canvas does both, so the zeros above
    // are the panel's doing and not a dead input path.
    await page.mouse.move(300, 300);
    await frames(page, 4);
    expect(await engine(page, e => e.player.rotation as number)).not.toBeCloseTo(aim0, 1);
    await page.mouse.click(300, 300);
    await waitForEngine(page, e => e.currentMap.entities.some(
      (x: any) => x.active && x.type === 'PROJECTILE' && x.ownerType === 'PLAYER'),
    'a canvas click to fire');

    watch.assertClean();
  });

  test('keyboard: ` toggles it on any screen, and nothing typed into it flies the ship', async ({ page }) => {
    const watch = await boot(page);
    const filter = page.getByTestId('debug-filter');

    // From the main menu…
    await page.keyboard.press(DEBUG_KEY);
    await waitForStats(page, s => s.debugPanel?.open === true, 'the panel from the main menu');
    await page.keyboard.press(DEBUG_KEY);
    await waitForStats(page, s => s.debugPanel?.open === false, 'the panel shut from the main menu');

    // …and the pause menu.
    await startRun(page);
    await engine(page, e => e.pauseGame());
    await waitForStats(page, s => s.gameState === 'PAUSED', 'the pause menu');
    await page.keyboard.press(DEBUG_KEY);
    await waitForStats(page, s => s.debugPanel?.open === true, 'the panel from the pause menu');
    await page.keyboard.press(DEBUG_KEY);
    await waitForStats(page, s => s.debugPanel?.open === false, 'the panel shut over the pause menu');
    await engine(page, e => e.resumeGame());
    await waitForStats(page, s => s.gameState === 'PLAYING', 'the run resumed');

    // Live play.  A run starts beside the home station, IN DOCK RANGE, so an
    // E that leaked through the panel would dock the ship — a concrete
    // symptom rather than a flag read back.
    await waitForStats(page, s => !!s.dock?.inRange, 'dock range at the spawn');
    await page.keyboard.press(DEBUG_KEY);
    await waitForStats(page, s => s.debugPanel?.open === true && s.debugPanel?.via === 'key', 'the panel from live play');
    // Opened from the keyboard, the caret is already in the filter.
    await expect(filter).toBeFocused();

    // Keys typed INTO the panel type.  HELD, too — the case a quick type
    // hides, since each key is up again before a frame can look at it.
    await page.keyboard.type('wasd');
    await expect(filter).toHaveValue('wasd');
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyE');
    await frames(page, 6);
    const held = await engine(page, e => ({
      w: e.input.isKeyDown('KeyW'), e: e.input.isKeyDown('KeyE'),
      move: e.input.getMovementVector(), docked: !!e.dockedAtStation,
    }));
    await page.keyboard.up('KeyE');
    await page.keyboard.up('KeyW');
    expect(held, 'no flight key, no interact key, no dock').toEqual({
      w: false, e: false, move: { x: 0, y: 0 }, docked: false,
    });

    // Escape with text in the filter CLEARS it and stops there…
    await page.keyboard.press('Escape');
    await expect(filter).toHaveValue('');
    await frames(page, 3);
    expect((await stats(page)).debugPanel?.open, 'one Escape only clears the filter').toBe(true);
    // …and the next one closes.
    await page.keyboard.press('Escape');
    await waitForStats(page, s => s.debugPanel?.open === false, 'Escape to close the panel');

    // The ` never lands in the text box: pressed from INSIDE it, it closes.
    await page.keyboard.press(DEBUG_KEY);
    await waitForStats(page, s => s.debugPanel?.open === true, 'the panel again');
    await expect(filter).toBeFocused();
    await expect(filter).toHaveValue('');
    await page.keyboard.press(DEBUG_KEY);
    await waitForStats(page, s => s.debugPanel?.open === false, 'the ` to close it from inside the filter');

    // CONTROLS, with the panel shut and focus nowhere: the same keys fly…
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.down('KeyD');
    await frames(page, 2);
    expect((await engine(page, e => e.input.getMovementVector())).x).toBeGreaterThan(0);
    await page.keyboard.up('KeyD');
    // …and dock.
    await waitForStats(page, s => !!s.dock?.inRange, 'dock range again');
    await page.keyboard.down('KeyE');
    await waitForStats(page, s => s.dock?.docked === true, 'E to dock with the panel shut');
    await page.keyboard.up('KeyE');

    watch.assertClean();
  });

  test('gamepad: Select opens it, the pad then drives the PANEL, and Circle closes it without scanning', async ({ page }) => {
    /*  A pad cannot be synthesised headless, but the Gamepad API can be
     *  answered: `navigator.getGamepads` returns this object every frame, so
     *  the ENGINE's own poll adopts it and runs the real path — the capture,
     *  the fire gate, the drained flight edges and the menu driver — which
     *  `applyPadSnapshot` alone would bypass. */
    await page.addInitScript(() => {
      const idle = () => ({ pressed: false, touched: false, value: 0 });
      (window as any).__testPad = {
        index: 0, id: 'Test pad (STANDARD GAMEPAD)', mapping: 'standard', connected: true,
        timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, idle),
        vibrationActuator: null,
      };
      Object.defineProperty(Navigator.prototype, 'getGamepads', {
        configurable: true, value: () => [(window as any).__testPad, null, null, null],
      });
    });
    const hold = (b: number, down: boolean) => page.evaluate(([i, d]) => {
      (window as any).__testPad.buttons[i as number] =
        { pressed: d, touched: d, value: d ? 1 : 0 };
    }, [b, down] as [number, boolean]);
    const press = async (b: number) => {
      await hold(b, true); await frames(page, 3);
      await hold(b, false); await frames(page, 3);
    };
    const stick = (x: number) => page.evaluate(v => { (window as any).__testPad.axes = [v, 0, 0, 0]; }, x);

    const watch = await boot(page);
    await startRun(page);
    expect(await engine(page, e => e.input.isPadConnected())).toBe(true);
    // A scanner aboard, so a scan the panel failed to swallow would show.
    await engine(page, e => e.debugOutfitAll());
    await waitForEngine(page, e => e.scannerMk > 0, 'a scanner aboard');

    // Select / Share toggles the panel.
    await press(PAD.SELECT);
    await waitForStats(page, s => s.debugPanel?.open === true && s.debugPanel?.via === 'pad', 'the panel from the pad');

    // CAPTURED: the stick neither flies nor aims, and the trigger does not fire.
    await stick(1);
    await frames(page, 4);
    expect(await engine(page, e => e.input.getMovementVector())).toEqual({ x: 0, y: 0 });
    await hold(PAD.R2, true);
    expect(await peakShots(page, 500), 'R2 is not the gun while the panel has the pad').toBe(0);
    await hold(PAD.R2, false);
    await stick(0);

    // The D-pad walks focus INSIDE the panel, and Cross presses what it lands
    // on — here the first control, ❄ Freeze.
    await press(PAD.DPAD_DOWN);
    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return { inPanel: !!el?.closest('[data-testid="debug-panel"]'), id: el?.getAttribute('data-testid') };
    });
    expect(focus).toEqual({ inPanel: true, id: 'debug-freeze' });
    await press(PAD.CROSS);
    await waitForStats(page, s => s.debugPanel?.freeze === true, 'Cross to press the focused control');
    expect(await peakShots(page, 300), 'Cross pressed the button, it did not fire').toBe(0);

    // Circle is BACK: it closes the panel — and it is also SCAN in flight, so
    // the press must be spent here, not banked for the first live frame.
    await press(PAD.CIRCLE);
    await waitForStats(page, s => s.debugPanel?.open === false, 'Circle to close the panel');
    await frames(page, 6);
    expect(await engine(page, e => e.scanCooldown as number), 'closing did not scan').toBe(0);

    // CONTROLS, with the pad handed back: the stick flies, and Circle scans.
    await stick(1);
    await frames(page, 4);
    expect((await engine(page, e => e.input.getMovementVector())).x).toBeGreaterThan(0);
    await stick(0);
    await press(PAD.CIRCLE);
    await waitForEngine(page, e => e.scanCooldown > 0, 'Circle to scan once the panel is shut');

    watch.assertClean();
  });

  test('gamepad over the pause menu: BACK closes the panel first, then resumes', async ({ page }) => {
    await page.addInitScript(() => {
      const idle = () => ({ pressed: false, touched: false, value: 0 });
      (window as any).__testPad = {
        index: 0, id: 'Test pad (STANDARD GAMEPAD)', mapping: 'standard', connected: true,
        timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, idle),
        vibrationActuator: null,
      };
      Object.defineProperty(Navigator.prototype, 'getGamepads', {
        configurable: true, value: () => [(window as any).__testPad, null, null, null],
      });
    });
    const press = async (b: number) => {
      for (const d of [true, false]) {
        await page.evaluate(([i, on]) => {
          (window as any).__testPad.buttons[i as number] = { pressed: on, touched: on, value: on ? 1 : 0 };
        }, [b, d] as [number, boolean]);
        await frames(page, 3);
      }
    };

    const watch = await boot(page);
    await startRun(page);
    await engine(page, e => e.pauseGame());
    await waitForStats(page, s => s.gameState === 'PAUSED', 'the pause menu');

    await press(PAD.SELECT);
    await waitForStats(page, s => s.debugPanel?.open === true, 'the panel over the pause menu');
    // The panel is the LIVE overlay for the menu driver: focus goes into it,
    // not into the pause menu behind.
    await press(PAD.DPAD_DOWN);
    expect(await page.evaluate(() =>
      !!document.activeElement?.closest('[data-testid="debug-panel"]'))).toBe(true);

    await press(PAD.CIRCLE);
    await waitForStats(page, s => s.debugPanel?.open === false, 'BACK to close the panel');
    expect((await stats(page)).gameState, 'the first BACK only closed the panel').toBe('PAUSED');
    await press(PAD.CIRCLE);
    await waitForStats(page, s => s.gameState === 'PLAYING', 'the second BACK to resume');

    watch.assertClean();
  });
});

test.describe('input: touch', () => {
  test.use({ hasTouch: true });

  test('tapping the launcher and a row fires nothing and does not turn the ship', async ({ page }) => {
    /*  A tap on a DOM control is ignored by the touch handlers (it did not
     *  start on the canvas), but the browser then sends COMPATIBILITY mouse
     *  events for it, and the pointer IS the aim — so without the panel's
     *  guard the ship swung to face every row tapped.  The mouse suite cannot
     *  see this: a mouse that clicks a row was already there. */
    const watch = await boot(page);
    await startRun(page);
    const aim0 = await engine(page, e => e.player.rotation as number);

    await page.getByTestId('debug-launcher').tap();
    await waitForStats(page, s => s.debugPanel?.open === true, 'the panel from a tap');
    await page.locator('[data-debug-group="visual"]').tap();
    await page.locator('[data-debug-section="hud"]').tap();
    const was = (await stats(page)).screenShakeEnabled;
    await page.locator('[data-debug-row="Screen shake"] button').tap();
    await waitForStatsKeyChange(page, 'screenShakeEnabled', was, 'the tapped row to act');
    await frames(page, 4);

    expect(await engine(page, e => e.player.rotation as number), 'the ship did not turn').toBeCloseTo(aim0, 5);
    expect(await peakShots(page), 'nothing fired').toBe(0);

    // CONTROL: the same tap on the canvas aims and fires.
    await page.touchscreen.tap(195, 200);
    await waitForEngine(page, e => e.currentMap.entities.some(
      (x: any) => x.active && x.type === 'PROJECTILE' && x.ownerType === 'PLAYER'),
    'a canvas tap to fire');
    expect(await engine(page, e => e.player.rotation as number)).toBeCloseTo(-Math.PI / 2, 1);

    watch.assertClean();
  });
});

// ══════════════════════════════════════════════════════════════════════════

test.describe('payload', () => {
  test('panel-only data is published only while the panel is open', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // The weapon catalog used to ride EVERY paused frame, panel or not.
    await engine(page, e => e.pauseGame());
    await waitForStats(page, s => s.gameState === 'PAUSED', 'the pause menu');
    let s = await stats(page);
    expect(s.weaponCatalog, 'no catalog while the panel is shut').toBeUndefined();
    expect(s.debugSlotLock).toBeUndefined();

    await openPanel(page);
    s = await waitForStats(page, s2 => Array.isArray(s2.weaponCatalog), 'the catalog while open');
    expect(s.weaponCatalog!.length).toBeGreaterThan(0);
    expect(s.debugSlotLock).toMatch(/^\d+\/\d+$/);
    // Rendered, one row per weapon.
    await expand(page, 'weapons', 'weapons');
    for (const w of s.weaponCatalog!) {
      await expect(page.locator(`[data-debug-row="${w.name}"]`)).toHaveCount(1);
    }

    await closePanel(page);
    s = await waitForStats(page, s2 => s2.weaponCatalog === undefined, 'the catalog to stop');
    expect(s.debugSlotLock).toBeUndefined();

    // What IS always sent is four scalars.
    expect(Object.keys(s.debugPanel ?? {}).sort()).toEqual(['freeze', 'holding', 'open', 'via']);

    watch.assertClean();
  });
});

// ══════════════════════════════════════════════════════════════════════════

test.describe('the registry', () => {
  test('every row of the old menu survives, under its old label', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await openPanel(page);
    await expandAll(page);

    const rendered = await page.evaluate(() => Array.from(
      document.querySelectorAll('[data-testid="debug-panel"] [data-debug-row]'),
    ).map(el => el.getAttribute('data-debug-row') ?? ''));
    const have = new Map<string, number>();
    for (const l of rendered) have.set(l, (have.get(l) ?? 0) + 1);
    const want = new Map<string, number>();
    for (const l of OLD_ROWS) want.set(l, (want.get(l) ?? 0) + 1);
    const missing = [...want].filter(([l, n]) => (have.get(l) ?? 0) < n).map(([l, n]) => `${JSON.stringify(l)} ×${n}`);
    expect(missing, 'rows the old menu had and the panel does not').toEqual([]);

    const chips = await page.evaluate(() => Array.from(
      document.querySelectorAll('[data-testid="debug-panel"] [data-debug-row] button'),
    ).map(el => (el.textContent ?? '').trim()));
    const lostChips = OLD_CHIPS.filter(c => !chips.includes(c));
    expect(lostChips, 'buttons the old menu had and the panel does not').toEqual([]);

    watch.assertClean();
  });

  test('every row answers a click with a clean console', async ({ page }) => {
    /*  A registry row is a label and a function, and the function is only
     *  called when somebody clicks.  So click them all — every control and
     *  every grant button, once — and require the console to stay clean.
     *  That is how this suite found `Outfit all` throwing on main: the
     *  deleted Penetration module was still in its canonical layout.  The
     *  chip rows (maps, spawns) are left out: a map switch per chip is a
     *  test of map loading, which maps.spec.ts owns. */
    const watch = await boot(page);
    await startRun(page);
    await openPanel(page);
    await expandAll(page);

    const clicked = await page.evaluate(async () => {
      const frame = () => new Promise(r => requestAnimationFrame(() => r(null)));
      const panel = document.querySelector('[data-testid="debug-panel"]')!;
      let n = 0;
      const controls = panel.querySelectorAll<HTMLButtonElement>(
        '[data-debug-kind="ctrl"] > button, [data-debug-kind="buttons"] > span > button');
      for (const b of Array.from(controls)) {
        b.click(); n++;
        await frame();
      }
      return n;
    });
    expect(clicked, 'the sweep reached the controls').toBeGreaterThan(150);
    // Let whatever the clicks scheduled run, then prove the loop survived it.
    await frames(page, 30);
    await waitForStats(page, s => s.fps > 0, 'the loop still running');

    watch.assertClean();
  });

  test('the filter finds a row by name, by chip and by what it does', async ({ page }) => {
    const watch = await boot(page);
    await openPanel(page);
    const filter = page.getByTestId('debug-filter');

    // By label, however it is spelled.
    await filter.fill('neb BOND');
    await expect(page.locator('[data-debug-row="Neb bond"]')).toHaveCount(1);
    // By a chip's label — the boss is a button, not a row.
    await filter.fill('warden');
    await expect(page.locator('[data-debug-row="Warp in a boss"]')).toHaveCount(1);
    // By a word only the tooltip carries.
    await filter.fill('spiral-of-death');
    await expect(page.getByText('Mentioned in descriptions')).toBeVisible();
    await expect(page.locator('[data-debug-row="Substep cap"]')).toHaveCount(1);
    // And says so when nothing matches.
    await filter.fill('zzzz no such knob');
    await expect(page.getByText(/No row matches/)).toBeVisible();

    // A row found by the filter still works.
    await filter.fill('screen shake');
    const was = (await stats(page)).screenShakeEnabled;
    await page.locator('[data-debug-row="Screen shake"] button').click();
    await waitForStatsKeyChange(page, 'screenShakeEnabled', was, 'the filtered row to act');

    watch.assertClean();
  });

  test('what is open is remembered across closing, and across screens', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await openPanel(page);
    await expand(page, 'world', 'portal');
    await closePanel(page);

    await openPanel(page);
    await expect(page.locator('[data-debug-group="world"]')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-debug-section="portal"]')).toHaveAttribute('aria-expanded', 'true');
    await closePanel(page);

    // A different screen: the panel is the same component, still mounted.
    await engine(page, e => e.pauseGame());
    await waitForStats(page, s => s.gameState === 'PAUSED', 'the pause menu');
    await openPanel(page);
    await expect(page.locator('[data-debug-section="portal"]')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-debug-row="Transit fx"]')).toHaveCount(1);

    watch.assertClean();
  });
});
