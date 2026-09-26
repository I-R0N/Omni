/** ENERGY EFFECTS — the side-effect half of the energy pipeline.
 *
 *  `engine/systems/energy.ts` says WHAT a packet does to a material (pure
 *  tables and arithmetic); this file does it to the world.  Plain free
 *  functions taking `g: GameEngine`, like explosions.ts and the roamers, with
 *  GameEngine imported as a TYPE so there is no runtime cycle.
 *
 *  PERFORMANCE MODEL (§6), which every function here keeps:
 *
 *  - Nothing scans the map or the shard list.  Every query is a grid radius
 *    walk (`physics.forEachDynamicInRadius` / `forEachStaticInRadius`) with a
 *    hard cap on what it collects.
 *  - HEAT lives only on bodies that have some.  They sit in one bounded
 *    active set (`EnergyState.heated`, ≤ MAX_HEATED) that cooling walks; a
 *    body leaves it the moment it is cold.  A cold shard costs nothing.
 *  - ELECTRIC is instantaneous and planned by `planChain` under hop, target,
 *    radius and attenuation caps with a visited set — no recursion, no cycles.
 *  - MAGNETIC is a capped radius pulse; an ATTRACTOR is a handful of such
 *    pulses over a bounded lifetime (≤ MAX_FIELDS alive).
 *  - Events raised INSIDE the collision step (a projectile's electric or
 *    magnetic payload) are QUEUED and resolved after physics: the dynamic
 *    grid is only safe to read between substeps (CLAUDE.md §8).
 */
import type { GameEngine } from './GameEngine';
import { GameEntity, EntityType, Vector2, WeaponConfig } from '../types';
import {
    ENERGY_CONSTANTS, materialOf, responseOf, heatGain, clampHeat, coolHeat,
    mechanicalScale, magneticSusceptibility, magneticDv, planChain, safeMag,
    stampFractureProfile, diffuseSpread, mixHeatSpot, type ChainCaps, type EnergyDomain,
} from './systems/energy';
import {
    breakYieldsNothing, noteTraitDamage, markDamaged, hitReactStrength,
    isCollectibleDrop, HOMING_ACQUIRE_RANGE, LIGHTNING_ARC_LIFETIME, ENERGY_COLORS, NEBULA_CONSTANTS,
} from '../constants';
import { applyBoundaryDamage, stampLocalImpact } from './systems/fractureCache';
import { wrapDeltaX, wrapDeltaY } from './toroidal';
import { nextId } from './systems/IdAllocator';

// ── State ────────────────────────────────────────────────────────────────────

interface MagField { x: number; y: number; radius: number; strength: number; mode: 'pull' | 'push'; time: number; acc: number }
interface PendingEvent {
    kind: 'electric' | 'field';
    x: number; y: number;
    first: GameEntity | null;
    electric?: WeaponConfig['electric'];
    magnetic?: WeaponConfig['magnetic'];
    color: string;
}
interface BeamState {
    config: WeaponConfig;
    time: number;       // seconds left
    acc: number;        // time since last tick
    angle: number;      // aim, fixed at the trigger pull (a pulse goes where it was fired)
    // Drawn this frame (renderer reads).
    x0: number; y0: number; x1: number; y1: number; hit: boolean;
}

const MAX_FIELDS = 8;
const MAX_PENDING = 48;
const MAX_ENERGIZED = 200;
/** How often a heated body's slow effects (burn damage, bond release,
 *  conduction) are applied — heat itself cools every step. */
const HEAT_EFFECT_INTERVAL = 0.2;

export class EnergyState {
    heated: GameEntity[] = [];
    energized: GameEntity[] = [];
    fields: MagField[] = [];
    pending: PendingEvent[] = [];
    beam: BeamState | null = null;
    effectAcc = 0;
    conductAcc = 0;
    /** Diagnostics (tests + DBG): how many bodies the last magnetic pulse
     *  moved, and the size of the last electric chain. */
    lastMagneticCount = 0;
    lastChainSize = 0;
    lastBeamHitId: string | null = null;
    /** Reused query buffers — never allocate per query. */
    readonly buf: GameEntity[] = [];
    readonly buf2: GameEntity[] = [];

    reset(): void {
        // A body leaves the sets COLD, not merely untracked.  Nothing else
        // ever cools a body, so heat left on one outside the set would stay
        // forever — and portal transit carries debris into the next map,
        // where it would read as permanently weakened.
        for (const e of this.heated) dropHeat(e);
        for (const e of this.energized) {
            e.energizedTracked = undefined;
            e.energizedUntil = undefined;
        }
        this.heated.length = 0;
        this.energized.length = 0;
        this.fields.length = 0;
        this.pending.length = 0;
        this.beam = null;
        this.effectAcc = 0;
        this.conductAcc = 0;
    }
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** Bodies an energy effect may act on: enemies and structures (static or
 *  mobile).  Never the player, projectiles, particles, drops or POIs. */
function isEnergyTarget(e: GameEntity): boolean {
    if (!e.active || e.isExploding) return false;
    if (e.type === EntityType.ENEMY) return true;
    if (e.type !== EntityType.STRUCTURE) return false;
    return !isCollectibleDrop(e);
}

/** Fill `out` with energy targets within `r` of (x,y) — dynamic grid plus
 *  (optionally) static tiles — capped at `cap`.  Safe only between substeps. */
function gather(g: GameEngine, x: number, y: number, r: number, out: GameEntity[], cap: number, statics = true): void {
    out.length = 0;
    const R = Math.min(r, 600);
    g.physics.forEachDynamicInRadius(x, y, R, (e) => {
        if (out.length >= cap) return;
        if (isEnergyTarget(e)) out.push(e);
    });
    if (statics && out.length < cap) {
        g.physics.forEachStaticInRadius(x, y, R, (e) => {
            if (out.length >= cap) return;
            if (isEnergyTarget(e)) out.push(e);
        });
    }
}

/** Keep only the `k` bodies nearest (x,y) — so when a dense field overflows
 *  a cap, the cap drops the FAR bodies, not whichever the grid walked last. */
const _nd: number[] = [];
const _ns: number[] = [];
const byValue = (a: number, b: number) => a - b;
function nearestK(buf: GameEntity[], x: number, y: number, k: number): void {
    const m = buf.length;
    if (m <= k) return;
    // Index-fill both scratch arrays (the refill idiom — no per-call garbage).
    for (let i = 0; i < m; i++) {
        const dx = wrapDeltaX(x, buf[i].position.x), dy = wrapDeltaY(y, buf[i].position.y);
        const d = dx * dx + dy * dy;
        _nd[i] = d;
        _ns[i] = d;
    }
    if (_nd.length !== m) { _nd.length = m; _ns.length = m; }
    // Selection by threshold: find the k-th smallest distance, keep ≤ it.
    _ns.sort(byValue);
    const cut = _ns[k - 1];
    let n = 0;
    for (let i = 0; i < m && n < k; i++) if (_nd[i] <= cut) buf[n++] = buf[i];
    buf.length = n;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
    return Math.hypot(wrapDeltaX(ax, bx), wrapDeltaY(ay, by));
}

// ── Damage ───────────────────────────────────────────────────────────────────

/** A point on `e`'s hull facing `from` — where energy arriving from there
 *  lands, for the grain model's spend order. */
function contactOn(e: GameEntity, from: Vector2 | null): Vector2 {
    if (!from) return { x: e.position.x, y: e.position.y };
    const dx = wrapDeltaX(e.position.x, from.x), dy = wrapDeltaY(e.position.y, from.y);
    const d = Math.hypot(dx, dy) || 1;
    const r = Math.max(e.size.x, e.size.y) * 0.45;
    return { x: e.position.x + (dx / d) * r, y: e.position.y + (dy / d) * r };
}

function killBody(g: GameEngine, e: GameEntity, from: Vector2 | null, byPlayer: boolean, dmg: number): void {
    if (e.isExploding || e.deathDispatched) return;
    e.lastImpactDamage = Math.max(1, Math.min(5, dmg));
    if (byPlayer) e.killedByPlayer = true;
    if (e.type === EntityType.STRUCTURE) {
        if (from && !e.lastImpactVelocity) {
            const dx = wrapDeltaX(from.x, e.position.x), dy = wrapDeltaY(from.y, e.position.y);
            const d = Math.hypot(dx, dy) || 1;
            e.lastImpactVelocity = { x: (dx / d) * 4, y: (dy / d) * 4 };
        }
        if (e.mass === Infinity) g.physics.removeStaticEntity(e);
    }
    e.health = Math.min(e.health, 0);
    g.handleEntityDeath(e);
    if (e.type === EntityType.STRUCTURE) e.active = false;
}

/**
 * Put `dmg` (damage units) into a body by energy of `domain`.  The ONE damage
 * entry point for the energy layer, so every energy lands the same way:
 *
 *  - NEBULA takes no damage — it is not a solid (§8); callers displace or
 *    energise it instead.  Unbreakable bodies (indestructible) take none.
 *  - MECHANICAL energy is scaled by the body's heat (`mechanicalScale`): the
 *    threshold drop that makes heat-then-hit work, with no combo bookkeeping.
 *  - The event's FRACTURE PROFILE is stamped before the damage, so a break
 *    takes the character of what broke it.
 *  - A grain body spends it on its boundaries from the contact side and may
 *    shed a grain (the ordinary chip path); anything else loses health.
 */
export function damageBody(g: GameEngine, e: GameEntity, dmg: number, from: Vector2 | null,
                           domain: EnergyDomain, byPlayer: boolean, text = true): void {
    if (!e.active || e.isExploding) return;
    let d = safeMag(dmg);
    if (d <= 0) return;
    const mat = materialOf(e);
    if (mat === 'nebula') return;
    if (e.type === EntityType.STRUCTURE && breakYieldsNothing(e.shardVariant)) return;
    if (domain === 'mechanical') d *= mechanicalScale(mat, e.heat);
    stampFractureProfile(e, domain, d);

    if (e.type === EntityType.STRUCTURE) {
        const at = contactOn(e, from);
        if (byPlayer && d >= e.health) e.killedByPlayer = true;
        if (!g.chipStructureAt(e, at, d, from ?? undefined)) {
            stampLocalImpact(e, at);
            if (!applyBoundaryDamage(e, d)) e.health -= d;
            markDamaged(e, 0.12);
        }
        if (text) g.spawnDamageText(e.position, d, e);
        if (e.health <= 0) {
            killBody(g, e, from, byPlayer, d);
            // The chip path ends a body through `handleEntityDeath` alone,
            // which neither drops a static tile from the grid nor retires the
            // entity — both the ring and `killByFracture` do that themselves.
            if (e.mass === Infinity && e.active) g.physics.removeStaticEntity(e);
            e.active = false;
        }
        return;
    }
    // Actors (enemies).  Like the old lightning chain and the blast ring, an
    // energy effect that never travels as a projectile bypasses the
    // projectile-only defences (front shield plate).
    e.health -= d;
    if (e.type === EntityType.ENEMY) e.provoked = true;
    if (byPlayer) noteTraitDamage(e, d);
    markDamaged(e, 0.12);
    e.hitReact = hitReactStrength(d, e.maxHealth ?? e.health);
    if (text) g.spawnDamageText(e.position, d, e);
    if (e.health <= 0) killBody(g, e, from, byPlayer, d);
}

// ── Thermal ──────────────────────────────────────────────────────────────────

/** Admit a body to the heated set.  False when the set is full — and the
 *  callers then deposit NOTHING: the set is the only thing that cools a
 *  body, so heat on a body outside it would never leave. */
/** Leave the heated set COLD.  Untracked must mean unheated, because the
 *  set is the only thing that ever cools a body. */
function dropHeat(e: GameEntity): void {
    e.heat = undefined;
    e.burnTimer = undefined;
    e.burnRate = undefined;
    e.heatByPlayer = undefined;
    e.heatTracked = undefined;
    e.heatSpotX = undefined;
    e.heatSpotY = undefined;
    e.heatSpread = undefined;
}

// ── Where the heat sits (presentation) ───────────────────────────────────────

const _spot = { x: 0, y: 0, spread: 0 };

/** Body radius the hot spot diffuses within (and caps at twice, by which
 *  point it is uniform across the body). */
function heatBodyR(e: GameEntity): number {
    return Math.max(e.size.x, e.size.y) * 0.5;
}

/** Fold a deposit of `gain` landing at world point `at` (null = no direction:
 *  spread evenly) into the body's hot spot.  Must run BEFORE `e.heat` takes
 *  the gain, since the merge weights by the heat already there. */
function addHeatSpot(e: GameEntity, gain: number, at: Vector2 | null): void {
    const R = heatBodyR(e);
    let px = 0, py = 0, s0 = R;
    if (at) {
        const dx = wrapDeltaX(e.position.x, at.x), dy = wrapDeltaY(e.position.y, at.y);
        const cs = Math.cos(-(e.rotation || 0)), sn = Math.sin(-(e.rotation || 0));
        px = dx * cs - dy * sn;
        py = dx * sn + dy * cs;
        // The initial spot: small against the body, never a pinpoint.
        s0 = Math.max(3, R * 0.2);
    }
    const h = e.heat ?? 0;
    if (!(h > 0) || e.heatSpread === undefined) {
        e.heatSpotX = px; e.heatSpotY = py; e.heatSpread = s0;
        return;
    }
    mixHeatSpot(h, e.heatSpotX ?? 0, e.heatSpotY ?? 0, e.heatSpread, gain, px, py, s0, _spot);
    e.heatSpotX = _spot.x; e.heatSpotY = _spot.y; e.heatSpread = _spot.spread;
}

function trackHeat(s: EnergyState, e: GameEntity): boolean {
    if (e.heatTracked) return true;
    if (s.heated.length >= ENERGY_CONSTANTS.MAX_HEATED) return false;
    e.heatTracked = true;
    s.heated.push(e);
    return true;
}

/** Deposit a THERMAL packet.  Heat accumulates (normalised per material),
 *  the body joins the bounded active set, and threshold behaviours that
 *  should read as immediate (glass failing, plastic letting go) are checked
 *  now rather than a tick later. */
export function depositHeat(g: GameEngine, e: GameEntity, magnitude: number, from: Vector2 | null, byPlayer: boolean): void {
    if (!e.active || e.isExploding) return;
    const mat = materialOf(e);
    const gain = heatGain(mat, magnitude);
    if (gain <= 0) return;
    if (!trackHeat(g.energy, e)) return;
    const at = from ? contactOn(e, from) : null;
    addHeatSpot(e, gain, at);
    e.heat = clampHeat((e.heat ?? 0) + gain);
    if (byPlayer) e.heatByPlayer = true;
    if (at && e.type === EntityType.STRUCTURE && mat !== 'nebula') stampLocalImpact(e, at);
    applyHeatThresholds(g, e);
}

/** Latch a burn: keep heating at `rate` for `seconds` (incendiary rounds,
 *  the thermal seeker).  Tracked through the same active set. */
export function latchBurn(g: GameEngine, e: GameEntity, seconds: number, rate: number, byPlayer: boolean): void {
    if (!e.active || e.isExploding || !(seconds > 0) || !(rate > 0)) return;
    if (!trackHeat(g.energy, e)) return;
    e.burnTimer = Math.min(6, Math.max(e.burnTimer ?? 0, seconds));
    e.burnRate = Math.min(40, Math.max(e.burnRate ?? 0, rate));
    if (byPlayer) e.heatByPlayer = true;
}

function applyHeatThresholds(g: GameEngine, e: GameEntity): void {
    const heat = e.heat ?? 0;
    if (heat <= 0) return;
    const mat = materialOf(e);
    const r = responseOf(mat);
    // GLASS: thermal stress failure — the same Voronoi engine, the thermal
    // profile: few large pieces, collapsing where the pane stood.
    if (heat >= r.thermalFailAt && e.type === EntityType.STRUCTURE && e.health > 0) {
        stampFractureProfile(e, 'thermal', 0);
        e.lastImpactVelocity = { x: 0, y: 0 };
        g.audio.play('destroy.tile.glass', { x: e.position.x, y: e.position.y });
        killBody(g, e, null, e.heatByPlayer === true, 1);
        return;
    }
    // PLASTIC: the bonds let go; the existing physics pulls the goo apart.
    if (heat >= r.bondReleaseAt && e.shardVariant) {
        g.shards.releaseBondsOf(e, 0.8);
    }
}

/** NEBULA heated: agitation.  A drifting puff is stirred (random velocity,
 *  scaled by heat) and kept from condensing while hot; a static tile that
 *  reaches full heat DISPERSES through the ordinary nebula break-up — the
 *  same cloud path a ship flying through it takes, never the solid one. */
function agitateNebula(g: GameEngine, e: GameEntity, heat: number, dt: number): void {
    if (e.mass !== Infinity) {
        const k = 0.4 * Math.min(heat, 1.5) * dt * 60;
        const a = Math.random() * Math.PI * 2;
        e.velocity.x += Math.cos(a) * k;
        e.velocity.y += Math.sin(a) * k;
        if (heat > 0.2) e.nebulaMergeCooldown = Math.max(e.nebulaMergeCooldown ?? 0, 0.5);
    } else if (heat >= 1 && e.health > 0 && !e.deathDispatched) {
        // Mirrors the ship-through-cloud break-up in PhysicsSystem exactly —
        // out of the static grid, a FADE rather than a pop (the fade tick
        // retires it), and the ordinary nebula death — with no impact
        // direction, since heat has none, and the full slow fade.
        const childD = Math.max(e.size.x, e.size.y) * NEBULA_CONSTANTS.SHARD_LINEAR_RATIO;
        if (childD < NEBULA_CONSTANTS.MIN_SHATTER_DIAMETER) return;
        e.lastImpactVelocity = { x: 0, y: 0 };
        e.lastImpactDamage = 1;
        e.health = 0;
        e.mergeFadeTimer = NEBULA_CONSTANTS.FADE_DURATION;
        e.mergeFadeDuration = NEBULA_CONSTANTS.FADE_DURATION;
        g.physics.removeStaticEntity(e);
        g.handleEntityDeath(e);
    }
}

function tickHeat(g: GameEngine, dt: number, doEffects: boolean, doConduct: boolean): void {
    const s = g.energy;
    const list = s.heated;
    const effDt = HEAT_EFFECT_INTERVAL;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e.active || e.isExploding) { dropHeat(e); continue; }
        const mat = materialOf(e);
        const r = responseOf(mat);
        // Burn latch keeps feeding heat.
        if ((e.burnTimer ?? 0) > 0) {
            e.heat = clampHeat((e.heat ?? 0) + heatGain(mat, (e.burnRate ?? 0) * dt));
            e.burnTimer! -= dt;
            if (e.burnTimer! <= 0) { e.burnTimer = undefined; e.burnRate = undefined; }
        }
        e.heat = coolHeat(mat, e.heat ?? 0, dt);
        const heat = e.heat;
        // The hot spot spreads through the body at the material's own rate.
        if (e.heatSpread !== undefined) e.heatSpread = diffuseSpread(mat, e.heatSpread, dt, heatBodyR(e) * 2);
        if (heat > 0 && mat === 'nebula') agitateNebula(g, e, heat, dt);
        if (heat > 0 && doEffects && e.active) {
            if (r.thermalDps > 0) {
                damageBody(g, e, r.thermalDps * heat * effDt, null, 'thermal', e.heatByPlayer === true, false);
            }
            if (e.active) applyHeatThresholds(g, e);
        }
        if (heat > 0.3 && doConduct && r.conduct > 0 && e.active) conductHeat(g, e, r.conduct);
        if (!e.active || (heat <= 0 && !(e.burnTimer && e.burnTimer > 0))) {
            dropHeat(e);
            continue;
        }
        list[n++] = e;
    }
    if (list.length !== n) list.length = n;
}

/** METAL conducts: share a fraction of heat with up to CONDUCT_NEIGHBOURS
 *  cooler metal bodies nearby.  Conserving (the source loses what it gives)
 *  and only for hot metal on a cadence. */
function conductHeat(g: GameEngine, e: GameEntity, frac: number): void {
    const C = ENERGY_CONSTANTS;
    const buf = g.energy.buf2;
    gather(g, e.position.x, e.position.y, C.CONDUCT_RADIUS, buf, 16);
    let given = 0;
    for (let i = 0; i < buf.length && given < C.CONDUCT_NEIGHBOURS; i++) {
        const o = buf[i];
        if (o === e || materialOf(o) !== 'metal') continue;
        const diff = (e.heat ?? 0) - (o.heat ?? 0);
        if (diff <= 0.05) continue;
        if (!trackHeat(g.energy, o)) break;   // set full: nothing may take heat
        const q = diff * frac;
        // Heat crosses at the face that touches the source.
        addHeatSpot(o, q, contactOn(o, e.position));
        e.heat = clampHeat((e.heat ?? 0) - q);
        o.heat = clampHeat((o.heat ?? 0) + q);
        if (e.heatByPlayer) o.heatByPlayer = true;
        given++;
    }
}

// ── Electric ─────────────────────────────────────────────────────────────────

function arcVisual(g: GameEngine, ax: number, ay: number, bx: number, by: number, color: string): void {
    if (!g.currentMap) return;
    g.currentMap.entities.push({
        id: nextId('lightning'), type: EntityType.PARTICLE,
        position: { x: ax, y: ay }, velocity: { x: 0, y: 0 }, size: { x: 1, y: 1 },
        rotation: 0, color, active: true, health: 1, maxHealth: 1,
        lifetime: LIGHTNING_ARC_LIFETIME * 0.6, maxLifetime: LIGHTNING_ARC_LIFETIME * 0.6, mass: 0,
        isLightningArc: true,
        arcPoints: [{ x: ax, y: ay }, { x: bx, y: by }],
    });
}

function fizzle(g: GameEngine, x: number, y: number, angle: number, color: string): void {
    g.spawnParticles({ x, y }, 5, color, {
        speedMin: 2, speedMax: 6, sizeMin: 0.8, sizeMax: 1.6,
        spreadAngle: angle, spreadCone: Math.PI * 0.5, lifetimeMin: 0.1, lifetimeMax: 0.25,
    });
}

/**
 * Discharge a BOUNDED electric chain.  `first` is the body the discharge
 * starts in (a bolt's impact) or null (a beam/nova arcing from `origin`).
 * Conductors carry it on; insulators end it where they stand; nebula is
 * ENERGISED (steerable by magnetism for a few seconds) rather than damaged.
 * Returns the number of bodies reached.
 */
export function dischargeElectric(g: GameEngine, origin: Vector2, first: GameEntity | null,
                                  spec: NonNullable<WeaponConfig['electric']>, color: string,
                                  byPlayer: boolean, damageFirst = false): number {
    const C = ENERGY_CONSTANTS;
    const caps: ChainCaps = {
        maxHops: Math.max(0, Math.min(spec.hops, C.CHAIN_MAX_HOPS)),
        maxTargets: Math.max(1, Math.min(spec.targets, C.CHAIN_MAX_TARGETS)),
        maxRadius: C.CHAIN_MAX_RADIUS,
        hopRange: Math.max(10, Math.min(spec.hopRange, C.CHAIN_HOP_RANGE * 2)),
        branches: Math.max(1, Math.min(spec.branches, 8)),
    };
    const nodes = planChain(first, origin, spec.magnitude, caps,
        (x, y, r, out) => {
            gather(g, x, y, r, g.energy.buf, C.CHAIN_CANDIDATES * 4);
            nearestK(g.energy.buf, x, y, C.CHAIN_CANDIDATES);
            for (let i = 0; i < g.energy.buf.length; i++) out.push(g.energy.buf[i]);
        },
        dist);
    g.energy.lastChainSize = nodes.length;
    if (nodes.length === 0) return 0;
    g.audio.play('impact.lightning.arc', { x: origin.x, y: origin.y });
    const now = g.simClock;
    for (const node of nodes) {
        const e = node.e;
        const fromPos = node.from ? node.from.position : origin;
        if (node.depth > 0 || !first) arcVisual(g, fromPos.x, fromPos.y, e.position.x, e.position.y, color);
        if (node.depth === 0 && !damageFirst) continue;
        const mat = materialOf(e);
        if (mat === 'nebula') {
            // Same rule as heat: only a body in the set carries the state,
            // so the magnet and the rim can never disagree about it.
            if (!e.energizedTracked) {
                if (g.energy.energized.length >= MAX_ENERGIZED) continue;
                e.energizedTracked = true;
                g.energy.energized.push(e);
            }
            e.energizedUntil = now + C.ENERGIZE_SEC;
            continue;
        }
        const dmg = node.mag * responseOf(mat).electricDamage;
        if (dmg > 0.05) damageBody(g, e, dmg, fromPos, 'electric', byPlayer);
        e.hitFlash = Math.max(e.hitFlash ?? 0, 0.12);
    }
    return nodes.length;
}

// ── Magnetic ─────────────────────────────────────────────────────────────────

export interface MagOpts {
    /** Point every body is pulled toward / pushed from (defaults to the
     *  pulse centre).  The tractor beam pulls toward the ship. */
    anchorX?: number; anchorY?: number;
    /** Restrict to a cone around `coneDir` (radians) of `coneHalf`. */
    coneDir?: number; coneHalf?: number;
    color?: string;
}

/**
 * A MAGNETIC pulse: metal (and nebula while energised) within `radius` is
 * pulled toward, or pushed from, the anchor.  Capped at MAG_MAX_TARGETS and
 * MAG_MAX_DV per body.  It does no damage itself — what it does comes from
 * what the force does: metal slamming into things through the ordinary
 * collision/crash energy, and LOOSE (already weakened) static metal having a
 * grain dragged free through the ordinary chip path.
 * Returns how many bodies it moved.
 */
export function magneticPulse(g: GameEngine, x: number, y: number, radius: number, strength: number,
                              mode: 'pull' | 'push', opts?: MagOpts): number {
    const C = ENERGY_CONSTANTS;
    const R = Math.max(0, Math.min(radius, C.MAG_MAX_RADIUS));
    const S = safeMag(strength, 60);
    if (R <= 0 || S <= 0) return 0;
    const ax = opts?.anchorX ?? x, ay = opts?.anchorY ?? y;
    const buf = g.energy.buf;
    gather(g, x, y, R, buf, C.MAG_MAX_TARGETS * 6);
    nearestK(buf, x, y, C.MAG_MAX_TARGETS * 2);
    let moved = 0, streaks = 0;
    const color = opts?.color ?? ENERGY_COLORS.magnetic;
    for (let i = 0; i < buf.length && moved < C.MAG_MAX_TARGETS; i++) {
        const e = buf[i];
        const sus = magneticSusceptibility(e, g.simClock);
        if (sus <= 0) continue;
        const ox = wrapDeltaX(x, e.position.x), oy = wrapDeltaY(y, e.position.y);
        const d = Math.hypot(ox, oy);
        if (d > R) continue;
        if (opts?.coneHalf !== undefined && opts.coneDir !== undefined && d > 1) {
            let da = Math.atan2(oy, ox) - opts.coneDir;
            while (da > Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            if (Math.abs(da) > opts.coneHalf) continue;
        }
        // Direction relative to the ANCHOR.
        const tx = wrapDeltaX(e.position.x, ax), ty = wrapDeltaY(e.position.y, ay);
        const td = Math.hypot(tx, ty);
        if (td < 1) continue;
        const sign = mode === 'pull' ? 1 : -1;
        const ux = (tx / td) * sign, uy = (ty / td) * sign;
        if (e.mass === Infinity) {
            // Static metal: only LOOSE metal gives, and only to a real pull.
            if (e.type !== EntityType.STRUCTURE || !(e.maxHealth > 0)) continue;
            const frac = e.health / e.maxHealth;
            const pull = S * (1 - d / R) * sus;
            if (frac <= C.MAG_LOOSE_HEALTH_FRAC && pull >= C.MAG_LOOSE_MIN_PULL) {
                const r = Math.max(e.size.x, e.size.y) * 0.45;
                const at = { x: e.position.x + ux * r, y: e.position.y + uy * r };
                g.chipStructureAt(e, at, pull * 0.5,
                    { x: e.position.x - ux * 10, y: e.position.y - uy * 10 });
                moved++;
            }
            continue;
        }
        const dv = magneticDv(S, d, R, e.mass, sus);
        if (dv <= 0) continue;
        e.velocity.x += ux * dv;
        e.velocity.y += uy * dv;
        moved++;
        if (streaks < 10) {
            streaks++;
            g.spawnParticles(e.position, 1, color, {
                speedMin: dv * 0.8, speedMax: dv * 1.2, sizeMin: 1, sizeMax: 1.8,
                spreadAngle: Math.atan2(uy, ux), spreadCone: 0.2, lifetimeMin: 0.15, lifetimeMax: 0.3,
            });
        }
    }
    g.energy.lastMagneticCount = moved;
    return moved;
}

/** Leave a short-lived ATTRACTOR at a point (magnetised slug, lodestone). */
export function addMagField(g: GameEngine, x: number, y: number, spec: NonNullable<WeaponConfig['magnetic']>): void {
    const s = g.energy;
    const seconds = Math.min(3, spec.seconds ?? 0);
    magneticPulse(g, x, y, spec.radius, spec.strength, spec.mode);
    if (!(seconds > 0)) return;
    if (s.fields.length >= MAX_FIELDS) s.fields.shift();
    s.fields.push({ x, y, radius: spec.radius, strength: spec.strength * 0.4, mode: spec.mode, time: seconds, acc: 0 });
    g.spawnShockwave({ x, y }, { radius: spec.radius * 0.5, damage: 0, knockback: 0, color: ENERGY_COLORS.magnetic, lifetime: 0.3 });
}

// ── Projectile payloads ──────────────────────────────────────────────────────

/** A round carrying an energy payload has struck `target`.  Heat lands now
 *  (no query needed); electric and magnetic effects are QUEUED for after the
 *  physics step, because they read the grids. */
export function applyProjectilePayload(g: GameEngine, impactPos: Vector2, proj: GameEntity, target: GameEntity): void {
    const byPlayer = proj.ownerType === EntityType.PLAYER;
    if (proj.energyHeat && proj.energyHeat > 0) {
        // No spark spray: heat reads through the body it lands on (its
        // colour and its light — render/energyFx.ts), and nothing else.
        depositHeat(g, target, proj.energyHeat, impactPos, byPlayer);
    }
    if (proj.energyBurnSeconds && proj.energyBurnRate) {
        latchBurn(g, target, proj.energyBurnSeconds, proj.energyBurnRate, byPlayer);
    }
    const q = g.energy.pending;
    if (proj.energyElectric && q.length < MAX_PENDING) {
        q.push({ kind: 'electric', x: impactPos.x, y: impactPos.y, first: target,
                 electric: proj.energyElectric, color: proj.color || ENERGY_COLORS.electric });
    }
    if (proj.energyMagnetic && q.length < MAX_PENDING) {
        q.push({ kind: 'field', x: impactPos.x, y: impactPos.y, first: null,
                 magnetic: proj.energyMagnetic, color: ENERGY_COLORS.magnetic });
    }
}

// ── Instant deliveries: beam, radial, cone ───────────────────────────────────

/** WeaponSystem's sink for every delivery that is not a round. */
export function fireInstant(g: GameEngine, c: WeaponConfig, player: GameEntity, target: Vector2): void {
    const aim = Math.atan2(wrapDeltaY(player.position.y, target.y), wrapDeltaX(player.position.x, target.x));
    if (c.delivery === 'beam') {
        g.energy.beam = { config: c, time: c.beamDuration ?? 0.3, acc: c.beamTick ?? 0.05, angle: aim,
                          x0: player.position.x, y0: player.position.y,
                          x1: player.position.x, y1: player.position.y, hit: false };
        return;
    }
    if (c.delivery === 'radial') { fireRadial(g, c, player); return; }
    fireCone(g, c, player, aim);
}

function fireRadial(g: GameEngine, c: WeaponConfig, player: GameEntity): void {
    const px = player.position.x, py = player.position.y;
    const R = c.pulseRadius ?? 150;
    const color = c.color;
    switch (c.energy) {
        case 'electric': {
            const n = dischargeElectric(g, { x: px, y: py }, null, c.electric!, color, true);
            if (n === 0) fizzle(g, px, py, player.rotation, color);
            g.spawnShockwave({ x: px, y: py }, { radius: R, damage: 0, knockback: 0, color, lifetime: 0.25 });
            return;
        }
        case 'thermal': {
            const buf = g.energy.buf;
            gather(g, px, py, R, buf, ENERGY_CONSTANTS.EXPLOSIVE_MAX_TARGETS * 4);
            nearestK(buf, px, py, ENERGY_CONSTANTS.EXPLOSIVE_MAX_TARGETS);
            for (let i = 0; i < buf.length; i++) {
                const e = buf[i];
                const d = dist(px, py, e.position.x, e.position.y);
                if (d > R) continue;
                depositHeat(g, e, (c.heat ?? 0) * (1 - d / R), player.position, true);
            }
            // No ring and no sparks: the pulse is read through what it
            // heats — each body changes colour and gives off light.
            return;
        }
        case 'magnetic': {
            magneticPulse(g, px, py, R, c.magnetic!.strength, c.magnetic!.mode);
            g.spawnShockwave({ x: px, y: py }, { radius: R, damage: 0, knockback: 0, color, lifetime: 0.4 });
            return;
        }
        case 'explosive': {
            g.audio.play('impact.explosion.aoe', { x: px, y: py });
            g.spawnParticles(player.position, 16, '#fb923c', { speedMin: 4, speedMax: 12, sizeMin: 1.5, sizeMax: 3 });
            g.spawnShockwave({ x: px, y: py }, {
                radius: c.explosionRadius ?? R, damage: c.explosionDamage ?? 0,
                knockback: c.explosionKnockback ?? 0, color,
                ownerType: EntityType.PLAYER, ownerId: 'player', excludeIds: ['player'],
            });
            return;
        }
        default: {
            // Unmodified / kinetic: a shockwave ring.  The ring is the
            // existing AoE primitive, so damage, knockback and the player's
            // own immunity all come with it.
            g.spawnShockwave({ x: px, y: py }, {
                radius: R, damage: c.damage, knockback: c.push ?? 0, color,
                ownerType: EntityType.PLAYER, ownerId: 'player', excludeIds: ['player'],
            });
        }
    }
}

/** An instant cone (spread + electric forks, spread + magnetic repulsor). */
function fireCone(g: GameEngine, c: WeaponConfig, player: GameEntity, aim: number): void {
    const px = player.position.x, py = player.position.y;
    const R = c.pulseRadius ?? 200;
    const half = ((c.coneHalfDeg ?? 25) * Math.PI) / 180;
    if (c.energy === 'magnetic' && c.magnetic) {
        magneticPulse(g, px, py, R, c.magnetic.strength, c.magnetic.mode, { coneDir: aim, coneHalf: half });
        for (let k = -1; k <= 1; k++) {
            g.spawnParticles(player.position, 3, c.color, { speedMin: 6, speedMax: 10, sizeMin: 1, sizeMax: 2,
                spreadAngle: aim + k * half * 0.7, spreadCone: 0.15, lifetimeMin: 0.2, lifetimeMax: 0.35 });
        }
        return;
    }
    if (c.energy === 'electric' && c.electric) {
        const buf = g.energy.buf;
        gather(g, px, py, R, buf, ENERGY_CONSTANTS.CHAIN_CANDIDATES * 4);
        nearestK(buf, px, py, ENERGY_CONSTANTS.CHAIN_CANDIDATES);
        // Nearest conductors inside the cone, conductivity-weighted.
        const picks: { e: GameEntity; s: number }[] = [];
        for (let i = 0; i < buf.length; i++) {
            const e = buf[i];
            const ox = wrapDeltaX(px, e.position.x), oy = wrapDeltaY(py, e.position.y);
            const d = Math.hypot(ox, oy);
            if (d > R || d < 1) continue;
            let da = Math.atan2(oy, ox) - aim;
            while (da > Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            if (Math.abs(da) > half) continue;
            const cond = responseOf(materialOf(e)).conductivity;
            if (cond <= 0.01) continue;
            picks.push({ e, s: d / cond });
        }
        picks.sort((a, b) => a.s - b.s);
        const forks = Math.min(c.count, picks.length, 8);
        for (let i = 0; i < forks; i++) {
            const t = picks[i].e;
            arcVisual(g, px, py, t.position.x, t.position.y, c.color);
            dischargeElectric(g, player.position, t, c.electric, c.color, true, true);
        }
        if (forks === 0) {
            for (let k = -1; k <= 1; k++) fizzle(g, px + Math.cos(aim) * 20, py + Math.sin(aim) * 20, aim + k * half * 0.6, c.color);
        }
    }
}

// ── Beam ─────────────────────────────────────────────────────────────────────

/** First solid body along a ray, by circle approximation.  Grid walk in
 *  steps along the ray; nebula never blocks (it is displaced / heated in
 *  passing and reported through `passed`).  Returns the hit and its t. */
function raycast(g: GameEngine, ox: number, oy: number, ux: number, uy: number, range: number,
                 width: number, passed: GameEntity[]): { e: GameEntity | null; t: number } {
    const buf = g.energy.buf2;
    const step = 60;
    let best: GameEntity | null = null, bestT = range;
    passed.length = 0;
    for (let t0 = 0; t0 <= range + step && best === null; t0 += step) {
        const cx = ox + ux * t0, cy = oy + uy * t0;
        gather(g, cx, cy, step * 0.75 + width, buf, 96);
        for (let i = 0; i < buf.length; i++) {
            const e = buf[i];
            const dx = wrapDeltaX(ox, e.position.x), dy = wrapDeltaY(oy, e.position.y);
            const t = dx * ux + dy * uy;
            if (t < 0 || t > range) continue;
            const perp = Math.abs(dx * uy - dy * ux);
            const rad = Math.max(e.size.x, e.size.y) * 0.5 + width * 0.5;
            if (perp > rad) continue;
            if (materialOf(e) === 'nebula') {
                if (passed.length < 6 && !passed.includes(e)) passed.push(e);
                continue;
            }
            const tHit = Math.max(0, t - Math.sqrt(Math.max(0, rad * rad - perp * perp)));
            if (tHit < bestT) { bestT = tHit; best = e; }
        }
    }
    return { e: best, t: best ? bestT : range };
}

const _passed: GameEntity[] = [];
function tickBeam(g: GameEngine, dt: number): void {
    const b = g.energy.beam;
    if (!b) return;
    const p = g.player;
    if (!p.active || p.isExploding || p.systemsDisabled) { g.energy.beam = null; return; }
    b.time -= dt;
    if (b.time <= 0) { g.energy.beam = null; return; }
    const c = b.config;
    const ang = b.angle;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const muzzle = Math.max(p.size.x, p.size.y) * 0.6;
    const ox = p.position.x + ux * muzzle, oy = p.position.y + uy * muzzle;
    const range = c.beamRange ?? 260;
    b.x0 = ox; b.y0 = oy;
    b.acc += dt;
    const tick = c.beamTick ?? 0.05;
    if (b.acc < tick) return;
    b.acc -= tick;

    if (c.energy === 'electric' && c.electric) {
        // An ARC to the nearest conductor in a forward cone, then a chain.
        const buf = g.energy.buf;
        gather(g, ox, oy, range, buf, ENERGY_CONSTANTS.CHAIN_CANDIDATES * 4);
        nearestK(buf, ox, oy, ENERGY_CONSTANTS.CHAIN_CANDIDATES);
        let best: GameEntity | null = null, bestS = Infinity;
        for (let i = 0; i < buf.length; i++) {
            const e = buf[i];
            const dx = wrapDeltaX(ox, e.position.x), dy = wrapDeltaY(oy, e.position.y);
            const d = Math.hypot(dx, dy);
            if (d > range || d < 1) continue;
            if ((dx * ux + dy * uy) / d < Math.cos(Math.PI / 3)) continue;
            const cond = responseOf(materialOf(e)).conductivity;
            if (cond < 0.1) continue;
            const s = d / cond;
            if (s < bestS) { bestS = s; best = e; }
        }
        if (!best) {
            b.x1 = ox + ux * 30; b.y1 = oy + uy * 30; b.hit = false;
            g.energy.lastBeamHitId = null;
            fizzle(g, b.x1, b.y1, ang, c.color);
            return;
        }
        b.x1 = best.position.x; b.y1 = best.position.y; b.hit = true;
        g.energy.lastBeamHitId = best.id;
        arcVisual(g, ox, oy, best.position.x, best.position.y, c.color);
        dischargeElectric(g, { x: ox, y: oy }, best, c.electric, c.color, true, true);
        return;
    }

    const passed = _passed;
    const hit = raycast(g, ox, oy, ux, uy, range, c.beamWidth ?? 3, passed);
    const hx = ox + ux * hit.t, hy = oy + uy * hit.t;
    b.x1 = hx; b.y1 = hy; b.hit = hit.e !== null;
    g.energy.lastBeamHitId = hit.e ? hit.e.id : null;
    const from = { x: ox, y: oy };

    switch (c.energy) {
        case 'thermal':
            if (hit.e) {
                depositHeat(g, hit.e, c.heat ?? 0, from, true);
                if (c.damage > 0) damageBody(g, hit.e, c.damage, from, 'mechanical', true, false);
            }
            for (const n of passed) depositHeat(g, n, (c.heat ?? 0) * 0.5, from, true);
            break;
        case 'magnetic': {
            // TRACTOR: pulses along the line, every body pulled toward the ship
            // (or pushed from it on a charged pulse).
            const m = c.magnetic!;
            let total = 0;
            for (let t = 60; t <= range && total < ENERGY_CONSTANTS.MAG_MAX_TARGETS; t += 70) {
                total += magneticPulse(g, ox + ux * t, oy + uy * t, m.radius, m.strength, m.mode,
                    { anchorX: p.position.x, anchorY: p.position.y });
            }
            g.energy.lastMagneticCount = total;
            b.x1 = ox + ux * range; b.y1 = oy + uy * range;
            break;
        }
        case 'explosive':
            g.spawnShockwave({ x: hx, y: hy }, {
                radius: c.explosionRadius ?? 45, damage: c.explosionDamage ?? 0,
                knockback: c.explosionKnockback ?? 0, color: c.color, lifetime: 0.25,
                ownerType: EntityType.PLAYER, ownerId: 'player', excludeIds: ['player'],
            });
            g.spawnParticles({ x: hx, y: hy }, 6, '#fb923c', { speedMin: 3, speedMax: 8, sizeMin: 1, sizeMax: 2.5 });
            g.audio.play('impact.explosion.aoe', { x: hx, y: hy, gain: 0.5 });
            break;
        default: {
            // Unmodified / kinetic: a bite and a shove along the beam.
            if (hit.e) {
                damageBody(g, hit.e, c.damage, from, 'mechanical', true, false);
                const push = c.push ?? 0;
                if (push > 0 && hit.e.mass !== Infinity && hit.e.active) {
                    const k = push * Math.min(2, Math.sqrt(60 / Math.max(1, hit.e.mass)));
                    hit.e.velocity.x += ux * k; hit.e.velocity.y += uy * k;
                }
            }
            // Mechanical energy DISPLACES nebula in its path — never fractures it.
            for (const n of passed) {
                if (n.mass !== Infinity) { n.velocity.x += ux * 1.5; n.velocity.y += uy * 1.5; }
            }
        }
    }
}

// ── Homing preference ────────────────────────────────────────────────────────

/** Hand preference-homing rounds a target (electric → the best conductor,
 *  magnetic → metal).  Bounded: one capped grid query per round, re-run only
 *  when it has none. */
export function acquireHomingTargets(g: GameEngine): void {
    const list = g.entityIndex.projectiles;
    for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (!p.homing || !p.homingPrefers || p.ownerType !== EntityType.PLAYER) continue;
        if (p.homingTarget && p.homingTarget.active && !p.homingTarget.isExploding) continue;
        const buf = g.energy.buf;
        gather(g, p.position.x, p.position.y, HOMING_ACQUIRE_RANGE, buf, 48);
        let best: GameEntity | null = null, bestS = Infinity;
        for (let j = 0; j < buf.length; j++) {
            const e = buf[j];
            const mat = materialOf(e);
            let w: number;
            if (p.homingPrefers === 'metal') w = mat === 'metal' ? 1 : e.type === EntityType.ENEMY ? 0.35 : 0;
            else w = responseOf(mat).conductivity >= 0.3 && mat !== 'nebula' ? responseOf(mat).conductivity : 0;
            if (w <= 0) continue;
            const s = dist(p.position.x, p.position.y, e.position.x, e.position.y) / w;
            if (s < bestS) { bestS = s; best = e; }
        }
        p.homingTarget = best ?? undefined;
    }
}

// ── The per-step tick ────────────────────────────────────────────────────────

/** Called once per sim step from `updateGameLogic`, after physics. */
export function tickEnergy(g: GameEngine, dt: number): void {
    const s = g.energy;
    // Queued payloads from this step's collisions.
    if (s.pending.length > 0) {
        for (let i = 0; i < s.pending.length; i++) {
            const ev = s.pending[i];
            if (ev.kind === 'electric' && ev.electric) {
                dischargeElectric(g, { x: ev.x, y: ev.y }, ev.first && ev.first.active ? ev.first : null,
                    ev.electric, ev.color, true);
            } else if (ev.kind === 'field' && ev.magnetic) {
                addMagField(g, ev.x, ev.y, ev.magnetic);
            }
        }
        s.pending.length = 0;
    }
    // Heat.
    s.effectAcc += dt;
    s.conductAcc += dt;
    const doEffects = s.effectAcc >= HEAT_EFFECT_INTERVAL;
    const doConduct = s.conductAcc >= ENERGY_CONSTANTS.CONDUCT_INTERVAL_SEC;
    if (doEffects) s.effectAcc -= HEAT_EFFECT_INTERVAL;
    if (doConduct) s.conductAcc -= ENERGY_CONSTANTS.CONDUCT_INTERVAL_SEC;
    if (s.heated.length > 0) tickHeat(g, dt, doEffects, doConduct);
    // Energised nebula decays by clock; the list only prunes.
    if (s.energized.length > 0) {
        let n = 0;
        for (let i = 0; i < s.energized.length; i++) {
            const e = s.energized[i];
            if (!e.active || (e.energizedUntil ?? 0) <= g.simClock) { e.energizedTracked = undefined; continue; }
            s.energized[n++] = e;
        }
        if (s.energized.length !== n) s.energized.length = n;
    }
    // Attractors.
    if (s.fields.length > 0) {
        let n = 0;
        for (let i = 0; i < s.fields.length; i++) {
            const f = s.fields[i];
            f.time -= dt; f.acc += dt;
            if (f.acc >= 0.1) { f.acc -= 0.1; magneticPulse(g, f.x, f.y, f.radius, f.strength, f.mode); }
            if (f.time > 0) s.fields[n++] = f;
        }
        if (s.fields.length !== n) s.fields.length = n;
    }
    tickBeam(g, dt);
}
