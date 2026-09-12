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
      // SHOTS UNTIL IT DIES, not one overpowered shell — because no single
      // shot can kill a grain tile any more, however much energy it carries.
      // A round bores its own CHORD and pays the material's price per grain
      // (unified impact physics, step 5), so the most one contact can deposit
      // into a 36px glass pane is about three grains' worth against a derived
      // HP near 49.  The old shell leaned on the retired rule that poured a
      // bolt's whole authored damage into the entry cell; at `damage: 500` it
      // now deposits 18 and the tile stands.
      //
      // Killing the tile is this test's PRECONDITION, not its claim — the
      // claim is the debris parity below — so it is driven to death and the
      // caller asserts it got there.
      for (let i = 0; i < 40 && t.active; i++) {
        e.physics.resolveCollision(
          {
            id: 'terrain_shell_' + i, type: 'PROJECTILE',
            position: { x: at.x + t.size.x * 0.5 + 4, y: at.y },
            velocity: { x: -900, y: 0 }, rotation: Math.PI,
            size: { x: 6, y: 6 }, mass: 0.1, active: true, color: '#fff',
            damage: 500, ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
          },
          t, { x: 0, y: 0 }, undefined, e.handleEntityDeath,
        );
      }
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
  test('a crush spends its KINETIC energy, so twice the speed is four times the bite',
    async ({ page }) => {
      const watch = await boot(page);
      // Metal: the derived HP is high enough that several crushes are nowhere
      // near lethal, so what is measured is unambiguously the spend and not
      // the break.  (Glass is the wrong subject here — its V9 rule takes the
      // whole pane on any qualifying smash, deliberately.)
      await tileField(page, 'METAL_FIELD');

      const r = await engine(page, (e, sp: any) => {
        const ents = e.currentMap.entities;
        const pick = () => ents.find((x: any) => x.active && x.type === 'STRUCTURE'
          && x.mass === Infinity && !x.fractureEdgeFill && !x.__crushed);
        const run = (speed: number) => {
          const t = pick();
          if (!t) throw new Error('no untouched static tile on the metal field');
          t.__crushed = true;
          const at = { x: t.position.x, y: t.position.y };
          const rock: any = {
            id: 'crack_rock_' + speed, type: 'STRUCTURE', shardVariant: 'rock-shard',
            position: { x: at.x + t.size.x * 0.5 + 16, y: at.y },
            velocity: { x: -speed, y: 0 }, rotation: 0,
            size: { x: 40, y: 40 }, mass: 60, active: true, color: '#8a8a8a',
            health: 50, maxHealth: 50,
          };
          ents.push(rock);
          const authoredBefore = t.maxHealth;
          const crush = () => {
            rock.position.x = at.x + t.size.x * 0.5 + 16; rock.position.y = at.y;
            rock.velocity.x = -speed; rock.velocity.y = 0;
            // Points a → b, so -x: the rock is to the tile's right, heading left.
            e.physics.resolveCollision(rock, t, { x: -4, y: 0 }, e.spawnDamageText, e.handleEntityDeath);
          };
          // The FIRST crush is deliberately not the measurement: it is the one
          // that converts the tile onto the derived budget.  The divergence is
          // everything after it.
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
        };
        return { slow: run(sp.slow), fast: run(sp.fast) };
      }, { slow: 8, fast: 16 });

      expect(r.slow.alive, 'three crushes are not lethal to metal').toBe(true);
      expect(r.slow.edges, 'the tile carries a real decomposition to spend on')
        .toBeGreaterThan(0);
      expect(r.slow.converted.max, 'the tile converted onto the derived boundary budget')
        .toBeGreaterThan(r.slow.authoredBefore);
      expect(r.slow.absorbed, 'the crushes landed on the grain boundaries')
        .toBeGreaterThan(0);

      // Successive crushes at the SAME speed cost the same.
      const dropSecond = r.slow.converted.hp - r.slow.afterSecond;
      const dropThird = r.slow.afterSecond - r.slow.afterThird;
      expect(dropThird, 'the same crush costs the same each time')
        .toBeCloseTo(dropSecond, 6);

      // THE CLAIM, and the one that separates step 4 from everything before
      // it.  Step 2 spent one AUTHORED HP per crush, so the drop did not move
      // with speed at all; a MOMENTUM model would double it.  Energy squares
      // it, and that is what is asserted: the same rock at twice the speed
      // takes four times the bite.
      const dropFast = r.fast.converted.hp - r.fast.afterSecond;
      expect(dropFast / dropSecond, 'twice the speed, four times the bite')
        .toBeCloseTo(4, 3);

      // And the authored HP is no longer consulted anywhere in that spend —
      // which is what killed metal's ram-count lottery, where six tiles of
      // identical toughness took 24 to 144 rams because authored HP is
      // `24 x densityTier` while derived HP is flat.
      const unit = r.slow.converted.max / (r.slow.authored as number);
      expect(Math.abs(dropSecond - unit), 'the spend is NOT one authored HP')
        .toBeGreaterThan(1e-6);

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
          // A SANE closing speed.  Under step 4 a crash spends its kinetic
          // energy, so the -600 this used to carry is 10.8M of it and
          // obliterates any tile on contact — there is no "parent still
          // standing" to observe.  8 u/step is twice the old crash gate.
          velocity: { x: -8, y: 0 }, rotation: 0,
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
          rock.velocity.x = -8; rock.velocity.y = 0;
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
              ownerId: 'player', hitEntityIds: [], pierceHits: 0,
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

test.describe('a fast ship cannot fly through terrain', () => {
  /*  THE REPORT: "the player now literally passes through tiles at high
   *  impact energy".  Every contact in this engine is tested at the END of a
   *  step, so a ship moving further in one step than a tile is wide can be
   *  clear on both sides of it and never test as touching — no damage to the
   *  tile, no speed off the hull, no sound, nothing.
   *
   *  Step 4 is what made it VISIBLE rather than what caused it.  The flat
   *  35%-per-tile retention it replaced bled a ship below the tunnelling
   *  speed within a tile or two, so nothing could stay fast enough to fall in
   *  the hole; spending real energy lets a ship that broke something cheap
   *  keep almost all of its speed, and then it outruns the test.
   *
   *  `PhysicsSystem.sweepRewind` puts a body back where its PATH met the
   *  thing it hit, so the ordinary broadphase, SAT, MTV, crash spend and
   *  `payForCrash` all run exactly as they do at walking pace.  That is the
   *  claim here, and it is driven through the engine's OWN physics step
   *  rather than a hand-rolled one — an earlier draft of this measurement
   *  stepped the ship by a full `velocity` per iteration and so double-counted
   *  the `dt x 60` the integrator applies, which reports tunnelling at half
   *  the speed it really starts.
   */

  /** A FRESH FIELD per charge.  A run through the wall destroys some of it,
   *  so the second arm of an A/B cannot reuse the first arm's tiles — it
   *  would be comparing a full wall against whatever survived one. */
  const freshField = async (page: any, map: string) => {
    await startRun(page, map);
    const onMap = new Function('s', `return s.currentMapType === '${map}'`) as (s: any) => boolean;
    await waitForStats(page, onMap, map);
    await quietScene(page);
  };

  /** Fly the ship at a WALL of ten tiles butted edge to edge and report what
   *  is left of both.  `sweep: false` stubs the fix out in place, which is
   *  the control: the claim is not "the ship stops" but "the ship stops
   *  BECAUSE of this", and without it the same run escapes. */
  const chargeWall = (page: any, variant: string, speed: number, sweep: boolean) =>
    engine(page, (e: any, a: any) => {
      const p = e.player, P: any = e.physics, DT = 1 / 120;
      const all = e.currentMap.entities.filter((x: any) => x.active
        && x.shardVariant === a.variant && x.mass === Infinity);
      const wall = all.slice(0, 10);
      if (wall.length < 10) throw new Error('not enough tiles to build a wall');
      const w = wall[0].size.x;
      // Everything else off the board, so nothing but the wall can stop it.
      for (const t of all.slice(10)) t.active = false;
      wall.forEach((t: any, i: number) => {
        t.position.x = 400 + i * w; t.position.y = 0;
        t.health = t.maxHealth; t.active = true;
      });
      P.initializeStaticGrid(e.currentMap.entities);
      p.position.x = 0; p.position.y = 0;
      p.velocity.x = a.speed; p.velocity.y = 0;
      p.health = p.maxHealth = 1e9;   // the hull is not what is being measured
      P.sweptRewinds = 0;
      const realSweep = P.sweepRewind.bind(P);
      if (!a.sweep) P.sweepRewind = () => false;
      const hp0: any = {};
      for (const t of wall) hp0[t.id] = t.health;
      const wallEnd = wall[wall.length - 1].position.x + w;
      for (let i = 0; i < 2000; i++) {
        e.prepareFrameEntities();
        e.updatePhysics(DT);
        p.velocity.y = 0;               // hold the heading; friction is not the subject
        if (Math.abs(p.velocity.x) < 0.05) break;
        if (p.position.x > wallEnd + 100) break;
      }
      P.sweepRewind = realSweep;
      const past = (t: any) => p.position.x > t.position.x + w * 0.5;
      return {
        endSpeed: Math.abs(p.velocity.x),
        escaped: p.position.x > wallEnd,
        destroyed: wall.filter((t: any) => !t.active).length,
        // A tile the ship is BEYOND that is still whole and never lost a
        // point of health: it was flown through.
        ghosted: wall.filter((t: any) => t.active && past(t)
          && Math.abs(t.health - hp0[t.id]) < 1e-9).length,
        rewinds: P.sweptRewinds,
      };
    }, { variant, speed, sweep });

  for (const [map, variant] of [
    ['ROCK_FIELD', 'rock-tile'],
    ['GLASS_FIELD', 'glass-tile'],
    ['METAL_FIELD', 'metal-tile'],
  ] as const) {
    test(`a ship charging ${variant} at speed is STOPPED by it, and pays on the way`,
      async ({ page }) => {
        const watch = await boot(page);
        await freshField(page, map);

        // 120 is the ship's OWN top speed (`PLAYER_MOVEMENT_CONFIG`), so this
        // is not a synthetic velocity — it is what a boosted hull actually
        // carries, and blast knockback goes past it.
        const swept = await chargeWall(page, variant, 120, true);

        expect(swept.ghosted, 'no tile is flown through untouched').toBe(0);
        expect(swept.escaped, 'and the wall stops the ship').toBe(false);
        expect(swept.endSpeed, 'which means dead, not merely slowed').toBeLessThan(1);
        expect(swept.destroyed, 'it broke its way in, rather than bouncing off the face')
          .toBeGreaterThan(0);
        expect(swept.rewinds, 'and the swept path is what caught the contacts')
          .toBeGreaterThan(0);

        watch.assertClean();
      });
  }

  test('the control: with the swept path stubbed out, the same charge escapes',
    async ({ page }) => {
      const watch = await boot(page);
      await freshField(page, 'ROCK_FIELD');

      // THE DEFECT, reproduced.  Measured at 120: the ship came out the far
      // side still doing 114.1 with SEVEN of the ten tiles whole and
      // unmarked behind it.  Asserted as a band rather than that figure,
      // since the point is "kept nearly all of it", not the exact number.
      const before = await chargeWall(page, 'rock-tile', 120, false);
      expect(before.escaped, 'it flies out the far side').toBe(true);
      expect(before.endSpeed, 'having kept nearly all its speed').toBeGreaterThan(100);
      expect(before.ghosted, 'and left most of the wall untouched behind it')
        .toBeGreaterThan(3);

      // The SAME scene, one flag apart — rebuilt, since the run above broke
      // part of the wall it was measuring.
      await freshField(page, 'ROCK_FIELD');
      const after = await chargeWall(page, 'rock-tile', 120, true);
      expect(after.escaped).toBe(false);
      expect(after.ghosted).toBe(0);

      watch.assertClean();
    });

  test('an ordinary approach speed is untouched — the sweep is an early-out',
    async ({ page }) => {
      const watch = await boot(page);
      await freshField(page, 'ROCK_FIELD');

      // THE COST OF THE FIX, stated as a claim.  A step shorter than the
      // pair's own contact window cannot have skipped it, so the sweep
      // returns on one compare and the run is bit-for-bit the old one.  At 60
      // (30 units a substep against a +/-28 window) that is already true, so
      // ordinary flight never reaches the quadratic.
      const swept = await chargeWall(page, 'rock-tile', 60, true);
      await freshField(page, 'ROCK_FIELD');
      const stubbed = await chargeWall(page, 'rock-tile', 60, false);

      expect(swept.escaped, 'the wall stops it either way').toBe(false);
      expect(stubbed.escaped).toBe(false);
      expect(swept.ghosted).toBe(0);
      expect(stubbed.ghosted).toBe(0);

      watch.assertClean();
    });
});
