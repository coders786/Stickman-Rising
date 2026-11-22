# Night Crossing: ink and steel

Engage and Retry use the same original inline vector cel. The Ronin, paper moon, scabbard and edge are flat shapes, with a small vermilion accent. The old flame eyes, screen flash and animated masks are gone. The card enters once and can stay still for any length of load. A single opaque shutter with a steel edge sweeps across to expose the real Bridge. It translates rather than changing layout or fading the entire viewport.

## Who owns the opening

1. **The renderer prepares under a solid cover.** The title waits for its actual skyline sources and paints a hidden draft, rather than doing a provisional full bake on the first possible click. The title and first full arena draw yield between passes and inside the cold sky, lunar and mist raster loops. The budget is a yield target, not a claim that every native Canvas or driver call is preemptible. A cancelled or invalid draft is never published.
2. **Renderer admission is separate from painting.** Supported browsers probe the WebGL adapter on a worker, so rejecting a known software adapter doesn't require a synchronous renderer-string query on the UI thread. If the worker cannot tell, use the normal guarded DOM path. GL program setup, backings, uploads, and the first post chain are staged. Nothing uses a lower tier just because it's slow. The same decoded art, route plates, transport, glazing and HUD still have to be ready.
3. **Three complete covered frames and a following foreground paint opportunity qualify the cut.** The engine then leaves that submitted world and HUD resident for the 330 ms transformation. It doesn't draw over the cut or advance the run while the shutter moves. The layer's actual animation completion opens combat, input and music; there is no time-based readiness substitute. Reduced motion and CSS-disabled animation go directly from the same paced frame to combat. Cancel remains available while preparing; before a complete publish it keeps the prior backing, and after a covered Retry publish Menu retires the attempt.

See the [opening contract](GAME-LOADING.md#current-opening-contract) and [Bridge look verification](BRIDGE-OPENING.md). The new transition doesn't change the arena art, the flat-black in-game Ronin or the SACR pipeline.

## Verification

Live preview build: `gdXhnsh9z8d8w4yIOkjSE`.

[Run receipts](../research/night-crossing-responsive/verification.json) · [Ink card](../research/night-crossing-responsive/ink-card.webp) · [Engage playback](../research/night-crossing-responsive/engage.webp) · [Default-compositor still](../research/night-crossing-responsive/default-cut-desktop.webp)

The comparison used the previous production preview (`7qVb8h6ndK3ypzbzONrC8`) and the live build with the same fixed seeds, viewports and trusted input. In the default headless Canvas traces:

| Fixture | Longest preparing `paint` call, old → new | Cut compositor swaps¹ | Median gap between cut swaps |
| --- | ---: | ---: | ---: |
| Desktop Engage | 181.4 → 31.4 ms | 14 | 16.5 ms |
| Portrait Engage | 132.4 → 52.6 ms | 14 | 16.9 ms |
| Desktop Retry | 20.5 → 6.3 ms | 15 | 16.7 ms |
| Portrait Retry | 22.3 → 35.4 ms | 13 | 16.7 ms |

¹ `Display::DrawAndSwap` trace events from `run-cut` to input unlock, not JS callbacks, screenshot timestamps or physical scanout. The longest gap in each cut was 70–83 ms, including the pause at the start of the shutter animation. A cold cross-origin iframe test logged 15 swaps with a 16.7 ms median gap and observed jump movement 36.2 ms after trusted input.

Cold startup still varies. The embedded trace records a 1.32 s Chromium `LayerTreeHost` shutdown during loading, before the cut. The same family of tasks also occurs on the control and when waiting for the title, where it completes before the click. It is separate from the engine's `paint` calls. Continuous playback is from the CPU-compositor diagnostic: the default headless GPU recorder omitted the arena on both viewports, even while the trace recorded swaps. A direct desktop readback captured the real shutter and HUD, but returned late and isn't used for timing.

In a separate matched CPU-compositor playback, the first sampled arena corner arrived at **1.04 / 0.34 s** (desktop Engage/Retry) and **1.14 / 0.31 s** (portrait). The old clip reached those samples at **2.48 / 1.57 s** and **2.27 / 1.56 s** respectively. Both suites exercised real keyboard/touch input *after* the art cleared. Exposing a few arena pixels is not an input-ready mark. Time to playable did not improve in every cold headless run. The animation is staged to avoid doing the asset work during the sweep, not to promise a fixed duration from the button press.

All 11 served Bridge assets match the previous release byte-for-byte. All six fixed-seed Engage/Retry arena images match every RGB pixel (desktop Canvas, portrait Canvas, compact Optimized). Held images, GPU inputs and fences confirm that the new cover doesn't leak. A post-submit hitch still resets the cadence check. Tests cover cancellation during a partial draft, resize during a cut, stale worker replies, the foreground watchdog, reduced motion and disabled animations. A real WebGL loss during the cut restores the cover and qualifies a fresh Canvas frame before it unlocks. SwiftShader runs with a compact backing verify correctness, not hardware speed.

The production build, 234 Bridge checks and 17 offline shader program links passed; the full suite reports the same five pre-existing combat and animation failures (618/623).

### Reproduce

Use `SR_BROWSER_TOOLS` / `SR_BROWSER_EXECUTABLE` from the [browser setup](SLASHER-GRAPHICS-REPAIR-STATUS.md#reproduction-and-release-status) and `SR_QA_URL` for the production preview. Set `SR_SHOTS` to save the composed frames. Run the control URL with the same flags and add `--control` to the playback probe.

```bash
SR_LOAD_TRACE=/tmp/sr-open.json node .qa/slasher-load.mjs --early --stages --asset-stages --input --same-seed
SR_EMBED_TRACE=/tmp/sr-embed.json node .qa/preview-boot.mjs --default-compositor --input
SR_SOFTWARE=1 node .qa/slasher-reveal-frames.mjs --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-reveal-frames.mjs --touch --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-opening-draft.mjs --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-interlude.mjs --no-animation --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-complete-opening.mjs --animated --cancel --cpu-compositor
SR_GL_TEST_SCALE=.20 node .qa/slasher-run-readiness.mjs --optimized --hold-glass --compact --cpu-compositor --lose-cut
```

[Archived flame-eye version](../research/ember-slit/verification.json) is the previous cut, not the active cinematic. `scripts/audit-ember-slit.py` consumes its archived captures.
