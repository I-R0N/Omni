/** TRAILS, PARTICLES and LIGHTNING ARCS — the world-space effects passes.
 *
 *  Extracted verbatim from `RenderSystem.ts` in gauntlet 5f (see
 *  `docs/GAUNTLET_5F_LOG.md`).  Three things that all draw ephemera rather
 *  than entities: the ribbon trails behind the player and every projectile,
 *  the pooled particle sprites, and the jagged lightning arc.
 *
 *  Four functions take the `RenderSystem` as a first parameter, and only for
 *  its persistent state: the reusable trail scratch buffers (`_trailNX` …)
 *  that keep the strip builder from allocating per frame — the mutate-don't-
 *  allocate rule of CLAUDE.md §8 — and the DBG-selected `trailShape`.
 *  `RenderSystem` is a TYPE import, so it is erased at compile time and there
 *  is no runtime cycle.
 */
import type { RenderSystem } from '../RenderSystem';
import { GameEntity, EntityType, CameraState, TrailPoint, TrailShape, Vector2 } from '../../../types';
import {
    COLORS, PLAYER_TRAIL_CONSTANTS, TRAIL_CONSTANTS, GLITTER_TRAIL_CONSTANTS,
    PROJECTILE_CONSTANTS, LIGHTNING_ARC_LIFETIME, SNITCH_CONSTANTS,
} from '../../../constants';
import { wrapDeltaX, wrapDeltaY, HALF_MAP_WIDTH } from '../../toroidal';
import { shiftX, shiftY, hexToRgb } from './drawUtils';

export function renderTrails(
    r: RenderSystem,
    ctx: CanvasRenderingContext2D,
    entries: { entity: GameEntity, rx: number, ry: number }[],
    camera: CameraState,
) {
    entries.forEach(({ entity }) => {
        if (!entity.active || !entity.trail || entity.trail.length < 1) return;
        if (entity.type === EntityType.PLAYER) {
            if (r.trailShape === TrailShape.NONE) return;
            drawPlayerTrail(r, ctx, entity.trail, camera);
        } else if ((entity.type === EntityType.PROJECTILE || entity.isSnitch) && entity.trail.length >= 2) {
            // Snitch comet tail reuses the projectile strip — entity.color
            // is the snitch's gold core colour.
            drawTrailStrip(r, ctx, entity.trail, 'projectile', camera, entity.color, entity.isBouncer);
        }
    });
}

// Player trail: each TrailPoint renders as a stroked shape that grows from
// START_RADIUS to END_RADIUS over its lifetime while alpha fades to zero.
// Shape is selected from the debug panel (CIRCLE / SQUARE / TRIANGLE / LINE
// / PATH); NONE is filtered out earlier so we never enter this method for it.
export function drawPlayerTrail(
    r: RenderSystem,
    ctx: CanvasRenderingContext2D,
    t: TrailPoint[],
    camera: CameraState,
) {
    const camX = camera.position.x;
    const camY = camera.position.y;
    const startR = PLAYER_TRAIL_CONSTANTS.START_RADIUS;
    const endR   = PLAYER_TRAIL_CONSTANTS.END_RADIUS;
    const peak   = PLAYER_TRAIL_CONSTANTS.PEAK_ALPHA;
    const color  = PLAYER_TRAIL_CONSTANTS.COLOR;
    const shape  = r.trailShape;

    ctx.lineWidth = PLAYER_TRAIL_CONSTANTS.LINE_WIDTH;

    // PATH: single polyline through every emitted point — a continuous
    // breadcrumb of the player's recent path rather than per-point shapes.
    if (shape === TrailShape.PATH) {
        drawPlayerTrailPath(ctx, t, camX, camY, color, peak);
        return;
    }
    for (let i = 0; i < t.length; i++) {
        const p = t[i];
        if (p.maxLifetime <= 0 || p.lifetime <= 0) continue;
        const ratio = p.lifetime / p.maxLifetime; // 1 at birth → 0 at death
        const age = 1 - ratio;
        const radius = startR + (endR - startR) * age;
        const alpha = peak * ratio;
        const sx = shiftX(camX, p.x);
        const sy = shiftY(camY, p.y);
        ctx.strokeStyle = `rgba(${color}, ${alpha})`;

        switch (shape) {
            case TrailShape.CIRCLE: {
                ctx.beginPath();
                ctx.arc(sx, sy, radius, 0, Math.PI * 2);
                ctx.stroke();
                break;
            }
            case TrailShape.SQUARE: {
                // Axis-aligned square inscribed in the same radius envelope
                const d = radius * 2;
                ctx.strokeRect(sx - radius, sy - radius, d, d);
                break;
            }
            case TrailShape.TRIANGLE: {
                // Equilateral triangle pointing along the emit-time velocity
                // vector so it visually streams in the direction of travel.
                const ang = p.angle ?? 0;
                const cos = Math.cos(ang);
                const sin = Math.sin(ang);
                // Tip in front, two base corners behind ±120°
                const tipX = sx + cos * radius;
                const tipY = sy + sin * radius;
                const back = -radius * 0.5;
                const side = radius * 0.866; // sin(60°)
                const blX = sx + cos * back - sin * side;
                const blY = sy + sin * back + cos * side;
                const brX = sx + cos * back + sin * side;
                const brY = sy + sin * back - cos * side;
                ctx.beginPath();
                ctx.moveTo(tipX, tipY);
                ctx.lineTo(blX, blY);
                ctx.lineTo(brX, brY);
                ctx.closePath();
                ctx.stroke();
                break;
            }
            case TrailShape.LINE: {
                // Straight line perpendicular to travel direction, growing
                // outward from the centre — reads as a wake bar dropped
                // behind the ship.
                const ang = (p.angle ?? 0) + Math.PI / 2;
                const cos = Math.cos(ang);
                const sin = Math.sin(ang);
                ctx.beginPath();
                ctx.moveTo(sx - cos * radius, sy - sin * radius);
                ctx.lineTo(sx + cos * radius, sy + sin * radius);
                ctx.stroke();
                break;
            }
            case TrailShape.DOTS: {
                // Filled dot at fixed START_RADIUS — does not expand;
                // only alpha fades over lifetime.
                ctx.fillStyle = `rgba(${color}, ${alpha})`;
                ctx.beginPath();
                ctx.arc(sx, sy, startR, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
        }
    }
}

// Continuous polyline through every active trail point.  Each segment is
// stroked individually with alpha driven by the *older* endpoint's own
// lifetime ratio so the tail segment fades to zero just before its
// source point is culled (otherwise the path would lose whole segments
// at full opacity every EMIT_INTERVAL and read as choppy).  The ratio
// is squared so the fade is visible mid-trail during continuous thrust,
// not just near the disappearing tail.  Segments are skipped when:
//   • the newer point is flagged chainStart (thrust restart — old chain
//     should keep fading on its own, no bridge to the new chain), or
//   • consecutive shifted points straddle a wrap seam.
// (Earlier revisions added a 50-u distance defense-in-depth threshold,
// but THRUST mode drifts each point in -input direction over its
// lifetime, which legitimately produces consecutive-point gaps larger
// than 50 u at low throttle — the threshold then incorrectly killed
// every PATH segment.  chainStart is reliably latched until consumed,
// so the distance fallback is no longer pulling its weight.)
function drawPlayerTrailPath(
    ctx: CanvasRenderingContext2D,
    t: TrailPoint[],
    camX: number,
    camY: number,
    color: string,
    peak: number,
) {
    if (t.length < 2) return;

    const SEAM_BREAK_SQ = (HALF_MAP_WIDTH * 0.5) * (HALF_MAP_WIDTH * 0.5);
    let prevX = shiftX(camX, t[0].x);
    let prevY = shiftY(camY, t[0].y);
    for (let i = 1; i < t.length; i++) {
        const cx = shiftX(camX, t[i].x);
        const cy = shiftY(camY, t[i].y);
        const dx = cx - prevX;
        const dy = cy - prevY;
        const seamSpan = dx * dx + dy * dy > SEAM_BREAK_SQ;
        if (!seamSpan && !t[i].chainStart) {
            const p0 = t[i - 1];
            const r0 = p0.maxLifetime > 0 ? Math.max(0, Math.min(1, p0.lifetime / p0.maxLifetime)) : 0;
            if (r0 > 0) {
                // Squared ratio biases more of the fade toward the head
                // half of the trail so the gradient reads even while
                // new points are constantly being emitted.
                ctx.strokeStyle = `rgba(${color}, ${peak * r0 * r0})`;
                ctx.beginPath();
                ctx.moveTo(prevX, prevY);
                ctx.lineTo(cx, cy);
                ctx.stroke();
            }
        }
        prevX = cx;
        prevY = cy;
    }
}

function ensureTrailScratch(r: RenderSystem, n: number) {
    if (r._trailShiftedX.length < n) {
        const next = Math.max(n, r._trailShiftedX.length * 2);
        r._trailShiftedX = new Float32Array(next);
        r._trailShiftedY = new Float32Array(next);
        r._trailNX = new Float32Array(next);
        r._trailNY = new Float32Array(next);
    }
}

export function drawTrailStrip(
    r: RenderSystem,
    ctx: CanvasRenderingContext2D,
    t: TrailPoint[],
    mode: 'projectile',
    camera: CameraState,
    entityColor?: string,
    isBouncer?: boolean
) {
    // Pre-shift every trail point into the camera's wrap zone so a trail
    // that spans a seam (emitter just wrapped) renders as one continuous
    // strip rather than a huge discontinuity across the map.  All the
    // normal-calc / gradient math below operates on the shifted copies.
    ensureTrailScratch(r, t.length);
    const sx = r._trailShiftedX;
    const sy = r._trailShiftedY;
    const camX = camera.position.x;
    const camY = camera.position.y;
    for (let i = 0; i < t.length; i++) {
        sx[i] = shiftX(camX, t[i].x);
        sy[i] = shiftY(camY, t[i].y);
    }
    // --- OPTIMIZATION: Polygon Strip (One draw call per trail) ---
    ctx.beginPath();

    // Pre-compute per-point normals once.  The forward and backward
    // strip passes below use identical normals (they only differ in
    // the sign of the width offset), so doing this in one pass replaces
    // 2N sqrt+div pairs with N — eliminating ~half the trig cost on
    // every visible projectile trail.
    const nxBuf = r._trailNX;
    const nyBuf = r._trailNY;
    const n = t.length;
    for (let i = 0; i < n; i++) {
        let dx = 0, dy = 0;
        if (i < n - 1) {
            dx = sx[i+1] - sx[i];
            dy = sy[i+1] - sy[i];
        } else if (i > 0) {
            dx = sx[i] - sx[i-1];
            dy = sy[i] - sy[i-1];
        }
        const lenSq = dx*dx + dy*dy;
        if (lenSq > 0.000001) {
            const inv = 1 / Math.sqrt(lenSq);
            nxBuf[i] = -dy * inv;
            nyBuf[i] = dx * inv;
        } else {
            nxBuf[i] = 0;
            nyBuf[i] = 0;
        }
    }

    // Forward pass: Right side of trail
    for (let i = 0; i < n; i++) {
        const p = t[i];
        const ratio = p.lifetime / p.maxLifetime;
        if (ratio <= 0) continue;
        const width = (p.scale ?? 1) * (1 + (ratio * 5)) / 2; // Half width
        ctx.lineTo(sx[i] + nxBuf[i] * width, sy[i] + nyBuf[i] * width);
    }

    // Backward pass: Left side of trail (same normals, negated width).
    for (let i = n - 1; i >= 0; i--) {
        const p = t[i];
        const ratio = p.lifetime / p.maxLifetime;
        if (ratio <= 0) continue;
        const width = (p.scale ?? 1) * (1 + (ratio * 5)) / 2;
        ctx.lineTo(sx[i] - nxBuf[i] * width, sy[i] - nyBuf[i] * width);
    }

    ctx.closePath();

    // Gradient fade — alpha max scales with the head point's own lifetime
    // so the trail dims uniformly as its newest point ages out.
    const head = t[t.length - 1];
    const headRatio = Math.max(0, Math.min(1, head.lifetime / head.maxLifetime));
    if (isBouncer) {
        // Bouncer beam: solid pure-green line with no fade along the trail.
        // The short lifetime already makes the beam self-limiting; we want
        // it sharp while it's visible.
        const [r, g, b] = hexToRgb(entityColor || '#22c55e');
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 1)`;
    } else {
        const grad = ctx.createLinearGradient(sx[0], sy[0], sx[t.length - 1], sy[t.length - 1]);
        const [r, g, b] = hexToRgb(entityColor || '#facc15');
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${0.75 * headRatio})`);
        ctx.fillStyle = grad;
    }
    ctx.fill();
}

export function renderParticles(
    r: RenderSystem,
    ctx: CanvasRenderingContext2D,
    entries: { entity: GameEntity, rx: number, ry: number }[],
    camera: CameraState,
) {
    if (entries.length === 0) return;
    ctx.globalCompositeOperation = 'lighter';
    // Run-length state tracking: a death burst is dozens of same-colour
    // discs with near-identical alpha, so skipping redundant fillStyle
    // (re-parsed each assignment) and globalAlpha writes cuts the canvas
    // state churn.  Invalidated (set to sentinels) around the special
    // branches below, which mutate ctx state themselves.
    let lastColor = '';
    let lastAlphaQ = -1;
    for (let i = 0; i < entries.length; i++) {
        const { entity: p, rx, ry } = entries[i];

        // Lightning arc particles use a dedicated renderer
        if (p.isLightningArc) {
            renderLightningArc(ctx, p, camera);
            lastColor = ''; lastAlphaQ = -1;
            continue;
        }

        // Cannon explosion shock ring: radius scales from 0 → full over
        // the particle's lifetime; alpha fades 1 → 0.  Drawn in `lighter`
        // composite mode so the ring blooms over enemies/sparks.
        if (p.isExplosionRing) {
            const r = p.explosionRadius ?? 0;
            if (r > 0) {
                const life = p.lifetime || 0;
                const maxLife = p.maxLifetime || 1;
                const lifeRatio = Math.max(0, Math.min(1, life / maxLife));
                const expand = 1 - lifeRatio; // 0 at spawn, 1 at end
                const radius = r * expand;
                const alpha = lifeRatio;     // fade out as it grows

                // Outer purple ring (the shock front).
                ctx.strokeStyle = p.color;
                ctx.globalAlpha = alpha;
                ctx.lineWidth = 3 + 4 * (1 - lifeRatio); // thickens slightly as it grows
                ctx.beginPath();
                ctx.arc(rx, ry, radius, 0, Math.PI * 2);
                ctx.stroke();

                // Inner white-hot rim — thinner, brighter, just inside
                // the shock front, enhances the "snap" of the impact.
                ctx.strokeStyle = '#ffffff';
                ctx.globalAlpha = alpha * 0.55;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(rx, ry, Math.max(0, radius - 3), 0, Math.PI * 2);
                ctx.stroke();
            }
            lastColor = ''; lastAlphaQ = -1;
            continue;
        }

        const lifeRatio = (p.lifetime || 0) / (p.maxLifetime || 1);
        // Quantise alpha to 1/64 (imperceptible) so a run of same-fade
        // particles reuses one globalAlpha write.
        const aq = (lifeRatio * 64) | 0;
        if (aq !== lastAlphaQ) { ctx.globalAlpha = aq / 64; lastAlphaQ = aq; }
        if (p.color !== lastColor) { ctx.fillStyle = p.color; lastColor = p.color; }
        ctx.beginPath();
        ctx.arc(rx, ry, p.size.x, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1.0;
}

export function renderLightningArc(ctx: CanvasRenderingContext2D, particle: GameEntity, camera: CameraState) {
    const points = particle.arcPoints;
    if (!points || points.length < 2) return;

    const lifeRatio = (particle.lifetime || 0) / (particle.maxLifetime || 1);
    const alpha = lifeRatio; // fade over lifetime

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Shift each chain node into the camera's wrap zone so arcs that
    // span a seam draw as one continuous bolt rather than crossing
    // the whole map diagonally.
    const camX = camera.position.x;
    const camY = camera.position.y;

    // Draw jagged arc between each pair of chain points
    for (let seg = 0; seg < points.length - 1; seg++) {
        const rawA = points[seg];
        const rawB = points[seg + 1];
        const a = { x: shiftX(camX, rawA.x), y: shiftY(camY, rawA.y) };
        const b = { x: shiftX(camX, rawB.x), y: shiftY(camY, rawB.y) };

        // Generate zigzag midpoints perpendicular to the segment
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1) continue;

        // Perpendicular direction
        const nx = -dy / len;
        const ny = dx / len;

        const segCount = 5; // number of subdivisions
        const zigzag: Vector2[] = [{ x: a.x, y: a.y }];

        for (let i = 1; i < segCount; i++) {
            const t = i / segCount;
            const mx = a.x + dx * t;
            const my = a.y + dy * t;
            // Random perpendicular offset (scales with segment length)
            const offset = (Math.random() - 0.5) * len * 0.25;
            zigzag.push({ x: mx + nx * offset, y: my + ny * offset });
        }
        zigzag.push({ x: b.x, y: b.y });

        // Draw outer white glow
        ctx.globalAlpha = alpha * 0.5;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(zigzag[0].x, zigzag[0].y);
        for (let i = 1; i < zigzag.length; i++) {
            ctx.lineTo(zigzag[i].x, zigzag[i].y);
        }
        ctx.stroke();

        // Draw cyan electric core
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(zigzag[0].x, zigzag[0].y);
        for (let i = 1; i < zigzag.length; i++) {
            ctx.lineTo(zigzag[i].x, zigzag[i].y);
        }
        ctx.stroke();
    }

    // Small bloom at each chain node
    for (let i = 1; i < points.length; i++) {
        const raw = points[i];
        const px = shiftX(camX, raw.x);
        const py = shiftY(camY, raw.y);
        ctx.globalAlpha = alpha * 0.7;
        const nodeGrad = ctx.createRadialGradient(px, py, 0, px, py, 14);
        nodeGrad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
        nodeGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.4)');
        nodeGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = nodeGrad;
        ctx.beginPath();
        ctx.arc(px, py, 14, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
}
