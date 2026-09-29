/** ENERGY FEEDBACK — the world-space layer for the energy modules.
 *
 *  Minimal by design (§11): the material behaviour carries most of the
 *  communication; this adds the three cues nothing else draws.
 *
 *   - HEAT: the material ITSELF changes colour and gives off light — see
 *     `renderHeat`.  Nothing else draws heat: no rings, discs or sparks.
 *   - ENERGISED nebula GLITTERS (user call): quick, bright sparks inside the
 *     cloud — the nebula twinkle, faster and hotter — with an occasional
 *     faint crackle line to a neighbouring energised puff.
 *   - THE BEAM: the live beam pulse from the ship to what it touches.
 *
 *  Electric arcs reuse the existing lightning-arc particle, magnetism reuses
 *  particle streaks and a ring, explosions reuse the blast ring — none of
 *  those need anything here.  Reads only the view GameEngine hands the
 *  renderer each frame; walks lists that are bounded by construction.
 */
import { GameEntity, CameraState } from '../../../types';
import { shiftX, shiftY } from './drawUtils';
import { heatRadiance, materialOf, materialDef, MATERIAL_IDS, type MaterialId, type MaterialLook } from '../energy';

export interface EnergyBeamView {
    x0: number; y0: number; x1: number; y1: number;
    width: number; color: string; energy: string | undefined; hit: boolean;
    /** The traced light path — x0,y0,x1,y1,f per segment, flat — including
     *  every reflection, refraction and split. */
    segs: number[]; nSeg: number;
}
/** A kinetic-beam pulse in flight (the pool GameEngine hands over). */
export interface EnergyPulseView {
    x: number; y: number; ux: number; uy: number; f: number;
    length: number; width: number; color: string; alive: boolean;
}
export interface EnergyFxView {
    heated: readonly GameEntity[];
    energized: readonly GameEntity[];
    beam: EnergyBeamView | null;
    pulses: readonly EnergyPulseView[];
    /** The electric spread's ring around the ship, while it lasts. */
    ring: { x: number; y: number; radius: number; time: number; life: number; color: string } | null;
    simClock: number;
    /** Enemies a player seeker has LOCKED (distinct, ≤ 16). */
    locks: GameEntity[];
}

const CULL = 1400;

export function renderEnergyFx(ctx: CanvasRenderingContext2D, view: EnergyFxView | null, camera: CameraState): void {
    if (!view) return;
    const camX = camera.position.x, camY = camera.position.y;
    renderLocks(ctx, view.locks, camX, camY);
    const { heated, energized, beam, pulses, ring } = view;
    if (heated.length === 0 && energized.length === 0 && !beam && pulses.length === 0 && !ring) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    if (heated.length > 0) renderHeat(ctx, heated, camX, camY);
    ctx.globalCompositeOperation = 'lighter';

    if (energized.length > 0) renderSparks(ctx, energized, view.simClock, camX, camY);
    if (ring) renderRing(ctx, ring, camX, camY);

    // Electric beams draw as arcs (lightning particles); a light beam draws
    // its whole traced path — every reflection, refraction and split — as
    // GLOWING LINES and nothing else (user call): full brightness whatever
    // share of the energy a branch carries, BUTT caps, and each connected run
    // of segments stroked as ONE polyline.  Separate round-capped segments
    // overlapped at every joint, and under additive blending each overlap
    // doubled into a bright dot — the "dots at the ends of beam elements".
    if (beam && beam.energy !== 'electric' && beam.nSeg > 0) {
        strokeLightPath(ctx, beam.segs, beam.nSeg, camX, camY, beam.color, beam.width);
    }
    // Pulses: short streaks along their heading.
    for (let i = 0; i < pulses.length; i++) {
        const p = pulses[i];
        if (!p.alive) continue;
        const x = shiftX(camX, p.x), y = shiftY(camY, p.y);
        if (Math.abs(x - camX) > CULL || Math.abs(y - camY) > CULL) continue;
        const tx = x - p.ux * p.length, ty = y - p.uy * p.length;
        ctx.lineCap = 'butt';
        for (let k = 0; k < GLOW.length; k++) {
            const [wMul, alpha, white] = GLOW[k];
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = white ? '#ffffff' : p.color;
            ctx.lineWidth = Math.max(1, p.width * wMul);
            ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
        }
    }
    ctx.restore();
}

// ── LIGHT PATHS ─────────────────────────────────────────────────────────────

/** A glowing line: wide and faint, then narrower and brighter, then a white
 *  core — [width × beam width, alpha, white core?].  Every layer at full
 *  brightness whatever share of the energy the path carries. */
const GLOW: ReadonlyArray<readonly [number, number, boolean]> = [
    [4.0, 0.14, false], [2.0, 0.35, false], [0.6, 0.95, true],
];
/** Two segment ends closer than this are one joint of the same path. */
const JOIN_EPS = 2.5;

function strokeLightPath(ctx: CanvasRenderingContext2D, sg: readonly number[], n: number,
                         camX: number, camY: number, color: string, width: number): void {
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    for (let layer = 0; layer < GLOW.length; layer++) {
        const [wMul, alpha, white] = GLOW[layer];
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = white ? '#ffffff' : color;
        ctx.lineWidth = Math.max(1, width * wMul);
        ctx.beginPath();
        let px = NaN, py = NaN;
        for (let k = 0; k < n; k++) {
            const o = k * 5;
            // Screen position of the segment's start (torus-shifted to the
            // camera), and its end relative to that start.
            const x0 = shiftX(camX, sg[o]), y0 = shiftY(camY, sg[o + 1]);
            const x1 = x0 + (shiftX(sg[o], sg[o + 2]) - sg[o]);
            const y1 = y0 + (shiftY(sg[o + 1], sg[o + 3]) - sg[o + 1]);
            if (!(Math.abs(x0 - px) < JOIN_EPS && Math.abs(y0 - py) < JOIN_EPS)) ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            px = x1; py = y1;
        }
        ctx.stroke();
    }
}

// ── THE ELECTRIC SPREAD'S RING ──────────────────────────────────────────────
//
// A jagged, crackling circle around the ship: RING_PTS vertices whose radii
// jitter by a hash of the time slot (so it flickers, with no per-frame state),
// stroked as a wide faint glow and a thin bright core, fading over its life.

const RING_PTS = 28;
const RING_SLOT = 0.04;
function renderRing(ctx: CanvasRenderingContext2D,
                    r: { x: number; y: number; radius: number; time: number; life: number; color: string },
                    camX: number, camY: number): void {
    const x = shiftX(camX, r.x), y = shiftY(camY, r.y);
    const t = Math.max(0, Math.min(1, r.time / r.life));
    const slot = Math.floor(performance.now() / 1000 / RING_SLOT);
    ctx.lineJoin = 'miter';
    for (let layer = 0; layer < 2; layer++) {
        ctx.globalAlpha = (layer === 0 ? 0.35 : 0.95) * (0.35 + 0.65 * t);
        ctx.strokeStyle = layer === 0 ? r.color : '#e0fbff';
        ctx.lineWidth = layer === 0 ? 5 : 1.3;
        ctx.beginPath();
        for (let k = 0; k <= RING_PTS; k++) {
            const i = k % RING_PTS;
            const a = (i / RING_PTS) * Math.PI * 2;
            const rr = r.radius * (0.86 + 0.28 * hash01('ring', slot, i));
            const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
            if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
    }
}

// ── ENERGISED NEBULA: SPARKS ────────────────────────────────────────────────
//
// An arc through a cloud leaves it crackling.  Each energised body shows a
// couple of short, bright sparks that jump to a fresh spot every SPARK_SLOT
// seconds (the nebula twinkle's star, faster and brighter), and now and then
// a faint jagged line to the next energised puff nearby.  Positions are a
// hash of the body and the time slot, so nothing is stored per body and the
// whole pass is a fixed handful of drawImage calls per body on a list capped
// at 200.  Fades out over the last SPARK_FADE seconds of the charge.

const SPARK_SLOT = 0.09;
const SPARK_FADE = 0.8;
const SPARKS_PER_BODY = 2;
const SPARK_SIZE = 9;
const SPARK_LINK = 110;
let _sparkBmp: HTMLCanvasElement | null = null;
function sparkBitmap(): HTMLCanvasElement {
    if (_sparkBmp) return _sparkBmp;
    const n = 24, c = document.createElement('canvas');
    c.width = n; c.height = n;
    const g = c.getContext('2d')!;
    const m = n / 2;
    const rg = g.createRadialGradient(m, m, 0, m, m, m);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.25, 'rgba(190,250,255,0.8)');
    rg.addColorStop(0.6, 'rgba(103,232,249,0.22)');
    rg.addColorStop(1, 'rgba(103,232,249,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, n, n);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(m - 0.5, 2, 1, n - 4);
    g.fillRect(2, m - 0.5, n - 4, 1);
    _sparkBmp = c;
    return c;
}
/** Deterministic 0..1 from a body, a slot and a lane — no state, no garbage. */
function hash01(id: string, slot: number, lane: number): number {
    let h = 2166136261 ^ (slot * 374761393) ^ (lane * 668265263);
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
    h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function renderSparks(ctx: CanvasRenderingContext2D, energized: readonly GameEntity[], clock: number,
                      camX: number, camY: number): void {
    const bmp = sparkBitmap();
    const slot = Math.floor(performance.now() / 1000 / SPARK_SLOT);
    let prevX = 0, prevY = 0, havePrev = false;
    for (let i = 0; i < energized.length; i++) {
        const e = energized[i];
        if (!e.active) { havePrev = false; continue; }
        const left = (e.energizedUntil ?? 0) - clock;
        if (left <= 0) { havePrev = false; continue; }
        const x = shiftX(camX, e.position.x), y = shiftY(camY, e.position.y);
        if (Math.abs(x - camX) > CULL || Math.abs(y - camY) > CULL) { havePrev = false; continue; }
        const fade = Math.min(1, left / SPARK_FADE);
        const R = Math.max(e.size.x, e.size.y) * 0.45;
        let sx0 = x, sy0 = y;
        for (let k = 0; k < SPARKS_PER_BODY; k++) {
            const a = hash01(e.id, slot, k) * Math.PI * 2;
            const r = Math.sqrt(hash01(e.id, slot, k + 7)) * R;
            const sx = x + Math.cos(a) * r, sy = y + Math.sin(a) * r;
            if (k === 0) { sx0 = sx; sy0 = sy; }
            const size = SPARK_SIZE * (0.6 + 0.8 * hash01(e.id, slot, k + 13));
            ctx.globalAlpha = fade * (0.55 + 0.45 * hash01(e.id, slot, k + 19));
            ctx.drawImage(bmp, sx - size / 2, sy - size / 2, size, size);
        }
        // A faint crackle to the previous energised puff, when it is close,
        // on roughly a third of the slots.
        if (havePrev && hash01(e.id, slot, 29) < 0.35) {
            const dx = prevX - sx0, dy = prevY - sy0;
            if (dx * dx + dy * dy < SPARK_LINK * SPARK_LINK) {
                const mx = (sx0 + prevX) / 2 + (hash01(e.id, slot, 31) - 0.5) * 14;
                const my = (sy0 + prevY) / 2 + (hash01(e.id, slot, 37) - 0.5) * 14;
                ctx.globalAlpha = fade * 0.35;
                ctx.strokeStyle = '#a5f3fc';
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.lineTo(mx, my); ctx.lineTo(prevX, prevY); ctx.stroke();
            }
        }
        prevX = sx0; prevY = sy0; havePrev = true;
    }
    ctx.globalAlpha = 1;
}

// ── SEEKER LOCK BRACKETS ────────────────────────────────────────────────────
//
// A lightweight target cursor over every enemy a player seeker has locked:
// four corner ticks around the body, slowly turning, fading IN on lock and
// OUT when the lock is gone (so a round that re-targets never pops).  State
// is a tiny parallel pair of arrays (≤ 16 locks) — no per-frame allocation.

const LOCK_COLOR = '#fbbf24';
const LOCK_FADE_IN = 0.12;   // seconds
const LOCK_FADE_OUT = 0.25;
const _lockEnt: GameEntity[] = [];
const _lockA: number[] = [];
let _lockT = 0;

function renderLocks(ctx: CanvasRenderingContext2D, locks: readonly GameEntity[], camX: number, camY: number): void {
    if (locks.length === 0 && _lockEnt.length === 0) { _lockT = 0; return; }
    const now = performance.now() / 1000;
    const dt = _lockT > 0 ? Math.min(0.1, now - _lockT) : 0;
    _lockT = now;
    // Admit new locks at alpha 0.
    for (let i = 0; i < locks.length; i++) {
        if (_lockEnt.indexOf(locks[i]) < 0 && _lockEnt.length < 24) { _lockEnt.push(locks[i]); _lockA.push(0); }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = LOCK_COLOR;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    let n = 0;
    for (let i = 0; i < _lockEnt.length; i++) {
        const e = _lockEnt[i];
        const held = locks.indexOf(e) >= 0;
        let a = _lockA[i] + (held ? dt / LOCK_FADE_IN : -dt / LOCK_FADE_OUT);
        a = Math.max(0, Math.min(1, a));
        if (!e.active || e.isExploding || (!held && a <= 0)) continue;   // drop
        _lockEnt[n] = e; _lockA[n] = a; n++;
        if (a <= 0) continue;
        const x = shiftX(camX, e.position.x), y = shiftY(camY, e.position.y);
        if (Math.abs(x - camX) > CULL || Math.abs(y - camY) > CULL) continue;
        // Tighten onto the target as the lock takes hold.
        const r = Math.max(e.size.x, e.size.y) * 0.5 + 6 + (1 - a) * 8;
        const tick = Math.max(4, r * 0.35);
        const spin = now * 0.8;
        ctx.globalAlpha = 0.85 * a;
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
            const ang = spin + k * (Math.PI / 2) + Math.PI / 4;
            const cx = x + Math.cos(ang) * r, cy = y + Math.sin(ang) * r;
            // Each corner is an L: two arms running back along the square's
            // sides toward the neighbouring corners.
            const a1 = ang + Math.PI * 0.75, a2 = ang - Math.PI * 0.75;
            ctx.moveTo(cx + Math.cos(a1) * tick, cy + Math.sin(a1) * tick);
            ctx.lineTo(cx, cy);
            ctx.lineTo(cx + Math.cos(a2) * tick, cy + Math.sin(a2) * tick);
        }
        ctx.stroke();
    }
    _lockEnt.length = n; _lockA.length = n;
    ctx.restore();
}

// ── HEAT ────────────────────────────────────────────────────────────────────
//
// Heat is shown two ways and only two (user call): the MATERIAL CHANGES
// COLOUR and it EMITS LIGHT — and both radiate from WHERE THE HEAT WENT IN,
// not from the body's centre.
//
// The sim keeps one `heat` number per body.  energyEffects.ts carries beside
// it a Gaussian HOT SPOT (centre in the body's local frame + spread σ): set at
// the contact point, merged by moment-matching when more heat lands, and
// DIFFUSED at the material's own rate (σ² += 4αt), so a spot on metal smears
// across the plate in a fraction of a second while one on glass or rock stays
// where it landed.  Rendering is then physical in two places:
//
//   1. INCANDESCENCE — the body's own outline filled with a radial gradient
//      centred on the spot, following the Gaussian profile: local temperature
//      = peak × exp(−r²/2σ²), where the peak is the body's mean heat
//      concentrated into that σ (energy.ts `heatPeak`).  Colour follows the
//      MATERIAL's own ramp of the LOCAL temperature (`MATERIALS[m].look` — metal
//      incandesces toward white, rock stays magma-red, glass glows amber,
//      plastic scorches brown), so a tight fresh spot is the hottest step of
//      that ramp at its core, and the same heat diffused reads cooler and
//      even.  Clipped to the real polygon, so it is never a shape laid over
//      the body, and translucent, so the material still shows.
//   2. EMISSION — an additive glow around the spot whose brightness follows
//      T⁴ radiance (`heatRadiance`) × the material's emissivity: warm is
//      barely visible, near-critical metal is a soft light source, and
//      plastic hardly glows at all.
//
// Nebula (no hard outline, tint 0) and polygon-less hulls take the emission
// only.
//
// COST.  Gradients are built ONCE per material × peak-temperature bucket at UNIT radius
// and cached per context; each body scales one by transform — no per-frame
// allocation, one path fill + one fillRect per on-screen heated body, over a
// set bounded by MAX_HEATED and culled to the view first.

const HEAT_BUCKETS = 40;
const PEAK_MAX = 1.6;
const HEAT_MIN = 0.03;
/** The gradient spans this many σ; the Gaussian is ~4% at the rim. */
const SIGMAS = 2.5;
/** Gradient stop positions (fraction of the rim) and the Gaussian there. */
const STOPS = [0, 0.2, 0.4, 0.6, 0.8, 1];
const PROFILE = STOPS.map(u => Math.exp(-((SIGMAS * u) ** 2) / 2));

/** HOW EACH MATERIAL LOOKS HOT lives in the central material table
 *  (`MATERIALS[m].look`, engine/systems/energy.ts), so the colour of heat says
 *  what is burning and a new material brings its own look:
 *
 *   - `heatRamp`  local temperature (0..1) → colour.  Metal runs the classic
 *                 incandescent ladder (cherry → orange → yellow-white); rock
 *                 stays in magma reds and ambers and never whitens; glass
 *                 glows a soft amber to pale straw; plastic SCORCHES —
 *                 yellowing then browning — with only a dim ember at the very
 *                 top; nebula (gas) warms to a rose-pink; a hull is metal,
 *                 dimmer.
 *   - `heatTint`  the most the body's own colour is covered (0..1).  Glass is
 *                 clear, so heat shows THROUGH it and covers less.
 *   - `heatEmit`  emissivity — how much of the T⁴ radiance becomes visible
 *                 light.  Plastic chars rather than glows.
 *
 *  Toned down on purpose (user call): tints stay translucent over the
 *  material and the glow is a warm spill, not a lamp. */
type HeatRamp = MaterialLook['heatRamp'];

/** A material's ramp at local temperature t (0..1) → [r, g, b]. */
function heatRgb(ramp: HeatRamp, t: number): [number, number, number] {
    const x = Math.min(1, Math.max(0, t));
    for (let i = 1; i < ramp.length; i++) {
        const a = ramp[i - 1], b = ramp[i];
        if (x <= b[0]) {
            const f = (x - a[0]) / (b[0] - a[0]);
            return [
                Math.round(a[1] + (b[1] - a[1]) * f),
                Math.round(a[2] + (b[2] - a[2]) * f),
                Math.round(a[3] + (b[3] - a[3]) * f),
            ];
        }
    }
    const l = ramp[ramp.length - 1];
    return [l[1], l[2], l[3]];
}

let _heatCtx: CanvasRenderingContext2D | null = null;
/** Per material, per peak-temperature bucket. */
const _bodyGrad = new Map<MaterialId, CanvasGradient[]>();
const _glowGrad = new Map<MaterialId, CanvasGradient[]>();

function peakBucket(p: number): number {
    return Math.min(HEAT_BUCKETS - 1, Math.max(0, Math.floor((p / PEAK_MAX) * HEAT_BUCKETS)));
}

function ensureHeatGradients(ctx: CanvasRenderingContext2D): void {
    if (_heatCtx === ctx) return;
    _heatCtx = ctx;
    _bodyGrad.clear();
    _glowGrad.clear();
    for (const mat of MATERIAL_IDS) {
        const look = materialDef(mat).look;
        const bodies: CanvasGradient[] = [], glows: CanvasGradient[] = [];
        for (let i = 0; i < HEAT_BUCKETS; i++) {
            const peak = ((i + 0.5) / HEAT_BUCKETS) * PEAK_MAX;
            // Body: each stop wears the colour of its OWN local temperature,
            // fading in with temperature and capped by the material's tint —
            // cold rim, hot core, the material still visible underneath.
            const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
            for (let k = 0; k < STOPS.length; k++) {
                const T = peak * PROFILE[k];
                const [r, g, b] = heatRgb(look.heatRamp, T);
                const a = k === STOPS.length - 1 ? 0 : look.heatTint * Math.min(1, T / 0.6);
                bg.addColorStop(STOPS[k], `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`);
            }
            bodies.push(bg);
            // Glow: light leaving the spot — the peak's colour on a soft
            // falloff to exactly zero, brightness carried by globalAlpha.
            const [r, g, b] = heatRgb(look.heatRamp, peak);
            const gg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
            gg.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.42)`);
            gg.addColorStop(0.25, `rgba(${r}, ${g}, ${b}, 0.2)`);
            gg.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, 0.06)`);
            gg.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
            glows.push(gg);
        }
        _bodyGrad.set(mat, bodies);
        _glowGrad.set(mat, glows);
    }
}

function renderHeat(
    ctx: CanvasRenderingContext2D, heated: readonly GameEntity[], camX: number, camY: number,
): void {
    ensureHeatGradients(ctx);
    const m = ctx.getTransform();
    const A = m.a, B = m.b, C = m.c, D = m.d, E = m.e, F = m.f;

    for (let pass = 0; pass < 2; pass++) {
        // Pass 0: EMISSION (additive).  Pass 1: INCANDESCENCE over the body.
        ctx.globalCompositeOperation = pass === 0 ? 'lighter' : 'source-over';
        for (let i = 0; i < heated.length; i++) {
            const e = heated[i];
            // The DRAWN temperature (eased in the sim tick), never the raw
            // peak: steps in the true value blend instead of flashing.
            const peak = e.heatShown ?? 0;
            if (!e.active || peak < HEAT_MIN) continue;
            const x = shiftX(camX, e.position.x), y = shiftY(camY, e.position.y);
            if (Math.abs(x - camX) > CULL || Math.abs(y - camY) > CULL) continue;
            const bodyR = Math.max(e.size.x, e.size.y) * 0.5;
            // No recorded spot (e.g. a burn with no contact): uniform.
            const sigma = Math.max(1, e.heatSpread ?? bodyR);
            // The spot, rotated into the world with the body.
            const rot = e.rotation || 0;
            const cs = Math.cos(rot), sn = Math.sin(rot);
            const lx = e.heatSpotX ?? 0, ly = e.heatSpotY ?? 0;
            const sx = x + cs * lx - sn * ly, sy = y + sn * lx + cs * ly;
            const b = peakBucket(peak);
            const mat = materialOf(e);
            const look = materialDef(mat).look;
            if (pass === 0) {
                const rad = heatRadiance(peak) * look.heatEmit;
                if (rad < 0.01) continue;
                // Light reaches past the hot region, further the hotter it is.
                const R = SIGMAS * sigma + bodyR * (0.35 + 0.5 * Math.min(1, peak));
                ctx.setTransform(A * R, B * R, C * R, D * R, A * sx + C * sy + E, B * sx + D * sy + F);
                ctx.globalAlpha = Math.min(1, rad);
                ctx.fillStyle = _glowGrad.get(mat)![b];
                ctx.fillRect(-1, -1, 2, 2);
            } else {
                const pts = e.polygonPoints;
                if (!pts || pts.length < 3 || look.heatTint <= 0) continue;
                // The outline, in the body's own rotated frame.
                ctx.setTransform(A * cs + C * sn, B * cs + D * sn, -A * sn + C * cs, -B * sn + D * cs,
                                 A * x + C * y + E, B * x + D * y + F);
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
                ctx.closePath();
                // The gradient is read in the transform current AT FILL time:
                // the path is already fixed in device space, so this scales the
                // unit Gaussian to σ around the spot (radial, so no rotation).
                const R = SIGMAS * sigma;
                ctx.setTransform(A * R, B * R, C * R, D * R, A * sx + C * sy + E, B * sx + D * sy + F);
                ctx.globalAlpha = 1;
                ctx.fillStyle = _bodyGrad.get(mat)![b];
                ctx.fill();
            }
        }
    }
    ctx.setTransform(A, B, C, D, E, F);
    ctx.globalAlpha = 1;
}
