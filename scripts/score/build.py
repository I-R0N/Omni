"""Rebuild the adaptive score end to end:  python scripts/score/build.py

compose (render 6 stems + 2 one-shots) → mix (balance, verify stacks) →
encode (32 kHz MP3) straight into public/assets/audio/.  Needs Python 3 with
numpy, scipy, numba, soundfile and pyloudnorm, plus ffmpeg with libmp3lame.
About a minute on one core.  Rendering is deterministic: the same scripts
produce the same audio.
"""
import os, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'audio')
WORK = os.path.join(HERE, '.work')
os.makedirs(WORK, exist_ok=True)
os.chdir(WORK)
sys.path.insert(0, HERE)


def run(script):
    subprocess.run([sys.executable, os.path.join(HERE, script)], check=True, cwd=WORK,
                   env={**os.environ, 'PYTHONPATH': HERE})


run('compose.py')
run('mix.py')

import soundfile as sf
import pyloudnorm as pyln
from synth import SR

meter = pyln.Meter(SR)
r = np.load('out/riser.npy')
r *= 10 ** ((-19 - meter.integrated_loudness(r.T.astype(np.float64))) / 20)
r = np.clip(r, -0.97, 0.97)
im = np.load('out/impact.npy')
im *= 0.9 / np.max(np.abs(im))
sf.write('final/riser.wav', r.T, SR, subtype='FLOAT')
sf.write('final/impact.wav', im.T, SR, subtype='FLOAT')


def enc(name, channels, kbps):
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', f'final/{name}.wav', '-ar', '32000',
                    '-ac', str(channels), '-c:a', 'libmp3lame', '-b:a', f'{kbps}k',
                    os.path.join(OUT, f'score-{name}.mp3')], check=True)


for n in ('atmos', 'pulse', 'heavy', 'apex', 'riser', 'impact'):
    enc(n, 2, 128)
for n in ('groove', 'boss'):
    enc(n, 1, 80)
print('wrote', OUT)
