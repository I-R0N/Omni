# The adaptive score

Omni's music is three original songs, each rendered as six synchronised stems.
This page describes **Omni** (D minor, 128 BPM, 32 bars = 60 s, `compose.py`);
**Event Horizon** (E minor, 160 BPM, 32 bars = 48 s, `song2.py`) is the
heavier one — a thrash skank beat with 16th palm mutes in groove, a
syncopated 3+3+2 riff with double kick and chinas in heavy, twin leads in
thirds throughout in apex, and an E-against-F Phrygian chug for the boss.
Its pulse layer is a crunchy picked guitar arpeggio rather than a synth.
**Critical Mass** (C minor, drop-C guitars, 150 BPM with half-time drums,
51.2 s, `song3.py`) is built on the overamped rig (`guitar.amp_hi`): a sludge
riff walking G–G♭–F–E♭ on two hard-panned guitars plus a distorted bass in
groove, two more takes on different amp voicings in heavy (quad-tracked),
a screaming lead with pinch-harmonic squeals in apex, ♭2/tritone doom chords
for the boss, and distant amp-feedback swells in the exploration bed.
Guitars sit ~3 dB above the drums (the first two songs measure ~4 dB below).
Both are faded in and out by
intensity (`engine/systems/AdaptiveMusic.ts`). Everything is synthesized by
these scripts; there are no samples, so nothing here needs attribution.

| Stem | What plays | Comes in when |
|---|---|---|
| `atmos` | supersaw pads, D/A drone, FM bells (the theme, slowed, in bars 17–24) | always |
| `pulse` | 16th-note plucked arpeggio, hats, shaker, soft heartbeat kick | a hostile is within `MUSIC_ALERT_SCREENS` |
| `groove` | palm-muted gallop guitar (open chord on each change), kick locked to the gallop, snare, bass, fills | engaged (the combat gate) |
| `heavy` | double-tracked rhythm guitars hard L/R (open chords + chugs), 16th double kick, ride, crashes, toms | pressure / damage push intensity ≥ 0.62 |
| `apex` | the theme on lead guitar — harmonised in thirds in bars 17–32 — formant choir, snare builds | intensity ≥ 0.82 |
| `boss` | drop-D guitar ostinato (one upper ♭2 per bar) doubled by low brass, brass swells, taiko | a boss is on the field |

Plus `riser` (one bar, ends on the groove's entry downbeat) and `impact`
(boss arrival; a heavy entry at most once per 8 bars).

Chords, two bars each: **Dm B♭ F C Dm B♭ Gm A | B♭ C F Dm Gm B♭ Asus4 A**.
Guitars are in drop D (power-chord roots D2–C♯3). Drums are tuned into the
key (kicks settle on A1, snare body on F3, ride bell D7/A7, taiko A1/D2).

## Files

- `synth.py` — oscillators (PolyBLEP), state-variable filter, envelopes,
  generated-IR reverb, ping-pong delay, sidechain. numba-compiled.
- `instruments.py` — every non-guitar voice: drums, pads, plucks, basses,
  choir, boss brass, transitions.
- `guitar.py` — the guitars: Karplus-Strong strings (allpass-tuned, within
  half a cent), palm mutes, power chords strummed low-to-high, a two-stage
  asymmetric high-gain amp and a 4x12 cabinet (scooped mids, presence bump).
  A track is rendered clean, then amped as a whole, so chords distort
  together. Lead guitar is a bent, vibrato'd oscillator into the same amp.
  `amp_hi` is the overamped rig: overdrive pedal → three cold-clipping
  preamp stages → sagging power amp → 4x12 cab voiced for weight (bite to
  body ~5.7:1 vs ~12:1 for `amp`), four voicings for quad-tracking; plus a
  distorted bass rig and pinch-harmonic squeals.
- `compose.py` — the score itself (chord chart, melody, every pattern) and the
  stem renderers. Each stem is rendered as three passes of the loop and the
  steady-state middle pass is cut out, so reverb/delay tails wrap and the file
  is exactly periodic. `python compose.py groove` renders one stem.
- `song2.py` — Event Horizon, same structure and contract (writes `out/b-*`).
- `song3.py` — Critical Mass (writes `out/c-*`; its groove stays stereo).
- `mix.py` — (`python mix.py` Omni, `b-` Event Horizon, `c-` Critical Mass) per-stem loudness targets, soft clip, a report of every
  intensity stack's loudness and peak, one global trim.
- `stingers.py` — the three victory stingers (tonic chord resolving major, on each song's rig).
- `build.py` — every song end to end, encoded into `public/assets/audio/`
  (`score-*` Omni, `score2-*` Event Horizon, `score3-*` Critical Mass).

## Changing the music

Edit `compose.py` (patterns, `MELODY`, `CH`/`VOICE`) or `instruments.py`
(sounds), then `python scripts/score/build.py`. Keep `BPM`, `BARS`, `PRE`
in step with `SCORE` in `AdaptiveMusic.ts`. Rebalancing layers is a change to
`TARGET` in `mix.py` — the engine plays every layer at gain 1, so the balance
lives in the files.
