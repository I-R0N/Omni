/** DROP + POI SHAPES — the fallback silhouettes for everything that is not a
 *  ship, a tile or a projectile: collectible drops (salvage / health / the
 *  glass debris shard) and the world's proximity-interactable landmarks
 *  (station, map portal, snitch), plus the bare-rect catch-all.
 *
 *  Extracted verbatim from `RenderSystem.renderEntities`'s trailing `else`
 *  arm.  Like `enemyShapes.ts` it takes NEITHER an engine nor a renderer:
 *  the arm read zero renderer state, so all it needs is a context, the
 *  entity, the frame clock and the player's position for the glass shard's
 *  proximity tint.
 *
 *  Local space has the origin at the entity's centroid with the entity's
 *  rotation already baked in by the per-entity `setTransform` at the top of
 *  the renderer's slow path — so these draw around (0, 0) and a branch that
 *  wants screen-upright text (the station / portal labels) undoes the
 *  rotation itself.
 */
import { GameEntity, EntityType, Vector2 } from '../../../types';
import { STATION_CONSTANTS, portalHorizonRadius } from '../../../constants';
import { wrapDeltaX, wrapDeltaY } from '../../toroidal';
import { hexToRgb } from './drawUtils';

/** The `else` arm of `renderEntities`' entity-type branch: drops and POIs.
 *  `nowSec` is the frame's shared wall clock (every pulse / spin here is
 *  render-side animation off it); `playerPos` is optional because the glass
 *  shard's proximity tint is the only reader and falls back to "far away". */
export function drawDropShape(
    ctx: CanvasRenderingContext2D,
    entity: GameEntity,
    nowSec: number,
    playerPos?: Vector2,
): void {
    ctx.fillStyle = entity.color;

    if (entity.type === EntityType.INTERACTABLE && entity.dropType === 'glass') {
        // Glass tile shard — same layered rendering as a full tile, with lifetime fade
        const lt = entity.lifetime ?? Infinity;
        const fadeAlpha = lt < 3.0 ? Math.max(0, lt / 3.0) : 1.0;

        const buildShardPath = () => {
            ctx.beginPath();
            if (entity.polygonPoints && entity.polygonPoints.length > 0) {
                ctx.moveTo(entity.polygonPoints[0].x, entity.polygonPoints[0].y);
                for (let pi = 1; pi < entity.polygonPoints.length; pi++) {
                    ctx.lineTo(entity.polygonPoints[pi].x, entity.polygonPoints[pi].y);
                }
            } else {
                ctx.arc(0, 0, entity.size.x / 2, 0, Math.PI * 2);
            }
            ctx.closePath();
        };

        // Proximity tint — same formula as full tile (toroidal).
        // Squared early-out skips the sqrt for tiles outside range.
        const PROX_RANGE = 120;
        const PROX_RANGE_SQ = PROX_RANGE * PROX_RANGE;
        const pdx = playerPos ? wrapDeltaX(playerPos.x, entity.position.x) : Infinity;
        const pdy = playerPos ? wrapDeltaY(playerPos.y, entity.position.y) : Infinity;
        const pdistSq = pdx * pdx + pdy * pdy;
        const prox = pdistSq >= PROX_RANGE_SQ
            ? 0
            : Math.max(0, 1 - Math.sqrt(pdistSq) / PROX_RANGE);
        const edgeR = Math.round(186 - prox * 83);
        const edgeG = Math.round(230 + prox * 2);
        const edgeB = Math.round(253 - prox * 4);
        const edgeAlpha = (0.55 + prox * 0.35) * fadeAlpha;
        const edgeColor = `rgba(${edgeR},${edgeG},${edgeB},${edgeAlpha})`;

        // Layer 1 — translucent base fill
        buildShardPath();
        ctx.globalAlpha = 0.13 * fadeAlpha;
        ctx.fillStyle = 'rgba(186,230,253,1)';
        ctx.fill();

        // Layer 2 — diagonal shine
        ctx.globalAlpha = 0.09 * fadeAlpha;
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // Layer 3 — proximity-tinted edge stroke
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = edgeColor;
        ctx.lineWidth = 1.5;
        buildShardPath();
        ctx.stroke();

    } else if (entity.type === EntityType.INTERACTABLE && entity.dropType) {
        // Drop shard — irregular polygon fragment tumbling in space
        const lt = entity.lifetime ?? Infinity;
        const fadeAlpha = lt < 3.0 ? Math.max(0, lt / 3.0) : 1.0;
        const pulse = 0.82 + Math.sin(nowSec * 6.5) * 0.18;

        // Color palette per drop type
        let coreColor: string;
        let rimColor: string;
        let glowRgb: [number, number, number];
        if (entity.dropType === 'health') {
            // Red circle shard — bright red core, light-red rim + halo.
            coreColor = '#ef4444'; rimColor = '#fecaca';
            glowRgb = [239, 68, 68];
        } else if (entity.dropType === 'salvage') {
            // Silver scrap-glint — steel-grey chunk with a bright
            // white glint rim + cool halo.  Deliberately NOT gold:
            // gold "+N" popups mean score, which no longer pays
            // money; salvage is the money drop.
            coreColor = '#94a3b8'; rimColor = '#f8fafc';
            glowRgb = [203, 213, 225];
        } else {
            // 'powerup' or any other — use entity.color
            coreColor = entity.color; rimColor = entity.color;
            glowRgb = hexToRgb(entity.color);
        }

        // Build shard polygon path
        const buildShardPath = () => {
            ctx.beginPath();
            if (entity.polygonPoints && entity.polygonPoints.length > 0) {
                ctx.moveTo(entity.polygonPoints[0].x, entity.polygonPoints[0].y);
                for (let pi = 1; pi < entity.polygonPoints.length; pi++) {
                    ctx.lineTo(entity.polygonPoints[pi].x, entity.polygonPoints[pi].y);
                }
            } else {
                ctx.arc(0, 0, 7, 0, Math.PI * 2);
            }
            ctx.closePath();
        };

        // Radial glow bloom — drawn first so the shard sits on top
        const glowRadius = (entity.size.x / 2) * 3.5 * pulse;
        const [gr, gg, gb] = glowRgb;
        const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, glowRadius);
        bloom.addColorStop(0,   `rgba(${gr}, ${gg}, ${gb}, ${0.90 * fadeAlpha})`);
        bloom.addColorStop(0.4, `rgba(${gr}, ${gg}, ${gb}, ${0.55 * fadeAlpha})`);
        bloom.addColorStop(1,   `rgba(${gr}, ${gg}, ${gb}, 0)`);
        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = bloom;
        ctx.fill();

        // Outer glow rim
        ctx.globalAlpha = 0.65 * pulse * fadeAlpha;
        ctx.strokeStyle = rimColor;
        ctx.lineWidth = 3;
        buildShardPath();
        ctx.stroke();

        // Solid shard fill
        ctx.globalAlpha = 1.0 * fadeAlpha;
        ctx.fillStyle = coreColor;
        buildShardPath();
        ctx.fill();

        // Sharp edge outline
        ctx.globalAlpha = 0.6 * fadeAlpha;
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1;
        buildShardPath();
        ctx.stroke();

    } else if (entity.type === EntityType.INTERACTABLE && entity.isStation) {
        // ── Space station POI (economy-pivot 1e) ──────────────────
        // Flat-shape language: slow-spinning outer docking ring with
        // pylon nubs, counter-rotating hex core, blinking beacon.
        // All animation is render-side (nowSec) — the entity itself
        // is static, mass-∞ scenery.
        const r = entity.size.x / 2;
        const coreR = r * 0.42;
        const spin = nowSec * 0.15;

        // Dock-available halo: soft pulsing ring at the dock radius
        // while the player is in range (stationDockReady stamped by
        // the engine's proximity check) — the world-space half of
        // the "dock available" affordance.
        if (entity.stationDockReady) {
            const pulse = 0.5 + 0.5 * Math.sin(nowSec * 3.2);
            ctx.globalAlpha = 0.10 + pulse * 0.12;
            ctx.strokeStyle = '#7dd3fc';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, STATION_CONSTANTS.DOCK_RANGE, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Outer docking ring
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = entity.color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        // Pylon nubs riding the ring
        ctx.fillStyle = entity.color;
        for (let i = 0; i < 6; i++) {
            const a = spin + (i / 6) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 6, 0, Math.PI * 2);
            ctx.fill();
        }
        // Spokes core → ring (counter-rotating with the hex core)
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = -spin * 0.6 + (i / 6) * Math.PI * 2;
            ctx.moveTo(Math.cos(a) * coreR, Math.sin(a) * coreR);
            ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.stroke();
        // Hex core hull
        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = -spin * 0.6 + (i / 6) * Math.PI * 2;
            const px = Math.cos(a) * coreR, py = Math.sin(a) * coreR;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = '#0c4a6e';
        ctx.fill();
        ctx.strokeStyle = entity.color;
        ctx.lineWidth = 2;
        ctx.stroke();
        // Blinking beacon heart
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(nowSec * 2.4);
        ctx.fillStyle = '#e0f2fe';
        ctx.beginPath();
        ctx.arc(0, 0, coreR * 0.34, 0, Math.PI * 2);
        ctx.fill();
        // Name label under the ring
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#bae6fd';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(entity.name ?? 'STATION', 0, r + 24);
        ctx.globalAlpha = 1.0;

    } else if (entity.type === EntityType.INTERACTABLE && entity.isPortal) {
        // ── Map portal — A HOLE, AND NOTHING ELSE (user call) ─────
        // The rift used to draw a bloom, three inspiral arms, a broken
        // energy ring, a photon ring, a coloured horizon rim, a receding
        // funnel throat, a white core and an in-range halo.  All of it is
        // gone.  The wormhole is SAID by the star LENS bending the sky
        // around this point (BackgroundManager.renderStars); the drawn
        // ornament was a second, louder voice saying the same thing, and
        // reading it while flying past was what made the rift exhausting.
        //
        // What remains is a black disc, the lens around it, the
        // destination tag below, and the off-screen chevron that leads
        // you here.  No animation at all — no breathe, no spin — so a
        // portal now costs one fill and one string.
        //
        // Its RADIUS is the destination's: `portalHorizonRadius` scales
        // with the span of the map on the other side (and with the DBG
        // Size knob), so a rift to Pocket is a small mouth and one to
        // Deep Space is a wide one.  The same call gives PhysicsSystem
        // the radius at which the well swallows a shard, so matter
        // disappears exactly where the hole is drawn.
        const holeR = portalHorizonRadius(entity);

        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        ctx.arc(0, 0, holeR, 0, Math.PI * 2);
        ctx.fillStyle = '#000000';
        ctx.fill();

        // Destination tag — the portal always says where it goes.  Kept
        // clear of the mouth by the disc's own radius, so it does not
        // creep inward as the horizon shrinks for a smaller destination.
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`\u219d ${(entity.name ?? '').toUpperCase()}`, 0, holeR + 26);
        ctx.globalAlpha = 1.0;

    } else if (entity.type === EntityType.INTERACTABLE && entity.isSnitch) {
        // ── Snitch — golden comet core ────────────────────────────
        // The tail is the gold trail strip + sparkle motes emitted by
        // GameEngine.updateSnitch; this draws the core: wide gold
        // bloom, solid gold body, hot white-gold centre.  Pulse keyed
        // to nowSec so the core flickers like a guttering flame.
        const r = entity.size.x / 2;
        const pulse = 0.85 + Math.sin(nowSec * 11) * 0.15;
        const bloomR = r * 4 * pulse;
        const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, bloomR);
        bloom.addColorStop(0,    'rgba(253, 224, 71, 0.85)');
        bloom.addColorStop(0.35, 'rgba(245, 158, 11, 0.40)');
        bloom.addColorStop(1,    'rgba(245, 158, 11, 0)');
        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        ctx.arc(0, 0, bloomR, 0, Math.PI * 2);
        ctx.fillStyle = bloom;
        ctx.fill();

        ctx.globalAlpha = pulse;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = '#fde047';
        ctx.fill();

        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = '#fffbe6';
        ctx.fill();

    } else if (entity.type === EntityType.INTERACTABLE) {
         const r = entity.size.x / 2;
         if (Number.isFinite(r) && r > 0) {
             ctx.beginPath();
             ctx.arc(0, 0, r, 0, Math.PI * 2);
             ctx.fill();
         }

         ctx.rotate(-entity.rotation);
         ctx.fillStyle = '#ffffff';
         ctx.font = '12px monospace';
         ctx.textAlign = 'center';
         if (entity.name) {
            ctx.fillText(entity.name, 0, (entity.size.x / 2) + 20);
         }
    } else {
         ctx.fillRect(-entity.size.x / 2, -entity.size.y / 2, entity.size.x, entity.size.y);
    }
}
