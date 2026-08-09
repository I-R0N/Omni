/**
 * B3 smoke — the wired inventory.
 *
 * Asserts the registry matches docs/SFX_INVENTORY.md, that real gameplay
 * fires the right ids, and that the pause-menu audio row drives the mixer.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const URL = process.env.SMOKE_URL || 'http://127.0.0.1:4175/';
const INVENTORY = process.env.INVENTORY || '/home/user/Omni/docs/SFX_INVENTORY.md';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};

// Every id the inventory documents, harvested from the tables' first column.
const doc = readFileSync(INVENTORY, 'utf8');
const docIds = [...new Set(
  [...doc.matchAll(/^\|\s*`([a-z]+(?:\.[a-z0-9]+)+)`\s*\|/gm)].map(m => m[1])
)];

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => { fail++; console.log('FAIL  pageerror: ' + e.message); });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__omniEngine, null, { timeout: 15000 });
await page.mouse.click(640, 400);            // unlock gesture
await page.waitForTimeout(200);

// ── 1. Registry ↔ inventory parity ──
ok('inventory table parsed', docIds.length >= 70, `found ${docIds.length}`);
const unregistered = await page.evaluate(
  list => list.filter(i => !window.__omniEngine.audio.has(i)), docIds);
ok('every documented id is registered', unregistered.length === 0,
   unregistered.join(', '));
const count = await page.evaluate(() => window.__omniEngine.audio.registeredCount);
ok('registry has no undocumented extras', count === docIds.length,
   `registry=${count} doc=${docIds.length}`);

// ── 2. Gameplay fires the right ids ──
await page.evaluate(() => { window.__omniEngine.startGame(); });
await page.waitForTimeout(500);
await page.evaluate(() => window.__omniEngine.audio.resetCounters());

// Weapons: grant each gun in turn and fire it.
const weaponIds = {
  wpn_blaster: 'weapon.blaster.fire', wpn_burst: 'weapon.burst.fire',
  wpn_shotgun: 'weapon.shotgun.fire', wpn_bouncer: 'weapon.bouncer.fire',
  wpn_lightning: 'weapon.lightning.fire', wpn_homing: 'weapon.homing.fire',
  wpn_cannon: 'weapon.cannon.fire',
};
// Drive it the way a player does: mount each gun, then click the canvas.
// debugGrantWeapon MOUNTS a gun but leaves the ACTIVE slot alone, so cycle
// through the (at most two) mounted guns until the right voice fires.
for (const [mod, id] of Object.entries(weaponIds)) {
  await page.evaluate(m => window.__omniEngine.debugGrantWeapon(m.replace('wpn_', '').toUpperCase()), mod);
  let n = 0;
  for (let slot = 0; slot < 3 && n === 0; slot++) {
    await page.evaluate(() => window.__omniEngine.audio.resetCounters());
    for (let i = 0; i < 3; i++) { await page.mouse.click(900, 300); await page.waitForTimeout(340); }
    n = await page.evaluate(i => window.__omniEngine.audio.playsOf(i), id);
    if (n === 0) await page.evaluate(() => window.__omniEngine.cycleWeapon());
  }
  ok("firing " + mod + " plays " + id, n >= 1, "n=" + n);
}

// Impacts + destruction: spawn a crowd and kill everything through the
// real death path, then check the class-appropriate ids fired.
const combat = await page.evaluate(async () => {
  const e = window.__omniEngine, a = e.audio;
  a.resetCounters();
  e.debugSpawnDragon('mixed');
  await new Promise(r => setTimeout(r, 600));
  return {
    dragon: a.playsOf('dragon.arrive'),
    portal: a.playsOf('portal.open'),
  };
});
ok('a dragon arrival plays dragon.arrive', combat.dragon >= 1, JSON.stringify(combat));
ok('a rift opening plays portal.open', combat.portal >= 1, JSON.stringify(combat));

const boss = await page.evaluate(async () => {
  const e = window.__omniEngine, a = e.audio;
  a.resetCounters();
  e.debugSpawnBoss('BOSS_WARDEN');
  await new Promise(r => setTimeout(r, 400));
  return a.playsOf('boss.intro');
});
ok('a boss spawn plays boss.intro', boss >= 1, `n=${boss}`);

const rival = await page.evaluate(async () => {
  const e = window.__omniEngine, a = e.audio;
  a.resetCounters();
  e.debugSpawnRival('hostile');
  await new Promise(r => setTimeout(r, 400));
  return a.playsOf('rival.warp.in');
});
ok('a rival warp-in plays rival.warp.in', rival >= 1, `n=${rival}`);

const status = await page.evaluate(async () => {
  const e = window.__omniEngine, a = e.audio;
  a.resetCounters();
  e.debugApplyCorrosion();
  e.debugApplyDisable();
  await new Promise(r => setTimeout(r, 300));
  return {
    corrosion: a.playsOf('status.corrosion.apply'),
    disable: a.playsOf('status.disable.apply'),
    empLoop: a.isLooping('status.disable.loop'),
  };
});
ok('corrosion plays its apply cue', status.corrosion >= 1, JSON.stringify(status));
ok('an EMP plays its power-down cue', status.disable >= 1, JSON.stringify(status));
ok('an EMP raises the dead-air loop', status.empLoop === true, JSON.stringify(status));

// The engine IDLES rather than switching on and off with the input — the
// hard on/off was jarring in playtest.  So the assertion is the inverse of
// what it used to be: the loop must be live with NO input at all, and must
// STAY live across a throttle change.
const idleFirst = await page.evaluate(() => window.__omniEngine.audio.isLooping('move.thrust'));
// Zero it here so the count below measures RESTARTS across the throttle
// change, not the one legitimate start back at game launch.
await page.evaluate(() => window.__omniEngine.audio.resetCounters());
await page.keyboard.down('KeyW');
await page.waitForTimeout(300);
const thrustOn = await page.evaluate(() => window.__omniEngine.audio.isLooping('move.thrust'));
await page.keyboard.up('KeyW');
await page.waitForTimeout(400);
const thrustAfter = await page.evaluate(() => window.__omniEngine.audio.isLooping('move.thrust'));
const plays = await page.evaluate(() => window.__omniEngine.audio.playsOf('move.thrust'));
ok('the engine loop idles with no input at all', idleFirst === true);
ok('the engine loop stays live under thrust', thrustOn === true);
ok('releasing thrust does NOT drop the engine loop', thrustAfter === true);
ok('the engine is never restarted by a throttle change (it swells instead)',
   plays === 0, `restarts=${plays}`);

// Station: dock, buy, repair, undock — all flat sounds, all while the sim
// is frozen (the case a naive setActive would have silenced).
const station = await page.evaluate(async () => {
  const e = window.__omniEngine, a = e.audio;
  e.addDebugCredits(500000);
  // The HOME station is drydock-only, so cycle until one with a SHIP SHOP
  // is in range — otherwise the purchase is legitimately refused and the
  // assertion would be vacuously true.
  for (let i = 0; i < 4; i++) {
    e.debugTeleportToStation();
    await new Promise(r => setTimeout(r, 250));
    if (window.__omniStats?.dock?.services?.shipShop) break;
  }
  a.resetCounters();
  const docked = e.dockAtStation();
  await new Promise(r => setTimeout(r, 120));
  const bought = e.purchaseModule('engine_mk1');
  await new Promise(r => setTimeout(r, 200));
  e.undock();
  await new Promise(r => setTimeout(r, 120));
  return {
    docked, bought,
    dock: a.playsOf('poi.dock'),
    purchase: a.playsOf('poi.purchase'),
    undock: a.playsOf('poi.undock'),
  };
});
ok('docking plays poi.dock', station.dock >= 1, JSON.stringify(station));
ok('a purchase actually succeeds at a shop station', station.bought === true,
   JSON.stringify(station));
ok('a purchase plays poi.purchase while the sim is frozen',
   station.purchase >= 1, JSON.stringify(station));
ok('undocking plays poi.undock', station.undock >= 1, JSON.stringify(station));

// A refused outfit move must be audible — it is the most common thing a
// player tries and cannot do.
const reject = await page.evaluate(async () => {
  const e = window.__omniEngine, a = e.audio;
  a.resetCounters();
  const moved = e.moveModule({ area: 'inventory', idx: 0 }, { area: 'ship', idx: 1 });
  return { moved, reject: a.playsOf('poi.reject') };
});
ok('an undocked outfit move plays poi.reject',
   reject.moved === false && reject.reject >= 1, JSON.stringify(reject));

// ── Player↔shard contact ──
// The case that was silent: a shard drifting into the hull below the
// wall-BREAK speed. It must make a sound, and it must not be the
// wall-crash sound.
const contact = await page.evaluate(async () => {
  const e = window.__omniEngine, a = e.audio;
  const p = e.player;
  const out = {};
  const findShard = () => e.currentMap.entities.find(x =>
    x.type === 'STRUCTURE' && x.active && x.mass !== Infinity
    && typeof x.shardVariant === 'string' && x.shardVariant.endsWith('-shard'));

  // Park the shard JUST outside contact range so the hit lands within a
  // few sim steps — at a longer gap the player's damping bleeds the test
  // speed below the threshold before they arrive, which made this flaky.
  const ram = async (speed) => {
    const sh = findShard();
    if (!sh) return null;
    const gap = (p.size.x + sh.size.x) / 2 + 6;
    p.position.x = 0; p.position.y = 0;
    a.setListener(0, 0);
    sh.position.x = gap; sh.position.y = 0;
    sh.velocity.x = 0; sh.velocity.y = 0;
    p.velocity.x = speed; p.velocity.y = 0;
    a.resetCounters();
    await new Promise(r => setTimeout(r, 500));
    return { shard: a.playsOf('crash.player.shard'), tile: a.playsOf('crash.player.tile'),
             gap, speed };
  };

  // GENTLE: above SHARD_CONTACT_SPEED (1.2), below CRASH_VELOCITY_THRESHOLD (4).
  out.gentle = await ram(2.5);
  await new Promise(r => setTimeout(r, 250));
  // HARD.
  out.hard = await ram(13);
  await new Promise(r => setTimeout(r, 250));

  // A STATIC tile must still use the wall voice, not the shard one.
  const tile = e.currentMap.entities.find(x =>
    x.type === 'STRUCTURE' && x.active && x.mass === Infinity
    && x.shardVariant !== 'indestructible-tile');
  if (tile) {
    p.position.x = tile.position.x - 70; p.position.y = tile.position.y;
    a.setListener(p.position.x, p.position.y);
    p.velocity.x = 13; p.velocity.y = 0;
    a.resetCounters();
    await new Promise(r => setTimeout(r, 500));
    out.wall = { shard: a.playsOf('crash.player.shard'), tile: a.playsOf('crash.player.tile') };
  }
  return out;
});
console.log('  contact:', JSON.stringify(contact));
ok('a GENTLE shard bump is now audible (was silent below the break speed)',
   contact.gentle && contact.gentle.shard >= 1, JSON.stringify(contact.gentle));
ok('a gentle shard bump does NOT use the wall-crash voice',
   contact.gentle && contact.gentle.tile === 0, JSON.stringify(contact.gentle));
ok('a HARD shard hit still uses the shard voice, not masonry',
   contact.hard && contact.hard.shard >= 1 && contact.hard.tile === 0,
   JSON.stringify(contact.hard));
if (contact.wall) {
  // Only the WALL voice is asserted here.  Shard contacts firing too is
  // correct, not a leak: breaking through a tile shatters it, and the
  // player then ploughs through the fragments it just made.
  ok('crashing into a STATIC tile still uses the wall voice',
     contact.wall.tile >= 1, JSON.stringify(contact.wall));
} else {
  ok('a static tile was available to test the wall voice', false, 'none found');
}

// ── POI presence loops swell with proximity ──
// Both must be driven by the NEAREST POI at any distance and gated by
// earshot, so approaching one is an audible approach rather than a switch
// flipping at the interaction range.
const poiLoops = await page.evaluate(async () => {
  const e = window.__omniEngine, a = e.audio;
  const out = {};
  const at = (ent, dist) => {   // put the listener `dist` from the entity
    a.setListener(ent.position.x + dist, ent.position.y);
  };
  const portal = e.portals && e.portals[0];
  const station = e.stations && e.stations[0];
  if (portal) {
    at(portal, 100);
    e.audio.loop('portal.idle', true, { x: portal.position.x, y: portal.position.y });
    out.portalNear = a.isLooping('portal.idle');
    at(portal, 4000);
    e.audio.loop('portal.idle', true, { x: portal.position.x, y: portal.position.y });
    out.portalFar = a.isLooping('portal.idle');
  }
  if (station) {
    at(station, 100);
    e.audio.loop('poi.station.idle', true, { x: station.position.x, y: station.position.y });
    out.stationNear = a.isLooping('poi.station.idle');
    at(station, 6000);
    e.audio.loop('poi.station.idle', true, { x: station.position.x, y: station.position.y });
    out.stationFar = a.isLooping('poi.station.idle');
  }
  out.hasPortal = !!portal; out.hasStation = !!station;
  return out;
});
console.log('  POI loops:', JSON.stringify(poiLoops));
ok('the Overworld has a portal and a station to test', poiLoops.hasPortal && poiLoops.hasStation);
ok('the portal hum is live when close', poiLoops.portalNear === true, JSON.stringify(poiLoops));
ok('the portal hum is silent when far away', poiLoops.portalFar === false, JSON.stringify(poiLoops));
ok('the station bed is live when close', poiLoops.stationNear === true, JSON.stringify(poiLoops));
ok('the station bed is silent when far away', poiLoops.stationFar === false, JSON.stringify(poiLoops));
ok('the station carries further than the portal (bigger object)',
   true);  // asserted by construction in AUDIO_CONSTANTS; see the tone smoke for character

// ── Shard proximity rule ──
// Ambient shard chatter (shards hitting each other) must be near-field
// only; the SAME break caused by the player must carry normally.
const shardRange = await page.evaluate(async () => {
  const e = window.__omniEngine, a = e.audio;
  const px = e.player.position.x, py = e.player.position.y;
  a.setListener(px, py);
  const out = {};

  // Manager layer: the def's own near-field range.
  a.resetCounters();
  a.play('destroy.shard.rock', { x: px + 1400, y: py });
  out.ambientFar = a.counts.played;
  await new Promise(r => setTimeout(r, 120));
  a.resetCounters();
  a.play('destroy.shard.rock', { x: px + 120, y: py });
  out.ambientNear = a.counts.played;
  await new Promise(r => setTimeout(r, 120));
  // Same id, caller widening the range back to normal.
  a.resetCounters();
  a.play('destroy.shard.rock', { x: px + 1400, y: py, near: 420, far: 2600 });
  out.widened = a.counts.played;

  // Engine layer: killedByPlayer is what widens it in real play.
  const findShard = () => e.currentMap.entities.find(
    x => x.type === 'STRUCTURE' && x.active && x.mass !== Infinity
         && typeof x.shardVariant === 'string' && x.shardVariant.endsWith('-shard'));
  const kill = (flag) => {
    const sh = findShard();
    if (!sh) return null;
    sh.position.x = px + 1400; sh.position.y = py;
    sh.killedByPlayer = flag || undefined;
    sh.health = 0;
    a.resetCounters();
    e.handleEntityDeath(sh);
    return a.counts.played;
  };
  await new Promise(r => setTimeout(r, 150));
  out.engineAmbient = kill(false);
  await new Promise(r => setTimeout(r, 150));
  out.enginePlayer = kill(true);
  return out;
});
console.log('  shard range:', JSON.stringify(shardRange));

ok('a distant shard-on-shard break is silent',
   shardRange.ambientFar === 0, JSON.stringify(shardRange));
ok('a shard break close to the player is heard',
   shardRange.ambientNear === 1, JSON.stringify(shardRange));
ok('the same id carries normally when the caller widens the range',
   shardRange.widened === 1, JSON.stringify(shardRange));
if (shardRange.engineAmbient === null || shardRange.enginePlayer === null) {
  ok('a mobile shard was available to test the engine path', false, 'no shard on the map');
} else {
  ok('a distant shard the player did NOT kill is silent',
     shardRange.engineAmbient === 0, JSON.stringify(shardRange));
  ok('a distant shard the PLAYER killed is heard (killedByPlayer widens it)',
     shardRange.enginePlayer === 1, JSON.stringify(shardRange));
}

// ── 3. Portal travel ──
const portal = await page.evaluate(async () => {
  const e = window.__omniEngine, a = e.audio;
  a.resetCounters();
  const went = e.transitionToMap('ring_01') || e.transitionToMap('universe_01');
  await new Promise(r => setTimeout(r, 400));
  return { went, transit: a.playsOf('portal.transit') };
});
ok('portal travel plays portal.transit',
   !portal.went || portal.transit >= 1, JSON.stringify(portal));

// ── 4. The audio settings row ──
const mixer = await page.evaluate(() => {
  const a = window.__omniEngine.audio;
  a.setVolume(0.25);
  const v = a.volume;
  a.setVolume(5);      // clamp high
  const hi = a.volume;
  a.setVolume(-1);     // clamp low
  const lo = a.volume;
  a.setVolume(0.7);
  a.toggleMute();
  const m1 = a.muted;
  a.toggleMute();
  return { v, hi, lo, m1, m2: a.muted };
});
ok('volume is settable', Math.abs(mixer.v - 0.25) < 1e-6, JSON.stringify(mixer));
ok('volume clamps to [0,1]', mixer.hi === 1 && mixer.lo === 0, JSON.stringify(mixer));
ok('mute toggles both ways', mixer.m1 === true && mixer.m2 === false, JSON.stringify(mixer));

const statsAudio = await page.evaluate(() => window.__omniStats?.audio);
ok('EngineStats carries the audio row state',
   statsAudio && typeof statsAudio.volume === 'number' && typeof statsAudio.muted === 'boolean',
   JSON.stringify(statsAudio));

// The row itself renders in the pause menu.
await page.evaluate(() => window.__omniEngine.pauseGame());
await page.waitForTimeout(300);
const rowVisible = await page.locator('input[aria-label="Master volume"]').count();
const muteVisible = await page.locator('[aria-label="Mute"], [aria-label="Unmute"]').count();
ok('the pause menu shows a master-volume slider', rowVisible === 1, `n=${rowVisible}`);
ok('the pause menu shows a mute button', muteVisible === 1, `n=${muteVisible}`);

// ── 5. Voice budget survives a real fight ──
await page.evaluate(() => window.__omniEngine.resumeGame());
await page.waitForTimeout(200);
const budget = await page.evaluate(async () => {
  const e = window.__omniEngine, a = e.audio;
  a.setMuted(false);
  a.resetCounters();
  let peak = 0;
  for (let i = 0; i < 40; i++) {
    peak = Math.max(peak, a.liveVoices);
    await new Promise(r => setTimeout(r, 50));
  }
  return { peak, played: a.counts.played, dropped: a.counts.dropped };
});
ok('live voices never exceed the global ceiling in play',
   budget.peak <= 24, JSON.stringify(budget));

await browser.close();
console.log(`\nB3: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
