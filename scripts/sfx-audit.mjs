/**
 * Audit `public/assets/sfx/` after a batch of takes is dropped in.
 *
 * Answers the three questions a drop raises, in descending order of how
 * certain the answer is:
 *
 *   1. WHAT DID GIT DO — modified (a real replacement) vs added (a new
 *      variant) vs deleted, against a base ref.  This is fact, not
 *      inference: the folder is additive, so only an identical filename
 *      replaces a take and git is what knows which names matched.
 *   2. WHERE DOES EACH FILE LAND — the id it resolves to under the same
 *      longest-prefix rule `AudioSystem.discoverSamples` uses, plus the
 *      files that match no id (silent) or a loop id (refused).
 *   3. WHAT LOOKS LIKE A DUPLICATE — byte-identical files (certain), and
 *      near-identical audio among an id's takes (a flag to check, not a
 *      verdict: two deliberate takes of the same source can score high).
 *
 * Pure Node, no dependencies, no audio application — same constraint
 * `prep-sfx.mjs` works under.
 *
 *   node scripts/sfx-audit.mjs                 # vs the merge-base with main
 *   node scripts/sfx-audit.mjs --base HEAD~1   # vs any ref
 *   node scripts/sfx-audit.mjs --no-git        # id mapping + dupes only
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT    = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SFX_DIR = resolve(ROOT, 'public/assets/sfx');
const REL     = 'public/assets/sfx';

const args    = process.argv.slice(2);
const NO_GIT  = args.includes('--no-git');
const BASE    = (() => {
  const i = args.indexOf('--base');
  if (i >= 0 && args[i + 1]) return args[i + 1];
  for (const ref of ['origin/claude/plan-completion', 'claude/plan-completion', 'origin/main', 'main']) {
    try { execSync(`git rev-parse --verify --quiet ${ref}`, { cwd: ROOT, stdio: 'pipe' }); return ref; }
    catch { /* try the next */ }
  }
  return null;
})();

// ── The id table, read from the registry source ────────────────────────────
// Every registration passes its id as a dotted string literal in first
// position, whatever helper wraps it (`register`, `registerLoop`, `chip`,
// …), so one pattern covers them all.  Loop ids are collected separately
// because a file naming one is REFUSED at load rather than accepted.
function readIds() {
  const src = readFileSync(resolve(ROOT, 'engine/systems/SfxRegistry.ts'), 'utf8');
  const call = /\b[A-Za-z_$][\w$]*\(\s*'([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)'/g;
  const loop = /\bregisterLoop\(\s*'([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)'/g;
  const all = new Set(), loops = new Set();
  for (const m of src.matchAll(call)) all.add(m[1]);
  for (const m of src.matchAll(loop)) loops.add(m[1]);
  return { all: [...all], loops };
}

// The engine's rule, verbatim: longest id first, so a prefix id cannot claim
// a longer id's files; a file matches on the exact dashed id or that id
// followed by a dash.
function makeResolver(ids) {
  const dashed = [...ids].sort((a, b) => b.length - a.length)
                         .map(id => [id, id.replace(/\./g, '-')]);
  return file => {
    const stem = file.replace(/\.wav$/i, '').toLowerCase();
    const hit = dashed.find(([, d]) => stem === d || stem.startsWith(d + '-'));
    return hit ? hit[0] : null;
  };
}

// ── Minimal PCM WAV decode to mono float, for the similarity pass ──────────
function decode(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not RIFF');
  let i = 12, fmt = null, data = null;
  while (i + 8 <= buf.length) {
    const id = buf.toString('ascii', i, i + 4), sz = buf.readUInt32LE(i + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(i + 8), channels: buf.readUInt16LE(i + 10),
                               rate: buf.readUInt32LE(i + 12), bits: buf.readUInt16LE(i + 22) };
    else if (id === 'data') data = buf.subarray(i + 8, i + 8 + sz);
    i += 8 + sz + (sz & 1);
  }
  if (!fmt || !data) throw new Error('missing fmt or data chunk');
  if (fmt.format !== 1) throw new Error(`not PCM (format ${fmt.format})`);
  const { channels: ch, bits } = fmt, out = [];
  const step = ch * (bits / 8);
  for (let n = 0; n + step <= data.length; n += step) {
    let acc = 0;
    for (let c = 0; c < ch; c++) {
      const o = n + c * (bits / 8);
      if (bits === 8) acc += (data[o] - 128) / 128;
      else if (bits === 16) acc += data.readInt16LE(o) / 32768;
      else if (bits === 24) { let v = data[o] | (data[o+1] << 8) | (data[o+2] << 16);
                              if (v & 0x800000) v -= 0x1000000; acc += v / 8388608; }
      else if (bits === 32) acc += data.readFloatLE(o);
      else throw new Error(`unsupported bit depth ${bits}`);
    }
    out.push(acc / ch);
  }
  return { frames: out, rate: fmt.rate, channels: ch, bits };
}

// A fixed-length energy-envelope fingerprint, peak-normalised.  Comparing
// envelopes rather than raw samples is what makes this survive the level and
// trim changes `prep-sfx.mjs` applies — two exports of one take differ in
// gain and head silence, and should still read as the same recording.
const FP_BINS = 64;
function fingerprint(frames) {
  let s = 0, e = frames.length - 1;
  const thresh = 0.005;
  while (s < frames.length && Math.abs(frames[s]) < thresh) s++;
  while (e > s && Math.abs(frames[e]) < thresh) e--;
  const n = Math.max(1, e - s + 1);
  const fp = new Float64Array(FP_BINS);
  for (let b = 0; b < FP_BINS; b++) {
    const a = s + Math.floor(b * n / FP_BINS), z = s + Math.floor((b + 1) * n / FP_BINS);
    let acc = 0, c = 0;
    for (let k = a; k < Math.max(a + 1, z) && k <= e; k++) { acc += frames[k] * frames[k]; c++; }
    fp[b] = c ? Math.sqrt(acc / c) : 0;
  }
  const max = Math.max(...fp) || 1;
  for (let b = 0; b < FP_BINS; b++) fp[b] /= max;
  return fp;
}
const cosine = (a, b) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

// ── Run ────────────────────────────────────────────────────────────────────
if (!existsSync(SFX_DIR)) { console.error(`no such folder: ${SFX_DIR}`); process.exit(1); }
const files = readdirSync(SFX_DIR).filter(f => /\.wav$/i.test(f)).sort();
const { all: ids, loops } = readIds();
const resolveId = makeResolver(ids);

console.log(`\n${files.length} wav files · ${ids.length} registered ids (${loops.size} of them loops)\n`);

// 1 ── what git did
let changed = null;
if (!NO_GIT && BASE) {
  try {
    const out = execSync(`git diff --name-status ${BASE}...HEAD -- ${REL}`, { cwd: ROOT, encoding: 'utf8' });
    changed = out.trim().split('\n').filter(Boolean).map(l => {
      const [st, ...p] = l.split('\t');
      return { status: st[0], file: p[p.length - 1].split('/').pop() };
    }).filter(c => /\.wav$/i.test(c.file));
  } catch { /* not a git checkout, or the ref is gone */ }
}
console.log('── 1. What the commit did ' + '─'.repeat(45));
if (!changed) console.log('   (skipped — no base ref)\n');
else if (!changed.length) console.log(`   No wav changes against ${BASE}.\n`);
else {
  const label = { M: 'REPLACED take (same filename)', A: 'ADDED — a new variant', D: 'DELETED', R: 'RENAMED' };
  for (const st of ['M', 'A', 'D', 'R']) {
    const rows = changed.filter(c => c.status === st);
    if (!rows.length) continue;
    console.log(`   ${label[st] || st}  (${rows.length})`);
    for (const r of rows) console.log(`      ${r.file}   -> ${resolveId(r.file) ?? 'NO MATCHING ID'}`);
  }
  console.log(`   base: ${BASE}\n`);
}

// 2 ── where each file lands
const byId = new Map(), unmatched = [], loopFiles = [];
for (const f of files) {
  const id = resolveId(f);
  if (!id) { unmatched.push(f); continue; }
  if (loops.has(id)) { loopFiles.push([f, id]); continue; }
  byId.set(id, [...(byId.get(id) ?? []), f]);
}
console.log('── 2. Where each file lands ' + '─'.repeat(43));
console.log(`   ${byId.size} ids covered, ${[...byId.values()].reduce((n, v) => n + v.length, 0)} takes\n`);
for (const [id, fs] of [...byId].sort()) console.log(`   ${id.padEnd(26)} ${fs.length}  ${fs.join(', ')}`);
if (unmatched.length) {
  console.log(`\n   ⚠  ${unmatched.length} file(s) match NO id — these are silent, never played:`);
  for (const f of unmatched) console.log(`      ${f}`);
}
if (loopFiles.length) {
  console.log(`\n   ⚠  ${loopFiles.length} file(s) name a LOOP id — refused at load, the synth keeps playing:`);
  for (const [f, id] of loopFiles) console.log(`      ${f}   (${id})`);
}
console.log();

// 3 ── duplicates
console.log('── 3. Duplicates ' + '─'.repeat(54));
const meta = new Map();
for (const f of files) {
  const buf = readFileSync(resolve(SFX_DIR, f));
  const rec = { sha: createHash('sha256').update(buf).digest('hex') };
  try {
    const { frames, rate, channels, bits } = decode(buf);
    Object.assign(rec, { fp: fingerprint(frames), ms: frames.length / rate * 1000, rate, channels, bits,
                         peak: frames.reduce((m, v) => Math.max(m, Math.abs(v)), 0) });
  } catch (e) { rec.error = e.message; }
  meta.set(f, rec);
}
const bad = files.filter(f => meta.get(f).error);
if (bad.length) {
  console.log(`   ⚠  ${bad.length} file(s) would not decode here:`);
  for (const f of bad) console.log(`      ${f}   ${meta.get(f).error}`);
  console.log();
}
const bySha = new Map();
for (const f of files) bySha.set(meta.get(f).sha, [...(bySha.get(meta.get(f).sha) ?? []), f]);
const exact = [...bySha.values()].filter(v => v.length > 1);
if (exact.length) {
  console.log('   BYTE-IDENTICAL — certainly the same file under two names:');
  for (const g of exact) console.log(`      ${g.join('  ==  ')}`);
} else console.log('   No byte-identical files.');

const SIM = 0.97;
const near = [];
for (const [id, fs] of byId) {
  for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
    const a = meta.get(fs[i]), b = meta.get(fs[j]);
    if (a.error || b.error || a.sha === b.sha) continue;
    const s = cosine(a.fp, b.fp);
    if (s >= SIM) near.push({ id, a: fs[i], b: fs[j], s, da: a.ms, db: b.ms });
  }
}
if (near.length) {
  console.log(`\n   NEAR-IDENTICAL envelopes within one id (>= ${SIM}) — check these:`);
  for (const n of near.sort((x, y) => y.s - x.s))
    console.log(`      ${n.id}   ${n.a} ~ ${n.b}   ${n.s.toFixed(3)}   ${n.da.toFixed(0)}ms / ${n.db.toFixed(0)}ms`);
  console.log('      (a flag, not a verdict — two deliberate takes of one source score high too)');
} else console.log(`\n   No near-identical pairs within an id (threshold ${SIM}).`);
console.log();
