/** Streamed score layers through one Music bus.  The exploration bed keeps its
 * place; the battle playlist runs CONTINUOUSLY once opened and is only ever
 * ducked, never rewound — see `setCombat`. */
interface MusicTrack {
  file: string;
  media: HTMLAudioElement;
  gain: GainNode;
  error: string | null;
  loaded: boolean;
}

/** Mix levels.  The ambient bed ducks under the battle layer rather than
 *  stopping, so the score never has a hole in it. */
const AMBIENT_MENU = 0.15;
const AMBIENT_EXPLORE = 0.28;
const AMBIENT_DUCKED = 0.12;
const BATTLE_LEVEL = 0.34;
/** Gain ramp time CONSTANTS (`setTargetAtTime`), not durations. */
const FADE_IN_SEC = 0.75;
/** HALVED from 1.6 (user call).  This is the ONE fade-out in the score, so
 *  every instance the call named rides it: leaving an arena, opening the
 *  pause menu, returning to the menu, and an ordinary fight ending.  An
 *  exponential approach is ~95% done after three time constants, so the
 *  audible tail went ~4.8 s → ~2.4 s.  The ambient bed is deliberately NOT
 *  direction-aware: its downward move is a DUCK between two audible levels
 *  (EXPLORE → MENU or → DUCKED), not a fade to silence, and routing it here
 *  would make it SLOWER than the FADE_IN_SEC it takes today. */
const FADE_OUT_SEC = 0.8;
/** Ramp used when a track hands over to the next at its own end — short,
 *  because nothing is being ducked, one song simply becomes another. */
const HANDOVER_SEC = 0.12;
/** When to actually pause a ducked battle track.  An exponential approach is
 *  ~95% of the way there after three time constants, which on a 0.34 layer
 *  leaves 0.017 under a 0.12 ambient bed — inaudible.  Pausing is what makes
 *  the resume land on the same bar, so it has to wait for the fade to be over
 *  rather than race it. */
const BATTLE_PAUSE_DELAY_MS = FADE_OUT_SEC * 3 * 1000;

export class BackgroundMusic {
  private readonly ambient: MusicTrack;
  private readonly battleTracks: MusicTrack[];
  /** -1 until the playlist is opened for the first time.  After that it only
   *  ever moves in `advanceBattle`, i.e. when a song ends. */
  private battleIndex = -1;
  private pauseTimer: ReturnType<typeof setTimeout> | undefined;
  private battlePauseTimer: ReturnType<typeof setTimeout> | undefined;
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
    // THE ONLY TRACK CHANGE THERE IS.  A ducked track is paused, so `ended`
    // cannot fire while the layer is silent either: a song is never skipped
    // past while nobody is listening to it.
    if (!loop) media.addEventListener('ended', () => {
      if (track === this.currentBattle && this.enabled) this.advanceBattle();
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
    this.syncBattlePlayback();
  }

  public setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) this.resume();
    else {
      clearTimeout(this.pauseTimer);
      clearTimeout(this.battlePauseTimer);
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
    this.syncBattlePlayback();
  }

  /**
   * Is the player IN a fight right now?  This is a DUCKING signal and nothing
   * else: it decides whether the battle layer is audible, never which track is
   * playing or where in it we are.
   *
   * It used to open the playlist afresh on every rising edge, so the field
   * going quiet between waves — which it does on every clear — cut the song
   * and started the next one.  A wave sequence is one continuous encounter,
   * so the playlist is opened ONCE and thereafter only ever fades out (and
   * pauses, holding its position) and fades back in where it left off.
   *
   * Idempotent; GameEngine may report the current state every frame.
   */
  public setCombat(combat: boolean) {
    if (this.combat === combat) return;
    this.combat = combat;
    if (this.enabled && !document.hidden) this.rampMix();
    this.syncBattlePlayback();
  }

  /**
   * CUT TO A NEW SONG, NOW.  Always a DIFFERENT track from the one it
   * interrupts and always from the top, however much of the playlist has
   * already been heard.
   *
   * TWO CALLERS, and they are the same statement: A NEW ENCOUNTER BEGINS.
   * A capstone warping in is a designed beat with its own rift, banner and
   * stinger, and the score is part of that beat (user call).  A MAP CHANGE is
   * the other (user report: re-entering an arena resumed the previous song
   * mid-phrase) — the continuous-playlist rule is drawn around one arena's
   * wave ladder, so the map boundary is where it ends rather than an
   * exception to it.
   *
   * Neither is an "override" of the playlist: everywhere INSIDE an encounter
   * a track still runs to its own end, and a lull still only ducks.
   *
   * This is where boss-specific music lands when there is some: the CALL SITE
   * says "a boss arrived" and nothing more, so choosing from a boss list here
   * moves no engine code.
   *
   * If the layer is not audible yet — a boss warping in the frame before the
   * engine reports the fight — the track is armed at 0 and the next
   * engagement starts it there, which is the same hand-off `advanceBattle`
   * makes for a song that ends while ducked.
   */
  public cueBattleTrack() {
    this.advanceBattle();
  }

  public suspend() {
    clearTimeout(this.pauseTimer);
    clearTimeout(this.battlePauseTimer);
    // Positions are deliberately left alone — a tab returning from hidden
    // resumes the score rather than restarting it.
    this.ambient.media.pause();
    this.battleTracks.forEach(track => track.media.pause());
    this.ramp(this.ambient.gain, 0, 0);
    this.ramp(this.battleGain, 0, 0);
  }

  private rampMix() {
    const playing = this.active;
    const ambient = playing ? (this.combat ? AMBIENT_DUCKED : AMBIENT_EXPLORE) : AMBIENT_MENU;
    this.ramp(this.ambient.gain, ambient, FADE_IN_SEC);
    this.ramp(this.battleGain, this.battleLevel, this.combat ? FADE_IN_SEC : FADE_OUT_SEC);
  }

  /** Start or stop the battle MEDIA to match the mix.  Splitting this from
   *  `rampMix` is the whole feature: the gain says how loud, this says where
   *  in the song, and only the first of those may change on a lull. */
  private syncBattlePlayback() {
    clearTimeout(this.battlePauseTimer);
    if (this.audibleBattle) {
      // First engagement of the run opens the playlist; every later one
      // resumes whatever was already playing, at its own position.
      if (this.battleIndex < 0) this.openBattlePlaylist();
      const track = this.currentBattle;
      if (track) this.play(track);
      return;
    }
    const track = this.currentBattle;
    if (!track || track.media.paused) return;
    // Pause only once the fade is over.  Pausing is what holds the position,
    // and doing it early would clip the fade the player is listening to.
    this.battlePauseTimer = setTimeout(() => track.media.pause(), BATTLE_PAUSE_DELAY_MS);
  }

  private get audibleBattle(): boolean {
    return this.enabled && this.active && this.combat && !document.hidden;
  }

  private get battleLevel(): number { return this.active && this.combat ? BATTLE_LEVEL : 0; }
  private get currentBattle(): MusicTrack | null { return this.battleTracks[this.battleIndex] ?? null; }
  private get battleGain(): GainNode { return this.currentBattle?.gain ?? this.battleTracks[0].gain; }

  /** The one place the playlist starts from nothing. */
  private openBattlePlaylist() {
    this.battleIndex = 0;
    this.ramp(this.currentBattle!.gain, this.battleLevel, FADE_IN_SEC);
    this.preloadSuccessor();
  }

  /** The one place a track CHANGES — reached only from a track's own `ended`. */
  private advanceBattle() {
    const previous = this.currentBattle;
    if (previous) {
      previous.media.pause();
      previous.media.currentTime = 0;
      // A paused node left at full gain is a click waiting for the playlist
      // to come round to it again.
      this.ramp(previous.gain, 0, 0.05);
    }
    this.battleIndex = (this.battleIndex + 1) % this.battleTracks.length;
    const next = this.currentBattle!;
    next.media.currentTime = 0;
    this.ramp(next.gain, this.battleLevel, HANDOVER_SEC);
    this.preloadSuccessor();
    // A song that ends while the layer is ducked hands over silently and the
    // successor waits, paused at 0, for the next engagement.
    if (this.audibleBattle) this.play(next);
  }

  /** Metadata for one successor hides the hand-off without downloading the
   *  whole battle catalog on the title screen. */
  private preloadSuccessor() {
    this.ensureLoaded(this.battleTracks[(this.battleIndex + 1) % this.battleTracks.length], true);
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
  /** Where the battle layer is IN its song — the quantity a lull must not
   *  move.  Exposed so the suite can pin "resumes, not restarts". */
  public get battleCurrentTime(): number { return this.currentBattle?.media.currentTime ?? 0; }
  public get currentTime(): number { return this.ambient.media.currentTime; }
  public get error(): string | null { return this.ambient.error || this.battleTracks.find(track => track.error)?.error || null; }
}
