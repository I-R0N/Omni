"""Balance the stems, verify every intensity stack, and encode.

Loudness targets are per STEM ALONE (integrated LUFS).  The game plays every
stem at layer gain 1.0 when it is on, so the balance between layers lives
here, in the files, and the engine only ever fades whole layers.
"""
import json, os, subprocess, sys
import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from synth import SR

TARGET = {'atmos': -20.0, 'pulse': -25.0, 'groove': -19.5, 'heavy': -21.0, 'apex': -21.5, 'boss': -21.0}
MONO = {'groove', 'boss'}
# soft-clip knee per stem (as a fraction of the stem's own peak): tames lone
# transients so stems can sit louder without the stack clipping
KNEE = {'atmos': 1.0, 'pulse': 0.8, 'groove': 0.55, 'heavy': 0.6, 'apex': 0.75, 'boss': 0.55}
meter = pyln.Meter(SR)


def lufs(x):
    return meter.integrated_loudness(x.T.astype(np.float64))


def softclip(x, knee):
    pk = np.max(np.abs(x))
    c = pk * knee
    if knee >= 1.0:
        return x
    y = np.where(np.abs(x) <= c * 0.7, x, np.sign(x) * (c * 0.7 + c * 0.3 * np.tanh((np.abs(x) - c * 0.7) / (c * 0.3))))
    return y.astype(np.float32)


def load():
    st = {}
    for n in TARGET:
        x = np.load(f'out/{n}.npy')
        if n in MONO:
            m = (x[0] + x[1]) * 0.5
            x = np.stack([m, m])
        x = softclip(x, KNEE[n])
        x *= 10 ** ((TARGET[n] - lufs(x)) / 20)
        st[n] = x.astype(np.float32)
    return st


if __name__ == '__main__':
    st = load()
    order = ['atmos', 'pulse', 'groove', 'heavy', 'apex']
    acc = np.zeros_like(st['atmos'])
    report = {}
    for n in order:
        acc = acc + st[n]
        report['+'.join(order[:order.index(n) + 1])] = (lufs(acc), float(np.max(np.abs(acc))))
    full = acc + st['boss']
    report['all+boss'] = (lufs(full), float(np.max(np.abs(full))))
    boss_fight = st['atmos'] + st['pulse'] + st['groove'] + st['heavy'] + st['boss']
    report['boss fight (no apex)'] = (lufs(boss_fight), float(np.max(np.abs(boss_fight))))
    for k, (l, p) in report.items():
        print(f'{k:40s} {l:6.1f} LUFS  peak {p:.2f}')
    # one global trim so the worst-case stack peaks at 0.97
    worst = max(p for _, p in report.values())
    g = min(1.0, 0.97 / worst)
    print('global trim', round(20 * np.log10(g), 2), 'dB')
    os.makedirs('final', exist_ok=True)
    for n, x in st.items():
        x = x * g
        sf.write(f'final/{n}.wav', (x[0] if n in MONO else x.T), SR, subtype='FLOAT')
    np.save('final/_trim.npy', np.array([g]))
