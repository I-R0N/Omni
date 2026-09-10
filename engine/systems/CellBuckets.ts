import { GameEntity } from '../../types';

/**
 * CellBuckets — a spatial-hash bucket store that does not allocate once it
 * has warmed up.
 *
 * WHY THIS EXISTS (gauntlet 5c, P2).  The broadphase grids were built the
 * obvious way:
 *
 *     grid.clear();
 *     …
 *     let cell = grid.get(key);
 *     if (!cell) { cell = []; grid.set(key, cell); }
 *     cell.push(e);
 *
 * Every occupied cell allocates a fresh array EVERY SUBSTEP, and the sim
 * runs at 120 Hz — so a field with ~500 occupied cells burns ~60 000 array
 * allocations per second per grid, all of it immediately garbage.  Measured
 * on the shard-dense Asteroid Field, the two per-substep grids together were
 * the second-largest allocator in the whole engine (~200 MB over a 12 s
 * window).  Steady-state allocation is what buys GC pauses, and a GC pause
 * is a frame dip — so this is a smoothness bug, not a tidiness one.
 *
 * The fix is to recycle the bucket arrays instead of dropping them:
 * `beginPass()` empties every bucket handed out last pass and returns it to
 * a free list, so a steady-state field reaches a high-water mark of buckets
 * and then allocates nothing at all.
 *
 * Behaviour is IDENTICAL to the Map-of-fresh-arrays form: same keys, same
 * bucket contents, same iteration order within a bucket (insertion order,
 * since buckets are filled by a single forward pass).  Nothing downstream
 * can tell the difference — which is the point.
 *
 * NOT for the static grid: that one is built once on map load, so its
 * allocation is amortised over the whole map and pooling it would buy
 * nothing.
 */
export class CellBuckets {
  /**
   * Buckets indexed by DENSE CELL INDEX, not hashed.
   *
   * This was a `Map<number, GameEntity[]>` keyed on a packed `(cx << 16) | cy`.
   * But the key space is already dense and bounded — the cell coordinates are
   * wrapped into `[0, cols) x [0, rows)` before packing — so the hash was
   * buying nothing an array index would not, while costing a hash lookup on
   * every access.  The 3x3 neighbour scan does NINE lookups per entity per
   * substep, at 120 Hz; that is the single most-executed lookup in the engine.
   *
   * `undefined` means the cell is empty.  Sized by `resize()` from the map
   * dimensions.
   */
  private cells: (GameEntity[] | undefined)[] = [];

  // Free list of emptied bucket arrays, and the buckets handed out this
  // pass.  Both are index-filled with an explicit count rather than
  // `length = 0` + push, for the same reason the buckets themselves are
  // pooled: `length = 0` shrinks the backing store and the following pushes
  // re-grow it, which is an allocation per pass per array.
  private pool: GameEntity[][] = [];
  private poolN = 0;
  private live: GameEntity[][] = [];
  private liveN = 0;
  /** Parallel to `live`: the cell index each live bucket sits at, so
   *  `beginPass` can clear exactly the occupied cells instead of walking the
   *  whole (mostly empty) grid. */
  private liveIdx: number[] = [];

  /** Peak bucket population seen during the last fill pass.  The 3x3
   *  neighbour scan is O(k^2) in this, so it is the direct signal for
   *  dense-cluster stalls; callers surface it in the perf overlay. */
  public maxDensity = 0;

  /** Grow the grid to `nCells`.  Called when the map dimensions change; a
   *  no-op when the grid is already big enough, so a shrink keeps the larger
   *  backing array rather than reallocating it. */
  public resize(nCells: number): void {
    if (nCells <= this.cells.length) return;
    const cells = this.cells;
    for (let i = cells.length; i < nCells; i++) cells[i] = undefined;
  }

  /** Empty every occupied bucket and start a fresh fill pass. */
  public beginPass(): void {
    const live = this.live, liveIdx = this.liveIdx, cells = this.cells;
    for (let i = 0; i < this.liveN; i++) {
      const cell = live[i];
      cell.length = 0;
      this.pool[this.poolN++] = cell;
      cells[liveIdx[i]] = undefined;
    }
    this.liveN = 0;
    this.maxDensity = 0;
  }

  /** Append `e` to cell `idx`, creating (or recycling) the bucket as needed. */
  public push(idx: number, e: GameEntity): void {
    let cell = this.cells[idx];
    if (cell === undefined) {
      cell = this.poolN > 0 ? this.pool[--this.poolN] : [];
      this.cells[idx] = cell;
      this.live[this.liveN] = cell;
      this.liveIdx[this.liveN] = idx;
      this.liveN++;
    }
    cell.push(e);
    if (cell.length > this.maxDensity) this.maxDensity = cell.length;
  }

  /** The bucket at cell `idx`, or undefined when the cell is empty. */
  public get(idx: number): GameEntity[] | undefined {
    return this.cells[idx];
  }

  /** Drop every bucket AND the free list — for map load / teardown, where
   *  holding a map-sized pool of arrays alive would be a leak rather than a
   *  cache.  `beginPass` is the per-substep reset; this is not. */
  public reset(): void {
    this.beginPass();
    this.pool.length = 0;
    this.poolN = 0;
    this.live.length = 0;
    this.liveIdx.length = 0;
  }
}
