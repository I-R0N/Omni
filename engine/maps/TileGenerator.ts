
import { GameEntity, EntityType } from '../../types';
import { COLORS, STRUCTURE_CONSTANTS, ASSETS } from '../../constants';

export class TileGenerator {
  /**
   * Generates discrete clusters of hexagonal tiles spread across the map.
   * Ensures all tiles align to the same global grid.
   */
  public static generateClusteredMesh(
    mapWidth: number,
    mapHeight: number,
    hexSize: number,
    clusterCount: number,
    minClusterSize: number,
    maxClusterSize: number
  ): GameEntity[] {
    const entities: GameEntity[] = [];
    const usedCoords = new Set<string>(); // "col,row"

    // Hexagon geometric constants (Pointy topped)
    // Width = sqrt(3) * size
    // Height = 2 * size
    // Horizontal spacing = Width
    // Vertical spacing = 3/4 * Height
    const w = Math.sqrt(3) * hexSize;
    const h = 2 * hexSize;
    const hDist = w;
    const vDist = 0.75 * h;

    // Estimate grid bounds based on map size
    // We center the grid at 0,0. 
    // Max column index roughly width / w
    // Max row index roughly height / vDist
    const maxCol = Math.ceil((mapWidth / 2) / hDist);
    const maxRow = Math.ceil((mapHeight / 2) / vDist);

    for (let i = 0; i < clusterCount; i++) {
      // 1. Pick a random seed location on the grid
      let startCol = Math.floor((Math.random() * 2 - 1) * maxCol);
      let startRow = Math.floor((Math.random() * 2 - 1) * maxRow);

      // 2. Determine cluster size
      const targetSize = Math.floor(minClusterSize + Math.random() * (maxClusterSize - minClusterSize));
      
      // 3. Grow cluster (BFS/Random Traversal)
      const openSet: { c: number, r: number }[] = [{ c: startCol, r: startRow }];
      let createdInCluster = 0;

      while (openSet.length > 0 && createdInCluster < targetSize) {
        // Pick a random hex from the open set to grow organically (blob-like)
        // Picking index 0 would be BFS (circular), picking last would be DFS (snakey)
        const idx = Math.floor(Math.random() * openSet.length);
        const current = openSet[idx];
        openSet.splice(idx, 1);

        const key = `${current.c},${current.r}`;
        if (usedCoords.has(key)) continue;

        usedCoords.add(key);
        createdInCluster++;

        // Add Entity
        this.createHexEntity(entities, current.c, current.r, hexSize, w, h);

        // Add Neighbors to Open Set
        const neighbors = this.getNeighbors(current.c, current.r);
        for (const n of neighbors) {
          const nKey = `${n.c},${n.r}`;
          if (!usedCoords.has(nKey)) {
             // Optional: Chance to skip adding neighbor to open set for more ragged edges
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
