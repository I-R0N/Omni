

import { GameEntity, Vector2, MapType, CameraState, EntityType, DamageText, PlayerHUDMessage, WeaponType, LaserBeamState } from '../../types';
import { COLORS, ASSETS, MINIMAP_CONSTANTS, UI_CONSTANTS, CAMERA_CONSTANTS, SPRITE_CONSTANTS, WEAPONS, WEAPON_LIST, AMMO_HUD_CONSTANTS, computeAmmoHUDLayout } from '../../constants';
import { BackgroundManager } from './BackgroundManager';

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

  public setDebugMode(v: boolean) { this.debugMode = v; }
  private images: Map<string, HTMLImageElement> = new Map();
  // Optimization: Reusable buffer for sorting indicators to prevent array allocation
  private _indicatorBuffer: { entity: GameEntity, distSq: number }[] = [];
  // Pre-rendered specular dot bitmap (created once, reused for every glass tile)
  private _specularBitmap: HTMLCanvasElement | null = null;
  private _visibleEntities: GameEntity[] = [];
  private _trailEntities: GameEntity[] = [];
  private _particleBuffer: GameEntity[] = [];
  private _minimapBuffer: { entity: GameEntity, dx: number, dy: number }[] = [];
  private _attractors: GameEntity[] = [];

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

  public render(
    entities: GameEntity[],
    camera: CameraState,
    mapType: MapType,
    minimapExpanded: boolean = false,
    damageTexts?: DamageText[],
    playerPos?: Vector2,
    playerMessages?: PlayerHUDMessage[],
    player?: GameEntity,
    laserBeam?: LaserBeamState
  ) {
    if (!this.ctx) return;
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
        // Allow inactive tiles that are regenerating to pass through for ghost rendering
        if (!entity.active && !(entity.type === EntityType.STRUCTURE && entity.regenProgress !== undefined)) continue;

        const dx = entity.position.x - camX;
        const dy = entity.position.y - camY;

        if (entity.type === EntityType.INTERACTABLE && entity.gravityStrength && entity.gravityStrength > 500) {
            this._attractors.push(entity);
        }

        if (entity.type === EntityType.ENEMY || (entity.type === EntityType.INTERACTABLE && !entity.dropType)) {
            const distSq = dx*dx + dy*dy;
            if (entity.type !== EntityType.ENEMY || distSq <= 500 * 500) {
                this._indicatorBuffer.push({ entity, distSq });
            }
        }

        if (entity.type !== EntityType.PLAYER && entity.type !== EntityType.PROJECTILE && entity.type !== EntityType.PARTICLE
                && !(entity.type === EntityType.INTERACTABLE && entity.dropType && entity.dropType !== 'health')) {
            this._minimapBuffer.push({ entity, dx, dy });
        }

        if (entity.position.x < left || entity.position.x > right ||
            entity.position.y < top || entity.position.y > bottom) {
            continue;
        }

        // Particles go to a separate buffer for single-pass 'lighter' composite rendering
        if (entity.type === EntityType.PARTICLE) {
            this._particleBuffer.push(entity);
        } else {
            this._visibleEntities.push(entity);
        }

        if (entity.trail && entity.trail.length > 1 && (entity.type === EntityType.PLAYER || entity.type === EntityType.PROJECTILE)) {
            this._trailEntities.push(entity);
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
    this.renderTrails(ctx, this._trailEntities);

    // 4. Render Entities (Culling logic added)
    this.renderEntities(ctx, this._visibleEntities, camera, playerPos);

    // 4b. Render Particles — single composite-op switch for the whole batch
    this.renderParticles(ctx, this._particleBuffer);

    // 4c. Render laser beam (world space, additive)
    if (laserBeam?.active) {
        this.renderLaserBeam(ctx, laserBeam);
    }

    // 5. Render Damage Text (World Space)
    if (damageTexts) {
        this.renderDamageTexts(ctx, damageTexts);
    }

    ctx.restore();

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
  }

  private renderTrails(ctx: CanvasRenderingContext2D, entities: GameEntity[]) {
      entities.forEach(entity => {
          if (!entity.active || !entity.trail || entity.trail.length < 2) return;
          if (entity.type !== EntityType.PLAYER && entity.type !== EntityType.PROJECTILE) return;

          const t = entity.trail;
          
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
                  const dx = t[i+1].x - p.x;
                  const dy = t[i+1].y - p.y;
                  const len = Math.sqrt(dx*dx + dy*dy) || 1;
                  nx = -dy / len;
                  ny = dx / len;
              } else if (i > 0) {
                  const dx = p.x - t[i-1].x;
                  const dy = p.y - t[i-1].y;
                  const len = Math.sqrt(dx*dx + dy*dy) || 1;
                  nx = -dy / len;
                  ny = dx / len;
              }

              ctx.lineTo(p.x + nx * width, p.y + ny * width);
          }
          
          // Backward pass: Left side of trail
          for (let i = t.length - 1; i >= 0; i--) {
              const p = t[i];
              const ratio = p.lifetime / p.maxLifetime;
              if (ratio <= 0) continue;
              const width = (p.scale ?? 1) * (1 + (ratio * 5)) / 2;

              let nx = 0, ny = 0;
              if (i < t.length - 1) {
                  const dx = t[i+1].x - p.x;
                  const dy = t[i+1].y - p.y;
                  const len = Math.sqrt(dx*dx + dy*dy) || 1;
                  nx = -dy / len;
                  ny = dx / len;
              } else if (i > 0) {
                  const dx = p.x - t[i-1].x;
                  const dy = p.y - t[i-1].y;
                  const len = Math.sqrt(dx*dx + dy*dy) || 1;
                  nx = -dy / len;
                  ny = dx / len;
              }
              
              ctx.lineTo(p.x - nx * width, p.y - ny * width);
          }

          ctx.closePath();
          
          // Create gradient for fade effect
          if (t.length > 0) {
              const head = t[t.length-1];
              const tail = t[0];
              const grad = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
              if (entity.type === EntityType.PROJECTILE) {
                  // Use weapon color for projectile trails
                  const [r, g, b] = hexToRgb(entity.color || '#facc15');
                  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
                  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.75)`);
              } else {
                  // Player: cyan engine exhaust
                  grad.addColorStop(0, `rgba(56, 189, 248, 0)`);
                  grad.addColorStop(1, `rgba(56, 189, 248, 0.6)`);
              }
              ctx.fillStyle = grad;
              ctx.fill();
          }
      });
  }

  private renderParticles(ctx: CanvasRenderingContext2D, particles: GameEntity[]) {
      if (particles.length === 0) return;
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < particles.length; i++) {
          const p = particles[i];

          // Lightning arc particles use a dedicated renderer
          if (p.isLightningArc) {
              this.renderLightningArc(ctx, p);
              continue;
          }

          const lifeRatio = (p.lifetime || 0) / (p.maxLifetime || 1);
          ctx.globalAlpha = lifeRatio;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.position.x, p.position.y, p.size.x, 0, Math.PI * 2);
          ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
  }

  // ── Laser beam rendering ──────────────────────────────────────────────────

  private renderLaserBeam(ctx: CanvasRenderingContext2D, beam: LaserBeamState) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      const { origin, end, hitPoint } = beam;

      // Outer green glow (~6px)
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.4)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      // Inner white core (~2px)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      // Muzzle flash at origin
      const muzzleGrad = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, 12);
      muzzleGrad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
      muzzleGrad.addColorStop(0.4, 'rgba(74, 222, 128, 0.6)');
      muzzleGrad.addColorStop(1, 'rgba(74, 222, 128, 0)');
      ctx.fillStyle = muzzleGrad;
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, 12, 0, Math.PI * 2);
      ctx.fill();

      // Hit point bloom
      if (hitPoint) {
          const bloomGrad = ctx.createRadialGradient(hitPoint.x, hitPoint.y, 0, hitPoint.x, hitPoint.y, 18);
          bloomGrad.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
          bloomGrad.addColorStop(0.3, 'rgba(74, 222, 128, 0.5)');
          bloomGrad.addColorStop(1, 'rgba(74, 222, 128, 0)');
          ctx.fillStyle = bloomGrad;
          ctx.beginPath();
          ctx.arc(hitPoint.x, hitPoint.y, 18, 0, Math.PI * 2);
          ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
  }

  // ── Lightning arc rendering ─────────────────────────────────────────────

  private renderLightningArc(ctx: CanvasRenderingContext2D, particle: GameEntity) {
      const points = particle.arcPoints;
      if (!points || points.length < 2) return;

      const lifeRatio = (particle.lifetime || 0) / (particle.maxLifetime || 1);
      const alpha = lifeRatio; // fade over lifetime

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // Draw jagged arc between each pair of chain points
      for (let seg = 0; seg < points.length - 1; seg++) {
          const a = points[seg];
          const b = points[seg + 1];

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

          // Draw outer glow
          ctx.globalAlpha = alpha * 0.5;
          ctx.strokeStyle = 'rgba(34, 211, 238, 0.6)';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(zigzag[0].x, zigzag[0].y);
          for (let i = 1; i < zigzag.length; i++) {
              ctx.lineTo(zigzag[i].x, zigzag[i].y);
          }
          ctx.stroke();

          // Draw bright core
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
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
          const p = points[i];
          ctx.globalAlpha = alpha * 0.7;
          const nodeGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14);
          nodeGrad.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
          nodeGrad.addColorStop(0.35, 'rgba(34, 211, 238, 0.5)');
          nodeGrad.addColorStop(1, 'rgba(34, 211, 238, 0)');
          ctx.fillStyle = nodeGrad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
          ctx.fill();
      }

      ctx.globalAlpha = 1.0;
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
  }

  private renderEntities(
      ctx: CanvasRenderingContext2D,
      entities: GameEntity[],
      camera: CameraState,
      playerPos?: Vector2
    ) {
    // Computed once per frame and reused by all entity rendering below.
    const nowSec = Date.now() / 1000;

    entities.forEach(entity => {
      // Allow inactive STRUCTURE tiles that are regenerating through for ghost outline rendering
      const isRegenGhost = !entity.active && entity.type === EntityType.STRUCTURE && entity.regenProgress !== undefined;
      if (!entity.active && !isRegenGhost) return;
      if (!Number.isFinite(entity.position.x) || !Number.isFinite(entity.position.y)) return;

      // Particles are handled separately in renderParticles() — skip here
      if (entity.type === EntityType.PARTICLE) return;

      ctx.save();
      
      // Transform logic
      ctx.translate(entity.position.x, entity.position.y);
      const rotation = entity.rotation + (
        entity.type === EntityType.PLAYER
          ? SPRITE_CONSTANTS.PLAYER_ROTATION_OFFSET
          : entity.type === EntityType.ENEMY
            ? SPRITE_CONSTANTS.ENEMY_ROTATION_OFFSET
            : 0
      );
      ctx.rotate(rotation);
      
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

                // Proximity tint: edge shifts from cool blue-white → bright cyan
                const PROX_RANGE = 120;
                const pdx = playerPos ? entity.position.x - playerPos.x : Infinity;
                const pdy = playerPos ? entity.position.y - playerPos.y : Infinity;
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
                // Pulsing animation: fast oscillation tied to position for variety
                const pulse = 0.88 + Math.sin(nowSec * 14 + r * 1.3) * 0.12;
                const glowR = r * pulse * 3.0;

                // Fade out in the last 20% of lifetime
                const lifetimeFrac = (entity.lifetime !== undefined && entity.maxLifetime !== undefined && entity.maxLifetime > 0)
                    ? Math.min(1, entity.lifetime / (entity.maxLifetime * 0.2))
                    : 1;

                const isEnemy = entity.ownerType === EntityType.ENEMY;
                const [cr, cg, cb] = hexToRgb(entity.color || '#facc15');

                ctx.save();
                ctx.globalAlpha = Math.min(1, lifetimeFrac);

                // Single merged gradient: hot white core → weapon colour → transparent glow.
                // One gradient object + one draw call instead of two.
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

                // Proximity tint — same formula as full tile
                const PROX_RANGE = 120;
                const pdx = playerPos ? entity.position.x - playerPos.x : Infinity;
                const pdy = playerPos ? entity.position.y - playerPos.y : Infinity;
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

      ctx.restore();

      // Render Debug Acceleration Vector (debug mode only)
      if (this.debugMode && entity.type === EntityType.PLAYER && entity.inputVector) {
          const iv = entity.inputVector;
          const mag = Math.sqrt(iv.x*iv.x + iv.y*iv.y);
          if (mag > 0.05) { 
              ctx.save();
              ctx.translate(entity.position.x, entity.position.y);
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
      this.renderHealthBar(ctx, entity);
    });
  }

  private renderHealthBar(ctx: CanvasRenderingContext2D, entity: GameEntity) {
      // Only render for Player and Enemies
      if ((entity.type !== EntityType.PLAYER && entity.type !== EntityType.ENEMY) || entity.maxHealth <= 0) return;

      const { PLAYER_WIDTH, PLAYER_HEIGHT, ENEMY_WIDTH, ENEMY_HEIGHT, OFFSET_MODIFIER, OFFSET_BASE } = UI_CONSTANTS.HEALTH_BAR;

      const isPlayer = entity.type === EntityType.PLAYER;
      
      const width = isPlayer ? PLAYER_WIDTH : ENEMY_WIDTH;
      const height = isPlayer ? PLAYER_HEIGHT : ENEMY_HEIGHT;
      
      // Calculate offset based on visual size approx
      const visualRadius = Math.max(entity.size.x, entity.size.y) * OFFSET_MODIFIER; 
      const yOffset = visualRadius + OFFSET_BASE;

      const x = entity.position.x - width / 2;
      const y = entity.position.y + yOffset;
      
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
  }

  private renderDamageTexts(ctx: CanvasRenderingContext2D, texts: DamageText[]) {
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      
      texts.forEach(t => {
          ctx.save();
          // REMOVED INTEGER OPTIMIZATION
          ctx.translate(t.position.x, t.position.y);
          
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

          const dx = t.position.x - playerPos.x;
          const dy = t.position.y - playerPos.y;
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

      // Small map uses a zoomed-in range; expanded map shows the full overview range
      const range = expanded ? RANGE : ZOOM_RANGE;
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

      items.forEach(item => {
          const entity = item.entity;
          if (!entity.active) return;

          const dotX = centerX + item.dx * scale;
          const dotY = centerY + item.dy * scale;

          if (dotX < mapX || dotX > mapX + currentSize || dotY < mapY || dotY > mapY + currentSize) return;

          ctx.fillStyle = entity.color;

          if (entity.type === EntityType.STRUCTURE) {
              // OPTIMIZATION: Use fillRect for structures (faster than arc)
              ctx.fillRect(dotX, dotY, 2, 2);
          } else {
              let dotRadius = 1.5;
              if (entity.type === EntityType.INTERACTABLE) dotRadius = 3;
              if (entity.type === EntityType.ENEMY) dotRadius = 2;

              ctx.beginPath();
              ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
              ctx.fill();
          }
      });

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
}
