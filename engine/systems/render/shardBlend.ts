/** The BONDED-PAIR blend pass — the "goo" layer.
 *
 *  A cohesion bond (ShardSystem) holds two bodies together, and for
 *  plastic that bond is `cohesionOnly`: the pair NEVER matures into the
 *  single re-polygonised entity every other variant's bond resolves to,
 *  so it stays two polygons touching for as long as it lives.  This pass
 *  draws the smooth-min union of those two hulls UNDERNEATH them, so the
 *  pair reads as one mass rather than two shapes in contact.
 *
 *  Two parts, and the policy can ask for either or both.  The COAT
 *  (`envelope`) envelops each bonded body in a rounded outward offset of
 *  its own hull, so the goo has a skin.  The BRIDGE is one metaball
 *  connector spanning the gap between those skins, waisted the way a
 *  smooth-min union of two circles is.  Bridge alone reads as two bodies
 *  welded at a joint; with the coat they read as one coated mass, which
 *  is the difference between "stuck together" and "in the same blob".
 *
 *  It is a PAIRWISE approximation of an SDF union rather than a sampled
 *  distance field, and that is exact here rather than a compromise: bond
 *  formation is a MATCHING — both formation sites in ShardSystem skip an
 *  entity that is already bonded — so a bond is never one edge of a
 *  larger cluster and there is no third body for a real field to blend
 *  in.  Cost is one path + one fill per visible bond, with no per-pixel
 *  work, no offscreen surface and no allocation.
 *
 *  Deliberately NOT a PerfController task, against CLAUDE.md §8's rule
 *  for new periodic work: the viewport cull below already bounds this to
 *  what fits on SCREEN, and at world scale that is a handful — the
 *  camera sees ~390×844 world units at zoom 1, against shards 20..200
 *  across.  Cadencing a purely visual pass would also flicker it, which
 *  is the one thing the frame-skip machinery cannot do to a draw call.
 *
 *  Nothing here feeds the sim.  Physics still resolves the two hulls as
 *  two polygons; this changes only what they look like.
 */

import type { CameraState, GameEntity } from '../../../types';
import { SHARD_VARIANTS, CAMERA_CONSTANTS, getActiveShardCoat } from '../../../constants';
import type { ShardBlendPolicy, ShardVariantId } from '../ShardSystem.types';
import { selectsVariant } from '../ShardSystem';
import type { RenderSystem } from '../RenderSystem';
import { shiftX, shiftY, roundedPolyPath } from './drawUtils';
import { mobileShardFillColor, tileFillColor, shardMergeFadeAlpha } from './tileShapes';
import { wrapDeltaX, wrapDeltaY } from '../../toroidal';

const HALF_PI = Math.PI / 2;

/** Bezier handle length as a multiple of the waist softness.  The
 *  canonical metaball value — it sets how convex the connector's flanks
 *  are between the two tangent points, and past ~3 they bulge out past
 *  the bodies themselves. */
const HANDLE_LEN_RATE = 2.4;

const clampUnit = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

/** The blend policy `selfId` expresses for a bond with `partnerId`, or
 *  null when this side declares none / does not select that partner. */
function blendFor(selfId: ShardVariantId, partnerId: ShardVariantId): ShardBlendPolicy | null {
    const bl = SHARD_VARIANTS[selfId]?.blend;
    if (!bl) return null;
    return selectsVariant(bl.appliesTo, partnerId, selfId) ? bl : null;
}

/**
 * How thick a coat of goo `selfId` wears in a bond with `partnerId`, in
 * world units, for a body of that circumradius.  Zero when this side is
 * not goo — which is the rule that matters: a body is coated on its OWN
 * variant's policy, never on its partner's, so plastic stuck to a glass
 * tile coats the plastic and leaves the tile a tile.
 *
 * Exported because "did we repaint the tile" is not a question the sim or
 * the stats payload can answer, and a screenshot of one green shard on a
 * green tile cannot answer it either.
 *
 * Scaled by the DBG "Goo coat" cycle, which multiplies whatever the
 * variant authored rather than replacing it — so a variant's own
 * `envelope` stays the statement of how thick that material's goo is,
 * and the knob only asks "more or less than that".
 */
export function coatMargin(
    selfId: ShardVariantId,
    partnerId: ShardVariantId,
    circumradius: number,
): number {
    const bl = blendFor(selfId, partnerId);
    if (!bl) return 0;
    return circumradius * (bl.envelope ?? 0) * getActiveShardCoat();
}

/**
 * Radius at which the bridge attaches to a body: how far the hull
 * actually reaches TOWARD its partner, scaled by `fraction`.
 *
 * Directional rather than a single circle, because these hulls are not
 * round.  A plastic shard is a 4-gon with vertex radii jittered
 * 0.65..1.10 of its base, so one face can stand nearly twice as far off
 * the centroid as another: a bridge anchored on any FIXED radius either
 * starts inside the body (a strand crossing visible plastic) or outside
 * it (a strand hanging in space).  Anchored on the hull's extent along
 * the line between the two centres, it starts at the face that is
 * actually pointed at the partner — which is where the goo would be.
 *
 * `fraction` then biases it slightly inward so the body drawn OVER the
 * bridge covers the join: the connector's own ends sit a little to
 * either side of that line, where the hull may have curved away.
 *
 * Polygon points are stored unrotated (the renderer applies `rotation`
 * in its per-entity transform), so the direction is taken into the
 * body's local frame first.  A body with no polygon is a disc, and its
 * extent is the same in every direction.
 */
export function blendAttachRadius(
    e: GameEntity,
    fraction: number,
    dirX: number,
    dirY: number,
): number {
    const circum = Math.max(e.size.x, e.size.y) * 0.5;
    const pts = e.polygonPoints;
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (!pts || pts.length < 3 || len < 1e-9) return circum * fraction;

    const rot = e.rotation ?? 0;
    const cs = Math.cos(-rot);
    const sn = Math.sin(-rot);
    const ux = dirX / len;
    const uy = dirY / len;
    const lx = ux * cs - uy * sn;
    const ly = ux * sn + uy * cs;

    // Where the ray from the centroid leaves the hull.  The centroid is
    // inside, so a convex hull yields exactly one crossing; MAX over the
    // crossings keeps a concave silhouette's outermost face rather than
    // an interior notch.
    let reach = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        const ex = q.x - p.x;
        const ey = q.y - p.y;
        const den = lx * ey - ly * ex;
        if (den > -1e-9 && den < 1e-9) continue;   // ray parallel to the edge
        const t = (p.x * ey - p.y * ex) / den;     // distance along the ray
        if (t <= 0) continue;                      // behind the centroid
        const u = (p.x * ly - p.y * lx) / den;     // position along the edge
        if (u < 0 || u > 1) continue;              // misses the segment
        if (t > reach) reach = t;
    }
    if (reach <= 0) return circum * fraction;
    return Math.min(reach, circum) * fraction;
}

/**
 * Draw the goo COAT around one body: its own hull, grown outward by
 * `margin`.
 *
 * The offset is done the cheap exact way — fill the hull, then stroke it
 * at twice the margin with ROUND joins, which is precisely the Minkowski
 * sum of the polygon with a disc of that radius.  Growing the polygon by
 * scaling it about its centroid instead would be wrong on these hulls:
 * a plastic shard's vertex radii span 0.65..1.10 of its base, so a
 * radial scale thickens the far corners and starves the near faces,
 * where a real coat is even all the way round.
 *
 * Drawn in the BODY's frame — polygon points are stored unrotated — and
 * under the hull, so the shard's own fill and outline land on top and
 * only the margin shows as a rim.  A body with no polygon coats as a
 * disc, which is what it is.
 */
function drawEnvelope(
    ctx: CanvasRenderingContext2D,
    e: GameEntity,
    x: number,
    y: number,
    margin: number,
    fill: string,
): void {
    if (!(margin > 0)) return;
    const pts = e.polygonPoints;
    // Same corner rounding the body itself is drawn with, so the coat
    // hugs the silhouette instead of poking hard corners out past a
    // rounded hull.
    const rounding = e.shardVariant
        ? (SHARD_VARIANTS[e.shardVariant]?.cornerRounding ?? 0) : 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(e.rotation ?? 0);
    if (pts && pts.length >= 3) {
        roundedPolyPath(ctx, pts, rounding);
    } else {
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(e.size.x, e.size.y) * 0.5, 0, Math.PI * 2);
    }
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = fill;
    ctx.lineWidth = margin * 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
}

/**
 * Trace the metaball connector between two circles into `ctx`'s current
 * path.  Returns false — leaving the path untouched — when the pair has
 * no waist to draw: coincident centres, or one circle swallowing the
 * other (which is also the case that puts the `acos` below out of
 * domain).
 *
 * Pure geometry, no fill: the caller owns the paint.  Exported so it can
 * be pinned directly rather than through sampled pixels.
 */
export function buildFilletPath(
    ctx: CanvasRenderingContext2D,
    ax: number, ay: number, ar: number,
    bx: number, by: number, br: number,
    softness: number,
): boolean {
    if (!(ar > 0) || !(br > 0)) return false;
    const dx = bx - ax;
    const dy = by - ay;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (!(d > 0)) return false;
    if (d <= Math.abs(ar - br)) return false;

    // Half-angle each circle's chord subtends where the two OVERLAP.
    // Separated circles have no chord, so the connector springs from the
    // tangent line instead (u = 0) and the waist is at its thinnest.
    let u1 = 0;
    let u2 = 0;
    if (d < ar + br) {
        u1 = Math.acos(clampUnit((ar * ar + d * d - br * br) / (2 * ar * d)));
        u2 = Math.acos(clampUnit((br * br + d * d - ar * ar) / (2 * br * d)));
    }
    const angle1 = Math.atan2(dy, dx);
    const angle2 = Math.acos(clampUnit((ar - br) / d));

    // Softness slides each attach point between the overlap chord (0)
    // and the outer tangent (1) — how far around each body the goo
    // climbs before it necks in.
    const a1a = angle1 + u1 + (angle2 - u1) * softness;
    const a1b = angle1 - u1 - (angle2 - u1) * softness;
    const a2a = angle1 + Math.PI - u2 - (Math.PI - u2 - angle2) * softness;
    const a2b = angle1 - Math.PI + u2 + (Math.PI - u2 - angle2) * softness;

    const p1x = ax + Math.cos(a1a) * ar, p1y = ay + Math.sin(a1a) * ar;
    const p2x = ax + Math.cos(a1b) * ar, p2y = ay + Math.sin(a1b) * ar;
    const p3x = bx + Math.cos(a2a) * br, p3y = by + Math.sin(a2a) * br;
    const p4x = bx + Math.cos(a2b) * br, p4y = by + Math.sin(a2b) * br;

    // Handle length falls off with the span, so a pair pulling apart
    // thins to a filament instead of keeping a fat weld until it snaps.
    const total = ar + br;
    const spanX = p3x - p1x, spanY = p3y - p1y;
    let handle = Math.min(softness * HANDLE_LEN_RATE,
                          Math.sqrt(spanX * spanX + spanY * spanY) / total);
    handle *= Math.min(1, d * 2 / total);
    const h1 = ar * handle;
    const h2 = br * handle;

    ctx.beginPath();
    ctx.moveTo(p1x, p1y);
    ctx.bezierCurveTo(
        p1x + Math.cos(a1a - HALF_PI) * h1, p1y + Math.sin(a1a - HALF_PI) * h1,
        p3x + Math.cos(a2a + HALF_PI) * h2, p3y + Math.sin(a2a + HALF_PI) * h2,
        p3x, p3y);
    ctx.lineTo(p4x, p4y);
    ctx.bezierCurveTo(
        p4x + Math.cos(a2b - HALF_PI) * h2, p4y + Math.sin(a2b - HALF_PI) * h2,
        p2x + Math.cos(a1b + HALF_PI) * h1, p2y + Math.sin(a1b + HALF_PI) * h1,
        p2x, p2y);
    ctx.closePath();
    return true;
}

/** The bridge wears the SOURCE body's own fill, so goo is the colour of
 *  the goo — a plastic shard stuck to a glass tile bridges in plastic.
 *  Routed through the same two colour functions the bodies themselves
 *  use (density tint, automata shade and all) so the two cannot drift. */
function blendFillColor(r: RenderSystem, e: GameEntity): string {
    return e.mass === Infinity ? tileFillColor(r, e) : mobileShardFillColor(r, e);
}

/**
 * Draw every visible bonded pair's connector.  Called from the frame
 * orchestration AFTER the static-tile blit and BEFORE the entity pass,
 * so the bridge sits under the mobile hulls (which cover its ends) and
 * over a static tile it is stuck to (where it reads as goo spilling onto
 * the face).
 *
 * World space — the caller has the camera transform applied.
 */
export function renderShardBlends(
    r: RenderSystem,
    ctx: CanvasRenderingContext2D,
    camera: CameraState,
    width: number,
    height: number,
): void {
    r.lastShardBlendCount = 0;
    const shards = r.shards;
    if (!shards || !r.shardBlendEnabled) return;
    const bonds = shards.liveBonds;
    if (bonds.length === 0) return;

    const camX = camera.position.x;
    const camY = camera.position.y;
    const halfW = (width / 2) / camera.zoom + CAMERA_CONSTANTS.CULL_MARGIN;
    const halfH = (height / 2) / camera.zoom + CAMERA_CONSTANTS.CULL_MARGIN;

    const prevAlpha = ctx.globalAlpha;
    for (let i = 0; i < bonds.length; i++) {
        const a = bonds[i].a;
        const b = bonds[i].b;
        if (!a.active || !b.active) continue;
        const av = a.shardVariant;
        const bv = b.shardVariant;
        if (av === undefined || bv === undefined) continue;

        // Which side is the goo?  BOTH can be (a plastic↔plastic bond),
        // and the question is asked per body rather than per bond: each
        // one is coated only if ITS OWN variant declares a policy that
        // selects the partner.  That is what keeps a plastic shard stuck
        // to a glass tile from repainting the tile's face in plastic —
        // the tile is what the goo is stuck TO, not goo.
        const aPolicy = blendFor(av, bv);
        const bPolicy = blendFor(bv, av);
        // The BRIDGE has to pick one shade, so the larger body wins: it
        // dominates the silhouette, so its shade is the one the join
        // should match.
        let src: GameEntity;
        let dst: GameEntity;
        let policy: ShardBlendPolicy;
        if (aPolicy && bPolicy) {
            const aWins = a.size.x >= b.size.x;
            src = aWins ? a : b; dst = aWins ? b : a;
            policy = aWins ? aPolicy : bPolicy;
        } else if (aPolicy) {
            src = a; dst = b; policy = aPolicy;
        } else if (bPolicy) {
            src = b; dst = a; policy = bPolicy;
        } else {
            continue;
        }
        const srcVariant = src === a ? av : bv;
        const dstVariant = src === a ? bv : av;

        // Torus: shift the source into the camera's wrap zone, then place
        // the partner RELATIVE to it.  A bond can straddle the seam, and
        // shifting each end independently would draw a bridge across the
        // whole map (the same trap composeEntities' centroid math avoids).
        const sx = shiftX(camX, src.position.x);
        const sy = shiftY(camY, src.position.y);
        const dx = sx + wrapDeltaX(src.position.x, dst.position.x);
        const dy = sy + wrapDeltaY(src.position.y, dst.position.y);
        if ((Math.abs(sx - camX) > halfW || Math.abs(sy - camY) > halfH)
            && (Math.abs(dx - camX) > halfW || Math.abs(dy - camY) > halfH)) continue;

        const gapX = dx - sx;
        const gapY = dy - sy;
        const span = Math.sqrt(gapX * gapX + gapY * gapY);

        // Coat thickness, per body and from that body's OWN policy — a
        // fraction of its circumradius, so the skin scales with a shard
        // instead of swamping a 20px one and vanishing on a 200px one.
        const srcCircum = Math.max(src.size.x, src.size.y) * 0.5;
        const dstCircum = Math.max(dst.size.x, dst.size.y) * 0.5;
        const srcMargin = coatMargin(srcVariant, dstVariant, srcCircum);
        const dstMargin = coatMargin(dstVariant, srcVariant, dstCircum);

        // Span gate.  Measured against the two CIRCUMRADII — the same
        // quantity ShardSystem's contact test uses — so the gate is a
        // multiple of contact distance and means what it says.  (Against
        // the attach radii it would drift with attachFraction and reject
        // pairs that had only just bonded.)  A bond itself survives to
        // 1.5× contact, and 6× on a 'strong' pair: well past the point
        // where the goo still reads as joined, so the bridge is dropped
        // rather than drawn as a thread across open space.  The coats are
        // added on top because two skins that still touch are still one
        // mass, whatever the hulls under them are doing.
        const contact = srcCircum + dstCircum;
        if (span > contact * (policy.maxSpan ?? 1.35) + srcMargin + dstMargin) continue;

        ctx.globalAlpha = (policy.alpha ?? 1) * shardMergeFadeAlpha(src);

        // The COAT — each goo body enveloped in its own shade, so a
        // plastic pair of two different shades stays two shades.
        const srcFill = blendFillColor(r, src);
        drawEnvelope(ctx, src, sx, sy, srcMargin, srcFill);
        if (dstMargin > 0) drawEnvelope(ctx, dst, dx, dy, dstMargin, blendFillColor(r, dst));

        // The BRIDGE, attached at the OUTSIDE of each coat so it runs
        // into the skin rather than emerging from under it.
        const frac = policy.attachFraction ?? 0.9;
        const sr = blendAttachRadius(src, frac, gapX, gapY) + srcMargin;
        const dr = blendAttachRadius(dst, frac, -gapX, -gapY) + dstMargin;

        let drew = srcMargin > 0 || dstMargin > 0;
        if (buildFilletPath(ctx, sx, sy, sr, dx, dy, dr, policy.softness ?? 0.5)) {
            ctx.fillStyle = srcFill;
            ctx.fill();
            drew = true;
        }
        // Counted only when something actually landed: a pair whose coats
        // have swallowed each other draws no bridge, and a policy with no
        // coat and a refused bridge draws nothing at all.
        if (drew) r.lastShardBlendCount++;
    }
    ctx.globalAlpha = prevAlpha;
}
