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
import { NEBULA_CONSTANTS, getActiveNebulaStretchK, nebulaSpriteSize, getNebulaSpriteGen } from '../../../constants';
import { blendCompositionToHex } from '../../NebulaColor';
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
        && entity.nebulaCachedGen === getNebulaSpriteGen()
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
/** Draw a nebula SHARD from its per-entity cache — the shard counterpart of
 *  `drawNebulaTileCached`.
 *
 *  Called from inside `renderEntities`' per-entity transform, so rotation is
 *  already applied and this never touches it.  What it still does per frame
 *  is exactly what genuinely changes per frame:
 *
 *   - the three alpha terms (fade-out, birth fade-in, speed translucency),
 *     which is why a fading or newly-born shard is excluded from the cache
 *     path at the call site above rather than handled here; and
 *   - the velocity-aligned stretch, which is a function of the shard's
 *     current velocity and cannot be cached by definition.
 *
 *  Everything else — the blended hex, the density tint, the tinted-canvas
 *  lookup, the sprite centroid and the draw size — is read from the fields
 *  the slow path left behind. */
function drawNebulaShardFromCache(
    rs: RenderSystem,
    ctx: CanvasRenderingContext2D,
    entity: GameEntity,
): void {
    const tinted = entity.nebulaCachedTinted;
    if (tinted === undefined) return;
    rs.lastNebulaFastCount++;

    // Speed translucency — a fast shard reads a little thinner ("wind-torn
    // cloud").  Speed² so no sqrt; the same curve the slow path uses.
    const vx = entity.velocity.x, vy = entity.velocity.y;
    const speedSq = vx * vx + vy * vy;
    const speedMul = Math.max(
        NEBULA_CONSTANTS.SHARD_SPEED_OPACITY_MIN,
        1 - speedSq * NEBULA_CONSTANTS.SHARD_SPEED_OPACITY_K,
    );

    const stretchK = getActiveNebulaStretchK();
    const stretching = stretchK > 0 && speedSq > NEBULA_CONSTANTS.VEL_STRETCH_REST_SPEED_SQ;
    if (stretching) {
        const stretch = Math.min(NEBULA_CONSTANTS.VEL_STRETCH_MAX, Math.sqrt(speedSq) * stretchK);
        const delta = Math.atan2(vy, vx) - entity.rotation;
        ctx.rotate(delta);
        ctx.scale(1 + stretch, 1 - stretch * NEBULA_CONSTANTS.VEL_STRETCH_SQUASH_RATIO);
        ctx.rotate(-delta);
    }

    const size = entity.nebulaCachedSize ?? 0;
    ctx.globalAlpha = 0.45 * speedMul * (entity.nebulaAlphaMul ?? 1);
    ctx.drawImage(tinted, entity.nebulaCachedDx ?? 0, entity.nebulaCachedDy ?? 0, size, size);
    ctx.globalAlpha = 1.0;

    // Undo the stretch so the caller's transform is handed back unchanged —
    // `renderEntities` resets with setTransform per entity, but leaving a
    // scaled frame behind would be a trap for anything drawn after this in
    // the same frame (the debug outline below, for one).
    if (stretching) {
        const stretch = Math.min(NEBULA_CONSTANTS.VEL_STRETCH_MAX, Math.sqrt(speedSq) * stretchK);
        const delta = Math.atan2(vy, vx) - entity.rotation;
        ctx.rotate(delta);
        ctx.scale(1 / (1 + stretch), 1 / (1 - stretch * NEBULA_CONSTANTS.VEL_STRETCH_SQUASH_RATIO));
        ctx.rotate(-delta);
    }

    if (rs.debugMode && entity.polygonPoints && entity.polygonPoints.length > 0) {
        const pts = entity.polygonPoints;
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.stroke();
        ctx.globalAlpha = 1.0;
    }
}

export function drawNebulaEntity(
    rs: RenderSystem,
    ctx: CanvasRenderingContext2D,
    entity: GameEntity,
    perfNowSec: number,
): void {
    // THE SHARD CACHE (user call).  A nebula TILE has had a one-drawImage
    // fast path since Stage 5; a shard never did, and after the voronoi
    // change a broken tile leaves 6-8 of them instead of 2-3, so the slow
    // path became the dominant nebula cost (measured: 234 slow draws and a
    // 27.1 ms median frame against 95 and 16.7 ms under the legacy shatter).
    //
    // A shard cannot take the TILE fast path — that one draws in world space
    // with no transform, because a tile's rotation is always 0, while a shard
    // spins, fades on speed and stretches along its velocity.  So this is the
    // other half of the same idea: keep the per-frame work that genuinely
    // varies (rotation is already in the caller's transform, plus alpha and
    // the stretch) and cache the part that does not — the tint chain, the
    // tinted-canvas lookup, the sprite centroid and the draw size.
    //
    // Validity is the single `nebulaCachedTinted` flag, invalidated at every
    // site that moves an input (composition, density tier, neighbour count),
    // exactly as for tiles.  A shard's SIZE cannot drift out from under it:
    // nebula's merge is pair-consuming, so a shard is never resized in place.
    if (entity.shardVariant === 'nebula-shard'
        && entity.nebulaCachedTinted !== undefined
        && entity.nebulaCachedGen === getNebulaSpriteGen()
        && !entity.hitFlash
        && entity.mergeFadeTimer === undefined
        && entity.nebulaSpawnTimer === undefined) {
        drawNebulaShardFromCache(rs, ctx, entity);
        return;
    }
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
            // THE SPRITE IS SIZED FROM THE BODY IT BELONGS TO — its own
            // diameter times the authored overhang (see
            // NEBULA_CONSTANTS.SPRITE_OVERSIZE, which also carries why the
            // old `nebulaTileArea` rule was replaced: that field is set at
            // exactly one site and no shard ever had one, so every shard
            // drew a full-tile sprite whatever its size).  Since the
            // shatter conserves size² across the pieces, visual area still
            // tracks the mass accounting the merge → transmutation path
            // uses — the same property the area rule was reaching for,
            // now from an input that is always present.
            const drawSize = nebulaSpriteSize(entity);
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
            // Both variants now: the tile's cache feeds its world-space fast
            // path above, the shard's feeds `drawNebulaShardFromCache`.  Same
            // four fields and the same invalidation sites, so there is one
            // cache to reason about rather than two.
            entity.nebulaCachedTinted = tinted;
            entity.nebulaCachedDx = dx;
            entity.nebulaCachedDy = dy;
            entity.nebulaCachedSize = drawSize;
            entity.nebulaCachedGen = getNebulaSpriteGen();
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
                    // The SAME `nebulaSpriteSize` the sprite above draws
                    // at, which is why that is a shared function: the two
                    // sites carried the formula twice, so a change to one
                    // silently put the star outside the puff.
                    const drawSize = nebulaSpriteSize(entity);
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
