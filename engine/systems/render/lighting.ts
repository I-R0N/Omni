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
import type { ShardVariantId } from '../ShardSystem.types';
import {
    SHARD_VARIANTS, effectiveDpr, getActiveLightingMode, getActiveLightingTier,
    getShardShadowsEnabled, getShadowSoftness, getRefractionEnabled,
    getRefractBrightness, getLightBrightness, getEmissiveEnabled,
    getEmitBrightness, EMIT_BASELINE, getEmitShadowsEnabled, getEmitShadowTier,
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
    /** `SHARD_VARIANTS[v].transmit` — the fraction of light that passes
     *  THROUGH rather than being withheld.  0 for everything opaque, which
     *  is everything but glass. */
    transmit: number;
    /** `SHARD_VARIANTS[v].emits` — the fraction of received light this body
     *  radiates back out.  0 for everything that does not re-emit. */
    emits: number;
    /** The COLOUR this body re-emits in, as an `'r, g, b'` string, or null to
     *  use the light's own colour.  Resolved per BODY rather than per
     *  variant, because a nebula's colour is blended from its own
     *  composition and no two clouds match. */
    emitRgb: string | null;
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
        o = { x: 0, y: 0, r: 0, br: 0, pts: undefined, rot: 0, transmit: 0,
              emits: 0, emitRgb: null, distSq: 0, mobile: false };
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

/** THE EMITTER BUFFER — a SECOND output from the same walk.
 *
 *  A5g chose emitters by walking the shadow-caster set, which is exactly
 *  right while every emitter is also an occluder.  Nebula broke that: it is
 *  `passThrough`, so it casts nothing and never enters the occluder pool,
 *  and it is also the most numerous static tile on the natural maps (1496 of
 *  Universe's 2227).  Putting it in the shadow pool to make it visible to
 *  the emitter walk would hand it the whole 24-slot budget and blank the
 *  terrain shadows — the same starvation failure the shard share cap in
 *  `selectOccluders` was written for, arriving from the other direction.
 *
 *  So passThrough emitters land in their own buffer, filled during the SAME
 *  grid walk (no second query), and the emitter pass merges the two lists
 *  nearest-first.  They cost the shadow pool nothing and the shadow pass
 *  never sees them. */
const _emitPool: Occluder[] = [];
function emitPoolAt(i: number): Occluder {
    let o = _emitPool[i];
    if (o === undefined) {
        o = { x: 0, y: 0, r: 0, br: 0, pts: undefined, rot: 0, transmit: 0,
              emits: 0, emitRgb: null, distSq: 0, mobile: false };
        _emitPool[i] = o;
    }
    return o;
}
/** How many passThrough emitters a collection keeps.  Kept NEAREST-FIRST by
 *  insertion rather than collect-then-sort, because on a nebula map the
 *  candidate count is in the hundreds and the budget that consumes it is
 *  single digits — an insertion that usually fails its first compare is
 *  cheaper than sorting a list that is thrown away.  Sized to the largest
 *  emitter budget any tier can ask for (`ultra`'s maxLights - 1). */
const EMIT_CANDIDATES = 32;
let _emitBuf: Occluder[] = [];
let _emitN = 0;
let _lastEmitN = 0;
/** How many passThrough emitters the last `collectOccluders` kept.  A second
 *  return value, in the shape this module already uses for its scratch. */
export function lastEmitterCount(): number { return _lastEmitN; }

/** The colour a body re-emits in: its OWN, normalised to full value.
 *
 *  NORMALISED because brightness belongs to the alpha, not to the tint.  A
 *  body's fill colour is a surface colour — metal's is a dark steel — and
 *  using it raw would make a lit metal plate radiate dark grey, which reads
 *  as a smudge rather than as light.  Scaling the channels so the largest is
 *  255 keeps the HUE and hands the brightness back to `_emA`.
 *
 *  QUANTISED to 32-step channels so the gradient cache is keyed on a small
 *  set.  Nebula colours are blended per body and would otherwise mint a
 *  cache entry each, on a map that has 1496 of them.
 *
 *  Cached on the entity against the source colour it was built from, so the
 *  parse and the string build happen on a colour CHANGE and never per frame.
 */
function emitTintFor(t: GameEntity, v: ShardVariantId): string | null {
    // THE BODY'S OWN COLOUR, in this order: a nebula's blended composition
    // (per body — no two clouds match), then the entity's render colour, and
    // only then the variant's legacy `glow.color` as a last resort.  The glow
    // colours are VFX leftovers from the contact glow A5f deleted, and taking
    // them first is measurably wrong: metal's is MAGENTA, so a lit steel
    // plate radiated magenta light while its own surface stayed steel.
    const src = t.nebulaBlendedHex ?? t.color ?? SHARD_VARIANTS[v].glow?.color;
    if (src === undefined) return null;
    if (t._emitTintKey === src) return t._emitTint ?? null;
    const rgb = normalizedTint(src);
    t._emitTintKey = src;
    t._emitTint = rgb;
    return rgb;
}

/** '#rgb' / '#rrggbb' -> 'r, g, b' at full value, quantised.  Anything else
 *  (a named colour, an rgba() string) returns null and falls back to the
 *  light's own colour — a parser for every CSS colour form is not what this
 *  is for, and the bodies that emit all carry hex. */
function normalizedTint(src: string): string | null {
    if (src.charCodeAt(0) !== 35 /* # */) return null;
    let r: number, g: number, b: number;
    if (src.length === 7) {
        r = parseInt(src.slice(1, 3), 16);
        g = parseInt(src.slice(3, 5), 16);
        b = parseInt(src.slice(5, 7), 16);
    } else if (src.length === 4) {
        r = parseInt(src[1] + src[1], 16);
        g = parseInt(src[2] + src[2], 16);
        b = parseInt(src[3] + src[3], 16);
    } else return null;
    if (!(r >= 0) || !(g >= 0) || !(b >= 0)) return null;
    const max = Math.max(r, g, b);
    if (max <= 0) return null;
    const k = 255 / max;
    const q = (c: number) => Math.min(255, Math.round(c * k / 32) * 32);
    return `${q(r)}, ${q(g)}, ${q(b)}`;
}

/** Keep this body among the N nearest passThrough emitters.
 *
 *  Insertion into a fixed, always-sorted buffer: the common case is one
 *  compare against the farthest kept and an immediate return, and the pooled
 *  record evicted from the tail is the one reused for the insert, so a full
 *  buffer allocates nothing at all. */
function recordEmitter(t: GameEntity, v: ShardVariantId, mobile: boolean): void {
    const ox = shiftX(_lx, t.position.x);
    const oy = shiftY(_ly, t.position.y);
    const dx = ox - _lx, dy = oy - _ly;
    const d2 = dx * dx + dy * dy;
    const full = _emitN === EMIT_CANDIDATES;
    if (full && d2 >= _emitBuf[_emitN - 1].distSq) return;
    let o: Occluder;
    if (full) {
        o = _emitBuf[_emitN - 1];
    } else {
        o = emitPoolAt(_emitN);
        _emitN++;
    }
    let i = _emitN - 1;
    while (i > 0 && _emitBuf[i - 1].distSq > d2) { _emitBuf[i] = _emitBuf[i - 1]; i--; }
    _emitBuf[i] = o;
    o.x = ox;
    o.y = oy;
    o.r = occluderRadius(t);
    o.br = Math.max(t.size.x, t.size.y) * 0.5;
    o.pts = t.polygonPoints;
    o.rot = t.rotation;
    o.transmit = SHARD_VARIANTS[v].transmit ?? 0;
    o.emits = SHARD_VARIANTS[v].emits ?? 0;
    o.emitRgb = emitTintFor(t, v);
    o.distSq = d2;
    o.mobile = mobile;
}

/** A passThrough body still LIGHTS if its variant says it does — it just
 *  never shadows.  Skipped entirely when nothing asked for emitters, so a
 *  collection with emission off costs exactly what it did before. */
function maybeRecordEmitter(t: GameEntity, v: ShardVariantId, mobile: boolean): void {
    if (_emitBuf === _EMPTY) return;
    if ((SHARD_VARIANTS[v].emits ?? 0) <= 0) return;
    recordEmitter(t, v, mobile);
}

/** Hoisted visitor.  A function CONSTRUCTED inside a per-frame path is
 *  rebuilt every frame; this one is built once and reads its captures from
 *  the module-scope scratch above (the `applyFlowTo` precedent). */
function visit(t: GameEntity): void {
    if (t.type !== EntityType.STRUCTURE) return;
    if (t.mass !== Infinity) return;
    const v = t.shardVariant;
    if (v === undefined) return;
    if (SHARD_VARIANTS[v].passThrough === true) { maybeRecordEmitter(t, v, false); return; }
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
    if (SHARD_VARIANTS[v].passThrough === true) { maybeRecordEmitter(t, v, true); return; }
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
    const v = t.shardVariant;
    o.transmit = v !== undefined ? SHARD_VARIANTS[v].transmit ?? 0 : 0;
    o.emits = v !== undefined ? SHARD_VARIANTS[v].emits ?? 0 : 0;
    o.emitRgb = v !== undefined && o.emits > 0 ? emitTintFor(t, v) : null;
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
    emitOut?: Occluder[],
): number {
    _outBuf = out;
    _n = 0;
    _lx = lx;
    _ly = ly;
    // `emitOut` opts into the SECOND output: the passThrough bodies that
    // re-emit.  Omit it and the walk behaves exactly as it did before, which
    // is what the nested collection for a shadowing emitter wants (an
    // emitter's own light does not go looking for more emitters).
    _emitBuf = emitOut ?? _EMPTY;
    _emitN = 0;
    physics.forEachStaticInRadius(lx, ly, radius, visit);
    if (shards) physics.forEachDynamicInRadius(lx, ly, radius, visitShard);
    const n = _n;
    if (out.length !== n) out.length = n;
    _lastEmitN = _emitN;
    if (emitOut !== undefined && emitOut.length !== _emitN) emitOut.length = _emitN;
    // Drop the references so a stale `out` can't be written by a later stray
    // call, and so this module doesn't pin the caller's arrays alive.
    _outBuf = _EMPTY;
    _emitBuf = _EMPTY;
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
const _gradCache = new Map<string, Map<number, CanvasGradient>>();

/** Graded passes used to fake a penumbra, AS A FUNCTION OF HOW WIDE THE
 *  BAND IS.  Three passes is the point where banding stops reading as
 *  banding for the default softness, and for a long time that was the whole
 *  story — but the softness ladder now runs to k=14, and a band five times
 *  as wide graded over the same three steps reads as three stripes rather
 *  than as a soft edge.  So gradations are bought only where they are
 *  needed: k=2.5 still resolves to exactly 3, so the shipped default is
 *  bit-for-bit what it was, and only the settings someone deliberately
 *  cycled to pay for more.  Capped at 6, past which the passes cost more
 *  than the smoothness is worth at this layer's resolution. */
function softSteps(k: number): number {
    if (k <= 0) return 1;
    const n = 2 + Math.round(k / 2);
    return n < 3 ? 3 : n > 6 ? 6 : n;
}
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
 *  graded passes and the rest stay hard, which is where the cost went.
 *
 *  Cut from 8 to 5 at A5d.  The polygon silhouette costs one quad per
 *  back-facing edge where the circle cost one wedge full stop, so a graded
 *  pass buys roughly three times the path work it used to and the number
 *  that was affordable at A5 no longer is.  Five still covers everything
 *  close enough for its soft edge to be more than a couple of pixels. */
const PENUMBRA_NEAREST = 5;
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
    dilate: number,
    lightOutside: boolean,
): boolean {
    const n = pts.length;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    for (let i = 0; i < n; i++) {
        const p = pts[i];
        const lx = p.x * cosR - p.y * sinR;
        const ly = p.x * sinR + p.y * cosR;
        const x = ocx + lx * scale;
        const y = ocy + ly * scale;
        _svx[i] = x;
        _svy[i] = y;
        // THE PENUMBRA DILATION APPLIES TO THE FAR POINT ONLY.
        //
        // Dilating the whole body was the obvious reading of "a penumbra is
        // the shadow of a slightly larger caster", and it is wrong at the one
        // place you look: a real penumbra is ZERO WIDE at the caster's own
        // surface and opens out with distance from it, where a uniform
        // dilation is equally wide everywhere — including right at the body,
        // where it reads as the shadow being thrown by something bigger than
        // the thing you can see.  It was worst on the smallest bodies,
        // because the widening is an ANGLE and a small body's own angle is
        // small: measured on a live frame, a 15-unit shard was casting from
        // a silhouette 2x its size (the clamp; the raw factor was 3.7), and
        // even 28-unit shards pinned the clamp.  Reported from the device as
        // exactly that.
        //
        // Taking the far point's BEARING from the dilated vertex and the near
        // point from the true one gives the cone instead: the extra bearing
        // works out to (k-1)*r/d, which is the intended widening angle by
        // construction, while the near boundary stays exactly on the body.
        const fx = ocx + lx * scale * dilate;
        const fy = ocy + ly * scale * dilate;
        const rx = fx - cx, ry = fy - cy;
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

/** Distinct `transmit` values present in the selected occluder set.
 *
 *  Shadows are withheld with `destination-out`, whose strength is the fill's
 *  ALPHA — one number for the whole fill.  So bodies that let different
 *  fractions through cannot share a fill, and each distinct value needs its
 *  own compound path.  In practice there are one or two (opaque, and glass),
 *  so this is a two-element array and one extra `fill` per graded pass; the
 *  all-opaque case draws exactly what it drew before. */
const _transmits = new Float64Array(4);

/** Fill `_transmits` and return how many are in use.  Anything past the
 *  fourth distinct value is SNAPPED onto the nearest one already listed
 *  rather than dropped — a body that fell out of every group would cast no
 *  shadow at all, which is a much worse failure than a slightly wrong
 *  translucency.  Nothing in the shipped variant table gets near four. */
function collectTransmitGroups(occ: Occluder[], count: number): number {
    let n = 0;
    for (let i = 0; i < count; i++) {
        const t = occ[i].transmit;
        let found = false;
        for (let g = 0; g < n; g++) if (_transmits[g] === t) { found = true; break; }
        if (found) continue;
        if (n < _transmits.length) { _transmits[n++] = t; continue; }
        let best = 0, bestD = Infinity;
        for (let g = 0; g < n; g++) {
            const d = Math.abs(_transmits[g] - t);
            if (d < bestD) { bestD = d; best = g; }
        }
        occ[i].transmit = _transmits[best];
    }
    return n;
}

/** REFRACTION — the prototype behind the DBG "Refraction" row.
 *
 *  WHAT IT MODELS.  The shipped translucency sends light straight through
 *  glass at reduced brightness, which is right for a parallel-faced pane: a
 *  slab offsets a ray laterally but does not deviate it, and a regular
 *  hexagon has three pairs of parallel faces.  A wedge-shaped SHARD is a
 *  prism, though, and a prism bends light.  So each exit face refracts by
 *  Snell's law and emits an additive cone along the deviated direction.
 *
 *  WHAT IT DOES NOT MODEL, deliberately, and the error that follows: only
 *  the EXIT face is refracted.  A ray really bends twice — once entering,
 *  once leaving — and for a body with parallel faces the two cancel exactly.
 *  Finding the entry face means a ray-polygon intersection per vertex, so
 *  this is the thin-body approximation: correct in kind for a wedge, an
 *  OVER-estimate of the deviation for a slab.  That is the useful direction
 *  to be wrong in for a prototype whose question is "can you see it at all".
 *
 *  The caustic REPLACES the straight-through transmission rather than adding
 *  to it (see the erase pass), so the light is moved, not created. */
const REFRACT = {
    /** Index of refraction, glass into vacuum.  Ordinary crown glass. */
    IOR: 1.5,
    /** Ceiling on the caustic's alpha as a fraction of the light's OWN peak
     *  — a hard clamp, not a suggestion.  Refracted light is a redistribution
     *  of light that already passed through a body that absorbs some of it,
     *  so it can never out-shine the source; and a caustic brighter than the
     *  lamp reads as a bug rather than as glass.
     *
     *  RAISED FROM 0.5 TO 1 on device feedback: the caustic measured as only
     *  marginally legible at Low, and a prototype you cannot see is one you
     *  cannot judge.  Half the source is still the DEFAULT the cycle starts
     *  at — the physical instinct behind it was right — but it is no longer
     *  a ceiling, and 1 is: refracted light is a redistribution of light
     *  that already passed through the body, so out-shining the source
     *  outright remains meaningless. */
    MAX_BRIGHTNESS_FRAC: 1,
    /** How far the deviated cone is thrown, as a fraction of the light
     *  radius.  Shorter than the shadow's 1.6x: a caustic that runs to the
     *  edge of the light reads as a searchlight rather than as a glint. */
    FAR_FRAC: 1.1,
};

/** Emit one translucent body's REFRACTED cones into the open path.
 *
 *  Reuses the vertex scratch that `emitSilhouetteShadow` just filled, and
 *  the same back-facing test — the faces light LEAVES through are exactly
 *  the ones that cast the shadow.  Returns true if anything was emitted.
 *
 *  TOTAL INTERNAL REFLECTION is a real branch, not a guard bolted on: past
 *  the critical angle (41.8 degrees for IOR 1.5) nothing is transmitted at
 *  all, and the formula's discriminant goes negative.  A silent `sqrt` of a
 *  negative would put NaN into the compound path, and ONE NaN discards the
 *  whole path — which is exactly how A4 shipped with no shadows at all. */
function emitRefractedLight(
    lctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    ocx: number, ocy: number,
    far: number,
    n: number,
): boolean {
    let drew = false;
    const eta = REFRACT.IOR;
    for (let i = 0; i < n; i++) {
        const j = i + 1 === n ? 0 : i + 1;
        const ax = _svx[i], ay = _svy[i];
        const bx = _svx[j], by = _svy[j];
        const ex = bx - ax, ey = by - ay;
        // Same back-facing test as the shadow: the light and the body's own
        // centre on the SAME side of the edge means light leaves here.
        const sL = ex * (cy - ay) - ey * (cx - ax);
        const sC = ex * (ocy - ay) - ey * (ocx - ax);
        if ((sL >= 0) !== (sC >= 0)) continue;

        // OUTWARD edge normal.  Either perpendicular is a normal; the one
        // that points away from the body's centre is the outward one, and
        // `sC` already carries that sign — no winding knowledge needed, which
        // matters because the shard polygons come from several generators.
        const elen = Math.sqrt(ex * ex + ey * ey);
        if (elen === 0) continue;
        const sgn = sC >= 0 ? -1 : 1;
        const nx = sgn * (-ey / elen), ny = sgn * (ex / elen);

        // Refract both endpoints.  `refractTo` writes into the scratch pair
        // rather than returning a vector, so the hot path allocates nothing.
        if (!refractTo(ax - cx, ay - cy, nx, ny, eta)) continue;
        const rax = _rx, ray = _ry;
        if (!refractTo(bx - cx, by - cy, nx, ny, eta)) continue;
        const rbx = _rx, rby = _ry;

        // The quad is built in the SAME rotational order the shadow quads use
        // — near-a, far-a, far-b, near-b — but it is filled additively rather
        // than with destination-out, so overlapping cones simply brighten and
        // the winding does not have to be canonical.  Left in the same order
        // anyway, so the two emitters read as the same construction.
        lctx.moveTo(ax, ay);
        lctx.lineTo(ax + rax * far, ay + ray * far);
        lctx.lineTo(bx + rbx * far, by + rby * far);
        lctx.lineTo(bx, by);
        lctx.closePath();
        drew = true;
    }
    return drew;
}

/** Scratch for `refractTo` — see the allocation note at the top of the file. */
let _rx = 0, _ry = 0;

/**
 * Snell's law in 2D.  `(ix, iy)` is the incident direction (need not be unit
 * — it is normalised here), `(nx, ny)` the OUTWARD surface normal, `eta` the
 * ratio of the indices the ray is leaving over the one it enters.
 *
 * Writes the unit refracted direction into `_rx`/`_ry` and returns true, or
 * returns false under total internal reflection, where nothing is
 * transmitted.
 */
function refractTo(ix: number, iy: number, nx: number, ny: number, eta: number): boolean {
    const ilen = Math.sqrt(ix * ix + iy * iy);
    if (ilen === 0) return false;
    const dx = ix / ilen, dy = iy / ilen;
    const ci = dx * nx + dy * ny;               // cos of the incidence angle
    if (ci <= 0) return false;                  // not actually an exit face
    const k = 1 - eta * eta * (1 - ci * ci);
    if (k < 0) return false;                    // TOTAL INTERNAL REFLECTION
    const g = Math.sqrt(k) - eta * ci;
    _rx = eta * dx + g * nx;
    _ry = eta * dy + g * ny;
    return true;
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

/** Brightness the cache was built at.  The gradient bakes its alphas into
 *  colour stops, so a cache keyed on radius alone would keep serving the old
 *  brightness after the DBG cycle moved — a stale-cache bug whose symptom is
 *  "the setting does nothing", which is the hardest kind to see.  One
 *  compare per light per frame; the cycle is a handful of entries, so the
 *  clear happens on a keypress and never in steady state. */
let _gradBrightness = -1;

function lightGradient(
    lctx: CanvasRenderingContext2D, rPx: number, tint: string | null = null,
): CanvasGradient {
    const bright = getLightBrightness();
    if (bright !== _gradBrightness) {
        _gradCache.clear();
        _gradBrightness = bright;
    }
    // Keyed by COLOUR then radius, so a tinted emitter cannot collide with
    // the player's own light at the same radius.  The tints are normalised
    // and quantised (`normalizedTint`), which is what keeps this map small
    // on a map whose nebula blends a different colour per body.
    const rgb = tint ?? PLAYER_LIGHT.RGB;
    let byRadius = _gradCache.get(rgb);
    if (byRadius === undefined) {
        byRadius = new Map<number, CanvasGradient>();
        _gradCache.set(rgb, byRadius);
    }
    const key = Math.round(rPx);
    let g = byRadius.get(key);
    if (g === undefined) {
        g = lctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(1, key));
        g.addColorStop(0, `rgba(${rgb}, ${PLAYER_LIGHT.PEAK * bright})`);
        g.addColorStop(PLAYER_LIGHT.MID,
                       `rgba(${rgb}, ${PLAYER_LIGHT.MID_ALPHA * bright})`);
        g.addColorStop(1, `rgba(${rgb}, 0)`);
        byRadius.set(key, g);
    }
    return g;
}

/** The falloff's value at `t` = distance / radius, as a FRACTION of the
 *  light's own peak — so it is 1 at the centre and 0 at the rim, whatever
 *  brightness is selected.  This is the same piecewise ramp the gradient's
 *  three stops describe, evaluated rather than sampled: reading the canvas
 *  back to find out how lit something is would be a CPU readback of the
 *  light layer, which this system does not do. */
function falloffFrac(t: number): number {
    if (t >= 1) return 0;
    if (t <= 0) return 1;
    const midFrac = PLAYER_LIGHT.MID_ALPHA / PLAYER_LIGHT.PEAK;
    if (t < PLAYER_LIGHT.MID) return 1 + (midFrac - 1) * (t / PLAYER_LIGHT.MID);
    return midFrac * (1 - (t - PLAYER_LIGHT.MID) / (1 - PLAYER_LIGHT.MID));
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
    refract: boolean,
    tint: string | null = null,
): void {
    // 1. Falloff.  Created at the origin and MOVED by the transform, so the
    //    cache key stays the radius and the colour.  setTransform rather than
    //    save/translate/restore: same effect, no state stack.
    lctx.setTransform(1, 0, 0, 1, cx, cy);
    lctx.fillStyle = lightGradient(lctx, rPx, tint);
    lctx.fillRect(-rPx, -rPx, rPx * 2, rPx * 2);
    lctx.setTransform(1, 0, 0, 1, 0, 0);

    if (count === 0) return;

    // 2. The shadow volumes, in SOFT_STEPS graded passes.
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
    //     all, which is why this looked mechanical.  Widening the silhouette
    //     by a CONSTANT ANGLE per pass fakes an area light of that angular
    //     size, and constant angular widening is what makes the soft band
    //     grow with distance from the caster — the physical behaviour, not a
    //     blur.  Near the body the transition is tight; far away it spreads.
    //     The widening reaches the geometry as `dilate`, and applies to the
    //     EXTRUDED far points only — see `emitSilhouetteShadow`.
    //
    // The erase fractions are chosen so the remaining light steps LINEARLY
    // across the band: after pass i the survivor is 1 - (i+1)/N, so
    // f_i = 1 - R_(i+1)/R_i.  For N = 3 that is 1/3, 1/2, 1 — and the last
    // pass is 1 so the umbra is fully dark rather than nearly so.
    const kRad = penumbraK * PENUMBRA_DEG_PER_K * DEG2RAD;
    const steps = softSteps(penumbraK);
    const groups = collectTransmitGroups(occ, count);
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

        // The widening passes cover only the nearest few; the final (umbra)
        // pass covers everything, so a distant occluder still ends fully
        // dark — it just gets a hard edge instead of a graded one.
        const isUmbraPass = step === steps - 1;
        const upTo = isUmbraPass ? count : Math.min(count, PENUMBRA_NEAREST);

        // ONE COMPOUND PATH PER TRANSMISSION GROUP.  `destination-out` takes
        // its strength from the fill's alpha, one number for the whole fill,
        // so bodies that let different fractions of light through cannot
        // share one.  With every variant opaque (`groups === 1`) this is the
        // single path it always was.
        for (let g = 0; g < groups; g++) {
        const transmit = _transmits[g];
        // WITH REFRACTION ON, translucent bodies erase in FULL and their
        // transmitted light comes back as a deviated cone below — the energy
        // is moved, not added.  (The groups are still walked separately here,
        // which costs one redundant fill while the prototype is on; splitting
        // that out would mean a second grouping path for a debug toggle.)
        const eraseAlpha = erase * (1 - (refract ? 0 : transmit));
        if (eraseAlpha <= 0) continue;      // fully transparent: casts nothing

        lctx.beginPath();
        let drew = 0;
        for (let i = 0; i < upTo; i++) {
            const o = occ[i];
            if (o.transmit !== transmit) continue;
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
                    // Angular widening `widen` at distance `d` is a body
                    // `widen * d` px wider, i.e. this factor against the
                    // inradius.  It scales the FAR points only, so it opens
                    // the shadow out with distance instead of fattening the
                    // body — see `emitSilhouetteShadow`.
                    k = 1 + widen * d / rad;
                    if (k > DILATE_MAX) k = DILATE_MAX;
                    // Never let the dilated vertices reach the light: one
                    // landing on it has no bearing at all, and the quad
                    // collapses onto the light's own centre and erases a
                    // sliver out of the middle of it.
                    const kMax = brPx > 0 ? 0.9 * d / brPx : 1;
                    if (k > kMax) k = kMax;
                    if (k < 1) k = 1;
                }
                // `d > brPx` proves the light is outside the body — the
                // NEAR vertices are undilated now, so this is the true
                // outline — which lets the emitter fuse its two passes.
                if (emitSilhouetteShadow(lctx, cx, cy, ocx, ocy, far, pts, o.rot,
                                         worldToPx, k, d > brPx)) drew++;
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
        lctx.globalAlpha = eraseAlpha;
        lctx.globalCompositeOperation = 'destination-out';
        lctx.fill();
        lctx.globalCompositeOperation = 'source-over';
        lctx.globalAlpha = 1;
        }
    }
    if (wedges === 0 && !refract) return;

    // 4. REFRACTION (DBG prototype).  Additive, and LAST — a caustic is light
    //    inside the umbra, so anything drawn before the erase passes would be
    //    withheld again by the very shadow it belongs to.
    if (!refract) return;
    const causticFar = rPx * REFRACT.FAR_FRAC;
    for (let g = 0; g < groups; g++) {
        const transmit = _transmits[g];
        if (transmit <= 0) continue;                 // opaque: nothing to bend
        lctx.beginPath();
        let drew = false;
        for (let i = 0; i < count; i++) {
            const o = occ[i];
            if (o.transmit !== transmit) continue;
            const pts = o.pts;
            if (pts === undefined || pts.length < 3 || pts.length > MAX_SIL_VERTS) continue;
            const dx = (o.x - lx) * worldToPx;
            const dy = (o.y - ly) * worldToPx;
            const brPx = o.br * worldToPx;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d <= brPx) continue;                 // light inside the body
            if (d - brPx > rPx) continue;            // past the light's reach
            const ocx = cx + dx, ocy = cy + dy;
            const n = pts.length;
            const cosR = Math.cos(o.rot), sinR = Math.sin(o.rot);
            for (let k = 0; k < n; k++) {
                const p = pts[k];
                _svx[k] = ocx + (p.x * cosR - p.y * sinR) * worldToPx;
                _svy[k] = ocy + (p.x * sinR + p.y * cosR) * worldToPx;
            }
            if (emitRefractedLight(lctx, cx, cy, ocx, ocy, causticFar, n)) drew = true;
        }
        if (!drew) continue;

        // BRIGHTNESS.  The caustic is filled with the light's OWN falloff
        // gradient, scaled by at most REFRACT.MAX_BRIGHTNESS_FRAC — so
        // "no brighter than half the source" is structural rather than a
        // number someone has to keep in step, and the deviated light fades
        // with distance exactly as the direct light does.
        //
        // The gradient is created at the origin and placed by the transform.
        // The PATH is unaffected: Canvas2D bakes each segment into device
        // space as it is added, so a transform set afterwards moves only the
        // fill's own coordinate space.  Same trick as the falloff in step 1.
        const alpha = Math.min(REFRACT.MAX_BRIGHTNESS_FRAC, getRefractBrightness(), transmit);
        lctx.setTransform(1, 0, 0, 1, cx, cy);
        lctx.fillStyle = lightGradient(lctx, rPx);
        lctx.globalAlpha = alpha;
        lctx.globalCompositeOperation = 'lighter';
        lctx.fill();
        lctx.globalCompositeOperation = 'source-over';
        lctx.globalAlpha = 1;
        lctx.setTransform(1, 0, 0, 1, 0, 0);
    }
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

/** How far a re-emitting body throws its own light, as a fraction of the
 *  light that lit it.  Small on purpose: an emitter is a lit SURFACE, not a
 *  lamp, and a halo the size of the player's own light would read as a
 *  second ship rather than as metal catching the light. */
const EMIT_RADIUS_FRAC = 0.32;
/** Emitters below this received fraction are skipped — at the rim of the
 *  light, `emits` of almost nothing is exactly nothing, and it would still
 *  cost a gradient fill to draw. */
const EMIT_MIN_RECEIVED = 0.06;
// How many emitters may SHADOW, and how much geometry each of them sees,
// both come from EMIT_SHADOW_TIERS (constants.ts) — a cost ladder for the
// toggle, cycled at DBG "Emit shd tier".
//
// Measured on the metal showcase with the toggle on: +1.3 ms at Low (3
// emitters), +5.6 at Medium (7), and +12.6 ms at High (15) — an entire frame
// budget, from a debug toggle.  The cost is per emitter and almost entirely
// its own occluder collection, so it scales with the count and nothing else,
// which is why the ladder's rungs move the count first.  Past the cap an
// emitter still lights, flatly, rather than disappearing.

/** Emitter snapshot: world position, radius and alpha, as PLAIN NUMBERS.
 *
 *  THIS EXISTS BECAUSE THE OCCLUDER POOL IS SHARED.  Emitters are chosen by
 *  walking the player light's own occluder set, and collecting occluders for
 *  an emitter overwrites the pool records that set points into — so the
 *  choosing has to FINISH, into storage that owns its values, before any
 *  second collection happens.  Reading `o.x` inside the second loop would
 *  silently read whatever the last collection put there, and the symptom
 *  (emitters drifting onto other bodies' positions, only when shadows are
 *  on) is exactly the kind the pool comment warns about. */
const _emX = new Float64Array(64);
const _emY = new Float64Array(64);
const _emA = new Float64Array(64);
/** The chosen emitters' COLOURS.  A plain array because they are strings —
 *  references to the cached tints on the entities, so filling this assigns
 *  pointers and allocates nothing. */
const _emC: (string | null)[] = new Array(64).fill(null);

/**
 * Composite the SECONDARY lights: every lit body whose variant re-emits.
 *
 * Runs after the shadow passes, so an emitter shines INTO the darkness
 * beside it — which is the whole point, and is why it is not simply a
 * brighter body. Returns how many were drawn.
 *
 * HOW MUCH LIGHT A BODY RECEIVES is evaluated, never sampled: the falloff is
 * a known piecewise ramp, so `falloffFrac` gives the answer in three
 * arithmetic operations. Reading it off the canvas would be a CPU readback
 * of the light layer, which this system does not do at any price.
 *
 * SHADOWS ARE OPTIONAL AND EXPENSIVE. Without them an emitter is one
 * gradient fill. With them it needs its own occluder collection AND its own
 * compositing surface — it cannot be drawn straight onto the accumulated
 * layer, because `destination-out` there would erase the light already
 * present rather than only the emitter's share. So the shadowing path
 * composites into a scratch canvas and blits the result, clearing and
 * blitting only the emitter's own box so the cost stays proportional to the
 * halo rather than to the screen.
 */
function compositeEmitters(
    r: RenderSystem,
    lctx: CanvasRenderingContext2D,
    cx: number, cy: number, rPx: number,
    occ: Occluder[], count: number,
    emit: Occluder[], emitCount: number,
    lx: number, ly: number, worldToPx: number,
    maxEmitters: number,
): number {
    if (maxEmitters <= 0) return 0;
    const emitRPx = Math.max(1, rPx * EMIT_RADIUS_FRAC);
    const scale = getEmitBrightness() / EMIT_BASELINE;
    const cap = Math.min(maxEmitters, _emX.length);

    // PASS 1 — choose, into storage that owns its values.  See _emX above.
    //
    // TWO SORTED LISTS, MERGED NEAREST-FIRST: the shadow casters that emit
    // (glass, metal) and the passThrough emitters that never entered the
    // shadow pool (nebula).  Merging rather than concatenating is what keeps
    // the rule one rule — the nearest emitters win the budget, whichever
    // list they came from — so a nebula cloud you are standing in cannot be
    // out-ranked by a metal plate across the room.
    let n = 0, i = 0, j = 0;
    while (n < cap && (i < count || j < emitCount)) {
        let o: Occluder;
        if (j >= emitCount || (i < count && occ[i].distSq <= emit[j].distSq)) {
            o = occ[i++];
            if (o.emits <= 0) continue;
        } else {
            o = emit[j++];
        }
        const dx = (o.x - lx) * worldToPx;
        const dy = (o.y - ly) * worldToPx;
        const d = Math.sqrt(dx * dx + dy * dy);
        const received = falloffFrac(d / rPx);
        if (received < EMIT_MIN_RECEIVED) continue;
        // A body cannot radiate more light than fell on it.
        let em = o.emits * scale;
        if (em > 1) em = 1;
        _emX[n] = o.x;
        _emY[n] = o.y;
        _emA[n] = received * em;
        _emC[n] = o.emitRgb;
        n++;
    }
    if (n === 0) return 0;

    const shadowed = getEmitShadowsEnabled() && r.physics !== undefined;
    const shadowTier = getEmitShadowTier();
    const emitWorldR = emitRPx / worldToPx;

    // PASS 2 — draw.  Only now may a second collection touch the pool.
    for (let k = 0; k < n; k++) {
        const ex = cx + (_emX[k] - lx) * worldToPx;
        const ey = cy + (_emY[k] - ly) * worldToPx;

        // Past the shadow budget, an emitter still lights — it just lights
        // flatly.  Falling back beats vanishing: the count is what the tier
        // promised, and only the treatment degrades.
        if (!shadowed || k >= shadowTier.maxEmitters) {
            // The emitter IS the player light, smaller and dimmer: same
            // cached gradient, scaled by how much light reached the body and
            // by how much of it the material throws back.  So it tracks the
            // brightness cycle for free and can never out-shine what lit it.
            lctx.setTransform(1, 0, 0, 1, ex, ey);
            lctx.fillStyle = lightGradient(lctx, emitRPx, _emC[k]);
            lctx.globalAlpha = _emA[k];
            lctx.globalCompositeOperation = 'lighter';
            lctx.fillRect(-emitRPx, -emitRPx, emitRPx * 2, emitRPx * 2);
            lctx.globalCompositeOperation = 'source-over';
            lctx.globalAlpha = 1;
            lctx.setTransform(1, 0, 0, 1, 0, 0);
            continue;
        }

        const sctx = ensureEmitCanvas(r);
        if (sctx === null) continue;
        // Clear and composite only this emitter's own box.
        const bx = Math.floor(ex - emitRPx), by = Math.floor(ey - emitRPx);
        const bw = Math.ceil(emitRPx * 2) + 1, bh = bw;
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.clearRect(bx, by, bw, bh);

        const cn = collectOccluders(r.physics!, _emX[k], _emY[k], emitWorldR,
                                    r._emitOccluders, getShardShadowsEnabled());
        r._emitOccluders.sort(byDistSq);
        const sel = selectOccluders(r._emitOccluders, cn,
                                    Math.min(shadowTier.maxOccluders, cn),
                                    Math.min(4, cn));
        compositeLight(sctx, ex, ey, emitRPx, r._emitOccluders, sel,
                       _emX[k], _emY[k], worldToPx, getShadowSoftness(), false,
                       _emC[k]);

        lctx.globalAlpha = _emA[k];
        lctx.globalCompositeOperation = 'lighter';
        lctx.drawImage(r._emitCanvas!, bx, by, bw, bh, bx, by, bw, bh);
        lctx.globalCompositeOperation = 'source-over';
        lctx.globalAlpha = 1;
    }
    return n;
}

/** Scratch surface for a SHADOWING emitter.  One canvas, reused across
 *  emitters and frames, sized to the light canvas — only the emitter's own
 *  box is ever cleared or blitted, so its size costs memory rather than
 *  fill rate.  Null when the toggle has never been on, so the ordinary path
 *  allocates nothing. */
function ensureEmitCanvas(r: RenderSystem): CanvasRenderingContext2D | null {
    if (r._emitCanvas !== null && r._emitCanvas.width === r._lightW
        && r._emitCanvas.height === r._lightH) {
        return r._emitCtx;
    }
    if (typeof document === 'undefined') return null;
    if (r._emitCanvas === null) {
        r._emitCanvas = document.createElement('canvas');
        r._emitCtx = r._emitCanvas.getContext('2d');
        if (r._emitCtx === null) { r._emitCanvas = null; return null; }
    }
    r._emitCanvas.width = r._lightW;
    r._emitCanvas.height = r._lightH;
    return r._emitCtx;
}

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
        // The emitter buffer is asked for only while emission is on, so a
        // frame with it off walks exactly the geometry it always did.
        const wantEmitters = getEmissiveEnabled();
        const n = collectOccluders(r.physics, playerPos.x, playerPos.y, tier.maxRadius,
                                   r._lightOccluders, getShardShadowsEnabled(),
                                   wantEmitters ? r._lightEmitters : undefined);
        r._lightEmitterCount = wantEmitters ? lastEmitterCount() : 0;
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
            const rPx = tier.maxRadius * worldToPx;
            compositeLight(lctx, cx, cy, rPx,
                           r._lightOccluders, r._lightOccluderCount,
                           playerPos.x, playerPos.y, worldToPx,
                           getShadowSoftness(), getRefractionEnabled());
            // SECONDARY lights, from the same occluder set the shadows were
            // cast from — the bodies the light reaches are exactly the ones
            // that can re-emit it.  `maxLights` counts the player's own, so
            // the tier's budget is shared rather than added to.
            if (getEmissiveEnabled()) {
                lights += compositeEmitters(
                    r, lctx, cx, cy, rPx, r._lightOccluders, r._lightOccluderCount,
                    r._lightEmitters, r._lightEmitterCount,
                    playerPos.x, playerPos.y, worldToPx, tier.maxLights - 1);
            }
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
