# Ultra execution: first visual review

[Matched comparison](grade-review.png): **Cold Steel → Deep Noir → Neon Night**, left to right. Color above, grayscale below. The board is a crop of production Canvas2D output at 1280×720, seed 52. No weather, no decorative particles. These are software-rendered posed frames, not browser recordings or performance measurements.

## What the first pass showed, and what changed

- The initial crowd capture reported four hostiles but drew none on the bridge. The fixture left enemies in the entrance state, which kept resetting their height. The next pass poses them in the active chase state at deck level with normal health. The comparison now actually exercises a crowd.
- The player was a near-black cutout beside bright opponents. The grade recipes now supply a dark cloth albedo that remains matte in both shading paths. This lifts broad surfaces subtly without substituting an outline or changing the weapon, HUD, or combat geometry.
- The silver rail and cyan facade accents dominated the lower image. The review grade bakes reduce facade emission and the top rail highlight. The structural rail remains visible; it is not removed or treated as a seam.

## What the second pass shows

Cold Steel gives the player and road a cooler cast. Deep Noir separates the muted warm background sign from the cooler practical and keeps the asphalt closer to neutral. Neon Night gives the same sign a visibly stronger accent and makes the cloth more violet. The grayscale row confirms the grades preserve broadly similar value structure, but the pale enemy line still wins attention. Some reflected enemies remain stronger than ideal, and the large cyan fixture is still brighter than the hero. These are visible next-span issues, not evidence that the artwork is complete.

**Recommendation:** Deep Noir for the next specimen. Keep the muted facade light; test one amber fixture in place of the dominant cyan one, and reduce the actor reflection in that pool before adding new haze or bloom. Review a moving crossing instead of making a global brightness change from this still. Don't ship a grade until it is picked; normal gameplay still uses its seeded art.

Reproduce the full 27 color + 27 grayscale reference files with `node --import tsx scripts/capture-ultra.ts --grades`. The capture directory is ignored. The existing gameplay weather remains independent of clean capture mode. Device motion testing, full-span asset production and release checks remain open.

## Amber specimen

[Same pool in both optics routes](amber-specimen.png), forward on the left and capture on the right. The clean Deep Noir specimen uses the existing lamp location and changes its shared emitter to steady amber. The bulb, halo, shaft, deck light transport, fighter response and practical-shadow hue follow that source. Compared with the earlier cyan image, the pool is warmer and the forward-route enemy reflections recede. The teal architecture is still visible behind it; the review is about this one lamp, not a finished replacement skyline.

- Live development review: open `/?ultraReview=amber` and select Ultra. Walk across the lamp near world x=830. Weather is paused in this mode; normal gameplay is unchanged.
- Rebuild the software stills with `node --import tsx scripts/capture-ultra.ts --amber`. These include idle, pan, jump, crowd and rolled impact, compared on High and both Ultra routes.
- Leave the version opt-in until a moving pass verifies that the shadow and weapon stay readable entering and leaving the pool. Full-span art, final compression measurements and real-device frame pacing remain separate gates.
