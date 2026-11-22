# Slasher graphics repair — implementation and validation

This is a checkpoint against the [repair plan](SLASHER-GRAPHICS-REPAIR-PLAN.md), not a release or an FPS claim. The comparison control was the **warm-lit working tree**, not bare `main`. No combat rules, tier ceilings, optics-route defaults, or shader recipes were changed in this repair pass.

For the later T12/T13/T16 changes, see [Practical Optics](PRACTICAL-OPTICS.md): scene-local glow and wet material, no live mirror on either authored route, and unfiltered touch controls. That comparison uses a newer control and keeps its own frame and lifetime receipts.

The later [T15 retained HUD pass](BRIDGE-HUD.md) removes redundant separate-HUD drawing in play and on a settled pause. The T17 draw counts below are historical. The [Bridge rendering update](BRIDGE-RENDER-RECOVERY.md) restores flat Ronin ink, fixes a stale-work stall on Retry, and adds baked scenery detail without changing presets.

## Implemented and checked

| Tickets | Implementation | Evidence and remaining limits |
| --- | --- | --- |
| T01 | Fixed-input replay with backing, optics route, combat events, stage submission, cache and teardown receipts. Foreground stalls stay in frame percentiles; explicit visibility gaps do not. | The fixed seed-42 crowd finishes at 211 sim ticks, 69 attack frames, and the same event digest on both optics routes. rAF/JS submission is not display timing. |
| T02–T04 | One resizing vignette per viewport; repaint when the recipe or backing changes. Release city work canvases after each band. Own city, sky, prop, post, HUD, flash and normal staging backings by component/context. Check rounded growth and report pinned overflow. | Native resize and 20-retry soaks return to stable counts. Browser replays leave **zero tracked stores** after destroy. The model measures backing estimates, not GC, GL memory or pattern allocations. Optional admission can decline safely; no new automatic retirement or pressure policy is shipped. |
| T05 | The sky cache has a scoped viewport, hit/rebuild receipts and a narrow palette ramp. | Direct drawing reduced submit p95 on this software fixture but did not reliably improve the rAF tail. Leave the cache policy unchanged. The small upper-sky pixel difference against the integrated control is still open. |
| T06 | Engage/Retry acknowledge before work, unlock audio on the gesture, and defer shader readback using a WebGL2 pixel-pack buffer and fence. Cancel/replace/destroy discard the unpublished night. Activate only after the complete scene has drawn once. The existing Canvas2D fallback handles unavailable/lost GL. | Desktop and touch headless input, in-flight cancellation, lost-context fallback and remount passed. Moon/stars were pixel-identical to synchronous readback for seeds 42 and 43. The city/road bake is still atomic, and long GPU completion waits still delay play on this backend. |
| T07, T09 | Reuse the same interpolated enemy visibility list for grounding and bodies. Solve each captured dash echo pose once per pooled slot, not per draw. | Enemy-list-only A/B matched scene, HUD and events. Echo-only A/B matched scene/HUD with **three echoes actually on the capture frame**, and a longer crowd run matched event ticks. Original visibility envelopes and pass order remain. |
| T17 | Paused play retains the opaque world once stable, continues the separate HUD, and repaints on resize, settings or context restore. Inspector and single-canvas fallback still draw normally. Hidden frames skip scene and HUD; resume resets the frame baseline. | Desktop and touch headless: **0** world submits vs **8** in the full-redraw comparison over eight callbacks; **8** HUD draws in both. Coalesced settings/restore caused one world repaint. Inspector drew normally; resumed input arrived once. |
| T18–T19 | Reuse rain projection for its passes and skip zero-opacity work. Remove unused bolt/fork storage while advancing the same lightning RNG draws. | 3,600 native ticks: exact rain/splash pixels and all 16 strike ticks/azimuths. Dry probe: 48 strokes → 0. Isolated browser dry-scene A/B also matched pixels. No rain depth/roll or storm-art redesign. |
| T23–T24 | Correct tier descriptions and report quality-ladder `from`, `to` and monotonic `at` values. | Copy and diagnostics only. Existing device classification, adaptation and route settings are unchanged. |

## Resource and pixel checks

- Native High warm-lit control: **39.78 MiB** tracked on warmup, **55.98 MiB** after a resize round trip. After scoping: **19.21 MiB** warm, **26.25 MiB** after the round trip, and **45 surfaces / 26.25 MiB** at every checkpoint in a subsequent 20-retry soak. Different warm/round-trip totals account for which viewport layers were actually drawn. The first same-size Retry corner is no longer transparent. The native sky/deck comparison hashes matched.
- Final 1.25×, 1000×560 CSS, fixed Ultra crowd: tracked backing fell **43.34 → 24.06 MiB** on forward and **43.44 → 24.16 MiB** on capture. The 1250×700 scene and 1000×560 HUD together represent another **5.47 MiB** of non-ledger RGBA output, unchanged. The soft 48-surface reference can still be exceeded by required pinned plates and flash colors. No hard GPU-memory cap is implied.
- Against the warm incumbent, final HUD buffers, layouts and event hashes match. The integrated scene comparison is **not byte-identical**: 524 forward and 543 capture pixels differ in the upper sky only, by at most 3 and 4 levels per channel respectively. This was not attributed to echo caching or dry-rain work by their isolated A/Bs. Do not treat the lifetime-only pixel gate as fully closed on this backend.
- In the same-backend headless no-pixel crowd sample, cache/direct JS submit p95 was **21.9–22.5 / 5.3–6.5 ms**. rAF p95 was **33.4–50.0 / 50.1 ms**. Two runs per path are not sufficient to select a cache/default or claim extra presented frames.

## Startup trade-off

These measurements precede the [loading follow-up](GAME-LOADING.md), which skips known software shader bakes and limits the interactive fence wait.

Headless Chromium 153.0.8010.0, 1000×560 at 1×, Ultra, seeds 42/43. A paired diagnostic on the same menu path forced synchronous readback as the control. These are individual samples, not percentiles or physical display measurements.

| Sample, Engage / Retry | Sync GPU readback | Deferred GPU readback |
| --- | ---: | ---: |
| Click → preparing DOM commit opportunity | 6.7 / 11.3 ms | 8.7 / 16.4 ms |
| Longest observed foreground task | 1,088 / 5,562 ms | 250 / 281 ms |
| Click → playable | 1,458 / 5,862 ms | 1,359 / 6,009 ms |

The long operation was `readPixels` waiting for GPU work, not shader compile submission. The new path kept each sampled readback submission below 1 ms and downloaded only after the fence signaled. It **did not** make the GPU finish sooner. A later stage trace still measured **1.60 s / 6.23 s** to play with **242 / 179 ms** of synchronous city warmup, excluding the first paint. Retry remained cancellable during the GPU wait, not during that atomic CPU stage. Do not claim that the full startup latency target or the 50 ms foreground-task budget has been met. Forced no-WebGL and injected context loss both reached play with the existing fallback; they do not justify switching supported devices to that art by default.

## Reproduction and release status

The browser scripts use `SR_BROWSER_TOOLS` pointing to a local install of `puppeteer-core` and either `@sparticuz/chromium` or `SR_BROWSER_EXECUTABLE`. The UI scripts drive the running app at `SR_QA_URL` (defaults to port 3000). Bundle mode takes `SR_SOURCE=src` or a frozen warm control checkout. Keep pixel capture separate from timing.

```bash
node --import tsx .qa/slasher-lifetimes.mts --soak
node --import tsx .qa/slasher-weather.mts
node --import tsx .qa/slasher-road-bake.mts
node .qa/slasher-startup.mjs --gl-timings
node .qa/slasher-startup.mjs --gl-timings --sync-readback
node .qa/slasher-startup.mjs --cpu-sky
node .qa/slasher-gestures.mjs
node .qa/slasher-gestures.mjs --touch
SR_SOURCE=src node .qa/slasher-replay.mjs --fixed --frames=180 --fixture=crowd --route=forward --empty-teardown
npm run gate
npm run build:iso
```

- In the working sandbox, raw receipts are under `.cache/slasher-qa/` (ignored). The frozen warm control was based on `9d27d2b25e4ef0e0a5ca100d7e0f365cc3a66520` with patch SHA-256 `dfef459803071c2c7d79678a7e06487c1dd1e68cb3a99a4bdd72b5fa989b28a0`. `final-{forward,capture}.json`, `ui-final-stages.json`, `ui-{deferred,sync-readback}-current.json`, and `gestures-{desktop,touch}.json` contain the cited probes. Generated motion references are ignored under `out/slasher-reference/`.
- Typecheck, boundaries, isolated production build and both lighting verifiers passed. Full gate: **467/472**, with exactly the five existing gameplay failures (tight-pack cleave, frame-rate-dependent cut depth, welded core strike joint, extra sword ritual keys, striking-joint contact). None were skipped or edited to obtain a graphics pass.
- **Next:** split or reuse the measured synchronous city/deck work without publishing partial art; investigate the upper-sky pixel delta. Run longer paired tests and native-speed cue review on actual desktop and Android/iOS hardware before adopting cache, shadow, compositing, touch blur or adaptive-policy changes. The rest of the 24-ticket plan remains open; this checkpoint is not approval for a wider rollout.
