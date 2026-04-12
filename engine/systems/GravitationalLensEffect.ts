
import { GRAVITATIONAL_LENS_CONSTANTS as C } from '../../constants';

/**
 * Screen-space gravitational lensing distortion applied to the background
 * when the player is thrusting. Uses a tile-grid displacement approach:
 *
 * 1. Snapshot the circular region around the player from the rendered background
 * 2. Clear that region (fill black)
 * 3. Re-draw each tile from the snapshot at a radially-displaced source position,
 *    simulating light bending around a gravitational well
 * 4. Overlay a subtle Einstein ring glow at the peak-displacement radius
 *
 * The displacement follows a softened gravitational lens profile:
 *   d(r) = peakDisplacement * 2 * softening * r / (r^2 + softening^2)
 * which peaks at r = softening and falls off as 1/r for large r.
 *
 * Performance: ~600 small drawImage calls from an offscreen canvas per frame
 * at default settings (RADIUS=160, TILE_SIZE=10). Entirely skipped when
 * the player is not thrusting (smoothedThrust < threshold).
 */
export class GravitationalLensEffect {
    private offscreen: HTMLCanvasElement;
    private offCtx: CanvasRenderingContext2D;
    private smoothedThrust: number = 0;
    private lastTime: number = 0;

    constructor() {
        this.offscreen = document.createElement('canvas');
        this.offCtx = this.offscreen.getContext('2d')!;
    }

    /**
     * Apply the gravitational lens distortion to the current canvas content.
     * Call this AFTER the background has been rendered and BEFORE the camera
     * transform is applied for world-space entities.
     *
     * @param ctx        Main canvas rendering context
     * @param thrust     Raw player thrust intensity 0..1
     * @param dpr        Device pixel ratio (window.devicePixelRatio)
     * @param width      Canvas CSS width (ctx.canvas.width / dpr)
     * @param height     Canvas CSS height (ctx.canvas.height / dpr)
     */
    public render(
        ctx: CanvasRenderingContext2D,
        thrust: number,
        dpr: number,
        width: number,
        height: number
    ): void {
        // --- Frame-rate-independent thrust smoothing ---
        const now = performance.now() * 0.001; // seconds
        const dt = this.lastTime > 0 ? Math.min(now - this.lastTime, 0.1) : 0.016;
        this.lastTime = now;

        const rate = thrust > this.smoothedThrust ? C.ONSET_SPEED : C.DECAY_SPEED;
        this.smoothedThrust += (thrust - this.smoothedThrust) * Math.min(1, rate * dt);

        if (this.smoothedThrust < C.MIN_THRESHOLD) {
            this.smoothedThrust = 0;
            return;
        }

        const t = this.smoothedThrust; // effective thrust 0..1
        const cx = width / 2;          // lens center (CSS px) — player is at screen center
        const cy = height / 2;

        // Scale effect parameters by thrust
        const radius = C.RADIUS * (0.6 + t * 0.4);
        const peakDisp = C.PEAK_DISPLACEMENT * t;
        const soft = C.SOFTENING;
        const softSq = soft * soft;
        const tile = C.TILE_SIZE;

        // Extra padding on the snapshot to accommodate displacement sampling
        const pad = peakDisp + tile;

        // Ensure offscreen canvas is large enough (only reallocates when growing)
        const regionCSS = radius * 2 + pad * 2;
        const regionPX = Math.ceil(regionCSS * dpr);
        if (this.offscreen.width < regionPX || this.offscreen.height < regionPX) {
            this.offscreen.width = regionPX;
            this.offscreen.height = regionPX;
        }

        // --- Step 1: Snapshot the lens region from the main canvas ---
        // Source coords are always in actual canvas pixels (unaffected by transform).
        const snapX = Math.max(0, Math.round((cx - radius - pad) * dpr));
        const snapY = Math.max(0, Math.round((cy - radius - pad) * dpr));

        this.offCtx.clearRect(0, 0, regionPX, regionPX);
        this.offCtx.drawImage(
            ctx.canvas,
            snapX, snapY, regionPX, regionPX,
            0, 0, regionPX, regionPX
        );

        // --- Step 2: Clear the circular lens region on the main canvas ---
        // Work in CSS-pixel space using the DPR transform.
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.clip();

        ctx.fillStyle = '#000000';
        ctx.fillRect(cx - radius - 1, cy - radius - 1, radius * 2 + 2, radius * 2 + 2);

        // --- Step 3: Draw displaced tiles from the snapshot ---
        const halfGrid = Math.ceil(radius / tile);
        const radiusSq = radius * radius;
        const tilePX = Math.round(tile * dpr);
        // In the offscreen canvas, the lens center sits at this CSS offset from origin:
        const offCenter = radius + pad;

        for (let row = -halfGrid; row <= halfGrid; row++) {
            for (let col = -halfGrid; col <= halfGrid; col++) {
                // Tile center relative to lens center (CSS)
                const tcx = col * tile + tile * 0.5;
                const tcy = row * tile + tile * 0.5;
                const distSq = tcx * tcx + tcy * tcy;

                if (distSq > radiusSq) continue;

                const dist = Math.sqrt(distSq);

                // Gravitational lens displacement profile:
                //   d(r) = peakDisp * 2*soft*r / (r^2 + soft^2)
                // Peaks at r = soft with value = peakDisp. Falls off as 1/r.
                let dx = 0;
                let dy = 0;
                if (dist > 0.5) {
                    const d = peakDisp * (2 * soft * dist) / (distSq + softSq);
                    dx = (tcx / dist) * d;
                    dy = (tcy / dist) * d;
                }

                // Source tile in offscreen: shift INWARD (negative displacement)
                // because an outward apparent shift means the source is closer to center.
                const srcPXx = Math.round((col * tile + offCenter - dx) * dpr);
                const srcPXy = Math.round((row * tile + offCenter - dy) * dpr);

                // Skip if source tile falls outside the snapshot bounds
                if (srcPXx < 0 || srcPXy < 0 ||
                    srcPXx + tilePX > regionPX || srcPXy + tilePX > regionPX) continue;

                ctx.drawImage(
                    this.offscreen,
                    srcPXx, srcPXy, tilePX, tilePX,
                    cx + col * tile, cy + row * tile, tile, tile
                );
            }
        }

        // --- Step 4: Einstein ring glow overlay ---
        // A bright ring at the softening radius where light converges.
        const ringR = soft;
        const ringW = ringR * 0.6;
        const inner = Math.max(1, ringR - ringW);
        const outer = ringR + ringW;
        const alpha = C.RING_OPACITY * t;

        const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
        grad.addColorStop(0, `rgba(${C.RING_COLOR},0)`);
        grad.addColorStop(0.3, `rgba(${C.RING_COLOR},${(alpha * 0.3).toFixed(3)})`);
        grad.addColorStop(0.5, `rgba(${C.RING_COLOR},${alpha.toFixed(3)})`);
        grad.addColorStop(0.7, `rgba(${C.RING_COLOR},${(alpha * 0.3).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${C.RING_COLOR},0)`);

        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, outer + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        ctx.restore();
    }
}
