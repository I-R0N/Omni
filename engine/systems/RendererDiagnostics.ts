/**
 * RENDERER DIAGNOSTICS — the churn surface, deliberately kept OUT of the seam.
 *
 * Debug flags written by `DebugControls`, perf counters read by
 * `GameEngine.buildPerfSnapshot()`, and the lighting/fog readouts the DBG
 * panel displays. `GameEngine.renderer` is typed `Renderer & RendererDiagnostics`,
 * so these are reachable exactly as before — but they live here rather than in
 * `Renderer.ts`.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 * It is a measurement, not a preference. When the seam was extracted it was
 * 28 members, **19 of them diagnostics**. While the WebGPU branch waited on
 * two unrelated PRs, the lighting and 5d-UI work added **15 more — 15 of 15
 * diagnostics**, while the draw path did not change at all.
 *
 * A single combined interface therefore made `Renderer.ts` a file that
 * lighting and HUD work had to keep editing, where forgetting to broke the
 * build. Splitting it means:
 *
 *   * `Renderer.ts` states what a renderer SWAP must provide, and is stable.
 *   * this file absorbs the churn, and is expected to grow.
 *
 * ── FOR A SECOND RENDERER ────────────────────────────────────────────────
 * None of this is part of the swap contract. A WebGPU or WebGL2 renderer
 * should implement `Renderer` properly and may stub everything here — return
 * 0 from the counters, ignore the flags. Several are meaningless off the
 * Canvas2D path anyway: there is no "tint cache miss" on a GPU renderer, and
 * `lastRenderMs` measures CPU-side call ISSUING rather than rasterization,
 * which is precisely the work a GPU renderer moves off the CPU.
 * See docs/GAUNTLET_WEBGPU_LOG.md.
 */
import type { TrailShape } from '../../types';

export interface RendererDiagnostics {
  // ── Debug flags (written by DebugControls) ───────────────────────────────
  setDebugMode(v: boolean): void;
  setTrailShape(s: TrailShape): void;
  tileOutlinesEnabled: boolean;
  shardLodEnabled: boolean;
  plasticAutomataEnabled: boolean;
  materialAutomataEnabled: boolean;
  chevronsOffscreenOnly: boolean;
  damageTriggeredBars: boolean;
  bossBarActive: boolean;
  stageDepth: number;
  playerLightToolHalfDeg: number | null;

  // ── Lighting / fog readouts (displayed by the DBG panel) ─────────────────
  getShadowSoftness(): string;
  getFlashlight(): string;
  getRefraction(): boolean;
  getEmissive(): boolean;
  getEmitShadows(): boolean;
  getEmitShadowTier(): { name: string; maxEmitters: number; maxOccluders: number };
  getFog(): string;
  resetFog(): void;

  // ── Perf counters (read by buildPerfSnapshot / the DBG panel) ────────────
  /** CPU-side call-issuing time for the last frame — NOT rasterization. */
  lastRenderMs: number;
  lastNebulaMs: number;
  lastNebulaVisible: number;
  lastNebulaFastCount: number;
  lastNebulaSlowCount: number;
  lastTileLightingMs: number;
  lastTileLightingCount: number;
  lastStampMs: number;
  lastStampCount: number;
  lastTintMs: number;
  lastTintMisses: number;
  lastLodShardCount: number;
  lastLightingMs: number;
  lastLightingLights: number;
  lastFogMs: number;
}
