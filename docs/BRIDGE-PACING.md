# Bridge Canvas pacing

Follow-up to the [first-frame and recovery update](BRIDGE-HANDOFF.md). This pass reduced work in the complete Canvas renderer without changing the SACR v4 packet, optics, lighting budgets, simulation clock, or first-frame presentation contract. For the latest production packs, frame-time measurements, and first-run settings, see [Bridge download and frame-time update](BRIDGE-FAST.md).

## Less work for the same scene

The far and mid skylines used one mutable Canvas backing. Every frame rebuilt both cards into it, even when the camera moved only horizontally. They now keep separate bounded fog-graded cards. A pan still moves each layer at its own rate; a change in height, fog, decoded WebP, or backing validity repaints the affected grade. Moving window and storm light remain live. If the cards cannot be allocated, the skyline paints directly. The extra card costs 468 KiB of RGBA backing when admitted, and both are released on teardown.

The CPU sky and mist painters factor elevation-only attenuation once per raster row. The repeat-X atlas sampler also avoids division remainders at tile boundaries. The optical calculations are unchanged: the sky and mist Float32 buffers matched the prior hashes for the replayed desktop and portrait samples, including flash and missing-basis cases. An interrupted upload no longer marks the sky cache ready; a restored Canvas context repaints at the same clock.

### Measured Canvas work

Each row is a median of 24 submits per fixture and build. The QA used the packaged Chrome with its CPU compositor and a fixed camera/weather sequence, not a physical GPU benchmark.

| Complete Canvas submit | Desktop, prior → updated | Portrait, prior → updated |
| --- | ---: | ---: |
| Parked | 5.0 → 1.9 ms | 5.2 → 2.0 ms |
| Horizontal pan | 6.4 → 3.4 ms | 9.5 → 3.0 ms |
| Changing fog, height, and flash | 12.6 → 12.1 ms | 14.8 → 10.0 ms |

Parked and panning fixtures went from **48 card repaints to zero** after warmup. Changing weather still invalidated both cards. The portrait run with both skyline WebPs denied kept the procedural skyline and also skipped card repaints during the pan. Six matched frame captures differed by less than 0.005 of an 8-bit code value per channel on average; the receipt includes the worst individual channel deltas, too. This is visual parity for those fixtures, not a claim of pixel identity for the graded cards.

## The remaining browser stall

Using the prior production build, we varied the headless browser's Canvas2D acceleration, tile rasterization, GPU compositor, and process placement separately. CDP confirmed which backends each control actually used. Disabling Canvas2D acceleration still captured a **1.48 s** wait in the browser's widget teardown. Disabling GPU tile rasterization still captured **2.84 s**. Removing the packaged in-process renderer/GPU flags still captured **2.33 s**. The CPU-compositor trace did not have a comparable long teardown. Browser settings were changed only in QA; the app does not detect this user agent or ask for a browser-wide rendering flag.

In three alternating desktop runs per build, Engage reached 0.15 s of combat at a median of **1.94 → 0.40 s**, but the time to 0.45 s *after reporting rich-scene promotion* did not improve (**3.87 → 4.13 s** from the click; outliers still exceeded 5 s). Retry's 0.15 s median was **232 → 251 ms**. The headless stalls move relative to promotion, so the release claim is reduced application raster work, not a universal Engage or Retry speedup. A follow-up trace against the served build still captured a **2.95 s** widget teardown after a **61 ms** Engage submit. CPU submit and the next animation callback are not scanout. No conclusions about physical devices or the trigger of the original missing-arena screenshot follow from these traces.

## Verification and reproduction

[Measurements and validation receipt](../research/bridge-pacing/verification.json)

The preview now serves `hLSldMb6IE68_ReAWHBIU`. The staged and live roots matched; the preview Host/Origin, immutable chunks, and embedded boot passed locally. Trusted desktop and touch runs accepted Engage, Retry, jump, and movement after promotion. The sandbox did not measure the public proxy.

**205/205 Bridge tests** and **17 exact GLSL ES 3.00 program links** passed. The browser checks also exercised Canvas and WebGL recovery, the title horizon, weather, and denied sky/skyline assets. The full suite passed **589/594**, with the same five inherited sword and animation failures as the handoff build.

```bash
npm run check:bridge
npm run check:webgl:offline -- --require-compiler
npm run build:iso
node .qa/slasher-sky-pacing.mjs --cpu-compositor --expect-reuse
node .qa/slasher-sky-pacing.mjs --cpu-compositor --touch --deny-city --expect-reuse
node .qa/slasher-load.mjs --early --stages --input --promotion
node .qa/slasher-load.mjs --early --stages --input --gpu-info --cpu-raster
node .qa/slasher-load.mjs --early --stages --input --gpu-info --cpu-canvas
```

Set `SR_QA_URL` to the production build under test; see [Game loading](GAME-LOADING.md) for the browser tools. Omit `--expect-reuse` on the prior build. Set `SR_SHOTS` for comparison captures, or `SR_LOAD_TRACE` for Chromium user-timing, raster, and compositor events.
