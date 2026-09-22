/** FOG OF WAR — darkness the player's light cuts through.
 *
 *  THE LIGHT LAYER IS ALREADY THE MASK.  It is a lit shape with shadows cut
 *  out of it, drawn this frame, at the resolution the fog wants — so the fog
 *  is composed FROM it rather than computing any geometry of its own.  A
 *  tile's shadow stays dark, a beam opens exactly the cone it lights, and
 *  every future light lands in the fog for free.  Nothing here walks the
 *  occluder set, and nothing here may: the moment the fog needs its own
 *  geometry it stops being a compositing pass and becomes a second lighting
 *  system.
 *
 *  THREE LAYERS OR TWO.  Two is lit-or-not, and stateless.  Three adds "seen
 *  before", which needs a MEMORY of where the player has been — a small
 *  world-space texture (one texel per `FOG.CELL` units, so 125x125 on a
 *  6000-unit map) stamped as the ship moves and reset on every map load.
 *  That reset is the only piece of per-map persistent state the renderer
 *  owns, and a stale one would show the last map's explored shape on this
 *  one.
 *
 *  THE MEMORY IS KEPT AT EVERY RUNG above `off`, even though the WORLD fog
 *  spends it only at the three-layer one.  The MINIMAP fogs itself with it
 *  at all of them (user directive), and a memory that only accumulated on
 *  one rung would leave the map blank on the other two — the recording is
 *  cheap (one arc into a 125x125 canvas), the SPENDING is what the rung
 *  chooses.
 *
 *  ALL OF IT IS SCREEN SPACE and runs after the light blit, before the HUD —
 *  so the fog darkens the world and never the interface.
 */
import type { RenderSystem } from '../RenderSystem';
import { CameraState, Vector2 } from '../../../types';
import { getFog, FOG, effectiveDpr, getActiveLightingTier, PLAYER_LIGHT_PEAK,
         getLightBrightness, getDepthAmbientEnabled, AMBIENT_DEPTH_CAP,
       } from '../../../constants';
import { MAP_WIDTH, MAP_HEIGHT } from '../../toroidal';
import { shiftX, shiftY } from './drawUtils';

/** A7 — the fog level DEPTH imposes, independent of the fog cycle: the
 *  tier's `ambientPerStage` per descent, capped at AMBIENT_DEPTH_CAP stages.
 *  Folded into the fog's dark fill as max(cycle, depth) — whichever wants
 *  the world darker wins — so descending through a run darkens it even with
 *  the fog cycle at `off`, and a player who already runs `dark` fog sees
 *  depth take over only once it exceeds their setting.  The minimap veil
 *  reads the same number, so map and world darken together. */
export function fogEffectiveDark(r: RenderSystem): number {
    const cycle = getFog().dark;
    if (!getDepthAmbientEnabled()) return cycle;
    const stages = Math.min(r.stageDepth, AMBIENT_DEPTH_CAP);
    const depth = getActiveLightingTier().ambientPerStage * stages;
    return depth > cycle ? depth : cycle;
}

/** The explored texture TILES with the map, and its period is the map's
 *  extent in cells — NOT the canvas width, which is that rounded UP.  On a
 *  15000-unit map at 48 units a cell that is 312.5 against a 313-wide
 *  canvas, so wrapping on the canvas width shifts the seam by half a cell
 *  and slides the world fog against the minimap fog.  Both consumers read
 *  the period from here. */
export function fogMemoryPeriodX(): number { return MAP_WIDTH / FOG.CELL; }
export function fogMemoryPeriodY(): number { return MAP_HEIGHT / FOG.CELL; }

/** Drop the explored memory.  Called on every map load: the texture is world
 *  space, and world space means something different on the next map. */
export function resetFogMemory(r: RenderSystem): void {
    if (r._fogMemCtx !== null && r._fogMem !== null) {
        r._fogMemCtx.setTransform(1, 0, 0, 1, 0, 0);
        r._fogMemCtx.clearRect(0, 0, r._fogMem.width, r._fogMem.height);
    }
}

/** Ensure the two scratch surfaces exist at the light layer's size, and the
 *  memory texture at the MAP's size.  All are null until the fog is first
 *  switched on, so `off` allocates nothing. */
function ensureCanvases(r: RenderSystem, w: number, h: number): boolean {
    if (typeof document === 'undefined') return false;
    if (r._fogCanvas === null) {
        r._fogCanvas = document.createElement('canvas');
        r._fogCtx = r._fogCanvas.getContext('2d');
        if (r._fogCtx === null) { r._fogCanvas = null; return false; }
    }
    if (r._fogCanvas.width !== w || r._fogCanvas.height !== h) {
        r._fogCanvas.width = w; r._fogCanvas.height = h;
    }
    if (r._fogMaskCanvas === null) {
        r._fogMaskCanvas = document.createElement('canvas');
        r._fogMaskCtx = r._fogMaskCanvas.getContext('2d');
        if (r._fogMaskCtx === null) { r._fogMaskCanvas = null; return false; }
    }
    if (r._fogMaskCanvas.width !== w || r._fogMaskCanvas.height !== h) {
        r._fogMaskCanvas.width = w; r._fogMaskCanvas.height = h;
    }
    const mw = Math.max(1, Math.ceil(MAP_WIDTH / FOG.CELL));
    const mh = Math.max(1, Math.ceil(MAP_HEIGHT / FOG.CELL));
    if (r._fogMem === null) {
        r._fogMem = document.createElement('canvas');
        r._fogMemCtx = r._fogMem.getContext('2d');
        if (r._fogMemCtx === null) { r._fogMem = null; return false; }
    }
    if (r._fogMem.width !== mw || r._fogMem.height !== mh) {
        // A resize CLEARS the canvas, which is the right behaviour here: a
        // memory sized for another map is not this map's memory.
        r._fogMem.width = mw; r._fogMem.height = mh;
    }
    return true;
}

/** Stamp what the ship can currently see into the explored memory.
 *
 *  A disc rather than the light's real shape, deliberately: memory is what
 *  you WENT PAST, not what you had line of sight to at one instant, and a
 *  remembered map full of shadow-shaped holes reads as a bug rather than as
 *  recall.  Drawn at the wrap offsets too, so walking through the seam does
 *  not leave a hard edge down the middle of the memory. */
function stampMemory(r: RenderSystem, px: number, py: number, radius: number): void {
    const mctx = r._fogMemCtx;
    const mem = r._fogMem;
    if (mctx === null || mem === null) return;
    const cx = px / FOG.CELL, cy = py / FOG.CELL;
    const rad = Math.max(1, radius / FOG.CELL);
    const perX = fogMemoryPeriodX(), perY = fogMemoryPeriodY();
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.globalCompositeOperation = 'source-over';
    mctx.globalAlpha = 1;
    mctx.fillStyle = '#fff';
    for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
            const x = cx + ox * perX, y = cy + oy * perY;
            if (x + rad < 0 || x - rad > mem.width) continue;
            if (y + rad < 0 || y - rad > mem.height) continue;
            mctx.beginPath();
            mctx.arc(x, y, rad, 0, Math.PI * 2);
            mctx.fill();
        }
    }
}

/**
 * Composite the fog over the world.
 *
 * Order matters and is the whole design:
 *   1. fill the darkest level everywhere
 *   2. lift it to the EXPLORED level where the memory says so (three-layer)
 *   3. lift it away entirely where the LIGHT reaches (both)
 *   4. lift it around the ship, so a narrow beam cannot hide its own holder
 *   5. one blit to the main canvas
 */
export function renderFogLayer(
    r: RenderSystem, ctx: CanvasRenderingContext2D, width: number, height: number,
    playerPos?: Vector2, camera?: CameraState,
): void {
    const cfg = getFog();
    const dark = fogEffectiveDark(r);
    // Every early return ZEROES the timer.  Leaving the last live value in
    // it makes `off` report the cost of the last frame that drew, which is
    // exactly the reading someone would use to decide whether the fog is
    // affordable.
    const light = r._lightCanvas;
    const fw = r._lightW, fh = r._lightH;
    if (dark <= 0 || !playerPos || !camera || light === null
        || fw <= 0 || fh <= 0 || !ensureCanvases(r, fw, fh)) {
        r.lastFogMs = 0;
        r._fogActive = false;
        return;
    }
    const t0 = performance.now();

    const fctx = r._fogCtx!;
    const k = r._lightScale;                 // light-layer px per CSS px
    const zoom = camera.zoom;
    const shake = camera.shakeOffset;
    const shakeX = shake ? shake.x : 0, shakeY = shake ? shake.y : 0;

    // ── The MASK: the light, boosted until it can actually clear the fog ──
    //
    // The light's alpha peaks at PLAYER_LIGHT_PEAK (a third), and the
    // brightness cycle scales it — so used raw the fog would never lift by
    // more than a third, and turning the light down would black the screen
    // out.  Each additive redraw DOUBLES the alpha, so a couple of them
    // saturate the lit core while leaving the falloff a falloff.
    const mctx = r._fogMaskCtx!;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.globalCompositeOperation = 'source-over';
    mctx.globalAlpha = 1;
    mctx.clearRect(0, 0, fw, fh);
    mctx.drawImage(light, 0, 0);
    const peak = Math.max(0.01, PLAYER_LIGHT_PEAK * getLightBrightness());
    let doublings = Math.ceil(Math.log2(FOG.MASK_TARGET / peak));
    if (doublings < 0) doublings = 0;
    if (doublings > FOG.MASK_MAX_DOUBLINGS) doublings = FOG.MASK_MAX_DOUBLINGS;
    mctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < doublings; i++) mctx.drawImage(r._fogMaskCanvas!, 0, 0);
    mctx.globalCompositeOperation = 'source-over';

    // ── 1. The darkest level ─────────────────────────────────────────────
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.globalCompositeOperation = 'source-over';
    fctx.globalAlpha = 1;
    fctx.clearRect(0, 0, fw, fh);
    fctx.fillStyle = `rgba(${FOG.COLOR}, ${dark})`;
    fctx.fillRect(0, 0, fw, fh);

    // ── 2. EXPLORED ──────────────────────────────────────────────────────
    //
    // RECORDING is unconditional above `off` — the minimap reads the memory
    // at every rung (see the header).  SPENDING it on the world fog is what
    // the three-layer rung buys.
    const tier = getActiveLightingTier();
    stampMemory(r, playerPos.x, playerPos.y, tier.maxRadius * FOG.MEMORY_FRAC);
    if (cfg.memory && r._fogMem !== null) {
        // The memory is world space; draw the whole map through the camera,
        // at each wrap offset, and let the canvas clip.  Nine scaled blits of
        // a 125x125 texture is cheaper than working out which are visible.
        const mem = r._fogMem;
        const mapW = MAP_WIDTH * zoom * k, mapH = MAP_HEIGHT * zoom * k;
        const baseX = (width / 2 + (0 - camera.position.x + shakeX) * zoom) * k;
        const baseY = (height / 2 + (0 - camera.position.y + shakeY) * zoom) * k;
        // Knock the fog down from `dark` to `explored` — a fraction of what
        // is there, so the two levels compose rather than replacing.
        fctx.globalCompositeOperation = 'destination-out';
        fctx.globalAlpha = (dark - Math.min(cfg.explored, dark)) / dark;
        const prevSmooth = fctx.imageSmoothingEnabled;
        fctx.imageSmoothingEnabled = true;   // the remembered edge is soft
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const dx = baseX + ox * mapW, dy = baseY + oy * mapH;
                if (dx + mapW < 0 || dx > fw || dy + mapH < 0 || dy > fh) continue;
                // Source rect stops at the tile PERIOD, not the canvas
                // width: the padding column past it was never stamped.
                fctx.drawImage(mem, 0, 0, fogMemoryPeriodX(), fogMemoryPeriodY(),
                               dx, dy, mapW, mapH);
            }
        }
        fctx.imageSmoothingEnabled = prevSmooth;
    }

    // ── 3. The LIGHT opens it ────────────────────────────────────────────
    fctx.globalCompositeOperation = 'destination-out';
    fctx.globalAlpha = 1;
    fctx.drawImage(r._fogMaskCanvas!, 0, 0);

    // ── 4. The ship's own bubble ─────────────────────────────────────────
    //
    // A narrow beam points AWAY from the ship, so without this the hull sits
    // in the dark it is lighting — the one place the player is guaranteed to
    // be looking.
    const scx = (width / 2 + (shiftX(camera.position.x, playerPos.x)
                 - camera.position.x + shakeX) * zoom) * k;
    const scy = (height / 2 + (shiftY(camera.position.y, playerPos.y)
                 - camera.position.y + shakeY) * zoom) * k;
    const selfR = FOG.SELF_RADIUS * zoom * k;
    if (selfR > 0.5) {
        const g = fctx.createRadialGradient(scx, scy, selfR * (1 - FOG.SELF_FEATHER),
                                            scx, scy, selfR);
        g.addColorStop(0, 'rgba(0, 0, 0, 1)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        fctx.fillStyle = g;
        fctx.fillRect(scx - selfR, scy - selfR, selfR * 2, selfR * 2);
    }
    fctx.globalCompositeOperation = 'source-over';
    fctx.globalAlpha = 1;

    // ── 5. ONE blit, like the light layer's ──────────────────────────────
    const prevSmoothing = ctx.imageSmoothingEnabled;
    const prevAlpha = ctx.globalAlpha;
    ctx.imageSmoothingEnabled = true;
    // EXPLICIT state, not inherited.  This runs deep in a long draw and the
    // fog is the one pass whose whole job is its alpha — inheriting a
    // globalAlpha someone else left behind is a silent, partial fog.
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(r._fogCanvas!, 0, 0, fw, fh, 0, 0, width, height);
    ctx.globalAlpha = prevAlpha;
    ctx.imageSmoothingEnabled = prevSmoothing;

    r.lastFogMs = performance.now() - t0;
    r._fogActive = true;
    void effectiveDpr;   // dimensions come from the light layer, which used it
}
