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
import { PORTAL_CONSTANTS, STATION_CONSTANTS } from '../../../constants';
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
        // ── Map portal (roadmap step (k)) ─────────────────────────
        // A persistent rift in the flat-shape language: counter-
        // rotating arc rings around a dark event horizon, with a
        // slow breathing pulse.  All animation is render-side
        // (nowSec) — the entity is static, mass-∞ scenery, and the
        // idle rift costs NO particles (the openPortal burst only
        // fires on an actual transit).
        const r = entity.size.x / 2;
        const breathe = 0.85 + 0.15 * Math.sin(nowSec * 1.6);
        const spin = nowSec * 0.5;

        // Entry-available halo at the use radius, pulsing while the
        // player is in range and this portal won the arbitration —
        // the world-space half of the "press E" affordance (mirrors
        // the station's dock halo).
        if (entity.portalReady) {
            const pulse = 0.5 + 0.5 * Math.sin(nowSec * 3.2);
            ctx.globalAlpha = 0.10 + pulse * 0.12;
            ctx.strokeStyle = entity.color;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, PORTAL_CONSTANTS.USE_RANGE, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Outward bloom — the rift bleeding light into the field.
        const bloomR = r * 2.1 * breathe;
        const [pr, pg, pb] = hexToRgb(entity.color);
        const bloom = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, bloomR);
        bloom.addColorStop(0, `rgba(${pr}, ${pg}, ${pb}, 0.45)`);
        bloom.addColorStop(1, `rgba(${pr}, ${pg}, ${pb}, 0)`);
        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        ctx.arc(0, 0, bloomR, 0, Math.PI * 2);
        ctx.fillStyle = bloom;
        ctx.fill();

        // Inspiral arms — matter streaming into the mouth.  Three
        // logarithmic spirals winding from a faint outer tail down to
        // white-hot at the rim, drawn BEFORE the horizon disc so their
        // inner ends vanish under it: the stream falls in.  A radial-
        // gradient stroke does the tail→mouth fade for free (one
        // gradient, no per-segment alpha).
        const armOuter = r * 1.55;
        const armInner = r * 0.30;
        const armGrad = ctx.createRadialGradient(0, 0, armInner, 0, 0, armOuter);
        armGrad.addColorStop(0, '#ffffff');
        armGrad.addColorStop(0.3, entity.color);
        armGrad.addColorStop(1, `rgba(${pr}, ${pg}, ${pb}, 0)`);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = armGrad;
        ctx.lineWidth = 3;
        const ARMS = 3, ARM_STEPS = 26, ARM_WIND = 3.4;
        for (let a = 0; a < ARMS; a++) {
            ctx.beginPath();
            for (let s = 0; s <= ARM_STEPS; s++) {
                const t = s / ARM_STEPS;                    // 0 tail → 1 mouth
                const rad = armOuter * Math.pow(armInner / armOuter, t);
                const ang = (a / ARMS) * Math.PI * 2 + spin * 2 + t * ARM_WIND;
                const px = Math.cos(ang) * rad, py = Math.sin(ang) * rad;
                if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.stroke();
        }

        // Outer energy ring — broken arcs counter-rotating against the
        // arms, so the vortex reads even when the arms blur at speed.
        ctx.strokeStyle = entity.color;
        ctx.lineWidth = 2.5;
        ctx.globalAlpha = 0.55;
        for (let i = 0; i < 3; i++) {
            const a0 = -spin + (i / 3) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(0, 0, r, a0, a0 + Math.PI * 0.44);
            ctx.stroke();
        }

        // Event horizon — a dark disc so the rift reads as a hole,
        // not a light source.
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
        ctx.fillStyle = '#0b0616';
        ctx.fill();

        // Photon ring — a thin white halo hugging the horizon, the
        // lensing highlight where infalling light piles up.
        ctx.globalAlpha = 0.35 + 0.25 * breathe;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.67, 0, Math.PI * 2);
        ctx.stroke();

        // Rim of the event horizon — a hard bright edge so the hole
        // reads against a busy nebula backdrop.
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = entity.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
        ctx.stroke();

        // Funnel throat — receding broken rings inside the horizon,
        // shrinking toward the centre with deeper rings spinning FASTER
        // (frame dragging), alternating direction ring to ring, dimming
        // and thinning with depth.  This is what turns the flat disc
        // into a tunnel.
        for (let k = 0; k < 4; k++) {
            const depth = (k + 1) / 5;                     // 0.2 .. 0.8
            const ringR = r * 0.62 * Math.pow(1 - depth, 0.85);
            const twist = spin * (1 + depth * 2.5) * (k % 2 === 0 ? 1 : -1);
            ctx.globalAlpha = 0.62 * (1 - depth) + 0.08;
            ctx.strokeStyle = entity.color;
            ctx.lineWidth = 2 - depth;
            for (let i = 0; i < 2; i++) {
                const a0 = twist + i * Math.PI;
                ctx.beginPath();
                ctx.arc(0, 0, ringR, a0, a0 + Math.PI * 0.8);
                ctx.stroke();
            }
        }

        // Hot core — the far end of the throat, breathing.
        ctx.globalAlpha = 0.55 + 0.35 * breathe;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.14 * breathe, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // Destination tag — the portal always says where it goes.
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`↝ ${(entity.name ?? '').toUpperCase()}`, 0, r + 26);
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
