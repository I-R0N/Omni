/** UNIFIED TILE LIGHTING — the geometry half.
 *
 *  This is the portable arm of the lighting system: occluder collection and
 *  (from A4) the tangent / shadow-volume maths.  It deliberately contains NO
 *  Canvas2D types and touches no drawing context.  Compositing is the
 *  throwaway half and lives elsewhere; a future renderer swap should be able
 *  to keep this file as-is.
 *
 *  WHAT AN OCCLUDER IS.  Exactly one thing casts shadow in Omni:
 *
 *      EntityType.STRUCTURE  &&  mass === Infinity  &&  !passThrough
 *
 *  Each clause earns its place.  STRUCTURE is the unified shard-family
 *  carrier, so it covers every tile and shard variant at once.  `mass ===
 *  Infinity` is the static/dynamic axis — CLAUDE.md is explicit that this
 *  dispatch is by MASS and never by EntityType, so mobile shards (finite
 *  mass) are excluded here by the same rule the physics broadphase uses.
 *  And `passThrough` excludes `nebula-tile`: nebula is a soft cloud a ship
 *  flies through, and a soft cloud casting a hard shadow would read as a
 *  bug.  That exclusion is mandatory, not a tuning choice — and it matters
 *  more than it looks, because nebula is the single most numerous static
 *  tile on the natural maps (1496 of UNIVERSE's 2227).
 *
 *  ALLOCATION.  Steady-state allocation in a per-frame path buys GC pauses,
 *  and a GC pause is a dip — so collection is zero-allocation after warm-up:
 *  a module-scope pool of mutable records, filled by INDEX using the refill
 *  idiom (CLAUDE.md §8), never `length = 0` + `push`.
 */
import type { PhysicsSystem } from '../PhysicsSystem';
import { GameEntity, EntityType } from '../../../types';
import { SHARD_VARIANTS } from '../../../constants';
import { shiftX, shiftY } from './drawUtils';

/** One shadow-casting body, already resolved into the querying light's wrap
 *  zone, approximated as a circle.
 *
 *  A CIRCLE, not the tile's hexagon, on purpose: one wedge per occluder
 *  (two tangents + a far arc) instead of six per hexagon is what keeps the
 *  per-light cost bounded by the occluder cap rather than by silhouette
 *  complexity.  Rock tiles also physically deform their `polygonPoints` as
 *  they take damage, so a per-edge silhouette would additionally have to be
 *  rebuilt per hit per tile. */
export interface Occluder {
    /** World X, WRAP-RESOLVED into the light's local zone (see below). */
    x: number;
    /** World Y, wrap-resolved likewise. */
    y: number;
    /** Circumcircle radius for the tangent construction. */
    r: number;
    /** Squared distance to the light — the nearest-first selection key. */
    distSq: number;
}

/** Reusable occluder records.  Grows to the high-water mark of the largest
 *  query ever made and is then stable, so a steady-state frame allocates
 *  nothing.  Entries are owned by this module and are overwritten by the
 *  next `collectOccluders` call — consumers must read them within the frame
 *  and never retain one. */
const _pool: Occluder[] = [];

function poolAt(i: number): Occluder {
    let o = _pool[i];
    if (o === undefined) {
        o = { x: 0, y: 0, r: 0, distSq: 0 };
        _pool[i] = o;
    }
    return o;
}

/** Scratch for the collector's callback, so the closure below can be hoisted
 *  to module scope instead of being reconstructed per light per frame. */
let _outBuf: Occluder[] = [];
let _n = 0;
let _lx = 0;
let _ly = 0;

/** Hoisted visitor.  A function CONSTRUCTED inside a per-frame path is
 *  rebuilt every frame; this one is built once and reads its captures from
 *  the module-scope scratch above (the `applyFlowTo` precedent). */
function visit(t: GameEntity): void {
    if (t.type !== EntityType.STRUCTURE) return;
    if (t.mass !== Infinity) return;
    const v = t.shardVariant;
    if (v === undefined) return;
    if (SHARD_VARIANTS[v].passThrough === true) return;

    // WRAP RESOLUTION, and why it happens HERE rather than at the tangent.
    //
    // A shadow wedge is built from an apex (the light) and a base (the
    // occluder).  If those two are expressed either side of a wrap seam, the
    // wedge is constructed across the whole map and draws a bar of darkness
    // through the arena.  Per-point toroidal deltas do NOT fix this — the
    // minimap's flow layer hit exactly this failure and needed an explicit
    // seam break (CLAUDE.md §8).
    //
    // So every occluder is resolved into the LIGHT's zone once, at
    // collection, and every downstream consumer can then treat the set as
    // plain Euclidean geometry around the light.  `shiftX`/`shiftY` pick the
    // wrapped copy nearest the reference point, which is exactly that.
    const ox = shiftX(_lx, t.position.x);
    const oy = shiftY(_ly, t.position.y);
    const dx = ox - _lx;
    const dy = oy - _ly;

    // Refill idiom: index-fill, never `length = 0` + `push` (the latter
    // shrinks the backing store and re-grows it, allocating every refill).
    const o = poolAt(_n);
    o.x = ox;
    o.y = oy;
    o.r = Math.max(t.size.x, t.size.y) * 0.5;
    o.distSq = dx * dx + dy * dy;
    _outBuf[_n++] = o;
}

/**
 * Collect the shadow-casting static geometry within `radius` of a light at
 * (lx, ly), wrap-resolved into that light's zone, into `out`.
 *
 * Returns the count.  `out` is index-filled and truncated only when the
 * count actually shrank, so repeated calls at a steady occluder population
 * allocate nothing.
 *
 * NOT sorted and NOT capped here — selection is the caller's policy (the
 * tier's occluder cap takes the N NEAREST, since the nearest occluders
 * subtend the largest shadow angle and truncation therefore degrades
 * gracefully).  `distSq` is filled in so that sort is free of further maths.
 */
export function collectOccluders(
    physics: PhysicsSystem,
    lx: number,
    ly: number,
    radius: number,
    out: Occluder[],
): number {
    _outBuf = out;
    _n = 0;
    _lx = lx;
    _ly = ly;
    physics.forEachStaticInRadius(lx, ly, radius, visit);
    const n = _n;
    if (out.length !== n) out.length = n;
    // Drop the reference so a stale `out` can't be written by a later stray
    // call, and so this module doesn't pin the caller's array alive.
    _outBuf = _EMPTY;
    return n;
}

const _EMPTY: Occluder[] = [];
