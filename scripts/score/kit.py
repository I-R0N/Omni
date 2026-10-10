"""Export Critical Mass as a DAW kit: one multitrack MIDI file (every instrument
on its own named track), clean DI recordings of every guitar/bass part to
re-amp in the DAW, and reference renders of each game layer starting at bar 1.
Everything shares one timeline: time 0 = bar 1, 150 BPM, 4/4, 32 bars.
"""
import os, shutil, subprocess
import numpy as np
import mido
import soundfile as sf
import song3 as S
import guitar as G
from synth import SR

OUT = 'kit/Critical Mass - GarageBand kit'
PPQ = 480
STEP_T = PPQ // 4
BAR_T = PPQ * 4
GM = dict(kick=36, snare=38, hat=42, ride=51, crash=49, tom_hi=50, tom_mid=48, tom_lo=45, floor_hi=43, floor_lo=41)


class Track:
    def __init__(self, name, channel, program=0):
        self.name, self.ch, self.program, self.ev = name, channel, program, []

    def note(self, bar, step, length_steps, pitch, vel):
        t0 = bar * BAR_T + int(round(step * STEP_T))
        t1 = t0 + max(1, int(round(length_steps * STEP_T)))
        v = int(max(1, min(127, round(vel * 112))))
        self.ev += [(t0, 1, pitch, v), (t1, 0, pitch, 0)]

    def chord(self, bar, step, length_steps, pitches, vel):
        for p in pitches:
            self.note(bar, step, length_steps, p, vel)

    def to_midi(self):
        tr = mido.MidiTrack()
        tr.append(mido.MetaMessage('track_name', name=self.name, time=0))
        if self.ch != 9:
            tr.append(mido.Message('program_change', channel=self.ch, program=self.program, time=0))
        now = 0
        for t, on, p, v in sorted(self.ev, key=lambda e: (e[0], e[1])):   # offs before ons at a tick
            msg = 'note_on' if on else 'note_off'
            tr.append(mido.Message(msg, channel=self.ch, note=p, velocity=v, time=t - now))
            now = t
        return tr


def power(r, open_):
    return [r, r + 7] + ([r + 12] if open_ else [])


def build_midi():
    T = {}
    def tk(key, *a):
        T[key] = Track(*a)
        return T[key]
    # GM programs: 29 overdriven gtr, 30 distortion gtr, 33 fingered bass, 89 warm pad, 52 choir, 61 brass
    pad = tk('pad', 'atmos | Pad', 0, 89)
    drone = tk('drone', 'atmos | Drone', 1, 89)
    swell = tk('swell', 'atmos | Feedback swells (gtr)', 2, 30)
    pg = tk('pg', 'pulse | Muted guitar quarters', 3, 30)
    ph = tk('ph', 'pulse | Hats', 9)
    gl = tk('gl', 'groove | Rhythm Gtr L', 4, 30)
    gr = tk('gr', 'groove | Rhythm Gtr R', 5, 30)
    bs = tk('bs', 'groove | Bass', 6, 33)
    gd = tk('gd', 'groove | Drums (half-time)', 9)
    hl = tk('hl', 'heavy | Rhythm Gtr L2', 7, 30)
    hr = tk('hr', 'heavy | Rhythm Gtr R2', 8, 30)
    hd = tk('hd', 'heavy | Drums (double kick, ride, toms)', 9)
    ld = tk('ld', 'apex | Lead Gtr', 10, 30)
    hm = tk('hm', 'apex | Harmony Gtr (bars 17-32)', 11, 30)
    ch = tk('ch', 'apex | Choir', 12, 52)
    sb = tk('sb', 'apex | Snare builds', 9)
    bg = tk('bg', 'boss | Doom Gtr', 13, 30)
    bh = tk('bh', 'boss | Horns', 14, 61)
    bt = tk('bt', 'boss | Taiko (as floor toms)', 9)

    for slot, c in enumerate(S.CH):
        bar = slot * 2
        pad.chord(bar, 0, 32, S.VOICE[c], 0.6)
        ch.chord(bar, 0, 32, S.VOICE[c][1:], 0.55)
        rt = S.BASS[c] + 12
        bh.chord(bar, 0, 30, [rt, rt + 7, rt + 12], 0.6)
    for seg in range(4):
        drone.chord(seg * 8, 0, 128, [36, 43], 0.5)
    for seg in range(8):
        swell.note(seg * 4 + 1, 0, 48, S.VOICE[S.chord_at_bar(seg * 4)][1] + 24, 0.45)

    for bar in range(S.BARS):
        r = S.root(S.chord_at_bar(bar))
        big = bar % 16 == 15
        for st in (0, 4, 8, 12):
            pg.chord(bar, st, 1.2, power(r, False), 0.85 if st == 0 else 0.7)
        for st in range(0, 16, 2):
            ph.note(bar, st, 1, GM['hat'], 0.65 if st % 4 == 2 else 0.4)
        for st, d, v, mute, off in S.riff(bar):
            for trk in (gl, gr, hl, hr):
                trk.chord(bar, st, d * 0.95, power(r + off, not mute), v * (0.75 if mute else 1.0))
            bs.note(bar, st, d * 0.95, r + off - 12, v)
            if not (st == 8 and not big):
                gd.note(bar, st, 1, GM['kick'], 1.0 if st % 4 == 0 else 0.85)
        if not big:
            gd.note(bar, 8, 2, GM['snare'], 1.0)
        else:
            for st in range(8, 16):
                gd.note(bar, st, 1, GM['snare'], 0.45 + 0.07 * (st - 8))
        if bar % 4 == 0:
            gd.note(bar, 0, 8, GM['crash'], 0.9)
        for st in range(16):
            hd.note(bar, st, 1, GM['kick'], 0.7 if st % 2 == 0 else 0.58)
        for st in (4, 12):
            hd.note(bar, st, 2, GM['ride'], 0.5)
        if big:
            for i, st in enumerate(range(8, 16)):
                hd.note(bar, st, 1, [GM['tom_hi'], GM['tom_hi'], GM['tom_mid'], GM['tom_mid'],
                                     GM['tom_lo'], GM['tom_lo'], GM['floor_hi'], GM['floor_lo']][i], 0.95)
        for st, d, v, mute, off in S.DOOM:
            bg.chord(bar, st, d * 0.95, [r + off, r + off + 7], v * (0.75 if mute else 1.0))
        for st, v in S.TAIKO:
            bt.note(bar, st, 2, GM['floor_lo'] if st % 8 == 0 else GM['floor_hi'], v)
    for half in (0, 16):
        for bar in (half + 14, half + 15):
            steps = range(0, 16, 2) if bar == half + 14 else range(16)
            for st in steps:
                sb.note(bar, st, 1, GM['snare'], 0.25 + 0.6 * ((bar - half - 14) * 16 + st) / 32)
    for slot, notes in enumerate(S.MELODY):
        b = slot * 8.0
        for i, (m, d) in enumerate(notes):
            bar, step = int(b // 4), (b % 4) * 4
            ld.note(bar, step, d * 4 * 0.96, m, 0.95 if i == 0 else 0.85)
            if slot >= 8:
                hm.note(bar, step, d * 4 * 0.96, S.third_below(m, S.CH[slot]), 0.8)
            b += d

    mid = mido.MidiFile(ticks_per_beat=PPQ, type=1)
    meta = mido.MidiTrack()
    meta.append(mido.MetaMessage('track_name', name='Critical Mass (C minor, 150 BPM)', time=0))
    meta.append(mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(150), time=0))
    meta.append(mido.MetaMessage('time_signature', numerator=4, denominator=4, time=0))
    prev = 0
    for bar, text in ((0, 'Bar 1 - verse (riff A/B)'), (16, 'Bar 17 - chorus (leads harmonise)'),
                      (31, 'Bar 32 - fill, loops to bar 1')):
        t = bar * BAR_T
        meta.append(mido.MetaMessage('marker', text=text, time=t - prev))
        prev = t
    mid.tracks.append(meta)
    for t in T.values():
        mid.tracks.append(t.to_midi())
    return mid, T


# ── clean DI recordings ──────────────────────────────────────────────────────

TAIL = 2.0
N1 = int((S.L + TAIL) * SR)


def sec(bar, step):
    return bar * S.BAR + step * S.STEP


def put(buf, sig, t):
    a = int(round(t * SR))
    off = max(0, -a)          # a humanised first note may land a hair before 0
    a = max(0, a)
    e = min(len(buf), a + len(sig) - off)
    if e > a:
        buf[a:e] += sig[off:off + e - a]


def di_rhythm(take):
    b = np.zeros(N1, np.float32)
    for bar in range(S.BARS):
        r = S.root(S.chord_at_bar(bar))
        for st, d, v, mute, off in S.riff(bar):
            put(b, G.power_chord(r + off, d * S.STEP * 0.95, v, ('r3', bar, st, take), mute=mute, octave=not mute),
                sec(bar, st) + S.human((bar, st, take), 0.005))
    return b


def di_bass():
    b = np.zeros(N1, np.float32)
    for bar in range(S.BARS):
        r = S.root(S.chord_at_bar(bar))
        for st, d, v, mute, off in S.riff(bar):
            put(b, G.bass_di(r + off - 12, d * S.STEP * 0.95, v, ('b3', bar, st), mute), sec(bar, st))
    return b


def di_leads():
    a, h = np.zeros(N1, np.float32), np.zeros(N1, np.float32)
    for slot, notes in enumerate(S.MELODY):
        b = slot * 8.0
        for i, (m, d) in enumerate(notes):
            t = b * S.BEAT
            dur = d * S.BEAT * 0.96
            bend = i == 0 or d >= 3
            put(a, G.lead_note(m, dur, 0.95 if i == 0 else 0.85, ('a3', slot, i), bend), t)
            if d >= 3:
                put(a, G.pinch(m, min(dur, 0.9), 0.35), t + 0.02)
            if slot >= 8:
                put(h, G.lead_note(S.third_below(m, S.CH[slot]), dur, 0.8, ('b3', slot, i), bend), t)
            b += d
    return a, h


def di_pulse():
    b = np.zeros(N1, np.float32)
    for bar in range(S.BARS):
        r = S.root(S.chord_at_bar(bar))
        for st in (0, 4, 8, 12):
            put(b, G.power_chord(r, S.STEP * 1.2, 0.85 if st == 0 else 0.7, ('p3', bar, st), mute=True), sec(bar, st))
    return b


def di_boss():
    b = np.zeros(N1, np.float32)
    for bar in range(S.BARS):
        r = S.root(S.chord_at_bar(bar))
        for st, d, v, mute, off in S.DOOM:
            put(b, G.power_chord(r + off, d * S.STEP * 0.95, v, ('d3', bar, st), mute=mute, octave=False),
                sec(bar, st) + S.human(('d3', bar, st), 0.003))
    return b


def write_di(name, x):
    x = x / max(1e-9, np.max(np.abs(x))) * 0.5          # peak -6 dBFS: headroom for the amp sim's input
    sf.write(f'{OUT}/2 - Clean guitar DI (re-amp these)/{name}.wav', x, SR, subtype='PCM_24')


LAYER_ORDER = ['atmos', 'pulse', 'groove', 'heavy', 'apex', 'boss']


def per_layer_midi(T):
    """One MIDI file per layer, so each imports into GarageBand as its own
    group (GarageBand renames tracks after their sound; the file keeps the
    grouping clear)."""
    files = {}
    for i, layer in enumerate(LAYER_ORDER, 1):
        mid = mido.MidiFile(ticks_per_beat=PPQ, type=1)
        meta = mido.MidiTrack()
        meta.append(mido.MetaMessage('track_name', name=f'Critical Mass - {layer}', time=0))
        meta.append(mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(150), time=0))
        meta.append(mido.MetaMessage('time_signature', numerator=4, denominator=4, time=0))
        mid.tracks.append(meta)
        names = []
        for t in T.values():
            if t.name.startswith(layer + ' |'):
                mid.tracks.append(t.to_midi())
                names.append(t.name.split('| ', 1)[1])
        files[f'{i} - {layer}.mid'] = (mid, names)
    return files


if __name__ == '__main__':
    import json
    shutil.rmtree(OUT, ignore_errors=True)
    for d in ('1 - Import these (one per layer)', '2 - Exports', '3 - Reference (how the game sounds now)'):
        os.makedirs(f'{OUT}/{d}')
    _, T = build_midi()
    listing = []
    for fname, (mid, names) in per_layer_midi(T).items():
        mid.save(f'{OUT}/1 - Import these (one per layer)/{fname}')
        listing.append(f'{fname}: {", ".join(names)}')
    print('\n'.join(listing))
    json.dump({"id": "critical-mass", "title": "Critical Mass", "bpm": 150, "bars": 32, "key": "C minor",
               "use": ["boss"]}, open(f'{OUT}/song.json', 'w'), indent=2)
    pre = int(S.PRE * SR)
    full = None
    for n in LAYER_ORDER:
        x, sr = sf.read(f'final/c-{n}.wav')
        x = x[pre:pre + N1]
        if x.ndim == 1:
            x = np.stack([x, x], 1)
        full = x if full is None else full + x
        sf.write('/tmp/_ref.wav', x, sr)
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', '/tmp/_ref.wav', '-b:a', '160k',
                        f'{OUT}/3 - Reference (how the game sounds now)/{n}.mp3'], check=True)
    sf.write('/tmp/_ref.wav', full / max(1.0, np.max(np.abs(full)) / 0.97), sr)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', '/tmp/_ref.wav', '-b:a', '160k',
                    f'{OUT}/3 - Reference (how the game sounds now)/all layers together.mp3'], check=True)
    print('kit written')
