

import { GameEntity, Vector2, MapType, CameraState, EntityType, DamageText, PlayerHUDMessage, WeaponType, WaveAnnouncement, TrailPoint, TrailShape, JoystickHUDState, FireButtonHUDState } from '../../types';
import { COLORS, ASSETS, getActivePlayerHullMode, getActiveTiltMode, getActiveLeanDirSign, MINIMAP_CONSTANTS, UI_CONSTANTS, CAMERA_CONSTANTS, SPRITE_CONSTANTS, WEAPONS, WEAPON_LIST, LOADOUT_HUD_CONSTANTS, computeLoadoutHUDLayout, SHIELD_CONSTANTS, REGEN_POP_CONSTANTS, WAVE_ANNOUNCE_CONSTANTS, NEBULA_CONSTANTS, PLAYER_TRAIL_CONSTANTS, INPUT_CONSTANTS, CHARGE_CONSTANTS, densityTintMultiplier, metalDensityBrightness, METAL_HEX_CELLS, SHARD_VARIANTS, MATERIAL_DAMAGE_CRACKS, getActiveNebulaStretchK, getPlasticShardBaseShade, PLASTIC_SHARD_AUTOMATA, isPlasticAutomataBrighten, SHARD_LOD_CONSTANTS, getActivePlasticGlowBrightness, BUBBLE_CONSTANTS, DRAGON_CONSTANTS, STATION_CONSTANTS, PORTAL_CONSTANTS, BOSS_CONSTANTS, BOSS_DEFS, effectiveDpr, STATIC_TILE_STAMPS_PER_FRAME, getActiveMinimapMaterial, detectionAlpha, isAlwaysCharted, SCANNER, cycleLightingMode, setActiveLightingMode, getActiveLightingMode, cycleLightingTier, getActiveLightingTier, LightingMode, toggleShardShadows, getShardShadowsEnabled, cycleShadowSoftness, getShadowSoftnessName, toggleRefraction, getRefractionEnabled, cycleRefractBrightness, getRefractBrightnessName, cycleLightBrightness, getLightBrightnessName, toggleEmissive, getEmissiveEnabled, cycleEmitBrightness, getEmitBrightnessName, toggleEmitShadows, getEmitShadowsEnabled, cycleEmitShadowTier, getEmitShadowTier, cycleEmitFade, getEmitFadeName, cycleCausticFade, getCausticFadeName, cycleFlashlight, getFlashlightName, cycleLightColor, getLightColorName, cycleTintMix, getTintMixName, cycleFog, getFogName, toggleWorldLights, getWorldLightsEnabled, toggleDepthAmbient, getDepthAmbientEnabled} from '../../constants';
import type { ShardVariantId } from './ShardSystem.types';
import type { Renderer } from './Renderer';
import type { RendererDiagnostics } from './RendererDiagnostics';
import { BackgroundManager } from './BackgroundManager';
import { blendCompositionToHex } from '../NebulaColor';
import { HEX_AREA, HEX_SIZE } from '../maps/TileGenerator';
import { MAP_WIDTH, MAP_HEIGHT, HALF_MAP_WIDTH, HALF_MAP_HEIGHT, wrapDeltaX, wrapDeltaY } from '../toroidal';
import { hexToRgb, rgbToHex, densityTintForRender, liftCh, sinkCh, hash01, CrackStyle,
         crackSeedFor, drawDamageCracks, ROCK_CRACK_STYLE, METAL_CRACK_STYLE, shiftX,
         shiftY, roundRectPath } from './render/drawUtils';
import { drawEnemyShape } from './render/enemyShapes';
import { drawPlayerCube } from './render/playerCube';
import {
  ShipSheetCache, resolveTiltCell, cellMatrix,
  type ShipCellRef,
} from './render/shipSprites';
import { SHIP_SHEETS } from '../../assets';
import { drawDropShape } from './render/dropShapes';
import { drawProjectileShape } from './render/projectileShapes';
import { drawNebulaTileCached, drawNebulaEntity } from './render/nebulaTiles';
import { drawTileShape } from './render/tileShapes';
import { isStaticTileCacheable, eraseStaticTileFromCache, blitStaticTileLayer, tileShowsDamage,
         prepareStaticTileCacheForFrame, syncStaticTileCacheAgainstDeaths,
         buildStaticTileLayer as buildStaticTiles } from './render/staticTileCache';
import { renderTrails, renderParticles, renderLightningArc, drawPlayerTrail,
         drawTrailStrip } from './render/effects';
import { renderPortalWarpVeil } from './render/portalWarp';
import { renderDamageTexts, renderIndicators, renderPlayerMessages, renderLoadoutHUD,
         renderMinimap, renderWaveAnnouncements, fitFontPx, renderJoystick, renderFireButton,
         buildMinimapStaticLayer as buildMinimapStatic } from './render/hud';
import { renderLightLayer, causticStats, shadowStats, beamMaskCount, transmissionWeight, lastWorldLightCount, type Occluder, type EmitSlot } from './render/lighting';
import { renderFogLayer, resetFogMemory } from './render/fog';
import { renderShardBlends } from './render/shardBlend';

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


export class RenderSystem implements Renderer, RendererDiagnostics {
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
  /** DBG toggle (Visual ▸ "HP bars") — when true (default), an enemy's
   *  world-space health bar appears only while recently damaged and fades
   *  out; when false, every enemy carries one every frame, which is the
   *  pre-5d behaviour and the A/B for judging the change (gauntlet 5d, U5). */
  public damageTriggeredBars: boolean = true;
  /** Is the DOM's boss capstone bar on screen?  Read by the off-screen
   *  indicator rect, which reserves the band the bar occupies so an arrow at
   *  a near-vertical bearing does not draw under it.  A BOOLEAN of engine
   *  state, deliberately — the canvas layer must not start measuring React's
   *  layout, but "is a capstone alive" is something the sim already knows. */
  public bossBarActive: boolean = false;
  /** SCANNER, pushed once per frame in `GameEngine.draw` — the same channel
   *  the Light's cone override takes.  `scannerMk` says which detection
   *  TIERS the ship can find; `scanRanges` says how far each reaches; the
   *  three `scan*` fields below carry the live ping and the material bubble.
   *
   *  THE BASELINE IS NOTHING (rework, user call).  With no scanner there are
   *  no off-screen arrows at all and the minimap draws neither terrain nor
   *  contacts — only the two always-charted landmarks.  Every gate below is
   *  therefore "was this detected", not "is the mark high enough". */
  public scannerMk: number = 0;
  public scanRanges: number[] = [];
  /** Live ping wavefront radius (0 = none) and its target radius. */
  public scanPingRadius: number = 0;
  public scanPingMax: number = 0;
  /** Sim clock + the last completed ping's material bubble, for the minimap's
   *  tier-1 reveal.  See `GameEngine.updateScan` for why materials are a
   *  radius and contacts are stamps. */
  public simClock: number = 0;
  public materialRevealAt: number = -1e9;
  public materialRevealRadius: number = 0;

  /** Does the minimap draw a dot per mobile shard this frame?  TWO callers
   *  have to agree — the per-entity buffer fill here and the draw in
   *  `render/hud.ts` — so the answer has exactly one definition.
   *
   *  The DBG "Minimap mat" cycle and the SCAN answer different questions and
   *  BOTH have to say yes: the cycle picks WHICH material layer is drawn
   *  (dots / flow / off) and the scan decides whether there is anything to
   *  draw it for.  The cycle cannot be a dev override that forces the layer
   *  on, because its shipped default is already 'dots' — that would make the
   *  material reveal free and Mk I worthless. */
  public get minimapShardDots(): boolean {
    return getActiveMinimapMaterial() === 'dots' && this.materialRevealAlpha > 0;
  }
  /** How strongly the material bubble draws, 0 once it has gone stale. */
  public get materialRevealAlpha(): number {
    return detectionAlpha(this.simClock - this.materialRevealAt);
  }
  /** How strongly a contact detected at `at` should draw right now — the ONE
   *  freshness test, shared by the arrows and the minimap so a mark cannot
   *  be on one readout and gone from the other. */
  public detectAlpha(at: number | undefined): number {
    return at === undefined ? 0 : detectionAlpha(this.simClock - at);
  }
  /** The rift the player arrived through, charted without a scanner. */
  public arrivalPortalId: string | null = null;

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
  /** FOG OF WAR surfaces (render/fog.ts).  All null until the fog is first
   *  switched on, so `off` allocates nothing: the composited fog, the
   *  boosted light MASK it is cut with, and the world-space EXPLORED
   *  memory, which is the renderer's one piece of per-map persistent state
   *  and is reset on every map load.  The memory is kept at EVERY fog rung
   *  above `off`, not only at the three-layer one: the WORLD fog uses it
   *  only there, but the MINIMAP uses it at all of them. */
  _fogCanvas: HTMLCanvasElement | null = null;
  _fogCtx: CanvasRenderingContext2D | null = null;
  _fogMaskCanvas: HTMLCanvasElement | null = null;
  _fogMaskCtx: CanvasRenderingContext2D | null = null;
  _fogMem: HTMLCanvasElement | null = null;
  _fogMemCtx: CanvasRenderingContext2D | null = null;
  /** Veil the minimap paints over unexplored ground — sized to whichever
   *  minimap is up, so it is rebuilt only when the map is expanded or
   *  collapsed. */
  _minimapFogCanvas: HTMLCanvasElement | null = null;
  _minimapFogCtx: CanvasRenderingContext2D | null = null;
  /** Did the fog pass actually DRAW this frame?  Not the same question as
   *  "is the fog switched on": the fog is composed from the light layer, so
   *  it is a no-op under legacy lighting, and a minimap that fogged itself
   *  anyway would black out a map whose memory nothing is stamping. */
  _fogActive: boolean = false;
  /** Wall time the fog pass took last frame, for the perf recorder. */
  lastFogMs: number = 0;
  /** A7 — the run's current DEPTH (GameEngine.stageIndex), stamped by the
   *  engine before each draw.  The renderer never reads sim state directly;
   *  this one number crosses on a field write. */
  stageDepth: number = 0;

  /** The flashlight TOOL's cone half-angle while the tool is ON, set per
   *  frame by GameEngine.draw.  null → the tool is off (or no kit), and the
   *  player light falls back to the DBG flashlight global — which ships
   *  'off', so a kit-less ship carries no beam.  See FLASHLIGHT_TOOL_LEVELS. */
  playerLightToolHalfDeg: number | null = null;

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
  public toggleWorldLights(): boolean { return toggleWorldLights(); }
  public getWorldLights(): boolean { return getWorldLightsEnabled(); }
  public toggleDepthAmbient(): boolean { return toggleDepthAmbient(); }
  public getDepthAmbient(): boolean { return getDepthAmbientEnabled(); }
  public cycleEmitBrightness(): string { return cycleEmitBrightness(); }
  public getEmitBrightness(): string { return getEmitBrightnessName(); }
  public toggleEmitShadows(): boolean { return toggleEmitShadows(); }
  public getEmitShadows(): boolean { return getEmitShadowsEnabled(); }
  public cycleEmitFade(): string { return cycleEmitFade(); }
  public getEmitFade(): string { return getEmitFadeName(); }
  public cycleFlashlight(): string { return cycleFlashlight(); }
  public getFlashlight(): string { return getFlashlightName(); }
  public cycleLightColor(): string { return cycleLightColor(); }
  public getLightColor(): string { return getLightColorName(); }
  public cycleFog(): string { return cycleFog(); }
  public getFog(): string { return getFogName(); }
  /** Drop the explored memory — called on every map load, since the memory
   *  is world space and world space means something else on the next map. */
  public resetFog(): void { resetFogMemory(this); }
  public cycleTintMix(): string { return cycleTintMix(); }
  public getTintMix(): string { return getTintMixName(); }
  public cycleCausticFade(): string { return cycleCausticFade(); }
  public getCausticFade(): string { return getCausticFadeName(); }
  public causticStats(): { faces: number; weight: number } { return causticStats(); }
  public shadowStats(): { quads: number; area: number } { return shadowStats(); }
  public beamMasks(): number { return beamMaskCount(); }
  public worldLightCount(): number { return lastWorldLightCount(); }
  /** The refraction fade's pure weight function, for the suite — see
   *  `transmissionWeight` in render/lighting.ts. */
  public transmissionWeight(incidenceRad: number, tirBand: number): number {
    return transmissionWeight(incidenceRad, tirBand);
  }
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

  // Optional ShardSystem reference — read by the bonded-pair blend pass
  // (render/shardBlend.ts) for its live bond list, and by nothing else.
  // Null until GameEngine wires it, which is what keeps the pass a no-op
  // in any headless context that builds a renderer without a sim.
  shards: import('./ShardSystem').ShardSystem | null = null;
  public setShards(sh: import('./ShardSystem').ShardSystem) { this.shards = sh; }

  /** DBG "Goo bond" — gates the bonded-pair blend pass.  Off restores
   *  the pre-blend look (two hulls in contact); the bonds themselves are
   *  untouched either way, since this is presentation only.  The A/B for
   *  a purely visual feature, in the shape of every other Visual row. */
  public shardBlendEnabled: boolean = true;
  /** Bridges actually drawn last frame (post-cull, post-span-gate).
   *  Surfaced on the DBG row so "is it doing anything" is answerable
   *  without staring at a shard field. */
  public lastShardBlendCount: number = 0;

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
  private _indicatorBuffer: { entity: GameEntity, distSq: number, onScreen: boolean, detect: number }[] = [];
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

  // SHIP TILT SHEETS (render/shipSprites.ts).  One cache per ship id,
  // built on first use and holding only the pose table — the pixels stay
  // in the shared image cache.  `_getImg` is bound ONCE: the draw path
  // hands it to the sheet every frame, and a closure built per frame is
  // the allocation pattern CLAUDE.md §8 warns about.
  private _shipSheets: Map<string, ShipSheetCache> = new Map();
  private _getImg = (src: string): HTMLImageElement => this.getImage(src);

  /** The pose cache for a ship id, preloading its cells on first use so
   *  nothing decodes inside a frame. */
  shipSheet(id: string): ShipSheetCache | null {
      const hit = this._shipSheets.get(id);
      if (hit) return hit;
      const def = SHIP_SHEETS[id];
      if (!def) return null;
      const cache = new ShipSheetCache(def);
      cache.preload(this._getImg);
      this._shipSheets.set(id, cache);
      return cache;
  }
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
  private _minimapBuffer: { entity: GameEntity, dx: number, dy: number, detect: number }[] = [];
  /** Transit-warp progress 0->1, pushed per frame by GameEngine.draw; null
   *  when no transit is in flight.  A number rather than a timer because the
   *  beat is a pure function of progress — see render/portalWarp.ts. */
  portalWarp: number | null = null;
  /** The veil alpha actually painted on the last frame of a transit, 0 when
   *  no transit is in flight.  Published because "the destination is not
   *  visible yet" is a RULE, and the only honest way to check it is to read
   *  what the render path put on the screen — see tests/maps.spec.ts. */
  lastWarpVeilAlpha: number = 0;
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
  /** The player's own draw slot, kept aside during bucket-building so the
   *  transit warp can re-draw the ship ON TOP of its veil.  A pooled
   *  one-element list, filled the same way as every other bucket. */
  private _playerDraw: { entity: GameEntity, rx: number, ry: number }[] = [];
  private _playerDrawPool: { entity: GameEntity, rx: number, ry: number }[] = [];
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
  private _solidDiscBitmaps: Map<string, HTMLCanvasElement> = new Map();

  /** Silhouette-NEUTRAL LOD blob — the ONLY cached shard silhouette, and
   *  deliberately shape-free.  A disc says "something small here" and
   *  nothing about shape.  There used to be an equilateral-triangle blob
   *  beside it, on the grounds that a metal shard's spawn polygon really
   *  was a lattice triangle; rock borrowed it and a shattered tile read
   *  as a set of identical chips, and once metal took Voronoi fracture
   *  the claim stopped being true for metal either.  Nothing authored
   *  goes here again: at a few pixels the honest statement is "a
   *  fragment", not a shape the body does not have. */
  getSolidDiscBitmap(hex: string): HTMLCanvasElement {
      const cached = this._solidDiscBitmaps.get(hex);
      if (cached) return cached;
      const size = SHARD_LOD_CONSTANTS.DISC_BITMAP_SIZE;
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const cx = c.getContext('2d')!;
      const center = size / 2;
      cx.fillStyle = hex;
      cx.beginPath();
      cx.arc(center, center, center - 1, 0, Math.PI * 2);
      cx.fill();
      if (this._solidDiscBitmaps.size >= 64) {
          const firstKey = this._solidDiscBitmaps.keys().next().value;
          if (firstKey !== undefined) this._solidDiscBitmaps.delete(firstKey);
      }
      this._solidDiscBitmaps.set(hex, c);
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
  /** Quantise a '#rrggbb' tint to 16 levels per channel (17-step buckets).
   *
   *  THE TINT STORM FIX (device captures, 2026-08-21): enemy deaths spray
   *  nebula dust tinted to the enemy's colour, and equilibrateColors then
   *  drifts every shard hue toward its neighbours CONTINUOUSLY — so with
   *  exact keys the cache is fed a never-repeating key stream and cannot
   *  converge (measured: 497 new 128² canvases in ONE frame, 120k misses
   *  in a 108s capture, on a map with no nebula terrain).  Bucketing the
   *  channels makes equilibration steps land on reusable entries; a
   *  ~6.7%-per-channel step is invisible on a soft translucent cloud
   *  sprite.  Anything that is not '#rrggbb' passes through untouched.
   */
  quantizeTintHex(hex: string): string {
      if (hex.length !== 7 || hex.charCodeAt(0) !== 35) return hex;
      const v = parseInt(hex.slice(1), 16);
      if (Number.isNaN(v)) return hex;
      const q = (c: number) => Math.min(255, Math.round(c / 17) * 17);
      const r = q(v >> 16), g = q((v >> 8) & 0xff), b = q(v & 0xff);
      return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  }

  getTintedSprite(src: string, hex: string): HTMLCanvasElement | null {
      // Quantised BEFORE the key is built, and the quantised value is also
      // what gets painted — key and pixels must agree or two callers in one
      // bucket would share a canvas painted for only one of them.
      hex = this.quantizeTintHex(hex);
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

  /** Regenerate the background star field on the next frame — for the DBG
   *  star-density cycle, which changes what generation produces rather than
   *  how it is drawn. */
  public invalidateBackground() {
    this.backgroundManager.invalidateContent();
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
    const minimapDots = this.minimapShardDots;

    // Build per-frame buckets in a single pass
    this._attractors.length = 0;
    this._playerDraw.length = 0;
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

        // Hold the player's slot aside for the transit warp, which re-draws
        // the ship above its veil so the player keeps something to hold onto
        // while the world is gone.  One pooled slot; costs a type compare per
        // entity on the generic arm (static tiles never reach here).
        if (entity.type === EntityType.PLAYER) {
            this.pushSlot(this._playerDraw, this._playerDrawPool, entity, rx, ry);
        }

        // Off-screen indicator arrows — for enemies and non-drop POIs.
        //
        // THE ARROWS ARE THE SCANNER'S (rework, user call).  An arrow now
        // means "the scan found this", so the gate is the detection stamp:
        // with no scanner nothing is ever stamped and the HUD carries no
        // arrows at all, and an always-charted landmark deliberately does NOT
        // qualify — the home rift is on the MAP without a scanner, never on
        // the edge of the screen.
        //
        // Gnats (diesOnContact, Swarm) stay excluded whatever the scan finds:
        // a cloud of them would crowd the screen and they are not threats the
        // player needs steering toward.  Bubbles are included (purple,
        // blinking red once they hunt you) under their own small budget.
        if ((entity.type === EntityType.ENEMY && entity.diesOnContact !== true)
                || (entity.type === EntityType.INTERACTABLE && !entity.dropType && !entity.isSnitch)) {
            const detect = this.detectAlpha(entity.detectedAt);
            if (detect > 0) {
                const distSq = dx*dx + dy*dy;
                // Whether the entity is currently within the true (unpadded)
                // viewport — its half-size lets an entity peeking in at the
                // edge count as visible.  renderIndicators uses this to
                // suppress the (redundant) chevron for on-screen entities.
                const halfSize = Math.max(entity.size.x, entity.size.y) * 0.5;
                const onScreen = rx >= camX - halfW - halfSize && rx <= camX + halfW + halfSize
                              && ry >= camY - halfH - halfSize && ry <= camY + halfH + halfSize;
                // The portal's own INDICATOR_RANGE gate is GONE: detection
                // range has replaced it, and it is the scanner's to set.  A
                // rift you have not scanned has no arrow at any distance; one
                // you have keeps the two rules that were always about
                // legibility rather than range — an on-screen rift still
                // suppresses its arrow, and the arrow still carries a name
                // and no distance readout.
                this._indicatorBuffer.push({ entity, distSq, onScreen, detect });
            }
        }

        // Structures use the pre-rendered static minimap layer — skip them
        // here to avoid ~22k per-frame object allocations + fillRect calls.
        // MOBILE shards still reach this buffer, but only while the material
        // layer is actually being drawn (a fresh scan, or the DBG override):
        // a few thousand pushes per frame for dots nobody is drawing is the
        // kind of cost that hides in a profile.
        //
        // CONTACTS ARE GATED ON DETECTION (rework).  The two always-charted
        // landmarks — the home station and the rift the player arrived
        // through — are the standing exception, and the only thing a
        // scannerless ship has on its map.
        if (entity.type !== EntityType.PLAYER && entity.type !== EntityType.PROJECTILE && entity.type !== EntityType.PARTICLE
                && entity.shardVariant !== 'nebula-tile' && entity.shardVariant !== 'nebula-shard'
                && !(entity.type === EntityType.STRUCTURE && minimapDots === false)
                && !(entity.type === EntityType.INTERACTABLE && entity.dropType)) {
            // A mobile shard is a MATERIAL contact and is revealed by the
            // ping's radius rather than a per-entity stamp — thousands of
            // them make stamping the wrong shape (GameEngine.updateScan).
            const charted = isAlwaysCharted(entity, this.arrivalPortalId);
            const detect = entity.type === EntityType.STRUCTURE
                ? this.materialRevealAlpha
                : charted ? 1 : this.detectAlpha(entity.detectedAt);
            if (detect > 0) this._minimapBuffer.push({ entity, dx, dy, detect });
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

    // 4a'. Bonded-pair blend ("goo") layer.  Between the static blit and
    // the entity pass on purpose: the bridge must sit UNDER the mobile
    // hulls, which cover the ends it attaches at, and OVER a static tile
    // it is stuck to, where it reads as goo spilling onto the face.
    renderShardBlends(this, ctx, camera, width, height);

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
    renderLightLayer(this, ctx, width, height, playerPos, camera, player?.rotation,
                     entities);

    // 5b''. FOG OF WAR, composed FROM the light layer above — so it must
    // follow it, and still precede the HUD: the fog darkens the world, never
    // the interface.
    renderFogLayer(this, ctx, width, height, playerPos, camera);

    // 5b'''. THE TRANSIT WARP (Screen Space).
    //
    // After the world and its light/fog layers, so it veils everything the
    // player has arrived into, and BEFORE the HUD, which stays legible
    // throughout — the chrome is not inside the wormhole.
    if (this.portalWarp === null) this.lastWarpVeilAlpha = 0;
    if (this.portalWarp !== null) {
        this.lastWarpVeilAlpha = renderPortalWarpVeil(ctx, width, height, this.portalWarp);
        // The tunnel IS the real sky: the same stars the player was looking
        // at, swept outward (BackgroundManager owns the star data, so it
        // draws them).  Above the veil, below the ship.
        this.backgroundManager.renderWarpStars(ctx, this.portalWarp, effectiveDpr());
        ctx.setTransform(effectiveDpr(), 0, 0, effectiveDpr(), 0, 0);

        // CONTINUITY: the ship rides ON TOP of the tunnel (user call).  The
        // veil takes the whole world away, and without the hull still in
        // frame the beat reads as a cutaway to somewhere else rather than as
        // the player's own flight — there is nothing to follow from the map
        // they left to the one they arrive in.  It is the REAL entity through
        // the REAL entity path (same sprite, same rotation, same hit flash),
        // not a stand-in silhouette, because a different-looking ship would
        // break the continuity it is here to provide.
        //
        // renderEntities reads the camera matrix off the context, so the
        // camera transform has to be re-applied for this one draw — the world
        // pass restored it several steps ago.  Mirrors the block in §2.
        if (this._playerDraw.length > 0) {
            ctx.save();
            ctx.translate(width / 2, height / 2);
            ctx.scale(camera.zoom, camera.zoom);
            if (Number.isFinite(camera.position.x) && Number.isFinite(camera.position.y)) {
                ctx.translate(
                    -camera.position.x + (camera.shakeOffset ? camera.shakeOffset.x : 0),
                    -camera.position.y + (camera.shakeOffset ? camera.shakeOffset.y : 0),
                );
            }
            this.renderEntities(ctx, this._playerDraw, camera, playerPos);
            ctx.restore();
        }
    }

    // 5b'''. THE SCAN PING — a world-space ring, drawn over the world and
    // under the HUD.  It is centred on the SHIP rather than on the camera
    // because the scan left the ship, and at a large radius those are not the
    // same point.  Screen-space arithmetic (one arc, no transform push) since
    // the ring is a circle in world units and the camera has no rotation.
    if (this.scanPingRadius > 0 && this.scanPingMax > 0) {
        const sp = this.worldToScreen(camera, playerPos);
        const frac = this.scanPingRadius / this.scanPingMax;
        if (sp) {
        ctx.save();
        ctx.globalAlpha = SCANNER.RING_ALPHA
            * (SCANNER.RING_MIN_ALPHA_FRAC + (1 - SCANNER.RING_MIN_ALPHA_FRAC) * (1 - frac));
        ctx.strokeStyle = SCANNER.RING_COLOR;
        ctx.lineWidth = SCANNER.RING_WIDTH;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, this.scanPingRadius * camera.zoom, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        }
    }

    // 5c. Render Wave Announcements (Screen Space, above game entities)
    if (waveAnnouncements && waveAnnouncements.length > 0) {
        renderWaveAnnouncements(ctx, waveAnnouncements, width, height, minimapExpanded);
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
            ctx.font = `bold ${UI_CONSTANTS.HUD.TEXT.BODY}px monospace`;
            ctx.lineWidth = UI_CONSTANTS.HUD.OUTLINE_WIDTH;
            ctx.strokeStyle = UI_CONSTANTS.HUD.OUTLINE;
            ctx.strokeText(player.interactPrompt, px.x, y);
            ctx.fillStyle = UI_CONSTANTS.HUD.TEXT_COLOR;
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
      // A4b: at 'unified' the slow path no longer paints the bloom (it is
      // the point light's job), so bailing out of the fast path for it
      // would buy a slower render of an identical picture — the tile stays
      // cached.  This is where the A4b credit actually lands: near-player
      // indestructible tiles stop re-rendering every frame.
      let inGlowRange = false;
      if (isGlassFamilyStaticTile && entity.shardVariant !== undefined && playerPos
          && getActiveLightingMode() !== 'unified') {
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
          && !inGlowRange
          // V10: a damaged glass pane shows crack lines and a chipped
          // polygon; the sprite draws neither, so it takes the slow path.
          && !tileShowsDamage(entity)) {
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
      // Wireframe hull (render/playerCube.ts): the player draws as a 3D
      // wire cube — flat or stood on its corner (diamond) — which is its
      // OWN art: nose = local +x, so no art-alignment offset and no 2D
      // squash (the wireframe shows tilt as real rotation).  The canvas
      // carries only R(yaw); a Z-rotation commutes with the orthographic
      // projection, so pitch/roll happen inside the draw.
      const hullMode = entity.type === EntityType.PLAYER ? getActivePlayerHullMode() : 'sprite';
      // TILT SHEET (render/shipSprites.ts): the hull as pre-rendered ART,
      // one authored pose per (tilt magnitude, tilt-axis azimuth), with yaw
      // still on the canvas transform.  While the sheet has NO art loaded
      // the mode falls through to the legacy sprite + squash, so selecting
      // it can never blank the ship and a sheet can be authored ring by
      // ring and watched to improve.
      const sheetCache = hullMode === 'sheet' ? this.shipSheet('base') : null;
      const sheetHull = !!sheetCache && sheetCache.anyReady(this._getImg);
      let sheetRef: ShipCellRef | null = null;
      const cubeHull = hullMode !== 'sprite' && hullMode !== 'sheet';
      const rotation = entity.rotation + (
        cubeHull
          ? 0
          : entity.isRival
          ? SPRITE_CONSTANTS.RIVAL_ROTATION_OFFSET   // sprite art points up-left
          : entity.type === EntityType.PLAYER
          ? SPRITE_CONSTANTS.PLAYER_ROTATION_OFFSET
          : entity.type === EntityType.ENEMY
            ? SPRITE_CONSTANTS.ENEMY_ROTATION_OFFSET
            : 0
      );
      const cosR = Math.cos(rotation);
      const sinR = Math.sin(rotation);
      // Local 2×2 (canvas [[a,c],[b,d]] layout) — plain rotation for
      // everything…
      let l11 = cosR, l21 = sinR, l12 = -sinR, l22 = cosR;
      // …except a TILTING player (GameEngine.tickPlayerRoll): the roll
      // (across the wings) and pitch (along the nose) components combine
      // into ONE tilt toward the acceleration, and the hull foreshortens
      // ALONG that direction by cos(tilt) — the top-down projection of a
      // flat ship tilting about the perpendicular axis.  The squash must
      // sit BETWEEN the facing rotation and the art-alignment offset — it
      // is the SHIP that tilts, not the sprite art's axes — so the matrix
      // is composed as R(facing) × R(φ) × scale(cos tilt, 1) × R(−φ) ×
      // R(art offset), where φ is the tilt direction in the ship frame
      // (pitch squashes along the nose = local x, roll across the wings =
      // local y; pure roll reduces this to the scale(1, cos roll) it
      // shipped with).  One entity per frame, so the extra trig is free;
      // level flight (both components snapped to 0) keeps the plain path.
      // (Sprite mode only — the cube shows tilt as 3D rotation instead.)
      if (sheetHull && sheetCache) {
          // The pose is IN the art, so the matrix only has to orient it:
          // R(facing + artOffset), or the reflection about the nose axis
          // when this cell is a mirrored partner.
          sheetRef = resolveTiltCell(
            sheetCache.sheet, entity.visualRoll ?? 0, entity.visualPitch ?? 0, entity.rotation);
          const m = cellMatrix(sheetCache.sheet, sheetRef, entity.rotation);
          l11 = m.l11; l12 = m.l12; l21 = m.l21; l22 = m.l22;
      } else if (!cubeHull && entity.type === EntityType.PLAYER && (entity.visualRoll || entity.visualPitch)) {
          const r = entity.visualRoll ?? 0;
          const p = entity.visualPitch ?? 0;
          // Clamped locally under π/2: in TUMBLE tilt mode the angles are
          // unbounded (they wrap at ±π), and past π/2 the cos would
          // mirror the sprite — the wireframe hulls show the full
          // rotation; the sprite shows the nearest legal lean.
          const tilt = Math.min(1.45, Math.sqrt(r * r + p * p));
          const c = Math.cos(tilt);
          const phi = Math.atan2(r, p);
          const cp = Math.cos(phi);
          const sp = Math.sin(phi);
          // A = R(φ) × scale(c, 1) × R(−φ): the symmetric squash along the
          // tilt direction (sign of φ vs φ+π cancels in the products,
          // matching the projection's own sign-blindness).
          const a11 = c * cp * cp + sp * sp;
          const a12 = (c - 1) * cp * sp;
          const a22 = c * sp * sp + cp * cp;
          const ch = Math.cos(entity.rotation);
          const sh = Math.sin(entity.rotation);
          const co = Math.cos(SPRITE_CONSTANTS.PLAYER_ROTATION_OFFSET);
          const so = Math.sin(SPRITE_CONSTANTS.PLAYER_ROTATION_OFFSET);
          // B = R(facing) × A, then L = B × R(art offset).
          const b11 = ch * a11 - sh * a12;
          const b12 = ch * a12 - sh * a22;
          const b21 = sh * a11 + ch * a12;
          const b22 = sh * a12 + ch * a22;
          l11 = b11 * co + b12 * so;
          l12 = -b11 * so + b12 * co;
          l21 = b21 * co + b22 * so;
          l22 = -b21 * so + b22 * co;
      }
      ctx.setTransform(
        camA * l11 + camC * l21,
        camB * l11 + camD * l21,
        camA * l12 + camC * l22,
        camB * l12 + camD * l22,
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

      // --- TILT SHEET --- (render/shipSprites.ts)
      // One blit of the authored pose.  `nearestImage` covers a partial
      // sheet by falling back to the closest pose that HAS art.
      if (sheetHull && sheetCache && sheetRef) {
          const cell = sheetCache.nearestImage(sheetRef, this._getImg);
          if (cell) {
              const drawSize = Math.max(entity.size.x, entity.size.y) * sheetCache.sheet.drawScale;
              const o = -(drawSize / 2);
              ctx.drawImage(cell.img, cell.sx, cell.sy, cell.sw, cell.sh, o, o, drawSize, drawSize);
              // Same blow-out-toward-white hit read the sprite path gives.
              if (entity.hitFlash && entity.hitFlash > 0) {
                  const f = Math.min(1, entity.hitFlash * 3);
                  ctx.save();
                  ctx.globalAlpha = Math.min(1, 0.55 + f);
                  ctx.filter = `brightness(${(2 + f * 6).toFixed(2)})`;
                  ctx.drawImage(cell.img, cell.sx, cell.sy, cell.sw, cell.sh, o, o, drawSize, drawSize);
                  ctx.filter = 'none';
                  ctx.restore();
              }
              drawn = true;
          }
      }

      // --- WIREFRAME HULL --- (render/playerCube.ts)
      // The player's default hull (user call).  Takes the yaw-rotated
      // local frame set above and does the pitch/roll 3D math itself.
      if (cubeHull) {
          drawPlayerCube(ctx, entity, hullMode, getActiveTiltMode() === 'tumble', getActiveLeanDirSign() === -1);
          drawn = true;
      }

      // --- SPRITE RENDERING ---
      if (!drawn && entity.sprite) {
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
                      ctx.font = `${UI_CONSTANTS.HUD.TEXT.ROW}px monospace`;
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

      // A tilting or cube-hulled player leaves its own matrix behind before
      // the ring draws below: the shield ring is the PHYSICAL collision
      // radius and the charge ring is HUD — neither tilts with the hull,
      // and their `rotate(-rot)` bookkeeping assumes the plain rotation
      // matrix WITH the art offset (which the cube frame omits, so it is
      // recomputed here rather than reusing cosR/sinR).
      if (entity.type === EntityType.PLAYER
          && (cubeHull || sheetHull || entity.visualRoll || entity.visualPitch)) {
          const ringRot = entity.rotation + SPRITE_CONSTANTS.PLAYER_ROTATION_OFFSET;
          const cRr = Math.cos(ringRot);
          const sRr = Math.sin(ringRot);
          ctx.setTransform(
            camA * cRr + camC * sRr,
            camB * cRr + camD * sRr,
            -camA * sRr + camC * cRr,
            -camB * sRr + camD * cRr,
            camA * rx + camC * ry + camE,
            camB * rx + camD * ry + camF,
          );
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

  /**
   * The world-space health bar — a HIT REACTION, not a permanent label
   * (gauntlet 5d, U5; the parked "damage-triggered health / shield bars"
   * item).
   *
   * Three rules, and each of them removes something that used to be on screen
   * all the time:
   *
   *  1. **A bar appears when the entity takes damage and fades out again.**
   *     Every enemy used to carry one every frame, at full health and on
   *     one-shot trash alike, which read as "tracked HUD" for entities the
   *     player has no reason to track.  `healthBarTimer` is stamped by
   *     `markDamaged` at every damage path and ticked by PhysicsSystem, so
   *     the bars on screen are exactly the fights in progress.
   *  2. **The PLAYER's bar is BACK, and is the one permanent bar** (user
   *     call, reversing the U5 removal).  U5 argued it was the HUD chip's
   *     number twice; in play it is not, because the two answer at different
   *     costs — the bar is where the eye already is (on the ship, mid-fight)
   *     and the chip is where the exact figure is.  So both ship: the bar
   *     under the hull for the glance, the chip for the reading.  It is
   *     ALWAYS on rather than damage-triggered — your own condition is the
   *     one thing you never want to have to provoke into view — and it shows
   *     whichever pools are live, hull always and the shield strip only once
   *     a Shield core is installed.
   *  3. **The SHIELD bar is no longer player-only.**  Shields are
   *     entity-agnostic now (the Bulwark, boss phases), so any shielded
   *     entity gets the strip on a shield hit.
   *
   * `alwaysShowHealthBar` opts a priority target back into a persistent bar.
   * Capstone bosses deliberately do NOT set it: they have the dedicated HUD
   * bar, and a second readout under the hull is the redundancy rule 2 removes.
   *
   * Net effect on cost is a REDUCTION — most entities draw no bar on most
   * frames — against one timer decrement per entity.
   */
  private renderHealthBar(ctx: CanvasRenderingContext2D, entity: GameEntity, rx: number, ry: number) {
      // The PLAYER's own bar (rule 2) — always on, wider than an enemy's, and
      // drawn from the same geometry so the two read as one family.
      if (entity.type === EntityType.PLAYER) {
          if (entity.isExploding || entity.maxHealth <= 0) return;
          this.renderPlayerVitalsBar(ctx, entity, rx, ry);
          return;
      }
      if (entity.type !== EntityType.ENEMY || entity.maxHealth <= 0) return;
      // Bubbles (ambient fauna) carry no health bar — keep them reading as
      // neutral blobs, not tracked combatants.
      if (entity.enemyShape === 'bubble') return;

      // Damage-triggered visibility.  `alwaysShowHealthBar` and the DBG
      // toggle are the two ways back to a permanent bar.
      let alpha = 1;
      if (!entity.alwaysShowHealthBar && this.damageTriggeredBars) {
          const t = entity.healthBarTimer ?? 0;
          if (t <= 0) return;
          const { FADE_DURATION } = UI_CONSTANTS.HEALTH_BAR;
          if (t < FADE_DURATION) alpha = t / FADE_DURATION;
      }

      const { ENEMY_WIDTH, ENEMY_HEIGHT, OFFSET_MODIFIER, OFFSET_BASE } = UI_CONSTANTS.HEALTH_BAR;

      const width = ENEMY_WIDTH;
      const height = ENEMY_HEIGHT;

      // Calculate offset based on visual size approx
      const visualRadius = Math.max(entity.size.x, entity.size.y) * OFFSET_MODIFIER;
      const yOffset = visualRadius + OFFSET_BASE;

      const x = rx - width / 2;
      const y = ry + yOffset;

      const healthPct = Math.max(0, Math.min(1, entity.health / entity.maxHealth));

      const prevAlpha = ctx.globalAlpha;
      if (alpha < 1) ctx.globalAlpha = prevAlpha * alpha;

      // Background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(x, y, width, height);

      // Fill Color — normal enemy bars are red; rival bars take the
      // disposition team colour (red hostile / green ally / amber neutral) so the
      // bar doubles as the at-a-glance intent cue (replacing the removed ring).
      ctx.fillStyle = entity.isRival ? (entity.color || '#ef4444') : '#ef4444';

      ctx.fillRect(x, y, width * healthPct, height);

      // Shield strip — for ANY shielded entity now, not just the player
      // (rule 3): shields are entity-agnostic, so the Bulwark's arc and a
      // boss phase's bubble both read here.
      if (entity.maxShield && entity.maxShield > 0) {
          const shieldY = y + height + 1;
          const shieldHeight = height - 1;
          const shieldPct = Math.max(0, Math.min(1, (entity.shield ?? 0) / entity.maxShield));
          ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
          ctx.fillRect(x, shieldY, width, shieldHeight);
          ctx.fillStyle = SHIELD_COLOR;
          ctx.fillRect(x, shieldY, width * shieldPct, shieldHeight);
      }

      ctx.globalAlpha = prevAlpha;
  }

  /**
   * The player's own hull / shield bar, under the ship.
   *
   * Deliberately NOT the enemy path with a different width: it is a
   * different KIND of readout.  An enemy bar is a hit reaction that appears
   * and fades; this one is always on, because the player's condition is the
   * one thing they must never have to provoke into view.  It also carries
   * the same urgency colours as the HUD chip (emerald → amber → rose), so a
   * glance at the ship and a glance at the corner say the same thing.
   *
   * The SHIELD strip is drawn only when a Shield core is installed
   * (`maxShield` is 0 on the lean start), which is what "whichever is
   * active" means here — an empty strip would be a permanent reminder of a
   * module the player has not bought.
   */
  private renderPlayerVitalsBar(ctx: CanvasRenderingContext2D, entity: GameEntity, rx: number, ry: number) {
      const { PLAYER_WIDTH, PLAYER_HEIGHT, OFFSET_MODIFIER, OFFSET_BASE } = UI_CONSTANTS.HEALTH_BAR;
      const width = PLAYER_WIDTH;
      const height = PLAYER_HEIGHT;
      const yOffset = Math.max(entity.size.x, entity.size.y) * OFFSET_MODIFIER + OFFSET_BASE;
      const x = rx - width / 2;
      const y = ry + yOffset;

      const hp = Math.max(0, Math.min(1, entity.health / entity.maxHealth));
      // Same three bands the DOM vitals chip uses.  One rule, two surfaces.
      const hull = hp > 0.5 ? '#34d399' : hp > 0.25 ? '#fbbf24' : '#f43f5e';

      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(x, y, width, height);
      ctx.fillStyle = hull;
      ctx.fillRect(x, y, width * hp, height);

      if (entity.maxShield && entity.maxShield > 0) {
          const sh = Math.max(0, Math.min(1, (entity.shield ?? 0) / entity.maxShield));
          const sy = y + height + 1;
          const shh = Math.max(2, height - 2);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
          ctx.fillRect(x, sy, width, shh);
          ctx.fillStyle = SHIELD_COLOR;
          ctx.fillRect(x, sy, width * sh, shh);
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
