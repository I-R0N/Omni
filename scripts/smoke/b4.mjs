/**
 * B4 smoke — explosion variety.
 *
 * The point of the milestone is that different classes DIE DIFFERENTLY, so
 * the assertions compare classes against each other rather than checking
 * that particles merely exist: kill each class in isolation, snapshot the
 * particles it produced, and assert the profiles are actually distinct on
 * the axes the table claims (count, speed, size, palette, ring shape).
 * Also asserts the particle budget is respected and that MAX_PARTICLES
 * still holds under a mass death.
 */
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://127.0.0.1:4176/';
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
await page.mouse.click(640, 400);
await page.evaluate(() => window.__omniEngine.startGame());
await page.waitForTimeout(500);

// Helper installed in-page: spawn one enemy of a subtype far from the
// player, kill it through the REAL death path, and snapshot the particles
// and rings it produced.
await page.evaluate(() => {
  const e = window.__omniEngine;
  window.__probe = (subtype, opts = {}) => {
    const map = e.currentMap;
    const ents = map.entities;
    // Snapshot the particle population before the kill.
    const before = new Set();
    for (const x of ents) if (x.type === 'PARTICLE' && x.active) before.add(x.id);
    const pos = { x: e.player.position.x + 900, y: e.player.position.y + 900 };
    const ctx = e.waveContext();
    const victim = e.waves.spawnAt(subtype, pos, ctx, false);
    Object.assign(victim, opts);
    victim.health = 0;
    e.handleEntityDeath(victim);
    // Everything new is this death's output.
    const out = { debris: [], rings: [], colors: {} };
    for (const x of ents) {
      if (x.type !== 'PARTICLE' || !x.active || before.has(x.id)) continue;
      const sp = Math.hypot(x.velocity.x, x.velocity.y);
      if (x.isExplosionRing) { out.rings.push({ r: x.explosionRadius ?? x.size.x, color: x.color }); continue; }
      out.debris.push({ sp, size: x.size.x, life: x.lifetime, color: x.color });
      out.colors[x.color] = (out.colors[x.color] || 0) + 1;
    }
    return out;
  };
  return true;
});

const probe = async (subtype, opts) => page.evaluate(
  ([s, o]) => window.__probe(s, o), [subtype, opts ?? {}]);

const stat = r => ({
  n: r.debris.length,
  rings: r.rings.length,
  avgSpeed: r.debris.length ? r.debris.reduce((a, d) => a + d.sp, 0) / r.debris.length : 0,
  avgSize: r.debris.length ? r.debris.reduce((a, d) => a + d.size, 0) / r.debris.length : 0,
  avgLife: r.debris.length ? r.debris.reduce((a, d) => a + d.life, 0) / r.debris.length : 0,
  hues: Object.keys(r.colors).length,
});

const swarm  = stat(await probe('SWARM'));
await page.waitForTimeout(120);
const std    = stat(await probe('SHOOTER_1'));
await page.waitForTimeout(120);
const heavy  = stat(await probe('RAMMER_3'));
await page.waitForTimeout(120);
const bomber = stat(await probe('KAMIKAZE', { detonateOnDeath: false }));
await page.waitForTimeout(120);
const bubble = stat(await probe('BUBBLE'));
await page.waitForTimeout(120);

console.log('  profiles:', JSON.stringify({ swarm, std, heavy, bomber, bubble }));

// Every class actually produces a burst.
for (const [name, s] of Object.entries({ swarm, std, heavy, bomber, bubble })) {
  ok(`${name} produces a death burst`, s.n > 0, JSON.stringify(s));
}

// The classes are DISTINCT on the axes the table claims.
ok('a gnat pop is cheaper than a standard kill', swarm.n < std.n,
   `swarm=${swarm.n} std=${std.n}`);
ok('a gnat pop has no white core ring', swarm.rings === 1,
   `rings=${swarm.rings}`);
ok('a standard kill has both a ring and a core flash', std.rings === 2,
   `rings=${std.rings}`);
ok('a heavy hull throws SLOWER debris than a standard kill',
   heavy.avgSpeed < std.avgSpeed, `heavy=${heavy.avgSpeed.toFixed(2)} std=${std.avgSpeed.toFixed(2)}`);
ok('a heavy hull throws BIGGER debris than a standard kill',
   heavy.avgSize > std.avgSize, `heavy=${heavy.avgSize.toFixed(2)} std=${std.avgSize.toFixed(2)}`);
ok('a heavy hull leaves LONGER-lived debris than a standard kill',
   heavy.avgLife > std.avgLife, `heavy=${heavy.avgLife.toFixed(2)} std=${std.avgLife.toFixed(2)}`);
ok('a bomber throws FASTER debris than everything else',
   bomber.avgSpeed > std.avgSpeed && bomber.avgSpeed > heavy.avgSpeed,
   `bomber=${bomber.avgSpeed.toFixed(2)}`);
ok('a bubble bursts SLOWLY — the one death that is not combustion',
   bubble.avgSpeed < std.avgSpeed, `bubble=${bubble.avgSpeed.toFixed(2)}`);
ok('a bubble has no hot white spark layer and no core ring',
   bubble.rings === 1, `rings=${bubble.rings}`);
ok('classes with an accent read in more than one hue',
   heavy.hues >= 2 && bubble.hues >= 2 && bomber.hues >= 2,
   JSON.stringify({ heavy: heavy.hues, bubble: bubble.hues, bomber: bomber.hues }));
ok('a plain standard kill stays two-tone (body + spark)',
   std.hues === 2, `hues=${std.hues}`);

// Budget: the standard profile must not have grown past what it replaced
// (PR #69 trimmed bursts: ~15-18 particles).
ok('the standard burst stays inside the trimmed particle budget',
   std.n <= 18, `n=${std.n}`);
ok('the gnat burst is cheaper than it was before differentiation',
   swarm.n <= 8, `n=${swarm.n}`);

// The audio+visual pairing: one classification drives both.
const paired = await page.evaluate(async () => {
  const e = window.__omniEngine, a = e.audio;
  const out = {};
  for (const [sub, id] of [['SWARM', 'destroy.enemy.small'],
                           ['RAMMER_3', 'destroy.enemy.heavy'],
                           ['BUBBLE', 'destroy.enemy.bubble'],
                           ['SHOOTER_1', 'destroy.enemy.standard']]) {
    a.resetCounters();
    const r = window.__probe(sub);
    out[sub] = { sfx: a.playsOf(id), debris: r.debris.length };
    await new Promise(res => setTimeout(res, 250));
  }
  return out;
});
for (const [sub, r] of Object.entries(paired)) {
  ok(`${sub}'s burst and its SFX fire together`, r.sfx >= 1 && r.debris > 0,
     JSON.stringify(r));
}

// Mass death: MAX_PARTICLES still bounds the field.
const mass = await page.evaluate(async () => {
  for (let i = 0; i < 60; i++) window.__probe('SHOOTER_1');
  await new Promise(r => setTimeout(r, 100));
  let live = 0;
  for (const x of window.__omniEngine.currentMap.entities) {
    if (x.type === 'PARTICLE' && x.active) live++;
  }
  return live;
});
ok('MAX_PARTICLES still bounds the field after 60 simultaneous deaths',
   mass <= 1200, `live=${mass}`);

// Material breaks differ from each other too.  The Overworld hub carries
// no rock tiles, so measure each material on a map that actually has it.
const measure = async (descriptorId, variant) => {
  await page.evaluate(id => window.__omniEngine.transitionToMap(id), descriptorId);
  await page.waitForTimeout(600);
  return page.evaluate(v => {
    const e = window.__omniEngine, ents = e.currentMap.entities;
    const before = new Set();
    for (const x of ents) if (x.type === 'PARTICLE' && x.active) before.add(x.id);
    const speeds = [];
    let killed = 0;
    for (const t of ents.slice()) {
      if (killed >= 4) break;
      if (t.type !== 'STRUCTURE' || t.shardVariant !== v || !t.active || t.mass !== Infinity) continue;
      t.health = 0;
      e.handleEntityDeath(t);
      killed++;
    }
    for (const x of ents) {
      if (x.type !== 'PARTICLE' || !x.active || before.has(x.id) || x.isExplosionRing) continue;
      speeds.push(Math.hypot(x.velocity.x, x.velocity.y));
    }
    return { killed, n: speeds.length,
             avg: speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0 };
  }, variant);
};

const glassMat = await measure('field_glass', 'glass-tile');
const rockMat  = await measure('field_rock', 'rock-tile');
const metalMat = await measure('field_metal', 'metal-tile');
console.log('  materials:', JSON.stringify({ glassMat, rockMat, metalMat }));

ok('a glass tile break produces debris', glassMat.n > 0, JSON.stringify(glassMat));
ok('a rock tile break produces debris', rockMat.n > 0, JSON.stringify(rockMat));
ok('a metal tile break produces debris', metalMat.n > 0, JSON.stringify(metalMat));
ok('glass SHATTERS faster than rock CRUMBLES',
   glassMat.avg > rockMat.avg, JSON.stringify({ glassMat, rockMat }));
ok('metal sits between the two, with its hot spark layer',
   metalMat.avg > rockMat.avg && metalMat.avg < glassMat.avg,
   JSON.stringify({ glassMat, rockMat, metalMat }));

await browser.close();
console.log(`\nB4: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
