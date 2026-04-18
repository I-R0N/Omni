import { GameEntity, EntityType, EnemyRole, Vector2, WeaponType, WeaponConfig } from '../../types';
import {
  WEAPONS,
  WEAPON_LIST,
  ENEMY_WEAPON,
  ENEMY_BURST_CONFIG,
  ENEMY_CONSTANTS,
  ENEMY_ROLE,
  COLLISION_CONFIG,
} from '../../constants';
import { ProjectileSystem } from './ProjectileSystem';
import { wrapDeltaX, wrapDeltaY } from '../toroidal';

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
   *   - ammo deduction (non-blaster weapons)
   *   - auto-fallback to blaster when selected weapon is empty
   *   - burst-fire state setup
   *   - screen shake
   *   - projectile spawning via ProjectileSystem
   * Returns `true` if a shot was actually fired.
   */
  public firePlayerWeapon(
    entities: GameEntity[],
    player: GameEntity,
    target: Vector2,
    onShake?: (amount: number) => void
  ): boolean {
    if (player.weaponCooldown && player.weaponCooldown > 0) return false;

    let weaponType = player.currentWeapon || WeaponType.BLASTER;

    // If non-blaster and out of ammo, auto-fallback to blaster
    if (weaponType !== WeaponType.BLASTER && (player.ammo?.[weaponType] ?? 0) <= 0) {
      weaponType = WeaponType.BLASTER;
      player.currentWeapon = WeaponType.BLASTER;
      player.burstQueue = 0;
    }

    const config = WEAPONS[weaponType];
    player.weaponCooldown = config.cooldown;

    // Deduct ammo for non-blaster weapons (one shot = one ammo unit)
    if (weaponType !== WeaponType.BLASTER && player.ammo) {
      const before = player.ammo[weaponType] ?? 0;
      player.ammo[weaponType] = Math.max(0, before - 1);
    }

    if (onShake) {
      if (config.type === WeaponType.SHOTGUN) {
        onShake(5);
      } else if (config.type === WeaponType.CANNON) {
        onShake(COLLISION_CONFIG.SHAKE.MEDIUM);
      } else if (config.type === WeaponType.BURST) {
        onShake(3);
      }
    }

    if (config.type === WeaponType.BURST && config.burstCount) {
      player.burstQueue = config.burstCount - 1;
      player.burstTimer = config.burstDelay;
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
    const config = WEAPONS[player.currentWeapon || WeaponType.BLASTER];
    player.burstTimer = config.burstDelay || 0.1;
    const targetX = player.position.x + Math.cos(player.rotation) * 100;
    const targetY = player.position.y + Math.sin(player.rotation) * 100;
    this.projectiles.spawn(entities, player, { x: targetX, y: targetY }, config, EntityType.PLAYER);
    if (onShake && config.type === WeaponType.BURST) onShake(3);
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
      this.projectiles.spawn(entities, enemy, { x: targetX, y: targetY }, weapon, EntityType.ENEMY);

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
   * Weapon selection semantics for the player's ammo HUD:
   * - Tapping an unowned / empty slot does nothing.
   * - Tapping the active non-blaster weapon toggles it off (→ blaster).
   * - Tapping any other owned weapon switches to it.
   * Returns the new currentWeapon index in WEAPON_LIST for UI state.
   */
  public selectWeapon(player: GameEntity, wType: WeaponType): number {
    const isBlaster = wType === WeaponType.BLASTER;
    const ammo = player.ammo?.[wType] ?? 0;
    if (!isBlaster && ammo <= 0) return WEAPON_LIST.indexOf(player.currentWeapon || WeaponType.BLASTER);

    if (!isBlaster && player.currentWeapon === wType) {
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
   * Cycle to the next owned weapon (blaster is always owned; other weapons
   * are only cycled through if they have ammo > 0).  Returns the new index.
   */
  public cycleWeapon(player: GameEntity): number {
    const owned = WEAPON_LIST.filter(w =>
      w === WeaponType.BLASTER ||
      ((player.ammo?.[w] ?? 0) > 0)
    );
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
