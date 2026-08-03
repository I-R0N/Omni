import { AudioSystem, SynthCtx, tone, noise, ms, LoopVoice } from './AudioSystem';

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
export function registerSfx(a: AudioSystem) {
  registerWeapons(a);
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
  a.registerLoop('weapon.charge.loop', {
    tier: 1, gain: 0.28,
    start: (s: SynthCtx): LoopVoice => {
      const { ctx, dest, t0 } = s;
      const osc = ctx.createOscillator();
      const partial = ctx.createOscillator();
      const mix = ctx.createGain();
      osc.type = 'sine';
      partial.type = 'sawtooth';
      const f = (p: number) => 140 + (900 - 140) * p;
      osc.frequency.setValueAtTime(f(s.param), t0);
      partial.frequency.setValueAtTime(f(s.param) * 2, t0);
      mix.gain.value = 0.4;
      const sub = ctx.createGain();
      sub.gain.value = 0.18;
      osc.connect(mix); partial.connect(sub); sub.connect(mix); mix.connect(dest);
      osc.start(t0); partial.start(t0);
      return {
        set: (p, now) => {
          osc.frequency.setTargetAtTime(f(p), now, 0.04);
          partial.frequency.setTargetAtTime(f(p) * 2, now, 0.04);
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
