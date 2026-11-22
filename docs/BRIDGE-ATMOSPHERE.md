# Bridge atmosphere and graphics presets

The playable Bridge now uses the same sky geometry and optical model in WebGL2 HDR, WebGL2 Optimized and Canvas 2D. The [SACR v4 transport](BRIDGE-MASTER-V4.md) is still used for GPU road reflections and light transport; its older screenshots and menu labels are historical. The current tier-bounded blur, bloom, gloom and grading graph is documented in [Bridge post-processing](BRIDGE-POSTPROCESSING.md).

## What changed

- **Moon:** An upper-left bearing is fixed for a run and agrees with the baked lunar key. Route travel, camera height, zoom, and roll cannot move the moon or change its phase. The circular limb and solar terminator are resolved analytically; the relief atlas supplies craters, basalt plains and ejecta. The dark limb hides stars, not the airglow in front of it. Nine lit-area samples of the same extinction field drive the lunar key for the world, actors and casts. The visible disc itself uses local transmission at each pixel, not that average.
- **Clouds:** High cirrus and the storm bank do not parallax with the camera. They move at different rates with the integrated front wind and slowly change shape with two baked evolution fields per deck. The bank bakes seven depth samples into column mass, light-facing relief and the interior lightning response. Sheet lightning lights those volumes, with falloff in optical units rather than a stretched viewport-space overlay. Portrait and landscape use the same units on both axes. Reduced motion stops advection, cloud evolution, and flashes. Only the low mist and skyline retain depth parallax.
- **Fog:** Exponential extinction reduces the contrast of the far buildings more than the near ones, with less fog at higher elevations. A separate wind-driven mist field sits between the distant skyline and the rail. Shelters, roadway, fighters and HUD are composed in front of it; there is no full-frame fog tint.

The game requests `public/bridge/baked-v1/sky.bin.br` (**247,289 transfer bytes**). HTTP Brotli plus the [lossless row predictor](BRIDGE-FAST.md) restore **1,282,048 bytes** of ground-up, linear RGBA8, byte-identical to the v5 basis. The payload contains a 160×160 lunar atlas, two 640×144 cloud slabs plus a guarded 160×44 evolution tile in their texture, three 256×64 horizon strips, and 256×60 / 256×70 city masks. `npm run art:bridge-lighting` reproduces the shipped file. The live sky and GPU puddles sample the same radiance cache; it extends above the visible crop so steep rays do not stretch the top row. Alpha carries mist opacity. The disc-sized detail patch does not require another full-size pass or a frame readback.

| Path | Landscape cache | Portrait cache |
| --- | ---: | ---: |
| WebGL2 HDR (`master-webgl2`) | 256×88 RGBA16F | 160×144 RGBA16F |
| WebGL2 Optimized (`mobile-webgl2`) | 160×56 RGBA8 | 96×96 RGBA8 |
| Canvas 2D (`mobile-canvas`) | 192×80 raster | 104×128 raster |

Optimized WebGL2 refreshes on alternate submits and immediately on a changed flash, seed, target, or motion preference. Only its cache RGB is companded. Canvas uses the same optics with a small local detail patch and bounded mist/city compositing; color grading and wet response are not pixel-identical to WebGL2. Missing atlas bytes still admit a procedural moon, clouds and haze.

## Settings

The choices are **Low** (0.75×), **Medium** (1.00×), **High** (1.15×), and **Ultra** (1.25×). These are scale targets, not renderer names. Ultra requests HDR when possible. Paused Settings shows the renderer and backing of the last rendered frame separately. Choosing a preset locks the target; Adaptive Resolution changes scale only. The saved `low`, `medium`, `high`, `ultra` IDs and preference version 3 are unchanged.

## Verification

For the current camera lock and gradual evolution, see [matched optical captures](BRIDGE-PURE-LOOK.md#pixel-comparison). The receipts below describe the earlier atmosphere release.

[Clear](../research/bridge-atmosphere/hdr-clear.webp) · [Same camera, broken cloud](../research/bridge-atmosphere/hdr-broken-cloud.webp) · [Haze](../research/bridge-atmosphere/hdr-haze.webp) · [Portrait sheet lightning](../research/bridge-atmosphere/optimized-flash.webp) · [Canvas haze](../research/bridge-atmosphere/canvas-haze.webp) · [Settings](../research/bridge-atmosphere/portrait-presets.webp) · [Build and readback receipt](../research/bridge-atmosphere/verification.json)

In the controlled live test, a half-covered moon retained **50.84%** of its phase-weighted light, versus **98.26%** in a clear column and **0.10%** under an opaque column. The visible lower patch stayed within one display code value of its clear value on all three renderers, while the covered upper patch dimmed. Heavy fog changed the visible sky but changed **zero** sampled dry pixels in the rolled shelter on all three paths. Both GL drivers read identical sky and road cache samples and had no GL errors. The missing-atlas case and reduced-motion freeze also passed. These are fixed-state Chromium/SwiftShader checks, not physical-device FPS benchmarks.

With the sole preview running on port 3000 and `SR_BROWSER_TOOLS` pointing to the browser tools folder:

```bash
npm run check:bridge
npm run check:webgl:offline -- --require-compiler
node .qa/slasher-atmosphere.mjs
node .qa/slasher-atmosphere.mjs --touch
SR_SOFTWARE=1 node .qa/slasher-atmosphere.mjs --touch --canvas
SR_SOFTWARE=1 node .qa/slasher-atmosphere.mjs --touch --canvas --deny-sky
SR_SOFTWARE=1 node .qa/slasher-quality.mjs --touch
```
