# Gauntlet: the star field — density, resampling, and memory

Working ledger. One milestone per iteration; findings before changes.

Base: `claude/plan-completion`. Branch: `claude/starfield-density-resampling-qpp9dw`.

---

## Checklist

- [x] **S1 — Verify and measure.** Confirm or refute the prior session's four
      claims; capture density / star size / brightness / memory / draw cost.
- [ ] **S2 — Density derived from area.**
- [ ] **S3 — Kill the resampling.**
- [ ] **S4 — Memory and draw calls.**
- [ ] **S5 — Docs + validation.**

---

## The instrument

`perf/starfield.mjs` (new). Follows the `perf/` conventions — port 4183, TCP
readiness probe, the same mulberry32 seed the capture matrix installs, so two
runs build the same sky and a difference in the pixels is a difference in
rasterization rather than in the seed.

It reports four things, and they are not worth the same:

| measurement | how | worth |
|---|---|---|
| structure — band count, canvas dims, backing-store bytes | read off the live `BackgroundManager` | exact, browser independent |
| density — lit source pixels per band, per 10k CSS px² | `getImageData` over the band canvases | exact |
| resampling — device pixels lit + luma histogram | replays the real blit at integer vs fractional offset, reads back device pixels | exact per engine; see the WebKit caveat |
| draw calls | wraps `drawImage` on the live render context for 60 frames | exact |

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

---

## FOR-USER-REVIEW

*(S1 raises nothing to decide yet — it is measurement only. S3's visual call
lands here.)*

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
