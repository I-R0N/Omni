import { GameEntity, EntityType, EnemyRole, Vector2, WeaponType, WeaponConfig } from '../../types';
import {
  WEAPONS,
  WEAPON_LIST,
  ENEMY_WEAPON,
  ENEMY_BURST_CONFIG,
  ENEMY_CONSTANTS,
  ENEMY_ROLE,
  ENEMY_ATTACK_EFFECTS,
  CORROSION,
  COLLISION_CONFIG,
  LIGHTNING_CHAIN_BRANCHES,
} from '../../constants';
import { ProjectileSystem } from './ProjectileSystem';
import { wrapDeltaX, wrapDeltaY } from '../toroidal';

/**
 * Build the per-weapon config used for a charged-shot trigger.  The base
 * config is shallow-copied and the relevant fields are overridden.  Each
 * weapon owns its own thematic charge effect (see docs/GAME_FEEDBACK_PLAN.md
 * d2 design notes):
 *   - BLASTER: 5× damage slug, pierces 3, no recoil
 *   - BURST:   5-shot piercing burst (vs 3) with pierce 3
 *   - SHOTGUN: 12-pellet wide cone (50°), each pellet pierces 2
 *   - BOUNCER: 3-beam fan (±15°) — beams keep their per-shot pierce/bounce
 *   - LIGHTNING: chain doubles to 4 hops over 2× range (read on the projectile)
 *   - HOMING:  4-missile volley with weaker tracking (homingStrength 0.5),
 *              each missile pierces 1
 *   - CANNON:  2× explosion radius, 1.5× explosion damage + knockback
 */
function chargedConfigOf(config: WeaponConfig): WeaponConfig {
  switch (config.type) {
    case WeaponType.BLASTER:
      // Larger fireball-style projectile; RenderSystem picks the red+orange
      // two-tone gradient when isCharged is set.
      return {
        ...config,
        damage: config.damage * 5,
        pierce: 3,
        recoil: 0,
        size: config.size * 2.6,  // 6 → ~16
        isCharged: true,
      };
    case WeaponType.BURST:
      return { ...config, pierce: 3, burstCount: 5 };
    case WeaponType.SHOTGUN:
      return { ...config, count: 12, spread: 25, pierce: 2 };
    case WeaponType.BOUNCER:
      // Omnidirectional nova — 8 beams equally spaced around 360°
      // (every 45°).  ProjectileSystem.spawn handles the equal-angle
      // ring layout when omniDirectional is set.  Recoil zeroed since
      // forces cancel in all directions.
      return { ...config, count: 8, spread: 360, omniDirectional: true, recoil: 0 };
    case WeaponType.LIGHTNING:
      // Lightning's charge is read off the projectile by GameEngine.fireLightningChainFromImpact.
      // ProjectileSystem.spawn copies these onto the projectile at spawn.
      // Charged variant adds one extra simultaneous jump per node — saturated
      // tree grows from 1+2+4+8=15 (base) to 1+3+9+27=40.  Depth and range
      // are kept identical to base so the charge premium is purely "wider"
      // rather than "further".
      return {
        ...config,
        chainBranches: LIGHTNING_CHAIN_BRANCHES + 1, // 3 vs base 2
      };
    case WeaponType.HOMING:
      return { ...config, count: 4, spread: 30, pierce: 1, homingStrength: 0.5 };
    case WeaponType.CANNON:
      return {
        ...config,
        explosionRadius:    (config.explosionRadius    ?? 0) * 2,
        explosionDamage:    (config.explosionDamage    ?? 0) * 1.5,
        explosionKnockback: (config.explosionKnockback ?? 0) * 1.5,
      };
  }
  return config;
}

/**
 * WeaponSystem — owns shooting behavior for both players and enemies.
 *
 * Extracted from GameEngine in Phase 2.  The system is stateless apart from
 * its ProjectileSystem dependency; all cooldown / burst state lives on the
 * entities themselves.  Screen-shake and other side effects are surfaced via
 * optional callbacks so the subsystem stays self-contained.
 */
export class WeaponSystem {
  constructor(private projectiles: ProjectileSystem) {}

  /**
   * Fire the player's currently-selected weapon at a world-space target.
   * Handles:
   *   - cooldown gating
   *   - ammo deduction (charged shots cost chargedAmmoCost, normal shots cost ammoCost)
   *   - auto-fallback to blaster when selected weapon is empty
   *   - charged-shot fallback to a normal shot when the pool can't cover chargedAmmoCost
   *   - burst-fire state setup
   *   - screen shake
   *   - projectile spawning via ProjectileSystem
   * Returns `true` if a shot was actually fired.
   */
  public firePlayerWeapon(
    entities: GameEntity[],
    player: GameEntity,
    target: Vector2,
    onShake?: (amount: number) => void,
    charged: boolean = false,
  ): boolean {
    if (player.weaponCooldown && player.weaponCooldown > 0) return false;

    let weaponType = player.currentWeapon || WeaponType.BLASTER;
    let baseConfig = WEAPONS[weaponType];

    // Charged-shot ammo gating: if the pool can't cover chargedAmmoCost,
    // fall back to a normal shot at ammoCost.
    // Charged shots require the Overcharge unlock.
    let isCharged = charged && (player.overchargeUnlocked ?? false);
    if (isCharged && baseConfig.chargedAmmoCost > 0 && (player.ammo ?? 0) < baseConfig.chargedAmmoCost) {
      isCharged = false;
    }

    // Normal-shot ammo gating: if the pool still can't cover the basic
    // ammoCost, fall back to blaster (ammoCost 0).
    if (!isCharged && baseConfig.ammoCost > 0 && (player.ammo ?? 0) < baseConfig.ammoCost) {
      weaponType = WeaponType.BLASTER;
      player.currentWeapon = WeaponType.BLASTER;
      player.burstQueue = 0;
      baseConfig = WEAPONS[WeaponType.BLASTER];
    }

    let config = isCharged ? chargedConfigOf(baseConfig) : baseConfig;
    // Progression: Gunnery scales damage (incl. cannon AoE), Autoloader
    // scales fire cadence.  Copy the config before scaling so the shared
    // WEAPONS table is never mutated.
    const dmgMult = player.damageMult ?? 1;
    if (dmgMult !== 1) {
      config = {
        ...config,
        damage: config.damage * dmgMult,
        explosionDamage: config.explosionDamage !== undefined ? config.explosionDamage * dmgMult : config.explosionDamage,
      };
    }
    player.weaponCooldown = baseConfig.cooldown * (player.cooldownMult ?? 1); // base cadence × Autoloader

    // Deduct shared-pool ammo (no-op for blaster: ammoCost 0).  Charged
    // shots use chargedAmmoCost; normal shots use ammoCost.
    const cost = isCharged ? baseConfig.chargedAmmoCost : baseConfig.ammoCost;
    if (cost > 0) {
      player.ammo = Math.max(0, (player.ammo ?? 0) - cost);
    }

    if (onShake) {
      if (config.type === WeaponType.SHOTGUN) {
        onShake(isCharged ? 8 : 5);
      } else if (config.type === WeaponType.CANNON) {
        onShake(isCharged ? COLLISION_CONFIG.SHAKE.HEAVY : COLLISION_CONFIG.SHAKE.MEDIUM);
      } else if (config.type === WeaponType.BURST) {
        onShake(3);
      } else if (config.type === WeaponType.BLASTER && isCharged) {
        onShake(COLLISION_CONFIG.SHAKE.MEDIUM);
      }
    }

    if (config.type === WeaponType.BURST && config.burstCount) {
      player.burstQueue = config.burstCount - 1;
      player.burstTimer = config.burstDelay;
      player.burstCharged = isCharged || undefined;
    }

    this.projectiles.spawn(entities, player, target, config, EntityType.PLAYER);
    return true;
  }

  /**
   * Advance the player's burst queue: if a burst is pending and its timer
   * has expired, fire the next shot.  Called each sim tick.  Triggers a
   * screen shake on burst-weapon sub-shots via `onShake`.
   */
  public tickPlayerBurst(
    entities: GameEntity[],
    player: GameEntity,
    dt: number,
    onShake?: (amount: number) => void
  ) {
    if (player.weaponCooldown && player.weaponCooldown > 0) {
      player.weaponCooldown -= dt;
    }

    if (!(player.burstQueue && player.burstQueue > 0)) return;

    player.burstTimer = (player.burstTimer || 0) - dt;
    if (player.burstTimer > 0) return;

    player.burstQueue--;
    const baseConfig = WEAPONS[player.currentWeapon || WeaponType.BLASTER];
    let config = player.burstCharged ? chargedConfigOf(baseConfig) : baseConfig;
    const dmgMult = player.damageMult ?? 1;
    if (dmgMult !== 1) {
      config = { ...config, damage: config.damage * dmgMult };
    }
    player.burstTimer = config.burstDelay || 0.1;
    const targetX = player.position.x + Math.cos(player.rotation) * 100;
    const targetY = player.position.y + Math.sin(player.rotation) * 100;
    this.projectiles.spawn(entities, player, { x: targetX, y: targetY }, config, EntityType.PLAYER);
    if (onShake && config.type === WeaponType.BURST) onShake(3);

    // Clear the charged flag once the burst fully drains so the next
    // trigger pull starts fresh.
    if (player.burstQueue === 0) player.burstCharged = undefined;
  }

  /**
   * Tick the shooting AI for every active shooter-role enemy.  Manages
   * cooldowns, targeting, burst-fire state, and projectile spawning.
   *
   * Phase 4: `enemies` is the pre-filtered enemy candidate list from
   * EntityIndex, so this pass is O(E) on active enemies instead of O(N)
   * on the full entity array.  Spawned projectiles are appended to
   * `entities` (the master list) so the index stays in sync next frame.
   */
  public updateEnemyShooting(
    entities: GameEntity[],
    enemies: GameEntity[],
    player: GameEntity,
    dt: number,
  ) {
    const weapon = ENEMY_WEAPON;
    const rangeSq = ENEMY_CONSTANTS.VISION_RANGE * ENEMY_CONSTANTS.VISION_RANGE;

    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!enemy.enemySubtype || ENEMY_ROLE[enemy.enemySubtype] !== EnemyRole.SHOOTING) continue;

      // Cooldown management
      enemy.weaponCooldown = Math.max(0, (enemy.weaponCooldown ?? 0) - dt);
      if (enemy.weaponCooldown > 0) continue;

      const dx = wrapDeltaX(enemy.position.x, player.position.x);
      const dy = wrapDeltaY(enemy.position.y, player.position.y);
      const distSq = dx * dx + dy * dy;
      if (distSq > rangeSq) continue;

      // Lazily init burst state — first trigger starts a fresh burst
      if (enemy.burstQueue === undefined) enemy.burstQueue = ENEMY_BURST_CONFIG.BURST_SIZE;

      // Slight inaccuracy
      const aimAngle = Math.atan2(dy, dx) + (Math.random() - 0.5) * (weapon.spread * Math.PI / 180);
      const targetX = enemy.position.x + Math.cos(aimAngle) * 500;
      const targetY = enemy.position.y + Math.sin(aimAngle) * 500;
      // Per-wave enemy damage scaling — copy the shared config and scale
      // its damage by the enemy's stamped multiplier (1× when unset).
      // Subtypes in ENEMY_ATTACK_EFFECTS (Orbiter → corrosion) also tag the
      // shot with a status payload + the effect colour.
      const dmgMult = enemy.damageMult ?? 1;
      const fx = enemy.enemySubtype ? ENEMY_ATTACK_EFFECTS[enemy.enemySubtype] : undefined;
      let shot = weapon;
      if (dmgMult !== 1 || fx) {
        shot = { ...weapon };
        if (dmgMult !== 1) shot.damage = weapon.damage * dmgMult;
        if (fx) { shot.appliesEffect = fx; shot.color = CORROSION.COLOR; }
      }
      this.projectiles.spawn(entities, enemy, { x: targetX, y: targetY }, shot, EntityType.ENEMY);

      // Burst state: fire BURST_SIZE shots with BURST_GAP between them,
      // then wait BURST_RELOAD before starting the next burst.
      if (enemy.burstQueue > 1) {
        enemy.burstQueue--;
        enemy.weaponCooldown = ENEMY_BURST_CONFIG.BURST_GAP;
      } else {
        enemy.burstQueue = ENEMY_BURST_CONFIG.BURST_SIZE;
        enemy.weaponCooldown = ENEMY_BURST_CONFIG.BURST_RELOAD;
      }
    }
  }

  /**
   * Weapon selection semantics for the player's ammo HUD (shared-pool
   * model):
   * - Tapping a non-blaster slot when the shared pool can't cover its
   *   ammoCost is a no-op (matches the pre-d1 "empty slot" behaviour).
   * - Tapping the active non-blaster weapon toggles it off (→ blaster).
   * - Tapping any other weapon switches to it.
   * Returns the new currentWeapon index in WEAPON_LIST for UI state.
   */
  public selectWeapon(player: GameEntity, wType: WeaponType): number {
    const cfg = WEAPONS[wType];
    // Locked weapons can't be selected (Blaster is always owned).
    const owned = player.ownedWeapons ?? [WeaponType.BLASTER];
    if (wType !== WeaponType.BLASTER && !owned.includes(wType)) {
      return WEAPON_LIST.indexOf(player.currentWeapon || WeaponType.BLASTER);
    }
    if (cfg.ammoCost > 0 && (player.ammo ?? 0) < cfg.ammoCost) {
      return WEAPON_LIST.indexOf(player.currentWeapon || WeaponType.BLASTER);
    }

    if (wType !== WeaponType.BLASTER && player.currentWeapon === wType) {
      // Toggle off: deselect and fall back to blaster
      player.currentWeapon = WeaponType.BLASTER;
      player.burstQueue = 0;
      return WEAPON_LIST.indexOf(WeaponType.BLASTER);
    }

    player.currentWeapon = wType;
    player.burstQueue = 0;
    return WEAPON_LIST.indexOf(wType);
  }

  /**
   * Cycle to the next firable weapon — blaster always qualifies; other
   * weapons qualify only if the shared pool can cover their ammoCost.
   */
  public cycleWeapon(player: GameEntity): number {
    const pool = player.ammo ?? 0;
    const ownedSet = player.ownedWeapons ?? [WeaponType.BLASTER];
    const owned = WEAPON_LIST.filter(w => {
      if (w !== WeaponType.BLASTER && !ownedSet.includes(w)) return false; // must be unlocked
      const cfg = WEAPONS[w];
      return cfg.ammoCost === 0 || pool >= cfg.ammoCost;
    });
    if (owned.length <= 1) return WEAPON_LIST.indexOf(player.currentWeapon || WeaponType.BLASTER);
    const currentIdx = owned.indexOf(player.currentWeapon || WeaponType.BLASTER);
    const nextIdx = (currentIdx + 1) % owned.length;
    player.currentWeapon = owned[nextIdx];
    player.burstQueue = 0;
    return WEAPON_LIST.indexOf(player.currentWeapon);
  }

  /** Expose the weapon config for a given type (convenience for callers). */
  public getConfig(wType: WeaponType): WeaponConfig {
    return WEAPONS[wType];
  }
}
