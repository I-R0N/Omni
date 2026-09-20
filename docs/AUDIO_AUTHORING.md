# Adding music and sound to Omni

This guide covers the shipped sample-bank audio system and the legacy WAV recovery
path. Read [CINEMATIC_AUDIO.md](CINEMATIC_AUDIO.md) first for the current mix and
asset architecture.

## Current sources and licensing

- **Effects:** Kenney's [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds)
  and [Impact Sounds](https://kenney.nl/assets/impact-sounds), both CC0.
- **Music:** Osmic's [Space ambient](https://opengameart.org/content/space-ambient),
  licensed CC BY 3.0. The current `space-ambient.mp3` is the complete, unmodified
  ten-minute file.

Keep a license record for every new asset. Put the source URL, author, license,
whether the file was changed, and the local filename in
`public/assets/audio/AUDIO_CREDITS.md`. Copy any supplied license text to
`public/assets/audio/licenses/`. CC-BY material also needs a visible attribution;
the audio settings currently display the soundtrack credit.

## Add or replace background music

The game currently streams one looping background track through
`BackgroundMusic`, which routes it to the Music bus. It is intentionally streamed
rather than decoded into a ten-minute Web Audio buffer.

1. Use a repository-safe MP3 and place it in `public/assets/audio/`.
2. If replacing the soundtrack, update the filename in
   `engine/systems/BackgroundMusic.ts` and update the visible credit in
   `components/UIOverlay.tsx`.
3. Add its credit and license notice as described above.
4. Run `npm run build`. `scripts/inline-build.mjs` automatically embeds every
   MP3 in `public/assets/audio/` for the standalone build.
5. Verify user-gesture start, music-volume zero, mute, pause, tab hiding and
   resume. The existing `tests/audio.spec.ts` music test is the baseline.

To use several tracks, do not create another independent `<audio>` element.
Extend `BackgroundMusic` with a small, credited track catalog and change tracks
by fading its existing gain to zero, switching the element source, then fading up.
Keep all tracks connected through the single Music bus so the Master and Music
sliders continue to work.

## Add a produced sound effect

Each sound is addressed by one registry ID. Gameplay code calls
`audio.play('id')` or `audio.loop('id', ...)`; it must not create audio nodes
itself.

1. Define or adjust the ID, mix tier, gain, cooldown, polyphony and spatial flag in
   `engine/systems/SfxRegistry.ts`. Add the event to
   `docs/SFX_INVENTORY.md`.
2. For a sample-bank effect, add the recipe in
   `scripts/build-cinematic-audio.py`. The script maps each ID to one of four
   banks: `weapons`, `impacts`, `world` or `interface`.
3. Obtain the licensed source material, update `AUDIO_CREDITS.md`, and build all
   banks from the same source folder:

   ```sh
   python scripts/build-cinematic-audio.py SOURCE
   ```

   This rewrites the MP3 banks and `engine/systems/CinematicBank.json` together.
   Do not hand-edit cue offsets or replace a bank file by itself.
4. Run `npm run typecheck`, `npm run build`, and `npm run test:audio`.
   Check repeated-fire behavior, distance, pause and mute in-game.

The generator creates three varied takes per one-shot and one seamless take per
parameter-driven loop. Keep bulk effects low-fatigue and respect the existing
per-ID cooldown and polyphony settings.

## Legacy WAV fallback

For a small recorded fallback, add mono WAV variants under
`public/assets/sfx/` with the ID written using hyphens, for example
`weapon-blaster-fire-a.wav`. The loader discovers variants by longest matching
prefix. These remain recovery assets; the primary experience is the generated MP3
bank path. Do not use the old blanket 250/300 ms trim tool for intentional
musical or cinematic tails.
