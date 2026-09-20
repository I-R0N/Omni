/** Streamed score layers through one Music bus. The exploration bed keeps its
 * place while a non-repeating battle playlist follows hostile presence. */
interface MusicTrack {
  file: string;
  media: HTMLAudioElement;
  gain: GainNode;
  error: string | null;
  loaded: boolean;
}

export class BackgroundMusic {
  private readonly ambient: MusicTrack;
  private readonly battleTracks: MusicTrack[];
  private battleIndex = -1;
  private pauseTimer: ReturnType<typeof setTimeout> | undefined;
  private enabled = true;
  private active = false;
  private combat = false;

  constructor(private ctx: AudioContext, destination: AudioNode) {
    this.ambient = this.makeTrack('space-ambient.mp3', destination, true);
    this.battleTracks = [
      'fly-battle.mp3',
      'tracers-battle.mp3',
      'countdown-battle.mp3',
    ].map(file => this.makeTrack(file, destination, false));
  }

  private makeTrack(file: string, destination: AudioNode, loop: boolean): MusicTrack {
    const media = new Audio();
    // Score is intentionally opt-in.  Four long tracks must not compete with
    // the game bundle before a player has started a run.
    media.preload = 'none';
    media.loop = loop;
    media.setAttribute('playsinline', '');
    const track: MusicTrack = { file, media, gain: this.ctx.createGain(), error: null, loaded: false };
    track.gain.gain.value = 0;
    media.addEventListener('error', () => { track.error = media.error?.message || `${file} unavailable`; });
    if (!loop) media.addEventListener('ended', () => {
      if (track === this.currentBattle && this.enabled && this.active && this.combat) this.startNextBattle();
    });
    this.ctx.createMediaElementSource(media).connect(track.gain);
    track.gain.connect(destination);
    return track;
  }

  /** Attach only when the layer is actually needed.  Standalone builds use the
   * same path, but receive their data URI from the inlined asset catalog. */
  private ensureLoaded(track: MusicTrack, preload = false) {
    if (track.loaded) return;
    const inline = (globalThis as { __omniAudioInline?: Record<string, string> }).__omniAudioInline;
    track.media.preload = preload ? 'metadata' : 'none';
    track.media.src = inline?.[track.file] ?? `/assets/audio/${track.file}`;
    track.loaded = true;
    if (preload) track.media.load();
  }

  /** Call directly from the same gesture that unlocks Web Audio. */
  public resume() {
    if (!this.enabled || document.hidden) return;
    clearTimeout(this.pauseTimer);
    this.rampMix();
    this.play(this.ambient);
    if (this.combat) {
      if (this.currentBattle) this.play(this.currentBattle);
      else this.startNextBattle();
    }
  }

  public setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) this.resume();
    else {
      clearTimeout(this.pauseTimer);
      this.ramp(this.ambient.gain, 0, 0.025);
      this.ramp(this.battleGain, 0, 0.025);
      this.pauseTimer = setTimeout(() => {
        this.ambient.media.pause();
        this.battleTracks.forEach(track => track.media.pause());
      }, 160);
    }
  }

  public setActive(active: boolean) {
    this.active = active;
    if (this.enabled && !document.hidden) this.rampMix();
    if (active && this.enabled && this.combat && !this.currentBattle) this.startNextBattle();
  }

  /** Idempotent; GameEngine may report the current combat state every frame. */
  public setCombat(combat: boolean) {
    if (this.combat === combat) return;
    this.combat = combat;
    if (this.enabled && !document.hidden) this.rampMix();
    if (combat && this.enabled && this.active) this.startNextBattle();
  }

  public suspend() {
    clearTimeout(this.pauseTimer);
    this.ambient.media.pause();
    this.battleTracks.forEach(track => track.media.pause());
    this.ramp(this.ambient.gain, 0, 0);
    this.ramp(this.battleGain, 0, 0);
  }

  private rampMix() {
    const playing = this.active;
    this.ramp(this.ambient.gain, playing ? (this.combat ? 0.12 : 0.28) : 0.15, 0.8);
    this.ramp(this.battleGain, playing && this.combat ? 0.34 : 0, this.combat ? 0.75 : 1.6);
  }

  private get currentBattle(): MusicTrack | null { return this.battleTracks[this.battleIndex] ?? null; }
  private get battleGain(): GainNode { return this.currentBattle?.gain ?? this.battleTracks[0].gain; }

  private startNextBattle() {
    const previous = this.currentBattle;
    if (previous) { previous.media.pause(); previous.media.currentTime = 0; }
    this.battleIndex = (this.battleIndex + 1) % this.battleTracks.length;
    const next = this.currentBattle!;
    next.media.currentTime = 0;
    this.ramp(next.gain, this.active && this.combat ? 0.34 : 0, 0.12);
    this.play(next);
    // Metadata for one successor hides the hand-off without downloading the
    // whole battle catalog on the title screen.
    const successor = this.battleTracks[(this.battleIndex + 1) % this.battleTracks.length];
    this.ensureLoaded(successor, true);
  }

  private play(track: MusicTrack) {
    this.ensureLoaded(track);
    if (track.media.paused) void track.media.play().catch(() => {
      // Autoplay/interruption recovery retries on the next real gesture.
    });
  }

  private ramp(gain: GainNode, value: number, seconds: number) {
    const now = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(value, now, Math.max(seconds, 0.001));
  }

  public get playing(): boolean { return !this.ambient.media.paused && this.ambient.media.readyState >= 2; }
  public get battlePlaying(): boolean { return !!this.currentBattle && !this.currentBattle.media.paused && this.currentBattle.media.readyState >= 2; }
  public get battleActive(): boolean { return this.active && this.combat; }
  public get battleTrackIndex(): number { return this.battleIndex; }
  public get currentTime(): number { return this.ambient.media.currentTime; }
  public get error(): string | null { return this.ambient.error || this.battleTracks.find(track => track.error)?.error || null; }
}
