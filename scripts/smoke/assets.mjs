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
    // Dominant frequency, by the zero-crossing proxy tone.mjs uses — but
    // measured over the region that HOLDS THE ENERGY, not the whole file.
    // This guard's first cut counted crossings across everything after the
    // onset, and a bright 10ms transient followed by a 2s low-level tail
    // then read as ~30Hz: a false PASS on exactly the check the rule exists
    // for.  Take the window containing 90% of the energy instead.
    let total = 0; for (let i = 0; i < d.length; i++) total += d[i] * d[i];
    let acc = 0, energyEnd = lead;
    for (let i = lead; i <= tail; i++) { acc += d[i] * d[i]; if (acc >= total * 0.9) { energyEnd = i; break; } }
    energyEnd = Math.max(energyEnd, lead + Math.floor(buf.sampleRate * 0.005));  // at least 5ms
    const brightness = (from, to) => {
      let c = 0;
      for (let i = Math.max(1, from) + 1; i <= to && i < d.length; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) c++;
      return c / 2 / Math.max(1 / buf.sampleRate, (to - from) / buf.sampleRate);
    };
    const energyMs = (energyEnd - lead) / buf.sampleRate * 1000;
    // TWO brightness figures, because the rule they serve is about RINGING.
    // An impact legitimately has a bright transient — that is what makes it
    // read as hard rather than soft — and CLAUDE.md §8 is explicit that Q
    // matters as much as pitch: a high-Q filter RINGS and ringing is what
    // fatigues.  So the transient is reported and the SUSTAIN is judged.
    const transientEnd = lead + Math.floor(buf.sampleRate * 0.020);
    const attackHz  = brightness(lead, transientEnd);
    const sustainHz = tail > transientEnd ? brightness(transientEnd, tail) : 0;
    const cross = 0, span = 1;
    return {
      channels: buf.numberOfChannels, rate: buf.sampleRate, duration: buf.duration,
      peak, rms, zeroFrac: zero / d.length,
      leadMs: lead / buf.sampleRate * 1000,
      contentMs: (tail - lead) / buf.sampleRate * 1000,
      attackHz, sustainHz, energyMs,
    };
  }, [bytes]);

  console.log(`\n  ${name}`);
  if (r.error) { ok(false, `decodes in the browser (${r.error})`); continue; }
  const dbfs = v => (20 * Math.log10(Math.max(v, 1e-9))).toFixed(1);
  console.log(`  ..   ${r.channels}ch ${r.rate}Hz  ${(r.duration * 1000).toFixed(0)}ms  `
            + `peak ${dbfs(r.peak)} dBFS  rms ${dbfs(r.rms)} dBFS  `
            + `silence ${(r.zeroFrac * 100).toFixed(1)}%  content ${r.contentMs.toFixed(1)}ms  `
            + `90%-energy in ${r.energyMs.toFixed(0)}ms  `
            + `attack ~${r.attackHz.toFixed(0)}Hz  sustain ~${r.sustainHz.toFixed(0)}Hz`);

  ok(true, 'decodes in the browser');
  // LEVEL.  The engine applies its own mix gain (0.34 for shard contact) and
  // then distance attenuation on top, so a quiet file is inaudible in play,
  // not merely quiet.
  ok(r.peak > 0.1, `has usable level (peak ${dbfs(r.peak)} dBFS; want louder than -20)`);
  // AN EXPORT THAT CAPTURED NOTHING.  A real recording is not 98% exact zeros.
  ok(r.zeroFrac < 0.9, `contains actual audio (${(r.zeroFrac * 100).toFixed(1)}% of it is digital silence)`);
  ok(r.contentMs > 15, `has more than a click of content (${r.contentMs.toFixed(1)}ms)`);
  ok(r.channels === 1, `is mono (${r.channels}ch) — the engine pans positionally`);
  // THE WHINE RULE (CLAUDE.md §8), applied to what the rule is actually
  // about.  A bright ATTACK is what makes an impact read as hard; a bright
  // SUSTAIN is the ringing that a hundred repeats turn into a whine.
  ok(r.sustainHz < 2000,
     `does not RING in the fatiguing band (sustain ~${r.sustainHz.toFixed(0)}Hz)`);
  if (r.attackHz > 2500) {
    note(`bright attack (~${r.attackHz.toFixed(0)}Hz) — fine for a hard impact, but this is the `
       + `one property headless cannot judge: listen to it in a dense rubble field`);
  }

  if (r.leadMs > 15) note(`${r.leadMs.toFixed(1)}ms of leading silence — reads as input latency on an impact sound`);
  // A voice holds its polyphony slot for its whole buffer, and contact ids
  // cap at poly 3 — so an over-long take does not just smear, it SATURATES
  // the id and later hits are dropped.  That makes length a failure, not a
  // note.  scripts/prep-sfx.mjs trims to this.
  ok(r.duration * 1000 <= 300,
     `is short enough not to starve its own polyphony (${(r.duration * 1000).toFixed(0)}ms; want <=300)`);
  if (r.energyMs > 0 && r.duration * 1000 > r.energyMs * 4) {
    note(`${(r.duration * 1000).toFixed(0)}ms long but 90% of the energy is in the first `
       + `${r.energyMs.toFixed(0)}ms — the rest is an inaudible tail holding a voice slot`);
  }
}

await browser.close();
console.log(`\nassets: ${pass} passed, ${fail} failed, ${warn} warnings`);
process.exit(fail ? 1 : 0);
