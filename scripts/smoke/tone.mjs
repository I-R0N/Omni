/**
 * Tone smoke — a permanent guard against the "high-pitched whine" class of
 * bug the user reported.
 *
 * Renders each sound OFFLINE through its real registry `render` function
 * and measures a dominant-frequency proxy (zero-crossing rate / 2).  ZCR
 * is not a spectrum analyser — it over-reads on noisy sources — but it is
 * monotonic in brightness, which is exactly what is needed to assert
 * "material chatter must not live up where the ear gets tired" and to
 * catch a regression back.
 */
import { chromium } from 'playwright';
const URL = process.env.SMOKE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  ok  ' + n); }
                               else { fail++; console.log('FAIL  ' + n + ' ' + e); } };

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => { fail++; console.log('FAIL  pageerror: ' + e.message); });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__omniEngine, null, { timeout: 15000 });
await page.mouse.click(640, 400);
await page.waitForTimeout(200);

const brightness = await page.evaluate(async ids => {
  const a = window.__omniEngine.audio;
  const out = {};
  for (const id of ids) {
    const def = a.defs.get(id);          // TS `private` is compile-time only
    if (!def) { out[id] = null; continue; }
    const SR = 44100;
    const off = new OfflineAudioContext(1, SR, SR);
    const noiseBuf = off.createBuffer(1, SR * 2, SR);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    def.render({ ctx: off, dest: off.destination, t0: 0, pitch: 1, param: 0, noise: noiseBuf });
    const rendered = await off.startRendering();
    const d = rendered.getChannelData(0);
    // Only measure where there is signal, so trailing silence can't skew it.
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    const floor = peak * 0.05;
    let crossings = 0, samples = 0, prev = 0;
    for (let i = 0; i < d.length; i++) {
      if (Math.abs(d[i]) < floor) continue;
      samples++;
      if (prev !== 0 && ((prev < 0 && d[i] >= 0) || (prev > 0 && d[i] < 0))) crossings++;
      prev = d[i];
    }
    out[id] = samples > 100 ? Math.round((crossings / samples) * SR / 2) : 0;
  }
  return out;
}, ['impact.tile.glass', 'impact.tile.metal', 'impact.tile.rock', 'impact.tile.plastic',
    'destroy.tile.glass', 'destroy.tile.metal', 'destroy.tile.rock',
    'destroy.shard.glass', 'destroy.shard.metal', 'destroy.shard.rock',
    'move.tilesnap', 'move.merge']);

console.log('  dominant-freq proxy (Hz):', JSON.stringify(brightness));

// The user's complaint, encoded: nothing that fires in BULK around a
// material field may sit up in the fatiguing band.
const BULK = ['impact.tile.glass', 'impact.tile.metal', 'impact.tile.rock',
              'impact.tile.plastic', 'move.tilesnap', 'move.merge',
              'destroy.shard.glass', 'destroy.shard.metal', 'destroy.shard.rock',
              'destroy.tile.glass', 'destroy.tile.rock'];
for (const id of BULK) {
  ok(`${id} is out of the whine band (<2 kHz)`,
     brightness[id] !== null && brightness[id] < 2000, `${brightness[id]} Hz`);
}
ok('metal chip is now a LOW clonk, not a ring',
   brightness['impact.tile.metal'] < 1100, `${brightness['impact.tile.metal']} Hz`);

// The material ORDERING has to survive the lowering, or the materials stop
// being tellable apart — which would trade one bug for another.
ok('glass is still brighter than metal',
   brightness['impact.tile.glass'] > brightness['impact.tile.metal'],
   JSON.stringify({ glass: brightness['impact.tile.glass'], metal: brightness['impact.tile.metal'] }));
ok('metal tile break is still deeper than glass tile break',
   brightness['destroy.tile.metal'] < brightness['destroy.tile.glass'],
   JSON.stringify({ metal: brightness['destroy.tile.metal'], glass: brightness['destroy.tile.glass'] }));

// ── Sustained loops ──
// A high tone is worst when it is HELD, so the loops matter more than the
// one-shots.  Rendered the same way, through their real `start()`.
const loopTone = await page.evaluate(async ids => {
  const a = window.__omniEngine.audio;
  const out = {};
  for (const id of ids) {
    const def = a.loopDefs.get(id);
    if (!def) { out[id] = null; continue; }
    const SR = 44100;
    const off = new OfflineAudioContext(1, SR, SR);
    const noiseBuf = off.createBuffer(1, SR * 2, SR);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    def.start({ ctx: off, dest: off.destination, t0: 0, pitch: 1, param: 0, noise: noiseBuf });
    const r = await off.startRendering();
    const d = r.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    const floor = peak * 0.05;
    let cross = 0, n = 0, prev = 0;
    for (let i = 0; i < d.length; i++) {
      if (Math.abs(d[i]) < floor) continue;
      n++;
      if (prev !== 0 && ((prev < 0 && d[i] >= 0) || (prev > 0 && d[i] < 0))) cross++;
      prev = d[i];
    }
    out[id] = n > 100 ? Math.round((cross / n) * SR / 2) : 0;
  }
  return out;
}, ['portal.idle', 'poi.station.idle', 'move.thrust', 'snitch.near']);
console.log('  loop dominant-freq proxy (Hz):', JSON.stringify(loopTone));

ok('the portal idle is a LOW hum, not a shimmer',
   loopTone['portal.idle'] < 400, `${loopTone['portal.idle']} Hz`);
ok('the station idle is a LOW bed', loopTone['poi.station.idle'] < 400,
   `${loopTone['poi.station.idle']} Hz`);
ok('the engine idle is low', loopTone['move.thrust'] < 400,
   `${loopTone['move.thrust']} Hz`);
ok('no sustained loop sits in the whine band',
   Object.values(loopTone).every(v => v !== null && v < 1600),
   JSON.stringify(loopTone));

// The two POI beds must be tellable APART, not merely both low: the portal
// is tonal, the station broadband.  They measure at nearly the SAME
// dominant frequency (~65 Hz), so frequency alone cannot show this.
//
// Crest factor was the first attempt and is simply the wrong tool —
// filtered noise has a HIGHER peak-to-RMS than beating sines, so it ranked
// them backwards.  What actually separates tonal from noisy is the
// REGULARITY of the zero crossings: a tone crosses zero on a near-fixed
// period, noise does not.  Coefficient of variation of the crossing
// intervals: low = tonal, high = broadband.
const character = await page.evaluate(async () => {
  const a = window.__omniEngine.audio;
  const measure = async id => {
    const SR = 44100;
    const off = new OfflineAudioContext(1, SR, SR);
    const nb = off.createBuffer(1, SR * 2, SR);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    a.loopDefs.get(id).start({ ctx: off, dest: off.destination, t0: 0, pitch: 1, param: 0, noise: nb });
    const d = (await off.startRendering()).getChannelData(0);
    const from = (SR * 0.25) | 0;              // skip the fade-in
    const gaps = [];
    let prev = 0, lastCross = -1;
    for (let i = from; i < d.length; i++) {
      if (prev !== 0 && ((prev < 0 && d[i] >= 0) || (prev > 0 && d[i] < 0))) {
        if (lastCross >= 0) gaps.push(i - lastCross);
        lastCross = i;
      }
      prev = d[i];
    }
    if (gaps.length < 20) return 0;
    const mean = gaps.reduce((x, y) => x + y, 0) / gaps.length;
    const varr = gaps.reduce((acc, g) => acc + (g - mean) ** 2, 0) / gaps.length;
    return Math.sqrt(varr) / mean;             // CV: 0 = perfectly periodic
  };
  return { portal: await measure('portal.idle'), station: await measure('poi.station.idle') };
});
console.log('  zero-crossing CV (low=tonal, high=broadband):', JSON.stringify(character));
ok('the portal reads TONAL', character.portal < 0.5, JSON.stringify(character));
ok('the station reads BROADBAND', character.station > 0.5, JSON.stringify(character));
ok('the two POI beds are distinguishable by character, not just volume',
   character.station > character.portal * 1.5,
   JSON.stringify({ ...character, ratio: character.station / character.portal }));

await browser.close();
console.log(`\ntone: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
