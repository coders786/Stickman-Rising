# Night transit viaduct

`comparison.jpg`: top is the former rooftop, bottom is the street rewrite. Same 1000×520 view, seed `0xa17e`, pose, weather time and Ultra desktop pipeline. Reproduce the lower panel with `SR_DESKTOP_LIGHT=1 SR_LIGHT_RIG=1 node --import tsx .qa/capture-fighters.mts /tmp/viaduct.png`. The capture stages the poses; the test below uses the simulation.

## Geometry and contact

The lower-city plate overlaps the moving skyline instead of filling from its baseline with one dark colour. A separate world-space road shows the district through its pier bays. In `src/game/stage/road-section.ts`, −52 and +52 mark the projected edges of the asphalt and 0 is the fighting lane. Negative actor Y still means height **above that lane**. The rear sidewalk is scenery, not a second collision plane. Supporting a foot with two-bone IK is separate from integrating the fighter; each boot has its own near-contact occlusion. Enemy side sweeps check vertical overlap and a launched enemy settles on the first floor crossing rather than waiting for a subsequent AI update.

## Lighting and generation

Two Epic rendering references informed the design:

- [Volumetric Fog](https://dev.epicgames.com/documentation/en-us/unreal-engine/volumetric-fog-in-unreal-engine): adapt extinction and in-scattering to a height-dependent facade veil. It is baked into occupied pixels, not a translucent rectangle across the skyline.
- [Rendering in Unreal Engine](https://dev.epicgames.com/documentation/unreal-engine/introduction-to-rendering-in-unreal-engine-for-unity-developers?lang=en-US): adapt precomputed lightmaps and material roughness. Seeded wet regions affect the asphalt colour, curb-light reflections and practical-light specular lobes. The amber curb strips and their bounce are baked together; the larger fixtures retain live light gains. These are 2.5D approximations, not UE, Lumen or a volumetric ray marcher.

The district, beam and road are retained surfaces generated locally from the run seed. No new runtime dependency, art download or network service. `node --import tsx --test tests/viaduct.test.ts` checks continuous district coverage across tile joins, seed repeatability, simulated sole contact and high-speed collisions.
