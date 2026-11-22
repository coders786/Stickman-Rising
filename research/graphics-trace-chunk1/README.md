# Bridge graphics trace: chunk 1 baseline

## How to reproduce

Build and run the production preview (`npm run build:preview`, `npm run preview`). Append `?traceGraphics=1&boot=1` and interact normally. In DevTools, call `window.__SR_GRAPHICS_TRACE__.snapshot()` to retrieve a local JSON report. Tracing is opt-in, bounded, not sent to a server, and does not run shader probes. Add `verifyGraphics=1` only for a separate, explicitly instrumented driver-test run; that query changes settings and runs synchronous diagnostic GL work.

For the scripted run, install `puppeteer-core` and `@sparticuz/chromium` into `.cache/browser-tools`, or supply an existing executable via `SR_BROWSER_EXECUTABLE` and point `SR_BROWSER_TOOLS` at a directory containing `puppeteer-core`. Run `node scripts/trace-graphics.mjs --output=trace.json`, optionally `--verify` or `--retry`. The latter invokes the debug `gameOver()` method and clicks RETRY; it is a synthetic results-screen test, not a normal death or combat benchmark. Browser dependencies and binaries are not shipped by this change.

## Environment and measurements

The attached JSON receipts are two individual runs, not distributions: production preview, new headless Chromium 153.0.8010.0 processes, 1120×720 CSS pixels, DPR 1, ULTRA requested, adaptive disabled. Chromium in this sandbox has a software WebGL adapter, so the game **selected mobile-canvas** in both runs. Fresh browser contexts have empty HTTP caches; assets may already be warm in the server/OS. These are local sandbox timings, not physical GPU or mobile results. The runs were not seeded identically; do not treat differences as a controlled speedup comparison.

- `canvas-retry.json`: ENGAGE → playing **5,880 ms**; first scene submit **4,163 ms**; submit → pacing settled **1,349 ms**; RETRY → playing **907 ms** after synthetic game-over. A pacing reset reported a 1,283 ms ready gap at first opening and 183 ms at retry. The trace shows the gap and reset, not what caused the gap. Worker-reported window and plate bake times were approximately 939 ms and 700 ms at initial opening; those jobs overlap and wall waiting also includes scheduling, so they must not be added as a critical path estimate. The adapter-discovery interval was also long in this run; its wall time does not prove the CPU was blocked for that entire interval.
- `canvas-verify.json`: the optional diagnostic driver's synchronous compile/readback call consumed **7,524 ms of JS wall time before the scripted ENGAGE**. ENGAGE → playing was **3,469 ms** and first submit → settled **1,247 ms**. This shows diagnostic overhead in this environment, not that it caused the original video stall or that it is part of ordinary startup.
- The recorded 100 foreground frames were a short, unscripted post-opening sample, not 1,000 representative combat frames. Frame interval and Canvas paint distributions are in the JSON. They cannot establish GPU timing or performance on another machine. No live WebGL upload, SACR-packer, draw-count or hardware GPU samples exist in these two fallback runs.

Neither run reproduced the reported 25-second opening timeout. The pace reset is a concrete investigation lead for chunk 2, not sufficient evidence to remove the pacing gate. The cause of the original reported hang remains unconfirmed. Repeat with a hardware WebGL2 device, real combat/death, a controlled cache and seed, and a longer sample before selecting an optimization.

## Trace interpretation

Events use `performance.now()` in the page's time origin. `opening.tickJS`, `opening.beginRun` and its subparts, `paint.draftSlice`, `paint.drawTotal`, `paint.canvasWorldAndActors`, `sacr.packAndBin`, `gl.baseCanvasUpload`, `gl.actorCanvasUpload`, `gl.presentJS` and `verify.driverProbes` are **CPU-side wall durations**. Canvas paint covers a section of the renderer, not an isolated GPU raster cost. GL upload/submit calls can defer work and must not be interpreted as completed GPU work. `frame.interval` is foreground rAF spacing, not GPU time. Trace data covers multiple runs until page reload; metric percentiles use the most recent 1,000 samples while totals and maxima are all-time. Gate state events only emit on changes. The trace itself adds overhead.

No GPU timer-query instrumentation or long-duration heap-growth analysis is provided by this chunk. Collect those separately on hardware with supported APIs; mark unavailable measurements as unavailable rather than inferring them from CPU submit time.
