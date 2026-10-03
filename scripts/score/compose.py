"""OMNI — adaptive score.  D minor, 128 BPM, 32 bars (exactly 60 s).

Six synchronised stems share one timeline; the game fades them in and out by
intensity.  Each stem is rendered as THREE passes of the loop so reverb and
delay tails from the previous pass wrap into the next, then the steady-state
middle pass is cut out with PRE seconds of lead-in and POST seconds of
run-out.  Because that excerpt is exactly periodic with period L, ANY loop
window [s, s+L] with s in [0, PRE+POST) loops seamlessly — which is what
makes the loop immune to MP3 encoder/decoder delay differences between
browsers.
"""
import sys, os, json
import numpy as np
import soundfile as sf
from synth import SR, rng_for, add_at, reverb, pingpong, sidechain, svf, drive
import instruments as I
import guitar as G

BPM = 128
BEAT = 60 / BPM
BAR = 4 * BEAT
STEP = BEAT / 4
BARS = 32
L = BARS * BAR          # 60.0 s
PRE = 0.5
POST = 1.5
N = int((2 * L + POST + 0.25) * SR)
ITER = (0, 1, 2)

# Chord per 2-bar slot (16 slots).  Half A: i VI III VII i VI iv V.
# Half B: VI VII III i iv VI Vsus V  (deceptive A→Bb links the halves).
CH = ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A',
      'Bb', 'C', 'F', 'Dm', 'Gm', 'Bb', 'Asus', 'A']
VOICE = {'Dm': [50, 57, 62, 65, 69], 'Bb': [46, 58, 62, 65, 69], 'F': [53, 57, 60, 65, 69],
         'C': [48, 55, 60, 64, 67], 'Gm': [55, 58, 62, 67, 70], 'A': [57, 61, 64, 69, 73],
         'Asus': [57, 62, 64, 69, 74]}
BASS = {'Dm': 38, 'Bb': 34, 'F': 41, 'C': 36, 'Gm': 31, 'A': 33, 'Asus': 33}


def chord_at_bar(bar):
    return CH[(bar % BARS) // 2]


def power_root(ch):
    b = BASS[ch]
    return 45 + ((b - 45) % 12)


def T(bar, step=0.0, k=0):
    """Absolute seconds for loop iteration k, bar (0-based), 16th step."""
    return k * L + bar * BAR + step * STEP


def S(sec):
    return int(round(sec * SR))


def new():
    return np.zeros((2, N), np.float32)


def place(buf, sig, sec):
    if sec * SR < N:
        add_at(buf, sig, S(sec))


def put(di, sig, sec):
    """Mix a mono note into a mono track buffer, clipped to its bounds."""
    a = S(sec)
    if a >= N:
        return
    off = max(0, -a)
    a = max(0, a)
    e = min(N, a + len(sig) - off)
    if e > a:
        di[a:e] += sig[off:off + e - a]


def human(key, amt):
    return rng_for('h', key).uniform(-amt, amt)


# Melody (beats).  Half A theme then half B climax; 8 beats per chord slot.
A4, B4, C5, Cs5, D5, E5, F5, G5, A5, Bb4, Bb5, C6, Cs6, D6, E6 = 69, 71, 72, 73, 74, 76, 77, 79, 81, 70, 82, 84, 85, 86, 88
MELODY = [
    [(A4, 1.5), (D5, 1.5), (E5, 1), (F5, 2), (E5, 1), (D5, 1)],          # Dm
    [(F5, 1.5), (D5, 1.5), (Bb4, 1), (C5, 1), (D5, 3)],                  # Bb
    [(C5, 1.5), (F5, 1.5), (A5, 1), (G5, 2), (F5, 1), (E5, 1)],          # F
    [(E5, 1.5), (G5, 1.5), (E5, 1), (C5, 4)],                            # C
    [(A4, 1.5), (D5, 1.5), (E5, 1), (F5, 2), (G5, 1), (A5, 1)],          # Dm
    [(Bb5, 3), (A5, 1), (F5, 2), (D5, 2)],                               # Bb
    [(G5, 1.5), (Bb5, 1.5), (A5, 1), (G5, 1), (F5, 1), (D5, 2)],         # Gm
    [(E5, 2), (Cs5, 2), (A4, 2), (E5, 1), (Cs5, 1)],                     # A
    [(D6, 3), (C6, 1), (Bb5, 2), (F5, 2)],                               # Bb
    [(C6, 3), (Bb5, 1), (G5, 2), (E5, 2)],                               # C
    [(A5, 1.5), (C6, 1.5), (A5, 1), (G5, 1), (F5, 3)],                   # F
    [(A5, 2), (F5, 1), (D5, 1), (E5, 1), (F5, 1), (A5, 2)],              # Dm
    [(Bb5, 3), (A5, 1), (G5, 2), (D5, 2)],                               # Gm
    [(F5, 1.5), (Bb5, 1.5), (D6, 1), (C6, 2), (Bb5, 2)],                 # Bb
    [(E6, 2), (D6, 2), (A5, 4)],                                         # Asus
    [(Cs6, 2), (E6, 2), (A5, 4)],                                        # A
]
assert all(abs(sum(d for _, d in slot) - 8) < 1e-9 for slot in MELODY)


# ── stems ───────────────────────────────────────────────────────────────────

def stem_atmos():
    pad, bells, low = new(), new(), new()
    for k in ITER:
        for slot, ch in enumerate(CH):
            bar = slot * 2
            for i, m in enumerate(VOICE[ch]):
                v = 0.55 if i == 0 else 0.42
                place(pad, I.supersaw_pad(m, 2 * BAR + 0.15, v, key=(slot, i)), T(bar, 0, k))
        for seg in range(4):  # drone in 8-bar notes, overlapping
            for m, v in ((38, 0.5), (45, 0.28)):
                place(low, np.stack([I.drone(m, 8 * BAR + 1.5, v, key=(seg, m))] * 2), T(seg * 8, 0, k) - 1.0)
        for seg in range(8):
            place(low, I.shimmer(4 * BAR, 0.18, key=seg), T(seg * 4, 0, k))
        # bells: a RARE accent (trimmed on feedback — they were too present):
        # four anchor notes of the theme, slowed, across bars 17-24, and a
        # chord tone in roughly one bar in ten elsewhere
        motif = [(16, 0, 81), (18, 0, 88), (20, 0, 81), (22, 0, 86)]
        for bar, step, m in motif:
            place(bells, I.bell(m, 0.5, key=(bar, step)), T(bar, step, k))
        for bar in list(range(0, 16)) + list(range(24, 32)):
            r = rng_for('bellpos', bar)
            if r.random() < 0.1:
                tones = VOICE[chord_at_bar(bar)][1:]
                m = tones[r.integers(len(tones))] + 12 * (1 + (r.random() < 0.35))
                step = int(r.choice([0, 4, 6, 8, 10, 12]))
                place(bells, I.bell(int(m), 0.28 + 0.15 * r.random(), key=(bar, 'r')), T(bar, step, k))
    pad = reverb(pad, 4.5, 3.6, 0.55, 'pad', 5000)
    bells = pingpong(bells, 0.75 * BEAT, 0.5, 0.35)
    bells = reverb(bells, 4.5, 3.6, 0.6, 'pad', 7000)
    low = reverb(low, 3.0, 2.0, 0.25, 'room')
    return pad + bells * 0.5 + low * 0.9


ARP = [0, 2, 4, 2, 1, 3, 4, 3, 0, 2, 4, 2, 3, 1, 2, 3]


def stem_pulse():
    arp, kit = new(), new()
    for k in ITER:
        for bar in range(BARS):
            ch = chord_at_bar(bar)
            v = VOICE[ch]
            tones = [v[1], v[2], v[3], v[4], v[2] + 12]
            for st in range(16):
                m = tones[ARP[st]]
                vel = (0.95 if st % 4 == 0 else 0.7 if st % 2 == 0 else 0.55) * (0.92 + 0.08 * (bar % 2))
                bright = 0.6 + 0.4 * ((bar % 8) / 7)
                place(arp, I.pan_stereo(I.pluck(m, vel, key=(bar, st), bright=bright),
                                        -0.35 if st % 2 else 0.35), T(bar, st, k))
            for st in range(16):
                key = (bar, st)
                if st % 4 == 2:
                    vel = 0.75
                elif st % 2 == 0:
                    vel = 0.42
                else:
                    vel = 0.26
                place(kit, I.pan_stereo(I.hat(vel, key), 0.25), T(bar, st, k) + human(key, 0.003))
                place(kit, I.pan_stereo(I.shaker(0.35 if st % 2 else 0.2, key), -0.4), T(bar, st, k))
            # soft heartbeat on beats 1 and 3: tension without a groove
            for st in (0, 8):
                place(kit, np.stack([I.kick(0.22, (bar, st))] * 2), T(bar, st, k))
    arp = pingpong(arp, 0.75 * BEAT, 0.42, 0.32, 0.3)
    arp = reverb(arp, 2.5, 1.6, 0.22, 'room', 6000)
    kit = reverb(kit, 2.0, 1.0, 0.1, 'small')
    return arp * 0.85 + kit


def is_fill(bar):
    return bar % 8 == 7


def metal_root(ch):
    """Power-chord root in drop-D range: D2 (38) .. C#3 (49)."""
    return 38 + ((BASS[ch] - 38) % 12)


GALLOP = (0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15)


def stem_groove():
    """Engaged: palm-muted gallop guitar, kick locked to it, bass, snare."""
    drums, bass = new(), new()
    di = np.zeros(N, np.float32)
    for k in ITER:
        for bar in range(BARS):
            big = bar % 16 == 15
            ch = chord_at_bar(bar)
            r = metal_root(ch)
            kicks = (0, 2, 3, 4, 8, 10, 11, 12)
            for st in kicks:
                if big and st >= 12:
                    continue
                place(drums, np.stack([I.metal_kick(1.0 if st % 4 == 0 else 0.8, (bar, st))] * 2), T(bar, st, k))
            for st in (4, 12):
                if big and st == 12:
                    continue
                place(drums, np.stack([I.snare(1.0, (bar, st), decay=0.2) + I.clap(0.3, (bar, st))[:int(0.45 * SR)]] * 2), T(bar, st, k))
            if is_fill(bar):
                start = 8 if big else 12
                for st in range(start, 16):
                    v = 0.4 + 0.6 * (st - start) / (15 - start)
                    place(drums, np.stack([I.snare(v, (bar, st, 'f'))] * 2), T(bar, st, k))
            # guitar: open chord on each chord change, palm-muted gallop otherwise
            for st in GALLOP:
                if big and st >= 8:
                    continue
                opening = bar % 2 == 0 and st == 0
                sec = T(bar, st, k) + human((bar, st, 'g'), 0.002)
                if opening:
                    put(di, G.power_chord(r, STEP * 1.9, 1.0, (bar, st), mute=False), sec)
                else:
                    put(di, G.power_chord(r, STEP * 0.9, 0.95 if st % 4 == 0 else 0.8, (bar, st), mute=True), sec)
                m = BASS[ch] + 12
                place(bass, np.stack([I.sub_bass(m, STEP * 0.85, 1.0 if st % 4 == 0 else 0.8)] * 2), T(bar, st, k))
            if big:  # let the chord ring under the fill
                put(di, G.power_chord(r, STEP * 7.5, 1.0, (bar, 'ring')), T(bar, 8, k))
                place(bass, np.stack([I.sub_bass(BASS[ch] + 12, STEP * 7, 0.9)] * 2), T(bar, 8, k))
    gtr = G.amp(di, 70)
    drums = reverb(drums, 1.5, 0.7, 0.1, 'small')
    return drums + bass * 0.75 + np.stack([gtr, gtr]) * 0.55


def guitar_take(pattern_fn, take, gain=70):
    """Render one rhythm-guitar take: pattern_fn(bar) → [(step, dur_steps, vel, mute)]."""
    di = np.zeros(N, np.float32)
    for k in ITER:
        for bar in range(BARS):
            r = metal_root(chord_at_bar(bar))
            for st, d, v, mute in pattern_fn(bar):
                put(di, G.power_chord(r, d * STEP * 0.95, v, (bar, st, take), mute=mute),
                    T(bar, st, k) + human((bar, st, take), 0.006))
    return G.amp(di, gain)


def heavy_pattern(bar):
    if bar % 16 == 15:
        return [(0, 8, 1.0, False)] + [(st, 1, 0.75 + 0.02 * st, True) for st in range(8, 16)]
    if bar % 2 == 0:
        return [(0, 4, 1.0, False), (4, 1, 0.8, True), (5, 1, 0.8, True), (6, 1, 0.85, True), (7, 1, 0.8, True),
                (8, 2, 0.95, False), (10, 1, 0.8, True), (11, 1, 0.8, True), (12, 2, 0.95, False),
                (14, 1, 0.8, True), (15, 1, 0.85, True)]
    return [(0, 2, 1.0, False), (3, 2, 0.95, False), (6, 2, 0.95, False)] + \
           [(st, 1, 0.82 if st % 2 == 0 else 0.75, True) for st in range(8, 16)]


def stem_heavy():
    """Pressure: a wall of double-tracked guitars, double kick, cymbals, toms."""
    perc, kit = new(), new()
    for k in ITER:
        for bar in range(BARS):
            for st in range(16):  # double kick: steady 16ths
                place(kit, np.stack([I.metal_kick(0.75 if st % 2 == 0 else 0.6, (bar, st, 'dk'))] * 2), T(bar, st, k))
            for st in range(0, 16, 2):
                place(perc, I.pan_stereo(I.ride(0.6 if st % 4 == 0 else 0.4, (bar, st)), 0.4), T(bar, st, k))
            if bar % 4 == 0:
                place(perc, I.crash(1.0, (bar, 'c')), T(bar, 0, k))
            if bar % 16 == 15:
                for i, st in enumerate(range(8, 16)):
                    m = [55, 55, 52, 52, 48, 48, 45, 43][i]
                    place(perc, I.pan_stereo(I.tom(m, 0.9, (bar, st)), 0.5 - i * 0.14), T(bar, st, k))
            elif bar % 8 == 7:
                for i, st in enumerate((12, 13, 14, 15)):
                    place(perc, I.pan_stereo(I.tom([52, 50, 47, 45][i], 0.8, (bar, st)), 0.3 - i * 0.2), T(bar, st, k))
    L = guitar_take(heavy_pattern, 'L')
    R = guitar_take(heavy_pattern, 'R')
    gtr = np.stack([L * 0.95 + R * 0.12, R * 0.95 + L * 0.12])
    perc = reverb(perc, 2.5, 1.5, 0.2, 'room', 7000)
    kit = reverb(kit, 1.2, 0.5, 0.05, 'small')
    return gtr * 0.6 + perc * 0.8 + kit * 0.7


SCALE = [2, 4, 5, 7, 9, 10, 0]  # D natural minor pitch classes, from D


def third_below(m, ch):
    """Diatonic third below (harmonised twin lead); C# stands in for C over A."""
    pcs = list(SCALE)
    if ch in ('A', 'Asus'):
        pcs[6] = 1
    pc = m % 12
    if pc not in pcs:
        return m - 3
    i = pcs.index(pc)
    target = pcs[(i - 2) % 7]
    d = (pc - target) % 12
    return m - d


def stem_apex():
    """The peak: the theme on lead guitar (harmonised in thirds in the second
    half), choir, snare builds."""
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
                    put(di_a, G.lead_note(m, d * BEAT * 0.96, 0.95 if i == 0 else 0.85, (slot, i), bend), sec)
                    if slot >= 8:
                        put(di_b, G.lead_note(third_below(m, c), d * BEAT * 0.96, 0.8, (slot, i, 'h'), bend), sec)
                b += d
        for slot, c in enumerate(CH):
            for i, m in enumerate(VOICE[c][1:]):
                place(ch_b, I.choir(m, 2 * BAR + 0.1, 0.45, key=(slot, i)), T(slot * 2, 0, k))
        for half in (0, 16):
            for bar in (half + 14, half + 15):
                steps = range(0, 16, 2) if bar == half + 14 else range(16)
                for st in steps:
                    prog = ((bar - half - 14) * 16 + st) / 32
                    place(build, np.stack([I.snare(0.25 + 0.6 * prog, (bar, st, 'b'), tone=220.0, decay=0.1)] * 2),
                          T(bar, st, k))
    la = G.amp(di_a, 35, 'lead')
    lb = G.amp(di_b, 35, 'lead')
    ld = np.stack([la * 0.9 + lb * 0.45, la * 0.9 + lb * 0.75])
    ld = pingpong(ld, 0.75 * BEAT, 0.35, 0.25, 0.3)
    ld = reverb(ld, 3.0, 2.2, 0.28, 'hall', 6500)
    ch_b = reverb(ch_b, 4.5, 3.4, 0.5, 'pad', 5000)
    build = reverb(build, 2.0, 1.2, 0.15, 'small')
    return ld * 0.75 + ch_b * 0.7 + build * 0.7


TAIKO = [(0, 1.0), (3, 0.6), (6, 0.8), (8, 0.95), (10, 0.5), (11, 0.65), (14, 0.85)]
OSTINATO = [0, 0, 12, 0, 7, 0, 12, 13]   # one upper b2 per bar: menace, not mud


def stem_boss():
    """A capstone: drop-D guitar ostinato doubled by low brass, swells, taiko."""
    brass, horn, drums = new(), new(), new()
    di = np.zeros(N, np.float32)
    for k in ITER:
        for bar in range(BARS):
            ch = chord_at_bar(bar)
            root = BASS[ch] + 12
            for i, off in enumerate(OSTINATO):
                vel = 1.0 if i in (0, 4) else 0.8
                place(brass, np.stack([I.boss_brass(root + off, BEAT * 0.42, vel, key=(bar, i))] * 2),
                      T(bar, i * 2, k))
            gr = metal_root(ch)
            for i, off in enumerate(OSTINATO):
                n_ = gr + {0: 0, 12: 12, 7: 7, 13: 13}[off]
                put(di, G.power_chord(n_, STEP * 1.8, 1.0 if i in (0, 4) else 0.85, (bar, i, 'bg'),
                                      mute=off == 0, octave=False),
                    T(bar, i * 2, k) + human((bar, i, 'bg'), 0.003))
            for st, v in TAIKO:
                place(drums, I.pan_stereo(I.taiko(v, (bar, st), 1.0 if st % 8 == 0 else 1.335), 0.15 if st % 2 else -0.15),
                      T(bar, st, k))
                if st == 0 and bar % 4 == 0:
                    place(drums, I.pan_stereo(I.taiko(0.45, (bar, 'flam'), 1.335), -0.4), T(bar, st, k) - 0.03)
        for slot, ch in enumerate(CH):
            root = BASS[ch] + 12
            for m in (root, root + 7, root + 12):
                place(horn, I.boss_horn(m, 2 * BAR - 0.3, 0.5, key=(slot, m)), T(slot * 2, 0, k))
    gtr = G.amp(di, 80)
    brass = reverb(brass, 2.0, 1.2, 0.12, 'room', 4000)
    horn = reverb(horn, 4.0, 3.0, 0.35, 'hall', 4000)
    drums = reverb(drums, 4.0, 2.6, 0.32, 'hall', 5000)
    return brass * 0.45 + horn * 0.8 + drums + np.stack([gtr, gtr]) * 0.6


STEMS = {
    'atmos': stem_atmos, 'pulse': stem_pulse, 'groove': stem_groove,
    'heavy': stem_heavy, 'apex': stem_apex, 'boss': stem_boss,
}


def excerpt(buf):
    a = S(L - PRE)
    b = a + S(PRE + L + POST)
    return buf[:, a:b]


def check_periodic(x):
    """Max abs difference between the head and the same point one loop later."""
    w = S(PRE + POST)
    return float(np.max(np.abs(x[:, :w] - x[:, S(L):S(L) + w])))


if __name__ == '__main__':
    os.makedirs('out', exist_ok=True)
    names = sys.argv[1:] or list(STEMS)
    for name in names:
        buf = STEMS[name]()
        ex = excerpt(buf)
        err = check_periodic(ex)
        np.save(f'out/{name}.npy', ex.astype(np.float32))
        print(f'{name}: {ex.shape[1] / SR:.2f}s peak {np.max(np.abs(ex)):.3f} '
              f'rms {20 * np.log10(np.sqrt(np.mean(ex ** 2)) + 1e-12):.1f} dB periodic-err {err:.2e}', flush=True)
        del buf, ex
    if not sys.argv[1:]:
        r = I.riser(BAR)
        im = I.impact(4.0)
        im = reverb(np.concatenate([im, np.zeros((2, S(1.0)), np.float32)], axis=1), 4.5, 3.5, 0.45, 'pad', 5000)
        np.save('out/riser.npy', r)
        np.save('out/impact.npy', im)
        print('one-shots done')
