/** BOSSES — the wave-arena capstones ((h)).
 *
 *  Extracted verbatim from `GameEngine` in gauntlet 5f (see
 *  `docs/GAUNTLET_5F_LOG.md`); plain free functions taking `g: GameEngine`,
 *  with `GameEngine` imported as a TYPE so it is erased at compile time and
 *  there is no runtime cycle.
 *
 *  A boss is an ORDINARY counted wave enemy with a `BOSS_DEFS` phase table —
 *  that is the whole framework, and it is why nothing in this file is a
 *  bespoke script.  What lives here is the bookkeeping around it: stamp the
 *  phase whose health gate the boss has fallen past, keep the live-boss handle
 *  the HUD bar reads, and pay the capstone bounty (score + a physical salvage
 *  spray + a module into the inventory) with the stage-clear beat and the
 *  descent rift that follow it.
 *
 *  Deliberately NOT here: `handleBossSpawn` (the WaveSystem callback wiring
 *  the engine hands to `waveContext`), `debugSpawnBoss` (public API), and
 *  `updateEnemyRegen` — the last is a generic counterplay-trait pass that any
 *  enemy can carry, not a boss mechanism, so filing it under bosses would be
 *  a misfile.
 */
import type { GameEngine } from './GameEngine';
import { GameEntity, EntityType, EnemySubtype, EngineStats, Vector2 } from '../types';
import {
    BOSS_CONSTANTS, BOSS_DEFS, BossDef, ENEMY_VARIANTS, COLLISION_CONFIG,
    WAVE_ANNOUNCE_CONSTANTS, MODULE_DEFS, PORTAL_CONSTANTS, HUB_PORTAL_SITES,
    SALVAGE_CONSTANTS,
} from '../constants';
import { MAP_DESCRIPTORS } from './maps/MapDescriptors';
import { wrapPosition } from './toroidal';
import { nextId } from './systems/IdAllocator';

/** Live-boss HUD readout — undefined when no boss is alive, so the HUD bar
 *  simply isn't rendered.  Cheap: `liveBoss` is maintained by updateBosses,
 *  so this is a couple of divisions per stats push. */
export function bossStatsSnapshot(g: GameEngine): EngineStats['boss'] {
    const b = g.liveBoss;
    if (!b || !b.active || b.isExploding) return undefined;
    const def = b.enemySubtype ? BOSS_DEFS[b.enemySubtype] : undefined;
    return {
        name: def?.name ?? 'BOSS',
        healthFrac: Math.max(0, Math.min(1, b.health / Math.max(1, b.maxHealth))),
        shieldFrac: (b.maxShield ?? 0) > 0
            ? Math.max(0, Math.min(1, (b.shield ?? 0) / b.maxShield!)) : 0,
        phase: Math.max(0, b.bossPhase ?? 0),
        phaseCount: def?.phases.length ?? 1,
        color: b.color || '#f87171',
    };
}

/**
 * Boss phase pass.  Walks the enemy index (a wave has one boss, but the DBG
 * menu can stack several) and, for each, finds the deepest BOSS_DEFS phase
 * whose `atHealthFrac` gate it has fallen past.  If that isn't the applied
 * phase, STAMP it.
 *
 * Every phase field lands on machinery that already exists — the weapon
 * override merges in WeaponSystem, the shield rides the generalized
 * absorption path, the spawner rides updateNests, the traits ride the
 * PhysicsSystem damage path.  Nothing here is a bespoke boss script, which
 * is the whole point of the framework (guardrail #36e).
 *
 * O(enemies) with an early flag check and no work on a non-transition step,
 * so it stays ungated like the kamikaze / nest passes.
 */
export function updateBosses(g: GameEngine, dt: number) {
    // Timed shop discount (payout model (d)) — run-scoped, ticks on sim time
    // so it doesn't drain while docked or paused.
    if (!g.currentMap) return;
    const enemies = g.entityIndex.enemies;
    let live: GameEntity | null = null;
    for (let i = 0; i < enemies.length; i++) {
        const b = enemies[i];
        if (b.isBoss !== true || !b.active || b.isExploding) continue;
        // The HUD bar tracks the most-wounded live boss (the one being fought).
        if (!live || (b.health / Math.max(1, b.maxHealth)) < (live.health / Math.max(1, live.maxHealth))) live = b;

        const def = b.enemySubtype ? BOSS_DEFS[b.enemySubtype] : undefined;
        if (!def) continue;
        const frac = b.health / Math.max(1, b.maxHealth);
        let want = 0;
        for (let p = 0; p < def.phases.length; p++) {
            if (frac <= def.phases[p].atHealthFrac) want = p;
        }
        if (b.bossPhase === want) continue;
        applyBossPhase(g, b, def, want);
    }
    g.liveBoss = live;
}

/** Stamp one BOSS_DEFS phase onto a boss.  Fields ABSENT from the phase are
 *  CLEARED (a phase can drop a shield or stop escorts), so a phase is a full
 *  description of the boss's current state rather than a patch. */
function applyBossPhase(g: GameEngine, boss: GameEntity, def: BossDef, index: number) {
// A phase change must interrupt the fight's rhythm — index 0 is the
// spawn stamp, so only real transitions sound.
if (index > 0) g.audio.play('boss.phase', { x: boss.position.x, y: boss.position.y });
    const phase = def.phases[index];
    const first = boss.bossPhase === undefined || boss.bossPhase < 0;
    boss.bossPhase = index;

    const arch = boss.enemySubtype ? ENEMY_VARIANTS[boss.enemySubtype] : undefined;
    if (phase.color) boss.color = phase.color;
    if (arch) boss.maxSpeed = arch.maxSpeed * (phase.speedMult ?? 1);
    boss.weaponOverride = phase.weapon;
    boss.spawner = phase.spawner;
    boss.spawnTimer = phase.spawner ? phase.spawner.interval * 0.35 : undefined;

    // Traits REPLACE the previous phase's set — a defence can be traded away.
    boss.armor = phase.traits?.armor;
    boss.evasive = phase.traits?.evasive;
    if (!boss.evasive) boss.dodgeTimer = undefined;
    boss.frontShield = phase.traits?.frontShield;
    boss.regen = phase.traits?.regen;
    if (!boss.regen) {
        boss.regenBucket = undefined;
        boss.regenBucketTimer = undefined;
        boss.regenBurnTimer = undefined;
    }

    // Shield: raise / re-arm, or drop it entirely when the phase has none.
    if (phase.shield) {
        boss.shield = phase.shield.amount;
        boss.maxShield = phase.shield.amount;
        boss.shieldRechargeRate = phase.shield.regen;
        boss.shieldRechargeTimer = 0;
        if (phase.shield.arc) {
            boss.shieldArcHalfWidth = (phase.shield.arc.deg * Math.PI / 180) / 2;
            boss.shieldArcSpin = phase.shield.arc.slew;
            boss.shieldArcAngle = boss.rotation;
        } else {
            boss.shieldArcHalfWidth = undefined;
            boss.shieldArcSpin = undefined;
        }
    } else {
        boss.shield = undefined;
        boss.maxShield = undefined;
        boss.shieldArcHalfWidth = undefined;
        boss.shieldArcSpin = undefined;
    }

    // Phase-transition beat — skipped on the INITIAL stamp (phase 0 applies on
    // the boss's first tick, and the entrance rift already sold that).
    if (first) return;
    if (phase.announce) {
        const life = WAVE_ANNOUNCE_CONSTANTS.FADEIN + WAVE_ANNOUNCE_CONSTANTS.HOLD + WAVE_ANNOUNCE_CONSTANTS.FADEOUT;
        g.waves.announcements.push({
            text: phase.announce,
            subtext: `PHASE ${index + 1}`,
            color: phase.color ?? '#f87171',
            lifetime: life,
            maxLifetime: life,
        });
    }
    g.spawnShockwave(boss.position, {
        radius: Math.max(boss.size.x, boss.size.y) * 3,
        damage: 0, knockback: 0,
        color: phase.color ?? '#f87171',
        lifetime: 0.5,
    });
    g.handleScreenShake(COLLISION_CONFIG.SHAKE.MEDIUM);
}

/**
 * Boss kill payout — WEAPONS_AMMO_PLAN §6 model (d): SALVAGE + a timed SHOP
 * DISCOUNT.  Deliberately NO weapon unlock: weapons stay purely purchased and
 * the boss is an income accelerator that funds (or cheapens) the next shop
 * run.  Called from handleEntityDeath alongside the normal enemy death path,
 * which still runs — a boss explodes, pays kill points and sprays enemy
 * shards like any other enemy.
 */
export function payBossBounty(g: GameEngine, boss: GameEntity) {
g.audio.play('boss.death');
    g.bossesKilled++;
    g.awardScore(BOSS_CONSTANTS.SCORE, boss.position);
    // Stack the discount fraction (capped) and refresh the window.
    // The money is PHYSICAL — the same salvage drops every other source pays,
    // sprayed off the corpse so it converges and merges normally.
    for (let i = 0; i < BOSS_CONSTANTS.SALVAGE_DROPS; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = 30 + Math.random() * 140;
        g.spawnSalvageDrop({
            x: boss.position.x + Math.cos(a) * d,
            y: boss.position.y + Math.sin(a) * d,
        });
    }
    // ── The payoff moment ──────────────────────────────────────────────
    // Same beat the dragon gets (dragonDeath is the precedent): a rift
    // COLLAPSE where the entrance rift opened, a debris burst in the boss's
    // phase colour, and a heavy shake — layered on top of the normal enemy
    // explosion the death path still runs.  All existing machinery.
    g.openPortal(boss.position, {
        color: boss.color || '#f87171',
        radius: BOSS_CONSTANTS.PORTAL_RADIUS,
        duration: BOSS_CONSTANTS.PORTAL_DURATION,
    });
    g.spawnParticles(boss.position, BOSS_CONSTANTS.DEATH_DEBRIS, boss.color || '#f87171', {
        speedMin: 3, speedMax: 15, sizeMin: 2, sizeMax: 6,
        lifetimeMin: 0.4, lifetimeMax: 1.1,
    });
    g.spawnParticles(boss.position, Math.round(BOSS_CONSTANTS.DEATH_DEBRIS * 0.4), '#ffffff', {
        speedMin: 6, speedMax: 20, sizeMin: 1, sizeMax: 2.5,
        lifetimeMin: 0.25, lifetimeMax: 0.6,
    });
    g.handleScreenShake(COLLISION_CONFIG.SHAKE.HEAVY);

    // Name the kill and its payout — the banner is what tells the player the
    // capstone is DOWN and that the shop just got cheaper, which is
    // otherwise only legible by opening a station menu.
    // The DROP-COUNT payout in real money, so the banner and the screen
    // speak the same units the shop does.
    const salvageCredits = BOSS_CONSTANTS.SALVAGE_DROPS * SALVAGE_CONSTANTS.CREDITS_PER_DROP;
    // Capstone reward (user call, replaces the timed shop discount): a
    // RANDOM module item — something you carry away and install, rather than
    // a countdown you may not be near a shop to spend.
    const reward = grantBossModule(g);
    const def = boss.enemySubtype ? BOSS_DEFS[boss.enemySubtype] : undefined;
    const life = WAVE_ANNOUNCE_CONSTANTS.FADEIN + WAVE_ANNOUNCE_CONSTANTS.HOLD + WAVE_ANNOUNCE_CONSTANTS.FADEOUT;
    g.waves.announcements.push({
        text: `${def?.name ?? 'BOSS'} DESTROYED`,
        subtext: reward.label
            ? `+◈${salvageCredits.toLocaleString()}  ·  ${reward.label.toUpperCase()}`
            : `+◈${salvageCredits.toLocaleString()} SALVAGE`,
        color: boss.color || '#f87171',
        lifetime: life,
        maxLifetime: life,
    });
    if (g.liveBoss === boss) g.liveBoss = null;

    // ── The capstone's death ROUTS its forces ──────────────────────────
    // Killing the boss wipes every enemy still standing, each through the
    // FULL death path at FULL value (user call) — so the escort explodes,
    // pays its kill points and sprays its salvage rather than being
    // silently deleted or left to be mopped up after the fight is over.
    // Mechanically this is the snitch board-clear (catchSnitch), minus the
    // half-value scale.  NEUTRAL third parties (bubbles, dragons) and
    // RIVALS are spared: they are not the boss's forces, and a capstone
    // should not vacuum the ambient fauna off the map.  Snapshot the count
    // first so the shards/particles those deaths append aren't re-scanned.
    if (g.currentMap) {
        const ents = g.currentMap.entities;
        const n = ents.length;
        for (let i = 0; i < n; i++) {
            const e = ents[i];
            if (e !== boss && e.type === EntityType.ENEMY && e.active && !e.isExploding
                && !e.thirdParty && !e.isRival) {
                g.handleEntityDeath(e);
            }
        }
    }

    // ── Stage cleared ──────────────────────────────────────────────────
    // Open the DESCENT rift beside the wreck and raise the stage-clear
    // screen.  Only on a real wave capstone: a DBG-spawned boss on the hub
    // (or any wave-free map) has no ladder to descend from.
    if (g.wavesEnabled) {
        // The stage's ladder is FINISHED — no further wave starts in this
        // arena.  Whatever is still on the field stays (the player mops up),
        // but the arena stops feeding the fight so the choice between the
        // two rifts is made in quiet.
        g.waves.halted = true;
        // NO DESCENT RIFT for now (user call — the descent flow is being
        // reworked).  The arena's own RETURN rift is untouched, so the way
        // out of a cleared stage is the way you came in.  Everything the
        // descent needs on the other side is intact and still tested:
        // `transitionToMap(id, { descend: true })` steps `stageIndex` and
        // the wave offset, `GameEntity.isDescent` and the amber portal
        // colours still exist, and `openDescentPortal` below is kept
        // verbatim for the same reason — what was removed is the one CALL
        // that puts a rift in the world, not the mechanism behind it.
        g.lastStageClear = {
            stage: g.stageIndex + 1,
            bossName: def?.name ?? 'Boss',
            nextStage: g.stageIndex + 2,
            scoreAwarded: BOSS_CONSTANTS.SCORE,
            salvageCredits,
            rewardLabel: reward.label,
            rewardDesc: reward.desc,
            rewardCredits: reward.credits,
        };
        // Arm the beat rather than freezing on the killing blow.
        g.stageClearDelay = BOSS_CONSTANTS.STAGE_CLEAR_DELAY_SEC;
    }
}

/** Capstone reward: one RANDOM purchasable module dropped straight into the
 *  inventory (user call — it replaced the timed shop discount, which asked
 *  the player to be near a shop within a countdown to collect anything).
 *
 *  Uniform over the catalog, which is PROVISIONAL: it can hand a Mk III on
 *  stage 1.  Weighting by stage depth is a tuning-pass question.
 *
 *  If the inventory is full there is nowhere to put it, so the reward pays
 *  its catalog value in Salvage instead — the player is never simply denied
 *  the drop for having full cargo. */
function grantBossModule(g: GameEngine): { label?: string; desc?: string; credits?: number } {
    const catalog = MODULE_DEFS.filter(d => d.cost > 0);
    if (catalog.length === 0) return {};
    const def = catalog[Math.floor(Math.random() * catalog.length)];
    const slot = g.inventory.indexOf(null);
    if (slot === -1) {
        const paid = g.modulePrice(def.cost);
        g.earnCredits(paid);
        return { credits: paid };
    }
    g.inventory[slot] = def.id;
    return { label: def.label, desc: def.desc };
}

/** The way DOWN: a descent rift beside the fallen boss, targeting a fresh
 *  arena for the next stage.
 *
 *  The destination is a RANDOM arena descriptor (user call).  The existing
 *  maps are test terrain and effectively interchangeable — this is a
 *  placeholder for the procedural areas that will eventually pick terrain,
 *  enemies and flow parameters per AREA.  What matters structurally is that
 *  the target is a descriptor id, exactly like every other portal, so
 *  swapping in a generator later changes this one line.
 *
 *  Marked `isDescent` so `enterPortal` knows to increment the depth; the
 *  arena's own return rift is untouched, which is what makes the choice
 *  in-world rather than a menu button. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- see the call
// site above: the rift is switched off pending a rework, not deleted.
function openDescentPortal(g: GameEngine, pos: Vector2) {
    if (!g.currentMap) return;
    const arenas = MAP_DESCRIPTORS.filter(d => d.kind === 'arena' && d.wavesEnabled
        && HUB_PORTAL_SITES.some(site => site.targetId === d.id));
    if (arenas.length === 0) return;
    const dest = arenas[Math.floor(Math.random() * arenas.length)];

    // Offset from the corpse so the rift doesn't sit under the debris.
    const a = Math.random() * Math.PI * 2;
    const p = {
        x: pos.x + Math.cos(a) * PORTAL_CONSTANTS.DESCENT_OFFSET,
        y: pos.y + Math.sin(a) * PORTAL_CONSTANTS.DESCENT_OFFSET,
    };
    wrapPosition(p);
    const portal: GameEntity = {
        id: nextId('portal'),
        type: EntityType.INTERACTABLE,
        isPortal: true,
        isDescent: true,
        portalTargetId: dest.id,
        name: `Stage ${g.stageIndex + 2}`,
        position: p,
        velocity: { x: 0, y: 0 },
        size: { x: PORTAL_CONSTANTS.SIZE, y: PORTAL_CONSTANTS.SIZE },
        rotation: 0,
        color: PORTAL_CONSTANTS.DESCENT_COLOR,
        active: true,
        health: 1,
        maxHealth: 1,
        mass: Infinity,
    };
    g.currentMap.entities.push(portal);
    g.portals.push(portal);
    // Arrival flourish so the rift reads as something that just OPENED.
    g.openPortal(p, {
        color: PORTAL_CONSTANTS.DESCENT_COLOR,
        radius: PORTAL_CONSTANTS.BURST_RADIUS,
        duration: PORTAL_CONSTANTS.BURST_DURATION,
    });
}
