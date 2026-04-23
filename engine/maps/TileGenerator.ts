
import { GameEntity, EntityType, NebulaColorStop, Vector2 } from '../../types';
import { STRUCTURE_VARIANTS, StructureVariant, ASSETS, NEBULA_CONSTANTS } from '../../constants';
import { NEBULA_IMAGES } from '../../assets';
import { randomNebulaComposition, cloneComposition } from '../NebulaColor';
import { nextId } from '../systems/IdAllocator';

// Hex-grid geometric constants for the standard pointy-topped layout used
// across the map.  Exposed so other systems (nebula coalescence, spawn
// validation) can share the same pixel↔grid math.
export const HEX_SIZE = 22;
export const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE;
export const HEX_HEIGHT = 2 * HEX_SIZE;
export const HEX_V_SPACING = HEX_HEIGHT * 0.75;

// Regular hexagon area (side length = HEX_SIZE).  Used by nebula shard/merge
// math to keep area conservation exact through shatter → reassembly cycles.
export const HEX_AREA = (3 * Math.sqrt(3) / 2) * HEX_SIZE * HEX_SIZE;

/**
 * Convert a pixel position to the nearest odd-r offset grid cell.
 * Approximate (uses simple rounding rather than fractional-axial rounding);
 * good enough for snapping nebula shards back to an adjacent cell.
 */
export function pixelToHexCoord(px: number, py: number): { c: number; r: number } {
    const r = Math.round(py / HEX_V_SPACING);
    const offset = (r % 2 !== 0) ? (HEX_WIDTH / 2) : 0;
    const c = Math.round((px - offset) / HEX_WIDTH);
    return { c, r };
}

/**
 * Convert an odd-r offset grid cell to its pixel centre.
 */
export function hexCoordToPixel(c: number, r: number): { x: number; y: number } {
    const offset = (r % 2 !== 0) ? (HEX_WIDTH / 2) : 0;
    return { x: c * HEX_WIDTH + offset, y: r * HEX_V_SPACING };
}

export class TileGenerator {
  /**
   * Generates discrete clusters of hexagonal tiles spread across the map.
   * Ensures all tiles align to the same global grid.
   *
   * @param occupiedCoords  Optional shared "col,row" set.  When supplied, the
   *   generator skips any cell already in it and adds every new tile it
   *   creates.  Passing the same set to sequential calls (glass first, then
   *   nebula) guarantees non-overlapping placement on the shared grid.
   */
  public static generateClusteredMesh(
    mapWidth: number,
    mapHeight: number,
    hexSize: number,
    clusterCount: number,
    minClusterSize: number,
    maxClusterSize: number,
    occupiedCoords?: Set<string>,
    variant: StructureVariant = 'glass'
  ): GameEntity[] {
    const entities: GameEntity[] = [];
    const usedCoords = occupiedCoords ?? new Set<string>();

    // Hexagon geometric constants (Pointy topped)
    const w = Math.sqrt(3) * hexSize;
    const h = 2 * hexSize;
    const hDist = w;
    const vDist = 0.75 * h;

    const maxCol = Math.ceil((mapWidth / 2) / hDist);
    const maxRow = Math.ceil((mapHeight / 2) / vDist);

    for (let i = 0; i < clusterCount; i++) {
      let startCol = Math.floor((Math.random() * 2 - 1) * maxCol);
      let startRow = Math.floor((Math.random() * 2 - 1) * maxRow);

      const targetSize = Math.floor(minClusterSize + Math.random() * (maxClusterSize - minClusterSize));

      const openSet: { c: number, r: number }[] = [{ c: startCol, r: startRow }];
      let createdInCluster = 0;

      while (openSet.length > 0 && createdInCluster < targetSize) {
        const idx = Math.floor(Math.random() * openSet.length);
        const current = openSet[idx];
        openSet.splice(idx, 1);

        const key = `${current.c},${current.r}`;
        if (usedCoords.has(key)) continue;

        usedCoords.add(key);
        createdInCluster++;

        this.createHexEntity(entities, current.c, current.r, hexSize, w, h, variant);

        const neighbors = this.getNeighbors(current.c, current.r);
        for (const n of neighbors) {
          const nKey = `${n.c},${n.r}`;
          if (!usedCoords.has(nKey)) {
             if (Math.random() > 0.1) {
                 openSet.push(n);
             }
          }
        }
      }
    }

    return entities;
  }

  /**
   * Generate nebula-tile clusters sharing the same hex grid as glass tiles.
   * Pass the same occupiedCoords set that was used for the glass pass so
   * nebula cells never overlap with glass cells.
   *
   * Nebula tiles are pass-through (no collision impulse) and shatter into
   * NEBULA_SHARDs on player/enemy contact.  Each cluster shares a single
   * random-hue composition so adjacent tiles blend visually.
   *
   * Optionally records each cluster's world-space start position into
   * `recordedCenters` — used by the background-nebula layer to render
   * puffs at the same positions as the tile clusters (single unified
   * cloud instead of two independently-random layers).
   */
  public static generateNebulaClusters(
    mapWidth: number,
    mapHeight: number,
    hexSize: number,
    clusterCount: number,
    minClusterSize: number,
    maxClusterSize: number,
    occupiedCoords: Set<string>,
    recordedCenters?: Vector2[]
  ): GameEntity[] {
    const entities: GameEntity[] = [];

    const w = Math.sqrt(3) * hexSize;
    const h = 2 * hexSize;
    const hDist = w;
    const vDist = 0.75 * h;

    const maxCol = Math.ceil((mapWidth / 2) / hDist);
    const maxRow = Math.ceil((mapHeight / 2) / vDist);

    // Regular hex area (matches HEX_AREA constant when hexSize === HEX_SIZE).
    const tileArea = (3 * Math.sqrt(3) / 2) * hexSize * hexSize;

    for (let i = 0; i < clusterCount; i++) {
      // Each cluster gets its own random-hue palette entry so adjacent
      // tiles read as a single continuous cloud of one colour.
      const composition: NebulaColorStop[] = randomNebulaComposition();

      let startCol = Math.floor((Math.random() * 2 - 1) * maxCol);
      let startRow = Math.floor((Math.random() * 2 - 1) * maxRow);

      // Record this cluster's world-space start position for the
      // background-nebula layer to consume as a puff seed.
      if (recordedCenters) {
          const rowOffset = (startRow % 2 !== 0) ? (w / 2) : 0;
          recordedCenters.push({
              x: startCol * w + rowOffset,
              y: startRow * (h * 0.75),
          });
      }

      const targetSize = Math.floor(minClusterSize + Math.random() * (maxClusterSize - minClusterSize));
      const openSet: { c: number, r: number }[] = [{ c: startCol, r: startRow }];
      let createdInCluster = 0;

      while (openSet.length > 0 && createdInCluster < targetSize) {
        const idx = Math.floor(Math.random() * openSet.length);
        const current = openSet[idx];
        openSet.splice(idx, 1);

        const key = `${current.c},${current.r}`;
        if (occupiedCoords.has(key)) continue;

        occupiedCoords.add(key);
        createdInCluster++;

        this.createNebulaEntity(entities, current.c, current.r, hexSize, w, h, cloneComposition(composition), tileArea);

        const neighbors = this.getNeighbors(current.c, current.r);
        for (const n of neighbors) {
          const nKey = `${n.c},${n.r}`;
          if (!occupiedCoords.has(nKey)) {
             if (Math.random() > 0.1) {
                 openSet.push(n);
             }
          }
        }
      }
    }

    return entities;
  }

  private static createHexEntity(
      entities: GameEntity[],
      c: number,
      r: number,
      size: number,
      w: number,
      h: number,
      variant: StructureVariant = 'glass'
    ) {
    // Odd-r offset coordinate to pixel conversion
    // x = size * sqrt(3) * (col + 0.5 * (row & 1))
    // y = size * 3/2 * row
    const offset = (r % 2 !== 0) ? (w / 2) : 0;
    const cx = (c * w) + offset;
    const cy = r * (h * 0.75);

    // Hexagon Vertices
    const pts = [
        { x: 0, y: -h/2 },
        { x: w/2, y: -h/4 },
        { x: w/2, y: h/4 },
        { x: 0, y: h/2 },
        { x: -w/2, y: h/4 },
        { x: -w/2, y: -h/4 }
    ];

    entities.push(TileGenerator.buildStructureTile(c, r, cx, cy, w, h, pts, variant));
  }

  /**
   * Build a STRUCTURE tile populated per variant config — shared by the
   * cluster generator and by MapClasses' ring emitter so both paths agree
   * on the health/sprite/colour wiring per variant.
   */
  public static buildStructureTile(
      c: number,
      r: number,
      cx: number,
      cy: number,
      w: number,
      h: number,
      pts: Vector2[],
      variant: StructureVariant
  ): GameEntity {
    const cfg = STRUCTURE_VARIANTS[variant];
    return {
        id: nextId(`tile_${r}_${c}`),
        type: EntityType.STRUCTURE,
        position: { x: cx, y: cy },
        velocity: { x: 0, y: 0 },
        size: { x: w * 0.95, y: h * 0.95 }, // Slight gap
        rotation: 0,
        color: Math.random() > 0.8 ? cfg.borderColor : cfg.color,
        active: true,
        health: cfg.health,
        maxHealth: cfg.health,
        mass: cfg.mass,
        polygonPoints: pts,
        sprite: cfg.sprite,
        structureVariant: variant,
    };
  }

  private static createNebulaEntity(
      entities: GameEntity[],
      c: number,
      r: number,
      size: number,
      w: number,
      h: number,
      composition: NebulaColorStop[],
      tileArea: number
    ) {
    entities.push(TileGenerator.createNebulaTileEntity(c, r, composition, tileArea));
  }

  /**
   * Public factory for a single nebula tile at the given grid cell.  Used
   * both by the cluster generator at map-init time and by the shard
   * transmutation path (when accumulated shard mass is large enough to
   * spawn a brand-new tile at the shard's nearest clear grid cell).
   *
   * Hex dimensions are derived from the shared HEX_SIZE constant, so the
   * resulting tile snaps to the same grid as every other tile on the map.
   */
  public static createNebulaTileEntity(
      c: number,
      r: number,
      composition: NebulaColorStop[],
      tileArea: number = HEX_AREA
  ): GameEntity {
    const hexSize = HEX_SIZE;
    const w = Math.sqrt(3) * hexSize;
    const h = 2 * hexSize;

    const offset = (r % 2 !== 0) ? (w / 2) : 0;
    const cx = (c * w) + offset;
    const cy = r * (h * 0.75);

    // Same hex vertices as a glass tile — the interactable shape is a
    // standard hex so collision detection is symmetric with the grid.
    const pts = [
        { x: 0, y: -h/2 },
        { x: w/2, y: -h/4 },
        { x: w/2, y: h/4 },
        { x: 0, y: h/2 },
        { x: -w/2, y: h/4 },
        { x: -w/2, y: -h/4 }
    ];

    // Pick a random nebula sprite from the existing background-nebula asset
    // set so they match the existing art style.  Fallback is the procedural
    // puff marker used elsewhere in the codebase.
    const sprite = NEBULA_IMAGES.length > 0
        ? NEBULA_IMAGES[Math.floor(Math.random() * NEBULA_IMAGES.length)]
        : ASSETS.NEBULA_PUFF;

    return {
        id: nextId(`nebula_${r}_${c}`),
        type: EntityType.NEBULA,
        position: { x: cx, y: cy },
        velocity: { x: 0, y: 0 },
        size: { x: w * 0.95, y: h * 0.95 },
        // Rotation: 0 so every tile's hex polygon aligns to the shared grid
        // orientation — adjacent tiles share edges exactly, producing a
        // continuous connected cloud instead of a scattered look.  Visual
        // variety comes from the 9 nebula sprites + per-cluster random hue.
        rotation: 0,
        color: composition[0].hex, // legacy single-colour field, kept in sync
        active: true,
        health: 1,
        maxHealth: 1,
        mass: Infinity, // static — integrated into staticGrid like glass tiles
        polygonPoints: pts,
        sprite,
        nebulaColorComposition: composition,
        nebulaTileArea: tileArea,
        nebulaGridCol: c,
        nebulaGridRow: r,
        // Fade-in on birth — all newly-created tiles (including map-init
        // clusters) slowly materialize rather than popping in instantly.
        // Factory-built tiles use the base duration (no collision context
        // → nothing to scale against).  Runtime tiles from collision
        // events override both fields with a faster-scaled duration.
        nebulaSpawnTimer:    NEBULA_CONSTANTS.FADE_IN_DURATION,
        nebulaSpawnDuration: NEBULA_CONSTANTS.FADE_IN_DURATION,
    };
  }

  /**
   * Generate loose, free-floating nebula shards instead of tiles.
   *
   * Shards spawn in clusters of random positions (no hex grid alignment)
   * so the distribution visually mirrors the tile-cluster layout while
   * producing many more fragments.  Each shard carries the same random
   * per-cluster composition and is a dynamic entity (mass scales with
   * radius) — the gravity/merge pass picks them up immediately.
   *
   * Each shard's `nebulaTileArea` is drawn from a mild power-law so the
   * starting population includes both small and chunky fragments.
   * Shards do NOT align to the hex grid and do NOT go through the
   * static collision grid.
   *
   * Records the world-space centre of every cluster into the optional
   * `recordedCenters` slot so the background-nebula puff layer can
   * render in-sync with the interactable shard clusters.
   */
  public static generateFloatingNebulaShards(
    mapWidth: number,
    mapHeight: number,
    clusterCount: number,
    shardsPerCluster: number,
    clusterRadius: number,
    recordedCenters?: Vector2[],
  ): GameEntity[] {
    const entities: GameEntity[] = [];

    for (let i = 0; i < clusterCount; i++) {
      const composition = randomNebulaComposition();
      const cx = (Math.random() - 0.5) * mapWidth;
      const cy = (Math.random() - 0.5) * mapHeight;

      if (recordedCenters) recordedCenters.push({ x: cx, y: cy });

      for (let j = 0; j < shardsPerCluster; j++) {
        // Uniform sample over a disc of radius `clusterRadius`.
        const r = Math.sqrt(Math.random()) * clusterRadius;
        const t = Math.random() * Math.PI * 2;
        const sx = cx + Math.cos(t) * r;
        const sy = cy + Math.sin(t) * r;

        // Effective tile area per shard — power-law so a minority of
        // shards start chunky and most start small.  Divided by a
        // starting-population factor so the initial mass budget sits
        // at roughly one tile's worth per ~3 shards (matches the
        // classic 3-way tile shatter ratio).
        const raw = Math.pow(Math.random(), 2); // 0..1, biased low
        const area = (0.4 + raw * 1.6) * (HEX_AREA / 3);

        entities.push(TileGenerator.createNebulaShardEntity({ x: sx, y: sy }, area, cloneComposition(composition)));
      }
    }

    return entities;
  }

  /**
   * Factory for a single free-floating nebula shard — the dynamic
   * counterpart to `createNebulaTileEntity`.  Carries the full merge /
   * break / fade state that NebulaSystem expects.  Shared by the
   * floating-shard map seeder and by `NebulaSystem.spawnShards` when
   * breaking an existing shard into smaller children.
   */
  public static createNebulaShardEntity(
      position: Vector2,
      effectiveArea: number,
      composition: NebulaColorStop[],
      velocity: Vector2 = { x: 0, y: 0 },
      rotationSpeed: number = 0,
  ): GameEntity {
    // Polygon radius: derived from a fraction of the effective area so
    // visual size tracks mass.  Matches the convention used elsewhere
    // for nebula shards (glass-tile sized at HEX_AREA scale).
    const GLASS_TILE_HALF = 11;
    const areaBudget = GLASS_TILE_HALF * GLASS_TILE_HALF * (effectiveArea / HEX_AREA);
    const radius = Math.max(2, Math.sqrt(areaBudget));

    const numPoints = 4 + Math.floor(Math.random() * 3);
    const rawPts: { angle: number; r: number }[] = [];
    for (let j = 0; j < numPoints; j++) {
        const baseAngle = (j / numPoints) * Math.PI * 2;
        const jitter    = (Math.random() - 0.5) * (Math.PI / numPoints) * 0.25;
        rawPts.push({ angle: baseAngle + jitter, r: radius * (0.6 + Math.random() * 0.55) });
    }
    rawPts.sort((a, b) => a.angle - b.angle);
    const pts: Vector2[] = rawPts.map(p => ({
        x: Math.cos(p.angle) * p.r,
        y: Math.sin(p.angle) * p.r,
    }));

    const size = radius * 4;
    const sprite = NEBULA_IMAGES.length > 0
        ? NEBULA_IMAGES[Math.floor(Math.random() * NEBULA_IMAGES.length)]
        : ASSETS.NEBULA_PUFF;

    return {
        id:              nextId('nebula_shard'),
        type:            EntityType.NEBULA_SHARD,
        shardType:      'nebula',
        position:       { x: position.x, y: position.y },
        velocity:       { x: velocity.x, y: velocity.y },
        size:           { x: size, y: size },
        rotation:        Math.random() * Math.PI * 2,
        rotationSpeed,
        color:           composition[0].hex,
        active:          true,
        health:          1,
        maxHealth:       1,
        mass:            size,
        polygonPoints:   pts,
        sprite,
        nebulaColorComposition: composition,
        nebulaTileArea:  effectiveArea,
        linearDamping:   NEBULA_CONSTANTS.LINEAR_DAMPING,
        angularDamping:  NEBULA_CONSTANTS.ANGULAR_DAMPING,
        // Freshly-seeded shards start at full opacity — no birth fade —
        // and are eligible for merging immediately.  Seeded shards have
        // zero launch velocity so the merge cooldown isn't needed.
    };
  }

  /**
   * Public wrapper for the internal odd-r offset neighbour lookup.
   * Used by the shard transmutation code to check adjacent grid cells
   * when the shard's own cell is already occupied.
   */
  public static getHexNeighbors(col: number, row: number): { c: number, r: number }[] {
    return this.getNeighbors(col, row);
  }

  private static getNeighbors(col: number, row: number): { c: number, r: number }[] {
    // Directions for Odd-r layout
    // Even rows
    const evenDirs = [
        { c: 1, r: 0 }, { c: 0, r: -1 }, { c: -1, r: -1 },
        { c: -1, r: 0 }, { c: -1, r: 1 }, { c: 0, r: 1 }
    ];
    // Odd rows
    const oddDirs = [
        { c: 1, r: 0 }, { c: 1, r: -1 }, { c: 0, r: -1 },
        { c: -1, r: 0 }, { c: 0, r: 1 }, { c: 1, r: 1 }
    ];

    const dirs = (row % 2 === 0) ? evenDirs : oddDirs;

    return dirs.map(d => ({ c: col + d.c, r: row + d.r }));
  }
}

