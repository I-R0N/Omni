import { GameEntity, EntityType, Vector2, WeaponConfig, RumbleKind } from '../../types';
import {
  INPUT_CONSTANTS,
  weaponConfig,
  resolveWeaponKey,
  ENEMY_WEAPON,
  ENEMY_CONSTANTS,
  ENEMY_VARIANTS,
  ENEMY_ATTACK_EFFECTS,
  CORROSION,
  COLLISION_CONFIG,
  projectileMassFor,
} from '../../constants';
import { ProjectileSystem } from './ProjectileSystem';
import { wrapDeltaX, wrapDeltaY } from '../toroidal';

/** Authored-units multiply for a charged shot's BANK.
 *
 *  `WeaponConfig.mass` is the AUTHORED figure and `projectileMassFor` is what
 *  converts it, so writing that function's RESULT back into the field makes
 *  the next conversion scale it again — MASS_SCALE twice over, a 10x heavier
 *  charge than intended.  `withGunnery` carries the same note for the same
 *  reason. */
function chargedMass(config: WeaponConfig, k: number): number | undefined {
  return config.mass !== undefined ? config.mass * k : undefined;
}

/**
 * The CHARGED variant of any weapon (Overcharge).  One rule per DELIVERY,
 * plus one per PAYLOAD — so all thirty combinations have a charge without
 * thirty authored entries, and the charge premium always reads as "more of
 * what this delivery does":
 *   projectile — a much heavier round (the old Blaster fireball); a shell
 *                gets the old Cannon charge (bigger, heavier blast)
 *   spread     — twice the rounds in a wider cone
 *   homing     — a three-round volley with looser tracking
 *   beam       — a longer, wider pulse; a tractor PUSHES instead of pulling
 *   radial     — a wider ring
 * and every payload rides along: more heat, a longer arc chain, a stronger
 * pull.  The mass bumps are expressed in AUTHORED units (`chargedMass`).
 */
function chargedConfigOf(config: WeaponConfig): WeaponConfig {
  const out: WeaponConfig = { ...config };
  switch (config.delivery) {
    case 'projectile':
      if (config.explosionRadius) {
        out.mass = chargedMass(config, 1.5);
        out.explosionRadius = config.explosionRadius * 2;
        out.explosionDamage = config.explosionDamage !== undefined ? config.explosionDamage * 1.5 : undefined;
        out.explosionKnockback = (config.explosionKnockback ?? 0) * 1.5;
      } else {
        out.damage = config.damage * 2.5;
        out.mass = chargedMass(config, 6);
        out.size = config.size * 1.8;
        out.recoil = 0;
        // The fireball render belongs to the plain / kinetic round.
        if (!config.energy || config.energy === 'kinetic') out.isCharged = true;
      }
      break;
    case 'spread':
      out.count = config.count * 2;
      out.spread = config.spread * 1.4;
      out.mass = chargedMass(config, 1.5);
      if (config.coneHalfDeg) out.coneHalfDeg = config.coneHalfDeg * 1.4;
      break;
    case 'homing':
      out.count = 3;
      out.spread = 30;
      out.mass = chargedMass(config, 2);
      out.homingStrength = 0.5;
      break;
    case 'beam':
      out.beamDuration = (config.beamDuration ?? 0) * 1.6;
      out.beamWidth = (config.beamWidth ?? 2) * 1.5;
      break;
    case 'radial':
      out.pulseRadius = (config.pulseRadius ?? 0) * 1.35;
      if (config.explosionRadius) out.explosionRadius = config.explosionRadius * 1.35;
      break;
  }
  if (config.heat) out.heat = config.heat * 1.75;
  if (config.electric) {
    out.electric = { ...config.electric, magnitude: config.electric.magnitude * 1.5,
      targets: config.electric.targets + 2, branches: config.electric.branches + 1 };
  }
  if (config.magnetic) {
    out.magnetic = { ...config.magnetic, strength: config.magnetic.strength * 1.5,
      mode: config.delivery === 'beam' ? 'push' : config.magnetic.mode };
  }
  return out;
}

/** Apply the player's GUNNERY modules to one shot config.
 *
 *  A mark buys a DENSER ROUND, which is one statement with two halves under
 *  the energy model: the BITE (`damage`, what a contact deposits) and the BANK
 *  (`mass`, with `speed` the energy the round launches with, and so how many
 *  bites it can afford).  Scaling only the bite would make a Gunnery round hit
 *  harder and stop SOONER — it would spend its fixed bank in fewer, bigger
 *  contacts — which is the opposite of what a heavier shell does.
 *
 *  This is also where the deleted Penetration module went (step 5).  Depth was
 *  worth selling separately only while it was an authored count; now that it
 *  is energy divided by what the target charges, a heavier round is a deeper
 *  one for free, and there was nothing left for a second module to sell.
 *
 *  A mark therefore moves THREE things on an explosive round — bite, bank and
 *  the blast's REACH — and only the first two are one statement.  See the
 *  `explosionRadius` note below for why the reach had to be said out loud.
 *
 *  `mass` is resolved through `projectileMassFor` FIRST so the scaling lands
 *  on a real number either way — a gun that authors none would otherwise have
 *  its bank derived from the already-scaled damage downstream, which double-
 *  counts the mark.
 *
 *  Applied to the COPY, never to the shared WEAPONS table — the same rule the
 *  cooldown fold follows. */
function withGunnery(config: WeaponConfig, player: GameEntity): WeaponConfig {
  const mult = player.damageMult ?? 1;
  if (mult === 1) return config;
  return {
    ...config,
    damage: config.damage * mult,
    // Energy payloads are part of the round, so a denser round carries more
    // of them.  Magnetic force is not — it is capped per body (MAG_MAX_DV).
    heat: config.heat !== undefined ? config.heat * mult : undefined,
    electric: config.electric ? { ...config.electric, magnitude: config.electric.magnitude * mult } : undefined,
    // AUTHORED UNITS, because that is what `WeaponConfig.mass` means and
    // `projectileMassFor` is what converts it — writing its already-scaled
    // RESULT back into this field made the round scale twice (measured: a
    // Gunnery mark multiplied the mass by 13.6 against the bite's 1.36).
    // Left undefined it stays undefined on purpose: the derived branch is
    // proportional to `damage`, which is already multiplied above, so the
    // bank follows the mark for free.
    mass: config.mass !== undefined ? config.mass * mult : undefined,
    // NOT scaled: a DERIVED blast reads the round's own mass, which the line
    // above already multiplied, so touching it here would apply the mark
    // twice.  An authored override (a boss shell) is a designed number and
    // is deliberately left alone.
    explosionDamage: config.explosionDamage,
    // ...BUT THE RING HAS TO GROW, OR THE MARK IS INVISIBLE (user report: "I
    // can't clearly tell that the blast grows").  The arithmetic was never
    // wrong — three Mk III measured the peak at exactly x2.08, 20.8 -> 43.2 —
    // but `explosionRadius` was authored flat, so the ring the player watches
    // was pixel-for-pixel identical at every mark and the only tell was a
    // damage number on a bystander.  A bigger charge reaches further.
    //
    // SQUARE ROOT, because this is a 2D world: what the energy buys is the
    // ring's AREA, so scaling the RADIUS linearly would count the mark twice
    // over (x2.08 radius is x4.3 area).  At three Mk III that is 110 -> 159,
    // which reads immediately beside the unchanged base.
    //
    // Gated on the blast being DERIVED, the same rule the line above follows:
    // a weapon that authors its own `explosionDamage` (BOSS_WEAPONS.SIEGE) is
    // a designed encounter's number and keeps its authored reach too.
    explosionRadius: config.explosionDamage === undefined && config.explosionRadius
      ? config.explosionRadius * Math.sqrt(mult)
      : config.explosionRadius,
  };
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
  /** Resolves a delivery that is not a round (beam, radial, instant cone).
   *  Set once by GameEngine to the energy layer; see engine/energyEffects.ts. */
  public onInstantFire: ((config: WeaponConfig, player: GameEntity, target: Vector2) => void) | null = null;

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
     *  projector is the case that needs it — the fastest cadence in the game,
     *  so shaking the camera every shot would be unplayable. */
    onRumble?: (amount: number, kind?: RumbleKind) => void,
    /** Fired once per shot, for SFX.  WeaponSystem stays free of audio
     *  state; the caller maps the weapon onto an SFX_INVENTORY id. */
    onFire?: (weapon: WeaponConfig, isCharged: boolean, subShotIndex: number) => void,
  ): boolean {
    // Weaponless flight (no gun mounted) is a legal outfit — nothing to fire.
    if (player.currentWeapon === undefined) return false;
    if (player.weaponCooldown && player.weaponCooldown > 0) return false;

    // Resolve through the module table (old ids map onto their combination).
    const baseConfig = weaponConfig(player.currentWeapon);

    // Charged shots require the Overcharge unlock; the hold IS the price.
    const isCharged = charged && (player.overchargeUnlocked ?? false);

    let config = isCharged ? chargedConfigOf(baseConfig) : baseConfig;
    // Gunnery scales the round (bite, bank, payloads); Autoloader the cadence.
    // Copy-on-write, so the shared WEAPONS table is never mutated.
    config = withGunnery(config, player);
    player.weaponCooldown = baseConfig.cooldown * (player.cooldownMult ?? 1);

    // Feel by delivery: the heavy commits shake, the fast cadence only buzzes.
    if (onShake) {
      if (config.explosionRadius && config.delivery !== 'beam') {
        onShake(isCharged ? COLLISION_CONFIG.SHAKE.HEAVY : COLLISION_CONFIG.SHAKE.MEDIUM, { rumble: 'trigger' });
      } else if (config.delivery === 'spread' || config.delivery === 'radial') {
        onShake(isCharged ? 8 : 5, { rumble: 'trigger' });
      } else if (isCharged) {
        onShake(COLLISION_CONFIG.SHAKE.MEDIUM, { rumble: 'trigger' });
      }
    }
    if (onRumble && !isCharged && (config.delivery === 'projectile' || config.delivery === 'homing')
        && !config.explosionRadius) {
      onRumble(INPUT_CONSTANTS.RUMBLE.WEAPON_TICK, 'trigger');
    }

    // DISPATCH BY DELIVERY.  Rounds go to the projectile system; a beam, a
    // radial pulse and an instant-cone spread (electric forks, magnetic
    // repulsor) are resolved by the energy layer, which owns the grids.
    const instant = config.delivery === 'beam' || config.delivery === 'radial'
      || (config.delivery === 'spread' && config.coneHalfDeg !== undefined);
    if (instant) {
      this.onInstantFire?.(config, player, target);
    } else {
      this.projectiles.spawn(entities, player, target, config, EntityType.PLAYER);
    }
    onFire?.(config, isCharged, 0);
    return true;
  }

  /** Tick the player's weapon cooldown.  Called each sim tick. */
  public tickPlayerCooldown(player: GameEntity, dt: number) {
    if (player.weaponCooldown && player.weaponCooldown > 0) {
      player.weaponCooldown -= dt;
    }
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
   * Weapon selection semantics (2-slot loadout):
   * - Only an EQUIPPED weapon can be selected — the loadout is the in-field
   *   commitment.  Old ids are resolved to their combination first.
   * - Selecting the already-active weapon is a no-op.
   * Returns the selected weapon's loadout slot, or -1.
   */
  public selectWeapon(player: GameEntity, id: string): number {
    const equipped = player.equippedWeapons ?? [];
    const key = resolveWeaponKey(id) ?? id;
    const slot = equipped.indexOf(key);
    if (slot < 0) return equipped.indexOf(player.currentWeapon ?? null);
    player.currentWeapon = key;
    return slot;
  }

  /** Cycle between the (at most 2) equipped loadout slots. */
  public cycleWeapon(player: GameEntity): number {
    const equipped = (player.equippedWeapons ?? []).filter((w): w is string => w !== null);
    if (equipped.length === 0) return -1;
    if (equipped.length === 1) { player.currentWeapon = equipped[0]; return 0; }
    const currentIdx = equipped.indexOf(player.currentWeapon ?? equipped[0]);
    player.currentWeapon = equipped[(currentIdx + 1) % equipped.length];
    return (player.equippedWeapons ?? []).indexOf(player.currentWeapon);
  }

  /** Expose the weapon config for an id (convenience for callers). */
  public getConfig(id: string): WeaponConfig {
    return weaponConfig(id);
  }
}
