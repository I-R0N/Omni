# Recorded SFX takes

Drop `.wav` files here. A file at `public/assets/sfx/foo.wav` is fetched by
the game from `/assets/sfx/foo.wav` — `public/` is served at the site root,
the same convention `assets.ts` uses for sprites.

## Wiring a file to a sound — the filename IS the wiring

Discovery is automatic. `vite.config.ts`'s `sfxManifestPlugin` scans this
folder at build time and `AudioSystem.discoverSamples` matches each file to
an id by name: **the id with dots as dashes, plus any suffix.**

| File | Id it lands on |
|---|---|
| `crash-player-shard.wav` | `crash.player.shard` |
| `crash-player-shard-a.wav` | `crash.player.shard` |
| `crash-player-shard-rice-02.wav` | `crash.player.shard` |

Matching is **longest-prefix** against the ids the registry declares, so
`destroy.enemy` cannot swallow `destroy.enemy.heavy`'s files — both are real
ids and the longer one wins its own takes. Adding sound is adding **files**;
`SfxRegistry.ts` is edited only to add a new id or to pin an exceptional
filename via `SfxDef.sample`, which overrides discovery for that id.

Several filenames for one id are **variants**, cycled round-robin per
trigger. Keep the `render` draft: a missing, undecodable or silent file
falls back to it, so the game degrades to a different sound rather than to
silence.

A file matching no id is **unmatched** and reported in the pause menu — it
is not an error, it just never plays. Check there after a drop.

## Replacing an existing take

There is no "replace" in the code — this folder is purely additive, and a
new filename is a new **variant** of its id, not a substitute for the old
one. Which means:

- **Same filename → a real replacement.** Committing `weapon-blaster-fire-a.wav`
  over the existing one swaps the take and the id still has three variants.
  The name must match **exactly, including case**: git is case-sensitive, so
  `Weapon-Blaster-Fire-A.wav` is a *second* file, and both would then play.
- **Different filename → a fourth take.** `weapon-blaster-fire-d.wav`
  alongside `-a/-b/-c` means the id now cycles four recordings. That is the
  right move for adding variation, and the wrong one for retiring a take.
- **Retiring a take is a delete.** Nothing prunes a superseded file; the old
  wav keeps playing one trigger in N until it is removed from the folder.

Note the suffix is free-form, so `-a` / `-b` / `-c` is convention, not
syntax — any suffix works, and any suffix that differs is an addition.

## Format

| | |
|---|---|
| Container | `.wav`, PCM |
| Sample rate | 22 050 Hz is plenty for short material hits; 44 100 if you have it |
| Channels | **mono** — the engine pans positionally, and a stereo file fights that |
| Level | normalise to about −6 dBFS and leave the mixing to the `gain` field |
| Trim | cut silence off the head; a leading gap reads as latency on impact sounds |

## Pitch is applied by the engine, so record neutral

`crash.player.shard` is pitched by shard SIZE and gained by impact speed at
the call site (`PhysicsSystem.sfx` passes `{gain, pitch}`). Pitch rides
`playbackRate`, so one take spans pebble-tap to boulder-slam. Record the
middle of the range and let the engine spread it — do not bake a sweep in.

## Two rules that come from playtest, not taste

**Stay below ~2 kHz, and keep resonance low.** CLAUDE.md §8 has the full
note. Bulk-fired sounds are judged by what a hundred of them sound like,
and a ringing high-Q peak is what reads as whining. `scripts/smoke/tone.mjs`
asserts this for the synth drafts.

**Vary the takes.** Three slightly different recordings beat one perfect
one for anything that fires in bulk.

## Prepare a file after exporting

```bash
node scripts/prep-sfx.mjs --dry-run public/assets/sfx/*.wav   # report only
node scripts/prep-sfx.mjs public/assets/sfx/*.wav             # rewrite in place
```

Pure Node, no dependencies and no audio application: it trims leading
silence, trims the inaudible tail, caps length (`--max-ms`, default 250),
normalises (`--peak`, default -6 dBFS), downmixes to mono and writes back
16-bit PCM. Originals are recoverable from git.

The length cap is not cosmetic. A voice holds its polyphony slot for the
whole length of its buffer, and contact sounds cap at `poly: 3`, so a
two-second take means that after three hits the id is saturated for two
seconds and every further hit is **dropped** — a dense rubble field gets
quieter the busier it gets.

## Check a file before trusting it

```bash
npm run build
npx vite preview --port 4173 --host 127.0.0.1 &
node scripts/smoke/assets.mjs
```

It decodes every wav in this folder with the browser's own decoder and
reports level, how much of the file is digital silence, content length,
channel count and dominant frequency — then fails on anything the engine
cannot use. Run it after every export; a bad export is not audible as
"quiet", it is audible as nothing at all.

A file that decodes but carries no signal is **rejected at load**
(`AUDIO_CONSTANTS.SAMPLE_MIN_PEAK`) and its id falls back to the synth
draft, so a broken export cannot silence a working sound.

## Audit a drop

```bash
node scripts/sfx-audit.mjs                 # vs the base branch
node scripts/sfx-audit.mjs --base HEAD~1   # vs any ref
```

Three sections, in descending order of how certain the answer is:

1. **What the commit did** — `M` is a real replacement (an identical
   filename), `A` is a new variant, `D` is a retirement. Fact, not
   inference: the folder is additive, so git is what knows which names
   matched.
2. **Where each file lands** — the id every file resolves to under the same
   longest-prefix rule the engine uses, plus the files matching no id
   (silent) or a loop id (refused).
3. **Duplicates** — byte-identical files (certain), and near-identical
   audio among one id's takes. The similarity pass compares peak-normalised
   energy ENVELOPES, so it survives the level and trim changes
   `prep-sfx.mjs` applies: two exports of one take differ in gain and head
   silence and should still read as the same recording. It is a flag, not a
   verdict — two deliberate takes of one source score high too.

Pure Node, no dependencies. It does not decode with the browser, so run
`scripts/smoke/assets.mjs` as well before trusting a batch.

## Sustained sounds cannot use .wav yet

Seven ids are **loops**, not one-shots — they run continuously and respond to
a live parameter:

| Loop | What drives it |
|---|---|
| `move.thrust` | throttle → gain *and* filter cutoff |
| `weapon.charge.loop` | charge progress → pitch |
| `portal.idle` | distance only |
| `poi.station.idle` | distance only |
| `snitch.near` | distance only |
| `status.disable.loop` | on/off |
| `bubble.drain` | on/off |

The sample path builds a one-shot buffer, so these stay procedural. A file
named after a loop id is **refused and reported** in the pause menu rather
than accepted — accepting it would mark the id as covered while the synth
kept playing, which looks exactly like a working recording.

## These files ARE baked into the standalone build

`scripts/inline-build.mjs` bakes every wav the bundle references into
`omniverse-standalone.html` as a filename → data-URI table
(`window.__omniSfxInline`), which the loader checks before fetching. A
single HTML file cannot fetch anything, so without this the recordings were
unreachable there and WAV-only mode was silence rather than an A/B.

Everything after the byte source is shared, so a baked take takes the same
decode, silent-file rejection and round-robin as a served one.

The consequence for this folder: **the standalone grows as this folder
does.** Only files the manifest references are baked, so a stray unmatched
wav costs nothing — but every take that lands on a real id is carried in
full, base64'd.
