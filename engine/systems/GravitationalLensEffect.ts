
import { GRAVITATIONAL_LENS_CONSTANTS as C } from '../../constants';

/**
 * Directional gravitational lensing distortion applied to the starfield
 * when the player is thrusting, simulating an Alcubierre-style warp drive.
 *
 * The effect is aligned to the thrust direction:
 *   - Behind the ship: space EXPANDS (stars pushed outward)
 *   - In front:        space CONTRACTS (stars pulled inward)
 *   - At the sides:    no displacement
 *
 * Modulated by  dirFactor = -cos(tileAngle - thrustAngle)
 * which is +1 behind, -1 in front, and 0 at the sides.
 *
 * Edge aliasing is eliminated by drawing displaced tiles with alpha that
 * fades smoothly to 0 near the boundary (standard source-over compositing
 * crossfades with the undistorted background underneath).
 *
 * At default settings (RADIUS=100, TILE_SIZE=16) the effect issues ~150
 * drawImage calls per frame and is entirely skipped at zero thrust.
 */
export class GravitationalLensEffect {
    private offscreen: HTMLCanvasElement;
    private offCtx: CanvasRenderingContext2D;
    private smoothedThrust: number = 0;
    private lastTime: number = 0;
    private lastThrustAngle: number = 0;

    constructor() {
        this.offscreen = document.createElement('canvas');
        this.offCtx = this.offscreen.getContext('2d')!;
    }

    /**
     * @param ctx         Main canvas rendering context
     * @param thrust      Raw player thrust intensity 0..1
     * @param thrustDirX  X component of thrust direction (from inputVector)
     * @param thrustDirY  Y component of thrust direction (from inputVector)
     * @param dpr         Device pixel ratio
     * @param width       Canvas CSS width  (ctx.canvas.width / dpr)
     * @param height      Canvas CSS height (ctx.canvas.height / dpr)
     */
    public render(
        ctx: CanvasRenderingContext2D,
        thrust: number,
        thrustDirX: number,
        thrustDirY: number,
        dpr: number,
        width: number,
        height: number
    ): void {
        // --- Frame-rate-independent thrust smoothing ---
        const now = performance.now() * 0.001;
        const dt = this.lastTime > 0 ? Math.min(now - this.lastTime, 0.1) : 0.016;
        this.lastTime = now;

        const rate = thrust > this.smoothedThrust ? C.ONSET_SPEED : C.DECAY_SPEED;
        this.smoothedThrust += (thrust - this.smoothedThrust) * Math.min(1, rate * dt);

        if (this.smoothedThrust < C.MIN_THRESHOLD) {
            this.smoothedThrust = 0;
            return;
        }

        // Cache the thrust angle while actively thrusting; hold during decay
        if (thrust > 0.01) {
            this.lastThrustAngle = Math.atan2(thrustDirY, thrustDirX);
        }
        const thrustAngle = this.lastThrustAngle;

        const t = this.smoothedThrust;
        const cx = width / 2;
        const cy = height / 2;

        const radius = C.RADIUS * (0.6 + t * 0.4);
        const peakDisp = C.PEAK_DISPLACEMENT * t;
        const soft = C.SOFTENING;
        const softSq = soft * soft;
        const tile = C.TILE_SIZE;
        const fadeWidth = C.EDGE_FADE;

        // Padding on snapshot to prevent out-of-bounds source sampling
        const pad = peakDisp + tile;
        const regionCSS = radius * 2 + pad * 2;
        const regionPX = Math.ceil(regionCSS * dpr);

        if (this.offscreen.width < regionPX || this.offscreen.height < regionPX) {
            this.offscreen.width = regionPX;
            this.offscreen.height = regionPX;
        }

        // --- Step 1: Snapshot the lens region from the rendered background ---
        const snapX = Math.max(0, Math.round((cx - radius - pad) * dpr));
        const snapY = Math.max(0, Math.round((cy - radius - pad) * dpr));

        this.offCtx.clearRect(0, 0, regionPX, regionPX);
        this.offCtx.drawImage(
            ctx.canvas,
            snapX, snapY, regionPX, regionPX,
            0, 0, regionPX, regionPX
        );

        // --- Step 2: Draw displaced tiles over the original background ---
        // No clip/clear — tiles are composited with edge-faded alpha so the
        // undistorted background bleeds through naturally at the boundary.
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const halfGrid = Math.ceil(radius / tile);
        const radiusSq = radius * radius;
        const tilePX = Math.round(tile * dpr);
        const offCenter = radius + pad; // lens center offset in offscreen CSS coords

        for (let row = -halfGrid; row <= halfGrid; row++) {
            for (let col = -halfGrid; col <= halfGrid; col++) {
                // Tile center relative to lens center (CSS px)
                const tcx = col * tile + tile * 0.5;
                const tcy = row * tile + tile * 0.5;
                const distSq = tcx * tcx + tcy * tcy;

                if (distSq > radiusSq) continue;

                const dist = Math.sqrt(distSq);

                // Soft edge fade: 1 at center, 0 at boundary
                const edgeDist = radius - dist;
                const alpha = Math.min(1, edgeDist / fadeWidth);
                if (alpha < 0.01) continue;

                // --- Directional modulation (Alcubierre warp) ---
                // Raw cosine (-1..+1) is raised to FOCUS exponent to narrow the
                // active cone along the thrust axis while preserving sign.
                //   +1 behind the ship  → outward displacement (space expands)
                //   -1 in front          → inward displacement (space contracts)
                //    0 at the sides      → no displacement
                let dx = 0;
                let dy = 0;
                if (dist > 0.5) {
                    const tileAngle = Math.atan2(tcy, tcx);
                    const rawCos = -Math.cos(tileAngle - thrustAngle);
                    const dirFactor = Math.sign(rawCos) * Math.pow(Math.abs(rawCos), C.FOCUS);

                    // Lens profile: peaks at r = soft, falls off as 1/r
                    const d = peakDisp * (2 * soft * dist) / (distSq + softSq) * dirFactor;
                    dx = (tcx / dist) * d;
                    dy = (tcy / dist) * d;
                }

                // Source position in offscreen (inward shift = outward apparent displacement)
                const srcPXx = Math.round((col * tile + offCenter - dx) * dpr);
                const srcPXy = Math.round((row * tile + offCenter - dy) * dpr);

                if (srcPXx < 0 || srcPXy < 0 ||
                    srcPXx + tilePX > regionPX || srcPXy + tilePX > regionPX) continue;

                ctx.globalAlpha = alpha;
                ctx.drawImage(
                    this.offscreen,
                    srcPXx, srcPXy, tilePX, tilePX,
                    cx + col * tile, cy + row * tile, tile, tile
                );
            }
        }

        // --- Step 3: Subtle Einstein ring glow, offset behind the ship ---
        const ringR = soft;
        const ringW = ringR * 0.5;
        const inner = Math.max(1, ringR - ringW);
        const outer = ringR + ringW;
        const ringAlpha = C.RING_OPACITY * t;

        // Shift ring toward the back of the ship (opposite thrust direction)
        const backX = cx + Math.cos(thrustAngle + Math.PI) * soft * 0.3;
        const backY = cy + Math.sin(thrustAngle + Math.PI) * soft * 0.3;

        const grad = ctx.createRadialGradient(backX, backY, inner, backX, backY, outer);
        grad.addColorStop(0, `rgba(${C.RING_COLOR},0)`);
        grad.addColorStop(0.35, `rgba(${C.RING_COLOR},${(ringAlpha * 0.35).toFixed(3)})`);
        grad.addColorStop(0.5, `rgba(${C.RING_COLOR},${ringAlpha.toFixed(3)})`);
        grad.addColorStop(0.65, `rgba(${C.RING_COLOR},${(ringAlpha * 0.35).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${C.RING_COLOR},0)`);

        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(backX, backY, outer + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        ctx.restore();
    }
}
