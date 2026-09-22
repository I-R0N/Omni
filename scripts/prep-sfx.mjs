/**
 * prep-sfx — put a recorded wav into the shape the engine wants.
 *
 * Pure Node, no dependencies and no audio application: read a PCM wav,
 * trim, normalise, downmix, and write it back as 16-bit mono PCM.  The
 * point is that a take can go from an exporter straight into
 * public/assets/sfx/ without a second tool in the loop.
 *
 * It exists because of ONE property of this engine in particular.  A voice
 * holds its polyphony slot for the whole length of its buffer, and a
 * contact sound is capped at `poly: 3`.  A two-second take therefore does
 * not merely smear — after three hits the id is saturated for two seconds
 * and every further hit is DROPPED, so a dense rubble field gets quieter
 * the busier it becomes.  Trimming the inaudible tail is what prevents
 * that, and it is not a cosmetic edit.
 *
 *   node scripts/prep-sfx.mjs <file.wav> [...]        # in place
 *   node scripts/prep-sfx.mjs --max-ms 250 --peak -6 --tail -34 <file.wav>
 *   node scripts/prep-sfx.mjs --dry-run <file.wav>    # report, write nothing
 *
 * Defaults suit a material contact tick.  Originals are recoverable from
 * git; this writes in place deliberately, so the committed asset is the
 * one the game loads.
 */
import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const v = Number(args[i + 1]);
  args.splice(i, 2);
  return Number.isFinite(v) ? v : dflt;
};
const flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };

const DRY      = flag('--dry-run');
const MAX_MS   = opt('--max-ms', 250);   // hard ceiling on length
const PEAK_DB  = opt('--peak', -6);      // normalise target
const TAIL_DB  = opt('--tail', -34);     // trim once the envelope stays below this
const files    = args.filter(a => !a.startsWith('--'));

if (files.length === 0) {
  console.error('usage: node scripts/prep-sfx.mjs [--max-ms N] [--peak DB] [--tail DB] [--dry-run] <file.wav>...');
  process.exit(2);
}

/** Parse a PCM wav into float samples, walking chunks properly — a wav is
 *  not a 44-byte header plus data, and assuming it is silently misreads any
 *  file an exporter decorated with LIST/fact chunks. */
function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let i = 12, fmt = null, data = null;
  while (i + 8 <= buf.length) {
    const id = buf.toString('ascii', i, i + 4);
    const sz = buf.readUInt32LE(i + 4);
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(i + 8), channels: buf.readUInt16LE(i + 10),
              rate: buf.readUInt32LE(i + 12), bits: buf.readUInt16LE(i + 22) };
    } else if (id === 'data') {
      data = buf.subarray(i + 8, Math.min(i + 8 + sz, buf.length));
    }
    if (sz <= 0 || i + 8 + sz > buf.length) break;
    i += 8 + sz + (sz & 1);
  }
  if (!fmt || !data) throw new Error('missing fmt or data chunk');
  if (fmt.format !== 1) throw new Error(`not PCM (format ${fmt.format}) — re-export as PCM`);

  const { channels: ch, bits } = fmt;
  const frames = [];
  if (bits === 8) {
    for (let n = 0; n + ch <= data.length; n += ch) {
      let acc = 0; for (let c = 0; c < ch; c++) acc += (data[n + c] - 128) / 128;
      frames.push(acc / ch);                                   // 8-bit wav is UNSIGNED
    }
  } else if (bits === 16) {
    for (let n = 0; n + ch * 2 <= data.length; n += ch * 2) {
      let acc = 0; for (let c = 0; c < ch; c++) acc += data.readInt16LE(n + c * 2) / 32768;
      frames.push(acc / ch);
    }
  } else if (bits === 24) {
    for (let n = 0; n + ch * 3 <= data.length; n += ch * 3) {
      let acc = 0;
      for (let c = 0; c < ch; c++) {
        const o = n + c * 3;
        let v = data[o] | (data[o + 1] << 8) | (data[o + 2] << 16);
        if (v & 0x800000) v -= 0x1000000;
        acc += v / 8388608;
      }
      frames.push(acc / ch);
    }
  } else if (bits === 32) {
    for (let n = 0; n + ch * 4 <= data.length; n += ch * 4) {
      let acc = 0; for (let c = 0; c < ch; c++) acc += data.readFloatLE(n + c * 4);
      frames.push(acc / ch);
    }
  } else throw new Error(`unsupported bit depth ${bits}`);
  return { frames, rate: fmt.rate, channels: ch, bits };
}

function writeWav(frames, rate) {
  const out = Buffer.alloc(44 + frames.length * 2);
  out.write('RIFF', 0); out.writeUInt32LE(36 + frames.length * 2, 4); out.write('WAVE', 8);
  out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22); out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(frames.length * 2, 40);
  for (let i = 0; i < frames.length; i++) {
    const v = Math.max(-1, Math.min(1, frames[i]));
    out.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return out;
}

const db = v => (20 * Math.log10(Math.max(v, 1e-9)));

for (const path of files) {
  let w;
  try { w = parseWav(readFileSync(path)); }
  catch (e) { console.error(`${path}: ${e.message}`); process.exitCode = 1; continue; }

  const { frames, rate } = w;
  const before = { ms: frames.length / rate * 1000, peak: Math.max(...frames.map(Math.abs)) };

  // 1. Trim the head to the first audible sample — leading silence reads as
  //    input latency on an impact sound.
  const headThr = before.peak * 0.02;
  let head = 0; while (head < frames.length && Math.abs(frames[head]) < headThr) head++;
  head = Math.max(0, head - Math.floor(rate * 0.001));       // keep 1ms of run-up

  // 2. Trim the tail where the ENVELOPE (not a single sample) has stayed
  //    below the threshold — a noise floor never reaches zero, so a
  //    sample-wise test would keep the entire file.
  const win = Math.max(1, Math.floor(rate * 0.005));
  const tailThr = before.peak * Math.pow(10, TAIL_DB / 20);
  let tail = frames.length;
  for (let i = frames.length - win; i > head; i -= win) {
    let m = 0; for (let k = i; k < i + win && k < frames.length; k++) m = Math.max(m, Math.abs(frames[k]));
    if (m > tailThr) { tail = Math.min(frames.length, i + win); break; }
  }

  let cut = frames.slice(head, tail);

  // 3. Hard ceiling, with a short fade so the truncation is not a click.
  const maxN = Math.floor(rate * MAX_MS / 1000);
  if (cut.length > maxN) {
    cut = cut.slice(0, maxN);
    const fade = Math.min(Math.floor(rate * 0.008), cut.length);
    for (let i = 0; i < fade; i++) cut[cut.length - fade + i] *= 1 - i / fade;
  }

  // 4. Normalise to the target peak.
  const p = Math.max(...cut.map(Math.abs), 1e-9);
  const gain = Math.pow(10, PEAK_DB / 20) / p;
  cut = cut.map(v => v * gain);

  const after = { ms: cut.length / rate * 1000, peak: Math.max(...cut.map(Math.abs)) };
  console.log(`${path}`);
  console.log(`  ${w.bits}bit ${w.channels}ch ${rate}Hz`);
  console.log(`  length ${before.ms.toFixed(0)}ms -> ${after.ms.toFixed(0)}ms   `
            + `peak ${db(before.peak).toFixed(1)} -> ${db(after.peak).toFixed(1)} dBFS`
            + (DRY ? '   (dry run, nothing written)' : ''));
  if (!DRY) writeFileSync(path, writeWav(cut, rate));
}
