# Music pipeline: compose → GarageBand → game

The adaptive score is DATA. A song is a folder of six synchronised loop stems
in `public/assets/audio/score/<id>/` (`atmos`, `pulse`, `groove`, `heavy`,
`apex`, `boss`, plus optional `riser` and `victory`), listed in
`public/assets/audio/score/index.json` together with the music PLAN (which
song plays in the hub, `field_*` maps, `arena_*` maps, and boss fights). The
engine (`engine/systems/AdaptiveMusic.ts`) reads the index at startup; the
standalone build inlines it. **Adding or replacing a song needs no code.**

## The loop

1. **Compose.** A song arrives as a *GarageBand kit*: one MIDI file per layer
   (`1 - Import these`), `song.json` (id, title, bpm, bars, `use`), an empty
   `2 - Exports` folder, reference renders, and a step-by-step README.
2. **Review in GarageBand.** Import each layer, stack it, change sounds or
   notes. GarageBand auto-assigns instruments from the MIDI's General MIDI
   program numbers (distortion guitar, fingered bass, choir, brass, drum
   kits).
3. **Export.** Cycle range bar 1 → bar *bars + 3* (two extra bars of tail),
   solo each layer's stack, *Export Song to Disk* as WAVE/AIFF named after the
   layer into `2 - Exports`. Auto Normalize off, so the layer balance survives.
4. **Import.** `npm run music:import -- "<kit folder>"` (`--check` to validate
   without writing).

## What `music:import` does

- Finds the six layers (and optional `riser` / `victory`) by file name; wav,
  aif, aiff, m4a, mp3 or caf.
- Checks each is at least one loop long at song.json's tempo — the usual
  mistake is a project left at GarageBand's default 120 BPM.
- FOLDS everything past the loop back onto its start (the export is one pass;
  the game hears every pass after the first, which carries the previous
  pass's echoes), then writes the exactly-periodic file the engine needs:
  0.5 s lead-in + loop + 1.5 s run-out. Any loop window inside that margin is
  seamless, whatever the MP3 decoder's delay.
- One gain for all layers: the full stack at −13 LUFS (never above a 0.97
  peak). The balance between layers is the GarageBand mix's.
- 32 kHz MP3, mono when a layer is mono. Writes `song.json` beside the stems.
- Adds or replaces the song in `index.json`; each role in song.json's `use`
  (`hub`, `field`, `arena`, `boss`) points the plan at it.

Verified offline: a single-pass export of Critical Mass, imported this way,
reproduces the composed loop (to the MP3 codec's noise floor), loops without a
seam, and plays sample-locked in the engine.

## Contracts the engine relies on

- Every layer of a song is the same length, starts at bar 1, same tempo.
- Layer gain 1 = the mix you exported; the engine only fades whole layers.
- `riser` ends on a downbeat (it is played so its END lands on the groove's
  entry bar line); `victory` starts with its hit. Both are optional.
- Song ids: lowercase letters, digits, dashes.

## Debug

Debug ▸ Perf & Diagnostics ▸ Adaptive Music: `Music song` pins any song in the
index (shows "current → pending"), `Music force` auditions layers.
