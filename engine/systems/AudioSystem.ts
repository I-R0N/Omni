import SFX_MANIFEST from 'virtual:sfx-manifest';
import { AUDIO_CONSTANTS, getActiveCollapseMode } from '../../constants';
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

// ~600-byte silent 8 kHz WAV.  Used ONLY to promote the iOS audio session
// off "ambient" (which the hardware mute switch silences) on versions
// predating navigator.audioSession.  A data URI, not an asset file, so the
// single-file standalone build is unaffected.
const SILENT_WAV =
  'data:audio/wav;base64,'
  + 'UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICA'
  + 'gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA'
  + 'gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA'
  + 'gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA'
  + 'gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA'
  + 'gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA'
  + 'gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA'
  + 'gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';

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

/** Where recorded takes live.  `public/` is served at the site root, so a
 *  file at `public/assets/sfx/foo.wav` is fetched from `/assets/sfx/foo.wav`
 *  — the same convention `assets.ts` uses for sprites. */
const SFX_ASSET_DIR = '/assets/sfx/';

/** A one-shot sound.  `render` returns the voice's duration in seconds so
 *  the manager can retire it without a timer.  With `sample` set and the
 *  file decoded, the recording plays instead and `render` is the fallback. */
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
  /** Recorded asset(s) for this id — bare filenames under
   *  `public/assets/sfx/`.  When one has DECODED, it replaces `render` for
   *  this voice; until then (and forever, if the file is missing or the
   *  browser cannot decode it) the synth draft plays instead.  That
   *  fallback is what keeps the id contract honest: a sample is a registry
   *  change and never a trigger-site change, and a missing file degrades
   *  to a sound rather than to silence.
   *
   *  Several filenames = VARIANTS, cycled round-robin per trigger.  Bulk-
   *  fired ids machine-gun without variation, which is what `jitter` is
   *  for on the synth side; a handful of takes is the sampled equivalent
   *  and the two stack (jitter still detunes the chosen take). */
  sample?: string | string[];
  /** Audible radii in world units, overriding the global defaults.  Exists
   *  so AMBIENT events — shards colliding with each other somewhere the
   *  player is not — carry only in close proximity, while the same
   *  material heard because the PLAYER caused it carries normally. */
  near?: number;
  far?: number;
  render: (s: SynthCtx) => number;
}

/** A sustained sound with an enter/exit condition.  `start` builds the
 *  graph and returns a handle; `set` receives the tracked 0..1 parameter
 *  on change (charge progress, throttle). */
export interface SfxLoopDef {
  tier: SfxTier;
  gain: number;
  positional?: boolean;
  near?: number;
  far?: number;
  /** Exponent applied to the linear distance attenuation, for loops whose
   *  POINT is the distance rather than the sound.
   *
   *  The shared model fades amplitude linearly from `near` to `far`, which
   *  is a weak cue: halfway out it is still at half amplitude, about 6 dB
   *  down, and a sound only 6 dB quieter reads as "right here, slightly
   *  softer" rather than as "far away". Raising it to a power bends that
   *  toward how loudness actually falls off with distance, so the same
   *  travel across the same radius becomes a much stronger cue.
   *
   *  1 (default) keeps the linear behaviour every other loop has. */
  curve?: number;
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
  /** Triggers seen inside the CURRENT retrigger window, counted so the DBG
   *  collapse mode can let a fraction of them through.  Reset when a window
   *  lapses, i.e. when a genuinely new burst starts. */
  winCount: number;
}

interface LiveLoop {
  voice: LoopVoice;
  gain: GainNode;
  panner: StereoPannerNode | null;
  param: number;
}

/** Absolute peak of a decoded buffer, across every channel.  Runs once per
 *  file at load, never in a frame. */
function peakOf(buf: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  }
  return peak;
}

export class AudioSystem {
  // ── Registry ──
  private defs = new Map<string, SfxDef>();
  private loopDefs = new Map<string, SfxLoopDef>();

  // ── Context (created on first gesture only) ──
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  /** Decoded recorded takes, per id.  Absent or all-null → synth draft. */
  private samples = new Map<string, { bufs: (AudioBuffer | null)[]; next: number }>();
  private samplesRequested = false;
  private samplesLoaded = 0;
  private samplesRejected = 0;
  /** Files in the folder that match no registered id — a typo in a filename,
   *  which would otherwise be indistinguishable from "not wired yet". */
  private unmatchedSamples: string[] = [];
  /** Files named after a LOOP id.  Matched, but unusable — see
   *  discoverSamples().  Kept apart from `unmatchedSamples` because the two
   *  need different advice: one is a typo, this one is an unbuilt feature. */
  private loopSampleFiles: string[] = [];
  /** When false, an id with no usable recording makes NO SOUND rather than
   *  falling back to its synth draft.  Exists so recorded assets can be
   *  auditioned alone: with the drafts under them, a sound that is quietly
   *  still synthetic is impossible to tell from one that landed. */
  private _draftsEnabled = true;
  private gestureBound = false;
  /** iOS session-category shim — see claimPlaybackSession(). */
  private silentEl: HTMLAudioElement | null = null;

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
   * Arm window listeners that create — and KEEP ALIVE — the AudioContext
   * on user gestures.  Deliberately owned here rather than pushed into
   * InputSystem: InputSystem only engages on CANVAS-targeted events (so
   * overlay menus keep native touch scrolling), but a menu tap is a
   * perfectly good unlock gesture, and on mobile it is usually the FIRST
   * one.  Capture-phase + passive means this never interferes with either
   * the overlay or the game input path.
   *
   * These listeners are deliberately NOT `once`.  iOS suspends or
   * INTERRUPTS an AudioContext for reasons the page never sees — a phone
   * call, Siri, another app taking the audio session, backgrounding the
   * tab — and a one-shot listener would leave the game permanently silent
   * with no way back.  `unlock()` is idempotent and costs a state
   * comparison, so re-checking on every gesture is the cheap, robust
   * option.
   */
  public armGestureUnlock() {
    if (this.gestureBound || typeof window === 'undefined') return;
    this.gestureBound = true;
    const fire = () => this.unlock();
    const opts = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', fire, opts);
    window.addEventListener('touchend', fire, opts);
    window.addEventListener('keydown', fire, opts);
    window.addEventListener('mousedown', fire, opts);
    // Returning to the tab is the other moment iOS hands the audio session
    // back — resume there too, so a backgrounded phone recovers by itself.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.unlock();
    });
  }

  /**
   * Route audio into a session category that IGNORES the iOS ring/silent
   * switch.
   *
   * This is the single biggest iOS-vs-everything-else difference: Safari
   * puts WebAudio in the "ambient" session by default, and ambient audio
   * is silenced by the hardware mute switch.  Everything else works
   * perfectly — context running, voices scheduled, no errors — and the
   * device simply discards the samples.  A game's SFX are "playback",
   * not "ambient", so say so.
   *
   *   - Safari 16.4+ exposes `navigator.audioSession`; setting the type
   *     is the clean, official fix.
   *   - Older iOS has no such API, and the only lever is a side effect:
   *     playing an `<audio>` element promotes the page's session
   *     category.  A ~600-byte silent WAV data URI does it, and being a
   *     data URI it stays inside the single-file standalone build (no
   *     asset file, so scripts/inline-build.mjs is still untouched).
   *
   * Both paths are best-effort and wrapped: on a browser that does
   * neither, this is a no-op and audio behaves as before.
   */
  private claimPlaybackSession() {
    if (typeof navigator === 'undefined') return;
    try {
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) { session.type = 'playback'; return; }
    } catch { /* not supported — fall through to the element trick */ }
    if (typeof document === 'undefined' || this.silentEl) return;
    try {
      const el = document.createElement('audio');
      el.src = SILENT_WAV;
      el.loop = true;
      el.setAttribute('playsinline', '');   // iOS: don't hand off to the native player
      el.setAttribute('webkit-playsinline', '');
      el.volume = 0.001;                     // audibly nothing; 0 can be optimised away
      // MUST be in the document: a detached element does not reliably
      // promote the audio session on iOS, which is the entire point of it.
      el.style.display = 'none';
      document.body.appendChild(el);
      this.silentEl = el;
      void el.play().catch(() => { /* blocked until a gesture; retried on the next one */ });
    } catch { /* no element audio available */ }
  }

  /** Create (or resume) the context.  Idempotent; safe to call from any
   *  gesture handler, and cheap enough to call from every one.  Returns
   *  false when audio is unavailable. */
  public unlock(): boolean {
    if (this.ctx) {
      // NOT just 'suspended': iOS also uses a non-standard 'interrupted'
      // state (phone call, Siri, another app). Resume on anything that is
      // not already running, or the game stays silent for the rest of the
      // session.
      if (this.ctx.state !== 'running') {
        void this.ctx.resume();
        this.claimPlaybackSession();
        if (this.silentEl && this.silentEl.paused) {
          void this.silentEl.play().catch(() => { /* still blocked */ });
        }
      }
      return true;
    }
    this.claimPlaybackSession();
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

    if (this.ctx.state !== 'running') void this.ctx.resume();
    // Decode every declared sample NOW, once, off the critical path.  This
    // is the whole reason preloading exists: `decodeAudioData` on first
    // COLLISION would land the decode inside a frame the player is already
    // being hit in.  Fetch + decode are async and land whenever they land;
    // until then every id plays its synth draft, so nothing waits on this.
    void this.preloadSamples();
    return true;
  }

  /** Fetch + decode every `sample` declared in the registry.  Idempotent,
   *  parallel, and FAILURE-TOLERANT by design — a 404 or an undecodable
   *  file leaves that id on its synth draft and logs nothing to the player.
   *  The standalone single-file build takes exactly that path today: its
   *  inliner carries images, not audio, so the standalone game is the
   *  procedural game. */
  private async preloadSamples(): Promise<void> {
    if (!this.ctx || this.samplesRequested) return;
    this.samplesRequested = true;
    const discovered = this.discoverSamples();
    const jobs: Promise<void>[] = [];
    for (const [id, def] of this.defs) {
      const found = discovered.get(id);
      // An explicit `sample` on the def WINS, so a one-off can always be
      // pinned by name; otherwise the folder decides.  With neither, the id
      // is on its draft and there is nothing to fetch.
      const declared = def.sample ? (Array.isArray(def.sample) ? def.sample : [def.sample]) : null;
      const names = declared ?? found;
      if (!names || names.length === 0) continue;
      const slots: (AudioBuffer | null)[] = names.map(() => null);
      this.samples.set(id, { bufs: slots, next: 0 });
      names.forEach((name, i) => {
        jobs.push((async () => {
          try {
            const res = await fetch(`${SFX_ASSET_DIR}${name}`);
            if (!res.ok) return;                       // missing → synth draft
            const bytes = await res.arrayBuffer();
            const buf = await this.ctx!.decodeAudioData(bytes);
            // A file that DECODES but carries no signal is the same failure
            // as a missing one — a bad export, a captured silence — and it is
            // the worse of the two, because it wins over a working draft and
            // the sound just disappears.  So the "degrade to a sound, never
            // to silence" rule is enforced on the CONTENT, not merely on the
            // fetch.  The bar is deliberately low and about audibility, not
            // taste: play() multiplies by the def's mix gain and then by
            // distance attenuation, so a peak this quiet cannot be heard in
            // play whatever the file was meant to be.
            if (peakOf(buf) < AUDIO_CONSTANTS.SAMPLE_MIN_PEAK) { this.samplesRejected++; return; }
            slots[i] = buf;
            this.samplesLoaded++;
          } catch {
            /* undecodable → synth draft.  Deliberately silent. */
          }
        })());
      });
    }
    await Promise.all(jobs);
  }

  /**
   * Group the files in `public/assets/sfx/` by the id each belongs to.
   *
   * The convention is the id with dots as dashes, plus any suffix — so
   * `crash.player.shard` collects `crash-player-shard.wav`,
   * `crash-player-shard-a.wav`, `crash-player-shard-rice-02.wav`.  Matching
   * is LONGEST-PREFIX against the ids the registry actually declares, which
   * is what keeps `destroy.enemy` from swallowing `destroy.enemy.heavy`'s
   * files: both are real ids, and the longer one wins its own takes.
   */
  private discoverSamples(): Map<string, string[]> {
    const byId = new Map<string, string[]>();
    // Longest id first, so a prefix id cannot claim a longer id's files.
    const ids = [...this.defs.keys()].sort((a, b) => b.length - a.length);
    const dashed = ids.map(id => [id, id.replace(/\./g, '-')] as const);
    for (const file of SFX_MANIFEST) {
      const stem = file.replace(/\.wav$/i, '').toLowerCase();
      const hit = dashed.find(([, d]) => stem === d || stem.startsWith(d + '-'));
      if (!hit) { this.unmatchedSamples.push(file); continue; }
      // A LOOP cannot take a recording yet — the sample path builds a
      // one-shot BufferSource, and a sustained sound needs seamless looping
      // plus a mapping from its tracked parameter (throttle, charge) onto
      // the buffer.  Until that exists, refusing the file LOUDLY beats
      // accepting it: registering it would mark the id as covered while
      // `loop()` went on calling the synth, so the draft would play and
      // look like the recording was working.
      if (this.loopDefs.has(hit[0])) { this.loopSampleFiles.push(file); continue; }
      const list = byId.get(hit[0]);
      if (list) list.push(file); else byId.set(hit[0], [file]);
    }
    for (const list of byId.values()) list.sort();
    return byId;
  }

  /** Next decoded take for an id, or null while none has landed.  Cycles
   *  round-robin and SKIPS slots still loading, so a partially-decoded set
   *  is usable the moment its first take arrives. */
  private takeSample(id: string): AudioBuffer | null {
    const set = this.samples.get(id);
    if (!set) return null;
    const n = set.bufs.length;
    for (let k = 0; k < n; k++) {
      const buf = set.bufs[(set.next + k) % n];
      if (buf) { set.next = (set.next + k + 1) % n; return buf; }
    }
    return null;
  }

  public get unlocked(): boolean { return this.ctx !== null; }
  public get contextState(): string | null { return this.ctx ? this.ctx.state : null; }
  /** True once audio can actually be heard: context built AND running.
   *  `unlocked` alone is not enough on iOS, where a context can sit in
   *  'suspended' or 'interrupted' indefinitely. */
  public get audible(): boolean { return this.ctx !== null && this.ctx.state === 'running'; }

  /** Total context→speaker latency in ms (baseLatency + outputLatency),
   *  null before unlock or where the browser hides it.  A READOUT, not a
   *  knob: everything this engine does is start-at-currentTime with 1-4ms
   *  attacks (measured: tap → play() 3-5ms end to end), so if sound feels
   *  late on a device, THIS number is where the time is going — ~30-45ms is
   *  a wired/speaker path, 150-250ms means Bluetooth. */
  public get latencyMs(): number | null {
    if (!this.ctx) return null;
    const base = this.ctx.baseLatency ?? 0;
    const out = (this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
    const ms = Math.round((base + out) * 1000);
    return ms > 0 ? ms : null;
  }

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
    opts?: { x?: number; y?: number; gain?: number; pitch?: number; param?: number;
             near?: number; far?: number },
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
    // DBG collapse mode decides how much of a burst survives as real voices.
    //
    // It counts triggers rather than scaling the WINDOW, and that is the
    // whole trick: a mass-death frame fires every trigger at the SAME
    // context time, so the gap between them is exactly zero and no amount of
    // shrinking a window lets a second one through. Letting every Nth
    // in-window trigger past is the only thing that can subdivide a burst.
    // (Measured: a window-scaling version produced 1 voice from 40 triggers
    // in both its modes, i.e. a knob that did nothing.)
    const cm = getActiveCollapseMode();
    let through = false;
    if (now - st.lastAt < def.minInterval) {
      st.winCount++;
      // pass 0 → nothing through (shipped); 1 → everything; 0.5 → every 2nd.
      const stride = cm.pass > 0 ? Math.max(1, Math.round(1 / cm.pass)) : 0;
      through = stride > 0 && st.winCount % stride === 0;
    } else {
      st.winCount = 0;
    }
    if (now - st.lastAt < def.minInterval && !through) {
      if (def.collapse && cm.bump && st.lastGain) {
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
    if (st.ends.length >= def.poly * cm.poly) { this.counts.dropped++; return; }

    // 3. Global ceiling, thinned by tier.  Tier 1 always plays.
    this.pruneGlobal(now);
    if (def.tier > 1) {
      const cap = (def.tier === 3
        ? AUDIO_CONSTANTS.MAX_VOICES_TIER3
        : AUDIO_CONSTANTS.MAX_VOICES_TIER2) * cm.ceiling;
      if (this.globalEnds.length >= cap) { this.counts.dropped++; return; }
    }
    if (this.globalEnds.length >= AUDIO_CONSTANTS.MAX_VOICES * cm.ceiling) {
      this.counts.dropped++; return;
    }

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
      // Caller override beats the def's own range, which beats the global
      // default — so ONE id can be near-field when it happens ambiently
      // and full-range when the player caused it.
      const atten = this.attenuation(d, opts.near ?? def.near, opts.far ?? def.far);
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
    // A decoded take REPLACES the draft; otherwise the draft plays.  One
    // BufferSourceNode is cheaper than any synth here builds (the drafts
    // run three to six nodes each), so this branch can only reduce the
    // per-voice cost — and every budget above it (retrigger collapse,
    // polyphony, tier thinning, attenuation) has already been applied, so
    // a sample obeys the same ceilings as the synth it replaced.
    const buf = this.takeSample(id);
    let dur: number;
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      // The call site's pitch (shard SIZE, in the case of contact) and the
      // def's jitter both ride playbackRate, so one take spans pebble-tap
      // to boulder-slam exactly as the synth's f0 sweep did.  Rate scales
      // duration, so the voice's retirement has to scale with it too.
      src.playbackRate.value = s.pitch;
      src.connect(voiceGain);
      src.start(now);
      dur = buf.duration / Math.max(0.01, s.pitch);
    } else if (this._draftsEnabled) {
      dur = Math.max(0.01, def.render(s));
    } else {
      // Drafts off and no recording for this id: play nothing, and count it
      // as a drop so the DBG readout can say how much of the game is still
      // silent rather than leaving it to the ear.
      voiceGain.disconnect();
      this.counts.dropped++;
      return;
    }
    dur = Math.max(0.01, dur);

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

    // A positional loop that is out of earshot is treated as OFF rather
    // than run at zero gain: a presence loop is driven from the nearest POI
    // at any distance, so without this a station on the far side of the map
    // would hold oscillators forever for nothing.
    let outOfEarshot = false;
    if (on && def.positional && opts?.x !== undefined && opts?.y !== undefined) {
      const dx = wrapDeltaX(this.lx, opts.x);
      const dy = wrapDeltaY(this.ly, opts.y);
      outOfEarshot =
        this.attenuation(Math.sqrt(dx * dx + dy * dy), def.near, def.far) <= 0;
    }

    // Drafts off and no recording for this id → the loop must NOT sound.
    // Every loop is a synth draft today (the sample path is one-shot only),
    // so WAV-only silences all of them — which is the point: the engine bed
    // and the POI hums are exactly the sounds most likely to be mistaken for
    // a recording, because they are always there.
    const draftOnly = this.takeSample(id) === null;
    if (!on || outOfEarshot || this._muted || !this._active
        || (draftOnly && !this._draftsEnabled)) {
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
        live.gain.gain.setTargetAtTime(
          def.gain * this.attenuation(d, def.near, def.far, def.curve), now, 0.08);
      }
      return;
    }

    const gain = this.ctx.createGain();
    let panner: StereoPannerNode | null = null;
    let g = def.gain;
    if (def.positional && opts?.x !== undefined && opts?.y !== undefined) {
      const dx = wrapDeltaX(this.lx, opts.x);
      const dy = wrapDeltaY(this.ly, opts.y);
      g *= this.attenuation(Math.sqrt(dx * dx + dy * dy), def.near, def.far, def.curve);
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
  /** How many recorded takes decoded successfully.  0 with samples declared
   *  means every id is on its synth draft — the normal state until files
   *  are dropped in, and the state the standalone build stays in. */
  public get sampleCount(): number { return this.samplesLoaded; }
  /** Synth drafts on/off.  With them off, only recorded takes sound — the
   *  audition mode for judging assets without mistaking a draft for one. */
  public get draftsEnabled(): boolean { return this._draftsEnabled; }
  public set draftsEnabled(v: boolean) {
    if (this._draftsEnabled === v) return;
    this._draftsEnabled = v;
    // Stop any live draft loop immediately.  Without this the engine bed
    // keeps running until something asks for it again — and `move.thrust`
    // idles continuously while the player is alive, so nothing ever would.
    if (!v && this.ctx) {
      const now = this.ctx.currentTime;
      for (const [id, live] of this.loops) {
        if (this.takeSample(id) !== null) continue;   // a recorded loop may stay
        live.voice.stop(now);
        try { live.gain.disconnect(); } catch { /* already gone */ }
        this.loops.delete(id);
      }
    }
  }
  /** Ids that have at least one decoded recording. */
  public get sampledIds(): string[] {
    return [...this.samples.keys()].filter(id => this.takeSample(id) !== null).sort();
  }
  /** Every registered id — one-shots AND loops.  Coverage is over every
   *  sound the game can make, so a readout that counted only one-shots would
   *  quietly overstate how done the asset pass is. */
  public get allIds(): string[] { return [...this.defs.keys(), ...this.loopDefs.keys()]; }
  /** Filenames present in the folder that match no id — i.e. typos. */
  public get unmatchedFiles(): string[] { return this.unmatchedSamples.slice(); }
  /** Filenames naming a LOOP id, which cannot use a recording yet. */
  public get loopSampleFilenames(): string[] { return this.loopSampleFiles.slice(); }
  /** Ids that are loops, so callers can explain why they take no file. */
  public get loopIds(): string[] { return [...this.loopDefs.keys()]; }
  /** Files that decoded but were rejected as silent.  Non-zero means an
   *  asset is broken and its id fell back to the draft — the one state that
   *  otherwise looks identical to "no files installed". */
  public get rejectedSampleCount(): number { return this.samplesRejected; }
  /** True once a decoded take exists for this id, i.e. `play` will use the
   *  recording rather than the draft. */
  public hasSample(id: string): boolean { return this.takeSample(id) !== null; }
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
    if (!st) { st = { lastAt: -1e9, ends: [], lastGain: null, lastBump: 1, winCount: 0 }; this.ids.set(id, st); }
    return st;
  }

  /** Distance attenuation: full inside `near`, linear to zero at `far`. */
  private attenuation(d: number, near?: number, far?: number, curve?: number): number {
    const n = near ?? AUDIO_CONSTANTS.NEAR_RADIUS;
    const f = far ?? AUDIO_CONSTANTS.FAR_RADIUS;
    if (d <= n) return 1;
    if (d >= f) return 0;
    const linear = 1 - (d - n) / (f - n);
    // The exponent only bends the curve BETWEEN the radii — both endpoints
    // are fixed points of `x ** c`, so an out-of-earshot check is unaffected
    // and a loop still goes fully silent at exactly `far`.
    return curve && curve !== 1 ? Math.pow(linear, curve) : linear;
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
