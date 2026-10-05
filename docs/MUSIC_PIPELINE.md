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

## Layer variants

A song can hold several VERSIONS of a layer, chosen by the situation. Each of
the six slots (`atmos`, `pulse`, `groove`, `heavy`, `apex`, `boss`) keeps its
default stem `<slot>.mp3`, and may add variants `<slot>-<variant>.mp3`. A
variant is a complete alternative stem: **same tempo, same length, same
harmony, different orchestration**. The engine plays every resident variant of
a slot on the same clock as the rest of the song, so switching is a gain
crossfade between stems already in phase — nothing restarts. A song with no
`variants` behaves exactly as before.

The director makes two separate decisions: which slots are ON (the existing
intensity model, unchanged) and which variant fills each slot that is on.

### The contract: context tags and enemy families

These names are what the music is composed against. They are exact strings.

| tag | when it is active |
| --- | --- |
| `station` | within 1.6 screens of a space station (leaves past 2.2) |
| `portal` | within 1.2 screens of a portal or rift (leaves past 1.7) |
| `rare-item` | within 1.0 screen of a high-value pickup (leaves past 1.4): a salvage drop holding 6+ units (merged piles sum), the golden snitch, or a POI declaring a rare `poiTier` |
| `danger` | within 0.8 screens of a threat that is not an engaged fight (leaves past 1.2): a portal (wormhole well), any bubble, a rival hunting the player, or a dragon. A portal raises `portal` too; `danger` outranks it in the default priority |
| `deep-space` | none of the four above for 20 sim seconds |
| `enemy:swarm` | swarm is the dominant enemy family |
| `enemy:heavy` | heavy is the dominant enemy family |
| `enemy:ranged` | ranged is the dominant enemy family |

A "screen" is the viewport half-diagonal, so the radii read the same on a phone
and a monitor. Every context has a wider leave radius than enter radius
(hysteresis). All numbers are `AUDIO_CONSTANTS.MUSIC_*` in `constants.ts`.

**Enemy families.** Each frame the hostiles inside the alert ring contribute
their existing pressure weight (heavier and closer count more) to their family;
the family with the most weight (at least 0.5) is dominant. A boss adds its
weight at any range.

| family | enemy types |
| --- | --- |
| `swarm` (many cheap, fast bodies) | RAMMER_1, RAMMER_2, KAMIKAZE, SWARM, NEST, BOSS_SCATTER |
| `heavy` (slow, high-health) | RAMMER_3, BULWARK, BUBBLE, DRAGON, BOSS_WARDEN; also the default for any type not listed |
| `ranged` (hold off and shoot) | SHOOTER_1, SHOOTER_2, SHOOTER_3, TURRET, BOSS_SIEGE; and rivals (privateers) |

The table is `AUDIO_CONSTANTS.MUSIC_ENEMY_FAMILY`.

### How a variant is chosen

- **atmos** follows the context tags. Tags are tried in `contextPriority` order
  (default `danger`, `rare-item`, `station`, `portal`, `deep-space`, then the
  enemy tags); the first tag that some variant of the slot claims wins, and the
  first variant in list order that claims it is used. If none claims an active
  tag, the default `atmos.mp3` plays.
- **Combat slots** (`pulse`, `groove`, `heavy`, `apex`, `boss`) look only at the
  enemy family. A slot picks its variant when it ENTERS, from the dominant
  family, and locks it. It re-picks at a phrase boundary only if another family
  has outweighed the locked one by 1.5× continuously for the whole phrase.
- **Timing.** Changes commit only on phrase boundaries (`phraseBars` bars from
  the start of the song, default 8), as a crossfade centred on the bar line:
  about one bar for `atmos`, one beat for the rhythmic slots. After a change a
  slot holds its variant for 2 phrases. A song change starts every slot on its
  appropriate variant at bar 1 (if it has decoded by then).
- **Loading.** Variants are decoded on demand: the sounding one, the one the
  slot would pick now, and warm candidates (a context within 1.5× its enter
  radius; an enemy family present in the alert ring). Over the 110 MB budget the
  least recently wanted inactive variant is dropped. A variant that has not
  decoded by its boundary is tried at the next one, and a missing file falls
  back to the default silently (no error), so a song can declare variants
  before the audio exists.

### `song.json` schema

`variants`, `phraseBars` and `contextPriority` are optional; the import copies
them into the index entry unchanged.

```json
{
  "id": "omni", "title": "Omni", "bpm": 128, "bars": 32, "use": ["hub"],
  "phraseBars": 8,
  "variants": {
    "atmos": [
      { "name": "station",  "when": ["station", "portal"] },
      { "name": "deep",     "when": ["deep-space"] },
      { "name": "treasure", "when": ["rare-item"] },
      { "name": "danger",   "when": ["danger"] }
    ],
    "pulse": [ { "name": "swarm", "when": ["enemy:swarm"] }, { "name": "heavy", "when": ["enemy:heavy"] } ]
  },
  "contextPriority": ["danger", "rare-item", "station", "portal", "deep-space"]
}
```

- `variants`: slot → list of `{ name, when }`. `name` is lowercase letters,
  digits and dashes, unique within the slot. `when` lists tags from the table
  above (an unknown tag is a warning: it can never fire).
- `phraseBars` must be a whole number that divides `bars`, so phrase boundaries
  tile the loop.

### Exporting variants

Export each variant exactly like its slot's default (same bar range, same
project tempo, Auto Normalize off) and name it `<slot>-<variant>`, e.g.
`atmos-station.wav` next to `atmos.wav`. The import then:

- errors if a declared variant has no file;
- warns about, and ignores, a file that looks like a variant song.json does not
  declare;
- folds and encodes each variant like its default, under the SAME single gain —
  the gain is measured from the stack of the six DEFAULT stems only, so adding
  variants never changes the loudness balance (it warns if a variant would clip
  under that gain);
- writes `<slot>-<variant>.mp3` into the song folder, removes variant files a
  re-import no longer declares, and records `variants`, `phraseBars` and
  `contextPriority` in `score/index.json`.

Debug ▸ Perf & Diagnostics ▸ Adaptive Music: `Music context` and `Variants`
read out the live tags and the variant in each slot; `Music context force` pins
a tag (an `enemy:` tag also pins that family) to audition a variant.

## Contracts the engine relies on

- Every layer of a song is the same length, starts at bar 1, same tempo.
- Layer gain 1 = the mix you exported; the engine only fades whole layers.
- `riser` ends on a downbeat (it is played so its END lands on the groove's
  entry bar line); `victory` starts with its hit. Both are optional.
- Song ids: lowercase letters, digits, dashes.
- A variant has the same length, tempo and bar 1 as its slot's default, and the
  same relationship to the mix (gain 1 = the mix you exported).

## Debug

Debug ▸ Perf & Diagnostics ▸ Adaptive Music: `Music song` pins any song in the
index (shows "current → pending"), `Music force` auditions layers.
