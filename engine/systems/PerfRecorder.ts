/**
 * PerfRecorder — an in-game FPS / perf capture harness (DBG tool).
 *
 * The engine already computes true frame time (the rAF delta) and a rich
 * per-frame PerfSnapshot (render ms, sim ms, collisions ms, PerfController
 * load tier, entity counts).  This recorder lets a player on ANY device —
 * including an iPhone with no devtools — capture that stream over a window,
 * then export a compact copy-paste text block for pasting back into a chat /
 * the optimization report.
 *
 * Design:
 *   - Zero cost while idle (the engine only calls `sample()` when recording).
 *   - One preallocated Float64Array holds the per-frame times (the only metric
 *     that needs a full distribution, for FPS percentiles).  Everything else
 *     (section costs, entity counts) is folded into running sums / maxima and a
 *     small tier histogram — O(1) per sample, no per-frame allocation.
 *   - Aggregation + string formatting happen only on `report()` (a user gesture:
 *     the Copy button), so the hot path stays clean.
 */

import { PerfSnapshot } from '../../types';

export interface PerfReportContext {
  viewportW: number;
  viewportH: number;
  dpr: number;
  zoom: number;
  mapName: string;
  difficulty: number;
  /** Short build/branch tag so a pasted block is self-identifying. */
  buildTag: string;
}

/** Cyclable scene labels so each capture is self-describing on the paste. */
export const PERF_SCENE_TAGS = [
  'baseline',
  'roamer-swarm',
  'dragon-stack',
  'dense-wave',
  'custom',
] as const;

export class PerfRecorder {
  public recording: boolean = false;
  public sceneTag: string = PERF_SCENE_TAGS[0];

  private readonly cap: number;
  private count: number = 0;
  private full: boolean = false; // hit capacity → auto-stopped

  // Per-frame frame time (ms) — the one metric kept in full for percentiles.
  private readonly frameMs: Float64Array;

  // Running aggregates for the section costs + counts (mean = sum / count).
  private sumRender = 0;
  private sumSim = 0;          // updatePhysicsMs + updateLogicMs
  private sumCollisions = 0;
  private sumLoadTier = 0;
  // Sim sub-timer breakdown (means) — so a heavy capture pinpoints WHERE the
  // sim time goes (physics broadphase vs shard merge vs gravity vs flow vs AI)
  // instead of only the aggregate.  All are PerfSnapshot rolling-averages.
  private sumUpdPhysics = 0;   // whole updatePhysics wall time
  private sumUpdLogic = 0;     // whole updateGameLogic wall time
  private sumPhysics = 0;      // PhysicsSystem.update (incl. collisions + gravity)
  private sumShardSys = 0;     // ShardSystem.update (merge broadphase + bonds)
  private sumGravity = 0;      // attractor gravity
  private sumLocalGravity = 0; // player↔asteroid local gravity
  private sumFlowField = 0;    // FlowFieldGrid rebuild/flush
  private sumAi = 0;           // AISystem.update
  private maxEntities = 0;
  private maxEnemies = 0;
  private maxParticles = 0;
  // Spike attribution: the RAW (unsmoothed) per-frame render + sim peaks, and
  // the render/sim of the single WORST frame (max frame time) — so a capture
  // says whether the tail hitches are render, sim, or an external gap (both
  // small but frame time large → GC / browser stall, not our compute).
  private maxRawRender = 0;
  private maxRawSim = 0;
  private worstFrameMs = 0;
  private worstFrameRender = 0;
  private worstFrameSim = 0;
  // ── Worst-frame table (gauntlet 5c P7) ────────────────────────────────
  //
  // Aggregates answer "is it smooth on average"; they cannot answer "why did
  // it hitch when I killed that enemy", which is the question a player
  // actually asks.  A spike tied to an EVENT is invisible in a 12-second p99
  // and obvious in a list of the worst individual frames.
  //
  // So keep the WORST_N frames by frame time, each with the split that
  // attributes it: render, sim, how many substeps the accumulator drained,
  // and the live entity/particle counts at that moment.  Reading it:
  //   frame ~= render + sim          -> our compute, and it says which half
  //   frame >> render + sim          -> GC pause or a browser/OS stall
  //   substeps high + sim high       -> substep bunching after a long frame
  //   particles/entities spiking     -> a spawn burst (death, wave, boss)
  // Insertion is a linear scan over a 6-slot array on a new maximum only —
  // free in the common case, which is what lets it live in the hot path.
  private static readonly WORST_N = 6;
  private readonly worstMs = new Float64Array(PerfRecorder.WORST_N);
  private readonly worstRender = new Float64Array(PerfRecorder.WORST_N);
  private readonly worstSim = new Float64Array(PerfRecorder.WORST_N);
  private readonly worstSteps = new Float64Array(PerfRecorder.WORST_N);
  private readonly worstEnts = new Float64Array(PerfRecorder.WORST_N);
  private readonly worstParts = new Float64Array(PerfRecorder.WORST_N);
  private readonly worstAtSec = new Float64Array(PerfRecorder.WORST_N);
  private readonly worstUi = new Float64Array(PerfRecorder.WORST_N);
  private sumUi = 0;
  private elapsedMs = 0;

  // Tier histogram (index = PerfController tier; small fixed span covers all).
  private readonly tierHist = new Int32Array(8);
  private maxTier = 0;
  private peakLoad = 0;

  constructor(capacitySamples: number = 18000 /* ~5 min @ 60fps */) {
    this.cap = capacitySamples;
    this.frameMs = new Float64Array(capacitySamples);
  }

  public get sampleCount(): number { return this.count; }
  public get isFull(): boolean { return this.full; }

  /** Begin a fresh capture (clears any prior window). */
  public start(): void {
    this.reset();
    this.recording = true;
  }

  /** End the current capture (keeps the buffer so it can still be exported). */
  public stop(): void {
    this.recording = false;
  }

  public toggle(): void {
    if (this.recording) this.stop(); else this.start();
  }

  public cycleScene(): void {
    const i = PERF_SCENE_TAGS.indexOf(this.sceneTag as typeof PERF_SCENE_TAGS[number]);
    this.sceneTag = PERF_SCENE_TAGS[(i + 1) % PERF_SCENE_TAGS.length];
  }

  private reset(): void {
    this.count = 0;
    this.full = false;
    this.sumRender = 0;
    this.sumSim = 0;
    this.sumCollisions = 0;
    this.sumLoadTier = 0;
    this.sumUpdPhysics = 0;
    this.sumUpdLogic = 0;
    this.sumPhysics = 0;
    this.sumShardSys = 0;
    this.sumGravity = 0;
    this.sumLocalGravity = 0;
    this.sumFlowField = 0;
    this.sumAi = 0;
    this.maxEntities = 0;
    this.maxEnemies = 0;
    this.maxParticles = 0;
    this.maxRawRender = 0;
    this.maxRawSim = 0;
    this.worstFrameMs = 0;
    this.worstFrameRender = 0;
    this.worstFrameSim = 0;
    this.tierHist.fill(0);
    this.maxTier = 0;
    this.peakLoad = 0;
    this.worstMs.fill(0);
    this.worstRender.fill(0);
    this.worstSim.fill(0);
    this.worstSteps.fill(0);
    this.worstEnts.fill(0);
    this.worstParts.fill(0);
    this.worstAtSec.fill(0);
    this.worstUi.fill(0);
    this.sumUi = 0;
    this.elapsedMs = 0;
  }

  /** Insert a frame into the worst-N table, keeping it sorted descending.
   *  Called only when the frame beats the current slowest entry. */
  private noteWorst(
    ms: number, render: number, sim: number, steps: number,
    ents: number, parts: number, atSec: number, ui: number,
  ): void {
    const N = PerfRecorder.WORST_N;
    let slot = N - 1;
    while (slot > 0 && this.worstMs[slot - 1] < ms) {
      this.worstMs[slot] = this.worstMs[slot - 1];
      this.worstRender[slot] = this.worstRender[slot - 1];
      this.worstSim[slot] = this.worstSim[slot - 1];
      this.worstSteps[slot] = this.worstSteps[slot - 1];
      this.worstEnts[slot] = this.worstEnts[slot - 1];
      this.worstParts[slot] = this.worstParts[slot - 1];
      this.worstAtSec[slot] = this.worstAtSec[slot - 1];
      this.worstUi[slot] = this.worstUi[slot - 1];
      slot--;
    }
    this.worstMs[slot] = ms;
    this.worstRender[slot] = render;
    this.worstSim[slot] = sim;
    this.worstSteps[slot] = steps;
    this.worstEnts[slot] = ents;
    this.worstParts[slot] = parts;
    this.worstAtSec[slot] = atSec;
    this.worstUi[slot] = ui;
  }

  /**
   * Fold one frame into the capture.  Called from the engine loop ONLY while
   * recording (and only for real PLAYING frames, so idle/paused vsync doesn't
   * pollute the FPS distribution).  `frameMs` is the raw rAF delta; the section
   * costs are the current rolling-average PerfSnapshot values.
   */
  public sample(
    frameMs: number,
    perf: PerfSnapshot,
    loadTier: number,
    loadLevel: number,
    rawRenderMs: number,
    rawSimMs: number,
    substeps: number = 0,
    uiMs: number = 0,
  ): void {
    if (!this.recording) return;
    if (this.count >= this.cap) { this.full = true; this.recording = false; return; }
    this.frameMs[this.count++] = frameMs;
    this.elapsedMs += frameMs;
    // Worst-frame table: only pay the insert when the frame actually beats
    // the slowest entry currently held.
    if (frameMs > this.worstMs[PerfRecorder.WORST_N - 1]) {
      this.noteWorst(
        frameMs, rawRenderMs, rawSimMs, substeps,
        perf.totalEntities, perf.particleCount, this.elapsedMs / 1000, uiMs,
      );
    }
    if (rawRenderMs > this.maxRawRender) this.maxRawRender = rawRenderMs;
    if (rawSimMs > this.maxRawSim) this.maxRawSim = rawSimMs;
    if (frameMs > this.worstFrameMs) {
      this.worstFrameMs = frameMs;
      this.worstFrameRender = rawRenderMs;
      this.worstFrameSim = rawSimMs;
    }
    this.sumUi += uiMs;
    this.sumRender += perf.renderMs;
    this.sumSim += perf.updatePhysicsMs + perf.updateLogicMs;
    this.sumCollisions += perf.collisionsMs;
    this.sumLoadTier += loadTier;
    this.sumUpdPhysics += perf.updatePhysicsMs;
    this.sumUpdLogic += perf.updateLogicMs;
    this.sumPhysics += perf.physicsMs;
    this.sumShardSys += perf.shardSysMs;
    this.sumGravity += perf.gravityMs;
    this.sumLocalGravity += perf.localGravityMs;
    this.sumFlowField += perf.flowFieldMs;
    this.sumAi += perf.aiMs;
    const ti = loadTier < 0 ? 0 : loadTier >= this.tierHist.length ? this.tierHist.length - 1 : loadTier | 0;
    this.tierHist[ti]++;
    if (loadTier > this.maxTier) this.maxTier = loadTier;
    if (loadLevel > this.peakLoad) this.peakLoad = loadLevel;
    if (perf.totalEntities > this.maxEntities) this.maxEntities = perf.totalEntities;
    if (perf.enemyCount > this.maxEnemies) this.maxEnemies = perf.enemyCount;
    if (perf.particleCount > this.maxParticles) this.maxParticles = perf.particleCount;
  }

  /**
   * Aggregate the window into a compact, copy-paste-friendly text block.
   * Returns a short "no samples" note if nothing was recorded.
   */
  public report(ctx: PerfReportContext, tierNames: string[]): string {
    const n = this.count;
    if (n === 0) return `### PERF ${ctx.buildTag} · ${this.sceneTag} — no samples (hit REC, play a few seconds, hit REC again)`;

    // Frame-time distribution → FPS metrics.  Copy + sort just the used slice.
    const fm = this.frameMs.slice(0, n);
    let sumFrame = 0, minFrame = Infinity, maxFrame = 0, ge55 = 0, ge30 = 0;
    const T55 = 1000 / 55, T30 = 1000 / 30;
    for (let i = 0; i < n; i++) {
      const v = fm[i];
      sumFrame += v;
      if (v < minFrame) minFrame = v;
      if (v > maxFrame) maxFrame = v;
      if (v <= T55) ge55++;
      if (v <= T30) ge30++;
    }
    fm.sort();
    const pct = (p: number) => fm[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))];
    const medianFrame = pct(0.5);
    const p95Frame = pct(0.95); // 5%-low FPS
    const p99Frame = pct(0.99); // 1%-low FPS
    const durSec = sumFrame / 1000;
    const avgFps = sumFrame > 0 ? (1000 * n) / sumFrame : 0;
    const toFps = (ms: number) => (ms > 0 ? 1000 / ms : 0);

    // Tier distribution line (only tiers that actually occurred).
    const tierParts: string[] = [];
    for (let t = 0; t < this.tierHist.length; t++) {
      if (this.tierHist[t] === 0) continue;
      const name = tierNames[t] ?? String(t);
      tierParts.push(`${name} ${Math.round((this.tierHist[t] / n) * 100)}%`);
    }
    const avgTier = this.sumLoadTier / n;

    const r1 = (x: number) => x.toFixed(1);
    const r2 = (x: number) => x.toFixed(2);
    const fpsR = (x: number) => Math.round(x);

    const lines = [
      `### PERF ${ctx.buildTag} · ${this.sceneTag} · ${ctx.mapName} · diff ${ctx.difficulty}`,
      `viewport ${ctx.viewportW}×${ctx.viewportH} dpr${ctx.dpr} zoom${r2(ctx.zoom)} · ${r1(durSec)}s · ${n} frames${this.full ? ' (capped)' : ''}`,
      `FPS   avg ${fpsR(avgFps)} · median ${fpsR(toFps(medianFrame))} · 5%-low ${fpsR(toFps(p95Frame))} · 1%-low ${fpsR(toFps(p99Frame))} · min ${fpsR(toFps(maxFrame))} · max ${fpsR(toFps(minFrame))} · ≥55: ${Math.round((ge55 / n) * 100)}% · ≥30: ${Math.round((ge30 / n) * 100)}%`,
      `frame avg ${r1(sumFrame / n)}ms · median ${r1(medianFrame)}ms · p95 ${r1(p95Frame)}ms · p99 ${r1(p99Frame)}ms`,
      `cost  render avg ${r2(this.sumRender / n)}ms · sim avg ${r2(this.sumSim / n)}ms · collisions avg ${r2(this.sumCollisions / n)}ms · ui avg ${r2(this.sumUi / n)}ms`,
      // Sim breakdown so a heavy capture shows WHERE the sim ms goes.  updPhys +
      // updLogic = sim; physics (incl. collisions/gravity) + AI + flow live in
      // updPhys, shardSys in updLogic.  gravity/localGrav are sub-slices of
      // physics, printed for detail.
      `sim   updPhys ${r2(this.sumUpdPhysics / n)} · updLogic ${r2(this.sumUpdLogic / n)} · physics ${r2(this.sumPhysics / n)} · shardSys ${r2(this.sumShardSys / n)} · ai ${r2(this.sumAi / n)} · flow ${r2(this.sumFlowField / n)} · grav ${r2(this.sumGravity / n)} · locGrav ${r2(this.sumLocalGravity / n)}`,
      // Spike attribution (raw per-frame): the worst frame's render/sim split
      // + the independent raw peaks.  worst frame ≈ render+sim → our compute;
      // worst frame ≫ render+sim → an external gap (GC / browser stall).
      `spike worst frame ${r1(this.worstFrameMs)}ms → render ${r2(this.worstFrameRender)} · sim ${r2(this.worstFrameSim)} · peak render ${r2(this.maxRawRender)} · peak sim ${r2(this.maxRawSim)}`,
      `perf  tier avg ${r2(avgTier)} (${tierParts.join(' / ')}) · load peak ${r2(this.peakLoad)}`,
      `peak  entities ${this.maxEntities} · enemies ${this.maxEnemies} · particles ${this.maxParticles}`,
    ];

    // Worst individual frames.  This is the section that answers "why did it
    // hitch when I killed that thing" — an event-tied spike is invisible in
    // the aggregates above and plain here.  `at` is seconds into the capture,
    // so a spike can be matched against what was happening on screen.
    if (this.worstMs[0] > 0) {
      lines.push(`worst  #  frame   render     sim      ui   other  steps   ents  parts    at`);
      for (let i = 0; i < PerfRecorder.WORST_N; i++) {
        if (this.worstMs[i] <= 0) break;
        lines.push(
          `      ${i + 1}  ${r1(this.worstMs[i]).padStart(5)}  ` +
          `${r2(this.worstRender[i]).padStart(6)}  ${r2(this.worstSim[i]).padStart(6)}  ` +
          `${r2(this.worstUi[i]).padStart(6)}  ` +
          `${r1(Math.max(0, this.worstMs[i] - this.worstRender[i] - this.worstSim[i] - this.worstUi[i])).padStart(6)}  ` +
          `${String(this.worstSteps[i]).padStart(5)}  ${String(this.worstEnts[i]).padStart(5)}  ` +
          `${String(this.worstParts[i]).padStart(5)}  ${r1(this.worstAtSec[i]).padStart(5)}s`,
        );
      }
      lines.push(
        `      (ui = the React hand-off · OTHER = frame − render − sim − ui:` +
        ` GC pause, compositing or an OS stall, i.e. NOT our JS)`,
      );
    }
    return lines.join('\n');
  }
}
