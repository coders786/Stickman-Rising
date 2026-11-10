# Motion-aware transition correction

## What was actually wrong

The old promise of three in-between frames was not a physical or anatomical
constraint. It blended a frozen outgoing angle snapshot toward a live clip,
added an approximate drift term, and capped elapsed blend time by rendered
samples. Short blends therefore had different wall-clock timing on different
devices. More keys did not fix the outgoing motion or the paths of the hands.
Later procedural layers could overwrite those bridges. The anatomical tracker
was disabled for most actions, exactly where abrupt posture changes were large.

Review also exposed a separate draw-completion bug: idle relaxation could
subtract 2.09 radians of wrist angle as soon as the ritual ended.

## Replacement implemented

- `inertial-transition.ts`: retains the outgoing pose and velocity as a
  quintic residual on the moving incoming target. Residual position and velocity
  vanish at completion. Timing uses actual seconds, not forced sample counts.
- Duration adapts to the size of the initial core/hand-direction change
  (70–280ms when blending is requested). Explicit zero-blend initialization
  remains immediate. Gameplay clocks and hit windows are not delayed.
- Arms are encoded as shoulder-relative hand direction and reach, not blended
  shoulder/elbow angles. A fixed-length two-link solve reconstructs the arm;
  reach and elbow/shoulder bounds prevent shoulder collapse and hinge inversion.
  This is a sagittal-plane path with authored depth motion, not full 3D collision
  planning. It does not prove absence of every possible torso/self intersection.
- Weapon/hand pitch is represented as the **sum** of shoulder, elbow and wrist
  angles. The wrist compensates for the resolved arm, rather than acquiring an
  accidental extra rotation from the arm's transition. Existing final ground
  clearance and combat arc/grip solvers still have authority.
- Player prepares contextual/procedural targets first, then applies the bridge,
  then final combat/contact constraints. Displayed-pose velocity seeds the next
  switch. No procedural offsets accumulate into the current clip.
- The existing bounded anatomical tracker now stays enabled through living
  actions, including rituals and dash, rather than resetting on each action.
- Sprint's 10Hz holds begin only after its entry transition settles. Physics,
  travel and contact remain continuous throughout.
- Stationary sword rituals retain the existing idle gait/contact planner.
  They no longer discard planted-foot authority just because a ritual starts.
- Draw completion ramps relaxed-carry weight rather than enabling the full
  idle wrist offset in a single update.

## Checks and observed results

- **86/86 tests**, TypeScript, lint, animation/continuity audits pass.
- Production build succeeds.
- Replaced the old sample-count assertion over all 1,225 authored clip pairs
  with finite-motion, source continuity and elapsed-time settlement checks.
- New tests check outgoing velocity, equivalent results at equal elapsed time
  across 30/60/120Hz, shoulder-safe arm reach, elbow flexion, invariant weapon
  pitch, inclusion of procedural targets, and draw-completion wrist continuity.
- [Browser report](motion-aware-browser.json): 720 updates at 120Hz, finite poses,
  zero JavaScript errors. Standing jump, run→leap, fall→land, stop, sword rituals
  and draw→dash interruption exercised. Visibility events remain correct.
- In that exact script, maximum core-angle change fell from ~0.138 to ~0.067
  radians per update; the draw-completion wrist change fell from ~2.27 to ~0.43
  radians. These are observed deltas, not universal anatomical speed guarantees.
- [Gameplay review](motion-aware-gameplay.webp): six seconds, 360 samples at
  60Hz, real-speed playback. Offline capture is not a device FPS benchmark.

## Scope and remaining limits

This is a substantial transition-system correction, **not** a claim that every
animation now satisfies all laws of nature. Authored poses, state transitions,
final combat IK and ground clearance can still affect derivatives. Full-body
center-of-mass optimization, predictive obstacle avoidance, self-collision and
all possible support-transfer sequences are not simulated. Their absence should
not be hidden behind more frames or the word “physics.” Contact- and action-
specific authoring remains necessary for remaining visual defects.
