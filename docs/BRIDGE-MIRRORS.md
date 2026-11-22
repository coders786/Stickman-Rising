# Night Crossing: mirrors and raised-deck light

> Historical release. The Track Watch and Security Mirror fixtures, their asset and their replay fixture have been retired. See [Storefront glass](BRIDGE-STOREFRONTS.md) for the current windows and loading handoff. The raised-deck transport described here remains active.

This update extends the [Bridge handoff](BRIDGE-HANDOFF.md) and [Canvas pacing](BRIDGE-PACING.md) work. The [SACR v4 contract](../IMPORTANT.md) is unchanged: 3,584 bytes, 80 columns, 8/4 records, 2/1 direct shadow lobes, and atomic seed-owned transport. Deck collision and the dry-eave boundary have not moved.

## Track Watch and shelter mirrors

The entry kiosk socket now holds **Track Watch / M-01**, an upright mirror beside the concourse. Metro shelters have a separate **Security Mirror** in the rear bay. These are world fixtures, not wet-road effects. The glass still returns a figure in a dry shelter; a post or jamb can block its sightline.

- A small semi-baked WebP contains two reflected views of authored facades, railings, and structural details. A moving camera samples a different window into that card. Denying it leaves the housing and a painted glass backing.
- The live part reflects the solved body joints, weapon, scarf, and selected local impulses through each yawed plane. The intersection with the eye ray determines position and scale. Each return is clipped to the aperture and uses the local section's transmission test. Real actors and foreground props draw in front.
- Canvas paints these returns directly. Both WebGL tiers use the existing actor input; there is no mirror framebuffer, viewport capture, HUD copy, or runtime readback. At most four visible panes each admit the hero and up to five other bodies. The emergency painter does not require live returns.

## Top, fascia, and asphalt

The catwalk and cargo box share authored extrusions between the art, Canvas clip, Mobile receiver, and Master mesh. A raised cast and sole contact land on the narrow sheared **top**, not a stripe down the fascia. A separate road projection can reach the lane below or beyond the edge. The road bake treats the slab as finite across the section, with seven lunar samples across the edge; it is no longer an opaque curtain across every road depth.

Canvas estimates one source's diffuse loss from a few taps on the receiver. It matches baked practical directions to their authored lenses and can fall back to a lunar cast if a lens misses the surface or is blocked there. It does not paint a second mask onto the same surface. WebGL adds the eligible finite combat source to its bounded selection. Sole AO, wet reflection, and emissive returns are independent. A baked umbra contributes no direct lunar light to remove, and the dry eave cannot inherit a wet-road return.

## Engage and Retry

**Night Crossing** is a short, cancellable interlude, not a timed splash. The frame, route/surface status, and Cancel work before the optional poster decodes. The layout fits touch and reduced-motion settings. Escape cancels on keyboard; cancelling a Retry returns focus and preserves the Results frame and score card.

After accepting the run, the two worker lanes begin the opening optics window and useful route plates. They can work while the initial arena is being prepared. Optional WebGL work has a separate budget: on available frames during a held submit, or after the first submitted simulation step, it can advance existing parallel program jobs and stage the same atomic transport the rich renderer will consume. It does not resize the output, force a blocking link, or publish a GL frame early. If the browser lacks the parallel compile extension, normal tier admission handles linking later. The interlude disappears on the first complete world+HUD submission, regardless of asset or worker readiness; gameplay input and the new music start follow that submit.

## Verification

The [browser and build receipt](../research/bridge-mirrors/verification.json) records the staged build, the matched Engage/Retry trials, and the checks on the served preview. See [Track Watch](../research/bridge-mirrors/track-watch.webp), [the dry Security Mirror](../research/bridge-mirrors/dry-shelter-mirror.webp), [the cargo receiver](../research/bridge-mirrors/cargo-receivers.webp), and the held interlude on [desktop](../research/bridge-mirrors/night-crossing.webp) and [portrait](../research/bridge-mirrors/night-crossing-portrait.webp).

The receiver comparison disables one lighting term at a time without changing the pose. In Canvas at seed 52, the centered cast affects **329 catwalk-top and 312 cargo-top pixels**, and independently affects **167 and 1,939 pixels** on lit asphalt. At seed 48, WebGL's centered cargo footprint is largely in baked umbra; its lip pose shows separate asphalt loss. Neither the sole nor the cast leaks onto the fascia. With the moon disabled, the authored service-bay light still produces a direct cast in all three tiers: the measured shelter floor stays dry while the exposed road has wetness .78. The packed-stream check also sees zero impact-light leakage behind the catwalk, a visible return with that blocker removed, and a clean reacquisition after context loss and a seed change.

The held Engage check completed one optics window and two plates before the first submit, without enabling gameplay input or starting the new run's music. On the test driver, WebGL advanced hidden preparation steps but uploaded no transport during the hold (the parallel compile extension was unavailable). That demonstrates worker overlap, not parallel GPU linking.

In three matched desktop samples with Chromium's CPU compositor, median gesture-to-first-submit changed from **55.3 to 57.0 ms** for Engage and **25.7 to 29.6 ms** for Retry. Rich Canvas submission changed from **325.1 to 443.0 ms** and **283.2 to 268.7 ms**, respectively. One emulated-touch sample per build passed trusted input before and after promotion; its first-submit times were 47.2 → 76.3 ms for Engage and 32.4 → 35.8 ms for Retry. These are application markers, not physical display or handset timings, and they do not establish a startup speedup.

The production build, **208 Bridge tests**, and **17 offline shader links** passed. The full suite passed **592/597**, with the same five combat and animation failures as the previous preview.

## Reproduce

Use [the production browser tools](GAME-LOADING.md#reproduce) and a staged `SR_QA_URL`. The mirrors and receivers checks replay fixed poses and use readback only in QA. The loading checks use trusted input. The held-frame test intentionally defers submission to inspect the real interlude, not a minimum time in the release.

```bash
npm run check:bridge
npm run check:webgl:offline -- --require-compiler
npm run build:iso
SR_SOFTWARE=1 node .qa/slasher-bridge-receivers.mjs --canvas --cpu-compositor
node .qa/slasher-bridge-receivers.mjs --optimized --cpu-compositor
node .qa/slasher-shop-glass.mjs --cpu-compositor
node .qa/slasher-shop-glass.mjs --touch --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-shop-glass.mjs --canvas --deny-city --deny-worker --cpu-compositor
SR_SOFTWARE=1 node .qa/slasher-interlude.mjs --touch --reduce --deny-loading --cpu-compositor
node .qa/slasher-interlude.mjs --gl --cpu-compositor
node .qa/slasher-v4-stream.mjs --touch --cpu-compositor
node .qa/slasher-load.mjs --early --stages --input --promotion --cpu-compositor
```
