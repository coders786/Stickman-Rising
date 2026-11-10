# Grounded low dash / smooth force-timed sequence

## Angle convention

150 degrees is interpreted as the open angle between the hip→chest vector and
the hip→rear-ankle vector, not 150 degrees of upside-down torso rotation. The
new core drive pitch is 60 degrees from upright (30 above the floor). Actual
settled-player samples measure ~151.75 degrees at 100ms and ~152.33 at 125ms
for the open body/rear-leg angle. The rear leg recovers later, so that opening
is intentionally not held at exactly 150 throughout the whole animation.

## Acting sequence

`anim/grounded-dash.ts` composes plant → compression → push → low drive → catch
→ rise using the dash motor's load and propulsion durations. It is not driven
by render-frame counts. Quintic interpolation supplies flat endpoint derivatives
between acting beats. A separate quintic envelope starts and ends the layer
without directly replacing the incoming/outgoing pose with a new pose.

The layer runs after generic smoothing/inertial entry so the authored low drive
actually arrives during propulsion. Existing motion-aware transition capture
still owns animation handoffs; core and limbs retain the selected dash variant.
Lumbar flex is held at .035 radians: the lean is in the core, not a waist fold.
Knees/hips absorb and recover; existing arm gather/stream/catch and sword grip
remain. Head counter-pitch respects the existing neck limit, rather than forcing
an anatomically impossible level head at every deep angle.

Applies to forward-facing grounded dashes, including the forward surrounded
breakaway. Upward/airborne and facing-away guarded retreat dashes remain distinct;
this does not force an aerial dodge or backward guard onto the floor. Dash speed,
motor pulse, duration, cooldown and invulnerability were not increased.

## Grounding, not only a `grounded=true` flag

The first actual frame audit exposed a short double-foot hover at peak lean.
The support solve now bounds pelvis height by leg reach and selects a support
foot that must reach the roof. Its horizontal target is bounded to the reachable
annulus before leg IK, rather than allowing an unreachable ankle target to float
above the floor. The other leg may recover. The resulting action is a stylized
ground-skimming dash, not a physically literal no-slip planted foot for the entire
high-speed translation.

The sheathed saya angle is capped during grounded dashes so the deeper core lean
does not drive the scabbard tip through the roof. It follows the same angle in
both sheath and visible resting-hilt passes.

## Validation and artifacts

- `bun run check`: **111 tests pass**, typecheck/lint/animation audits pass.
- `bun run build`: successful. `git diff --check`: clean.
- New tests cover force-phase sequencing and peak pitch across launch/carry/
  hunt/chain/pierce/carve configurations; zero-weight endpoints; actual 30/60/120Hz
  Player updates in both equipment modes; finite pose values, ground state,
  bounded pitch steps and absence of double-foot hover/floor penetration.
- `grounded-low-dash.png`: 12 actual Player update/render samples, including
  preparation, ~100–150ms drive, catch and recovery; no AI reference artwork.
- `grounded-low-dash-poses.json`: sampled pitch, open angle and foot heights.
- Regenerate: `node --import tsx scripts/render-grounded-dash.ts`.
- `grounded-low-dash-browser.json`: production-browser capture, 300 updates at
  120Hz, 150 frames at 60Hz, both equipment modes reach ~60 degrees, support
  contact retained, all poses finite and no JS errors.
- `grounded-low-dash-gameplay.webp`: real-speed sheathed dash, recovery/Q draw,
  drawn dash and recovery. Offline close-camera animation review, not a device
  FPS benchmark. Persistent storm, new patrol walk and draw detail remain in use.

This is a deliberate stylized pose/contact improvement, not a new full-body
rigid-body balance or collision simulation.
