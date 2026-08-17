/** UNIFIED TILE LIGHTING — the geometry half.
 *
 *  This is the portable arm of the lighting system: occluder collection and
 *  (from A4) the tangent / shadow-volume maths.  It deliberately contains NO
 *  Canvas2D types and touches no drawing context.  Compositing is the
 *  throwaway half and lives elsewhere; a future renderer swap should be able
 *  to keep this file as-is.
 *
 *  WHAT AN OCCLUDER IS.  The shard family, solid, on either side of the
 *  mass axis:
 *
 *      EntityType.STRUCTURE && !passThrough, and either
 *        mass === Infinity                  -> a TILE   (static grid)
 *        mass finite && r >= MIN_SHARD_...  -> a SHARD  (dynamic grid)
 *
 *  Each clause earns its place.  STRUCTURE is the unified shard-family
 *  carrier, so it covers every tile and shard variant at once.  The MASS
 *  split is not a filter but a routing decision — CLAUDE.md is explicit
 *  that static-vs-dynamic dispatch is by mass and never by EntityType, and
 *  the two live in different grids, so each needs its own query.  And
 *  `passThrough` excludes nebula on BOTH sides: a nebula shard is the same
 *  soft cloud as a nebula tile and neither may cast.  That exclusion is
 *  mandatory rather than a tuning choice, and it matters more than it looks
 *  — nebula is the single most numerous static tile on the natural maps
 *  (1496 of UNIVERSE's 2227).
 *
 *  ALLOCATION.  Steady-state allocation in a per-frame path buys GC pauses,
 *  and a GC pause is a dip — so collection is zero-allocation after warm-up:
 *  a module-scope pool of mutable records, filled by INDEX using the refill
 *  idiom (CLAUDE.md §8), never `length = 0` + `push`.
 */
import type { PhysicsSystem } from '../PhysicsSystem';
import type { RenderSystem } from '../RenderSystem';
import { GameEntity, EntityType, CameraState, Vector2 } from '../../../types';
import {
    SHARD_VARIANTS, effectiveDpr, getActiveLightingMode, getActiveLightingTier,
    getShardShadowsEnabled, getShadowSoftness,
} from '../../../constants';
import { shiftX, shiftY } from './drawUtils';

/** One shadow-casting body, already resolved into the querying light's wrap
 *  zone.
 *
 *  IT CARRIES BOTH SILHOUETTES, and which one is used is decided at draw
 *  time.  The POLYGON (`pts` + `rot`) is the real one and is what every
 *  shard-family body has; the CIRCLE (`r`, the inradius) is the fallback for
 *  a sprite-only or degenerate body, and is also what the `d <= r` guards
 *  read.  A circle alone was the A4/A5 design — one wedge per occluder
 *  instead of one quad per back-facing edge — and it was wrong for a reason
 *  no amount of choosing a better radius could fix: the bodies are visibly
 *  polygonal, so ANY circle prints its own arc across the face as the
 *  terminator.  Too big and there is a lit ring around the body before its
 *  shadow starts; too small and there is a bright crescent of body outside
 *  its own shadow.  Both were reported from the device, at both radii.
 *  See `emitSilhouetteShadow`. */
export interface Occluder {
    /** World X, WRAP-RESOLVED into the light's local zone (see below). */
    x: number;
    /** World Y, wrap-resolved likewise. */
    y: number;
    /** Inradius — the fallback circle silhouette, and the scale reference the
     *  penumbra dilation is expressed against. */
    r: number;
    /** Bounding half-extent: the widest the body can possibly be.  Used for
     *  the reach cull and the size floor, both of which want the body's
     *  APPARENT size rather than its inscribed circle. */
    br: number;
    /** The body outline, ENTITY-LOCAL with the centroid at the origin and
     *  pre-rotation — a live reference to `GameEntity.polygonPoints`, not a
     *  copy, because rock tiles deform theirs on every hit and a copy would
     *  need invalidating.  `undefined` for a body that has no polygon. */
    pts: Vector2[] | undefined;
    /** The body's rotation, needed to bring `pts` into world orientation.
     *  Static tiles are 0; shards spin. */
    rot: number;
    /** Squared distance to the light — the nearest-first selection key. */
    distSq: number;
    /** True for a mobile shard, false for a static tile.  Selection needs to
     *  tell them apart: see the shard share cap in `selectOccluders`. */
    mobile: boolean;
}

/** Below this world radius a shard is not worth casting from.  At 150 units
 *  a 6-unit body subtends 2*asin(6/150) = 4.6 degrees, which on a light
 *  layer rendered at a third of screen resolution is a couple of pixels wide
 *  — it costs path work to draw something no one can see, and in a debris
 *  burst there are a lot of them.
 *
 *  MEASURED AGAINST THE BOUNDING HALF-EXTENT, which is what the paragraph
 *  above reasons about ("a 6-unit body").  A5b silently changed the meaning
 *  of this number by switching the shadow radius to the inradius: on real
 *  shards the inradius is about half the bounding extent (0.50 median, 0.32
 *  worst), so the floor started rejecting bodies up to 18 units across —
 *  which is why small shards stopped casting anything visible.  It is also
 *  the cheaper test: `size` is already there, where the inradius costs a
 *  walk over the edges of a body that may be about to be rejected. */
const MIN_SHARD_OCCLUDER_R = 6;

/** Reusable occluder records.  Grows to the high-water mark of the largest
 *  query ever made and is then stable, so a steady-state frame allocates
 *  nothing.
 *
 *  THE POOL IS SHARED ACROSS LIGHTS, AND THAT IS A CONSTRAINT ON CALLERS,
 *  not an implementation detail.  Every `out` array handed to
 *  `collectOccluders` is filled with references INTO this pool, so a second
 *  collection overwrites the records the first one's array still points at.
 *  With one light (A3/A4) that cannot bite.  From A6, where several lights
 *  are composited per frame, each light's set MUST be consumed — drawn —
 *  before the next light is collected.  Collecting all lights up front and
 *  then drawing them would silently give every light the last light's
 *  occluders, and the symptom (shadows in the wrong place, only when two
 *  lights are near each other) would be very hard to read backwards. */
const _pool: Occluder[] = [];

function poolAt(i: number): Occluder {
    let o = _pool[i];
    if (o === undefined) {
        o = { x: 0, y: 0, r: 0, br: 0, pts: undefined, rot: 0, distSq: 0, mobile: false };
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
    record(t, false);
}

/** The MOBILE half.  Same shard family, opposite side of the mass axis.
 *
 *  `passThrough` still excludes nebula — a nebula SHARD is the same soft
 *  cloud as a nebula tile and must not cast either.  The size floor is the
 *  only rule that is not shared with the static filter, and it exists
 *  because debris comes in bursts: a shatter can put dozens of fragments
 *  around the light at once, and the small ones would each cost a wedge to
 *  draw a sliver too thin to see. */
function visitShard(t: GameEntity): void {
    if (t.type !== EntityType.STRUCTURE) return;
    if (t.mass === Infinity) return;
    const v = t.shardVariant;
    if (v === undefined) return;
    if (SHARD_VARIANTS[v].passThrough === true) return;
    if (Math.max(t.size.x, t.size.y) * 0.5 < MIN_SHARD_OCCLUDER_R) return;
    record(t, true);
}

/**
 * The radius the shadow is cast from: the largest circle centred on the
 * centroid that fits INSIDE the polygon — its INRADIUS.
 *
 * The obvious choice is the circumradius (`max(size) * 0.5`), and it is
 * wrong in a way that is very visible on shards.  A shard's `size` is its
 * bounding box, which for an irregular polygon can be far larger than the
 * body; the shadow then springs from a circle noticeably wider than the
 * thing you can see, leaving a bright ring of lit space around every shard
 * before its own shadow starts.  Tiles hide this because a hex fills its
 * cell, so its circumradius is close to its real extent.
 *
 * The inradius errs the other way — corners poke very slightly out of their
 * own shadow — and that is the error you want, because it is bounded by the
 * difference between the two radii and it reads as the shadow hugging the
 * body rather than floating off it.
 *
 * Cached on the entity and invalidated wherever `polygonPoints` is mutated
 * (beside `_satCacheAxes`), because rock tiles deform theirs on every hit
 * and this walk is O(edges) on a path that runs for every candidate in
 * range, not just the ones that survive the cap.
 */
function occluderRadius(t: GameEntity): number {
    const cached = t._occluderR;
    if (cached !== undefined) return cached;
    const pts = t.polygonPoints;
    let r: number;
    if (pts === undefined || pts.length < 3) {
        // No polygon (sprite-only or degenerate) — fall back to the bounding
        // half-extent, which is all there is to go on.
        r = Math.max(t.size.x, t.size.y) * 0.5;
    } else {
        // Distance from the centroid to the nearest EDGE, not the nearest
        // vertex: the nearest vertex overshoots on any polygon that is not
        // regular, which is exactly the case here.  Points are entity-local
        // with the centroid at the origin, and the inradius is rotationally
        // invariant, so no de-rotation is needed.
        let minD2 = Infinity;
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            const abx = b.x - a.x, aby = b.y - a.y;
            const segLen2 = abx * abx + aby * aby;
            let u = segLen2 > 0 ? -(a.x * abx + a.y * aby) / segLen2 : 0;
            if (u < 0) u = 0; else if (u > 1) u = 1;
            const qx = a.x + abx * u, qy = a.y + aby * u;
            const d2 = qx * qx + qy * qy;
            if (d2 < minD2) minD2 = d2;
        }
        r = Math.sqrt(minD2);
    }
    t._occluderR = r;
    return r;
}

/** Write one occluder record.  Shared by both filters so the wrap
 *  resolution and the refill idiom exist in exactly one place. */
function record(t: GameEntity, mobile: boolean): void {

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
    o.r = occluderRadius(t);
    o.br = Math.max(t.size.x, t.size.y) * 0.5;
    // A LIVE REFERENCE, deliberately: rock tiles rewrite their polygon on
    // every hit, so a copy would be one more thing to invalidate.  Nothing
    // downstream mutates it.
    o.pts = t.polygonPoints;
    o.rot = t.rotation;
    o.distSq = dx * dx + dy * dy;
    o.mobile = mobile;
    _outBuf[_n++] = o;
}

/**
 * Collect the shadow-casting geometry within `radius` of a light at
 * (lx, ly), wrap-resolved into that light's zone, into `out`.
 *
 * Tiles always; mobile shards too when `shards` is set.  The two come from
 * different grids and so are two walks, but they land in ONE set — selection
 * is nearest-first across both, because a shard between you and a tile
 * occludes exactly as a nearer tile would and the pool has no reason to
 * know which kind of body it holds.
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
    shards: boolean = false,
): number {
    _outBuf = out;
    _n = 0;
    _lx = lx;
    _ly = ly;
    physics.forEachStaticInRadius(lx, ly, radius, visit);
    if (shards) physics.forEachDynamicInRadius(lx, ly, radius, visitShard);
    const n = _n;
    if (out.length !== n) out.length = n;
    // Drop the reference so a stale `out` can't be written by a later stray
    // call, and so this module doesn't pin the caller's array alive.
    _outBuf = _EMPTY;
    return n;
}

const _EMPTY: Occluder[] = [];
const ZERO: Vector2 = { x: 0, y: 0 };

/** Nearest-first comparator, hoisted — a comparator literal passed to
 *  `sort` inside a per-frame path is rebuilt every frame. */
function byDistSq(a: Occluder, b: Occluder): number { return a.distSq - b.distSq; }

/**
 * Choose which of the collected occluders actually cast, in place.
 *
 * Nearest-first alone is not good enough once shards are in the pool, and
 * the failure is specific rather than theoretical: MEASURED on the glass
 * showcase under a shatter cadence, **100 % of the 24 slots went to debris**,
 * so the intact tiles around the player stopped casting entirely — at
 * exactly the moment the player is looking at the explosion.  Debris is
 * nearer than terrain almost by definition, so plain nearest-first hands the
 * whole budget to whatever just broke.
 *
 * So shards get a SHARE, not the run of the pool: at most `maxShardOccluders`
 * while there is terrain to fill the rest, and the whole pool when there is
 * not (the asteroid showcase has no static tiles at all, and reserving slots
 * for tiles that do not exist would just throw shadows away).  Within each
 * kind the choice is still nearest-first, which is what makes truncation
 * degrade gracefully — the nearest bodies subtend the largest angle.
 *
 * `occ` must already be sorted nearest-first.  Returns the count to draw;
 * the chosen entries are compacted to the front, so nothing is allocated.
 */
export function selectOccluders(
    occ: Occluder[], n: number, maxOccluders: number, maxShardOccluders: number,
): number {
    let tiles = 0;
    for (let i = 0; i < n; i++) if (!occ[i].mobile) tiles++;
    const shards = n - tiles;
    // Shards may take their share, or whatever terrain leaves unused —
    // whichever is larger.
    const shardSlots = Math.min(shards, Math.max(maxShardOccluders, maxOccluders - tiles));
    const tileSlots = Math.min(tiles, maxOccluders - shardSlots);

    let outN = 0, tookT = 0, tookS = 0;
    for (let i = 0; i < n && outN < maxOccluders; i++) {
        const o = occ[i];
        if (o.mobile) { if (tookS >= shardSlots) continue; tookS++; }
        else          { if (tookT >= tileSlots)  continue; tookT++; }
        // Compact forward.  i >= outN always, so this never clobbers an
        // entry it has not already read.
        if (outN !== i) occ[outN] = o;
        outN++;
    }
    return outN;
}

/** The player light.
 *
 *  Colour is the ship's own engine glow (`PLAYER_TRAIL_CONSTANTS.COLOR`),
 *  so the light reads as coming FROM the ship rather than as a new system
 *  announcing itself.
 *
 *  PEAK is the alpha at the light's centre.  It is deliberately well under
 *  the legacy models' peakAlpha (0.33-0.85): those tinted ONE tile face,
 *  where this adds over the entire lit area, so the same number would wash
 *  the scene out.
 *
 *  Lives here rather than in `constants.ts` only because A4's scope cap is
 *  two files.  It is config-as-code and belongs in `constants.ts` beside the
 *  tier table; move it there when the DBG row lands. */
const PLAYER_LIGHT = {
    RGB: '125, 211, 252',
    PEAK: 0.34,
    /** Where the falloff reaches zero, as a fraction of the light radius.
     *  1.0 exactly would put a hard rim at the radius; the gradient's own
     *  mid stop does the softening. */
    MID: 0.55,
    MID_ALPHA: 0.11,
};

/** Cached radial gradients, keyed on integer light-canvas radius.
 *
 *  Building one parses a CSS colour string PER STOP, which is why the engine
 *  already caches `enemyBodyGrad` / `bubbleFillGrad` on the entity.  The key
 *  is the RADIUS ONLY, never the position — the gradient is created at the
 *  origin and moved by the transform, so a moving light reuses one object.
 *  Camera zoom is the only thing that changes the radius, so the map stays
 *  a handful of entries. */
const _gradCache = new Map<number, CanvasGradient>();

/** Graded passes used to fake a penumbra.  Three is the point where the
 *  banding stops reading as banding at this layer's resolution; more passes
 *  cost another compound path each for a difference nobody can see. */
const SOFT_STEPS = 3;
/** Degrees of angular widening per unit of the tier's `penumbraK`.  The
 *  softness is an ANGLE, which is why the resulting soft band widens with
 *  distance from the caster instead of being a uniform blur. */
const PENUMBRA_DEG_PER_K = 1.6;
/** How many of the (nearest-first) occluders get soft edges.  Softening
 *  everything triples the wedge work — measured +0.46 to +0.66 ms p95, which
 *  is most of the whole lighting budget spent on an edge treatment.  The
 *  nearest casters are the ones whose shadow edges are large on screen and
 *  actually being looked at; a distant one's penumbra is a couple of pixels
 *  wide and indistinguishable from the hard edge.  So the near ones get the
 *  graded passes and the rest stay hard, which is where the cost went. */
const PENUMBRA_NEAREST = 8;
const DEG2RAD = Math.PI / 180;

/** Positive remainder in [0, 2pi).  `%` is a remainder, not a modulo, so it
 *  returns negatives for negative input and would flip the arc sweep. */
function norm2pi(a: number): number {
    const m = a % (Math.PI * 2);
    return m < 0 ? m + Math.PI * 2 : m;
}

/** Vertex-count bound on the silhouette scratch below.  Nothing in the shard
 *  family comes near it — a hex tile has 6 and the chunkiest shard polygon is
 *  well under 16 — so this is a buffer bound, not a policy: a body wider than
 *  this falls back to the circle rather than being dropped. */
const MAX_SIL_VERTS = 32;
const _svx = new Float64Array(MAX_SIL_VERTS);
const _svy = new Float64Array(MAX_SIL_VERTS);
/** Each vertex's EXTRUDED twin, computed once per vertex in the transform
 *  pass.  Every vertex is shared by two edges, so extruding per edge would
 *  take two square roots where this takes one — and the two edges MUST agree
 *  on the extruded point to the bit, or the quads separate and leave a bright
 *  sliver down the middle of the umbra. */
const _sfx = new Float64Array(MAX_SIL_VERTS);
const _sfy = new Float64Array(MAX_SIL_VERTS);
/** Per-edge back-facing classification.  Only filled on the slow path — see
 *  the note on the light-inside bail. */
const _sback = new Uint8Array(MAX_SIL_VERTS);
/** How far the penumbra passes may dilate a body.  The dilation is derived
 *  from the widening ANGLE and the distance, so for a small shard far away it
 *  is legitimately large — but past 2x the body it stops reading as a soft
 *  edge and starts reading as a second, bigger shadow. */
const DILATE_MAX = 2;

/**
 * Emit ONE occluder's shadow volume into the already-open path, extruded from
 * the body's OWN POLYGON rather than from a circle around it.
 *
 * WHY NOT A CIRCLE.  The bodies are visibly polygonal, and a circular
 * silhouette prints its own arc across the face as the terminator: at the
 * circumradius there is a lit ring around the body before its shadow begins,
 * and at the inradius there is a bright crescent of body standing outside its
 * own shadow.  Both were reported from the device, at both radii, because
 * they are the same defect seen from either side — the shadow's outline and
 * the body's outline are different shapes.  Extruding the real outline is the
 * only version with no mismatch to see, and it doubles the apparent width of
 * a small shard's shadow into the bargain (the inradius was casting from half
 * the body).
 *
 * ONE QUAD PER BACK-FACING EDGE, which is the textbook 2D shadow volume:
 * their union IS the umbra, adjacent quads share their inner edge exactly so
 * there is no sliver between them, and the near half of the body is left
 * uncovered — so a body still lights up on the side facing the light, which a
 * whole-body erase would have thrown away (mobile shards have no legacy glow
 * of their own to fall back on).
 *
 * Returns false when nothing was emitted, which includes the degenerate case
 * of the light being INSIDE the body — there every edge faces away, and
 * emitting them would erase the light's whole neighbourhood.
 */
function emitSilhouetteShadow(
    lctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    ocx: number, ocy: number,
    far: number,
    pts: Vector2[],
    rot: number,
    scale: number,
    lightOutside: boolean,
): boolean {
    const n = pts.length;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    for (let i = 0; i < n; i++) {
        const p = pts[i];
        const x = ocx + (p.x * cosR - p.y * sinR) * scale;
        const y = ocy + (p.x * sinR + p.y * cosR) * scale;
        _svx[i] = x;
        _svy[i] = y;
        const rx = x - cx, ry = y - cy;
        const len = Math.sqrt(rx * rx + ry * ry);
        const k = len > 0 ? far / len : 0;
        _sfx[i] = cx + rx * k;
        _sfy[i] = cy + ry * k;
    }

    // TWO SHAPES OF THIS LOOP, and which one runs is decided by whether the
    // light can possibly be inside the body.
    //
    // If it can, classification has to finish BEFORE anything is written:
    // "every edge faces away" is how the inside case is recognised, and by
    // then a fused loop would already have emitted half the quads — which
    // would erase the light's entire neighbourhood.
    //
    // If it cannot (`lightOutside`, i.e. the light is beyond the body's
    // bounding circle), that check can never fire, so the classify and emit
    // steps fuse into one pass over the edges.  That is the case essentially
    // always, and it is worth the branch: the loop runs per occluder per
    // graded pass.
    if (!lightOutside) {
        let backs = 0;
        for (let i = 0; i < n; i++) {
            const j = i + 1 === n ? 0 : i + 1;
            const ax = _svx[i], ay = _svy[i];
            const ex = _svx[j] - ax, ey = _svy[j] - ay;
            const sL = ex * (cy - ay) - ey * (cx - ax);
            const sC = ex * (ocy - ay) - ey * (ocx - ax);
            const back = (sL >= 0) === (sC >= 0) ? 1 : 0;
            _sback[i] = back;
            backs += back;
        }
        // Every edge facing away means the light is inside the body (for a
        // convex body exactly; for a dented one, near enough).  Nothing
        // occludes a light it contains.
        if (backs === 0 || backs === n) return false;
        for (let i = 0; i < n; i++) {
            if (_sback[i] === 1) emitQuad(lctx, cx, cy, i, i + 1 === n ? 0 : i + 1);
        }
        return true;
    }

    let drew = false;
    for (let i = 0; i < n; i++) {
        const j = i + 1 === n ? 0 : i + 1;
        const ax = _svx[i], ay = _svy[i];
        const ex = _svx[j] - ax, ey = _svy[j] - ay;
        // BACK-FACING, WITHOUT KNOWING THE WINDING: an edge faces away from
        // the light exactly when the light and the body's own centre lie on
        // the SAME side of the edge's line.  The shard family's polygons come
        // from several generators and their vertex order is not guaranteed,
        // so a normal-direction test would have to establish it first.
        const sL = ex * (cy - ay) - ey * (cx - ax);
        const sC = ex * (ocy - ay) - ey * (ocx - ax);
        if ((sL >= 0) !== (sC >= 0)) continue;
        emitQuad(lctx, cx, cy, i, j);
        drew = true;
    }
    return drew;
}

/** One back-facing edge's extrusion, from the vertex scratch. */
function emitQuad(
    lctx: CanvasRenderingContext2D, cx: number, cy: number, i: number, j: number,
): void {
    let ax = _svx[i], ay = _svy[i], bx = _svx[j], by = _svy[j];
    let fax = _sfx[i], fay = _sfy[i], fbx = _sfx[j], fby = _sfy[j];
    // CANONICAL ORIENTATION.  Every subpath in the compound path must wind
    // the same way: under nonzero winding two overlapping subpaths of
    // OPPOSITE orientation cancel, which would punch a bright hole wherever
    // two shadows crossed.  Ordering each pair so that b is counter-clockwise
    // of a about the light fixes the sign by construction — no signed-area
    // pass, and correct per-quad even across occluders whose polygons wind
    // opposite ways.
    if ((ax - cx) * (by - cy) - (ay - cy) * (bx - cx) < 0) {
        let t = ax; ax = bx; bx = t;
        t = ay; ay = by; by = t;
        t = fax; fax = fbx; fbx = t;
        t = fay; fay = fby; fby = t;
    }
    // near-a -> far-a -> far-b -> near-b.  That order (rather than the more
    // natural near-a -> near-b -> far-b -> far-a) is what makes the quad wind
    // the SAME way as the circle fallback's wedge, which matters because the
    // two can overlap: opposite windings would cancel to a bright hole.
    lctx.moveTo(ax, ay);
    lctx.lineTo(fax, fay);
    lctx.lineTo(fbx, fby);
    lctx.lineTo(bx, by);
    lctx.closePath();
}

function lightGradient(lctx: CanvasRenderingContext2D, rPx: number): CanvasGradient {
    const key = Math.round(rPx);
    let g = _gradCache.get(key);
    if (g === undefined) {
        g = lctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(1, key));
        g.addColorStop(0, `rgba(${PLAYER_LIGHT.RGB}, ${PLAYER_LIGHT.PEAK})`);
        g.addColorStop(PLAYER_LIGHT.MID, `rgba(${PLAYER_LIGHT.RGB}, ${PLAYER_LIGHT.MID_ALPHA})`);
        g.addColorStop(1, `rgba(${PLAYER_LIGHT.RGB}, 0)`);
        _gradCache.set(key, g);
    }
    return g;
}

/**
 * Composite ONE light: falloff, then every shadow wedge withheld from it.
 *
 * Four draw operations regardless of occluder count — a gradient fill, one
 * `beginPath`, one `fill`, and the composite-mode flip between them.  The
 * cost is PATH CONSTRUCTION, which the tier's occluder cap bounds.
 *
 * The wedges go into ONE compound path and are withheld in a single
 * `destination-out` fill.  Overlapping wedges union correctly under nonzero
 * winding, so no per-wedge state change is needed.  The ctx path API is used
 * rather than `Path2D` because it allocates nothing — a `Path2D` cannot be
 * cleared and would mean a new object per light per frame.
 *
 * No clip is set.  The falloff is alpha 0 beyond its radius and
 * `destination-out` against alpha 0 is a no-op, so wedges running past the
 * light's edge cost nothing and harm nothing.  That is what removes the
 * per-light `save`/`restore` a scissor rect would have needed.
 */
function compositeLight(
    lctx: CanvasRenderingContext2D,
    cx: number, cy: number, rPx: number,
    occ: Occluder[], count: number,
    lx: number, ly: number, worldToPx: number,
    penumbraK: number,
): void {
    // 1. Falloff.  Created at the origin and MOVED by the transform, so the
    //    cache key stays the radius alone.  setTransform rather than
    //    save/translate/restore: same effect, no state stack.
    lctx.setTransform(1, 0, 0, 1, cx, cy);
    lctx.fillStyle = lightGradient(lctx, rPx);
    lctx.fillRect(-rPx, -rPx, rPx * 2, rPx * 2);
    lctx.setTransform(1, 0, 0, 1, 0, 0);

    if (count === 0) return;

    // 2. One compound path of every shadow wedge.
    //
    // Occluders are approximated as CIRCLES: one wedge each — two tangents
    // and a far arc — instead of six quads per hexagon.  That is what keeps
    // the cost bounded by the occluder cap rather than by silhouette
    // complexity, and it is also the only shape that survives rock tiles
    // deforming their polygon on every hit.
    // 2. The shadow wedges, in SOFT_STEPS graded passes.
    //
    // TWO THINGS MADE THE OLD EDGE READ AS A DRAWN LINE, and they are
    // different problems with different fixes.
    //
    // (a) THE TERMINATOR WAS A STRAIGHT CHORD.  The wedge used to close from
    //     one tangent point straight back to the other, which cuts the
    //     chord across the occluder and leaves its far bulge OUTSIDE the
    //     shadow — so the body's own dark side stayed lit, with a hard
    //     straight cut across the tile face where the shadow began.  Closing
    //     around the circle's FAR arc instead puts the terminator where it
    //     belongs and curves it around the body.
    //
    // (b) THE EDGES WERE PERFECTLY HARD.  A point light has no penumbra at
    //     all, which is why this looked mechanical.  Widening the wedge by a
    //     CONSTANT ANGLE per pass fakes an area light of that angular size,
    //     and constant angular widening is exactly what makes the soft band
    //     grow with distance from the caster — the physical behaviour, not a
    //     blur.  Near the tile the transition is tight; far away it spreads.
    //
    // The erase fractions are chosen so the remaining light steps LINEARLY
    // across the band: after pass i the survivor is 1 - (i+1)/N, so
    // f_i = 1 - R_(i+1)/R_i.  For N = 3 that is 1/3, 1/2, 1 — and the last
    // pass is 1 so the umbra is fully dark rather than nearly so.
    const kRad = penumbraK * PENUMBRA_DEG_PER_K * DEG2RAD;
    const steps = kRad > 0 ? SOFT_STEPS : 1;
    let wedges = 0;
    for (let step = 0; step < steps; step++) {
        // Widest first, umbra last.
        const widen = steps > 1 ? kRad * (steps - 1 - step) / (steps - 1) : 0;
        const remainBefore = 1 - step / steps;
        const remainAfter = 1 - (step + 1) / steps;
        // For the near occluders the fractions compose to full darkness
        // across the passes; for the far ones only this last pass runs, and
        // it erases outright.  Both land at a fully dark umbra.
        const erase = step === steps - 1
            ? 1
            : (remainBefore > 0 ? 1 - remainAfter / remainBefore : 1);

        lctx.beginPath();
        let drew = 0;
        // The widening passes cover only the nearest few; the final (umbra)
        // pass covers everything, so a distant occluder still ends fully
        // dark — it just gets a hard edge instead of a graded one.
        const isUmbraPass = step === steps - 1;
        const upTo = isUmbraPass ? count : Math.min(count, PENUMBRA_NEAREST);
        // Rotating a ray by the widening angle is the RIGHT construction for a
        // circle and the wrong one for a polygon: adjacent quads would then
        // extrude their shared vertex in two different directions and leave a
        // bright sliver between them.  So the polygon path widens by DILATING
        // the body instead — a penumbra is the shadow of a slightly larger
        // caster — which keeps every shared vertex shared and costs one
        // multiply on the transform scale.
        for (let i = 0; i < upTo; i++) {
            const o = occ[i];
            const dx = (o.x - lx) * worldToPx;
            const dy = (o.y - ly) * worldToPx;
            const rad = o.r * worldToPx;
            const brPx = o.br * worldToPx;
            const d = Math.sqrt(dx * dx + dy * dy);
            // Entirely past the light's reach: nothing of it is lit, so
            // nothing of it can shadow.  Measured against the BOUNDING extent
            // so a body whose near edge is in range is not culled on its
            // centre.
            if (d - brPx > rPx) continue;
            const ocx = cx + dx, ocy = cy + dy;

            const pts = o.pts;
            if (pts !== undefined && pts.length >= 3 && pts.length <= MAX_SIL_VERTS) {
                const far = rPx * 1.6;
                let k = 1;
                if (widen > 0 && rad > 0) {
                    // Angular widening `widen` at distance `d` is a body that
                    // is `widen * d` px wider, i.e. this scale factor against
                    // the inradius.
                    k = 1 + widen * d / rad;
                    if (k > DILATE_MAX) k = DILATE_MAX;
                    // Never let the dilated body swallow the light: it would
                    // turn every edge back-facing and erase the light's whole
                    // neighbourhood.  `emitSilhouetteShadow` would catch that
                    // and bail, losing the soft pass; clamping keeps it.
                    const kMax = brPx > 0 ? 0.9 * d / brPx : 1;
                    if (k > kMax) k = kMax;
                    if (k < 1) k = 1;
                }
                // `d > brPx * k` proves the light is outside the (dilated)
                // body, which lets the emitter fuse its two passes.
                if (emitSilhouetteShadow(lctx, cx, cy, ocx, ocy, far, pts, o.rot,
                                         worldToPx * k, d > brPx * k)) drew++;
                continue;
            }

            // NO POLYGON (sprite-only or degenerate) — the circle silhouette
            // is all there is to go on.
            // Light inside the occluder: there is no tangent, and asin()
            // would return NaN and poison the whole compound path.
            if (d <= rad) continue;

            const theta = Math.atan2(dy, dx);
            const alpha = Math.asin(rad / d) + widen;
            const tan = Math.sqrt(d * d - rad * rad);   // light -> tangent point
            const a1 = theta - alpha, a2 = theta + alpha;
            // Far edge at 1.6x the light radius: comfortably past the falloff
            // so no lit rim survives behind an occluder, and comfortably
            // inside the `lightRadius * 3` torus-seam assertion, which must
            // stay able to catch a genuine wrap failure (those land half a
            // map away).
            const far = rPx * 1.6;
            const c1 = Math.cos(a1), s1 = Math.sin(a1);
            const c2 = Math.cos(a2), s2 = Math.sin(a2);
            const t1x = cx + c1 * tan, t1y = cy + s1 * tan;
            const t2x = cx + c2 * tan, t2y = cy + s2 * tan;

            lctx.moveTo(t1x, t1y);
            lctx.lineTo(cx + c1 * far, cy + s1 * far);
            lctx.arc(cx, cy, far, a1, a2);
            lctx.lineTo(t2x, t2y);
            // Close around the occluder's FAR side (see (a) above).  The
            // sweep is chosen by which way round passes `theta`, the bearing
            // from the occluder centre directly away from the light — safer
            // than deriving the tangent angles' signs by hand.
            const g2 = Math.atan2(t2y - ocy, t2x - ocx);
            const g1 = Math.atan2(t1y - ocy, t1x - ocx);
            const ccwSpan = norm2pi(g1 - g2);
            const ccwToTheta = norm2pi(theta - g2);
            lctx.arc(ocx, ocy, rad, g2, g1, ccwToTheta > ccwSpan);
            lctx.closePath();
            drew++;
        }
        if (drew === 0) continue;
        wedges += drew;

        // 3. Withhold this band.  Shadows SUBTRACT added light; they never
        //    darken the world below what it already was, which keeps the
        //    system additive-only until A7 deliberately is not.
        //
        // THE FILL STYLE MUST BE OPAQUE.  Under `destination-out` only the
        // SOURCE ALPHA matters, and on the first pass `fillStyle` is still
        // the falloff gradient from step 1 — created in user space at the
        // origin and now used under the IDENTITY transform, so it sits on
        // the canvas corner and reads alpha 0 near the wedges.  Filling with
        // it erases exactly nothing, and the failure is silent: the shadows
        // simply do not appear, with no error and no wrong-looking geometry
        // to trace back from.  (Measured before the fix: light gain was a
        // uniform 12.5 luminance at every bearing, including directly behind
        // the occluder.)
        lctx.fillStyle = '#000';
        lctx.globalAlpha = erase;
        lctx.globalCompositeOperation = 'destination-out';
        lctx.fill();
        lctx.globalCompositeOperation = 'source-over';
        lctx.globalAlpha = 1;
    }
    if (wedges === 0) return;
}

// ═══════════════════════════════════════════════════════════════════════════
//  THE LIGHT LAYER — the compositing half.
//
//  Everything above this line is portable geometry.  Everything below it is
//  Canvas2D, and is the half a renderer swap would throw away.  The split is
//  deliberate: a WebGL port is parked rather than dead, and when it happens
//  the occluder collection and (from A4) the tangent maths should survive it
//  untouched.
//
//  The layer follows `staticTileCache.ts` rather than inventing a second
//  offscreen-canvas pattern: free functions over `r: RenderSystem`, with the
//  canvas / ctx / dimensions living as fields there because they persist
//  between frames, and `RenderSystem` imported as a TYPE so there is no
//  runtime cycle.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ensure the light canvas exists and matches the current viewport and tier.
 *
 * Sized in CSS pixels divided by the tier's divisor, NOT in backing-store
 * pixels — the layer is low-frequency, and tying it to the device pixel
 * ratio would make a dpr-3 phone pay 2.25x for a blur it cannot see.  CSS
 * dimensions come from the backing store over `effectiveDpr()`, never from
 * `window.devicePixelRatio`: the cap means those two disagree, and mixing
 * them computes a logical viewport that does not match the canvas.
 *
 * Rebuilds only when the size actually changes (resize, tier change).  A
 * canvas reallocation per frame would dwarf everything this stage is
 * measuring.
 */
export function ensureLightCanvas(r: RenderSystem, ctx: CanvasRenderingContext2D): boolean {
    const dpr = effectiveDpr();
    const cssW = ctx.canvas.width / dpr;
    const cssH = ctx.canvas.height / dpr;
    const divisor = getActiveLightingTier().divisor;
    const w = Math.max(1, Math.ceil(cssW / divisor));
    const h = Math.max(1, Math.ceil(cssH / divisor));

    if (r._lightCanvas !== null && r._lightW === w && r._lightH === h) return true;

    if (r._lightCanvas === null) {
        if (typeof document === 'undefined') return false;
        r._lightCanvas = document.createElement('canvas');
        r._lightCtx = r._lightCanvas.getContext('2d');
        if (r._lightCtx === null) { r._lightCanvas = null; return false; }
    }
    r._lightCanvas.width = w;
    r._lightCanvas.height = h;
    r._lightW = w;
    r._lightH = h;
    // World units per light-layer pixel, for the per-light passes in A4.
    r._lightScale = 1 / divisor;
    return true;
}

/**
 * Build and blit the light layer.  Called once per frame from `render()`,
 * after the entity pass and before the HUD, OUTSIDE the camera transform —
 * the layer is screen-space, so it must not inherit the world translation.
 *
 * No-op at `'legacy'`, which is what makes the toggle a true restore rather
 * than a re-render of the same thing by another route: nothing is allocated,
 * nothing is drawn, and `lastLightingMs` stays 0.
 */
export function renderLightLayer(
    r: RenderSystem, ctx: CanvasRenderingContext2D, width: number, height: number,
    playerPos?: Vector2, camera?: CameraState,
): void {
    const mode = getActiveLightingMode();
    if (mode === 'legacy') return;

    const t0 = performance.now();
    if (!ensureLightCanvas(r, ctx)) return;
    const lctx = r._lightCtx!;
    const lw = r._lightW, lh = r._lightH;

    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, lw, lh);

    let lights = 0;
    if (mode === 'unified' && playerPos && r.physics) {
        // OCCLUDER CHURN.  Collected FRESH every frame, deliberately.
        //
        // Occluders churn constantly in Omni: tiles shatter, the dragon eats
        // static tiles into its body, merged shards snap back onto the hex
        // grid.  `FlowFieldGrid` concedes it cannot patch tile CREATION
        // incrementally and falls back to a dirty flag — shadows must not
        // inherit that, because a shadow still being cast by a tile the
        // player just destroyed is far more visible than a stale flow vector.
        //
        // There is nothing to invalidate here BY CONSTRUCTION: lights move
        // every frame, so each light's set is recomputed from the live static
        // grid regardless. `forEachStaticCells` skips `!active` entities, so a
        // tile that died this frame cannot appear in the set at all.  A3
        // exists to show that this costs an acceptable amount under maximum
        // churn rather than to add machinery.
        const tier = getActiveLightingTier();
        const n = collectOccluders(r.physics, playerPos.x, playerPos.y, tier.maxRadius,
                                   r._lightOccluders, getShardShadowsEnabled());
        // Nearest-first, then SELECT — see selectOccluders for why a plain
        // cap is wrong once debris is in the pool.
        r._lightOccluders.sort(byDistSq);
        r._lightOccluderCount = selectOccluders(
            r._lightOccluders, n, tier.maxOccluders, tier.maxShardOccluders);
        lights = 1;

        if (camera) {
            // World -> light-canvas pixels.  The light canvas is screen space
            // at 1/divisor, so this is the camera zoom times that scale.  CSS
            // dimensions, never backing-store: `effectiveDpr` caps the device
            // ratio, so the two disagree and mixing them puts the light
            // somewhere other than the ship.
            const k = r._lightScale;
            const worldToPx = camera.zoom * k;
            const shake = camera.shakeOffset ?? ZERO;
            const cx = (width / 2 + (shiftX(camera.position.x, playerPos.x)
                        - camera.position.x + shake.x) * camera.zoom) * k;
            const cy = (height / 2 + (shiftY(camera.position.y, playerPos.y)
                        - camera.position.y + shake.y) * camera.zoom) * k;
            compositeLight(lctx, cx, cy, tier.maxRadius * worldToPx,
                           r._lightOccluders, r._lightOccluderCount,
                           playerPos.x, playerPos.y, worldToPx,
                           getShadowSoftness());
        }
    } else {
        r._lightOccluderCount = 0;
    }
    if (mode === 'debug') {
        // A flat 50% grey.  This stage is proving the PLUMBING — canvas,
        // sizing, the single blit, and the smoothing restore below — so it
        // deliberately draws something with no lighting maths in it, and
        // therefore nothing that could hide a cost or a seam.
        lctx.globalAlpha = 1;
        lctx.fillStyle = '#808080';
        lctx.fillRect(0, 0, lw, lh);
        lights = 1;
    }
    // 'unified' draws nothing yet — A4 owns the per-light passes.

    // ONE drawImage reaches the main canvas, per the batching constraint.
    //
    // `imageSmoothingEnabled` is set false globally at the top of render(),
    // which is right for sprites and wrong here: the layer is a third of
    // screen resolution, so nearest-neighbour upscaling makes it visibly
    // blocky.  Turn it on for exactly this draw and put it back immediately
    // — leaving it true would silently soften every sprite drawn afterwards.
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(r._lightCanvas!, 0, 0, lw, lh, 0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = prevSmoothing;

    r.lastLightingMs += performance.now() - t0;
    r.lastLightingLights = lights;
}
