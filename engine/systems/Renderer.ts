/**
 * THE RENDERER SEAM — what a renderer SWAP must provide, and nothing else.
 *
 * Extracted during the WebGPU feasibility spike (docs/GAUNTLET_WEBGPU_LOG.md)
 * so the engine's draw path depends on a CONTRACT rather than on the concrete
 * `RenderSystem` class. That is the prerequisite for any renderer swap —
 * WebGPU, WebGL2, a headless stub for tests, or none at all.
 *
 * This file contains **no behaviour**. It is the coupling that already exists,
 * written down. `RenderSystem` implements it unchanged.
 *
 * ── TEN MEMBERS, AND WHY IT IS EXACTLY THESE ─────────────────────────────
 *   1. LIFECYCLE + FRAME (7) — `setContext`, the per-map builders, `render`,
 *      and `worldToScreen`. The genuine renderer API.
 *   2. WIRING (3) — `setPhysics` / `setFlowField` / `setShards`, which hand
 *      the renderer live references to three SIM systems it draws FROM. A
 *      real coupling from the renderer back into the simulation; a second
 *      implementation must accept all three even if it ignores them. Note
 *      these are not debug-only: the material-tile branch reads the static
 *      grid through `setPhysics` to suppress interior edge strokes, and the
 *      bonded-pair blend pass reads the live bond list through `setShards`.
 *
 * ── WHAT IS DELIBERATELY *NOT* HERE ──────────────────────────────────────
 * Debug flags and perf counters live in `RendererDiagnostics.ts`, and the
 * split is a measurement rather than a preference. At extraction this seam
 * was 28 members, **19 of them diagnostics**. While the WebGPU branch waited
 * on two unrelated PRs, lighting and 5d-UI work added **15 more, 15 of 15
 * diagnostics** — and the nine members below did not change at all.
 *
 * Combined, this file was something lighting and HUD work had to keep
 * editing, where forgetting to broke the build. Split, it states the swap
 * contract and stays still. `GameEngine.renderer` is typed
 * `Renderer & RendererDiagnostics`, so nothing about access changes; only
 * which file grows.
 *
 * **If you are adding a debug flag or a perf counter, it does not belong in
 * this file.**
 */
import type {
  GameEntity, Vector2, MapType, CameraState, DamageText, PlayerHUDMessage,
  WaveAnnouncement, JoystickHUDState, FireButtonHUDState,
} from '../../types';
import type { FlowOverlayState } from './RenderSystem';
import type { ShardSystem } from './ShardSystem';
import type { PhysicsSystem } from './PhysicsSystem';
import type { FlowFieldGrid } from './FlowFieldGrid';

export interface Renderer {
  // ── 1. Lifecycle + frame ────────────────────────────────────────────────
  /** Hand the renderer its drawing context. Called once from `initCanvas`. */
  setContext(ctx: CanvasRenderingContext2D): void;

  /** Per-map setup, all called from `GameEngine.loadMap`. */
  setMapType(type: MapType): void;
  setNebulaClusterCenters(centers: Vector2[] | null): void;
  buildStaticTileLayer(entities: GameEntity[], mapWidth: number, mapHeight: number): void;
  buildMinimapStaticLayer(entities: GameEntity[], mapWidth: number, mapHeight: number): void;

  /** The frame. Called once per rAF from `GameEngine.draw()`. */
  render(
    entities: GameEntity[],
    camera: CameraState,
    mapType: MapType,
    minimapExpanded?: boolean,
    damageTexts?: DamageText[],
    playerPos?: Vector2,
    playerMessages?: PlayerHUDMessage[],
    player?: GameEntity,
    waveAnnouncements?: WaveAnnouncement[],
    flowOverlay?: FlowOverlayState,
    joystick?: JoystickHUDState | null,
    fireButton?: FireButtonHUDState | null,
  ): void;

  /**
   * World → screen for a single point, or null when off-screen. Engine-facing
   * API rather than an internal helper — the interact prompt uses it.
   */
  worldToScreen(camera: CameraState, pos: Vector2): Vector2 | null;

  // ── 2. Wiring back into the sim (for debug overlays) ─────────────────────
  setPhysics(p: PhysicsSystem): void;
  setFlowField(f: FlowFieldGrid): void;
  setShards(sh: ShardSystem): void;
}
