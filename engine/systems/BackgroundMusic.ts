/** A streamed score, not a decoded ten-minute PCM buffer. Music keeps its
 * place across menus, pause and mute. All gain still runs through the mixer. */
export class BackgroundMusic {
  private readonly media: HTMLAudioElement;
  private readonly gain: GainNode;
  private pauseTimer: ReturnType<typeof setTimeout> | undefined;
  private enabled = true;
  private active = false;
  public error: string | null = null;

  constructor(private ctx: AudioContext, destination: AudioNode) {
    this.media = new Audio();
    this.media.preload = 'none';
    this.media.loop = true;
    this.media.setAttribute('playsinline', '');
    const inline = (globalThis as { __omniAudioInline?: Record<string, string> }).__omniAudioInline;
    this.media.src = inline?.['space-ambient.mp3'] ?? '/assets/audio/space-ambient.mp3';
    this.media.addEventListener('error', () => { this.error = this.media.error?.message || 'Music unavailable'; });
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    const source = ctx.createMediaElementSource(this.media);
    source.connect(this.gain);
    this.gain.connect(destination);
  }

  /** Call directly from the same gesture that unlocks Web Audio. */
  public resume() {
    if (!this.enabled || document.hidden) return;
    clearTimeout(this.pauseTimer);
    this.ramp(this.active ? 0.28 : 0.15, 0.8);
    if (this.media.paused) void this.media.play().catch(() => {
      // Autoplay/interruption recovery retries on the next real gesture.
    });
  }

  public setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) this.resume();
    else {
      clearTimeout(this.pauseTimer);
      this.ramp(0, 0.025);
      this.pauseTimer = setTimeout(() => this.media.pause(), 160);
    }
  }

  public setActive(active: boolean) {
    this.active = active;
    if (this.enabled && !document.hidden) this.ramp(active ? 0.28 : 0.15, 0.8);
  }

  public suspend() {
    clearTimeout(this.pauseTimer);
    this.media.pause();
    this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
  }

  private ramp(value: number, seconds: number) {
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setTargetAtTime(value, now, seconds);
  }

  public get playing(): boolean { return !this.media.paused && this.media.readyState >= 2; }
  public get currentTime(): number { return this.media.currentTime; }
}
