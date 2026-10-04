#!/usr/bin/env node
/**
 * npm run music:import -- "<path to a song kit folder>" [--check]
 *
 * Turns a song exported from GarageBand (or any DAW) into a game-ready song
 * for the adaptive score.  The kit folder holds `song.json` and an `Exports`
 * folder with one audio file per layer, each rendered from bar 1 to two bars
 * past the end (those extra bars carry the echoes and reverb tail).
 * See docs/MUSIC_PIPELINE.md.
 *
 *   1. finds atmos / pulse / groove / heavy / apex / boss (required) and
 *      riser / victory (optional) by file name — any of wav, aif, aiff, m4a,
 *      mp3, caf;
 *   2. checks every layer is at least one loop long at song.json's tempo;
 *   3. FOLDS each layer's tail (everything past the loop) back onto its start
 *      — what the loop really sounds like on its second pass — and writes
 *      the exactly-periodic file the engine needs (0.5 s lead-in + loop +
 *      1.5 s run-out), so it loops without a seam;
 *   4. sets loudness with ONE gain for every layer (the full stack lands at
 *      -13 LUFS, never above a 0.97 peak), so your mix balance is kept;
 *   5. encodes 32 kHz MP3 (mono when a layer is mono) into
 *      public/assets/audio/score/<id>/ and adds or updates the song — and any
 *      plan roles song.json asks for — in public/assets/audio/score/index.json.
 *
 * --check runs 1-4 and reports without writing anything.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCORE_DIR = join(ROOT, 'public', 'assets', 'audio', 'score');
const INDEX = join(SCORE_DIR, 'index.json');
const SR = 44100;
const LEAD_IN = 0.5, RUN_OUT = 1.5;
const STACK_LUFS = -13, PEAK_CEIL = 0.97;
const LAYERS = ['atmos', 'pulse', 'groove', 'heavy', 'apex', 'boss'];
const ONE_SHOTS = ['riser', 'victory'];
const EXT = /\.(wav|aif|aiff|m4a|mp3|caf)$/i;
const ROLES = ['hub', 'field', 'arena', 'boss'];

const args = process.argv.slice(2);
const check = args.includes('--check');
const kit = args.find(a => !a.startsWith('--'));
const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };
if (!kit) die('usage: npm run music:import -- "<song kit folder>" [--check]');
if (!existsSync(kit)) die(`no such folder: ${kit}`);

// ── song.json ────────────────────────────────────────────────────────────────
const metaPath = join(kit, 'song.json');
if (!existsSync(metaPath)) die(`${metaPath} is missing (it comes with every kit)`);
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
for (const k of ['id', 'title', 'bpm', 'bars']) if (meta[k] === undefined) die(`song.json needs "${k}"`);
if (!/^[a-z0-9][a-z0-9-]*$/.test(meta.id)) die(`song.json "id" must be lowercase letters, digits and dashes: ${meta.id}`);
const use = (meta.use ?? []).filter(r => ROLES.includes(r));
const loopSec = meta.bars * 4 * 60 / meta.bpm;
const L = Math.round(loopSec * SR);

// ── find the exports ─────────────────────────────────────────────────────────
// The kit's "2 - Exports" folder (any sub-folder whose name ends in "Exports"),
// else the kit folder itself.
const exportSub = readdirSync(kit, { withFileTypes: true }).find(d => d.isDirectory() && /exports$/i.test(d.name));
const exportDir = exportSub ? join(kit, exportSub.name) : kit;
const files = readdirSync(exportDir).filter(f => EXT.test(f) && !f.startsWith('.'));
const pick = (name) => {
  const hits = files.filter(f => new RegExp(`(^|[^a-z])${name}([^a-z]|$)`, 'i').test(f.replace(EXT, '')));
  if (hits.length > 1) die(`more than one file looks like "${name}" in ${exportDir}: ${hits.join(', ')}`);
  return hits[0] ? join(exportDir, hits[0]) : null;
};
const found = {};
for (const n of [...LAYERS, ...ONE_SHOTS]) found[n] = pick(n);
const missing = LAYERS.filter(n => !found[n]);
if (missing.length) die(`missing layer export(s) in ${exportDir}: ${missing.join(', ')}\n  (name each file after its layer, e.g. "groove.wav")`);

// ── decode ───────────────────────────────────────────────────────────────────
const decode = (file) => {
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'],
    { maxBuffer: 1 << 30 });
  const f = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const n = f.length / 2, l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) { l[i] = f[2 * i]; r[i] = f[2 * i + 1]; }
  return [l, r];
};
console.log(`\n${meta.title} (${meta.id}) — ${meta.bpm} BPM, ${meta.bars} bars = ${loopSec.toFixed(3)} s loop`);
const audio = {};
for (const n of [...LAYERS, ...ONE_SHOTS]) if (found[n]) audio[n] = decode(found[n]);

// ── length check + fold the tail into the loop ───────────────────────────────
const report = [];
const loops = {};
for (const n of LAYERS) {
  const [l, r] = audio[n];
  const len = l.length;
  if (len < L * 0.995) {
    die(`${basename(found[n])} is ${(len / SR).toFixed(2)} s — shorter than one loop (${loopSec.toFixed(2)} s).\n`
      + `  Check the project tempo is ${meta.bpm} and the export range runs from bar 1 to bar ${meta.bars + 3}.`);
  }
  const out = [new Float32Array(L), new Float32Array(L)];
  [l, r].forEach((ch, c) => {
    for (let i = 0; i < len; i++) out[c][i % L] += ch[i];      // wrap the tail around, as many times as it is long
  });
  loops[n] = out;
  const tail = Math.max(0, len - L) / SR;
  report.push(`  ${n.padEnd(7)} ${(len / SR).toFixed(2)} s  (tail folded in: ${tail.toFixed(2)} s)`
    + (tail < 0.25 ? `   ⚠ little or no tail — export from bar 1 to bar ${meta.bars + 3} so echoes can ring out` : ''));
}
console.log(report.join('\n'));

// ── one loudness gain for every layer ────────────────────────────────────────
const tmp = join(tmpdir(), `music-import-${process.pid}`);
mkdirSync(tmp, { recursive: true });
const writeF32 = (path, [l, r]) => {
  const buf = new Float32Array(l.length * 2);
  for (let i = 0; i < l.length; i++) { buf[2 * i] = l[i]; buf[2 * i + 1] = r[i]; }
  writeFileSync(path, Buffer.from(buf.buffer));
};
/** Integrated loudness (EBU R128, LUFS) via ffmpeg's ebur128 filter. */
const integrated = (st) => {
  const p = join(tmp, 'm.f32');
  writeF32(p, st);
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', p,
    '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const m = /I:\s+(-?[\d.]+) LUFS/.exec((r.stderr ?? '') + (r.stdout ?? ''));
  return m ? parseFloat(m[1]) : NaN;
};
const stack = [new Float32Array(L), new Float32Array(L)];
for (const n of LAYERS) for (let c = 0; c < 2; c++) for (let i = 0; i < L; i++) stack[c][i] += loops[n][c][i];
const stackLufs = integrated(stack);
if (!Number.isFinite(stackLufs)) die('could not measure loudness (is the export silent?)');
let gain = Math.pow(10, (STACK_LUFS - stackLufs) / 20);
let peak = 0;
for (let c = 0; c < 2; c++) for (let i = 0; i < L; i++) peak = Math.max(peak, Math.abs(stack[c][i]));
for (const n of [...LAYERS, ...ONE_SHOTS]) if (audio[n]) for (const ch of (loops[n] ?? audio[n])) for (const v of ch) peak = Math.max(peak, Math.abs(v));
if (peak * gain > PEAK_CEIL) gain = PEAK_CEIL / peak;
const atmosLufs = integrated(loops.atmos) + 20 * Math.log10(gain);
console.log(`  full stack ${stackLufs.toFixed(1)} LUFS → gain ${(20 * Math.log10(gain)).toFixed(1)} dB `
  + `(stack ${(stackLufs + 20 * Math.log10(gain)).toFixed(1)} LUFS, atmos alone ${atmosLufs.toFixed(1)} LUFS)`);
if (atmosLufs > -14) console.log('  ⚠ the exploration bed (atmos) is nearly as loud as the full fight — the layers will not build much');

// ── build the periodic files ─────────────────────────────────────────────────
const lead = Math.round(LEAD_IN * SR), run = Math.round(RUN_OUT * SR);
const periodic = ([l, r]) => [l, r].map(ch => {
  const out = new Float32Array(lead + L + run);
  for (let i = 0; i < out.length; i++) out[i] = ch[((i - lead) % L + L) % L] * gain;
  return out;
});
const trimOneShot = ([l, r]) => {
  let end = l.length;
  while (end > 1 && Math.abs(l[end - 1]) < 1e-5 && Math.abs(r[end - 1]) < 1e-5) end--;
  return [l.slice(0, end).map(v => v * gain), r.slice(0, end).map(v => v * gain)];
};
const isMono = ([l, r]) => { for (let i = 0; i < l.length; i += 7) if (Math.abs(l[i] - r[i]) > 1e-4) return false; return true; };

if (check) {
  console.log(`\n✓ check passed — nothing written.  Run again without --check to import.\n`);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
}

const folderRel = `score/${meta.id}/`;
const outDir = join(SCORE_DIR, meta.id);
mkdirSync(outDir, { recursive: true });
const encode = (name, st) => {
  const mono = isMono(st);
  const p = join(tmp, `${name}.f32`);
  writeF32(p, st);
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', p,
    '-ac', mono ? '1' : '2', '-ar', '32000', '-c:a', 'libmp3lame', '-b:a', mono ? '80k' : '128k', join(outDir, `${name}.mp3`)]);
  return mono;
};
const written = [];
for (const n of LAYERS) written.push(`${n}${encode(n, periodic(loops[n])) ? ' (mono)' : ''}`);
for (const n of ONE_SHOTS) if (audio[n]) written.push(`${n}${encode(n, trimOneShot(audio[n])) ? ' (mono)' : ''}`);
// A riser / victory not in this export keeps the song's existing one (if any).
writeFileSync(join(outDir, 'song.json'), JSON.stringify(meta, null, 2) + '\n');

// ── index ────────────────────────────────────────────────────────────────────
const index = JSON.parse(readFileSync(INDEX, 'utf8'));
const entry = { id: meta.id, title: meta.title, bpm: meta.bpm, bars: meta.bars, folder: folderRel };
const at = index.songs.findIndex(s => s.id === meta.id);
if (at >= 0) index.songs[at] = entry; else index.songs.push(entry);
for (const role of use) index.plan[role] = meta.id;
writeFileSync(INDEX, JSON.stringify(index, null, 2) + '\n');
rmSync(tmp, { recursive: true, force: true });

console.log(`\n✓ ${at >= 0 ? 'replaced' : 'added'} "${meta.title}" → public/assets/audio/${folderRel}`);
console.log(`  wrote: ${written.join(', ')}`);
console.log(`  plays: ${use.length ? use.join(', ') : 'nowhere yet — pin it with Debug ▸ Adaptive Music ▸ Music song, or add "use" to song.json'}`);
console.log(`  plan:  ${ROLES.map(r => `${r} → ${index.plan[r]}`).join(' · ')}\n`);
