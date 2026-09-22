import { test, expect } from '@playwright/test';
import { EnergySystem } from '../engine/systems/EnergySystem';
import { ENERGY_LIMITS as L, cohesionFor, fractureProfile, materialOf, thermalStrength } from '../engine/systems/energyMaterial';
import { EntityType, GameEntity } from '../types';
import { boot, startRun, quietScene } from './helpers';

function body(material: string, x = 0): GameEntity {
  return { id: `${material}-${x}`, shardVariant: `${material}-shard` as any,
    type: EntityType.STRUCTURE, active: true, health: 100, maxHealth: 100,
    position: { x, y: 0 }, velocity: { x: 0, y: 0 }, size: { x: 40, y: 40 },
    mass: 1, rotation: 0, color: '#fff' };
}
const packet = (type: any, magnitude = 10) => ({ type, magnitude, position: { x: 0, y: 0 } });
function harness(bodies: GameEntity[]) {
  const damage: { e: GameEntity; amount: number }[] = [];
  const motion: GameEntity[] = [];
  const arcs: GameEntity[] = [];
  const system = new EnergySystem({
    nearby: (e, radius, visit) => {
      for (const b of bodies) if (Math.abs(e.position.x - b.position.x) <= radius && visit(b) === false) break;
    },
    damage: (e, amount) => { damage.push({ e, amount }); },
    disperse: e => { motion.push(e); },
    feedback: (e, _, from) => { if (from) arcs.push(e); },
  });
  return { system, damage, motion, arcs };
}

test('all fifteen interactions select a safe material-specific path', () => {
  for (const m of ['rock', 'glass', 'metal', 'plastic', 'nebula']) {
    for (const kind of ['mechanical', 'thermal', 'electrical']) {
      const e = body(m); const h = harness([e]);
      h.system.deliver(e, packet(kind));
      expect(materialOf(e)).toBe(m);
      if (m === 'nebula') { expect(h.motion).toHaveLength(1); expect(h.damage).toHaveLength(0); }
      else if (kind === 'thermal') { expect(e.materialHeat).toBeGreaterThan(0); expect(h.damage).toHaveLength(0); }
      else expect(h.damage[0].amount).toBeGreaterThan(0);
    }
  }
});

test('heat accumulates, cools, and completely leaves active processing', () => {
  const e = body('rock'), h = harness([e]);
  h.system.deliver(e, packet('thermal', 5));
  h.system.deliver(e, packet('thermal', 5));
  expect(e.materialHeat).toBe(40);
  h.system.update(0.1); expect(e.materialHeat).toBe(39.5);
  for (let i = 0; i < 100; i++) h.system.update(0.1);
  expect(e.materialHeat).toBeUndefined(); expect(h.system.activeHeatedCount).toBe(0);
});

test('metal and rock retain substantially lower mechanical resistance while hot', () => {
  for (const m of ['metal', 'rock']) {
    const e = body(m), h = harness([e]);
    expect(thermalStrength(e)).toBe(1);
    h.system.deliver(e, packet('thermal', 20));
    expect(thermalStrength(e)).toBeLessThan(0.5);
  }
});

test('glass thermal stress waits, then fails after delivery ended', () => {
  const e = body('glass'), h = harness([e]);
  h.system.deliver(e, packet('thermal', 10));
  for (let i = 0; i < 3; i++) h.system.update(0.1);
  expect(h.damage).toHaveLength(0);
  h.system.update(0.1); expect(h.damage.length).toBeGreaterThan(0);
  expect(h.damage[0].amount).toBeGreaterThan(0);
});

test('plastic releases cohesion before slow structural separation', () => {
  const e = body('plastic'), h = harness([e]);
  h.system.deliver(e, packet('thermal', 3));
  expect(cohesionFor(e)).toBeGreaterThan(0); expect(cohesionFor(e)).toBeLessThan(1);
  h.system.deliver(e, packet('thermal', 3));
  expect(cohesionFor(e)).toBe(0); expect(h.damage).toHaveLength(0);
  h.system.update(0.1); expect(h.damage).toHaveLength(1);
});

test('metal conducts heat locally without multiplying it or recursing', () => {
  const bodies = Array.from({ length: 12 }, (_, i) => body('metal', i * 10));
  const h = harness(bodies); h.system.deliver(bodies[0], packet('thermal', 10));
  expect(bodies.reduce((n, e) => n + (e.materialHeat ?? 0), 0)).toBeCloseTo(40);
  expect(h.system.activeHeatedCount).toBe(L.conductionTargets + 1);
});

test('electrical cycles, fanout, distance, attenuation and target budget are bounded', () => {
  const bodies = Array.from({ length: 100 }, (_, i) => body('metal', i * 12));
  const h = harness(bodies); h.system.deliver(bodies[0], packet('electrical', 10));
  expect(h.damage.length).toBeGreaterThan(1); expect(h.damage.length).toBeLessThanOrEqual(12);
  expect(new Set(h.damage.map(d => d.e)).size).toBe(h.damage.length);
  for (const d of h.damage) {
    expect(d.e.position.x).toBeLessThanOrEqual(360);
    expect(d.amount).toBeGreaterThanOrEqual(10 * 0.6 ** 3 - 1e-8);
    expect(d.amount).toBeLessThanOrEqual(10);
  }
  expect(h.arcs).toHaveLength(h.damage.length - 1);
  expect(h.system.activeHeatedCount).toBe(0);
});

test('insulators stop conduction and nebula remains non-solid', () => {
  for (const m of ['rock', 'glass', 'plastic']) {
    const e = body(m), h = harness([e, body('metal', 10)]);
    h.system.deliver(e, packet('electrical')); expect(h.damage).toHaveLength(1); expect(h.arcs).toHaveLength(0);
  }
  const bodies = Array.from({ length: 100 }, (_, i) => body('nebula', i * 5));
  const h = harness(bodies); h.system.deliver(bodies[0], packet('electrical'));
  expect(h.damage).toHaveLength(0); expect(h.motion.length).toBeLessThanOrEqual(12);
  expect(cohesionFor(bodies[0])).toBe(0);
});

test('invalid inputs, inactive objects and sparse-state saturation stay finite', () => {
  const e = body('unknown'), h = harness([e]);
  for (const n of [NaN, Infinity, -Infinity, -10, 0]) h.system.deliver(e, packet('thermal', n));
  h.system.deliver(e, packet('future-energy'));
  expect(h.system.activeHeatedCount).toBe(0);
  h.system.deliver(e, packet('electrical')); expect(h.damage[0].amount).toBeGreaterThan(0);
  for (let i = 0; i < 600; i++) h.system.deliver(body('rock', i), packet('thermal', 1e100));
  expect(h.system.activeHeatedCount).toBe(512);
  h.system.update(NaN); h.system.update(Infinity); h.system.clear();
  expect(h.system.activeHeatedCount).toBe(0);
  h.system.deliver(e, packet('thermal')); e.active = false; h.system.update(0.1);
  expect(e.materialHeat).toBeUndefined(); expect(h.system.activeHeatedCount).toBe(0);
});

test('fracture profiles distinguish shattering, thermal failure and heavy metal', () => {
  const glass = body('glass'), rock = body('rock'), metal = body('metal');
  const g = fractureProfile(glass, 'mechanical'), t = fractureProfile(glass, 'thermal');
  expect(g.sites).toBeGreaterThan(t.sites); expect(g.impulse).toBeGreaterThan(t.impulse);
  expect(fractureProfile(rock).sites).toBeLessThan(g.sites);
  expect(fractureProfile(metal).sites).toBeLessThan(fractureProfile(rock).sites);
  for (const p of [g, t, fractureProfile(rock), fractureProfile(metal), fractureProfile(body('unknown'))]) {
    expect(p.sites).toBeGreaterThan(0); expect(p.bias).toBeGreaterThanOrEqual(0); expect(p.bias).toBeLessThanOrEqual(1);
  }
});

test('real engine: thermal deposition preserves rock until a follow-up and clear removes state', async ({ page }) => {
  const watch = await boot(page); await startRun(page); await quietScene(page);
  const r = await page.evaluate(() => {
    const g = window.__omniEngine!;
    g.pauseGame();
    const tiles = g.currentMap.entities.filter((e: any) => e.shardVariant === 'rock-shard' && e.active);
    const target = tiles[0];
    if (!target) throw new Error('Expected rock asteroid in the default world');
    const event = { type: 'thermal', magnitude: 20, position: { ...target.position } };
    const hp = target.health;
    g.energy.deliver(target, event);
    const heated = target.materialHeat;
    const preserved = target.health === hp;
    g.energy.clear();
    return { heated, preserved, cleared: target.materialHeat === undefined };
  });
  expect(r.heated).toBe(80); expect(r.preserved).toBe(true); expect(r.cleared).toBe(true);
  watch.assertClean();
});

test('real contacts preserve ricochets, spend delivery energy, and release plastic bonds', async ({ page }) => {
  const watch = await boot(page); await startRun(page, 'POCKET'); await quietScene(page);
  const r = await page.evaluate(() => {
    const g = window.__omniEngine!, M = (window as any).__omniMass;
    g.pauseGame();
    const make = (m: string, x: number) => ({
      id: `energy-${m}-${x}`, type: 'STRUCTURE', shardVariant: `${m}-tile`, active: true,
      position: { x, y: 1000 }, velocity: { x: 0, y: 0 }, size: { x: 40, y: 40 },
      rotation: 0, mass: Infinity, health: 100, maxHealth: 100, color: '#aaa', crackSeed: 123,
      polygonPoints: [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }],
    } as any);
    const rock = make('rock', 1000), metal = make('metal', 1100), neighbour = make('metal', 1140);
    g.currentMap.entities.push(rock, metal, neighbour);
    g.physics.initializeStaticGrid([rock, metal, neighbour]);
    const shots: any[] = [];
    const shooter = { ...g.player, position: { x: 950, y: 1000 }, velocity: { x: 0, y: 0 } };
    const spawn = (key: string) => {
      shots.length = 0;
      g.projectiles.spawn(shots, shooter, { x: 1100, y: 1000 }, { ...M.WEAPONS[key], count: 1, spread: 0 }, 'PLAYER');
      return shots[0];
    };
    const laser = spawn('BOUNCER'), initialSpeed = Math.hypot(laser.velocity.x, laser.velocity.y);
    laser.position = { x: 979, y: 1000 };
    g.physics.resolveCollision(laser, rock, { x: -1, y: 0 }, g.spawnDamageText, g.handleEntityDeath, undefined, g.handleProjectileHit);
    const laserResult = { heat: rock.materialHeat, reflected: laser.velocity.x < 0,
      spent: Math.hypot(laser.velocity.x, laser.velocity.y) < initialSpeed, type: laser.energyType };
    laser.active = false; g.projectiles.releaseToPool(laser);
    const recycled = spawn('BLASTER');
    const poolResult = { same: recycled === laser, type: recycled.energyType, hits: recycled.hitEntityIds };
    const bolt = spawn('LIGHTNING'); bolt.position = { x: 1080, y: 1000 };
    g.physics.resolveCollision(bolt, metal, { x: -1, y: 0 }, g.spawnDamageText, g.handleEntityDeath, undefined, g.handleProjectileHit);
    const electrical = { first: metal.fractureEdgeFill?.some((n: number) => n > 0),
      second: neighbour.fractureEdgeFill?.some((n: number) => n > 0),
      arcs: g.currentMap.entities.filter((e: any) => e.isLightningArc).length };
    const a = { ...make('plastic', 1300), mass: 10, shardVariant: 'plastic-shard' };
    const b = { ...make('plastic', 1310), mass: 10, shardVariant: 'plastic-shard' };
    g.shards.bonds.push({ a, b, timer: 0, threshold: 100, cohesionOnly: true });
    g.energy.deliver(a, { type: 'thermal', magnitude: 8, position: a.position });
    g.shards.tickBonds(g.currentMap.entities, 0.01, g.physics);
    return { laserResult, poolResult, electrical, released: !g.shards.liveBonds.some((bond: any) => bond.a === a || bond.b === a) };
  });
  expect(r.laserResult).toMatchObject({ type: 'thermal', reflected: true, spent: true });
  expect(r.laserResult.heat).toBeGreaterThan(0);
  expect(r.poolResult).toMatchObject({ same: true, type: 'mechanical' });
  expect(r.poolResult.hits).toBeUndefined();
  expect(r.electrical.first).toBe(true); expect(r.electrical.second).toBe(true); expect(r.electrical.arcs).toBeGreaterThan(0);
  expect(r.released).toBe(true); watch.assertClean();
});

test('real seams: heated solids need less work; thermal glass has coarser quieter fragments', async ({ page }) => {
  const watch = await boot(page); await startRun(page, 'POCKET'); await quietScene(page);
  const r = await page.evaluate(() => {
    const g = window.__omniEngine!; g.pauseGame();
    const make = (m: string) => ({ id: 'profile-' + Math.random(), type: 'STRUCTURE', shardVariant: `${m}-tile`,
      position: { x: 1000, y: 1000 }, velocity: { x: 0, y: 0 }, size: { x: 60, y: 60 },
      rotation: 0, mass: Infinity, health: 100, maxHealth: 100, color: '#aaa', active: true, crackSeed: 123,
      polygonPoints: [{ x: -30, y: -30 }, { x: 30, y: -30 }, { x: 30, y: 30 }, { x: -30, y: 30 }] } as any);
    const weakening = ['rock', 'metal'].map(m => {
      const cold = make(m), hot = make(m);
      g.chipStructureAt(cold, cold.position, 0); g.chipStructureAt(hot, hot.position, 0);
      g.energy.deliver(hot, { type: 'thermal', magnitude: 20, position: hot.position });
      const coldHp = cold.health, hotHp = hot.health;
      g.energy.deliver(cold, { type: 'mechanical', magnitude: 1, position: cold.position });
      g.energy.deliver(hot, { type: 'mechanical', magnitude: 1, position: hot.position });
      return { m, coldLoss: coldHp - cold.health, hotLoss: hotHp - hot.health };
    });
    const fracture = (type: string) => {
      const parent = make('glass'); parent.fractureEnergy = type;
      const children: any[] = []; g.shards.shatter(parent, children);
      return { count: children.length,
        speed: children.reduce((n, c) => n + Math.hypot(c.velocity.x, c.velocity.y), 0) / children.length,
        area: children.reduce((n, c) => n + c.size.x * c.size.x, 0),
        valid: children.every(c => c.polygonPoints.length >= 3 && Number.isFinite(c.mass)) };
    };
    const mechanical = fracture('mechanical'), thermal = fracture('thermal');
    const delayed = make('glass');
    g.energy.deliver(delayed, { type: 'thermal', magnitude: 20, position: delayed.position });
    const before = delayed.health;
    for (let i = 0; i < 3; i++) g.energy.update(0.1);
    const waited = delayed.health === before;
    for (let i = 0; i < 7; i++) g.energy.update(0.1);
    return { weakening, mechanical, thermal, waited, failedLater: delayed.health < before };
  });
  for (const row of r.weakening) expect(row.hotLoss, row.m).toBeGreaterThan(row.coldLoss * 1.5);
  expect(r.mechanical.count).toBeGreaterThan(r.thermal.count);
  expect(r.mechanical.speed).toBeGreaterThan(r.thermal.speed * 2);
  expect(r.mechanical.area).toBeCloseTo(r.thermal.area, 4);
  expect(r.mechanical.valid && r.thermal.valid).toBe(true);
  expect(r.waited && r.failedLater).toBe(true); watch.assertClean();
});

test('real nebula energy contacts disperse through puffs, never solid fracture', async ({ page }) => {
  const watch = await boot(page); await startRun(page, 'NEBULA_FIELD'); await quietScene(page);
  const r = await page.evaluate(() => {
    const g = window.__omniEngine!; g.pauseGame();
    const out: any[] = [];
    for (const type of ['mechanical', 'thermal', 'electrical']) {
      const parent = g.currentMap.entities.find((e: any) => e.active && !e.deathDispatched && e.shardVariant === 'nebula-tile');
      if (!parent) throw new Error('Expected a cloud tile');
      parent.fractureCells = undefined;
      const start = g.currentMap.entities.length;
      g.energy.deliver(parent, { type, magnitude: 10, position: parent.position, direction: { x: 20, y: 0 } });
      const children = g.currentMap.entities.slice(start).filter((e: any) => e.shardVariant === 'nebula-shard');
      out.push({ type, solidModel: !!parent.fractureEdgeFill, geometry: !!parent.fractureCells,
        children: children.length, moving: children.every((e: any) => Number.isFinite(e.velocity.x) && Math.hypot(e.velocity.x, e.velocity.y) > 0) });
    }
    return out;
  });
  for (const row of r) {
    expect(row.solidModel, row.type).toBe(false); expect(row.geometry, row.type).toBe(false);
    expect(row.children, row.type).toBeGreaterThan(0); expect(row.moving, row.type).toBe(true);
  }
  watch.assertClean();
});

test('charged conduction keeps its extra branch inside the same global caps', () => {
  const bodies = Array.from({ length: 40 }, (_, i) => body('metal', i * 2));
  const normal = harness(bodies), charged = harness(bodies);
  normal.system.deliver(bodies[0], packet('electrical', 10));
  charged.system.deliver(bodies[0], { ...packet('electrical', 10), delivery: { kind: 'projectile', chainBranches: 3 } });
  expect(normal.damage.filter(d => d.amount === 6)).toHaveLength(2);
  expect(charged.damage.filter(d => d.amount === 6)).toHaveLength(3);
  expect(charged.damage.length).toBeLessThanOrEqual(12);
  const clamped = harness(bodies);
  clamped.system.deliver(bodies[0], { ...packet('electrical'), delivery: { kind: 'beam', chainBranches: Infinity, chainHops: NaN, chainRadius: 1e100 } });
  expect(clamped.damage.length).toBeLessThanOrEqual(12);
});

test('fragment heat is tracked, conserved at transfer, and cleaned up', () => {
  const parent = body('glass'), child = body('glass', 1), h = harness([parent, child]);
  h.system.deliver(parent, packet('thermal', 10));
  h.system.inheritHeat(parent, child, 0.25);
  expect(parent.materialHeat).toBe(30); expect(child.materialHeat).toBe(10);
  expect(h.system.activeHeatedCount).toBe(2);
  h.system.clear(); expect(parent.materialHeat).toBeUndefined(); expect(child.materialHeat).toBeUndefined();
});
