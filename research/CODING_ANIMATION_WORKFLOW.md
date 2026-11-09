# Code-only smooth 2D animation workflow

Research and implementation, 2026-11-09. This game uses a code-driven skeletal rig rather than a pre-rendered stick figure sprite. Timing and feel are artistic decisions, not something an interpolation formula alone can guarantee.

## Sources and what they contribute

- [Axis](https://github.com/davepagurek/Axis) describes a keyframe-based stick-figure animator with automatic in-betweens. The applicable idea is to author strong key poses and let software interpolate the intervals instead of hand-drawing every display frame.
- [2D IK Animation Package](https://github.com/AshhProjects/2D-IK-Animation-Package) describes IK posing, a timeline, onion skins and angle-aware interpolation that preserves limb lengths. In this project the skeleton, joint limits and two-bone ground IK already exist in `src/game/anim/rig3d.ts`, `limits.ts` and `legik.ts`.
- [Godot Skeleton2D documentation](https://docs.godotengine.org/en/stable/classes/class_skeleton2d.html) describes a bone hierarchy and inverse-kinematic modifications, and [AnimationTree](https://docs.godotengine.org/en/stable/tutorials/animation/animation_tree.html) describes blending clips. The existing TypeScript animator, inertial transitions and IK provide the relevant runtime concepts without switching engines.
- [Animation principles in games](https://www.gamedeveloper.com/production/the-12-principles-of-animation-in-video-games) discusses anticipation, overlapping action and the trade-off between recovery and responsiveness. Keep separate body/arm/weapon timing, but preserve the requested stabilization and active combat inputs.
- A [YouTube Unity IK tutorial](https://m.youtube.com/watch?v=APb2AdgQMfk) was located via its indexed description: it covers 2D bone setup, effectors and IK solvers. YouTube video playback was not available in this sandbox, so its frames were not watched and its content is not presented as a frame-by-frame review. The prior 2D preview GIF frame review is documented in `2D_DASH_FRAME_STUDY.md`.

## Implemented alternative

- The standard dash's procedural body curves formerly used a separate quintic ease on *every* key interval. Each intermediate key forced its velocity back to zero, producing repeated start-stop motion. They now use time-aware, monotone cubic Hermite interpolation: moving channels flow continuously through intermediate keys, while extrema stay bounded and still hold intentionally.
- The powered dash already uses a separately authored monotone clip, continuously sampled with a skimming-foot IK layer. The existing inertial transition works from the displayed pose and velocity rather than crossfading from a hidden frame. These systems remain in use; no wholesale motion-blurring or control delay was added.
- `npm run art:dash-motion` is a reproducible code-only inspection tool. It runs the real player/input/physics code at 60 updates per second and renders the rig at 30 frames per second by default (or 60 with `--fps=60`), and writes looping GIFs, 12-pose sheets and JSON position/pose telemetry to `.cache/dash-motion-30/` by default. Pass an output directory as an argument, e.g. `npm run art:dash-motion -- /home/user/dash-visual/review`. Frames are centered on the player to inspect articulation; this is not a camera-follow or effect-quality test. Output is local and ignored by Git.
- `tests/grounded-dash.test.ts` checks continuity at each in-between, meaningful motion through the center key, bounded joint targets, visual floor clearance and behavior at 30/60/120 Hz. Existing attack, charge, recovery and physics tests still apply.

## Availability and limits

`blender`, `godot` and `ffmpeg` were not on PATH in this sandbox. The existing `@napi-rs/canvas` and `sharp` dependencies produce real rendered frames and GIF playback instead, with no desktop application. The GIFs and contact sheets were inspected; an in-game browser check remains important because the script intentionally centers the character and does not reproduce the full world/effects/camera.
