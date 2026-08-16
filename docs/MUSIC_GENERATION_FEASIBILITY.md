# Generative audio for Omni — feasibility

Can generative models author Omni's audio assets offline?  Two questions
with two different answers and two different models:

- **§1–§8 — music beds.**  <https://huggingface.co/MiniMaxAI/MiniMax-Music3>
  as the generator for the layered background music in `docs/AUDIO_PLAN.md`
  §3 (music director) and §5 (music beds).  **Yes, via
  generate-then-separate.**
- **§9 — sound effects.**  The same model for the ~90 cues in
  `AUDIO_PLAN.md` §4.  **No — wrong tool.  Use Stable Audio 3 Small-SFX**,
  which is 25× smaller, runs on a CPU, and has a clearer licence.

Throughout, the question is asset authoring, not runtime: models run on a
box while the audio is being made, the game ships the `.opus` files they
produced, and nothing model-shaped is ever in the bundle.

**Nothing here is implemented.**  The game still has ZERO audio — no
`AudioContext`, no audio assets, no `AudioSystem`, no trigger hooks
(verified 2026-08-14: `grep -rniE "AudioContext|new Audio\(|howler"` over
`*.ts`/`*.tsx` returns nothing, and `public/assets/` is 3.7 MB of PNGs).

---

## 1. Verdict

**Yes — with one structural caveat that shapes the whole pipeline: Music3
cannot hand you the layers.**

| Question | Answer |
|---|---|
| Can Music3 generate music good enough to be Omni's score? | **Yes.** Full-song coherence up to 5 min, 32 kHz stereo, prompt control over genre / BPM / key / instrumentation / arrangement. It is over-qualified for a top-down arena game. |
| Can it emit the *layered stems* the music director needs? | **No.** One finished stereo mixdown per call. No stems, no loop points, no tempo/key guarantee, no "same take minus the drums". |
| Can the layers be obtained anyway? | **Yes — with a second model.** Generate the take with Music3, then split it with a source separator (Demucs, MIT). That is the whole bridge and the crux of this document. |
| Does anything model-shaped ship? | **No.** It produces `.wav` files at authoring time exactly like the nebula PNGs. (For completeness: running Music3 *live* is not an option either — 11.1B params, two CUDA GPUs, non-streaming, no web path. It was never the plan and is not a loss.) |

The caveat matters more than it first sounds, because **"layered" is exactly
the axis Music3 is weakest on**.  Re-prompting is not a substitute for
stems: a second generation captioned "same track, no drums" is a different
performance in a different room, not the first one with the drums muted, so
the two cannot be crossfaded or summed.  Layers have to come from *one*
take, split after the fact.

So Music3 is a **content pipeline** decision, not an architecture decision.
The adaptive behaviour is 100% the job of the `AudioSystem` / music director
in `AUDIO_PLAN.md` §3, which has to be built either way — and it is
indifferent to which generator produced the stems.

---

## 2. What the model actually is

From the [model card / GitHub README](https://github.com/MiniMax-AI/MiniMax-Music3)
(read 2026-08-14):

- **~11.1B params**, hierarchical: 8B Global LLM (Qwen3-8B init, predicts
  RVQ codebook 0 frame-by-frame) → 0.6B Local LLM (remaining 7 acoustic
  codebooks) → 2.4B Flow Matching → 123M Flow-VAE decoder.
- **Output: 32 kHz, 16-bit stereo WAV.**  One file.  A mixdown.
- **Inputs: lyrics + a music description.**  Lyrics take section tags
  (`[Intro]`, `[Verse]`, `[Chorus]`, `[Instrumental]`, `[Solo]`, `[Outro]`);
  the description covers genre, BPM, key, emotional progression,
  instrumentation, arrangement, production profile.  A bundled
  `music-caption-rewriter` agent skill expands a short prompt into the
  Structured Caption format the model was trained on.
- **Max length: 9 000 acoustic frames ≈ 5 minutes** (so ~30 frames/sec).
- **Serving: SGLang-Omni**, `sgl-omni serve --model-path
  MiniMaxAI/MiniMax-Music3`, exposed on the shared speech endpoint
  (`POST /v1/audio/speech`, lyrics in `input`, caption in `instructions`,
  plus `seed` and `max_new_tokens`).
- **Stated limitations**: two CUDA GPUs required (GPU 0 = Qwen3 + RVQ AR
  decode, GPU 1 = Flow Matching + waveform decode); **non-streaming only**;
  prompt ≤ 5 000 tokens; and — the important one for us — "section tags and
  music descriptions provide generative control rather than **strict
  symbolic guarantees**.  The generated tempo, key, instrumentation, lyrics,
  and song structure may not always match every requested detail exactly."

Not mentioned anywhere, i.e. **absent**: stems / multitrack output, audio
conditioning, continuation or inpainting of an existing clip, loop-point
awareness, an instrumental flag, and any published real-time factor.

### 2a. The `is_instrumental` trap

MiniMax's **hosted** Music 3.0 API documents an `is_instrumental` parameter.
The **open-weights** serving path does not expose one — the SGLang-Omni
request body is `input` / `instructions` / `seed` / `max_new_tokens` /
`response_format`.  Self-hosted, "no vocals" is a *prompt*, not a flag:
empty lyrics plus `[Instrumental]`-tagged structure plus a caption that says
so.  For a **background** score that is the single highest-impact risk —
a stray sung phrase over gameplay is not a blemish, it is an unusable take
— so every generated bed needs a listen-through, or an automated check (run
the separator, measure energy in the vocal stem, reject above a threshold).
That check is nearly free once the Demucs step in §4 exists.

### 2b. Licensing — UNRESOLVED, and it gates everything

The weights ship under a **"MiniMax-Music3 Community License"** (the repo's
own `LICENSE`).  This session could not read it: `huggingface.co`,
`minimax.io`, `modelscope.cn` and `hf-mirror.com` are all blocked by the
egress proxy, and the GitHub mirror has no `LICENSE` file — only a README
badge pointing back at the HF copy.  Third-party summaries disagree with
each other (one reads the badge's Creative Commons *icon* as "CC BY-NC";
sibling MiniMax community licences instead permit commercial use with a
prominent "Built with MiniMax" attribution and a scale threshold).

**Read the actual `LICENSE` before generating a single asset**, and check
three things specifically:

1. Commercial use of the **model** (Omni is a public deploy; if it ever
   takes money, "non-commercial" would be fatal — and retro-fitting a score
   is expensive).
2. Ownership / permitted use of the **outputs**.  Some community licences
   grant output rights broadly, some restrict redistribution.  Shipped game
   music is redistribution.
3. Whether **attribution** is required, and where (a "Built with MiniMax"
   line in the credits / README is cheap; discovering it after release is
   not).

Until that is read, treat everything below as conditional.

---

## 3. What Omni's music design actually needs

`AUDIO_PLAN.md` §3 asks for **vertical layering** (stems mixed in and out
under a live intensity signal) plus **horizontal re-sequencing** (transition
at musical boundaries, not instantly), driven by state the engine already
publishes: `gameState`, `MAP_DESCRIPTORS.kind` / `wavesEnabled`,
`waveStatus` / `waveGraceTimer`, live enemy count, `EngineStats.boss`
(`phase`, `healthFrac`), `stageClearPending`, `deathPending`,
`dockedAtStation`.  §5 lists 8 beds, of which the arena-combat bed wants
"2–3 intensity stems" and the boss bed wants "a per-phase stem so a phase
change is audible".

Concretely, that requires each bed to be:

1. **Stem-separable** — 2–4 layers that are the *same take*, so they can be
   summed in any combination without phasing or key clash.
2. **Seamlessly loopable** — a wave can last 40 s or 4 minutes; a bed that
   fades out and restarts is worse than no music.
3. **Tempo- and bar-known** — "transition at musical boundaries" is
   unimplementable without a BPM and a downbeat offset per bed.
4. **Consistent across a family** — arena-exploration and arena-combat for
   the same region should be the same key and tempo so the crossfade
   between them is musical rather than a smear.

Music3 delivers **none of the four natively.**  Every one of them is
recoverable in post, which is the good news; that recovery is the pipeline
below and it is the real cost of this approach.

---

## 4. The pipeline that works

Offline, in an authoring repo/branch — never at runtime, never shipped:

```
  Structured Caption (music-caption-rewriter skill)
        │   one caption per bed family, same BPM + key across the family
        ▼
  MiniMax-Music3 (SGLang-Omni, 2 GPUs)     ──►  bed_arena_combat.wav (32 kHz stereo, ≤5 min)
        │   N seeds per caption, pick the best take by ear
        ▼
  Demucs / htdemucs (MIT)                  ──►  drums.wav bass.wav other.wav vocals.wav
        │   vocals stem doubles as the §2a "did it sing?" check — should be silent
        ▼
  Beat / downbeat analysis (librosa, aubio) ──► bpm, downbeat offset, bar grid
        │
        ▼
  Loop-point cut on a bar boundary + short equal-power crossfade
        │   (or a DAW pass; this is where a human ear earns its keep)
        ▼
  Layer assembly: base = bass+other, +drums = intensity 2, +lead = intensity 3
        │
        ▼
  Encode to Opus/WebM @ 96–128 kbps stereo  ──► public/assets/audio/music/
        │
        ▼
  A per-bed JSON sidecar: { bpm, barSec, loopStart, loopEnd, layers[] }
        └─► the music director reads this; it is the "musical boundaries" input
```

Notes on the non-obvious steps:

- **Demucs is the load-bearing part.**  Splitting *after* generation is what
  makes the layers a genuine single take — same tempo, same key, same room,
  phase-coherent — which is exactly the property §3.1 needs and exactly the
  property re-prompting Music3 cannot give you (a second generation with
  "minus drums" in the caption is a different performance, not the same one
  with drums muted).  Summing all separated stems reconstructs the original
  mix, so *additive* layering is far more forgiving of separation artifacts
  than soloing a stem is — and additive layering is precisely how vertical
  music systems work.  Expect artifacts to be audible on a soloed `other`
  stem and inaudible under gameplay with drums on top.
- **32 kHz is a non-issue.**  Opus resamples to 48 kHz internally, and a
  background bed under gunfire does not miss the 16–20 kHz band.  Do not
  spend effort upsampling.
- **Deterministic seeds help, but only within one caption.**  `seed` makes a
  take reproducible; it does not make two captions produce compatible music.
  Family consistency (§3.4) comes from writing one caption and varying it
  minimally, then keeping the *stems*, not from re-rolling.
- **Budget the takes.**  Realistically 5–10 generations per shipped bed
  after rejects (wrong energy, vocal bleed, structure that will not loop).
  Eight beds → 40–80 generations → an afternoon or two of iteration, not a
  project.

---

### 4a. Worked example — the arena bed family

The arena is the right first target because it is the only family that
exercises every hard part at once: instrumental-only, seamless loop, and
multiple intensity layers.  One generation feeds **both** of §5's beds (4,
arena exploration, and 5, arena combat) — that is the trick.

**1. One caption, pinned to a tempo and key.**  Both are requests, not
guarantees (§2), but pinning them makes the family internally consistent
and gives the post-analysis a value to check against:

```bash
curl http://127.0.0.1:8000/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "minimax_ttm",
    "input": "[Instrumental]",
    "instructions": "Fully instrumental, no vocals, no vocal samples, no choir, no spoken word. Dark synth-driven space combat score, 124 BPM, D minor, 4/4. Global: driving but loopable, no fade-out, consistent energy across the whole piece, no long silences. Arrangement: sustained analog pad and low drone bed throughout; muted arpeggiated synth ostinato; distorted sub bass on the downbeats; tight electronic kick, snare and hats; occasional metallic percussive hits. Production: wide stereo pads, dry centred drums, modern loud master.",
    "response_format": "wav",
    "seed": 7,
    "max_new_tokens": 9000
  }' --output arena_take07.wav
```

Roll 5–10 seeds, keep the best take by ear.  Reject anything that fades
out, drops to silence, or sings.

**2. Split it.**  `htdemucs_6s` gives six stems instead of four, which maps
better onto intensity layers:

```bash
demucs -n htdemucs_6s arena_take07.wav
# → drums / bass / other / vocals / guitar / piano
```

The `vocals` stem is the §2a safety check: it should be near-silent.
Measure its RMS and reject the take automatically if it is not.

**3. Assign the stems to intensity layers.**  Additive, so every layer sums
back toward the original mix:

| Layer | Stems | Driven by |
|---|---|---|
| L1 — base | `other` + `bass` | always on inside an arena |
| L2 — pulse | `+ drums` | wave active (vs `waveGraceTimer` breather) |
| L3 — threat | `+ guitar` + `piano` | live enemy count over a threshold |

§5's "arena exploration" bed is then **L1 alone**, and "arena combat" is
L1+L2+L3.  They are the same recording, so moving between them is a gain
ramp, not a crossfade.

**4. Find the loop on a real bar line.**  Detect the *actual* BPM rather
than trusting the caption's 124 — Music3 gives "generative control rather
than strict symbolic guarantees", and a bar grid built on the requested
tempo instead of the delivered one will drift audibly by the end of a
minute:

```python
import librosa
y, sr = librosa.load('arena_take07.wav', sr=None, mono=True)
tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units='time')
# bar = 4 beats in 4/4; pick a 32-bar window from a downbeat, well
# inside the take so the intro and outro are excluded
```

At a delivered 124 BPM a bar is 1.935 s and a 32-bar loop is 61.9 s.  Cut
**every stem at the identical sample offsets** — they must stay aligned —
and apply a short equal-power crossfade at the seam.

**5. Encode and describe.**  Opus 112 kbps stereo per layer, plus a sidecar
that is the entire interface between the asset pipeline and the engine:

```json
{
  "id": "arena",
  "bpm": 124.0,
  "barSec": 1.9355,
  "loopSec": 61.935,
  "layers": [
    { "id": "base",   "src": "music/arena.base.opus" },
    { "id": "pulse",  "src": "music/arena.pulse.opus" },
    { "id": "threat", "src": "music/arena.threat.opus" }
  ]
}
```

**The consequence worth noticing**: because every layer in a family is one
take cut at identical offsets, the layers are *sample-aligned* — the music
director starts all three together and only animates gain.  §3's harder
requirement, "transition at musical boundaries", therefore only applies
*between* families (hub ↔ arena ↔ boss ↔ station), which is a handful of
transitions on a `barSec` grid rather than a continuous problem.  Within a
family, horizontal re-sequencing collapses into vertical layering for free.
That is the strongest argument for the generate-then-separate pipeline over
prompting each layer independently.

---

## 5. Infrastructure and cost

Self-hosting is the only way to use *these weights*:

- **2 CUDA GPUs**, per the README's own limitation list — the pipeline is
  hard-split across them.  11.1B params in bf16 is ~22 GB of weights before
  KV cache and the flow model's activations; a 2 × 24 GB box (2 × 4090 /
  L4-class) is the realistic floor and 2 × A100-40 GB is comfortable.  A
  single 80 GB card does **not** obviously satisfy a serving path that
  explicitly assigns work to `GPU 0` and `GPU 1`.
- **Rented, this is ~$2–6/hour** on the usual clouds.  Eighty generations
  plus setup is a handful of hours — **call it $20–60 of compute for the
  entire soundtrack**, one time.  Cost is not the obstacle here; the
  obstacle is §2b and the post-processing.
- **No per-user runtime cost, ever**, because nothing model-shaped ships.

The alternative — **MiniMax's hosted Music 3.0 API** — skips the GPUs
entirely and exposes the real `is_instrumental` flag, at per-generation
pricing and under the platform's commercial terms rather than the weights'
licence.  If the goal is *assets*, the hosted API is the lower-friction path
and the open weights buy nothing except independence from the vendor.  The
open weights are worth the trouble only if (a) the licence is friendlier
than the platform terms, or (b) offline/reproducible generation matters.

---

## 6. Where it collides with this repo

- **`AUDIO_PLAN.md` §2a, the standalone-build fork — this makes it sharper.**
  `scripts/inline-build.mjs` inlines assets matched by
  `/assets/([\w.-]+\.(png|jpg|jpeg|webp|svg|gif))` — **audio extensions are
  not in that regex**, so as the script stands today the standalone build
  would ship *silent with broken URLs* rather than fat.  That is arguably
  the right default (option 1/2 in §2a), but it should be a decision, not an
  accident.  Eight beds × ~2 min stereo Opus @ 112 kbps ≈ 1.7 MB each →
  ~14 MB; at 3 layers per combat bed, closer to 25–30 MB.  Against a 5.7 MB
  standalone file, inlining that is not an option.
- **Layer count is a mobile-memory decision, not a taste one.**  Each active
  layer is a decoded/streamed buffer plus a gain node.  3 layers × 2 min
  stereo PCM decoded is ~60 MB of RAM; on mobile Safari the beds must stream
  (`AUDIO_PLAN.md` §2d) or the layers must be short.
- **Layer gain automation must ride the AudioContext clock**, not the sim —
  same rule as §2e.  A `gain.linearRampToValueAtTime` on the audio clock is
  correct; a per-sim-step `gain.value =` write is a zipper-noise generator.
- **The music director's inputs already exist** — `EngineStats` carries
  boss phase / health, wave status, docked state, `deathPending`,
  `stageClearPending`.  Music is the one audio consumer for which
  `EngineStats` *is* the right channel (§3 rules it out for SFX because of
  sub-frame timing; a bed crossfade over 2 bars does not care about 8 ms).
- **Regional beds are cheap here and expensive later.**  §3's table ends at
  "region identity", and Music3 makes a per-region bed a caption edit.  If
  the parked area-composition design lands, generating a glass-region and a
  metal-belt variant of the same family is one more afternoon — provided the
  music director takes the bed from the *area node* rather than the MapType,
  as §3 already advises.

---

## 7. Alternatives worth pricing before committing

Not a recommendation to switch — a note that Music3's weakness here
(mixdown-only) is precisely what some newer models target:

- **Stable Audio 3 Medium** (1.4B, open weights, 380 s max, ~6.5 GB VRAM,
  a 120 s render in 0.78 s on an H200) does music *and* SFX from one stack,
  supports audio-to-audio editing and inpainting/continuation, and is
  LoRA-fine-tunable.  Its licence position is also *known* rather than
  unread — see §9, which specs the family properly because it is the
  recommendation for sound effects.  **If §2b comes back non-commercial,
  this is the replacement for Music3 as well**, and then the whole
  soundtrack — beds and cues — comes off one model on one box.  Music3
  probably keeps a quality edge on long-form musical coherence; that edge
  is worth less on a 60-second loop than on a five-minute song.
- **ACE-Step (3.5B, Apache-2.0)** is the licence-clean option — 8 GB VRAM,
  fast iteration, LoRA-fine-tunable so a house style is reachable.  Lower
  ceiling than Music3 on full-song coherence, which matters much less for a
  90-second loop than for a five-minute song.
- **Demucs (MIT)** is needed in all three worlds and has no licence
  question.

- **ACE-Step (3.5B, Apache-2.0)** is the licence-*cleanest* option — 8 GB
  VRAM, fast iteration, LoRA-fine-tunable.  Lower ceiling than Music3 on
  full-song coherence; same caveat as above about how little that matters
  for a loop.

Either fallback drops into §4's pipeline unchanged — the generator is one
box in that diagram and the sidecar is the interface.

---

## 8. Recommendation

1. **Read the `LICENSE`** (§2b).  Everything is conditional on it and it
   costs five minutes.
2. **Do not scope this as "use Music3".**  Scope it as "build the music
   director"; the generator is a swappable asset source and the sidecar
   format in §4 is the actual interface.  That is also what keeps §7's
   fallbacks free.
3. **Spike one bed end-to-end before generating eight.**  Arena-combat is
   the right choice — it is the only bed that exercises every hard part:
   instrumental-only, loopable, and 3 intensity layers.  Take it all the way
   to a `.opus` set plus sidecar and play it under an actual wave.  If the
   Demucs layers hold up under gunfire, the other seven beds are
   bookkeeping; if they do not, that is the moment to spend §7's money,
   having burnt one afternoon instead of a soundtrack.
4. **Keep music strictly behind the SFX work.**  The score is the bigger
   emotional win, but SFX is what the game is missing at the moment-to-
   moment level, and both need the same bus structure, iOS unlock and
   volume-settings home from `AUDIO_PLAN.md` §3/§6.

---

## 9. Sound effects — a different model

**Music3 is the wrong tool for the ~90 cues in `AUDIO_PLAN.md` §4, on five
independent axes.**  Not "worse": wrong.

1. **It is a song model.**  Its conditioning is lyrics plus a *music*
   caption and its prior is musical structure.  Ask it for a glass shatter
   and it will try to write a piece about one.
2. **Length.**  Built for takes up to five minutes at ~30 frames/sec; SFX
   cues are 80 ms – 2 s.  Every cue would mean generating far too much
   audio and trimming a transient out of it.
3. **32 kHz means a 16 kHz ceiling.**  A music bed does not miss the top
   octave.  SFX largely *are* the top octave — glass shatter, metal clang,
   laser zap, gnat pop all carry their identity at 8–16 kHz.  Dull,
   blanketed transients is the exact failure mode, and it is unfixable in
   post.
4. **Throughput.**  ~90 cues × several takes each is hundreds of
   generations on an 11.1B two-GPU non-streaming model.
5. **No audio-conditioned variation.**  The `[var]` round-robins in §4 need
   "the same impact, performed slightly differently".  Music3 has no
   audio input at all, so every variant would be an unrelated roll.

### 9a. The right tool: Stable Audio 3 Small-SFX

From the [Stability-AI/stable-audio-3 README](https://github.com/Stability-AI/stable-audio-3)
(read 2026-08-16) — a purpose-built SFX variant, and the numbers are not
close to Music3's:

| | MiniMax-Music3 | SA3 **Small-SFX** | SA3 Medium |
|---|---|---|---|
| Params | 11.1B | **433M** | 1.4B |
| Hardware | **2 × CUDA GPU** | **CPU — no GPU required** | 1 CUDA GPU (+FlashAttn2) |
| Peak VRAM | ~22 GB+ of weights | 1.7–2.4 GB *if* on GPU | 5.1–6.5 GB |
| Sample rate | 32 kHz | **44.1 kHz stereo** | 44.1 kHz stereo |
| Max length | ~5 min | 120 s | 380 s |
| 5 s render | undisclosed | **0.41 s** (H200) / 0.70 s (Mac CPU) / 0.23 s (CoreML) / 0.017 s (TensorRT) | 0.60 s (H200) |
| Purpose | songs | **sound effects** | music + SFX |

Three properties beyond raw speed decide it:

- **Audio-to-audio editing** is the `[var]` problem solved properly: feed
  cue v1, get v2 — recognisably the same event, differently performed.
  Also **inpainting/continuation** for repairing or extending a take.
- **LoRA fine-tuning**, stackable and runtime-adjustable (trainable on
  Apple Silicon via the bundled MLX path, no PyTorch).  A house sound for
  the material families — glass / plastic / metal / rock / nebula, which
  `SHARD_VARIANTS` already treats as a table — from a handful of
  references.  That is how ~90 disparate cues end up sounding like one
  game rather than one hundred stock downloads, and it is the single
  biggest lever on §1's "AAA" quality target.
- **The licence is knowable.**  Stability AI Community License, models
  trained on fully licensed data, commercial use of outputs permitted
  below a **$1M annual-revenue** threshold (enterprise licence above it).
  Read it to confirm — but "a threshold Omni will not cross" is a very
  different risk posture from §2b's unread file.

CPU-capable also means the SFX loop is *iterative*: tweak a prompt, hear
the result in under a second, on the laptop, with no box to rent.  For 90
cues that workflow difference is worth more than any quality delta.

### 9b. Generate fewer files than you think

`AUDIO_PLAN.md` §4 marks ~30 cues `[var]` (3–5 round-robin variants).
Generating 5 files each is ~150 extra assets against a standalone build
that is already the sore point in §6.

**Do what shipped games do instead: randomise per voice at trigger time.**
Playback rate ±3–6 %, gain ±1.5 dB, and a light filter-cutoff jitter, rolled
when the voice is allocated, kills machine-gun repetition for **zero
bytes** — and it composes with the voice pool, per-cue cooldowns and
same-step coalescing that §2c already requires.  Reserve *generated*
variants for the handful of cues where the **timbre** genuinely must differ
rather than the pitch: shatter, gnat pop, hull hit.  That is ~10 extra
files, not 150.

This is also why the cue inventory precedes the generation — and on
`origin/claude/gauntlet-pair-b-sfx-7oxdrc` **it already does**.
`docs/SFX_INVENTORY.md` and the registry-generated
`docs/SFX_FILE_MANIFEST.md` carry, per cue, an id, a target filename, a
**tier**, a **polyphony cap**, a **length in ms**, a **positional flag**,
and a paragraph of acoustic description.  That is a text-to-audio prompt
list with the hard parameters already attached: **the manifest is the
generator's input file**, not something to be re-derived.

Two pieces of that branch also delete most of what a generator would
otherwise have to build:

- **`scripts/prep-sfx.mjs`** already does the entire conditioning pass —
  head-trim to the first audible sample (keeping 1 ms of run-up),
  envelope-based tail trim, a hard `--max-ms` ceiling with an 8 ms fade so
  the truncation does not click, peak normalise, mono downmix, 16-bit
  out — in dependency-free Node.  A generator should emit a raw take and
  hand it to `prep-sfx --max-ms <the row's ms>`.  It must not re-implement
  any of that.
- **The `-a`/`-b`/`-c` round-robin file convention** means §9b's
  "randomise instead of generating variants" is already solved *in the
  other direction*: the engine cycles however many takes exist per id, so
  extra takes are idiomatic here rather than wasteful.  Scale them off the
  **Tier** column — 3 takes for tier 1, 2 for tier 2, 1 for tier 3 — which
  spends the asset budget where the repetition is actually audible.

The one thing `prep-sfx` is wrong for is **loop cues** (`ms: L`, e.g.
`weapon.charge.loop`): its tail trim and end-fade are exactly what a
seamless loop must not have.  Loops need their own path — generate long,
select a stable window, equal-power crossfade the wrap, skip `prep-sfx` or
teach it a `--loop` mode.

### 9c. Consequence for the model choice overall

Sound effects and music can come off **one stack**: SA3 Small-SFX for cues,
SA3 Medium for beds, both under one licence, one repo, one set of tooling —
versus Music3 for beds (2 GPUs, unread licence) plus SA3 for cues.  Music3
likely wins on musical quality; the consolidation is worth weighing against
that, especially since §4's pipeline is generator-agnostic by construction.

Demucs stays in the picture either way — the stem split in §4 is
independent of who generated the take.
