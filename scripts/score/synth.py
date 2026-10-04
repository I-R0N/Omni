"""Small synthesis toolkit for the Omni score.

Everything renders into float32 numpy buffers at SR.  Per-sample work
(oscillators, the state-variable filter, feedback delay) is numba-compiled;
reverb is FFT convolution with a generated stereo IR.

DETERMINISM IS LOAD-BEARING.  Stems loop seamlessly only if iteration N and
N+1 of the pattern produce identical audio, so every random choice (noise,
detune phase, humanisation) is seeded from the event's position *within* the
loop, never from a global RNG.
"""
import numpy as np
import numba as nb
from scipy.signal import oaconvolve

SR = 44100


def mtof(m):
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=np.float64) - 69.0) / 12.0)


def rng_for(*key):
    h = 2166136261
    for k in key:
        for ch in str(k):
            h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return np.random.default_rng(h)


# ── oscillators ─────────────────────────────────────────────────────────────

@nb.njit(cache=True, fastmath=True)
def _saw(freq, phase0):
    n = freq.shape[0]
    out = np.empty(n, np.float32)
    ph = phase0
    for i in range(n):
        dt = freq[i] / SR
        t = ph
        v = 2.0 * t - 1.0
        if t < dt:
            x = t / dt
            v -= x + x - x * x - 1.0
        elif t > 1.0 - dt:
            x = (t - 1.0) / dt
            v -= x * x + x + x + 1.0
        out[i] = v
        ph += dt
        if ph >= 1.0:
            ph -= 1.0
    return out


def saw(freq, n, phase0=0.0):
    f = np.broadcast_to(np.asarray(freq, np.float64), (n,)).copy()
    return _saw(f, float(phase0))


def square(freq, n, phase0=0.0, width=0.5):
    f = np.broadcast_to(np.asarray(freq, np.float64), (n,)).copy()
    return (_saw(f, float(phase0)) - _saw(f, float((phase0 + width) % 1.0))) * 0.5


def sine(freq, n, phase0=0.0):
    f = np.broadcast_to(np.asarray(freq, np.float64), (n,))
    ph = np.cumsum(f) / SR + phase0
    return np.sin(2 * np.pi * ph).astype(np.float32)


# ── filter ──────────────────────────────────────────────────────────────────

@nb.njit(cache=True, fastmath=True)
def _svf(x, cutoff, q, mode):
    n = x.shape[0]
    out = np.empty(n, np.float32)
    ic1 = 0.0
    ic2 = 0.0
    k = 1.0 / q
    for i in range(n):
        c = cutoff[i]
        if c > SR * 0.45:
            c = SR * 0.45
        if c < 10.0:
            c = 10.0
        g = np.tan(np.pi * c / SR)
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        if mode == 0:
            out[i] = v2
        elif mode == 1:
            out[i] = v1
        else:
            out[i] = x[i] - k * v1 - v2
    return out


def svf(x, cutoff, q=0.707, mode='lp'):
    c = np.broadcast_to(np.asarray(cutoff, np.float64), x.shape).copy()
    return _svf(x.astype(np.float32), c, float(q), {'lp': 0, 'bp': 1, 'hp': 2}[mode])


# ── envelopes ───────────────────────────────────────────────────────────────

def adsr(n_gate, a, d, s, r):
    """Gate length in samples; returns envelope of n_gate + release."""
    na, nd, nr = max(1, int(a * SR)), max(1, int(d * SR)), max(1, int(r * SR))
    env = np.empty(n_gate + nr, np.float32)
    t = np.arange(n_gate)
    att = np.minimum(t / na, 1.0)
    dec = np.where(t >= na, s + (1 - s) * np.exp(-(t - na) / nd * 4.0), 1.0)
    body = att * dec
    env[:n_gate] = body
    last = body[-1] if n_gate else 0.0
    env[n_gate:] = last * np.exp(-np.arange(nr) / nr * 6.0)
    return env


def expdecay(n, tau):
    return np.exp(-np.arange(n) / (tau * SR)).astype(np.float32)


# ── effects ─────────────────────────────────────────────────────────────────

def make_ir(seconds, decay, seed, damp=6000.0, predelay=0.012):
    """Stereo IR: decorrelated noise, exponential decay, darkening tail."""
    n = int(seconds * SR)
    out = []
    for ch in range(2):
        r = rng_for('ir', seed, ch)
        noise = r.standard_normal(n).astype(np.float32)
        env = np.exp(-np.arange(n) / (decay * SR) * 3.0).astype(np.float32)
        # cutoff falls over time: tail darker than early reflections
        cut = damp * np.exp(-np.arange(n) / (decay * SR) * 1.2) + 400
        tail = svf(noise * env, cut, 0.6, 'lp')
        pd = np.zeros(int(predelay * SR), np.float32)
        ir = np.concatenate([pd, tail])
        out.append(ir / np.sqrt(np.sum(ir ** 2)))
    return out


_IR_CACHE = {}


def reverb(stereo, seconds=3.5, decay=2.4, mix=0.3, seed='hall', damp=6000.0):
    key = (seconds, decay, seed, damp)
    if key not in _IR_CACHE:
        _IR_CACHE[key] = make_ir(seconds, decay, seed, damp)
    irL, irR = _IR_CACHE[key]
    mono = (stereo[0] + stereo[1]) * 0.5
    n = stereo.shape[1]
    wl = oaconvolve(mono, irL)[:n].astype(np.float32)
    wr = oaconvolve(mono, irR)[:n].astype(np.float32)
    return np.stack([stereo[0] + mix * wl, stereo[1] + mix * wr])


@nb.njit(cache=True)
def _pingpong(xl, xr, d, fb, damp):
    n = xl.shape[0]
    bl = np.zeros(d, np.float32)
    br = np.zeros(d, np.float32)
    ol = np.empty(n, np.float32)
    orr = np.empty(n, np.float32)
    lpL = 0.0
    lpR = 0.0
    idx = 0
    for i in range(n):
        dl = bl[idx]
        dr = br[idx]
        lpL += damp * (dl - lpL)
        lpR += damp * (dr - lpR)
        # cross-feed: left echo feeds right line → ping-pong
        bl[idx] = xl[i] + lpR * fb
        br[idx] = xr[i] * 0.0 + lpL * fb
        ol[i] = dl
        orr[i] = dr
        idx += 1
        if idx >= d:
            idx = 0
    return ol, orr


def pingpong(stereo, delay_sec, fb=0.45, mix=0.3, damp=0.35):
    d = int(delay_sec * SR)
    mono = ((stereo[0] + stereo[1]) * 0.5).astype(np.float32)
    wl, wr = _pingpong(mono, mono, d, fb, damp)
    return np.stack([stereo[0] + mix * wl, stereo[1] + mix * wr])


def drive(x, amount):
    return (np.tanh(x * amount) / np.tanh(amount)).astype(np.float32)


def pan_stereo(mono, pan):
    """Equal-power pan, pan in [-1, 1]."""
    a = (pan + 1) * np.pi / 4
    return np.stack([mono * np.cos(a), mono * np.sin(a)]).astype(np.float32)


def add_at(buf, sig, start):
    """Mix sig (mono or stereo) into stereo buf at sample `start`, clipped."""
    if sig.ndim == 1:
        sig = np.stack([sig, sig])
    n = buf.shape[1]
    if start >= n:
        return
    s0 = max(0, start)
    off = s0 - start
    end = min(n, start + sig.shape[1])
    if end <= s0:
        return
    buf[:, s0:end] += sig[:, off:off + (end - s0)]


def sidechain(n, hits_sec, depth=0.6, attack=0.004, release=0.18):
    """Gain curve ducking after each kick time."""
    g = np.ones(n, np.float32)
    k = int((attack + release * 5) * SR)
    t = np.arange(k) / SR
    shape = np.where(t < attack, t / attack, np.exp(-(t - attack) / release)).astype(np.float32)
    duck = np.zeros(n, np.float32)
    for h in hits_sec:
        s = int(h * SR)
        if s >= n:
            continue
        e = min(n, s + k)
        duck[s:e] = np.maximum(duck[s:e], shape[:e - s])
    return g - depth * duck
