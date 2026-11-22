# Wet Bridge water and full-scale Ultra

Historical comparison: the [Practical Optics follow-up](PRACTICAL-OPTICS.md) kept the baked wet road and retired the live relay from gameplay. These results describe the earlier revisions.

[Matched water comparison](../research/water-relay/before-after.jpg) · [Absolute Ultra portrait fight](../research/water-relay/absolute-ultra-portrait.jpg) · [Replay receipts](../research/water-relay/verification.json)

## What is baked, and what is drawn live

- **Baked material, including on Low:** The road's seeded depressions and cross-ruts distinguish rough asphalt, a thin water film, and deeper pools. The shallow viewing angle strengthens the sky return. Ripples warp silhouettes and catch small highlights along pool edges. The rail interrupts the sky; the lamp, beacon and sign reflect from their real fixture sprites, including the pale lens and inverted sign strokes. This lives in the existing span beneath lane paint and drain covers. No extra static road image is fetched or retained. Permanent light spill and the dynamic receiver use the same moisture field.
- **Live pose relay:** Medium through Ultra send the same interpolated skeletal outline used for grounding into a 52-world-pixel-deep water strip. It warps away from each fighter's contact with the lane, then fades against the road's puddle mask. The strip is redrawn from the current poses, not cached across frames. It is composited once under the actors, before screen overlays. Dynamic rain, splashes and moon glints still draw; combat flashes, warning icons and the HUD are not treated as reflection sources. Both render routes use this path. Ultra retains the full outline, shadows, shafts and its 2.25× scene backing.
- **Hidden-row rejection:** At the exact rolled world camera, skip rows of sky that the opaque deck will completely cover. Farther sky layers also stop behind the opaque lower district. Leave a guard for filtering and don't reject road-covered rows when a span end is exposed. The camera, sky parallax, baked surfaces, and visible pixels did not need changing. The distant cache itself is not cropped or enlarged.
- **Dry Station:** No water plate, live water strip, capture or outdoor weather. The opaque-row test applies to its slab as well. The ungraded diagnostic scene still has the legacy mirror/capture path; the two game stages do not read their scene canvas for any reflectance, bloom, or rays.

The optimization is the pose relay and removal of hidden draw work, not another bake or a change to the quality governor. The stronger static image does add work during the seeded Bridge build. Three small fixture pixel arrays are read from generated sprites once per mounted stage and reused across retries. The only new live backing is one CSS-width strip with rotational overscan (`1171×52`, 240 KiB page-rounded at 1000×560); both viewport sizes and the absence of any legacy mirror store are checked in the receipts. Low frees it. The same slot survives pan, roll, zoom, weather and Retry; destroy releases it.

## How we measured

Three alternating before/after pairs per fixture in headless Chromium 153, GPU disabled. Seed 42, the same settled drizzle and 10-enemy crowd, fixed sim input clock, 36 warmup frames and 90 measured actual rAF intervals. Output stayed `2250×1260` for a `1000×560` desktop viewport and `877×1899` for a `390×844` portrait viewport (floored backing sizes at 2.25×). There were no pass wrappers, readouts, pixel captures or state traces in the pacing trials. Timings are per-run percentiles summarized by the median, in milliseconds; **lower is better**. These are not presented frames or a guarantee of FPS on a particular device.

| Fixture, locked Ultra | p95 rAF interval | p99 rAF interval | p95 main-thread submission |
|---|---:|---:|---:|
| Desktop viewport, forward route | 149.9 → 116.7 | 183.3 → 150.0 | 25.6 → 24.1 |
| Desktop viewport, capture route | 150.0 → 133.3 | 183.3 → 150.0 | 111.4 → 24.4 |
| Portrait viewport, capture route | 83.3 → 83.3 | 100.0 → 83.4 | 57.9 → 15.9 |

The desktop intervals improved on both routes. Portrait's p95 did not move; its p99 and submission cost improved. The baseline forward outlier run had four intervals above 250 ms; none did after the change. There is still considerable raster cost at 2.25× in software. Bridge's synchronous seeded build in these same fixtures took roughly 0.62–0.65 s before and 0.77–0.83 s after (medians): the added water detail is a load-time tradeoff, not a startup improvement.

**Separate instrumentation:** the desktop and portrait capture routes each went from 90 scene-canvas samples per 90-frame window to zero. Forward was already zero. On the desktop capture route the old mirror hook averaged 75.15 ms of charged submission per frame, including deferred scene work flushed by the sample. The new strip's present hook averaged 1.09 ms (plus pose writes in grounding). Retained offscreen backing estimates went from 24.05 → 24.26 MiB for desktop capture and 22.23 → 22.40 MiB for portrait capture; there were no remaining tracked stores after teardown. Those estimates exclude scene/HUD outputs and do not measure GPU memory.

**Matched stills:** the lamp, sign, wet portrait fight, and dry Station fight shared the same weather, camera travel, full sim digest and byte-identical HUD. Across the entire dry scene image 18 colour channels rounded by one value, with no visible water effect. Native tests also check that a moved/jumping pose moves the virtual image, that roll cannot bleed it onto the fascia, and that occlusion preserves visible sky at span ends.

## Preview and lifetime checks

- The production preview passed Engage, controls, pause/restore, and Retry on desktop and touch. The quality smoke checks locked the scene at 2.25× with unchanged HUD backing and no reseed, restored Adaptive operation, and confirmed that the choice persists. Touch exercised the dry Station switch through Settings.
- Engage plus 20 deferred Retries passed in each of three fixtures: Wet Bridge forward, Wet Bridge portrait capture, and dry Night Station. No scene-canvas samples. The wet strip kept the same identity and size across retries (`759×52` on desktop, `954×52` in portrait); Station never created one. The old seed's canvases were zeroed and no tracked stores survived destroy.
- The production build, typecheck, boundaries, targeted lint and **112/112 focused tests** passed. The full gate was **487/492**, with the same five pre-existing combat/animation failures. [Preview and lifetime receipts](../research/water-relay/preview-checks.json).

## Repeat the checks

```sh
# Use a frozen pre-change src tree, not only the Git base; the snapshot also
# includes the previous uncommitted loading and lighting improvements.
# Configure SR_BROWSER_TOOLS (puppeteer-core and Chromium), or SR_BROWSER_EXECUTABLE.
bash .qa/slasher-water-proof.sh "$PWD/.cache/water-relay/control/src" "$PWD/src"
node .qa/slasher-water-report.mjs
# The historical revision used tests/water-relay.test.ts. Current material checks:
node --import tsx --test tests/baked-wet-material.test.ts
node .qa/slasher-optics-retries.mjs --water-relay
node .qa/slasher-optics-retries.mjs --water-relay --capture
node .qa/slasher-optics-retries.mjs --water-relay --station
```

The control was the complete task-start `src/` on top of base `9d27d2b2`; tracked-patch SHA-256 `59d4b0ed1996c398fac6b688c4b9897278aaea4ba312aaf2f4ce7d6d4313c20e`. Raw runs and source snapshots live in ignored `.cache/water-relay/`; the reduced receipts and review boards are retained in `research/water-relay/`.
