# Continuous Bridge update: shadows, streaming, and startup

This is the shadow release and its historical measurements. For the current production candidate, see [Bridge handoff and recovery](BRIDGE-HANDOFF.md).

## Metro Link shadows

The broken streaks were reproduced with a seeded Metro Link encounter at a fixed camera and weather. Separate readbacks isolated direct cast, sole contact, and the wet actor return. The vertical cuts appeared in the **dry direct cast**: one nearest-neighbor read from the packed light-vector grid supplied the same heading to an entire column. A new direction at the next column shifted the projected capsule abruptly. Neither the planted contact nor the puddle mask was the cause of those cuts.

- The shader decodes the two neighboring **cell centers**, then matches their ranked light directions by angle and depth sign. It interpolates matched directions and energy; unmatched sources fade independently, so the cast never swings between opposing emitters. Fine baked radiance still caps practical-light loss at a blocked receiver.
- The cast rig retains both legs with stable connections to the torso. The finite-source kernel integrates both edges of a tapered capsule: distant narrow limbs soften and lose their dark core instead of becoming disconnected, half-dark bands. Cloth can use spare reflection slots after live emission; it does not enter the direct cast bins.
- Contacts are anchored to the solved soles and actual support. Their compact core fades as a boot lifts; raised contacts do not bleed onto the asphalt. Canvas uses the same anchors and reconstructed directions, a single source-selected outline, and a separate, clipped wet return.
- The road and raised receivers still subtract the contributing moon, practical, or combat light rather than darkening the whole surface. Contact attenuates diffuse only. Posed returns, sky transport, and emission remain separate; real eaves still clip precipitation and wetness.

[Matched Metro Link before/after](../research/bridge-update/metro-shadow-comparison.webp). At the old vector-cell boundaries, mean one-pixel luma change in the isolated HDR cast fell from **0.00234 to 0.00044** (81% lower), essentially matching the neighboring interior changes. Peak discontinuity fell from 0.01353 to 0.00205; the integrated cast remained present rather than being faded out. The same camera, seed, pose, shader backing and weather were used on both sides.

No new texture arrays, render targets, scene copies, or readbacks were added for the rewrite. SACR v4 remains a 3,584-byte packet, 80 columns, 8/4 records per column and at most 2/1 traced light directions (HDR/Optimized). Its serialized layout and rolling transport are unchanged. The shadow code uses the sim pose; it does not change collision, combat timing or saves.

## Loading and bounded work

The title no longer starts a run's environment bake. Engage and Retry can submit a complete provisional Canvas scene and process an actionable simulation step before starting the optics and raster workers or linking the WebGL2 programs. The chosen tier and settings are retained. Links are stepped rather than all forced in a single frame. A denied HDR backing no longer discards a pending Optimized presenter; a denied pair stays on Canvas instead of re-linking on repeat. Resizing, changing tier, or restoring the context makes a new admission possible.

- **Streaming:** The optics and paint lanes transfer a render-ready window and one bitmap variant per plate. A current-seed group is committed only after all of its fields and mips are uploaded; stale replies are dropped. Canvas switches the visible plates to lit together. At most three 1152×452 bitmap slots reside in the live cache (**6,248,448 decoded bytes** for three plates). A full optical window is **1,593,856 bytes**, transferred by ownership and read via typed views of that one buffer. LZ4 stays available for archives, not on the live window handoff.
- **Downloads:** The sky is served as byte-identical Brotli (**1,169,408 → 390,437 bytes**), decoded by the browser. A packed prop image and mask remove six synchronous startup mask readbacks. Direct painting and procedural sky remain available when those assets or workers are blocked.
- **Framing:** The title backdrop now fades continuously past the horizon. The rail piers meet the lower street datum instead of ending at the camera crop, and trains stay on separate tracks. At 91 m, two real Field Nodachi jumps keep the head and feet in view on desktop and portrait. The road lighting stays continuous through tile publication, including when a neighbor is missing; authored deck steps and collision are unchanged.

### What the timings mean

Three fresh pages per build and input mode; Chromium 153, warm servers, real click/touch with cold page caches, seed 42 Engage and 43 same-page Retry. The shipped Ultra control is `2n2U3IGQZqJ6sgm6yaBwJ`; the loading/transport staging build is `hrWb1mWEhTKRsUim0072I`. The stage/fallback correctness checks are separate from these timing trials.

| Median (seconds) | Desktop Ultra → loading update | Touch Ultra → loading update |
| --- | ---: | ---: |
| Navigation → title draw submitted by CPU | 2.46 → 0.60 | 2.36 → 0.59 |
| Engage → first run draw submitted by CPU | 1.70 → 1.44 | 0.81 → 0.10 |
| Retry → first run draw submitted by CPU | 2.05 → 0.12 | 1.52 → 0.05 |
| Engage → 0.15 s of useful simulation | 2.02 → 2.10 | 1.89 → 0.59 |
| Retry → 0.15 s of useful simulation | 2.33 → 2.88 | 1.75 → 0.26 |

Desktop callback delivery still stalled in the sandbox's default compositor. A single diagnostic pair with the CPU compositor (WebGL2 still available) moved desktop Engage/Retry useful simulation from 0.68/0.39 to 0.40/0.32 s. That does **not** overturn the desktop default result. CPU submission, next animation callback and useful input/simulation are different observations; none measures display scanout or physical-device performance. `/?boot=1` exposes the local startup receipt.

Two of three desktop Engage taps on the loading update arrived before a title-frame callback could be observed. In the remaining trial that callback arrived at 0.748 s after navigation. On touch, the median observed title callback was 2.37 → 2.03 s, not the 0.59 s CPU-submit marker.

On the final shadow build (`yXaaEUvW6WLwnUpMmW9wN`), a fresh-page Engage and same-page Retry accepted trusted jump input on desktop and touch. The touch simulation check was 0.590/0.247 s; the desktop check was 1.898/2.797 s and still showed a slow Retry. These are smoke trials, not new medians.

Settled flow was measured separately at 848 × 520 CSS px, with 18 samples per state. The HDR CPU-submit p50/p95 was **1.7/3.4 → 1.8/2.4 ms** in the calm fixture and **2.7/3.8 → 2.2/4.4 ms** with three live impulses. HDR animation callbacks still exhibited stalls: calm p95 **2033 → 1317 ms**, busy p95 **2200 → 1267 ms**. Canvas callback p95 stayed near **33 ms** with its one admitted impulse. These are headless measurements with each tier's own light budget, not FPS or a claim that software HDR is playable at this speed.

### Same-byte unpacking check

The Node CPU check uses Ultra's shipped decoder on the identical inputs. For 24 archive tiles (12,779,520 decoded bytes), p50 was **23.33 → 21.17 ms** and p95 **24.56 → 21.89 ms** over 16 alternating batches. Overlapping LZ4 matches retain their repeat semantics; the output is byte-identical. For a single 1,593,856-byte optical window, the old compressed block plus view creation took **4.13 ms p50**; raw view creation took **0.004 ms p50** across 50 trials. The raw packet is larger than this fixture's packed block (632,399 bytes), but crosses an in-process Worker boundary by transferring ownership rather than downloading or cloning it. Neither result includes scene generation, browser scheduling, GPU upload, or scanout.

## Verification and reproduction

[Verification receipt](../research/bridge-update/verification.json) · [Title and jump framing](../research/bridge-update/bridge-title-and-framing.webp) · [Portrait WebGL2](../research/bridge-update/metro-portrait.webp) · [Same-pose combat light](../research/bridge-update/metro-impact.webp)

- The final production build passed **197/197 Bridge tests**, TypeScript, and **17 exact GLSL ES 3.00 links**. The full suite passed **581/586**; its five combat/animation failures are unchanged from the pre-shadow staging build.
- Fixed-pose ground, airborne, and moving-emitter checks passed on desktop HDR, portrait Optimized, and desktop/portrait Canvas. Cast, sole, and wet-return ablations ran on the same pose and camera. The readbacks reported zero GL errors or retained stores after teardown.
- The final lifecycle check exercised real WebGL loss and restoration, an oversized viewport, resize, and Retry. HDR and Optimized recorded no uncovered pixels in the rolled wet-road resolve and no changed pixels in the sampled dry eaves. Denying half-float admitted Optimized; denying both actor backings or both workers left a playable Canvas path. The receipts record the build for each fallback fixture.
- The final Optimized stream kept the previous window through hitstop and parry, committed the new group, and matched the expected GPU texels with zero error. Context recovery restored Optimized on Retry's new seed. The finite-scene resource probes each ran Engage plus 20 seeded runs at constant stage-art capacity.

Run `npm run check:bridge`, `npm run check:webgl:offline -- --require-compiler`, and `npm run build:iso`. For the browser checks, point `SR_QA_URL` at the staged production preview, with `SR_BROWSER_TOOLS` or `SR_BROWSER_EXECUTABLE` configured as in [Game loading](GAME-LOADING.md). Captures and readbacks are QA only.

```bash
node .qa/slasher-bridge-shadows.mjs --verify-rewrite
node .qa/slasher-bridge-shadows.mjs --touch --verify-rewrite
SR_SOFTWARE=1 node .qa/slasher-bridge-shadows.mjs --touch --canvas --verify-rewrite
node .qa/slasher-bridge-finish.mjs --v4
node .qa/slasher-bridge-finish.mjs --v4 --deny=master-surface
node .qa/slasher-bridge-finish.mjs --v4 --deny=surface
node .qa/slasher-v4-stream.mjs --touch
node .qa/slasher-v4-stream.mjs --touch --denied
node .qa/slasher-load.mjs --early --input --stages --touch
node --expose-gc --import tsx .qa/slasher-bridge-cache.mjs /path/to/local-ultra-standalone
```
