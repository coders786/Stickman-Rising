# Graphics presets and Adaptive Resolution

Every viewport offers the same four presets. A preset locks both its feature
set and scale target. The rendered backing can be capped separately. The device suggestion is only a first-run default.
Selecting a preset turns Adaptive Resolution off. Explicit v3 choices persist;
older saves keep their preset without inheriting the old adaptive-on default.

| Preset | Scene scale | Continuous Bridge detail |
| --- | ---: | --- |
| Low | 0.75× | Soft sole contact, sparse rain, static wet materials |
| Medium | 1.00× | Coarse actor reflection and more rain and city detail |
| High | 1.15× | Posed puddle reflection and richer Canvas weather |
| Ultra | 1.25× | Requests WebGL2 HDR when eligible; can use optimized WebGL2 or Canvas 2D |

A setting change never reseeds weather or the route. The HUD backing and
readout remain independent of scene scale. All tiers keep the hero rim,
contact shadow, key gameplay tells and shelter rules. Legacy art fixtures
for visual comparison can still use a fixed diagnostic scale; that is not a
player preference. Master adds receiver shading, light-directed casts and
HDR optics; it is not just a larger Canvas. Paused Settings shows the live renderer separately from the preset. The
[Bridge atmosphere guide](../BRIDGE-ATMOSPHERE.md) lists the current paths and captures.

With **Adaptive Resolution** enabled, one controller tracks a rolling mean of
30 foreground frame gaps (samples capped at 50 ms). Ninety consecutive means
above 20 ms reduce scale by 0.10; 270 below 12 ms recover by 0.10. The floor is
0.75× and the ceiling is the selected preset's locked scale. Pause and hidden
break the sampling window. **Show FPS** has separate smoothing and throttling.
See the [Bridge verification](../PROCEDURAL-BRIDGE.md) for reproduction commands.

## Historical: before the single-resolution governor

Before fixture optics were shared, matched Chromium 153 replays used seed 42, settled drizzle, 1000 × 560 at 1×, the same 98 simulation ticks and fight input. All eight new captures matched the pre-change HUD bytes and combat event digests, weather and framing, with no additional tracked surfaces or surviving surfaces after teardown. Viaduct base-atlas hashes matched at seeds 42–44. The controlled governor check exercised Ultra → Low → Ultra on desktop and Medium → Low → Medium on a phone viewport, with opaque repaints, fixed HUD backing, no night rebake and the selected maximum still saved after reload.

The following counts are pixels with an 8-or-greater change in any RGB channel between adjacent presets at the **same** render scale. They include the existing tier-dependent weather and cast shadows and are a difference check, not a visual quality score:

| Step | Forward | Capture |
|---|---:|---:|
| Low → Medium | 26,821 | 27,556 |
| Medium → High | 22,944 | 21,925 |
| High → Ultra | 4,932 | 12,371 |

In the frozen pre-change scene, the last step changed 3,743 forward pixels and 10,898 capture pixels by the same measure. These are headless render checks, not real-device frame-rate results.
