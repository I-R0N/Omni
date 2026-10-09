# Adding music and sound to Omni

This guide covers the shipped sample-bank audio system and the legacy WAV recovery
path. Read [CINEMATIC_AUDIO.md](CINEMATIC_AUDIO.md) first for the current mix and
asset architecture.

## Current sources and licensing

- **Effects:** Kenney's [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds)
  and [Impact Sounds](https://kenney.nl/assets/impact-sounds), both CC0.
- **Music:** the original adaptive score composed for Omni — six synchronised
  stems plus two transition one-shots (`score/<song>/*.mp3`), synthesized entirely by
  `scripts/score/`. No third-party material, so no attribution requirement.

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

## The adaptive score

**Adding or changing songs: see `docs/MUSIC_PIPELINE.md`** (GarageBand kit →
`npm run music:import`). Songs and the plan live in
`public/assets/audio/score/index.json`; this section is how the engine uses
them.

The music is three SONGS — "Omni" (D minor, 128 BPM, 60 s), "Event Horizon"
(E minor, 160 BPM, 48 s, thrash) and "Critical Mass" (C minor, 150 BPM with
half-time drums, 51.2 s, the guitar-forward one on the overamped rig) — each
split into six stems that loop
forever on one AudioContext clock (`engine/systems/AdaptiveMusic.ts`).
Intensity never changes where the music is — only how loud each stem is.
`scripts/score/README.md` describes the stems and the composition; this
section is how it is wired.

**Intensity.** `GameEngine.hostileNearPlayer` walks the enemy index once a
frame and, besides the combat gate, measures PRESSURE (each hostile weighs
sqrt(maxHealth / `MUSIC_WEIGHT_REF_HP`), full inside `MUSIC_CLOSE_SCREENS`,
falling to zero at `MUSIC_ALERT_SCREENS`), ALERT (anything inside that ring)
and BOSS.  The loop reports that, plus hull and EHP fractions, through
`audio.setMusicThreat` every frame.  The score reads DAMAGE from EHP falling
(no damage path reports itself), and combines: a floor per state (explore
0.05, alert 0.22, combat gate 0.42, boss 0.62) plus 0.45·pressure +
0.35·damage + 0.2·low-hull.  Smoothed: rises with τ 0.25 s, holds 3.5 s
after the last rise, falls with τ 2.2 s.

**Layers.**  Each has an on and a lower off threshold (pulse 0.18/0.12, groove
0.38/0.30, heavy 0.62/0.54, apex 0.82/0.72; boss follows the boss flag, atmos
is always on and ducks to 0.7 under the groove, 0.55 in menus).  Entries are
QUANTISED — groove, heavy and boss to the next bar line, pulse and apex to the
next beat — and the groove's entry gets a riser that ends on that downbeat; a
heavy entry lands an impact at most once per 8 bars.  Exits start on the next
beat.  Every gain move goes through `AdaptiveMusic.fade`, which anchors the
start value before a `setTargetAtTime`: a future-start target with no anchor
is computed differently by different Web Audio implementations (one overshot
to 10^10 in testing).

**Encounters.**  `audio.cueEncounter('map' | 'boss')` returns every stem to
bar 1 at the next bar line (short crossfade for drums, longer for pads).  A
boss also lands an impact there.  **A MAP CHANGE IS NOT A LULL**:
`loadMapFresh` drops the linger stamp and stands combat down before cueing,
and the map cue also zeroes intensity and its hold — otherwise the hold that
carries a stack through a wave clear would carry the drums into the hub (the
old "battle music followed me through the portal" report).  Inside an arena
nothing ever jumps; a lull only lowers intensity.

**The director (which song plays).**  `MUSIC_PLAN` in `AdaptiveMusic.ts`
assigns cues the way AAA scores do: each AREA owns a theme — the hub and
`field_*` maps play Omni, `arena_*` maps Event Horizon — and any BOSS brings
in its own theme, Critical Mass.  `loadMapFresh` reports the area
(`audio.setMusicArea`) before its `cueEncounter`; `handleBossSpawn` cues
'boss'; `payBossBounty` calls `audio.musicBossDefeated()` when the LAST live
boss dies.  If the wanted song is already playing, a cue just returns to bar
1; otherwise the change is SEAMLESS: the new song's needed stems (bed, the
layers currently in, and in a boss fight pulse/groove/heavy/boss) load into a
side buffer while the old song plays on, then the change commits on the old
song's next bar line — 0.3 s crossfade, new song at bar 1, the impact on the
seam for a boss.  The rest of the new song loads after and joins in phase.
Two songs are resident only for that decode.  While the score is stopped
(mute, volume 0) the change is immediate instead.  A boss death plays the
current song's VICTORY STINGER (tonic chord resolving major, per song) on the
next beat, drops the combat layers, keeps the combat floor off until the
proximity gate lets go, and hands back to the area theme at the first bar line
1.6 s after the stinger.  Debug ▸ Adaptive Music ▸ *Music song* shows
"current → pending" and pins a song (AUTO → Omni → Event Horizon → Critical
Mass → AUTO), and *Play song* beside it picks one directly (Auto, or a
chip per `SONGS` entry; the active one is lit).  Adding a song: render it with its own script and file prefix,
add it to `build.py`, append a `SONGS` entry, and give it a place in
`MUSIC_PLAN`.

**Layer variants (which stem fills a slot).**  A song may declare, per slot,
alternative stems named `<slot>-<variant>.mp3` (`variants`, `phraseBars` and
`contextPriority` in its index entry; `docs/MUSIC_PIPELINE.md` has the schema,
the tag list and the enemy families).  They are ordinary sample-locked stems —
started on the same `t0` by the same `startSource` math, each with its own mix
gain — so a switch is a crossfade between two sources already in phase, never
a restart.  Intensity still decides which slots are ON; this decides which
variant sounds in each slot that is.  ATMOS follows the CONTEXT TAGS
(`MusicContext.ts`, fed every frame by `GameEngine.reportMusicContext`); a
combat slot (pulse and up) picks from the dominant ENEMY FAMILY when it enters
and locks it.  Per slot, the first tag in `contextPriority` that any variant
claims wins; the first variant in list order claiming it is chosen; otherwise
`<slot>.mp3`.  Every decision is taken once per PHRASE BOUNDARY (a window of
~0.6 s before the crossfade begins, which is centred on the bar line: a bar
long for atmos, a beat for the rest), a slot that changed then holds for
`MUSIC_VARIANT_DWELL_PHRASES` (2) phrases, and a combat slot re-picks only if
another family has out-weighed its locked one by `MUSIC_FAMILY_MARGIN` (1.5×)
continuously for a whole phrase.  A song change resets every slot to its
appropriate variant at bar 1 if that variant has decoded in time (the first
start of a song begins on the defaults and switches at a later boundary).  RESIDENCY: default stems are always resident; a variant buffer is kept
while it is sounding, scheduled, wanted now, or WARM (its context is inside
`MUSIC_PREFETCH_MULT` × its radius, or its enemy family is in the alert ring);
over `MUSIC_DECODE_BUDGET_MB` the least recently wanted non-active buffer goes
first, and a variant that would not fit is not loaded.  A variant not decoded
when its boundary arrives is simply tried at the next; a missing file is
remembered, never retried, never an error.  Debug ▸ Adaptive Music shows
*Music context* and *Variants*, and *Music context force* pins a tag.

**Loading and memory.**  The title screen fetches the current song's `atmos.mp3` only; the
combat set and one-shots are fetched when a run starts (`setActive(true)`),
the boss stem on the first boss sighting.  Stems decode at **25 kHz** through an
OfflineAudioContext (≈ 60 MB decoded for Omni's six, ≈ 48 MB for Event Horizon's, ≈ 57 MB for Critical Mass's) and resample on playback.
The rate was 32 kHz and was cut (user call) because the score is the single
largest block of decoded PCM in the game and this phase targets MOBILE, where
the tab is killed on peak RSS: measured in-browser, Omni's resident stems went
70.9 MB → 55.4.  What it costs is bandwidth above 12.5 kHz, and the stems are
mastered dark, so there is little up there to lose.  Nothing about the GRID is
rate-dependent — lead-in, bpm and bars are all seconds — so bar lines land
where they did.
Each file is the loop with 0.5 s lead-in and 1.5 s run-out and is exactly
periodic, so the loop window is immune to MP3 encoder/decoder delay.

**Changing the music.**  Edit `scripts/score/compose.py` (Omni),
`song2.py` (Event Horizon), `song3.py` (Critical Mass), `instruments.py` or `guitar.py`, run `python scripts/score/build.py`, then `npm run build`
and `node scripts/inline-build.mjs` (which embeds every MP3 in
`public/assets/audio/`).  Keep `SCORE` in `AdaptiveMusic.ts` in step with
`BPM`/`BARS`/`PRE` in `compose.py`.  Layer balance lives in the files
(`TARGET` in `mix.py`); the engine plays an "on" layer at gain 1.

**Adding a stem** (e.g. a second boss): render it on the same grid in
`compose.py`, add a `LAYERS` entry in `AdaptiveMusic.ts` with its thresholds
and grid, and give it a gate in `evaluate()`.

**Debug.**  Perf & Diagnostics ▸ Adaptive Music shows intensity → target,
the live layers and the bar; *Music force* pins intensity to audition each
layer.  Pinned by the music tests in `tests/audio.spec.ts`.

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

### Listening checks

The browser tests pin structure, never quality. Before calling a sound done,
listen with headphones, ideally on a phone, since that is where the game is played:

- **Fatigue.** A sound that is fine once can be intolerable after two minutes.
  Every past offender was a loop or a bulk-fired chip.
- **Mix balance.** Check that combat does not drown pickups and that the engine
  and station beds sit under everything. The registry `gain` (the inventory's
  `mix` column) is the knob.
- **Legibility.** Enemy fire is voiced apart from player fire; confirm that
  incoming and outgoing stay tellable apart on a busy screen.
- **An actual iPhone.** Sound must play with the ring/silent switch on and come
  back after a call or an app switch. The pause menu shows a diagnostic strip
  whenever audio is not audible.

## Legacy WAV fallback

For a small recorded fallback, add mono WAV variants under
`public/assets/sfx/` with the ID written using hyphens, for example
`weapon-blaster-fire-a.wav`. The loader discovers variants by longest matching
prefix. These remain recovery assets; the primary experience is the generated MP3
bank path. Do not use the old blanket 250/300 ms trim tool for intentional
musical or cinematic tails.
