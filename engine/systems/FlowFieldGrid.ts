/**
 * FlowFieldGrid — tile-aware, incrementally-updated dual flow field.
 *
 * Two separate BFS distance fields share a single obstacle bitmap:
 *
 *   • Asteroid streaming field
 *       Goals: 4 fixed anchor positions (mirrors the old vortex centres).
 *       Sampled every frame to steer asteroids through open corridors.
 *
 *   • Enemy pursuit field
 *       Goal: player's current grid cell.
 *       Rebuilt lazily (only when the player changes cells) with a range cap
 *       so the BFS only fans out ~18 cells (~4600 units) from the player,
 *       keeping each rebuild under ~0.2 ms.
 *
 * Incremental tile destruction
 *   When a tile is destroyed the cell becomes unblocked.  Removing an
 *   obstacle can only SHORTEN paths, so a forward-BFS patch starting from
 *   the cleared cell propagates improvements outward and stops the moment
 *   no neighbouring distance decreases.  Typically only 20–200 cells are
 *   touched per destroyed tile.  Gradients are recomputed only for updated
 *   cells and their direct neighbours.
 *
 * Why a flat grid instead of a quadtree?
 *   A quadtree speeds up *sparse* neighbour queries, but flow-field BFS needs
 *   dense, uniform neighbour access.  A flat grid gives O(1) cell lookup and
 *   tight memory layout (TypedArrays) which keeps BFS cache-friendly.
 */

import { GameEntity, EntityType } from '../../types';

// ─── grid constants ────────────────────────────────────────────────────────

const CELL_SIZE = 256;          // world units per cell
const MAP_MIN   = -15000;       // world coordinate of grid edge
const MAP_MAX   =  15000;

export const FF_COLS = Math.ceil((MAP_MAX - MAP_MIN) / CELL_SIZE); // 118
export const FF_ROWS = FF_COLS;                                     // 118
const TOTAL = FF_COLS * FF_ROWS;                                    // 13 924

const INF = 0x7FFF_FFFF;

// 4-directional adjacency: DR4[k] = row delta, DC4[k] = col delta
//   k=0: north  k=1: south  k=2: west  k=3: east
const DR4 = [-1,  1,  0,  0] as const;
const DC4 = [ 0,  0, -1,  1] as const;

// Asteroid streaming goal positions — same quadrant layout as the old vortices.
const AST_GOALS = [
  { x:  3500, y:  3500 },
  { x: -3500, y:  3500 },
  { x:  3500, y: -3500 },
  { x: -3500, y: -3500 },
] as const;

// Enemy pursuit BFS is capped at this many cells from the player so each
// rebuild stays cheap (~800 cells vs. 14 k for the whole map).
const MAX_ENEMY_RANGE = 18; // cells  ≈ 4608 world units

// ─── public types ─────────────────────────────────────────────────────────

export interface FlowVector { x: number; y: number }

// ─── FlowFieldGrid ────────────────────────────────────────────────────────

export class FlowFieldGrid {

  // Shared obstacle bitmap (1 = blocked by a tile)
  private readonly blocked   = new Uint8Array(TOTAL);

  // ── asteroid streaming field ──
  private readonly astDist   = new Int32Array(TOTAL).fill(INF);
  private readonly astFlowX  = new Float32Array(TOTAL);
  private readonly astFlowY  = new Float32Array(TOTAL);

  // ── enemy pursuit field ──
  private readonly eneDist   = new Int32Array(TOTAL).fill(INF);
  private readonly eneFlowX  = new Float32Array(TOTAL);
  private readonly eneFlowY  = new Float32Array(TOTAL);

  // Pre-allocated queues — zero runtime allocation in the hot path.
  // fullQ / inFullQ  : full-map BFS (asteroid init + enemy rebuild)
  // patchQ           : small incremental patch queue
  private readonly fullQ    = new Int32Array(TOTAL + 4);
  private readonly inFullQ  = new Uint8Array(TOTAL);
  private readonly patchQ   = new Int32Array(8192);

  private playerCell  = -1;
  private enemyDirty  = true;   // true = rebuild enemy field next flush

  // ─── coordinate helpers ──────────────────────────────────────────────────

  worldToCell(wx: number, wy: number): number {
    const col = ((wx - MAP_MIN) / CELL_SIZE) | 0;
    const row = ((wy - MAP_MIN) / CELL_SIZE) | 0;
    if (col < 0 || col >= FF_COLS || row < 0 || row >= FF_ROWS) return -1;
    return row * FF_COLS + col;
  }

  // ─── initialisation ──────────────────────────────────────────────────────

  /**
   * Populate the obstacle bitmap from the map's tile entities.
   * Call once right after map.init() and before buildAsteroidField().
   */
  initObstacles(entities: GameEntity[]): void {
    this.blocked.fill(0);
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.active && e.type === EntityType.STRUCTURE) {
        const idx = this.worldToCell(e.position.x, e.position.y);
        if (idx >= 0) this.blocked[idx] = 1;
      }
    }
  }

  /**
   * Full BFS from the 4 asteroid goal anchors.
   * Runs once at map load (~0.5 ms).  The resulting gradient steers asteroids
   * through tile corridors toward the nearest goal.
   */
  buildAsteroidField(): void {
    this.astDist.fill(INF);
    const seeds: number[] = [];
    for (const g of AST_GOALS) {
      const idx = this.worldToCell(g.x, g.y);
      if (idx >= 0 && !this.blocked[idx]) {
        this.astDist[idx] = 0;
        seeds.push(idx);
      }
    }
    this._runFullBFS(seeds, this.astDist, INF);
    this._computeAllGradients(this.astDist, this.astFlowX, this.astFlowY);
  }

  // ─── runtime updates ─────────────────────────────────────────────────────

  /**
   * Call each frame with the player's world position.
   * Marks the enemy field dirty if the player has moved to a different cell;
   * the actual rebuild is deferred to flushEnemyField().
   */
  scheduleEnemyRebuild(px: number, py: number): void {
    const cell = this.worldToCell(px, py);
    if (cell !== this.playerCell) {
      this.playerCell = cell;
      this.enemyDirty = true;
    }
  }

  /**
   * Rebuild the enemy pursuit field if dirty.
   * Call at the start of the physics step, before AI update.
   * Worst-case cost: ~0.2 ms (BFS over ≤ π×18² ≈ 1000 cells).
   */
  flushEnemyField(): void {
    if (!this.enemyDirty) return;
    this.enemyDirty = false;
    this.eneDist.fill(INF);
    if (this.playerCell < 0 || this.blocked[this.playerCell]) return;
    this.eneDist[this.playerCell] = 0;
    this._runFullBFS([this.playerCell], this.eneDist, MAX_ENEMY_RANGE);
    this._computeAllGradients(this.eneDist, this.eneFlowX, this.eneFlowY);
  }

  /**
   * Notify the grid that a tile was destroyed at world position (wx, wy).
   * Performs an incremental BFS patch on both fields — only cells whose
   * shortest-path distance actually improves are touched.
   */
  onTileDestroyed(wx: number, wy: number): void {
    const idx = this.worldToCell(wx, wy);
    if (idx < 0 || !this.blocked[idx]) return;
    this.blocked[idx] = 0;
    this._patchField(idx, this.astDist, this.astFlowX, this.astFlowY);
    this._patchField(idx, this.eneDist, this.eneFlowX, this.eneFlowY);
  }

  // ─── sampling ────────────────────────────────────────────────────────────

  /** O(1) — returns a unit vector in the asteroid streaming direction. */
  sampleAsteroidFlow(wx: number, wy: number): FlowVector {
    const idx = this.worldToCell(wx, wy);
    if (idx < 0) return { x: 1, y: 0 };
    const fx = this.astFlowX[idx], fy = this.astFlowY[idx];
    return (fx !== 0 || fy !== 0) ? { x: fx, y: fy } : { x: 1, y: 0 };
  }

  /**
   * O(1) — returns a unit vector toward the player via the pursuit field.
   * Returns {0, 0} when the enemy is outside the range-capped field
   * (i.e. > ~4600 units from the player) — callers should fall back to
   * direct steering in that case.
   */
  sampleEnemyFlow(wx: number, wy: number): FlowVector {
    const idx = this.worldToCell(wx, wy);
    if (idx < 0) return { x: 0, y: 0 };
    return { x: this.eneFlowX[idx], y: this.eneFlowY[idx] };
  }

  // ─── internal BFS ────────────────────────────────────────────────────────

  /**
   * Standard BFS from `seeds`, writing distances into `dist`.
   * Stops expanding any branch once distance reaches `maxDist`.
   * Uses pre-allocated fullQ / inFullQ to avoid allocation.
   */
  private _runFullBFS(seeds: number[], dist: Int32Array, maxDist: number): void {
    const q   = this.fullQ;
    const inQ = this.inFullQ;
    inQ.fill(0);
    let head = 0, tail = 0;

    for (const s of seeds) { q[tail++] = s; inQ[s] = 1; }

    while (head < tail) {
      const idx = q[head++];
      const d   = dist[idx];
      if (d >= maxDist) continue;

      const row = (idx / FF_COLS) | 0;
      const col =  idx % FF_COLS;

      for (let k = 0; k < 4; k++) {
        const nr = row + DR4[k];
        const nc = col + DC4[k];
        if (nr < 0 || nr >= FF_ROWS || nc < 0 || nc >= FF_COLS) continue;
        const nidx = nr * FF_COLS + nc;
        if (this.blocked[nidx] || inQ[nidx]) continue;
        dist[nidx] = d + 1;
        inQ[nidx]  = 1;
        q[tail++]  = nidx;
      }
    }
  }

  /**
   * Incremental patch after a cell becomes unblocked.
   *
   * 1. Seed the cleared cell with (best neighbour distance + 1).
   * 2. BFS outward — only cells whose distance strictly decreases are
   *    enqueued, so the wavefront stops naturally.
   * 3. Recompute gradients for changed cells + their direct neighbours
   *    (a neighbour's gradient may change because it now has a shorter
   *    path through the updated cell).
   */
  private _patchField(
    startIdx: number,
    dist: Int32Array,
    flowX: Float32Array,
    flowY: Float32Array,
  ): void {
    const row0 = (startIdx / FF_COLS) | 0;
    const col0 =  startIdx % FF_COLS;

    // Find the best distance reachable from passable neighbours.
    let best = INF;
    for (let k = 0; k < 4; k++) {
      const nr = row0 + DR4[k], nc = col0 + DC4[k];
      if (nr < 0 || nr >= FF_ROWS || nc < 0 || nc >= FF_COLS) continue;
      const nidx = nr * FF_COLS + nc;
      if (!this.blocked[nidx] && dist[nidx] < best) best = dist[nidx];
    }
    if (best === INF) return; // No reachable neighbours — isolated cell.

    dist[startIdx] = best + 1;

    // BFS-propagate improvements.
    const q = this.patchQ;
    const updated: number[] = [startIdx];
    let head = 0, tail = 0;
    q[tail++] = startIdx;

    while (head < tail) {
      const idx = q[head++];
      const row = (idx / FF_COLS) | 0;
      const col =  idx % FF_COLS;

      for (let k = 0; k < 4; k++) {
        const nr = row + DR4[k], nc = col + DC4[k];
        if (nr < 0 || nr >= FF_ROWS || nc < 0 || nc >= FF_COLS) continue;
        const nidx = nr * FF_COLS + nc;
        if (this.blocked[nidx]) continue;
        if (dist[idx] + 1 < dist[nidx]) {
          dist[nidx] = dist[idx] + 1;
          updated.push(nidx);
          if (tail < q.length) q[tail++] = nidx;
        }
      }
    }

    // Refresh gradients for every updated cell + their direct neighbours
    // (a neighbour's preferred direction might now point through the patch).
    const refresh = new Set<number>(updated);
    for (const u of updated) {
      const ur = (u / FF_COLS) | 0, uc = u % FF_COLS;
      for (let k = 0; k < 4; k++) {
        const nr = ur + DR4[k], nc = uc + DC4[k];
        if (nr >= 0 && nr < FF_ROWS && nc >= 0 && nc < FF_COLS)
          refresh.add(nr * FF_COLS + nc);
      }
    }
    for (const u of refresh) this._gradientAt(u, dist, flowX, flowY);
  }

  private _computeAllGradients(
    dist: Int32Array,
    flowX: Float32Array,
    flowY: Float32Array,
  ): void {
    for (let idx = 0; idx < TOTAL; idx++) {
      if (dist[idx] === INF) { flowX[idx] = 0; flowY[idx] = 0; continue; }
      this._gradientAt(idx, dist, flowX, flowY);
    }
  }

  /**
   * Compute and store the gradient direction for one cell.
   * The gradient points toward the neighbour with the lowest distance
   * (= toward the goal along the shortest path).
   * DC4[k] maps to world-X direction; DR4[k] maps to world-Y direction.
   */
  private _gradientAt(
    idx: number,
    dist: Int32Array,
    flowX: Float32Array,
    flowY: Float32Array,
  ): void {
    if (this.blocked[idx] || dist[idx] === INF) {
      flowX[idx] = 0; flowY[idx] = 0; return;
    }
    const row = (idx / FF_COLS) | 0;
    const col =  idx % FF_COLS;
    const d   = dist[idx];
    let bx = 0, by = 0;

    for (let k = 0; k < 4; k++) {
      const nr = row + DR4[k], nc = col + DC4[k];
      if (nr < 0 || nr >= FF_ROWS || nc < 0 || nc >= FF_COLS) continue;
      const nidx = nr * FF_COLS + nc;
      if (dist[nidx] < d) { bx += DC4[k]; by += DR4[k]; }
    }

    const mag = Math.sqrt(bx * bx + by * by);
    flowX[idx] = mag > 0 ? bx / mag : 0;
    flowY[idx] = mag > 0 ? by / mag : 0;
  }
}
