# Metro Bridge

> Historical Metro release. For the current fixed-world railway, car-free service court and animated glazing, see [the fixed viaduct update](BRIDGE-STABLE.md).

**Engage** starts the continuous road through Metro Approach, Market Overpass and Sky Garden District. This pass changes the presentation, not the distance scale, collisions, gate rules, or shelter services. The [SACR v4 contract](../IMPORTANT.md) and [atmosphere and graphics presets](BRIDGE-ATMOSPHERE.md) still apply.

## City and rail

- The two skyline cards mix offices, hotels, apartments and lower civic blocks. Albedo, skyline occupancy and emissive glazing are baked from shared geometry. Their independent lateral parallax is world-anchored, so zoom does not shift the image under the camera centre. The separate street plane puts cars and crosswalks below the near deck's fascia. A missing street WebP falls back to a bounded procedural card, then to direct paint if its surface is denied.
- Platforms and shutters get visible side returns and soffits. District storefronts, the service bay, lamp lenses and the cable sockets have corresponding geometry in the optical bake. The near feeder joins those sockets; rail contact and messenger wires join each insulator on the 313 px support pitch. Both extend past the crop rather than terminating at a tile edge.
- Airport express, parcel freight, night service and metro local are separate kinds on all renderers. A seed specifies the timetable, stock, direction and speed. The ordinary departure gaps are 6.9–34.9 seconds; a block of twelve departures may have one closer, opposite-direction pair. Train movement and wake use the same continuous phase, even as a support crosses the screen edge. Reduced Motion holds the feeder sag and street traffic, suppresses cosmetic trains and their wake, and does not slow simulation.

## Camera

The normal Bridge camera follows the player's root through a retained horizontal dead zone. Turning, stopping, changes in the enemy count, and ordinary hit feedback do not change its horizontal target or magnification. The portrait checkpoint lead depends on distance to the gantry, not its lock state; it tapers away beyond the gate. Vertical tracking leaves room for jumps and launch follow-through. Execution and Overdrive still have explicit zoom beats, and non-Bridge modes retain their existing camera.

## Light on surfaces

Transient sources are world-space records: confirmed hit cores, the solved blade span, a projectile core or exhaust, and segments of the current lightning polyline. A restrike rebuilds the visible jag and its lit segments while leaving the collision skeleton and contacts pinned. Confirmed hits take priority over projectile light when only one transient can be admitted. HDR admits up to four transient records; Optimized and Canvas admit one.

CPU and GLSL use the same finite-distance and section-blocker tests. The incident direction affects each existing body contour, a prop's alpha mask, and the road, raised deck or facade face that receives it. The Canvas path uses six samples per solved rig and a reused 96×42 field for planar receivers. WebGL2 removes shadow energy from the matching light on the road and raised deck rather than multiplying the whole scene. The wet return stays separate from these contributions and clips at dry shelter boundaries. Bright pixels, bloom and the HUD do not create light sources.

## Verification

[Metro skyline and street](../research/bridge-metro/hdr-metro.webp) · [Two trains](../research/bridge-metro/hdr-double-pass.webp) · [Sky Garden](../research/bridge-metro/hdr-skywalk.webp) · [Receiver off](../research/bridge-metro/hdr-receivers-off.webp) / [on](../research/bridge-metro/hdr-receivers-on.webp) · [Lightning](../research/bridge-metro/hdr-restrike.webp) · [Portrait boss](../research/bridge-metro/touch-boss-windup.webp) · [Denied city assets](../research/bridge-metro/canvas-denied-city.webp) · [Build and verification receipt](../research/bridge-metro/verification.json)

- **Camera:** In the previous portrait build, turning in place shifted the same stationary mark from **140 to 260 CSS px**. The same turn now shifts it **0 px**. The new controlled stop and gate-clear probes also measured **0 px** of horizontal slide. Live touch and keyboard checks covered the Sky Garden jump and drop, a real boss windup, the blade's solved light span during an attack, and execution zoom returning to normal.
- **Rail:** All paths rendered all four stock types and a two-train pass. The seam probe moved a quarter of a world px at a support boundary; its measured lead delta was below **0.028 native px**, with the car count unchanged. Pairs occupied **3.43% of occupied samples** in a 12-seed timetable sweep at a fixed 600 px half-span. This is a controlled test, not a fixed probability at every point on the route.
- **Receivers:** With the camera, weather and pose frozen, a warm light without a drawn core changed player, enemy, prop and road pixels on each path. A jamb returned the enemy patch to its unlit values while the unobstructed player stayed lit. A separate cool source lit the Sky Garden deck on all three paths. The live orb, confirmed-hit priority and changing restrike geometry were checked through the same source packet. Both WebGL2 tests reported zero GL errors.
- **Progression and cover:** Engage plus two Retry runs travelled at least 10,000 world px per seed, respected locked gates and dry cover, and released the prior run's surfaces. The rolled-eave raster test found zero precipitation changes in dry pixels on all paths and zero wetness changes in dry pixels on both GL paths. Denying the city images, and then the optional street cache, still produced complete procedural street views.
- **Transport and pacing:** Optimized kept its previous committed window during hitstop and parry, then uploaded one level per eligible frame. Readback matched the new window and the renderer recovered after context loss. The 120-frame checks stayed on their selected presenters with no surface-budget overages. The headless software paths did not meet the 16.6 ms p99 interval target; physical-device performance has not been measured.
- **Regression:** 188/188 Bridge tests passed, and 17 exact GLSL ES 3.00 programs linked offline. The full suite passed 572/577: the five failures match the previous build's combat and animation tests.

## Reproduce the checks

The stages and scripts run against the standalone preview, with `SR_BROWSER_TOOLS` pointing to Puppeteer and Chromium. `SR_QA_URL` defaults to the preview on port 3000. `SR_SHOTS` can capture the proof frames. The scripted rail and light probes freeze the simulation; the route visuals and soak checks use the real game input, movement and collision code.

```bash
npm run build:iso
npm run check:bridge
npm run check:webgl:offline -- --require-compiler
node .qa/slasher-metro.mjs
node .qa/slasher-metro.mjs --touch
SR_SOFTWARE=1 node .qa/slasher-metro.mjs --touch --canvas
SR_SOFTWARE=1 node .qa/slasher-metro-fallback.mjs --touch
SR_SOFTWARE=1 node .qa/slasher-route-visuals.mjs --touch --cinematic
SR_SOFTWARE=1 node .qa/slasher-route-soak.mjs --touch --retries=2
node .qa/slasher-bridge-finish.mjs --v4
node .qa/slasher-v4-stream.mjs --touch
node .qa/slasher-sacr.mjs --compact --force-gl
node .qa/slasher-sacr.mjs --touch --force-gl
SR_SOFTWARE=1 node .qa/slasher-sacr.mjs --touch
```
