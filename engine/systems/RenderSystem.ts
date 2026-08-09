

import { GameEntity, Vector2, MapType, CameraState, EntityType, DamageText, PlayerHUDMessage, WeaponType, WaveAnnouncement, TrailPoint, TrailShape } from '../../types';
import { COLORS, ASSETS, MINIMAP_CONSTANTS, UI_CONSTANTS, CAMERA_CONSTANTS, SPRITE_CONSTANTS, WEAPONS, WEAPON_LIST, LOADOUT_HUD_CONSTANTS, computeLoadoutHUDLayout, SHIELD_CONSTANTS, REGEN_POP_CONSTANTS, WAVE_ANNOUNCE_CONSTANTS, NEBULA_CONSTANTS, PLAYER_TRAIL_CONSTANTS, INPUT_CONSTANTS, CHARGE_CONSTANTS, densityTintMultiplier, metalDensityBrightness, METAL_HEX_CELLS, SHARD_VARIANTS, MATERIAL_DAMAGE_CRACKS, getActiveNebulaStretchK, getPlasticShardBaseShade, PLASTIC_SHARD_AUTOMATA, isPlasticAutomataBrighten, SHARD_LOD_CONSTANTS, getActiveGlassGlowColor, getActiveMetalGlowColor, getActivePlasticGlowBrightness, getActiveMetalGlowBrightness, BUBBLE_CONSTANTS, DRAGON_CONSTANTS, STATION_CONSTANTS, PORTAL_CONSTANTS, BOSS_CONSTANTS, BOSS_DEFS, effectiveDpr, STATIC_TILE_STAMPS_PER_FRAME} from '../../constants';
import type { ShardVariantId } from './ShardSystem.types';
import { BackgroundManager } from './BackgroundManager';
import { blendCompositionToHex } from '../NebulaColor';
import { HEX_AREA, HEX_SIZE } from '../maps/TileGenerator';
import { MAP_WIDTH, MAP_HEIGHT, HALF_MAP_WIDTH, HALF_MAP_HEIGHT, wrapDeltaX, wrapDeltaY } from '../toroidal';

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
function shiftX(camX: number, wx: number): number {
    const d = wx - camX;
    if (d >  HALF_MAP_WIDTH) return wx - MAP_WIDTH;
    if (d < -HALF_MAP_WIDTH) return wx + MAP_WIDTH;
    return wx;
}
function shiftY(camY: number, wy: number): number {
    const d = wy - camY;
    if (d >  HALF_MAP_HEIGHT) return wy - MAP_HEIGHT;
    if (d < -HALF_MAP_HEIGHT) return wy + MAP_HEIGHT;
    return wy;
}

/**
 * DBG-only asteroid/shard flow-field overlay toggle state.  Passed in
 * from GameEngine.draw() each frame; all default off when the panel is
 * collapsed.  See `renderFlowFieldOverlay` for the per-overlay draw
 * paths.  Pursuit-field overlays are intentionally out of scope here.
 */
export interface FlowOverlayState {
    vectors:   boolean;
    cells:     boolean;
    obstacles: boolean;
    rebuilds:  boolean;
    sampleN:   number;
}

// Per-cell flash window for the FF Rebuilds overlay (ms).  Long enough
// that a single tile destruction is visible at 60 Hz (~36 frames); short
// enough that rapid destruction events don't smear into one big blob.
const FF_REBUILD_FLASH_MS = 600;

const SHIELD_COLOR = SHIELD_CONSTANTS.COLOR;
const SHIELD_HIT_FLASH_DURATION = SHIELD_CONSTANTS.HIT_FLASH_DURATION;
const SHIELD_COLLISION_MULT = SHIELD_CONSTANTS.COLLISION_MULTIPLIER;

// Converts a 6-digit hex color string to an [r, g, b] tuple.
// Results are cached to avoid per-frame string parsing.
const _rgbCache = new Map<string, [number, number, number]>();
function hexToRgb(hex: string): [number, number, number] {
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
function liftCh(v: number, f: number): number {
    return Math.max(0, Math.min(255, Math.round(v + (255 - v) * f)));
}
function sinkCh(v: number, f: number): number {
    return Math.max(0, Math.min(255, Math.round(v * (1 - f))));
}

// Deterministic [0,1) hash of a single scalar — the classic sin-fract trick.
// Used by the enemy damage-state overlay to lay down a STABLE crack pattern
// (seeded per-entity) that only grows as HP drops, instead of flickering
// fresh randomness each frame.  No allocation, no per-entity state.
function hash01(n: number): number {
    const s = Math.sin(n) * 43758.5453;
    return s - Math.floor(s);
}

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

// Per-overlay tuning for the shared seeded crack pattern.  Enemies get a
// charred near-black fracture with a hot glint; rocks a slate fracture
// shadow; metal a brighter, thinner hairline split (both materials darker /
// quieter than the enemy version so destructibles read as "cracked" not
// "scorched").  Module-level constants → passed by reference, zero per-call
// allocation in the draw loop.
interface CrackStyle {
    scorchRgb: string;   // "r,g,b" of the charred darken fill
    scorchBase: number;  // base scorch alpha (at first damage)
    scorchGain: number;  // extra scorch alpha × dmgFrac
    crackColor: string;  // stroke colour for each fissure
    crackWidth: number;  // stroke width
    glint: boolean;      // thin hot-orange highlight past 50 % damage
}
const ENEMY_CRACK_STYLE: CrackStyle = {
    scorchRgb: '14,8,5', scorchBase: 0.15, scorchGain: 0.4,
    crackColor: 'rgba(0,0,0,0.6)', crackWidth: 1.6, glint: true,
};
// Slate-900 fracture shadow — the rock fill shows through, reads as a
// natural split rather than an opaque outline.  No hot glint (rock doesn't
// glow).  Lighter scorch than enemies so the slate body stays readable.
const ROCK_CRACK_STYLE: CrackStyle = {
    scorchRgb: '15,23,42', scorchBase: 0.10, scorchGain: 0.28,
    crackColor: 'rgba(15,23,42,0.7)', crackWidth: 2.0, glint: false,
};
// Brighter, thinner hairline split for metal — a precise mechanical
// fracture against the gray plate, with a faint cold-white inner glint on
// the worst damage instead of the enemy's hot orange.
const METAL_CRACK_STYLE: CrackStyle = {
    scorchRgb: '8,11,18', scorchBase: 0.10, scorchGain: 0.30,
    crackColor: 'rgba(2,6,12,0.55)', crackWidth: 1.1, glint: false,
};

// Stable [0,1000) per-entity seed for the crack overlay, lazily derived
// from the entity id (same id-hash the enemy core-pulse uses for
// glowPhase) and cached on a render-only field so the fracture pattern
// holds still frame-to-frame.
function crackSeedFor(entity: GameEntity): number {
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
function drawDamageCracks(
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

// Engine-flame palette — a FIXED hot ion/plasma colour so the thrust plume
// reads as exhaust regardless of the enemy's body colour (it used to inherit
// the body colour and wash out).  White-hot core, cool-blue wash.
const FLAME_OUTER = '120, 190, 255'; // ion-blue outer wash
const FLAME_CORE  = '255, 255, 255'; // white-hot core
const FLAME_TIP   = '150, 210, 255'; // cool-blue fade at the tip

// Convert an [r, g, b] tuple back into a "#rrggbb" hex string.  Each
// channel is clamped to [0, 255] then 0-padded.  Used by the density
// tint helper to format a per-(variant, tier) cached colour string.
function rgbToHex(r: number, g: number, b: number): string {
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
function densityTintForRender(entity: GameEntity, baseHex: string): string {
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

// Canvas 2D roundRect polyfill — available since Chrome 99 / Firefox 112.
// Provide a fallback so older preview engines don't throw on drop rendering.
function roundRectPath(
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

export class RenderSystem {
  private ctx: CanvasRenderingContext2D | null = null;
  private backgroundManager: BackgroundManager;
  private debugMode: boolean = false;
  // Player trail shape — selectable from the debug panel.
  private trailShape: TrailShape = TrailShape.CIRCLE;
  // DBG toggle — when true, the renderer draws thin collision-
  // boundary outlines on variants whose default render is
  // outlineless (plastic-tile / plastic-shard soft-gradient,
  // nebula-tile / nebula-shard cloud).  Lets a dev see where the
  // SAT collision shape ends vs. where the gradient bleeds.
  // Default OFF.  Wired through GameEngine.toggleTileOutlines and
  // surfaced in the DBG panel's Visual section.
  public tileOutlinesEnabled: boolean = false;
  // When true, off-screen indicator chevrons are suppressed for entities that
  // are currently ON screen — the player can already see them, so the chevron
  // is redundant clutter; chevrons then only point at nearby-but-offscreen
  // entities.  Wired through GameEngine.toggleChevronMode, surfaced in the DBG
  // Visual section ("Chevrons": Offscreen / All).  Default = offscreen-only.
  public chevronsOffscreenOnly: boolean = true;
  // DBG toggle (PAuto) — when true, plastic-shards render in the
  // active palette's constant base shade, brightness-scaled by their
  // neighbour-contact count (ShardSystem.plasticNeighborCount).  When
  // false, they keep their per-instance random shade.  Default ON.
  public plasticAutomataEnabled: boolean = false;
  // DBG toggle (Tile shade) — master gate for the material-tile
  // neighbour-brightness automata.  When true, glass / metal / rock
  // STATIC tiles scale their render colour by their same-variant
  // hex-neighbour count (SHARD_VARIANTS[v].automata); cluster edges and
  // lone tiles stay at the base palette colour.  Default ON so the
  // effect reads immediately for review.  Paired with
  // ShardSystem.materialAutomataEnabled (the count-compute gate) via
  // GameEngine.toggleMaterialAutomata.
  public materialAutomataEnabled: boolean = true;
  // DBG toggle (ShLOD) — when true, mobile shards whose apparent radius
  // is below SHARD_LOD_CONSTANTS.MIN_APPARENT_RADIUS_PX blit a cached
  // solid disc instead of their full polygon render.  Default ON.
  public shardLodEnabled: boolean = true;
  // Count of shards drawn via the LOD disc this frame — DBG perf readout.
  public lastLodShardCount: number = 0;

  // Perf instrumentation — wall time (ms) of the most recent render() call.
  // Written at the end of render() and read by GameEngine for the dev perf
  // overlay.  render() is a single top-level pass so one timer covers it.
  public lastRenderMs: number = 0;
  // Sub-timer for the dedicated nebula-tile / shard pass.  Lets the dev
  // overlay show what fraction of the total render budget is spent on
  // nebula entities, which is the primary suspect for the high render
  // cost on the NebulaFieldMap.
  public lastNebulaMs: number = 0;
  // Visible-nebula-entity count after the per-frame frustum cull.  Read
  // by the dev overlay so the user can see how many tiles the nebula
  // pass is actually iterating per frame — context for interpreting
  // lastNebulaMs.  Updated once per render() call.
  public lastNebulaVisible: number = 0;
  // Per-frame split of how many nebula entities took the fast path vs.
  // the slow path.  Reset at the start of render() and incremented in
  // renderEntities below.  fast + slow == lastNebulaVisible (modulo
  // entities that early-return for inactivity).
  public lastNebulaFastCount: number = 0;
  public lastNebulaSlowCount: number = 0;
  // Wall time (ms) spent in renderProximityBloom calls for STATIC
  // tiles this frame (mass = Infinity — glass / plastic / metal / rock /
  // indestructible whose variant has a `glow`).  Excludes mobile-shard
  // bloom calls (today there are none — shard `glow` configs are off).
  // Accumulated across the material-tile branch, the asteroid/shard
  // branch's rock-tile path, and the glass-family branch's
  // indestructible path; reset at the start of render().  Surfaces in
  // the dev overlay so tile lighting can be A/B'd on its own.
  public lastTileLightingMs: number = 0;
  // Count of tiles that actually drew a bloom this frame.  Context for
  // interpreting lastTileLightingMs.
  public lastTileLightingCount: number = 0;

  public setDebugMode(v: boolean) { this.debugMode = v; }
  public setTrailShape(s: TrailShape) { this.trailShape = s; }

  // DBG collision outline for metal shards (matches the nebula/plastic
  // overlays).  Assumes ctx is already translated to the entity centroid
  // and rotated by entity.rotation.  Shows the actual collision geometry:
  // a composite outlines each lattice cell triangle (the per-cell SAT
  // colliders, exactly the connected shape); a loose triangle shows its SAT
  // polygon plus the inscribed shard-pair circle (size.x*0.25).  Orange to
  // distinguish from the cyan nebula/plastic strokes.
  private drawMetalDebugOutline(ctx: CanvasRenderingContext2D, entity: GameEntity): void {
    if (!(this.debugMode || this.tileOutlinesEnabled)) return;
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

  // Optional PhysicsSystem reference for spatial queries — today only the
  // material-tile branch uses it (to suppress edge strokes on edges that
  // are cleanly butted against a neighbour tile).  Null is treated as "no
  // neighbour data available" → fall back to drawing the full outline.
  private physics: import('./PhysicsSystem').PhysicsSystem | null = null;
  public setPhysics(p: import('./PhysicsSystem').PhysicsSystem) { this.physics = p; }

  // Optional FlowFieldGrid reference — wired by GameEngine once on
  // construction.  Null until then; the DBG asteroid/shard FF overlays
  // gracefully no-op without a flow field.
  private flowField: import('./FlowFieldGrid').FlowFieldGrid | null = null;
  public setFlowField(f: import('./FlowFieldGrid').FlowFieldGrid) { this.flowField = f; }

  private images: Map<string, HTMLImageElement> = new Map();
  // Optimization: Reusable buffer for sorting indicators to prevent array allocation
  private _indicatorBuffer: { entity: GameEntity, distSq: number, onScreen: boolean }[] = [];
  // Pre-rendered specular dot bitmap (created once, reused for every glass tile)
  private _specularBitmap: HTMLCanvasElement | null = null;
  // Pre-rendered nebula twinkle star (created once, reused for every nebula
  // tile/shard).  Soft radial glow with a 4-point spike cross drawn additively
  // so it reads as a tiny far-away star sparkling inside the cloud.
  private _twinkleBitmap: HTMLCanvasElement | null = null;
  // Tinted sprite cache: `${src}|${hex}` → pre-tinted offscreen canvas.
  // Nebula tiles/shards re-use the background nebula PNGs with per-tile
  // colour composition applied via source-atop, so tinting happens once per
  // (sprite, colour) pair instead of every frame.
  private _tintedSprites: Map<string, HTMLCanvasElement> = new Map();
  // Normalized (range [-0.5, 0.5]) alpha-weighted centroid offset of the
  // visible content within each sprite's bitmap bounds.  Computed once
  // per source URL at first draw, then reused to shift drawImage so the
  // content's visual centre lands on the rotation pivot.  Prevents
  // sprite "orbiting" when the art isn't perfectly centred in its frame.
  private _spriteCentroids: Map<string, { dx: number, dy: number }> = new Map();
  // Projectile glow gradient cache.  Every standard / charged shot used to
  // rebuild a createRadialGradient + 5-6 addColorStop (each parses a CSS
  // colour string) PER PROJECTILE PER FRAME — the dominant per-frame cost in
  // shot-heavy combat (cap 600, frustum-culled).  Instead we build the glow
  // ONCE as a unit-radius (r=1) radial gradient keyed by owner+colour; the
  // colour stops sit at RELATIVE radii, so filling the unit gradient under
  // ctx.scale(glowR, glowR) reproduces any glow radius with identical pixels.
  // Keyed "E<col>" / "P<col>" (enemy/player); the charged fireball is a
  // single static entry.  Warms to ~10 entries.
  private _projGlowCache: Map<string, CanvasGradient> = new Map();
  private _chargedGlow: CanvasGradient | null = null;
  // Render buffers.  Each entry carries the entity AND its camera-local
  // render coords (rx, ry) — computed once at cull time so the draw pass
  // can translate to the right shifted position without recomputing.
  // Toroidal maps require this because an entity near the wrap seam
  // must render at position ±MAP_WIDTH / ±MAP_HEIGHT from its canonical
  // coord to appear in the right on-screen spot.
  private _visibleEntities: { entity: GameEntity, rx: number, ry: number }[] = [];
  // Separate render buckets for nebula tiles and shards so they always
  // render BELOW asteroids / actors / other entities regardless of their
  // order in currentMap.entities.  Tiles are static (mass = Infinity) and
  // would otherwise take the STRUCTURE fast-path into _visibleEntities;
  // shards are mobile.  Kept in two buckets so the draw order is strictly
  // background-nebula → nebula tiles → nebula shards → everything else.
  // Runtime-spawned nebula tiles (from shard transmutation) get pushed to
  // the end of the entities array, so a naive single-pass loop would
  // render them on top of asteroids.
  private _nebulaTileEntities: { entity: GameEntity, rx: number, ry: number }[] = [];
  private _nebulaShardEntities: { entity: GameEntity, rx: number, ry: number }[] = [];
  private _trailEntities: { entity: GameEntity, rx: number, ry: number }[] = [];
  private _particleBuffer: { entity: GameEntity, rx: number, ry: number }[] = [];
  private _minimapBuffer: { entity: GameEntity, dx: number, dy: number }[] = [];
  private _attractors: GameEntity[] = [];

  // Object pools backing the {entity,rx,ry} render buckets above.  The
  // live arrays are rebuilt every frame; without pooling, each visible
  // entity pushed a fresh `{entity,rx,ry}` literal — thousands per frame
  // in a tile-dense scene (~60-90k small objects/sec), the dominant
  // driver of the periodic GC pauses that show up as tail-frame hitches.
  // Each pool retains every slot it has ever handed out (grows to the
  // high-water visible count, ~1-2k, then never allocates again); the
  // matching live array holds REFERENCES into the pool and is reset via
  // `.length = 0`, which drops the refs but leaves the pooled objects
  // intact for reuse.  `pushSlot` mutates a pooled slot in place instead
  // of allocating.  Consumers read the live arrays unchanged.
  private _visiblePool: { entity: GameEntity, rx: number, ry: number }[] = [];
  private _nebulaTilePool: { entity: GameEntity, rx: number, ry: number }[] = [];
  private _nebulaShardPool: { entity: GameEntity, rx: number, ry: number }[] = [];
  private _trailPool: { entity: GameEntity, rx: number, ry: number }[] = [];
  private _particlePool: { entity: GameEntity, rx: number, ry: number }[] = [];

  /**
   * Append `entity` to a live render bucket by reusing a pooled slot.
   * `live` and `pool` stay index-aligned: the next slot is `pool[live.length]`
   * (created lazily on first use, mutated in place thereafter).  `live` must
   * only be appended via this helper and cleared via `.length = 0`.
   */
  private pushSlot(
    live: { entity: GameEntity, rx: number, ry: number }[],
    pool: { entity: GameEntity, rx: number, ry: number }[],
    entity: GameEntity, rx: number, ry: number,
  ): void {
    const n = live.length;
    let s = pool[n];
    if (s === undefined) { s = { entity, rx, ry }; pool[n] = s; }
    else { s.entity = entity; s.rx = rx; s.ry = ry; }
    live.push(s);
  }

  // ── Pre-rendered static minimap layer ─────────────────────────────────
  // Structures (~22k) don't move, so we render them to an offscreen canvas
  // once on map load and blit the relevant viewport each frame instead of
  // issuing ~22k individual fillRect calls.  The canvas covers the full map
  // at a resolution matched to MINIMAP_CONSTANTS.EXPANDED_SIZE so even the
  // expanded minimap looks sharp.  Dynamic entities (enemies, asteroids,
  // drops) are still drawn per-frame on top of this layer.
  private _minimapStaticCanvas: HTMLCanvasElement | null = null;
  // World-space range captured by the static layer (half-extent from map
  // center).  Stored so renderMinimap can compute the blit source rect
  // without re-reading the map dimensions.
  private _minimapStaticRange: number = 0;

  // ── Static world-tile canvas ───────────────────────────────────────────
  // Pre-bakes the appearance of every cacheable static tile (glass-tile,
  // indestructible-tile) into a single map-sized offscreen canvas at map
  // load.  The per-frame world render blits the visible portion in 1-4
  // drawImage calls instead of issuing one per visible tile — at typical
  // viewports this replaces ~400-800 per-tile drawImage calls per frame
  // with a single multi-quad blit.
  //
  // Tiles enter "slow-path" appearance (glow, hit flash, regen) get
  // erased from the cache on entry and re-stamped on exit so the cache
  // always represents the *base* appearance of every currently-cached
  // tile.  The per-entity render loop's existing slow-path runs on top
  // of the (partially erased) cache, so the visual output is identical
  // to the original per-tile pipeline.
  //
  // Memory budget: max 3072×3072 RGBA → 36 MB.  Scale auto-shrinks for
  // maps larger than that so the canvas always fits the budget.
  private _staticTileCanvas: HTMLCanvasElement | null = null;
  private _staticTileCanvasCtx: CanvasRenderingContext2D | null = null;
  private _staticTileScale: number = 1.0;      // canvas px per world unit
  private _staticTileMapW: number = 0;
  private _staticTileMapH: number = 0;
  // Tiles currently stamped into the cache — used to walk-and-erase
  // any tiles that get deactivated (destroyed) since the last frame.
  // Set is fine here: the per-frame walk runs O(N) in the cached count
  // (typically 200-1000) and only on cache-eligible variants.
  private _staticTileCacheSet: Set<GameEntity> = new Set();
  private readonly STATIC_TILE_MAX_CANVAS_DIM = 3072;

  constructor() {
    this.backgroundManager = new BackgroundManager();
    // Preload basic assets
    Object.values(ASSETS).forEach(src => this.getImage(src));
  }

  // Returns a 12×12 offscreen canvas with a radial-gradient specular dot,
  // matching the (-9,-11,r=5) dot drawn on glass tiles. Created once.
  private getSpecularBitmap(): HTMLCanvasElement {
      if (this._specularBitmap) return this._specularBitmap;
      const c = document.createElement('canvas');
      c.width = 12; c.height = 12;
      const cx = c.getContext('2d')!;
      const spec = cx.createRadialGradient(6, 6, 0, 6, 6, 6);
      spec.addColorStop(0, 'rgba(255,255,255,0.85)');
      spec.addColorStop(1, 'rgba(255,255,255,0)');
      cx.fillStyle = spec;
      cx.beginPath();
      cx.arc(6, 6, 6, 0, Math.PI * 2);
      cx.fill();
      this._specularBitmap = c;
      return c;
  }

  // LOD solid-triangle cache (Step 4).  Keyed by fill colour; a flat
  // opaque filled equilateral triangle blitted for metal shards too small
  // for their polygon detail to read.  Metal shards are equilateral
  // triangles, so the cached silhouette is a triangle (apex-up in local
  // space, matching their spawn polygon) — the per-entity ctx transform
  // applies entity.rotation, so the blit lands at the correct orientation.
  // Bounded like the tinted-sprite cache — the metal palette + density-
  // tier darkening yields only a handful of distinct colours in practice.
  private _solidTriangleBitmaps: Map<string, HTMLCanvasElement> = new Map();

  private getSolidTriangleBitmap(hex: string): HTMLCanvasElement {
      const cached = this._solidTriangleBitmaps.get(hex);
      if (cached) return cached;
      const size = SHARD_LOD_CONSTANTS.DISC_BITMAP_SIZE;
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const cx = c.getContext('2d')!;
      const center = size / 2;
      // Inset by 1px so the triangle's anti-aliased edges aren't clipped
      // by the bitmap bounds when blitted.  Vertices at -90° / 30° / 150°
      // (apex up) match DropSystem's equilateral-triangle spawn polygon.
      const R = center - 1;
      cx.fillStyle = hex;
      cx.beginPath();
      cx.moveTo(center, center - R);
      cx.lineTo(center + R * Math.cos(Math.PI / 6), center + R * Math.sin(Math.PI / 6));
      cx.lineTo(center + R * Math.cos(5 * Math.PI / 6), center + R * Math.sin(5 * Math.PI / 6));
      cx.closePath();
      cx.fill();
      if (this._solidTriangleBitmaps.size >= 64) {
          const firstKey = this._solidTriangleBitmaps.keys().next().value;
          if (firstKey !== undefined) this._solidTriangleBitmaps.delete(firstKey);
      }
      this._solidTriangleBitmaps.set(hex, c);
      return c;
  }

  /**
   * Return a 32×32 offscreen canvas with a soft white star: a radial-gradient
   * glow plus a 4-point spike cross drawn additively.  Created once, reused
   * for every nebula twinkle.  Drawn at NEBULA_CONSTANTS.TWINKLE_STAR_SIZE
   * world-units in the render path.
   */
  private getTwinkleBitmap(): HTMLCanvasElement {
      if (this._twinkleBitmap) return this._twinkleBitmap;
      const size = 32;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const cx = c.getContext('2d')!;
      const mid = size / 2;
      // Additive composite so the glow + spikes blend smoothly
      cx.globalCompositeOperation = 'lighter';
      // Soft radial glow
      const glow = cx.createRadialGradient(mid, mid, 0, mid, mid, mid);
      glow.addColorStop(0,    'rgba(255,255,255,1)');
      glow.addColorStop(0.25, 'rgba(255,255,255,0.55)');
      glow.addColorStop(0.6,  'rgba(255,255,255,0.12)');
      glow.addColorStop(1,    'rgba(255,255,255,0)');
      cx.fillStyle = glow;
      cx.beginPath();
      cx.arc(mid, mid, mid, 0, Math.PI * 2);
      cx.fill();
      // 4-point spike cross — long horizontal + vertical narrow gradients
      const spikeH = cx.createLinearGradient(0, mid, size, mid);
      spikeH.addColorStop(0,    'rgba(255,255,255,0)');
      spikeH.addColorStop(0.5,  'rgba(255,255,255,0.85)');
      spikeH.addColorStop(1,    'rgba(255,255,255,0)');
      cx.fillStyle = spikeH;
      cx.fillRect(0, mid - 0.8, size, 1.6);
      const spikeV = cx.createLinearGradient(mid, 0, mid, size);
      spikeV.addColorStop(0,    'rgba(255,255,255,0)');
      spikeV.addColorStop(0.5,  'rgba(255,255,255,0.85)');
      spikeV.addColorStop(1,    'rgba(255,255,255,0)');
      cx.fillStyle = spikeV;
      cx.fillRect(mid - 0.8, 0, 1.6, size);
      cx.globalCompositeOperation = 'source-over';
      this._twinkleBitmap = c;
      return c;
  }

  /**
   * Return the normalized (range [-0.5, 0.5]) alpha-weighted centroid
   * offset of the image's visible content from its bitmap centre.
   * Computed once per source URL on first call, then cached.
   *
   * Used by the nebula draw path to shift drawImage so the cloud
   * content's visual centre lands on the rotation pivot, eliminating
   * the "orbit around an off-centre point" artefact you'd otherwise
   * see when rotating PNGs whose visible pixels aren't centred.
   *
   * Returns (0, 0) if the image hasn't loaded yet or if getImageData
   * is blocked (e.g. cross-origin canvas taint).  Both cases just fall
   * back to drawing at the geometric bitmap centre — same as before.
   */
  private getSpriteCentroid(src: string): { dx: number, dy: number } {
      const cached = this._spriteCentroids.get(src);
      if (cached) return cached;
      const img = this.getImage(src);
      if (!img.complete || img.naturalWidth === 0) return { dx: 0, dy: 0 };

      // Scan a fixed 256-square render of the source image so the
      // centroid is independent of the natural resolution.  Matches
      // the tinted-sprite canvas size used in getTintedSprite.
      const size = 256;
      const tmp = document.createElement('canvas');
      tmp.width = size;
      tmp.height = size;
      const tctx = tmp.getContext('2d');
      if (!tctx) return { dx: 0, dy: 0 };
      tctx.drawImage(img, 0, 0, size, size);

      let imageData: ImageData;
      try {
          imageData = tctx.getImageData(0, 0, size, size);
      } catch {
          // Canvas tainted — skip centroid adjustment, fall back to centre.
          return { dx: 0, dy: 0 };
      }

      const data = imageData.data;
      let sumX = 0, sumY = 0, sumA = 0;
      for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
              const a = data[(y * size + x) * 4 + 3];
              if (a > 0) {
                  sumX += x * a;
                  sumY += y * a;
                  sumA += a;
              }
          }
      }
      if (sumA === 0) return { dx: 0, dy: 0 };

      const offset = {
          dx: (sumX / sumA / size) - 0.5,
          dy: (sumY / sumA / size) - 0.5,
      };
      this._spriteCentroids.set(src, offset);
      return offset;
  }

  /**
   * Return a canvas of `src` tinted to `hex` using a source-atop pass.
   * Result is cached forever per (src, hex) pair; cache is bounded to ~256
   * entries to avoid unbounded growth when many nebula tiles mix hues.
   * Returns null while the underlying image is still loading.
   *
   * Canvas size is sized to roughly match the largest world draw size
   * the result will be blitted at (≈120 world units for a full nebula
   * tile via NEBULA_CONSTANTS.TILE_SPRITE_WORLD_SIZE).  128² is a 4×
   * reduction over the previous 256² in fillrate, memory, and GC
   * pressure — the source-atop tint pass is the main allocation
   * hot-spot when approaching unseen clusters, since each
   * (cluster-color × neighbour-count) combination demands its own
   * canvas.  Quality cost is minimal because the blit downscales
   * either way.
   */
  private getTintedSprite(src: string, hex: string): HTMLCanvasElement | null {
      const key = `${src}|${hex}`;
      const cached = this._tintedSprites.get(key);
      if (cached) return cached;
      const img = this.getImage(src);
      if (!img.complete || img.naturalWidth === 0) return null;

      const size = 128; // power of 2; matches typical world draw size
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const cx = c.getContext('2d');
      if (!cx) return null;
      cx.drawImage(img, 0, 0, size, size);
      cx.globalCompositeOperation = 'source-atop';
      cx.fillStyle = hex;
      cx.fillRect(0, 0, size, size);
      cx.globalCompositeOperation = 'source-over';

      if (this._tintedSprites.size >= 256) {
          // Evict the oldest entry (Map preserves insertion order) to cap memory.
          const firstKey = this._tintedSprites.keys().next().value;
          if (firstKey !== undefined) this._tintedSprites.delete(firstKey);
      }
      this._tintedSprites.set(key, c);
      return c;
  }

  // Helper to load/get images
  private getImage(src: string): HTMLImageElement {
      if (this.images.has(src)) {
          return this.images.get(src)!;
      }
      const img = new Image();
      img.crossOrigin = "Anonymous"; // Enable CORS for external images
      img.src = src;
      img.onerror = () => {
          // Log once per source to aid debugging missing/blocked assets
          if (!this.images.has(`${src}-error`)) {
              console.warn(`Asset failed to load: ${src}`);
              this.images.set(`${src}-error`, img);
          }
      };
      this.images.set(src, img);
      return img;
  }

  public setContext(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  public setMapType(type: MapType) {
    this.backgroundManager.setMapType(type);
  }

  /**
   * Forward the map's recorded nebula cluster-center positions to the
   * background layer so its puffs render at the same world positions
   * as the interactable tile clusters (one unified cloud, with the
   * backdrop still parallaxing as the camera moves).
   */
  public setNebulaClusterCenters(centers: Vector2[] | null) {
    this.backgroundManager.setNebulaClusterCenters(centers);
  }

  public setNebulaImages(paths: string[]) {
    this.backgroundManager.setNebulaImages(paths);
  }

  /**
   * Pre-render all STRUCTURE entities to an offscreen minimap canvas.
   * Call once on map load.  The canvas covers the full map area at a
   * resolution matched to the expanded minimap display size so the
   * per-frame renderMinimap pass only needs a single drawImage blit
   * instead of ~22k individual fillRect calls.
   */
  public buildMinimapStaticLayer(entities: GameEntity[], mapWidth: number, mapHeight: number) {
      const { EXPANDED_SIZE } = MINIMAP_CONSTANTS;
      // Size the pre-render to cover exactly one wrap unit of the
      // toroidal map.  The per-frame blit (renderMinimap) uses modulo
      // arithmetic against this canvas size, so the canvas extent must
      // equal the map extent — otherwise the modulo wraps at a
      // different boundary than the game's actual wrap seam and the
      // view snaps by the size difference whenever the camera crosses.
      const halfMap = Math.max(mapWidth, mapHeight) / 2;
      const range = halfMap;
      this._minimapStaticRange = range;

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

      this._minimapStaticCanvas = c;
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
  private tileFillColor(entity: GameEntity): string {
    if (entity.shardVariant !== 'metal-tile') return this.materialAutomataColor(entity);
    const f = metalDensityBrightness(entity.densityTier ?? 1);
    if (f === 1) return entity.color;
    if (entity.materialAutomataCachedColor !== undefined) return entity.materialAutomataCachedColor;
    const [r, g, b] = hexToRgb(entity.color);
    const out = rgbToHex(r * f, g * f, b * f);
    entity.materialAutomataCachedColor = out;
    return out;
  }

  private materialAutomataColor(entity: GameEntity): string {
    const factor = this.materialAutomataFactor(entity);
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
  private materialAutomataT(entity: GameEntity): number {
    if (!this.materialAutomataEnabled) return 0;
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
  private materialAutomataFactor(entity: GameEntity): number {
    const v = entity.shardVariant;
    if (v === undefined) return 1;
    const sat = SHARD_VARIANTS[v].automata?.saturationBrightness;
    if (sat === undefined) return 1;
    const t = this.materialAutomataT(entity);
    if (t === 0) return 1;
    return 1 + t * (sat - 1);
  }

  /**
   * Alpha multiplier (1 = unchanged) for the OPACITY automata path —
   * glass-tile, whose translucent face reads interior recession as
   * see-through rather than dim (a brightness multiply just muddies the
   * tint).  1 for variants without a `saturationOpacity` (metal/rock,
   * which use the brightness path).
   *
   * BIPOLAR around the neutral 1.0: a half-surrounded tile
   * (t = 0.5, ~maxNeighbors/2 neighbours) renders at the default
   * opacity — the MIDDLE of the [`saturationOpacity`, 2-`saturationOpacity`]
   * range.  Sparser tiles trend more opaque (up toward 2-sat, clamped
   * at solid by each layer's Math.min(1, …)); dense interiors fade
   * toward `saturationOpacity`.  Callers MUST clamp the final per-layer
   * globalAlpha to ≤1 — canvas silently ignores values outside [0,1].
   */
  private materialAutomataAlpha(entity: GameEntity): number {
    if (!this.materialAutomataEnabled) return 1;
    const v = entity.shardVariant;
    if (v === undefined) return 1;
    const cfg = SHARD_VARIANTS[v].automata;
    if (cfg === undefined || cfg.saturationOpacity === undefined) return 1;
    const count = Math.max(0, entity.materialNeighborCount ?? 0);
    const t = Math.min(1, count / cfg.maxNeighbors);
    return 1 + (0.5 - t) * 2 * (1 - cfg.saturationOpacity);
  }

  /**
   * True for tile variants whose appearance can be pre-baked into the
   * static-tile world canvas.
   *  - glass-tile + indestructible-tile: share the hex-sprite fast path
   *    in renderEntities — cache stamps the same drawImage.
   *
   * Excluded:
   *  - rock-tile: takes per-hit polygon-shrink dents AND accumulates
   *    crack-line damage indicators.  Both need the slow-path render
   *    to reach the live entity state every frame; caching makes both
   *    invisible until the cache happens to invalidate, which has been
   *    a recurring source of visual bugs.  Keeping rock-tile on the
   *    slow path costs a small per-frame draw per visible rock-tile
   *    in exchange for correct, immediate damage feedback.
   *  - nebula-tile: already cached per-entity (tinted sprite cache +
   *    the nebula fast path); world-canvas caching would lose fidelity.
   *  - plastic-tile / metal-tile: selective neighbour-aware outline
   *    rendering requires the spatial-grid neighbour lookup; not worth
   *    the extra complexity for the smaller marginal gain.
   */
  private isStaticTileCacheable(e: GameEntity): boolean {
      return e.type === EntityType.STRUCTURE
          && e.mass === Infinity
          && (e.shardVariant === 'glass-tile'
              || e.shardVariant === 'indestructible-tile');
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
  private overlayMaterialCracks(
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

  /**
   * Variant dispatch for the cache stamp.  Glass-family tiles stamp via
   * the shared hex sprite (matches their renderEntities fast path).
   * Caller has already guaranteed the variant is cache-eligible.
   */
  private stampStaticTileToCache(e: GameEntity): void {
      const cx = this._staticTileCanvasCtx;
      if (!cx) return;
      this.stampHexSpriteTileToCache(cx, e);
  }

  /**
   * Glass/indestructible stamp — the hex sprite drawImage that the
   * per-entity fast path uses, ported to the cache canvas's coordinate
   * system (1 canvas px = 1/scale world units).
   */
  private stampHexSpriteTileToCache(cx: CanvasRenderingContext2D, e: GameEntity): void {
      const baseSprite = this.getImage(ASSETS.HEX_STRUCTURE);
      if (!baseSprite.complete || baseSprite.naturalWidth === 0) return;
      const s = this._staticTileScale;
      const halfMapW = this._staticTileMapW / 2;
      const halfMapH = this._staticTileMapH / 2;
      const wx = (e.position.x + halfMapW) * s;
      const wy = (e.position.y + halfMapH) * s;
      const maxDim = Math.max(e.size.x, e.size.y);
      const drawSize = maxDim * 1.02 * s;
      const dHalf = drawSize / 2;
      // Glass tiles fade the sprite by their neighbour-count automata
      // (opacity path) so dense interiors read see-through against the
      // background — a brightness multiply muddies translucent glass.
      // The reduced alpha bakes straight into the cache pixels, so the
      // single static-layer blit composites the transparency for free.
      // Indestructible (no automata cfg) and edge tiles stamp at 1.0.
      // A count change flips _staticCached false (ShardSystem), forcing
      // this re-stamp.
      const alpha = Math.min(1, this.materialAutomataAlpha(e));
      if (alpha !== 1) cx.globalAlpha = alpha;
      cx.drawImage(baseSprite, wx - dHalf, wy - dHalf, drawSize, drawSize);
      if (alpha !== 1) cx.globalAlpha = 1;
      this.captureStampPolyOnce(e);
      e._staticCached = true;
      this._staticTileCacheSet.add(e);
  }

  /**
   * Rock-tile stamp — replicates the slow-path "polygon fill in
   * entity.color, no outline" branch at the tile's canvas position.
   * Mirrors the densityHex-tinted fill that renderEntities would draw
   * on the main ctx; for cache purposes we use entity.color directly
   * since densityTier transitions invalidate the cache via dent /
   * shatter paths anyway.
   */
  /**
   * Capture the entity's polygonPoints into `_staticStampPoly` on the
   * FIRST cache stamp for this tile, deep-copying so subsequent dent
   * mutations to polygonPoints don't reach back and shrink the stored
   * erase footprint.  The stored polygon is what eraseStaticTileFromCache
   * uses — covers the maximum footprint anything was ever stamped at
   * for this tile, so post-dent or on-death erases never leave a halo
   * of original rim around the now-smaller current polygon.
   */
  private captureStampPolyOnce(e: GameEntity): void {
      if (e._staticStampPoly !== undefined) return;
      const pts = e.polygonPoints;
      if (!pts || pts.length === 0) return;
      const copy: Vector2[] = new Array(pts.length);
      for (let i = 0; i < pts.length; i++) copy[i] = { x: pts[i].x, y: pts[i].y };
      e._staticStampPoly = copy;
  }

  /**
   * Erase a tile's stamped pixels from the world-tile canvas via
   * destination-out compositing.  Always clears regardless of the
   * tile's current `_staticCached` flag — used in three situations:
   *  - fast→slow transitions (tile entered glow / hit flash / regen);
   *  - tile destruction (active flipped false);
   *  - pre-stamp scrub on a transition where polygonPoints may have
   *    been mutated since the last stamp (rock-tile dent).
   *
   * Erases along the polygon outline at exactly 1× the stamp scale.
   * Hex tiles in a grid abut directly — adjacent polygons share an
   * edge, no gap — so any erase polygon LARGER than the stamp would
   * bite into neighbouring cached tiles, leaving transparent wedges
   * around their edges (reads as heavy black outlines on dark
   * backgrounds).  At 1×, the erase covers exactly the stamp's
   * footprint and stops at the shared edge; neighbours stay intact.
   * Tiny anti-aliasing residue at the polygon edge is masked by the
   * slow-path render that paints in that area immediately after.
   *
   * Tiles without polygonPoints fall back to the rect path with a
   * small margin — none today, but defensive.
   */
  private eraseStaticTileFromCache(e: GameEntity): void {
      const cx = this._staticTileCanvasCtx;
      if (!cx) return;
      const s = this._staticTileScale;
      const halfMapW = this._staticTileMapW / 2;
      const halfMapH = this._staticTileMapH / 2;
      const wx = (e.position.x + halfMapW) * s;
      const wy = (e.position.y + halfMapH) * s;
      const prevOp = cx.globalCompositeOperation;
      cx.globalCompositeOperation = 'destination-out';
      cx.fillStyle = '#000';
      // Prefer the polygon captured at first stamp — it covers the
      // maximum footprint anything was ever stamped at for this tile,
      // so post-dent or on-death erases never leave a halo of original
      // rim around the (now smaller) current polygonPoints.  Falls
      // back to current polygon for tiles that somehow reach erase
      // without a first stamp, and finally to a rect for tiles
      // without polygonPoints at all.
      const pts = e._staticStampPoly ?? e.polygonPoints;
      if (pts && pts.length > 0) {
          cx.save();
          cx.translate(wx, wy);
          cx.beginPath();
          cx.moveTo(pts[0].x * s, pts[0].y * s);
          for (let i = 1; i < pts.length; i++) {
              cx.lineTo(pts[i].x * s, pts[i].y * s);
          }
          cx.closePath();
          cx.fill();
          cx.restore();
      } else {
          const maxDim = Math.max(e.size.x, e.size.y);
          const eraseSize = maxDim * 1.1 * s;
          const eHalf = eraseSize / 2;
          cx.fillRect(wx - eHalf, wy - eHalf, eraseSize, eraseSize);
      }
      cx.globalCompositeOperation = prevOp;
      e._staticCached = false;
      this._staticTileCacheSet.delete(e);
  }

  /**
   * Build the static-tile world canvas from scratch.  Called from
   * GameEngine.loadMap right after buildMinimapStaticLayer.  Canvas is
   * sized to cover one full toroidal wrap unit of the map at a scale
   * picked to fit the STATIC_TILE_MAX_CANVAS_DIM budget; on smaller maps
   * the canvas is 1:1 with world coords (zero blur), on larger maps the
   * scale shrinks and the blit upscales (mild blur on close zoom).
   */
  public buildStaticTileLayer(entities: GameEntity[], mapWidth: number, mapHeight: number): void {
      const maxWorld = Math.max(mapWidth, mapHeight);
      let scale = 1.0;
      if (maxWorld * scale > this.STATIC_TILE_MAX_CANVAS_DIM) {
          scale = this.STATIC_TILE_MAX_CANVAS_DIM / maxWorld;
      }
      this._staticTileScale = scale;
      this._staticTileMapW = mapWidth;
      this._staticTileMapH = mapHeight;
      const cW = Math.ceil(mapWidth * scale);
      const cH = Math.ceil(mapHeight * scale);
      const c = document.createElement('canvas');
      c.width = cW;
      c.height = cH;
      const cx = c.getContext('2d');
      if (!cx) { this._staticTileCanvas = null; return; }
      this._staticTileCanvas = c;
      this._staticTileCanvasCtx = cx;
      this._staticTileCacheSet.clear();

      // Hex sprite might still be loading; tiles below will silently skip
      // and the next renderEntities sweep will lazily stamp them once the
      // image completes.  Keeps map-load deterministic without blocking
      // on the asset pipeline.
      const hexSprite = this.getImage(ASSETS.HEX_STRUCTURE);
      const hexReady = hexSprite.complete && hexSprite.naturalWidth > 0;

      for (let i = 0; i < entities.length; i++) {
          const e = entities[i];
          if (!e.active || !this.isStaticTileCacheable(e)) {
              e._staticCached = false;
              continue;
          }
          if (!hexReady) { e._staticCached = false; continue; }
          this.stampStaticTileToCache(e);
      }
  }

  /**
   * Blit the pre-baked static-tile canvas into the current camera-local
   * world frame.  Called inside renderEntities's camera transform so
   * world coords map straight to screen.  Handles toroidal wrap by
   * always drawing 4 wrap-offset copies — most will fall outside the
   * scissor rect and become near-noop GPU blits, so this is cheaper
   * than computing which copies are needed every frame.
   */
  private blitStaticTileLayer(ctx: CanvasRenderingContext2D): void {
      const canvas = this._staticTileCanvas;
      if (!canvas) return;
      const mapW = this._staticTileMapW;
      const mapH = this._staticTileMapH;
      const x0 = -mapW / 2;
      const y0 = -mapH / 2;
      ctx.drawImage(canvas, x0,        y0,        mapW, mapH);
      ctx.drawImage(canvas, x0 + mapW, y0,        mapW, mapH);
      ctx.drawImage(canvas, x0 - mapW, y0,        mapW, mapH);
      ctx.drawImage(canvas, x0,        y0 + mapH, mapW, mapH);
      ctx.drawImage(canvas, x0,        y0 - mapH, mapW, mapH);
      ctx.drawImage(canvas, x0 + mapW, y0 + mapH, mapW, mapH);
      ctx.drawImage(canvas, x0 - mapW, y0 - mapH, mapW, mapH);
      ctx.drawImage(canvas, x0 + mapW, y0 - mapH, mapW, mapH);
      ctx.drawImage(canvas, x0 - mapW, y0 + mapH, mapW, mapH);
  }

  /**
   * Pre-frame pass that resolves fast↔slow appearance transitions BEFORE
   * the static-tile canvas is blitted into the world frame.  Without
   * this pass, a tile entering its glow / hit flash window would draw
   * its slow-path overlay on top of the cache's still-present base
   * appearance for one frame — a brief one-frame brightening glitch.
   *
   * Walks `_visibleEntities` (the camera-culled candidate list already
   * built by renderEntities's caller in prepareFrameEntities) and, for
   * each cacheable static tile, decides whether the cache stamp should
   * be present and transitions if it isn't.  Off-screen tiles can't
   * cause this glitch (the player can't see them) so we don't bother
   * walking the master list.
   */
  private prepareStaticTileCacheForFrame(playerPos: Vector2 | undefined): void {
      if (!this._staticTileCanvas) return;
      const entries = this._visibleEntities;
      let stampBudget = STATIC_TILE_STAMPS_PER_FRAME;
      for (let i = 0; i < entries.length; i++) {
          const entity = entries[i].entity;
          if (!this.isStaticTileCacheable(entity)) continue;
          // Reproduce the fast-path acceptance check used in renderEntities
          // so a tile that's about to take the slow path gets erased now,
          // before the canvas blit paints its stale base.  Glass tiles
          // also brighten on contact via repelImpulse — same gate as the
          // existing fast-path branch.
          let inGlowRange = false;
          if (entity.shardVariant === 'glass-tile') {
              inGlowRange = (entity.repelImpulse ?? 0) > 0;
          } else if (playerPos && entity.shardVariant !== undefined) {
              const g = SHARD_VARIANTS[entity.shardVariant].glow;
              if (g !== undefined) {
                  const fpdx = wrapDeltaX(entity.position.x, playerPos.x);
                  const fpdy = wrapDeltaY(entity.position.y, playerPos.y);
                  inGlowRange = fpdx * fpdx + fpdy * fpdy < g.range * g.range;
              }
          }
          const wantsCache = entity.active
              && !entity.hitFlash
              && entity.regenPopTimer === undefined
              && !inGlowRange;
          if (wantsCache && entity._staticCached !== true) {
              // BUDGETED (see STATIC_TILE_STAMPS_PER_FRAME): stamping is a
              // clearRect + drawImage on a map-sized offscreen canvas, and
              // this loop used to do as many as were pending — so a moment
              // where many tiles became cacheable at once (sprite load, a
              // wave of regen) cost 40-45ms of render in ONE frame.  Skipping
              // a stamp is not a visual change: the tile just renders through
              // the normal per-entity path this frame, exactly as it does
              // until it gets stamped.
              if (stampBudget > 0) {
                  stampBudget--;
                  // Pre-scrub the stamp area in case polygonPoints was
                  // mutated since the last stamp (rock-tile dent) — without
                  // this the new (smaller) polygon paints inside the old
                  // outline, leaving a halo of stale pixels around the dent.
                  this.eraseStaticTileFromCache(entity);
                  this.stampStaticTileToCache(entity);
              }
          } else if (!wantsCache && entity._staticCached === true) {
              this.eraseStaticTileFromCache(entity);
          }
      }
  }

  /**
   * Sync the static-tile cache against any tile-destruction events that
   * happened since the last frame.  Called at the top of render() so
   * stale tiles don't linger as ghost stamps after the gameplay state
   * removes them.  Cheap: only walks tiles currently in the cache.
   */
  private syncStaticTileCacheAgainstDeaths(): void {
      if (this._staticTileCacheSet.size === 0) return;
      // Collect first to avoid mutating set while iterating.
      let dead: GameEntity[] | null = null;
      for (const e of this._staticTileCacheSet) {
          // Evict on death OR when a tile stops being static (mass goes finite —
          // e.g. the dragon eating it into a body segment) so no ghost is left.
          if (!e.active || e.mass !== Infinity) {
              if (dead === null) dead = [];
              dead.push(e);
          }
      }
      if (dead) {
          for (let i = 0; i < dead.length; i++) this.eraseStaticTileFromCache(dead[i]);
      }
  }

  public render(
    entities: GameEntity[],
    camera: CameraState,
    mapType: MapType,
    minimapExpanded: boolean = false,
    damageTexts?: DamageText[],
    playerPos?: Vector2,
    playerMessages?: PlayerHUDMessage[],
    player?: GameEntity,
    waveAnnouncements?: WaveAnnouncement[],
    flowOverlay?: FlowOverlayState,
  ) {
    const t0 = performance.now();
    if (!this.ctx) { this.lastRenderMs = performance.now() - t0; return; }
    const ctx = this.ctx;
    const dpr = effectiveDpr();
    const width = (ctx.canvas.width || 0) / dpr;
    const height = (ctx.canvas.height || 0) / dpr;

    // Crisp pixels for sprite scaling
    ctx.imageSmoothingEnabled = false;

    // Guard against 0 dimensions
    if (width === 0 || height === 0) return;

    // Build per-frame buckets in a single pass
    this._attractors.length = 0;
    this._visibleEntities.length = 0;
    this._nebulaTileEntities.length = 0;
    this._nebulaShardEntities.length = 0;
    this._trailEntities.length = 0;
    this._particleBuffer.length = 0;
    this._indicatorBuffer.length = 0;
    this._minimapBuffer.length = 0;

    const halfW = (width / 2) / camera.zoom;
    const halfH = (height / 2) / camera.zoom;
    const cullMargin = CAMERA_CONSTANTS.CULL_MARGIN;
    const left = camera.position.x - halfW - cullMargin;
    const right = camera.position.x + halfW + cullMargin;
    const top = camera.position.y - halfH - cullMargin;
    const bottom = camera.position.y + halfH + cullMargin;

    const camX = camera.position.x;
    const camY = camera.position.y;

    for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];

        // Toroidal shift: compute the render position in the camera's
        // local wrap zone so an entity near a seam draws at the correct
        // on-screen spot instead of ~MAP_WIDTH off to the side.
        const rx = shiftX(camX, entity.position.x);
        const ry = shiftY(camY, entity.position.y);

        // ── Fast-path STRUCTURE ──────────────────────────────────────
        // Structures (~22k per map) never participate in the attractor /
        // indicator / minimap / trail buffers, and the minimap is now a
        // pre-rendered static layer.  Skip all the per-entity bucket
        // checks and just frustum-cull → visible push.  This keeps the
        // off-screen-tile cost to ~5 ops per entity instead of ~17.
        // Stage 5: only STATIC tiles get the special STRUCTURE path
        // (no minimap / trail / indicator buckets).  Mobile shards
        // (STRUCTURE+finite-mass) need the same buckets as asteroids
        // — fall through to the generic dispatch below.
        if (entity.type === EntityType.STRUCTURE && entity.mass === Infinity) {
            const isRegen = entity.regenProgress !== undefined;
            if (!entity.active && !isRegen) continue;
            if (rx < left || rx > right || ry < top || ry > bottom) continue;
            // Nebula tiles are static (mass = Infinity) but must render in
            // the dedicated bottom layer, not the main entity layer.
            if (entity.shardVariant === 'nebula-tile') {
                this.pushSlot(this._nebulaTileEntities, this._nebulaTilePool, entity, rx, ry);
            } else {
                this.pushSlot(this._visibleEntities, this._visiblePool, entity, rx, ry);
            }
            continue;
        }

        // Allow inactive tiles that are regenerating to pass through for ghost rendering
        if (!entity.active) continue;

        const dx = rx - camX;
        const dy = ry - camY;

        if (entity.type === EntityType.INTERACTABLE && entity.gravityStrength && entity.gravityStrength > 500) {
            this._attractors.push(entity);
        }

        // Off-screen indicator arrows — for enemies and non-drop POIs.  Gnats
        // (diesOnContact, Swarm) are EXCLUDED: a cloud of them would crowd the
        // screen with arrows and they aren't threats the player needs steering
        // toward; the minimap still shows them for finding stragglers.
        // Bubbles ARE included (purple, blinking red once they hunt you) under
        // their own small MAX_VISIBLE_BUBBLE budget, so ambient fauna can never
        // starve the enemy arrows.
        if ((entity.type === EntityType.ENEMY && entity.diesOnContact !== true)
                || (entity.type === EntityType.INTERACTABLE && !entity.dropType && !entity.isSnitch)) {
            // Enemies are range-UNLIMITED here (live count is capped by the
            // wave concurrency cap): the maps are big and the chevrons are
            // how the player finds the stragglers.  renderIndicators fades
            // far chevrons instead of culling them.
            const distSq = dx*dx + dy*dy;
            // Whether the entity is currently within the true (unpadded)
            // viewport — its half-size lets an entity peeking in at the edge
            // count as visible.  renderIndicators uses this to suppress the
            // (redundant) chevron for on-screen entities when the DBG
            // "Chevrons: Offscreen" mode is on.
            const halfSize = Math.max(entity.size.x, entity.size.y) * 0.5;
            const onScreen = rx >= camX - halfW - halfSize && rx <= camX + halfW + halfSize
                          && ry >= camY - halfH - halfSize && ry <= camY + halfH + halfSize;
            // Map portals are RANGE-GATED (roadmap step (k)): a rift is a
            // fixed landmark, so a chevron for one across the map is noise
            // rather than navigation.  Gate the INDICATOR only — the portal
            // keeps its minimap dot at every distance (the pushes below are
            // deliberately left alone).
            const farPortal = entity.isPortal === true
                && distSq > PORTAL_CONSTANTS.INDICATOR_RANGE * PORTAL_CONSTANTS.INDICATOR_RANGE;
            if (!farPortal) this._indicatorBuffer.push({ entity, distSq, onScreen });
        }

        // Structures use the pre-rendered static minimap layer — skip them
        // here to avoid ~22k per-frame object allocations + fillRect calls.
        if (entity.type !== EntityType.PLAYER && entity.type !== EntityType.PROJECTILE && entity.type !== EntityType.PARTICLE
                && entity.shardVariant !== 'nebula-tile' && entity.shardVariant !== 'nebula-shard'
                && !(entity.type === EntityType.INTERACTABLE && entity.dropType)) {
            this._minimapBuffer.push({ entity, dx, dy });
        }

        if (rx < left || rx > right || ry < top || ry > bottom) {
            continue;
        }

        // Particles go to a separate buffer for single-pass 'lighter' composite rendering
        if (entity.type === EntityType.PARTICLE) {
            this.pushSlot(this._particleBuffer, this._particlePool, entity, rx, ry);
        } else if (entity.shardVariant === 'nebula-shard') {
            // Mobile nebula shards render in the dedicated bottom layer,
            // above nebula tiles but below all other entities.  (Static
            // nebula tiles are routed to their own bucket in the
            // STRUCTURE fast-path above.)
            this.pushSlot(this._nebulaShardEntities, this._nebulaShardPool, entity, rx, ry);
        } else if (entity.shardVariant === 'nebula-tile') {
            // Defensive: a nebula tile that ever has finite mass still
            // belongs in the tile layer, never the main entity layer.
            this.pushSlot(this._nebulaTileEntities, this._nebulaTilePool, entity, rx, ry);
        } else {
            this.pushSlot(this._visibleEntities, this._visiblePool, entity, rx, ry);
        }

        // Player trail = independent expanding rings (one is enough to draw);
        // projectile trail = polygon strip (needs at least two points).
        // The snitch's comet tail rides the projectile-strip path in gold.
        if (entity.trail && entity.trail.length > 0
                && (entity.type === EntityType.PLAYER || entity.type === EntityType.PROJECTILE || entity.isSnitch)) {
            this.pushSlot(this._trailEntities, this._trailPool, entity, rx, ry);
        }
    }

    // Snapshot the visible-nebula count after the cull bucket is built
    // so the dev overlay can report it alongside the nebula sub-timer.
    this.lastNebulaVisible = this._nebulaTileEntities.length + this._nebulaShardEntities.length;
    // Reset the per-frame fast/slow split — incremented inside
    // renderEntities below as each nebula entity is dispatched.
    this.lastNebulaFastCount = 0;
    this.lastNebulaSlowCount = 0;
    // Reset tile-lighting accumulator — populated at every static-tile
    // bloom call site (material-tile branch, glass-family branch's
    // indestructible path, asteroid/shard branch's rock-tile path).
    this.lastTileLightingMs = 0;
    this.lastTileLightingCount = 0;
    this.lastLodShardCount = 0;

    // Sort indicators once for the frame — NEAREST FIRST, so the per-type
    // budgets in renderIndicators keep the closest contacts (they used to be
    // sorted farthest-first, which spent the budget on distant stragglers and
    // culled the ones actually bearing down on the player).
    this._indicatorBuffer.sort((a, b) => a.distSq - b.distSq);

    // Drop any tiles from the static cache that died since the previous
    // frame so we don't paint a ghost copy from the pre-baked canvas.
    this.syncStaticTileCacheAgainstDeaths();

    // 1. Clear & Background
    ctx.clearRect(0, 0, width, height);
    
    // Pass attractors and ZOOM to background for star warping
    this.backgroundManager.render(ctx, camera.position, this._attractors, camera.zoom);

    // 2. Camera Transform
    ctx.save();
    
    // Center camera
    ctx.translate(width / 2, height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    if (Number.isFinite(camera.position.x) && Number.isFinite(camera.position.y)) {
        // Apply position AND Shake Offset
        ctx.translate(
            -camera.position.x + (camera.shakeOffset ? camera.shakeOffset.x : 0), 
            -camera.position.y + (camera.shakeOffset ? camera.shakeOffset.y : 0)
        );
    }

    // 3. Render Nebulas (bottom layer).  Strict order: nebula tiles
    // first, then nebula shards on top of them, so the whole cloud sits
    // behind every other entity type (and their trails) regardless of
    // entity array order.  Wrapped in its own performance.now() bracket
    // so the dev overlay can show nebula-pass cost separately from total
    // render time.
    const tNebula0 = performance.now();
    this.renderEntities(ctx, this._nebulaTileEntities, camera, playerPos);
    this.renderEntities(ctx, this._nebulaShardEntities, camera, playerPos);
    this.lastNebulaMs = performance.now() - tNebula0;

    // 4. Render Trails — above the nebula layer but behind the main
    // entities, so a ship/projectile trail crossing a nebula cloud stays
    // visible on top of it instead of vanishing underneath.
    this.renderTrails(ctx, this._trailEntities, camera);

    // 4a₀. Pre-baked static-tile canvas blit.  Replaces ~400-800 per-tile
    // drawImage calls below with at most 9 wrap-aware blits.  Tiles whose
    // appearance is currently in the cache will skip their per-entity
    // draw in renderEntities; tiles with slow-path overlays (glow, hit
    // flash, regen) will have been erased from the cache and rendered
    // via the existing per-entity slow path on top of the blit.
    //
    // Resolve any pending fast↔slow appearance transitions on visible
    // cacheable tiles BEFORE the blit, so the canvas state matches
    // what each tile actually needs this frame — prevents the 1-frame
    // double-paint a same-frame transition would otherwise produce.
    this.prepareStaticTileCacheForFrame(playerPos);
    this.blitStaticTileLayer(ctx);

    // 4a. Render Entities (Culling logic added).  Stage 6: dragon body segments
    // are real tile-variant STRUCTURE entities, so they render here like any
    // tile (no dedicated pass).
    this.renderEntities(ctx, this._visibleEntities, camera, playerPos);

    // 4b. Render Particles — single composite-op switch for the whole batch
    this.renderParticles(ctx, this._particleBuffer, camera);

    // 5. Render Damage Text (World Space)
    if (damageTexts) {
        this.renderDamageTexts(ctx, damageTexts, camera);
    }

    // 5b. DBG asteroid/shard FF overlays — world-space, gated on the
    // toggles passed in from GameEngine.draw().  All cheap no-ops when
    // every toggle is off (the common case during normal play).
    if (flowOverlay && this.flowField &&
        (flowOverlay.vectors || flowOverlay.cells ||
         flowOverlay.obstacles || flowOverlay.rebuilds)) {
        this.renderFlowFieldOverlay(ctx, camera, flowOverlay);
    }

    ctx.restore();

    // 5c. Render Wave Announcements (Screen Space, above game entities)
    if (waveAnnouncements && waveAnnouncements.length > 0) {
        this.renderWaveAnnouncements(ctx, waveAnnouncements, width, height);
    }

    // 6. Render POI Indicators (Screen Space)
    this.renderIndicators(ctx, this._indicatorBuffer, camera, width, height);

    // 7. Render Minimap (Screen Space)
    this.renderMinimap(ctx, this._minimapBuffer, camera, width, height, minimapExpanded, mapType);

    // 8. Render Player HUD messages (Screen Space)
    if (playerMessages && playerMessages.length > 0) {
        this.renderPlayerMessages(ctx, playerMessages, width, height);
    }

    // 8b. Interaction prompt AT THE SHIP (screen space).  The control is
    // "select your ship", so the instruction belongs on the ship rather than
    // only in a HUD pill at the bottom of the screen — the player is already
    // looking here.  Drawn just under the hull, outlined so it survives bright
    // terrain.  `interactPrompt` is stamped per step by
    // GameEngine.updateInteractables and cleared the moment nothing is in range.
    if (player?.interactPrompt) {
        const px = this.worldToScreen(camera, player.position);
        if (px) {
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const y = px.y + 46;
            ctx.font = 'bold 11px monospace';
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(0,0,0,0.85)';
            ctx.strokeText(player.interactPrompt, px.x, y);
            ctx.fillStyle = '#e2e8f0';
            ctx.fillText(player.interactPrompt, px.x, y);
            ctx.restore();
        }
    }

    // 9. Render 2-slot loadout HUD (Screen Space)
    if (player) {
        this.renderLoadoutHUD(ctx, player, width, height);
    }

    this.lastRenderMs = performance.now() - t0;
  }

  /**
   * Draw the DBG asteroid/shard FF overlays inside the world-space
   * camera transform.  Three independent layers (cells / obstacles /
   * rebuilds) plus the vector arrow pass — each gated on its own
   * toggle so the user can isolate the view.
   *
   * Allocation discipline: no per-cell object creation; all draws go
   * through ctx primitives + per-cell scalar reads from typed arrays.
   * Cell count is small (576 on the default 6 k map), so iterating
   * every cell every frame is cheap even before frustum culling.
   *
   * Pursuit-field overlays are intentionally not rendered — this pass
   * only reads asteroid-flow state.
   */
  private renderFlowFieldOverlay(
      ctx: CanvasRenderingContext2D,
      camera: CameraState,
      state: FlowOverlayState,
  ) {
      const f = this.flowField;
      if (!f) return;
      const cellSize = f.cellSize;
      const cols = f.cols;
      const rows = f.rows;
      const minX = f.minX;
      const minY = f.minY;
      const blocked = f.blockedView;
      const flowX = f.astFlowXView;
      const flowY = f.astFlowYView;
      const rebuildTs = f.astRebuildTsView;
      const now = performance.now();
      const camX = camera.position.x;
      const camY = camera.position.y;

      // Frustum bounds in world coords — used to skip cells fully off-
      // screen and avoid drawing the whole grid every frame on small
      // viewports.  Half-extents include a one-cell margin so cells
      // straddling the edge still draw.
      const zoom = camera.zoom || 1;
      const halfW = (ctx.canvas.width  / effectiveDpr()) / 2 / zoom;
      const halfH = (ctx.canvas.height / effectiveDpr()) / 2 / zoom;
      const viewMargin = cellSize;
      const viewLeft   = camX - halfW - viewMargin;
      const viewRight  = camX + halfW + viewMargin;
      const viewTop    = camY - halfH - viewMargin;
      const viewBottom = camY + halfH + viewMargin;

      ctx.save();
      // Thin strokes scale to roughly 1 px regardless of zoom so cell
      // outlines stay legible at any zoom level.
      const stroke = 1 / zoom;

      // ── Obstacle tint (drawn first so cell/arrow layers overlay it)
      if (state.obstacles) {
          ctx.fillStyle = 'rgba(248, 113, 113, 0.22)'; // red-400 @ ~22 %
          for (let row = 0; row < rows; row++) {
              const cy = minY + (row + 0.5) * cellSize;
              const sy = shiftY(camY, cy);
              if (sy < viewTop || sy > viewBottom) continue;
              for (let col = 0; col < cols; col++) {
                  const idx = row * cols + col;
                  if (!blocked[idx]) continue;
                  const cx = minX + (col + 0.5) * cellSize;
                  const sx = shiftX(camX, cx);
                  if (sx < viewLeft || sx > viewRight) continue;
                  ctx.fillRect(
                      sx - cellSize / 2, sy - cellSize / 2,
                      cellSize, cellSize,
                  );
              }
          }
      }

      // ── Rebuild flash (decays linearly over FF_REBUILD_FLASH_MS)
      if (state.rebuilds) {
          for (let row = 0; row < rows; row++) {
              const cy = minY + (row + 0.5) * cellSize;
              const sy = shiftY(camY, cy);
              if (sy < viewTop || sy > viewBottom) continue;
              for (let col = 0; col < cols; col++) {
                  const idx = row * cols + col;
                  const age = now - rebuildTs[idx];
                  if (age < 0 || age > FF_REBUILD_FLASH_MS) continue;
                  const cx = minX + (col + 0.5) * cellSize;
                  const sx = shiftX(camX, cx);
                  if (sx < viewLeft || sx > viewRight) continue;
                  const alpha = 0.55 * (1 - age / FF_REBUILD_FLASH_MS);
                  ctx.fillStyle = `rgba(250, 204, 21, ${alpha.toFixed(3)})`; // amber-400
                  ctx.fillRect(
                      sx - cellSize / 2, sy - cellSize / 2,
                      cellSize, cellSize,
                  );
              }
          }
      }

      // ── Cell outlines
      if (state.cells) {
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.30)'; // slate-400 @ 30 %
          ctx.lineWidth = stroke;
          ctx.beginPath();
          for (let row = 0; row < rows; row++) {
              const cy = minY + (row + 0.5) * cellSize;
              const sy = shiftY(camY, cy);
              if (sy < viewTop || sy > viewBottom) continue;
              for (let col = 0; col < cols; col++) {
                  const cx = minX + (col + 0.5) * cellSize;
                  const sx = shiftX(camX, cx);
                  if (sx < viewLeft || sx > viewRight) continue;
                  ctx.rect(
                      sx - cellSize / 2, sy - cellSize / 2,
                      cellSize, cellSize,
                  );
              }
          }
          ctx.stroke();
      }

      // ── Vector arrows.  Arrow length = ~70 % of cell size; head is
      // 2 short strokes off the tip.  Per-arrow `strokeStyle` updates
      // are unavoidable for the magnitude tint, but the underlying draw
      // is just lineTo / stroke — no allocations.
      if (state.vectors) {
          const stride = Math.max(1, state.sampleN | 0);
          const armLen = cellSize * 0.35;
          const headLen = cellSize * 0.12;
          ctx.lineWidth = stroke * 1.4;
          ctx.lineCap = 'round';
          for (let row = 0; row < rows; row += stride) {
              const cy = minY + (row + 0.5) * cellSize;
              const sy = shiftY(camY, cy);
              if (sy < viewTop || sy > viewBottom) continue;
              for (let col = 0; col < cols; col += stride) {
                  const idx = row * cols + col;
                  if (blocked[idx]) continue;
                  const vx = flowX[idx];
                  const vy = flowY[idx];
                  const mag = Math.sqrt(vx * vx + vy * vy);
                  if (mag < 0.001) continue;
                  const cx = minX + (col + 0.5) * cellSize;
                  const sx = shiftX(camX, cx);
                  if (sx < viewLeft || sx > viewRight) continue;
                  // Vectors should always be unit length out of the
                  // grid, so `mag` is ~1 in practice; we still gate
                  // the colour ramp on `mag` so any future non-unit
                  // values still render usefully.  Cool→hot tint:
                  // sky-300 → amber-300.
                  const t = Math.min(1, mag);
                  const r = Math.round(125 + (252 - 125) * t);
                  const g = Math.round(211 + (211 - 211) * t);
                  const b = Math.round(252 + ( 77 - 252) * t);
                  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.85)`;
                  const tipX = sx + (vx / mag) * armLen;
                  const tipY = sy + (vy / mag) * armLen;
                  ctx.beginPath();
                  ctx.moveTo(sx - (vx / mag) * armLen * 0.4, sy - (vy / mag) * armLen * 0.4);
                  ctx.lineTo(tipX, tipY);
                  // Head: two short strokes at ±35° off the tail vector
                  const hx = vx / mag;
                  const hy = vy / mag;
                  // Rotate (hx, hy) by ±150° to get the head barbs.
                  // cos(150) ≈ -0.866, sin(150) = 0.5
                  const cosA = -0.866, sinA = 0.5;
                  const bx1 = hx * cosA - hy * sinA;
                  const by1 = hx * sinA + hy * cosA;
                  const bx2 = hx * cosA - hy * -sinA;
                  const by2 = hx * -sinA + hy * cosA;
                  ctx.moveTo(tipX, tipY);
                  ctx.lineTo(tipX + bx1 * headLen, tipY + by1 * headLen);
                  ctx.moveTo(tipX, tipY);
                  ctx.lineTo(tipX + bx2 * headLen, tipY + by2 * headLen);
                  ctx.stroke();
              }
          }
      }

      ctx.restore();
  }

  private renderTrails(
      ctx: CanvasRenderingContext2D,
      entries: { entity: GameEntity, rx: number, ry: number }[],
      camera: CameraState,
  ) {
      entries.forEach(({ entity }) => {
          if (!entity.active || !entity.trail || entity.trail.length < 1) return;
          if (entity.type === EntityType.PLAYER) {
              if (this.trailShape === TrailShape.NONE) return;
              this.drawPlayerTrail(ctx, entity.trail, camera);
          } else if ((entity.type === EntityType.PROJECTILE || entity.isSnitch) && entity.trail.length >= 2) {
              // Snitch comet tail reuses the projectile strip — entity.color
              // is the snitch's gold core colour.
              this.drawTrailStrip(ctx, entity.trail, 'projectile', camera, entity.color, entity.isBouncer);
          }
      });
  }

  // Player trail: each TrailPoint renders as a stroked shape that grows from
  // START_RADIUS to END_RADIUS over its lifetime while alpha fades to zero.
  // Shape is selected from the debug panel (CIRCLE / SQUARE / TRIANGLE / LINE
  // / PATH); NONE is filtered out earlier so we never enter this method for it.
  private drawPlayerTrail(
      ctx: CanvasRenderingContext2D,
      t: TrailPoint[],
      camera: CameraState,
  ) {
      const camX = camera.position.x;
      const camY = camera.position.y;
      const startR = PLAYER_TRAIL_CONSTANTS.START_RADIUS;
      const endR   = PLAYER_TRAIL_CONSTANTS.END_RADIUS;
      const peak   = PLAYER_TRAIL_CONSTANTS.PEAK_ALPHA;
      const color  = PLAYER_TRAIL_CONSTANTS.COLOR;
      const shape  = this.trailShape;

      ctx.lineWidth = PLAYER_TRAIL_CONSTANTS.LINE_WIDTH;

      // PATH: single polyline through every emitted point — a continuous
      // breadcrumb of the player's recent path rather than per-point shapes.
      if (shape === TrailShape.PATH) {
          this.drawPlayerTrailPath(ctx, t, camX, camY, color, peak);
          return;
      }
      for (let i = 0; i < t.length; i++) {
          const p = t[i];
          if (p.maxLifetime <= 0 || p.lifetime <= 0) continue;
          const ratio = p.lifetime / p.maxLifetime; // 1 at birth → 0 at death
          const age = 1 - ratio;
          const radius = startR + (endR - startR) * age;
          const alpha = peak * ratio;
          const sx = shiftX(camX, p.x);
          const sy = shiftY(camY, p.y);
          ctx.strokeStyle = `rgba(${color}, ${alpha})`;

          switch (shape) {
              case TrailShape.CIRCLE: {
                  ctx.beginPath();
                  ctx.arc(sx, sy, radius, 0, Math.PI * 2);
                  ctx.stroke();
                  break;
              }
              case TrailShape.SQUARE: {
                  // Axis-aligned square inscribed in the same radius envelope
                  const d = radius * 2;
                  ctx.strokeRect(sx - radius, sy - radius, d, d);
                  break;
              }
              case TrailShape.TRIANGLE: {
                  // Equilateral triangle pointing along the emit-time velocity
                  // vector so it visually streams in the direction of travel.
                  const ang = p.angle ?? 0;
                  const cos = Math.cos(ang);
                  const sin = Math.sin(ang);
                  // Tip in front, two base corners behind ±120°
                  const tipX = sx + cos * radius;
                  const tipY = sy + sin * radius;
                  const back = -radius * 0.5;
                  const side = radius * 0.866; // sin(60°)
                  const blX = sx + cos * back - sin * side;
                  const blY = sy + sin * back + cos * side;
                  const brX = sx + cos * back + sin * side;
                  const brY = sy + sin * back - cos * side;
                  ctx.beginPath();
                  ctx.moveTo(tipX, tipY);
                  ctx.lineTo(blX, blY);
                  ctx.lineTo(brX, brY);
                  ctx.closePath();
                  ctx.stroke();
                  break;
              }
              case TrailShape.LINE: {
                  // Straight line perpendicular to travel direction, growing
                  // outward from the centre — reads as a wake bar dropped
                  // behind the ship.
                  const ang = (p.angle ?? 0) + Math.PI / 2;
                  const cos = Math.cos(ang);
                  const sin = Math.sin(ang);
                  ctx.beginPath();
                  ctx.moveTo(sx - cos * radius, sy - sin * radius);
                  ctx.lineTo(sx + cos * radius, sy + sin * radius);
                  ctx.stroke();
                  break;
              }
              case TrailShape.DOTS: {
                  // Filled dot at fixed START_RADIUS — does not expand;
                  // only alpha fades over lifetime.
                  ctx.fillStyle = `rgba(${color}, ${alpha})`;
                  ctx.beginPath();
                  ctx.arc(sx, sy, startR, 0, Math.PI * 2);
                  ctx.fill();
                  break;
              }
          }
      }
  }

  // Continuous polyline through every active trail point.  Each segment is
  // stroked individually with alpha driven by the *older* endpoint's own
  // lifetime ratio so the tail segment fades to zero just before its
  // source point is culled (otherwise the path would lose whole segments
  // at full opacity every EMIT_INTERVAL and read as choppy).  The ratio
  // is squared so the fade is visible mid-trail during continuous thrust,
  // not just near the disappearing tail.  Segments are skipped when:
  //   • the newer point is flagged chainStart (thrust restart — old chain
  //     should keep fading on its own, no bridge to the new chain), or
  //   • consecutive shifted points straddle a wrap seam.
  // (Earlier revisions added a 50-u distance defense-in-depth threshold,
  // but THRUST mode drifts each point in -input direction over its
  // lifetime, which legitimately produces consecutive-point gaps larger
  // than 50 u at low throttle — the threshold then incorrectly killed
  // every PATH segment.  chainStart is reliably latched until consumed,
  // so the distance fallback is no longer pulling its weight.)
  private drawPlayerTrailPath(
      ctx: CanvasRenderingContext2D,
      t: TrailPoint[],
      camX: number,
      camY: number,
      color: string,
      peak: number,
  ) {
      if (t.length < 2) return;

      const SEAM_BREAK_SQ = (HALF_MAP_WIDTH * 0.5) * (HALF_MAP_WIDTH * 0.5);
      let prevX = shiftX(camX, t[0].x);
      let prevY = shiftY(camY, t[0].y);
      for (let i = 1; i < t.length; i++) {
          const cx = shiftX(camX, t[i].x);
          const cy = shiftY(camY, t[i].y);
          const dx = cx - prevX;
          const dy = cy - prevY;
          const seamSpan = dx * dx + dy * dy > SEAM_BREAK_SQ;
          if (!seamSpan && !t[i].chainStart) {
              const p0 = t[i - 1];
              const r0 = p0.maxLifetime > 0 ? Math.max(0, Math.min(1, p0.lifetime / p0.maxLifetime)) : 0;
              if (r0 > 0) {
                  // Squared ratio biases more of the fade toward the head
                  // half of the trail so the gradient reads even while
                  // new points are constantly being emitted.
                  ctx.strokeStyle = `rgba(${color}, ${peak * r0 * r0})`;
                  ctx.beginPath();
                  ctx.moveTo(prevX, prevY);
                  ctx.lineTo(cx, cy);
                  ctx.stroke();
              }
          }
          prevX = cx;
          prevY = cy;
      }
  }

  // Reusable scratch buffers for shifted trail coordinates and per-point
  // edge normals — keeps trail rendering allocation-free even when every
  // projectile in the scene is drawing a 30-point trail.  The normal
  // buffers eliminate the duplicate sqrt+div pair that the forward and
  // backward strip passes previously each performed on the same data.
  private _trailShiftedX: Float32Array = new Float32Array(64);
  private _trailShiftedY: Float32Array = new Float32Array(64);
  private _trailNX: Float32Array = new Float32Array(64);
  private _trailNY: Float32Array = new Float32Array(64);
  private _ensureTrailScratch(n: number) {
      if (this._trailShiftedX.length < n) {
          const next = Math.max(n, this._trailShiftedX.length * 2);
          this._trailShiftedX = new Float32Array(next);
          this._trailShiftedY = new Float32Array(next);
          this._trailNX = new Float32Array(next);
          this._trailNY = new Float32Array(next);
      }
  }

  private drawTrailStrip(
      ctx: CanvasRenderingContext2D,
      t: TrailPoint[],
      mode: 'projectile',
      camera: CameraState,
      entityColor?: string,
      isBouncer?: boolean
  ) {
      // Pre-shift every trail point into the camera's wrap zone so a trail
      // that spans a seam (emitter just wrapped) renders as one continuous
      // strip rather than a huge discontinuity across the map.  All the
      // normal-calc / gradient math below operates on the shifted copies.
      this._ensureTrailScratch(t.length);
      const sx = this._trailShiftedX;
      const sy = this._trailShiftedY;
      const camX = camera.position.x;
      const camY = camera.position.y;
      for (let i = 0; i < t.length; i++) {
          sx[i] = shiftX(camX, t[i].x);
          sy[i] = shiftY(camY, t[i].y);
      }
      // --- OPTIMIZATION: Polygon Strip (One draw call per trail) ---
      ctx.beginPath();

      // Pre-compute per-point normals once.  The forward and backward
      // strip passes below use identical normals (they only differ in
      // the sign of the width offset), so doing this in one pass replaces
      // 2N sqrt+div pairs with N — eliminating ~half the trig cost on
      // every visible projectile trail.
      const nxBuf = this._trailNX;
      const nyBuf = this._trailNY;
      const n = t.length;
      for (let i = 0; i < n; i++) {
          let dx = 0, dy = 0;
          if (i < n - 1) {
              dx = sx[i+1] - sx[i];
              dy = sy[i+1] - sy[i];
          } else if (i > 0) {
              dx = sx[i] - sx[i-1];
              dy = sy[i] - sy[i-1];
          }
          const lenSq = dx*dx + dy*dy;
          if (lenSq > 0.000001) {
              const inv = 1 / Math.sqrt(lenSq);
              nxBuf[i] = -dy * inv;
              nyBuf[i] = dx * inv;
          } else {
              nxBuf[i] = 0;
              nyBuf[i] = 0;
          }
      }

      // Forward pass: Right side of trail
      for (let i = 0; i < n; i++) {
          const p = t[i];
          const ratio = p.lifetime / p.maxLifetime;
          if (ratio <= 0) continue;
          const width = (p.scale ?? 1) * (1 + (ratio * 5)) / 2; // Half width
          ctx.lineTo(sx[i] + nxBuf[i] * width, sy[i] + nyBuf[i] * width);
      }

      // Backward pass: Left side of trail (same normals, negated width).
      for (let i = n - 1; i >= 0; i--) {
          const p = t[i];
          const ratio = p.lifetime / p.maxLifetime;
          if (ratio <= 0) continue;
          const width = (p.scale ?? 1) * (1 + (ratio * 5)) / 2;
          ctx.lineTo(sx[i] - nxBuf[i] * width, sy[i] - nyBuf[i] * width);
      }

      ctx.closePath();

      // Gradient fade — alpha max scales with the head point's own lifetime
      // so the trail dims uniformly as its newest point ages out.
      const head = t[t.length - 1];
      const headRatio = Math.max(0, Math.min(1, head.lifetime / head.maxLifetime));
      if (isBouncer) {
          // Bouncer beam: solid pure-green line with no fade along the trail.
          // The short lifetime already makes the beam self-limiting; we want
          // it sharp while it's visible.
          const [r, g, b] = hexToRgb(entityColor || '#22c55e');
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 1)`;
      } else {
          const grad = ctx.createLinearGradient(sx[0], sy[0], sx[t.length - 1], sy[t.length - 1]);
          const [r, g, b] = hexToRgb(entityColor || '#facc15');
          grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
          grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${0.75 * headRatio})`);
          ctx.fillStyle = grad;
      }
      ctx.fill();
  }

  private renderParticles(
      ctx: CanvasRenderingContext2D,
      entries: { entity: GameEntity, rx: number, ry: number }[],
      camera: CameraState,
  ) {
      if (entries.length === 0) return;
      ctx.globalCompositeOperation = 'lighter';
      // Run-length state tracking: a death burst is dozens of same-colour
      // discs with near-identical alpha, so skipping redundant fillStyle
      // (re-parsed each assignment) and globalAlpha writes cuts the canvas
      // state churn.  Invalidated (set to sentinels) around the special
      // branches below, which mutate ctx state themselves.
      let lastColor = '';
      let lastAlphaQ = -1;
      for (let i = 0; i < entries.length; i++) {
          const { entity: p, rx, ry } = entries[i];

          // Lightning arc particles use a dedicated renderer
          if (p.isLightningArc) {
              this.renderLightningArc(ctx, p, camera);
              lastColor = ''; lastAlphaQ = -1;
              continue;
          }

          // Cannon explosion shock ring: radius scales from 0 → full over
          // the particle's lifetime; alpha fades 1 → 0.  Drawn in `lighter`
          // composite mode so the ring blooms over enemies/sparks.
          if (p.isExplosionRing) {
              const r = p.explosionRadius ?? 0;
              if (r > 0) {
                  const life = p.lifetime || 0;
                  const maxLife = p.maxLifetime || 1;
                  const lifeRatio = Math.max(0, Math.min(1, life / maxLife));
                  const expand = 1 - lifeRatio; // 0 at spawn, 1 at end
                  const radius = r * expand;
                  const alpha = lifeRatio;     // fade out as it grows

                  // Outer purple ring (the shock front).
                  ctx.strokeStyle = p.color;
                  ctx.globalAlpha = alpha;
                  ctx.lineWidth = 3 + 4 * (1 - lifeRatio); // thickens slightly as it grows
                  ctx.beginPath();
                  ctx.arc(rx, ry, radius, 0, Math.PI * 2);
                  ctx.stroke();

                  // Inner white-hot rim — thinner, brighter, just inside
                  // the shock front, enhances the "snap" of the impact.
                  ctx.strokeStyle = '#ffffff';
                  ctx.globalAlpha = alpha * 0.55;
                  ctx.lineWidth = 1.5;
                  ctx.beginPath();
                  ctx.arc(rx, ry, Math.max(0, radius - 3), 0, Math.PI * 2);
                  ctx.stroke();
              }
              lastColor = ''; lastAlphaQ = -1;
              continue;
          }

          const lifeRatio = (p.lifetime || 0) / (p.maxLifetime || 1);
          // Quantise alpha to 1/64 (imperceptible) so a run of same-fade
          // particles reuses one globalAlpha write.
          const aq = (lifeRatio * 64) | 0;
          if (aq !== lastAlphaQ) { ctx.globalAlpha = aq / 64; lastAlphaQ = aq; }
          if (p.color !== lastColor) { ctx.fillStyle = p.color; lastColor = p.color; }
          ctx.beginPath();
          ctx.arc(rx, ry, p.size.x, 0, Math.PI * 2);
          ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
  }

  // ── Lightning arc rendering ─────────────────────────────────────────────

  private renderLightningArc(ctx: CanvasRenderingContext2D, particle: GameEntity, camera: CameraState) {
      const points = particle.arcPoints;
      if (!points || points.length < 2) return;

      const lifeRatio = (particle.lifetime || 0) / (particle.maxLifetime || 1);
      const alpha = lifeRatio; // fade over lifetime

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // Shift each chain node into the camera's wrap zone so arcs that
      // span a seam draw as one continuous bolt rather than crossing
      // the whole map diagonally.
      const camX = camera.position.x;
      const camY = camera.position.y;

      // Draw jagged arc between each pair of chain points
      for (let seg = 0; seg < points.length - 1; seg++) {
          const rawA = points[seg];
          const rawB = points[seg + 1];
          const a = { x: shiftX(camX, rawA.x), y: shiftY(camY, rawA.y) };
          const b = { x: shiftX(camX, rawB.x), y: shiftY(camY, rawB.y) };

          // Generate zigzag midpoints perpendicular to the segment
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len < 1) continue;

          // Perpendicular direction
          const nx = -dy / len;
          const ny = dx / len;

          const segCount = 5; // number of subdivisions
          const zigzag: Vector2[] = [{ x: a.x, y: a.y }];

          for (let i = 1; i < segCount; i++) {
              const t = i / segCount;
              const mx = a.x + dx * t;
              const my = a.y + dy * t;
              // Random perpendicular offset (scales with segment length)
              const offset = (Math.random() - 0.5) * len * 0.25;
              zigzag.push({ x: mx + nx * offset, y: my + ny * offset });
          }
          zigzag.push({ x: b.x, y: b.y });

          // Draw outer white glow
          ctx.globalAlpha = alpha * 0.5;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(zigzag[0].x, zigzag[0].y);
          for (let i = 1; i < zigzag.length; i++) {
              ctx.lineTo(zigzag[i].x, zigzag[i].y);
          }
          ctx.stroke();

          // Draw cyan electric core
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = 'rgba(34, 211, 238, 0.9)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(zigzag[0].x, zigzag[0].y);
          for (let i = 1; i < zigzag.length; i++) {
              ctx.lineTo(zigzag[i].x, zigzag[i].y);
          }
          ctx.stroke();
      }

      // Small bloom at each chain node
      for (let i = 1; i < points.length; i++) {
          const raw = points[i];
          const px = shiftX(camX, raw.x);
          const py = shiftY(camY, raw.y);
          ctx.globalAlpha = alpha * 0.7;
          const nodeGrad = ctx.createRadialGradient(px, py, 0, px, py, 14);
          nodeGrad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
          nodeGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.4)');
          nodeGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.fillStyle = nodeGrad;
          ctx.beginPath();
          ctx.arc(px, py, 14, 0, Math.PI * 2);
          ctx.fill();
      }

      ctx.globalAlpha = 1.0;
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
  }

  private renderEntities(
      ctx: CanvasRenderingContext2D,
      entries: { entity: GameEntity, rx: number, ry: number }[],
      camera: CameraState,
      playerPos?: Vector2
    ) {
    // Computed once per frame and reused by all entity rendering below.
    const nowSec = Date.now() / 1000;
    // performance.now() ticks since page load — used for the nebula
    // twinkle scheduler (and the matching fast-path predicate).  Hoist
    // it to per-frame so the slow path doesn't pay the syscall cost
    // per tile, and keep both the fast-path check and the twinkle
    // bookkeeping reading the *same* clock so the comparison is valid.
    const perfNowSec = performance.now() / 1000;

    // Cache the structure sprite once.  Prior to this, getImage() was
    // called once per visible tile (200-400×) to look up the same image.
    const hexSprite = this.getImage(ASSETS.HEX_STRUCTURE);
    const hexReady = hexSprite.complete && hexSprite.naturalWidth > 0;

    // Cache the active camera matrix once per pass so the slow-path body
    // can replace ctx.save / translate / rotate / restore (4 canvas-state
    // ops) with a single absolute setTransform call (~2-3× cheaper per
    // entity).  Matches the pattern in BackgroundManager.ts:370-374 for
    // nebula puffs.  The camera transform is set up by render() before
    // renderEntities() runs and is restored by render()'s ctx.restore()
    // afterwards, so we only need to reset to it between iterations.
    const cam = ctx.getTransform();
    const camA = cam.a, camB = cam.b, camC = cam.c, camD = cam.d, camE = cam.e, camF = cam.f;

    entries.forEach(({ entity, rx, ry }) => {
      // Allow inactive STRUCTURE tiles that are regenerating through for ghost outline rendering
      const isRegenGhost = !entity.active && entity.type === EntityType.STRUCTURE && entity.regenProgress !== undefined;
      if (!entity.active && !isRegenGhost) return;
      if (!Number.isFinite(entity.position.x) || !Number.isFinite(entity.position.y)) return;

      // Particles are handled separately in renderParticles() — skip here
      if (entity.type === EntityType.PARTICLE) return;

      // ── Static-tile cache skip ─────────────────────────────────────
      // Cacheable static tiles whose pre-blit prepare pass stamped them
      // into the world-tile canvas this frame are already painted by
      // the blit — no per-entity draw needed.  The prepare pass already
      // erased any tile that has slow-path overlays active (glow / hit
      // flash / regen) so reaching the per-entity path means the tile
      // legitimately needs the slow-path render below.
      if (entity._staticCached === true) return;

      // ── Fast-path STRUCTURE sprite render ───────────────────────────
      // Structures have rotation = 0, no per-entity ctx state changes,
      // and almost always render as a single drawImage call.  Skipping
      // the generic save/translate/rotate/restore wrapper saves 4 canvas
      // state ops per tile — multiplied by 200-400 visible tiles, that's
      // ~600-1600 fewer ops per frame.  Special states (hitFlash, regen
      // pop, regen ghost, active glow) fall back to the slow generic
      // path so layer 2b (variant-driven additive glow) can paint —
      // the fast path is a single drawImage and has no glow pass.
      // Only glass-family static tiles (glass / indestructible) take the
      // hex-sprite fast path.  Plastic / metal use the material-tile slow-
      // path branch (variant color + per-vertex dent jitter).  Rock-tile
      // and mobile shards also fall through to the polygon/sprite render
      // below — rock-tile renders with the asteroid solid-fill aesthetic
      // via the slow-path else branch.
      const isGlassFamilyStaticTile =
        entity.type === EntityType.STRUCTURE && entity.mass === Infinity
        && (entity.shardVariant === 'glass-tile'
            || entity.shardVariant === 'indestructible-tile');
      // Skip the fast path while the player is inside this tile's
      // variant glow range so the slow path's layer 2b can paint.
      // Glass-tile reads `repelImpulse` (any nearby repellable body
      // ramps the glow); indestructible-tile keeps player-distance
      // because it has no repel field.
      let inGlowRange = false;
      if (isGlassFamilyStaticTile && entity.shardVariant !== undefined) {
          if (entity.shardVariant === 'glass-tile') {
              inGlowRange = (entity.repelImpulse ?? 0) > 0;
          } else if (playerPos) {
              const fpGlow = SHARD_VARIANTS[entity.shardVariant].glow;
              if (fpGlow !== undefined) {
                  const fpdx = wrapDeltaX(entity.position.x, playerPos.x);
                  const fpdy = wrapDeltaY(entity.position.y, playerPos.y);
                  inGlowRange = fpdx * fpdx + fpdy * fpdy < fpGlow.range * fpGlow.range;
              }
          }
      }
      if (isGlassFamilyStaticTile
          && entity.active && hexReady
          && !entity.hitFlash && entity.regenPopTimer === undefined
          && !inGlowRange) {
          // Fallback fast path for tiles not currently in the static
          // canvas (e.g. world-canvas allocation failed, hex sprite was
          // still loading at map load, or pre-blit prepare missed an
          // off-screen→on-screen transition this frame).  Cached tiles
          // are short-circuited by the early-return at the top of this
          // forEach so they never reach here.
          const maxDim = Math.max(entity.size.x, entity.size.y);
          const drawSize = maxDim * 1.02;
          const dHalf = drawSize / 2;
          // Match the cache stamp's neighbour-count opacity fade so an
          // uncached glass tile reads identically to its cached siblings.
          const fpAlpha = Math.min(1, this.materialAutomataAlpha(entity));
          if (fpAlpha !== 1) ctx.globalAlpha = fpAlpha;
          ctx.drawImage(hexSprite, rx - dHalf, ry - dHalf, drawSize, drawSize);
          if (fpAlpha !== 1) ctx.globalAlpha = 1;
          return;
      }

      // ── Fast-path NEBULA tile render ───────────────────────────────
      // Mirrors the STRUCTURE fast path.  Steady-state nebula tiles (no
      // hit flash, no fade in / fade out, not in a twinkle window, cache
      // populated by an earlier slow-path draw) collapse to a single
      // drawImage + two globalAlpha writes — cutting per-tile cost from
      // ~30-100 µs to ~5 µs.  Tiles drop into the slow path automatically
      // when twinkle activates (nebulaTwinkleNextAt has elapsed) or when
      // NebulaSystem invalidates the cache (nebulaCachedTinted=undefined).
      // Shards are excluded because they still need ctx.rotate +
      // speed-based opacity.
      //
      // Debug mode is NOT a fast-path blocker: the slow-path's cyan
      // polygon overlay only matters for shards (which take the slow
      // path anyway), and the HUD requires debug mode to be on for the
      // user to see perf numbers — so blocking the fast path on
      // debugMode would mean it never runs while we're measuring.
      // Stage 5: fast-path gate flips from EntityType-keyed to
      // variant-id-keyed.  Same cost (one string compare), same
      // shape, same cache invalidation sites.  Only the nebula-tile
      // variant populates the per-entity tinted-canvas cache —
      // future variants can opt in via SHARD_VARIANTS[v].renderCache.
      if (entity.shardVariant === 'nebula-tile'
          && entity.active
          && !entity.hitFlash
          && entity.mergeFadeTimer === undefined
          && entity.nebulaSpawnTimer === undefined
          && entity.regenPopTimer === undefined
          && entity.nebulaCachedTinted !== undefined
          && entity.nebulaTwinkleNextAt !== undefined
          && perfNowSec < entity.nebulaTwinkleNextAt) {
          ctx.globalAlpha = 0.55;
          ctx.drawImage(
              entity.nebulaCachedTinted,
              rx + (entity.nebulaCachedDx ?? 0),
              ry + (entity.nebulaCachedDy ?? 0),
              entity.nebulaCachedSize ?? 0,
              entity.nebulaCachedSize ?? 0,
          );
          ctx.globalAlpha = 1.0;
          // Debug overlay parity with the slow path — without this the
          // polygon outline only appears for tiles currently in their
          // twinkle window (which forces them to the slow path), which
          // looks like random flickering across the cluster.  Drawn in
          // world space (no ctx.translate in the fast path) by adding
          // (rx, ry) to each polygon point.
          if (this.debugMode && entity.polygonPoints && entity.polygonPoints.length > 0) {
              ctx.globalAlpha = 0.9;
              ctx.strokeStyle = '#22d3ee'; // cyan-400 — matches other debug strokes
              ctx.lineWidth = 1;
              ctx.beginPath();
              const p0 = entity.polygonPoints[0];
              ctx.moveTo(rx + p0.x, ry + p0.y);
              for (let pi = 1; pi < entity.polygonPoints.length; pi++) {
                  const p = entity.polygonPoints[pi];
                  ctx.lineTo(rx + p.x, ry + p.y);
              }
              ctx.closePath();
              ctx.stroke();
              ctx.globalAlpha = 1.0;
          }
          this.lastNebulaFastCount++;
          return;
      }

      // Transform logic — compose camera × translate(rx, ry) × rotate
      // into one absolute matrix and write it via setTransform.  Replaces
      // ctx.save / translate / rotate / restore (4 canvas-state ops) with
      // a single matrix write — ~2-3× cheaper per slow-path entity.
      // Mirrors BackgroundManager.ts:370-374 for nebula puffs.
      const rotation = entity.rotation + (
        entity.isRival
          ? SPRITE_CONSTANTS.RIVAL_ROTATION_OFFSET   // sprite art points up-left
          : entity.type === EntityType.PLAYER
          ? SPRITE_CONSTANTS.PLAYER_ROTATION_OFFSET
          : entity.type === EntityType.ENEMY
            ? SPRITE_CONSTANTS.ENEMY_ROTATION_OFFSET
            : 0
      );
      const cosR = Math.cos(rotation);
      const sinR = Math.sin(rotation);
      ctx.setTransform(
        camA * cosR + camC * sinR,
        camB * cosR + camD * sinR,
        -camA * sinR + camC * cosR,
        -camB * sinR + camD * cosR,
        camA * rx + camC * ry + camE,
        camB * rx + camD * ry + camF,
      );
      // Reset globalAlpha — without the old ctx.save/restore, sub-paths
      // that exit at a non-1.0 alpha (STRUCTURE specular, INTERACTABLE
      // heart highlight, drop-shard fill) would otherwise fade the next
      // entity's drawImage / fill.  Other state (fillStyle, strokeStyle,
      // lineWidth, font) is set per branch before use, so doesn't need
      // resetting here.  Composite-op / filter / shadow / line-dash are
      // already paired with inner save/restore at their use sites.
      ctx.globalAlpha = 1.0;

      // --- NEBULA TILES & SHARDS ---
      // Cloud-like rendering: tinted sprite drawn at a display-scale larger
      // than the physics size so adjacent tiles blend seamlessly across
      // their shared hex-grid boundaries.  Tinted sprites are cached.
      if (entity.shardVariant === 'nebula-tile' || entity.shardVariant === 'nebula-shard') {
          this.lastNebulaSlowCount++;
          // Per-entity blended-hex cache: populated lazily on first render
          // and invalidated by NebulaSystem when composition mutates
          // (merge / regen).  Skips blendCompositionToHex's per-call
          // composition-key string allocation on every frame.
          let tintHex: string;
          if (entity.nebulaBlendedHex !== undefined) {
              tintHex = entity.nebulaBlendedHex;
          } else {
              tintHex = blendCompositionToHex(entity.nebulaColorComposition) || entity.color;
              entity.nebulaBlendedHex = tintHex;
          }
          // Interior-darken rule: nebula tiles surrounded by more active
          // neighbours render progressively darker so cluster edges pop
          // and interiors recede.  Max darkening at 6 neighbours (fully
          // enclosed) caps at 0.55× brightness; shards skip the pass.
          if (entity.shardVariant === 'nebula-tile' && entity.nebulaNeighborCount) {
              const t = Math.min(1, entity.nebulaNeighborCount / 6);
              const factor = 1 - t * 0.45;
              const [r, g, b] = hexToRgb(tintHex);
              const toHex = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)))
                  .toString(16).padStart(2, '0');
              tintHex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
          }
          // Density tier darkens nebula shards (only — tiles have density
          // disabled in the variant config).  Stacks multiplicatively
          // with the interior-darken rule above for tiles, but in
          // practice tiles never reach this branch with a positive
          // tier.  Skipped at tier 0 so existing shard colour matches
          // pre-density visuals exactly.
          if (entity.densityTier && entity.densityTier > 0
              && entity.shardVariant === 'nebula-shard') {
              tintHex = densityTintForRender(entity, tintHex);
          }
          const spriteSrc = entity.sprite;
          // Fade-out multiplier — per-entity duration lets fast-collision
          // shatters use a shorter, snappier fade than slow drift-through
          // collisions.  Falls back to the base constant for legacy tiles
          // without the per-entity duration field set.
          const fadeDuration = entity.mergeFadeDuration ?? NEBULA_CONSTANTS.FADE_DURATION;
          const fadeMul = entity.mergeFadeTimer !== undefined && entity.mergeFadeTimer > 0 && fadeDuration > 0
              ? Math.max(0, entity.mergeFadeTimer / fadeDuration)
              : 1.0;
          // Fade-in multiplier — same per-entity duration treatment so
          // child shards from a fast collision fade in fast, matching
          // their parent tile's fade-out rate.  Combines multiplicatively
          // with fadeMul so a tile shattered mid-birth smoothly crossfades
          // from its current alpha toward zero.
          const spawnDuration = entity.nebulaSpawnDuration ?? NEBULA_CONSTANTS.FADE_IN_DURATION;
          const spawnMul = entity.nebulaSpawnTimer !== undefined && entity.nebulaSpawnTimer > 0 && spawnDuration > 0
              ? Math.max(0, 1 - entity.nebulaSpawnTimer / spawnDuration)
              : 1.0;
          // Speed-based opacity falloff for shards — fast shards read
          // a little translucent ("wind-torn cloud"), settled shards are
          // fully opaque.  Uses speed² so we skip sqrt; tiles are
          // stationary so we skip the branch entirely for them.
          let speedMul = 1.0;
          if (entity.shardVariant === 'nebula-shard') {
              const vx = entity.velocity.x;
              const vy = entity.velocity.y;
              const speedSq = vx * vx + vy * vy;
              speedMul = Math.max(
                  NEBULA_CONSTANTS.SHARD_SPEED_OPACITY_MIN,
                  1 - speedSq * NEBULA_CONSTANTS.SHARD_SPEED_OPACITY_K,
              );
          }
          if (spriteSrc) {
              // Fast path for shards: reuse the cached composite cache key
              // so we do a single Map.get against the shared _tintedSprites
              // store without rebuilding "${src}|${hex}" per frame.  Falls
              // through to getTintedSprite on cache miss (first draw, or
              // if the LRU evicted the canvas) which populates the store
              // and returns the same canvas.  Tiles keep the default path
              // since their tintHex varies with neighbour-count darkening.
              let tinted: HTMLCanvasElement | null = null;
              if (entity.shardVariant === 'nebula-shard') {
                  if (entity.nebulaTintedKey === undefined) {
                      entity.nebulaTintedKey = `${spriteSrc}|${tintHex}`;
                  }
                  tinted = this._tintedSprites.get(entity.nebulaTintedKey) ?? null;
                  if (!tinted) tinted = this.getTintedSprite(spriteSrc, tintHex);
              } else {
                  tinted = this.getTintedSprite(spriteSrc, tintHex);
              }
              if (tinted) {
                  const isTile = entity.shardVariant === 'nebula-tile';
                  // Sprite size is proportional to the effective nebula
                  // area the entity carries.  A fresh shard from a 5-way
                  // shatter draws ≈ 96 × sqrt(1/5) ≈ 43 world units; a
                  // half-merged shard draws ≈ 68; a full tile draws at
                  // the reference size (96).  Using sqrt keeps visual
                  // area (∝ sprite²) proportional to effective area, so
                  // what the player sees matches the conserved mass
                  // accounting used for merge → transmutation.  Legacy
                  // entities without nebulaTileArea fall back to a full
                  // tile sprite.
                  const effArea = entity.nebulaTileArea ?? HEX_AREA;
                  const areaRatio = Math.max(0, Math.min(1, effArea / HEX_AREA));
                  const drawSize = NEBULA_CONSTANTS.TILE_SPRITE_WORLD_SIZE
                      * Math.sqrt(areaRatio);
                  // Content-centroid correction: shift the draw so the
                  // sprite's visible-pixel centroid lands on the pivot.
                  // Without this, asymmetric source PNGs appear to orbit
                  // around their bitmap centre when rotated.  Fallback is
                  // (0, 0) if the centroid isn't computable yet.
                  const centroid = this.getSpriteCentroid(spriteSrc);
                  const dOffset = -(drawSize / 2);
                  const dx = dOffset - centroid.dx * drawSize;
                  const dy = dOffset - centroid.dy * drawSize;
                  // Velocity-aligned stretch (nebula-shard only).
                  // Reads as "wind tugging the cloud forward" — the
                  // sprite squashes along the velocity axis as the
                  // shard moves.  Gated on speed² > REST so settled
                  // shards skip the math.  Always uses "free" mode:
                  // only the squash axis aligns to velocity; the
                  // sprite stays at entity.rotation (controlled by
                  // rotationSpeed) — achieved by rotating to
                  // velocity, scaling, then rotating back so the
                  // local coord system stays squashed along the
                  // velocity axis while drawImage paints in the
                  // entity-rotated frame.  Stretch magnitude reads
                  // from getActiveNebulaStretchK() (DBG-cyclable
                  // via the NStr button); when the cycle is at
                  // K = 0 the stretch is skipped entirely.
                  if (!isTile) {
                      const stretchK = getActiveNebulaStretchK();
                      if (stretchK > 0) {
                          const vx = entity.velocity.x;
                          const vy = entity.velocity.y;
                          const speedSq = vx * vx + vy * vy;
                          if (speedSq > NEBULA_CONSTANTS.VEL_STRETCH_REST_SPEED_SQ) {
                              const speed = Math.sqrt(speedSq);
                              const stretch = Math.min(
                                  NEBULA_CONSTANTS.VEL_STRETCH_MAX,
                                  speed * stretchK,
                              );
                              const velAngle = Math.atan2(vy, vx);
                              const delta = velAngle - entity.rotation;
                              ctx.rotate(delta);
                              ctx.scale(
                                  1 + stretch,
                                  1 - stretch * NEBULA_CONSTANTS.VEL_STRETCH_SQUASH_RATIO,
                              );
                              ctx.rotate(-delta);
                          }
                      }
                  }
                  // Soft alpha — tiles slightly more opaque so the cloud
                  // reads as solid, shards slightly less so they feel light.
                  // Optional per-entity multiplier so callers can ask for
                  // a wispier-than-default puff (rock-tile / rock-shard
                  // shatter callers set ~0.5 so their nebula debris
                  // reads as a faint dust cloud rather than a solid
                  // tinted shard).
                  ctx.globalAlpha = (isTile ? 0.55 : 0.45) * fadeMul * spawnMul * speedMul * (entity.nebulaAlphaMul ?? 1);
                  ctx.drawImage(tinted, dx, dy, drawSize, drawSize);
                  ctx.globalAlpha = 1.0;
                  // Populate the nebula fast-path cache while we have
                  // every input on hand.  See the fast-path block above
                  // renderEntities()'s slow body — once these four
                  // fields are non-undefined, subsequent frames bypass
                  // this whole slow path until NebulaSystem invalidates
                  // them (composition / neighbour-count / area changes).
                  if (entity.shardVariant === 'nebula-tile') {
                      entity.nebulaCachedTinted = tinted;
                      entity.nebulaCachedDx = dx;
                      entity.nebulaCachedDy = dy;
                      entity.nebulaCachedSize = drawSize;
                  }
              } else {
                  // Fallback: procedural soft circle in the tint colour
                  // while the nebula sprite is still loading.
                  const r = Math.max(entity.size.x, entity.size.y) * 0.9;
                  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
                  grad.addColorStop(0, tintHex);
                  grad.addColorStop(1, 'rgba(0,0,0,0)');
                  ctx.fillStyle = grad;
                  ctx.globalAlpha = 0.45 * fadeMul * spawnMul * speedMul;
                  ctx.beginPath();
                  ctx.arc(0, 0, r, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.globalAlpha = 1.0;
              }
          }

          // --- DEBUG OVERLAY ---
          // Nebula tiles: draw the hex outline so the invisible interactable
          // footprint is visible during debug.
          // Nebula shards: draw the polygon outline (same glass-shard style
          // polygon set at spawn).  Legacy shards without polygonPoints fall
          // back to an implicit circle defined by `size`.
          // Gated on the main DBG mode OR the dedicated Outline toggle, so
          // a dev can show nebula+plastic outlines together without
          // switching the whole DBG mode on.
          if (this.debugMode || this.tileOutlinesEnabled) {
              ctx.globalAlpha = 0.9;
              ctx.strokeStyle = '#22d3ee'; // cyan-400 — matches other debug strokes
              ctx.lineWidth = 1;
              if (entity.polygonPoints && entity.polygonPoints.length > 0) {
                  ctx.beginPath();
                  const p0 = entity.polygonPoints[0];
                  ctx.moveTo(p0.x, p0.y);
                  for (let pi = 1; pi < entity.polygonPoints.length; pi++) {
                      const p = entity.polygonPoints[pi];
                      ctx.lineTo(p.x, p.y);
                  }
                  ctx.closePath();
                  ctx.stroke();
              } else if (entity.shardVariant === 'nebula-shard') {
                  // Legacy fallback: implicit circle defined by `size`.
                  const r = Math.max(entity.size.x, entity.size.y) / 2;
                  ctx.beginPath();
                  ctx.arc(0, 0, r, 0, Math.PI * 2);
                  ctx.stroke();
              }
              ctx.globalAlpha = 1.0;
          }

          // --- TWINKLE STAR ---
          // Stationary nebula TILES get an occasional fading-in/out star at a
          // random in-sprite position — adds ambience to the backdrop.
          // Skipped for NEBULA_SHARDs: shards are transient, drifting, and
          // often in merge cooldown, so the twinkle is almost imperceptible
          // on them while still costing a performance.now() + drawImage per
          // shard per frame.  Cutting it for shards eliminates that work
          // without a visible change.
          //
          if (entity.shardVariant === 'nebula-tile') {
              const now = perfNowSec;
              if (entity.nebulaTwinkleNextAt === undefined) {
                  // First sighting — stagger the initial twinkle randomly
                  // across the [MIN, MAX] interval so a freshly-spawned
                  // cluster doesn't all twinkle in unison.
                  entity.nebulaTwinkleNextAt = now + NEBULA_CONSTANTS.TWINKLE_INTERVAL_MIN
                      + Math.random() * (NEBULA_CONSTANTS.TWINKLE_INTERVAL_MAX - NEBULA_CONSTANTS.TWINKLE_INTERVAL_MIN);
                  entity.nebulaTwinkleX = (Math.random() * 2 - 1);
                  entity.nebulaTwinkleY = (Math.random() * 2 - 1);
              }
              const elapsed = now - entity.nebulaTwinkleNextAt;
              if (elapsed >= 0) {
                  if (elapsed < NEBULA_CONSTANTS.TWINKLE_DURATION) {
                      // Active twinkle — sin curve over the duration
                      const t = elapsed / NEBULA_CONSTANTS.TWINKLE_DURATION;
                      const twinkleAlpha = Math.sin(t * Math.PI) * fadeMul * spawnMul;
                      if (twinkleAlpha > 0.01) {
                          const star = this.getTwinkleBitmap();
                          // Place the star within the sprite footprint —
                          // half-extent × placement-range keeps it inside.
                          // Same area-proportional draw-size formula the
                          // sprite render uses above, so the twinkle
                          // scales with the shard/tile as it merges.
                          const effArea = entity.nebulaTileArea ?? HEX_AREA;
                          const areaRatio = Math.max(0, Math.min(1, effArea / HEX_AREA));
                          const drawSize = NEBULA_CONSTANTS.TILE_SPRITE_WORLD_SIZE
                              * Math.sqrt(areaRatio);
                          const halfExtent = (drawSize / 2) * NEBULA_CONSTANTS.TWINKLE_PLACEMENT_RANGE;
                          const tx = (entity.nebulaTwinkleX ?? 0) * halfExtent;
                          const ty = (entity.nebulaTwinkleY ?? 0) * halfExtent;
                          const starSize = NEBULA_CONSTANTS.TWINKLE_STAR_SIZE;
                          ctx.globalAlpha = twinkleAlpha;
                          ctx.drawImage(star, tx - starSize / 2, ty - starSize / 2, starSize, starSize);
                          ctx.globalAlpha = 1.0;
                      }
                  } else {
                      // Cycle complete — schedule the next one with a fresh
                      // random delay and reroll the in-sprite position.
                      entity.nebulaTwinkleNextAt = now + NEBULA_CONSTANTS.TWINKLE_INTERVAL_MIN
                          + Math.random() * (NEBULA_CONSTANTS.TWINKLE_INTERVAL_MAX - NEBULA_CONSTANTS.TWINKLE_INTERVAL_MIN);
                      entity.nebulaTwinkleX = (Math.random() * 2 - 1);
                      entity.nebulaTwinkleY = (Math.random() * 2 - 1);
                  }
              }
          }

          // Reset to the cached camera matrix so subsequent slow-path
          // entities (and post-loop draws like renderHealthBar) start from
          // camera space — mirrors what ctx.restore() did when paired
          // with the now-removed ctx.save() at the top of the slow path.
          ctx.setTransform(camA, camB, camC, camD, camE, camF);
          return;
      }

      let drawn = false;

      // --- SPRITE RENDERING ---
      if (entity.sprite) {
          const img = this.getImage(entity.sprite);

          if (img.complete && img.naturalWidth > 0) {
              try {
                  const maxDim = Math.max(entity.size.x, entity.size.y);

                  // Stage 5: only static tiles (mass=∞) use the tight
                  // tile drawScale.  Mobile shards (STRUCTURE+finite-
                  // mass after the EntityType collapse) keep the
                  // generic 1.5× scale that asteroids used today.
                  let drawScale = 1.5;
                  if (entity.type === EntityType.STRUCTURE && entity.mass === Infinity) {
                      drawScale = 1.02;
                  }
                  // Rival ships render at 1:1 with their `size` so the visible
                  // hull matches the collision footprint (getCollisionR = size/2)
                  // — at the generic 1.5× the sprite overhangs its hitbox and
                  // shots that look like hits sail past.
                  if (entity.isRival) drawScale = 1.0;
                  // Hit-punch: enemies briefly swell on impact for a juicy
                  // reaction (driven by the hit-flash timer, scaled by the
                  // damage-as-%-of-maxHealth react magnitude).
                  if (entity.type === EntityType.ENEMY && entity.hitFlash && entity.hitFlash > 0) {
                      drawScale *= 1 + Math.min(0.4, entity.hitFlash * 2.2) * (entity.hitReact ?? 1);
                  }

                  const drawSize = maxDim * drawScale;
                  const dOffset = -(drawSize / 2);

                  ctx.drawImage(img, dOffset, dOffset, drawSize, drawSize);

                  // Hit flash: re-draw the sprite blown out toward white on
                  // impact for a punchy, unmistakable hit pop (the `filter`
                  // affects only the drawn image, so no white-square artefact).
                  // The brightness ramps with the flash timer so a fresh hit
                  // reads as a near-white silhouette, fading back to the hull.
                  if (entity.hitFlash && entity.hitFlash > 0) {
                      const f = Math.min(1, entity.hitFlash * 3);
                      ctx.save();
                      ctx.globalAlpha = Math.min(1, 0.55 + f);
                      ctx.filter = `brightness(${(2 + f * 6).toFixed(2)})`;
                      ctx.drawImage(img, dOffset, dOffset, drawSize, drawSize);
                      ctx.filter = 'none';
                      ctx.restore();
                  }


                  // Draw Label for interactables
                  if (entity.type === EntityType.INTERACTABLE && entity.name) {
                      ctx.rotate(-entity.rotation);
                      ctx.fillStyle = '#ffffff';
                      ctx.font = '12px monospace';
                      ctx.textAlign = 'center';
                      ctx.shadowColor = 'black';
                      ctx.shadowBlur = 4;
                      ctx.fillText(entity.name, 0, (drawSize / 2) + 15);
                      ctx.shadowBlur = 0;
                  }
                  
                  drawn = true;
              } catch (e) {
                  drawn = false;
              }
          }
      }

      // --- FALLBACK SHAPE RENDERING ---
      if (!drawn) {
          if (entity.type === EntityType.ENEMY) {
            this.drawEnemyShape(ctx, entity, nowSec);
            drawn = true;
          } else if (entity.type === EntityType.PLAYER) {
             // Fallback player shape
            const size = Math.max(entity.size.x, entity.size.y) * 2.0; 
            ctx.fillStyle = COLORS.PLAYER;
            ctx.beginPath();
            ctx.moveTo(size/2, 0);
            ctx.lineTo(-size/2, size/2);
            ctx.lineTo(-size/2, -size/2);
            ctx.closePath();
            ctx.fill();

          } else if (entity.type === EntityType.STRUCTURE) {

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
                const autoAlpha = this.materialAutomataAlpha(entity);
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
                // PhysicsSystem writes into the tile, so the glow
                // ramps up for ANY repellable body (player, enemy,
                // mobile shards), not only the player.  Fill + thick
                // stroke so the halo reads as a clear "lit edge" —
                // fill alone washes the hex out but doesn't beacon.
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
                    ctx.drawImage(this.getSpecularBitmap(), -15, -17);
                }

                // Indestructible-tile lighting — the fill-only warm-white
                // radial bloom (no edge stroke), painted last.  Glass-tile
                // uses its own layer 2b above instead.
                if (entity.shardVariant === 'indestructible-tile') {
                    this.timedTileBloom(ctx, entity, playerPos);
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
                    ctx.fillStyle = isFlash ? flashColor : this.tileFillColor(entity);
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
                            if (!deformed && this.physics) {
                                // Probe outward from the edge midpoint to
                                // see if a neighbour tile covers the
                                // adjacent hex cell.  No neighbour →
                                // cluster-boundary edge → draw.
                                const midX = (p1.x + p2.x) * 0.5;
                                const midY = (p1.y + p2.y) * 0.5;
                                const probeWorldX = entity.position.x + midX * probeFactor;
                                const probeWorldY = entity.position.y + midY * probeFactor;
                                drawEdge = !this.physics.hasStaticTileNear(
                                    probeWorldX, probeWorldY, probeRadius, entity.id,
                                );
                            } else if (!deformed && !this.physics) {
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
                        this.overlayMaterialCracks(
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
                        this.timedTileBloom(ctx, entity, playerPos);
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
                    const [mr, mg, mb] = hexToRgb(entity.color);
                    for (let ci = 0; ci < cells.length; ci++) {
                        const c = cells[ci];
                        const depth = ci < deeperCells ? baseDepth + 1 : baseDepth;
                        const f = metalDensityBrightness(depth);
                        ctx.fillStyle = isFlash
                            ? '#cbd5e1'
                            : (f === 1 ? entity.color : rgbToHex(mr * f, mg * f, mb * f));
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
                    this.drawMetalDebugOutline(ctx, entity);
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
                if (this.shardLodEnabled
                    && entity.shardVariant === 'metal-shard'
                    && !isFlash
                    && glowColor === undefined
                    && lodR * camera.zoom < SHARD_LOD_CONSTANTS.MIN_APPARENT_RADIUS_PX) {
                    const tri = this.getSolidTriangleBitmap(densityTintForRender(entity, entity.color));
                    ctx.globalAlpha = shardMergeFadeAlpha(entity);
                    ctx.drawImage(tri, -lodR, -lodR, lodR * 2, lodR * 2);
                    ctx.globalAlpha = 1.0;
                    this.drawMetalDebugOutline(ctx, entity);
                    this.lastLodShardCount++;
                    return;
                }
                // Rock chips: the conservation-chip system spawns many small
                // rock-shards, so collapse the tiniest ones (below the
                // chip-LOD radius, smaller than the metal threshold) to the
                // same cached solid blob — skips the full polygon + density
                // tint + (already LOD-gated) crack render.  Their jagged
                // silhouette is imperceptible at this apparent size.
                if (this.shardLodEnabled
                    && entity.shardVariant === 'rock-shard'
                    && !isFlash
                    && glowColor === undefined
                    && lodR * camera.zoom < SHARD_LOD_CONSTANTS.CHIP_LOD_RADIUS_PX) {
                    const blob = this.getSolidTriangleBitmap(densityTintForRender(entity, entity.color));
                    ctx.globalAlpha = shardMergeFadeAlpha(entity);
                    ctx.drawImage(blob, -lodR, -lodR, lodR * 2, lodR * 2);
                    ctx.globalAlpha = 1.0;
                    this.lastLodShardCount++;
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
                    const baseColor = (this.plasticAutomataEnabled
                                       && entity.shardVariant === 'plastic-shard')
                        ? plasticAutomataHex(entity.plasticNeighborCount ?? 0)
                        : this.materialAutomataColor(entity);
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
                        this.overlayMaterialCracks(
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
                        this.overlayMaterialCracks(
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
                    this.timedTileBloom(ctx, entity, playerPos);
                }

                if (entity.shardVariant === 'metal-shard') {
                    this.drawMetalDebugOutline(ctx, entity);
                }
            }

          } else if (entity.type === EntityType.PROJECTILE) {
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
                    let grad = this._chargedGlow;
                    if (!grad) {
                        grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
                        grad.addColorStop(0,    'rgba(255, 255, 235, 1)');    // hot white core
                        grad.addColorStop(0.10, 'rgba(255, 220, 100, 1)');    // pale yellow inner
                        grad.addColorStop(0.25, 'rgba(251, 146,  60, 1)');    // orange (orange-400)
                        grad.addColorStop(0.45, 'rgba(239,  68,  68, 0.85)'); // red (red-500)
                        grad.addColorStop(0.75, 'rgba(220,  38,  38, 0.25)'); // deep red glow
                        grad.addColorStop(1,    'rgba(220,  38,  38, 0)');
                        this._chargedGlow = grad;
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
                    let grad = this._projGlowCache.get(key);
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
                        this._projGlowCache.set(key, grad);
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
          } else {
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

                // Event horizon — a dark disc so the rift reads as a hole,
                // not a light source.
                ctx.globalAlpha = 0.92;
                ctx.beginPath();
                ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
                ctx.fillStyle = '#0b0616';
                ctx.fill();

                // Rim of the event horizon — a hard bright edge so the hole
                // reads against a busy nebula backdrop.
                ctx.globalAlpha = 0.9;
                ctx.strokeStyle = entity.color;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
                ctx.stroke();

                // Counter-rotating arc rings — three broken arcs per ring,
                // spinning opposite ways, which reads as a vortex.  The
                // inner ring gets a white highlight pass so the swirl stays
                // legible at gameplay zoom.
                for (let ring = 0; ring < 2; ring++) {
                    const rr = r * (ring === 0 ? 0.78 : 1.0);
                    const dir = ring === 0 ? 1 : -1;
                    for (let i = 0; i < 3; i++) {
                        const a0 = spin * dir + (i / 3) * Math.PI * 2;
                        const a1 = a0 + Math.PI * 0.44;
                        ctx.globalAlpha = ring === 0 ? 1.0 : 0.7;
                        ctx.strokeStyle = entity.color;
                        ctx.lineWidth = ring === 0 ? 6 : 3.5;
                        ctx.beginPath();
                        ctx.arc(0, 0, rr, a0, a1);
                        ctx.stroke();
                        if (ring === 0) {
                            ctx.globalAlpha = 0.85;
                            ctx.strokeStyle = '#ffffff';
                            ctx.lineWidth = 1.6;
                            ctx.beginPath();
                            ctx.arc(0, 0, rr, a0, a1);
                            ctx.stroke();
                        }
                    }
                }

                // Hot core — the throat of the rift, breathing.
                ctx.globalAlpha = 0.55 + 0.35 * breathe;
                ctx.beginPath();
                ctx.arc(0, 0, r * 0.2 * breathe, 0, Math.PI * 2);
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
      }

      // Shield hit ring — visible only on contact; radius matches physical collision
      if (entity.type === EntityType.PLAYER && entity.shieldHitFlash && entity.shieldHitFlash > 0) {
          const maxDim = Math.max(entity.size.x, entity.size.y);
          // Exact match: collision uses (size/2) * COLLISION_MULTIPLIER as half-extent
          const ringRadius = (maxDim / 2) * SHIELD_COLLISION_MULT;
          const flashRatio = entity.shieldHitFlash / SHIELD_HIT_FLASH_DURATION;
          // Instant full brightness that fades out
          const alpha = Math.min(1.0, flashRatio * 3.0);
          // Undo entity rotation so the ring is axis-aligned
          const rot = entity.rotation + SPRITE_CONSTANTS.PLAYER_ROTATION_OFFSET;
          ctx.rotate(-rot);
          ctx.globalAlpha = alpha;

          // Inner glow — radial gradient from transparent center to shield color at rim
          const glowInner = ctx.createRadialGradient(0, 0, ringRadius * 0.55, 0, 0, ringRadius);
          glowInner.addColorStop(0, 'rgba(96,165,250,0)');
          glowInner.addColorStop(0.7, 'rgba(96,165,250,0.08)');
          glowInner.addColorStop(1, 'rgba(96,165,250,0.25)');
          ctx.fillStyle = glowInner;
          ctx.beginPath();
          ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = SHIELD_COLOR;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.rotate(rot);
      }

      // Charge-shot ring — drawn while the player holds the fire button.
      // Stored on player.chargeProgress as a fraction of CHARGE_FULL ([0,1]).
      // Two states: priming (filling, slate) → full (white).  Charged shot
      // only arms when the ring is full, matching what the player sees.
      if (entity.type === EntityType.PLAYER && entity.chargeProgress && entity.chargeProgress > 0) {
          const cp = entity.chargeProgress; // [0..1] fraction of CHARGE_FULL
          const isFull = cp >= 1;
          const maxDim = Math.max(entity.size.x, entity.size.y);
          const ringR = (maxDim / 2) + CHARGE_CONSTANTS.RING_RADIUS_OFFSET;

          // Undo entity rotation so the ring is axis-aligned and the arc
          // sweep starts at the top (12 o'clock) regardless of facing.
          const rot = entity.rotation + SPRITE_CONSTANTS.PLAYER_ROTATION_OFFSET;
          ctx.rotate(-rot);

          ctx.strokeStyle = isFull
              ? CHARGE_CONSTANTS.RING_COLOR_FULL
              : CHARGE_CONSTANTS.RING_COLOR_PRIMING;
          ctx.lineWidth = CHARGE_CONSTANTS.RING_WIDTH;
          ctx.globalAlpha = isFull ? 0.95 : 0.5;

          // Background dim ring at full circumference for context.
          if (!isFull) {
              ctx.beginPath();
              ctx.arc(0, 0, ringR, 0, Math.PI * 2);
              ctx.globalAlpha = 0.15;
              ctx.stroke();
              ctx.globalAlpha = 0.5;
          }

          // Foreground arc — fills clockwise from top, ending at the current
          // charge fraction.
          ctx.beginPath();
          ctx.arc(0, 0, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cp);
          ctx.stroke();

          ctx.globalAlpha = 1;
          ctx.rotate(rot);
      }

      // Reset to the cached camera matrix so the debug-accel block, the
      // health bar, and the next iteration all start from camera space —
      // mirrors what ctx.restore() did when paired with the now-removed
      // ctx.save() at the top of the slow path.
      ctx.setTransform(camA, camB, camC, camD, camE, camF);

      // Render Debug Acceleration Vector (debug mode only)
      if (this.debugMode && entity.type === EntityType.PLAYER && entity.inputVector) {
          const iv = entity.inputVector;
          const mag = Math.sqrt(iv.x*iv.x + iv.y*iv.y);
          if (mag > 0.05) {
              ctx.save();
              ctx.translate(rx, ry);
              // No rotation here, inputVector is world-aligned
              
              const scale = 100; // 1 unit (full throttle) = 100px length
              const ex = iv.x * scale;
              const ey = iv.y * scale;

              ctx.beginPath();
              ctx.moveTo(0,0);
              ctx.lineTo(ex, ey);
              ctx.strokeStyle = '#ffff00'; // Yellow
              ctx.lineWidth = 2;
              ctx.setLineDash([5, 3]);
              ctx.stroke();
              ctx.setLineDash([]);
              
              // Arrowhead
              const angle = Math.atan2(ey, ex);
              const headLen = 8;
              ctx.beginPath();
              ctx.moveTo(ex, ey);
              ctx.lineTo(ex - headLen * Math.cos(angle - Math.PI/6), ey - headLen * Math.sin(angle - Math.PI/6));
              ctx.lineTo(ex - headLen * Math.cos(angle + Math.PI/6), ey - headLen * Math.sin(angle + Math.PI/6));
              ctx.closePath();
              ctx.fillStyle = '#ffff00';
              ctx.fill();

              ctx.restore();
          }
      }

      // Render Health Bar (World Space, No Rotation)
      this.renderHealthBar(ctx, entity, rx, ry);
    });
  }

  private renderHealthBar(ctx: CanvasRenderingContext2D, entity: GameEntity, rx: number, ry: number) {
      // Only render for Player and Enemies
      if ((entity.type !== EntityType.PLAYER && entity.type !== EntityType.ENEMY) || entity.maxHealth <= 0) return;
      // Bubbles (ambient fauna) carry no health bar — keep them reading as
      // neutral blobs, not tracked combatants.
      if (entity.enemyShape === 'bubble') return;

      const { PLAYER_WIDTH, PLAYER_HEIGHT, ENEMY_WIDTH, ENEMY_HEIGHT, OFFSET_MODIFIER, OFFSET_BASE } = UI_CONSTANTS.HEALTH_BAR;

      const isPlayer = entity.type === EntityType.PLAYER;

      const width = isPlayer ? PLAYER_WIDTH : ENEMY_WIDTH;
      const height = isPlayer ? PLAYER_HEIGHT : ENEMY_HEIGHT;

      // Calculate offset based on visual size approx
      const visualRadius = Math.max(entity.size.x, entity.size.y) * OFFSET_MODIFIER;
      const yOffset = visualRadius + OFFSET_BASE;

      const x = rx - width / 2;
      const y = ry + yOffset;
      
      const healthPct = Math.max(0, Math.min(1, entity.health / entity.maxHealth));

      // Background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(x, y, width, height);

      // Fill Color — player + normal enemy bars are red; rival bars take the
      // disposition team colour (red hostile / green ally / amber neutral) so the
      // bar doubles as the at-a-glance intent cue (replacing the removed ring).
      ctx.fillStyle = entity.isRival ? (entity.color || '#ef4444') : '#ef4444';

      ctx.fillRect(x, y, width * healthPct, height);

      // Shield bar — thin blue bar below health bar (player only)
      if (isPlayer && entity.maxShield && entity.maxShield > 0) {
          const shieldY = y + height + 1;
          const shieldHeight = height - 1;
          const shieldPct = Math.max(0, Math.min(1, (entity.shield ?? 0) / entity.maxShield));
          ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
          ctx.fillRect(x, shieldY, width, shieldHeight);
          ctx.fillStyle = SHIELD_COLOR;
          ctx.fillRect(x, shieldY, width * shieldPct, shieldHeight);
      }
  }

  // Native enemy rendering — a distinct procedural polygon per archetype
  // (entity.enemyShape) so types read by silhouette without sprite art.
  // Assumes the canvas transform is already translated to the entity centre
  // and rotated to its facing (shapes point along +x).  Includes the
  // hit-flash scale-punch + whiten and a shield ring when shielded.
  // Local space here has +x pointing along the enemy's nose and the origin
  // at its centroid (the per-entity transform at the top of the slow path
  // bakes rotation in), so the tail is at -x.
  private drawEnemyShape(ctx: CanvasRenderingContext2D, entity: GameEntity, nowSec: number) {
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
          this.buildEnemyPath(ctx, shape, rg);
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
              ctx.beginPath();
              ctx.arc(0, 0, r * 1.4, 0, Math.PI * 2);
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
      this.buildEnemyPath(ctx, shape, r);
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
          this.buildEnemyPath(ctx, shape, r);
          ctx.clip();
          drawDamageCracks(ctx, r, seed, hits, dmgFrac, ENEMY_CRACK_STYLE);
          ctx.restore();
          // The crack loop's beginPath() clobbered the body path; rebuild it
          // so the outline stroke below still traces the silhouette.
          this.buildEnemyPath(ctx, shape, r);
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

  private buildEnemyPath(ctx: CanvasRenderingContext2D, shape: string, r: number) {
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

  // Dragon body (Stage 6): a chain of tapering segments along the head's
  // recorded path (`dragonPath`), drawn tail→head so the head end overlaps on
  // top.  World space (camera-base transform active).  Segment count + radius
  // scale with the head's grown size.  Toroidal via shiftX/shiftY.
  private renderDragonBodies(ctx: CanvasRenderingContext2D, entities: GameEntity[], camera: CameraState) {
      const camX = camera.position.x, camY = camera.position.y;
      const D = DRAGON_CONSTANTS;
      const TWO_PI = Math.PI * 2;
      for (let e = 0; e < entities.length; e++) {
          const d = entities[e];
          if (!d.active || d.enemyShape !== 'dragon' || !d.dragonPath || d.dragonPath.length < 2) continue;
          const path = d.dragonPath;
          const headR = Math.max(d.size.x, d.size.y) * 0.5;
          const segR0 = headR * D.BODY_RADIUS_FRAC;
          const grown = Math.max(0, Math.floor((Math.max(d.size.x, d.size.y) - 64) / D.SEG_PER_SIZE));
          const segCount = Math.max(0, Math.min(D.SEGMENTS + grown, Math.floor((path.length - 1) / D.SEGMENT_STRIDE)));
          const [cr, cg, cb] = hexToRgb(d.color || D.COLOR);
          const dark = `rgb(${Math.max(0, cr - 55)},${Math.max(0, cg - 55)},${Math.max(0, cb - 55)})`;
          for (let i = segCount; i >= 1; i--) {
              const p = path[Math.min(i * D.SEGMENT_STRIDE, path.length - 1)];
              const r = segR0 * Math.pow(D.SEGMENT_TAPER, i);
              ctx.save();
              ctx.translate(shiftX(camX, p.x), shiftY(camY, p.y));
              ctx.beginPath(); ctx.arc(0, 0, r, 0, TWO_PI);
              ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
              ctx.fill();
              ctx.lineWidth = 2; ctx.strokeStyle = dark; ctx.stroke();
              // dorsal scale ridge — a small darker diamond on the spine
              ctx.beginPath();
              ctx.moveTo(0, -r * 0.55); ctx.lineTo(r * 0.28, 0);
              ctx.lineTo(0, r * 0.55); ctx.lineTo(-r * 0.28, 0); ctx.closePath();
              ctx.fillStyle = dark; ctx.fill();
              ctx.restore();
          }
      }
  }

  private renderDamageTexts(ctx: CanvasRenderingContext2D, texts: DamageText[], camera: CameraState) {
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
  private timedTileBloom(
      ctx: CanvasRenderingContext2D,
      entity: GameEntity,
      playerPos: Vector2 | undefined,
  ): void {
      const t = performance.now();
      this.renderProximityBloom(ctx, entity, playerPos);
      const elapsed = performance.now() - t;
      this.lastTileLightingMs += elapsed;
      if (elapsed > 0.001) this.lastTileLightingCount++;
  }

  private renderProximityBloom(
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


  /** World → SCREEN (CSS px), mirroring the camera transform the draw pass
   *  applies: centre, zoom, camera position + shake, toroidal shift.  Returns
   *  null before the context exists.  Used by GameEngine to hit-test a tap
   *  against the player's ship. */
  public worldToScreen(camera: CameraState, pos: Vector2): Vector2 | null {
      const ctx = this.ctx;
      if (!ctx) return null;
      const dpr = effectiveDpr();
      const width = (ctx.canvas.width || 0) / dpr;
      const height = (ctx.canvas.height || 0) / dpr;
      const shake = camera.shakeOffset ?? { x: 0, y: 0 };
      const rx = shiftX(camera.position.x, pos.x);
      const ry = shiftY(camera.position.y, pos.y);
      return {
          x: width / 2 + (rx - camera.position.x + shake.x) * camera.zoom,
          y: height / 2 + (ry - camera.position.y + shake.y) * camera.zoom,
      };
  }

  private renderIndicators(
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
          if (this.chevronsOffscreenOnly && item.onScreen && !isPortal) continue;

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

  private renderPlayerMessages(
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
  private renderLoadoutHUD(
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

  private renderMinimap(
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
      const staticRange = this._minimapStaticRange || Infinity;
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
      const staticCanvas = this._minimapStaticCanvas;
      if (staticCanvas) {
          const staticRange = this._minimapStaticRange;
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
  private fitFontPx(
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

  private renderWaveAnnouncements(
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
          const mainPx = this.fitFontPx(ctx, a.text, safe,
              WAVE_ANNOUNCE_CONSTANTS.TEXT_PX, WAVE_ANNOUNCE_CONSTANTS.TEXT_MIN_PX);

          // Main text
          ctx.font = `bold ${mainPx}px monospace`;
          ctx.fillStyle = a.color;
          ctx.fillText(a.text, width / 2, baseY - (a.subtext ? mainPx * 0.58 : 0));

          // Subtext (smaller, cyan)
          if (a.subtext) {
              const subPx = this.fitFontPx(ctx, a.subtext, safe,
                  WAVE_ANNOUNCE_CONSTANTS.SUBTEXT_PX, WAVE_ANNOUNCE_CONSTANTS.SUBTEXT_MIN_PX);
              ctx.font = `bold ${subPx}px monospace`;
              ctx.fillStyle = '#22d3ee';
              ctx.fillText(a.subtext, width / 2, baseY);
          }

          ctx.restore();
      }
  }
}
