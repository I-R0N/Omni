/**
 * FlowFieldGrid — tile-aware, incrementally-updated dual flow field.
 *
 * Two fields share a single obstacle bitmap but use different algorithms:
 *
 *   • Asteroid streaming field (vortex-based, no BFS)
 *       Each cell samples the active map's `sampleFlow()` to get a base
 *       direction, then deflects away from any blocked cardinal neighbours
 *       (`WALL_REPULSE`).  Sampled every frame to steer asteroids through
 *       open corridors.  Recomputed for a 5-cell neighbourhood whenever a
 *       tile is destroyed.
 *
 *   • Enemy pursuit field (BFS distance, gradient-of-distance flow)
 *       Goal: player's current grid cell.
 *       Rebuilt lazily (only when the player changes cells) with a range cap
 *       so the BFS only fans out ~11 cells (~2800 units) from the player,
 *       keeping each rebuild under ~0.2 ms.
 *
 * Incremental tile destruction (enemy field only)
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
import { sampleFlow, FlowVector as AnalyticalFlowVector } from './FlowField';
import { MAP_WIDTH, MAP_HEIGHT, HALF_MAP_WIDTH, HALF_MAP_HEIGHT, onMapDimensionsChanged } from '../toroidal';

export type FlowSampler = (wx: number, wy: number) => AnalyticalFlowVector;

// ─── grid constants ────────────────────────────────────────────────────────
//
// Toroidal grid: the world wraps at ±HALF_MAP_{WIDTH,HEIGHT}.  Grid edges
// line up exactly with the wrap seam, so BFS neighbour lookups can use
// modular arithmetic on (row, col) without any special-case handling for
// off-grid cells — every world coordinate maps to exactly one cell and
// every cell has four in-range neighbours.

const CELL_SIZE_DEFAULT = 256;
let CELL_SIZE = CELL_SIZE_DEFAULT;          // world units per cell
// Min corner + cell counts are `let` so setMapDimensions() updates them
// on map load.  Instances reallocate their typed arrays in
// `_ensureCapacity()` when the cell count grows past their current size.
let MAP_MIN_X = -HALF_MAP_WIDTH;
let MAP_MIN_Y = -HALF_MAP_HEIGHT;

export let FF_COLS = Math.ceil(MAP_WIDTH  / CELL_SIZE);
export let FF_ROWS = Math.ceil(MAP_HEIGHT / CELL_SIZE);
let TOTAL = FF_COLS * FF_ROWS;

onMapDimensionsChanged((w, h) => {
    MAP_MIN_X = -w / 2;
    MAP_MIN_Y = -h / 2;
    FF_COLS = Math.ceil(w / CELL_SIZE);
    FF_ROWS = Math.ceil(h / CELL_SIZE);
    TOTAL   = FF_COLS * FF_ROWS;
});

const INF = 0x7FFF_FFFF;

// 4-directional adjacency: DR4[k] = row delta, DC4[k] = col delta
//   k=0: north  k=1: south  k=2: west  k=3: east
const DR4 = [-1,  1,  0,  0] as const;
const DC4 = [ 0,  0, -1,  1] as const;

// How strongly blocked neighbours deflect the asteroid flow.  Each
// blocked neighbour subtracts (dc, dr) * WALL_REPULSE / d² from the
// base vortex vector before normalisation, where d² is the squared
// cell-distance (1 for cardinal, 2 for diagonal, ...).  At 1.2 a
// single cardinal-neighbour wall (d²=1) rotates the flow ~50° away
// from the obstacle; two adjacent walls (inside corner) rotate it
// ~90°.  Farther walls in the kernel contribute smoothly less.
const WALL_REPULSE = 1.2;

// Default wall-kernel radius (cells).  R = 0 reproduces the legacy
// 4-cardinal-only scan for A/B testing; R ≥ 1 enables the extended
// (2R+1)² kernel.  Default 3 — wide enough to bend the flow several
// cells before an obstacle so streamlines curve around tile clusters
// instead of pointing straight at them until impact.  GameEngine
// cycles this at runtime via the DBG "FF KernelR" button.
const DEFAULT_KERNEL_R = 3;

// Default tangent-mix factor.  0 = pure radial (push perpendicular
// away from walls — produces opposing vectors on either side of a
// wall and traps shards on the boundary).  1 = pure tangent (slide
// along walls — both sides flow in the same along-wall direction,
// no saddle).  0.5 = balanced.  GameEngine cycles this via the DBG
// "FF Tangent" button.
const DEFAULT_TANGENT_MIX = 0.5;

// Breathing field — a slow spatio-temporal undulation added to the
// base flow direction so convergence/saddle zones migrate over time
// instead of sitting still and continuously feeding the same pile of
// shards.  Each cell's base vector is rotated by
//   a = breatheAmp · sin(2π·WAVES·(wx/W + wy/H) + breathePhase)
// before wall repulsion.  WAVES is an integer so the term is
// seam-continuous on the (square) torus.  Amplitude is fixed; the
// scroll rate (phase advance per second) is the DBG-tunable knob —
// GameEngine advances breathePhase and re-bakes on a throttled
// cadence.  Amp 0 ⇒ static field (current behaviour).
const BREATHE_AMP_RAD = 0.45;   // ≈ 26° peak undulation
const BREATHE_WAVES   = 2;      // wavelengths across each map axis

// Enemy pursuit BFS is capped at this many cells from the player so each
// rebuild stays cheap AND the range stays under half the grid axis,
// which is required on the toroidal map: a BFS that propagates past
// halfGrid would start landing on the far side of the wrap and the
// pursuit field would overlap itself.  At MAP_WIDTH=6000 / CELL_SIZE=256,
// FF_COLS=24 → half=12 → range must be ≤11.
const MAX_ENEMY_RANGE = 11; // cells ≈ 2816 world units

// ─── public types ─────────────────────────────────────────────────────────

export interface FlowVector { x: number; y: number }

// ─── FlowFieldGrid ────────────────────────────────────────────────────────

export class FlowFieldGrid {

  // All grid-sized buffers are reassignable so per-map dimension changes
  // can grow them in `_ensureCapacity()` before the next initObstacles()
  // populates the new map.  The patch queue is map-independent.
  private blocked   = new Uint8Array(TOTAL);

  // ── asteroid streaming field (vortex-based, no BFS distance needed) ──
  private astFlowX  = new Float32Array(TOTAL);
  private astFlowY  = new Float32Array(TOTAL);

  // ── enemy pursuit field ──
  private eneDist   = new Int32Array(TOTAL).fill(INF);
  private eneFlowX  = new Float32Array(TOTAL);
  private eneFlowY  = new Float32Array(TOTAL);

  // Pre-allocated queues — zero runtime allocation in the hot path.
  // fullQ / inFullQ  : full-map BFS (asteroid init + enemy rebuild)
  // patchQ           : small incremental patch queue
  private fullQ    = new Int32Array(TOTAL + 4);
  private inFullQ  = new Uint8Array(TOTAL);
  private readonly patchQ = new Int32Array(8192);

  // Current allocation sizes so _ensureCapacity() knows when to reallocate.
  private _allocTotal = TOTAL;

  private playerCell  = -1;
  private enemyDirty  = true;   // true = rebuild enemy field next flush

  // Active flow sampler — the map's own streamline function when provided,
  // else the global analytical meander.  Set by buildAsteroidField() and
  // reused by _computeAsteroidCell() (including wall-repulsion fallbacks)
  // and sampleAsteroidFlow() (out-of-grid fallback).  Caching the sampler
  // here keeps the map-specific flow geometry in one place instead of
  // reaching across systems for it on every grid recompute.
  private flowSampler: FlowSampler = sampleFlow;

  // Perf instrumentation — wall time (ms) of the most recent
  // flushEnemyField() invocation.  Zero when the field was clean and the
  // flush was a no-op; populated when a full range-capped BFS rebuild ran.
  // Read by GameEngine for the dev perf overlay so we can catch pathological
  // rebuild thrash (e.g. player oscillating across a cell boundary).
  public lastFlushMs: number = 0;

  // Wall-kernel radius (cells).  Mutated only by setKernelR(); caller
  // is responsible for re-baking the asteroid field afterward.  Reads
  // are uncontended (single-threaded sim) so no copy/snapshot needed.
  private kernelR: number = DEFAULT_KERNEL_R;

  // Tangent-mix factor in [0, 1].  Each blocked-neighbour contribution
  // is blended (1 - mix) × radial + mix × tangent, where tangent is
  // the radial vector rotated 90° in the direction whose dot product
  // with the base flow is non-negative.  Eliminates the opposing-
  // vectors saddle along long walls — both sides of the wall produce
  // tangents that point the same way (along the wall, with the base
  // flow) instead of perpendicular-and-opposite.
  private tangentMix: number = DEFAULT_TANGENT_MIX;

  // Breathing-field state.  `breatheAmp` 0 ⇒ static field; > 0 ⇒ the
  // base flow vector is rotated per-cell by a scrolling spatial wave.
  // `breathePhase` is advanced by GameEngine before each throttled
  // re-bake.  Both mutated only via setBreathe(); the caller re-bakes.
  private breatheAmp:   number = 0;
  private breathePhase: number = 0;

  // Per-cell timestamp of the most recent asteroid-field recompute (ms,
  // performance.now() domain).  Written by `_computeAsteroidCell` for
  // every cell it touches: every cell at `buildAsteroidField` (map load)
  // and 5 cells at each `onTileDestroyed`.  Consumed only by the DBG
  // "FF Rebuilds" overlay — it flashes any cell whose timestamp is
  // within FLASH_DURATION_MS of now().  Allocation matches the typed-
  // array group above so it grows the same way in `_ensureCapacity`.
  private astRebuildTs = new Float64Array(TOTAL);

  // ─── coordinate helpers ──────────────────────────────────────────────────

  worldToCell(wx: number, wy: number): number {
    // World coords are expected to be wrapped into [-HALF_MAP, +HALF_MAP),
    // but defensively modulo-reduce into the grid so any stale pre-wrap
    // position still maps to a valid cell instead of returning -1.
    let col = ((wx - MAP_MIN_X) / CELL_SIZE) | 0;
    let row = ((wy - MAP_MIN_Y) / CELL_SIZE) | 0;
    col = ((col % FF_COLS) + FF_COLS) % FF_COLS;
    row = ((row % FF_ROWS) + FF_ROWS) % FF_ROWS;
    return row * FF_COLS + col;
  }

  // ─── initialisation ──────────────────────────────────────────────────────

  /**
   * Reallocate the grid-sized typed-array fields if the current map's
   * cell count exceeds the previously-allocated capacity.  Called at the
   * top of initObstacles() so every map load sees arrays sized for the
   * active dimensions.  Pure no-op when the new map fits in the existing
   * allocation (common after the first map load).
   */
  private _ensureCapacity(): void {
    if (TOTAL <= this._allocTotal) return;
    this.blocked  = new Uint8Array(TOTAL);
    this.astFlowX = new Float32Array(TOTAL);
    this.astFlowY = new Float32Array(TOTAL);
    this.eneDist  = new Int32Array(TOTAL);
    this.eneFlowX = new Float32Array(TOTAL);
    this.eneFlowY = new Float32Array(TOTAL);
    this.fullQ    = new Int32Array(TOTAL + 4);
    this.inFullQ  = new Uint8Array(TOTAL);
    this.astRebuildTs = new Float64Array(TOTAL);
    this._allocTotal = TOTAL;
  }

  /**
   * Change the grid's cell size and rebuild every grid-sized buffer.
   * Caller (GameEngine) must re-invoke `initObstacles()` +
   * `buildAsteroidField()` afterward, since the obstacle bitmap and
   * asteroid-flow vectors are wiped here.  The enemy pursuit field is
   * marked dirty so the next `flushEnemyField()` rebakes it for the
   * new resolution.
   *
   * No-op when `size` equals the current cell size.  Otherwise FF_COLS
   * / FF_ROWS / TOTAL are recomputed against the current map
   * dimensions, and every typed array is reallocated at the new TOTAL
   * — old data is intentionally dropped because cell indices change
   * meaning when the cell size changes.
   *
   * Today this is only called from GameEngine's DBG "FF Density" cycle.
   */
  setCellSize(size: number): void {
    if (size === CELL_SIZE || !(size > 0)) return;
    CELL_SIZE = size;
    FF_COLS = Math.ceil(MAP_WIDTH  / CELL_SIZE);
    FF_ROWS = Math.ceil(MAP_HEIGHT / CELL_SIZE);
    TOTAL   = FF_COLS * FF_ROWS;
    this.blocked      = new Uint8Array(TOTAL);
    this.astFlowX     = new Float32Array(TOTAL);
    this.astFlowY     = new Float32Array(TOTAL);
    this.eneDist      = new Int32Array(TOTAL).fill(INF);
    this.eneFlowX     = new Float32Array(TOTAL);
    this.eneFlowY     = new Float32Array(TOTAL);
    this.fullQ        = new Int32Array(TOTAL + 4);
    this.inFullQ      = new Uint8Array(TOTAL);
    this.astRebuildTs = new Float64Array(TOTAL);
    this._allocTotal  = TOTAL;
    // Invalidate the cached player cell — the index meaning changed
    // and the next scheduleEnemyRebuild() call will re-derive it.
    this.playerCell = -1;
    this.enemyDirty = true;
  }

  /** Default cell size used at construction and after a reset. */
  static readonly DEFAULT_CELL_SIZE = CELL_SIZE_DEFAULT;

  /** Fixed breathing undulation amplitude (radians).  GameEngine
   *  passes this to setBreathe() when the breathing rate is non-zero. */
  static readonly BREATHE_AMP = BREATHE_AMP_RAD;

  /**
   * Populate the obstacle bitmap from the map's tile entities.
   * Call once right after map.init() and before buildAsteroidField().
   *
   * Only SOLID static tiles count as flow obstacles — i.e. glass /
   * plastic / metal / indestructible / rock.  Excluded:
   *   - Mobile shards (finite mass).  They drift; baking them into
   *     the bitmap would freeze stale geometry across a frame.
   *   - Nebula tiles.  They're pass-through to projectiles and
   *     intentionally don't block traversal — flow should bend
   *     around walls, not around clouds.
   */
  initObstacles(entities: GameEntity[]): void {
    this._ensureCapacity();
    this.blocked.fill(0);
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!e.active || e.type !== EntityType.STRUCTURE) continue;
      if (e.mass !== Infinity) continue;          // skip mobile shards
      if (e.shardVariant === 'nebula-tile') continue; // pass-through
      const idx = this.worldToCell(e.position.x, e.position.y);
      if (idx >= 0) this.blocked[idx] = 1;
    }
  }

  /**
   * Build the asteroid streaming field from the analytical vortex field.
   *
   * For every unblocked cell the base flow direction is sampled from
   * sampleFlow() and then corrected by wall repulsion over the active
   * kernel (radius = `kernelR`).  Each blocked neighbour contributes
   * (dc, dr) * WALL_REPULSE / d² in the away-from-obstacle direction;
   * the sum is added to the base vector before normalisation.  Wider
   * kernels make the field curve gradually around tile clusters
   * instead of staying straight until the very last cell.
   */
  buildAsteroidField(sampler?: FlowSampler): void {
    if (sampler) this.flowSampler = sampler;
    for (let idx = 0; idx < TOTAL; idx++) {
      this._computeAsteroidCell(idx);
    }
  }

  /**
   * Change the wall-kernel radius and re-bake every cell.  R = 0
   * reproduces the legacy 4-cardinal-only scan for A/B testing; R ≥ 1
   * enables the extended (2R+1)² kernel with 1/d² falloff.  Cycled at
   * runtime via the DBG "FF KernelR" button.  No-op when `r` equals
   * the current radius.
   */
  setKernelR(r: number): void {
    if (r < 0) r = 0;
    if (r === this.kernelR) return;
    this.kernelR = r;
    for (let idx = 0; idx < TOTAL; idx++) {
      this._computeAsteroidCell(idx);
    }
  }

  /**
   * Change the tangent-mix factor and re-bake every cell.  See the
   * `tangentMix` field comment for semantics.  Clamped to [0, 1];
   * no-op when the value matches the current mix.
   */
  setTangentMix(mix: number): void {
    if (mix < 0) mix = 0;
    else if (mix > 1) mix = 1;
    if (mix === this.tangentMix) return;
    this.tangentMix = mix;
    for (let idx = 0; idx < TOTAL; idx++) {
      this._computeAsteroidCell(idx);
    }
  }

  /**
   * Set the breathing amplitude (radians) and scroll phase, then
   * re-bake every cell.  Amp 0 restores the static field.  GameEngine
   * advances `phase` on a throttled cadence so convergence zones drift
   * over time and shard piles dissolve.  See the BREATHE_* constants.
   */
  setBreathe(amp: number, phase: number): void {
    this.breatheAmp = amp;
    this.breathePhase = phase;
    for (let idx = 0; idx < TOTAL; idx++) {
      this._computeAsteroidCell(idx);
    }
  }

  /** Recompute the asteroid flow vector for a single cell. */
  private _computeAsteroidCell(idx: number): void {
    // Stamp the recompute time for the DBG "FF Rebuilds" overlay
    // regardless of blocked-vs-open outcome — every recompute is a
    // rebuild event worth surfacing.
    this.astRebuildTs[idx] = performance.now();
    if (this.blocked[idx]) {
      this.astFlowX[idx] = 0; this.astFlowY[idx] = 0; return;
    }

    const row = (idx / FF_COLS) | 0;
    const col =  idx % FF_COLS;
    const wx  = MAP_MIN_X + (col + 0.5) * CELL_SIZE;
    const wy  = MAP_MIN_Y + (row + 0.5) * CELL_SIZE;

    // Base direction from the active map flow sampler, optionally
    // rotated by the breathing wave so the field slowly undulates.
    // The wall-repulsion tangent below keys off this rotated base, so
    // the along-wall slide direction breathes with the field too.
    const base = this.flowSampler(wx, wy);
    let baseX = base.x;
    let baseY = base.y;
    if (this.breatheAmp !== 0) {
      const a = this.breatheAmp * Math.sin(
        2 * Math.PI * BREATHE_WAVES * (wx / MAP_WIDTH + wy / MAP_HEIGHT)
        + this.breathePhase,
      );
      const ca = Math.cos(a), sa = Math.sin(a);
      const rx = baseX * ca - baseY * sa;
      const ry = baseX * sa + baseY * ca;
      baseX = rx; baseY = ry;
    }
    let fx = baseX;
    let fy = baseY;

    // Wall repulsion.  R = 0 hits only the 4 cardinal neighbours
    // (legacy mode, preserved for A/B comparison).  R ≥ 1 scans the
    // full (2R+1)² neighbourhood with 1/d² falloff so distant walls
    // still bend the flow, just more softly.  All neighbour lookups
    // wrap on the torus so edge cells consider their counterparts
    // across the seam.
    //
    // Each contribution is split into a radial component (push
    // perpendicular away from the wall, vector = (-dc, -dr) × w) and
    // a tangent component (the radial rotated 90° in the direction
    // whose dot product with the base flow is non-negative — i.e.,
    // "slide along the wall, keeping the base flow's direction
    // sense").  The two are blended (1 - mix) × radial + mix ×
    // tangent so at mix = 1 the cell flows purely along walls
    // (eliminates the opposing-vectors saddle that traps shards on
    // long wall surfaces); at mix = 0 the kernel reduces to the
    // pre-tangent radial-only behaviour exactly.
    const R = this.kernelR;
    const mix = this.tangentMix;
    const rWeight = 1 - mix;
    if (R === 0) {
      for (let k = 0; k < 4; k++) {
        const nr = (row + DR4[k] + FF_ROWS) % FF_ROWS;
        const nc = (col + DC4[k] + FF_COLS) % FF_COLS;
        if (this.blocked[nr * FF_COLS + nc]) {
          const dc = DC4[k], dr = DR4[k];
          const radX = -dc * WALL_REPULSE;
          const radY = -dr * WALL_REPULSE;
          // tangent = radial rotated 90°; sign chosen so dot(tan,
          // base) ≥ 0 (flow continues in the base direction sense
          // along the wall instead of reversing).
          const t1x = -radY, t1y = radX;
          const sign = (t1x * baseX + t1y * baseY) >= 0 ? 1 : -1;
          fx += rWeight * radX + mix * sign * t1x;
          fy += rWeight * radY + mix * sign * t1y;
        }
      }
    } else {
      for (let dr = -R; dr <= R; dr++) {
        const nr = (row + dr + FF_ROWS) % FF_ROWS;
        for (let dc = -R; dc <= R; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nc = (col + dc + FF_COLS) % FF_COLS;
          if (this.blocked[nr * FF_COLS + nc]) {
            const d2 = dr * dr + dc * dc;
            const w  = WALL_REPULSE / d2;
            const radX = -dc * w;
            const radY = -dr * w;
            const t1x = -radY, t1y = radX;
            const sign = (t1x * baseX + t1y * baseY) >= 0 ? 1 : -1;
            fx += rWeight * radX + mix * sign * t1x;
            fy += rWeight * radY + mix * sign * t1y;
          }
        }
      }
    }

    const mag = Math.sqrt(fx * fx + fy * fy);
    if (mag > 0.001) {
      this.astFlowX[idx] = fx / mag;
      this.astFlowY[idx] = fy / mag;
    } else {
      // Near-zero after repulsion (e.g. inside corner) — fall back to
      // the (breathed) base direction.
      this.astFlowX[idx] = baseX;
      this.astFlowY[idx] = baseY;
    }
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
    if (!this.enemyDirty) { this.lastFlushMs = 0; return; }
    const t0 = performance.now();
    this.enemyDirty = false;
    this.eneDist.fill(INF);
    if (this.playerCell < 0 || this.blocked[this.playerCell]) {
      this.lastFlushMs = performance.now() - t0;
      return;
    }
    this.eneDist[this.playerCell] = 0;
    this._runFullBFS([this.playerCell], this.eneDist, MAX_ENEMY_RANGE);
    this._computeAllGradients(this.eneDist, this.eneFlowX, this.eneFlowY);
    this.lastFlushMs = performance.now() - t0;
  }

  /**
   * Notify the grid that a tile was destroyed at world position (wx, wy).
   *
   * Asteroid field: recompute every cell whose kernel includes the
   * destroyed tile — the (2R+1)² neighbourhood centred on the cleared
   * cell, where R = kernelR.  In legacy mode (R=0) this is just the 5
   * cells (self + 4 cardinals); at the default R=3 it's 49 cells.
   *
   * Enemy field: incremental BFS patch (unchanged).
   */
  onTileDestroyed(wx: number, wy: number): void {
    const idx = this.worldToCell(wx, wy);
    if (idx < 0 || !this.blocked[idx]) return;
    this.blocked[idx] = 0;

    // Asteroid field — recompute the kernel neighbourhood
    this._rebakeAsteroidKernel(idx);

    // Enemy field — BFS patch
    this._patchField(idx, this.eneDist, this.eneFlowX, this.eneFlowY);
  }

  /**
   * Notify the grid that a static obstacle tile was created at world
   * position (wx, wy) — e.g. by a shard-merge / hot-spot collapse under
   * the new merge rules, which condense loose shards into large tile
   * clusters at runtime.  Without this the `blocked` bitmap stays stale
   * and enemies path straight through walls that didn't exist at map
   * load.
   *
   * Asteroid field: the new wall must repel nearby streamlines, so
   * recompute the (2R+1)² kernel neighbourhood centred on the now-blocked
   * cell — the mirror of onTileDestroyed.
   *
   * Enemy field: blocking a cell *raises* BFS distances across a region,
   * which the cell-opening _patchField() (it only relaxes distances
   * downward) cannot patch incrementally.  Mark the field dirty instead
   * and let the throttled flushEnemyField() do one full range-capped
   * rebuild — i.e. recalculate occasionally in these areas rather than
   * per tile, so a burst of merges coalesces into a single recompute.
   *
   * Callers only fire this for obstacle-forming material tiles; nebula
   * tiles are pass-through and excluded from the obstacle bitmap, so they
   * never reach here.
   */
  onTileCreated(wx: number, wy: number): void {
    const idx = this.worldToCell(wx, wy);
    if (idx < 0 || this.blocked[idx]) return; // off-grid or already blocked
    this.blocked[idx] = 1;

    this._rebakeAsteroidKernel(idx);
    this.enemyDirty = true;
  }

  /**
   * Recompute the asteroid-flow vectors for the kernel neighbourhood
   * centred on `idx`: the (2R+1)² block at R = kernelR, or self + the 4
   * cardinals in legacy R=0 mode.  Shared by the tile destroy/create
   * patch hooks — both flip the obstacle bitmap and must refresh
   * wall-repulsion in the surrounding cells.
   */
  private _rebakeAsteroidKernel(idx: number): void {
    const row = (idx / FF_COLS) | 0;
    const col =  idx % FF_COLS;
    const R = this.kernelR;
    if (R === 0) {
      this._computeAsteroidCell(idx);
      for (let k = 0; k < 4; k++) {
        const nr = (row + DR4[k] + FF_ROWS) % FF_ROWS;
        const nc = (col + DC4[k] + FF_COLS) % FF_COLS;
        this._computeAsteroidCell(nr * FF_COLS + nc);
      }
    } else {
      for (let dr = -R; dr <= R; dr++) {
        const nr = (row + dr + FF_ROWS) % FF_ROWS;
        for (let dc = -R; dc <= R; dc++) {
          const nc = (col + dc + FF_COLS) % FF_COLS;
          this._computeAsteroidCell(nr * FF_COLS + nc);
        }
      }
    }
  }

  // ─── sampling ────────────────────────────────────────────────────────────

  /** O(1) — returns a unit vector in the asteroid streaming direction. */
  sampleAsteroidFlow(wx: number, wy: number): FlowVector {
    const idx = this.worldToCell(wx, wy);
    // Outside the grid or zero-vector cell: fall back to the active map
    // sampler (set by buildAsteroidField) rather than the global analytical
    // meander so the fallback matches the baked grid's geometry.
    if (idx < 0) return this.flowSampler(wx, wy);
    const fx = this.astFlowX[idx], fy = this.astFlowY[idx];
    return (fx !== 0 || fy !== 0) ? { x: fx, y: fy } : this.flowSampler(wx, wy);
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

  /**
   * O(1) — returns an unnormalized repulsion vector away from any blocked
   * cardinal neighbours of the given world position.  Used as a fallback
   * steering correction when the enemy pursuit flow field has no vector for
   * the current cell (e.g. inside or adjacent to a dense tile cluster).
   * Returns {0,0} when the cell has no blocked neighbours.
   */
  sampleWallRepulsion(wx: number, wy: number): FlowVector {
    const idx = this.worldToCell(wx, wy);
    if (idx < 0) return { x: 0, y: 0 };
    const row = (idx / FF_COLS) | 0;
    const col =  idx % FF_COLS;
    let rx = 0, ry = 0;
    for (let k = 0; k < 4; k++) {
      const nr = (row + DR4[k] + FF_ROWS) % FF_ROWS;
      const nc = (col + DC4[k] + FF_COLS) % FF_COLS;
      if (this.blocked[nr * FF_COLS + nc]) {
        rx -= DC4[k]; // push away from the blocked neighbour
        ry -= DR4[k];
      }
    }
    return { x: rx, y: ry };
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
        const nr = (row + DR4[k] + FF_ROWS) % FF_ROWS;
        const nc = (col + DC4[k] + FF_COLS) % FF_COLS;
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
      const nr = (row0 + DR4[k] + FF_ROWS) % FF_ROWS;
      const nc = (col0 + DC4[k] + FF_COLS) % FF_COLS;
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
        const nr = (row + DR4[k] + FF_ROWS) % FF_ROWS;
        const nc = (col + DC4[k] + FF_COLS) % FF_COLS;
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
        const nr = (ur + DR4[k] + FF_ROWS) % FF_ROWS;
        const nc = (uc + DC4[k] + FF_COLS) % FF_COLS;
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
      const nr = (row + DR4[k] + FF_ROWS) % FF_ROWS;
      const nc = (col + DC4[k] + FF_COLS) % FF_COLS;
      const nidx = nr * FF_COLS + nc;
      if (dist[nidx] < d) { bx += DC4[k]; by += DR4[k]; }
    }

    const mag = Math.sqrt(bx * bx + by * by);
    flowX[idx] = mag > 0 ? bx / mag : 0;
    flowY[idx] = mag > 0 ? by / mag : 0;
  }

  // ─── overlay accessors (DBG / dev-only) ──────────────────────────────────
  //
  // Read-only views of the grid's internal buffers so the renderer's
  // asteroid/shard FF overlays can draw cell outlines, vectors, the
  // obstacle bitmap, and per-cell rebuild flashes without going through
  // an allocation-heavy `sampleAsteroidFlow()` loop.  Returned arrays
  // are LIVE — callers must not mutate them.

  /** Cell edge length in world units. */
  get cellSize(): number { return CELL_SIZE; }
  /** Current grid column count.  May change after a map-dimension swap. */
  get cols(): number { return FF_COLS; }
  /** Current grid row count.  May change after a map-dimension swap. */
  get rows(): number { return FF_ROWS; }
  /** World-space x-coordinate of the left edge of column 0. */
  get minX(): number { return MAP_MIN_X; }
  /** World-space y-coordinate of the top edge of row 0. */
  get minY(): number { return MAP_MIN_Y; }
  /** Live obstacle bitmap (1 = blocked).  Read-only — do not mutate. */
  get blockedView(): Uint8Array { return this.blocked; }
  /** Live asteroid-flow x-components per cell.  Read-only. */
  get astFlowXView(): Float32Array { return this.astFlowX; }
  /** Live asteroid-flow y-components per cell.  Read-only. */
  get astFlowYView(): Float32Array { return this.astFlowY; }
  /** Live per-cell rebuild timestamps (performance.now ms).  Read-only. */
  get astRebuildTsView(): Float64Array { return this.astRebuildTs; }
}
