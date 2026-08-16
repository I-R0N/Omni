/** MATERIAL TILE + SHARD SHAPES — the STRUCTURE arm of `renderEntities`,
 *  and the drawing helpers that only it calls.
 *
 *  This is what a piece of terrain looks like: the glass-family tile (hex
 *  sprite, dent jitter, specular), the material tile (solid variant fill,
 *  butted-edge suppression, damage cracks, repel glow), the regen ghost, and
 *  the asteroid / mobile-shard branch with its LOD chips.  Extracted verbatim
 *  from `RenderSystem.renderEntities`.
 *
 *  WHAT TRAVELLED WITH IT, and why.  Every helper here had ALL of its call
 *  sites inside that one arm, which is the test 5f used at each milestone:
 *  a shared floor that accumulates single-caller helpers stops being a floor.
 *
 *    - `tileFillColor` and the three `materialAutomata*` steps behind it —
 *      the neighbour-count / density-tier colour automata.
 *    - `overlayMaterialCracks` — the HP-driven crack overlay (5f P13 already
 *      established it is NOT part of the static-tile cache).
 *    - `timedTileBloom` + `renderProximityBloom` — the variant `glow` layer
 *      and its perf bracket.
 *    - `drawMetalDebugOutline` — the DBG lattice outline for metal.
 *    - `plasticAutomataHex`, `shardMergeFadeAlpha`, `repelGlowIntensity` —
 *      module-scope colour / alpha maths with no other reader.
 *
 *  What did NOT travel: `materialAutomataAlpha` (the glass fast path and
 *  `staticTileCache.ts` also call it) and the sprite / bitmap caches
 *  (`getSolidTriangleBitmap`, `getSpecularBitmap`) — CLAUDE.md §2 files those
 *  on `RenderSystem`, so they are reached through `rs`.
 *
 *  NAMING: the renderer parameter is `rs`, not the `r` the other `render/`
 *  modules use, because the moved bodies bind `r` as a radius.
 */
import type { RenderSystem } from '../RenderSystem';
import { GameEntity, EntityType, CameraState, Vector2 } from '../../../types';
import {
    ASSETS, SHARD_VARIANTS, SHARD_LOD_CONSTANTS, MATERIAL_DAMAGE_CRACKS,
    METAL_HEX_CELLS, NEBULA_CONSTANTS, REGEN_POP_CONSTANTS, PLASTIC_SHARD_AUTOMATA,
    getPlasticShardBaseShade, isPlasticAutomataBrighten, metalDensityBrightness,
    METAL_AGGREGATION_BRIGHT_CEIL, METAL_BRIGHT_TARGET,
    getActiveGlassGlowColor, getActiveMetalGlowColor, getActivePlasticGlowBrightness,
    getActiveMetalGlowBrightness,
} from '../../../constants';
import { HEX_SIZE } from '../../maps/TileGenerator';
import { wrapDeltaX, wrapDeltaY } from '../../toroidal';
import { hexToRgb, rgbToHex, densityTintForRender, liftCh, sinkCh, hash01,
         CrackStyle, crackSeedFor, drawDamageCracks, ROCK_CRACK_STYLE,
         METAL_CRACK_STYLE } from './drawUtils';

/**
 * PAuto automata colour for a plastic-shard: the active palette's
 * constant base shade, darkened toward the cluster interior by its
 * neighbour-contact count (mirrors the nebula interior-darken rule).
 * Returns a small, discrete set of hexes (base × contact bucket) so
 * the soft-disc bitmap cache stays warm.
 */
function plasticAutomataHex(neighborCount: number): string {
    const base = getPlasticShardBaseShade();
    if (neighborCount <= 0) return base;
    const t = Math.min(1, neighborCount / PLASTIC_SHARD_AUTOMATA.MAX_NEIGHBORS);
    const target = isPlasticAutomataBrighten()
        ? PLASTIC_SHARD_AUTOMATA.MAX_BRIGHTNESS
        : PLASTIC_SHARD_AUTOMATA.MIN_BRIGHTNESS;
    const factor = 1 + t * (target - 1);
    if (factor === 1) return base;
    const [r, g, b] = hexToRgb(base);
    return rgbToHex(r * factor, g * factor, b * factor);
}

/**
 * Combined alpha multiplier for graceful retire windows on a shard.
 * Returns 1.0 outside any fade window; during a `mergeFadeTimer`
 * it returns the remaining-fraction (timer / duration) so the entity
 * smoothly dissolves instead of popping.  Stacks multiplicatively
 * with any nebula-specific fade (handled inside the nebula render
 * branch already).
 */
function shardMergeFadeAlpha(entity: GameEntity): number {
    const t = entity.mergeFadeTimer;
    if (t === undefined || t <= 0) return 1.0;
    const dur = entity.mergeFadeDuration;
    if (dur === undefined || dur <= 0) return 1.0;
    return Math.max(0, Math.min(1, t / dur));
}

// Map a per-substep `repelImpulse` accumulator to a 0..N glow intensity
// scalar.  Reference: glass-tile.repel.strength = 0.04 → a single body
// at a tile's centre yields ~0.04 per substep, normalising to 1.0.  Not
// clamped: metal's higher repel.strength (0.06) produces ~1.5 here, and
// multi-body scenarios push higher still.  Callers are expected to clamp
// the FINAL alpha (peakAlpha × intensity) so metal naturally reads
// brighter than glass when the input is identical.
function repelGlowIntensity(impulse: number): number {
    return impulse / 0.04;
}

// Proximity "bloom" glow for static tiles with a `glow` config —
// the warm-white tile-lighting on metal / plastic / rock /
// indestructible (and, if a variant sets `glow.hot`, an extra red
// hot-core layer — currently unused; reserved for the deferred metal
// heat treatment).  Draws one or two radial gradients centred on the
// point of the entity's polygon outline nearest the player, growing
// inward as the player closes in.  FILL ONLY — never strokes the
// edges; the polygon fill path confines each gradient (beyond a
// gradient's radius the fill is alpha 0, so the un-bloomed part of
// the face stays untouched).  No-op when the variant has no `glow`,
// the tile is mid hit-flash, or the player is out of range.  Assumes
// the canvas transform is already in the entity's local space
// (origin = centroid) — true in both the material-tile branch and
// the asteroid/shard branch.
// Thin perf wrapper around renderProximityBloom for static-tile call
// sites — brackets the helper with performance.now() and accumulates
// into lastTileLightingMs / lastTileLightingCount so the dev overlay
// can A/B tile glow on its own.  Called from the material-tile branch,
// the glass-family branch's indestructible path, and the asteroid/
// shard branch's rock-tile path.  ~1μs elapsed threshold filters
// entities that the helper bailed out of (out of range / no glow).
export function timedTileBloom(
    rs: RenderSystem,
    ctx: CanvasRenderingContext2D,
    entity: GameEntity,
    playerPos: Vector2 | undefined,
): void {
    const t = performance.now();
    renderProximityBloom(ctx, entity, playerPos);
    const elapsed = performance.now() - t;
    rs.lastTileLightingMs += elapsed;
    if (elapsed > 0.001) rs.lastTileLightingCount++;
}

export function renderProximityBloom(
    ctx: CanvasRenderingContext2D,
    entity: GameEntity,
    playerPos: Vector2 | undefined,
): void {
    if (!playerPos || entity.shardVariant === undefined) return;
    if (entity.hitFlash && entity.hitFlash > 0) return;
    const glow = SHARD_VARIANTS[entity.shardVariant].glow;
    if (glow === undefined) return;
    const pdxWorld = wrapDeltaX(entity.position.x, playerPos.x);
    const pdyWorld = wrapDeltaY(entity.position.y, playerPos.y);
    const pdistSq = pdxWorld * pdxWorld + pdyWorld * pdyWorld;
    if (pdistSq >= glow.range * glow.range) return;
    const intensity = (1 - Math.sqrt(pdistSq) / glow.range) ** 2;
    // Plastic-tile glow is the only variant routed through here with a
    // DBG brightness multiplier; other glow-bearing tiles (rock /
    // indestructible) render at their variant peakAlpha unchanged.
    const peakAlpha = entity.shardVariant === 'plastic-tile'
        ? glow.peakAlpha * getActivePlasticGlowBrightness()
        : glow.peakAlpha;

    // The polygon is stored in entity-local coords (pre-rotation); the
    // canvas transform rotates the rendering by `entity.rotation` at
    // draw time.  To find the closest point on the polygon to the
    // player IN THE FRAME THE POLYGON IS DRAWN IN, derotate the world
    // delta into entity-local coords.  Static tiles have rotation 0
    // (cos=1, sin=0) so this collapses to the world delta — same as
    // before for tiles.  Rotating shards need the proper transform so
    // the bloom centre tracks the player instead of spinning with the
    // shard.
    let pdx = pdxWorld, pdy = pdyWorld;
    if (entity.rotation !== 0) {
        const cosR = Math.cos(-entity.rotation);
        const sinR = Math.sin(-entity.rotation);
        pdx = pdxWorld * cosR - pdyWorld * sinR;
        pdy = pdxWorld * sinR + pdyWorld * cosR;
    }

    // Closest point on the polygon outline to the player (entity-local
    // coords; player is at (pdx, pdy) relative to the centroid), plus
    // the circumradius (max vertex distance) for sizing the bloom.
    // O(6) over the hex edges; slides smoothly along the perimeter as
    // the player orbits the tile.
    const pts = entity.polygonPoints;
    let cgx = 0, cgy = 0;
    let tileR = Math.max(entity.size.x, entity.size.y) / 2;
    if (pts && pts.length >= 3) {
        let bestD2 = Infinity, maxR2 = 0;
        for (let i = 0; i < pts.length; i++) {
            const aPt = pts[i], bPt = pts[(i + 1) % pts.length];
            const r2 = aPt.x * aPt.x + aPt.y * aPt.y;
            if (r2 > maxR2) maxR2 = r2;
            const abx = bPt.x - aPt.x, aby = bPt.y - aPt.y;
            const apx = pdx - aPt.x, apy = pdy - aPt.y;
            const segLen2 = abx * abx + aby * aby;
            let u = segLen2 > 0 ? (apx * abx + apy * aby) / segLen2 : 0;
            if (u < 0) u = 0; else if (u > 1) u = 1;
            const qx = aPt.x + abx * u, qy = aPt.y + aby * u;
            const d2 = (pdx - qx) * (pdx - qx) + (pdy - qy) * (pdy - qy);
            if (d2 < bestD2) { bestD2 = d2; cgx = qx; cgy = qy; }
        }
        if (maxR2 > 0) tileR = Math.sqrt(maxR2);
    }

    // Polygon fill path (entity-local coords) — confines both layers.
    ctx.beginPath();
    if (pts && pts.length > 0) {
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    } else {
        ctx.arc(0, 0, tileR, 0, Math.PI * 2);
    }
    ctx.closePath();

    // Layer A — base hue.  Radius small spot → 3.375× circumradius at
    // peak; globalAlpha scales the gradient's stop alphas (inner stop
    // = opaque hue, outer stop = same hue at alpha 0, so a larger
    // radius means a gentler falloff across the visible face).
    const oR = Math.max(tileR * (0.75 + 2.625 * intensity), 1);
    const og = ctx.createRadialGradient(cgx, cgy, 0, cgx, cgy, oR);
    og.addColorStop(0, glow.color);
    og.addColorStop(1, glow.color + '00');
    ctx.globalAlpha = peakAlpha * intensity;
    ctx.fillStyle = og;
    ctx.fill();

    // Layer B — optional hot core (metal): a smaller radial gradient
    // in `hot.color` at the same edge point, fading in once the base
    // intensity passes `hot.threshold`.
    const hot = glow.hot;
    if (hot !== undefined && intensity > hot.threshold) {
        const hotT = (intensity - hot.threshold) / (1 - hot.threshold);
        const rR = Math.max(tileR * (0.45 + 1.675 * hotT), 1);
        const rg = ctx.createRadialGradient(cgx, cgy, 0, cgx, cgy, rR);
        rg.addColorStop(0, hot.color);
        rg.addColorStop(1, hot.color + '00');
        ctx.globalAlpha = peakAlpha * hotT;
        ctx.fillStyle = rg;
        ctx.fill();
    }
    ctx.globalAlpha = 1.0;
}

/**
 * Resolve a material STATIC tile's render base colour through the
 * neighbour-brightness automata.  Returns `entity.color` unchanged
 * when the master toggle is off, the variant carries no `automata`
 * config, or the tile has no same-variant neighbours — so it's safe
 * to call unconditionally from any STRUCTURE fill site (mobile shards
 * and non-automata tiles fall straight through).
 */
/**
 * Fill colour for an automata-bearing static tile.  metal-tile brightens
 * by its densityTier (shard-layer density — metalDensityBrightness);
 * everything else (rock darken, plastic) keeps the neighbour-count
 * automata.  Metal's tier is stable after formation, so the brightened
 * hex is cached on materialAutomataCachedColor like the automata path.
 */
export function tileFillColor(rs: RenderSystem, entity: GameEntity): string {
  if (entity.shardVariant !== 'metal-tile') return materialAutomataColor(rs, entity);
  const f = metalDensityBrightness(entity.densityTier ?? 1);
  if (f === 1) return entity.color;
  if (entity.materialAutomataCachedColor !== undefined) return entity.materialAutomataCachedColor;
  const out = metalBrightHex(entity.color, f);
  entity.materialAutomataCachedColor = out;
  return out;
}

/**
 * Density brightening for metal, toward a SHINY STEEL-BLUE rather than
 * toward white (material-palette-residual, decision #30 → G7).
 *
 * The old form multiplied every channel by `f`. That looks like brightening
 * but it is really a march toward the ceiling on all three channels at once:
 * as the highest channel clips, the gaps between channels shrink, saturation
 * falls, and dense metal ends up pale near-white. Interpolating toward an
 * explicit blue endpoint keeps the material recognisably BLUE at every
 * density, and it gives the "shiny metal" direction a colour to aim at
 * instead of a brightness knob to turn up.
 *
 * `f` is remapped from its 1 → CEIL range onto a 0 → 1 mix so the density
 * curve (and everything keyed to it) is unchanged.
 */
export function metalBrightHex(baseHex: string, f: number): string {
  const span = METAL_AGGREGATION_BRIGHT_CEIL - 1;
  const t = span > 0 ? Math.max(0, Math.min(1, (f - 1) / span)) : 0;
  const [r, g, b] = hexToRgb(baseHex);
  const [tr, tg, tb] = hexToRgb(METAL_BRIGHT_TARGET);
  return rgbToHex(r + (tr - r) * t, g + (tg - g) * t, b + (tb - b) * t);
}

export function materialAutomataColor(rs: RenderSystem, entity: GameEntity): string {
  const factor = materialAutomataFactor(rs, entity);
  if (factor === 1) return entity.color;
  // Tint depends only on count (via factor) + base colour, both stable
  // between neighbour-count changes, so cache the string and skip the
  // per-frame hex parse/build.  Invalidated in
  // ShardSystem.recomputeMaterialNeighbors when the count changes.
  if (entity.materialAutomataCachedColor !== undefined) return entity.materialAutomataCachedColor;
  const [r, g, b] = hexToRgb(entity.color);
  const out = rgbToHex(r * factor, g * factor, b * factor);
  entity.materialAutomataCachedColor = out;
  return out;
}

/**
 * Normalised saturation `t` (0..1) for a material tile's automata:
 * 0 at no same-variant neighbours (lone tile / cluster edge), 1 at
 * `maxNeighbors` (fully interior).  Returns 0 when the master toggle
 * is off, the variant has no `automata` config, or the tile is on the
 * cluster edge — so both the brightness and opacity wrappers short-
 * circuit to "unchanged".
 */
export function materialAutomataT(rs: RenderSystem, entity: GameEntity): number {
  if (!rs.materialAutomataEnabled) return 0;
  const v = entity.shardVariant;
  if (v === undefined) return 0;
  const cfg = SHARD_VARIANTS[v].automata;
  if (cfg === undefined) return 0;
  const count = entity.materialNeighborCount ?? 0;
  if (count <= 0) return 0;
  return Math.min(1, count / cfg.maxNeighbors);
}

/**
 * Brightness multiplier (1 = unchanged) for the SOLID-FILL automata
 * path — metal-tile / rock-tile, whose opaque face reads interior
 * recession as a colour shift (>1 brightens, <1 darkens).  1 for
 * variants without a `saturationBrightness` (e.g. glass, which uses
 * the opacity path instead).
 */
export function materialAutomataFactor(rs: RenderSystem, entity: GameEntity): number {
  const v = entity.shardVariant;
  if (v === undefined) return 1;
  const sat = SHARD_VARIANTS[v].automata?.saturationBrightness;
  if (sat === undefined) return 1;
  const t = materialAutomataT(rs, entity);
  if (t === 0) return 1;
  return 1 + t * (sat - 1);
}

/**
 * Overlay the seeded HP-driven damage cracks onto a rocky / metal
 * destructible.  `buildPath` rebuilds the entity-local silhouette path
 * (the existing per-entity closure from renderEntities, so no new
 * allocation); the overlay clips to it so scorch + fissures stay inside
 * the body.  Crack count comes from MATERIAL_DAMAGE_CRACKS — one crack
 * per `cfg.freq` HP lost, capped at `cfg.cap`, off the LIVE maxHealth so
 * density-scaled tiles crack proportionally.  No-op until the entity has
 * lost enough HP to cross the first threshold.  Caller guarantees the
 * ctx transform is entity-local (centre + rotation already applied).
 */
export function overlayMaterialCracks(
    ctx: CanvasRenderingContext2D,
    entity: GameEntity,
    r: number,
    buildPath: () => void,
    style: CrackStyle,
    cfg: { freq: number; cap: number },
    apparentScale: number,
): void {
    const maxHp = entity.maxHealth ?? 0;
    const hp = entity.health ?? maxHp;
    if (maxHp <= 1 || hp >= maxHp || r <= 0) return;
    // LOD: hairline cracks are imperceptible once the body shrinks below a
    // few screen pixels — skip the save/clip/scorch/stroke work entirely for
    // tiny or distant damaged bodies (the proliferating rock/metal chips).
    // Pure render saving; the silhouette + base fill still draw normally.
    if (r * apparentScale < SHARD_LOD_CONSTANTS.MIN_APPARENT_RADIUS_PX) return;
    const count = Math.min(cfg.cap, Math.floor((maxHp - hp) / cfg.freq));
    if (count <= 0) return;
    const dmgFrac = Math.min(1, Math.max(0, 1 - hp / maxHp));
    ctx.save();
    buildPath();
    ctx.clip();
    drawDamageCracks(ctx, r, crackSeedFor(entity), count, dmgFrac, style);
    ctx.restore();
}

// DBG collision outline for metal shards (matches the nebula/plastic
// overlays).  Assumes ctx is already translated to the entity centroid
// and rotated by entity.rotation.  Shows the actual collision geometry:
// a composite outlines each lattice cell triangle (the per-cell SAT
// colliders, exactly the connected shape); a loose triangle shows its SAT
// polygon plus the inscribed shard-pair circle (size.x*0.25).  Orange to
// distinguish from the cyan nebula/plastic strokes.
export function drawMetalDebugOutline(rs: RenderSystem, ctx: CanvasRenderingContext2D, entity: GameEntity): void {
  if (!(rs.debugMode || rs.tileOutlinesEnabled)) return;
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = '#f97316'; // orange-500
  ctx.lineWidth = 1;
  if (entity.metalCells && entity.metalCells.length > 0 && entity.metalLatticeR) {
    const R = entity.metalLatticeR;
    const ux = (R * Math.sqrt(3)) / 2;
    const uy = R / 2;
    const cells = entity.metalCells;
    let cmx = 0, cmy = 0;
    for (const c of cells) { cmx += c.ix * ux; cmy += c.iy * uy; }
    cmx /= cells.length; cmy /= cells.length;
    for (const c of cells) {
      const ccx = c.ix * ux - cmx;
      const ccy = c.iy * uy - cmy;
      ctx.beginPath();
      if (c.up) {
        ctx.moveTo(ccx, ccy - R);
        ctx.lineTo(ccx + ux, ccy + uy);
        ctx.lineTo(ccx - ux, ccy + uy);
      } else {
        ctx.moveTo(ccx, ccy + R);
        ctx.lineTo(ccx + ux, ccy - uy);
        ctx.lineTo(ccx - ux, ccy - uy);
      }
      ctx.closePath();
      ctx.stroke();
    }
  } else {
    const pts = entity.polygonPoints;
    if (pts && pts.length > 0) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, entity.size.x * 0.25, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;
}

/** The STRUCTURE arm of `renderEntities`' entity-type branch.  Local space
 *  has the origin at the tile's centroid with its rotation already applied
 *  by the per-entity `setTransform` at the top of the renderer's slow path;
 *  `camera` is read only for its zoom, which the shard LOD thresholds and
 *  the crack overlay use to reason in apparent screen pixels. */
export function drawTileShape(
    rs: RenderSystem,
    ctx: CanvasRenderingContext2D,
    entity: GameEntity,
    nowSec: number,
    playerPos: Vector2 | undefined,
    camera: CameraState,
): void {

    // Build polygon path (shared by asteroid and tile)
    const buildPath = () => {
        ctx.beginPath();
        if (entity.polygonPoints && entity.polygonPoints.length > 0) {
            const p0 = entity.polygonPoints[0];
            if (Number.isFinite(p0.x) && Number.isFinite(p0.y)) {
                ctx.moveTo(p0.x, p0.y);
                for (let pi = 1; pi < entity.polygonPoints.length; pi++) {
                    const p = entity.polygonPoints[pi];
                    if (Number.isFinite(p.x) && Number.isFinite(p.y)) ctx.lineTo(p.x, p.y);
                }
            }
        } else {
            const r = entity.size.x / 2;
            if (Number.isFinite(r) && r > 0) ctx.arc(0, 0, r, 0, Math.PI * 2);
        }
        ctx.closePath();
    };

    const isGlassFamilyTile =
      entity.type === EntityType.STRUCTURE && entity.mass === Infinity
      && (entity.shardVariant === 'glass-tile'
          || entity.shardVariant === 'indestructible-tile');
    // Material tile branch — solid-color polygon-fill render
    // (variant-specific alpha, dent outline, repel-driven
    // glow on metal / proximity bloom on plastic).
    const isMaterialTile =
      entity.type === EntityType.STRUCTURE && entity.mass === Infinity
      && (entity.shardVariant === 'metal-tile' || entity.shardVariant === 'plastic-tile');
    if (isGlassFamilyTile) {
        // Glass-family static tiles render with the glass-tile
        // aesthetic (translucent fill + edge stroke + specular
        // dot).  Rock-tile and mobile shards take the asteroid
        // polygon branch below (solid fill in entity.color).
        // ── Regen pop-in scale overshoot ─────────────────────────────
        if (entity.regenPopTimer !== undefined && entity.regenPopTimer > 0) {
            const popT = entity.regenPopTimer / REGEN_POP_CONSTANTS.DURATION; // 1→0
            const scale = 1 + 0.15 * Math.sin(popT * Math.PI);
            ctx.scale(scale, scale);
        }

        // ── Regen ghost outline (tile not yet active) ────────────────
        if (!entity.active && entity.regenProgress !== undefined) {
            // Only show ghost during final 3 s (regenProgress > threshold)
            const delay = 12; // mirrors TILE_REGEN_DELAY
            const ghostStart = 1 - (3 / delay);
            if (entity.regenProgress >= ghostStart) {
                const t = (entity.regenProgress - ghostStart) / (1 - ghostStart); // 0→1
                const pulse = 0.4 + Math.sin(Date.now() / 250) * 0.25;
                buildPath();
                ctx.globalAlpha = t * pulse * 0.6;
                ctx.strokeStyle = 'rgba(103,232,249,1)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
            ctx.globalAlpha = 1.0;
            // Skip normal glass rendering — tile isn't back yet
            // (close the else below by jumping past it)
        } else {

        // ── Glass tile ──────────────────────────────────────────────
        // Hit-flash is suppressed on tiles per design — the
        // proximity tint already telegraphs activity without
        // a white-flash overlay on every impact.
        const isFlash = false;

        // Proximity tint: edge shifts from cool blue-white → bright cyan.
        // Toroidal delta so tiles across a seam reveal the same tint
        // treatment as tiles on the same side of the map.  Squared
        // early-out skips the sqrt for tiles outside the prox range
        // (the vast majority on densely-tiled maps).
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
        const edgeAlpha = isFlash ? 0.95 : (0.55 + prox * 0.35);
        const edgeColor = isFlash ? '#ffffff' : `rgba(${edgeR},${edgeG},${edgeB},${edgeAlpha})`;

        // Layer 1 — translucent base fill.  Every glass layer
        // below is multiplied by the bipolar neighbour-count
        // opacity automata (`autoAlpha`, centred on the neutral
        // 1.0): sparse tiles trend more opaque (clamped at solid
        // by the Math.min(1, …) on every layer), dense interiors
        // fade see-through.  (The HEX_STRUCTURE sprite is a
        // placeholder in this build, so glass always takes this
        // vector slow-path — fading layer 1 alone was invisible;
        // the edge stroke and specular carry most of the read.)
        const autoAlpha = rs.materialAutomataAlpha(entity);
        buildPath();
        ctx.globalAlpha = Math.min(1, (isFlash ? 0.55 : 0.13) * autoAlpha);
        ctx.fillStyle = isFlash ? '#ffffff' : 'rgba(186,230,253,1)';
        ctx.fill();

        // Layer 2 — diagonal shine (flat fill avoids per-tile gradient allocation)
        if (!isFlash) {
            ctx.globalAlpha = Math.min(1, 0.09 * autoAlpha);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }

        // Layer 2b — glass-tile proximity glow.  Intensity is
        // driven by the per-substep `repelImpulse` accumulator
        // PhysicsSystem writes into the tile, so the glow ramps
        // up for the PLAYER and for ENEMIES — but NOT for mobile
        // shards.  See PhysicsSystem.ts (the `b.repelImpulse`
        // write is gated on `a.type === PLAYER || a.type ===
        // ENEMY`): ambient shard contact would otherwise keep the
        // glow permanently lit.  Note the SAME field name means
        // something different on the scanner `a`, where it does
        // accumulate from shards; only the TILE side is gated.
        // Fill + thick stroke so the halo reads as a clear "lit
        // edge" — fill alone washes the hex out but doesn't beacon.
        // Indestructible-tile keeps the warm-white radial
        // bloom drawn after the cracks below.
        if (!isFlash && entity.shardVariant === 'glass-tile') {
            const glow = SHARD_VARIANTS[entity.shardVariant].glow;
            const impulse = entity.repelImpulse ?? 0;
            if (glow !== undefined && impulse > 0) {
                // Glow colour is DBG-cyclable (warm yellow A/Bs)
                // through getActiveGlassGlowColor; range +
                // peakAlpha stay with the SHARD_VARIANTS entry.
                const glowColor = getActiveGlassGlowColor();
                const intensityG = repelGlowIntensity(impulse);
                ctx.globalAlpha = Math.min(1, glow.peakAlpha * intensityG * autoAlpha);
                ctx.fillStyle = glowColor;
                ctx.fill();
                ctx.globalAlpha = Math.min(1, Math.max(0.4, glow.peakAlpha * intensityG) * autoAlpha);
                ctx.strokeStyle = glowColor;
                ctx.lineWidth = 3.0;
                ctx.stroke();
            }
        }

        // Layer 3 — edge stroke (proximity-tinted)
        ctx.globalAlpha = Math.min(1, autoAlpha);
        ctx.strokeStyle = edgeColor;
        ctx.lineWidth = isFlash ? 2.5 : 1.5;
        ctx.stroke();

        // Layer 4 — small specular dot (upper-left of hex)
        // Uses a pre-rendered 12×12 bitmap instead of a per-tile gradient.
        if (!isFlash) {
            ctx.globalAlpha = Math.min(1, (0.28 + prox * 0.18) * autoAlpha);
            ctx.drawImage(rs.getSpecularBitmap(), -15, -17);
        }

        // Indestructible-tile lighting — the fill-only warm-white
        // radial bloom (no edge stroke), painted last.  Glass-tile
        // uses its own layer 2b above instead.
        if (entity.shardVariant === 'indestructible-tile') {
            timedTileBloom(rs, ctx, entity, playerPos);
        }

        } // end else (glass tile — paired with regen ghost if/else above)

    } else if (isMaterialTile) {
        // ── Material tile (plastic / metal) ────────────────────────
        // Solid-color polygon fill at variant-specific alpha.  No
        // glass overlay, no specular dot, no proximity tint — these
        // are matte / metallic surfaces, not translucent glass.  The
        // polygon shape is whatever the dent system has perturbed
        // entity.polygonPoints into; the renderer just draws it.
        // Hit-flash suppressed on tiles (see glass-tile branch).
        const isFlash = false;
        const fillAlpha =
            entity.shardVariant === 'plastic-tile' ? 0.6 : 1.0;

        // ── Regen ghost (parity with glass-family ghost outline) ──
        if (!entity.active && entity.regenProgress !== undefined) {
            const delay = 12;
            const ghostStart = 1 - (3 / delay);
            if (entity.regenProgress >= ghostStart) {
                const t = (entity.regenProgress - ghostStart) / (1 - ghostStart);
                const pulse = 0.4 + Math.sin(Date.now() / 250) * 0.25;
                buildPath();
                ctx.globalAlpha = t * pulse * 0.6;
                ctx.strokeStyle = 'rgba(103,232,249,1)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
            ctx.globalAlpha = 1.0;
        } else {
            // Layer 1 — flat-color fill.  Metal sticks to the
            // gray palette even on hit flash; plastic keeps a
            // bright white flash since warm-orange + white reads
            // as polymer plastic, not metal.
            buildPath();
            ctx.globalAlpha = isFlash ? 0.95 : fillAlpha;
            const flashColor = entity.shardVariant === 'metal-tile'
                ? '#cbd5e1' // slate-300 — bright but still gray
                : '#ffffff';
            // Fill colour: metal-tile brightens by densityTier
            // (shard-layer density, see metalDensityBrightness); every
            // other automata tile (rock darken / plastic) goes through
            // materialAutomataColor.
            ctx.fillStyle = isFlash ? flashColor : tileFillColor(rs, entity);
            ctx.fill();

            // Layer 2 — selective outline.  Skip edges that are
            // both (a) at their original radius (no dent on either
            // endpoint) and (b) butted against a neighbour tile.
            // Draw deformed edges and cluster-boundary edges so
            // the silhouette reads as one continuous cluster
            // outline with internal dents visible.  Outline color
            // matches the corresponding shard's outline
            // (rocky-asteroid branch uses rgba(0,0,0,0.3)) so
            // detaching reads as continuous, not "tile in one
            // style, shard in another."
            ctx.globalAlpha = 1.0;
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = isFlash ? 2.5 : 1.5;

            const pts = entity.polygonPoints;
            if (pts && pts.length > 0) {
                // Original circumradius — for un-touched vertices
                // this equals the spawn-time hex radius (HEX_SIZE
                // for our hex grid).  Lazy bake from the current
                // max vertex distance so we don't need a new
                // GameEntity field; dent only ever pulls inward,
                // so the max captures the original at first
                // render and stays accurate afterwards.
                let origR2 = entity.originalCircumradiusSq ?? 0;
                if (origR2 === 0) {
                    for (let i = 0; i < pts.length; i++) {
                        const r2 = pts[i].x * pts[i].x + pts[i].y * pts[i].y;
                        if (r2 > origR2) origR2 = r2;
                    }
                    // 1 % tolerance so floating-point jitter from
                    // entity-local math doesn't false-trigger
                    // "deformed" on un-touched vertices.
                    entity.originalCircumradiusSq = origR2 * 0.98;
                }
                const deformThresholdR2 = entity.originalCircumradiusSq;

                // Probe distance for neighbour lookup: the un-dented
                // edge midpoint sits at the hex inradius from the
                // tile centre; scaling it by 2.0 lands the probe at
                // 2× inradius = HEX_WIDTH — exactly where a
                // touching neighbour's centre sits.  Probe radius
                // ~HEX_SIZE × 0.5 catches the neighbour even if its
                // centre is jittered slightly.
                const probeFactor = 2.0;
                const probeRadius = HEX_SIZE * 0.5;

                ctx.beginPath();
                for (let i = 0; i < pts.length; i++) {
                    const p1 = pts[i];
                    const p2 = pts[(i + 1) % pts.length];

                    const r1Sq = p1.x * p1.x + p1.y * p1.y;
                    const r2Sq = p2.x * p2.x + p2.y * p2.y;
                    const deformed = r1Sq < deformThresholdR2 || r2Sq < deformThresholdR2;

                    let drawEdge = deformed;
                    if (!deformed && rs.physics) {
                        // Probe outward from the edge midpoint to
                        // see if a neighbour tile covers the
                        // adjacent hex cell.  No neighbour →
                        // cluster-boundary edge → draw.
                        const midX = (p1.x + p2.x) * 0.5;
                        const midY = (p1.y + p2.y) * 0.5;
                        const probeWorldX = entity.position.x + midX * probeFactor;
                        const probeWorldY = entity.position.y + midY * probeFactor;
                        drawEdge = !rs.physics.hasStaticTileNear(
                            probeWorldX, probeWorldY, probeRadius, entity.id,
                        );
                    } else if (!deformed && !rs.physics) {
                        // No physics ref wired — fall back to the
                        // full outline so nothing renders worse
                        // than before.
                        drawEdge = true;
                    }

                    if (drawEdge) {
                        ctx.moveTo(p1.x, p1.y);
                        ctx.lineTo(p2.x, p2.y);
                    }
                }
                ctx.stroke();
            }

            // Damage cracks for metal-tile — the seeded HP-driven
            // fracture overlay (shared drawDamageCracks).  metal-tile
            // renders here on the slow path every frame (it is NOT in
            // the static-tile world cache — see isStaticTileCacheable),
            // so the live crack count is always correct without any
            // cache invalidation.  maxHealth scales ×densityTier, so a
            // dense tile cracks proportionally (capped).  Lower
            // frequency than rock — metal is tough (one crack per ~5
            // hits, MATERIAL_DAMAGE_CRACKS.metal).  Plastic-tile is
            // left to its colour-shift damage cue.
            if (entity.shardVariant === 'metal-tile') {
                const rr = Math.max(entity.size.x, entity.size.y) * 0.5;
                overlayMaterialCracks(
                    ctx, entity, rr, buildPath,
                    METAL_CRACK_STYLE, MATERIAL_DAMAGE_CRACKS.metal,
                    camera.zoom,
                );
            }

            // Proximity bloom for plastic — fill-only radial
            // bloom from the player-facing edge; see
            // renderProximityBloom().  Painted LAST so the outline
            // / cracks can't cover it.  Timed via timedTileBloom
            // so the dev overlay can A/B tile glow.  Metal-tile
            // takes the repel-driven layer 2b path below instead
            // — same accumulator-driven mechanism as glass-tile,
            // tuned visually heavier via metal's higher
            // repel.strength feeding repelGlowIntensity().
            if (entity.shardVariant === 'plastic-tile') {
                timedTileBloom(rs, ctx, entity, playerPos);
            } else if (entity.shardVariant === 'metal-tile' && !isFlash) {
                const glow = SHARD_VARIANTS['metal-tile'].glow;
                const impulse = entity.repelImpulse ?? 0;
                if (glow !== undefined && impulse > 0) {
                    const intensityM = repelGlowIntensity(impulse);
                    const bright = getActiveMetalGlowBrightness();
                    // Live colour from the DBG metal-glow cycle.
                    // Range + peakAlpha stay with the variant.
                    const glowColor = getActiveMetalGlowColor();
                    buildPath();
                    ctx.globalAlpha = Math.min(1, glow.peakAlpha * intensityM * bright);
                    ctx.fillStyle = glowColor;
                    ctx.fill();
                    // Thinner outline than glass (1.5 vs 3.0)
                    // — metal reads as a precise mechanical
                    // edge rather than glass's diffuse halo.
                    ctx.globalAlpha = Math.min(1, Math.max(0.4, glow.peakAlpha * intensityM * bright));
                    ctx.strokeStyle = glowColor;
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;
                }
            }
        }

    } else if (entity.type === EntityType.STRUCTURE && entity.mass === Infinity && !entity.active) {
        // Non-glass-family static tile (today: rock-tile) that's
        // inactive (regenerating).  Mirror the glass-family
        // ghost-outline render — fade-in cyan stroke during the
        // last 3 s of the regen wait, otherwise nothing.  This
        // prevents the asteroid solid-fill branch below from
        // drawing a stale slate hex while the tile is gone.
        if (entity.regenProgress !== undefined) {
            const delay = 12; // mirrors TILE_REGEN_DELAY
            const ghostStart = 1 - (3 / delay);
            if (entity.regenProgress >= ghostStart) {
                const t = (entity.regenProgress - ghostStart) / (1 - ghostStart);
                const pulse = 0.4 + Math.sin(Date.now() / 250) * 0.25;
                buildPath();
                ctx.globalAlpha = t * pulse * 0.6;
                ctx.strokeStyle = 'rgba(103,232,249,1)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.globalAlpha = 1.0;
            }
        }

    } else {
        // ── Asteroid / Tile shard ─────────────────────────────────────
        // Hit-flash is kept for mobile shards (gives heavy
        // collisions visual punch) but suppressed for rock-
        // tile so all tile variants share the no-flash
        // policy.  Dispatch by mass: static (Infinity) →
        // tile, finite → mobile shard.
        const isFlash   = entity.mass !== Infinity && !!entity.hitFlash && entity.hitFlash > 0;

        // ── Metal rigid composite — draw each lattice cell ─────────
        // The ctx is already translated to the composite centroid and
        // rotated by entity.rotation, so cells render in the lattice
        // frame.  Adjacent cells' fills meet exactly, reading as one
        // solid metal shape.
        if (entity.metalCells && entity.metalCells.length > 0 && entity.metalLatticeR) {
            const R = entity.metalLatticeR;
            const ux = (R * Math.sqrt(3)) / 2;
            const uy = R / 2;
            const cells = entity.metalCells;
            let cmx = 0, cmy = 0;
            for (const c of cells) { cmx += c.ix * ux; cmy += c.iy * uy; }
            cmx /= cells.length; cmy /= cells.length;
            ctx.globalAlpha = shardMergeFadeAlpha(entity);
            // Metal density cue, PER CELL: the composite holds
            // N = cells + excess shards spread evenly across its 6
            // slots (base = ⌊N/6⌋, with N mod 6 cells one layer
            // deeper), and each cell is brightened by its own depth
            // (metalDensityBrightness, depth 1 = darkest floor).  So a
            // hexagon mid-layer shows MIXED shades (some cells already
            // lightened) and a completed layer reads uniform — the live
            // telegraph of density building toward the next tier.
            const total = cells.length + (entity.metalExcessCells ?? 0);
            const baseDepth = cells.length >= METAL_HEX_CELLS
                ? Math.floor(total / METAL_HEX_CELLS)
                : 1;
            const deeperCells = cells.length >= METAL_HEX_CELLS
                ? total % METAL_HEX_CELLS
                : 0;
            for (let ci = 0; ci < cells.length; ci++) {
                const c = cells[ci];
                const depth = ci < deeperCells ? baseDepth + 1 : baseDepth;
                const f = metalDensityBrightness(depth);
                // Same de-white lerp as the tile body (G7) — the lattice
                // cells ARE the density readout, so they must climb toward
                // the same steel-blue rather than toward white.
                ctx.fillStyle = isFlash
                    ? '#cbd5e1'
                    : (f === 1 ? entity.color : metalBrightHex(entity.color, f));
                const ccx = c.ix * ux - cmx;
                const ccy = c.iy * uy - cmy;
                ctx.beginPath();
                if (c.up) {
                    ctx.moveTo(ccx, ccy - R);
                    ctx.lineTo(ccx + ux, ccy + uy);
                    ctx.lineTo(ccx - ux, ccy + uy);
                } else {
                    ctx.moveTo(ccx, ccy + R);
                    ctx.lineTo(ccx + ux, ccy - uy);
                    ctx.lineTo(ccx - ux, ccy - uy);
                }
                ctx.closePath();
                ctx.fill();
            }

            // Composite damage cracks — clip to the union of lattice
            // cells (exact silhouette) and overlay the shared seeded
            // metal fracture centred on the composite.  maxHealth is
            // the accumulated lattice HP, so a denser blob crosses
            // more crack thresholds (capped).  Allocation-free: the
            // clip path reuses the cell geometry already computed.
            const maxHpC = entity.maxHealth ?? 0;
            const hpC = entity.health ?? maxHpC;
            if (maxHpC > 1 && hpC < maxHpC) {
                const cfgC = MATERIAL_DAMAGE_CRACKS.metal;
                const countC = Math.min(cfgC.cap, Math.floor((maxHpC - hpC) / cfgC.freq));
                if (countC > 0) {
                    let radC = 0;
                    for (let ci = 0; ci < cells.length; ci++) {
                        const dx = cells[ci].ix * ux - cmx;
                        const dy = cells[ci].iy * uy - cmy;
                        const d = Math.sqrt(dx * dx + dy * dy);
                        if (d > radC) radC = d;
                    }
                    radC += R;
                    ctx.save();
                    ctx.beginPath();
                    for (let ci = 0; ci < cells.length; ci++) {
                        const c = cells[ci];
                        const ccx = c.ix * ux - cmx;
                        const ccy = c.iy * uy - cmy;
                        if (c.up) {
                            ctx.moveTo(ccx, ccy - R);
                            ctx.lineTo(ccx + ux, ccy + uy);
                            ctx.lineTo(ccx - ux, ccy + uy);
                        } else {
                            ctx.moveTo(ccx, ccy + R);
                            ctx.lineTo(ccx + ux, ccy - uy);
                            ctx.lineTo(ccx - ux, ccy - uy);
                        }
                        ctx.closePath();
                    }
                    ctx.clip();
                    const dmgFracC = Math.min(1, Math.max(0, 1 - hpC / maxHpC));
                    drawDamageCracks(ctx, radC, crackSeedFor(entity), countC, dmgFracC, METAL_CRACK_STYLE);
                    ctx.restore();
                }
            }

            ctx.globalAlpha = 1.0;
            drawMetalDebugOutline(rs, ctx, entity);
            return;
        }

        const isTileShard = entity.shardVariant === 'glass-shard';
        const glowColor = entity.powerupGlowColor;

        // ── LOD: tiny metal shards → cached solid triangle ─────────
        // Below MIN_APPARENT_RADIUS_PX the equilateral-triangle metal
        // shard's edge stroke and bloom are sub-pixel, so a flat
        // filled triangle is indistinguishable from the full render at
        // a fraction of the cost (one drawImage vs beginPath +
        // per-vertex lineTo + fill + stroke).  The cached bitmap is a
        // triangle (NOT a disc) so the silhouette stays faithful —
        // metal shards read as triangles, and a circle here was a
        // mis-render.  Restricted to metal-shard; rock (irregular
        // 5-9-gon) and glass (sharp splinter) are EXCLUDED — their
        // silhouette is part of the material's identity.  Also
        // excluded: hit-flashing and power-up-glowing shards (cues
        // must read).  Reset globalAlpha before the early return so a
        // following fast-path tile blit isn't faded.
        const lodR = entity.size.x * 0.5;
        if (rs.shardLodEnabled
            && entity.shardVariant === 'metal-shard'
            && !isFlash
            && glowColor === undefined
            && lodR * camera.zoom < SHARD_LOD_CONSTANTS.MIN_APPARENT_RADIUS_PX) {
            const tri = rs.getSolidTriangleBitmap(densityTintForRender(entity, entity.color));
            ctx.globalAlpha = shardMergeFadeAlpha(entity);
            ctx.drawImage(tri, -lodR, -lodR, lodR * 2, lodR * 2);
            ctx.globalAlpha = 1.0;
            drawMetalDebugOutline(rs, ctx, entity);
            rs.lastLodShardCount++;
            return;
        }
        // Rock chips: the conservation-chip system spawns many small
        // rock-shards, so collapse the tiniest ones (below the
        // chip-LOD radius, smaller than the metal threshold) to the
        // same cached solid blob — skips the full polygon + density
        // tint + (already LOD-gated) crack render.  Their jagged
        // silhouette is imperceptible at this apparent size.
        if (rs.shardLodEnabled
            && entity.shardVariant === 'rock-shard'
            && !isFlash
            && glowColor === undefined
            && lodR * camera.zoom < SHARD_LOD_CONSTANTS.CHIP_LOD_RADIUS_PX) {
            const blob = rs.getSolidTriangleBitmap(densityTintForRender(entity, entity.color));
            ctx.globalAlpha = shardMergeFadeAlpha(entity);
            ctx.drawImage(blob, -lodR, -lodR, lodR * 2, lodR * 2);
            ctx.globalAlpha = 1.0;
            rs.lastLodShardCount++;
            return;
        }

        if (isTileShard) {
            // ── Tile shard — glass-like translucent panels with optional glow
            // Density tier darkens the base hue (cool blue-white → muted
            // slate as tier climbs); merge-fade alpha multiplies every
            // layer.  When a glow is present we keep its colour pure
            // (powerup readability matters more than density darkening),
            // but the base panel still reads denser.
            const fadeAlpha = shardMergeFadeAlpha(entity);
            const baseHex = glowColor ?? '#b4e6fd';
            const tintedHex = glowColor ? glowColor : densityTintForRender(entity, baseHex);
            const [gr, gg, gb] = hexToRgb(tintedHex);

            if (glowColor) {
                // Power-up glow bloom — strong, opaque tint
                const pulse     = 0.82 + Math.sin(nowSec * 5.5) * 0.18;
                const glowR     = (entity.size.x / 2) * 3.0 * pulse;
                const bloom     = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR);
                bloom.addColorStop(0,   `rgba(${gr},${gg},${gb},0.55)`);
                bloom.addColorStop(0.5, `rgba(${gr},${gg},${gb},0.25)`);
                bloom.addColorStop(1,   `rgba(${gr},${gg},${gb},0)`);
                ctx.globalAlpha = 1.0 * fadeAlpha;
                ctx.fillStyle   = bloom;
                ctx.beginPath();
                ctx.arc(0, 0, glowR, 0, Math.PI * 2);
                ctx.fill();
            }

            // Base fill — more opaque than a plain tile, solid color tint
            buildPath();
            ctx.globalAlpha = (isFlash ? 0.85 : (glowColor ? 0.55 : 0.22)) * fadeAlpha;
            ctx.fillStyle   = isFlash ? '#ffffff' : `rgba(${gr},${gg},${gb},1)`;
            ctx.fill();

            // Edge stroke
            ctx.globalAlpha = 1.0 * fadeAlpha;
            ctx.strokeStyle = isFlash ? '#ffffff' : `rgba(${gr},${gg},${gb},0.85)`;
            ctx.lineWidth   = isFlash ? 2.5 : 1.5;
            ctx.stroke();

        } else {
            // ── Rocky asteroid — solid fill with optional non-opaque powerup overlay
            // Density tier darkens the base colour; merge-fade alpha
            // multiplies every layer so the dissolve is uniform.
            // Per-variant tweaks so dent shards look identical
            // to their parent tile:
            //  - metal-shard stays on the gray palette even on
            //    hit flash (no white) to match metal-tile.
            //  - Other rocky shards (rock-shard, rock-tile)
            //    keep their fully-opaque default.
            //  - plastic-shard renders here too post-revert; the
            //    PAuto automata (Pl shade DBG) optionally swaps
            //    the per-instance shade for a constant palette
            //    base brightness-scaled by neighbour count.
            //  - rock-tile: material-tile automata darkens dense
            //    cluster interiors by same-variant neighbour count
            //    (materialAutomataColor — a no-op for mobile shards
            //    and non-automata variants, so rock-/metal-shards
            //    are untouched).
            const baseColor = (rs.plasticAutomataEnabled
                               && entity.shardVariant === 'plastic-shard')
                ? plasticAutomataHex(entity.plasticNeighborCount ?? 0)
                : materialAutomataColor(rs, entity);
            const densityHex = densityTintForRender(entity, baseColor);
            const fadeAlpha = shardMergeFadeAlpha(entity);
            const flashColor = entity.shardVariant === 'metal-shard'
                ? '#cbd5e1'
                : '#ffffff';
            const baseAlpha = 1.0;
            buildPath();
            ctx.globalAlpha = (isFlash ? 0.95 : baseAlpha) * fadeAlpha;
            ctx.fillStyle   = isFlash ? flashColor : densityHex;
            ctx.fill();

            if (glowColor && !isFlash) {
                // Subtle powerup color overlay — semi-transparent, mixes with rock color
                const [gr, gg, gb] = hexToRgb(glowColor);
                const pulse = 0.6 + Math.sin(nowSec * 4.5) * 0.15;
                buildPath();
                ctx.globalAlpha = 0.28 * pulse * fadeAlpha;
                ctx.fillStyle   = `rgb(${gr},${gg},${gb})`;
                ctx.fill();

                // Ambient rim glow
                const glowR = (entity.size.x / 2) * 2.0 * pulse;
                const bloom = ctx.createRadialGradient(0, 0, entity.size.x * 0.25, 0, 0, glowR);
                bloom.addColorStop(0,   `rgba(${gr},${gg},${gb},0)`);
                bloom.addColorStop(0.6, `rgba(${gr},${gg},${gb},0.12)`);
                bloom.addColorStop(1,   `rgba(${gr},${gg},${gb},0)`);
                ctx.globalAlpha = 1.0 * fadeAlpha;
                ctx.fillStyle   = bloom;
                ctx.beginPath();
                ctx.arc(0, 0, glowR, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.globalAlpha = 1.0 * fadeAlpha;
            // Rock-tile renders without an outline — the brittle
            // dent silhouette reads cleaner against the slate
            // fill when there's no rim line tracing every
            // notch.  Rock-shards, plastic-shards, and metal-
            // shards keep theirs (matches the per-material
            // tile/shard parity we set earlier).
            if (entity.shardVariant !== 'rock-tile') {
                ctx.strokeStyle = 'rgba(0,0,0,0.3)';
                ctx.lineWidth   = 2;
                ctx.stroke();
            }

            // Damage cracks for rock tiles + shards — a seeded,
            // HP-driven fracture overlay (slate-900 shadow, the
            // rock fill shows through) shared with enemies via
            // drawDamageCracks.  Deterministic per entity so the
            // pattern holds still and only accrues as HP drops;
            // far lower frequency than enemies (one crack per
            // ~1.3 hits, see MATERIAL_DAMAGE_CRACKS.rock).  Drawn
            // in entity-local space (ctx already translated +
            // rotated by the setTransform in renderEntities).
            if (entity.shardVariant === 'rock-tile'
                || entity.shardVariant === 'rock-shard') {
                const rr = Math.max(entity.size.x, entity.size.y) * 0.5;
                overlayMaterialCracks(
                    ctx, entity, rr, buildPath,
                    ROCK_CRACK_STYLE, MATERIAL_DAMAGE_CRACKS.rock,
                    camera.zoom,
                );
            } else if (entity.shardVariant === 'metal-shard') {
                // Single (non-composite) metal-shard — the metal
                // hairline-split style.  Tiny shards rarely cross a
                // threshold (low HP) and the LOD path skips the
                // smallest entirely; the chunkier / denser ones show
                // a split or two.  The grown rigid composite cracks
                // in its own branch above.
                const rr = Math.max(entity.size.x, entity.size.y) * 0.5;
                overlayMaterialCracks(
                    ctx, entity, rr, buildPath,
                    METAL_CRACK_STYLE, MATERIAL_DAMAGE_CRACKS.metal,
                    camera.zoom,
                );
            }
        }

        // Proximity bloom for rock-tile (the only entity in this
        // branch with a `glow` config today).  Mobile shards in
        // this branch don't have glow configs, so we skip the
        // call entirely rather than letting the helper no-op
        // hundreds of times per frame.
        if (entity.mass === Infinity) {
            timedTileBloom(rs, ctx, entity, playerPos);
        }

        if (entity.shardVariant === 'metal-shard') {
            drawMetalDebugOutline(rs, ctx, entity);
        }
    }

}
