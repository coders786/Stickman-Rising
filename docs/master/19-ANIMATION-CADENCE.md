# 19 — MOVEMENT & ANIMATION AT 120 fps (Phase 6d)
**Serves:** D9 (cadence beats rate) · FID-32…36 · the user's question: *how do the
movements and animations themselves reach 120 fps and look smooth on mobile?*

The short version, which is the whole design:

> **Animation is a function of time — sample it at render time and it is 120 fps for
> free. Physics is state — you can only render it at 120 by interpolating (costs one
> frame of latency) or by simulating faster (breaks determinism and the tests).
> So: sample the time-driven systems, interpolate the state-driven ones, and spend
> the latency you bought on purpose.**

---

## 0.5 What the existing code already gives us (checked, not assumed)

Inspected while writing this document — these change the cost of the plan:

| Finding | Where | Consequence |
|---|---|---|
| **Animation is already time-parametric**: `sampleClip(clip, t, out)` is a pure function of `t` | `anim/animator.ts:64` | §3.1 applies directly. No animation rewrite needed. |
| **The animator's clock is already externally drivable**: `update(dt, loopPhase?, physicsTime?)` — looping clips take `loopPhase`, non-looping clips take an authored `physicsTime` | `anim/animator.ts:208-232` | `T6.11` is plumbing, not surgery: pass a *render-time* clock instead of the sim clock. |
| **A deliberate "on twos" mode exists** (`stepRate`, 24 = on twos) with a comment that physics layers keep integrating at full rate | `anim/animator.ts:131-139` | Authored hold is a *style*, not a bug — FID-37 must exempt clips with `stepRate > 0` explicitly. |
| **The player rig issues 20 separate `stroke()` calls**, enemy 10, projectiles 4 → ~**50+ strokes/frame** with a typical group | `entities/player.ts`, `enemy.ts`, `projectiles.ts` (counted) | At 120 fps this is the single largest added raster cost, and it is batchable (§6). |
| **Alpha is embedded in per-frame template strings**, e.g. ``ctx.strokeStyle=`rgba(192,205,211,${(.09-i*.022)*life})` `` — 24 `rgba(` sites and 14 interpolations in `player.ts` alone | `entities/player.ts:4894,4903,4909,4914,4920,4925,4935` | **Allocates strings in the draw path** (violates REQ-704), forces style re-parsing, and per-stroke alpha is the expensive path. Doubling the frame rate doubles the garbage. |

So the plan is not "rewrite the animator for 120". It is: pass a render clock
(already supported), batch the rig, and stop allocating style strings per stroke.

---

## 1. Three clocks, and what each one may do

| Clock | Rate | Who owns it | How it reaches 120 | Cost |
|---|---|---|---|---|
| **Sim** | fixed 1/60 s | gameplay: positions, velocities, hitboxes, timers | never — stays 60 | 0 |
| **Anim** | continuous | clips, eases, camera, parallax, drift, HUD pulses | **sampled at render time** | ~0 (pure functions) |
| **FX** | analytic | particles, trails, smear, sparks | evaluated at render time | 0 allocations |

The rule that follows: **anything expressible as `f(t)` must be evaluated at the
render timestamp, never stepped at 60 and then reused.**

`requestAnimationFrame` hands us that timestamp. A stickman's limb angles are
`clip(t)`; the camera is `ease(t)`; a cloud is `x0 + wind·t`. None of these need a
simulation tick to look smooth — they need the *right time*.

---

## 2. The 60 Hz problem, stated exactly

With a fixed 60 Hz simulation on an 8.3 ms display, rendered frames land between
simulation states: "two or three rendered frames in a row can show the same tick,
then the picture jumps" — the classic stutter that interpolation exists to fix
(Gaffer's *Fix Your Timestep*: `alpha = accumulator / dt`,
`render(lerp(prev, cur, alpha))`).

**But interpolation is not free of consequence:** it "adds exactly one frame of
latency… because you are always rendering a blend of the past and the present"
(same source). At 60 Hz that is 16.7 ms; at 120 Hz, 8.3 ms.

So there is a real trade, and we refuse to pay it silently:

| Approach | Smoothness | Latency cost | Determinism | Verdict |
|---|---|---|---|---|
| Sim at render rate (variable dt) | perfect | 0 | **broken** (244 tests depend on fixed steps) | **rejected** |
| Fixed 60 sim, no interpolation | judder at 120 | 0 | intact | acceptable on 60 displays |
| Fixed 60 sim + interpolation | perfect | **+1 frame** | intact | **default** |
| Fixed 60 sim + extrapolation (predict) | perfect | −1 frame (predicts) | intact | only for the player's own input echo, with clamping |
| Fixed 120 sim | perfect | 0 | needs re-baselining all 244 tests | M7 candidate for C3 class |

**D10 (recorded):** sim stays fixed at 60; render interpolates state-driven values;
time-driven values are sampled at render time; extrapolation is allowed only for
input feedback (never for enemies or hazards, where overshoot lies to the player).

---

## 3. Pose sampling vs pose interpolation (the animation core)

There are two kinds of animation data in this repo and they need different handling.

### 3.1 Clip animation — sample, don't interpolate
If a clip is a keyframe track evaluated as `pose = clip(t)`, then the *only* thing
needed for 120 fps is to pass the render-time `t`:

```ts
// per frame
const tRender = animStart + (accumulator + (now - frameStartMs)) / 1000
sampleClip(clip, tRender)          // 120 fps limbs, zero simulation cost
```
This is why animation is the *cheapest* thing to make smooth: it is idempotent,
stateless, and unaffected by the physics step.

### 3.2 State-driven motion — interpolate, then derive
Feet, root, hitboxes and anything the physics owns must be blended between the two
step states. Two pitfalls, both real:

1. **Lerping joint *positions* shortens limbs.** A straight line between two
   rotated configurations is a chord, not an arc: a 90° knee bend at 2 % per frame
   is invisible, but a fast 60° swing visibly shortens the limb. For a stickman,
   limb length *is* the silhouette. **Interpolate angles, then re-derive joint
   positions with forward kinematics.**
2. **Foot slide.** If the pose is sampled at `tRender` while the root is
   interpolated at `alpha`, the two disagree by up to one step (≈6.7 px at
   400 px/s). Fix: offset the animation clock by the *same* fraction used for the
   root — `tAnim = tStepStart + (alpha − 1) · dt` — so pose and position advance
   together; where the clip carries root motion, drive position from the clip and
   skip position interpolation for that entity.

### 3.3 Blend weight clamping
Cross-fades between clips must be sampled in render time too, otherwise a 0.15 s
cross-fade at 60 sim steps visibly "pops" mid-blend at 120. Same rule: weights are
`f(t)`.

---

## 4. The latency ledger (why "smooth" can feel worse)

Every smoothing layer buys smoothness with delay. Ours, itemised:

| Source | Added latency | Notes |
|---|---|---|
| render interpolation | **+8.3–16.7 ms** | unavoidable, and worth it (§2) |
| input snapshot read once per step | up to 16.7 ms | required for determinism |
| camera smoothing (lerp/spring) | 0–100 ms depending on constants | the usual culprit |
| pose blend | 0 | sample-time, not delayed |
| `pointerrawupdate` off (coalesced only) | ≤1 frame | saves main-thread cost |

**Budget: total added latency ≤ 16.7 ms beyond raw input.** Enforced by a small
instrumented counter (input timestamp → first frame the effect is visible) and by
these rules:

* **Never smooth both the camera and the player.** Double-smoothing produces the
  "mushy" feel people describe as laggy even at high fps. Pick one: smooth the
  camera, and let the player be exact.
* Camera smoothing is **render-time sampled** (a critically damped spring on
  `t`, not per step) so it cannot compound with the interpolation delay.
* Snap the camera at run start and on teleports — never ease into a new run.

---

## 5. What actually makes motion read as "premium" at any frame rate

Frame rate removes *quantisation*; it does not create *quality*. The craft layer,
in order of perceptual effect (all zero-cost changes to data):

1. **Easing, not linearity.** A 6-frame key with a proper ease reads smoother than a
   12-frame linear ramp. Linear motion at 120 fps still looks mechanical.
2. **Anticipation → action → settle.** A stickman that leans 2 frames before a
   punch, and decelerates after, reads as weight at 60 fps. Without it, 120 looks
   like a stick sliding.
3. **Jerk continuity.** Smoothness is a property of the *third* derivative. A
   constant-velocity limb with one abrupt stop has infinite jerk at the stop, and
   the eye catches exactly that. We can measure it: `M-JERK` = max |Δ³θ| per joint
   per frame; a spike is a pose-graph bug, not an fps bug.
4. **Sub-pixel motion.** Anything moving slower than 1 device px per frame must
   still advance: at dpr 1.5, one device px = 0.67 CSS px, which is why capping dpr
   at 1.5 (`12` §3) also *helps* slow motion look smoother than dpr 1.0 would.
   This is FID-33 from the other direction.
5. **Overlap & follow-through.** Head/torso lagging the punch by 1–2 frames.
6. **No accidental "animating on twos".** If a value updates only on sim ticks, at
   120 fps every other frame is a duplicate — the classic 30 fps-inside-60 tell.
   `M-DUP` counts consecutive identical render states; target 0 while the entity moves.

---

## 6. The Canvas2D cost of doubling the frame rate

Rendering a vector stickman 120 times per second costs roughly twice the path
rasterisation. The Canvas2D cost hierarchy, worst to best:

| Operation | Relative cost | Rule for us |
|---|---|---|
| `getImageData`/`putImageData` | stalls the pipeline | never in a frame |
| `fillText`/`strokeText` | most expensive single call; font rasterisation | cache to an offscreen plate (already done for HUD) |
| `arc`/`bezierCurveTo` | curve tessellation per segment | use for silhouettes, not for rigs |
| many separate `stroke()` calls | per-call path build + raster | batch same-style limbs into **one** path + one `stroke()` |
| `fill` of a simple path | moderate | fine |
| `fillRect` | cheap | fine |
| `drawImage` of a cached plate | cheapest (GPU texture copy) | the plate architecture (`13`) |

Practical rules for the rig at 120:
* **One path, one stroke per style.** Collect all limb segments of the same
  width/colour, `moveTo/lineTo` into a single path, stroke once. A 14-limb
  stickman becomes 2–3 stroke calls instead of 14.
* **No per-limb alpha.** Setting `globalAlpha` per limb forces extra work and, in
  some renderers, a canvas-wide layer. Fade whole limbs via colour, not alpha.
* **No `shadowBlur`, no `filter`** in the rig.
* **Precompute joint positions once per frame** (FK from angles), never `sin/cos`
  twice for the same angle.
* **Reuse the path object.** `Path2D` is immutable, so keep one per style and
  rebuild its geometry with cheap `moveTo/lineTo` into the same context path; do not
  allocate per frame (REQ-704).
* At 120 the whole rig budget is **≤1.2 ms** on C1 (`[E]`, to be confirmed by
  `M-RIG`).

---

## 7. Input must be as fast as the display, or the animation looks late

Coalescing is the whole story: browsers merge pointer samples into one event per
dispatch, and "a 120 Hz digitizer produces roughly twice as many samples as a 60 Hz
render tick delivers" — `getCoalescedEvents()` returns the ones the browser batched
away. Also available: `pointerrawupdate` (unthrottled, not frame-aligned) and
`getPredictedEvents()` (shaves perceived latency by predicting where the pointer
will be).

Policy:
```
pointerdown/move/up   → write into a fixed input snapshot (no game state mutation)
per sim step          → read the snapshot once (deterministic, testable)
per render frame      → consume getCoalescedEvents() for gesture/trail sampling
pointerrawupdate      → off by default; enable only if a device proves coalescing
                        is insufficient, because it "costs main-thread work on
                        exactly the low-end devices that can least afford it"
```
This is also why the input layer is *not* part of D2's "no touch playability" —
reading input fast is a responsiveness concern, not a control scheme.

---

## 8. Which tiers can actually afford 120 rendering

From the cost model (`17` §3), at an 8.3 ms budget:

| Class | 120 render plausible? | Condition |
|---|---|---|
| C0 | **no** | `T_cpu` alone is 6–11 ms |
| C1 | marginal | `atmoScale` 0.5 + `low` art only; auto-drop expected |
| C2 | yes | `medium` art at 0.8–1.0 `atmoScale` |
| C3 | yes | any tier |

Note the honest consequence: **on the phones most players own, this project ships
60 with perfect cadence**, and the animation quality comes from §3/§5, not from the
number. 120 is a bonus on C2/C3 and wherever the platform unlocks it (`18` §1).

---

## 9. Acceptance criteria (added to `04`)

| ID | Target |
|---|---|
| FID-37 | When display rate > sim rate, `M-DUP` = **0** duplicated render states while any entity is moving (pose sampled at render time) |
| FID-38 | Added latency budget: input→visible **≤16.7 ms** beyond the raw input sample |
| FID-39 | `M-JERK`: no joint exceeds **2× the clip's median** |Δ³θ| in a frame |
| FID-40 | Foot slide ≤ **2 px** at any speed (pose clock and root advanced by the same alpha) |
| FID-41 | Rig cost ≤ **1.2 ms** at 120 on C1 (`M-RIG`), ≤2 stroke calls per limb style |

---

## 10. Roadmap impact (M6)

| Task | What | Est |
|---|---|---|
| `T6.11` | Render-time clock: `tRender`, `alpha`, expose `anim.time` to clips; sample instead of step | 90 LOC |
| `T6.12` | Angle-space pose interpolation + FK re-derivation; clamp cross-fade weights to render time | 120 LOC |
| `T6.13` | Rig batching + **zero-allocation styles**: one path per style; replace per-frame `rgba(...)` template strings with a quantised (16-step) cached colour table; no per-limb alpha; no font/shadow work in the rig. 20 strokes → ≤4 | 140 LOC |
| `T6.14` | Metrics `M-DUP`, `M-JERK`, `M-RIG`, `M-LATENCY` in `?bench=1` | 90 LOC |
| `T6.15` | Camera spring at render time + "never smooth camera and player together" audit | 60 LOC |

All five are draw-path or measurement work: **no gameplay file is edited**, so the
244-test guarantee (Rule 10) is untouched.

---

## 11. Rejected approaches

| Approach | Why rejected |
|---|---|
| Simulate at 120 always | doubles CPU, invalidates 244 determinism tests, and the animation gains come free from §3 |
| Extrapolate world state | overshoot lies to the player about hazard positions; interpolation's 8.3 ms is cheaper than a wrong hitbox |
| Interpolate joint positions | shortens limbs, destroys the stickman silhouette (§3.2) |
| Duplicate frames to claim 120 | identical on sample-and-hold (`18` §2) |
| "Animate on twos" for style while advertising 120 | the honest version is a 30 fps art style at 30 fps; we are not doing that |
| Smooth the camera *and* the player | double smoothing is the most common cause of "smooth but laggy" |
| `pointerrawupdate` everywhere | main-thread cost on the weakest devices, for sub-frame input we do not consume |

## 12. Open items

1. **`M-JERK` needs a baseline.** We do not yet know the clip library's median jerk;
   the threshold (2×) is a placeholder until `T6.14` measures it.
2. **Fixed 120 sim for C3** is attractive on desktop (removes interpolation latency
   entirely) but re-baselines every combat test. Deferred to M7 with a full test
   review, never sneaked in.
3. ~~Pose sampling assumes clips are time-parametric.~~ **Verified** (§0.5):
   `sampleClip(clip, t, out)` is pure in `t` and the animator's clock is externally
   drivable. The remaining unknown is only *which* callers pass `physicsTime`, and
   whether passing a render clock there changes any of the 244 tests — checked in
   `T6.11`, not assumed.
4. **Coalesced-input determinism:** reading coalesced events at render time while
   the sim reads the snapshot can desync visual trails from hitboxes by one frame.
   Trails must be visual-only; this is asserted in `env.controller.test.ts`.
