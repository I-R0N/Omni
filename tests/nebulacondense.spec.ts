/** What a condensed nebula cloud becomes — a tile, or something else.
 *
 *  A nebula pair that has accumulated enough mass CRYSTALLISES, and the
 *  outcome used to be a bare `Math.random() < 0.5` inside NebulaSystem: half
 *  the time the cloud thickened back into a nebula-TILE, half the time it
 *  condensed into a solid shard of whatever MATERIAL its hue maps to.
 *  Measured through the real sim that ran at its nominal rate (53.9% tile on
 *  NEBULA_FIELD, 61.1% on UNIVERSE over 90 s), so nebula leaked into the
 *  terrain about as fast as it rebuilt itself.
 *
 *  USER CALL: condensing into another material should be significantly
 *  rarer, and the tile route correspondingly more common.
 *
 *  THREE claims, each wrong in a way nothing else reports:
 *
 *   1. THE SPLIT IS THE LADDER'S, read at the roll.  The knob has to reach
 *      the real outcome — a share that is declared and never consulted looks
 *      exactly like one that works, because the roll still produces tiles.
 *   2. THE ROLL IS ORIGIN-BLIND.  Rock-derived dust was once exempt — it
 *      always condensed back to rock and could never thicken into a tile —
 *      and that is reversed (user call): dust that has already become nebula
 *      is nebula, and exempting it made material-derived cloud a second
 *      class.  What origin still decides is WHICH material the other branch
 *      picks, which is the half that is really conservation.
 *   3. THE LEDGER: a tile must COST more condense units than a tile's own
 *      shatter YIELDS, or the loop tile → shatter → coalesce → tile has a
 *      multiplier above one and nebula grows without bound.  Measured
 *      pre-change, it did: +6.4% total nebula over 150 s on a PASSIVE field.
 *      The yield side is measured off real shattered tiles rather than read
 *      from a constant — checking the inequality against a second opinion
 *      about the child count would pass while the real count drifted.
 *   4. A FAILED TILE PLACEMENT RETURNS THE MASS.  The tile branch can find
 *      every candidate hex occupied; both source shards have already faded
 *      by then, so a bare no-op DESTROYS the pair.  That was tolerated at an
 *      even split (measured 9.1% of tile rolls on UNIVERSE); with the tile
 *      share now dominant it would be most of the loss in the game.  This is
 *      the claim with no symptom whatsoever — mass quietly going missing
 *      looks like nothing.
 *
 *  Driven through the REAL `onComposeNebulaShardPair` rather than a
 *  reimplementation of the roll (harness rule 3): the roll, the rock
 *  exemption and the recovery all live inside it.
 */

import { test, expect } from '@playwright/test';
import { boot, dialByName, engine, startRun } from './helpers';

/** Drive N crystallising pairs through the real adapter and report what came
 *  out.  Counts at the SOURCE (the tile placement and the shard spawn) rather
 *  than by differencing populations, because a tile can also be destroyed and
 *  a condensed shard can merge on — either would corrupt a population count.
 *
 *  `material` is the COMMITTED target ShardSystem resolved — rock for
 *  rock-derived dust, the blended hue's material otherwise — and is the only
 *  trace of a cloud's origin the adapter now sees. */
function crystallise(page: any,
  o: { n: number; material: 'rock-shard' | 'glass-shard'; blockHexes?: boolean }) {
  return engine(page, (e: any, opt: any) => {
    const neb = e.nebulas;
    const ents = e.currentMap.entities;
    const out = { tiles: 0, materials: 0, nebulaShards: 0, lost: 0 };

    const origTile = neb.transmuteToTileAt.bind(neb);
    const origMat = neb.spawnCondensedShardAt.bind(neb);
    const origLeft = neb.spawnLeftoverNebulaShard.bind(neb);
    const origFree = neb.isGridCellFreeForNebula.bind(neb);

    // FORCE the no-op branch rather than waiting for a full hex neighbourhood:
    // it fires in ~9% of tile rolls in play, so a test that waited for it
    // would be a flake generator.  Nothing else about the path is stubbed.
    if (opt.blockHexes) neb.isGridCellFreeForNebula = () => false;

    neb.transmuteToTileAt = (...a: any[]) => {
      const ok = origTile(...a);
      if (ok) out.tiles++; else out.lost++;
      return ok;
    };
    neb.spawnCondensedShardAt = (...a: any[]) => { out.materials++; return origMat(...a); };
    neb.spawnLeftoverNebulaShard = (...a: any[]) => { out.nebulaShards++; return origLeft(...a); };

    try {
      const comp = [{ hex: '#a78bfa', weight: 1 }];
      for (let i = 0; i < opt.n; i++) {
        // Spread the pairs out so a placed tile cannot occupy the hex the
        // next pair wants — otherwise the run measures hex crowding rather
        // than the roll.
        const pos = { x: 600 + (i % 40) * 260, y: 600 + Math.floor(i / 40) * 260 };
        neb.onComposeNebulaShardPair(
          comp, pos, { x: 0, y: 0 }, ents, e.physics,
          opt.material, 0, true);   // affordable — the ledger has its own tests
      }
    } finally {
      neb.transmuteToTileAt = origTile;
      neb.spawnCondensedShardAt = origMat;
      neb.spawnLeftoverNebulaShard = origLeft;
      neb.isGridCellFreeForNebula = origFree;
    }
    return out;
  }, o);
}

/** Same idea as `crystallise`, but varying the LEDGER's affordability flag
 *  rather than the committed material — the flag the stall path can make
 *  false while the cloud is still crystallising. */
function crystalliseAfford(page: any, o: { n: number; afford: boolean }) {
  return engine(page, (e: any, opt: any) => {
    const neb = e.nebulas;
    const ents = e.currentMap.entities;
    const out = { tiles: 0, materials: 0 };
    const origTile = neb.transmuteToTileAt.bind(neb);
    const origMat = neb.spawnCondensedShardAt.bind(neb);
    neb.transmuteToTileAt = (...a: any[]) => { out.tiles++; return origTile(...a); };
    neb.spawnCondensedShardAt = (...a: any[]) => { out.materials++; return origMat(...a); };
    try {
      const comp = [{ hex: '#a78bfa', weight: 1 }];
      for (let i = 0; i < opt.n; i++) {
        const pos = { x: 600 + (i % 40) * 260, y: 600 + Math.floor(i / 40) * 260 };
        neb.onComposeNebulaShardPair(comp, pos, { x: 0, y: 0 }, ents, e.physics,
          'glass-shard', 0, opt.afford);
      }
    } finally {
      neb.transmuteToTileAt = origTile;
      neb.spawnCondensedShardAt = origMat;
    }
    return out;
  }, o);
}

test.describe('what a condensed nebula cloud becomes', () => {
  test('the tile share is the ladder\'s, and it reaches the real roll',
    async ({ page }) => {
      const watch = await boot(page);
      await startRun(page, 'NEBULA_FIELD');

      const N = 400;

      // SHIPPED step — leaving the nebula family is rare.
      const shipped = await crystallise(page, { n: N, material: 'glass-shard' });
      const shippedMat = shipped.materials / N;

      // The pre-call behaviour, one named step away.  A/B rather than an
      // absolute: the SHARE is a tuning number and may move again, but the
      // shipped step must always condense into other materials markedly less
      // often than the even split it replaced.
      await dialByName(page, 'nebulaTileShareName',
        v => v.startsWith('half'), e => (e as any).dbg.cycleNebulaTileShare(), 6);
      const old = await crystallise(page, { n: N, material: 'glass-shard' });
      const oldMat = old.materials / N;

      // Sampling noise on 400 Bernoulli trials at p≈0.5 is ~2.5% (1 s.d.),
      // so these bands are many s.d. clear of each other — the test is
      // measuring the knob, not the RNG.
      expect(oldMat, 'the old step still condenses about half the time')
        .toBeGreaterThan(0.40);
      expect(shippedMat, 'the shipped step, significantly rarer')
        .toBeLessThan(0.25);
      expect(shippedMat, 'and significantly rarer than the step it replaced')
        .toBeLessThan(oldMat * 0.6);
      // Every pair produces SOMETHING on both steps — no silent losses.
      expect(shipped.tiles + shipped.materials + shipped.nebulaShards,
        'the shipped step accounts for every pair').toBe(N);

      watch.assertClean();
    });

  test('material-derived dust rolls the tile at the SAME rate as virgin cloud',
    async ({ page }) => {
      const watch = await boot(page);
      await startRun(page, 'NEBULA_FIELD');

      /*  Rock-derived dust used to be EXEMPT — it always condensed back to
       *  rock and could never thicken into a tile.  Reversed (user call): a
       *  rock chip's dust has already become nebula by the time it is
       *  coalescing, and gating its outcome on where it came from made
       *  material-derived dust a second class of cloud.
       *
       *  The A/B is against a cloud committed to a DIFFERENT material, which
       *  is the only thing origin still decides.  "Same rate" is the claim, so
       *  this is a COMPARISON rather than an absolute — it survives the share
       *  being re-tuned. */

      /*  DIAL THE LADDER EXPLICITLY (harness rules 12/13).  Two reasons, and
       *  the second is what made this flake: a sibling test walks this same
       *  cycle and leaves it wherever it finished, so an undialled run here
       *  measures whatever step ran last; and the shipped step is the one
       *  whose sampling noise is smallest, since p far from 0.5 narrows the
       *  binomial.  Reading the default instead would also compare a step
       *  against itself the day that default moves. */
      await dialByName(page, 'nebulaTileShareName',
        v => v.startsWith('rare'), e => (e as any).dbg.cycleNebulaTileShare(), 6);

      /*  N and the BAND are sized off the binomial rather than guessed.  At
       *  the shipped p ≈ 0.875, one arm's s.d. is sqrt(p(1-p)/N) = 1.2% at
       *  N = 800, so the DIFFERENCE of two arms carries ~1.65%.  A 6-point
       *  band is therefore ~3.6 s.d. — the previous 400/5-point pairing was
       *  1.4 s.d. at the p = 0.5 a stale dial left behind, which is a test
       *  that fails roughly one run in six while the product is correct. */
      const N = 800, BAND = 0.06;
      const rock = await crystallise(page, { n: N, material: 'rock-shard' });
      const virgin = await crystallise(page, { n: N, material: 'glass-shard' });

      /*  COMPARE THE ROLL, NOT THE PLACEMENT.  `tiles` counts tiles that
       *  actually landed, and the first arm's tiles OCCUPY the hexes the
       *  second arm then rolls into — so the later arm's rolls fail to place
       *  and are handed back as nebula shards instead.  Measured, that alone
       *  separated the two arms far past any band: it is hex crowding, which
       *  is the third test's subject, not the share.  `tiles + lost` is the
       *  number of TILE ROLLS, which is exactly the quantity the share
       *  governs and the quantity this test is about. */
      const rockRolls = rock.tiles + rock.lost;
      const virginRolls = virgin.tiles + virgin.lost;

      expect(rockRolls, 'rock-derived dust DOES roll the tile branch')
        .toBeGreaterThan(0);
      expect(rock.tiles, 'and tiles actually land for it').toBeGreaterThan(0);
      expect(Math.abs(rockRolls / N - virginRolls / N),
        'at the same rate as a virgin cloud').toBeLessThan(BAND);
      // And the committed MATERIAL is still origin's to decide: when the roll
      // does not take the tile branch, rock dust returns to rock.  That half
      // is conservation and is deliberately untouched.
      expect(rock.materials + rockRolls, 'every pair still produces something')
        .toBe(N);

      watch.assertClean();
    });

  test('a tile that cannot be placed hands the mass back instead of losing it',
    async ({ page }) => {
      const watch = await boot(page);
      await startRun(page, 'NEBULA_FIELD');

      const N = 200;
      // Every candidate hex occupied, so every TILE roll fails to place.
      const r = await crystallise(page, { n: N, material: 'glass-shard', blockHexes: true });

      expect(r.tiles, 'no tile can be placed').toBe(0);
      expect(r.lost, 'so every tile roll hits the failure branch')
        .toBeGreaterThan(N * 0.5);
      // THE CLAIM: the pair's mass comes back as nebula rather than
      // vanishing.  Both source shards are already fading by this point, so
      // without the hand-back the cloud is simply destroyed — and one nebula
      // shard fewer looks like nothing at all.
      expect(r.nebulaShards, 'every failed placement returns a nebula shard')
        .toBe(r.lost);
      // And it does NOT fall through to the material branch: that would turn
      // a crowded neighbourhood into the very conversion this change exists
      // to make rare.
      expect(r.materials, 'a failed tile does not become a material shard')
        .toBe(N - r.lost);

      watch.assertClean();
    });
});

/*  THE MATERIAL LEDGER — a cloud may never pay for itself.
 *
 *  A nebula tile shatters into its own Voronoi cells, each carrying one
 *  condense unit, and a cloud buys a tile with units it has accumulated.  If
 *  the second number is not strictly larger than the first, the cycle has a
 *  multiplier above one and the clouds grow for ever.  It shipped at ~2x: a
 *  tile yielded 3-4 units and cost 2, because the tile branch of the roll had
 *  no price of its own and free-rode on the gate for the committed MATERIAL.
 *
 *  Measured on a passive NEBULA_FIELD over 150 s, total nebula bodies went
 *  1152 → 1226 (+6.4%) before and 1128 → 1116 (-1.1%) after.
 */
test.describe('the nebula material ledger', () => {
  test('a tile costs more than a tile\'s own shatter yields', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'NEBULA_FIELD');

    /*  MEASURE THE YIELD off real tiles through the real death path.  This is
     *  the half that must not be read from a constant: the child count comes
     *  out of the grain spec's site placement, its count clamps and the
     *  sliver-retirement pass, so a grain retune moves it with nothing else
     *  in the codebase noticing. */
    const r = await engine(page, () => {
      const e: any = (window as any).__omniEngine;
      const N: any = (window as any).__omniNebula;
      const ents = e.currentMap.entities;
      const tiles = ents.filter((x: any) =>
        x.active && x.shardVariant === 'nebula-tile').slice(0, 40);
      const perTile: number[] = [];
      for (const t of tiles) {
        const before = new Set(ents.map((x: any) => x.id));
        t.health = 0;
        e.handleEntityDeath(t, false);
        const kids = e.currentMap.entities.filter((x: any) =>
          !before.has(x.id) && x.active && x.shardVariant === 'nebula-shard');
        // A child that sets no units enters the cycle worth the default ONE.
        perTile.push(kids.reduce((sum: number, k: any) =>
          sum + (k.nebulaCondenseUnits ?? 1), 0));
        for (const k of kids) k.active = false;
      }
      return {
        tiles: perTile.length,
        yieldMax: Math.max(...perTile),
        yieldAvg: perTile.reduce((a, b) => a + b, 0) / perTile.length,
        cost: N.nebulaTileCost(),
        declaredYieldMax: N.NEBULA_TILE_SHATTER_YIELD_MAX,
      };
    });

    expect(r.tiles, 'broke a useful sample of real tiles').toBeGreaterThan(20);
    // THE CLAIM, against the MAXIMUM rather than the mean: an average-only
    // bound still lets a lucky tile fund its own replacement.
    expect(r.cost, 'a tile costs more than the most one can yield')
      .toBeGreaterThan(r.yieldMax);
    // And the constant that documents the bar has not drifted from reality —
    // this is what makes a grain retune show up here rather than as clouds
    // slowly creeping outward in play.
    expect(r.yieldMax, 'the declared yield bar still matches what tiles do')
      .toBeLessThanOrEqual(r.declaredYieldMax);

    watch.assertClean();
  });

  test('every drain step keeps the ledger true, and leaves tiles reachable',
    async ({ page }) => {
      const watch = await boot(page);
      await startRun(page, 'NEBULA_FIELD');

      const r = await engine(page, () => {
        const N: any = (window as any).__omniNebula;
        return {
          steps: N.NEBULA_DRAIN_CYCLE.map((s: any) => ({
            name: s.name, cost: s.tileCost, loss: s.mergeLoss,
          })),
          yieldMax: N.NEBULA_TILE_SHATTER_YIELD_MAX,
        };
      });

      expect(r.steps.length, 'the ladder has steps').toBeGreaterThan(1);
      for (const s of r.steps) {
        // (a) NO STEP CAN EXPRESS GROWTH.  The ladder tunes how fast nebula
        // recedes; that it recedes at all is the rule, not a preference.
        expect(s.cost, `${s.name}: costs more than a shatter yields`)
          .toBeGreaterThan(r.yieldMax);
        // (b) AND NO STEP SILENTLY STOPS TILES FORMING.  Repeated coalescence
        // with 1-unit debris follows u' = (u+1)(1-loss) and converges on a
        // CEILING of (1-loss)/loss.  A ceiling below the cost means no cloud
        // ever affords a tile again — a dead feature with nothing in the code
        // to say why, which is exactly the failure this assertion exists for.
        const ceiling = (1 - s.loss) / s.loss;
        expect(ceiling, `${s.name}: accumulation ceiling clears the tile cost`)
          .toBeGreaterThan(s.cost);
      }

      watch.assertClean();
    });

  test('a coalescence sheds material instead of conserving it',
    async ({ page }) => {
      const watch = await boot(page);
      await startRun(page, 'NEBULA_FIELD');

      /*  Driven through the REAL coalescence (ShardSystem.growNebulaShard is
       *  what the sub-cost branch calls), because the loss has to land on the
       *  field the gate later reads — applying it anywhere else would leave
       *  the merge looking lossy while the accumulation stayed free. */
      const r = await engine(page, () => {
        const e: any = (window as any).__omniEngine;
        const N: any = (window as any).__omniNebula;
        const sh = e.shards;
        const mk = (units: number) => ({
          id: `ledger_${units}_${Math.random()}`,
          type: 'STRUCTURE', shardVariant: 'nebula-shard',
          position: { x: 1000, y: 1000 }, velocity: { x: 0, y: 0 },
          size: { x: 20, y: 20 }, mass: 0.01, active: true, rotation: 0,
          color: '#a78bfa', nebulaCondenseUnits: units,
          nebulaColorComposition: [{ hex: '#a78bfa', weight: 1 }],
        });
        const a = mk(2), b = mk(2);
        const combined = 4;
        sh.growNebulaShard(a, b, a.nebulaColorComposition,
          combined * (1 - N.nebulaMergeLoss()), 'glass-shard', 1,
          { x: 1000, y: 1000 }, { x: 0, y: 0 });
        return { combined, kept: a.nebulaCondenseUnits, loss: N.nebulaMergeLoss() };
      });

      expect(r.loss, 'the loss is a real cut').toBeGreaterThan(0);
      expect(r.kept, 'the survivor carries LESS than the pair put in')
        .toBeLessThan(r.combined);
      expect(r.kept, 'and exactly the authored fraction of it')
        .toBeCloseTo(r.combined * (1 - r.loss), 6);

      watch.assertClean();
    });

  test('a cloud that cannot afford a tile does not get one', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'NEBULA_FIELD');

    /*  `canAffordTile` is a SEPARATE answer from the accumulation gate, and
     *  this is the case that needs it: the STALL path force-crystallises a
     *  cloud that never reached its cost, so without the guard a stalled
     *  under-price cloud could still buy a tile and re-open the loop.  Driven
     *  straight at the adapter with the flag false, since reaching a stall in
     *  play is a timing race. */
    const r = await crystalliseAfford(page, { n: 200, afford: false });
    const ok = await crystalliseAfford(page, { n: 200, afford: true });

    expect(r.tiles, 'an unaffordable cloud never becomes a tile').toBe(0);
    expect(r.materials, 'it condenses to its material instead').toBe(200);
    // The control: with the SAME share, an affordable cloud mostly does.
    expect(ok.tiles, 'while an affordable one does').toBeGreaterThan(100);

    watch.assertClean();
  });
});
