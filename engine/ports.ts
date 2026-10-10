/**
 * ports.ts — THE PLATFORM PORTS (engine-core plan, S2).
 *
 * The sim is a library and the platform sits behind five named ports:
 *
 *   Clock     — what time it is, and when the next frame is.
 *   Storage   — a synchronous string key/value store (save file, settings).
 *   Renderer  — the draw contract (`systems/Renderer.ts`, unchanged).
 *   Audio     — the sink every sound goes through, by id.
 *   Input     — the one movement vector / pointer / fire queue three devices
 *               write (CLAUDE.md §8, "THREE input devices, ONE set of inputs").
 *
 * plus two small ones the shell needs to be honest about: `Viewport` (the
 * display's size — the sim reads it, because an arena's spawn ring and the
 * wake radius are sized in screens) and `Lifecycle` (the app going to the
 * background and coming back), and `Entropy`, the one place a seed is allowed
 * to come from the outside world.
 *
 * WHAT THIS FILE IS FOR.  Nothing in the sim reads `window`, `document`,
 * `navigator` or `performance` any more — `tests/sim/guard.test.ts` greps for
 * them — so the same engine runs in a browser (`platform/browser.ts`) and in
 * Node (`platform/headless.ts`) with only these objects swapped.  That is what
 * makes the headless sim a faithful one and not a second implementation: the
 * state hashes it produces are checked against the browser's
 * (`tests/headless.spec.ts`).
 *
 * THE CLOCK AND THE VIEWPORT ARE MODULE-LEVEL, ON PURPOSE.  They are read from
 * hot paths in a dozen files that are constructed without any wiring (the
 * diagnostics timers in PhysicsSystem, the wake radius in four roamers), and
 * threading a handle through all of them would be a signature change in every
 * call chain for no gain.  `GameEngine`'s constructor installs them from the
 * platform it was given — the same settable-singleton shape `rng.ts` uses.
 * The cost is that two engines in ONE process share a clock; nothing does
 * that today, and a later constructor simply installs its own.
 *
 * Imports nothing but types, so it can sit under every other module.
 */
import type { ControlScheme, RumbleKind, Vector2, JoystickHUDState, FireButtonHUDState } from '../types';
import type { TriggerEncoding, TriggerProfile } from './systems/DualSenseHID';
import type { Renderer } from './systems/Renderer';
import type { RendererDiagnostics } from './systems/RendererDiagnostics';

// ── Clock ───────────────────────────────────────────────────────────────

import type { MusicThreat, MusicLayerId, MusicContextSnapshot } from './systems/AdaptiveMusic';

export interface Clock {
  /** Monotonic milliseconds.  Differences are meaningful; the origin is not. */
  now(): number;
  /** Wall-clock milliseconds since the Unix epoch.  Unlike `now()` it MEANS
   *  the same thing across launches, which is the only reason it exists: the save
   *  file stamps when the player left a wreck's arena (engine/wreck.ts).  Never
   *  read by the sim's step — only by saves and the wreck's wave decay. */
  wallMs(): number;
  /** Ask for `cb` before the next frame, like requestAnimationFrame: `cb` gets
   *  a timestamp on THIS clock's timeline.  A headless clock never calls it —
   *  nothing there runs a frame loop — and a test steps the sim by hand. */
  requestFrame(cb: (t: number) => void): void;
}

/** A clock that only moves when told to.  Zero everywhere is the HONEST
 *  default for code that runs before an engine installs a real one: every
 *  diagnostic timer then reads 0 ms, which is also exactly what a held replay
 *  feeds the PerfController. */
export class ManualClock implements Clock {
  private t = 0;
  now(): number { return this.t; }
  /** A fixed epoch plus the manual time, so a test moves wall time by `advance`. */
  wallMs(): number { return 1_700_000_000_000 + this.t; }
  advance(ms: number): void { this.t += ms; }
  set(ms: number): void { this.t = ms; }
  requestFrame(): void { /* a manual clock runs no frames */ }
}

let activeClock: Clock = new ManualClock();

/** Install the clock the sim reads.  Called by the `GameEngine` constructor. */
export function installClock(c: Clock): void { activeClock = c; }
export function clock(): Clock { return activeClock; }
/** The one wall-clock read the sim and its adapters share. */
export function nowMs(): number { return activeClock.now(); }

// ── Viewport ────────────────────────────────────────────────────────────

export interface Viewport {
  /** CSS pixels. */
  width: number;
  height: number;
  /** Device pixel ratio. */
  dpr: number;
}

/** The design target (390×844, CLAUDE.md §1): what a headless run reports, so
 *  it agrees with the Playwright project the browser hashes are taken at. */
export const DESIGN_VIEWPORT: Readonly<Viewport> = { width: 390, height: 844, dpr: 1 };

export type ViewportSource = () => Viewport;

let activeViewport: ViewportSource = () => DESIGN_VIEWPORT;

export function installViewport(v: ViewportSource): void { activeViewport = v; }
/** The display's current size.  Read-only: do not mutate the result. */
export function viewport(): Viewport { return activeViewport(); }

// ── Storage ─────────────────────────────────────────────────────────────

/** Synchronous on purpose: the save file is small, and a sync read at boot is
 *  what lets settings apply before the first frame.  An adapter whose backing
 *  store is async (a native plugin) reads once at startup and keeps this
 *  interface over an in-memory copy. */
export interface Storage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** An in-memory store.  The headless platform's, and what a browser falls back
 *  to when `localStorage` throws (private mode, blocked site data). */
export class MemoryStorage implements Storage {
  readonly map = new Map<string, string>();
  get(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null; }
  set(key: string, value: string): void { this.map.set(key, value); }
  remove(key: string): void { this.map.delete(key); }
}

// ── Lifecycle ───────────────────────────────────────────────────────────

export type LifecycleEvent = 'background' | 'foreground';

export interface Lifecycle {
  /** Call `cb` when the app is hidden / shown again.  Returns an unsubscribe. */
  subscribe(cb: (e: LifecycleEvent) => void): () => void;
}

/** A lifecycle a test drives by hand (`emit`). */
export class ManualLifecycle implements Lifecycle {
  private subs = new Set<(e: LifecycleEvent) => void>();
  subscribe(cb: (e: LifecycleEvent) => void): () => void {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  }
  emit(e: LifecycleEvent): void { for (const cb of [...this.subs]) cb(e); }
}

// ── Entropy ─────────────────────────────────────────────────────────────

export interface Entropy {
  /** A fresh 32-bit root seed for a run nobody asked to pin.  The ONE place
   *  the outside world reaches the sim's randomness (D-S1-a: hidden). */
  seed(): number;
}

// ── Audio ───────────────────────────────────────────────────────────────

/** Everything the engine, the UI and the debug panel ask of the sound layer.
 *  `AudioSystem` implements it; the headless platform's is silent. */
export interface AudioPort {
  play(id: string, opts?: { x?: number; y?: number; gain?: number; pitch?: number; param?: number;
                           near?: number; far?: number }): void;
  loop(id: string, on: boolean, opts?: { x?: number; y?: number; param?: number }): void;
  setActive(active: boolean): void;
  stopScene(all?: boolean): void;
  setCombat(combat: boolean): void;
  // The ADAPTIVE SCORE's surface (PR #110).  `cueBattleTrack` was the streamed
  // playlist's one-shot and is gone with it.  `MusicThreat` is imported as a
  // TYPE so this file still pulls in nothing at runtime (see §8): one
  // definition rather than a duplicated shape that could drift from the
  // adapter's.
  cueEncounter(kind: 'map' | 'portal' | 'boss'): void;
  setMusicThreat(threat: MusicThreat): void;
  /** Where the player is + which enemy family is near: what the score's layer
   *  variants are chosen from (AdaptiveMusic). */
  setMusicContext(context: MusicContextSnapshot): void;
  setMusicArea(id: string, kind: 'hub' | 'arena'): void;
  musicBossDefeated(): void;
  // The score's DEBUG controls, reached from the debug panel (which talks to
  // the engine's ports, not to `AudioSystem`).  No-ops where there is no score.
  cycleMusicSong(): void;
  setMusicSong(mode: 'auto' | number): void;
  cycleMusicDebugIntensity(): void;
  cycleMusicContextForce(): void;
  setListener(x: number, y: number): void;
  /** Arm the first-gesture unlock (a no-op where there is nothing to unlock). */
  armGestureUnlock(): void;
  unlock(): boolean;
  toggleMute(): void;
  setVolume(v: number): void;
  setSfxVolume(v: number): void;
  setMusicVolume(v: number): void;
  draftsEnabled: boolean;
  readonly volume: number;
  readonly sfxVolume: number;
  readonly musicVolume: number;
  readonly muted: boolean;
  readonly contextState: string | null;
  readonly audible: boolean;
  readonly latencyMs: number | null;
  readonly sampledIds: string[];
  readonly allIds: string[];
  readonly unmatchedFiles: string[];
  readonly loopSampleFilenames: string[];
  /** The adaptive score's own READOUT (PR #110), for the debug panel; null
   *  where there is no score at all — the headless adapter.  Declared
   *  STRUCTURALLY and read-only, naming only the fields the engine reads: the
   *  engine DRIVES the score through the four methods above and never reaches
   *  into it, so the port must not hand the sim a live `AdaptiveMusic`. */
  readonly music: {
    readonly intensity: number;
    readonly targetIntensity: number;
    readonly forcedIntensity: number | null;
    readonly activeLayers: MusicLayerId[];
    readonly bar: number;
    readonly song: { readonly title: string };
    readonly songMode: 'auto' | number;
    readonly pendingSong: { readonly title: string } | null;
    /** The song list from score/index.json (index order). */
    readonly songList: readonly { readonly id: string; readonly title: string; readonly bpm: number }[];
    /** Layer variants (AdaptiveMusic): context tags, the forced one, the variant
     *  in each declaring slot, the dominant enemy family, decoded PCM bytes. */
    readonly contexts: string[];
    readonly forcedContext: string | null;
    readonly variantMap: Record<string, string>;
    readonly dominantFamily: string | null;
    readonly decodedBytes: number;
  } | null;
}

// ── Input ───────────────────────────────────────────────────────────────

/** The engine's view of input.  `InputSystem` implements it (listening on the
 *  DOM is its adapter half — see `attach`); a test or a headless run drives
 *  the very same class through `applyReplayFrame` with nothing attached, so the
 *  scheme rules, the joystick math and the fire queues are the ones the
 *  browser runs. */
export interface InputPort {
  /** Start listening on a platform event target (the browser's `window`).
   *  Absent / never called ⇒ the port is driven by hand. */
  attach?(target: EventTarget): void;
  cleanup(): void;
  /** Release every held key / press (the app went to the background). */
  releaseAll(): void;

  getMovementVector(): Vector2;
  getMousePosition(): Vector2;
  getMouseHoldDuration(): number;
  getFireEvents(): Vector2[];
  getDeviceFireEvents(): Vector2[];
  getDeviceChargeEvents(): Vector2[];
  getChargeReleaseEvents(): Vector2[];
  claimTapNear(x: number, y: number, radius: number): boolean;
  isFireHeld(): boolean;
  isKeyDown(code: string): boolean;
  tapFires(): boolean;

  getControlScheme(): ControlScheme;
  setControlScheme(scheme: ControlScheme): void;
  usesTriggerThrust(): boolean;
  usesFaceFire(): boolean;

  getJoystickState(): JoystickHUDState | null;
  getFireButtonState(): FireButtonHUDState | null;
  setStickExclusion(x: number, y: number, w: number, h: number): void;
  tickJoystick(dtSec: number): void;
  joystickForceVisible: boolean;

  consumeInteractPress(): boolean;
  consumeScanPress(): boolean;
  consumeCyclePress(): boolean;
  consumePausePress(): boolean;
  consumeDebugKeyPress(): boolean;
  consumePadDebugPress(): boolean;
  consumeEscapePress(): boolean;
  consumePadConnectionEvent(): { connected: boolean; id: string } | null;
  consumeNavSteps(): { x: number; y: number }[];
  consumeConfirmPress(): boolean;
  consumeBackPress(): boolean;

  pollGamepad(fireEnabled: boolean): void;
  setPadCaptured(on: boolean): void;
  padDebugName(): string;
  padDebugAxes(): string;

  rumble(amount: number, kind?: RumbleKind): void;
  rumbleDebugInfo(): string;
  rumbleEnabled: boolean;

  adaptiveTriggersSupported(): boolean;
  adaptiveTriggersConnected(): boolean;
  connectAdaptiveTriggers(): Promise<boolean>;
  disconnectAdaptiveTriggers(): Promise<void>;
  setTriggerProfile(profile: TriggerProfile): void;
  setThrustTriggerProfile(profile: TriggerProfile): void;
  triggerEncoding(): TriggerEncoding;
  cycleTriggerEncoding(): void;
  adaptiveTriggerDebugInfo(): string;
  adaptiveTriggerReportHex(): string;
  testAdaptiveTriggerLink(): void;

  /** Drive the input by hand for one step: held keys, the pointer's screen
   *  position, one-step tap fires and one-step CHARGED-shot releases
   *  (engine/replay.ts). */
  applyReplayFrame(keys: readonly string[], aimX: number, aimY: number,
                   fire: ReadonlyArray<readonly [number, number]>,
                   charge?: ReadonlyArray<readonly [number, number]>): void;
}

// ── The platform ────────────────────────────────────────────────────────

export type RendererPort = Renderer & RendererDiagnostics;

/** Everything the engine is given.  `platform/browser.ts` and
 *  `platform/headless.ts` each build one. */
export interface Platform {
  clock: Clock;
  viewport: ViewportSource;
  storage: Storage;
  lifecycle: Lifecycle;
  entropy: Entropy;
  audio: AudioPort;
  input: InputPort;
  renderer: RendererPort;
}
