"""Victory stingers: one per song, in its key, on its guitar rig.  A boss
dies → the combat layers drop and this rings out → the area theme returns.
A held tonic power chord with a final pick slide in, a crash, a choir chord
and a sub hit, ~3.5 s with its tail.  `python stingers.py` → out/*-victory.npy
"""
import numpy as np
from synth import SR, reverb
import instruments as I
import guitar as G

# (file prefix, chord root midi for guitar, choir voicing, rig)
SONGS = {
    '': (38, [62, 66, 69, 74], 'amp'),        # Omni: D minor → D major (picardy third) for the win
    'b-': (40, [64, 68, 71, 76], 'amp'),      # Event Horizon: E → E major
    'c-': (36, [60, 64, 67, 72], 'amp_hi'),   # Critical Mass: C → C major
}


def victory(root, voicing, rig):
    n = int(4.5 * SR)
    di = np.zeros(n, np.float32)
    # three quick pickup chugs, then the held chord
    for i, t in enumerate((0.0, 0.09, 0.18)):
        s = G.power_chord(root, 0.07, 0.8, ('vp', i), mute=True)
        a = int(t * SR); di[a:a + len(s)] += s[:n - a]
    s = G.power_chord(root, 3.2, 1.0, 'vhold')
    a = int(0.28 * SR); di[a:a + len(s)] += s[:n - a]
    g = G.amp_hi(di, 1.0, 0) if rig == 'amp_hi' else G.amp(di, 70)
    g = np.stack([g, g]) * 0.8
    out = np.zeros((2, n), np.float32)
    out += g
    hit = int(0.28 * SR)
    cr = I.crash(1.0, 'vcrash', 3.0); out[:, hit:hit + cr.shape[1]] += cr[:, :n - hit]
    k = I.metal_kick(1.0, 'vk'); out[:, hit:hit + len(k)] += k[:n - hit]
    for i, m in enumerate(voicing):
        c = I.choir(m, 2.6, 0.4, key=('vch', i)); out[:, hit:hit + c.shape[1]] += c[:, :n - hit]
    t = np.arange(n) / SR
    fade = np.clip((4.3 - t) / 0.8, 0, 1)
    out = reverb(out * fade, 3.5, 2.6, 0.35, 'hall', 6000)
    return (out / np.max(np.abs(out)) * 0.9).astype(np.float32)


if __name__ == '__main__':
    for prefix, (root, voicing, rig) in SONGS.items():
        np.save(f'out/{prefix}victory.npy', victory(root, voicing, rig))
        print(prefix or 'a-', 'victory done')
