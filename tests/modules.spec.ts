/** PENETRATION (A3) and SCANNER (A4) — the two Phase-A module families.
 *
 *  Both drop into the outfitting system as it ships: a `statMks` row in
 *  MODULE_DEFS, an effect summed by `applyModuleEffects`, and one consumer
 *  reading the folded value.  Neither adds a subsystem, and that is exactly
 *  what makes them easy to break quietly — an effect that stops being folded,
 *  or an adjacency-offline module that keeps contributing, changes no shape
 *  on screen and throws nothing.
 *
 *  What is pinned:
 *   1. PENETRATION RAISES EFFECTIVE PIERCE, through the real weapon path —
 *      the spawned projectile's `pierceCount`, not the module's effect field.
 *   2. THE LASER CAPS.  It ships `pierce: 99` as "effectively infinite"; the
 *      bonus must land on MAX_PIERCE rather than run past it.
 *   3. A BOLT ACTUALLY PASSES THROUGH.  A real Blaster shot, resolved through
 *      the real collision path, damages a second enemy with Mk I installed
 *      and stops on the first without it.
 *   4. EACH SCANNER MARK REVEALS ITS OWN TIER, measured against the
 *      no-scanner baseline in the same scene.
 *   5. OFFLINE IS ZERO.  An adjacency-offline module of either family
 *      contributes exactly nothing — which for the scanner means the
 *      baseline, to the pixel.
 *
 *  Every reveal assertion reads the BASELINE first and the scanner state
 *  second in the same scene, because "today's behaviour exactly" is the load-
 *  bearing half of A4: the existing indicator/minimap/portal suites are
 *  written against the no-scanner gating and must keep passing.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, startRun, stats, waitForStats, waitForEngine, quietScene } from './helpers';

/** MAX_PIERCE / WEAPONS[BOUNCER].pierce, hard-coded (harness rule: a test
 *  that imports the constant it is checking pins nothing). */
const MAX_PIERCE = 99;

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
    return { count: spawned.length, pierceCount: spawned[0]?.pierceCount ?? null };
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

// ── A3 — Penetration ────────────────────────────────────────────────────────

test.describe('penetration module', () => {
  test('the lean start pierces nothing; each mark adds one', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);

    // BASELINE. The Blaster ships `pierce: 0` — it stops on what it hits.
    expect(await engine(page, e => e.player.pierceBonus ?? 0),
      'a lean outfit carries no penetration').toBe(0);
    expect((await fireOne(page)).pierceCount,
      'so a Blaster bolt spawns with the gun\'s own pierce').toBe(0);

    const mk1 = await grant(page, 'piercing_mk1');
    expect(mk1.active, 'granted beside the starter Blaster, it is connected').toBe(true);
    expect(await engine(page, e => e.player.pierceBonus), 'Mk I = +1').toBe(1);
    expect((await fireOne(page)).pierceCount, 'and the SHOT carries it').toBe(1);

    // Marks are ordinary stat items: a second one stacks, the way two Hull
    // modules stack.  (The scanner is the deliberate exception — see below.)
    await grant(page, 'piercing_mk2');
    expect(await engine(page, e => e.player.pierceBonus), 'Mk I + Mk II = +3').toBe(3);
    expect((await fireOne(page)).pierceCount).toBe(3);

    watch.assertClean();
  });

  test('offline contributes nothing', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);
    await grant(page, 'piercing_mk3');
    expect(await engine(page, e => e.player.pierceBonus), 'connected: +3').toBe(3);

    // Same module, same flower, no gun contact.
    const iso = await isolate(page, 'weapon', 'wpn_blaster', 'piercing_mk3');
    expect(iso.rootActive, 'the gun is a root — always active').toBe(true);
    expect(iso.modActive, 'the mod is not touching it').toBe(false);
    expect(await engine(page, e => e.player.pierceBonus),
      'an OFFLINE module contributes zero, not its effect').toBe(0);
    expect((await fireOne(page)).pierceCount, 'and the shot is the bare gun again').toBe(0);

    watch.assertClean();
  });

  test('the Laser\'s effectively-infinite pierce caps rather than overflowing', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);
    await engine(page, e => {
      e.debugGrantWeapon('BOUNCER');
      e.debugGrantModule('piercing_mk3');
    });
    const armed = await engine(page, e => ({
      weapon: e.player.currentWeapon, bonus: e.player.pierceBonus,
    }));
    expect(armed.bonus).toBe(3);
    // Select the Laser explicitly — the grant mounts it but the active gun
    // is whatever the loadout sync landed on.
    await engine(page, e => e.selectWeapon('BOUNCER'));
    expect(await engine(page, e => e.player.currentWeapon)).toBe('BOUNCER');

    const shot = await fireOne(page);
    expect(shot.pierceCount,
      '99 is the ceiling the Laser defines, not a number to add past').toBe(MAX_PIERCE);

    watch.assertClean();
  });

  test('a Blaster bolt with Mk I passes through the first enemy and hits a second',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);

      /** Fire one real shot and walk it through TWO parked enemies with the
       *  real collision resolver — the traits suite's rule: a shell whose
       *  flight depends on the terrain layout tests the terrain. */
      const run = async () => engine(page, e => {
        const ctx = e.waveContext();
        const a = e.waves.spawnAt('RAMMER_1',
          { x: e.player.position.x + 300, y: e.player.position.y }, ctx, false);
        const b = e.waves.spawnAt('RAMMER_1',
          { x: e.player.position.x + 600, y: e.player.position.y }, ctx, false);
        a.maxSpeed = 0; b.maxSpeed = 0;
        a.health = a.maxHealth = 1e6;
        b.health = b.maxHealth = 1e6;

        e.player.weaponCooldown = 0;
        const before = e.currentMap.entities.length;
        e.weapons.firePlayerWeapon(
          e.currentMap.entities, e.player,
          { x: e.player.position.x + 500, y: e.player.position.y },
          undefined, false,
        );
        const proj = e.currentMap.entities.slice(before)
          .find((x: any) => x.type === 'PROJECTILE');

        const aBefore = a.health;
        e.physics.resolveCollision(proj, a, { x: 0, y: 0 });
        const firstHit = aBefore - a.health;
        const survived = proj.active === true;
        let secondHit = 0;
        if (survived) {
          const bBefore = b.health;
          e.physics.resolveCollision(proj, b, { x: 0, y: 0 });
          secondHit = bBefore - b.health;
        }
        a.active = false; b.active = false;
        proj.active = false;
        return { firstHit, survived, secondHit };
      });

      const bare = await run();
      expect(bare.firstHit, 'the bolt lands').toBeGreaterThan(0);
      expect(bare.survived, 'and with no module it stops there').toBe(false);
      expect(bare.secondHit).toBe(0);

      await grant(page, 'piercing_mk1');
      const pierced = await run();
      expect(pierced.firstHit).toBeGreaterThan(0);
      expect(pierced.survived, 'Mk I: the bolt carries on').toBe(true);
      expect(pierced.secondHit, 'and the second enemy takes the same bite')
        .toBeCloseTo(pierced.firstHit, 5);

      watch.assertClean();
    });

  test('the Ship Status panel attributes it like every other stat', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);
    await grant(page, 'piercing_mk2');

    const online = await engine(page, e => {
      const l = e.outfittingSnapshot().statLines ?? [];
      return l.find((x: any) => x.id === 'pierce');
    });
    expect(online, 'the panel carries a Penetration line').toBeTruthy();
    expect(online.display).toBe('+2');
    expect(online.baseDisplay).toBe('+0');
    expect(online.contributors.length).toBe(1);
    expect(online.contributors[0].active).toBe(true);
    expect(online.contributors[0].display).toBe('+2');

    await isolate(page, 'weapon', 'wpn_blaster', 'piercing_mk2');
    const offline = await engine(page, e => {
      const l = e.outfittingSnapshot().statLines ?? [];
      return l.find((x: any) => x.id === 'pierce');
    });
    expect(offline.display, 'offline: the headline drops to the base').toBe('+0');
    expect(offline.contributors[0].active).toBe(false);
    expect(offline.contributors[0].requires, 'and names the contact it wants').toBe('gun');

    watch.assertClean();
  });
});

// ── A4 — Scanner ────────────────────────────────────────────────────────────

/** Is a portal in the off-screen indicator buffer this frame? */
const portalIndicated = (page: any) => engine(page, e =>
  e.renderer._indicatorBuffer.some((i: any) => i.entity.isPortal === true));

test.describe('scanner module', () => {
  test('no scanner: the reveal gates are exactly today\'s', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);

    const r = await engine(page, e => ({
      mk: e.scannerMk,
      pushed: e.renderer.scannerMk,
      dots: e.renderer.minimapShardDots,
    }));
    const s0 = await stats(page);
    expect(r.mk, 'a lean outfit carries no scanner').toBe(0);
    expect(r.pushed, 'and the renderer is told so every frame').toBe(0);
    // The shipped material default is DOTS (user call), so the honest
    // baseline claim is "the DBG cycle alone decides" — not "off".
    expect(r.dots, 'the minimap layer follows the DBG cycle and nothing else')
      .toBe(s0.minimapMaterialName === 'Dots');

    watch.assertClean();
  });

  test('Mk I reveals materials on the minimap, whatever the DBG cycle says',
    async ({ page }) => {
      const watch = await boot(page);
      // The HUB, not a showcase field: MAP_POPULATION only gives the natural
      // maps free-spawn rock SHARDS, and mobile shards are the whole contact
      // class this mark reveals.
      await startRun(page);
      await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');
      await quietScene(page);

      // Force the cycle off the dots layer so the scanner is unambiguously
      // the cause.  With no scanner installed, `minimapShardDots` IS the
      // cycle's answer, so it is the honest thing to poll on.
      await engine(page, e => {
        for (let i = 0; i < 4 && e.renderer.minimapShardDots; i++) e.dbg.cycleMinimapMaterial();
      });
      expect(await engine(page, e => e.renderer.minimapShardDots),
        'baseline: the cycle is off the dots layer').toBe(false);
      await waitForEngine(page, e =>
        !e.renderer._minimapBuffer.some((i: any) => i.entity.type === 'STRUCTURE'),
        'the shard dots to leave the minimap buffer');

      const g = await grant(page, 'scanner_mk1');
      expect(g.active).toBe(true);
      await waitForEngine(page, e => e.renderer.scannerMk === 1,
        'the tier to reach the renderer');
      expect(await engine(page, e => e.renderer.minimapShardDots),
        'Mk I draws them on top of the cycle').toBe(true);
      await waitForEngine(page, e =>
        e.renderer._minimapBuffer.some((i: any) => i.entity.type === 'STRUCTURE'),
        'shards to reach the minimap buffer');

      // …and losing it puts the gate straight back.
      await engine(page, e => e.resetOutfit());
      await waitForEngine(page, e => e.renderer.scannerMk === 0, 'the tier to clear');
      expect(await engine(page, e => e.renderer.minimapShardDots)).toBe(false);
      await waitForEngine(page, e =>
        !e.renderer._minimapBuffer.some((i: any) => i.entity.type === 'STRUCTURE'),
        'and the dots to go with it');

      watch.assertClean();
    });

  test('Mk II pushes the enemy chevron\'s fade ramp out', async ({ page }) => {
    const watch = await boot(page);
    await quietField(page);

    /*  Enemy chevrons are range-UNLIMITED already, so the range gate that
     *  actually exists for them is the FADE ramp — and it exists ONLY as a
     *  globalAlpha inside the draw.  `enemyIndicatorAlpha` is the ramp,
     *  pulled out pure and published on __omniHud for exactly that reason
     *  (the same terms computeIndicatorRect is published on): a tier that
     *  reveals nothing, or reveals at the wrong mark, throws nothing. */
    const ramp = (mk: number, dist: number) => page.evaluate(
      ([m, d]) => (window as any).__omniHud.enemyIndicatorAlpha(d, m) as number,
      [mk, dist] as [number, number]);

    // Inside the base ramp nothing changes at any tier — a near contact was
    // already at full strength and there is nothing to reveal.
    expect(await ramp(0, 400)).toBe(1);
    expect(await ramp(2, 400)).toBe(1);

    // Past the base ramp's END a contact sits on the alpha floor; Mk II is
    // still well up the curve there.  This is the reveal.
    const farBase = await ramp(0, 6000);
    const farMk2 = await ramp(2, 6000);
    expect(farBase, 'baseline: a 6000-unit contact is on the floor').toBeCloseTo(0.35, 5);
    expect(farMk2, 'Mk II holds it near full strength').toBeGreaterThan(farBase * 1.5);
    expect(farMk2).toBeLessThanOrEqual(1);

    // The marks are CUMULATIVE and ordered — Mk I must not buy the enemy tier.
    expect(await ramp(1, 6000), 'Mk I is materials only').toBeCloseTo(farBase, 5);
    expect(await ramp(3, 6000), 'Mk III keeps everything below it').toBeCloseTo(farMk2, 5);

    // And the renderer is actually handed the tier the ramp is a function of.
    await grant(page, 'scanner_mk2');
    await waitForEngine(page, e => e.renderer.scannerMk === 2,
      'the tier to reach the renderer');

    watch.assertClean();
  });

  test('Mk III lifts the portal chevron\'s range gate; below it, nothing moves',
    async ({ page }) => {
      const watch = await boot(page);
      // The hub is the map with rifts on it.
      await startRun(page);
      await waitForStats(page, s => s.currentMapType === 'OVERWORLD', 'the hub');
      await quietScene(page);

      // Park the player far from every rift — PORTAL_CONSTANTS.INDICATOR_RANGE
      // is 1500, so 6000 out is well past the gate for all of them.
      await engine(page, e => {
        let far = { x: 0, y: 0 }, best = -1;
        for (const p of e.portals) {
          let d = Infinity;
          for (const q of e.portals) {
            if (q === p) continue;
            const dx = q.position.x - p.position.x, dy = q.position.y - p.position.y;
            d = Math.min(d, Math.hypot(dx, dy));
          }
          if (d > best) { best = d; far = p.position; }
        }
        e.player.position.x = far.x + 6000;
        e.player.position.y = far.y + 6000;
        e.player.velocity.x = 0; e.player.velocity.y = 0;
      });

      await waitForEngine(page, e => e.renderer._indicatorBuffer.length >= 0, 'a frame');
      expect(await portalIndicated(page),
        'baseline: a rift 6000 units out is past INDICATOR_RANGE').toBe(false);

      // Mk I and Mk II must not touch this gate — the marks are cumulative,
      // not interchangeable.
      await grant(page, 'scanner_mk2');
      await waitForEngine(page, e => e.renderer.scannerMk === 2, 'Mk II');
      expect(await portalIndicated(page), 'Mk II still leaves portals gated').toBe(false);

      await grant(page, 'scanner_mk3');
      await waitForEngine(page, e => e.renderer.scannerMk === 3, 'Mk III');
      await waitForEngine(page, e =>
        e.renderer._indicatorBuffer.some((i: any) => i.entity.isPortal === true),
        'the rift arrow to appear from across the map');

      watch.assertClean();
    });

  test('scanner marks do not stack, and an offline scanner is the baseline',
    async ({ page }) => {
      const watch = await boot(page);
      await quietField(page);

      await grant(page, 'scanner_mk1');
      await grant(page, 'scanner_mk1');
      expect(await engine(page, e => e.scannerMk),
        'two Mk I are still a Mk I — the best aboard wins').toBe(1);

      await engine(page, e => { e.resetOutfit(); e.debugGrantModule('scanner_mk3'); });
      expect(await engine(page, e => e.scannerMk)).toBe(3);

      const iso = await isolate(page, 'ship', 'hull_base', 'scanner_mk3');
      expect(iso.modActive, 'isolated from the hull').toBe(false);
      expect(await engine(page, e => e.scannerMk),
        'an OFFLINE scanner is no scanner').toBe(0);
      await waitForEngine(page, e => e.renderer.scannerMk === 0, 'the renderer to follow');

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
