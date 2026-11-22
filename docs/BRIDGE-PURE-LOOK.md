# Bridge: flat Ronin, rough glass, fixed sky

> This records the v1 look release. The [current Ronin finish](RONIN-LIGHTING.md) uses the original flat black paths without incident-light shading. The [v2 glazing](BRIDGE-GLAZING.md) supersedes the glass bake and readiness rule. The current loading scene is the [image-free Ronin reveal](NIGHT-CROSSING.md).

[Matched Ronin comparison](../research/pure-bridge/ronin-before-after.png) · [Storefront and sky comparison](../research/pure-bridge/glass-and-sky.png) · [Raw RGB measurements](../research/pure-bridge/pixels.json)

## What ships

- **Ronin:** One flat black ink color for the body, hands, hair, and scarf. The original rig still solves the pose, grip, blade sweep, feet, and supports. The ink uses those XY landmarks without lighting gradients, rim, or thickness magnification by Z. Steel and deliberate foreground effects stay separate. Master and Optimized recognize literal opaque black in the actor input in a bounded region around the Ronin. If nothing has been drawn in front of that pixel, grade writes exact display black instead of running it through the film toe and bloom. No new surface, draw call, or texture upload is needed. Edges still antialias.
- **Glass:** Each pane sees the ray from the eye to a virtual opposite-bank scene mirrored about its Z plane. Uncoated parallel glass with index 1.5 reflects about 7.7% head-on; its two-interface Fresnel return rises toward grazing incidence. The offline bake computes distance extinction, reflected sky and city radiance, and normalized roughness filtering in linear light, with separate open and occluded light endpoints. It also supplies the finite lens kernels. At runtime, the five admitted worker samples select the lighting between endpoints; the painter applies the pane's reflectance without increasing opacity as the light changes. Near projected solids replace far radiance and mask farther fixtures. Existing mullions, lamp housings, and catwalk cuts bound the actual return. The bright interiors dominate head-on; the glass does not depend on road wetness. Canvas approximates color blending in display space. No scene capture, new worker job, or pixel loop is needed for the glass.
- **Sky:** The moon, stars, cirrus, and storm bank use a fixed optical horizon for the viewport, independent of camera translation, zoom, and roll. The skyline and low mist stay at finite depth. High and low clouds still advect with the weather; two baked signed modes per deck slowly alter the local optical mass, with seeded continuous weights on the run clock. Reduced motion freezes both advection and evolution. GPU road rays still sample the same sky cache at their own elevation.

The release used the 896×1408 lossless `shop-return-v1.webp` (192,514 bytes). The current `npm run art:bridge-glass` bakes v2. `npm run art:bridge-lighting` rebakes the versioned Brotli RGBA8 sky basis (421,109 transfer bytes / 1,282,048 decoded). The sky's new guarded evolution tile lives in the existing cloud texture, not another sampler. The glass plate is admitted with the other opening art; a denied plate or worker keeps the projection and transmitted interior using the lean paths. No changes to cover/collision, the SACR packet/atlas contract, or the Night Crossing handoff.

## Pixel comparison

Pillow and NumPy measured the supplied 1920×1080 PNG first. The three body patches had **0/460** black pixels, with median RGB of **22/24/25** (head), **37/38/40** (torso), and **46/35/25** (leg). [Untouched source crop, enlarged](../research/pure-bridge/supplied-ronin-crop.png).

The game pairs are separate real browser captures. They pin seed 42, camera, projected pose/weapon landmarks, time, and weather, rather than guessing the camera or pose behind the uploaded PNG. Pixels are sampled from the visible compositor, not from a brush color or transparent source layer.

| Renderer | Ready head + torso | Strike head + torso | Optical sky pixels changed by a pan / lift / zoom / roll |
|---|---:|---:|---:|
| Master | 0/74 → 74/74 | 0/74 → 73/74 | 14,826 → **0** |
| Optimized | 0/74 → 74/74 | 0/74 → 73/74 | 5,911 → **0** |
| Canvas | 0/74 → 74/74 | 0/74 → 74/74 | 594,752 → **0** |

Each pose on each renderer also changed from 0/18 to 18/18 black shin samples. One WebGL strike sample on the silhouette fringe is `(4, 5, 7)`. The antialiased edges are not hard-thresholded to black. At fixed camera, cover, and wind, advancing only the run clock by 46 seconds changed the isolated sky by 0.43–0.45 RGB levels on average; the moon stayed in place. The GL comparisons sample Stratum A RGB without the mist alpha. The Canvas comparison uses the actual optical painter without the skyline. Raw raster dimensions differ by path.

[Master ready before](../research/pure-bridge/master-metro-before.webp) · [After](../research/pure-bridge/master-metro-after.webp) · [Master strike before](../research/pure-bridge/master-strike-before.webp) · [After](../research/pure-bridge/master-strike-after.webp)

To reproduce, use the browser setup in [Game Loading](GAME-LOADING.md#reproduce). Run `.qa/slasher-pure-bridge.mjs` against the control and updated previews with `SR_SHOTS` set to `<capture-root>/<before|after>/<master|optimized|canvas>`, writing stdout to `<capture-root>/reports/<before|after>-<tier>.json`. Use `--optimized` for Optimized and `SR_SOFTWARE=1 ... --canvas` for Canvas. Add `--verify` on the updated preview. Then run `python scripts/audit-bridge-visuals.py <capture-root> research/pure-bridge --attachment <image-13.png>` with Pillow and NumPy installed.

## Release checks

[Verification receipt](../research/pure-bridge/verification.json), live build `N_lHn8gHuSyjeD_GfBcku`. All 24 deployed witness images matched the candidate. Pane-only tests at Metro, Market and the catwalk found no leaked return beyond pane-edge tolerance or in the fascia sample, including portrait Optimized and denied Atlas/worker Canvas. The two GPU tiers matched the CPU sky optics and sampled the same sky cache for the road. The new asset hold, fence, retained Results through resize/Cancel, real context loss, and live Engage/Retry and cross-origin iframe checks passed. Both bakes reproduced byte for byte.

**219/219** Bridge checks passed and **17** GLSL programs linked offline. The full suite finished **603/608**, with the same five pre-existing combat/animation failures as the control.
