/** Audio-memory probe: what decoded PCM the game holds, now that the hub
 *  song declares real layer variants.
 *
 *  WHAT IS MEASURED: decoded PCM bytes, which is device-independent and
 *  exact — `AudioSystem.decodedBankBytes` (the four SFX cue banks) plus
 *  `AdaptiveMusic.decodedBytes` (the score's stems, one-shots and the
 *  variant LRU).  NOT measured: iOS RSS, which is what actually kills a
 *  tab; this container cannot produce it.  Decoded PCM is the term of RSS
 *  this repo controls.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { writeFileSync } from 'node:fs';

const PORT = 4184;
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 390, height: 844 };
const TAGS = ['station', 'portal', 'deep-space', 'rare-item', 'danger'];
/** Variant changes commit on PHRASE boundaries and then DWELL 2 phrases.
 *  omni is 128 BPM; 8 bars = 15 s, so a forced tag needs ~2 phrases plus
 *  slack before its variant can be resident. */
const SETTLE_MS = 45_000;

const portOpen = (port) => new Promise((resolve) => {
  const s = connect({ host: '127.0.0.1', port });
  const done = (ok) => { s.destroy(); resolve(ok); };
  s.once('connect', () => done(true));
  s.once('error', () => done(false));
  s.setTimeout(1000, () => done(false));
});

async function startServer() {
  if (await portOpen(PORT)) { process.stderr.write(`… reusing preview on ${PORT}\n`); return null; }
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await portOpen(PORT)) return proc;
    await new Promise(r => setTimeout(r, 250));
  }
  proc.kill();
  throw new Error('vite preview did not come up');
}

const server = await startServer();
const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'],
});
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__omniEngine, null, { timeout: 60_000 });

const sample = async (label) => {
  const s = await page.evaluate(() => {
    const e = window.__omniEngine;
    const m = e.audio.music;
    const bank = e.audio.decodedBankBytes || 0;
    const music = m ? m.decodedBytes : 0;
    return {
      bankMB: bank / 1048576,
      musicMB: music / 1048576,
      totalMB: (bank + music) / 1048576,
      budgetMB: m ? m.budgetMB : null,
      song: m ? m.song.title : null,
      variants: m ? m.variantMap : {},
      contexts: m ? m.contexts : [],
      forced: m ? m.forcedContext : null,
      layers: m ? m.activeLayers : [],
      loaded: m ? m.loadedLayers : [],
      audible: e.audio.audible,
      heapMB: (performance.memory?.usedJSHeapSize ?? 0) / 1048576,
      err: m ? m.error : null,
    };
  });
  s.label = label;
  const v = Object.entries(s.variants).map(([k, x]) => `${k}=${x}`).join(' ') || '—';
  process.stderr.write(
    `${label.padEnd(22)} bank ${s.bankMB.toFixed(1).padStart(6)}  music ${s.musicMB.toFixed(1).padStart(6)}`
    + `  TOTAL ${s.totalMB.toFixed(1).padStart(6)} MB  heap ${s.heapMB.toFixed(1).padStart(5)}`
    + `  | ${s.song} | ${v}\n`);
  return s;
};

const out = [];
// What the song DECLARES, read before anything decodes.
// `music` does not exist before the first gesture, so the budget is read
// from the first sample that has one rather than from here.
const declared = await page.evaluate(() => {
  const m = window.__omniEngine.audio.music;
  return {
    budgetMB: m?.budgetMB ?? null,
    songs: (m?.songList ?? []).map(s => ({ id: s.id, title: s.title, variants: s.variants ?? null })),
  };
});
process.stderr.write(`budget (declared, may be null before the first gesture): ${declared.budgetMB} MB\n`);
for (const s of declared.songs) {
  const vs = s.variants ? Object.entries(s.variants).map(([slot, list]) =>
    `${slot}:[${(list ?? []).map(v => v.name ?? v).join(',')}]`).join(' ') : 'none';
  process.stderr.write(`  ${s.id.padEnd(14)} ${vs}\n`);
}
process.stderr.write('\n');

out.push(await sample('title (pre-gesture)'));
// A real click is the user gesture the AudioContext needs.
await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
await page.waitForTimeout(6000);
out.push(await sample('title (unlocked)'));

await page.evaluate(() => window.__omniEngine.startGame());
await page.waitForTimeout(20_000);
out.push(await sample('hub (auto ctx)'));

for (const tag of TAGS) {
  await page.evaluate((t) => window.__omniEngine.audio.music.setForcedContext(t), tag);
  await page.waitForTimeout(SETTLE_MS);
  out.push(await sample(`forced ${tag}`));
}
await page.evaluate(() => window.__omniEngine.audio.music.setForcedContext(null));
await page.waitForTimeout(SETTLE_MS);
out.push(await sample('back to auto'));

const budgetMB = declared.budgetMB ?? out.find(s => s.budgetMB !== null)?.budgetMB ?? null;
const peak = out.reduce((a, b) => (b.totalMB > a.totalMB ? b : a));
const musicPeak = out.reduce((a, b) => (b.musicMB > a.musicMB ? b : a));
process.stderr.write(`\nPEAK TOTAL  ${peak.totalMB.toFixed(1)} MB  at "${peak.label}"\n`);
process.stderr.write(`PEAK MUSIC  ${musicPeak.musicMB.toFixed(1)} MB  at "${musicPeak.label}"`
  + `  (budget ${budgetMB} MB)\n`);
process.stderr.write(`budget respected: ${budgetMB === null ? 'unknown' : (musicPeak.musicMB <= budgetMB ? 'YES' : 'NO')}\n`);
if (errs.length) process.stderr.write(`\npage errors (${errs.length}):\n  ${errs.slice(0, 8).join('\n  ')}\n`);
else process.stderr.write('page errors: none\n');

writeFileSync(process.env.OUT_JSON || '/tmp/audio-mem.json',
  JSON.stringify({ declared, budgetMB, samples: out, errs }, null, 2));

await browser.close();
if (server) server.kill();
