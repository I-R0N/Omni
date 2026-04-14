
import { MapType, Vector2, GameEntity } from '../../types';
import { COLORS, SHOOTING_STAR_CONSTANTS } from '../../constants';
import { NEBULA_IMAGES } from '../../assets';

interface StarBand {
  canvas: HTMLCanvasElement;
  speed: number;
  offsetX: number;
  offsetY: number;
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
  private starBands: StarBand[] = [];
  private milkyWayBand: StarBand | null = null;
  private nebulaPuffs: NebulaPuff[] = [];
  private shootingStars: ShootingStar[] = [];
  private shootingTimer: number = 0;
  private lastCameraPos: Vector2 | null = null;
  private puffTextures: (HTMLCanvasElement | HTMLImageElement)[] = [];
  private sceneWidth: number = 0;
  private sceneHeight: number = 0;
  private initialized: boolean = false;
  // World-space seed positions shared with the nebula tile generator.
  // When set, `initContent` places one background-nebula puff at each
  // position (with depth = 1.0 so puffs stay aligned with tiles even
  // as the camera moves) instead of generating its own random list.
  // Populated by `setNebulaClusterCenters`, which GameEngine calls
  // after loading the map.
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

  private applyLensing(x: number, y: number, cameraPos: Vector2, attractors: GameEntity[], halfW: number, halfH: number): void {
    let outX = x;
    let outY = y;
    for (let i = 0; i < attractors.length; i++) {
        const attr = attractors[i];
        const ax = (attr.position.x - cameraPos.x) + halfW;
        const ay = (attr.position.y - cameraPos.y) + halfH;
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
   * Provide a shared list of world-space nebula cluster centers that
   * the tile generator already used as cluster seeds.  When set, the
   * background-nebula layer places one puff at each center with
   * depth = 1.0 so the background and tile layers stay perfectly
   * aligned in world space (and feel like one unified cloud).
   *
   * Force an initContent reset so the next render rebuilds puffs from
   * the new centers.  Passing null/empty falls back to the legacy
   * random distribution.
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

  private initContent(width: number, height: number) {
    this.sceneWidth = width;
    this.sceneHeight = height;
    this.starLayers = [];
    this.nebulaPuffs = [];
    this.milkyWay = [];

    // Nebula puffs — if the map provided a shared cluster-center list,
    // use those positions but KEEP the original random parallax depth
    // (0.2–1.0) so the background layer still drifts as the camera
    // moves.  At camera (0, 0) the BG puffs align with the world-space
    // tile clusters; as the player moves, parallax separates them and
    // the tile clusters appear on top of a drifting nebular backdrop.
    // Otherwise fall back to the legacy random distribution for maps
    // that don't have tile nebulae.
    if (this.nebulaClusterCenters) {
        for (const seed of this.nebulaClusterCenters) {
            const size = 150 + Math.random() * 250; // 150–400px
            const depth = 0.2 + Math.random() * 0.8; // 0.2–1.0 parallax
            const hue = Math.random() * 360;
            const color = `hsla(${hue}, 100%, 60%,`;
            this.nebulaPuffs.push({
                x: seed.x,
                y: seed.y,
                size: size,
                depth: depth,
                opacity: 0.1 + Math.random() * 0.55,
                color: color,
                hue: hue,
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 0.001,
                aspect: 0.8 + Math.random() * 0.4,
                textureIndex: Math.floor(Math.random() * this.puffTextures.length)
            });
        }
    } else {
        const numClusters = 50 + Math.floor(Math.random() * 51); // 50–100
        for (let i = 0; i < numClusters; i++) {
            const cx = (Math.random() - 0.5) * width * 20;
            const cy = (Math.random() - 0.5) * height * 20;
            const puffsPerCluster = 2 + Math.floor(Math.random() * 4); // 2–5

            for (let j = 0; j < puffsPerCluster; j++) {
                const size = 150 + Math.random() * 250; // 150–400px
                const depth = 0.2 + Math.random() * 0.8; // 0.2–1.0, no dampening
                const offsetX = (Math.random() - 0.5) * 300; // ±150
                const offsetY = (Math.random() - 0.5) * 200; // ±100
                const hue = Math.random() * 360;
                const color = `hsla(${hue}, 100%, 60%,`;

                this.nebulaPuffs.push({
                    x: cx + offsetX,
                    y: cy + offsetY,
                    size: size,
                    depth: depth,
                    opacity: 0.1 + Math.random() * 0.55,
                    color: color,
                    hue: hue,
                    rotation: Math.random() * Math.PI * 2,
                    rotationSpeed: (Math.random() - 0.5) * 0.001,
                    aspect: 0.8 + Math.random() * 0.4,
                    textureIndex: Math.floor(Math.random() * this.puffTextures.length)
                });
            }
        }
    }

    // Realistic stellar color distribution based on spectral class frequency.
    // Heavily weighted toward white/warm-white (most common), with a visible
    // minority of blue, orange and red stars for depth and variety.
    const starColor = (): string => {
        const r = Math.random();
        if (r < 0.50) return '#ffffff';    // A-type — white
        if (r < 0.65) return '#fff4e0';    // F-type — warm white
        if (r < 0.74) return '#ffd280';    // G-type — pale yellow (sun-like)
        if (r < 0.82) return '#ffb347';    // K-type — orange
        if (r < 0.89) return '#c8d8ff';    // B-type — pale blue
        if (r < 0.94) return '#9bb0ff';    // B/O-type — blue-white
        if (r < 0.97) return '#ff7043';    // M-type giant — red-orange
        return '#7ec8ff';                   // O-type — hot blue
    };

    // Pre-render milky way to its own band canvas (scrolls at a fixed slow speed).
    const mwCanvas = document.createElement('canvas');
    mwCanvas.width = width; mwCanvas.height = height;
    const mwCtx = mwCanvas.getContext('2d')!;
    const mwAngle = (Math.random() - 0.5);
    const mwColors = ['#8b5cf6', '#3b82f6', '#fbbf24', '#f472b6'];
    for (let i = 0; i < 80; i++) {
        const x = Math.random() * width;
        const y = (height / 2) + Math.tan(mwAngle) * (x - width / 2) + ((Math.random() + Math.random() + Math.random() - 1.5) * 40);
        const size = 0.3 + Math.pow(Math.random(), 3) * 0.6;
        mwCtx.globalAlpha = Math.min(1.0, 0.2 + Math.random() * 0.7 + size * 0.04);
        mwCtx.fillStyle = Math.random() > 0.7 ? mwColors[Math.floor(Math.random() * mwColors.length)] : starColor();
        if (size < 1.5) { mwCtx.fillRect(x, y, Math.max(1, size), Math.max(1, size)); }
        else { mwCtx.beginPath(); mwCtx.arc(x, y, size, 0, Math.PI * 2); mwCtx.fill(); }
    }
    mwCtx.globalAlpha = 1.0;
    this.milkyWayBand = { canvas: mwCanvas, speed: 0.03, offsetX: 0, offsetY: 0 };

    // Pre-render 8 star bands. Each band gets 1500 stars = 12,000 total.
    // Speed increases quadratically from background (slow) to foreground (fast).
    this.starBands = [];
    const NUM_BANDS = 60;
    const STARS_PER_BAND = 400;
    for (let b = 0; b < NUM_BANDS; b++) {
        const tMid = (b + 0.5) / NUM_BANDS;
        const speed = 0.02 + (tMid * tMid) * 2.0;
        const bandCanvas = document.createElement('canvas');
        bandCanvas.width = width; bandCanvas.height = height;
        const bandCtx = bandCanvas.getContext('2d')!;
        for (let i = 0; i < STARS_PER_BAND; i++) {
            const t = (b + Math.random()) / NUM_BANDS;
            // Power-law size distribution: many tiny stars, fewer large ones.
            // Math.pow(r, 3) skews heavily toward small values so the field
            // has dense background haze but visible coloured foreground stars.
            const sizeBase = 0.3 + Math.pow(Math.random(), 3) * 0.6;
            const size = sizeBase * (0.5 + t * 0.8);
            // Opacity: full 0.2–1.0 range; larger stars weighted brighter.
            const opacity = Math.min(1.0, 0.2 + Math.random() * 0.7 + size * 0.04);
            bandCtx.globalAlpha = opacity;
            bandCtx.fillStyle = starColor();
            const x = Math.random() * width;
            const y = Math.random() * height;
            if (size < 1.5) { bandCtx.fillRect(x, y, Math.max(1, size), Math.max(1, size)); }
            else { bandCtx.beginPath(); bandCtx.arc(x, y, size, 0, Math.PI * 2); bandCtx.fill(); }
        }
        bandCtx.globalAlpha = 1.0;
        this.starBands.push({ canvas: bandCanvas, speed, offsetX: 0, offsetY: 0 });
    }
    this.initialized = true;
  }

  public render(ctx: CanvasRenderingContext2D, cameraPos: Vector2, attractors: GameEntity[] = [], zoom: number = 1.0) {
    const dpr = window.devicePixelRatio || 1;
    const width = ctx.canvas.width / dpr;
    const height = ctx.canvas.height / dpr;
    if (width === 0 || height === 0) return;

    if (!this.initialized || width !== this.sceneWidth || height !== this.sceneHeight) {
        this.initContent(width, height);
        this.lastCameraPos = { ...cameraPos };
    }

    if (!this.lastCameraPos) this.lastCameraPos = { ...cameraPos };
    const dx = cameraPos.x - this.lastCameraPos.x;
    const dy = cameraPos.y - this.lastCameraPos.y;
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
        let drawX = (puff.x - cameraPos.x) * puff.depth + halfW;
        let drawY = (puff.y - cameraPos.y) * puff.depth + halfH;

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

    // RENDER STARS — each band is a pre-rendered canvas, shifted each frame
    // and tiled 4-ways for seamless wrapping. 32 drawImage calls vs 12,000.
    ctx.globalAlpha = 1.0;
    const drawBand = (band: StarBand, shiftX: number, shiftY: number) => {
        band.offsetX = ((band.offsetX - shiftX) % width + width) % width;
        band.offsetY = ((band.offsetY - shiftY) % height + height) % height;
        ctx.drawImage(band.canvas, band.offsetX,         band.offsetY);
        ctx.drawImage(band.canvas, band.offsetX - width, band.offsetY);
        ctx.drawImage(band.canvas, band.offsetX,         band.offsetY - height);
        ctx.drawImage(band.canvas, band.offsetX - width, band.offsetY - height);
    };

    if (this.milkyWayBand) drawBand(this.milkyWayBand, dx * 0.03, dy * 0.03);
    for (const band of this.starBands) {
        drawBand(band, dx * band.speed * 0.2, dy * band.speed * 0.2);
    }

    this.updateAndDrawShootingStars(ctx, width, height);

    ctx.restore();
    ctx.globalAlpha = 1.0;
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
