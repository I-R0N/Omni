/** NEBULA TILES AND SHARDS — the cloud layer.
 *
 *  Extracted verbatim from `RenderSystem.renderEntities`, which reached this
 *  material through two doors and both moved here:
 *
 *   - `drawNebulaTileCached` is the FAST PATH.  A steady-state nebula tile
 *     collapses to one `drawImage` off a per-entity cache the slow path
 *     populated on an earlier frame.
 *   - `drawNebulaEntity` is the SLOW PATH — the tint chain (composition
 *     blend, interior darken, density tier), the area-proportional sprite
 *     with its centroid correction and velocity stretch, the debug outline
 *     and the twinkle scheduler.  It is also what refills the fast path's
 *     cache, which is why the two belong in one file.
 *
 *  It takes the renderer for the state that persists between frames: the two
 *  per-frame nebula counters the DBG overlay reads, the DBG flags, and the
 *  sprite/tint/bitmap caches — which deliberately stay owned by
 *  `RenderSystem` (CLAUDE.md §2 files them there, and gauntlet 5c P17 found a
 *  real defect in the tint cache's eviction policy, so they are not something
 *  to relocate in passing).
 *
 *  NAMING: the renderer parameter is `rs`, not the `r` the other `render/`
 *  modules use, because the moved bodies bind `r` as a radius.
 */
import type { RenderSystem } from '../RenderSystem';
import { GameEntity } from '../../../types';
import { NEBULA_CONSTANTS, getActiveNebulaStretchK } from '../../../constants';
import { blendCompositionToHex } from '../../NebulaColor';
import { HEX_AREA } from '../../maps/TileGenerator';
import { hexToRgb, densityTintForRender } from './drawUtils';

/** FAST PATH for a steady-state nebula tile.  Returns true when it drew, so
 *  the caller can skip the rest of the entity pass; false hands the tile on
 *  to `drawNebulaEntity` below.
 *
 *  The caller keeps the leading `shardVariant === 'nebula-tile'` test inline,
 *  so non-nebula entities — the overwhelming majority of a frame — pay the
 *  same single string compare they did before this split rather than a call.
 *  Everything after that discriminator lives here.
 *
 * Mirrors the STRUCTURE fast path.  Steady-state nebula tiles (no
 * hit flash, no fade in / fade out, not in a twinkle window, cache
 * populated by an earlier slow-path draw) collapse to a single
 * drawImage + two globalAlpha writes — cutting per-tile cost from
 * ~30-100 µs to ~5 µs.  Tiles drop into the slow path automatically
 * when twinkle activates (nebulaTwinkleNextAt has elapsed) or when
 * NebulaSystem invalidates the cache (nebulaCachedTinted=undefined).
 * Shards are excluded because they still need ctx.rotate +
 * speed-based opacity.
 *
 * Debug mode is NOT a fast-path blocker: the slow-path's cyan
 * polygon overlay only matters for shards (which take the slow
 * path anyway), and the HUD requires debug mode to be on for the
 * user to see perf numbers — so blocking the fast path on
 * debugMode would mean it never runs while we're measuring.
 * Stage 5: fast-path gate flips from EntityType-keyed to
 * variant-id-keyed.  Same cost (one string compare), same
 * shape, same cache invalidation sites.  Only the nebula-tile
 * variant populates the per-entity tinted-canvas cache —
 * future variants can opt in via SHARD_VARIANTS[v].renderCache.
 */
export function drawNebulaTileCached(
    rs: RenderSystem,
    ctx: CanvasRenderingContext2D,
    entity: GameEntity,
    rx: number,
    ry: number,
    perfNowSec: number,
): boolean {
    if (entity.active
        && !entity.hitFlash
        && entity.mergeFadeTimer === undefined
        && entity.nebulaSpawnTimer === undefined
        && entity.regenPopTimer === undefined
        && entity.nebulaCachedTinted !== undefined
        && entity.nebulaTwinkleNextAt !== undefined
        && perfNowSec < entity.nebulaTwinkleNextAt) {
        ctx.globalAlpha = 0.55;
        ctx.drawImage(
            entity.nebulaCachedTinted,
            rx + (entity.nebulaCachedDx ?? 0),
            ry + (entity.nebulaCachedDy ?? 0),
            entity.nebulaCachedSize ?? 0,
            entity.nebulaCachedSize ?? 0,
        );
        ctx.globalAlpha = 1.0;
        // Debug overlay parity with the slow path — without this the
        // polygon outline only appears for tiles currently in their
        // twinkle window (which forces them to the slow path), which
        // looks like random flickering across the cluster.  Drawn in
        // world space (no ctx.translate in the fast path) by adding
        // (rx, ry) to each polygon point.
        if (rs.debugMode && entity.polygonPoints && entity.polygonPoints.length > 0) {
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = '#22d3ee'; // cyan-400 — matches other debug strokes
            ctx.lineWidth = 1;
            ctx.beginPath();
            const p0 = entity.polygonPoints[0];
            ctx.moveTo(rx + p0.x, ry + p0.y);
            for (let pi = 1; pi < entity.polygonPoints.length; pi++) {
                const p = entity.polygonPoints[pi];
                ctx.lineTo(rx + p.x, ry + p.y);
            }
            ctx.closePath();
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }
        rs.lastNebulaFastCount++;
        return true;
    }
    return false;
}

/** SLOW PATH for nebula tiles and shards: the full tint chain, the sprite
 *  draw, the debug outline and the twinkle scheduler.  Also what refills
 *  the fast-path cache above.
 *
 * Cloud-like rendering: tinted sprite drawn at a display-scale larger
 * than the physics size so adjacent tiles blend seamlessly across
 * their shared hex-grid boundaries.  Tinted sprites are cached.
 *
 *  The caller resets the canvas transform afterwards: that reset is the
 *  entity loop's own frame bookkeeping rather than part of drawing a
 *  nebula, so it stayed behind.
 */
export function drawNebulaEntity(
    rs: RenderSystem,
    ctx: CanvasRenderingContext2D,
    entity: GameEntity,
    perfNowSec: number,
): void {
    rs.lastNebulaSlowCount++;
    // Per-entity blended-hex cache: populated lazily on first render
    // and invalidated by NebulaSystem when composition mutates
    // (merge / regen).  Skips blendCompositionToHex's per-call
    // composition-key string allocation on every frame.
    let tintHex: string;
    if (entity.nebulaBlendedHex !== undefined) {
        tintHex = entity.nebulaBlendedHex;
    } else {
        tintHex = blendCompositionToHex(entity.nebulaColorComposition) || entity.color;
        entity.nebulaBlendedHex = tintHex;
    }
    // Interior-darken rule: nebula tiles surrounded by more active
    // neighbours render progressively darker so cluster edges pop
    // and interiors recede.  Max darkening at 6 neighbours (fully
    // enclosed) caps at 0.55× brightness; shards skip the pass.
    if (entity.shardVariant === 'nebula-tile' && entity.nebulaNeighborCount) {
        const t = Math.min(1, entity.nebulaNeighborCount / 6);
        const factor = 1 - t * 0.45;
        const [r, g, b] = hexToRgb(tintHex);
        const toHex = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)))
            .toString(16).padStart(2, '0');
        tintHex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
    // Density tier darkens nebula shards (only — tiles have density
    // disabled in the variant config).  Stacks multiplicatively
    // with the interior-darken rule above for tiles, but in
    // practice tiles never reach this branch with a positive
    // tier.  Skipped at tier 0 so existing shard colour matches
    // pre-density visuals exactly.
    if (entity.densityTier && entity.densityTier > 0
        && entity.shardVariant === 'nebula-shard') {
        tintHex = densityTintForRender(entity, tintHex);
    }
    const spriteSrc = entity.sprite;
    // Fade-out multiplier — per-entity duration lets fast-collision
    // shatters use a shorter, snappier fade than slow drift-through
    // collisions.  Falls back to the base constant for legacy tiles
    // without the per-entity duration field set.
    const fadeDuration = entity.mergeFadeDuration ?? NEBULA_CONSTANTS.FADE_DURATION;
    const fadeMul = entity.mergeFadeTimer !== undefined && entity.mergeFadeTimer > 0 && fadeDuration > 0
        ? Math.max(0, entity.mergeFadeTimer / fadeDuration)
        : 1.0;
    // Fade-in multiplier — same per-entity duration treatment so
    // child shards from a fast collision fade in fast, matching
    // their parent tile's fade-out rate.  Combines multiplicatively
    // with fadeMul so a tile shattered mid-birth smoothly crossfades
    // from its current alpha toward zero.
    const spawnDuration = entity.nebulaSpawnDuration ?? NEBULA_CONSTANTS.FADE_IN_DURATION;
    const spawnMul = entity.nebulaSpawnTimer !== undefined && entity.nebulaSpawnTimer > 0 && spawnDuration > 0
        ? Math.max(0, 1 - entity.nebulaSpawnTimer / spawnDuration)
        : 1.0;
    // Speed-based opacity falloff for shards — fast shards read
    // a little translucent ("wind-torn cloud"), settled shards are
    // fully opaque.  Uses speed² so we skip sqrt; tiles are
    // stationary so we skip the branch entirely for them.
    let speedMul = 1.0;
    if (entity.shardVariant === 'nebula-shard') {
        const vx = entity.velocity.x;
        const vy = entity.velocity.y;
        const speedSq = vx * vx + vy * vy;
        speedMul = Math.max(
            NEBULA_CONSTANTS.SHARD_SPEED_OPACITY_MIN,
            1 - speedSq * NEBULA_CONSTANTS.SHARD_SPEED_OPACITY_K,
        );
    }
    if (spriteSrc) {
        // Fast path for shards: reuse the cached composite cache key
        // so we do a single Map.get against the shared _tintedSprites
        // store without rebuilding "${src}|${hex}" per frame.  Falls
        // through to getTintedSprite on cache miss (first draw, or
        // if the LRU evicted the canvas) which populates the store
        // and returns the same canvas.  Tiles keep the default path
        // since their tintHex varies with neighbour-count darkening.
        let tinted: HTMLCanvasElement | null = null;
        if (entity.shardVariant === 'nebula-shard') {
            if (entity.nebulaTintedKey === undefined) {
                // The SAME quantisation getTintedSprite applies — this is
                // the only other site that constructs a store key, and an
                // exact-hex key here would never match the quantised
                // entries, turning the fast path into a guaranteed miss.
                entity.nebulaTintedKey =
                    `${spriteSrc}|${rs.quantizeTintHex(tintHex)}`;
            }
            tinted = rs._tintedSprites.get(entity.nebulaTintedKey) ?? null;
            if (!tinted) tinted = rs.getTintedSprite(spriteSrc, tintHex);
        } else {
            tinted = rs.getTintedSprite(spriteSrc, tintHex);
        }
        if (tinted) {
            const isTile = entity.shardVariant === 'nebula-tile';
            // Sprite size is proportional to the effective nebula
            // area the entity carries.  A fresh shard from a 5-way
            // shatter draws ≈ 96 × sqrt(1/5) ≈ 43 world units; a
            // half-merged shard draws ≈ 68; a full tile draws at
            // the reference size (96).  Using sqrt keeps visual
            // area (∝ sprite²) proportional to effective area, so
            // what the player sees matches the conserved mass
            // accounting used for merge → transmutation.  Legacy
            // entities without nebulaTileArea fall back to a full
            // tile sprite.
            const effArea = entity.nebulaTileArea ?? HEX_AREA;
            const areaRatio = Math.max(0, Math.min(1, effArea / HEX_AREA));
            const drawSize = NEBULA_CONSTANTS.TILE_SPRITE_WORLD_SIZE
                * Math.sqrt(areaRatio);
            // Content-centroid correction: shift the draw so the
            // sprite's visible-pixel centroid lands on the pivot.
            // Without this, asymmetric source PNGs appear to orbit
            // around their bitmap centre when rotated.  Fallback is
            // (0, 0) if the centroid isn't computable yet.
            const centroid = rs.getSpriteCentroid(spriteSrc);
            const dOffset = -(drawSize / 2);
            const dx = dOffset - centroid.dx * drawSize;
            const dy = dOffset - centroid.dy * drawSize;
            // Velocity-aligned stretch (nebula-shard only).
            // Reads as "wind tugging the cloud forward" — the
            // sprite squashes along the velocity axis as the
            // shard moves.  Gated on speed² > REST so settled
            // shards skip the math.  Always uses "free" mode:
            // only the squash axis aligns to velocity; the
            // sprite stays at entity.rotation (controlled by
            // rotationSpeed) — achieved by rotating to
            // velocity, scaling, then rotating back so the
            // local coord system stays squashed along the
            // velocity axis while drawImage paints in the
            // entity-rotated frame.  Stretch magnitude reads
            // from getActiveNebulaStretchK() (DBG-cyclable
            // via the NStr button); when the cycle is at
            // K = 0 the stretch is skipped entirely.
            if (!isTile) {
                const stretchK = getActiveNebulaStretchK();
                if (stretchK > 0) {
                    const vx = entity.velocity.x;
                    const vy = entity.velocity.y;
                    const speedSq = vx * vx + vy * vy;
                    if (speedSq > NEBULA_CONSTANTS.VEL_STRETCH_REST_SPEED_SQ) {
                        const speed = Math.sqrt(speedSq);
                        const stretch = Math.min(
                            NEBULA_CONSTANTS.VEL_STRETCH_MAX,
                            speed * stretchK,
                        );
                        const velAngle = Math.atan2(vy, vx);
                        const delta = velAngle - entity.rotation;
                        ctx.rotate(delta);
                        ctx.scale(
                            1 + stretch,
                            1 - stretch * NEBULA_CONSTANTS.VEL_STRETCH_SQUASH_RATIO,
                        );
                        ctx.rotate(-delta);
                    }
                }
            }
            // Soft alpha — tiles slightly more opaque so the cloud
            // reads as solid, shards slightly less so they feel light.
            // Optional per-entity multiplier so callers can ask for
            // a wispier-than-default puff (rock-tile / rock-shard
            // shatter callers set ~0.5 so their nebula debris
            // reads as a faint dust cloud rather than a solid
            // tinted shard).
            ctx.globalAlpha = (isTile ? 0.55 : 0.45) * fadeMul * spawnMul * speedMul * (entity.nebulaAlphaMul ?? 1);
            ctx.drawImage(tinted, dx, dy, drawSize, drawSize);
            ctx.globalAlpha = 1.0;
            // Populate the nebula fast-path cache while we have
            // every input on hand.  See the fast-path block above
            // renderEntities()'s slow body — once these four
            // fields are non-undefined, subsequent frames bypass
            // this whole slow path until NebulaSystem invalidates
            // them (composition / neighbour-count / area changes).
            if (entity.shardVariant === 'nebula-tile') {
                entity.nebulaCachedTinted = tinted;
                entity.nebulaCachedDx = dx;
                entity.nebulaCachedDy = dy;
                entity.nebulaCachedSize = drawSize;
            }
        } else {
            // Fallback: procedural soft circle in the tint colour
            // while the nebula sprite is still loading.
            const r = Math.max(entity.size.x, entity.size.y) * 0.9;
            const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
            grad.addColorStop(0, tintHex);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.globalAlpha = 0.45 * fadeMul * spawnMul * speedMul;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1.0;
        }
    }

    // --- DEBUG OVERLAY ---
    // Nebula tiles: draw the hex outline so the invisible interactable
    // footprint is visible during debug.
    // Nebula shards: draw the polygon outline (same glass-shard style
    // polygon set at spawn).  Legacy shards without polygonPoints fall
    // back to an implicit circle defined by `size`.
    // Gated on the main DBG mode OR the dedicated Outline toggle, so
    // a dev can show nebula+plastic outlines together without
    // switching the whole DBG mode on.
    if (rs.debugMode || rs.tileOutlinesEnabled) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#22d3ee'; // cyan-400 — matches other debug strokes
        ctx.lineWidth = 1;
        if (entity.polygonPoints && entity.polygonPoints.length > 0) {
            ctx.beginPath();
            const p0 = entity.polygonPoints[0];
            ctx.moveTo(p0.x, p0.y);
            for (let pi = 1; pi < entity.polygonPoints.length; pi++) {
                const p = entity.polygonPoints[pi];
                ctx.lineTo(p.x, p.y);
            }
            ctx.closePath();
            ctx.stroke();
        } else if (entity.shardVariant === 'nebula-shard') {
            // Legacy fallback: implicit circle defined by `size`.
            const r = Math.max(entity.size.x, entity.size.y) / 2;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1.0;
    }

    // --- TWINKLE STAR ---
    // Stationary nebula TILES get an occasional fading-in/out star at a
    // random in-sprite position — adds ambience to the backdrop.
    // Skipped for NEBULA_SHARDs: shards are transient, drifting, and
    // often in merge cooldown, so the twinkle is almost imperceptible
    // on them while still costing a performance.now() + drawImage per
    // shard per frame.  Cutting it for shards eliminates that work
    // without a visible change.
    //
    if (entity.shardVariant === 'nebula-tile') {
        const now = perfNowSec;
        if (entity.nebulaTwinkleNextAt === undefined) {
            // First sighting — stagger the initial twinkle randomly
            // across the [MIN, MAX] interval so a freshly-spawned
            // cluster doesn't all twinkle in unison.
            entity.nebulaTwinkleNextAt = now + NEBULA_CONSTANTS.TWINKLE_INTERVAL_MIN
                + Math.random() * (NEBULA_CONSTANTS.TWINKLE_INTERVAL_MAX - NEBULA_CONSTANTS.TWINKLE_INTERVAL_MIN);
            entity.nebulaTwinkleX = (Math.random() * 2 - 1);
            entity.nebulaTwinkleY = (Math.random() * 2 - 1);
        }
        const elapsed = now - entity.nebulaTwinkleNextAt;
        if (elapsed >= 0) {
            if (elapsed < NEBULA_CONSTANTS.TWINKLE_DURATION) {
                // Active twinkle — sin curve over the duration
                const t = elapsed / NEBULA_CONSTANTS.TWINKLE_DURATION;
                const twinkleAlpha = Math.sin(t * Math.PI) * fadeMul * spawnMul;
                if (twinkleAlpha > 0.01) {
                    const star = rs.getTwinkleBitmap();
                    // Place the star within the sprite footprint —
                    // half-extent × placement-range keeps it inside.
                    // Same area-proportional draw-size formula the
                    // sprite render uses above, so the twinkle
                    // scales with the shard/tile as it merges.
                    const effArea = entity.nebulaTileArea ?? HEX_AREA;
                    const areaRatio = Math.max(0, Math.min(1, effArea / HEX_AREA));
                    const drawSize = NEBULA_CONSTANTS.TILE_SPRITE_WORLD_SIZE
                        * Math.sqrt(areaRatio);
                    const halfExtent = (drawSize / 2) * NEBULA_CONSTANTS.TWINKLE_PLACEMENT_RANGE;
                    const tx = (entity.nebulaTwinkleX ?? 0) * halfExtent;
                    const ty = (entity.nebulaTwinkleY ?? 0) * halfExtent;
                    const starSize = NEBULA_CONSTANTS.TWINKLE_STAR_SIZE;
                    ctx.globalAlpha = twinkleAlpha;
                    ctx.drawImage(star, tx - starSize / 2, ty - starSize / 2, starSize, starSize);
                    ctx.globalAlpha = 1.0;
                }
            } else {
                // Cycle complete — schedule the next one with a fresh
                // random delay and reroll the in-sprite position.
                entity.nebulaTwinkleNextAt = now + NEBULA_CONSTANTS.TWINKLE_INTERVAL_MIN
                    + Math.random() * (NEBULA_CONSTANTS.TWINKLE_INTERVAL_MAX - NEBULA_CONSTANTS.TWINKLE_INTERVAL_MIN);
                entity.nebulaTwinkleX = (Math.random() * 2 - 1);
                entity.nebulaTwinkleY = (Math.random() * 2 - 1);
            }
        }
    }
}
