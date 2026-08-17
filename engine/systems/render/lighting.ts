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
import type { RenderSystem } from '../RenderSystem';
import { GameEntity, EntityType } from '../../../types';
import {
    SHARD_VARIANTS, effectiveDpr, getActiveLightingMode, getActiveLightingTier,
} from '../../../constants';
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

/** Nearest-first comparator, hoisted — a comparator literal passed to
 *  `sort` inside a per-frame path is rebuilt every frame. */
function byDistSq(a: Occluder, b: Occluder): number { return a.distSq - b.distSq; }

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
    playerPos?: { x: number; y: number },
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
        const n = collectOccluders(r.physics, playerPos.x, playerPos.y, tier.maxRadius, r._lightOccluders);
        // Nearest-first, then cap: the nearest occluders subtend the largest
        // shadow angle, so truncation degrades gracefully instead of dropping
        // whichever ones the grid happened to return last.
        r._lightOccluders.sort(byDistSq);
        r._lightOccluderCount = n < tier.maxOccluders ? n : tier.maxOccluders;
        lights = 1;
        // A4 draws the falloff and the wedges.  A3 collects only, so the
        // number it reports is the collection cost with nothing else in it.
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
