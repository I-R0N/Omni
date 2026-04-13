
import { GameEntity, EntityType, NebulaColorStop } from '../../types';
import { COLORS, STRUCTURE_CONSTANTS, ASSETS, NEBULA_CONSTANTS } from '../../constants';
import { NEBULA_IMAGES } from '../../assets';
import { randomNebulaComposition, cloneComposition } from '../NebulaColor';

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
    occupiedCoords?: Set<string>
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

        this.createHexEntity(entities, current.c, current.r, hexSize, w, h);

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
   */
  public static generateNebulaClusters(
    mapWidth: number,
    mapHeight: number,
    hexSize: number,
    clusterCount: number,
    minClusterSize: number,
    maxClusterSize: number,
    occupiedCoords: Set<string>
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
      h: number
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

    entities.push({
        id: `tile_${r}_${c}_${Math.random().toString(36).substr(2, 9)}`,
        type: EntityType.STRUCTURE,
        position: { x: cx, y: cy },
        velocity: { x: 0, y: 0 },
        size: { x: w * 0.95, y: h * 0.95 }, // Slight gap
        rotation: 0,
        color: Math.random() > 0.8 ? COLORS.STRUCTURE_BORDER : COLORS.STRUCTURE,
        active: true,
        health: STRUCTURE_CONSTANTS.HEALTH,
        maxHealth: STRUCTURE_CONSTANTS.HEALTH,
        mass: STRUCTURE_CONSTANTS.MASS,
        polygonPoints: pts,
        sprite: ASSETS.HEX_STRUCTURE
    });
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
        id: `nebula_${r}_${c}_${Math.random().toString(36).substr(2, 9)}`,
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

