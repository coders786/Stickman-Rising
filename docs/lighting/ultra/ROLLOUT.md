# Deep Noir bridge rollout

[Current production-render still](deep-noir-live.webp). This is the shipping scene art, not the older clean amber experiment. Scene art stays stable when quality sheds: changing tier changes draw budgets, not the grade or skyline seed.

## What changed after review

- **Palette and materials:** Deep Noir is the normal bridge art direction. Keep cool city and steel against the steady amber practical. Dark matte player cloth remains distinct from the blade. The most common enemy finishes are less bright, without changing their weapons, warning colors, pose solver or hit geometry. The heavy and assassin still differ by visible mass and weapon silhouette.
- **Visual priority:** The first moving comparison had a teal sign that pulled attention as the camera panned past the lamp. The Deep Noir bake now attenuates the mid-city glyph and its wall spill together. A few tiered and spire crowns break up the nearby tower outlines in the skyline bake; procedural positions are unchanged. Reduced capture bloom leaves more detail around the weapon.
- **Wet optics:** The bulb, shaft, pool and cast-shadow color share the amber practical. Both routes reduce scene/actor reflection contrast. Wetness remains a deck-space mask. Rain now travels 22% faster at the same visible drop budget, with narrower, quieter cores and one bounded warm highlight path through the lamp cone. Secondary ripple rings only appear on wet patches and are capped at five; they do not deform the entire road or sample the scene. Stable storm RNG keeps lightning cadence independent from drop movement.
- **Clean comparison:** Decorative particles and floating dust stay off by default. `/?ultraReview=amber` on the development server pauses weather for visual review. Production has the new art and rain; the HUD remains outside the grade and scene optics.

## Reproduction and validation

- `node --import tsx scripts/capture-ultra.ts --live-art` — matched High/Ultra stills using live art, including a mixed enemy crowd, jump, impact roll and a natural lightning state.
- `node --import tsx scripts/capture-ultra.ts --motion out/ultra-motion` — scripted two-second walk, jump and roll rendered at 20 output frames per second, with 60 simulation steps per second. The three animated WebPs are reduced-size review previews, not hardware measurements or interchangeable with source art.
- `node scripts/verify-lossless-art.mjs out/verified <image> [...]` — exact sRGB RGBA comparison, verified selection of the smaller encoded result, content-hash reuse, original fallback and separate decoded byte counts. The live still went from **886,509 to 638,832 bytes** with identical **3,686,400 decoded RGBA bytes**. That reduces transfer/storage, not decoded memory.
- Browser smoke: production build in headless Chromium using the software fallback; 800×480 landscape, then 390×844 at DPR 2. Started a live Ultra run, moved past the lamp, resized, and saw no page exceptions. The governor reached Low during the run/resize in this environment. This is evidence of working fallback and not a pass for sustained Ultra on hardware.
- Release gate: type and boundary checks passed; 437 tests pass, with five unrelated combat/animation failures reproduced on the original base. Node render benchmark passed its internal budgets; it does not measure browser FPS.

## Not signed off

The rollout does not certify all master-plan acceptance gates. Full device pacing and accessibility checks are open. The repertoire uses existing baked geometry and visual cues; a new bespoke animation library, extra skyline vehicles, physically distorted puddle reflections and a full asset repack were not shipped in this pass. No performance target has been marked met based on software captures.
