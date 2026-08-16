/**
 * Recorded-asset guard: is a wav in public/assets/sfx/ FIT FOR USE?
 *
 * `tone.mjs` protects the synth drafts from the whining that playtest kept
 * finding.  A recorded file walks straight past that guard — it is decoded
 * audio, not a synth function — so this is the equivalent check for assets,
 * and it runs them through the BROWSER's decoder rather than a hand-rolled
 * wav parser, so what it measures is exactly what the game will hear.
 *
 * It validates whatever is present.  No files → nothing to check, exit 0;
 * the drafts cover the game and that is a legitimate state.
 */
import { chromium } from 'playwright';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

const URL = process.env.SMOKE_URL || 'http://127.0.0.1:4173/';
const DIR = resolve('public/assets/sfx');
let pass = 0, fail = 0, warn = 0;
const ok   = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const note = (m)    => { warn++; console.log('  warn ' + m); };

const files = readdirSync(DIR).filter(f => f.toLowerCase().endsWith('.wav'));
if (files.length === 0) {
  console.log('  ..   no wav files present — every id is on its synth draft');
  console.log('\nassets: nothing to check');
  process.exit(0);
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });

for (const name of files) {
  const bytes = Array.from(readFileSync(resolve(DIR, name)));
  const r = await page.evaluate(async ([bytes]) => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let buf;
    try { buf = await ctx.decodeAudioData(new Uint8Array(bytes).buffer); }
    catch (e) { return { error: String(e && e.message || e) }; }
    const d = buf.getChannelData(0);
    let peak = 0, sumSq = 0;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sumSq += d[i] * d[i]; }
    const rms = Math.sqrt(sumSq / d.length);
    const thr = peak * 0.01;
    let lead = 0; while (lead < d.length && Math.abs(d[lead]) <= thr) lead++;
    let tail = d.length - 1; while (tail > 0 && Math.abs(d[tail]) <= thr) tail--;
    // Fraction of the file that is EXACT digital silence — the signature of
    // an export that captured nothing.
    let zero = 0; for (let i = 0; i < d.length; i++) if (d[i] === 0) zero++;
    // Dominant frequency, by the same zero-crossing proxy tone.mjs uses over
    // the sounding region only (trailing silence would drag it to 0).
    let cross = 0;
    for (let i = lead + 1; i <= tail; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) cross++;
    const span = Math.max(1, (tail - lead)) / buf.sampleRate;
    return {
      channels: buf.numberOfChannels, rate: buf.sampleRate, duration: buf.duration,
      peak, rms, zeroFrac: zero / d.length,
      leadMs: lead / buf.sampleRate * 1000,
      contentMs: (tail - lead) / buf.sampleRate * 1000,
      domHz: cross / 2 / span,
    };
  }, [bytes]);

  console.log(`\n  ${name}`);
  if (r.error) { ok(false, `decodes in the browser (${r.error})`); continue; }
  const dbfs = v => (20 * Math.log10(Math.max(v, 1e-9))).toFixed(1);
  console.log(`  ..   ${r.channels}ch ${r.rate}Hz  ${(r.duration * 1000).toFixed(0)}ms  `
            + `peak ${dbfs(r.peak)} dBFS  rms ${dbfs(r.rms)} dBFS  `
            + `silence ${(r.zeroFrac * 100).toFixed(1)}%  content ${r.contentMs.toFixed(1)}ms  ~${r.domHz.toFixed(0)}Hz`);

  ok(true, 'decodes in the browser');
  // LEVEL.  The engine applies its own mix gain (0.34 for shard contact) and
  // then distance attenuation on top, so a quiet file is inaudible in play,
  // not merely quiet.
  ok(r.peak > 0.1, `has usable level (peak ${dbfs(r.peak)} dBFS; want louder than -20)`);
  // AN EXPORT THAT CAPTURED NOTHING.  A real recording is not 98% exact zeros.
  ok(r.zeroFrac < 0.9, `contains actual audio (${(r.zeroFrac * 100).toFixed(1)}% of it is digital silence)`);
  ok(r.contentMs > 15, `has more than a click of content (${r.contentMs.toFixed(1)}ms)`);
  ok(r.channels === 1, `is mono (${r.channels}ch) — the engine pans positionally`);
  // THE WHINE RULE (CLAUDE.md §8).  Bulk-fired material sounds live under
  // ~2kHz; this is the check a recorded file otherwise escapes entirely.
  ok(r.domHz < 2000, `sits below the fatiguing band (~${r.domHz.toFixed(0)}Hz)`);

  if (r.leadMs > 15) note(`${r.leadMs.toFixed(1)}ms of leading silence — reads as input latency on an impact sound`);
  if (r.duration * 1000 > 250) note(`${(r.duration * 1000).toFixed(0)}ms long — poly is 3, so long takes overlap into a smear`);
}

await browser.close();
console.log(`\nassets: ${pass} passed, ${fail} failed, ${warn} warnings`);
process.exit(fail ? 1 : 0);
