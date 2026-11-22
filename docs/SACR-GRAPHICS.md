# Bridge graphics — SACR v3.1

For the current sky and graphics controls, see [Bridge atmosphere and graphics presets](BRIDGE-ATMOSPHERE.md). [SACR v4.0](BRIDGE-MASTER-V4.md) and [the preservation contract](../IMPORTANT.md) describe the light-transport architecture; [Metro Bridge](BRIDGE-METRO.md) describes the current city and local receivers. The captures below document the historical SACR v3.1 control; [Dark Cinematic Realism — Bridge](BRIDGE-NOIR.md) is the separate Noir comparison.

SACR renders the continuous Bridge’s wet road from scene data, not a copy of the finished canvas. Live sky, architecture and combat lighting now feed both the view above the deck and the reflections below it. The existing centre-X, Y-down camera, collision geometry and `/10` HUD distance are unchanged. **The 48 logical px/m in SACR is a renderer conversion, not a change to travel or combat.**

## Presentation and controls

| | Master | Mobile High-Opt | Canvas fallback |
|---|---|---|---|
| Admission | Ultra, fine pointer, WebGL2, renderable RGBA16F and admitted viewport/stores | WebGL2 with RGBA8; also tried when Master is refused | Used while no WebGL2 path is admitted or during context loss |
| Backing | 1–1.25×, at most 3.4M pixels | 0.85–1× nominal, capped to 1920 long side / 1080 short side | Requested scale |
| Wet road | Native-size, scissored **K=8**, material array, two ripple bands and landing waves | One half-width, half-height **K=4** target; full-size resolve rechecks dry cover | Procedural deck with the existing small clipped mirror strip and contact shadows |
| Sky radiance (Stratum A) | **256×64 RGBA16F**, two cloud taps, updates every submit | **128×32 RGBA8**, one cloud tap, updates every other submit except flash changes and invalidation | Complete procedural sky and city |
| Lighting / color | Baked environment basis + live moon, diffuse cast coverage, GGX shimmer, separate emission, four-level bloom, ACES and 32³ grade strips | Same environment basis, two explicitly indexed combat flashes, simpler wet sampling, 16³ grade strips | Local lights and grade tint, no full-frame GPU effects |
| Scarf | Five sampled nodes | Two sampled nodes | Two sampled nodes |

Reduced Motion suppresses the scarf tail and its capsules. The two tiers share the cover spans, solved pose, source records and CPU/GLSL evaluator. Mobile does **not** sample a wet neighbor into a covered pixel after upsampling. Cover is also used by exterior precipitation and by the light passes. The independent HUD is never sampled by a world shader: Show FPS draws last on the HUD or removes the label, and Settings hides the HUD while its safe-header Back target is in use.

Selecting **Settings → Ultra** locks the *requested* scale to **1.25×** immediately. Switching presenter, resizing or losing a GPU context does not change that choice. Only an explicit Adaptive Resolution toggle opens the governor. A 400×844 Mobile WebGL2 scene can therefore have a 400×844 backing while Settings reports Ultra · 1.25× · Locked. Read both scales in the diagnostic receipt. Normal play rejects reported software GL adapters; the browser QA override is not a player setting.

## Shared sky and receiver lighting

- **L0 sky:** a packed lunar surface (normal XY, albedo and corona), a repeating four-channel storm atlas and three district horizon strips. The phase is seeded. The moon drifts at **0.012×** camera parallax. A disc-sized screen patch evaluates the same material at screen resolution; reflections sample the cached sky once rather than tracing the visible sky painter. The CPU uses the same bilinear atlas and optical coverage for lunar visibility. Mobile holds the moon position, cloud phase and visibility on skipped submissions, but refreshes on a lightning onset, change or tail. The weather front’s broader key gain is distinct from the single lunar-column transmission.
- **L1/L2 city:** lossless albedo WebPs plus smaller linear basis textures; they use **0.10× / 0.21×** lateral parallax. District airlight, cloud shadows and sheet lightning light these layers in the shader. The sheet flash has a seeded screen epicenter and a localized falloff; it is not a full-frame exposure pulse. The below-deck city remains a separate plane, not part of Stratum A.
- **L3/L4 architecture:** a snapped **1024×128 RGBA8** world window stores AO, lunar access, sky access and fixture bounce. The baker reuses overlapping columns as the camera travels. Catwalk slab, cargo frames, curb/soffit, signs, district fixtures and the two shelter types share authored coordinates; they are not collision changes. The service interior gets warm bounce without the roof’s exterior flash. The wet ground under a raised Catwalk is still outdoors; a shelter under its eave is dry.
- **Master cast coverage:** a separate **R8 `min(sceneWidth,1024)×96`** strip receives posed actors and live props. Coverage uses MAX blending, not a depth shadow map. As cloud cover removes the moon, a nearby practical can take over the cast direction. Only eligible diffuse is attenuated; wet specular, SACR returns and emissive cores are composed independently. The Mobile path does not allocate this strip or evaluate Master GGX.
- **Presentation and failure:** the live sky/city uses the existing transparent world plate and separate actor plate, with **two full-size Canvas uploads** per frame and one bounded, conditional [local glazing upload](BRIDGE-GLAZING.md#implementation) when storefronts are visible. The HUD is never sampled. Before assets are ready, the world source keeps its complete backdrop. If GL rejects a frame after sparse painting begins, that same paint restores the Canvas sky/deck and composites the actor plate. Reduced Motion holds time-driven clouds and ripples, suppresses sheet flashes, landing waves and scarf tails, and leaves the simulation clock intact.

The shipped `public/bridge/sky-basis-v1.bin` is exactly **657,408 bytes**, ground-up linear RGBA8: 128² lunar, 512×128 cloud, three 256×64 horizon strips, and 256×60 / 256×70 city bases in that order. Rebuild with `npm run art:bridge-lighting`. `npm run art:bridge-webp` rebuilds `l1.webp` and `l2.webp` (city color), plus `stratum-a.webp` (a Canvas fallback plate, not the live GPU cache).

## Road packet and coordinates

One 2,432-byte **std140** UBO is reused, with one packet update per presented world frame. The shader is GLSL ES 3.00. Packed vector words use fixed lane selection and unsigned shifts; no dynamic vector-lane indexing or ES 3.10 unpack/image operations are required.

| Section | GLSL | Byte offset | Purpose |
|---|---|---:|---|
| Column bins | `uvec4[40]` | 0 | 80 columns, eight byte IDs each, zero sentinel; Mobile reads four |
| Primitive pool | `uvec4[64]` | 640 | Binary16 endpoints and radius/depth, byte/bit fields for tint and energy; negative radius selects a crescent |
| Arch profile | `uvec4[32]` | 1664 | Atlas-local integer millimetre span, half depth/lintel, linear RGBA8 soffit |
| Foot AO | `vec4[16]` | 2176 | Camera-left-local X, positive-away Z, radius, height; dense grounded-sole entries |

Column admission expands bounds by **1.2 m** and prioritizes fixed architecture, player, boss, emissive then nearby enemies. ID **63** is reserved for opaque Catwalk underside bars; a hit replaces the sky contribution rather than tinting everything below the slab. Admitted records sort by decoded depth. The evaluator unions opaque capsules with the same character ID; arc/beam energy adds without taking opacity and the arc centre remains finite. The dry branch returns only sole AO without evaluating the reflected ray. An emitter can light a surface without casting a contact shadow.

XY in the packet uses the left edge of the rolled world view as X origin and Y up from the deck. In that frame the road point maps front-to-back to positive Z. Curb rays transform from view-local X to world X to atlas-local X. A ray entering an arch samples a warm interior backwall or the packed soffit/side instead of extending the exterior projection through a wall. Rebase coverage includes moving the same fixture from 0 m to 1250 m.

Stratum B rolls on a snapped world grid when the guarded view leaves the current atlas. Its **RGB9_E5** levels are uploaded explicitly: **512×128 → 256×64 → 128×32 → 64×16**. The exterior and interior halves are averaged separately in linear space; V=0 is the ground end of the exterior band. The V clamp accounts for the coarsest mip participating in trilinear sampling. Do not flip the typed-array upload or generate these mips in GL. It remains independent of the live Stratum A sky cache.

**Precision limit:** the wire format is binary16, not fixed millimetres. Its step from 16 to 32 m is 15.625 mm, so a universal `<2 mm` round-trip requirement for arbitrary coordinates in 0–30 m is impossible without changing the format. The tests cover representable points throughout that range, non-grid small values, rounding carry/subnormals and the 7.8125 mm half-step bound in that range. Long-route error is limited by rebasing coordinates before packing; it is not accumulated into simulation.

## Reproduce the checks

```sh
npm run check:sacr
npm run check:bridge
npm run check:webgl:offline -- --require-compiler  # glslang-tools in CI
npm run build:iso
```

The build runs the source lint. The offline check emits the exact shaders under ignored `out/sacr-shaders/` and links them in ES mode (not SPIR-V mode). Without `--require-compiler`, missing validators are reported as skipped. CI requires the native compiler; browser-driver readback remains a separate check.

On the preview, open **`/?verifyGraphics=1`**, then **Engage**. The flag sets Ultra + Show FPS for that tab without saving the diagnostic preferences. The collapsible report is also exposed as `window.__GRAPHICS_DIAGNOSTICS__`. Before sampling performance it links the live Bridge shader sources in a separate WebGL2 context, verifies driver block offsets/strides, and compares 16×16 **Dry AO**, **Arc Center**, **Bay Interior**, **Dual Arc** and **Catwalk Underside** readbacks with the CPU reference. Bay Interior exercises both base and fractional mip levels and the exterior orientation sentinel. The [Ultra finish](BRIDGE-ULTRA-FINISH.md) adds Master-only readbacks for **Finite emitter penumbra** and **Damp aggregate / pooled water**. Mobile reads RGBA8; Master prefers RGBA16F and reports the RGBA8 diagnostic fallback if half-float is unavailable. The test context is released; there is no readback in the live presenter.

The report then uses **120 foreground playing world+HUD frames**, not paused refreshes or simulated fixed ticks. It records path, backing, effective lock, FPS ink, frame intervals and CPU submission percentiles. A pass means the rendering/parity and settings checks passed. It does **not** mean 60 FPS or certify GPU execution time.

The packaged smoke tests use the isolated browser tooling described in [the browser launcher](../.qa/bridge-browser.mjs). For example:

```sh
node .qa/slasher-sacr.mjs --touch --force-gl     # 400×844, K=4, live sky, safe Back, FPS ink
node .qa/slasher-sacr.mjs --force-gl --compact  # smaller desktop software smoke
node .qa/slasher-sacr.mjs --touch                # default Canvas on software Chromium
node .qa/slasher-bridge-finish.mjs               # real loss/restore, eave pixels, resize, Retry
node .qa/slasher-bridge-finish.mjs --deny=float  # Master → Mobile
node .qa/slasher-bridge-finish.mjs --deny=surface # Mobile → Canvas
node .qa/slasher-bridge-shadows.mjs --verify-rewrite          # current Master cast/contact/return readbacks
node .qa/slasher-bridge-shadows.mjs --touch --verify-rewrite  # current Optimized readbacks
```

The historical `slasher-bridge-lighting.mjs` fixture requires the frozen v1 build. For current atmospheric probes use `slasher-atmosphere.mjs`. See [Bridge update](BRIDGE-UPDATE.md) for the Metro Link cast measurements and [Bridge handoff](BRIDGE-HANDOFF.md) for current presentation, fixture contours, and recovery checks.

For the native Market still, point `SR_QA_URL` at the packaged app:

```sh
node .qa/slasher-replay.mjs --master --master-once --live-sky --fixed \
  --seed=42 --fixture=crowd --at-x=7140 --front-tick=720 --warmup=24 --frames=44 \
  --width=1180 --height=660 --scale=1.25 --trace-state --empty-teardown --pixels=out/market
```

`--force-gl` is for shader/raster validation in software. On a physical device, test the stock path without overrides at the target viewport; check Safari as well as Chromium. Keep the tab visible and sample a run with rain, moving fights, a wet/dry eave crossing and the boss rather than comparing an idle menu. Do not extrapolate a software-adapter frame interval to device performance.

## Verified build results

Packaged build `0_Y50OnuYUd70U0IdV9M9` passed TypeScript, the boundary audit (20 known, no new violations), **164/164** focused Bridge tests, **30/30** SACR tests, and `build:iso`. Native `glslangValidator 16.6.0` linked all **18** ES 3.00 programs. The full `npm test` suite passed **548/553**; the five failures are the same inherited combat/animation failures as the pre-lighting build.

| Driver check (Chrome 153 / ANGLE / SwiftShader) | Master | Mobile |
|---|---:|---:|
| Clear → cloud-hidden moon visibility | 1.000 → 0.011 | 1.000 → 0.020 |
| Max CPU / driver centre-density or visibility error | 0.00128 | 0.00070 |
| Screen / reflection sky probe max error | 0 | 0 |
| Service-bay floor pixels changed by lightning | 0 / 16,507 | 0 / 10,570 |
| Dry road pixels changed at 0.09 rad roll | 0 / 24,930 | 0 / 15,961 |
| Dry road samples within 2 world px of the eave | 411 | 270 |

Both stress fixtures filled the 64-primitive pool. Removing only the Catwalk bars changed **28,417 Master / 7,319 Mobile** wet pixels beneath the slab and none in the sampled open-road zone. A Master diffuse-only cast darkened open road without changing the isolated wet contribution beyond **0.00025** linear error. In the handoff fixture, occlusion removed both posed casts; a local emitter restored the actor and prop casts in the opposite direction. Mobile bound nonconsecutive flash IDs to the base, road resolve and actor programs and rejected a third flash. Sheet-lightning energy outside the storm falloff was zero. The isolated driver harness also passed all **10** SACR fixtures; maximum errors were **0.0002** in Master RGBA16F and **0.0020** in Mobile RGBA8. The UBO block offsets remained **0 / 640 / 1664 / 2176**.

**Fallback and controls:** real context loss/restoration, viewport denial, resize and Retry retained Ultra’s requested 1.25× lock. Half-float denial admitted Mobile; denied actor surfaces and normal software-GL rejection kept Canvas. Rain toggles changed no dry samples on any path. Settings retained the **88×44 CSS px** safe Back target at 400px, hid the HUD, and did not persist diagnostic overrides. Show FPS ink was verified with a pixel check before being turned off. A late presenter refusal repainted the opaque Canvas backdrop before the same frame returned. Reduced Motion suppressed sheet lightning, landing waves and scarf records on both GPU paths. The touch Canvas soak passed Engage plus 20 Retries, each travelling at least 10,630 world units and clearing two gates; teardown retained zero tracked stores. The native-size Market replay matched the pre-lighting gameplay state, event log and HUD pixel hashes.

**Limits:** these are software-driver rendering checks, not physical-GPU benchmarks. The opt-in 120-frame diagnostic reports foreground submits and frame intervals, not measured GPU pass times. Hardware desktop Chrome, Safari and physical-phone timing remain unverified. The 1475×825 Master evidence is a fixed-step still, not a cadence test.

**Game-frame evidence:** [Verification receipt](../research/sacr/verification.json) · [Native-size Master Market](../research/sacr/master-market.webp) · [Mobile WebGL2](../research/sacr/mobile-webgl2.webp) · [400px Settings](../research/sacr/mobile-settings.webp) · [Compact Master diagnostic](../research/sacr/master-qa.webp).

| Live-lighting fixture | Game frame |
|---|---|
| Clear / cloud-hidden moon | [Clear](../research/sacr/master-clear.webp) · [Occluded](../research/sacr/master-occluded.webp) |
| Localized flash / cast handoff | [Sheet lightning](../research/sacr/master-lightning.webp) · [Practical](../research/sacr/master-practical.webp) |
| Raised deck / dry eave | [Master Catwalk](../research/sacr/master-catwalk.webp) · [Mobile Catwalk](../research/sacr/mobile-catwalk.webp) · [Service Bay](../research/sacr/master-service-bay.webp) |
