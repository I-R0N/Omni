import { GameEntity, EntityType, NebulaColorStop, Vector2 } from '../../types';
import { NEBULA_CONSTANTS, nebulaFadeRateScale } from '../../constants';
import {
    TileGenerator,
    HEX_SIZE,
    HEX_AREA,
    pixelToHexCoord,
    hexCoordToPixel,
} from '../maps/TileGenerator';
import {
    blendCompositionToHex,
    blendCompositions,
    cloneComposition,
    randomNebulaComposition,
    clampHueToPalette,
    hexToHueDeg,
    paletteHueToHex,
    circularHueAverage,
    circularHueDistance,
    circularLerpHue,
} from '../NebulaColor';
import { nextId } from './IdAllocator';
import { ParticleSystem } from './ParticleSystem';
import { DropSystem } from './DropSystem';
import { PhysicsSystem } from './PhysicsSystem';
import { wrapDeltaX, wrapDeltaY, wrapPosition, MAP_WIDTH, MAP_HEIGHT } from '../toroidal';

/**
 * NebulaSystem — owns everything nebula-specific: shatter bursts, shard
 * gravity/merge dynamics, tile regeneration with rule-based colour,
 * shard→tile transmutation, and the low-frequency ammo drop roll.
 *
 * Extracted from GameEngine as part of the Phase-2/3 style system split
 * introduced by the engine-upgrade PR.  NebulaSystem owns its own
 * `pendingRegens` queue (kept separate from glass-tile regen in
 * GameEngine) and drives a single per-frame `update()` tick.
 *
 * State that lives on NebulaSystem:
 *   - `pendingRegens` — inactive nebula tiles waiting to respawn.
 *
 * State that stays on the entity itself (ticked by PhysicsSystem):
 *   - `nebulaFadeTimer`, `nebulaSpawnTimer`, `nebulaImpactCooldown`,
 *     `linearDamping`, `angularDamping` — per-entity fields.  PhysicsSystem
 *     still handles the per-tick decrement + damping pass for these,
 *     because they live alongside the standard velocity integration.
 *
 * Dependencies injected via constructor:
 *   - ParticleSystem for merge-event glimmer bursts.
 *   - DropSystem for ammo drops + wave-scaled ammo type lookup.
 */
export class NebulaSystem {
    /**
     * Pending nebula tile regenerations.  Kept separate from
     * GameEngine.pendingRegens (which handles glass structures) so the
     * two regen cadences don't have to share a loop.
     */
    public pendingRegens: { entity: GameEntity; timer: number }[] = [];

    /**
     * Lazily-built per-frame nebula grid index used by the regen colour
     * rule.  Cleared at the top of each `update()` and rebuilt on demand
     * inside `tickRegens` so we pay the O(n) scan cost at most once per
     * frame.  Not meaningful outside an `update()` call.
     */
    private nebulaGridIndex: Map<number, GameEntity> | null = null;

    /**
     * Set to true whenever the active nebula-tile population changes
     * (destruction, regen revival, shard→tile transmutation, map reset).
     * Drives a lazy recompute of every tile's `nebulaNeighborCount` at
     * the top of the next update() so the interior-darken render rule
     * stays current without threading delta updates through every call
     * site.  Starts true so the first frame after map load initialises
     * counts from scratch.
     */
    private neighborCountsDirty: boolean = true;

    constructor(
        private particles: ParticleSystem,
        private drops: DropSystem,
    ) {}

    /**
     * Hard reset — called on game restart so a fresh run doesn't inherit
     * queued regens from the previous session's map.
     */
    public reset() {
        this.pendingRegens = [];
        this.nebulaGridIndex = null;
        this.neighborCountsDirty = true;
    }

    /**
     * Death dispatch entry point.  GameEngine.handleEntityDeath routes
     * NEBULA and NEBULA_SHARD entities here instead of the generic
     * drops / particle-burst path.  Nebulae are the only entity type
     * that doesn't spawn glass or asteroid shards on death — they
     * produce polygonal nebula shards + an occasional ammo drop.
     *
     * @param entities     Current map's entities list (shards are appended).
     * @param activeDrops  Drop-lookup cache (ammo drop registers here too).
     * @param entity       The NEBULA tile or NEBULA_SHARD that just died.
     * @param waveIndex    Current wave number — used to pick the ammo tier.
     */
    public handleDeath(
        entities: GameEntity[],
        activeDrops: GameEntity[],
        entity: GameEntity,
        waveIndex: number,
    ): void {
        // Both tiles and shards run through spawnShards (it early-returns
        // for shards — shards don't re-shatter, they just fade).
        this.spawnShards(entities, entity);

        // A destroyed tile removes itself from its neighbours' counts;
        // flag for recompute on the next frame.
        if (entity.type === EntityType.NEBULA) this.neighborCountsDirty = true;

        // Low-frequency ammo drop — the ONLY standard drop nebulae produce.
        // Roll is independent of the shard math so shard count/size is
        // unaffected; the drop (if any) is a bonus alongside the shards.
        if (Math.random() < NEBULA_CONSTANTS.AMMO_DROP_CHANCE) {
            const ammoType = this.drops.getAsteroidAmmoType(waveIndex);
            this.drops.spawnAmmoDrop(
                entities,
                activeDrops,
                entity.position,
                ammoType,
                NEBULA_CONSTANTS.AMMO_PER_NEBULA,
                entity.lastImpactVelocity,
            );
        }

        // Tile regeneration (when enabled) queues the shattered tile to
        // respawn at its original grid cell.  When disabled (current
        // default), tiles are gone permanently — the only path to new
        // tiles is shard → tile transmutation after enough shard mass
        // coalesces, keeping total tile population bounded.
        if (entity.type === EntityType.NEBULA && NEBULA_CONSTANTS.TILE_REGEN_ENABLED) {
            entity.regenProgress = 0;
            this.pendingRegens.push({ entity, timer: NEBULA_CONSTANTS.REGEN_DELAY });
        }
    }

    /**
     * Per-frame update — called from GameEngine.updateGameLogic at the
     * simulation dt.  Runs regen ticks first so newly-revived tiles
     * count as valid merge targets for the same-frame dynamics pass.
     */
    public update(
        entities: GameEntity[],
        dt: number,
        physics: PhysicsSystem,
    ): void {
        // Reset the lazy grid index — it'll be rebuilt inside tickRegens
        // if any regen finishes this frame and needs neighbour lookups.
        this.nebulaGridIndex = null;

        // Refresh every tile's neighbour count if something changed since
        // last frame (destroy / regen / transmute / reset).  Cheap — O(N)
        // over the active tiles, no recompute when nothing moved.  Only
        // clears the dirty flag once tiles actually exist, so a pre-map
        // update() doesn't starve the first real tile population of a
        // count pass.
        if (this.neighborCountsDirty) {
            if (this.recomputeNeighborCounts(entities) > 0) {
                this.neighborCountsDirty = false;
            }
        }

        // Stash the entities list so helper methods (glimmer, transmute)
        // can spawn new particles/entities without threading the list
        // through every private call site.
        this.currentFrameEntities = entities;

        try {
            this.tickRegens(entities, dt, physics);
            this.updateDynamics(entities, dt, physics);
        } finally {
            this.currentFrameEntities = null;
        }
    }

    /**
     * Count active nebula-tile neighbours (in the 6 hex cells around
     * each tile) and stash the count on each tile's
     * `nebulaNeighborCount` field.  0 = isolated, 6 = fully interior.
     * Used by the renderer to darken interior tiles vs. cluster edges.
     */
    private recomputeNeighborCounts(entities: GameEntity[]): number {
        const index = this.buildNebulaGridIndex(entities);
        this.nebulaGridIndex = index;
        let tilesProcessed = 0;
        for (let i = 0; i < entities.length; i++) {
            const e = entities[i];
            if (e.type !== EntityType.NEBULA) continue;
            if (e.nebulaGridCol === undefined || e.nebulaGridRow === undefined) continue;
            tilesProcessed++;
            if (!e.active) {
                e.nebulaNeighborCount = 0;
                continue;
            }
            let count = 0;
            const neighbors = TileGenerator.getHexNeighbors(e.nebulaGridCol, e.nebulaGridRow);
            for (const n of neighbors) {
                const key = (n.c << 16) | (n.r & 0xFFFF);
                if (index.has(key)) count++;
            }
            e.nebulaNeighborCount = count;
        }
        return tilesProcessed;
    }

    // Private method stubs — filled in by subsequent edits.

    /**
     * Shatter a nebula TILE into glass-style polygonal shards.  Shards
     * never re-shatter — they just fade when struck — so this early-
     * returns for NEBULA_SHARD parents.
     *
     * Generation math mirrors DropSystem.spawnGlassShards: power-law
     * area distribution, 4–6 vertex polygons, `size = radius * 4` so
     * physics feels solid.  Nebula-specific behaviour preserved:
     *   - rear-cone fan positioning (shards drift behind the striker)
     *   - tangent-rule spin (left-side CCW, right-side CW)
     *   - forward-drag velocity (parallel to striker direction)
     *   - composition cloned from parent (colour carries through)
     *   - fade-in timer scaled inversely with impact speed
     *   - effective-area split (HEX_AREA / shardCount per shard) so
     *     the 4–6 children together carry exactly one tile of mass
     *     back toward the next transmutation.  Visual sprite size is
     *     derived from this field at render time — no explicit
     *     sprite-size state is stored on the shard itself.
     */
    private spawnShards(entities: GameEntity[], parent: GameEntity): void {
        if (parent.type === EntityType.NEBULA_SHARD) return;

        const parentDiameter = Math.max(parent.size.x, parent.size.y);
        const parentRadius   = parentDiameter / 2;
        // Parent area budget for the shard power-law distribution.  We
        // intentionally use the glass-shard convention (TILE_HALF² = 121
        // for TILE_HALF = 11) regardless of the actual nebula tile size
        // so the resulting shards are the SAME scale as glass shards —
        // small enough to avoid mass re-merging on spawn and small
        // enough that the debug polygon outline reads as a polygon and
        // not a large circle.  Using the nebula tile's actual radius²
        // produced ~9-unit radii and rapid merges that wiped polygons.
        const GLASS_TILE_HALF = 11;
        const parentArea = GLASS_TILE_HALF * GLASS_TILE_HALF;
        const MIN_RADIUS = 2; // don't spawn sub-pixel shards

        // 2–3 shards per shatter — fewer, chunkier pieces than glass
        // tiles produce.  Nebula tiles read as soft cloud blobs that
        // come apart slowly into a couple of large fragments rather
        // than a glittery shower of small debris.  Combined with the
        // area-proportional sprite formula in RenderSystem, each fresh
        // shard draws at sqrt(1/count) × TILE_SPRITE_WORLD_SIZE — so
        // 2-shard splits are 0.71× tile size, 3-shard splits 0.58×.
        const count = 2 + Math.floor(Math.random() * 2);

        // Power-law area distribution normalised to the parent's area.
        const alpha    = 1.0;
        const rawAreas = Array.from({ length: count }, () => Math.pow(Math.random(), alpha));
        const rawSum   = rawAreas.reduce((s, a) => s + a, 0);
        const radii: number[] = rawAreas
            .map(a => Math.sqrt((a / rawSum) * parentArea))
            .filter(r => r >= MIN_RADIUS);

        if (radii.length < 1) return;

        const composition = parent.nebulaColorComposition;

        // Shard sprite size is derived from `nebulaTileArea` at render
        // time (TILE_SPRITE_WORLD_SIZE × sqrt(area / HEX_AREA)), so we
        // no longer need to carry an explicit sprite world-size on each
        // shard — the effective area field does double duty.

        // Striker direction (forward vector).  Canvas is y-down so a
        // positive z-component of cross(forward, spawn-direction) means
        // the shard is on the striker's visual right.
        const iv = parent.lastImpactVelocity;
        const impactSpeed = iv ? Math.sqrt(iv.x * iv.x + iv.y * iv.y) : 0;
        let fx = 1, fy = 0;
        if (iv && impactSpeed > 0.001) {
            fx = iv.x / impactSpeed;
            fy = iv.y / impactSpeed;
        }

        const spinK = Math.min(
            NEBULA_CONSTANTS.MAX_SPIN,
            1 + impactSpeed * NEBULA_CONSTANTS.SPIN_PER_UNIT_SPEED,
        );

        // Effective birth fade-in duration — matches the rateScale
        // PhysicsSystem used for the parent's fade-out, so destruction
        // and rebirth animations feel synchronised for the same hit.
        const shardRateScale = nebulaFadeRateScale(impactSpeed);
        const shardSpawnDuration = NEBULA_CONSTANTS.FADE_IN_DURATION / shardRateScale;

        // REARWARD fan: children spawn behind the striker, spread
        // symmetrically across 2 × FAN_HALF_ANGLE.
        const fan  = NEBULA_CONSTANTS.FAN_HALF_ANGLE;
        const shardCount = radii.length;
        const step = shardCount > 1 ? (2 * fan) / (shardCount - 1) : 0;
        // Use parent-tile radius for the spawn offset (not shard radius)
        // so every child spawns well clear of the tile footprint.
        const offsetMag = parentRadius * NEBULA_CONSTANTS.SHARD_SPAWN_OFFSET_RATIO;

        for (let i = 0; i < shardCount; i++) {
            const radius = radii[i];

            // Glass-shard polygon generation.
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
            const size = radius * 4; // diameter with a bit of slack for physics feel

            // Rear-cone angle: π + (−fan … +fan) relative to forward.
            const offsetAngle = Math.PI + (shardCount > 1 ? -fan + step * i : 0);
            const cosA = Math.cos(offsetAngle);
            const sinA = Math.sin(offsetAngle);
            const dx = fx * cosA - fy * sinA;
            const dy = fx * sinA + fy * cosA;

            const spawnPos = { x: parent.position.x + dx * offsetMag, y: parent.position.y + dy * offsetMag };
            wrapPosition(spawnPos);
            const spawnX = spawnPos.x;
            const spawnY = spawnPos.y;

            // Tangent-rule side for spin direction.
            const cross = fx * dy - fy * dx;
            const spinSign = cross > 0.01 ? 1
                            : cross < -0.01 ? -1
                            : (Math.random() < 0.5 ? 1 : -1);
            const rotationSpeed = spinSign * spinK;

            // "Dragged along" velocity model: parallel component dominates,
            // perpendicular component biased to the shard's tangent side.
            const parallelSpeed = Math.max(
                NEBULA_CONSTANTS.MIN_PARALLEL_SPEED,
                impactSpeed * NEBULA_CONSTANTS.FORWARD_DRAG_FACTOR,
            );
            const perpSpeed = impactSpeed * NEBULA_CONSTANTS.PERP_SCATTER_FACTOR;
            const perpSign = cross > 0.01 ? 1 : cross < -0.01 ? -1 : 0;
            const perpX = -fy * perpSign * perpSpeed;
            const perpY =  fx * perpSign * perpSpeed;
            const velX = fx * parallelSpeed + perpX;
            const velY = fy * parallelSpeed + perpY;

            // Effective area carried by each shard toward the next
            // transmutation.  Splitting HEX_AREA equally across all
            // spawned shards gives net-zero tile balance: one shatter
            // produces exactly 1 hex of effective mass, and when all
            // those shards merge back together the accumulation hits
            // HEX_AREA and transmutes into one new tile.  Independent
            // of the shard's visual polygon radius so shards can stay
            // glass-style small without blocking the transmutation path.
            const effectiveAreaPerShard = HEX_AREA / shardCount;

            entities.push({
                id:              nextId('nebula_shard'),
                type:            EntityType.NEBULA_SHARD,
                shardType:      'nebula',
                position:       { x: spawnX, y: spawnY },
                velocity:       { x: velX, y: velY },
                size:           { x: size, y: size },
                rotation:        Math.random() * Math.PI * 2,
                rotationSpeed,
                color:           composition ? blendCompositionToHex(composition) : (parent.color || NEBULA_CONSTANTS.DEFAULT_HEX),
                active:          true,
                health:          1,
                maxHealth:       1,
                mass:            size,
                polygonPoints:   pts,
                sprite:          parent.sprite,
                nebulaColorComposition: composition ? cloneComposition(composition) : undefined,
                nebulaTileArea:  effectiveAreaPerShard,
                nebulaGridCol:   parent.nebulaGridCol,
                nebulaGridRow:   parent.nebulaGridRow,
                linearDamping:   NEBULA_CONSTANTS.LINEAR_DAMPING,
                angularDamping:  NEBULA_CONSTANTS.ANGULAR_DAMPING,
                nebulaSpawnTimer:    shardSpawnDuration,
                nebulaSpawnDuration: shardSpawnDuration,
                // Newly-spawned shards cannot merge for this many seconds
                // — keeps them visible as distinct polygons for a beat
                // before the gravity/merge pass starts coalescing them.
                nebulaMergeCooldown: NEBULA_CONSTANTS.MERGE_COOLDOWN,
            });
        }
    }
    /**
     * Per-frame gravity + merge pass for NEBULA_SHARDs.
     *
     * Only NEBULA_SHARD entities participate — nebula TILES are immutable
     * sinks that never grow or absorb.  New tiles are born by shard
     * coalescence: when two shards merge and the combined disc area
     * reaches canonical HEX_AREA, the merged shard transmutes into a
     * brand-new NEBULA tile at the nearest clear grid cell.
     *
     * Each shard is pulled toward the nearest larger-or-equal
     * neighbouring shard within GRAVITY_RANGE.  Equal-size pairs merge
     * too — the `mergedThisFrame` set prevents duplicate processing
     * within a single frame, and the id check in the inner loop handles
     * the rare exact-tie case without infinite loops.
     *
     * Broadphase uses a cell grid over shards to avoid O(n²).
     */
    private updateDynamics(
        entities: GameEntity[],
        dt: number,
        physics: PhysicsSystem,
    ): void {
        // Collect active nebula shards ONLY.  Tiles aren't merge targets
        // and don't need to be spatially indexed for this pass.  Fading
        // shards are skipped — they're in their death animation and
        // shouldn't iterate as sources or be valid merge targets.
        const all: GameEntity[] = [];
        for (let i = 0; i < entities.length; i++) {
            const e = entities[i];
            if (!e.active) continue;
            if (e.nebulaFadeTimer !== undefined) continue;
            if (e.type === EntityType.NEBULA_SHARD) {
                all.push(e);
            }
        }
        if (all.length < 2) return;

        // Spatial hash over GRAVITY_RANGE cells — cell coords wrap modulo
        // the grid dimension so shards near a seam share a bucket with
        // merge candidates on the other side.
        const CELL = NEBULA_CONSTANTS.GRAVITY_RANGE;
        const COLS = Math.ceil(MAP_WIDTH  / CELL);
        const ROWS = Math.ceil(MAP_HEIGHT / CELL);
        const keyFor = (cx: number, cy: number) => {
            const wx = ((cx % COLS) + COLS) % COLS;
            const wy = ((cy % ROWS) + ROWS) % ROWS;
            return (wx << 16) | (wy & 0xFFFF);
        };
        const grid = new Map<number, number[]>();
        for (let i = 0; i < all.length; i++) {
            const e = all[i];
            const cx = Math.floor(e.position.x / CELL);
            const cy = Math.floor(e.position.y / CELL);
            let cell = grid.get(keyFor(cx, cy));
            if (!cell) { cell = []; grid.set(keyFor(cx, cy), cell); }
            cell.push(i);
        }

        const GRAV_RANGE_SQ = CELL * CELL;
        const GRAV_K        = NEBULA_CONSTANTS.GRAVITY_STRENGTH;
        const GRAV_MIN      = NEBULA_CONSTANTS.GRAVITY_MIN_DIST;
        const MERGE_K       = NEBULA_CONSTANTS.MERGE_PROXIMITY_K;

        // Per-frame set: "at most one merge per target per frame" keeps
        // the three children of a single shatter from all stacking into
        // the same nearest tile.
        const mergedThisFrame = new Set<GameEntity>();

        for (let i = 0; i < all.length; i++) {
            const shard = all[i];
            if (!shard.active) continue;
            if (shard.type !== EntityType.NEBULA_SHARD) continue;

            // Merge cooldown: freshly-spawned (or recently-merged)
            // shards skip both gravity pull AND merge checks until the
            // cooldown expires, keeping them visible as distinct
            // polygons for a beat before the coalescence pass touches
            // them.
            if ((shard.nebulaMergeCooldown ?? 0) > 0) continue;

            const shardR = Math.max(shard.size.x, shard.size.y) / 2;

            // Find nearest larger-or-equal neighbour across the 3×3 block.
            const acx = Math.floor(shard.position.x / CELL);
            const acy = Math.floor(shard.position.y / CELL);

            let bestTarget: GameEntity | null = null;
            let bestDistSq = Infinity;

            for (let ncx = acx - 1; ncx <= acx + 1; ncx++) {
                for (let ncy = acy - 1; ncy <= acy + 1; ncy++) {
                    const cell = grid.get(keyFor(ncx, ncy));
                    if (!cell) continue;
                    for (let k = 0; k < cell.length; k++) {
                        const j = cell[k];
                        if (j === i) continue;
                        const target = all[j];
                        if (!target.active) continue;
                        if (mergedThisFrame.has(target)) continue;
                        // Target also honours its own merge cooldown.
                        if ((target.nebulaMergeCooldown ?? 0) > 0) continue;
                        const targetR = Math.max(target.size.x, target.size.y) / 2;
                        if (targetR < shardR) continue;

                        const dx = wrapDeltaX(shard.position.x, target.position.x);
                        const dy = wrapDeltaY(shard.position.y, target.position.y);
                        const distSq = dx * dx + dy * dy;
                        if (distSq > GRAV_RANGE_SQ) continue;
                        if (distSq < bestDistSq) {
                            bestDistSq = distSq;
                            bestTarget = target;
                        }
                    }
                }
            }

            if (!bestTarget) continue;

            const dx = wrapDeltaX(shard.position.x, bestTarget.position.x);
            const dy = wrapDeltaY(shard.position.y, bestTarget.position.y);
            const dist = Math.sqrt(bestDistSq);
            if (dist < 0.0001) continue;

            const targetR   = Math.max(bestTarget.size.x, bestTarget.size.y) / 2;
            const mergeDist = (targetR + shardR) * MERGE_K;

            if (dist <= mergeDist) {
                this.mergeNebulas(bestTarget, shard);
                mergedThisFrame.add(bestTarget);
                // Post-merge: if the grown shard is now large enough to
                // form a tile (disc area ≥ canonical hex area), try
                // transmuting it to a brand-new NEBULA tile.
                this.tryTransmuteShardToTile(entities, bestTarget, physics);
                continue;
            }

            // Strong linear-radial gravity: force ∝ 1 / max(dist, MIN_DIST).
            // Combined with the damping pass this produces a steady
            // terminal drift toward the target rather than runaway
            // acceleration.
            const effDist = Math.max(dist, GRAV_MIN);
            const accel   = (GRAV_K * dt) / effDist;
            const invDist = 1 / dist;
            shard.velocity.x += (dx * invDist) * accel;
            shard.velocity.y += (dy * invDist) * accel;
        }
    }
    /**
     * Absorb a smaller nebula shard into a larger-or-equal nebula shard.
     * Only called on NEBULA_SHARD pairs — tiles are not merge targets.
     *
     *  - larger.size grows so its disc area gains the smaller's area
     *  - colour composition is blended weighted by each shard's area
     *  - polygonPoints is cleared: once a shard has absorbed another
     *    it transitions from "glass-style polygonal fragment" back to
     *    "circular cloud blob", so the debug view draws an implicit
     *    circle from `size` matching the grown hit shape
     *  - smaller becomes inactive; a glimmer burst plays at the
     *    absorption point as the merge animation
     *
     * Post-merge, updateDynamics checks whether the grown shard should
     * transmute into a fresh NEBULA tile via tryTransmuteShardToTile.
     */
    private mergeNebulas(larger: GameEntity, smaller: GameEntity): void {
        const largeR = Math.max(larger.size.x, larger.size.y) / 2;
        const smallR = Math.max(smaller.size.x, smaller.size.y) / 2;
        const largeArea = Math.PI * largeR * largeR;
        const smallArea = Math.PI * smallR * smallR;
        const newArea = largeArea + smallArea;
        const newDiameter = Math.sqrt(newArea / Math.PI) * 2;

        larger.size.x = newDiameter;
        larger.size.y = newDiameter;
        larger.mass   = newDiameter;

        // Accumulate the effective area carried by both shards onto
        // the larger.  This is what drives transmutation in
        // tryTransmuteShardToTile — decoupled from the physical disc
        // area so shards can stay glass-style small while still
        // condensing back to tiles at a 1-tile-in → 1-tile-out rate.
        larger.nebulaTileArea = (larger.nebulaTileArea ?? 0)
                              + (smaller.nebulaTileArea ?? 0);

        // Arm a fresh merge cooldown on the grown shard so it doesn't
        // immediately chain-merge with another neighbour the same frame.
        // Spreads visible merge events over seconds instead of a burst.
        larger.nebulaMergeCooldown = NEBULA_CONSTANTS.MERGE_COOLDOWN;

        // Regenerate the polygon at the new size so merged shards keep
        // the glass-shard-style polygon outline in debug view instead
        // of collapsing to a circle fallback.  Uses the same 4–6 vertex
        // power-law math as spawnShards with a radius derived from the
        // grown disc size (newDiameter / 2 × slack factor to match the
        // loose polygon-inside-size convention used at spawn).
        const polyRadius = newDiameter / 2 * 0.5; // keeps shape inside bbox
        const numPoints = 4 + Math.floor(Math.random() * 3);
        const rawPts: { angle: number; r: number }[] = [];
        for (let j = 0; j < numPoints; j++) {
            const baseAngle = (j / numPoints) * Math.PI * 2;
            const jitter    = (Math.random() - 0.5) * (Math.PI / numPoints) * 0.25;
            rawPts.push({ angle: baseAngle + jitter, r: polyRadius * (0.6 + Math.random() * 0.55) });
        }
        rawPts.sort((a, b) => a.angle - b.angle);
        larger.polygonPoints = rawPts.map(p => ({
            x: Math.cos(p.angle) * p.r,
            y: Math.sin(p.angle) * p.r,
        }));

        // Blend colour compositions weighted by area; larger dominates.
        larger.nebulaColorComposition = blendCompositions(
            larger.nebulaColorComposition, largeArea,
            smaller.nebulaColorComposition, smallArea,
        );
        larger.color = blendCompositionToHex(larger.nebulaColorComposition);
        // Composition just changed — refresh the render-time cache so the
        // next frame's draw doesn't pull a stale tint.  Reusing
        // larger.color avoids a redundant blendCompositionToHex call.
        larger.nebulaBlendedHex = larger.color;
        // tinted-sprite key encodes `${src}|${hex}` — drop it so the next
        // render rebuilds it against the new blended hex and re-links to
        // the freshly-rendered tinted canvas.
        larger.nebulaTintedKey = undefined;

        // Glittery glimmer burst scattered within a radius matching the
        // smaller shard — the subtle merge feedback.
        const tint = blendCompositionToHex(larger.nebulaColorComposition);
        const glimmerR = Math.max(smaller.size.x, smaller.size.y) * 0.5;
        this.spawnGlimmerAtMergePoint(smaller.position, glimmerR, tint);

        // Smaller fades out over top of the already-grown larger shard
        // — no fade-in on larger (it just grows in place), so the eye
        // reads the smaller dissolving INTO the new combined shard
        // rather than popping out with the result flashing in from
        // alpha 0.  Compaction removes it once the fade completes.
        smaller.nebulaFadeTimer    = NEBULA_CONSTANTS.FADE_DURATION;
        smaller.nebulaFadeDuration = NEBULA_CONSTANTS.FADE_DURATION;
    }

    // Helper used by mergeNebulas — stashes the current frame's
    // entities list so spawnGlimmer can hand it to ParticleSystem
    // without threading the list through every private method.
    private currentFrameEntities: GameEntity[] | null = null;
    private spawnGlimmerAtMergePoint(position: Vector2, radius: number, tint: string): void {
        if (!this.currentFrameEntities) return;
        this.spawnGlimmer(this.currentFrameEntities, position, radius, tint);
    }
    /**
     * If the given nebula shard has grown large enough (disc area ≥
     * HEX_AREA), transmute it into a brand-new NEBULA tile at the nearest
     * unoccupied grid cell.  Returns true if the transmutation succeeded.
     *
     * The shard's accumulated colour composition carries over to the
     * new tile, so the palette that multiple shards mixed together
     * persists into the condensed tile.
     *
     * If no candidate cell is clear (the shard's own cell and all 6
     * neighbours are occupied), the transmutation aborts and the shard
     * stays as a shard — a later frame may find a clear cell as it drifts.
     */
    private tryTransmuteShardToTile(
        entities: GameEntity[],
        shard: GameEntity,
        physics: PhysicsSystem,
    ): boolean {
        if (shard.type !== EntityType.NEBULA_SHARD) return false;

        // Effective-area threshold.  Each shard carries a
        // `nebulaTileArea` set at spawn (= HEX_AREA / shardCount) that
        // accumulates through merges.  Transmutation fires when a
        // shard's accumulated effective area reaches HEX_AREA — i.e.
        // one full tile's worth of shatter mass has coalesced back
        // together.  Decoupled from physical disc area so shards can
        // stay small and glass-style without blocking the cycle.
        const effectiveArea = shard.nebulaTileArea ?? 0;
        if (effectiveArea < HEX_AREA) return false;

        // Candidate cells: the shard's current hex cell + 6 neighbours,
        // sorted by distance so we snap to the nearest free slot.
        const origin = pixelToHexCoord(shard.position.x, shard.position.y);
        const candidates: { c: number; r: number; distSq: number }[] = [];
        const pushCandidate = (c: number, r: number) => {
            const p = hexCoordToPixel(c, r);
            const dx = wrapDeltaX(shard.position.x, p.x);
            const dy = wrapDeltaY(shard.position.y, p.y);
            candidates.push({ c, r, distSq: dx * dx + dy * dy });
        };
        pushCandidate(origin.c, origin.r);
        for (const n of TileGenerator.getHexNeighbors(origin.c, origin.r)) {
            pushCandidate(n.c, n.r);
        }
        candidates.sort((a, b) => a.distSq - b.distSq);

        let chosen: { c: number; r: number } | null = null;
        for (const cand of candidates) {
            if (this.isGridCellFreeForNebula(entities, cand.c, cand.r, physics)) {
                chosen = cand;
                break;
            }
        }
        if (!chosen) return false;

        // Create the new tile at the chosen grid cell, carrying over
        // the shard's colour composition as the tile's palette.
        const composition = shard.nebulaColorComposition
            ? cloneComposition(shard.nebulaColorComposition)
            : undefined;
        const tile = TileGenerator.createNebulaTileEntity(
            chosen.c,
            chosen.r,
            composition ?? [{ hex: shard.color || NEBULA_CONSTANTS.DEFAULT_HEX, weight: 1 }],
            HEX_AREA,
        );

        entities.push(tile);
        physics.addStaticEntity(tile);

        // A newly-transmuted tile adds itself to its neighbours' counts.
        this.neighborCountsDirty = true;

        // New tile appears immediately at full opacity — the parent
        // shard fades out over top of it, so the eye reads the shard
        // dissolving INTO an already-present tile rather than a flash
        // where both source and destination cross through zero alpha.
        // Shard collapses into the new tile — fade it out instead of
        // instant-deactivating so the hand-off is a smooth dissolve.
        shard.nebulaFadeTimer    = NEBULA_CONSTANTS.FADE_DURATION;
        shard.nebulaFadeDuration = NEBULA_CONSTANTS.FADE_DURATION;
        return true;
    }

    /**
     * Check whether the given grid cell (odd-r offset) has no active or
     * regenerating nebula tile already occupying it, and is also clear
     * of static-grid collision geometry (glass tiles etc.).
     */
    private isGridCellFreeForNebula(
        entities: GameEntity[],
        col: number,
        row: number,
        physics: PhysicsSystem,
    ): boolean {
        const pos = hexCoordToPixel(col, row);

        // Any nebula entity pinned to this grid cell — active or
        // regenerating.
        for (let i = 0; i < entities.length; i++) {
            const e = entities[i];
            if (e.type !== EntityType.NEBULA) continue;
            if (e.nebulaGridCol === col && e.nebulaGridRow === row) return false;
        }

        // Any other static geometry (glass tiles) overlapping this cell
        // — check a radius slightly smaller than the hex so touching
        // neighbours don't register as collisions.
        if (!physics.isPositionClear(pos.x, pos.y, HEX_SIZE * 0.5)) return false;
        return true;
    }
    /**
     * Deterministic, neighbourhood-aware colour rule for regenerating
     * nebula tiles.  Works in hue space over the full 360° wheel — all
     * hues are available (blue / indigo / violet / pink / red / yellow
     * / green).  All hue arithmetic is circular (unit-vector sums +
     * shortest-arc distances) so wraparound is handled correctly.
     *
     * Algorithm:
     *   1. Read old hue from the tile's previous composition.
     *   2. Gather 6 neighbour hues (active, non-fading NEBULA tiles)
     *      from the grid index, weighted by each neighbour's disc area.
     *   3. Compute the circular area-weighted average of neighbour hues.
     *   4. Circularly lerp between old and neighbour average based on
     *      tile isolation (isolated tiles keep their old hue; interior
     *      tiles adopt the neighbour average).
     *   5. Enforce a minimum hue shift — if the rule's natural output
     *      lands within REGEN_MIN_HUE_SHIFT° of the old hue, step
     *      forward by exactly that minimum in a deterministic direction
     *      chosen by grid parity.
     *   6. Normalise and return a single-stop composition.
     *
     * Fully deterministic — identical map state yields identical regen
     * colours, so the cloud evolves along a predictable neighbourhood
     * walk rather than into RNG noise.
     */
    private computeRegeneratedComposition(
        tile: GameEntity,
    ): NebulaColorStop[] {
        // Derive the tile's previous hue; fall back to a fresh random
        // hue if the tile somehow has no composition.
        const oldComp = tile.nebulaColorComposition;
        const oldHue = clampHueToPalette(
            oldComp && oldComp[0]
                ? hexToHueDeg(oldComp[0].hex)
                : hexToHueDeg(randomNebulaComposition()[0].hex),
        );

        // Collect active-neighbour hues with area weights.
        const index = this.nebulaGridIndex ?? new Map<number, GameEntity>();
        const neighborEntries: Array<{ hue: number; weight: number }> = [];
        if (tile.nebulaGridCol !== undefined && tile.nebulaGridRow !== undefined) {
            const neighbors = TileGenerator.getHexNeighbors(tile.nebulaGridCol, tile.nebulaGridRow);
            for (const n of neighbors) {
                const key = (n.c << 16) | (n.r & 0xFFFF);
                const nTile = index.get(key);
                if (!nTile || !nTile.nebulaColorComposition || nTile === tile) continue;
                const hex = nTile.nebulaColorComposition[0]?.hex;
                if (!hex) continue;
                const nHue = clampHueToPalette(hexToHueDeg(hex));
                const r = Math.max(nTile.size.x, nTile.size.y) / 2;
                neighborEntries.push({ hue: nHue, weight: Math.PI * r * r });
            }
        }

        // Circular weighted average — falls back to old hue when there
        // are no neighbours or opposing hues cancel to zero.
        const avgNeighborHue = circularHueAverage(neighborEntries) ?? oldHue;

        // Isolation-based circular lerp between old and neighbour average.
        const NUM_NEIGHBORS = 6;
        const emptyCount = NUM_NEIGHBORS - neighborEntries.length;
        const oldWeight = emptyCount / NUM_NEIGHBORS;
        const neighborWeight = 1 - oldWeight;
        let targetHue = circularLerpHue(oldHue, oldWeight, avgNeighborHue, neighborWeight);

        // Enforce minimum hue shift so every regen is visibly distinct.
        const minShift = NEBULA_CONSTANTS.REGEN_MIN_HUE_SHIFT;
        if (circularHueDistance(targetHue, oldHue) < minShift) {
            // Deterministic direction: parity of (col + row) picks + or −.
            // Adjacent tiles step in opposite directions, producing a
            // natural wave pattern across successive regens.
            const sign = (((tile.nebulaGridCol ?? 0) + (tile.nebulaGridRow ?? 0)) & 1) === 0 ? 1 : -1;
            targetHue = clampHueToPalette(oldHue + sign * minShift);
        }

        return [{ hex: paletteHueToHex(targetHue), weight: 1 }];
    }
    /**
     * Advance pending nebula-tile regen timers.  When a timer expires:
     *   - Revive the tile (active=true, health=max, regenProgress=undef)
     *   - Compute a rule-based colour (neighbourhood-aware, forced shift)
     *   - Reset the fade-in timer so the tile slowly materialises
     *   - Re-add to the physics static grid so collisions start hitting
     *   - Update the grid index so this tile counts as a neighbour for
     *     any later regens in the same frame (cluster-wide shatter)
     */
    private tickRegens(
        entities: GameEntity[],
        dt: number,
        physics: PhysicsSystem,
    ): void {
        if (this.pendingRegens.length === 0) return;

        const delay = NEBULA_CONSTANTS.REGEN_DELAY;

        for (let i = this.pendingRegens.length - 1; i >= 0; i--) {
            const regen = this.pendingRegens[i];
            regen.timer -= dt;
            regen.entity.regenProgress = 1 - (regen.timer / delay);

            if (regen.timer <= 0) {
                regen.entity.health = regen.entity.maxHealth;
                regen.entity.active = true;
                regen.entity.regenProgress = undefined;

                // Tiles never grow (only shards do), so size is already
                // canonical.  Rule-based colour regeneration reads the
                // regenerating tile's 6 hex neighbours and blends their
                // compositions with the old tile's composition based on
                // isolation level — interior tiles smooth toward the
                // cluster average, edge tiles drift less, isolated
                // tiles keep their old hue exactly.
                if (!this.nebulaGridIndex) {
                    this.nebulaGridIndex = this.buildNebulaGridIndex(entities);
                }
                regen.entity.nebulaColorComposition = this.computeRegeneratedComposition(regen.entity);
                regen.entity.color = regen.entity.nebulaColorComposition[0].hex;
                // Composition changed on regen — drop the render cache so
                // the regenerated tile picks up the new neighbourhood-blend
                // colour on its next draw.
                regen.entity.nebulaBlendedHex = undefined;

                // Fade in slowly instead of popping — no glimmer burst.
                regen.entity.nebulaSpawnTimer    = NEBULA_CONSTANTS.FADE_IN_DURATION;
                regen.entity.nebulaSpawnDuration = NEBULA_CONSTANTS.FADE_IN_DURATION;

                // Re-add to the static grid so collisions start hitting again.
                physics.addStaticEntity(regen.entity);
                this.pendingRegens.splice(i, 1);
                // A revived tile changes its neighbours' counts.
                this.neighborCountsDirty = true;

                // The just-regenerated tile should now count as a
                // neighbour for any later regens in this same frame.
                if (regen.entity.nebulaGridCol !== undefined
                    && regen.entity.nebulaGridRow !== undefined) {
                    const key = (regen.entity.nebulaGridCol << 16)
                              | (regen.entity.nebulaGridRow & 0xFFFF);
                    this.nebulaGridIndex.set(key, regen.entity);
                }
            }
        }
    }
    /**
     * Subtle glittery glimmer burst used for nebula merge / transmute /
     * regen feedback.  Spawns two small passes of tiny additive
     * particles scattered within a radius around the centre point:
     *   - 3 white highlight motes
     *   - 4 tint-coloured softer motes
     *
     * Kept deliberately sparse so cloud events read as a quiet twinkle
     * rather than a bright particle burst.
     */
    private spawnGlimmer(
        entities: GameEntity[],
        position: Vector2,
        radius: number,
        tint: string,
    ): void {
        // White highlight pass — sparse punctuation points
        this.particles.spawn(entities, position, 3, '#ffffff', {
            speedMin: 0.1, speedMax: 0.5,
            sizeMin: 0.3, sizeMax: 0.9,
            lifetimeMin: 0.4, lifetimeMax: 0.8,
            positionJitter: radius,
        });
        // Tinted pass — softer, slightly larger coloured motes
        this.particles.spawn(entities, position, 4, tint, {
            speedMin: 0.1, speedMax: 0.4,
            sizeMin: 0.4, sizeMax: 1.1,
            lifetimeMin: 0.5, lifetimeMax: 1.0,
            positionJitter: radius * 1.2,
        });
    }

    /**
     * Build a lazy grid index of active, non-fading NEBULA tiles keyed
     * by packed (col, row) coordinates.  Used by the regen colour rule
     * to read each regenerating tile's 6 hex neighbours in O(1).
     *
     * One scan per frame at worst — memoised via `this.nebulaGridIndex`
     * which is cleared at the top of each `update()`.
     */
    private buildNebulaGridIndex(entities: GameEntity[]): Map<number, GameEntity> {
        const index = new Map<number, GameEntity>();
        for (let k = 0; k < entities.length; k++) {
            const e = entities[k];
            if (e.type !== EntityType.NEBULA) continue;
            if (!e.active) continue;
            if (e.nebulaFadeTimer !== undefined) continue;
            if (e.nebulaGridCol === undefined || e.nebulaGridRow === undefined) continue;
            const key = (e.nebulaGridCol << 16) | (e.nebulaGridRow & 0xFFFF);
            index.set(key, e);
        }
        return index;
    }
}
