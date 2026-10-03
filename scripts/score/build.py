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


def run_args(script, *args):
    subprocess.run([sys.executable, os.path.join(HERE, script), *args], check=True, cwd=WORK,
                   env={**os.environ, 'PYTHONPATH': HERE})


run('compose.py')          # song A: "Omni"            → score-*.mp3
run('mix.py')
run('song2.py')            # song B: "Event Horizon"   → score2-*.mp3
run_args('mix.py', 'b-')

import soundfile as sf
import pyloudnorm as pyln
from synth import SR

meter = pyln.Meter(SR)
def norm_riser(src, dst):
    r = np.load(src)
    r *= 10 ** ((-19 - meter.integrated_loudness(r.T.astype(np.float64))) / 20)
    sf.write(dst, np.clip(r, -0.97, 0.97).T, SR, subtype='FLOAT')


norm_riser('out/riser.npy', 'final/riser.wav')
norm_riser('out/b-riser.npy', 'final/b-riser.wav')
im = np.load('out/impact.npy')
im *= 0.9 / np.max(np.abs(im))
sf.write('final/impact.wav', im.T, SR, subtype='FLOAT')


def enc(src, dst, channels, kbps):
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', f'final/{src}.wav', '-ar', '32000',
                    '-ac', str(channels), '-c:a', 'libmp3lame', '-b:a', f'{kbps}k',
                    os.path.join(OUT, f'{dst}.mp3')], check=True)


for song, prefix in (('', 'score-'), ('b-', 'score2-')):
    for n in ('atmos', 'pulse', 'heavy', 'apex', 'riser'):
        enc(song + n, prefix + n, 2, 128)
    for n in ('groove', 'boss'):
        enc(song + n, prefix + n, 1, 80)
enc('impact', 'score-impact', 2, 128)    # shared by both songs
print('wrote', OUT)
