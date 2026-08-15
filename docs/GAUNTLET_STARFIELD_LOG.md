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
- [ ] **S5 — Docs + validation.**

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

**D5 — Split the budget evenly across bands and absorb the round-off in the
total.** Beat: giving band 0 the remainder. A remainder in one band makes the
furthest parallax layer measurably denser than the rest, which is exactly the
artifact the density work is trying to remove — and it would be invisible in
any aggregate check. Even split costs at most 30 stars of the ~6 000 budget.

---

## FOR-USER-REVIEW

- **S2 — the sky got much sparser on the phone, and that is the change.**
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
