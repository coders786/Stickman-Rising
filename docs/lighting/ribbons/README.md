# RibbonGI: rooftop light transport

`comparison.jpg`: incumbent above, replacement below. Look at the threshold: the deck receives a narrower amber reflection through the opening, not the old rectangular column and broad glow across the walls. The combat, camera, sky, exposure, poses and seed are fixed. `before.png` was captured before replacing the renderer; `after.png` is the new renderer at native resolution.

## How it works

The cross-section has world X, height and a small number of depth lanes. Stage lights have area, not just a centre. Project each rectangular emitter onto the lane containing the opaque doorway wings and visible roof fixtures. Merge overlapping blocker intervals into a disjoint skyline and subtract the covered aperture area. Partial coverage produces penumbrae. Bake that visibility times distance attenuation into a byte grid local to each light, plus a filtered ground row for approximate first-bounce colour. Separately bake each wet-deck receiver strip with visibility, incidence and a rough specular response; pack the strips into one canvas. Flicker isn't baked: a gain per emitter per frame modulates both receivers and the shafts.

Moving actors bilinearly sample their visible lights once before the shadow pass; the material consumes accumulated RGB and a direction rather than the strongest emitter's tint. The strongest visible **non-city** source can still cast a posed secondary shadow. The moon, airborne contact shadows, city art, existing reflection pass and controlled impact accents are intentionally separate. This is a CPU/Canvas2D approximation for this stage: no GPU RT requirement, arbitrary-depth geometry, actor-to-actor ray-traced occlusion or multi-bounce path tracing.

Conceptual reference: separate precomputed transport from changing illumination, as in [3](https://www.microsoft.com/en-us/research/publication/clustered-principal-components-precomputed-radiance-transfer/). Here the basis is the small known set of local emitters, not spherical harmonics.

## Two comparisons

**Edge walk** (`node --import tsx .qa/compare-ribbons.mts`): compare scalar direct energy against an independent 768-ray aperture sweep at 5,883 positions, including 1,022 partially obscured receivers. This tests the doorway model, not photographic accuracy. Error is absolute in units of nominal source energy. Bytes are per test emitter for actor transfer, excluding deck atlas.

| Grid spacing (horizontal px) | Mean error | P95 error at partial coverage | Bytes |
|---:|---:|---:|---:|
|20|0.0303|0.1811|748|
|10|0.0084|0.0744|2,747|
|5|0.0045|0.0420|10,507|

10 px is the selected balance for cast-shadow tiers. Halving it again costs almost four times the storage. Contact-only tiers use the coarser bake. A lookup sweep at 10 px took 0.83 ms versus 92.2 ms for the offline ray reference in this run; that is a one-light microbenchmark, **not** a game speedup.

**Whole scene** (`SR_TIME_CAPTURE=1 node --import tsx .qa/capture-fighters.mts /tmp/after.png`): identical Ultra 1000×520 DPR1 native Canvas2D fixture, 4 warmups then 20 complete frames including readback. Cold bake is excluded. Median / p95: **22.3 / 37.5 ms before**, **21.3 / 24.2 ms after**. Small sample, one CPU raster backend; not evidence of a guaranteed frame rate on a phone or GPU. The separate Chromium smoke exercised live Ultra gameplay with two enemies and no frame errors.
