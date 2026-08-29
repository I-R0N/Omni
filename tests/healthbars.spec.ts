/** Damage-triggered health bars (gauntlet 5d, U5 — the parked
 *  "damage-triggered health / shield bars" item).
 *
 *  An ENEMY bar is a HIT REACTION now, not a permanent label. That is a
 *  behaviour-VISIBLE change, so what it does is pinned rather than left to a
 *  screenshot: the trigger, the decay, the re-arm, the opt-out, the DBG A/B,
 *  and what MOVED (the shield strip is no longer player-only).
 *
 *  The PLAYER is the exception and keeps a permanent bar under the ship —
 *  U5 removed it and a later user call put it back, alongside the HUD chip
 *  rather than instead of it. Both readouts are pinned below, including the
 *  property that made the removal tempting: they read the same field.
 *
 *  The bar itself is canvas-drawn, so these read the STATE the renderer gates
 *  on — `healthBarTimer`, `alwaysShowHealthBar`, `damageTriggeredBars` —
 *  rather than sampling pixels (harness rule 3). What that state MEANS is one
 *  `if` in `renderHealthBar`; what puts it there is the real damage paths,
 *  which is what these drive (rule 6).
 *
 *  The subject is a capstone boss throughout, for the reasons `traits.spec.ts`
 *  uses one: a boss is an ORDINARY `EntityType.ENEMY` (CLAUDE.md §5), it can
 *  be warped in and parked deterministically, and `debugSpawnBoss` is a
 *  supported path. Nothing here depends on it being a boss except the one
 *  assertion that says a boss does NOT opt out.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, stats, startRun, waitForStats, waitForEngine, waitForTransit } from './helpers';

/** `UI_CONSTANTS.HEALTH_BAR.SHOW_DURATION`, hard-coded rather than imported
 *  (harness rule 7 — a test that imports the value it checks asserts that a
 *  constant equals itself). */
const SHOW_DURATION = 2.2;

/** Warp a capstone in on an arena, park it, silence its gun, move the player
 *  clear, and hand back its id. Same isolation `traits.spec.ts` uses and for
 *  the same reason (rule 5): a live boss shooting near the player picks up
 *  splash from its own shells. Traits are turned OFF so regen cannot heal the
 *  subject mid-measurement. */
async function parkedBoss(page: any, id = 'BOSS_SCATTER') {
  await startRun(page);
  await engine(page, e => e.transitionToMap('arena_universe'));
  await waitForTransit(page);
  await waitForStats(page, s => s.currentMapType === 'UNIVERSE', 'the arena');
  await engine(page, (e, bid: string) => e.debugSpawnBoss(bid), id);
  await waitForStats(page, s => !!s.boss, 'the boss to warp in');
  return engine(page, e => {
    const b = e.currentMap.entities.find((x: any) => x.isBoss && x.active);
    b.velocity.x = 0; b.velocity.y = 0;
    b.weaponCooldown = 9999;
    b.healthBarTimer = 0;
    e.physics.traitsEnabled = false;
    e.player.position.x = b.position.x + 3000;
    e.player.position.y = b.position.y + 3000;
    e.player.velocity.x = 0; e.player.velocity.y = 0;
    return b.id;
  });
}

/** One synthetic PLAYER shell through the REAL collision resolver — the same
 *  route `traits.spec.ts` measures damage with, so every gate on the way
 *  applies exactly as it does in play. */
async function shell(page: any, targetId: string, damage: number) {
  return engine(page, (e, o: { id: string; dmg: number }) => {
    const t = e.currentMap.entities.find((x: any) => x.id === o.id);
    if (!t) throw new Error('target gone');
    const dist = t.size.x * 0.5 + 4;
    const proj = {
      id: `hpbar_shell_${Math.floor(e.runTimeSec * 1000)}_${o.dmg}`,
      type: 'PROJECTILE',
      position: { x: t.position.x + dist, y: t.position.y },
      velocity: { x: -900, y: 0 },
      rotation: Math.PI,
      size: { x: 6, y: 6 },
      mass: 0.1,
      active: true,
      color: '#fff',
      damage: o.dmg,
      ownerType: 'PLAYER',
      ownerId: 'player',
      hitEntityIds: [],
    };
    const before = t.health;
    e.physics.resolveCollision(proj, t, { x: 0, y: 0 });
    return { dealt: before - t.health, timer: t.healthBarTimer ?? 0 };
  }, { id: targetId, dmg: damage });
}

const read = (page: any, id: string) => engine(page, (e, tid: string) => {
  const t = e.currentMap.entities.find((x: any) => x.id === tid);
  return t ? {
    health: t.health,
    timer: t.healthBarTimer ?? 0,
    always: t.alwaysShowHealthBar === true,
    shield: t.shield ?? 0,
    maxShield: t.maxShield ?? 0,
  } : null;
}, id);

test.describe('the bar is a hit reaction, not a label', () => {
  test('untouched shows nothing; a hit arms the window; it decays to nothing', async ({ page }) => {
    const watch = await boot(page);
    const id = await parkedBoss(page);

    // Nothing has hit it, so there is nothing to show.
    expect((await read(page, id))!.timer, 'before any damage').toBe(0);

    const hit = await shell(page, id, 12);
    expect(hit.dealt, 'the shell landed').toBeGreaterThan(0);
    expect(hit.timer, 'the damage path armed the bar').toBeGreaterThan(0);
    expect(hit.timer, 'armed to SHOW_DURATION, no further')
      .toBeLessThanOrEqual(SHOW_DURATION + 0.001);

    // It counts DOWN — the bar fades rather than sticking.
    await waitForEngine(
      page,
      new Function('e', `
        const t = e.currentMap.entities.find(x => x.id === ${JSON.stringify(id)});
        return !!t && (t.healthBarTimer ?? 0) < ${(hit.timer - 0.3).toFixed(3)};
      `) as (e: any) => boolean,
      'the window to decay',
    );

    // And left alone it expires entirely, which is when the bar stops drawing.
    await waitForEngine(
      page,
      new Function('e', `
        const t = e.currentMap.entities.find(x => x.id === ${JSON.stringify(id)});
        return !!t && (t.healthBarTimer ?? 0) <= 0;
      `) as (e: any) => boolean,
      'the window to expire',
    );

    watch.assertClean();
  });

  test('a fresh hit RE-ARMS the window rather than accumulating', async ({ page }) => {
    const watch = await boot(page);
    const id = await parkedBoss(page);

    await shell(page, id, 6);
    await waitForEngine(
      page,
      new Function('e', `
        const t = e.currentMap.entities.find(x => x.id === ${JSON.stringify(id)});
        return !!t && (t.healthBarTimer ?? 0) < 1.5;
      `) as (e: any) => boolean,
      'the window to run part-way down',
    );

    const again = await shell(page, id, 6);
    expect(again.timer, 're-armed by the second hit').toBeGreaterThan(1.5);
    // The distinction that matters: hits RESET the window, they do not extend
    // it without limit, so a long fight never leaves a bar stuck on screen.
    expect(again.timer, 'never accumulates past SHOW_DURATION')
      .toBeLessThanOrEqual(SHOW_DURATION + 0.001);

    watch.assertClean();
  });
});

test.describe('the player readouts', () => {
  /*  REVERSED (user call): the player's floating bar is BACK, and the HUD
   *  chip stays.  U5 argued the two were the same number twice; in play they
   *  are not — the bar is where the eye already is, the chip is where the
   *  exact figure is — so this now pins BOTH, and pins the one property that
   *  made the removal tempting: they never disagree.
   *
   *  The bar is canvas-drawn, so rather than sampling pixels this drives the
   *  real draw call with a RECORDING context and reads the rects it asks
   *  for.  Same move as calling `physics.resolveCollision` directly: the
   *  method is private at compile time only, and the geometry is the thing
   *  that can silently be wrong. */
  test('the player keeps a bar under the ship AND the HUD chip', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // `vitals` is pushed EVERY frame — unlike `playerStats`, which is built
    // only while a menu is open.
    const s = await waitForStats(page, x => !!x.vitals, 'the vitals payload');
    expect(s.vitals!.maxHealth, 'a hull pool').toBeGreaterThan(0);
    expect(s.vitals!.health, 'starts whole').toBe(s.vitals!.maxHealth);

    await expect(page.getByTestId('player-vitals')).toBeVisible();

    await engine(page, e => { e.player.health = Math.round(e.player.maxHealth * 0.4); });
    const hurt = await waitForStats(
      page,
      x => !!x.vitals && x.vitals.health < x.vitals.maxHealth,
      'the hull readout to drop',
    );
    await expect(page.getByTestId('player-vitals'))
      .toContainText(`${hurt.vitals!.health}/${hurt.vitals!.maxHealth}`);

    // And the world-space bar draws it too, at the same fraction.
    const bar = await engine(page, e => {
      const rects: { x: number; y: number; w: number; h: number }[] = [];
      const rec: any = {
        fillRect: (x: number, y: number, w: number, h: number) => rects.push({ x, y, w, h }),
        set fillStyle(_v: any) {}, get fillStyle() { return ''; },
      };
      e.renderer.renderPlayerVitalsBar(rec, e.player, 500, 400);
      return { rects, frac: e.player.health / e.player.maxHealth };
    });

    // Two rects with no shield installed: the track and the hull fill.
    expect(bar.rects.length, 'track + fill, no shield on the lean start').toBe(2);
    const [track, fill] = bar.rects;
    expect(track.y, 'drawn BELOW the ship').toBeGreaterThan(400);
    expect(fill.w / track.w, 'the fill is the hull fraction').toBeCloseTo(bar.frac, 2);

    // Full hull fills the track; an empty one draws nothing over it. The bar
    // and the chip are reading the same field, so they cannot disagree.
    const ends = await engine(page, e => {
      const run = (hp: number) => {
        const rects: any[] = [];
        const rec: any = {
          fillRect: (x: number, y: number, w: number, h: number) => rects.push({ x, y, w, h }),
          set fillStyle(_v: any) {}, get fillStyle() { return ''; },
        };
        e.player.health = hp;
        e.renderer.renderPlayerVitalsBar(rec, e.player, 0, 0);
        return rects;
      };
      const full = run(e.player.maxHealth);
      const empty = run(0);
      e.player.health = e.player.maxHealth;
      return { fullW: full[1].w, trackW: full[0].w, emptyW: empty[1].w };
    });
    expect(ends.fullW).toBe(ends.trackW);
    expect(ends.emptyW).toBe(0);

    watch.assertClean();
  });

  test('the shield strip rides along only once a Shield core is installed', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // The lean start has no shield pool, and an empty strip would be a
    // permanent reminder of a module the player has not bought.
    const before = await engine(page, e => {
      const rects: any[] = [];
      const rec: any = {
        fillRect: (x: number, y: number, w: number, h: number) => rects.push({ x, y, w, h }),
        set fillStyle(_v: any) {}, get fillStyle() { return ''; },
      };
      e.renderer.renderPlayerVitalsBar(rec, e.player, 0, 0);
      return { maxShield: e.player.maxShield ?? 0, rects: rects.length };
    });
    expect(before.maxShield, 'no shield on the lean start').toBe(0);
    expect(before.rects, 'hull track + fill only').toBe(2);

    const after = await engine(page, e => {
      e.player.maxShield = 50;
      e.player.shield = 25;
      const rects: any[] = [];
      const rec: any = {
        fillRect: (x: number, y: number, w: number, h: number) => rects.push({ x, y, w, h }),
        set fillStyle(_v: any) {}, get fillStyle() { return ''; },
      };
      e.renderer.renderPlayerVitalsBar(rec, e.player, 0, 0);
      e.player.maxShield = 0; e.player.shield = 0;
      return rects;
    });
    expect(after.length, 'hull pair + shield pair').toBe(4);
    // The shield strip sits UNDER the hull bar, and reads half a pool.
    expect(after[2].y).toBeGreaterThan(after[0].y);
    expect(after[3].w / after[2].w).toBeCloseTo(0.5, 2);

    watch.assertClean();
  });

  test('the shield strip is no longer player-only', async ({ page }) => {
    const watch = await boot(page);
    // The Warden carries a real shield pool in phase 1, and shield absorption
    // has been entity-agnostic since the Bulwark — so its strip is exactly
    // what the old player-only gate hid.
    const id = await parkedBoss(page, 'BOSS_WARDEN');
    const before = (await read(page, id))!;
    expect(before.maxShield, 'the Warden has a shield pool').toBeGreaterThan(0);
    expect(before.shield, 'and it starts charged').toBeGreaterThan(0);

    // A hit that the shield eats still arms the bar, which is the point: the
    // strip has to be on screen for the player to watch it drain.
    const hit = await shell(page, id, 8);
    expect(hit.timer, 'a shield-absorbed hit still arms the bar').toBeGreaterThan(0);

    watch.assertClean();
  });
});

test.describe('the opt-out', () => {
  test('a priority target keeps a permanent bar; a capstone boss does not', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // The dragon is the one roamer the player TRACKS rather than reacts to,
    // so it opts out and keeps a bar whether or not it has been hit.
    await engine(page, e => e.debugSpawnDragon('rock'));
    await waitForEngine(page, (e: any) => e.dragons.length > 0, 'a dragon');
    const dragon = await engine(page, e => {
      const head = e.dragons[0].head;
      return { always: head.alwaysShowHealthBar === true, timer: head.healthBarTimer ?? 0 };
    });
    expect(dragon.always, 'the dragon opts out of the damage trigger').toBe(true);
    expect(dragon.timer, 'and has not been hit, which is the point').toBe(0);

    // A capstone boss deliberately does NOT opt out: it has the dedicated HUD
    // bar, so a second permanent readout under its hull would be exactly the
    // redundancy this milestone removed from the player.
    await engine(page, e => e.debugSpawnBoss('BOSS_WARDEN'));
    await waitForStats(page, x => !!x.boss, 'the boss');
    const boss = await engine(page, e => {
      const b = e.currentMap.entities.find((x: any) => x.isBoss && x.active);
      return b ? b.alwaysShowHealthBar === true : null;
    });
    expect(boss, 'the boss relies on its HUD bar').toBe(false);

    watch.assertClean();
  });

  test('the DBG toggle offers the pre-5d behaviour as an honest A/B', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    expect((await stats(page)).damageTriggeredBars, 'damage-triggered by default').toBe(true);

    await engine(page, e => e.dbg.toggleDamageTriggeredBars());
    await waitForStats(page, s => s.damageTriggeredBars === false, 'the always-on mode');
    expect(await engine(page, e => e.renderer.damageTriggeredBars),
      'the renderer follows the toggle').toBe(false);

    await engine(page, e => e.dbg.toggleDamageTriggeredBars());
    await waitForStats(page, s => s.damageTriggeredBars === true, 'back to damage-triggered');

    watch.assertClean();
  });
});
