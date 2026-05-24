import { GameEntity, EntityType, Vector2, NebulaColorStop } from '../../types';
import { ShardVariantId } from './ShardSystem.types';
import {
  COLORS,
  AMMO_CONSTANTS,
  DROP_CONFIG,
  SHARD_VARIANTS,
  NEBULA_CONSTANTS,
  randomPlasticShade,
  colorToWigglePhase,
  PLASTIC_DEFORM_CONSTANTS,
  getActiveShatterGraceDelay,
} from '../../constants';
import { ParticleSystem } from './ParticleSystem';
import { nextId } from './IdAllocator';
import { NEBULA_IMAGES, ASSETS } from '../../assets';
import {
  blendCompositionToHex,
  cloneComposition,
  randomGlassNebulaComposition,
  randomRockNebulaComposition,
} from '../NebulaColor';

/**
 * DropSystem — owns collectible drops and breakage debris.
 *
 * Extracted from GameEngine in Phase 3 of the engine upgrade.  Stateless
 * apart from its ParticleSystem dependency; all drop / shard entities are
 * appended to the caller-supplied `entities` array and (for collectible
 * drops) also registered in a caller-supplied `activeDrops` cache for fast
 * lookup during the collection pass.
 *
 * Reward application (player ammo / health adjustment) lives on this system
 * too — it's the natural home for "what happens when a drop is collected"
 * and keeps the surface area of Phase 3 small.
 */
export class DropSystem {
  constructor(private particles: ParticleSystem) {}

  // --- Reward application --------------------------------------------------

  /**
   * Apply the reward of a collected/broken drop directly to the player.
   * Called both from spawnDrops (when a drop is destroyed by a player
   * projectile) and from the contact-collection loop in GameEngine.
   * `onMessage` is invoked for health drops so the engine can surface a HUD
   * message without this system needing to know about the HUD pipeline.
   */
  public applyDropEffect(
    player: GameEntity,
    entity: GameEntity,
    onMessage?: (text: string, color: string) => void,
  ) {
    if (entity.dropType === 'ammo') {
      const amount = entity.dropValue ?? DROP_CONFIG.AMMO_PER_ASTEROID;
      const before = player.ammo ?? 0;
      player.ammo = Math.min(AMMO_CONSTANTS.MAX_POOL, before + amount);
      const gained = player.ammo - before;
      // Shared-pool flash — accumulate amount if picked up in quick succession
      const prev = player.ammoPickupFlash;
      player.ammoPickupFlash = {
        timer:  0.75,
        amount: (prev && prev.timer > 0 ? prev.amount : 0) + gained,
      };
    } else if (entity.dropType === 'health') {
      const healAmount = entity.dropValue ?? DROP_CONFIG.HEALTH_HEAL_AMOUNT;
      const healed = Math.min(healAmount, player.maxHealth - player.health);
      if (healed > 0) {
        player.health += healed;
        onMessage?.(`+${Math.round(healed)}`, '#ef4444');
      }
    }
  }

  // --- Drop dispatcher -----------------------------------------------------

  /**
   * Top-level drop/shard dispatcher invoked when an entity is destroyed.
   * Structures → glass shards, interactables → reward, asteroids → ammo /
   * health drops driven by the (optionally) stored dropComposition or a
   * random ammo roll.
   */
  public spawnDrops(
    entities: GameEntity[],
    activeDrops: GameEntity[],
    player: GameEntity,
    entity: GameEntity,
    onMessage?: (text: string, color: string) => void,
  ) {
    const pos = entity.position;
    const pv = entity.velocity;

    // Shard-family entities are all EntityType.STRUCTURE.  Distinguish:
    //   - glass-tile death  → fan of glass-shard debris (legacy path)
    //   - dent-policy tile  → single mobile material-shard at the
    //                          tile's current dented size (plastic /
    //                          metal — the tile deformed in place
    //                          via PhysicsSystem.applyDentStep, and
    //                          this is its detach moment)
    //   - rock-tile         → own ShardSystem shatter path → rock-shards
    //   - nebula-tile       → skips drops via spawnsDropsOnDeath = false
    //   - mobile shards     → asteroid-like drop logic
    const isStaticTile  = entity.type === EntityType.STRUCTURE && entity.mass === Infinity;
    const tileDent = entity.shardVariant !== undefined
      ? SHARD_VARIANTS[entity.shardVariant].dent
      : undefined;
    const isDentTile   = isStaticTile && tileDent !== undefined;
    const isGlassFamilyTile = isStaticTile
      && entity.shardVariant === 'glass-tile';
    const isMobileShard = entity.type === EntityType.STRUCTURE && entity.mass !== Infinity;
    if (isDentTile) {
      // Dented-out tile detaches as the shards in variant.dent.breakShards.
      // Each shard's size is a fraction of the original tile.  The
      // impactor's velocity (lastImpactVelocity) seeds the fan-spread
      // launch direction so a multi-shard break visibly diverges.
      // `dent.shardHealth`, when set, overrides the inherited
      // tile.maxHealth so the tile face can be brittle while the
      // shards stay durable (plastic-tile: 1 HP face → 8–12 24-HP
      // shards).
      this.spawnDentShard(entities, entity, tileDent!.breakShards, tileDent!.shardHealth);
    } else if (isGlassFamilyTile) {
      // Glass tile death — visual debris.  Indestructible tiles
      // short-circuit upstream; rock-tile spawns its own rock-shards
      // via ShardSystem.shatter; nebula-tile skips drops via
      // variant.spawnsDropsOnDeath = false.
      this.spawnGlassShards(entities, entity);
    } else if (entity.type === EntityType.INTERACTABLE && entity.dropType && entity.dropType !== 'glass') {
      // Drop was destroyed by a player projectile — apply its reward immediately.
      this.applyDropEffect(player, entity, onMessage);
    } else if (isMobileShard) {
      if (entity.dropComposition && entity.dropComposition.length > 0) {
        for (const comp of entity.dropComposition) {
          if (comp.type === 'ammo') {
            this.spawnAmmoDrop(entities, activeDrops, pos, comp.value, pv);
          } else if (comp.type === 'health') {
            this.spawnHealthDrop(entities, activeDrops, pos, comp.value, pv);
          }
          // 'powerup' entries no longer spawn — powerup drops have been removed
        }
      } else {
        // Dent-policy shards take several hits to destroy, so their
        // drop chance + payload runs higher than single-hit asteroids.
        // Non-dent shards (rock-shard, glass-shard) keep the legacy
        // asteroid drop rate.
        const isDentShard = entity.shardVariant !== undefined
          && SHARD_VARIANTS[entity.shardVariant].dent !== undefined;
        // Plastic-shards burst into many children, so they roll a much
        // lower drop chance than other dent shards (metal) to avoid a
        // flood of ammo from one cluster break.
        const dropChance = entity.shardVariant === 'plastic-shard'
          ? DROP_CONFIG.AMMO_DROP_CHANCE_PLASTIC_SHARD
          : isDentShard
            ? DROP_CONFIG.AMMO_DROP_CHANCE_DENT_SHARD
            : DROP_CONFIG.AMMO_DROP_CHANCE_ASTEROID;
        const dropAmount = isDentShard
          ? DROP_CONFIG.AMMO_PER_DENT_SHARD
          : DROP_CONFIG.AMMO_PER_ASTEROID;
        if (Math.random() < dropChance) {
          this.spawnAmmoDrop(entities, activeDrops, pos, dropAmount, pv);
        }
      }
    }
  }

  // --- Enemy / glass shard breakage ---------------------------------------

  /**
   * Break a dead enemy into debris.  Uses a fixed slot plan (6 tile shards +
   * 1 primary-ammo + 1 secondary-ammo + maybe an empty asteroid) which is
   * then shuffled before spawning so drops aren't always positioned last.
   * Both ammo slots roll the shared-ammo currency at independent rates;
   * combined expected ammo per enemy ≈ 0.55*3 + 0.25*2 = 2.15 (matches the
   * pre-d1 own+next economy).
   */
  public spawnEnemyShards(
    entities: GameEntity[],
    activeDrops: GameEntity[],
    enemy: GameEntity,
  ) {
    const pos     = enemy.position;
    const pv      = enemy.velocity;

    // Plan: 6 tile shards + 1 primary ammo + 1 secondary ammo + 1 empty asteroid (50 % chance)
    const TOTAL_PHYSICAL = 6 + 1 + 1 + (Math.random() < 0.5 ? 1 : 0);

    type SlotKind = 'tile' | 'asteroid' | 'ammoPrimary' | 'ammoSecondary';
    const slots: SlotKind[] = [];
    for (let i = 0; i < 6; i++) slots.push('tile');
    slots.push('ammoPrimary');
    slots.push('ammoSecondary');
    if (TOTAL_PHYSICAL > 8) slots.push('asteroid');
    // Shuffle so drops aren't always last
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }

    const total = slots.length;
    for (let i = 0; i < total; i++) {
      const baseAngle = (i / total) * Math.PI * 2;
      const angle     = baseAngle + (Math.random() - 0.5) * (Math.PI / total) * 1.5;
      const speed     = 1.5 + Math.random() * 3.0;
      const vx = pv.x * 0.2 + Math.cos(angle) * speed;
      const vy = pv.y * 0.2 + Math.sin(angle) * speed;

      const kind = slots[i];

      if (kind === 'ammoPrimary' && Math.random() < DROP_CONFIG.AMMO_DROP_CHANCE_ENEMY_PRIMARY) {
        this.spawnAmmoDrop(entities, activeDrops, pos, DROP_CONFIG.AMMO_PER_ENEMY_PRIMARY, { x: vx * 5, y: vy * 5 });
        continue;
      }
      if (kind === 'ammoSecondary' && Math.random() < DROP_CONFIG.AMMO_DROP_CHANCE_ENEMY_SECONDARY) {
        this.spawnAmmoDrop(entities, activeDrops, pos, DROP_CONFIG.AMMO_PER_ENEMY_SECONDARY, { x: vx * 5, y: vy * 5 });
        continue;
      }

      // Physical shard
      const isTile = kind === 'tile';
      const variantId: ShardVariantId = isTile ? 'glass-shard' : 'rock-shard';
      const size    = 12 + Math.random() * 10;
      const numPts  = isTile ? (4 + Math.floor(Math.random() * 3)) : (5 + Math.floor(Math.random() * 3));
      const jitterK = isTile ? 0.25 : 0.8;
      const rMin    = isTile ? 0.60 : 0.55;
      const rRange  = isTile ? 0.55 : 0.70;
      const baseR   = (size / 2) * 0.8;
      const rawPts: { angle: number; r: number }[] = [];
      for (let j = 0; j < numPts; j++) {
        const ba = (j / numPts) * Math.PI * 2;
        const aj = (Math.random() - 0.5) * (Math.PI / numPts) * jitterK;
        rawPts.push({ angle: ba + aj, r: baseR * (rMin + Math.random() * rRange) });
      }
      rawPts.sort((a, b) => a.angle - b.angle);
      const pts: Vector2[] = rawPts.map(p => ({ x: Math.cos(p.angle) * p.r, y: Math.sin(p.angle) * p.r }));

      entities.push({
        id:           nextId('enemy_shard'),
        type:          EntityType.STRUCTURE,
        shardVariant:  variantId,
        position:     { x: pos.x, y: pos.y },
        velocity:     { x: vx, y: vy },
        size:         { x: size, y: size },
        rotation:      Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 2 * (2.5 / (size / 20)),
        color:         isTile ? '#b4e6fd' : COLORS.ASTEROID,
        active:        true,
        health:        1,
        maxHealth:     1,
        mass:          SHARD_VARIANTS[variantId].spawn.sizeToMass(size),
        polygonPoints: pts,
      });
    }
  }

  /**
   * Scatter 7–9 glass shards from a destroyed tile plus an occasional fuel
   * shard.  Glass shards look like tile fragments (same glass rendering),
   * drift with the flow field, and persist as permanent debris.  They are
   * NOT added to activeDrops so they cannot be collected — they are purely
   * environmental debris.
   */
  public spawnGlassShards(entities: GameEntity[], tile: GameEntity) {
    // Damage biases count and size distribution.
    // damageNorm 0 → 4–6 shards, mostly large; 1 → 9–11, mostly small.
    const damage     = tile.lastImpactDamage ?? 1;
    const damageNorm = Math.min(1, (damage - 1) / 4);
    const count      = Math.round(4 + damageNorm * 6) + Math.floor(Math.random() * 3);

    // Tile is approximated as a square with half-side 11 → area = 11² = 121.
    const TILE_HALF = 11;
    const parentArea = TILE_HALF * TILE_HALF;
    const MIN_RADIUS = 2; // don't spawn sub-pixel shards

    // Power-law area distribution — same principle as asteroids.
    const alpha    = 0.3 + damageNorm * 1.5; // 0.3 → few large; 1.8 → many small
    const rawAreas = Array.from({ length: count }, () => Math.pow(Math.random(), alpha));
    const rawSum   = rawAreas.reduce((s, a) => s + a, 0);
    // Radii derived from normalised areas (area = r²).
    const radii: number[] = rawAreas
      .map(a => Math.sqrt((a / rawSum) * parentArea))
      .filter(r => r >= MIN_RADIUS);

    if (radii.length < 2) return;

    const iv = tile.lastImpactVelocity;
    const impactSpeed = iv ? Math.sqrt(iv.x * iv.x + iv.y * iv.y) : 0;
    const impactAngle = impactSpeed > 0.001 ? Math.atan2(iv!.y, iv!.x) : null;
    const HALF_CONE   = Math.PI * 0.6;
    const scatter     = 12;

    for (let i = 0; i < radii.length; i++) {
      const radius = radii[i];

      let angle: number;
      let speed: number;
      if (impactAngle !== null) {
        angle = impactAngle + (Math.random() - 0.5) * 2 * HALF_CONE;
        speed = impactSpeed * 0.2 + 0.3 + Math.random() * 1.2;
      } else {
        angle = Math.random() * Math.PI * 2;
        speed = 0.4 + Math.random() * 1.5;
      }

      // Glass-shard polygon comes from the variant's spawn config —
      // always 3 vertices, sharp/narrow angles (see
      // SHARD_SPAWN_SHAPE in constants.ts).
      const size = radius * 4; // diameter; slightly larger so physics feel solid
      const pts: Vector2[] = this.generateMaterialShardPolygon('glass-shard', size);
      entities.push({
        id:            nextId('tile_shard'),
        type:           EntityType.STRUCTURE,
        shardVariant:  'glass-shard',
        position:      {
          x: tile.position.x + (Math.random() - 0.5) * scatter * 2,
          y: tile.position.y + (Math.random() - 0.5) * scatter * 2,
        },
        velocity:      { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        size:          { x: size, y: size },
        rotation:       Math.random() * Math.PI * 2,
        rotationSpeed:  (Math.random() - 0.5) * 2 * (2.8 / Math.max(1, radius / 4)),
        color:          '#b4e6fd',   // blue-white tile hue
        active:         true,
        health:         1,
        maxHealth:      1,
        mass:           SHARD_VARIANTS['glass-shard'].spawn.sizeToMass(size),
        polygonPoints:  pts,
        // Let the debris scatter before the overlap-collapse pass can
        // re-condense it into a tile (DBG-cyclable delay).
        collapseGraceTimer: getActiveShatterGraceDelay(),
      });
    }

    // Impact sparks: tile-colored chips + bright white hot sparks
    const tileImpactAngle = tile.lastImpactVelocity
      ? Math.atan2(tile.lastImpactVelocity.y, tile.lastImpactVelocity.x)
      : undefined;
    this.particles.spawn(entities, tile.position, 6, tile.color || '#6366f1', {
      speedMin: 2, speedMax: 7, sizeMin: 1, sizeMax: 2.5,
      lifetimeMin: 0.2, lifetimeMax: 0.45,
      spreadAngle: tileImpactAngle, spreadCone: Math.PI * 0.65,
    });
    this.particles.spawn(entities, tile.position, 4, '#ffffff', {
      speedMin: 5, speedMax: 12, sizeMin: 0.5, sizeMax: 1.5,
      lifetimeMin: 0.1, lifetimeMax: 0.25,
      spreadAngle: tileImpactAngle, spreadCone: Math.PI * 0.5,
    });

    // Release 3-5 glass-palette nebula-shards alongside the glass
    // debris so the shatter has a substantial cloud-puff dimension.
    // Each puff samples a hue from the cool half of the nebula arc
    // (cyan → indigo) — sets a per-shard composition so each puff
    // participates in the color-equilibration pass and blends
    // smoothly into any surrounding nebula cluster.
    const nebulaCount = 3 + Math.floor(Math.random() * 3);
    const tileSize = Math.max(tile.size.x, tile.size.y);
    for (let i = 0; i < nebulaCount; i++) {
      const spawnPos = {
        x: tile.position.x + (Math.random() - 0.5) * scatter * 2,
        y: tile.position.y + (Math.random() - 0.5) * scatter * 2,
      };
      const comp = randomGlassNebulaComposition();
      this.spawnColoredNebulaShard(
        entities, spawnPos, tileSize,
        comp[0].hex, 0.45 + Math.random() * 0.25,
        tile.lastImpactVelocity,
        comp,
      );
    }
  }

  /**
   * Spawn a single mobile shard at the position of a dented-out tile.
   * Inherits the tile's current dented polygon and size — both already
   * mutated in place by PhysicsSystem.applyDentStep on each damage
   * event — and each spawned shard reads as "the broken-loose piece
   * of what was just there".  Each shard's size is a fraction of the
   * tile's original max axis (entity.size), so plastic detaches as
   * a single ~1/3-size piece while metal fragments into a 1/3 + 1/6
   * pair.  The dented polygon is scaled to each shard's target size
   * so the dent character is preserved at the smaller scale.
   *
   * Velocity comes from the impactor's last hit; mass from the
   * variant's spawn.sizeToMass; rotation is independent per shard
   * so multiple shards don't read as identical clones.  When more
   * than one shard spawns, each gets a small radial offset so they
   * don't pile up at the tile centre.
   */
  public spawnDentShard(
    entities: GameEntity[],
    tile: GameEntity,
    breakShards: ReadonlyArray<{
      variant: ShardVariantId;
      sizeFraction: number;
      inheritParentPolygon?: boolean;
      countMin?: number;
      countMax?: number;
      sizeFractionMin?: number;
      sizeFractionMax?: number;
    }>,
    shardHealthOverride?: number,
  ) {
    if (breakShards.length === 0) return;

    // Expand `countMin/countMax` templates into individual spawn
    // entries before iterating — keeps the per-shard loop simple
    // and lets the fan-spread denominator see the true total count.
    // Each expanded entry also resolves its `sizeFraction` against
    // the optional `sizeFractionMin/Max` range so the burst varies
    // in size as well as count.
    type ExpandedSpec = {
      variant: ShardVariantId;
      sizeFraction: number;
      inheritParentPolygon?: boolean;
    };
    const expanded: ExpandedSpec[] = [];
    for (let s = 0; s < breakShards.length; s++) {
      const spec = breakShards[s];
      const hasCount = spec.countMin !== undefined && spec.countMax !== undefined;
      const count = hasCount
        ? spec.countMin! + Math.floor(Math.random() * (spec.countMax! - spec.countMin! + 1))
        : 1;
      const hasSizeRange = spec.sizeFractionMin !== undefined && spec.sizeFractionMax !== undefined;
      for (let k = 0; k < count; k++) {
        const sizeFraction = hasSizeRange
          ? spec.sizeFractionMin! + Math.random() * (spec.sizeFractionMax! - spec.sizeFractionMin!)
          : spec.sizeFraction;
        expanded.push({
          variant: spec.variant,
          sizeFraction,
          inheritParentPolygon: spec.inheritParentPolygon,
        });
      }
    }
    if (expanded.length === 0) return;

    // Base tile size — entity.size is never updated by applyDentStep,
    // so this still equals the original tile footprint (the shrunken
    // silhouette is in polygonPoints only).  Used as a fallback when
    // the polygon is missing.
    const baseSize = Math.max(tile.size.x, tile.size.y);

    // Single pass over the dented polygon to compute two metrics:
    //  - dentedMaxR: max vertex radius — used to scale the polygon so
    //                it fits inside each shard's target AABB.
    //  - avgR:       average vertex radius — proxy for the deformed
    //                tile's effective area.  For a regular polygon
    //                area ≈ k × r², so avgR scales linearly with
    //                sqrt(area) and the constant k cancels in
    //                relative comparisons.  Used to size shards: each
    //                shard's diameter = 2 × avgR × sizeFraction, so a
    //                tile that's been heavily dented produces
    //                proportionally smaller shards while a barely-
    //                dented tile produces shards close to the
    //                nominal (sizeFraction × original_diameter)
    //                sizing.  All math is cheap: one loop + two
    //                sqrts, no per-frame work.
    let dentedMaxR = baseSize / 2;
    let avgR = dentedMaxR;
    if (tile.polygonPoints && tile.polygonPoints.length > 0) {
      let maxR2 = 0;
      let sumR2 = 0;
      for (let i = 0; i < tile.polygonPoints.length; i++) {
        const p = tile.polygonPoints[i];
        const r2 = p.x * p.x + p.y * p.y;
        sumR2 += r2;
        if (r2 > maxR2) maxR2 = r2;
      }
      dentedMaxR = Math.max(0.001, Math.sqrt(maxR2));
      avgR = Math.sqrt(sumR2 / tile.polygonPoints.length);
    }
    const deformedDiameter = avgR * 2;

    const iv = tile.lastImpactVelocity;
    const impactSpeed = iv ? Math.sqrt(iv.x * iv.x + iv.y * iv.y) : 0;
    const baseAngle = impactSpeed > 0.001
      ? Math.atan2(iv!.y, iv!.x)
      : Math.random() * Math.PI * 2;
    // Damp the inherited speed so shards drift rather than rocket
    // away — projectile speeds are typically 30–100, and we want a
    // gentle pop-off, not a launch.
    const baseSpeed = 0.3 + Math.min(impactSpeed * 0.05, 1.5);

    // Last-shard angle used to seed the post-spawn particle puff so
    // sparks spray along the dominant detach direction.
    let lastShardAngle = baseAngle;

    for (let i = 0; i < expanded.length; i++) {
      const spec = expanded[i];
      const variantDef = SHARD_VARIANTS[spec.variant];

      // Target shard size = fraction of the deformed tile's effective
      // diameter (= 2 × avgR), so heavier deformation produces
      // proportionally smaller shards while a barely-dented tile
      // produces shards near the nominal sizeFraction × original size.
      //
      // Polygon shape: two paths.
      //   Default — generate from the variant's spawn config (fixed
      //   vertex count per material; plastic=4, metal=6, etc.) so
      //   detached shards have a consistent material silhouette.
      //   `inheritParentPolygon: true` — clone the parent tile's
      //   dented polygon scaled by sizeFraction.  Used by metal-tile
      //   so the freed shard's outline matches the broken tile
      //   exactly (no instant "snap to 6/8/10-vertex polygon" pop).
      //   `targetSize` in this branch is derived from the scaled
      //   polygon's circumradius so entity.size matches the actual
      //   silhouette extent.
      let scaledPts: Vector2[];
      let targetSize: number;
      if (spec.inheritParentPolygon && tile.polygonPoints && tile.polygonPoints.length > 0) {
        const s = spec.sizeFraction;
        scaledPts = new Array(tile.polygonPoints.length);
        let maxR2 = 0;
        for (let p = 0; p < tile.polygonPoints.length; p++) {
          const src = tile.polygonPoints[p];
          const sx = src.x * s, sy = src.y * s;
          scaledPts[p] = { x: sx, y: sy };
          const r2 = sx * sx + sy * sy;
          if (r2 > maxR2) maxR2 = r2;
        }
        // entity.size is the AABB envelope; for a polygon centred on
        // origin with max-radius R, diameter = 2R fits the bound.
        targetSize = Math.max(2, 2 * Math.sqrt(maxR2));
      } else {
        targetSize = Math.max(2, deformedDiameter * spec.sizeFraction);
        scaledPts = this.generateMaterialShardPolygon(spec.variant, targetSize);
      }

      const mass = variantDef.spawn.sizeToMass(targetSize);

      // Per-shard launch angle — fan-spread the shards around the
      // impact direction so a multi-shard break visibly diverges.
      // For a single shard the spread is zero (centred on the
      // impact direction).  Bursts of 6+ shards use a wider cone
      // (≈ 2π × 0.9 ≈ 5.65 rad → full ring with a small gap) so
      // the shards splay out radially like a small explosion
      // rather than a thin fan.
      const fanWidth = expanded.length >= 6 ? Math.PI * 2 * 0.9 : 0.9;
      const fan = expanded.length > 1
        ? ((i / (expanded.length - 1)) - 0.5) * fanWidth
        : 0;
      const shardAngle = baseAngle + fan + (Math.random() - 0.5) * 0.3;
      lastShardAngle = shardAngle;

      // Radial spawn offset — scales with the PARENT TILE's
      // deformed diameter (not the shard size) so bursts cover the
      // tile area instead of stacking near its centre.  Plastic-
      // tile's 8–12 shard burst was clumping at the spawn point
      // before this fix; widening offsetDist + randomising the
      // radial position over [0.3, 1.0] × tile-half-diameter
      // smears the shards across the tile footprint.  Smaller
      // single-shard breaks (metal-tile 1.0× sizeFraction) keep
      // their tile-centred spawn since `expanded.length === 1`
      // zeroes the offset.
      const offsetDist = expanded.length > 1
        ? (deformedDiameter / 2) * (0.3 + Math.random() * 0.7)
        : 0;
      const offsetX = Math.cos(shardAngle) * offsetDist;
      const offsetY = Math.sin(shardAngle) * offsetDist;

      // Speed scales mildly with shard size — smaller fragments fly
      // a bit faster (lighter, gets a stronger kick from the same
      // impact).  Multiplier 1.0 at full size, 1.3 at 1/6 size.
      const speedScale = 1 + (1 - spec.sizeFraction) * 0.5;
      const launchSpeed = baseSpeed * speedScale;

      // Dent-policy shards take exactly as many hits to destroy as
      // the parent tile they came from — by default inherit
      // tile.maxHealth so plastic-shards / metal-shards are as
      // durable as their matching tile.  `shardHealthOverride`
      // (set when the dent variant declares `dent.shardHealth`)
      // decouples shard durability from tile face HP — plastic-
      // tile uses this so the tile is glass-brittle (1 HP) while
      // the released shards stay at 24 HP.  Non-dent variants
      // (rock-shard spawned from rock-tile's breakShards) keep
      // single-hit destruction, matching today's rock-shard /
      // glass-shard HP.
      const shardHealth = shardHealthOverride !== undefined
        ? shardHealthOverride
        : (variantDef.dent !== undefined ? (tile.maxHealth || 1) : 1);

      // Resolve colour once — plastic re-rolls its amber shade per
      // shard, everything else inherits from the tile.  Reused below
      // for both `color` and (plastic only) `wigglePhase`.
      const shardColor = spec.variant === 'plastic-shard'
        ? randomPlasticShade()
        : tile.color;
      // Spawn-time shape variance for plastic-shards — per-axis
      // random scale in [1 − V, 1 + V] so each shard reads as its
      // own slightly-irregular outline rather than a perfect circle.
      const isPlasticShardSpec = spec.variant === 'plastic-shard';
      const sv = PLASTIC_DEFORM_CONSTANTS.SPAWN_SHAPE_VARIANCE;
      const baseScaleX = isPlasticShardSpec ? (1 - sv + Math.random() * 2 * sv) : undefined;
      const baseScaleY = isPlasticShardSpec ? (1 - sv + Math.random() * 2 * sv) : undefined;

      entities.push({
        id:            nextId('dent_shard'),
        type:          EntityType.STRUCTURE,
        shardVariant:  spec.variant,
        position:      {
          x: tile.position.x + offsetX,
          y: tile.position.y + offsetY,
        },
        velocity:      {
          x: Math.cos(shardAngle) * launchSpeed,
          y: Math.sin(shardAngle) * launchSpeed,
        },
        size:          { x: targetSize, y: targetSize },
        // Inherit the parent tile's rotation when the shard clones its
        // polygon, so the freed silhouette draws at the exact angle the
        // tile was just at (no instant pop-rotate).  For shards whose
        // polygon is freshly generated, a random orientation reads more
        // like fragmentation, so keep that path random.
        rotation:      spec.inheritParentPolygon ? tile.rotation : Math.random() * Math.PI * 2,
        // Smaller shards spin faster — same angular-momentum-from-
        // impact logic as the speed scaling above.
        rotationSpeed: (Math.random() - 0.5) * (1.5 / Math.max(1, targetSize / 30)),
        // Plastic-shards re-roll their amber shade per-instance so
        // each shard in a burst reads as its own tone (see
        // PLASTIC_AMBER_SHADES in constants.ts).  Other variants
        // inherit the parent tile's colour as before.
        color:         shardColor,
        active:        true,
        health:        shardHealth,
        maxHealth:     shardHealth,
        mass,
        polygonPoints: scaledPts,
        // Optional per-entity damping from the variant's spawn shape
        // — today plastic-shard sets these so cluster motion damps
        // out quickly.  Undefined for variants that drift naturally
        // (rock / metal).  restSpeed / restSpin raise the "snap-
        // to-zero" floor PhysicsSystem applies after damping so
        // tiny residual drifts get culled and the shard stays
        // motionless unless directly disturbed.
        linearDamping:  variantDef.spawn.linearDamping,
        angularDamping: variantDef.spawn.angularDamping,
        restSpeed:      variantDef.spawn.restSpeed,
        restSpin:       variantDef.spawn.restSpin,
        // Plastic-shard wiggle phase derived from the shard's amber
        // shade so each colour wiggles with a distinct offset (see
        // WIGGLE_CONSTANTS).  Other variants don't wiggle.
        wigglePhase:   spec.variant === 'plastic-shard' ? colorToWigglePhase(shardColor) : undefined,
        // Plastic-shard spawn-time shape variance (option B).
        baseScaleX,
        baseScaleY,
        // Plastic-shard sticky-bond anchor — PhysicsSystem pulls each
        // shard toward this rest position every substep, so the cluster
        // can be shoved off-anchor by continuous force but returns when
        // the force releases.  Anchor sits at the spawn position.
        anchorX: isPlasticShardSpec ? (tile.position.x + offsetX) : undefined,
        anchorY: isPlasticShardSpec ? (tile.position.y + offsetY) : undefined,
        // Let dent-break debris (rock-tile breakShards, etc.) scatter
        // before the overlap-collapse pass can re-condense it.
        collapseGraceTimer: getActiveShatterGraceDelay(),
      });
    }

    // Single particle puff for the detach event, aimed along the
    // last shard's launch direction.  Material colour comes from the
    // first shard's variant (plastic / metal always agree across
    // entries today).
    const firstVariant = expanded[0].variant;
    const puffColor = firstVariant === 'plastic-shard' ? '#b45309' : '#cbd5e1';
    this.particles.spawn(entities, tile.position, 5, puffColor, {
      speedMin: 1.5, speedMax: 4, sizeMin: 1, sizeMax: 2,
      lifetimeMin: 0.15, lifetimeMax: 0.35,
      spreadAngle: lastShardAngle, spreadCone: Math.PI * 0.6,
    });
  }

  /**
   * Spawn a single mobile shard whose polygon is the supplied triangle
   * (3 vertices in tile-local coords).  Used by the triangle-delete
   * dent variant (today: rock-tile): when a vertex is removed from the
   * tile's polygon, this method takes the freshly-deleted corner
   * (the closest vertex + its two adjacent vertices) and turns it into
   * a mobile shard at the same world location with the same shape.
   *
   * Spawn position is the triangle's centroid in world coords; the
   * shard's polygonPoints are the triangle re-centred around that
   * centroid so the shard's origin sits inside its silhouette.  Mass
   * scales with size via the variant's spawn.sizeToMass.  Launch
   * direction inherits lastImpactVelocity with a small random scatter.
   */
  public spawnTriangleShard(
    entities: GameEntity[],
    tile: GameEntity,
    triangleLocalPts: Vector2[],
    childVariant: ShardVariantId,
  ) {
    if (triangleLocalPts.length !== 3) return;
    const variantDef = SHARD_VARIANTS[childVariant];

    // Triangle centroid in tile-local coords — used as the spawn
    // position (offset from tile.position).
    let cx = 0, cy = 0;
    for (let i = 0; i < 3; i++) {
      cx += triangleLocalPts[i].x;
      cy += triangleLocalPts[i].y;
    }
    cx /= 3;
    cy /= 3;

    // Triangle area via the 2D cross product.  Used to derive a
    // shard size whose effective area matches the deleted corner,
    // so the freed piece visually fits the gap it came from.
    const triArea = Math.abs(
      (triangleLocalPts[1].x - triangleLocalPts[0].x)
        * (triangleLocalPts[2].y - triangleLocalPts[0].y)
      - (triangleLocalPts[2].x - triangleLocalPts[0].x)
        * (triangleLocalPts[1].y - triangleLocalPts[0].y),
    ) / 2;
    // Solve area = k × r² for r, where k is the unit-circumradius
    // area of a regular n-gon for the spawned variant.  For n=5
    // (rock-shard default) k ≈ 2.378; for n=3 k ≈ 1.299, n=4 ≈ 2.0,
    // n=6 ≈ 2.598.  Approximation is loose — we want "roughly the
    // same size," not exact area match.
    const spawn = variantDef.spawn;
    const polyN = (spawn.polyVerticesMin + spawn.polyVerticesMax) / 2;
    const kArea = (polyN / 2) * Math.sin(2 * Math.PI / polyN);
    const targetR = Math.max(2, Math.sqrt(triArea / kArea));
    const targetSize = targetR * 2;

    // Shard polygon from the variant's spawn config (vertex count +
    // shape per material — rock-shard is 5 verts irregular, etc.).
    const shardPts = this.generateMaterialShardPolygon(childVariant, targetSize);

    let halfW = 0, halfH = 0;
    for (let i = 0; i < shardPts.length; i++) {
      const ax = Math.abs(shardPts[i].x);
      const ay = Math.abs(shardPts[i].y);
      if (ax > halfW) halfW = ax;
      if (ay > halfH) halfH = ay;
    }
    const sizeX = Math.max(2, halfW * 2);
    const sizeY = Math.max(2, halfH * 2);
    const size  = Math.max(sizeX, sizeY);
    const mass  = variantDef.spawn.sizeToMass(size);

    const iv = tile.lastImpactVelocity;
    const impactSpeed = iv ? Math.sqrt(iv.x * iv.x + iv.y * iv.y) : 0;
    const baseAngle = impactSpeed > 0.001
      ? Math.atan2(iv!.y, iv!.x)
      : Math.random() * Math.PI * 2;
    // Mild speed inherited from the projectile so the freed triangle
    // pops off rather than launches.
    const launchSpeed = 0.3 + Math.min(impactSpeed * 0.05, 1.5);
    const launchAngle = baseAngle + (Math.random() - 0.5) * 0.3;

    entities.push({
      id:            nextId('triangle_shard'),
      type:          EntityType.STRUCTURE,
      shardVariant:  childVariant,
      position:      {
        x: tile.position.x + cx,
        y: tile.position.y + cy,
      },
      velocity:      {
        x: Math.cos(launchAngle) * launchSpeed,
        y: Math.sin(launchAngle) * launchSpeed,
      },
      size:          { x: sizeX, y: sizeY },
      rotation:      Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * (1.5 / Math.max(1, size / 30)),
      color:         tile.color,
      active:        true,
      health:        1,
      maxHealth:     1,
      mass,
      polygonPoints: shardPts,
      // Freed corner — exempt from instant re-collapse.
      collapseGraceTimer: getActiveShatterGraceDelay(),
    });

    // Small puff at the spawn point so the detach reads as a discrete
    // event rather than a tile silently losing a corner.
    this.particles.spawn(entities, {
      x: tile.position.x + cx,
      y: tile.position.y + cy,
    }, 4, tile.color, {
      speedMin: 1.5, speedMax: 3.5, sizeMin: 1, sizeMax: 2,
      lifetimeMin: 0.15, lifetimeMax: 0.3,
      spreadAngle: launchAngle, spreadCone: Math.PI * 0.6,
    });
  }

  /**
   * Spawn one mobile shard at a specific world position (typically
   * the impact point of a projectile / crash).  Used by dent
   * variants whose policy includes a `perHitShard` entry so every
   * hit releases a small chunk of material — today rock uses this
   * for the brittle "chip-off" feel.
   *
   * Size matches the deformed tile's effective diameter × spec
   * sizeFraction (same convention as spawnDentShard's breakShards
   * sizing), so the per-hit shard scales down with deformation as
   * the tile is worn away.  Polygon comes from
   * generateMaterialShardPolygon — variant's vertex count + jitter
   * profile (rock = 5/7/9 verts, organic).
   */
  public spawnPerHitShard(
    entities: GameEntity[],
    tile: GameEntity,
    spec: { variant: ShardVariantId; sizeFraction: number },
    spawnWorldPos: Vector2,
  ) {
    const variantDef = SHARD_VARIANTS[spec.variant];

    // Deformed-diameter baseline — same proxy as spawnDentShard's
    // avgVertexRadius math so the per-hit shard tracks the tile's
    // current state of wear.  Falls back to entity.size when the
    // polygon is missing.
    const baseSize = Math.max(tile.size.x, tile.size.y);
    let avgR = baseSize / 2;
    if (tile.polygonPoints && tile.polygonPoints.length > 0) {
      let sumR2 = 0;
      for (let i = 0; i < tile.polygonPoints.length; i++) {
        const p = tile.polygonPoints[i];
        sumR2 += p.x * p.x + p.y * p.y;
      }
      avgR = Math.sqrt(sumR2 / tile.polygonPoints.length);
    }
    const deformedDiameter = avgR * 2;

    const targetSize = Math.max(2, deformedDiameter * spec.sizeFraction);
    const shardPts = this.generateMaterialShardPolygon(spec.variant, targetSize);
    const mass = variantDef.spawn.sizeToMass(targetSize);

    const iv = tile.lastImpactVelocity;
    const impactSpeed = iv ? Math.sqrt(iv.x * iv.x + iv.y * iv.y) : 0;
    const baseAngle = impactSpeed > 0.001
      ? Math.atan2(iv!.y, iv!.x)
      : Math.random() * Math.PI * 2;
    const launchSpeed = 0.3 + Math.min(impactSpeed * 0.05, 1.5);
    const launchAngle = baseAngle + (Math.random() - 0.5) * 0.4;

    entities.push({
      id:            nextId('per_hit_shard'),
      type:          EntityType.STRUCTURE,
      shardVariant:  spec.variant,
      position:      { x: spawnWorldPos.x, y: spawnWorldPos.y },
      velocity:      {
        x: Math.cos(launchAngle) * launchSpeed,
        y: Math.sin(launchAngle) * launchSpeed,
      },
      size:          { x: targetSize, y: targetSize },
      rotation:      Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * (1.5 / Math.max(1, targetSize / 30)),
      color:         tile.color,
      active:        true,
      health:        1,
      maxHealth:     1,
      mass,
      polygonPoints: shardPts,
      // Per-hit chip — also exempt from instant re-collapse.
      collapseGraceTimer: getActiveShatterGraceDelay(),
    });

    // Subtle puff at the chip-off point in the tile's colour.
    this.particles.spawn(entities, spawnWorldPos, 3, tile.color, {
      speedMin: 1.5, speedMax: 3.0, sizeMin: 1, sizeMax: 1.8,
      lifetimeMin: 0.12, lifetimeMax: 0.25,
      spreadAngle: launchAngle, spreadCone: Math.PI * 0.6,
    });
  }

  /**
   * Spawn a nebula-shard at a world position with a colour override.
   * Used by destructible tiles / shards that want a cloud-style
   * fragment to drift away alongside the regular solid debris — rock
   * tiles release one per hit, glass tiles release 1-2 on shatter,
   * etc.  The shard inherits the nebula damping + spawn fade-in so
   * it reads as "cloud" visually, but its `color` is forced to the
   * caller's hex (no palette composition) so it tints to the parent
   * material rather than the default nebula palette.
   *
   * `baseSize` is the source entity's effective diameter (rock-tile,
   * rock-shard, glass-tile size, etc.); shard size = baseSize ×
   * sizeFraction.  Inherits `inheritVelocity` for the launch
   * direction (typically the parent's lastImpactVelocity), falling
   * back to a random direction.
   */
  public spawnColoredNebulaShard(
    entities: GameEntity[],
    spawnWorldPos: Vector2,
    baseSize: number,
    color: string,
    sizeFraction: number = 0.5,
    inheritVelocity?: Vector2,
    composition?: NebulaColorStop[],
  ) {
    const variantDef = SHARD_VARIANTS['nebula-shard'];
    const targetSize = Math.max(4, baseSize * sizeFraction);
    const shardPts = this.generateMaterialShardPolygon('nebula-shard', targetSize);
    const mass = variantDef.spawn.sizeToMass(targetSize);

    // Resolve the entity's palette state.  Callers either pass a
    // composition (preferred — material-specific palette stops drive
    // both the initial render colour AND the color-equilibration
    // pass) or a single hex (legacy — wrapped into a single-stop
    // composition so the shard still participates in equilibration
    // instead of staying frozen at its spawn colour).
    const resolvedComposition: NebulaColorStop[] = composition
      ? cloneComposition(composition)
      : [{ hex: color, weight: 1 }];
    const resolvedColor = composition ? blendCompositionToHex(resolvedComposition) : color;

    // Pick a nebula sprite at random — required for the renderer's
    // tinted-sprite path (cloud silhouette via getTintedSprite +
    // _tintedSprites cache).  Without sprite the shard renders only
    // its polygon outline (visible only in debug mode).  Falls back
    // to the procedural puff marker if the manifest is empty.
    const sprite = NEBULA_IMAGES.length > 0
      ? NEBULA_IMAGES[Math.floor(Math.random() * NEBULA_IMAGES.length)]
      : ASSETS.NEBULA_PUFF;

    const impactSpeed = inheritVelocity
      ? Math.sqrt(inheritVelocity.x * inheritVelocity.x + inheritVelocity.y * inheritVelocity.y)
      : 0;
    const hasImpact = impactSpeed > 0.001;
    const baseAngle = hasImpact
      ? Math.atan2(inheritVelocity!.y, inheritVelocity!.x)
      : Math.random() * Math.PI * 2;
    // Fan the shards in a wide cone around the hit direction (full
    // circle when there's no impact) AND give each its own speed, so a
    // multi-shard break sprays apart instead of travelling as one
    // parallel clump that lands in the same spot.
    const spreadCone = hasImpact ? 1.5 : Math.PI * 2; // ±~43° around the hit dir
    const launchAngle = baseAngle + (Math.random() - 0.5) * spreadCone;
    const baseSpeed = 0.4 + Math.min(impactSpeed * 0.04, 1.2);
    const launchSpeed = baseSpeed * (0.4 + Math.random() * 1.4); // 0.4×–1.8× per shard

    entities.push({
      id:                  nextId('colored_nebula_shard'),
      type:                EntityType.STRUCTURE,
      shardVariant:        'nebula-shard',
      position:            { x: spawnWorldPos.x, y: spawnWorldPos.y },
      velocity:            {
        x: Math.cos(launchAngle) * launchSpeed,
        y: Math.sin(launchAngle) * launchSpeed,
      },
      size:                { x: targetSize, y: targetSize },
      rotation:            Math.random() * Math.PI * 2,
      rotationSpeed:       (Math.random() - 0.5) * (1.2 / Math.max(1, targetSize / 30)),
      color:               resolvedColor,
      nebulaColorComposition: resolvedComposition,
      sprite,
      active:              true,
      health:              1,
      maxHealth:           1,
      mass,
      polygonPoints:       shardPts,
      // Nebula damping so the shard drifts like a cloud and decelerates
      // gradually instead of carrying full inertia.
      linearDamping:       NEBULA_CONSTANTS.LINEAR_DAMPING,
      angularDamping:      NEBULA_CONSTANTS.ANGULAR_DAMPING,
      // Birth fade-in so the shard ramps in opacity instead of
      // popping at full alpha.  Duration matches the standard nebula
      // shatter spawn duration.
      nebulaSpawnTimer:    NEBULA_CONSTANTS.FADE_IN_DURATION,
      nebulaSpawnDuration: NEBULA_CONSTANTS.FADE_IN_DURATION,
    });
  }

  // --- Collectible drop spawning ------------------------------------------

  /**
   * Spawn a single collectible shared-ammo drop and register it in
   * `activeDrops`.  All ammo drops use the same canonical pickup colour;
   * post-d1 there is no per-weapon variant.
   */
  public spawnAmmoDrop(
    entities: GameEntity[],
    activeDrops: GameEntity[],
    pos: Vector2,
    amount: number,
    parentVelocity?: Vector2,
  ) {
    if (activeDrops.length >= DROP_CONFIG.MAX_ACTIVE_DROPS) return;
    const drop = this.makeDropEntity(
      nextId('drop_ammo'),
      pos,
      parentVelocity,
      AMMO_CONSTANTS.DROP_COLOR,
      amount,
      'ammo',
    );
    drop.polygonPoints = this.generateShardPolygon('ammo', Math.min(9, Math.max(4, 3.5 + amount * 0.2)));
    entities.push(drop);
    activeDrops.push(drop);
  }

  /** Spawn a static (mass=Infinity) health drop at `pos`. */
  public spawnHealthDrop(
    entities: GameEntity[],
    activeDrops: GameEntity[],
    pos: Vector2,
    value: number,
    _parentVelocity?: Vector2,
  ) {
    if (activeDrops.length >= DROP_CONFIG.MAX_ACTIVE_DROPS) return;
    const drop: GameEntity = {
      id:          nextId('drop_health'),
      type:        EntityType.INTERACTABLE,
      position:    { x: pos.x, y: pos.y },
      velocity:    { x: 0, y: 0 },
      size:        { x: 48, y: 48 },
      rotation:    0,
      rotationSpeed: 0,
      color:       '#ef4444',
      active:      true,
      health:      1,
      maxHealth:   1,
      mass:        Infinity, // static — never moved by physics or flow field
      dropType:    'health',
      dropValue:   value,
    };
    entities.push(drop);
    activeDrops.push(drop);
  }

  // --- Shard / drop polygon helpers ---------------------------------------

  /**
   * Generate an irregular shard polygon for a drop.  baseR controls visual
   * size and should scale with the drop's value so larger-value drops are
   * physically bigger.
   */
  /**
   * Procedurally generate a polygon for a material shard, sized to
   * `targetDiameter` and shaped per the variant's spawn config.
   *
   * Vertex count, angle jitter, and radius variance all come from
   * SHARD_VARIANTS[variant].spawn — see constants.ts for the per-
   * material settings:
   *   glass-shard:   3 verts, sharp / narrow (sharp angles, high
   *                  radius variance → elongated splinters)
   *   plastic-shard: 4 verts, near-square (low jitter + variance)
   *   rock-shard:    5 verts, organic / irregular
   *   metal-shard:   6 verts, clean hex-like (low jitter + variance)
   *
   * Output is centred at (0, 0) and sorted by angle so the polygon
   * is simple (non-self-intersecting).
   */
  public generateMaterialShardPolygon(variant: ShardVariantId, targetDiameter: number): Vector2[] {
    const spawn = SHARD_VARIANTS[variant].spawn;
    // Discrete vertex-count list (polyVerticesOptions) takes priority
    // over the continuous Min/Max range — used by rock-shard
    // ([5, 7, 9]) and metal-shard ([6, 8, 10]) to keep their
    // silhouettes snapped to specific counts.
    const numVerts = spawn.polyVerticesOptions
      ? spawn.polyVerticesOptions[Math.floor(Math.random() * spawn.polyVerticesOptions.length)]
      : spawn.polyVerticesMin
        + Math.floor(Math.random() * (spawn.polyVerticesMax - spawn.polyVerticesMin + 1));
    const baseR = targetDiameter / 2;
    const rawPts: { angle: number; r: number }[] = [];
    for (let i = 0; i < numVerts; i++) {
      const baseAngle = (i / numVerts) * Math.PI * 2;
      const jitter = (Math.random() - 0.5) * (Math.PI / numVerts) * spawn.angleJitter * 2;
      const radiusFrac = spawn.radiusMin + Math.random() * spawn.radiusRange;
      rawPts.push({ angle: baseAngle + jitter, r: baseR * radiusFrac });
    }
    rawPts.sort((a, b) => a.angle - b.angle);
    return rawPts.map(p => ({ x: Math.cos(p.angle) * p.r, y: Math.sin(p.angle) * p.r }));
  }

  public generateShardPolygon(type: 'ammo' | 'health', baseR: number): Vector2[] {
    let numPoints: number;
    let radMin: number;
    let radMax: number;
    let angleJitterScale: number;
    if (type === 'ammo') {
      numPoints = 5 + Math.floor(Math.random() * 3);   // 5-7, jagged crystal
      radMin = 0.55; radMax = 1.25; angleJitterScale = 0.65;
    } else if (type === 'health') {
      numPoints = 6 + Math.floor(Math.random() * 3);   // 6-8, organic blob
      radMin = 0.45; radMax = 1.3; angleJitterScale = 0.5;
    } else {
      numPoints = 5 + Math.floor(Math.random() * 2);   // 5-6, crystal
      radMin = 0.65; radMax = 1.15; angleJitterScale = 0.4;
    }
    const rawPts: { angle: number; r: number }[] = [];
    for (let i = 0; i < numPoints; i++) {
      const baseAngle = (i / numPoints) * Math.PI * 2;
      const jitter = (Math.random() - 0.5) * (Math.PI / numPoints) * 2 * angleJitterScale;
      rawPts.push({ angle: baseAngle + jitter, r: baseR * (radMin + Math.random() * (radMax - radMin)) });
    }
    rawPts.sort((a, b) => a.angle - b.angle);
    return rawPts.map(p => ({ x: Math.cos(p.angle) * p.r, y: Math.sin(p.angle) * p.r }));
  }

  /** Create a generic collectible-drop entity skeleton. */
  private makeDropEntity(
    id: string, pos: Vector2, pv: Vector2 | undefined,
    color: string, value: number, dropType: 'ammo' | 'health',
  ): GameEntity {
    const scatter = 20;
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 0.5 + Math.random() * 1.5;
    const r       = Math.min(10, Math.max(4, 3.5 + value * 0.075));
    return {
      id, type: EntityType.INTERACTABLE,
      position: { x: pos.x + (Math.random() - 0.5) * scatter * 2, y: pos.y + (Math.random() - 0.5) * scatter * 2 },
      velocity: { x: (pv?.x ?? 0) * 0.3 + Math.cos(angle) * speed, y: (pv?.y ?? 0) * 0.3 + Math.sin(angle) * speed },
      size: { x: r * 3, y: r * 3 },
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 2 * 2.5,
      color, active: true, health: 1, maxHealth: 1, mass: 5,
      dropType, dropValue: value,
      polygonPoints: [],
    };
  }
}
