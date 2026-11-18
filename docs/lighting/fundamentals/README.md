# Four lights on the roof

`stage.jpg`: cool spotlight on the left, violet point beacon near centre-right, amber rectangular doorway on the right. The moon is the distant directional key. `comparison.jpg` shows the original close shot above and the new rig below. These are gameplay renderer captures, not concept art.

| Source geometry | Use on stage |
| --- | --- |
| Directional | One world-space direction and reach for moon-cast fighter and prop shadows; no local pool or camera-distance attenuation. |
| Point | The violet service marker spills in all directions within its radius and colours nearby fighters. |
| Spot | The streetlight aims down and across the lane. Inner and outer angles control full intensity and a smooth penumbra. |
| Rect | The doorway emits forward from a finite aperture. The two opaque wings cut off its spill and partially cover its surface at shadow edges. |

Geometry is separate from palette. Local angular response, visibility and deck response are baked; fighters sample the ribbons. Lower tiers use one precombined deck draw rather than letting whichever emitter entered the frustum first consume the pool budget. Extra blits restore live modulation on higher tiers. Guard rows isolate atlas strips. The moon no longer behaves like a point attached to the camera. Secondary shadows and post rays fade during source handoffs instead of snapping to the opposing light. The lamp retains mild ballast movement, not a strobe.

Checks: `node --import tsx --test tests/fundamental-lights.test.ts` covers shape response, competing-source transitions, 120 Hz gain continuity and identical pixels on a shared world patch across camera pans and tier round-trips. `SR_DESKTOP_LIGHT=1 SR_LIGHT_RIG=1 node --import tsx .qa/capture-fighters.mts /tmp/rig.png` reproduces the wide shot. Production Chromium, Ultra, DPR1, 1000×520, 240 uncapped gameplay intervals: 148.7 callbacks/s average, 18.8 ms p95, zero frame errors. Not a physical display benchmark or a sustained 90 FPS guarantee.
