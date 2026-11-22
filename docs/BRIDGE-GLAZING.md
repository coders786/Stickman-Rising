# Bridge storefronts: transmission and reflections

The glass should read as a window into a warm shop, not a cool overlay on top of the wall. It should also show the lit bridge from the opposite side of the pane, moving at the right speed as the camera passes. This update replaces the display-space v1 overlay with a bounded scene-space return on WebGL2. It keeps the shop interiors, materials, flat Ronin and fixed optical sky from the [previous Bridge pass](BRIDGE-PURE-LOOK.md).

## Research and design

- [Pilkington ATS-184, *Design Details for OptiView*](https://www.pilkington.com/-/media/pilkington/site-content/usa/window-manufacturers/technical-bulletins/ats184optiviewdesigndetails20130104nsgformat.pdf) describes the roughly 4% reflection at each clear air-to-glass interface, about 8% for a single uncoated pane at normal incidence. Whether a window seems reflective depends on the luminance on **both** sides. A practical can show as a bright localized reflection while the rest of the room remains visible.
- [PBRT, *Dielectric BSDF*](https://pbr-book.org/4ed/Reflection_Models/Dielectric_BSDF) sums internal reflections in a thin parallel slab. [Snell's law](https://pbr-book.org/4ed/Reflection_Models/Specular_Reflection_and_Transmission) gives the longer path at oblique incidence; [Beer–Lambert attenuation](https://pbr-book.org/4ed/Volume_Scattering/Transmittance) gives the loss along that path. The ray exits a parallel slab parallel to the incident ray. For this side-on view and 6 mm thickness we omit the small lateral displacement, not replace it with rippling distortion.
- [LBNL WINDOW/THERM simulation manual](https://windows.lbl.gov/sites/default/files/Downloads/NFRCSim7-July2017.pdf) treats glazing as a spectrum-weighted layered system. Here we use a neutral fit for clear float glass, **not** measured spectral glass, coated glazing, or solar transmission. [Walter et al., *Microfacet Models for Refraction through Rough Surfaces*](https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf) motivates separating the lobe from the fraction reflected. The orthographic game uses a normalized core-and-wing filter and a bounded, finite-lens spread, not a full microfacet integration or ray tracer.

The model uses **n = 1.52**, **6 mm**, and neutral extinction **4.2 m⁻¹**. If `r` is a single-interface Fresnel power reflectance for one polarization and `a = exp(−σd / cos θt)`, the slab uses `T = (1−r)²a / (1−r²a²)` and `R = r + T·r·a`. Average the two polarizations *after* evaluating their round trips. The energy `1 − R − T` is lost to absorption. The modeled fractions are:

| Incidence from normal | Reflection | Transmission |
| ---: | ---: | ---: |
| 0° | 7.98% | 89.54% |
| 30° | 8.20% | 89.17% |
| 45° | 9.50% | 87.70% |
| 60° | 15.26% | 81.73% |
| 75° | 37.60% | 59.23% |
| 80° | 53.19% | 43.63% |

Most game views are much closer to head-on than the last two rows. At common angles the return **moves** before Fresnel changes much; don't artificially raise the reflection constant to make a fixed overlay more visible.

## Implementation

1. **Project the opposite bank, not the screen.** At 48 world px/m, use the view's world X/Y and optical eye depth (−4.8 m). Mirror each source plane about the storefront depth. Intersect eye-to-virtual-source at the pane. The distant city and near practicals move at different rates. The nearby steel and live Ronin replace the far return where they occlude it. The sampled lighting uses the committed same-seed worker field and the current atmosphere, including lightning. Real finite lamps use their own size, spectrum and strength; worn poles use the same seeded variation as their visible lenses. Road wetness does not enter the glazing response.
2. **Bake only static radiance.** `npm run art:bridge-glass` writes `public/bridge/shop-return-v2.webp`. It contains 896×180 filtered environment slices for the two roughness profiles (.17 and .24), exposed and sheltered endpoints, and linear and display banks. The lossless 896×1440 atlas is 269,248 B. The atlas is requested on Engage and must decode before the opening is exposed; a failed or denied source can still use the projected skyline. It is retained for Retry.
3. **Resolve at the window, before foreground.** The painter packs radiance and pane coverage into one local tile per visible storefront. Gaskets and mullions remain opaque and catwalk/fixture geometry cuts the aperture. Master (including its facade receiver mesh) and Optimized apply `T·room + R·return` in linear RGB after lighting the room and before actors, props and the post grade. Canvas uses the same projection and per-pane center coefficients, with neutral loss on the display-space room followed by a bounded source-over reflection. It isn't an HDR-equivalent blend; no full-frame linearization or readback on that path.
4. **Bound the work.** At most three 320×112 tiles in one scratch backing. WebGL keeps its two original full-size Canvas uploads and adds **one conditional local upload** (143,360 B per tile; at most 430,080 B and 430,080 B of optional texture storage). With no visible storefront, it uploads no tile. There is no additional full-size target, pass, readback, or transport schema change. Canvas reuses one tile. The shop receiver is skipped when allocation is unavailable. SACR retains its 3,584-byte packet, the same offsets and the same seed/transport rules.

## Verification

- Capture the old and new storefronts at the same seed, pose, view, viewport and weather on Master, Optimized and Canvas. Compare the actual finished frame; separately isolate the receiver with the rest of the frame unchanged.
- Verify the served GL base programs against the numerical slab across a range of controlled angles. Confirm that a camera move changes what is reflected even at fixed weather; clear transmission is not a toggle at a particular view.
- At fixed pose, compare admitted practicals powered vs. off, ambient access opened vs. occluded, and the lightning source enabled vs. zero. Check that changing only wetness does not change the return.
- Check real pane pixels, dividers, foreground cutouts and the catwalk fascia at nonzero camera roll. Repeat with the atlas missing, and with worker transport unavailable on the Canvas path. Measure actual tile bytes and keep software-browser costs separate from device benchmarks.

[Matched storefronts](../research/bridge-glazing/storefront-comparison.webp) · [Market source changes](../research/bridge-glazing/market-sources.webp) · [Raw pixel counts](../research/bridge-glazing/matched-pixels.json) · [Verification receipt](../research/bridge-glazing/verification.json).

In the matched seed-42 storefront captures, the Metro counter, shelving, seating and door remain readable behind the pane. The strongest Master Market difference from v1 was **50/255** in a color channel, while the mean max-channel difference across the crop was **2.03/255**: a local highlight instead of a bright wash. Turning off the two reflected Market practicals changed **345** composed pixels by at least three levels, with a peak of **53/255**; changing the incident lightning added a broad, much weaker change (peak **9/255**) without altering the room. This is a controlled source test, not a naturally timed strike.

The exact Master and Optimized GLSL base programs matched the CPU slab reference within **one RGB level** across nine samples from ~−79° to +79°. At fixed exposure, a 52-world-pixel camera translation changed the projected return, and changing only road wetness changed none of it. The finished-frame probe found **0** changes ≥3 RGB levels in the guarded divider/mullion pixels or in **473 / 309 / 416** actual overlapping catwalk-return pixels on Master / Optimized / Canvas. Atlas denial passed on Optimized, and atlas plus worker denial on Canvas; portrait used Optimized. These comparisons allow a 2.2-backing-pixel antialiasing guard along pane edges.

Each measured storefront used one **143,360 B** tile upload, about **1.9%** more than the two original uploads at the sampled Master backing and **3.0%** more at Optimized. In eight alternating frozen headless paints at the Market, median submit time with the glass disabled/enabled was **28.0 / 29.4 ms** Master, **17.4 / 17.0 ms** Optimized and **1.0 / 2.0 ms** Canvas. This small software-browser sample is not a GPU/device performance claim.

From [the browser QA setup](GAME-LOADING.md#reproduce):

```bash
node .qa/slasher-shop-glass.mjs --cpu-compositor --wet-shot --optics-shots --bench
node .qa/slasher-shop-glass.mjs --optimized --cpu-compositor
node .qa/slasher-shop-glass.mjs --optimized --deny-city --cpu-compositor
node .qa/slasher-shop-glass.mjs --touch --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-shop-glass.mjs --canvas --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-shop-glass.mjs --canvas --deny-city --deny-worker --cpu-compositor
```

Set `SR_SHOTS` for captures; add `--baseline` when sampling the v1 control. The program and source toggles, readbacks and timing drains are QA only.

Use `python scripts/audit-reveal-glazing.py <capture-root> research` with Pillow and NumPy to rebuild the sheets from the saved `before-<tier>` / `after-<tier>` captures and their JSON reports.
