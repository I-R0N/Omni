/** RIVAL ships (Stage 7) — player-like privateer roamers.
 *
 *  Extracted verbatim from `GameEngine` in gauntlet 5f (see
 *  `docs/GAUNTLET_5F_LOG.md`); same technique as `dragons.ts` — plain free
 *  functions taking `g: GameEngine`, with `GameEngine` imported as a TYPE so
 *  it is erased at compile time and there is no runtime cycle.
 *
 *  A rival warps in via portal on a SCORE cadence, hunts the WAVE enemies
 *  (stealing the player's kill points and vacuuming their loot), and — per
 *  disposition — fights, ignores, or retaliates against the player.  It flies
 *  with the player's own movement mechanics at BASE (un-upgraded) values, so
 *  an outfitted player can still out-fly it.  Engine-managed lifecycle;
 *  AISystem skips them via the `isRival` flag.
 */
import type { GameEngine } from '../GameEngine';
import { GameEntity, EntityType, WeaponType, WeaponConfig } from '../../types';
import {
    RIVAL_CONSTANTS, RivalDisposition, PLAYER_MOVEMENT_CONFIG, PHYSICS_CONSTANTS,
    isCollectibleDrop,
} from '../../constants';
import { wrapDeltaX, wrapDeltaY, wrapPosition } from '../toroidal';
import { nextId } from '../systems/IdAllocator';

/** A rival ship and its engine-managed lifecycle/AI state.  The ship itself is
 *  a plain EntityType.ENEMY carrying `isRival`; everything else lives here so
 *  the entity stays lean. */
export interface RivalInstance {
  ship: GameEntity;
  disposition: RivalDisposition;
  state: 'enter' | 'roam' | 'leave';
  stateTimer: number;        // seconds left in the current state
  fireTimer: number;         // weapon cooldown
  stolen: number;            // points denied to the player so far (HUD/popup)
  portal?: { x: number; y: number };  // exit-portal centre (leave only)
  // Cached hunt target (Stage 7 perf).  Re-acquired on the PerfController
  // `rivalScan` cadence; steering/firing recompute only the O(1) distance to it
  // every step, and it's dropped the moment it goes inactive/exploding.
  target?: GameEntity | null;
}

function rollRivalDisposition(): RivalDisposition {
    const w = RIVAL_CONSTANTS.WEIGHTS;
    const r = Math.random() * (w.hostile + w.ally + w.neutral);
    if (r < w.hostile) return 'hostile';
    if (r < w.hostile + w.ally) return 'ally';
    return 'neutral';
}

/** Per-frame rival lifecycle: cadence warp-ins, per-ship hunt/strafe/fire/
 *  loot, and the warp-out fly-through.  Engine-driven (AISystem skips them). */
export function updateRivals(g: GameEngine, dt: number) {
    if (!g.currentMap) return;
    const R = RIVAL_CONSTANTS;

    // Cadence — a fresh random rival warps in every SCORE_INTERVAL points
    // earned (capped at MAX_RIVALS alive).  The threshold advances with the
    // score whether or not a rival actually spawns, so a score that vaults
    // several intervals at once doesn't queue a backlog of warp-ins.
    while (g.score >= g.nextRivalScore) {
        if (g.rivals.length < R.MAX_RIVALS) spawnRival(g);
        g.nextRivalScore += R.SCORE_INTERVAL;
    }
    if (g.rivals.length === 0) return;

    // Re-acquire targets + run the loot vacuum on the PerfController cadence;
    // everything else (steering, firing, lifecycle) still ticks every step.
    const doScan = g.perfController.shouldRun('rivalScan');
    const enemies = g.entityIndex.enemies;
    // Rivals fly with the SAME mechanics as the player: thrust toward the
    // desired heading + a self speed-cap, with the map's friction applied by
    // PhysicsSystem (enemies already get it).  acc/maxSpeed come from the map
    // movement config (player BASE values, no upgrade mults), so a rival is a
    // baseline player ship — the upgraded player can still out-fly it.
    const moveCfg = PLAYER_MOVEMENT_CONFIG[g.currentMap.type];
    const acc = moveCfg ? moveCfg.acceleration : PHYSICS_CONSTANTS.ACCELERATION;
    const baseMaxSpeed = moveCfg ? moveCfg.maxSpeed : PHYSICS_CONSTANTS.MAX_SPEED;
    const timeScale = dt * 60;
    for (let n = g.rivals.length - 1; n >= 0; n--) {
        const inst = g.rivals[n];
        const s = inst.ship;
        if (!s.active) { g.rivals.splice(n, 1); continue; }
        inst.stateTimer -= dt;
        inst.fireTimer -= dt;

        // ── Target: re-acquired on the rivalScan cadence (nearest wave enemy
        // within VISION; a hostile / provoked-neutral rival also weighs the
        // player), then CACHED on the instance.  Between scans steering/firing
        // reuse the cached target and only recompute the O(1) distance to it —
        // dropping it the moment it goes inactive/exploding. ──
        let target: GameEntity | null = inst.target ?? null;
        if (target && (!target.active || target.isExploding)) target = null;
        if (doScan) {
            const huntsPlayer = inst.disposition === 'hostile'
                || (inst.disposition === 'neutral' && s.provoked === true);
            // Publish it on the ENTITY so the renderer's off-screen indicator
            // can blink a hunting rival red without reaching into the
            // RivalInstance (disposition lives on the instance, not the hull).
            s.huntingPlayer = huntsPlayer;
            target = null;
            let acqD2 = R.VISION * R.VISION;
            for (let i = 0; i < enemies.length; i++) {
                const e = enemies[i];
                if (e.isRival || e.isExploding) continue;
                const dx = wrapDeltaX(s.position.x, e.position.x), dy = wrapDeltaY(s.position.y, e.position.y);
                const d2 = dx * dx + dy * dy;
                if (d2 < acqD2) { acqD2 = d2; target = e; }
            }
            if (huntsPlayer && !g.player.isExploding) {
                const dx = wrapDeltaX(s.position.x, g.player.position.x), dy = wrapDeltaY(s.position.y, g.player.position.y);
                const d2 = dx * dx + dy * dy;
                if (target === null || d2 < acqD2) { target = g.player; acqD2 = d2; }
            }
            inst.target = target;
        }
        // Live squared distance to the (cached) target — drives the strafe
        // sign + the fire-range gate below.
        let bestD2 = Infinity;
        if (target) {
            const tdx = wrapDeltaX(s.position.x, target.position.x), tdy = wrapDeltaY(s.position.y, target.position.y);
            bestD2 = tdx * tdx + tdy * tdy;
        }

        // ── Steering ──
        let dirX: number, dirY: number, speedMul = 1;
        if (inst.state === 'leave' && inst.portal) {
            const px = wrapDeltaX(s.position.x, inst.portal.x), py = wrapDeltaY(s.position.y, inst.portal.y);
            const pm = Math.hypot(px, py) || 1; dirX = px / pm; dirY = py / pm; speedMul = R.LEAVE_SPEED_MULT;
        } else if (target) {
            const tx = wrapDeltaX(s.position.x, target.position.x), ty = wrapDeltaY(s.position.y, target.position.y);
            const tm = Math.hypot(tx, ty) || 1;
            // Hold a firing gap: close if far, back off if too near; always strafe.
            const sign = tm > R.PREFERRED_DIST * 1.15 ? 1 : tm < R.PREFERRED_DIST * 0.7 ? -1 : 0;
            dirX = (tx / tm) * sign + (-ty / tm) * 0.7;
            dirY = (ty / tm) * sign + (tx / tm) * 0.7;
            const dm = Math.hypot(dirX, dirY) || 1; dirX /= dm; dirY /= dm;
            s.rotation = Math.atan2(ty, tx); // face the target
        } else {
            const flow = g.flowField.sampleAsteroidFlow(s.position.x, s.position.y);
            const fm = Math.hypot(flow.x, flow.y) || 1; dirX = flow.x / fm; dirY = flow.y / fm;
            s.rotation = Math.atan2(s.velocity.y, s.velocity.x);
        }
        // Player-style movement: apply thrust along the desired heading, then
        // self-cap speed (PhysicsSystem applies the map friction afterward, so
        // the rival accelerates + coasts exactly like the player ship).
        s.velocity.x += dirX * acc * timeScale;
        s.velocity.y += dirY * acc * timeScale;
        const maxSpeed = baseMaxSpeed * speedMul;
        const sp = Math.hypot(s.velocity.x, s.velocity.y);
        if (sp > maxSpeed) { const k = maxSpeed / sp; s.velocity.x *= k; s.velocity.y *= k; }
        if (inst.state === 'leave') s.rotation = Math.atan2(s.velocity.y, s.velocity.x);

        // ── Fire (only while roaming, target in range) ──
        if (inst.state === 'roam' && target && inst.fireTimer <= 0
            && bestD2 <= R.FIRE_RANGE * R.FIRE_RANGE) {
            inst.fireTimer = R.WEAPON.cooldown;
            fireRivalShot(g, inst, target);
        }

        // ── Loot vacuum: steal nearby collectible drops from the player
        // (cadenced with the target re-acquire; drops settle over many frames
        // so a few-step defer is invisible). ──
        if (doScan) rivalVacuumDrops(g, inst);

        // ── Lifecycle ──
        if (inst.state === 'enter') {
            if (inst.stateTimer <= 0) { inst.state = 'roam'; inst.stateTimer = R.ROAM_DURATION; }
        } else if (inst.state === 'roam') {
            if (inst.stateTimer <= 0) {
                inst.state = 'leave'; inst.stateTimer = R.LEAVE_DURATION;
                const vm = Math.hypot(s.velocity.x, s.velocity.y) || 1;
                const portal = { x: s.position.x + (s.velocity.x / vm) * R.PORTAL_AHEAD, y: s.position.y + (s.velocity.y / vm) * R.PORTAL_AHEAD };
                wrapPosition(portal);
                inst.portal = portal;
                g.openPortal(portal, { color: R.PORTAL_COLOR, radius: R.PORTAL_RADIUS, duration: R.PORTAL_DURATION });
                g.audio.play('rival.warp.out', { x: portal.x, y: portal.y });
            }
        } else if (inst.state === 'leave' && inst.portal) {
            const cr = R.PORTAL_CONSUME_RADIUS;
            const hx = wrapDeltaX(s.position.x, inst.portal.x), hy = wrapDeltaY(s.position.y, inst.portal.y);
            if (hx * hx + hy * hy <= cr * cr || inst.stateTimer <= 0) {
                g.spawnParticles(s.position, 14, R.PORTAL_COLOR, { speedMin: 2, speedMax: 8, sizeMin: 1.5, sizeMax: 4, lifetimeMin: 0.2, lifetimeMax: 0.6 });
                s.active = false; g.rivals.splice(n, 1); continue;
            }
        }
    }
}

/** Warp a rival ship in from an offscreen rift.  Disposition is rolled by
 *  weight unless one is forced (DBG). */
export function spawnRival(g: GameEngine, forced?: RivalDisposition) {
    if (!g.currentMap) return;
    const R = RIVAL_CONSTANTS;
    const zoom = g.camera.zoom || 1;
    const halfDiag = Math.hypot((window.innerWidth / 2) / zoom, (window.innerHeight / 2) / zoom);
    const angle = Math.random() * Math.PI * 2;
    const dist = halfDiag + R.SPAWN_MARGIN;
    const pos = { x: g.player.position.x + Math.cos(angle) * dist, y: g.player.position.y + Math.sin(angle) * dist };
    wrapPosition(pos);
    g.openPortal(pos, { color: R.PORTAL_COLOR, radius: R.PORTAL_RADIUS, duration: R.PORTAL_DURATION });

    const disposition = forced ?? rollRivalDisposition();
    const sprite = R.SPRITES[Math.floor(Math.random() * R.SPRITES.length)];
    const ship: GameEntity = {
        id: nextId('rival'),
        type: EntityType.ENEMY,
        position: { x: pos.x, y: pos.y },
        velocity: { x: -Math.cos(angle) * 2, y: -Math.sin(angle) * 2 }, // heading inward
        size: { x: R.SIZE, y: R.SIZE },
        rotation: angle + Math.PI,
        color: R.COLORS[disposition],
        active: true,
        health: R.HEALTH,
        maxHealth: R.HEALTH,
        maxSpeed: R.MAX_SPEED,
        mass: R.MASS,
        enemyTier: R.TIER,            // kill bounty when the player downs it
        isRival: true,
        sprite,
        trail: [],
        glowPhase: Math.random() * Math.PI * 2,
    };
    g.currentMap.entities.push(ship);
    g.rivals.push({
        ship, disposition, state: 'enter', stateTimer: R.ENTER_DURATION,
        fireTimer: Math.random() * R.WEAPON.cooldown, stolen: 0,
    });
    g.audio.play('rival.warp.in', { x: ship.position.x, y: ship.position.y });
}

/** Rival weapon: a blaster bolt that may damage the wave enemies (hitsEnemies)
 *  and—unless hostile or aimed AT the player—passes through the player. */
function fireRivalShot(g: GameEngine, inst: RivalInstance, target: GameEntity) {
    if (!g.currentMap) return;
    const W = RIVAL_CONSTANTS.WEAPON;
    const cfg = {
        type: WeaponType.BLASTER, name: 'Rival Blaster', cooldown: W.cooldown,
        speed: W.speed, damage: W.damage, lifetime: W.lifetime,
        color: inst.ship.color || W.color, size: W.size,
        count: 1, spread: 0, recoil: 0, pierce: 0,
    } as WeaponConfig;
    const ents = g.currentMap.entities;
    const before = ents.length;
    g.spawnProjectileFromConfig(inst.ship, { x: target.position.x, y: target.position.y }, cfg, EntityType.ENEMY);
    const targetingPlayer = target === g.player;
    const spares = !(inst.disposition === 'hostile' || targetingPlayer);
    for (let i = before; i < ents.length; i++) {
        const p = ents[i];
        if (p.type === EntityType.PROJECTILE) { p.hitsEnemies = true; p.sparesPlayer = spares; }
    }
}

/** Steal any collectible drop within LOOT_RANGE (denies the player + heals). */
function rivalVacuumDrops(g: GameEngine, inst: RivalInstance) {
    const R = RIVAL_CONSTANTS;
    const s = inst.ship;
    const rng2 = R.LOOT_RANGE * R.LOOT_RANGE;
    for (let i = 0; i < g.activeDrops.length; i++) {
        const drop = g.activeDrops[i];
        if (!drop.active || !isCollectibleDrop(drop)) continue;
        const dx = wrapDeltaX(s.position.x, drop.position.x), dy = wrapDeltaY(s.position.y, drop.position.y);
        if (dx * dx + dy * dy > rng2) continue;
        drop.active = false;
        s.health = Math.min(s.maxHealth ?? R.HEALTH, (s.health ?? 0) + R.HEAL_PER_LOOT);
        g.spawnParticles(drop.position, 5, s.color || '#e2e8f0', {
            speedMin: 1, speedMax: 5, sizeMin: 1, sizeMax: 2.4, lifetimeMin: 0.15, lifetimeMax: 0.4,
        });
    }
}
