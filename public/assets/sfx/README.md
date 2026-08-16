# Recorded SFX takes

Drop `.wav` files here. A file at `public/assets/sfx/foo.wav` is fetched by
the game from `/assets/sfx/foo.wav` — `public/` is served at the site root,
the same convention `assets.ts` uses for sprites.

## Wiring a file to a sound

Nothing here is discovered automatically. A file is used only once an id in
`engine/systems/SfxRegistry.ts` names it:

```ts
a.register('crash.player.shard', {
  tier: 1, gain: 0.34, poly: 3, minInterval: ms(70), collapse: true,
  jitter: 0.12, positional: true,
  sample: ['shard-hit-a.wav', 'shard-hit-b.wav', 'shard-hit-c.wav'],
  render: s => …,          // keep this — it is the fallback
});
```

Several filenames are **variants**, cycled round-robin per trigger. Keep the
`render` draft: a missing or undecodable file falls back to it, so the game
degrades to a different sound rather than to silence, and the standalone
build (which carries no audio) still makes noise.

## Format

| | |
|---|---|
| Container | `.wav`, PCM |
| Sample rate | 22 050 Hz is plenty for short material hits; 44 100 if you have it |
| Channels | **mono** — the engine pans positionally, and a stereo file fights that |
| Level | normalise to about −6 dBFS and leave the mixing to the `gain` field |
| Trim | cut silence off the head; a leading gap reads as latency on impact sounds |

## Pitch is applied by the engine, so record neutral

`crash.player.shard` is pitched by shard SIZE and gained by impact speed at
the call site (`PhysicsSystem.sfx` passes `{gain, pitch}`). Pitch rides
`playbackRate`, so one take spans pebble-tap to boulder-slam. Record the
middle of the range and let the engine spread it — do not bake a sweep in.

## Two rules that come from playtest, not taste

**Stay below ~2 kHz, and keep resonance low.** CLAUDE.md §8 has the full
note. Bulk-fired sounds are judged by what a hundred of them sound like,
and a ringing high-Q peak is what reads as whining. `scripts/smoke/tone.mjs`
asserts this for the synth drafts.

**Vary the takes.** Three slightly different recordings beat one perfect
one for anything that fires in bulk.

## Check a file before trusting it

```bash
npm run build
npx vite preview --port 4173 --host 127.0.0.1 &
node scripts/smoke/assets.mjs
```

It decodes every wav in this folder with the browser's own decoder and
reports level, how much of the file is digital silence, content length,
channel count and dominant frequency — then fails on anything the engine
cannot use. Run it after every export; a bad export is not audible as
"quiet", it is audible as nothing at all.

A file that decodes but carries no signal is **rejected at load**
(`AUDIO_CONSTANTS.SAMPLE_MIN_PEAK`) and its id falls back to the synth
draft, so a broken export cannot silence a working sound.
