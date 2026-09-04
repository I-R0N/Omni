/** Procedural ENEMY SILHOUETTES — one drawn shape per archetype.
 *
 *  Extracted verbatim from `RenderSystem.ts` in gauntlet 5f (see
 *  `docs/GAUNTLET_5F_LOG.md`).  It was the single cleanest seam in the whole
 *  survey: 847 lines whose only dependency on the rest of the renderer was
 *  each other, so unlike every other 5f extraction these are plain free
 *  functions that take no engine and no renderer — just a context, an entity
 *  and the clock.
 *
 *  Every archetype reads by SILHOUETTE rather than by sprite art.  Local
 *  space has +x along the enemy's nose and the origin at its centroid; the
 *  per-entity transform at the top of the renderer's slow path bakes the
 *  rotation in, so the tail is at -x.  Includes the hit-flash scale-punch and
 *  whiten, the boss aura ring, the engine flame, and the damage-crack
 *  overlay.
 */
import { GameEntity, EntityType } from '../../../types';
import {
    BOSS_CONSTANTS, BOSS_DEFS, BUBBLE_CONSTANTS, DRAGON_CONSTANTS,
    SHIELD_CONSTANTS,
} from '../../../constants';
import { hexToRgb, liftCh, sinkCh, hash01, crackSeedFor, drawDamageCracks,
         ENEMY_CRACK_STYLE } from './drawUtils';

// Per-(enemy colour) cache of the FIXED-factor derived colour strings used
// across drawEnemyShape's body / orb / shape-detail layers.  Enemy colours
// come from a fixed ~6-entry archetype palette, so this Map warms instantly
// and eliminates the ~7-11 rgba/rgb template-string allocations that the
// enemy render path otherwise did per entity PER FRAME (a steady GC source,
// felt as occasional frame dips in busy / death-heavy moments).  Strings
// whose alpha varies per frame (flame flicker, core pulse, telegraph charge,
// hit-flash) are NOT cached here — they stay inline.
interface EnemyPalette {
    bodyLift: string;   // body gradient nose stop  — rgb(lift .45)
    bodySink: string;   // body gradient tail stop  — rgb(sink .45)
    orbRing: string;    // Drone inset ring          — rgba(sink .45, .9)
    pip: string;        // forward sensor pip        — rgba(lift .55, .95)
    detailDk5: string;  // Tank seam/rivets          — rgba(sink .5, .85)
    detailLt5: string;  // Tank prow / Orbiter pip   — rgba(lift .5, .9)
    detailDk4: string;  // diamond/pentagon rings    — rgba(sink .4, .85)
}
const _enemyPalCache = new Map<string, EnemyPalette>();
function enemyPalette(col: string): EnemyPalette {
    let p = _enemyPalCache.get(col);
    if (!p) {
        const [r, g, b] = hexToRgb(col);
        p = {
            bodyLift: `rgb(${liftCh(r,0.45)},${liftCh(g,0.45)},${liftCh(b,0.45)})`,
            bodySink: `rgb(${sinkCh(r,0.45)},${sinkCh(g,0.45)},${sinkCh(b,0.45)})`,
            orbRing: `rgba(${sinkCh(r,0.45)},${sinkCh(g,0.45)},${sinkCh(b,0.45)},0.9)`,
            pip: `rgba(${liftCh(r,0.55)},${liftCh(g,0.55)},${liftCh(b,0.55)},0.95)`,
            detailDk5: `rgba(${sinkCh(r,0.5)},${sinkCh(g,0.5)},${sinkCh(b,0.5)},0.85)`,
            detailLt5: `rgba(${liftCh(r,0.5)},${liftCh(g,0.5)},${liftCh(b,0.5)},0.9)`,
            detailDk4: `rgba(${sinkCh(r,0.4)},${sinkCh(g,0.4)},${sinkCh(b,0.4)},0.85)`,
        };
        _enemyPalCache.set(col, p);
    }
    return p;
}

// Engine-flame palette — a FIXED hot ion/plasma colour so the thrust plume
// reads as exhaust regardless of the enemy's body colour (it used to inherit
// the body colour and wash out).  White-hot core, cool-blue wash.
const FLAME_OUTER = '120, 190, 255'; // ion-blue outer wash
const FLAME_CORE  = '255, 255, 255'; // white-hot core
const FLAME_TIP   = '150, 210, 255'; // cool-blue fade at the tip

// Native enemy rendering — a distinct procedural polygon per archetype
// (entity.enemyShape) so types read by silhouette without sprite art.
// Assumes the canvas transform is already translated to the entity centre
// and rotated to its facing (shapes point along +x).  Includes the
// hit-flash scale-punch + whiten and a shield ring when shielded.
// Local space here has +x pointing along the enemy's nose and the origin
// at its centroid (the per-entity transform at the top of the slow path
// bakes rotation in), so the tail is at -x.
export function drawEnemyShape(ctx: CanvasRenderingContext2D, entity: GameEntity, nowSec: number) {
    const shape = entity.enemyShape ?? 'triangle';
    // ── Boss aura ((h)): a slow breathing ring under the hull in the boss's
    // PHASE colour, so a capstone reads as one at a glance and a phase change
    // is visible IN THE WORLD, not only on the HUD bar.  Two strokes, no
    // gradient allocation — bosses are rare, but the pattern stays cheap.
    if (entity.isBoss === true) {
        const rb = Math.max(entity.size.x, entity.size.y) * 0.5;
        const pulse = 1 + Math.sin(nowSec * 2.2) * 0.05;
        const ra = rb * BOSS_CONSTANTS.AURA_SCALE * pulse;
        ctx.globalAlpha = BOSS_CONSTANTS.AURA_ALPHA;
        ctx.strokeStyle = entity.color || '#f87171';
        ctx.lineWidth = Math.max(2, rb * 0.08);
        ctx.beginPath();
        ctx.arc(0, 0, ra, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = BOSS_CONSTANTS.AURA_ALPHA * 0.45;
        ctx.lineWidth = Math.max(1, rb * 0.04);
        ctx.beginPath();
        ctx.arc(0, 0, ra * 1.14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
    // ── Front-shield plate ((h) trait): a thick arc on the entity's FACING,
    // so WHERE the plate is is legible in the world and "get behind it" is a
    // readable instruction.  Drawn in the entity's local frame (rotation is
    // already baked in), so the plate is centred on +x.  No pool bar — the
    // plate never depletes; only the geometry matters.
    if (entity.frontShield) {
        const rp = Math.max(entity.size.x, entity.size.y) * 0.5;
        const half = (entity.frontShield.deg * Math.PI / 180) / 2;
        const flash = (entity.shieldHitFlash && entity.shieldHitFlash > 0) ? 1 : 0;
        ctx.globalAlpha = 0.34 + flash * 0.45;
        ctx.strokeStyle = flash ? '#ffffff' : '#e9d5ff';
        ctx.lineWidth = Math.max(3, rp * 0.16);
        ctx.beginPath();
        ctx.arc(0, 0, rp * 1.05, -half, half);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
    // ── Lightweight gnat render (Stage 4 perf): a die-on-contact gnat (Swarm)
    // appears in large clouds, so it skips the full ship treatment (flame
    // plume + cached body gradient + core eye + per-frame radial gradients) —
    // just a flat colour-filled silhouette with a tiny bright nose, drawn with
    // ZERO gradient allocations per frame.  Keeps a big flock cheap.
    if (entity.diesOnContact === true) {
        const flashG = (entity.hitFlash && entity.hitFlash > 0) ? entity.hitFlash : 0;
        const rg = Math.max(entity.size.x, entity.size.y) * 0.62 * (1 + Math.min(0.4, flashG * 2.2));
        buildEnemyPath(ctx, shape, rg);
        ctx.fillStyle = flashG > 0 ? '#ffffff' : (entity.color || '#2dd4bf');
        ctx.fill();
        // Tiny bright nose pip so facing reads.
        ctx.beginPath();
        ctx.arc(rg * 0.35, 0, rg * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.7;
        ctx.fill();
        ctx.globalAlpha = 1;
        return;
    }
    // ── Reactive bubble (Stage 5): a translucent wobbling membrane — no
    // engine flame.  A specular highlight + a pulsing nucleus sell the soft
    // body; once provoked the membrane flushes angry-red and wobbles faster.
    if (shape === 'bubble') {
        const flashB = (entity.hitFlash && entity.hitFlash > 0) ? entity.hitFlash : 0;
        // Feed pulse: a brief outward membrane bulge right after a swallow
        // (BUBBLE_CONSTANTS.FEED_PULSE), eased out as the timer decays.
        const feed = (entity.bubbleFeedTimer ?? 0) > 0
            ? (entity.bubbleFeedTimer! / BUBBLE_CONSTANTS.FEED_PULSE) * 0.18 : 0;
        const rb = Math.max(entity.size.x, entity.size.y) * 0.6 * (1 + Math.min(0.4, flashB * 2.2) + feed);
        if (entity.glowPhase === undefined) {
            let h = 0; const id = entity.id;
            for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
            entity.glowPhase = (h / 997) * Math.PI * 2;
        }
        const ph = entity.glowPhase;
        const provoked = entity.provoked === true;
        const sick = (entity.bubbleSickTimer ?? 0) > 0;          // queasy → green
        const latched = entity.attachedToId !== undefined;       // clinging to a hull
        const digesting = (entity.bubbleDigestTimer ?? 0) > 0;   // holding a shard inside
        const baseCol = sick ? BUBBLE_CONSTANTS.SICK_COLOR
                      : provoked ? BUBBLE_CONSTANTS.COLOR_PROVOKED
                      : (entity.color || '#67e8f9');
        const [br, bg, bb] = hexToRgb(baseCol);
        // Brightness / liveliness track AGGRO + sickness — feeding does NOT
        // change the membrane brightness (the held meal reads it instead).
        // Sick = a slow queasy throb; provoked = fast; calm = gentle.
        const wob = sick ? 0.14 : provoked ? 0.16 : 0.10; // membrane wobble amplitude
        const spd = sick ? 3.0 : provoked ? 5.5 : 2.4;    // wobble + pulse speed
        // Calm bubbles render faint (easy to miss); provoked/sick full opacity.
        // A hit-flash adds on top so a shot reads.
        const vis = (provoked || sick) ? 1 : BUBBLE_CONSTANTS.CALM_VISIBILITY;
        // Squash-cling: while latched the membrane flattens against the hull.
        // updateBubbles points rotation at the target, so local +x is the
        // contact normal — flatten x, spread y (the "splatted goo" read).
        const squash = latched ? 0.34 : 0;
        const sxx = 1 - squash, syy = 1 + squash * 0.7;

        // Wobbling membrane outline (12 verts, two-frequency radius noise).
        ctx.beginPath();
        const N = 12;
        for (let i = 0; i < N; i++) {
            const a = (i / N) * Math.PI * 2;
            const rr = rb * (1 + wob * (Math.sin(nowSec * spd + ph + i * 1.7) * 0.6 + Math.sin(nowSec * spd * 0.6 + i) * 0.4));
            const x = Math.cos(a) * rr * sxx, y = Math.sin(a) * rr * syy;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        // Translucent fill: faint core → brighter rim (a soap-film look).
        // Cached across frames — the radius (rb) and the colour/visibility key
        // only change on a hit-flash/feed pulse or a state transition, so an
        // idle drifting bubble reuses the same gradient object every frame.
        if (entity.bubbleFillGradR !== rb || entity.bubbleFillGradCol !== baseCol
            || entity.bubbleFillGradVis !== vis) {
            const grad = ctx.createRadialGradient(0, 0, rb * 0.2, 0, 0, rb);
            grad.addColorStop(0, `rgba(${br},${bg},${bb},${0.10 * vis})`);
            grad.addColorStop(0.7, `rgba(${br},${bg},${bb},${0.22 * vis})`);
            grad.addColorStop(1, `rgba(${br},${bg},${bb},${0.5 * vis})`);
            entity.bubbleFillGrad = grad;
            entity.bubbleFillGradR = rb;
            entity.bubbleFillGradCol = baseCol;
            entity.bubbleFillGradVis = vis;
        }
        ctx.fillStyle = entity.bubbleFillGrad!;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(${br},${bg},${bb},${Math.min(1, 0.6 * vis + flashB)})`;
        ctx.stroke();

        // Held meal (digesting): a shrinking ghost of the swallowed shard in
        // its own colour, sitting INSIDE the transparent membrane — the eat
        // read.  Replaces the idle nucleus while feeding.
        if (digesting) {
            const dp = entity.bubbleDigestTimer! / (entity.bubbleDigestDuration ?? BUBBLE_CONSTANTS.DIGEST_DURATION); // 1 → 0
            const ir = Math.min((entity.bubbleDigestSize0 ?? rb) * 0.5, rb * 0.6) * (0.32 + 0.68 * dp);
            const [dr, dg, dbb] = hexToRgb(entity.bubbleDigestColor || '#a8a29e');
            ctx.beginPath();
            const M = 9;
            for (let i = 0; i < M; i++) {
                const a = (i / M) * Math.PI * 2;
                const rr = ir * (1 + 0.15 * Math.sin(nowSec * 6 + ph + i * 1.3));
                const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fillStyle = `rgba(${dr},${dg},${dbb},${0.25 + 0.6 * dp})`; // fades as it dissolves
            ctx.fill();
        } else {
            // Inner nucleus — a small denser blob that pulses.
            const nuc = rb * (0.30 + 0.05 * Math.sin(nowSec * spd + ph));
            ctx.beginPath();
            ctx.arc(0, 0, nuc, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${br},${bg},${bb},${0.55 * vis})`;
            ctx.fill();
        }
        // Specular highlight (upper-left), brighter on a hit.
        ctx.beginPath();
        ctx.arc(-rb * 0.32, -rb * 0.34, rb * 0.16, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${Math.min(1, 0.5 * vis + flashB)})`;
        ctx.fill();

        // EMP crackle (player latch only): amber zig-zags arcing off the
        // contact face (+x) into the hull, selling the weapon/shield disable.
        if (latched && entity.attachedToId === 'player') {
            ctx.lineWidth = 1.4;
            for (let k = 0; k < 3; k++) {
                ctx.strokeStyle = `rgba(245,158,11,${0.5 + 0.45 * Math.random()})`;
                ctx.beginPath();
                let ax = rb * sxx * 0.7, ay = (Math.random() - 0.5) * rb * 0.8;
                ctx.moveTo(ax, ay);
                for (let s = 0; s < 3; s++) {
                    ax += rb * 0.5 * (0.6 + Math.random() * 0.6);
                    ay += (Math.random() - 0.5) * rb * 0.7;
                    ctx.lineTo(ax, ay);
                }
                ctx.stroke();
            }
        }
        return;
    }

    // ── Dragon head (Stage 6): a forward-pointed scaled head with glowing
    // eyes + swept horns — no engine flame.  Body segments render separately
    // (renderDragonBodies).  Local +x faces travel.
    if (shape === 'dragon') {
        if (entity.dragonHidden) return; // head has crossed the exit portal — gone
        const flashD = (entity.hitFlash && entity.hitFlash > 0) ? entity.hitFlash : 0;
        // Same damage-proportional scale-punch as the ships: the dragon's huge
        // HP pool makes each chip a tiny fraction, so the head only nudges (no
        // special-case cap needed) while the white flash carries the feedback.
        const r = Math.max(entity.size.x, entity.size.y) * 0.5 * (1 + Math.min(0.4, flashD * 2.2) * (entity.hitReact ?? 1));
        const dragonCol = entity.color || DRAGON_CONSTANTS.COLOR;
        const [cr, cg, cb] = hexToRgb(dragonCol);
        const plateLift = `rgb(${liftCh(cr,0.5)},${liftCh(cg,0.5)},${liftCh(cb,0.5)})`;
        const plateSink = `rgb(${sinkCh(cr,0.55)},${sinkCh(cg,0.55)},${sinkCh(cb,0.55)})`;
        const edgeDk = `rgba(${sinkCh(cr,0.6)},${sinkCh(cg,0.6)},${sinkCh(cb,0.6)},0.9)`;
        const edgeLt = `rgba(${liftCh(cr,0.6)},${liftCh(cg,0.6)},${liftCh(cb,0.6)},0.85)`;
        const provoked = entity.provoked === true;
        // Energy accent: portal-violet at rest, hot red when provoked.  The
        // serpent is a void traveller — its "life" reads as one glowing core,
        // not organic eyes/fangs.  Kept deliberately spare so it doesn't
        // out-detail the rest of the (flat, low-detail) game assets.
        const ax = provoked ? 255 : 168, ay = provoked ? 70 : 130, az = provoked ? 48 : 250;
        let h = 0; for (let i = 0; i < entity.id.length; i++) h = (h * 31 + entity.id.charCodeAt(i)) % 997;
        const ph = (h / 997) * Math.PI * 2;
        const pulse = 0.6 + 0.4 * Math.sin(nowSec * (provoked ? 7 : 3.5) + ph);
        // Local frame: forward = +x (the dart points along travel).

        // ── Cosmetic gradient cache: the faceted-skull body gradient and the
        // plasma-maw gradient are rebuilt ONLY when the size / colour / flash /
        // provoked key changes; the per-frame energy `pulse` rides globalAlpha
        // at paint time (both maw + core-bloom fade to a=0 at the rim, so a
        // scalar alpha reproduces the old pulse-in-the-stops exactly).  With
        // several dragons on screen this drops the per-frame createRadialGradient
        // + addColorStop parse cost from 3 builds/dragon to at most the pulsing
        // core bloom. ──
        const flashActive = flashD > 0;
        if (entity.dragonGradR !== r || entity.dragonGradCol !== dragonCol
            || entity.dragonGradFlash !== flashActive || entity.dragonGradProvoked !== provoked) {
            const sg = ctx.createRadialGradient(r * 0.7, -r * 0.12, r * 0.1, r * 0.1, 0, r * 1.5);
            sg.addColorStop(0, flashActive ? '#ffffff' : plateLift);
            sg.addColorStop(0.55, flashActive ? '#ffffff' : `rgb(${cr},${cg},${cb})`);
            sg.addColorStop(1, plateSink);
            entity.dragonSkullGrad = sg;
            const mg = ctx.createRadialGradient(r * 1.0, 0, 0, r * 1.0, 0, r * 0.5);
            mg.addColorStop(0, `rgba(${ax},${ay},${az},1)`);
            mg.addColorStop(1, `rgba(${ax},${ay},${az},0)`);
            entity.dragonMawGrad = mg;
            entity.dragonGradR = r;
            entity.dragonGradCol = dragonCol;
            entity.dragonGradFlash = flashActive;
            entity.dragonGradProvoked = provoked;
        }

        // ── Swept blade-fins (geometric "horns"): one clean angular plate per
        // side, raked off the back. ──
        ctx.fillStyle = plateSink;
        ctx.lineWidth = Math.max(1, r * 0.04); ctx.strokeStyle = edgeDk;
        for (const sgn of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(-r * 0.3, sgn * r * 0.42);
            ctx.lineTo(-r * 1.35, sgn * r * 0.72);
            ctx.lineTo(-r * 0.55, sgn * r * 0.18);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
        }

        // ── Faceted dart skull: a sharp symmetric hex wedge, head-lit so the
        // flat polygon reads with volume (bright at the nose, dark at the neck). ──
        const skull = [
            [1.55, 0], [0.52, -0.6], [-0.5, -0.5], [-0.88, -0.16],
            [-0.88, 0.16], [-0.5, 0.5], [0.52, 0.6],
        ] as const;
        ctx.beginPath();
        ctx.moveTo(r * skull[0][0], r * skull[0][1]);
        for (let i = 1; i < skull.length; i++) ctx.lineTo(r * skull[i][0], r * skull[i][1]);
        ctx.closePath();
        ctx.fillStyle = entity.dragonSkullGrad!; ctx.fill();
        ctx.lineWidth = Math.max(1.5, r * 0.06); ctx.strokeStyle = edgeDk; ctx.stroke();

        // ── One central ridge seam, just enough to read as a faceted plate. ──
        ctx.lineWidth = Math.max(1, r * 0.035); ctx.strokeStyle = edgeLt;
        ctx.beginPath();
        ctx.moveTo(r * 1.55, 0); ctx.lineTo(-r * 0.88, 0);
        ctx.stroke();

        // ── Plasma maw: a single soft energy slit at the snout (no teeth). ──
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.45 + 0.3 * pulse; // energy pulse (cached unit gradient)
        ctx.fillStyle = entity.dragonMawGrad!;
        ctx.beginPath(); ctx.ellipse(r * 1.0, 0, r * 0.42, r * 0.14, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        // ── Reactor core: one faceted energy hexagon in the brow with a soft
        // bloom + white-hot centre.  The serpent's single "eye". ──
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const coreR = r * (0.28 + 0.04 * pulse);
        const cx0 = r * 0.1;
        const bloom = ctx.createRadialGradient(cx0, 0, 0, cx0, 0, coreR * 2.2);
        bloom.addColorStop(0, `rgba(${ax},${ay},${az},${0.6 * pulse})`);
        bloom.addColorStop(1, `rgba(${ax},${ay},${az},0)`);
        ctx.fillStyle = bloom;
        ctx.beginPath(); ctx.arc(cx0, 0, coreR * 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = ph + i * (Math.PI / 3);
            const px = cx0 + Math.cos(a) * coreR, py = Math.sin(a) * coreR;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = `rgba(${ax},${ay},${az},0.95)`; ctx.fill();
        ctx.beginPath(); ctx.arc(cx0, 0, coreR * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.7 + 0.3 * pulse})`; ctx.fill();
        return;
    }

    // The orb (Drone) renders a touch smaller so it reads as a compact,
    // buzzing craft next to the bigger winged ships.
    const shapeScale = shape === 'circle' ? 0.82 : 1;
    const baseR = Math.max(entity.size.x, entity.size.y) * 0.62 * shapeScale;
    const flash = (entity.hitFlash && entity.hitFlash > 0) ? entity.hitFlash : 0;
    // Scale-punch on hit, scaled by the hit's damage-as-%-of-maxHealth so a
    // chip on a tanky enemy barely flinches (hitReact unset → full punch).
    const r = baseR * (1 + Math.min(0.4, flash * 2.2) * (entity.hitReact ?? 1));
    const col = entity.color || '#f87171';
    const [cr, cg, cb] = hexToRgb(col);
    const pal = enemyPalette(col);

    // Stable per-entity phase (id-derived) desyncs the core pulse + flame
    // flicker so a pack doesn't throb in unison.  Render-only cache.
    if (entity.glowPhase === undefined) {
        let h = 0; const id = entity.id;
        for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
        entity.glowPhase = (h / 997) * Math.PI * 2;
    }
    const phase = entity.glowPhase;

    // ── Drone (circle) nervous buzz: a render-only high-frequency
    // positional jitter so the frantic peashooter visibly shimmies even at
    // full dive speed (the AI velocity jitter gets eaten by the speed cap
    // while charging).  Translates the WHOLE craft (flame + body + core)
    // a couple of px on a two-frequency deterministic noise.  Safe to
    // translate without restore — each entity rewrites the transform via
    // setTransform, so this never leaks to the next draw.
    if (shape === 'circle') {
        const bx = (Math.sin(nowSec * 13 + phase) + Math.sin(nowSec * 21 + phase * 1.7)) * 0.8;
        const by = (Math.cos(nowSec * 11 + phase * 1.3) + Math.sin(nowSec * 23 + phase)) * 0.8;
        ctx.translate(bx, by);
    }

    // Speed fraction drives the flame length/brightness + core pulse rate:
    // a charging rusher trails a long hot flame; an idling kiter simmers.
    const vx = entity.velocity?.x ?? 0, vy = entity.velocity?.y ?? 0;
    const speedFrac = Math.min(1, Math.hypot(vx, vy) / (entity.maxSpeed || 6));

    // ── Engine flame: a tapered, flickering plume off the tail (-x).  Two
    // stacked teardrops (outer colour wash + inner hot core) read as
    // directional thrust — unlike the old symmetric radial blob.
    {
        // Deterministic two-frequency flicker (no per-frame allocation /
        // randomness) — gives the flame a live sizzle.
        const flick = 0.82 + 0.12 * Math.sin(nowSec * 38 + phase)
                           + 0.06 * Math.sin(nowSec * 71 + phase * 2);
        const len = r * (0.6 + speedFrac * 1.9) * flick;
        const mouthX = -r * 0.5;          // attaches just behind the hull
        const tipX = mouthX - len;
        // Wider than before; the orb's small radius gets an extra boost so
        // its plume isn't a thin sliver.
        const halfW = r * (0.40 + speedFrac * 0.15) * (shape === 'circle' ? 1.3 : 1.0);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        // Outer plume — fixed ion-blue wash, fades to transparent at the tip.
        const og = ctx.createLinearGradient(mouthX, 0, tipX, 0);
        og.addColorStop(0, `rgba(${FLAME_OUTER},${0.5 * flick})`);
        og.addColorStop(1, `rgba(${FLAME_OUTER},0)`);
        ctx.fillStyle = og;
        ctx.beginPath();
        ctx.moveTo(mouthX, halfW);
        ctx.quadraticCurveTo(mouthX - len * 0.5, halfW * 0.55, tipX, 0);
        ctx.quadraticCurveTo(mouthX - len * 0.5, -halfW * 0.55, mouthX, -halfW);
        ctx.closePath();
        ctx.fill();

        // Inner hot core — shorter, white-hot, fades to cool blue.
        const iLen = len * 0.55;
        const iTipX = mouthX - iLen;
        const iHalf = halfW * 0.55;
        const ig = ctx.createLinearGradient(mouthX, 0, iTipX, 0);
        ig.addColorStop(0, `rgba(${FLAME_CORE},${0.78 * flick})`);
        ig.addColorStop(1, `rgba(${FLAME_TIP},0)`);
        ctx.fillStyle = ig;
        ctx.beginPath();
        ctx.moveTo(mouthX, iHalf);
        ctx.quadraticCurveTo(mouthX - iLen * 0.5, iHalf * 0.5, iTipX, 0);
        ctx.quadraticCurveTo(mouthX - iLen * 0.5, -iHalf * 0.5, mouthX, -iHalf);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // Shield (translucent blue) when the enemy is shielded.  A directional
    // arc shield (shieldArcHalfWidth set, Bulwark) draws a thick rotating
    // sector — drawn in the entity's LOCAL frame, so undo the body rotation
    // and use the world-space shieldArcAngle the sim sweeps — plus a faint
    // full guide ring.  A full-bubble shield draws the original ring.
    if ((entity.maxShield ?? 0) > 0 && (entity.shield ?? 0) > 0) {
        const frac = (entity.shield ?? 0) / (entity.maxShield ?? 1);
        const flash = (entity.shieldHitFlash ?? 0) > 0 ? 0.35 : 0;
        if (entity.shieldArcHalfWidth !== undefined) {
            const half = entity.shieldArcHalfWidth;
            const mid = (entity.shieldArcAngle ?? 0) - entity.rotation; // local frame
            const rr = r * 1.6;
            ctx.save();
            // Faint full guide ring so the gap reads as "shield is elsewhere".
            ctx.beginPath();
            ctx.arc(0, 0, rr, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(96,165,250,${0.10 + 0.10 * frac})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            // The active sector — bright, with a soft outer glow.
            ctx.beginPath();
            ctx.arc(0, 0, rr, mid - half, mid + half);
            ctx.strokeStyle = `rgba(${147 + Math.floor(60 * flash)},197,253,${0.55 + 0.4 * frac})`;
            ctx.lineWidth = 4;
            ctx.shadowColor = 'rgba(147,197,253,0.9)';
            ctx.shadowBlur = 8;
            ctx.stroke();
            ctx.restore();
        } else {
            // A full bubble now DEFLECTS, so the ring has to be drawn where the
            // deflection happens — `PhysicsSystem.shieldReach`, i.e. the bounding
            // radius times the shared COLLISION_MULTIPLIER, which is also where
            // the player's own shield ring and inflated collision shape sit.
            // Derived from `size` rather than the hit-punched `r` because physics
            // does not punch; the shared constant is what keeps the two honest.
            const rs = Math.max(entity.size.x, entity.size.y) * 0.5
                     * SHIELD_CONSTANTS.COLLISION_MULTIPLIER;
            ctx.beginPath();
            ctx.arc(0, 0, rs, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(96,165,250,${0.3 + 0.5 * frac + flash})`;
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }
    }

    // ── Body roll (Tank/hexagon only): a slow render-only rotational sway
    // plus a perpendicular squash so the heavy siege slug visibly rocks /
    // rolls at idle.  Applied to the SILHOUETTE + internal detail only —
    // the core eye, flame and muzzle telegraph stay locked to true facing
    // (+x) so aiming reads honestly.
    const isTank = shape === 'hexagon';
    const bodyRoll = isTank
        ? Math.sin(nowSec * 1.3 + phase) * 0.19 + Math.sin(nowSec * 0.5 + phase) * 0.07
        : 0;
    if (isTank) {
        ctx.save();
        ctx.rotate(bodyRoll);
        // Breathing squash perpendicular to facing sells the roll as
        // 3D heft rather than a flat spin.
        ctx.scale(1, 1 - 0.08 * Math.sin(nowSec * 1.3 + phase + 0.6));
    }

    // ── Body: a head-lit radial gradient gives the flat polygon volume
    // (bright toward the nose, darker at the tail/rim).  The gradient
    // object is cached on the entity and reused across frames (gradients
    // are applied in the current local transform at paint time, so the
    // origin-centred geometry stays correct as the entity moves); it's
    // only rebuilt when the radius (hit-flash punch) or colour changes.
    buildEnemyPath(ctx, shape, r);
    let bodyGrad = entity.enemyBodyGrad;
    if (bodyGrad === undefined || entity.enemyBodyGradR !== r || entity.enemyBodyGradCol !== col) {
        bodyGrad = ctx.createRadialGradient(r * 0.2, -r * 0.15, r * 0.1, 0, 0, r * 1.15);
        bodyGrad.addColorStop(0, pal.bodyLift);
        bodyGrad.addColorStop(0.55, col);
        bodyGrad.addColorStop(1, pal.bodySink);
        entity.enemyBodyGrad = bodyGrad;
        entity.enemyBodyGradR = r;
        entity.enemyBodyGradCol = col;
    }
    ctx.fillStyle = bodyGrad;
    ctx.fill();
    // Whiten on hit flash (re-fill the same path).
    if (flash > 0) {
        ctx.globalAlpha = Math.min(0.85, flash * 4);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    // ── Damage state: a multi-HP enemy that's lost health looks wounded —
    // a scorch darken over the body fill plus a stable set of crack strokes
    // that grows by one per HP lost.  Render-only, off health/maxHealth;
    // 1-HP types (Drone/Skirmisher) never qualify.  The crack pattern is
    // seeded from the entity's stable glowPhase so it holds still (only new
    // cracks appear as more hits land) instead of flickering per frame.
    const maxHp = entity.maxHealth ?? 0;
    const hp = entity.health ?? maxHp;
    if (maxHp > 1 && hp < maxHp) {
        const dmgFrac = Math.min(1, Math.max(0, 1 - hp / maxHp));
        const hits = Math.min(6, Math.round(maxHp - hp));
        const seed = (phase * 1000) + 1;
        // Clip everything to the body silhouette so scorch + cracks stay
        // inside the hull.  (save/restore doesn't touch the current path,
        // so the outline stroke below still reuses the body path.)  The
        // shared overlay is seeded one-crack-per-HP-lost for enemies.
        ctx.save();
        buildEnemyPath(ctx, shape, r);
        ctx.clip();
        drawDamageCracks(ctx, r, seed, hits, dmgFrac, ENEMY_CRACK_STYLE);
        ctx.restore();
        // The crack loop's beginPath() clobbered the body path; rebuild it
        // so the outline stroke below still traces the silhouette.
        buildEnemyPath(ctx, shape, r);
    }

    // Dark outline.
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ── Tank (hexagon) internal detail: a heavy-armour read — an inset
    // plate-seam ring, vertex rivets, and a stout forward ram prow.  Drawn
    // INSIDE the body-roll frame so it rocks with the hull.  Warm (rusher)
    // faction language: solid, angular, aggressive.  Hexagon vertex 0 is
    // the nose (+x), so the prow sits on the leading point.
    if (isTank) {
        const dk = pal.detailDk5;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const x = Math.cos(a) * r * 0.6, y = Math.sin(a) * r * 0.6;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = dk; ctx.lineWidth = 1.5; ctx.stroke();
        for (let i = 1; i < 6; i++) { // skip the nose vertex (prow covers it)
            const a = (i / 6) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, r * 0.07, 0, Math.PI * 2);
            ctx.fillStyle = dk; ctx.fill();
        }
        ctx.beginPath();
        ctx.moveTo(r * 0.98, 0);
        ctx.lineTo(r * 0.5, r * 0.22);
        ctx.lineTo(r * 0.5, -r * 0.22);
        ctx.closePath();
        ctx.fillStyle = pal.detailLt5;
        ctx.fill();
    }
    if (isTank) ctx.restore();

    // ── Orb inlay (Drone): a circle has no silhouette detail, so layer an
    // inset panel ring + a forward sensor pip for contrast and a heading
    // cue (the body is otherwise rotationally featureless).
    if (shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
        ctx.strokeStyle = pal.orbRing;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Forward sensor pip near the nose (+x).
        ctx.beginPath();
        ctx.arc(r * 0.66, 0, r * 0.13, 0, Math.PI * 2);
        ctx.fillStyle = pal.pip;
        ctx.fill();
    }

    // ── Skirmisher (diamond) internal detail: a precise sensor-craft read —
    // an inset panel diamond, a thin targeting spine, and a forward sensor
    // pip.  Cool (kiter) faction language: ringed, instrument-like.
    if (shape === 'diamond') {
        const dk = pal.detailDk4;
        ctx.beginPath();
        ctx.moveTo(r * 0.5, 0); ctx.lineTo(0, r * 0.45);
        ctx.lineTo(-r * 0.5, 0); ctx.lineTo(0, -r * 0.45);
        ctx.closePath();
        ctx.strokeStyle = dk; ctx.lineWidth = 1.3; ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(r * 0.1, 0); ctx.lineTo(r * 0.62, 0);
        ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath();
        ctx.arc(r * 0.72, 0, r * 0.12, 0, Math.PI * 2);
        ctx.fillStyle = pal.pip;
        ctx.fill();
    }

    // ── Orbiter (pentagon) internal detail: an acid-spitter read — an inset
    // ring and a forward nozzle aperture it spits from.  Cool (kiter) faction
    // language.  Pentagon vertex 0 is the nose (+x).
    if (shape === 'pentagon') {
        const dk = pal.detailDk4;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            const x = Math.cos(a) * r * 0.55, y = Math.sin(a) * r * 0.55;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = dk; ctx.lineWidth = 1.3; ctx.stroke();
        // Forward nozzle aperture at the nose vertex.
        ctx.beginPath();
        ctx.arc(r * 0.7, 0, r * 0.14, 0, Math.PI * 2);
        ctx.lineWidth = 1.4; ctx.stroke();
        ctx.beginPath();
        ctx.arc(r * 0.7, 0, r * 0.06, 0, Math.PI * 2);
        ctx.fillStyle = pal.detailLt5;
        ctx.fill();
    }

    // ── Pulsing core "eye": a hot dot that throbs faster the faster the
    // enemy moves.
    const pulse = 0.55 + 0.45 * Math.sin(nowSec * (4 + speedFrac * 6) + phase);
    const coreR = r * (0.22 + 0.06 * pulse);
    const coreGrad = ctx.createRadialGradient(r * 0.05, 0, 0, r * 0.05, 0, coreR);
    coreGrad.addColorStop(0,   `rgba(255,255,255,${0.6 + 0.35 * pulse})`);
    coreGrad.addColorStop(0.5, `rgba(${liftCh(cr,0.6)},${liftCh(cg,0.6)},${liftCh(cb,0.6)},${0.5 + 0.3 * pulse})`);
    coreGrad.addColorStop(1,   `rgba(${cr},${cg},${cb},0)`);
    ctx.beginPath();
    ctx.arc(r * 0.05, 0, coreR, 0, Math.PI * 2);
    ctx.fillStyle = coreGrad;
    ctx.fill();

    // ── Attack telegraph.  Every telegraphing shooter (Tank/Charger/Sniper)
    // shows a building muzzle charge glow; only the SNIPER also draws a
    // full-length lock-on laser to the player (a long aim line on a lobbed
    // slug read as odd).  Archetypes without a telegraph never set aimCharge.
    const charge = entity.aimCharge ?? 0;
    if (charge > 0) {
        const muzzleX = r * 1.05;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        // Lock-on laser — SNIPER ONLY.  Snapped on at full length the moment
        // the lock starts (length = the locked distance, so it reaches the
        // player) and intensifies toward the shot: a crisp white core under a
        // soft coloured halo so it reads at a glance.
        if (entity.aimLaser) {
            const lineLen = entity.aimDist ?? (r * 12);
            const lx2 = muzzleX + lineLen;
            const a = 0.55 + 0.4 * charge; // visible from lock start, brightens to fire
            const lgGlow = ctx.createLinearGradient(muzzleX, 0, lx2, 0);
            lgGlow.addColorStop(0,   `rgba(${cr},${cg},${cb},${0.3 * a})`);
            lgGlow.addColorStop(0.9, `rgba(${cr},${cg},${cb},${0.16 * a})`);
            lgGlow.addColorStop(1,   `rgba(${cr},${cg},${cb},0)`);
            ctx.strokeStyle = lgGlow;
            ctx.lineWidth = 3 + 2 * charge;
            ctx.beginPath();
            ctx.moveTo(muzzleX, 0);
            ctx.lineTo(lx2, 0);
            ctx.stroke();
            const lgCore = ctx.createLinearGradient(muzzleX, 0, lx2, 0);
            lgCore.addColorStop(0,   `rgba(255,255,255,${0.85 * a})`);
            lgCore.addColorStop(0.9, `rgba(${liftCh(cr,0.5)},${liftCh(cg,0.5)},${liftCh(cb,0.5)},${0.6 * a})`);
            lgCore.addColorStop(1,   `rgba(${cr},${cg},${cb},0)`);
            ctx.strokeStyle = lgCore;
            ctx.lineWidth = 1 + charge;
            ctx.beginPath();
            ctx.moveTo(muzzleX, 0);
            ctx.lineTo(lx2, 0);
            ctx.stroke();
        }

        // Muzzle charge: a hot dot swelling at the nose toward the shot.
        const mr = r * (0.1 + 0.35 * charge);
        const mGrad = ctx.createRadialGradient(muzzleX, 0, 0, muzzleX, 0, mr);
        mGrad.addColorStop(0,   `rgba(255,255,255,${0.7 * charge})`);
        mGrad.addColorStop(0.5, `rgba(${liftCh(cr,0.3)},${liftCh(cg,0.3)},${liftCh(cb,0.3)},${0.5 * charge})`);
        mGrad.addColorStop(1,   `rgba(${cr},${cg},${cb},0)`);
        ctx.fillStyle = mGrad;
        ctx.beginPath();
        ctx.arc(muzzleX, 0, mr, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // ── Kamikaze danger aura.  A bomber (explosionRadius stamped) is a live
    // warhead — it detonates the instant it touches you, so it gets a steady
    // pulsing magenta warning glow to read as "kill me or dodge me" at a
    // glance (the boom itself is its own big shockwave).  Render-only.
    if (entity.type === EntityType.ENEMY && entity.explosionRadius !== undefined) {
        const pulseA = 0.35 + 0.25 * Math.sin(nowSec * 7 + phase);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const auraR = r * 1.25;
        const ag = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, auraR);
        ag.addColorStop(0, `rgba(232,121,249,0)`);
        ag.addColorStop(0.7, `rgba(232,121,249,${0.18 * pulseA})`);
        ag.addColorStop(1, `rgba(232,121,249,${0.45 * pulseA})`);
        ctx.fillStyle = ag;
        ctx.beginPath();
        ctx.arc(0, 0, auraR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function buildEnemyPath(ctx: CanvasRenderingContext2D, shape: string, r: number) {
    ctx.beginPath();
    switch (shape) {
        case 'circle':
            // Orb body — detail is layered on in drawEnemyShape (inset ring
            // + forward sensor pip), since a bare disc has no silhouette.
            ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
            return; // already a closed sub-path; skip the closePath below
        case 'arrow':
            // Swept delta-interceptor with a V-notched tail — deliberately
            // unlike the plain concave cursor/indicator arrow.
            ctx.moveTo(r, 0);                         // nose
            ctx.lineTo(-r * 0.75, r * 0.9);           // right wingtip (swept back)
            ctx.lineTo(-r * 0.45, r * 0.25);          // right tail root
            ctx.lineTo(-r * 0.65, 0);                 // tail V-notch
            ctx.lineTo(-r * 0.45, -r * 0.25);         // left tail root
            ctx.lineTo(-r * 0.75, -r * 0.9);          // left wingtip
            break;
        case 'chevron':
            ctx.moveTo(r, 0); ctx.lineTo(-r * 0.7, r * 0.95);
            ctx.lineTo(-r * 0.3, 0); ctx.lineTo(-r * 0.7, -r * 0.95);
            break;
        case 'diamond':
            ctx.moveTo(r, 0); ctx.lineTo(0, r * 0.85);
            ctx.lineTo(-r, 0); ctx.lineTo(0, -r * 0.85);
            break;
        case 'hexagon': {
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2;
                const x = Math.cos(a) * r, y = Math.sin(a) * r;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            break;
        }
        case 'octagon': {
            // Bulwark fortress — a chunky 8-gon, rotated half a facet so a
            // flat face points forward (reads as a shielded prow, not a spike).
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
                const x = Math.cos(a) * r, y = Math.sin(a) * r;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            break;
        }
        case 'pentagon': {
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2;
                const x = Math.cos(a) * r, y = Math.sin(a) * r;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            break;
        }
        case 'star': {
            for (let i = 0; i < 10; i++) {
                const a = (i / 10) * Math.PI * 2;
                const rr = i % 2 === 0 ? r : r * 0.45;
                const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            break;
        }
        case 'nest': {
            // Fleshy hive — a lumpy 18-vertex blob (alternating radius) so it
            // reads as an organic spawner, not a clean polygon.
            const N = 18;
            for (let i = 0; i < N; i++) {
                const a = (i / N) * Math.PI * 2;
                const rr = r * (i % 2 === 0 ? 1 : 0.82);
                const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            break;
        }
        case 'cross': {
            // Turret emplacement — a chunky 12-vertex plus/cross with the
            // forward arm (+x) reading as the gun barrel.  t = arm half-width.
            const t = r * 0.34;
            ctx.moveTo(r, -t);   ctx.lineTo(r, t);      // forward arm tip (barrel)
            ctx.lineTo(t, t);    ctx.lineTo(t, r);      // down arm
            ctx.lineTo(-t, r);   ctx.lineTo(-t, t);
            ctx.lineTo(-r, t);   ctx.lineTo(-r, -t);    // rear arm
            ctx.lineTo(-t, -t);  ctx.lineTo(-t, -r);    // up arm
            ctx.lineTo(t, -r);   ctx.lineTo(t, -t);
            break;
        }
        case 'bubble': {
            // Soft round blob (gentle 12-vertex wobble) — fallback path for
            // any consumer outside drawEnemyShape's bespoke membrane render.
            const N = 12;
            for (let i = 0; i < N; i++) {
                const a = (i / N) * Math.PI * 2;
                const rr = r * (i % 2 === 0 ? 1 : 0.92);
                const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            break;
        }
        case 'warden': {
            // (h) boss hull — a bastion prow: a broad blunt ram face carried
            // on a wide buttressed body with flared engine shoulders.
            // Deliberately heavier and more architectural in outline than any
            // rank-and-file silhouette, so a capstone reads at a glance.
            ctx.moveTo(r * 0.98, -r * 0.26);          // prow, port corner
            ctx.lineTo(r * 1.06, 0);                  // ram tip
            ctx.lineTo(r * 0.98, r * 0.26);           // prow, starboard corner
            ctx.lineTo(r * 0.52, r * 0.52);           // forward buttress
            ctx.lineTo(r * 0.30, r * 0.94);           // starboard sponson
            ctx.lineTo(-r * 0.20, r * 0.98);
            ctx.lineTo(-r * 0.44, r * 0.60);
            ctx.lineTo(-r * 0.98, r * 0.44);          // engine shoulder
            ctx.lineTo(-r * 0.80, 0);                 // tail notch
            ctx.lineTo(-r * 0.98, -r * 0.44);
            ctx.lineTo(-r * 0.44, -r * 0.60);
            ctx.lineTo(-r * 0.20, -r * 0.98);
            ctx.lineTo(r * 0.30, -r * 0.94);          // port sponson
            ctx.lineTo(r * 0.52, -r * 0.52);
            break;
        }
        case 'talon': {
            // (h) boss hull — a forward-raked twin-prong warship: two long
            // claws reaching past a notched prow, with a broad swept body and
            // a flared tail.  Predatory where 'warden' is architectural, so
            // the two capstones read as different silhouettes at a glance.
            ctx.moveTo(r * 1.05, -r * 0.30);           // upper claw tip
            ctx.lineTo(r * 0.34, -r * 0.16);           // claw root
            ctx.lineTo(r * 0.46, 0);                   // prow notch
            ctx.lineTo(r * 0.34, r * 0.16);
            ctx.lineTo(r * 1.05, r * 0.30);            // lower claw tip
            ctx.lineTo(r * 0.22, r * 0.62);            // starboard shoulder
            ctx.lineTo(-r * 0.42, r * 0.92);           // starboard wingtip
            ctx.lineTo(-r * 0.58, r * 0.34);
            ctx.lineTo(-r * 0.95, r * 0.20);           // tail flare
            ctx.lineTo(-r * 0.78, 0);
            ctx.lineTo(-r * 0.95, -r * 0.20);
            ctx.lineTo(-r * 0.58, -r * 0.34);
            ctx.lineTo(-r * 0.42, -r * 0.92);          // port wingtip
            ctx.lineTo(r * 0.22, -r * 0.62);           // port shoulder
            break;
        }
        case 'bastion': {
            // (h) boss hull — a squat siege fortress: a heavy flat plated
            // face (the front-shield reads as part of the silhouette) over a
            // wide blocky chassis with recessed engine blocks aft.
            ctx.moveTo(r * 0.72, -r * 0.70);           // plate, port corner
            ctx.lineTo(r * 0.88, -r * 0.34);
            ctx.lineTo(r * 0.94, 0);                   // plate apex
            ctx.lineTo(r * 0.88, r * 0.34);
            ctx.lineTo(r * 0.72, r * 0.70);            // plate, starboard corner
            ctx.lineTo(r * 0.10, r * 0.88);
            ctx.lineTo(-r * 0.46, r * 0.82);           // chassis shoulder
            ctx.lineTo(-r * 0.52, r * 0.44);
            ctx.lineTo(-r * 0.92, r * 0.38);           // engine block
            ctx.lineTo(-r * 0.92, r * 0.12);
            ctx.lineTo(-r * 0.66, 0);
            ctx.lineTo(-r * 0.92, -r * 0.12);
            ctx.lineTo(-r * 0.92, -r * 0.38);
            ctx.lineTo(-r * 0.52, -r * 0.44);
            ctx.lineTo(-r * 0.46, -r * 0.82);
            ctx.lineTo(r * 0.10, -r * 0.88);
            break;
        }
        case 'triangle':
        default:
            ctx.moveTo(r, 0); ctx.lineTo(-r * 0.75, r * 0.8); ctx.lineTo(-r * 0.75, -r * 0.8);
            break;
    }
    ctx.closePath();
}
