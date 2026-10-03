"""OMNI — "Event Horizon", the second adaptive cue.  E minor, 160 BPM,
32 bars (exactly 48 s).  Thrash / power metal: skank beat, 16th palm mutes,
a syncopated double-tracked riff, twin harmonised leads, a Phrygian boss chug.

Same six layers and the same rendering contract as compose.py (three passes,
steady-state middle excerpt, exactly periodic), so the engine treats it
identically.  `python song2.py [stem ...]` writes out/b-<stem>.npy.
"""
import sys, os
import numpy as np
from synth import SR, rng_for, add_at, reverb, pingpong, svf, drive, pan_stereo
import instruments as I
import guitar as G

BPM = 160
BEAT = 60 / BPM
BAR = 4 * BEAT
STEP = BEAT / 4
BARS = 32
L = BARS * BAR          # 48.0 s
PRE = 0.5
POST = 1.5
N = int((2 * L + POST + 0.25) * SR)
ITER = (0, 1, 2)

# Verse (bars 1-16): i VI VII V i VI iv V.  Chorus (17-32): VI VII i i iv VI Vsus V.
CH = ['Em', 'C', 'D', 'B', 'Em', 'C', 'Am', 'B',
      'C', 'D', 'Em', 'Em', 'Am', 'C', 'Bsus', 'B']
VOICE = {'Em': [52, 59, 64, 67, 71], 'C': [48, 55, 60, 64, 67], 'D': [50, 57, 62, 66, 69],
         'B': [47, 54, 59, 63, 66], 'Am': [45, 52, 57, 60, 64], 'Bsus': [47, 54, 59, 64, 66]}
BASS = {'Em': 40, 'C': 36, 'D': 38, 'B': 35, 'Am': 33, 'Bsus': 35}
SCALE = {'default': [4, 6, 7, 9, 11, 0, 2], 'B': [4, 6, 7, 9, 11, 0, 3]}  # D# over B (harmonic minor)


KICK_F = 61.74   # kicks settle on B1, the fifth of E (song A's sit on A1, the fifth of D)


def kick_b(vel, key):
    return I.kick(vel, key, f_end=KICK_F)


def mkick_b(vel, key):
    return I.metal_kick(vel, key, f_end=KICK_F)


def chord_at_bar(bar):
    return CH[(bar % BARS) // 2]


def metal_root(ch):
    return 38 + ((BASS[ch] - 38) % 12)       # drop D: D2..C#3


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
    return rng_for('h2', key).uniform(-amt, amt)


def china(vel=1.0, key=0):
    """Trashy china: narrow-band metallic noise, fast and bright."""
    n = int(1.1 * SR)
    t = np.arange(n) / SR
    out = []
    for ch in range(2):
        r = rng_for('china', key, ch)
        nz = r.standard_normal(n).astype(np.float32)
        m = sum(I.square(f, n, r.random()) for f in (329.6, 493.9, 659.3, 987.8, 1318.5)) * 0.2
        sig = svf(nz + m, 3800, 1.6, 'bp') + svf(nz, 7000, 0.8, 'hp') * 0.4
        env = np.minimum(t / 0.001, 1) * np.exp(-t / 0.28)
        out.append(drive(sig * env * vel * 0.6, 1.5))
    return np.stack(out).astype(np.float32)


E4, Fs4, G4, A4, B4, C5, D5, Ds5, E5, Fs5, G5, A5, B5, C6 = 64, 66, 67, 69, 71, 72, 74, 75, 76, 78, 79, 81, 83, 84
MELODY = [
    [(B4, 1), (E5, 1), (G5, 1), (Fs5, .5), (E5, .5), (B5, 2), (A5, 1), (G5, 1)],   # Em
    [(G5, 1), (E5, 1), (C5, 1), (E5, 1), (G5, 2), (Fs5, 1), (E5, 1)],               # C
    [(Fs5, 1.5), (A5, 1.5), (D5, 1), (Fs5, 1), (A5, 1), (G5, 1), (Fs5, 1)],         # D
    [(Ds5, 2), (Fs5, 2), (B5, 2), (A5, 1), (Fs5, 1)],                               # B
    [(B4, 1), (E5, 1), (G5, 1), (B5, 1), (A5, 1), (G5, 1), (Fs5, 1), (G5, 1)],      # Em
    [(E5, 2), (G5, 1), (C6, 3), (B5, 1), (G5, 1)],                                  # C
    [(A5, 1.5), (E5, 1.5), (C5, 1), (A4, 1), (C5, 1), (E5, 2)],                     # Am
    [(Ds5, 1), (Fs5, 1), (B5, 2), (A5, 1), (Fs5, 1), (Ds5, 2)],                     # B
    [(G5, 3), (E5, 1), (G5, 2), (C6, 2)],                                           # C
    [(A5, 3), (Fs5, 1), (D5, 2), (A5, 2)],                                          # D
    [(B5, 4), (G5, 2), (E5, 2)],                                                    # Em
    [(Fs5, 2), (G5, 2), (A5, 2), (B5, 2)],                                          # Em
    [(C6, 3), (B5, 1), (A5, 2), (E5, 2)],                                           # Am
    [(G5, 3), (A5, 1), (G5, 2), (E5, 2)],                                           # C
    [(E5, 2), (Fs5, 2), (B5, 4)],                                                   # Bsus
    [(Ds5, 2), (Fs5, 2), (B4, 4)],                                                  # B
]
assert all(abs(sum(d for _, d in slot) - 8) < 1e-9 for slot in MELODY)


def third_below(m, ch):
    pcs = SCALE['B'] if ch == 'B' else SCALE['default']
    pc = m % 12
    if pc not in pcs:
        return m - 3
    target = pcs[(pcs.index(pc) - 2) % 7]
    return m - ((pc - target) % 12)


# ── stems ───────────────────────────────────────────────────────────────────

def stem_atmos():
    pad, bells, low = new(), new(), new()
    for k in ITER:
        for slot, ch in enumerate(CH):
            for i, m in enumerate(VOICE[ch]):
                place(pad, I.supersaw_pad(m, 2 * BAR + 0.15, 0.55 if i == 0 else 0.4, key=('b', slot, i), cutoff=900),
                      T(slot * 2, 0, k))
        for seg in range(4):
            for m, v in ((40, 0.5), (47, 0.25)):
                place(low, np.stack([I.drone(m, 8 * BAR + 1.5, v, key=('b', seg, m))] * 2), T(seg * 8, 0, k) - 1.0)
        for seg in range(8):
            place(low, I.shimmer(4 * BAR, 0.15, key=('b', seg)), T(seg * 4, 0, k))
        for bar in range(BARS):
            r = rng_for('bellpos2', bar)
            if r.random() < 0.1:    # a rare accent (trimmed on feedback)
                tones = VOICE[chord_at_bar(bar)][1:]
                m = tones[r.integers(len(tones))] + 12 * (1 + (r.random() < 0.3))
                place(bells, I.bell(int(m), 0.3 + 0.15 * r.random(), key=('b', bar)), T(bar, int(r.choice([0, 4, 8, 10])), k))
    pad = reverb(pad, 4.5, 3.6, 0.55, 'pad', 4500)
    bells = pingpong(bells, 0.75 * BEAT, 0.5, 0.35)
    bells = reverb(bells, 4.5, 3.6, 0.6, 'pad', 7000)
    low = reverb(low, 3.0, 2.0, 0.25, 'room')
    return pad + bells * 0.5 + low * 0.9


ARP = [0, 2, 3, 2, 1, 2, 3, 4, 0, 2, 3, 2, 1, 3, 2, 1]


def stem_pulse():
    """Approach: a crunchy picked arpeggio (light gain) and ticking hats."""
    di = np.zeros(N, np.float32)
    kit = new()
    for k in ITER:
        for bar in range(BARS):
            v = VOICE[chord_at_bar(bar)]
            tones = [v[1], v[2], v[3], v[4], v[2] + 12]
            for st in range(16):
                put(di, G.string(tones[ARP[st]], STEP * 1.6, 0.9 if st % 4 == 0 else 0.7, ('p2', bar, st)),
                    T(bar, st, k) + human((bar, st, 'p'), 0.003))
            for st in range(0, 16, 2):
                place(kit, I.pan_stereo(I.hat(0.7 if st % 4 == 2 else 0.4, ('b', bar, st)), 0.25), T(bar, st, k))
            for st in (0, 8):
                place(kit, np.stack([kick_b(0.22, ('b', bar, st))] * 2), T(bar, st, k))
    g = G.amp(di, 6, 'lead')
    arp = pingpong(np.stack([g, g]), 0.75 * BEAT, 0.38, 0.3, 0.3)
    arp = reverb(arp, 2.5, 1.6, 0.25, 'room', 6000)
    kit = reverb(kit, 2.0, 1.0, 0.1, 'small')
    return arp * 0.45 + kit


def stem_groove():
    """Engaged: thrash skank beat, 16th palm mutes with open accents, bass."""
    drums, bass = new(), new()
    di = np.zeros(N, np.float32)
    for k in ITER:
        for bar in range(BARS):
            big = bar % 16 == 15
            ch = chord_at_bar(bar)
            r = metal_root(ch)
            for st in (0, 4, 8, 12):          # kick on the beat…
                place(drums, np.stack([mkick_b(1.0, ('b', bar, st))] * 2), T(bar, st, k))
            for st in (2, 6, 10, 14):         # …snare on the "and": the skank beat
                if big and st >= 10:
                    continue
                place(drums, np.stack([I.snare(0.85 if st % 8 == 6 else 0.75, ('b', bar, st), decay=0.15)] * 2), T(bar, st, k))
            if bar % 8 == 7:
                start = 8 if big else 12
                for st in range(start, 16):
                    place(drums, np.stack([I.snare(0.4 + 0.6 * (st - start) / (15 - start), ('b', bar, st, 'f'))] * 2),
                          T(bar, st, k))
            opens = (0, 6, 12) if bar % 2 == 0 else (0, 3, 10)
            for st in range(16):
                if big and st >= 8:
                    continue
                sec = T(bar, st, k) + human(('g2', bar, st), 0.002)
                if st in opens:
                    put(di, G.power_chord(r, STEP * 1.8, 1.0, ('g2', bar, st)), sec)
                elif st - 1 not in opens:
                    put(di, G.power_chord(r, STEP * 0.9, 0.85 if st % 2 == 0 else 0.72, ('g2', bar, st), mute=True), sec)
            for st in range(0, 16, 2):
                if big and st >= 8:
                    continue
                place(bass, np.stack([I.sub_bass(BASS[ch] + 12, STEP * 1.7, 1.0 if st % 4 == 0 else 0.85)] * 2), T(bar, st, k))
            if big:
                put(di, G.power_chord(r, STEP * 7.5, 1.0, ('g2', bar, 'ring')), T(bar, 8, k))
                place(bass, np.stack([I.sub_bass(BASS[ch] + 12, STEP * 7, 0.9)] * 2), T(bar, 8, k))
    gtr = G.amp(di, 75)
    drums = reverb(drums, 1.5, 0.7, 0.1, 'small')
    return drums + bass * 0.75 + np.stack([gtr, gtr]) * 0.55


def heavy_pattern(bar):
    """(step, length, velocity, palm-muted) — a syncopated 3+3+2 riff."""
    if bar % 16 == 15:
        return [(0, 8, 1.0, False)] + [(st, 1, 0.75 + 0.02 * st, True) for st in range(8, 16)]
    if bar % 2 == 0:
        return [(0, 3, 1.0, False), (3, 1, 0.8, True), (4, 1, 0.8, True), (5, 1, 0.8, True),
                (6, 2, 0.95, False), (8, 1, 0.8, True), (9, 1, 0.8, True), (10, 2, 0.95, False),
                (12, 1, 0.82, True), (13, 1, 0.78, True), (14, 1, 0.82, True), (15, 1, 0.78, True)]
    return [(0, 2, 1.0, False), (2, 1, 0.8, True), (3, 2, 0.95, False), (5, 1, 0.8, True),
            (6, 2, 0.95, False)] + [(st, 1, 0.84 if st % 2 == 0 else 0.76, True) for st in range(8, 14)] + \
           [(14, 2, 1.0, False)]


def guitar_take(pattern_fn, take, gain=80):
    di = np.zeros(N, np.float32)
    for k in ITER:
        for bar in range(BARS):
            r = metal_root(chord_at_bar(bar))
            for st, d, v, mute in pattern_fn(bar):
                put(di, G.power_chord(r, d * STEP * 0.95, v, ('h2', bar, st, take), mute=mute),
                    T(bar, st, k) + human((bar, st, take, 'h2'), 0.006))
    return G.amp(di, gain)


def stem_heavy():
    """Pressure: double-tracked riff, 16th double kick, chinas, toms."""
    perc, kit = new(), new()
    for k in ITER:
        for bar in range(BARS):
            for st in range(16):
                place(kit, np.stack([mkick_b(0.72 if st % 2 == 0 else 0.6, ('b', bar, st, 'dk'))] * 2), T(bar, st, k))
            for st in (4, 12):
                place(perc, china(0.8, ('b', bar, st)), T(bar, st, k))
            if bar % 4 == 0:
                place(perc, I.crash(1.0, ('b', bar, 'c')), T(bar, 0, k))
            if bar % 16 == 15:
                for i, st in enumerate(range(8, 16)):
                    place(perc, I.pan_stereo(I.tom([55, 55, 52, 52, 48, 48, 45, 43][i], 0.9, ('b', bar, st)), 0.5 - i * 0.14),
                          T(bar, st, k))
    Lg = guitar_take(heavy_pattern, 'L')
    Rg = guitar_take(heavy_pattern, 'R')
    gtr = np.stack([Lg * 0.95 + Rg * 0.12, Rg * 0.95 + Lg * 0.12])
    perc = reverb(perc, 2.5, 1.5, 0.18, 'room', 7000)
    kit = reverb(kit, 1.2, 0.5, 0.05, 'small')
    return gtr * 0.6 + perc * 0.75 + kit * 0.7


def stem_apex():
    """The peak: twin leads harmonised in thirds the whole way, choir, builds."""
    di_a, di_b = np.zeros(N, np.float32), np.zeros(N, np.float32)
    ch_b, build = new(), new()
    for k in ITER:
        for slot, notes in enumerate(MELODY):
            b = slot * 8.0
            c = CH[slot]
            for i, (m, d) in enumerate(notes):
                sec = k * L + b * BEAT
                bend = i == 0 or d >= 3
                if sec * SR < N:
                    put(di_a, G.lead_note(m, d * BEAT * 0.96, 0.95 if i == 0 else 0.85, ('a2', slot, i), bend), sec)
                    put(di_b, G.lead_note(third_below(m, c), d * BEAT * 0.96, 0.8, ('b2', slot, i), bend), sec)
                b += d
        for slot, c in enumerate(CH):
            for i, m in enumerate(VOICE[c][1:]):
                place(ch_b, I.choir(m, 2 * BAR + 0.1, 0.4, key=('b', slot, i)), T(slot * 2, 0, k))
        for half in (0, 16):
            for bar in (half + 14, half + 15):
                steps = range(0, 16, 2) if bar == half + 14 else range(16)
                for st in steps:
                    prog = ((bar - half - 14) * 16 + st) / 32
                    place(build, np.stack([I.snare(0.25 + 0.6 * prog, ('b', bar, st, 'b'), tone=220.0, decay=0.1)] * 2),
                          T(bar, st, k))
    la = G.amp(di_a, 35, 'lead')
    lb = G.amp(di_b, 35, 'lead')
    ld = np.stack([la * 0.9 + lb * 0.4, la * 0.4 + lb * 0.9])
    ld = pingpong(ld, 0.75 * BEAT, 0.33, 0.22, 0.3)
    ld = reverb(ld, 3.0, 2.2, 0.26, 'hall', 6500)
    ch_b = reverb(ch_b, 4.5, 3.4, 0.5, 'pad', 5000)
    build = reverb(build, 2.0, 1.2, 0.15, 'small')
    return ld * 0.75 + ch_b * 0.6 + build * 0.7


TAIKO = [(0, 1.0), (3, 0.6), (6, 0.8), (8, 0.95), (10, 0.5), (11, 0.65), (14, 0.85)]
OSTINATO = [0, 0, 1, 0, 0, 12, 1, 0]   # Phrygian: the b2 IS the menace here


def stem_boss():
    brass, horn, drums = new(), new(), new()
    di = np.zeros(N, np.float32)
    for k in ITER:
        for bar in range(BARS):
            ch = chord_at_bar(bar)
            for i, off in enumerate(OSTINATO):
                place(brass, np.stack([I.boss_brass(BASS[ch] + 12 + off, BEAT * 0.4, 1.0 if i in (0, 4) else 0.8,
                                                    key=('b', bar, i))] * 2), T(bar, i * 2, k))
                put(di, G.power_chord(metal_root(ch) + off, STEP * 1.8, 1.0 if i in (0, 4) else 0.85, ('bg2', bar, i),
                                      mute=off == 0, octave=False),
                    T(bar, i * 2, k) + human(('bg2', bar, i), 0.003))
            for st, v in TAIKO:
                place(drums, I.pan_stereo(I.taiko(v, ('b', bar, st), 1.0 if st % 8 == 0 else 1.335), 0.15 if st % 2 else -0.15),
                      T(bar, st, k))
        for slot, ch in enumerate(CH):
            root = BASS[ch] + 12
            for m in (root, root + 7, root + 12):
                place(horn, I.boss_horn(m, 2 * BAR - 0.3, 0.5, key=('b', slot, m)), T(slot * 2, 0, k))
    gtr = G.amp(di, 85)
    brass = reverb(brass, 2.0, 1.2, 0.12, 'room', 4000)
    horn = reverb(horn, 4.0, 3.0, 0.35, 'hall', 4000)
    drums = reverb(drums, 4.0, 2.6, 0.32, 'hall', 5000)
    return brass * 0.45 + horn * 0.8 + drums + np.stack([gtr, gtr]) * 0.6


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
        np.save(f'out/b-{name}.npy', ex.astype(np.float32))
        print(f'b-{name}: {ex.shape[1] / SR:.2f}s peak {np.max(np.abs(ex)):.3f} periodic-err {check_periodic(ex):.2e}', flush=True)
    if not sys.argv[1:]:
        np.save('out/b-riser.npy', I.riser(BAR))
        print('b-riser done')
