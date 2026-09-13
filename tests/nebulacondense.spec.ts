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
 *   3. A FAILED TILE PLACEMENT RETURNS THE MASS.  The tile branch can find
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
          opt.material, 0);
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
