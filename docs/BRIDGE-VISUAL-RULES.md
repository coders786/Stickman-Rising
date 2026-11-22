# Bridge visual rules: realism that improves the fight

> Historical visual pass. [The current flat-ink Ronin](RONIN-LIGHTING.md) supersedes the shaded cloth below.

**Control:** Night Crossing build `ncp34jFV9QnZXWSlWSvfb`. It already has worn paving, authored shop interiors, section-aware glass, per-source shadows, and an eight-shot loading reel. Keep those. The next changes should be obvious at play scale, not just in a zoomed crop.

| Order | Rule | How to tell it works |
| --- | --- | --- |
| **1 · Read the stance** | Black cloth reflects light, but doesn't emit it. Light the Ronin's existing contours from the sky and the local lamps that actually reach each body part. Keep the dark core and separate the near and far limbs without drawing an outline through the gaps. Boots still meet the existing support and sole shadow. | Covered Metro, exposed Market and the Sky Garden catwalk: read head, weapon hand and planted foot at normal zoom. Shade moves to the side of a real lamp and falls off behind a solid. No new eyes, halo, washed-out silhouettes or changes to poses, weapons, tells or collision. |
| **2 · Read the surface** | Exposed asphalt darkens as it absorbs rain. Low spots collect water and return sharper light; rough shoulders stay matte. Shelters are dry. Use the existing drainage field and eaves, not another texture set or a screen-space rain filter. | Same Market scene, dry vs. soaked: a measurable change on exposed paving even without visible rain. Inside the same shelter the road stays dry. Cover, reflection anchors and shadow ownership hold across seams and renderer switches. |
| **3 · Read the depth** | Distant city contrast falls off through humid air, especially at the towers' bases. Near rail and shop lighting stay legible; distant windows shouldn't compete with sword and threat cues. | Same camera at Metro and Market, and portrait exposure: distinct distant silhouettes, calmer window grids, readable openings and local lights. Sky, foreground, and telegraph colors aren't retouched. Missing city assets use the same hierarchy. |

## Rollout and guardrails

1. Capture a reproducible control: seed 42, fixed poses and camera, no weather motion between paired frames. Record the active transport window and renderer. Compare the same fixtures against each chunk; use a covered and exposed road sample in the same frame.
2. Test the visible change and the invariants before layering on the next chunk. Master, Optimized and Canvas must tell the same story; check portrait, denied assets, and loss/recovery on top of the normal paths. Keep motion/telegraph and boot checks separate from still captures.
3. Stage away from the live control. Promote only after the finished world and HUD submit in ordinary play. The visual-rule release used the former timed reel; the [current Ronin reveal](NIGHT-CROSSING.md) is readiness-driven.

No global exposure lift, new full-screen pass, scene readback, new light/shadow budget, SACR v4 ABI changes, or transport rebake for a visual grade. The quality tier may change the cost of the approximation, not the scene's layout or its lighting rules. Use software browser tests for correctness, not as a device performance claim.

## Implemented chunks

1. **Matte cloth on the posed receiver.** The six existing body-part samples now include sky access and lunar visibility for the Ronin. Those inputs and the already-occluded fixture pair shape soft local highlights *inside* the same anatomy, in place of the offset rim on the playable Bridge. A small deck/soffit return, reduced by cavity occlusion, keeps the feet from disappearing in shade. The black face, weapon and telegraphs stay separate. Canvas and GL use the same material response; GL takes an input encoding for its existing tone curve.
2. **Dry substrate, live moisture.** The Canvas chunk bake now contains only dry material; a weather-driven wash and the existing basin path supply absorption on the road. Optimized uses the same film/pool model as Master instead of the repeating specular stripe. Damp rough asphalt absorbs more light; only basin water pays for the section reflection trace. The same eaves exclude moisture, and rain does not change sole contacts or the light that owns a shadow.
3. **Distance before decoration.** City-only extinction increases toward the base of each tower and more strongly in the far card. Muted airlight keeps the skyline shape as the grid loses contrast. Existing city textures, parallax, occupied windows and beacons remain. The cached Canvas cards and their procedural fallback use the same depth order. Local glazing, rail, sky, water and HUD aren't graded by this change.

## Preview evidence

Build `YthrLk2hBQ8JzYrg-ORS3` was the visual-rule release on the main Arena preview. See the [verification receipt](../research/bridge-visual-rules/verification.json) for cameras, patch coordinates, renderer paths, and loading checks.

- **Ronin:** [Metro before](../research/bridge-visual-rules/metro-before.webp) · [Metro after](../research/bridge-visual-rules/metro-after.webp) · [Sky Garden](../research/bridge-visual-rules/sky-garden.webp). The six-tap receiver keeps a dark core, with the hand, boots and stance separated inside the existing shape. Freezing and repainting the same actor at Metro and Market produced no luma drift in the sampled regions. Cutting the warm and cool fixtures independently at the exposed Metro mark changes the corresponding return on all three paths; restoring both reproduces the original patch.
- **Road:** [Market dry](../research/bridge-visual-rules/night-market-dry.webp) · [Market wet](../research/bridge-visual-rules/night-market-wet.webp) · [Optimized portrait](../research/bridge-visual-rules/market-portrait.webp). On the exposed Market strip, raising wetness from 0 to .94 changed mean display luma by **−2.74 Master / −2.09 Optimized / −5.57 Canvas**, on a 0–255 scale. The previous Master build brightened it by **+6.59** at the same camera. At Metro the exposed strip darkened while the covered strip measured zero change on all three paths, including a second portrait framing that includes the apron.
- **City:** [Clear](../research/bridge-visual-rules/metro-clear.webp) · [Haze](../research/bridge-visual-rules/metro-haze.webp) · [Canvas without skyline art](../research/bridge-visual-rules/metro-denied-city.webp). At matched weather, the Master city patches lost 11–13% of their adjacent-pixel luma contrast versus the control, while the sampled shop patches were byte-identical. With fog raised from .08 to .86, the city patches lost 17–59% across the tested paths; shop patches retained at least 96% of their detail. These are local samples, not a grade applied to the whole screen.

`check:bridge` passed **218/218** and the offline compiler linked all **17** shader programs. `npm test` passed **602/607**, with the same five combat failures as the control. The browser runs are correctness checks, not a measure of device frame rates. The unchanged eight-shot Night Crossing reel was checked in the served build and held on shot 8 under delayed backdrop delivery; it hands off to the current-seed world and HUD at simulation tick zero.

## Reproduce

Use the browser setup in [Game loading](GAME-LOADING.md#reproduce) and point `SR_QA_URL` to the build to capture. Set `SR_SHOTS` to keep the screenshots. Omit `--verify` when capturing the older control. The fixture uses seed 42 and matches camera, pose and weather at Metro, Market and Sky Garden. Streaks are disabled when testing the paving itself. All pixel reads are tooling-only.

```bash
npm run check:bridge
npm run check:webgl:offline -- --require-compiler
node .qa/slasher-bridge-visual-rules.mjs --city-weather --cpu-compositor --verify
node .qa/slasher-bridge-visual-rules.mjs --touch --city-weather --cpu-compositor --verify
SR_SOFTWARE=1 node .qa/slasher-bridge-visual-rules.mjs --canvas --city-weather --cpu-compositor --verify
SR_SOFTWARE=1 node .qa/slasher-bridge-visual-rules.mjs --canvas --deny-art --city-weather --scenes=metro,market --cpu-compositor --verify
SR_SOFTWARE=1 node .qa/slasher-sky-pacing.mjs --deny-city --expect-reuse --cpu-compositor
node .qa/slasher-metro.mjs --cpu-compositor
node .qa/slasher-bridge-coverage.mjs --gl --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-night-crossing.mjs --cpu-compositor  # current loader, not archived reel
```
