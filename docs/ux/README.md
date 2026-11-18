# Rooftop wire and HUD audit

`roof-comparison.jpg`: before (top) and after (bottom), same seed, camera, actors and four seconds of wind. The tall black diagonals were the last cable segments returning to their pins, not light rays or weapon trails. The spring solver had attracted the interior of a horizontally pinned span toward a *vertical* rest line. Two-ended spans now retain their authored curve. Single-ended chains (cloth and equipment) keep their original dynamics.

Reproduce the after frame with `SR_CAPTURE_RIG=1 node --import tsx .qa/capture-fighters.mts /tmp/roof.png`. The normal short lighting fixture does not run long enough to show this regression.

## Ten UI/UX findings

| Observed problem | Change |
|---|---|
| HUD text changed sharpness and pixel alignment during resolution changes | Separate transparent, pointer-inert HUD canvas; its pixel ratio follows the display (capped at 2), not the scene governor. Single-canvas renderers remain supported. |
| Per-frame performance text showed with Show FPS off | Opt-in diagnostics sampled twice per second and kept with the score, not across the playfield. |
| Wave titles vibrated at rest and could clip on short screens | Fixed screen-space anchor, no oscillation or doubled text; fit the banner to the viewport. |
| Health damage trail disappeared immediately | Draw the track once, then delayed health, then current health. Low-health tint stays behind the readouts. |
| Palette changes left the old mood label underneath the new one | Clear the reused legend plate before baking its new label. |
| Control hints collided with the prop legend at the bottom edge | Separate their rows and require enough room for the whole legend. |
| Wide touch screens got keyboard prompts and score text behind Pause | Use the active input mode for prompts and pause clearance, not width alone. |
| Dragging off an action could interrupt a hold; joystick updates rerendered React on each move | Capture the owning pointer, release on up/cancel/loss or unmount, and move the knob directly. |
| Menu actions were clipped in narrow or short viewports | Wrap navigation and results actions, scroll tall panels, and use a two-column quality chooser at small widths. |
| Settings switches and slider thumbs had no accessible names | Label the interactive controls, expose the selected quality, retain focus on quality selection, and reserve P for play/pause (Escape still backs out). |

## Checks

- `node --import tsx --test tests/{rigging,natural-motion,hud-layout}.test.ts`: 27 passed. Exercises every cable point after wind, hitches and tier changes; also compares successive steady-banner pixels, samples the damage-trail colour, and checks wide-touch labels/clearance.
- Chromium at 320×430 CSS px, DPR 1.5, touch enabled: forced the world backing store from 256 to 320 px wide; the HUD stayed at 480 px. Checked menu reachability, six labelled settings controls, P/Escape navigation, action hold outside button bounds, release, pause/resume and no page or frame errors. This verifies scale stability, not a blanket frame-rate claim.
- Production build and typecheck passed. Full suite: 413 passed; the same five combat/animation failures as before this change.
