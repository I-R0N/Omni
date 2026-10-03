/**
 * Persistence and the death wreck, headless (plan D10, D14, D20–D24).
 *
 * "Relaunch" is a second engine over the SAME `MemoryStorage`, which is what a
 * relaunch is: nothing carries over but what was written.  Each claim has the
 * control that would catch a wrong answer, because a save that ignored the
 * character would pass "it loads" and a wreck that never moved would pass "it
 * is where it was".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeadlessEngine } from './harness';
import { MemoryStorage } from '../../engine/ports';
import { noteBossDefeated } from '../../engine/wreck';
import {
  SAVE_KEY, SAVE_BACKUP_KEY, SAVE_VERSION, parseSave, serializeSave, emptySave, validateSave,
} from '../../engine/save';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A launch over `storage`: constructed, in live play on the hub. */
function launch(storage: MemoryStorage, opts: Parameters<typeof createHeadlessEngine>[0] = {}) {
  const h = createHeadlessEngine({ ...opts, storage });
  const g = h.engine as Any;
  g.startGame();
  return { ...h, g };
}

/** Mount some real gear: a Mk II hull on the centre (touches nothing it needs)
 *  and a couple of weapon-flower modules, plus spare cargo. */
function outfit(g: Any) {
  g.debugGrantModule('hull_mk2');
  g.debugGrantModule('gunnery_mk1');
  g.inventory[11] = 'plating_mk1';
}

function fingerprint(g: Any): number {
  let h = 0x811c9dc5;
  for (const e of g.currentMap.entities) {
    if (!e.active || e.type !== 'STRUCTURE' || e.mass !== Infinity) continue;
    for (const v of [e.position.x, e.position.y]) h = Math.imul(h ^ (Math.round(v * 100) | 0), 0x01000193) >>> 0;
  }
  return h;
}

/** Kill the player and run until the death screen is up. */
function die(g: Any) {
  g.player.health = 0;
  for (let i = 0; i < 1500 && !g.deathPending; i++) g.stepSim(1);
  assert.equal(g.deathPending, true, 'the death screen came up');
}

const mounted = (slots: (string | null)[]) => slots.filter((s) => s !== null && s !== 'hull_base' && s !== 'dlv_projectile');

// ── the file ────────────────────────────────────────────────────────────

test('save: a fresh storage is a fresh character; a write round-trips', () => {
  assert.equal(parseSave(null).status, 'fresh');
  const s = emptySave();
  s.character.credits = 1234;
  s.character.inventory[3] = 'plating_mk1';
  s.records.highScore = 99;
  const back = parseSave(serializeSave(s));
  assert.equal(back.status, 'loaded');
  assert.deepEqual(back.save, s);
});

test('save: bad fields cost that field, never the whole save; unknown modules are dropped', () => {
  const doc = JSON.parse(serializeSave(emptySave()));
  doc.character.credits = 'lots';
  doc.character.inventory[0] = 'not_a_module';
  doc.character.inventory[1] = 'plating_mk1';
  doc.settings.volume = 9;
  doc.settings.controlScheme = 'telepathy';
  const v = validateSave(doc);
  assert.equal(v.character.credits, 0);
  assert.equal(v.character.inventory[0], null);
  assert.equal(v.character.inventory[1], 'plating_mk1');
  assert.equal(v.settings.volume, 1);
  assert.equal(v.settings.controlScheme, null);
});

test('save: a wreck that holds nothing is not a wreck', () => {
  const doc = JSON.parse(serializeSave(emptySave()));
  doc.wreck = { arenaId: 'arena_pocket', seed: 1, x: 0, y: 0, ship: [null], weapon: [] };
  assert.equal(validateSave(doc).wreck, null);
});

test('save VERSION POLICY: old saves migrate one step at a time; newer and corrupt ones are not silently eaten', () => {
  // Stand a v3 format in front of a v1 file, with migrations that each leave a mark.
  const v1 = JSON.stringify({ ...JSON.parse(serializeSave(emptySave())), version: 1 });
  const migrations = {
    1: (d: Record<string, unknown>) => ({ ...d, version: 2, seenV1to2: true }),
    2: (d: Record<string, unknown>) => ({ ...d, version: 3, seenV2to3: true }),
  };
  const calls: number[] = [];
  const traced = { 1: (d: Record<string, unknown>) => { calls.push(1); return migrations[1](d); },
                   2: (d: Record<string, unknown>) => { calls.push(2); return migrations[2](d); } };
  const p = parseSave(v1, 3, traced);
  assert.equal(p.status, 'migrated');
  assert.deepEqual(calls, [1, 2]);
  assert.equal(p.save.version, 3);
  // A gap in the chain is unreadable, not a guess.
  assert.equal(parseSave(v1, 3, { 2: migrations[2] }).status, 'unreadable');
  // From the future, and not JSON at all.
  assert.equal(parseSave(JSON.stringify({ version: SAVE_VERSION + 1 })).status, 'future');
  assert.equal(parseSave('{{{').status, 'unreadable');
  assert.equal(parseSave('{"version":"1"}').status, 'unreadable');
});

test('an unreadable or newer save is PARKED before a fresh one is written', () => {
  for (const raw of ['{{{ not json', JSON.stringify({ version: SAVE_VERSION + 5, character: { credits: 5 } })]) {
    const storage = new MemoryStorage();
    storage.set(SAVE_KEY, raw);
    const { g } = launch(storage);
    assert.equal(g.credits, 0, 'started fresh');
    assert.equal(storage.get(SAVE_BACKUP_KEY), raw, 'the original text is kept');
    g.credits = 7; g.saveNow();
    assert.equal(storage.get(SAVE_BACKUP_KEY), raw, 'and survives the next write');
    assert.equal(JSON.parse(storage.get(SAVE_KEY)!).character.credits, 7);
  }
});

// ── relaunch ────────────────────────────────────────────────────────────

test('relaunch: credits, cargo, the installed loadout and purchased slots all come back', () => {
  const storage = new MemoryStorage();
  const a = launch(storage);
  outfit(a.g);
  a.g.credits = 4321;
  a.g.shipSlotsUnlocked = 5;
  a.g.saveNow();
  const ship = a.g.shipSlots.slice(), weapon = a.g.weaponSlots.slice(), inv = a.g.inventory.slice();
  assert.ok(mounted(ship).length > 0, 'precondition: something is mounted');

  const b = launch(storage);
  assert.equal(b.g.credits, 4321);
  assert.deepEqual(b.g.shipSlots, ship);
  assert.deepEqual(b.g.weaponSlots, weapon);
  assert.deepEqual(b.g.inventory, inv);
  assert.equal(b.g.shipSlotsUnlocked, 5);
  // CONTROL: a launch over EMPTY storage has none of it.
  const c = launch(new MemoryStorage());
  assert.equal(c.g.credits, 0);
  assert.equal(c.g.shipSlotsUnlocked, 7);
});

test('relaunch: the settings come back — audio, control scheme, difficulty', () => {
  const storage = new MemoryStorage();
  const a = launch(storage);
  a.platform.audio.setVolume(0.25);
  a.platform.audio.setSfxVolume(0.5);
  a.platform.audio.setMusicVolume(0.1);
  a.platform.audio.toggleMute();
  a.g.setControlScheme('joystick-left');
  a.g.setDifficulty(1);
  a.g.saveNow();
  const b = launch(storage);
  assert.equal(b.platform.audio.volume, 0.25);
  assert.equal(b.platform.audio.sfxVolume, 0.5);
  assert.equal(b.platform.audio.musicVolume, 0.1);
  assert.equal(b.platform.audio.muted, true);
  assert.equal(b.g.input.getControlScheme(), 'joystick-left');
  assert.equal(b.g.getDifficulty(), 1);
});

test('the autosave tick writes a change once a second of frames, and backgrounding flushes at once', () => {
  const storage = new MemoryStorage();
  const { g, platform } = launch(storage);
  g.start();
  g.credits = 777;
  let t = 0;
  for (let i = 0; i < 30; i++) { t += 16; platform.clock.set(t); g.loop(t); }
  assert.equal(storage.get(SAVE_KEY) === null || JSON.parse(storage.get(SAVE_KEY)!).character.credits !== 777, true, 'not yet: under a second');
  for (let i = 0; i < 40; i++) { t += 16; platform.clock.set(t); g.loop(t); }
  assert.equal(JSON.parse(storage.get(SAVE_KEY)!).character.credits, 777);
  g.credits = 888;
  platform.lifecycle.emit('background');
  assert.equal(JSON.parse(storage.get(SAVE_KEY)!).character.credits, 888, 'the OS may not give another chance');
});

test('the HUB is the same place every launch, and a replay never reads the save', () => {
  const storage = new MemoryStorage();
  const a = launch(storage); const fa = fingerprint(a.g);
  outfit(a.g); a.g.credits = 50; a.g.saveNow();
  const b = launch(storage);
  assert.equal(fingerprint(b.g), fa, 'fixed hub seed: zero save bytes, identical terrain');
  // beginSeededRun is deterministic whatever the save says.
  b.g.beginSeededRun(5, 'POCKET');
  assert.equal(b.g.credits, 0);
  assert.equal(b.g.wreck, null);
});

// ── the wreck ───────────────────────────────────────────────────────────

test('a death leaves a wreck of what was MOUNTED, strips the ship, and keeps cargo and credits', () => {
  const storage = new MemoryStorage();
  const { g } = launch(storage);
  outfit(g);
  g.credits = 900;
  const had = mounted(g.shipSlots).concat(mounted(g.weaponSlots)).sort();
  const cargo = g.inventory.slice();
  assert.ok(had.length >= 2);

  g.transitionToMap('arena_pocket');
  const seed = g.arenaSeed;
  assert.notEqual(seed, null);
  g.stepSim(5);
  const at = { x: g.player.position.x, y: g.player.position.y };
  die(g);

  const w = g.wreck;
  assert.ok(w, 'a wreck record exists');
  assert.equal(w.arenaId, 'arena_pocket');
  assert.equal(w.seed, seed);
  assert.deepEqual(mounted(w.ship).concat(mounted(w.weapon)).sort(), had, 'exactly what was mounted');
  assert.ok(Math.hypot(w.x - at.x, w.y - at.y) < 50, 'where the ship fell');
  // stripped — at the moment of death, before any respawn tap
  assert.deepEqual(mounted(g.shipSlots), []);
  assert.deepEqual(mounted(g.weaponSlots), []);
  assert.equal(g.credits, 900);
  assert.deepEqual(g.inventory, cargo);
  // and the summary says so
  const s = g.runSummarySnapshot();
  assert.equal(s.wreck.modules, had.length);
  assert.equal(s.wreck.mapName, 'Pocket');
  assert.equal(g.records.deaths, 1);
});

test('QUITTING on the death screen does not keep the loadout: the strip and the wreck are already saved', () => {
  const storage = new MemoryStorage();
  const a = launch(storage);
  outfit(a.g);
  a.g.transitionToMap('arena_pocket');
  a.g.stepSim(5);
  die(a.g);                      // death screen is up; nobody has tapped respawn
  const b = launch(storage);     // the app is killed and relaunched
  assert.deepEqual(mounted(b.g.shipSlots), [], 'still stripped');
  assert.ok(b.g.wreck, 'and the wreck is still out there');
  assert.equal(b.g.wreck.seed, a.g.wreck.seed);
});

test('the wreck PINS its arena: re-entering regenerates the same terrain and the wreck is where you fell', () => {
  const storage = new MemoryStorage();
  const a = launch(storage);
  outfit(a.g);
  a.g.transitionToMap('arena_pocket');
  const terrainThen = fingerprint(a.g);
  a.g.stepSim(5);
  die(a.g);
  const w = a.g.wreck;

  // A relaunch has different entropy (a different clock, a different crypto draw),
  // so a seed that comes back equal came from the PIN, not from luck.
  const b = launch(storage, { entropySeed: 777 }); // the death screen is gone, the hub is up
  b.g.transitionToMap('arena_pocket');
  assert.equal(b.g.arenaSeed, w.seed, 'the seed is pinned');
  assert.equal(fingerprint(b.g), terrainThen, 'so the terrain is the same terrain');
  const e = b.g.wreckEntity;
  assert.ok(e && e.active && e.isWreck, 'the wreck is in the world');
  assert.deepEqual([e.position.x, e.position.y], [w.x, w.y]);

  // CONTROL: another arena is not pinned, and neither is this one once the wreck is gone.
  b.g.transitionToMap('arena_ring');
  assert.equal(b.g.wreckEntity, null);
  const free = launch(new MemoryStorage(), { entropySeed: 12345 });
  free.g.transitionToMap('arena_pocket');
  assert.notEqual(free.g.arenaSeed, w.seed);
});

test('flying into the wreck gives the loadout back, to CARGO only; the wreck is gone and the save says so', () => {
  const storage = new MemoryStorage();
  const a = launch(storage);
  outfit(a.g);
  const mounted = [...a.g.shipSlots, ...a.g.weaponSlots].filter((id) => id !== null && id !== 'hull_base' && id !== 'dlv_projectile').sort();
  assert.ok(mounted.length > 0, 'the test ship carries something');
  const cargoBefore = a.g.inventory.filter((id: string | null) => id !== null);
  a.g.transitionToMap('arena_pocket');
  a.g.stepSim(5);
  die(a.g);

  const b = launch(storage, { entropySeed: 777 });
  b.g.transitionToMap('arena_pocket');
  const e = b.g.wreckEntity;
  // Not yet: far from it.
  b.g.player.position = { x: e.position.x + 400, y: e.position.y };
  b.g.stepSim(3);
  assert.ok(b.g.wreck, 'a wreck that has not been reached is still there');
  // Fly into it.
  b.g.player.position = { x: e.position.x + 10, y: e.position.y };
  b.g.stepSim(3);
  assert.equal(b.g.wreck, null);
  assert.equal(b.g.wreckEntity, null);
  const cargo = b.g.inventory.filter((id: string | null) => id !== null).sort();
  assert.deepEqual(cargo, [...mounted, ...cargoBefore].sort(), 'every module is in the inventory');
  assert.equal(b.g.shipSlots.filter((id: string | null) => id !== null && id !== 'hull_base').length, 0, 'nothing is re-installed');
  assert.equal(b.g.weaponSlots.filter((id: string | null) => id !== null && id !== 'dlv_projectile').length, 0);
  assert.equal(JSON.parse(storage.get(SAVE_KEY)!).wreck, null, 'recovery is saved');
});

test('a recovery never destroys a module: occupied slots fall to cargo, and a full hold pays resale', () => {
  const storage = new MemoryStorage();
  const a = launch(storage);
  a.g.debugGrantModule('hull_mk2');
  a.g.debugGrantModule('plating_mk1');
  a.g.transitionToMap('arena_pocket');
  a.g.stepSim(5);
  die(a.g);
  const w = a.g.wreck;
  assert.ok(w);
  const hull = w.ship.findIndex((s: string | null) => s === 'hull_mk2');
  // Back to the hub; the player has since mounted something else in that
  // slot, and filled the hold but for one tile.
  a.g.respawnFromDeath();
  a.g.shipSlots[hull] = 'hull_mk1';
  a.g.inventory.fill('plating_mk1');
  a.g.inventory[0] = null;
  const credits = a.g.credits;
  a.g.transitionToMap('arena_pocket');
  const e = a.g.wreckEntity;
  assert.ok(e, 'the pinned arena holds the wreck');
  a.g.player.position = { x: e.position.x, y: e.position.y };
  a.g.stepSim(3);
  assert.equal(a.g.wreck, null);
  const cargoHasHull = a.g.inventory.includes('hull_mk2');
  const paid = a.g.credits > credits;
  assert.ok(cargoHasHull || paid, 'the displaced module is in cargo or was paid for');
  assert.equal(a.g.shipSlots[hull], 'hull_mk1', 'what the player mounted is untouched');
});

test('a SECOND death before recovery loses the older wreck — even when the second ship carried nothing', () => {
  const storage = new MemoryStorage();
  const { g } = launch(storage);
  outfit(g);
  g.transitionToMap('arena_pocket');
  g.stepSim(5);
  die(g);
  const first = g.wreck;
  assert.ok(first);

  // Respawn bare and die again in the hub: nothing mounted, nothing to leave.
  g.respawnFromDeath();
  assert.deepEqual(mounted(g.shipSlots), []);
  g.stepSim(5);
  die(g);
  assert.equal(g.wreck, null, 'the first wreck is gone and there is no second');
  assert.equal(JSON.parse(storage.get(SAVE_KEY)!).wreck, null);

  // And with gear on the second time, the NEW wreck replaces the old.
  g.respawnFromDeath();
  outfit(g);
  g.transitionToMap('arena_ring');
  g.stepSim(5);
  die(g);
  assert.equal(g.wreck.arenaId, 'arena_ring');
  g.respawnFromDeath();
  outfit(g);
  g.transitionToMap('arena_pocket');
  g.stepSim(5);
  die(g);
  assert.equal(g.wreck.arenaId, 'arena_pocket', 'the ring wreck was replaced, not stacked');
});

test('a death in the HUB leaves a wreck there, in the persistent world', () => {
  const storage = new MemoryStorage();
  const { g } = launch(storage);
  outfit(g);
  g.stepSim(5);
  g.player.position = { x: g.player.position.x + 900, y: g.player.position.y + 900 };
  const at = { ...g.player.position };
  die(g);
  assert.equal(g.wreck.arenaId, 'overworld');
  assert.equal(g.wreck.seed, null, 'the hub carries no seed');
  g.respawnFromDeath();
  const e = g.wreckEntity;
  assert.ok(e && e.active, 'the wreck stays in the hub after the respawn');
  assert.ok(Math.hypot(e.position.x - at.x, e.position.y - at.y) < 50);
  g.player.position = { x: e.position.x, y: e.position.y };
  g.stepSim(3);
  assert.equal(g.wreck, null);
  assert.equal(mounted(g.shipSlots).length, 0, 'recovery installs nothing');
  assert.ok(g.inventory.some(Boolean), 'the gear is in cargo');
});

test('records: deaths and bests persist, and the summary reports a new best', () => {
  const storage = new MemoryStorage();
  const a = launch(storage);
  a.g.score = 5000;
  a.g.stepSim(3);
  die(a.g);
  assert.equal(a.g.runSummarySnapshot().records.newHighScore, true);
  assert.equal(a.g.records.highScore, 5000);
  const b = launch(storage);
  assert.equal(b.g.records.highScore, 5000);
  assert.equal(b.g.records.deaths, 1);
  b.g.score = 100;
  die(b.g);
  assert.equal(b.g.runSummarySnapshot().records.newHighScore, false);
  assert.equal(b.g.records.highScore, 5000, 'a worse life does not lower the best');
});

test('Erase save is a brand-new start, settings kept', () => {
  const storage = new MemoryStorage();
  const a = launch(storage);
  outfit(a.g); a.g.credits = 99; a.g.records.deaths = 4;
  a.platform.audio.setVolume(0.2);
  a.g.eraseSave();
  const b = launch(storage);
  assert.equal(b.g.credits, 0);
  assert.equal(b.g.records.deaths, 0);
  assert.deepEqual(mounted(b.g.shipSlots), []);
  assert.equal(b.platform.audio.volume, 0.2);
});

test('the wreck\'s arena resumes the wave script where the ship fell; a second death or the boss dying resets it', () => {
  const storage = new MemoryStorage();
  const a = launch(storage);
  a.g.debugGrantModule('hull_mk2');
  a.g.transitionToMap('arena_pocket');
  a.g.stepSim(5);
  a.g.waves.waveIndex = 3;
  die(a.g);
  assert.equal(a.g.wreck.wave, 3, 'the record carries the wave');

  const b = launch(storage, { entropySeed: 9 });
  b.g.transitionToMap('arena_pocket');
  assert.equal(b.g.waves.waveIndex, 3, 'the arena resumes at the death wave');
  b.g.transitionToMap('arena_ring');
  assert.equal(b.g.waves.waveIndex, 0, 'another arena starts fresh');

  // The boss falling before the wreck is collected resets the script (the wreck stays).
  b.g.transitionToMap('arena_pocket');
  b.g.waves.halted = true;                       // a boss on the field halts the ladder
  noteBossDefeated(b.g);
  assert.equal(b.g.wreck.wave, 0);
  b.g.transitionToMap('arena_pocket');
  assert.equal(b.g.waves.waveIndex, 0);

  // A second death replaces the record with the new wave.
  b.g.waves.waveIndex = 1;
  die(b.g);
  assert.ok(b.g.lostWreckOnDeath, 'the death screen is told the older wreck is lost');
});

test('the way back to the wreck is lit: the wreck itself, else the rift toward it', () => {
  const a = launch(new MemoryStorage());
  a.g.debugGrantModule('hull_mk2');
  a.g.transitionToMap('arena_pocket');
  a.g.stepSim(5);
  a.g.player.position = { x: a.g.player.position.x + 900, y: a.g.player.position.y + 900 };
  die(a.g);
  a.g.respawnFromDeath();                      // hub: the rift to the wreck's arena
  a.g.stepSim(2);
  const lit = a.g.portals.filter((p: any) => p.wreckGuide);
  assert.equal(lit.length, 1);
  assert.equal(lit[0].portalTargetId, 'arena_pocket');
  a.g.transitionToMap('arena_pocket');         // in the arena: the wreck
  a.g.stepSim(2);
  assert.equal(a.g.wreckEntity.wreckGuide, true);
  a.g.transitionToMap('arena_ring');           // elsewhere: the way home
  a.g.stepSim(2);
  assert.equal(a.g.portals.filter((p: any) => p.wreckGuide).length, 1);
});

test('the held wave decays with real time away: whole for 5 minutes, then one wave an hour', () => {
  const storage = new MemoryStorage();
  const a = launch(storage);
  a.g.debugGrantModule('hull_mk2');
  a.g.transitionToMap('arena_pocket');
  a.g.stepSim(5);
  a.g.player.position = { x: a.g.player.position.x + 900, y: a.g.player.position.y + 900 };
  a.g.waves.waveIndex = 3;
  die(a.g);
  a.g.respawnFromDeath();
  const waveAfter = (ms: number) => {
    const b = launch(storage, { entropySeed: 5 });
    b.platform.clock.advance(ms);
    b.g.transitionToMap('arena_pocket');
    return b.g.waves.waveIndex;
  };
  const MIN = 60_000, HOUR = 60 * MIN;
  assert.equal(waveAfter(4 * MIN), 3, 'an accidental exit and a quick return find the same wave');
  assert.equal(waveAfter(30 * MIN), 3, 'held until the first hour is up');
  assert.equal(waveAfter(HOUR + MIN), 2, 'one wave off after an hour');
  assert.equal(waveAfter(2 * HOUR + MIN), 1, 'two off after two hours');
  assert.equal(waveAfter(9 * HOUR), 0, 'and a fresh start once it has run out');
});

test('leaving the wreck\'s arena by portal stamps the wave and the time, so a quick return resumes there', () => {
  const storage = new MemoryStorage();
  const a = launch(storage);
  a.g.debugGrantModule('hull_mk2');
  a.g.transitionToMap('arena_pocket');
  a.g.stepSim(5);
  a.g.player.position = { x: a.g.player.position.x + 900, y: a.g.player.position.y + 900 };
  die(a.g);
  a.g.respawnFromDeath();
  a.g.transitionToMap('arena_pocket');           // back, wave 0, wreck not yet reached
  a.g.waves.waveIndex = 2;
  a.platform.clock.advance(30 * 60_000);
  a.g.stepSim(1);
  a.g.saveNow();                                  // autosave while present
  assert.equal(a.g.wreck.wave, 2);
  a.g.transitionToMap('overworld');
  a.platform.clock.advance(2 * 60_000);
  a.g.transitionToMap('arena_pocket');
  assert.equal(a.g.waves.waveIndex, 2, 'two minutes later it is the same wave');
});
