# Force-driven dash, momentum and double-tap sprint

> The later [ninja lean/hand revision](NINJA_MOTION.md) strengthens sprint/dash
> styling while retaining these physics and controls.

## Controls

| Input | Behaviour |
| --- | --- |
| Hold A or D | Normal acceleration and run, ceiling 350 world px/s |
| Tap/release/tap-and-hold the SAME direction | Sprint to 480 px/s, about 37% faster |
| Release the second press | Clear sprint intent immediately; momentum decelerates under friction |
| Shift / L (C also remains mapped) | Dash along directional input; defaults toward facing |
| Oppose existing momentum with dash | Brace/pivot, overcome old travel, then propel in the new direction |

The two presses must be within **280 ms**. Keyboard autorepeat and a second
keydown without a release do not count. Switching direction, opposing keys,
blur and disabling input/pause cannot leave a stuck sprint latch. Arrow-key
aliases and virtual direction buttons use the same recognizer. The analog
joystick remains analog; double-flick sprint recognition is not added.

## Replaced mechanics, not just different numbers

Old dash travel assigned `vx/vy = direction × speedEnvelope` each frame. Entry
overrode incoming velocity, exit multiplied/capped it, and normal movement then
clamped remaining overspeed. All of that has been removed. The old speed-envelope
function/config is deleted; its regression test now exercises the actual motor.

### Continuous motor and resistance

`src/game/physics/dash-body.ts` integrates a finite propulsive impulse:

- Nominal mass **70**, in scaled game units.
- **p = m v**, **Eₖ = ½ m |v|²**, **F = m a**, and **Δp = ∫F dt**.
- Project incoming velocity along intent. Forward momentum adds to the target;
  opposing momentum must be overcome rather than changing sign on input.
- A normalized **6u(1−u)** force pulse supplies the finite impulse during drive.
- Thrust target is bounded (1250 px/s along intent); a work-direction governor
  cuts additional speed-adding motor force above 1300 px/s. It does not teleport
  externally supplied high velocity to that threshold. Chaining cannot supply
  infinite acceleration. Existing dash stock/recharge/air-dash limits remain.
- Quadratic drag opposes velocity; ground friction/catch braking removes energy.
  Retreat/carve catch harder than momentum-carry/hunt. Passive friction cannot
  reverse travel after bringing it to rest.
- Horizontal air dashes retain incoming fall and continuous downward gravity
  **2050 world px/s²**; vertical drag corresponds to a 1650 px/s terminal fall
  without snapping velocity. Existing non-dash stylized jump/fall gravity is
  intentionally unchanged.
- Ground normal support cancels downward motion. A vault leaves support only
  when upward motor force exceeds weight; it does not set vertical velocity.
- Arena contact absorbs inward horizontal momentum as a collision impulse.
  It neither bounces nor keeps applying thrust into the wall. Moving outward
  from an overlapped spawn boundary is not incorrectly treated as an impact.
  `forceX/Y` describe continuous forces; the discrete wall impulse is separate.

**Units are world pixels/seconds and scaled mass/force, not SI metres/Newtons.**
Traction, reaction times and powered dash strength are deliberately tuned arcade
mechanics, not a claim of realistic shoes, human acceleration or a full rigid-body
simulation. Energy/momentum fields are diagnostics, not a new cost against the
HUD ability-energy resource.

The solver uses ≤1/480-second force steps and splits exactly at phase boundaries.
Trapezoidal displacement is consumed exactly once by player integration. Gravity
is not accidentally applied a second time on the dash's final state-transition
frame. No entry/exit speed assignment or vertical halving remains.

### Momentum after dash

Normal control treats velocity above its target as overspeed and dissipates it
exponentially rather than clamping it. Grounded input reversal uses braking;
air control is weaker (650 px/s²) and cannot instantly erase horizontal inertia.
On release, ground friction brings the character to rest through the stop clip.
A dash-carried leap also preserves velocity above the old 560 px/s jump cap.

## Animation follows mechanics

- **Force-phase clock:** monotone C1 retiming maps authored load, push, flight,
  catch and recovery onto motor phases. The launch's authored 52 ms push pose
  is sampled at motor peak thrust, not at an unrelated wall-clock 52 ms.
  Animator crossfades still advance normally, and the final recovery is sampled.
- **Force response:** bounded core pitch, head counterbalance, off-hand tension
  and wall/load compression react to acceleration before anatomical/weapon/foot
  solvers. Bone lengths, blade paths and grip/contact authority are preserved.
- **New `dashPivot` clip:** a distinct brace/drive/recovery silhouette when signed
  incoming momentum opposes intent. Ground dash decisions happen *before*
  walking friction, so 30/60/120 Hz select the same reversal for the same input.
  Existing threat retreats, air/vault cases and other dash families remain.
  There are now ten conditioned variants.
- **Wall reaction:** a grounded impact blends into the stop/catch choreography
  instead of continuing the travelling dash pose in place.
- **New `sprintDrive` cycle:** separate bilateral power-stride poses during
  acceleration and the first 220 ms support/recovery beat. It transitions to
  `sprint` cruise. Both use the same normalized gait phase as foot placement,
  so changing clips does not add steps or merely accelerate one run loop.
- **Presentation:** burst lines/ghost direction use actual velocity. No full-speed
  launch streak is emitted before propulsion, or in the wrong direction while
  reversal is still fighting existing inertia. Dodge invulnerability starts
  with the drive phase, not during the stationary load.

Input recognition now occurs on press events inside `Input`, not by comparing
only the latest timestamp in `Player.update()`. A full tap/release/tap sequence
between rendered frames is retained. This fixes the previously unreliable
implementation rather than simply adding another timestamp check.

## Validation and evidence

- `bun run check`: **59/59 tests**, typecheck, lint and animation/continuity audits.
- `bun run build`: production successful. `git diff --check`: clean.
- Tests include: force/momentum entry, earned reversal, mass/energy diagnostics,
  solver agreement at 30/60/120 Hz, every variant's finite bounded motion,
  gravity/normal support, vault lift, wall absorption, chain work limits,
  passive energy loss, force/pose phase alignment, no velocity cut on exit or
  follow-up leap, and both A/D sprint input paths (including missed-frame taps,
  repeat, opposing keys, pause/blur and release).
- Browser gameplay: **720 updates at 120 Hz**, no JS errors, all poses finite.
  DOM A/D/Shift events verified **350 vs 480 px/s**, `sprintDrive`/`sprint`,
  `dashCarry`/`dashPivot`, continuing airborne fall, and wall contact at vx=0.
  Observed all five force phases: load/drive/coast/catch/wall.
- [Browser report](dash-physics-browser.json) records those observations.
- [Actual gameplay](dash-physics-gameplay.webp): four simulation seconds sampled
  at 60 Hz, shown as an eight-second half-speed review. Chapters: single hold,
  double-tap hold, sprint-fed carry dash, and opposite-direction pivot dash.
  Air/wall checks followed in the same session but are not in that review.
  Offline 120 Hz simulation is not a live device FPS benchmark. The final two
  edge-case fixes (leap overspeed and outward boundary depenetration) were
  regression-tested after capture; they do not change the recorded chapters.
- The final rebuilt production server also passed a fresh real-keyboard browser
  smoke test: normal 350, double-tap sprint 480 with `sprintDrive`, release to rest,
  and zero JavaScript errors.

## Main files

- `physics/dash-body.ts`: force integration/diagnostics/phase mapping.
- `combat/dash.ts`: ten-variant selection, load and catch tuning.
- `entities/player.ts`: once-only integration, contact, handoff and animation.
- `anim/animator.ts`: optional non-looping physics clock, preserving crossfades.
- `anim/clips.ts`: pivot dash and accelerating sprint power stride.
- `core/input.ts`: event-level double-tap/held-direction recognition.
- `tests/dash-physics.test.ts`: physics, input and real player regressions.
