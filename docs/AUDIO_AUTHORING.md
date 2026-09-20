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

### CC-BY attribution checklist

For every CC-BY asset, the repository credit must state the **title**, **creator**,
**license version**, **source-page URL**, **original-download URL**, local filename,
and whether Omni changed the work. Use this format:

> `[Title]` by `[Creator]` — [CC BY 3.0/4.0]. Source: `[source page URL]`.
> Original: `[download URL]`. Modified: `[unmodified / exact changes]`.

The in-game audio settings must show the title and creator and link to both the
source page and the exact CC-BY license. Do not imply that the creator endorses
Omni. Keep the license text in `public/assets/audio/licenses/` when it is supplied
by the source.

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

### Exact OpenGameArt workflow

Use this when requesting or selecting a specific OpenGameArt track for Omni. It
matches the implementation of the existing `Space ambient` soundtrack.

1. On the track's OpenGameArt page, record its title, creator, license and direct
   download URL before downloading. Use only a license that permits Omni's intended
   commercial use; CC0 and CC-BY are the usual candidates. Do not assume an asset
   is free to use merely because it is hosted on OpenGameArt.
2. Download the creator's published MP3 and place it at
   `public/assets/audio/<descriptive-track-name>.mp3`. Retain the original unless
   the credits explicitly describe an edit.
3. Add a dedicated entry to `public/assets/audio/AUDIO_CREDITS.md` using the
   CC-BY template above. For CC-BY, copy the supplied license notice to
   `public/assets/audio/licenses/`; for CC0, record the asset page and CC0 status.
4. Set that filename in `engine/systems/BackgroundMusic.ts`. The current line is
   the authoritative pattern:

   ```ts
   this.media.src = inline?.['space-ambient.mp3'] ?? '/assets/audio/space-ambient.mp3';
   ```

   Replace both occurrences of `space-ambient.mp3` with the new filename. This
   preserves web serving and standalone data-URI playback.
5. Update the visible music-credit links in `components/UIOverlay.tsx` to the new
   title, creator, source page and license. This is required for CC-BY and is good
   provenance for CC0.
6. Run `npm run typecheck`, `npm run build`, `npm run test:audio`, and
   `node scripts/inline-build.mjs`. Confirm the music starts after a gesture,
   fades correctly, follows the Music/Master controls, resumes after mute and is
   present in the generated standalone HTML.

The present system plays one background track. Adding a file alone does not make
it selectable; the `BackgroundMusic.ts` source line selects the active track. For
multiple selectable tracks, first implement the catalog/fade behavior described
above and include a complete credit entry for every catalog item.

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
