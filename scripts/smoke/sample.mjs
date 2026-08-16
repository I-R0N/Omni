/**
 * Recorded-sample path: correctness and COST.
 *
 * The question this suite exists to answer is "does adding wav files drop
 * frames?".  It answers it by generating three real wavs at runtime, serving
 * them from the same URL the game fetches, and then comparing frame time and
 * per-voice cost against the identical scene running on the synth drafts.
 *
 * The wavs are generated rather than committed so the suite runs on a clean
 * clone with no assets present — and so it also proves the FALLBACK, which
 * is the state the repo (and the standalone build) is in today.
 */
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } };

/** Minimal mono 16-bit PCM wav.  A short noise burst through a one-pole
 *  lowpass — deliberately in the same family as the shard-contact draft so
 *  the cost comparison is like-for-like. */
function makeWav(seconds, rate, seed, amp = 0.8) {
  const n = Math.floor(seconds * rate);
  const bytes = Buffer.alloc(44 + n * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + n * 2, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(n * 2, 40);
  let s = seed, lp = 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const white = (s / 0xffffffff) * 2 - 1;
    lp += (white - lp) * 0.18;                     // dull it, per the <2kHz rule
    const env = Math.exp(-i / (rate * 0.02));      // ~20ms decay
    bytes.writeInt16LE(Math.max(-32767, Math.min(32767, lp * env * 32767 * amp)), 44 + i * 2);
  }
  return bytes;
}

const run = async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  // Serve the generated takes at the exact path AudioSystem fetches.
  // Named by the CONVENTION (id with dots as dashes), because that is now how
  // a file finds its id — nothing declares these in the registry.
  const takes = ['crash-player-shard-a.wav', 'crash-player-shard-b.wav', 'crash-player-shard-c.wav'];
  let served = 0;
  await page.route('**/assets/sfx/*.wav', route => {
    const name = route.request().url().split('/').pop();
    const i = takes.indexOf(name);
    if (i < 0) return route.fulfill({ status: 404, body: '' });
    served++;
    route.fulfill({ status: 200, contentType: 'audio/wav', body: makeWav(0.05, 22050, 7 + i * 31) });
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.mouse.click(195, 700);                 // gesture-unlock the context
  await page.waitForFunction(() => window.__omniEngine?.audio?.audible === true, { timeout: 15000 });
  // The world must be RUNNING: a frozen sim (menu / pause / dock) drops every
  // positional voice by design, so measuring on the menu measures nothing.
  await page.evaluate(() => window.__omniEngine.startGame());

  // ── Decode ───────────────────────────────────────────────────────────────
  await page.waitForFunction(() => window.__omniEngine.audio.sampleCount >= 3, { timeout: 15000 })
    .catch(() => {});
  const decoded = await page.evaluate(() => window.__omniEngine.audio.sampleCount);
  ok(decoded === 3, `all three takes decoded (${decoded}/3)`);
  ok(served === 3, `each take fetched exactly once (${served} requests)`);
  ok(await page.evaluate(() => window.__omniEngine.audio.hasSample('crash.player.shard')),
     'crash.player.shard resolves to a recording');
  ok(!await page.evaluate(() => window.__omniEngine.audio.hasSample('crash.player.tile')),
     'an id with no sample declared stays on its draft');

  // Preload happens at unlock, not on first hit — the whole point, since a
  // decode inside a collision frame is the jank this design avoids.
  const before = await page.evaluate(() => window.__omniEngine.audio.playsOf('crash.player.shard'));
  ok(before === 0, 'takes decoded before the sound was ever triggered');

  // ── Budgets still apply to a recording ───────────────────────────────────
  const budget = await page.evaluate(() => {
    const e = window.__omniEngine, a = e.audio;
    // AT THE LISTENER.  This id is near-field (SHARD_RANGE 240/850), so a
    // burst fired at world origin is dropped as out of earshot and every
    // budget assertion below would pass vacuously on zero voices.
    const p = e.player.position;
    a.resetCounters();
    for (let i = 0; i < 200; i++) a.play('crash.player.shard', { x: p.x, y: p.y });
    return { ...a.counts, live: a.liveVoicesOf('crash.player.shard') };
  });
  ok(budget.played < 200, `retrigger window still gates a burst (${budget.played} of 200 played)`);
  ok(budget.collapsed > 0, 'collapse still fires on a recording');
  ok(budget.live <= 3, `polyphony cap still holds (${budget.live} <= 3)`);

  // ── Round-robin ──────────────────────────────────────────────────────────
  ok(await page.evaluate(() => {
    const a = window.__omniEngine.audio;
    const seen = new Set();
    for (let i = 0; i < 3; i++) seen.add(a.takeSample('crash.player.shard'));
    return seen.size === 3;
  }), 'consecutive triggers cycle through all three takes');

  // ── COST: sample voice vs synth voice ────────────────────────────────────
  const cost = await page.evaluate(() => {
    const a = window.__omniEngine.audio;
    // minInterval would gate a tight loop, so time the voice construction
    // directly by alternating ids and spacing past the window.
    const p = window.__omniEngine.player.position;
    // 4000 iterations, not 400: performance.now() is coarse enough that a
    // sub-microsecond call is mostly quantisation noise at small n.
    const bench = (id, n) => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        a.play(id, { x: p.x, y: p.y });
        const st = a.ids?.get(id); if (st) st.lastAt = -999;   // defeat the retrigger gate
      }
      return (performance.now() - t0) / n * 1000;   // µs per call
    };
    bench('crash.player.shard', 500);               // warm both paths first
    bench('crash.player.tile', 500);
    return { sample: bench('crash.player.shard', 4000), synth: bench('crash.player.tile', 4000) };
  });
  console.log(`  ..  per play(): sample ${cost.sample.toFixed(2)} µs, synth ${cost.synth.toFixed(2)} µs`);
  ok(cost.sample < 40, `a sampled voice costs well under a frame budget (${cost.sample.toFixed(2)} µs)`);
  // Both paths are sub-microsecond, so a RATIO here is mostly timer noise.
  // What matters, and what this asserts, is that neither is within three
  // orders of magnitude of a 16 ms frame.
  ok(cost.synth < 40, `a synth voice costs the same order (${cost.synth.toFixed(2)} µs)`);
  console.log(`  ..  ratio sample/synth ${(cost.sample / Math.max(0.01, cost.synth)).toFixed(2)}× — both sub-µs, so this is timer noise, not a signal`);

  // ── COST: frame time in a real scene, samples on vs muted ────────────────
  const frames = await page.evaluate(async () => {
    const e = window.__omniEngine;
    const measure = async () => {
      const ts = [];
      let last = performance.now();
      await new Promise(res => {
        let n = 0;
        const tick = () => {
          const now = performance.now();
          ts.push(now - last); last = now;
          // Hammer the sampled id the way a rubble field does — AT THE
          // LISTENER.  Firing at world origin looked fine and measured
          // nothing: this id is near-field, so every voice was dropped as
          // out of earshot and the comparison was muted-vs-also-silent.
          const p = e.player.position;
          for (let i = 0; i < 8; i++) {
            e.audio.play('crash.player.shard', { x: p.x + i * 12, y: p.y });
            const st = e.audio.ids?.get('crash.player.shard'); if (st) st.lastAt = -999;
          }
          if (++n < 180) requestAnimationFrame(tick); else res();
        };
        requestAnimationFrame(tick);
      });
      ts.sort((a, b) => a - b);
      return ts[Math.floor(ts.length / 2)];
    };
    e.audio.muted = true;  const muted = await measure();
    e.audio.resetCounters();
    e.audio.muted = false; const loud = await measure();
    const played = e.audio.playsOf('crash.player.shard');
    e.audio.muted = false;
    return { muted, loud, played };
  });
  const delta = (frames.loud - frames.muted) / frames.muted * 100;
  console.log(`  ..  median frame: muted ${frames.muted.toFixed(2)} ms, sampled ${frames.loud.toFixed(2)} ms (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%)`);
  // Guard the guard: a frame-time comparison against a scene that played
  // nothing is the failure mode this measurement had on its first cut.
  // Far below the 1440 attempts, and that is the design working: poly 3 and
  // the global ceiling gate the rest.  The bar is only "voices were really
  // built", since a frame-time comparison against silence proves nothing.
  ok(frames.played > 50, `the measured scene actually played voices (${frames.played} of 1440 attempts)`);
  ok(Math.abs(delta) < 15, `sampled playback does not move frame time (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%)`);

  // ── Fallback: the state of the repo with no files present ────────────────
  const page2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page2.route('**/assets/sfx/*.wav', route => route.fulfill({ status: 404, body: '' }));
  await page2.goto(URL, { waitUntil: 'networkidle' });
  await page2.mouse.click(195, 700);
  await page2.waitForFunction(() => window.__omniEngine?.audio?.audible === true, { timeout: 15000 });
  await page2.evaluate(() => window.__omniEngine.startGame());
  const fell = await page2.evaluate(() => {
    const a = window.__omniEngine.audio;
    a.resetCounters();
    a.play('crash.player.shard', { x: 0, y: 0 });
    return { count: a.sampleCount, has: a.hasSample('crash.player.shard'), played: a.playsOf('crash.player.shard') };
  });
  ok(fell.count === 0, 'a 404 decodes nothing');
  ok(fell.has === false, 'and the id reports no recording');
  ok(fell.played === 1, 'but the sound still plays — the draft covers it');

  // ── A file that decodes but carries no signal ────────────────────────────
  // The failure that actually happened: an export captured ~4ms of near-
  // silence.  It is worse than a missing file, because it WINS over a
  // working draft, so the fallback has to cover content and not just fetch.
  const page3 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page3.route('**/assets/sfx/*.wav', route =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: makeWav(0.2, 22050, 3, 0.0004) }));
  await page3.goto(URL, { waitUntil: 'networkidle' });
  await page3.mouse.click(195, 700);
  await page3.waitForFunction(() => window.__omniEngine?.audio?.audible === true, { timeout: 15000 });
  await page3.evaluate(() => window.__omniEngine.startGame());
  await page3.waitForFunction(() => window.__omniEngine.audio.rejectedSampleCount >= 3, { timeout: 15000 })
    .catch(() => {});
  const silent = await page3.evaluate(() => {
    const e = window.__omniEngine, a = e.audio, p = e.player.position;
    a.resetCounters();
    a.play('crash.player.shard', { x: p.x, y: p.y });
    return { rejected: a.rejectedSampleCount, loaded: a.sampleCount,
             has: a.hasSample('crash.player.shard'), played: a.playsOf('crash.player.shard') };
  });
  ok(silent.rejected === 3, `a silent take is rejected at decode (${silent.rejected}/3)`);
  ok(silent.loaded === 0, 'and is not counted as loaded');
  ok(silent.has === false, 'so the id does not resolve to a recording');
  ok(silent.played === 1, 'and the draft still makes the sound');

  // ── Auto-discovery by filename, and the drafts toggle ────────────────────
  const page4 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page4.goto(URL, { waitUntil: 'networkidle' });
  await page4.mouse.click(195, 700);
  await page4.waitForFunction(() => window.__omniEngine?.audio?.audible === true, { timeout: 15000 });
  await page4.evaluate(() => window.__omniEngine.startGame());
  await page4.waitForFunction(() => window.__omniEngine.audio.sampleCount > 0, { timeout: 15000 })
    .catch(() => {});
  const disc = await page4.evaluate(() => {
    const a = window.__omniEngine.audio;
    return { sampled: a.sampledIds, unmatched: a.unmatchedFiles, total: a.allIds.length };
  });
  // The committed takes are named crash-player-shard-*.wav and nothing in the
  // registry declares them: matching them to the id is the convention working.
  ok(disc.sampled.includes('crash.player.shard'),
     `a file named after an id is discovered without being declared (${disc.sampled.join(', ') || 'none'})`);
  ok(disc.unmatched.length === 0, `no file matches an unknown id (${disc.unmatched.join(', ') || 'none'})`);
  ok(disc.total > 100, `every registered id is reported for coverage (${disc.total})`);

  const drafts = await page4.evaluate(() => {
    const e = window.__omniEngine, a = e.audio, p = e.player.position;
    const run = () => {
      a.resetCounters();
      const st1 = a.ids?.get('crash.player.shard'); if (st1) st1.lastAt = -999;
      a.play('crash.player.shard', { x: p.x, y: p.y });          // HAS a recording
      const st2 = a.ids?.get('crash.player.tile'); if (st2) st2.lastAt = -999;
      a.play('crash.player.tile', { x: p.x, y: p.y });           // draft only
      return { rec: a.playsOf('crash.player.shard'), draft: a.playsOf('crash.player.tile') };
    };
    a.draftsEnabled = true;  const on  = run();
    a.draftsEnabled = false; const off = run();
    a.draftsEnabled = true;
    return { on, off };
  });
  ok(drafts.on.rec === 1 && drafts.on.draft === 1, 'with drafts ON both a recorded and an unrecorded id sound');
  ok(drafts.off.rec === 1, 'with drafts OFF a recorded id still sounds');
  ok(drafts.off.draft === 0, 'with drafts OFF an unrecorded id is SILENT — the audition mode');

  await browser.close();
  console.log(`\nsample: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

run();
