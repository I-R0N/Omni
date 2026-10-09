/**
 * THE ADAPTIVE SCORE — vertical layering on one musical clock.
 *
 * Each SONG is one piece of music split into six synchronised stems — "Omni"
 * (D minor, 128 BPM, 60 s), "Event Horizon" (E minor, 160 BPM, 48 s) and
 * "Critical Mass" (C minor, 150 BPM half-time, 51.2 s, the guitar-forward one);
 * one is resident at a time, chosen by the director's plan (score/index.json,
 * `requestSong`).  Every stem loops forever from the
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
 * LAYER VARIANTS.  A slot can hold several VARIANTS — complete alternative
 * stems (same tempo, length and harmony, different orchestration), declared
 * per song in score/index.json and named `<slot>-<variant>.mp3`.  Intensity
 * decides which slots are ON; the director here decides which VARIANT fills
 * each slot that is.  Every variant is just another sample-locked stem with
 * its own gain, started on the same `t0` by the same `startSource` math, so a
 * switch is a gain crossfade between two sources already in phase.  What
 * picks one:
 *   - CONTEXT TAGS (`station`, `portal`, `rare-item`, `danger`, `deep-space`,
 *     from MusicContext.ts) choose the ATMOS variant;
 *   - the dominant ENEMY FAMILY (`enemy:swarm|heavy|ranged`) chooses a combat
 *     slot's variant — picked when the slot ENTERS and then LOCKED, re-picked
 *     only when another family has out-weighed it for a whole phrase.
 * Changes commit only on PHRASE boundaries, and a slot that changed holds its
 * variant for `MUSIC_VARIANT_DWELL_PHRASES`.  Variant buffers live in a small
 * LRU cache under a decode budget; one that is not decoded by its boundary is
 * simply tried at the next, and a song with no variants takes none of these
 * paths.  docs/MUSIC_PIPELINE.md is the contract.
 *
 * WHY DECODED BUFFERS.  Sample-accurate sync between stems needs every stem
 * on the AudioContext clock; separate <audio> elements drift.  Stems decode
 * at `DECODE_RATE` (25 kHz — the music bus never needs more, and it is
 * roughly half the memory of 48 kHz) through an OfflineAudioContext; the source
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

import { AUDIO_CONSTANTS } from '../../constants';

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

/** A SONG is one complete set of stems on its own grid, in its own folder
 *  under public/assets/audio/ (`${folder}${layer}.mp3`, plus optional
 *  `riser.mp3` / `victory.mp3`).  The engine holds exactly one in memory.
 *
 *  THE SONG LIST AND THE PLAN ARE DATA: `score/index.json`, which
 *  `npm run music:import` maintains (docs/MUSIC_PIPELINE.md).  Adding a song
 *  is a folder and an index entry — no code.  These built-in values are only
 *  the fallback used until (or unless) the index loads. */
export interface VariantSpec { name: string; when: string[] }
export interface SongSpec {
  id: string; title: string; bpm: number; bars: number; folder: string;
  /** Bars per PHRASE — the grid variant changes commit on (default 8). */
  phraseBars?: number;
  /** Alternative stems per slot; the default stem is always `<slot>.mp3`. */
  variants?: Partial<Record<MusicLayerId, VariantSpec[]>>;
  /** Tag precedence, highest first (default `DEFAULT_CONTEXT_PRIORITY`). */
  contextPriority?: string[];
}
/** What the engine reports about the player's surroundings, every frame. */
export interface MusicContextSnapshot {
  /** Active context tags (`station`, `portal`, …). */
  tags: readonly string[];
  /** Contexts close to triggering — their variants are worth pre-decoding. */
  warm: readonly string[];
  /** Pressure weight of nearby hostiles, per enemy family. */
  families: Readonly<Record<string, number>>;
}
export const DEFAULT_CONTEXT_PRIORITY: readonly string[] = ['danger', 'rare-item', 'station', 'portal', 'deep-space'];
/** Every tag a variant's `when` may name — for the debug force cycle. */
export const MUSIC_CONTEXT_TAGS: readonly string[] = [
  ...DEFAULT_CONTEXT_PRIORITY, ...AUDIO_CONSTANTS.MUSIC_FAMILIES.map(f => `enemy:${f}`),
];
export const SONGS: readonly SongSpec[] = [
  { id: 'omni', title: 'Omni', bpm: 128, bars: 32, folder: 'score/omni/' },
  { id: 'event-horizon', title: 'Event Horizon', bpm: 160, bars: 32, folder: 'score/event-horizon/' },
  { id: 'critical-mass', title: 'Critical Mass', bpm: 150, bars: 32, folder: 'score/critical-mass/' },
];

/**
 * THE MUSIC PLAN — which song a moment calls for, the way AAA scores assign
 * cues: each AREA owns a theme (so a place keeps its identity and the hub
 * always sounds like home), and a BOSS gets a theme of its own that takes
 * over when it arrives and hands back when it dies.  Keys: `hub`; `arena`
 * (maps whose id starts `arena_`); `field` (every other map); `boss`.
 * Values are song ids.  Overridden by `plan` in score/index.json.
 */
export interface MusicPlan { hub: string; arena: string; field: string; boss: string }
export const MUSIC_PLAN: MusicPlan = { hub: 'omni', arena: 'event-horizon', field: 'omni', boss: 'critical-mass' };
const ARENA_PREFIX = 'arena_';
const INDEX_PATH = 'score/index.json';
const DEFAULT_IMPACT = 'score/impact.mp3';

interface ScoreIndex { songs?: SongSpec[]; plan?: Partial<MusicPlan>; impact?: string }

const SLOT_IDS: readonly string[] = ['atmos', 'pulse', 'groove', 'heavy', 'apex', 'boss'];
const VARIANT_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Keep only well-formed variant declarations: a malformed one is dropped
 *  rather than allowed to break the song. */
function cleanVariants(raw: unknown): SongSpec['variants'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: NonNullable<SongSpec['variants']> = {};
  for (const [slot, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!SLOT_IDS.includes(slot) || !Array.isArray(list)) continue;
    const ok: VariantSpec[] = [];
    for (const v of list as Partial<VariantSpec>[]) {
      if (!v || typeof v.name !== 'string' || !VARIANT_NAME.test(v.name) || !Array.isArray(v.when)) continue;
      if (ok.some(x => x.name === v.name)) continue;
      ok.push({ name: v.name, when: v.when.filter(t => typeof t === 'string') });
    }
    if (ok.length) out[slot as MusicLayerId] = ok;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Seconds the outgoing and incoming songs overlap across a change. */
const SONG_XFADE = 0.3;
/** A victory hands back to the area theme no sooner than this after the
 *  stinger lands (on the next bar line from then). */
const VICTORY_HANDBACK_SEC = 1.6;

interface PendingSong {
  idx: number;
  /** Variant stems this song would start on (optional: never awaited). */
  vbuffers: Map<string, AudioBuffer>;
  vinfo: Map<string, { layer: MusicLayerId; name: string }>;
  stinger: OneShotId | null;
  notBefore: number;
  needed: Set<MusicLayerId>;
  buffers: Map<string, AudioBuffer>;
}

export const SCORE = {
  /** Seconds of lead-in before bar 1 in every stem file. */
  LOOP_START: 0.5,
  // 25 kHz, down from 32 (user call).  The score is the single largest
  // block of decoded PCM in the game and this is a straight linear cut on
  // it: MEASURED 70.9 MB resident at 32 kHz for one song's stems, 55.4 at
  // 25 (`AdaptiveMusic.decodedBytes`, in-browser).  What it costs is
  // bandwidth above 12.5 kHz — the stems are mastered dark (the generator
  // lowpasses hard, see docs/AUDIO_AUTHORING.md) so there is little up
  // there to lose, and the phase this serves is a MOBILE release where the
  // tab is killed for peak RSS long before anyone notices the top octave.
  // Nothing about the GRID is rate-dependent: LOOP_START, bpm and bars are
  // all seconds, so bar lines land in the same places.
  DECODE_RATE: 25000,
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

type OneShotId = 'riser' | 'impact' | 'victory';


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

const sameList = (a: readonly string[], b: readonly string[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
const bufBytes = (b: AudioBuffer) => b.length * b.numberOfChannels * 4;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** One stem of a slot, playing (or ready to): the default (`name` '') or a
 *  variant.  source → sg (entry / song-change fades) → mix (the variant
 *  crossfade) → the layer's gain. */
interface Voice {
  name: string;
  mix: GainNode;
  source: AudioBufferSourceNode | null;
  sg: GainNode | null;
}

/** A slot's variant state.  `cur` '' = the default stem. */
interface SlotState {
  cur: string;
  /** A switch scheduled to land at `switchAt` (the phrase boundary). */
  to: string | null;
  switchAt: number;
  fadeEnd: number;
  lastChangeAt: number;
  /** The boundary a decision was last taken for. */
  decidedT: number;
  /** Combat slots: the enemy family the slot is locked to, and the
   *  challenger that has out-weighed it since `streakSince`. */
  locked: string | null;
  streakFam: string | null;
  streakSince: number;
}
const freshSlot = (): SlotState => ({
  cur: '', to: null, switchAt: 0, fadeEnd: 0, lastChangeAt: -Infinity, decidedT: -Infinity,
  locked: null, streakFam: null, streakSince: 0,
});

/** A decoded variant buffer in the LRU cache. */
interface CachedVariant { buf: AudioBuffer; bytes: number; layer: MusicLayerId; name: string; touched: number }

interface Layer {
  spec: LayerSpec;
  gain: GainNode;
  voices: Map<string, Voice>;
  v: SlotState;
  on: boolean;
}

/** Start deciding a boundary this long before its crossfade begins. */
const DECIDE_WINDOW = 0.6;

type OfflineCtor = new (channels: number, length: number, rate: number) => OfflineAudioContext;

export class AdaptiveMusic {
  private readonly out: GainNode;
  private readonly fx: GainNode;
  private readonly layers = new Map<MusicLayerId, Layer>();
  private readonly buffers = new Map<string, AudioBuffer>();
  /** Decoded VARIANT stems, by file (the default stems live in `buffers`). */
  private readonly vcache = new Map<string, CachedVariant>();
  private readonly vloading = new Set<string>();
  /** Variant files that failed to load: never retried, never an error. */
  private readonly vmissing = new Set<string>();
  private ctxTags = new Set<string>();
  private ctxWarm = new Set<string>();
  private famW: Record<string, number> = {};
  private forcedCtx: string | null = null;
  private realTags: readonly string[] = [];
  private realWarm: readonly string[] = [];
  private realFam: Record<string, number> = {};
  private _variantChanges = 0;
  private vDirty = true;
  private budgetMB: number = AUDIO_CONSTANTS.MUSIC_DECODE_BUDGET_MB;
  private vLastManage = 0;
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
  /** The song list, plan and shared impact — built-in until the index loads. */
  private songs: SongSpec[] = [...SONGS];
  private plan: MusicPlan = { ...MUSIC_PLAN };
  private impactFile = DEFAULT_IMPACT;
  private areaKind: 'hub' | 'arena' = 'hub';
  /** The director's state. */
  private _area = '';
  private areaSong = 0;
  private bossActive = false;
  /** After a boss dies: the combat floor stays off until the gate lets go. */
  private victoryHold = false;
  private pending: PendingSong | null = null;
  private _lastStinger: OneShotId | null = null;
  private _songChanges = 0;
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
      this.layers.set(spec.id, { spec, gain, voices: new Map(), v: freshSlot(), on: false });
    }
    void this.loadIndex();
  }

  /** Read score/index.json (inlined in the standalone build) and adopt its
   *  songs and plan.  A missing or malformed index keeps the built-in ones. */
  private async loadIndex() {
    try {
      const w = globalThis as { __omniScoreIndex?: ScoreIndex };
      let idx = w.__omniScoreIndex;
      if (!idx) {
        const res = await fetch(`/assets/audio/${INDEX_PATH}`);
        if (!res.ok) return;
        idx = await res.json() as ScoreIndex;
      }
      const songs = (idx.songs ?? []).filter(x => x && x.id && x.folder && x.bpm > 0 && x.bars > 0)
        .map(x => ({ ...x, variants: cleanVariants(x.variants) }));
      if (!songs.length) return;
      const current = this.song.id;
      this.songs = songs;
      this.plan = { ...MUSIC_PLAN, ...(idx.plan ?? {}) };
      if (idx.impact) this.impactFile = idx.impact;
      const i = this.songIndex(current);
      this.songIdx = this.songs[i]?.id === current ? i : 0;
      this.areaSong = this.songIndex(this.areaSongId(this._area, this.areaKind));
      this.requestSong(this.wantedSong(), null);
    } catch (e) {
      this.errors.push(`${INDEX_PATH}: ${(e as Error)?.message ?? e}`);
    }
  }

  private areaSongId(areaId: string, kind: 'hub' | 'arena'): string {
    if (kind === 'hub') return this.plan.hub;
    return areaId.startsWith(ARENA_PREFIX) ? this.plan.arena : this.plan.field;
  }

  private songIndex(id: string): number {
    const i = this.songs.findIndex(x => x.id === id);
    return i < 0 ? 0 : i;
  }

  /** The songs available (index order) — for the debug pin. */
  public get songList(): readonly SongSpec[] { return this.songs; }

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
      this.load('victory');
    }
    this.evaluate();
  }

  /** The proximity gate (with its linger).  The floor under the groove. */
  public setCombat(combat: boolean) {
    if (this.combat === combat) return;
    this.combat = combat;
    if (!combat) this.victoryHold = false;
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

  // ── the director ──────────────────────────────────────────────────────────

  /** The area being entered (from `loadMapFresh`): picks its theme. */
  public setArea(id: string, kind: 'hub' | 'arena') {
    this._area = id;
    this.areaKind = kind;
    this.areaSong = this.songIndex(this.areaSongId(id, kind));
  }

  /**
   * A NEW ENCOUNTER: a map load ('map' / 'portal'), or a boss warping in.
   * The DIRECTOR picks the song the moment calls for — the area's theme, or
   * the boss theme — and if that is not the one playing, requests it (a
   * seamless change on a bar line, see `requestSong`).  If it already is,
   * the score returns to bar 1 at the next bar line instead.
   */
  public cueEncounter(kind: 'map' | 'portal' | 'boss') {
    this._jumps++;
    if (kind !== 'boss') {
      // LEAVING IS NOT A LULL.  The hold that carries the stack through a
      // wave clear would otherwise keep the drums up for seconds after a
      // portal out of a fight (the old "battle music followed me to the hub"
      // report).  The encounter is over: drop straight to the new map's own
      // picture and let its first engagement build back up.
      this._intensity = 0;
      this.holdUntil = 0;
      this.damage = 0;
      this.bossActive = false;
      this.victoryHold = false;
      this.evaluate();
    } else {
      this.bossActive = true;
      this.victoryHold = false;
    }
    if (this.requestSong(this.wantedSong(), kind === 'boss' ? 'impact' : null)) return;
    if (kind === 'boss') this.load('boss');
    if (!this.running) { this.held = 0; return; }
    const at = this.nextGrid(this.barSec);
    const now = this.ctx.currentTime;
    this.t0 = at;
    this.jumpAt = at;
    // The phrase grid restarts with t0, so a variant crossfade still in
    // flight is completed on the spot rather than left on the old grid.
    this.settleAll(true);
    for (const layer of this.layers.values()) {
      const fade = layer.spec.jumpFade;
      for (const voice of [...layer.voices.values()]) {
        if (!voice.source || !voice.sg) continue;
        const old = voice.source, oldGain = voice.sg;
        oldGain.gain.cancelScheduledValues(now);
        oldGain.gain.setValueAtTime(1, Math.max(now, at - fade));
        oldGain.gain.linearRampToValueAtTime(0, at + fade);
        old.stop(at + fade + 0.05);
        voice.source = null;
        voice.sg = null;
        this.startSource(layer, at, fade, voice.name);
      }
    }
    if (kind === 'boss') { this.playOneShot('impact', at); this._lastStinger = 'impact'; }
  }

  /**
   * THE BOSS IS DEAD.  The combat layers drop out on the next beat, the
   * current song's VICTORY STINGER rings there, the combat floor stays off
   * until the proximity gate itself lets go (so the linger cannot drag the
   * drums back in under the stinger), and the director hands back to the
   * area's theme once the stinger has spoken.
   */
  public bossDefeated() {
    this.bossActive = false;
    this.victoryHold = true;
    this._intensity = 0;
    this.holdUntil = 0;
    this.damage = 0;
    this.evaluate();
    const at = this.running ? this.nextGrid(this.beat) : this.ctx.currentTime;
    this.playOneShot('victory', at);
    this._lastStinger = 'victory';
    this.requestSong(this.wantedSong(), null, at + VICTORY_HANDBACK_SEC);
  }

  /** Debug: 'auto' lets the director choose; a song index pins that song. */
  public setSongMode(mode: 'auto' | number) {
    this._songMode = mode;
    this.requestSong(this.wantedSong(), null);
  }

  private wantedSong(): number {
    if (this._songMode !== 'auto') return this._songMode;
    return this.bossActive ? this.songIndex(this.plan.boss) : this.areaSong;
  }

  /**
   * Ask for song `idx`.  Returns false if it is already playing (and cancels
   * any change in flight).  While the score is stopped it swaps at once.
   * Otherwise it is a PENDING change: the stems the moment needs (the bed,
   * every layer currently in, the boss stem in a boss fight) load into a side
   * buffer while the old song keeps playing; when they are ready the change
   * commits on the old song's next bar line (not before `notBefore`), the old
   * stems crossfading out as the new ones enter at bar 1, `stinger` landing
   * on the seam.  The rest of the new song loads after.  Peak memory is the
   * old song plus the new one's needed stems, for the length of one decode.
   */
  private requestSong(idx: number, stinger: OneShotId | null, notBefore = 0): boolean {
    if (!this.songs[idx]) return false;
    if (idx === this.songIdx) { this.pending = null; return false; }
    if (this.pending && this.pending.idx === idx) {
      this.pending.notBefore = Math.max(this.pending.notBefore, notBefore);
      return true;
    }
    if (!this.running) return this.swapNow(idx);
    const p: PendingSong = { idx, stinger, notBefore, buffers: new Map(), needed: new Set(), vbuffers: new Map(), vinfo: new Map() };
    p.needed.add('atmos');
    for (const layer of this.layers.values()) if (layer.on) p.needed.add(layer.spec.id);
    if (this.bossActive || this.threat.boss) {
      // A boss fight sits at the boss floor, which already has the heavy
      // layer in: have every one of those ready at the seam.
      for (const id of ['pulse', 'groove', 'heavy', 'boss'] as MusicLayerId[]) p.needed.add(id);
    }
    if (stinger === 'impact' && this.buffers.has('impact')) p.buffers.set('impact', this.buffers.get('impact')!);
    this.pending = p;
    for (const id of p.needed) this.loadPending(p, id);
    // The variants the new song would START on are fetched alongside — but
    // never awaited: a commit does not wait for one (the default stem plays,
    // and the variant is tried again at a later phrase boundary).
    for (const id of p.needed) {
      const name = this.pickFor(this.songs[idx], id);
      if (name) this.loadPendingVariant(p, id, name);
    }
    return true;
  }

  private loadPendingVariant(p: PendingSong, id: MusicLayerId, name: string) {
    const file = this.variantFile(this.songs[p.idx], id, name);
    if (this.vmissing.has(file)) return;
    void this.fetchDecode(file).then(buf => {
      if (this.pending !== p) return;
      p.vbuffers.set(file, buf);
      p.vinfo.set(file, { layer: id, name });
    }, () => { this.vmissing.add(file); });
  }

  private loadPending(p: PendingSong, id: MusicLayerId) {
    const file = `${this.songs[p.idx].folder}${id}.mp3`;
    void this.fetchDecode(file).then(buf => {
      if (this.pending !== p) return;          // superseded: drop it
      p.buffers.set(id, buf);
      this.tryCommit();
    }, e => { this.errors.push(`${file}: ${(e as Error)?.message ?? e}`); });
  }

  private tryCommit() {
    const p = this.pending;
    if (!p || ![...p.needed].every(id => p.buffers.has(id))) return;
    if (!this.running) { this.pending = null; this.swapNow(p.idx); return; }
    const at = this.nextGridFrom(Math.max(this.ctx.currentTime + LOOKAHEAD, p.notBefore), this.barSec);
    const now = this.ctx.currentTime;
    // Old song out across the seam…
    for (const layer of this.layers.values()) {
      for (const voice of layer.voices.values()) {
        if (!voice.source || !voice.sg) continue;
        const g = voice.sg.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(1, Math.max(now, at - SONG_XFADE * 0.5));
        g.linearRampToValueAtTime(0, at + SONG_XFADE * 0.5);
        voice.source.stop(at + SONG_XFADE);
        voice.source = null;
        voice.sg = null;
      }
      this.retireVoices(layer);
    }
    // …new song in at its bar 1.
    this.songIdx = p.idx;
    this.generation++;
    for (const id of [...this.buffers.keys()]) if (id !== 'impact') this.buffers.delete(id);
    for (const [id, buf] of p.buffers) this.buffers.set(id, buf);
    this.pending = null;
    this.t0 = at;
    this.jumpAt = at;
    this.held = 0;
    this._songChanges++;
    // A NEW SONG RESETS EVERY SLOT to its appropriate variant at bar 1: the
    // old song's variants are gone, and a variant the new song would start on
    // is adopted if it decoded in time (otherwise the default plays and the
    // variant is tried at a later phrase boundary).
    this.vcache.clear();
    this.vloading.clear();
    for (const [file, buf] of p.vbuffers) {
      const info = p.vinfo.get(file)!;
      this.vcache.set(file, { buf, bytes: bufBytes(buf), layer: info.layer, name: info.name, touched: now });
    }
    for (const layer of this.layers.values()) {
      layer.v = freshSlot();
      const pick = this.pickFor(this.song, layer.spec.id);
      if (pick && this.vcache.has(this.variantFile(this.song, layer.spec.id, pick))) layer.v.cur = pick;
      if (layer.spec.id !== 'atmos' && layer.on) layer.v.locked = this.dominantFamily;
    }
    this.vDirty = true;
    for (const layer of this.layers.values()) this.startVoices(layer, at, Math.max(layer.spec.jumpFade, SONG_XFADE * 0.5));
    if (p.stinger) { this.playOneShot(p.stinger, at); this._lastStinger = p.stinger; }
    this.loadSongRest();
    this.evaluate();
  }

  /** Everything of the resident song not yet decoded (each joins in phase). */
  private loadSongRest() {
    this.load('atmos');
    if (this.combatRequested) {
      for (const sp of LAYERS) if (sp.combat) this.load(sp.id);
      this.load('riser');
      this.load('victory');
      this.load('impact');
    }
    if (this.bossActive || this.threat.boss) this.load('boss');
  }

  /**
   * Replace the resident song AT ONCE — the fallback while the score is
   * stopped (muted, music volume 0, nothing decoded yet).  Fade the output,
   * stop every source on a schedule, DROP the old song's buffers, then fetch
   * the new one; it starts at bar 1 when its bed has decoded, no earlier
   * than the old one's stop.  Returns false if `idx` is already resident.
   */
  private swapNow(idx: number): boolean {
    if (idx === this.songIdx || !this.songs[idx]) return false;
    const now = this.ctx.currentTime;
    const stopAt = now + 0.4;
    if (this.running) {
      this.fade(this.out.gain, 0, now, 0.08);
      this.stopTransport(stopAt);
    }
    this.resumeAt = stopAt;
    this.songIdx = idx;
    this.generation++;
    this.pending = null;
    this._songChanges++;
    for (const id of [...this.buffers.keys()]) if (id !== 'impact') this.buffers.delete(id);
    this.vcache.clear();
    this.vloading.clear();
    this.vDirty = true;
    this.held = 0;
    this.jumpAt = -Infinity;
    this.atmosLevel = -1;
    for (const layer of this.layers.values()) {
      layer.v = freshSlot();
      this.retireVoices(layer);
      layer.on = false;
      this.fade(layer.gain.gain, 0, stopAt, 0.001);
    }
    this.loadSongRest();
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
  public get song(): SongSpec { return this.songs[this.songIdx] ?? this.songs[0]; }
  /** The song a change is loading toward, if one is in flight. */
  public get pendingSong(): SongSpec | null { return this.pending ? this.songs[this.pending.idx] : null; }
  public get area(): string { return this._area; }
  public get lastStinger(): string | null { return this._lastStinger; }
  /** Completed song changes (seamless or immediate). */
  public get songChanges(): number { return this._songChanges; }
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
    for (const buf of this.buffers.values()) b += bufBytes(buf);
    for (const c of this.vcache.values()) b += c.bytes;
    return b;
  }
  /** Active context tags (`station`, …, plus `enemy:<family>`). */
  public get contexts(): string[] { return [...this.ctxTags]; }
  /** The variant sounding in a slot: its name, or 'default' for `<slot>.mp3`. */
  public activeVariant(slot: MusicLayerId): string {
    this.settleAll();
    return this.layers.get(slot)?.v.cur || 'default';
  }
  /** The enemy family with the most pressure nearby, or null. */
  public get dominantFamily(): string | null { return this._dominant; }
  /** Variant changes that have landed (tests, debug). */
  public get variantChanges(): number { return this._variantChanges; }
  /** The variant sounding in every slot that declares any. */
  public get variantMap(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const id of Object.keys(this.song.variants ?? {}) as MusicLayerId[]) out[id] = this.activeVariant(id);
    return out;
  }
  /** The battle stack is up: the groove is in. */
  public get battleActive(): boolean { return this.isLayerOn('groove'); }
  public get error(): string | null { return this.errors[0] ?? null; }

  /** The resident song's grid. */
  public get beat(): number { return 60 / this.song.bpm; }
  public get barSec(): number { return this.beat * 4; }
  public get loopSec(): number { return this.barSec * this.song.bars; }

  // ── layer variants ────────────────────────────────────────────────────────

  /** The engine's per-frame picture of the player's surroundings. */
  public setContext(c: MusicContextSnapshot) {
    let changed = !sameList(c.tags, this.realTags) || !sameList(c.warm, this.realWarm);
    if (changed) { this.realTags = [...c.tags]; this.realWarm = [...c.warm]; }
    // Family weights change continuously; copy them into fixed keys (no alloc).
    for (const f of AUDIO_CONSTANTS.MUSIC_FAMILIES) this.realFam[f] = c.families[f] ?? 0;
    if (changed) this.rebuildContext();
    else this.refreshDominant();
    this.evaluate();
  }

  /** Debug: pin one context tag (`null` = follow the game).  `enemy:<family>`
   *  also pins that family as the only one present. */
  public setForcedContext(tag: string | null) {
    this.forcedCtx = tag;
    this.rebuildContext();
    this.evaluate();
  }
  public get forcedContext(): string | null { return this.forcedCtx; }
  /** Debug / tests: the decoded-PCM budget in MB (default
   *  `MUSIC_DECODE_BUDGET_MB`); evicts down to it at the next pass. */
  public setDecodeBudgetMB(mb: number) { this.budgetMB = mb; this.vDirty = true; }

  private rebuildContext() {
    const forced = this.forcedCtx;
    this.ctxTags = new Set(forced ? [forced] : this.realTags);
    this.ctxWarm = new Set(forced ? [forced] : this.realWarm);
    this.refreshDominant(true);
  }

  private _dominant: string | null = null;
  private refreshDominant(force = false) {
    const forced = this.forcedCtx;
    let best: string | null = null, bw = 0;
    for (const f of AUDIO_CONSTANTS.MUSIC_FAMILIES) {
      const w = forced?.startsWith('enemy:') ? (forced === `enemy:${f}` ? 5 : 0) : (this.realFam[f] ?? 0);
      this.famW[f] = w;
      if (w >= AUDIO_CONSTANTS.MUSIC_FAMILY_MIN_WEIGHT && w > bw) { best = f; bw = w; }
    }
    if (best !== this._dominant || force) {
      if (this._dominant) this.ctxTags.delete(`enemy:${this._dominant}`);
      this._dominant = best;
      if (best) this.ctxTags.add(`enemy:${best}`);
      this.vDirty = true;
    }
  }

  private variantFile(song: SongSpec, id: MusicLayerId, name: string): string {
    return `${song.folder}${id}-${name}.mp3`;
  }

  /** The variant of `id` a tag set calls for, or '' (the default stem).
   *  PRECEDENCE: tags are tried in `contextPriority` order (enemy tags after),
   *  and the first one some variant of the slot claims wins — the first such
   *  variant in list order.  A tag the slot has no variant for is passed over
   *  rather than forcing the default, so a slot that only scores `station`
   *  still scores it while `danger` is also up.  A variant whose file is known
   *  to be missing is never chosen. */
  private matchVariant(song: SongSpec, id: MusicLayerId, has: (tag: string) => boolean): string {
    const list = song.variants?.[id];
    if (!list) return '';
    const claim = (t: string): string | null => {
      for (const v of list) {
        if (v.when.includes(t) && !this.vmissing.has(this.variantFile(song, id, v.name))) return v.name;
      }
      return null;
    };
    for (const t of song.contextPriority ?? DEFAULT_CONTEXT_PRIORITY) {
      if (has(t)) { const r = claim(t); if (r !== null) return r; }
    }
    for (const f of AUDIO_CONSTANTS.MUSIC_FAMILIES) {
      const t = `enemy:${f}`;
      if (has(t)) { const r = claim(t); if (r !== null) return r; }
    }
    return '';
  }

  /** The variant a slot of `song` would start on right now. */
  private pickFor(song: SongSpec, id: MusicLayerId): string {
    if (!song.variants?.[id]) return '';
    if (id === 'atmos') return this.matchVariant(song, id, t => this.ctxTags.has(t));
    if (!this.layers.get(id)!.on) return '';
    const f = this._dominant;
    return f ? this.matchVariant(song, id, t => t === `enemy:${f}`) : '';
  }

  /** A combat slot ENTERS: lock it to the family present, and (if its layer is
   *  still silent and the stem is decoded) start on that variant outright. */
  private enterSlot(layer: Layer) {
    const id = layer.spec.id;
    if (id === 'atmos' || !this.song.variants?.[id]) return;
    const v = layer.v;
    v.locked = this._dominant;
    v.streakFam = null;
    const want = this.pickFor(this.song, id);
    if (want !== (v.to ?? v.cur) && layer.gain.gain.value < 0.05 && this.canPlay(layer, want)) {
      const now = this.ctx.currentTime;
      for (const voice of layer.voices.values()) {
        voice.mix.gain.cancelScheduledValues(now);
        voice.mix.gain.setValueAtTime(voice.name === want ? 1 : 0, now);
      }
      v.cur = want; v.to = null; v.lastChangeAt = now;
      this._variantChanges++;
    }
  }

  private canPlay(layer: Layer, name: string): boolean {
    return name === '' || (this.running && !!layer.voices.get(name)?.source);
  }

  private get phraseSec(): number { return this.barSec * Math.max(1, this.song.phraseBars ?? 8); }

  /** Land a scheduled switch whose boundary has passed — or, with `now`, land
   *  every one at once (a jump restarts the grid they were timed on). */
  private settleAll(immediately = false) {
    const now = this.ctx.currentTime;
    for (const layer of this.layers.values()) {
      const v = layer.v;
      if (v.to === null || (!immediately && now < v.switchAt)) continue;
      if (immediately) {
        for (const voice of layer.voices.values()) {
          voice.mix.gain.cancelScheduledValues(now);
          voice.mix.gain.setValueAtTime(voice.name === v.to ? 1 : 0, now);
        }
      }
      v.lastChangeAt = immediately ? now : v.switchAt;
      v.cur = v.to; v.to = null;
      v.fadeEnd = 0;
      this._variantChanges++;
    }
  }

  /** The variant decisions, taken once per slot per PHRASE BOUNDARY, a little
   *  ahead of it so the crossfade can be centred on the bar line. */
  private directVariants() {
    const song = this.song;
    const vs = song.variants;
    if (!vs) return;
    this.settleAll();
    const now = this.ctx.currentTime;
    if (this.running) {
      const phrase = this.phraseSec;
      const dwell = AUDIO_CONSTANTS.MUSIC_VARIANT_DWELL_PHRASES * phrase;
      for (const layer of this.layers.values()) {
        const id = layer.spec.id;
        if (!vs[id]) continue;
        const v = layer.v;
        const combat = id !== 'atmos';
        if (combat && layer.on) this.trackStreak(layer, now);
        const xf = combat ? this.beat : this.barSec;
        const k = Math.max(0, Math.ceil((now + LOOKAHEAD + xf / 2 - this.t0) / phrase - 1e-6));
        const T = this.t0 + k * phrase;
        if (Math.abs(T - v.decidedT) < 1e-3 || now < T - xf / 2 - DECIDE_WINDOW) continue;
        v.decidedT = T;
        if (combat && !layer.on) continue;                  // a slot picks when it enters
        if (now < v.fadeEnd) continue;                      // still crossfading
        if (combat && v.streakFam && now - v.streakSince >= phrase * 0.98) {
          v.locked = v.streakFam;                           // out-weighed for a whole phrase
          v.streakFam = null;
        }
        const want = combat
          ? (v.locked ? this.matchVariant(song, id, t => t === `enemy:${v.locked}`) : '')
          : this.pickFor(song, id);
        if (want === v.cur) continue;
        if (T < v.lastChangeAt + dwell - 1e-6) continue;    // minimum dwell
        if (!this.canPlay(layer, want)) { this.vDirty = true; continue; }   // not decoded: next boundary
        const a = T - xf / 2, b = T + xf / 2;
        for (const voice of layer.voices.values()) {
          const g = voice.mix.gain;
          const isTo = voice.name === want, isFrom = voice.name === v.cur;
          if (!isTo && !isFrom) continue;
          g.cancelScheduledValues(now);
          g.setValueAtTime(g.value, now);
          g.setValueAtTime(isTo ? 0 : 1, a);
          g.linearRampToValueAtTime(isTo ? 1 : 0, b);
        }
        v.to = want; v.switchAt = T; v.fadeEnd = b;
      }
    }
    if (this.vDirty ? now - this.vLastManage > 0.1 : now - this.vLastManage > 1) this.manageVariants(now);
  }

  /** A combat slot's challenger: the heaviest OTHER family, once it has
   *  out-weighed the locked one by the margin.  Any frame it has not, the
   *  streak starts over — it must hold for a whole phrase. */
  private trackStreak(layer: Layer, now: number) {
    const v = layer.v;
    const lw = v.locked ? (this.famW[v.locked] ?? 0) : 0;
    let cand: string | null = null, cw = 0;
    for (const f of AUDIO_CONSTANTS.MUSIC_FAMILIES) {
      if (f === v.locked) continue;
      const w = this.famW[f] ?? 0;
      if (w > cw) { cand = f; cw = w; }
    }
    const ok = cand !== null && cw >= AUDIO_CONSTANTS.MUSIC_FAMILY_MIN_WEIGHT && cw > AUDIO_CONSTANTS.MUSIC_FAMILY_MARGIN * lw;
    if (!ok) v.streakFam = null;
    else if (v.streakFam !== cand) { v.streakFam = cand; v.streakSince = now; }
  }

  /** RESIDENCY.  Keep decoded: whatever is playing or fading, what the slot
   *  would pick now, and WARM candidates (a context inside its prefetch
   *  radius, an enemy family in the alert ring).  Load what is missing if it
   *  fits the budget; evict the least recently wanted non-active buffers when
   *  over it.  Default stems are not in this cache and are never evicted. */
  private manageVariants(now: number) {
    this.vDirty = false;
    this.vLastManage = now;
    const song = this.song, vs = song.variants;
    if (!vs) return;
    const wanted = new Map<string, { layer: Layer; name: string; must: boolean }>();
    const add = (layer: Layer, name: string, must: boolean) => {
      if (!name) return;
      const file = this.variantFile(song, layer.spec.id, name);
      const w = wanted.get(file);
      if (w) w.must = w.must || must; else wanted.set(file, { layer, name, must });
    };
    for (const [id, list] of Object.entries(vs) as [MusicLayerId, VariantSpec[]][]) {
      const layer = this.layers.get(id)!;
      add(layer, layer.v.cur, true);
      if (layer.v.to) add(layer, layer.v.to, true);
      add(layer, this.pickFor(song, id), true);
      for (const v of list) {
        const near = id === 'atmos'
          ? v.when.some(t => this.ctxTags.has(t) || this.ctxWarm.has(t))
          : this.active && v.when.some(t => t.startsWith('enemy:') && (this.famW[t.slice(6)] ?? 0) > 0);
        if (near) add(layer, v.name, false);
      }
    }
    for (const [file, w] of wanted) {
      const hit = this.vcache.get(file);
      if (hit) { hit.touched = now; continue; }
      if (this.vloading.has(file) || this.vmissing.has(file)) continue;
      const def = this.buffers.get(w.layer.spec.id);
      const est = def ? bufBytes(def) : 9e6;     // a variant is the same length as its default
      if (!this.makeRoom(est, wanted, w.must)) continue;
      this.loadVariant(w.layer, w.name, file);
    }
    this.makeRoom(0, wanted, false);
  }

  /** Evict until `extra` more bytes fit the budget.  Never a buffer that is
   *  audible, nor a `must` one; warm ones only when `warmToo`. */
  private makeRoom(extra: number, wanted: Map<string, { must: boolean }>, warmToo: boolean): boolean {
    const budget = this.budgetMB * 1024 * 1024;
    while (this.decodedBytes + extra > budget) {
      let victim: string | null = null, oldest = Infinity;
      for (const [file, c] of this.vcache) {
        const w = wanted.get(file);
        if (w?.must) continue;
        if (w && !warmToo) continue;
        if ((this.layers.get(c.layer)!.voices.get(c.name)?.mix.gain.value ?? 0) > 0.001) continue;
        if (c.touched < oldest) { oldest = c.touched; victim = file; }
      }
      if (victim === null) return false;
      this.evictVariant(victim);
    }
    return true;
  }

  private evictVariant(file: string) {
    const c = this.vcache.get(file);
    if (!c) return;
    this.vcache.delete(file);
    const layer = this.layers.get(c.layer)!;
    const voice = layer.voices.get(c.name);
    if (voice) {
      if (voice.source) { try { voice.source.stop(); } catch { /* already stopped */ } }
      try { voice.mix.disconnect(); } catch { /* gone */ }
      layer.voices.delete(c.name);
    }
  }

  private loadVariant(layer: Layer, name: string, file: string) {
    const gen = this.generation;
    this.vloading.add(file);
    void this.fetchDecode(file).then(buf => {
      if (gen !== this.generation) return;          // belongs to a song no longer resident
      this.vcache.set(file, { buf, bytes: bufBytes(buf), layer: layer.spec.id, name, touched: this.ctx.currentTime });
      if (this.running) this.startSource(layer, this.ctx.currentTime + 0.05, 0.02, name);
      this.vDirty = true;
    }, () => {
      // Optional by design: a song may declare a variant whose file has not
      // arrived yet.  The default stem plays; no error is raised.
      this.vmissing.add(file);
      this.vDirty = true;
    }).finally(() => { this.vloading.delete(file); });
  }

  // ── intensity ─────────────────────────────────────────────────────────────

  private targetIntensity_(): number {
    if (!this.active) return 0;
    const t = this.threat;
    let base = FLOOR_EXPLORE;
    if (t.alert) base = FLOOR_ALERT;
    const combat = this.combat && !this.victoryHold;
    if (combat) base = Math.max(base, FLOOR_COMBAT);
    if (t.boss) base = Math.max(base, FLOOR_BOSS);
    const engaged = combat || t.boss;
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
        if (want) { this.enterSlot(layer); this.vDirty = true; }
        this.scheduleLayer(layer);
      }
    }
    this.directVariants();
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

  /** The first grid line of the resident song at or after `t`. */
  private nextGridFrom(t: number, period: number): number {
    if (!this.running) return t;
    const n = Math.ceil((Math.max(t, this.jumpAt) - this.t0) / period - 1e-6);
    return this.t0 + n * period;
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
    for (const layer of this.layers.values()) this.startVoices(layer, at, 0.02);
  }

  private stopTransport(when: number) {
    if (!this.running) return;
    this.held = this.position;
    this.running = false;
    for (const layer of this.layers.values()) {
      for (const voice of layer.voices.values()) {
        if (voice.source) { try { voice.source.stop(when); } catch { /* already stopped */ } }
        voice.source = null;
        voice.sg = null;
      }
    }
  }

  /** Start a layer's loop so that it is exactly in phase with t0. */
  private startSource(layer: Layer, when: number, fade: number, name = '') {
    const voice = this.voiceOf(layer, name);
    const buf = name === '' ? this.buffers.get(layer.spec.id)
      : this.vcache.get(this.variantFile(this.song, layer.spec.id, name))?.buf;
    if (!buf || !this.running || voice.source) return;
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
    sg.connect(voice.mix);
    src.start(when, SCORE.LOOP_START + mod(when - this.t0, this.loopSec));
    voice.source = src;
    voice.sg = sg;
  }

  /** The layer's voice for `name`, created on first use.  Its mix gain starts
   *  at 1 only if it is the slot's current variant. */
  private voiceOf(layer: Layer, name: string): Voice {
    let voice = layer.voices.get(name);
    if (!voice) {
      const mix = this.ctx.createGain();
      mix.gain.value = layer.v.cur === name ? 1 : 0;
      mix.connect(layer.gain);
      voice = { name, mix, source: null, sg: null };
      layer.voices.set(name, voice);
    }
    return voice;
  }

  /** Start every resident stem of a slot — the default and any variant that
   *  is decoded — all on the same t0, all in phase. */
  private startVoices(layer: Layer, when: number, fade: number) {
    this.startSource(layer, when, fade, '');
    for (const c of this.vcache.values()) if (c.layer === layer.spec.id) this.startSource(layer, when, fade, c.name);
  }

  /** Drop a slot's voices (their sources already stopped or scheduled to).
   *  The mix nodes disconnect once the tail has played out. */
  private retireVoices(layer: Layer) {
    const old = [...layer.voices.values()];
    layer.voices.clear();
    if (old.length) setTimeout(() => { for (const v of old) { try { v.mix.disconnect(); } catch { /* gone */ } } }, 1500);
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
    const file = id === 'impact' ? this.impactFile : `${this.song.folder}${id}.mp3`;  // riser/victory are per song
    if (this.buffers.has(id) || this.loading.has(file)) return;
    const gen = this.generation;
    this.loading.add(file);
    void (async () => {
      try {
        const buf = await this.fetchDecode(file);
        // A song switch happened while this was in flight: it belongs to a
        // song that is no longer resident, so drop it.
        if (gen !== this.generation && id !== 'impact') return;
        this.buffers.set(id, buf);
        this.onLoaded(id);
      } catch (e) {
        // A song's riser and victory stinger are OPTIONAL (an imported song
        // may not have them): without one, that moment simply has no hit.
        if (id !== 'riser' && id !== 'victory') this.errors.push(`${file}: ${(e as Error)?.message ?? e}`);
      } finally {
        this.loading.delete(file);
      }
    })();
  }

  private async fetchDecode(file: string): Promise<AudioBuffer> {
    const inline = (globalThis as { __omniAudioInline?: Record<string, string> }).__omniAudioInline;
    const res = await fetch(inline?.[file] ?? `/assets/audio/${file}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return this.decode(await res.arrayBuffer());
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
    this.vDirty = true;
    this.evaluate();
  }
}
