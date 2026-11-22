# Bridge rendering: flat ink, better section cards, clean Retry

> Historical rollout. The follow-up restores the earlier Bridge paint and keeps the loader over complete, paced frames; see [Game loading](GAME-LOADING.md#current-opening-contract). The measurements here describe PVw, not that follow-up.

Control: retained-HUD build `iWoXGibOrwMgKYKmauvXc`. This rollout served `PVwKfw6Ft7hel8QRweOhB`. See the [verification receipt](../research/bridge-render-recovery/verification.json) for build IDs, frame witnesses and timings.

## Scenery without changing the quality settings

- Asphalt repairs have graded edges, chipped seams and exposed aggregate. The girder has spliced webs, flanges and bolt heads. These details are part of the existing section-card paint, not another full-screen pass or texture download. Wetness, shadows, glazing and combat light still come from the existing sources.
- Canvas reconstructs the plate's lighting between **linear** row samples before tone mapping. The facade and road are separate, and hard eave/soffit edges aren't filtered across. X visibility remains discrete at solid boundaries. Neither the optical bake format nor the SACR live packet changed.
- Card allocations skip transparent rows and each blit uses just the visible source rectangle plus a filter guard. The opening and the renderer use the same visibility query. In the sampled district/shelter classes the height was **349–418 px** instead of 452 px at the same texel scale. Cards in a wide view can still draw directly outside the three-slot cache; Canvas presents one coherent grade rather than switching one visible card at a time.
- The apron outside the playable route mirrors a strip of the entry card. It matches the asphalt and fascia at x=0 without a second backing or another bake. In the fixed entry screenshot, the asphalt strip's luma step dropped from **29.61** to **0.01** on a 0–255 scale (columns 100–103 vs. 105–108, rows 450–532).

[Entry before](../research/bridge-render-recovery/entry-before.webp) · [Entry with flat ink and the continuous deck](../research/bridge-render-recovery/entry.webp) · [Optimized portrait at the service bay](../research/bridge-render-recovery/service-portrait.webp)

[Ronin ink](RONIN-LIGHTING.md) no longer receives scene light. Casting, reflection, lit steel, enemy and prop receivers, foreground effects and the independent HUD remain. No default, render scale, quality ceiling, renderer budget or saved preference was changed.

## Retry

The optics and raster workers each admit one job. If both workers are already occupied when a new run takes ownership, an unfinished reply from the old run can block the new opening. A new run now closes the old plate bitmaps, drops the old optical window and retires any busy lane (even for the same seed). Idle lanes remain reusable. A late bitmap from a retired lane is closed, not cached. The renderer releases its references to the old window and curb mips as well.

In Chromium 153 with the CPU compositor, the probe withheld both old-worker replies just before Results, then clicked Retry with the same seed. All accepted worlds started at tick zero with the HUD, input and music. No old replies were ever released.

| Injected stall | Retry to world + HUD submit | Current route data at submit |
| --- | ---: | --- |
| Control, desktop | 7.32 s | Watchdog, provisional Canvas; no new plates/window |
| Release candidate, desktop | 0.79 s | Both blocked lanes replaced; lit plates and new window, no watchdog |
| Control, portrait | 7.29 s | Watchdog, provisional Canvas; no new plates/window |
| Release candidate, portrait | 0.60 s | Both blocked lanes replaced; lit plates and new window, no watchdog |

This reproduces and fixes **one** Retry stall. It does not establish that the original reported hang was this stall, or that player lighting caused it. The existing watchdog still handles a genuinely blocked resource or unusable opening surface. Ordinary Engage/Retry both reached live input in the matched browser runs. Fresh normal load was variable: in one desktop stock-compositor pair Engage submitted at **2.50 → 3.58 s** and Retry at **0.78 → 0.64 s**; with the CPU compositor, **1.21 → 1.33 s** and **0.73 → 0.51 s**, respectively. A worker reply measured from send includes run-queue/delivery time, not just the worker's bake. The stock candidate's first window reply took 2.69 s against 0.72 s inside its bake. No claim of a universal startup speedup follows from these samples.

## Same-quality checks

Two serial pairs per view, locked **High**, forced Canvas with the CPU compositor, fixed seed, 36 warmup and 144 measured foreground callbacks. The backing and travel are matched. These are browser callback gaps, not display timing or physical-device FPS.

| View/pair | Backing | rAF p95, old → new | rAF p99, old → new | JS p95, old → new |
| --- | --- | ---: | ---: | ---: |
| Desktop A | 1357×758 | 50.1 → 66.6 ms | 66.7 → 83.3 ms | 8.7 → 10.9 ms |
| Desktop B | 1357×758 | 83.3 → 50.0 ms | 133.3 → 83.3 ms | 17.6 → 8.8 ms |
| Portrait A | 459×970 | 33.4 → 50.0 ms | 50.0 → 50.1 ms | 8.0 → 8.9 ms |
| Portrait B | 459×970 | 50.0 → 33.4 ms | 66.7 → 50.0 ms | 12.7 → 9.3 ms |

No gap over 250 ms in these replays. The pairs move in both directions; this isn't evidence of a steady-state FPS gain. In the settled warm Canvas camera, three section bitmaps went from **6,248,448** to **5,142,528** bytes (RGBA estimate). Residency depends on the visible sections and worker timing.

## Release verification

- The production build, **232/232 Bridge checks** and **17 exact ES 3.00 shader links** passed. The full suite passed **616/621**, with the same five gameplay and animation failures as the control.
- **12/12** matched unlit actor hashes across Canvas, worker-denied Canvas, portrait Optimized and Master. Weapon emission and GL caster counts match the control. Destroy leaves no tracked surfaces, optical window references or retained curb mips in the new renderer.
- Trusted actions, held resources, Canvas coverage, and actual WebGL context loss and restore were exercised. The matched Optimized eave probe leaves **15,961 covered samples unchanged** by wetness, including **270 next to the eave**. Both builds keep all **2,216 road-edge samples** opaque and nonblack in that probe.
- The larger forced SwiftShader resize test did not finish admitting its sky textures in time on either build. A smaller-backed wide-cap variant reached the wetness and opacity checks but tripped the RGB-only edge guard once (37 black samples, zero uncovered). The isolated road case passed on both builds. Cold diagnostic Master also hit the existing Canvas watchdog on early attempts and passed trusted Engage and Retry on recheck. None of these software runs is a physical-GPU performance claim.
- Staged and live HTTP receipts agree, including all served Bridge assets and immutable shell chunks. Public assets are byte-identical to the control. Local cross-origin embed and live touch Engage, Retry and jump passed with the promoted build.

## Reproduce

Use the browser setup in [Game loading](GAME-LOADING.md#reproduce) and point `SR_QA_URL` to each isolated production build. `--reference` on the old shaded build records its unlit actor draw for pixel comparison. `--control` expects the injected Retry stall to reach the watchdog. Keep browser tests serial for pacing.

```sh
npm run check:bridge
npm run check:webgl:offline -- --require-compiler
npm run build:iso
SR_SOFTWARE=1 node .qa/slasher-retry-work.mjs --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-retry-work.mjs --cpu-compositor --touch
SR_SOFTWARE=1 SR_SHOTS=.cache/ink-canvas node .qa/slasher-player-light.mjs --canvas --cpu-compositor --check-retirement
SR_SHOTS=.cache/ink-portrait node .qa/slasher-player-light.mjs --optimized --touch --cpu-compositor --check-retirement
SR_SOFTWARE=1 node .qa/slasher-pacing-replay.mjs --cpu-compositor --profile --quality=high
node .qa/slasher-run-readiness.mjs --cpu-compositor --lose
node .qa/slasher-bridge-finish.mjs --cpu-compositor --v4 --context-only
node .qa/slasher-bridge-finish.mjs --cpu-compositor --v4 --road-only
node .qa/preview-boot.mjs --slow
```

If play stalls in another browser, the last visible phase (menu, opening, or mid-run) and the report from `/?boot=1` help distinguish delivery, arena preparation and presentation. This report is local; it isn't sent to a server.
