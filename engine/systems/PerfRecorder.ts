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
  private sumSim = 0;
  private sumCollisions = 0;
  private sumLoadTier = 0;
  private maxEntities = 0;
  private maxEnemies = 0;
  private maxParticles = 0;
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
    this.maxEntities = 0;
    this.maxEnemies = 0;
    this.maxParticles = 0;
    this.tierHist.fill(0);
    this.maxTier = 0;
    this.peakLoad = 0;
  }

  /**
   * Fold one frame into the capture.  Called from the engine loop ONLY while
   * recording (and only for real PLAYING frames, so idle/paused vsync doesn't
   * pollute the FPS distribution).  `frameMs` is the raw rAF delta; the section
   * costs are the current rolling-average PerfSnapshot values.
   */
  public sample(
    frameMs: number,
    renderMs: number,
    simMs: number,
    collisionsMs: number,
    loadTier: number,
    loadLevel: number,
    totalEntities: number,
    enemyCount: number,
    particleCount: number,
  ): void {
    if (!this.recording) return;
    if (this.count >= this.cap) { this.full = true; this.recording = false; return; }
    this.frameMs[this.count++] = frameMs;
    this.sumRender += renderMs;
    this.sumSim += simMs;
    this.sumCollisions += collisionsMs;
    this.sumLoadTier += loadTier;
    const ti = loadTier < 0 ? 0 : loadTier >= this.tierHist.length ? this.tierHist.length - 1 : loadTier | 0;
    this.tierHist[ti]++;
    if (loadTier > this.maxTier) this.maxTier = loadTier;
    if (loadLevel > this.peakLoad) this.peakLoad = loadLevel;
    if (totalEntities > this.maxEntities) this.maxEntities = totalEntities;
    if (enemyCount > this.maxEnemies) this.maxEnemies = enemyCount;
    if (particleCount > this.maxParticles) this.maxParticles = particleCount;
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
      `cost  render avg ${r2(this.sumRender / n)}ms · sim avg ${r2(this.sumSim / n)}ms · collisions avg ${r2(this.sumCollisions / n)}ms`,
      `perf  tier avg ${r2(avgTier)} (${tierParts.join(' / ')}) · load peak ${r2(this.peakLoad)}`,
      `peak  entities ${this.maxEntities} · enemies ${this.maxEnemies} · particles ${this.maxParticles}`,
    ];
    return lines.join('\n');
  }
}
