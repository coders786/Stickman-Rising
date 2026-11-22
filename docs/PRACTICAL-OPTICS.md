# Practical optics and frame pacing

> Historical render study. For current presets and Engage, see [Continuous Bridge](PROCEDURAL-BRIDGE.md).

[Matched Bridge comparison](../research/practical-optics/before-after.jpg) · [Absolute Ultra portrait](../research/practical-optics/portrait.jpg) · [Dry Station](../research/practical-optics/station.jpg) · [Replay receipts](../research/practical-optics/verification.json) · [Preview checks](../research/practical-optics/preview-checks.json)

The [earlier optics changes](BAKED-OPTICS.md) already kept the full-scene bloom/ray sampler out of both authored stages. What remained under load was the actor-water strip, moving glints, baked prop flips drawn as a second image, layered emitter blits, pool modulation, wide washes and a viewport vignette. At play scale the strongest evidence of water was already the baked fixture return, not the moving second image of the fight. This pass spends the optical budget on visible fixtures and materials instead.

| Element | Wet Bridge | Night Station |
| --- | --- | --- |
| Bright source and air | Each visible practical draws one world sprite: sharp glass or lettering, a shaped hot lobe, a gentle colored skirt and short directional air. Its alpha falls to zero at the footprint. | Same budget, with a softer beam from platform fixtures. |
| Gloom and depth | A cooler skyline and a warm band at the base of the near facades. Soft distance and warm scatter are part of the existing parallax plates, not a frame filter. | Cooler arch recess and contrasting tile faces, without a wet response. |
| Static light and water | A stronger contrast between damp aggregate and broken lamp/sign returns under road paint. Steady light is baked into the span from the same sources used to shade actors. | Only steady diffuse light on the dry platform. |
| Live optical passes | No actor/prop mirrors, water strip, wet guide or moon glints, live pool modulation or viewport vignette. | No wet passes or vignette. |

The fixture kit survives Retry; a short-lived work canvas builds the composite and another transient transfer tile bakes the light into the seeded span. There is no new asset request or second scene-sized buffer. The live scene does not read from itself. Shadows, distant parallax, rain/splashes, fighter lighting, attack feedback, HUD and the DPR caps are unchanged. The old projection/capture stack is only for ungraded diagnostics. Tier copy describes the detail the authored stages actually draw.

## Matched frame pacing

Control: the working tree after the shadow pass, including its uncommitted art. Browser: headless Chromium 153 in the sandbox with `--disable-gpu` (software backend; sky plates can still bake through software WebGL). Seed 42, settled drizzle for Bridge, dry Station, matched crowd and two prop fixtures. Timings are medians of three alternating before/after runs per side, each with 36 warmup and 90 measured callback intervals. The sim advances on a fixed input clock. The timing runs have no phase wrappers, readbacks or screenshots. **Lower is better**, but these are browser callback intervals, not presented frames or an Android/iOS performance guarantee.

| Fixture (CSS viewport) | Fixed scene backing | rAF p50 (ms) | rAF p95 (ms) | rAF p99 (ms) |
| --- | --- | ---: | ---: | ---: |
| Wet Bridge High, 960×544 | 1440×816 (1.5×) | 50.0 → 33.3 | 66.7 → 50.0 | 66.8 → 66.7 |
| Wet Bridge Absolute Ultra, 960×544 | 2160×1224 (2.25×) | 99.9 → 50.0 | 133.2 → 83.3 | 150.0 → 83.4 |
| Wet Bridge Absolute Ultra portrait, 390×844 | 877×1899 (2.25×) | 50.0 → 33.3 | 83.4 → 50.0 | 83.5 → 66.7 |
| Night Station Absolute Ultra, 960×544 | 2160×1224 (2.25×) | 66.6 → 50.0 | 83.4 → 66.7 | 100.1 → 83.4 |

Median submit p95 at 2.25× was 23.1 → 20.9 ms on desktop Bridge, 14.7 → 12.9 ms in portrait, and 8.1 → 6.5 ms on Station. No interval exceeded 250 ms in these runs. The improvement is from the combined changes; the data does not attribute all of it to one pass. Optional-pass counts were taken in separate runs:

- Desktop Absolute Ultra Bridge: 90 actor-strip composites, 180 prop mirror composites, 90 moon-glitter calls and 90 wet-glint calls → **zero**. The 106 halo blits, 190 shaft blits, 270 pool blits, 270 background wash blits and 90 vignette blits were also replaced by the authored bakes. The culled fixture bill was 144 bare bodies plus the halo/shaft calls before, versus 151 complete fixture stamps after (the padded scatter can enter the viewport before the body). All counts are for 90 frames.
- Tracked retained backing at the same scale: desktop Bridge **60 → 49 surfaces / 23.89 → 20.25 MiB**; portrait Bridge **59 → 48 / 22.33 → 19.45 MiB**; dry Station **30 → 24 / 13.91 → 11.55 MiB**. Scene/HUD output sizes were constant. The ledger is not a measure of GPU/process memory.
- Controls and candidates had zero scene samples in both routes. Shadow draw counts, simulation, weather and camera matched. All five still pairs have identical HUD bytes. No tracked backing survived teardown.

## Touch controls

In the [actual touch preview](../research/practical-optics/touch.jpg), the 10 action buttons and the joystick use dark tinted surfaces, a visible rim and a pressed state instead of `backdrop-filter` over the moving scene. Hit targets, layout, pointer capture and handling were not changed. The app's own controls are used for the CSS-only comparison, separate from the canvas-only portrait replay. At 390×844 CSS with a 2× device and a locked 877×1899 scene, the old preview was panned behind the actual button layer. Disabling just the filter on that same build reduced the active backdrop filters from **11 to 0**. Three alternating pairs (30 warmup, 72 callbacks) gave median p95 **83.4 → 66.8 ms** and p99 **100.1 → 83.4 ms**; p50 stayed at 50.0 ms. Individual trials varied. Hardware compositing and sustained performance on real devices remain to be verified.

## Regression checks

- 174 focused tests passed. Typecheck, boundary lint, touched-file lint and the production build passed. The full gate was **490/495**, with the same five incumbent combat/animation failures as the control.
- Live Bridge and Night Station routes returned 200. The real settings check held Absolute Ultra at 2250×1395 desktop and 877×1899 touch, with unchanged HUD backing. The selected preset and Adaptive mode still restore and persist. Touch stage switching, Engage, pause/resume, Retry/cancel, and desktop/touch input smoke checks passed.
- Engage plus 20 Retries on each of Wet Bridge forward, Wet Bridge capture and dry Station kept the three/eight fixed fixture/depth canvases, kept prop-mask dimensions at 76×88, released retired masks, sampled no scene pixels and left zero tracked stores after destroy.

## Reproduce

```sh
# Keep the full source trees, including untracked art. Run serially.
.qa/slasher-practical-proof.sh CONTROL_SRC CANDIDATE_SRC .cache/practical-optics/final all
node .qa/slasher-practical-report.mjs
# On the old preview this disables only backdrop-filter; on the new one --flat verifies the actual CSS.
node .qa/slasher-touch-compositor.mjs
node .qa/slasher-touch-compositor.mjs --flat
node .qa/slasher-optics-retries.mjs --baked-practicals --shadow-masks
node .qa/slasher-optics-retries.mjs --baked-practicals --shadow-masks --capture
node .qa/slasher-optics-retries.mjs --baked-practicals --shadow-masks --station
```
