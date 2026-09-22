/**
 * B2 smoke — AudioSystem manager.
 *
 * Drives the REAL engine in a REAL browser (CLAUDE.md §8: window.__omniEngine
 * exists for exactly this).  Assertions:
 *   - no AudioContext before a user gesture
 *   - a gesture unlocks it
 *   - registry is populated and ids resolve
 *   - triggers actually play
 *   - per-id polyphony + retrigger collapse hold under a burst
 *   - mute silences
 *   - positional attenuation drops out-of-earshot sounds
 *   - the loop API is idempotent both ways
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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => { fail++; console.log('FAIL  pageerror: ' + e.message); });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__omniEngine, null, { timeout: 15000 });

// ── 1. No context before a gesture ──
const preState = await page.evaluate(() => ({
  unlocked: window.__omniEngine.audio.unlocked,
  ctxState: window.__omniEngine.audio.contextState,
  registered: window.__omniEngine.audio.registeredCount,
}));
ok('no AudioContext before any gesture', preState.unlocked === false, JSON.stringify(preState));
ok('contextState is null before gesture', preState.ctxState === null);
ok('registry populated at construction', preState.registered >= 13, `count=${preState.registered}`);

// A play() before unlock must be a silent no-op, not a throw.
const preplay = await page.evaluate(() => {
  try { window.__omniEngine.audio.play('weapon.blaster.fire'); return 'ok'; }
  catch (e) { return String(e); }
});
ok('play() before unlock is a no-op, not a throw', preplay === 'ok', preplay);
ok('still locked after a pre-unlock play', await page.evaluate(() => !window.__omniEngine.audio.unlocked));

// ── 2. Gesture unlocks ──
await page.mouse.move(640, 400);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(200);
const post = await page.evaluate(() => ({
  unlocked: window.__omniEngine.audio.unlocked,
  ctxState: window.__omniEngine.audio.contextState,
}));
ok('gesture unlocks the AudioContext', post.unlocked === true, JSON.stringify(post));
ok('context is running after unlock', post.ctxState === 'running', post.ctxState);

// ── 3. Ids resolve ──
const ids = ['weapon.blaster.fire','weapon.burst.fire','weapon.burst.sub','weapon.shotgun.fire',
             'weapon.bouncer.fire','weapon.lightning.fire','weapon.homing.fire','weapon.cannon.fire',
             'weapon.charge.ready','weapon.charged.release','weapon.reject','weapon.cycle',
             'weapon.charge.loop'];
const missing = await page.evaluate(list => list.filter(i => !window.__omniEngine.audio.has(i)), ids);
ok('every registered inventory id resolves', missing.length === 0, missing.join(','));

// World (positional) audio is suppressed while the sim is frozen, by
// design — so enter PLAYING before asserting anything positional.
await page.evaluate(() => window.__omniEngine.startGame());
await page.waitForTimeout(400);

const frozen = await page.evaluate(() => {
  const a = window.__omniEngine.audio;
  a.setActive(false); a.resetCounters();
  a.play('weapon.cannon.fire', { x: 0, y: 0 });   // positional → suppressed
  a.play('weapon.reject');                         // flat/UI → still audible
  const r = { played: a.counts.played, dropped: a.counts.dropped };
  a.setActive(true);
  return r;
});
ok('a frozen sim silences world audio but not UI audio',
   frozen.played === 1 && frozen.dropped === 1, JSON.stringify(frozen));

// ── 4. Triggers play ──
const played = await page.evaluate(() => {
  const a = window.__omniEngine.audio;
  a.resetCounters();
  a.setListener(0, 0);
  a.play('weapon.cannon.fire', { x: 0, y: 0 });
  return { n: a.playsOf('weapon.cannon.fire'), played: a.counts.played };
});
ok('a one-shot trigger plays', played.n === 1 && played.played === 1, JSON.stringify(played));

// ── 5. Polyphony + collapse under a burst ──
const burst = await page.evaluate(() => {
  const a = window.__omniEngine.audio;
  a.resetCounters();
  a.setListener(0, 0);
  // 200 simultaneous triggers of a collapsing id — the mass-death case.
  for (let i = 0; i < 200; i++) a.play('weapon.blaster.fire', { x: 0, y: 0 });
  return { played: a.counts.played, dropped: a.counts.dropped,
           collapsed: a.counts.collapsed, live: a.liveVoices };
});
ok('a 200-trigger burst does not spawn 200 voices', burst.played <= 2,
   JSON.stringify(burst));
ok('excess triggers are accounted for (dropped or collapsed)',
   burst.played + burst.dropped + burst.collapsed === 200, JSON.stringify(burst));
ok('live voices stay under the global ceiling', burst.live <= 24, `live=${burst.live}`);

// The invariant `poly` exists to guarantee: sustained hammering of an id
// never puts more than `poly` of its voices in the air at once.  Sampled
// across a long enough stretch to cover several voice lifetimes.
const polyTest = await page.evaluate(async () => {
  const a = window.__omniEngine.audio;
  a.resetCounters();
  let peakCannon = 0, peakBlaster = 0;
  for (let i = 0; i < 120; i++) {
    a.play('weapon.cannon.fire',  { x: 0, y: 0 });
    a.play('weapon.blaster.fire', { x: 0, y: 0 });
    peakCannon  = Math.max(peakCannon,  a.liveVoicesOf('weapon.cannon.fire'));
    peakBlaster = Math.max(peakBlaster, a.liveVoicesOf('weapon.blaster.fire'));
    await new Promise(r => setTimeout(r, 25));
  }
  return { peakCannon, peakBlaster, dropped: a.counts.dropped };
});
ok('cannon never exceeds its poly cap of 2 under sustained fire',
   polyTest.peakCannon <= 2 && polyTest.peakCannon > 0, JSON.stringify(polyTest));
ok('blaster never exceeds its poly cap of 4 under sustained fire',
   polyTest.peakBlaster <= 4 && polyTest.peakBlaster > 0, JSON.stringify(polyTest));
ok('sustained hammering is throttled, not all admitted',
   polyTest.dropped > 0, JSON.stringify(polyTest));

// ── 6. Mute silences ──
const muteTest = await page.evaluate(() => {
  const a = window.__omniEngine.audio;
  a.setMuted(true);
  a.resetCounters();
  for (let i = 0; i < 5; i++) a.play('weapon.shotgun.fire', { x: 0, y: 0 });
  a.loop('weapon.charge.loop', true, { param: 0.5 });
  const whileMuted = { played: a.counts.played, loops: a.liveLoops };  // mute stops ALL loops, so the global count is right here
  a.setMuted(false);
  a.resetCounters();
  a.play('weapon.shotgun.fire', { x: 0, y: 0 });
  return { whileMuted, afterUnmute: a.counts.played };
});
ok('mute silences one-shots', muteTest.whileMuted.played === 0, JSON.stringify(muteTest));
ok('mute silences loops', muteTest.whileMuted.loops === 0, JSON.stringify(muteTest));
ok('unmute restores playback', muteTest.afterUnmute === 1, JSON.stringify(muteTest));

// ── 7. Positional attenuation ──
await page.waitForTimeout(400);  // clear the cannon's 250 ms retrigger window
const posTest = await page.evaluate(() => {
  const a = window.__omniEngine.audio;
  a.setListener(0, 0);
  a.resetCounters();
  // Beyond FAR_RADIUS (2600), and well inside half the 12000-wide
  // Overworld so the torus wrap does not fold it back to a near delta.
  a.play('weapon.cannon.fire', { x: 3400, y: 0 });
  const far = a.counts.dropped;
  a.resetCounters();
  a.play('weapon.cannon.fire', { x: 100, y: 0 });   // inside NEAR_RADIUS
  return { far, near: a.counts.played };
});
ok('an out-of-earshot positional sound is dropped', posTest.far >= 1, JSON.stringify(posTest));
ok('a nearby positional sound still plays', posTest.near === 1, JSON.stringify(posTest));

// The seam case: a sound 400 units away ACROSS the wrap must be audible,
// not treated as 11600 units away.  This is why pan/distance use
// wrapDeltaX/wrapDeltaY rather than raw subtraction.
await page.waitForTimeout(400);  // clear the cannon's 250 ms retrigger window
const seamTest = await page.evaluate(() => {
  const a = window.__omniEngine.audio;
  a.setListener(5900, 0);          // near the +x seam of the 12000-wide map
  a.resetCounters();
  a.play('weapon.cannon.fire', { x: -5900, y: 0 });  // 200 units away across it
  return { played: a.counts.played, dropped: a.counts.dropped };
});
ok('a sound across the torus seam is heard as near, not far',
   seamTest.played === 1, JSON.stringify(seamTest));

// ── 8. Loop idempotency ──
const loopTest = await page.evaluate(() => {
  const a = window.__omniEngine.audio;
  a.setActive(true);
  a.loop('weapon.charge.loop', true, { param: 0.2 });
  a.loop('weapon.charge.loop', true, { param: 0.4 });
  a.loop('weapon.charge.loop', true, { param: 0.9 });
  // Count THIS id, not every live loop — the engine idle loop is always
  // running during play, so liveLoops is not the quantity under test.
  const on = a.isLooping('weapon.charge.loop') ? 1 : 0;
  a.loop('weapon.charge.loop', false);
  a.loop('weapon.charge.loop', false);
  const off = a.isLooping('weapon.charge.loop') ? 1 : 0;
  return { on, off };
});
ok('repeated loop-on calls make exactly one voice', loopTest.on === 1, JSON.stringify(loopTest));
ok('repeated loop-off calls are idempotent', loopTest.off === 0, JSON.stringify(loopTest));

// ── 9. Live fire in the real game ──
await page.evaluate(() => { window.__omniEngine.audio.resetCounters(); });
for (let i = 0; i < 6; i++) {
  await page.mouse.click(900, 400);
  await page.waitForTimeout(180);
}
const fired = await page.evaluate(() => ({
  blaster: window.__omniEngine.audio.playsOf('weapon.blaster.fire'),
  played: window.__omniEngine.audio.counts.played,
}));
ok('clicking in-game fires the weapon SFX', fired.blaster >= 2, JSON.stringify(fired));

// ── 10. No per-frame audio growth ──
// ── 10. The manager schedules nothing on its own ──
// This is the "event-driven, not per-frame" property.  It cannot be
// observed in a LIVE Overworld — that world legitimately makes noise on
// its own (ambient bubbles, a roaming dragon, rubble bumping the hull now
// that player↔shard contact is audible), and an earlier version of this
// test was flaky for exactly that reason.  PAUSING removes every world
// event, so anything that still fired would have to have come from the
// audio system itself.  The actual per-frame COST is measured directly by
// B5's play() microbenchmark, which is not load-sensitive.
const growth = await page.evaluate(async () => {
  const e = window.__omniEngine, a = e.audio;
  e.pauseGame();
  await new Promise(r => setTimeout(r, 300));
  a.resetCounters();
  await new Promise(r => setTimeout(r, 1500));   // ~90 frames
  const r = { played: a.counts.played, live: a.liveVoices, loops: a.liveLoops };
  e.resumeGame();
  return r;
});
ok('the manager fires nothing on its own across ~90 idle frames',
   growth.played === 0, JSON.stringify(growth));
ok('no voices leak across an idle window', growth.live === 0, JSON.stringify(growth));
ok('a frozen sim holds no world loops', growth.loops === 0, JSON.stringify(growth));

await browser.close();
console.log(`\nB2: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
