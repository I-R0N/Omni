/**
 * THE ADAPTIVE SCORE — vertical layering on one musical clock.
 *
 * Each SONG is one piece of music split into six synchronised stems — "Omni"
 * (D minor, 128 BPM, 60 s), "Event Horizon" (E minor, 160 BPM, 48 s) and
 * "Critical Mass" (C minor, 150 BPM half-time, 51.2 s, the guitar-forward one);
 * one is resident at a time and a map change rotates to the next (SONGS,
 * `switchSong`).  Every stem loops forever from the
 * moment the score starts, sample-locked to the same AudioContext clock, and
 * the game decides only how LOUD each one is.  Intensity therefore never
 * changes WHERE the music is — a heavier layer joins the song already
 * playing, on the beat it is already on.
 *
 *   atmos   pads, drone, bells — the exploration bed; always on
 *   pulse   plucked arpeggio, hats, a soft heartbeat — something is near
 *   groove  palm-muted gallop guitar, kick, snare, bass — engaged
 *   heavy   double-tracked metal rhythm guitars, double kick — under pressure
 *   apex    the theme on harmonised lead guitar, choir — the fight at its peak
 *   boss    drop-D guitar + low-brass ostinato, taiko — a capstone is on the field
 *
 * HOW A LAYER MOVES.  The engine reports a THREAT snapshot every frame
 * (`setThreat`).  That folds into one smoothed 0..1 INTENSITY: fast to rise,
 * held for a few seconds once it peaks, slow to fall.  Each layer has an
 * on-threshold and a lower off-threshold (hysteresis), so intensity hovering
 * at a boundary cannot pump a layer.  An ENTRY is quantised to the musical
 * grid — drums land on a downbeat, never mid-bar — and the groove's entry is
 * announced by a riser that ends exactly on that downbeat.  Exits begin on
 * the next beat and fade.
 *
 * HOW THE MUSIC JUMPS.  `cueEncounter` is the one horizontal move: at the
 * next bar line every stem cuts (short crossfade) back to bar 1, so a new
 * arena or a boss's arrival starts a new phrase rather than joining the old
 * one mid-sentence.  A boss arrival also lands an impact hit on that downbeat.
 *
 * WHY DECODED BUFFERS.  Sample-accurate sync between stems needs every stem
 * on the AudioContext clock; separate <audio> elements drift.  Stems decode
 * at `DECODE_RATE` (32 kHz — the music bus never needs more, and it is a
 * third less memory than 48 kHz) through an OfflineAudioContext; the source
 * node resamples on playback.  Only the exploration bed is fetched on the
 * title screen; the combat stems arrive when a run starts and the boss stem
 * when a boss first appears.
 *
 * WHY THE LOOP IS CODEC-PROOF.  Each file is the steady-state loop with
 * `LOOP_START` seconds of lead-in and ~1.5 s of run-out, and is exactly
 * periodic, so ANY window [s, s + one loop] with s inside that margin loops
 * seamlessly.  An MP3 decoder that does or does not trim encoder delay only
 * shifts every stem by the same few milliseconds; nothing clicks.
 */

export type MusicLayerId = 'atmos' | 'pulse' | 'groove' | 'heavy' | 'apex' | 'boss';

/** What the engine knows about the fight, reported every frame. */
export interface MusicThreat {
  /** A hostile within `MUSIC_ALERT_SCREENS` — approaching, not yet engaged. */
  alert: boolean;
  /** Sum of nearby hostiles' weights (heavier and closer count for more). */
  pressure: number;
  /** A live boss is on the field. */
  boss: boolean;
  /** Hull fraction 0..1. */
  hull: number;
  /** (hull + shield) / (max hull + max shield), 0..1 — damage is read from
   *  this falling, so no damage path anywhere has to report itself. */
  ehp: number;
}

/** A SONG is one complete set of stems on its own grid.  The engine holds
 *  exactly one in memory; a map change can rotate to the next (see
 *  `cueEncounter`).  Files are `${prefix}${layer}.mp3` (+ `${prefix}riser`);
 *  the impact is shared. */
export interface SongSpec { id: string; title: string; bpm: number; bars: number; prefix: string }
export const SONGS: readonly SongSpec[] = [
  { id: 'omni', title: 'Omni', bpm: 128, bars: 32, prefix: 'score-' },
  { id: 'event-horizon', title: 'Event Horizon', bpm: 160, bars: 32, prefix: 'score2-' },
  { id: 'critical-mass', title: 'Critical Mass', bpm: 150, bars: 32, prefix: 'score3-' },
];

export const SCORE = {
  /** Seconds of lead-in before bar 1 in every stem file. */
  LOOP_START: 0.5,
  DECODE_RATE: 32000,
  /** Output gain of the whole score into the Music bus.  Sets exploration
   *  (atmos alone, mastered at −20 LUFS) where the old ambient bed sat. */
  OUTPUT: 0.53,
} as const;

interface LayerSpec {
  id: MusicLayerId;
  /** Intensity at which the layer comes in, and the lower one at which it
   *  leaves (hysteresis).  Ignored by atmos (always on) and boss (gated). */
  on: number;
  off: number;
  /** Grid the ENTRY waits for. */
  enter: 'beat' | 'bar';
  /** setTargetAtTime constants: ~95% of the move takes 3×. */
  enterTau: number;
  exitTau: number;
  /** Crossfade for a `cueEncounter` jump.  Short for drums (a long overlap
   *  between two positions flams), long for sustained pads. */
  jumpFade: number;
  /** Fetched with the combat set at run start (vs lazily on demand). */
  combat: boolean;
}

const LAYERS: readonly LayerSpec[] = [
  { id: 'atmos',  on: -1,   off: -1,   enter: 'beat', enterTau: 0.9,   exitTau: 1.2, jumpFade: 0.35, combat: false },
  { id: 'pulse',  on: 0.18, off: 0.12, enter: 'beat', enterTau: 0.35,  exitTau: 1.4, jumpFade: 0.03, combat: true },
  { id: 'groove', on: 0.38, off: 0.30, enter: 'bar',  enterTau: 0.012, exitTau: 0.9, jumpFade: 0.02, combat: true },
  { id: 'heavy',  on: 0.62, off: 0.54, enter: 'bar',  enterTau: 0.012, exitTau: 0.7, jumpFade: 0.02, combat: true },
  { id: 'apex',   on: 0.82, off: 0.72, enter: 'beat', enterTau: 0.12,  exitTau: 0.9, jumpFade: 0.15, combat: true },
  { id: 'boss',   on: 0,    off: 0,    enter: 'bar',  enterTau: 0.012, exitTau: 1.3, jumpFade: 0.02, combat: false },
];

type OneShotId = 'riser' | 'impact';
/** Shared by every song. */
const IMPACT_FILE = 'score-impact.mp3';

/** atmos level by state.  It ducks once the groove is in so the pads do not
 *  smear the drums, but never leaves: the score has no holes. */
const ATMOS_MENU = 0.55;
const ATMOS_EXPLORE = 1.0;
const ATMOS_COMBAT = 0.7;

/** Intensity model.  Floors per state, then pressure / damage / low hull on
 *  top.  See `targetIntensity`. */
const FLOOR_EXPLORE = 0.05;
const FLOOR_ALERT = 0.22;
const FLOOR_COMBAT = 0.42;
const FLOOR_BOSS = 0.62;
const PRESSURE_SCALE = 2.5;   // weight at which pressure reaches ~63%
const DAMAGE_FULL = 0.12;     // losing 12% of max EHP within ~1.5 s = full
const DAMAGE_DECAY_SEC = 1.5;
const LOW_HULL = 0.4;         // low-hull term starts here…
const CRIT_HULL = 0.15;       // …and is full here
const RISE_SEC = 0.25;
const HOLD_SEC = 3.5;
const FALL_SEC = 2.2;
/** Scheduling slack: an entry is never placed closer than this to "now". */
const LOOKAHEAD = 0.03;
/** At most one impact on a heavy entry per this many bars. */
const IMPACT_COOLDOWN_BARS = 8;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mod = (a: number, n: number) => ((a % n) + n) % n;

interface Layer {
  spec: LayerSpec;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
  sourceGain: GainNode | null;
  on: boolean;
}

type OfflineCtor = new (channels: number, length: number, rate: number) => OfflineAudioContext;

export class AdaptiveMusic {
  private readonly out: GainNode;
  private readonly fx: GainNode;
  private readonly layers = new Map<MusicLayerId, Layer>();
  private readonly buffers = new Map<string, AudioBuffer>();
  /** In-flight fetches, by FILE (two songs never share a key). */
  private readonly loading = new Set<string>();
  private songIdx = 0;
  /** 'auto' rotates songs on each map change; a number pins that song. */
  private _songMode: 'auto' | number = 'auto';
  /** Bumped by every song switch; a decode from an older song that lands
   *  late is discarded rather than mixed into the new one. */
  private generation = 0;
  /** A switch stops the old song on a schedule; the new one may not start
   *  before then. */
  private resumeAt = 0;
  private readonly errors: string[] = [];

  private enabled = true;
  private active = false;
  private combat = false;
  private threat: MusicThreat = { alert: false, pressure: 0, boss: false, hull: 1, ehp: 1 };

  /** Context time at which loop position 0 (bar 1's downbeat) fell. */
  private t0 = 0;
  private running = false;
  /** Loop position held while stopped (mute / music volume 0). */
  private held = 0;
  /** A pending bar-1 jump: no layer may start before it. */
  private jumpAt = -Infinity;

  private _intensity = 0;
  private _target = 0;
  private holdUntil = 0;
  private lastTick = 0;
  private damage = 0;
  private lastEhp: number | null = null;
  private atmosLevel = -1;
  private lastImpactAt = -Infinity;
  private _jumps = 0;
  private combatRequested = false;
  /** Debug: pin the intensity (null = follow the game). */
  private forced: number | null = null;

  constructor(private readonly ctx: AudioContext, destination: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.value = SCORE.OUTPUT;
    this.out.connect(destination);
    this.fx = ctx.createGain();
    this.fx.gain.value = 1;
    this.fx.connect(this.out);
    for (const spec of LAYERS) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.out);
      this.layers.set(spec.id, { spec, gain, source: null, sourceGain: null, on: false });
    }
  }

  // ── public control surface (AudioSystem) ─────────────────────────────────

  /** Call from the gesture that unlocks Web Audio, and on every later one. */
  public resume() {
    if (!this.enabled || document.hidden) return;
    this.load('atmos');
    this.startTransport();
    this.evaluate();
  }

  public setEnabled(enabled: boolean) {
    if (this.enabled === enabled) { if (enabled) this.resume(); return; }
    this.enabled = enabled;
    const now = this.ctx.currentTime;
    if (enabled) {
      this.fade(this.out.gain, SCORE.OUTPUT, now, 0.05);
      this.resume();
    } else {
      // Hold the place, fade, stop.  Re-enabling resumes on the same beat.
      this.fade(this.out.gain, 0, now, 0.025);
      this.stopTransport(now + 0.16);
    }
  }

  public setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    if (active && !this.combatRequested) {
      // A run has started: fetch the combat set now, in the background, so
      // the first engagement has its drums.  Not on the title screen.
      this.combatRequested = true;
      for (const s of LAYERS) if (s.combat) this.load(s.id);
      this.load('riser');
      this.load('impact');
    }
    this.evaluate();
  }

  /** The proximity gate (with its linger).  The floor under the groove. */
  public setCombat(combat: boolean) {
    if (this.combat === combat) return;
    this.combat = combat;
    this.evaluate();
  }

  public setThreat(t: MusicThreat) {
    const now = performance.now() / 1000;
    const dt = this.lastTick ? Math.min(0.25, Math.max(0, now - this.lastTick)) : 0;
    this.lastTick = now;
    // Damage is the EHP fraction FALLING.  Rising (repairs, a respawn, a
    // refit) is ignored, so nothing but real hits drives the meter.
    if (this.lastEhp !== null && t.ehp < this.lastEhp) this.damage += this.lastEhp - t.ehp;
    this.lastEhp = t.ehp;
    this.damage *= Math.exp(-dt / DAMAGE_DECAY_SEC);
    if (t.boss && !this.threat.boss) this.load('boss');
    this.threat = t;
    this.smooth(dt, now);
    this.evaluate();
  }

  /**
   * A NEW ENCOUNTER: a map load ('map' — run start, restart, menu pick), a
   * portal transit ('portal' — also rotates to the next song in AUTO), or a
   * boss warping in.  At the next bar
   * line every stem crossfades back to bar 1, so the encounter opens a
   * phrase.  Layers keep their levels — the fight decides those — and a boss
   * also lands an impact on that downbeat.
   */
  public cueEncounter(kind: 'map' | 'portal' | 'boss') {
    this._jumps++;
    if (kind === 'boss') this.load('boss');
    if (kind !== 'boss') {
      // LEAVING IS NOT A LULL.  The hold that carries the stack through a
      // wave clear would otherwise keep the drums up for seconds after a
      // portal out of a fight (the old "battle music followed me to the hub"
      // report).  The encounter is over: drop straight to the new map's own
      // picture and let its first engagement build back up.
      this._intensity = 0;
      this.holdUntil = 0;
      this.damage = 0;
      this.evaluate();
    }
    if (kind !== 'boss') {
      // A PORTAL rotates to the next song (in AUTO); any map load honours a pin.
      const auto = this._songMode === 'auto';
      const want = auto ? (kind === 'portal' ? (this.songIdx + 1) % SONGS.length : this.songIdx) : this._songMode as number;
      // A NEW SONG STARTS AT BAR 1 BY CONSTRUCTION, so a switch is the jump.
      if (this.switchSong(want)) return;
    }
    if (!this.running) { this.held = 0; return; }
    const at = this.nextGrid(this.barSec);
    const now = this.ctx.currentTime;
    this.t0 = at;
    this.jumpAt = at;
    for (const layer of this.layers.values()) {
      if (!layer.source || !layer.sourceGain) continue;
      const fade = layer.spec.jumpFade;
      const old = layer.source, oldGain = layer.sourceGain;
      oldGain.gain.cancelScheduledValues(now);
      oldGain.gain.setValueAtTime(1, Math.max(now, at - fade));
      oldGain.gain.linearRampToValueAtTime(0, at + fade);
      old.stop(at + fade + 0.05);
      layer.source = null;
      layer.sourceGain = null;
      this.startSource(layer, at, fade);
    }
    if (kind === 'boss') this.playOneShot('impact', at);
  }

  /** Debug: 'auto' rotates on map changes; a song index pins (and switches
   *  to) that song now. */
  public setSongMode(mode: 'auto' | number) {
    this._songMode = mode;
    if (mode !== 'auto') this.switchSong(mode);
  }

  /**
   * Replace the resident song.  Fade the output, stop every source on a
   * schedule, DROP the old song's buffers (only one song is ever held — the
   * memory budget is one song's stems), then fetch the new one; it starts at
   * bar 1 when its bed has decoded, no earlier than the old one's stop.
   * Layers restart from off, and `evaluate` brings back whatever the fight
   * still calls for on the new song's grid.  Returns false if `idx` is
   * already playing.
   */
  private switchSong(idx: number): boolean {
    if (idx === this.songIdx || !SONGS[idx]) return false;
    const now = this.ctx.currentTime;
    const stopAt = now + 0.4;
    if (this.running) {
      this.fade(this.out.gain, 0, now, 0.08);
      this.stopTransport(stopAt);
    }
    this.resumeAt = stopAt;
    this.songIdx = idx;
    this.generation++;
    for (const id of [...this.buffers.keys()]) if (id !== 'impact') this.buffers.delete(id);
    this.held = 0;
    this.jumpAt = -Infinity;
    this.atmosLevel = -1;
    for (const layer of this.layers.values()) {
      layer.on = false;
      this.fade(layer.gain.gain, 0, stopAt, 0.001);
    }
    this.load('atmos');
    if (this.combatRequested) {
      for (const sp of LAYERS) if (sp.combat) this.load(sp.id);
      this.load('riser');
    }
    if (this.threat.boss) this.load('boss');
    this.evaluate();
    return true;
  }

  /** Tab hidden: the context is suspended right after this, which freezes
   *  every source in place — nothing to do but forget the smoothing clock. */
  public suspend() { this.lastTick = 0; }

  /** Debug: pin intensity to a value, or null to follow the game. */
  public setDebugIntensity(v: number | null) {
    this.forced = v === null ? null : clamp01(v);
    this.evaluate();
  }

  // ── readouts (tests, debug panel) ─────────────────────────────────────────

  public get playing(): boolean {
    return this.running && this.buffers.has('atmos') && this.ctx.state === 'running';
  }
  /** Seconds into the 60 s loop.  Holds still while stopped. */
  public get position(): number {
    return this.running ? mod(this.ctx.currentTime - this.t0, this.loopSec) : this.held;
  }
  /** How many times the score has been cued back to bar 1 (`cueEncounter`). */
  public get jumps(): number { return this._jumps; }
  public get bar(): number { return Math.floor(this.position / this.barSec) + 1; }
  public get song(): SongSpec { return SONGS[this.songIdx]; }
  public get songMode(): 'auto' | number { return this._songMode; }
  public get intensity(): number { return this.forced ?? this._intensity; }
  public get targetIntensity(): number { return this._target; }
  public get forcedIntensity(): number | null { return this.forced; }
  public isLayerOn(id: MusicLayerId): boolean { return !!this.layers.get(id)?.on; }
  public layerGain(id: MusicLayerId): number { return this.layers.get(id)?.gain.gain.value ?? 0; }
  public get activeLayers(): MusicLayerId[] {
    return LAYERS.filter(s => this.layers.get(s.id)!.on).map(s => s.id);
  }
  public isLoaded(id: MusicLayerId | OneShotId): boolean { return this.buffers.has(id); }
  public get loadedLayers(): MusicLayerId[] { return LAYERS.filter(s => this.buffers.has(s.id)).map(s => s.id); }
  /** Bytes of decoded PCM the score holds right now. */
  public get decodedBytes(): number {
    let b = 0;
    for (const buf of this.buffers.values()) b += buf.length * buf.numberOfChannels * 4;
    return b;
  }
  /** The battle stack is up: the groove is in. */
  public get battleActive(): boolean { return this.isLayerOn('groove'); }
  public get error(): string | null { return this.errors[0] ?? null; }

  /** The resident song's grid. */
  public get beat(): number { return 60 / this.song.bpm; }
  public get barSec(): number { return this.beat * 4; }
  public get loopSec(): number { return this.barSec * this.song.bars; }

  // ── intensity ─────────────────────────────────────────────────────────────

  private targetIntensity_(): number {
    if (!this.active) return 0;
    const t = this.threat;
    let base = FLOOR_EXPLORE;
    if (t.alert) base = FLOOR_ALERT;
    if (this.combat) base = Math.max(base, FLOOR_COMBAT);
    if (t.boss) base = Math.max(base, FLOOR_BOSS);
    const engaged = this.combat || t.boss;
    const pressure = 1 - Math.exp(-Math.max(0, t.pressure) / PRESSURE_SCALE);
    const damage = clamp01(this.damage / DAMAGE_FULL);
    const lowHull = clamp01((LOW_HULL - t.hull) / (LOW_HULL - CRIT_HULL));
    const extra = 0.45 * pressure + 0.35 * damage + 0.2 * lowHull;
    // Before the fight is engaged the extras only colour the alert layer;
    // they cannot by themselves bring the drums in.
    return clamp01(base + extra * (engaged ? 1 : 0.3));
  }

  private smooth(dt: number, now: number) {
    this._target = this.targetIntensity_();
    if (!this.active) { this._intensity = 0; this.holdUntil = 0; return; }
    const i = this._intensity, t = this._target;
    if (t > i) {
      this._intensity = i + (t - i) * (1 - Math.exp(-dt / RISE_SEC));
      this.holdUntil = now + HOLD_SEC;
    } else if (now >= this.holdUntil) {
      this._intensity = i + (t - i) * (1 - Math.exp(-dt / FALL_SEC));
    }
  }

  /** Decide every layer's state and schedule whatever changed. */
  private evaluate() {
    if (!this.active) { this._intensity = 0; this._target = 0; }
    const level = this.intensity;
    for (const layer of this.layers.values()) {
      const s = layer.spec;
      let want: boolean;
      if (s.id === 'atmos') want = true;
      else if (s.id === 'boss') want = this.active && (this.threat.boss || (this.forced ?? 0) >= 0.99);
      else want = this.active && (layer.on ? level >= s.off : level >= s.on);
      if (want !== layer.on) {
        layer.on = want;
        this.scheduleLayer(layer);
      }
    }
    const atmos = !this.active ? ATMOS_MENU
      : this.layers.get('groove')!.on ? ATMOS_COMBAT : ATMOS_EXPLORE;
    if (atmos !== this.atmosLevel) {
      this.atmosLevel = atmos;
      const a = this.layers.get('atmos')!;
      this.fade(a.gain.gain, atmos, this.ctx.currentTime, a.spec.enterTau);
    }
  }

  private scheduleLayer(layer: Layer) {
    const s = layer.spec;
    if (s.id === 'atmos') return;
    const at = layer.on ? this.nextGrid(s.enter === 'bar' ? this.barSec : this.beat) : this.nextGrid(this.beat);
    // A not-yet-begun entry or exit is cancelled by this — which is the point
    // of a layer changing its mind before its grid line arrives.
    this.fade(layer.gain.gain, layer.on ? 1 : 0, at, layer.on ? s.enterTau : s.exitTau);
    if (!layer.on || !this.running) return;
    if (s.id === 'groove') this.playOneShot('riser', at, true);
    if (s.id === 'heavy' && at - this.lastImpactAt > IMPACT_COOLDOWN_BARS * this.barSec) {
      this.lastImpactAt = at;
      this.playOneShot('impact', at);
    }
  }

  /**
   * Move `param` to `target` starting at `at` (an exponential approach with
   * time constant `tau`).  THE START VALUE IS ANCHORED EXPLICITLY: the
   * current value is pinned at `now` and held until `at`, and only then does
   * the approach begin.  A bare `setTargetAtTime` scheduled in the future
   * takes its starting value from whatever the implementation computes for
   * that instant, and not every implementation computes it right — a Web
   * Audio engine used in testing overshot to 10^10 on a 12 ms entry fade.
   * Anchored, every implementation agrees.  The cost: a fade already under
   * way when a layer changes its mind freezes until `at` (at most a bar).
   */
  private fade(param: AudioParam, target: number, at: number, tau: number) {
    const now = this.ctx.currentTime;
    const v = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(v, now);
    if (at > now) param.setValueAtTime(v, at);
    param.setTargetAtTime(target, Math.max(at, now), Math.max(tau, 0.001));
  }

  /** The next beat or bar line at least LOOKAHEAD away. */
  private nextGrid(period: number): number {
    const now = this.ctx.currentTime + LOOKAHEAD;
    if (!this.running) return now;
    const from = Math.max(now, this.jumpAt);
    const n = Math.ceil((from - this.t0) / period - 1e-6);
    return this.t0 + n * period;
  }

  // ── transport ─────────────────────────────────────────────────────────────

  private startTransport() {
    if (this.running || !this.buffers.has('atmos')) return;
    const at = Math.max(this.ctx.currentTime + 0.05, this.resumeAt);
    this.fade(this.out.gain, SCORE.OUTPUT, at, 0.03);
    this.t0 = at - this.held;
    this.running = true;
    this.jumpAt = -Infinity;
    for (const layer of this.layers.values()) this.startSource(layer, at, 0.02);
  }

  private stopTransport(when: number) {
    if (!this.running) return;
    this.held = this.position;
    this.running = false;
    for (const layer of this.layers.values()) {
      if (layer.source) { try { layer.source.stop(when); } catch { /* already stopped */ } }
      layer.source = null;
      layer.sourceGain = null;
    }
  }

  /** Start a layer's loop so that it is exactly in phase with t0. */
  private startSource(layer: Layer, when: number, fade: number) {
    const buf = this.buffers.get(layer.spec.id);
    if (!buf || !this.running || layer.source) return;
    when = Math.max(when, this.jumpAt, this.ctx.currentTime + 0.01);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = SCORE.LOOP_START;
    src.loopEnd = SCORE.LOOP_START + this.loopSec;
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0, 0);
    sg.gain.setValueAtTime(0, Math.max(0, when - fade));
    sg.gain.linearRampToValueAtTime(1, when + fade);
    src.connect(sg);
    sg.connect(layer.gain);
    src.start(when, SCORE.LOOP_START + mod(when - this.t0, this.loopSec));
    layer.source = src;
    layer.sourceGain = sg;
  }

  private playOneShot(id: OneShotId, at: number, endsAt = false) {
    const buf = this.buffers.get(id);
    if (!buf) return;
    const now = this.ctx.currentTime + 0.01;
    let start = endsAt ? at - buf.duration : at;
    let offset = 0;
    if (start < now) {
      offset = now - start;
      // Less than ~40% of a riser left is a blip, not a build — skip it.
      if (endsAt && offset > buf.duration * 0.6) return;
      start = now;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.fx);
    src.start(start, offset);
  }

  // ── loading ───────────────────────────────────────────────────────────────

  private load(id: MusicLayerId | OneShotId) {
    const file = id === 'impact' ? IMPACT_FILE : `${this.song.prefix}${id}.mp3`;
    if (this.buffers.has(id) || this.loading.has(file)) return;
    const gen = this.generation;
    this.loading.add(file);
    void (async () => {
      try {
        const inline = (globalThis as { __omniAudioInline?: Record<string, string> }).__omniAudioInline;
        const res = await fetch(inline?.[file] ?? `/assets/audio/${file}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await this.decode(await res.arrayBuffer());
        // A song switch happened while this was in flight: it belongs to a
        // song that is no longer resident, so drop it.
        if (gen !== this.generation && id !== 'impact') return;
        this.buffers.set(id, buf);
        this.onLoaded(id);
      } catch (e) {
        this.errors.push(`${file}: ${(e as Error)?.message ?? e}`);
      } finally {
        this.loading.delete(file);
      }
    })();
  }

  /** Decode at DECODE_RATE where the platform allows it, else at the
   *  context's own rate.  Both promise and callback forms (old Safari). */
  private async decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
    const w = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
    const Offline = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
    const viaCallback = (c: BaseAudioContext, b: ArrayBuffer) => new Promise<AudioBuffer>((ok, fail) => {
      const p = c.decodeAudioData(b, ok, fail) as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === 'function') p.then(ok, fail);
    });
    if (Offline) {
      try {
        return await viaCallback(new Offline(2, 1, SCORE.DECODE_RATE), bytes.slice(0));
      } catch { /* fall through to the live context */ }
    }
    return viaCallback(this.ctx, bytes);
  }

  private onLoaded(id: string) {
    if (id === 'atmos') { if (this.enabled && !document.hidden) this.startTransport(); }
    const layer = this.layers.get(id as MusicLayerId);
    if (layer && this.running) this.startSource(layer, this.ctx.currentTime + 0.05, 0.05);
    this.evaluate();
  }
}
