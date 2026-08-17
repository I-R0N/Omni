/**
 * THE RENDERER SEAM.
 *
 * The interface `GameEngine` needs from a renderer — nothing more. Extracted
 * (gauntlet WebGPU, stage 3) so the engine depends on a CONTRACT rather than
 * on the concrete `RenderSystem` class, which is the prerequisite for any
 * renderer swap: WebGPU, WebGL2, a headless stub for tests, or none at all.
 *
 * This file deliberately contains **no behaviour**. It is a description of
 * the coupling that already exists, written down. `RenderSystem` implements
 * it unchanged, and `GameEngine.renderer` is typed by it.
 *
 * ── WHAT IS IN HERE, AND WHY IT IS THE SHAPE IT IS ────────────────────────
 * Three groups, and the split is the interesting part of the extraction:
 *
 *   1. LIFECYCLE + FRAME — `setContext`, the per-map builders, and `render`.
 *      The genuine renderer API. Any implementation must provide these.
 *
 *   2. WIRING — `setPhysics` / `setFlowField`. These hand the renderer live
 *      references to two SIM systems so the debug overlays can draw them.
 *      They are a real coupling from the renderer back into the simulation,
 *      and a second implementation must accept them even if it ignores them.
 *
 *   3. DEBUG FLAGS + PERF COUNTERS — mutable public fields, written by
 *      `DebugControls` and read by `GameEngine.buildPerfSnapshot()`.
 *
 * Group 3 is the one worth flagging for any future renderer work. These are
 * FIELDS, not methods, so the interface has to expose them as mutable
 * properties, and a second renderer must carry all thirteen counters even
 * where they are meaningless to it (a GPU renderer has no "tint cache miss",
 * and `lastRenderMs` measures CPU-side call issuing — which is precisely the
 * measure a GPU renderer moves work *out* of; see the log's Stage 1 notes).
 * They are part of the contract only because `PerfSnapshot` and the DBG panel
 * read them directly. Narrowing that — a `RendererStats` object the engine
 * asks for once per frame — is the obvious next refactor, and is deliberately
 * NOT done here: stage 3's gate is a byte-identical game, and reshaping the
 * perf plumbing would fail it.
 */
import type {
  GameEntity, Vector2, MapType, CameraState, DamageText, PlayerHUDMessage,
  WaveAnnouncement, TrailShape, JoystickHUDState, FireButtonHUDState,
} from '../../types';
import type { FlowOverlayState } from './RenderSystem';
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
   * World → screen for a single point, or null when off-screen. Used by the
   * engine for the interact prompt, so it is engine-facing API rather than an
   * internal helper.
   */
  worldToScreen(camera: CameraState, pos: Vector2): Vector2 | null;

  // ── 2. Wiring back into the sim (for debug overlays) ─────────────────────
  setPhysics(p: PhysicsSystem): void;
  setFlowField(f: FlowFieldGrid): void;

  // ── 3. Debug flags (written by DebugControls) ────────────────────────────
  /* `debugMode` itself is deliberately NOT here: it is set through
     `setDebugMode` and never read from outside the renderer, so putting the
     field in the seam would describe a coupling that does not exist. */
  setDebugMode(v: boolean): void;
  setTrailShape(s: TrailShape): void;
  tileOutlinesEnabled: boolean;
  shardLodEnabled: boolean;
  plasticAutomataEnabled: boolean;
  materialAutomataEnabled: boolean;
  chevronsOffscreenOnly: boolean;

  // ── 3b. Perf counters (read by buildPerfSnapshot / the DBG panel) ────────
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
}
