# STICKMAN RISING — Animation System Audit

Audited: skeleton.ts, pose.ts, animator.ts, clips.ts, player.ts (full), enemy.ts (full),
game.ts (loop/timing), camera.ts, renderer.ts, swords.ts, fx.ts (trails/particles).

## HEADLINE ROOT CAUSE (found via live instrumentation, QA round 1-2)

### BUG-0 — player.pose never received the animator's output (CRITICAL — THE reported bug)
- **Observed**: "the character's torso middle point spins during running" — the whole
  body visibly rotates while running; movement feels possessed.
- **Cause**: `player.pose` and `animator.pose` are SEPARATE arrays and NO copy existed
  between `animator.update()` and `solveSkeleton()`. `applyProcedural` accumulated
  `p[2] += speedLean*0.14` into a never-reset array → rootRot grew **12.6 rad/s while
  running** (measured: 46.67 rad after a 2.5s run). My first ground constraint then
  fought the garbage geometry (rootY slammed to -57 → feet 150px off floor).
- **Fix**: `copyPose(this.pose, this.animator.pose)` after the animator update —
  establishing the root-motion policy: **the animator owns the pose baseline;
  procedural layers re-apply on the fresh sample each frame.**
- **Test**: QA C (pose continuity) went from 91 rad deltas → 0 violations.

## CONFIRMED BUGS (prioritized)

### BUG-1 — Ground penetration on landing (CRITICAL, reproduced numerically)
- **Observed**: feet visibly dig into the floor on hard landings.
- **Cause**: hip height = `y - HIP_H(60) + pose.rootY*SCALE`. LAND clip sets `rootY: 7`
  and `applyProcedural` adds `landSpring*6` (≤6) → hip drops ~17px while the deeply
  bent land legs only shorten ~11px → feet sit ~3px *below* ground.
  Root offsets are keyframed with NO ground/foot constraint anywhere.
- **System**: player.ts (hipY getter, applyProcedural), clips.ts (LAND/CHARGE/DASH rootY).
- **Fix**: hard foot-ground constraint after solve — compute max foot-bottom depth in
  local space, clamp `pose[1] <= HIP_H/SCALE - maxFootBottom` when grounded, re-solve.
  Applied to player + grounded enemies. Hip drop then comes from leg bending only
  (correct biomechanics); rootY overshoot is trimmed exactly.
- **Test**: QA foot-penetration check (min toe world height ≥ -0.5px over run/jump/land).

### BUG-2 — Enemy state poses SNAP (no transition layer) (CRITICAL)
- **Observed**: enemies teleport between poses (chase→windup→strike→recover) —
  instant limb rotation, robotic.
- **Cause**: `Enemy.buildPose()` writes absolute channel values per state every frame.
  No damping, no blend between state poses.
- **System**: enemy.ts buildPose.
- **Fix**: two-pose scheme — compute `poseT` (target) per state, then damp the live
  pose toward it per-channel (rate per state: strike fast 26, windup 10, recover 8...).
  Continuous channels (flail/spin) bypass damping.
- **Test**: QA per-channel max delta between consecutive frames < 1.2 rad (non-spin).

### BUG-3 — Generic shared enemy locomotion/attacks (HIGH)
- **Observed**: all 8 enemy kinds share ONE walk cycle (sin(ph)*0.55, same lean/bob)
  and ONE windup/strike/recover pose set; only speed differs.
- **Cause**: no per-kind animation parameters.
- **Fix**: per-kind GAIT table (stride amplitude/rate, crouch, lean, bob, arm
  carriage, weapon stance) + per-weapon-class windup/strike poses
  (machete haymaker / dagger stab / hammer overhead / shield bash / rifle aim+recoil /
  elite diagonal slash / boss sweep), plus gunner recoil timer on fire.
- **Test**: visual via inspection mode; per-kind gait params (assert distinct in QA).

### BUG-4 — 'down'/'getup' poses have dangling legs (HIGH)
- **Observed**: knocked-down enemies: torso rotated flat (rootRot 1.42) but legs still
  hang straight DOWN (leg angles are world-space from vertical, independent of torso
  rotation) → lying body with standing legs.
- **Fix**: lie-flat leg angles (hips ~±1.35, knees folded), getup interpolates to stance.
- **Test**: visual + QA joint-range check (leg angles within [-1.7, 1.7] when down).

### BUG-5 — Foot slide in run cycle (MEDIUM-HIGH, measured)
- **Observed**: feet skate; stride doesn't match ground speed.
- **Cause**: cycle coverage ≈ 304px/s·mult vs body 350px/s·mult → constant 13% slide;
  min speed clamp 0.65 makes it worse at low speed.
- **Fix**: speed multiplier = `vx / 308` (recomputed for new stride), clamped (0.5..1.4).
- **Test**: trajectory view toe-slide readout (planted-foot drift < 8px/s steady run).

### BUG-6 — Torso drawn as straight line while chain is bent (MEDIUM)
- **Observed**: "torso middle behaves like a disconnected pivot during running."
  Solver computes hip→mid→chest 2-segment spine (t1, t2=t1+spine), but renderer draws
  ONE straight hip→chest line; the spine bend channel visually vanishes and armor
  drawn at fixed offsets no longer aligns with the (invisible) bend → parts read as
  pivoting around nothing.
- **Fix**: store `mid` in SkelGeom; renderer draws the real 2-segment torso;
  pauldron attached with rotation (torsoAngle) instead of fixed axis-aligned offsets.
- **Test**: skeleton inspection view (bones/pivots overlay) + visual.

### BUG-7 — Head attachments don't rotate with head angle (MEDIUM)
- **Cause**: visor slit drawn at `headC + fixed offsets` (`cos(headAng)*0` dead code!);
  crest likewise. Tilting head leaves visor floating.
- **Fix**: rotate visor/crest around headC by headAng.
- **Test**: skeleton view at extreme head clip poses.

### BUG-8 — Run cycle not biomechanical (MEDIUM)
- **Cause**: 4 quasi-random poses, no contact/loading/push-off/flight structure,
  no heel-toe, weak counter-rotation; arms under-driven.
- **Fix**: rebuilt RUN_Q with 4-phase gait (contact heel-strike → loading compress →
  push-off extension + toe drive → flight high-knee recovery), full mirror half,
  arm counter-swing, head stabilization, pelvis bob matched to phases.
- **Test**: ghost-frame + slow-mo inspection views.

### BUG-9 — Trail/hitbox sampled one frame late (LOW, accepted)
- **Cause**: updateAttack reads `this.blade` solved at end of previous frame.
- **Mitigation**: swept-quad anti-tunneling already covers motion; windows are long.
  Documented; not worth reordering state/physics pipeline this pass.

### BUG-10 — Instant mirror flip on turn (LOW)
- **Cause**: `ctx.scale(face*SCALE, ...)` flips instantly.
- **Fix**: brief 80ms horizontal squash on face change (anime turn accent).
- **Test**: visual.

## VERIFIED-NOT-BUGS
- Game loop: dt clamped 50ms + 1/90 substeps → frame-rate independent ✓
- Animator: 80ms crossfade from snapshot on clip switch ✓
- Blade angle math (π/2 − (shR+elR+wrR)) consistent across solver/hitbox/trail ✓
- Camera: damp-based, dt-scaled ✓
- Enemy walkPhase: dt-based, speed-linked ✓
- Physics owns root; clips offset joints (rootY now constrained per BUG-1) ✓

## RESOLUTION STATUS (this overhaul)

| Bug | Status |
|-----|--------|
| BUG-0 pose copy missing | **FIXED** — copyPose in player.update |
| BUG-1 ground penetration | **FIXED** — soft ground-offset constraint (`applyGroundConstraint` + per-entity `ground.off`, K=70, tolerance 2.5 local units; QA: deepest foot 0.95px) |
| BUG-2 enemy pose snapping | **FIXED** — target-pose + exponential damping layer (`POSE_RATES` per state) |
| BUG-3 generic enemies | **FIXED** — per-kind `GAIT` table + per-weapon-class stance/windup/strike + gunner recoil |
| BUG-4 dangling legs when down | **FIXED** — lie-flat leg angles (hips ±1.3-1.5) |
| BUG-5 foot slide | **FIXED** — stride-matched gait tempo (`vx/311`) |
| BUG-6 straight-line torso | **FIXED** — renderer draws the true hip→mid→chest chain; pauldron/core attached to the torso frame |
| BUG-7 head attachments | **FIXED** — visor/crest rotate with headAng |
| BUG-8 run cycle | **REBUILT** — 4-phase biomechanical gait |
| BUG-9 1-frame blade lag | documented, accepted |
| BUG-10 instant mirror flip | **FIXED** — 80ms turn squash |
| NEW: blend snap at low fps | **FIXED** — blendDur floored at 50ms |
| NEW: h1 windup straight leg | **FIXED** — loaded stance |

## QA RESULTS (final run, all green)
A. NaN channels: 0 / 463 frames · B. deepest foot 0.95px (floor) ·
C. pose continuity: 0 violations · D. deadlocks: none ·
E. jump apex Δ 30Hz vs 120Hz: 0.95px · F. FX pool: 0 leaks

## INSPECTION TOOLING (new)
- `src/game/debug/inspect.ts` — F9 cycles: Skeleton / Ghost-frames / Slow-mo(0.25x) /
  Trajectory world-space overlays + on-screen label + toe-slide readout.
- `src/game/debug/animQA.ts` — `window.__srQA.run()`: deterministic in-page checks.
