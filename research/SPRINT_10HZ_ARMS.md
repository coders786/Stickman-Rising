# Re-composed sprint arms: 10 Hz acting, full-rate mechanics

## References made and actually inspected

Three separate sheets combine a web observation, three newly AI-generated concept
illustrations and the actual production renderer/targets:

1. [Power and arm silhouette](arm-sheet-01-power.png): compact elbow carriage,
   front drive, rear elbow and negative space.
2. [Recovery arc and rhythm](arm-sheet-02-rhythm.png): wrist path, 100 ms exposure
   marks and the distinction between pose rate and stride rate.
3. [Hand shapes and follow-through](arm-sheet-03-hands.png): palm/knuckle/thumb
   silhouette, isolated production hands and relaxed grip.

**Internet source:** Jonathan Beverly, Outside Run, “For More Efficiency, Focus on
Your Running Arm Swing,” updated July 10, 2025:
https://run.outsideonline.com/training/run-faster-use-your-arms/
Photo credit on source: **Getty Images**. A resized study thumbnail and detail crops
are attributed in the sheets; the photo is not presented as project-owned art.
The article discusses elbow drive, compact carriage and the triangle of negative
space between arm and torso. It is a running/form reference, not a universal
prescription that distance runners and sprinters must use identical arm carriage.

**AI inputs:** one power-run silhouette, one passing/recovery silhouette, one
single-hand sketch. Generated separately and then composed into sheets by script;
they are design prompts, **not** motion capture, clinical anatomy or proof of
biomechanics. The recovery concept's exaggerated open hand and costume highlights
were explicitly rejected. The near-face fist and large forward reach in the power
concept were reduced to a compact rib-height target in the game.

Assets/provenance are in `arm-reference-assets/`. The curve is generated from actual
`runningHandMotion()` output. The isolated hands call the same exported
`drawArticulatedHand()` that the live character uses, rather than a separate
concept renderer. The five body examples are pre-contact target studies, not a
claim that final gameplay ground IK was applied to those static panels.

## Rethinking form and harmony

- **10 authored phase landmarks** for the sprint wrist path: rib-height drive,
  front reversal, down/back elbow stroke, rear extension, compact return.
- Left/right arms oppose by half a stride; the rear elbow opens more than the
  front elbow. No rigid both-arms-behind pose or sideways windmill.
- The wrist follows 4% of a cycle behind the main arm arc. Rotation stays small
  (≤0.1 rad), avoiding floppy hands.
- Forward drive gathers the fingers; rear recovery softens them. The index,
  middle, ring and little fingers retain different segment lengths/curls.
- Arm silhouette is re-composed as a tapered triceps mass, narrow elbow,
  forearm belly and wrist. Muscle fullness responds to elbow flexion.
- Palm is now a compact angular shape instead of a round ball; articulated
  fingers and opposing thumb remain a pure-black continuous surface.
- The weapon hand stays closed with no cosmetic wrist roll. Actual weapon,
  anatomical limits and grip/contact constraints still have final authority.

## Exactly what “10 FPS” means here

`SPRINT_POSE_HZ = 10`, or **one upper-body exposure every 100 ms of simulation
 time**. This is not GHz, ten gait cycles/second or a 10 FPS game-frame limiter.

The 10 Hz exposure cache samples arm/core/head acting channels and finger/wrist
rendering **after** continuous motion smoothing; putting a spring after the cache
would unintentionally smear the requested holds. It preserves the incoming gait
phase and does not slow movement, reset the stride, or add footfalls.

Root travel/height, pelvis/legs, input, collision, foot placement and final
weapon/grip solvers remain full-rate. Consequently world-space hands can still
move with the travelling body and constraints even when their acting channels
are held. This is a deliberate mixed-rate anime treatment, not freezing the
entire character's collision/ground geometry.

At 480 px/s and the existing 220 px full stride, cadence is approximately 2.18
full cycles/second. **About 4–5 upper-body exposures fit each stride** at 10 Hz.
Ten landmarks per authored trajectory are not ten displayed frames per stride.

The exposure clock is independent of render FPS and clip playback speed. It
survives power-stride→cruise changes without restarting. Dash, pivot, jump,
stop, attack and other non-sprint actions clear the cache immediately. Animator
transitions adopt the visible held pose, so an interruption does not blend from
an unseen continuously moving arm. Other actions keep their original timing.

## Validation

- `bun run check`: **68/68 tests**, typecheck, lint, animation/continuity audits.
- `bun run build`: production successful. `git diff --check`: clean.
- New regression tests count exactly ten exposure changes per simulated second
  at 30/60/120 update rates, verify root/gait channels stay live, immediate
  interruption, reachable opposed arm paths and visible-pose transition seeding.
- Actual rebuilt browser game: **600 updates at 120 Hz**, zero JS errors, every
  pose finite. Over two sprint seconds, **20 exposed poses**, with **220 adjacent
  update pairs having identical final left shoulder/elbow and finger gestures**.
- Normal hold is still **350 px/s**, double-tap-and-hold still **480 px/s**.
  Dash and pivot cleared sprint exposure on their first input update.
- [Browser report](sprint-10hz-browser.json).
- [Real-speed gameplay](sprint-10hz-gameplay.webp): five simulation seconds,
  300 samples at 60 Hz. The clip is deliberately **not half-speed**: the sprint
  arm posing actually reads at 10 Hz, while travel/contact remain responsive.
  Offline 120 Hz simulation is not a device frame-rate benchmark.

## Reproduce the design sheets

```
node --import tsx scripts/render-arm-exposures.ts
python3 scripts/compose-arm-reference-sheets.py
```

The second command needs Pillow and DejaVu Sans (outside the runtime dependency
set). Resized AI and web reference assets are preserved for recomposition.
The live-game capture used external Playwright/Chromium tooling, not a runtime
package added to the game.
