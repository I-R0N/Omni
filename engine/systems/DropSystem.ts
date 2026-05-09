import { GameEntity, EntityType, Vector2 } from '../../types';
import { ShardVariantId } from './ShardSystem.types';
import {
  COLORS,
  AMMO_CONSTANTS,
  DROP_CONFIG,
} from '../../constants';
import { ParticleSystem } from './ParticleSystem';
import { nextId } from './IdAllocator';

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

    // Shard-family entities are all EntityType.STRUCTURE.  Distinguish
    // glass-family static tile (glass / reinforced / heavy — produce
    // glass-shard debris on death) from rock-tile (own ShardSystem
    // shatter path produces rock-shards) and mobile shards (asteroid-
    // like drop logic).
    const isStaticTile  = entity.type === EntityType.STRUCTURE && entity.mass === Infinity;
    const isGlassFamilyTile = isStaticTile
      && (entity.shardVariant === 'glass-tile'
          || entity.shardVariant === 'reinforced-tile'
          || entity.shardVariant === 'heavy-tile');
    const isMobileShard = entity.type === EntityType.STRUCTURE && entity.mass !== Infinity;
    if (isGlassFamilyTile) {
      // Glass / reinforced / heavy tile death — visual debris.
      // Indestructible tiles short-circuit upstream; rock-tile spawns
      // its own rock-shards via ShardSystem.shatter; nebula-tile
      // skips drops via variant.spawnsDropsOnDeath = false.
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
      } else if (Math.random() < DROP_CONFIG.AMMO_DROP_CHANCE_ASTEROID) {
        // Generic shared-ammo drop — single rate for every asteroid
        this.spawnAmmoDrop(entities, activeDrops, pos, DROP_CONFIG.AMMO_PER_ASTEROID, pv);
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
        mass:          size,
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

      // Tile shard polygon — 4–6 vertices, low angular jitter, moderate
      // radius variation.  More blocky/faceted than asteroid shards (which
      // use 5–7 pts with higher jitter) to hint at their manufactured origin.
      const numPoints = 4 + Math.floor(Math.random() * 3);
      const rawPts: { angle: number; r: number }[] = [];
      for (let j = 0; j < numPoints; j++) {
        const baseAngle = (j / numPoints) * Math.PI * 2;
        const jitter    = (Math.random() - 0.5) * (Math.PI / numPoints) * 0.25;
        rawPts.push({ angle: baseAngle + jitter, r: radius * (0.6 + Math.random() * 0.55) });
      }
      rawPts.sort((a, b) => a.angle - b.angle);
      const pts: Vector2[] = rawPts.map(p => ({ x: Math.cos(p.angle) * p.r, y: Math.sin(p.angle) * p.r }));

      const size = radius * 4; // diameter; slightly larger so physics feel solid
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
        mass:           size,
        polygonPoints:  pts,
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
