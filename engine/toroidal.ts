/**
 * Toroidal world helpers — the playable map is a torus: positions wrap
 * around at ±MAP_WIDTH/2 and ±MAP_HEIGHT/2 on the X and Y axes.
 *
 * Rationale: every distance / direction / neighbor calculation in the
 * engine must use the shorter of "direct delta" and "delta ± mapSize"
 * so targeting, AI vision, lightning chains, and pathfinding don't
 * ignore entities sitting just across a seam.  Rendering handles the
 * seam by duplicate-drawing entities at every wrap offset that falls
 * inside the camera frustum (see `forEachWrapOffset`).
 *
 * Keep this module free of game-specific types so it can be imported
 * from engine/systems, engine/maps, and the renderer without cycles.
 */

import { Vector2 } from '../types';

// ── Map size ──────────────────────────────────────────────────────────────
// The universe is 20000×20000 world units — reduced from the prior
// 30000×30000 bounding box so the wrap is actually meaningful at the
// scales of AI vision (2500) and enemy pursuit (~4600 units).  Axis
// sizes are stored separately so the map can become non-square later
// without touching every call site.
export const MAP_WIDTH  = 20000;
export const MAP_HEIGHT = 20000;
export const HALF_MAP_WIDTH  = MAP_WIDTH  / 2;
export const HALF_MAP_HEIGHT = MAP_HEIGHT / 2;

/**
 * Wrap a scalar world coordinate into [-HALF_MAP, +HALF_MAP).  Uses a
 * double-mod trick to handle negative inputs correctly (JS `%` is the
 * remainder operator, not modulo).
 */
export function wrapX(x: number): number {
    const m = ((x + HALF_MAP_WIDTH) % MAP_WIDTH + MAP_WIDTH) % MAP_WIDTH;
    return m - HALF_MAP_WIDTH;
}
export function wrapY(y: number): number {
    const m = ((y + HALF_MAP_HEIGHT) % MAP_HEIGHT + MAP_HEIGHT) % MAP_HEIGHT;
    return m - HALF_MAP_HEIGHT;
}

/**
 * Wrap a position vector in place.  Call after every integration step
 * so entity positions never drift out of the canonical [-HALF, HALF) box.
 */
export function wrapPosition(p: Vector2): void {
    p.x = wrapX(p.x);
    p.y = wrapY(p.y);
}

/**
 * Minimum-magnitude component delta `to - from` on a torus.  For any
 * two positions, returns the delta whose absolute value is ≤ half the
 * map size — i.e. the "shorter way around" the loop.
 *
 * Example on a 20000-wide torus: if from.x = 9900 and to.x = -9900,
 * the direct delta is -19800 but the toroidal delta is +200 (wrap
 * across the right seam).
 */
export function wrapDeltaX(from: number, to: number): number {
    let d = to - from;
    if (d >  HALF_MAP_WIDTH) d -= MAP_WIDTH;
    else if (d < -HALF_MAP_WIDTH) d += MAP_WIDTH;
    return d;
}
export function wrapDeltaY(from: number, to: number): number {
    let d = to - from;
    if (d >  HALF_MAP_HEIGHT) d -= MAP_HEIGHT;
    else if (d < -HALF_MAP_HEIGHT) d += MAP_HEIGHT;
    return d;
}

/**
 * Toroidal squared distance — O(1), branch-free on the hot path.
 * Prefer this over `toroidalDist` wherever a squared compare is enough
 * (range checks, nearest-neighbor picks, etc.).
 */
export function toroidalDistSq(a: Vector2, b: Vector2): number {
    const dx = wrapDeltaX(a.x, b.x);
    const dy = wrapDeltaY(a.y, b.y);
    return dx * dx + dy * dy;
}

export function toroidalDist(a: Vector2, b: Vector2): number {
    return Math.sqrt(toroidalDistSq(a, b));
}

/**
 * Enumerate up to 9 canvas-space offsets for an entity at world position
 * (wx, wy) given a rectangular camera-frustum viewport in world coords.
 * For each wrap direction (±MAP_WIDTH / ±MAP_HEIGHT) that lands the
 * entity inside the frustum (+cullMargin), the callback is invoked
 * with the offset position.
 *
 * Used by the renderer so entities near a seam are drawn twice — once
 * at their canonical position and once at their wrapped position if
 * that wrapped copy is visible.  Leaves the rest of the render pass
 * untouched; the camera transform stays anchored to world coordinates.
 *
 * `radius` is the entity's rough visible radius: we still call the
 * callback when only part of the entity pokes into the frustum so its
 * geometry doesn't pop in at the edge.
 */
export function forEachWrapOffset(
    wx: number, wy: number, radius: number,
    left: number, right: number, top: number, bottom: number,
    cb: (ox: number, oy: number) => void,
): void {
    // The 3x3 neighborhood covers every torus shift that could land an
    // entity inside a viewport whose half-extent is < HALF_MAP.  If the
    // viewport ever exceeds half the map size the caller's frustum is
    // bigger than one wrap unit and the entity must be visible somewhere
    // anyway, so a single-iteration pass is always sufficient.
    for (let oy = -1; oy <= 1; oy++) {
        const wyo = wy + oy * MAP_HEIGHT;
        if (wyo + radius < top || wyo - radius > bottom) continue;
        for (let ox = -1; ox <= 1; ox++) {
            const wxo = wx + ox * MAP_WIDTH;
            if (wxo + radius < left || wxo - radius > right) continue;
            cb(wxo, wyo);
        }
    }
}

/**
 * Returns true if the entity (or any wrapped copy) intersects the
 * rectangular viewport.  Convenience wrapper around `forEachWrapOffset`
 * for callers that only need a boolean cull decision.
 */
export function isVisibleOnTorus(
    wx: number, wy: number, radius: number,
    left: number, right: number, top: number, bottom: number,
): boolean {
    // Fast-path: if the direct position is in the box, we're done.
    if (wx + radius >= left && wx - radius <= right &&
        wy + radius >= top  && wy - radius <= bottom) return true;
    // Otherwise check the 8 wrapped neighborhoods.
    for (let oy = -1; oy <= 1; oy++) {
        const wyo = wy + oy * MAP_HEIGHT;
        if (wyo + radius < top || wyo - radius > bottom) continue;
        for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            const wxo = wx + ox * MAP_WIDTH;
            if (wxo + radius < left || wxo - radius > right) continue;
            return true;
        }
    }
    return false;
}
