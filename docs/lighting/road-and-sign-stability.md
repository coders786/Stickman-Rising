# Road reflections and sign lighting: root-cause notes

The road, signs and post effects run in Canvas 2D; the GPU baker supplies sky artwork, not the road's lighting. To separate rendering defects from storm flashes and combat effects, the diagnostic frames froze their clock, seed and light output and moved only the camera or a test emitter.

| Symptom | Cause | Repair |
| --- | --- | --- |
| Reflected strips and the glow from thin sign strokes blinked during small pans, including at high DPR. | The capture and bloom buffers used the default Canvas 2D filter while shrinking the source by several pixels per sample. An emitter could land between samples and contribute nothing. | Prefilter both captures; render and sample against the same rounded backing-store dimensions. |
| A reflection slid away from its source during tilt, zoom or clipping. | Viewport clipping shortened the source strip but stretched the result to the full road band. Zoom changed the buffer's row count, and zero roll used a different capture path from nonzero roll. Moon glints also cut out based on the unrolled lane coordinate alone. | Use a fixed world-depth projection, one inverse-roll transform, and overscan sized for the viewport diagonal. Keep the buffer size independent of camera motion and clip the glint to the actual asphalt. |
| Sign accents and glints could disappear as another fixture came into view. | The animation budget picked the first *visible* records; a vent or bulb could also leave additive blending active for the next sign. Near signs were held inside the slow sky cache, and the Ultra post pass gave the practical with the strongest weight only the difference over its runner-up. | Admit a fixed set of records per tile, set each record's blend mode, and draw the mid and near art with the current camera. Give each practical its own fixed share of the eight ray taps. Gradual neon modulation replaces hard tube dropouts. |
| The road suddenly lost a light pool when the performance governor shed a tier. | The steady contribution was part of an optional live overlay, and a desktop drop to Medium also switched from local to capture reflections. | Bake the steady practicals into the asphalt; only modulation consumes live light-pool slots. Keep local and capture routes independent of the tier's actor top-light setting. |

## Evidence and checks

- Chromium, 480 × 300: a two-CSS-pixel emitter swept through 64 quarter-pixel offsets. At DPR 2, High's reflection had **31 blank frames before, zero after**; Medium, High and Ultra had **zero after** at DPR 1 and 2, both with and without a small camera roll. A separate three-pixel emitter's Ultra bloom went from **18 blank frames to zero** at DPR 2.
- Moving the viewport edge without clipping the emitter moved its reflected centroid from **15.9 to 40.4 px** below the lane before the fix. With the same fixture it stayed within **0.4 px** across the tested clip positions. The reflection buffer retained its size across the zoom sweep.
- Live Chromium smoke runs panned and changed tier and viewport size on the fine-pointer (local reflections) and touch (capture) paths. Both entered gameplay and rendered without page or game-loop errors. This is render validation, not a frame-rate claim for physical devices.

```sh
node --import tsx --test tests/{layer-seams,fundamental-lights,world-lights,viaduct,ultra-stack,impact-focus}.test.ts
```

## The warm bridge is base lighting

The player's first image is the warm reference. In the darker image the skyline and lower city changed much more than the steel fascia. Different camera positions and combat states make the road in those stills unsuitable for a pixel-for-pixel comparison.

A matched Chromium render reproduced the change with the seed (`0xbeef`), camera, time and output scale held fixed and no lightning or impact flash. The weather tint covered the whole city, but switched off in clear weather and at Low. A separate tier gate removed the light rising behind the rail. Even a normal 9-second haze-to-clear transition produced three visible opacity steps, each dropping about **7 red levels** in the sampled lower city.

| Forward route, DPR 1.25 | Façade RGB before | Façade RGB after | Below bridge before | Below bridge after |
| --- | --- | --- | --- | --- |
| High + haze (reference) | 52 / 50 / 49 | 52 / 50 / 49 | 45 / 40 / 41 | 45 / 40 / 41 |
| High + clear | 32 / 40 / 47 | 52 / 50 / 49 | 25 / 31 / 39 | 45 / 40 / 41 |
| Low + haze | 29 / 38 / 46 | 52 / 50 / 49 | 25 / 31 / 39 | 45 / 40 / 41 |

Deep Noir now draws the reference's warm air behind the bridge in every weather band and tier. The city bounce has one strength instead of using a second, cooler haze layer at Ultra. The road bakes its sky sheen alongside the steady fixture reflections, and tiers that still draw a moving mirror vary its resolution rather than its gain. Rain, moving fog, wetness response, splashes and lightning still work. Low keeps the baked road light but omits the optional moving mirror.

The matched checks covered all tiers, both optics routes, DPR 1.25/2 and four weather bands. The warm reference was retained, and the sampled lower city no longer stepped during the weather fade. Live Chromium checks also fed slow and fast frame samples to the actual governor to drive Ultra → Low → Ultra, including backing-store changes, on both desktop and touch routes. Those were controlled transition checks, not real-device performance measurements.

```sh
node --import tsx --test tests/{layer-seams,weather,fundamental-lights,world-lights,viaduct,ultra-stack,impact-focus}.test.ts
```
