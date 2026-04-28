// ShardSystem — orchestrator for tile / shard regen, shatter, and merge.
//
// Stage 1 (this file): purely additive skeleton.  Public methods exist
// but the existing GameEngine / NebulaSystem code paths still own
// regen / shatter / merge — ShardSystem.update() and onDeath() are
// no-ops.  Subsequent stages migrate the behaviour over (see §10 of
// docs/SHARD_SYSTEM.md).
//
// State that lives here once the migration is complete:
//   - regen queue (today: GameEngine.pendingRegens + NebulaSystem.pendingRegens)
//   - stick-bond list (today: GameEngine.stickBonds)
//   - per-frame shard spatial hash (today: two separate grids in
//     GameEngine.handleEntitySticking and NebulaSystem.updateDynamics)
//
// State that stays elsewhere:
//   - velocity-integration ticks (PhysicsSystem)
//   - per-entity damping decrements (PhysicsSystem)
//   - render fast-path cache invalidation (NebulaSystem adapter)
//   - DropSystem behaviour (delegated as-is by spawnsDropsOnDeath)

import { GameEntity, EntityType } from '../../types';
import { ParticleSystem } from './ParticleSystem';
import { PhysicsSystem } from './PhysicsSystem';
import { ShardVariantId } from './ShardSystem.types';

/**
 * Resolve an entity's variant id.  Stage 1 reads the legacy
 * `shardType` / `structureVariant` fields; Stage 5 will stamp
 * `shardVariant` directly at every spawn site, after which this
 * helper short-circuits to that field.
 *
 * Returns `null` for non-shard-family entities (PLAYER, ENEMY,
 * PROJECTILE, INTERACTABLE, PARTICLE).  Callers who only need the
 * variant of known shard-family entities can assert non-null.
 */
export function shardVariantOf(entity: GameEntity): ShardVariantId | null {
  // Future-proof: once Stage 5 stamps the field, prefer it.
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

export class ShardSystem {
  // Constructor signature mirrors NebulaSystem — particle injection is
  // the dependency the merged-in code paths will need once stages 2–5
  // land.  Stage 1 doesn't read it yet but keeps the wiring stable.
  constructor(private particles: ParticleSystem) {}

  /**
   * Per-frame tick.  Called from GameEngine.updateGameLogic at the
   * fixed-step dt.  Stage 1: no-op — existing systems still own all
   * regen / shatter / merge code paths.
   */
  public update(_entities: GameEntity[], _dt: number, _physics: PhysicsSystem): void {
    // No-op until Stage 2 migrates regen, Stage 3 migrates shatter,
    // Stage 4 migrates homogeneous merge, and Stage 5 migrates the
    // EntityType collapse + cross-variant absorb.
  }

  /**
   * Death-routing entry point.  GameEngine.handleEntityDeath calls
   * this for every entity death; in Stage 1 it returns false to
   * indicate "not handled — fall through to the existing engine
   * paths".  Future stages will return true when the variant config
   * has fully described the death-time behaviour for the entity.
   */
  public onDeath(_entity: GameEntity): boolean {
    return false;
  }

  /**
   * Hard reset — called on game restart so a fresh run doesn't
   * inherit queued regens / bonds from the previous session.  Stage
   * 1: no-op (no internal state yet).
   */
  public reset(): void {
    // No-op until later stages own state.
  }
}
