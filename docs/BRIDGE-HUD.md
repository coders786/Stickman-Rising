# Retained Bridge HUD

This is the first slice of [T15](SLASHER-GRAPHICS-REPAIR-PLAN.md#t15-keep-the-hud-crisp-without-clearing-an-unchanged-full-screen). The HUD keeps its one transparent canvas at up to 2× device scale, independent of world resolution. The world still renders normally beneath it. There is no new canvas, texture, font or drawing style.

## What gets retained

- `Game.buildHudState()` still samples the current game state and projects prompt anchors through the current camera. `HUD` advances delayed health with the same frame clock even when the separate layer needs no paint. There is no redraw timer or delay for damage, charge release, Overdrive, Flow, boss, execute or service cues.
- The separate layer compares the last paint against current visual inputs, CSS size, rounded backing size and context. Text-only values such as distance, score and FPS use their displayed precision; animated geometry and opacity are not coarsened. An exact stamp match skips the transform, clear and all drawing calls. On a change, the existing painter redraws the whole layer in the same order, which erases old prompt positions, expired notices and hidden FPS ink.
- Run reset and HUD context loss/restoration invalidate the retained paint. Backing and CSS size are checked on submission, including paused HUD-only updates. Scene-only scale changes don't invalidate an otherwise identical HUD. In-world fallback and inspection paint the HUD on every new scene; returning to the separate layer repaints it before display. The opening frame still paints its HUD before Engage or Retry enables combat.

This intentionally does **not** attempt partial clear/repaint, pixel-level deduplication of subpixel or offscreen motion, hidden-canvas throttling or changes to the HUD state queries. A busy HUD that changes every frame still clears and redraws each frame.

## Measured work

In two serial A/B pairs per viewport, each quiet window submitted **180** real world frames after 36 warm callbacks, with both builds locked to the Low 0.75× Canvas scene. The world kept painting while the HUD content stayed still. Numbers count submitted clear area in the HUD backing, not memory traffic or compositor work.

| Viewport | HUD backing (unchanged) | Clears | Cleared backing pixels | Text calls |
|---|---:|---:|---:|---:|
| Desktop 1180×660 | 1180×660, 3,115,200 B | 180 → 0 | 140,184,000 → 0 | 3,420 → 0 |
| Touch 400×844 | 800×1688, 5,401,600 B | 180 → 0 | 243,072,000 → 0 | 3,240 → 0 |

Both busy replays deliberately changed low health, Flow, boss, charge and prompt ink during travel. They still made **180** clears and the same number of text and rectangle calls on both builds. HUD JS p95 on quiet frames was **0.3–0.5 → 0.1 ms**; on busy frames it was **0.4–0.5 ms** on both, with noisier tails. HUD JS includes renderer submission and the stamp, not raster completion or state sampling.

| Pair | Quiet foreground rAF p95/p99, ms | Busy foreground rAF p95/p99, ms |
|---|---:|---:|
| Desktop A | 33.3/33.4 → 16.7/16.8 | 33.4/33.4 → 16.8/33.3 |
| Desktop B | 16.8/33.4 → 16.8/16.8 | 16.8/33.4 → 16.8/33.4 |
| Touch A | 16.7/16.8 → 16.7/16.8 | 16.7/33.4 → 16.8/33.3 |
| Touch B | 33.3/33.3 → 16.7/16.8 | 16.8/33.4 → 16.7/16.8 |

Those are actual foreground callback gaps in headless CPU-compositor Chromium with a matched simulation clock, not intervals inferred from JS time. The static Canvas work is gone; no physical-device frame-rate or consistent busy-HUD speedup is established. Physical-device results should drive any finer damage repair.

## Verification

The [release receipt](../research/retained-hud/verification.json) records both production build IDs, native pixel hashes, paint counters and sampled timings. Same-size desktop and portrait Canvas checks matched the previous release **38/38** in complete HUD backing RGBA, including tick-zero Engage/Retry, paused retention, moving/disappearing prompts, context restoration, input mode, safe insets, CSS resize, DPR-only resize and title clearing.

The compositor checks saw the correct HP ink during simulated Canvas 2D HUD loss/in-world fallback, restore and emergency paint. Trusted controls passed on desktop and touch, including tick-zero Master and Optimized WebGL handoffs; an actual WebGL loss during opening reached a complete tick-zero Canvas frame. The promoted preview matched staged HTTP assets and passed embedded boot and the portrait HUD check again. Bridge checks passed **229/229**, including **7/7** HUD layout and paint tests; offline validation linked **17** shader programs. The full suite is **613/618**, with the same five pre-existing combat/animation failures named in the receipt.

Reproduce against either production build using `SR_QA_URL` and the [browser harness setup](SLASHER-GRAPHICS-REPAIR-STATUS.md#reproduction-and-release-status). Add `--control` against the old full-clear build; add `--touch` for portrait. Rerun without `--pixels` for the two foreground replay windows. Don't run the timing sessions concurrently.

```sh
SR_SOFTWARE=1 node .qa/slasher-retained-hud.mjs --cpu-compositor --pixels
SR_SOFTWARE=1 SR_FRAMES=180 node .qa/slasher-retained-hud.mjs --cpu-compositor
node --import tsx --test tests/hud-layout.test.ts
npm run check:bridge
```
