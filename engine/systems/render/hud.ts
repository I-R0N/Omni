/** The SCREEN-SPACE layer — minimap, off-screen indicators, the loadout
 *  strip, player messages, wave banners, and floating damage text.
 *
 *  Extracted verbatim from `RenderSystem.ts` in gauntlet 5f (see
 *  `docs/GAUNTLET_5F_LOG.md`).  These are the passes that draw in SCREEN
 *  coordinates after the world pass has finished, which is the line the split
 *  follows: `renderHealthBar` stayed behind because it draws above an entity
 *  in world space, HUD-ish though it looks.
 *
 *  Free functions.  Three of them take the `RenderSystem` as their first
 *  parameter, and only because they read state that has to persist between
 *  frames — the pre-rendered minimap static layer and its cached range, and
 *  the DBG `chevronsOffscreenOnly` flag.  `RenderSystem` is imported as a
 *  TYPE, so it is erased at compile time and there is no runtime cycle.
 *
 *  `fitFontPx` lives here because the wave banner is its main caller, but it
 *  is the general rule from CLAUDE.md §8: any canvas string built from
 *  authored or variable content goes through it rather than hardcoding a px
 *  size, because the game is played on a 390px-wide phone and boss names are
 *  not known at design time.
 */
import type { RenderSystem } from '../RenderSystem';
import { GameEntity, EntityType, CameraState, MapType, DamageText, PlayerHUDMessage, WaveAnnouncement, WeaponType } from '../../../types';
import {
    COLORS, MINIMAP_CONSTANTS, UI_CONSTANTS, WAVE_ANNOUNCE_CONSTANTS,
    LOADOUT_HUD_CONSTANTS, computeLoadoutHUDLayout, WEAPONS, SPRITE_CONSTANTS,
    STATION_CONSTANTS, PORTAL_CONSTANTS, BOSS_CONSTANTS, DRAGON_CONSTANTS,
    BUBBLE_CONSTANTS, SNITCH_CONSTANTS, CHARGE_CONSTANTS, effectiveDpr, BOSS_DEFS,
} from '../../../constants';
import { MAP_WIDTH, MAP_HEIGHT, wrapDeltaX, wrapDeltaY } from '../../toroidal';
import { shiftX, shiftY, roundRectPath } from './drawUtils';

/**
 * Pre-render all STRUCTURE entities to an offscreen minimap canvas.
 * Call once on map load.  The canvas covers the full map area at a
 * resolution matched to the expanded minimap display size so the
 * per-frame renderMinimap pass only needs a single drawImage blit
 * instead of ~22k individual fillRect calls.
 */
export function buildMinimapStaticLayer(r: RenderSystem, entities: GameEntity[], mapWidth: number, mapHeight: number) {
    const { EXPANDED_SIZE } = MINIMAP_CONSTANTS;
    // Size the pre-render to cover exactly one wrap unit of the
    // toroidal map.  The per-frame blit (renderMinimap) uses modulo
    // arithmetic against this canvas size, so the canvas extent must
    // equal the map extent — otherwise the modulo wraps at a
    // different boundary than the game's actual wrap seam and the
    // view snaps by the size difference whenever the camera crosses.
    const halfMap = Math.max(mapWidth, mapHeight) / 2;
    const range = halfMap;
    r._minimapStaticRange = range;

    const res = EXPANDED_SIZE;
    const c = document.createElement('canvas');
    c.width = res;
    c.height = res;
    const cx = c.getContext('2d')!;
    const scale = (res / 2) / range;
    const center = res / 2;

    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        // Stage 5 fix: only static tiles render via the minimap
        // STRUCTURE pass.  Mobile shards (STRUCTURE+finite mass) are
        // not pinned to grid cells.
        if (!e.active || e.type !== EntityType.STRUCTURE || e.mass !== Infinity) continue;
        cx.fillStyle = e.color;
        // Map space: entity position is absolute.  Map center = (0,0).
        const dotX = center + e.position.x * scale;
        const dotY = center + e.position.y * scale;
        cx.fillRect(dotX, dotY, 2, 2);
    }

    r._minimapStaticCanvas = c;
}

export function renderDamageTexts(ctx: CanvasRenderingContext2D, texts: DamageText[], camera: CameraState) {
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';

    const camX = camera.position.x;
    const camY = camera.position.y;
    texts.forEach(t => {
        ctx.save();
        // Shift into the camera's wrap zone so damage numbers that pop
        // over an entity near a seam appear where the entity is drawn.
        ctx.translate(shiftX(camX, t.position.x), shiftY(camY, t.position.y));
        
        const lifeRatio = t.lifetime / t.maxLifetime;
        ctx.globalAlpha = Math.max(0, lifeRatio);

        // Grow-as-it-fades animation, scaled by the per-text size tier
        // (points popups bigger by magnitude; damage chips smaller).
        const scale = (1 + (1 - lifeRatio) * 0.5) * (t.fontScale ?? 1);
        ctx.scale(scale, scale);

        ctx.fillStyle = t.color;
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        ctx.strokeText(t.text, 0, 0);
        ctx.fillText(t.text, 0, 0);
        
        ctx.restore();
    });
}

export function renderIndicators(
  r: RenderSystem,
  ctx: CanvasRenderingContext2D, 
  targets: { entity: GameEntity, distSq: number, onScreen: boolean }[], 
  camera: CameraState, 
  width: number, 
  height: number
) {
    const playerPos = camera.position;
    if (!Number.isFinite(playerPos.x) || !Number.isFinite(playerPos.y)) return;

    const {
        EDGE_INSET, TEXT_THRESHOLD_POI, MAX_VISIBLE, MAX_VISIBLE_ENEMY,
        MAX_VISIBLE_BUBBLE, ENEMY_FADE_START, ENEMY_FADE_END, ENEMY_MIN_ALPHA,
        SIZE_NEAR, SIZE_FAR, NEAR_DIST, FAR_DIST, BOSS_SCALE, AGGRO_BLINK_HZ,
        COLORS,
    } = UI_CONSTANTS.INDICATORS;

    if (targets.length === 0) return;

    const cx = width / 2;
    const cy = height / 2;
    // Half-extents of the inset viewport rect the arrows ride.  Clamped so a
    // very small window can't invert the rect.
    const hx = Math.max(8, cx - EDGE_INSET);
    const hy = Math.max(8, cy - EDGE_INSET);
    // One blink phase for the whole frame — every hunting contact pulses in
    // sync, which reads as a single alarm rather than N flickers.
    const blink = 0.55 + 0.45 * Math.sin(performance.now() * 0.001 * AGGRO_BLINK_HZ * Math.PI * 2);

    // Per-type budgets.  The buffer is sorted NEAREST-FIRST, so these keep
    // the closest contacts of each type and drop the far ones.
    let enemiesDrawn = 0;
    let poisDrawn = 0;
    let portalsDrawn = 0;
    let bubblesDrawn = 0;

    for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        const t = item.entity;
        const isPortal = t.isPortal === true;

        // Offscreen-only mode: the player can already see an on-screen
        // entity, so its arrow is redundant clutter — skip it.
        // PORTALS ARE EXEMPT: their arrow is already range-gated to
        // PORTAL_CONSTANTS.INDICATOR_RANGE, and inside that range it is a
        // deliberate, labelled navigation cue that should stay on screen
        // while the player lines up the approach.
        if (r.chevronsOffscreenOnly && item.onScreen && !isPortal) continue;

        const isBoss   = t.isBoss === true;
        const isBubble = t.enemyShape === 'bubble';
        const isRival  = t.isRival === true;

        // ── Type → colour + hostility blink (user-specified legend) ──
        // A rival/bubble is only conditionally hostile, so its type colour
        // says WHAT it is and the red blink says it is coming for you.
        let color: string;
        let hunting = false;
        if (t.type === EntityType.ENEMY) {
            if (isBubble)      { color = COLORS.BUBBLE; hunting = t.provoked === true && t.aggroTargetId === 'player'; }
            else if (isRival)  { color = COLORS.RIVAL;  hunting = t.huntingPlayer === true; }
            else               { color = COLORS.ENEMY; }
        } else if (isPortal)      color = COLORS.PORTAL;
        else if (t.isStation)     color = COLORS.STATION;
        else                      color = COLORS.OTHER;

        if (t.type === EntityType.ENEMY) {
            // A (h) boss capstone never competes for the enemy budget:
            // losing the boss arrow behind a crowd of stragglers is exactly
            // the case the arrow exists for.
            if (isBubble) {
                if (bubblesDrawn >= MAX_VISIBLE_BUBBLE) continue;
                bubblesDrawn++;
            } else if (!isBoss) {
                if (enemiesDrawn >= MAX_VISIBLE_ENEMY) continue;
                enemiesDrawn++;
            }
        } else if (isPortal) {
            // Portals get their OWN budget rather than competing with the
            // stations for MAX_VISIBLE — otherwise on the hub (4 stations) a
            // portal could be starved out of a shared cap.
            if (portalsDrawn >= MAX_VISIBLE) continue;
            portalsDrawn++;
        } else {
            if (poisDrawn >= MAX_VISIBLE) continue;
            poisDrawn++;
        }

        const dx = wrapDeltaX(playerPos.x, t.position.x);
        const dy = wrapDeltaY(playerPos.y, t.position.y);
        const angle = Math.atan2(dy, dx);
        const dist = Math.sqrt(item.distSq);

        // Ride the SCREEN EDGE: intersect the bearing ray with the inset
        // viewport rect (whichever axis it leaves first wins).
        const ca = Math.cos(angle), sa = Math.sin(angle);
        const tEdge = Math.min(
            ca !== 0 ? hx / Math.abs(ca) : Infinity,
            sa !== 0 ? hy / Math.abs(sa) : Infinity,
        );
        const ix = cx + ca * tEdge;
        const iy = cy + sa * tEdge;

        // SIZE carries distance: near contacts grow, far ones shrink to a
        // small tick.  This is what replaces the per-enemy distance number.
        const f = Math.max(0, Math.min(1, (dist - NEAR_DIST) / (FAR_DIST - NEAR_DIST)));
        let size = SIZE_NEAR + (SIZE_FAR - SIZE_NEAR) * f;
        if (isBoss) size *= BOSS_SCALE;

        ctx.save();
        // Far enemies fade toward an alpha floor — still findable, but a
        // distant straggler doesn't shout like a closing threat.  A boss
        // never fades: it is the thing you are supposed to be flying toward.
        if (t.type === EntityType.ENEMY && !isBoss && dist > ENEMY_FADE_START) {
            const ff = Math.min(1, (dist - ENEMY_FADE_START) / (ENEMY_FADE_END - ENEMY_FADE_START));
            ctx.globalAlpha = 1 - ff * (1 - ENEMY_MIN_ALPHA);
        }
        ctx.translate(ix, iy);
        ctx.rotate(angle);

        // A hunting rival/bubble cross-fades toward the alarm red rather
        // than blinking on/off, so it never disappears mid-pulse.
        ctx.fillStyle = hunting && blink > 0.5 ? COLORS.AGGRO : color;
        if (hunting) ctx.globalAlpha *= 0.65 + 0.35 * blink;

        // One glyph for everything: a solid triangular arrowhead with a
        // notched tail.  POIs used to get a different (bigger) pointer —
        // shape now means "contact", colour means "what kind", so the two
        // families no longer have to be told apart by silhouette.
        const w = size * 0.72;
        ctx.beginPath();
        ctx.moveTo( size, 0);              // tip (points at the contact)
        ctx.lineTo(-size * 0.65,  w);
        ctx.lineTo(-size * 0.30,  0);      // inner notch
        ctx.lineTo(-size * 0.65, -w);
        ctx.closePath();
        ctx.fill();
        // Thin dark keyline instead of the old white one: it separates the
        // arrow from bright terrain without washing out the type colour.
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Labels.  A portal always names its DESTINATION (the arrow is how
        // the player picks which rift to fly to) and a boss names itself —
        // both would be ambiguous unlabelled.  Ordinary enemies get NO
        // distance text any more: their size already carries it, and a dozen
        // little "1234m" strings was most of the old clutter.  POIs keep the
        // far-only distance readout.
        const portalName = isPortal ? (t.name ?? '')
            : isBoss ? (t.enemySubtype ? (BOSS_DEFS[t.enemySubtype]?.name ?? 'BOSS') : 'BOSS') : '';
        const showDist = t.type !== EntityType.ENEMY && item.distSq > TEXT_THRESHOLD_POI;

        if (showDist || portalName) {
             ctx.rotate(-angle);
             ctx.textAlign = 'center';
             ctx.textBaseline = 'middle';
             // Anchor the label block INWARD from the arrow (toward screen
             // centre) — at the screen edge a fixed downward offset would run
             // the text off the viewport.  Extra LINES then stack vertically
             // (text stacks vertically, not radially: a near-horizontal
             // bearing would otherwise shove line 2 sideways ON TOP of line 1),
             // away from whichever horizontal edge the arrow is nearest.
             const lx = -ca * (size + 12);
             let ly = -sa * (size + 12);
             const lineStep = iy > cy ? -11 : 11;
             if (portalName) {
                 // Arrows at similar bearings crowd the same stretch of edge,
                 // so labels are outlined to stay readable when they overlap.
                 const label = portalName.toUpperCase();
                 ctx.font = 'bold 9px monospace';
                 ctx.lineWidth = 3;
                 ctx.strokeStyle = 'rgba(0,0,0,0.85)';
                 ctx.strokeText(label, lx, ly);
                 ctx.fillStyle = color;
                 ctx.fillText(label, lx, ly);
                 ly += lineStep;
             }
             if (showDist) {
                 ctx.font = '9px monospace';
                 ctx.lineWidth = 3;
                 ctx.strokeStyle = 'rgba(0,0,0,0.85)';
                 ctx.strokeText(`${Math.round(dist)}m`, lx, ly);
                 ctx.fillStyle = 'rgba(255,255,255,0.75)';
                 ctx.fillText(`${Math.round(dist)}m`, lx, ly);
             }
        }

        ctx.restore();
    }
}

export function renderPlayerMessages(
    ctx: CanvasRenderingContext2D,
    messages: PlayerHUDMessage[],
    width: number,
    height: number
) {
    const cx       = width / 2;
    const baseY    = height / 2 - 48; // above the player sprite
    const lineH    = 20;
    const fontSize = 11;

    ctx.save();
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Newest message is last in array → render at baseY; older messages rise above it
    for (let i = 0; i < messages.length; i++) {
        const msg      = messages[i];
        const lifeRatio = msg.lifetime / msg.maxLifetime;
        // Stay fully opaque for the first 70% of lifetime, then fade in the last 30%
        const alpha    = lifeRatio > 0.3 ? 1 : lifeRatio / 0.3;
        // Index from the end: last item (newest) sits at baseY
        const slot  = messages.length - 1 - i;
        const y     = baseY - slot * lineH;

        ctx.globalAlpha = alpha;
        // Subtle shadow for readability over any background
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillText(msg.text, cx + 1, y + 1);
        ctx.fillStyle = msg.color;
        ctx.fillText(msg.text, cx, y);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
}

/**
 * 2-slot loadout HUD (pivot 1b — replaced the 8-cell ammo strip).  One
 * wide slot per equipped weapon showing its colour pip + full name; the
 * ACTIVE slot fills with the weapon colour.  An empty slot renders as a
 * dim dashed outline.  The charge ring stays on the player ship
 * (chargeProgress) — not drawn here.
 */
export function renderLoadoutHUD(
    ctx: CanvasRenderingContext2D,
    player: GameEntity,
    width: number,
    height: number
) {
    const { SLOT_H, SLOT_RADIUS: RADIUS } = LOADOUT_HUD_CONSTANTS;
    const { startY, slotW, slotXs } = computeLoadoutHUDLayout(width, height);
    const activeWeapon = player.currentWeapon ?? WeaponType.BLASTER;
    const equipped = player.equippedWeapons ?? [WeaponType.BLASTER, null];

    ctx.save();
    ctx.textAlign  = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < slotXs.length; i++) {
        const x = slotXs[i];
        const y = startY;
        const wType = equipped[i] ?? null;

        if (wType === null) {
            // Empty slot — dim dashed placeholder ("fill me at the Drydock").
            ctx.globalAlpha = 0.35;
            ctx.strokeStyle = '#475569';
            ctx.lineWidth   = 1;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            roundRectPath(ctx, x, y, slotW, SLOT_H, RADIUS);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.font        = `bold 9px monospace`;
            ctx.fillStyle   = '#64748b';
            ctx.fillText('EMPTY', x + slotW / 2, y + SLOT_H / 2);
            continue;
        }

        const wCfg   = WEAPONS[wType];
        const active = wType === activeWeapon;

        ctx.globalAlpha = active ? 0.92 : 0.6;
        ctx.fillStyle   = active ? wCfg.color : '#1e293b';
        ctx.beginPath();
        roundRectPath(ctx, x, y, slotW, SLOT_H, RADIUS);
        ctx.fill();

        ctx.globalAlpha = active ? 1.0 : 0.5;
        ctx.strokeStyle = active ? wCfg.color : '#475569';
        ctx.lineWidth   = active ? 2 : 1;
        ctx.beginPath();
        roundRectPath(ctx, x, y, slotW, SLOT_H, RADIUS);
        ctx.stroke();

        // Colour pip + slot number
        ctx.globalAlpha = 1.0;
        ctx.fillStyle   = wCfg.color;
        ctx.beginPath();
        ctx.arc(x + slotW / 2, y + 11, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.font        = `bold 8px monospace`;
        ctx.globalAlpha = 0.55;
        ctx.fillStyle   = active ? '#ffffff' : '#94a3b8';
        ctx.fillText(String(i + 1), x + 8, y + 11);

        // Full weapon name (slots are wide enough post-1b)
        ctx.font        = `bold ${Math.max(9, Math.min(12, slotW * 0.115))}px monospace`;
        ctx.globalAlpha = active ? 1.0 : 0.65;
        ctx.fillStyle   = active ? '#ffffff' : '#cbd5e1';
        ctx.fillText(wCfg.name.toUpperCase(), x + slotW / 2, y + SLOT_H - 16);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
}

export function renderMinimap(
    r: RenderSystem,
    ctx: CanvasRenderingContext2D,
    items: { entity: GameEntity, dx: number, dy: number }[],
    camera: CameraState,
    screenWidth: number,
    screenHeight: number,
    expanded: boolean,
    mapType: MapType
) {
    const {
        SIZE, EXPANDED_SIZE, MARGIN, BG_COLOR, BORDER_COLOR, PLAYER_DOT_COLOR,
        ZOOM_RANGE, RANGE, VIEWPORT_COLOR, VIEWPORT_BORDER_COLOR
    } = MINIMAP_CONSTANTS;

    // Small map uses a zoomed-in range; expanded map shows the full overview range.
    // Cap to the map's half-extent so the expanded view stops at one full wrap —
    // otherwise on a 15 k map the configured 8 k range would show the same tiles
    // twice at the edges, which reads as a duplicated minimap.
    const staticRange = r._minimapStaticRange || Infinity;
    const range = Math.min(expanded ? RANGE : ZOOM_RANGE, staticRange);
    const currentSize = expanded ? EXPANDED_SIZE : SIZE;

    const mapX = MARGIN;
    const mapY = screenHeight - currentSize - LOADOUT_HUD_CONSTANTS.BOTTOM_MARGIN;

    ctx.save();

    ctx.fillStyle = BG_COLOR;
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.rect(mapX, mapY, currentSize, currentSize);
    ctx.fill();
    ctx.stroke();

    ctx.clip();

    const centerX = mapX + currentSize / 2;
    const centerY = mapY + currentSize / 2;
    const scale = (currentSize / 2) / range;

    // ── Static structure layer (pre-rendered on map load) ──────────────
    // Blit the relevant viewport from the offscreen canvas instead of
    // issuing ~22k individual fillRect calls.  The static layer is in
    // map-space (centred on world origin); since the world wraps, the
    // source rect may straddle the canvas edge and we split it into
    // up to four drawImage calls so the minimap seamlessly shows both
    // sides of a seam when the camera is near the edge.
    const staticCanvas = r._minimapStaticCanvas;
    if (staticCanvas) {
        const staticRange = r._minimapStaticRange;
        const sRes = staticCanvas.width;
        const sScale = (sRes / 2) / staticRange;

        // Source rect in canvas pixels; wraps modulo sRes because the
        // static layer represents a toroidal map.
        const srcCenterX = sRes / 2 + camera.position.x * sScale;
        const srcCenterY = sRes / 2 + camera.position.y * sScale;
        const srcHalf = range * sScale;
        const sxRaw = srcCenterX - srcHalf;
        const syRaw = srcCenterY - srcHalf;
        const sw = srcHalf * 2;
        const sh = srcHalf * 2;
        const sxMod = ((sxRaw % sRes) + sRes) % sRes;
        const syMod = ((syRaw % sRes) + sRes) % sRes;
        const dScaleX = currentSize / sw;
        const dScaleY = currentSize / sh;
        const sw1 = Math.min(sw, sRes - sxMod);
        const sh1 = Math.min(sh, sRes - syMod);
        const sw2 = sw - sw1;
        const sh2 = sh - sh1;
        // part 1 (no wrap)
        ctx.drawImage(staticCanvas,
            sxMod, syMod, sw1, sh1,
            mapX, mapY, sw1 * dScaleX, sh1 * dScaleY);
        // part 2 (x-wrap)
        if (sw2 > 0) ctx.drawImage(staticCanvas,
            0, syMod, sw2, sh1,
            mapX + sw1 * dScaleX, mapY, sw2 * dScaleX, sh1 * dScaleY);
        // part 3 (y-wrap)
        if (sh2 > 0) ctx.drawImage(staticCanvas,
            sxMod, 0, sw1, sh2,
            mapX, mapY + sh1 * dScaleY, sw1 * dScaleX, sh2 * dScaleY);
        // part 4 (both-wrap)
        if (sw2 > 0 && sh2 > 0) ctx.drawImage(staticCanvas,
            0, 0, sw2, sh2,
            mapX + sw1 * dScaleX, mapY + sh1 * dScaleY, sw2 * dScaleX, sh2 * dScaleY);
    }

    // ── Dynamic entity dots (enemies, asteroids, drops, etc.) ─────────
    // Enemy blips pulse so they pop against the static layer; the phase
    // uses performance.now() (render-side animation, frame-rate smooth).
    const blip = MINIMAP_CONSTANTS.ENEMY_BLIP;
    const pulseT = 0.5 + 0.5 * Math.sin(performance.now() / 1000 * blip.PULSE_HZ * Math.PI * 2);
    const enemyPulseAlpha = blip.PULSE_MIN_ALPHA + (1 - blip.PULSE_MIN_ALPHA) * pulseT;
    const clampHalf = currentSize / 2 - blip.EDGE_INSET;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const entity = item.entity;
        if (!entity.active) continue;

        if (entity.type === EntityType.ENEMY) {
            // Out-of-range enemies clamp to the minimap border (square
            // clamp, slightly dimmer) instead of vanishing, so a distant
            // straggler still registers at a glance.  A (h) BOSS takes the
            // same clamp but draws as a RINGED target — it is the priority
            // contact on the map and has to be findable on a 75px minimap.
            const bb = entity.isBoss === true ? MINIMAP_CONSTANTS.BOSS_BLIP : null;
            const inset = bb ? bb.EDGE_INSET : blip.EDGE_INSET;
            const half = currentSize / 2 - inset;
            let ex = item.dx * scale;
            let ey = item.dy * scale;
            const extent = Math.max(Math.abs(ex), Math.abs(ey));
            const clamped = extent > half;
            if (clamped) {
                const f = half / extent;
                ex *= f; ey *= f;
            }
            const alpha = bb
                ? (bb.PULSE_MIN_ALPHA + (1 - bb.PULSE_MIN_ALPHA)
                   * (0.5 + 0.5 * Math.sin(performance.now() / 1000 * bb.PULSE_HZ * Math.PI * 2)))
                : enemyPulseAlpha;
            const mult = bb ? bb.CLAMPED_ALPHA_MULT : blip.CLAMPED_ALPHA_MULT;
            ctx.globalAlpha = clamped ? alpha * mult : alpha;
            ctx.fillStyle = entity.color;
            ctx.beginPath();
            ctx.arc(centerX + ex, centerY + ey, bb ? bb.RADIUS : blip.RADIUS, 0, Math.PI * 2);
            ctx.fill();
            if (bb) {
                ctx.globalAlpha = (clamped ? alpha * mult : alpha) * bb.RING_ALPHA;
                ctx.strokeStyle = entity.color;
                ctx.lineWidth = bb.RING_WIDTH;
                ctx.beginPath();
                ctx.arc(centerX + ex, centerY + ey, bb.RING_RADIUS, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            continue;
        }

        if (entity.isPortal === true) {
            // ── Portal anomaly contact ────────────────────────────────
            // The chevron is range-gated now, so the minimap is how a
            // portal gets FOUND.  Two consequences, both handled here:
            // it clamps to the border instead of being culled when it
            // falls outside the minimap range (same trick as enemy
            // blips), and it draws as a spinning diamond with a radar
            // ping expanding out of it so it can't be mistaken for the
            // station dots sharing the map.
            const pb = MINIMAP_CONSTANTS.PORTAL_BLIP;
            let ex = item.dx * scale;
            let ey = item.dy * scale;
            const pExtent = Math.max(Math.abs(ex), Math.abs(ey));
            const pClampHalf = currentSize / 2 - pb.EDGE_INSET;
            const pClamped = pExtent > pClampHalf;
            if (pClamped) {
                const f = pClampHalf / pExtent;
                ex *= f; ey *= f;
            }
            const px = centerX + ex;
            const py = centerY + ey;
            const baseAlpha = pClamped ? pb.CLAMPED_ALPHA_MULT : 1;
            const nowMs = performance.now();
            // Ping phase 0→1; the ring expands and fades over each cycle.
            const ping = (nowMs / 1000 * pb.PULSE_HZ) % 1;

            // Expanding radar ping.
            ctx.globalAlpha = baseAlpha * pb.RING_ALPHA * (1 - ping);
            ctx.strokeStyle = entity.color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(px, py, pb.RING_MIN + (pb.RING_MAX - pb.RING_MIN) * ping, 0, Math.PI * 2);
            ctx.stroke();

            // Slowly-rotating diamond contact — geometric, so it reads
            // as an anomaly against the round dots around it.
            const spin = nowMs / 1000 * pb.SPIN_HZ * Math.PI * 2;
            ctx.globalAlpha = baseAlpha;
            ctx.translate(px, py);
            ctx.rotate(spin);
            ctx.beginPath();
            ctx.moveTo(0, -pb.RADIUS);
            ctx.lineTo(pb.RADIUS, 0);
            ctx.lineTo(0, pb.RADIUS);
            ctx.lineTo(-pb.RADIUS, 0);
            ctx.closePath();
            ctx.fillStyle = entity.color;
            ctx.fill();
            ctx.strokeStyle = `rgba(255,255,255,${pb.OUTLINE_ALPHA})`;
            ctx.lineWidth = pb.OUTLINE_WIDTH;
            ctx.stroke();
            ctx.rotate(-spin);
            ctx.translate(-px, -py);

            // Hot centre pip.
            ctx.beginPath();
            ctx.arc(px, py, pb.CORE_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.globalAlpha = 1;
            continue;
        }

        const dotX = centerX + item.dx * scale;
        const dotY = centerY + item.dy * scale;

        if (dotX < mapX || dotX > mapX + currentSize || dotY < mapY || dotY > mapY + currentSize) continue;

        ctx.fillStyle = entity.color;

        let dotRadius = 1.5;
        if (entity.type === EntityType.INTERACTABLE) dotRadius = 3;

        ctx.beginPath();
        ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
        ctx.fill();
    }

    // When expanded, draw a rectangle showing the area covered by the small zoomed map
    if (expanded) {
        const zoomHalfPx = ZOOM_RANGE * scale;
        const rectX = centerX - zoomHalfPx;
        const rectY = centerY - zoomHalfPx;
        const rectSize = zoomHalfPx * 2;

        ctx.fillStyle = VIEWPORT_COLOR;
        ctx.fillRect(rectX, rectY, rectSize, rectSize);

        ctx.strokeStyle = VIEWPORT_BORDER_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(rectX, rectY, rectSize, rectSize);
    }

    // Player dot drawn on top of everything
    ctx.fillStyle = PLAYER_DOT_COLOR;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

/** Largest font size in [minPx, basePx] at which `text` measures within
 *  `maxWidth`.  Monospace advance width is linear in font size, so ONE
 *  measurement gives the exact ratio — no binary search, no per-frame
 *  measure loop in a draw path. */
export function fitFontPx(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    basePx: number,
    minPx: number,
): number {
    if (!text) return basePx;
    ctx.font = `bold ${basePx}px monospace`;
    const w = ctx.measureText(text).width;
    if (w <= maxWidth || w <= 0) return basePx;
    return Math.max(minPx, Math.floor(basePx * (maxWidth / w)));
}

export function renderWaveAnnouncements(
    ctx: CanvasRenderingContext2D,
    announcements: WaveAnnouncement[],
    width: number,
    height: number
) {
    const { FADEIN, HOLD, FADEOUT } = WAVE_ANNOUNCE_CONSTANTS;
    const totalLife = FADEIN + HOLD + FADEOUT;

    for (let i = 0; i < announcements.length; i++) {
        const a = announcements[i];
        const elapsed = totalLife - a.lifetime;

        // Compute alpha: fade in → hold → fade out
        let alpha: number;
        if (elapsed < FADEIN) {
            alpha = elapsed / FADEIN;
        } else if (elapsed < FADEIN + HOLD) {
            alpha = 1;
        } else {
            alpha = 1 - (elapsed - FADEIN - HOLD) / FADEOUT;
        }
        alpha = Math.max(0, Math.min(1, alpha));
        if (alpha <= 0) continue;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        // Position above the minimap: bottom edge minus minimap area minus comfortable gap
        const baseY = height - MINIMAP_CONSTANTS.MARGIN - MINIMAP_CONSTANTS.SIZE - 30;

        // Banner text is authored content (boss names, reward labels) whose
        // length is not known here, and the game is played on a 390px-wide
        // phone — "WARDEN DESTROYED" at 48px monospace is ~460px and clips
        // off BOTH edges.  So fit each line to the viewport instead of
        // trusting the design size: shrink the font until it measures inside
        // the safe width, floored so it never becomes unreadable.
        const safe = Math.max(80, width - WAVE_ANNOUNCE_CONSTANTS.SIDE_MARGIN * 2);
        const mainPx = fitFontPx(ctx, a.text, safe,
            WAVE_ANNOUNCE_CONSTANTS.TEXT_PX, WAVE_ANNOUNCE_CONSTANTS.TEXT_MIN_PX);

        // Main text
        ctx.font = `bold ${mainPx}px monospace`;
        ctx.fillStyle = a.color;
        ctx.fillText(a.text, width / 2, baseY - (a.subtext ? mainPx * 0.58 : 0));

        // Subtext (smaller, cyan)
        if (a.subtext) {
            const subPx = fitFontPx(ctx, a.subtext, safe,
                WAVE_ANNOUNCE_CONSTANTS.SUBTEXT_PX, WAVE_ANNOUNCE_CONSTANTS.SUBTEXT_MIN_PX);
            ctx.font = `bold ${subPx}px monospace`;
            ctx.fillStyle = '#22d3ee';
            ctx.fillText(a.subtext, width / 2, baseY);
        }

        ctx.restore();
    }
}
