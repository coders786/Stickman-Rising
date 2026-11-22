# Baked optics and quality locks

> Historical render study. For current presets and Engage, see [Continuous Bridge](PROCEDURAL-BRIDGE.md).

This page records the earlier lighting comparison. See [Practical Optics](PRACTICAL-OPTICS.md) for the currently shipped fixture and wet-road treatment, and [Wet Bridge water and full-scale Ultra](WATER-RELAY.md) for the intermediate live relay.

**Play:** Settings → Visual Quality. **Adaptive Quality** stays on by default and treats the selected tier as a ceiling. Turn it off to lock the selected tier at its full scale (Low 1×, Medium 1.25×, High 1.5×, Ultra 2.25×). **Absolute Ultra** selects Ultra and turns Adaptive off, including on touch devices. Press it again to return to Adaptive Ultra. The saved choice survives reload; the scene route and HUD backing do not change with the lock. Turning Adaptive off after a shed restores the selected tier immediately. Night Station is still the opt-in dry art preview under Settings → Try Night Station.

## What changed after looking

[Before / after](../research/optics-grade/before-after.jpg) · [Both revisions](../research/optics-grade/iterations.jpg) · [Portrait combat and HUD](../research/optics-grade/portrait-combat.jpg)

| Pass | Wet Bridge | Night Station |
|---|---|---|
| **First bake** | Put a tight core and soft skirt behind the lamp and sign, using local source art on both routes instead of making the scene a light source. Cool the steel and quiet the small signs. The matched frame still had a brown cast in the upper towers. | Keep the dry receiver and give the sign its own scatter. Violet spill still competed with the Night Line sign. |
| **Revision 1** | Use the existing haze strip to confine the warm air to the rail and reveal the cool upper skyline. Move the lamp halo under the glass. The portrait crop made the moon glare beside the score more obvious. | Reduce beacon spill, give the sign a warmer diffuse pool, and deepen the track wall. The new arch edges looked like lines rather than stone. |
| **Revision 2** | Lower the existing moon disc/corona exposure in the sky composite and reduce the secondary violet spill without changing the moon's position, key or the wet receiver. | Bake a feathered reveal into each arch instead of an outline. Lift the slate edge of the recess just behind the fighters, keep dark depth below it, and finish the sign in ivory. |

Nine matched shots cover the Bridge lamp (camera starts at x=880, lamp x=830), both signs (x=1755), a 390×844 portrait crowd on each stage, and Ultra on both routes. They use seed 42, 1× backing, matching fixed input and sim clocks, and identical settled drizzle or dry conditions. For every pair the sim trajectory digest, camera travel, weather and HUD pixels matched. The portrait crowds draw ten foes. At Low, the lamps, matte-vs-wet distinction, contact shadows and warning cues read before any optional High/Ultra effects.

## How much is baked

- **Depth and materials:** four existing plates per stage, `256×53`, `341×80`, `683×187`, and `2048×480` (4.39 MiB of raw RGBA total). No duplicate graded copies. Blur only one band at a time, with its existing source and wrap scratch; the largest pair is 8.75 MiB raw and is released in `finally`. The horizontal amber grade is now painted into the existing `8×150` haze slot.
- **Fixture optics:** two existing `64×64` halo slots (32 KiB raw combined), with a tight core and transparent skirt, stamped at most twice total per frame behind fixture hardware. Camera projection, visibility and emitter gain stay live. High/Ultra still draw their local shafts; the old whole-scene bloom and ray sampler is bypassed on both stages. The control's Ultra capture route sampled 72 times per 72-frame window. The final route sampled **zero** times and keeps **three fewer surfaces / 76 KiB less** at 1000×560. The Bridge's moving road mirror remains separate; Station never allocates it.
- **Lifetime:** the stage owns fixture sprites, halos and shaft shapes from its first warm, plus Bridge's haze or Station's four architecture plates and recess. Retries still replace the seeded Bridge city and each run's receiver/light transfer. The steady, blocker-aware spill is painted into the existing floor span; the `96×24` ribbon strips retain the live remainder. Wet asphalt alone receives specular spill; Station receives diffuse light. No new viewport buffer, per-tier bake, startup asset request, or duplicate road plate.

At 1000×560 and 1×, tracked offscreen backing estimates on the Ultra capture route were **24.13 → 24.05 MiB** on Bridge and **14.34 → 14.27 MiB** on Station. Low retained the same number and size of surfaces as the control. These exclude the scene/HUD output and are ledger estimates, not browser or GPU memory. Absolute Ultra's 2.25× backing carries about 5.06 times as many scene pixels as 1×; it is not a frame-rate target.

## Measured separately: ready, play, and pacing

Production standalone builds, Chromium 153 with CPU compositor, three fresh-browser samples per side in alternating order on warmed servers. `Navigation → Engage enabled` is the first observation of the enabled button, not title art completion. Engage and Retry use accepted-action and `playing` marks, with a trusted gesture after the title has drawn. Shown in ms (median with min–max in parentheses):

| Fixture | Navigation → Engage enabled | Accepted Engage → playing | Accepted Retry → playing |
|---|---:|---:|---:|
| Bridge desktop | 325 (312–331) → 299 (293–343) | 671 (643–674) → 663 (659–788) | 612 (596–623) → 622 (620–648) |
| Station touch | 301 (294–338) → 318 (300–322) | 277 (256–294) → 68 (66–73) | 261 (233–265) → 49 (43–51) |

Station saves work **after** the title by reusing the architecture kit. The cold ready and Bridge run measurements do not show a consistent speed-up. In a separate Ultra capture-route replay (1000×560 at 1×, 120 frames, three pairs, software rendering, no pixels, state trace or pass timers), median per-run p95 submission fell **45.4 → 43.4 ms** on Bridge and **23.8 → 6.9 ms** on Station. p95 rAF stayed around **50 ms** and **33 ms** respectively. No sample had a visible >250 ms frame interval. These are matched workload probes, not presented frame counts or a phone FPS claim.

## Verified in the preview

- Desktop/forward and touch/capture: trusted settings clicks/taps, Adaptive shed and recovery, fixed preset snap-back, Absolute Ultra at 2.25× under injected load, and reload persistence. Disable Adaptive to bypass **both** tier/DPR feedback and the fast cliff detector; reenabling it starts from a clean 1× target. Switching modes while paused preserved the run, its bakes and the HUD backing. Touch also passed the dry Station switch and Retry; both input routes passed pause/restore and preparation cancel/remount on Bridge.
- **20 deferred Retries per stage at Absolute Ultra:** the fixture kit stayed the same and previous seeded canvases were released. Bridge held **57–58** tracked offscreen surfaces (**19.81–21.45 MiB**, cloud bank varies; **0.63 MiB** fixed kit). Dry Station held **29 / 12.45 MiB** (**6.27 MiB** fixed kit). No accumulated or surviving surfaces after either teardown. Scene/HUD sizes were `1440×810` / `640×360` on Bridge and `877×1899` / `780×1688` on Station.
- Before and after, embedded startup fetched **12 JS, one CSS, and two fonts** through Engage-ready. HTML plus those gzip response bodies grew from **550,040 to 551,636 bytes** (+0.29%) for the settings and art code, with no added request. Hashed files were served immutable and both embeds played.
- Preview build, typecheck, boundaries, targeted lint and **93/93** focused tests passed. Full gate: **483/488**, with exactly the five previously recorded combat failures. [Raw verification receipts](../research/optics-grade/verification.json).

## Reproduce

```sh
# Configure SR_BROWSER_TOOLS (puppeteer-core and Chromium) as for slasher-replay.
bash .qa/slasher-optics-captures.sh "$PWD/src" .cache/optics-grade/final
node .qa/slasher-optics-report.mjs .cache/optics-grade research/optics-grade

node .qa/slasher-quality.mjs
node .qa/slasher-quality.mjs --touch --station-preview
node .qa/slasher-optics-retries.mjs
node .qa/slasher-optics-retries.mjs --station
node .qa/slasher-load.mjs --cpu-compositor
node .qa/slasher-load.mjs --cpu-compositor --touch --station
```

The board generator expects `before`, `v1`, `v2`, and `final` capture directories. The control freezes the complete pre-change working `src/`, not only Git's base (`9d27d2b2`). It includes pre-existing artwork and loading changes; the frozen tracked-patch SHA-256 is `f890b97f14fa7b0722bf3c8f8cf238e67a0ebcb45fc506521f56d6c7381c5b36`. The review boards and [capture receipts](../research/optics-grade/capture-receipts.json) are saved in the repo; raw runs and the frozen source live in the ignored `.cache/optics-grade/` working directory.
