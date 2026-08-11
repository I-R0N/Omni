/** Shared canvas helpers for the render layer — colour maths and the seeded
 *  damage-crack overlay.
 *
 *  Split out of `RenderSystem.ts` in gauntlet 5f (see
 *  `docs/GAUNTLET_5F_LOG.md`) so `enemyShapes.ts` could move without either
 *  file importing the other.  Nothing here knows about `RenderSystem`; these
 *  are free functions over a 2D context, which is why they were the natural
 *  shared floor.
 *
 *  Everything is module-level on purpose: the caches (`_rgbCache`) warm once,
 *  and the helpers are not per-frame closures, so the enemy-body gradient
 *  builder allocates nothing extra per entity (CLAUDE.md §8, mutate-don't-
 *  allocate).
 */
import { GameEntity } from '../../../types';
import { densityTintMultiplier } from '../../../constants';
import type { ShardVariantId } from '../ShardSystem.types';
import { MAP_WIDTH, MAP_HEIGHT, HALF_MAP_WIDTH, HALF_MAP_HEIGHT } from '../../toroidal';

// Converts a 6-digit hex color string to an [r, g, b] tuple.
// Results are cached to avoid per-frame string parsing.
export const _rgbCache = new Map<string, [number, number, number]>();
export function hexToRgb(hex: string): [number, number, number] {
    let cached = _rgbCache.get(hex);
    if (!cached) {
        const h = hex.replace('#', '');
        cached = [
            parseInt(h.substring(0, 2), 16),
            parseInt(h.substring(2, 4), 16),
            parseInt(h.substring(4, 6), 16),
        ];
        _rgbCache.set(hex, cached);
    }
    return cached;
}

// Channel-wise lighten/darken toward white/black by fraction f∈[0,1].
// Module-level (not per-frame closures) so the enemy-body gradient builder
// in drawEnemyShape allocates nothing extra per entity.
// Convert an [r, g, b] tuple back into a "#rrggbb" hex string.  Each
// channel is clamped to [0, 255] then 0-padded.  Used by the density
// tint helper to format a per-(variant, tier) cached colour string.
export function rgbToHex(r: number, g: number, b: number): string {
    const ri = Math.max(0, Math.min(255, Math.round(r))).toString(16).padStart(2, '0');
    const gi = Math.max(0, Math.min(255, Math.round(g))).toString(16).padStart(2, '0');
    const bi = Math.max(0, Math.min(255, Math.round(b))).toString(16).padStart(2, '0');
    return `#${ri}${gi}${bi}`;
}

/**
 * Resolve a shard's render colour for the current density tier.
 * Tier 0 (or no variant / no density) returns `baseHex` unchanged so
 * existing colours are preserved bit-for-bit.  Tier > 0 multiplies
 * each channel by the per-(variant, tier) multiplier from
 * `densityTintMultiplier`, caches the formatted hex on the entity
 * (`densityCachedTint`), and returns it.  ShardSystem invalidates
 * the cache (`densityCachedTint = undefined`) at every site that
 * mutates `densityTier`.
 */
export function densityTintForRender(entity: GameEntity, baseHex: string): string {
    const tier = entity.densityTier ?? 0;
    if (tier <= 0) return baseHex;
    const variantId = entity.shardVariant as ShardVariantId | undefined;
    if (!variantId) return baseHex;
    if (entity.densityCachedTint !== undefined) return entity.densityCachedTint;
    const mul = densityTintMultiplier(variantId, tier);
    if (mul >= 1.0) return baseHex;
    const [r, g, b] = hexToRgb(baseHex);
    const out = rgbToHex(r * mul, g * mul, b * mul);
    entity.densityCachedTint = out;
    return out;
}

export function liftCh(v: number, f: number): number {
    return Math.max(0, Math.min(255, Math.round(v + (255 - v) * f)));
}
export function sinkCh(v: number, f: number): number {
    return Math.max(0, Math.min(255, Math.round(v * (1 - f))));
}

// Deterministic [0,1) hash of a single scalar — the classic sin-fract trick.
// Used by the enemy damage-state overlay to lay down a STABLE crack pattern
// (seeded per-entity) that only grows as HP drops, instead of flickering
// fresh randomness each frame.  No allocation, no per-entity state.
export function hash01(n: number): number {
    const s = Math.sin(n) * 43758.5453;
    return s - Math.floor(s);
}

// Per-overlay tuning for the shared seeded crack pattern.  Enemies get a
// charred near-black fracture with a hot glint; rocks a slate fracture
// shadow; metal a brighter, thinner hairline split (both materials darker /
// quieter than the enemy version so destructibles read as "cracked" not
// "scorched").  Module-level constants → passed by reference, zero per-call
// allocation in the draw loop.
export interface CrackStyle {
    scorchRgb: string;   // "r,g,b" of the charred darken fill
    scorchBase: number;  // base scorch alpha (at first damage)
    scorchGain: number;  // extra scorch alpha × dmgFrac
    crackColor: string;  // stroke colour for each fissure
    crackWidth: number;  // stroke width
    glint: boolean;      // thin hot-orange highlight past 50 % damage
}
export const ENEMY_CRACK_STYLE: CrackStyle = {
    scorchRgb: '14,8,5', scorchBase: 0.15, scorchGain: 0.4,
    crackColor: 'rgba(0,0,0,0.6)', crackWidth: 1.6, glint: true,
};
// Slate-900 fracture shadow — the rock fill shows through, reads as a
// natural split rather than an opaque outline.  No hot glint (rock doesn't
// glow).  Lighter scorch than enemies so the slate body stays readable.
export const ROCK_CRACK_STYLE: CrackStyle = {
    scorchRgb: '15,23,42', scorchBase: 0.10, scorchGain: 0.28,
    crackColor: 'rgba(15,23,42,0.7)', crackWidth: 2.0, glint: false,
};
// Brighter, thinner hairline split for metal — a precise mechanical
// fracture against the gray plate, with a faint cold-white inner glint on
// the worst damage instead of the enemy's hot orange.
export const METAL_CRACK_STYLE: CrackStyle = {
    scorchRgb: '8,11,18', scorchBase: 0.10, scorchGain: 0.30,
    crackColor: 'rgba(2,6,12,0.55)', crackWidth: 1.1, glint: false,
};

// Stable [0,1000) per-entity seed for the crack overlay, lazily derived
// from the entity id (same id-hash the enemy core-pulse uses for
// glowPhase) and cached on a render-only field so the fracture pattern
// holds still frame-to-frame.
export function crackSeedFor(entity: GameEntity): number {
    if (entity.crackSeed !== undefined) return entity.crackSeed;
    let h = 0; const id = entity.id;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
    entity.crackSeed = (h / 997) * 1000 + 1;
    return entity.crackSeed;
}

// Lay down a STABLE, seeded set of fracture cracks (plus a charred scorch
// darken) in the current entity-local transform.  The CALLER is responsible
// for clipping to the silhouette (ctx.save → build path → ctx.clip) and for
// restoring afterwards — keeping the clip with the caller avoids passing a
// per-entity path-builder closure into the hot loop.  Deterministic per
// `seed`; one crack is drawn per unit of `count`, so the fracture only
// grows as HP drops instead of flickering fresh randomness each frame.
export function drawDamageCracks(
    ctx: CanvasRenderingContext2D,
    r: number,
    seed: number,
    count: number,
    dmgFrac: number,
    s: CrackStyle,
): void {
    // Scorch — a charred darken that deepens with damage.
    ctx.fillStyle = `rgba(${s.scorchRgb},${s.scorchBase + s.scorchGain * dmgFrac})`;
    ctx.fillRect(-r * 1.2, -r * 1.2, r * 2.4, r * 2.4);
    // Cracks — one jagged fissure per unit of count, each stable.
    ctx.lineCap = 'round';
    const TAU = Math.PI * 2;
    for (let i = 0; i < count; i++) {
        const a = hash01(seed + i * 1.7) * TAU;
        const ca = Math.cos(a), sa = Math.sin(a);
        const len = r * (0.55 + 0.4 * hash01(seed + i * 3.3));
        // Perpendicular kink at the midpoint for a jagged, non-straight crack.
        const perp = (hash01(seed + i * 5.1) - 0.5) * r * 0.5;
        const x0 = ca * r * 0.1,    y0 = sa * r * 0.1;
        const xm = ca * len * 0.55 - sa * perp, ym = sa * len * 0.55 + ca * perp;
        const x1 = ca * len,        y1 = sa * len;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(xm, ym);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = s.crackColor;
        ctx.lineWidth = s.crackWidth;
        ctx.stroke();
        // Thin hot-edge highlight on the worst damage so deep cracks glint.
        if (s.glint && dmgFrac > 0.5) {
            ctx.strokeStyle = `rgba(255,150,90,${0.25 * (dmgFrac - 0.5) * 2})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
        }
    }
}

/**
 * Return the shift that brings a world-space point (wx, wy) into the
 * camera's wrap zone — i.e. the copy of that point whose delta from the
 * camera is in [-HALF_MAP, +HALF_MAP).  Render translations use the
 * shifted coords so entities near a seam draw at the correct on-screen
 * position instead of ~MAP_WIDTH off the edge.  Since the frustum is
 * always < HALF_MAP on each axis, at most one shift offset can bring
 * an entity into view, so a single-draw render is sufficient (no
 * duplicate-draw needed).
 */
export function shiftX(camX: number, wx: number): number {
    const d = wx - camX;
    if (d >  HALF_MAP_WIDTH) return wx - MAP_WIDTH;
    if (d < -HALF_MAP_WIDTH) return wx + MAP_WIDTH;
    return wx;
}
export function shiftY(camY: number, wy: number): number {
    const d = wy - camY;
    if (d >  HALF_MAP_HEIGHT) return wy - MAP_HEIGHT;
    if (d < -HALF_MAP_HEIGHT) return wy + MAP_HEIGHT;
    return wy;
}

// Canvas 2D roundRect polyfill — available since Chrome 99 / Firefox 112.
// Provide a fallback so older preview engines don't throw on drop rendering.
export function roundRectPath(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number
) {
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, w, h, r);
        return;
    }
    // Manual fallback using arcTo
    const rx = Math.min(r, w / 2);
    const ry = Math.min(r, h / 2);
    ctx.moveTo(x + rx, y);
    ctx.lineTo(x + w - rx, y);
    ctx.arcTo(x + w, y,     x + w, y + ry,     rx);
    ctx.lineTo(x + w, y + h - ry);
    ctx.arcTo(x + w, y + h, x + w - rx, y + h, rx);
    ctx.lineTo(x + rx, y + h);
    ctx.arcTo(x,      y + h, x,      y + h - ry, rx);
    ctx.lineTo(x, y + ry);
    ctx.arcTo(x,      y,     x + rx, y,          rx);
    ctx.closePath();
}
