/** ENERGY FEEDBACK — the world-space layer for the energy modules.
 *
 *  Minimal by design (§11): the material behaviour carries most of the
 *  communication; this adds the three cues nothing else draws.
 *
 *   - HEAT: the material ITSELF changes colour and gives off light — see
 *     `renderHeat`.  Nothing else draws heat: no rings, discs or sparks.
 *   - ENERGISED nebula: a flickering cyan rim while a cloud is steerable.
 *   - THE BEAM: the live beam pulse from the ship to what it touches.
 *
 *  Electric arcs reuse the existing lightning-arc particle, magnetism reuses
 *  particle streaks and a ring, explosions reuse the blast ring — none of
 *  those need anything here.  Reads only the view GameEngine hands the
 *  renderer each frame; walks lists that are bounded by construction.
 */
import { GameEntity, CameraState } from '../../../types';
import { shiftX, shiftY } from './drawUtils';

export interface EnergyBeamView {
    x0: number; y0: number; x1: number; y1: number;
    width: number; color: string; energy: string | undefined; hit: boolean;
}
export interface EnergyFxView {
    heated: readonly GameEntity[];
    energized: readonly GameEntity[];
    beam: EnergyBeamView | null;
    simClock: number;
}

const CULL = 1400;

export function renderEnergyFx(ctx: CanvasRenderingContext2D, view: EnergyFxView | null, camera: CameraState): void {
    if (!view) return;
    const camX = camera.position.x, camY = camera.position.y;
    const { heated, energized, beam } = view;
    if (heated.length === 0 && energized.length === 0 && !beam) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    if (heated.length > 0) renderHeat(ctx, heated, camX, camY);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < energized.length; i++) {
        const e = energized[i];
        if (!e.active) continue;
        const left = (e.energizedUntil ?? 0) - view.simClock;
        if (left <= 0) continue;
        const x = shiftX(camX, e.position.x), y = shiftY(camY, e.position.y);
        if (Math.abs(x - camX) > CULL || Math.abs(y - camY) > CULL) continue;
        ctx.globalAlpha = Math.min(0.6, left) * (0.5 + 0.5 * Math.random());
        ctx.strokeStyle = '#67e8f9';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(e.size.x, e.size.y) * 0.55, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Electric beams draw as arcs (lightning particles); everything else is
    // a line from the muzzle to the contact.
    if (beam && beam.energy !== 'electric') {
        const x0 = shiftX(camX, beam.x0), y0 = shiftY(camY, beam.y0);
        const x1 = x0 + (shiftX(beam.x0, beam.x1) - beam.x0);
        const y1 = y0 + (shiftY(beam.y0, beam.y1) - beam.y0);
        const magnetic = beam.energy === 'magnetic';
        ctx.lineCap = 'round';
        ctx.globalAlpha = magnetic ? 0.25 : 0.45;
        ctx.strokeStyle = beam.color;
        ctx.lineWidth = beam.width * (magnetic ? 1 : 2.2);
        if (magnetic) ctx.setLineDash([10, 12]);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.setLineDash([]);
        if (!magnetic) {
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(1, beam.width * 0.5);
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
            // A thermal beam's contact reads through the body it heats (the
            // heat pass above), so it draws no contact disc of its own.
            if (beam.hit && beam.energy !== 'thermal') {
                ctx.globalAlpha = 0.6;
                ctx.fillStyle = beam.color;
                ctx.beginPath(); ctx.arc(x1, y1, beam.width * 1.6 + 3, 0, Math.PI * 2); ctx.fill();
            }
        }
    }
    ctx.restore();
}

// ── HEAT ────────────────────────────────────────────────────────────────────
//
// Heat is shown two ways and only two (user call): the MATERIAL CHANGES
// COLOUR and it EMITS LIGHT.  Both are radial gradients, so neither has an
// edge of its own:
//
//   1. INCANDESCENCE — the body's own outline filled with a radial gradient
//      in the heat colour, hottest at the core.  The outline is the body's
//      real polygon, so the colour change is the shape of the thing that is
//      hot, never a circle laid over it.  Bodies with no polygon (enemy
//      hulls) and nebula (a cloud has no hard outline to fill) skip this and
//      take only the light.
//   2. EMISSION — an additive glow falling smoothly to zero around the body,
//      reaching further and brighter as it heats.
//
// COST.  Gradients are built ONCE per heat bucket at UNIT radius and cached
// per context; each body scales one by transform, so a frame allocates
// nothing and costs one fillRect (glow) plus one path fill (body) per
// on-screen heated body.  The heated set is bounded (MAX_HEATED) and culled
// to the view first.
//
// COLOUR follows a black-body ramp: dull red → red-orange → orange →
// yellow-white, so a body reads as heating up before it reads as failing.

const HEAT_BUCKETS = 16;
const HEAT_MIN = 0.05;

/** Black-body-ish ramp, t in 0..1 → [r, g, b]. */
function heatRgb(t: number): [number, number, number] {
    // Four stops, linearly blended.
    const stops: [number, number, number, number][] = [
        [0.0, 120, 18, 8],
        [0.35, 215, 55, 12],
        [0.7, 255, 135, 28],
        [1.0, 255, 228, 160],
    ];
    for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1], b = stops[i];
        if (t <= b[0]) {
            const f = (t - a[0]) / (b[0] - a[0]);
            return [
                Math.round(a[1] + (b[1] - a[1]) * f),
                Math.round(a[2] + (b[2] - a[2]) * f),
                Math.round(a[3] + (b[3] - a[3]) * f),
            ];
        }
    }
    const l = stops[stops.length - 1];
    return [l[1], l[2], l[3]];
}

let _heatCtx: CanvasRenderingContext2D | null = null;
const _bodyGrad: (CanvasGradient | null)[] = new Array(HEAT_BUCKETS).fill(null);
const _glowGrad: (CanvasGradient | null)[] = new Array(HEAT_BUCKETS).fill(null);

function heatBucket(h: number): number {
    const t = Math.min(1, Math.max(0, h));
    return Math.min(HEAT_BUCKETS - 1, Math.floor(t * HEAT_BUCKETS));
}

function ensureHeatGradients(ctx: CanvasRenderingContext2D): void {
    if (_heatCtx === ctx) return;
    _heatCtx = ctx;
    for (let i = 0; i < HEAT_BUCKETS; i++) {
        const t = (i + 0.5) / HEAT_BUCKETS;
        const [r, g, b] = heatRgb(t);
        const [er, eg, eb] = heatRgb(t * 0.55);
        // Body: hottest at the core, cooler toward the rim, never fully
        // transparent — the whole body changes colour, the core most.
        const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        bg.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
        bg.addColorStop(0.55, `rgba(${Math.round((r + er) / 2)}, ${Math.round((g + eg) / 2)}, ${Math.round((b + eb) / 2)}, 0.8)`);
        bg.addColorStop(1, `rgba(${er}, ${eg}, ${eb}, 0.55)`);
        _bodyGrad[i] = bg;
        // Glow: a smooth falloff to exactly zero at the unit radius, with
        // most of the energy close in — light, not a disc.
        const gg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        gg.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.55)`);
        gg.addColorStop(0.25, `rgba(${r}, ${g}, ${b}, 0.3)`);
        gg.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, 0.09)`);
        gg.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        _glowGrad[i] = gg;
    }
}

function renderHeat(
    ctx: CanvasRenderingContext2D, heated: readonly GameEntity[], camX: number, camY: number,
): void {
    ensureHeatGradients(ctx);
    // The world transform the renderer set up; each body composes onto it.
    const m = ctx.getTransform();
    const A = m.a, B = m.b, C = m.c, D = m.d, E = m.e, F = m.f;

    // 1. EMISSION (additive), then 2. INCANDESCENCE over the body, so the
    // body's own colour reads clearly on top of the light it gives off.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < heated.length; i++) {
        const e = heated[i];
        const h = e.heat ?? 0;
        if (!e.active || h < HEAT_MIN) continue;
        const x = shiftX(camX, e.position.x), y = shiftY(camY, e.position.y);
        if (Math.abs(x - camX) > CULL || Math.abs(y - camY) > CULL) continue;
        const t = Math.min(1, h);
        const R = Math.max(e.size.x, e.size.y) * (0.9 + 0.9 * t);
        ctx.setTransform(A * R, B * R, C * R, D * R, A * x + C * y + E, B * x + D * y + F);
        ctx.globalAlpha = Math.min(1, 0.15 + 0.85 * t);
        ctx.fillStyle = _glowGrad[heatBucket(h)]!;
        ctx.fillRect(-1, -1, 2, 2);
    }

    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < heated.length; i++) {
        const e = heated[i];
        const h = e.heat ?? 0;
        if (!e.active || h < HEAT_MIN) continue;
        const pts = e.polygonPoints;
        if (!pts || pts.length < 3 || e.shardVariant === 'nebula-tile' || e.shardVariant === 'nebula-shard') continue;
        const x = shiftX(camX, e.position.x), y = shiftY(camY, e.position.y);
        if (Math.abs(x - camX) > CULL || Math.abs(y - camY) > CULL) continue;
        const t = Math.min(1, h);
        // The outline, in the body's own rotated frame.
        const rot = e.rotation || 0;
        const cs = Math.cos(rot), sn = Math.sin(rot);
        ctx.setTransform(A * cs + C * sn, B * cs + D * sn, -A * sn + C * cs, -B * sn + D * cs,
                         A * x + C * y + E, B * x + D * y + F);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
        ctx.closePath();
        // The gradient is read in the transform current AT FILL time, so the
        // path (already fixed in device space) is filled with the unit
        // gradient scaled to the body.
        const R = Math.max(e.size.x, e.size.y) * 0.6;
        ctx.setTransform(A * R, B * R, C * R, D * R, A * x + C * y + E, B * x + D * y + F);
        ctx.globalAlpha = Math.min(0.85, 0.2 + 0.65 * t);
        ctx.fillStyle = _bodyGrad[heatBucket(h)]!;
        ctx.fill();
    }
    ctx.setTransform(A, B, C, D, E, F);
    ctx.globalAlpha = 1;
}
