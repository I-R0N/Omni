"""OMNI — "Critical Mass", the third adaptive cue.  C minor, guitars in drop C,
150 BPM with half-time drums in the groove (it lands like ~75 BPM), 32 bars
(exactly 51.2 s).  GUITAR-FORWARD: every combat layer is built on the
overamped rig (guitar.amp_hi), the rhythm is quad-tracked by the heavy layer,
the bass is a distorted bass guitar, and the guitars are mixed ABOVE the
drums (the first two songs measured ~4 dB below).

Same render contract as compose.py.  `python song3.py [stem ...]` writes
out/c-<stem>.npy.
"""
import sys, os
import numpy as np
from synth import SR, rng_for, add_at, reverb, pingpong, svf, drive, pan_stereo
import instruments as I
import guitar as G

BPM = 150
BEAT = 60 / BPM
BAR = 4 * BEAT
STEP = BEAT / 4
BARS = 32
L = BARS * BAR          # 51.2 s
PRE = 0.5
POST = 1.5
N = int((2 * L + POST + 0.25) * SR)
ITER = (0, 1, 2)

CH = ['Cm', 'Cm', 'Ab', 'Bb', 'Cm', 'Cm', 'Fm', 'G',
      'Ab', 'Bb', 'Cm', 'Eb', 'Fm', 'Ab', 'Gsus', 'G']
VOICE = {'Cm': [48, 55, 60, 63, 67], 'Ab': [44, 56, 60, 63, 68], 'Bb': [46, 58, 62, 65, 70],
         'Fm': [53, 56, 60, 65, 68], 'G': [55, 59, 62, 67, 71], 'Eb': [51, 58, 63, 67, 70],
         'Gsus': [55, 60, 62, 67, 72]}
BASS = {'Cm': 36, 'Ab': 32, 'Bb': 34, 'Fm': 29, 'G': 31, 'Eb': 39, 'Gsus': 31}
KICK_F = 49.0   # G1, the fifth of C


def chord_at_bar(bar):
    return CH[(bar % BARS) // 2]


def root(ch):
    return 36 + ((BASS[ch] - 36) % 12)        # drop C: C2..B2


def T(bar, step=0.0, k=0):
    return k * L + bar * BAR + step * STEP


def S(sec):
    return int(round(sec * SR))


def new():
    return np.zeros((2, N), np.float32)


def place(buf, sig, sec):
    if sec * SR < N:
        add_at(buf, sig, S(sec))


def put(di, sig, sec):
    a = S(sec)
    if a >= N:
        return
    off = max(0, -a)
    a = max(0, a)
    e = min(N, a + len(sig) - off)
    if e > a:
        di[a:e] += sig[off:off + e - a]


def human(key, amt):
    return rng_for('h3', key).uniform(-amt, amt)


def mkick(vel, key):
    return I.metal_kick(vel, key, f_end=KICK_F)


# ── the riff ────────────────────────────────────────────────────────────────
# (step, length in 16ths, velocity, palm-muted, semitones above the chord root)
RIFF_A = [(0, 3, 1.0, False, 0), (3, 1, 0.85, True, 0), (4, 1, 0.85, True, 0), (6, 2, 0.95, False, 3),
          (8, 3, 1.0, False, 0), (11, 1, 0.85, True, 0), (12, 2, 0.95, False, 5), (14, 2, 0.95, False, 6)]
# the walk down through the tritone: G – Gb – F – Eb
RIFF_B = [(0, 2, 1.0, False, 0), (2, 1, 0.85, True, 0), (3, 1, 0.85, True, 0), (4, 1, 0.85, True, 0),
          (5, 1, 0.85, True, 0), (6, 2, 1.0, False, 7), (8, 2, 1.0, False, 6), (10, 2, 1.0, False, 5),
          (12, 4, 1.0, False, 3)]
FILL = [(0, 8, 1.0, False, 0)] + [(st, 1, 0.8 + 0.02 * st, True, 0) for st in range(8, 16)]


def riff(bar):
    if bar % 16 == 15:
        return FILL
    r = RIFF_A if bar % 2 == 0 else RIFF_B
    if chord_at_bar(bar) == 'Cm':
        return r
    # Away from the tonic the chromatic moves would clash with the chord, so
    # they collapse onto the root and its octave.  (Not the fifth: a power
    # chord ON the fifth adds the ninth — over G that is A, outside C minor.)
    return [(st, d, v, m, 0 if off == 0 else 12) for st, d, v, m, off in r]


def rhythm_take(take, voice, gain=1.0):
    di = np.zeros(N, np.float32)
    for k in ITER:
        for bar in range(BARS):
            r = root(chord_at_bar(bar))
            for st, d, v, mute, off in riff(bar):
                put(di, G.power_chord(r + off, d * STEP * 0.95, v, ('r3', bar, st, take), mute=mute, octave=not mute),
                    T(bar, st, k) + human((bar, st, take), 0.005))
    return G.amp_hi(di, gain, voice)


def bass_track():
    di = np.zeros(N, np.float32)
    for k in ITER:
        for bar in range(BARS):
            r = root(chord_at_bar(bar))
            for st, d, v, mute, off in riff(bar):
                put(di, G.bass_di(r + off - 12, d * STEP * 0.95, v, ('b3', bar, st), mute), T(bar, st, k))
    return G.bass_amp(di)


MELODY = [
    [(67, 2), (72, 2), (75, 3), (74, 1)],                  # Cm
    [(72, 2), (79, 4), (77, 1), (75, 1)],                  # Cm
    [(75, 2), (80, 3), (79, 1), (77, 2)],                  # Ab
    [(74, 2), (77, 2), (82, 4)],                           # Bb
    [(79, 2), (84, 2), (82, 1), (80, 1), (79, 2)],         # Cm
    [(75, 3), (77, 1), (79, 4)],                           # Cm
    [(80, 3), (79, 1), (77, 2), (72, 2)],                  # Fm
    [(71, 2), (74, 2), (79, 2), (77, 1), (74, 1)],         # G
    [(84, 4), (82, 2), (80, 2)],                           # Ab
    [(86, 4), (84, 2), (82, 2)],                           # Bb
    [(87, 4), (86, 2), (84, 2)],                           # Cm
    [(82, 3), (79, 1), (75, 4)],                           # Eb
    [(84, 3), (80, 1), (77, 2), (80, 2)],                  # Fm
    [(87, 4), (84, 2), (80, 2)],                           # Ab
    [(84, 4), (86, 4)],                                    # Gsus
    [(83, 4), (86, 2), (79, 2)],                           # G
]
assert all(abs(sum(d for _, d in slot) - 8) < 1e-9 for slot in MELODY)
SCALE = [0, 2, 3, 5, 7, 8, 10]          # C natural minor
SCALE_G = [0, 2, 3, 5, 7, 8, 11]        # B natural over G (harmonic minor)


def third_below(m, ch):
    pcs = SCALE_G if ch in ('G', 'Gsus') else SCALE
    pc = m % 12
    if pc not in pcs:
        return m - 3
    return m - ((pc - pcs[(pcs.index(pc) - 2) % 7]) % 12)


# ── stems ───────────────────────────────────────────────────────────────────

def stem_atmos():
    """Exploration: dark pad, low C drone, and distant amp-feedback swells —
    the rig is on and humming even when nothing is happening."""
    pad, low = new(), new()
    fb = np.zeros(N, np.float32)
    for k in ITER:
        for slot, ch in enumerate(CH):
            for i, m in enumerate(VOICE[ch]):
                place(pad, I.supersaw_pad(m, 2 * BAR + 0.15, 0.5 if i == 0 else 0.36, key=('c', slot, i), cutoff=800),
                      T(slot * 2, 0, k))
        for seg in range(4):
            for m, v in ((36, 0.5), (43, 0.25)):
                place(low, np.stack([I.drone(m, 8 * BAR + 1.5, v, key=('c', seg, m))] * 2), T(seg * 8, 0, k) - 1.0)
        for seg in range(8):   # one feedback swell per four bars, on the chord's fifth
            ch = chord_at_bar(seg * 4)
            n = int((3 * BAR) * SR)
            t = np.arange(n) / SR
            tone = G.lead_note(VOICE[ch][1] + 24, 3 * BAR, 0.5, ('fb', seg))[:n]
            tone *= np.clip(t / (1.6 * BAR), 0, 1) ** 2 * np.clip((3 * BAR - t) / (0.6 * BAR), 0, 1)
            put(fb, tone, T(seg * 4 + 1, 0, k))
    f = G.amp(fb, 40, 'lead')
    f = reverb(np.stack([f, f]), 5.0, 4.0, 0.7, 'pad', 5000)
    pad = reverb(pad, 4.5, 3.6, 0.55, 'pad', 4500)
    low = reverb(low, 3.0, 2.0, 0.25, 'room')
    return pad + low * 0.9 + f * 0.12


def stem_pulse():
    """Approach: one cranked guitar thudding palm-muted quarters on the root,
    hats ticking eighths."""
    di = np.zeros(N, np.float32)
    kit = new()
    for k in ITER:
        for bar in range(BARS):
            r = root(chord_at_bar(bar))
            for st in (0, 4, 8, 12):
                put(di, G.power_chord(r, STEP * 1.2, 0.85 if st == 0 else 0.7, ('p3', bar, st), mute=True),
                    T(bar, st, k))
            for st in range(0, 16, 2):
                place(kit, I.pan_stereo(I.hat(0.65 if st % 4 == 2 else 0.4, ('c', bar, st)), 0.25), T(bar, st, k))
    g = G.amp_hi(di, 0.8, 1)
    g = reverb(np.stack([g, g]), 1.5, 0.8, 0.12, 'small')
    kit = reverb(kit, 2.0, 1.0, 0.1, 'small')
    return g * 0.55 + kit


def stem_groove():
    """Engaged: the riff on two cranked guitars hard L/R, distorted bass,
    half-time drums (snare on 3) with the kick locked to the riff."""
    drums = new()
    for k in ITER:
        for bar in range(BARS):
            big = bar % 16 == 15
            hits = {st for st, *_ in riff(bar)}
            for st in sorted(hits):
                if st == 8 and not big:
                    continue
                place(drums, np.stack([mkick(1.0 if st % 4 == 0 else 0.85, ('c', bar, st))] * 2), T(bar, st, k))
            if not big:
                place(drums, np.stack([I.snare(1.0, ('c', bar, 8), decay=0.24) + I.clap(0.35, ('c', bar, 8))[:int(0.45 * SR)]] * 2),
                      T(bar, 8, k))
            else:
                for st in range(8, 16):
                    place(drums, np.stack([I.snare(0.45 + 0.07 * (st - 8), ('c', bar, st, 'f'))] * 2), T(bar, st, k))
            if bar % 4 == 0:
                place(drums, I.crash(0.9, ('c', bar, 'c')), T(bar, 0, k))
    Lg = rhythm_take('L', 0)
    Rg = rhythm_take('R', 1)
    bass = bass_track()
    gtr = np.stack([Lg * 0.95 + Rg * 0.1, Rg * 0.95 + Lg * 0.1])
    drums = reverb(drums, 1.6, 0.8, 0.12, 'small')
    return gtr * 1.0 + np.stack([bass, bass]) * 0.55 + drums * 0.72


def stem_heavy():
    """Pressure: two more takes on different amp voicings (quad-tracked
    wall), double kick, china on the off-beats, toms."""
    perc, kit = new(), new()
    for k in ITER:
        for bar in range(BARS):
            for st in range(16):
                place(kit, np.stack([mkick(0.7 if st % 2 == 0 else 0.58, ('c', bar, st, 'dk'))] * 2), T(bar, st, k))
            for st in (4, 12):
                place(perc, I.pan_stereo(I.ride(0.5, ('c', bar, st, 'r')), -0.3), T(bar, st, k))
            if bar % 16 == 15:
                for i, st in enumerate(range(8, 16)):
                    place(perc, I.pan_stereo(I.tom([53, 53, 50, 50, 46, 46, 43, 41][i], 0.95, ('c', bar, st)), 0.5 - i * 0.14),
                          T(bar, st, k))
    L2 = rhythm_take('L2', 2, 1.15)
    R2 = rhythm_take('R2', 3, 1.15)
    gtr = np.stack([L2 * 0.8 + R2 * 0.25, R2 * 0.8 + L2 * 0.25])
    perc = reverb(perc, 2.5, 1.5, 0.18, 'room', 7000)
    kit = reverb(kit, 1.2, 0.5, 0.05, 'small')
    return gtr * 1.0 + kit * 0.62 + perc * 0.62


def stem_apex():
    """The peak: a screaming lead with pinch-harmonic squeals on its accents,
    harmonised a third below in the second half; choir; builds."""
    di_a, di_b = np.zeros(N, np.float32), np.zeros(N, np.float32)
    ch_b, build = new(), new()
    for k in ITER:
        for slot, notes in enumerate(MELODY):
            b = slot * 8.0
            c = CH[slot]
            for i, (m, d) in enumerate(notes):
                sec = k * L + b * BEAT
                if sec * SR < N:
                    dur = d * BEAT * 0.96
                    bend = i == 0 or d >= 3
                    put(di_a, G.lead_note(m, dur, 0.95 if i == 0 else 0.85, ('a3', slot, i), bend), sec)
                    if d >= 3:   # squeal on the long notes
                        put(di_a, G.pinch(m, min(dur, 0.9), 0.35), sec + 0.02)
                    if slot >= 8:
                        put(di_b, G.lead_note(third_below(m, c), dur, 0.8, ('b3', slot, i), bend), sec)
                b += d
        for slot, c in enumerate(CH):
            for i, m in enumerate(VOICE[c][1:]):
                place(ch_b, I.choir(m, 2 * BAR + 0.1, 0.38, key=('c', slot, i)), T(slot * 2, 0, k))
        for half in (0, 16):
            for bar in (half + 14, half + 15):
                steps = range(0, 16, 2) if bar == half + 14 else range(16)
                for st in steps:
                    prog = ((bar - half - 14) * 16 + st) / 32
                    place(build, np.stack([I.snare(0.25 + 0.6 * prog, ('c', bar, st, 'b'), tone=196.0, decay=0.1)] * 2),
                          T(bar, st, k))
    la = G.amp(di_a, 60, 'lead')
    lb = G.amp(di_b, 60, 'lead')
    ld = np.stack([la * 0.9 + lb * 0.4, la * 0.5 + lb * 0.85])
    ld = pingpong(ld, 0.75 * BEAT, 0.33, 0.22, 0.3)
    ld = reverb(ld, 3.0, 2.2, 0.26, 'hall', 6500)
    ch_b = reverb(ch_b, 4.5, 3.4, 0.5, 'pad', 5000)
    build = reverb(build, 2.0, 1.2, 0.15, 'small')
    return ld * 0.8 + ch_b * 0.55 + build * 0.6


# Doom: (step, length, velocity, palm-muted, semitones above root) — root,
# the b2 a half-step up, back, then the tritone.
DOOM = [(0, 4, 1.0, False, 0), (4, 2, 0.95, False, 1), (6, 2, 0.9, False, 0), (8, 4, 1.0, False, 6),
        (12, 1, 0.85, True, 0), (13, 1, 0.85, True, 0), (14, 1, 0.85, True, 0), (15, 1, 0.9, True, 0)]
TAIKO = [(0, 1.0), (3, 0.6), (6, 0.8), (8, 0.95), (10, 0.5), (11, 0.65), (14, 0.85)]


def stem_boss():
    horn, drums = new(), new()
    di = np.zeros(N, np.float32)
    for k in ITER:
        for bar in range(BARS):
            r = root(chord_at_bar(bar))
            for st, d, v, mute, off in DOOM:
                put(di, G.power_chord(r + off, d * STEP * 0.95, v, ('d3', bar, st), mute=mute, octave=False),
                    T(bar, st, k) + human(('d3', bar, st), 0.003))
            for st, v in TAIKO:
                place(drums, I.pan_stereo(I.taiko(v, ('c', bar, st), 1.0 if st % 8 == 0 else 1.335), 0.15 if st % 2 else -0.15),
                      T(bar, st, k))
        for slot, ch in enumerate(CH):
            rt = BASS[ch] + 12
            for m in (rt, rt + 7, rt + 12):
                place(horn, I.boss_horn(m, 2 * BAR - 0.3, 0.5, key=('c', slot, m)), T(slot * 2, 0, k))
    g = G.amp_hi(di, 1.2, 2)
    horn = reverb(horn, 4.0, 3.0, 0.35, 'hall', 4000)
    drums = reverb(drums, 4.0, 2.6, 0.32, 'hall', 5000)
    return np.stack([g, g]) * 0.9 + horn * 0.6 + drums * 0.8


STEMS = {'atmos': stem_atmos, 'pulse': stem_pulse, 'groove': stem_groove,
         'heavy': stem_heavy, 'apex': stem_apex, 'boss': stem_boss}


def excerpt(buf):
    a = S(L - PRE)
    return buf[:, a:a + S(PRE + L + POST)]


def check_periodic(x):
    w = S(PRE + POST)
    return float(np.max(np.abs(x[:, :w] - x[:, S(L):S(L) + w])))


if __name__ == '__main__':
    os.makedirs('out', exist_ok=True)
    names = sys.argv[1:] or list(STEMS)
    for name in names:
        ex = excerpt(STEMS[name]())
        np.save(f'out/c-{name}.npy', ex.astype(np.float32))
        print(f'c-{name}: {ex.shape[1] / SR:.2f}s peak {np.max(np.abs(ex)):.3f} periodic-err {check_periodic(ex):.2e}', flush=True)
    if not sys.argv[1:]:
        np.save('out/c-riser.npy', I.riser(BAR))
        print('c-riser done')
