/** SHOCKWAVES, BLASTS and the AoE ring — the explosion layer.
 *
 *  Extracted verbatim from `GameEngine` in gauntlet 5f (see
 *  `docs/GAUNTLET_5F_LOG.md`); plain free functions taking `g: GameEngine`,
 *  with `GameEngine` imported as a TYPE so it is erased at compile time and
 *  there is no runtime cycle.
 *
 *  One concern, in create/tick/apply order: `spawnShockwave` puts an
 *  expanding ring into the world, `updateExplosionRings` advances every live
 *  ring and damages what its wavefront has just reached, and the two
 *  `apply*BlastToPlayer` helpers deliver a blast DIRECTLY.
 *
 *  WHY THE PLAYER NEEDS ITS OWN PATH (CLAUDE.md §8).  The player is not in
 *  `currentMap.entities` — it is appended to `frameEntities` each step — so
 *  the ring, which walks `currentMap.entities`, can never reach it.  Every
 *  ENEMY-owned AoE that should hurt the player therefore routes through
 *  `applyBlastToPlayer`: a direct, shield-respecting blast with distance
 *  falloff, landed at the impact point so the shove is instant rather than
 *  gated on the wavefront arriving.
 *
 *  `startExplosion` deliberately stayed on `GameEngine`: it is the death path
 *  (it flips `isExploding` and arms the wreck timer), not the FX layer, and
 *  the 5b suites call it straight off `window.__omniEngine`.
 */
import type { GameEngine } from './GameEngine';
import { applyBoundaryDamage, stampLocalImpact } from './systems/fractureCache';
import { GameEntity, EntityType, Vector2, WeaponType } from '../types';
import {
    EXPLOSION_CONSTANTS, PHYSICS_CONSTANTS, COLLISION_CONFIG, SHIELD_CONSTANTS,
    noteTraitDamage, hitReactStrength, WEAPONS, markDamaged, markShieldDamaged} from '../constants';
import { wrapDeltaX, wrapDeltaY } from './toroidal';
import { nextId } from './systems/IdAllocator';

/** Shared empty snapshot for COSMETIC explosion rings (damage 0 +
 *  knockback 0).  They never apply anything, so they never read it —
 *  `updateExplosionRings` early-outs on an empty set.  Sharing one frozen
 *  instance means an ordinary enemy death (which spawns two cosmetic rings)
 *  allocates no Sets at all.  Never mutated; the damaging path builds its
 *  own real Set. */
const EMPTY_HIT_IDS: Set<string> = new Set<string>();

// ─── Reusable expanding shockwave ──────────────────────────────────────
//
// Spawns an `isExplosionRing` particle whose currentRadius grows 0 →
// radius across `lifetime`.  updateExplosionRings (each fixed step) ticks
// it, applying falloff damage + knockback to entities the wavefront
// reaches.  Powers both the Plasma Cannon AoE and the smaller shard→tile
// merge blow-back.  Only entities in range AT SPAWN are eligible
// (validHitIds snapshot), so entities born during the sweep are excluded.
export interface ShockwaveOpts {
    radius: number;
    damage: number;
    knockback: number;
    color: string;
    lifetime?: number;
    ownerType?: GameEntity['ownerType'];
    ownerId?: string;
    excludeIds?: string[];
}

export function spawnShockwave(g: GameEngine, pos: Vector2, opts: ShockwaveOpts) {
    if (!g.currentMap) return;
    const radius = opts.radius;
    if (!radius || radius <= 0) return;
    const radiusSq = radius * radius;

    // Cosmetic rings (the portal warp: damage 0 + knockback 0) never apply
    // anything, so the in-range snapshot is pure waste — updateExplosionRings
    // early-outs on an empty validHitIds set and the renderer draws the ring
    // from its radius/lifetime alone.  Skip the O(all-entities) scan + Set
    // work for them: a spawn burst (e.g. 10 dragon portals × 3 rings each)
    // used to walk the whole map per ring on the single spawn frame, which
    // is the bulk of the "spawn-burst hitch".  Damaging rings (cannon AoE,
    // kamikaze, merge blow-back) still snapshot exactly as before.
    const ents = g.currentMap.entities;
    const cosmeticRing = opts.damage <= 0 && opts.knockback <= 0;
    // Allocate the snapshot Set only for rings that can actually use it.
    // An ordinary enemy death spawns TWO cosmetic rings, so on a
    // kill-heavy frame this was two dead Sets per kill.
    let validHitIds = EMPTY_HIT_IDS;
    if (!cosmeticRing) {
        validHitIds = new Set<string>();
        for (let i = 0; i < ents.length; i++) {
            const e = ents[i];
            if (!e.active || e.isExploding) continue;
            if (e.type === EntityType.PROJECTILE) continue;
            if (e.type === EntityType.PARTICLE) continue;
            if (e.type === EntityType.INTERACTABLE) continue;
            const dx = wrapDeltaX(pos.x, e.position.x);
            const dy = wrapDeltaY(pos.y, e.position.y);
            if (dx * dx + dy * dy <= radiusSq) validHitIds.add(e.id);
        }
    }

    const lifetime = opts.lifetime ?? 0.35;
    ents.push({
        id: nextId('explosion-ring'),
        type: EntityType.PARTICLE,
        position: { x: pos.x, y: pos.y },
        velocity: { x: 0, y: 0 },
        size: { x: 1, y: 1 },
        rotation: 0,
        color: opts.color,
        active: true,
        health: 1,
        maxHealth: 1,
        lifetime,
        maxLifetime: lifetime,
        mass: 0,
        isExplosionRing: true,
        explosionRadius: radius,
        explosionDamage: opts.damage,
        explosionKnockback: opts.knockback,
        ownerType: opts.ownerType,
        ownerId: opts.ownerId,
        hitEntityIds: opts.excludeIds ? [...opts.excludeIds] : [],
        validHitIds,
    });
}

// ─── Cannon AoE — per-frame shockwave tick ─────────────────────────────
//
// Walks isExplosionRing particles each fixed step.  For each, computes
// currentRadius via the same `1 − lifetime/maxLifetime` formula the
// renderer uses (so the damage front is always pixel-aligned with the
// visible ring).  Then walks the master entity list once, damaging /
// knocking back any entity whose current toroidal distance falls
// within currentRadius and that hasn't been hit yet.  hitEntityIds
// grows monotonically to prevent double-hits as the wave widens.
export function updateExplosionRings(g: GameEngine) {
    if (!g.currentMap) return;
    const entities = g.currentMap.entities;

    for (let r = 0; r < entities.length; r++) {
        const ring = entities[r];
        if (!ring.active || !ring.isExplosionRing) continue;

        const maxRadius = ring.explosionRadius;
        if (!maxRadius || maxRadius <= 0) continue;

        const life = ring.lifetime ?? 0;
        const maxLife = ring.maxLifetime ?? 1;
        const expand = Math.max(0, Math.min(1, 1 - life / maxLife));
        const currentRadius = maxRadius * expand;
        if (currentRadius <= 0) continue;

        const currentR2 = currentRadius * currentRadius;
        const dmg   = ring.explosionDamage ?? 0;
        const knock = ring.explosionKnockback ?? 0;
        const hits  = ring.hitEntityIds ?? (ring.hitEntityIds = []);

        // Only candidates that were in range AT SPAWN are eligible —
        // entities born during the sweep (e.g. glass-shards from tiles
        // the wave just shattered) are excluded.
        const valid = ring.validHitIds;
        if (!valid || valid.size === 0) continue;

        for (let i = 0; i < entities.length; i++) {
            const e = entities[i];
            if (!e.active || e.isExploding) continue;
            if (!valid.has(e.id)) continue;
            if (hits.includes(e.id)) continue;

            const dx = wrapDeltaX(ring.position.x, e.position.x);
            const dy = wrapDeltaY(ring.position.y, e.position.y);
            const d2 = dx * dx + dy * dy;
            if (d2 > currentR2) continue;

            hits.push(e.id);
            const dist = Math.sqrt(d2);
            const falloff = 1 - (dist / maxRadius); // 1 at centre, 0 at rim

            if (dmg > 0) {
                let applied = dmg * falloff;
                const isIndestructible = e.type === EntityType.STRUCTURE && e.shardVariant === 'indestructible-tile';
                // Player shield soaks the blast first (kamikaze AoE and any
                // future enemy-owned explosion) so an AoE hit isn't a raw
                // shield-bypass — mirrors the projectile / ram absorption.
                if (e.id === 'player' && (e.shield ?? 0) > 0 && !e.systemsDisabled) {
                    const absorbed = Math.min(e.shield!, applied);
                    e.shield! -= absorbed;
                    markShieldDamaged(e);
                    applied -= absorbed;
                    e.shieldHitFlash = SHIELD_CONSTANTS.HIT_FLASH_DURATION;
                    e.shieldRechargeTimer = SHIELD_CONSTANTS.RECHARGE_DELAY;
                }
                if (!isIndestructible) {
                    // GRAIN BOUNDARIES (V15): a blast arrives from the ring's
                    // centre, so stamp that side and let it break boundaries
                    // like any other damage rather than draining a pool.
                    stampLocalImpact(e, ring.position);
                    if (!applyBoundaryDamage(e, applied)) e.health -= applied;
                }
                // (h) regen: splash damage counts toward a burst too — but
                // ONLY when the blast is the player's (an enemy shell healing
                // its own boss through the bucket would be nonsense).  Like
                // the chain, a ring bypasses the front-shield plate.
                if (ring.ownerType === EntityType.PLAYER) noteTraitDamage(e, applied);
                if (e.type === EntityType.ENEMY) e.provoked = true; // Stage 3a
                // Third-party retaliation (Stage 5): an AoE that catches a
                // bubble makes it target the blast's owner.
                if (e.thirdParty && ring.ownerId) e.aggroTargetId = ring.ownerId;
                markDamaged(e, 0.12);
                e.hitReact = hitReactStrength(applied, e.maxHealth ?? e.health);
                g.spawnDamageText(e.position, applied, e);
                if (e.health <= 0 && !e.isExploding) {
                    e.lastImpactDamage = applied;
                    if (ring.ownerType === EntityType.PLAYER) e.killedByPlayer = true;
                    if (e.type === EntityType.STRUCTURE && dist > 0) {
                        e.lastImpactVelocity = { x: (dx / dist) * 8, y: (dy / dist) * 8 };
                    }
                    if (e.type === EntityType.STRUCTURE && e.mass === Infinity) {
                        g.physics.removeStaticEntity(e);
                    }
                    g.handleEntityDeath(e);
                    e.active = false;
                }
            }

            if (knock > 0 && e.mass !== Infinity && dist > 0) {
                const k = knock * falloff;
                e.velocity.x += (dx / dist) * k;
                e.velocity.y += (dy / dist) * k;
                // Let the player overshoot the speed cap so the blast actually
                // launches them; the overshoot decays in updatePlayerMovement.
                if (e.id === 'player') {
                    const sp = Math.hypot(e.velocity.x, e.velocity.y);
                    e.overSpeedAllow = Math.max(e.overSpeedAllow ?? 0, sp);
                }
            }
        }
    }
}

export function applyExplosionAoE(g: GameEngine, impactPos: Vector2, proj: GameEntity, directTarget: GameEntity) {      if (!g.currentMap) return;
// Compact splash blast — deliberately not the boss-death boom, since
// a Cannon build fires this several times a fight.
g.audio.play('impact.explosion.aoe', { x: impactPos.x, y: impactPos.y });

    // Impact-frame visuals (instant): bright spark burst + screen shake.
    // These don't wait for the wavefront — the player should feel the
    // hit immediately while the ring continues outward.
    g.spawnParticles(impactPos, 14, '#fb923c', {
        speedMin: 4, speedMax: 11, sizeMin: 1.5, sizeMax: 3,
    });
    g.spawnParticles(impactPos, 6, '#ffffff', {
        speedMin: 6, speedMax: 14, sizeMin: 0.5, sizeMax: 1.5,
    });
    g.handleScreenShake(COLLISION_CONFIG.SHAKE.MEDIUM);

    // Spawn the damaging shockwave ring for the WORLD (enemies, structures).
    // The direct-hit target is excluded (it already took config.damage from
    // the projectile collision) and so is the player — the ring only ever
    // sweeps entities in currentMap.entities, which the player is not part
    // of (it is appended to frameEntities), so the player is handled by the
    // DIRECT path below exactly as the kamikaze blast is.
    spawnShockwave(g, impactPos, {
        radius: proj.explosionRadius!,
        damage: proj.explosionDamage ?? 0,
        knockback: proj.explosionKnockback ?? 0,
        color: WEAPONS[WeaponType.CANNON].color,
        ownerType: proj.ownerType,
        ownerId: proj.ownerId, // a caught bubble blames the shooter (Stage 5)
        excludeIds: [directTarget.id, 'player'],
    });

    // An ENEMY-owned explosive shell ((h) Bastion wields the player's own
    // Plasma Cannon, splash and all) must actually threaten the player —
    // otherwise its signature weapon is a light show.  Same direct,
    // shield-respecting blast the kamikaze uses, and for the same reason:
    // the ring sweep never reaches the player.  A player-owned Cannon
    // obviously doesn't self-damage.
    if (proj.ownerType === EntityType.ENEMY && directTarget !== g.player) {
        applyBlastToPlayer(g, 
            impactPos,
            proj.explosionRadius!,
            proj.explosionDamage ?? 0,
            proj.explosionKnockback ?? 0,
        );
    }
}

/**
 * Apply an ENEMY-owned area blast to the player DIRECTLY — shield-respecting
 * damage plus a launch, with distance falloff.  This exists (rather than
 * letting the shockwave ring do it) because the ring only sweeps
 * `currentMap.entities`, and the player is not in that list: it is appended
 * to `frameEntities` each step.  So every enemy AoE that should hurt the
 * player routes through here — the kamikaze detonation, and the (h) Bastion's
 * siege shells.  Landing it at the impact point also means the shove is
 * instant rather than gated on the ring's expanding wavefront reaching you.
 */
export function applyBlastToPlayer(g: GameEngine, pos: Vector2, radius: number, damage: number, knockback: number) {
    const p = g.player;
    if (p.isExploding) return;
    if (radius <= 0) return;
    const dx = wrapDeltaX(pos.x, p.position.x);
    const dy = wrapDeltaY(pos.y, p.position.y);
    const dist = Math.hypot(dx, dy);
    if (dist > radius) return;
    const falloff = Math.max(0.3, 1 - dist / radius);

    // Damage (shield first, then hull) — mirrors the projectile/ram paths.
    let dmg = damage * falloff;
    if ((p.shield ?? 0) > 0) {
        const absorbed = Math.min(p.shield!, dmg);
        p.shield! -= absorbed;
        markShieldDamaged(p);
        dmg -= absorbed;
        p.shieldHitFlash = SHIELD_CONSTANTS.HIT_FLASH_DURATION;
        p.shieldRechargeTimer = SHIELD_CONSTANTS.RECHARGE_DELAY;
    }
    if (dmg > 0) {
        p.health -= dmg;
        g.spawnDamageText(p.position, dmg, p);
    }
    markDamaged(p, 0.2);

    // Launch: shove along the blast→player vector (away from it) and raise
    // the overshoot allowance so the cap doesn't clamp the impulse.
    const k = knockback * falloff;
    let nx: number, ny: number;
    if (dist > 0.001) { nx = dx / dist; ny = dy / dist; }
    else { const a = Math.random() * Math.PI * 2; nx = Math.cos(a); ny = Math.sin(a); }
    p.velocity.x += nx * k;
    p.velocity.y += ny * k;
    p.overSpeedAllow = Math.max(p.overSpeedAllow ?? 0, Math.hypot(p.velocity.x, p.velocity.y));

    if (p.health <= 0 && !p.isExploding) g.handleEntityDeath(p);
}

// ─── Kamikaze blast → player (direct, instant) ─────────────────────────
//
// Applied at detonation (handleEntityDeath) so the launch + damage land the
// same frame at the contact point, independent of the expanding ring (which
// only sweeps collateral onto other entities).  Damage is shield-respecting;
// the knockback drives the player past the speed cap via `overSpeedAllow` so
// it reads as a real shove (the hard cap would otherwise eat it).  Falloff
// floors at 0.3 so a point-blank bomber always throws you.
export function applyKamikazeBlastToPlayer(g: GameEngine, bomb: GameEntity) {
    applyBlastToPlayer(g, 
        bomb.position,
        bomb.explosionRadius ?? 0,
        bomb.explosionDamage ?? 0,
        bomb.explosionKnockback ?? 0,
    );
}
