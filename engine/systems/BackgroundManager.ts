
import { MapType, Vector2, GameEntity } from '../../types';
import { COLORS, SHOOTING_STAR_CONSTANTS } from '../../constants';

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  color: string;
}

interface StarLayer {
  stars: Star[];
  speed: number;
}

interface NebulaPuff {
  x: number;
  y: number;
  size: number;
  depth: number;
  opacity: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  aspect: number;
  textureIndex: number;
}

interface ShootingStar {
  position: Vector2;
  velocity: Vector2;
  alpha: number;
  length: number;
}

export class BackgroundManager {
  private mapType: MapType;
  private starLayers: StarLayer[] = [];
  private nebulaPuffs: NebulaPuff[] = [];
  private milkyWay: Star[] = [];
  private shootingStars: ShootingStar[] = [];
  private shootingTimer: number = 0;
  private lastCameraPos: Vector2 | null = null;
  private puffTextures: HTMLCanvasElement[] = [];
  private sceneWidth: number = 0;
  private sceneHeight: number = 0;
  private initialized: boolean = false;

  constructor() {
    this.mapType = MapType.UNIVERSE;
    this.createPuffVariants();
    this.shootingTimer = Math.random() * (SHOOTING_STAR_CONSTANTS.MAX_TIMER - SHOOTING_STAR_CONSTANTS.MIN_TIMER) + SHOOTING_STAR_CONSTANTS.MIN_TIMER;
  }

  private applyLensing(x: number, y: number, cameraPos: Vector2, attractors: GameEntity[], halfW: number, halfH: number): { x: number, y: number } {
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
    return { x: outX, y: outY };
  }

  private wrapToBounds(value: number, limit: number): number {
    let out = value;
    if (out < 0) out += limit;
    else if (out > limit) out -= limit;

    if (out < 0 || out > limit) {
        out = ((out % limit) + limit) % limit;
    }
    return out;
  }

  public setMapType(type: MapType) {
    if (this.mapType === type) return;
    this.mapType = type;
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
    
    const numClusters = 15; 
    const colors = ['rgba(239, 68, 68,', 'rgba(59, 130, 246,', 'rgba(168, 85, 247,', 'rgba(16, 185, 129,', 'rgba(245, 158, 11,', 'rgba(6, 182, 212,'];

    for (let i = 0; i < numClusters; i++) {
        const cx = (Math.random() - 0.5) * width * 4;
        const cy = (Math.random() - 0.5) * height * 4;
        const puffsPerCluster = 1 + Math.floor(Math.random() * 2);
        const clusterColorBase = colors[Math.floor(Math.random() * colors.length)];

        for (let j = 0; j < puffsPerCluster; j++) {
            const size = 80 + Math.random() * 30; 
            const depth = 0.2 + Math.random() * 0.8; 
            const offsetX = (Math.random() - 0.5) * 40; 
            const offsetY = (Math.random() - 0.5) * 30;
            
            this.nebulaPuffs.push({
                x: cx + offsetX,
                y: cy + offsetY,
                size: size,
                depth: depth * 0.5,
                opacity: 0.3,
                color: clusterColorBase, 
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 0.001,
                aspect: 0.8 + Math.random() * 0.4,
                textureIndex: Math.floor(Math.random() * this.puffTextures.length)
            });
        }
    }

    const angle = (Math.random() - 0.5); 
    const mwColors = ['#8b5cf6', '#3b82f6', '#fbbf24', '#f472b6']; 
    for (let i = 0; i < 80; i++) {
        const x = Math.random() * width;
        const y = (height / 2) + Math.tan(angle) * (x - width / 2) + ((Math.random() + Math.random() + Math.random() - 1.5) * 40);
        this.milkyWay.push({
            x: x,
            y: y,
            size: 0.4 + Math.random() * 0.8,
            opacity: 0.2 + Math.random() * 0.25,
            color: Math.random() > 0.8 ? mwColors[Math.floor(Math.random() * mwColors.length)] : '#ffffff'
        });
    }

    const numLayers = 60;
    const starsPerLayer = 200;
    for (let i = 0; i < numLayers; i++) {
        const t = i / numLayers;
        const speed = 0.02 + (t * t) * 2.0;
        const stars: Star[] = [];
        for(let j=0; j<starsPerLayer; j++) {
            const baseSize = 0.3 + Math.random() * 0.3;
            const sizeMod = 0.4 + (t * 0.8);
            stars.push({
                x: Math.random() * width,
                y: Math.random() * height,
                size: baseSize * sizeMod,
                opacity: 0.2 + Math.random() * 0.45,
                color: Math.random() > 0.95 ? COLORS.STAR : '#ffffff'
            });
        }
        this.starLayers.push({ stars, speed });
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
    ctx.fillRect(-width * 50, -height * 50, width * 100, height * 100);

    const hasAttractors = attractors.length > 0;
    
    // RENDER NEBULAE
    this.nebulaPuffs.forEach(puff => {
        puff.x -= dx * puff.depth;
        puff.y -= dy * puff.depth;
        puff.rotation += puff.rotationSpeed;

        const margin = puff.size; 
        const rangeX = width + margin * 2;
        const rangeY = height + margin * 2;
        // Robust modulo-like wrapping for nebulae
        if (puff.x < -margin) puff.x += rangeX; else if (puff.x > width + margin) puff.x -= rangeX;
        if (puff.y < -margin) puff.y += rangeY; else if (puff.y > height + margin) puff.y -= rangeY;

        let drawX = puff.x;
        let drawY = puff.y;

        // INLINED LENSING
        if (hasAttractors) {
           const lensed = this.applyLensing(drawX, drawY, cameraPos, attractors, halfW, halfH);
           drawX = lensed.x;
           drawY = lensed.y;
        }

        const texture = this.puffTextures[puff.textureIndex % this.puffTextures.length];
        ctx.globalAlpha = puff.opacity; 
        ctx.save();
        ctx.translate(drawX, drawY);
        ctx.rotate(puff.rotation);
        ctx.scale(puff.aspect, 1.0); 
        if (texture) ctx.drawImage(texture, -puff.size/2, -puff.size/2, puff.size, puff.size);
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = puff.color + '1)'; 
        ctx.beginPath(); ctx.arc(0, 0, puff.size/2, 0, Math.PI*2); ctx.fill();
        ctx.restore();
    });
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1.0;

    // RENDER STARS
    const renderStarList = (list: Star[], shiftX: number, shiftY: number) => {
        for (let i = 0; i < list.length; i++) {
            const star = list[i];
            star.x -= shiftX;
            star.y -= shiftY;

            star.x = this.wrapToBounds(star.x, width);
            star.y = this.wrapToBounds(star.y, height);

            let wx = star.x;
            let wy = star.y;

            // INLINED LENSING
            if (hasAttractors) {
               const lensed = this.applyLensing(wx, wy, cameraPos, attractors, halfW, halfH);
               wx = lensed.x;
               wy = lensed.y;
            }

            ctx.globalAlpha = star.opacity;
            // No sparkles, just simple shapes for performance and cleaner look
            ctx.fillStyle = star.color;
            if (star.size < 1.5) {
                ctx.fillRect(wx, wy, Math.max(1, star.size), Math.max(1, star.size));
            } else {
                ctx.beginPath(); ctx.arc(wx, wy, star.size, 0, Math.PI * 2); ctx.fill();
            }
        }
    };

    renderStarList(this.milkyWay, dx * 0.03, dy * 0.03);

    for (let i = 0; i < this.starLayers.length; i++) {
        const layer = this.starLayers[i];
        renderStarList(layer.stars, dx * layer.speed * 0.2, dy * layer.speed * 0.2);
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
