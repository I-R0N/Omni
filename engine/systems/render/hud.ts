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
import { GameEntity, EntityType, CameraState, MapType, DamageText, PlayerHUDMessage, WaveAnnouncement, WeaponType, JoystickHUDState, FireButtonHUDState } from '../../../types';
import {
    COLORS, MINIMAP_CONSTANTS, UI_CONSTANTS, WAVE_ANNOUNCE_CONSTANTS,
    LOADOUT_HUD_CONSTANTS, computeLoadoutHUDLayout, WEAPONS, SPRITE_CONSTANTS,
    STATION_CONSTANTS, PORTAL_CONSTANTS, BOSS_CONSTANTS, DRAGON_CONSTANTS,
    BUBBLE_CONSTANTS, SNITCH_CONSTANTS, CHARGE_CONSTANTS, effectiveDpr, BOSS_DEFS,
    INPUT_CONSTANTS, getActiveMinimapMaterial, detectionAlpha,
    computeMinimapRect, computeIndicatorRect,
    FOG,
    SCANNER,
} from '../../../constants';
import { MAP_WIDTH, MAP_HEIGHT, wrapDeltaX, wrapDeltaY } from '../../toroidal';
import { shiftX, shiftY, roundRectPath } from './drawUtils';
import { fogMemoryPeriodX, fogMemoryPeriodY, fogEffectiveDark } from './fog';

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

    // Rebaking the terrain layer means the flow field was rebaked too — drop
    // the streamline cache so it retraces against the new obstacles.
    r._minimapFlowCache = null;

    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        // Stage 5 fix: only static tiles render via the minimap
        // STRUCTURE pass.  Mobile shards (STRUCTURE+finite mass) are
        // not pinned to grid cells.
        if (!e.active || e.type !== EntityType.STRUCTURE || e.mass !== Infinity) continue;
        // NEBULA IS OFF THE MINIMAP ENTIRELY (user directive, decision #43).
        // It is a soft, drifting, low-contrast cloud that the map rendered as
        // hard 2px dots — the densest thing on the map standing in for the
        // vaguest thing in the world.  Nebula shards were already excluded
        // from the dynamic buffer; this is the other half.
        if (e.shardVariant === 'nebula-tile') continue;
        cx.fillStyle = e.color;
        // Map space: entity position is absolute.  Map center = (0,0).
        const dotX = center + e.position.x * scale;
        const dotY = center + e.position.y * scale;
        cx.fillRect(dotX, dotY, 2, 2);
    }

    r._minimapStaticCanvas = c;
}

export function renderDamageTexts(ctx: CanvasRenderingContext2D, texts: DamageText[], camera: CameraState) {
    ctx.font = `bold ${UI_CONSTANTS.HUD.TEXT.LOUD}px monospace`;
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
  targets: { entity: GameEntity, distSq: number, onScreen: boolean, detect: number }[], 
  camera: CameraState, 
  width: number, 
  height: number
) {
    const playerPos = camera.position;
    if (!Number.isFinite(playerPos.x) || !Number.isFinite(playerPos.y)) return;

    const {
        TEXT_THRESHOLD_POI, MAX_VISIBLE, MAX_VISIBLE_ENEMY,
        MAX_VISIBLE_BUBBLE,
        SIZE_NEAR, SIZE_FAR, NEAR_DIST, FAR_DIST, BOSS_SCALE, AGGRO_BLINK_HZ,
        COLORS,
    } = UI_CONSTANTS.INDICATORS;
    // Every arrow on this pass was put there by a SCAN (rework): the buffer
    // is gated on the detection stamp upstream, and `item.detect` is how
    // fresh that stamp is.  A mark going soft is what tells the player the
    // contact has had time to move — see `detectionAlpha`, pure and published
    // on __omniHud because it exists only as a globalAlpha here.
    const H = UI_CONSTANTS.HUD;

    if (targets.length === 0) return;

    const cx = width / 2;
    const cy = height / 2;
    // The inset viewport rect the arrows ride.  ASYMMETRIC (user call): the
    // top and bottom edges clear the HUD bands, because a symmetric rect put
    // every near-vertical bearing — directly ahead, directly behind — under
    // the chip stack or behind the loadout strip.  See computeIndicatorRect.
    const rect = computeIndicatorRect(width, height, r.bossBarActive);
    // The RAY still starts at screen centre (that is where the ship is, and
    // the bearing has to be from the ship).  Only the anchor is clamped, for
    // the degenerate case of a rect that does not contain the centre.
    const ax = Math.min(Math.max(cx, rect.left + 1), rect.right - 1);
    const ay = Math.min(Math.max(cy, rect.top + 1), rect.bottom - 1);
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
        //
        // PORTALS USED TO BE EXEMPT, and are no longer (decision #46b,
        // gauntlet step 5 G6).  The exemption meant that approaching a rift
        // gave you the rift ON SCREEN, its own world-space destination tag,
        // AND an edge arrow naming the same destination a second time — the
        // arrow at its least useful, at the moment it was loudest.  The
        // range gate stays, so a portal still does not put a permanent arrow
        // on the edge from across the map; between those two rules the arrow
        // now covers exactly the case it is good for — the rift is close
        // enough to matter but not yet visible.  Long-range discovery is the
        // minimap's job, which G5 just made materially better at it.
        if (r.chevronsOffscreenOnly && item.onScreen) continue;

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
        // viewport rect (whichever side it leaves first wins).  The rect is
        // asymmetric about the anchor now, so each axis takes the distance to
        // the side the ray is actually heading for rather than a half-extent.
        const ca = Math.cos(angle), sa = Math.sin(angle);
        const tX = ca > 0 ? (rect.right - ax) / ca : ca < 0 ? (rect.left - ax) / ca : Infinity;
        const tY = sa > 0 ? (rect.bottom - ay) / sa : sa < 0 ? (rect.top - ay) / sa : Infinity;
        const tEdge = Math.max(0, Math.min(tX, tY));
        const ix = ax + ca * tEdge;
        const iy = ay + sa * tEdge;

        // SIZE carries distance: near contacts grow, far ones shrink to a
        // small tick.  This is what replaces the per-enemy distance number.
        const f = Math.max(0, Math.min(1, (dist - NEAR_DIST) / (FAR_DIST - NEAR_DIST)));
        let size = SIZE_NEAR + (SIZE_FAR - SIZE_NEAR) * f;
        if (isBoss) size *= BOSS_SCALE;

        ctx.save();
        // Far enemies fade toward an alpha floor — still findable, but a
        // distant straggler doesn't shout like a closing threat.  A boss
        // never fades: it is the thing you are supposed to be flying toward.
        if (t.type === EntityType.ENEMY && !isBoss) {
            ctx.globalAlpha = item.detect;
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
        // little "1234m" strings was most of the old clutter.  Other POIs
        // keep the far-only distance readout.
        //
        // PORTALS NO LONGER PRINT A DISTANCE (G6).  They were the wordiest
        // contact on the screen — name AND number, while an enemy prints
        // nothing — and the number was the redundant half: a portal arrow
        // only appears inside INDICATOR_RANGE now, and the size ramp already
        // says how far through that range you are.  The NAME stays, because
        // an unlabelled arrow is ambiguous the moment a second rift is on
        // the same edge, which on the hub is the normal case.
        const portalName = isPortal ? (t.name ?? '')
            : isBoss ? (t.enemySubtype ? (BOSS_DEFS[t.enemySubtype]?.name ?? 'BOSS') : 'BOSS') : '';
        const showDist = t.type !== EntityType.ENEMY && !isPortal
            && item.distSq > TEXT_THRESHOLD_POI;

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
             const lineStep = iy > (rect.top + rect.bottom) * 0.5 ? -11 : 11;
             if (portalName) {
                 // Arrows at similar bearings crowd the same stretch of edge,
                 // so labels are outlined to stay readable when they overlap.
                 const label = portalName.toUpperCase();
                 ctx.font = `bold ${H.TEXT.MICRO}px monospace`;
                 ctx.lineWidth = H.OUTLINE_WIDTH;
                 ctx.strokeStyle = H.OUTLINE;
                 ctx.strokeText(label, lx, ly);
                 ctx.fillStyle = color;
                 ctx.fillText(label, lx, ly);
                 ly += lineStep;
             }
             if (showDist) {
                 ctx.font = `${H.TEXT.MICRO}px monospace`;
                 ctx.lineWidth = H.OUTLINE_WIDTH;
                 ctx.strokeStyle = H.OUTLINE;
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
    const fontSize = UI_CONSTANTS.HUD.TEXT.BODY;

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
/**
 * The floating touch joystick (Pair C, c2 second half).
 *
 * Deliberately quiet: a thin ring where the thumb landed, a filled knob
 * where it is now, and a line between them.  It is drawn UNDER nothing and
 * over the world, at the very end of the HUD pass, because it sits under an
 * actual thumb — anything more elaborate is hidden by the hand holding it.
 *
 * `state` is null whenever there is no live touch session, which is the
 * normal case on mouse and pad, so nothing ghosts onto a device with no
 * thumb.  Alpha rides `fade` so a release dissolves rather than snaps.
 */
export function renderJoystick(
    ctx: CanvasRenderingContext2D,
    state: JoystickHUDState,
) {
    const J = INPUT_CONSTANTS.JOYSTICK;
    const a = Math.max(0, Math.min(1, state.fade));
    if (a <= 0) return;

    ctx.save();
    ctx.lineCap = 'round';

    // Outer ring — the throttle boundary.
    ctx.globalAlpha = a * J.RING_ALPHA;
    ctx.strokeStyle = J.COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(state.originX, state.originY, J.RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    // Stem from origin to knob: the only part that reads as a DIRECTION,
    // and the reason the widget is legible at a glance under a thumb.
    const dx = state.knobX - state.originX;
    const dy = state.knobY - state.originY;
    if (dx !== 0 || dy !== 0) {
        ctx.globalAlpha = a * J.RING_ALPHA * 1.4;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(state.originX, state.originY);
        ctx.lineTo(state.knobX, state.knobY);
        ctx.stroke();
    }

    // Knob.
    ctx.globalAlpha = a * J.KNOB_ALPHA;
    ctx.fillStyle = J.COLOR;
    ctx.beginPath();
    ctx.arc(state.knobX, state.knobY, J.KNOB_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = a * (J.KNOB_ALPHA + 0.25);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = J.COLOR;
    ctx.stroke();

    ctx.restore();
}

/**
 * The onscreen FIRE button — the joystick scheme's shooting control (G9).
 *
 * Unlike the joystick it is drawn from the first frame, because a control
 * that only appears once pressed cannot be found, and in this scheme it is
 * the only way to shoot.  The ring around it doubles as the CHARGE readout,
 * filling over the same window as the ring on the ship, so the two agree.
 */
export function renderFireButton(
    ctx: CanvasRenderingContext2D,
    state: FireButtonHUDState,
) {
    const B = INPUT_CONSTANTS.FIRE_BUTTON;
    ctx.save();

    // Body.
    ctx.globalAlpha = state.pressed ? B.PRESSED_ALPHA : B.IDLE_ALPHA;
    ctx.fillStyle = B.COLOR;
    ctx.beginPath();
    ctx.arc(state.x, state.y, state.radius, 0, Math.PI * 2);
    ctx.fill();

    // Rim.
    ctx.globalAlpha = state.pressed ? 0.9 : 0.5;
    ctx.strokeStyle = B.COLOR;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Charge arc — starts at 12 o'clock and sweeps clockwise, same
    // direction as the ship's ring.
    if (state.charge > 0) {
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = state.charge >= 1
            ? UI_CONSTANTS.HUD.CHARGE_FULL : UI_CONSTANTS.HUD.CHARGE_PART;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(state.x, state.y, state.radius + 4, -Math.PI / 2,
                -Math.PI / 2 + Math.PI * 2 * state.charge);
        ctx.stroke();
    }

    ctx.restore();
}

export function renderLoadoutHUD(
    ctx: CanvasRenderingContext2D,
    player: GameEntity,
    width: number,
    height: number
) {
    const { SLOT_H, SLOT_RADIUS: RADIUS } = LOADOUT_HUD_CONSTANTS;
    const H = UI_CONSTANTS.HUD;
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
            ctx.strokeStyle = H.RULE_COLOR;
            ctx.lineWidth   = 1;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            roundRectPath(ctx, x, y, slotW, SLOT_H, RADIUS);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.font        = `bold ${H.TEXT.MICRO}px monospace`;
            ctx.fillStyle   = H.DIM_COLOR;
            ctx.fillText('EMPTY', x + slotW / 2, y + SLOT_H / 2);
            continue;
        }

        const wCfg   = WEAPONS[wType];
        const active = wType === activeWeapon;

        // The FILL is the transparent half of the widget (user call: HUD
        // elements read through to the world).  The stroke, pip and label
        // below stay at full strength — a slot is legible because its MARKS
        // are opaque, not because its panel is.
        ctx.globalAlpha = active ? 0.62 : 0.32;
        ctx.fillStyle   = active ? wCfg.color : H.PANEL_FILL;
        ctx.beginPath();
        roundRectPath(ctx, x, y, slotW, SLOT_H, RADIUS);
        ctx.fill();

        ctx.globalAlpha = active ? 1.0 : 0.45;
        ctx.strokeStyle = active ? wCfg.color : H.RULE_COLOR;
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
        ctx.font        = `bold ${H.TEXT.MICRO}px monospace`;
        ctx.globalAlpha = 0.55;
        ctx.fillStyle   = active ? '#ffffff' : H.DIM_COLOR;
        ctx.fillText(String(i + 1), x + 8, y + 11);

        // Full weapon name (slots are wide enough post-1b)
        ctx.font        = `bold ${Math.max(H.TEXT.MICRO, Math.min(H.TEXT.ROW, slotW * 0.115))}px monospace`;
        ctx.globalAlpha = active ? 1.0 : 0.65;
        ctx.fillStyle   = active ? '#ffffff' : H.MUTED_COLOR;
        ctx.fillText(wCfg.name.toUpperCase(), x + slotW / 2, y + SLOT_H - 16);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
}

/**
 * The minimap's MATERIAL layer: streamlines through the asteroid flow field
 * (decision #43, gauntlet step 5 G5).
 *
 * Replaces the per-shard dot spray.  A dot per shard answers "where is every
 * rock", which at a few thousand shards is a uniform grey wash on a 75 px
 * square; the field answers "which way is the material going", which is the
 * only useful thing a map that small can say about material it cannot draw
 * individually.
 *
 * Two things make it cheap enough to run inside a per-frame draw:
 *
 *  1. **The geometry is cached in WORLD space** and rebuilt only when the
 *     seed lattice actually changes — that is, when the camera crosses a
 *     lattice cell, when the zoom changes, or on map load.  Panning within a
 *     cell reuses the last trace; the per-frame cost is a transform and a
 *     `lineTo` per point.
 *  2. **The lattice spacing scales with the shown range**, so the same 49
 *     lines are traced whether the map is showing 1 000 units or 8 000.  A
 *     fixed world spacing would either be invisible zoomed out or thousands
 *     of lines zoomed in.
 *
 * Seeds are snapped to world multiples of the spacing, which is what makes
 * the pattern world-ANCHORED: it slides under the moving window instead of
 * being painted on the glass, and only the SET of visible lines changes (at
 * cell boundaries) rather than every line's position.
 */
function renderMinimapFlow(
    r: RenderSystem,
    ctx: CanvasRenderingContext2D,
    camera: CameraState,
    centerX: number,
    centerY: number,
    scale: number,
    range: number,
) {
    const F = MINIMAP_CONSTANTS.FLOW;
    const flow = r.flowFieldForMinimap();
    if (!flow) return;

    const spacing = range / F.SEEDS_PER_HALF;
    const side = F.SEEDS_PER_HALF * 2 + 1;
    const lines = side * side;
    const pts = F.STEPS + 1;

    // Lattice origin: the seed cell the camera is standing in.  Integer cell
    // indices are what the cache is keyed on — panning inside one cell must
    // not retrace anything.
    const cellX = Math.floor(camera.position.x / spacing);
    const cellY = Math.floor(camera.position.y / spacing);

    let cache = r._minimapFlowCache;
    const need = lines * pts * 2;
    if (!cache || cache.data.length !== need) {
        cache = r._minimapFlowCache = { data: new Float64Array(need), cellX: NaN, cellY: NaN, spacing: 0 };
    }

    if (cache.cellX !== cellX || cache.cellY !== cellY || cache.spacing !== spacing) {
        cache.cellX = cellX;
        cache.cellY = cellY;
        cache.spacing = spacing;
        const step = spacing * F.STEP_FRAC;
        let w = 0;
        for (let iy = 0; iy < side; iy++) {
            for (let ix = 0; ix < side; ix++) {
                let px = (cellX + ix - F.SEEDS_PER_HALF) * spacing;
                let py = (cellY + iy - F.SEEDS_PER_HALF) * spacing;
                cache.data[w++] = px;
                cache.data[w++] = py;
                for (let k = 0; k < F.STEPS; k++) {
                    // The sampler returns a shared scratch vector — consume it
                    // before the next call (FlowFieldGrid's contract).
                    const v = flow.sampleShardFlow(px, py);
                    px += v.x * step;
                    py += v.y * step;
                    cache.data[w++] = px;
                    cache.data[w++] = py;
                }
            }
        }
    }

    // Draw.  World → minimap goes through the TORUS delta, not a raw
    // subtraction: a streamline seeded just across the wrap seam is a few
    // hundred units away, not a map-width away.
    const data = cache.data;
    const camX = camera.position.x;
    const camY = camera.position.y;
    const nowSec = performance.now() / 1000;

    // A segment longer than this in screen px cannot be real: the step length
    // is fixed, so an apparent jump means the two ends resolved to opposite
    // sides of the WRAP SEAM.  Drawn naively that is a chord straight across
    // the minimap — which is exactly what the first version did, and it read
    // as a pair of hard straight lines cutting through the field.  Break the
    // path there instead.
    const stepPx = spacing * F.STEP_FRAC * scale;
    const seamBreak = Math.max(4, stepPx * 3);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = F.COLOR;

    // Pass 1 — the quiet lines.
    ctx.globalAlpha = F.ALPHA;
    ctx.lineWidth = F.WIDTH;
    ctx.beginPath();
    for (let l = 0; l < lines; l++) {
        const base = l * pts * 2;
        const x0 = centerX + wrapDeltaX(camX, data[base]) * scale;
        const y0 = centerY + wrapDeltaY(camY, data[base + 1]) * scale;
        const xN = centerX + wrapDeltaX(camX, data[base + (pts - 1) * 2]) * scale;
        const yN = centerY + wrapDeltaY(camY, data[base + (pts - 1) * 2 + 1]) * scale;
        // A dead-calm cell traces a smudge; drop it rather than draw noise.
        if (Math.abs(xN - x0) + Math.abs(yN - y0) < F.MIN_PX) continue;
        let px = x0;
        let py = y0;
        ctx.moveTo(px, py);
        for (let k = 1; k < pts; k++) {
            const x = centerX + wrapDeltaX(camX, data[base + k * 2]) * scale;
            const y = centerY + wrapDeltaY(camY, data[base + k * 2 + 1]) * scale;
            if (Math.abs(x - px) > seamBreak || Math.abs(y - py) > seamBreak) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            px = x;
            py = y;
        }
    }
    ctx.stroke();

    // Pass 2 — a bright segment travelling downstream along each line.  This
    // is what makes the layer say which WAY the material is going; a static
    // hatch would only say "there is a current here".  The phase is offset per
    // line so the field shimmers rather than blinking in lockstep.
    ctx.globalAlpha = F.PULSE_ALPHA;
    ctx.lineWidth = F.PULSE_WIDTH;
    ctx.beginPath();
    for (let l = 0; l < lines; l++) {
        const base = l * pts * 2;
        const phase = (nowSec * F.PULSE_HZ + (l % 7) / 7 + (l % 3) / 3) % 1;
        const k = Math.min(pts - 2, Math.floor(phase * (pts - 1)));
        const ax = centerX + wrapDeltaX(camX, data[base + k * 2]) * scale;
        const ay = centerY + wrapDeltaY(camY, data[base + k * 2 + 1]) * scale;
        const bx = centerX + wrapDeltaX(camX, data[base + (k + 1) * 2]) * scale;
        const by = centerY + wrapDeltaY(camY, data[base + (k + 1) * 2 + 1]) * scale;
        if (Math.abs(bx - ax) + Math.abs(by - ay) < 0.5) continue;
        if (Math.abs(bx - ax) > seamBreak || Math.abs(by - ay) > seamBreak) continue;
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
    }
    ctx.stroke();

    ctx.restore();
}

/** Blit a window of a TOROIDAL source texture, splitting it into up to four
 *  draws where the window straddles the tile seam.
 *
 *  Two callers with the same problem and, until now, one copy each: the
 *  pre-rendered terrain layer and the fog veil both sample a camera-centred
 *  window out of a texture that repeats with the map.  `perX`/`perY` are the
 *  repeat PERIOD in source pixels, which is not always the canvas size — the
 *  fog memory is a rounded-up canvas holding a fractional period.
 *
 *  `sx`/`sy` are the window's top-left in source pixels, pre-modulo. */
function wrapBlit(
    ctx: CanvasRenderingContext2D, src: CanvasImageSource,
    sx: number, sy: number, sw: number, sh: number,
    perX: number, perY: number,
    dx: number, dy: number, dw: number, dh: number,
) {
    const sxMod = ((sx % perX) + perX) % perX;
    const syMod = ((sy % perY) + perY) % perY;
    const kx = dw / sw, ky = dh / sh;
    const sw1 = Math.min(sw, perX - sxMod);
    const sh1 = Math.min(sh, perY - syMod);
    const sw2 = sw - sw1;
    const sh2 = sh - sh1;
    ctx.drawImage(src, sxMod, syMod, sw1, sh1, dx, dy, sw1 * kx, sh1 * ky);
    if (sw2 > 0) ctx.drawImage(src, 0, syMod, sw2, sh1,
        dx + sw1 * kx, dy, sw2 * kx, sh1 * ky);
    if (sh2 > 0) ctx.drawImage(src, sxMod, 0, sw1, sh2,
        dx, dy + sh1 * ky, sw1 * kx, sh2 * ky);
    if (sw2 > 0 && sh2 > 0) ctx.drawImage(src, 0, 0, sw2, sh2,
        dx + sw1 * kx, dy + sh1 * ky, sw2 * kx, sh2 * ky);
}

/** Veil the minimap's TERRAIN where the ship has never been (user directive).
 *
 *  It runs at EVERY fog rung above `off`, including the two-layer ones whose
 *  world fog is stateless — the map is a record of where you have been, and
 *  that is exactly what the memory holds, so gating it on the three-layer
 *  rung would have made the map contradict the fog beside it.
 *
 *  TERRAIN ONLY.  It is drawn after the static layer and the flow field and
 *  BEFORE the contacts, so enemies, the boss, portals, stations and the
 *  snitch still read through it.  Those are live sensor contacts, not map
 *  knowledge: wave enemies spawn on an offscreen ring, and a minimap that
 *  hid them until you had flown there would not be a fog of war, it would be
 *  a broken threat display.
 *
 *  Cut with the MEMORY, never with the light: the lit region moves every
 *  frame, and a minimap that lit and unlit itself at walking pace would
 *  strobe.  The world fog is the live layer; the map is the remembered one.
 */
function renderMinimapFog(
    r: RenderSystem, ctx: CanvasRenderingContext2D, camera: CameraState,
    mapX: number, mapY: number, size: number, range: number,
) {
    // `_fogActive`, not `getFog()` alone: the fog is composed from the light
    // layer and does not draw under legacy lighting, and nothing stamps the
    // memory on a frame it skipped.  Fogging the map off a memory nobody is
    // writing blacks the whole thing out.
    const mem = r._fogMem;
    if (!r._fogActive || mem === null) return;
    // The EFFECTIVE dark — the fog cycle or the A7 depth ambient, whichever
    // is darker — so the map darkens with the descent the way the world does.
    const dark = fogEffectiveDark(r);
    if (dark <= 0) return;
    if (typeof document === 'undefined') return;

    if (r._minimapFogCanvas === null) {
        r._minimapFogCanvas = document.createElement('canvas');
        r._minimapFogCtx = r._minimapFogCanvas.getContext('2d');
        if (r._minimapFogCtx === null) { r._minimapFogCanvas = null; return; }
    }
    const vc = r._minimapFogCanvas, vctx = r._minimapFogCtx!;
    const res = Math.max(1, Math.round(size));
    if (vc.width !== res || vc.height !== res) { vc.width = res; vc.height = res; }

    // Veil first, then ERASE what is remembered — the memory is white where
    // explored, so one `destination-out` is the whole mask.
    vctx.setTransform(1, 0, 0, 1, 0, 0);
    vctx.globalCompositeOperation = 'source-over';
    vctx.globalAlpha = 1;
    vctx.clearRect(0, 0, res, res);
    // The SAME colour and the SAME darkness the world fog is using, so the
    // two rungs read as one setting rather than as two.
    vctx.fillStyle = `rgba(${FOG.COLOR}, ${dark})`;
    vctx.fillRect(0, 0, res, res);

    const cell = FOG.CELL;
    const half = range / cell;
    vctx.globalCompositeOperation = 'destination-out';
    vctx.imageSmoothingEnabled = true;    // the remembered edge is soft
    wrapBlit(vctx, mem,
        camera.position.x / cell - half, camera.position.y / cell - half,
        half * 2, half * 2,
        fogMemoryPeriodX(), fogMemoryPeriodY(),
        0, 0, res, res);
    vctx.globalCompositeOperation = 'source-over';

    ctx.drawImage(vc, mapX, mapY, size, size);
}

export function renderMinimap(
    r: RenderSystem,
    ctx: CanvasRenderingContext2D,
    items: { entity: GameEntity, dx: number, dy: number, detect: number }[],
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
    // ONE definition of this rect, shared with the fire-event handler, the
    // joystick exclusion zone and the wave banner (5d U3, finding E2).
    const { x: mapX, y: mapY, size: currentSize } = computeMinimapRect(screenHeight, expanded);

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
    // NO SCANNER, NO GROUND (rework, user call).  Without a scanner aboard the
    // minimap is blank but for the two always-charted landmarks — the terrain
    // layer is a sensor readout like everything else on this widget, not a
    // free map of the arena.  ANY scanner turns it on whole: the ping's own
    // radius reveals CONTACTS, and masking the pre-rendered terrain bitmap to
    // a scanned bubble is a different (and much larger) feature.
    const staticCanvas = r.scannerMk > 0 ? r._minimapStaticCanvas : null;
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
        // The terrain layer's period IS its canvas size — it was baked to
        // cover exactly one wrap unit (see buildMinimapStaticLayer).
        wrapBlit(ctx, staticCanvas, sxRaw, syRaw, sw, sh, sRes, sRes,
                 mapX, mapY, currentSize, currentSize);
    }

    // ── Material layer (decision #43, G5) ──────────────────────────────
    // 'flow' traces the asteroid field; 'dots' is the old per-shard spray
    // (handled in the entity loop below); 'off' draws neither.  Drawn after
    // the terrain blit and before the contacts, so it reads as a property of
    // the terrain rather than as another thing to look at.
    // The DBG cycle picks WHICH material layer; the scan's material bubble
    // decides whether it is drawn at all.  See RenderSystem.minimapShardDots
    // — the dots half of this same answer, which the buffer fill reads.
    const materialMode = r.materialRevealAlpha > 0 ? getActiveMinimapMaterial() : 'off';
    // Hoisted: ONE lookup for the whole pass, not one per contact — the
    // buffer can hold a few thousand mobile shards in dots mode.
    const shardDots = r.minimapShardDots;
    if (materialMode === 'flow') {
        renderMinimapFlow(r, ctx, camera, centerX, centerY, scale, range);
    }

    // ── The FOG's memory, over the terrain and under the contacts ────────
    renderMinimapFog(r, ctx, camera, mapX, mapY, currentSize, range);

    // ── The live scan ping ────────────────────────────────────────────────
    // The SAME event the world pass draws, at minimap scale, so the two
    // readouts obviously show one scan rather than two effects that happen to
    // look alike.  Drawn under the contacts: the ring is the instrument, the
    // marks it turns up are the information.
    if (r.scanPingRadius > 0 && r.scanPingMax > 0) {
        const pr = r.scanPingRadius * scale;
        const frac = r.scanPingRadius / r.scanPingMax;
        ctx.globalAlpha = SCANNER.RING_ALPHA
            * (SCANNER.RING_MIN_ALPHA_FRAC + (1 - SCANNER.RING_MIN_ALPHA_FRAC) * (1 - frac));
        ctx.strokeStyle = SCANNER.RING_COLOR;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(centerX, centerY, pr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
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
            // FAITHFULNESS (G5): contacts wear the INDICATOR LEGEND's colour,
            // not `entity.color`.  §8 already fixed that legend for the arrows
            // — red enemy, purple bubble, yellow rival, and a boss in the
            // shared enemy red with its RING doing the distinguishing.  The
            // minimap is the same kind of abstracted contact readout, so it
            // has to speak the same language: a contact that is red on the
            // edge of the screen and teal on the map is two contacts as far
            // as the player is concerned.
            const ic = UI_CONSTANTS.INDICATORS.COLORS;
            const contactColor = entity.enemyShape === 'bubble' ? ic.BUBBLE
                               : entity.isRival === true ? ic.RIVAL
                               : ic.ENEMY;
            ctx.fillStyle = contactColor;
            ctx.beginPath();
            ctx.arc(centerX + ex, centerY + ey, bb ? bb.RADIUS : blip.RADIUS, 0, Math.PI * 2);
            ctx.fill();
            if (bb) {
                ctx.globalAlpha = (clamped ? alpha * mult : alpha) * bb.RING_ALPHA;
                ctx.strokeStyle = contactColor;
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

        // ── Mobile material (shards) ──────────────────────────────────
        // Only in 'dots' mode.  The default is the flow layer above: a dot
        // per shard is a few thousand identical marks that average out to a
        // grey wash, and it answers a question ("where is that rock") the
        // player never asks of a 75px map.
        if (entity.type === EntityType.STRUCTURE) {
            // A Scanner Mk I (A4) draws the dots on top of whatever the cycle
            // is doing.  ONE definition of the answer, shared with the buffer
            // fill in RenderSystem — see RenderSystem.minimapShardDots.
            if (!shardDots) continue;
            ctx.globalAlpha = 1;
            ctx.fillStyle = entity.color;
            ctx.beginPath();
            ctx.arc(dotX, dotY, 1.5, 0, Math.PI * 2);
            ctx.fill();
            continue;
        }

        // ── The remaining POIs: stations and the snitch ───────────────
        // FAITHFULNESS (G5): every contact wears the identity it has
        // everywhere else, so the map reads with the same vocabulary as the
        // world and the indicator arrows.
        //   · STATION — indigo SQUARE.  Square because it is built, fixed and
        //     safe: the one contact that is not alive and not a threat, and
        //     the only rectilinear thing on a map of dots and diamonds.  The
        //     colour is the indicator legend's, not `entity.color`, which is
        //     the hull tint and differs per station variant.
        //   · SNITCH — its own gold, and a dot, because it is a moving thing
        //     like an enemy but not a threat.
        // Portals and bosses are handled above; drops stay excluded entirely
        // (CLAUDE.md §8) and never reach this buffer.
        if (entity.isStation === true) {
            const s = MINIMAP_CONSTANTS.STATION_BLIP;
            ctx.globalAlpha = 1;
            ctx.fillStyle = UI_CONSTANTS.INDICATORS.COLORS.STATION;
            ctx.fillRect(dotX - s.HALF, dotY - s.HALF, s.HALF * 2, s.HALF * 2);
            ctx.strokeStyle = `rgba(255,255,255,${s.OUTLINE_ALPHA})`;
            ctx.lineWidth = s.OUTLINE_WIDTH;
            ctx.strokeRect(dotX - s.HALF, dotY - s.HALF, s.HALF * 2, s.HALF * 2);
            continue;
        }

        ctx.globalAlpha = 1;
        ctx.fillStyle = entity.isSnitch === true ? SNITCH_CONSTANTS.CORE_COLOR : entity.color;
        ctx.beginPath();
        ctx.arc(dotX, dotY, entity.type === EntityType.INTERACTABLE ? 3 : 1.5, 0, Math.PI * 2);
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

/**
 * The wave banner.
 *
 * `minimapExpanded` is a PARAMETER rather than an assumption (5d U3, audit
 * finding E1).  The banner sits above the minimap, and it used to reserve
 * `MINIMAP_CONSTANTS.SIZE` — the 75px COLLAPSED height — unconditionally, so
 * with the map open (280px) the banner drew inside it.  It now asks
 * `computeMinimapRect` for the rect actually on screen, which is the same
 * call the renderer, the tap handler and the joystick exclusion make.
 */
export function renderWaveAnnouncements(
    ctx: CanvasRenderingContext2D,
    announcements: WaveAnnouncement[],
    width: number,
    height: number,
    minimapExpanded: boolean = false,
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

        // Sit clear of the minimap that is ACTUALLY on screen, plus a
        // comfortable gap.  Clamped so a very short window (landscape phone,
        // where an expanded minimap is most of the height) keeps the banner on
        // screen rather than pushing it off the top.
        const mm = computeMinimapRect(height, minimapExpanded);
        const baseY = Math.max(
            WAVE_ANNOUNCE_CONSTANTS.TEXT_PX * 0.9,
            mm.y - 30,
        );

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
            ctx.fillStyle = UI_CONSTANTS.HUD.ACCENT_COLOR;
            ctx.fillText(a.subtext, width / 2, baseY);
        }

        ctx.restore();
    }
}
