# Night Crossing: fixed viaduct

> This records the fixed-viaduct release. [Storefront glass](BRIDGE-STOREFRONTS.md) supersedes its upright mirrors, building motions and visual loading handoff without moving the rail or the bridge. The current [Ronin reveal](NIGHT-CROSSING.md) replaces its loading presentation.

The rail deck, piers, overhead wire anchors and lower court now use the same camera transform as the playable bridge. The rail model scale only converts dimensions; it no longer changes with viewport height or camera Y. Panning, jumping, zooming and camera roll move all those anchors together. The lean emergency painter uses the same rail and footing datums without waiting for an image. Combat framing, road geometry, raised platforms, mirror reflections and collision are unchanged.

Scheduled trains still cross in both directions. The timetable, beam occlusion and wake resolve the same native rail coordinate from world X. The lower road traffic and its independently scrolling mist are gone. A tiled, car-free maintenance court has glazed annexes, recessed drains and practicals; piers and street dressings are static against the deck.

## Loading

Engage opens on the fighter’s profile. A tighter eye shot and a moving steel close-up follow while a surface is actually being prepared. Retry opens on steel; Reduce keeps a still profile. The artwork is an authored SVG silhouette with CSS cuts, a blink, scarf movement and a blade glint. There is no poster/animation download or minimum playback time. The live stage, Cancel, Escape, and return focus remain separate from the artwork. A first complete world+HUD submit, not the cut timeline, admits input and music.

## Glass and bake

Train windows show through a translucent acoustic screen with fixed joints and reflected streaks. Mid-city lifts move inside a few baked glass shafts in Canvas and WebGL; sparse mast lights blink without pulsing the whole facade. The distant skyline keeps its depth placement and optical lookup. The Track Watch mirror still projects view-dependent reflected figures and fixtures.

The art baker feeds straight RGBA to WebP without a PNG encode/decode trip. The two distant albedo cards are high-quality RGB WebP with exact alpha; props, the court, pier, and mirror remain lossless. The optical basis is derived separately from the painted geometry, before color compression, and remains linear RGBA8 with Brotli transport. Retired sky/prop blobs and the rejected loading poster aren’t shipped.

Within the optical worker, shadow, irradiance, and directional records now share their final contiguous tile layout. LZ4 still runs only on cold eviction, and raw windows are still transferred together. The archive reader respects each view's offset: a revisit restores the actual direction grid, rather than reinterpreting the first portion of a decompressed tile as vectors. This does not alter the SACR ABI, mips, curb/portal format, or transfer budget.

## Verification

[Profile](../research/bridge-stable/loading-profile.webp) · [Eye](../research/bridge-stable/loading-eyes.webp) · [Steel on touch](../research/bridge-stable/loading-steel-touch.webp) · [Rail and court](../research/bridge-stable/rail-and-court.webp) · [Same train clock during a jump](../research/bridge-stable/rail-on-jump.webp) · [Portrait](../research/bridge-stable/rail-touch.webp) · [Measurement receipt](../research/bridge-stable/verification.json)

- **Stable structure:** At a fixed train clock, an 84 world-px desktop pan moves a mast **94.89 CSS px**, exactly the deck displacement; the prior build moved it **21.56 CSS px**. The jump moves the deck, rail and footing by the same **28.93 CSS px**. Zoom preserves the train’s world position. Advancing only time moves the train while every mast stays put.
- **Under-deck work:** At 984×610 with plates decoded, the old painter used **6 blits and 45–50 fill rectangles** at the two tested clocks. The new one uses **2 blits (no fill rectangles)** at either time, with zero clock-only pixel changes. This counts only that layer, not overall frame time.
- **Asset payload:** The active scenery and old loading-art set drops from **739,285 to 589,756 bytes** (**20.2% smaller**, excluding unchanged packed textures and app JS/CSS). The two skyline cards preserve all alpha bytes; the visible mean RGB error is under 1.7 steps per channel on the 0–255 scale for matched art inputs. Non-city optical planes are byte-identical. Including unused-blob removal, the full public Bridge tree is down **1,987,871 bytes**, not all of which were requests in the old game.
- **Archive:** In a 24-tile matched-seed corpus, LZ4 still stores **3,183,740 of 12,779,520 bytes**, with identical compressed output. Each eviction avoids a **532,480-byte** repacking copy. Median pack batch fell **67.6 → 62.9 ms**; cold window and archive revisit medians stayed around **67 / 27 ms**. The **1,593,856-byte** opening window is unchanged; in the new build, returning after eviction recovers those same bytes including the vectors.
- **Startup:** Three alternating desktop samples per build (fresh Chromium, CPU compositor) passed trusted jump and movement on both sides of promotion. Median Engage/Retry first submits were **58.7 → 62.6 ms** and **22.7 → 41.5 ms**. The single emulated-touch pair was **63.5 → 84.7 ms** and **34.3 → 52.7 ms**. The workload and payload improvements do not establish a startup speedup.
- **Regression:** 210/210 Bridge tests, 17 exact offline shader links and the standalone build passed. The full suite passed 594/599, with the same five inherited combat/animation failures. The older Metro warm-torso fixture also fails on the control; the separate current direct-light, mirror and transfer checks cover Canvas and both WebGL tiers. Browser timings are software Chromium/emulated touch, not handset FPS or display scanout.

## Reproduce

See [production startup tools](GAME-LOADING.md#reproduce) for `SR_QA_URL` and browser setup. The browser fixtures freeze clock/pose to isolate changes. Only the test fixture deliberately holds publication to inspect all the loading cuts.

```bash
npm run art:bridge-webp
npm run art:bridge-lighting
npm run check:bridge
npm run check:webgl:offline -- --require-compiler
npm run build:iso
node .qa/slasher-interlude.mjs --cpu-compositor
node .qa/slasher-interlude.mjs --touch --reduce --deny-loading --cpu-compositor
node .qa/slasher-rail-lift.mjs --cpu-compositor
node .qa/slasher-rail-lift.mjs --touch --gl --cpu-compositor
node .qa/slasher-under-deck.mjs --cpu-compositor
node .qa/slasher-bridge-coverage.mjs --gl --cpu-compositor
node .qa/slasher-v4-stream.mjs --touch --cpu-compositor
```
