/** Reproduce the 2026-09 audio repairs. Run against a built preview server.
 * Sources: repository-authored registry recipes and existing WAV takes only.
 * No downloads, external samples, voices or third-party source material. */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:4173');
  await page.waitForFunction(() => !!window.__omniEngine?.audio);
  for (const id of ['impact.hull.enemy', 'impact.tile.glass']) {
    for (let variant = 0; variant < 3; variant++) {
      const samples = await page.evaluate(async ({ id, variant }) => {
        const def = window.__omniEngine.audio.defs.get(id);
        const ctx = new OfflineAudioContext(1, 44100, 44100);
        const buf = ctx.createBuffer(1, 88200, 44100);
        let seed = 72491 + variant * 301 + (id.includes('glass') ? 991 : 0);
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        for (let i = 0; i < buf.length; i++) buf.getChannelData(0)[i] = random() * 2 - 1;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.value = id.includes('glass') ? 1600 : 1100; filter.Q.value = 0.65;
        filter.connect(ctx.destination);
        const original = Math.random;
        let duration;
        try {
          Math.random = random;
          duration = def.render({ ctx, dest: filter, t0: 0, pitch: 1 + (variant - 1) * 0.035, param: 0, noise: buf });
        } finally { Math.random = original; }
        const result = await ctx.startRendering();
        return Array.from(result.getChannelData(0).subarray(0, Math.ceil((duration + 0.012) * 44100)));
      }, { id, variant });
      writePcm(`public/assets/sfx/${id.replaceAll('.', '-')}-${'abc'[variant]}.wav`, samples);
    }
  }
  // Idempotent tail repair: preserve the onset and body, fade the last 30ms.
  for (const stem of ['weapon-cannon-fire', 'enemy-shot-boss']) for (const variant of 'abc') {
    const path = `public/assets/sfx/${stem}-${variant}.wav`;
    const bytes = readFileSync(path);
    const samples = await page.evaluate(async bytes => {
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      const buf = await ctx.decodeAudioData(new Uint8Array(bytes).buffer);
      if (buf.duration <= 0.29) return null;
      return Array.from(buf.getChannelData(0).subarray(0, Math.floor(0.28 * 44100)));
    }, Array.from(bytes));
    if (samples) writePcm(path, samples, 0.03);
  }
} finally { await browser.close(); }

function writePcm(path, samples, fade = 0.004) {
  const n = samples.length, endFade = Math.round(44100 * fade);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    samples[i] *= Math.min(1, i / 44, (n - i - 1) / endFade);
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  const out = Buffer.alloc(44 + n * 2);
  out.write('RIFF'); out.writeUInt32LE(36 + n * 2, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(44100, 24); out.writeUInt32LE(88200, 28);
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36);
  out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) out.writeInt16LE(Math.round(samples[i] / peak * 0.501187 * 32767), 44 + i * 2);
  writeFileSync(path, out);
  console.log(path);
}
