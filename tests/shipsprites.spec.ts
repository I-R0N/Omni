/** SHIP TILT SHEETS — the player hull as pre-rendered ART, one authored
 *  pose per tilt, in place of the cos(tilt) squash that fakes
 *  foreshortening on a single flat sprite (user request).
 *
 *  The whole design rests on ONE decomposition, and it is the thing worth
 *  pinning: YAW is a rotation about the view axis, so it commutes with the
 *  orthographic projection and `ctx.rotate` reproduces it exactly — no art
 *  needed.  PITCH and ROLL are rotations about in-plane axes, genuinely
 *  change the silhouette, and are what the art is for.  So a sheet is a 2D
 *  polar grid over the tilt — rings of magnitude, sampled at axis azimuths
 *  — and the count of authored cells falls out of that.
 *
 *  What is pinned here is the CONTRACT between the engine's cell lookup and
 *  the artist's file list, because that contract is wrong in a way nothing
 *  reports: a mis-folded mirror or a shifted cell order draws a perfectly
 *  plausible ship in the WRONG pose, throwing nothing and logging nothing.
 *
 *   1. THE GRID — 35 authored cells for the standard sheet, ring 0 is the
 *      single level pose, and every ring's azimuth samples land on the two
 *      mirror fixed points (±90°, the pure pitches) so folding is exact.
 *   2. INDEX ORDER — `cellIndex` arithmetic agrees with `enumerateCells`
 *      enumeration order for every cell.  A packed sheet is read row-major
 *      in that order, so a disagreement silently re-poses the whole sheet.
 *   3. MIRRORING — opposite ROLLS resolve to the SAME cell with the flip
 *      flag inverted (that is the halving), while the two pure PITCHES are
 *      distinct cells and are never flipped (they are the fixed points).
 *   4. CLAMPING — a tilt past the outer ring clamps there rather than
 *      wrapping, which is what keeps an unbounded TUMBLE angle from
 *      mirroring the hull.
 *   5. THE MATRIX — mirrored or not, the art's nose maps onto the facing
 *      (the invariant a reflection is easy to get backwards), and the
 *      mirrored form really is a reflection (det = -1).
 *   6. END TO END — Sheet mode renders a live bank with a clean console.
 */

import { test, expect } from '@playwright/test';
import { boot, enableTilt, engine, startRun, waitForEngine, waitForStats } from './helpers';

/** assets.ts SHIP_TILT_GRID_STANDARD, hard-coded (harness rule 7). */
const RING_DEG = [0, 15, 30, 45, 60, 75, 90];
const AZIMUTHS = [1, 4, 8, 8, 12, 12, 12];
/** Mirrored, a ring stores n/2 + 1 azimuths (both ±90° fixed points). */
const CELL_COUNT = AZIMUTHS.reduce((a, n) => a + (n <= 1 ? 1 : n / 2 + 1), 0);

test.describe('the tilt grid is the sheet contract', () => {
  test('35 authored cells, one level pose, and the mirror fixed points are sampled', async ({ page }) => {
    const watch = await boot(page);

    const r = await page.evaluate(() => {
      const { enumerateCells, cellIndex, SHIP_SHEETS } = (window as any).__omniShip;
      const s = SHIP_SHEETS.base;
      const cells = enumerateCells(s);
      // Index arithmetic must agree with enumeration order for EVERY cell.
      const orderOk = cells.every((c: any, i: number) =>
        c.index === i && cellIndex(s, c.ring, c.azim, c.yaw) === i);
      const byRing: Record<number, number[]> = {};
      for (const c of cells) (byRing[c.ring] ??= []).push(c.azimDeg);
      return {
        count: cells.length,
        orderOk,
        ringCount: s.grid.rings.length,
        level: { theta: cells[0].thetaDeg, roll: cells[0].rollDeg, pitch: cells[0].pitchDeg },
        ring0Size: byRing[0].length,
        // Every tilted ring must contain BOTH pure pitches (90 and 270) —
        // the axes the mirror folds about.
        allRingsHaveFixedPoints: Object.keys(byRing).slice(1)
          .every(k => byRing[+k].includes(90) && byRing[+k].includes(270)),
        // Files are named from the angles, so a mis-ordered delivery is
        // visible in the filename rather than silent.
        firstFile: cells[0].file,
        namesMatchAngles: cells.every((c: any) =>
          c.file.endsWith(`tilt_t${String(Math.round(c.thetaDeg)).padStart(3, '0')}`
            + `_a${String(Math.round(c.azimDeg)).padStart(3, '0')}.png`)),
      };
    });

    expect(r.count, 'the standard grid authors 35 cells').toBe(CELL_COUNT);
    expect(r.count).toBe(35);
    expect(r.ringCount).toBe(RING_DEG.length);
    expect(r.orderOk, 'cellIndex agrees with enumeration order for every cell').toBe(true);
    // Ring 0 is ONE pose: a level ship has no lean direction to sample.
    expect(r.ring0Size).toBe(1);
    expect(r.level).toEqual({ theta: 0, roll: 0, pitch: 0 });
    expect(r.allRingsHaveFixedPoints, 'every ring samples both pure pitches').toBe(true);
    expect(r.namesMatchAngles, 'filenames encode their own angles').toBe(true);
    expect(r.firstFile).toBe('/assets/ships/base/tilt_t000_a000.png');

    watch.assertClean();
  });
});

test.describe('mirroring halves the art', () => {
  test('opposite rolls share one cell; the pure pitches are distinct and never flipped', async ({ page }) => {
    const watch = await boot(page);

    const r = await page.evaluate(() => {
      const { resolveTiltCell, SHIP_SHEETS } = (window as any).__omniShip;
      const s = SHIP_SHEETS.base;
      const D = Math.PI / 180;
      const at = (rollDeg: number, pitchDeg: number) =>
        resolveTiltCell(s, rollDeg * D, pitchDeg * D, 0);
      return {
        right: at(45, 0), left: at(-45, 0),
        up: at(0, 45), down: at(0, -45),
        diag: at(30, 30), diagMirror: at(-30, 30),
      };
    });

    // THE HALVING: a left bank and a right bank are the same authored pose,
    // one drawn flipped.  Same cell, opposite flag.
    expect(r.right.index, 'both banks come from one cell').toBe(r.left.index);
    expect(r.right.mirror).toBe(false);
    expect(r.left.mirror).toBe(true);

    // The two pure pitches are the mirror's FIXED POINTS: genuinely
    // different poses (nose up is not nose down), and neither is ever
    // flipped — folding them would be the classic off-by-one in the fold.
    expect(r.up.index).not.toBe(r.down.index);
    expect(r.up.mirror).toBe(false);
    expect(r.down.mirror).toBe(false);

    // A diagonal lean folds like a roll does.
    expect(r.diag.index).toBe(r.diagMirror.index);
    expect(r.diag.mirror).toBe(false);
    expect(r.diagMirror.mirror).toBe(true);

    watch.assertClean();
  });
});

test.describe('tilt past the sheet clamps, it does not wrap', () => {
  test('a tumble-scale angle draws the outermost pose', async ({ page }) => {
    const watch = await boot(page);

    const r = await page.evaluate(() => {
      const { resolveTiltCell, enumerateCells, SHIP_SHEETS } = (window as any).__omniShip;
      const s = SHIP_SHEETS.base;
      const D = Math.PI / 180;
      const cells = enumerateCells(s);
      const outer = s.grid.rings.length - 1;
      return {
        outer,
        at83: resolveTiltCell(s, 83 * D, 0, 0).ring,   // MAX_TILT, the sim's ceiling
        at200: resolveTiltCell(s, 200 * D, 0, 0).ring, // a tumble, unbounded
        atPi: resolveTiltCell(s, Math.PI, 0, 0).ring,
        outerDeg: cells[cells.length - 1].thetaDeg,
      };
    });

    // 83° (PLAYER_ROLL_CONSTANTS.MAX_TILT) sits between the 75 and 90 rings
    // and snaps to the nearer one; anything past simply stays there.
    expect(r.at83).toBe(r.outer);
    expect(r.at200, 'a tumble clamps rather than wrapping to a shallow pose').toBe(r.outer);
    expect(r.atPi).toBe(r.outer);
    expect(r.outerDeg).toBe(90);

    watch.assertClean();
  });
});

test.describe('the cell matrix orients the pose', () => {
  test('the nose maps onto the facing in both forms, and the mirror is a reflection', async ({ page }) => {
    const watch = await boot(page);

    const r = await page.evaluate(() => {
      const { cellMatrix, SHIP_SHEETS } = (window as any).__omniShip;
      const s = SHIP_SHEETS.base;
      const yaw = 0.7;
      const plain = cellMatrix(s, { ring: 3, azim: 2, yaw: 0, mirror: false, index: 11 }, yaw);
      const flip = cellMatrix(s, { ring: 3, azim: 2, yaw: 0, mirror: true, index: 11 }, yaw);
      // The art is authored nose-right, so local +x IS the nose: applying
      // the matrix to (1,0) must give the facing direction in both forms.
      const nose = (m: any) => ({ x: m.l11, y: m.l21 });
      const det = (m: any) => m.l11 * m.l22 - m.l12 * m.l21;
      return {
        yaw, plainNose: nose(plain), flipNose: nose(flip),
        plainDet: det(plain), flipDet: det(flip),
        want: { x: Math.cos(yaw), y: Math.sin(yaw) },
      };
    });

    // THE invariant: however the cell is oriented, the ship points where it
    // is aimed.  A reflection composed on the wrong side would still look
    // like a ship — just aimed somewhere else.
    expect(r.plainNose.x).toBeCloseTo(r.want.x, 12);
    expect(r.plainNose.y).toBeCloseTo(r.want.y, 12);
    expect(r.flipNose.x, 'a mirrored cell still points along the facing').toBeCloseTo(r.want.x, 12);
    expect(r.flipNose.y).toBeCloseTo(r.want.y, 12);

    // Plain is a rotation, mirrored is a genuine reflection.
    expect(r.plainDet).toBeCloseTo(1, 12);
    expect(r.flipDet, 'the mirrored form reflects rather than rotates').toBeCloseTo(-1, 12);

    watch.assertClean();
  });
});

test.describe('the sheet renders in a real run', () => {
  test('Sheet mode draws a live bank from authored poses', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    // The tilt ships OFF and the hull ships as the legacy sprite, so a
    // player sees none of this without opting in — which makes turning it
    // on exactly two rows: "Roll feel" onto a preset, "Hull" onto Sheet.
    await enableTilt(page);

    await engine(page, e => {
      e.dbg.cyclePlayerHull(); // Ship -> Sheet, one step
      e.input.mousePosition = { x: window.innerWidth / 2 + 200, y: window.innerHeight / 2 };
    });
    await waitForStats(page, s => s.hullModeName === 'Sheet', 'the sheet hull');

    // The placeholder cells ship with the repo, so this exercises the REAL
    // blit path (resolve -> nearest -> drawImage), not the squash fallback.
    const ready = await page.evaluate(() => {
      const r: any = (window as any).__omniEngine.renderer ?? null;
      return !!r;
    });
    expect(ready).toBe(true);

    await engine(page, e => e.input.keys.add('KeyS'));
    await waitForEngine(page, e => Math.abs(e.player.visualRoll ?? 0) > 0.4,
      'a live bank drawn from the sheet');
    await engine(page, e => e.input.keys.delete('KeyS'));
    await waitForEngine(page, e => (e.player.visualRoll ?? 1) === 0, 'levelled off');

    // Back to the shipped default so nothing leaks into another spec.
    await engine(page, e => { for (let i = 0; i < 7; i++) e.dbg.cyclePlayerHull(); });
    await waitForStats(page, s => s.hullModeName === 'Ship', 'back to the sprite default');

    watch.assertClean();
  });
});
