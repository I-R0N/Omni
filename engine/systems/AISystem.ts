

import { GameEntity, EntityType, EnemySubtype, EnemyRole, Vector2 } from '../../types';
import { ENEMY_VARIANTS, ENEMY_ROLE, AI_CONFIG } from '../../constants';
import { FlowFieldGrid } from './FlowFieldGrid';

export class AISystem {
  // Store persistent aim targets to simulate reaction time.
  // Instead of tracking the player perfectly every frame, enemies aim at where the player *was*
  // a fraction of a second ago.
  private laggedTargets: Map<string, Vector2> = new Map();
  private reactionTimers: Map<string, number> = new Map();

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

      // Route by role — add new roles here as needed
      const role = enemy.enemySubtype ? ENEMY_ROLE[enemy.enemySubtype] : EnemyRole.RAMMING;
      if (role === EnemyRole.SHOOTING) {
          this.updateSkirmisher(dt, enemy, player);
      } else {
          this.updateBasicDogfighter(dt, enemy, player, flowField);
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
      const maxSpeed = enemy.maxSpeed ?? config.maxSpeed ?? 12;
      const accel = config.accel || 8;
      const turnRate = config.turnRate || 1.5;

      const dx = player.position.x - enemy.position.x;
      const dy = player.position.y - enemy.position.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      
      const { PREFERRED_DIST, DEADZONE, STRAFE_MODIFIER } = AI_CONFIG.SKIRMISHER;

      // Reaction lag affects aim direction only; movement logic remains responsive for gameplay feel
      let targetAngle = Math.atan2(dy, dx);
      
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
      const maxSpeed = enemy.maxSpeed ?? config.maxSpeed ?? 10;
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
              enemy.aiTimer = timers.IDLE_TIME_BASE + Math.random() * timers.IDLE_TIME_VAR;
          } else {
              enemy.aiState = 'chase';
              enemy.aiTimer = timers.CHASE_TIME_BASE + Math.random() * timers.CHASE_TIME_VAR;
          }
      }

      // --- MOVEMENT BEHAVIOR ---
      if (enemy.aiState === 'chase') {
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
                  // Outside the pursuit field range — fall back to direct chase.
                  moveX = dx / d;
                  moveY = dy / d;
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
