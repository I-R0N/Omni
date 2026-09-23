import { test, expect } from '@playwright/test';
import { boot, startRun, quietScene } from './helpers';
import { readFileSync } from 'node:fs';

test('an insulating contact stops even a charged electrical projectile', async ({ page }) => {
  const watch = await boot(page); await startRun(page, 'POCKET'); await quietScene(page);
  const results = await page.evaluate(() => {
    const g = window.__omniEngine!, M = (window as any).__omniMass;
    g.pauseGame();
    return ['glass-tile', 'glass-shard', 'plastic-tile', 'plastic-shard'].map(m => {
      const target: any = { id: `insulator-${m}`, type: 'STRUCTURE', shardVariant: m, active: true,
        position: { x: 1000, y: 1000 }, velocity: { x: 0, y: 0 }, size: { x: 40, y: 40 }, rotation: 0,
        mass: m.endsWith('-tile') ? Infinity : 10, health: 100, maxHealth: 100, color: '#fff', crackSeed: 123,
        polygonPoints: [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }] };
      const metal = { ...target, id: `conductor-${m}`, shardVariant: 'metal-tile', position: { x: 1060, y: 1000 } };
      g.physics.initializeStaticGrid([target, metal]);
      const shots: any[] = [];
      g.projectiles.spawn(shots, { ...g.player, position: { x: 950, y: 1000 }, velocity: { x: 0, y: 0 } },
        target.position, { ...M.WEAPONS.LIGHTNING, count: 1, spread: 0, mass: 100, chainBranches: 3 }, 'PLAYER');
      const bolt = shots[0]; bolt.position = { x: 979, y: 1000 };
      const arcsBefore = g.currentMap.entities.filter((e: any) => e.isLightningArc).length;
      g.physics.resolveCollision(bolt, target, { x: -1, y: 0 }, g.spawnDamageText, g.handleEntityDeath, undefined, g.handleProjectileHit);
      return { m, active: bolt.active, secondDamaged: metal.health !== 100,
        arcs: g.currentMap.entities.filter((e: any) => e.isLightningArc).length - arcsBefore };
    });
  });
  for (const r of results) { expect(r.active, r.m).toBe(false); expect(r.secondDamaged).toBe(false); expect(r.arcs).toBe(0); }
  watch.assertClean();
});

test('one Laser contact visibly separates plastic after bond release', async ({ page }) => {
  const watch = await boot(page); await startRun(page, 'PLASTIC_FIELD'); await quietScene(page);
  const result = await page.evaluate(() => {
    const g = window.__omniEngine!, M = (window as any).__omniMass; g.pauseGame();
    const target = g.currentMap.entities.find((e: any) => e.active && e.shardVariant === 'plastic-tile');
    if (!target) throw new Error('No plastic tile');
    const shots: any[] = [];
    g.projectiles.spawn(shots, { ...g.player, position: { x: target.position.x - 50, y: target.position.y }, velocity: { x: 0, y: 0 } },
      target.position, { ...M.WEAPONS.BOUNCER, count: 1, spread: 0 }, 'PLAYER');
    const laser = shots[0]; laser.position = { x: target.position.x - target.size.x / 2, y: target.position.y };
    g.physics.resolveCollision(laser, target, { x: -1, y: 0 }, g.spawnDamageText, g.handleEntityDeath, undefined, g.handleProjectileHit);
    const initialHeat = target.materialHeat, before = g.currentMap.entities.length;
    for (let i = 0; i < 120; i++) g.energy.update(1 / 120);
    const pieces = g.currentMap.entities.slice(before).filter((e: any) => e.shardVariant === 'plastic-shard');
    return { initialHeat, pieces: pieces.length, finite: pieces.every((e: any) => Number.isFinite(e.velocity.x) && Number.isFinite(e.velocity.y)) };
  });
  expect(result.initialHeat).toBeGreaterThan(30); expect(result.pieces).toBeGreaterThan(0); expect(result.finite).toBe(true);
  watch.assertClean();
});

test('nebula ship contact and shard wake preserve the main branch recipe', async ({ page }) => {
  const watch = await boot(page); await startRun(page, 'NEBULA_FIELD'); await quietScene(page);
  const result = await page.evaluate(() => {
    const g = window.__omniEngine!; g.pauseGame();
    const template = g.currentMap.entities.find((e: any) => e.active && e.shardVariant === 'nebula-tile');
    const t = { ...template, id: 'nebula-parity', position: { x: 1000, y: 1000 }, velocity: { x: 0, y: 0 },
      size: { x: 40, y: 40 }, rotation: 0, crackSeed: 123, fractureCells: undefined,
      polygonPoints: [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }],
      color: '#a78bfa', nebulaColorComposition: [{ hex: '#a78bfa', weight: 1 }],
      health: 1, maxHealth: 1, active: true, deathDispatched: undefined, shattered: undefined };
    const p = g.player; p.position = { x: 980, y: 1000 }; p.velocity = { x: 20, y: 0 }; p.nebulaImpactCooldown = 0;
    g.currentMap.entities.push(t); g.physics.initializeStaticGrid([t]);
    const start = g.currentMap.entities.length, random = Math.random;
    let seed = 123;
    Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    try {
      g.physics.resolveCollision(p, t, { x: -1, y: 0 }, g.spawnDamageText, g.handleEntityDeath);
      const children = g.currentMap.entities.slice(start).filter((e: any) => e.shardVariant === 'nebula-shard');
      // Mobile cloud contact itself remains pass-through; its wake is separate.
      g.physics.resolveCollision(p, children[0], { x: -1, y: 0 }, g.spawnDamageText, g.handleEntityDeath);
      const before = children.map((e: any) => ({ ...e.velocity }));
      g.physics.applyNebulaPlayerPull(children, p, 0.5);
      return { count: children.length, playerVelocity: p.velocity, fade: t.mergeFadeDuration,
        children: children.map((e: any, i: number) => ({ size: e.size.x, mass: e.mass, velocity: before[i], wake: e.velocity,
          spin: e.rotationSpeed, fade: e.nebulaSpawnDuration, cooldown: e.nebulaMergeCooldown, units: e.nebulaCondenseUnits })) };
    } finally { Math.random = random; }
  });
  // Captured with the same seeded contact on untouched main c59ddc8.
  const baseline = JSON.parse(readFileSync(new URL('./fixtures/nebula-main-contact.json', import.meta.url), 'utf8'));
  expect(result).toEqual(baseline);
  expect(result.count).toBeGreaterThan(1); expect(result.playerVelocity).toEqual({ x: 20, y: 0 });
  expect(result.children.every((e: any) => e.mass > 0 && e.cooldown > 0)).toBe(true);
  watch.assertClean();
});

test('ordinary shots leave a nebula cloud available for the ship to disturb', async ({ page }) => {
  const watch = await boot(page); await startRun(page, 'NEBULA_FIELD'); await quietScene(page);
  const result = await page.evaluate(() => {
    const g = window.__omniEngine!, M = (window as any).__omniMass; g.pauseGame();
    const target = g.currentMap.entities.find((e: any) => e.active && e.shardVariant === 'nebula-tile');
    const shots: any[] = [];
    g.projectiles.spawn(shots, g.player, target.position, { ...M.WEAPONS.BLASTER, count: 1 }, 'PLAYER');
    return [target, { ...target, id: 'cloud-shard', shardVariant: 'nebula-shard', mass: 0.1 }].map(cloud => {
      const bolt = shots[0], hp = cloud.health, before = g.currentMap.entities.length;
      g.physics.resolveCollision(bolt, cloud, { x: -1, y: 0 }, g.spawnDamageText, g.handleEntityDeath, undefined, g.handleProjectileHit);
      return { hp: cloud.health === hp, cloudAlive: cloud.active && !cloud.shattered, shotAlive: bolt.active,
        spawned: g.currentMap.entities.length - before };
    });
  });
  for (const r of result) expect(r).toEqual({ hp: true, cloudAlive: true, shotAlive: true, spawned: 0 });
  watch.assertClean();
});
