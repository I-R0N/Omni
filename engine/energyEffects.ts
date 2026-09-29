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
 *  - Events raised INSIDE the collision step (a projectile's electric
 *    payload, a shell's blast chain) are QUEUED and resolved after physics: the dynamic
 *    grid is only safe to read between substeps (CLAUDE.md §8).
 */
import type { GameEngine } from './GameEngine';
import { GameEntity, EntityType, Vector2, WeaponConfig } from '../types';
import {
    ENERGY_CONSTANTS, materialOf, responseOf, heatGain, clampHeat, coolHeat,
    mechanicalScale, maxHeatOf, conductShare, planChain, safeMag, heatRadiance, materialDef,
    stampFractureProfile, diffuseSpread, heatCapacityOf, type MaterialId, mixHeatSpot, heatPeak, easeShownHeat, type ChainCaps, type EnergyDomain,
} from './systems/energy';
import {
    breakYieldsNothing, noteTraitDamage, markDamaged, hitReactStrength,
    isCollectibleDrop, grainSpecFor, weaponConfig, UI_CONSTANTS, SHIELD_CONSTANTS, HOMING_ACQUIRE_RANGE, LIGHTNING_ARC_LIFETIME, ENERGY_COLORS, NEBULA_CONSTANTS,
} from '../constants';
import { applyBoundaryDamage, stampLocalImpact } from './systems/fractureCache';
import { polygonArea, pointInPolygon } from './systems/fracture';
import { wrapDeltaX, wrapDeltaY } from './toroidal';
import { HEX_AREA } from './maps/TileGenerator';
import { nextId } from './systems/IdAllocator';

// ── State ────────────────────────────────────────────────────────────────────

interface PendingEvent {
    kind: 'electric';
    x: number; y: number;
    first: GameEntity | null;
    electric?: WeaponConfig['electric'];
    color: string;
}
interface BeamState {
    config: WeaponConfig;
    time: number;       // seconds of the pull's own minimum left
    acc: number;        // time since last damage tick
    angle: number;      // aim: the pull's, then the ship's while the trigger is held
    /** How far the blade reaches right now (0..range): it EXTENDS from the
     *  muzzle when fired and RETRACTS back into it when released. */
    reach: number;
    retracting: boolean;
    // Drawn this frame (renderer reads).
    x0: number; y0: number; x1: number; y1: number; hit: boolean;
    /** The traced light path: every segment of it, reflections and splits
     *  included (renderer reads). */
    light: LightOut;
}

const MAX_PENDING = 48;
const MAX_ENERGIZED = 200;
/** How often a heated body's slow effects (burn damage, bond release,
 *  conduction) are applied — heat itself cools every step. */
const HEAT_EFFECT_INTERVAL = 0.2;

/** A bounded ring of trail dots: position, birth (sim clock) and colour,
 *  overwritten oldest first, so emitting never allocates. */
export class SeekerDots {
    static readonly MAX = 2048;
    /** How long a dot lasts, how far apart they are dropped, how big. */
    static readonly LIFE = 2.0;
    static readonly SPACING = 9;
    static readonly RADIUS = 1.8;
    readonly x = new Float32Array(SeekerDots.MAX);
    readonly y = new Float32Array(SeekerDots.MAX);
    readonly born = new Float64Array(SeekerDots.MAX).fill(-1e9);
    readonly color: string[] = new Array(SeekerDots.MAX).fill('#ffffff');
    head = 0;
    emit(x: number, y: number, t: number, color: string): void {
        const i = this.head;
        this.x[i] = x; this.y[i] = y; this.born[i] = t; this.color[i] = color;
        this.head = (i + 1) % SeekerDots.MAX;
    }
    clear(): void { this.born.fill(-1e9); this.head = 0; }
}

export class EnergyState {
    heated: GameEntity[] = [];
    energized: GameEntity[] = [];
    pending: PendingEvent[] = [];
    beam: BeamState | null = null;
    /** Kinetic-beam pulses in flight (a bounded, reused pool) and the burst
     *  still leaving the muzzle. */
    pulses: Pulse[] = [];
    burst: Burst | null = null;
    lastPulseHitId: string | null = null;
    /** The electric spread's RING: a short-lived crackle around the ship;
     *  anything it touches while it lasts starts a chain (renderer reads). */
    ring: ElectricRing | null = null;
    /** SEEKER DOT TRAILS (user call): a fixed ring of dots dropped behind
     *  each player seeker, fading like the player trail — and outliving the
     *  round, so a hit does not snatch its trail away. */
    readonly dots = new SeekerDots();
    /** Hulls crackling from a recent shock (bounded; renderer reads). */
    shocked: GameEntity[] = [];
    emberAcc = 0;
    effectAcc = 0;
    conductAcc = 0;
    jumpAcc = 0;
    /** Diagnostics (tests + DBG): the size of the last electric chain. */
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
            e.charge = undefined;
            e.chargeByPlayer = undefined;
        }
        this.heated.length = 0;
        this.energized.length = 0;
        this.pending.length = 0;
        this.beam = null;
        this.burst = null;
        this.ring = null;
        this.dots.clear();
        for (const e of this.shocked) e.shockTimer = undefined;
        this.shocked.length = 0;
        for (const p of this.pulses) p.alive = false;
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
 *  - A GAS takes no damage — it is not a solid (§8); callers displace,
 *    heat or energise it instead.  Unbreakable bodies (indestructible) take none.
 *  - MECHANICAL energy is scaled by the body's heat (`mechanicalScale`): the
 *    threshold drop that makes heat-then-hit work, with no combo bookkeeping.
 *  - The event's FRACTURE PROFILE is stamped before the damage, so a break
 *    takes the character of what broke it.
 *  - A grain body spends it on its boundaries from the contact side and may
 *    shed a grain (the ordinary chip path); anything else loses health.
 */
const MAX_SHOCKED = 32;
/** Stamp the burning / shocked read on a hull that just took energy damage,
 *  and give a shock to the PLAYER a jolt it can feel (a flash, a small shake,
 *  a buzz).  Burning is felt through its embers and the HUD, not a shake —
 *  a DoT that shook the camera five times a second would be noise. */
function noteEnergyHit(g: GameEngine, e: GameEntity, domain: EnergyDomain): void {
    const C = ENERGY_CONSTANTS;
    if (domain === 'thermal') {
        e.burnIndicator = C.BURN_INDICATOR_SEC;
        // The player FEELS a burn as a soft buzz on the DoT's own cadence.
        if (e.type === EntityType.PLAYER) g.handleRumble(2);
    } else if (domain === 'electric') {
        const fresh = !((e.shockTimer ?? 0) > 0);
        e.shockTimer = C.SHOCK_INDICATOR_SEC;
        const list = g.energy.shocked;
        if (fresh && list.length < MAX_SHOCKED && list.indexOf(e) < 0) list.push(e);
        if (e.type === EntityType.PLAYER) {
            e.hitFlash = Math.max(e.hitFlash ?? 0, 0.15);
            if (fresh) g.handleScreenShake(4, { rumble: 'impact' });
        }
    }
}

export function damageBody(g: GameEngine, e: GameEntity, dmg: number, from: Vector2 | null,
                           domain: EnergyDomain, byPlayer: boolean, text = true, flash = 0.12,
                           at: Vector2 | null = null): void {
    if (!e.active || e.isExploding) return;
    let d = safeMag(dmg);
    if (d <= 0) return;
    const mat = materialOf(e);
    if (responseOf(mat).gas) return;
    if (e.type === EntityType.STRUCTURE && breakYieldsNothing(e.shardVariant)) return;
    if (domain === 'mechanical') d *= mechanicalScale(mat, e.heat);
    stampFractureProfile(e, domain, d);

    if (e.type === EntityType.STRUCTURE) {
        // Where it lands: an explicit point (light crossing a grain boundary
        // INSIDE the body), else the hull facing where it came from.
        const hitAt = at ?? contactOn(e, from);
        if (byPlayer && d >= e.health) e.killedByPlayer = true;
        if (!g.chipStructureAt(e, hitAt, d, from ?? undefined, flash)) {
            stampLocalImpact(e, hitAt);
            if (!applyBoundaryDamage(e, d)) e.health -= d;
            if (flash > 0) markDamaged(e, flash);
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
    // A hull that takes heat or electricity SHOWS it (user call): it reads as
    // burning / shocked for a moment after — embers and crackle on the ship,
    // and for the player the HUD's flame and bolt.
    noteEnergyHit(g, e, domain);
    // THE PLAYER takes energy damage too (heat on contact, radiant heat):
    // shield first, then hull, the same order every other player-damage path
    // uses.
    if (e.type === EntityType.PLAYER) {
        if ((e.shield ?? 0) > 0 && !e.systemsDisabled) {
            const absorbed = Math.min(e.shield!, d);
            e.shield! -= absorbed;
            d -= absorbed;
            e.shieldRechargeTimer = SHIELD_CONSTANTS.RECHARGE_DELAY;
        }
        if (d > 0) {
            e.health -= d;
            e.healthBarTimer = UI_CONSTANTS.HEALTH_BAR.SHOW_DURATION;
            if (text) g.spawnDamageText(e.position, d, e);
        }
        if (e.health <= 0 && !e.isExploding) g.handleEntityDeath(e);
        return;
    }
    // Actors (enemies).  Like the old lightning chain and the blast ring, an
    // energy effect that never travels as a projectile bypasses the
    // projectile-only defences (front shield plate).
    e.health -= d;
    if (e.type === EntityType.ENEMY) e.provoked = true;
    if (byPlayer) noteTraitDamage(e, d);
    if (flash > 0) markDamaged(e, flash);
    else e.healthBarTimer = UI_CONSTANTS.HEALTH_BAR.SHOW_DURATION;
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
    e.heatShown = undefined;
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
function addHeatSpot(e: GameEntity, gain: number, at: Vector2 | null, spotFrac = 0.2): void {
    const R = heatBodyR(e);
    let px = 0, py = 0, s0 = R;
    if (at) {
        const dx = wrapDeltaX(e.position.x, at.x), dy = wrapDeltaY(e.position.y, at.y);
        const cs = Math.cos(-(e.rotation || 0)), sn = Math.sin(-(e.rotation || 0));
        px = dx * cs - dy * sn;
        py = dx * sn + dy * cs;
        // The initial spot: small against the body, never a pinpoint.
        s0 = Math.max(3, R * spotFrac);
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
    e.heat = clampHeat((e.heat ?? 0) + gain, maxHeatOf(mat));
    if (byPlayer) e.heatByPlayer = true;
    if (at && e.type === EntityType.STRUCTURE && !responseOf(mat).gas) stampLocalImpact(e, at);
    applyHeatThresholds(g, e);
}

/** Area of a body for the heat ledger: its polygon where it has one, else
 *  the disc its size describes. */
function heatArea(e: GameEntity): number {
    const poly = e.polygonPoints;
    if (poly && poly.length >= 3) {
        const a = Math.abs(polygonArea(poly));
        if (a > 0) return a;
    }
    const r = Math.max(e.size.x, e.size.y) * 0.5;
    return Math.PI * r * r;
}

/** How much MATERIAL a body is, relative to one hex tile — what its heat
 *  capacity and its burn scale with.  Floored so a speck still burns a
 *  little, and capped at a tile so large merged boulders burn as tiles do. */
export function heatAmountOf(e: GameEntity): number {
    return Math.min(1, Math.max(0.05, heatArea(e) / HEX_AREA));
}

/** A BREAK CONSERVES HEAT (user call), AND A PIECE IS AS HOT AS WHAT IT CAME
 *  OFF (user report: metal fragments came off a glowing tile cold).  Heat is
 *  a TEMPERATURE, and what a body can hold of it scales with how much
 *  material it has (`heatAmountOf`), so a piece of a quarter of the area
 *  holds a quarter of the energy AT THE SAME TEMPERATURE — every piece and
 *  the remainder keep the parent's heat and the energy is conserved exactly.
 *  Dividing the heat itself by area (the previous rule) conserved the energy
 *  too, but only by making each piece colder the more pieces there were: a
 *  metal tile breaks into ~22 grains against rock's ~8, so its fragments
 *  arrived at a twentieth of the tile's heat and read as cold.
 *
 *  What stops this re-igniting the plastic CHAIN REACTION is that burning is
 *  also per unit of material (`tickHeat` scales the thermal DoT by
 *  `heatAmountOf`), so a small hot fragment burns proportionally slowly and
 *  cools before it breaks — the reaction came from every tiny piece burning
 *  as fast as the whole tile.  A burn — a heat SOURCE — is still DIVIDED by
 *  area.  The dust a chip throws is NOT a piece of the body (it is new
 *  material sized off the chip) and stays cold.  Capped under
 *  the material's thermal-failure heat: a pane that failed from heat must not
 *  hand a piece enough to fail again.
 *
 *  `list[from..to)` are the new pieces; `keepArea` is the area the PARENT
 *  keeps (0 when it died). */
export function shareHeat(g: GameEngine, parent: GameEntity, list: GameEntity[], from: number, to: number,
                          keepArea: number): void {
    const h = parent.heat ?? 0;
    const burn = (parent.burnTimer ?? 0) > 0 ? (parent.burnRate ?? 0) : 0;
    if (!(h > 0) && !(burn > 0)) return;
    // Only pieces OF the body share its heat: the dust a chip throws is new
    // material (a puff sized off the chip), not a piece of the parent.
    const pMat = materialOf(parent);
    const pCap = heatCapacityOf(pMat);
    let total = keepArea > 0 ? keepArea : 0;
    for (let i = from; i < to; i++) if (list[i].active && materialOf(list[i]) === pMat) total += heatArea(list[i]);
    if (!(total > 0)) return;
    for (let i = from; i < to; i++) {
        const child = list[i];
        if (!child.active || materialOf(child) !== pMat) continue;
        const share = heatArea(child) / total;
        const mat = materialOf(child);
        const r = responseOf(mat);
        const cap = heatCapacityOf(mat);
        let heat = cap > 0 ? clampHeat(h * pCap / cap, maxHeatOf(mat)) : 0;
        if (r.thermalFailAt > 0) heat = Math.min(heat, r.thermalFailAt * 0.9);
        const rate = burn * share;
        const burns = rate >= ENERGY_CONSTANTS.MIN_SHARED_BURN;
        if (heat < ENERGY_CONSTANTS.HEAT_EPSILON && !burns) continue;
        if (!trackHeat(g.energy, child)) continue;
        child.heat = heat >= ENERGY_CONSTANTS.HEAT_EPSILON ? heat : 0;
        child.heatSpotX = 0; child.heatSpotY = 0;
        child.heatSpread = heatBodyR(child) * 2;
        child.heatShown = Math.min(parent.heatShown ?? child.heat, child.heat);
        if (parent.heatByPlayer) child.heatByPlayer = true;
        if (burns) { child.burnTimer = parent.burnTimer; child.burnRate = rate; }
    }
    // What the body keeps: its own temperature, and its share of any burn.
    if (keepArea > 0 && parent.active && burn > 0) {
        const rate = burn * (keepArea / total);
        if (rate >= ENERGY_CONSTANTS.MIN_SHARED_BURN) parent.burnRate = rate;
        else { parent.burnTimer = undefined; parent.burnRate = undefined; }
    }
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

/** A heated GAS agitates.  A drifting body is stirred (random velocity,
 *  scaled by heat × the material's `agitation`) and kept from condensing
 *  while hot; a static body that reaches its `disperseAt` heat DISPERSES
 *  through the ordinary cloud break-up — the same path a ship flying through
 *  it takes, never the solid one. */
function agitateGas(g: GameEngine, e: GameEntity, heat: number, dt: number,
                    agitation: number, disperseAt: number): void {
    if (e.mass !== Infinity) {
        if (!(agitation > 0)) return;
        const k = agitation * Math.min(heat, 1.5) * dt * 60;
        const a = Math.random() * Math.PI * 2;
        e.velocity.x += Math.cos(a) * k;
        e.velocity.y += Math.sin(a) * k;
        if (heat > 0.2) e.nebulaMergeCooldown = Math.max(e.nebulaMergeCooldown ?? 0, 0.5);
    } else if (heat >= disperseAt && e.health > 0 && !e.deathDispatched) {
        // The same break-up a ship flying through the cloud causes, with no
        // impact direction (heat has none) and the full slow fade.
        disperseCloud(g, e, 0, 0, false);
    }
}

function tickHeat(g: GameEngine, dt: number, doEffects: boolean, doConduct: boolean): void {
    const s = g.energy;
    const list = s.heated;
    const effDt = HEAT_EFFECT_INTERVAL;
    let n = 0, radiators = 0;
    for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e.active || e.isExploding) { dropHeat(e); continue; }
        const mat = materialOf(e);
        const r = responseOf(mat);
        // Burn latch keeps feeding heat.
        if ((e.burnTimer ?? 0) > 0) {
            e.heat = clampHeat((e.heat ?? 0) + heatGain(mat, (e.burnRate ?? 0) * dt), maxHeatOf(mat));
            e.burnTimer! -= dt;
            if (e.burnTimer! <= 0) { e.burnTimer = undefined; e.burnRate = undefined; }
        }
        e.heat = coolHeat(mat, e.heat ?? 0, dt);
        const heat = e.heat;
        // The hot spot spreads through the body at the material's own rate.
        if (e.heatSpread !== undefined) e.heatSpread = diffuseSpread(mat, e.heatSpread, dt, heatBodyR(e) * 2);
        if (heat > 0 && r.gas) agitateGas(g, e, heat, dt, r.agitation, r.disperseAt);
        if (heat > 0 && doEffects && e.active) {
            if (r.thermalDps > 0) {
                // A burn is not a HIT (flash 0): the damage path whitens a body
                // for a blow, and a DoT on this cadence strobed it at 5 Hz —
                // the rock "flash".  The heat colour is the feedback.
                // Burning is per unit of MATERIAL: a small fragment burns as slowly
                // as it is small (see `shareHeat`), a tile at the full rate.
                // Hulls are not terrain and burn at the full rate.
                const amount = e.type === EntityType.STRUCTURE ? heatAmountOf(e) : 1;
                damageBody(g, e, r.thermalDps * heat * amount * effDt, null, 'thermal', e.heatByPlayer === true, false, 0);
            }
            if (e.active) applyHeatThresholds(g, e);
        }
        if (heat > 0.3 && doConduct && r.thermalConductivity > 0 && e.active) conductHeat(g, e, mat);
        if (doEffects && heat >= ENERGY_CONSTANTS.RADIATE_MIN_HEAT && e.active
            && radiators < ENERGY_CONSTANTS.RADIATE_MAX_SOURCES) {
            radiators++;
            radiateHeat(g, e, mat, heat, effDt);
        }
        // What is DRAWN eases toward the true peak, so every step in it — a
        // deposit, a conduction transfer, the cold snap — blends instead of
        // flashing, and a cooled body fades out rather than vanishing.
        const R = heatBodyR(e);
        const target = (e.heat ?? 0) > 0 ? heatPeak(e.heat!, e.heatSpread ?? R, R) : 0;
        e.heatShown = easeShownHeat(e.heatShown ?? 0, target, dt);
        if (!e.active || ((e.heat ?? 0) <= 0 && !(e.burnTimer && e.burnTimer > 0) && !(e.heatShown > 0))) {
            dropHeat(e);
            continue;
        }
        list[n++] = e;
    }
    if (list.length !== n) list.length = n;
}

// ── Radiant heat and contact ─────────────────────────────────────────────────
//
// LIGHT CARRIES HEAT (user call).  A hot body is a light source: its power
// follows T⁴ above ambient (`heatRadiance`, the same curve its visible glow
// uses) times the material's emissivity, and what a neighbour receives is the
// share of that light its silhouette intercepts at that distance — so the
// receiver's own absorptivity (`heatAbsorb`) decides how much becomes heat.
// The source pays for what it gives (energy is conserved; `coolHeat` still
// accounts for what leaves into empty space).  A hull that takes it BURNS
// (hull heat is a DoT — the `generic` material's `thermalDps`).
//
// This is the general case the other light sources sit at the low end of: a
// LIGHT source is a power and a position.  The ship's Light module is a light
// of ~zero power, so it lights things without heating them; a hot tile or
// shard is a source whose power comes from its own heat; a future heat source
// is one more caller of `radiate`.  What it heats is HULLS — the player's and
// enemies' — since between terrain bodies conduction already moves the heat.
// No occlusion is modelled: radiant heat is short-range (RADIATE_RADIUS).

/** Radiate `power` (damage units/s) from world point (x, y) for `dt` seconds
 *  onto up to RADIATE_MAX_RECEIVERS bodies within RADIATE_RADIUS, the player
 *  included.  Returns the energy delivered (damage units). */
export function radiate(g: GameEngine, src: GameEntity | null, x: number, y: number, srcR: number,
                        power: number, dt: number, byPlayer: boolean): number {
    const C = ENERGY_CONSTANTS;
    if (!(power > 0)) return 0;
    const buf = g.energy.buf2;
    gather(g, x, y, C.RADIATE_RADIUS, buf, 32);
    nearestK(buf, x, y, C.RADIATE_MAX_RECEIVERS + 1);
    let given = 0;
    const give = (o: GameEntity) => {
        const oR = heatBodyR(o);
        const d = Math.max(srcR + oR, dist(x, y, o.position.x, o.position.y));
        if (d > C.RADIATE_RADIUS + oR) return;
        // The share of an isotropic source's light a body of width 2·oR
        // intercepts at distance d.
        const share = Math.min(0.5, (2 * oR) / (2 * Math.PI * d));
        const q = power * dt * share;
        if (!(q > 1e-4)) return;
        _from.x = x; _from.y = y;
        depositHeat(g, o, q, _from, byPlayer);
        given += q;
    };
    for (let i = 0; i < buf.length; i++) {
        const o = buf[i];
        // HULLS take radiant heat; terrain does not — between neighbouring
        // bodies CONDUCTION already carries heat, and a hot plate radiating
        // into every cold tile around it would drain in a second, undoing
        // "metal holds heat longest".
        if (o === src || o.type !== EntityType.ENEMY) continue;
        give(o);
    }
    const p = g.player;
    if (p.active && !p.isExploding) give(p);
    return given;
}

/** A hot body's radiant heat: T⁴ × emissivity, paid for out of its own heat. */
function radiateHeat(g: GameEngine, e: GameEntity, mat: MaterialId, heat: number, dt: number): void {
    const emit = materialDef(mat).look.heatEmit;
    const power = ENERGY_CONSTANTS.RADIATE_POWER * heatRadiance(Math.min(heat, 1.5)) * emit;
    const given = radiate(g, e, e.position.x, e.position.y, heatBodyR(e), power, dt, e.heatByPlayer === true);
    if (given > 0) e.heat = clampHeat((e.heat ?? 0) - given / heatCapacityOf(mat), maxHeatOf(mat));
}

/** Heat CONDUCTS between neighbours of ANY material: a hot body shares with
 *  up to CONDUCT_NEIGHBOURS cooler bodies nearby, each at the pair's own rate
 *  (`conductShare` — the harmonic mean of the two thermal conductivities, so
 *  an insulator on either side throttles it).  Conserving (the source loses
 *  what it gives) and on a cadence. */
function conductHeat(g: GameEngine, e: GameEntity, mat: MaterialId): void {
    const C = ENERGY_CONSTANTS;
    const buf = g.energy.buf2;
    gather(g, e.position.x, e.position.y, C.CONDUCT_RADIUS, buf, 16);
    let given = 0;
    for (let i = 0; i < buf.length && given < C.CONDUCT_NEIGHBOURS; i++) {
        const o = buf[i];
        if (o === e) continue;
        const oMat = materialOf(o);
        const share = conductShare(mat, oMat);
        if (!(share > 0)) continue;
        const diff = (e.heat ?? 0) - (o.heat ?? 0);
        if (diff <= 0.05) continue;
        if (!trackHeat(g.energy, o)) break;   // set full: nothing may take heat
        // Never more than the receiver can hold.
        const q = Math.min(diff * share, Math.max(0, maxHeatOf(oMat) - (o.heat ?? 0)));
        if (!(q > 0)) continue;
        // Heat crosses at the face that touches the source.
        // Conducted heat arrives through a whole face, not a pinpoint — a
        // tight spot here concentrated a small transfer into a bright flare.
        addHeatSpot(o, q, contactOn(o, e.position), 0.6);
        e.heat = clampHeat((e.heat ?? 0) - q, maxHeatOf(mat));
        o.heat = clampHeat((o.heat ?? 0) + q, maxHeatOf(oMat));
        if (e.heatByPlayer) o.heatByPlayer = true;
        given++;
    }
    // A HULL TOUCHING A HOT BODY is burned by it (user call): the player's
    // ship is not an energy target, so it is checked here directly — surface
    // to surface within CONTACT_GAP — at the same pair rate as any contact.
    const p = g.player;
    if (p.active && !p.isExploding) {
        const gap = dist(e.position.x, e.position.y, p.position.x, p.position.y)
            - heatBodyR(e) - heatBodyR(p);
        const diff = (e.heat ?? 0) - (p.heat ?? 0);
        if (gap <= C.CONTACT_GAP && diff > 0.05 && trackHeat(g.energy, p)) {
            const pm = materialOf(p);
            const q = Math.min(diff * conductShare(mat, pm), Math.max(0, maxHeatOf(pm) - (p.heat ?? 0)));
            if (q > 0) {
                addHeatSpot(p, q, contactOn(p, e.position), 0.6);
                e.heat = clampHeat((e.heat ?? 0) - q, maxHeatOf(mat));
                p.heat = clampHeat((p.heat ?? 0) + q, maxHeatOf(pm));
            }
        }
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
 * Conductors carry it on; insulators end it where they stand; a material
 * with `energizeSec` (nebula) is ENERGISED rather than damaged.
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
        const r = responseOf(materialOf(e));
        if (r.energizeSec > 0 && e.type === EntityType.STRUCTURE) {
            // Same rule as heat: only a body in the set carries the state, so
            // the sparks and the charge can never disagree about it.  A full
            // set leaves the body uncharged, never the arc undelivered.
            if (e.energizedTracked || g.energy.energized.length < MAX_ENERGIZED) {
                if (!e.energizedTracked) { e.energizedTracked = true; g.energy.energized.push(e); }
                e.energizedUntil = now + r.energizeSec;
                // It holds the charge that reached it (the strongest arc wins).
                e.charge = Math.max(e.charge ?? 0, node.mag * Math.min(1, r.conductivity + 0.3));
                if (byPlayer) e.chargeByPlayer = true;
            }
        }
        if (r.gas) continue;   // a gas is energised, never damaged
        const dmg = node.mag * r.electricDamage;
        if (dmg > 0.05) damageBody(g, e, dmg, fromPos, 'electric', byPlayer);
        e.hitFlash = Math.max(e.hitFlash ?? 0, 0.12);
    }
    return nodes.length;
}

// ── Charged bodies jump to ships ─────────────────────────────────────────────
//
// ELECTRIFIED TILES AND SHARDS JUMP TO SHIPS (user call).  A body an arc
// passed through holds a CHARGE for its material's `energizeSec`, and while
// it holds one it arcs to the nearest ship within JUMP_RANGE — an enemy's or
// the PLAYER'S — spending JUMP_FRACTION of the charge as damage (× the
// ship's own `electricDamage`, so it is the same material rule as a chain).
// A charged field is therefore a hazard to fly through as well as a trap to
// lure enemies into.  Ships, not terrain: between bodies the chain already
// did its work.  Bounded: the candidate hulls are the enemy index plus the
// player, and at most JUMP_MAX_PER_TICK jumps happen per tick.

function chargeJumps(g: GameEngine): void {
    const C = ENERGY_CONSTANTS;
    const list = g.energy.energized;
    const enemies = g.entityIndex.enemies;
    const p = g.player;
    const playerOk = p.active && !p.isExploding;
    let jumps = 0;
    for (let i = 0; i < list.length && jumps < C.JUMP_MAX_PER_TICK; i++) {
        const e = list[i];
        const q = e.charge ?? 0;
        if (q < C.JUMP_MIN_CHARGE || !e.active) continue;
        const eR = Math.max(e.size.x, e.size.y) * 0.5;
        let best: GameEntity | null = null, bestGap: number = C.JUMP_RANGE;
        for (let k = 0; k < enemies.length; k++) {
            const h = enemies[k];
            if (!h.active || h.isExploding) continue;
            const gap = dist(e.position.x, e.position.y, h.position.x, h.position.y)
                - eR - Math.max(h.size.x, h.size.y) * 0.5;
            if (gap < bestGap) { bestGap = gap; best = h; }
        }
        if (playerOk) {
            const gap = dist(e.position.x, e.position.y, p.position.x, p.position.y)
                - eR - Math.max(p.size.x, p.size.y) * 0.5;
            if (gap < bestGap) { bestGap = gap; best = p; }
        }
        if (!best) continue;
        const spend = q * C.JUMP_FRACTION;
        e.charge = q - spend;
        const dmg = spend * responseOf(materialOf(best)).electricDamage;
        arcVisual(g, e.position.x, e.position.y, best.position.x, best.position.y, ENERGY_COLORS.electric);
        if (dmg > 0.05) {
            // A jump to an enemy pays whoever charged the body; a jump to the
            // player is never "by the player".
            const byPlayer = best !== p && e.chargeByPlayer === true;
            damageBody(g, best, dmg, e.position, 'electric', byPlayer, true, 0.12);
        }
        jumps++;
    }
    if (jumps > 0) g.audio.play('impact.lightning.arc', { x: p.position.x, y: p.position.y });
}

// ── Projectile payloads ──────────────────────────────────────────────────────

/** A round carrying an energy payload has struck `target`.  Heat lands now
 *  (no query needed); an electric chain is QUEUED for after the physics
 *  step, because it reads the grids.  A SHELL's chain starts from its blast
 *  instead (`queueElectric`, from the detonation), wherever that happens. */
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
    if (proj.energyElectric && !(proj.explosionRadius && proj.explosionRadius > 0) && q.length < MAX_PENDING) {
        q.push({ kind: 'electric', x: impactPos.x, y: impactPos.y, first: target,
                 electric: proj.energyElectric, color: proj.color || ENERGY_COLORS.electric });
    }
}

/** Queue a bounded electric chain from a point (a detonating shell). */
export function queueElectric(g: GameEngine, at: Vector2, spec: NonNullable<WeaponConfig['electric']>, color: string): void {
    const q = g.energy.pending;
    if (q.length >= MAX_PENDING) return;
    q.push({ kind: 'electric', x: at.x, y: at.y, first: null, electric: spec, color });
}

// ── Instant deliveries: beam, cone ───────────────────────────────────────────

/** WeaponSystem's sink for every delivery that is not a round. */
export function fireInstant(g: GameEngine, c: WeaponConfig, player: GameEntity, target: Vector2): void {
    const aim = Math.atan2(wrapDeltaY(player.position.y, target.y), wrapDeltaX(player.position.x, target.x));
    if (c.delivery === 'beam' && (c.pulseCount ?? 0) > 0) {
        // A BURST OF PULSES (the kinetic beam): they leave one by one.
        g.energy.burst = { config: c, left: Math.min(32, c.pulseCount!), acc: 0, angle: aim };
        return;
    }
    if (c.delivery === 'beam') {
        const prev = g.energy.beam;
        // A pull while the blade is still out (held, or retracting) keeps it
        // out rather than re-igniting it from the muzzle.
        if (prev && prev.config.name === c.name) {
            prev.config = c; prev.time = c.beamDuration ?? 0.3; prev.angle = aim; prev.retracting = false;
            return;
        }
        // The first damage tick lands one tick in, once the blade is out.
        g.energy.beam = { config: c, time: c.beamDuration ?? 0.3, acc: 0, angle: aim,
                          x0: player.position.x, y0: player.position.y,
                          x1: player.position.x, y1: player.position.y, hit: false,
                          reach: 0, retracting: false,
                          light: prev ? prev.light : makeLightOut() };
        g.energy.beam.light.nSeg = 0;
        return;
    }
    fireCone(g, c, player, aim);
}

// ── The electric spread's ring ───────────────────────────────────────────────
//
// FIRING THE FORK ALSO THROWS A RING (user call): a small crackling circle
// around the ship that lasts a moment and moves with it.  Anything it touches
// while it lasts starts a chain — so a fast pass into enemies or terrain a
// beat after the trigger still lands, and the shot reads as a shot even when
// nothing was in the cone to fork to.  Each body is triggered at most once per
// ring, at most RING_MAX_HITS per ring, on a short cadence.

export interface ElectricRing {
    x: number; y: number; radius: number; time: number; life: number;
    acc: number; color: string; spec: NonNullable<WeaponConfig['electric']>;
    hit: string[];
}
const RING_RADIUS = 64;
const RING_LIFE = 0.4;
const RING_TICK = 0.05;
const RING_MAX_HITS = 6;

function tickRing(g: GameEngine, dt: number): void {
    const r = g.energy.ring;
    if (!r) return;
    const p = g.player;
    if (!p.active || p.isExploding) { g.energy.ring = null; return; }
    r.time -= dt;
    if (r.time <= 0) { g.energy.ring = null; return; }
    r.x = p.position.x; r.y = p.position.y;
    r.acc += dt;
    if (r.acc < RING_TICK || r.hit.length >= RING_MAX_HITS) return;
    r.acc = 0;
    const buf = g.energy.buf;
    const reach = r.radius + Math.max(p.size.x, p.size.y) * 0.5;
    gather(g, r.x, r.y, reach + 40, buf, 48);
    nearestK(buf, r.x, r.y, 12);
    for (let i = 0; i < buf.length && r.hit.length < RING_MAX_HITS; i++) {
        const e = buf[i];
        if (r.hit.includes(e.id)) continue;
        const d = dist(r.x, r.y, e.position.x, e.position.y) - Math.max(e.size.x, e.size.y) * 0.5;
        if (d > r.radius) continue;
        if (responseOf(materialOf(e)).conductivity < ENERGY_CONSTANTS.CHAIN_MIN_CONDUCTIVITY) continue;
        r.hit.push(e.id);
        const q = { x: r.x, y: r.y };
        arcVisual(g, r.x, r.y, e.position.x, e.position.y, r.color);
        dischargeElectric(g, q, e, r.spec, r.color, true, true);
    }
}

/** An instant cone (spread + electric forks). */
function fireCone(g: GameEngine, c: WeaponConfig, player: GameEntity, aim: number): void {
    const px = player.position.x, py = player.position.y;
    const R = c.pulseRadius ?? 200;
    const half = ((c.coneHalfDeg ?? 25) * Math.PI) / 180;
    if (c.energy === 'electric' && c.electric) {
        g.energy.ring = { x: px, y: py, radius: RING_RADIUS, time: RING_LIFE, life: RING_LIFE, acc: RING_TICK,
                          color: c.color, spec: c.electric, hit: [] };
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
            g.energy.ring!.hit.push(t.id);   // the ring will not strike it twice
            arcVisual(g, px, py, t.position.x, t.position.y, c.color);
            dischargeElectric(g, player.position, t, c.electric, c.color, true, true);
        }
        if (forks === 0) {
            for (let k = -1; k <= 1; k++) fizzle(g, px + Math.cos(aim) * 20, py + Math.sin(aim) * 20, aim + k * half * 0.6, c.color);
        }
    }
}

// ── Light: beams and pulses ──────────────────────────────────────────────────
//
// A beam is LIGHT, and what light does at a body is a MATERIAL PROPERTY
// (user call): it REFLECTS (metal is the mirror), is ABSORBED (rock), or
// PASSES THROUGH (glass, cloudy plastic) — bending at the faces by the
// refractive index, glancing off every grain boundary it crosses inside and
// splitting a little at each, and leaving a little energy on each boundary on
// the way (a deep pass-through with low per-boundary damage).  A gas lets it
// through untouched.
//
// `traceLight` does all of it as a BOUNDED set of rays: at most MAX_RAYS rays
// per trace, MAX_BOUNCES reflections per ray, MAX_INTERNAL_STEPS grain steps
// inside a body and MAX_SEGS drawn segments — whatever the geometry.  Rays
// live in a fixed module pool, segments in a flat array the caller owns, so a
// trace allocates nothing.  A continuous beam traces its whole range each
// tick; a PULSE traces only the distance it flies this step, and the rays
// still in flight at the end of it become the pulse (or new pulses, when it
// split).  Internal deflection is seeded by the body and the step, so a
// beam's path through a pane is stable from tick to tick instead of jittering.

const MAX_RAYS = 10;
const MAX_BOUNCES = 8;
const MAX_INTERNAL_STEPS = 48;
const MAX_SEGS = 48;
/** A ray carrying less than this fraction of its trace's energy is spent. */
const MIN_F = 0.04;

interface LightRay {
    x: number; y: number; ux: number; uy: number;
    len: number; f: number; bounces: number;
    /** A body the ray must not re-strike on its first cast (it just left it). */
    skip: GameEntity | null;
    /** A ray that starts INSIDE this body (a split made in there). */
    inside: GameEntity | null;
    step: number;
}
const _rays: LightRay[] = [];
for (let i = 0; i < MAX_RAYS; i++) {
    _rays.push({ x: 0, y: 0, ux: 0, uy: 0, len: 0, f: 0, bounces: 0, skip: null, inside: null, step: 0 });
}
let _nRays = 0;
function pushRay(x: number, y: number, ux: number, uy: number, len: number, f: number,
                 bounces: number, skip: GameEntity | null, inside: GameEntity | null, step = 0): boolean {
    if (_nRays >= MAX_RAYS || !(f >= MIN_F) || !(len > 0.5)) return false;
    const r = _rays[_nRays++];
    r.x = x; r.y = y; r.ux = ux; r.uy = uy; r.len = len; r.f = f;
    r.bounces = bounces; r.skip = skip; r.inside = inside; r.step = step;
    return true;
}

/** What a trace deposits, per unit of energy fraction.  One reused object
 *  per caller — never a closure per tick. */
export interface LightDeposit {
    dmg: number;          // mechanical damage units at f = 1
    heat: number;         // thermal packet at f = 1
    push: number;         // kinetic shove at f = 1 (surface only)
    thermal: boolean;     // infrared: reads `thermalTransmissivity`
    breaksCloud: boolean; // a kinetic pulse breaks a static cloud tile it crosses
    byPlayer: boolean;
}

/** Trace output: drawn segments (x0,y0,x1,y1,f per segment, flat), the rays
 *  still in flight when their length ran out (x,y,ux,uy,f), and the first body
 *  struck.  Owned by the caller and reused. */
export interface LightOut {
    segs: number[]; nSeg: number;
    leaves: number[]; nLeaf: number;
    firstHit: GameEntity | null;
}
export function makeLightOut(): LightOut {
    return { segs: [], nSeg: 0, leaves: [], nLeaf: 0, firstHit: null };
}

function addSeg(out: LightOut, x0: number, y0: number, x1: number, y1: number, f: number): void {
    if (out.nSeg >= MAX_SEGS) return;
    const k = out.nSeg++ * 5;
    const a = out.segs;
    a[k] = x0; a[k + 1] = y0; a[k + 2] = x1; a[k + 3] = y1; a[k + 4] = f;
}

// Scratch for the hit test: the struck body, its distance, and the OUTWARD
// surface normal (world) at the contact.
let _hitT = 0, _hitNx = 0, _hitNy = 0;
let _hitE: GameEntity | null = null;

/** Distance along a ray from (ox, oy) in unit direction (ux, uy) to where it
 *  first meets `e`'s polygon, or Infinity if it misses, and the outward
 *  normal of the edge it meets (written to `_hitNx/_hitNy`, world frame).
 *  `halfW` widens the ray into a beam: the two edge rays are tested alongside
 *  the centre one.  Works in the body's LOCAL frame, because `polygonPoints`
 *  are stored unrotated.  A ray that starts inside the body hits at 0. */
function rayPolygonEntry(e: GameEntity, ox: number, oy: number, ux: number, uy: number,
                         halfW: number): number {
    const poly = e.polygonPoints!;
    const rot = e.rotation ?? 0;
    const cs = Math.cos(-rot), sn = Math.sin(-rot);
    const rx = -wrapDeltaX(ox, e.position.x), ry = -wrapDeltaY(oy, e.position.y);
    const lx0 = rx * cs - ry * sn, ly0 = rx * sn + ry * cs;
    const dx = ux * cs - uy * sn, dy = ux * sn + uy * cs;
    // The normal to the ray, for the two edge rays.
    const nx = -dy, ny = dx;
    let best = Infinity, bnx = -dx, bny = -dy;
    for (let k = -1; k <= 1; k++) {
        if (k !== 0 && halfW <= 0) continue;
        const lx = lx0 + nx * halfW * k, ly = ly0 + ny * halfW * k;
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const ax = poly[j].x, ay = poly[j].y, bx = poly[i].x, by = poly[i].y;
            if ((ay > ly) !== (by > ly) && lx < (bx - ax) * (ly - ay) / (by - ay) + ax) inside = !inside;
            // Ray (lx,ly)+t(dx,dy) against segment a + s(b-a).
            const ex = bx - ax, ey = by - ay;
            const den = dx * ey - dy * ex;
            if (Math.abs(den) < 1e-9) continue;
            const qx = ax - lx, qy = ay - ly;
            const t = (qx * ey - qy * ex) / den;
            const sgm = (qx * dy - qy * dx) / den;
            if (t >= 0 && sgm >= 0 && sgm <= 1 && t < best) {
                best = t;
                // Edge normal, turned to face AWAY from the polygon's centre.
                const el = Math.hypot(ex, ey) || 1;
                let mx = ey / el, my = -ex / el;
                if (mx * (ax + bx) + my * (ay + by) < 0) { mx = -mx; my = -my; }
                bnx = mx; bny = my;
            }
        }
        if (inside) { best = 0; bnx = -dx; bny = -dy; break; }
    }
    // Back to world.
    const cw = Math.cos(rot), sw = Math.sin(rot);
    _hitNx = bnx * cw - bny * sw;
    _hitNy = bnx * sw + bny * cw;
    return best;
}

const _passed: GameEntity[] = [];
/** First solid body along a ray.  A grid walk in steps along the ray; a
 *  circle per body is only the BROADPHASE — a body with a polygon is hit
 *  where the beam meets that polygon (user report: the circle, sized to the
 *  body's longest extent, stopped the beam short of irregular shards).  A
 *  GAS never blocks; it is reported through `passed`.  Sets `_hitE`,
 *  `_hitT` and the outward normal. */
function raycast(g: GameEngine, ox: number, oy: number, ux: number, uy: number, range: number,
                 width: number, skip: GameEntity | null, passed: GameEntity[]): boolean {
    const buf = g.energy.buf2;
    const step = 60;
    let best: GameEntity | null = null, bestT = range, bnx = 0, bny = 0;
    passed.length = 0;
    for (let t0 = 0; t0 <= range + step && best === null; t0 += step) {
        const cx = ox + ux * t0, cy = oy + uy * t0;
        gather(g, cx, cy, step * 0.75 + width, buf, 96);
        for (let i = 0; i < buf.length; i++) {
            const e = buf[i];
            if (e === skip) continue;
            const dx = wrapDeltaX(ox, e.position.x), dy = wrapDeltaY(oy, e.position.y);
            const t = dx * ux + dy * uy;
            const rad = Math.max(e.size.x, e.size.y) * 0.5 + width * 0.5;
            if (t < -rad || t > range + rad) continue;
            const perp = Math.abs(dx * uy - dy * ux);
            if (perp > rad) continue;
            if (responseOf(materialOf(e)).gas) {
                if (t >= 0 && t <= range && passed.length < 6 && !passed.includes(e)) passed.push(e);
                continue;
            }
            let tHit: number, nx: number, ny: number;
            if (e.polygonPoints && e.polygonPoints.length >= 3) {
                tHit = rayPolygonEntry(e, ox, oy, ux, uy, width * 0.5);
                nx = _hitNx; ny = _hitNy;
            } else {
                if (t < 0) continue;
                tHit = Math.max(0, t - Math.sqrt(Math.max(0, rad * rad - perp * perp)));
                const hx = ox + ux * tHit, hy = oy + uy * tHit;
                const ex = wrapDeltaX(e.position.x, hx), ey = wrapDeltaY(e.position.y, hy);
                const m = Math.hypot(ex, ey) || 1;
                nx = ex / m; ny = ey / m;
            }
            if (tHit < bestT) { bestT = tHit; best = e; bnx = nx; bny = ny; }
        }
    }
    _hitE = best; _hitT = best ? bestT : range; _hitNx = bnx; _hitNy = bny;
    return best !== null;
}

/** Deposit a fraction `f` of a trace's energy into `e` — at `at` (world) when
 *  it lands inside the body on a grain boundary, else on the surface facing
 *  `from`. */
function depositLight(g: GameEngine, e: GameEntity, f: number, from: Vector2, at: Vector2 | null,
                      dep: LightDeposit, ux: number, uy: number): void {
    if (!(f > 0) || !e.active) return;
    if (dep.heat > 0) depositHeat(g, e, dep.heat * f, at ?? from, dep.byPlayer);
    if (dep.dmg * f > 0.01 && e.active) damageBody(g, e, dep.dmg * f, from, 'mechanical', dep.byPlayer, false, 0.08, at);
    if (at === null && dep.push > 0 && e.active && e.mass !== Infinity) {
        const k = dep.push * f * Math.min(2, Math.sqrt(60 / Math.max(1, e.mass)));
        e.velocity.x += ux * k; e.velocity.y += uy * k;
    }
}

/** Unit vector through a surface by Snell's law, written to `_rx/_ry`.
 *  (dx,dy) the incoming direction, (nx,ny) the normal facing AGAINST it,
 *  `eta` = n1/n2.  False on total internal reflection. */
let _rx = 0, _ry = 0;
function refract(dx: number, dy: number, nx: number, ny: number, eta: number): boolean {
    const cosi = -(dx * nx + dy * ny);
    const k = 1 - eta * eta * (1 - cosi * cosi);
    if (k < 0) return false;
    const a = eta * cosi - Math.sqrt(k);
    _rx = eta * dx + a * nx; _ry = eta * dy + a * ny;
    const m = Math.hypot(_rx, _ry) || 1;
    _rx /= m; _ry /= m;
    return true;
}

/** Deterministic -1..1 for a body and a step, so a path through a body is
 *  the same every tick. */
function jitter(id: string, step: number, lane: number): number {
    let h = 2166136261 ^ Math.imul(step + 1, 374761393) ^ Math.imul(lane + 3, 668265263);
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
    h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
    return ((h >>> 0) / 4294967296) * 2 - 1;
}

const _at = { x: 0, y: 0 };
const _from = { x: 0, y: 0 };

/** Carry a ray THROUGH `e` from world point (x, y), already inside, heading
 *  (ux, uy).  Steps a grain at a time: each boundary crossed takes its loss
 *  (deposited there), turns the ray by up to the material's scatter and may
 *  split a new ray off.  Leaving the body it refracts out (or reflects back
 *  in, past the critical angle) and a new ray carries on outside. */
function traverse(g: GameEngine, e: GameEntity, x: number, y: number, ux: number, uy: number,
                  f: number, len: number, bounces: number, step0: number, dep: LightDeposit, out: LightOut): void {
    const r = responseOf(materialOf(e));
    const poly = e.polygonPoints;
    if (!poly || poly.length < 3) return;
    const grain = (e.shardVariant ? grainSpecFor(e.shardVariant)?.grainSize : undefined) ?? 12;
    const s = Math.max(4, grain);
    const rot = e.rotation ?? 0;
    const cs = Math.cos(-rot), sn = Math.sin(-rot), cw = Math.cos(rot), sw = Math.sin(rot);
    let lx = wrapDeltaX(e.position.x, x), ly = wrapDeltaY(e.position.y, y);
    { const tx = lx * cs - ly * sn, ty = lx * sn + ly * cs; lx = tx; ly = ty; }
    let dx = ux * cs - uy * sn, dy = ux * sn + uy * cs;
    // World position of the local frame's origin in the RAY's frame, so every
    // point written out stays continuous with where the ray came from.
    const ox = x - (lx * cw - ly * sw), oy = y - (lx * sw + ly * cw);
    let travelled = 0;
    for (let k = 0; k < MAX_INTERNAL_STEPS && travelled < len; k++) {
        const stepN = step0 + k;
        const nx = lx + dx * s, ny = ly + dy * s;
        const wx0 = ox + (lx * cw - ly * sw), wy0 = oy + (lx * sw + ly * cw);
        if (!pointInPolygon(nx, ny, poly)) {
            // LEAVING: find the exit on the segment and the edge it crosses.
            let tBest = s, enx = dx, eny = dy;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                const ax = poly[j].x, ay = poly[j].y, bx = poly[i].x, by = poly[i].y;
                const ex = bx - ax, ey = by - ay;
                const den = dx * ey - dy * ex;
                if (Math.abs(den) < 1e-9) continue;
                const qx = ax - lx, qy = ay - ly;
                const t = (qx * ey - qy * ex) / den;
                const sg = (qx * dy - qy * dx) / den;
                if (t >= 0 && t <= s + 1e-6 && sg >= 0 && sg <= 1 && t < tBest) {
                    tBest = t;
                    const el = Math.hypot(ex, ey) || 1;
                    let mx = ey / el, my = -ex / el;
                    if (mx * (ax + bx) + my * (ay + by) < 0) { mx = -mx; my = -my; }
                    enx = mx; eny = my;
                }
            }
            const qx = lx + dx * tBest, qy = ly + dy * tBest;
            const wx = ox + (qx * cw - qy * sw), wy = oy + (qx * sw + qy * cw);
            addSeg(out, wx0, wy0, wx, wy, f);
            travelled += tBest;
            // Out through the face (normal facing against the ray is -n_out).
            if (refract(dx, dy, -enx, -eny, r.refractiveIndex)) {
                const wdx = _rx * cw - _ry * sw, wdy = _rx * sw + _ry * cw;
                pushRay(wx + wdx * 0.6, wy + wdy * 0.6, wdx, wdy, len - travelled, f, bounces, e, null);
                return;
            }
            // Past the critical angle: it reflects back inside.
            if (bounces >= MAX_BOUNCES) {
                _at.x = wx; _at.y = wy; _from.x = wx0; _from.y = wy0;
                depositLight(g, e, f, _from, _at, dep, ux, uy);
                return;
            }
            bounces++;
            const d2 = dx * enx + dy * eny;
            dx -= 2 * d2 * enx; dy -= 2 * d2 * eny;
            lx = qx - enx * 0.5; ly = qy - eny * 0.5;
            continue;
        }
        // Across a GRAIN BOUNDARY.
        const wx = ox + (nx * cw - ny * sw), wy = oy + (nx * sw + ny * cw);
        addSeg(out, wx0, wy0, wx, wy, f);
        travelled += s;
        lx = nx; ly = ny;
        // Each boundary takes a LITTLE damage — but the light keeps its
        // strength (user call: a beam through glass stays at full energy; how
        // far it goes is the weapon's range, not a loss per boundary).
        const loss = f * r.boundaryLoss;
        if (loss > 0) {
            _at.x = wx; _at.y = wy; _from.x = wx0; _from.y = wy0;
            depositLight(g, e, loss, _from, _at, dep, ux, uy);
        }
        if (!e.active || (e.health ?? 1) <= 0) {
            // The body broke under it: the light carries straight on.
            const wdx = dx * cw - dy * sw, wdy = dx * sw + dy * cw;
            pushRay(wx, wy, wdx, wdy, len - travelled, f, bounces, e, null);
            return;
        }
        if (f < MIN_F) return;
        if (r.boundarySplit > 0) {
            // A split branch glances off at a wider angle than the main ray.
            // It carries its own share for DAMAGE (a prism must not multiply
            // a beam's damage by its branch count) but is drawn at full
            // brightness like every other segment.
            const sf = f * r.boundarySplit;
            const a = jitter(e.id, stepN, 2) * Math.max(0.35, r.boundaryScatter * 3);
            const ca = Math.cos(a), sa = Math.sin(a);
            const bdx = dx * ca - dy * sa, bdy = dx * sa + dy * ca;
            pushRay(wx, wy, bdx * cw - bdy * sw, bdx * sw + bdy * cw, len - travelled, sf, bounces, null, e, stepN + 101);
        }
        if (r.boundaryScatter > 0) {
            const a = jitter(e.id, stepN, 1) * r.boundaryScatter;
            const ca = Math.cos(a), sa = Math.sin(a);
            const tx = dx * ca - dy * sa; dy = dx * sa + dy * ca; dx = tx;
        }
    }
}

/** Trace light from (x, y) along (ux, uy) for `range`, carrying energy
 *  fraction `f0`.  See the section note. */
export function traceLight(g: GameEngine, x: number, y: number, ux: number, uy: number, range: number,
                           width: number, f0: number, dep: LightDeposit, out: LightOut,
                           skip: GameEntity | null = null): void {
    out.nSeg = 0; out.nLeaf = 0; out.firstHit = null;
    _nRays = 0;
    pushRay(x, y, ux, uy, range, f0, 0, skip, null);
    for (let ri = 0; ri < _nRays; ri++) {
        const ray = _rays[ri];
        if (ray.inside !== null) {
            if (ray.inside.active) {
                traverse(g, ray.inside, ray.x, ray.y, ray.ux, ray.uy, ray.f, ray.len, ray.bounces, ray.step, dep, out);
            }
            continue;
        }
        const hit = raycast(g, ray.x, ray.y, ray.ux, ray.uy, ray.len, width, ray.skip, _passed);
        const e = _hitE, t = _hitT, hnx = _hitNx, hny = _hitNy;
        const hx = ray.x + ray.ux * t, hy = ray.y + ray.uy * t;
        addSeg(out, ray.x, ray.y, hx, hy, ray.f);
        // A GAS in the path: thermal light warms it, a kinetic pulse breaks a
        // static cloud tile it crosses and shoves a drifting puff.
        for (let i = 0; i < _passed.length; i++) {
            const n = _passed[i];
            if (dep.heat > 0) depositHeat(g, n, dep.heat * ray.f * 0.5, null, dep.byPlayer);
            if (dep.dmg > 0 && n.active) {
                if (n.mass !== Infinity) { n.velocity.x += ray.ux * 1.5 * ray.f; n.velocity.y += ray.uy * 1.5 * ray.f; }
                else if (dep.breaksCloud) disperseCloud(g, n, ray.ux * 6, ray.uy * 6, true);
            }
        }
        if (!hit || e === null) {
            // Still in flight: a leaf (the caller may keep flying it).
            if (out.nLeaf < MAX_RAYS) {
                const k = out.nLeaf++ * 5;
                out.leaves[k] = hx; out.leaves[k + 1] = hy;
                out.leaves[k + 2] = ray.ux; out.leaves[k + 3] = ray.uy; out.leaves[k + 4] = ray.f;
            }
            continue;
        }
        if (out.firstHit === null) out.firstHit = e;
        const r = responseOf(materialOf(e));
        const T = e.polygonPoints && e.polygonPoints.length >= 3
            ? (dep.thermal ? r.thermalTransmissivity : r.transmissivity) : 0;
        let fr = ray.f * r.reflectivity;
        let ft = ray.f * (1 - r.reflectivity) * T;
        // What the surface ABSORBS is what it takes as damage.
        const fa = Math.max(0, ray.f - fr - ft);
        // THE LIGHT CARRIES ON AT FULL STRENGTH (user call): whichever way
        // most of it goes — reflected off a mirror, through a pane — keeps the
        // whole beam; only the minor branch carries just its own share.  So a
        // beam's reach is its weapon's RANGE, not a loss per bounce.  A dull
        // absorber (rock) sends nothing on that is worth keeping.
        if (fr >= ft && fr >= 0.3 * ray.f) fr = ray.f;
        else if (ft > fr && ft >= 0.3 * ray.f) ft = ray.f;
        _from.x = ray.x; _from.y = ray.y;
        depositLight(g, e, fa, _from, null, dep, ray.ux, ray.uy);
        const left = ray.len - t;
        if (fr >= MIN_F && ray.bounces < MAX_BOUNCES) {
            const d = ray.ux * hnx + ray.uy * hny;
            const rx = ray.ux - 2 * d * hnx, ry = ray.uy - 2 * d * hny;
            pushRay(hx + hnx * 0.6, hy + hny * 0.6, rx, ry, left, fr, ray.bounces + 1, e, null);
        }
        if (ft >= MIN_F && e.active) {
            // Into the body, bent by the face (the normal against the ray is
            // the outward one: the ray arrives from outside).
            if (refract(ray.ux, ray.uy, hnx, hny, 1 / Math.max(1, r.refractiveIndex))) {
                traverse(g, e, hx - hnx * 0.5, hy - hny * 0.5, _rx, _ry, ft, left, ray.bounces, 0, dep, out);
            }
        }
    }
}

/** Break a STATIC cloud tile up the way a ship flying through it does — out
 *  of the static grid, a fade rather than a pop, the ordinary nebula death —
 *  or refuse (false) when its pieces would be too small to exist.  `vx, vy`
 *  is the impact direction the pieces scatter along; `fast` fades it quickly. */
function disperseCloud(g: GameEngine, e: GameEntity, vx: number, vy: number, fast: boolean): boolean {
    if (e.health <= 0 || e.deathDispatched || !e.active) return false;
    const childD = Math.max(e.size.x, e.size.y) * NEBULA_CONSTANTS.SHARD_LINEAR_RATIO;
    if (childD < NEBULA_CONSTANTS.MIN_SHATTER_DIAMETER) return false;
    e.lastImpactVelocity = { x: vx, y: vy };
    e.lastImpactDamage = 1;
    e.health = 0;
    const fade = fast ? NEBULA_CONSTANTS.FADE_DURATION * 0.4 : NEBULA_CONSTANTS.FADE_DURATION;
    e.mergeFadeTimer = fade;
    e.mergeFadeDuration = fade;
    g.physics.removeStaticEntity(e);
    g.handleEntityDeath(e);
    return true;
}

// ── The continuous beam ──────────────────────────────────────────────────────

const _beamDep: LightDeposit = { dmg: 0, heat: 0, push: 0, thermal: false, breaksCloud: false, byPlayer: true };

function tickBeam(g: GameEngine, dt: number): void {
    const b = g.energy.beam;
    if (!b) return;
    const p = g.player;
    if (!p.active || p.isExploding || p.systemsDisabled) { g.energy.beam = null; return; }
    const c = b.config;
    // THE BLADE IS HELD, NOT TIMED (user call).  A pull lights it for at
    // least its own `beamDuration`; after that it stays out for as long as a
    // fire control is held, and the moment nothing holds it, it RETRACTS into
    // the muzzle over BEAM_RETRACT_SEC and is gone.  Swapping off the gun
    // retracts it too.
    const held = g.input.isFireHeld() && weaponConfig(p.currentWeapon).name === c.name;
    b.time -= dt;
    // Half a step of slack: `beamDuration` is a whole number of ticks, and the
    // last one must land rather than lose a float race with the countdown.
    if (!b.retracting && b.time <= -0.5 * dt && !held) b.retracting = true;
    // While held it FOLLOWS THE AIM (the ship's facing is the pointer's
    // bearing on every device); a tap-length pull keeps the aim it was fired
    // at, which is also what a pull at a target means.
    if (held && b.time <= 0) b.angle = p.rotation;
    const ang = b.angle;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const muzzle = Math.max(p.size.x, p.size.y) * 0.6;
    const ox = p.position.x + ux * muzzle, oy = p.position.y + uy * muzzle;
    const range = c.beamRange ?? 260;
    b.x0 = ox; b.y0 = oy;

    if (c.energy === 'electric' && c.electric) {
        // An arc has no blade to extend: it is on while held and gone after.
        if (b.retracting) { g.energy.beam = null; return; }
        b.acc += dt;
        const tick = c.beamTick ?? 0.05;
        if (b.acc < tick - 1e-9) return;
        b.acc -= tick;
        // An ARC to the nearest conductor in a forward cone, then a chain.
        b.light.nSeg = 0;
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
            if (cond < ENERGY_CONSTANTS.CHAIN_MIN_CONDUCTIVITY) continue;
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

    // LIGHT: the blade grows out of the muzzle and shrinks back into it.
    if (b.retracting) {
        b.reach -= range * dt / ENERGY_CONSTANTS.BEAM_RETRACT_SEC;
        if (b.reach <= 0) { g.energy.beam = null; return; }
    } else {
        b.reach = Math.min(range, b.reach + range * dt / ENERGY_CONSTANTS.BEAM_EXTEND_SEC);
    }
    // THE PATH IS RE-TRACED EVERY STEP from where the muzzle is NOW, so the
    // blade stays attached to a moving ship (a path traced on the damage tick
    // and drawn between ticks lagged the ship and snapped — the flashing
    // lines).  Only a damage tick deposits anything; the other steps trace
    // DRY, which the deposit rules make a pure path query.
    b.acc += dt;
    const tick = c.beamTick ?? 0.05;
    const live = !b.retracting && b.acc >= tick - 1e-9;
    if (live) b.acc -= tick;
    const dep = _beamDep;
    // Held past the pull's own duration, each tick is scaled by the gun's
    // duty cycle, so holding delivers the damage per second tapping does.
    const duty = b.time > 0 ? 1
        : Math.min(1, (c.beamDuration ?? 0.3) / Math.max(1e-3, c.cooldown));
    dep.dmg = live ? c.damage * duty : 0;
    dep.heat = live && c.energy === 'thermal' ? (c.heat ?? 0) * duty : 0;
    dep.push = live && c.energy !== 'thermal' ? (c.push ?? 0) : 0;
    dep.thermal = c.energy === 'thermal';
    dep.breaksCloud = false;
    dep.byPlayer = true;
    traceLight(g, ox, oy, ux, uy, b.reach, c.beamWidth ?? 3, 1, dep, b.light);
    const L = b.light;
    // The first segment's end is the classic "beam end" (tests, the HUD).
    if (L.nSeg > 0) { b.x1 = L.segs[2]; b.y1 = L.segs[3]; }
    else { b.x1 = ox + ux * b.reach; b.y1 = oy + uy * b.reach; }
    b.hit = L.firstHit !== null;
    g.energy.lastBeamHitId = L.firstHit ? L.firstHit.id : null;
}

// ── Pulses: the kinetic beam ─────────────────────────────────────────────────
//
// A burst of short beams that FLY (user call: like the old bolt-style beam),
// each traced through the same optics as a continuous beam over the distance
// it covers this step — so a pulse reflects off metal, splits and scatters in
// glass and dies in rock.  A split's extra branches become extra pulses, out
// of a bounded pool.

const MAX_PULSES = 64;
interface Pulse {
    x: number; y: number; ux: number; uy: number; f: number;
    travelled: number; range: number; speed: number; length: number;
    dmg: number; push: number; color: string; width: number; alive: boolean;
}
interface Burst { config: WeaponConfig; left: number; acc: number; angle: number; lastOff?: number }
const _pulseDep: LightDeposit = { dmg: 0, heat: 0, push: 0, thermal: false, breaksCloud: true, byPlayer: true };
const _pulseOut = makeLightOut();

function spawnPulse(g: GameEngine, x: number, y: number, ux: number, uy: number, f: number,
                    travelled: number, c: { range: number; speed: number; length: number; dmg: number;
                    push: number; color: string; width: number }): void {
    const list = g.energy.pulses;
    let p: Pulse | undefined;
    for (let i = 0; i < list.length; i++) if (!list[i].alive) { p = list[i]; break; }
    if (!p) {
        if (list.length >= MAX_PULSES) return;
        p = { x: 0, y: 0, ux: 0, uy: 0, f: 0, travelled: 0, range: 0, speed: 0, length: 0,
              dmg: 0, push: 0, color: '', width: 0, alive: false };
        list.push(p);
    }
    p.x = x; p.y = y; p.ux = ux; p.uy = uy; p.f = f; p.travelled = travelled;
    p.range = c.range; p.speed = c.speed; p.length = c.length; p.dmg = c.dmg; p.push = c.push;
    p.color = c.color; p.width = c.width; p.alive = true;
}

function tickPulses(g: GameEngine, dt: number): void {
    const s = g.energy;
    // Emit the bursts in progress.
    const bu = s.burst;
    if (bu) {
        const pl = g.player;
        if (!pl.active || pl.isExploding || pl.systemsDisabled) { s.burst = null; }
        else {
            bu.acc -= dt;
            while (bu && bu.left > 0 && bu.acc <= 0) {
                const c = bu.config;
                // Every pulse flies PARALLEL to the aim (no angle between
                // them) but leaves from a RANDOM point across a narrow lane
                // (user call: variety rather than a sweep in series), rolled
                // clear of the last one so two in a row never overlap.
                const ux = Math.cos(bu.angle), uy = Math.sin(bu.angle);
                const muzzle = Math.max(pl.size.x, pl.size.y) * 0.6;
                const lane = c.pulseSpread ?? 0;
                let off = 0;
                if (lane > 0) {
                    off = (Math.random() * 2 - 1) * lane;
                    if (bu.lastOff !== undefined && Math.abs(off - bu.lastOff) < lane * 0.5) {
                        off = bu.lastOff > 0 ? off - lane : off + lane;
                        off = Math.max(-lane, Math.min(lane, off));
                    }
                    bu.lastOff = off;
                }
                spawnPulse(g, pl.position.x + ux * muzzle - uy * off, pl.position.y + uy * muzzle + ux * off, ux, uy, 1, 0, {
                    range: c.beamRange ?? 360, speed: c.pulseSpeed ?? 1500, length: c.pulseLength ?? 24,
                    dmg: c.damage, push: c.push ?? 0, color: c.color, width: c.beamWidth ?? 3 });
                bu.left--;
                bu.acc += c.pulseInterval ?? 0.05;
            }
            if (bu.left <= 0) s.burst = null;
        }
    }
    const list = s.pulses;
    const n = list.length;
    for (let i = 0; i < n; i++) {
        const p = list[i];
        if (!p.alive) continue;
        const L = Math.min(p.speed * dt, p.range - p.travelled);
        if (!(L > 0) || p.f < MIN_F) { p.alive = false; continue; }
        const dep = _pulseDep;
        dep.dmg = p.dmg; dep.push = p.push; dep.heat = 0; dep.thermal = false;
        dep.breaksCloud = true; dep.byPlayer = true;
        traceLight(g, p.x, p.y, p.ux, p.uy, L, p.width, p.f, dep, _pulseOut);
        if (_pulseOut.firstHit) s.lastPulseHitId = _pulseOut.firstHit.id;
        p.travelled += L;
        if (_pulseOut.nLeaf === 0) { p.alive = false; continue; }
        // The STRONGEST ray still in flight IS this pulse; any others are new
        // pulses split off it this step (a weak reflection, a prism branch).
        const lv = _pulseOut.leaves;
        let main = 0;
        for (let k = 1; k < _pulseOut.nLeaf; k++) if (lv[k * 5 + 4] > lv[main * 5 + 4]) main = k;
        for (let k = 0; k < _pulseOut.nLeaf; k++) {
            const o = k * 5;
            if (k === main) {
                p.x = lv[o]; p.y = lv[o + 1]; p.ux = lv[o + 2]; p.uy = lv[o + 3]; p.f = lv[o + 4];
            } else {
                spawnPulse(g, lv[o], lv[o + 1], lv[o + 2], lv[o + 3], lv[o + 4], p.travelled, p);
            }
        }
    }
}

// ── The per-step tick ────────────────────────────────────────────────────────

/** Called once per sim step from `updateGameLogic`, after physics. */
/** The burning / shocked reads: count them down, prune the crackle list, and
 *  let a burning player shed embers. */
function tickHazards(g: GameEngine, dt: number): void {
    const s = g.energy;
    const p = g.player;
    if ((p.burnIndicator ?? 0) > 0) {
        p.burnIndicator! -= dt;
        if (p.burnIndicator! <= 0) p.burnIndicator = undefined;
        else if (p.active && !p.isExploding) {
            s.emberAcc += dt * ENERGY_CONSTANTS.EMBER_RATE;
            while (s.emberAcc >= 1) {
                s.emberAcc -= 1;
                const r = Math.max(p.size.x, p.size.y) * 0.45;
                g.spawnParticles(p.position, 1,
                    Math.random() < 0.5 ? '#ffb347' : '#ff6a2b', {
                        speedMin: 0.4, speedMax: 1.6, sizeMin: 1.2, sizeMax: 2.6,
                        lifetimeMin: 0.25, lifetimeMax: 0.55, positionJitter: r,
                        baseVelocity: { x: p.velocity.x * 0.6, y: p.velocity.y * 0.6 },
                    });
            }
        }
    }
    if (s.shocked.length > 0) {
        let n = 0;
        for (let i = 0; i < s.shocked.length; i++) {
            const e = s.shocked[i];
            e.shockTimer = (e.shockTimer ?? 0) - dt;
            if (!e.active || e.isExploding || e.shockTimer <= 0) { e.shockTimer = undefined; continue; }
            s.shocked[n++] = e;
        }
        if (s.shocked.length !== n) s.shocked.length = n;
    }
}

export function tickEnergy(g: GameEngine, dt: number): void {
    const s = g.energy;
    // Queued payloads from this step's collisions.
    if (s.pending.length > 0) {
        for (let i = 0; i < s.pending.length; i++) {
            const ev = s.pending[i];
            if (ev.kind === 'electric' && ev.electric) {
                dischargeElectric(g, { x: ev.x, y: ev.y }, ev.first && ev.first.active ? ev.first : null,
                    ev.electric, ev.color, true);
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
    // Charged bodies decay by clock; the list only prunes.
    if (s.energized.length > 0) {
        let n = 0;
        for (let i = 0; i < s.energized.length; i++) {
            const e = s.energized[i];
            if (!e.active || (e.energizedUntil ?? 0) <= g.simClock) {
                e.energizedTracked = undefined; e.charge = undefined; e.chargeByPlayer = undefined;
                continue;
            }
            s.energized[n++] = e;
        }
        if (s.energized.length !== n) s.energized.length = n;
        s.jumpAcc += dt;
        if (s.jumpAcc >= ENERGY_CONSTANTS.JUMP_INTERVAL) {
            s.jumpAcc = 0;
            chargeJumps(g);
        }
    }
    tickBeam(g, dt);
    if (s.burst || s.pulses.length > 0) tickPulses(g, dt);
    tickHazards(g, dt);
    if (s.ring) tickRing(g, dt);
}
