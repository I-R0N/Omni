

import { GameEntity, Vector2, MapType, CameraState, EntityType, DamageText, PlayerHUDMessage, WeaponType, WaveAnnouncement, TrailPoint, TrailShape } from '../../types';
import { COLORS, ASSETS, MINIMAP_CONSTANTS, UI_CONSTANTS, CAMERA_CONSTANTS, SPRITE_CONSTANTS, WEAPONS, WEAPON_LIST, AMMO_HUD_CONSTANTS, AMMO_CONSTANTS, computeAmmoHUDLayout, SHIELD_CONSTANTS, REGEN_POP_CONSTANTS, WAVE_ANNOUNCE_CONSTANTS, NEBULA_CONSTANTS, PLAYER_TRAIL_CONSTANTS, INPUT_CONSTANTS, CHARGE_CONSTANTS, densityTintMultiplier, SHARD_VARIANTS } from '../../constants';
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

  public setDebugMode(v: boolean) { this.debugMode = v; }
  public setTrailShape(s: TrailShape) { this.trailShape = s; }

  // Optional PhysicsSystem reference for spatial queries — today only the
  // material-tile branch uses it (to suppress edge strokes on edges that
  // are cleanly butted against a neighbour tile).  Null is treated as "no
  // neighbour data available" → fall back to drawing the full outline.
  private physics: import('./PhysicsSystem').PhysicsSystem | null = null;
  public setPhysics(p: import('./PhysicsSystem').PhysicsSystem) { this.physics = p; }

  private images: Map<string, HTMLImageElement> = new Map();
  // Optimization: Reusable buffer for sorting indicators to prevent array allocation
  private _indicatorBuffer: { entity: GameEntity, distSq: number }[] = [];
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
  // Render buffers.  Each entry carries the entity AND its camera-local
  // render coords (rx, ry) — computed once at cull time so the draw pass
  // can translate to the right shifted position without recomputing.
  // Toroidal maps require this because an entity near the wrap seam
  // must render at position ±MAP_WIDTH / ±MAP_HEIGHT from its canonical
  // coord to appear in the right on-screen spot.
  private _visibleEntities: { entity: GameEntity, rx: number, ry: number }[] = [];
  // Separate render bucket for nebula tiles and shards so they always
  // render BELOW asteroids / actors / other entities regardless of their
  // order in currentMap.entities.  Runtime-spawned nebula tiles (from
  // shard transmutation) get pushed to the end of the entities array, so
  // a naive single-pass loop would render them on top of asteroids.
  private _nebulaEntities: { entity: GameEntity, rx: number, ry: number }[] = [];
  private _trailEntities: { entity: GameEntity, rx: number, ry: number }[] = [];
  private _particleBuffer: { entity: GameEntity, rx: number, ry: number }[] = [];
  private _minimapBuffer: { entity: GameEntity, dx: number, dy: number }[] = [];
  private _attractors: GameEntity[] = [];

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

  public render(
    entities: GameEntity[],
    camera: CameraState,
    mapType: MapType,
    minimapExpanded: boolean = false,
    damageTexts?: DamageText[],
    playerPos?: Vector2,
    playerMessages?: PlayerHUDMessage[],
    player?: GameEntity,
    waveAnnouncements?: WaveAnnouncement[]
  ) {
    const t0 = performance.now();
    if (!this.ctx) { this.lastRenderMs = performance.now() - t0; return; }
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const width = (ctx.canvas.width || 0) / dpr;
    const height = (ctx.canvas.height || 0) / dpr;

    // Crisp pixels for sprite scaling
    ctx.imageSmoothingEnabled = false;

    // Guard against 0 dimensions
    if (width === 0 || height === 0) return;

    // Build per-frame buckets in a single pass
    this._attractors.length = 0;
    this._visibleEntities.length = 0;
    this._nebulaEntities.length = 0;
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
            this._visibleEntities.push({ entity, rx, ry });
            continue;
        }

        // Allow inactive tiles that are regenerating to pass through for ghost rendering
        if (!entity.active) continue;

        const dx = rx - camX;
        const dy = ry - camY;

        if (entity.type === EntityType.INTERACTABLE && entity.gravityStrength && entity.gravityStrength > 500) {
            this._attractors.push(entity);
        }

        if (entity.type === EntityType.ENEMY || (entity.type === EntityType.INTERACTABLE && !entity.dropType)) {
            const distSq = dx*dx + dy*dy;
            if (entity.type !== EntityType.ENEMY || distSq <= 500 * 500) {
                this._indicatorBuffer.push({ entity, distSq });
            }
        }

        // Structures use the pre-rendered static minimap layer — skip them
        // here to avoid ~22k per-frame object allocations + fillRect calls.
        if (entity.type !== EntityType.PLAYER && entity.type !== EntityType.PROJECTILE && entity.type !== EntityType.PARTICLE
                && entity.shardVariant !== 'nebula-tile' && entity.shardVariant !== 'nebula-shard'
                && !(entity.type === EntityType.INTERACTABLE && entity.dropType && entity.dropType !== 'health')) {
            this._minimapBuffer.push({ entity, dx, dy });
        }

        if (rx < left || rx > right || ry < top || ry > bottom) {
            continue;
        }

        // Particles go to a separate buffer for single-pass 'lighter' composite rendering
        if (entity.type === EntityType.PARTICLE) {
            this._particleBuffer.push({ entity, rx, ry });
        } else if (entity.shardVariant === 'nebula-tile' || entity.shardVariant === 'nebula-shard') {
            // Nebula entities render as a dedicated bottom layer so
            // asteroids / actors / projectiles always draw on top of
            // them, regardless of entity array order.
            this._nebulaEntities.push({ entity, rx, ry });
        } else {
            this._visibleEntities.push({ entity, rx, ry });
        }

        // Player trail = independent expanding rings (one is enough to draw);
        // projectile trail = polygon strip (needs at least two points).
        if (entity.trail && entity.trail.length > 0 && (entity.type === EntityType.PLAYER || entity.type === EntityType.PROJECTILE)) {
            this._trailEntities.push({ entity, rx, ry });
        }
    }

    // Snapshot the visible-nebula count after the cull bucket is built
    // so the dev overlay can report it alongside the nebula sub-timer.
    this.lastNebulaVisible = this._nebulaEntities.length;
    // Reset the per-frame fast/slow split — incremented inside
    // renderEntities below as each nebula entity is dispatched.
    this.lastNebulaFastCount = 0;
    this.lastNebulaSlowCount = 0;

    // Sort indicators once for the frame
    this._indicatorBuffer.sort((a, b) => b.distSq - a.distSq);

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

    // 3. Render Trails (Behind Entities)
    this.renderTrails(ctx, this._trailEntities, camera);

    // 4. Render Nebulas (bottom layer) — tiles + shards draw first so
    // asteroids and everything else render on top of the nebula cloud.
    // Wrapped in its own performance.now() bracket so the dev overlay
    // can show nebula-pass cost separately from the total render time.
    const tNebula0 = performance.now();
    this.renderEntities(ctx, this._nebulaEntities, camera, playerPos);
    this.lastNebulaMs = performance.now() - tNebula0;

    // 4a. Render Entities (Culling logic added)
    this.renderEntities(ctx, this._visibleEntities, camera, playerPos);

    // 4b. Render Particles — single composite-op switch for the whole batch
    this.renderParticles(ctx, this._particleBuffer, camera);

    // 5. Render Damage Text (World Space)
    if (damageTexts) {
        this.renderDamageTexts(ctx, damageTexts, camera);
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

    // 9. Render Ammo HUD (Screen Space)
    if (player) {
        this.renderAmmoHUD(ctx, player, width, height);
    }

    this.lastRenderMs = performance.now() - t0;
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
          } else if (entity.type === EntityType.PROJECTILE && entity.trail.length >= 2) {
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

  // Reusable scratch buffer for shifted trail coordinates — keeps the
  // trail path tool allocation-free even when every projectile in the
  // scene is rendering a 30-point trail.
  private _trailShiftedX: Float32Array = new Float32Array(64);
  private _trailShiftedY: Float32Array = new Float32Array(64);
  private _ensureTrailScratch(n: number) {
      if (this._trailShiftedX.length < n) {
          const next = Math.max(n, this._trailShiftedX.length * 2);
          this._trailShiftedX = new Float32Array(next);
          this._trailShiftedY = new Float32Array(next);
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

      // Forward pass: Right side of trail
      for (let i = 0; i < t.length; i++) {
          const p = t[i];
          const ratio = p.lifetime / p.maxLifetime;
          if (ratio <= 0) continue;
          const width = (p.scale ?? 1) * (1 + (ratio * 5)) / 2; // Half width

          // Simple normal calculation (perpendicular to velocity approximation)
          // For first point, use next point. For last, use prev.
          let nx = 0, ny = 0;
          if (i < t.length - 1) {
              const dx = sx[i+1] - sx[i];
              const dy = sy[i+1] - sy[i];
              const len = Math.sqrt(dx*dx + dy*dy) || 1;
              nx = -dy / len;
              ny = dx / len;
          } else if (i > 0) {
              const dx = sx[i] - sx[i-1];
              const dy = sy[i] - sy[i-1];
              const len = Math.sqrt(dx*dx + dy*dy) || 1;
              nx = -dy / len;
              ny = dx / len;
          }

          ctx.lineTo(sx[i] + nx * width, sy[i] + ny * width);
      }

      // Backward pass: Left side of trail
      for (let i = t.length - 1; i >= 0; i--) {
          const p = t[i];
          const ratio = p.lifetime / p.maxLifetime;
          if (ratio <= 0) continue;
          const width = (p.scale ?? 1) * (1 + (ratio * 5)) / 2;

          let nx = 0, ny = 0;
          if (i < t.length - 1) {
              const dx = sx[i+1] - sx[i];
              const dy = sy[i+1] - sy[i];
              const len = Math.sqrt(dx*dx + dy*dy) || 1;
              nx = -dy / len;
              ny = dx / len;
          } else if (i > 0) {
              const dx = sx[i] - sx[i-1];
              const dy = sy[i] - sy[i-1];
              const len = Math.sqrt(dx*dx + dy*dy) || 1;
              nx = -dy / len;
              ny = dx / len;
          }

          ctx.lineTo(sx[i] - nx * width, sy[i] - ny * width);
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
      for (let i = 0; i < entries.length; i++) {
          const { entity: p, rx, ry } = entries[i];

          // Lightning arc particles use a dedicated renderer
          if (p.isLightningArc) {
              this.renderLightningArc(ctx, p, camera);
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
              continue;
          }

          const lifeRatio = (p.lifetime || 0) / (p.maxLifetime || 1);
          ctx.globalAlpha = lifeRatio;
          ctx.fillStyle = p.color;
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
      // Cheap squared-distance check; no allocation.
      let inGlowRange = false;
      if (isGlassFamilyStaticTile && playerPos && entity.shardVariant !== undefined) {
          const fpGlow = SHARD_VARIANTS[entity.shardVariant].glow;
          if (fpGlow !== undefined) {
              const fpdx = wrapDeltaX(entity.position.x, playerPos.x);
              const fpdy = wrapDeltaY(entity.position.y, playerPos.y);
              inGlowRange = fpdx * fpdx + fpdy * fpdy < fpGlow.range * fpGlow.range;
          }
      }
      if (isGlassFamilyStaticTile
          && entity.active && hexReady
          && !entity.hitFlash && entity.regenPopTimer === undefined
          && !inGlowRange) {
          const maxDim = Math.max(entity.size.x, entity.size.y);
          const drawSize = maxDim * 1.02;
          const dHalf = drawSize / 2;
          ctx.drawImage(hexSprite, rx - dHalf, ry - dHalf, drawSize, drawSize);
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
          && entity.nebulaFadeTimer === undefined
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
        entity.type === EntityType.PLAYER
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
          const fadeDuration = entity.nebulaFadeDuration ?? NEBULA_CONSTANTS.FADE_DURATION;
          const fadeMul = entity.nebulaFadeTimer !== undefined && entity.nebulaFadeTimer > 0 && fadeDuration > 0
              ? Math.max(0, entity.nebulaFadeTimer / fadeDuration)
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
                  // Soft alpha — tiles slightly more opaque so the cloud
                  // reads as solid, shards slightly less so they feel light.
                  ctx.globalAlpha = (isTile ? 0.55 : 0.45) * fadeMul * spawnMul * speedMul;
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
          if (this.debugMode) {
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

                  const drawSize = maxDim * drawScale;
                  const dOffset = -(drawSize / 2);

                  ctx.drawImage(img, dOffset, dOffset, drawSize, drawSize);

                  // Hit flash: re-draw with brightness instead of filling the bounding box (prevents white square)
                  if (entity.hitFlash && entity.hitFlash > 0) {
                      ctx.save();
                      ctx.globalAlpha = Math.min(1, 0.6 + (entity.hitFlash * 2));
                      ctx.filter = 'brightness(1.35)';
                      ctx.drawImage(img, dOffset, dOffset, drawSize, drawSize);
                      ctx.filter = 'none';
                      ctx.restore();
                  }

                  // Crack overlay for multi-HP mobile shards (the same
                  // visual asteroids had on the legacy ASTEROID render).
                  if (entity.maxHealth > 1
                      && entity.type === EntityType.STRUCTURE && entity.mass !== Infinity) {
                      this.renderCracks(ctx, entity, drawSize/2);
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
          if (entity.type === EntityType.PLAYER) {
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
            // Material tiles (plastic / metal) — solid-color polygon fill
            // with per-variant alpha.  Distinct from glass-family because
            // they will dent in place (vertex jitter + scale-down) instead
            // of shattering.
            const isMaterialTile =
              entity.type === EntityType.STRUCTURE && entity.mass === Infinity
              && (entity.shardVariant === 'plastic-tile'
                  || entity.shardVariant === 'metal-tile');
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
                const isFlash = entity.hitFlash && entity.hitFlash > 0;

                // Proximity tint: edge shifts from cool blue-white → bright cyan.
                // Toroidal delta so tiles across a seam reveal the same tint
                // treatment as tiles on the same side of the map.
                const PROX_RANGE = 120;
                const pdx = playerPos ? wrapDeltaX(playerPos.x, entity.position.x) : Infinity;
                const pdy = playerPos ? wrapDeltaY(playerPos.y, entity.position.y) : Infinity;
                const prox = Math.max(0, 1 - Math.sqrt(pdx * pdx + pdy * pdy) / PROX_RANGE);

                const edgeR = Math.round(186 - prox * 83);
                const edgeG = Math.round(230 + prox * 2);
                const edgeB = Math.round(253 - prox * 4);
                const edgeAlpha = isFlash ? 0.95 : (0.55 + prox * 0.35);
                const edgeColor = isFlash ? '#ffffff' : `rgba(${edgeR},${edgeG},${edgeB},${edgeAlpha})`;

                // Layer 1 — translucent base fill
                buildPath();
                ctx.globalAlpha = isFlash ? 0.55 : 0.13;
                ctx.fillStyle = isFlash ? '#ffffff' : 'rgba(186,230,253,1)';
                ctx.fill();

                // Layer 2 — diagonal shine (flat fill avoids per-tile gradient allocation)
                if (!isFlash) {
                    ctx.globalAlpha = 0.09;
                    ctx.fillStyle = '#ffffff';
                    ctx.fill();
                }

                // Layer 2b — variant-driven additive glow.  Computes
                // intensity inline from the player position (same
                // pattern as the material-tile branch below) so the
                // visualization is independent of any upstream system
                // writing `entity.glowIntensity`.  Paints both a fill
                // and a thick stroke so the halo reads as a clear
                // "lit edge" — fill alone washes the hex out cyan but
                // doesn't pop as a beacon.
                if (!isFlash
                    && playerPos
                    && entity.shardVariant !== undefined) {
                    const glow = SHARD_VARIANTS[entity.shardVariant].glow;
                    if (glow !== undefined) {
                        const pdxG = wrapDeltaX(entity.position.x, playerPos.x);
                        const pdyG = wrapDeltaY(entity.position.y, playerPos.y);
                        const pdistSqG = pdxG * pdxG + pdyG * pdyG;
                        const rangeSqG = glow.range * glow.range;
                        if (pdistSqG < rangeSqG) {
                            const tG = 1 - Math.sqrt(pdistSqG) / glow.range;
                            const intensityG = tG * tG;
                            ctx.globalAlpha = glow.peakAlpha * intensityG;
                            ctx.fillStyle = glow.color;
                            ctx.fill();
                            ctx.globalAlpha = Math.max(0.4, glow.peakAlpha * intensityG);
                            ctx.strokeStyle = glow.color;
                            ctx.lineWidth = 3.0;
                            ctx.stroke();
                        }
                    }
                }

                // Layer 3 — edge stroke (proximity-tinted)
                ctx.globalAlpha = 1.0;
                ctx.strokeStyle = edgeColor;
                ctx.lineWidth = isFlash ? 2.5 : 1.5;
                ctx.stroke();

                // Layer 4 — small specular dot (upper-left of hex)
                // Uses a pre-rendered 12×12 bitmap instead of a per-tile gradient.
                if (!isFlash) {
                    ctx.globalAlpha = 0.28 + prox * 0.18;
                    ctx.drawImage(this.getSpecularBitmap(), -15, -17);
                }

                // Damage cracks (no-op for single-HP glass-tile; included
                // for parity with the historic multi-HP glass-family render
                // path).  renderCracks early-returns at ≥95 % health.
                this.renderCracks(ctx, entity, Math.max(entity.size.x, entity.size.y) / 2);

                } // end else (glass tile — paired with regen ghost if/else above)

            } else if (isMaterialTile) {
                // ── Material tile (plastic / metal) ────────────────────────
                // Solid-color polygon fill at variant-specific alpha.  No
                // glass overlay, no specular dot, no proximity tint — these
                // are matte / metallic surfaces, not translucent glass.  The
                // polygon shape is whatever the dent system has perturbed
                // entity.polygonPoints into; the renderer just draws it.
                const isFlash = entity.hitFlash && entity.hitFlash > 0;
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
                    ctx.fillStyle = isFlash ? flashColor : entity.color;
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

                    // Damage cracks for multi-HP variants — early-returns
                    // at ≥95 % health so undamaged tiles cost nothing.
                    // Sized to the dented polygon's max-radius (not
                    // entity.size, which the dent system deliberately
                    // doesn't shrink) so cracks stay inside the visible
                    // silhouette as vertices crumple inward.
                    let crackR = Math.max(entity.size.x, entity.size.y) / 2;
                    if (entity.polygonPoints && entity.polygonPoints.length > 0) {
                        let maxR2 = 0;
                        for (let i = 0; i < entity.polygonPoints.length; i++) {
                            const p = entity.polygonPoints[i];
                            const r2 = p.x * p.x + p.y * p.y;
                            if (r2 > maxR2) maxR2 = r2;
                        }
                        crackR = Math.sqrt(maxR2);
                    }
                    this.renderCracks(ctx, entity, crackR);

                    // Material-tile proximity glow — FILL ONLY.  Unlike
                    // the glass-family layer 2b (which also strokes the
                    // edges to make the cluster outline light up), metal
                    // only warms its face: paint the polygon with the
                    // variant's glow color at quadratic-falloff alpha,
                    // no edge stroke.  Painted LAST so the dark outline
                    // and crack overlay can't cover it.  Plain source-
                    // over (NOT additive 'lighter') so the face takes
                    // on the actual dark-orange hue — reads as "metal
                    // getting hot" rather than washing toward yellow-
                    // white.  Intensity is computed inline from the
                    // player position (same pattern as the glass
                    // branch) — no dependency on an upstream
                    // `glowIntensity` write.
                    if (!isFlash
                        && playerPos
                        && entity.shardVariant !== undefined) {
                        const glow = SHARD_VARIANTS[entity.shardVariant].glow;
                        if (glow !== undefined) {
                            const pdx = wrapDeltaX(entity.position.x, playerPos.x);
                            const pdy = wrapDeltaY(entity.position.y, playerPos.y);
                            const pdistSq = pdx * pdx + pdy * pdy;
                            const rangeSq = glow.range * glow.range;
                            if (pdistSq < rangeSq) {
                                const t = 1 - Math.sqrt(pdistSq) / glow.range;
                                const intensity = t * t;
                                // Rebuild the polygon path — the outline
                                // loop walked individual edges and left
                                // a non-closed sub-path behind.
                                buildPath();
                                ctx.globalAlpha = glow.peakAlpha * intensity;
                                ctx.fillStyle = glow.color;
                                ctx.fill();
                                ctx.globalAlpha = 1.0;
                            }
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
                const isFlash   = entity.hitFlash && entity.hitFlash > 0;
                const isTileShard = entity.shardVariant === 'glass-shard';
                const glowColor = entity.powerupGlowColor;

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
                    //  - plastic-shard renders at the same 0.6 alpha
                    //    as plastic-tile (translucent polymer).
                    //  - metal-shard stays on the gray palette even on
                    //    hit flash (no white) to match metal-tile.
                    //  - Other rocky shards (rock-shard, rock-tile)
                    //    keep their fully-opaque default.
                    const densityHex = densityTintForRender(entity, entity.color);
                    const fadeAlpha = shardMergeFadeAlpha(entity);
                    const flashColor = entity.shardVariant === 'metal-shard'
                        ? '#cbd5e1'
                        : '#ffffff';
                    const baseAlpha = entity.shardVariant === 'plastic-shard'
                        ? 0.6
                        : 1.0;
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
                    this.renderCracks(ctx, entity, entity.size.x / 2);
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

                    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR);
                    grad.addColorStop(0,    'rgba(255, 255, 235, 1)');    // hot white core
                    grad.addColorStop(0.10, 'rgba(255, 220, 100, 1)');    // pale yellow inner
                    grad.addColorStop(0.25, 'rgba(251, 146,  60, 1)');    // orange (orange-400)
                    grad.addColorStop(0.45, 'rgba(239,  68,  68, 0.85)'); // red (red-500)
                    grad.addColorStop(0.75, 'rgba(220,  38,  38, 0.25)'); // deep red glow
                    grad.addColorStop(1,    'rgba(220,  38,  38, 0)');

                    ctx.beginPath();
                    ctx.arc(0, 0, glowR, 0, Math.PI * 2);
                    ctx.fillStyle = grad;
                    ctx.fill();

                    ctx.restore();
                } else {
                    // ── Standard projectile: radial gradient glow ──
                    const pulse = 0.88 + Math.sin(nowSec * 14 + r * 1.3) * 0.12;
                    const glowR = r * pulse * 3.0;

                    const isEnemy = entity.ownerType === EntityType.ENEMY;
                    const [cr, cg, cb] = hexToRgb(entity.color || '#facc15');

                    ctx.save();
                    ctx.globalAlpha = Math.min(1, lifetimeFrac);

                    // Single merged gradient: hot white core → weapon colour → transparent glow.
                    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR);
                    if (isEnemy) {
                        grad.addColorStop(0,    'rgba(255, 255, 220, 1)');
                        grad.addColorStop(0.12, 'rgba(255, 180,  50, 1)');
                        grad.addColorStop(0.30, 'rgba(249, 115,  22, 0.8)');
                        grad.addColorStop(0.55, 'rgba(180,  40,   0, 0.25)');
                        grad.addColorStop(1,    'rgba(180,  40,   0, 0)');
                    } else {
                        grad.addColorStop(0,    'rgba(255, 255, 255, 1)');
                        grad.addColorStop(0.12, `rgba(${cr}, ${cg}, ${cb}, 1)`);
                        grad.addColorStop(0.30, `rgba(${cr}, ${cg}, ${cb}, 0.55)`);
                        grad.addColorStop(0.55, `rgba(${cr}, ${cg}, ${cb}, 0.15)`);
                        grad.addColorStop(1,    `rgba(${cr}, ${cg}, ${cb}, 0)`);
                    }
                    ctx.beginPath();
                    ctx.arc(0, 0, glowR, 0, Math.PI * 2);
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

                // Proximity tint — same formula as full tile (toroidal)
                const PROX_RANGE = 120;
                const pdx = playerPos ? wrapDeltaX(playerPos.x, entity.position.x) : Infinity;
                const pdy = playerPos ? wrapDeltaY(playerPos.y, entity.position.y) : Infinity;
                const prox = Math.max(0, 1 - Math.sqrt(pdx * pdx + pdy * pdy) / PROX_RANGE);
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

            } else if (entity.type === EntityType.INTERACTABLE && entity.dropType === 'health') {
                // ── Health heart — large static glowing heart ─────────────────
                const r     = entity.size.x * 0.38;
                const pulse = 0.88 + Math.sin(nowSec * 2.8) * 0.12;
                const [hr, hg, hb] = [239, 68, 68]; // #ef4444

                const drawHeart = () => {
                    ctx.beginPath();
                    ctx.moveTo(0, r * 0.38);
                    ctx.bezierCurveTo( r,      -r * 0.38,  r * 1.05, -r * 1.05,  0, -r * 0.55);
                    ctx.bezierCurveTo(-r * 1.05, -r * 1.05, -r,       -r * 0.38,  0,  r * 0.38);
                    ctx.closePath();
                };

                // Outer bloom
                const bloomR = r * 3.2 * pulse;
                const bloom  = ctx.createRadialGradient(0, 0, 0, 0, 0, bloomR);
                bloom.addColorStop(0,   `rgba(${hr},${hg},${hb},0.45)`);
                bloom.addColorStop(0.5, `rgba(${hr},${hg},${hb},0.18)`);
                bloom.addColorStop(1,   `rgba(${hr},${hg},${hb},0)`);
                ctx.globalAlpha = 1.0;
                ctx.beginPath();
                ctx.arc(0, 0, bloomR, 0, Math.PI * 2);
                ctx.fillStyle = bloom;
                ctx.fill();

                // Filled heart
                ctx.globalAlpha = 0.92 * pulse;
                ctx.fillStyle   = '#ef4444';
                drawHeart();
                ctx.fill();

                // Bright core highlight
                ctx.globalAlpha = 0.55 * pulse;
                ctx.fillStyle   = '#fca5a5';
                ctx.save();
                ctx.scale(0.55, 0.55);
                ctx.translate(0, -r * 0.1);
                drawHeart();
                ctx.restore();
                ctx.fill();

                // Crisp white outline
                ctx.globalAlpha = 0.7 * pulse;
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth   = 2;
                drawHeart();
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
                    coreColor = '#6ef09a'; rimColor = '#22c55e';
                    glowRgb = [74, 222, 128];
                } else if (entity.dropType === 'ammo') {
                    // Black core with a white rim + halo so ammo drops read
                    // distinctly against the colourful weapon palette and
                    // the yellow HUD readout.
                    coreColor = '#000000'; rimColor = '#ffffff';
                    glowRgb = [255, 255, 255];
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

      // Fill Color — player health bar is always red; enemy bars match enemy color
      if (isPlayer) {
          ctx.fillStyle = '#ef4444';
      } else {
          ctx.fillStyle = '#ef4444';
      }

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
          
          const scale = 1 + (1 - lifeRatio) * 0.5;
          ctx.scale(scale, scale);

          ctx.fillStyle = t.color;
          ctx.strokeStyle = 'black';
          ctx.lineWidth = 2;
          ctx.strokeText(t.text, 0, 0);
          ctx.fillText(t.text, 0, 0);
          
          ctx.restore();
      });
  }

  private renderCracks(ctx: CanvasRenderingContext2D, entity: GameEntity, radius: number) {
      if (entity.maxHealth > 1 && !entity.hitFlash) {
             const healthRatio = Math.max(0, entity.health / entity.maxHealth);
             if (healthRatio < 0.95) {
                 ctx.strokeStyle = 'rgba(15, 23, 42, 0.6)';
                 ctx.lineWidth = 2;
                 ctx.beginPath();
                 
                 const numPoints = entity.polygonPoints?.length || 8;
                 const damageFactor = 1.0 - healthRatio;
                 const totalCracks = Math.ceil(numPoints * damageFactor); 

                 for(let i=0; i<totalCracks; i++) {
                     const idx = (i * 2) % numPoints; 
                     
                     let startX, startY;

                     if (entity.polygonPoints && entity.polygonPoints[idx]) {
                        startX = entity.polygonPoints[idx].x;
                        startY = entity.polygonPoints[idx].y;
                     } else {
                        const angle = (idx / numPoints) * Math.PI * 2;
                        startX = Math.cos(angle) * radius;
                        startY = Math.sin(angle) * radius;
                     }

                     ctx.moveTo(startX, startY);
                     ctx.lineTo(startX * 0.4, startY * 0.4);
                 }
                 ctx.stroke();
             }
        }
  }

  private renderIndicators(
    ctx: CanvasRenderingContext2D, 
    targets: { entity: GameEntity, distSq: number }[], 
    camera: CameraState, 
    width: number, 
    height: number
  ) {
      const playerPos = camera.position;
      if (!Number.isFinite(playerPos.x) || !Number.isFinite(playerPos.y)) return;

      const { RADIUS, TEXT_THRESHOLD_ENEMY, TEXT_THRESHOLD_POI, MAX_VISIBLE } = UI_CONSTANTS.INDICATORS;

      if (targets.length === 0) return;

      const cx = width / 2;
      const cy = height / 2;
      
      // Limit drawing counts per type to avoid clutter, but keep sorted draw order
      let enemiesDrawn = 0;
      let poisDrawn = 0;

      for (let i = 0; i < targets.length; i++) {
          const item = targets[i];
          const t = item.entity;

          if (t.type === EntityType.ENEMY) {
              if (enemiesDrawn >= MAX_VISIBLE) continue;
              enemiesDrawn++;
          } else {
              if (poisDrawn >= MAX_VISIBLE) continue;
              poisDrawn++;
          }

          const dx = wrapDeltaX(playerPos.x, t.position.x);
          const dy = wrapDeltaY(playerPos.y, t.position.y);
          const angle = Math.atan2(dy, dx);

          // Skip if the enemy is already closer than the indicator ring
          const screenDist = Math.sqrt(item.distSq) * camera.zoom;
          if (t.type === EntityType.ENEMY && screenDist < RADIUS) continue;

          const ix = cx + Math.cos(angle) * RADIUS;
          const iy = cy + Math.sin(angle) * RADIUS;

          ctx.save();
          ctx.translate(ix, iy);
          ctx.rotate(angle);

          ctx.fillStyle = t.color;
          ctx.beginPath();

          if (t.type === EntityType.ENEMY) {
              // Caret (^) chevron pointing toward the enemy
              const w = 7, h = 9;
              ctx.moveTo( h,  0);      // tip
              ctx.lineTo(-h,  w);      // bottom-left
              ctx.lineTo(-h + 4,  0);  // inner notch
              ctx.lineTo(-h, -w);      // top-left
          } else {
              // Standard pointer for POIs
              ctx.moveTo(12, 0);
              ctx.lineTo(-8,  8);
              ctx.lineTo(-2,  0);
              ctx.lineTo(-8, -8);
          }

          ctx.closePath();
          ctx.fill();
          
          ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          ctx.lineWidth = 1;
          ctx.stroke();

          // Distance Text (only if far)
          const threshold = t.type === EntityType.ENEMY ? TEXT_THRESHOLD_ENEMY : TEXT_THRESHOLD_POI;

          if (item.distSq > threshold) { 
               ctx.rotate(-angle);
               ctx.fillStyle = 'rgba(255,255,255,0.7)';
               ctx.font = '10px monospace';
               ctx.textAlign = 'center';
               const d = Math.round(Math.sqrt(item.distSq));
               ctx.fillText(`${d}m`, 0, 24);
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

  private renderAmmoHUD(
      ctx: CanvasRenderingContext2D,
      player: GameEntity,
      width: number,
      height: number
  ) {
      const { SLOT_H, SLOT_GAP, SLOT_RADIUS: RADIUS } = AMMO_HUD_CONSTANTS;
      const { startY, slotW, blasterX, ammoX, weaponsStartX } = computeAmmoHUDLayout(width, height);
      const activeWeapon = player.currentWeapon ?? WeaponType.BLASTER;

      ctx.save();
      ctx.textAlign  = 'center';
      ctx.textBaseline = 'middle';

      const FLASH_DURATION = 0.75;
      const pool       = player.ammo ?? 0;
      const flash      = player.ammoPickupFlash;
      const flashT     = flash ? Math.max(0, flash.timer / FLASH_DURATION) : 0; // 1→0
      const isFlashing = flashT > 0;

      // Render a single weapon-picker slot (used for the blaster + every
      // other weapon).  The shared-pool readout is rendered separately
      // below in its own dedicated box.
      const drawWeaponSlot = (wType: WeaponType, x: number) => {
          const wCfg    = WEAPONS[wType];
          const y       = startY;
          const canFire = wCfg.ammoCost === 0 || pool >= wCfg.ammoCost;
          const active  = wType === activeWeapon;

          ctx.globalAlpha = canFire ? (active ? 0.92 : 0.65) : 0.28;
          ctx.fillStyle   = canFire ? (active ? wCfg.color : '#1e293b') : '#0f172a';
          ctx.beginPath();
          roundRectPath(ctx, x, y, slotW, SLOT_H, RADIUS);
          ctx.fill();

          ctx.globalAlpha = canFire ? (active ? 1.0 : 0.5) : 0.2;
          ctx.strokeStyle = active ? wCfg.color : (canFire ? '#475569' : '#1e293b');
          ctx.lineWidth   = active ? 2 : 1;
          ctx.beginPath();
          roundRectPath(ctx, x, y, slotW, SLOT_H, RADIUS);
          ctx.stroke();

          // Color pip
          ctx.globalAlpha = canFire ? 1.0 : 0.3;
          ctx.fillStyle   = wCfg.color;
          ctx.beginPath();
          ctx.arc(x + slotW / 2, y + 10, Math.max(3, slotW * 0.11), 0, Math.PI * 2);
          ctx.fill();

          if (slotW >= 28) {
              const label = wCfg.name.split(' ').map((w: string) => w[0]).join('').substring(0, 3);
              ctx.font        = `bold ${Math.max(7, Math.min(8, slotW * 0.19))}px monospace`;
              ctx.globalAlpha = canFire ? 0.7 : 0.2;
              ctx.fillStyle   = active ? '#ffffff' : '#94a3b8';
              ctx.fillText(label, x + slotW / 2, y + SLOT_H / 2 + 4);
          }
      };

      // Blaster (always-firable, infinite ammo)
      drawWeaponSlot(WEAPON_LIST[0], blasterX);

      // Non-blaster weapons (ammo-gated)
      for (let i = 1; i < WEAPON_LIST.length; i++) {
          drawWeaponSlot(WEAPON_LIST[i], weaponsStartX + (i - 1) * (slotW + SLOT_GAP));
      }

      // ── Shared-pool readout ────────────────────────────────────────────
      // Dedicated slot-sized box between blaster and the rest.  Always
      // shows the current shared-ammo number; flashes yellow on pickup.
      {
          const x = ammoX;
          const y = startY;
          const ammoLabel = String(pool);
          const fontSize  = Math.max(13, Math.min(18, slotW * 0.42));

          // Slot background — neutral slate so it reads as a readout, not a button
          ctx.globalAlpha = 0.7;
          ctx.fillStyle   = '#0f172a';
          ctx.beginPath();
          roundRectPath(ctx, x, y, slotW, SLOT_H, RADIUS);
          ctx.fill();

          // Yellow flash overlay on pickup
          if (isFlashing) {
              const [fr, fg, fb] = hexToRgb(AMMO_CONSTANTS.DROP_COLOR);
              ctx.globalAlpha = flashT * 0.55;
              ctx.fillStyle   = `rgb(${fr},${fg},${fb})`;
              ctx.beginPath();
              roundRectPath(ctx, x, y, slotW, SLOT_H, RADIUS);
              ctx.fill();
          }

          // Border — yellow when flashing, otherwise neutral
          ctx.globalAlpha = isFlashing ? (0.5 + flashT * 0.5) : 0.6;
          ctx.strokeStyle = isFlashing ? AMMO_CONSTANTS.DROP_COLOR : '#475569';
          ctx.lineWidth   = isFlashing ? 2 : 1;
          ctx.beginPath();
          roundRectPath(ctx, x, y, slotW, SLOT_H, RADIUS);
          ctx.stroke();

          // "AMMO" label across the top
          if (slotW >= 28) {
              ctx.font        = `bold ${Math.max(7, Math.min(8, slotW * 0.19))}px monospace`;
              ctx.globalAlpha = 0.7;
              ctx.fillStyle   = AMMO_CONSTANTS.DROP_COLOR;
              ctx.fillText('AMMO', x + slotW / 2, y + 10);
          }

          // Big shared-pool number
          ctx.font        = `bold ${fontSize}px monospace`;
          ctx.globalAlpha = pool > 0 ? 1.0 : 0.45;
          ctx.fillStyle   = '#ffffff';
          ctx.shadowColor = 'rgba(0,0,0,0.8)';
          ctx.shadowBlur  = 3;
          ctx.fillText(ammoLabel, x + slotW / 2, y + SLOT_H - 14);
          ctx.shadowBlur  = 0;

          // Floating +N pickup text
          if (isFlashing && flash) {
              const rise    = (1 - flashT) * 22;
              const alpha   = flashT > 0.5 ? 1.0 : flashT * 2;
              const textY   = y - 6 - rise;
              ctx.font        = `bold ${Math.max(10, slotW * 0.3)}px monospace`;
              ctx.globalAlpha = alpha;
              ctx.fillStyle   = AMMO_CONSTANTS.DROP_COLOR;
              ctx.shadowColor = 'rgba(0,0,0,0.9)';
              ctx.shadowBlur  = 4;
              ctx.fillText(`+${flash.amount}`, x + slotW / 2, textY);
              ctx.shadowBlur  = 0;
          }
      }

      ctx.globalAlpha = 1;
      ctx.shadowBlur  = 0;
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
      const mapY = screenHeight - currentSize - AMMO_HUD_CONSTANTS.BOTTOM_MARGIN;

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
      for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const entity = item.entity;
          if (!entity.active) continue;

          const dotX = centerX + item.dx * scale;
          const dotY = centerY + item.dy * scale;

          if (dotX < mapX || dotX > mapX + currentSize || dotY < mapY || dotY > mapY + currentSize) continue;

          ctx.fillStyle = entity.color;

          let dotRadius = 1.5;
          if (entity.type === EntityType.INTERACTABLE) dotRadius = 3;
          if (entity.type === EntityType.ENEMY) dotRadius = 2;

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

          // Main text
          ctx.font = 'bold 48px monospace';
          ctx.fillStyle = a.color;
          ctx.fillText(a.text, width / 2, baseY - (a.subtext ? 28 : 0));

          // Subtext (smaller, cyan)
          if (a.subtext) {
              ctx.font = 'bold 24px monospace';
              ctx.fillStyle = '#22d3ee';
              ctx.fillText(a.subtext, width / 2, baseY);
          }

          ctx.restore();
      }
  }
}
