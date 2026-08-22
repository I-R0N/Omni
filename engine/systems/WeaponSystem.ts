import { GameEntity, EntityType, Vector2, WeaponType, WeaponConfig, RumbleKind } from '../../types';
import {
  INPUT_CONSTANTS,
  WEAPONS,
  WEAPON_LIST,
  ENEMY_WEAPON,
  ENEMY_CONSTANTS,
  ENEMY_VARIANTS,
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
  /** SFX sink for enemy fire.  Set once by GameEngine; the system itself
   *  stays free of audio state (same shape as PhysicsSystem.sfx). */
  public onEnemyFire: ((id: string, x: number, y: number) => void) | null = null;

  constructor(private projectiles: ProjectileSystem) {}

  /**
   * Fire the player's currently-selected weapon at a world-space target.
   * Handles:
   *   - cooldown gating (the only in-combat brake — ammo is deleted, 1b)
   *   - charged shots (Overcharge unlock; cost = the charge-time hold only)
   *   - burst-fire state setup
   *   - screen shake
   *   - projectile spawning via ProjectileSystem
   * Returns `true` if a shot was actually fired.
   */
  public firePlayerWeapon(
    entities: GameEntity[],
    player: GameEntity,
    target: Vector2,
    onShake?: (amount: number, opts?: { rumble?: RumbleKind }) => void,
    charged: boolean = false,
    /** Haptic-only feedback: rumble WITHOUT a camera shake.  The plain
     *  Blaster is the case that needs it — it is the fastest gun in the game,
     *  so shaking the camera on every shot would be unplayable, but the hand
     *  should still feel each one. */
    onRumble?: (amount: number, kind?: RumbleKind) => void,
    /** Fired once per shot actually spawned, for SFX.  Symmetrical with
     *  `onShake` — WeaponSystem stays free of audio state; the caller
     *  maps the weapon type onto an SFX_INVENTORY id. */
    onFire?: (weapon: WeaponType, isCharged: boolean, subShotIndex: number) => void,
  ): boolean {
    // Weaponless flight (no gun mounted) is a legal outfit — nothing to
    // fire.  The weight system pays this back as an acceleration boost.
    if (player.currentWeapon === undefined) return false;
    if (player.weaponCooldown && player.weaponCooldown > 0) return false;

    const weaponType = player.currentWeapon;
    const baseConfig = WEAPONS[weaponType];

    // Charged shots require the Overcharge unlock; there is no resource
    // cost — the 1.0s hold IS the price (by design, WEAPONS_AMMO_PLAN §2.3).
    const isCharged = charged && (player.overchargeUnlocked ?? false);

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

    // Every player shot asks for the TRIGGER kind: on a pad with trigger
    // motors the recoil is felt in the trigger under the finger that pulled
    // it, and everywhere else it falls back to the ordinary handle thump.
    if (onShake) {
      if (config.type === WeaponType.SHOTGUN) {
        onShake(isCharged ? 8 : 5, { rumble: 'trigger' });
      } else if (config.type === WeaponType.CANNON) {
        onShake(isCharged ? COLLISION_CONFIG.SHAKE.HEAVY : COLLISION_CONFIG.SHAKE.MEDIUM, { rumble: 'trigger' });
      } else if (config.type === WeaponType.BURST) {
        onShake(3, { rumble: 'trigger' });
      } else if (config.type === WeaponType.BLASTER && isCharged) {
        onShake(COLLISION_CONFIG.SHAKE.MEDIUM, { rumble: 'trigger' });
      }
    }
    // The plain Blaster shakes NO camera by design; it still kicks the pad.
    if (onRumble && config.type === WeaponType.BLASTER && !isCharged) {
      onRumble(INPUT_CONSTANTS.RUMBLE.WEAPON_TICK, 'trigger');
    }

    if (config.type === WeaponType.BURST && config.burstCount) {
      player.burstQueue = config.burstCount - 1;
      player.burstTimer = config.burstDelay;
      player.burstCharged = isCharged || undefined;
    }

    this.projectiles.spawn(entities, player, target, config, EntityType.PLAYER);
    onFire?.(config.type, isCharged, 0);
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
    onShake?: (amount: number) => void,
    onFire?: (weapon: WeaponType, isCharged: boolean, subShotIndex: number) => void,
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
    // Sub-shot index counts UP as the queue drains, so the caller can step
    // the pitch and make a burst read as a rising triplet.
    onFire?.(config.type, player.burstCharged === true,
             (config.burstCount ?? 1) - player.burstQueue);
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
    const rangeSq = ENEMY_CONSTANTS.VISION_RANGE * ENEMY_CONSTANTS.VISION_RANGE;

    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      const arch = enemy.enemySubtype ? ENEMY_VARIANTS[enemy.enemySubtype] : undefined;
      if (!arch || !arch.shoots) continue; // every shooting enemy fires its archetype weapon

      // Cooldown management
      enemy.weaponCooldown = Math.max(0, (enemy.weaponCooldown ?? 0) - dt);

      const dx = wrapDeltaX(enemy.position.x, player.position.x);
      const dy = wrapDeltaY(enemy.position.y, player.position.y);
      const distSq = dx * dx + dy * dy;
      const inRange = distSq <= rangeSq;

      // Attack telegraph: ramp aimCharge 0→1 over the archetype's window as
      // the cooldown winds down, but only while engaged (in range).  Cleared
      // otherwise so idle / out-of-range enemies show no tell.  (Computed
      // before the fire early-outs so the wind-up renders even mid-cooldown.)
      const tw = arch.telegraph;
      if (tw && inRange && enemy.weaponCooldown <= tw) {
        enemy.aimCharge = 1 - enemy.weaponCooldown / tw;
        // Laser snipers track the player's live distance so the sight reaches
        // them; refreshed every charging frame (the sniper rotates to track).
        if (arch.aimLaser) enemy.aimDist = Math.sqrt(distSq);
      } else if (enemy.aimCharge) {
        enemy.aimCharge = 0;
      }

      if (enemy.weaponCooldown > 0) continue;
      if (!inRange) continue;

      // Per-archetype weapon = ENEMY_WEAPON with the archetype's overrides, then
      // the per-entity override on top ((h) boss phases re-tune the same gun
      // through the same Partial<WeaponConfig> pattern the archetypes use).
      const weapon = enemy.weaponOverride
        ? { ...ENEMY_WEAPON, ...arch.weapon, ...enemy.weaponOverride }
        : arch.weapon ? { ...ENEMY_WEAPON, ...arch.weapon } : ENEMY_WEAPON;

      // Laser snipers fire EXACTLY down the rendered lock-on line (= the ship's
      // facing) with no spread — the sight is a promise.  Everyone else aims at
      // the player's current position with the weapon's slight inaccuracy.
      const aimAngle = arch.aimLaser
        ? enemy.rotation
        : Math.atan2(dy, dx) + (Math.random() - 0.5) * (weapon.spread * Math.PI / 180);
      const targetX = enemy.position.x + Math.cos(aimAngle) * 500;
      const targetY = enemy.position.y + Math.sin(aimAngle) * 500;
      // Per-wave damage scaling + the Orbiter's corrosion payload.
      const dmgMult = enemy.damageMult ?? 1;
      const fx = enemy.enemySubtype ? ENEMY_ATTACK_EFFECTS[enemy.enemySubtype] : undefined;
      let shot = weapon;
      if (dmgMult !== 1 || fx) {
        shot = { ...weapon };
        if (dmgMult !== 1) shot.damage = weapon.damage * dmgMult;
        if (fx) { shot.appliesEffect = fx; shot.color = CORROSION.COLOR; }
      }
      this.projectiles.spawn(entities, enemy, { x: targetX, y: targetY }, shot, EntityType.ENEMY);
      // Enemy-fire audio (SFX_INVENTORY §4.2), voiced apart from the
      // player's family so incoming and outgoing are tellable by ear.
      // The variant picks the voice: the Bulwark's fan sounds ONCE per
      // volley rather than per pellet, since that is one gesture visually
      // too.
      if (this.onEnemyFire) {
        const id = enemy.isBoss ? 'enemy.shot.boss'
          : shot.homing ? 'enemy.shot.missile'
          : fx ? 'enemy.shot.acid'
          : (arch.burst && (enemy.burstQueue === undefined || enemy.burstQueue >= arch.burst.size))
            ? 'enemy.shot.fan'
          : 'enemy.shot.basic';
        this.onEnemyFire(id, enemy.position.x, enemy.position.y);
      }

      // Cadence: archetypes with a `burst` fire `size` shots `gap` apart then
      // reload for the weapon's full `cooldown`; everyone else fires one shot
      // per `cooldown`.  The per-archetype cooldown IS the fire rate.
      const burst = arch.burst;
      if (burst) {
        if (enemy.burstQueue === undefined || enemy.burstQueue <= 0) enemy.burstQueue = burst.size;
        if (enemy.burstQueue > 1) {
          enemy.burstQueue--;
          enemy.weaponCooldown = burst.gap;
        } else {
          enemy.burstQueue = burst.size;
          enemy.weaponCooldown = weapon.cooldown;
        }
      } else {
        enemy.weaponCooldown = weapon.cooldown;
      }
    }
  }

  /**
   * Weapon selection semantics (2-slot loadout model, pivot 1b):
   * - Only an EQUIPPED weapon can be selected — the loadout is the in-field
   *   commitment; ownership alone isn't enough (swap at the Drydock).
   * - Selecting the already-active weapon is a no-op.
   * Returns the new currentWeapon index in WEAPON_LIST for UI state.
   */
  public selectWeapon(player: GameEntity, wType: WeaponType): number {
    const equipped = player.equippedWeapons ?? [WeaponType.BLASTER, null];
    if (!equipped.includes(wType)) {
      return WEAPON_LIST.indexOf(player.currentWeapon || WeaponType.BLASTER);
    }
    if (player.currentWeapon !== wType) {
      player.currentWeapon = wType;
      player.burstQueue = 0;
    }
    return WEAPON_LIST.indexOf(wType);
  }

  /**
   * Cycle between the (at most 2) equipped loadout slots.  With one slot
   * filled this is a no-op.
   */
  public cycleWeapon(player: GameEntity): number {
    const equipped = (player.equippedWeapons ?? [WeaponType.BLASTER, null])
      .filter((w): w is WeaponType => w !== null);
    if (equipped.length <= 1) return WEAPON_LIST.indexOf(player.currentWeapon || equipped[0] || WeaponType.BLASTER);
    const currentIdx = equipped.indexOf(player.currentWeapon || equipped[0]);
    player.currentWeapon = equipped[(currentIdx + 1) % equipped.length];
    player.burstQueue = 0;
    return WEAPON_LIST.indexOf(player.currentWeapon);
  }

  /** Expose the weapon config for a given type (convenience for callers). */
  public getConfig(wType: WeaponType): WeaponConfig {
    return WEAPONS[wType];
  }
}
