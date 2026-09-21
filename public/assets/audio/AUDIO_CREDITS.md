# Audio credits and permissions

## Background music

**Space ambient** — **Osmic**

- Source: https://opengameart.org/content/space-ambient
- Original download: https://opengameart.org/sites/default/files/ville_seppanen-1_g.mp3
- License: Creative Commons Attribution 3.0 Unported (CC BY 3.0)
- License terms: https://creativecommons.org/licenses/by/3.0/
- Legal code: https://creativecommons.org/licenses/by/3.0/legalcode
- File: `space-ambient.mp3`, complete original ten-minute track, unmodified.
- Runtime volume adjustment and looping only. No endorsement by the author is implied.
- Attribution and license links are also visible in the game's audio settings.

**Fly** — **Alexandr Zhelanov**

- Source: https://opengameart.org/content/techno-space
- Original download: https://opengameart.org/sites/default/files/Fly.mp3
- License: Creative Commons Attribution 3.0 Unported (CC BY 3.0)
- License terms: https://creativecommons.org/licenses/by/3.0/
- File: `fly-battle.mp3`, transcoded from the published `Fly.mp3` to a 192 kbps
  MP3 runtime encode; no musical edits.
- Runtime looping and gain fades only. No endorsement by the author is implied.
- Used as the battle layer while hostile enemies are present; attribution and
  license links are visible in the game's audio settings.

**Tracers** — **Sygil**

- Source: https://opengameart.org/content/tracers
- Original download: https://opengameart.org/sites/default/files/tracers.mp3
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- License terms: https://creativecommons.org/licenses/by/4.0/
- File: `tracers-battle.mp3`, transcoded from the published `tracers.mp3` to a
  192 kbps MP3 runtime encode; no musical edits.
- Runtime playback and gain fades only. No endorsement by the author is implied.

**Countdown** — **Alexandr Zhelanov**

- Source: https://opengameart.org/content/countdown-0
- Original download: https://opengameart.org/sites/default/files/Countdown.mp3
- License: Creative Commons Attribution 3.0 Unported (CC BY 3.0)
- License terms: https://creativecommons.org/licenses/by/3.0/
- File: `countdown-battle.mp3`, transcoded from the published `Countdown.mp3`
  to a 192 kbps MP3 runtime encode; no musical edits.
- Runtime playback and gain fades only. No endorsement by the author is implied.

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
