import { test, expect } from '@playwright/test';
import { advanceSim, boot, engine, startRun, waitForStats, waitForTransit } from './helpers';

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
    a.loop('move.thrust', true, { param: 0.7 });
    a.setActive(false);
    const stopped = a.liveVoices === 0 && a.liveLoops === 0;
    const count = a.counts.played;
    a.play('weapon.charge.ready');
    const suppressed = a.counts.played === count;
    a.play('ui.confirm');
    const ui = a.counts.played === count + 1;
    a.setMuted(true);
    return { before, after, repeats, right, left, stopped, suppressed, ui,
      mutedVoices: a.liveVoices, volume: a.volume, sfx: a.sfxVolume, music: a.musicVolume };
  });
  expect(result.before).toBe(result.after);
  expect(result.repeats).toBe(0);
  expect(result.right).toBeGreaterThan(0);
  expect(result.left).toBeLessThan(0);
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


// The capstone is the ONE override of the continuous playlist (user call): a
// boss warping in is a designed beat, so the score starts with it rather than
// carrying on with whatever the wave ladder was playing.
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
  await boot(page);
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
});
