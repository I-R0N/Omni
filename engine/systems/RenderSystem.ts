

import { GameEntity, Vector2, MapType, CameraState, EntityType, DamageText } from '../../types';
import { COLORS, ASSETS, MINIMAP_CONSTANTS, UI_CONSTANTS, CAMERA_CONSTANTS, SPRITE_CONSTANTS } from '../../constants';
import { BackgroundManager } from './BackgroundManager';

export class RenderSystem {
  private ctx: CanvasRenderingContext2D | null = null;
  private backgroundManager: BackgroundManager;
  private images: Map<string, HTMLImageElement> = new Map();
  // Optimization: Reusable buffer for sorting indicators to prevent array allocation
  private _indicatorBuffer: { entity: GameEntity, distSq: number }[] = [];
  private _visibleEntities: GameEntity[] = [];
  private _trailEntities: GameEntity[] = [];
  private _minimapBuffer: { entity: GameEntity, dx: number, dy: number }[] = [];
  private _attractors: GameEntity[] = [];

  constructor() {
    this.backgroundManager = new BackgroundManager();
    // Preload basic assets
    Object.values(ASSETS).forEach(src => this.getImage(src));
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
    damageTexts?: DamageText[]
  ) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;

    // Guard against 0 dimensions
    if (width === 0 || height === 0) return;

    // Build per-frame buckets in a single pass
    this._attractors.length = 0;
    this._visibleEntities.length = 0;
    this._trailEntities.length = 0;
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
        if (!entity.active) continue;

        const dx = entity.position.x - camX;
        const dy = entity.position.y - camY;

        if (entity.type === EntityType.INTERACTABLE && entity.gravityStrength && entity.gravityStrength > 500) {
            this._attractors.push(entity);
        }

        if (entity.type === EntityType.ENEMY || entity.type === EntityType.INTERACTABLE) {
            this._indicatorBuffer.push({ entity, distSq: dx*dx + dy*dy });
        }

        if (entity.type !== EntityType.PLAYER && entity.type !== EntityType.PROJECTILE && entity.type !== EntityType.PARTICLE) {
            this._minimapBuffer.push({ entity, dx, dy });
        }

        if (entity.position.x < left || entity.position.x > right ||
            entity.position.y < top || entity.position.y > bottom) {
            continue;
        }

        this._visibleEntities.push(entity);

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
    this.renderEntities(ctx, this._visibleEntities, camera);
    
    // 5. Render Damage Text (World Space)
    if (damageTexts) {
        this.renderDamageTexts(ctx, damageTexts);
    }

    ctx.restore();

    // 6. Render POI Indicators (Screen Space)
    this.renderIndicators(ctx, this._indicatorBuffer, camera, width, height);

    // 7. Render Minimap (Screen Space)
    this.renderMinimap(ctx, this._minimapBuffer, camera, width, height, minimapExpanded, mapType);
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
              const width = (1 + (ratio * 5)) / 2; // Half width
              
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
              const width = (1 + (ratio * 5)) / 2; 

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
              grad.addColorStop(0, `rgba(56, 189, 248, 0)`);
              grad.addColorStop(1, `rgba(56, 189, 248, 0.6)`);
              ctx.fillStyle = grad;
              ctx.fill();
          }
      });
  }

  private renderEntities(
      ctx: CanvasRenderingContext2D, 
      entities: GameEntity[], 
      camera: CameraState
    ) {
    entities.forEach(entity => {
      if (!entity.active) return;
      if (!Number.isFinite(entity.position.x) || !Number.isFinite(entity.position.y)) return;

      // --- PARTICLE RENDERING ---
      if (entity.type === EntityType.PARTICLE) {
          ctx.save();
          // Glow effect for particles
          ctx.globalCompositeOperation = 'lighter';
          const lifeRatio = (entity.lifetime || 0) / (entity.maxLifetime || 1);
          ctx.globalAlpha = lifeRatio;
          ctx.fillStyle = entity.color;
          ctx.beginPath();
          ctx.arc(entity.position.x, entity.position.y, entity.size.x, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          return;
      }

      ctx.save();
      
      // Transform logic
      ctx.translate(entity.position.x, entity.position.y);
      const rotation = entity.rotation + (entity.type === EntityType.PLAYER ? SPRITE_CONSTANTS.PLAYER_ROTATION_OFFSET : 0);
      ctx.rotate(rotation);
      
      // Prevent player from scaling with camera zoom (Warp Effect)
      // BUT scale inversely so it stays same screen size during zoom
      if (entity.type === EntityType.PLAYER && camera.zoom !== 1) {
          const invScale = 1 / camera.zoom;
          ctx.scale(invScale, invScale);
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
            if (entity.hitFlash && entity.hitFlash > 0) {
                ctx.fillStyle = '#ffffff';
            } else {
                ctx.fillStyle = entity.color;
            }

            ctx.beginPath();
            if (entity.polygonPoints && entity.polygonPoints.length > 0) {
                const p0 = entity.polygonPoints[0];
                if (Number.isFinite(p0.x) && Number.isFinite(p0.y)) {
                    ctx.moveTo(p0.x, p0.y);
                    for (let i = 1; i < entity.polygonPoints.length; i++) {
                        const p = entity.polygonPoints[i];
                        if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
                            ctx.lineTo(p.x, p.y);
                        }
                    }
                }
            } else {
                const r = entity.size.x / 2;
                if (Number.isFinite(r) && r > 0) {
                    ctx.arc(0, 0, r, 0, Math.PI * 2);
                }
            }
            ctx.closePath();
            ctx.fill();
            
            if (entity.type === EntityType.ASTEROID) {
                this.renderCracks(ctx, entity, entity.size.x/2);
            }

            if (entity.type === EntityType.STRUCTURE) {
                 ctx.strokeStyle = '#818cf8';
                 ctx.lineWidth = 2;
                 ctx.stroke();
                 ctx.fillStyle = 'rgba(255,255,255,0.1)';
                 ctx.fill();
            } else {
                 ctx.strokeStyle = 'rgba(0,0,0,0.3)';
                 ctx.lineWidth = 2;
                 ctx.stroke();
            }

          } else if (entity.type === EntityType.PROJECTILE) {
             ctx.fillStyle = entity.color;
             // Removed expensive shadowBlur for performance
             
             if (Number.isFinite(entity.size.x) && Number.isFinite(entity.size.y)) {
                ctx.fillRect(
                    -entity.size.x / 2, 
                    -entity.size.y / 2, 
                    entity.size.x, 
                    entity.size.y
                );
             }
          } else {
            ctx.fillStyle = entity.color;
            
            if (entity.type === EntityType.INTERACTABLE) {
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

      // Render Debug Acceleration Vector
      if (entity.type === EntityType.PLAYER && entity.inputVector) {
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

      // Fill Color
      if (isPlayer) {
          if (healthPct > 0.6) ctx.fillStyle = '#4ade80'; // Green
          else if (healthPct > 0.3) ctx.fillStyle = '#facc15'; // Yellow
          else ctx.fillStyle = '#f87171'; // Red
      } else {
          ctx.fillStyle = '#ef4444'; // Red
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

          const ix = cx + Math.cos(angle) * RADIUS;
          const iy = cy + Math.sin(angle) * RADIUS;

          ctx.save();
          ctx.translate(ix, iy);
          ctx.rotate(angle);

          ctx.fillStyle = t.color;
          ctx.beginPath();
          
          if (t.type === EntityType.ENEMY) {
              // Simple line marker for enemies
              ctx.rect(-10, -2, 20, 4); 
          } else {
              // Standard pointer for POIs
              ctx.moveTo(12, 0); 
              ctx.lineTo(-8, 8); 
              ctx.lineTo(-2, 0); 
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

  private renderMinimap(
      ctx: CanvasRenderingContext2D,
      items: { entity: GameEntity, dx: number, dy: number }[],
      camera: CameraState,
      screenWidth: number,
      screenHeight: number,
      expanded: boolean,
      mapType: MapType
  ) {
      const { SIZE, EXPANDED_SIZE, MARGIN, BG_COLOR, BORDER_COLOR, PLAYER_DOT_COLOR } = MINIMAP_CONSTANTS;
      
      // Adjust Range based on Map Type for better usability
      let range = MINIMAP_CONSTANTS.RANGE;
      if (mapType === MapType.SOLAR_SYSTEM) range = 12000;
      else if (mapType === MapType.LOCAL) range = 4000;
      else if (mapType === MapType.SUB_MAP) range = 2000;
      else range = 25000; // Universe

      const currentSize = expanded ? EXPANDED_SIZE : SIZE;

      const mapX = MARGIN;
      const mapY = screenHeight - currentSize - MARGIN;

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

      ctx.fillStyle = PLAYER_DOT_COLOR;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 2, 0, Math.PI * 2);
      ctx.fill();

      items.forEach(item => {
          const entity = item.entity;
          if (!entity.active) return;
          
          const scale = (currentSize / 2) / range;
          
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

      ctx.restore();
  }
}
