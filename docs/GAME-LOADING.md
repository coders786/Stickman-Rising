# Game loading: title, Engage, and Retry

There are two waits: **navigation → Engage enabled** and **accepted Engage/Retry → playable world + HUD**. The server-rendered menu and startup watchdog handle the first; the game engine owns the second. The [Ronin reveal](NIGHT-CROSSING.md) is inline artwork over that second wait, not a loading dependency.

## Current opening contract

- **Engage / Retry:** the gesture mounts the opaque ink card, unlocks audio on the trusted event, and starts the shared arena transfers. The first preparation callback initializes the seed and dispatches optical work. WebGL capability discovery can run off-thread. The cold title and first world paint advance on hidden backings in slices. Renderer setup, route work and asset delivery overlap without advancing combat, weather, music or gameplay input.
- **Complete before visible:** wait for decoded opening art (including the glass return), the matching route window and visible plates, and the renderer’s resident inputs. WebGL submits the opening post chain to a staging target and polls its fence without blocking. The HUD is separate from GL. An actual resource denial can use its authored fallback; pending resources are not treated as denied. The emergency recovery painter does not qualify as a complete opening.
- **Submit, then settle:** render the real world and HUD under the opaque veil. Three consecutive complete submits with gaps of at most 100 ms, followed by a foreground paint opportunity, qualify the handoff. A hitch, context/size change or tab switch invalidates the sequence. This is a startup hitch guard, not a guarantee of sustained frame rate. Only then do we start the shutter over the resident world and HUD, without continuing to render or simulate behind it. Input, music and combat start after the shutter completes. Reduced motion skips the animation, not readiness.
- **Cancel / recover:** Cancel restores the retained title or Results before the first complete submit. Once a new world has replaced the old backing, abandoning it returns to the menu. The 25-second foreground watchdog returns to a usable menu with a retry notice rather than choosing a lower tier or revealing an incomplete world; pending transfers are eligible to be requested again. Explicit WebGL capability denial or context loss can select the complete Canvas path. The watchdog cannot preempt a synchronous browser/driver call.
- Retry retires old window and bitmap ownership (even if the seed repeats). Busy worker lanes are terminated so obsolete work cannot occupy the new run’s admission lanes. Idle lanes can be reused.

Use `/?boot=1` for local preparation marks. `run-submit` measures the first **covered** submit; `run-settled` measures the handoff gate. `run-cut` to `playing` covers the reveal and input unlock, not the renderer’s first submit. See the [current browser checks](NIGHT-CROSSING.md#verification) for real pixels, compositor samples and input tests. The sections below describe earlier startup experiments, not the current build’s timings.

## Embedded preview startup

The original preview showed **Loading Arsenal** with Engage disabled in screenshots taken 9 minutes 20 seconds apart. That wording came from the menu's saved-preferences gate, not a request for sword assets. The screenshots show that the problem persisted across those observations; they don't measure a completed launch.

Two failures reproduced the same screen in a cross-origin Chromium iframe:

- **No animation frames yet:** the game and input were mounted, but the saved-preferences effect waited for `requestAnimationFrame`. The menu now initializes independently of animation. An accepted run still needs frames to prepare and play.
- **Required JavaScript unavailable:** the server could draw the static menu even if the page scripts never ran. A small inline startup watchdog displays a reason or timeout and a native reload link without depending on React or the engine bundle. Reload preserves the preview options and never clears saves.

These are controlled reproductions, not a diagnosis from the user's browser. The new preview serves minified, gzip-compressed production assets instead of the development/HMR graph. The menu initializes while the deferred engine loads, and Engage stays disabled until the game canvas and input are ready. The leaderboard validator is loaded only when the leaderboard is opened. Production HTML/API responses are not stored; the hashed CSS, fonts and script chunks can be cached. The preview's `.next-preview` output is isolated from `.next` and `.next-build`, so an ordinary isolated verification build can't delete the live server's chunks.

**Measure this browser:** open `/?boot=1`. The startup report shows the first byte, menu time, engine import time, Engage-ready time and the most recent accepted Engage/Retry → playing. Script sizes are shown only if the browser exposes them. Use **Copy timings** on that page, or on the report that appears after a script failure or startup timeout. These are local Performance API marks; no timings are uploaded. “Playing” is the game phase transition, not proof of a displayed frame.

### Measured startup

Three alternating cold-browser runs per build in a cross-origin Chromium 153 iframe, with warm servers, the CPU compositor, and CDP set to 150 ms latency / 1.5 Mbps down. The control is the previous preview (already containing the sky fix). Each run used a trusted click and advanced the simulation after the phase change.

| Measure | Previous Next dev preview | Optimized preview |
| --- | ---: | ---: |
| Navigation → Engage enabled (median) | 11.86 s | 3.67 s |
| Accepted Engage → playing (median) | 0.79 s | 0.83 s |
| Navigation → playing (median; prompt click) | 12.72 s | 4.57 s |
| HTML-linked JavaScript | 30 files / 1,624,452 B | 10 files / 223,278 B |
| JavaScript requested through Engage-ready, including deferred engine | 30 files / 1,588,938 B | 12 files / 383,070 B |
| HTML + startup JS, CSS and fonts through Engage-ready | 1,766,755 B | 550,040 B |

Asset sizes are compressed server response bodies, excluding headers, measured with a preview-style Host/Origin and `Accept-Encoding: br, gzip`. The through-ready rows replay the asset paths observed in the browser, rather than assuming all HTML-linked files were used. In this test the iframe did not expose Resource Timing sizes; the report shows “size unavailable” instead of zero. These timings don't measure the Arena public proxy or a physical Edge browser.

With animation frames held, Engage enabled in 332 ms on the unthrottled test page; the run played once frames resumed. Blocking the initial script group and blocking only the engine both surfaced a failure without `?boot=1`. Holding the engine request open surfaced the timeout instead. All three recovered via the native reload link once delivery was restored. Denied storage could still play, with a warning. A mute change made while the engine was in flight was applied on mount, without losing the saved progress or sword list.

The live production preview passed real desktop/touch Engage and Retry, Bridge input/audio/cancel, and the Night Station switch and saved-tier checks. Running `build:iso` left the served preview and its chunks unchanged. Both builds and all 28 focused tests passed; the full gate passed 481 of 486 tests, with the same five pre-existing failures.

## World build after Engage

Before the sky fix, the title baked its moon and stars with synchronous GPU readback. Engage/Retry yielded during readback, but still waited for the moon before painting a playable arena. On forced software WebGL the Retry moon alone took over seven seconds.

- **Title:** The initial menu gets a paint opportunity before the backdrop bake. Engage is enabled once the engine and saved settings are ready, not when a shader finishes. The animated backdrop now uses the existing Canvas 2D sky plates without opening WebGL. The city and road still bake together before the first full scene draw.
- **Engage and Retry:** Known software WebGL is refused before shader submission. Other renderers can use the original moon/star shaders with one 96 ms deadline for both plates, including time already spent initializing WebGL. A refusal or timeout falls back to the existing Canvas 2D art. The deadline bounds the fence wait, not the time spent inside a synchronous driver call. The stage enters play only after the initial arena draw is submitted; no mid-run sky swap or new render pass.
- **Unchanged:** Arena geometry, combat, seeded layouts, quality settings, saved progress, and the optional dry Night Station. The original GPU and CPU artwork recipes, sizes, and tools remain available. The Canvas 2D moon and stars are a designed fallback, not pixel-identical to the shader.

## Matched browser checks

Fresh Chromium 153 pages against warm Next dev servers, with trusted clicks or CDP touch, real audio initialization, and fixed Engage/Retry seeds 42/43. The control was the post-art working tree at `9d27d2b` before the loading patch. Desktop: 1000×560 at DPR 1. Touch: 390×844 at emulated DPR 2. These are single matched samples, not percentiles or handset measurements.

| Fixture (bundled SwiftShader) | Navigation → first title backdrop submit | Engage → playing | Retry → playing |
| --- | ---: | ---: | ---: |
| Wet Bridge desktop | 3.19 → 1.31 s | 1.84 → 0.50 s | 8.13 → 0.46 s |
| Wet Bridge touch | 2.15 → 1.27 s | 1.25 → 0.44 s | 7.52 → 0.54 s |
| Night Station touch | 0.97 → 0.89 s | 0.07 → 0.08 s | 0.05 → 0.08 s |

Wet Bridge also reached 0.15 s of live simulation after each click: desktop Engage/Retry **2.04/8.31 → 0.70/0.73 s** and touch **1.43/7.70 → 0.65/0.71 s**. No input/renderer exceptions in these probes. The station already skipped the sky bake; its small start/retry variations are not a meaningful speedup.

**Submission isn't display.** The forced software compositor sometimes delayed the next title animation callback by several seconds on both builds. In the controlled `--cpu-compositor` cases (WebGL2 still allowed), the menu-ready observation on Bridge was **1.53 → 0.72 s** desktop and **1.54 → 0.75 s** touch. Engage/Retry were **0.90/0.91 → 0.65/0.71 s** desktop and **0.94/0.87 → 0.70/0.76 s** touch. Bridge still has an atomic CPU city/road build and first draw. This change doesn't make that work disappear or validate startup on a physical phone.

## Regression checks

- Desktop and touch: real Engage/Retry, first attack, audio, pause/restore, cancelling a held preparation, and destroy/remount all passed. Night Station's Settings switch, retry, and persisted quality ceiling passed.
- Forced Canvas 2D moon and star images matched the old fallback pixel-for-pixel for seeds 42 and 43. Fixed-input Low 1× replays matched scene/HUD hashes, combat events and state, and released all tracked buffers on both stages. These compare like with like, not Canvas 2D against GLSL.
- Isolated production build passed. Project gate: **479/484**, with the same five pre-existing combat failures and no new boundary violations.

## Reproduce

Use `SR_BROWSER_TOOLS` / `SR_BROWSER_EXECUTABLE` as described in [the graphics repair checkpoint](SLASHER-GRAPHICS-REPAIR-STATUS.md#reproduction-and-release-status). Run against the live app at `SR_QA_URL` (defaults to port 3000). Raw sandbox receipts are under `.cache/preview-boot/` and `.cache/loading-fix/`.

With `npm run build:preview` and `npm run preview`:

```bash
mkdir -p .cache/preview-boot
node .qa/preview-boot.mjs --slow > .cache/preview-boot/boot-trace.json
SR_QA_REQUIRE_IMMUTABLE=1 node .qa/preview-assets.mjs .cache/preview-boot/boot-trace.json
node .qa/preview-boot.mjs --held-frame
node .qa/preview-boot.mjs --missing-chunk
node .qa/preview-boot.mjs --missing-engine
node .qa/preview-boot.mjs --hung-engine
node .qa/preview-boot.mjs --no-storage
node .qa/preview-boot.mjs --late-settings
```

For run preparation and interaction:

```bash
node .qa/slasher-run-readiness.mjs --optimized --hold-glass --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-complete-opening.mjs --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-load-stall.mjs --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-load-visible.mjs --short --cpu-compositor
node .qa/slasher-load.mjs
node .qa/slasher-load.mjs --touch
node .qa/slasher-load.mjs --touch --cpu-compositor
node .qa/slasher-startup.mjs --cpu-sky --plate-pixels
node .qa/slasher-gestures.mjs --touch
node --import tsx --test tests/sky-startup.test.ts tests/background-lifetime.test.ts
npm run build:iso
```
