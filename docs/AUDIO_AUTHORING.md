# Adding music and sound to Omni

This guide covers the shipped sample-bank audio system and the legacy WAV recovery
path. Read [CINEMATIC_AUDIO.md](CINEMATIC_AUDIO.md) first for the current mix and
asset architecture.

## Current sources and licensing

- **Effects:** Kenney's [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds)
  and [Impact Sounds](https://kenney.nl/assets/impact-sounds), both CC0.
- **Exploration music:** Osmic's [Space ambient](https://opengameart.org/content/space-ambient),
  CC BY 3.0; `space-ambient.mp3` is the complete, unmodified ten-minute file.
- **Battle music:** Alexandr Zhelanov's [Fly](https://opengameart.org/content/techno-space),
  CC BY 3.0; `fly-battle.mp3` is the published MP3, unmodified.
- **Battle playlist:** Sygil's [Tracers](https://opengameart.org/content/tracers),
  CC BY 4.0, and Alexandr Zhelanov's [Countdown](https://opengameart.org/content/countdown-0),
  CC BY 3.0. The three battle tracks rotate without looping one track during
  prolonged combat.

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

The game streams two looping score layers through `BackgroundMusic`, which routes
them to the Music bus: `space-ambient.mp3` is the exploration bed and
`fly-battle.mp3`, `tracers-battle.mp3`, and `countdown-battle.mp3` form a battle
playlist that hands over from one track to the next only when a track ENDS.
Hostile proximity ducks that layer and pauses it, holding its position, so a
lull never costs the song its place. A lull is graded by
`AUDIO_CONSTANTS.MUSIC_LINGER_SEC` — an arena's field empties on every wave
clear with the next wave seconds away, so the layer rides that gap out rather
than cutting. **A MAP CHANGE IS NOT A LULL**: `transitionToMap` deliberately
leaves the enemies behind, so `loadMapFresh` drops the linger stamp
(`lastHostileNearAt`) along with the other handles to the old map's fight, and
the destination decides from its own hostiles on the next frame. Without that,
fleeing a boss into the quiet hub kept its music playing for the full linger
plus the layer's own fade (measured: 6.0 s of overworld, ~5 s of fade on top).
Arriving somewhere dangerous still engages instantly. **A MAP CHANGE ALSO
STARTS A NEW SONG**: the same `loadMapFresh` calls `cueBattleTrack()`, so
re-entering an arena opens a fresh track instead of resuming the previous one
mid-phrase (user report). The continuous-playlist rule is drawn around ONE
arena's wave ladder, and the map boundary is where that ladder ends rather than
an exception to it. Order is load-bearing there: the stand-down
(`audio.setCombat(false)`, pushed with `lastReportedCombat` so the transition
gate cannot desync) runs FIRST, which is what makes the cue silent — the
successor waits paused at 0 for the destination's own first engagement, instead
of starting at full level over the warp beat and fading straight back out.

Two callers therefore cut a track short, and both say the same thing — a new
encounter begins: a boss capstone's entrance, and a map change. Everywhere
INSIDE an encounter a track still runs to its own end. Add boss-specific music
by choosing it inside `cueBattleTrack()` rather than at a call site.

Fades: `FADE_IN_SEC` (0.75) and `FADE_OUT_SEC` (0.8) are `setTargetAtTime` time
CONSTANTS, not durations — an exponential approach is ~95% done after three of
them, so the audible fade-out tail is ~2.4 s. `FADE_OUT_SEC` is the only
fade-out in the score and so governs every instance of one: leaving an arena,
the pause menu, returning to the menu, and an ordinary fight ending. It was
halved from 1.6 (user call). `BATTLE_PAUSE_DELAY_MS` is DERIVED from it — the
pause is what holds a track's position, so it must land after the fade rather
than race it — which means retuning the fade moves that too, by construction.
The ambient bed is deliberately not direction-aware: its downward move is a
DUCK between two audible levels, not a fade to silence.

All are streamed rather than decoded into
long Web Audio buffers. Battle sources are attached only when combat first
starts; one upcoming track receives a metadata preload, so the title screen does
not download the whole playlist.

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
4. Set that filename in `engine/systems/BackgroundMusic.ts` using the current
   track-construction pattern:

   ```ts
   this.battle = this.makeTrack('fly-battle.mp3', destination);
   ```

   Replace the appropriate track filename, or add another `makeTrack` entry when
   implementing a new music state. `makeTrack` preserves web serving and standalone
   data-URI playback.
5. Update the visible music-credit links in `components/UIOverlay.tsx` to the new
   title, creator, source page and license. This is required for CC-BY and is good
   provenance for CC0.
6. Run `npm run typecheck`, `npm run build`, `npm run test:audio`, and
   `node scripts/inline-build.mjs`. Confirm the music starts after a gesture,
   fades correctly, follows the Music/Master controls, resumes after mute and is
   present in the generated standalone HTML.

Adding a file alone does not make it selectable. `BackgroundMusic.ts` selects and
mixes the active tracks. For a third or selectable track, extend its small track
catalog/fade behavior and include a complete credit entry for every catalog item.

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
