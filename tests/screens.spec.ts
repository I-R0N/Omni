/** Death and stage-clear screens — freeze semantics, counters, exit paths.
 *
 *  Re-derived from `smoke-a1` (death screen) and `smoke-stage` (stage
 *  descent).  The behaviour under test is unusual enough to be worth stating:
 *  of the five full-screen overlays, FOUR freeze the sim and one does not.
 *  Death leaves the world running — deliberately, so the field keeps fighting
 *  behind a translucent summary — and three separate things make that safe
 *  (an inert wreck, a guarded explosion branch, a snapshotted summary).  A
 *  regression that "fixes" death by freezing it, or that unfreezes
 *  stage-clear, would be invisible to a player for a long time and is exactly
 *  what this suite is for.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, stats, startRun, waitForStats, dockAtStation } from './helpers';

const STAGE_WAVE_COUNT = 6; // BOSS_CONSTANTS.WAVE_INTERVAL (5) + the capstone

/** A PROBE the sim must move, planted by the test rather than borrowed from
 *  whatever fauna happened to spawn.
 *
 *  The first draft summed live enemy positions, which is a flake waiting to
 *  happen: on a quiet hub the enemy index can be empty, and "nothing moved"
 *  then reads identically to "the sim is frozen".  A drop is integrated by
 *  physics every step and drifts with the asteroid flow field, so a probe
 *  parked far from the player (out of magnet range, so it is never collected)
 *  moves if and only if the world is stepping. */
async function plantProbe(page: any) {
  await engine(page, e => {
    const p = e.player.position;
    e.drops.spawnSalvageDrop(
      e.currentMap.entities,
      e.activeDrops,
      { x: p.x + 4000, y: p.y + 4000 },
      { x: 60, y: 45 },
    );
    e.currentMap.entities[e.currentMap.entities.length - 1].__probe = true;
  });
}

/** How far the world has moved, by measures the overlays cannot fake. */
function worldClock(page: any) {
  return engine(page, e => {
    const probe = e.currentMap.entities.find((x: any) => x.__probe);
    return {
      runTimeSec: e.runTimeSec,
      motion: probe ? probe.position.x + probe.position.y : null,
      probeAlive: !!probe && probe.active,
    };
  });
}

test.describe('death screen', () => {
  test('reports the run counters the sim holds, and snapshots them', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // Give the run something to report.
    const seeded = await engine(page, e => {
      e.awardScore(7500);
      e.runKills = 12;
      e.bossesKilled = 2;
      e.runBestCombo = 4;
      return { score: e.score };
    });

    await engine(page, e => e.startExplosion(e.player));
    const dead = await waitForStats(page, s => !!s.runSummary, 'the run summary');
    const rs = dead.runSummary!;

    expect(rs.score).toBe(seeded.score);
    expect(rs.kills).toBe(12);
    expect(rs.bosses).toBe(2);
    expect(rs.bestCombo).toBe(4);
    expect(rs.mapName).toBe(dead.currentMapName);
    // The hub runs no waves, so the wave rows are HIDDEN rather than
    // reported as zero — a run that never touched an arena has nothing to
    // say about waves.
    expect(rs.wavesEnabled).toBe(false);

    // THE SUMMARY IS A SNAPSHOT.  The world keeps simulating behind it, so a
    // summary read live would drift.  Move the sim's own numbers and require
    // the screen not to follow.
    await engine(page, e => { e.awardScore(99_999); e.runKills += 50; });
    await page.waitForTimeout(600);
    const later = await stats(page);
    expect(later.runSummary!.score).toBe(rs.score);
    expect(later.runSummary!.kills).toBe(12);

    watch.assertClean();
  });

  test('does NOT freeze the sim — the field keeps fighting behind it', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    await plantProbe(page);
    await engine(page, e => e.startExplosion(e.player));
    await waitForStats(page, s => !!s.runSummary, 'the run summary');

    const t0 = await worldClock(page);
    expect(t0.probeAlive).toBe(true);
    await page.waitForTimeout(1200);
    const t1 = await worldClock(page);

    // The world moved …
    expect(t1.probeAlive).toBe(true);
    expect(t1.motion).not.toBe(t0.motion);
    // … but `runTimeSec` did NOT: reading your own obituary is not play time,
    // and that exclusion is explicit rather than a side effect of a freeze.
    expect(t1.runTimeSec).toBe(t0.runTimeSec);

    watch.assertClean();
  });

  test('the wreck is inert while the summary is up', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    await engine(page, e => e.startExplosion(e.player));
    await waitForStats(page, s => !!s.runSummary, 'the run summary');

    // `updateGameLogic` returns early while exploding: no input, no weapons,
    // no docking, no drop collection, no wave progress.  So a dead player
    // cannot drift, cannot fire, and cannot bank salvage.
    const before = await engine(page, e => ({
      pos: { x: e.player.position.x, y: e.player.position.y },
      credits: e.credits,
      exploding: !!e.player.isExploding,
    }));
    expect(before.exploding).toBe(true);

    await page.waitForTimeout(1000);
    const after = await engine(page, e => ({
      pos: { x: e.player.position.x, y: e.player.position.y },
      credits: e.credits,
    }));
    expect(after.pos).toEqual(before.pos);
    expect(after.credits).toBe(before.credits);

    // And pausing is refused while a full-screen overlay is up.
    await engine(page, e => e.pauseGame());
    const s = await stats(page);
    expect(s.gameState).toBe('PLAYING');

    watch.assertClean();
  });

  test('all three exit paths do what they say', async ({ page }) => {
    const watch = await boot(page);

    // ── RESPAWN: refill at the map's spawn, the run CONTINUES ────────────
    await startRun(page);
    await engine(page, e => { e.awardScore(5000); e.addDebugCredits(40_000); });
    await engine(page, e => e.startExplosion(e.player));
    await waitForStats(page, s => !!s.runSummary, 'summary 1');
    const balanceAfterPenalty = await engine(page, e => e.credits as number);

    await engine(page, e => e.respawnFromDeath());
    await waitForStats(page, s => !s.runSummary, 'summary 1 to clear');
    const respawned = await engine(page, e => ({
      health: e.player.health,
      maxHealth: e.player.maxHealth,
      exploding: !!e.player.isExploding,
      score: e.score,
      credits: e.credits,
    }));
    expect(respawned.exploding).toBe(false);
    expect(respawned.health).toBe(respawned.maxHealth);
    // The RUN survives — score and the post-penalty balance carry.
    expect(respawned.score).toBeGreaterThanOrEqual(5000);
    expect(respawned.credits).toBe(balanceAfterPenalty);

    // ── RESTART RUN: wipe and drop straight back into play ───────────────
    await engine(page, e => e.startExplosion(e.player));
    await waitForStats(page, s => !!s.runSummary, 'summary 2');
    await engine(page, e => e.restartRun());
    const restarted = await waitForStats(page, s => s.gameState === 'PLAYING' && !s.runSummary, 'a fresh run');
    const zeroed = await engine(page, e => ({
      score: e.score, credits: e.credits, kills: e.runKills,
      earned: e.runCreditsEarned, lost: e.runCreditsLost,
      waves: e.runWavesCleared, bosses: e.bossesKilled,
      exploding: !!e.player.isExploding,
    }));
    // EVERY run counter is back to zero — the thing a stale-state leak in
    // resetAndLoadSelectedMap would break, and did once before.
    expect(zeroed).toEqual({
      score: 0, credits: 0, kills: 0, earned: 0, lost: 0,
      waves: 0, bosses: 0, exploding: false,
    });
    // And it lands in PLAY, not in the menu.
    expect(restarted.gameState).toBe('PLAYING');
    // Back at the hub: a restart resets the map override to the front door.
    expect(restarted.currentMapType).toBe('OVERWORLD');

    // ── MAIN MENU: wipe and return to the menu ───────────────────────────
    await engine(page, e => e.startExplosion(e.player));
    await waitForStats(page, s => !!s.runSummary, 'summary 3');
    await engine(page, e => e.quitToMenu());
    const menu = await waitForStats(page, s => s.gameState === 'MENU', 'the main menu');
    expect(menu.runSummary).toBeUndefined();
    expect(menu.currentMapType).toBe('OVERWORLD');
    await expect(page.getByTestId('menu-start')).toBeVisible();

    watch.assertClean();
  });

  test('the three buttons clear the 40px tap-target floor at 390px', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await engine(page, e => e.startExplosion(e.player));
    await waitForStats(page, s => !!s.runSummary, 'the run summary');

    for (const id of ['death-respawn', 'death-restart', 'death-menu']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, `${id} should be laid out`).not.toBeNull();
      expect(box!.height, `${id} height`).toBeGreaterThanOrEqual(40);
      // And it must fit the phone it is played on.
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }

    watch.assertClean();
  });
});

test.describe('stage-clear screen', () => {
  /** Warp a capstone in on an ARENA (the hub runs no waves, so a DBG boss
   *  there has no ladder to descend from) and kill it. */
  async function clearAStage(page: any, bossId = 'BOSS_WARDEN') {
    await startRun(page);
    await engine(page, e => e.transitionToMap('arena_universe'));
    await waitForStats(page, s => s.currentMapType === 'UNIVERSE', 'the arena');
    await engine(page, (e, id: string) => e.debugSpawnBoss(id), bossId);
    await waitForStats(page, s => !!s.boss, 'the boss to warp in');
    // Kill it through the real death path.
    await engine(page, e => {
      const boss = e.currentMap.entities.find((x: any) => x.isBoss && x.active);
      boss.killedByPlayer = true;
      e.handleEntityDeath(boss);
    });
  }

  test('lands after a beat, freezes the fight, and reports the payout', async ({ page }) => {
    const watch = await boot(page);
    await clearAStage(page);

    // THE BEAT: the screen does not snap up on the killing blow.  The sim
    // keeps running for STAGE_CLEAR_DELAY_SEC so the explosion, debris and
    // salvage spray land before control is taken away.
    const immediately = await stats(page);
    expect(immediately.stageClear).toBeUndefined();

    const cleared = await waitForStats(page, s => !!s.stageClear, 'the stage-clear screen');
    const sc = cleared.stageClear!;
    expect(sc.bossName).toBe('WARDEN');
    expect(sc.stage).toBe(1);
    expect(sc.nextStage).toBe(2);
    expect(sc.mapName).toBe(cleared.currentMapName);
    expect(sc.scoreAwarded).toBeGreaterThan(0);
    // Reported in CREDITS, the units the shop speaks — a drop count rendered
    // with a money glyph read as that many credits.
    expect(sc.salvageCredits).toBeGreaterThan(0);
    expect(sc.salvageCredits % 1000).toBe(0);
    // The capstone drops a MODULE (or pays its catalog value when cargo is
    // full) — one or the other, never neither.
    expect(!!sc.rewardLabel || typeof sc.rewardCredits === 'number').toBe(true);

    // UNLIKE death, this one FREEZES.  The player is alive, so it pauses the
    // fight rather than ending it.
    await plantProbe(page);
    const t0 = await worldClock(page);
    await page.waitForTimeout(900);
    const t1 = await worldClock(page);
    expect(t1.runTimeSec).toBe(t0.runTimeSec);
    expect(t0.motion).not.toBeNull();
    expect(t1.motion).toBe(t0.motion);

    watch.assertClean();
  });

  test('halts the arena ladder and opens a descent rift', async ({ page }) => {
    const watch = await boot(page);
    await clearAStage(page);
    await waitForStats(page, s => !!s.stageClear, 'the stage-clear screen');

    const world = await engine(page, e => ({
      halted: !!e.waves.halted,
      descentRifts: e.currentMap.entities.filter((x: any) => x.isPortal && x.isDescent && x.active).length,
      returnRifts: e.currentMap.entities.filter((x: any) => x.isPortal && !x.isDescent && x.active).length,
      stageIndex: e.stageIndex,
    }));

    // The ladder STOPS — no further wave starts here, so the choice between
    // the two rifts is made in quiet.
    expect(world.halted).toBe(true);
    // Both rifts are in the world; the choice is made by flying to one, which
    // is why the screen offers no travel buttons.
    expect(world.descentRifts).toBe(1);
    expect(world.returnRifts).toBeGreaterThanOrEqual(1);
    expect(world.stageIndex).toBe(0);

    // CONTINUE resumes the cleared arena rather than travelling anywhere.
    await engine(page, e => e.dismissStageClear());
    const resumed = await waitForStats(page, s => !s.stageClear, 'the screen to dismiss');
    expect(resumed.gameState).toBe('PLAYING');
    expect(resumed.currentMapType).toBe('UNIVERSE');

    await plantProbe(page);
    const moving0 = await worldClock(page);
    await page.waitForTimeout(700);
    const moving1 = await worldClock(page);
    expect(moving1.runTimeSec).toBeGreaterThan(moving0.runTimeSec);
    expect(moving1.motion).not.toBe(moving0.motion);

    watch.assertClean();
  });

  test('descending carries the run and steps the depth stride', async ({ page }) => {
    const watch = await boot(page);
    await clearAStage(page);
    await waitForStats(page, s => !!s.stageClear, 'the stage-clear screen');
    await engine(page, e => e.dismissStageClear());
    await waitForStats(page, s => !s.stageClear, 'dismiss');

    // Bank some run state that a descent must NOT reset.
    const before = await engine(page, e => {
      e.addDebugCredits(70_000);
      e.player.health = Math.max(1, e.player.maxHealth - 37);
      return {
        credits: e.credits, score: e.score, health: e.player.health,
        ship: [...e.shipSlots], weapon: [...e.weaponSlots], inv: [...e.inventory],
        stageIndex: e.stageIndex, waveOffset: e.waves.waveOffset,
      };
    });

    await engine(page, e => e.transitionToMap('arena_ring', { descend: true }));
    await waitForStats(page, s => s.currentMapType === 'RING', 'stage 2');

    const after = await engine(page, e => ({
      credits: e.credits, score: e.score, health: e.player.health,
      ship: [...e.shipSlots], weapon: [...e.weaponSlots], inv: [...e.inventory],
      stageIndex: e.stageIndex, waveOffset: e.waves.waveOffset,
      waveIndex: e.waveIndex,
    }));

    // Run state CARRIES — that is the whole point of a descent as opposed to
    // a restart.  Hull damage carries too: repairing at a station is the loop.
    expect(after.credits).toBe(before.credits);
    expect(after.score).toBe(before.score);
    expect(after.health).toBe(before.health);
    expect(after.ship).toEqual(before.ship);
    expect(after.weapon).toEqual(before.weapon);
    expect(after.inv).toEqual(before.inv);

    // DEPTH steps by one, and the wave offset steps by a full stage — so
    // enemy growth and the boss rotation CONTINUE rather than restarting with
    // the new arena's wave counter.
    expect(after.stageIndex).toBe(before.stageIndex + 1);
    expect(after.waveOffset).toBe((before.stageIndex + 1) * STAGE_WAVE_COUNT);
    // The DISPLAY wave number is deliberately unshifted — the HUD still
    // counts from 1 within the stage.
    expect(after.waveIndex).toBe(0);

    watch.assertClean();
  });

  test('returning to the hub zeroes the depth — the hub is the surface', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await engine(page, e => e.transitionToMap('arena_universe'));
    await waitForStats(page, s => s.currentMapType === 'UNIVERSE', 'the arena');
    await engine(page, e => e.transitionToMap('arena_ring', { descend: true }));
    await waitForStats(page, s => s.currentMapType === 'RING', 'stage 2');
    expect(await engine(page, e => e.stageIndex)).toBe(1);

    await engine(page, e => e.transitionToMap('overworld'));
    await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');
    expect(await engine(page, e => e.stageIndex)).toBe(0);
    expect(await engine(page, e => e.waves.waveOffset)).toBe(0);

    watch.assertClean();
  });
});
