// ShardSystem — orchestrator for tile / shard regen, shatter, and merge.
//
// Stage 1: skeleton with no-op update / onDeath.
// Stage 2 (this stage): owns the unified regen queue.  Both STRUCTURE-tile
// and NEBULA-tile regens flow through `queueRegen` + `tickRegens`,
// driven by `SHARD_VARIANTS[variantId].regen`.  Variant-specific
// completion work (nebula composition rewrite, cache invalidation,
// neighbour-counts dirty bookkeeping) is dispatched via a small
// adapter interface implemented by NebulaSystem.
//
// Subsequent stages migrate shatter (Stage 3), homogeneous merge
// (Stage 4), then the EntityType collapse + cross-variant absorb
// (Stage 5).  See docs/SHARD_SYSTEM.md.

import { GameEntity, EntityType } from '../../types';
import { SHARD_VARIANTS, REGEN_POP_CONSTANTS } from '../../constants';
import { ParticleSystem } from './ParticleSystem';
import { PhysicsSystem } from './PhysicsSystem';
import { ShardVariantId, ShardRegenAdapter } from './ShardSystem.types';

/**
 * Resolve an entity's variant id.  Reads the legacy `shardType` /
 * `structureVariant` fields when `shardVariant` is unset (stage 5+
 * stamps the field directly on every spawn site).
 *
 * Returns `null` for non-shard-family entities (PLAYER, ENEMY,
 * PROJECTILE, INTERACTABLE, PARTICLE).  Callers who only need the
 * variant of known shard-family entities can assert non-null.
 */
export function shardVariantOf(entity: GameEntity): ShardVariantId | null {
  if (entity.shardVariant !== undefined) return entity.shardVariant;

  switch (entity.type) {
    case EntityType.STRUCTURE: {
      const v = entity.structureVariant;
      if (v === 'reinforced')     return 'reinforced-tile';
      if (v === 'heavy')          return 'heavy-tile';
      if (v === 'indestructible') return 'indestructible-tile';
      // Default (unset or 'glass') — today's STRUCTURE-default = glass.
      return 'glass-tile';
    }
    case EntityType.ASTEROID: {
      const s = entity.shardType;
      if (s === 'tile')   return 'glass-shard';
      if (s === 'nebula') return 'nebula-shard';
      // Default (unset or 'asteroid') — today's free-floating asteroids.
      return 'rock-shard';
    }
    case EntityType.NEBULA:
      return 'nebula-tile';
    case EntityType.NEBULA_SHARD:
      return 'nebula-shard';
    default:
      return null;
  }
}

/**
 * Per-entity regen entry.  `delaySeconds` is captured from the
 * variant config at queue time so the per-tick progress calculation
 * doesn't have to re-resolve the variant.
 */
interface RegenEntry {
  entity: GameEntity;
  timer: number;
  delaySeconds: number;
  variantId: ShardVariantId;
}

export class ShardSystem {
  /**
   * Regen queue — replaces the two separate queues that lived on
   * GameEngine (STRUCTURE tiles) and NebulaSystem (NEBULA tiles).
   * Driven by `SHARD_VARIANTS[variantId].regen` at completion time.
   */
  private pending: RegenEntry[] = [];

  /**
   * Optional adapter providing variant-specific completion hooks.
   * Today only the nebula-tile path uses it (composition rewrite +
   * cache invalidation + neighbour-counts dirty).  Non-nebula
   * regens never call into the adapter, so STRUCTURE-tile regen
   * works regardless of whether one is wired.
   */
  private regenAdapter: ShardRegenAdapter | null = null;

  constructor(private particles: ParticleSystem) {}

  /** Wire a variant-specific completion adapter.  Called once at
   *  GameEngine construction after NebulaSystem is built. */
  public setRegenAdapter(adapter: ShardRegenAdapter): void {
    this.regenAdapter = adapter;
  }

  /**
   * Per-frame tick.  Called from GameEngine.updateGameLogic at the
   * fixed-step dt.  Stage 2: ticks the unified regen queue.  Future
   * stages add the shatter / merge passes.
   */
  public update(entities: GameEntity[], dt: number, physics: PhysicsSystem): void {
    this.tickRegens(entities, dt, physics);
  }

  /**
   * Death-routing entry point.  Stage 1–2: returns false (existing
   * GameEngine paths still own death dispatch).  Stage 5 will route
   * variant-driven shatter through here.
   */
  public onDeath(_entity: GameEntity): boolean {
    return false;
  }

  /**
   * Hard reset — called on game restart so a fresh run doesn't
   * inherit queued regens / bonds from the previous session.
   */
  public reset(): void {
    this.pending.length = 0;
  }

  // ── Regen queue ───────────────────────────────────────────────────

  /**
   * Queue an entity for regen if its variant supports it.  Reads
   * `variant.regen.kind` / `delaySeconds` from `SHARD_VARIANTS`.
   * No-op if the variant's regen is `'none'` or `'merge-only'`, so
   * callers (handleEntityDeath, NebulaSystem.handleDeath) can call
   * unconditionally and let the variant config decide.
   *
   * Mirrors today's populate-site contract: sets `regenProgress = 0`
   * on the entity so the renderer draws a ghost outline during the
   * regen wait.
   */
  public queueRegen(entity: GameEntity): void {
    const variantId = shardVariantOf(entity);
    if (variantId === null) return;
    const variant = SHARD_VARIANTS[variantId];
    if (variant.regen.kind !== 'timer') return;
    const delay = variant.regen.delaySeconds;
    if (delay === undefined || delay <= 0) return;

    entity.regenProgress = 0;
    this.pending.push({
      entity,
      timer: delay,
      delaySeconds: delay,
      variantId,
    });
  }

  /**
   * Drain the regen queue: per-tick timer decrement, per-frame
   * `regenProgress` update for the renderer, and on completion the
   * variant-driven revive (health/active reset, optional pop-burst
   * particles, optional neighbourhood-blend hook, static-grid
   * re-add).
   */
  private tickRegens(entities: GameEntity[], dt: number, physics: PhysicsSystem): void {
    if (this.pending.length === 0) return;

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const regen = this.pending[i];
      regen.timer -= dt;
      regen.entity.regenProgress = 1 - (regen.timer / regen.delaySeconds);

      if (regen.timer <= 0) {
        this.completeRegen(regen, entities, physics);
        this.pending.splice(i, 1);
      }
    }
  }

  /** Revive a single entity at regen completion. */
  private completeRegen(regen: RegenEntry, entities: GameEntity[], physics: PhysicsSystem): void {
    const entity = regen.entity;
    const variant = SHARD_VARIANTS[regen.variantId];

    entity.health = entity.maxHealth;
    entity.active = true;
    entity.regenProgress = undefined;

    // Variant-specific completion hook (nebula composition rewrite
    // + cache invalidation + neighbour-counts dirty bookkeeping +
    // grid-index update).  Adapter no-ops gracefully when not set.
    if (variant.regen.rewriteColor === 'neighborhood-blend') {
      this.regenAdapter?.onNeighborhoodBlendRegen(entity, entities);
    }

    // Re-register in the static grid so collisions hit again.  Both
    // STRUCTURE and NEBULA tiles need this — today both code paths
    // call physics.addStaticEntity at completion.
    physics.addStaticEntity(entity);

    // Variant-driven pop animation: STRUCTURE tiles emit a chip
    // burst of tile-coloured particles; nebula tiles use the
    // fade-in via nebulaSpawnTimer (set inside the adapter).
    const popBurst = variant.regen.popBurst;
    if (popBurst) {
      entity.regenPopTimer = REGEN_POP_CONSTANTS.DURATION;
      this.particles.spawn(entities, entity.position, popBurst.chipCount, entity.color || '#6366f1', {
        speedMin: popBurst.chipSpeedMin,
        speedMax: popBurst.chipSpeedMax,
        lifetimeMin: popBurst.chipLifetime,
        lifetimeMax: popBurst.chipLifetime,
        sizeMin: 1, sizeMax: 2,
      });
    }
  }
}
