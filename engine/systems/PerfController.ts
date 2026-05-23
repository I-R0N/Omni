import {
  PERF_CONTROLLER_CONSTANTS as PC,
  PERF_TASKS,
  MERGE_RATE_CONSTANTS as MR,
  PerfTaskId,
} from '../../constants';

/**
 * PerfController — one coordinator for every skippable periodic pass.
 *
 * Replaces the scattered per-system AUTO tables (shard-pair, shard-tile-
 * pair, color-blend, plastic-cosmetic) with a single load-driven model:
 *
 *   1. `beginStep()` is called once per fixed sim substep with the live
 *      load signals (total active entity count, peak collision-cell
 *      density, and the previous substep's sim time).  It folds them into
 *      a smoothed load level, quantises that into a tier (with
 *      hysteresis), advances the global tick, and precomputes — for every
 *      registered task — its effective frame-skip interval and whether it
 *      fires this step.
 *   2. Systems query `shouldRun(taskId)` / `effectiveInterval(taskId)`.
 *      Because everything is precomputed in `beginStep`, repeated queries
 *      within the same step are consistent and O(1) — important so the
 *      shard-pair separation pass and the merge/cohesion pass that must
 *      share its cadence never disagree.
 *
 * Phase offsets (assigned by registration order) stagger same-interval
 * tasks via `(globalTick + offset) % interval === 0`, so a heavy step
 * never recomputes every pass at once.
 *
 * SEPARATELY, the controller tracks an entity-count-driven merge/eat RATE
 * multiplier (>= 1): crowded fields make merging/eating run FASTER to cull
 * entities, which is orthogonal to (and opposite from) the throttle above.
 */

interface PerfTask {
  id: PerfTaskId;
  minInterval: number;
  maxInterval: number;
  costWeight: number;
  /** Deterministic phase offset = registration index. */
  offset: number;
  /** 0 = AUTO (controller-driven); >= 1 = manual pin (DBG override). */
  manualInterval: number;
  // ── precomputed per step ──
  effectiveInterval: number;
  runThisStep: boolean;
}

/** Compact per-task view for the DBG perf overlay.  Mutated in place each
 *  step (zero per-frame allocation); the UI reads it through a fresh map
 *  in GameEngine.buildPerfSnapshot. */
export interface PerfTaskDebug {
  id: string;
  eff: number;
  manual: number;
  run: boolean;
}

export class PerfController {
  /** Master AUTO toggle.  When false, AUTO tasks (manualInterval 0) run
   *  every step; manual pins still apply.  Cycled via the DBG panel. */
  public autoEnabled: boolean = PC.AUTO_DEFAULT;

  private tasks: PerfTask[] = [];
  private byId: Map<string, PerfTask> = new Map();
  /** Stable per-task debug view, parallel to `tasks`. */
  public readonly debug: PerfTaskDebug[] = [];

  private globalTick: number = 0;

  // ── load signals ──
  private simMsEwma: number = 0;
  /** Smoothed combined load in [0,1]. */
  public loadLevel: number = 0;
  /** Quantised tier 0..NUM_TIERS-1. */
  public loadTier: number = 0;
  public lastEntityCount: number = 0;
  public lastCellDensity: number = 0;

  // ── entity-count-driven merge/eat rate ──
  private mergeRateTier: number = 0; // 0 = baseline, 1 = quick, 2 = very quick
  /** Live multiplier (>= 1) applied to merge/eat time-accumulators. */
  public mergeRateMultiplier: number = MR.MULT_BASELINE;

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    let i = 0;
    (Object.keys(PERF_TASKS) as PerfTaskId[]).forEach((id) => {
      const cfg = PERF_TASKS[id];
      const task: PerfTask = {
        id,
        minInterval: cfg.minInterval,
        maxInterval: cfg.maxInterval,
        costWeight: cfg.costWeight,
        offset: i,
        manualInterval: 0,
        effectiveInterval: cfg.minInterval,
        runThisStep: true,
      };
      this.tasks.push(task);
      this.byId.set(id, task);
      this.debug.push({ id, eff: cfg.minInterval, manual: 0, run: true });
      i++;
    });
  }

  /** Hard reset on game restart / map load so a fresh run doesn't inherit
   *  a stale load EWMA or phase. */
  public reset(): void {
    this.globalTick = 0;
    this.simMsEwma = 0;
    this.loadLevel = 0;
    this.loadTier = 0;
    this.lastEntityCount = 0;
    this.lastCellDensity = 0;
    this.mergeRateTier = 0;
    this.mergeRateMultiplier = MR.MULT_BASELINE;
    for (let i = 0; i < this.tasks.length; i++) {
      const t = this.tasks[i];
      t.effectiveInterval = t.minInterval;
      t.runThisStep = true;
      this.debug[i].eff = t.minInterval;
      this.debug[i].run = true;
    }
  }

  /** Set / clear a DBG manual interval override (0 = AUTO).  Kept in sync
   *  from the systems that own the cycle buttons. */
  public setManual(id: PerfTaskId, interval: number): void {
    const t = this.byId.get(id);
    if (t) {
      t.manualInterval = interval | 0;
      const d = this.debug.find((x) => x.id === id);
      if (d) d.manual = t.manualInterval;
    }
  }

  /**
   * Sample load + precompute every task's run decision for this step.
   * Call exactly once per fixed sim substep, before any `shouldRun` query.
   *
   * @param entityCount total active entities (master list / EntityIndex)
   * @param cellDensity PhysicsSystem.lastMaxCellDensity from the prev step
   * @param simMs       prev substep's updatePhysics+updateGameLogic ms
   */
  public beginStep(entityCount: number, cellDensity: number, simMs: number): void {
    this.lastEntityCount = entityCount;
    this.lastCellDensity = cellDensity;

    // EWMA the (spiky) sim-time sample before normalising.
    this.simMsEwma += (simMs - this.simMsEwma) * PC.SIM_MS_EWMA_ALPHA;

    const nEnt = entityCount / PC.ENTITY_COUNT_REF;
    const nDen = cellDensity / PC.CELL_DENSITY_REF;
    const nSim = this.simMsEwma / PC.SIM_MS_REF;
    let inst = nEnt > nDen ? nEnt : nDen;
    if (nSim > inst) inst = nSim;
    if (inst > 1) inst = 1;
    else if (inst < 0) inst = 0;

    this.loadEwmaStep(inst);
    this.loadTier = this.resolveTier(this.loadLevel, this.loadTier);
    this.updateMergeRate(entityCount);

    this.globalTick++;

    for (let k = 0; k < this.tasks.length; k++) {
      const t = this.tasks[k];
      let eff: number;
      if (t.manualInterval >= 1) {
        eff = t.manualInterval;            // manual pin always wins
      } else if (!this.autoEnabled) {
        eff = 1;                           // AUTO disabled → run every step
      } else {
        eff = this.autoInterval(t);
      }
      if (eff < 1) eff = 1;
      t.effectiveInterval = eff;
      // Phase-offset gate: stagger equal-interval tasks so a heavy step
      // doesn't stack every pass on the same tick.
      t.runThisStep = ((this.globalTick + t.offset) % eff) === 0;

      const d = this.debug[k];
      d.eff = eff;
      d.run = t.runThisStep;
    }
  }

  private loadEwmaStep(inst: number): void {
    this.loadLevel += (inst - this.loadLevel) * PC.LOAD_EWMA_ALPHA;
  }

  /** AUTO effective interval from the current load tier, scaled by the
   *  task's cost weight and clamped to [min, max]. */
  private autoInterval(t: PerfTask): number {
    const tiers = PC.NUM_TIERS;
    const frac = tiers > 1 ? this.loadTier / (tiers - 1) : 0;
    let shaped = frac * t.costWeight;
    if (shaped > 1) shaped = 1;
    else if (shaped < 0) shaped = 0;
    return Math.round(t.minInterval + (t.maxInterval - t.minInterval) * shaped);
  }

  /** Quantise smoothed load into a tier with hysteresis (climb on
   *  TIER_THRESH_UP, drop only after falling a further TIER_HYSTERESIS). */
  private resolveTier(load: number, cur: number): number {
    const up = PC.TIER_THRESH_UP;
    const hy = PC.TIER_HYSTERESIS;
    let tier = cur;
    while (tier < up.length && load > up[tier]) tier++;
    while (tier > 0 && load < up[tier - 1] - hy) tier--;
    return tier;
  }

  private updateMergeRate(count: number): void {
    let tier = this.mergeRateTier;
    // Climb (sequential so a big jump can skip straight to very-quick).
    if (tier < 1 && count >= MR.THRESHOLD_QUICK) tier = 1;
    if (tier < 2 && count >= MR.THRESHOLD_VERY_QUICK) tier = 2;
    // Drop only past the hysteresis margin.
    if (tier === 2 && count < MR.THRESHOLD_VERY_QUICK - MR.HYSTERESIS) tier = 1;
    if (tier === 1 && count < MR.THRESHOLD_QUICK - MR.HYSTERESIS) tier = 0;
    this.mergeRateTier = tier;

    const target =
      tier === 2 ? MR.MULT_VERY_QUICK : tier === 1 ? MR.MULT_QUICK : MR.MULT_BASELINE;
    this.mergeRateMultiplier += (target - this.mergeRateMultiplier) * MR.EWMA_ALPHA;
  }

  // ── query API ──
  public shouldRun(id: PerfTaskId): boolean {
    const t = this.byId.get(id);
    return t ? t.runThisStep : true;
  }

  public effectiveInterval(id: PerfTaskId): number {
    const t = this.byId.get(id);
    return t ? t.effectiveInterval : 1;
  }

  public tierName(): string {
    return PC.TIER_NAMES[this.loadTier] ?? String(this.loadTier);
  }
}
