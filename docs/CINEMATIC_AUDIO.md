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

## Music and controls

The complete ten-minute Space ambient by Osmic streams through an HTML audio
element into the music bus, avoiding a ten-minute decoded PCM allocation. Playback
starts on user gesture, fades between gameplay and menus, continues quietly through
pause/scene changes, and preserves its position across mute and music-volume zero.
Hidden tabs suspend it. Master controls everything; SFX controls every event cue,
including wave/boss stingers; Music controls the soundtrack. Existing in-memory
settings behavior is preserved. Audio settings show the attribution/license links.

Both web and standalone builds include the banks and score. The standalone embeds
MP3 data URIs; its download is larger because it contains the full score.

## Licensing and reproduction

See public/assets/audio/AUDIO_CREDITS.md and the included notices. Kenney sources
are CC0; the unmodified score is CC BY 3.0. No runtime third-party service is used.

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
and streaming music playback/position. Boot/run tests exercise dock, outfitting,
portals, boss progression and return home. These are automated Chromium checks;
subjective listening and physical iPhone/headphone latency remain playtest work.
