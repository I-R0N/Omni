import { SfxId, SFX_DEFS, SfxDef, AUDIO_CONSTANTS } from '../../constants';

/**
 * AudioSystem — the game's entire sound layer (Phase 3 Pair B).
 *
 * Deliberately SYNTHESIZED: every effect is built from oscillators and a
 * shared noise buffer at play time, so there is no asset pipeline, nothing to
 * download, and nothing to keep in sync with `assets.ts`.  A sound is a row in
 * `SFX_DEFS` (constants) describing a tone sweep, a noise burst, or both —
 * config-as-code exactly like the rest of the game's tuning.
 *
 * Three things this has to get right, and each is why the corresponding piece
 * of machinery exists:
 *
 *  1. **Mobile autoplay.**  A browser will not start an AudioContext outside a
 *     user gesture, and on iOS a context created too early is born `suspended`
 *     and stays that way.  So the context is created LAZILY on the first real
 *     gesture (`unlock`, wired to pointer/key/touch listeners that remove
 *     themselves) — before that every `play()` is a cheap no-op.
 *
 *  2. **Voice storms.**  A cluster kill, a shotgun cone, or a shard field
 *     collapsing can raise the same event dozens of times in one frame.  Each
 *     def carries a `minGap` (identical sounds inside it are dropped) and the
 *     system enforces a global concurrent-voice cap, so audio degrades by
 *     thinning rather than by clipping into a wall of noise.
 *
 *  3. **Cost.**  Nodes are created per shot and disposed by their own `onended`
 *     — no pooling, because a WebAudio node is cheap and pooling oscillators is
 *     famously not worth it — but the voice cap bounds how many can exist.
 *
 * The system owns NO game state; GameEngine calls `play(id)` at event sites.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Shared white-noise buffer — built once when the context comes up. */
  private noise: AudioBuffer | null = null;

  /** 0..1 user volume, and the mute flag.  Both live here and are surfaced
   *  through EngineStats; there is no persistence anywhere in this game. */
  private volume: number = AUDIO_CONSTANTS.DEFAULT_VOLUME;
  private muted: boolean = false;

  /** Last play time per sfx id (context seconds) for the per-def `minGap`. */
  private lastPlayed: Map<SfxId, number> = new Map();
  /** Live voice count, decremented by each voice's own `onended`. */
  private voices = 0;
  private unlockBound = false;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Arm the gesture listeners.  Safe to call more than once.  No AudioContext
   *  is created here — that waits for a real gesture (see the class note). */
  public arm() {
    if (this.unlockBound || typeof window === 'undefined') return;
    this.unlockBound = true;
    const unlock = () => {
      this.ensureContext();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
  }

  /** True once audio is actually able to make sound (surfaced to the UI so the
   *  settings row can say "tap to enable" before the first gesture). */
  public get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  public get volumeLevel(): number { return this.volume; }
  public get isMuted(): boolean { return this.muted; }

  public setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyMasterGain();
  }

  public setMuted(m: boolean) {
    this.muted = m;
    this.applyMasterGain();
  }

  public toggleMute() { this.setMuted(!this.muted); }

  private applyMasterGain() {
    if (!this.master || !this.ctx) return;
    const g = this.muted ? 0 : this.volume * AUDIO_CONSTANTS.MASTER_CEILING;
    this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.02);
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) {
      // Safari/iOS can suspend the context again when the page is backgrounded.
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const Ctor: typeof AudioContext | undefined =
      (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyMasterGain();
      this.noise = this.buildNoise(this.ctx);
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
      this.master = null;
    }
    return this.ctx;
  }

  /** One second of white noise, reused (with playbackRate/offset variation) by
   *  every noise-based effect. */
  private buildNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * AUDIO_CONSTANTS.NOISE_BUFFER_SEC);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  /**
   * Play one effect.  A no-op before the first gesture, while muted, inside the
   * def's `minGap`, or over the voice cap — every early-out is cheap, so
   * hot-path call sites can fire unconditionally.
   *
   * `gain` scales the def's own level (callers use it for damage-scaled hits);
   * `detune` (in semitones) varies the pitch so repeated sounds don't comb.
   */
  public play(id: SfxId, opts?: { gain?: number; detune?: number }) {
    if (this.muted || this.volume <= 0) return;
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const def = SFX_DEFS[id];
    if (!def) return;

    const now = ctx.currentTime;
    const last = this.lastPlayed.get(id);
    if (last !== undefined && now - last < def.minGap) return;
    if (this.voices >= AUDIO_CONSTANTS.MAX_VOICES) return;
    this.lastPlayed.set(id, now);

    const level = def.gain * (opts?.gain ?? 1);
    // Random per-shot detune keeps repeats from sounding mechanical; the
    // caller can bias it too (e.g. pitch a boss explosion down).
    const semis = (Math.random() * 2 - 1) * def.detuneVar + (opts?.detune ?? 0);
    const rate = Math.pow(2, semis / 12);

    if (def.tone) this.playTone(ctx, def, level, rate, now);
    if (def.noise) this.playNoise(ctx, def, level, rate, now);
  }

  /** Oscillator sweep: `from` → `to` Hz over `dur`, with a percussive decay. */
  private playTone(ctx: AudioContext, def: SfxDef, level: number, rate: number, now: number) {
    const t = def.tone!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = t.wave;
    osc.frequency.setValueAtTime(t.from * rate, now);
    // Exponential ramps can't touch 0, hence the floor.
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, t.to * rate), now + def.dur);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(level, now + Math.min(def.attack, def.dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, now + def.dur);
    osc.connect(g);
    g.connect(this.master!);
    this.voices++;
    osc.onended = () => { this.voices--; osc.disconnect(); g.disconnect(); };
    osc.start(now);
    osc.stop(now + def.dur);
  }

  /** Filtered noise burst — the body of every impact, explosion and thruster
   *  sound.  A sweeping lowpass is what makes it read as "debris" rather than
   *  "static". */
  private playNoise(ctx: AudioContext, def: SfxDef, level: number, rate: number, now: number) {
    const n = def.noise!;
    if (!this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    // Start at a random offset so successive bursts aren't the same waveform.
    const offset = Math.random() * AUDIO_CONSTANTS.NOISE_BUFFER_SEC * 0.9;
    const filt = ctx.createBiquadFilter();
    filt.type = n.type;
    filt.frequency.setValueAtTime(n.from * rate, now);
    filt.frequency.exponentialRampToValueAtTime(Math.max(40, n.to * rate), now + def.dur);
    filt.Q.value = n.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(level * n.level, now + Math.min(def.attack, def.dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, now + def.dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master!);
    this.voices++;
    src.onended = () => { this.voices--; src.disconnect(); filt.disconnect(); g.disconnect(); };
    src.start(now, offset);
    src.stop(now + def.dur);
  }
}
