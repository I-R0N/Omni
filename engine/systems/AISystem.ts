

import { GameEntity, EnemySubtype, EnemyRole, Vector2 } from '../../types';
import { ENEMY_VARIANTS, ENEMY_ROLE, AI_CONFIG } from '../../constants';
import { FlowFieldGrid } from './FlowFieldGrid';
import { wrapDeltaX, wrapDeltaY } from '../toroidal';

export class AISystem {
  // Store persistent aim targets to simulate reaction time.
  // Instead of tracking the player perfectly every frame, enemies aim at where the player *was*
  // a fraction of a second ago.
  private laggedTargets: Map<string, Vector2> = new Map();
  private reactionTimers: Map<string, number> = new Map();

  // Stuck detection: sample position every STUCK_CHECK_INTERVAL seconds;
  // if the enemy hasn't moved enough, apply a random impulse to break free.
  private stuckTimers: Map<string, number> = new Map();
  private lastPositions: Map<string, Vector2> = new Map();

  // Reused scratch buffer for the 5%-frame GC sweep that drops aim/reaction
  // state for dead enemies.  Cleared and refilled in-place each sweep so we
  // don't allocate a fresh Set per call.
  private _liveIdScratch: Set<string> = new Set();

  // Perf instrumentation — wall-time (ms) of the most recent update() call.
  // Written by update() and read by GameEngine for the dev perf overlay.
  public lastUpdateMs: number = 0;

  /**
   * Advance every enemy's AI by one sim step.
   *
   * `enemies` is the pre-filtered EntityIndex list — all entries are
   * guaranteed to be `active` and of type `ENEMY`, so each inner loop can
   * skip the type/active re-checks and run on the minimal candidate set.
   * This in particular turns the pack-sync pass (which used to nest two
   * full-entity scans) into an O(enemies²) walk on a handful of entries
   * instead of O(allEntities²) with filtering.
   */
  public update(dt: number, enemies: GameEntity[], player: GameEntity, flowField: FlowFieldGrid) {
    const t0 = performance.now();
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];

      // Default initialization
      if (!enemy.aiState) {
          enemy.aiState = 'chase';
          enemy.aiTimer = 0;
      }

      // Init Reaction Timer if missing
      if (!this.reactionTimers.has(enemy.id)) {
          this.reactionTimers.set(enemy.id, 0);
          this.laggedTargets.set(enemy.id, { x: player.position.x, y: player.position.y });
      }

      // Decay aggro boost each frame
      if (enemy.aggroTimer && enemy.aggroTimer > 0) {
          enemy.aggroTimer = Math.max(0, enemy.aggroTimer - dt);
      }

      // Hit-stagger: tick down; while > 0 the movement routines apply no
      // force (the knockback carries it), so a hit reads as a brief reel.
      if (enemy.hitStun && enemy.hitStun > 0) {
          enemy.hitStun = Math.max(0, enemy.hitStun - dt);
      }

      // Route by role — add new roles here as needed
      const role = enemy.enemySubtype ? ENEMY_ROLE[enemy.enemySubtype] : EnemyRole.RAMMING;
      if (role === EnemyRole.SHOOTING) {
          this.updateSkirmisher(dt, enemy, player);
      } else {
          this.updateBasicDogfighter(dt, enemy, player, flowField);
      }
    }

    // Pack sync: idle rammers near a chasing rammer get pulled into the charge.
    // Truncating the idle timer to PACK_SYNC_WINDOW forces near-simultaneous
    // attacks — a much harder threat to dodge than staggered individuals.
    //
    // `enemies` is already type-filtered and active — we only need to check
    // for the RAMMING role and the chase/idle states.
    const PACK_RANGE_SQ = AI_CONFIG.PACK_SYNC_RANGE * AI_CONFIG.PACK_SYNC_RANGE;
    for (let i = 0; i < enemies.length; i++) {
      const leader = enemies[i];
      if (!leader.enemySubtype || ENEMY_ROLE[leader.enemySubtype] !== EnemyRole.RAMMING) continue;
      if (leader.aiState !== 'chase') continue;

      for (let j = 0; j < enemies.length; j++) {
        if (i === j) continue;
        const follower = enemies[j];
        if (!follower.enemySubtype || ENEMY_ROLE[follower.enemySubtype] !== EnemyRole.RAMMING) continue;
        if (follower.aiState !== 'idle') continue;

        const pdx = wrapDeltaX(follower.position.x, leader.position.x);
        const pdy = wrapDeltaY(follower.position.y, leader.position.y);
        if (pdx * pdx + pdy * pdy > PACK_RANGE_SQ) continue;

        // Snap idle timer down so this rammer joins the charge within PACK_SYNC_WINDOW
        if ((follower.aiTimer ?? 0) > AI_CONFIG.PACK_SYNC_WINDOW) {
          follower.aiTimer = Math.random() * AI_CONFIG.PACK_SYNC_WINDOW;
        }
      }
    }

    // Garbage Collection: Cleanup dead enemies from aim/reaction maps periodically.
    // `enemies` only contains live entities, so build the live set directly.
    // Scratch Set is reused across sweeps to avoid per-frame allocation.
    if (Math.random() < 0.05) {
        const liveIds = this._liveIdScratch;
        liveIds.clear();
        for (let i = 0; i < enemies.length; i++) {
            liveIds.add(enemies[i].id);
        }
        for (const id of this.laggedTargets.keys()) {
            if (!liveIds.has(id)) {
                this.laggedTargets.delete(id);
                this.reactionTimers.delete(id);
                this.stuckTimers.delete(id);
                this.lastPositions.delete(id);
            }
        }
    }

    this.lastUpdateMs = performance.now() - t0;
  }

  /**
   * Skirmisher AI:
   * Maintains a specific distance range. 
   * - If too close, flees.
   * - If too far, approaches.
   * - If in "sweet spot", strafes laterally to dodge.
   */
  private updateSkirmisher(dt: number, enemy: GameEntity, player: GameEntity) {
      const config = ENEMY_VARIANTS[enemy.enemySubtype || EnemySubtype.SHOOTER_1];
      const baseMaxSpeed = enemy.maxSpeed ?? config.maxSpeed ?? 12;
      const aggroed = (enemy.aggroTimer ?? 0) > 0;
      const maxSpeed = aggroed ? baseMaxSpeed * AI_CONFIG.AGGRO_SPEED_MULT : baseMaxSpeed;
      const accel = config.accel || 8;
      const turnRate = config.turnRate || 1.5;

      const dx = wrapDeltaX(enemy.position.x, player.position.x);
      const dy = wrapDeltaY(enemy.position.y, player.position.y);
      const dist = Math.sqrt(dx*dx + dy*dy);

      const { PREFERRED_DIST, DEADZONE, STRAFE_MODIFIER, LEAD_FACTOR, PROJECTILE_SPEED } = AI_CONFIG.SKIRMISHER;

      // Aim-lead: predict where the player will be when the projectile arrives.
      // Movement still tracks the real player position for responsive seek/flee/strafe.
      // Use toroidal delta so enemies near a seam aim at the nearest wrapped
      // copy of the player instead of firing across the entire map.
      const leadTime = (dist / PROJECTILE_SPEED) * LEAD_FACTOR;
      const aimX = dx + player.velocity.x * leadTime;
      const aimY = dy + player.velocity.y * leadTime;
      let targetAngle = Math.atan2(aimY, aimX);

      const stunned = (enemy.hitStun ?? 0) > 0;
      // Laser snipers plant themselves while locked on (aimCharge > 0) so the
      // shot is a deliberate, telegraphed event from a stationary camper —
      // brake hard to a stop instead of strafing.
      const locked = !!enemy.aimLaser && (enemy.aimCharge ?? 0) > 0;
      if (stunned) {
          // Staggered — apply no movement force this step (the knockback rides).
      } else if (locked) {
          enemy.velocity.x *= 0.8;
          enemy.velocity.y *= 0.8;
      } else if (dist < PREFERRED_DIST - DEADZONE) {
          // Behavior: BACK OFF (Flee)
          const fleeX = -dx / dist;
          const fleeY = -dy / dist;
          enemy.velocity.x += fleeX * accel * dt;
          enemy.velocity.y += fleeY * accel * dt;
      } else if (dist > PREFERRED_DIST + DEADZONE) {
          // Behavior: CLOSE GAP (Seek)
          const seekX = dx / dist;
          const seekY = dy / dist;
          enemy.velocity.x += seekX * accel * dt;
          enemy.velocity.y += seekY * accel * dt;
      } else {
          // Behavior: STRAFE (Lateral Movement)
          const strafeX = -dy / dist; // Perpendicular vector
          const strafeY = dx / dist;
          enemy.velocity.x += strafeX * (accel * STRAFE_MODIFIER) * dt;
          enemy.velocity.y += strafeY * (accel * STRAFE_MODIFIER) * dt;
      }

      // Cap Speed — suspended while staggered so the hit knockback carries
      // the enemy back instead of being clamped to cruise.
      const speed = Math.sqrt(enemy.velocity.x**2 + enemy.velocity.y**2);
      if (!stunned && speed > maxSpeed) {
          enemy.velocity.x = (enemy.velocity.x / speed) * maxSpeed;
          enemy.velocity.y = (enemy.velocity.y / speed) * maxSpeed;
      }

      // Rotation: Always face the player to shoot
      let angleDiff = targetAngle - enemy.rotation;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      
      const turnStep = turnRate * dt;
      if (Math.abs(angleDiff) < turnStep) {
          enemy.rotation = targetAngle;
      } else {
          enemy.rotation += Math.sign(angleDiff) * turnStep;
      }
  }

  /**
   * Basic Dogfighter AI:
   * Uses a state machine to switch between "Charging" and "Coasting/Turning".
   * Simulated reaction delay makes them inaccurate at hitting a moving player.
   */
  private updateBasicDogfighter(dt: number, enemy: GameEntity, player: GameEntity, flowField: FlowFieldGrid) {
      // Use config based on subtype (Basic, Charger, Tank have different stats)
      const config = ENEMY_VARIANTS[enemy.enemySubtype || EnemySubtype.RAMMER_1];
      const baseMaxSpeed = enemy.maxSpeed ?? config.maxSpeed ?? 10;
      const aggroed = (enemy.aggroTimer ?? 0) > 0;
      const maxSpeed = aggroed ? baseMaxSpeed * AI_CONFIG.AGGRO_SPEED_MULT : baseMaxSpeed;
      const accel = config.accel || 6;
      const turnRate = config.turnRate || 1.25;

      const isRammer = enemy.enemySubtype ? ENEMY_ROLE[enemy.enemySubtype] === EnemyRole.RAMMING : true;
      const timers = isRammer ? AI_CONFIG.RAMMER : AI_CONFIG;
      const rotThreshold = isRammer ? AI_CONFIG.RAMMER.ROTATION_THRESHOLD : AI_CONFIG.ROTATION_THRESHOLD;

      // --- TARGETING LOGIC (Delayed Aim) ---
      let reaction = this.reactionTimers.get(enemy.id) || 0;
      reaction -= dt;

      if (reaction <= 0) {
          // Mutate the existing Vector2 in place — the laggedTargets entry
          // is created once at enemy init (above) and lives for the enemy's
          // lifetime, so we never need to allocate a fresh object here.
          const lt = this.laggedTargets.get(enemy.id)!;
          lt.x = player.position.x;
          lt.y = player.position.y;
          reaction = AI_CONFIG.REACTION_TIME_BASE + Math.random() * AI_CONFIG.REACTION_TIME_VAR;
      }
      this.reactionTimers.set(enemy.id, reaction);

      const targetPos = this.laggedTargets.get(enemy.id) || player.position;

      // Distance to the player is needed by both the state machine's
      // rammer-retreat branch and the movement block below, so compute
      // it once up front.  Wrapped delta so rammers near a seam don't
      // see the player as being across the whole map when they're in
      // fact 50 units away across the wrap.
      const dxPlayer = wrapDeltaX(enemy.position.x, player.position.x);
      const dyPlayer = wrapDeltaY(enemy.position.y, player.position.y);
      const distToPlayer = Math.sqrt(dxPlayer * dxPlayer + dyPlayer * dyPlayer);

      // --- STATE MACHINE ---
      if (enemy.aiTimer && enemy.aiTimer > 0) {
          enemy.aiTimer -= dt;
      } else {
          if (enemy.aiState === 'chase') {
              enemy.aiState = 'idle';
              // Aggro shortens idle so enraged enemies press the attack faster.
              const idleMult = aggroed ? AI_CONFIG.AGGRO_IDLE_MULT : 1;
              enemy.aiTimer = (timers.IDLE_TIME_BASE + Math.random() * timers.IDLE_TIME_VAR) * idleMult;

              // Retreat arc: when the rammer has just overshot the player,
              // kick it laterally so it circles away instead of stopping dead.
              if (isRammer && distToPlayer < AI_CONFIG.RAMMER.RETREAT_TRIGGER_DIST) {
                  const spd = Math.sqrt(enemy.velocity.x ** 2 + enemy.velocity.y ** 2);
                  if (spd > 0.1) {
                      const vx = enemy.velocity.x / spd;
                      const vy = enemy.velocity.y / spd;
                      const sign = Math.random() < 0.5 ? 1 : -1;
                      enemy.velocity.x += -vy * sign * maxSpeed * AI_CONFIG.RAMMER.RETREAT_IMPULSE;
                      enemy.velocity.y +=  vx * sign * maxSpeed * AI_CONFIG.RAMMER.RETREAT_IMPULSE;
                  }
              }
          } else {
              enemy.aiState = 'chase';
              enemy.aiTimer = timers.CHASE_TIME_BASE + Math.random() * timers.CHASE_TIME_VAR;
          }
      }

      // --- MOVEMENT BEHAVIOR ---
      const longRange = distToPlayer > AI_CONFIG.LONG_RANGE_SEEK_DIST;

      // At long range always seek regardless of idle state, so waves never
      // stall when the player moves away from the initial spawn location.
      // Skip while staggered — the hit knockback carries the enemy briefly.
      const stunned = (enemy.hitStun ?? 0) > 0;
      if ((enemy.aiState === 'chase' || longRange) && !stunned) {
          // ENGAGE: Fly toward the lagged target, blended with the pursuit
          // flow field so enemies navigate around tile clusters.
          // The flow field uses the player's *current* cell as its goal —
          // optimal for routing; the lagged target is kept for rotation/aim.
          const dx = wrapDeltaX(enemy.position.x, targetPos.x);
          const dy = wrapDeltaY(enemy.position.y, targetPos.y);
          const d  = Math.sqrt(dx * dx + dy * dy);

          if (d > 0) {
              const eneFlow = flowField.sampleEnemyFlow(enemy.position.x, enemy.position.y);
              const hasFlow = eneFlow.x !== 0 || eneFlow.y !== 0;

              let moveX: number, moveY: number;
              if (hasFlow) {
                  // 65 % flow field (avoids tile walls) + 35 % direct (stays
                  // responsive when in open space).
                  const directX = dx / d, directY = dy / d;
                  moveX = eneFlow.x * 0.65 + directX * 0.35;
                  moveY = eneFlow.y * 0.65 + directY * 0.35;
                  const mag = Math.sqrt(moveX * moveX + moveY * moveY) || 1;
                  moveX /= mag;
                  moveY /= mag;
              } else {
                  // No flow field data — blend direct chase with wall repulsion
                  // so enemies deflect around tile clusters instead of pressing in.
                  const repulsion = flowField.sampleWallRepulsion(enemy.position.x, enemy.position.y);
                  moveX = dx / d + repulsion.x * 0.8;
                  moveY = dy / d + repulsion.y * 0.8;
                  const mag = Math.sqrt(moveX * moveX + moveY * moveY) || 1;
                  moveX /= mag;
                  moveY /= mag;
              }

              enemy.velocity.x += moveX * accel * dt;
              enemy.velocity.y += moveY * accel * dt;
          }
      }
      // Note: In 'idle' state, no force is applied, friction naturally slows the ship (drifting)

      // Cap Speed — suspended while staggered so the hit knockback carries
      // the enemy back instead of being clamped to cruise.
      const speed = Math.sqrt(enemy.velocity.x**2 + enemy.velocity.y**2);
      if (!stunned && speed > maxSpeed) {
          enemy.velocity.x = (enemy.velocity.x / speed) * maxSpeed;
          enemy.velocity.y = (enemy.velocity.y / speed) * maxSpeed;
      }

      // --- STUCK DETECTION ---
      // If the enemy has barely moved over the check interval while chasing,
      // it's pinned against geometry. Apply a random impulse to break free.
      // Toroidal delta so a wrap-around mid-interval doesn't read as a huge
      // jump and suppress the stuck detection.
      let stuckTimer = (this.stuckTimers.get(enemy.id) ?? AI_CONFIG.STUCK_CHECK_INTERVAL) - dt;
      if (stuckTimer <= 0) {
          const last = this.lastPositions.get(enemy.id);
          if (last && (enemy.aiState === 'chase' || longRange)) {
              const sx = wrapDeltaX(last.x, enemy.position.x);
              const sy = wrapDeltaY(last.y, enemy.position.y);
              if (sx * sx + sy * sy < AI_CONFIG.STUCK_DIST_THRESHOLD * AI_CONFIG.STUCK_DIST_THRESHOLD) {
                  const nudgeAngle = Math.random() * Math.PI * 2;
                  enemy.velocity.x += Math.cos(nudgeAngle) * maxSpeed * 0.8;
                  enemy.velocity.y += Math.sin(nudgeAngle) * maxSpeed * 0.8;
              }
          }
          // Reuse the existing Vector2 when one already exists for this
          // enemy; only allocate on first sample.
          const existing = this.lastPositions.get(enemy.id);
          if (existing) {
              existing.x = enemy.position.x;
              existing.y = enemy.position.y;
          } else {
              this.lastPositions.set(enemy.id, { x: enemy.position.x, y: enemy.position.y });
          }
          stuckTimer = AI_CONFIG.STUCK_CHECK_INTERVAL;
      }
      this.stuckTimers.set(enemy.id, stuckTimer);

      // --- ROTATION LOGIC ---
      // Face velocity vector when moving fast (Flight dynamics)
      // Face player when moving slow (Drift/Hover dynamics)
      let targetAngle = enemy.rotation;

      if (speed > rotThreshold) {
          targetAngle = Math.atan2(enemy.velocity.y, enemy.velocity.x);
      } else {
          const toTargetX = wrapDeltaX(enemy.position.x, player.position.x);
          const toTargetY = wrapDeltaY(enemy.position.y, player.position.y);
          targetAngle = Math.atan2(toTargetY, toTargetX);
      }

      let angleDiff = targetAngle - enemy.rotation;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      const turnStep = turnRate * dt;
      if (Math.abs(angleDiff) < turnStep) {
          enemy.rotation = targetAngle;
      } else {
          enemy.rotation += Math.sign(angleDiff) * turnStep;
      }
  }
}
