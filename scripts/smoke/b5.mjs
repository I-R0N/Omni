/**
 * B5 smoke — validation.
 *
 *  1. Perf REC A/B through the SAME harness: identical heavy scene with
 *     mass deaths, run muted then unmuted.  Event-driven audio should be
 *     ~free; anything else means the manager is doing per-frame work.
 *  2. Phone-scale check of the audio settings row (390 px wide).
 *  3. Full loop: fight → per-class explosions → boss beat → dock →
 *     purchase → portal, with the audio triggers asserted throughout.
 */
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://127.0.0.1:4173/';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});

// ── 1. Perf A/B ────────────────────────────────────────────────────────────
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => { fail++; console.log('FAIL  pageerror: ' + e.message); });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__omniEngine, null, { timeout: 15000 });
await page.mouse.click(640, 400);
await page.evaluate(() => window.__omniEngine.startGame());
await page.waitForTimeout(600);

// The scene: identical work both times.  Two things the first cut got
// wrong and this one fixes — the runs must not SHARE FIELD STATE (a
// growing entity population made the later run strictly heavier), and
// they must be measured over a FIXED FRAME COUNT rather than a fixed
// wall-clock window (equal duration with unequal frame counts compares
// different amounts of work).
await page.evaluate(() => {
  const e = window.__omniEngine;
  const KINDS = ['SWARM', 'SHOOTER_1', 'RAMMER_3', 'KAMIKAZE', 'BUBBLE'];

  // Direct cost of the manager itself, independent of the render loop.
  window.__playCost = (n) => {
    const a = e.audio;
    const px = e.player.position.x, py = e.player.position.y;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      // Rotate ids so the retrigger window does not turn this into a
      // measurement of the early-out path.
      a.play(i % 2 ? 'destroy.enemy.standard' : 'impact.hull.enemy',
             { x: px + (i % 50), y: py + (i % 37) });
    }
    return performance.now() - t0;
  };

  window.__heavyRun = (frames) => {
    // Fresh field every run: same starting conditions, both times.
    e.restartGame();
    e.startGame();
    const ctx = e.waveContext();
    for (let i = 0; i < 50; i++) {
      const a = (i / 50) * Math.PI * 2;
      e.waves.spawnAt(KINDS[i % KINDS.length], {
        x: e.player.position.x + Math.cos(a) * (280 + (i % 7) * 80),
        y: e.player.position.y + Math.sin(a) * (280 + (i % 5) * 100),
      }, ctx, false);
    }
    const times = [];
    let last = performance.now();
    let f = 0;
    return new Promise(resolve => {
      const tick = () => {
        const now = performance.now();
        if (f > 3) times.push(now - last);   // discard the first few frames
        last = now;
        // A steady mass-death rate: 4 kills a frame, replaced 1:1, so the
        // population is STABLE across the whole run and identical between
        // runs.  This is a heavy fight, not a runaway.
        let killed = 0;
        for (const x of e.currentMap.entities) {
          if (killed >= 4) break;
          if (x.type === 'ENEMY' && x.active && !x.isExploding) {
            x.health = 0; e.handleEntityDeath(x); killed++;
          }
        }
        const c = e.waveContext();
        for (let i = 0; i < killed; i++) {
          const a = (f * 0.7 + i) % (Math.PI * 2);
          e.waves.spawnAt(KINDS[(f + i) % KINDS.length], {
            x: e.player.position.x + Math.cos(a) * 420,
            y: e.player.position.y + Math.sin(a) * 420,
          }, c, false);
        }
        if (++f < frames) requestAnimationFrame(tick);
        else {
          const sorted = times.slice().sort((a, b) => a - b);
          resolve({
            n: sorted.length,
            median: sorted[Math.floor(sorted.length / 2)],
            p95: sorted[Math.floor(sorted.length * 0.95)],
            mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
          });
        }
      };
      requestAnimationFrame(tick);
    });
  };
  return true;
});

const runScene = async muted => {
  await page.evaluate(m => {
    const a = window.__omniEngine.audio;
    a.setMuted(m); a.resetCounters();
  }, muted);
  const r = await page.evaluate(f => window.__heavyRun(f), 150);
  const audio = await page.evaluate(() => ({
    played: window.__omniEngine.audio.counts.played,
    dropped: window.__omniEngine.audio.counts.dropped,
    collapsed: window.__omniEngine.audio.counts.collapsed,
    peak: window.__omniEngine.audio.liveVoices,
  }));
  await page.waitForTimeout(500);
  return { ...r, audio };
};

// Warm-up, discarded — the first run pays JIT and map-warm costs.
await runScene(true);
const muted = await runScene(true);
const live  = await runScene(false);
// Alternate back to catch drift in the container (thermal / other load):
// if the second muted run agrees with the first, the comparison is sound.
const muted2 = await runScene(true);

console.log('  muted :', JSON.stringify(muted));
console.log('  audio :', JSON.stringify(live));
console.log('  muted2:', JSON.stringify(muted2));

const mutedBase = Math.min(muted.median, muted2.median);
const deltaMedian = live.median - mutedBase;
const pctMedian = (deltaMedian / mutedBase) * 100;
const drift = Math.abs(muted2.median - muted.median) / muted.median * 100;
console.log(`  delta : median ${deltaMedian.toFixed(2)} ms (${pctMedian.toFixed(1)}%), ` +
            `muted-run drift ${drift.toFixed(1)}%`);

const cost1k = await page.evaluate(() => window.__playCost(1000));
console.log(`  play(): 1000 calls in ${cost1k.toFixed(2)} ms ` +
            `(${(cost1k / 1000 * 1000).toFixed(3)} us/call)`);

ok('audio actually fired during the unmuted run', live.audio.played > 0,
   JSON.stringify(live.audio));
ok('the muted run fired nothing', muted.audio.played === 0,
   JSON.stringify(muted.audio));
// NOTE what this can and cannot show.  Headless frames here run ~300 ms,
// which is LONGER than every retrigger window in the table, so most
// triggers legitimately get their own voice — suppression is a
// within-one-step mechanism and this harness has no dense steps.  What
// the heavy scene CAN prove is that suppression engages at all and that
// concurrency stays low; the within-a-single-step collapse is proven
// directly by B2's 200-trigger burst.
ok('suppression engages during the heavy scene',
   live.audio.dropped + live.audio.collapsed > 0, JSON.stringify(live.audio));
ok('peak concurrency stays far below the ceiling in a real fight',
   live.audio.peak <= 12, `peak=${live.audio.peak}`);
ok('the voice ceiling held through the heavy scene', live.audio.peak <= 24,
   `peak=${live.audio.peak}`);
ok('the two muted runs agree, so the A/B baseline is stable',
   drift < 25, `drift=${drift.toFixed(1)}%`);
// The real bar: 1000 play() calls is FAR more than any frame issues, so
// if that is sub-millisecond-per-hundred the manager cannot be a
// meaningful per-frame cost.
ok('1000 play() calls cost under 60 ms (audio is not a per-frame cost)',
   cost1k < 60, `${cost1k.toFixed(2)} ms`);
ok('unmuted frame time is within 15% of muted',
   pctMedian < 15, `median +${pctMedian.toFixed(1)}%`);

await page.close();

// ── 2. Phone-scale check ───────────────────────────────────────────────────
const phone = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true, hasTouch: true, deviceScaleFactor: 3,
});
phone.on('pageerror', e => { fail++; console.log('FAIL  phone pageerror: ' + e.message); });
await phone.goto(URL, { waitUntil: 'networkidle' });
await phone.waitForFunction(() => !!window.__omniEngine, null, { timeout: 15000 });
await phone.evaluate(() => { window.__omniEngine.startGame(); });
await phone.waitForTimeout(400);
await phone.evaluate(() => window.__omniEngine.pauseGame());
await phone.waitForTimeout(400);

const slider = phone.locator('input[aria-label="Master volume"]');
const mute = phone.locator('[aria-label="Mute"], [aria-label="Unmute"]');
ok('the audio row renders at 390 px', await slider.count() === 1 && await mute.count() === 1);

const box = await slider.boundingBox();
const mbox = await mute.boundingBox();
console.log('  phone  :', JSON.stringify({ slider: box, mute: mbox }));
ok('the row stays inside the 390 px viewport',
   box && mbox && mbox.x >= 0 && (box.x + box.width) <= 390,
   JSON.stringify({ box, mbox }));
ok('the mute button meets a touch-target minimum (>=32 px)',
   mbox && mbox.width >= 32 && mbox.height >= 32, JSON.stringify(mbox));
ok('the slider is wide enough to be usable (>=120 px)',
   box && box.width >= 120, JSON.stringify(box));
const noHScroll = await phone.evaluate(() =>
  document.documentElement.scrollWidth <= window.innerWidth + 1);
ok('the pause menu does not scroll horizontally at 390 px', noHScroll);

// The controls actually work under touch.
await mute.tap();
await phone.waitForTimeout(150);
const mutedNow = await phone.evaluate(() => window.__omniEngine.audio.muted);
ok('tapping mute on a phone toggles the mixer', mutedNow === true);
await mute.tap();
await phone.waitForTimeout(150);
ok('tapping again unmutes', await phone.evaluate(() => !window.__omniEngine.audio.muted));
await phone.close();

// ── 3. Full loop ───────────────────────────────────────────────────────────
const loop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
loop.on('pageerror', e => { fail++; console.log('FAIL  loop pageerror: ' + e.message); });
await loop.goto(URL, { waitUntil: 'networkidle' });
await loop.waitForFunction(() => !!window.__omniEngine, null, { timeout: 15000 });
await loop.mouse.click(640, 400);
await loop.evaluate(() => window.__omniEngine.startGame());
await loop.waitForTimeout(600);
await loop.evaluate(() => window.__omniEngine.audio.resetCounters());

// Fight.
for (let i = 0; i < 5; i++) { await loop.mouse.click(880, 320); await loop.waitForTimeout(200); }
// Per-class explosions.
await loop.evaluate(async () => {
  const e = window.__omniEngine, ctx = e.waveContext();
  for (const k of ['SWARM', 'SHOOTER_1', 'RAMMER_3', 'KAMIKAZE', 'BUBBLE']) {
    const v = e.waves.spawnAt(k, {
      x: e.player.position.x + 700, y: e.player.position.y + 700 }, ctx, false);
    v.detonateOnDeath = false;
    v.health = 0;
    e.handleEntityDeath(v);
    await new Promise(r => setTimeout(r, 220));
  }
});
// Boss beat.
await loop.evaluate(() => window.__omniEngine.debugSpawnBoss('BOSS_WARDEN'));
await loop.waitForTimeout(400);
// Dock + purchase.
await loop.evaluate(async () => {
  const e = window.__omniEngine;
  e.addDebugCredits(500000);
  // The HOME station is drydock-only, so cycle until one with a SHIP SHOP
  // is in range — otherwise the purchase is legitimately refused and the
  // assertion would be vacuously true.
  for (let i = 0; i < 4; i++) {
    e.debugTeleportToStation();
    await new Promise(r => setTimeout(r, 250));
    if (window.__omniStats?.dock?.services?.shipShop) break;
  }
  e.dockAtStation();
  await new Promise(r => setTimeout(r, 150));
  e.purchaseModule('engine_mk1');
  await new Promise(r => setTimeout(r, 150));
  e.undock();
});
await loop.waitForTimeout(300);
// Portal.
await loop.evaluate(() => window.__omniEngine.transitionToMap('arena_ring'));
await loop.waitForTimeout(600);

const heard = await loop.evaluate(() => {
  const a = window.__omniEngine.audio;
  const ids = ['weapon.blaster.fire', 'destroy.enemy.small', 'destroy.enemy.standard',
               'destroy.enemy.heavy', 'destroy.enemy.kamikaze', 'destroy.enemy.bubble',
               'boss.intro', 'poi.dock', 'poi.purchase', 'poi.undock', 'portal.transit'];
  const out = {};
  for (const i of ids) out[i] = a.playsOf(i);
  return out;
});
console.log('  loop  :', JSON.stringify(heard));
for (const [id, n] of Object.entries(heard)) {
  ok(`the full loop heard ${id}`, n >= 1, `n=${n}`);
}
const stillPlaying = await loop.evaluate(() => window.__omniEngine.audio.unlocked);
ok('audio survived the whole loop without the context dying', stillPlaying === true);

await browser.close();
console.log(`\nB5: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
