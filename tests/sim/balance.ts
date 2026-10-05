/**
 * THE BALANCE HARNESS — a bot plays the REAL engine headlessly and reports what
 * the numbers do (engine-core S3, D-S3-e: "measure what the game does today").
 *
 * Four instruments, all driven through the same fixed-step `stepSim` the
 * replay harness uses, so a number here is a number the game produces:
 *
 *   playArena   a bot clears an arena's wave ladder: wave clear times, run
 *               length, salvage per wave, hull lost, and — instrumented at the
 *               death and projectile-hit seams — how much of the pressure and
 *               the theft is the RIVALS' (D-S3-d wants them in the difficulty).
 *   duel        a pinned target, a stationary shooter: seconds and shots to
 *               kill one enemy with one weapon, base and behind 3 Gunnery Mk III.
 *   hubTransit  how long the bot takes to fly from the hub spawn to a rift.
 *   staticTables  prices, income constants, difficulty and wave tables, read
 *               off the live constants rather than retyped.
 *
 * THE BOT IS A YARDSTICK, NOT A PLAYER.  It aims perfectly at the nearest
 * hostile, kites at a fixed range, never dodges and never charges a shot.  A
 * human is better at dodging and worse at aiming; the point is that the same
 * bot plays every configuration, so differences between configurations mean
 * something even where the absolute numbers do not.
 *
 * Imports no test runner (the parity kit's rule), so scripts/balance.mjs can
 * bundle it.  It writes nothing to the engine bar the loadout it is asked to
 * wear and the two seam wrappers below (which only count).
 */
import { EntityType, MapType } from '../../types';
import { wrapDeltaX, wrapDeltaY } from '../../engine/toroidal';
import { endReplay } from '../../engine/replay';
import { syncLoadoutFromSlots } from '../../engine/outfitting';
import {
  MODULE_DEFS, SALVAGE_CONSTANTS, DROP_CONFIG, SCORE_CONSTANTS, ENEMY_VARIANTS, ENEMY_SCALING,
  DIFFICULTY_SCALES, DIFFICULTY_STAT_SCALES, RIVAL_CONSTANTS, WEAPONS, HUB_PORTAL_SITES,
  PORTAL_CONSTANTS, enemyHpMult, enemyDamageMult, getWaveDurationSec, getWaveSpawnBudget,
  STAGE_WAVE_COUNT, BOSS_DEFS, BOSS_ROTATION, TIMED_WAVE_CONFIG,
} from '../../constants';
import { createHeadlessEngine } from './harness';

export type Loadout = 'lean' | 'mk3';
type AnyEngine = any;
const STEP_HZ = 120;
const W = 390, H = 844;

// ── shared helpers ───────────────────────────────────────────────────────────

function nearest(g: AnyEngine, pred: (e: any) => boolean): { e: any; dx: number; dy: number; d: number } | null {
  const p = g.player.position;
  let best: any = null, bd = Infinity, bdx = 0, bdy = 0;
  for (const e of g.currentMap.entities) {
    if (!e.active || !pred(e)) continue;
    const dx = wrapDeltaX(p.x, e.position.x), dy = wrapDeltaY(p.y, e.position.y);
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = e; bdx = dx; bdy = dy; }
  }
  return best ? { e: best, dx: bdx, dy: bdy, d: Math.sqrt(bd) } : null;
}

const isWaveEnemy = (e: any) =>
  e.type === EntityType.ENEMY && !e.thirdParty && !e.ambient && !e.isRival && !e.isSnitch
  && e.maxHealth !== undefined && e.countsTowardWave !== false;

function wear(g: AnyEngine, loadout: Loadout) {
  if (loadout === 'mk3') g.debugOutfitAll();
}

// ── 1. the arena bot ─────────────────────────────────────────────────────────

export interface WaveRow {
  wave: number;              // 1-based, as the HUD counts it
  startSec: number;          // sim seconds since the run began
  clearSec: number | null;   // null = the run ended inside this wave
  durationSec: number | null;
  spawned: number;           // distinct counted enemies seen during the wave
  salvageUnits: number;      // salvage units collected during the wave
  hullLost: number;
  rivalsAlive: number;       // most rivals alive at once during the wave
  rivalSec: number;          // rival-seconds (alive time summed over rivals)
}

export interface RunReport {
  map: string; seed: number; loadout: Loadout; rivals: boolean; difficulty: number;
  endedBy: 'boss-dead' | 'death' | 'timeout';
  endSec: number;
  endWave: number;           // wave in progress when the run ended (1-based)
  wavesCleared: number;
  waves: WaveRow[];
  kills: number;             // enemies the PLAYER was paid for
  salvageUnits: number;
  hullLost: number;
  hitsFromEnemies: number;   // projectile hits on the player, by owner class
  hitsFromRivals: number;
  hitDamageFromEnemies: number;
  hitDamageFromRivals: number;
  rivalsSeen: number;
  rivalDispositions: Record<string, number>;
  killsStolenByRivals: number;
  firstRivalSec: number | null;
}

export interface PlayOpts {
  map: MapType | string; seed: number; loadout: Loadout;
  /** false = no rival ever warps in (the control for D-S3-d's rival question). */
  rivals?: boolean;
  /** DIFFICULTY_SCALES / DIFFICULTY_STAT_SCALES index; default 3, today's highest. */
  difficulty?: number;
  maxSec?: number;
}

export function playArena(o: PlayOpts): RunReport {
  const { engine } = createHeadlessEngine({}, o.difficulty ?? 3);
  const g = engine as AnyEngine;
  g.activatePlatform();
  g.beginSeededRun(o.seed, o.map as MapType);
  wear(g, o.loadout);
  const withRivals = o.rivals !== false;
  if (!withRivals) g.nextRivalScore = Infinity;
  const input = g.input;
  const zoom = g.camera.zoom;
  const maxSteps = Math.floor((o.maxSec ?? 900) * STEP_HZ);
  const creditsPerUnit = SALVAGE_CONSTANTS.CREDITS_PER_DROP;

  const r: RunReport = {
    map: String(o.map), seed: o.seed, loadout: o.loadout, rivals: withRivals, difficulty: o.difficulty ?? 3,
    endedBy: 'timeout', endSec: 0, endWave: 0, wavesCleared: 0, waves: [], kills: 0, salvageUnits: 0,
    hullLost: 0, hitsFromEnemies: 0, hitsFromRivals: 0, hitDamageFromEnemies: 0, hitDamageFromRivals: 0,
    rivalsSeen: 0, rivalDispositions: {}, killsStolenByRivals: 0, firstRivalSec: null,
  };

  // The two counting seams.  Both are arrow properties the engine hands to the
  // physics step by reference on EVERY step, so replacing them takes effect at
  // once.  They observe and forward; nothing about the sim changes.
  const rivalShipIds = new Set<string>();
  const origDeath = g.handleEntityDeath;
  g.handleEntityDeath = (e: any, opts?: any) => {
    if (e.type === EntityType.ENEMY && !e.isExploding && e.killedByRival && !e.isRival) r.killsStolenByRivals++;
    return origDeath(e, opts);
  };
  const origHit = g.handleProjectileHit;
  g.handleProjectileHit = (pos: any, proj: any, target: any) => {
    if (target.type === EntityType.PLAYER && proj.ownerType === EntityType.ENEMY) {
      if (rivalShipIds.has(String(proj.ownerId))) { r.hitsFromRivals++; r.hitDamageFromRivals += proj.damage ?? 0; }
      else { r.hitsFromEnemies++; r.hitDamageFromEnemies += proj.damage ?? 0; }
    }
    return origHit(pos, proj, target);
  };

  let row: WaveRow | null = null;
  let lastWave = -1, lastHealth = g.player.health, unitsAtWaveStart = 0;
  const seenEnemy = new Set<string>();
  const seenRival = new Set<string>();
  let keys: string[] = [];
  let aim: [number, number] = [W / 2 + 200, H / 2];

  for (let step = 0; step < maxSteps; step++) {
    const t = step / STEP_HZ;
    const wi = g.waves.waveIndex;
    if (g.waves.waveState === 'active' && wi !== lastWave) {
      row = { wave: wi + 1, startSec: t, clearSec: null, durationSec: null, spawned: 0, salvageUnits: 0,
              hullLost: 0, rivalsAlive: 0, rivalSec: 0 };
      r.waves.push(row);
      lastWave = wi;
      seenEnemy.clear();
      unitsAtWaveStart = g.runCreditsEarned / creditsPerUnit;
    }
    if (g.player.health < lastHealth) {
      const lost = lastHealth - g.player.health;
      r.hullLost += lost;
      if (row) row.hullLost += lost;
    }
    lastHealth = g.player.health;

    if (step % 12 === 0) {
      let nr = 0;
      for (const rv of g.rivals ?? []) {
        const id = String(rv.ship.id);
        rivalShipIds.add(id);
        if (!seenRival.has(id)) {
          seenRival.add(id);
          r.rivalDispositions[rv.disposition] = (r.rivalDispositions[rv.disposition] ?? 0) + 1;
          if (r.firstRivalSec === null) r.firstRivalSec = t;
        }
        nr++;
      }
      if (row) {
        row.rivalsAlive = Math.max(row.rivalsAlive, nr);
        row.rivalSec += nr * (12 / STEP_HZ);
        for (const e of g.currentMap.entities) {
          if (e.active && isWaveEnemy(e) && !seenEnemy.has(e.id)) { seenEnemy.add(e.id); row.spawned++; }
        }
      }
    }

    if (g.player.isExploding || g.deathPending) { r.endedBy = 'death'; r.endSec = t; break; }
    if (g.stageClearPending) { r.endedBy = 'boss-dead'; r.endSec = t; break; }

    // ── the bot: nearest hostile, kite at a fixed range, shoot on cooldown
    if (step % 6 === 0) {
      const tgt = nearest(g, (e) => isWaveEnemy(e) || (e.isRival && e.huntingPlayer));
      const k: string[] = [];
      if (tgt) {
        const want = 280;
        const ux = tgt.dx / (tgt.d || 1), uy = tgt.dy / (tgt.d || 1);
        let mx: number, my: number;
        if (tgt.d > want + 80) { mx = ux; my = uy; }
        else if (tgt.d < want - 80) { mx = -ux; my = -uy; }
        else { mx = -uy * 0.8; my = ux * 0.8; }
        if (mx > 0.3) k.push('KeyD'); else if (mx < -0.3) k.push('KeyA');
        if (my > 0.3) k.push('KeyS'); else if (my < -0.3) k.push('KeyW');
        aim = [W / 2 + tgt.dx * zoom, H / 2 + tgt.dy * zoom];
      } else {
        const drop = nearest(g, (e) => e.dropType === 'salvage' || e.dropType === 'health');
        if (drop && drop.d < 900) {
          if (drop.dx > 30) k.push('KeyD'); else if (drop.dx < -30) k.push('KeyA');
          if (drop.dy > 30) k.push('KeyS'); else if (drop.dy < -30) k.push('KeyW');
        }
      }
      keys = k;
    }
    const fire: Array<[number, number]> = [];
    if ((g.player.weaponCooldown ?? 0) <= 0 && g.currentMap && nearest(g, (e) => isWaveEnemy(e) || (e.isRival && e.huntingPlayer))) fire.push(aim);
    input.applyReplayFrame(keys, aim[0], aim[1], fire, []);
    g.stepSim(1);

    if (g.runWavesCleared !== r.wavesCleared) {
      r.wavesCleared = g.runWavesCleared;
      if (row && row.clearSec === null) {
        row.clearSec = (step + 1) / STEP_HZ;
        row.durationSec = row.clearSec - row.startSec;
        row.salvageUnits = g.runCreditsEarned / creditsPerUnit - unitsAtWaveStart;
      }
    }
    r.endSec = (step + 1) / STEP_HZ;
  }
  r.endWave = row ? row.wave : 0;
  if (row && row.clearSec === null) row.salvageUnits = g.runCreditsEarned / creditsPerUnit - unitsAtWaveStart;
  r.kills = g.runKills ?? 0;
  r.salvageUnits = (g.runCreditsEarned ?? 0) / creditsPerUnit;
  r.rivalsSeen = seenRival.size;
  g.handleEntityDeath = origDeath;
  g.handleProjectileHit = origHit;
  endReplay(g);
  return r;
}

// ── 2. the duel ──────────────────────────────────────────────────────────────

export interface DuelReport {
  weapon: string; subtype: string; gunned: boolean;
  killed: boolean; seconds: number; shots: number; targetHp: number;
  /** damage the target lost per shot fired, averaged over the kill */
  hpPerShot: number;
}

/**
 * One weapon against one enemy: the enemy is pinned 250 units off the bow, the
 * shooter is stationary and immortal, and the weapon fires on its cooldown.
 * `gunned` mounts 3 Gunnery Mk III beside the gun (the progression anchor the
 * base bank is defined against, CLAUDE.md §5).  Beams are pulled, not held.
 */
export function duel(weapon: string, subtype: string, gunned: boolean, wave = 0): DuelReport {
  const { engine } = createHeadlessEngine();
  const g = engine as AnyEngine;
  g.activatePlatform();
  g.beginSeededRun(1234, 'POCKET' as MapType);
  g.waves.haltForBoss();                    // no wave stream: only the target exists
  g.nextRivalScore = Infinity;
  const [delivery, energy] = weapon.split('+');
  const gun = MODULE_DEFS.find((m) => m.weapon === delivery)!;
  const mod = energy ? MODULE_DEFS.find((m) => m.effect?.energy === energy) : undefined;
  g.shipSlots.fill(null); g.weaponSlots.fill(null);
  g.shipSlots[0] = 'hull_base';
  g.weaponSlotsUnlocked = 7;
  g.weaponSlots[0] = gun.id;
  if (mod) g.weaponSlots[1] = mod.id;
  if (gunned) { g.weaponSlots[2] = 'gunnery_mk3'; g.weaponSlots[3] = 'gunnery_mk3'; g.weaponSlots[4] = 'gunnery_mk3'; }
  syncLoadoutFromSlots(g);
  g.player.currentWeapon = weapon;
  g.player.maxHealth = g.player.health = 1e9;
  for (const e of g.currentMap.entities) if (e.type === EntityType.ENEMY) e.active = false;
  g.prepareFrameEntities();

  const ctx = g.waveContext();
  const px = g.player.position.x, py = g.player.position.y;
  const target = g.waves.spawnAt(subtype, { x: px + 250, y: py }, ctx, false);
  g.prepareFrameEntities();
  const hp0 = target.health;
  let shots = 0, steps = 0;
  const maxSteps = 30 * STEP_HZ;
  const origFire = g.weapons.firePlayerWeapon.bind(g.weapons);
  g.weapons.firePlayerWeapon = (...a: any[]) => { const ok = origFire(...a); if (ok) shots++; return ok; };
  for (; steps < maxSteps && target.active && !target.isExploding && target.health > 0; steps++) {
    target.velocity.x = 0; target.velocity.y = 0;
    g.player.health = g.player.maxHealth;
    const sx = W / 2 + (wrapDeltaX(g.player.position.x, target.position.x)) * g.camera.zoom;
    const sy = H / 2 + (wrapDeltaY(g.player.position.y, target.position.y)) * g.camera.zoom;
    const fire: Array<[number, number]> = (g.player.weaponCooldown ?? 0) <= 0 ? [[sx, sy]] : [];
    g.input.applyReplayFrame([], sx, sy, fire, []);
    g.stepSim(1);
  }
  const killed = !target.active || target.isExploding || target.health <= 0;
  endReplay(g);
  return {
    weapon, subtype, gunned, killed, seconds: steps / STEP_HZ, shots, targetHp: hp0,
    hpPerShot: shots > 0 ? hp0 / shots : 0,
  };
}

// ── 3. the hub transit ───────────────────────────────────────────────────────

export interface TransitReport { portal: string; reached: boolean; seconds: number; straightLine: number }

/** Fly the bot from the hub spawn toward a portal by the shortest wrapped line. */
export function hubTransit(portalId: string, seed = 1): TransitReport {
  const { engine } = createHeadlessEngine();
  const g = engine as AnyEngine;
  g.activatePlatform();
  g.beginSeededRun(seed, MapType.OVERWORLD);
  g.nextRivalScore = Infinity;
  const portal = g.currentMap.entities.find((e: any) => e.isPortal && e.portalTargetId === portalId);
  if (!portal) { endReplay(g); return { portal: portalId, reached: false, seconds: 0, straightLine: 0 }; }
  const range = PORTAL_CONSTANTS.USE_RANGE;
  const start = { ...g.player.position };
  const line = Math.hypot(wrapDeltaX(start.x, portal.position.x), wrapDeltaY(start.y, portal.position.y));
  let steps = 0, reached = false;
  for (; steps < 180 * STEP_HZ; steps++) {
    const dx = wrapDeltaX(g.player.position.x, portal.position.x), dy = wrapDeltaY(g.player.position.y, portal.position.y);
    if (Math.hypot(dx, dy) < range) { reached = true; break; }
    const k: string[] = [];
    if (dx > 40) k.push('KeyD'); else if (dx < -40) k.push('KeyA');
    if (dy > 40) k.push('KeyS'); else if (dy < -40) k.push('KeyW');
    g.input.applyReplayFrame(k, W / 2 + dx, H / 2 + dy, [], []);
    g.stepSim(1);
  }
  endReplay(g);
  return { portal: portalId, reached, seconds: steps / STEP_HZ, straightLine: line };
}

// ── 4. the static tables ─────────────────────────────────────────────────────

export function staticTables() {
  const waves = [];
  for (let i = 0; i < STAGE_WAVE_COUNT; i++) {
    waves.push({
      wave: i + 1, windowSec: getWaveDurationSec(i), budget: getWaveSpawnBudget(i),
      hpMult: enemyHpMult(i), dmgMult: enemyDamageMult(i),
    });
  }
  const modules = MODULE_DEFS.filter((m) => m.cost > 0).map((m) => ({
    id: m.id, label: m.label, family: m.family, mark: m.mark, cost: m.cost, units: m.cost / SALVAGE_CONSTANTS.CREDITS_PER_DROP,
  }));
  const enemies = Object.entries(ENEMY_VARIANTS).map(([k, v]: [string, any]) => ({
    subtype: k, health: v.health, tier: v.tier ?? v.enemyTier, ambient: !!v.ambient,
  }));
  return {
    creditsPerUnit: SALVAGE_CONSTANTS.CREDITS_PER_DROP,
    waveClearDrops: SALVAGE_CONSTANTS.WAVE_CLEAR_DROPS,
    snitchCatchDrops: SALVAGE_CONSTANTS.SNITCH_CATCH_DROPS,
    dropChances: {
      enemyPrimary: DROP_CONFIG.SALVAGE_DROP_CHANCE_ENEMY_PRIMARY,
      enemySecondary: DROP_CONFIG.SALVAGE_DROP_CHANCE_ENEMY_SECONDARY,
    },
    pointsPerTier: SCORE_CONSTANTS.POINTS_PER_TIER,
    rivalCadencePoints: RIVAL_CONSTANTS.SCORE_INTERVAL,
    rivalMax: RIVAL_CONSTANTS.MAX_RIVALS,
    rivalWeights: RIVAL_CONSTANTS.WEIGHTS,
    waves, modules, enemies,
    enemyScaling: ENEMY_SCALING,
    difficulty: { spawn: DIFFICULTY_SCALES, stats: DIFFICULTY_STAT_SCALES },
    timedWave: { window: TIMED_WAVE_CONFIG },
    bossRotation: BOSS_ROTATION,
    bosses: Object.keys(BOSS_DEFS),
    weaponKeys: Object.keys(WEAPONS),
    hubPortals: HUB_PORTAL_SITES.map((s: any) => s.targetId ?? s.target ?? s.id),
  };
}
