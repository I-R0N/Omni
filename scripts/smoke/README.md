# Audio smoke suites (Phase 3 Pair B)

Headless assertions for the SFX system and explosion variety, written
during the Pair B session. **165 assertions across six suites.**

They are plain Node scripts driving Playwright against a built preview of
the real game — there is no test runner in this project yet. Roadmap item
5b (test-harness bootstrap, running in a parallel session) may absorb or
relocate them; they live here so the verification work is not lost in the
meantime.

## Running them

```bash
npm install
npm run build
npx vite preview --port 4173 --host 127.0.0.1 &   # serve the built game
node scripts/smoke/b2.mjs                          # …and so on
```

Environment variables:

| Var | Default | Purpose |
|---|---|---|
| `SMOKE_URL` | `http://127.0.0.1:4173/` | Where the built game is served. |
| `CHROME_PATH` | Playwright's own download | Point at a system Chromium if Playwright's is unavailable. |

Playwright must be installed and resolvable (`npm i -D playwright`, or
globally with `NODE_PATH` set). Each script exits non-zero on failure and
prints one line per assertion.

## What each suite covers

| Suite | Assertions | Covers |
|---|---|---|
| `b2.mjs` | 28 | AudioSystem manager: no `AudioContext` before a user gesture, gesture unlock, per-id polyphony caps, retrigger collapse under a 200-trigger burst, the global voice ceiling, mute, torus-wrapped distance/pan including the seam case, loop idempotency, and that the manager schedules nothing on its own. |
| `b3.mjs` | 49 | The wired inventory: registry↔`docs/SFX_INVENTORY.md` parity **in both directions**, every weapon firing its own voice through the real click path, roamer/boss/status cues, the engine idle loop, station commerce while the sim is frozen, portal transit, player↔shard contact vs wall crash, the shard near-field rule, and the POI presence loops. |
| `b4.mjs` | 28 | Explosion variety: each entity class compared *against the others* on debris count/speed/size/lifetime/hue and ring shape, the particle budget, `MAX_PARTICLES` under 60 simultaneous deaths, and audio+visual firing together. |
| `b5.mjs` | 27 | Validation: a muted-vs-unmuted frame-time A/B on an identical heavy scene, a `play()` microbenchmark, a 390 px phone-scale check of the settings row, and a full gameplay loop with audio asserted throughout. |
| `ios.mjs` | 12 | iOS recovery: both audio-session paths (modern `navigator.audioSession` and the forced pre-16.4 fallback), that the silent-WAV shim decodes, and that a *later* gesture recovers a suspended context. |
| `tone.mjs` | 21 | Tonal regression guard: renders every material voice and every loop through an `OfflineAudioContext` and asserts nothing bulk-fired sits in the fatiguing band, that the material brightness ordering survives, and that the portal and station beds are distinguishable by character. |

## Two things worth knowing before trusting a result

**The perf A/B in `b5.mjs` is the only load-sensitive assertion.** On a
busy machine its frame-time comparison can exceed its 15% threshold as
noise. The load-insensitive evidence is the `play()` microbenchmark in the
same suite (~0.1–0.3 µs/call); if that holds, audio is not a per-frame
cost regardless of what the frame-time delta says. Re-run before treating
a single failure as real.

**`tone.mjs` measures a proxy, not a spectrum.** Zero-crossing rate over
the rendered buffer over-reads on noisy sources. It is monotonic in
brightness, which is what the assertions need — do not read the absolute
numbers as true dominant frequencies.
