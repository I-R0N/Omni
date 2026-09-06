/** BUBBLE behaviour — the A1 aggro timeout and the A2 immovability fix.
 *
 *  Both are Phase A of docs/CONFIG_CHANGES_PHASED_PLAN.md, and both are about
 *  the same thing from opposite ends: a bubble that will not let go.
 *
 *  A1.  Aggro used to end exactly three ways — the target died, it fled past
 *  AGGRO_LOSE_RANGE, or a latch detached.  A hunter that never managed a bite
 *  therefore stayed hostile for the rest of its life, and since every fresh
 *  hit re-stamped the target, the ambient fauna read as permanently angry.
 *  `AGGRO_TIMEOUT_SEC` is the fourth ending: left alone, it loses interest.
 *
 *  A2.  A bubble read as a mass-infinity wall after its attack pass.  It was
 *  never mass (a bubble's is a constant 9 for its whole life): the AI applied
 *  its regime SPEED CAP to the bubble's total velocity every sim step, which
 *  erased the collision recoil the impulse solver had just computed.  The
 *  bubble never left the contact, the player re-collided on the next step, and
 *  each contact took ~35% of its speed — a dead stop in ~10 frames.  The SICK
 *  cap (0.66, against a 2.2 drift) is the worst case, which is why the report
 *  named the green post-attack state.
 *
 *  Everything here drives the REAL resolver and the REAL AI (harness rules 3
 *  and 6): no test recomputes an impulse or a timer it is asserting on.
 *  Constants are hard-coded per harness rule 7 — a retune of
 *  AGGRO_TIMEOUT_SEC is meant to land in this file.
 */

import { test, expect } from '@playwright/test';
import { boot, engine, startRun, waitForStats, quietScene } from './helpers';

/** BUBBLE_CONSTANTS.AGGRO_TIMEOUT_SEC — duplicated on purpose (rule 7). */
const AGGRO_TIMEOUT_SEC = 6;

/** A scene with nothing in it but the pair under test.
 *
 *  `quietScene` stops the fauna and the ladder; terrain is the other half —
 *  a ship crossing a field map at 20 units/step meets a glass tile within a
 *  few frames, and a crash is exactly the kind of contamination that would be
 *  read as the bubble stopping the player.  Tiles leave through
 *  `removeStaticEntity` because the static grid is built once at map load and
 *  does not re-read `active`. */
async function emptyArena(page: any) {
  await startRun(page, 'GLASS_FIELD');
  await waitForStats(page, s => s.currentMapType === 'GLASS_FIELD', 'the glass field');
  await quietScene(page);
  await engine(page, e => {
    for (const t of e.currentMap.entities) {
      if (t.type !== 'STRUCTURE') continue;
      if (t.mass === Infinity) e.physics.removeStaticEntity(t);
      t.active = false;
    }
  });
}

// ── A1 ────────────────────────────────────────────────────────────────────

/** Provoke a bubble through the REAL projectile-damage path, then hold it in
 *  a hunt it can never finish and report when it gives up.
 *
 *  The player is re-parked `gap` units from the bubble every frame.  That is
 *  scene isolation, not a thumb on the scale: the timeout exists precisely for
 *  the bubble that keeps chasing and never lands a bite, and a stationary
 *  player inside AGGRO_LOSE_RANGE is caught in about two seconds — the leash
 *  and the latch would both fire long before the window could.
 *
 *  `refreshAt` fires a SECOND real hit that many sim-seconds in, which is the
 *  refresh half of the mechanism. */
function hunt(page: any, opts: { gap: number; watchSec: number; refreshAt?: number }) {
  return engine(page, async (e: any, o: any) => {
    const shoot = (b: any) => {
      const proj = {
        id: 'a1_shot', type: 'PROJECTILE',
        position: { x: b.position.x + 12, y: b.position.y },
        velocity: { x: -16, y: 0 }, rotation: Math.PI, size: { x: 6, y: 6 },
        mass: 1, active: true, color: '#fff', damage: 1,
        ownerType: 'PLAYER', ownerId: 'player', hitEntityIds: [],
      };
      e.physics.resolveCollision(proj, b, { x: -4, y: 0 });
    };
    const p = e.player;
    p.position.x = 3000; p.position.y = 3000; p.velocity.x = 0; p.velocity.y = 0;
    const b = e.waves.spawnAt('BUBBLE', { x: p.position.x + o.gap, y: p.position.y }, e.waveContext(), false);
    b.velocity.x = 0; b.velocity.y = 0;
    shoot(b);
    const armed = { provoked: b.provoked === true, target: b.aggroTargetId, timer: b.bubbleAggroTimer };

    const t0 = e.runTimeSec;
    let refreshed = false;
    let out: any = null;
    while (e.runTimeSec - t0 < o.watchSec) {
      const elapsed = e.runTimeSec - t0;
      if (o.refreshAt !== undefined && !refreshed && elapsed >= o.refreshAt) { refreshed = true; shoot(b); }
      if (b.provoked !== true) {
        out = { calmAt: elapsed, sick: b.bubbleSickTimer ?? 0, target: b.aggroTargetId, timer: b.bubbleAggroTimer };
        break;
      }
      // Hold the chase open: near enough to keep the leash happy, far enough
      // that it can never reach a latch.
      p.position.x = b.position.x + o.gap; p.position.y = b.position.y;
      p.velocity.x = 0; p.velocity.y = 0;
      await new Promise(r => requestAnimationFrame(() => r(null)));
    }
    b.active = false;
    return { armed, ...(out ?? { calmAt: null, timer: b.bubbleAggroTimer }) };
  }, opts);
}

test.describe('A1 — a bubble left alone loses interest', () => {
  test('a hit arms the window, and the window runs out', async ({ page }) => {
    const watch = await boot(page);
    await emptyArena(page);

    const r: any = await hunt(page, { gap: 500, watchSec: AGGRO_TIMEOUT_SEC + 4 });

    // Armed by the real damage path, aimed at the real attacker.
    expect(r.armed.provoked, 'a hit provokes').toBe(true);
    expect(r.armed.target, 'and blames the shooter').toBe('player');
    expect(r.armed.timer, 'and arms the full window').toBeCloseTo(AGGRO_TIMEOUT_SEC, 5);

    // It calmed, on schedule — near the timeout, not the leash (the player is
    // held at 500, well inside AGGRO_LOSE_RANGE) and not a latch (never in
    // contact).
    expect(r.calmAt, 'the bubble gave up').not.toBeNull();
    expect(r.calmAt).toBeGreaterThan(AGGRO_TIMEOUT_SEC * 0.75);
    expect(r.calmAt).toBeLessThan(AGGRO_TIMEOUT_SEC * 1.4);

    // Calm means CALM: no target, no armed window left behind to fire later.
    expect(r.target, 'the target is dropped').toBeUndefined();
    expect(r.timer, 'and the window is disarmed with it').toBeUndefined();
    // Losing interest is not an injury — no sick state (the latch path is the
    // one that makes a bubble queasy, and it never got one).
    expect(r.sick, 'giving up does not make it sick').toBe(0);

    watch.assertClean();
  });

  test('a mid-window hit refreshes it', async ({ page }) => {
    const watch = await boot(page);
    await emptyArena(page);

    // A second hit lands two thirds of the way through the first window.  If
    // the window merely armed once, the bubble would still calm at ~6s.
    const refreshAt = AGGRO_TIMEOUT_SEC * 0.67;
    const r: any = await hunt(page, { gap: 500, watchSec: AGGRO_TIMEOUT_SEC * 2 + 4, refreshAt });

    expect(r.calmAt, 'the bubble still eventually gives up').not.toBeNull();
    expect(r.calmAt, 'but not on the original deadline — the hit bought a fresh window')
      .toBeGreaterThan(AGGRO_TIMEOUT_SEC * 1.15);
    expect(r.calmAt, 'and the fresh window is one window, not an extension without end')
      .toBeLessThan(refreshAt + AGGRO_TIMEOUT_SEC * 1.4);

    watch.assertClean();
  });

  test('the older calm paths still work: a latch that detaches, and a target that dies', async ({ page }) => {
    const watch = await boot(page);
    await emptyArena(page);

    // (a) LATCH → DETACH.  Provoked in contact, so it grabs on; the bite ends
    // on its own timer, which drops it off SICK and calm.  Deliberately
    // shorter than AGGRO_TIMEOUT_SEC, so this is the latch ending the aggro
    // and not the new window.
    const latched: any = await engine(page, async (e: any) => {
      const p = e.player;
      p.position.x = 3000; p.position.y = 3000; p.velocity.x = 0; p.velocity.y = 0;
      const b = e.waves.spawnAt('BUBBLE', { x: p.position.x + 20, y: p.position.y }, e.waveContext(), false);
      b.velocity.x = 0; b.velocity.y = 0;
      b.provoked = true; b.aggroTargetId = 'player'; b.bubbleAggroTimer = 6;
      const t0 = e.runTimeSec;
      let everLatched = false;
      let out: any = { latched: false, calmAt: null };
      while (e.runTimeSec - t0 < 8) {
        if (b.attachedToId !== undefined) everLatched = true;
        if (everLatched && b.attachedToId === undefined) {
          out = {
            latched: true, calmAt: e.runTimeSec - t0, provoked: b.provoked === true,
            sick: b.bubbleSickTimer ?? 0, timer: b.bubbleAggroTimer, target: b.aggroTargetId,
          };
          break;
        }
        p.velocity.x = 0; p.velocity.y = 0; // don't get dragged off by the bite
        await new Promise(r => requestAnimationFrame(() => r(null)));
      }
      b.active = false;
      return out;
    });
    expect(latched.latched, 'a provoked bubble in contact latches on').toBe(true);
    expect(latched.provoked, 'and is calm once the bite ends').toBe(false);
    expect(latched.sick, 'and is SICK — the bite is where the green comes from').toBeGreaterThan(0);
    expect(latched.timer, 'and its window is disarmed with the aggro').toBeUndefined();
    expect(latched.calmAt, 'the latch ends the aggro well before the timeout could')
      .toBeLessThan(AGGRO_TIMEOUT_SEC);

    // (b) TARGET GONE.  Aggroed onto an ENEMY (via that enemy's own shot —
    // the friendly-fire filter is bypassed for a third party), which then
    // dies: the bubble has nothing to hunt and calms.
    const orphaned: any = await engine(page, async (e: any) => {
      const p = e.player;
      p.position.x = 3000; p.position.y = 3000; p.velocity.x = 0; p.velocity.y = 0;
      const ctx = e.waveContext();
      const foe = e.waves.spawnAt('SHOOTER_1', { x: p.position.x - 900, y: p.position.y }, ctx, false);
      const b = e.waves.spawnAt('BUBBLE', { x: p.position.x + 500, y: p.position.y }, ctx, false);
      b.velocity.x = 0; b.velocity.y = 0;
      const proj = {
        id: 'a1_foe_shot', type: 'PROJECTILE',
        position: { x: b.position.x + 12, y: b.position.y },
        velocity: { x: -16, y: 0 }, rotation: Math.PI, size: { x: 6, y: 6 },
        mass: 1, active: true, color: '#f00', damage: 1,
        ownerType: 'ENEMY', ownerId: foe.id, hitEntityIds: [],
      };
      e.physics.resolveCollision(proj, b, { x: -4, y: 0 });
      const blamed = b.aggroTargetId;
      foe.active = false; // the attacker leaves the world
      const t0 = e.runTimeSec;
      let out: any = { blamed, calmAt: null };
      while (e.runTimeSec - t0 < 3) {
        if (b.provoked !== true) { out = { blamed, calmAt: e.runTimeSec - t0, timer: b.bubbleAggroTimer }; break; }
        await new Promise(r => requestAnimationFrame(() => r(null)));
      }
      b.active = false;
      return out;
    });
    expect(orphaned.blamed, 'an enemy shot makes the bubble blame that enemy').not.toBe('player');
    expect(orphaned.blamed, 'and blames it by id').toBeTruthy();
    expect(orphaned.calmAt, 'a dead attacker calms the bubble at once, not in six seconds')
      .not.toBeNull();
    expect(orphaned.calmAt).toBeLessThan(AGGRO_TIMEOUT_SEC * 0.5);
    expect(orphaned.timer, 'and disarms the window').toBeUndefined();

    watch.assertClean();
  });
});

// ── A2 ────────────────────────────────────────────────────────────────────

/** Ram a bubble at `entry` speed and report what the collision did to BOTH
 *  bodies over the following frames.
 *
 *  `postLatch` runs the real engagement first — provoke, let it latch, let the
 *  bite end — so the bubble under the ram is genuinely the green post-attack
 *  one from the report, produced by `detachLatch` rather than posed.
 *
 *  The player is then set back and aimed at it.  What is measured is the SPEED
 *  IT KEEPS (the "dead stop" complaint) and the speed the bubble is still
 *  carrying a few frames later — the latter is the whole bug, because the
 *  impulse was always correct and it was the next AI step that deleted it. */
function ram(page: any, opts: { entry: number; size?: number; postLatch: boolean }) {
  return engine(page, async (e: any, o: any) => {
    const p = e.player;
    p.position.x = 3000; p.position.y = 3000; p.velocity.x = 0; p.velocity.y = 0;
    const b = e.waves.spawnAt('BUBBLE', { x: p.position.x + 30, y: p.position.y }, e.waveContext(), false);
    b.velocity.x = 0; b.velocity.y = 0;
    if (o.size) { b.size.x = o.size; b.size.y = o.size; }

    if (o.postLatch) {
      b.provoked = true; b.aggroTargetId = 'player'; b.bubbleAggroTimer = 6;
      const t0 = e.runTimeSec;
      let everLatched = false;
      while (e.runTimeSec - t0 < 8) {
        if (b.attachedToId !== undefined) everLatched = true;
        if (everLatched && b.attachedToId === undefined) break;
        p.velocity.x = 0; p.velocity.y = 0;
        await new Promise(r => requestAnimationFrame(() => r(null)));
      }
      if (!everLatched || (b.bubbleSickTimer ?? 0) <= 0) {
        b.active = false;
        return { setUp: false };
      }
    }

    // Line the ram up: the bubble keeps whatever state the pass left it in.
    const reach = Math.max(b.size.x, b.size.y) / 2 + 20;
    p.position.x = b.position.x - (reach + 40); p.position.y = b.position.y;
    p.velocity.x = o.entry; p.velocity.y = 0;
    const sick0 = b.bubbleSickTimer ?? 0;
    const mass = b.mass;

    let touched = false, minPlayer = Infinity, bubbleAfter = 0, frames = 0;
    const t1 = e.runTimeSec;
    while (e.runTimeSec - t1 < 1.2) {
      const bs = Math.sqrt(b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y);
      if (!touched && bs > 0.5) touched = true; // the bubble was hit: it moved
      if (touched) {
        frames++;
        const ps = Math.sqrt(p.velocity.x * p.velocity.x + p.velocity.y * p.velocity.y);
        if (ps < minPlayer) minPlayer = ps;
        // Read the bubble a few frames AFTER contact — the impulse was never
        // the problem; surviving the next AI step is.
        if (frames >= 3 && frames <= 6) bubbleAfter = Math.max(bubbleAfter, bs);
        if (frames > 12) break;
      }
      await new Promise(r => requestAnimationFrame(() => r(null)));
    }
    b.active = false;
    return { setUp: true, touched, minPlayer, bubbleAfter, sick0, mass, entry: o.entry };
  }, opts);
}

test.describe('A2 — a bubble is a body, not a wall', () => {
  test('the impulse itself is untouched, and does not depend on the bubble being sick', async ({ page }) => {
    const watch = await boot(page);
    await emptyArena(page);

    // Drive the real resolver once, no sim steps: this is the arithmetic the
    // fix must NOT have changed.  Player mass 100 vs bubble mass 9, ELASTICITY
    // 0.5, MASS_BIAS_EXPONENT 0.5 (hard-coded per rule 7).
    const hit = (sick: boolean) => engine(page, (e: any, s: any) => {
      const p = e.player;
      p.position.x = 3000; p.position.y = 3000; p.velocity.x = 20; p.velocity.y = 0;
      const b = e.waves.spawnAt('BUBBLE', { x: p.position.x + 18, y: p.position.y }, e.waveContext(), false);
      b.velocity.x = 0; b.velocity.y = 0;
      if (s) b.bubbleSickTimer = 2.8;
      e.physics.resolveCollision(p, b, { x: 2, y: 0 });
      const out = { player: p.velocity.x, bubble: b.velocity.x, mass: b.mass, playerMass: p.mass };
      b.active = false;
      return out;
    }, sick);

    const calm: any = await hit(false);
    const sick: any = await hit(true);

    expect(calm.playerMass, 'PHYSICS_CONSTANTS.PLAYER_MASS').toBe(100);
    expect(calm.mass, 'the bubble is an ordinary finite-mass body').toBe(9);
    // A fresh bubble's collision response is EXACTLY what it always was — the
    // fix must not have made calm bubbles flimsy.
    expect(calm.player, 'the ship keeps most of its way through a 9-mass blob').toBeCloseTo(13.08, 1);
    expect(calm.bubble, 'and the blob is thrown clear').toBeCloseTo(23.08, 1);
    // Being sick changes the AI, never the physics.
    expect(sick.player).toBeCloseTo(calm.player, 5);
    expect(sick.bubble).toBeCloseTo(calm.bubble, 5);

    watch.assertClean();
  });

  test('a well-fed, post-latch (sick) bubble recoils and does not stop the ship', async ({ page }) => {
    const watch = await boot(page);
    await emptyArena(page);

    const entry = 20;
    const r: any = await ram(page, { entry, size: 50, postLatch: true });

    expect(r.setUp, 'the bubble really did latch and come off sick').toBe(true);
    expect(r.sick0, 'and is in the green post-attack state the report names').toBeGreaterThan(0);
    expect(r.touched, 'the ram connected').toBe(true);

    // THE REPORT.  Before the fix this measured 0.65 of 20 — 3%, a dead stop.
    expect(r.minPlayer / entry, 'the ship keeps a healthy fraction of its speed')
      .toBeGreaterThan(0.35);
    // THE MECHANISM.  Before the fix the bubble's 23-unit recoil was snapped
    // back to the 0.66 sick drift cap on the very next AI step, which is what
    // kept it in the ship's path to be hit again.
    expect(r.bubbleAfter, 'and the bubble is still moving several frames later')
      .toBeGreaterThan(5);

    watch.assertClean();
  });

  test('a freshly-spawned bubble is shoved the same way', async ({ page }) => {
    const watch = await boot(page);
    await emptyArena(page);

    const entry = 20;
    const r: any = await ram(page, { entry, postLatch: false });

    expect(r.sick0, 'a fresh bubble is not sick').toBe(0);
    expect(r.touched, 'the ram connected').toBe(true);
    expect(r.minPlayer / entry, 'a calm bubble does not stop the ship either')
      .toBeGreaterThan(0.35);
    expect(r.bubbleAfter, 'and it is shoved out of the way, not through the floor')
      .toBeGreaterThan(5);

    watch.assertClean();
  });
});
