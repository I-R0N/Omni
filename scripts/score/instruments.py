"""Instrument voices.  Each returns a mono or stereo float32 note buffer."""
import numpy as np
from synth import (SR, mtof, rng_for, saw, square, sine, svf, adsr, expdecay,
                   drive, pan_stereo)

# ── drums ───────────────────────────────────────────────────────────────────

def kick(vel=1.0, key=0, f_end=55.0):
    n = int(0.55 * SR)
    t = np.arange(n) / SR
    f = f_end + 120 * np.exp(-t / 0.032)   # settles on the key's fifth (A1 for D minor)
    body = sine(f, n) * np.exp(-t / 0.30)
    r = rng_for('kick', key)
    click = svf(r.standard_normal(n).astype(np.float32) * np.exp(-t / 0.004), 3500, 0.7, 'bp')
    out = drive(body * 1.0 + click * 0.5, 1.8)
    return (out * vel).astype(np.float32)


def snare(vel=1.0, key=0, tone=174.6, decay=0.17):   # body on F3
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    r = rng_for('snare', key)
    body = (sine(tone * (1 + 0.3 * np.exp(-t / 0.01)), n) * 0.7 + sine(tone * 1.78, n) * 0.3) * np.exp(-t / 0.07)
    nz = r.standard_normal(n).astype(np.float32)
    nz = svf(nz, 2600, 0.6, 'bp') * 1.4 * np.exp(-t / decay) + svf(nz, 7000, 0.7, 'hp') * 0.35 * np.exp(-t / (decay * 0.5))
    return drive((body + nz) * vel, 1.4)


def clap(vel=1.0, key=0):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    r = rng_for('clap', key)
    nz = svf(r.standard_normal(n).astype(np.float32), 1400, 1.4, 'bp')
    env = np.zeros(n, np.float32)
    for k, off in enumerate((0.0, 0.009, 0.019)):
        s = int(off * SR)
        env[s:] += np.exp(-(t[:n - s]) / 0.006) * (0.8 if k < 2 else 1.0)
    s = int(0.019 * SR)
    env[s:] += np.exp(-t[:n - s] / 0.11) * 0.6
    return (nz * env * vel * 1.3).astype(np.float32)


_HAT_F = np.array([205.3, 304.4, 369.6, 522.7, 540.0, 800.0]) * 1.6


def hat(vel=1.0, key=0, open_=False):
    n = int((0.5 if open_ else 0.12) * SR)
    t = np.arange(n) / SR
    m = np.zeros(n, np.float32)
    for f in _HAT_F:
        m += square(f, n, 0.0)
    r = rng_for('hat', key)
    nz = r.standard_normal(n).astype(np.float32)
    sig = svf(m * 0.35 + nz * 0.6, 9500, 0.9, 'bp') + svf(nz, 11000, 0.7, 'hp') * 0.4
    env = np.exp(-t / (0.16 if open_ else 0.022))
    return (sig * env * vel * 0.7).astype(np.float32)


def shaker(vel=1.0, key=0):
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    r = rng_for('shk', key)
    nz = svf(r.standard_normal(n).astype(np.float32), 6000, 0.8, 'hp')
    env = np.minimum(t / 0.012, 1) * np.exp(-np.maximum(t - 0.012, 0) / 0.025)
    return (nz * env * vel * 0.5).astype(np.float32)


def tom(midi, vel=1.0, key=0):
    n = int(0.7 * SR)
    t = np.arange(n) / SR
    f0 = mtof(midi)
    body = sine(f0 * (1 + 0.6 * np.exp(-t / 0.03)), n) * np.exp(-t / 0.32)
    r = rng_for('tom', key)
    nz = svf(r.standard_normal(n).astype(np.float32), 900, 0.8, 'lp') * np.exp(-t / 0.03)
    return drive((body + nz * 0.5) * vel, 2.0)


def crash(vel=1.0, key=0, length=2.6):
    n = int(length * SR)
    t = np.arange(n) / SR
    out = []
    for ch in range(2):
        r = rng_for('crash', key, ch)
        nz = r.standard_normal(n).astype(np.float32)
        m = np.zeros(n, np.float32)
        for f in _HAT_F * (1.3 + 0.05 * ch):
            m += square(f, n, r.random())
        sig = svf(nz * 0.8 + m * 0.25, 4200, 0.6, 'hp')
        sig = svf(sig, 9000 - 4000 * (1 - np.exp(-t / 0.6)), 0.6, 'lp')
        env = np.minimum(t / 0.002, 1) * np.exp(-t / (length * 0.32))
        out.append(sig * env * vel * 0.55)
    return np.stack(out).astype(np.float32)


def ride(vel=1.0, key=0):
    n = int(0.8 * SR)
    t = np.arange(n) / SR
    m = np.zeros(n, np.float32)
    for f in _HAT_F * 1.05:
        m += square(f, n, 0.0)
    bell = sine(2349.3, n) * 0.3 + sine(3520.0, n) * 0.15   # D7 + A7: in key
    sig = svf(m * 0.3 + bell, 5200, 1.2, 'bp')
    return (sig * np.exp(-t / 0.33) * vel * 0.5).astype(np.float32)


def taiko(vel=1.0, key=0, pitch=1.0):
    n = int(1.1 * SR)
    t = np.arange(n) / SR
    f = (54 + 55 * np.exp(-t / 0.045)) * pitch
    body = sine(f, n) * np.exp(-t / 0.42)
    r = rng_for('taiko', key)
    skin = svf(r.standard_normal(n).astype(np.float32), 700, 0.9, 'lp') * np.exp(-t / 0.05)
    slap = svf(r.standard_normal(n).astype(np.float32), 2200, 1.0, 'bp') * np.exp(-t / 0.008)
    return drive((body * 1.1 + skin * 0.6 + slap * 0.3) * vel, 2.2)


# ── tonal ───────────────────────────────────────────────────────────────────

def supersaw_pad(midi, dur, vel=1.0, key=0, cutoff=1100.0, voices=7, spread=0.16,
                 a=1.4, d=1.5, s=0.85, r=2.6):
    gate = int(dur * SR)
    env = adsr(gate, a, d, s, r)
    n = env.shape[0]
    f0 = mtof(midi)
    rg = rng_for('pad', key, midi)
    L = np.zeros(n, np.float32)
    R = np.zeros(n, np.float32)
    for v in range(voices):
        det = (v - (voices - 1) / 2) / ((voices - 1) / 2)  # -1..1
        cents = det * 18 + rg.uniform(-2, 2)
        osc = saw(f0 * 2 ** (cents / 1200), n, rg.random())
        p = det * 0.8
        L += osc * np.cos((p + 1) * np.pi / 4)
        R += osc * np.sin((p + 1) * np.pi / 4)
    t = np.arange(n) / SR
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * 0.11 * t + rg.random() * 6.28)
    cut = cutoff * (0.75 + 0.5 * lfo) * (0.6 + 0.4 * env)
    L = svf(L, cut, 0.8)
    R = svf(R, cut, 0.8)
    g = env * vel / voices * 1.6
    return np.stack([L * g, R * g]).astype(np.float32)


def drone(midi, dur, vel=1.0, key=0):
    gate = int(dur * SR)
    env = adsr(gate, 3.0, 1.0, 1.0, 3.0)
    n = env.shape[0]
    f0 = mtof(midi)
    t = np.arange(n) / SR
    rg = rng_for('drone', key, midi)
    s1 = saw(f0 * 1.002, n, rg.random()) + saw(f0 * 0.998, n, rg.random())
    cut = 260 + 180 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.07 * t + rg.random() * 6))
    body = svf(s1 * 0.5, cut, 1.1) + sine(f0, n) * 0.5
    return (body * env * vel).astype(np.float32)


def bell(midi, vel=1.0, key=0, length=3.2):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = mtof(midi)
    idx = 1.6 * np.exp(-t / 0.35) + 0.25
    mod = np.sin(2 * np.pi * f * 3.5 * t) * idx
    car = np.sin(2 * np.pi * f * t + mod)
    car2 = np.sin(2 * np.pi * f * 2.001 * t) * 0.18 * np.exp(-t / 0.5)
    env = np.minimum(t / 0.004, 1) * np.exp(-t / (length * 0.3))
    pan = rng_for('bellpan', key).uniform(-0.6, 0.6)
    return pan_stereo(((car + car2) * env * vel * 0.5).astype(np.float32), pan)


def pluck(midi, vel=1.0, key=0, dur=0.22, bright=1.0):
    n = int((dur + 0.25) * SR)
    t = np.arange(n) / SR
    f = mtof(midi)
    osc = saw(f, n) * 0.6 + square(f * 1.003, n, 0.25, 0.3) * 0.5
    cut = 350 + 3400 * bright * vel * np.exp(-t / 0.085)
    sig = svf(osc, cut, 1.3)
    env = np.minimum(t / 0.002, 1) * np.exp(-t / 0.16)
    return (sig * env * vel * 0.8).astype(np.float32)


def sub_bass(midi, dur, vel=1.0):
    gate = int(dur * SR)
    env = adsr(gate, 0.003, 0.08, 0.75, 0.035)
    n = env.shape[0]
    t = np.arange(n) / SR
    f = mtof(midi)
    s = sine(f, n) * 0.9
    mid = svf(saw(f, n), 180 + 1100 * np.exp(-t / 0.05) * vel, 1.4) * 0.55
    return drive((s + mid) * env * vel, 1.6)


def reese(midi, dur, vel=1.0, key=0):
    gate = int(dur * SR)
    env = adsr(gate, 0.02, 0.3, 0.9, 0.12)
    n = env.shape[0]
    t = np.arange(n) / SR
    f = mtof(midi)
    rg = rng_for('reese', key)
    a = saw(f * 1.0045, n, rg.random())
    b = saw(f * 0.9955, n, rg.random())
    c = saw(f * 0.5, n, rg.random()) * 0.5
    wob = 0.5 + 0.5 * np.sin(2 * np.pi * (128 / 60 / 2) * t)  # 8th-note wobble
    cut = 380 + 900 * wob
    L = drive(svf(a + c, cut, 2.2), 3.0)
    R = drive(svf(b + c, cut * 1.05, 2.2), 3.0)
    L = svf(L, 90, 0.7, 'hp')
    R = svf(R, 90, 0.7, 'hp')
    return (np.stack([L, R]) * env * vel * 0.5).astype(np.float32)


def stab(midis, dur, vel=1.0, key=0):
    gate = int(dur * SR)
    env = adsr(gate, 0.004, 0.25, 0.4, 0.09)
    n = env.shape[0]
    t = np.arange(n) / SR
    rg = rng_for('stab', key)
    L = np.zeros(n, np.float32)
    R = np.zeros(n, np.float32)
    for m in midis:
        f = mtof(m)
        for v, c in enumerate((-12, -4, 4, 12)):
            o = saw(f * 2 ** (c / 1200), n, rg.random())
            if v % 2:
                L += o
            else:
                R += o
    cut = 500 + 3200 * vel * np.exp(-t / 0.11)
    L = drive(svf(L, cut, 1.5), 2.6)
    R = drive(svf(R, cut, 1.5), 2.6)
    return (np.stack([L, R]) * env * vel * 0.35).astype(np.float32)


def lead(midi, dur, vel=1.0, key=0):
    gate = int(dur * SR)
    env = adsr(gate, 0.012, 0.25, 0.8, 0.22)
    n = env.shape[0]
    t = np.arange(n) / SR
    vib_depth = 0.22 * np.clip((t - 0.25) / 0.4, 0, 1)
    fm = mtof(midi) * 2 ** (vib_depth * np.sin(2 * np.pi * 5.6 * t) / 12)
    osc = saw(fm, n) * 0.55 + saw(fm * 1.006, n, 0.3) * 0.45 + square(fm * 0.5, n, 0.1) * 0.35
    cut = 1900 + 2600 * np.exp(-t / 0.18) * vel
    sig = svf(osc, cut, 1.0)
    return drive(sig * env * vel * 0.6, 1.3)


def choir(midi, dur, vel=1.0, key=0):
    gate = int(dur * SR)
    env = adsr(gate, 0.7, 0.6, 0.9, 1.4)
    n = env.shape[0]
    t = np.arange(n) / SR
    rg = rng_for('choir', key, midi)
    out = []
    for ch in range(2):
        f = mtof(midi) * 2 ** ((5.0 * np.sin(2 * np.pi * (4.6 + ch * 0.4) * t + rg.random() * 6)) / 1200)
        src = sum(saw(f * 2 ** (c / 1200), n, rg.random()) for c in (-9, 0, 8)) / 3
        v = (svf(src, 730, 6, 'bp') * 1.0 + svf(src, 1090, 7, 'bp') * 0.55
             + svf(src, 2440, 8, 'bp') * 0.28)
        out.append(v)
    return (np.stack(out) * env * vel * 1.2).astype(np.float32)


def boss_brass(midi, dur, vel=1.0, key=0):
    gate = int(dur * SR)
    env = adsr(gate, 0.006, 0.2, 0.55, 0.08)
    n = env.shape[0]
    t = np.arange(n) / SR
    rg = rng_for('bbrass', key)
    f = mtof(midi)
    o = sum(saw(f * 2 ** (c / 1200), n, rg.random()) for c in (-14, -5, 5, 14)) / 4
    o += square(f * 0.5, n, 0.0, 0.4) * 0.6
    cut = 220 + 1500 * vel * np.exp(-t / 0.09)
    return drive(svf(o, cut, 2.4) * env * vel, 3.5)


def boss_horn(midi, dur, vel=1.0, key=0):
    gate = int(dur * SR)
    env = adsr(gate, 1.4, 0.5, 1.0, 0.9)
    n = env.shape[0]
    t = np.arange(n) / SR
    rg = rng_for('bhorn', key, midi)
    f = mtof(midi)
    out = []
    for ch in range(2):
        o = sum(saw(f * 2 ** (c / 1200), n, rg.random()) for c in (-10, -3, 6, 11)) / 4
        cut = 180 + 1300 * np.clip(t / max(dur, 0.1), 0, 1) ** 1.5
        out.append(drive(svf(o, cut, 1.6), 2.4))
    return (np.stack(out) * env * vel * 0.8).astype(np.float32)


def shimmer(dur, vel=1.0, key=0):
    gate = int(dur * SR)
    env = adsr(gate, dur * 0.45, 0.5, 1.0, dur * 0.4)
    n = env.shape[0]
    t = np.arange(n) / SR
    out = []
    for ch in range(2):
        r = rng_for('shim', key, ch)
        nz = r.standard_normal(n).astype(np.float32)
        cut = 6500 + 2500 * np.sin(2 * np.pi * 0.2 * t + ch)
        out.append(svf(nz, cut, 4.0, 'bp'))
    return (np.stack(out) * env * vel * 0.25).astype(np.float32)


# ── transitions ─────────────────────────────────────────────────────────────

def riser(length):
    n = int(length * SR)
    t = np.arange(n) / SR
    x = t / length
    out = []
    for ch in range(2):
        r = rng_for('riser', ch)
        nz = r.standard_normal(n).astype(np.float32)
        cut = 300 * (9000 / 300) ** (x ** 1.4)
        sweep = svf(nz, cut, 2.5, 'bp')
        tone = svf(saw(mtof(50) * 2 ** (2 * x ** 1.5) * (1 + 0.004 * ch), n), cut * 0.8, 1.2) * 0.35
        env = (x ** 2.2) * np.minimum((1 - x) / 0.012, 1)
        out.append((sweep + tone) * env)
    return np.stack(out).astype(np.float32)


def impact(length=4.0):
    n = int(length * SR)
    t = np.arange(n) / SR
    boom = sine(26 + 60 * np.exp(-t / 0.12), n) * np.exp(-t / 1.1)
    r = rng_for('impact')
    nz = svf(r.standard_normal(n).astype(np.float32), 1200 * np.exp(-t / 0.3) + 120, 0.7) * np.exp(-t / 0.35)
    body = drive(boom * 1.2 + nz * 0.7, 1.8)
    cr = crash(0.9, 'impact', length)
    return (np.stack([body, body]) + cr * 0.8).astype(np.float32)


def metal_kick(vel=1.0, key=0, f_end=55.0):
    """Tighter, clickier kick for double-kick work: less boom, more beater."""
    n = int(0.32 * SR)
    t = np.arange(n) / SR
    f = f_end + 150 * np.exp(-t / 0.018)
    body = sine(f, n) * np.exp(-t / 0.17)
    r = rng_for('mkick', key)
    click = svf(r.standard_normal(n).astype(np.float32) * np.exp(-t / 0.0025), 4500, 0.9, 'bp')
    return drive(body * 1.0 + click * 0.9, 2.2) * vel
