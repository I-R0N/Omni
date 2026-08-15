# Gauntlet: the star field — density, resampling, and memory

Working ledger. One milestone per iteration; findings before changes.

Base: `claude/plan-completion`. Branch: `claude/starfield-density-resampling-qpp9dw`.

---

## Checklist

- [x] **S1 — Verify and measure.** Confirm or refute the prior session's four
      claims; capture density / star size / brightness / memory / draw cost.
- [x] **S2 — Density derived from area.** Star count is now
      `area × STAR_DENSITY_CYCLE[i]`; density delta 3.95× → 0.96×. Pinned by
      `tests/starfield.spec.ts` (4 tests).
- [x] **S3 — Kill the resampling.** Bands are device-resolution, stars land on
      whole device pixels, the blit is 1:1 at integer offsets. Audited against
      the live render: 100% unscaled, 100% integer-aligned, at every ratio.
      **Costs memory — S4's subject.**
- [x] **S4 — Memory and draw calls.** The band canvases are gone: the field is
      data, drawn directly. 1264.9 MB → 0.2 MB, 244 blits/frame → 0, and
      6–25× faster in the A/B.
- [x] **S5 — Docs + validation.** Stale comments fixed (three, not two);
      CLAUDE.md §2 + §8 synced; three gates × 2 consecutive runs green.
- [x] **S6 — Spend the savings** (user request). Density default back to 729
      (the star count that was liked); depth layers 60 → 240. Both DBG cycles.
- [x] **S7 — Non-uniform density by map region** (user request). Flow field
      evaluated and rejected with reasons; purpose-built torus-periodic field
      instead. Costs one field sample per frame.
- [x] **S8 — Fix the low-speed jitter S3 introduced** (user report). Per-star
      sub-pixel dither. **Measured well and looked worse — superseded by S9.**
- [x] **S9 — Sub-pixel motion by default; fade the region edge** (user report).
      S8's dither REMOVED. Position error at low speed 0.23 px → 0.000; region
      stars fade instead of popping.
- [x] **S10 — Crisp mode removed; the sky is now SEEDED** (user report). Star
      motion is sub-pixel, full stop. Star generation is deterministic per map,
      so a DBG knob no longer reshuffles the whole sky.

---

## The instrument

`perf/starfield.mjs` (new). Follows the `perf/` conventions — port 4183, TCP
readiness probe, the same mulberry32 seed the capture matrix installs, so two
runs build the same sky and a difference in the pixels is a difference in
rasterization rather than in the seed.

It reports five things, and they are not worth the same:

| measurement | how | worth |
|---|---|---|
| structure — layer count, device-pixel scene, bytes held | read off the live `BackgroundManager` | exact, browser independent |
| density — star count, and lit pixels as a % of device pixels | manager fields + `getImageData` over a scratch render of the field | exact |
| star footprint — scanline run lengths in the composed field | `getImageData` | exact |
| **the real blit path** — is any band blit unscaled and integer-aligned? | wraps `drawImage` on the LIVE context, reads the transform in force and the post-transform destination | exact; the S3 acceptance check (since S4 it reports *no blits at all*) |
| draw calls | wraps `drawImage` on the live render context for 60 frames | exact |
| `--bench` — pre-rendered bands vs direct draw | reconstructs the old structure from live star data, A/Bs it against the real `renderStars` | the S4 decision; ratio directional, overdraw exact |

Plus a clearly-labelled **counterfactual** control that replays the *old*
fractional dpr-scaled blit, so the filter's effect stays visible for
comparison. It measures what the code no longer does, and is captioned that
way — see the S3 correction note.

Frame TIME is deliberately **not** reported. This container rasterizes canvas
in software (`perf/README.md`), so a millisecond figure for a fill-rate-bound
background layer would be the rasterizer's number, not the device's. Draw-call
count and byte count are the device-independent halves of that cost.

Measured against `ASTEROID_FIELD`: a map with no nebula tile clusters supplies
no background-nebula centers, so the backdrop is pure star field and the pixel
counts are stars and nothing else.

### What could NOT be measured here

**The Edge-vs-Safari delta itself.** Playwright's WebKit build cannot be
downloaded in this container — the agent proxy refuses both CDN hosts with
`403 request blocked: no rule or allowlist entry allows host
"cdn.playwright.dev"` (and the same for
`playwright.download.prss.microsoft.com`). So every cross-browser statement
below is either measured under Chromium alone, or is an inference clearly
labelled as one. This is the single largest gap in S1 and it is why claim (2)
below is recorded as *mechanism confirmed, attribution inferred* rather than
as proven.

---

## S1 — findings

Baseline: `perf/out/starfield-before.json`; screenshots in
`perf/out/shots/before/`.

```
viewport       dpr  bands     band px  backing MB   stars  per 10k css px2  bg draws/f
390x844          1  60+mw     390x844        80.3   88640          2692.92         244
390x844          2  60+mw     390x844        80.3   88620          2692.31         244
390x844          3  60+mw     390x844        80.3   88620          2692.31         244
1440x900         1  60+mw    1440x900       316.2   88300           681.33         244
1440x900         2  60+mw    1440x900       316.2   88300           681.33         244
```

### Claim 1 — "star count is fixed; area is not" — **CONFIRMED**

24,000 stars (`NUM_BANDS = 60` × `STARS_PER_BAND = 400`) plus 80 milky-way
stars, over whatever the viewport is.

Measured density: **2692.92** lit px per 10k CSS px² at 390×844 versus
**681.33** at 1440×900 — a **3.95×** ratio against a **3.94×** area ratio
(329,160 vs 1,296,000 px²). Density is exactly inversely proportional to area,
which is the claim, stated as strongly as it can be stated.

In absolute terms: **26.9% of every pixel on the 390×844 phone is a lit star
pixel** (88,620 of 329,160), against 6.8% on the desktop window. The phone
screenshot reads as TV static rather than as a sky, and that number is why.

The `render()` comment about `effectiveDpr` is still **correct and still
insufficient**, exactly as the brief said: band canvases measure 390×844 at
dpr 1, 2 *and* 3, and backing store is 80.3 MB at all three, so the dpr fix
did hold — but the count is still absolute, so two windows of different size
still disagree.

**Finding not in the prior diagnosis, and it reorders the priorities:** the
density delta between two different-sized *windows* is ~4×, which is far
larger than any resampling difference measured below. If the user's Edge and
Safari windows were not the same size, **claim (1) alone is sufficient to
produce the reported screenshot**. That does not excuse claim (2) — both are
real and both get fixed — but it means the star-field delta should not be
assumed to be primarily a rasterization story.

### Claim 2 — "every star is one CSS pixel, upscaled" — **CONCLUSION CONFIRMED, DETAILS REFUTED**

Three sub-claims, and they do not all survive:

**(a) "Sizes compute to ~0.15–0.81, always under the 1.5 branch."** The range
is wrong, the consequence is right. `sizeBase ∈ [0.3, 0.9]` times a depth
factor `(0.5 + t·0.8) ∈ [0.5, 1.3)` gives **[0.15, 1.17)**, not 0.15–0.81.
Since 1.17 < 1.5, every star does take the `fillRect(x, y, max(1,size),
max(1,size))` branch and the `arc` branch is dead code. Conclusion stands.

**(b) "Every star is one CSS pixel." — REFUTED as drawn.** The rect is 1×1,
but `x` and `y` are `Math.random() * width` — **fractional**. A 1×1 fillRect at
a fractional origin straddles two pixel columns and two rows, and Canvas2D
antialiases it into a 2×2 block of partial-alpha pixels. Measured on a band
canvas: **93.8% of scanline runs are 2px wide, only 5.6% are 1px**, and the
field averages 3.69 lit pixels per star.

This matters for S3 and is the most useful thing S1 turned up. **Each star is
already a ~4-pixel smear in the source, before any dpr scaling.** Rounding the
blit to whole device pixels therefore is *not sufficient on its own* — the
star positions inside the band must land on whole pixels too, or the source
smear survives every downstream fix.

**(c) "Band canvases are CSS-px sized and blitted at fractional offsets into a
dpr-scaled context, and browsers resample differently." — MECHANISM CONFIRMED,
CROSS-BROWSER ATTRIBUTION INFERRED.**

CSS-px sizing: confirmed (390×844 bands at dpr 3). Fractional offsets:
confirmed — `band.offsetX` accumulates a float camera delta, so it is
essentially never integral.

That a filter runs is measured, not inferred. At dpr 1, moving the blit from
offset 0.00 to 0.50:

```
offset 0.00 : 296 lit device px, mean luma 32.33
offset 0.50 : 635 lit device px, mean luma 14.67   (+114% pixels, 45% the luma)
```

114% more lit pixels at 45% the luma, with total energy conserved to within
2.7% (9570 vs 9315) — a smear, not a brightness change. Unambiguously a filter.

The sharpest evidence for the mechanism is the dpr-2 row. At dpr 2, an offset
of 0.50 CSS px is **exactly one device pixel**, and it produces a bit-identical
result (0.0% change, same mean luma), while offset 0.37 (0.74 device px) shifts
it by −3.8%. So what governs the output is the fractional position **in device
pixels** — which is precisely the quantity the HTML canvas spec leaves
unspecified for `drawImage` filtering.

What is *not* measured: that Chromium and WebKit choose different kernels. The
container cannot run WebKit (above). The honest statement is: **a filter
demonstrably runs, its kernel is not specified, so two engines are free to
differ — and a fix that removes the filter from the path removes the freedom.**
Recorded as an inference; S3 is worth doing on the strength of the mechanism
regardless of which engine does what.

### Claim 3 — memory — **CONFIRMED, mildly understated**

61 canvases, not 60 — the milky-way band is one too, and it is full-viewport
like the rest. CSS-px sized, so **independent of dpr**:

- 390×844 → **80.3 MB** (diagnosis: 79 MB, counting 60)
- 1440×900 → **316.2 MB** (diagnosis: 311 MB, counting 60)

### Claim 4 — draw calls — **CONFIRMED exactly**

Measured by wrapping `drawImage` on the live context for 60 frames:
**244 background `drawImage` per frame** (61 bands × 4 tiles), matching the
arithmetic exactly.

Both comments are stale as described. `// 32 drawImage calls vs 12,000` and
`// Pre-render 8 star bands. Each band gets 1500 stars = 12,000 total.` were
written for an 8-band/1500-star configuration that no longer exists — 8×4 = 32
and 8×1500 = 12,000 confirm what they were describing. Fixed in S5.

### Summary

| # | claim | verdict |
|---|---|---|
| 1 | count fixed, area is not | **confirmed** — 3.95× density delta phone vs desktop; 26.9% of the phone's pixels are lit |
| 2a | sizes ~0.15–0.81, always < 1.5 | range **wrong** (actually 0.15–1.17), conclusion **right** |
| 2b | every star is one CSS pixel | **refuted** — fractional fillRect antialiases each into a 2×2 smear in the SOURCE |
| 2c | fractional dpr blit resamples | **mechanism confirmed** (+114% lit px at 45% luma); cross-browser attribution **inferred, not measured** |
| 3 | ~311 MB / ~79 MB | **confirmed**, 316.2 / 80.3 counting the milky-way band |
| 4 | 244 draw calls; comments stale | **confirmed exactly** |

The diagnosis survives as a work queue. The two corrections that change what
S2–S4 must do: the source smear (2b) means S3 has to fix star *placement*, not
only the blit; and the ~4× window-size density delta (1) is large enough that
it, not resampling, may be the dominant term in the user's screenshot.

---

## S2 — density derived from area

Star count is now `(width × height / 10⁴) × density`, split evenly across the
same 60 parallax bands. The unit is **stars per 10 000 CSS px²**.

```
                      before                    after
              stars/10k   lit px/10k     stars/10k   lit px/10k
390x844         729         2692.92         184         658.65
1440x900        185          681.33         185         683.95
ratio          3.94x          3.95x        1.00x          0.96x
```

The residual 4% in lit pixels (not present in the star counts, which match to
0.5%) is per-star footprint, not density: a smaller canvas clips proportionally
more stars at its edges, and the per-band budget is a whole number of stars.
Both are sub-1% effects that compound to under 4%, and neither is worth
chasing.

**CSS px², not device px².** A star should subtend the same apparent size
whatever the display's pixel ratio, and CSS px is the unit that means
"apparent size". `BackgroundManager` derives its scene as
`canvas.width / effectiveDpr()` and `App.tsx` sizes the canvas as
`cssWidth × effectiveDpr()`, so scene width *is* CSS width — confirmed by
measurement: the band canvas is 390×844 at dpr 1, 2 and 3 alike.

**The milky way scales with WIDTH, not area.** Its stars are strung along a
diagonal spanning the viewport, so it is a line feature; keeping its along-band
density constant means scaling linearly with width. Anchored to the phone's
current count (80 stars at 390 px wide → `MILKY_WAY_PER_1K_WIDTH: 205`).

**Pinned by `tests/starfield.spec.ts`** (4 tests, new file — no existing test
was edited):

1. count = density × area at 390×844, and the 60-band structure survives;
2. **the regression this file exists for** — 390×844 vs 1000×1100 (3.5× the
   area) must agree on density within 3%;
3. the milky way doubles when width doubles at constant area;
4. the DBG cycle regenerates the bands immediately, without a resize.

### Default: 185 stars per 10k CSS px²

Aesthetic, so it ships as a cycle — `STAR_DENSITY_CYCLE = [185, 320, 729, 90]`,
DBG ▸ Visual ▸ "Star density". 185 is the density a 1440×900 desktop window
showed *before* this change, and 729 is what the phone showed from the same
absolute budget; both endpoints of the bug are in the table so the call can be
overturned by looking.

## S3 — kill the resampling

There were **two** filters in the path, not one. S1's claim 2b is why:

1. **Generation.** `fillRect(Math.random() * width, …, 1, 1)` — a 1×1 rect at a
   FRACTIONAL origin, which Canvas2D antialiases into a 2×2 partial-alpha
   block. Fixed by generating bands at device resolution and drawing each star
   at `Math.floor` device coordinates with an integer device size.
2. **Blit.** A CSS-px band drawn into a `setTransform(dpr,…)` context at a
   fractional scroll offset. Fixed by blitting under the IDENTITY transform
   (the bands are already device-resolution) at `Math.round`ed device offsets,
   with `imageSmoothingEnabled = false` as belt and braces.

Fixing only (2) would have left every star a smear regardless — which is why
S1 measuring the source footprint mattered.

### Verified against the live render, not by reading

`perf/starfield.mjs` gained `BLIT_PROBE`: it wraps `drawImage` on the real
context, reads back the transform in force and the post-transform destination,
and reports what fraction of band blits are unscaled and integer-aligned.

```
                 blits/30f   unscaled   integer dst   smoothing off
390x844  dpr1        7320       100%          100%            100%
390x844  dpr2        7320       100%          100%            100%
390x844  dpr3        7320       100%          100%            100%
1440x900 dpr1        7320       100%          100%            100%
1440x900 dpr2        7320       100%          100%            100%
```

Source star footprint, scanline runs in a band canvas — the generation half:

```
              before S3          after S3
390x844 dpr1  2px: 93.8%         1px: 100%
390x844 dpr2  2px: 93.8%         1px: 50.7%, 2px: 49.3%   (= round(size x dpr))
```

The dpr-2 split is the intended `round(size × dpr)`: a star is 1 or 2 whole
device pixels, never a fraction of one.

**A probe correction worth recording.** The S1 resample section replayed a
blit at fractional offsets. After S3 the shipped code does no such thing, so
that section was measuring a counterfactual — still useful as a control, but
misleading presented as a measurement. It is now labelled COUNTERFACTUAL and
the real path is audited separately. The same pass fixed a units bug in the
density column: it divided lit DEVICE pixels by CSS area, which multiplies
coverage by dpr² and made a dpr-2 run of an identical sky look 37% denser
than the dpr-1 run. Density is now reported as exact star count from the
manager, and coverage as a fraction of device pixels.

### The cost, stated plainly

Device-resolution bands are dpr² larger:

```
                    before S3     after S3
390x844  dpr2          80.3 MB      321.3 MB
1440x900 dpr2         316.2 MB     1264.9 MB
```

**1.26 GB of backing store on a desktop retina window.** This is the expected
consequence of S3 and is exactly what S4 exists to fix — the brief orders them
this way on purpose ("with (2) and (3) settled, revisit whether 60 separate
full-viewport canvases is the right structure at all"). It is an intermediate
state inside one PR, not a shipping one. **S4 must land.**

## S4 — memory and draw calls

S3 left the field at **321.3 MB** on the phone and **1264.9 MB** on a retina
desktop window. So the question the brief poses — "is 60 separate
full-viewport canvases the right structure at all?" — had to be answered, and
answered with measurement rather than taste.

### The decisive experiment

`perf/starfield.mjs --bench` times both structures against the same context,
flushing with a 1px readback so the numbers are rasterization and not call
submission, and interleaving A/B/A/B so a drifting machine biases both equally.

```
                        bands (61 x 4 blits)      direct (per-star fillRect)     ratio
390x844  dpr1      20.00 ms   80.3 Mpx   80.3 MB    3.30 ms   0.012 Mpx  0.07 MB    6.1x
390x844  dpr2      76.37 ms  321.3 Mpx  321.3 MB    3.14 ms   0.012 Mpx  0.06 MB   24.3x
1440x900 dpr2     236.73 ms 1264.9 Mpx 1264.9 MB   14.12 ms   0.048 Mpx  0.29 MB   16.8x
```

Software raster over-weights fill rate, so the RATIO is directional rather
than the device's. Two things make the conclusion safe anyway:

- **The overdraw column is exact and device independent.** 244 whole-screen
  blits at 390×844 dpr2 is 321 megapixels of mostly-transparent alpha blending
  per frame, for ~6 000 stars. Direct drawing touches 0.012 Mpx. That is a
  26 000× difference in pixels written — not a margin any noise could flip.
- **This device is known to be fill-rate bound.** `RENDER_SCALE_CYCLE`'s
  comment in `constants.ts` records that capping the pixel ratio at 2 was "the
  single largest smoothness result of the gauntlet", and that the unattributed
  `other` term it moved was compositing. Removing 244 full-screen blends is the
  same lever pulled much harder.

The band pre-render existed to trade ~12 000 per-star `fillRect`s for 32
`drawImage`s. **Both halves of that trade went stale** — it is now 244 blits
against ~6 000 stars — which is precisely what the brief flagged about the
stale comment, and it turns out the comment being stale and the DECISION being
stale were the same fact.

### What shipped

Stars are a struct-of-arrays sorted by draw group:

```
starX, starY      Int32Array   position within its layer, DEVICE px, integral
starSize          Uint8Array   edge length, DEVICE px, integral
starBandIdx       Uint8Array   which depth layer it rides
starGroups[]      { fill, start, count }   contiguous runs sharing one fillStyle
```

Per frame: advance 61 layer offsets, then one linear walk with **one canvas
state change per group** and zero allocation. Opacity is quantised into 16
buckets and **baked into each group's rgba fill**, so a group costs one
`fillStyle` write rather than a `fillStyle` plus a `globalAlpha`. 12 colours ×
16 buckets caps state changes at 192/frame against ~6 000 stars.

Wrapping is now one compare-and-subtract per star per axis, replacing the
4-way tiled blit — both terms are integers, so a star still lands on whole
device pixels.

The milky way became **the last depth layer** rather than a parallel structure
with its own canvas, storage and draw path.

```
                    before S4      after S4
390x844  dpr1         80.3 MB       0.1 MB
390x844  dpr2        321.3 MB       0.1 MB
1440x900 dpr2       1264.9 MB       0.2 MB
background drawImage / frame   244        0
```

Density is untouched — 184.1 / 185.19 stars per 10k CSS px², identical to S2.

**S3's guarantee got stronger, not weaker.** There is no intermediate canvas
left, so there is no blit to align and no filter to pick: stars are rasterized
exactly once, at integer device coordinates, under the identity transform. The
class of bug S3 fixed is now structurally absent rather than carefully avoided.

## S5 — docs and validation

**Stale comments: three, not two.** The brief named two, and a third had gone
stale in the same way:

1. `// 32 drawImage calls vs 12,000` — written for 8 bands × 1500 stars. Gone;
   there is no blit at all now.
2. `// Pre-render 8 star bands. Each band gets 1500 stars = 12,000 total.` —
   same vintage. Replaced by the derived-budget explanation.
3. **`render()`'s `effectiveDpr` comment**, which still said "the same 24 000
   stars end up packed into a fraction of the area". The count is no longer
   24 000 and no longer absolute. Rewritten — and it now also names the
   SECOND reason the capped ratio matters, which did not exist when it was
   written: `effectiveDpr` is a GENERATION input since S3, because star
   coordinates are baked in device pixels, so a mismatched ratio breaks pixel
   alignment as well as density.

**CLAUDE.md.** §2's `BackgroundManager` line now says the field is data rather
than bitmaps. §8 gained one invariant covering both halves of what was fixed —
density from area, and single-rasterization at integer device pixels — written
so the two failure modes are recoverable from the text: a fixed count makes a
smaller window denser, and snapping the draw offset without snapping the star
POSITION fixes nothing, because a fractional `fillRect` origin is already
antialiased before any scaling happens.

**Validation.** Three gates, two consecutive runs each, green both times.
46 tests (38 pre-existing + 8 new).

## S6 — spend the savings

User request after reviewing S1–S5: *"I also liked the large number of stars.
Is it possible to increase that number again and introduce more layers to create
more parallax depth now that we have some memory savings?"* Both, and the
structure S4 landed is what makes them cheap.

### Density: default 185 → 729

729 is the star count the 390×844 phone showed before the gauntlet — the "large
number of stars" in question — and since density is now uniform per unit area,
every screen size gets it.

**The count is the same as before the gauntlet; the LOOK is not, and that is the
point.** Each star used to be a 1-CSS-px `fillRect` at a fractional origin,
antialiased into a ~3.7-pixel smear, so 729 stars covered **26.9%** of the
screen and read as TV static. A star is now one crisp device pixel, so the same
729 covers **7.05%**. Same many stars, roughly a quarter of the ink.

If the old *ink coverage* is what is wanted rather than the old *count*, that is
~2000–2700 on this scale, and 2000 is in the cycle.

### Depth: 60 → 240 layers

Layer count was frozen at 60 for one reason: a layer used to BE a full-viewport
canvas, so depth granularity cost whole megabytes. It now costs five numbers and
one scroll accumulator.

```
                     60 layers    240 layers
per-frame work       61 float updates    241 float updates
storage              ~2.4 KB             ~9.6 KB
```

Star size and brightness are already continuous in the layer's depth fraction
(`t`), so more layers simply gives a finer near-to-far gradient — no other
tuning had to move.

`starBandIdx` was widened **Uint8 → Uint16**. The cycle offers 480 layers, and a
Uint8 index wraps silently past 255 — the far layers' stars would scatter onto
near ones with no error raised anywhere.

### What it costs

```
                        before gauntlet        after S6
390x844   stars              24 000             24 000     (same count)
          coverage            26.9%               7.05%    (crisp, not smeared)
          layers                 60                240
          memory             80.3 MB              0.3 MB
          bg drawImage          244                  0
1440x900  stars              24 000             94 560     (density now uniform)
          memory            316.2 MB              1.0 MB
```

Bench at the new defaults, against the equivalent band structure:

```
390x844  dpr2   bands 287.66 ms / 1269.2 Mpx  |  direct 15.39 ms / 0.048 Mpx  -> 18.7x
1440x900 dpr2   bands 964.81 ms / 4997.4 Mpx  |  direct 56.22 ms / 0.190 Mpx  -> 17.2x
```

**The one honest caveat.** Direct drawing costs one canvas call per star, so
cost is now LINEAR in density — where the old pre-rendered structure was flat in
star count and linear in layer count. That trade is why raising density is
affordable rather than free, and it is the opposite of the old trade, so it is
worth stating plainly:

- At 390×844 (the target device) the default is 24 000 calls per frame — on the
  order of 1–2 ms of call overhead on real hardware. Fine.
- At 1440×900 the same density is 94 560 calls. Still ~17× cheaper than the
  structure it replaced, and 316 MB lighter, but it is the configuration to
  watch if desktop frame time ever matters. The cycle's 400 and 185 steps are
  the dial-back.

Nothing here regresses against the pre-gauntlet code on any axis measured: at
4× the stars, desktop still costs 17× less time and 316× less memory.

## S7 — non-uniform density by map region

User request: *"I would also like to test using less stars in different areas of
the map instead of a uniform distribution. This could leverage the flow field to
only have stars in those areas or not in those areas. Otherwise, it could use a
different schema if there is no clear benefit to leverage flow field."*

### The flow field: evaluated, rejected

Three reasons, and any one of them is disqualifying:

1. **It is a DIRECTION field, not a density field.** `sampleAsteroidFlow`
   returns vectors that are normalised and then deflected around obstacles.
   Its magnitude carries no "how much stuff is here" signal, so driving star
   density from it means inventing a quantity it does not encode.
2. **It mutates with gameplay.** Cells are re-baked when a tile is destroyed,
   and the whole field slowly breathes (`FlowFieldGrid`'s breathing term).
   Stars are the most distant thing in the scene. A backdrop that reshuffles
   when you shoot a nearby rock is a category error — and a bug that would be
   very hard to recognise as one, because it would look like flicker.
3. **It couples the backdrop to a gameplay system.** `BackgroundManager`
   currently knows about toroidal maths, constants and assets, and nothing else.

So: a different schema, purpose-built for density.

### What shipped

A world-space field sampled **at the camera**, gating what share of the star
budget is drawn. Fly into a rich region and the sky fills in; fly into a void
and it thins out.

**The field** is a sum of three plane waves with INTEGER wave vectors. Integer
is what makes it exactly periodic over `MAP_WIDTH × MAP_HEIGHT`, so it is
seam-continuous across the torus wrap with no special case — the same device
`FlowFieldGrid`'s breathing term uses for the same reason.

**The gating is free.** Each fill group is sorted at generation by a stable
random key, so drawing a PREFIX of a group is a spatially unbiased random
sample of it. Per frame that is one field sample and one multiply per group —
not a test per star. Milky-way stars sort ahead of the key and are never gated:
the galactic band is a landmark, and a landmark that dissolves in a void is not
one.

`minFrac` floors the emptiest region at 30% of the budget (10% on Strong).
Never 0 — a completely empty sky reads as a rendering failure, not as a void.

### The bug the visualiser caught

The first draft had a single `scale` multiplier over a fixed set of base wave
vectors. `perf/starfield-regions.mjs` (new) prints the field as ASCII, and the
problem was visible instantly:

```
   *#%#=-=+-  -***#%#=-=+-  -**        <-- the same pattern, twice
   ++*#=:.:-:-*@%++*#=:.:-:-*@%
```

Multiplying every wave vector by `scale` gives them all a common factor, which
makes the field periodic over `map/scale` as well as over the map. At scale 2 a
player flying in one direction passes through the identical sky pattern twice.

Fixed by choosing wave vectors PER STEP with **no common factor**
(`[[1,2],[3,-1],[2,5]]`, gcd 1) instead of scaling a common base. Region size is
now controlled by picking bigger wave numbers, not by a multiplier. Pinned by a
test that samples the field at half-map offsets and requires them to DIFFER.

This is the argument for building the visualiser rather than eyeballing one
screenshot: the defect is invisible in any single frame, and only shows when
the whole field is laid out at once.

### Measured

```
=== star-region field, ASTEROID_FIELD 6000x6000 (' '=empty, '@'=rich) ===
     .:====----+*####***###*+-.
   ..:-=+++=--=+#%@@%#*++++=-:.
   :.:-=++++==+*%@@@#*=-:-----:
   …
richest   field 0.994 at -1500,-1900 — 23 995 stars (99.6% of budget)
emptiest  field 0.003 at   600, 1500 —  7 325 stars (30.4% of budget)
```

A diagonal walk across the map ranges 51%–75% of budget, so ordinary travel
does read as a changing sky rather than as a constant one.

## S8 — the low-speed jitter, which S3 caused

User report: *"there is noticeable jittering at low ship speeds."*

**This one is mine.** S3 snapped every star to a whole device pixel, which is
what removed the browser-dependent resampling — and a pixel-snapped field can
only MOVE in whole-pixel steps. At speed it does not matter, because the step is
smaller than the motion. At a drift it IS the motion.

Camera was ruled out first: it hard-snaps to the player with no lerp, and world
entities draw at fractional positions, so the star field was the only thing in
the frame that quantises.

### Measured, with `perf/starfield-motion.mjs` (new)

The first metric tried — the share of ALL stars moving each frame — showed
almost nothing, and that was the metric being wrong rather than the artifact
being absent. With 240 depth layers stepping at different times, the whole-field
average is a smooth trickle even when every individual layer is lurching.

What the eye actually catches is **coherence**: ~100 bright foreground stars
jumping *together* reads as a twitch in one depth plane. So the probe measures
the NEAREST layer — brightest, largest, fastest-scrolling, and therefore first
to step:

```
                    nearest layer, share that moved on one frame
   ship speed     worst frame              frames where MOST moved together
                 before   after              before   after
       2          100%     10%                 3%      0%
       6          100%     20%                 9%      0%
      15          100%     56%                29%      2%
      40          100%    100%                69%     86%
     120          100%    100%               100%    100%
```

Before, the worst frame is **100% at every speed** — the layer always moves as
one body, it is only a question of how often. After, at drift speeds it never
does. The two converge at 40+ because there the layer genuinely moves a pixel
every frame, which is correct rather than an artifact.

### The fix

A per-star sub-pixel **phase**. Each star crosses to the next pixel at its own
moment within the pixel, so at any instant the share of a layer that has already
stepped equals the layer's true sub-pixel offset. Spatial dithering, applied to
motion.

**The S3 guarantee is untouched, and that is the point of doing it this way.**
`(X[i] + bandOffsetX[b] + phase) | 0` is still a floor to a whole device pixel —
every star still lands exactly on the pixel grid. Only the TIMING of the
transition moved. A test now pins this against the real `fillRect` calls in both
dither modes, rather than inferring it from the storage types.

Phases are `Uint8` (1/256 px), independent per axis so diagonal drift does not
resynchronise the two. 48 KB for the pair.

### An instrument bug worth recording

The first before/after run showed the undithered path frozen 100% of frames at
*every* speed including cruise — which is impossible, and was the probe's fault:
the player had died partway through the sweep, the camera stopped following, and
a stationary camera looks exactly like a stuck field. The probe now keeps the
pilot alive and resets position per run. **A measurement that confirms your
hypothesis too strongly is a reason to check the measurement**, and this one
would have made the fix look far better than it is.

## S9 — the dither was wrong, and stars were popping

Two user reports, both regressions of mine:

> *"Star smooth actually appears to make the jittering worse."*
> *"The star regions settings cause stars to disappear and appear in the middle
> of the screen. They should never flash on screen."*

### Why the S8 dither made it worse

S8 measured coherence and treated it as the defect: it scored a depth layer
badly when all ~100 of its stars stepped on the same frame, and the dither
scattered those steps across 256 sub-pixel phases so no layer ever moved as one
body. The metric improved exactly as designed.

**The metric was rewarding the wrong thing.** A coherent 1-pixel step of a whole
layer is one discrete event, and the eye reads a rigid shift as motion. Stars
stepping *independently* preserve no local structure — neighbouring stars change
their relative positions by a pixel constantly — and that reads as the whole sky
FIZZING. Uncorrelated high-frequency noise across the entire screen is more
objectionable than a low-frequency lurch in one plane, which is why the fix
scored better and looked worse.

I had the perceptual model backwards, and no amount of the measurement I chose
would have told me — it was measuring the thing I had wrongly assumed was bad.

**The dither is removed rather than left behind the toggle.** A disproved option
in a cycle is clutter, and keeping it would imply it is a reasonable choice.

### What replaced it

The honest framing is that S3's snapping was buying SHARPNESS, not correctness —
and I had been treating it as correctness. The cross-browser bug this gauntlet
started from was the `drawImage` BLIT FILTER on the pre-rendered band canvases,
whose kernel the canvas spec leaves unspecified. **S4 deleted those canvases
outright**, so there is no `drawImage` in the star path at all any more. What is
left is `fillRect` coverage antialiasing on an axis-aligned rect: analytic area
coverage, consistent across engines in a way a resampling filter never was.

So sub-pixel positioning became safe again the moment S4 landed, and nobody
noticed — including me, for two milestones.

`STAR_MOTION_CYCLE`, DBG ▸ Visual ▸ **Star motion**:

- **`smooth`** (default) — exact fractional position. Continuous motion at any
  speed. Antialiased, so slightly softer.
- **`crisp`** — snapped to whole device pixels. Maximum sharpness; visibly steps
  at low speed. The S3 behaviour.

For 1-pixel stars this is a genuine trade and **you cannot have both**. Measured
(`perf/starfield-motion.mjs`, retargeted to quantisation error — the old
coherence metric was retired for the reason above):

```
                mean position error (device px)      stars not moving, per frame
   ship speed     smooth        crisp                  smooth     crisp
        2          0.000        0.225                    0%        99%
        6          0.000        0.225                    0%        97%
       15          0.000        0.245                    0%        91%
       40          0.000        0.256                    0%        78%
      120          0.000        0.252                    0%        49%
```

At ship speed 2, crisp leaves **99% of the field frozen on any given frame**.
Smooth is zero error by construction. Cost is unchanged: 8.43 ms/frame in the
bench against 8.2 ms before, so antialiased rects are not measurably dearer
here.

### The region edge now fades

Gating drew a hard PREFIX of each threshold-sorted group, so a star switched
fully on or fully off in a single frame — anywhere on screen, including the
middle of it. I dismissed this when writing S7 on the grounds that one star
among 24 000 is imperceptible. That was wrong: a point of light appearing from
nothing is exactly what peripheral vision is built to catch.

The last `STAR_REGION_FADE.EDGE_FRAC` (35%) of each group's visible run is now
drawn in `STEPS` (6) descending-opacity sub-runs, precomputed per group as extra
rgba strings. A star crosses several intermediate alphas as the cut sweeps past,
and because the field changes over seconds of travel, each crossing takes about
a second. Costs 6 extra `fillStyle` writes per group — state changes, not
per-star work — and allocates nothing per frame.

## S10 — crisp abandoned, and the sky stops reshuffling

> *"Star motion at smooth looks good. Crisp does not - this still jitters so
> let's abandon this."*
> *"Can you elaborate on star depth? This changes the visible stars on the
> screen when adjusted without adjusting the density."*

### Crisp is gone

Confirmed by testing rather than argued about: pixel-snapping cannot be made to
move smoothly, so the mode had no future. `STAR_MOTION_CYCLE` is deleted and the
draw loop has one path. Motion is sub-pixel, full stop.

That closes a three-milestone arc — S3 snapped, S8 dithered the snap, S9 made
snapping optional, S10 removes it — and the through-line is one mistake: I
treated snapping as a CORRECTNESS requirement when it was only ever buying
sharpness. The correctness fix was S4 deleting the band canvases and with them
every `drawImage` in the star path.

### Star depth: the knob was right, the sky was lying

The reported symptom was that changing depth appears to change how many stars
are on screen. **It does not.** Measured at 390×844 dpr2, camera parked so the
region field is identical:

```
layers  perBand  starCount  on screen   solid  faded   total ink
   241      100      24000      17776    9372   8404       4627
   121      200      24000      17775    9372   8403       4625
   481       50      24000      17779    9379   8400       4645
    61      400      24000      17781    9381   8400       4635
```

Star count is identical at every setting; on-screen count varies by 0.03% and
total ink by 0.4% — rounding, not signal. The user's reading of the knob ("the
number of parallax layers") is exactly what it is.

**The real defect was elsewhere, and it affected every knob.** Star generation
used unseeded `Math.random`, and the field regenerates whenever any generation
input changes — viewport, pixel ratio, density, depth. So every cycle produced a
completely NEW random sky with the same statistics, and the eye reads "different
stars" as "different number of stars".

That is a wart on the whole DBG surface, not just on depth: these knobs exist so
an aesthetic call can be settled **by looking**, and an A/B where the entire
sample is replaced between A and B cannot settle anything.

Star generation is now seeded per map (mulberry32, seeded from a hash of the
`MapType`). A regeneration reproduces the same sky; different maps still get
different skies. Pinned by a test that cycles depth all the way around the cycle
and requires a position fingerprint of the whole field to come back identical.

Nebula puffs and shooting stars deliberately keep `Math.random` — they are not
part of the comparison, and seeding them would freeze motion that should vary.

## DECISIONS TAKEN

**D1 — Measure with a purpose-built probe (`perf/starfield.mjs`) rather than
extending `perf/capture.mjs` with a starfield scene.**
Beat: adding a scene to the capture matrix. The matrix measures frame time,
allocation and sim cost over a window; every S1 question here is a *static*
property of pixels and canvases (how many stars, how big, how many bytes, what
does a blit do to a pixel) that a frame-time harness cannot answer, and the one
number the matrix is good at — milliseconds — is the one this container cannot
be trusted on for a fill-rate-bound layer. A separate file also keeps the merge
gate and the matrix untouched.

**D2 — Report the WebKit gap as a limit rather than substituting a proxy for
it.** Beat: asserting the cross-browser cause from the Chromium-only numbers,
or simulating "a different filter" by toggling `imageSmoothingEnabled`. The
brief asked which claims *survived*; a claim whose decisive experiment cannot
be run in this container has not survived, it is untested, and saying so is
worth more than a confident sentence backed by an inference. The mechanism
measurement is strong enough to justify S3 on its own.

**D3 — Default to the DESKTOP density (185), not the phone's (729) and not a
midpoint.** Beat: keeping the phone's current density as the default (least
visual change on the target device), and beat splitting the difference at ~320.
The phone's density puts 26.9% of every pixel inside a star, which is the
defect, not a preference — matching it would be fixing the desktop *to* the
bug. A midpoint would be a number nobody has ever looked at, chosen to avoid
committing. 185 is the one density in evidence that a human has actually seen
rendered and not filed a bug about. Both endpoints stay one tap apart in the
cycle, which is what makes this safe to be wrong about.

**D4 — Scale the milky way with WIDTH while the star field scales with AREA.**
Beat: scaling both by area, for uniformity. Uniformity would be wrong here —
the milky way's stars are distributed along a diagonal LINE spanning the
viewport, so area scaling would make its along-band density fall as the
window widened, which is the same class of bug S2 exists to fix, just on a
different axis. Anchored to the phone's count rather than the desktop's (unlike
D3) because it is an authored feature that should read on the target device,
and it has spent its whole life invisible under the haze S2 removes.

**D6 — Fix the SOURCE smear as well as the blit, rather than only the blit.**
Beat: the brief's literal instruction, "render bands at DEVICE resolution so a
star lands on whole device pixels", which on its own means resizing the band
canvases and nothing else. That would have left every star an antialiased 2×2
block from the fractional `fillRect` origin — S1's claim 2b — so the field
would still have been soft, and the fix would have looked like it failed.
Snapping star positions and sizes to whole device pixels is the other half.

**D7 — Round the DRAW, keep the ACCUMULATOR fractional.** Beat: rounding
`band.offsetX` itself, which is the obvious way to get integer offsets. It
would quantise slow parallax to a dead stop: the furthest bands move well under
half a device pixel per frame, so each frame's rounding would discard the
entire shift and the distant layers would never move at all.

**D8 — Default the size floor to one DEVICE pixel, not one CSS pixel.** Beat:
`'css'`, which preserves the apparent star size the field has always had. The
point of S3 is that a high-dpi display can now show a finer sky than a CSS
pixel permits, and defaulting to the CSS floor would spend the whole change on
crispness while throwing the resolution away. The two are identical at dpr 1,
so this only decides what dpr ≥ 2 looks like — and it is a DBG cycle, so it is
one tap to disagree.

**D9 — Delete the band canvases entirely rather than shrinking or reducing
them.** Beat two alternatives the brief named. *Fewer bands* (60 → 8) divides
the cost by 7.5 and coarsens the parallax to 8 discrete depths — it pays a
visible price for a partial fix, and 1264.9 MB / 7.5 is still 169 MB.
*Bands smaller than the viewport, tiled more* keeps memory flat but INCREASES
draw calls (a 512px tile over 1440×900 needs 12 draws per band, so 732/frame),
and a repeating tile is the one artifact the eye reliably catches in a star
field. Direct drawing beats both on every axis measured, and it is the only
option that removes the resampling class of bug structurally instead of by
careful arithmetic.

**D10 — Bake opacity into the fill colour instead of using `globalAlpha`.**
Beat: grouping by colour and setting `globalAlpha` per star (~6 000 state
changes) or per alpha bucket (two state changes per group). A `globalAlpha`
write costs about what a `fillStyle` write costs, so folding alpha into the
rgba string halves the state changes for free. The price is quantising opacity
to 16 buckets — a ~5.6% step, below the just-noticeable difference for a
1-pixel dot on black.

**D11 — Keep 60 depth layers.** Beat: reducing them now that the structure
changed. The layer count was only ever expensive because each layer was a
canvas; a layer is now three numbers and 61 of them cost 61 float updates per
frame. There is no reason to spend parallax smoothness to save that.

**D12 — Keep the bench runnable by RECONSTRUCTING the old structure.** Beat:
deleting the bench once the decision was made, or leaving it referencing fields
that no longer exist. A structural call this large should be re-checkable on
another machine rather than believed from a ledger table, so the bench now
rebuilds the 61 band canvases from the live star data and A/Bs them against the
real `renderStars` — not against this file's re-implementation of it (harness
rule 6 applies to probes too).

**D24 — Delete `crisp` rather than keep it as a non-default option.** Beat:
leaving it in the cycle for anyone who prefers sharpness. Same reasoning as D21
one milestone earlier, and the fact that this is the second time says something:
a knob whose every setting has been tested and rejected is not a choice, it is
an unfinished decision left in the UI. The trade is documented in
`constants.ts` where the code is, so the reasoning survives the deletion.

**D25 — Seed star generation per MAP, not globally and not per regeneration.**
Beat two alternatives. A single global seed would give every map the identical
sky, losing free variety for nothing. Re-seeding per regeneration is what the
code already did (via `Math.random`) and is the bug. Hashing the `MapType`
keeps each map's sky its own and stable, which is what makes the DBG cycles
comparable.

**D26 — Seed only the STARS, leaving nebula puffs and shooting stars random.**
Beat: seeding all of `initContent` for consistency. Shooting stars are transient
motion that should differ every time, and puff placement is already anchored to
map cluster centres. Only the star field is the thing being A/B'd, so only it
needs to hold still.

**D21 — Remove the S8 dither outright rather than demote it to a non-default
option.** Beat: keeping it as a third motion mode. It is disproved, not merely
unfashionable — it looks worse than both alternatives, and a cycle entry implies
a real choice. The experiment stays in the ledger, which is where a dead end
belongs.

**D22 — Default to SMOOTH and treat sharpness as the thing being traded.** Beat:
keeping crisp as the default because it was the S3 headline. That framing was
mine and it was wrong: snapping never bought cross-browser correctness once S4
removed the blit — it bought sharpness — and two rounds of user testing found
the motion cost worse than the softness. Crisp stays one tap away for anyone who
disagrees.

**D23 — Fade the region edge with per-group opacity sub-runs, not per-star
alpha.** Beat: giving each star its own alpha, which is the obvious way to fade
and would destroy the fill-style batching the whole draw loop depends on
(~24 000 state changes instead of ~1 150). Because groups are already sorted by
threshold, the fade band is a contiguous run, so it splits into a handful of
sub-runs at precomputed opacities and costs state changes rather than per-star
work.

**D19 (SUPERSEDED by D21) — Fix the jitter with a per-star dither rather than by unsnapping the
field.** Beat: dropping back to fractional positions, which is the obvious fix
and restores perfectly smooth motion. It also restores the antialiasing —
a fractional `fillRect` origin is exactly the source smear S1 measured at 93.8%
of runs and S3 removed — so it would trade the whole gauntlet's result for
smooth drift. The dither keeps both: whole-pixel stars, continuous motion.

**D20 — Measure COHERENCE in the nearest layer, not the whole-field average.**
Beat: the whole-field average, which was the first metric and showed the fix
doing almost nothing. It was diluted across 240 layers stepping independently.
The artifact is a lump of bright stars moving as one body, so the metric has to
be per layer and has to be about simultaneity — otherwise it measures something
real that is not what anyone is complaining about.

**D16 — Reject the flow field as the density source, and say so in the code.**
Beat: using it as asked. It is a normalised DIRECTION field with no density
signal in its magnitude, it re-bakes on tile destruction and breathes over time,
and reading it would couple the backdrop to a gameplay system. The rejection is
written into `constants.ts` beside the replacement, not just here, because the
obvious next question on reading that code is "why not use the flow field?" and
the answer should not require finding this file.

**D17 — Sample the field at the CAMERA, not per star.** Beat: giving each star a
world position and gating it individually, which would show a visible boundary
between a dense region and a void within one screen. Two problems: a star's
"world position" is ill-defined in a parallax-tiled field (a distant layer is
effectively at infinity and follows the camera, so gating it by world region
would make it pop as you move), and evaluating noise per star is ~24 000
evaluations per frame against one. Camera sampling gives "regions of the map are
starrier", which is what was asked for, at O(1).

**D18 — Gate by PREFIX of a sorted group, not by a per-star test.** Beat: a
visibility flag per star checked in the draw loop. Sorting each group once at
generation by a stable random key makes a prefix a spatially unbiased sample, so
the per-frame cost is one multiply per group instead of a branch per star — and
the draw loop stays a branch-free linear walk over typed arrays.

**D14 — Default density to the old COUNT (729), not the old COVERAGE (~2400).**
Beat: matching what the pre-gauntlet phone sky actually *looked* like, which
would need ~2400 on this scale because the old stars were 3.7-pixel smears. The
request was for "the large number of stars", and the number is 729's worth;
reproducing the smear's ink coverage would be reproducing the defect's side
effect, not the thing that was liked. 2000 is one tap away if the denser ink is
what is actually wanted — which is a judgement to make by looking, not here.

**D15 — Widen `starBandIdx` to Uint16 rather than capping the layer cycle at
254.** Beat: keeping Uint8 and limiting the DBG cycle to fit. The cap would be
an invisible constraint enforced by nothing — the next person to add a 512 entry
gets silent index wraparound, with far-layer stars scattering onto near layers
and no error anywhere. 6 KB is not worth a trap like that.

**D13 — Do NOT regenerate `omniverse-standalone.html`, against gauntlet
convention.** Beat: following the established P-final pattern (`5f P-final:
validation, CLAUDE.md layout sync, standalone rebuild`). PR #84 is open against
the same base and already regenerates that file, so a second regeneration is a
guaranteed conflict in a 5.7 MB generated artifact — and the brief's standing
instruction for the parallel work is to rebase rather than fight it. The file
is reproducible in one command (`npm run build && node scripts/inline-build.mjs`)
and `publish-standalone.yml` is what actually releases it, so nothing is lost
by letting #84 carry it. Flagged rather than silently skipped.

**D5 — Split the budget evenly across bands and absorb the round-off in the
total.** Beat: giving band 0 the remainder. A remainder in one band makes the
furthest parallax layer measurably denser than the rest, which is exactly the
artifact the density work is trying to remove — and it would be invisible in
any aggregate check. Even split costs at most 30 stars of the ~6 000 budget.

---

## FOR-USER-REVIEW

- **S10 — depth does what you thought; the sky no longer reshuffles.** Your
  reading was right: it is the number of parallax layers, and the star count is
  identical at every setting (24 000, measured; on-screen count within 0.03%).
  What was misleading you is fixed — generation is now seeded per map, so
  changing depth (or density, or resizing) rebuilds the SAME sky instead of
  rolling a new one. Every star knob is now a fair A/B.

- **S9 (crisp since REMOVED) — the jitter fix is sub-pixel motion, and the sky
  is slightly softer as a result.** This is the trade and it is unavoidable for 1-pixel
  stars: crisp stars cannot move smoothly, smooth stars cannot be perfectly
  crisp. Default is now **Smooth** (zero position error at every speed);
  Visual ▸ **Star motion** ▸ Crisp restores the sharper, stepping version.
  Shots: `perf/out/shots/s9/`. If smooth reads as too soft, say so — the next
  lever is star SIZE, where a 2-device-px star keeps a solid core while still
  moving continuously.

- **S8's dither is gone** (it was the thing making jitter worse). Recorded as a
  dead end rather than left in the menu.

- **S7 — the sky now thins out in some parts of the map.** Default is
  **Medium**: the emptiest regions keep 30% of the stars, the richest ~100%, and
  a region is a few seconds of travel across. Visual ▸ **Star regions** cycles
  Medium / Strong (10% floor, more dramatic) / Fine (smaller regions) / Off.
  It is a draw-time gate, so it takes effect instantly with no rebuild.
  `node perf/starfield-regions.mjs --shot <dir>` prints the field as ASCII and
  shoots the richest and emptiest spots on the map.
  **I defaulted this ON at Medium** because a test you have to go and enable is
  one you will not run — but it is the change here most likely to be wrong for
  you, and Off is one tap away.

- **S6 — the dense sky is back, at 729 (your call), with 4× the depth.**
  ~24 000 stars on the phone again, which is the pre-gauntlet count. It will
  read *finer* than the old one at the same count: those stars were 3.7-pixel
  smears covering 26.9% of the screen, these are single crisp pixels covering
  7.05%. If you want the old INK rather than the old COUNT, Visual ▸ Star
  density ▸ **2000** is that. Star depth is on its own row (240 / 120 / 480 /
  60). Shots in `perf/out/shots/s6/`.

- **S2 (superseded by S6, kept for the record) — the sky got much sparser.**
  390×844 went from 24 000 stars to ~6 000 (`perf/out/shots/before/` vs
  `perf/out/shots/s2/`). The before shot reads as TV static; the after reads as
  a star field. The desktop is essentially unchanged, by construction — 185 is
  its existing density. If the phone now looks too empty, **pause ▸ Debug Menu
  ▸ Visual ▸ Star density** cycles 185 → 320 → 729 → 90; 729 is exactly what
  the phone showed before. Tell me which one and it becomes the default.

- **S3 — the sky is sharper, and on a retina screen it is FINER.** At dpr 1
  nothing much changes: a star was a 1-CSS-px rect, and it still is, just no
  longer antialiased across four pixels. At dpr ≥ 2 the change is real — a star
  may now be a single DEVICE pixel, so the field reads as finer and more
  pinpoint rather than soft. That is the intent, but it is a taste call.
  **pause ▸ Debug Menu ▸ Visual ▸ Star size** flips it: `Device px` (default,
  finest) vs `CSS px` (never smaller than one CSS pixel — the apparent size the
  field has always had, but crisp instead of filtered). Identical at dpr 1.
  Screenshots: `perf/out/shots/s2/` (pre-S3) vs `perf/out/shots/s3/` at dpr 1
  and dpr 2 — regenerate with
  `node perf/starfield.mjs --shot <dir> --dpr 2 --width 390 --height 844`
  (`perf/out/` is gitignored by repo convention, so they are not in the tree).

- **S4 changed nothing visual, by design.** The sky after S4 is the same sky
  as after S3 — same stars, same density, same positions. If you see a
  difference between `perf/out/shots/s3/` and `perf/out/shots/s4/`, that is a
  bug and I want to know.

- **The WebKit gap.** The Edge-vs-Safari delta cannot be reproduced in this
  container (proxy blocks Playwright's WebKit download). If you can re-shoot
  the side-by-side after S3 lands, that is the acceptance test this gauntlet
  cannot run for itself. Worth knowing before then: were the two windows the
  same size? Finding (1) says a size difference alone gives ~4× the star
  density, which would dominate anything rasterization is doing.

---

## Completion summary

### What the four claims came to

| # | prior-session claim | verdict | fixed in |
|---|---|---|---|
| 1 | count fixed, area is not | **confirmed** — 3.95× delta, 26.9% of the phone's pixels lit | S2 |
| 2a | sizes 0.15–0.81, always < 1.5 | range **wrong** (0.15–1.17), conclusion **right** | S3 |
| 2b | every star is one CSS pixel | **refuted** — already a 2×2 antialiased smear in the source | S3 |
| 2c | fractional dpr blit resamples | **mechanism confirmed**, cross-browser attribution **untested** | S3, then made structurally impossible by S4 |
| 3 | ~311 MB / ~79 MB | **confirmed** (316.2 / 80.3, counting the milky way) | S4 |
| 4 | 244 draw calls; comments stale | **confirmed exactly**; three stale comments, not two | S4, S5 |

The diagnosis held up as a work queue. Two corrections changed what had to be
built: the source-level smear (2b) meant S3 had to fix star *placement* and not
only the blit, and the ~4× window-size density delta (1) is large enough that it
— not rasterization — may be the dominant term in the user's screenshot.

### End to end

```
                              before        after
390x844 dpr2  density        729           184     stars / 10k CSS px²
              lit coverage    26.9%          0.6%   of device pixels
              backing store   80.3 MB        0.1 MB
              bg drawImage   244              0     per frame
              overdraw       321.3 Mpx      0.012 Mpx  per frame
1440x900 dpr2 backing store  316.2 MB        0.2 MB
              density        185            185     stars / 10k CSS px²
```

Phone and desktop now agree on density to within 0.6%, against 3.95× before.

### What is NOT settled

- **The Edge-vs-Safari delta is unverified.** WebKit cannot be downloaded in
  this container. The resampling MECHANISM is measured and now structurally
  absent, but nobody has re-shot the user's side-by-side. That is the
  acceptance test this gauntlet cannot run for itself.
- **Two visual defaults are calls, not findings** — star density (185) and the
  size floor (`device`). Both ship as DBG cycles with the pre-change value one
  tap away. See FOR-USER-REVIEW.
- **Frame-time on real hardware.** Every timing here is software raster. The
  overdraw and byte numbers are exact and device independent, and the direction
  is corroborated by this game's own hardware captures (`RENDER_SCALE_CYCLE`),
  but a device capture through the in-game Perf REC panel is what would confirm
  the win. Suggested: Ring World, before/after.

### Overlap with the parallel PRs

Base (`claude/plan-completion`) did not move during this work, so there was
nothing to rebase. Neither open PR touches `BackgroundManager.ts`, `perf/`, or
`tests/starfield.spec.ts`, so the substance is conflict-free. Overlap is
confined to shared wiring files — `App.tsx`, `UIOverlay.tsx`, `constants.ts`,
`GameEngine.ts`, `debugControls.ts`, `types.ts`, `CLAUDE.md`, `RenderSystem.ts`
— where this branch only ADDS (two DBG rows and their plumbing). `InputSystem.ts`
was left alone as instructed.

## Per-iteration log

### Iteration 1 — S1 (verify and measure)

Built `perf/starfield.mjs`; ran the 5-config sweep under Chromium; captured
baseline screenshots at 390×844 dpr 1/2 and 1440×900 dpr 2. Attempted a WebKit
install for the decisive cross-browser comparison — blocked by the proxy (403
on both CDN hosts), recorded as the S1 gap rather than worked around.

Four claims checked: two confirmed outright (memory, draw calls), one confirmed
and quantified (density), one split — its conclusion confirmed, two of its
three details refuted. No production code touched this iteration, by design:
if the diagnosis were wrong the rest of the queue would be wrong with it, and
one detail (2b, the source-level smear) did turn out to change what S3 has to
do.

### Iteration 10 — S10 (crisp removed; seeded sky)

Crisp deleted on user testing — three milestones of trying to make pixel-snapped
stars move smoothly, ended by accepting that they cannot.

The depth question turned out to be the more interesting one. Measuring first
was what made it answerable: the knob does exactly what its name says and the
star count is constant to within 0.03%, so the surprise had to be coming from
somewhere else — and it was the unseeded generator replacing the entire sky on
every regeneration. That is a defect in how EVERY star knob presents itself, not
just depth, and it had been there since S2 shipped the first cycle.

Worth noting for the next session: I built five DBG cycles across this gauntlet
specifically so aesthetic calls could be settled by looking, and did not notice
until S10 that they were reshuffling the sample between A and B.

### Iteration 9 — S9 (dither removed; region edge faded)

Two user-reported regressions, both mine, both from this gauntlet.

The dither: measured well, looked worse, removed. The lesson recorded above is
that S8's metric was built on an assumption it could not test — it scored
coherence as the defect, and coherence turned out to be the desirable property.

Checked the frame pacing before rewriting anything, since a variable substep
drain would have been a second cause: per-rendered-frame camera delta at
constant velocity has cv 0.18 at low speed, driven by rare 4-substep frames.
Real but secondary; quantisation is the primary cause.

The realisation that unlocked the fix: S4 removed every `drawImage` from the
star path, so fractional positions stopped being a cross-browser risk two
milestones ago and nobody noticed.

Region popping: fixed with a faded edge rather than by turning the feature off.
The dismissal in S7 ("imperceptible at 24 000 stars") was wrong about how
peripheral vision works.

Three test assertions changed meaning, all authored by this PR: the whole-pixel
audit now checks crisp is integral AND that smooth is genuinely fractional (a
silently-snapping "smooth" mode would be a lie), and a new test pins the fade
ladder is ordered and reaches near-invisibility. One test timing bug of mine was
fixed before landing: reading `__omniStats` in the same tick as a DBG cycle
returns the previous frame's payload.

### Iteration 8 — S8 (the low-speed jitter)

Ruled out the camera first (hard snap, no lerp; world entities draw fractional),
which left the star field as the only quantised thing in the frame — and the
quantisation was mine, from S3.

Built `perf/starfield-motion.mjs`. Two things went wrong with it before it gave
a usable answer, both recorded above: the first metric measured the whole field
and was diluted to invisibility by 240 layers, and the first before/after run
was contaminated by the player dying mid-sweep (a stationary camera reads as a
stuck field). Fixed both, then the artifact and the fix were unambiguous.

Shipped the per-star sub-pixel dither, ON by default, with a DBG toggle so the
A/B stays available — and a test pinning that stars still land on whole device
pixels in BOTH modes, since that is the S3 result this could have quietly
undone.

Also fixed the two `perf/starfield.mjs` call sites that still used the pre-S7
`renderStars` signature, and its header comment, which had gone stale describing
band canvases that no longer exist.

### Iteration 7 — S7 (non-uniform density by map region)

Evaluated the flow field first, since the request named it: rejected on three
counts (direction not density, mutates with gameplay, couples the backdrop to a
gameplay system), with the reasoning written into the code beside the
replacement.

Built `perf/starfield-regions.mjs` to visualise the field, and it earned itself
immediately: the first draft's `scale` multiplier gave every wave vector a
common factor, tiling the field 2x2 across the map. Invisible in any single
screenshot; obvious the moment the whole field is printed at once. Wave vectors
are now chosen per step with no common factor, and a test pins it by requiring
half-map offsets to differ.

Two test assertions of mine were wrong before they landed: the seam check
hardcoded a 4000-unit period instead of reading the live map size, and the
"never empties" check measured the per-GROUP minimum, which legitimately rounds
to zero for a rare-colour group holding three stars. The second now measures the
whole field, which is the quantity that actually matters.

### Iteration 6 — S6 (spend the savings)

User asked for the dense sky back plus more parallax depth. Density default
185 → 729, layer count 60 → 240, both as DBG cycles; layer count became a cycle
rather than a constant for the first time, since it was only ever frozen by the
memory cost that S4 removed.

Measured before choosing, and the measurement changed how it was reported: at
729 the sky has the pre-gauntlet star COUNT but a quarter of its ink, because
the old stars were antialiased smears and the new ones are single crisp pixels.
That is worth saying out loud, because "the same number as before" and "looks
the same as before" are not the same claim here.

One test assertion of mine was wrong and got fixed: it required the realised
density to land at or BELOW nominal, on the assumption that per-layer integer
rounding always rounds down. At 240 layers it rounds up (24 000 stars against a
nominal 23 996). Replaced with a symmetric ±1% bound, which is what the code
actually guarantees.

### Iteration 5 — S5 (docs + validation)

Three stale comments fixed rather than the two the brief named — `render()`'s
`effectiveDpr` note had gone stale the same way and now also documents the
second reason the capped ratio matters, which S3 created. CLAUDE.md §2 and §8
synced. Checked the two parallel PRs: base unmoved, no overlap in the files
that carry the substance. Declined the conventional standalone rebuild (D13).
Three gates run twice, consecutively, green both times.

### Iteration 4 — S4 (memory and draw calls)

Measured first: added `--bench` to `perf/starfield.mjs`, which A/Bs the two
structures against the same context. Direct drawing won 6–25× on time and
4 400× on memory, so the band canvases went.

`BackgroundManager` now holds stars as sorted typed arrays and draws them in
one batched pass; `renderStars` is a hoisted method rather than a per-frame
closure. The milky way folded in as the last depth layer.

Two tests added — the no-canvases structural invariant, and a PARALLAX test.
The second is there because S4 rewrote the scroll arithmetic and a static sky
is invisible in a screenshot; it asserts the layers move, that near layers
outrun far ones, and that every offset stays inside its wrap window.

Three assertions in the existing suite changed meaning legitimately: `bands`
counts depth LAYERS and there are now 61 rather than 60 (the milky way became
one), `starCount` is the product over the 60 depth bands rather than over all
layers, and the band-canvas dimension checks became device-pixel scene checks
because there are no band canvases left to measure. All three are assertions
this PR authored, and each changed because the thing it described changed.

The probe needed the same treatment: it read `bg.starBands`, which no longer
exists. Density and footprint are now measured by rendering the field once
into a scratch canvas and counting what landed — strictly better than the old
per-band sampling, because it measures the composed field the player sees,
overlaps included.

### Iteration 3 — S3 (kill the resampling)

Device-resolution bands; integer star placement and integer device sizes;
identity-transform 1:1 blit at rounded device offsets; `sceneDpr` added to the
rebuild guard so a render-scale cap change regenerates the bands (without it
the blit silently stops being 1:1 — the defect returning through a different
door). `STAR_SIZE_CYCLE` DBG knob under Visual. Dead `size < 1.5` arc branch
removed from both star loops — S1 proved size tops out at 1.17 CSS px.

`perf/starfield.mjs` gained the real-path `BLIT_PROBE` and lost two
instrument defects (see above): a counterfactual presented as a measurement,
and a device-px-over-CSS-area units bug in the density column.

Two tests added and one existing assertion changed. **The changed one:**
`bandCanvasW === 1000` became `=== round(1000 × sceneDpr)`. Its meaning
legitimately changed — band canvases are DEVICE-resolution as of this
milestone, so the old assertion was only right by coincidence at dpr 1 and
would have been wrong the moment the suite ran at any other ratio. It is also
an assertion this PR authored two commits earlier, not a pre-existing one.

### Iteration 2 — S2 (density derived from area)

`STARFIELD_CONSTANTS` + `STAR_DENSITY_CYCLE` in `constants.ts`;
`BackgroundManager.initContent` derives its budget from area and the milky way
from width; `invalidateContent()` + a `RenderSystem.invalidateBackground()`
pass-through so the DBG cycle takes effect without a resize; DBG row under
Visual. New suite `tests/starfield.spec.ts`.

One test assertion was written too tight and corrected before it landed: an
exact `round(density) === 185` fails at 184.1, because the budget is split into
a whole number of stars per band. Replaced with a within-1%-and-never-above
bound, which is the honest statement of what the code guarantees. No product
behaviour changed and no pre-existing test was touched.

Measured after: density ratio phone-vs-desktop 3.95× → 0.96×. Memory and draw
calls deliberately unchanged — 80.3 MB and 244 draws/frame are S4's subject,
and moving them here would have confounded the density measurement.
