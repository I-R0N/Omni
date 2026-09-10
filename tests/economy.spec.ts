/** Economy invariants.
 *
 *  Re-derived from the coverage the Pair A log records for `smoke-a1` (the
 *  death penalty charged EXACTLY once, the per-life salvage ledger) and the
 *  boss log's B1 (the buy/sell pricing invariant, the loadout untouched by a
 *  payout).  These are the rules that, if they break, quietly turn the game
 *  into a different game — money appearing from nowhere, or a resale loop
 *  that pays.
 *
 *  Every assertion here reads a number the SIM owns, not a rendered string.
 *  The rendered-string direction is `attribution.spec.ts`, which is a
 *  different question (does the panel agree with the sim) and is asserted
 *  separately on purpose.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, stats, startRun, waitForStats, dockAtStation } from './helpers';

// Mirrors of the constants under test.  Deliberately duplicated rather than
// imported: a test that imports the value it is checking asserts that the
// constant equals itself.  If a tuning pass moves these, THIS FILE should
// have to change — that is the alarm working.
const CREDITS_PER_DROP = 1000;
const DEATH_PENALTY_FRACTION = 0.25;
const DEATH_PENALTY_MIN = 12500;
const SELL_FRACTION = 0.9;
const SCRAP_FRACTION = 0.09;

/** Collect `n` salvage drops through the engine's real collection path.
 *  Drops are spawned on the player and handed to `applyDropEffect` directly
 *  rather than flown into by magnet physics: the magnet is not what this
 *  suite is testing, and waiting on it is how a prior session got flakes. */
async function collectSalvage(page: any, n: number) {
  return engine(
    page,
    (e, count: number) => {
      for (let i = 0; i < count; i++) {
        const before = e.currentMap.entities.length;
        e.drops.spawnSalvageDrop(
          e.currentMap.entities,
          e.activeDrops,
          { x: e.player.position.x, y: e.player.position.y },
        );
        const drop = e.currentMap.entities[before];
        if (drop) {
          e.applyDropEffect(drop);
          // Deactivating is HALF of collection — the engine's own drop scan
          // does `applyDropEffect(drop); drop.active = false;` and skipping
          // the second half leaves the drop live for the magnet to collect a
          // second time, paying twice.
          drop.active = false;
          // ...and mirror the compaction sweep too: pull it back out of the
          // activeDrops CACHE.  This loop runs synchronously inside one sim
          // step, so the sweep never runs between iterations and the cache
          // grows by one per spawn — and spawnSalvageDrop silently no-ops at
          // MAX_ACTIVE_DROPS, which is exactly the 100 the penalty test
          // spawns.  One stray drop already in the world (any enemy death
          // sprays salvage) tips the last spawn over the cap and the balance
          // comes up one drop short — a CI flake that took months to roll.
          if (e.activeDrops[e.activeDrops.length - 1] === drop) {
            e.activeDrops.pop();
          }
        }
      }
      return { credits: e.credits, earned: e.runCreditsEarned };
    },
    n,
  );
}

test.describe('economy', () => {
  test('collecting salvage is the only thing that mints credits', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    const before = await engine(page, e => ({
      credits: e.credits,
      runEarned: e.runCreditsEarned,
      lifeEarned: e.lifeCreditsEarned,
      score: e.score,
    }));
    expect(before.credits).toBe(0);
    expect(before.runEarned).toBe(0);

    // Salvage pays, and pays through earnCredits — so the balance and BOTH
    // income ledgers move together by exactly the same amount.
    const after = await collectSalvage(page, 5);
    expect(after.credits).toBe(before.credits + 5 * CREDITS_PER_DROP);
    expect(after.earned).toBe(before.runEarned + 5 * CREDITS_PER_DROP);

    const ledgers = await engine(page, e => ({
      credits: e.credits,
      run: e.runCreditsEarned,
      life: e.lifeCreditsEarned,
    }));
    expect(ledgers.run).toBe(ledgers.credits);
    expect(ledgers.life).toBe(ledgers.credits);

    // SCORE MINTS NOTHING.  The old 1:1 score→salvage mirror is gone; score
    // is the pure performance metric and buys nothing (CLAUDE.md §8).
    const scored = await engine(page, e => {
      const c0 = e.credits, r0 = e.runCreditsEarned;
      e.awardScore(50_000);
      return { c0, r0, c1: e.credits, r1: e.runCreditsEarned, score: e.score };
    });
    expect(scored.score).toBeGreaterThanOrEqual(50_000);
    expect(scored.c1).toBe(scored.c0);
    expect(scored.r1).toBe(scored.r0);

    // The HUD sees the same balance the sim holds, every frame — not only
    // while paused.
    const s = await stats(page);
    expect(s.credits).toBe(ledgers.credits);

    watch.assertClean();
  });

  test('resale never profits, and scrap is the steeper cut', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await dockAtStation(page);

    // Fund the purchase directly — earning it is the loop suite's job.
    await engine(page, e => e.addDebugCredits(500_000));

    const sellCycle = await engine(page, e => {
      const start = e.credits;
      // Buy the same item twice: one to sell back at a station, one to scrap.
      const bought = e.purchaseModule('gunnery_mk1') && e.purchaseModule('gunnery_mk1');
      const afterBuy = e.credits;
      const price = e.modulePrice(4242) === 4242 ? null : 'modulePrice is not identity';

      const inv: number[] = [];
      e.inventory.forEach((id: string | null, i: number) => {
        if (id === 'gunnery_mk1') inv.push(i);
      });
      const snap = e.outfittingSnapshot();
      const row = snap.inventory[inv[0]];

      const sold = e.sellModule(inv[0]);
      const afterSell = e.credits;
      const scrapped = e.scrapModule(inv[1]);
      const afterScrap = e.credits;

      return {
        bought, sold, scrapped, price,
        start, afterBuy, afterSell, afterScrap,
        cost: snap.catalog.find((c: any) => c.id === 'gunnery_mk1').cost,
        sellValue: row.sellValue,
        scrapValue: row.scrapValue,
        // Resale is a REFUND of money already earned, so it must not touch
        // the income ledger — routing it there would double-count.
        runEarned: e.runCreditsEarned,
      };
    });

    expect(sellCycle.bought).toBe(true);
    expect(sellCycle.sold).toBe(true);
    expect(sellCycle.scrapped).toBe(true);
    expect(sellCycle.price).toBeNull();

    const cost = sellCycle.cost;
    expect(sellCycle.afterBuy).toBe(sellCycle.start - 2 * cost);
    expect(sellCycle.sellValue).toBe(Math.round(cost * SELL_FRACTION));
    expect(sellCycle.scrapValue).toBe(Math.round(cost * SCRAP_FRACTION));
    expect(sellCycle.afterSell).toBe(sellCycle.afterBuy + sellCycle.sellValue);
    expect(sellCycle.afterScrap).toBe(sellCycle.afterSell + sellCycle.scrapValue);

    // THE INVARIANT: a full buy→sell cycle strictly loses money, and
    // buy→scrap loses more.  This is what stops the resale loop being a pump
    // (CLAUDE.md §8, `modulePrice` is the one pricing seam).
    expect(sellCycle.sellValue).toBeLessThan(cost);
    expect(sellCycle.scrapValue).toBeLessThan(sellCycle.sellValue);
    expect(sellCycle.afterScrap).toBeLessThan(sellCycle.start);

    // Resale did not inflate "earned this run".
    expect(sellCycle.runEarned).toBe(0);

    watch.assertClean();
  });

  test('purchase lands in inventory; installing activates only on adjacency', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await dockAtStation(page);
    await engine(page, e => e.addDebugCredits(500_000));

    // A run starts LEAN: free Base Hull on the ship centre, Blaster on a gun
    // hex, empty inventory, no shield (CLAUDE.md §5).
    const lean = await engine(page, e => e.outfittingSnapshot());
    expect(lean.ship[0]?.id).toBe('hull_base');
    expect(lean.inventory.every((i: any) => i === null)).toBe(true);
    expect(lean.gunsMounted).toBe(1);

    // Buying puts the item in the INVENTORY — not on the ship.
    const bought = await engine(page, e => {
      const ok = e.purchaseModule('engine_mk1');
      const snap = e.outfittingSnapshot();
      return { ok, inv: snap.inventory.map((i: any) => i?.id ?? null), ship: snap.ship.map((h: any) => h?.id ?? null) };
    });
    expect(bought.ok).toBe(true);
    expect(bought.inv.filter((i: string | null) => i === 'engine_mk1')).toHaveLength(1);
    expect(bought.ship).not.toContain('engine_mk1');

    // Install it on a hex that does NOT touch the hull.  The 7-flower's
    // centre (0) touches all six; ring tiles touch the centre + two ring
    // neighbours.  So no ring hex is adjacent to another ring hex two steps
    // away — hex 2 and hex 5 are opposite.  Move the hull out to hex 5 first,
    // then engine on hex 2 is connected to nothing.
    const offline = await engine(page, e => {
      e.moveModule({ area: 'ship', idx: 0 }, { area: 'ship', idx: 5 });
      const invIdx = e.inventory.indexOf('engine_mk1');
      e.moveModule({ area: 'inventory', idx: invIdx }, { area: 'ship', idx: 2 });
      const snap = e.outfittingSnapshot();
      return {
        engine: snap.ship[2],
        speedMult: e.moduleSpeedMult,
      };
    });
    expect(offline.engine.id).toBe('engine_mk1');
    // Installed but OFFLINE: it contributes nothing and names the family it
    // must touch.
    expect(offline.engine.active).toBe(false);
    expect(offline.engine.requires).toBe('hull');
    expect(offline.speedMult).toBeCloseTo(1, 5);

    // Move it next to the hull and it comes alive — same module, same hex
    // group, one adjacency apart.
    const online = await engine(page, e => {
      e.moveModule({ area: 'ship', idx: 2 }, { area: 'ship', idx: 4 });
      const snap = e.outfittingSnapshot();
      return { engine: snap.ship[4], speedMult: e.moduleSpeedMult };
    });
    expect(online.engine.id).toBe('engine_mk1');
    expect(online.engine.active).toBe(true);
    // Engine Mk I is +8% top speed.
    expect(online.speedMult).toBeCloseTo(1.08, 5);

    watch.assertClean();
  });

  test('shield plating with no core is connected but contributes nothing', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await dockAtStation(page);
    await engine(page, e => e.addDebugCredits(500_000));

    const plateOnly = await engine(page, e => {
      e.purchaseModule('plating_mk1');
      const i = e.inventory.indexOf('plating_mk1');
      e.moveModule({ area: 'inventory', idx: i }, { area: 'ship', idx: 1 });
      const snap = e.outfittingSnapshot();
      const shieldLine = snap.statLines.find((l: any) => l.id === 'shield');
      return {
        hex: snap.ship[1],
        maxShield: e.player.maxShield,
        note: shieldLine.note,
        contributor: shieldLine.contributors.find((c: any) => c.moduleId === 'plating_mk1'),
      };
    });

    // Adjacency is satisfied (plating⇢hull, and the hull is on the centre),
    // so the HEX reads active …
    expect(plateOnly.hex.active).toBe(true);
    // … but `maxShield` is gated to 0 until a shield CORE is installed, so
    // the plate's amount is NOT in the total, and the panel says why.
    expect(plateOnly.maxShield).toBe(0);
    expect(plateOnly.note).toBe('no shield core installed');
    expect(plateOnly.contributor.active).toBe(false);
    expect(plateOnly.contributor.requires).toBe('shield core');

    // Add the core and the same plate starts counting.
    const withCore = await engine(page, e => {
      e.purchaseModule('shield');
      const i = e.inventory.indexOf('shield');
      e.moveModule({ area: 'inventory', idx: i }, { area: 'ship', idx: 2 });
      const snap = e.outfittingSnapshot();
      const shieldLine = snap.statLines.find((l: any) => l.id === 'shield');
      return {
        maxShield: e.player.maxShield,
        note: shieldLine.note,
        contributor: shieldLine.contributors.find((c: any) => c.moduleId === 'plating_mk1'),
      };
    });
    expect(withCore.maxShield).toBeGreaterThan(0);
    expect(withCore.note).toBeUndefined();
    expect(withCore.contributor.active).toBe(true);

    watch.assertClean();
  });

  test('death charges the salvage penalty exactly once', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // A balance large enough that the PERCENTAGE wins over the flat floor,
    // so the assertion exercises the max() and not just the constant.
    await collectSalvage(page, 100);
    const balance = await engine(page, e => e.credits as number);
    expect(balance).toBe(100 * CREDITS_PER_DROP);

    const expectedLoss = Math.min(
      balance,
      Math.max(Math.floor(balance * DEATH_PENALTY_FRACTION), DEATH_PENALTY_MIN),
    );

    await engine(page, e => e.startExplosion(e.player));
    const dead = await waitForStats(page, s => !!s.runSummary, 'the run summary');

    expect(dead.runSummary!.creditsLost).toBe(expectedLoss);
    expect(dead.runSummary!.credits).toBe(balance - expectedLoss);
    expect(dead.runSummary!.creditsLostRun).toBe(expectedLoss);
    // The life ledger reports what THIS sortie brought back, before the loss.
    expect(dead.runSummary!.creditsEarnedLife).toBe(balance);
    // The run gross keeps climbing and is deliberately not the headline.
    expect(dead.runSummary!.creditsEarned).toBe(balance);

    // CHARGED ONCE.  The death screen leaves the sim RUNNING (it is the one
    // full-screen overlay that does not freeze the world), so the guard that
    // stops the explosion branch re-firing is load-bearing.  Let real sim
    // time pass with the summary up and re-read.
    const held = await engine(page, e => e.credits as number);
    await page.waitForTimeout(1500);
    const stillHeld = await engine(page, e => ({
      credits: e.credits,
      lost: e.lastDeathCreditsLost,
      lostRun: e.runCreditsLost,
    }));
    expect(stillHeld.credits).toBe(held);
    expect(stillHeld.lost).toBe(expectedLoss);
    expect(stillHeld.lostRun).toBe(expectedLoss);

    // Nor does respawning charge it again.
    await engine(page, e => e.respawnFromDeath());
    await waitForStats(page, s => !s.runSummary, 'the summary to clear');
    const afterRespawn = await engine(page, e => ({ credits: e.credits, lostRun: e.runCreditsLost }));
    expect(afterRespawn.credits).toBe(balance - expectedLoss);
    expect(afterRespawn.lostRun).toBe(expectedLoss);

    watch.assertClean();
  });

  test('a broke pilot is zeroed, never driven negative', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // Below the flat floor, so the floor wins the max() and the clamp to the
    // balance is what stops it going negative.
    await collectSalvage(page, 3);
    const balance = await engine(page, e => e.credits as number);
    expect(balance).toBeLessThan(DEATH_PENALTY_MIN);

    await engine(page, e => e.startExplosion(e.player));
    const dead = await waitForStats(page, s => !!s.runSummary, 'the run summary');

    expect(dead.runSummary!.creditsLost).toBe(balance);
    expect(dead.runSummary!.credits).toBe(0);
    const c = await engine(page, e => e.credits as number);
    expect(c).toBe(0);
    expect(c).toBeGreaterThanOrEqual(0);

    watch.assertClean();
  });

  test('money already spent on modules is untouched by the penalty', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await dockAtStation(page);

    await engine(page, e => e.addDebugCredits(100_000));
    const spent = await engine(page, e => {
      const start = e.credits;
      e.purchaseModule('hull_mk3');   // 18000
      return { start, after: e.credits, cost: start - e.credits };
    });
    expect(spent.cost).toBeGreaterThan(0);

    await engine(page, e => e.undock());
    await waitForStats(page, s => !s.station, 'undock');

    await engine(page, e => e.startExplosion(e.player));
    const dead = await waitForStats(page, s => !!s.runSummary, 'the run summary');

    // The penalty is a fraction of the UNSPENT balance — it taxes hoarding,
    // not investment.  The module survives the death; only the cash is cut.
    const expected = Math.min(
      spent.after,
      Math.max(Math.floor(spent.after * DEATH_PENALTY_FRACTION), DEATH_PENALTY_MIN),
    );
    expect(dead.runSummary!.creditsLost).toBe(expected);

    const kept = await engine(page, e => e.inventory.filter((i: string | null) => i === 'hull_mk3').length);
    expect(kept).toBe(1);

    watch.assertClean();
  });
});
