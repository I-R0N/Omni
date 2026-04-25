

import { GameEntity, Vector2, MapType, CameraState, EntityType, DamageText, PlayerHUDMessage, WeaponType, WaveAnnouncement, TrailPoint } from '../../types';
import { COLORS, ASSETS, MINIMAP_CONSTANTS, UI_CONSTANTS, CAMERA_CONSTANTS, SPRITE_CONSTANTS, WEAPONS, WEAPON_LIST, AMMO_HUD_CONSTANTS, computeAmmoHUDLayout, SHIELD_CONSTANTS, REGEN_POP_CONSTANTS, WAVE_ANNOUNCE_CONSTANTS, NEBULA_CONSTANTS } from '../../constants';
import { BackgroundManager } from './BackgroundManager';
import { blendCompositionToHex } from '../NebulaColor';
import { HEX_AREA } from '../maps/TileGenerator';
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

  // Perf instrumentation — wall time (ms) of the most recent render() call.
  // Written at the end of render() and read by GameEngine for the dev perf
  // overlay.  render() is a single top-level pass so one timer covers it.
  public lastRenderMs: number = 0;
  // Sub-timer for the dedicated nebula-tile / shard pass.  Lets the dev
  // overlay show what fraction of the total render budget is spent on
  // nebula entities, which is the primary suspect for the high render
  // cost on the NebulaFieldMap.
  public lastNebulaMs: number = 0;

  // ── Render-path ablation toggles ───────────────────────────────────
  // Both default off (production behaviour preserved) and are flipped
  // from the debug panel so the dev can A/B compare render-time on the
  // same map without a rebuild.  Each one is a perf experiment, not a
  // permanent feature — see the corresponding gates inside render() /
  // BackgroundManager for the actual early-return.
  private suppressNebulaTwinkle: boolean = false;
  public setSuppressNebulaTwinkle(v: boolean) { this.suppressNebulaTwinkle = v; }
  public getSuppressNebulaTwinkle(): boolean { return this.suppressNebulaTwinkle; }
  public setSuppressBackgroundPuffs(v: boolean) {
      this.backgroundManager.setSuppressNebulaPuffs(v);
  }
  public getSuppressBackgroundPuffs(): boolean {
      return this.backgroundManager.getSuppressNebulaPuffs();
  }
  // Skip the foreground nebula tile / shard sprite blit while keeping the
  // surrounding ctx.save / translate / rotate / restore wrapper.  Isolates
  // GPU fillrate (drawImage at TILE_SPRITE_WORLD_SIZE with globalAlpha<1)
  // from canvas-state overhead.
  private suppressNebulaSprite: boolean = false;
  public setSuppressNebulaSprite(v: boolean) { this.suppressNebulaSprite = v; }
  public getSuppressNebulaSprite(): boolean { return this.suppressNebulaSprite; }
  // Skip the per-frame neighbour-count darken-hex rebuild and use the
  // cached blendedHex directly.  Isolates per-tile string allocation +
  // Map-key churn from the rest of the nebula draw path.
  private suppressNebulaDarken: boolean = false;
  public setSuppressNebulaDarken(v: boolean) { this.suppressNebulaDarken = v; }
  public getSuppressNebulaDarken(): boolean { return this.suppressNebulaDarken; }

  public setDebugMode(v: boolean) { this.debugMode = v; }
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
   */
  private getTintedSprite(src: string, hex: string): HTMLCanvasElement | null {
      const key = `${src}|${hex}`;
      const cached = this._tintedSprites.get(key);
      if (cached) return cached;
      const img = this.getImage(src);
      if (!img.complete || img.naturalWidth === 0) return null;

      const size = 256; // power of 2 to keep upscaling crisp enough
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
          if (!e.active || e.type !== EntityType.STRUCTURE) continue;
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
    waveAnnouncements?: WaveAnnouncement[],
    detachedTrails?: TrailPoint[][]
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
        if (entity.type === EntityType.STRUCTURE) {
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
                && entity.type !== EntityType.NEBULA && entity.type !== EntityType.NEBULA_SHARD
                && !(entity.type === EntityType.INTERACTABLE && entity.dropType && entity.dropType !== 'health')) {
            this._minimapBuffer.push({ entity, dx, dy });
        }

        if (rx < left || rx > right || ry < top || ry > bottom) {
            continue;
        }

        // Particles go to a separate buffer for single-pass 'lighter' composite rendering
        if (entity.type === EntityType.PARTICLE) {
            this._particleBuffer.push({ entity, rx, ry });
        } else if (entity.type === EntityType.NEBULA || entity.type === EntityType.NEBULA_SHARD) {
            // Nebula entities render as a dedicated bottom layer so
            // asteroids / actors / projectiles always draw on top of
            // them, regardless of entity array order.
            this._nebulaEntities.push({ entity, rx, ry });
        } else {
            this._visibleEntities.push({ entity, rx, ry });
        }

        if (entity.trail && entity.trail.length > 1 && (entity.type === EntityType.PLAYER || entity.type === EntityType.PROJECTILE)) {
            this._trailEntities.push({ entity, rx, ry });
        }
    }

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
    this.renderTrails(ctx, this._trailEntities, camera, detachedTrails);

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
      detachedTrails?: TrailPoint[][]
  ) {
      entries.forEach(({ entity }) => {
          if (!entity.active || !entity.trail || entity.trail.length < 2) return;
          if (entity.type !== EntityType.PLAYER && entity.type !== EntityType.PROJECTILE) return;
          const mode: 'player' | 'projectile' = entity.type === EntityType.PROJECTILE ? 'projectile' : 'player';
          this.drawTrailStrip(ctx, entity.trail, mode, camera, entity.color, entity.isBouncer);
      });

      // Detached trails from prior thrust events — always rendered as player
      // exhaust since only the player creates them.
      if (detachedTrails) {
          for (let i = 0; i < detachedTrails.length; i++) {
              const t = detachedTrails[i];
              if (t.length >= 2) {
                  this.drawTrailStrip(ctx, t, 'player', camera);
              }
          }
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
      mode: 'player' | 'projectile',
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

      // Create gradient for fade effect — alpha max scales with the head
      // point's own lifetime so detached, fading trails dim uniformly as
      // their newest point ages out.
      const head = t[t.length - 1];
      const tail = t[0];
      const headRatio = Math.max(0, Math.min(1, head.lifetime / head.maxLifetime));
      if (isBouncer) {
          // Bouncer beam: solid pure-green line with no fade along the trail.
          // The short lifetime already makes the beam self-limiting; we want
          // it sharp while it's visible.
          const [r, g, b] = hexToRgb(entityColor || '#22c55e');
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 1)`;
      } else {
          const grad = ctx.createLinearGradient(sx[0], sy[0], sx[t.length - 1], sy[t.length - 1]);
          if (mode === 'projectile') {
              const [r, g, b] = hexToRgb(entityColor || '#facc15');
              grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
              grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${0.75 * headRatio})`);
          } else {
              // Player: cyan engine exhaust
              grad.addColorStop(0, `rgba(56, 189, 248, 0)`);
              grad.addColorStop(1, `rgba(56, 189, 248, ${0.6 * headRatio})`);
          }
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

    // Cache the structure sprite once.  Prior to this, getImage() was
    // called once per visible tile (200-400×) to look up the same image.
    const hexSprite = this.getImage(ASSETS.HEX_STRUCTURE);
    const hexReady = hexSprite.complete && hexSprite.naturalWidth > 0;

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
      // pop, regen ghost) fall back to the slow generic path.
      if (entity.type === EntityType.STRUCTURE && entity.active && hexReady
          && !entity.hitFlash && entity.regenPopTimer === undefined) {
          const maxDim = Math.max(entity.size.x, entity.size.y);
          const drawSize = maxDim * 1.02;
          const dHalf = drawSize / 2;
          ctx.drawImage(hexSprite, rx - dHalf, ry - dHalf, drawSize, drawSize);
          return;
      }

      ctx.save();

      // Transform logic — translate to the entity's shifted render
      // position so wrap-seam copies draw at the correct on-screen spot.
      ctx.translate(rx, ry);
      const rotation = entity.rotation + (
        entity.type === EntityType.PLAYER
          ? SPRITE_CONSTANTS.PLAYER_ROTATION_OFFSET
          : entity.type === EntityType.ENEMY
            ? SPRITE_CONSTANTS.ENEMY_ROTATION_OFFSET
            : 0
      );
      ctx.rotate(rotation);

      // --- NEBULA TILES & SHARDS ---
      // Cloud-like rendering: tinted sprite drawn at a display-scale larger
      // than the physics size so adjacent tiles blend seamlessly across
      // their shared hex-grid boundaries.  Tinted sprites are cached.
      if (entity.type === EntityType.NEBULA || entity.type === EntityType.NEBULA_SHARD) {
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
          // Dev ablation: skip the per-frame string allocation + Map-key
          // churn so the cost can be measured against the nebula sub-timer.
          if (entity.type === EntityType.NEBULA && entity.nebulaNeighborCount && !this.suppressNebulaDarken) {
              const t = Math.min(1, entity.nebulaNeighborCount / 6);
              const factor = 1 - t * 0.45;
              const [r, g, b] = hexToRgb(tintHex);
              const toHex = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)))
                  .toString(16).padStart(2, '0');
              tintHex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
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
          if (entity.type === EntityType.NEBULA_SHARD) {
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
              if (entity.type === EntityType.NEBULA_SHARD) {
                  if (entity.nebulaTintedKey === undefined) {
                      entity.nebulaTintedKey = `${spriteSrc}|${tintHex}`;
                  }
                  tinted = this._tintedSprites.get(entity.nebulaTintedKey) ?? null;
                  if (!tinted) tinted = this.getTintedSprite(spriteSrc, tintHex);
              } else {
                  tinted = this.getTintedSprite(spriteSrc, tintHex);
              }
              if (tinted) {
                  const isTile = entity.type === EntityType.NEBULA;
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
                  // Dev ablation: skip just the foreground tile/shard sprite
                  // blit so GPU fillrate (drawImage at TILE_SPRITE_WORLD_SIZE
                  // with alpha < 1) can be measured separately from the
                  // surrounding ctx.save/translate/rotate/restore overhead.
                  if (!this.suppressNebulaSprite) {
                      ctx.drawImage(tinted, dx, dy, drawSize, drawSize);
                  }
                  ctx.globalAlpha = 1.0;
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
              } else if (entity.type === EntityType.NEBULA_SHARD) {
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
          // Also skipped when the dev "kill twinkle" ablation toggle is on
          // (debug panel) so the contribution of the twinkle scheduler can
          // be measured against the renderMs / nebulaMs sub-timer.
          if (entity.type === EntityType.NEBULA && !this.suppressNebulaTwinkle) {
              const now = performance.now() / 1000;
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

          ctx.restore();
          return;
      }

      let drawn = false;

      // --- SPRITE RENDERING ---
      if (entity.sprite) {
          const img = this.getImage(entity.sprite);

          if (img.complete && img.naturalWidth > 0) {
              try {
                  const maxDim = Math.max(entity.size.x, entity.size.y);

                  let drawScale = 1.5;
                  if (entity.type === EntityType.STRUCTURE) {
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

                  // Special overlays for sprite-based entities
                  if (entity.type === EntityType.ASTEROID && entity.maxHealth > 1) {
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

          } else if (entity.type === EntityType.ASTEROID || entity.type === EntityType.STRUCTURE) {

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

            if (entity.type === EntityType.STRUCTURE) {
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

                // Damage cracks for multi-HP variants (reinforced / heavy).
                // renderCracks early-returns at ≥95 % health, so undamaged
                // tiles pay only one property read — same pattern asteroids
                // use for their damage visualisation.
                this.renderCracks(ctx, entity, Math.max(entity.size.x, entity.size.y) / 2);

                } // end else (glass tile — paired with regen ghost if/else above)

            } else {
                // ── Asteroid / Tile shard ─────────────────────────────────────
                const isFlash   = entity.hitFlash && entity.hitFlash > 0;
                const shardType = entity.shardType ?? 'asteroid';
                const glowColor = entity.powerupGlowColor;

                if (shardType === 'tile') {
                    // ── Tile shard — glass-like translucent panels with optional glow
                    const [gr, gg, gb] = glowColor ? hexToRgb(glowColor) : [180, 230, 253];

                    if (glowColor) {
                        // Power-up glow bloom — strong, opaque tint
                        const pulse     = 0.82 + Math.sin(nowSec * 5.5) * 0.18;
                        const glowR     = (entity.size.x / 2) * 3.0 * pulse;
                        const bloom     = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR);
                        bloom.addColorStop(0,   `rgba(${gr},${gg},${gb},0.55)`);
                        bloom.addColorStop(0.5, `rgba(${gr},${gg},${gb},0.25)`);
                        bloom.addColorStop(1,   `rgba(${gr},${gg},${gb},0)`);
                        ctx.globalAlpha = 1.0;
                        ctx.fillStyle   = bloom;
                        ctx.beginPath();
                        ctx.arc(0, 0, glowR, 0, Math.PI * 2);
                        ctx.fill();
                    }

                    // Base fill — more opaque than a plain tile, solid color tint
                    buildPath();
                    ctx.globalAlpha = isFlash ? 0.85 : (glowColor ? 0.55 : 0.22);
                    ctx.fillStyle   = isFlash ? '#ffffff' : `rgba(${gr},${gg},${gb},1)`;
                    ctx.fill();

                    // Edge stroke
                    ctx.globalAlpha = 1.0;
                    ctx.strokeStyle = isFlash ? '#ffffff' : `rgba(${gr},${gg},${gb},0.85)`;
                    ctx.lineWidth   = isFlash ? 2.5 : 1.5;
                    ctx.stroke();

                } else {
                    // ── Rocky asteroid — solid fill with optional non-opaque powerup overlay
                    buildPath();
                    ctx.globalAlpha = 1.0;
                    ctx.fillStyle   = isFlash ? '#ffffff' : entity.color;
                    ctx.fill();

                    if (glowColor && !isFlash) {
                        // Subtle powerup color overlay — semi-transparent, mixes with rock color
                        const [gr, gg, gb] = hexToRgb(glowColor);
                        const pulse = 0.6 + Math.sin(nowSec * 4.5) * 0.15;
                        buildPath();
                        ctx.globalAlpha = 0.28 * pulse;
                        ctx.fillStyle   = `rgb(${gr},${gg},${gb})`;
                        ctx.fill();

                        // Ambient rim glow
                        const glowR = (entity.size.x / 2) * 2.0 * pulse;
                        const bloom = ctx.createRadialGradient(0, 0, entity.size.x * 0.25, 0, 0, glowR);
                        bloom.addColorStop(0,   `rgba(${gr},${gg},${gb},0)`);
                        bloom.addColorStop(0.6, `rgba(${gr},${gg},${gb},0.12)`);
                        bloom.addColorStop(1,   `rgba(${gr},${gg},${gb},0)`);
                        ctx.globalAlpha = 1.0;
                        ctx.fillStyle   = bloom;
                        ctx.beginPath();
                        ctx.arc(0, 0, glowR, 0, Math.PI * 2);
                        ctx.fill();
                    }

                    ctx.globalAlpha = 1.0;
                    this.renderCracks(ctx, entity, entity.size.x / 2);
                    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
                    ctx.lineWidth   = 2;
                    ctx.stroke();
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
                } else {
                    // 'ammo', 'powerup', or any other — use entity.color (weapon color)
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

      ctx.restore();

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
      const { startX, startY, slotW } = computeAmmoHUDLayout(width, height);
      const activeWeapon = player.currentWeapon ?? WeaponType.BLASTER;

      ctx.save();
      ctx.textAlign  = 'center';
      ctx.textBaseline = 'middle';

      const FLASH_DURATION = 0.75;
      for (let i = 0; i < WEAPON_LIST.length; i++) {
          const wType  = WEAPON_LIST[i];
          const wCfg   = WEAPONS[wType];
          const x      = startX + i * (slotW + SLOT_GAP);
          const y      = startY;
          const isBlaster = wType === WeaponType.BLASTER;
          const ammo   = player.ammo?.[wType];
          const owned  = isBlaster || ammo !== undefined;
          const empty  = !isBlaster && (ammo ?? 0) <= 0;
          const active = wType === activeWeapon;

          const flash     = player.ammoPickupFlash?.[wType];
          const flashT    = flash ? Math.max(0, flash.timer / FLASH_DURATION) : 0; // 1→0
          const isFlashing = flashT > 0;

          // Slot background
          ctx.globalAlpha = owned ? (active ? 0.92 : 0.65) : 0.28;
          ctx.fillStyle   = owned ? (active ? wCfg.color : '#1e293b') : '#0f172a';
          ctx.beginPath();
          roundRectPath(ctx, x, y, slotW, SLOT_H, RADIUS);
          ctx.fill();

          // Flash glow overlay — bright weapon-color wash that fades out
          if (isFlashing) {
              const [fr, fg, fb] = hexToRgb(wCfg.color);
              ctx.globalAlpha = flashT * 0.55;
              ctx.fillStyle   = `rgb(${fr},${fg},${fb})`;
              ctx.beginPath();
              roundRectPath(ctx, x, y, slotW, SLOT_H, RADIUS);
              ctx.fill();
          }

          // Slot border
          ctx.globalAlpha = owned ? (active ? 1.0 : isFlashing ? 0.5 + flashT * 0.5 : 0.5) : 0.2;
          ctx.strokeStyle = (active || isFlashing) ? wCfg.color : (owned ? '#475569' : '#1e293b');
          ctx.lineWidth   = (active || isFlashing) ? 2 : 1;
          ctx.beginPath();
          roundRectPath(ctx, x, y, slotW, SLOT_H, RADIUS);
          ctx.stroke();

          // Color pip
          ctx.globalAlpha = owned ? 1.0 : 0.3;
          ctx.fillStyle   = wCfg.color;
          ctx.beginPath();
          ctx.arc(x + slotW / 2, y + 10, Math.max(3, slotW * 0.11), 0, Math.PI * 2);
          ctx.fill();

          // Ammo count / infinity symbol
          const ammoLabel = isBlaster ? '∞' : empty ? '0' : String(ammo ?? 0);
          const fontSize  = Math.max(9, Math.min(12, slotW * 0.28));
          ctx.font        = `bold ${fontSize}px monospace`;
          ctx.globalAlpha = owned ? (empty ? 0.45 : 1.0) : 0.25;
          ctx.fillStyle   = active ? '#ffffff' : (owned ? wCfg.color : '#475569');
          ctx.shadowColor = 'rgba(0,0,0,0.8)';
          ctx.shadowBlur  = 3;
          ctx.fillText(ammoLabel, x + slotW / 2, y + SLOT_H - 10);
          ctx.shadowBlur  = 0;

          // Weapon abbreviation label
          if (slotW >= 28) {
              const label = wCfg.name.split(' ').map((w: string) => w[0]).join('').substring(0, 3);
              ctx.font        = `bold ${Math.max(7, Math.min(8, slotW * 0.19))}px monospace`;
              ctx.globalAlpha = owned ? 0.7 : 0.2;
              ctx.fillStyle   = active ? '#ffffff' : '#94a3b8';
              ctx.fillText(label, x + slotW / 2, y + SLOT_H - 24);
          }

          // Floating +N pickup text — rises above the slot and fades out
          if (isFlashing && flash) {
              const rise    = (1 - flashT) * 22; // float up 22px over lifetime
              const alpha   = flashT > 0.5 ? 1.0 : flashT * 2; // fade in last half
              const textY   = y - 6 - rise;
              ctx.font        = `bold ${Math.max(10, slotW * 0.3)}px monospace`;
              ctx.globalAlpha = alpha;
              ctx.fillStyle   = wCfg.color;
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
