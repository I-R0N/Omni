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
 * Group 3 is the one worth flagging for any future renderer work, and it is
 * MEASURABLY the problem with this file. These are FIELDS, not methods, so
 * the interface must expose them as mutable properties, and a second renderer
 * has to carry every counter even where it is meaningless to it (a GPU
 * renderer has no "tint cache miss", and `lastRenderMs` measures CPU-side
 * call issuing — precisely the measure a GPU renderer moves work *out* of;
 * see the log's Stage 1 notes).
 *
 * HOW FAST IT GROWS, measured rather than guessed. At extraction the seam was
 * 28 members, 19 of them group 3. While this branch waited on two unrelated
 * PRs, the lighting and 5d-UI work added FIFTEEN more — 4 predicted, 15
 * actual — every one of them debug state or a perf counter, none of them
 * anything a renderer swap cares about. The draw path (groups 1 and 2) did
 * not change at all.
 *
 * That is the whole argument for NARROWING this interface to groups 1 and 2
 * and letting debug flags and perf counters be reached through the concrete
 * class: the seam would then cover exactly the part a swap replaces, and stop
 * being edited by work that has nothing to do with rendering architecture.
 * See the MERGE DEFERRED section of docs/GAUNTLET_WEBGPU_LOG.md. It is left
 * as-is here because this pass is a REBASE, not a redesign — the decision is
 * the operator's, and this file is the evidence for it.
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

  // ── 3a. Lighting + HUD state added since the seam was written ───────────
  /* These arrived with the lighting (PR #88) and 5d UI (PR #89) work while
     this branch waited. They are here because `GameEngine` and
     `DebugControls` read them directly off the renderer — see the MERGE
     DEFERRED section of docs/GAUNTLET_WEBGPU_LOG.md, where the rate at which
     this group grows is the argument for narrowing the seam. */
  damageTriggeredBars: boolean;
  bossBarActive: boolean;
  stageDepth: number;
  playerLightToolHalfDeg: number | null;
  getShadowSoftness(): string;
  getFlashlight(): string;
  getRefraction(): boolean;
  getEmissive(): boolean;
  getEmitShadows(): boolean;
  getEmitShadowTier(): { name: string; maxEmitters: number; maxOccluders: number };
  getFog(): string;
  resetFog(): void;

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
  lastLightingMs: number;
  lastLightingLights: number;
  lastFogMs: number;
}
