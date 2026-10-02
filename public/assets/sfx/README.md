# Legacy recovery sound assets

The primary soundtrack now lives in `../audio/`: 304 sample-based takes, a
ten-minute ambient bed and a three-track battle playlist. See
`../audio/AUDIO_CREDITS.md` and `docs/CINEMATIC_AUDIO.md`. These WAVs and
synthesis are recovery sources only. The remaining notes describe the earlier
pass.

66 mono, 44.1 kHz, 16-bit PCM WAV takes cover 22 event IDs. Files use the
registered ID with dots replaced by dashes and a variant suffix. Longest-ID
matching prevents a generic ID from claiming a more specific sound's files.

These WAVs are the SECOND tier, the first fallback under the banks. A WAV is
fetched only for an ID that no decoded bank covers, which today is none of
them. Below the WAVs, the `SfxRegistry.ts` + `SfxVoicing.ts` recipes remain
the last resort, as three cached renders per one-shot or live synthesis.
Files named after a loop ID are refused: loops take their recorded texture
from the banks alone. The standalone inliner bakes these files in as
`window.__omniSfxInline`, so the same decoder and mixer serve the web build
and standalone. No remote audio services are required.

## September 2026 mastering pass

- Six `impact-hull-enemy-*` and `impact-tile-glass-*` takes were replaced with
  seeded original renders of the repository recipes, with low-Q filtering,
  layered detail, edge fades and -6 dBFS peaks.
- Six `weapon-cannon-fire-*` and `enemy-shot-boss-*` takes retain their existing
  onset/body but have 280 ms tails with a 30 ms release fade.
- The remaining 54 WAVs are unchanged.

No third-party sounds were added. New synthesis is authored in repository
source. Existing assets retain their existing provenance/licensing; this pass
makes no new licensing claim about those inherited files. The pass's audit
notes are in git history; `docs/CINEMATIC_AUDIO.md` describes the current mix,
lifecycle and validation.

## Reproduce and validate

Build and serve a preview on `127.0.0.1:4173`, run the repair, then stop the
preview before testing: the suite rebuilds and serves its own preview on that
same port, so it tests the repaired files.

```sh
node scripts/master-audio.mjs
# stop the preview, then:
npm run test:audio
```

`tests/audio.spec.ts` checks that every file here matches a registered ID. It
does not measure the WAVs themselves: they are fetched only when a bank fails,
and the asset smoke that did measure them was retired with `scripts/smoke/`.

`master-audio.mjs` regenerates only the six named impact files and shortens
only the six named heavy tails. Do not run the generic 250 ms prep tool over
musical stingers or other deliberately long sounds.
