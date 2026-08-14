# MiniMax-Music3 for Omni's adaptive score — feasibility

Assessment of <https://huggingface.co/MiniMaxAI/MiniMax-Music3> as the
generator for the **active layered background music** described in
`docs/AUDIO_PLAN.md` §3 (music director) and §5 (music beds).

**Nothing here is implemented.**  The game still has ZERO audio — no
`AudioContext`, no audio assets, no `AudioSystem`, no trigger hooks
(verified 2026-08-14: `grep -rniE "AudioContext|new Audio\(|howler"` over
`*.ts`/`*.tsx` returns nothing, and `public/assets/` is 3.7 MB of PNGs).

---

## 1. Verdict

**Feasible as an OFFLINE ASSET GENERATOR.  Not feasible as the layering
mechanism itself, and not usable at runtime at all.**

Split the question in two, because they have opposite answers:

| Question | Answer |
|---|---|
| Can Music3 generate music good enough to be Omni's score? | **Yes.** Full-song coherence, 32 kHz stereo, prompt-controlled genre/instrumentation/energy. It is over-qualified for a top-down arena game. |
| Can Music3 *run in the browser*, per-session or per-frame, reacting to the game? | **No, and not close.** 11.1B params, two CUDA GPUs, non-streaming. There is no web/WASM/ONNX path and there will not be one. |
| Can Music3 emit the *layered stems* the music director needs? | **No.** It emits one finished stereo mixdown per call. No stems, no loop points, no tempo/key guarantee, no "same take minus the drums". |
| Can the stems be obtained anyway? | **Yes — with a second model.** Generate the full take with Music3, then split it with a source separator (Demucs). That is the whole bridge, and it is the crux of this document. |

So: Music3 is a **content pipeline** decision, not an architecture
decision.  It produces `.wav` files at authoring time exactly like the
nebula PNGs; the engine ships the results and never knows a model existed.
The adaptive behaviour is 100% the job of the `AudioSystem` /music director
in `AUDIO_PLAN.md` §3, which has to be built either way.

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

- **Stable Audio (3.x, open-weight family)** advertises *track extraction*
  (generative stem separation), *layering* (adding instruments to existing
  audio), *repainting* of time windows, and explicit game-audio use cases —
  i.e. the §3 requirements as first-class operations rather than as a
  post-process.  Caveat: **self-hosting for commercial use requires a
  separate agreement with Stability AI**, so its licensing question is at
  least as live as MiniMax's.
- **ACE-Step (3.5B, Apache-2.0)** is the licence-clean option — 8 GB VRAM,
  fast iteration, LoRA-fine-tunable so a house style is reachable.  Lower
  ceiling than Music3 on full-song coherence, which matters much less for a
  90-second loop than for a five-minute song.
- **Demucs (MIT)** is needed in all three worlds and has no licence
  question.

If the licence in §2b comes back non-commercial, ACE-Step + Demucs is the
fallback that requires no other change to the pipeline in §4.

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
