# Bridge material and loading pass

> The pavement and interior art remain in use. See [the current specular bake](BRIDGE-GLAZING.md) for the updated storefronts. The two-second UI and measurements below are historical; see [Night Crossing](NIGHT-CROSSING.md) for the current readiness-driven loader.

The bridge keeps its side-on art direction, collision and existing [SACR v4 transport](../IMPORTANT.md). This pass adds detail to the materials the lighting already sees, rather than applying a full-screen filter.

- **Asphalt and steel:** The wearing course has world-anchored repairs, aggregate and chipped lane paint. Drains, girder edges and bolts have their own bevels and wear. Paving beneath the Metro eave has staggered joints and muted variation—not a wet reflection painted into the dry zone. The worker-painted albedo and direct fallback share the geometry. Recovery draws the same course and stripe anchors at lower detail.
- **Storefronts:** Pendants light finite patches of the back wall before the furniture is painted, so shelves, counters and seating read at different depths. The rough-glass pass gives the transmitted interior more weight head-on and follows a Fresnel curve toward grazing angles. It still samples the admitted same-seed optical window and clips the return to the actual glazing behind foreground steel.
- **Budget:** No new public textures, presentation surfaces, or optical reads. All detail uses the existing baked/direct paint paths, and the existing road and glass receivers still own the wet and reflected light.

## Two-second loading screen

Every accepted **Engage** and **Retry** immediately shows **Night Crossing — Loading arena** for at least **2,000 ms of foreground time**. Preparation starts behind the panel while the two-second interval runs. If the render surface is not ready after that, the panel remains up and reports the real restore state. Combat, input and music start only after a complete world + HUD submit. The brief **Route Online** cue that follows does not block play.

The wait belongs to one run request, not a timeout that could fire after Cancel. Hidden time does not count. Cancel and Escape still work, touch and Reduce still respect the interval, and cancelling Retry keeps the previous Results frame and focus. No animation download was added.

## In-game stills

- Night Crossing: [desktop Engage](../research/bridge-materials/night-crossing-desktop.webp) and [touch Retry with Reduce](../research/bridge-materials/night-crossing-touch.webp).
- Seed 42: [Metro shelter (Canvas)](../research/bridge-materials/metro-shelter.webp), [Night Market dry](../research/bridge-materials/market-dry.webp) and [with a wet road sample](../research/bridge-materials/market-wet.webp), [Sky Garden (Master)](../research/bridge-materials/sky-garden.webp). The Market images use the same Master camera and pose; the wet sample is a QA weather control, not a new texture or a change in route weather.

## Verification

[Release receipt](../research/bridge-materials/verification.json), build `AHv7FNwv5ff7lCCRVmTxt`. On the served build the loading panel stayed mounted for **2,082 / 2,042 / 2,044 ms** (Engage / Retry / Menu → Engage, rounded). Desktop WebGL, portrait touch + Reduce, and 720×360 touch + Reduce were also above 2,000 ms on every attempt. These are headless browser DOM timings, not physical display or device benchmarks.

- Held-surface checks verified no early music, input or GL publish, and early Cancel and retained Results. The first visible gameplay frame was a complete tick-zero starter. Real WebGL context loss fell back to Canvas and restored Master; the coverage/teardown check left no retained world or HUD bytes.
- Canvas, Optimized, Master and the denied worker + city asset path all kept reflected pixels inside the glazing. The live build served the exact staged root and all 21 unchanged Bridge assets, and trusted input reached play inside a cross-origin iframe.
- **214/214** Bridge tests, **17** offline GLSL program links, and the isolated production build passed. The full suite passed **598/603**; its five failures match the previous release's combat/animation failures.

Use the browser setup in [Game loading](GAME-LOADING.md#reproduce). The natural-load fixture measures the actual modal lifetime from trusted input, checks that preparation runs under it, and verifies a jump after the handoff. The held-surface fixture checks early Cancel, slow readiness, and Retry returning focus and the intact Results frame.

```bash
npm run check:bridge
npm run build:iso
SR_SOFTWARE=1 node .qa/slasher-load-visible.mjs --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-load-visible.mjs --touch --reduce --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-interlude.mjs --touch --reduce --deny-loading --cpu-compositor
node .qa/slasher-interlude.mjs --gl --cpu-compositor
node .qa/slasher-shop-glass.mjs --cpu-compositor --wet-shot
SR_SOFTWARE=1 node .qa/slasher-shop-glass.mjs --canvas --cpu-compositor --wet-shot
```
