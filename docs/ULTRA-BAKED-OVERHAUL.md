# Ultra overhaul: grade first, bake the stable parts

The target is a dark transit bridge with readable fighters, not a static painting or a brighter post stack. See [the previous audit](ULTRA-GRAPHICS-AUDIT.md) for current seam fixes and existing renderer constraints.

## Approval 1: color

Make Cold Steel, Deep Noir, and Neon Night from the same seed, camera, combat poses, and lighting. Start in the middle with Deep Noir: cool blue-gray shadows with visible detail, muted distant signs, warm practical lights, and neutral asphalt beneath the action. Compare color and grayscale, empty and crowded. No weather or decorative particles in these reference shots. Pick one grade before producing the final atlases. Establish three named palette groups (environment, fighters, gameplay cues); bake environment and fighter material colors, but protect warning colors and HUD. Do not rely on a per-frame screen-wide filter.

## What gets baked

| System | Fully baked | Semi-baked: prebuilt art, live control | Live / not baked |
|---|---|---|---|
| City and atmosphere | Modular skyline plates, building surfaces, windows, roof silhouettes, moon and haze plates | Layer parallax; rare window or sign changes; optional distant train assembled from a sprite and a path | Camera projection, viewport coverage and layer visibility |
| Bridge | Asphalt grain, steel bevels, worn paint, drains, puddle roughness and receiver masks | Wetness weight; fixed lamp reflected shapes clipped to puddles; a small ripple stamp only where wet | Moving figures' reflection placement and occlusion, if the comparison warrants it |
| Lights and shadows | Fixed lamp pools and halos, fixed-prop shadows, unobstructed light masks | Lamp gain; contact shadow stamps; caster shape reused from fighter geometry and clipped to the lamp pool; material response ramps | Moving blockers, actual foot contact and pose-driven shadow direction |
| Fighters and combat | Cloth, skin and blade tone ramps; hit and smear stamp art | Pose-driven material shading and rim; one brief hit stamp at contact; direction-aligned blade smear | Poses, silhouette, depth order, weapon position, hit timing, telegraphs, input and gameplay |
| Weather (later, opt in) | Rain streak and splash shapes, fog textures | Streak brightness near lamps; local splash and ripple stamping | Drop movement, wind, impact location and lightning timing when enabled |
| UI and post | HUD icon art and other constant textures | Selective lamp and emissive halos from their baked masks | HUD values; accessibility preferences; effective tier and performance limits |

A moving lamp, broken prop, or displaced object cannot use a shadow fused into the base plate. Store its contribution separately. Bake once per art/seed variant or prebuild fixed assets; cache by seed, palette, and resolution class. Use the existing ledger and don't rebake the world on a quality change. Keep matches deterministic, tile edges padded, and road receivers clipped to the rolled world camera. Set budgets from browser and device measurements, not software render timings.

## Production order and gates

1. **Clean baseline.** Decorative particles start OFF; B can restore them for comparison. Add a weather-free capture mode (freeze atmosphere and omit rain, splashes and lightning; no weather redesign in this phase). Capture High and both Ultra optics routes at matched camera, seed and poses. Include grayscale and a crowded movement clip.
2. **Show the three grades and stop for approval.** No final atlas rebuild before the palette pick. Reject any grade that hides the player, weapon or incoming telegraphs behind city signage.
3. **Finish one lamp-and-puddle span.** Use one amber light, quieter skyline behind the action, distinct asphalt/metal/glass finishes, localized reflections, and tight foot contacts. Compare both optics routes in pan, jump and roll; no new line at the fight rail. Tune local contrast and bloom before adding assets.
4. **Expand across the bridge and city.** Add skyline families and sparse landmarks, readable enemy silhouettes and economical impact cues. Keep movement and hits crisp; only direction-aligned blade or dash smears, no global blur. Let liveliness come first from actors, parallax and occasional far-off activity—not constantly moving screens of noise.
5. **Optional weather approval.** Only after the still and moving scene looks finished, try sharper, faster rain at the same drop count. Give it local lamp color, small scattered splashes and limited puddle ripples. Keep particles separately switchable and retain reduced-motion protections. Leave weather out of the approved grade comparisons.
6. **Release check.** Review on desktop and a nominated mobile device, full and reduced motion, both optics paths, portrait and landscape, DPR changes, quality shedding and reseeds. Compare warm p95/p99 frame time and atlas bytes to the same scene at baseline; report any regression and remove distant decorative passes first. Check that no tier hides core combat cues or changes collision.
