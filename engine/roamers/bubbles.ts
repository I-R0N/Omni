/** The BUBBLE — ambient soft-body fauna, and the eat/latch machinery it drives.
 *
 *  Extracted verbatim from `GameEngine` in gauntlet 5f (see
 *  `docs/GAUNTLET_5F_LOG.md`); same technique as the other roamer modules —
 *  plain free functions taking `g: GameEngine`, with `GameEngine` imported as
 *  a TYPE so it is erased at compile time and there is no runtime cycle.
 *
 *  A bubble is a TRUE THIRD PARTY: always-present fauna that drifts on the
 *  asteroid flow field eating shards, and turns hostile only against whoever
 *  last hit or rammed it.  See CLAUDE.md §5 for the full behaviour spec.
 *
 *  WHY THE STAGE-3 PRIMITIVES LIVE HERE.  `updateAttachments` (3c attach) and
 *  `updateConsumers` (3b consume-and-grow) are documented as reusable
 *  primitives, and `updateConsumers` does carry the dragon's `eats: 'tile'`
 *  branch — but every piece of state they touch is a `bubble*` field
 *  (`bubbleDigestTimer`, `bubbleFeedTimer`, `bubbleSickTimer`) and their
 *  helpers read `BUBBLE_CONSTANTS`.  Filing them under a neutral name would
 *  have been truer to the intent and less true to the code, so they sit with
 *  the creature that owns their state.  Move them out the day a second
 *  consumer stops writing bubble fields.
 *
 *  `updateNests` and `updateKamikazeProximity` deliberately stayed on
 *  `GameEngine`: they are small generic wave-enemy passes with nothing bubble
 *  about them, and filing them here would be a misfile.
 */
import type { GameEngine } from '../GameEngine';
import { GameEntity, EntityType, EnemySubtype, ConsumeConfig, GameState } from '../../types';
import {
    BUBBLE_CONSTANTS, ENEMY_VARIANTS, AI_CONFIG, NEBULA_CONSTANTS, calmBubble,
    isProgressiveFracture,
} from '../../constants';
import { wrapDeltaX, wrapDeltaY, wrapPosition } from '../toroidal';
import type { WaveSpawnContext } from '../systems/WaveSystem';

// ─── Bubble engagement pass (Stage 5) ──────────────────────────────────
//
// For each BUBBLE enemy: (1) a PASSIVE bubble grown to its multiply.atSize
// SPLITS — it resets to base size and births one offspring (counts=false),
// capped at multiply.maxPopulation live bubbles; (2) a PROVOKED bubble LATCHES
// onto its AGGRO TARGET (the last thing to attack it — the player OR an enemy)
// on contact — attach (Stage 3c) + drain, and an EMP (disable status) when the
// target is the player.  Against the player the latch ends in a pop (spent
// charge); against an enemy it releases and the bubble survives to re-engage.
// O(enemies) with a one-shot population census only on a split frame; ungated
// (bubbles are few), matching the kamikaze/nest passes.  Toroidal.
export function updateBubbles(g: GameEngine, dt: number) {
    if (!g.currentMap) return;
    const p = g.player;
    const enemies = g.entityIndex.enemies;
    const B = BUBBLE_CONSTANTS;
    const baseSize = ENEMY_VARIANTS[EnemySubtype.BUBBLE].size;
    // Terrain-slam window (player smacked a tile/asteroid fast) ticks down here.
    if (p.terrainSlamTimer) p.terrainSlamTimer = Math.max(0, p.terrainSlamTimer - dt);
    let ctx: WaveSpawnContext | null = null;

    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.enemySubtype !== EnemySubtype.BUBBLE || !e.active || e.isExploding) continue;
        const cfg = ENEMY_VARIANTS[EnemySubtype.BUBBLE];
        if (e.bubbleFeedTimer) e.bubbleFeedTimer = Math.max(0, e.bubbleFeedTimer - dt); // membrane bulge decay
        if (e.bubbleSickTimer) e.bubbleSickTimer = Math.max(0, e.bubbleSickTimer - dt);
        // Feeding-bite cadence.  Ticked HERE rather than in updateConsumers
        // because that pass is PerfController-gated ('consume'), so ticking it
        // there would make a bubble gnaw more slowly the busier the field got.
        if (e.bubbleBiteTimer) e.bubbleBiteTimer = Math.max(0, e.bubbleBiteTimer - dt);
        const sick = (e.bubbleSickTimer ?? 0) > 0;

        // ── A1: the non-aggression timeout — a hunter left alone LOSES INTEREST.
        // Ticked on SIM time (dt is FIXED_DT) like every other timer here, and
        // ABOVE the latch/sick early-outs so it runs whatever regime the bubble
        // is in.  Every fresh act of aggression refreshes the window at the
        // stamp site (constants.stampBubbleAggro), so this only ever fires on a
        // bubble that has genuinely been left alone for AGGRO_TIMEOUT_SEC.
        //
        // Not while LATCHED: a bubble mid-bite has plainly not lost interest,
        // and the bite owns its own ending (detachLatch clears aggro anyway).
        if (e.bubbleAggroTimer !== undefined && e.attachedToId === undefined) {
            e.bubbleAggroTimer -= dt;
            if (e.bubbleAggroTimer <= 0) calmBubble(e); // no sick state: it just wandered off
        }

        // ── Digesting a held shard: tick down, then grow + heal (the eat). The
        // shrinking ghost is drawn inside the membrane by RenderSystem. ──
        if ((e.bubbleDigestTimer ?? 0) > 0) {
            e.bubbleDigestTimer = e.bubbleDigestTimer! - dt;
            if (Math.random() < 0.25) {
                g.spawnParticles(e.position, 1, e.bubbleDigestColor || '#a8a29e', {
                    speedMin: 0.5, speedMax: 2, sizeMin: 0.8, sizeMax: 1.8,
                    lifetimeMin: 0.2, lifetimeMax: 0.45, positionJitter: Math.max(e.size.x, e.size.y) * 0.3,
                });
            }
            if (e.bubbleDigestTimer <= 0) {
                // Recover the richness from the stored per-shard duration.
                const rich = (e.bubbleDigestDuration ?? B.DIGEST_DURATION) / B.DIGEST_DURATION;
                growConsumer(e, cfg.consume!, rich);
                syncBubbleMaxHealth(e); // maxHP scales with the new size
                e.bubbleFeedTimer = B.FEED_PULSE; // final gulp bulge
                e.bubbleDigestTimer = 0;
                e.bubbleDigestDuration = undefined;
                e.bubbleDigestColor = undefined;
                e.bubbleDigestSize0 = undefined;
            }
        }

        // ── Latched: EMP + size-scaled drain; falls off (→ sick) on the timer,
        // a projectile hit, or a player terrain slam.  No longer dies. ──
        if (e.attachedToId !== undefined) {
            const victim = resolveAggroTarget(g, e.attachedToId);
            const onPlayer = e.attachedToId === 'player';
            // Face the target so the membrane squashes against its hull (render).
            e.rotation = Math.atan2(-(e.attachOffset?.y ?? 0), -(e.attachOffset?.x ?? 0));
            if (victim && !victim.isExploding) {
                if (onPlayer) g.applyStatusEffect(p, { kind: 'disable', duration: B.EMP_REFRESH, dmgPerSec: 0, maxStacks: 1 });
                const drain = B.LATCH_DPS * (Math.max(e.size.x, e.size.y) / baseSize); // bigger bubble bites harder
                victim.health -= drain * dt;
                if (victim.health <= 0 && !victim.isExploding) g.handleEntityDeath(victim);
            }
            e.bubbleLatchTimer = (e.bubbleLatchTimer ?? 0) - dt;
            const shaken = e.bubbleKnockFree === true || (onPlayer && (p.terrainSlamTimer ?? 0) > 0);
            if (e.bubbleLatchTimer <= 0 || shaken || !victim || victim.isExploding) {
                e.bubbleKnockFree = undefined;
                detachLatch(g, e); // fall off + go sick + lose aggro (no death)
            }
            continue;
        }

        if (sick) continue; // sluggish + can't hunt/latch/breed (AISystem drifts it)

        // ── Provoked + in contact with the aggro target → latch on ──
        const target = e.aggroTargetId ? resolveAggroTarget(g, e.aggroTargetId) : (e.provoked ? p : null);
        if (target) {
            if (!target.active || target.isExploding) {
                // Attacker gone → calm down (back to ambient drift / breeding).
                calmBubble(e);
            } else {
                const tr = Math.max(target.size.x, target.size.y) / 2;
                const dx = wrapDeltaX(e.position.x, target.position.x);
                const dy = wrapDeltaY(e.position.y, target.position.y);
                const reach = tr + Math.max(e.size.x, e.size.y) / 2 + B.CONTACT_PAD;
                if (dx * dx + dy * dy <= reach * reach) {
                    e.attachedToId = target.id;
                    e.attachOffset = { x: -dx, y: -dy }; // ride where it grabbed
                    e.bubbleLatchTimer = B.LATCH_DURATION;
                    g.audio.play('bubble.latch', { x: target.position.x, y: target.position.y });
                    if (target.id === 'player') g.applyStatusEffect(p, { kind: 'disable', duration: B.EMP_REFRESH, dmgPerSec: 0, maxStacks: 1 });
                    g.spawnParticles(target.position, 10, e.color || '#67e8f9', {
                        speedMin: 2, speedMax: 6, sizeMin: 1.5, sizeMax: 3.5,
                        lifetimeMin: 0.2, lifetimeMax: 0.5,
                    });
                }
                continue; // a provoked bubble doesn't breed
            }
        }

        // ── Passive + fat enough → split into two base-size bubbles ──
        // (not while digesting a meal).
        const mult = cfg.multiply;
        if (mult && (e.bubbleDigestTimer ?? 0) <= 0 && Math.max(e.size.x, e.size.y) >= mult.atSize) {
            let pop = 0;
            for (let k = 0; k < enemies.length; k++) {
                const o = enemies[k];
                if (o.enemySubtype === EnemySubtype.BUBBLE && o.active && !o.isExploding) pop++;
            }
            if (pop >= mult.maxPopulation) continue;
            ctx = ctx ?? g.waveContext();
            if (!ctx) continue;
            const base = cfg.size;
            e.size.x = base; e.size.y = base;
            syncBubbleMaxHealth(e); // back to base maxHP after shedding mass
            const a = Math.random() * Math.PI * 2;
            e.velocity.x += Math.cos(a) * B.SPLIT_SPEED;
            e.velocity.y += Math.sin(a) * B.SPLIT_SPEED;
            const child = g.waves.spawnAt(EnemySubtype.BUBBLE, e.position, ctx, false);
            child.velocity.x = -Math.cos(a) * B.SPLIT_SPEED;
            child.velocity.y = -Math.sin(a) * B.SPLIT_SPEED;
            g.spawnParticles(e.position, 8, e.color || '#67e8f9', {
                speedMin: 2, speedMax: 6, sizeMin: 1.5, sizeMax: 3,
                lifetimeMin: 0.2, lifetimeMax: 0.5,
            });
        }
    }
}

/** Resolve a bubble's aggro/latch target id to a live entity — the player
 *  ('player') or an active enemy by id — or null if it's gone.  Cheap: the
 *  player is special-cased and enemies come from the small filtered index. */
export function resolveAggroTarget(g: GameEngine, id: string): GameEntity | null {
    if (id === 'player') return g.player;
    const enemies = g.entityIndex.enemies;
    for (let i = 0; i < enemies.length; i++) {
        if (enemies[i].id === id) return enemies[i].active ? enemies[i] : null;
    }
    return null;
}

/** Break a bubble's latch: it falls off, goes SICK (sluggish + can't eat),
 *  and loses aggro — it does NOT die (shoot it while sick for the kill). */
export function detachLatch(g: GameEngine, e: GameEntity) {
g.audio.play('bubble.detach', { x: e.position.x, y: e.position.y });
    e.attachedToId = undefined;
    e.attachOffset = undefined;
    e.bubbleLatchTimer = 0;
    e.bubbleSickTimer = BUBBLE_CONSTANTS.SICK_DURATION;
    calmBubble(e); // calm down after the bite (and disarm the A1 window with it)
    g.spawnParticles(e.position, 12, BUBBLE_CONSTANTS.SICK_COLOR, {
        speedMin: 2, speedMax: 7, sizeMin: 1.5, sizeMax: 3.2,
        lifetimeMin: 0.2, lifetimeMax: 0.55,
    });
}

/** Richness of a shard for mass/energy-conserved eating (shardRichness):
 *  denser/bigger shards score higher → longer digest + more growth/health.
 *  Clamped to BUBBLE_CONSTANTS.RICH_MIN..RICH_MAX. */
function shardRichness(shard: GameEntity): number {
    const sizeR = Math.max(shard.size.x, shard.size.y) / 26; // ≈ a baseline shard
    let dens = 1;
    switch (shard.shardVariant) {
        case 'metal-shard':   dens = 1.7;  break;
        case 'rock-shard':    dens = 1.35; break;
        case 'glass-shard':   dens = 0.9;  break;
        case 'plastic-shard': dens = 0.9;  break;
        case 'nebula-shard':  dens = 0.8;  break;
    }
    return Math.max(BUBBLE_CONSTANTS.RICH_MIN, Math.min(BUBBLE_CONSTANTS.RICH_MAX, sizeR * dens));
  }

/** Toxic shards make the bubble sick on eating: plastic, or a GREEN nebula
 *  shard (green-dominant blended colour). */
function isToxicShard(shard: GameEntity): boolean {
    if (shard.shardVariant === 'plastic-shard') return true;
    if (shard.shardVariant === 'nebula-shard') {
        const hex = shard.nebulaBlendedHex || shard.color || '';
        if (hex.length >= 7) {
            const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
            return g > r * 1.1 && g > b * 1.1 && g > 90; // green-dominant
        }
    }
    return false;
}

// ─── Ambient bubble population (Stage 5) ───────────────────────────────
//
// Bubbles are always-present fauna, not wave enemies — keep at least
// BUBBLE_CONSTANTS.AMBIENT_POPULATION alive at all times by topping up
// offscreen on a timer while the field is short (breeding can carry the count
// higher on its own).  Skipped while a DIFFERENT enemy is force-selected in
// the DBG enemy-test so that isolation stays clean.  O(enemies) census.
export function maintainAmbientBubbles(g: GameEngine, dt: number) {
    if (!g.currentMap || g.gameState !== GameState.PLAYING) return;
    // A DBG enemy-test forcing a single type suppresses the ambient fauna so
    // that type is seen in isolation.
    if (g.forcedTestEnemy) return;

    let count = 0;
    const enemies = g.entityIndex.enemies;
    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.enemySubtype === EnemySubtype.BUBBLE && e.active && !e.isExploding) count++;
    }
    if (count >= BUBBLE_CONSTANTS.AMBIENT_POPULATION) {
        g.ambientBubbleTimer = BUBBLE_CONSTANTS.AMBIENT_RESPAWN_INTERVAL;
        return;
    }
    g.ambientBubbleTimer -= dt;
    if (g.ambientBubbleTimer > 0) return;
    g.ambientBubbleTimer = BUBBLE_CONSTANTS.AMBIENT_RESPAWN_INTERVAL;
    spawnAmbientBubble(g);
}

/** Seed the ambient bubble population in one shot (called on entering play so
 *  the fauna is present from the first frame, not trickled in). */
export function seedAmbientBubbles(g: GameEngine) {
    if (!g.currentMap || g.forcedTestEnemy) return;
    for (let i = 0; i < BUBBLE_CONSTANTS.AMBIENT_POPULATION; i++) spawnAmbientBubble(g);
    g.ambientBubbleTimer = BUBBLE_CONSTANTS.AMBIENT_RESPAWN_INTERVAL;
}

/** Spawn one ambient bubble just outside the viewport (so it drifts in rather
 *  than popping into view).  counts=false + the `ambient` variant flag keep it
 *  out of wave accounting. */
function spawnAmbientBubble(g: GameEngine): GameEntity | null {
    const ctx = g.waveContext();
    if (!ctx) return null;
    const zoom = g.camera.zoom || 1;
    const halfDiag = Math.hypot((window.innerWidth / 2) / zoom, (window.innerHeight / 2) / zoom);
    const angle = Math.random() * Math.PI * 2;
    const dist = halfDiag + BUBBLE_CONSTANTS.SPAWN_MARGIN + Math.random() * 240;
    const pos = {
        x: g.player.position.x + Math.cos(angle) * dist,
        y: g.player.position.y + Math.sin(angle) * dist,
    };
    wrapPosition(pos);
    return g.waves.spawnAt(EnemySubtype.BUBBLE, pos, ctx, false);
}
// ─── Attach pass (Stage 3c) ────────────────────────────────────────────
//
// Snap every attached entity onto its target each frame (a latch / grapple).
// Runs in updateGameLogic AFTER physics so it tracks the target's post-move
// position.  If the target is gone (dead / inactive / missing) the attachment
// releases.  Iterates the (small) enemies index — the only attachers today
// are enemies (the bubble grappling the player); revisit if a non-enemy ever
// needs to attach.
export function updateAttachments(g: GameEngine) {
    const ents = g.entityIndex.enemies;
    for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        if (!e.active || e.attachedToId === undefined) continue;
        // Attachment targets are the player or an enemy (the bubble latch), so
        // resolve through the player special-case + the small enemies index
        // rather than a full O(all-entities) master-list scan.
        const target = resolveAggroTarget(g, e.attachedToId);
        if (!target || !target.active || target.isExploding) {
            e.attachedToId = undefined;
            continue;
        }
        e.position.x = target.position.x + (e.attachOffset?.x ?? 0);
        e.position.y = target.position.y + (e.attachOffset?.y ?? 0);
        wrapPosition(e.position);
        e.velocity.x = target.velocity.x;
        e.velocity.y = target.velocity.y;
    }
}

// ─── Consume-and-grow pass (Stage 3b) ──────────────────────────────────
//
// For each consumer (an entity carrying a `consume` config — the bubble; the
// dragon later), two-phase feeding within the SENSE radius (`cfg.range`):
// mobile candidates outside membrane contact are PULLED inward (a suck-in tug,
// `cfg.pull`), and a candidate that has reached MEMBRANE CONTACT (radii
// overlap) is SWALLOWED — grow + animate (consumeEntity).  This replaces the
// old eat-on-sight-at-range so shards visibly stream in and pop on contact
// instead of vanishing from afar.  PerfController-gated ('consume');
// torus-correct.  Growth is capped at `cfg.maxSize`; the self-replication
// entity cap lives at the child-spawn site (updateBubbles, Stage 5).
export function updateConsumers(g: GameEngine, dt: number) {
    if (!g.currentMap) return;
    const enemies = g.entityIndex.enemies;
    // Candidates: mobile shards (asteroids index) and/or static tiles.
    const shards = g.entityIndex.shardCandidates;
    for (let c = 0; c < enemies.length; c++) {
        const consumer = enemies[c];
        const cfg = consumer.consume;
        if (!cfg || !consumer.active || consumer.isExploding) continue;
        // Only a calm, idle bubble feeds: a hunting (provoked), latched,
        // digesting, or SICK bubble doesn't pull or capture shards.
        if ((consumer.bubbleDigestTimer ?? 0) > 0 || consumer.attachedToId !== undefined
            || consumer.provoked || (consumer.bubbleSickTimer ?? 0) > 0) continue;
        const rangeSq = cfg.range * cfg.range;
        const consumerR = Math.max(consumer.size.x, consumer.size.y) * 0.6; // membrane radius
        // MOUTH SIZE (user call).  A bubble used to engulf anything its
        // membrane touched, so a 15-unit blob swallowed a 160-unit boulder in
        // one action.  A body is swallowable only up to `swallowMaxFrac` of
        // the consumer's OWN diameter; past that it is BITTEN (below), which
        // chips a grain off through the shared fracture path and leaves a
        // mouth-sized piece behind.  Absent config = the old no-limit mouth.
        const mouth = cfg.swallowMaxFrac === undefined
            ? Infinity
            : Math.max(consumer.size.x, consumer.size.y) * cfg.swallowMaxFrac;
        // One bite per cadence, and the STATIC query below only runs on a
        // frame the consumer could actually bite — so a field of bubbles
        // costs one spatial walk each per BITE_INTERVAL, not per step.
        const canBite = cfg.bite !== undefined && (consumer.bubbleBiteTimer ?? 0) <= 0;
        let bit = false;
        for (let k = 0; k < shards.length; k++) {
            const cand = shards[k];
            if (!cand.active || cand.isExploding) continue;
            const wantTile = cfg.eats === 'tile';
            const isTile = cand.mass === Infinity;
            if (wantTile !== isTile) continue;
            const dx = wrapDeltaX(consumer.position.x, cand.position.x); // consumer→cand
            const dy = wrapDeltaY(consumer.position.y, cand.position.y);
            const d2 = dx * dx + dy * dy;
            if (d2 > rangeSq) continue;
            const candR = Math.max(cand.size.x, cand.size.y) * 0.5;
            const contact = consumerR + candR;
            const fits = Math.max(cand.size.x, cand.size.y) <= mouth;
            if (d2 <= contact * contact) {
                // SWALLOW on membrane contact.  Mobile shards are engulfed and
                // DIGESTED over time (held inside the bubble); static tiles
                // (the future dragon) are eaten instantly.
                if (isTile) consumeTile(g, consumer, cand, cfg, dx, dy);
                else if (fits) { beginDigest(g, consumer, cand, dx, dy); break; }
                else if (canBite && !bit) { bit = biteBody(g, consumer, cand, cfg.bite!); if (bit) break; }
            } else if (!isTile && cfg.pull && fits) {
                // Suck-in: tug the mobile shard toward the membrane, stronger
                // the closer it is (so a near shard accelerates into the mouth).
                // Only what it can actually SWALLOW — dragging a boulder it can
                // only nibble at would read as trying to eat it.
                const d = Math.sqrt(d2) || 1;
                const prox = 1 - d / cfg.range;          // 0 at the rim → 1 at contact
                const a = cfg.pull * (0.3 + 0.7 * prox) * dt;
                cand.velocity.x -= (dx / d) * a;
                cand.velocity.y -= (dy / d) * a;
            }
        }

        // ── Gnaw a STATIC tile ──────────────────────────────────────────
        // Tiles are never swallowable and never appear in the shard index
        // (EntityIndex keeps mobile bodies only), so a shard-eater cannot see
        // them at all.  A biter can: same chip, taken off the tile in place.
        if (canBite && !bit && cfg.bite!.tiles) biteNearbyTile(g, consumer, consumerR, cfg.bite!);
    }
}

/** Take one chip out of a body too big to swallow, through the engine's
 *  shared grain-fracture seam.  The contact point is put ON the target's
 *  surface along the line from the consumer, so the chip comes off the side
 *  actually being bitten rather than somewhere arbitrary.
 *
 *  Returns false — and burns no cadence — when the body cannot be chipped at
 *  all (indestructible, nebula, or the DBG legacy fracture mode), so a bubble
 *  parked against an unbreakable wall is not stuck pretending to eat it. */
function biteBody(
    g: GameEngine, consumer: GameEntity, target: GameEntity,
    bite: { damage: number; interval: number; reach: number; tiles: boolean },
): boolean {
    const dx = wrapDeltaX(consumer.position.x, target.position.x); // consumer→target
    const dy = wrapDeltaY(consumer.position.y, target.position.y);
    const d = Math.hypot(dx, dy) || 1;
    const surface = Math.max(target.size.x, target.size.y) * 0.5;
    const at = {
        x: target.position.x - (dx / d) * surface,
        y: target.position.y - (dy / d) * surface,
    };
    wrapPosition(at);
    if (!g.chipStructureAt(target, at, bite.damage, consumer.position)) return false;
    consumer.bubbleBiteTimer = bite.interval;
    consumer.bubbleFeedTimer = BUBBLE_CONSTANTS.FEED_PULSE; // the membrane works at it
    g.spawnParticles(at, 4, target.color || '#a8a29e', {
        speedMin: 1.5, speedMax: 4, sizeMin: 0.8, sizeMax: 1.8,
        lifetimeMin: 0.12, lifetimeMax: 0.3,
    });
    return true;
}

/** Find the nearest static tile in biting contact and take a chip out of it.
 *  Uses the same reusable-buffer static walk the dragon's tile-devour uses,
 *  and only ever runs on a frame the consumer's bite cadence is ready. */
function biteNearbyTile(
    g: GameEngine, consumer: GameEntity, consumerR: number,
    bite: { damage: number; interval: number; reach: number; tiles: boolean },
): void {
    const buf = g._bubbleBiteBuf;
    buf.length = 0;
    const reach = consumerR + bite.reach;
    g.physics.forEachStaticNear(consumer.position.x, consumer.position.y, reach + 80, (t) => buf.push(t));
    let best: GameEntity | null = null;
    let bestD2 = Infinity;
    for (let i = 0; i < buf.length; i++) {
        const t = buf[i];
        if (!t.active || t.isExploding) continue;
        // Skip what cannot be chipped at all (indestructible, nebula, or any
        // variant under the DBG legacy fracture mode) rather than discovering
        // it inside `chipStructureAt`: an unbiteable neighbour would otherwise
        // never burn the cadence, and this walk would re-run every tick for as
        // long as the bubble sat beside it.
        if (t.shardVariant === undefined || !isProgressiveFracture(t.shardVariant)) continue;
        const dx = wrapDeltaX(consumer.position.x, t.position.x);
        const dy = wrapDeltaY(consumer.position.y, t.position.y);
        const d2 = dx * dx + dy * dy;
        const contact = reach + Math.max(t.size.x, t.size.y) * 0.5;
        if (d2 > contact * contact || d2 >= bestD2) continue;
        bestD2 = d2; best = t;
    }
    buf.length = 0;
    // Found nothing worth biting: still arm the cadence, so this spatial walk
    // costs one visit per interval per bubble and not one per consume tick.
    if (best === null) consumer.bubbleBiteTimer = bite.interval;
    else biteBody(g, consumer, best, bite);
}

/** Grow a consumer by one eat (size + heal + optional mass), scaled by `scale`
 *  (the shard's richness — mass/energy conserved), capped at maxSize.  Shared
 *  by the shard-digest finish + the instant tile eat.  (The bubble's maxHealth
 *  is recomputed from its new size by syncBubbleMaxHealth, called after.) */
function growConsumer(consumer: GameEntity, cfg: ConsumeConfig, scale: number = 1) {
    const cur = Math.max(consumer.size.x, consumer.size.y);
    if (cur < cfg.maxSize) {
        const grown = Math.min(cfg.maxSize, cur + cfg.growthPerEat * scale);
        const s = grown / (cur || 1);
        consumer.size.x *= s;
        consumer.size.y *= s;
    }
    // Heal from eating (a denser meal heals more) — caps at the current maxHP;
    // size-driven maxHP growth is applied by syncBubbleMaxHealth afterwards.
    consumer.health = Math.min(consumer.maxHealth, consumer.health + BUBBLE_CONSTANTS.HEAL_PER_RICH * scale);
    if (cfg.massPerEat && consumer.mass !== Infinity) consumer.mass += cfg.massPerEat * scale;
}

/** Keep a bubble's maxHealth LINEAR with its size (anchored at the variant's
 *  base health @ base size).  Growing raises the ceiling AND fills the new HP
 *  (mass conserved); shrinking on a split caps current HP to the new ceiling. */
export function syncBubbleMaxHealth(e: GameEntity) {
    const v = ENEMY_VARIANTS[EnemySubtype.BUBBLE];
    const newMax = v.health * (Math.max(e.size.x, e.size.y) / v.size);
    const delta = newMax - e.maxHealth;
    e.maxHealth = newMax;
    e.health = delta > 0 ? Math.min(newMax, e.health + delta) : Math.min(e.health, newMax);
}

/** Begin digesting a mobile shard: snapshot its look onto the bubble, swallow
 *  it (deactivate), and spray a brief inward implosion.  Digest TIME scales
 *  with the shard's richness (denser = slower), stored on the bubble so the
 *  finish (updateBubbles) recovers the same richness for the heal/grow.  A
 *  TOXIC shard (plastic / green-nebula) also makes the bubble sick.  The bubble
 *  renders the shard as a shrinking ghost INSIDE its membrane until done.
 *  `dx/dy` is consumer→shard. */
function beginDigest(g: GameEngine, consumer: GameEntity, shard: GameEntity, dx: number, dy: number) {
    const rich = shardRichness(shard);
    const dur = BUBBLE_CONSTANTS.DIGEST_DURATION * rich;
    consumer.bubbleDigestTimer = dur;
    consumer.bubbleDigestDuration = dur;
    consumer.bubbleDigestColor = shard.color || '#a8a29e';
    consumer.bubbleDigestSize0 = Math.max(shard.size.x, shard.size.y);
    consumer.bubbleFeedTimer = BUBBLE_CONSTANTS.FEED_PULSE;
    if (isToxicShard(shard)) consumer.bubbleSickTimer = BUBBLE_CONSTANTS.SICK_DURATION;
    const inward = Math.atan2(-dy, -dx); // shard → bubble
    g.spawnParticles(shard.position, 8, consumer.bubbleDigestColor, {
        spreadAngle: inward, spreadCone: 0.8,
        speedMin: 2.5, speedMax: 6, sizeMin: 1, sizeMax: 2.4,
        lifetimeMin: 0.1, lifetimeMax: 0.26,
    });
    shard.active = false; // swallowed (no score/regen — it's eaten, not destroyed)
}

/** Instant tile eat (the future dragon): grow + route the tile through the
 *  death/flow-field patch + an inward implosion.  `dx/dy` is consumer→tile. */
function consumeTile(g: GameEngine, consumer: GameEntity, tile: GameEntity, cfg: ConsumeConfig, dx: number, dy: number) {
    growConsumer(consumer, cfg);
    const inward = Math.atan2(-dy, -dx);
    g.spawnParticles(tile.position, 9, tile.color || '#a8a29e', {
        spreadAngle: inward, spreadCone: 0.9,
        speedMin: 2.5, speedMax: 6.5, sizeMin: 1, sizeMax: 2.6,
        lifetimeMin: 0.12, lifetimeMax: 0.3,
    });
    consumer.bubbleFeedTimer = BUBBLE_CONSTANTS.FEED_PULSE;
    g.physics.removeStaticEntity(tile);
    g.flowField.onTileDestroyed(tile.position.x, tile.position.y);
    tile.active = false;
}
