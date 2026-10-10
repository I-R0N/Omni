/** The sound system as shipped: the recorded banks decode with full id
 *  coverage, the mix controls and voice budget hold, and the adaptive score
 *  follows the fight.  Plus two contracts that used to live in an ungated
 *  smoke script, here so the merge gate runs them: docs/SFX_INVENTORY.md and
 *  the registry name the SAME ids, and audio survives what iOS does to a web
 *  page (the ring switch, interruptions, backgrounding).
 *
 *  Everything drives the real AudioSystem through `window.__omniEngine`.  The
 *  only things stood in for are the ones a headless Chromium cannot produce:
 *  an 'interrupted' context, a hidden tab, and `navigator.audioSession`. */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { advanceSim, boot, engine, quietScene, startRun, waitForStats, waitForTransit } from './helpers';

/* THE INVENTORY IS THE CONTRACT (CLAUDE.md §8: adding a sound means adding its
 * row first), so it and the registry must agree in BOTH directions: a
 * registered id with no row is a sound nobody specified, and a row nothing
 * registers is a spec for a sound that never plays.  A documented id is a
 * table row whose first cell is a backticked id, wherever in the document the
 * table sits. */
test('every registered sound has an inventory row, and every row is registered', async ({ page }, testInfo) => {
  const doc = readFileSync(resolve(dirname(testInfo.file), '../docs/SFX_INVENTORY.md'), 'utf8');
  const documented = [...new Set(
    Array.from(doc.matchAll(/^\|\s*`([a-z]+(?:\.[a-z0-9]+)+)`\s*\|/gm), m => m[1]),
  )];
  expect(documented.length, 'the inventory tables parsed').toBeGreaterThan(70);

  const watch = await boot(page);
  const registered: string[] = await engine(page, e => e.audio.allIds);
  expect(registered.filter(id => !documented.includes(id)), 'registered ids with no inventory row')
    .toEqual([]);
  expect(documented.filter(id => !registered.includes(id)), 'inventory rows naming no registered id')
    .toEqual([]);
  watch.assertClean();
});

test('all cinematic cues decode with full coverage and bounded memory', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await page.waitForFunction(() => window.__omniEngine.audio.prepared, null, { timeout: 90000 });
  // The banks decode LAZILY now (one family per first use), and this test's
  // claim is about the WHOLE manifest — every take decodes, carries signal
  // and fits the ceiling — so it asks for all four.  The claim is unchanged;
  // only what triggers the decode moved.  The laziness itself is pinned by
  // 'the banks decode lazily' below.
  await page.evaluate(() => window.__omniEngine.audio.decodeAllBanks());
  const result = await engine(page, e => {
    const a = e.audio;
    const bad: string[] = [];
    let bytes = 0;
    for (const [id, set] of a.samples) {
      if (set.bufs.length !== (a.loopIds.includes(id) ? 1 : 3)) bad.push(id + ': missing variants');
      for (const buf of set.bufs) {
        const data = buf.getChannelData(0);
        let peak = 0;
        for (const sample of data) {
          if (!Number.isFinite(sample)) bad.push(id + ': nonfinite');
          peak = Math.max(peak, Math.abs(sample));
        }
        if (peak < 0.001 || buf.duration > 4.1) bad.push(id + ': signal/duration');
        bytes += data.byteLength;
      }
    }
    return { bad, bytes, recorded: a.sampleCount, rejected: a.rejectedSampleCount,
      unmatched: a.unmatchedFiles, cached: a.synthesized.size, oneShots: a.defs.size,
      sampled: a.sampledIds.filter((id: string) => a.defs.has(id)).length, failures: a.bankFailures, total: a.allIds.length, covered: a.sampledIds.length };
  });
  expect(result.bad).toEqual([]);
  expect(result.failures).toEqual([]);
  expect(result.recorded).toBe(304);
  expect(result.covered).toBe(result.total);
  expect(result.rejected).toBe(0);
  expect(result.unmatched).toEqual([]);
  expect(result.cached + result.sampled).toBe(result.oneShots);
  expect(result.bytes).toBeLessThan(96 * 1024 * 1024);
  watch.assertClean();
});

test('the banks decode lazily, and the title screen holds one of them', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await page.waitForFunction(() => window.__omniEngine.audio.prepared, null, { timeout: 90000 });

  // THE TITLE SCREEN HOLDS THE MENU BANK AND NOTHING ELSE.  All four used to
  // decode at unlock; measured, that was ~62 MB of cue buffers before the
  // player had pressed START.
  const menu = await engine(page, e => ({
    mb: e.audio.decodedBankBytes / 1048576,
    takes: e.audio.sampleCount,
    failures: e.audio.bankFailures,
    // The menu's own cue is decoded — this screen's sounds must be heard.
    ui: e.audio.hasSample('ui.confirm'),
    // A combat cue is NOT, and it is not standing on a WAV or a pre-rendered
    // procedural cache either: `BANK_OF_ID` keeps both fallbacks off a bank
    // id, so lazy decoding cannot cost more memory than it saves.
    impact: e.audio.hasSample('impact.tile.rock'),
  }));
  expect(menu.failures).toEqual([]);
  expect(menu.ui).toBe(true);
  expect(menu.impact).toBe(false);
  expect(menu.mb).toBeLessThan(12);

  // ASKING FOR A CUE STARTS ITS BANK, and the asking trigger does not wait:
  // play() returns having only kicked the decode off, so no decode lands in
  // the frame (CLAUDE.md §8).  The draft voice covers that trigger.
  await engine(page, e => { e.audio.setActive(true); e.audio.play('impact.tile.rock'); });
  await page.waitForFunction(() => window.__omniEngine.audio.hasSample('impact.tile.rock'),
                             null, { timeout: 60000 });
  const after = await engine(page, e => ({
    mb: e.audio.decodedBankBytes / 1048576,
    takes: e.audio.sampleCount,
    failures: e.audio.bankFailures,
    // Still lazy: one more bank arrived, not all of them.
    weapon: e.audio.hasSample('weapon.cannon.fire'),
  }));
  expect(after.failures).toEqual([]);
  expect(after.takes).toBeGreaterThan(menu.takes);
  expect(after.mb).toBeGreaterThan(menu.mb);
  expect(after.weapon).toBe(false);

  // And the whole manifest is still reachable on demand.
  await page.evaluate(() => window.__omniEngine.audio.decodeAllBanks());
  expect(await engine(page, e => e.audio.sampleCount)).toBe(304);
  expect(await engine(page, e => e.audio.bankFailures)).toEqual([]);
  watch.assertClean();
});

test('mix controls, variation inspection, torus pan and pause cleanup', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page);
  await page.evaluate(() => window.__omniEngine.audio.decodeAllBanks());
  await page.waitForFunction(() => window.__omniEngine.audio.sampleCount === 304);
  const result = await engine(page, e => {
    const a = e.audio;
    a.stopScene(true); a.setActive(true); a.setListener(100, 100);
    a.setSfxVolume(0.35); a.setMusicVolume(0.2); a.setVolume(0.6);
    a.setVolume(NaN);
    const set = a.samples.get('weapon.blaster.fire');
    const before = set.next;
    for (let i = 0; i < 20; i++) { a.hasSample('weapon.blaster.fire'); void a.sampledIds; }
    const after = set.next;
    let repeats = 0; let previous = null;
    for (let i = 0; i < 30; i++) { const take = a.takeSample('weapon.blaster.fire'); if (take === previous) repeats++; previous = take; }
    a.play('impact.tile.rock', { x: 200, y: 100 });
    const right = [...a.live][0].tail.pan.value;
    a.stopScene(true);
    a.play('impact.tile.rock', { x: 0, y: 100 });
    const left = [...a.live][0].tail.pan.value;
    // ACROSS THE SEAM: 200 units to the listener's left through the wrap,
    // where a naive `x - lx` puts the source a whole map to the right and
    // out of earshot.
    a.stopScene(true);
    a.play('impact.tile.rock', { x: e.currentMap.width - 100, y: 100 });
    const seamVoice = [...a.live][0];
    const seam = seamVoice ? seamVoice.tail.pan.value : null;
    a.loop('move.thrust', true, { param: 0.7 });
    a.setActive(false);
    const stopped = a.liveVoices === 0 && a.liveLoops === 0;
    const count = a.counts.played;
    a.play('weapon.charge.ready');
    const suppressed = a.counts.played === count;
    a.play('ui.confirm');
    const ui = a.counts.played === count + 1;
    a.setMuted(true);
    return { before, after, repeats, right, left, seam, stopped, suppressed, ui,
      mutedVoices: a.liveVoices, volume: a.volume, sfx: a.sfxVolume, music: a.musicVolume };
  });
  expect(result.before).toBe(result.after);
  expect(result.repeats).toBe(0);
  expect(result.right).toBeGreaterThan(0);
  expect(result.left).toBeLessThan(0);
  expect(result.seam, 'a source just across the seam is heard').not.toBeNull();
  expect(result.seam!, 'and pans to the side it is really on').toBeLessThan(0);
  expect(result.stopped && result.suppressed && result.ui).toBeTruthy();
  expect(result.mutedVoices).toBe(0);
  expect([result.volume, result.sfx, result.music]).toEqual([0.6, 0.35, 0.2]);
  await engine(page, e => { e.audio.setMuted(false); e.pauseGame(); });
  const music = page.getByRole('slider', { name: 'Music volume', exact: true });
  await expect(music).toBeVisible();
  await expect(page.getByRole('slider', { name: 'SFX volume', exact: true })).toBeVisible();
  await music.focus();
  await music.press('Home');
  await expect.poll(() => engine(page, e => e.audio.musicVolume)).toBe(0);
  watch.assertClean();
});

test('burst load stays bounded and critical player feedback displaces background', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page);
  const result = await engine(page, e => {
    const a = e.audio;
    a.stopScene(true); a.setActive(true); a.resetCounters(); a.setListener(0, 0);
    for (let i = 0; i < 400; i++) a.play('destroy.tile.rock', { x: 0, y: 0 });
    const burst = { voices: a.liveVoices, collapsed: a.counts.collapsed };
    const before = a.counts.collapsed;
    a.play('destroy.tile.rock', { x: 10, y: 0, near: 0, far: 1 });
    const distantDidNotBump = a.counts.collapsed === before;
    a.stopScene(true);
    // Fill the real graph to the hard cap without editing production defs.
    for (let i = 0; i < 24; i++) {
      a.register('test.' + i, { tier: 1, gain: 0.05, poly: 1, minInterval: 0,
        render: a.defs.get('destroy.enemy.standard').render });
      a.play('test.' + i);
    }
    // Mark one live voice as ambient to exercise stealing at a full ceiling.
    [...a.live][0].tier = 3;
    const count = a.playsOf('impact.hull.player');
    a.play('impact.hull.player');
    const critical = a.playsOf('impact.hull.player') === count + 1;
    const ceiling = a.liveVoices;
    a.stopScene(true);
    return { burst, distantDidNotBump, critical, ceiling, cleanup: a.liveVoices };
  });
  expect(result.burst.voices).toBe(1);
  expect(result.burst.collapsed).toBe(399);
  expect(result.distantDidNotBump).toBeTruthy();
  expect(result.critical).toBeTruthy();
  expect(result.ceiling).toBeLessThanOrEqual(24);
  expect(result.cleanup).toBe(0);
  watch.assertClean();
});

/* The inventory's TRIGGER column, spot-checked wherever a trigger is one
 * synchronous call: every gun fires its OWN voice, an outfit move refused
 * away from a drydock is audible, and each status effect sounds as it lands.
 * Then the NEAR-FIELD rule for shard breaks (CLAUDE.md §8): an ambient break
 * carries only a short way, the same id carries normally when the caller
 * widens it, and in real play the widening is `killedByPlayer` — a shard the
 * player broke is theirs to hear from across the screen. */
test('triggers fire their own ids, and ambient shard breaks stay near-field', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page);
  await page.waitForFunction(() => window.__omniEngine.audio.audible);
  const r = await engine(page, (e, guns: [string, string][]) => {
    const a = e.audio;
    a.stopScene(true); a.setActive(true); a.resetCounters();
    const px = e.player.position.x, py = e.player.position.y;
    a.setListener(px, py);

    const fired: Record<string, number> = {};
    const held = e.player.currentWeapon;
    for (const [type, id] of guns) {
      e.player.currentWeapon = type;
      e.player.weaponCooldown = 0;
      e.handleShooting({ x: window.innerWidth / 2 + 200, y: window.innerHeight / 2 });
      fired[id] = a.playsOf(id);
    }
    e.player.currentWeapon = held;
    const moved = e.moveModule({ area: 'inventory', idx: 0 }, { area: 'ship', idx: 1 });
    const reject = a.playsOf('poi.reject');
    e.debugApplyCorrosion();
    e.debugApplyDisable();

    // Manager layer: the def's own near-field range, then a caller override.
    // Two ids, because two real plays of one id in the same instant would
    // collapse into one voice — and a clean slate first, so the tier-3
    // ceiling cannot be what silences them.
    a.stopScene(true);
    a.play('destroy.shard.glass', { x: px + 1400, y: py });
    const far = a.playsOf('destroy.shard.glass');
    a.play('destroy.shard.glass', { x: px + 120, y: py });
    const near = a.playsOf('destroy.shard.glass');
    a.play('destroy.shard.metal', { x: px + 1400, y: py, near: 420, far: 2600 });
    const widened = a.playsOf('destroy.shard.metal');

    // Engine layer: the same distance, through the real death path.
    const shards = e.currentMap.entities.filter((x: any) =>
      x.active && x.shardVariant === 'rock-shard' && !x.deathDispatched).slice(0, 2);
    const kill = (sh: any, mine: boolean) => {
      sh.position.x = px + 1400; sh.position.y = py;
      sh.killedByPlayer = mine || undefined;
      sh.health = 0;
      e.handleEntityDeath(sh);
      return a.playsOf('destroy.shard.rock');
    };
    const ambient = shards.length === 2 ? kill(shards[0], false) : -1;
    const mine = shards.length === 2 ? kill(shards[1], true) : -1;
    return {
      fired, moved, reject,
      corrosion: a.playsOf('status.corrosion.apply'), disable: a.playsOf('status.disable.apply'),
      far, near, widened, shards: shards.length, ambient, mine,
    };
  }, [
    ['BLASTER', 'weapon.blaster.fire'], ['BURST', 'weapon.burst.fire'],
    ['SHOTGUN', 'weapon.shotgun.fire'], ['BOUNCER', 'weapon.bouncer.fire'],
    ['LIGHTNING', 'weapon.lightning.fire'], ['HOMING', 'weapon.homing.fire'],
    ['CANNON', 'weapon.cannon.fire'],
  ] as [string, string][]);

  for (const [id, n] of Object.entries(r.fired)) expect(n, `${id} from its own gun`).toBe(1);
  expect(Object.keys(r.fired)).toHaveLength(7);
  expect(r.moved, 'outfitting is refused away from a drydock').toBe(false);
  expect(r.reject, 'and the refusal is audible').toBe(1);
  expect(r.corrosion, 'corrosion sounds as it lands').toBe(1);
  expect(r.disable, 'and so does the EMP').toBe(1);

  expect(r.far, 'an ambient shard break is out of earshot at 1400').toBe(0);
  expect(r.near, 'the same break close by is heard').toBe(1);
  expect(r.widened, 'and a caller can widen the range back to normal').toBe(1);
  expect(r.shards, 'two mobile rock shards to break').toBe(2);
  expect(r.ambient, 'a distant shard nobody hit dies silently').toBe(0);
  expect(r.mine, 'the same death caused by the player carries').toBe(1);
  watch.assertClean();
});


/* THE ADAPTIVE SCORE (engine/systems/AdaptiveMusic.ts).  Six stems on one
 * clock; the game decides only how loud each is.  `battleActive` means the
 * GROOVE layer (kick, snare, bass) is in — the old "battle layer" contract,
 * kept under the same name so the portal/lull A/B below reads as before.
 * `jumps` counts cues back to bar 1, the score's only horizontal move. */
test('the score keeps its place through combat, pause, music volume and mute', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await page.waitForFunction(() => window.__omniEngine.audio.music?.playing);
  // The title screen fetches the exploration bed only.
  expect(await engine(page, e => e.audio.music.isLoaded('groove'))).toBeFalsy();
  await startRun(page);
  await page.waitForFunction(() => window.__omniEngine.audio.music.position > 0.2);
  await engine(page, e => e.audio.setCombat(true));
  await page.waitForFunction(() => window.__omniEngine.audio.music.battleActive
    && window.__omniEngine.audio.music.isLoaded('groove'), null, { timeout: 20000 });
  await expect.poll(() => engine(page, e => e.audio.music.layerGain('groove')),
    { timeout: 10000 }).toBeGreaterThan(0.5);
  const before = await engine(page, e => e.audio.music.position);
  await engine(page, e => { e.audio.setSfxVolume(0); e.pauseGame(); });
  // Paused: the combat layers leave, the bed plays on — and so does time.
  await expect.poll(() => engine(page, e => e.audio.music.battleActive)).toBeFalsy();
  await expect.poll(() => engine(page, e => e.audio.music.position)).not.toBe(before);
  await engine(page, e => e.audio.setMusicVolume(0));
  await page.waitForFunction(() => !window.__omniEngine.audio.music.playing);
  const heldAt = await engine(page, e => e.audio.music.position);
  // WALL time, deliberately: the game is paused, so sim time is not what
  // could move a stopped score — the audio clock is.
  await page.waitForTimeout(500);
  expect(await engine(page, e => e.audio.music.position), 'stopped means held').toBe(heldAt);
  await engine(page, e => e.audio.setMusicVolume(0.7));
  await page.waitForFunction(() => window.__omniEngine.audio.music.playing);
  const resumed = await engine(page, e => e.audio.music.position);
  expect(Math.abs(resumed - heldAt), 'resumes on the same beat, not from the top').toBeLessThan(0.5);
  await engine(page, e => e.audio.setMuted(true));
  await page.waitForFunction(() => !window.__omniEngine.audio.music.playing);
  expect(await engine(page, e => e.audio.music.error)).toBeNull();
  watch.assertClean();
});

test('intensity brings the layers in in order, and the stems stay in budget', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page);
  await page.waitForFunction(() => ['atmos', 'pulse', 'groove', 'heavy', 'apex']
    .every(id => window.__omniEngine.audio.music.isLoaded(id)), null, { timeout: 20000 });
  const steps: [number, string[]][] = [
    [0, ['atmos']],
    [0.25, ['atmos', 'pulse']],
    [0.45, ['atmos', 'pulse', 'groove']],
    [0.7, ['atmos', 'pulse', 'groove', 'heavy']],
    [0.9, ['atmos', 'pulse', 'groove', 'heavy', 'apex']],
  ];
  for (const [v, layers] of steps) {
    await engine(page, (e, x) => e.audio.setMusicDebugIntensity(x), v);
    expect(await engine(page, e => e.audio.music.activeLayers), `intensity ${v}`).toEqual(layers);
  }
  // Hysteresis: just under the groove's ON threshold but above its OFF one,
  // coming DOWN from 0.9, keeps the groove (and drops heavy and apex).
  await engine(page, e => e.audio.setMusicDebugIntensity(0.33));
  expect(await engine(page, e => e.audio.music.activeLayers)).toEqual(['atmos', 'pulse', 'groove']);
  await engine(page, e => e.audio.setMusicDebugIntensity(null));
  // Entries are quantised: the gain reaches the layer on a grid line, so a
  // freshly-entered layer is audible within a bar plus its fade.
  await engine(page, e => e.audio.setMusicDebugIntensity(0.9));
  await expect.poll(() => engine(page, e => e.audio.music.layerGain('apex')),
    { timeout: 4000 }).toBeGreaterThan(0.5);
  expect(await engine(page, e => e.audio.music.decodedBytes)).toBeLessThan(96 * 1024 * 1024);
  expect(await engine(page, e => e.audio.music.error)).toBeNull();
  // The song list comes from public/assets/audio/score/index.json (DATA,
  // maintained by `npm run music:import`), not from code.
  expect(await engine(page, e => e.audio.music.songList.map((s: { id: string }) => s.id)))
    .toEqual(expect.arrayContaining(['omni', 'event-horizon', 'critical-mass']));
  watch.assertClean();
});

// A lull only lowers the intensity.  The old playlist cut to a new song on
// every rising edge of the combat signal, which chopped a wave sequence into
// fragments; the score must never jump inside one encounter.
test('a lull lowers the intensity without moving the score', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page);
  await engine(page, e => e.audio.setCombat(true));
  await page.waitForFunction(() => window.__omniEngine.audio.music.battleActive, null, { timeout: 20000 });
  const jumps = await engine(page, e => e.audio.music.jumps);
  await engine(page, e => e.audio.setCombat(false));
  await expect.poll(() => engine(page, e => e.audio.music.battleActive), { timeout: 20000 }).toBeFalsy();
  await engine(page, e => e.audio.setCombat(true));
  await page.waitForFunction(() => window.__omniEngine.audio.music.battleActive);
  expect(await engine(page, e => e.audio.music.jumps), 'no cue back to bar 1').toBe(jumps);
  watch.assertClean();
});

// A capstone is a designed beat: the score returns to bar 1 with it, and the
// boss stem joins.
test('a boss warping in restarts the phrase and brings in the boss stem', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page);
  await page.waitForFunction(() => window.__omniEngine.audio.music.playing);
  const jumps = await engine(page, e => e.audio.music.jumps);
  await engine(page, e => e.debugSpawnBoss());
  expect(await engine(page, e => e.audio.music.jumps)).toBe(jumps + 1);
  await page.waitForFunction(() => window.__omniEngine.audio.music.isLayerOn('boss')
    && window.__omniEngine.audio.music.isLoaded('boss'), null, { timeout: 20000 });
  expect(await engine(page, e => e.audio.music.battleActive)).toBeTruthy();
  // The boss holds the stack up from the offscreen ring it arrived on: shove
  // it far past the release radius and the score stays engaged.
  await engine(page, e => {
    const boss = e.entityIndex.enemies.find((x: { isBoss?: boolean }) => x.isBoss === true);
    if (boss) { boss.position.x = e.player.position.x + 9000; boss.velocity.x = 0; boss.velocity.y = 0; }
  });
  await advanceSim(page, 1);
  expect(await engine(page, e => e.audio.music.battleActive)).toBeTruthy();
  expect(await engine(page, e => e.audio.music.isLayerOn('boss'))).toBeTruthy();
  watch.assertClean();
});

/* LEAVING THE AREA ENDS THE FIGHT — the combat layers must not follow you
 * through a portal (user report: "while fighting a boss, I left the arena to
 * the overworld and the battle music continued").  Read with the lull test
 * after it: same elapsed time, opposite outcomes, and the only difference is
 * whether the map changed.  The adaptive score adds a second way to get this
 * wrong — its intensity HOLD, which is exactly what carries a lull — so the
 * map cue drops intensity outright. */
test('a portal out of a boss fight stands the combat layers down', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page, 'POCKET');
  await waitForStats(page, s => s.currentMapType === 'POCKET', 'the arena');
  await engine(page, e => e.debugSpawnBoss());
  await page.waitForFunction(() => window.__omniEngine.audio.music.battleActive, null, { timeout: 20000 });
  await engine(page, e => e.transitionToMap('overworld'));
  await waitForTransit(page);
  await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');
  await advanceSim(page, 2);
  expect(await engine(page, e => e.audio.music.battleActive),
    'the combat layers follow the fight, not the player').toBeFalsy();
  expect(await engine(page, e => e.audio.music.isLayerOn('boss'))).toBeFalsy();
  expect(await engine(page, e => e.entityIndex.enemies.filter(
    (x: { isBoss?: boolean }) => x.isBoss === true).length)).toBe(0);
  // Arriving somewhere dangerous still engages.
  await engine(page, e => e.debugSpawnBoss());
  await page.waitForFunction(() => window.__omniEngine.audio.music.battleActive, null, { timeout: 20000 });
  watch.assertClean();
});

test('a new arena opens a new phrase', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page, 'POCKET');
  await waitForStats(page, s => s.currentMapType === 'POCKET', 'the arena');
  await page.waitForFunction(() => window.__omniEngine.audio.music.playing);
  const jumps = await engine(page, e => e.audio.music.jumps);
  await engine(page, e => e.transitionToMap('overworld'));
  await waitForTransit(page);
  await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');
  expect(await engine(page, e => e.audio.music.jumps), 'the map change cued bar 1').toBeGreaterThan(jumps);
  expect(await engine(page, e => e.audio.music.battleActive),
    'arriving somewhere quiet brings no drums').toBeFalsy();
  watch.assertClean();
});

// THE MUSIC DIRECTOR (MUSIC_PLAN in AdaptiveMusic).  Each area owns a theme —
// the hub and field_* maps Omni, arena_* maps Event Horizon — a boss brings
// in the boss theme (Critical Mass) with an impact, and its death plays the
// victory stinger and hands back to the area's theme.  A pin overrides all.
test('the director: area themes, a boss theme, a victory hand-back, and pins', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page, 'POCKET');
  await waitForStats(page, s => s.currentMapType === 'POCKET', 'the arena');
  const song = () => engine(page, e => e.audio.music.song.id);
  await expect.poll(song, { timeout: 20000 }).toBe('event-horizon');      // arena_pocket → battle theme
  expect(await engine(page, e => e.audio.music.area)).toBe('arena_pocket');

  await engine(page, e => e.transitionToMap('overworld'));
  await waitForTransit(page);
  await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');
  await expect.poll(song, { timeout: 20000 }).toBe('omni');               // home sounds like home

  await engine(page, e => e.debugSpawnBoss());
  await expect.poll(song, { timeout: 20000 }).toBe('critical-mass');      // the boss theme takes over
  expect(await engine(page, e => e.audio.music.lastStinger)).toBe('impact');
  await page.waitForFunction(() => window.__omniEngine.audio.music.isLayerOn('boss'), null, { timeout: 20000 });

  // The last boss dies: victory stinger, drums down, back to the area theme.
  await engine(page, e => {
    for (const x of e.entityIndex.enemies) if ((x as { isBoss?: boolean }).isBoss) (x as { active: boolean }).active = false;
    e.audio.musicBossDefeated();
  });
  expect(await engine(page, e => e.audio.music.lastStinger)).toBe('victory');
  await expect.poll(song, { timeout: 20000 }).toBe('omni');
  await expect.poll(() => engine(page, e => e.audio.music.battleActive), { timeout: 20000 }).toBeFalsy();

  // A pin overrides the plan, through a portal, and AUTO restores it.
  await engine(page, e => e.audio.music.setSongMode(1));
  await expect.poll(song, { timeout: 20000 }).toBe('event-horizon');
  await engine(page, e => e.transitionToMap('arena_pocket'));
  await waitForTransit(page);
  await waitForStats(page, s => s.currentMapType === 'POCKET', 'back in the arena');
  expect(await song()).toBe('event-horizon');
  await engine(page, e => e.audio.music.setSongMode(0));
  await expect.poll(song, { timeout: 20000 }).toBe('omni');
  await engine(page, e => e.audio.music.setSongMode('auto'));
  await expect.poll(song, { timeout: 20000 }).toBe('event-horizon');      // back to the plan for this arena
  // Two songs are resident only for the length of a decode.
  expect(await engine(page, e => e.audio.music.decodedBytes)).toBeLessThan(110 * 1024 * 1024);
  expect(await engine(page, e => e.audio.music.error)).toBeNull();
  watch.assertClean();
});

// The debug panel's song picker: AUTO plus one chip per song, the active one lit.
test('the debug panel picks a song directly, and AUTO hands it back to the plan', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page);
  await page.waitForFunction(() => window.__omniEngine.audio.music?.playing);
  await page.getByTestId('debug-launcher').click();
  await waitForStats(page, s => s.debugPanel?.open === true, 'the debug panel');
  await page.locator('[data-debug-group="perf"]').click();
  await page.locator('[data-debug-section="music"]').click();
  const row = page.locator('[data-debug-row="Play song"]');
  await row.scrollIntoViewIfNeeded();
  await expect(row.locator('button')).toHaveText(['Auto', 'Omni', 'Event Horizon', 'Critical Mass']);
  const song = () => engine(page, e => e.audio.music.song.id);
  expect(await engine(page, e => e.audio.music.songMode), 'starts on the plan').toBe('auto');

  for (const [label, id, idx] of [['Critical Mass', 'critical-mass', 2], ['Event Horizon', 'event-horizon', 1]] as const) {
    await row.locator('button', { hasText: label }).click();
    await expect.poll(song, { timeout: 20000 }).toBe(id);
    expect(await engine(page, e => e.audio.music.songMode), `${label} is pinned`).toBe(idx);
    await page.waitForFunction(i => window.__omniStats?.audio?.music?.songMode === i, idx);   // the panel's own readout
  }
  await row.locator('button', { hasText: 'Auto' }).click();
  expect(await engine(page, e => e.audio.music.songMode)).toBe('auto');
  await expect.poll(song, { timeout: 20000 }).toBe('omni');            // the hub's plan
  watch.assertClean();
});

test('a lull inside one arena still holds the combat layers up', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page, 'POCKET');
  await waitForStats(page, s => s.currentMapType === 'POCKET', 'the arena');
  await engine(page, e => e.debugSpawnBoss());
  await page.waitForFunction(() => window.__omniEngine.audio.music.battleActive, null, { timeout: 20000 });
  const jumps = await engine(page, e => e.audio.music.jumps);
  // Empty the field WITHOUT changing map — a wave clear, which is what the
  // linger and the hold are for.
  const cleared = await engine(page, e => {
    let n = 0;
    for (const x of e.currentMap.entities) {
      if (x.type === 'ENEMY' && x.active) { x.active = false; n++; }
    }
    return n;
  });
  expect(cleared, 'the field really had something in it').toBeGreaterThan(0);
  await advanceSim(page, 2);
  expect(await engine(page, e => e.entityIndex.enemies.filter(
    (x: { isBoss?: boolean }) => x.isBoss === true).length)).toBe(0);
  expect(await engine(page, e => e.audio.music.battleActive),
    'a lull ducks nothing — the next wave is seconds away').toBeTruthy();
  expect(await engine(page, e => e.audio.music.jumps), 'and does not restart the phrase').toBe(jumps);
  watch.assertClean();
});

test('long player tails do not suppress the next attack', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await page.waitForFunction(() => window.__omniEngine.audio.prepared);
  // Reads a weapons-bank take directly, so it needs that bank decoded.
  await page.evaluate(() => window.__omniEngine.audio.decodeAllBanks());
  await startRun(page);
  const result = await engine(page, async e => {
    const a = e.audio;
    a.stopScene(true); a.setActive(true);
    const id = 'weapon.cannon.fire';
    const duration = a.samples.get(id).bufs[0].duration;
    const before = a.playsOf(id);
    // Real event cadence: a long 2.3s cannon tail must not block a later shot.
    for (let i = 0; i < 4; i++) {
      a.play(id);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    return { duration, played: a.playsOf(id) - before, voices: a.liveVoicesOf(id) };
  });
  expect(result.duration).toBeGreaterThan(2);
  expect(result.played).toBe(4);
  expect(result.voices).toBeLessThanOrEqual(2);
  watch.assertClean();
});

/* iOS RECOVERY.  Chromium cannot reproduce an iPhone, but every half of the
 * recovery that is not the device itself can be pinned.  Nothing exists
 * before the first gesture, and that gesture claims the "playback" audio
 * session (Safari puts WebAudio in "ambient", which the ring switch silences;
 * 16.4+ has `navigator.audioSession` for this, stood in for here).  A context
 * that stops running comes back on the NEXT gesture — the listeners are
 * deliberately not `once`, because iOS suspends or interrupts a context for
 * reasons the page never sees — and iOS's non-standard 'interrupted' state is
 * resumed like 'suspended'.  Hiding the tab suspends; returning re-unlocks. */
test('iOS recovery: silent until a gesture, then any later gesture or tab return revives it', async ({ page }) => {
  await page.addInitScript(() => {
    const session = { type: 'auto' };
    Object.defineProperty(Navigator.prototype, 'audioSession', { configurable: true, get: () => session });
  });
  const watch = await boot(page);
  expect(await engine(page, e => e.audio.contextState), 'no context before a gesture').toBeNull();
  expect(await engine(page, e => e.audio.audible)).toBe(false);

  await page.mouse.click(5, 5);
  await page.waitForFunction(() => window.__omniEngine.audio.audible);
  const session = await page.evaluate(() => ({
    type: (navigator as any).audioSession.type,
    shims: Array.from(document.querySelectorAll('audio'))
      .filter(el => el.src.startsWith('data:audio/wav')).length,
  }));
  expect(session.type, 'the first gesture claims the playback session').toBe('playback');
  expect(session.shims, 'so the silent-element fallback is not needed').toBe(0);

  // Stopped from outside, as a phone call or Siri does.  Nothing brings it
  // back on its own — wall time passing IS the assertion here (rule 1).
  await engine(page, async e => { await e.audio.ctx.suspend(); });
  await page.waitForTimeout(300);
  expect(await engine(page, e => e.audio.contextState)).toBe('suspended');
  await page.mouse.click(5, 5);
  await page.waitForFunction(() => window.__omniEngine.audio.audible);

  // Chromium never enters 'interrupted', so the state is stood in for and
  // the resume counted.
  const resumes = await engine(page, e => {
    const ctx = e.audio.ctx;
    const real = ctx.resume;
    let n = 0;
    Object.defineProperty(ctx, 'state', { configurable: true, get: () => 'interrupted' });
    ctx.resume = () => { n++; return real.call(ctx); };
    e.audio.unlock();
    delete ctx.state;
    delete ctx.resume;
    return n;
  });
  expect(resumes, "an 'interrupted' context is resumed, not only a 'suspended' one").toBe(1);

  // Backgrounding: a hidden tab suspends the context, and coming back
  // re-unlocks it with no gesture at all.
  await engine(page, () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => engine(page, e => e.audio.contextState)).toBe('suspended');
  await engine(page, () => {
    delete (document as any).hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => window.__omniEngine.audio.audible);
  watch.assertClean();
});

/* The OTHER half of the ring switch: pre-16.4 iOS has no
 * `navigator.audioSession`, and the only lever there is a side effect — a
 * playing <audio> element promotes the page's session.  It must be IN the
 * document, or iOS ignores it, and it must be a real, decodable file, because
 * a malformed one is worse than none.  Forced absent, so Chromium takes this
 * branch whatever it ships. */
test('iOS ring switch: without navigator.audioSession, a silent <audio> in the document claims playback', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(
    Navigator.prototype, 'audioSession', { configurable: true, get: () => undefined }));
  const watch = await boot(page);
  const shims = () => page.evaluate(() => Array.from(document.querySelectorAll('audio'))
    .filter(el => el.src.startsWith('data:audio/wav')).length);
  expect(await shims(), 'nothing before a gesture').toBe(0);

  await page.mouse.click(5, 5);
  await page.waitForFunction(() => window.__omniEngine.audio.audible);
  const shim = await page.evaluate(async () => {
    const el = Array.from(document.querySelectorAll('audio'))
      .find(a => a.src.startsWith('data:audio/wav'));
    if (!el) return null;
    return {
      inDocument: el.isConnected,
      playsinline: el.hasAttribute('playsinline'),
      loop: el.loop,
      volume: el.volume,
      decodes: await new Promise<boolean>(done => {
        const probe = new Audio(el.src);
        probe.addEventListener('loadedmetadata', () => done(true), { once: true });
        probe.addEventListener('error', () => done(false), { once: true });
        setTimeout(() => done(false), 5000);
      }),
    };
  });
  expect(shim, 'the gesture put a session element on the page').not.toBeNull();
  expect(shim!.inDocument, 'IN the document, not detached').toBe(true);
  expect(shim!.playsinline && shim!.loop, 'inline and looping').toBe(true);
  expect(shim!.volume, 'inaudible').toBeLessThanOrEqual(0.01);
  expect(shim!.volume, 'but not zero, which can be optimised away').toBeGreaterThan(0);
  expect(shim!.decodes, 'a real, decodable WAV').toBe(true);
  expect(await shims(), 'and only one').toBe(1);
  watch.assertClean();
});


/* LAYER VARIANTS (AdaptiveMusic: alternative stems per slot, picked by
 * context tags and enemy family, switched only on phrase boundaries).  These
 * test the LOGIC, not the sound: an injected score index gives Omni variants
 * whose files are stood in by routing each request to a stem Omni already has,
 * so nothing is added under public/.  Phrases are shortened to bars so a
 * boundary arrives every couple of seconds. */
type VariantList = Record<string, { name: string; when: string[] }[]>;
const FIXTURE_VARIANTS: VariantList = {
  atmos: [
    { name: 'station', when: ['station', 'portal'] },
    { name: 'deep', when: ['deep-space'] },
    { name: 'treasure', when: ['rare-item'] },
    { name: 'danger', when: ['danger'] },
  ],
  pulse: [{ name: 'swarm', when: ['enemy:swarm'] }, { name: 'heavy', when: ['enemy:heavy'] }],
  heavy: [{ name: 'swarm', when: ['enemy:swarm'] }, { name: 'heavy', when: ['enemy:heavy'] }],
};
const STAND_INS = ['pulse', 'groove', 'heavy', 'apex'];

async function withVariants(page: Page, opts: { phraseBars?: number; variants?: VariantList; missing?: string[] } = {}) {
  const index = JSON.parse(readFileSync(resolve('public/assets/audio/score/index.json'), 'utf8'));
  const omni = index.songs.find((x: { id: string }) => x.id === 'omni');
  omni.phraseBars = opts.phraseBars ?? 1;
  omni.variants = opts.variants ?? FIXTURE_VARIANTS;
  await page.addInitScript((i) => { (window as unknown as { __omniScoreIndex: unknown }).__omniScoreIndex = i; }, index);
  let n = 0;
  const seen = new Map<string, string>();
  await page.route('**/assets/audio/score/omni/*-*.mp3', route => {
    const m = /omni\/([a-z]+)-([a-z0-9-]+)\.mp3/.exec(route.request().url());
    if (!m) return route.fallback();
    if (opts.missing?.includes(m[2])) return route.fulfill({ status: 404, body: '' });
    if (!seen.has(m[0])) seen.set(m[0], STAND_INS[n++ % STAND_INS.length]);
    return route.fulfill({ path: resolve(`public/assets/audio/score/omni/${seen.get(m[0])}.mp3`), contentType: 'audio/mpeg' });
  });
}

/** Take over the context feed: the engine's own scan stops, and the test
 *  hands the score exactly the tags and family weights it wants. */
async function driveContext(page: Page) {
  await engine(page, e => { (e as unknown as { reportMusicContext: () => void }).reportMusicContext = () => {}; });
}
const setCtx = (page: Page, tags: string[], families: Record<string, number> = {}) =>
  engine(page, (e, a) => e.audio.music.setContext({ tags: a.tags, warm: [], families: a.families }), { tags, families });
const variantOf = (page: Page, slot: string) => engine(page, (e, sl) => e.audio.music.activeVariant(sl), slot);

async function startOmni(page: Page) {
  const watch = await boot(page);
  // Before the run starts: otherwise the real scan reports the home station
  // beside the spawn and a `station` switch is already under way.
  await driveContext(page);
  await page.mouse.click(5, 5);
  await page.waitForFunction(() => window.__omniEngine.audio.music);
  await setCtx(page, []);
  await startRun(page);
  await page.waitForFunction(() => window.__omniEngine.audio.music?.playing
    && window.__omniEngine.audio.music.song.id === 'omni' && window.__omniEngine.audio.music.isLoaded('atmos'),
    null, { timeout: 30000 });
  return watch;
}

test('layer variants: a context picks the atmos variant, and it lands on a phrase boundary', async ({ page }) => {
  await withVariants(page, { phraseBars: 2 });
  const watch = await startOmni(page);
  expect(await variantOf(page, 'atmos'), 'no context, no variant').toBe('default');
  await engine(page, e => e.audio.music.setForcedContext('station'));
  expect(await variantOf(page, 'atmos'), 'a change never lands mid-phrase: it is still the default now').toBe('default');
  await page.waitForFunction(() => window.__omniEngine.audio.music.activeVariant('atmos') === 'station',
    null, { timeout: 30000, polling: 'raf' });
  const phase = await engine(page, e => {
    const m = e.audio.music;
    const phrase = m.barSec * 2;
    return { sinceBoundary: m.position % phrase, phrase };
  });
  expect(phase.sinceBoundary < 0.4 || phase.sinceBoundary > phase.phrase - 0.1,
    `landed ${phase.sinceBoundary.toFixed(2)} s into a ${phase.phrase.toFixed(2)} s phrase`).toBe(true);
  expect(await engine(page, e => e.audio.music.variantMap)).toEqual({ atmos: 'station', pulse: 'default', heavy: 'default' });
  expect(await engine(page, e => e.audio.music.contexts)).toContain('station');
  // The default stem is untouched and every variant plays in phase: the same
  // loop position serves all of them (one clock), so there is one `position`.
  expect(await engine(page, e => e.audio.music.error)).toBeNull();
  watch.assertClean();
});

test('layer variants: the highest-priority context wins, and a tag with no variant is passed over', async ({ page }) => {
  await withVariants(page, {
    variants: { atmos: [{ name: 'station', when: ['station'] }, { name: 'danger', when: ['danger'] }, { name: 'deep', when: ['deep-space'] }] },
  });
  const watch = await startOmni(page);
  await setCtx(page, ['station', 'danger']);
  await page.waitForFunction(() => window.__omniEngine.audio.music.activeVariant('atmos') !== 'default',
    null, { timeout: 30000, polling: 'raf' });
  expect(await variantOf(page, 'atmos'), 'danger outranks station').toBe('danger');
  // `portal` is active but no atmos variant claims it: the next tag it does claim.
  await setCtx(page, ['portal', 'station']);
  await page.waitForFunction(() => window.__omniEngine.audio.music.activeVariant('atmos') === 'station',
    null, { timeout: 30000, polling: 'raf' });
  watch.assertClean();
});

test('layer variants: a flickering context cannot change a slot more than once per dwell', async ({ page }) => {
  await withVariants(page);
  const watch = await startOmni(page);
  await setCtx(page, ['station']);
  await page.waitForFunction(() => window.__omniEngine.audio.music.activeVariant('atmos') === 'station',
    null, { timeout: 30000, polling: 'raf' });
  const dwellSec = await engine(page, e => e.audio.music.barSec * 1 * 2);   // phraseBars 1 × MUSIC_VARIANT_DWELL_PHRASES 2
  // Flip the context every 250 ms for ~9 s, logging when the sounding variant changes.
  const log = await page.evaluate(({ ms }) => new Promise<{ t: number; v: string }[]>(done => {
    const e = window.__omniEngine;
    const out: { t: number; v: string }[] = [];
    let last = e.audio.music.activeVariant('atmos'), flip = false;
    const t0 = performance.now();
    const poll = setInterval(() => {
      const v = e.audio.music.activeVariant('atmos');
      if (v !== last) { out.push({ t: (performance.now() - t0) / 1000, v }); last = v; }
    }, 20);
    const toggle = setInterval(() => {
      flip = !flip;
      e.audio.music.setContext({ tags: flip ? ['danger'] : ['station'], warm: [], families: {} });
    }, 250);
    setTimeout(() => { clearInterval(poll); clearInterval(toggle); done(out); }, ms);
  }), { ms: 9000 });
  expect(log.length, 'the music did move at all').toBeGreaterThan(0);
  for (let i = 1; i < log.length; i++) {
    expect(log[i].t - log[i - 1].t, `change ${i} came ${(log[i].t - log[i - 1].t).toFixed(2)} s after the last`)
      .toBeGreaterThanOrEqual(dwellSec - 0.4);
  }
  expect(log.length, 'at most one change per dwell window').toBeLessThanOrEqual(Math.ceil(9 / dwellSec) + 1);
  watch.assertClean();
});

test('layer variants: a combat slot picks its variant from the dominant family and keeps it through a short change', async ({ page }) => {
  await withVariants(page);
  const watch = await startOmni(page);
  await page.waitForFunction(() => ['pulse', 'groove', 'heavy'].every(id => window.__omniEngine.audio.music.isLoaded(id)),
    null, { timeout: 30000 });
  await setCtx(page, [], { swarm: 2 });
  expect(await engine(page, e => e.audio.music.dominantFamily)).toBe('swarm');
  expect(await engine(page, e => e.audio.music.contexts)).toContain('enemy:swarm');
  await engine(page, e => e.audio.setMusicDebugIntensity(0.5));
  expect(await engine(page, e => e.audio.music.isLayerOn('pulse'))).toBe(true);
  // The slot ENTERED under swarm: it takes the swarm variant (as soon as it is decoded) and locks.
  await page.waitForFunction(() => window.__omniEngine.audio.music.activeVariant('pulse') === 'swarm',
    null, { timeout: 30000, polling: 'raf' });
  // A family change shorter than a phrase (1 bar here) does not move it.
  await setCtx(page, [], { swarm: 1, heavy: 3 });
  await page.waitForTimeout(900);
  await setCtx(page, [], { swarm: 2 });
  await page.waitForTimeout(5000);                                   // several boundaries later
  expect(await variantOf(page, 'pulse'), 'locked through a short change').toBe('swarm');
  // One that outlasts a whole phrase does.
  await setCtx(page, [], { swarm: 1, heavy: 3 });
  await page.waitForFunction(() => window.__omniEngine.audio.music.activeVariant('pulse') === 'heavy',
    null, { timeout: 40000, polling: 'raf' });
  expect(await variantOf(page, 'pulse')).toBe('heavy');
  expect(await engine(page, e => e.audio.music.error)).toBeNull();
  watch.assertClean();
});

test('layer variants: missing variant files fall back to the default, with no error', async ({ page }) => {
  await withVariants(page, { missing: ['treasure'] });
  const watch = await startOmni(page);
  await setCtx(page, ['rare-item']);
  await page.waitForTimeout(6000);                                   // several boundaries, plenty to fetch and fail
  expect(await variantOf(page, 'atmos')).toBe('default');
  expect(await engine(page, e => e.audio.music.error), 'optional, like the riser').toBeNull();
  expect(await engine(page, e => e.audio.music.playing)).toBe(true);
  // Another context still works afterwards.
  await setCtx(page, ['danger']);
  await page.waitForFunction(() => window.__omniEngine.audio.music.activeVariant('atmos') === 'danger',
    null, { timeout: 30000, polling: 'raf' });
  // The browser itself logs the 404 of the file that is not there; that is the
  // one console line this scenario is allowed.
  expect(watch.errors.filter(m => !/status of 404/.test(m)), 'nothing else on the console').toEqual([]);
});

test('layer variants: the decoded budget holds through several contexts', async ({ page }) => {
  await withVariants(page);
  const watch = await startOmni(page);
  // Measure with the whole default set decoded (the combat stems and one-shots
  // arrive in the background after the run starts).
  await page.waitForFunction(() => ['pulse', 'groove', 'heavy', 'apex', 'riser', 'victory', 'impact']
    .every(id => window.__omniEngine.audio.music.isLoaded(id)), null, { timeout: 30000 });
  const base = await engine(page, e => e.audio.music.decodedBytes);
  // Room for the defaults plus two of the LARGEST stand-in stems (one sounding, one arriving).
  const biggest = await engine(page, e => Math.max(...[...(e.audio.music as unknown as { buffers: Map<string, AudioBuffer> }).buffers.values()]
    .map(b => b.length * b.numberOfChannels * 4)));
  const budgetMB = (base + 2 * biggest) / (1024 * 1024);
  await engine(page, (e, mb) => e.audio.music.setDecodeBudgetMB(mb), budgetMB);
  const peak: number[] = [];
  for (const [tag, variant] of [['station', 'station'], ['deep-space', 'deep'], ['rare-item', 'treasure'], ['danger', 'danger']]) {
    await setCtx(page, [tag]);
    await page.waitForFunction(v => window.__omniEngine.audio.music.activeVariant('atmos') === v, variant,
      { timeout: 40000, polling: 'raf' });
    peak.push(await engine(page, e => e.audio.music.decodedBytes));
  }
  for (const b of peak) expect(b / (1024 * 1024), 'inside the budget at every step').toBeLessThanOrEqual(budgetMB + 0.01);
  expect(await engine(page, e => (e.audio.music as unknown as { vcache: Map<string, unknown> }).vcache.size),
    'four variants were used but not all four stay resident').toBeLessThan(4);
  expect(await engine(page, e => e.audio.music.decodedBytes)).toBeLessThan(110 * 1024 * 1024);
  expect(await engine(page, e => e.audio.music.error)).toBeNull();
  watch.assertClean();
});

test('layer variants: a song with none declared behaves as before and fetches nothing extra', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', r => { if (/score\/[a-z-]+\/(atmos|pulse|groove|heavy|apex|boss)-[a-z0-9-]+\.mp3/.test(r.url())) asked.push(r.url()); });
  // Omni ships atmos variants now, so the shipped index is no longer a song
  // with none declared: strip them, and the files on disk must go unasked for.
  const index = JSON.parse(readFileSync(resolve('public/assets/audio/score/index.json'), 'utf8'));
  for (const song of index.songs) { delete song.variants; delete song.contextPriority; }
  await page.addInitScript((i) => { (window as unknown as { __omniScoreIndex: unknown }).__omniScoreIndex = i; }, index);
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page);
  await page.waitForFunction(() => window.__omniEngine.audio.music?.playing && window.__omniEngine.audio.music.isLoaded('atmos'));
  await engine(page, e => e.audio.music.setForcedContext('station'));
  await engine(page, e => e.audio.setMusicDebugIntensity(0.9));
  await page.waitForTimeout(3000);
  expect(await engine(page, e => e.audio.music.variantMap), 'nothing declared, nothing reported').toEqual({});
  expect(await variantOf(page, 'atmos')).toBe('default');
  expect(await engine(page, e => e.audio.music.variantChanges)).toBe(0);
  expect(asked, 'no variant file was ever requested').toEqual([]);
  expect(await engine(page, e => e.audio.music.error)).toBeNull();
  watch.assertClean();
});

test('layer variants: the engine reports the player at a station, and deep space only after the dwell', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page);
  await advanceSim(page, 0.5);
  // The hub spawns the ship beside the home station.
  await page.waitForFunction(() => window.__omniEngine.audio.music?.contexts.includes('station'), null, { timeout: 15000 });
  expect(await engine(page, e => e.audio.music.contexts)).not.toContain('deep-space');
  // Far from everything: station leaves (wider leave radius), deep-space waits out its dwell.
  await engine(page, e => {
    const g = e as unknown as { player: { position: { x: number; y: number } }; stations: { position: { x: number; y: number } }[]; portals: { position: { x: number; y: number } }[] };
    // Park at the point of the map farthest from every station and portal.
    let best = { x: 0, y: 0, d: -1 };
    for (let x = -6000; x <= 6000; x += 600) for (let y = -6000; y <= 6000; y += 600) {
      let d = Infinity;
      for (const s of [...g.stations, ...g.portals]) d = Math.min(d, Math.hypot(s.position.x - x, s.position.y - y));
      if (d > best.d) best = { x, y, d };
    }
    g.player.position.x = best.x; g.player.position.y = best.y;
  });
  await quietScene(page);       // a roaming dragon is a `danger` context of its own
  await page.waitForFunction(() => !window.__omniEngine.audio.music.contexts.includes('station'), null, { timeout: 15000 });
  expect(await engine(page, e => e.audio.music.contexts), 'no deep-space yet').not.toContain('deep-space');
  await advanceSim(page, 22);   // MUSIC_DEEP_SPACE_DWELL_SEC is 20 sim seconds
  expect(await engine(page, e => e.audio.music.contexts)).toEqual(['deep-space']);
  watch.assertClean();
});
