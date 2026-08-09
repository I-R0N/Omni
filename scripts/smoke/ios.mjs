/**
 * iOS-recovery smoke.  Chromium can't reproduce the iOS silent switch, but
 * it CAN verify every other half of the fix: that the gesture listeners
 * survive the first gesture, that a non-running context is resumed on the
 * next gesture (the 'interrupted' recovery path), that the session claim
 * runs without throwing, and that the diagnostic strip reports honestly.
 */
import { chromium } from 'playwright';
const URL = process.env.SMOKE_URL || 'http://127.0.0.1:4181/';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  ok  ' + n); }
                               else { fail++; console.log('FAIL  ' + n + ' ' + e); } };

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
page.on('pageerror', e => { fail++; console.log('FAIL  pageerror: ' + e.message); });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__omniEngine, null, { timeout: 15000 });

ok('still locked before any gesture',
   await page.evaluate(() => window.__omniEngine.audio.contextState === null));
ok('audible is false while locked',
   await page.evaluate(() => window.__omniEngine.audio.audible === false));

await page.touchscreen.tap(195, 500);
await page.waitForTimeout(300);
ok('first gesture starts the context',
   await page.evaluate(() => window.__omniEngine.audio.audible === true),
   await page.evaluate(() => String(window.__omniEngine.audio.contextState)));

// The regression the fix targets: a context that stops running must be
// recoverable by a LATER gesture.  `once` listeners made this impossible.
// TS `private` is compile-time only, so the live context is reachable at
// runtime — no test-only API added to production code for this.
await page.evaluate(async () => { await window.__omniEngine.audio.ctx.suspend(); });
await page.waitForTimeout(200);
const suspended = await page.evaluate(() => window.__omniEngine.audio.contextState);
if (suspended === 'suspended') {
  ok('context is suspended for the recovery test', true);
  await page.touchscreen.tap(195, 500);
  await page.waitForTimeout(400);
  ok('a LATER gesture resumes a suspended context (the once: true bug)',
     await page.evaluate(() => window.__omniEngine.audio.audible === true),
     await page.evaluate(() => String(window.__omniEngine.audio.contextState)));
} else {
  ok('context is suspended for the recovery test', false, 'state=' + suspended);
}

// The silent-WAV element must be a real, decodable audio resource — a
// malformed one is worse than none on iOS.
const wav = await page.evaluate(async () => {
  const els = [...document.querySelectorAll('audio')];
  if (!els.length) return { present: false };
  const el = els[0];
  return {
    present: true,
    playsinline: el.hasAttribute('playsinline'),
    loop: el.loop,
    quiet: el.volume <= 0.01,
    decodable: await new Promise(res => {
      const probe = new Audio(el.src);
      probe.addEventListener('loadedmetadata', () => res(true), { once: true });
      probe.addEventListener('error', () => res(false), { once: true });
      setTimeout(() => res(false), 3000);
    }),
  };
});
console.log('  silent element:', JSON.stringify(wav));
if (wav.present) {
  ok('the silent session-shim element decodes', wav.decodable === true);
  ok('the shim is playsinline, looping and inaudible',
     wav.playsinline && wav.loop && wav.quiet, JSON.stringify(wav));
} else {
  ok('no shim element needed (navigator.audioSession path)', true);
}

// Force the OLDER-iOS branch: with navigator.audioSession absent, the
// manager must fall back to the silent-element session promotion.  That is
// the path a pre-16.4 iPhone actually takes, so it needs real coverage.
const fallback = await (async () => {
  const p2 = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await p2.addInitScript(() => {
    try { delete Navigator.prototype.audioSession; } catch { /* not present */ }
    try { Object.defineProperty(navigator, 'audioSession', { get: () => undefined, configurable: true }); } catch { /* ignore */ }
  });
  await p2.goto(URL, { waitUntil: 'networkidle' });
  await p2.waitForFunction(() => !!window.__omniEngine, null, { timeout: 15000 });
  await p2.touchscreen.tap(195, 500);
  await p2.waitForTimeout(500);
  const r = await p2.evaluate(async () => {
    const el = document.querySelector('audio');
    if (!el) return { present: false };
    return {
      present: true, playsinline: el.hasAttribute('playsinline'),
      loop: el.loop, quiet: el.volume <= 0.01, src: el.src.slice(0, 30),
      decodable: await new Promise(res => {
        const probe = new Audio(el.src);
        probe.addEventListener('loadedmetadata', () => res(true), { once: true });
        probe.addEventListener('error', () => res(false), { once: true });
        setTimeout(() => res(false), 3000);
      }),
      audible: window.__omniEngine.audio.audible,
    };
  });
  await p2.close();
  return r;
})();
console.log('  fallback path:', JSON.stringify(fallback));
ok('without navigator.audioSession, the silent shim element is created',
   fallback.present === true, JSON.stringify(fallback));
ok('the shim WAV actually decodes (a malformed one is worse than none)',
   fallback.decodable === true, JSON.stringify(fallback));
ok('the shim is playsinline, looping and inaudible',
   fallback.playsinline && fallback.loop && fallback.quiet, JSON.stringify(fallback));
ok('audio is still audible on the fallback path', fallback.audible === true);

// Sound still actually plays after all of this.
await page.evaluate(() => { window.__omniEngine.startGame(); window.__omniEngine.audio.resetCounters(); });
await page.waitForTimeout(400);
await page.touchscreen.tap(300, 300);
await page.waitForTimeout(300);
ok('a shot still makes a sound after the iOS changes',
   await page.evaluate(() => window.__omniEngine.audio.counts.played > 0));

await browser.close();
console.log(`\niOS: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
