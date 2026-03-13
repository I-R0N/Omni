

import { GameEntity, EntityType, EnemySubtype, Vector2 } from '../../types';
import { ENEMY_VARIANTS, AI_CONFIG } from '../../constants';

export class AISystem {
  // Store persistent aim targets to simulate reaction time.
  // Instead of tracking the player perfectly every frame, enemies aim at where the player *was*
  // a fraction of a second ago.
  private laggedTargets: Map<string, Vector2> = new Map();
  private reactionTimers: Map<string, number> = new Map();

  public update(dt: number, entities: GameEntity[], player: GameEntity) {
    // PERF: avoid .filter() allocation — iterate in place
    for (let i = 0; i < entities.length; i++) {
      const enemy = entities[i];
      if (!enemy.active || enemy.type !== EntityType.ENEMY) continue;

      if (!enemy.aiState) {
          enemy.aiState = 'chase';
          enemy.aiTimer = 0;
      }

      if (!this.reactionTimers.has(enemy.id)) {
          this.reactionTimers.set(enemy.id, 0);
          this.laggedTargets.set(enemy.id, { ...player.position });
      }

      switch (enemy.enemySubtype) {
          case EnemySubtype.SKIRMISHER:
              this.updateSkirmisher(dt, enemy, player);
              break;
          case EnemySubtype.BASIC:
          case EnemySubtype.FAST_CHARGER:
          case EnemySubtype.TANK:
          default:
              this.updateBasicDogfighter(dt, enemy, player);
              break;
      }
    }

    // PERF: GC cleanup — build liveIds from same loop, no extra .map() allocation
    if (Math.random() < 0.05) {
        const liveIds = new Set<string>();
        for (let i = 0; i < entities.length; i++) {
            if (entities[i].active && entities[i].type === EntityType.ENEMY) {
                liveIds.add(entities[i].id);
            }
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
      const config = ENEMY_VARIANTS[EnemySubtype.SKIRMISHER];
      const maxSpeed = config.maxSpeed || 12;
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
  private updateBasicDogfighter(dt: number, enemy: GameEntity, player: GameEntity) {
      // Use config based on subtype (Basic, Charger, Tank have different stats)
      const config = ENEMY_VARIANTS[enemy.enemySubtype || EnemySubtype.BASIC];
      const maxSpeed = config.maxSpeed || 10;
      const accel = config.accel || 6;
      const turnRate = config.turnRate || 1.25;

      // --- TARGETING LOGIC (Delayed Aim) ---
      let reaction = this.reactionTimers.get(enemy.id) || 0;
      reaction -= dt;

      if (reaction <= 0) {
          // Update the "lagged" target to the player's current position
          this.laggedTargets.set(enemy.id, { ...player.position });
          // Reset timer with random variance
          reaction = AI_CONFIG.REACTION_TIME_BASE + Math.random() * AI_CONFIG.REACTION_TIME_VAR;
      }
      this.reactionTimers.set(enemy.id, reaction);

      const targetPos = this.laggedTargets.get(enemy.id) || player.position;

      // --- STATE MACHINE ---
      if (enemy.aiTimer && enemy.aiTimer > 0) {
          enemy.aiTimer -= dt;
      } else {
          // Flip State between Chase and Idle
          if (enemy.aiState === 'chase') {
              enemy.aiState = 'idle'; // Coast/Turn
              enemy.aiTimer = AI_CONFIG.IDLE_TIME_BASE + Math.random() * AI_CONFIG.IDLE_TIME_VAR; 
          } else {
              enemy.aiState = 'chase'; // Charge
              enemy.aiTimer = AI_CONFIG.CHASE_TIME_BASE + Math.random() * AI_CONFIG.CHASE_TIME_VAR; 
          }
      }

      // --- MOVEMENT BEHAVIOR ---
      if (enemy.aiState === 'chase') {
          // ENGAGE: Fly towards the LAGGED target
          const dx = targetPos.x - enemy.position.x;
          const dy = targetPos.y - enemy.position.y;
          const d = Math.sqrt(dx*dx + dy*dy);

          if (d > 0) {
              const ndx = dx / d;
              const ndy = dy / d;
              enemy.velocity.x += ndx * accel * dt;
              enemy.velocity.y += ndy * accel * dt;
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

      if (speed > AI_CONFIG.ROTATION_THRESHOLD) {
        targetAngle = Math.atan2(enemy.velocity.y, enemy.velocity.x);
      } else {
        // If stopped/slow, turn towards the ACTUAL player position (not lagged) for situational awareness
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
