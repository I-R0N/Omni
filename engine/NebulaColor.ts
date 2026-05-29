// NebulaColor.ts
//
// Palette-constrained compositional colour for nebula tiles.
//
// Nebula tiles and shards store their colour as a weighted list of base-hex
// contributions (NebulaColorStop[]).  Blending happens lazily at render time
// via blendCompositionToHex(), which averages in the OKLCH colour space.
// Averaging in OKLCH — rather than sRGB — preserves perceptual vibrancy,
// so combined colours stay on-palette instead of drifting toward grey.
//
// This design is cycle-stable: a shatter-then-merge cycle never loses
// information because shards carry a *copy* of the parent composition, and
// merges concatenate + dedupe rather than averaging-then-storing.

import { NebulaColorStop } from '../types';
import { NEBULA_CONSTANTS, getActiveNebulaPalette } from '../constants';

// ── sRGB ↔ hex helpers ───────────────────────────────────────────────────
function hexToRgb01(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [
        parseInt(h.substring(0, 2), 16) / 255,
        parseInt(h.substring(2, 4), 16) / 255,
        parseInt(h.substring(4, 6), 16) / 255,
    ];
}

function rgb01ToHex(r: number, g: number, b: number): string {
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const toByte = (v: number) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0');
    return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

// ── sRGB ↔ linear sRGB ───────────────────────────────────────────────────
function srgbToLinear(c: number): number {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// ── linear sRGB ↔ OKLab (Björn Ottosson, 2020) ───────────────────────────
// Reference: https://bottosson.github.io/posts/oklab/
function linearRgbToOklab(r: number, g: number, b: number): [number, number, number] {
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);
    return [
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    ];
}

function oklabToLinearRgb(L: number, a: number, b: number): [number, number, number] {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    return [
        +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
}

// ── Cache: hex → OKLab (for blending hot-path) ───────────────────────────
const _oklabCache = new Map<string, [number, number, number]>();
function hexToOklab(hex: string): [number, number, number] {
    const cached = _oklabCache.get(hex);
    if (cached) return cached;
    const [r, g, b] = hexToRgb01(hex);
    const lab = linearRgbToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
    _oklabCache.set(hex, lab);
    return lab;
}

// ── Cache: composition signature → blended hex (render hot-path) ─────────
// Compositions are small (1–4 stops), so JSON.stringify is negligible.
const _blendCache = new Map<string, string>();

/**
 * Flatten a NebulaColorStop[] composition into a single display hex.
 * Averages L/a/b components weighted by stop weight, then converts back
 * to sRGB.  Cached per unique composition to keep per-frame cost tiny.
 */
export function blendCompositionToHex(composition: NebulaColorStop[] | undefined): string {
    if (!composition || composition.length === 0) return NEBULA_CONSTANTS.DEFAULT_HEX;
    if (composition.length === 1) return composition[0].hex;

    const key = composition.map(s => `${s.hex}:${s.weight.toFixed(3)}`).join('|');
    const cached = _blendCache.get(key);
    if (cached) return cached;

    let totalWeight = 0;
    let L = 0, a = 0, b = 0;
    for (const stop of composition) {
        const w = stop.weight;
        totalWeight += w;
        const lab = hexToOklab(stop.hex);
        L += lab[0] * w;
        a += lab[1] * w;
        b += lab[2] * w;
    }
    if (totalWeight > 0) { L /= totalWeight; a /= totalWeight; b /= totalWeight; }

    const [lr, lg, lb] = oklabToLinearRgb(L, a, b);
    const hex = rgb01ToHex(linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb));

    if (_blendCache.size < 1024) _blendCache.set(key, hex);
    return hex;
}

// ── HSL palette generation ───────────────────────────────────────────────
// Nebula tiles draw from a constrained hue arc — cyan through blue,
// purple, pink, and into red — skipping the orange/yellow/green band.
// The arc spans 210° starting at NEBULA_PALETTE_HUE_MIN (cyan, 165°) and
// wrapping past 360° into the reds, ending at NEBULA_PALETTE_HUE_MIN +
// NEBULA_PALETTE_HUE_RANGE (= 375° ≡ 15°).  Averages/interpolations still
// use unit-vector math so wraparound (e.g. 350° + 10° → 0°) works
// correctly on the allowed arc.
export const NEBULA_PALETTE_HUE_MIN = 165;
export const NEBULA_PALETTE_HUE_MAX = 375; // wraps: the 15° past 360°
export const NEBULA_PALETTE_HUE_RANGE = 210;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function hslToHex(h: number, s: number, l: number): string {
    const sFrac = s / 100;
    const lFrac = l / 100;
    const c = (1 - Math.abs(2 * lFrac - 1)) * sFrac;
    const hp = ((h % 360) + 360) % 360 / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }
    const m = lFrac - c / 2;
    return rgb01ToHex(r + m, g + m, b + m);
}

// Extract the hue (degrees, [0, 360)) from an sRGB hex string.
// Used by the regen rule to do direct hue arithmetic.
export function hexToHueDeg(hex: string): number {
    const [r, g, b] = hexToRgb01(hex);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d < 1e-6) return 0;
    let h: number;
    if (max === r)      h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    return h;
}

// Convert a hue (degrees) to a palette-standard hex using the active
// nebula palette's saturation + lightness.  Read each call so the DBG
// 'Nebula palette' cycle takes effect on the next sample.
export function paletteHueToHex(hueDeg: number): string {
    const p = getActiveNebulaPalette();
    return hslToHex(hueDeg, p.saturation, p.lightness);
}

// Normalize an arbitrary hue to the standard [0, 360) range.  Renamed
// from its old "clamp to palette arc" meaning — the palette now spans
// the full wheel, so this is a pure wraparound normalisation.
export function clampHueToPalette(hueDeg: number): number {
    return ((hueDeg % 360) + 360) % 360;
}

// Shortest-arc distance between two hues, in [0, 180].  Used by the
// regen min-shift check so "close" and "far" are measured along the
// shorter direction around the wheel.
export function circularHueDistance(a: number, b: number): number {
    const diff = Math.abs(a - b) % 360;
    return diff > 180 ? 360 - diff : diff;
}

// Unit-vector weighted average of a list of hues.  The input's `weight`
// field scales each contribution; the sum-of-vectors atan2 result lands
// in [0, 360) and handles wraparound correctly (e.g., averaging 350° +
// 10° → 0°).  Returns undefined for an empty list or a sum vector near
// zero (happens when opposing hues cancel out).
export function circularHueAverage(
    entries: Array<{ hue: number; weight: number }>
): number | undefined {
    if (entries.length === 0) return undefined;
    let sumX = 0, sumY = 0;
    for (const e of entries) {
        const rad = e.hue * DEG_TO_RAD;
        sumX += Math.cos(rad) * e.weight;
        sumY += Math.sin(rad) * e.weight;
    }
    // Near-zero vector (opposing hues cancel) — average is undefined.
    if (Math.abs(sumX) < 1e-6 && Math.abs(sumY) < 1e-6) return undefined;
    return clampHueToPalette(Math.atan2(sumY, sumX) * RAD_TO_DEG);
}

// Circular weighted interpolation between two hues.  `weightA + weightB`
// do not need to sum to any particular value — only the ratio matters.
// Takes the shorter arc from a toward b, so lerping 350° toward 10° with
// any positive weights produces a result near 0°, not near 180°.
export function circularLerpHue(
    a: number,
    weightA: number,
    b: number,
    weightB: number
): number {
    const total = weightA + weightB;
    if (total < 1e-6) return a;
    const aRad = a * DEG_TO_RAD;
    const bRad = b * DEG_TO_RAD;
    const x = (weightA * Math.cos(aRad) + weightB * Math.cos(bRad)) / total;
    const y = (weightA * Math.sin(aRad) + weightB * Math.sin(bRad)) / total;
    if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) return a;
    return clampHueToPalette(Math.atan2(y, x) * RAD_TO_DEG);
}

// Pick a random hue uniformly from the active palette's arc.  Reads
// the live preset so the DBG 'Nebula palette' cycle takes effect on
// the next sample.
export function randomPaletteHueDeg(): number {
    const p = getActiveNebulaPalette();
    return (p.hueMin + Math.random() * p.hueRange) % 360;
}

/**
 * Random single-stop composition for nebula-style dust puffs spawned
 * by glass / rock tile or shard events (shatter AND shard→tile merge
 * transmutation).  Both helpers now draw from the *active* nebula
 * palette so dust colours track the DBG palette cycle — the legacy
 * cool-glass / warm-rock sub-arc split was abandoned (it only made
 * sense under the original cyan→red default palette, and produced
 * mis-coloured dust under narrower presets like 'yellow' or 'gold').
 * Kept as two named functions so future callers can re-introduce a
 * material distinction without touching every call site.
 */
export function randomGlassNebulaComposition(): NebulaColorStop[] {
    return [{ hex: paletteHueToHex(randomPaletteHueDeg()), weight: 1 }];
}
export function randomRockNebulaComposition(): NebulaColorStop[] {
    return [{ hex: paletteHueToHex(randomPaletteHueDeg()), weight: 1 }];
}

/**
 * Pick a fresh random-hue palette entry from the cyan-through-red arc
 * (orange, yellow, and green are excluded).  Returns a single-stop
 * composition suitable for a newly generated nebula tile.
 */
export function randomNebulaComposition(): NebulaColorStop[] {
    const hue = randomPaletteHueDeg();
    const hex = paletteHueToHex(hue);
    return [{ hex, weight: 1 }];
}

/**
 * Deep-copy a composition so shards can drift/mutate independently of their
 * parent tile without aliasing.
 */
export function cloneComposition(composition: NebulaColorStop[] | undefined): NebulaColorStop[] {
    if (!composition) return randomNebulaComposition();
    return composition.map(s => ({ hex: s.hex, weight: s.weight }));
}

// Cap on how many distinct hex stops a composition may retain.  Prevents
// unbounded list growth as many small nebulas merge into one large one.
const MAX_COMPOSITION_STOPS = 5;

/**
 * Weighted-merge two colour compositions, biasing by the external `weightA`
 * and `weightB` values (typically the entities' respective areas).  Each
 * composition is first normalised internally, then scaled by its external
 * weight, then concatenated and deduped by hex.  Result weights sum to 1.
 *
 * If the merged list exceeds MAX_COMPOSITION_STOPS, the smallest-weight
 * entries are folded into the largest until the cap is met — this keeps
 * the composition bounded without losing the dominant hues.
 */
export function blendCompositions(
    a: NebulaColorStop[] | undefined,
    weightA: number,
    b: NebulaColorStop[] | undefined,
    weightB: number
): NebulaColorStop[] {
    const listA = a && a.length > 0 ? a : randomNebulaComposition();
    const listB = b && b.length > 0 ? b : randomNebulaComposition();

    const totalExt = Math.max(1e-6, weightA + weightB);
    const fracA = weightA / totalExt;
    const fracB = weightB / totalExt;

    // Normalise internal weights.
    const internalSum = (list: NebulaColorStop[]) =>
        Math.max(1e-6, list.reduce((s, e) => s + e.weight, 0));
    const sA = internalSum(listA);
    const sB = internalSum(listB);

    const merged = new Map<string, number>();
    for (const stop of listA) {
        merged.set(stop.hex, (merged.get(stop.hex) ?? 0) + (stop.weight / sA) * fracA);
    }
    for (const stop of listB) {
        merged.set(stop.hex, (merged.get(stop.hex) ?? 0) + (stop.weight / sB) * fracB);
    }

    let result: NebulaColorStop[] = Array.from(merged.entries())
        .map(([hex, weight]) => ({ hex, weight }))
        .sort((x, y) => y.weight - x.weight);

    // Cap stop count by folding the smallest into the largest.
    while (result.length > MAX_COMPOSITION_STOPS) {
        const tail = result.pop()!;
        result[0].weight += tail.weight;
    }

    // Re-normalise to sum to 1 (defensive against rounding drift).
    const total = result.reduce((s, e) => s + e.weight, 0) || 1;
    for (const stop of result) stop.weight /= total;

    return result;
}
