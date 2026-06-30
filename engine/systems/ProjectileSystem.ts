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
import { enforceTypeCap } from './enforceCap';
import { wrapDeltaX, wrapDeltaY } from '../toroidal';

/**
 * ProjectileSystem — owns projectile lifecycle: spawning, homing steering,
 * lightning gravity attraction, and the hard cap on active projectiles.
 *
 * Extracted from GameEngine in Phase 2 of the engine upgrade.  Stateless;
 * callers provide the entity list the projectiles should be appended to and
 * read from.
 */
export class ProjectileSystem {
  // Perf instrumentation — wall time (ms) of the most recent homing and
  // lightning-gravity passes.  Both are O(P×E) scans that can grow once
  // projectile/enemy counts climb in late waves, so they're tracked
  // separately in the dev perf overlay.
  public lastHomingMs: number = 0;
  public lastLightningMs: number = 0;

  // Object pool — projectiles spawn in bursts (shotgun = 6/shot, omni
  // nova = 12+) and despawn on lifetime expiry, collision, or the
  // MAX_PROJECTILES cap.  Reusing entity objects across the spawn /
  // despawn cycle removes ~all transient GC pressure for this entity
  // class — at ~150 projectiles/sec that's ~150 saved allocations/sec
  // plus the matching GC scan work.  Pool bounded so a quiet period
  // after a heavy fight doesn't pin a huge heap.
  private _pool: GameEntity[] = [];
  private readonly POOL_CAP = 256;

  /**
   * Return a deactivated projectile entity to the pool for later
   * reuse.  Called by the GameEngine compaction pass when it would
   * otherwise have left an inactive projectile for the GC.  Type-checked
   * here so a mistaken call on a non-projectile is a silent no-op.
   * Optional-only fields are cleared so stale data (homing target id,
   * pierce-hit list, lightning arc state) from a prior life can't bleed
   * into the next projectile that reuses this slot.
   */
  public releaseToPool(e: GameEntity): void {
    if (e.type !== EntityType.PROJECTILE) return;
    if (this._pool.length >= this.POOL_CAP) return;
    // Clear optional projectile-only fields so the next spawn's reuse
    // path starts from a clean slate — spawn() re-sets the fields it
    // cares about, but a config-mismatched leftover (e.g. previous shot
    // was lightning chain with chainBranches set, next shot is a plain
    // bouncer) would otherwise carry stale config through.
    e.targetEntityId = undefined;
    e.hitEntityIds = undefined;
    e.arcPoints = undefined;
    e.isLightningProjectile = undefined;
    e.isBouncer = undefined;
    e.isLightningArc = undefined;
    e.bouncesRemaining = undefined;
    e.explosionRadius = undefined;
    e.explosionDamage = undefined;
    e.explosionKnockback = undefined;
    e.glow = undefined;
    e.chainCount = undefined;
    e.chainRange = undefined;
    e.chainBranches = undefined;
    e.isCharged = undefined;
    e.homing = undefined;
    e.homingStrength = undefined;
    this._pool.push(e);
  }

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
    // Aim angle via toroidal delta so an enemy shooting a player that sits
    // just across the seam doesn't fire in the opposite direction.
    const aimDX = wrapDeltaX(shooter.position.x, target.x);
    const aimDY = wrapDeltaY(shooter.position.y, target.y);
    const angle = Math.atan2(aimDY, aimDX);

    // Only apply recoil to player for now
    if (ownerType === EntityType.PLAYER) {
      const recoilImpulse = (PROJECTILE_CONSTANTS.MASS * config.speed * config.recoil) / (shooter.mass || 1);
      shooter.velocity.x -= Math.cos(angle) * recoilImpulse;
      shooter.velocity.y -= Math.sin(angle) * recoilImpulse;
    }

    const halfSpread = (config.spread * (Math.PI / 180)) / 2;
    // Omnidirectional layout: count projectiles at equal angular spacing
    // around 360° starting at the aim direction.  Used by the charged
    // Bouncer nova; falls through to the standard fan when omniDirectional
    // is unset.
    const omniStep = config.omniDirectional && config.count > 1
      ? (Math.PI * 2) / config.count
      : 0;

    for (let i = 0; i < config.count; i++) {
      let currentAngle = angle;
      if (omniStep > 0) {
        currentAngle = angle + omniStep * i;
      } else if (config.count > 1) {
        const step = (halfSpread * 2) / (config.count - 1);
        currentAngle = (angle - halfSpread) + (step * i);
      } else if (config.spread > 0) {
        currentAngle += (Math.random() - 0.5) * (config.spread * (Math.PI / 180));
      }

      const ax = Math.cos(currentAngle);
      const ay = Math.sin(currentAngle);
      let vx = ax * config.speed;
      let vy = ay * config.speed;

      // Inherit the shooter's velocity so a moving shooter doesn't outrun
      // its own shots: forward shots lead the ship, strafing shots drift
      // with it.  Applies to player and enemy alike (enemies aim at the
      // player's current position with no lead, so this doesn't disturb
      // their targeting).
      const inherit = PROJECTILE_CONSTANTS.INHERIT_SHOOTER_VELOCITY;
      if (inherit > 0 && shooter.velocity) {
        vx += shooter.velocity.x * inherit;
        vy += shooter.velocity.y * inherit;
        // Muzzle-speed floor: guarantee at least config.speed of velocity
        // ALONG the aim direction so a shooter retreating faster than the
        // muzzle speed can't fire a shot that drifts backward.  Lateral
        // inheritance (the strafe carry) is preserved.
        const forward = vx * ax + vy * ay;
        if (forward < config.speed) {
          const deficit = config.speed - forward;
          vx += ax * deficit;
          vy += ay * deficit;
        }
      }

      const pSize = {
        x: config.size * 2.5,
        y: config.size * 0.4,
      };

      // Spawn slightly forward from the ship nose based on entity size
      const muzzleBase = Math.max(shooter.size?.x || SPRITE_CONSTANTS.PLAYER_BASE_SIZE, shooter.size?.y || SPRITE_CONSTANTS.PLAYER_BASE_SIZE);
      const muzzleOffset = muzzleBase * 0.6;
      const startX = shooter.position.x + ax * muzzleOffset;
      const startY = shooter.position.y + ay * muzzleOffset;

      const rotation = Math.atan2(vy, vx);
      const isLight = config.type === WeaponType.LIGHTNING || undefined;
      const isBnc   = config.type === WeaponType.BOUNCER || undefined;
      const bouncesRem = config.type === WeaponType.BOUNCER ? config.bounceCount : undefined;
      const pooled = this._pool.pop();
      if (pooled) {
        // Reuse path: in-place reset.  Optional fields the pool's
        // releaseToPool() didn't already clear are reset here so the
        // hidden class stays stable across spawn shapes.
        pooled.id = nextId('proj');
        pooled.type = EntityType.PROJECTILE;
        pooled.position.x = startX; pooled.position.y = startY;
        pooled.velocity.x = vx;     pooled.velocity.y = vy;
        pooled.size = pSize;
        pooled.rotation = rotation;
        pooled.color = config.color;
        pooled.active = true;
        pooled.health = 1;
        pooled.maxHealth = 1;
        pooled.lifetime = config.lifetime;
        pooled.maxLifetime = config.lifetime;
        pooled.mass = PROJECTILE_CONSTANTS.MASS;
        pooled.damage = config.damage;
        pooled.homing = config.homing;
        pooled.homingStrength = config.homingStrength;
        pooled.ownerType = ownerType;
        pooled.ownerId = shooter.id; // for third-party retaliation (Stage 5)
        pooled.pierceCount = config.pierce;
        if (pooled.trail) pooled.trail.length = 0; else pooled.trail = [];
        pooled.isLightningProjectile = isLight;
        pooled.isBouncer = isBnc;
        pooled.bouncesRemaining = bouncesRem;
        pooled.explosionRadius = config.explosionRadius;
        pooled.explosionDamage = config.explosionDamage;
        pooled.explosionKnockback = config.explosionKnockback;
        pooled.glow = config.glow;
        pooled.chainCount = config.chainCount;
        pooled.chainRange = config.chainRange;
        pooled.chainBranches = config.chainBranches;
        pooled.isCharged = config.isCharged;
        pooled.appliesEffect = config.appliesEffect; // undefined for normal shots → cleared
        // Rival-shot flags (Stage 7) are stamped by GameEngine AFTER spawn, so a
        // recycled rival projectile MUST clear them or a reused player/enemy shot
        // inherits them — making player shots phase through rivals (hitsEnemies)
        // and enemy shots phase through the player (sparesPlayer).
        pooled.hitsEnemies = undefined;
        pooled.sparesPlayer = undefined;
        entities.push(pooled);
      } else {
        entities.push({
          id: nextId('proj'),
          type: EntityType.PROJECTILE,
          position: { x: startX, y: startY },
          velocity: { x: vx, y: vy },
          size: pSize,
          // Orient along actual travel (inherited velocity may diverge from
          // the aim direction when strafing) so the sprite points where it
          // flies; muzzle spawn offset still uses the aim direction.
          rotation,
          color: config.color,
          active: true,
          health: 1,
          maxHealth: 1,
          lifetime: config.lifetime,
          maxLifetime: config.lifetime,
          mass: PROJECTILE_CONSTANTS.MASS,
          damage: config.damage,
          homing: config.homing,
          homingStrength: config.homingStrength,
          ownerType,
          ownerId: shooter.id, // for third-party retaliation (Stage 5)
          pierceCount: config.pierce,
          trail: [],
          isLightningProjectile: isLight,
          isBouncer: isBnc,
          bouncesRemaining: bouncesRem,
          explosionRadius: config.explosionRadius,
          explosionDamage: config.explosionDamage,
          explosionKnockback: config.explosionKnockback,
          glow: config.glow,
          chainCount: config.chainCount,
          chainRange: config.chainRange,
          chainBranches: config.chainBranches,
          isCharged: config.isCharged,
          appliesEffect: config.appliesEffect,
        });
      }
    }

    this.enforceCap(entities);
  }

  /**
   * Hard cap on live projectiles.  If exceeded, deactivates the oldest
   * projectiles first (FIFO by entity-list order).  Physics / render passes
   * skip inactive entities and the cleanup pass removes them next frame.
   * Implementation in `enforceCap.ts` — shared with ParticleSystem.
   */
  public enforceCap(entities: GameEntity[]) {
    enforceTypeCap(entities, EntityType.PROJECTILE, MAX_PROJECTILES);
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
  public updateHoming(projectiles: GameEntity[], enemies: GameEntity[], player: GameEntity, dt: number) {
    const t0 = performance.now();

    const acquireRangeSq = HOMING_ACQUIRE_RANGE * HOMING_ACQUIRE_RANGE;
    const playerHomeable = player.active && !player.isExploding;

    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      if (!p.homing) continue;

      let hasTarget = false;
      // Capture the winning delta so we don't pay a second wrapDelta pair to
      // recompute it on the steer below.
      let targetDx = 0, targetDy = 0;

      if (p.ownerType === EntityType.ENEMY) {
        // Enemy missiles (Turret) home on the PLAYER, regardless of range —
        // the shot was already fired at them; dodging is via the gentle turn
        // rate, not by leaving an acquire radius.
        if (playerHomeable) {
          targetDx = wrapDeltaX(p.position.x, player.position.x);
          targetDy = wrapDeltaY(p.position.y, player.position.y);
          hasTarget = true;
        }
      } else {
        // Player homing weapon: steer toward the nearest enemy within range.
        let minDist = acquireRangeSq;
        for (let j = 0; j < enemies.length; j++) {
          const e = enemies[j];
          const dx = wrapDeltaX(p.position.x, e.position.x);
          const dy = wrapDeltaY(p.position.y, e.position.y);
          const d2 = dx * dx + dy * dy;
          if (d2 < minDist) {
            minDist = d2;
            targetDx = dx;
            targetDy = dy;
            hasTarget = true;
          }
        }
      }

      if (hasTarget) {
        const desiredAngle = Math.atan2(targetDy, targetDx);
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

    this.lastHomingMs = performance.now() - t0;
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
    const t0 = performance.now();
    const rangeSq = LIGHTNING_GRAVITY_RANGE * LIGHTNING_GRAVITY_RANGE;

    // Fast-path: scan projectile list once to see if any are lightning.
    let hasLightning = false;
    for (let i = 0; i < projectiles.length; i++) {
      if (projectiles[i].isLightningProjectile) { hasLightning = true; break; }
    }
    if (!hasLightning) { this.lastLightningMs = performance.now() - t0; return; }
    if (enemies.length === 0 && asteroids.length === 0) { this.lastLightningMs = performance.now() - t0; return; }

    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      if (!p.isLightningProjectile) continue;

      // Find nearest enemy or asteroid within gravity range.
      // Sweep both filtered lists; isExploding is still checked since
      // exploding targets remain in the index but shouldn't attract.
      // Capture the winning delta so the steer below skips a second
      // wrapDelta pair.
      let target: GameEntity | null = null;
      let minD2 = rangeSq;
      let targetDx = 0, targetDy = 0;
      for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j];
        if (e.isExploding) continue;
        const dx = wrapDeltaX(p.position.x, e.position.x);
        const dy = wrapDeltaY(p.position.y, e.position.y);
        const d2 = dx * dx + dy * dy;
        if (d2 < minD2) { minD2 = d2; target = e; targetDx = dx; targetDy = dy; }
      }
      for (let j = 0; j < asteroids.length; j++) {
        const e = asteroids[j];
        if (e.isExploding) continue;
        const dx = wrapDeltaX(p.position.x, e.position.x);
        const dy = wrapDeltaY(p.position.y, e.position.y);
        const d2 = dx * dx + dy * dy;
        if (d2 < minD2) { minD2 = d2; target = e; targetDx = dx; targetDy = dy; }
      }

      if (target) {
        const dist = Math.sqrt(targetDx * targetDx + targetDy * targetDy);
        if (dist > 1) {
          // Gravity-like acceleration: stronger when closer.  Hoist the
          // per-axis scalar out of two divisions into one inverse-multiply.
          const k = (LIGHTNING_GRAVITY_STRENGTH / Math.max(dist, 30)) * dt / dist;
          p.velocity.x += targetDx * k;
          p.velocity.y += targetDy * k;
        }
      }

      // Keep rotation aligned with velocity
      const sp = Math.sqrt(p.velocity.x * p.velocity.x + p.velocity.y * p.velocity.y);
      if (sp > 0.1) {
        p.rotation = Math.atan2(p.velocity.y, p.velocity.x);
      }
    }

    this.lastLightningMs = performance.now() - t0;
  }
}
