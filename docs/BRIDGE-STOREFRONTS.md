# Bridge storefront glass

> Historical release. The [current glass](BRIDGE-GLAZING.md) uses the new specular bake; the [material pass](BRIDGE-MATERIALS.md) documents interior art. See [Night Crossing](NIGHT-CROSSING.md) for the current loading screen. The comparisons and timings below are for the earlier storefront release.

The Metro Link concession and the district shops now have glazed fronts, not stand-alone mirrors. The old Track Watch and Security Mirror housings, lamp, shadow blockers, curb motif, and WebP are removed. The loading and storefront changes leave the bridge, rail positions, cover boundary, collision, and [SACR v4 contract](../IMPORTANT.md) intact.

## Glass and materials

- One world-space aperture layout drives the worker-painted albedo, the starter painter, and the reflection. Warm, readable interiors sit behind each pane: shelf stock, counter hardware, pendant lights, seating, and a doorway. The sill, tile grout, metal seams, rubber gaskets, and edge grime are part of the authored material, not strokes pasted over the scene.
- Reflected points are mirrored about the pane's Z plane. The ray from the side-view eye to the virtual point intersects the pane. Fixed-depth layers use the same transform across adjoining panes. The opposite-bank layer reuses the baked city geometry and albedo. Nearby catwalks, poles and practicals use their actual world records. Changing eye position changes the return without moving a single mullion. Road wetness is not a light switch for this glass.
- Sky and lunar terms sample the admitted same-seed worker window at projected world addresses. Baked sky access and finite-source lunar shadows attenuate those terms; baked practical radiance shades the reflected steel. A small return from distant storm light remains possible under a canopy. This is a layered, rough-glass approximation, not full-scene ray tracing or a copy of the live fighter/HUD.
- The reflected pass stays in the existing Canvas world or WebGL actor input, behind real actors. Its pane clip subtracts the near-side platform and lamp ink. There are no extra canvases, uploads, or pixel readbacks. A bounded path cache holds up to nine openings; at most three fronts and five sky taps per front are drawn. If the city image or optical worker is denied, the silhouette and glass remain; no old seed supplies optical data.

The skyline no longer has cyan cabs constantly travelling up and down. A few muted lifts make occasional independent trips between landings; warm room lights settle for tens of seconds inside fixed apertures. Quiet mode parks the cabs and leaves the room lights still. City cards, their masks, and the rail backdrop are unchanged.

## Engage and Retry

The old UI mounted and removed the whole cut reel in the first few frames. In one ordinary emulated-touch start no compositor capture sampled the interlude at all. Also, Results → Arsenal → Back returned to the *title UI* without leaving the game-over phase. The user could see the last fight behind the title and press Engage on what remained a Retry.

Engage and Retry now commit the loading UI on the accepted gesture. If preparation is held, Cancel, Escape, reduced motion and the actual restore status still work. The first **complete world + HUD submit** replaces the modal immediately with a small **Route online** cue, already over a playable run. The cue carries the artwork for about 1.4 seconds and never captures input or gates the game clock or music. No minimum loading time or animation download was added. Results → Arsenal → Back returns to Results; Menu hides the old frame and combat HUD until the current title submits.

## Verification

[Metro Link (Master)](../research/bridge-storefronts/metro-link.webp) · [Night Market (Canvas)](../research/bridge-storefronts/night-market.webp) · [Sky Garden behind the catwalk (Canvas)](../research/bridge-storefronts/sky-garden.webp) · [Night Market (portrait Optimized)](../research/bridge-storefronts/night-market-portrait.webp) · [Desktop Retry](../research/bridge-storefronts/route-online-desktop.webp) · [Touch Retry](../research/bridge-storefronts/route-online-touch.webp) · [Browser and build receipt](../research/bridge-storefronts/verification.json)

The browser fixture measured a change in the pane pixels in all three renderers, with **zero changed pixels beyond the pane-edge tolerance** or in the catwalk fascia probe. Opening just the baked shadow terms changed the return; panning changed what the glass reflected; changing only road wetness and time did not. With both the city card and workers denied, the glass still drew an independently projected silhouette and transmitted interior. These are application raster/DOM checks in Chromium, not on-device display timings.

The release passed **211 Bridge tests** and linked **17 offline WebGL programs**. The full suite is **595/600**: the same five combat/animation tests fail as in the previous preview. The served entry page, its 13 immutable bundles and all 21 Bridge assets matched the staged bytes. The old mirror URL returns 404. The six WebPs reproduced byte-for-byte offline, and none of the packed-v4 files changed. The live cross-origin iframe accepted a real Engage; the regular and short viewport tests checked that the cue stays inside the screen and clear of touch controls.

To reproduce against the production preview (browser setup in [Game Loading](GAME-LOADING.md#reproduce)):

```bash
npm run check:bridge
npm run check:webgl:offline -- --require-compiler
npm run build:iso
node .qa/slasher-load-visible.mjs --cpu-compositor
node .qa/slasher-load-visible.mjs --touch --reduce --cpu-compositor
node .qa/slasher-load-visible.mjs --short --touch --reduce --cpu-compositor
node .qa/slasher-interlude.mjs --touch --reduce --deny-loading --cpu-compositor
node .qa/slasher-shop-glass.mjs --cpu-compositor
node .qa/slasher-shop-glass.mjs --optimized --cpu-compositor
node .qa/slasher-shop-glass.mjs --touch --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-shop-glass.mjs --canvas --deny-city --deny-worker --cpu-compositor
```
