/** PROJECTILE SHAPES — the four shot silhouettes: the lightning bolt's
 *  crackling tendrils, the bouncer's head dot, the charged Blaster's
 *  red/orange fireball, and the standard radial-gradient glow every other
 *  weapon (player and enemy alike) renders with.
 *
 *  Extracted verbatim from `RenderSystem.renderEntities`' PROJECTILE arm.
 *  It takes the renderer for exactly one reason: the two GRADIENT CACHES.
 *  Both are unit-radius gradients built once and mapped to a shot's size
 *  with `ctx.scale`, so they persist between frames and belong to the
 *  renderer, not to this module — see CLAUDE.md §8's mutate-don't-allocate
 *  rule, and the same reason `effects.ts` holds the renderer for its trail
 *  scratch buffers.
 *
 *  NAMING: the renderer parameter is `rs`, not the `r` the other `render/`
 *  modules use, because the moved body already binds `r` as the shot's
 *  radius and renaming it would break the verbatim move.
 *
 *  Local space has the origin at the shot's centroid with its rotation
 *  already applied by the per-entity `setTransform` at the top of the
 *  renderer's slow path.
 */
import type { RenderSystem } from '../RenderSystem';
import { GameEntity, EntityType } from '../../../types';
import { hexToRgb } from './drawUtils';

/** The PROJECTILE arm of `renderEntities`' entity-type branch.  `nowSec` is
 *  the frame's shared wall clock — the tendril sweep and both glow pulses
 *  are render-side animation off it. */
export function drawProjectileShape(
    rs: RenderSystem,
    ctx: CanvasRenderingContext2D,
    entity: GameEntity,
    nowSec: number,
): void {
    const r = entity.size.x / 2;
    if (Number.isFinite(r) && r > 0) {
       // Fade out in the last 20% of lifetime
       const lifetimeFrac = (entity.lifetime !== undefined && entity.maxLifetime !== undefined && entity.maxLifetime > 0)
           ? Math.min(1, entity.lifetime / (entity.maxLifetime * 0.2))
           : 1;

       if (entity.isLightningProjectile) {
           // ── Lightning projectile: electric crackling effect ──
           ctx.save();
           ctx.globalAlpha = Math.min(1, lifetimeFrac);
           ctx.globalCompositeOperation = 'lighter';

           // Outer white glow
           const elecR = r * 3.5;
           const elecGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, elecR);
           elecGrad.addColorStop(0,   'rgba(255, 255, 255, 1.0)');
           elecGrad.addColorStop(0.15, 'rgba(255, 255, 255, 0.6)');
           elecGrad.addColorStop(0.4,  'rgba(255, 255, 255, 0.15)');
           elecGrad.addColorStop(1,    'rgba(255, 255, 255, 0)');
           ctx.fillStyle = elecGrad;
           ctx.beginPath();
           ctx.arc(0, 0, elecR, 0, Math.PI * 2);
           ctx.fill();

           // Cyan electric tendrils around the projectile
           ctx.strokeStyle = 'rgba(34, 211, 238, 0.8)';
           ctx.lineWidth = 1.5;
           const tendrilCount = 4;
           for (let ti = 0; ti < tendrilCount; ti++) {
               const tAngle = (nowSec * 20 + ti * (Math.PI * 2 / tendrilCount)) % (Math.PI * 2);
               const tLen = r * (1.5 + Math.sin(nowSec * 30 + ti * 7) * 1.0);
               const mx = Math.cos(tAngle) * tLen * 0.5 + (Math.random() - 0.5) * r;
               const my = Math.sin(tAngle) * tLen * 0.5 + (Math.random() - 0.5) * r;
               ctx.beginPath();
               ctx.moveTo(0, 0);
               ctx.lineTo(mx, my);
               ctx.lineTo(Math.cos(tAngle) * tLen, Math.sin(tAngle) * tLen);
               ctx.stroke();
           }

           // Bright white core
           ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
           ctx.beginPath();
           ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
           ctx.fill();

           ctx.globalCompositeOperation = 'source-over';
           ctx.restore();
       } else if (entity.isBouncer) {
           // ── Bouncer projectile: the beam body is drawn entirely by
           // the fast-fading trail in renderTrails. All we draw here
           // is a small green head dot so the beam has a visible tip
           // even before the trail accumulates its first couple of
           // points (first 1–2 frames after spawn).
           ctx.save();
           ctx.globalAlpha = Math.min(1, lifetimeFrac);
           ctx.fillStyle = '#22c55e';
           ctx.beginPath();
           ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
           ctx.fill();
           ctx.restore();
       } else if (entity.isCharged) {
           // ── Charged Blaster: red+orange fireball ──
           // Larger glow with explicit two-tone red+orange ring
           // around a hot white core.  Only charged Blaster sets
           // isCharged today; other charged variants render with
           // the standard weapon-colour gradient below.
           const pulse = 0.88 + Math.sin(nowSec * 18 + r * 1.3) * 0.12;
           const glowR = r * pulse * 3.2;

           ctx.save();
           ctx.globalAlpha = Math.min(1, lifetimeFrac);

           // Unit-radius gradient (colour stops at relative radii) built
           // once; ctx.scale(glowR) maps it to this shot's glow size with
           // identical pixels — no per-frame gradient rebuild.
           let grad = rs._chargedGlow;
           if (!grad) {
               grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
               grad.addColorStop(0,    'rgba(255, 255, 235, 1)');    // hot white core
               grad.addColorStop(0.10, 'rgba(255, 220, 100, 1)');    // pale yellow inner
               grad.addColorStop(0.25, 'rgba(251, 146,  60, 1)');    // orange (orange-400)
               grad.addColorStop(0.45, 'rgba(239,  68,  68, 0.85)'); // red (red-500)
               grad.addColorStop(0.75, 'rgba(220,  38,  38, 0.25)'); // deep red glow
               grad.addColorStop(1,    'rgba(220,  38,  38, 0)');
               rs._chargedGlow = grad;
           }

           ctx.scale(glowR, glowR);
           ctx.beginPath();
           ctx.arc(0, 0, 1, 0, Math.PI * 2);
           ctx.fillStyle = grad;
           ctx.fill();

           ctx.restore();
       } else {
           // ── Standard projectile: radial gradient glow ──
           // Both player and enemy shots render with their OWN weapon
           // colour now (the enemy branch used to hard-code orange,
           // which hid every per-archetype colour + the corrosion
           // green).  Enemy shots keep a warmer core; the `glow` hint
           // (Tank / Orbiter / Sniper) widens the bloom so heavy and
           // status shots read at a glance.
           const isEnemy = entity.ownerType === EntityType.ENEMY;
           const glowMult = entity.glow ? 4.2 : 3.0;
           const pulse = 0.88 + Math.sin(nowSec * 14 + r * 1.3) * 0.12;
           const glowR = r * pulse * glowMult;

           const col = entity.color || (isEnemy ? '#f97316' : '#facc15');

           // Single merged gradient: hot core → weapon colour → transparent
           // glow.  Built ONCE per owner+colour as a unit-radius gradient
           // (stops at relative radii) and reused across every shot of that
           // colour; ctx.scale(glowR) below maps it to this shot's size with
           // identical pixels — no per-projectile per-frame rebuild / string
           // parse / hexToRgb alloc.
           const key = (isEnemy ? 'E' : 'P') + col;
           let grad = rs._projGlowCache.get(key);
           if (!grad) {
               const [cr, cg, cb] = hexToRgb(col);
               grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
               if (isEnemy) {
                   // Warm-white core so the shot still reads as hostile,
                   // then the archetype's own colour out to the rim.
                   grad.addColorStop(0,    'rgba(255, 255, 235, 1)');
                   grad.addColorStop(0.14, `rgba(${cr}, ${cg}, ${cb}, 1)`);
                   grad.addColorStop(0.34, `rgba(${cr}, ${cg}, ${cb}, 0.55)`);
                   grad.addColorStop(0.60, `rgba(${cr}, ${cg}, ${cb}, 0.16)`);
                   grad.addColorStop(1,    `rgba(${cr}, ${cg}, ${cb}, 0)`);
               } else {
                   grad.addColorStop(0,    'rgba(255, 255, 255, 1)');
                   grad.addColorStop(0.12, `rgba(${cr}, ${cg}, ${cb}, 1)`);
                   grad.addColorStop(0.30, `rgba(${cr}, ${cg}, ${cb}, 0.55)`);
                   grad.addColorStop(0.55, `rgba(${cr}, ${cg}, ${cb}, 0.15)`);
                   grad.addColorStop(1,    `rgba(${cr}, ${cg}, ${cb}, 0)`);
               }
               rs._projGlowCache.set(key, grad);
           }

           ctx.save();
           ctx.globalAlpha = Math.min(1, lifetimeFrac);
           ctx.scale(glowR, glowR);
           ctx.beginPath();
           ctx.arc(0, 0, 1, 0, Math.PI * 2);
           ctx.fillStyle = grad;
           ctx.fill();

           ctx.restore();
       }
    }
}
