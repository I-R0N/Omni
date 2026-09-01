/** Map composition (gauntlet step 5 G7).
 *
 *  G7 moved the natural maps' tile-variant mix out of the map classes and
 *  into `MAP_POPULATION`, which CLAUDE.md §5 had already flagged as only
 *  half-true ("treat MAP_POPULATION as authoritative for documentation but
 *  verify the relevant MapClasses subclass too"). It was a DATA MOVE, so the
 *  thing to prove is that nothing about the generated worlds changed.
 *
 *  Cluster generation is random — counts and sizes both — so equivalence is
 *  asserted as BANDS around the populations measured before the move, wide
 *  enough to swallow the natural run-to-run spread and narrow enough that a
 *  real change in a count or a size range falls outside. The bands are
 *  hard-coded rather than derived (harness rule 7): a rebalance SHOULD have
 *  to come here and say so.
 *
 *  Seven Rings is the strong case — its geometry is deterministic, so its
 *  counts are asserted exactly, and the ring ORDER is asserted directly
 *  against the table's intent (soft inside, indestructible wall outside).
 *
 *  Measured baseline, 8 builds per map, before and after the move:
 *
 *    UNIVERSE     glass 584→566   plastic 142→148  metal  50→47   nebula 1623→1641
 *    POCKET       glass  75→72    plastic  37→36   metal  15→17   nebula  103→102
 *    SEVEN_RINGS  glass 234→234   plastic 528→528  metal 762→762  indestructible 477→477
 */

import { test, expect } from '@playwright/test';
import { boot, engine, startRun, waitForEngine } from './helpers';

/** Rebuild `map` `runs` times and return per-variant min/max/mean. */
function populations(page: any, runs = 4) {
  return engine(page, (e, n: number) => {
    const samples: Record<string, number>[] = [];
    for (let i = 0; i < n; i++) {
      e.resetAndLoadSelectedMap();
      const by: Record<string, number> = {};
      for (const en of e.currentMap.entities) {
        if (!en.shardVariant) continue;
        by[en.shardVariant] = (by[en.shardVariant] || 0) + 1;
      }
      samples.push(by);
    }
    const keys = new Set<string>();
    samples.forEach(s => Object.keys(s).forEach(k => keys.add(k)));
    const out: Record<string, { min: number; max: number; mean: number }> = {};
    for (const k of keys) {
      const v = samples.map(s => s[k] || 0);
      out[k] = {
        min: Math.min(...v),
        max: Math.max(...v),
        mean: v.reduce((a, b) => a + b, 0) / v.length,
      };
    }
    return out;
  }, runs);
}

function expectBand(
  pops: Record<string, { min: number; max: number; mean: number }>,
  variant: string,
  lo: number,
  hi: number,
) {
  const p = pops[variant];
  expect(p, `${variant} should be generated at all`).toBeTruthy();
  expect(p.mean, `${variant} mean ${p.mean} outside [${lo}, ${hi}]`).toBeGreaterThanOrEqual(lo);
  expect(p.mean, `${variant} mean ${p.mean} outside [${lo}, ${hi}]`).toBeLessThanOrEqual(hi);
}

test.describe('map composition — MAP_POPULATION is the authority', () => {
  test('Deep Space populates to its recorded mix', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'UNIVERSE');
    const pops = await populations(page);

    expectBand(pops, 'glass-tile', 440, 700);
    expectBand(pops, 'plastic-tile', 100, 200);
    expectBand(pops, 'metal-tile', 30, 70);
    expectBand(pops, 'nebula-tile', 1350, 1950);
    // Free-spawned rock is a fixed count, not a cluster roll.
    expect(pops['rock-shard'].min).toBe(pops['rock-shard'].max);

    // Decision #6: indestructible tiles are for deliberate borders, never
    // random clusters in a natural map.
    expect(pops['indestructible-tile']).toBeUndefined();

    watch.assertClean();
  });

  test('Pocket populates to its recorded mix', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'POCKET');
    const pops = await populations(page);

    expectBand(pops, 'glass-tile', 50, 100);
    expectBand(pops, 'plastic-tile', 22, 55);
    expectBand(pops, 'metal-tile', 8, 28);
    expectBand(pops, 'nebula-tile', 70, 135);
    expect(pops['indestructible-tile']).toBeUndefined();

    watch.assertClean();
  });

  test('Seven Rings is unchanged to the tile, and reads soft-inside-hard-outside', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page, 'SEVEN_RINGS');
    const pops = await populations(page, 2);

    // Ring geometry is deterministic, so this is exact — the strongest form
    // of "the data move changed nothing".
    expect(pops['glass-tile'].min).toBe(234);
    expect(pops['glass-tile'].max).toBe(234);
    expect(pops['plastic-tile'].min).toBe(528);
    expect(pops['plastic-tile'].max).toBe(528);
    expect(pops['metal-tile'].min).toBe(762);
    expect(pops['metal-tile'].max).toBe(762);
    expect(pops['indestructible-tile'].min).toBe(477);
    expect(pops['indestructible-tile'].max).toBe(477);

    // And the ORDER, which is what the table's `tileRings` entries actually
    // say: difficulty readable by radius. Median radius per variant, since a
    // ring is a band rather than a single distance.
    const radii = await engine(page, e => {
      const byVariant: Record<string, number[]> = {};
      for (const en of e.currentMap.entities) {
        if (!en.shardVariant || !String(en.shardVariant).endsWith('-tile')) continue;
        const r = Math.hypot(en.position.x, en.position.y);
        (byVariant[en.shardVariant] ||= []).push(r);
      }
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(byVariant)) {
        v.sort((a, b) => a - b);
        out[k] = v[Math.floor(v.length / 2)];
      }
      return out;
    });

    expect(radii['glass-tile']).toBeLessThan(radii['plastic-tile']);
    expect(radii['plastic-tile']).toBeLessThan(radii['metal-tile']);
    expect(radii['metal-tile']).toBeLessThan(radii['indestructible-tile']);

    watch.assertClean();
  });

  test('the Overworld hub still builds its terrain, stations and rifts', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // The hub was already reading the table; it goes through the same shared
    // helpers now, so it is worth one assertion that nothing fell out.
    const r = await engine(page, e => ({
      stations: e.stations.length,
      portals: e.portals.length,
      arenaRifts: e.portals.filter((p: any) => String(p.portalTargetId).startsWith('arena_')).length,
      rackRifts: e.portals.filter((p: any) => String(p.portalTargetId).startsWith('field_')).length,
      glass: e.currentMap.entities.filter((x: any) => x.shardVariant === 'glass-tile').length,
      nebula: e.currentMap.entities.filter((x: any) => x.shardVariant === 'nebula-tile').length,
      centers: e.currentMap.nebulaClusterCenters.length,
    }));

    expect(r.stations).toBe(4);
    // Four arena rifts PLUS the six-portal test rack beside the home station
    // (the star-field gauntlet's S12). Asserted as its parts rather than as
    // the total, so this says WHICH rifts are expected instead of restating a
    // number that changes whenever one is added.
    expect(r.arenaRifts).toBe(4);
    expect(r.rackRifts).toBe(6);
    expect(r.portals).toBe(r.arenaRifts + r.rackRifts);
    expect(r.glass).toBeGreaterThan(50);
    expect(r.nebula).toBeGreaterThan(300);
    // The background puff layer is driven by these, so an empty list means
    // a nebula map with no backdrop.
    expect(r.centers).toBeGreaterThan(0);

    watch.assertClean();
  });
});

test.describe('portal arrival — the wormhole throws you clear', () => {
  /** Arriving used to land the ship DEAD-STOPPED at ARRIVAL_OFFSET (165) from
   *  the exit mouth — which is inside that rift's own gravity well, so the
   *  hole it had just come out of started pulling it back in.  The arrival now
   *  carries an outward velocity sized to leave the well outright.
   *
   *  The assertion is the REQUIREMENT, not the mechanism: let the sim run and
   *  check the ship actually ends up beyond GRAVITY_RANGE, still moving away.
   *  Testing "velocity was set" would pass just as happily on a shove too weak
   *  to escape, which is the whole thing being fixed. */
  test('the player is ejected hard enough to leave the exit rift behind', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    const arrived = await page.evaluate(() => {
      const e = (window as any).__omniEngine;
      const rift = e.portals.find((p: any) => String(p.portalTargetId).startsWith('arena_'));
      if (!rift) return null;
      e.player.position.x = rift.position.x + 180;
      e.player.position.y = rift.position.y;
      if (!e.transitionToMap(rift.portalTargetId)) return null;
      const exit = e.portals.find((p: any) => p.portalTargetId === 'overworld');
      return {
        speed: Math.hypot(e.player.velocity.x, e.player.velocity.y),
        dist: Math.hypot(e.player.position.x - exit.position.x,
                         e.player.position.y - exit.position.y),
        range: exit.gravityRange,
      };
    });

    expect(arrived, 'an arena rift and a way home').not.toBeNull();
    // Thrown, not deposited — and outward, so the first thing the ship does is
    // leave rather than drift back through the door.
    expect(arrived!.speed).toBeGreaterThan(5);
    expect(arrived!.dist).toBeLessThan(arrived!.range);   // starts INSIDE the well

    // Now let the well do its worst.  The escape takes well under a second at
    // the shipped speed; poll for it rather than waiting a fixed time, and let
    // the timeout be the failure if the ship never gets out.
    await waitForEngine(page, e => {
      const exit = e.portals.find((p: any) => p.portalTargetId === 'overworld');
      if (!exit) return false;
      return Math.hypot(e.player.position.x - exit.position.x,
                        e.player.position.y - exit.position.y) > exit.gravityRange;
    }, 'the ship to climb out of the exit rift\'s gravity well', 20_000);

    // And it is still LEAVING at the boundary — escaped, not lobbed to the
    // edge and caught.  Sampled as a distance that keeps growing.
    const escaping = await page.evaluate(async () => {
      const e = (window as any).__omniEngine;
      const exit = e.portals.find((p: any) => p.portalTargetId === 'overworld');
      const d = () => Math.hypot(e.player.position.x - exit.position.x,
                                 e.player.position.y - exit.position.y);
      const before = d();
      await new Promise(r => setTimeout(r, 600));
      return { before, after: d() };
    });
    expect(escaping.after).toBeGreaterThan(escaping.before);

    watch.assertClean();
  });
});

test.describe('a rift can only eat what fits in its mouth', () => {
  /** Two rules, both asked for after play-testing:
   *   - a LARGE object crossing the centre is flung out along its own
   *     heading instead of being swallowed,
   *   - anything that steers itself is held off the throat so it cannot be
   *     captured and parked there.
   *
   *  Both are asserted as OUTCOMES over live sim time — did it get out, did
   *  it stay out — rather than by reading the impulse back, because "a
   *  velocity was written" would pass on a shove the well then reels in. */
  test('a boulder crossing the centre is flung through, not swallowed', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    const planted = await page.evaluate(() => {
      const e = (window as any).__omniEngine;
      const rift = e.portals.find((p: any) => String(p.portalTargetId).startsWith('arena_'));
      const big = e.currentMap.entities.find((x: any) => x.active && x.mass !== Infinity
        && x.shardVariant === 'rock-shard' && Math.max(x.size.x, x.size.y) >= 60);
      if (!rift || !big) return null;
      // Drop it ON the centre, moving, so this frame's gravity pass sees it
      // crossing rather than approaching.
      big.position.x = rift.position.x;
      big.position.y = rift.position.y;
      big.velocity.x = 3; big.velocity.y = 0;
      big.portalGraceTimer = 0;
      return { id: big.id, size: Math.max(big.size.x, big.size.y),
               riftX: rift.position.x, riftY: rift.position.y,
               range: rift.gravityRange };
    });
    expect(planted, 'a rock big enough to test the rule').not.toBeNull();

    // It SURVIVES — the swallow is what this rule replaces — and it leaves.
    await waitForEngine(page, (e, ) => true, 'a frame', 5_000);
    const out = await page.evaluate(async (p: any) => {
      const e = (window as any).__omniEngine;
      const find = () => e.currentMap.entities.find((x: any) => x.id === p.id);
      await new Promise(r => setTimeout(r, 1200));
      const en = find();
      if (!en) return null;
      const dx = en.position.x - p.riftX, dy = en.position.y - p.riftY;
      return {
        active: en.active,
        dist: Math.hypot(dx, dy),
        speed: Math.hypot(en.velocity.x, en.velocity.y),
        // Flung the way it was ALREADY going (+x), not bounced back.
        vx: en.velocity.x,
      };
    }, planted);

    expect(out, 'the boulder still exists — it was not swallowed').not.toBeNull();
    expect(out!.active).toBe(true);
    // Thrown clear of the throat, and still travelling.
    expect(out!.dist).toBeGreaterThan(120);
    expect(out!.speed).toBeGreaterThan(3);
    // Along its own velocity vector: it entered heading +x and left heading +x.
    expect(out!.vx).toBeGreaterThan(0);

    watch.assertClean();
  });

  test('things that steer themselves are held off the throat', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // Park an enemy right on a rift's centre with no speed of its own — the
    // worst case, and exactly the "trapped in the gravity" the rule is for.
    const planted = await page.evaluate(() => {
      const e = (window as any).__omniEngine;
      const rift = e.portals.find((p: any) => String(p.portalTargetId).startsWith('arena_'));
      if (!rift) return null;
      const ctx = e.waveContext ? e.waveContext() : null;
      if (!ctx) return null;
      const foe = e.waves.spawnAt('RAMMER_1', { x: rift.position.x, y: rift.position.y }, ctx, true);
      if (!foe) return null;
      foe.velocity.x = 0; foe.velocity.y = 0;
      // Keep the player far away so its own chase steering is not the thing
      // pulling it clear — the portal rule has to do this on its own.
      e.player.position.x = rift.position.x + 4000;
      e.player.position.y = rift.position.y + 4000;
      return { id: foe.id, riftX: rift.position.x, riftY: rift.position.y };
    });
    expect(planted, 'an enemy spawned on the rift').not.toBeNull();

    // Give it real sim time to be either captured or pushed clear.
    const result = await page.evaluate(async (p: any) => {
      const e = (window as any).__omniEngine;
      await new Promise(r => setTimeout(r, 2500));
      const en = e.currentMap.entities.find((x: any) => x.id === p.id);
      if (!en || !en.active) return null;
      return { dist: Math.hypot(en.position.x - p.riftX, en.position.y - p.riftY) };
    }, planted);

    expect(result, 'the enemy is still alive — a rift must not eat it').not.toBeNull();
    // Well clear of the horizon (42 at this rift) rather than sitting in it.
    expect(result!.dist).toBeGreaterThan(120);

    watch.assertClean();
  });
});

/** PORTAL_WARP_CYCLE's length — how many clicks can be needed to reach any
 *  step from any other.  Kept here rather than imported: the suites drive the
 *  built app through its debug handles, never the source constants. */
const PORTAL_WARP_STEPS = 8;

test.describe('the transit warp — the flight through the wormhole', () => {
  /** Arrival plays a short screen-space beat (PORTAL_CONSTANTS.WARP): the lens
   *  unrolls into radial streaks, the sky streams outward, and the tunnel
   *  decelerates onto the destination.  It reuses the STAGE-CLEAR freeze, and
   *  that is the part worth pinning — the look is a picture, but "nothing can
   *  shoot you while you are inside the tunnel" is a rule.
   *
   *  So this asserts the freeze holds, that it releases ON ITS OWN (a beat
   *  that can strand the sim is worse than no beat), and that the DBG "off"
   *  step transitions instantly, exactly as before the effect existed. */
  test('holds the sim for the beat, then releases it', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    const armed = await page.evaluate(() => {
      const e = (window as any).__omniEngine;
      const rift = e.portals.find((p: any) => String(p.portalTargetId).startsWith('arena_'));
      if (!rift) return null;
      e.player.position.x = rift.position.x + 300;
      e.player.position.y = rift.position.y;
      if (!e.transitionToMap(rift.portalTargetId)) return null;
      return {
        timer: e.portalWarpTimer,
        x: e.player.position.x,
        y: e.player.position.y,
        speed: Math.hypot(e.player.velocity.x, e.player.velocity.y),
      };
    });

    expect(armed, 'an arena rift on the hub').not.toBeNull();
    expect(armed!.timer).toBeGreaterThan(0);
    // The ship was EJECTED, so it carries real speed into the freeze — which
    // is what makes the next assertion meaningful rather than vacuous.
    expect(armed!.speed).toBeGreaterThan(5);

    // FROZEN: several frames later the world has not moved, despite that
    // speed.  (A running sim would have carried the ship metres by now.)
    await page.waitForTimeout(180);
    const during = await engine(page, e => ({
      timer: e.portalWarpTimer,
      x: e.player.position.x,
      y: e.player.position.y,
    }));
    expect(during.timer, 'the beat is still running').toBeGreaterThan(0);
    expect(Math.hypot(during.x - armed!.x, during.y - armed!.y)).toBeLessThan(0.001);
    // …and it is a beat, not a stall: the timer is counting down on wall clock.
    expect(during.timer).toBeLessThan(armed!.timer);

    // RELEASES ITSELF.  Poll rather than time it — the point is that nothing
    // outside has to end it.
    await waitForEngine(page, e => e.portalWarpTimer === 0, 'the warp to release', 10_000);

    // …and the world is LIVE again, not merely un-frozen: the ejected ship is
    // travelling once more.  Measured as movement between two samples rather
    // than as a flag, so a freeze that released without resuming the sim
    // would still fail here.
    const resumed = await page.evaluate(async () => {
      const e = (window as any).__omniEngine;
      const at = () => ({ x: e.player.position.x, y: e.player.position.y });
      const a = at();
      await new Promise(r => setTimeout(r, 250));
      const b = at();
      return Math.hypot(b.x - a.x, b.y - a.y);
    });
    expect(resumed, 'the ship is moving again after the beat').toBeGreaterThan(1);

    watch.assertClean();
  });

  test('the destination is never visible before the reveal', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // The map swaps SYNCHRONOUSLY when a transit fires, so from that instant
    // the world behind the veil is the destination.  The bug this pins: the
    // transit's own frame draws at progress EXACTLY 0, and the veil used to
    // skip that frame — one clear look at the arena before the beat, more
    // when that frame was slow.  So the check is the FIRST frame, not a
    // sampled middle one.
    const first = await page.evaluate(async () => {
      const e = (window as any).__omniEngine;
      const rift = e.portals.find((p: any) => String(p.portalTargetId).startsWith('arena_'));
      if (!rift) return null;
      if (!e.transitionToMap(rift.portalTargetId)) return null;
      // One rendered frame, which is the frame the swap happened in.
      await new Promise(r => requestAnimationFrame(() => r(null)));
      return { veil: e.renderer.lastWarpVeilAlpha, progress: e.renderer.portalWarp };
    });

    expect(first, 'an arena rift on the hub').not.toBeNull();
    // Opaque — not merely dark.  Anything under 1 is a window onto the arena.
    expect(first!.veil).toBe(1);

    // …and it STAYS opaque for the whole covered phase, only lifting at the
    // reveal.  Sampled across the beat rather than at one instant, because
    // "it covered at the start and blinked later" would pass a single read.
    const samples = await page.evaluate(async () => {
      const e = (window as any).__omniEngine;
      const out: { p: number; veil: number }[] = [];
      for (let i = 0; i < 30; i++) {
        await new Promise(r => requestAnimationFrame(() => r(null)));
        if (e.renderer.portalWarp === null) break;
        out.push({ p: e.renderer.portalWarp, veil: e.renderer.lastWarpVeilAlpha });
      }
      return out;
    });

    expect(samples.length, 'the beat ran for several frames').toBeGreaterThan(3);
    for (const s of samples) {
      // Full cover everywhere before the reveal window opens; inside it the
      // veil may fall, which IS the reveal.
      if (s.p < 0.6) {
        expect(s.veil, `veil ${s.veil} at progress ${s.p} must still be opaque`).toBe(1);
      }
    }

    watch.assertClean();
  });

  test('the DBG "off" step transitions instantly, as before the beat existed', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // Drive the cycle to "off" by NAME rather than by counting clicks — and
    // give the loop room for the whole cycle, which grew when the longer and
    // extreme durations were added (PORTAL_WARP_CYCLE).
    for (let i = 0; i < PORTAL_WARP_STEPS + 1; i++) {
      const now = await page.evaluate(() => (window as any).__omniStats?.portalWarpName);
      if (now === 'off') break;
      await engine(page, e => e.dbg.cyclePortalWarp());
    }
    expect(await page.evaluate(() => (window as any).__omniStats?.portalWarpName)).toBe('off');

    const t = await page.evaluate(() => {
      const e = (window as any).__omniEngine;
      const rift = e.portals.find((p: any) => String(p.portalTargetId).startsWith('arena_'));
      e.transitionToMap(rift.portalTargetId);
      return e.portalWarpTimer;
    });
    expect(t).toBe(0);

    watch.assertClean();
  });
});

test.describe('debris transit — the wormhole takes what is around you', () => {
  /** Loose entities near the ship travel through a portal and re-emerge from
   *  the EXIT rift after the player, flung out at random headings/speeds
   *  (PORTAL_CONSTANTS.TRANSIT).  Direct engine drives — "can the ship fly
   *  there" is not the question.
   *
   *  The claim is about EMERGENCE, so the state is sampled AT emergence by a
   *  per-frame in-page observer rather than read once the queue has drained.
   *  That distinction is load-bearing rather than fussy: emerged debris is
   *  ordinary world matter the moment it lands, so within a second or two a
   *  shard may legitimately merge into a neighbour and a salvage drop may
   *  fuse with another (both conserve mass/value and both DEACTIVATE one of
   *  the pair), and the id then vanishes for a reason that has nothing to do
   *  with the transit.  A drained-queue read turns that into a flake — it is
   *  what this test failed on first — while the observer measures the frame
   *  the wormhole actually spat each entity out. */
  test('nearby shards and a drop travel through and flow out of the exit rift', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // Plant the cargo, arm the observer and travel in ONE evaluate: no sim
    // time passes in between, so nothing can move the fixture before it
    // ships.  (An earlier two-step version lost a shard to the portal's own
    // swallow horizon between the two round trips — the feature eating its
    // own test fixture.)  The ship parks well CLEAR of the mouth for the same
    // reason: a ring planted 120 units around a ship 180 from the rift puts
    // its nearest shard inside the horizon.
    const run = await page.evaluate(() => {
      const e = (window as any).__omniEngine;
      const rift = e.portals.find((p: any) => String(p.portalTargetId).startsWith('arena_'));
      if (!rift) return null;
      e.player.position.x = rift.position.x + 500;
      e.player.position.y = rift.position.y;
      e.player.velocity.x = 0;
      e.player.velocity.y = 0;
      // Nebula shards are excluded: their heavy cloud damping would fail the
      // "still moving" assertion without saying anything about the transit.
      const shards = e.currentMap.entities
        .filter((x: any) => x.active && x.mass !== Infinity
          && x.shardVariant && String(x.shardVariant).endsWith('-shard')
          && !String(x.shardVariant).startsWith('nebula'))
        .slice(0, 4);
      shards.forEach((s: any, i: number) => {
        const a = (i / 4) * Math.PI * 2;
        s.position.x = e.player.position.x + Math.cos(a) * 120;
        s.position.y = e.player.position.y + Math.sin(a) * 120;
        s.velocity.x = 0; s.velocity.y = 0;
      });
      e.drops.spawnSalvageDrop(
        e.currentMap.entities, e.activeDrops,
        { x: e.player.position.x + 60, y: e.player.position.y }, { x: 0, y: 0 });
      const drop = e.activeDrops[e.activeDrops.length - 1];
      const ids: string[] = [...shards.map((s: any) => s.id), drop.id];

      // The observer records each watched id the first frame it appears in
      // the destination map, so a later merge cannot erase the evidence.
      const seen: Record<string, any> = {};
      (window as any).__transitSeen = seen;
      const tick = () => {
        const exit = e.portals.find((p: any) => p.portalTargetId === 'overworld');
        const anchor = exit ? exit.position : e.player.position;
        for (const id of ids) {
          if (seen[id]) continue;
          const en = e.currentMap.entities.find((x: any) => x.id === id && x.active);
          if (!en) continue;
          seen[id] = {
            speed: Math.hypot(en.velocity.x, en.velocity.y),
            dist: Math.hypot(en.position.x - anchor.x, en.position.y - anchor.y),
            grace: en.portalGraceTimer ?? 0,
          };
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      const ok = e.transitionToMap(rift.portalTargetId);
      const queuedIds = e.portalTransit.map((t: any) => t.entity.id);
      return { ok, ids, queued: e.portalTransit.length, carried: ids.filter(id => queuedIds.includes(id)).length };
    });

    expect(run, 'an arena rift on the hub').not.toBeNull();
    expect(run!.ok, 'the transition ran').toBe(true);
    // Every planted entity was captured — the whole point of the radius
    // sweep.  Ambient debris in range may add more, up to TRANSIT.MAX_ENTITIES.
    expect(run!.carried).toBe(run!.ids.length);
    expect(run!.queued).toBeGreaterThanOrEqual(run!.ids.length);

    // 3. The stagger tops out at DELAY_MAX (1.6 sim-seconds); poll the queue
    //    empty rather than waiting a fixed time (harness rule 1).
    await waitForEngine(page, e => e.portalTransit.length === 0,
      'the transit queue to drain');

    const seen = await page.evaluate(() => (window as any).__transitSeen as Record<string, any>);

    for (const id of run!.ids) {
      const o = seen[id];
      expect(o, `entity ${id} emerged in the destination map`).toBeTruthy();
      // Flung, not parked.
      expect(o.speed).toBeGreaterThan(0.3);
      // Emerged AT the exit rift: mouth scatter (70) plus a frame or two of
      // flight at the top ejection speed, with margin.
      expect(o.dist).toBeLessThan(400);
      // The portal-gravity grace window is live, so the exit well cannot
      // swallow what it just spat out.
      expect(o.grace).toBeGreaterThan(0);
    }

    watch.assertClean();
  });
});
