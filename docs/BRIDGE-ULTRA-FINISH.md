# Bridge · Ultra lighting

Choose **Settings → Ultra**. The new finish runs when **Last frame** in paused Settings reports **WebGL2 HDR**. Ultra still falls back to **WebGL2 Optimized** or **Canvas 2D** when HDR allocation, resolution or hardware does not allow it. The selected preset and the actual renderer remain separate.

[Before/after comparison](../research/bridge-ultra/lighting-comparison.webp) · [Verification receipt](../research/bridge-ultra/verification.json)

## What changed

- **Soft shadows, not a soft image.** In Master, a projected capsule edge now integrates a bounded penumbra that grows with the receiver-to-caster distance and the light's apparent size. Live strikes use their admitted core width and distance; the moon and baked practical directions use different effective apertures because those packed directions do not contain a source radius. Foot contact remains a separate kernel. A shadow only subtracts from the light that cast it.
- **Damp pavement is not a puddle.** A thin film darkens the asphalt and returns a broad, low-energy sheen from visible fixtures and sky. In the basins the underlying grain gives way to a smoother normal and a sharper SACR section reflection. The old periodic highlight stripes and chromatic splitting are gone on Ultra. Drizzle and partial pool coverage transition smoothly; a covered pixel has neither a wet film nor a pool trace.
- **Light blends locally.** Shaded surfaces get a small sky and colored fixture bounce. A bounded humid-air scatter term uses the existing baked fixture field and is composited behind opaque bridge geometry. The HDR bloom knee rolls in above display white, admits saturated HDR arcs, and keeps the wider halo subordinate to the bright core. The renderer still composites the original sharp scene and paints the HUD separately.

These are real-time approximations in the Bridge's 2.5D lighting model, not ray-traced global illumination. The [SACR contract](../IMPORTANT.md), streamed texture formats, source limits and dry geometry are unchanged. No new passes or framebuffers were added; the road uses the same local visibility result for its diffuse and specular lobes.

| Matched scene | Before | After |
| --- | --- | --- |
| Night pavement and warm/cool fixture spill | [Control](../research/bridge-ultra/before-lamp-rain.webp) | [Ultra](../research/bridge-ultra/after-lamp-rain.webp) |
| Lightning core and its surface return | [Control](../research/bridge-ultra/before-strike.webp) | [Ultra](../research/bridge-ultra/after-strike.webp) |
| Rolled service bay with dry floor | [Control](../research/bridge-ultra/before-eaves.webp) | [Ultra](../research/bridge-ultra/after-eaves.webp) |

## Checks

Seed 42, identical poses, weather, render scale and camera on the Metro control and Ultra builds. The matched frames stayed at **1060×650**, **9,335,816 target bytes** and **16–17 draws**. The driver compared a `.0401 m` practical shadow half-width near the capsule with `.202 m` farther away, and `.49` roughness on damp aggregate with `.08` in a deep pool. The bloom prefilter returned zero at display white; the upsampling stage preserved a constant input.

Changing only wetness left all **24,930** covered Master samples unchanged, including **411** in the first two world pixels of the rolled eave. Optimized stayed dry too. Receiver and blocker checks passed on HDR, Optimized and Canvas. Denying the HDR framebuffer selected Optimized; losing the live context selected Canvas until HDR was restored.

The production build, 17 offline ES 3.00 links, 16 browser-driver readbacks and **190/190** focused Bridge checks passed. The broad suite passed **574/579** with the same five existing combat/animation failures as the Metro control. The browser check used ANGLE/SwiftShader for correctness, not to measure physical-device FPS.

To reproduce against a running production build with the [browser launcher prerequisites](../.qa/bridge-browser.mjs):

```sh
SR_QA_URL=http://127.0.0.1:3000/ node .qa/slasher-sacr.mjs --compact --force-gl --driver-only
SR_QA_URL=http://127.0.0.1:3000/ SR_SHOTS=.cache/ultra-finish/after \
  node .qa/slasher-ultra-finish.mjs --verify-optics
SR_QA_URL=http://127.0.0.1:3000/ node .qa/slasher-bridge-finish.mjs --v4
npm run check:bridge
npm run check:webgl:offline -- --require-compiler
```
