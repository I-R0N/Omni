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
 *   2. ROCK-DERIVED DUST IS EXEMPT, and deliberately so: that dust was rock
 *      a moment ago (a chip thrown by GRAIN_CHIP_DUST), so returning it to
 *      rock is conservation.  Routing it to a tile would MINT nebula out of
 *      terrain — a silent economy leak with no visible symptom at all.
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
 *  a condensed shard can merge on — either would corrupt a population count. */
function crystallise(page: any, o: { n: number; fromRock: boolean; blockHexes?: boolean }) {
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
          opt.fromRock, 'glass-shard', 0);
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
      const shipped = await crystallise(page, { n: N, fromRock: false });
      const shippedMat = shipped.materials / N;

      // The pre-call behaviour, one named step away.  A/B rather than an
      // absolute: the SHARE is a tuning number and may move again, but the
      // shipped step must always condense into other materials markedly less
      // often than the even split it replaced.
      await dialByName(page, 'nebulaTileShareName',
        v => v.startsWith('half'), e => (e as any).dbg.cycleNebulaTileShare(), 6);
      const old = await crystallise(page, { n: N, fromRock: false });
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

  test('rock-derived dust returns to rock and is never eligible for a tile',
    async ({ page }) => {
      const watch = await boot(page);
      await startRun(page, 'NEBULA_FIELD');

      const N = 200;
      const r = await crystallise(page, { n: N, fromRock: true });

      // CONSERVATION, not conversion.  This dust was rock a moment ago, so a
      // tile here would mint nebula out of terrain — and it would do it
      // silently, which is why the claim is worth an assertion of its own.
      expect(r.tiles, 'rock dust never thickens into a nebula tile').toBe(0);
      expect(r.materials, 'it condenses back to a material every time').toBe(N);

      watch.assertClean();
    });

  test('a tile that cannot be placed hands the mass back instead of losing it',
    async ({ page }) => {
      const watch = await boot(page);
      await startRun(page, 'NEBULA_FIELD');

      const N = 200;
      // Every candidate hex occupied, so every TILE roll fails to place.
      const r = await crystallise(page, { n: N, fromRock: false, blockHexes: true });

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
