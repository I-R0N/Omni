
import { MapType, Vector2, GameEntity } from '../../types';
import {
  COLORS, SHOOTING_STAR_CONSTANTS, effectiveDpr,
  STARFIELD_CONSTANTS, getActiveStarDensity, getActiveStarSizeMode,
  getActiveStarBands, getActiveStarRegion, isStarDither,
} from '../../constants';
import { NEBULA_IMAGES } from '../../assets';
import { randomPaletteHueDeg } from '../NebulaColor';
import { wrapDeltaX, wrapDeltaY, MAP_WIDTH, MAP_HEIGHT } from '../toroidal';
import { hexToRgb } from './render/drawUtils';

/** Amplitude of each region-field wave, descending — one dominant structure
 *  with two finer ones laid over it.  Equal weights average into mush. */
const REGION_WAVE_WEIGHTS = [1.0, 0.6, 0.35] as const;
/** Phase offsets, so the waves do not all peak at the origin (which would put
 *  a conspicuous bullseye at the map centre, where the player spawns). */
const REGION_WAVE_PHASES = [0.13, 0.71, 0.29] as const;

/** A run of stars sharing one `fillStyle`, so the draw loop sets canvas state
 *  once per group instead of once per star.  Colour AND opacity are baked into
 *  the rgba string: a `globalAlpha` write costs the same as a `fillStyle`
 *  write, so folding alpha into the colour halves the state changes. */
interface StarGroup {
  fill: string;
  start: number;
  count: number;
  /** How many of this group's leading stars are MILKY-WAY stars.  They sort
   *  first and are never gated away by the region field — the galactic band is
   *  a landmark, and a landmark that dissolves when you fly into a void is not
   *  one.  Everything after them is ordered by a stable random threshold, so
   *  drawing a PREFIX of the group is a spatially unbiased sample of it. */
  mwCount: number;
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
  /** Per-frame integer draw offsets, derived from the accumulators above.
   *  Preallocated and overwritten in place; never rebuilt per frame. */
  private bandDrawX: Int32Array = new Int32Array(0);
  private bandDrawY: Int32Array = new Int32Array(0);
  /** Star position within its band, in DEVICE px, always integral. */
  private starX: Int32Array = new Int32Array(0);
  private starY: Int32Array = new Int32Array(0);
  /** Star edge length in DEVICE px (>= 1, always integral). */
  private starSize: Uint8Array = new Uint8Array(0);
  /** Per-star sub-pixel PHASE, 0..255 mapping to [0, 1) of a device pixel.
   *  Staggers WHEN each star crosses to the next pixel, so a slowly scrolling
   *  field advances continuously instead of every star in a layer jumping on
   *  the same frame.  Uint8 is ample: 1/256 px of phase precision is orders of
   *  magnitude below anything visible, and it keeps both axes to 48 KB. */
  private starDitherX: Uint8Array = new Uint8Array(0);
  private starDitherY: Uint8Array = new Uint8Array(0);
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
  // Reusable output for applyLensing — avoids a heap allocation per puff
  private _lensedX: number = 0;
  private _lensedY: number = 0;

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

  private applyLensing(x: number, y: number, cameraPos: Vector2, attractors: GameEntity[], halfW: number, halfH: number): void {
    let outX = x;
    let outY = y;
    for (let i = 0; i < attractors.length; i++) {
        const attr = attractors[i];
        const ax = wrapDeltaX(cameraPos.x, attr.position.x) + halfW;
        const ay = wrapDeltaY(cameraPos.y, attr.position.y) + halfH;
        const adx = outX - ax;
        const ady = outY - ay;
        const distSq = adx*adx + ady*ady;
        const radius = attr.size.x * 8;
        if (distSq < radius * radius) {
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

public setMapType(type: MapType) {
    if (this.mapType === type) return;
    this.mapType = type;
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
        const r = Math.random();
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
      Math.round(((width * height) / 1e4) * getActiveStarDensity()),
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

    // Depth layers.  Speed increases quadratically from background (slow) to
    // foreground (fast); the milky way sits at a fixed slow drift.
    this.bandSpeed = new Float64Array(TOTAL_BANDS);
    this.bandOffsetX = new Float64Array(TOTAL_BANDS);
    this.bandOffsetY = new Float64Array(TOTAL_BANDS);
    this.bandDrawX = new Int32Array(TOTAL_BANDS);
    this.bandDrawY = new Int32Array(TOTAL_BANDS);
    for (let b = 0; b < NUM_BANDS; b++) {
        const tMid = (b + 0.5) / NUM_BANDS;
        this.bandSpeed[b] = 0.02 + (tMid * tMid) * 2.0;
    }
    this.bandSpeed[MW_BAND] = 0.03;

    // ── generate into per-group buckets, then flatten ──────────────────────
    // Generation runs on map load and on resize only, so allocating here is
    // fine; the PER-FRAME path below allocates nothing.
    const total = this.starCount + this.milkyWayStarCount;
    const NUM_GROUPS = PALETTE.length * ALPHA_BUCKETS;
    const gX: number[][] = [];
    const gY: number[][] = [];
    const gS: number[][] = [];
    const gB: number[][] = [];
    // Stable random draw-order key per star.  Sorting each group by it is what
    // lets the region field gate stars by taking a PREFIX of the group rather
    // than testing every star every frame — see `renderStars`.  Milky-way stars
    // get -1 so they sort ahead of everything and survive any gating.
    const gT: number[][] = [];
    for (let i = 0; i < NUM_GROUPS; i++) { gX.push([]); gY.push([]); gS.push([]); gB.push([]); gT.push([]); }

    const emit = (xDev: number, yDev: number, sizeCss: number, band: number,
                  colorIdx: number, opacity: number) => {
        const g = colorIdx * ALPHA_BUCKETS + bucketOf(opacity);
        gX[g].push(xDev);
        gY[g].push(yDev);
        gS[g].push(this.starDevicePx(sizeCss, dpr));
        gB[g].push(band);
        gT[g].push(band === MW_BAND ? -1 : Math.random());
    };

    // WHOLE DEVICE PIXELS, both position and size.
    //
    // This used to be `fillRect(Math.random() * width, …, max(1, size), …)` in
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
            const t = (b + Math.random()) / NUM_BANDS;
            // Power-law size distribution: many tiny stars, fewer large ones.
            // Math.pow(r, 3) skews heavily toward small values so the field has
            // dense background haze but visible coloured foreground stars.
            const sizeBase = 0.3 + Math.pow(Math.random(), 3) * 0.6;
            const size = sizeBase * (0.5 + t * 0.8);
            // Within-band variation scaled against the band's brightness cap,
            // so parallax depth maps directly to perceived brightness.
            const variation = Math.min(1.0, 0.2 + Math.random() * 0.7 + size * 0.04);
            emit(
                Math.floor(Math.random() * pw),
                Math.floor(Math.random() * ph),
                size, b, starColorIdx(), bandBrightness * variation,
            );
        }
    }

    const mwAngle = (Math.random() - 0.5);
    for (let i = 0; i < this.milkyWayStarCount; i++) {
        // Laid out in CSS space (where the design constants live), then
        // snapped to whole device pixels like every other star.
        const xCss = Math.random() * width;
        const yCss = (height / 2) + Math.tan(mwAngle) * (xCss - width / 2)
                   + ((Math.random() + Math.random() + Math.random() - 1.5) * 40);
        const size = 0.3 + Math.pow(Math.random(), 3) * 0.6;
        // 30% of milky-way stars take one of the four accent hues.
        const colorIdx = Math.random() > 0.7
            ? 8 + Math.floor(Math.random() * 4)
            : starColorIdx();
        emit(
            Math.round(xCss * dpr), Math.round(yCss * dpr),
            size, MW_BAND, colorIdx,
            Math.min(1.0, 0.2 + Math.random() * 0.7 + size * 0.04),
        );
    }

    // Flatten into the struct-of-arrays the draw loop walks.  Groups are laid
    // out contiguously, so drawing is: set fillStyle once, then a linear run.
    this.starX = new Int32Array(total);
    this.starY = new Int32Array(total);
    this.starSize = new Uint8Array(total);
    this.starBandIdx = new Uint16Array(total);
    this.starDitherX = new Uint8Array(total);
    this.starDitherY = new Uint8Array(total);
    this.starGroups = [];
    let cursor = 0;
    for (let g = 0; g < NUM_GROUPS; g++) {
        const n = gX[g].length;
        if (n === 0) continue;
        const colorIdx = (g / ALPHA_BUCKETS) | 0;
        const alpha = (g % ALPHA_BUCKETS) / (ALPHA_BUCKETS - 1);
        const [r, gg, bl] = hexToRgb(PALETTE[colorIdx]);
        // Order the group by its draw-order key.  An INDEX permutation rather
        // than sorting five parallel arrays in lockstep; generation-time, so
        // the allocation is fine (the per-frame path still allocates nothing).
        const keys = gT[g];
        const order = new Uint32Array(n);
        for (let i = 0; i < n; i++) order[i] = i;
        order.sort((a, b) => keys[a] - keys[b]);
        let mwCount = 0;
        while (mwCount < n && keys[order[mwCount]] < 0) mwCount++;
        this.starGroups.push({
            fill: `rgba(${r},${gg},${bl},${alpha.toFixed(3)})`,
            start: cursor,
            count: n,
            mwCount,
        });
        for (let i = 0; i < n; i++) {
            const j = order[i];
            this.starX[cursor] = gX[g][j];
            this.starY[cursor] = gY[g][j];
            this.starSize[cursor] = gS[g][j];
            this.starBandIdx[cursor] = gB[g][j];
            // Independent phases per axis, so diagonal drift does not make the
            // two axes step together and reintroduce the lockstep.
            this.starDitherX[cursor] = (Math.random() * 256) | 0;
            this.starDitherY[cursor] = (Math.random() * 256) | 0;
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

    const hasAttractors = attractors.length > 0;
    
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
           this.applyLensing(drawX, drawY, cameraPos, attractors, halfW, halfH);
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
    this.renderStars(ctx, dx, dy, dpr, cameraPos);

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
  /** Star-density field: how rich the sky is at a world position, in [0, 1].
   *
   *  Three plane waves with INTEGER wave numbers.  Integer is the whole trick —
   *  it makes the field exactly periodic over MAP_WIDTH x MAP_HEIGHT, so it is
   *  seam-continuous on the torus with no special case at the wrap (the same
   *  device FlowFieldGrid's breathing term uses).  Irregular-looking because the
   *  three wave VECTORS are not multiples of one another; a single wave, or a
   *  product of two, would read as stripes or a checkerboard.
   *
   *  Deliberately NOT the asteroid flow field, which was evaluated for this:
   *  that is a normalised DIRECTION field with no density signal in its
   *  magnitude, it is re-baked when tiles are destroyed and slowly breathes, and
   *  reading it here would couple the backdrop to a gameplay system.  A sky that
   *  reshuffles when you shoot a nearby rock is a bug that would be very hard to
   *  recognise as one.  See the S7 decision in the ledger. */
  private regionDensityAt(
    wx: number, wy: number,
    waves: ReadonlyArray<readonly [number, number]> = getActiveStarRegion().waves,
  ): number {
    if (waves.length === 0) return 1;
    const u = wx / MAP_WIDTH;
    const v = wy / MAP_HEIGHT;
    const TAU = Math.PI * 2;
    // Fixed weights, descending: one dominant structure with two finer ones on
    // top.  Equal weights would average into mush.
    const W = REGION_WAVE_WEIGHTS;
    let n = 0;
    let norm = 0;
    for (let i = 0; i < waves.length; i++) {
      const w = i < W.length ? W[i] : W[W.length - 1];
      n += w * Math.sin(TAU * (waves[i][0] * u + waves[i][1] * v + REGION_WAVE_PHASES[i % REGION_WAVE_PHASES.length]));
      norm += w;
    }
    const d = 0.5 + n / (2 * norm);
    return d < 0 ? 0 : d > 1 ? 1 : d;
  }

  private renderStars(ctx: CanvasRenderingContext2D, dx: number, dy: number, dpr: number, cameraPos: Vector2) {
    const pw = this.bandPixelWidth;
    const ph = this.bandPixelHeight;
    if (pw <= 0 || ph <= 0) return;

    // Advance each depth layer, then snap it to a whole device pixel for the
    // draw.  The ACCUMULATOR stays fractional and only the DRAW OFFSET is
    // rounded: rounding the accumulator would quantise slow parallax to a
    // standstill, since the furthest layers move well under half a device
    // pixel per frame and each frame's rounding would discard the whole shift.
    const n = this.bandSpeed.length;
    for (let b = 0; b < n; b++) {
        // The milky way is the last layer and rides the raw speed; the depth
        // bands are scaled by the same 0.2 the pre-render used.
        const scale = (b === n - 1) ? 1 : 0.2;
        const sx = dx * this.bandSpeed[b] * scale * dpr;
        const sy = dy * this.bandSpeed[b] * scale * dpr;
        this.bandOffsetX[b] = ((this.bandOffsetX[b] - sx) % pw + pw) % pw;
        this.bandOffsetY[b] = ((this.bandOffsetY[b] - sy) % ph + ph) % ph;
        this.bandDrawX[b] = Math.round(this.bandOffsetX[b]);
        this.bandDrawY[b] = Math.round(this.bandOffsetY[b]);
    }

    // REGION GATING (S7).  Star density varies by where in the MAP the camera
    // is: rich regions fill the sky in, voids thin it out.  Because each group
    // is sorted by a stable random key, drawing a PREFIX of it is a spatially
    // unbiased random sample — so this costs ONE field sample per frame and a
    // multiply per group, not a test per star.  Milky-way stars sort ahead of
    // the key and are never gated away.
    const region = getActiveStarRegion();
    const frac = region.waves.length > 0
      ? region.minFrac + (1 - region.minFrac)
                       * this.regionDensityAt(cameraPos.x, cameraPos.y, region.waves)
      : 1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1.0;
    // Opacity is baked into each group's rgba fill, so `globalAlpha` stays 1
    // and a group costs exactly one state change.
    const X = this.starX, Y = this.starY, S = this.starSize, B = this.starBandIdx;
    const bdx = this.bandDrawX, bdy = this.bandDrawY;
    const bofx = this.bandOffsetX, bofy = this.bandOffsetY;
    const DX = this.starDitherX, DY = this.starDitherY;
    const dither = isStarDither();
    const groups = this.starGroups;
    for (let g = 0; g < groups.length; g++) {
        const grp = groups[g];
        ctx.fillStyle = grp.fill;
        const gated = grp.count - grp.mwCount;
        const end = grp.start + grp.mwCount
                  + (frac >= 1 ? gated : Math.round(gated * frac));
        if (dither) {
            for (let i = grp.start; i < end; i++) {
                const b = B[i];
                // The star's own sub-pixel phase decides WHEN it crosses to the
                // next pixel, so the layer's stars step at 256 different moments
                // instead of all on one frame.  `| 0` truncates, and every term
                // is non-negative here, so this is a floor to a WHOLE device
                // pixel — the S3 guarantee survives; only the timing changed.
                let x = (X[i] + bofx[b] + DX[i] * (1 / 256)) | 0;
                if (x >= pw) x -= pw;
                let y = (Y[i] + bofy[b] + DY[i] * (1 / 256)) | 0;
                if (y >= ph) y -= ph;
                const sz = S[i];
                ctx.fillRect(x, y, sz, sz);
            }
        } else {
            for (let i = grp.start; i < end; i++) {
                const b = B[i];
                // Undithered: every star in a layer shares one rounded offset,
                // so the whole layer steps on the same frame.  Kept behind the
                // DBG toggle as the A/B for the dither above.
                let x = X[i] + bdx[b];
                if (x >= pw) x -= pw;
                let y = Y[i] + bdy[b];
                if (y >= ph) y -= ph;
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
