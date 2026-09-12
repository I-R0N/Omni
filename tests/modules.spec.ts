/** GUNNERY (step 5) and SCANNER (A4) — two module families, one of which is
 *  now the grave of a third.
 *
 *  Both drop into the outfitting system as it ships: a `statMks` row in
 *  MODULE_DEFS, an effect summed by `applyModuleEffects`, and one consumer
 *  reading the folded value.  Neither adds a subsystem, and that is exactly
 *  what makes them easy to break quietly — an effect that stops being folded,
 *  or an adjacency-offline module that keeps contributing, changes no shape
 *  on screen and throws nothing.
 *
 *  What is pinned:
 *   1. THE PENETRATION FAMILY IS GONE, and gone from every surface a run can
 *      reach: the catalog, the adjacency table, the Ship Status panel, and
 *      the DBG grant path.  A deleted module that is still buyable somewhere
 *      is the quiet failure this guards.
 *   2. GUNNERY BUYS A HEAVIER ROUND — the bite AND the bank together, through
 *      the real weapon path, read off the spawned projectile.  Scaling only
 *      the bite would make a Gunnery shot hit harder and stop SOONER, which
 *      is the opposite of a heavier shell, and nothing on screen would say so.
 *   3. OFFLINE IS ZERO.  An adjacency-offline module contributes exactly
 *      nothing — which for the scanner means the baseline, to the pixel.
 *   4. EACH SCANNER MARK REVEALS ITS OWN TIER, measured against the
 *      no-scanner baseline in the same scene.
 *
 *  The PHYSICS the deleted module used to sell — the falloff curve, the grain
 *  bore, overkill carry-through, the far side — moved to
 *  `tests/weapons.spec.ts`, which is where claims about what a shot does now
 *  live.  They were never really module claims; they only lived here because
 *  Penetration was the thing that made them reachable.
 *
 *  Every reveal assertion reads the BASELINE first and the scanner state
 *  second in the same scene, because "today's behaviour exactly" is the load-
 *  bearing half of A4: the existing indicator/minimap/portal suites are
 *  written against the no-scanner gating and must keep passing.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, quietScene, startRun, stats, useScanner, waitForEngine, waitForStats, waitForStatsKeyChange } from './helpers';

/** The energy model, hard-coded (harness rule: a test that imports the
 *  constant it is checking pins nothing).  A round's MASS and SPEED fix the
 *  ENERGY it launches with; its authored `damage` is the BITE one contact
 *  deposits.  Gunnery scales both, which is what "a heavier round" means. */
// Written out rather than imported (the weapons.spec rule).  The SCALE half
// is the point: every mass is 10x (`constants.MASS_SCALE`) and every impact
// is worth `mass / C`, so the conversion carries the same factor and the
// model lands where it did.  Spelling out the product is what makes a move
// to either half show up here instead of passing in silence.
const MASS_SCALE = 10;
const ENERGY_PER_DAMAGE = 32 * MASS_SCALE;
/** The bank, in bites of the authored damage. */
const bankInBites = (damage: number, speed: number, mass: number) =>
  (0.5 * mass * speed * speed) / ENERGY_PER_DAMAGE / damage;

/** Park the player in empty space on a quiet showcase map. */
async function quietField(page: any, map = 'GLASS_FIELD') {
  await startRun(page, map);
  // Built as a string, never a closure: `waitForStats` serialises the
  // predicate with toString(), so a captured `map` would be undefined in the
  // page and the poll would throw rather than wait (helpers.ts, rule 1).
  await waitForStats(
    page,
    new Function('s', `return s.currentMapType === ${JSON.stringify(map)}`) as any,
    `the ${map}`);
  await quietScene(page);
  await engine(page, e => {
    e.player.position.x += 4000; e.player.position.y += 4000;
    e.player.velocity.x = 0; e.player.velocity.y = 0;
  });
}

/** Fire ONE real player shot through WeaponSystem and hand back the
 *  projectile it spawned.  The cooldown is zeroed first so the shot is never
 *  swallowed by cadence, and the shot is taken straight off the weapon path
 *  rather than synthesised — the whole point is that the module reaches the
 *  projectile through the code the game fires with. */
function fireOne(page: any) {
  return engine(page, e => {
    e.player.weaponCooldown = 0;
    const before = e.currentMap.entities.length;
    e.weapons.firePlayerWeapon(
      e.currentMap.entities, e.player,
      { x: e.player.position.x + 500, y: e.player.position.y },
      undefined, false,
    );
    const spawned = e.currentMap.entities
      .slice(before)
      .filter((x: any) => x.type === 'PROJECTILE');
    const p: any = spawned[0];
    return {
      count: spawned.length,
      damage: p?.damage ?? null,
      mass: p?.mass ?? null,
      speed: p ? Math.hypot(p.velocity.x, p.velocity.y) : null,
    };
  });
}

/** Install a module of `family` at `mk` and return whether it came out
 *  ACTIVE.  `debugGrantModule` drops it in the first free hex of its group,
 *  which on a lean outfit touches the Base Hull / the starter Blaster — so
 *  the default placement is a CONNECTED one. */
function grant(page: any, id: string) {
  return engine(page, (e, mid: string) => {
    e.debugGrantModule(mid);
    const ship = e.shipSlots.indexOf(mid), wpn = e.weaponSlots.indexOf(mid);
    return {
      installed: ship !== -1 || wpn !== -1,
      active: ship !== -1 ? e.activeShip[ship] : wpn !== -1 ? e.activeWeapon[wpn] : false,
    };
  }, id);
}

/** Move the named module so it is INSTALLED but touches nothing that
 *  satisfies its requirement, by the REAL move path (`moveModuleInternal` —
 *  the DBG bypass of the drydock guard).
 *
 *  Hex 0 is the flower's CENTRE and touches all six ring hexes, so a root
 *  (hull / gun) parked there can never leave anything offline.  The module
 *  goes out to ring hex 4 and the root to ring hex 2, which HEX_ADJACENCY
 *  says are not neighbours — the smallest arrangement that isolates it. */
function isolate(page: any, group: 'ship' | 'weapon', rootId: string, modId: string) {
  return engine(page, (e, o: { group: string; rootId: string; modId: string }) => {
    const slots = o.group === 'ship' ? e.shipSlots : e.weaponSlots;
    const active = o.group === 'ship' ? e.activeShip : e.activeWeapon;
    const move = (from: number, to: number) =>
      e.moveModuleInternal({ area: o.group, idx: from }, { area: o.group, idx: to });
    move(slots.indexOf(o.modId), 4);
    move(slots.indexOf(o.rootId), 2);
    return {
      rootAt: slots.indexOf(o.rootId), modAt: slots.indexOf(o.modId),
      rootActive: active[2], modActive: active[4],
    };
  }, { group, rootId, modId });
}


// ── Step 5 — the Penetration family is deleted, and Gunnery absorbed it ─────

test.describe('the Penetration module is gone', () => {
  test('no catalog entry, no adjacency rule, no stat line, no DBG grant',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);

      const r = await engine(page, e => {
        const snap = e.outfittingSnapshot();
        const before = (snap.inventory ?? []).length;
        // The DBG grant path is the widest door into the catalog — it takes a
        // bare id — so it is the one worth trying.  A family that survived
        // only here would still be reachable in play through the debug menu.
        e.debugGrantModule('piercing_mk1');
        e.debugGrantModule('piercing_mk3');
        const after = e.outfittingSnapshot();
        return {
          catalog: (after.catalog ?? []).filter((c: any) =>
            c.family === 'piercing' || /penetrat/i.test(c.label ?? '')).length,
          statLine: (after.statLines ?? []).some((x: any) => x.id === 'pierce'),
          granted: (after.inventory ?? []).length - before,
          installed: [...e.shipSlots, ...e.weaponSlots]
            .filter((id: any) => typeof id === 'string' && id.startsWith('piercing')).length,
        };
      });

      expect(r.catalog, 'the shop offers nothing of the family').toBe(0);
      expect(r.statLine, 'and the Ship Status panel has no Penetration row').toBe(false);
      expect(r.granted, 'a grant for a deleted id is a no-op, not a phantom item').toBe(0);
      expect(r.installed, 'and nothing of the family is aboard').toBe(0);

      watch.assertClean();
    });

  test('the weapon flower still works without it — a mod can be offline, and it is the one that is',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);
      // The adjacency machinery was shared with the deleted family, so prove
      // it still refuses an isolated weapon-mod rather than silently
      // defaulting everything to active once the piercing row left
      // MODULE_REQUIREMENTS.
      await grant(page, 'gunnery_mk3');
      expect(await engine(page, e => e.player.damageMult), 'connected: Mk III').toBeCloseTo(1.36, 6);

      const iso = await isolate(page, 'weapon', 'wpn_blaster', 'gunnery_mk3');
      expect(iso.rootActive, 'the gun is a root — always active').toBe(true);
      expect(iso.modActive, 'the mod is not touching it').toBe(false);
      expect(await engine(page, e => e.player.damageMult),
        'an OFFLINE module contributes zero, not its effect').toBe(1);

      watch.assertClean();
    });
});

test.describe('Gunnery buys a heavier round', () => {
  test('a mark scales the BITE and the BANK together', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);

    // BASELINE — the starter Blaster, authored 4 damage in a round whose
    // whole energy is one bite of it.
    const bare = await fireOne(page);
    expect(bare.count, 'one bolt').toBe(1);
    expect(bare.damage, 'the authored bite').toBeCloseTo(4, 6);
    expect(bankInBites(bare.damage!, bare.speed!, bare.mass!),
      'and a bank of exactly one bite — it spends itself on one contact')
      .toBeCloseTo(1, 4);

    await grant(page, 'gunnery_mk3');
    const heavy = await fireOne(page);

    // THE CLAIM, and the half that is easy to lose.  Both numbers move by the
    // same factor, so the round is DENSER — it bites harder and it carries
    // proportionally further.  Scaling `damage` alone (which is what the
    // module did before the mass solve was authored rather than derived)
    // would leave the bank fixed, so a Gunnery round would hit harder and
    // stop SOONER: fewer, bigger contacts out of the same energy.
    expect(heavy.damage! / bare.damage!, 'the bite scales with the mark')
      .toBeCloseTo(1.36, 6);
    expect(heavy.mass! / bare.mass!, 'and so does the mass behind it')
      .toBeCloseTo(1.36, 6);
    expect(bankInBites(heavy.damage!, heavy.speed!, heavy.mass!),
      'so the bank measured in its OWN bites is unchanged')
      .toBeCloseTo(bankInBites(bare.damage!, bare.speed!, bare.mass!), 4);

    watch.assertClean();
  });

  test('and it therefore reaches further: more bodies per bolt', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);

    /** Fire ONE real Blaster bolt down a line of 1-HP gnats through the REAL
     *  collision resolver and count how many it kills before it is spent.
     *
     *  This is the emergent-penetration property in its plainest form: a body
     *  can only absorb what it had, so the bolt is charged 1 for a 1-HP gnat
     *  and flies on with the rest.  Nothing here authors a body count. */
    const punch = () => engine(page, e => {
      const ctx = e.waveContext();
      const foes: any[] = [];
      for (let i = 0; i < 12; i++) {
        const f = e.waves.spawnAt('SWARM',
          { x: e.player.position.x + 400 + i * 30, y: e.player.position.y }, ctx, false);
        f.maxSpeed = 0; f.velocity.x = 0; f.velocity.y = 0;
        f.health = f.maxHealth = 1; f.shield = 0; f.maxShield = 0;
        foes.push(f);
      }
      e.player.velocity.x = 0; e.player.velocity.y = 0;
      e.player.weaponCooldown = 0;
      const before = e.currentMap.entities.length;
      e.weapons.firePlayerWeapon(e.currentMap.entities, e.player,
        { x: e.player.position.x + 500, y: e.player.position.y }, undefined, false);
      const proj = e.currentMap.entities.slice(before)
        .find((x: any) => x.type === 'PROJECTILE');
      let killed = 0;
      for (const f of foes) {
        if (!proj.active) break;
        proj.position.x = f.position.x; proj.position.y = f.position.y;
        e.physics.resolveCollision(proj, f, { x: 0, y: 0 },
          undefined, e.handleEntityDeath);
        if (!f.active || f.health <= 0) killed++;
      }
      for (const f of foes) f.active = false;
      for (const x of e.currentMap.entities.slice(before)) x.active = false;
      return killed;
    });

    const bare = await punch();
    // 4 of energy, 1 spent per gnat: four gnats.  Stated as a floor plus an
    // exact figure so a change that breaks the arithmetic is loud and a
    // change that merely retunes the Blaster is not silently absorbed.
    expect(bare, 'a 4-damage bolt is charged 1 a gnat, so it takes four').toBe(4);

    await grant(page, 'gunnery_mk3');
    const heavy = await punch();
    expect(heavy, 'a heavier round reaches further into the flock')
      .toBeGreaterThan(bare);

    watch.assertClean();
  });
});

// ── Scanner (rework) ────────────────────────────────────────────────────────
//
// The A4 suite asserted the OPPOSITE contract and is replaced wholesale
// rather than extended: A4's rule was "no scanner degrades to today's
// behaviour exactly", and the rework's is that a scannerless ship sees
// NOTHING.  A test written for the first cannot be adapted into a test for
// the second; keeping it would pin the behaviour the rework removed.

/** Is a portal in the off-screen indicator buffer this frame? */
const portalIndicated = (page: any) => engine(page, e =>
  e.renderer._indicatorBuffer.some((i: any) => i.entity.isPortal === true));

/** Park the player as far as possible from every contact on the map, and
 *  prove it landed outside `SCANNER.ENCOUNTER_RANGE` (900).
 *
 *  Searched on a coarse grid rather than offset from one landmark: an offset
 *  is only clear of the thing it was measured from, and on a torus a big
 *  offset wraps back toward something else.  Returns the achieved clearance
 *  so a caller can assert the premise instead of assuming it. */
async function parkAwayFromContacts(page: any) {
  const clearance = await engine(page, e => {
    const contacts: any[] = [
      ...e.stations, ...e.portals, ...e.entityIndex.enemies,
    ].filter((x: any) => x && x.active);
    const wrapD = (a: number, b: number, span: number) => {
      let d = b - a;
      if (d > span / 2) d -= span;
      if (d < -span / 2) d += span;
      return d;
    };
    const W = e.currentMap.width ?? 12000, H = e.currentMap.height ?? 12000;
    let best = { x: e.player.position.x, y: e.player.position.y, d: -1 };
    const STEPS = 24;
    for (let i = 0; i < STEPS; i++) {
      for (let j = 0; j < STEPS; j++) {
        const x = (i + 0.5) * W / STEPS, y = (j + 0.5) * H / STEPS;
        let nearest = Infinity;
        for (const c of contacts) {
          const dx = wrapD(x, c.position.x, W), dy = wrapD(y, c.position.y, H);
          const d = Math.hypot(dx, dy);
          if (d < nearest) nearest = d;
        }
        if (nearest > best.d) best = { x, y, d: nearest };
      }
    }
    e.player.position.x = best.x; e.player.position.y = best.y;
    e.player.velocity.x = 0; e.player.velocity.y = 0;
    e.camera.position.x = best.x; e.camera.position.y = best.y;
    // Anything already stamped by the flight to here is not what this test
    // is about.
    for (const c of contacts) { c.detectedAt = undefined; c.trackedAt = undefined; }
    return best.d;
  });
  expect(clearance, 'parked outside natural-encounter range').toBeGreaterThan(900);
  await page.waitForTimeout(250);
}

/** Complete one full ping, polling the wavefront rather than sleeping — this
 *  environment renders in software, so sim-seconds run slower than wall
 *  seconds and any computed sleep is a coin flip (harness rule 1). */
async function scanOnce(page: any) {
  // The cooldown is cleared first and the fire is ASSERTED.  Without both,
  // a refused scan makes this helper a silent no-op: `scanPingRadius` is
  // already 0 when no ping started, so the wait below would return
  // immediately and the test would go on to measure an unscanned world and
  // report it as a reveal failure.  (That is not hypothetical — it is how the
  // category-ladder test first "failed": its second scan landed inside the
  // cooldown left by its first.)  The cooldown has its own test.
  const fired = await engine(page, e => { e.scanCooldown = 0; return e.fireScan(); });
  if (!fired) throw new Error('fireScan refused — is a scanner installed and ACTIVE?');
  await page.waitForFunction(
    () => (window as any).__omniEngine?.scanPingRadius === 0,
    undefined, { timeout: 15000 },
  );
}

test.describe('scanner module', () => {
  test('no scanner: nothing is on either readout', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');
    await page.waitForTimeout(400);
// The scanner ships BYPASSED (DBG "Scan off" defaults to REVEALED), so
    // this suite has to switch the subsystem it tests back on.
    await useScanner(page);

    // Park well clear of EVERY contact.  NATURAL ENCOUNTER is deliberately
    // not scanner-gated, so a test about what a scannerless ship can see has
    // to stand somewhere it can see nothing — and on the hub, with four
    // stations and ten rifts, "somewhere" has to be searched for rather than
    // guessed at.  This is harness rule 5 (isolate from the live world) in
    // its strongest form: the world here is the thing being measured.
    await parkAwayFromContacts(page);

    const r = await engine(page, e => ({
      mk: e.scannerMk,
      ranges: e.scanRanges,
      arrows: e.renderer._indicatorBuffer.length,
      // CONTACTS on the map, excluding two things that are not the
      // instrument's doing: the landmarks a run starts charted with, and
      // MATERIALS, which are eyesight — a shard within encounter range is
      // seen, scanner or no scanner, and `minimap.spec.ts` owns that claim.
      uncharted: e.renderer._minimapBuffer.filter((i: any) =>
        i.entity.type !== 'STRUCTURE'
        && !(i.entity.isStation && i.entity.stationKind === 'home')
        && !(i.entity.isPortal && i.entity.id === e.arrivalPortalId)).length,
      scannerStat: (window as any).__omniStats?.scanner,
    }));

    expect(r.mk, 'a lean outfit carries no scanner').toBe(0);
    // Tier 1 is the widest reach there is, so zero there is zero everywhere.
    expect(r.ranges[1] ?? 0, 'no scanner reaches nowhere').toBe(0);
    expect(r.arrows, 'THE HUD CARRIES NO ARROWS AT ALL without a scanner').toBe(0);
    expect(r.uncharted, 'and the minimap carries nothing but the landmarks').toBe(0);
    // The HUD's scan button is absent, not merely disabled: a control for a
    // tool you do not own is a control that does nothing.
    expect(r.scannerStat, 'no scanner, no scan button').toBeUndefined();

    // And the tool refuses to fire, so there is no ping to draw either.
    expect(await engine(page, e => e.fireScan()), 'nothing to scan with').toBe(false);
    expect(await engine(page, e => e.scanPingRadius)).toBe(0);

    watch.assertClean();
  });

  test('the home station and the arrival rift are charted without a scanner',
    async ({ page }) => {
      const watch = await boot(page);
      await startRun(page);
      await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');
      await page.waitForTimeout(400);

      // In the HUB the landmark is the home station.  There is no arrival
      // rift — the run started here rather than arriving through anything —
      // which is itself the rule: `arrivalPortalId` is set by a TRANSIT.
      const hub = await engine(page, e => ({
        arrival: e.arrivalPortalId,
        home: e.renderer._minimapBuffer.some((i: any) =>
          i.entity.isStation && i.entity.stationKind === 'home'),
      }));
      expect(hub.arrival, 'a fresh run arrived through nothing').toBeNull();
      expect(hub.home, 'home is on the map with no scanner').toBe(true);

      // Travel through a rift.  The return portal in the destination — the
      // one pointing back at the hub — is then charted, and it is the ONLY
      // portal that is.
      // Driven through `transitionToMap` — which is what `enterPortal` is a
      // two-line wrapper over, and the thing that actually resolves the
      // arrival rift.  Parking on a hub portal and using the real gesture was
      // tried and is not sound here: the hub's TEST RACK sits beside the home
      // station, so the shared nearest-wins arbitration hands the press to
      // the STATION and the rift never becomes `nearestPortal`.  Fighting the
      // arbitration would be testing station proximity, not charting.
      await engine(page, e => {
        const p = e.portals.find((x: any) => x.portalTargetId && !x.isDescent);
        e.transitionToMap(p.portalTargetId);
      });
      // The transit freezes the loop for the warp beat, so poll the map
      // rather than sleeping through it.
      await waitForStats(page, s => s.currentMapType !== 'OVERWORLD', 'the destination');
      await page.waitForTimeout(300);

      const after = await engine(page, e => ({
        map: e.currentMap.type,
        arrival: e.arrivalPortalId,
        charted: e.renderer._minimapBuffer.filter((i: any) => i.entity.isPortal)
          .map((i: any) => i.entity.id),
        portals: e.portals.length,
        arrows: e.renderer._indicatorBuffer.length,
      }));
      expect(after.map, 'the transit happened').not.toBe('OVERWORLD');
      expect(after.arrival, 'the rift we came out of is remembered').not.toBeNull();
      expect(after.charted, 'exactly the arrival rift, charted with no scanner')
        .toEqual([after.arrival]);
      // The user's own words: "no arrows will point to it still on the HUD".
      expect(after.arrows, 'a charted landmark gets a MAP mark, never an arrow').toBe(0);

      watch.assertClean();
    });

  test('the mark is a CATEGORY ladder: the same contact, one mark apart',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);

      // A RIVAL is tier 3 (rare), so it is the cleanest ladder probe there
      // is: the SAME contact at the SAME distance is invisible to a Mk II and
      // found by a Mk III.  Spawned through the real engine path and then
      // parked beside the player, rather than hand-rolled — the detection
      // sweep walks `entityIndex.enemies`, and a synthetic entity would be
      // asserting that the test agrees with itself (harness rule 6).
      const park = async () => engine(page, e => {
        const r = e.entityIndex.enemies.find((x: any) => x.isRival === true);
        if (!r) return false;
        // Beyond SCANNER.ENCOUNTER_RANGE (900) — inside it the rival is seen
        // with the naked eye whatever the mark, and the ladder claim would be
        // measuring eyesight.  Still inside both marks' reach (a lone Mk II
        // makes ~2420), so the ONLY variable left is the mark.
        r.position.x = e.player.position.x + 1600;
        r.position.y = e.player.position.y;
        r.velocity.x = 0; r.velocity.y = 0;
        r.detectedAt = undefined;
        return true;
      });

      await engine(page, e => { e.resetOutfit(); e.debugSpawnRival('neutral'); });
      await waitForEngine(page, e =>
        e.entityIndex.enemies.some((x: any) => x.isRival === true), 'a rival');

      // Mk II: its ladder stops at enemies, and a rival is a rung above.
      await engine(page, e => e.debugGrantModule('scanner_mk2'));
      await waitForEngine(page, e => e.scannerMk === 2, 'Mk II');
      expect(await park(), 'the rival is parked in reach').toBe(true);
      await scanOnce(page);
      const mk2 = await engine(page, e => e.entityIndex.enemies
        .some((x: any) => x.isRival === true && x.detectedAt !== undefined));
      expect(mk2, 'a Mk II does not find a rival').toBe(false);

      // Mk III: same scene, same distance, one mark higher.
      await engine(page, e => { e.resetOutfit(); e.debugGrantModule('scanner_mk3'); });
      await waitForEngine(page, e => e.scannerMk === 3, 'Mk III');
      expect(await park()).toBe(true);
      await scanOnce(page);
      const mk3 = await engine(page, e => e.entityIndex.enemies
        .some((x: any) => x.isRival === true && x.detectedAt !== undefined));
      expect(mk3, 'a Mk III does').toBe(true);

      watch.assertClean();
    });

  test('marks STACK in range: a tier reaches as far as every scanner that sees it',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);

      // The user's own worked example: a Mk III plus two Mk I should reach
      // ~3x as far for Mk I features as for Mk III ones, because all three
      // scanners can see tier 1 and only the Mk III sees tier 3.
      await engine(page, e => {
        e.resetOutfit();
        e.debugGrantModule('scanner_mk3');
        e.debugGrantModule('scanner_mk1');
        e.debugGrantModule('scanner_mk1');
      });
      await waitForEngine(page, e => e.scannerMk === 3, 'the rack');

      const r = await engine(page, e => ({
        mk: e.scannerMk,
        t1: e.scanRanges[1], t2: e.scanRanges[2], t3: e.scanRanges[3],
        t4: e.scanRanges[4],
      }));

      // CATEGORY is still the highest mark aboard — stacking buys range, not
      // tiers.  Three scanners do not add up to a Mk IV.
      expect(r.mk).toBe(3);
      expect(r.t4, 'no scanner aboard reaches tier 4').toBe(0);

      // Tier 1 collects all three; tiers 2 and 3 collect only the Mk III, so
      // they are equal to each other and about a third of tier 1.
      expect(r.t2).toBeCloseTo(r.t3, 5);
      expect(r.t1 / r.t3).toBeGreaterThan(2.5);
      expect(r.t1 / r.t3).toBeLessThan(3.1);

      // A SECOND Mk III widens every tier it can see, which is the point of
      // stacking — and leaves tier 4 alone, which is the point of the ladder.
      const before = r.t3;
      await engine(page, e => e.debugGrantModule('scanner_mk3'));
      await waitForEngine(page, e => e.scanRanges[3] > 0, 'the fold');
      const after = await engine(page, e => ({ t3: e.scanRanges[3], t4: e.scanRanges[4] }));
      expect(after.t3, 'a second Mk III doubles tier-3 reach').toBeCloseTo(before * 2, 3);
      expect(after.t4).toBe(0);

      watch.assertClean();
    });

  test('a mark fades, and an OFFLINE scanner is no scanner', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');

    await engine(page, e => { e.resetOutfit(); e.debugGrantModule('scanner_mk5'); });
    await waitForEngine(page, e => e.scannerMk === 5, 'Mk V');
    // Park on a rift so the ping is certain to cross it.
    await engine(page, e => {
      const p = e.portals[0];
      e.player.position.x = p.position.x + 600;
      e.player.position.y = p.position.y;
      e.camera.position.x = e.player.position.x;
      e.camera.position.y = e.player.position.y;
    });
    await scanOnce(page);

    // FRESH: full strength.  The alpha ramp is the ONE freshness definition
    // and both readouts call it, so measuring it here covers both.
    const fresh = await engine(page, e =>
      e.renderer.detectAlpha(e.portals[0].detectedAt));
    expect(fresh).toBeCloseTo(1, 2);

    // STALE: past LINGER_SEC the mark is gone entirely, so "faded out" and
    // "not drawn" are the same state rather than two that can disagree.
    const stale = await engine(page, e =>
      e.renderer.detectAlpha(e.simClock - 1000));
    expect(stale).toBe(0);

    // An adjacency-OFFLINE scanner contributes nothing at all — the same
    // rule every other module obeys, and the reason the fold reads ACTIVE
    // slots rather than filled ones.
    await engine(page, e => { e.resetOutfit(); e.debugGrantModule('scanner_mk3'); });
    await waitForEngine(page, e => e.scannerMk === 3, 'a scanner to isolate');
    const iso = await isolate(page, 'ship', 'hull_base', 'scanner_mk3');
    expect(iso.modActive, 'the arrangement really did isolate it').toBe(false);
    const off = await engine(page, e => ({ mk: e.scannerMk, t1: e.scanRanges[1] ?? 0 }));
    expect(off.mk, 'an OFFLINE scanner is no scanner').toBe(0);
    expect(off.t1, 'and reaches nowhere').toBe(0);

    watch.assertClean();
  });

  test('the cooldown is real, and the ping is one at a time', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await engine(page, e => { e.resetOutfit(); e.debugGrantModule('scanner_mk3'); });
    await waitForEngine(page, e => e.scannerMk === 3, 'a scanner');

    const first = await engine(page, e => e.fireScan());
    expect(first, 'the first press scans').toBe(true);
    const second = await engine(page, e => e.fireScan());
    expect(second, 'the second press is refused while the cooldown runs').toBe(false);

    // The stat the HUD button reads agrees with the engine that refused it.
    // WAIT for the payload rather than reading it once: the engine wait above
    // returns on LIVE state, while `stats` is the last PUSHED snapshot, and
    // `scanner` is published conditionally — so a one-frame lag shows up as
    // `undefined` rather than as a wrong number (README rule 12).
    const st = await waitForStats(page, s => s.scanner?.mk === 3,
      'the payload to carry the Mk III scanner');
    expect(st.scanner?.cooldown ?? 0).toBeGreaterThan(0);
    expect(st.scanner?.mk).toBe(3);

    watch.assertClean();
  });

  test('flying past a landmark charts it for good — no scanner needed',
    async ({ page }) => {
      const watch = await boot(page);
      await startRun(page);
      await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');
// The scanner ships BYPASSED (DBG "Scan off" defaults to REVEALED), so
      // this suite has to switch the subsystem it tests back on.
      await useScanner(page);

      // A rift the player has never been near: not found, not on the map.
      await parkAwayFromContacts(page);
      await engine(page, e => { for (const p of e.portals) p.found = false; });
      await page.waitForTimeout(250);
      const before = await engine(page, e => ({
        found: e.portals.filter((p: any) => p.found === true).length,
        onMap: e.renderer._minimapBuffer.filter((i: any) => i.entity.isPortal).length,
      }));
      expect(before.found, 'nothing charted from out here').toBe(0);
      expect(before.onMap).toBe(0);

      // Fly to it.  NATURAL ENCOUNTER is not scanner-gated and not
      // mark-gated: you were there, you saw it.
      await engine(page, e => {
        const p = e.portals[0];
        e.player.position.x = p.position.x + 200;
        e.player.position.y = p.position.y;
        e.player.velocity.x = 0; e.player.velocity.y = 0;
        e.camera.position.x = e.player.position.x;
        e.camera.position.y = e.player.position.y;
      });
      await waitForEngine(page, e => e.portals[0].found === true, 'the rift to be charted');

      // AND IT STAYS.  Fly right across the map: a found landmark is not a
      // fading contact, which is the whole point of the found/tracked split.
      await engine(page, e => {
        e.player.position.x += 5000; e.player.position.y += 5000;
        e.camera.position.x = e.player.position.x;
        e.camera.position.y = e.player.position.y;
        // Clear the transient stamp so ONLY `found` can put it on the map.
        for (const p of e.portals) { p.detectedAt = undefined; p.trackedAt = undefined; }
      });
      await page.waitForTimeout(400);

      const after = await engine(page, e => {
        const p = e.portals[0];
        return {
          found: p.found === true,
          onMap: e.renderer._minimapBuffer.some((i: any) => i.entity === p),
          arrow: e.renderer._indicatorBuffer.some((i: any) => i.entity === p),
          mapAlpha: e.renderer.mapAlpha(p),
        };
      });
      expect(after.found, 'found is permanent for a fixed landmark').toBe(true);
      expect(after.onMap, 'and it is still on the minimap from across the map').toBe(true);
      expect(after.mapAlpha, 'at full strength — found does not fade').toBe(1);
      // The user's rule: found gets a MAP mark and never an ARROW.  Arrows
      // are transient by design — they say "something is there NOW".
      expect(after.arrow, 'a found landmark gets no arrow').toBe(false);

      watch.assertClean();
    });

  test('a moving contact is tracked for a few seconds, never charted',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);
// The scanner ships BYPASSED (DBG "Scan off" defaults to REVEALED), so
      // this suite has to switch the subsystem it tests back on.
      await useScanner(page);

      await engine(page, e => { e.resetOutfit(); e.debugSpawnRival('neutral'); });
      await waitForEngine(page, e =>
        e.entityIndex.enemies.some((x: any) => x.isRival === true), 'a rival');

      // Park it right beside the player: an encounter, no scanner involved.
      await engine(page, e => {
        const r = e.entityIndex.enemies.find((x: any) => x.isRival === true);
        r.position.x = e.player.position.x + 300;
        r.position.y = e.player.position.y;
        r.velocity.x = 0; r.velocity.y = 0;
      });
      await waitForEngine(page, e => {
        const r = e.entityIndex.enemies.find((x: any) => x.isRival === true);
        return r !== undefined && r.detectedAt !== undefined;
      }, 'the rival to be seen');

      const seen = await engine(page, e => {
        const r = e.entityIndex.enemies.find((x: any) => x.isRival === true);
        return { found: r.found === true, alpha: e.renderer.mapAlpha(r) };
      });
      // A thing that MOVES is never charted: a stale dot where an enemy used
      // to be is worse than no dot.
      expect(seen.found, 'a mobile contact is never found').toBe(false);
      expect(seen.alpha, 'but it IS on the map right now').toBeGreaterThan(0);

      // And it drops off once the mark goes stale, which `found` never does.
      const stale = await engine(page, e => {
        const r = e.entityIndex.enemies.find((x: any) => x.isRival === true);
        r.detectedAt = e.simClock - 1000;
        r.trackedAt = undefined;
        return e.renderer.mapAlpha(r);
      });
      expect(stale, 'a tracked contact expires').toBe(0);

      watch.assertClean();
    });

  test('auto-scan is Mk II+, feeds the MINIMAP only, and the switch stops it',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);
// The scanner ships BYPASSED (DBG "Scan off" defaults to REVEALED), so
      // this suite has to switch the subsystem it tests back on.
      await useScanner(page);

      // Mk I is fully manual — auto-tracking is what a mark buys.
      await engine(page, e => { e.resetOutfit(); e.debugGrantModule('scanner_mk1'); });
      await waitForEngine(page, e => e.scannerMk === 1, 'Mk I');
      // Wait for the PAYLOAD to carry it — see rule 12.  `autoCapable` is
      // asserted `false`, and a lagging payload gives `undefined`, which is
      // not false and fails for the wrong reason.
      const mk1 = await waitForStats(page, s => s.scanner?.mk === 1,
        'the payload to carry the Mk I scanner');
      expect(mk1.scanner?.autoCapable, 'Mk I cannot auto-scan').toBe(false);
      // …so the pause-menu switch does not render for it either.
      await page.waitForTimeout(300);
      expect(await engine(page, e => e.autoPingRadius),
        'and no sweep is running').toBe(0);

      await engine(page, e => { e.resetOutfit(); e.debugGrantModule('scanner_mk3'); });
      await waitForEngine(page, e => e.scannerMk === 3, 'Mk III');
      expect((await waitForStats(page, s => s.scanner?.mk === 3,
        'the payload to carry the Mk III scanner')).scanner?.autoCapable).toBe(true);

      // Plant a contact and let the background sweep find it WITHOUT any
      // press.  The sweep is driven directly rather than waited out: its
      // interval is sim-seconds and this environment renders in software.
      await engine(page, e => { e.debugSpawnRival('neutral'); });
      await waitForEngine(page, e =>
        e.entityIndex.enemies.some((x: any) => x.isRival === true), 'a rival');
      await engine(page, e => {
        const r = e.entityIndex.enemies.find((x: any) => x.isRival === true);
        // Outside natural-encounter range, so ONLY the sweep can find it.
        r.position.x = e.player.position.x + 1600;
        r.position.y = e.player.position.y;
        r.velocity.x = 0; r.velocity.y = 0;
        r.detectedAt = undefined; r.trackedAt = undefined;
        e.autoScanTimer = 1e6;   // fire the sweep on the next step
      });
      await waitForEngine(page, e => {
        const r = e.entityIndex.enemies.find((x: any) => x.isRival === true);
        return r !== undefined && r.trackedAt !== undefined;
      }, 'the background sweep to find it');

      const auto = await engine(page, e => {
        const r = e.entityIndex.enemies.find((x: any) => x.isRival === true);
        return {
          tracked: r.trackedAt !== undefined,
          detected: r.detectedAt !== undefined,
          mapAlpha: e.renderer.mapAlpha(r),
        };
      });
      // THE WHOLE POINT: the sweep feeds the minimap and nothing else.  It
      // stamps `trackedAt`, never `detectedAt`, so it cannot put a chevron on
      // screen the player never asked for.
      expect(auto.tracked, 'the sweep found it').toBe(true);
      expect(auto.detected, 'but it is NOT an arrow-grade detection').toBe(false);
      expect(auto.mapAlpha, 'and it is on the minimap').toBeGreaterThan(0);

      // The switch really stops it.
      await engine(page, e => {
        e.setAutoScan(false);
        const r = e.entityIndex.enemies.find((x: any) => x.isRival === true);
        r.trackedAt = undefined;
        e.autoScanTimer = 1e6;
      });
      await page.waitForTimeout(400);
      const off = await engine(page, e => {
        const r = e.entityIndex.enemies.find((x: any) => x.isRival === true);
        return { tracked: r.trackedAt !== undefined, radius: e.autoPingRadius,
                 autoOn: (window as any).__omniStats?.scanner?.autoOn };
      });
      expect(off.tracked, 'switched off, nothing is swept').toBe(false);
      expect(off.radius).toBe(0);
      expect(off.autoOn).toBe(false);

      await engine(page, e => e.setAutoScan(true));
      watch.assertClean();
    });

  test('a portal arrow needs a scan, whatever the mark', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');

    await engine(page, e => { e.resetOutfit(); e.debugGrantModule('scanner_mk5'); });
    await waitForEngine(page, e => e.scannerMk === 5, 'Mk V');
    await engine(page, e => {
      const p = e.portals[0];
      // Beyond SCANNER.ENCOUNTER_RANGE (900): inside it the rift is seen with
      // the naked eye, and the test would be measuring eyesight rather than
      // the instrument.
      e.player.position.x = p.position.x + 1400;
      e.player.position.y = p.position.y;
      e.camera.position.x = e.player.position.x;
      e.camera.position.y = e.player.position.y;
    });
    await page.waitForTimeout(250);

    // Fitted but not fired: still nothing.  The scanner is a TOOL — owning it
    // is not using it, which is the whole reversal from A4.
    expect(await portalIndicated(page), 'a scanner you never fire reveals nothing').toBe(false);

    await scanOnce(page);
    expect(await portalIndicated(page), 'the ping is what puts it there').toBe(true);

    watch.assertClean();
  });
});

// ── A5 — purchasable hex slots ──────────────────────────────────────────────

/** Fly to the hub's TRADE HUB (the one station stocking both shops) and dock
 *  through the real path — `dockAtStation` reads `nearestStation`, which is
 *  stamped by the per-step proximity pass, so the position write has to land
 *  a frame before the dock. */
async function dockAtTradeHub(page: any) {
  await startRun(page);
  await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');
  await engine(page, e => {
    const st = e.stations.find((s: any) => s.stationKind === 'tradehub');
    e.player.position.x = st.position.x;
    e.player.position.y = st.position.y;
    e.player.velocity.x = 0; e.player.velocity.y = 0;
  });
  await waitForEngine(page, e => e.nearestStation?.stationKind === 'tradehub',
    'the trade hub to come into range');
  await engine(page, e => e.dockAtStation());
  await waitForEngine(page, e => e.dockedAtStation === true, 'the dock');
}

test.describe('purchasable hex slots', () => {
  test('a shipped run has every hex, and the shop offers none', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);

    const r = await engine(page, e => ({
      ship: e.shipSlotsUnlocked, weapon: e.weaponSlotsUnlocked,
      snap: e.outfittingSnapshot(),
    }));
    // MODULE_SLOT_UNLOCK.START is the CAP today — the count is the seam for
    // the ship catalog, not a balance number set here — so a shipped run is
    // byte-identical to the one before A5 existed.
    expect(r.ship).toBe(7);
    expect(r.weapon).toBe(7);
    expect(r.snap.shipUnlocked).toBe(7);
    expect(r.snap.weaponUnlocked).toBe(7);
    expect(r.snap.shipSlotOffer, 'a full flower has nothing to sell').toBeUndefined();
    expect(r.snap.weaponSlotOffer).toBeUndefined();

    watch.assertClean();
  });

  test('a locked hex refuses every way in, and the adjacency table never moved',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);

      // Lock the flowers down to three hexes each (DBG — a shipped run has
      // nothing locked, so this is the only way to reach the state).
      await engine(page, e => { while (e.shipSlotsUnlocked !== 3) e.dbg.cycleSlotLock(); });

      const r = await engine(page, e => {
        // A DRAG onto a locked hex: refused by the move path itself, not just
        // by the missing [data-tile] in the DOM.  Placed straight into the
        // hold rather than granted, since `debugGrantModule` would auto-install
        // it into an unlocked hex — which is the NEXT claim, not this one.
        e.inventory[0] = 'plating_mk1';
        const intoLocked = e.moveModuleInternal(
          { area: 'inventory', idx: 0 }, { area: 'ship', idx: 5 });
        const intoUnlocked = e.moveModuleInternal(
          { area: 'inventory', idx: 0 }, { area: 'ship', idx: 1 });
        // …and an AUTO-install skips it: `debugGrantModule` fills the first
        // free hex, which must never be one that does not exist yet.
        e.shipSlots.fill(null);
        e.shipSlots[0] = 'hull_base';
        e.syncOutfitAfterDebugSlotLock();
        for (let i = 0; i < 6; i++) e.debugGrantModule('plating_mk1');
        return {
          intoLocked, intoUnlocked,
          lockedOccupied: e.shipSlots.slice(3).filter((x: any) => x !== null).length,
          filled: e.shipSlots.slice(0, 3).filter((x: any) => x !== null).length,
          // The fixpoint's inputs are untouched: a locked hex is an EMPTY hex,
          // and an empty hex was always invisible to it.
          hullActive: e.activeShip[0],
          platingActive: e.activeShip[1] && e.activeShip[2],
          shieldGated: e.player.maxShield,
        };
      });
      expect(r.intoLocked, 'the move path refuses a locked destination').toBe(false);
      expect(r.intoUnlocked, 'the same move into an unlocked hex still works').toBe(true);
      expect(r.lockedOccupied, 'nothing ever lands past the unlocked count').toBe(0);
      expect(r.filled, 'the unlocked hexes fill normally').toBe(3);
      expect(r.hullActive, 'the hull root is still a root').toBe(true);
      expect(r.platingActive, 'and adjacency still resolves inside the flower').toBe(true);
      expect(r.shieldGated, 'plating with no core still contributes nothing').toBe(0);

      watch.assertClean();
    });

  test('a station sells the next hex; nowhere else does', async ({ page }) => {
    const watch = await boot(page);
    await dockAtTradeHub(page);
    await engine(page, e => { while (e.shipSlotsUnlocked !== 5) e.dbg.cycleSlotLock(); });

    const offer = await engine(page, e => e.outfittingSnapshot().shipSlotOffer);
    expect(offer, 'a flower with room has an offer').toBeTruthy();
    expect(offer.available, 'the trade hub stocks both flowers').toBe(true);
    expect(offer.affordable, 'and a fresh run cannot afford it').toBe(false);

    const bought = await engine(page, (e, price: number) => {
      e.credits = price;
      const ok = e.purchaseSlot('ship');
      return { ok, unlocked: e.shipSlotsUnlocked, credits: e.credits };
    }, offer.cost);
    expect(bought.ok).toBe(true);
    expect(bought.unlocked, 'one more hex').toBe(6);
    expect(bought.credits, 'paid for at the offered price').toBe(0);

    // The newly bought hex takes a module the locked one refused.
    const usable = await engine(page, e => {
      e.debugGrantModule('plating_mk1');
      return e.shipSlots[5] !== null || e.shipSlots.indexOf('plating_mk1') !== -1;
    });
    expect(usable, 'and it is a real hex the moment it is paid for').toBe(true);

    // UNDOCKED it is refused, like every other commerce method.
    const away = await engine(page, e => {
      e.undock();
      e.credits = 1e9;
      return { ok: e.purchaseSlot('ship'), unlocked: e.shipSlotsUnlocked };
    });
    expect(away.ok, 'commerce is station-only').toBe(false);
    expect(away.unlocked).toBe(6);

    watch.assertClean();
  });

  test('the cap is the flower, and money cannot pass it', async ({ page }) => {
    const watch = await boot(page);
    await dockAtTradeHub(page);
    await engine(page, e => { while (e.shipSlotsUnlocked !== 3) e.dbg.cycleSlotLock(); });

    const r = await engine(page, e => {
      e.credits = 1e9;
      let bought = 0;
      for (let i = 0; i < 20; i++) if (e.purchaseSlot('ship')) bought++;
      return {
        bought, unlocked: e.shipSlotsUnlocked,
        offer: e.outfittingSnapshot().shipSlotOffer,
        // The OTHER flower is bought separately — the two counts are
        // independent, which is what "per ship, per group" means.
        weapon: e.weaponSlotsUnlocked,
      };
    });
    expect(r.unlocked, 'stops at the seven hexes a flower has').toBe(7);
    expect(r.bought, 'four purchases got there, and nothing more sold').toBe(4);
    expect(r.offer, 'a full flower offers nothing').toBeUndefined();
    expect(r.weapon, 'the weapon flower was not bought along the way').toBe(3);

    watch.assertClean();
  });

  test('a run reset puts the counts back', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);
    await engine(page, e => { while (e.shipSlotsUnlocked !== 4) e.dbg.cycleSlotLock(); });
    expect(await engine(page, e => e.shipSlotsUnlocked)).toBe(4);

    await engine(page, e => e.resetOutfit());
    const r = await engine(page, e => ({
      ship: e.shipSlotsUnlocked, weapon: e.weaponSlotsUnlocked,
    }));
    expect(r.ship, 'unlocks are RUN state, reset with the outfit they belong to').toBe(7);
    expect(r.weapon).toBe(7);

    watch.assertClean();
  });
});
