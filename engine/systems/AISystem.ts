

import { GameEntity, EntityType, EnemySubtype, EnemyRole, Vector2 } from '../../types';
import { ENEMY_VARIANTS, ENEMY_ROLE, AI_CONFIG } from '../../constants';
import { FlowFieldGrid } from './FlowFieldGrid';

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

  public update(dt: number, entities: GameEntity[], player: GameEntity, flowField: FlowFieldGrid) {
    for (let i = 0; i < entities.length; i++) {
      const enemy = entities[i];
      if (!enemy.active || enemy.type !== EntityType.ENEMY) continue;

      // Default initialization
      if (!enemy.aiState) {
          enemy.aiState = 'chase';
          enemy.aiTimer = 0;
      }

      // Init Reaction Timer if missing
      if (!this.reactionTimers.has(enemy.id)) {
          this.reactionTimers.set(enemy.id, 0);
          this.laggedTargets.set(enemy.id, { ...player.position });
      }

      // Decay aggro boost each frame
      if (enemy.aggroTimer && enemy.aggroTimer > 0) {
          enemy.aggroTimer = Math.max(0, enemy.aggroTimer - dt);
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
    for (let i = 0; i < entities.length; i++) {
      const leader = entities[i];
      if (!leader.active || leader.type !== EntityType.ENEMY) continue;
      if (!leader.enemySubtype || ENEMY_ROLE[leader.enemySubtype] !== EnemyRole.RAMMING) continue;
      if (leader.aiState !== 'chase') continue;

      for (let j = 0; j < entities.length; j++) {
        if (i === j) continue;
        const follower = entities[j];
        if (!follower.active || follower.type !== EntityType.ENEMY) continue;
        if (!follower.enemySubtype || ENEMY_ROLE[follower.enemySubtype] !== EnemyRole.RAMMING) continue;
        if (follower.aiState !== 'idle') continue;

        const pdx = leader.position.x - follower.position.x;
        const pdy = leader.position.y - follower.position.y;
        if (pdx * pdx + pdy * pdy > AI_CONFIG.PACK_SYNC_RANGE * AI_CONFIG.PACK_SYNC_RANGE) continue;

        // Snap idle timer down so this rammer joins the charge within PACK_SYNC_WINDOW
        if ((follower.aiTimer ?? 0) > AI_CONFIG.PACK_SYNC_WINDOW) {
          follower.aiTimer = Math.random() * AI_CONFIG.PACK_SYNC_WINDOW;
        }
      }
    }

    // Garbage Collection: Cleanup dead enemies from aim/reaction maps periodically
    if (Math.random() < 0.05) {
        const liveIds = new Set<string>();
        for (let i = 0; i < entities.length; i++) {
            if (entities[i].active && entities[i].type === EntityType.ENEMY) liveIds.add(entities[i].id);
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

      const dx = player.position.x - enemy.position.x;
      const dy = player.position.y - enemy.position.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      
      const { PREFERRED_DIST, DEADZONE, STRAFE_MODIFIER, LEAD_FACTOR, PROJECTILE_SPEED } = AI_CONFIG.SKIRMISHER;

      // Aim-lead: predict where the player will be when the projectile arrives.
      // Movement still tracks the real player position for responsive seek/flee/strafe.
      const leadTime = (dist / PROJECTILE_SPEED) * LEAD_FACTOR;
      const aimX = player.position.x + player.velocity.x * leadTime - enemy.position.x;
      const aimY = player.position.y + player.velocity.y * leadTime - enemy.position.y;
      let targetAngle = Math.atan2(aimY, aimX);
      
      if (dist < PREFERRED_DIST - DEADZONE) {
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

      // Cap Speed
      const speed = Math.sqrt(enemy.velocity.x**2 + enemy.velocity.y**2);
      if (speed > maxSpeed) {
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
          this.laggedTargets.set(enemy.id, { ...player.position });
          reaction = AI_CONFIG.REACTION_TIME_BASE + Math.random() * AI_CONFIG.REACTION_TIME_VAR;
      }
      this.reactionTimers.set(enemy.id, reaction);

      const targetPos = this.laggedTargets.get(enemy.id) || player.position;

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
      const dxPlayer = player.position.x - enemy.position.x;
      const dyPlayer = player.position.y - enemy.position.y;
      const distToPlayer = Math.sqrt(dxPlayer * dxPlayer + dyPlayer * dyPlayer);
      const longRange = distToPlayer > AI_CONFIG.LONG_RANGE_SEEK_DIST;

      // At long range always seek regardless of idle state, so waves never
      // stall when the player moves away from the initial spawn location.
      if (enemy.aiState === 'chase' || longRange) {
          // ENGAGE: Fly toward the lagged target, blended with the pursuit
          // flow field so enemies navigate around tile clusters.
          // The flow field uses the player's *current* cell as its goal —
          // optimal for routing; the lagged target is kept for rotation/aim.
          const dx = targetPos.x - enemy.position.x;
          const dy = targetPos.y - enemy.position.y;
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

      // Cap Speed
      const speed = Math.sqrt(enemy.velocity.x**2 + enemy.velocity.y**2);
      if (speed > maxSpeed) {
          enemy.velocity.x = (enemy.velocity.x / speed) * maxSpeed;
          enemy.velocity.y = (enemy.velocity.y / speed) * maxSpeed;
      }

      // --- STUCK DETECTION ---
      // If the enemy has barely moved over the check interval while chasing,
      // it's pinned against geometry. Apply a random impulse to break free.
      let stuckTimer = (this.stuckTimers.get(enemy.id) ?? AI_CONFIG.STUCK_CHECK_INTERVAL) - dt;
      if (stuckTimer <= 0) {
          const last = this.lastPositions.get(enemy.id);
          if (last && (enemy.aiState === 'chase' || longRange)) {
              const sx = enemy.position.x - last.x;
              const sy = enemy.position.y - last.y;
              if (sx * sx + sy * sy < AI_CONFIG.STUCK_DIST_THRESHOLD * AI_CONFIG.STUCK_DIST_THRESHOLD) {
                  const nudgeAngle = Math.random() * Math.PI * 2;
                  enemy.velocity.x += Math.cos(nudgeAngle) * maxSpeed * 0.8;
                  enemy.velocity.y += Math.sin(nudgeAngle) * maxSpeed * 0.8;
              }
          }
          this.lastPositions.set(enemy.id, { x: enemy.position.x, y: enemy.position.y });
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
          const toTargetX = player.position.x - enemy.position.x;
          const toTargetY = player.position.y - enemy.position.y;
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
