# Shadow footprint pass

> Historical render study. For current presets and Engage, see [Continuous Bridge](PROCEDURAL-BRIDGE.md).

The shadow budget is unchanged by the [Practical Optics follow-up](PRACTICAL-OPTICS.md), which subsequently retired the water relay. Relay receipts below describe the shadow comparison as tested.

[All preset comparisons](../research/shadow-footprint/before-after.jpg) · [Absolute Ultra combat, jump and portrait](../research/shadow-footprint/absolute-ultra.jpg) · [Replay receipts](../research/shadow-footprint/verification.json) · [Preview checks](../research/shadow-footprint/preview-checks.json)

The problem was not that Ultra needed more layers. The old painter redrew the same pose up to five times for the moon, up to three more times for a practical, and put separate hard ovals under the pelvis and feet. Much of that work made a dark streak or a second outline, not a better reading of the stance.

## What each preset draws

| Preset | Fighter contacts | Fighter cast | Prop cast | Fixed scene scale |
|---|---|---|---|---:|
| Low | Up to two soft sole marks | None | None | 1× |
| Medium | Same soles | None | None | 1.25× |
| High | Same soles | One graded pose fill | None | 1.5× |
| Ultra | Same soles | Same one graded pose fill | One mask blit per visible prop | 2.25× |
| Absolute Ultra | Ultra's path, with Adaptive off | Same | Same | 2.25× |

- **Contact follows the solved ankle and toe.** Each sole's height attenuates its mark independently. Wide stances keep two contacts; close feet don't multiply into a heavy stain. When both feet lift, the two marks fade toward one faint ground cue, not a third pelvis layer. The brush is a reused unit radial gradient, not a frame-sized buffer.
- **One cast carries pose and direction.** The camera-independent key supplies the fallback direction. Nearby practicals steer that projection continuously using the existing occlusion-weighted light probe; as the probe hands off between lights it returns through the key instead of jumping. Shorter lateral shear and a depth fade replace the offset silhouettes. Stronger at its base, the cast softens toward the tip and fades with airborne height. The projection and its ramp keep even a rolled boss cast on the deck.
- **Only the solid parts of a prop cast.** The existing prop generation stores a smaller, height-faded mask of the physical body and plinth instead of darkening its labels, ground rings, glow and reflection strip. One draw uses the directional key. Unborn, broken and out-of-view masks don't blit. There is no new shadow backing store, blur filter, or dynamic shadow map.
- **Water is independent.** Low keeps the baked water with no actor relay. Medium still relays a coarse outline; High and Ultra reuse their cast path for the same full pose relay. Night Station remains dry. No weather, resolution, HUD or simulation budget was reduced to get the shadow counts below.

## Matched work and frame pacing

The control is the post-water working tree, not bare `main` (branch base `9d27d2b25e4ef0e0a5ca100d7e0f365cc3a66520`, captured tracked diff SHA-256 `069f87d431666cbfdf6e59bafb146394d66678798b25644ac4ee4b57bb60cafe`; both source snapshots also include the untracked stage art). Seed 42, the same crowd encounter (up to ten enemies), two prop casters, and settled drizzle on the Wet Bridge. Desktop replays are 960 × 544 CSS px; portrait capture is 390 × 844. The normal Ultra comparison runs at 2× on both sides, and the fixed Absolute Ultra comparisons are 2.25× on both sides. These are replay backing scales; Adaptive still controls the actual scale in play.

Work counters are scene drawing commands, not FPS. Old key/practical fills, new graded casts, contact fills, outlines and prop blits are counted separately. The live mirror draws into a different context and isn't counted as a shadow. Measured pacing runs do not enable those hooks, trajectory tracing or PNG capture. Each comparison uses 36 warm-up frames followed by 90 observed rAF intervals; the 60 Hz input/sim clock is deterministic. Run order alternates across three pairs. GPU-disabled Chromium measures a software workload, not delivered FPS on a particular phone or GPU.

| Replay | Actor shadow paints/frame | Prop blits/frame | p95 rAF (ms) | p99 rAF (ms) | p95 submit (ms) |
|---|---:|---:|---:|---:|---:|
| Low 1× | 22.33 → 14.89 | 0 → 0 | 33.4 → 33.3 | 50.1 → 50.0 | 21.3 → 20.5 |
| Medium 1.25× | 29.78 → 14.89 | 0 → 0 | 66.5 → 50.1 | 66.8 → 66.7 | 24.3 → 22.5 |
| High 1.5× | 57.94 → 22.33 | 0 → 0 | 66.7 → 66.7 | 83.3 → 83.4 | 23.5 → 22.4 |
| Ultra 2× | 72.83 → 22.33 | 4 → 2 | 116.6 → 100.1 | 150.0 → 116.7 | 23.9 → 24.5 |
| Absolute Ultra 2.25×, desktop forward | 72.83 → 22.33 | 4 → 2 | 133.3 → 116.7 | 133.4 → 150.0 | 22.2 → 23.4 |
| Absolute Ultra 2.25×, portrait capture | 68.83 → 21.00 | 3.84 → 1.53 | 83.3 → 83.3 | 99.9 → 83.4 | 15.3 → 15.9 |
| Dry Station 2.25×, capture | 72.67 → 22.33 | 4 → 2 | 83.3 → 83.4 | 100.0 → 116.7 | 6.2 → 6.7 |

Counts are means from the instrumented replay; the timing columns are medians of the three runs' percentiles (Headless Chromium 153). At locked desktop Ultra the **cast-only paints drop 43.06 → 7.44 per frame** (83% fewer); including contacts it's 69% fewer actor shadow paints. The smaller masks save 72 KiB of page-rounded tracked backing, without adding a surface. Desktop rAF p95 improves in Medium and both Ultra comparisons, while portrait and Station p95 stay essentially flat. Median frame time is unchanged at the measured cadence; p99 and submit are mixed. This is not a claim that the whole game is faster on every configuration.

For attribution, a separate test freezes the last dry Station crowd pose at 2.25× (eleven actors and two props). It replays only the issued shadow painters into a 2160 × 144 CPU canvas. The measurement includes the flat background clear and a one-pixel flush of **that test canvas**, not a scene read or a gameplay timing. Across three pairs (36 batches of 24 repaints per run), median p50 shadow raster time went **4.05 → 2.47 ms** and p95 **5.15 → 3.13 ms**. That's about 39% less time in this isolated workload.

All nine still pairs preserve combat state, weather and camera, plus byte-identical HUD and (when enabled) relay pixels. Seven split profiles report zero scene reads and the same relay bounds on both sides. Low and dry Station have no actor relay allocation.

## Re-run and guard the change

Keep a copy of the pre-shadow `src` including newly added art before the comparison. Use `puppeteer-core` with `@sparticuz/chromium` or a local executable; see [the graphics engine map](GRAPHICS-ENGINE-MAP.md) for the browser-tool environment. The proof runner defaults to software rendering. Don't run other browser/test jobs beside the pacing sampler.

```sh
bash .qa/slasher-shadow-proof.sh /path/to/control/src src .cache/shadow-footprint/final
node .qa/slasher-shadow-report.mjs
node --import tsx --test tests/{shadows,surface-light,world-lights,fundamental-lights,graphics-tiers,profile-consumption,ultra-stack,baked-wet-material,background-lifetime,ledger-gen,stage-art,persistence}.test.ts
node .qa/slasher-quality.mjs
node .qa/slasher-quality.mjs --touch --station-preview
# Use the historical post-shadow SRC tree for the original relay assertions.
SR_SOURCE=HISTORICAL_SRC node .qa/slasher-optics-retries.mjs --water-relay --shadow-masks
SR_SOURCE=HISTORICAL_SRC node .qa/slasher-optics-retries.mjs --water-relay --shadow-masks --capture
SR_SOURCE=HISTORICAL_SRC node .qa/slasher-optics-retries.mjs --water-relay --shadow-masks --station
```

The proof report rejects drifting backing sizes or camera positions, state/event changes, HUD or relay pixel changes, scene copies, unexpected pass counts and retained backing stores. The unit tests cover a wide stance, a lifted foot, facing, an airborne fade/offset, strong practicals on either side, prop lifetime and a rolled 2.25× cast contained by the deck.

The production preview serves Wet Bridge and `/?stage=station`. Real Settings clicks/taps lock 2.25× at **2250 × 1395** desktop and **877 × 1899** touch, in the same run with the HUD backing unchanged. Pause/resume, Adaptive restore/persistence, Engage, Retry and cancel passed on both viewport classes. In each of the wet forward, wet portrait and dry Station lifetime runs, 20 Retries held six 76 × 88 prop masks, zeroed every retired mask and left zero tracked stores on destroy. No test with Water Relay enabled observed a scene copy.

Build, typecheck, module boundaries, targeted lint and **121 focused tests** passed. The full gate passed **490/495**; its five failing combat/animation assertions also failed on the unchanged pre-shadow working tree.
