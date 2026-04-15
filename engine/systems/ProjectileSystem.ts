import { GameEntity, EntityType, Vector2, WeaponConfig, WeaponType } from '../../types';
import {
  PROJECTILE_CONSTANTS,
  SPRITE_CONSTANTS,
  LIGHTNING_GRAVITY_STRENGTH,
  LIGHTNING_GRAVITY_RANGE,
  HOMING_ACQUIRE_RANGE,
  MAX_PROJECTILES,
} from '../../constants';
import { nextId } from './IdAllocator';

/**
 * ProjectileSystem — owns projectile lifecycle: spawning, homing steering,
 * lightning gravity attraction, and the hard cap on active projectiles.
 *
 * Extracted from GameEngine in Phase 2 of the engine upgrade.  Stateless;
 * callers provide the entity list the projectiles should be appended to and
 * read from.
 */
export class ProjectileSystem {
  /**
   * Spawn `config.count` projectile entities from `shooter` toward `target`.
   * Returns the number spawned so callers can update recoil / muzzle state.
   * The shooter's velocity is mutated in place for player recoil — mirrors
   * the original GameEngine behavior.
   */
  public spawn(
    entities: GameEntity[],
    shooter: GameEntity,
    target: Vector2,
    config: WeaponConfig,
    ownerType: EntityType
  ) {
    const angle = Math.atan2(target.y - shooter.position.y, target.x - shooter.position.x);

    // Only apply recoil to player for now
    if (ownerType === EntityType.PLAYER) {
      const recoilImpulse = (PROJECTILE_CONSTANTS.MASS * config.speed * config.recoil) / (shooter.mass || 1);
      shooter.velocity.x -= Math.cos(angle) * recoilImpulse;
      shooter.velocity.y -= Math.sin(angle) * recoilImpulse;
    }

    const halfSpread = (config.spread * (Math.PI / 180)) / 2;

    for (let i = 0; i < config.count; i++) {
      let currentAngle = angle;
      if (config.count > 1) {
        const step = (halfSpread * 2) / (config.count - 1);
        currentAngle = (angle - halfSpread) + (step * i);
      } else if (config.spread > 0) {
        currentAngle += (Math.random() - 0.5) * (config.spread * (Math.PI / 180));
      }

      const vx = Math.cos(currentAngle) * config.speed;
      const vy = Math.sin(currentAngle) * config.speed;

      const pSize = {
        x: config.size * 2.5,
        y: config.size * 0.4,
      };

      // Spawn slightly forward from the ship nose based on entity size
      const muzzleBase = Math.max(shooter.size?.x || SPRITE_CONSTANTS.PLAYER_BASE_SIZE, shooter.size?.y || SPRITE_CONSTANTS.PLAYER_BASE_SIZE);
      const muzzleOffset = muzzleBase * 0.6;
      const startX = shooter.position.x + Math.cos(currentAngle) * muzzleOffset;
      const startY = shooter.position.y + Math.sin(currentAngle) * muzzleOffset;

      entities.push({
        id: nextId('proj'),
        type: EntityType.PROJECTILE,
        position: { x: startX, y: startY },
        velocity: { x: vx, y: vy },
        size: pSize,
        rotation: currentAngle,
        color: config.color,
        active: true,
        health: 1,
        maxHealth: 1,
        lifetime: config.lifetime,
        maxLifetime: config.lifetime,
        mass: PROJECTILE_CONSTANTS.MASS,
        damage: config.damage,
        homing: config.homing,
        ownerType,
        pierceCount: config.pierce,
        trail: [],
        isLightningProjectile: config.type === WeaponType.LIGHTNING || undefined,
        isBouncer: config.type === WeaponType.BOUNCER || undefined,
      });
    }

    this.enforceCap(entities);
  }

  /**
   * Hard cap on live projectiles.  If exceeded, deactivates the oldest
   * projectiles first (FIFO by entity-list order).  Physics / render passes
   * skip inactive entities and the cleanup pass removes them next frame.
   */
  public enforceCap(entities: GameEntity[]) {
    let count = 0;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.active && e.type === EntityType.PROJECTILE) count++;
    }
    if (count <= MAX_PROJECTILES) return;
    let toDrop = count - MAX_PROJECTILES;
    for (let i = 0; i < entities.length && toDrop > 0; i++) {
      const e = entities[i];
      if (e.active && e.type === EntityType.PROJECTILE) {
        e.active = false;
        toDrop--;
      }
    }
  }

  /**
   * Steer every homing projectile toward the nearest enemy within range.
   *
   * Phase 4: the caller supplies pre-filtered `projectiles` and `enemies`
   * candidate lists from EntityIndex, so each pass is O(P × E) on the
   * filtered sets instead of O(N × N) on the full entity array.  Homing
   * projectiles still need an active + homing check because the index
   * does not split projectiles by `.homing`.
   */
  public updateHoming(projectiles: GameEntity[], enemies: GameEntity[], dt: number) {
    if (enemies.length === 0) return;

    const acquireRangeSq = HOMING_ACQUIRE_RANGE * HOMING_ACQUIRE_RANGE;

    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      if (!p.homing) continue;

      let target: GameEntity | null = null;
      let minDist = acquireRangeSq;

      for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j];
        const d2 = (e.position.x - p.position.x) ** 2 + (e.position.y - p.position.y) ** 2;
        if (d2 < minDist) {
          minDist = d2;
          target = e;
        }
      }

      if (target) {
        const desiredAngle = Math.atan2(target.position.y - p.position.y, target.position.x - p.position.x);
        let angleDiff = desiredAngle - p.rotation;

        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const turnRate = 5 * (p.homingStrength ?? 1) * dt;
        if (Math.abs(angleDiff) < turnRate) {
          p.rotation = desiredAngle;
        } else {
          p.rotation += Math.sign(angleDiff) * turnRate;
        }

        const speed = Math.sqrt(p.velocity.x ** 2 + p.velocity.y ** 2);
        p.velocity.x = Math.cos(p.rotation) * speed;
        p.velocity.y = Math.sin(p.rotation) * speed;
      }
    }
  }

  /**
   * Lightning projectiles experience gravity-like attraction to the nearest
   * valid target.
   *
   * Phase 4: works off EntityIndex candidate lists.  Early-out when either
   * the projectile list has no lightning projectiles or there are no
   * targets (enemies / asteroids) on the map.  Each attraction query is
   * O(P_lightning × (E + A)) on the filtered lists instead of O(N × N).
   */
  public updateLightningGravity(
    projectiles: GameEntity[],
    enemies: GameEntity[],
    asteroids: GameEntity[],
    dt: number,
  ) {
    const rangeSq = LIGHTNING_GRAVITY_RANGE * LIGHTNING_GRAVITY_RANGE;

    // Fast-path: scan projectile list once to see if any are lightning.
    let hasLightning = false;
    for (let i = 0; i < projectiles.length; i++) {
      if (projectiles[i].isLightningProjectile) { hasLightning = true; break; }
    }
    if (!hasLightning) return;
    if (enemies.length === 0 && asteroids.length === 0) return;

    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      if (!p.isLightningProjectile) continue;

      // Find nearest enemy or asteroid within gravity range.
      // Sweep both filtered lists; isExploding is still checked since
      // exploding targets remain in the index but shouldn't attract.
      let target: GameEntity | null = null;
      let minD2 = rangeSq;
      for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j];
        if (e.isExploding) continue;
        const dx = e.position.x - p.position.x;
        const dy = e.position.y - p.position.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD2) { minD2 = d2; target = e; }
      }
      for (let j = 0; j < asteroids.length; j++) {
        const e = asteroids[j];
        if (e.isExploding) continue;
        const dx = e.position.x - p.position.x;
        const dy = e.position.y - p.position.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD2) { minD2 = d2; target = e; }
      }

      if (target) {
        const dx = target.position.x - p.position.x;
        const dy = target.position.y - p.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 1) {
          // Gravity-like acceleration: stronger when closer
          const accel = LIGHTNING_GRAVITY_STRENGTH / Math.max(dist, 30);
          p.velocity.x += (dx / dist) * accel * dt;
          p.velocity.y += (dy / dist) * accel * dt;
        }
      }

      // Keep rotation aligned with velocity
      const sp = Math.sqrt(p.velocity.x * p.velocity.x + p.velocity.y * p.velocity.y);
      if (sp > 0.1) {
        p.rotation = Math.atan2(p.velocity.y, p.velocity.x);
      }
    }
  }
}
