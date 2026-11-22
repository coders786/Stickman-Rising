# Ronin: flat black ink

The playable Ronin's body, hands, hair and scarf are flat black on Canvas, Optimized and Master. The six incident-light samples and source-facing pigment gradients no longer run for him, even on the worker-free opening path. Master and Optimized keep the existing black swatch in the final grade so bloom and the film curve do not lift opaque ink. Antialiasing, authored echoes, hit flash and things drawn in front of him are still visible.

This changes pigment, not the pose, blade grip, contacts, movement or combat. The Ronin is still a caster and a reflector. His steel still emits into the world during a strike. Enemy and prop materials still receive light, and the sky, rain, wet paving, glazing, shadow sources and HUD are independent. The Engage/Retry reveal art is unchanged.

In fixed seed-42 gameplay captures, the shaded build called the Ronin's fixture receiver six times per frame; the flat-ink build called it zero times. The isolated unlit pose hashes match, including a live sword strike. Whole scenery frames need not match because the Bridge paint also changed.

See the [Bridge rendering update](BRIDGE-RENDER-RECOVERY.md) for the separate Retry fix, scenery changes, and how to reproduce the checks. The [shaded comparison](../research/ronin-lighting/comparison.webp) and its [receipt](../research/ronin-lighting/verification.json) record the retired renderer, not the current appearance.
