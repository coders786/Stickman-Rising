# Jump, sword draw and universal switching in-betweens

> The sample-count switching scheme below is superseded by [motion-aware transitions](MOTION_AWARE_TRANSITIONS.md).
## Research and frame review

- Re-decoded six real video frames at 2.000–2.500 seconds (three-frame
  intervals) from the GitHub runner reference described in
  [RUNNER_REFERENCE.md](RUNNER_REFERENCE.md). Local decoded strip:
  `jump-draw-assets/video-observation.jpg`. Observe a quiet head/core,
  bent passing limbs and recovery. **This video is running, not a jump
  or sword-draw demonstration.** No claim of copied katana motion capture.
- Reviewed actual rebuilt game footage/frame captures for standing jump,
  running leap, falling, contact, sheathe/draw and a draw→dash interruption.
  These action frames are gameplay evidence, not external live-action footage.
- Internet terminology cross-check: [Shidokan's concept of iaido](https://shidokanmontreal.ca/conceptiaido.html)
  describes coordinated drawing and saya-biki (retracting the scabbard).
  Applied as stylized off-hand opposition, not an instructional reconstruction
  of a named kata. This was text research, not a downloaded demonstration video.
- Two generated AI illustrations explore compact airborne silhouette and
  opposed sword/scabbard hands. Resized concepts are in `jump-draw-assets`.
  They are **concepts, not anatomy or timing evidence**. Reject costume
  highlights, disconnected blade geometry and exaggerated wide stances.

## Implementation

### Air arc and contact

Standing jump now has bent athletic elbows and an explicit 65ms passing-knee
breakdown. Running leap adds an 85ms passing pose, reduces lumbar bend and
balances the gaze. Immediate jump velocity, gravity, air control and dash
momentum are unchanged—there is no delayed input for a cosmetic crouch.

Landing now starts at first contact, compresses at 45ms, rebounds at 120ms,
then recovers at 260ms. Final ground/contact IK still owns foot placement.
Running landings remain quick and cancellable rather than forcing a long squat.

### Sword ritual

Draw adds 105ms extraction and 215ms follow-through breakdowns. The wrist now
continues through equivalent up-wound angles (rather than interpolating from
4.85 down to 0.45 radians and performing a nearly full-turn unwind).
The existing 120ms blade-visibility event remains once-only; instant combat
snap-draws and danger interrupts remain immediate.

Idle relaxation and the residual sheathed-arm weld no longer overwrite active
ritual poses. Two-hand combat-grip IK does not hijack the left saya hand during
a ritual. Final blade ground-clearance constraints remain in force.

Jump/leap/air-jump, landing, draw and sheathe use shape-preserving monotone
interpolation for smooth key-to-key motion. Combat impact eases and sprint's
intentional 10Hz exposure timing are not globally replaced.

### Every animation switch

The shared animator now limits each blend update to at most one quarter of its
blend duration as well as the existing 34ms cap. Even an 18ms dash/attack blend
gets **three non-endpoint transition samples**, instead of finishing in one
30/60Hz update. This is a sample guarantee, not a claim of the same wall-clock
blend duration on every device. Input, state, hitboxes and action clocks are
not stalled by this visual interpolation.

The final constrained pose is captured separately to seed the next transition.
It is not fed into the current clip's procedural layers, avoiding accumulating
lean/arm offsets. Existing shortest-path wrist crossfades remain intact.

## Sprite studies and gameplay

1. [Air and landing](jump-sheet-01-air.png)
2. [Draw and sheathe](jump-sheet-02-sword.png)
3. [Video observation and switching](jump-sheet-03-switches.png)

Each sheet uses actual rig/animator samples, with labelled AI or source footage
where applicable. These are pre-contact FK design studies, not sprites replacing
the runtime rig. Thin sword lines use solved weapon endpoints, not the full
in-game sword shader; foot and blade clearance correction is in gameplay.

Reproduce: `node --import tsx scripts/render-jump-draw-sheets.ts`.

[Real-speed gameplay](jump-draw-gameplay.webp): six seconds, 360 samples at 60Hz,
with chapters for standing jump, running leap, sheathe, draw, draw→dash and
jump interruption. [Browser report](jump-draw-browser.json): 720 updates at
120Hz, finite poses, zero JavaScript errors, expected action clips, draw gate
and immediate dash interruption verified. Offline sampling is not a device
FPS benchmark.

## Validation

`bun run check`: **74/74 tests**, TypeScript, lint, animation and continuity
audits. Production build succeeds. New tests cover every ordered authored
clip pair, intermediate samples at low update rates, constrained display-pose
seeding without procedural feedback, bounded draw wrist motion, explicit
breakdowns, once-only steel visibility, and jump interruption before extraction.
