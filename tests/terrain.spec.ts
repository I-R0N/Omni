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
 *
 *  The second describe block below pins the OTHER half of that parity, added
 *  by step 2 of the unified-impact-physics sequencing (docs/PARKING_LOT.md):
 *  a crush now spends on the tile's GRAIN BOUNDARIES rather than decrementing
 *  `health`, so a crushed tile cracks and sheds grains the way a shot one
 *  does — and, because the two paths finally count in the same unit, shooting
 *  a tile no longer makes it dramatically harder to ram through.
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

/** Load a single-variant showcase field and quiet everything that could
 *  touch a tile beside the measurement.  Same recipe as `glassField`, for a
 *  material whose damage layer meters crashes rather than taking the whole
 *  pane in one (the glass V9 rule). */
async function tileField(page: any, mapType: string) {
  await startRun(page, mapType);
  // The predicate is serialised by `toString()` and re-created in the page, so
  // a closure over `mapType` would arrive undefined — the same trap
  // `helpers.advanceSim` documents.  Build it with the name INLINED.
  await waitForStats(
    page,
    new Function('s', `return s.currentMapType === '${mapType}'`) as (s: any) => boolean,
    `the ${mapType} field`,
  );
  await engine(page, e => {
    e.player.position.x += 4000;
    e.player.position.y += 4000;
    e.player.velocity.x = 0; e.player.velocity.y = 0;
  });
  await quietScene(page);
}

test.describe('a crush spends on grain boundaries, like every other damage path', () => {
  test('a crush spends one authored HP WORTH of the derived budget, not one raw point',
    async ({ page }) => {
      const watch = await boot(page);
      // Metal: the authored HP is high enough that several crushes are nowhere
      // near lethal, so what is measured is unambiguously the spend and not
      // the break.  (Glass is the wrong subject here — its V9 rule takes the
      // whole pane on any qualifying smash, deliberately.)
      await tileField(page, 'METAL_FIELD');

      const r = await engine(page, e => {
        const ents = e.currentMap.entities;
        const t = ents.find((x: any) => x.active && x.type === 'STRUCTURE'
          && x.mass === Infinity && !x.fractureEdgeFill);
        if (!t) throw new Error('no untouched static tile on the metal field');
        const at = { x: t.position.x, y: t.position.y };
        const rock: any = {
          id: 'crack_rock', type: 'STRUCTURE', shardVariant: 'rock-shard',
          position: { x: at.x + t.size.x * 0.5 + 16, y: at.y },
          velocity: { x: -600, y: 0 }, rotation: 0,
          size: { x: 40, y: 40 }, mass: 60, active: true, color: '#8a8a8a',
          health: 50, maxHealth: 50,
        };
        ents.push(rock);
        const authoredBefore = t.maxHealth;
        const crush = () => {
          rock.position.x = at.x + t.size.x * 0.5 + 16; rock.position.y = at.y;
          rock.velocity.x = -600; rock.velocity.y = 0;
          // Points a → b, so -x: the rock is to the tile's right, heading left.
          e.physics.resolveCollision(rock, t, { x: -4, y: 0 }, e.spawnDamageText, e.handleEntityDeath);
        };
        // The FIRST crush is deliberately not the measurement: it is the one
        // that converts the tile onto the derived budget, and both the old
        // behaviour and the new spend exactly one authored HP's worth across
        // that conversion (`ensureBoundaryModel` preserves the damage
        // FRACTION).  The divergence is everything after it.
        crush();
        const converted = { hp: t.health, max: t.maxHealth };
        crush(); const afterSecond = t.health;
        crush(); const afterThird = t.health;
        const fill = t.fractureEdgeFill;
        let absorbed = 0;
        if (fill) for (let i = 0; i < fill.length; i++) absorbed += fill[i];
        rock.active = false;
        return {
          authoredBefore, converted, afterSecond, afterThird, absorbed,
          alive: t.active === true,
          authored: t.authoredMaxHealth,
          edges: t.fractureEdges ? t.fractureEdges.length : 0,
        };
      });

      expect(r.alive, 'three crushes are not lethal to metal').toBe(true);
      expect(r.edges, 'the tile carries a real decomposition to spend on')
        .toBeGreaterThan(0);
      expect(r.converted.max, 'the tile converted onto the derived boundary budget')
        .toBeGreaterThan(r.authoredBefore);
      expect(r.absorbed, 'the crushes landed on the grain boundaries').toBeGreaterThan(0);

      // THE CHANGE, and the reason it needed the two warm-up crushes above.
      // Before it, a crush did `health -= 1` — one raw point off a budget the
      // first weapon hit or the first harvest had already rewritten to the
      // DERIVED total, so successive crushes cost 1 out of ~467.  A crush now
      // spends the same fraction of the body it always did: one authored HP,
      // expressed in the derived budget.
      const unit = r.converted.max / (r.authored as number);
      const dropSecond = r.converted.hp - r.afterSecond;
      const dropThird = r.afterSecond - r.afterThird;
      expect(unit, 'the derived budget is worth several points per authored HP')
        .toBeGreaterThan(2);
      expect(dropSecond, 'the second crush spends a whole unit, not one point')
        .toBeCloseTo(unit, 6);
      expect(dropThird, 'and so does the third').toBeCloseTo(unit, 6);

      watch.assertClean();
    });

  test('and enough crushes SHED A GRAIN, with the tile still standing',
    async ({ page }) => {
      const watch = await boot(page);
      await tileField(page, 'ROCK_FIELD');

      const r = await engine(page, e => {
        const area = (pts: any[]) => {
          if (!pts || pts.length < 3) return 0;
          let a = 0;
          for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
          }
          return Math.abs(a) * 0.5;
        };
        const ents = e.currentMap.entities;
        const t = ents.find((x: any) => x.active && x.type === 'STRUCTURE'
          && x.mass === Infinity && !x.fractureEdgeFill);
        if (!t) throw new Error('no untouched static tile on the rock field');
        const at = { x: t.position.x, y: t.position.y };
        const rock: any = {
          id: 'shed_rock', type: 'STRUCTURE', shardVariant: 'rock-shard',
          position: { x: at.x + t.size.x * 0.5 + 16, y: at.y },
          velocity: { x: -600, y: 0 }, rotation: 0,
          size: { x: 40, y: 40 }, mass: 60, active: true, color: '#8a8a8a',
          health: 50, maxHealth: 50,
        };
        ents.push(rock);
        const debris = () => ents.filter((x: any) =>
          x !== rock && x.active && x.type === 'STRUCTURE' && x.mass !== Infinity
          && Math.abs(x.position.x - at.x) < 200 && Math.abs(x.position.y - at.y) < 200,
        ).length;

        const area0 = area(t.polygonPoints);
        const debris0 = debris();
        // Crush repeatedly, but STOP the moment a grain has come away: the
        // claim is that a piece leaves while the parent stands, so running on
        // to the break would measure the death path instead.
        let hits = 0, shed = false;
        while (t.active && hits < 40) {
          rock.position.x = at.x + t.size.x * 0.5 + 16;
          rock.position.y = at.y;
          rock.velocity.x = -600; rock.velocity.y = 0;
          e.physics.resolveCollision(rock, t, { x: -4, y: 0 }, e.spawnDamageText, e.handleEntityDeath);
          hits++;
          if (t.active && area(t.polygonPoints) < area0 - 1) { shed = true; break; }
        }
        const out = {
          hits, shed, alive: t.active === true,
          area0, areaNow: area(t.polygonPoints),
          debrisGained: debris() - debris0,
        };
        rock.active = false;
        return out;
      });

      expect(r.shed, 'a grain came off under the crush').toBe(true);
      expect(r.alive, 'and the tile is still standing').toBe(true);
      expect(r.areaNow, 'the outline lost the grain it shed').toBeLessThan(r.area0);
      expect(r.debrisGained, 'which is now a mobile body in the world')
        .toBeGreaterThan(0);

      watch.assertClean();
    });

  test('shooting a tile does not make it harder to ram — the two paths count in one unit',
    async ({ page }) => {
      const watch = await boot(page);
      // Plastic: every tile on the field spawns at the SAME authored HP (8,
      // measured over 60 tiles), so two tiles are comparable subjects.  Metal
      // is not — its HP rides `densityTier`, so tile-to-tile counts differ for
      // a reason that has nothing to do with this claim.
      await tileField(page, 'PLASTIC_FIELD');

      const r = await engine(page, e => {
        const P = e.physics;
        const pick = () => e.currentMap.entities.find((x: any) => x.active
          && x.type === 'STRUCTURE' && x.mass === Infinity && (x.health ?? 0) > 0
          && !x.fractureEdgeFill);
        const ramToDeath = (t: any, preShoot: boolean) => {
          if (preShoot) {
            // One ordinary Blaster bolt — enough to build the boundary model
            // and rewrite `maxHealth` onto the derived budget.  That rewrite
            // is what the old crash path then counted against, one point at a
            // time.
            P.resolveCollision({
              id: 'ram_bolt', type: 'PROJECTILE',
              position: { x: t.position.x - t.size.x * 0.5 - 2, y: t.position.y },
              velocity: { x: 16, y: 0 }, rotation: 0, size: { x: 6, y: 6 }, mass: 1,
              active: true, color: '#fff', damage: 4, ownerType: 'PLAYER',
              ownerId: 'player', hitEntityIds: [], pierceCount: 0, pierceHits: 0,
            }, t, { x: -1, y: 0 }, e.spawnDamageText, e.handleEntityDeath);
          }
          const p = e.player;
          const home = { x: p.position.x, y: p.position.y };
          let n = 0;
          while (t.active && n < 600) {
            p.position.x = t.position.x - t.size.x; p.position.y = t.position.y;
            p.velocity.x = 6; p.velocity.y = 0;   // 1.5× CRASH_VELOCITY_THRESHOLD
            P.resolveCollision(p, t, { x: 1, y: 0 }, e.spawnDamageText, e.handleEntityDeath);
            n++;
          }
          p.position.x = home.x; p.position.y = home.y;
          p.velocity.x = 0; p.velocity.y = 0;
          return n;
        };
        const a = pick(); const virgin = a ? ramToDeath(a, false) : -1;
        const b = pick(); const shot = b ? ramToDeath(b, true) : -1;
        return { virgin, shot };
      });

      expect(r.virgin, 'the virgin tile took a real number of rams').toBeGreaterThan(1);
      expect(r.shot, 'the shot tile broke too').toBeGreaterThan(1);
      // THE REGRESSION.  Measured on the base branch (perf/impact-audit.mjs
      // §5): plastic went 8 rams virgin and 400 after a single bolt, rock
      // 9 → 50, metal 120 → 468.  Nothing about the tile got tougher; the
      // unit it was counted in changed.  Off-by-one is legitimate — the bolt
      // itself spent a little of the budget, and the final ram overspends —
      // anything beyond that is the defect returning.
      expect(Math.abs(r.shot - r.virgin),
        'a bolt beforehand changes the ram count by at most one').toBeLessThanOrEqual(1);

      watch.assertClean();
    });

  test('a body with no grain model still breaks under a crush — the fallback holds',
    async ({ page }) => {
      const watch = await boot(page);
      await glassField(page);

      // The DBG legacy fracture A/B takes every variant back off the grain
      // model, which is exactly the case `crashBoundaryDamage` must decline:
      // `GameEngine.chipStructureAt` refuses such a body outright because it
      // is the chip path, but a crash cannot refuse — it has to fall back to
      // the whole-body decrement the crash paths always were.
      const r = await engine(page, e => {
        e.dbg.cycleFractureMode();                    // → legacy
        try {
          const ents = e.currentMap.entities;
          const t = ents.find((x: any) => x.active && x.type === 'STRUCTURE'
            && x.mass === Infinity && !x.fractureEdgeFill);
          if (!t) throw new Error('no untouched static tile on the glass field');
          const rock: any = {
            id: 'legacy_rock', type: 'STRUCTURE', shardVariant: 'rock-shard',
            position: { x: t.position.x + t.size.x * 0.5 + 16, y: t.position.y },
            velocity: { x: -600, y: 0 }, rotation: 0,
            size: { x: 40, y: 40 }, mass: 60, active: true, color: '#8a8a8a',
            health: 50, maxHealth: 50,
          };
          ents.push(rock);
          e.physics.resolveCollision(rock, t, { x: -4, y: 0 }, e.spawnDamageText, e.handleEntityDeath);
          const out = { alive: t.active === true, boundaryModel: t.fractureEdgeFill !== undefined };
          rock.active = false;
          return out;
        } finally {
          e.dbg.cycleFractureMode();                  // → back to voronoi
        }
      });

      expect(r.boundaryModel, 'no boundary model was built under legacy').toBe(false);
      expect(r.alive, 'and the crush still destroyed the pane').toBe(false);

      watch.assertClean();
    });
});
