/** CHARTED MEMORY — which parts of the map the player has actually met.
 *
 *  The minimap's terrain used to be all-or-nothing: gated on merely OWNING a
 *  scanner, so the map was either blank or complete.  Neither reads as
 *  exploration.  This is the third state — terrain fills in as the player
 *  flies past it, and a scan charts it at range, which is the instrument's
 *  navigational value stated in the one place the player looks.
 *
 *  It is the FOG's `_fogMem` pattern (render/fog.ts) applied to a different
 *  question, and deliberately a SEPARATE surface rather than a shared one:
 *  the fog's memory is about light and is only written while the fog cycle is
 *  on (it ships off), while this must be written always and is also written
 *  by scans, which have nothing to do with light.  Sharing them would tie the
 *  minimap's behaviour to a debug cycle.
 *
 *  Map-cell space, one texel per `CHARTED_CELL` world units, so a 12k map is
 *  250x250 — about 62 KB of alpha, rebuilt (and CLEARED, which is what a
 *  canvas resize does) whenever the map dimensions change.
 */

import { RenderSystem } from '../RenderSystem';
import { MAP_WIDTH, MAP_HEIGHT } from '../../toroidal';
import { CHARTED_CELL } from '../../../constants';

export function chartedPeriodX(): number { return MAP_WIDTH / CHARTED_CELL; }
export function chartedPeriodY(): number { return MAP_HEIGHT / CHARTED_CELL; }

/** Allocate / resize the memory.  Returns false if a 2D context is
 *  unavailable, in which case every caller degrades to "nothing charted"
 *  rather than throwing inside a draw. */
export function ensureCharted(r: RenderSystem): boolean {
    if (typeof document === 'undefined') return false;
    const mw = Math.max(1, Math.ceil(MAP_WIDTH / CHARTED_CELL));
    const mh = Math.max(1, Math.ceil(MAP_HEIGHT / CHARTED_CELL));
    if (r._chartedMem === null) {
        r._chartedMem = document.createElement('canvas');
        r._chartedMemCtx = r._chartedMem.getContext('2d');
        if (r._chartedMemCtx === null) { r._chartedMem = null; return false; }
    }
    if (r._chartedMem.width !== mw || r._chartedMem.height !== mh) {
        // A resize CLEARS the canvas, which is the right behaviour: a memory
        // sized for another map is not this map's memory.
        r._chartedMem.width = mw;
        r._chartedMem.height = mh;
    }
    return true;
}

/** Forget everything.  Called on map load — charting is MAP-scoped, the same
 *  rule destroyed tiles and contact `found` flags already follow. */
export function resetCharted(r: RenderSystem): void {
    const mem = r._chartedMem, ctx = r._chartedMemCtx;
    if (mem === null || ctx === null) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, mem.width, mem.height);
}

/** Chart a disc of world at `(px, py)`.
 *
 *  Drawn at the nine wrap offsets like the fog's memory, so charting across
 *  the seam does not leave a hard edge down the middle of the map. */
export function stampCharted(r: RenderSystem, px: number, py: number, radius: number): void {
    if (radius <= 0) return;
    if (!ensureCharted(r)) return;
    const mem = r._chartedMem!, ctx = r._chartedMemCtx!;
    const cx = px / CHARTED_CELL, cy = py / CHARTED_CELL;
    const rad = Math.max(1, radius / CHARTED_CELL);
    const perX = chartedPeriodX(), perY = chartedPeriodY();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
            const x = cx + ox * perX, y = cy + oy * perY;
            if (x + rad < 0 || x - rad > mem.width) continue;
            if (y + rad < 0 || y - rad > mem.height) continue;
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

/** Is this world point charted?  A per-CONTACT test (materials use it), read
 *  back one pixel at a time — cheap because the callers are already
 *  distance-filtered, and honest because it asks the same surface the
 *  terrain mask draws from, so a shard cannot appear over unmapped ground. */
export function isCharted(r: RenderSystem, x: number, y: number): boolean {
    const mem = r._chartedMem, ctx = r._chartedMemCtx;
    if (mem === null || ctx === null) return false;
    const cx = Math.floor(((x % MAP_WIDTH) + MAP_WIDTH) % MAP_WIDTH / CHARTED_CELL);
    const cy = Math.floor(((y % MAP_HEIGHT) + MAP_HEIGHT) % MAP_HEIGHT / CHARTED_CELL);
    if (cx < 0 || cy < 0 || cx >= mem.width || cy >= mem.height) return false;
    try {
        return ctx.getImageData(cx, cy, 1, 1).data[3] > 0;
    } catch {
        // A tainted or zero-sized surface: fail CLOSED rather than throwing
        // inside the draw loop.
        return false;
    }
}
