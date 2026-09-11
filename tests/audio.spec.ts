import { test, expect } from '@playwright/test';
import { boot, engine, startRun } from './helpers';

test('all recorded takes decode; production cache is finite, audible and bounded', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await page.waitForFunction(() => window.__omniEngine.audio.prepared, null, { timeout: 90000 });
  const result = await engine(page, e => {
    const a = e.audio;
    const bad: string[] = [];
    let bytes = 0;
    for (const [id, set] of a.synthesized) {
      if (set.bufs.length !== 3) bad.push(id + ': missing variants');
      for (const buf of set.bufs) {
        const data = buf.getChannelData(0);
        let peak = 0;
        for (const sample of data) {
          if (!Number.isFinite(sample)) bad.push(id + ': nonfinite');
          peak = Math.max(peak, Math.abs(sample));
        }
        if (peak < 0.001 || buf.duration > 4) bad.push(id + ': signal/duration');
        bytes += data.byteLength;
      }
    }
    return { bad, bytes, recorded: a.sampleCount, rejected: a.rejectedSampleCount,
      unmatched: a.unmatchedFiles, cached: a.synthesized.size, oneShots: a.defs.size,
      sampled: a.sampledIds.length };
  });
  expect(result.bad).toEqual([]);
  expect(result.recorded).toBe(66);
  expect(result.rejected).toBe(0);
  expect(result.unmatched).toEqual([]);
  expect(result.cached + result.sampled).toBe(result.oneShots);
  expect(result.bytes).toBeLessThan(30 * 1024 * 1024);
  watch.assertClean();
});

test('mix controls, variation inspection, torus pan and pause cleanup', async ({ page }) => {
  const watch = await boot(page);
  await page.mouse.click(5, 5);
  await startRun(page);
  await page.waitForFunction(() => window.__omniEngine.audio.sampleCount === 66);
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
