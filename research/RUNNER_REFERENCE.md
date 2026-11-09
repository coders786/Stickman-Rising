# Reference-driven null-black ronin: analysis and three passes

> This records the reference-motion revision. Its dash/sprint mechanics were
> subsequently replaced by the [momentum/force-driven revision](DASH_PHYSICS.md).
> The black silhouette and reference-informed gait work remain current.

## The actual footage, not the YouTube description

Found with authenticated GitHub CLI in **coders786/Stickman-Rising**, remote HEAD:
`The Runner Who Never Stops Is Not Who You Think.mp4`.
Git blob `c952f9b066fb8b910828845072ba0ed45d6febb9`, 6,765,086 bytes.
Decoded with PyAV: **720×1280, 30 FPS, 28.5667 seconds**. The MP4 download is
ignored working material; it is not duplicated into this patch.

Inspected the complete chronological overview at two-second intervals, then
30 consecutive frames at **2.000–2.967 seconds**, focusing on the Discipline lane.
The [contact sheet](runner-reference-frames.jpg) contains actual decoded source
frames, not generated artwork. It supplies a locomotion/posture reference,
not reference footage for katana attacks, jumps or martial guard.

### What the frames show

- The near leg's configuration repeats approximately at 2.0, 2.4 and 2.8 seconds:
  roughly a 0.4-second full cycle, visually estimated, **not** a calibrated
  biomechanics measurement. One full cycle contains two steps.
- A relatively quiet head/core makes the leg cycling readable. Flexed elbows
  trace compact hand paths; the hands reverse close to the trunk rather than
  sweeping in enormous shoulder arcs.
- Alternating extended stance, bent-leg passing and heel recovery distinguish
  push-off from leg return. Do not create more steps just by speeding a pose clock.
- In the overview, Motivation stops/slumps, Obsession later limps, Ego surges
  and tires, while Discipline maintains its pattern. Those are meaningful state
  differences, not arbitrary alternating clips.

### Adaptation rather than a literal copy

The source figures are white with colored headbands/glow. Our **face and body
are pure #000000**, no eyes, ponytail or body highlights. The short swept crown,
raised collar, split hems and short waist obi ends stylize the outer contour.
The sword/saya are separate props and retain their material colors. Live-body
hurt/impact flashes and storm rim are disabled; weapon and scene FX remain.

We adapt stable core, opposed compact arms and contextual posture. The existing
world-distance gait/contact planner still owns cadence and stance. We do **not**
force the source's apparent cadence onto a differently scaled character. Low HP
protects the ribs and reduces the free arm's excursion, but does not fake an
injury simulation, change player speed or drag a planted foot through the ground.

## Three implemented/tested passes

1. **Silhouette + condition system.** Removed eye paths; added collar/obi contour;
   added deterministic family/condition policy and smoothed bounded pose/finger
   changes before anatomical, weapon and ground/contact solves. Initial complete
   checks passed the existing 39 tests.
2. **Condition readability + test coverage.** Added armed/free opposed run hands,
   acceleration drive, guarded/enclosed posture, protected-rib low-health reach,
   counter off-hand gathering, stop severity, landing severity and alert rituals.
   Replaced frame-random charge/hurt root jitter with small continuous oscillation.
   The first low-health pose assertion exposed an almost imperceptible arm change;
   moving the protected target up toward the ribs fixed the actual pose, rather
   than weakening the test. **43 tests passed**. Rendered and inspected the pass-2
   FK study before continuing.
3. **Reference arcs + runtime correctness.** Replaced the symmetric hand sine
   with **12 explicit periodic phase landmarks**, shape-preserving C1 Hermite
   interpolation, opposed hand phase and no per-frame randomness. Verified bounds
   and seam derivatives. The real browser test caught the old `lastGrounded` flag,
   which was initialized but never updated: it suppressed LAND completely. Removed
   that obsolete condition (onLand is already called only at actual air→ground
   contact); preserve 80/120/200 ms of rolling/soft/hard recovery unless a deliberate
   new action interrupts. Stop intensity now latches **pre-deceleration** speed,
   avoiding different skid classifications at 30 versus 120 Hz. **46 tests pass**.

These are successive code revisions and checks, not three generated concepts.
The archived pass-2 image was working material; the published study is final.

## Conditional coverage

`src/game/anim/context-motion.ts` selects the variation and applies bounded,
frame-rate-smoothed offsets. Existing authored clip/dash/jump selectors continue
owning their families. Variations are not all bespoke replacement clips:
they combine authored family choreography, game-state selection and pose/finger
layers, preserving combat timing and contact/weapon solvers.

| Family | Conditions / resulting variation |
| --- | --- |
| Idle | open, nearby threat, enclosed; low-health protected rest |
| Walk | patrol, cautious approach, combat advance; protected travel |
| Run/sprint | accelerating drive vs cruise; armed stabilization vs opposed free arms |
| Retreat | direction relative to facing and threat; original authored backpedal retained |
| Stop/brake | latched momentum, pressure and injury; softer catch vs skid and recovery |
| Jump/fall | vertical rise, travel tuck, apex balance, descending brace; existing leap/air-jump selection retained |
| Land | impact velocity and horizontal speed; soft, rolling or hard absorb |
| Dash | existing nine situational clips plus armed/protected off-hand response |
| Attack | attack kind, counter, pursuit, air state and pressure; blade arm/path remain authoritative |
| Parry/charge | ready/centered, contact/guarded or enclosed/braced |
| Draw/sheathe/flourish | relaxed vs alert gaze/hand tension; authored prop choreography retained |
| Hurt/dead | grounded/airborne and injury context, without editing weapon/contact endpoints |
| Scripted techniques | focused versus crowd awareness, bounded gaze/off-arm depth |

`player.animationVariation` exposes the deterministic selection for inspection.
Finger openness/roll also responds to pressure/injury. A held right grip stays
closed. A running free-right-arm offset cannot leak into an armed attack.

## Evidence and verification

- `bun run check`: **46/46 tests**, typecheck, lint, animation/continuity audits.
- `bun run build`: production build successful; `git diff --check`: clean.
- Regression coverage: actual air→ground recovery and pre-braking selection at
  30/60/120 Hz; periodic hand arc continuity/bounds; real pose differences; finite
  poses; unchanged gait/blade channels; armed-attack transition grip safety.
- Actual rebuilt game sampled for **600 updates at 120 Hz**, zero browser JS errors,
  every pose finite, **25 actual LAND frames** and 11 observed context variations.
  See [browser report](runner-browser-report.json). Offline simulation sampling
  demonstrates time-continuous poses, not guaranteed device FPS.
- [Gameplay review](runner-conditioned-gameplay.webp): first two simulation seconds,
  free run → HP 22 protected run, sampled at 60 Hz and shown at half speed. Low
  quality/DPR 1 held fixed for reproducible headless capture; no app settings changed
  on disk. Later landing/threat checks ran in the same browser session.
- [Final FK study](runner-context-study.png): cruise/drive/armed/protected variants.
  Explicitly pre-contact; live-game ground IK remains the final authority.
- Original pre-reference white-eye/stop gameplay remains as historical before
  evidence in `ronin-silhouette-stop.webp`; it is not the current appearance.

Regenerate the conditional FK study with
`node --import tsx scripts/render-context-study.ts`.
