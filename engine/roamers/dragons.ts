/** The DRAGON mini-boss (Stage 6) — an engine-managed serpent roamer.
 *
 *  Extracted verbatim from `GameEngine` in gauntlet 5f (see
 *  `docs/GAUNTLET_5F_LOG.md`).  These are plain free functions taking the
 *  engine as their first parameter: the `GameEngine` import is a TYPE import,
 *  so it is erased at compile time and there is no runtime cycle, and every
 *  call is a direct static call — no dispatch, no context object, no layer to
 *  route through.  Bodies are unchanged; `this.` became `g.`.
 *
 *  What a dragon is (CLAUDE.md §5): a NEUTRAL third party that enters through
 *  a rift, rides the asteroid flow field on a slow serpentine weave, and grows
 *  a real Snake body out of the static tiles it devours.  It only fights once
 *  attacked.  Shooting a body segment dead severs everything aft of it.  It
 *  leaves head-first through an exit rift if it is not killed first.
 *
 *  Per-dragon lifecycle state lives on the `DragonInstance` below rather than
 *  on the head entity, so the entity stays lean.  Any number can be alive at
 *  once; `GameEngine.dragons` holds them.
 */
import type { GameEngine } from '../GameEngine';
import { GameEntity, EntityType, EnemySubtype, Vector2, WeaponType, WeaponConfig } from '../../types';
import {
    DRAGON_CONSTANTS, PLAYER_MOVEMENT_CONFIG, getActivePlayerThrustMult,
    ENEMY_VARIANTS, COLLISION_CONFIG, StructureVariant,
} from '../../constants';
import { wrapDeltaX, wrapDeltaY, wrapPosition } from '../toroidal';
import { nextId } from '../systems/IdAllocator';
import { TileGenerator, HEX_WIDTH, HEX_HEIGHT } from '../maps/TileGenerator';

/** One live dragon mini-boss (Stage 6): its head entity + Snake body + per-
 *  dragon lifecycle/attack timers.  Multiple can be alive at once. */
export interface DragonInstance {
  head: GameEntity;
  body: GameEntity[];                    // eaten/spawned tiles, head→tail
  state: 'enter' | 'roam' | 'leave';
  stateTimer: number;                    // seconds left in the current state
  time: number;                          // weave clock
  gnatTimer: number;                     // countdown to the next brood spit
  missileTimer: number;                  // countdown to the next homing missile
  portal?: { x: number; y: number };     // exit-portal centre (leave state only)
  headThrough?: boolean;                  // head has crossed the exit portal
}

export function updateDragons(g: GameEngine, dt: number) {
    if (g.dragons.length === 0 || !g.currentMap) return;
    const D = DRAGON_CONSTANTS;
    const moveCfg = PLAYER_MOVEMENT_CONFIG[g.currentMap.type];
    const cruise = Math.min(moveCfg.maxSpeed,
        (moveCfg.acceleration * getActivePlayerThrustMult()) / (1 - moveCfg.friction));

    for (let n = g.dragons.length - 1; n >= 0; n--) {
        const inst = g.dragons[n];
        const d = inst.head;
        if (!d.active) { g.dragons.splice(n, 1); continue; }
        inst.time += dt;

        // ── Steering ── while LEAVING, drive STRAIGHT toward the exit portal
        // (then keep going straight once the head is through, so the whole
        // body follows it through); otherwise the slow flow-weave roam.
        let dirX: number, dirY: number, speedMul: number;
        if (inst.state === 'leave' && inst.portal) {
            if (!inst.headThrough) {
                const px = wrapDeltaX(d.position.x, inst.portal.x), py = wrapDeltaY(d.position.y, inst.portal.y);
                const pm = Math.hypot(px, py) || 1; dirX = px / pm; dirY = py / pm;
            } else {
                const vm = Math.hypot(d.velocity.x, d.velocity.y) || 1; dirX = d.velocity.x / vm; dirY = d.velocity.y / vm; // continue straight
            }
            speedMul = D.LEAVE_SPEED_MULT;
        } else {
            const flow = g.flowField.sampleAsteroidFlow(d.position.x, d.position.y);
            const wob = Math.sin(inst.time * D.WEAVE_FREQ + (d.glowPhase ?? 0)) * D.WEAVE_AMP;
            const cosW = Math.cos(wob), sinW = Math.sin(wob);
            dirX = flow.x * cosW - flow.y * sinW;
            dirY = flow.x * sinW + flow.y * cosW;
            speedMul = 1;
        }
        const target = cruise * D.SPEED_FRAC * speedMul;
        const alpha = Math.min(1, D.STEER_RATE * dt * 60 * (inst.state === 'leave' ? 4 : 1));
        d.velocity.x += (dirX * target - d.velocity.x) * alpha;
        d.velocity.y += (dirY * target - d.velocity.y) * alpha;
        d.rotation = Math.atan2(d.velocity.y, d.velocity.x);

        // ── Body path history (newest first) ──
        if (!d.dragonPath) d.dragonPath = [{ x: d.position.x, y: d.position.y }];
        const head0 = d.dragonPath[0];
        const mdx = wrapDeltaX(head0.x, d.position.x), mdy = wrapDeltaY(head0.y, d.position.y);
        if (mdx * mdx + mdy * mdy >= D.PATH_SPACING * D.PATH_SPACING) {
            d.dragonPath.unshift({ x: d.position.x, y: d.position.y });
            if (d.dragonPath.length > D.PATH_MAX) d.dragonPath.length = D.PATH_MAX;
        }

        // ── Devour tiles in the head's path → APPEND each as a body segment ──
        if (inst.state !== 'leave') {
            const headR = Math.max(d.size.x, d.size.y) * 0.6;
            const buf = g._dragonEatBuf;
            buf.length = 0;
            g.physics.forEachStaticNear(d.position.x, d.position.y, headR + 40, (t) => buf.push(t));
            for (let i = 0; i < buf.length; i++) {
                const t = buf[i];
                if (!t.active || t.shardVariant === 'indestructible-tile') continue; // can't devour the unbreakable
                const tdx = wrapDeltaX(d.position.x, t.position.x);
                const tdy = wrapDeltaY(d.position.y, t.position.y);
                const contact = headR + Math.max(t.size.x, t.size.y) * 0.5;
                if (tdx * tdx + tdy * tdy <= contact * contact) appendDragonSegment(g, inst, t, tdx, tdy);
            }
        }

        // ── Chain-follow: snap each body segment along the head's path ──
        positionDragonBody(inst);

        // ── Leaving: the dragon flies INTO the exit portal and is consumed
        // HEAD→TAIL — each part vanishes (puff) as it crosses the portal, the
        // body trailing through behind the (now-hidden) head. ──
        if (inst.state === 'leave' && inst.portal) {
            const cr = D.PORTAL_CONSUME_RADIUS, crSq = cr * cr;
            if (!inst.headThrough) {
                const hx = wrapDeltaX(d.position.x, inst.portal.x), hy = wrapDeltaY(d.position.y, inst.portal.y);
                if (hx * hx + hy * hy <= crSq) {
                    inst.headThrough = true;
                    d.dragonHidden = true;        // head "entered" — stop drawing it
                    d.contactDamage = 0;          // and stop hurting on contact
                    g.spawnParticles(d.position, 14, D.PORTAL_COLOR, { speedMin: 2, speedMax: 8, sizeMin: 1.5, sizeMax: 4, lifetimeMin: 0.2, lifetimeMax: 0.6 });
                }
            }
            let remaining = 0;
            for (let i = 0; i < inst.body.length; i++) {
                const s = inst.body[i];
                if (!s.active) continue;
                const sx = wrapDeltaX(s.position.x, inst.portal.x), sy = wrapDeltaY(s.position.y, inst.portal.y);
                if (sx * sx + sy * sy <= crSq) {
                    s.active = false;
                    g.spawnParticles(s.position, 9, s.color || D.PORTAL_COLOR, { speedMin: 2, speedMax: 7, sizeMin: 1.2, sizeMax: 3, lifetimeMin: 0.15, lifetimeMax: 0.5 });
                } else remaining++;
            }
            // Fully through (or the safety timer expired) → gone.
            if ((inst.headThrough && remaining === 0) || inst.stateTimer <= 0) {
                despawnDragon(inst);
                g.dragons.splice(n, 1);
                continue;
            }
        }

        // ── Provoke-on-attack (third party): head shot stamps `provoked`
        // (PhysicsSystem); a BODY-segment hit provokes too (default player). ──
        if (!d.provoked) {
            for (let i = 0; i < inst.body.length; i++) {
                if ((inst.body[i].hitFlash ?? 0) > 0) { d.provoked = true; if (!d.aggroTargetId) d.aggroTargetId = 'player'; break; }
            }
        }

        // ── Head attacks: ONLY once provoked — spit gnats + lob missiles ──
        if (inst.state === 'roam' && d.provoked) {
            inst.gnatTimer -= dt;
            if (inst.gnatTimer <= 0) {
                inst.gnatTimer = D.GNAT_INTERVAL + Math.random() * D.GNAT_INTERVAL * 0.5;
                const ctx = g.waveContext();
                if (ctx) {
                    g.waves.spawnAt(EnemySubtype.SWARM, d.position, ctx, false);
                    g.spawnParticles(d.position, 7, '#2dd4bf', {
                        speedMin: 2, speedMax: 6, sizeMin: 1.5, sizeMax: 3, lifetimeMin: 0.2, lifetimeMax: 0.5,
                    });
                }
            }
            inst.missileTimer -= dt;
            if (inst.missileTimer <= 0 && !g.player.isExploding) {
                inst.missileTimer = D.MISSILE_INTERVAL;
                fireDragonMissile(g, d);
            }
        }

        // ── Lifecycle ── (leave COMPLETION is handled by the portal-consume
        // pass above; here we only advance enter→roam→leave and open the exit
        // rift AHEAD of the head so it flies into it.) ──
        inst.stateTimer -= dt;
        if (inst.state === 'enter') {
            if (inst.stateTimer <= 0) { inst.state = 'roam'; inst.stateTimer = D.ROAM_DURATION; }
        } else if (inst.state === 'roam') {
            if (inst.stateTimer <= 0) {
                inst.state = 'leave';
                inst.stateTimer = D.LEAVE_DURATION; // safety cap only
                const vm = Math.hypot(d.velocity.x, d.velocity.y) || 1;
                const portal = { x: d.position.x + (d.velocity.x / vm) * D.PORTAL_AHEAD, y: d.position.y + (d.velocity.y / vm) * D.PORTAL_AHEAD };
                wrapPosition(portal);
                inst.portal = portal;
                inst.headThrough = false;
                openDragonPortal(g, portal);
            }
        }
    }
}

/** Open an offscreen entry portal and birth a dragon of `type` ('mixed' = a
 *  multi-material starting body).  Multiple can be alive at once. */
export function spawnDragon(g: GameEngine, type: StructureVariant | 'mixed' = 'mixed') {
    if (!g.currentMap) return;
    const zoom = g.camera.zoom || 1;
    const halfDiag = Math.hypot((window.innerWidth / 2) / zoom, (window.innerHeight / 2) / zoom);
    const angle = Math.random() * Math.PI * 2;
    const dist = halfDiag + DRAGON_CONSTANTS.SPAWN_MARGIN;
    const pos = { x: g.player.position.x + Math.cos(angle) * dist, y: g.player.position.y + Math.sin(angle) * dist };
    wrapPosition(pos);
    openDragonPortal(g, pos);

    const v = ENEMY_VARIANTS[EnemySubtype.DRAGON];
    const d: GameEntity = {
        id: nextId('dragon'),
        type: EntityType.ENEMY,
        enemySubtype: EnemySubtype.DRAGON,
        position: { x: pos.x, y: pos.y },
        velocity: { x: -Math.cos(angle) * 2, y: -Math.sin(angle) * 2 }, // head inward
        size: { x: v.size, y: v.size },
        rotation: angle + Math.PI,
        color: v.color,
        active: true,
        health: v.health,
        maxHealth: v.health,
        maxSpeed: v.maxSpeed,
        mass: v.mass,
        contactDamage: v.contactDamage,
        enemyShape: 'dragon',
        phasesTerrain: true,          // glides through terrain, eats it
        thirdParty: true,             // neutral: enemy fire hits it; provoke-on-attack
        consume: v.consume ? { ...v.consume } : undefined,
        aiState: 'chase',
        glowPhase: Math.random() * Math.PI * 2,
    };
    // Seed a trailing path (outward, away from the head's inward heading) so the
    // starting body lays out behind it immediately instead of stacking.
    const ox = Math.cos(angle), oy = Math.sin(angle); // outward = away from movement
    const seed: Vector2[] = [];
    for (let k = 0; k < 110; k++) seed.push({ x: pos.x + ox * k * DRAGON_CONSTANTS.PATH_SPACING, y: pos.y + oy * k * DRAGON_CONSTANTS.PATH_SPACING });
    d.dragonPath = seed;
    g.currentMap.entities.push(d);
    const inst: DragonInstance = {
        head: d, body: [], state: 'enter',
        stateTimer: DRAGON_CONSTANTS.ENTER_DURATION, time: 0,
        gnatTimer: DRAGON_CONSTANTS.GNAT_INTERVAL, missileTimer: DRAGON_CONSTANTS.MISSILE_INTERVAL,
    };
    // Spawn a starting body so it never enters as a bare head.  A 'mixed'
    // dragon cycles materials; a typed dragon is all one (it still becomes
    // mixed as it eats other tiles).
    const MIX: StructureVariant[] = ['glass', 'rock', 'metal', 'plastic'];
    for (let i = 0; i < DRAGON_CONSTANTS.START_SEGMENTS; i++) {
        const segVar = type === 'mixed' ? MIX[i % MIX.length] : type;
        const seg = makeDragonSegment(segVar, pos.x, pos.y);
        g.currentMap.entities.push(seg);
        inst.body.push(seg);
    }
    g.dragons.push(inst);
    positionDragonBody(inst); // lay the body out along the seeded path now
}

/** Fire one slow HOMING missile from the dragon head at the player. */
function fireDragonMissile(g: GameEngine, d: GameEntity) {
    const M = DRAGON_CONSTANTS.MISSILE;
    const cfg = {
        type: WeaponType.HOMING, name: 'Dragon Missile', cooldown: 1,
        speed: M.speed, damage: M.damage, lifetime: M.lifetime, color: M.color, size: M.size,
        count: 1, spread: 0, recoil: 0, pierce: 0,
        homing: true, homingStrength: M.homingStrength, glow: true,
    } as WeaponConfig;
    g.spawnProjectileFromConfig(d, g.player.position, cfg, EntityType.ENEMY);
}

/** Devour a static tile → APPEND it as a body segment (Snake growth).  Beyond
 *  MAX_SEGMENTS the tile is just destroyed (the dragon still carves a path). */
function appendDragonSegment(g: GameEngine, inst: DragonInstance, tile: GameEntity, dx: number, dy: number) {
    g.physics.removeStaticEntity(tile);
    g.flowField.onTileDestroyed(tile.position.x, tile.position.y);
    if (inst.body.length >= DRAGON_CONSTANTS.MAX_SEGMENTS) {
        const inward = Math.atan2(-dy, -dx);
        g.spawnParticles(tile.position, 6, tile.color || '#94a3b8', {
            spreadAngle: inward, spreadCone: 0.9, speedMin: 2, speedMax: 6, sizeMin: 1, sizeMax: 2.4, lifetimeMin: 0.1, lifetimeMax: 0.3,
        });
        tile.active = false;
        return;
    }
    tile.mass = DRAGON_CONSTANTS.SEGMENT_MASS; // finite → dynamic + shootable
    tile.dragonSegment = true;
    tile.phasesTerrain = true; // glides through terrain/each other; still solid to player + shots
    if (!tile.velocity) tile.velocity = { x: 0, y: 0 }; else { tile.velocity.x = 0; tile.velocity.y = 0; }
    inst.body.push(tile);
}

/** Build a fresh hex-tile body segment of `variant` at (x,y) — used to spawn
 *  the dragon's starting body.  A real tile (dent/shatter) flagged as a chain-
 *  controlled, phasing dragon segment. */
function makeDragonSegment(variant: StructureVariant, x: number, y: number): GameEntity {
    const w = HEX_WIDTH, h = HEX_HEIGHT;
    const seg = TileGenerator.buildStructureTile(0, 0, x, y, w, h, variant);
    seg.mass = DRAGON_CONSTANTS.SEGMENT_MASS;
    seg.dragonSegment = true;
    seg.phasesTerrain = true;
    return seg;
}

/** Snap each body segment onto the head's path, SEGMENT_SPACING apart by arc
 *  length, oriented along the body — the Snake chain.  The walk is ANCHORED to
 *  the head's LIVE position (not the last recorded path point, which only
 *  updates every PATH_SPACING and made the whole body jump), so the chain
 *  tracks the smoothly-moving head jitter-free. */
function positionDragonBody(inst: DragonInstance) {
    const head = inst.head;
    const body = inst.body;
    const path = head.dragonPath;
    if (body.length === 0 || !path || path.length < 1) return;
    const SP = DRAGON_CONSTANTS.SEGMENT_SPACING;
    let prevX = head.position.x, prevY = head.position.y; // live anchor
    let acc = 0, seg = 0, target = SP;
    for (let i = 0; i < path.length && seg < body.length; i++) {
        const cur = path[i];
        const vx = wrapDeltaX(prevX, cur.x), vy = wrapDeltaY(prevY, cur.y); // prev → cur
        const len = Math.hypot(vx, vy);
        if (len > 1e-4) {
            while (seg < body.length && acc + len >= target) {
                const t = (target - acc) / len;
                const s = body[seg];
                s.position.x = prevX + vx * t;
                s.position.y = prevY + vy * t;
                wrapPosition(s.position);
                s.rotation = Math.atan2(vy, vx);
                s.velocity.x = 0; s.velocity.y = 0;
                seg++; target += SP;
            }
            acc += len;
        }
        prevX = cur.x; prevY = cur.y;
    }
    // Path too short for the whole body — stack the rest at the tail end.
    const tail = path[path.length - 1];
    for (; seg < body.length; seg++) {
        const s = body[seg];
        s.position.x = tail.x; s.position.y = tail.y;
        wrapPosition(s.position);
        s.velocity.x = 0; s.velocity.y = 0;
    }
}

/** A body segment was destroyed: everything AFT of it falls off (→ free
 *  drifting shards), and the segment itself shatters (handled by the caller). */
function severDragon(inst: DragonInstance, seg: GameEntity) {
    const idx = inst.body.indexOf(seg);
    if (idx < 0) return;
    for (let i = idx + 1; i < inst.body.length; i++) detachDragonSegment(inst.body[i]);
    inst.body.length = idx; // drop the broken segment + everything aft
}

/** Find the live dragon whose body contains `seg` (for sever routing). */
function dragonOwning(g: GameEngine, seg: GameEntity): DragonInstance | undefined {
    for (let i = 0; i < g.dragons.length; i++) if (g.dragons[i].body.indexOf(seg) >= 0) return g.dragons[i];
    return undefined;
}

/** A severed segment falls off the dragon: clear the flag, turn it into a free
 *  mobile shard of its material, and kick it loose. */
function detachDragonSegment(seg: GameEntity) {
    seg.dragonSegment = false;
    seg.phasesTerrain = false; // a loose shard collides normally again
    seg.shardVariant = tileToShardVariant(seg.shardVariant);
    const a = Math.random() * Math.PI * 2;
    seg.velocity.x = Math.cos(a) * 3.5;
    seg.velocity.y = Math.sin(a) * 3.5;
}

/** A killed body segment: sever the owning dragon's tail, then dissolve it
 *  (shatter burst, no regen/drops — it's a body part, not a map tile). */
export function dragonSegmentDeath(g: GameEngine, seg: GameEntity) {
    const inst = dragonOwning(g, seg);
    if (inst) severDragon(inst, seg);
    g.spawnParticles(seg.position, 12, seg.color || '#94a3b8', {
        speedMin: 2, speedMax: 8, sizeMin: 1.5, sizeMax: 3.5, lifetimeMin: 0.2, lifetimeMax: 0.55,
    });
    seg.active = false;
}

/** Map a tile variant to its mobile-shard variant (for severed body parts). */
function tileToShardVariant(v: GameEntity['shardVariant']): GameEntity['shardVariant'] {
    switch (v) {
        case 'glass-tile':   return 'glass-shard';
        case 'rock-tile':    return 'rock-shard';
        case 'metal-tile':   return 'metal-shard';
        case 'plastic-tile': return 'plastic-shard';
        default:             return v;
    }
}

/** Dragon killed: big payoff + score + collapse the rift + scatter the body. */
export function dragonDeath(g: GameEngine, inst: DragonInstance) {
    const d = inst.head;
    // Payout doubles per kill this run: 3000, 6000, 12000, …
    g.awardScore(DRAGON_CONSTANTS.SCORE * Math.pow(2, g.dragonsKilled), d.position);
    g.dragonsKilled++;
    openDragonPortal(g, d.position);
    g.spawnParticles(d.position, 24, DRAGON_CONSTANTS.COLOR, { // Tier 2b: 40 → 24
        speedMin: 3, speedMax: 14, sizeMin: 2, sizeMax: 5, lifetimeMin: 0.4, lifetimeMax: 1.0,
    });
    g.handleScreenShake(COLLISION_CONFIG.SHAKE.HEAVY);
    d.active = false;
    for (let i = 0; i < inst.body.length; i++) detachDragonSegment(inst.body[i]); // body scatters
    const k = g.dragons.indexOf(inst);
    if (k >= 0) g.dragons.splice(k, 1);
}

/** Despawn a dragon (left via portal — no payoff).  The body leaves with it.
 *  Caller removes it from `g.dragons`. */
function despawnDragon(inst: DragonInstance) {
    inst.head.active = false;
    for (let i = 0; i < inst.body.length; i++) inst.body[i].active = false;
}

/** Portal VFX: an expanding violet rift ring + sparks. */
function openDragonPortal(g: GameEngine, pos: Vector2) {
    g.openPortal(pos, {
        color: DRAGON_CONSTANTS.PORTAL_COLOR,
        radius: DRAGON_CONSTANTS.PORTAL_RADIUS,
        duration: DRAGON_CONSTANTS.PORTAL_DURATION,
    });
}
