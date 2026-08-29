
import { MapType, Vector2, GameEntity } from '../../types';
import {
  COLORS, SHOOTING_STAR_CONSTANTS, effectiveDpr,
  STARFIELD_CONSTANTS, resolveStarDensity, getActiveStarSizeMode,
  getActiveStarBands, resolveStarParallax, PORTAL_CONSTANTS,
} from '../../constants';
import { NEBULA_IMAGES } from '../../assets';
import { randomPaletteHueDeg } from '../NebulaColor';
import { wrapDeltaX, wrapDeltaY } from '../toroidal';
import { hexToRgb } from './render/drawUtils';

/** A run of stars sharing one `fillStyle`, so the draw loop sets canvas state
 *  once per group instead of once per star.  Colour AND opacity are baked into
 *  the rgba string: a `globalAlpha` write costs the same as a `fillStyle`
 *  write, so folding alpha into the colour halves the state changes.
 *
 *  ONE state change per group is the invariant.  A region field briefly split
 *  each group into a solid run plus a fade band (up to six writes per group);
 *  it was removed because the gating read as stars appearing and disappearing
 *  in view — see the S13 decision in docs/GAUNTLET_STARFIELD_LOG.md. */
interface StarGroup {
  fill: string;
  start: number;
  count: number;
}

interface NebulaPuff {
  x: number;
  y: number;
  size: number;
  depth: number;
  opacity: number;
  color: string;
  hue: number;
  rotation: number;
  rotationSpeed: number;
  aspect: number;
  textureIndex: number;
  cachedCanvas?: HTMLCanvasElement;
}

interface ShootingStar {
  position: Vector2;
  velocity: Vector2;
  alpha: number;
  length: number;
}

export class BackgroundManager {
  private mapType: MapType;
  // ── THE STAR FIELD ───────────────────────────────────────────────────────
  //
  // Stars are DATA, drawn directly every frame — there are no pre-rendered
  // band canvases.  See the S4 section of docs/GAUNTLET_STARFIELD_LOG.md; the
  // short version is that the pre-render existed to trade ~12 000 fillRects
  // for 32 drawImages, and both halves of that trade went stale.  It had grown
  // to 61 full-viewport canvases blitted 4 ways each — 244 whole-screen blits
  // per frame, which at 390x844 dpr2 is 321 MEGApixels of mostly-transparent
  // overdraw, against a star budget of ~6 000.  Measured, direct drawing is
  // 6-25x faster and takes 0.07 MB where the canvases took 80-1265 MB.
  //
  // Parallax works the same way: stars belong to a depth layer and each layer
  // scrolls at its own speed.  What changed is the PRICE of a layer.  A layer
  // used to BE a full-viewport canvas, so 60 of them cost 80-316 MB and depth
  // granularity was rationed; a layer is now five numbers, so the default rose
  // to 240 layers for ~10 KB and 240 float updates per frame (S6).
  //
  // Layout is a struct-of-arrays sorted by draw group, so the per-frame loop is
  // a linear walk over typed arrays with one state change per group and zero
  // allocation.
  private bandSpeed: Float64Array = new Float64Array(0);
  /** Scroll accumulators, in DEVICE px.  Fractional — see `renderStars`. */
  private bandOffsetX: Float64Array = new Float64Array(0);
  private bandOffsetY: Float64Array = new Float64Array(0);
  /** Star position within its band, in DEVICE px, always integral. */
  private starX: Int32Array = new Int32Array(0);
  private starY: Int32Array = new Int32Array(0);
  /** Star edge length in DEVICE px (>= 1, always integral). */
  private starSize: Uint8Array = new Uint8Array(0);
  /** Which depth layer each star rides.  Uint16, not Uint8: the layer count is
   *  DBG-cyclable up to 480, and a Uint8 would wrap silently past 255 —
   *  scattering the far layers' stars onto near ones with no error anywhere. */
  private starBandIdx: Uint16Array = new Uint16Array(0);
  /** Draw groups over the arrays above, in sorted order. */
  private starGroups: StarGroup[] = [];
  private nebulaPuffs: NebulaPuff[] = [];
  private shootingStars: ShootingStar[] = [];
  private shootingTimer: number = 0;
  private lastCameraPos: Vector2 | null = null;
  private puffTextures: (HTMLCanvasElement | HTMLImageElement)[] = [];
  private sceneWidth: number = 0;
  private sceneHeight: number = 0;
  // The pixel ratio the CURRENT star field was generated at.  Star positions
  // and sizes are baked in DEVICE pixels (S3), so a change to the render-scale
  // cap has to regenerate them even though the CSS scene size is unchanged —
  // without this the stars keep their old device coordinates and the field
  // silently stops matching the canvas it is drawn into.
  private sceneDpr: number = 0;
  // The scene in DEVICE pixels.  Star coordinates and the scroll wrap both
  // live in this space, because it is the space the field is rasterized in.
  private bandPixelWidth: number = 0;
  private bandPixelHeight: number = 0;
  private initialized: boolean = false;
  // Derived star budget for the CURRENT scene size, kept as fields rather than
  // recomputed, because they are the numbers the density invariant is stated
  // in and `tests/starfield.spec.ts` reads them straight off the live manager
  // instead of counting pixels (tests/README.md harness rule 3).
  private starsPerBand: number = 0;
  private starCount: number = 0;
  private milkyWayStarCount: number = 0;
  // World-space seed positions shared with the nebula tile generator.
  // When non-null, `initContent` places one background-nebula puff at
  // each position (with the original random parallax depth 0.2–1.0,
  // so the backdrop still drifts as the camera moves).  At camera
  // (0, 0) every BG puff aligns with an interactable tile cluster;
  // as the player moves, parallax separates them and the tile clusters
  // visibly sit on top of a drifting nebular backdrop.  Populated by
  // `setNebulaClusterCenters`, which GameEngine calls after loading
  // a map whose init recorded its cluster centers.
  private nebulaClusterCenters: Vector2[] | null = null;
  /** Deterministic PRNG state for star generation — see `starRand`. */
  private starSeed: number = 0;
  // Reusable output for applyLensing — avoids a heap allocation per puff
  private _lensedX: number = 0;
  private _lensedY: number = 0;
  // Per-frame lens list — the on-screen attractors (wormhole portals),
  // projected ONCE per frame into screen space (CSS px, zoom applied) and
  // shared by the puff lensing and the star warp.  Index-filled and read up
  // to `_lensN` only, so a shrink never reallocates (refill idiom).
  private _lensCX: number[] = [];
  private _lensCY: number[] = [];
  private _lensStarR: number[] = [];
  private _lensPuffR: number[] = [];
  private _lensN: number = 0;
  // Device-px mirrors of the list above, filled by renderStars (star
  // positions live in device space).
  private _lensDevX: number[] = [];
  private _lensDevY: number[] = [];
  private _lensDevR: number[] = [];
  private _lensDevR2: number[] = [];

  constructor() {
    this.mapType = MapType.UNIVERSE;
    if (NEBULA_IMAGES.length > 0) {
      this.loadNebulaImages(NEBULA_IMAGES);
    } else {
      this.createPuffVariants();
    }
    this.shootingTimer = Math.random() * (SHOOTING_STAR_CONSTANTS.MAX_TIMER - SHOOTING_STAR_CONSTANTS.MIN_TIMER) + SHOOTING_STAR_CONSTANTS.MIN_TIMER;
  }

  private loadNebulaImages(paths: string[]) {
    paths.forEach(path => {
      const img = new Image();
      img.src = path;
      // Push immediately so textureIndex assignments in initContent are stable.
      // The image may still be loading; drawImage handles in-progress loads gracefully.
      this.puffTextures.push(img);
    });
  }

  /**
   * Swap the active nebula image set at runtime.  Clears the texture list
   * and every cached tinted puff canvas, then forces initContent to rerun
   * on the next render so textureIndex values re-map to the new set.
   */
  public setNebulaImages(paths: string[]) {
    this.puffTextures = [];
    if (paths.length > 0) {
      this.loadNebulaImages(paths);
    } else {
      this.createPuffVariants();
    }
    for (const puff of this.nebulaPuffs) puff.cachedCanvas = undefined;
    this.initialized = false;
  }

  /** Force the next `render` to regenerate the star bands and nebula puffs.
   *
   *  The scene is otherwise rebuilt only when the viewport SIZE changes, so a
   *  knob that changes what generation produces — today the DBG star-density
   *  cycle — has to say so explicitly or it would not take effect until the
   *  window was resized. */
  public invalidateContent() {
    this.initialized = false;
  }

  /** Displace a screen-space point (CSS px) away from every lens centre —
   *  the soft outward shove the nebula puffs take.  Reads the per-frame lens
   *  list built in `render` (centres already zoom-projected there, so a puff
   *  and the portal it bends around agree on where the portal is). */
  private applyLensing(x: number, y: number): void {
    let outX = x;
    let outY = y;
    for (let i = 0; i < this._lensN; i++) {
        const adx = outX - this._lensCX[i];
        const ady = outY - this._lensCY[i];
        const distSq = adx*adx + ady*ady;
        const radius = this._lensPuffR[i];
        if (distSq < radius * radius && distSq > 1e-6) {
            const dist = Math.sqrt(distSq);
            const factor = (radius - dist) / radius;
            if (factor > 0) {
              const push = factor * factor * factor * 120;
              outX += (adx / dist) * push;
              outY += (ady / dist) * push;
            }
        }
    }
    this._lensedX = outX;
    this._lensedY = outY;
  }

  /** Project the attractors into screen space once per frame.  Off-screen
   *  attractors (beyond their own largest lens radius) are dropped here, so
   *  the per-puff and per-star loops only ever see lenses that can matter. */
  private buildLensList(cameraPos: Vector2, attractors: GameEntity[],
                        width: number, height: number, zoom: number): void {
    let n = 0;
    for (let i = 0; i < attractors.length; i++) {
        const attr = attractors[i];
        if (!attr.active) continue;
        const sx = width / 2 + wrapDeltaX(cameraPos.x, attr.position.x) * zoom;
        const sy = height / 2 + wrapDeltaY(cameraPos.y, attr.position.y) * zoom;
        const starR = attr.size.x * PORTAL_CONSTANTS.LENS.RADIUS_MULT * zoom;
        const puffR = attr.size.x * 8 * zoom;
        const maxR = Math.max(starR, puffR);
        if (sx < -maxR || sx > width + maxR || sy < -maxR || sy > height + maxR) continue;
        this._lensCX[n] = sx;
        this._lensCY[n] = sy;
        this._lensStarR[n] = starR;
        this._lensPuffR[n] = puffR;
        n++;
    }
    this._lensN = n;
  }

public setMapType(type: MapType) {
    if (this.mapType === type) return;
    this.mapType = type;
    // The sky is per-MAP now — density, parallax spread and the generation
    // seed all key off `mapType` — so a map change has to rebuild it.  Before
    // the field became map-dependent this was correctly a no-op, which is why
    // the invalidation was missing: the seeded sky (S10) and the per-map
    // density (S12) both silently kept the PREVIOUS map's field until
    // something else (a resize) happened to trigger a rebuild.
    this.initialized = false;
  }

  /**
   * Provide a shared list of world-space nebula cluster start positions
   * that the tile generator recorded while building the tile clusters.
   * When set, `initContent` places one background-nebula puff at each
   * position (with the original random parallax depth 0.2–1.0 so the
   * backdrop still drifts as the camera moves).  Passing null/empty
   * falls back to the legacy random distribution.
   *
   * Forces an initContent reset so the next render rebuilds puffs from
   * the new centers — safe to call any time post-construction.
   */
  public setNebulaClusterCenters(centers: Vector2[] | null) {
    this.nebulaClusterCenters = centers && centers.length > 0 ? centers : null;
    this.initialized = false;
  }

  private createPuffVariants() {
    const numVariants = 5;
    const size = 128;
    for (let v = 0; v < numVariants; v++) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        const cx = size / 2;
        const cy = size / 2;
        const lobes = 15 + Math.floor(Math.random() * 10);
        const spread = size * 0.15;
        const stretchX = 0.8 + Math.random() * 0.4;
        const stretchY = 0.8 + Math.random() * 0.4;

        for (let i = 0; i < lobes; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * spread; 
            const x = cx + (Math.cos(angle) * dist) * stretchX;
            const y = cy + (Math.sin(angle) * dist) * stretchY;
            const r = (size * 0.015) + Math.random() * (size * 0.015);
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0.4)'); 
            grad.addColorStop(0.4, 'rgba(255, 255, 255, 0.1)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        this.puffTextures.push(canvas);
    }
  }

  /** Star-field PRNG (mulberry32).  Deliberately NOT `Math.random`.
   *
   *  The field is regenerated whenever anything about generation changes — the
   *  viewport, the pixel ratio, the density, the depth-layer count.  With an
   *  unseeded source, every one of those produced a completely NEW random sky,
   *  which made the DBG cycles almost impossible to judge: changing depth
   *  reshuffled every star, so it LOOKED like the star count had changed even
   *  though it was identical to within 0.03% (measured).  Knobs that exist to be
   *  compared by looking have to hold everything else still.
   *
   *  Seeded per MAP, so different maps get different skies and the same map is
   *  reproducible across a regeneration. */
  private starRand(): number {
    this.starSeed = (this.starSeed + 0x6D2B79F5) >>> 0;
    let t = this.starSeed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Stable per-map seed, so the sky is this map's sky every time. */
  private seedStarsFor(mapType: MapType): number {
    const s = String(mapType);
    let h = 0x9e3779b9;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    return h >>> 0;
  }

  /** Device-pixel size for a star whose designed size is `sizeCss` CSS px.
   *
   *  Always an INTEGER, and always at least 1, so the star fills whole device
   *  pixels.  A fractional size would be antialiased at the edges, which is
   *  half of the resampling S3 exists to remove — the other half being the
   *  fractional POSITION, handled at the call sites. */
  private starDevicePx(sizeCss: number, dpr: number): number {
    const floor = getActiveStarSizeMode() === 'css' ? Math.max(1, Math.round(dpr)) : 1;
    return Math.max(floor, Math.round(sizeCss * dpr));
  }

  private initContent(width: number, height: number, dpr: number) {
    this.sceneWidth = width;
    this.sceneHeight = height;
    this.sceneDpr = dpr;
    // The scene in DEVICE pixels.  Star coordinates are baked in this space so
    // the field rasterizes with no scale and no filter in the path.
    const pw = Math.max(1, Math.round(width * dpr));
    const ph = Math.max(1, Math.round(height * dpr));
    this.bandPixelWidth = pw;
    this.bandPixelHeight = ph;
    // The star arrays and the depth layers are (re)built further down in this
    // same method, alongside the rest of the generation pass.
    this.nebulaPuffs = [];

    // Nebula puffs — one background puff per recorded tile-cluster
    // position.  Each puff gets a RANDOM parallax depth (0.2–1.0) so
    // the backdrop drifts as the camera moves: at camera (0, 0) every
    // BG puff aligns with an interactable tile cluster; as the camera
    // moves, parallax separates them and the tile clusters appear on
    // top of a drifting nebular backdrop.
    //
    // Maps without nebula tiles supply no cluster centers, so the
    // background stays empty of nebulae — BG puffs exist only where
    // interactable nebula tiles do, keeping the single-element
    // showcase maps visually honest.
    if (this.nebulaClusterCenters) {
        for (const seed of this.nebulaClusterCenters) {
            const size = 150 + Math.random() * 250; // 150–400px
            const depth = 0.2 + Math.random() * 0.8; // 0.2–1.0 parallax
            const hue = randomPaletteHueDeg();
            const color = `hsla(${hue}, 100%, 60%,`;
            this.nebulaPuffs.push({
                x: seed.x,
                y: seed.y,
                size: size,
                depth: depth,
                opacity: 0.1 + Math.random() * 0.55, // 0.10–0.65
                color: color,
                hue: hue,
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 0.001,
                aspect: 0.8 + Math.random() * 0.4,
                textureIndex: Math.floor(Math.random() * this.puffTextures.length)
            });
        }
    }

    // Seed the star PRNG for THIS map.  Everything below draws from it, so a
    // regeneration (resize, ratio change, density or depth cycle) reproduces the
    // same sky instead of rolling a new one — which is what makes the DBG knobs
    // comparable by looking.
    this.starSeed = this.seedStarsFor(this.mapType);

    // Realistic stellar colour distribution based on spectral class frequency.
    // Heavily weighted toward white/warm-white (most common), with a visible
    // minority of blue, orange and red stars for depth and variety.  The last
    // four are milky-way-only accents.
    const PALETTE = [
        '#ffffff',   // 0  A-type — white
        '#fff4e0',   // 1  F-type — warm white
        '#ffd280',   // 2  G-type — pale yellow (sun-like)
        '#ffb347',   // 3  K-type — orange
        '#c8d8ff',   // 4  B-type — pale blue
        '#9bb0ff',   // 5  B/O-type — blue-white
        '#ff7043',   // 6  M-type giant — red-orange
        '#7ec8ff',   // 7  O-type — hot blue
        '#8b5cf6',   // 8  milky-way accents
        '#3b82f6',   // 9
        '#fbbf24',   // 10
        '#f472b6',   // 11
    ];
    const starColorIdx = (): number => {
        const r = this.starRand();
        if (r < 0.50) return 0;
        if (r < 0.65) return 1;
        if (r < 0.74) return 2;
        if (r < 0.82) return 3;
        if (r < 0.89) return 4;
        if (r < 0.94) return 5;
        if (r < 0.97) return 6;
        return 7;
    };
    // Opacity is QUANTISED into buckets so stars can be batched by fill style.
    // 16 buckets over a 0.05–0.95 range is a ~5.6% step, which is below the
    // just-noticeable difference for a 1-pixel dot against black, and it is
    // what turns ~6 000 state changes per frame into at most 12 x 16.
    const ALPHA_BUCKETS = 16;
    const bucketOf = (opacity: number) =>
        Math.min(ALPHA_BUCKETS - 1, Math.max(0, Math.round(opacity * (ALPHA_BUCKETS - 1))));

    const NUM_BANDS = getActiveStarBands();
    // Band index NUM_BANDS is the milky way — one more depth layer, scrolling
    // at its own fixed slow speed, rather than a special case with its own
    // storage and its own draw path.
    const MW_BAND = NUM_BANDS;
    const TOTAL_BANDS = NUM_BANDS + 1;

    // The star BUDGET is derived from viewport AREA at a target density
    // (STAR_DENSITY_CYCLE, stars per 10k CSS px^2) — it is NOT a fixed count.
    // A fixed count made a smaller window a denser sky: measured 729 stars per
    // 10k CSS px^2 on a 390x844 phone against 185 on a 1440x900 desktop, from
    // the same absolute 24 000.  Deriving from area is what makes them agree.
    this.starCount = Math.max(
      NUM_BANDS,
      Math.round(((width * height) / 1e4) * resolveStarDensity(this.mapType)),
    );
    // Every band carries the same share, so the density invariant holds per
    // band as well as in total.  Round-off is absorbed by the total rather
    // than by band 0, which would make the furthest layer denser.
    const STARS_PER_BAND = Math.max(1, Math.round(this.starCount / NUM_BANDS));
    this.starsPerBand = STARS_PER_BAND;
    this.starCount = STARS_PER_BAND * NUM_BANDS;

    // Linear in WIDTH, not area: the milky way's stars are strung along a
    // diagonal that spans the viewport width, so keeping its along-band
    // density constant means scaling with width.  (The field proper is an AREA
    // feature and scales with area — above.)
    this.milkyWayStarCount = Math.max(
      1,
      Math.round((width / 1000) * STARFIELD_CONSTANTS.MILKY_WAY_PER_1K_WIDTH),
    );

    // Depth layers.  Speed rises quadratically from background (slow) to
    // foreground (fast), spanning DEPTH_FLOOR .. DEPTH_FLOOR + SPREAD.
    //
    // SPREAD and LAYER COUNT are independent, and conflating them is the
    // natural mistake: the span between the farthest and nearest layer is set
    // by SPREAD alone, so adding layers subdivides the SAME range more finely
    // rather than deepening it.  More layers therefore reads as LESS separation
    // between neighbours, not more.
    // Per-MAP sky: density is this map's own value (or the DBG override), and
    // the parallax spread follows from it — sparse skies are NEAR skies and
    // separate more as you move.  See STAR_DENSITY_BY_MAP.
    const spread = resolveStarParallax(this.mapType);
    const floor = STARFIELD_CONSTANTS.DEPTH_FLOOR;
    this.bandSpeed = new Float64Array(TOTAL_BANDS);
    this.bandOffsetX = new Float64Array(TOTAL_BANDS);
    this.bandOffsetY = new Float64Array(TOTAL_BANDS);
    for (let b = 0; b < NUM_BANDS; b++) {
        const tMid = (b + 0.5) / NUM_BANDS;
        this.bandSpeed[b] = floor + (tMid * tMid) * spread;
    }
    // The milky way rides the same curve at a fixed DEPTH, so it holds its
    // place in the stack as the spread changes.
    const mwT = STARFIELD_CONSTANTS.MILKY_WAY_DEPTH;
    this.bandSpeed[MW_BAND] = floor + mwT * mwT * spread;

    // ── generate into per-group buckets, then flatten ──────────────────────
    // Generation runs on map load and on resize only, so allocating here is
    // fine; the PER-FRAME path below allocates nothing.
    const total = this.starCount + this.milkyWayStarCount;
    const NUM_GROUPS = PALETTE.length * ALPHA_BUCKETS;
    const gX: number[][] = [];
    const gY: number[][] = [];
    const gS: number[][] = [];
    const gB: number[][] = [];
    for (let i = 0; i < NUM_GROUPS; i++) { gX.push([]); gY.push([]); gS.push([]); gB.push([]); }

    const emit = (xDev: number, yDev: number, sizeCss: number, band: number,
                  colorIdx: number, opacity: number) => {
        const g = colorIdx * ALPHA_BUCKETS + bucketOf(opacity);
        gX[g].push(xDev);
        gY[g].push(yDev);
        gS[g].push(this.starDevicePx(sizeCss, dpr));
        gB[g].push(band);
    };

    // WHOLE DEVICE PIXELS, both position and size.
    //
    // This used to be `fillRect(this.starRand() * width, …, max(1, size), …)` in
    // CSS space.  The rect was 1x1, but its ORIGIN was fractional, so Canvas2D
    // antialiased every star into a 2x2 block of partial-alpha pixels before
    // anything else touched it — measured at 93.8% of scanline runs being 2px
    // wide (S1, claim 2b).  Flooring position and rounding size to integers is
    // what makes a star occupy exactly the pixels it is drawn into.
    //
    // (The old `size < 1.5` arc branch here was dead code: star size tops out
    // at 1.17 CSS px, so the fillRect branch always won.  An arc would
    // reintroduce edge antialiasing anyway.)
    for (let b = 0; b < NUM_BANDS; b++) {
        const tMid = (b + 0.5) / NUM_BANDS;
        // Per-band brightness cap: furthest band (b=0) dimmest at 25%,
        // closest band (b=NUM_BANDS-1) brightest at 95%, linear between.
        const bandBrightness = 0.25 + tMid * 0.70;
        for (let i = 0; i < STARS_PER_BAND; i++) {
            const t = (b + this.starRand()) / NUM_BANDS;
            // Power-law size distribution: many tiny stars, fewer large ones.
            // Math.pow(r, 3) skews heavily toward small values so the field has
            // dense background haze but visible coloured foreground stars.
            const sizeBase = 0.3 + Math.pow(this.starRand(), 3) * 0.6;
            const size = sizeBase * (0.5 + t * 0.8);
            // Within-band variation scaled against the band's brightness cap,
            // so parallax depth maps directly to perceived brightness.
            const variation = Math.min(1.0, 0.2 + this.starRand() * 0.7 + size * 0.04);
            emit(
                Math.floor(this.starRand() * pw),
                Math.floor(this.starRand() * ph),
                size, b, starColorIdx(), bandBrightness * variation,
            );
        }
    }

    const mwAngle = (this.starRand() - 0.5);
    for (let i = 0; i < this.milkyWayStarCount; i++) {
        // Laid out in CSS space (where the design constants live), then
        // snapped to whole device pixels like every other star.
        const xCss = this.starRand() * width;
        const yCss = (height / 2) + Math.tan(mwAngle) * (xCss - width / 2)
                   + ((this.starRand() + this.starRand() + this.starRand() - 1.5) * 40);
        const size = 0.3 + Math.pow(this.starRand(), 3) * 0.6;
        // 30% of milky-way stars take one of the four accent hues.
        const colorIdx = this.starRand() > 0.7
            ? 8 + Math.floor(this.starRand() * 4)
            : starColorIdx();
        emit(
            Math.round(xCss * dpr), Math.round(yCss * dpr),
            size, MW_BAND, colorIdx,
            Math.min(1.0, 0.2 + this.starRand() * 0.7 + size * 0.04),
        );
    }

    // Flatten into the struct-of-arrays the draw loop walks.  Groups are laid
    // out contiguously, so drawing is: set fillStyle once, then a linear run.
    this.starX = new Int32Array(total);
    this.starY = new Int32Array(total);
    this.starSize = new Uint8Array(total);
    this.starBandIdx = new Uint16Array(total);
    this.starGroups = [];
    let cursor = 0;
    for (let g = 0; g < NUM_GROUPS; g++) {
        const n = gX[g].length;
        if (n === 0) continue;
        const colorIdx = (g / ALPHA_BUCKETS) | 0;
        const alpha = (g % ALPHA_BUCKETS) / (ALPHA_BUCKETS - 1);
        const [r, gg, bl] = hexToRgb(PALETTE[colorIdx]);
        this.starGroups.push({
            fill: `rgba(${r},${gg},${bl},${alpha.toFixed(3)})`,
            start: cursor,
            count: n,
        });
        for (let i = 0; i < n; i++) {
            this.starX[cursor] = gX[g][i];
            this.starY[cursor] = gY[g][i];
            this.starSize[cursor] = gS[g][i];
            this.starBandIdx[cursor] = gB[g][i];
            cursor++;
        }
    }

    this.initialized = true;
  }

  public render(ctx: CanvasRenderingContext2D, cameraPos: Vector2, attractors: GameEntity[] = [], zoom: number = 1.0) {
    // MUST be the CAPPED ratio (effectiveDpr), not window.devicePixelRatio.
    // The canvas backing store is sized with the cap applied, so dividing by
    // the raw device ratio yields a scene SMALLER than the real CSS viewport.
    // Two things then go wrong at once: the star budget is derived from that
    // scene's area, so the sky comes out over-dense (at a 2x cap on a dpr-3
    // phone the scene is 4/9 of the area, i.e. 2.25x the density), and every
    // star's DEVICE coordinate is baked against a ratio the canvas is not
    // actually using, so the field stops landing on whole pixels.
    // `sceneDpr` below is this same value, remembered, so a change to the cap
    // regenerates the field instead of leaving it mismatched.
    const dpr = effectiveDpr();
    const width = ctx.canvas.width / dpr;
    const height = ctx.canvas.height / dpr;
    if (width === 0 || height === 0) return;

    if (!this.initialized || width !== this.sceneWidth || height !== this.sceneHeight
        || dpr !== this.sceneDpr) {
        this.initContent(width, height, dpr);
        this.lastCameraPos = { ...cameraPos };
    }

    if (!this.lastCameraPos) this.lastCameraPos = { ...cameraPos };
    // Wrapped delta so a camera that just crossed a seam produces a
    // small parallax nudge rather than a full-map scroll of the star
    // bands.  Absolute `lastCameraPos` is still refreshed from the raw
    // cameraPos (not the wrapped delta) so subsequent deltas stay
    // consistent as the player keeps moving.
    const dx = wrapDeltaX(this.lastCameraPos.x, cameraPos.x);
    const dy = wrapDeltaY(this.lastCameraPos.y, cameraPos.y);
    this.lastCameraPos = { ...cameraPos };

    ctx.save();
    const halfW = width / 2;
    const halfH = height / 2;
    const cx = halfW;
    const cy = halfH;
    // Reset to DPR-scaled identity so background draws in CSS pixel space,
    // consistent with the rest of the renderer (which uses canvas.width / dpr).
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // Project attractors to screen space once — both the puff lensing and
    // the star warp read this list.
    this.buildLensList(cameraPos, attractors, width, height, zoom);
    const hasAttractors = this._lensN > 0;

    // RENDER NEBULAE
    // x/y are world-space coordinates. Project to screen via parallax depth so
    // nebulae are distributed across the world and discovered as the camera moves.
    this.nebulaPuffs.forEach(puff => {
        // Toroidal delta so a puff on the far side of the seam still reads
        // as "close" to the camera and draws at the correct parallax-offset
        // screen spot instead of ~MAP_WIDTH off to the side.
        let drawX = wrapDeltaX(cameraPos.x, puff.x) * puff.depth + halfW;
        let drawY = wrapDeltaY(cameraPos.y, puff.y) * puff.depth + halfH;

        // Frustum cull before doing any work
        const margin = puff.size;
        if (drawX < -margin || drawX > width + margin || drawY < -margin || drawY > height + margin) return;

        puff.rotation += puff.rotationSpeed;

        // Build tinted canvas once per puff when the image is ready, then reuse every frame.
        const texture = this.puffTextures[puff.textureIndex % this.puffTextures.length];
        if (!puff.cachedCanvas && texture instanceof HTMLImageElement && texture.complete && texture.naturalWidth > 0) {
            const sz = 256;
            const offscreen = document.createElement('canvas');
            offscreen.width = sz;
            offscreen.height = sz;
            const off = offscreen.getContext('2d')!;
            off.drawImage(texture, 0, 0, sz, sz);
            off.globalCompositeOperation = 'source-atop';
            off.fillStyle = puff.color + '0.85)';
            off.fillRect(0, 0, sz, sz);
            puff.cachedCanvas = offscreen;
        }

        const drawable = puff.cachedCanvas ?? (texture instanceof HTMLCanvasElement ? texture : null);
        if (!drawable) return;

        if (hasAttractors) {
           this.applyLensing(drawX, drawY);
           drawX = this._lensedX;
           drawY = this._lensedY;
        }

        // Direct matrix set — no push/pop, ~2× faster than save/translate/rotate/scale/restore
        const cos = Math.cos(puff.rotation);
        const sin = Math.sin(puff.rotation);
        ctx.globalAlpha = puff.opacity;
        ctx.setTransform(
            dpr * cos * puff.aspect,  dpr * sin * puff.aspect,
            dpr * -sin,               dpr * cos,
            dpr * drawX,              dpr * drawY
        );
        ctx.drawImage(drawable, -puff.size / 2, -puff.size / 2, puff.size, puff.size);
    });
    // Restore base DPR transform for subsequent star-band and shooting-star drawing
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1.0;

    // RENDER STARS — drawn directly from the star arrays, no intermediate
    // canvas.  See `renderStars`.
    this.renderStars(ctx, dx, dy, dpr);

    // Back to CSS-pixel space for the shooting stars, which are laid out in
    // CSS units like the rest of the renderer.
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.updateAndDrawShootingStars(ctx, width, height);

    ctx.restore();
    ctx.globalAlpha = 1.0;
  }

  /** Draw the whole star field: one linear pass over the star arrays, one
   *  canvas state change per draw group, zero allocation.
   *
   *  NO RESAMPLING IS POSSIBLE IN THIS PATH (S3/S4).  Stars are rasterized
   *  ONCE, here, at integer DEVICE coordinates under the IDENTITY transform —
   *  there is no intermediate canvas to be filtered on its way to the screen.
   *  The previous structure pre-rendered 61 full-viewport band canvases and
   *  blitted them 4 ways each, which is where the browser-dependent filter
   *  lived: a CSS-px band drawn into a `setTransform(dpr,…)` context at a
   *  fractional offset turned 296 lit device pixels at mean luma 32.3 into 635
   *  at 14.7, by whichever kernel the engine picked (S1, claim 2c).
   *
   *  It is also much cheaper.  244 whole-screen blits is 321 MEGApixels of
   *  mostly-transparent overdraw per frame at 390x844 dpr2, against a budget
   *  of ~6 000 stars; measured, this path is 6-25x faster and holds 0.07 MB
   *  where the canvases held 80-1265 MB (S4).
   *
   *  Hoisted to a method rather than a closure inside `render` on purpose: a
   *  function constructed in a per-frame path is rebuilt every frame
   *  (CLAUDE.md §8, the refill idiom's sibling rule). */
  private renderStars(ctx: CanvasRenderingContext2D, dx: number, dy: number, dpr: number) {
    const pw = this.bandPixelWidth;
    const ph = this.bandPixelHeight;
    if (pw <= 0 || ph <= 0) return;

    // Advance each depth layer.  The offsets stay FRACTIONAL all the way to the
    // draw: stars are positioned sub-pixel, so there is nothing to round, and
    // rounding here is what used to make slow parallax jitter.
    const n = this.bandSpeed.length;
    for (let b = 0; b < n; b++) {
        // The milky way is the last layer and rides the raw speed; the depth
        // bands are scaled by the same 0.2 the pre-render used.
        const scale = (b === n - 1) ? 1 : 0.2;
        const sx = dx * this.bandSpeed[b] * scale * dpr;
        const sy = dy * this.bandSpeed[b] * scale * dpr;
        this.bandOffsetX[b] = ((this.bandOffsetX[b] - sx) % pw + pw) % pw;
        this.bandOffsetY[b] = ((this.bandOffsetY[b] - sy) % ph + ph) % ph;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1.0;
    // Opacity is baked into each group's rgba fill, so `globalAlpha` stays 1
    // and a group costs exactly ONE state change followed by a contiguous walk.
    const X = this.starX, Y = this.starY, S = this.starSize, B = this.starBandIdx;
    const bofx = this.bandOffsetX, bofy = this.bandOffsetY;
    const groups = this.starGroups;

    // ── Wormhole star warp ─────────────────────────────────────────────
    // Mirror the frame's lens list (CSS px, built in `render`) into device
    // px, the space the star coordinates live in.  Reused arrays, read up
    // to lensN — no allocation.  The warp displaces stars radially outward
    // (evacuating the throat into an Einstein-ring pile-up) and rotates
    // them around the centre by a swirl that strengthens toward the mouth
    // and ADVANCES over time, so near-field stars orbit with differential
    // speed.  Displaced positions stay fractional — that is already the
    // rule here — and sizes stay integral, so nothing is resampled.
    const lensN = this._lensN;
    const ldx = this._lensDevX, ldy = this._lensDevY;
    const lr = this._lensDevR, lr2 = this._lensDevR2;
    for (let l = 0; l < lensN; l++) {
        ldx[l] = this._lensCX[l] * dpr;
        ldy[l] = this._lensCY[l] * dpr;
        lr[l] = this._lensStarR[l] * dpr;
        lr2[l] = lr[l] * lr[l];
    }
    const pushDev = PORTAL_CONSTANTS.LENS.PUSH * dpr;
    const swirlNow = PORTAL_CONSTANTS.LENS.SWIRL_WIND
        + performance.now() * 0.001 * PORTAL_CONSTANTS.LENS.SWIRL_RATE;

    for (let g = 0; g < groups.length; g++) {
        const grp = groups[g];
        ctx.fillStyle = grp.fill;
        const end = grp.start + grp.count;
        // SUB-PIXEL: the exact fractional position, so the field moves
        // continuously at any speed.  Canvas antialiases the rect across the
        // pixels it straddles — coverage antialiasing on an axis-aligned rect,
        // which is analytic and consistent across engines, unlike the
        // drawImage resampling filter this gauntlet began by removing (and
        // which S4 deleted from this path).
        if (lensN === 0) {
            // No lens on screen: the original tight loop, untouched.
            for (let i = grp.start; i < end; i++) {
                const b = B[i];
                let x = X[i] + bofx[b];
                if (x >= pw) x -= pw;
                let y = Y[i] + bofy[b];
                if (y >= ph) y -= ph;
                const sz = S[i];
                ctx.fillRect(x, y, sz, sz);
            }
        } else {
            for (let i = grp.start; i < end; i++) {
                const b = B[i];
                let x = X[i] + bofx[b];
                if (x >= pw) x -= pw;
                let y = Y[i] + bofy[b];
                if (y >= ph) y -= ph;
                for (let l = 0; l < lensN; l++) {
                    const dx0 = x - ldx[l];
                    const dy0 = y - ldy[l];
                    const d2 = dx0 * dx0 + dy0 * dy0;
                    // Quadratic falloff: outside the radius nothing moves;
                    // the sqrt + sin/cos below run only for stars inside it.
                    if (d2 >= lr2[l] || d2 < 1e-6) continue;
                    const d = Math.sqrt(d2);
                    const f = 1 - d / lr[l];
                    const f2 = f * f;
                    const scale = (d + f2 * pushDev) / d;
                    const nx = dx0 * scale;
                    const ny = dy0 * scale;
                    const ang = f2 * swirlNow;
                    const ca = Math.cos(ang);
                    const sa = Math.sin(ang);
                    x = ldx[l] + nx * ca - ny * sa;
                    y = ldy[l] + nx * sa + ny * ca;
                }
                const sz = S[i];
                ctx.fillRect(x, y, sz, sz);
            }
        }
    }
  }

  private updateAndDrawShootingStars(ctx: CanvasRenderingContext2D, w: number, h: number) {
      this.shootingTimer--;
      if (this.shootingTimer <= 0) {
          this.spawnShootingStar(w, h);
          this.shootingTimer = Math.random() * (SHOOTING_STAR_CONSTANTS.MAX_TIMER - SHOOTING_STAR_CONSTANTS.MIN_TIMER) + SHOOTING_STAR_CONSTANTS.MIN_TIMER;
      }
      for (let i = this.shootingStars.length - 1; i >= 0; i--) {
          const s = this.shootingStars[i];
          s.position.x += s.velocity.x * 0.016; 
          s.position.y += s.velocity.y * 0.016;
          if (s.position.x < -100 || s.position.x > w + 100 || s.position.y < -100 || s.position.y > h + 100) {
              this.shootingStars.splice(i, 1);
              continue;
          }
          s.alpha -= 0.005;
          if (s.alpha <= 0) {
              this.shootingStars.splice(i, 1);
              continue;
          }
          const tailX = (s.position.x - (s.velocity.x * 0.05));
          const tailY = (s.position.y - (s.velocity.y * 0.05));
          ctx.save();
          ctx.strokeStyle = `rgba(255, 255, 255, ${s.alpha})`;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(s.position.x, s.position.y); ctx.lineTo(tailX, tailY); ctx.stroke();
          ctx.restore();
      }
  }

  private spawnShootingStar(w: number, h: number) {
      const off = 50;
      let sx, sy, tx, ty;
      const edge = Math.random();
      if (edge < 0.33) { sx = Math.random()*(w+off*2)-off; sy = -off; tx = Math.random()*(w+off*2)-off; ty = h+off; }
      else if (edge < 0.66) { sx = -off; sy = Math.random()*(h+off*2)-off; tx = w+off; ty = Math.random()*(h+off*2)-off; }
      else { sx = w+off; sy = Math.random()*(h+off*2)-off; tx = -off; ty = Math.random()*(h+off*2)-off; }
      const angle = Math.atan2(ty - sy, tx - sx);
      const speed = Math.random() * (SHOOTING_STAR_CONSTANTS.SPEED_MAX - SHOOTING_STAR_CONSTANTS.SPEED_MIN) + SHOOTING_STAR_CONSTANTS.SPEED_MIN;
      this.shootingStars.push({
          position: { x: sx, y: sy },
          velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
          alpha: 1.0, length: 20
      });
  }

  private renderGrid(ctx: CanvasRenderingContext2D, width: number, height: number, cameraPos: Vector2) {
    const gridSize = 64;
    const offsetX = -cameraPos.x % gridSize;
    const offsetY = -cameraPos.y % gridSize;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)'; 
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = offsetX; x < width; x += gridSize) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
    for (let y = offsetY; y < height; y += gridSize) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
    ctx.stroke();
  }
}
