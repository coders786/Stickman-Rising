# The Bridge, rebuilt in 2.5D

This is the pre-SACR 2.5D comparison. See [Bridge atmosphere and graphics presets](BRIDGE-ATMOSPHERE.md) for the current presentation paths, or [SACR v3.1](SACR-GRAPHICS.md) for the next historical comparison.

Open the live preview and **Engage**. The route is still continuous: Outer Transit → Market Overpass → Industrial Grid. The new deck, shelter roofs and service cutaways are presentation geometry; the original fight plane, eaves, Catwalk landing heights, pickups, Service Bay rules and Gemini checkpoints still own gameplay.

On a supported fine-pointer desktop, select **Settings → Ultra** to see the Master finish. Unsupported, software-only and over-budget adapters keep the complete Canvas scene. The preset and resolution setting do not silently change when the presenter falls back.

## Matched views

These are game frames, not concept art. The matched pairs use the same seed (42), checkpoint, input fixture, front tick (720), viewport and backing resolution. The desktop after frames are the actual WebGL2 output with the independent HUD composited on top; the 400px after frames use Canvas. Portrait replay stills show the HUD but not the DOM touch controls; the live touch checks exercise the controls separately.

| Checkpoint | Before | After |
| --- | --- | --- |
| Outer Transit · desktop | [Old Transit](../research/bridge-25d/before-transit.webp) | [HDR Transit](../research/bridge-25d/after-transit.webp) |
| Market Overpass crowd · desktop | [Old Market](../research/bridge-25d/before-market.webp) | [HDR Market](../research/bridge-25d/after-market.webp) · [Same frame on Canvas](../research/bridge-25d/after-canvas-market.webp) |
| Industrial Catwalk · desktop | [Old Industrial](../research/bridge-25d/before-industrial.webp) | [HDR Industrial](../research/bridge-25d/after-industrial.webp) |
| Market approach · 400px | [Old approach](../research/bridge-25d/before-touch-market.webp) | [Canvas approach](../research/bridge-25d/after-touch-market.webp) |
| Warm Service Bay · 400px | [Old bay](../research/bridge-25d/before-touch-service.webp) | [Canvas bay](../research/bridge-25d/after-touch-service.webp) |

[Market storefront and lanterns at 400px](../research/bridge-25d/after-touch-market-square.webp) · [Gemini Master](../research/bridge-25d/after-gemini.webp) · [Gemini Canvas at 400px](../research/bridge-25d/after-touch-gemini.webp) · [Rolled eave with the sky bank denied](../research/bridge-25d/after-touch-service-roll.webp)

Live controls: [400px Draw/Slash](../research/bridge-25d/live-touch-market-katana.webp) · [400px boss windup](../research/bridge-25d/live-touch-boss-windup.webp) · [400px Service Bay](../research/bridge-25d/live-touch-service.webp) · [Catwalk landing](../research/bridge-25d/live-desktop-industrial-catwalk.webp).

## What runs in each path

| | Mobile / Canvas fallback | Master / WebGL2 |
| --- | --- | --- |
| Geometry and materials | Three-slot streamed oblique cards, baked bevels and AO, aggregate, recessed drains, girders, catwalk grating, roof returns, dry shutters | Same cards plus camera-relative receiver meshes with mip-filtered normal, roughness and AO data |
| Light and contact | Baked sky, moon, strip and cone transport; one soft contact per actor; up to two live additive receiver lights | Hemisphere + moon/storm; up to 16 point/spot/strip/impulse emitters; lit meshes, local fog cones, projected actor and prop silhouettes with impulse steering |
| Optics | Small half-width, puddle-clipped pose strip; baked wet returns/glows and bounded tint, no blur chain or per-pixel ripple | RGBA16F receivers, wet mask + grazing Fresnel and two ripple bands, moving actor/FX returns, emitter-only bloom above linear luminance 1; four downsample levels and dual-filter upsample |
| Motion | Three rain depths with at most 80 Canvas streaks, bounded splash and footfall rings, short two-link scarf | Up to 350 instanced rain slots and 84 instanced mote/spark slots; same dry boundaries and wet-contact pool; five sampled scarf nodes |
| Grade | Pregraded albedo and blended district tints; localized gate and action tint | ACES fit then lossless 32³ Transit/Market/Industrial/Boss LUTs; gate blend up to 35%, cold-blue Execute/Overdrive response on the action clock |
| HUD | Separate device-pixel HUD. No lighting, blur or tint samples the HUD. | Same HUD and DOM controls, composited after the graded world. |

Both paths share the anchored foreground, cutaway, clock, receiver lengths and socket positions. Stationary art is baked; rain, depth drift, monorail, cables, lanterns/hooks, pressure-responsive wind and steam are drawn from interpolated state. Hits add a colored rim and a limited inner tint, not a white body replacement. Dry cover removes wet reflections, splashes and exterior precipitation; a local impact still reads on the dry material. The visual meshes do not insert a second collision world.

The Master presenter requires WebGL2, `EXT_color_buffer_float`, complete half-float FBOs and an independent HUD/output. Its hard viewport admission ceiling is 3.4 million scene pixels at 1.25×. It also rejects reported software adapters in normal play. It accepts only the existing Ultra desktop route; scale and FPS display are still controlled by Settings. Loss, refusal, Inspect and resizing release the GPU resources and transparent actor surface without removing the Canvas scene. The six prop cards and their six cast masks share one guarded atlas; the ledger cap did not increase.

## Asset transport

There are no shipped texture downloads for the new Bridge geometry. Cards are code-generated. The Master data uploads are lossless linear-channel RGBA8: normals in RG with roughness/AO in B/A; the deck receiver packs AO, roughness, puddles and emissive in RGBA. Diffuse receivers stay below the HDR threshold; lights, sabers and arcs inject separate emissive energy.

`npm run art:bridge-data` writes lossless PNG and raw+Brotli authoring sheets to the ignored `out/bridge-data/` directory, including 256×16 and 1024×32 LUT strips. Master uploads the 32³ nodes directly for trilinear lookup; Canvas uses the tint fallback, not a runtime 16³ lookup. The WebP files linked above are **screenshots only**. No KTX2/ASTC/BC7/BC5 transcoder, MSDF font conversion, WebGPU backend, or Opus conversion is part of this procedural build. If authored texture assets are added, keep normals and LUTs lossless in authoring, use UASTC (not ETC1S) for normal/ripple data, and reserve ETC1S for eligible mobile color assets.

## Verification and limits

- Production build and typecheck passed. `npm run check:bridge`: **134/134**. `npm run gate`: **518/523**, with exactly the five pre-existing combat/animation failures from the frozen control. Boundary audit: 20 known, 0 new.
- All five matched pairs have identical fixed-step gameplay state and event digests. Four HUD surfaces match byte-for-byte. In the fifth (Service Bay), only the world-anchored prompt moves by roughly one pixel with the new idle sway; the vitality, sector/distance and score panels are unchanged.
- The production browser exercised real `WEBGL_lose_context` loss/restore, Inspect entry/exit, viewport denial/re-admission, resize and Engage/Retry. It also tested explicit float-target and surface denial and default software rejection. Destruction left zero tracked backing and a zero-sized finish canvas.
- In the same rolled Service Bay frame (0.09 rad), toggling rain changed exposed pixels on both paths and **zero** dry interior samples (over 20,000 sampled pixels per path). The 400px scenes and the matched desktop scenes stayed under the backing ledger caps.
- Master was exercised on software Chromium with an explicit QA-only override. This proves the shaders, FBOs and output path, **not** real GPU frame time. The mobile budget is a design target, not a guarantee of 60 FPS on physical phones. The locked backing settings were retained; there is no new automatic 1080p clamp on the user's preset. See the [receipt](../research/bridge-25d/verification.json) for captures, allocations and browser cadence.

### Production browser receipts

| Check | Desktop · 1180 × 660 | Touch emulation · 400 × 844 |
| --- | ---: | ---: |
| Engage + Retry traversals | 21/21 | 21/21 |
| Shortest traversal (two gates, three shelters) | 10,630.15u | 10,630.15u |
| Peak streamed road plates | 3 | 2 |
| Peak tracked backing during the fixed-step soak | 23.46 MiB | 19.73 MiB |
| Live tracked backing after teardown | 0 | 0 |
| Locked Ultra backing during 30 s cadence capture | 1475 × 825 | 500 × 1055 |
| Foreground frame gaps, p50 / p95 | 50.1 / 83.3 ms | 33.3 / 49.9 ms |

The soaks use actual Engage/Retry actions, fixed simulation steps, and planted gate checks. The cadence rows are separate, real foreground callbacks on the software-adapter Canvas fallback with unchanged 1.25× backing (534 and 1,073 frames respectively). They do not meet a locked 60 FPS target in this sandbox and do not measure the performance of Master on a physical GPU. Live checks also passed Settings, service/execute/Overdrive, catwalk landing/drop, boss windup, Draw/Slash, pause/cancel and the flat touch compositor.

### Reproduce

Launch the production preview as in the [continuous route guide](PROCEDURAL-BRIDGE.md). Use the isolated browser dependencies described in [slasher-replay](../.qa/slasher-replay.mjs) and set `SR_BROWSER_TOOLS` (and `SR_QA_URL` if the app is not on port 3000).

```sh
npm run check:bridge
npm run art:bridge-data
node .qa/slasher-bridge-finish.mjs
node .qa/slasher-bridge-finish.mjs --deny=float
node .qa/slasher-bridge-finish.mjs --deny=surface
node .qa/slasher-route-visuals.mjs --touch
SR_SOURCE=src node .qa/slasher-replay.mjs --scene=route --route=forward \
  --tier=ultra --scale=1.25 --width=1180 --height=660 --seed=42 \
  --fixture=crowd --at-x=7140 --front-tick=720 --fixed --warmup=24 --frames=44 \
  --master --master-once --trace-state --stages --empty-teardown --pixels=out/market
```

`--master-once` draws the final fixed frame through GL and makes full-resolution software captures practical. Those timestamps are not performance measurements. Omit that flag for a continuous Master run. Do not use the clean base commit as the graphics control: the before stills came from the dirty, already-remediated Bridge tree.
