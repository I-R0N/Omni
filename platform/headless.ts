/**
 * platform/headless.ts — the NODE implementation of the engine's ports.
 *
 * A headless engine is the REAL `GameEngine` with the outside world swapped
 * for stand-ins that do nothing but keep the sim honest:
 *
 *  - the clock only moves when told to (`ManualClock`), so every diagnostic
 *    timer reads 0 ms — which is what a held replay already feeds the
 *    PerfController, and why a headless run and a browser replay agree;
 *  - the viewport is the 390×844 design target unless a test says otherwise;
 *  - storage is memory, lifecycle is driven by hand;
 *  - audio is silent and the renderer draws nothing;
 *  - INPUT is the real `InputSystem` with no listeners attached, driven by
 *    `applyReplayFrame` — so the scheme rules, fire queues and joystick math
 *    are the browser's own, not a re-implementation.
 *
 * This is the harness the invisible PR exists for: sim assertions that used
 * to need a 19-minute browser suite run here in milliseconds, and
 * `tests/headless.spec.ts` proves the two agree to the bit.
 */
import { InputSystem } from '../engine/systems/InputSystem';
import {
  DESIGN_VIEWPORT, ManualClock, ManualLifecycle, MemoryStorage,
  type AudioPort, type Entropy, type Platform, type RendererPort, type Viewport,
} from '../engine/ports';
import type { GameEntity, MapType, Vector2 } from '../types';

/** Silent audio.  Every query answers "nothing is playing". */
export class NullAudio implements AudioPort {
  draftsEnabled = true;
  volume = 0.7; sfxVolume = 1; musicVolume = 1; muted = false;
  readonly contextState: string | null = null;
  readonly audible = false;
  readonly latencyMs: number | null = null;
  readonly sampledIds: string[] = [];
  readonly allIds: string[] = [];
  readonly unmatchedFiles: string[] = [];
  readonly loopSampleFilenames: string[] = [];
  /** Every id asked for, so a test can assert a cue fired without a browser. */
  readonly played: string[] = [];
  play(id: string): void { this.played.push(id); }
  loop(): void {}
  setActive(): void {}
  stopScene(): void {}
  setCombat(): void {}
  // The adaptive score's surface (PR #110): silent headless, like every other
  // voice here — the sim must behave identically with no audio.
  cueEncounter(): void {}
  setMusicThreat(): void {}
  setMusicContext(): void {}
  setMusicArea(): void {}
  musicBossDefeated(): void {}
  cycleMusicSong(): void {}
  setMusicSong(): void {}
  cycleMusicDebugIntensity(): void {}
  cycleMusicContextForce(): void {}
  /** There is no score here, so there is nothing to read out. */
  readonly music = null;
  setListener(): void {}
  armGestureUnlock(): void {}
  unlock(): boolean { return false; }
  toggleMute(): void { this.muted = !this.muted; }
  setVolume(v: number): void { this.volume = v; }
  setSfxVolume(v: number): void { this.sfxVolume = v; }
  setMusicVolume(v: number): void { this.musicVolume = v; }
}

/** A renderer that draws nothing and reports zero for every counter. */
export class NullRenderer implements RendererPort {
  setContext(): void {}
  setMapType(_t: MapType): void {}
  setNebulaClusterCenters(_c: Vector2[] | null): void {}
  buildStaticTileLayer(): void {}
  buildMinimapStaticLayer(): void {}
  render(): void {}
  worldToScreen(): Vector2 | null { return null; }
  setPhysics(): void {}
  setFlowField(): void {}
  setShards(): void {}

  setDebugMode(): void {}
  setTrailShape(): void {}
  tileOutlinesEnabled = true;
  shardLodEnabled = true;
  plasticAutomataEnabled = true;
  shardBlendEnabled = true;
  materialAutomataEnabled = true;
  chevronsOffscreenOnly = true;
  damageTriggeredBars = true;
  bossBarActive = false;
  hudHole: { x: number; y: number; w: number; h: number } | null = null;
  portalWarp: number | null = null;
  lastWarpVeilAlpha = 0;
  stageDepth = 0;
  playerLightToolHalfDeg: number | null = null;
  scannerMk = 0;
  scanRanges: number[] = [];
  scanPingRadius = 0;
  scanPingMax = 0;
  autoPingRadius = 0;
  autoPingMax = 0;
  simClock = 0;
  energyFx: RendererPort['energyFx'] = null;
  materialRevealAt = 0;
  materialRevealRadius = 0;
  materialRevealX = 0;
  materialRevealY = 0;
  stampMinimapTile(_e: GameEntity): void {}
  unstampMinimapTile(_e: GameEntity): void {}
  arrivalPortalId: string | null = null;
  invalidateBackground(): void {}
  getShadowSoftness(): string { return 'n/a'; }
  getFlashlight(): string { return 'n/a'; }
  getRefraction(): boolean { return false; }
  getEmissive(): boolean { return false; }
  getEmitShadows(): boolean { return false; }
  getEmitShadowTier(): { name: string; maxEmitters: number; maxOccluders: number } {
    return { name: 'n/a', maxEmitters: 0, maxOccluders: 0 };
  }
  getFog(): string { return 'n/a'; }
  resetFog(): void {}
  lastRenderMs = 0;
  lastNebulaMs = 0;
  lastNebulaVisible = 0;
  lastNebulaFastCount = 0;
  lastNebulaSlowCount = 0;
  lastTileLightingMs = 0;
  lastTileLightingCount = 0;
  lastStampMs = 0;
  lastStampCount = 0;
  lastTintMs = 0;
  lastTintMisses = 0;
  lastLodShardCount = 0;
  lastShardBlendCount = 0;
  lastLightingMs = 0;
  lastLightingLights = 0;
  lastFogMs = 0;
}

export interface HeadlessOptions {
  viewport?: Partial<Viewport>;
  /** Seed `Entropy.seed()` counts up from, so "a fresh run seed" is itself
   *  reproducible in a test. */
  entropySeed?: number;
  /** Share a storage between engines to model a RELAUNCH: the second engine
   *  reads what the first one wrote. */
  storage?: MemoryStorage;
}

export interface HeadlessPlatform extends Platform {
  clock: ManualClock;
  lifecycle: ManualLifecycle;
  storage: MemoryStorage;
  audio: NullAudio;
  input: InputSystem;
}

export function createHeadlessPlatform(opts: HeadlessOptions = {}): HeadlessPlatform {
  const vp: Viewport = { ...DESIGN_VIEWPORT, ...opts.viewport };
  let n = (opts.entropySeed ?? 0x9e3779b9) >>> 0;
  const entropy: Entropy = {
    seed(): number { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n; },
  };
  return {
    clock: new ManualClock(),
    viewport: () => vp,
    storage: opts.storage ?? new MemoryStorage(),
    lifecycle: new ManualLifecycle(),
    entropy,
    audio: new NullAudio(),
    input: new InputSystem(),
    renderer: new NullRenderer(),
  };
}
