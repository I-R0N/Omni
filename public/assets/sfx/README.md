# Legacy recovery sound assets

The primary soundtrack now lives in `../audio/`: 304 sample-based takes and
a ten-minute background score. See `../audio/AUDIO_CREDITS.md` and
`docs/CINEMATIC_AUDIO.md`. These WAVs and synthesis are recovery sources only.
The remaining notes describe the earlier pass.

66 mono, 44.1 kHz, 16-bit PCM WAV takes cover 22 event IDs. Files use the
registered ID with dots replaced by dashes and a variant suffix. Longest-ID
matching prevents a generic ID from claiming a more specific sound's files.

Existing WAVs take precedence over production recipes. IDs without files use
three cached renders of `SfxRegistry.ts` + `SfxVoicing.ts`. These are the shipped
procedural sound design, not placeholder files. Sustained sounds remain live
synthesis to follow throttle, charging and proximity. Decoding/compilation is
asynchronous; immediate recipes cover startup or asset failure.

The standalone inliner includes WAV data URIs; the same decoder and mixer
serve the web build and standalone. No remote audio services are required.

## September 2026 mastering pass

- Six `impact-hull-enemy-*` and `impact-tile-glass-*` takes were replaced with
  seeded original renders of the repository recipes, with low-Q filtering,
  layered detail, edge fades and -6 dBFS peaks.
- Six `weapon-cannon-fire-*` and `enemy-shot-boss-*` takes retain their existing
  onset/body but have 280 ms tails with a 30 ms release fade.
- The remaining 54 WAVs are unchanged.

No third-party sounds were added. New synthesis is authored in repository
source. Existing assets retain their existing provenance/licensing; this pass
makes no new licensing claim about those inherited files. See
`docs/AUDIO_POLISH.md` for scope, event coverage and validation limits.

## Reproduce and validate

Build and serve a preview on `127.0.0.1:4173`, then run:

```sh
node scripts/master-audio.mjs
# Rebuild the preview to include repaired files before the checks below.
node scripts/smoke/assets.mjs
node scripts/smoke/tone.mjs
npx playwright test tests/audio.spec.ts
```

`master-audio.mjs` regenerates only the six named impact files and shortens
only the six named heavy tails. Do not run the generic 250 ms prep tool over
musical stingers or other deliberately long sounds.
