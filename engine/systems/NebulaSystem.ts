import { GameEntity, EntityType, NebulaColorStop, Vector2 } from '../../types';
import { NEBULA_CONSTANTS, nebulaFadeRateScale, SHARD_VARIANTS, COLORS } from '../../constants';
import {
    TileGenerator,
    HEX_AREA,
} from '../maps/TileGenerator';
import {
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
 * introduced by the engine-upgrade PR.  Stage 2 of the shard-system
 * overhaul moved the regen queue out into ShardSystem (the unified
 * queue handles both STRUCTURE and NEBULA tiles); NebulaSystem now
 * exposes `onNeighborhoodBlendRegen` as the variant-completion hook
 * ShardSystem invokes for nebula-tile regens.
 *
 * State that stays on NebulaSystem:
 *   - `nebulaGridIndex` (lazy per-frame index over active tiles)
 *   - `neighborCountsDirty` flag for the interior-darken render rule
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
     * Lazily-built per-frame nebula grid index used by the regen colour
     * rule.  Cleared at the top of each `update()` and rebuilt on demand
     * inside `onNeighborhoodBlendRegen` (Stage 2 adapter hook) so we pay
     * the O(n) scan cost at most once per frame.  Not meaningful outside
     * an `update()` call or the regen-completion path.
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
     * stale state from the previous session's map.  (Stage 2: the regen
     * queue is now owned by ShardSystem; this only resets nebula-local
     * state — neighbour-counts dirty flag and grid index.)
     */
    public reset() {
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
     */
    public handleDeath(
        entities: GameEntity[],
        activeDrops: GameEntity[],
        entity: GameEntity,
    ): void {
        // Stage 3: shatter is owned by ShardSystem and is invoked
        // directly from GameEngine.handleEntityDeath via
        // `this.shards.shatter(entity, entities)`.  This system
        // only handles the nebula-specific bookkeeping +
        // ammo-drop roll.

        // A destroyed tile removes itself from its neighbours' counts;
        // flag for recompute on the next frame.
        if (entity.shardVariant === 'nebula-tile') this.neighborCountsDirty = true;

        // Low-frequency ammo drop — the ONLY standard drop nebulae produce.
        // Roll is independent of the shard math so shard count/size is
        // unaffected; the drop (if any) is a bonus alongside the shards.
        if (Math.random() < NEBULA_CONSTANTS.AMMO_DROP_CHANCE) {
            this.drops.spawnAmmoDrop(
                entities,
                activeDrops,
                entity.position,
                NEBULA_CONSTANTS.AMMO_PER_NEBULA,
                entity.lastImpactVelocity,
            );
        }

        // Tile-regen queueing is now owned by ShardSystem (Stage 2).
        // GameEngine.handleEntityDeath calls `this.shards.queueRegen(entity)`
        // unconditionally for shard-family deaths; the variant config
        // (SHARD_VARIANTS['nebula-tile'].regen) decides whether the
        // queue actually accepts the entity.  When NEBULA_CONSTANTS
        // .TILE_REGEN_ENABLED is false the variant's regen.kind
        // collapses to 'none' and queueRegen is a no-op — matches
        // today's "tiles are gone permanently; new tiles only appear
        // via shard→tile transmutation" semantics.
    }

    /**
     * Per-frame update — called from GameEngine.updateGameLogic.
     * Stage 4: this system no longer owns regen (Stage 2) or shard
     * gravity-merge (Stage 4) — both are in ShardSystem.update.  The
     * remaining responsibility is the lazy nebula-grid index + the
     * interior-darken neighbour-count refresh that drives the
     * render rule.  Kept here because both depend on the active-
     * tile population (visual-only, not gameplay).
     */
    public update(
        entities: GameEntity[],
        _dt: number,
        _physics: PhysicsSystem,
    ): void {
        // Reset the lazy grid index — onNeighborhoodBlendRegen
        // (Stage 2 regen-completion hook) and onComposeNebulaShard
        // (Stage 4 merge-completion hook) rebuild it on demand.
        this.nebulaGridIndex = null;

        // Refresh every tile's neighbour count if something changed
        // since last frame.  Cheap — O(N) over active tiles, no
        // recompute when nothing moved.
        if (this.neighborCountsDirty) {
            if (this.recomputeNeighborCounts(entities) > 0) {
                this.neighborCountsDirty = false;
            }
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
            if (e.shardVariant !== 'nebula-tile') continue;
            if (e.nebulaGridCol === undefined || e.nebulaGridRow === undefined) continue;
            tilesProcessed++;
            if (!e.active) {
                if (e.nebulaNeighborCount !== 0) {
                    e.nebulaNeighborCount = 0;
                    e.nebulaCachedTinted = undefined;
                }
                continue;
            }
            let count = 0;
            const neighbors = TileGenerator.getHexNeighbors(e.nebulaGridCol, e.nebulaGridRow);
            for (const n of neighbors) {
                const key = (n.c << 16) | (n.r & 0xFFFF);
                if (index.has(key)) count++;
            }
            // Neighbour count drives the interior-darken render rule, so
            // any change invalidates the fast-path tinted canvas (built
            // against the old darkened hex).
            if (e.nebulaNeighborCount !== count) {
                e.nebulaNeighborCount = count;
                e.nebulaCachedTinted = undefined;
            }
        }
        return tilesProcessed;
    }

    // spawnShards moved to ShardSystem.shatter (Stage 3 of shard-system
    // overhaul).  See engine/systems/ShardSystem.ts.


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
    /**
     * Once a nebula shard has accumulated HEX_AREA of effective
     * mass (via the dedicated coalesce pass), spawn a single mobile
     * glass-shard at the nebula's position and fade the source
     * nebula-shard out.  Glass is the next rung up the material
     * tier chain (nebula → glass → rock → metal → plastic); the
     * glass-shard then continues its own merge cycle and may itself
     * transmute to a glass-tile or downgrade to a rock-shard once
     * it reaches GLASS_TIER_DIAMETER (see ShardSystem
     * tryConvertOversizedGlassShard).
     */
    private tryTransmuteShardToTile(
        entities: GameEntity[],
        shard: GameEntity,
        physics: PhysicsSystem,
    ): boolean {
        if (shard.shardVariant !== 'nebula-shard') return false;

        // Effective-area threshold.  Each shard carries a
        // `nebulaTileArea` set at spawn (= HEX_AREA / shardCount) that
        // accumulates through merges.  Transmutation fires when a
        // shard's accumulated effective area reaches HEX_AREA — i.e.
        // one full tile's worth of shatter mass has coalesced back
        // together.  Decoupled from physical disc area so shards can
        // stay small and glass-style without blocking the cycle.
        const effectiveArea = shard.nebulaTileArea ?? 0;
        if (effectiveArea < HEX_AREA) return false;

        this.transmuteToShard(entities, shard, 'glass-shard');
        return true;
    }

    /**
     * Replace the host nebula-shard with a single mobile glass-
     * shard at the same position.  Target size is sqrt(HEX_AREA),
     * so the new shard carries roughly one tile's worth of area.
     * The glass-shard then enters the ShardSystem merge cycle and
     * may eventually transmute up to a glass-tile (or down to a
     * rock-shard) once it grows to GLASS_TIER_DIAMETER.
     */
    private transmuteToShard(
        entities: GameEntity[],
        host: GameEntity,
        variantId: 'glass-shard',
    ): void {
        const variant = SHARD_VARIANTS[variantId];
        const spawn = variant.spawn;
        const targetSize = Math.sqrt(HEX_AREA);

        // Polygon via the variant's spawn config (radius / vertex
        // count / jitter).  Mirrors what ShardSystem.shatter does
        // for child shards.
        const baseR = (targetSize / 2) * 0.8;
        const verts = spawn.polyVerticesOptions
            ? spawn.polyVerticesOptions[Math.floor(Math.random() * spawn.polyVerticesOptions.length)]
            : spawn.polyVerticesMin + Math.floor(Math.random() * (spawn.polyVerticesMax - spawn.polyVerticesMin + 1));
        const raw: { angle: number; r: number }[] = [];
        for (let i = 0; i < verts; i++) {
            const baseAngle   = (i / verts) * Math.PI * 2;
            const angleJitter = (Math.random() - 0.5) * (Math.PI / verts) * spawn.angleJitter * 2;
            const radiusFrac  = spawn.radiusMin + Math.random() * spawn.radiusRange;
            raw.push({ angle: baseAngle + angleJitter, r: baseR * radiusFrac });
        }
        raw.sort((a, b) => a.angle - b.angle);
        const polygonPoints = raw.map(p => ({
            x: Math.cos(p.angle) * p.r,
            y: Math.sin(p.angle) * p.r,
        }));

        const hp = targetSize > 30 ? 2 : 1;
        entities.push({
            id:            nextId('shard'),
            type:          EntityType.STRUCTURE,
            shardVariant:  variantId,
            position:     { x: host.position.x, y: host.position.y },
            velocity:     { x: host.velocity.x, y: host.velocity.y },
            size:         { x: targetSize, y: targetSize },
            rotation:      Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 1.0,
            color:         COLORS.ASTEROID,
            active:        true,
            health:        hp,
            maxHealth:     hp,
            polygonPoints,
            mass:          spawn.sizeToMass(targetSize),
        });

        // Fade the host nebula-shard out the same way the tile path
        // does — eye reads "nebula dissolved, new shard appeared"
        // rather than a hard swap.
        host.nebulaFadeTimer    = NEBULA_CONSTANTS.FADE_DURATION;
        host.nebulaFadeDuration = NEBULA_CONSTANTS.FADE_DURATION;
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
     * ShardRegenAdapter hook (Stage 2).  Called by ShardSystem when a
     * regen completes for a variant whose `regen.rewriteColor === 'neighborhood-blend'`
     * (today: nebula-tile only).  ShardSystem already revived the
     * entity (active=true, health=max, regenProgress=undef) and will
     * call physics.addStaticEntity afterwards; this hook only handles
     * the nebula-specific completion work:
     *   - Compute a rule-based colour (neighbourhood-aware, forced shift)
     *   - Drop the render fast-path cache so the new colour shows
     *   - Reset the fade-in timer so the tile slowly materialises
     *   - Update the grid index so this tile counts as a neighbour for
     *     any later regens in the same frame (cluster-wide shatter)
     *   - Flag neighbour-counts dirty for the next update() pass
     */
    /**
     * ShardAdapter hook (Stage 4).  Called after a nebula-shard
     * self-compose merge fires inside ShardSystem.composeEntities.
     * Delegates straight to the existing transmutation logic; the
     * compose math itself (area accumulate, composition blend,
     * polygon regen, fade smaller) lives in ShardSystem.
     */
    public onComposeNebulaShard(
        host: GameEntity,
        entities: GameEntity[],
        physics: PhysicsSystem,
    ): void {
        this.tryTransmuteShardToTile(entities, host, physics);
    }

    public onNeighborhoodBlendRegen(entity: GameEntity, entities: GameEntity[]): void {
        // Tiles never grow (only shards do), so size is already
        // canonical.  Rule-based colour regeneration reads the
        // regenerating tile's 6 hex neighbours and blends their
        // compositions with the old tile's composition based on
        // isolation level — interior tiles smooth toward the
        // cluster average, edge tiles drift less, isolated tiles
        // keep their old hue exactly.
        if (!this.nebulaGridIndex) {
            this.nebulaGridIndex = this.buildNebulaGridIndex(entities);
        }
        entity.nebulaColorComposition = this.computeRegeneratedComposition(entity);
        entity.color = entity.nebulaColorComposition[0].hex;
        // Composition changed on regen — drop the render cache so
        // the regenerated tile picks up the new neighbourhood-blend
        // colour on its next draw.  Same invalidation also clears
        // the fast-path cache (tinted canvas / dx / dy / size) so
        // the slow path repopulates on the regen tile's next draw.
        entity.nebulaBlendedHex = undefined;
        entity.nebulaCachedTinted = undefined;

        // Fade in slowly instead of popping — no glimmer burst.
        entity.nebulaSpawnTimer    = NEBULA_CONSTANTS.FADE_IN_DURATION;
        entity.nebulaSpawnDuration = NEBULA_CONSTANTS.FADE_IN_DURATION;

        // A revived tile changes its neighbours' counts.
        this.neighborCountsDirty = true;

        // The just-regenerated tile should now count as a neighbour
        // for any later regens in this same frame.
        if (entity.nebulaGridCol !== undefined
            && entity.nebulaGridRow !== undefined) {
            const key = (entity.nebulaGridCol << 16)
                      | (entity.nebulaGridRow & 0xFFFF);
            this.nebulaGridIndex.set(key, entity);
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
            if (e.shardVariant !== 'nebula-tile') continue;
            if (!e.active) continue;
            if (e.nebulaFadeTimer !== undefined) continue;
            if (e.nebulaGridCol === undefined || e.nebulaGridRow === undefined) continue;
            const key = (e.nebulaGridCol << 16) | (e.nebulaGridRow & 0xFFFF);
            index.set(key, e);
        }
        return index;
    }
}
