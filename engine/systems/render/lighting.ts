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
import { GameEntity, EntityType, EnemySubtype, CameraState, Vector2 } from '../../../types';
import type { ShardVariantId } from '../ShardSystem.types';
import {
    SHARD_VARIANTS, effectiveDpr, getActiveLightingMode, getActiveLightingTier,
    getShardShadowsEnabled, getShadowSoftness, getRefractionEnabled,
    getRefractBrightness, getLightBrightness, getEmissiveEnabled,
    getEmitBrightness, EMIT_BASELINE, getEmitShadowsEnabled, getEmitShadowTier,
    getEmitFadeSec, getCausticFade, getFlashlightHalfDeg, FLASHLIGHT,
    getLightColorRgb, BUBBLE_CONSTANTS, getTintMix, TRANSMIT_STRAIGHT_FRAC,
    PLAYER_LIGHT_PEAK, WORLD_LIGHTS, getWorldLightsEnabled,
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
    /** The emitting entity's id.  Carried ONLY so a halo can be matched to
     *  the same body across frames and eased rather than popped — see
     *  `EmitSlot`.  Nothing else in the shadow path reads it. */
    id: string;
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
              emits: 0, emitRgb: null, id: '', distSq: 0, mobile: false };
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
              emits: 0, emitRgb: null, id: '', distSq: 0, mobile: false };
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
/** Whether this collection wants shard SHADOWS, as opposed to only their
 *  emission — the dynamic walk now runs for either. */
let _shardShadows = true;
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
function emitTintFor(t: GameEntity, fallbackHex?: string): string | null {
    // THE BODY'S OWN COLOUR, in this order: a nebula's blended composition
    // (per body — no two clouds match), then the entity's render colour, and
    // only then the variant's legacy `glow.color` as a last resort.  The glow
    // colours are VFX leftovers from the contact glow A5f deleted, and taking
    // them first is measurably wrong: metal's is MAGENTA, so a lit steel
    // plate radiated magenta light while its own surface stayed steel.
    const src = t.nebulaBlendedHex ?? t.color ?? fallbackHex;
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

/** THE MATERIAL/LIGHT BLEND, memoised.
 *
 *  Both callers want a colour derived from two: the body's own tint and the
 *  light's, mixed by `TINT_MIX_CYCLE`.  Computing it per emitter per frame
 *  would parse two colour strings and build a third; instead the results are
 *  memoised against the body tint, and the whole memo is dropped when the
 *  light colour or the mix changes — a keypress, never a frame.
 *
 *  `toward` is what the mix runs TO at 0: the light's colour for an emitter
 *  (which radiates something between the two), and WHITE for the multiply
 *  pass (where 0 must mean "change nothing"). */
const _blendCache = new Map<string, string>();
const _blendWhiteCache = new Map<string, string>();
let _blendLight = '';
let _blendMix = -1;

function blendTint(bodyRgb: string | null, towardWhite: boolean): string | null {
    // `towardWhite` survives for the transmission path's sake conceptually,
    // but that path now carries its strength in the fill's ALPHA (see the
    // source-atop note), so today every caller mixes toward the light.
    if (bodyRgb === null) return null;
    const light = getLightColorRgb();
    const mix = getTintMix();
    if (light !== _blendLight || mix !== _blendMix) {
        _blendCache.clear();
        _blendWhiteCache.clear();
        _blendLight = light;
        _blendMix = mix;
    }
    const cache = towardWhite ? _blendWhiteCache : _blendCache;
    const hit = cache.get(bodyRgb);
    if (hit !== undefined) return hit;
    // TWO DESTINATIONS, deliberately.  A single shared scratch aliases the
    // two results — the second parse overwrites the first, both names end up
    // pointing at the light's channels, and the blend silently returns the
    // LIGHT's colour at every mix.  Caught by the nebula test, which stamps a
    // body pure red and watched it emit blue-green.
    const b = parseRgb(bodyRgb, _rgbB);
    const a = towardWhite ? _WHITE : parseRgb(light, _rgbA);
    if (b === null || a === null) return bodyRgb;
    const out = `${Math.round(a[0] + (b[0] - a[0]) * mix)}, `
              + `${Math.round(a[1] + (b[1] - a[1]) * mix)}, `
              + `${Math.round(a[2] + (b[2] - a[2]) * mix)}`;
    cache.set(bodyRgb, out);
    return out;
}

const _WHITE: [number, number, number] = [255, 255, 255];
const _rgbA: [number, number, number] = [0, 0, 0];
const _rgbB: [number, number, number] = [0, 0, 0];

/** `'r, g, b'` -> channels, or null if it is not that shape.  Writes into the
 *  CALLER's triple rather than a shared one — see the aliasing note in
 *  `blendTint`.  Runs on a cache MISS, never per frame. */
function parseRgb(s: string, out: [number, number, number]): [number, number, number] | null {
    let i = 0, n = 0;
    for (let k = 0; k < 3; k++) {
        while (i < s.length && (s[i] === ' ' || s[i] === ',')) i++;
        let v = 0, digits = 0;
        while (i < s.length && s[i] >= '0' && s[i] <= '9') {
            v = v * 10 + (s.charCodeAt(i) - 48); i++; digits++;
        }
        if (digits === 0) return null;
        out[k] = v; n++;
    }
    return n === 3 ? out : null;
}

/** Keep this body among the N nearest passThrough emitters.
 *
 *  Insertion into a fixed, always-sorted buffer: the common case is one
 *  compare against the farthest kept and an immediate return, and the pooled
 *  record evicted from the tail is the one reused for the insert, so a full
 *  buffer allocates nothing at all. */
function recordEmitter(
    t: GameEntity, emits: number, transmit: number, tint: string | null, mobile: boolean,
): void {
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
    o.transmit = transmit;
    o.emits = emits;
    o.emitRgb = tint;
    o.id = t.id;
    o.distSq = d2;
    o.mobile = mobile;
}

/** A passThrough body still LIGHTS if its variant says it does — it just
 *  never shadows.  Skipped entirely when nothing asked for emitters, so a
 *  collection with emission off costs exactly what it did before. */
function maybeRecordEmitter(t: GameEntity, v: ShardVariantId, mobile: boolean): void {
    if (_emitBuf === _EMPTY) return;
    const def = SHARD_VARIANTS[v];
    const emits = def.emits ?? 0;
    if (emits <= 0) return;
    recordEmitter(t, emits, def.transmit ?? 0, emitTintFor(t, def.glow?.color), mobile);
}

/** A BUBBLE lit by the light re-emits like the translucent membrane it is.
 *
 *  It is an emitter WITHOUT being an occluder — the same shape as nebula, and
 *  for the same reason: a soft blob has no business casting a hard shadow
 *  volume, and the emitter buffer is exactly the seam for "lights but does
 *  not shadow".  A bubble is an ENEMY rather than a shard-family body, so it
 *  has no `shardVariant` and its numbers come from BUBBLE_CONSTANTS; its
 *  colour is its own membrane, which drifts as it feeds and sickens, and the
 *  tint cache notices because it is keyed on that colour. */
function maybeRecordBubble(t: GameEntity): void {
    if (_emitBuf === _EMPTY) return;
    if (BUBBLE_CONSTANTS.EMITS <= 0) return;
    recordEmitter(t, BUBBLE_CONSTANTS.EMITS, 0, emitTintFor(t), true);
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
    if (t.type !== EntityType.STRUCTURE) {
        // The dynamic grid holds every moving body, so the bubbles are
        // already in hand here — no extra query to light them.
        if (t.enemySubtype === EnemySubtype.BUBBLE) maybeRecordBubble(t);
        return;
    }
    if (t.mass === Infinity) return;
    const v = t.shardVariant;
    if (v === undefined) return;
    if (SHARD_VARIANTS[v].passThrough === true) { maybeRecordEmitter(t, v, true); return; }
    if (!_shardShadows) { maybeRecordEmitter(t, v, true); return; }
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
    // The tint is needed for TRANSMISSION as well as emission now, so it is
    // resolved for anything that passes light on in either way.
    o.emitRgb = v !== undefined && (o.emits > 0 || o.transmit > 0)
        ? emitTintFor(t, SHARD_VARIANTS[v].glow?.color) : null;
    o.id = t.id;
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
    // The dynamic walk runs for EMITTERS too, not only for shard shadows:
    // turning shard shadows off is a statement about what casts, not about
    // what glows, and the bubbles live in that grid.
    _shardShadows = shards;
    if (shards || emitOut !== undefined) {
        physics.forEachDynamicInRadius(lx, ly, radius, visitShard);
    }
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
    /** The SHIPPED colour, and the fallback if the cycle is ever empty.  The
     *  live value comes from `LIGHT_COLOR_CYCLE` (DBG "Light color"); this
     *  row is that cycle's first entry. */
    RGB: '125, 211, 252',
    /** Mirrored in constants as `PLAYER_LIGHT_PEAK` for the fog, which needs
     *  to know how far to boost this into a mask.  The suite pins the two
     *  equal. */
    PEAK: PLAYER_LIGHT_PEAK,
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
    widenRad: number,
    lightOutside: boolean,
): boolean {
    const n = pts.length;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    // The penumbra is an ANGLE about the light, so the widening is applied as
    // a rotation of each far point's bearing — cos/sin hoisted, since every
    // vertex uses the same magnitude and only the SIGN differs.
    const cosW = Math.cos(widenRad), sinW = Math.sin(widenRad);
    const ccx = ocx - cx, ccy = ocy - cy;   // light -> body centre
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
        // Taking the far point's BEARING from the widened vertex and the near
        // point from the true one gives the cone: the near boundary stays
        // exactly on the body and the shadow opens out with distance.
        //
        // THE WIDENING IS A ROTATION, NOT A DILATION, and that distinction is
        // the whole of A5l.  A5d scaled each vertex radially away from the
        // body's CENTRE and read the far bearing off the scaled point, which
        // does deliver the right average widening — but it moves each vertex
        // by a different angle, because the amount depends on where that
        // vertex sits relative to the centre.  For an edge lying nearly along
        // the light ray (one that is about to flip between front- and
        // back-facing) the two endpoints therefore ended up at DIFFERENT
        // bearings, so the quad that should have been zero-width at the flip
        // had real area, and it appeared and vanished between frames.
        // MEASURED sweeping a light around one hex: at hard shadows an edge
        // flip changed the total shadow area by 0.8 %, and at the shipped
        // softness by 5-6 % — the click reported from the device.
        //
        // Rotating the bearing by a fixed angle instead gives BOTH endpoints
        // of such an edge the same shift (they are on the same flank, so the
        // same sign), so the quad stays degenerate through the flip, while
        // the terminator vertices — the shadow's lateral boundary, where the
        // penumbra actually reads — still get their full +/- widening.
        //
        // The sign is which side of the body's own bearing the vertex falls,
        // so the widening is always OUTWARD.  A vertex exactly on that
        // bearing takes an arbitrary sign; it is the one directly behind the
        // body's centre, deep inside the umbra, where both choices are
        // covered by its neighbours.
        const rx = x - cx, ry = y - cy;
        const len = Math.sqrt(rx * rx + ry * ry);
        if (len > 0) {
            const ux = rx / len, uy = ry / len;
            if (ccx * ry - ccy * rx >= 0) {
                _sfx[i] = cx + (ux * cosW - uy * sinW) * far;
                _sfy[i] = cy + (ux * sinW + uy * cosW) * far;
            } else {
                _sfx[i] = cx + (ux * cosW + uy * sinW) * far;
                _sfy[i] = cy + (uy * cosW - ux * sinW) * far;
            }
        } else {
            _sfx[i] = x;
            _sfy[i] = y;
        }
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
    /** DEFAULTS ONLY — the live values come from `CAUSTIC_FADE_CYCLE` (DBG
     *  "Caustic fade"), because these are a look call and the control case
     *  ('off', the old cliffs) has to stay reachable.
     *
     *  How wide the CAP fade is, as a fraction of the distance to the
     *  farthest occluder the tier's cap let in.
     *
     *  THIS IS THE SAME BUG AS THE EMITTER FLASH, from the other direction.
     *  In a dense field the occluder pool sits saturated — measured at 24 of
     *  24 translucent bodies across a glass showcase — so bodies swap in and
     *  out of it constantly as the ship moves, and a body entering brought
     *  its ENTIRE caustic with it at full strength.  Measured while drifting
     *  slowly: the caustic's total face weight moved by 5-10 % per step, in
     *  jumps of three to five faces at a time.
     *
     *  A shadow at the cap boundary is far away and subtle; a bright cone
     *  appearing out of nowhere is not, which is exactly why this was
     *  reported on glass and only on glass.  So a body approaching the cap
     *  fades its caustic out before it can be evicted.  Only when the pool
     *  is SATURATED: with room to spare the boundary is the light's own
     *  radius, where a caustic is already invisible, and tapering there
     *  would dim bodies that were never at risk of leaving. */
    CAP_FADE_FRAC: 0.25,
    /** How wide the fade INTO total internal reflection is, measured in the
     *  discriminant `k` that the Snell solve already computes (`k` is 0 at
     *  the critical angle and 1 at normal incidence).
     *
     *  THIS EXISTS BECAUSE TIR IS A CLIFF.  Past the critical angle a face
     *  transmits nothing, so as a body drifts past the light each face's
     *  cone appeared and disappeared AT FULL LENGTH — reported from the
     *  device as a click or flash on glass, and measured as a single-frame
     *  luminance jump of 30 against a median of 0.075.  Real transmission
     *  does not do that: the Fresnel coefficient falls to zero AT the
     *  critical angle, so the light is already gone by the time the cliff
     *  arrives.  Fading over a band of `k` is that behaviour, cheaply. */
    TIR_FADE_K: 0.25,
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
export let _causticFaces = 0;
export let _causticWeight = 0;
export function resetCausticStats(): void { _causticFaces = 0; _causticWeight = 0; }
export function causticStats(): { faces: number; weight: number } {
    return { faces: _causticFaces, weight: _causticWeight };
}

function emitRefractedLight(
    lctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    ocx: number, ocy: number,
    far: number,
    farBase: number,
    n: number,
): boolean {
    if (far <= 0) return false;
    let drew = false;
    const eta = REFRACT.IOR;
    const tirBand = getCausticFade().tir;
    // TAPER, NOT ALPHA.  Every cone in a transmit group shares ONE compound
    // path and therefore ONE fill, so a per-face opacity would cost a fill
    // per face.  The transmission weight rides the cone's THROW instead: a
    // face approaching the critical angle reaches less far, and since the
    // fill is the light's own falloff gradient a shorter cone is a dimmer
    // one.  At weight 0 the far points coincide with the near points and the
    // quad is degenerate — it fills nothing, which is the same result the old
    // `continue` produced, arrived at continuously.
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
        // rather than returning a vector, so the hot path allocates nothing,
        // and returns the transmission WEIGHT (0 under total internal
        // reflection) rather than a boolean — PER ENDPOINT, so a face with
        // one end near the critical angle tapers rather than switching.
        const wa = refractTo(ax - cx, ay - cy, nx, ny, eta, tirBand);
        const rax = _rx, ray = _ry;
        const wb = refractTo(bx - cx, by - cy, nx, ny, eta, tirBand);
        const rbx = _rx, rby = _ry;
        if (wa <= 0 && wb <= 0) continue;
        const fa = far * wa, fb = far * wb;
        // Instrumentation: the caustic's EFFECTIVE contribution — the throw
        // actually drawn, against the throw a fully-transmitting face at the
        // centre of the pool would get.  A pop is a step change in this.
        _causticFaces++;
        _causticWeight += (fa + fb) * 0.5 / farBase;

        // The quad is built in the SAME rotational order the shadow quads use
        // — near-a, far-a, far-b, near-b — but it is filled additively rather
        // than with destination-out, so overlapping cones simply brighten and
        // the winding does not have to be canonical.  Left in the same order
        // anyway, so the two emitters read as the same construction.
        lctx.moveTo(ax, ay);
        lctx.lineTo(ax + rax * fa, ay + ray * fa);
        lctx.lineTo(bx + rbx * fb, by + rby * fb);
        lctx.lineTo(bx, by);
        lctx.closePath();
        drew = true;
    }
    return drew;
}

/** Per-occluder CAP-FADE weight, indexed by position in the selected set.
 *  Module scratch rather than a field on the record: it is derived from the
 *  SELECTION, not from the body, and the pool is shared across lights. */
const _capW = new Float64Array(256);

/** Scratch for `refractTo` — see the allocation note at the top of the file. */
let _rx = 0, _ry = 0;

/**
 * Snell's law in 2D.  `(ix, iy)` is the incident direction (need not be unit
 * — it is normalised here), `(nx, ny)` the OUTWARD surface normal, `eta` the
 * ratio of the indices the ray is leaving over the one it enters.
 *
 * Writes the unit refracted direction into `_rx`/`_ry` and returns the
 * TRANSMISSION WEIGHT in 0..1: 0 where nothing is transmitted (a face that
 * is not an exit face, or one past the critical angle), ramping to 1 well
 * inside it.
 *
 * The weight is read off `k` — the discriminant the solve already computes,
 * which is 0 exactly at the critical angle and 1 at normal incidence — so
 * the fade costs one compare and a multiply, and is zero at precisely the
 * angle where the old boolean flipped.  TOTAL INTERNAL REFLECTION is still a
 * real branch, not a guard bolted on: `k < 0` must never reach the `sqrt`,
 * because ONE NaN discards the whole compound path, which is exactly how A4
 * shipped with no shadows at all.
 */
/** The TRANSMISSION WEIGHT for a ray leaving a body at `incidenceRad` from
 *  the face normal — the pure half of `refractTo`, factored out so it can be
 *  pinned directly.
 *
 *  Exported for the suite.  The fade this implements is invisible in
 *  aggregate: measuring it through a live scene means measuring whatever
 *  polygon the map generated, and a walk that happens to contain no critical
 *  angle fails on its own premise rather than on the behaviour.  The
 *  function IS the mechanism, so the test asserts it here — the same motive
 *  as `__omniHid` in the input suite.
 *
 *  0 past the critical angle, 1 well inside it, and a smoothstep in between
 *  whose width is `tirBand`, measured in the Snell discriminant `k` (0
 *  exactly at the critical angle, 1 at normal incidence). */
export function transmissionWeight(
    incidenceRad: number, tirBand: number, eta: number = REFRACT.IOR,
): number {
    const ci = Math.cos(incidenceRad);
    if (ci <= 0) return 0;
    const k = 1 - eta * eta * (1 - ci * ci);
    if (k <= 0) return 0;                       // TOTAL INTERNAL REFLECTION
    if (tirBand <= 0 || k >= tirBand) return 1;
    const u = k / tirBand;
    return u * u * (3 - 2 * u);
}

function refractTo(
    ix: number, iy: number, nx: number, ny: number, eta: number, tirBand: number,
): number {
    _rx = nx; _ry = ny;                         // finite, for a zero-weight quad
    const ilen = Math.sqrt(ix * ix + iy * iy);
    if (ilen === 0) return 0;
    const dx = ix / ilen, dy = iy / ilen;
    const ci = dx * nx + dy * ny;               // cos of the incidence angle
    if (ci <= 0) return 0;                      // not actually an exit face
    const k = 1 - eta * eta * (1 - ci * ci);
    if (k <= 0) return 0;                       // TOTAL INTERNAL REFLECTION
    const g = Math.sqrt(k) - eta * ci;
    _rx = eta * dx + g * nx;
    _ry = eta * dy + g * ny;
    // The WEIGHT comes from the shared pure function, so what the suite pins
    // is what the draw path runs.  `ci` is already in hand, hence acos rather
    // than a second dot product.
    return transmissionWeight(Math.acos(ci > 1 ? 1 : ci), tirBand, eta);
}

/** Signed shortest angle from `a` to `b`, in (-PI, PI]. */
function angleDelta(a: number, b: number): number {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
}

/** Is this body far enough outside the beam to skip entirely?
 *
 *  A shadow runs RADIALLY OUTWARD from its caster, so a body outside the
 *  beam cannot cast into it — which is what makes a narrow beam cheaper than
 *  the radial light rather than merely darker.  The margin covers the body's
 *  own angular size (so a body straddling the edge still casts), the
 *  penumbra, and the deviation a refracted cone leaves its body with. */
function outsideBeam(
    beamAim: number, beamHalf: number,
    dx: number, dy: number, bodyRadPx: number,
): boolean {
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= bodyRadPx) return false;               // light inside the body
    const own = Math.asin(Math.min(1, bodyRadPx / d));
    const margin = beamHalf + own + FLASHLIGHT.EDGE_DEG * DEG2RAD
                 + FLASHLIGHT.CULL_MARGIN_DEG * DEG2RAD;
    return Math.abs(angleDelta(beamAim, Math.atan2(dy, dx))) > margin;
}

/** Mask everything the player's light drew down to a CONE.
 *
 *  Runs LAST, after the shadows and the caustic, so it masks the whole of
 *  this light rather than a stage of it — a caustic added after the mask
 *  would put light outside the beam and unmake it.  It is safe to erase with
 *  `destination-out` here because the layer holds only this light: the
 *  emitters are composited afterwards, and are deliberately not masked.
 *
 *  The complement of a cone is ONE sector (of more than half the circle), so
 *  this is one path per pass rather than a winding trick.  Passes grade the
 *  edge, widest first, exactly like the shadow penumbra above.
 */
export let _beamMasks = 0;
export function beamMaskCount(): number { return _beamMasks; }
function applyBeamMask(
    lctx: CanvasRenderingContext2D,
    cx: number, cy: number, reach: number,
    aim: number, half: number,
): void {
    _beamMasks++;
    const passes = FLASHLIGHT.PASSES;
    const edge = FLASHLIGHT.EDGE_DEG * DEG2RAD;
    // Per-pass alpha so the passes COMPOSE to the spill floor: what survives
    // outside the beam is spill, and what survives inside the soft band is
    // one or two passes' worth of that.
    const a = 1 - Math.pow(FLASHLIGHT.SPILL, 1 / passes);
    // A SOLID FILL STYLE, EXPLICITLY.  `destination-out` erases by the
    // SOURCE's alpha, and the fillStyle in hand at this point is the light's
    // own falloff gradient — which is anchored at the canvas origin once the
    // transform is reset, and reads alpha 0 out where this sector is.  That
    // exact mistake is how A4 shipped with no shadows at all (see the header
    // of tests/lighting.spec.ts); it cost an afternoon then and would have
    // cost another one here, since the mask runs, throws nothing, and does
    // nothing.
    lctx.fillStyle = '#000';
    lctx.globalCompositeOperation = 'destination-out';
    lctx.globalAlpha = a;
    for (let i = 0; i < passes; i++) {
        const h = half + edge * (passes - 1 - i) / passes;
        if (h >= Math.PI) continue;                 // nothing outside to erase
        lctx.beginPath();
        lctx.moveTo(cx, cy);
        lctx.arc(cx, cy, reach, aim + h, aim - h + Math.PI * 2);
        lctx.closePath();
        lctx.fill();
    }
    lctx.globalCompositeOperation = 'source-over';
    lctx.globalAlpha = 1;
}

/** Shadow-geometry instrumentation, the sibling of `causticStats`.  Counts
 *  the quads emitted and their total area, so a POP — a quad appearing at
 *  finite width rather than growing from zero — is a step change in a number
 *  instead of a judgement about pixels.  Two adds and a cross product per
 *  quad, on a path that already builds four points. */
export let _shadowQuads = 0;
export let _shadowArea = 0;
export function resetShadowStats(): void { _shadowQuads = 0; _shadowArea = 0; }
export function shadowStats(): { quads: number; area: number } {
    return { quads: _shadowQuads, area: _shadowArea };
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
    _shadowQuads++;
    // Shoelace over the four corners, halved and unsigned.
    _shadowArea += Math.abs(
        (ax * fay - fax * ay) + (fax * fby - fbx * fay)
        + (fbx * by - bx * fby) + (bx * ay - ax * by)) * 0.5;
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
    // The player's own light takes the colour cycle; an emitter passes its
    // body's colour and overrides it.
    const rgb = tint ?? getLightColorRgb();
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
    /** Beam aim in radians, or null for a radial light.  Only the PLAYER's
     *  light passes it: a secondary emitter is a lit surface radiating in
     *  every direction, not a torch. */
    beamAim: number | null = null,
    /** Beam half-angle in radians.  Unused when `beamAim` is null. */
    beamHalf: number = Math.PI,
): void {
    // 1. Falloff.  Created at the origin and MOVED by the transform, so the
    //    cache key stays the radius and the colour.  setTransform rather than
    //    save/translate/restore: same effect, no state stack.
    lctx.setTransform(1, 0, 0, 1, cx, cy);
    lctx.fillStyle = lightGradient(lctx, rPx, tint);
    lctx.fillRect(-rPx, -rPx, rPx * 2, rPx * 2);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    resetShadowStats();

    if (count === 0) {
        // Nothing to shadow, but the beam still has to be cut — an empty
        // scene under a flashlight is a cone, not a disc.
        if (beamAim !== null && beamHalf < Math.PI) {
            applyBeamMask(lctx, cx, cy, rPx * 1.8, beamAim, beamHalf);
        }
        return;
    }

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
        // TRANSMITTED LIGHT IS RE-ADDED, NOT LEFT UNERASED — whenever it is
        // going to carry the material's colour.
        //
        // Leaving it unerased was the original construction and it cannot be
        // coloured: that light is the light's own, sitting where the shadow
        // pass declined to remove it, and every operation that tints it in
        // place either paints over the unlit part of the umbra (`multiply`)
        // or can only pull what is already there (`source-atop`), which is
        // invisible when the material's colour is close to the light's — and
        // glass is indigo against a sky-blue lamp, so it was.
        //
        // Erasing in FULL and adding the transmitted share back as its own
        // light is the construction the caustic already uses, and it puts the
        // colour in at fill time where it belongs.  At mix `off` the old
        // partial-erase runs instead, so the control case is exact.
        const tinting = transmit > 0 && getTintMix() > 0;
        const eraseAlpha = erase * (1 - (refract || tinting ? 0 : transmit));
        if (eraseAlpha <= 0) continue;      // fully transparent: casts nothing

        lctx.beginPath();
        let drew = 0;
        // THE GROUP'S COLOUR, for the transmission tint below.  Taken from
        // the first member that has one: a transmit group is one MATERIAL by
        // construction (the value comes from the variant), so its members
        // agree — except plastic, whose shade is per instance, and there the
        // first member's shade stands for the group.  One fill per group is
        // the whole point; a fill per body would be a fill per body.
        let groupTint: string | null = null;
        for (let i = 0; i < upTo; i++) {
            const o = occ[i];
            if (o.transmit !== transmit) continue;
            if (groupTint === null) groupTint = o.emitRgb;
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
            // Outside the beam: it cannot shadow into it, so skip the whole
            // body rather than draw a shadow the mask will erase.
            if (beamAim !== null && outsideBeam(beamAim, beamHalf, dx, dy, brPx)) continue;
            const ocx = cx + dx, ocy = cy + dy;

            const pts = o.pts;
            if (pts !== undefined && pts.length >= 3 && pts.length <= MAX_SIL_VERTS) {
                const far = rPx * 1.6;
                // The widening goes to the silhouette as the ANGLE it is,
                // rather than being converted into a radial scale factor
                // first — see the long note in `emitSilhouetteShadow`.  That
                // also retires `DILATE_MAX` and the "never let a dilated
                // vertex reach the light" clamp: both existed to bound a
                // radial scale, and a bearing rotation has nothing to bound.
                // `d > brPx` proves the light is outside the body — the NEAR
                // vertices are the true outline — which lets the emitter fuse
                // its two passes.
                if (emitSilhouetteShadow(lctx, cx, cy, ocx, ocy, far, pts, o.rot,
                                         worldToPx, widen, d > brPx)) drew++;
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

        // TINT WHAT CAME THROUGH.  The transmitted light is not drawn by this
        // pass — it is what the pass chose not to erase — so it cannot be
        // given a colour at fill time the way the caustic can.  Multiplying
        // the umbra by the material's colour is the operation that matches
        // what happened physically: the light that survived the body passed
        // THROUGH it.
        //
        // On the UMBRA pass only, so the tint lands once rather than once per
        // graded pass, and it reuses the path already in hand — `fill()` does
        // not consume it — so this costs one fill and no geometry.
        if (tinting && groupTint !== null && step === steps - 1) {
            // ADDITIVE, in the blended colour, filled with the light's own
            // falloff gradient — so the transmitted light fades with distance
            // exactly as the direct light does and can never out-shine it.
            //
            // With REFRACTION on this is the UNDEVIATED share: the caustic
            // takes the rest.  A prism sends most of it sideways and a pane
            // sends it straight; splitting the two is closer to a real slab
            // than either extreme, and it is what makes the material's colour
            // visible in the shipped configuration at all.
            const straight = refract ? TRANSMIT_STRAIGHT_FRAC : 1;
            lctx.setTransform(1, 0, 0, 1, cx, cy);
            lctx.fillStyle = lightGradient(lctx, rPx, blendTint(groupTint, false));
            lctx.globalAlpha = transmit * straight;
            lctx.globalCompositeOperation = 'lighter';
            lctx.fill();
            lctx.globalCompositeOperation = 'source-over';
            lctx.globalAlpha = 1;
            lctx.setTransform(1, 0, 0, 1, 0, 0);
        }
        }
    }
    if (wedges === 0 && !refract) {
        if (beamAim !== null && beamHalf < Math.PI) {
            applyBeamMask(lctx, cx, cy, rPx * 1.8, beamAim, beamHalf);
        }
        return;
    }

    // 4. REFRACTION (DBG prototype).  Additive, and LAST — a caustic is light
    //    inside the umbra, so anything drawn before the erase passes would be
    //    withheld again by the very shadow it belongs to.
    if (!refract) {
        if (beamAim !== null && beamHalf < Math.PI) {
            applyBeamMask(lctx, cx, cy, rPx * 1.8, beamAim, beamHalf);
        }
        return;
    }
    const causticFar = rPx * REFRACT.FAR_FRAC;
    resetCausticStats();
    // THE CAP FADE.  `occ` is nearest-first and `count` is what the tier's
    // cap let through, so the farthest selected body IS the eviction
    // boundary — but only when the pool is saturated (see CAP_FADE_FRAC).
    // THE CAP FADE RIDES RANK, NOT DISTANCE, because rank is the axis
    // eviction actually happens on: `occ` is nearest-first, so the LAST few
    // entries are the ones a step of movement will drop.  A distance band
    // was the first attempt and it is the wrong shape — measured, a band of
    // 25 % of the cut distance dimmed the whole caustic by 40 % on the glass
    // showcase, because in a packed field that band holds most of the pool.
    // The last few SLOTS are a handful of bodies however dense the terrain.
    //
    // PER KIND, because eviction is per kind: `selectOccluders` reserves a
    // share of the pool for mobile shards, so a TILE can be evicted while a
    // NEARER shard keeps its slot.  Fading against the wrong ranking leaves
    // tiles popping at their own boundary.
    const poolCap = getActiveLightingTier().maxOccluders;
    const fade = getCausticFade();
    const capFade = count > 0 && count >= poolCap && fade.cap > 0
                    && count <= _capW.length;
    if (capFade) {
        // ONE pre-pass over the whole selected set, because rank is a
        // property of the POOL and the draw loop below runs once per transmit
        // GROUP — counting ranks inside it would restart them per group and
        // fade the wrong bodies.
        let tileTotal = 0, shardTotal = 0;
        for (let i = 0; i < count; i++) {
            if (occ[i].mobile) shardTotal++; else tileTotal++;
        }
        const tileBand = Math.max(1, Math.round(tileTotal * fade.cap));
        const shardBand = Math.max(1, Math.round(shardTotal * fade.cap));
        let tileRank = 0, shardRank = 0;
        for (let i = 0; i < count; i++) {
            const mobile = occ[i].mobile;
            const total = mobile ? shardTotal : tileTotal;
            const rank = mobile ? shardRank++ : tileRank++;
            const u = (total - 1 - rank) / (mobile ? shardBand : tileBand);
            _capW[i] = u >= 1 ? 1 : u <= 0 ? 0 : u * u * (3 - 2 * u);
        }
    }
    for (let g = 0; g < groups; g++) {
        const transmit = _transmits[g];
        if (transmit <= 0) continue;                 // opaque: nothing to bend
        lctx.beginPath();
        let drew = false;
        let causticTint: string | null = null;
        for (let i = 0; i < count; i++) {
            const o = occ[i];
            if (o.transmit !== transmit) continue;
            if (causticTint === null) causticTint = o.emitRgb;
            const pts = o.pts;
            if (pts === undefined || pts.length < 3 || pts.length > MAX_SIL_VERTS) continue;
            const dx = (o.x - lx) * worldToPx;
            const dy = (o.y - ly) * worldToPx;
            const brPx = o.br * worldToPx;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d <= brPx) continue;                 // light inside the body
            if (d - brPx > rPx) continue;            // past the light's reach
            if (beamAim !== null && outsideBeam(beamAim, beamHalf, dx, dy, brPx)) continue;
            // Taper the THROW toward the cap boundary, the same trick the
            // TIR fade uses and for the same reason: one fill per group, so
            // the weight cannot ride the alpha.
            const capW = capFade ? _capW[i] : 1;
            if (capW <= 0) continue;
            const ocx = cx + dx, ocy = cy + dy;
            const n = pts.length;
            const cosR = Math.cos(o.rot), sinR = Math.sin(o.rot);
            for (let k = 0; k < n; k++) {
                const p = pts[k];
                _svx[k] = ocx + (p.x * cosR - p.y * sinR) * worldToPx;
                _svy[k] = ocy + (p.x * sinR + p.y * cosR) * worldToPx;
            }
            if (emitRefractedLight(lctx, cx, cy, ocx, ocy, causticFar * capW,
                                   causticFar, n)) drew = true;
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
        // The caustic carries the DEVIATED share; the straight-through pass
        // above carries the rest, so the two together are the body's transmit
        // rather than twice it.
        const deviated = getTintMix() > 0 ? 1 - TRANSMIT_STRAIGHT_FRAC : 1;
        const alpha = Math.min(REFRACT.MAX_BRIGHTNESS_FRAC, getRefractBrightness(),
                               transmit) * deviated;
        lctx.setTransform(1, 0, 0, 1, cx, cy);
        // The caustic IS transmitted light, so it carries the material's
        // colour the same way — and unlike the straight-through case it has
        // its own fill, so the blend goes into the gradient rather than
        // costing a multiply pass.
        lctx.fillStyle = lightGradient(lctx, rPx, blendTint(causticTint, false));
        lctx.globalAlpha = alpha;
        lctx.globalCompositeOperation = 'lighter';
        lctx.fill();
        lctx.globalCompositeOperation = 'source-over';
        lctx.globalAlpha = 1;
        lctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // 5. THE BEAM.  Last, so it masks everything this light drew.
    if (beamAim !== null && beamHalf < Math.PI) {
        applyBeamMask(lctx, cx, cy, rPx * 1.8, beamAim, beamHalf);
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
/** The chosen emitters' entity IDS, so a halo can be matched to the same
 *  body across frames.  See `EmitSlot`. */
const _emId: string[] = new Array(64).fill('');

/** ONE PERSISTENT EMITTER HALO.
 *
 *  Emission USED TO FLASH, and the cause was not brightness: the emitter set
 *  is chosen nearest-first and capped by the tier, so a body crossing that
 *  budget was drawn at full strength on one frame and not at all on the
 *  next.  Both frames were individually correct; the SWAP is what the eye
 *  reads as a strobe, and it happens constantly because near-equal distances
 *  reorder every time the ship moves.
 *
 *  A slot is a halo that OUTLIVES its selection.  Chosen bodies ease toward
 *  their computed alpha; a body that drops out keeps its last position and
 *  eases toward zero, so it fades out where it stood instead of vanishing.
 *  That is also why the slot stores the position rather than following the
 *  entity: a fading emitter may have been destroyed, and a dead tile's halo
 *  fading out over a quarter of a second is exactly the right behaviour.
 *
 *  `chosen` gates the expensive treatment: only a body in THIS frame's
 *  budget may cast emitter shadows.  A fading halo losing its shadow detail
 *  for 250 ms is not something anyone can see. */
export interface EmitSlot {
    /** The emitting entity, or '' for a free slot. */
    id: string;
    /** Last known WORLD position — deliberately not re-read from the entity. */
    x: number;
    y: number;
    tint: string | null;
    /** Eased alpha, what is actually drawn. */
    a: number;
    /** This frame's computed alpha; 0 when the body is not in the budget. */
    target: number;
    /** In this frame's budget — see above. */
    chosen: boolean;
}

/** How many halos may be alive at once, INCLUDING the ones fading out.  Sized
 *  well above the largest emitter budget (`ultra`'s maxLights - 1 = 31) so a
 *  sweep across dense terrain never has to evict a halo that is still
 *  visible. */
const EMIT_SLOTS = 48;
/** Below this alpha a halo is finished: it is freed rather than drawn.  One
 *  part in ~350 of full strength, which is under a single 8-bit level once
 *  the gradient's own peak alpha is applied. */
const EMIT_SLOT_EPS = 0.003;
/** The received-light band over which an emitter fades IN, as a multiple of
 *  `EMIT_MIN_RECEIVED`.  The threshold was a hard cutoff, so a body drifting
 *  toward the rim of the light switched off mid-glow — the same pop as the
 *  budget swap, from the other cause. */
const EMIT_FADE_IN_SPAN = 3;

/** Ease every slot toward its target, free the ones that have finished, and
 *  return how many remain alive.  Time-based so the fade takes the same
 *  wall-clock time at any frame rate; `performance.now()` is the render
 *  side's clock and the sim never sees this (CLAUDE.md §8). */
function tickEmitSlots(r: RenderSystem): number {
    const now = performance.now();
    const dt = r._emitSlotAtMs === 0 ? 0 : Math.min(0.25, (now - r._emitSlotAtMs) / 1000);
    r._emitSlotAtMs = now;
    const tau = getEmitFadeSec();
    // `off` is the old instantaneous behaviour, and it is a JUMP rather than
    // a very fast ease — a control case has to be the thing it controls for.
    const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
    let n = r._emitSlotCount;
    for (let i = 0; i < n; i++) {
        const sl = r._emitSlots[i];
        sl.a += (sl.target - sl.a) * k;
        if (sl.target <= 0 && sl.a < EMIT_SLOT_EPS) {
            // Swap-with-last removal: order carries no meaning here, since
            // the shadow budget is decided by `chosen`, not by slot index.
            const last = r._emitSlots[n - 1];
            r._emitSlots[i] = last;
            r._emitSlots[n - 1] = sl;
            sl.id = '';
            n--; i--;
        }
    }
    r._emitSlotCount = n;
    return n;
}

/** How many halos may be alive at once, as a multiple of the tier's emitter
 *  budget.  A HALO THAT IS FADING STILL COSTS A FILL, and the budget refills
 *  every frame while a fade lasts a quarter of a second, so an unbounded slot
 *  table would let a sweep through dense terrain accumulate a fade's worth of
 *  frames — around fifteen times the budget — of gradient fills.  Three times
 *  the budget is enough that a swap always has somewhere to fade, and bounds
 *  the extra fill cost at something in the same order as the budget itself.
 *  MEASURED at 2x and 3x under motion on the metal showcase: +0.42 vs +0.43
 *  ms p95, i.e. the halo count is not the term that costs — so the larger,
 *  smoother bound is the one to keep.  Parked, the chosen set is stable and
 *  the fade costs nothing at all. */
const EMIT_SLOTS_PER_BUDGET = 3;

/** Find this body's slot, or claim one.  Linear over at most `EMIT_SLOTS`
 *  entries — a hash would cost more than it saves at this size, and would
 *  allocate.
 *
 *  At the cap the DIMMEST fading halo is recycled, never a chosen one: the
 *  budget is smaller than the cap by construction, so there is always a
 *  fading slot to take, and taking the dimmest is the one eviction nobody
 *  can see. */
function slotFor(r: RenderSystem, id: string, maxLive: number): EmitSlot | null {
    const n = r._emitSlotCount;
    for (let i = 0; i < n; i++) if (r._emitSlots[i].id === id) return r._emitSlots[i];
    if (n >= maxLive) {
        let dim = -1, dimA = Infinity;
        for (let i = 0; i < n; i++) {
            const sl = r._emitSlots[i];
            if (sl.chosen) continue;
            if (sl.a < dimA) { dimA = sl.a; dim = i; }
        }
        if (dim < 0) return null;
        const sl = r._emitSlots[dim];
        sl.id = id;
        sl.a = 0;
        return sl;
    }
    let sl = r._emitSlots[n];
    if (sl === undefined) {
        sl = { id: '', x: 0, y: 0, tint: null, a: 0, target: 0, chosen: false };
        r._emitSlots[n] = sl;
    }
    sl.id = id;
    sl.a = 0;
    r._emitSlotCount = n + 1;
    return sl;
}

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
    enabled: boolean,
    beamAim: number | null,
    beamHalf: number,
): number {
    // Called even while emission is OFF, so the halos that were alive when it
    // was switched off fade out instead of snapping.  With no live slots that
    // is one compare and a return.
    if (!enabled && r._emitSlotCount === 0) return 0;
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
    while (enabled && n < cap && (i < count || j < emitCount)) {
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
        let received = falloffFrac(d / rPx);
        // UNDER A BEAM, a body is lit by what the beam puts on it.  Without
        // this an emitter outside the cone would glow as brightly as one
        // inside it, which is the single thing that would give the beam away
        // as a mask rather than as a light.  Same soft edge and spill floor
        // as the mask itself, so a body at the beam's edge fades rather than
        // switching — the A5j lesson, applied at the source this time
        // instead of at the halo.
        if (beamAim !== null && beamHalf < Math.PI && d > 0) {
            const off = Math.abs(angleDelta(beamAim, Math.atan2(dy, dx)));
            const edge = FLASHLIGHT.EDGE_DEG * DEG2RAD;
            let lit: number = FLASHLIGHT.SPILL;
            if (off <= beamHalf) lit = 1;
            else if (off < beamHalf + edge) {
                const u = 1 - (off - beamHalf) / edge;
                lit = FLASHLIGHT.SPILL
                    + (1 - FLASHLIGHT.SPILL) * (u * u * (3 - 2 * u));
            }
            received *= lit;
        }
        // A SMOOTH BAND, not a cutoff.  The threshold exists because an
        // emitter at the rim of the light costs a gradient fill to add
        // nothing; switching it off at a hard edge just moves the pop from
        // the budget to the rim.
        if (received <= EMIT_MIN_RECEIVED) continue;
        let w = 1;
        if (received < EMIT_MIN_RECEIVED * EMIT_FADE_IN_SPAN) {
            const u = (received - EMIT_MIN_RECEIVED)
                    / (EMIT_MIN_RECEIVED * (EMIT_FADE_IN_SPAN - 1));
            w = u * u * (3 - 2 * u);          // smoothstep
        }
        // A body cannot radiate more light than fell on it.
        let em = o.emits * scale;
        if (em > 1) em = 1;
        _emX[n] = o.x;
        _emY[n] = o.y;
        _emA[n] = received * em * w;
        _emC[n] = o.emitRgb;
        _emId[n] = o.id;
        n++;
    }

    // PASS 1b — into the persistent slots.  Everything alive decays unless
    // this frame's choice says otherwise, so leaving the budget IS the fade.
    for (let sI = 0; sI < r._emitSlotCount; sI++) {
        const sl = r._emitSlots[sI];
        sl.target = 0;
        sl.chosen = false;
    }
    const maxLive = Math.min(EMIT_SLOTS, Math.max(2, cap * EMIT_SLOTS_PER_BUDGET));
    for (let k = 0; k < n; k++) {
        const sl = slotFor(r, _emId[k], maxLive);
        if (sl === null) continue;      // every halo busy fading; next frame
        sl.x = _emX[k];
        sl.y = _emY[k];
        sl.tint = _emC[k];
        sl.target = _emA[k];
        sl.chosen = true;
    }
    const live = tickEmitSlots(r);
    if (live === 0) return 0;

    const shadowed = getEmitShadowsEnabled() && r.physics !== undefined;
    const shadowTier = getEmitShadowTier();
    const emitWorldR = emitRPx / worldToPx;

    // PASS 2 — draw.  Only now may a second collection touch the pool.
    let shadowsDrawn = 0;
    let drawn = 0;
    for (let k = 0; k < live; k++) {
        const sl = r._emitSlots[k];
        const alpha = sl.a;
        if (alpha < EMIT_SLOT_EPS) continue;
        drawn++;
        const ex = cx + (sl.x - lx) * worldToPx;
        const ey = cy + (sl.y - ly) * worldToPx;

        // Past the shadow budget, an emitter still lights — it just lights
        // flatly.  Falling back beats vanishing: the count is what the tier
        // promised, and only the treatment degrades.  A halo that is FADING
        // OUT is never shadowed: it is no longer in the budget, its body may
        // not even exist any more, and nobody can see shadow detail in a
        // quarter-second fade.
        if (!shadowed || !sl.chosen || shadowsDrawn >= shadowTier.maxEmitters) {
            // The emitter IS the player light, smaller and dimmer: same
            // cached gradient, scaled by how much light reached the body and
            // by how much of it the material throws back.  So it tracks the
            // brightness cycle for free and can never out-shine what lit it.
            lctx.setTransform(1, 0, 0, 1, ex, ey);
            lctx.fillStyle = lightGradient(lctx, emitRPx, blendTint(sl.tint, false));
            lctx.globalAlpha = alpha;
            lctx.globalCompositeOperation = 'lighter';
            lctx.fillRect(-emitRPx, -emitRPx, emitRPx * 2, emitRPx * 2);
            lctx.globalCompositeOperation = 'source-over';
            lctx.globalAlpha = 1;
            lctx.setTransform(1, 0, 0, 1, 0, 0);
            continue;
        }

        const sctx = ensureEmitCanvas(r);
        if (sctx === null) continue;
        shadowsDrawn++;
        // Clear and composite only this emitter's own box.
        const bx = Math.floor(ex - emitRPx), by = Math.floor(ey - emitRPx);
        const bw = Math.ceil(emitRPx * 2) + 1, bh = bw;
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.clearRect(bx, by, bw, bh);

        const cn = collectOccluders(r.physics!, sl.x, sl.y, emitWorldR,
                                    r._emitOccluders, getShardShadowsEnabled());
        r._emitOccluders.sort(byDistSq);
        const sel = selectOccluders(r._emitOccluders, cn,
                                    Math.min(shadowTier.maxOccluders, cn),
                                    Math.min(4, cn));
        compositeLight(sctx, ex, ey, emitRPx, r._emitOccluders, sel,
                       sl.x, sl.y, worldToPx, getShadowSoftness(), false,
                       blendTint(sl.tint, false));

        lctx.globalAlpha = alpha;
        lctx.globalCompositeOperation = 'lighter';
        lctx.drawImage(r._emitCanvas!, bx, by, bw, bh, bx, by, bw, bh);
        lctx.globalCompositeOperation = 'source-over';
        lctx.globalAlpha = 1;
    }
    return drawn;
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
/** Scratch for the world-light pick, module scope (no per-frame alloc). */
const _wlX = new Float64Array(64);
const _wlY = new Float64Array(64);
const _wlR = new Float64Array(64);
const _wlA = new Float64Array(64);
const _wlD = new Float64Array(64);
const _wlC: (string | null)[] = new Array(64).fill(null);
let _lastWorldLights = 0;
export function lastWorldLightCount(): number { return _lastWorldLights; }

/** A6 — WORLD LIGHTS: the self-luminous movers as first-class lights.
 *
 *  Shots and the snitch light the layer in their OWN colour.  They are not
 *  emitters — an emitter's brightness is what the player's light put on it,
 *  where a shot glows because it is on fire — so they take no `received`
 *  factor, no beam gate, and they work outside the player light's radius.
 *
 *  CULLING is the stage's other half, and it happens BEFORE the budget: a
 *  candidate whose light disc misses the layer rect costs one rectangle
 *  test.  Survivors are budgeted NEAREST-TO-SCREEN-CENTRE first into what
 *  is left of the tier's `maxLights` after the player and the emitters, so
 *  the tier's number stays the whole frame's light count.
 *
 *  NO SHADOWS, deliberately — the same call the emitters make at their
 *  default: these are the fastest-moving things in the game, a shadow from
 *  a bolt is unreadable at any speed, and each shadowed light is a fresh
 *  occluder collection.  If that ever changes it must go through the
 *  emit-shadow scratch canvas path (A3 landmine: the occluder pool is
 *  shared, so each light's set must be consumed before the next collect).
 */
function compositeWorldLights(
    lctx: CanvasRenderingContext2D,
    entities: GameEntity[],
    lw: number, lh: number,
    camX: number, camY: number, zoom: number,
    shakeX: number, shakeY: number,
    width: number, height: number, k: number,
    budget: number,
): number {
    if (budget <= 0 || !getWorldLightsEnabled()) { _lastWorldLights = 0; return 0; }
    const worldToPx = zoom * k;
    const ccx = lw / 2, ccy = lh / 2;
    let n = 0;
    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (!e.active) continue;
        let radius = 0, alpha = 0;
        if (e.type === EntityType.PROJECTILE) {
            // Arc segments are decoration on a strike that already lit the
            // frame; lighting every segment would turn one bolt into a rope
            // of lights.
            if (e.isLightningArc === true) continue;
            radius = WORLD_LIGHTS.PROJECTILE_RADIUS
                   * (e.isCharged === true ? WORLD_LIGHTS.CHARGED_MULT : 1);
            alpha = WORLD_LIGHTS.PROJECTILE_ALPHA;
        } else if (e.isSnitch === true) {
            radius = WORLD_LIGHTS.SNITCH_RADIUS;
            alpha = WORLD_LIGHTS.SNITCH_ALPHA;
        } else {
            continue;
        }
        const ex = (width / 2 + (shiftX(camX, e.position.x) - camX + shakeX) * zoom) * k;
        const ey = (height / 2 + (shiftY(camY, e.position.y) - camY + shakeY) * zoom) * k;
        const rPx = radius * worldToPx;
        // THE CULL: the light's own disc against the layer rect.
        if (ex + rPx < 0 || ex - rPx > lw || ey + rPx < 0 || ey - rPx > lh) continue;
        if (n >= _wlX.length) break;
        _wlX[n] = ex; _wlY[n] = ey; _wlR[n] = rPx; _wlA[n] = alpha;
        _wlC[n] = e.color !== undefined ? normalizedTint(e.color) : null;
        const ddx = ex - ccx, ddy = ey - ccy;
        _wlD[n] = ddx * ddx + ddy * ddy;
        n++;
    }
    if (n === 0) { _lastWorldLights = 0; return 0; }
    // Budgeted nearest-to-centre: selection sort of the first `budget` —
    // budget is single digits, n a few dozen, and this allocates nothing.
    const take = Math.min(budget, n);
    for (let a = 0; a < take; a++) {
        let best = a;
        for (let b = a + 1; b < n; b++) if (_wlD[b] < _wlD[best]) best = b;
        if (best !== a) {
            let t = _wlD[a]; _wlD[a] = _wlD[best]; _wlD[best] = t;
            t = _wlX[a]; _wlX[a] = _wlX[best]; _wlX[best] = t;
            t = _wlY[a]; _wlY[a] = _wlY[best]; _wlY[best] = t;
            t = _wlR[a]; _wlR[a] = _wlR[best]; _wlR[best] = t;
            t = _wlA[a]; _wlA[a] = _wlA[best]; _wlA[best] = t;
            const c = _wlC[a]; _wlC[a] = _wlC[best]; _wlC[best] = c;
        }
    }
    lctx.globalCompositeOperation = 'lighter';
    for (let a = 0; a < take; a++) {
        lctx.setTransform(1, 0, 0, 1, _wlX[a], _wlY[a]);
        lctx.fillStyle = lightGradient(lctx, _wlR[a], _wlC[a]);
        lctx.globalAlpha = _wlA[a];
        lctx.fillRect(-_wlR[a], -_wlR[a], _wlR[a] * 2, _wlR[a] * 2);
    }
    lctx.globalCompositeOperation = 'source-over';
    lctx.globalAlpha = 1;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    _lastWorldLights = take;
    return take;
}

export function renderLightLayer(
    r: RenderSystem, ctx: CanvasRenderingContext2D, width: number, height: number,
    playerPos?: Vector2, camera?: CameraState, playerRot?: number,
    /** The frame's entity list, for the A6 world lights (shots, snitch).
     *  Optional so older call sites stay valid; without it there are no
     *  world lights, not an error. */
    entities?: GameEntity[],
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
            // THE BEAM.  Half-angle 180 is the radial light and costs nothing
            // extra (no mask, no cull); 0 draws no player light at all, so
            // what is left on the layer is exactly the emitters.  The aim is
            // `player.rotation` — the angle shots travel along — so the torch
            // points where the ship is looking and needs no second control.
            // The TOOL owns the cone while it is on; the DBG global is the
            // dev override underneath (see FLASHLIGHT_TOOL_LEVELS).
            const halfDeg = r.playerLightToolHalfDeg ?? getFlashlightHalfDeg();
            const beamOn = halfDeg < 180;
            const beamHalf = halfDeg * DEG2RAD;
            const beamAim = beamOn ? (playerRot ?? 0) : null;
            if (!beamOn || halfDeg > 0) {
                compositeLight(lctx, cx, cy, rPx,
                               r._lightOccluders, r._lightOccluderCount,
                               playerPos.x, playerPos.y, worldToPx,
                               getShadowSoftness(), getRefractionEnabled(),
                               null, beamAim, beamHalf);
            }
            // SECONDARY lights, from the same occluder set the shadows were
            // cast from — the bodies the light reaches are exactly the ones
            // that can re-emit it.  `maxLights` counts the player's own, so
            // the tier's budget is shared rather than added to.
            lights += compositeEmitters(
                r, lctx, cx, cy, rPx, r._lightOccluders, r._lightOccluderCount,
                r._lightEmitters, r._lightEmitterCount,
                playerPos.x, playerPos.y, worldToPx,
                wantEmitters ? tier.maxLights - 1 : 0, wantEmitters,
                beamAim, beamHalf);
            // A6 — WORLD LIGHTS, out of what is left of the tier's budget.
            if (entities !== undefined) {
                lights += compositeWorldLights(
                    lctx, entities, lw, lh,
                    camera.position.x, camera.position.y, camera.zoom,
                    shake.x, shake.y, width, height, k,
                    tier.maxLights - lights);
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
