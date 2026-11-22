# Bridge lighting restoration and complete opening

Lighting restoration release: `7qVb8h6ndK3ypzbzONrC8`. The [responsive Night Crossing release](NIGHT-CROSSING.md) keeps this look and replaces the cut-in. Control: `PVwKfw6Ft7hel8QRweOhB`. Earlier lighting reference: `vHw4H2152H3jcUqgJajgG`.

[Earlier Canvas look](../research/bridge-complete-opening/entry-reference.webp) · [Previous preview](../research/bridge-complete-opening/entry-before.webp) · [Restored Canvas look](../research/bridge-complete-opening/entry-restored.webp) · [Verification receipt](../research/bridge-complete-opening/verification.json)

## What changed

- Restored the earlier deck cracks and bolts, negative-X approach paint, and the Canvas light-row selection and tone curve. The cropped section cards and bounded stream stay. Ronin stays flat black; the weapon, other receivers, reflections and shadows remain. Neither the renderer preferences nor the eyes-and-Murasama choreography changed.
- Engage and Retry overlap decoded images, the visible route workers, and renderer setup. The shared glazing atlas is part of readiness. The loader won't accept a provisional world simply because a transfer or a GL fence is taking too long. On the previous preview, a held deck image and a held GL fence each reproduced a Canvas handoff before the dependency finished (7.40 s and 8.67 s to submit).
- The first complete world and HUD submit is still covered. A short sequence of complete frames and a following foreground callback have to settle before the game clock, input, music and decorative cut start. A hitch invalidates the sequence. Actual GL loss can select complete Canvas; the foreground timeout returns to retryable UI rather than showing an incomplete scene. See the [opening contract](GAME-LOADING.md#current-opening-contract).

## Matched look

Five fixed scenes per renderer, seed 42 at 960×620. These comparisons use full-width display luma on a 0–255 scale, not just a bright surround or an actor mask. The shaded reference still has the old on-character lighting; only its environment is the target.

| Entrance sample | Previous preview → restored, mean absolute luma difference from reference |
| --- | ---: |
| Canvas road (y=450–531) | 3.296 → **0.106** |
| Canvas foreground (y=532–599) | 4.082 → **0.028** |
| Optimized road (y=450–531) | 0.244 → **0.058** |
| Optimized foreground (y=532–599) | 0.682 → **0.012** |

The new torso/limbs do not receive the reference's warm/cool bands. The five unlit actor-pose hashes per renderer match the earlier unlit draw. The held-frame and pixel measurements are separate: the Optimized look is a full-size, prewarmed software-GL visual fixture, not an opening timing result.

## Opening witnesses

[Held atlas](../research/bridge-complete-opening/awaiting-atlas.webp) · [Still covered after a hitch](../research/bridge-complete-opening/covered-desktop.webp) · [Desktop arena and HUD at handoff](../research/bridge-complete-opening/first-desktop.webp) · [Portrait arena and touch HUD](../research/bridge-complete-opening/first-portrait.webp)

Trusted Engage and Retry tests hold the real atlas response, then inject a 190 ms main-thread hitch after three covered submits. Composed screenshots sample four unobstructed strips of the cover. The engine starts at tick zero with the correct world seed, 100 HP, one threat, and the complete HUD. The keyboard or touch jump works after handoff. Reduced-motion, CSS-animation-disabled, tab-hide/reset, retryable timeout and both Cancel boundaries were checked. In particular, pre-publication resize + Cancel keeps the exact prior Results backing, while Menu after covered publication retires the replacement attempt. Two obsolete worker replies withheld across a same-seed Retry do not block it.

Optimized and Master were checked with real software GL at smaller test backings (238×156 and 140×92 for the held-resource checks), keeping the same shaders, nonblocking fences and pacing gate. Holds covered shader completion, texture delivery, glazing and a finished-frame fence. Actual context loss was tested separately. A forced full-size software GL run could not maintain the startup cadence and returned to the menu; the normal preview refuses known software GL and uses Canvas. These fixtures do not establish physical-GPU performance.

A separate desktop playback left the clocks alone and recorded Chromium compositor frames through the real cut and an uncovered play window. Engage/Retry first submitted under cover at **1375 / 421 ms**, opened the handoff at **1819 / 745 ms**, and showed an arena witness in the recorded cut at **2698 / 1754 ms**. The uncovered recorder samples had median gaps **51.5 / 38.3 ms** and max gaps **70.0 / 51.0 ms**. Capture costs and dropped recorder frames can affect these numbers; they are not display scanout or native FPS.

After switching the live preview, its HTTP receipt matched staging, including the HTML and public Bridge assets. Cross-origin embed, desktop Engage/Retry and portrait Engage/Retry with trusted jump passed at the live origin. The build passed **234/234 Bridge checks** and **17 exact GLSL program links**. The full suite passed **618/623**, with the same five combat/animation failures as the previous preview.

## Reproduce

Use the browser setup in [Game loading](GAME-LOADING.md#reproduce) with `SR_QA_URL` pointed at the standalone build. Run timing checks serially. `SR_SHOTS` keeps raw captures locally.

```sh
npm run check:bridge
npm run check:webgl:offline -- --require-compiler
SR_SOFTWARE=1 node .qa/slasher-complete-opening.mjs --animated --cancel --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-complete-opening.mjs --touch --cpu-compositor
node .qa/slasher-complete-opening.mjs --gl --compact --cpu-compositor
node .qa/slasher-run-readiness.mjs --optimized --hold-glass --compact --cpu-compositor
SR_GL_TEST_SCALE=.20 node .qa/slasher-run-readiness.mjs --hold-glass --compact --cpu-compositor
node .qa/slasher-run-readiness.mjs --optimized --hold-glass --lose --cpu-compositor
node .qa/slasher-load-stall.mjs --fence --compact --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-reveal-frames.mjs --playback --cpu-compositor
```
