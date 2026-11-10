# Shadow Ronin — motion mechanics revision

> Superseded visually by the [black silhouette / smooth-stop revision](SILHOUETTE_MOTION.md).
> Its gait synchronization and dash mechanics remain in use.

The user rejected the previous forward-folded walk/run, incoherent arms and
step count. This revision changes the mechanics rather than adding more lean
or relying on costume detail to disguise the problem.

## Reference research

These are reading-based choreography/biomechanics references, not motion capture
or a claim to have frame-matched footage from the films.

- **Acceleration vs sustained sprint:** whole-body support-line lean belongs to
  acceleration; the athlete rises at sustained speed. Arms stay active and
  compact; landing too far ahead creates braking. Applied here as a transient
  dash diagonal with a quiet core, not a permanent crouched sprint.
  [3](https://thesprint.club/sprinting-simplified/)
- **Grounded live-action samurai:** Kenji Tanigaki describes making action look
  reasonable, staying settled to the ground unless a jump is necessary, and
  using low ground techniques in *Rurouni Kenshin*. Applied as one push, a brief
  flight and an absorbing catch, not a repeated running loop inside the dash.
  [3](https://mubi.com/en/notebook/posts/the-action-scene-choreographing-the-real-a-conversation-with-kenji-tanigaki)
- **Anime timing:** Yutaka Nakamura discusses emphasis on fast and slow movement
  in this translated interview. Applied as a short readable load, a sharp burst
  and a longer easing catch, rather than constant-speed locomotion with trails.
  [1](https://wavemotioncannon.com/2016/10/05/interview-yutaka-nakamura-web-anime-style-7192003-part-1/)
- **Anime silhouette:** Nakamura discusses action as silhouette in the second
  interview part. Applied as clear negative spaces between the actively bent
  arms, torso and separate lead/trailing legs.
  [3](https://wavemotioncannon.com/2016/11/02/interview-yutaka-nakamura-web-anime-style-7192003-part-2/)

The exact angles, durations and cadence below are game-design choices—not
universal medical measurements inferred from those sources.

## Diagnosed causes and changes

1. **Half-rate torso clock:** `GaitPlanner.phase` describes a FULL left/right
   cycle; clip playback had divided its cadence by two and imposed a minimum
   playback rate. The upper and lower body could never reliably agree.
   `Animator.update` now accepts the planner's normalized phase. This single
   clock owns arms, core bob and foot planning; blend weights still use real dt.
2. **Excessive footfall count:** stride length was treated ambiguously as both
   a step and a full cycle. It is now explicitly world distance per full cycle.
   The visual character is about 125 world pixels tall. Calibrated rates:

   | Mode | Speed | Full-cycle distance | Full cycles/s | Footfalls/s |
   |---|---:|---:|---:|---:|
   | Walk | 105 | 110 | 0.955 | 1.91 |
   | Run | 350 | 185 | 1.892 | 3.78 |
   | Sprint | 480 | 220 | 2.182 | 4.36 |

   Previously run at 350/98 cycled the feet about **7.14 times/second** while
   the upper-body clip was driven at half that cycle frequency.
3. **Truncated dash clips:** the launch state lasted 170ms while its clip lasted
   240ms. New launch lasts 260ms; every variant's playback rate is explicitly
   `clip.dur / state.dur`. The catch/recovery can play rather than being cut off.
4. **Locomotion IK overrode dash:** its old authority decayed at k=8, retaining
   roughly 51% after 83ms—over the dash's strongest pose. Dash now releases the
   cyclic planner at k=60, retaining less than 1% by the same time. This prevents
   leftover walking steps from overwriting the authored launch/flight.
5. **Sword inertia bent the walker:** a blade/wrist angular-velocity spring
   fed root and spine rotation in EVERY state, including when sheathed. Only
   actual attacks now receive kinetic-chain body feedback. Hidden blades also
   no longer run the ground-clearance wrist correction.
6. **Raised feet affected pelvis support:** ground-support height previously
   tested a target's negative Y rather than its planted flag. Swing feet no
   longer act as load-bearing contacts.
7. **Stacked depth rotations:** reduced run's procedural pelvic twist, authored
   free-arm yaw and forward-dash arm/forearm carry yaw. Blade yaw still provides
   depth without corkscrewing the arm. The left arm is no longer welded to the
   saya during walking, so its authored counter-swing survives.

8. **Old rig leaked through dash FX:** live capture showed the new character
   overlaid with circular joints and a round skull. Dash/ability echoes were
   still calling the legacy 2D `drawStick`, ignoring the actual 3D anatomy.
   All player echoes now use `solveFighter3D` and the same ronin surface renderer.
   Removed the white-hot duplicate echo; reduced colored rim brightness. The
   live dash figure stays opaque instead of blinking under its own afterimages.

## Pose direction

- Walk roughly 2–3° core pitch; run roughly 7° including core; sustained sprint
  roughly 10–12°. Acceleration can add a small bounded transient, but the
  deepest diagonal belongs to the dash.
- Dash peak: root pitch .62 rad (~35.5°), spine .035 rad (~2°), head counteracts
  the torso to keep gaze near the travel direction. Pelvis/chest yaw is small.
- Dash beats: load → 52ms push → 120ms flight → 190ms catch → 260ms settle.
  One propulsive action—not a high-frequency miniature sprint.
- Arms stay actively flexed, free hand counter-swings in hand space, sword arm
  keeps a purposeful compact carry. Contact/weapon IK remains after pose
  tracking; no smoothing is applied after solved feet or grip points.
- Slightly leaner deltoid, upper-arm and thigh contours, a quieter hair crown,
  less protruding nose and humerus-local muscle creases refine the body shape.

## Image-driven iterations and actual gameplay

- `ronin-dash-motion-reference.png`: newly AI-generated target, not gameplay.
- `ronin-motion-before.png`: actual old rig study, including old truncated dash.
- `ronin-motion-revised.png`: actual revised rig study, before gameplay contact IK.
- `ronin-dash-before.webp`: old production-game dash, captured before rebuilding.
- `ronin-dash-revised.webp`: revised production-game dash, including real contact
  IK, scabbard/grip, ghosts, launch accents and recovery. Captured from the
  browser with a close-up tracking camera and deterministic 60Hz stepping.
  Playback is deliberately half speed for reviewing the short movement.

Reviewing the first live capture exposed the sword-inertia spine feedback
that wasn't present in the authored-pose sheet. That was fixed in the second
motion pass; this is why both pose sheets and runtime capture are necessary.

Reproduce the static study: `node --import tsx scripts/render-motion-study.ts`.
The preserved BEFORE image is a historical artifact; do not regenerate it using
new code and label it as the old renderer.

## Verification

- Full check: TypeScript, lint, **29 tests**, animation and continuity audits pass.
- Production build passes; refreshed live preview serves the new renderer/motion.
- Browser walk/sprint smoke: zero JavaScript errors; measured planner and clip
  phases agree to floating-point precision in both modes. Both thighs remain 25
  and shins 24; reversal, jump and light attack exercised.
- Deterministic live dash: 15 rendered dash frames at 60Hz, max lumbar pitch
  **0.034964 rad** (~2°), final dash-state clip progress **96.15%** before exit,
  and cyclic gait authority below 1% by the fifth dash frame. No browser errors.
- Automated tests exercise clock/footfall consistency at 30, 60 and 120Hz,
  all variants' clip/state duration mapping, launch ROM limits and actively
  flexed arms, plus isolation of weapon inertia from locomotion/dash posture.
