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
import { boot, engine, stats, startRun, waitForStats, advanceSim, waitForTransit } from './helpers';

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

    // And pausing is refused while a full-screen overlay is up.  Read off
    // the engine in the same breath as the call: the stats payload would say
    // PLAYING for a frame even if the pause had landed (harness rule 12).
    expect(await engine(page, e => { e.pauseGame(); return e.gameState; })).toBe('PLAYING');

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
    // Back at the hub: restartRun reloads the map the run STARTED on
    // (selectedMapType — the hub here); it is quitting to the menu
    // (restartGame) that resets a DBG map override.
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

  // The three buttons' 40px tap floor is not re-checked here: viewports.spec
  // asserts it for the same three testids at 390×844 and five other sizes.
});

test.describe('a boss ends the ladder', () => {
  /*  User call: waves used to keep arriving while a boss was on the field,
   *  and to resume once it died. A boss fight with a wave landing on top of
   *  it is two encounters at once.
   *
   *  What is pinned here is the RULE, not the current numbers: the ladder
   *  stops the moment a boss appears, and nothing about the boss dying
   *  restarts it. Both halves matter — the second is the one that only shows
   *  up a grace period after the fight, which is exactly when nobody is
   *  watching for it. */

  async function arenaWithWaves(page: any) {
    await startRun(page);
    await engine(page, e => e.transitionToMap('arena_universe'));
    await waitForTransit(page);
    await waitForStats(page, s => s.currentMapType === 'UNIVERSE', 'the arena');
    await waitForStats(page, s => s.wavesEnabled !== false, 'the ladder running');
  }

  test('a boss warping in stops the ladder, and killing it does not restart it', async ({ page }) => {
    const watch = await boot(page);
    await arenaWithWaves(page);

    const before = await engine(page, e => ({
      halted: !!e.waves.halted,
      waveIndex: e.waveIndex,
      pending: e.waves.spawnList.length - e.waves.nextSpawnIdx,
    }));
    expect(before.halted, 'the ladder runs normally before the boss').toBe(false);
    // The precondition, not the claim (harness rule 13): wave 1 streams its
    // budget over ~30 s, so ordinary spawns are still queued when the boss
    // warps in.  Without them the drop below would have nothing to drop.
    expect(before.pending, 'ordinary spawns still queued').toBeGreaterThan(0);

    await engine(page, e => e.debugSpawnBoss('BOSS_WARDEN'));
    await waitForStats(page, s => !!s.boss, 'the boss to warp in');

    const during = await engine(page, e => ({
      halted: !!e.waves.halted,
      waveIndex: e.waveIndex,
      pending: e.waves.spawnList.length - e.waves.nextSpawnIdx,
    }));
    expect(during.halted, 'the ladder stops the moment the boss appears').toBe(true);
    // A boss warped in MID-wave ends that wave's stream: the ordinary spawns
    // still queued behind it belong to a wave that is over, so none of them
    // may land on top of the fight.  (A capstone keeps its own escort; this
    // is a DBG warp-in during wave 1, so there is none.)
    expect(during.pending, 'the ordinary spawns queued behind the boss are dropped').toBe(0);
    expect(during.waveIndex, 'and it stops where it was, it does not jump')
      .toBe(before.waveIndex);

    // Kill it through the real death path, then dismiss the stage-clear
    // screen so the arena is running again — this is the moment the ladder
    // used to pick back up.  Rival warp-ins are switched off first: the
    // bounty's score would call hostile rivals down on a lean ship parked
    // for the whole wait below (harness rule 14), and rivals are not the
    // ladder.
    await engine(page, e => {
      e.nextRivalScore = Number.POSITIVE_INFINITY;
      const boss = e.currentMap.entities.find((x: any) => x.isBoss && x.active);
      boss.killedByPlayer = true;
      e.handleEntityDeath(boss);
    });
    await waitForStats(page, s => !!s.stageClear, 'the stage-clear screen');
    await engine(page, e => e.dismissStageClear());
    await waitForStats(page, s => !s.stageClear, 'the screen to dismiss');

    // Give the arena more than a grace period of SIM time, with the sim
    // running, which is what makes this a test of the resume and not of the
    // freeze.  Wall clock would not do: the rout ended the wave and armed a
    // 4.5 s grace, about 2.6 s of it is still left after the stage-clear
    // beat, and on a software-rendered runner a few seconds of wall clock is
    // LESS sim than that — the wait would end before a wrongly restarted
    // ladder could show.
    const after0 = await engine(page, e => e.waveIndex);
    await advanceSim(page, 6); // > WAVE_CONSTANTS.GRACE_PERIOD (4.5 s)
    const after = await engine(page, e => ({
      halted: !!e.waves.halted,
      waveIndex: e.waveIndex,
      state: e.waveState,
    }));
    expect(after.halted, 'still halted after the boss is dead').toBe(true);
    expect(after.waveIndex, 'and no new wave started').toBe(after0);
    expect(after.state, 'the routed wave completed and nothing replaced it').toBe('cleared');

    watch.assertClean();
  });

  test('the ladder comes back on a fresh arena, not on the cleared one', async ({ page }) => {
    const watch = await boot(page);
    await arenaWithWaves(page);
    await engine(page, e => e.debugSpawnBoss('BOSS_WARDEN'));
    await waitForStats(page, s => !!s.boss, 'the boss');
    expect(await engine(page, e => !!e.waves.halted)).toBe(true);

    // Loading a map is the deliberate way to get a fresh ladder — `init`
    // clears the halt, and nothing else does. Without this the halt would be
    // a one-way door for the rest of the run.
    await engine(page, e => e.transitionToMap('arena_ring'));
    await waitForTransit(page);
    await waitForStats(page, s => s.currentMapType === 'RING', 'a fresh arena');
    expect(await engine(page, e => !!e.waves.halted),
      'a new arena runs its own ladder').toBe(false);

    watch.assertClean();
  });
});

test.describe('stage-clear screen', () => {
  /** Warp a capstone in on an ARENA (the hub runs no waves, and bosses.ts
   *  only raises the stage-clear screen on a wave map) and kill it. */
  async function clearAStage(page: any, bossId = 'BOSS_WARDEN') {
    await startRun(page);
    await engine(page, e => e.transitionToMap('arena_universe'));
    await waitForTransit(page);
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
    // salvage spray land before control is taken away.  Read off the ENGINE:
    // the stats payload lags a frame (harness rule 12), so it would show no
    // screen here even if the kill had raised one at once.
    const beat = await engine(page, e => ({ pending: e.stageClearPending, delay: e.stageClearDelay }));
    expect(beat.pending, 'no screen on the killing blow').toBe(false);
    expect(beat.delay, 'the beat is armed and counting').toBeGreaterThan(0);

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

  test('halts the arena ladder; the descent rift is switched off for now', async ({ page }) => {
    const watch = await boot(page);
    await clearAStage(page);
    await waitForStats(page, s => !!s.stageClear, 'the stage-clear screen');

    const world = await engine(page, e => ({
      halted: !!e.waves.halted,
      descentRifts: e.currentMap.entities.filter((x: any) => x.isPortal && x.isDescent && x.active).length,
      returnRifts: e.currentMap.entities.filter((x: any) => x.isPortal && !x.isDescent && x.active).length,
      stageIndex: e.stageIndex,
    }));

    // The ladder STOPS — no further wave starts here.
    expect(world.halted).toBe(true);
    /*  NO DESCENT RIFT (user call — the descent flow is being reworked).
     *  This assertion is INVERTED rather than deleted, because "no rift
     *  appears" is now the behaviour, and an absent assertion would let one
     *  come back silently.  Everything BEHIND the descent is untouched and
     *  still covered by the next test: `transitionToMap(id, {descend:true})`
     *  still steps the depth and the wave offset.  The arena's own RETURN
     *  rift is what the player leaves by. */
    expect(world.descentRifts).toBe(0);
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
    await waitForTransit(page);
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
    await waitForTransit(page);
    await waitForStats(page, s => s.currentMapType === 'UNIVERSE', 'the arena');
    await engine(page, e => e.transitionToMap('arena_ring', { descend: true }));
    await waitForTransit(page);
    await waitForStats(page, s => s.currentMapType === 'RING', 'stage 2');
    expect(await engine(page, e => e.stageIndex)).toBe(1);

    await engine(page, e => e.transitionToMap('overworld'));
    await waitForTransit(page);
    await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');
    expect(await engine(page, e => e.stageIndex)).toBe(0);
    expect(await engine(page, e => e.waves.waveOffset)).toBe(0);

    watch.assertClean();
  });
});
