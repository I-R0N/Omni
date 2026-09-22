/** SHIP TILT SHEET tooling.
 *
 *  Two jobs, both driven off `enumerateCells` in
 *  engine/systems/render/shipSprites.ts — the SAME table the engine indexes
 *  cells by, which is the point: an authoring guide or a placeholder set
 *  built from a second copy of the grid would drift silently and draw
 *  plausible ships in wrong poses.
 *
 *    node scripts/gen-ship-sheet.mjs --table       print the angle table
 *    node scripts/gen-ship-sheet.mjs --placeholder render stand-in art
 *
 *  `--table` emits the markdown block in docs/SHIP_SPRITE_SHEETS.md.
 *  `--placeholder` renders each pose from the WIREFRAME dart hull into
 *  public/assets/ships/<id>/, so the whole path — resolver, mirroring,
 *  loader, draw — can be exercised and watched before real art exists.
 *  Delete that folder to go back to the legacy squash.
 *
 *  Both need the built app (the grid lives in the bundle), so this runs the
 *  preview server the same way the Playwright suites do.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4183;
const SHIP = process.argv.find(a => a.startsWith('--ship='))?.slice(7) ?? 'base';
const WANT_TABLE = process.argv.includes('--table');
const WANT_ART = process.argv.includes('--placeholder');
/** Placeholder cell size.  Real art is free to use any square cell — the
 *  engine scales it to the entity — but every cell in a sheet must match. */
const CELL = 128;

if (!WANT_TABLE && !WANT_ART) {
  console.error('usage: gen-ship-sheet.mjs [--table] [--placeholder] [--ship=base]');
  process.exit(2);
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function serve() {
  const p = spawn('npx', ['vite', 'preview', '--port', String(PORT)], {
    cwd: ROOT, stdio: 'ignore', detached: false,
  });
  for (let i = 0; i < 40; i++) {
    await wait(250);
    try {
      const r = await fetch(`http://localhost:${PORT}/`);
      if (r.ok) return p;
    } catch { /* not up yet */ }
  }
  p.kill();
  throw new Error('vite preview did not come up — run `npm run build` first');
}

const server = await serve();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => !!window.__omniShip);

  const cells = await page.evaluate(id => {
    const { enumerateCells, SHIP_SHEETS } = window.__omniShip;
    return enumerateCells(SHIP_SHEETS[id]);
  }, SHIP);

  if (WANT_TABLE) {
    const rows = cells.map(c =>
      `| ${c.index} | ${c.thetaDeg.toFixed(0)}° | ${c.azimDeg.toFixed(0)}° | `
      + `${c.rollDeg.toFixed(1)}° | ${c.pitchDeg.toFixed(1)}° | \`${c.file.split('/').pop()}\` |`);
    console.log(`| # | tilt θ | axis ψ | roll | pitch | file |`);
    console.log(`|---|---|---|---|---|---|`);
    console.log(rows.join('\n'));
    console.error(`\n${cells.length} cells for ship "${SHIP}".`);
  }

  if (WANT_ART) {
    // Render each pose with the wireframe dart hull.  Its own draw applies
    // exactly the Rx(roll)·Ry(pitch) the resolver inverts, so a placeholder
    // cell is in the pose the engine will pick it for, by construction.
    const pngs = await page.evaluate(async ({ cells, CELL }) => {
      const { drawPlayerCube } = window.__omniShip;
      const out = [];
      for (const c of cells) {
        const cv = document.createElement('canvas');
        cv.width = CELL; cv.height = CELL;
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, CELL, CELL);
        ctx.setTransform(1, 0, 0, 1, CELL / 2, CELL / 2);
        drawPlayerCube(ctx, {
          size: { x: CELL * 0.30, y: CELL * 0.30 },
          visualRoll: (c.rollDeg * Math.PI) / 180,
          visualPitch: (c.pitchDeg * Math.PI) / 180,
        }, 'tri', false, false);
        out.push({ file: c.file, data: cv.toDataURL('image/png').split(',')[1] });
      }
      return out;
    }, { cells, CELL });

    for (const { file, data } of pngs) {
      const dest = path.join(ROOT, 'public', file.replace(/^\//, ''));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(data, 'base64'));
    }
    console.error(`wrote ${pngs.length} placeholder cells for "${SHIP}" `
      + `(${CELL}×${CELL}) under public/assets/ships/${SHIP}/`);
  }
} finally {
  await browser.close();
  server.kill();
}
