# DECISIONS LOG — MASTER PROJECT
Every settled decision lands here. Reversal requires **new evidence**, not a new
preference (mandate Rule 2). Dates are session dates; baseline `5b874fc`.

---

## D1 · S1 — Level identity = **per-run environment profiles, one stage**
**Decided:** 2026-11-15 · **By:** user
> "Profiles only but achieve a full fidelity graphics that make me WoW. Put as
> much human psychology as you can."

**Consequences**
* REQ-106 (real stages) is **dropped** from scope; `LevelId` stays single-valued.
* REQ-101…REQ-105 (profile object, per-run selection, profile-driven identity,
  weather weights) become the **critical path** — everything else reads the profile.
* "Full fidelity" is now a *requirement*, not a vibe: it must be defined as
  measurable targets (`04-FIDELITY-TARGETS.md`) and validated numerically, because
  this environment cannot take screenshots (discovery C8).
* Human-psychology weighting is a **design constraint with evidence grading**
  (`03-PSYCHOLOGY-ART-DIRECTION.md`), not decoration. Claims must be marked
  [R] research / [I] inference / [A] assumption — the mandate forbids fabricated
  player feedback and this project has collected none.
* Because there is only one stage, distinctiveness must come from **profile
  variation**: palette × weather × moon phase × cloud mix × grade. Target: any two
  consecutive runs should differ in ≥4 of those 5 axes.

---

## D2 · S2 — Mobile = **performance-first, not touch-playable**
**Decided:** 2026-11-15 · **By:** user (selected "Performance-only mobile")

**Consequences**
* REQ-606 (touch controls, mobile layout, safe areas) is **out of scope**.
* Mobile-first means: budgets, tier ladder, DPR governor, overdraw control,
  thermal-aware degradation, and **identity preservation at every tier** (GC-2/3).
* The game remains a desktop keyboard experience; the mobile target is "a phone
  in landscape running the web build at a stable frame rate", not a mobile product.
* Honest limitation to restate in the final delivery: *the game is not playable on
  a touch-only device.* Do not market mobile support as playability.

---

## D3 · S3 — "Use a new and distinct technology" → **Canvas2D-only is REVOKED**
**Decided:** 2026-11-15 · **By:** user
> "usse a new and distinct technology."

This supersedes the standing "no shaders / no WebGL / no render targets" constraint
that governed V3 and V4 planning. That constraint is now **historical**, not
binding. What replaces it is a *technology selection decision*:

| Candidate | Verdict |
|---|---|
| A. Stay Canvas2D, more baked plates | **Rejected as the answer to D3** — it is the current technology, and the user asked for a new one. Retained as the **fallback path**. |
| B. **Hybrid: Canvas2D game + GPU atmosphere layer (WebGL2, WebGPU optional)** | **SELECTED** (`02-TECH-SELECTION.md` §5) |
| C. Full WebGL2 rewrite of the renderer | Rejected — 32.8k LOC of canvas drawing incl. a 5.3k-line procedural fighter; rewrite risk dwarfs visual gain |
| D. WebGPU-first, WebGL2 fallback | Deferred — WebGPU reaches ~86 % of sessions (Safari 26+ only; Firefox partial) so it cannot be primary on a mobile-first budget; used as an **ultra-only upgrade path** |
| E. OffscreenCanvas + worker rendering | Adopted as a **supporting** technique, not the headline |

**What "new and distinct" concretely means**
1. A **second, GPU-rendered atmosphere canvas** (WebGL2) that procedurally generates
   sky gradients, three cloud systems (fBM/domain-warp cumulus, layered stratus,
   stretched cirrus), and volumetric-feel fog **per frame, in shaders** — replacing
   the baked sky plates at `medium`+ quality.
2. **Hard isolation**: the GPU layer never samples the game canvas and the game
   canvas never samples the GPU layer. Compositing is done by the browser
   (stacked canvases). This deliberately avoids the framebuffer-readback trap
   measured/documented in `LIGHTING-RESEARCH-V4.md` R1.
3. Feature detection with **the existing Canvas2D sky retained as a first-class
   fallback** — not a degraded afterthought.
4. The game renderer, combat, physics and animation are **untouched**.

**Consequences to carry into architecture**
* New module tree `src/gpu/` (context, programs, geometry, uniforms, timer) with a
  strict no-import boundary from `src/game/` (REQ-805 amended).
* New budget line: GPU frame time for the atmosphere pass, separate from the
  Canvas2D blit budget (which still applies to the game canvas).
* Shader compilation must be **prewarmed at boot** (mandate Phase 20) — a
  first-frame compile hitch is a gate failure.
* Mobile battery/thermal: the GPU layer is the first thing the governor degrades
  (tier `low` → Canvas2D fallback sky), which is exactly the "cheap to shed" property
  we want on a mobile-first product.

---

## D4 · S4 — The 8 failing tests will be **fixed** (Milestone 0.5)
**Decided:** 2026-11-15 · **By:** user (selected "Fix them")

Triage (executed):

| # | Test | File | Failure |
|---|---|---|---|
| 8 | blade cleaves a tight pack, every strike | `blade-cleave.test.ts` | `axeKick at 26px only cut 3/5 (29 29 29 0 0); expected ≥4` |
| 9 | cleave independent of pack tightness | `blade-cleave.test.ts` | same family |
| 11 | cut depth independent of frame rate | `blade-cleave.test.ts` | same family |
| 81 | every core strike thrown by the whole body | `full-body.test.ts` | body-engagement assertion |
| 84 | each strike holds an extreme at contact | `full-body.test.ts` | pose-extreme assertion |
| 86 | no joint welded shut in any core strike | `full-body.test.ts` | joint-range assertion |
| 195 | six extra authored keys preserve timing | `ritual-idle.test.ts` | keyframe/timing assertion |
| 242 | connecting strike puts joint ON the body | `unarmed-step.test.ts` | contact-precision assertion |

All eight are **combat/animation design assertions**, not rendering. Their files and
the implementation (`attacks.ts`, `clips.ts`) share one history commit (`c857433`),
so these are **not stale tests** — they encode design intent that the implementation
currently violates (e.g. "A drawn blade must not stop on the first body").

**Rules for fixing them (protects Rule 10):**
* Fix **behaviour**, not assertions, unless an assertion is provably wrong against
  the design doc — in which case the change is documented here first.
* Each fix is a separate commit with the failing assertion quoted.
* `npm test` must reach **244/244** before Milestone 1 lands; the "no regression"
  claim in later phases depends on a green baseline.
* Schedule: **M0.5**, immediately, before any GPU work — it is independent and
  unblocks trustworthy gates.

---

## D5 · No screenshots — acceptance stays numeric/geometric
Carried from discovery C8. The user's eye remains the final gate for "WoW";
machine gates use contrast probes, alpha mass, coverage percentages, blit counts,
bake timings, and geometry checks. No claim of "looks better" will be made from code.

---

## D6 · Evidence discipline
* [M] measured · [E] estimated · [A] assumption · [R] research.
* No fabricated player feedback. Any UX statement is either cited research,
  a design inference ([I]), or an explicit assumption flagged for user validation.

---

## D7 · Single canvas by default — the second canvas is a desktop experiment

**Evidence gathered 2026-11-15 (four searches + one code inspection):**

1. `src/game/game.ts:311` already requests `{ alpha: false, desynchronized: true }`.
   An opaque canvas cannot show anything drawn *beneath* it, so the "sky canvas
   stacked under the game canvas" sketch in `05` §3 requires flipping the game
   canvas to `alpha: true`.
2. That flip converts the present into a **full-screen per-pixel blend of a
   translucent top layer** — the single worst compositor pattern in the
   literature, at 0.3–1.5 ms per layer, plus ≈17 MB of layer memory at 1600×900.
3. Blitting *out* of a WebGL canvas costs a readback + upload per use — "right for
   a screenshot or a filter, not for a per-frame composite".
4. iOS caps **total canvas memory** (224 MB / 384 MB observed) and silently
   renders canvases transparent when exceeded, so every live canvas is a liability
   on the platform that matters most for D2.
5. No mobile browser exposes a GPU timer (Android 0.56 %, iOS 0.15 %), so a
   per-frame GPU pass is also the one thing we could never budget honestly.

**Decision.** The default and only mobile path is **B3 — "GPU as generator, zero
per-frame GPU"**: shaders run at bake time, one `readPixels` per plate, and the
frame loop stays exactly today's single-canvas Canvas2D path with `alpha:false`
+ `desynchronized:true`. **No second canvas on any device** unless prototype P4
proves B1 pays for itself on desktop `high`/`ultra`.

**This is not a retreat from D3.** The distinct new technology is the
shader-authored plate pipeline (fBm / domain-warp / SDF on the GPU, graded by a
16³ LUT, read back once) which does not exist in this repo and which Canvas2D
cannot produce at our cost. It costs 0 ms per frame.

**What changes:** `05` two-mode design (Mode B demoted), `06` §2 mobile rows,
`10` P4 becomes a desktop gate, `01` GC-1/REQ-702/REQ-708…712, new doc `12`.

**What is kept:** drift by integer-offset blits, weather by plate cross-fade,
slow evolution by a scheduled re-bake guarded by REQ-703, moon occlusion by
baked `moonCover` variants. The sky still differs every run and still evolves
during a run.

**Reversal clause:** if P4 measures ≤0.5 ms compositor delta at dpr 2 *and* the
user prefers continuous morphing over the memory saving, D7 is revisited with
that measurement attached — not before.

---

## D8 · Mobile-first budget discipline: resolution before features

Netmarble/Android ADPF evidence: resolution scaling had "the most significant
impact on GPU load and thermal output" while shadows/textures had "minimal
impact on overall thermal performance"; frequency capping raised dropped frames
by up to 146 % in interactive apps. Therefore the shed ladder is fixed
(`12` §3, REQ-710) and tier changes that delete art come last. A steady 45 fps
is preferred over an oscillating 40–56 fps, and average FPS is never the target
metric — p95/p99 and jank ratio are (`11` §3).

---

## D9 · Cadence beats frame rate; 120 is opt-in, never promised

**Research (2026-11-15):**
* iOS Safari ships "Prefer Page Rendering Updates near 60fps" **on by default** on
  macOS/iOS/iPadOS, clamping `requestAnimationFrame` to ~60; 120 works on iOS 18+
  only after the user unchecks a developer feature flag, and **PWAs are locked to
  60 permanently** because they run on default flags (WebKit bug 173434).
* Chrome on Android caps **main-thread** frames at 60 Hz on 120 Hz screens, lifting
  only while a finger moves (`kThrottleMainFrameTo60Hz`); the documented escape is a
  worker-owned `OffscreenCanvas` frame clock (Uno Platform PR #25181).
* Perceived smoothness gains are statistically significant to ~75 fps and flatten
  beyond; player performance saturates ~90 fps with little benefit past 120
  (Claypool et al.). **Frame-time standard deviation predicts QoE with R² = 0.99**,
  and average frame rate "is not an effective predictor".
* On sample-and-hold displays "60fps@60Hz and 60fps@120Hz look identical" — so
  duplicating frames to claim 120 is worthless (Blur Busters).

**Decision.** Target **locked cadence at the highest rate the platform grants**,
detected at runtime. No 120 promise, no fake 120. The four levers, in order:
cadence lock + draw interpolation → sub-pixel discipline → half-frame smear on FX
only → opt-in 120 where measurable. A worker-clock 120 path for Chrome Android is
recorded as **M7** because it moves the game loop, input and the React boundary —
exactly what Rule 10 protects.

**Evidence that changed the plan:** our own scene is slow (play-band mean motion
9 px/s ⇒ **0.15 px** of persistence blur at 60 fps), so 120 would buy us almost
nothing in the sky. It buys latency and OLED judder reduction, which cadence and
interpolation deliver for free.

**Consequence:** FID-32…36 added; `18-MOTION-SMOOTHNESS.md` written; P9 added;
M6 gains T6.5–T6.10.

---

## D10 · Sample time-driven animation, interpolate state-driven motion

**Verified in code (2026-11-15):** animation is already a pure function of time
(`sampleClip(clip, t, out)`, `animator.ts:64`) and the animator's clock is already
externally drivable (`update(dt, loopPhase?, physicsTime?)`). So 120 fps limbs cost
*nothing* — we pass a render clock. Physics cannot do that: simulating at the render
rate would break the 244 fixed-step tests, and interpolating costs exactly one frame
of latency (8.3 ms at 120, the canonical trade from *Fix Your Timestep*).

**Decision.** Sim stays fixed at 60 Hz. Time-driven systems (clips, eases, camera,
parallax, drift, particles, blend weights) are **sampled at the render timestamp**.
State-driven systems (root motion, hitboxes, hazards) are **interpolated** with
`alpha = accumulator / dt`. Extrapolation is permitted only for the player's own
input echo, never for enemies or hazards (overshoot would lie about hit positions).

**Latency budget:** total added latency ≤ **16.7 ms** beyond the raw input sample,
enforced with `M-LATENCY`. Two specific bans: never smooth the camera *and* the
player (double smoothing is what people call "smooth but laggy"), and never lerp joint
*positions* (it shortens limbs and destroys the stickman silhouette — interpolate
angles, re-derive with FK).

**Also recorded:** the rig issues ~50 stroke calls per frame (20 for the player alone)
and allocates `rgba(...)` template strings per stroke inside the draw path, which
violates REQ-704. Doubling the frame rate doubles both costs, so T6.13 is a
prerequisite for 120, not an optimisation.

---

## D11 · Natural motion is code, not assets — and it ships before the sky

**Audit (2026-11-15):** the repo already has keyframed clips with Hermite in-betweens,
joint limits, foot-planting IK, polar hand space with a two-link elbow solve, and
context-driven pose offsets. It has **no** spring or Verlet secondary motion, **no**
motor-control velocity shaping, and a *looping* idle. Three precise gaps, not a
rewrite.

**Decision.** Add a motion layer built on published human-movement laws plus physics
lag, with zero art:
* **minimum-jerk** (Flash & Hogan 1985) quintic shaping for reaches and turns —
  mean/peak velocity 0.533 is the machine-checkable signature;
* **two-thirds power law** (Lacquaniti 1983) for weapon arcs — speed falls where the
  path bends, precomputed per clip at zero per-frame cost;
* **spring chains** for saya/sash/cuffs/tassel/topknot (21 points, ~0.05 ms);
* **aperiodic micro-life** so a stationary player never repeats a 4-second loop;
* **contact response** spawned at the interpolated sub-frame position.

**Cost:** ≤0.10 ms CPU, **0 MB, 0 blits, 0 GPU**, 0 allocations. For comparison the
atmosphere costs 3.5–24 MB and 2–6 blits.

**Why it can run before the sky:** the file sets are disjoint (`anim/**` vs
`gpu/**`+`world/**`), and the perceived-fidelity-per-byte ratio is two orders of
magnitude better. It becomes **M4.5**, parallel with M2/M3, gated on M0.5 (tests) and
on `19` §2 (render interpolation) for the chain render path.

**Explicitly not doing:** a death ragdoll (touches the combat-tested death path) and
any imported sprite/mocap asset (REQ-706).

---

## D12 · The optimisation verdicts are decisions, not opinions

`21-OPTIMISATION-CATALOG.md` records, for every technique the literature recommends,
an **ADOPT / COND / REJECT** verdict with the reason. The rejects are binding:
dirty rectangles for the scrolling world, multi-canvas layering, CSS-layer parallax,
a WebGL rewrite of the game renderer, instancing/atlases/sprite sheets, worker-rendered
OffscreenCanvas, WASM, service-worker precaching, GPU timers, and average-FPS targets
are **not to be re-proposed** without a measurement that changes the premise.

The reason this is a decision rather than a note: each rejected technique is
individually well-documented advice that would cost days and buy nothing *here*, and
the failure mode of a research-led project is implementing good advice for a different
problem. A rejection with a reason is worth more than an adoption without one.

---

## D13 · The contact-window test measures movement INSIDE the window, not at its edge

**Reversal:** `tests/full-body.test.ts` — "each strike holds an extreme at
contact" used to sample the striking joint 1/240 s either side of `hit.start`
and require >60 px/s. That assertion could never pass under the art direction
it was written to protect.

The reason is mechanical, not an excuse: every empty-hand clip is `step`
exposure (moveset.ts §"Global empty-hand exposure law"). A stepped clip is a
sequence of HELD DRAWINGS; the pose is constant on open intervals and changes
instantaneously at each drawing boundary. Sampling inside a hold therefore
measures exactly 0 px/s no matter how violent the strike is, and the motion the
player actually sees is carried by the smear the renderer paints behind the
limb (player.ts drawStrikeSmear). The old assertion was measuring the
projection of the drawing schedule, not the animation.

The amended assertion keeps the intent — damage must correspond to movement —
by measuring the MAXIMUM speed across the hit window (including the snap
boundary), which is where a stepped clip's velocity genuinely lives. It still
fails for a clip whose striking limb never moves at all, which is the bug the
test was written for.

Recorded here rather than silently edited, per T0.5.3: an assertion that is
genuinely wrong must be reversed in writing, with the reason, before it is
touched.

---

## D14 · Bake at the click, never on the first frame of play

Every invalidating event (a reseed, a tier change that needs new art, a device
pixel ratio change) must pay its bake immediately, in the same task as the user
action that caused it, and report the milliseconds.

The reason is that the two placements are not equivalent to the player even
though they are equivalent to the profiler. A 200 ms bake inside the first drawn
frame of a run is a **frozen game**: the player pressed PLAY and the picture did
not move, which reads as a hang. The same 200 ms inside the click that starts the
run is a menu that hesitated for a fifth of a second — invisible, because the
menu is a still image anyway. The cost is identical; the *interpretation* is not.

This also makes the cost visible: `bakeMs` is printed in the frame readout, so a
slow device reports itself instead of producing a bug report that says "sometimes
it freezes when I press play".

## D15 · The drawn blade is the hitbox, so the arm swings with the leg

With a sword drawn, `player.ts` resolves a kick through the SWORD segment. The
kick clips only posed the legs and left the sword arm in guard, so the blade
pointed down and back while the heel travelled forward: measured, an axe kick
"cut" 3 of 5 bodies and a step kick the same.

The fix is authorship, not a hit-test widening: the striking hand now drives
forward through each kick's own contact beat (`bladeSweepWithKick` in
moveset.ts), weighted to zero away from that beat so the rest of the clip is
untouched. Widening the segment instead would have credited hits the picture does
not show, which is the exact failure the blade-cleave suite exists to catch.

## D16 · The tier governor reads p95, not the average

`fpsAvg` is a lie about the frame a player remembers: a smooth 55 fps and a 55 fps
interrupted by 200 ms hitches produce the same number and completely different
experiences. Tier changes are therefore driven by `render/quality.ts`, which
decides on a 4 s p95 window, one step per window, with a 12 s dwell after a shed,
a hard floor and the user's choice as a ceiling.

The DPR governor keeps its own job (resolution), because resolution and draw
budget fail differently and recover at different rates. Two controllers, two
signals, no shared state — and the tier one is a pure state machine with
nineteen tests, so its behaviour is proven rather than observed.
