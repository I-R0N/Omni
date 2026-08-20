/** The full game loop, in one continuous run.
 *
 *  Re-derived from `smoke-a3` (Pair A) and B4 (the boss gauntlet), both of
 *  which walked the whole thing end to end rather than testing the pieces
 *  separately.  That is the point of this file: every other suite here proves
 *  one mechanism in isolation, and isolation is exactly where the interesting
 *  bugs are NOT.  The loop is
 *
 *      hub → dock → buy → outfit → portal → waves → capstone → payout → home
 *
 *  and what it asserts is CONTINUITY — that run state survives every seam.
 *  A portal is not a reset, a boss kill is not a reset, and coming home is
 *  not a reset.  The three prior gauntlets each found a real bug of exactly
 *  that shape (a wreck-state leak on restart being the one that shipped).
 */

import { test, expect } from '@playwright/test';
import { boot, engine, stats, startRun, waitForStats, waitForEngine, dockAtStation, advanceSim } from './helpers';

const STAGE_WAVE_COUNT = 6;

/** Bank real salvage through the engine's own collection path. */
async function earn(page: any, units: number) {
  return engine(page, (e, n: number) => {
    for (let i = 0; i < n; i++) {
      const before = e.currentMap.entities.length;
      e.drops.spawnSalvageDrop(
        e.currentMap.entities, e.activeDrops,
        { x: e.player.position.x, y: e.player.position.y },
      );
      const d = e.currentMap.entities[before];
      if (d) {
        e.applyDropEffect(d);
        d.active = false;
        // Prune `activeDrops` as well.  `spawnSalvageDrop` refuses to spawn
        // once that array reaches DROP_CONFIG.MAX_ACTIVE_DROPS, and collected
        // drops are only swept out on a later frame — so a tight collect loop
        // silently stops paying at 100 units without it.
        const k = e.activeDrops.indexOf(d);
        if (k >= 0) e.activeDrops.splice(k, 1);
      }
    }
    return e.credits;
  }, units);
}

test.describe('the run', () => {
  test('carries its state through every seam: dock, outfit, portal, boss, home', async ({ page }) => {
    const watch = await boot(page);

    // ── 1. A run begins on the HUB, lean and broke ───────────────────────
    await startRun(page);
    const start = await stats(page);
    expect(start.currentMapType).toBe('OVERWORLD');
    expect(start.credits).toBe(0);
    // The hub runs no waves — it is where you spend, not where you fight.
    expect(start.wavesEnabled).toBeFalsy();

    const leanWeapons = await engine(page, e => ({
      guns: e.weaponSlots.filter((s: string | null) => s && s.startsWith('wpn_')),
      equipped: e.equippedWeapons.filter((w: unknown) => w !== null).length,
    }));
    expect(leanWeapons.guns).toEqual(['wpn_blaster']);
    expect(leanWeapons.equipped).toBe(1);

    // ── 2. EARN ──────────────────────────────────────────────────────────
    const banked = await earn(page, 120);
    expect(banked).toBe(120_000);

    // ── 3. DOCK ──────────────────────────────────────────────────────────
    await dockAtStation(page);
    const docked = await stats(page);
    expect(docked.dock!.docked).toBe(true);
    expect(docked.station).toBeDefined();
    // The Trade Hub carries both shops on top of the drydock baseline.
    expect(docked.dock!.services).toMatchObject({
      drydock: true, shipShop: true, weaponShop: true,
    });
    // Docking FREEZES the sim — one of the four overlays that does.
    const frozen0 = await engine(page, e => e.runTimeSec as number);
    await page.waitForTimeout(500);
    const frozen1 = await engine(page, e => e.runTimeSec as number);
    expect(frozen1).toBe(frozen0);

    // ── 4. BUY ───────────────────────────────────────────────────────────
    const buy = await engine(page, e => {
      const before = e.credits;
      const ok = e.purchaseModule('hull_mk2') && e.purchaseModule('wpn_shotgun');
      return { ok, spent: before - e.credits, inv: e.inventory.filter((i: string | null) => i !== null) };
    });
    expect(buy.ok).toBe(true);
    expect(buy.spent).toBeGreaterThan(0);
    expect(buy.inv).toEqual(['hull_mk2', 'wpn_shotgun']);

    // ── 5. OUTFIT ────────────────────────────────────────────────────────
    const outfit = await engine(page, e => {
      const hp0 = e.player.maxHealth;
      e.moveModule({ area: 'inventory', idx: e.inventory.indexOf('hull_mk2') }, { area: 'ship', idx: 1 });
      e.moveModule({ area: 'inventory', idx: e.inventory.indexOf('wpn_shotgun') }, { area: 'weapon', idx: 2 });
      const snap = e.outfittingSnapshot();
      return {
        hp0, hp1: e.player.maxHealth,
        gunsMounted: snap.gunsMounted, maxGuns: snap.maxGuns,
        equipped: e.equippedWeapons.filter((w: unknown) => w !== null).length,
        hullActive: snap.ship[1].active,
      };
    });
    // The hull went ONLINE (it touches the base hull on the centre) and the
    // ship got tougher for it.
    expect(outfit.hullActive).toBe(true);
    expect(outfit.hp1).toBeGreaterThan(outfit.hp0);
    // Guns are slot-agnostic but capped at 2 MOUNTED, and the mounted guns in
    // slot order ARE the loadout.
    expect(outfit.gunsMounted).toBe(2);
    expect(outfit.maxGuns).toBe(2);
    expect(outfit.equipped).toBe(2);

    // Outfitting is DRYDOCK-ONLY: the same move is refused in the field.
    await engine(page, e => e.undock());
    await waitForStats(page, s => !s.station, 'undock');
    const refused = await engine(page, e => {
      const before = [...e.shipSlots];
      const ok = e.moveModule({ area: 'ship', idx: 1 }, { area: 'ship', idx: 3 });
      return { ok, unchanged: JSON.stringify(before) === JSON.stringify(e.shipSlots) };
    });
    expect(refused.ok).toBeFalsy();
    expect(refused.unchanged).toBe(true);

    // ── 6. PORTAL — the seam that must NOT reset the run ─────────────────
    const beforePortal = await engine(page, e => {
      // Take some hull damage: it must CROSS the portal, because repairing at
      // a station is the loop.
      e.player.health = Math.max(1, e.player.maxHealth - 41);
      e.awardScore(3300);
      return {
        credits: e.credits, score: e.score, health: e.player.health,
        ship: [...e.shipSlots], weapon: [...e.weaponSlots], inv: [...e.inventory],
        equipped: [...e.equippedWeapons],
      };
    });

    const hubPortal = await engine(page, e => {
      const p = e.currentMap.entities.find((x: any) => x.isPortal && x.active);
      return p ? { target: p.portalTargetId, name: p.name } : null;
    });
    expect(hubPortal).not.toBeNull();
    // Destinations are DESCRIPTOR IDS, never bare MapType values.
    expect(hubPortal!.target).toMatch(/^arena_/);

    await engine(page, (e, tid: string) => e.transitionToMap(tid), hubPortal!.target);
    const inArena = await waitForStats(page, s => s.currentMapType !== 'OVERWORLD', 'the arena');

    const afterPortal = await engine(page, e => ({
      credits: e.credits, score: e.score, health: e.player.health,
      ship: [...e.shipSlots], weapon: [...e.weaponSlots], inv: [...e.inventory],
      equipped: [...e.equippedWeapons],
    }));
    // EVERYTHING carries.  This is the whole assertion.
    expect(afterPortal).toEqual(beforePortal);
    // And the arena runs waves, read off the destination descriptor.
    expect(inArena.wavesEnabled).not.toBe(false);

    // ── 7. WAVES ─────────────────────────────────────────────────────────
    const wave1 = await waitForStats(page, s => (s.waveNumber ?? 0) >= 1, 'wave 1');
    expect(wave1.waveNumber).toBe(1);

    // Climb the ladder to the capstone.  A stage is five ordinary waves and
    // then the boss's OWN wave, so wave index 5 is the capstone — and it is
    // driven through the real `startWave`, not `debugSpawnBoss`, so the boss
    // that shows up is the one the LADDER produced.  (`skipWave` is not usable
    // here: it only shortens the grace period between waves.)
    const ladder = await engine(page, (e, n: number) => {
      const ctx = e.waveContext();
      for (let i = 1; i <= n; i++) e.waves.startWave(i, ctx);
      return { waveIndex: e.waveIndex };
    }, STAGE_WAVE_COUNT - 1);
    expect(ladder.waveIndex).toBe(STAGE_WAVE_COUNT - 1);

    // ── 8. CAPSTONE ──────────────────────────────────────────────────────
    const bossUp = await waitForStats(page, s => !!s.boss, 'the boss bar');
    // LEGIBILITY: the HUD gets a named bar with phase pips and both fractions.
    expect(bossUp.boss!.name).toBe('WARDEN');
    expect(bossUp.boss!.healthFrac).toBeGreaterThan(0);
    expect(bossUp.boss!.healthFrac).toBeLessThanOrEqual(1);
    expect(bossUp.boss!.phaseCount).toBeGreaterThan(1);

    const beforeKill = await engine(page, e => ({
      score: e.score, credits: e.credits, bosses: e.bossesKilled,
      inv: e.inventory.filter((i: string | null) => i !== null).length,
      ship: [...e.shipSlots], weapon: [...e.weaponSlots],
    }));

    await engine(page, e => {
      const boss = e.currentMap.entities.find((x: any) => x.isBoss && x.active);
      boss.killedByPlayer = true;
      e.handleEntityDeath(boss);
    });

    // ── 9. PAYOUT ────────────────────────────────────────────────────────
    const cleared = await waitForStats(page, s => !!s.stageClear, 'the stage-clear screen');
    const sc = cleared.stageClear!;
    expect(sc.bossName).toBe('WARDEN');
    expect(sc.scoreAwarded).toBeGreaterThan(0);
    expect(sc.salvageCredits).toBeGreaterThan(0);

    const afterKill = await engine(page, e => ({
      score: e.score, bosses: e.bossesKilled,
      inv: e.inventory.filter((i: string | null) => i !== null).length,
      ship: [...e.shipSlots], weapon: [...e.weaponSlots],
    }));
    expect(afterKill.score).toBeGreaterThan(beforeKill.score);
    expect(afterKill.bosses).toBe(beforeKill.bosses + 1);
    // There is deliberately NO weapon-unlock plumbing anywhere: weapons stay
    // purely purchased, so the LOADOUT is byte-identical across a boss kill.
    expect(afterKill.ship).toEqual(beforeKill.ship);
    expect(afterKill.weapon).toEqual(beforeKill.weapon);
    // The reward is a MODULE dropped into the inventory (or its value in
    // salvage when cargo is full) — a thing you carry away.
    if (sc.rewardLabel) expect(afterKill.inv).toBe(beforeKill.inv + 1);
    else expect(sc.rewardCredits).toBeGreaterThan(0);

    await engine(page, e => e.dismissStageClear());
    await waitForStats(page, s => !s.stageClear, 'the screen to dismiss');

    // ── 9b. THE FIGHT IS ACTUALLY OVER ───────────────────────────────────
    // The rout wipes every enemy STANDING, but the capstone's escort was
    // still QUEUED in the spawn stream and kept warping in after the kill
    // (playtest: "the waves still continue after defeating a boss").  So the
    // dead boss must also have cancelled its reinforcements, and the ladder
    // must stay down: no pending spawns, no counted enemies arriving, no
    // next wave — held across more than a full grace window of sim time.
    const routed = await engine(page, e => ({
      pendingSpawns: e.waves.spawnList.length - e.waves.nextSpawnIdx,
      halted: e.waves.halted,
    }));
    expect(routed.pendingSpawns, 'the escort still queued died with its boss').toBe(0);
    expect(routed.halted, 'and the ladder is down').toBe(true);
    const waveAtKill = await engine(page, e => e.waveIndex);
    await advanceSim(page, 6); // > WAVE_CONSTANTS.GRACE_PERIOD (4.5s)
    const after = await engine(page, e => ({
      idx: e.waveIndex,
      state: e.waves.waveState,
      liveCounted: e.waves.countLiveTracked(e.currentMap.entities),
    }));
    expect(after.idx, 'no next wave started').toBe(waveAtKill);
    expect(after.state, 'the capstone wave completed rather than lingering').toBe('cleared');
    expect(after.liveCounted, 'and nothing warped in after the rout').toBe(0);

    // ── 10. HOME ─────────────────────────────────────────────────────────
    const returnPortal = await engine(page, e => {
      const p = e.currentMap.entities.find((x: any) => x.isPortal && !x.isDescent && x.active);
      return p ? p.portalTargetId : null;
    });
    expect(returnPortal).toBe('overworld');

    const beforeHome = await engine(page, e => ({
      credits: e.credits, score: e.score, health: e.player.health,
      inv: [...e.inventory], ship: [...e.shipSlots],
    }));
    await engine(page, (e, tid: string) => e.transitionToMap(tid), returnPortal!);
    const home = await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');

    const afterHome = await engine(page, e => ({
      credits: e.credits, score: e.score, health: e.player.health,
      inv: [...e.inventory], ship: [...e.shipSlots],
    }));
    expect(afterHome).toEqual(beforeHome);
    // Home is the surface: the depth resets, the wave ladder is gone.
    expect(await engine(page, e => e.stageIndex)).toBe(0);
    expect(home.wavesEnabled).toBeFalsy();

    // ARRIVAL IS BESIDE THE RIFT YOU CAME OUT OF, not across the hub at the
    // base station — otherwise the trip home is thrown away.
    const arrival = await engine(page, e => {
      const rift = e.currentMap.entities.find(
        (x: any) => x.isPortal && x.active && x.portalTargetId && x.portalTargetId !== 'overworld');
      const spawn = e.currentMap.playerSpawn;
      const near = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);
      return {
        // Distance to the NEAREST hub rift vs to the declared spawn point.
        toNearestRift: Math.min(...e.currentMap.entities
          .filter((x: any) => x.isPortal && x.active)
          .map((x: any) => near(e.player.position, x.position))),
        toSpawn: near(e.player.position, spawn),
        hasRift: !!rift,
      };
    });
    expect(arrival.hasRift).toBe(true);
    // Beside a rift, and NOT at the map's declared spawn.
    expect(arrival.toNearestRift).toBeLessThan(arrival.toSpawn);

    // ── 11. And the run's money still works ──────────────────────────────
    await dockAtStation(page);
    const finalShop = await stats(page);
    expect(finalShop.station).toBeDefined();
    const canStillBuy = await engine(page, e => {
      const snap = e.outfittingSnapshot();
      return snap.catalog.some((c: any) => c.affordable);
    });
    expect(canStillBuy).toBe(true);

    watch.assertClean();
  });

  test('the boss capstone lands on the stage wave, not one early', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await engine(page, e => e.transitionToMap('arena_universe'));
    await waitForStats(page, s => s.currentMapType === 'UNIVERSE', 'the arena');

    // Wave INDEX is 0-based; the capstone is index 5 (the 6th wave), which is
    // WAVE_INTERVAL ordinary waves and then the boss's own.  Off by one here
    // and the boss appears inside wave 5's stream instead of after it.
    //
    // Asserted BEHAVIOURALLY — by starting each wave for real and looking for
    // a boss on the field — rather than by calling the `isBossWave` predicate.
    // The predicate is a module function the debug handle cannot reach, and
    // testing it directly would not prove that WaveSystem consults it.
    const schedule = await engine(page, (e, n: number) => {
      const ctx = e.waveContext();
      const out: { index: number; boss: boolean }[] = [];
      for (let i = 0; i < n; i++) {
        for (const x of e.currentMap.entities) if (x.isBoss) x.active = false;
        e.waves.startWave(i, ctx);
        out.push({
          index: i,
          boss: e.currentMap.entities.some((x: any) => x.isBoss && x.active),
        });
      }
      return out;
    }, 13);

    const bossWaves = schedule.filter(w => w.boss).map(w => w.index);
    expect(bossWaves).toEqual([STAGE_WAVE_COUNT - 1, STAGE_WAVE_COUNT * 2 - 1]);

    watch.assertClean();
  });

  test('a wave ends on clear-the-field, not on the clock', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await engine(page, e => e.transitionToMap('arena_universe'));
    await waitForStats(page, s => s.currentMapType === 'UNIVERSE', 'the arena');
    await waitForStats(page, s => (s.waveNumber ?? 0) >= 1, 'wave 1');

    // Wait for the wave's budget to have fully spawned and for real enemies
    // to be on the field.
    await waitForEngine(
      page,
      e => e.entityIndex.enemies.some((x: any) => x.active && x.countsTowardWave !== false),
      'counted enemies on the field',
      60_000,
    );

    const mid = await stats(page);
    expect(mid.waveNumber).toBe(1);
    expect(mid.enemiesRemaining).toBeGreaterThan(0);

    // Kill EVERY counted enemy and drain the unspawned remainder.  The wave
    // must then end — completion is the field being clear, and the clock only
    // grades the speed bonus.
    await engine(page, e => {
      // Drain the spawn STREAM: completion is `every slot emitted` AND `the
      // counted field is clear`, so killing what is visible is only half of it.
      e.waves.nextSpawnIdx = e.waves.spawnList.length;
      for (const x of [...e.currentMap.entities]) {
        if (x.active && x.type === 'ENEMY' && x.countsTowardWave !== false) {
          x.killedByPlayer = true;
          e.handleEntityDeath(x);
        }
      }
    });

    await waitForEngine(
      page,
      e => e.runWavesCleared > 0,
      'the wave to end on a cleared field',
      60_000,
    );

    // The clear paid a physical salvage spray beside the player — the
    // between-wave reward beat now that the cards are gone.  Counted as
    // "drops that EXISTED", not "drops still lying there": the spray lands
    // within magnet range by design, so a test that reads the field a moment
    // later finds an empty floor and calls it a regression.
    const paid = await engine(page, e => ({
      cleared: e.runWavesCleared,
      // Every salvage drop the run has ever spawned carries an id prefix, so
      // collected ones are still countable on the master list until the next
      // sweep — and the credits they became are unambiguous either way.
      credits: e.credits,
      salvageOnField: e.activeDrops.filter((d: any) => d.dropType === 'salvage').length,
    }));
    expect(paid.cleared).toBeGreaterThanOrEqual(1);
    // Either the spray is still airborne or it has already become money.
    expect(paid.salvageOnField + (paid.credits > 0 ? 1 : 0)).toBeGreaterThan(0);

    watch.assertClean();
  });
});
