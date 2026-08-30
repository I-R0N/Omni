/** Screen shake — magnitude from the player's own velocity step, and a
 *  direction.
 *
 *  The player-collision shake used to be `min(impactSpeed, HEAVY) *
 *  CAP_MULTIPLIER`: SPEED ALONE, with no mass in it. Every other part of the
 *  collision code weighs mass — the crash gate is `mass * impactSpeed >
 *  ASTEROID_CRASH_MOMENTUM`, the impulse solver splits by (bias-compressed)
 *  inverse mass — so shake was the exception, and a 15px chip shook the
 *  camera exactly as hard as a static wall at the same closing speed (user
 *  report: "feels overpowered").
 *
 *  It now reads the quantity the solver is about to apply anyway: how much
 *  the PLAYER's velocity changes along the normal. What that buys is pinned
 *  here as three separate claims, because they can fail independently:
 *
 *   1. ORDERING — a heavier impactor shakes more at the same closing speed,
 *      and a light enough one does not register at all.
 *   2. PARITY — a static tile is unchanged from the old curve. This is the
 *      claim that makes the change targeted rather than a global nerf, and
 *      it is the one a "just lower the numbers" regression would break.
 *   3. DIRECTION — the camera lurches along the axis the ship was shoved,
 *      and callers with no meaningful direction still get isotropic jitter.
 *
 *  Driven through the REAL resolver (harness rules 3 and 6), the same way
 *  `terrain.spec.ts` and `healthbars.spec.ts` drive it.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, startRun, waitForStats } from './helpers';

/** COLLISION_CONFIG.SHAKE, hard-coded rather than imported (harness rule 7). */
const DV_MIN = 3.0;
const IMPACT_MAX = 30;

/** Put the player somewhere empty and still, so only the synthetic impactor
 *  can shake the camera. */
async function quietPlayer(page: any) {
  await startRun(page, 'GLASS_FIELD');
  await waitForStats(page, s => s.currentMapType === 'GLASS_FIELD', 'the glass field');
  await engine(page, e => {
    e.player.position.x += 4000;
    e.player.position.y += 4000;
    e.player.velocity.x = 0; e.player.velocity.y = 0;
    e.screenShakeEnabled = true;
  });
}

/** Drive one head-on impact into the player and report the shake it armed.
 *
 *  `mass: null` means a STATIC body (mass Infinity) — the wall case. The
 *  impactor approaches from +x heading -x, so the player is shoved along -x
 *  and the direction is unambiguous. */
function impact(page: any, mass: number | null, closingSpeed: number) {
  return engine(page, (e, o: { mass: number | null; v: number }) => {
    const p = e.player;
    p.velocity.x = 0; p.velocity.y = 0;
    e.shakeIntensity = 0; e.shakeTimer = 0;
    e.shakeDirX = 0; e.shakeDirY = 0;

    const body = {
      id: 'shake_probe', type: 'STRUCTURE', shardVariant: 'rock-shard',
      position: { x: p.position.x + p.size.x * 0.5 + 12, y: p.position.y },
      velocity: { x: -o.v, y: 0 }, rotation: 0,
      size: { x: 30, y: 30 },
      mass: o.mass === null ? Infinity : o.mass,
      active: true, color: '#888', health: 9999, maxHealth: 9999,
    };
    // mtv points a → b; the player is `b`, to the impactor's left.
    e.physics.resolveCollision(body, p, { x: -4, y: 0 }, undefined, undefined, e.handleScreenShake);
    return {
      intensity: e.shakeIntensity,
      timer: e.shakeTimer,
      dirX: e.shakeDirX,
      dirY: e.shakeDirY,
    };
  }, { mass, v: closingSpeed });
}

test.describe('shake magnitude follows the impact, not the speed', () => {
  test('a heavier impactor shakes more, and a light one not at all', async ({ page }) => {
    const watch = await boot(page);
    await quietPlayer(page);

    // ONE closing speed throughout: under the old rule every one of these
    // produced the identical maximum, which is the whole complaint.
    const V = 20;
    const wall  = await impact(page, null, V);
    const heavy = await impact(page, 48, V);   // ~40px metal shard
    const mid   = await impact(page, 11.2, V); // ~25px rock shard
    const chip  = await impact(page, 0.64, V); // ~8px glass chip

    expect(wall.intensity, 'a wall is the hardest hit there is').toBe(IMPACT_MAX);
    expect(heavy.intensity).toBeLessThan(wall.intensity);
    expect(mid.intensity).toBeLessThan(heavy.intensity);
    // The chip's velocity step is below the floor, so it is not felt.  This
    // is the user's case: it used to pin the cap.
    expect(chip.intensity, 'a chip does not shake the camera').toBe(0);
    expect(chip.timer, 'and arms nothing').toBe(0);

    // Every non-zero shake respects the floor and the ceiling.
    for (const r of [wall, heavy, mid]) {
      expect(r.intensity).toBeGreaterThan(DV_MIN);
      expect(r.intensity).toBeLessThanOrEqual(IMPACT_MAX);
    }

    watch.assertClean();
  });

  test('the WALL curve is unchanged — this is not a global nerf', async ({ page }) => {
    const watch = await boot(page);
    await quietPlayer(page);

    /*  The old rule was `min(v, 20) * 1.5` for every hard target.  Against a
     *  STATIC body the new rule works out to exactly that — (1+ELASTICITY) *
     *  v, capped — so crashing into terrain feels precisely as it did, and
     *  the change is isolated to what a light body does.  If someone "fixes"
     *  an overpowered shake by scaling the whole thing down, this fails. */
    for (const v of [4, 10, 20, 30]) {
      const expected = Math.min(v, 20) * 1.5;
      const r = await impact(page, null, v);
      expect(r.intensity, `wall at closing speed ${v}`).toBeCloseTo(expected, 5);
    }

    // The threshold matches the old one too: it fired above v = 2.
    expect((await impact(page, null, 1.9)).intensity, 'below the old threshold').toBe(0);
    expect((await impact(page, null, 2.5)).intensity, 'above it').toBeGreaterThan(0);

    watch.assertClean();
  });

  test('a heavier SHIP shrugs the same hit off', async ({ page }) => {
    const watch = await boot(page);
    await quietPlayer(page);

    // Player mass scales with ship weight (SHIP_WEIGHT), so this falls out of
    // the formula rather than being written: the same rock against a laden
    // hull moves it less, and moving less is what shake now measures.
    const lean = await impact(page, 48, 20);
    await engine(page, e => { e.player.mass *= 3; });
    const laden = await impact(page, 48, 20);
    expect(laden.intensity).toBeLessThan(lean.intensity);

    watch.assertClean();
  });
});

test.describe('a shot never rivals a collision', () => {
  /** Shoot the PLAYER and report the shake it armed. The projectile-hit
   *  shake is deliberately damage-driven rather than momentum-driven — a
   *  bolt's actual momentum against the hull is an order of magnitude under
   *  the body-impact floor — so what has to hold is not a formula but a
   *  PLACE IN THE SCALE: being shot must read as less violent than flying
   *  into terrain. */
  function shootPlayer(page: any, damage: number) {
    return engine(page, (e, dmg: number) => {
      const p = e.player;
      e.shakeIntensity = 0; e.shakeTimer = 0; e.shakeDirX = 0; e.shakeDirY = 0;
      const proj = {
        id: 'shake_shot', type: 'PROJECTILE',
        position: { x: p.position.x + p.size.x * 0.5 + 4, y: p.position.y },
        velocity: { x: -16, y: 0 }, rotation: Math.PI,
        size: { x: 6, y: 6 }, mass: 1, active: true, color: '#f00',
        damage: dmg, ownerType: 'ENEMY', ownerId: 'e1', hitEntityIds: [],
      };
      e.physics.resolveCollision(proj, p, { x: 0, y: 0 }, undefined, undefined, e.handleScreenShake);
      return { intensity: e.shakeIntensity, dirX: e.shakeDirX };
    }, damage);
  }

  test('the heaviest shell shakes less than a moderate crash', async ({ page }) => {
    const watch = await boot(page);
    await quietPlayer(page);

    // The two ends of the shipped enemy-damage range: a Drone pellet and a
    // Bastion siege shell.
    const pellet = await shootPlayer(page, 5);
    const shell  = await shootPlayer(page, 18);

    // Reference points on the BODY-impact scale, measured the same way the
    // rest of this file does, so the comparison is between live numbers
    // rather than against constants copied into the test.
    const crashAtThreshold = await impact(page, null, 4);   // wall, break speed
    const crashModerate    = await impact(page, null, 8);   // wall, twice that

    expect(shell.intensity, 'a heavy shell stays under a moderate crash')
      .toBeLessThan(crashModerate.intensity);
    expect(pellet.intensity, 'a pellet stays under the crash threshold itself')
      .toBeLessThan(crashAtThreshold.intensity);
    // ...but a shell still outweighs a pellet: the readout is not flattened.
    expect(shell.intensity).toBeGreaterThan(pellet.intensity);

    // And it is still directional, along the shot's travel.
    expect(shell.dirX).toBeLessThan(0);

    watch.assertClean();
  });
});

test.describe('shake direction follows the impact vector', () => {
  test('a head-on hit lurches the camera along the shove, not at random', async ({ page }) => {
    const watch = await boot(page);
    await quietPlayer(page);

    // Impactor travels -x, so the player is shoved -x and the stored axis
    // must point that way.
    const r = await impact(page, null, 20);
    expect(r.dirX, 'the axis is the impact direction').toBeCloseTo(-1, 5);
    expect(r.dirY, 'and has no cross component on a head-on hit').toBeCloseTo(0, 5);

    /*  And the camera actually MOVES along it.  Sampled over a burst of live
     *  frames rather than at one instant: the displacement is a decaying
     *  OSCILLATION, so its sign flips several times across the window and any
     *  single sample would be a phase lottery.  What is phase-independent —
     *  and what "directional" means — is that the excursion along the axis
     *  dwarfs the off-axis jitter, and that it swings to the shove side at
     *  some point rather than only away from it. */
    // Sampled IN THE PAGE across consecutive rAF frames, not by a dozen
    // round-trips.  Each round-trip costs a few milliseconds of latency, so
    // twelve of them skip most of the decay and land on whichever twelve
    // moments the harness happened to catch — on a loaded CI runner that
    // lottery put the axis ratio at 1.87 against the 2.0 asserted below, from
    // a shake that was behaving perfectly.  Reading every frame of the window
    // measures the excursion the assertion is actually about.
    await impact(page, null, 20);
    const { maxAbsX, maxAbsY, minX } = await page.evaluate(() => new Promise<{
      maxAbsX: number; maxAbsY: number; minX: number;
    }>(resolve => {
      const e = (window as any).__omniEngine;
      let maxAbsX = 0, maxAbsY = 0, minX = Infinity, frames = 0;
      const tick = () => {
        const o = e.camera.shakeOffset;
        maxAbsX = Math.max(maxAbsX, Math.abs(o.x));
        maxAbsY = Math.max(maxAbsY, Math.abs(o.y));
        minX = Math.min(minX, o.x);
        if (++frames >= 24) resolve({ maxAbsX, maxAbsY, minX });
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    expect(maxAbsX, 'the camera moved at all').toBeGreaterThan(0);
    expect(maxAbsX, 'displacement is along the impact axis, not across it')
      .toBeGreaterThan(maxAbsY * 2);
    expect(minX, 'it swings the way the ship was shoved').toBeLessThan(0);

    watch.assertClean();
  });

  test('a shake with no direction still jitters isotropically', async ({ page }) => {
    const watch = await boot(page);
    await quietPlayer(page);

    /*  Explosions, warp-ins and reward beats have no impact axis, and they
     *  all call `handleScreenShake(amount)` with a bare number.  That has to
     *  keep working unchanged — the direction is an ADDITION, not a new
     *  requirement. */
    const r = await engine(page, e => {
      e.shakeIntensity = 0; e.shakeTimer = 0; e.shakeDirX = 0; e.shakeDirY = 0;
      e.handleScreenShake(12);
      return { intensity: e.shakeIntensity, dirX: e.shakeDirX, dirY: e.shakeDirY, timer: e.shakeTimer };
    });
    expect(r.intensity).toBe(12);
    expect(r.timer).toBeGreaterThan(0);
    expect(r.dirX, 'no axis').toBe(0);
    expect(r.dirY, 'no axis').toBe(0);

    watch.assertClean();
  });
});
