"""Metal guitar: plucked-string model → high-gain amp → 4x12 cabinet.

A guitar TRACK is rendered clean ("DI") note by note, then the whole track goes
through the amp at once, so overlapping strings distort together the way they
do in a real amp (power chords intermodulate into that thick consonant growl;
that is why they are power chords).  Double tracking = two independent takes
with their own pick noise and timing, panned hard left and right.
"""
import numpy as np
import numba as nb
from synth import SR, mtof, rng_for, svf, saw, square


@nb.njit(cache=True, fastmath=True)
def _ks(exc, n, period, fb, s):
    """Karplus-Strong with a one-zero damping filter and an allpass for
    fractional (in-tune) delay.  `s` in (0.5, 1]: lower = darker/duller."""
    loop = period - (1.0 - s)          # the damping filter delays (1 - s)
    N = int(loop)
    if N < 2:
        N = 2
    frac = loop - N
    c = (1.0 - frac) / (1.0 + frac)
    y = np.zeros(n, np.float32)
    ap_x = 0.0
    ap_y = 0.0
    for i in range(n):
        d = y[i - N] if i >= N else 0.0
        d1 = y[i - N - 1] if i >= N + 1 else 0.0
        lp = s * d + (1.0 - s) * d1
        a = c * lp + ap_x - c * ap_y
        ap_x = lp
        ap_y = a
        e = exc[i] if i < exc.shape[0] else 0.0
        y[i] = e + fb * a
    return y


def string(midi, dur, vel=1.0, key=0, mute=False):
    """One plucked string.  `mute` = palm mute: short, damped, darker."""
    rel = 0.03 if mute else 0.12
    n = int((dur + rel) * SR)
    f = mtof(midi)
    period = SR / f
    r = rng_for('str', key, midi)
    m = max(8, int(period))
    exc = r.uniform(-1, 1, m).astype(np.float32)
    # pick position (comb) and pick hardness (lowpass)
    pp = max(1, int(m * 0.13))
    exc[pp:] -= exc[:-pp] * 0.8
    exc = svf(exc, 2500 + 4500 * vel, 0.6)
    fb = 0.93 if mute else 0.9985
    s = 0.62 if mute else 0.9
    y = _ks(exc * vel, n, period, fb, s)
    env = np.ones(n, np.float32)
    g = int(dur * SR)
    if g < n:
        env[g:] = np.exp(-np.arange(n - g) / (rel * SR / 5))
    if mute:
        env *= np.exp(-np.arange(n) / (0.09 * SR)) * 0.6 + 0.4 * np.exp(-np.arange(n) / (0.025 * SR))
    return y * env


def power_chord(root, dur, vel=1.0, key=0, mute=False, octave=True):
    notes = [root, root + 7] + ([root + 12] if octave and not mute else [])
    parts = [string(m, dur, vel * (1.0 if i == 0 else 0.85), (key, i), mute) for i, m in enumerate(notes)]
    n = max(len(p) for p in parts)
    out = np.zeros(n, np.float32)
    for i, p in enumerate(parts):
        lag = int(i * 0.004 * SR)  # strum: low string first
        out[lag:lag + len(p)] += p[:n - lag]
    return out


def amp(di, gain=60.0, tone='rhythm'):
    """High-gain amp + 4x12 cab.  `di` is a whole clean track."""
    x = svf(di, 110, 0.7, 'hp')                       # tighten the low end before gain
    x = x + svf(x, 900, 0.9, 'bp') * 1.2              # mid push into the clipper
    x = np.tanh(x * gain + 0.15) - np.tanh(0.15)      # asymmetric first stage
    x = svf(x.astype(np.float32), 6500, 0.7)
    x = np.tanh(x * 3.0)                              # second stage
    x = x.astype(np.float32)
    # cabinet: steep top roll-off, low thump, scooped mids, presence bump
    c = svf(svf(x, 5200, 0.8), 5200, 0.8)
    c = svf(c, 75, 0.7, 'hp')
    scoop = 0.45 if tone == 'rhythm' else 0.2
    c = c - svf(c, 480, 1.0, 'bp') * scoop
    c = c + svf(c, 2600, 1.3, 'bp') * 0.45
    c = c + svf(c, 110, 1.2, 'bp') * (0.35 if tone == 'rhythm' else 0.1)
    return (c / max(1e-6, np.percentile(np.abs(c), 99.9))).astype(np.float32)


def lead_note(midi, dur, vel=1.0, key=0, bend=False):
    """Lead guitar source: a sustained string-like tone with pick attack,
    vibrato and an optional bend-up into the note (KS cannot bend, and at
    lead gain the amp makes the source's identity mostly about envelope and
    pitch movement, so an oscillator source reads as a guitar)."""
    n = int((dur + 0.15) * SR)
    t = np.arange(n) / SR
    semis = np.zeros(n)
    if bend:
        semis += -1.0 * np.clip(1 - t / 0.09, 0, 1)
    semis += 0.28 * np.clip((t - 0.3) / 0.35, 0, 1) * np.sin(2 * np.pi * 5.8 * t)
    f = mtof(midi) * 2 ** (semis / 12)
    src = saw(f, n) * 0.6 + square(f, n, 0.0, 0.42) * 0.4
    src = svf(src, 1800 + 2500 * np.exp(-t / 0.05), 0.8)
    r = rng_for('pick', key)
    pick = svf(r.standard_normal(n).astype(np.float32) * np.exp(-t / 0.004), 3000, 0.8, 'bp')
    env = np.minimum(t / 0.004, 1) * (0.8 + 0.2 * np.exp(-t / 0.15))
    g = int(dur * SR)
    env[g:] *= np.exp(-np.arange(n - g) / (0.03 * SR))
    return ((src + pick * 0.5) * env * vel).astype(np.float32)
