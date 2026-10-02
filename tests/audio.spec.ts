/** The sound system as shipped: the recorded banks decode with full id
 *  coverage, the mix controls and voice budget hold, and the streamed battle
 *  layer follows combat.  Plus two contracts that used to live in an ungated
 *  smoke script, here so the merge gate runs them: docs/SFX_INVENTORY.md and
 *  the registry name the SAME ids, and audio survives what iOS does to a web
 *  page (the ring switch, interruptions, backgrounding).
 *
 *  Everything drives the real AudioSystem through `window.__omniEngine`.  The
 *  only things stood in for are the ones a headless Chromium cannot produce:
 *  an 'interrupted' context, a hidden tab, and `navigator.audioSession`. */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { advanceSim, boot, engine, startRun, waitForStats, waitForTransit } from './helpers';

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

test('mix controls, variation inspection, torus pan and pause cleanup', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page);
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


test('streamed music keeps its place; battle layer follows combat, music/mute, and pause', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await page.waitForFunction(() => window.__omniEngine.audio.music?.playing);
  expect(await engine(page, e => e.audio.music.battleTrackIndex)).toBe(-1);
  expect(await engine(page, e => e.audio.music.battleTracks.every(track => !track.loaded))).toBeTruthy();
  await startRun(page);
  await page.waitForFunction(() => window.__omniEngine.audio.music.currentTime > 0.2);
  await engine(page, e => e.audio.setCombat(true));
  await page.waitForFunction(() => window.__omniEngine.audio.music.battlePlaying);
  expect(await engine(page, e => e.audio.music.battleActive)).toBeTruthy();
  const firstBattle = await engine(page, e => e.audio.music.battleTrackIndex);
  await engine(page, e => e.audio.music.currentBattle.media.dispatchEvent(new Event('ended')));
  await expect.poll(() => engine(page, e => e.audio.music.battleTrackIndex)).not.toBe(firstBattle);
  await engine(page, e => e.audio.setCombat(false));
  expect(await engine(page, e => e.audio.music.battleActive)).toBeFalsy();
  const before = await engine(page, e => e.audio.music.currentTime);
  await engine(page, e => { e.audio.setSfxVolume(0); e.pauseGame(); });
  await expect.poll(() => engine(page, e => e.audio.music.currentTime)).toBeGreaterThan(before);
  await engine(page, e => e.audio.setMusicVolume(0));
  await page.waitForFunction(() => !window.__omniEngine.audio.music.playing);
  const pausedAt = await engine(page, e => e.audio.music.currentTime);
  await engine(page, e => e.audio.setMusicVolume(0.7));
  await page.waitForFunction(() => window.__omniEngine.audio.music.playing);
  expect(await engine(page, e => e.audio.music.currentTime)).toBeGreaterThanOrEqual(pausedAt);
  await engine(page, e => e.audio.setMuted(true));
  await page.waitForFunction(() => !window.__omniEngine.audio.music.playing);
  expect(await engine(page, e => e.audio.music.error)).toBeNull();
  watch.assertClean();
});

// The battle layer is a CONTINUOUS playlist that proximity only ducks.  Both
// halves of that used to be one action: every rising edge of the combat signal
// called `startNextBattle`, which advanced the index AND rewound to 0 — and an
// arena's field goes empty on every wave clear, so a wave sequence chopped
// itself into a new song every few seconds.
test('a lull ducks the battle layer without changing or rewinding the song', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page);
  await engine(page, e => e.audio.setCombat(true));
  await page.waitForFunction(() => window.__omniEngine.audio.music.battlePlaying);

  // PRECONDITION as a selection criterion (README rule 13): "it resumed where
  // it left off" is only a claim about a track that was genuinely running, so
  // wait for real playback rather than asserting against a track at 0.
  await page.waitForFunction(() => window.__omniEngine.audio.music.battleCurrentTime > 0.3,
    null, { timeout: 20000 });
  const engagedIndex = await engine(page, e => e.audio.music.battleTrackIndex);
  const engagedAt = await engine(page, e => e.audio.music.battleCurrentTime);
  expect(engagedIndex).toBeGreaterThanOrEqual(0);
  expect(engagedAt).toBeGreaterThan(0.3);

  // The lull.  The pause trails the fade by three time constants, so this is
  // waiting on the real scheduled pause, not on a fixed sleep.
  await engine(page, e => e.audio.setCombat(false));
  expect(await engine(page, e => e.audio.music.battleActive)).toBeFalsy();
  await expect.poll(() => engine(page, e => e.audio.music.battlePlaying),
    { timeout: 20000 }).toBeFalsy();
  const heldAt = await engine(page, e => e.audio.music.battleCurrentTime);
  const heldIndex = await engine(page, e => e.audio.music.battleTrackIndex);
  // Paused, not stopped: the position is still standing where the fade left it.
  expect(heldIndex).toBe(engagedIndex);
  expect(heldAt).toBeGreaterThanOrEqual(engagedAt);

  // Re-engaging resumes THE SAME SONG at THE SAME POINT.  A restart would put
  // the index one on and the clock back near zero, which is exactly what the
  // old rising edge did.
  await engine(page, e => e.audio.setCombat(true));
  await page.waitForFunction(() => window.__omniEngine.audio.music.battlePlaying);
  expect(await engine(page, e => e.audio.music.battleTrackIndex)).toBe(heldIndex);
  const resumedAt = await engine(page, e => e.audio.music.battleCurrentTime);
  expect(resumedAt).toBeGreaterThanOrEqual(heldAt - 0.05);

  // And the hand-over still works — `ended` is now the ONLY thing that moves
  // the index, so this is the negative control for the claim above.
  await engine(page, e => e.audio.music.currentBattle.media.dispatchEvent(new Event('ended')));
  await expect.poll(() => engine(page, e => e.audio.music.battleTrackIndex)).not.toBe(heldIndex);
  watch.assertClean();
});


// A capstone warping in is one of the two moments the playlist cuts to a new
// song (the other is a map change — see 'a new arena starts a new song'):
// it is a designed beat, so the score starts with it rather than carrying on
// with whatever the wave ladder was playing.
test('a boss warping in cuts the battle layer to a new song', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page);
  await engine(page, e => e.audio.setCombat(true));
  await page.waitForFunction(() => window.__omniEngine.audio.music.battlePlaying);

  // Same precondition as the lull test (README rule 13): "it cut to a new
  // song" only means something against a song that was genuinely running.
  await page.waitForFunction(() => window.__omniEngine.audio.music.battleCurrentTime > 0.3,
    null, { timeout: 20000 });
  const before = await engine(page, e => e.audio.music.battleTrackIndex);
  expect(before).toBeGreaterThanOrEqual(0);

  await engine(page, e => e.debugSpawnBoss());
  await expect.poll(() => engine(page, e => e.audio.music.battleTrackIndex)).not.toBe(before);
  // From the TOP, not from wherever the interrupted track happened to be.
  expect(await engine(page, e => e.audio.music.battleCurrentTime)).toBeLessThan(0.3);
  await page.waitForFunction(() => window.__omniEngine.audio.music.battlePlaying);

  // And the boss holds the layer open from the offscreen ring it arrived on:
  // shove it far past the release radius and the score stays engaged, where
  // an ordinary hostile would have been let go.
  await engine(page, e => {
    const boss = e.entityIndex.enemies.find((x: { isBoss?: boolean }) => x.isBoss === true);
    if (boss) { boss.position.x = e.player.position.x + 9000; boss.velocity.x = 0; boss.velocity.y = 0; }
  });
  await advanceSim(page, 1);
  expect(await engine(page, e => e.audio.music.battleActive)).toBeTruthy();
  watch.assertClean();
});

/* LEAVING THE AREA ENDS THE FIGHT — the battle layer must not follow you
 * through a portal (user report: "while fighting a boss, I left the arena to
 * the overworld and the battle music continued").
 *
 * The cause was not the combat signal, which is correct: the boss is gone from
 * the destination on the very first frame.  It was `MUSIC_LINGER_SEC` being
 * carried across the map change.  That linger exists for a LULL inside one
 * arena — the field empties on every wave clear and the next wave is seconds
 * off — but `transitionToMap` deliberately leaves the enemies behind, so a
 * transit is the opposite of a lull.  Measured on the unfixed build: combat
 * stayed true for the full 6.0 s of overworld, with the layer's own ~5 s fade
 * on top.
 *
 * The two tests below are ONE A/B and have to be read together: same elapsed
 * time, opposite outcomes, and the only difference is whether the map changed.
 * Either alone is weak — dropping the linger everywhere would pass the first
 * and fail the second, which is exactly the over-correction to guard. */
test('a portal out of a boss fight stands the battle layer down', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page, 'POCKET');
  await waitForStats(page, s => s.currentMapType === 'POCKET', 'the arena');

  // Drive the REAL signal (harness rule 6): a boss on the field is what puts
  // the engine into combat, not a direct `setCombat`.
  await engine(page, e => e.debugSpawnBoss());
  await page.waitForFunction(() => window.__omniEngine.audio.music.battleActive);

  // The same call `enterPortal()` makes.
  await engine(page, e => e.transitionToMap('overworld'));
  await waitForTransit(page);
  await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');

  // WELL INSIDE the linger window the unfixed build held: the layer is down
  // because the encounter ended, not because 6 s elapsed.
  await advanceSim(page, 2);
  expect(await engine(page, e => e.audio.music.battleActive),
    'the battle layer follows the fight, not the player').toBeFalsy();
  // And the boss really is gone, so the claim is about the linger and not
  // about a boss that somehow travelled with us.
  expect(await engine(page, e => e.entityIndex.enemies.filter(
    (x: { isBoss?: boolean }) => x.isBoss === true).length)).toBe(0);

  // ARRIVING somewhere dangerous still engages — the destination decides from
  // its OWN hostiles, which is the half that must survive the fix.
  await engine(page, e => e.debugSpawnBoss());
  await page.waitForFunction(() => window.__omniEngine.audio.music.battleActive);
  watch.assertClean();
});

test('a new arena starts a new song', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page, 'POCKET');
  await waitForStats(page, s => s.currentMapType === 'POCKET', 'the arena');

  // Open the playlist through the REAL signal (harness rule 6).  The boss
  // spawn cues a track of its own, which is exactly why the reading below is
  // taken AFTER it: what is under test is the map change's cue, so the boss's
  // must already be spent.
  await engine(page, e => e.debugSpawnBoss());
  await page.waitForFunction(() => window.__omniEngine.audio.music.battleActive);
  const before = await engine(page, e => e.audio.music.battleTrackIndex);
  expect(before, 'the playlist is open, so there is a song to carry over')
    .toBeGreaterThanOrEqual(0);

  // The same call `enterPortal()` makes.  Nothing else cues between here and
  // the reading below — the boss stays behind, so a changed index can only be
  // the map change.
  await engine(page, e => e.transitionToMap('overworld'));
  await waitForTransit(page);
  await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');

  const after = await engine(page, e => ({
    index: e.audio.music.battleTrackIndex,
    at: e.audio.music.battleCurrentTime,
  }));
  expect(after.index, 'a map change opens a different track, not the old one')
    .not.toBe(before);
  // From the TOP.  `advanceBattle` rewinds the successor, so this is what
  // says the layer will not resume the previous song mid-phrase — the whole
  // of the user report.
  expect(after.at, 'the new song starts at its beginning').toBeLessThan(0.5);

  // AND THE CUE IS SILENT.  The stand-down runs first in `loadMapFresh`, so
  // the fresh track waits paused rather than starting at full level over the
  // warp beat.  (This is a consequence of that ordering, not a proof of it:
  // the combat report would also have gone down on the first frame after the
  // transit either way.)
  expect(await engine(page, e => e.audio.music.battleActive),
    'arriving somewhere quiet does not play the new song at anybody')
    .toBeFalsy();
  watch.assertClean();
});

test('a lull inside one arena still holds the battle layer up', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page, 'POCKET');
  await waitForStats(page, s => s.currentMapType === 'POCKET', 'the arena');

  await engine(page, e => e.debugSpawnBoss());
  await page.waitForFunction(() => window.__omniEngine.audio.music.battleActive);
  const opened = await engine(page, e => e.audio.music.battleTrackIndex);

  // Empty the field WITHOUT changing map — a wave clear, which is what the
  // linger is for.  The boss is dropped straight out of the world rather than
  // killed, so no death beat, rout or stage-clear screen runs and the only
  // thing under test is the proximity signal going quiet.
  const cleared = await engine(page, e => {
    let n = 0;
    for (const x of e.currentMap.entities) {
      if (x.type === 'ENEMY' && x.active) { x.active = false; n++; }
    }
    return n;
  });
  expect(cleared, 'the field really had something in it').toBeGreaterThan(0);

  // The SAME 2 s that finds the layer down after a transit finds it still up
  // here.  That is the whole A/B.
  await advanceSim(page, 2);
  expect(await engine(page, e => e.entityIndex.enemies.filter(
    (x: { isBoss?: boolean }) => x.isBoss === true).length),
    'the field is genuinely empty of bosses').toBe(0);
  expect(await engine(page, e => e.audio.music.battleActive),
    'a lull ducks nothing — the next wave is seconds away').toBeTruthy();
  // The other half of the same rule, and the A/B against the test above: a
  // map change cuts to a new song, a lull inside one arena does not.
  expect(await engine(page, e => e.audio.music.battleTrackIndex),
    'a lull does not advance the playlist either').toBe(opened);
  watch.assertClean();
});

test('long player tails do not suppress the next attack', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await page.waitForFunction(() => window.__omniEngine.audio.prepared);
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
