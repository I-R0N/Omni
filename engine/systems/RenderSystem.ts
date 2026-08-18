

import { GameEntity, Vector2, MapType, CameraState, EntityType, DamageText, PlayerHUDMessage, WeaponType, WaveAnnouncement, TrailPoint, TrailShape, JoystickHUDState, FireButtonHUDState } from '../../types';
import { COLORS, ASSETS, MINIMAP_CONSTANTS, UI_CONSTANTS, CAMERA_CONSTANTS, SPRITE_CONSTANTS, WEAPONS, WEAPON_LIST, LOADOUT_HUD_CONSTANTS, computeLoadoutHUDLayout, SHIELD_CONSTANTS, REGEN_POP_CONSTANTS, WAVE_ANNOUNCE_CONSTANTS, NEBULA_CONSTANTS, PLAYER_TRAIL_CONSTANTS, INPUT_CONSTANTS, CHARGE_CONSTANTS, densityTintMultiplier, metalDensityBrightness, METAL_HEX_CELLS, SHARD_VARIANTS, MATERIAL_DAMAGE_CRACKS, getActiveNebulaStretchK, getPlasticShardBaseShade, PLASTIC_SHARD_AUTOMATA, isPlasticAutomataBrighten, SHARD_LOD_CONSTANTS, getActivePlasticGlowBrightness, BUBBLE_CONSTANTS, DRAGON_CONSTANTS, STATION_CONSTANTS, PORTAL_CONSTANTS, BOSS_CONSTANTS, BOSS_DEFS, effectiveDpr, STATIC_TILE_STAMPS_PER_FRAME, getActiveMinimapMaterial, cycleLightingMode, setActiveLightingMode, getActiveLightingMode, cycleLightingTier, getActiveLightingTier, LightingMode, toggleShardShadows, getShardShadowsEnabled, cycleShadowSoftness, getShadowSoftnessName, toggleRefraction, getRefractionEnabled, cycleRefractBrightness, getRefractBrightnessName, cycleLightBrightness, getLightBrightnessName, toggleEmissive, getEmissiveEnabled, cycleEmitBrightness, getEmitBrightnessName, toggleEmitShadows, getEmitShadowsEnabled, cycleEmitShadowTier, getEmitShadowTier, cycleEmitFade, getEmitFadeName, cycleCausticFade, getCausticFadeName} from '../../constants';
import type { ShardVariantId } from './ShardSystem.types';
import { BackgroundManager } from './BackgroundManager';
import { blendCompositionToHex } from '../NebulaColor';
import { HEX_AREA, HEX_SIZE } from '../maps/TileGenerator';
import { MAP_WIDTH, MAP_HEIGHT, HALF_MAP_WIDTH, HALF_MAP_HEIGHT, wrapDeltaX, wrapDeltaY } from '../toroidal';
import { hexToRgb, rgbToHex, densityTintForRender, liftCh, sinkCh, hash01, CrackStyle,
         crackSeedFor, drawDamageCracks, ROCK_CRACK_STYLE, METAL_CRACK_STYLE, shiftX,
         shiftY, roundRectPath } from './render/drawUtils';
import { drawEnemyShape } from './render/enemyShapes';
import { drawDropShape } from './render/dropShapes';
import { drawProjectileShape } from './render/projectileShapes';
import { drawNebulaTileCached, drawNebulaEntity } from './render/nebulaTiles';
import { drawTileShape } from './render/tileShapes';
import { isStaticTileCacheable, eraseStaticTileFromCache, blitStaticTileLayer,
         prepareStaticTileCacheForFrame, syncStaticTileCacheAgainstDeaths,
         buildStaticTileLayer as buildStaticTiles } from './render/staticTileCache';
import { renderTrails, renderParticles, renderLightningArc, drawPlayerTrail,
         drawTrailStrip } from './render/effects';
import { renderDamageTexts, renderIndicators, renderPlayerMessages, renderLoadoutHUD,
         renderMinimap, renderWaveAnnouncements, fitFontPx, renderJoystick, renderFireButton,
         buildMinimapStaticLayer as buildMinimapStatic } from './render/hud';
import { renderLightLayer, causticStats, shadowStats, type Occluder, type EmitSlot } from './render/lighting';

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


export class RenderSystem {
  private ctx: CanvasRenderingContext2D | null = null;
  private backgroundManager: BackgroundManager;
  debugMode: boolean = false;
  // Player trail shape — selectable from the debug panel.
  trailShape: TrailShape = TrailShape.CIRCLE;
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
  /** Time spent stamping tiles into the static-tile cache this frame, and
   *  how many were stamped.  Separated out because a device capture showed
   *  47ms and 27ms RENDER frames during early warm-up with no event nearby,
   *  and "the cache stamps" is a guess until it carries its own number. */
  public lastStampMs: number = 0;
  public lastStampCount: number = 0;
  /** Tinted-sprite cache MISSES this frame, and what they cost.  Each miss
   *  builds a 128x128 canvas; the cache is capped at 256 entries with FIFO
   *  eviction, and the tint key space is large (rock alone has 25 density
   *  tiers, plus metal tiers, glass opacity and plastic palettes), so past
   *  the cap it can THRASH — rebuilding canvases every frame.  A device
   *  capture showed four 27-41ms RENDER frames at ~1520 entities with tile
   *  stamping already eliminated (1ms peak), which is the shape thrashing
   *  would have.  Measured rather than assumed. */
  public lastTintMs: number = 0;
  public lastTintMisses: number = 0;
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
  // Wall time (ms) of the unified-lighting pass this frame — occluder
  // collection, wedge-path construction, the per-light composite and the
  // blit.  Reset at the start of render() beside lastTileLightingMs, and
  // stays 0 while LIGHTING_CYCLE is at 'legacy'.  Read NET of
  // lastTileLightingMs: the unified system absorbs the legacy models, so
  // the gross figure overstates the cost of the change.
  public lastLightingMs: number = 0;
  // Lights composited this frame, after viewport culling and the tier cap.
  public lastLightingLights: number = 0;

  // ── The unified-lighting layer ──────────────────────────────────────
  // Offscreen canvas the per-light passes composite into, blitted to the
  // main canvas in ONE drawImage.  Mirrors the _staticTileCanvas fields
  // above rather than inventing a second offscreen-canvas pattern; the
  // code that drives it lives in render/lighting.ts as free functions
  // over `r: RenderSystem`, same as staticTileCache.ts.
  //
  // Sized in CSS pixels over the active tier's divisor — never 1, because
  // a light layer is low-frequency by nature.  At the Low tier's 3 a
  // 390x844 phone gets 130x282 = 0.15 MB.
  _lightCanvas: HTMLCanvasElement | null = null;
  _lightCtx: CanvasRenderingContext2D | null = null;
  _lightW: number = 0;
  _lightH: number = 0;
  _lightScale: number = 1;   // light-layer px per CSS px (= 1 / divisor)
  // This frame's occluder set for the player light, nearest-first.  Held on
  // the renderer (not module scope) so a test can read it off
  // `window.__omniEngine.renderer` without a second debug handle.  Read
  // `_lightOccluderCount`, not `.length`: the buffer is index-filled and the
  // tier cap may be below the collected count.
  _lightOccluders: Occluder[] = [];
  /** Scratch surface + occluder buffer for a SHADOWING secondary light (DBG
   *  "Emit shadows").  Both stay null/empty until that toggle is used: an
   *  emitter's shadows cannot be drawn onto the accumulated light layer,
   *  because `destination-out` there would erase the light already present
   *  rather than only the emitter's share, so it needs its own surface — and
   *  its own occluder array, because the shared pool is consumed per light. */
  _emitCanvas: HTMLCanvasElement | null = null;
  _emitCtx: CanvasRenderingContext2D | null = null;
  _emitOccluders: Occluder[] = [];
  _lightOccluderCount: number = 0;
  /** This frame's PASSTHROUGH EMITTERS — bodies that re-emit light but cast
   *  no shadow, so they never enter the occluder pool (nebula).  A second
   *  output of the same grid walk, kept nearest-first; empty while emission
   *  is off.  See the emitter-buffer note in render/lighting.ts for why they
   *  cannot simply join the occluders. */
  _lightEmitters: Occluder[] = [];
  _lightEmitterCount: number = 0;
  /** PERSISTENT emitter halos, so emission fades instead of flashing when a
   *  body crosses the tier's emitter budget.  Live slots are `[0,
   *  _emitSlotCount)`; `_emitSlotAtMs` is the last tick's clock, since the
   *  fade is wall-clock rather than per-frame.  See `EmitSlot` in
   *  render/lighting.ts. */
  _emitSlots: EmitSlot[] = [];
  _emitSlotCount: number = 0;
  _emitSlotAtMs: number = 0;

  /** DBG passthroughs for the lighting mode.  The state itself is module
   *  scope in constants.ts (the RENDER_SCALE_CYCLE pattern); these exist so
   *  the harness and the tests can reach it off `engine.renderer` without
   *  the mode having to be plumbed through EngineStats first.  The pause-menu
   *  DBG row lands with A4, when there is something to look at. */
  public cycleLighting(): string { return cycleLightingMode(); }
  public setLighting(m: LightingMode): void { setActiveLightingMode(m); }
  public getLighting(): LightingMode { return getActiveLightingMode(); }
  public cycleLightTier(): string { return cycleLightingTier().name; }
  public getLightTier(): string { return getActiveLightingTier().name; }
  public toggleShardShadows(): boolean { return toggleShardShadows(); }
  public getShardShadows(): boolean { return getShardShadowsEnabled(); }
  public toggleRefraction(): boolean { return toggleRefraction(); }
  public getRefraction(): boolean { return getRefractionEnabled(); }
  public cycleRefractBrightness(): string { return cycleRefractBrightness(); }
  public getRefractBrightness(): string { return getRefractBrightnessName(); }
  public cycleLightBrightness(): string { return cycleLightBrightness(); }
  public getLightBrightness(): string { return getLightBrightnessName(); }
  public toggleEmissive(): boolean { return toggleEmissive(); }
  public getEmissive(): boolean { return getEmissiveEnabled(); }
  public cycleEmitBrightness(): string { return cycleEmitBrightness(); }
  public getEmitBrightness(): string { return getEmitBrightnessName(); }
  public toggleEmitShadows(): boolean { return toggleEmitShadows(); }
  public getEmitShadows(): boolean { return getEmitShadowsEnabled(); }
  public cycleEmitFade(): string { return cycleEmitFade(); }
  public getEmitFade(): string { return getEmitFadeName(); }
  public cycleCausticFade(): string { return cycleCausticFade(); }
  public getCausticFade(): string { return getCausticFadeName(); }
  public causticStats(): { faces: number; weight: number } { return causticStats(); }
  public shadowStats(): { quads: number; area: number } { return shadowStats(); }
  public cycleEmitShadowTier(): string { return cycleEmitShadowTier(); }
  /** The live emitter-shadow tier ROW, not just its name — the suites read
   *  the caps off it, so the ladder is pinned where it is authored. */
  public getEmitShadowTier(): { name: string; maxEmitters: number; maxOccluders: number } {
    return getEmitShadowTier();
  }
  public cycleShadowSoftness(): string { return cycleShadowSoftness(); }
  public getShadowSoftness(): string { return getShadowSoftnessName(); }

  public setDebugMode(v: boolean) { this.debugMode = v; }
  public setTrailShape(s: TrailShape) { this.trailShape = s; }

  // Optional PhysicsSystem reference for spatial queries — today only the
  // material-tile branch uses it (to suppress edge strokes on edges that
  // are cleanly butted against a neighbour tile).  Null is treated as "no
  // neighbour data available" → fall back to drawing the full outline.
  physics: import('./PhysicsSystem').PhysicsSystem | null = null;
  public setPhysics(p: import('./PhysicsSystem').PhysicsSystem) { this.physics = p; }

  // Optional FlowFieldGrid reference — wired by GameEngine once on
  // construction.  Null until then; the DBG asteroid/shard FF overlays
  // gracefully no-op without a flow field.
  private flowField: import('./FlowFieldGrid').FlowFieldGrid | null = null;
  public setFlowField(f: import('./FlowFieldGrid').FlowFieldGrid) { this.flowField = f; }
  /** Read access for the minimap's streamline layer (G5), which lives in
   *  `render/hud.ts` and cannot reach a private field. */
  public flowFieldForMinimap() { return this.flowField; }
  /** Cached streamline geometry in WORLD space, rebuilt only when the seed
   *  lattice moves (camera crosses a cell) or the zoom changes — see
   *  `renderMinimapFlow`.  Nulled on map load, since the field is rebaked. */
  _minimapFlowCache: { data: Float64Array; cellX: number; cellY: number; spacing: number } | null = null;

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
  _tintedSprites: Map<string, HTMLCanvasElement> = new Map();
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
  _projGlowCache: Map<string, CanvasGradient> = new Map();
  _chargedGlow: CanvasGradient | null = null;
  // Render buffers.  Each entry carries the entity AND its camera-local
  // render coords (rx, ry) — computed once at cull time so the draw pass
  // can translate to the right shifted position without recomputing.
  // Toroidal maps require this because an entity near the wrap seam
  // must render at position ±MAP_WIDTH / ±MAP_HEIGHT from its canonical
  // coord to appear in the right on-screen spot.
  _visibleEntities: { entity: GameEntity, rx: number, ry: number }[] = [];
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
  _minimapStaticCanvas: HTMLCanvasElement | null = null;
  // World-space range captured by the static layer (half-extent from map
  // center).  Stored so renderMinimap can compute the blit source rect
  // without re-reading the map dimensions.
  _minimapStaticRange: number = 0;

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
  _staticTileCanvas: HTMLCanvasElement | null = null;
  _staticTileCanvasCtx: CanvasRenderingContext2D | null = null;
  _staticTileScale: number = 1.0;      // canvas px per world unit
  _staticTileMapW: number = 0;
  _staticTileMapH: number = 0;
  // Tiles currently stamped into the cache — used to walk-and-erase
  // any tiles that get deactivated (destroyed) since the last frame.
  // Set is fine here: the per-frame walk runs O(N) in the cached count
  // (typically 200-1000) and only on cache-eligible variants.
  _staticTileCacheSet: Set<GameEntity> = new Set();

  constructor() {
    this.backgroundManager = new BackgroundManager();
    // Preload basic assets
    Object.values(ASSETS).forEach(src => this.getImage(src));
  }

  // Returns a 12×12 offscreen canvas with a radial-gradient specular dot,
  // matching the (-9,-11,r=5) dot drawn on glass tiles. Created once.
  getSpecularBitmap(): HTMLCanvasElement {
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

  getSolidTriangleBitmap(hex: string): HTMLCanvasElement {
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
  getTwinkleBitmap(): HTMLCanvasElement {
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
  getSpriteCentroid(src: string): { dx: number, dy: number } {
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
  getTintedSprite(src: string, hex: string): HTMLCanvasElement | null {
      const key = `${src}|${hex}`;
      const cached = this._tintedSprites.get(key);
      if (cached) {
          // LRU, not FIFO.  Eviction below takes the FIRST key in insertion
          // order, so without this a hit leaves the entry where it was and
          // the cache discards by AGE rather than by USE — which means a
          // working set only slightly over the cap evicts precisely the
          // entries about to be needed again, and every one of them is
          // rebuilt (a 128x128 canvas, measured at ~2.4ms on device).  A
          // device capture showed 890 rebuilds in 182s against a 256-entry
          // cache.  Re-inserting on hit moves the entry to the end, so
          // eviction follows recency.  Purely a cache-policy change: same
          // canvases, same pixels, no visual difference.
          this._tintedSprites.delete(key);
          this._tintedSprites.set(key, cached);
          return cached;
      }
      const img = this.getImage(src);
      if (!img.complete || img.naturalWidth === 0) return null;
      const tTint0 = performance.now();

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
      this.lastTintMisses++;
      this.lastTintMs += performance.now() - tTint0;
      return c;
  }

  // Helper to load/get images
  getImage(src: string): HTMLImageElement {
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

  /** Stamp the map's immovable tiles into the offscreen static layer.  Body
   *  lives in engine/systems/render/staticTileCache.ts (gauntlet 5f); this
   *  stays a method because `GameEngine.loadMap` calls it. */
  public buildStaticTileLayer(entities: GameEntity[], mapWidth: number, mapHeight: number): void {
      buildStaticTiles(this, entities, mapWidth, mapHeight);
  }

  /** Pre-render the map's static tiles into the minimap's cached layer.
   *  Body lives in engine/systems/render/hud.ts with the rest of the
   *  screen-space passes (gauntlet 5f); this stays a method because
   *  `GameEngine.loadMap` calls it — it is the renderer's public API. */
  public buildMinimapStaticLayer(entities: GameEntity[], mapWidth: number, mapHeight: number) {
      buildMinimapStatic(this, entities, mapWidth, mapHeight);
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
  materialAutomataAlpha(entity: GameEntity): number {
    if (!this.materialAutomataEnabled) return 1;
    const v = entity.shardVariant;
    if (v === undefined) return 1;
    const cfg = SHARD_VARIANTS[v].automata;
    if (cfg === undefined || cfg.saturationOpacity === undefined) return 1;
    const count = Math.max(0, entity.materialNeighborCount ?? 0);
    const t = Math.min(1, count / cfg.maxNeighbors);
    return 1 + (0.5 - t) * 2 * (1 - cfg.saturationOpacity);
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
    joystick?: JoystickHUDState | null,
    fireButton?: FireButtonHUDState | null,
  ) {
    const t0 = performance.now();
    this.lastTintMs = 0;
    this.lastTintMisses = 0;
    if (!this.ctx) { this.lastRenderMs = performance.now() - t0; return; }
    const ctx = this.ctx;
    const dpr = effectiveDpr();
    const width = (ctx.canvas.width || 0) / dpr;
    const height = (ctx.canvas.height || 0) / dpr;

    // Crisp pixels for sprite scaling
    ctx.imageSmoothingEnabled = false;

    // Guard against 0 dimensions
    if (width === 0 || height === 0) return;

    // Whether the minimap wants per-shard dots this frame (G5).  Hoisted out
    // of the loop: it is one lookup for the whole pass, not one per entity.
    const minimapDots = getActiveMinimapMaterial() === 'dots';

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
        // MOBILE shards still reach this buffer, but only in the DBG 'dots'
        // material mode (G5): the shipped default traces the flow field
        // instead, and a few thousand pushes per frame for dots nobody is
        // drawing is the kind of cost that hides in a profile.
        if (entity.type !== EntityType.PLAYER && entity.type !== EntityType.PROJECTILE && entity.type !== EntityType.PARTICLE
                && entity.shardVariant !== 'nebula-tile' && entity.shardVariant !== 'nebula-shard'
                && !(entity.type === EntityType.STRUCTURE && minimapDots === false)
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
    // Unified-lighting accumulator — populated by the lighting pass when
    // LIGHTING_CYCLE is off 'legacy'; stays 0 otherwise.
    this.lastLightingMs = 0;
    this.lastLightingLights = 0;
    this.lastLodShardCount = 0;

    // Sort indicators once for the frame — NEAREST FIRST, so the per-type
    // budgets in renderIndicators keep the closest contacts (they used to be
    // sorted farthest-first, which spent the budget on distant stragglers and
    // culled the ones actually bearing down on the player).
    this._indicatorBuffer.sort((a, b) => a.distSq - b.distSq);

    // Drop any tiles from the static cache that died since the previous
    // frame so we don't paint a ghost copy from the pre-baked canvas.
    syncStaticTileCacheAgainstDeaths(this);

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
    renderTrails(this, ctx, this._trailEntities, camera);

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
    prepareStaticTileCacheForFrame(this, playerPos);
    blitStaticTileLayer(this, ctx);

    // 4a. Render Entities (Culling logic added).  Stage 6: dragon body segments
    // are real tile-variant STRUCTURE entities, so they render here like any
    // tile (no dedicated pass).
    this.renderEntities(ctx, this._visibleEntities, camera, playerPos);

    // 4b. Render Particles — single composite-op switch for the whole batch
    renderParticles(this, ctx, this._particleBuffer, camera);

    // 5. Render Damage Text (World Space)
    if (damageTexts) {
        renderDamageTexts(ctx, damageTexts, camera);
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

    // 5b'. THE LIGHT LAYER (Screen Space).
    //
    // After the entity pass so it lights what was drawn, before the HUD so
    // it never tints the HUD, and AFTER ctx.restore() because the layer is
    // screen-space and must not inherit the camera translation.  No-op at
    // LIGHTING_CYCLE 'legacy' (the default).
    renderLightLayer(this, ctx, width, height, playerPos, camera);

    // 5c. Render Wave Announcements (Screen Space, above game entities)
    if (waveAnnouncements && waveAnnouncements.length > 0) {
        renderWaveAnnouncements(ctx, waveAnnouncements, width, height);
    }

    // 6. Render POI Indicators (Screen Space)
    renderIndicators(this, ctx, this._indicatorBuffer, camera, width, height);

    // 7. Render Minimap (Screen Space)
    renderMinimap(this, ctx, this._minimapBuffer, camera, width, height, minimapExpanded, mapType);

    // 8. Render Player HUD messages (Screen Space)
    if (playerMessages && playerMessages.length > 0) {
        renderPlayerMessages(ctx, playerMessages, width, height);
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
        renderLoadoutHUD(ctx, player, width, height);
    }

    // 10. The touch scheme's two widgets (Screen Space, LAST) — they live
    // under actual thumbs, so nothing may draw over them.  Both are null
    // unless the active control scheme has them.
    if (joystick) {
        renderJoystick(ctx, joystick);
    }
    if (fireButton) {
        renderFireButton(ctx, fireButton);
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

  // Reusable scratch buffers for shifted trail coordinates and per-point
  // edge normals — keeps trail rendering allocation-free even when every
  // projectile in the scene is drawing a 30-point trail.  The normal
  // buffers eliminate the duplicate sqrt+div pair that the forward and
  // backward strip passes previously each performed on the same data.
  _trailShiftedX: Float32Array = new Float32Array(64);
  _trailShiftedY: Float32Array = new Float32Array(64);
  _trailNX: Float32Array = new Float32Array(64);
  _trailNY: Float32Array = new Float32Array(64);
  // ── Lightning arc rendering ─────────────────────────────────────────────

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
      // Skip the fast path while the player is inside this tile's variant
      // glow range so the slow path can paint it.  Only INDESTRUCTIBLE-tile
      // reaches this now: glass-tile used to bail out of the fast path on
      // `repelImpulse` — a CONTACT glow, which the unified light replaced —
      // so glass now stays cached while something is touching it.
      let inGlowRange = false;
      if (isGlassFamilyStaticTile && entity.shardVariant !== undefined && playerPos) {
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

      // ── Fast-path NEBULA tile render (render/nebulaTiles.ts) ────────
      // A steady-state nebula tile collapses to a single drawImage off the
      // per-entity cache the slow path populated on an earlier frame.  The
      // leading variant test stays inline so every OTHER entity in the
      // frame pays one string compare rather than a call; the eight
      // conditions that force a tile back onto the slow path live with the
      // draw they gate.
      if (entity.shardVariant === 'nebula-tile'
          && drawNebulaTileCached(this, ctx, entity, rx, ry, perfNowSec)) return;

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

      // --- NEBULA TILES & SHARDS --- (render/nebulaTiles.ts)
      // Cloud-like rendering: the tint chain, the area-proportional sprite,
      // the debug outline and the twinkle scheduler — and the pass that
      // refills the fast path's per-entity cache above.
      if (entity.shardVariant === 'nebula-tile' || entity.shardVariant === 'nebula-shard') {
          drawNebulaEntity(this, ctx, entity, perfNowSec);
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
            drawEnemyShape(ctx, entity, nowSec);
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
            // Glass-family tile, material tile, regen ghost, asteroid /
            // mobile shard — plus the variant glow, damage cracks and
            // colour automata that only terrain uses.  render/tileShapes.ts.
            drawTileShape(this, ctx, entity, nowSec, playerPos, camera);
          } else if (entity.type === EntityType.PROJECTILE) {
             // Lightning bolt / bouncer head / charged fireball / the
             // standard weapon-colour glow.  render/projectileShapes.ts.
             drawProjectileShape(this, ctx, entity, nowSec);
          } else {
            // Drops (salvage / health / glass debris) and the proximity-
            // interactable POIs — station, portal, snitch — plus the bare-rect
            // catch-all.  render/dropShapes.ts.
            drawDropShape(ctx, entity, nowSec, playerPos);
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

}
