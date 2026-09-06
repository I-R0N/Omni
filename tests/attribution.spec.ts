/** Stat attribution — the REFOLD.
 *
 *  Re-derived from `smoke-a2`, which the Pair A log names as its
 *  load-bearing assertion: parse the RENDERED contributor strings back into
 *  numbers, fold them the way `applyModuleEffects` folds, and require the
 *  result to equal what the sim is actually using.
 *
 *  That direction matters.  Comparing the panel's headline to the sim's
 *  value would only prove one number was copied correctly.  Refolding the
 *  CONTRIBUTORS proves the explanation is true — that the rows a player
 *  reads to decide what to buy add up to the ship they will actually fly.
 *  A panel can only lie in two ways: a wrong total, or a right total with a
 *  wrong story.  The refold catches both.
 *
 *  Everything parsed here is the exact string the UI renders, taken from
 *  `EngineStats.outfitting.statLines` — the UI renders, it never recomputes
 *  (CLAUDE.md §5), so this suite sees what the player sees.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, startRun, dockAtStation } from './helpers';
import type { EngineStats } from '../types';

type StatLines = NonNullable<EngineStats['outfitting']>['statLines'];
type Line = StatLines[number];
type Contributor = Line['contributors'][number];

/** '+25 HP' → 25 · '−8%' / '+12%' → ±0.12 · '×1.24' → 1.24 · '+1.5' → 1.5.
 *  The UI uses a real minus sign (U+2212), not a hyphen. */
function parseAmount(display: string): number {
  const d = display.replace(/−/g, '-');
  const pct = d.match(/^([+-]?)(\d+(?:\.\d+)?)%$/);
  if (pct) return (pct[1] === '-' ? -1 : 1) * (Number(pct[2]) / 100);
  const mult = d.match(/^×(\d+(?:\.\d+)?)$/);
  if (mult) return Number(mult[1]);
  const plain = d.match(/^([+-]?)(\d+(?:\.\d+)?)/);
  if (plain) return (plain[1] === '-' ? -1 : 1) * Number(plain[2]);
  return NaN;
}

/** The headline value, e.g. '×1.24' → 1.24, '150' → 150, '2.5/s' → 2.5. */
function parseHeadline(display: string): number {
  return parseAmount(display.replace(/\/s$/, ''));
}

const line = (lines: StatLines, id: string): Line => {
  const l = lines.find(x => x.id === id);
  if (!l) throw new Error(`no stat line "${id}" — lines were: ${lines.map(x => x.id).join(', ')}`);
  return l;
};

/** Sum the contributors that are ACTUALLY IN the total.
 *
 *  `active: false` is the whole subtlety: it means "this amount is NOT in
 *  the total", and it covers two different situations — an adjacency-OFFLINE
 *  module, and shield plating with no core to plate.  A refold that summed
 *  everything would disagree with the sim precisely when the panel is at its
 *  most useful. */
const foldActive = (l: Line, skip: (c: Contributor) => boolean = () => false) =>
  l.contributors
    .filter(c => c.active && !skip(c))
    .reduce((sum, c) => sum + parseAmount(c.display), 0);

/** True for a DERIVED row — one with no hex behind it (the ship-weight drag
 *  factor, the resulting-cooldown row).  These are not module contributions
 *  and must not be summed with them. */
const isDerived = (c: Contributor) => c.area === undefined || c.idx === undefined;

/** Install a named outfit and return the rendered stat lines beside the
 *  simulation's own values, so a test can compare the two. */
async function outfitAndRead(page: any, moduleIds: { area: 'ship' | 'weapon'; idx: number; id: string }[]) {
  return engine(
    page,
    (e, plan: { area: 'ship' | 'weapon'; idx: number; id: string }[]) => {
      for (const p of plan) {
        // debugGrantModule auto-installs into a free hex; place explicitly
        // instead so each outfit's ADJACENCY is exactly what the test means.
        const free = e.inventory.indexOf(null);
        e.inventory[free] = p.id;
        e.moveModuleInternal({ area: 'inventory', idx: free }, { area: p.area, idx: p.idx });
      }
      const snap = e.outfittingSnapshot();
      return {
        statLines: snap.statLines,
        ship: snap.ship.map((h: any) => (h ? { id: h.id, active: h.active } : null)),
        weapon: snap.weapon.map((h: any) => (h ? { id: h.id, active: h.active } : null)),
        // What the SIM is using, read straight off the player / engine.
        sim: {
          maxHealth: e.player.maxHealth,
          maxShield: e.player.maxShield,
          shieldRechargeRate: e.player.shieldRechargeRate,
          damageMult: e.player.damageMult ?? 1,
          cooldownMult: e.player.cooldownMult ?? 1,
          speedMult: e.moduleSpeedMult,
          thrustMult: e.moduleThrustMult,
          shipWeight: e.shipWeight,
          overcharge: !!e.player.overchargeUnlocked,
        },
      };
    },
    moduleIds,
  );
}

/** The four outfits.  Chosen to make every branch of the panel fire at least
 *  once: the lean start, a fully-connected ship, one with an OFFLINE module,
 *  and plating without a core. */
const OUTFITS = {
  lean: [] as { area: 'ship' | 'weapon'; idx: number; id: string }[],
  connected: [
    { area: 'ship' as const, idx: 1, id: 'hull_mk2' },
    { area: 'ship' as const, idx: 2, id: 'engine_mk1' },
    { area: 'ship' as const, idx: 3, id: 'thrusters_mk1' },  // touches nothing but hull… see below
    { area: 'ship' as const, idx: 4, id: 'shield' },
    { area: 'ship' as const, idx: 5, id: 'plating_mk1' },
    { area: 'weapon' as const, idx: 2, id: 'gunnery_mk3' },
    { area: 'weapon' as const, idx: 3, id: 'autoloader_mk2' },
    { area: 'weapon' as const, idx: 4, id: 'overcharge' },
  ],
  offline: [
    // Hull moved off the centre in the test body; these then hang unconnected.
    { area: 'ship' as const, idx: 2, id: 'engine_mk2' },
    { area: 'ship' as const, idx: 3, id: 'capacitor_mk1' },
  ],
  plateNoCore: [
    { area: 'ship' as const, idx: 1, id: 'plating_mk3' },
    { area: 'ship' as const, idx: 2, id: 'capacitor_mk2' },
  ],
};

test.describe('stat attribution', () => {
  test('all eleven stat lines are present, in both the pause menu and the station', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);

    // Docked: the station's Ship Status block.
    await dockAtStation(page);
    const docked = await engine(page, e => e.outfittingSnapshot().statLines.map((l: any) => l.id));
    await engine(page, e => e.undock());

    // Paused: the pause menu's CARGO panel renders the SAME widget.
    await engine(page, e => e.pauseGame());
    const paused = await engine(page, e => e.outfittingSnapshot().statLines.map((l: any) => l.id));

    // The FULL row set, in order.  Pinned exactly rather than loosely,
    // because a line that quietly stops being built is invisible in play —
    // the panel just shows one fewer row.  `pierce` and `scanner` are the
    // Phase-A module families (A3 / A4); both are always present, reading
    // '+0' / 'None' on a ship carrying neither.
    const expected = [
      'hull', 'shield', 'shieldRegen', 'damage', 'cooldown',
      'speed', 'accel', 'weight', 'pierce', 'scanner', 'overcharge',
    ];
    expect(docked).toEqual(expected);
    // Same widget, same rows — a divergence here means the two call sites
    // have drifted apart, which is exactly what sharing renderShipStatus()
    // is supposed to prevent.
    expect(paused).toEqual(docked);

    watch.assertClean();
  });

  for (const [name, plan] of Object.entries(OUTFITS)) {
    test(`the contributors refold to the simulation's own values — ${name} outfit`, async ({ page }) => {
      const watch = await boot(page);
      await startRun(page);
      await dockAtStation(page);

      if (name === 'offline') {
        // Strand the ship tree: move the hull off the centre to an opposite
        // ring hex so hexes 2 and 3 touch no hull.
        await engine(page, e => e.moveModuleInternal({ area: 'ship', idx: 0 }, { area: 'ship', idx: 5 }));
      }

      const r = await outfitAndRead(page, plan as any);
      const L = r.statLines as StatLines;

      // ── Max hull: base 100 + Σ active maxHp ────────────────────────────
      const hull = line(L, 'hull');
      expect(parseHeadline(hull.baseDisplay)).toBe(100);
      expect(parseHeadline(hull.display)).toBe(r.sim.maxHealth);
      expect(100 + foldActive(hull)).toBe(r.sim.maxHealth);

      // ── Max shield: 0 without a core, else SHIELD base + Σ active plating.
      //    The base is folded in as the shield-core contributor's own row,
      //    which is why the refold is `Σ active` with no constant added.
      const shield = line(L, 'shield');
      expect(parseHeadline(shield.baseDisplay)).toBe(0);
      expect(parseHeadline(shield.display)).toBe(r.sim.maxShield);
      expect(foldActive(shield)).toBe(r.sim.maxShield);

      // ── Shield regen: base rate × (1 + Σ active regen fractions) ───────
      const regen = line(L, 'shieldRegen');
      const baseRegen = parseHeadline(regen.baseDisplay);
      expect(baseRegen * (1 + foldActive(regen))).toBeCloseTo(r.sim.shieldRechargeRate, 4);
      expect(parseHeadline(regen.display)).toBeCloseTo(r.sim.shieldRechargeRate, 1);

      // ── Damage: ×(1 + Σ active damage fractions) ───────────────────────
      const dmg = line(L, 'damage');
      expect(1 + foldActive(dmg)).toBeCloseTo(r.sim.damageMult, 4);
      expect(parseHeadline(dmg.display)).toBeCloseTo(r.sim.damageMult, 2);

      // ── Top speed: ×(1 + Σ active speed fractions) ─────────────────────
      const speed = line(L, 'speed');
      expect(1 + foldActive(speed)).toBeCloseTo(r.sim.speedMult, 4);
      expect(parseHeadline(speed.display)).toBeCloseTo(r.sim.speedMult, 2);

      // ── Ship weight: HULL_BASE + Σ active module weights ───────────────
      const weight = line(L, 'weight');
      const baseWeight = parseHeadline(weight.baseDisplay);
      expect(baseWeight + foldActive(weight)).toBeCloseTo(r.sim.shipWeight, 4);
      expect(parseHeadline(weight.display)).toBeCloseTo(r.sim.shipWeight, 1);

      // ── Fire RATE is the INVERSE of the cooldown multiplier ────────────
      //    The per-module rows stay in the units modules are specified in
      //    ("−8% cooldown"); one DERIVED row carries the resulting cooldown
      //    the headline inverts.  Rate does not sum additively, and this is
      //    the assertion that says so.
      const cool = line(L, 'cooldown');
      expect(parseHeadline(cool.display)).toBeCloseTo(1 / r.sim.cooldownMult, 2);
      const derivedCool = cool.contributors.filter(isDerived);
      const moduleCool = cool.contributors.filter(c => !isDerived(c));
      if (moduleCool.length > 0) {
        expect(derivedCool).toHaveLength(1);
        // The derived row's ×N IS the sim's cooldown multiplier …
        expect(parseAmount(derivedCool[0].display)).toBeCloseTo(r.sim.cooldownMult, 2);
        // … and it equals 1 + Σ the module rows (unless the floor clamped
        // it).  The rows are rendered ALREADY SIGNED as cuts — an Autoloader
        // Mk II shows '−16%', not '+16% off' — so the fold adds them.
        const raw = 1 + moduleCool.filter(c => c.active)
          .reduce((s, c) => s + parseAmount(c.display), 0);
        expect(r.sim.cooldownMult).toBeCloseTo(Math.max(0.4, raw), 4);
      }

      // ── Acceleration: ×(1 + Σ accel) × the ship-weight drag factor ─────
      //    The drag factor is DERIVED — multiplicative over the ship's TOTAL
      //    weight, so it belongs to no hex.  Folding it additively with the
      //    thruster rows is exactly the mistake this row exists to prevent.
      const accel = line(L, 'accel');
      const derivedAccel = accel.contributors.filter(isDerived);
      expect(derivedAccel).toHaveLength(1);
      const dragFactor = parseAmount(derivedAccel[0].display);
      const thrusterSum = accel.contributors
        .filter(c => c.active && !isDerived(c))
        .reduce((s, c) => s + parseAmount(c.display), 0);
      expect((1 + thrusterSum) * dragFactor).toBeCloseTo(r.sim.thrustMult, 2);
      expect(parseHeadline(accel.display)).toBeCloseTo(r.sim.thrustMult, 2);
      // The derived row NAMES the weight it came from, and that weight is the
      // ship weight the Ship weight line reports — one number, two places.
      if (r.sim.shipWeight > 0) {
        expect(derivedAccel[0].label).toBe(`Ship weight ${r.sim.shipWeight.toFixed(1)}`);
      }

      // ── Charged shots: a boolean, so it reads as state, not a sum ──────
      const charge = line(L, 'overcharge');
      expect(charge.display).toBe(r.sim.overcharge ? 'Enabled' : 'Locked');

      watch.assertClean();
    });
  }

  test('an OFFLINE module reports zero and names the contact it is missing', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await dockAtStation(page);

    // Hull to an outer hex; hex 2 and hex 3 then touch neither it nor
    // each other's requirement chain.
    await engine(page, e => e.moveModuleInternal({ area: 'ship', idx: 0 }, { area: 'ship', idx: 5 }));
    const r = await outfitAndRead(page, [
      { area: 'ship', idx: 2, id: 'engine_mk2' },
      { area: 'ship', idx: 3, id: 'capacitor_mk1' },
    ]);
    const L = r.statLines as StatLines;

    const eng = line(L, 'speed').contributors.find(c => c.moduleId === 'engine_mk2')!;
    expect(eng).toBeDefined();
    // It is LISTED — the panel shows what you own, not only what works …
    expect(eng.active).toBe(false);
    // … and names the family it must touch, so the fix is legible.
    expect(eng.requires).toBe('hull');
    // … and its amount is NOT in the total.
    expect(r.sim.speedMult).toBeCloseTo(1, 5);

    const cap = line(L, 'shieldRegen').contributors.find(c => c.moduleId === 'capacitor_mk1')!;
    expect(cap.active).toBe(false);
    expect(cap.requires).toBe('shield');

    // An OFFLINE module also contributes no WEIGHT — inactive means inactive
    // everywhere, which is why the weight refold uses the same filter.
    const weight = line(L, 'weight');
    const offlineWeight = weight.contributors.find(c => c.moduleId === 'engine_mk2')!;
    expect(offlineWeight.active).toBe(false);
    expect(parseHeadline(weight.baseDisplay) + foldActive(weight)).toBeCloseTo(r.sim.shipWeight, 4);

    watch.assertClean();
  });

  test('installing a module moves the panel and the sim together', async ({ page }) => {
    const watch = await boot(page);
    await startRun(page);
    await dockAtStation(page);

    const read = () =>
      engine(page, e => {
        const L = e.outfittingSnapshot().statLines;
        return {
          damageRow: L.find((l: any) => l.id === 'damage').display,
          damageSim: e.player.damageMult ?? 1,
          weightRow: L.find((l: any) => l.id === 'weight').display,
          weightSim: e.shipWeight,
          accelSim: e.moduleThrustMult,
        };
      });

    const before = await read();
    expect(parseHeadline(before.damageRow)).toBeCloseTo(before.damageSim, 2);

    await engine(page, e => {
      const free = e.inventory.indexOf(null);
      e.inventory[free] = 'gunnery_mk3';
      e.moveModuleInternal({ area: 'inventory', idx: free }, { area: 'weapon', idx: 3 });
    });

    const after = await read();
    // Gunnery Mk III is +36% weapon damage.
    expect(after.damageSim).toBeCloseTo(1.36, 4);
    expect(parseHeadline(after.damageRow)).toBeCloseTo(after.damageSim, 2);
    // And it made the ship heavier, which dragged acceleration — the
    // indirection that is the entire reason weight is a ship attribute.
    expect(after.weightSim).toBeGreaterThan(before.weightSim);
    expect(parseHeadline(after.weightRow)).toBeCloseTo(after.weightSim, 1);
    expect(after.accelSim).toBeLessThan(before.accelSim);

    watch.assertClean();
  });
});
