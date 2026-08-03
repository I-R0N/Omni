import { AUDIO_CONSTANTS } from '../../constants';
import { wrapDeltaX, wrapDeltaY } from '../toroidal';

/**
 * AudioSystem — the game's SFX manager.
 *
 * `docs/SFX_INVENTORY.md` is the source of truth for WHAT plays and with
 * what parameters; this file is the machinery that plays it.  Two rules
 * from that document shape the whole design:
 *
 *   1. **Ids are the contract.**  Every trigger site calls
 *      `audio.play('weapon.blaster.fire')` and nothing else.  A synth
 *      draft is replaced by a real asset by re-registering the same id —
 *      never by touching a call site.  Consequently nothing here knows
 *      about game entities, and no game system imports audio state.
 *   2. **Drafts are procedural.**  Every sound is synthesised from
 *      oscillators / noise / filters / envelopes, so there are no audio
 *      asset files and `scripts/inline-build.mjs` (the single-file
 *      standalone build) is untouched.
 *
 * Three properties matter for this engine specifically:
 *
 * - **No per-frame work.**  The manager is purely event-driven.  The only
 *   thing called every frame is `setListener()`, two number writes.
 *   Voice bookkeeping is pruned lazily inside `play()`.
 * - **A mass-death frame must not spawn 400 voices.**  Per-id polyphony
 *   caps, a per-id retrigger window that COLLAPSES simultaneous triggers
 *   into one louder voice, and a global voice ceiling that thins by mix
 *   tier.  Same spirit as `enforceCap` for particles: purely cosmetic
 *   output, so dropping is safe — but here dropping is done in a way that
 *   makes a big event sound HEAVIER rather than thinner.
 * - **Torus-correct positioning.**  Pan and distance attenuation go
 *   through `wrapDeltaX`/`wrapDeltaY`, so a sound just across the seam
 *   pans to the near side rather than flipping to the far one.
 *
 * The AudioContext is created on the FIRST USER GESTURE, never in the
 * constructor — mobile browsers refuse to start audio otherwise, and the
 * headless smoke asserts that no context exists before a gesture.
 */

// ── Registry types ──────────────────────────────────────────────────────────

/** Mix priority (SFX_INVENTORY §2).  1 never thins; 3 thins first. */
export type SfxTier = 1 | 2 | 3;

/** Everything a synth function needs.  Passed by reference and reused —
 *  the object is a scratch record owned by the manager, not a fresh
 *  allocation per voice. */
export interface SynthCtx {
  ctx: AudioContext;
  /** Voice output node.  Static per-voice gain is already applied here;
   *  the synth renders its own envelope below it. */
  dest: AudioNode;
  /** Context time this voice starts at. */
  t0: number;
  /** Pitch multiplier for this instance (variation jitter + caller bias). */
  pitch: number;
  /** Continuous 0..1 parameter for tracked sounds (charge progress,
   *  throttle).  Unused by one-shots. */
  param: number;
  /** Shared white-noise buffer.  Built once at unlock. */
  noise: AudioBuffer;
}

/** A one-shot sound.  `render` returns the voice's duration in seconds so
 *  the manager can retire it without a timer. */
export interface SfxDef {
  tier: SfxTier;
  /** Relative mix level, 0..1, before master volume (inventory `mix`). */
  gain: number;
  /** Max simultaneous voices for this id (inventory `poly`). */
  poly: number;
  /** Retrigger window in seconds.  A second trigger inside it is
   *  collapsed into the live voice rather than played (inventory
   *  `≥Nms`). */
  minInterval: number;
  /** When true, a collapsed retrigger BUMPS the live voice's gain instead
   *  of being silently dropped — 40 shard breaks read as one heavier
   *  break.  Inventory `+gain`. */
  collapse?: boolean;
  /** Random detune fraction per instance (inventory `pitch ±N%`). */
  jitter?: number;
  /** World-positioned (panned + distance-attenuated) vs UI-flat. */
  positional?: boolean;
  render: (s: SynthCtx) => number;
}

/** A sustained sound with an enter/exit condition.  `start` builds the
 *  graph and returns a handle; `set` receives the tracked 0..1 parameter
 *  on change (charge progress, throttle). */
export interface SfxLoopDef {
  tier: SfxTier;
  gain: number;
  positional?: boolean;
  start: (s: SynthCtx) => LoopVoice;
}

export interface LoopVoice {
  /** Called when the tracked parameter changes.  Optional. */
  set?: (param: number, now: number) => void;
  /** Tear the graph down.  Must be idempotent. */
  stop: (now: number) => void;
}

// ── Voice bookkeeping ───────────────────────────────────────────────────────

interface IdState {
  /** Context time of the most recent trigger (retrigger-window gate). */
  lastAt: number;
  /** Live voice end times for this id, ascending-ish; pruned lazily. */
  ends: number[];
  /** The most recent voice's static gain node — the collapse target. */
  lastGain: GainNode | null;
  /** Accumulated collapse bump on `lastGain`, capped. */
  lastBump: number;
}

interface LiveLoop {
  voice: LoopVoice;
  gain: GainNode;
  panner: StereoPannerNode | null;
  param: number;
}

export class AudioSystem {
  // ── Registry ──
  private defs = new Map<string, SfxDef>();
  private loopDefs = new Map<string, SfxLoopDef>();

  // ── Context (created on first gesture only) ──
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private gestureBound = false;

  // ── Mixer state (in-memory only — see FOR-USER-REVIEW in the gauntlet
  //    log: durable preference storage is out of scope for this project) ──
  private _volume: number = AUDIO_CONSTANTS.DEFAULT_VOLUME;
  private _muted = false;
  /** False while paused / docked / in the menu — i.e. whenever the sim is
   *  frozen.  Silences the WORLD (loops and positional one-shots) but
   *  deliberately NOT flat/UI sounds: the station and pause screens are
   *  exactly where menu clicks, purchases and docking cues have to be
   *  audible. */
  private _active = true;

  // ── Listener (camera) position, world space ──
  private lx = 0;
  private ly = 0;

  // ── Live voices ──
  private ids = new Map<string, IdState>();
  private loops = new Map<string, LiveLoop>();
  /** Global live-voice end times, compacted in place on each play. */
  private globalEnds: number[] = [];

  // ── Headless-smoke counters (window.__omniEngine drives the assertions;
  //    a map increment per event is free at audio-event rates) ──
  public readonly counts = { played: 0, dropped: 0, collapsed: 0 };
  private perId = new Map<string, number>();

  // Scratch synth record — reused per voice rather than reallocated.
  private scratch: SynthCtx = {
    ctx: null as unknown as AudioContext,
    dest: null as unknown as AudioNode,
    t0: 0, pitch: 1, param: 0,
    noise: null as unknown as AudioBuffer,
  };

  // ── Registration ──────────────────────────────────────────────────────────

  public register(id: string, def: SfxDef) { this.defs.set(id, def); }
  public registerLoop(id: string, def: SfxLoopDef) { this.loopDefs.set(id, def); }
  public has(id: string): boolean { return this.defs.has(id) || this.loopDefs.has(id); }
  public get registeredCount(): number { return this.defs.size + this.loopDefs.size; }

  // ── Unlock ────────────────────────────────────────────────────────────────

  /**
   * Arm one-shot window listeners that create the AudioContext on the
   * first real user gesture.  Deliberately owned here rather than pushed
   * into InputSystem: InputSystem only engages on CANVAS-targeted events
   * (so overlay menus keep native touch scrolling), but a menu tap is a
   * perfectly good unlock gesture — and on mobile it is usually the FIRST
   * one.  Capture-phase + `once` means this never interferes with either
   * the overlay or the game input path.
   */
  public armGestureUnlock() {
    if (this.gestureBound || typeof window === 'undefined') return;
    this.gestureBound = true;
    const fire = () => this.unlock();
    const opts = { capture: true, once: true, passive: true } as const;
    window.addEventListener('pointerdown', fire, opts);
    window.addEventListener('touchend', fire, opts);
    window.addEventListener('keydown', fire, opts);
    window.addEventListener('mousedown', fire, opts);
  }

  /** Create (or resume) the context.  Idempotent; safe to call from any
   *  gesture handler.  Returns false when audio is unavailable. */
  public unlock(): boolean {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return true;
    }
    const Ctor: typeof AudioContext | undefined =
      typeof window !== 'undefined'
        ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (!Ctor) return false;
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
      return false;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this._muted ? 0 : this._volume;
    this.master.connect(this.ctx.destination);

    // Shared white noise — one buffer for every noise-based voice in the
    // game, sampled at a random offset per voice so repeats don't phase.
    const len = Math.floor(this.ctx.sampleRate * AUDIO_CONSTANTS.NOISE_BUFFER_SEC);
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return true;
  }

  public get unlocked(): boolean { return this.ctx !== null; }
  public get contextState(): string | null { return this.ctx ? this.ctx.state : null; }

  // ── Mixer ─────────────────────────────────────────────────────────────────

  public get volume(): number { return this._volume; }
  public setVolume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    this.applyMaster();
  }
  public get muted(): boolean { return this._muted; }
  public setMuted(m: boolean) {
    this._muted = m;
    if (m) this.stopAllLoops();
    this.applyMaster();
  }
  public toggleMute() { this.setMuted(!this._muted); }

  /** Paused / docked: kill loops and drop one-shots, but keep the context
   *  alive so the next resume is instant. */
  public setActive(a: boolean) {
    if (this._active === a) return;
    this._active = a;
    if (!a) this.stopAllLoops();
  }
  public get active(): boolean { return this._active; }

  private applyMaster() {
    if (!this.master || !this.ctx) return;
    const target = this._muted ? 0 : this._volume;
    // Short ramp rather than a step — a hard gain jump clicks.
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
  }

  // ── Listener ──────────────────────────────────────────────────────────────

  /** Camera world position.  Called once per frame; two number writes. */
  public setListener(x: number, y: number) { this.lx = x; this.ly = y; }

  // ── Playback ──────────────────────────────────────────────────────────────

  /**
   * Fire a one-shot.  Silently no-ops when the id is unregistered, audio
   * is locked/muted/inactive, or the voice budget says no — call sites
   * never branch on audio state.
   */
  public play(
    id: string,
    opts?: { x?: number; y?: number; gain?: number; pitch?: number; param?: number },
  ) {
    const def = this.defs.get(id);
    if (!def) return;
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    if (this._muted) return;
    // Frozen sim silences the world but not the UI — see `_active`.
    // Counted as a drop rather than returning silently, so the headless
    // smoke can tell "suppressed" from "never reached the manager".
    if (!this._active && def.positional) { this.counts.dropped++; return; }

    const now = this.ctx.currentTime;
    const st = this.stateFor(id);

    // 1. Retrigger window.  Inside it, either bump the live voice (so a
    //    bulk event reads as one heavier hit) or drop outright.
    if (now - st.lastAt < def.minInterval) {
      if (def.collapse && st.lastGain) {
        // Each collapsed trigger multiplies the live voice up, saturating
        // at CAP — so ten simultaneous breaks are audibly bigger than one
        // but forty are not ten times louder than ten.
        if (st.lastBump < AUDIO_CONSTANTS.COLLAPSE_BUMP_CAP) {
          const next = Math.min(AUDIO_CONSTANTS.COLLAPSE_BUMP_CAP,
                                st.lastBump * AUDIO_CONSTANTS.COLLAPSE_BUMP);
          const factor = next / st.lastBump;
          st.lastBump = next;
          st.lastGain.gain.setTargetAtTime(st.lastGain.gain.value * factor, now, 0.01);
        }
        this.counts.collapsed++;
      } else {
        this.counts.dropped++;
      }
      return;
    }

    // 2. Per-id polyphony.  Prune retired voices first (lazy — no timers).
    this.prune(st.ends, now);
    if (st.ends.length >= def.poly) { this.counts.dropped++; return; }

    // 3. Global ceiling, thinned by tier.  Tier 1 always plays.
    this.pruneGlobal(now);
    if (def.tier > 1) {
      const cap = def.tier === 3
        ? AUDIO_CONSTANTS.MAX_VOICES_TIER3
        : AUDIO_CONSTANTS.MAX_VOICES_TIER2;
      if (this.globalEnds.length >= cap) { this.counts.dropped++; return; }
    }
    if (this.globalEnds.length >= AUDIO_CONSTANTS.MAX_VOICES) { this.counts.dropped++; return; }

    // 4. Static per-voice gain: mix level × caller trim × distance.
    let g = def.gain * (opts?.gain ?? 1);
    let pan = 0;
    if (def.positional && opts?.x !== undefined && opts?.y !== undefined) {
      // NOTE the argument order: wrapDeltaX(from, to) returns `to - from`,
      // so listener-first gives a delta pointing FROM the listener TO the
      // source — which is what pan wants (positive = to the right).
      // Reversing it inverts the stereo image.
      const dx = wrapDeltaX(this.lx, opts.x);
      const dy = wrapDeltaY(this.ly, opts.y);
      const d = Math.sqrt(dx * dx + dy * dy);
      const atten = this.attenuation(d);
      if (atten <= 0) { this.counts.dropped++; return; } // out of earshot
      g *= atten;
      pan = Math.max(-1, Math.min(1, dx / AUDIO_CONSTANTS.PAN_WIDTH));
    }

    const voiceGain = this.ctx.createGain();
    voiceGain.gain.value = g;
    let tail: AudioNode = voiceGain;
    if (pan !== 0) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = pan;
      voiceGain.connect(panner);
      tail = panner;
    }
    tail.connect(this.master);

    // 5. Render.
    const s = this.scratch;
    s.ctx = this.ctx;
    s.dest = voiceGain;
    s.t0 = now;
    s.pitch = (opts?.pitch ?? 1) * (def.jitter ? 1 + (Math.random() * 2 - 1) * def.jitter : 1);
    s.param = opts?.param ?? 0;
    s.noise = this.noiseBuf;
    const dur = Math.max(0.01, def.render(s));

    const endsAt = now + dur + AUDIO_CONSTANTS.VOICE_RELEASE_PAD;
    st.ends.push(endsAt);
    st.lastAt = now;
    st.lastGain = voiceGain;
    st.lastBump = 1;
    this.globalEnds.push(endsAt);
    this.counts.played++;
    this.perId.set(id, (this.perId.get(id) ?? 0) + 1);

    // Disconnect once silent so the graph doesn't accumulate dead nodes.
    // setTimeout is fine here: one per VOICE, not per frame, and the
    // manager is event-driven by construction.
    const node = voiceGain;
    setTimeout(() => { try { node.disconnect(); } catch { /* already gone */ } },
               (dur + AUDIO_CONSTANTS.VOICE_RELEASE_PAD) * 1000 + 60);
  }

  /**
   * Drive a sustained sound.  Idempotent in both directions, so a call
   * site can fire `loop(id, throttle > 0)` every sim step without
   * tracking state itself — which is the point: the enter/exit conditions
   * in SFX_INVENTORY are per-frame predicates.
   */
  public loop(
    id: string,
    on: boolean,
    opts?: { x?: number; y?: number; param?: number },
  ) {
    const def = this.loopDefs.get(id);
    if (!def) return;
    const live = this.loops.get(id);

    if (!on || this._muted || !this._active) {
      if (live && this.ctx) {
        live.voice.stop(this.ctx.currentTime);
        try { live.gain.disconnect(); } catch { /* already gone */ }
        this.loops.delete(id);
      }
      return;
    }

    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const now = this.ctx.currentTime;
    const param = opts?.param ?? 0;

    if (live) {
      if (param !== live.param) { live.param = param; live.voice.set?.(param, now); }
      if (live.panner && def.positional && opts?.x !== undefined && opts?.y !== undefined) {
        const dx = wrapDeltaX(this.lx, opts.x);
        const dy = wrapDeltaY(this.ly, opts.y);
        const d = Math.sqrt(dx * dx + dy * dy);
        live.panner.pan.setTargetAtTime(
          Math.max(-1, Math.min(1, dx / AUDIO_CONSTANTS.PAN_WIDTH)), now, 0.08);
        live.gain.gain.setTargetAtTime(def.gain * this.attenuation(d), now, 0.08);
      }
      return;
    }

    const gain = this.ctx.createGain();
    let panner: StereoPannerNode | null = null;
    let g = def.gain;
    if (def.positional && opts?.x !== undefined && opts?.y !== undefined) {
      const dx = wrapDeltaX(this.lx, opts.x);
      const dy = wrapDeltaY(this.ly, opts.y);
      g *= this.attenuation(Math.sqrt(dx * dx + dy * dy));
      panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, dx / AUDIO_CONSTANTS.PAN_WIDTH));
    }
    // Fade in rather than snapping — a loop starting at full gain clicks.
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(g, now, AUDIO_CONSTANTS.LOOP_RAMP);
    if (panner) { gain.connect(panner); panner.connect(this.master); }
    else gain.connect(this.master);

    const s = this.scratch;
    s.ctx = this.ctx; s.dest = gain; s.t0 = now;
    s.pitch = 1; s.param = param; s.noise = this.noiseBuf;
    const voice = def.start(s);
    this.loops.set(id, { voice, gain, panner, param });
    this.counts.played++;
    this.perId.set(id, (this.perId.get(id) ?? 0) + 1);
  }

  public isLooping(id: string): boolean { return this.loops.has(id); }

  public stopAllLoops() {
    if (!this.ctx) { this.loops.clear(); return; }
    const now = this.ctx.currentTime;
    this.loops.forEach(l => {
      l.voice.stop(now);
      try { l.gain.disconnect(); } catch { /* already gone */ }
    });
    this.loops.clear();
  }

  // ── Introspection (headless smokes + the DBG panel) ───────────────────────

  public playsOf(id: string): number { return this.perId.get(id) ?? 0; }
  /** Live voice count for one id — the quantity `poly` bounds. */
  public liveVoicesOf(id: string): number {
    const st = this.ids.get(id);
    if (!st) return 0;
    if (this.ctx) this.prune(st.ends, this.ctx.currentTime);
    return st.ends.length;
  }
  public get liveVoices(): number {
    if (this.ctx) this.pruneGlobal(this.ctx.currentTime);
    return this.globalEnds.length;
  }
  public get liveLoops(): number { return this.loops.size; }
  public resetCounters() {
    this.counts.played = 0; this.counts.dropped = 0; this.counts.collapsed = 0;
    this.perId.clear();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private stateFor(id: string): IdState {
    let st = this.ids.get(id);
    if (!st) { st = { lastAt: -1e9, ends: [], lastGain: null, lastBump: 1 }; this.ids.set(id, st); }
    return st;
  }

  /** Distance attenuation: full inside NEAR, linear to zero at FAR. */
  private attenuation(d: number): number {
    const { NEAR_RADIUS, FAR_RADIUS } = AUDIO_CONSTANTS;
    if (d <= NEAR_RADIUS) return 1;
    if (d >= FAR_RADIUS) return 0;
    return 1 - (d - NEAR_RADIUS) / (FAR_RADIUS - NEAR_RADIUS);
  }

  /** In-place compaction of retired end times (mutate, don't allocate). */
  private prune(ends: number[], now: number) {
    let w = 0;
    for (let i = 0; i < ends.length; i++) if (ends[i] > now) ends[w++] = ends[i];
    ends.length = w;
  }

  private pruneGlobal(now: number) { this.prune(this.globalEnds, now); }
}

// ── Synthesis primitives ────────────────────────────────────────────────────
//
// Shared by every registry entry.  Each returns the voice's end offset in
// seconds from `s.t0`, so a synth function is just `Math.max(...)` over the
// layers it stacks.  All timing is in SECONDS (WebAudio's unit); the
// inventory quotes milliseconds, so a def divides by 1000 at the boundary.

/** Pitched layer: an oscillator with an optional frequency glide and an
 *  attack/decay amplitude envelope. */
export function tone(s: SynthCtx, o: {
  type?: OscillatorType;
  f0: number;
  f1?: number;
  attack: number;
  decay: number;
  gain: number;
  delay?: number;
  /** Frequency glide curve.  Exponential reads as musical; linear reads
   *  as mechanical. */
  glide?: 'exp' | 'lin';
}): number {
  const { ctx, dest, pitch } = s;
  const t = s.t0 + (o.delay ?? 0);
  const f0 = Math.max(1, o.f0 * pitch);
  const f1 = Math.max(1, (o.f1 ?? o.f0) * pitch);
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) {
    const end = t + o.attack + o.decay;
    if ((o.glide ?? 'exp') === 'exp') osc.frequency.exponentialRampToValueAtTime(f1, end);
    else osc.frequency.linearRampToValueAtTime(f1, end);
  }
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(o.gain, t + Math.max(0.001, o.attack));
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.attack + o.decay);
  osc.connect(env); env.connect(dest);
  const stopAt = t + o.attack + o.decay + 0.02;
  osc.start(t); osc.stop(stopAt);
  return stopAt - s.t0;
}

/** Noise layer: the shared white-noise buffer through a biquad, with an
 *  optional filter sweep and an attack/decay envelope. */
export function noise(s: SynthCtx, o: {
  f0: number;
  f1?: number;
  type?: BiquadFilterType;
  q?: number;
  attack: number;
  decay: number;
  gain: number;
  delay?: number;
}): number {
  const { ctx, dest, noise: buf, pitch } = s;
  const t = s.t0 + (o.delay ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  // Random start offset: one buffer, but no two voices share a waveform.
  src.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = o.type ?? 'bandpass';
  filt.Q.value = o.q ?? 1;
  const f0 = Math.max(20, o.f0 * pitch);
  const f1 = Math.max(20, (o.f1 ?? o.f0) * pitch);
  filt.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) filt.frequency.exponentialRampToValueAtTime(f1, t + o.attack + o.decay);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(o.gain, t + Math.max(0.001, o.attack));
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.attack + o.decay);
  src.connect(filt); filt.connect(env); env.connect(dest);
  const stopAt = t + o.attack + o.decay + 0.02;
  src.start(t, Math.random() * (AUDIO_CONSTANTS.NOISE_BUFFER_SEC - 0.5));
  src.stop(stopAt);
  return stopAt - s.t0;
}

/** Convenience: milliseconds → seconds, so registry entries can be read
 *  straight against the inventory's `dur` / envelope columns. */
export const ms = (n: number) => n / 1000;
