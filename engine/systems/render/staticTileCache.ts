/** The STATIC-TILE CACHE — the pre-rendered layer of immovable terrain.
 *
 *  Extracted verbatim from `RenderSystem.ts` in gauntlet 5f (see
 *  `docs/GAUNTLET_5F_LOG.md`).  Immovable tiles (`mass: Infinity`) do not
 *  move, so redrawing each one every frame is pure waste; they are stamped
 *  once into an offscreen canvas that the world pass blits in a single draw,
 *  and erased from it individually when they die or change appearance.
 *
 *  The pass is BUDGETED (`STATIC_TILE_STAMPS_PER_FRAME`): gauntlet 5c timed
 *  the stamping and found it was NOT the source of the render spikes it was
 *  suspected of (`docs/GAUNTLET_5C_LOG.md` P16), but the budget stays because
 *  an unbounded stamp burst on map load is a real one-frame cost.
 *
 *  Free functions over `r: RenderSystem` — the cache canvas, its scale, the
 *  membership set and the stamp counters are per-renderer state and stay
 *  fields there.  `RenderSystem` is a TYPE import, so no runtime cycle.
 */
import type { RenderSystem } from '../RenderSystem';
import { GameEntity, EntityType, Vector2 } from '../../../types';
import {
    SHARD_VARIANTS, STATIC_TILE_STAMPS_PER_FRAME, SPRITE_CONSTANTS, COLORS, ASSETS,
} from '../../../constants';
import { MAP_WIDTH, MAP_HEIGHT, wrapDeltaX, wrapDeltaY } from '../../toroidal';
import { shiftX, shiftY } from './drawUtils';

/** Upper bound on either dimension of the offscreen cache canvas.  Lived as
 *  a private readonly on `RenderSystem`; the cache is its only reader, so it
 *  came along with the code that respects it. */
const STATIC_TILE_MAX_CANVAS_DIM = 3072;

/**
 * True for tile variants whose appearance can be pre-baked into the
 * static-tile world canvas.
 *  - glass-tile + indestructible-tile: share the hex-sprite fast path
 *    in renderEntities — cache stamps the same drawImage.
 *
 * Excluded:
 *  - rock-tile: takes per-hit polygon-shrink dents AND accumulates
 *    crack-line damage indicators.  Both need the slow-path render
 *    to reach the live entity state every frame; caching makes both
 *    invisible until the cache happens to invalidate, which has been
 *    a recurring source of visual bugs.  Keeping rock-tile on the
 *    slow path costs a small per-frame draw per visible rock-tile
 *    in exchange for correct, immediate damage feedback.
 *  - nebula-tile: already cached per-entity (tinted sprite cache +
 *    the nebula fast path); world-canvas caching would lose fidelity.
 *  - plastic-tile / metal-tile: selective neighbour-aware outline
 *    rendering requires the spatial-grid neighbour lookup; not worth
 *    the extra complexity for the smaller marginal gain.
 */
export function isStaticTileCacheable(r: RenderSystem, e: GameEntity): boolean {
    return e.type === EntityType.STRUCTURE
        && e.mass === Infinity
        && (e.shardVariant === 'glass-tile'
            || e.shardVariant === 'indestructible-tile');
}

/**
 * Variant dispatch for the cache stamp.  Glass-family tiles stamp via
 * the shared hex sprite (matches their renderEntities fast path).
 * Caller has already guaranteed the variant is cache-eligible.
 */
function stampStaticTileToCache(r: RenderSystem, e: GameEntity): void {
    const cx = r._staticTileCanvasCtx;
    if (!cx) return;
    stampHexSpriteTileToCache(r, cx, e);
}

/**
 * Glass/indestructible stamp — the hex sprite drawImage that the
 * per-entity fast path uses, ported to the cache canvas's coordinate
 * system (1 canvas px = 1/scale world units).
 */
function stampHexSpriteTileToCache(r: RenderSystem, cx: CanvasRenderingContext2D, e: GameEntity): void {
    const baseSprite = r.getImage(ASSETS.HEX_STRUCTURE);
    if (!baseSprite.complete || baseSprite.naturalWidth === 0) return;
    const s = r._staticTileScale;
    const halfMapW = r._staticTileMapW / 2;
    const halfMapH = r._staticTileMapH / 2;
    const wx = (e.position.x + halfMapW) * s;
    const wy = (e.position.y + halfMapH) * s;
    const maxDim = Math.max(e.size.x, e.size.y);
    const drawSize = maxDim * 1.02 * s;
    const dHalf = drawSize / 2;
    // Glass tiles fade the sprite by their neighbour-count automata
    // (opacity path) so dense interiors read see-through against the
    // background — a brightness multiply muddies translucent glass.
    // The reduced alpha bakes straight into the cache pixels, so the
    // single static-layer blit composites the transparency for free.
    // Indestructible (no automata cfg) and edge tiles stamp at 1.0.
    // A count change flips _staticCached false (ShardSystem), forcing
    // this re-stamp.
    const alpha = Math.min(1, r.materialAutomataAlpha(e));
    if (alpha !== 1) cx.globalAlpha = alpha;
    cx.drawImage(baseSprite, wx - dHalf, wy - dHalf, drawSize, drawSize);
    if (alpha !== 1) cx.globalAlpha = 1;
    captureStampPolyOnce(e);
    e._staticCached = true;
    r._staticTileCacheSet.add(e);
}

/**
 * Rock-tile stamp — replicates the slow-path "polygon fill in
 * entity.color, no outline" branch at the tile's canvas position.
 * Mirrors the densityHex-tinted fill that renderEntities would draw
 * on the main ctx; for cache purposes we use entity.color directly
 * since densityTier transitions invalidate the cache via dent /
 * shatter paths anyway.
 */
/**
 * Capture the entity's polygonPoints into `_staticStampPoly` on the
 * FIRST cache stamp for this tile, deep-copying so subsequent dent
 * mutations to polygonPoints don't reach back and shrink the stored
 * erase footprint.  The stored polygon is what eraseStaticTileFromCache
 * uses — covers the maximum footprint anything was ever stamped at
 * for this tile, so post-dent or on-death erases never leave a halo
 * of original rim around the now-smaller current polygon.
 */
function captureStampPolyOnce(e: GameEntity): void {
    if (e._staticStampPoly !== undefined) return;
    const pts = e.polygonPoints;
    if (!pts || pts.length === 0) return;
    const copy: Vector2[] = new Array(pts.length);
    for (let i = 0; i < pts.length; i++) copy[i] = { x: pts[i].x, y: pts[i].y };
    e._staticStampPoly = copy;
}

/**
 * Erase a tile's stamped pixels from the world-tile canvas via
 * destination-out compositing.  Always clears regardless of the
 * tile's current `_staticCached` flag — used in three situations:
 *  - fast→slow transitions (tile entered glow / hit flash / regen);
 *  - tile destruction (active flipped false);
 *  - pre-stamp scrub on a transition where polygonPoints may have
 *    been mutated since the last stamp (rock-tile dent).
 *
 * Erases along the polygon outline at exactly 1× the stamp scale.
 * Hex tiles in a grid abut directly — adjacent polygons share an
 * edge, no gap — so any erase polygon LARGER than the stamp would
 * bite into neighbouring cached tiles, leaving transparent wedges
 * around their edges (reads as heavy black outlines on dark
 * backgrounds).  At 1×, the erase covers exactly the stamp's
 * footprint and stops at the shared edge; neighbours stay intact.
 * Tiny anti-aliasing residue at the polygon edge is masked by the
 * slow-path render that paints in that area immediately after.
 *
 * Tiles without polygonPoints fall back to the rect path with a
 * small margin — none today, but defensive.
 */
export function eraseStaticTileFromCache(r: RenderSystem, e: GameEntity): void {
    const cx = r._staticTileCanvasCtx;
    if (!cx) return;
    const s = r._staticTileScale;
    const halfMapW = r._staticTileMapW / 2;
    const halfMapH = r._staticTileMapH / 2;
    const wx = (e.position.x + halfMapW) * s;
    const wy = (e.position.y + halfMapH) * s;
    const prevOp = cx.globalCompositeOperation;
    cx.globalCompositeOperation = 'destination-out';
    cx.fillStyle = '#000';
    // Prefer the polygon captured at first stamp — it covers the
    // maximum footprint anything was ever stamped at for this tile,
    // so post-dent or on-death erases never leave a halo of original
    // rim around the (now smaller) current polygonPoints.  Falls
    // back to current polygon for tiles that somehow reach erase
    // without a first stamp, and finally to a rect for tiles
    // without polygonPoints at all.
    const pts = e._staticStampPoly ?? e.polygonPoints;
    if (pts && pts.length > 0) {
        cx.save();
        cx.translate(wx, wy);
        cx.beginPath();
        cx.moveTo(pts[0].x * s, pts[0].y * s);
        for (let i = 1; i < pts.length; i++) {
            cx.lineTo(pts[i].x * s, pts[i].y * s);
        }
        cx.closePath();
        cx.fill();
        cx.restore();
    } else {
        const maxDim = Math.max(e.size.x, e.size.y);
        const eraseSize = maxDim * 1.1 * s;
        const eHalf = eraseSize / 2;
        cx.fillRect(wx - eHalf, wy - eHalf, eraseSize, eraseSize);
    }
    cx.globalCompositeOperation = prevOp;
    e._staticCached = false;
    r._staticTileCacheSet.delete(e);
}

/**
 * Build the static-tile world canvas from scratch.  Called from
 * GameEngine.loadMap right after buildMinimapStaticLayer.  Canvas is
 * sized to cover one full toroidal wrap unit of the map at a scale
 * picked to fit the STATIC_TILE_MAX_CANVAS_DIM budget; on smaller maps
 * the canvas is 1:1 with world coords (zero blur), on larger maps the
 * scale shrinks and the blit upscales (mild blur on close zoom).
 */
export function buildStaticTileLayer(r: RenderSystem, entities: GameEntity[], mapWidth: number, mapHeight: number): void {
    const maxWorld = Math.max(mapWidth, mapHeight);
    let scale = 1.0;
    if (maxWorld * scale > STATIC_TILE_MAX_CANVAS_DIM) {
        scale = STATIC_TILE_MAX_CANVAS_DIM / maxWorld;
    }
    r._staticTileScale = scale;
    r._staticTileMapW = mapWidth;
    r._staticTileMapH = mapHeight;
    const cW = Math.ceil(mapWidth * scale);
    const cH = Math.ceil(mapHeight * scale);
    const c = document.createElement('canvas');
    c.width = cW;
    c.height = cH;
    const cx = c.getContext('2d');
    if (!cx) { r._staticTileCanvas = null; return; }
    r._staticTileCanvas = c;
    r._staticTileCanvasCtx = cx;
    r._staticTileCacheSet.clear();

    // Hex sprite might still be loading; tiles below will silently skip
    // and the next renderEntities sweep will lazily stamp them once the
    // image completes.  Keeps map-load deterministic without blocking
    // on the asset pipeline.
    const hexSprite = r.getImage(ASSETS.HEX_STRUCTURE);
    const hexReady = hexSprite.complete && hexSprite.naturalWidth > 0;

    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (!e.active || !isStaticTileCacheable(r, e)) {
            e._staticCached = false;
            continue;
        }
        if (!hexReady) { e._staticCached = false; continue; }
        stampStaticTileToCache(r, e);
    }
}

/**
 * Blit the pre-baked static-tile canvas into the current camera-local
 * world frame.  Called inside renderEntities's camera transform so
 * world coords map straight to screen.  Handles toroidal wrap by
 * always drawing 4 wrap-offset copies — most will fall outside the
 * scissor rect and become near-noop GPU blits, so this is cheaper
 * than computing which copies are needed every frame.
 */
export function blitStaticTileLayer(r: RenderSystem, ctx: CanvasRenderingContext2D): void {
    const canvas = r._staticTileCanvas;
    if (!canvas) return;
    const mapW = r._staticTileMapW;
    const mapH = r._staticTileMapH;
    const x0 = -mapW / 2;
    const y0 = -mapH / 2;
    ctx.drawImage(canvas, x0,        y0,        mapW, mapH);
    ctx.drawImage(canvas, x0 + mapW, y0,        mapW, mapH);
    ctx.drawImage(canvas, x0 - mapW, y0,        mapW, mapH);
    ctx.drawImage(canvas, x0,        y0 + mapH, mapW, mapH);
    ctx.drawImage(canvas, x0,        y0 - mapH, mapW, mapH);
    ctx.drawImage(canvas, x0 + mapW, y0 + mapH, mapW, mapH);
    ctx.drawImage(canvas, x0 - mapW, y0 - mapH, mapW, mapH);
    ctx.drawImage(canvas, x0 + mapW, y0 - mapH, mapW, mapH);
    ctx.drawImage(canvas, x0 - mapW, y0 + mapH, mapW, mapH);
}

/**
 * Pre-frame pass that resolves fast↔slow appearance transitions BEFORE
 * the static-tile canvas is blitted into the world frame.  Without
 * this pass, a tile entering its glow / hit flash window would draw
 * its slow-path overlay on top of the cache's still-present base
 * appearance for one frame — a brief one-frame brightening glitch.
 *
 * Walks `_visibleEntities` (the camera-culled candidate list already
 * built by renderEntities's caller in prepareFrameEntities) and, for
 * each cacheable static tile, decides whether the cache stamp should
 * be present and transitions if it isn't.  Off-screen tiles can't
 * cause this glitch (the player can't see them) so we don't bother
 * walking the master list.
 */
export function prepareStaticTileCacheForFrame(r: RenderSystem, playerPos: Vector2 | undefined): void {
    if (!r._staticTileCanvas) return;
    const entries = r._visibleEntities;
    let stampBudget = STATIC_TILE_STAMPS_PER_FRAME;
    const tStamp0 = performance.now();
    const stampStart = stampBudget;
    for (let i = 0; i < entries.length; i++) {
        const entity = entries[i].entity;
        if (!isStaticTileCacheable(r, entity)) continue;
        // Reproduce the fast-path acceptance check used in renderEntities
        // so a tile that's about to take the slow path gets erased now,
        // before the canvas blit paints its stale base.  Glass tiles
        // also brighten on contact via repelImpulse — same gate as the
        // existing fast-path branch.
        let inGlowRange = false;
        if (entity.shardVariant === 'glass-tile') {
            inGlowRange = (entity.repelImpulse ?? 0) > 0;
        } else if (playerPos && entity.shardVariant !== undefined) {
            const g = SHARD_VARIANTS[entity.shardVariant].glow;
            if (g !== undefined) {
                const fpdx = wrapDeltaX(entity.position.x, playerPos.x);
                const fpdy = wrapDeltaY(entity.position.y, playerPos.y);
                inGlowRange = fpdx * fpdx + fpdy * fpdy < g.range * g.range;
            }
        }
        const wantsCache = entity.active
            && !entity.hitFlash
            && entity.regenPopTimer === undefined
            && !inGlowRange;
        if (wantsCache && entity._staticCached !== true) {
            // BUDGETED (see STATIC_TILE_STAMPS_PER_FRAME): stamping is a
            // clearRect + drawImage on a map-sized offscreen canvas, and
            // this loop used to do as many as were pending — so a moment
            // where many tiles became cacheable at once (sprite load, a
            // wave of regen) cost 40-45ms of render in ONE frame.  Skipping
            // a stamp is not a visual change: the tile just renders through
            // the normal per-entity path this frame, exactly as it does
            // until it gets stamped.
            if (stampBudget > 0) {
                stampBudget--;
                // Pre-scrub the stamp area in case polygonPoints was
                // mutated since the last stamp (rock-tile dent) — without
                // this the new (smaller) polygon paints inside the old
                // outline, leaving a halo of stale pixels around the dent.
                eraseStaticTileFromCache(r, entity);
                stampStaticTileToCache(r, entity);
            }
        } else if (!wantsCache && entity._staticCached === true) {
            eraseStaticTileFromCache(r, entity);
        }
    }
    r.lastStampCount = stampStart - stampBudget;
    r.lastStampMs = r.lastStampCount > 0 ? performance.now() - tStamp0 : 0;
}

/**
 * Sync the static-tile cache against any tile-destruction events that
 * happened since the last frame.  Called at the top of render() so
 * stale tiles don't linger as ghost stamps after the gameplay state
 * removes them.  Cheap: only walks tiles currently in the cache.
 */
export function syncStaticTileCacheAgainstDeaths(r: RenderSystem): void {
    if (r._staticTileCacheSet.size === 0) return;
    // Collect first to avoid mutating set while iterating.
    let dead: GameEntity[] | null = null;
    for (const e of r._staticTileCacheSet) {
        // Evict on death OR when a tile stops being static (mass goes finite —
        // e.g. the dragon eating it into a body segment) so no ghost is left.
        if (!e.active || e.mass !== Infinity) {
            if (dead === null) dead = [];
            dead.push(e);
        }
    }
    if (dead) {
        for (let i = 0; i < dead.length; i++) eraseStaticTileFromCache(r, dead[i]);
    }
}
