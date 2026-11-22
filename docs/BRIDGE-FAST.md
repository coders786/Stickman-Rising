# Bridge download and frame-time update

This is an earlier optimization pass after the [first-frame contract](BRIDGE-HANDOFF.md) and [Canvas pacing work](BRIDGE-PACING.md). The current [opening contract](GAME-LOADING.md) now waits for glazing and checks the renderer’s cadence while covered. The timings below predate that change.

## Release payload

`public/bridge/baked-v1/` contains a tagged, byte-linear format. The producer splits components into rows and delta-codes each row before Brotli. HTTP supplies `Content-Encoding: br`, so the browser handles decompression. The client checks the tag and exact length before undoing the predictor. These are numeric signals, not sRGB or premultiplied image pixels.

| Asset | Previous body | New body | Verification |
| --- | ---: | ---: | --- |
| Lunar surface, cloud volume, horizon and city masks | 421,109 B | 247,289 B | All 1,282,048 signal bytes match |
| Deck mask | 390,660 B | 32,558 B | Send the 212,992-byte drainage channel; reconstruct the other channels to exactly the prior 851,968-byte RGBA mask |
| Optimized grades | 48,036 B | 13,006 B | All four 16³ grades match |
| HDR grades | 356,963 B | 58,670 B | All four 32³ grades match |

WebGL now samples the four grades as trilinear volumes instead of interpolating between two strip samples per lookup. Both renderers use the existing `l1.webp` and `l2.webp`; there are no browser downloads for KTX variants. HDR builds its same-family ripple detail locally. The retired sky and glazing versions are not shipped. Glazing v2 itself is unchanged. The shell uses system fonts, so first visit does not need the two font files. These changes reduce transfer and duplicate source art; WebGL can use more texture memory than the old block-compressed skyline on devices that supported that format.

`npm run art:bridge-lighting` and `npm run art:bridge-packed` generate the release packs. `art:bridge-ktx` is an optional offline comparison, not a release build step. Bump the `baked-v1` directory when changing immutable data. A delayed pack is distinct from a denied one. Invalid or missing packs use the local deck/look or procedural sky, and missing skyline cards retain the Canvas backdrop.

## Where frame work changed

- The opening raster planner schedules the visible/center plates before offscreen neighbours. Worker handoff, generation checks, and the same-run optical window guard remain. The receiver bake skips repeated lookups and unnecessary ridge work. The 16 paired regression fixtures produced identical optical-window and Canvas-plate hashes.
- Canvas skips backdrop overdraw only inside the proved opaque road band, with an edge/roll guard. It reuses atlas addressing and elevation-only math across sky/mist pixels. Slow sky changes use four slices of a single captured optical pose; the finished bank and lunar patch publish together at their full previous resolution. Initial paint, resize, restored backing, asset arrival and flash changes repaint immediately. The gameplay weather and light clock still tick independently.
- First-use desktop starts on **Medium / Adaptive Resolution**, at native scale before adjustment. Low remains the conservative starting preset on small touch displays. Sustained slow foreground frames can shrink the backing sooner, without switching an admitted HDR renderer merely because the adaptive scale falls. Explicit presets still lock their detail and scale target, saved preferences are respected, and adaptive scale does not shrink the HUD.

## Measured on the production builds

Control `mPsKToiSEc-lpcwo0naSY`; update `cVsElmZ6KRiOXYXBQhqXH`. The following are response bodies, not in-process worker buffers:

| Cold fixture | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Canvas menu ready | 691,595 B | 541,608 B | 22% |
| Canvas first play | 1,517,049 B | 1,193,278 B | 21% |
| WebGL2 Optimized first play | 2,667,161 B | 1,238,842 B | 54% |
| WebGL2 HDR first play | 2,981,668 B | 1,284,506 B | 57% |

| Foreground Canvas travel | FPS before → after | rAF p95 (ms) | rAF p99 (ms) | JS p95 (ms) |
| --- | ---: | ---: | ---: | ---: |
| Fresh desktop, 1180×660 viewport | 24.4–25.4 → 49.9–50.8 | 50.1 → 33.4 | 50.1–66.6 → 33.4–50.0 | 12.3–12.6 → 7.0–7.6 |
| Locked Medium, 1180×660 backing | 35.6 → 38.7 | 33.4 → 33.4 | 50.0 → 33.4 | 11.8 → 7.5 |
| Locked Medium touch, 400×844 backing | 58.0 → 59.6 | 16.8 → 16.8 | 33.4 → 16.8 | 10.6 → 5.9 |
| Locked Ultra, 1475×825 backing | 25.3–25.6 → 23.8–28.0 | 50.0–50.1 → 50.0–66.7 | 50.1 → 50.1–83.3 | 11.5–11.7 → 6.9–13.4 |

Two serial pairs for fresh and locked Ultra, one pair each for Medium and touch. Each measures 144 callbacks after a 36-frame warmup. The fresh run changed the default preset as well as the amount of work; it was not a same-quality comparison. Fresh runs saw 9 and 10 gaps over 50 ms in the control and none in the update. Locked Ultra was variable; the app is **not** guaranteed to run smoothly at 1.25× on this software compositor. A matched 680×425 SwiftShader run had 2.27 → 2.32 FPS; it is useful for shader/readiness diagnostics, not a hardware performance claim.

In the fixed 24-frame Canvas fixtures, median complete submit went from **10.7 → 4.9 ms** on a pan and **13.9 → 7.6 ms** with changing weather. The settled captures had identical alpha; mean absolute RGB differences were 0.006, 0.049, and 0.006 of an 8-bit code for parked, pan and weather. The two locked desktop Ultra preparations took **705–748 → 583–645 ms** from Engage to tick-zero submit. Their maximum Canvas raster-job times were **320–357 → 263–264 ms**. These are observed sample ranges, not a universal load-time or frame-rate guarantee.

On one cold cross-origin embed pair throttled to **150 ms / 1.5 Mbps**, Engage became available in **4.41 → 3.73 s** from navigation. Engage to the actual first world submit took **4.64 → 3.48 s**. This was the local browser throttle, not a public proxy test.

## Release checks

- **226/226 Bridge tests** passed and **17 exact GLSL ES 3.00 programs** linked offline. The full suite passed **610/615**, with the same five pre-existing combat and animation failures as the control.
- Real browser runs covered the desktop/portrait opening and Retry, reduced motion, held deck, shader/grade/city/fence holds, denied and malformed packs, resize/cancel, and GL context loss. The GL hold test opened with four projected panes while the glazing atlas was still held; those panes received the baked art after release. On the Metro and Market glazing probes the divider and occluder leak counts stayed at zero.
- Frozen warm and cool HDR shots retained identical Ronin poses and sampled light inputs. Actor-region mean RGB deltas were below 0.08 code values, with zero >5-code lighting-ablation pixels outside the silhouette plus two pixels. The whole HDR frame is not pixel-identical: the shared skyline WebPs differ locally from the prior native block-compressed textures.
- The promoted preview serves the verified standalone build. Raw pack bodies, Brotli and immutable headers, embed and trusted touch controls passed on port 3000. The previous build remains intact as the comparison stage.

[Measurement and verification receipt](../research/bridge-fast/verification.json)

## Reproduce on a production build

Build and copy `static` and `public` into an isolated standalone stage as in [Game loading](GAME-LOADING.md). Set `SR_QA_URL` to the build being tested and run the control/candidate in serial, without builds or tests competing for CPU:

```sh
npm run check:bridge
npm run check:webgl:offline -- --require-compiler
node --import tsx .qa/slasher-pack-parity.mts <control-public-bridge-dir>
SR_SOFTWARE=1 node .qa/slasher-wire.mjs --cpu-compositor
node .qa/slasher-wire.mjs --cpu-compositor --gl
node .qa/slasher-wire.mjs --cpu-compositor --gl --optimized
SR_SOFTWARE=1 node .qa/slasher-pacing-replay.mjs --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-pacing-replay.mjs --cpu-compositor --fresh
node .qa/slasher-run-readiness.mjs --optimized --hold-glass
node .qa/slasher-run-readiness.mjs --lose
```

Wire comparisons count unique same-origin production response bodies associated with cold menu, Engage and early play requests, including worker scripts. They use actual HTTP compressed bodies rather than the browser's sometimes-zero Resource Timing byte fields. Headers, TLS, and proxy overhead are excluded. Pacing uses a real Engage, seed 42, +X travel and actual foreground animation-callback gaps. The locked preset replays the same 60 Hz simulation inputs on both builds; `--fresh` uses the real clock and fresh preferences. JavaScript submit duration is not presentation time. This headless CPU-compositor/SwiftShader QA does not measure physical GPU FPS or the public proxy.
