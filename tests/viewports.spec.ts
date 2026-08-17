/** Viewport coverage — the parking-lot item absorbed into roadmap 5d.
 *
 *  Every other suite runs at 390×844, the phone this game is played on and
 *  the size every layout assertion was written against. That is the right
 *  primary target and it is the HARD one, but it is one point in a space,
 *  and several things in this UI are size-dependent by construction: the
 *  banner's `fitFontPx`, the indicator inset, the boss bar, the hex flowers,
 *  the minimap rect and the loadout strip.
 *
 *  So this file is the same handful of layout questions asked at six
 *  viewports instead of one, plus the case nothing anywhere covered: a
 *  MID-SESSION RESIZE.
 *
 *  **390×844 remains the design target.** The other five must be FUNCTIONAL
 *  and unbroken — nothing off-screen, nothing overlapping, nothing below the
 *  tap floor — not redesigned for. Where a viewport is allowed to look
 *  different, this file says nothing about it.
 *
 *  Three things it deliberately does NOT do:
 *
 *  - It does not re-run the other 111 tests at six sizes. Those assert
 *    behaviour, and behaviour is not a function of viewport; multiplying
 *    them would buy a six-times-longer merge gate and no information.
 *  - It does not screenshot. Visual regression is parked (tiers 3–5) and a
 *    capture with no assertion is not a test.
 *  - It does not reimplement any layout arithmetic. The three pure layout
 *    functions are driven through `window.__omniHud` (App.tsx, debug handle
 *    #4) for the same reason `input.spec.ts` drives the HID builders through
 *    `window.__omniHid`: they are pure, and they are wrong in a way nothing
 *    reports.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, engine, startRun, waitForStats, waitForEngine, dockAtStation } from './helpers';

/** The tap-target floor, hard-coded rather than imported (harness rule 7 —
 *  a test that imports the value it checks asserts that a constant equals
 *  itself). Matches `screens.spec.ts` and the `TAP` class in UIOverlay. */
const TAP_FLOOR = 40;

const VIEWPORTS = [
  { w: 320, h: 568, name: 'iPhone SE — the narrowest phone still in use' },
  { w: 390, h: 844, name: 'iPhone 12–15 — THE DESIGN TARGET' },
  { w: 430, h: 932, name: 'Pro Max — the large phone' },
  { w: 768, h: 1024, name: 'iPad portrait' },
  { w: 1024, h: 768, name: 'iPad landscape — the first genuinely landscape case' },
  { w: 1440, h: 900, name: 'desktop — where nothing shrinks' },
];

// ── Shared probes ─────────────────────────────────────────────────────────
// Each returns DATA, so a failure message names the offending element rather
// than saying "expected true".

/** Interactive elements below the tap floor, in the CURRENTLY-VISIBLE DOM.
 *
 *  The debug menu is excluded by construction rather than by a filter: it is
 *  collapsed by default and this suite never opens it. That exemption is
 *  deliberate and documented (5d D4) — a developer surface behind two
 *  dropdowns trades reach for density, and a 40px floor on ~90 diagnostic
 *  rows would add screens of scroll to a panel whose whole job is density. */
async function smallTargets(page: Page) {
  return page.evaluate((floor: number) => {
    const out: { label: string; w: number; h: number }[] = [];
    for (const el of Array.from(document.querySelectorAll('button, select, input'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height >= floor && r.width >= floor) continue;
      out.push({
        label: (el.getAttribute('data-testid') || el.getAttribute('aria-label')
          || (el.textContent || '').trim().slice(0, 30) || el.tagName).replace(/\s+/g, ' '),
        w: +r.width.toFixed(1),
        h: +r.height.toFixed(1),
      });
    }
    return out;
  }, TAP_FLOOR);
}

/** Anything laid out past either edge of the window. */
async function offViewport(page: Page) {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const out: { label: string; left: number; right: number }[] = [];
    for (const el of Array.from(document.querySelectorAll('[data-overlay] *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left >= -0.5 && r.right <= W + 0.5) continue;
      out.push({
        label: (el.getAttribute('data-hex') || el.getAttribute('data-testid')
          || (el.textContent || '').trim().slice(0, 30) || el.tagName).replace(/\s+/g, ' '),
        left: +r.left.toFixed(1),
        right: +r.right.toFixed(1),
      });
    }
    return out;
  });
}

/** How many lines a heading occupies — height over its own line-height.
 *  A screen title that silently wraps is the failure `truncate` prevents. */
async function lineCount(page: Page, selector: string) {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    return Math.round(el.getBoundingClientRect().height / lh);
  }, selector);
}

/** The two hex flowers' horizontal extents, and their overlap.
 *  Overlapping flowers are not merely untidy: the hexes are pointer drop
 *  targets resolved through `elementFromPoint`, which returns the TOPMOST
 *  `[data-tile]`, so an overlapping band can take a drop meant for its
 *  neighbour. */
async function flowerExtents(page: Page) {
  return page.evaluate(() => {
    const by: Record<string, { left: number; right: number; n: number }> = {};
    for (const el of Array.from(document.querySelectorAll('[data-hex]'))) {
      const g = el.getAttribute('data-hex')!.split(':')[0];
      const r = el.getBoundingClientRect();
      by[g] ??= { left: Infinity, right: -Infinity, n: 0 };
      by[g].left = Math.min(by[g].left, r.left);
      by[g].right = Math.max(by[g].right, r.right);
      by[g].n++;
    }
    const overlap = by.ship && by.weapon
      ? Math.max(0, Math.min(by.ship.right, by.weapon.right) - Math.max(by.ship.left, by.weapon.left))
      : null;
    return { by, overlap, viewportW: document.documentElement.clientWidth };
  });
}

// ── The matrix ────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`${vp.w}×${vp.h} — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });

    test('the menus lay out inside the window and clear the tap floor', async ({ page }) => {
      const watch = await boot(page);

      // Main menu, then with both dropdowns' non-debug half open.
      expect(await offViewport(page), 'main menu').toEqual([]);
      expect(await smallTargets(page), 'main menu tap targets').toEqual([]);

      await page.getByTestId('menu-help-toggle').click();
      await expect(page.getByTestId('help-panel')).toBeVisible();
      expect(await offViewport(page), 'menu + help').toEqual([]);
      expect(await smallTargets(page), 'menu + help tap targets').toEqual([]);

      watch.assertClean();
    });

    test('the pause menu fits: titles on one line, flowers apart, nothing off-screen', async ({ page }) => {
      const watch = await boot(page);
      await startRun(page);
      await engine(page, e => e.pauseGame());
      await waitForStats(page, s => s.gameState === 'PAUSED', 'the pause menu');

      // The screen title and the salvage chip beside it share one row. Both
      // wrapped to two lines at the DESIGN viewport before 5d U2.
      expect(await lineCount(page, '[data-overlay="pause"] h2'), 'pause title lines').toBe(1);

      const f = await flowerExtents(page);
      expect(f.by.ship?.n, 'ship flower hexes').toBe(7);
      expect(f.by.weapon?.n, 'weapon flower hexes').toBe(7);
      expect(f.overlap, 'ship/weapon flower overlap').toBe(0);
      expect(f.by.ship!.left, 'ship flower left edge').toBeGreaterThanOrEqual(-0.5);
      expect(f.by.weapon!.right, 'weapon flower right edge').toBeLessThanOrEqual(f.viewportW + 0.5);

      expect(await offViewport(page), 'pause menu').toEqual([]);
      expect(await smallTargets(page), 'pause menu tap targets').toEqual([]);

      watch.assertClean();
    });

    test('the station fits, shop rows included', async ({ page }) => {
      const watch = await boot(page);
      await startRun(page);
      await engine(page, e => e.addDebugCredits(200000));
      await dockAtStation(page);

      expect(await lineCount(page, '[data-overlay="station"] h2'), 'station title lines').toBe(1);
      expect((await flowerExtents(page)).overlap, 'flower overlap').toBe(0);
      expect(await offViewport(page), 'station').toEqual([]);
      // The shop purchase rows are the primary commerce action and were the
      // shortest control on any player-facing surface (24.5px) before U2.
      expect(await smallTargets(page), 'station tap targets').toEqual([]);

      watch.assertClean();
    });

    test('the death summary fits and its three exits clear the floor', async ({ page }) => {
      const watch = await boot(page);
      await startRun(page);
      await engine(page, e => e.startExplosion(e.player));
      await waitForStats(page, s => !!s.runSummary, 'the run summary');

      for (const id of ['death-respawn', 'death-restart', 'death-menu']) {
        const box = (await page.getByTestId(id).boundingBox())!;
        expect(box, `${id} laid out`).not.toBeNull();
        expect(box.height, `${id} height`).toBeGreaterThanOrEqual(TAP_FLOOR);
        expect(box.x, `${id} left edge`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${id} right edge`).toBeLessThanOrEqual(vp.w);
      }
      expect(await offViewport(page), 'death summary').toEqual([]);

      watch.assertClean();
    });

    test('the boss bar never lands on the readout stack', async ({ page }) => {
      const watch = await boot(page);
      await startRun(page);
      await engine(page, e => e.transitionToMap('arena_universe'));
      await waitForStats(page, s => s.currentMapType === 'UNIVERSE', 'the arena');
      // Money and two status effects, so the chip stack is at its TALLEST —
      // which is the state the collision happened in.
      await engine(page, e => {
        e.awardScore(123456);
        e.addDebugCredits(50000);
        e.debugApplyCorrosion();
        e.debugApplyDisable();
      });
      await engine(page, e => e.debugSpawnBoss('BOSS_WARDEN'));
      await waitForStats(page, s => !!s.boss, 'the boss bar');

      const hits = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid="boss-bar"]');
        if (!bar) return ['no boss bar rendered'];
        const b = bar.getBoundingClientRect();
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll('div'))) {
          if (el === bar || bar.contains(el) || el.contains(bar)) continue;
          const c = el.className;
          // The HUD readout chips — the stack the bar used to land on.
          if (typeof c !== 'string' || !/backdrop-blur-sm/.test(c)) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0) continue;
          const clear = r.right <= b.left || b.right <= r.left
                     || r.bottom <= b.top || b.bottom <= r.top;
          if (!clear) out.push((el.textContent || '').trim().slice(0, 30));
        }
        return out;
      });
      expect(hits, 'HUD chips overlapping the boss bar').toEqual([]);

      // And the bar itself stays on screen.
      const bb = (await page.getByTestId('boss-bar').boundingBox())!;
      expect(bb.x).toBeGreaterThanOrEqual(0);
      expect(bb.x + bb.width).toBeLessThanOrEqual(vp.w + 0.5);

      // The top bar is `justify-between` with three items — vitals chip,
      // readout stack, pause button — and an unshrinkable middle SHOVES THE
      // LAST ONE OUT. That is a real regression this caught at 320px while
      // U5 was being written: the pause button left the screen. So both
      // ends of the row are pinned, not just the bar between them.
      for (const id of ['player-vitals', 'Pause']) {
        const el = id === 'Pause'
          ? page.getByRole('button', { name: 'Pause' })
          : page.getByTestId(id);
        const box = (await el.boundingBox())!;
        expect(box, `${id} laid out`).not.toBeNull();
        expect(box.x, `${id} left edge`).toBeGreaterThanOrEqual(-0.5);
        expect(box.x + box.width, `${id} right edge`).toBeLessThanOrEqual(vp.w + 0.5);
      }

      watch.assertClean();
    });

    test('the canvas HUD keeps its rects on screen at this size', async ({ page }) => {
      const watch = await boot(page);
      await startRun(page);

      const geom = await page.evaluate(() => {
        const hud = (window as any).__omniHud;
        const W = window.innerWidth, H = window.innerHeight;
        return {
          W, H,
          minimap: hud.computeMinimapRect(H, false),
          minimapOpen: hud.computeMinimapRect(H, true),
          loadout: hud.computeLoadoutHUDLayout(W, H),
        };
      });

      // The collapsed minimap must be fully on screen at every size — it is
      // the navigation readout, and it is anchored to the bottom-left corner
      // with FIXED px margins, so a short window is where it would go under.
      expect(geom.minimap.x, 'minimap left').toBeGreaterThanOrEqual(0);
      expect(geom.minimap.y, 'minimap top').toBeGreaterThanOrEqual(0);
      expect(geom.minimap.y + geom.minimap.size, 'minimap bottom').toBeLessThanOrEqual(geom.H);
      expect(geom.minimap.x + geom.minimap.size, 'minimap right').toBeLessThanOrEqual(geom.W);

      // Both loadout slots on screen, and both wide enough to read a weapon
      // name and to be tapped (the strip doubles as the weapon selector).
      for (let i = 0; i < geom.loadout.slotXs.length; i++) {
        const x = geom.loadout.slotXs[i];
        expect(x, `loadout slot ${i} left`).toBeGreaterThanOrEqual(0);
        expect(x + geom.loadout.slotW, `loadout slot ${i} right`).toBeLessThanOrEqual(geom.W);
      }
      expect(geom.loadout.slotW, 'loadout slot width').toBeGreaterThanOrEqual(TAP_FLOOR);
      expect(geom.loadout.startY, 'loadout strip top').toBeGreaterThanOrEqual(0);

      watch.assertClean();
    });

    test('every banner the game can actually produce fits this window', async ({ page }) => {
      const watch = await boot(page);
      await startRun(page);

      /* `fitFontPx` shrinks a banner line until it measures inside the safe
       * width, FLOORED at a readability minimum — below which it stops
       * shrinking and lets the text clip, on the deliberate grounds that
       * unreadable text is worse than clipped text.
       *
       * So "always fits" is not the contract and asserting it would be
       * asserting a guarantee the function does not make. What matters is
       * the ENVELOPE: every string the game can really put in a banner must
       * fit WITHOUT reaching the floor, at every viewport. That is pinned
       * against the real BOSS_DEFS roster rather than a hardcoded list, so
       * adding a long boss name fails here instead of clipping in play.
       *
       * The pathological case is kept alongside, asserting the documented
       * give-up (exactly the floor, not zero and not NaN). */
      // The boss NAMES come from the sim, not from a list duplicated here:
      // spawn each capstone through the real DBG path and read the name the
      // HUD publishes. A new boss with a long name then fails this test
      // rather than clipping in play.
      const bossNames: string[] = [];
      for (const id of ['BOSS_WARDEN', 'BOSS_SCATTER', 'BOSS_SIEGE']) {
        await engine(page, (e, bid: string) => e.debugSpawnBoss(bid), id);
        const s = await waitForStats(page, x => !!x.boss, `the ${id} bar`);
        bossNames.push(s.boss!.name);
        await engine(page, e => {
          for (const x of e.currentMap.entities) if (x.isBoss) x.active = false;
        });
        await waitForStats(page, x => !x.boss, `${id} to clear`);
      }
      expect(bossNames.length, 'the capstone roster').toBe(3);

      const fit = await page.evaluate((names: string[]) => {
        const hud = (window as any).__omniHud;
        const ctx = document.createElement('canvas').getContext('2d')!;
        const W = window.innerWidth;
        // WAVE_ANNOUNCE_CONSTANTS, hard-coded per harness rule 7.
        const SIDE_MARGIN = 16, BASE = 48, MIN = 18, SUB_BASE = 24, SUB_MIN = 11;
        const safe = Math.max(80, W - SIDE_MARGIN * 2);
        const measure = (text: string, base: number, min: number) => {
          const px = hud.fitFontPx(ctx, text, safe, base, min);
          ctx.font = `bold ${px}px monospace`;
          return { text, px, min, width: ctx.measureText(text).width };
        };
        // Every MAIN line a banner can carry, and every SUBTEXT line.
        const mains = [
          'WAVE 1', 'WAVE 12',
          ...names,
          ...names.map(b => `${b} DESTROYED`),
        ];
        const subs = [
          'DESTROY 6 HOSTILES', 'DESTROY 24 HOSTILES', 'WAVE 6  ·  CAPSTONE',
        ];
        return {
          W, safe,
          mains: mains.map(t => measure(t, BASE, MIN)),
          subs: subs.map(t => measure(t, SUB_BASE, SUB_MIN)),
          absurd: measure('A VERY LONG CAPSTONE NAME THAT NOBODY WOULD EVER WRITE', BASE, MIN),
          noShrink: measure('WAVE 1', BASE, MIN).px,
        };
      }, bossNames);

      for (const m of [...fit.mains, ...fit.subs]) {
        expect(m.px, `"${m.text}": never above the design size`).toBeLessThanOrEqual(48);
        expect(m.px, `"${m.text}": never below the readability floor`).toBeGreaterThanOrEqual(m.min);
        // The envelope: a real banner fits WITHOUT bottoming out.
        expect(m.px, `"${m.text}": did not have to reach the floor`).toBeGreaterThan(m.min);
        expect(m.width, `"${m.text}": measures inside the safe band`).toBeLessThanOrEqual(fit.safe + 1);
        expect(m.width, `"${m.text}": on screen`).toBeLessThanOrEqual(fit.W);
      }

      // The FULL contract, stated as the invariant that holds at every width
      // rather than as a number that only holds at some: a fitted line either
      // measures inside the safe band, or it stopped exactly at the
      // readability floor. Never smaller, never in between. (At a phone width
      // the pathological string takes the second branch; at 768px and up it
      // takes the first, which is why this is an invariant and not an
      // equality.)
      const a = fit.absurd;
      expect(a.px, 'a pathological banner never shrinks past the floor').toBeGreaterThanOrEqual(18);
      expect(a.px === 18 || a.width <= fit.safe + 1,
        `a pathological banner either fits (${a.width.toFixed(0)}px in ${fit.safe}px) `
        + `or floors (got ${a.px}px)`).toBe(true);

      // The function only ever REDUCES, so a short line is untouched at
      // every width — including the narrow ones.
      expect(fit.noShrink, 'a short banner is never shrunk').toBe(48);

      watch.assertClean();
    });
  });
}

// ── Mid-session resize ────────────────────────────────────────────────────

test.describe('mid-session resize', () => {
  /** Rotating a phone or resizing a window is a real user action, and nothing
   *  in any suite ever changed the viewport after load. The suspects are the
   *  caches keyed on canvas size — the nebula render fast-path, the entity
   *  gradient caches, the minimap's pre-rendered terrain layer and its
   *  streamline cache, and the static-tile cache — all of which survive a
   *  resize INCORRECTLY if they key on something that changed. */
  test('portrait → landscape → back: layout recovers and the world keeps rendering', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await engine(page, e => e.transitionToMap('arena_universe'));
    await waitForStats(page, s => s.currentMapType === 'UNIVERSE', 'the arena');

    // Plant ONE drifting probe and watch it keep moving across every resize,
    // so "the world is still running" is measured against something we put
    // there rather than against whatever fauna happened to spawn (harness
    // rule 4). A cache that survives a resize incorrectly shows up either as
    // a throw inside the draw pass (the console watch catches that) or as a
    // world that stopped advancing (this catches that).
    await engine(page, e => {
      const p = e.player.position;
      e.drops.spawnSalvageDrop(
        e.currentMap.entities,
        e.activeDrops,
        { x: p.x + 4000, y: p.y + 4000 },
        { x: 60, y: 45 },
      );
      e.currentMap.entities[e.currentMap.entities.length - 1].__probe = true;
    });
    const probePos = () => engine(page, e => {
      const p = e.currentMap.entities.find((x: any) => x.__probe);
      return p && p.active ? p.position.x + p.position.y : null;
    });

    const sizes = [
      { width: 390, height: 844 },   // portrait phone
      { width: 844, height: 390 },   // rotated
      { width: 1440, height: 900 },  // desktop
      { width: 320, height: 568 },   // the floor
      { width: 390, height: 844 },   // home again
    ];

    for (const size of sizes) {
      await page.setViewportSize(size);
      // The engine's own resize handler runs off the window event; poll for
      // the canvas backing store to agree rather than sleeping (rule 1).
      await page.waitForFunction(
        (w: number) => {
          const c = document.querySelector('canvas') as HTMLCanvasElement | null;
          return !!c && Math.abs(c.getBoundingClientRect().width - w) < 2;
        },
        size.width,
        { timeout: 15_000 },
      );

      // The canvas HUD's rects follow the new window.
      const geom = await page.evaluate(() => {
        const hud = (window as any).__omniHud;
        const W = window.innerWidth, H = window.innerHeight;
        return { W, H, minimap: hud.computeMinimapRect(H, false), loadout: hud.computeLoadoutHUDLayout(W, H) };
      });
      expect(geom.minimap.y + geom.minimap.size,
        `minimap bottom at ${size.width}×${size.height}`).toBeLessThanOrEqual(geom.H);
      expect(geom.loadout.slotXs[1] + geom.loadout.slotW,
        `loadout right edge at ${size.width}×${size.height}`).toBeLessThanOrEqual(geom.W);

      // The probe is still there and still drifting.
      const before = await probePos();
      expect(before, `probe alive at ${size.width}×${size.height}`).not.toBeNull();
      await waitForEngine(
        page,
        new Function('e', `
          const p = e.currentMap.entities.find(x => x.__probe);
          return !!p && p.active && Math.abs(p.position.x + p.position.y - ${before}) > 1;
        `) as (e: any) => boolean,
        `the probe to drift at ${size.width}×${size.height}`,
      );
    }

    // And the DOM overlays still lay out at the size we ended on.
    await engine(page, e => e.pauseGame());
    await waitForStats(page, s => s.gameState === 'PAUSED', 'the pause menu');
    expect(await offViewport(page), 'pause menu after the resize round-trip').toEqual([]);
    expect(await lineCount(page, '[data-overlay="pause"] h2'), 'title lines').toBe(1);
    expect((await flowerExtents(page)).overlap, 'flower overlap').toBe(0);

    watch.assertClean();
  });

  /** The hex flowers are the one thing whose SIZE is computed from the
   *  viewport, so they are the one thing a resize can leave stale. */
  test('the hex flowers resize with the window rather than keeping their first size', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await engine(page, e => e.pauseGame());
    await waitForStats(page, s => s.gameState === 'PAUSED', 'the pause menu');

    await page.setViewportSize({ width: 320, height: 568 });
    await expect.poll(async () => (await flowerExtents(page)).viewportW).toBe(320);
    const narrow = await flowerExtents(page);
    expect(narrow.overlap, 'no overlap when narrow').toBe(0);
    expect(narrow.by.ship!.left).toBeGreaterThanOrEqual(-0.5);
    expect(narrow.by.weapon!.right).toBeLessThanOrEqual(320.5);

    await page.setViewportSize({ width: 1024, height: 768 });
    await expect.poll(async () => (await flowerExtents(page)).viewportW).toBe(1024);
    const wide = await flowerExtents(page);
    expect(wide.overlap, 'no overlap when wide').toBe(0);

    // The flowers must actually have GROWN — a cached size would pass every
    // overlap check above while looking wrong at both ends.
    const narrowW = narrow.by.ship!.right - narrow.by.ship!.left;
    const wideW = wide.by.ship!.right - wide.by.ship!.left;
    expect(wideW, 'flower grew with the window').toBeGreaterThan(narrowW);

    watch.assertClean();
  });
});
