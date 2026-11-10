# Humanoid surface and constraint-based motion

> Historical base-body specification. The current anime design and visual iterations
> are documented in [SHADOW_RONIN.md](SHADOW_RONIN.md). The constraint pipeline below
> remains active; current proportions use a 32-unit torso and 6.1-unit skull radius.

## Actual replacement, not a costume skin

`humanoid.ts` replaces the former 600-line capsule/joint-cap renderer. The old
Warden renderer is deleted. The player no longer draws stick strokes, limb end
circles, hinge discs, shoulder rings, visor, mask, scarf, bracers or shin armor.
Enemy rendering remains separate and unchanged.

The new 2D surface follows the existing projected 3D skeleton:

- A continuous closed contour spans each entire arm or leg. Anatomical width
  profiles define deltoid, biceps, elbow, forearm, wrist, quadriceps, patella,
  calf and Achilles transitions; quadratic contours join the regions smoothly.
- A shaped ribcage narrows into an abdomen and pelvis; shirt folds and a simple
  belt follow the torso frame rather than the screen.
- A human profile includes brow, nose, lips, chin, ear and short hair. A visible
  neck connects into the collar and jaw. Hands have palm/thumb/knuckle shapes;
  feet are shaped boots rather than circular caps.
- Subtle material gradients replace bright mannequin outlines. Far limbs render
  behind the body. Combat flashes and blade-cast edge light remain supported.

This is a stylized anatomically informed **2D humanoid**, not a photorealistic
mesh, mocap system or physics ragdoll. The internal skeleton is retained because
animation, inverse kinematics and sword hitboxes need joint transforms.

## Motion pipeline

1. Walk/run/sprint clips use time-aware monotone cubic Hermite interpolation.
   Harmonic tangents are shared at keys and wrapped at the loop seam. Velocity
   stays continuous without overshooting the authored joint ranges.
2. Walk/run/sprint transitions preserve normalized stride phase. Cadence derives
   from the actual clip duration rather than a hard-coded timing constant.
3. Procedural intent passes through critically damped anatomical pose tracking
   during locomotion. Joint velocities are bounded; long-frame discontinuities
   safely reset the tracker. Attack timing and weapon targets remain authoritative.
4. Hand-space gait authoring gives the free arm a genuine front/back swing.
   A 3D anatomical elbow pole re-solves the upper/forearm around the fixed hand
   target, preserving grip position and bone lengths rather than reversing the
   elbow bend. Weapon/grip IK and the final joint-constraint pass run afterward. Head,
   shoulders, elbows, hips, knees and depth rotation have bounded ranges;
   non-finite channels recover neutral values. Wrist turns remain unwrapped so
   deliberate sword rotations still work.
5. The ground planner supplies foot targets. **Targets** blend during gait
   changes, then analytic IK resolves the fixed-length bones. The old method
   blended knee/ankle positions independently, shortening the leg during blends.
6. Leg IK clamps knee flexion to 0.17–2.71 radians (approximately 10–155 degrees),
   handles coincident/unreachable targets, and keeps each local planar bone at
   its configured length. This is an analytic constraint solver, not simulation.

Authored sheet timing: walk 0.96 s / ten exposures; sprint 0.56 s / twelve
exposures. Gameplay adjusts cadence and applies contact constraints, so the
reference sheet is explicitly labeled **before ground IK**.

## Verification

```sh
bun run check
bun run art:player
bun run build
```

Tests cover exact bone lengths at reachable/extreme targets, coincident targets,
knee bend limits, keyframe/loop velocity continuity, phase-preserving transitions,
30 Hz versus 120 Hz pose convergence, non-finite recovery, renderer state safety,
both facings, combat flashes, persistence and the scores API.

Outputs: `humanoid-model.png`, `humanoid-animation-sheet.png`; runtime captures
are saved separately as `humanoid-live-walk.png` and `humanoid-live-sprint.png`.
