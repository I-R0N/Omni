/** Terrain destruction — a tile breaks the same way whatever killed it.
 *
 *  A tile shot with a projectile shatters into debris. A tile crushed by a
 *  drifting asteroid used to just VANISH (user report): the two
 *  asteroid-impact kill sites set `health = 0; active = false` and pulled the
 *  tile out of the static grid without ever calling `onDeath`, so
 *  `GameEngine.handleEntityDeath` never ran — no shatter, no debris, no
 *  sound. The player's OWN crash path always did call it, which is what made
 *  the asymmetry easy to miss: crashing into a tile yourself looked right.
 *
 *  What is pinned is that PARITY, not the particle count: the same
 *  observable consequence — debris in the world where the tile was — follows
 *  from both causes, and the ONE thing that legitimately differs (score
 *  attribution) differs.
 *
 *  Both kills are driven through the REAL collision resolver rather than
 *  reimplemented (harness rules 3 and 6); `private` is compile-time only, and
 *  `healthbars.spec.ts` drives the same method to measure damage in situ.
 *
 *  Each measurement runs inside ONE page evaluation — before, act, after —
 *  because `prepareFrameEntities` compacts `currentMap.entities` on the next
 *  frame, so neither an index nor an id survives a round trip once the entity
 *  it names is dead.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, startRun, waitForStats, quietScene } from './helpers';

/** The GLASS showcase field is glass and nothing else, so "a static tile" is
 *  unambiguous and its break is the well-understood
 *  `DropSystem.spawnGlassShards` fan rather than whatever variant a mixed map
 *  happened to put under the probe. */
async function glassField(page: any) {
  await startRun(page, 'GLASS_FIELD');
  await waitForStats(page, s => s.currentMapType === 'GLASS_FIELD', 'the glass field');
  // Park the player far from the origin tile so nothing it does can
  // contaminate the count.
  await engine(page, e => {
    e.player.position.x += 4000;
    e.player.position.y += 4000;
    e.player.velocity.x = 0; e.player.velocity.y = 0;
  });
  // ...and stop the FAUNA, which is the other thing on this map that can now
  // touch a tile: a bubble gnaws terrain it cannot swallow (its `consume.bite`),
  // so ambient bubbles chip glass while this test is measuring how a tile
  // breaks.  Caught as an intermittent failure of the SHOT case.  This suite's
  // whole subject is "a tile breaks the same way whatever killed it", so
  // something else breaking tiles beside it is contamination by definition.
  await quietScene(page);
}

/** Kill one static tile — `how` picks the cause — and report what the world
 *  looked like either side of it. */
function breakATile(page: any, how: 'shot' | 'crush') {
  return engine(page, (e, mode: string) => {
    const ents = e.currentMap.entities;
    const t = ents.find((x: any) => x.active && x.type === 'STRUCTURE' && x.mass === Infinity);
    if (!t) throw new Error('no static tile on the glass field');
    const at = { x: t.position.x, y: t.position.y };
    const debris = () => ents.filter((x: any) =>
      x.active && x.type === 'STRUCTURE' && x.mass !== Infinity
      && Math.abs(x.position.x - at.x) < 200 && Math.abs(x.position.y - at.y) < 200,
    ).length;

    // The impactor is created BEFORE the baseline is taken, because it is
    // itself a mobile STRUCTURE sitting inside the debris radius — counting
    // it as debris made this test pass with the fix reverted, which is the
    // only way a parity test can lie.
    const rock = mode === 'crush' ? {
      id: 'terrain_rock', type: 'STRUCTURE', shardVariant: 'rock-shard',
      position: { x: at.x + t.size.x * 0.5 + 16, y: at.y },
      velocity: { x: -600, y: 0 }, rotation: 0,
      size: { x: 40, y: 40 }, mass: 60, active: true, color: '#8a8a8a',
      health: 50, maxHealth: 50,
    } : null;
    if (rock) ents.push(rock);

    const before = { debris: debris(), score: e.score, alive: t.active === true };

    if (mode === 'shot') {
      // The shell is deliberately far OVERPOWERED, and that is not laziness:
      // under the V15 grain model a tile's HP is DERIVED from its own Voronoi
      // pattern (Σ boundary length × bondStrength), so it varies tile to tile
      // — a 36px glass pane measures 44.6..51.2 across runs.  A 50-damage
      // shell sits INSIDE that band, so it killed the tile ~7 runs in 8 and
      // left it standing on the other one (measured: 2 failures in 16
      // repetitions, both with derived HP just over 50).  Killing the tile is
      // this test's PRECONDITION, not its claim — the claim is the debris
      // parity below — so the shell must clear the band by a margin no
      // pattern can close.
      e.physics.resolveCollision(
        {
          id: 'terrain_shell', type: 'PROJECTILE',
          position: { x: at.x + t.size.x * 0.5 + 4, y: at.y },
          velocity: { x: -900, y: 0 }, rotation: Math.PI,
          size: { x: 6, y: 6 }, mass: 0.1, active: true, color: '#fff',
          damage: 500, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
        },
        t, { x: 0, y: 0 }, undefined, e.handleEntityDeath,
      );
    } else {
      // A REAL mtv, not {0,0}: `resolveCollision` bails before the crash
      // branch when the separation vector is degenerate, and the normal it
      // derives from it is what turns the closing velocity into an impact.
      // Points a → b, so -x: the rock is to the tile's right, heading left.
      e.physics.resolveCollision(rock, t, { x: -4, y: 0 }, undefined, e.handleEntityDeath);
    }

    return {
      before,
      after: { debris: debris(), score: e.score, alive: t.active === true },
    };
  }, how);
}

test.describe('a tile breaks the same way whatever killed it', () => {
  test('a SHOT tile leaves debris — the reference behaviour', async ({ page }) => {
    const watch = await boot(page);
    await glassField(page);

    const r = await breakATile(page, 'shot');
    expect(r.before.alive, 'the tile started whole').toBe(true);
    expect(r.after.alive, 'the tile died').toBe(false);
    expect(r.after.debris, 'debris in the world').toBeGreaterThan(r.before.debris);
    // A player kill scores, which is the control for the attribution test
    // below rather than a claim about the number.
    expect(r.after.score, 'a shot tile pays').toBeGreaterThan(r.before.score);

    watch.assertClean();
  });

  test('a CRUSHED tile leaves debris too — it does not just vanish', async ({ page }) => {
    const watch = await boot(page);
    await glassField(page);

    const r = await breakATile(page, 'crush');
    expect(r.after.alive, 'the tile died').toBe(false);
    // THE FIX.  Before it, the tile died and left nothing at all behind: the
    // asteroid kill sites never reached the death pipeline that spawns this.
    expect(r.after.debris, 'the crush left debris, like a shot does')
      .toBeGreaterThan(r.before.debris);

    watch.assertClean();
  });

  test('but the crush is nobody’s kill, so it scores nothing', async ({ page }) => {
    const watch = await boot(page);
    await glassField(page);

    /*  Score attribution is the ONE thing that legitimately differs between
     *  the two causes, and it belongs next to the parity claim: the whole
     *  point of the `killedByPlayer` stamp is that a tile crushed by a
     *  drifting rock is nobody's kill. Routing the crush through the death
     *  path with that stamp set would have paid the player for weather. */
    const r = await breakATile(page, 'crush');
    expect(r.after.score, 'ambient destruction pays nothing').toBe(r.before.score);

    watch.assertClean();
  });
});
