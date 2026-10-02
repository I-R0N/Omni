# Sample-based sound and background music

This revision responds to the request for fuller, longer, less arcade-like sounds.
It preserves gameplay, visuals, event hooks and spatial mixing from the initial pass.

## Sound sources

All 106 registered IDs now have produced sample sources: three takes for each of
99 one-shots, plus seven four-second seamless loops (304 takes total). Kenney
Sci-Fi Sounds and Impact Sounds provide engine, mechanical, impact and energy
textures. Retro laser samples are excluded. Recipes layer and filter these sources,
add restrained room reflections, shape release envelopes and normalize with headroom.

Fast UI cues stay 190–310 ms. Rapid weapons have short controlled bodies; heavier
weapons extend to 2.3 seconds and major transitions to 2.8 seconds. Movement,
charge, station, portal, snitch, disable and bubble loops use continuous sample
textures with parameter-driven gain/filter/pitch. Player attacks can retire an older
tail at their per-ID ceiling, preserving the next attack without increasing the cap.

Four 192 kbps mono MP3 banks load/decode once, then the manifest slices reusable
AudioBuffers. No runtime network request is made for individual shots. Random
selection avoids consecutive identical takes; additional pitch jitter is capped at
3.5%. Existing attenuation, ducking, cooldowns and global concurrency caps remain.
Missing/unsupported banks fall back to legacy sources and report bankFailures.

## Mix and lifecycle

`AudioMix.busFor` routes every ID to one of four buses: `ui` (`ui.*`, the `poi.*`
cues except the station bed, `portal.transit`, `destroy.player`), `feedback`
(every other tier-1 ID), `world` (every other ID) and `music` (the score alone).
Master scales all four, the SFX slider the first three, the Music slider the
score. Master feeds a soft-knee compressor that restrains combined peaks.
Critical cues (`AudioMix.ducksWorld`: player hull hits, shield break, player
death, boss cues, health pickup, EMP) briefly duck the world bus. At the hard
voice ceiling a new voice steals a less important live one (a higher tier, or a
world voice when the newcomer ducks the world) rather than being dropped.

A frozen sim (pause, dock, menu, debug freeze) drops every one-shot and loop whose
ID is not on the `AudioMix.survivesPause` whitelist: `ui.*`, `poi.*` except the
station bed, `portal.transit`, `destroy.player`, `boss.intro`/`boss.death` and
`wave.*`. A map load clears the world voices and retrigger state outside that
whitelist; returning to the menu and muting clear every voice. A hidden tab stops
world audio and suspends the context and the score; returning resumes a context
that was already unlocked.

## Music and controls

The complete ten-minute Space ambient by Osmic streams as the exploration bed, and
the Fly, Tracers, and Countdown playlist streams as a battle layer under it.
The playlist is opened once and then runs continuously: inside an encounter a
track changes only when it ENDS, so one song carries a whole wave sequence
rather than restarting each time the field clears. Hostile PROXIMITY only ducks
the layer. It counts a live boss at any range, or a hostile within
`AUDIO_CONSTANTS.MUSIC_ENGAGE_SCREENS` screens (let go at `MUSIC_RELEASE_SCREENS`),
and holds for `MUSIC_LINGER_SEC` after the last one leaves. With nothing near the
player the layer fades out and pauses, and the next engagement fades back in at
the same point in the same song. Two events cut the layer to a new track from the
top, and both mean a new encounter: a boss warping in, and a map change. The map
change also drops the linger, so leaving an arena ends its fight at once. The
boss cut is where boss-specific music will be chosen, with no engine call site
moving.
Both flow through the music bus, avoiding long decoded PCM allocations. Playback
starts on user gesture, fades between gameplay and menus, continues quietly through
pause/scene changes, and preserves its position across mute and music-volume zero.
The battle catalog is not requested on the title screen: its first track starts
loading only when combat begins, then metadata for one successor is warmed while
the current track plays.
Hidden tabs suspend both. Master controls everything; SFX controls every event cue,
including wave/boss stingers; Music controls both score layers. Existing in-memory
settings behavior is preserved. Audio settings show the attribution/license links.

Both web and standalone builds include the banks and score. The standalone embeds
MP3 data URIs; its download is larger because it contains the full score.

## Licensing and reproduction

See public/assets/audio/AUDIO_CREDITS.md and the included notices. Kenney sources
are CC0. The score tracks are individually credited under CC BY 3.0 or CC BY 4.0:
Space ambient is unmodified, and the three battle tracks are 192 kbps transcodes
with no musical edits. No runtime third-party service is used.

Download the two source archives linked in the credits and extract into
SOURCE/scifi and SOURCE/impacts. With Python NumPy/SciPy and ffmpeg installed:

```sh
python scripts/build-cinematic-audio.py SOURCE
npm run typecheck
npm run build
npm run test:audio
npm run test:smoke
node scripts/inline-build.mjs
```

The generator records source recipes, seeded variants and exact cue boundaries.
Do not apply the legacy 250/300 ms WAV preparation cap to these intentional tails.

## Validation

Browser tests cover every decoded take, complete event coverage, finite/audible
samples, bounded decoded memory, variation, stereo direction, volume controls,
pause/mute cleanup, a 400-event burst, critical-voice priority, repeated long attacks,
and streaming music playback/position. The battle-layer tests pin a lull ducking
the song without rewinding it, a boss warp-in and a map change each starting a new
song, and a portal out of a fight standing the layer down. `tests/audio.spec.ts`
also checks that the registry and `docs/SFX_INVENTORY.md` name the same IDs, and
the iOS session and interruption handling. Boot/run tests exercise dock, outfitting,
portals, boss progression and return home. These are automated Chromium checks;
subjective listening and physical iPhone/headphone latency remain playtest work.
