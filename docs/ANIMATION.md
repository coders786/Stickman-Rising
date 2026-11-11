# Animation

How a pose gets from an animator's keyframe to the screen in Stickman Rising, and
why the pipeline looks the way it does.

**The one rule:** *the authored clip is the body.* Anything you type into a
keyframe is what the player sees. Nothing downstream re-times it, re-weights it,
filters it, or re-solves it.

---

## 1. The pipeline

```
clip → sampleClip → crossfade → applyJointLimits → animator.pose
                                                        │
                                              pose.set(animator.pose)
                                                        │
                                              updateDashLift()        (rig translate)
                                              applyTwoHandGrip()      (contact IK)
                                              applyBladeGroundConstraint() (contact)
                                              applyJointLimits()      (ROM gate)
                                                        │
                                              solveFighter3D()  →  projection
                                                        │
                                          updateBladeWorld / updateSwingScale / updateScarf
```

Five pose stages. That is the whole thing. The rendered skeleton is produced by a
single `solveFighter3D` call and **nothing writes to the skeleton afterwards** —
so the body you see, the blade hitbox and the motion trail always describe the
same shape.

### Stage by stage

| Stage | What it may do | What it may **not** do |
| --- | --- | --- |
| `sampleClip` | Pure interpolation of one clip at one time | Hold state, filter, remember anything. Same clip + same time = same pose, always |
| crossfade | Linear blend `from → to` over `blend` seconds | Outlive the clip, chain two blends, feed a rendered pose back in |
| `updateDashLift` | Translate the rig for the power-dash hop | Touch a joint channel |
| `applyTwoHandGrip` | Rotate the off arm onto the authored hilt | Choose a swing, gate on state, own a weight that outlives the pose |
| `applyBladeGroundConstraint` | Rotate the wrist so the kissaki stops at the floor | Move the whole arm, change the carry direction |
| `applyJointLimits` | Reflect an inverted joint, clamp a non-finite value | Clamp an authored value to a stylistic bound |

---

## 2. Authoring a clip

```ts
export const MY_CLIP: Clip = makeClip('myClip', [
  keyframe(0.00, { rootY: 9.39, rootRot: 0.08, hipR: 0.72, kneeR: -0.18 }, 'inQuad'),
  keyframe(0.13, { rootY: 1.80, rootRot: 0.09, hipR: 0.40, kneeR: -0.58 }, 'outQuad'),
], true)
```

- **Channels** live in `src/game/anim/pose.ts` (`CH`). 28 channels: sagittal
  angles, depth/yaw channels, and the blade frame. Omitted channels are `0`.
- **`rootY` is pelvis height above the floor**, in local units, not an offset.
  The rig places the pelvis at exactly `pose[CH.rootY]`.
- **`rootX` is a forward/back weight shift** in local units, not world travel.
- **Eases** are named per keyframe and apply when interpolating *into* that key.
- **`'monotone'`** clips (`clip.interpolation = 'monotone'`) use Fritsch–Carlson
  tangents: local extrema get zero tangent, so a knee or hip cannot overshoot
  between keys. Use it for locomotion and anything with a planted foot.

### Sign conventions (these bite)

- **Elbows and knees are negative.** Flexion is the negative side of zero.
  A *positive* elbow is the joint folding backwards — physically impossible.
- `hip` positive swings the thigh forward; `sh` positive raises the arm.
- `wrR` is continuous and accumulates; the draw family sweeps it past 6 rad.

### Grounding a grounded clip

A grounded clip must put its stance foot on `y = 0`. Because the pelvis sits at
`rootY`, the required value is a *consequence* of the leg pose:

```
neededRootY = (thigh + shin) − max(ankleL.y, ankleR.y, toeL.y, toeR.y)
```

with the leg solve done at `rootY = 0`. If you change a hip, knee or ankle angle,
re-derive `rootY` — otherwise the foot floats or sinks. There is no ground solver
to absorb the error any more, and that is deliberate: a solver would silently
undo your keyframe.

Current measured worst-case ground error across all 40 clips is **4.2 px**
(`dashPierce`), with most grounded clips inside 2.7 px. Live at speed: walk
floats 0.6 px, run 2.4 px.

### Airborne clips

Airborne clips are allowed to leave the floor and should: `jump`, `jumpLeap`,
`airJump`, `fall` and the dash family carry real clearance (up to 12 px). What
they must not do is *intersect* it. A run cycle that is grounded for its whole
duration may float a little during the swing phase; a sprint deliberately has an
aerial interval, so `sprint` clears roughly 4–8 px at its flight frames.

---

## 3. The constraint layer

`applyJointLimits` (`src/game/anim/limits.ts`) is the only gate the pose passes
through, and it has exactly one job: **physical impossibility**.

- elbow / knee: sign-locked to the flexion side, 155° max
- shoulder: 178° flexion, 69° extension
- hip: 140° thigh-up, 69° behind
- spine: total trunk pitch −35°…+93°
- any non-finite channel is replaced with a neutral value

Those bounds are set *outside* the authored envelope of all 40 clips — measured,
not guessed. **The gate is a no-op on every authored keyframe** (verified: 0 of
260 keyframes touched). If it ever starts moving an authored value, the clip is
the thing to fix, not the bound.

Earlier revisions carried stylistic bounds here (`rootRot ≤ 1.10`, elbow
`≤ −0.26`, "never lock an elbow", and a `wholeBodyPitch` parameter that changed
per state). Those were written for procedural layers that could add arbitrary
amounts to a pose every frame. The layers are gone, so the bounds only ever fired
on the clips — `POWER_DASH_CLIP` authors a 1.30 lean and was being silently
flattened to 1.10.

---

## 4. Contact layers

Two things survive from the procedural era, both strictly *contact*:

**Two-handed grip** (`applyTwoHandGrip`) engages from the authored geometry:
engagement is `clamp01((17 − dist(handL, pommel)) / 7)`. If the clip puts the off
hand near the hilt, the off hand is IK'd onto it. It never picks a swing path and
never owns state.

**Blade-ground constraint** (`applyBladeGroundConstraint`) only fires when the
kissaki would pass through the floor. It rotates the wrist by exactly the deficit,
preserving the carry direction, and is exempt during attacks. Measured live: a
drawn run keeps its tip at +2.0 px, a drawn dash at +3.0 px, and attack tips stay
clear by 25–78 px.

---

## 5. What was removed, and why

The original pipeline had 23 writers between the clip and the screen. Each was
added to fix a symptom of the one before it. In order: the authored pose was
sampled, then the equipment rewrite replaced both arms, then gait/foot IK took
the legs, then sword-trajectory IK took the sword arm, then universal joint
limits and anatomical smoothing suppressed the extremes all of them produced,
then ground IK ran after 3D projection so the feet no longer agreed with the
pelvis, then PAVE noise and a 10 Hz sprint exposure hold were layered on top, and
finally the editor and QA sampled a different path than the runtime.

The removal was wholesale, not additive — no re-ordering, no opt-in toggle:

| Removed | Why it could never agree with the clip |
| --- | --- |
| `equipment-motion` | Rewrote authored arm channels for the sword carry |
| `legik` (gait + foot IK) | Owned the legs; fought every planted foot |
| ground IK (post-projection) | Moved feet after the solver that placed the pelvis |
| `armarc` + sword trajectory IK | Replaced the authored blade path |
| `motion-constraints` (anatomical smoothing) | Suppressed authored extremes |
| `pave` | Per-frame noise added to solved channels |
| `sprint-exposure` | 10 Hz hold, so playback ≠ clip timing |
| `context-motion` | Per-state additive offsets on top of the pose |
| `grounded-dash` | Rewrote the dash body during the dash |
| `inertial-transition` | Ran for up to 280 ms *after* a clip change, so the visible body could be a synthesis of three clips |
| deferred transitions / prepared-layer re-basing | Let later writers replace the sampled target before the blend resolved |
| `captureDisplayPose` / `adoptDisplayPose` | Fed the rendered pose back into the next blend, breaking determinism |
| draw-contact Jacobian | Post-projection writes so the fist chased a socket |
| `animationVariation` label | Write-only; the landing/skid physics it described is kept |

The blade is no longer given a separate arc: the clip *is* the blade path, and
`Traj3D` / `grip` / `zArc` were deleted from every attack definition with it.

### Same-frame sizing without a solver

Removing the solvers exposed authoring work that had been hidden. Two examples:

- The run cycle authored a stance that put the foot **9–11 px** clear of the
  floor; the deleted foot IK had been absorbing it. Authoring the pelvis height
  per keyframe takes live float from 11.9 px → 2.4 px.
- The walk had the same problem worse: `rootY` there was a *bob offset* fed to
  the planner, so as pelvis height it left both feet clear of the ground for
  **31% of the cycle** — a walk that floats. Re-deriving `rootY` from each
  key's own leg pose puts the whole cycle inside 0.42 px of the floor.
- Empty-hand attacks inherited their sword twin's hit padding (`pad: 12` on a
  2.25 px-wide fist) and its 150 px AoE. `pad`, `aoe`, `drawFlash` and
  `slamImpact` are now weapon concepts and are stripped from unarmed variants by
  `ronin.ts`.

---

## 6. Verifying a change

```bash
npx tsc --noEmit                 # 5 pre-existing errors: scripts/match-darklord.ts (3),
                                 # src/lib/db.ts (prisma client), tests/hud-layout.test.ts
npx tsx --test tests/*.test.ts   # 123/124 pass; tests/scores.test.ts is a known baseline failure
```

Tests that pin this contract:

| Test | Contract |
| --- | --- |
| `player-animation` | clips loop seamlessly, every sampled joint is finite and unclamped, walk has double support |
| `athlete-walk` | running/dash hand motion comes from the authored clips |
| `dual-stance` | one clip library serves both stances; unarmed pads/AoE never inherit weapon values |
| `dash-combat` | power dash clip, lean, recovery and stamina accounting |
| `dash-arm-joints` | arms stay proportionate and the foot/tip stay above the floor at 30/60/120 Hz |
| `silhouette-motion` | landing severity and stop latch are driven by physics, identically at 30/60/120 Hz |
| `jump-draw-transitions` | a settled pose equals the clip sample exactly — zero residue |
| `draw-detail` | the rendered hilt sits on the drawn fist; no stale foot anchors |
| `ronin-art` | the idle stance is authored wide; the ROM gate leaves it alone |
| `movement-rhythm` | one step per foot per cycle, walk never leaves the ground, dash load/burst/catch envelope, every dash clip plays to its authored end |

Frame-rate independence is tested at 30, 60 and 120 Hz throughout, because that
is where per-frame solvers used to diverge.

---

## 7. Adding a layer (read this first)

Don't. If you are about to add a per-frame pose writer between `pose.set` and
`solveFighter3D`, the answer is almost always to fix the clip, because:

1. Any writer after the sample makes the clip non-deterministic, and the editor
   and QA then see a different body than the game.
2. Two writers in the same channels produce a last-writer-wins ordering problem
   that gets resolved by adding a third writer.
3. A solver can only ever *hide* an authoring error. It cannot make the clip
   correct, and it will fight the next clip that is authored correctly.

The two exemptions are `updateDashLift` (a rig translate, not a joint) and the
two contact layers (grip and blade-floor), both of which are functions of the
authored pose and cannot invent motion.
