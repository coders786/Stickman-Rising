# Bridge: first playable frame and recovery

This update follows the [Bridge shadow release](BRIDGE-UPDATE.md). It keeps the [SACR v4 contract](../IMPORTANT.md): the 3,584-byte live packet, 80 columns, Master/Optimized record and light budgets, and separate baked transport, pose returns, and emission.

> This is the original handoff release. The [current Night Crossing loader](GAME-LOADING.md#current-opening-contract) supersedes the starter-frame scheduling below. Engage and Retry now wait for the complete opening renderer, post chain, world and HUD before releasing the suspended run.

## What the missing arena showed

In the supplied **0 m / 92 HP / two threats** screenshot, all 179,200 pixels in the road-area crop (1120 × 160 at x=747, y=838) are `#16191C`, the Canvas sky underpaint. The other screenshot shows a complete arena at 36 HP. That locates the exposed layer; a still image cannot tell whether an interrupted paint, context loss, or another presentation failure exposed it. A deliberately interrupted source paint tests the repair without assuming that was the original trigger.

## Submit the arena before opening combat

- **Engage and Retry** acknowledge the real gesture and allow cancellation. The first run submit contains the road, rails, authored section bounds, fully solved limbs and weapons, actual opening threats, and current HUD. It uses the real route and pose, not a loading screenshot or a sim step to make the rig valid. Input and music open only after this submit. Rich scene work, worker admission, and shader linking wait through the first 0.18 s of simulation. Shared asset downloads can warm independently on the title.
- **Complete Canvas fallback.** Two world canvases alternate ownership. The visible Canvas front is not cleared or resized to paint the next scene. GPU rendering samples the hidden work canvas and presents above the last complete Canvas frame. The fallback can be older than the most recent GL pose; the next successful recovery submit is the current pose, not a replay. No runtime readback from the game canvas is needed for the handoff.
- **Failure and recovery.** If the full painter throws, an independent painter submits a road, actors, threats and HUD that same turn. If neither can paint, the complete front stays up, the separate HUD is hidden, and combat stops until a successful repaint. A HUD context loss can use an in-world HUD until the separate layer returns. Hold drops time debt and stale action edges; it does not undo an accepted simulation tick. Resize scales the retained front without clearing its backing. A restored 2D context is not assumed to have restored pixels. Cancelled Retry does not change the Results card or redraw the new run beneath it.
- **Streaming.** Optics and plate workers are separate lanes with one outstanding job per lane. Retry retains the workers and reusable GPU storage, but invalidates run-specific windows, plates, sky, and pending replies, even if the seed repeats. Uploads preserve the previous complete group until the new same-run group commits; parry and hitstop defer that work. The [versioned bakes](BRIDGE-FAST.md) have local or procedurally painted fallbacks. The grade pack resolves as a group before its four volumes upload. A denied or invalid pack does not publish partial data.

## Framing, light and weather

The railway and lower street bearings use the same bounded camera-lift term. The road still follows the combat camera. At the same world X and train time, a real jump that lifts the fighter 129 world px moved the rail and its footings together:

| View | Prior rail / footing motion | Updated rail / footing motion |
| --- | ---: | ---: |
| Desktop, 984 × 610 | 14.79 / 28.93 CSS px | 2.56 / 2.56 CSS px |
| Portrait, 400 × 844 | 20.46 / 40.03 CSS px | 3.54 / 3.54 CSS px |

Train scale and horizontal position stay unchanged in both poses. The [desktop](../research/bridge-handoff/train-jump-desktop.webp) and [portrait](../research/bridge-handoff/train-jump-portrait.webp) shots keep the full jump in view.

Practical illumination on actors comes from two separate finite, occlusion-tested fixture samples at each of six posed taps. Their spectral and directional responses stay separate on the existing contours; baked fixed-surface RGB is not added onto actor fill. The dynamic-only combat receiver and source-specific cast transport remain separate. Props have three deterministic variants per kind. Their body painter, receiver mask and blade sweep share an outline; contact bounds and health use the same socket variant on return to a culled section. The v2 WebP caches pigment only, with the same painter available under denial and no runtime prop-atlas readback.

Weather stays on the accepted environment clock. Gust, rain travel and density evolve without reseeding the view. Shelter eaves still clip wetness and both foreground precipitation paths. Runoff can persist after a shower; up to three exposed road grates can steam even in dry air. Pause holds the weather clock, and reduced motion removes moving vents, passing trains and weather flashes without changing cover, wetness, or route identity.

## Startup and compositor measurements

These are alternating runs on warm production servers with fresh Headless Chromium pages, trusted input, and the same Engage/Retry seeds. Each cell is **CPU submit / next animation callback / first callback beyond 0.15 s of combat**, in milliseconds. Neither submit nor an animation callback measures scanout.

| Fixture | Engage, prior → updated | Retry, prior → updated |
| --- | ---: | ---: |
| Desktop, 3 runs per build (median) | 1898 / 1909 / 2485 → **71 / 78 / 2164** | 2558 / 2577 / 3572 → **838 / 851 / 1034** |
| Touch emulation, 1 per build | 168 / 203 / 803 → **55 / 60 / 458** | 55 / 2737 / 2860 → **19 / 41 / 216** |
| Desktop CPU compositor, 1 per build | 213 / 248 / 470 → **71 / 88 / 252** | 50 / 83 / 322 → **24 / 39 / 222** |

All runs accepted a trusted jump. Submit and input responsiveness do not move in lockstep: updated desktop Retry submits ranged from 60 to 1264 ms, and updated Engage reached 0.15 s of combat in 367–2793 ms despite submitting in 66–89 ms. The single CPU-compositor control uses `--disable-gpu-compositing`, not just the application's Canvas renderer. These are sandbox measurements, not guarantees for a device or the public proxy.

In the instrumented traces the old raster worker waited **2.45 s** in `ReadbackImagePixels`; the updated trace had no such event and started one pair of Bridge workers across Engage and Retry, down from two pairs. A separate, delayed Chromium widget-shutdown task still waited on the software compositor: **0.86 s** in the prior trace and **2.11 s** in the updated trace. In the updated trace that wait followed the starter submit. It delayed the next callback despite the CPU already having submitted the scene. The trace identifies that wait in this headless setup, not its cause on a player's device or the trigger for the missing arena screenshot.

## Verification

[Composed recovery captures](../research/bridge-handoff/arena-recovery.webp) · [Measured receipts](../research/bridge-handoff/verification.json)

The original handoff release used production build `Ddi8k3l0vaASOKHfKK9wu`. After switching, the same HTML and immutable chunks loaded with the preview Host/Origin. The [Canvas pacing pass](BRIDGE-PACING.md) records the follow-up build. The local cross-origin embed passed with animation frames withheld until the menu was ready. Fresh desktop and touch runs passed Engage, Retry, jump, and movement after rich-scene promotion. Public HTTPS was not reachable from the sandbox; these checks ran against the live origin.

The build passed **203/203 Bridge tests** and **17 exact GLSL ES 3.00 program links**. The full suite passed **587/592**, with the same five combat/animation failures as the previous Bridge release. They are listed in the receipt. The dry station diagnostics passed Engage plus 20 Retries with the same eight stage backings, no scene samples, and zero tracked surfaces after teardown.

The composed browser checks keep the 92 HP/two-threat scene complete on Master, Optimized, and Canvas, including injected failure and real GL loss/restoration. When both painters are unavailable, the road remains present through resize, no live HP bar is displayed over the retained pose, and a jump pressed during the hold is discarded. Recovery restores the 92 HP bar before the next accepted tick. Full teardown zeroes both world backings and the HUD backing. The streamed transport readback matched the CPU texels, dropped a delayed same-seed reply, and restored on the next seed without a GL error.

On all three paths, disabling just one practical spectrum changed the posed silhouette in that spectrum. The Master witness had 181 warm and 219 cool changed pixels in the measured rig envelope, and the same frozen frame returned exactly when both lights were restored. No combat impulse was admitted. Separate checks denied the packed assets, both worker lanes, and the prop atlas; the game painted the local replacements.

Use a staged production build with `SR_QA_URL` and the browser tools described in [Game loading](GAME-LOADING.md). The browser suites use real gestures at menu transitions, then freeze known poses for pixel checks. Worker/asset denial is deliberate. WebGL loss uses `WEBGL_lose_context`; HUD loss is simulated at the 2D API boundary. The composed checks sample the road, head/chest/knee witnesses, the real warning, and the visible vitality bar. They do not treat a CPU callback as a displayed frame.

```bash
npm run check:bridge
npm run check:webgl:offline -- --require-compiler
npm run build:iso
node .qa/preview-boot.mjs --held-frame
node .qa/slasher-load.mjs --early --stages --input
node .qa/slasher-load.mjs --early --stages --input --same-seed --promotion --deny-packed
SR_SOFTWARE=1 node .qa/slasher-bridge-coverage.mjs --denied
node .qa/slasher-bridge-coverage.mjs --gl
SR_SOFTWARE=1 node .qa/slasher-rail-lift.mjs --touch
SR_SOFTWARE=1 node .qa/slasher-metro-fallback.mjs
node .qa/slasher-metro.mjs
node .qa/slasher-metro.mjs --touch
SR_SOFTWARE=1 node .qa/slasher-metro.mjs --canvas --touch
SR_SOFTWARE=1 node .qa/slasher-bridge-weather.mjs --canvas
node .qa/slasher-bridge-weather.mjs
node .qa/slasher-optics-retries.mjs --station --baked-practicals
node .qa/slasher-v4-stream.mjs --touch
node .qa/slasher-v4-assets.mjs --deny
```
