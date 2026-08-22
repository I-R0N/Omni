import { AudioSystem, SynthCtx, tone, noise, ms, LoopVoice } from './AudioSystem';
import { AUDIO_CONSTANTS } from '../../constants';

/** Close-proximity range for AMBIENT shard chatter — shards colliding,
 *  merging and snapping with each other where the player is not involved.
 *  A dense field generates these constantly, and at the normal radius they
 *  chatter from events the player has nothing to do with.  The SAME sound
 *  played because the player shot or rammed the shard is fired with the
 *  normal radius by the caller (GameEngine.deathFx → killedByPlayer). */
const SHARD_RANGE = {
  near: AUDIO_CONSTANTS.SHARD_NEAR_RADIUS,
  far:  AUDIO_CONSTANTS.SHARD_FAR_RADIUS,
} as const;

/** Cached per AudioContext: the live one and the OfflineAudioContext the
 *  headless smokes render into want different sample rates, and the buffer
 *  is otherwise rebuilt every time the snitch comes back into earshot. */
const coinBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** A seamless loop of loose coins settling — the snitch's presence bed.
 *
 *  Each grain is a struck-metal transient: three INHARMONIC partials (the
 *  ratios below are near a small bell's, which is what stops it reading as a
 *  musical note) under a fast exponential decay. Pitch, level and decay are
 *  all randomised per grain, and gaps between grains are drawn from an
 *  exponential distribution so the trickle is irregular rather than metric —
 *  a fixed gap would read as a machine, which is the failure the tone had.
 *
 *  A grain running past the end WRAPS to the front, so the buffer is
 *  loop-continuous by construction and needs no crossfade.
 *
 *  Deliberately kept off the fatiguing band: fundamentals top out under
 *  1 kHz and the caller lowpasses the result. Coins are bright because they
 *  are TRANSIENT, not because they are high — a sustained sound at this
 *  pitch is exactly what was just removed. */
function coinBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = coinBuffers.get(ctx);
  if (cached) return cached;

  const SEC = 4;
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(SEC * sr), sr);
  const d = buf.getChannelData(0);
  const n = d.length;

  const PARTIALS = [1, 2.41, 4.07];       // inharmonic — metal, not a note
  const GAINS    = [1, 0.42, 0.18];
  const MEAN_GAP = 0.085;                 // s between grains, on average

  let t = 0;
  while (t < SEC) {
    const f0 = 430 + Math.random() * 520;               // 430–950 Hz
    const decay = 0.022 + Math.random() * 0.055;        // 22–77 ms
    const amp = (0.35 + Math.random() * 0.65) * 0.5;
    const len = Math.min(Math.floor(decay * 5 * sr), n);
    const start = Math.floor(t * sr);
    for (let i = 0; i < len; i++) {
      const s = i / sr;
      const env = Math.exp(-s / decay);
      let v = 0;
      for (let p = 0; p < PARTIALS.length; p++) {
        v += GAINS[p] * Math.sin(2 * Math.PI * f0 * PARTIALS[p] * s);
      }
      // Wrap, so the last grains of the buffer ring on into its first
      // samples and the seam is inaudible.
      d[(start + i) % n] += v * env * amp;
    }
    // Exponential gaps: bunches and lulls, the way spilled change behaves.
    t += -Math.log(1 - Math.random()) * MEAN_GAP;
  }

  // Normalise so the def's own gain is the only volume control that matters.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < n; i++) d[i] /= peak;

  coinBuffers.set(ctx, buf);
  return buf;
}

/**
 * SfxRegistry — the procedural draft of every sound in
 * `docs/SFX_INVENTORY.md`, keyed by that document's stable ids.
 *
 * One entry per inventory row, in inventory order, with the row's
 * `tier` / `mix` / `poly` / throttle / variation / positional values
 * transcribed directly.  The inventory quotes milliseconds; `ms()`
 * converts at the boundary so a def can be read line-by-line against its
 * row.
 *
 * These are DRAFTS.  Replacing one with a recorded asset is a change to
 * its `render` function and nothing else — no trigger site knows how a
 * sound is produced.  Inventory §9 ranks which drafts are worth
 * replacing first.
 */
// RECORDED TAKES ARE NOT DECLARED HERE.  Any .wav dropped into
// `public/assets/sfx/` named after an id — dots as dashes, plus any suffix —
// is discovered at build time and replaces that id's draft:
//
//     crash.player.shard  ->  crash-player-shard-a.wav, -b.wav, -rice02.wav
//
// So adding sound is adding files, not editing this file.  `SfxDef.sample`
// still exists to PIN a specific filename when one id needs an exception.
// The drafts below stay as the fallback for every id with no take, and are
// what the standalone build plays.
export function registerSfx(a: AudioSystem) {
  registerWeapons(a);
  registerEnemyWeapons(a);
  registerImpacts(a);
  registerDestruction(a);
  registerWorld(a);
  registerPickupsAndPOI(a);
  registerPortalsAndWaves(a);
  registerRoamers(a);
  registerStatusAndUI(a);
}

// ── 4.1 Player weapons ──────────────────────────────────────────────────────

function registerWeapons(a: AudioSystem) {
  // Dry, tight energy pip.  Fired more than anything else in the game, so
  // it is short, has no ring, and carries mandatory pitch jitter.
  a.register('weapon.blaster.fire', {
    tier: 1, gain: 0.45, poly: 4, minInterval: ms(40), jitter: 0.06, positional: true,
    render: s => Math.max(
      tone(s, { type: 'square', f0: 620, f1: 300, attack: ms(2), decay: ms(80), gain: 0.5 }),
      noise(s, { f0: 3000, type: 'highpass', attack: ms(1), decay: ms(28), gain: 0.14 }),
    ),
  });

  // Snappier and thinner than the blaster — the first of three.
  a.register('weapon.burst.fire', {
    tier: 1, gain: 0.40, poly: 4, minInterval: ms(30), jitter: 0.05, positional: true,
    render: s => tone(s, { type: 'square', f0: 800, f1: 480, attack: ms(1), decay: ms(60), gain: 0.5 }),
  });

  // The sub-shots ride a semitone higher so a burst reads as a rising
  // triplet rather than three identical clicks.  The caller passes the
  // shot index as `pitch`.
  a.register('weapon.burst.sub', {
    tier: 1, gain: 0.32, poly: 4, minInterval: ms(25), jitter: 0.05, positional: true,
    render: s => tone(s, { type: 'square', f0: 850, f1: 500, attack: ms(1), decay: ms(50), gain: 0.5 }),
  });

  // Wide breathy blast: a downward-sweeping noise cone over a low thump.
  // No pitch centre — the cone IS the sound.
  a.register('weapon.shotgun.fire', {
    tier: 1, gain: 0.62, poly: 3, minInterval: ms(120), jitter: 0.08, positional: true,
    render: s => Math.max(
      noise(s, { f0: 6000, f1: 900, type: 'lowpass', q: 0.8, attack: ms(2), decay: ms(180), gain: 0.55 }),
      tone(s, { f0: 90, f1: 55, attack: ms(1), decay: ms(70), gain: 0.5 }),
    ),
  });

  // Rubbery launch with an audible up-bend, telegraphing the return trip.
  a.register('weapon.bouncer.fire', {
    tier: 1, gain: 0.48, poly: 3, minInterval: ms(90), jitter: 0.07, positional: true,
    render: s => Math.max(
      tone(s, { f0: 220, f1: 520, attack: ms(3), decay: ms(110), gain: 0.5 }),
      tone(s, { type: 'triangle', f0: 440, f1: 1040, attack: ms(3), decay: ms(70), gain: 0.16 }),
    ),
  });

  // Electric crack into a short buzzing tail.  The sawtooth layer is the
  // "buzz"; the highpassed noise is the strike.
  a.register('weapon.lightning.fire', {
    tier: 1, gain: 0.55, poly: 3, minInterval: ms(100), jitter: 0.10, positional: true,
    render: s => Math.max(
      noise(s, { f0: 2000, f1: 5000, type: 'highpass', attack: ms(1), decay: ms(140), gain: 0.4 }),
      tone(s, { type: 'sawtooth', f0: 120, f1: 60, attack: ms(1), decay: ms(120), gain: 0.22 }),
    ),
  });

  // Deliberately the least aggressive launch in the family — the Seeker
  // does the aiming work for you, so it should not also shout.
  a.register('weapon.homing.fire', {
    tier: 1, gain: 0.50, poly: 3, minInterval: ms(140), jitter: 0.05, positional: true,
    render: s => Math.max(
      tone(s, { f0: 180, f1: 120, attack: ms(3), decay: ms(90), gain: 0.5 }),
      noise(s, { f0: 1800, f1: 700, type: 'lowpass', attack: ms(20), decay: ms(240), gain: 0.3 }),
    ),
  });

  // Heavy artillery cough — the biggest player sound, and the only weapon
  // with real sub-bass weight.
  a.register('weapon.cannon.fire', {
    tier: 1, gain: 0.75, poly: 2, minInterval: ms(250), jitter: 0.04, positional: true,
    render: s => Math.max(
      tone(s, { f0: 55, f1: 34, attack: ms(4), decay: ms(300), gain: 0.75 }),
      noise(s, { f0: 900, f1: 200, type: 'lowpass', attack: ms(2), decay: ms(200), gain: 0.5 }),
    ),
  });

  // A capacitor whine whose pitch TRACKS player.chargeProgress, so the
  // player can charge without watching their own ship — which is the
  // whole point of a hold-to-charge mechanic.
  //
  // IT IS THE WIND-UP THAT IS LOUD, NOT THE HOLD (user call).  The charge
  // can be held indefinitely, and this used to sit at full level for as
  // long as the player kept the trigger down — a sustained tone with no end
  // condition, which is the shape every whine complaint in this game has
  // had.  The level now SWELLS across the wind-up, peaks just before the
  // shot arms, and collapses to a bare presence for the hold.  Nothing is
  // lost: the ramp still reads as charging, `weapon.charge.ready` still
  // rings the instant it arms, and what remains under a held charge is a
  // reminder rather than an announcement.
  //
  // Shaped on the PARAMETER, not on a timer, because progress is what the
  // caller already tracks — at full charge `p` simply stays at 1, so "held"
  // needs no separate state to detect.
  a.registerLoop('weapon.charge.loop', {
    tier: 1, gain: 0.24,
    start: (s: SynthCtx): LoopVoice => {
      const { ctx, dest, t0 } = s;
      const osc = ctx.createOscillator();
      const partial = ctx.createOscillator();
      const mix = ctx.createGain();
      osc.type = 'sine';
      partial.type = 'sawtooth';
      const f = (p: number) => 140 + (900 - 140) * p;
      /** Level over the charge. Rises to full at PEAK, then falls to HOLD by
       *  the time the shot is armed. */
      const PEAK = 0.88, HOLD = 0.10;
      const level = (p: number) => (
        p < PEAK
          ? 0.28 + (1 - 0.28) * (p / PEAK)
          : 1 + (HOLD - 1) * Math.min(1, (p - PEAK) / (1 - PEAK))
      );
      osc.frequency.setValueAtTime(f(s.param), t0);
      partial.frequency.setValueAtTime(f(s.param) * 2, t0);
      mix.gain.value = 0.4;
      const swell = ctx.createGain();
      swell.gain.setValueAtTime(level(s.param), t0);
      const sub = ctx.createGain();
      sub.gain.value = 0.18;
      osc.connect(mix); partial.connect(sub); sub.connect(mix);
      mix.connect(swell); swell.connect(dest);
      osc.start(t0); partial.start(t0);
      return {
        set: (p, now) => {
          osc.frequency.setTargetAtTime(f(p), now, 0.04);
          partial.frequency.setTargetAtTime(f(p) * 2, now, 0.04);
          // Slower than the pitch: the drop into the hold should read as a
          // settle, not as the sound being cut off.
          swell.gain.setTargetAtTime(level(p), now, 0.10);
        },
        stop: now => {
          try { osc.stop(now + 0.05); partial.stop(now + 0.05); } catch { /* already stopped */ }
        },
      };
    },
  });

  // Clean bell ping the moment the shot is armed — distinct from the loop
  // it interrupts.
  a.register('weapon.charge.ready', {
    tier: 1, gain: 0.42, poly: 1, minInterval: ms(400),
    render: s => Math.max(
      tone(s, { f0: 1320, attack: ms(1), decay: ms(130), gain: 0.5 }),
      tone(s, { f0: 1980, attack: ms(1), decay: ms(80), gain: 0.16 }),
    ),
  });

  // Layered OVER the family's own .fire, so every charged shot reads as
  // the same gesture regardless of which weapon fired it.
  a.register('weapon.charged.release', {
    tier: 1, gain: 0.55, poly: 2, minInterval: ms(200), jitter: 0.04, positional: true,
    render: s => Math.max(
      tone(s, { f0: 90, f1: 40, attack: ms(2), decay: ms(260), gain: 0.7 }),
      noise(s, { f0: 8000, f1: 2000, type: 'bandpass', q: 0.7, attack: ms(2), decay: ms(180), gain: 0.35 }),
    ),
  });

  // The sound of nothing happening.  Hard-throttled: the player WILL mash
  // the fire button while EMP'd.
  a.register('weapon.reject', {
    tier: 2, gain: 0.30, poly: 1, minInterval: ms(250), jitter: 0.03,
    render: s => noise(s, { f0: 400, type: 'lowpass', attack: ms(1), decay: ms(90), gain: 0.5 }),
  });

  // Mechanical selector detent — two dry clicks a few ms apart.
  a.register('weapon.cycle', {
    tier: 2, gain: 0.35, poly: 1, minInterval: ms(80),
    render: s => Math.max(
      tone(s, { type: 'square', f0: 900, attack: ms(1), decay: ms(25), gain: 0.4 }),
      tone(s, { type: 'square', f0: 1350, attack: ms(1), decay: ms(50), gain: 0.3, delay: ms(8) }),
    ),
  });
}

// ── 4.2 Enemy weapons ───────────────────────────────────────────────────────
//
// Voiced APART from the player's family — darker, duller, softer-edged —
// so incoming and outgoing fire are distinguishable by ear on a screen too
// busy to read.  That distinction is the whole reason these are separate
// entries rather than reused player voices.

function registerEnemyWeapons(a: AudioSystem) {
  a.register('enemy.shot.basic', {
    tier: 2, gain: 0.30, poly: 5, minInterval: ms(50), jitter: 0.10, positional: true,
    render: s => tone(s, { type: 'square', f0: 380, f1: 220, attack: ms(2), decay: ms(85), gain: 0.4 }),
  });

  // Wet, slightly gurgling — the tell that this round debuffs you.
  a.register('enemy.shot.acid', {
    tier: 2, gain: 0.33, poly: 4, minInterval: ms(60), jitter: 0.10, positional: true,
    render: s => Math.max(
      tone(s, { type: 'sawtooth', f0: 300, f1: 180, attack: ms(3), decay: ms(130), gain: 0.35 }),
      noise(s, { f0: 700, f1: 400, type: 'bandpass', q: 6, attack: ms(4), decay: ms(120), gain: 0.25 }),
    ),
  });

  // One trigger for the whole fan, not one per pellet: three staggered
  // layers make it a single gesture, which is what the visual is too.
  a.register('enemy.shot.fan', {
    tier: 2, gain: 0.38, poly: 3, minInterval: ms(180), jitter: 0.06, positional: true,
    render: s => Math.max(
      tone(s, { type: 'square', f0: 380, f1: 240, attack: ms(2), decay: ms(120), gain: 0.32 }),
      tone(s, { type: 'square', f0: 420, f1: 260, attack: ms(2), decay: ms(120), gain: 0.28, delay: ms(12) }),
      tone(s, { type: 'square', f0: 460, f1: 280, attack: ms(2), decay: ms(120), gain: 0.24, delay: ms(24) }),
    ),
  });

  // A lit fuse rather than a bang — long enough to hear it coming, which
  // is the counterplay window for a slow homing missile.
  a.register('enemy.shot.missile', {
    tier: 2, gain: 0.40, poly: 3, minInterval: ms(200), jitter: 0.06, positional: true,
    render: s => Math.max(
      noise(s, { f0: 1200, f1: 600, type: 'lowpass', attack: ms(20), decay: ms(280), gain: 0.35 }),
      tone(s, { f0: 120, f1: 90, attack: ms(4), decay: ms(120), gain: 0.4 }),
    ),
  });

  // The player's own weapon, wrong-sided: same family, detuned down, with
  // a low-mid growl layered under it.
  a.register('enemy.shot.boss', {
    tier: 1, gain: 0.62, poly: 2, minInterval: ms(220), jitter: 0.05, positional: true,
    render: s => Math.max(
      noise(s, { f0: 4300, f1: 650, type: 'lowpass', q: 0.8, attack: ms(2), decay: ms(220), gain: 0.5 }),
      tone(s, { type: 'sawtooth', f0: 120, f1: 70, attack: ms(3), decay: ms(300), gain: 0.35 }),
    ),
  });
}

// ── 4.3 Impacts ─────────────────────────────────────────────────────────────

function registerImpacts(a: AudioSystem) {
  // The most-fired sound in the game after the blaster: short, bright, and
  // heavily jittered so a sustained stream never becomes a buzz.
  a.register('impact.hull.enemy', {
    tier: 2, gain: 0.34, poly: 6, minInterval: ms(30), collapse: true, jitter: 0.12, positional: true,
    render: s => Math.max(
      tone(s, { type: 'triangle', f0: 1600, f1: 900, attack: ms(1), decay: ms(60), gain: 0.35 }),
      noise(s, { f0: 3000, type: 'highpass', attack: ms(1), decay: ms(70), gain: 0.22 }),
    ),
  });

  // Duller, closer, more alarming — a blow on your OWN hull.
  a.register('impact.hull.player', {
    tier: 1, gain: 0.60, poly: 3, minInterval: ms(90), jitter: 0.06, positional: true,
    render: s => Math.max(
      tone(s, { f0: 240, f1: 150, attack: ms(1), decay: ms(110), gain: 0.6 }),
      tone(s, { type: 'triangle', f0: 900, f1: 700, attack: ms(2), decay: ms(150), gain: 0.18 }),
    ),
  });

  // Per-material tile/shard chips.  All tier 3, all collapsing: a shotgun
  // cone into a tile cluster is a dozen of these in one step.
  const chip = (id: string, o: {
    gain: number; dur: number; f0: number; f1?: number;
    type?: BiquadFilterType; q?: number; tonal?: number; jitter: number;
  }) => a.register(id, {
    tier: 3, gain: o.gain, poly: 5, minInterval: ms(25), collapse: true,
    jitter: o.jitter, positional: true,
    render: (s: SynthCtx) => {
      let end = noise(s, {
        f0: o.f0, f1: o.f1, type: o.type ?? 'bandpass', q: o.q ?? 2,
        attack: ms(1), decay: ms(o.dur), gain: 0.4,
      });
      if (o.tonal) {
        end = Math.max(end, tone(s, {
          type: 'triangle', f0: o.tonal, attack: ms(1), decay: ms(o.dur), gain: 0.3,
        }));
      }
      return end;
    },
  });

  // Pitches here were lowered ~1.5 octaves and the filter Q cut (playtest:
  // the originals read as an unpleasant high whine when a material field
  // chips repeatedly).  A HIGH-Q bandpass on noise is a whine by
  // construction — Q is what makes it ring rather than knock — so the Q
  // came down along with the frequency.  Glass stays the BRIGHTEST of the
  // materials; it just no longer lives up where the ear gets tired.
  chip('impact.tile.glass',   { gain: 0.22, dur: 80,  f0: 900,  q: 3,   tonal: 1250, jitter: 0.14 });
  chip('impact.tile.rock',    { gain: 0.24, dur: 80,  f0: 2000, f1: 700, type: 'lowpass', tonal: 480, jitter: 0.14 });
  chip('impact.tile.metal',   { gain: 0.26, dur: 165, f0: 520,  q: 3,   tonal: 330,  jitter: 0.10 });
  chip('impact.tile.plastic', { gain: 0.20, dur: 55,  f0: 1400, type: 'lowpass', tonal: 700, jitter: 0.14 });
  chip('impact.tile.nebula',  { gain: 0.16, dur: 190, f0: 900, q: 1.5,  jitter: 0.16 });

  // Energy splash with a bright rim — must be tellable from a hull hit by
  // ear alone, because "did that cost me health?" is a live decision.
  a.register('impact.shield.absorb', {
    tier: 1, gain: 0.48, poly: 3, minInterval: ms(60), jitter: 0.08, positional: true,
    render: s => Math.max(
      noise(s, { f0: 1200, f1: 3200, type: 'bandpass', q: 1.2, attack: ms(2), decay: ms(130), gain: 0.4 }),
      tone(s, { f0: 700, f1: 900, attack: ms(1), decay: ms(90), gain: 0.25 }),
    ),
  });

  // The RISE is the information: it bounced, it did not land.
  a.register('impact.shield.deflect', {
    tier: 2, gain: 0.42, poly: 3, minInterval: ms(80), jitter: 0.10, positional: true,
    render: s => Math.max(
      tone(s, { type: 'triangle', f0: 900, f1: 1600, attack: ms(1), decay: ms(160), gain: 0.45 }),
      noise(s, { f0: 4000, type: 'highpass', attack: ms(1), decay: ms(40), gain: 0.18 }),
    ),
  });

  a.register('impact.shield.break', {
    tier: 1, gain: 0.55, poly: 2, minInterval: ms(300), jitter: 0.05, positional: true,
    render: s => Math.max(
      noise(s, { f0: 2200, f1: 200, type: 'bandpass', q: 1.5, attack: ms(2), decay: ms(400), gain: 0.5 }),
      tone(s, { type: 'sawtooth', f0: 300, f1: 60, attack: ms(2), decay: ms(380), gain: 0.2 }),
    ),
  });

  // An obviously ABSORBED hit — pairs with the reduced damage number the
  // armor trait already shows.
  a.register('impact.armor.chip', {
    tier: 2, gain: 0.30, poly: 4, minInterval: ms(40), collapse: true, jitter: 0.08, positional: true,
    render: s => noise(s, { f0: 600, f1: 300, type: 'lowpass', attack: ms(1), decay: ms(85), gain: 0.5 }),
  });

  // A chain fires several of these in one step, so jitter is mandatory.
  a.register('impact.lightning.arc', {
    tier: 2, gain: 0.34, poly: 4, minInterval: ms(25), collapse: true, jitter: 0.14, positional: true,
    render: s => Math.max(
      noise(s, { f0: 3000, f1: 6000, type: 'highpass', attack: ms(1), decay: ms(100), gain: 0.4 }),
      tone(s, { type: 'sawtooth', f0: 180, f1: 90, attack: ms(1), decay: ms(70), gain: 0.14 }),
    ),
  });

  // Compact splash blast — deliberately NOT the boss-death boom, because
  // this one fires several times a fight.
  a.register('impact.explosion.aoe', {
    tier: 2, gain: 0.58, poly: 3, minInterval: ms(180), jitter: 0.07, positional: true,
    render: s => Math.max(
      tone(s, { f0: 70, f1: 40, attack: ms(3), decay: ms(320), gain: 0.7 }),
      noise(s, { f0: 2000, f1: 400, type: 'lowpass', attack: ms(2), decay: ms(260), gain: 0.45 }),
    ),
  });

  // Grinding, not explosive: you flew into a wall.  Gain is scaled by
  // impact speed at the call site.
  a.register('crash.player.tile', {
    tier: 1, gain: 0.55, poly: 2, minInterval: ms(180), jitter: 0.08, positional: true,
    render: s => Math.max(
      tone(s, { f0: 130, f1: 80, attack: ms(2), decay: ms(200), gain: 0.6 }),
      noise(s, { f0: 900, f1: 300, type: 'lowpass', attack: ms(5), decay: ms(240), gain: 0.4 }),
    ),
  });

  // A loose rock knocking off the hull — the player's most frequent
  // physical contact with the world, and previously silent below the
  // wall-break speed.  Light, hollow and SHORT: it is a nudge, not a
  // collision.  The caller pitches it by shard size (small knocks higher)
  // and gains it by impact speed, so a drifting pebble and a boulder slam
  // are the same voice at different ends of its range rather than two
  // sounds — one id keeps a busy field coherent.
  a.register('crash.player.shard', {
    tier: 1, gain: 0.34, poly: 3, minInterval: ms(70), collapse: true,
    jitter: 0.12, positional: true,
    render: s => Math.max(
      tone(s, { type: 'triangle', f0: 280, f1: 170, attack: ms(1), decay: ms(120), gain: 0.5 }),
      noise(s, { f0: 900, f1: 380, type: 'lowpass', attack: ms(1), decay: ms(90), gain: 0.3 }),
    ),
  });

  a.register('crash.player.enemy', {
    tier: 1, gain: 0.52, poly: 2, minInterval: ms(140), jitter: 0.08, positional: true,
    render: s => Math.max(
      tone(s, { f0: 200, f1: 120, attack: ms(1), decay: ms(180), gain: 0.55 }),
      tone(s, { type: 'triangle', f0: 1100, f1: 800, attack: ms(1), decay: ms(140), gain: 0.2 }),
    ),
  });

  // Debris hitting debris.  Very quiet — this happens constantly in a
  // shard field, and it is texture, not information.
  a.register('crash.shard.tile', {
    tier: 3, gain: 0.14, poly: 4, minInterval: ms(60), collapse: true, jitter: 0.16, positional: true,
    ...SHARD_RANGE,
    render: s => noise(s, { f0: 1500, f1: 500, type: 'lowpass', attack: ms(1), decay: ms(95), gain: 0.5 }),
  });
}

// ── 5 Destruction ───────────────────────────────────────────────────────────

function registerDestruction(a: AudioSystem) {
  // 5.1 Material.  Every entry collapses: a merged rock parent can shatter
  // into 40 fragments in a single step.
  a.register('destroy.tile.glass', {
    tier: 2, gain: 0.46, poly: 3, minInterval: ms(90), collapse: true, jitter: 0.10, positional: true,
    render: s => Math.max(
      noise(s, { f0: 1400, type: 'bandpass', q: 1.4, attack: ms(1), decay: ms(45), gain: 0.5 }),
      noise(s, { f0: 1050, f1: 1500, type: 'bandpass', q: 1.6, attack: ms(10), decay: ms(360), gain: 0.32 }),
      tone(s, { type: 'triangle', f0: 900, f1: 700, attack: ms(1), decay: ms(140), gain: 0.2 }),
    ),
  });

  a.register('destroy.tile.rock', {
    tier: 2, gain: 0.44, poly: 3, minInterval: ms(90), collapse: true, jitter: 0.10, positional: true,
    render: s => Math.max(
      tone(s, { f0: 120, f1: 70, attack: ms(2), decay: ms(90), gain: 0.6 }),
      noise(s, { f0: 1200, f1: 420, type: 'lowpass', attack: ms(8), decay: ms(320), gain: 0.42 }),
    ),
  });

  // A bending groan into a clanging break, with an inharmonic tail that
  // rings on — the only material whose death is tonal.
  a.register('destroy.tile.metal', {
    tier: 2, gain: 0.50, poly: 3, minInterval: ms(110), collapse: true, jitter: 0.08, positional: true,
    render: s => Math.max(
      tone(s, { type: 'triangle', f0: 110, f1: 95,  attack: ms(2), decay: ms(480), gain: 0.45 }),
      tone(s, { type: 'triangle', f0: 166, f1: 150, attack: ms(2), decay: ms(430), gain: 0.3 }),
      tone(s, { type: 'triangle', f0: 244, f1: 225, attack: ms(2), decay: ms(380), gain: 0.22 }),
      noise(s, { f0: 900, f1: 400, type: 'lowpass', attack: ms(1), decay: ms(140), gain: 0.3 }),
    ),
  });

  a.register('destroy.tile.plastic', {
    tier: 2, gain: 0.38, poly: 3, minInterval: ms(80), collapse: true, jitter: 0.12, positional: true,
    render: s => Math.max(
      noise(s, { f0: 2000, f1: 700, type: 'lowpass', attack: ms(1), decay: ms(230), gain: 0.5 }),
      tone(s, { type: 'square', f0: 600, f1: 400, attack: ms(1), decay: ms(90), gain: 0.2 }),
    ),
  });

  // Fires constantly in a nebula field — kept near-subliminal on purpose.
  a.register('destroy.tile.nebula', {
    tier: 3, gain: 0.16, poly: 3, minInterval: ms(140), collapse: true, jitter: 0.16, positional: true,
    render: s => noise(s, { f0: 900, f1: 300, type: 'bandpass', q: 1.2, attack: ms(40), decay: ms(480), gain: 0.5 }),
  });

  // Shards are their tile's voice: shorter and higher.  Same identity,
  // smaller object.
  const shardBreak = (id: string, gain: number, dur: number, f0: number, f1: number,
                      type: BiquadFilterType, q: number, tonal: number | 0, jitter: number) =>
    a.register(id, {
      tier: 3, gain, poly: 4, minInterval: ms(50), collapse: true, jitter, positional: true,
      // Near-field BY DEFAULT: most shard breaks are shards hitting each
      // other, which is not the player's business.  A break the player
      // caused is played with the normal radius (see deathFx).
      ...SHARD_RANGE,
      render: (s: SynthCtx) => {
        let end = noise(s, { f0, f1, type, q, attack: ms(2), decay: ms(dur), gain: 0.45 });
        if (tonal) end = Math.max(end, tone(s, { type: 'triangle', f0: tonal, attack: ms(1), decay: ms(dur * 0.6), gain: 0.22 }));
        return end;
      },
    });

  // Same lowering as the tiles.  The ORDER is preserved — glass still the
  // brightest, metal in the middle, rock the dullest — so materials remain
  // tellable apart; the whole set just moved down.
  shardBreak('destroy.shard.glass',   0.22, 200, 1250, 1650, 'bandpass', 1.8, 1000, 0.14);
  shardBreak('destroy.shard.rock',    0.22, 180, 1100, 480,  'lowpass',  1, 150,  0.14);
  shardBreak('destroy.shard.metal',   0.24, 250, 850,  620,  'bandpass', 2.5, 300,  0.12);
  shardBreak('destroy.shard.plastic', 0.18, 150, 1100, 520,  'lowpass',  1, 620,  0.14);
  shardBreak('destroy.shard.nebula',  0.12, 270, 1200, 450,  'bandpass', 1.2, 0,   0.18);

  // 5.2 Ships.
  // A pop, not an explosion — dozens fire at once against a flock, so this
  // row lives or dies on the collapse rule.
  a.register('destroy.enemy.small', {
    tier: 2, gain: 0.26, poly: 4, minInterval: ms(40), collapse: true, jitter: 0.18, positional: true,
    render: s => Math.max(
      tone(s, { type: 'square', f0: 500, f1: 200, attack: ms(1), decay: ms(90), gain: 0.4 }),
      noise(s, { f0: 2200, f1: 900, type: 'bandpass', q: 1.5, attack: ms(1), decay: ms(100), gain: 0.3 }),
    ),
  });

  // The workhorse kill: transient crack, short low body, fizzing tail.
  a.register('destroy.enemy.standard', {
    tier: 2, gain: 0.48, poly: 4, minInterval: ms(100), collapse: true, jitter: 0.10, positional: true,
    render: s => Math.max(
      tone(s, { f0: 90, f1: 45, attack: ms(2), decay: ms(280), gain: 0.65 }),
      noise(s, { f0: 3000, f1: 600, type: 'lowpass', attack: ms(1), decay: ms(300), gain: 0.45 }),
    ),
  });

  // Bigger and slower, with an audible structural collapse after the bang:
  // "that one was tough".
  a.register('destroy.enemy.heavy', {
    tier: 2, gain: 0.60, poly: 3, minInterval: ms(180), jitter: 0.08, positional: true,
    render: s => Math.max(
      tone(s, { f0: 60, f1: 32, attack: ms(3), decay: ms(460), gain: 0.75 }),
      tone(s, { type: 'triangle', f0: 240, f1: 160, attack: ms(40), decay: ms(400), gain: 0.28 }),
      noise(s, { f0: 2400, f1: 400, type: 'lowpass', attack: ms(2), decay: ms(420), gain: 0.4 }),
    ),
  });

  // Always cuts through: it is usually the reason half the hull just went.
  a.register('destroy.enemy.kamikaze', {
    tier: 1, gain: 0.82, poly: 2, minInterval: ms(300), jitter: 0.06, positional: true,
    render: s => Math.max(
      tone(s, { f0: 45, f1: 26, attack: ms(2), decay: ms(560), gain: 0.85 }),
      noise(s, { f0: 4000, f1: 300, type: 'lowpass', attack: ms(1), decay: ms(520), gain: 0.55 }),
    ),
  });

  // Wet burst — a membrane giving way.  Nothing else in the game sounds
  // like this, which is the point.
  a.register('destroy.enemy.bubble', {
    tier: 2, gain: 0.40, poly: 3, minInterval: ms(120), jitter: 0.14, positional: true,
    render: s => Math.max(
      tone(s, { f0: 220, f1: 80, attack: ms(3), decay: ms(270), gain: 0.5 }),
      noise(s, { f0: 800, f1: 250, type: 'bandpass', q: 4, attack: ms(2), decay: ms(230), gain: 0.35 }),
    ),
  });

  // A player-ship death heard from outside: same shape, no sting.
  a.register('destroy.rival', {
    tier: 1, gain: 0.58, poly: 2, minInterval: ms(250), jitter: 0.06, positional: true,
    render: s => Math.max(
      tone(s, { f0: 70, f1: 38, attack: ms(2), decay: ms(420), gain: 0.7 }),
      tone(s, { type: 'triangle', f0: 400, f1: 90, attack: ms(30), decay: ms(430), gain: 0.22 }),
      noise(s, { f0: 3000, f1: 500, type: 'lowpass', attack: ms(2), decay: ms(400), gain: 0.4 }),
    ),
  });

  // The run-ending sound: sharp blast into a long descending hum that
  // fades to nothing.  Final and a little sad, not triumphant.
  a.register('destroy.player', {
    tier: 1, gain: 1.0, poly: 1, minInterval: ms(2000),
    render: s => Math.max(
      tone(s, { f0: 70, f1: 34, attack: ms(2), decay: ms(700), gain: 0.9 }),
      tone(s, { type: 'triangle', f0: 400, f1: 60, attack: ms(30), decay: ms(1300), gain: 0.35 }),
      tone(s, { f0: 40, f1: 30, attack: ms(200), decay: ms(1100), gain: 0.3 }),
      noise(s, { f0: 3500, f1: 200, type: 'lowpass', attack: ms(2), decay: ms(800), gain: 0.4 }),
    ),
  });

  // 5.3 Dragon + boss.
  a.register('destroy.dragon.segment', {
    tier: 2, gain: 0.44, poly: 3, minInterval: ms(100), collapse: true, jitter: 0.10, positional: true,
    render: s => Math.max(
      tone(s, { f0: 140, f1: 90, attack: ms(2), decay: ms(260), gain: 0.5 }),
      noise(s, { f0: 3000, f1: 900, type: 'lowpass', attack: ms(2), decay: ms(240), gain: 0.4 }),
    ),
  });

  // A death roar collapsing into a rift implosion.
  a.register('destroy.dragon', {
    tier: 1, gain: 0.92, poly: 1, minInterval: ms(2000), positional: true,
    render: s => Math.max(
      tone(s, { type: 'sawtooth', f0: 90, f1: 35, attack: ms(40), decay: ms(900), gain: 0.5 }),
      tone(s, { type: 'triangle', f0: 180, f1: 70, attack: ms(60), decay: ms(800), gain: 0.3 }),
      noise(s, { f0: 400, f1: 2600, type: 'bandpass', q: 1, attack: ms(900), decay: ms(300), gain: 0.45 }),
      tone(s, { f0: 60, f1: 30, attack: ms(2), decay: ms(400), gain: 0.7, delay: ms(1100) }),
    ),
  });

  // A gear change: plating off, an alarm swell, then a harder mechanical
  // lock.  Must interrupt the fight's rhythm.
  a.register('boss.phase', {
    tier: 1, gain: 0.80, poly: 1, minInterval: ms(1000), positional: true,
    render: s => Math.max(
      tone(s, { type: 'sawtooth', f0: 200, f1: 800, attack: ms(300), decay: ms(600), gain: 0.35 }),
      noise(s, { f0: 1200, f1: 4000, type: 'bandpass', q: 1, attack: ms(200), decay: ms(500), gain: 0.3 }),
      tone(s, { f0: 60, f1: 40, attack: ms(2), decay: ms(300), gain: 0.75, delay: ms(500) }),
    ),
  });

  // Arrival: a low descending drone under a rift tear, landing on one hard
  // hit timed with the banner.
  a.register('boss.intro', {
    tier: 1, gain: 0.88, poly: 1, minInterval: ms(3000),
    render: s => Math.max(
      tone(s, { type: 'sawtooth', f0: 130, f1: 50, attack: ms(200), decay: ms(1500), gain: 0.45 }),
      noise(s, { f0: 300, f1: 2400, type: 'bandpass', q: 0.8, attack: ms(400), decay: ms(1200), gain: 0.3 }),
      tone(s, { f0: 45, f1: 28, attack: ms(3), decay: ms(300), gain: 0.85, delay: ms(1500) }),
    ),
  });

  // The payoff, in three stages: kill blast, a beat of near-silence, then
  // a rising bright chord as the salvage sprays.  Earned, not just loud.
  a.register('boss.death', {
    tier: 1, gain: 1.0, poly: 1, minInterval: ms(3000),
    render: s => Math.max(
      tone(s, { f0: 50, f1: 26, attack: ms(2), decay: ms(800), gain: 0.9 }),
      noise(s, { f0: 4000, f1: 200, type: 'lowpass', attack: ms(2), decay: ms(700), gain: 0.5 }),
      tone(s, { type: 'triangle', f0: 440, attack: ms(200), decay: ms(1200), gain: 0.3, delay: ms(600) }),
      tone(s, { type: 'triangle', f0: 554, attack: ms(220), decay: ms(1180), gain: 0.26, delay: ms(600) }),
      tone(s, { type: 'triangle', f0: 659, attack: ms(240), decay: ms(1160), gain: 0.22, delay: ms(600) }),
    ),
  });
}

// ── 6 World, movement, materials ────────────────────────────────────────────

function registerWorld(a: AudioSystem) {
  // The ship's engine, ALWAYS RUNNING while alive.
  //
  // The first cut gated this on `throttle > 0`, which snapped the whole
  // bed on and off with the input and was jarring (playtest).  A real
  // engine idles: the loop now runs continuously and THROTTLE MODULATES
  // it, so accelerating swells an existing sound rather than starting a
  // new one.  Two things move together and both are heavily smoothed —
  // GAIN (idle floor → full) and filter CUTOFF (dull → open) — because
  // changing only volume reads as a fader, while changing timbre too
  // reads as an engine working harder.
  //
  // AN ION DRIVE IN VACUUM, NOT A BURN (user call).  The previous cut was
  // a rocket: a noise rush opening from 90 Hz to 850 Hz with a loud idle
  // floor, so a coasting ship still sounded like it was combusting.  This
  // ship has infinite fuel, modest acceleration and a low top speed in deep
  // space — nothing about that is a roar.
  //
  // So the balance INVERTS.  The tonal field is the sound and the noise is
  // seasoning, where before the noise was the sound:
  //
  //   · TWO detuned sines a fifth apart (34 / 51 Hz at rest) carry it. They
  //     beat slowly against each other, which is what makes it read as a
  //     field rather than as an exhaust, and they LIFT in pitch with
  //     throttle — the ship is straining, not burning harder.
  //   · The noise bed stays nearly shut: a much darker sweep, at a fraction
  //     of the old level. Present enough to feel like matter is moving.
  //   · A faint coil shimmer fades in only over the top half of the
  //     throttle, so approaching full power adds detail rather than volume.
  //     Below half throttle it is silent.
  //
  // Idle is a THIRD of the old floor, so coasting is nearly silent — which
  // is the point: in vacuum, not thrusting should sound like not thrusting.
  // Smoothing is longer to match an engine that cannot change quickly.
  a.registerLoop('move.thrust', {
    tier: 2, gain: 0.17,
    start: (s: SynthCtx): LoopVoice => {
      const { ctx, dest, t0, param } = s;
      const IDLE_GAIN = 0.13;          // fraction of full at zero throttle
      const CUT_IDLE = 55, CUT_FULL = 320;   // Hz — dark at both ends
      const SMOOTH = 0.34;             // s; a heavy ship changes slowly
      const level  = (p: number) => IDLE_GAIN + (1 - IDLE_GAIN) * p;
      const cutoff = (p: number) => CUT_IDLE + (CUT_FULL - CUT_IDLE) * p;
      // The field's pitch lift. Small — a big interval would read as revs.
      const fLow  = (p: number) => 34 + 12 * p;
      const fHigh = (p: number) => 51 + 19 * p;
      // Shimmer: silent below half throttle, then eased in.
      const shimmer = (p: number) => Math.max(0, (p - 0.5) / 0.5) ** 2 * 0.08;

      const src = ctx.createBufferSource();
      src.buffer = s.noise; src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass'; filt.Q.value = 0.7;
      filt.frequency.setValueAtTime(cutoff(param), t0);
      const noiseGain = ctx.createGain(); noiseGain.gain.value = 0.22;

      const lo = ctx.createOscillator(); lo.type = 'sine';
      lo.frequency.setValueAtTime(fLow(param), t0);
      const hi = ctx.createOscillator(); hi.type = 'sine';
      hi.frequency.setValueAtTime(fHigh(param), t0);
      const loG = ctx.createGain(); loG.gain.value = 0.42;
      const hiG = ctx.createGain(); hiG.gain.value = 0.20;

      const coil = ctx.createOscillator(); coil.type = 'triangle';
      coil.frequency.setValueAtTime(fHigh(param) * 4, t0);
      const coilG = ctx.createGain();
      coilG.gain.setValueAtTime(shimmer(param), t0);

      // One throttle-driven gain over every layer.
      const swell = ctx.createGain();
      swell.gain.setValueAtTime(level(param), t0);

      src.connect(filt); filt.connect(noiseGain); noiseGain.connect(swell);
      lo.connect(loG); loG.connect(swell);
      hi.connect(hiG); hiG.connect(swell);
      coil.connect(coilG); coilG.connect(swell);
      swell.connect(dest);
      src.start(t0); lo.start(t0); hi.start(t0); coil.start(t0);
      return {
        set: (p, now) => {
          swell.gain.setTargetAtTime(level(p), now, SMOOTH);
          filt.frequency.setTargetAtTime(cutoff(p), now, SMOOTH);
          lo.frequency.setTargetAtTime(fLow(p), now, SMOOTH);
          hi.frequency.setTargetAtTime(fHigh(p), now, SMOOTH);
          coil.frequency.setTargetAtTime(fHigh(p) * 4, now, SMOOTH);
          coilG.gain.setTargetAtTime(shimmer(p), now, SMOOTH);
        },
        stop: now => {
          try {
            src.stop(now + 0.05); lo.stop(now + 0.05);
            hi.stop(now + 0.05); coil.stop(now + 0.05);
          } catch { /* already stopped */ }
        },
      };
    },
  });

  // A deforming knock — softer than a break, because nothing was destroyed.
  a.register('move.dent', {
    tier: 3, gain: 0.20, poly: 4, minInterval: ms(60), collapse: true, jitter: 0.14, positional: true,
    render: s => noise(s, { f0: 900, f1: 400, type: 'lowpass', attack: ms(2), decay: ms(120), gain: 0.5 }),
  });

  a.register('move.dent.recover', {
    tier: 3, gain: 0.16, poly: 3, minInterval: ms(100), jitter: 0.14, positional: true,
    render: s => tone(s, { type: 'triangle', f0: 200, f1: 320, attack: ms(3), decay: ms(160), gain: 0.5 }),
  });

  // Crystallisation: a rising granular rush resolving on a soft thunk.
  a.register('move.tilesnap', {
    tier: 3, gain: 0.28, poly: 2, minInterval: ms(200), jitter: 0.10, positional: true,
    ...SHARD_RANGE,
    // Metal assembles CONSTANTLY in a metal field, so this fires in bulk —
    // the original 1 k→3 k rise stacked into a whine.  Lowered to a warm
    // swell that resolves on the same thunk.
    render: s => Math.max(
      noise(s, { f0: 380, f1: 820, type: 'bandpass', q: 1.2, attack: ms(10), decay: ms(200), gain: 0.4 }),
      tone(s, { f0: 130, f1: 90, attack: ms(2), decay: ms(60), gain: 0.45, delay: ms(200) }),
    ),
  });

  // Two things becoming one.  Very quiet — this fires all the time.
  a.register('move.merge', {
    tier: 3, gain: 0.12, poly: 3, minInterval: ms(120), collapse: true, jitter: 0.16, positional: true,
    ...SHARD_RANGE,
    render: s => noise(s, { f0: 400, f1: 180, type: 'lowpass', attack: ms(5), decay: ms(130), gain: 0.5 }),
  });

  // Something came back — friendly, not alarming.
  a.register('move.regenpop', {
    tier: 3, gain: 0.18, poly: 3, minInterval: ms(120), collapse: true, jitter: 0.12, positional: true,
    render: s => Math.max(
      tone(s, { type: 'triangle', f0: 300, f1: 700, attack: ms(3), decay: ms(170), gain: 0.4 }),
      noise(s, { f0: 2000, type: 'highpass', attack: ms(2), decay: ms(80), gain: 0.15 }),
    ),
  });
}

// ── 7.1–7.2 Pickups + station ───────────────────────────────────────────────

function registerPickupsAndPOI(a: AudioSystem) {
  // Money.  The caller steps the pitch up a semitone per pickup inside a
  // short window, so a magnetised cluster climbs a scale instead of
  // rattling (SFX_INVENTORY §7.1).
  a.register('pickup.salvage', {
    tier: 1, gain: 0.44, poly: 5, minInterval: ms(50), jitter: 0.05, positional: true,
    render: s => Math.max(
      tone(s, { type: 'triangle', f0: 1180, attack: ms(1), decay: ms(110), gain: 0.4 }),
      tone(s, { type: 'triangle', f0: 1770, attack: ms(1), decay: ms(80), gain: 0.2 }),
    ),
  });

  // Restorative and unmistakably not money.
  a.register('pickup.health', {
    tier: 1, gain: 0.48, poly: 3, minInterval: ms(120), jitter: 0.04, positional: true,
    render: s => Math.max(
      tone(s, { f0: 520, attack: ms(5), decay: ms(120), gain: 0.45 }),
      tone(s, { f0: 780, attack: ms(5), decay: ms(200), gain: 0.4, delay: ms(90) }),
    ),
  });

  a.register('pickup.merge', {
    tier: 3, gain: 0.08, poly: 2, minInterval: ms(150), jitter: 0.16, positional: true,
    render: s => tone(s, { type: 'square', f0: 800, f1: 600, attack: ms(1), decay: ms(70), gain: 0.4 }),
  });

  // Clamps engaging — a descending mechanical sequence ending in a latch.
  // Says "safe now".
  a.register('poi.dock', {
    tier: 1, gain: 0.55, poly: 1, minInterval: ms(600),
    render: s => Math.max(
      tone(s, { type: 'square', f0: 400, attack: ms(2), decay: ms(70), gain: 0.25 }),
      tone(s, { type: 'square', f0: 280, attack: ms(2), decay: ms(70), gain: 0.25, delay: ms(180) }),
      tone(s, { type: 'square', f0: 200, attack: ms(2), decay: ms(70), gain: 0.25, delay: ms(360) }),
      tone(s, { f0: 60, f1: 40, attack: ms(3), decay: ms(150), gain: 0.7, delay: ms(550) }),
    ),
  });

  a.register('poi.undock', {
    tier: 1, gain: 0.50, poly: 1, minInterval: ms(400),
    render: s => Math.max(
      tone(s, { type: 'square', f0: 200, attack: ms(2), decay: ms(60), gain: 0.25 }),
      tone(s, { type: 'square', f0: 280, attack: ms(2), decay: ms(60), gain: 0.25, delay: ms(120) }),
      tone(s, { type: 'square', f0: 400, attack: ms(2), decay: ms(60), gain: 0.25, delay: ms(240) }),
      noise(s, { f0: 1500, f1: 4000, type: 'highpass', attack: ms(20), decay: ms(260), gain: 0.3, delay: ms(200) }),
    ),
  });

  a.register('poi.purchase', {
    tier: 1, gain: 0.50, poly: 1, minInterval: ms(150),
    render: s => Math.max(
      tone(s, { type: 'triangle', f0: 660, attack: ms(2), decay: ms(120), gain: 0.4 }),
      tone(s, { type: 'triangle', f0: 990, attack: ms(2), decay: ms(180), gain: 0.4, delay: ms(110) }),
    ),
  });

  // The purchase figure inverted — you gave something up.
  a.register('poi.sell', {
    tier: 2, gain: 0.42, poly: 1, minInterval: ms(150),
    render: s => Math.max(
      tone(s, { type: 'triangle', f0: 990, attack: ms(2), decay: ms(110), gain: 0.35 }),
      tone(s, { type: 'triangle', f0: 660, attack: ms(2), decay: ms(160), gain: 0.35, delay: ms(110) }),
    ),
  });

  // Audibly worse than selling, matching the 9% rate: a shredder rasp
  // resolving on a small chime for the credits.
  a.register('poi.scrap', {
    tier: 2, gain: 0.42, poly: 1, minInterval: ms(150),
    render: s => Math.max(
      noise(s, { f0: 1500, f1: 900, type: 'bandpass', q: 3, attack: ms(5), decay: ms(260), gain: 0.45 }),
      tone(s, { type: 'triangle', f0: 880, attack: ms(2), decay: ms(120), gain: 0.3, delay: ms(260) }),
    ),
  });

  // Tactile: slide, then lock.
  a.register('poi.module.install', {
    tier: 1, gain: 0.44, poly: 2, minInterval: ms(80), jitter: 0.04,
    render: s => Math.max(
      noise(s, { f0: 2000, f1: 900, type: 'bandpass', q: 2, attack: ms(8), decay: ms(90), gain: 0.3 }),
      tone(s, { type: 'square', f0: 1300, attack: ms(1), decay: ms(110), gain: 0.35, delay: ms(100) }),
    ),
  });

  a.register('poi.module.stow', {
    tier: 2, gain: 0.30, poly: 2, minInterval: ms(80), jitter: 0.06,
    render: s => noise(s, { f0: 700, f1: 400, type: 'lowpass', attack: ms(2), decay: ms(140), gain: 0.5 }),
  });

  // Fires often while the player learns the adjacency rules, so it is
  // clearly negative WITHOUT being harsh.
  a.register('poi.reject', {
    tier: 1, gain: 0.38, poly: 1, minInterval: ms(250),
    render: s => Math.max(
      tone(s, { type: 'square', f0: 330, attack: ms(1), decay: ms(80), gain: 0.3 }),
      tone(s, { type: 'square', f0: 220, attack: ms(1), decay: ms(120), gain: 0.3, delay: ms(80) }),
    ),
  });

  // Resolves on the SAME warm figure as pickup.health, so hull
  // restoration has one identity wherever it happens.
  a.register('poi.repair', {
    tier: 1, gain: 0.50, poly: 1, minInterval: ms(500),
    render: s => Math.max(
      noise(s, { f0: 2000, f1: 1400, type: 'bandpass', q: 3, attack: ms(20), decay: ms(360), gain: 0.3 }),
      tone(s, { f0: 520, attack: ms(5), decay: ms(120), gain: 0.4, delay: ms(380) }),
      tone(s, { f0: 780, attack: ms(5), decay: ms(180), gain: 0.35, delay: ms(470) }),
    ),
  });
}

// ── 7.3–7.4 Portals + waves ─────────────────────────────────────────────────

function registerPortalsAndWaves(a: AudioSystem) {
  // The audible half of the rift's presence: two close partials beating
  // slowly.  Tells the player they are in range without looking.
  // A LOW hum, and nothing above it.
  //
  // The first draft layered a 3 kHz bandpass (Q3) "shimmer" over the low
  // partials, and playtest identified it as the whine — the same mistake
  // as the material chips: a high-Q bandpass on noise RINGS, and a ringing
  // noise band held continuously is the most fatiguing thing audio can do.
  // The hum was always underneath; it just could not be heard past the
  // shimmer.  What carries the "rift" character now is the BEAT between
  // two detuned low sines (a slow 1.5 Hz throb) plus a breath of
  // heavily-lowpassed air — motion without brightness.
  a.registerLoop('portal.idle', {
    tier: 2, gain: 0.24, positional: true,
    near: AUDIO_CONSTANTS.PORTAL_NEAR_RADIUS,
    far:  AUDIO_CONSTANTS.PORTAL_FAR_RADIUS,
    start: (s: SynthCtx): LoopVoice => {
      const { ctx, dest, t0 } = s;
      // 55 / 56.5 Hz — an octave below the old pair, beating at 1.5 Hz.
      const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 56.5;
      // One quiet partial for body, still well below the whine band.
      const o3 = ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = 110;
      const g  = ctx.createGain(); g.gain.value = 0.55;
      const g3 = ctx.createGain(); g3.gain.value = 0.16;
      // Air, not shimmer: lowpassed hard, and a slow LFO on the cutoff so
      // it breathes instead of sitting still.
      const air = ctx.createBufferSource();
      air.buffer = s.noise; air.loop = true;
      const af = ctx.createBiquadFilter();
      af.type = 'lowpass'; af.frequency.value = 220; af.Q.value = 0.7;
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.13;
      const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 70;
      lfo.connect(lfoDepth); lfoDepth.connect(af.frequency);
      // Kept deliberately faint: this is a seasoning on a TONAL sound, and
      // at the first setting the portal measured as broadband as the
      // station, which defeats the point of giving them different voices.
      const ag = ctx.createGain(); ag.gain.value = 0.07;
      o1.connect(g); o2.connect(g); g.connect(dest);
      o3.connect(g3); g3.connect(dest);
      air.connect(af); af.connect(ag); ag.connect(dest);
      o1.start(t0); o2.start(t0); o3.start(t0); air.start(t0); lfo.start(t0);
      return {
        stop: now => {
          try {
            o1.stop(now + 0.12); o2.stop(now + 0.12); o3.stop(now + 0.12);
            air.stop(now + 0.12); lfo.stop(now + 0.12);
          } catch { /* already stopped */ }
        },
      };
    },
  });

  // Station presence: LOW WHITE NOISE — the sound of a big machine idling.
  // Deliberately the opposite character to the portal, so the two POIs are
  // tellable apart by ear: the portal is TONAL (beating sines, no noise
  // above 220 Hz), the station is BROADBAND (noise-led, no pitch centre).
  // Both are low, both swell with proximity, neither competes with combat.
  a.registerLoop('poi.station.idle', {
    tier: 2, gain: 0.20, positional: true,
    near: AUDIO_CONSTANTS.STATION_NEAR_RADIUS,
    far:  AUDIO_CONSTANTS.STATION_FAR_RADIUS,
    start: (s: SynthCtx): LoopVoice => {
      const { ctx, dest, t0 } = s;
      const src = ctx.createBufferSource();
      src.buffer = s.noise; src.loop = true;
      // Lowpassed to a dull rush — "white noise" in character, but with the
      // top taken off so it can be held indefinitely without fatigue.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 0.6;
      // A second, even duller layer with a slow cutoff drift gives the bed
      // some movement so it doesn't read as a flat hiss.
      const drift = ctx.createOscillator(); drift.type = 'sine'; drift.frequency.value = 0.09;
      const driftDepth = ctx.createGain(); driftDepth.gain.value = 90;
      drift.connect(driftDepth); driftDepth.connect(lp.frequency);
      // Faint mains-style hum under it — machinery, not weather.
      const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 48;
      const humGain = ctx.createGain(); humGain.gain.value = 0.18;
      const g = ctx.createGain(); g.gain.value = 0.5;
      src.connect(lp); lp.connect(g); g.connect(dest);
      hum.connect(humGain); humGain.connect(dest);
      src.start(t0); drift.start(t0); hum.start(t0);
      return {
        stop: now => {
          try { src.stop(now + 0.12); drift.stop(now + 0.12); hum.stop(now + 0.12); }
          catch { /* already stopped */ }
        },
      };
    },
  });

  // Handles the WHOLE cut: rising pull, a snap of silence, then the
  // arrival bloom.  One id, because two sounds across a zero-length gap
  // just phase against each other.
  a.register('portal.transit', {
    tier: 1, gain: 0.68, poly: 1, minInterval: ms(1000),
    render: s => Math.max(
      noise(s, { f0: 200, f1: 3000, type: 'bandpass', q: 0.8, attack: ms(20), decay: ms(580), gain: 0.5 }),
      tone(s, { type: 'sawtooth', f0: 120, f1: 600, attack: ms(20), decay: ms(560), gain: 0.22 }),
      tone(s, { type: 'triangle', f0: 400, f1: 300, attack: ms(100), decay: ms(400), gain: 0.35, delay: ms(680) }),
    ),
  });

  // The transit sound heard from OUTSIDE — shorter and darker.
  a.register('portal.open', {
    tier: 2, gain: 0.44, poly: 2, minInterval: ms(400), jitter: 0.06, positional: true,
    render: s => Math.max(
      noise(s, { f0: 150, f1: 1200, type: 'bandpass', q: 1, attack: ms(10), decay: ms(400), gain: 0.45 }),
      tone(s, { f0: 70, f1: 45, attack: ms(20), decay: ms(700), gain: 0.4 }),
    ),
  });

  // Two hard low hits under a short rising tone, landing with the banner.
  a.register('wave.start', {
    tier: 1, gain: 0.62, poly: 1, minInterval: ms(1200),
    render: s => Math.max(
      tone(s, { f0: 90, f1: 60, attack: ms(2), decay: ms(200), gain: 0.7 }),
      tone(s, { f0: 90, f1: 60, attack: ms(2), decay: ms(200), gain: 0.7, delay: ms(260) }),
      tone(s, { type: 'triangle', f0: 330, f1: 660, attack: ms(60), decay: ms(480), gain: 0.3, delay: ms(260) }),
    ),
  });

  // Relief and reward: a bright arpeggio over a swelling pad, landing with
  // the shockwave ring the celebration already draws.
  const clear = (id: string, gain: number, mul: number, shimmer: boolean) =>
    a.register(id, {
      tier: 1, gain, poly: 1, minInterval: ms(1500),
      render: (s: SynthCtx) => {
        let end = tone(s, { type: 'triangle', f0: 261 * mul, attack: ms(100), decay: ms(1200), gain: 0.25 });
        const notes = [523, 659, 784, 1047];
        for (let i = 0; i < notes.length; i++) {
          end = Math.max(end, tone(s, {
            type: 'triangle', f0: notes[i] * mul,
            attack: ms(3), decay: ms(420), gain: 0.32, delay: ms(120 * i),
          }));
        }
        if (shimmer) {
          end = Math.max(end, noise(s, {
            f0: 4000, f1: 6000, type: 'highpass', attack: ms(200), decay: ms(1100), gain: 0.18,
          }));
        }
        return end;
      },
    });

  clear('wave.clear', 0.72, 1, false);
  // The same figure in gold, because the snitch ended it.
  clear('wave.clear.snitch', 0.72, Math.pow(2, 5 / 12), true);

  // A quiet exhale — marks the breather without demanding attention.
  a.register('wave.grace', {
    tier: 3, gain: 0.20, poly: 1, minInterval: ms(1000),
    render: s => tone(s, { type: 'triangle', f0: 200, f1: 170, attack: ms(100), decay: ms(450), gain: 0.4 }),
  });
}

// ── 8.1 Roamers ─────────────────────────────────────────────────────────────

function registerRoamers(a: AudioSystem) {
  // TREASURE, not a siren (user call).  This was a 1050 Hz sine warbling on
  // an LFO, and it was the whine the playtest kept noticing: a held tone is
  // the one shape that cannot stop drawing attention to itself, and lowering
  // it out of the fatiguing band only made it a lower whine.
  //
  // The replacement is a TEXTURE rather than a tone — loose coins settling
  // into a pile, chain links gathering.  Sparse metallic transients say
  // "money nearby" without ever holding a pitch, so there is nothing to
  // fatigue against; it can idle for minutes the way the tone could not.
  //
  // Rendered as a looping BUFFER of scattered grains rather than live
  // oscillators.  A grain is an event, and scheduling events inside a loop
  // voice would need a timer this interface deliberately does not have —
  // baking them into a buffer puts the randomness at generation time and
  // costs one BufferSource to play.  Grains WRAP past the buffer end into
  // its start, so the loop is seamless with no crossfade.
  a.registerLoop('snitch.near', {
    tier: 2, gain: 0.15, positional: true,
    near: AUDIO_CONSTANTS.SNITCH_NEAR_RADIUS,
    far:  AUDIO_CONSTANTS.SNITCH_FAR_RADIUS,
    start: (s: SynthCtx): LoopVoice => {
      const { ctx, dest, t0 } = s;
      const buf = coinBuffer(ctx);

      // TWO copies at co-prime-ish rates, so the composite does not repeat
      // on the buffer's own period — one 4-second loop of sparse clinks is
      // short enough to notice.  The slower copy also reads as bigger coins.
      const mk = (rate: number, gain: number, offset: number) => {
        const src = ctx.createBufferSource();
        src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
        const g = ctx.createGain(); g.gain.value = gain;
        src.connect(g); g.connect(lp);
        src.start(t0, offset);
        return src;
      };
      // Takes the fizz off the transients without dulling the metal.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 2200; lp.Q.value = 0.6;
      lp.connect(dest);

      const a1 = mk(1.0, 0.5, 0);
      const a2 = mk(0.79, 0.32, buf.duration * 0.37);
      return {
        stop: now => {
          try { a1.stop(now + 0.12); a2.stop(now + 0.12); } catch { /* already stopped */ }
        },
      };
    },
  });

  a.register('snitch.dart', {
    tier: 2, gain: 0.30, poly: 2, minInterval: ms(180), jitter: 0.10, positional: true,
    render: s => noise(s, { f0: 2000, f1: 5000, type: 'bandpass', q: 1.5, attack: ms(2), decay: ms(220), gain: 0.5 }),
  });

  // The best sound in the game: a crystalline capture strike blooming into
  // a rising cascade as the board clears and salvage sprays.
  a.register('snitch.catch', {
    tier: 1, gain: 0.95, poly: 1, minInterval: ms(1500),
    render: s => {
      let end = tone(s, { type: 'triangle', f0: 1568, attack: ms(1), decay: ms(200), gain: 0.45 });
      const cascade = [784, 1047, 1319, 1568, 2093];
      for (let i = 0; i < cascade.length; i++) {
        end = Math.max(end, tone(s, {
          type: 'triangle', f0: cascade[i], attack: ms(3), decay: ms(600),
          gain: 0.3, delay: ms(180 + 80 * i),
        }));
      }
      return Math.max(end, noise(s, {
        f0: 5000, f1: 8000, type: 'highpass', attack: ms(200), decay: ms(1200), gain: 0.16,
      }));
    },
  });

  // A distant, enormous roar through a tearing rift.  Should make the
  // player look up.
  a.register('dragon.arrive', {
    tier: 1, gain: 0.72, poly: 1, minInterval: ms(2000), positional: true,
    render: s => Math.max(
      tone(s, { type: 'sawtooth', f0: 60, f1: 110, attack: ms(100), decay: ms(1200), gain: 0.45 }),
      tone(s, { type: 'triangle', f0: 240, f1: 420, attack: ms(140), decay: ms(1100), gain: 0.22 }),
      noise(s, { f0: 200, f1: 1800, type: 'bandpass', q: 1, attack: ms(200), decay: ms(1000), gain: 0.32 }),
    ),
  });

  a.register('dragon.provoked', {
    tier: 1, gain: 0.66, poly: 1, minInterval: ms(1000), positional: true,
    render: s => Math.max(
      tone(s, { type: 'sawtooth', f0: 90, f1: 140, attack: ms(40), decay: ms(800), gain: 0.5 }),
      tone(s, { type: 'triangle', f0: 300, f1: 520, attack: ms(50), decay: ms(700), gain: 0.24 }),
    ),
  });

  a.register('dragon.leave', {
    tier: 2, gain: 0.50, poly: 1, minInterval: ms(1000), positional: true,
    render: s => Math.max(
      tone(s, { type: 'sawtooth', f0: 110, f1: 45, attack: ms(200), decay: ms(1000), gain: 0.4 }),
      noise(s, { f0: 1800, f1: 200, type: 'bandpass', q: 1, attack: ms(150), decay: ms(950), gain: 0.28 }),
    ),
  });

  a.register('rival.warp.in', {
    tier: 2, gain: 0.42, poly: 2, minInterval: ms(400), jitter: 0.08, positional: true,
    render: s => Math.max(
      noise(s, { f0: 3000, type: 'highpass', attack: ms(1), decay: ms(80), gain: 0.4 }),
      tone(s, { type: 'sawtooth', f0: 200, f1: 600, attack: ms(80), decay: ms(560), gain: 0.28 }),
    ),
  });

  a.register('rival.warp.out', {
    tier: 2, gain: 0.38, poly: 2, minInterval: ms(400), jitter: 0.08, positional: true,
    render: s => Math.max(
      tone(s, { type: 'sawtooth', f0: 600, f1: 200, attack: ms(60), decay: ms(480), gain: 0.28 }),
      noise(s, { f0: 3000, type: 'highpass', attack: ms(1), decay: ms(80), gain: 0.35, delay: ms(500) }),
    ),
  });

  // Small but pointed — the player should feel robbed.
  a.register('rival.steal', {
    tier: 2, gain: 0.36, poly: 2, minInterval: ms(250), jitter: 0.05, positional: true,
    render: s => Math.max(
      tone(s, { type: 'triangle', f0: 520, f1: 480, attack: ms(2), decay: ms(140), gain: 0.35 }),
      tone(s, { type: 'triangle', f0: 340, f1: 330, attack: ms(2), decay: ms(180), gain: 0.35, delay: ms(140) }),
    ),
  });

  // A wet suction grab.  Uncomfortable on purpose: the player must
  // instantly know something is ON them.
  a.register('bubble.latch', {
    tier: 1, gain: 0.58, poly: 2, minInterval: ms(300), jitter: 0.10, positional: true,
    render: s => Math.max(
      tone(s, { f0: 300, f1: 120, attack: ms(5), decay: ms(370), gain: 0.5 }),
      noise(s, { f0: 1200, f1: 400, type: 'bandpass', q: 5, attack: ms(4), decay: ms(340), gain: 0.35 }),
    ),
  });

  // A PULSE rather than a drone: easier to tolerate over a long latch, and
  // it reads as damage ticks.
  a.registerLoop('bubble.drain', {
    tier: 1, gain: 0.34, positional: true,
    start: (s: SynthCtx): LoopVoice => {
      const { ctx, dest, t0 } = s;
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 90;
      const pulse = ctx.createOscillator(); pulse.type = 'square'; pulse.frequency.value = 3;
      const depth = ctx.createGain(); depth.gain.value = 0.25;
      const g = ctx.createGain(); g.gain.value = 0.3;
      pulse.connect(depth); depth.connect(g.gain);
      const crackle = ctx.createBufferSource();
      crackle.buffer = s.noise; crackle.loop = true;
      const cf = ctx.createBiquadFilter();
      cf.type = 'highpass'; cf.frequency.value = 4000;
      const cg = ctx.createGain(); cg.gain.value = 0.06;
      osc.connect(g); g.connect(dest);
      crackle.connect(cf); cf.connect(cg); cg.connect(dest);
      osc.start(t0); pulse.start(t0); crackle.start(t0);
      return {
        stop: now => {
          try { osc.stop(now + 0.12); pulse.stop(now + 0.12); crackle.stop(now + 0.12); }
          catch { /* already stopped */ }
        },
      };
    },
  });

  a.register('bubble.detach', {
    tier: 2, gain: 0.36, poly: 2, minInterval: ms(200), jitter: 0.10, positional: true,
    render: s => Math.max(
      tone(s, { f0: 200, f1: 90, attack: ms(2), decay: ms(270), gain: 0.45 }),
      tone(s, { type: 'triangle', f0: 400, f1: 180, attack: ms(6), decay: ms(240), gain: 0.2 }),
    ),
  });
}

// ── 8.2–8.3 Status effects + UI ─────────────────────────────────────────────

function registerStatusAndUI(a: AudioSystem) {
  // Acid bite.  Pitch rises one step per stack at the call site, so three
  // stacks are audible AS three.
  a.register('status.corrosion.apply', {
    tier: 1, gain: 0.46, poly: 2, minInterval: ms(250),
    render: s => Math.max(
      noise(s, { f0: 2500, f1: 1600, type: 'bandpass', q: 3, attack: ms(2), decay: ms(350), gain: 0.4 }),
      tone(s, { type: 'sawtooth', f0: 400, f1: 300, attack: ms(3), decay: ms(300), gain: 0.22 }),
    ),
  });

  // A descending power-down that ends DEAD.  The player is about to press
  // fire and get nothing; this is the warning.
  a.register('status.disable.apply', {
    tier: 1, gain: 0.58, poly: 1, minInterval: ms(400),
    render: s => Math.max(
      tone(s, { type: 'sawtooth', f0: 900, f1: 80, attack: ms(1), decay: ms(460), gain: 0.45 }),
      noise(s, { f0: 3000, f1: 300, type: 'lowpass', attack: ms(2), decay: ms(400), gain: 0.25 }),
    ),
  });

  // Dead air with intermittent failed-relay clicks: uncomfortable
  // emptiness rather than an alarm.
  a.registerLoop('status.disable.loop', {
    tier: 2, gain: 0.24,
    start: (s: SynthCtx): LoopVoice => {
      const { ctx, dest, t0 } = s;
      const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 60;
      const g = ctx.createGain(); g.gain.value = 0.35;
      const relay = ctx.createBufferSource();
      relay.buffer = s.noise; relay.loop = true;
      const rf = ctx.createBiquadFilter();
      rf.type = 'bandpass'; rf.frequency.value = 1200; rf.Q.value = 12;
      const rg = ctx.createGain(); rg.gain.value = 0.05;
      hum.connect(g); g.connect(dest);
      relay.connect(rf); rf.connect(rg); rg.connect(dest);
      hum.start(t0); relay.start(t0);
      return {
        stop: now => { try { hum.stop(now + 0.12); relay.stop(now + 0.12); } catch { /* already stopped */ } },
      };
    },
  });

  a.register('status.expire', {
    tier: 2, gain: 0.34, poly: 1, minInterval: ms(200),
    render: s => tone(s, { type: 'triangle', f0: 300, f1: 700, attack: ms(3), decay: ms(230), gain: 0.4 }),
  });

  // UI: all flat, all short, all quiet.  They play over menus where
  // nothing else is making noise, so they read louder than their gain.
  a.register('ui.nav', {
    tier: 2, gain: 0.24, poly: 2, minInterval: ms(50), jitter: 0.06,
    render: s => tone(s, { type: 'triangle', f0: 1100, f1: 900, attack: ms(1), decay: ms(45), gain: 0.4 }),
  });

  a.register('ui.confirm', {
    tier: 2, gain: 0.34, poly: 1, minInterval: ms(120),
    render: s => Math.max(
      tone(s, { type: 'triangle', f0: 660, attack: ms(2), decay: ms(70), gain: 0.4 }),
      tone(s, { type: 'triangle', f0: 880, attack: ms(2), decay: ms(110), gain: 0.4, delay: ms(70) }),
    ),
  });

  a.register('ui.back', {
    tier: 2, gain: 0.30, poly: 1, minInterval: ms(120),
    render: s => Math.max(
      tone(s, { type: 'triangle', f0: 880, attack: ms(2), decay: ms(60), gain: 0.35 }),
      tone(s, { type: 'triangle', f0: 660, attack: ms(2), decay: ms(100), gain: 0.35, delay: ms(60) }),
    ),
  });

  // Same voice as poi.reject at lower gain, so "no" sounds the same
  // everywhere in the game.
  a.register('ui.error', {
    tier: 2, gain: 0.26, poly: 1, minInterval: ms(250),
    render: s => Math.max(
      tone(s, { type: 'square', f0: 330, attack: ms(1), decay: ms(80), gain: 0.3 }),
      tone(s, { type: 'square', f0: 220, attack: ms(1), decay: ms(120), gain: 0.3, delay: ms(80) }),
    ),
  });

  a.register('ui.drag.pick', {
    tier: 3, gain: 0.20, poly: 2, minInterval: ms(60), jitter: 0.08,
    render: s => tone(s, { type: 'triangle', f0: 900, f1: 1100, attack: ms(1), decay: ms(55), gain: 0.4 }),
  });

  a.register('ui.drag.drop', {
    tier: 3, gain: 0.20, poly: 2, minInterval: ms(60), jitter: 0.08,
    render: s => tone(s, { type: 'triangle', f0: 1100, f1: 900, attack: ms(1), decay: ms(65), gain: 0.4 }),
  });
}
