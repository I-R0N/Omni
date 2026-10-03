# Audio credits and permissions

## Background music — the adaptive score

**Omni adaptive score** — composed for Omni (2026).

- Original work made for this game; no third-party music, samples or loops.
  Every sound in it is synthesized from scratch by the scripts in
  `scripts/score/` (oscillators, filters, envelopes and generated reverb
  impulse responses), so the score carries no attribution requirement.
- Files: `score-atmos.mp3`, `score-pulse.mp3`, `score-groove.mp3`,
  `score-heavy.mp3`, `score-apex.mp3`, `score-boss.mp3` (the six synchronised
  stems) and `score-riser.mp3`, `score-impact.mp3` (transition one-shots).
- Format: 32 kHz MP3 (128 kbps stereo; groove and boss 80 kbps mono). Each stem
  is the 60-second loop with 0.5 s of lead-in and 1.5 s of run-out, exactly
  periodic — see `engine/systems/AdaptiveMusic.ts` for why.
- Rebuild: `scripts/score/README.md`.

The previous soundtrack (Space ambient by Osmic; Fly and Countdown by Alexandr
Zhelanov; Tracers by Sygil) was removed from the game together with its credits.

## Sound effects

**Sci-Fi Sounds 1.0** and **Impact Sounds 1.0** — **Kenney**

- Sources: https://kenney.nl/assets/sci-fi-sounds and https://kenney.nl/assets/impact-sounds
- License: Creative Commons Zero (CC0 1.0 Universal)
- Terms: https://creativecommons.org/publicdomain/zero/1.0/
- Original included notices: `licenses/Kenney-Sci-Fi.txt`, `licenses/Kenney-Impacts.txt`.
- Derived files: `weapons.mp3`, `impacts.mp3`, `world.mp3`, `interface.mp3`.
- Changes: sample layering, pitch/time resampling, equalization, transient trimming,
  body saturation, short room reflections, controlled release fades, seamless
  loop splices, peak normalization and encoding into gapless MP3 cue banks.
- No new oscillator-based effects are used in these banks. The source library's
  deliberately retro laser set is excluded.

`scripts/build-cinematic-audio.py` contains each cue's source recipe and seeded
variant processing; `engine/systems/CinematicBank.json` records exact cue ranges.
Existing legacy assets/recipes are retained only as a network/codec recovery path.
