# Opening/retry resilience: chunk 2 receipt

These are individual diagnostic runs on the same sandbox setup described in [chunk 1](../graphics-trace-chunk1/README.md): production preview, Headless Chromium 153, 1120×720, DPR 1, ULTRA requested, adaptive off. The normal renderer chose **Canvas fallback**, not physical GPU WebGL. Seeds, scheduler load, compilation caches and asset timing vary; do not compare individual durations as a speedup benchmark.

- `retry.json`: ENGAGE → playing 6,165 ms; synthetic game-over RETRY → playing 1,066 ms. Both completed using the ordinary paced path. The synthetic result screen is not a full death animation test.
- `hung-optics.json`: `--hang-optics` replaces the optical worker with a nonresponding stub. Its job was denied after the 8 s deadline and the Canvas path reached playing in 9,041 ms. This deliberately exercises the approximate missing-worker fallback, not full baked transport.
- `stall-gl.json`: `--stall-gl` forces the renderer-admission call to report pending; after 12 s of active preparation the run chose Canvas and reached playing in 13,283 ms. This simulation does not model a synchronous driver call blocking the browser thread: a JS watchdog cannot interrupt one.
- `verify.json`: optional SACR driver checks completed with `pass` in an OffscreenCanvas worker. Runtime status was `live Canvas fallback`. The worker shared the sandbox's CPU/GPU resources and the run was slow; moving JS to a worker does not remove driver contention. If worker WebGL is unavailable, diagnostics fall back to main-thread sliced probes; individual links/readbacks may still block. If a diagnostic worker exceeds 30 s, it is terminated and reports failure rather than starting a potentially blocking main-thread retry.

These receipts were gathered during this chunk as the implementation evolved; the successful worker path in `verify.json` predates only the final worker-timeout error-handling change. No hardware GPU timing, normal combat death/retry, or 400 ms boot / 150 ms retry claim is established.

## Regression checks

- `npm run check:bridge`: 243 passed, including the new worker timeout and pacing tests.
- Production build and targeted ESLint passed.
- `.qa/slasher-bridge-finish.mjs --context-only --compact --v4` passed using software WebGL for correctness only.
- `.qa/slasher-bridge-finish.mjs --pending --compact --v4` passed with `KHR_parallel_shader_compile` denied; it checks that pending programs are retired on a tier change. The fixture's stale expected status string was updated to match the existing renderer message.
- The broader `.qa/slasher-bridge-finish.mjs --compact --v4` **did not pass**: its rolled-eave wetness assertion observed `wetDiff=8` where it expects zero. It failed before completing that broader scenario, so it cannot be used as a retry/resource-residency sign-off. No claim is made here about whether that failure predates this change.

The opening pacing fallback requires at least three complete frames, a 1.2 s grace period and a recent final submit; a reset on visibility, failure or surface/path change discards the qualification. This is a way to enter on slow devices, not a claim that the renderer is running at a target frame rate.
