# Player physics: momentum, inertia, support, and impact

## 1. Scope and objective

Make the shadow fighter physically legible and mechanically consistent without turning the game into a rigid-body simulator. Preserve responsiveness, minimalist continuous anatomy, actual contact endpoints/IK, all existing equipment stances, sprint presentation cadence, and the **hold → release → horizontal airborne dash**. Do not restore hold-to-extend dash.

This is a plan plus a reproducible baseline, not a production physics rewrite. No movement constants were changed for this study. Combat outcome fixes from slice 1 remain intact.

Physical consistency means explainable momentum changes, not literal conservation of the player alone. The player exchanges momentum with the ground, opponents, weapon, walls, and supernatural abilities. Muscle work and ability energy can increase kinetic energy. Ground contact can absorb it. Internal pose changes alone cannot propel an airborne centre of mass.

## 2. Source audit: what actually exists

Reviewed `entities/player.ts`, `physics/dash-body.ts`, `combat/dash.ts`, and Game's simulation clock.

| Area | Current mechanism | Assessment |
|---|---|---|
| Run | speed 350, acceleration 2600 | Already finite acceleration; preserve initial response baseline. |
| Sprint | speed 480, acceleration 3400 | Distinct motor; retain deliberate sprint intent and animation cadence. |
| Ground release | deceleration 2800 | Passive stop exists, but separate state-specific braking models are scattered. |
| Reversal | brake 4600 at high speed, then normal acceleration | Intent must reverse before velocity; support/catch should make the change readable. Threshold behaviour needs tests. |
| Air control | acceleration 650, exponential idle drag .4 | Nonzero external arcade steering/drag; identify explicitly rather than pretend vacuum conservation. |
| Overspeed | exponential decay to input target; ground rate 6, air .55 | Good preservation of dash carry, but position integration still varies with step size. |
| Jump | launch -950, second jump -820, running boost up to 560 | Authored impulses; running boost and air jump need explicit work sources. |
| Gravity | base 2050, rising ×1.35, apex ×2.2, falling ×3.5, terminal 1650 | Purposeful arcade shaping, not constant Earth gravity. Do not silently replace it. |
| Dash | mass 70; finite impulse budget, drag, tiny force steps, phase boundaries, trapezoidal displacement | Best existing model to learn from; **not** a reason to duplicate or replace it wholesale. |
| Dash vertical motion | own gravity/drag during motor ownership | Handoff to shared shaped gravity can change acceleration. Measure seam before altering trajectory. |
| Attack | ground deceleration 900; authored moveX/moveY directly replace velocity | Main carry discontinuity: these are target velocities currently labelled impulses. |
| Parry/sheathing | entry multipliers (.2/.3), then braking | Instant energy removal lacks a finite support event; distinguish intentional hard plant from accidental reset. |
| Charge/scripted | grounded velocity zeroing in several paths | Some cinematic locks are legitimate; make ownership explicit rather than applying one rule everywhere. |
| Damage | vx/vy assigned from reaction type | Incoming momentum can disappear or reverse without an explicit impulse model. |
| Ground/wall | clamp position; remove normal velocity | Inelastic contact is reasonable, but contact timing and impact measures are incomplete. |
| Clock | max 3 steps/frame, each ≤1/60; hitstop advances simulation at .05× | Already bounded substeps, not a universal fixed-step solver. Preserve one-substep input edge handling. |

`DashBody.mass = 70` is presently a scale in world-pixel mechanics, not evidence the character weighs 70 SI kilograms. Its thrust budget is also proportional to mass, so changing mass there alone need not change acceleration. Avoid cosmetic mass parameters that cancel out everywhere.

## 3. Baseline experiment

Run: `node --import tsx scripts/research-player-physics.ts`.

Output: `research/player-physics-baseline.json`. Actual Player with Game-owned collaborators; six scenarios × both directions × 30/60/120 capture Hz = **36 cases**. Each runs two simulation seconds. A 30 Hz capture uses two 1/60 updates, matching Game's substep cap; 60 uses one; 120 uses 1/120. There are **5,760 Player updates**. No enemies, rendering, browser loop, audio context, or wall-clock performance measurement. Jump starts from an injected launch condition and is not an input-recognition test. Seed 123456; all checked positions, velocities, and pose channels were finite.

Representative rightward results:

| Scenario | 60 Hz capture | 120 Hz capture | Meaning |
|---|---|---|---|
| Coast from 480 | 37.222 travel; rest .1833 s | 39.167; rest .1750 s | ~1.94 units of stopping-distance drift. |
| Reverse from +480 | first negative vx .1167 s | .1167 s | Need inspect near-zero samples; it need not land on exactly zero. |
| Air drift, y=-300/vy=-200 | ground .3500 s; total x 183.887 | .3417 s; total x 182.595 | Landing event quantization plus integration differences. |
| Overspeed 900, hold forward | x 787.159; final vx 350.0034 | x 789.394; same final vx | Velocity decay agrees; accumulated displacement does not exactly. |
| Launch -950 with vx350 | apex -150.640; land .5167 s | apex -154.462; land .5167 s | ~3.82 units apex difference; shaped gravity thresholds matter. |
| Sword l1 from vx480 | x62.750; largest single-step Δvx225 | x62.563; largest Δvx225 | Authored velocity replacement persists across both step sizes. |

30 Hz results match 60 Hz here because the actual update sequence is identical. That does not certify the full game's frame scheduling. Largest Δv is not a force or a bug by itself: divide by elapsed time only for a finite-duration acceleration; instantaneous contact impulses need their own event classification.

## 4. Units and physical quantities

Keep position in world units and time in **simulation seconds**. Positive y is downward. Choose one documented effective mass scale; do not mix Newtons/joules/pascals with pixels and call them SI measurements. A metre conversion can be introduced later only if all relevant distances and accelerations share it.

- Linear momentum: `p = m v`, separately x/y. Momentum is a vector, not just speed.
- Impulse: `J = integral(F dt) = Δp`; useful for jump, hit reaction, contact, dash, attack drive.
- Kinetic energy: `K = .5 m |v|²`; useful for absorption and effects budgets, not automatic damage.
- Force: `F = m a`; use for continuous drive, steering, braking, and gravity.
- Torque/angular inertia: `τ = I α`, `L = I ω`; useful for weapon/body *visual* lag and bounded recovery.
- Average contact pressure proxy: `P = normalLoad / effectiveSupportArea`.
- Contact stress/edge sharpness is not the same as root-body pressure. We do not simulate material fracture, tissue, blade deformation, or real contact patches.

### Mass conservation

Keep effective body mass constant during actions. Squash, extension, depth rotation, mirroring, and shadow effects must not change it. Dismissing a trail must not change momentum. Body shape remains continuous; no mannequin/visible joint reconstruction.

An eventual weapon mass parameter describes carried equipment, not a body-mass mutation every time the sword is drawn. Start with stable combined root mass; use weapon balance/inertia only for bounded animation response. Changing stance must not create speed by changing mass. Do not introduce variable-mass equations without an actual mechanic that ejects/acquires mass.

### Momentum and energy boundaries

Track a small debug-only ledger by cause: ground motor, braking, gravity, air assist, jump, dash ability, attack drive, external hit, ground/wall contact, scripted override. For each step, check `Δp - sum(J)` within solver tolerance. Include collision and constraint impulses. An energy decrease is valid under braking/contact; an increase needs motor/ability/impact work. This is diagnostic accounting, not a second physics solver.

Never promise isolated conservation in ordinary grounded locomotion. For an isolated **test mode** with forces/drag/motor disabled, velocity must remain constant. For paired impacts, test equal-and-opposite impulse only where both participants actually use that pair model; gameplay armor/knockback are not automatically such a model.

## 5. Proposed architecture: one root, explicit ownership

Introduce a small `PlayerBody`/motor module only after preservation tests. It owns root position, linear velocity, constant effective mass, contacts, and force/impulse application. It is a kinematic character motor with explicit contact handling, not full ragdoll dynamics.

Each step:
1. Consume input edges once; derive intent without directly assigning root velocity.
2. Select one movement owner: locomotion, dash, attack drive, reaction, or cinematic.
3. Gather continuous forces and one-shot impulses with named causes.
4. Integrate with bounded steps and split at significant motor/event boundaries.
5. Sweep ground/wall contact; remove incoming normal momentum at time of impact, retain tangential motion subject to traction.
6. Publish root velocity, acceleration, support/impact facts to animation and FX.

Do not allow Player's shared integrator and DashBody to integrate the same axes in the same step. Migrate DashBody through an adapter first. Ownership transfer must copy outgoing velocity exactly once, not recompute from the destination action's target speed. Keep cosmetic anticipation/root offsets separate from collider displacement.

Prefer fixed reusable scalar fields over per-substep arrays/maps. Debug ledgers must be disabled in production and bounded when enabled. A tiny force solver does not require a general-purpose physics dependency.

### Integrator decision gate

Do not immediately impose 120 Hz on the entire game or change hitstop/input/animation clocks. First compare: (A) existing bounded substeps with analytic drag/braking displacement and event splitting; (B) motor-only fixed internal steps with interpolation; (C) full fixed-timestep simulation. Start with A. Analytic constant braking uses the actual stop time if it falls inside the step; exponential drag integrates both velocity and displacement. Split gravity thresholds/ground crossings when needed. Any globally fixed-step decision needs a separate cost/input-latency study.

## 6. Movement mechanics

### Ground propulsion, inertia, and reversal

Keep early input response and current speed targets initially. Model target-seeking force with an acceleration/traction limit, not uncontrolled velocity snapping. Mass only changes response if force or impulse budgets are independently specified; decide which parameters are mass-normalized explicitly.

Reversal has three mechanical stages: catch incoming momentum, unload near zero, push in the new direction. Facing/upper-body aim may change earlier than travel direction. Avoid a mandatory dead interval that makes controls feel stuck; allow immediate braking intent while the body still travels forward. Preserve analog walk and clear skid/stop clips.

Stopping calibration uses `d = v²/(2a)` for constant deceleration, not a guessed animation duration. At speed480/a2800 the continuous ideal is ~41.14 units, versus current ~37.22 at 60 Hz. This difference is baseline evidence, **not authorization to change stop distance**. Initially preserve the accepted gameplay envelope; later tune distance, duration, and foot catch together.

### Traction, support, and pressure

Root propulsion/braking exchanges momentum with the ground. A simplified grounded limit is `|F_t| <= μ N + explicitAbilityAssist`, where N is effective support load. Do not derive N blindly from fall-shaped gravity; the anti-float controller is not a realistic weight multiplier. Separate support gravity/weight from authored airborne shaping if using a traction model.

Support states: none, toe/forefoot, full foot, double support, sliding. Effective support area is a dimensionless authored proxy initially. High load/small support area can drive dust, brief compression, or controlled skid—not huge damage or a collider-area change. Toe-off pressure must coincide with actual takeoff; no continuing ordinary ground thrust after support is lost.

Rain remains visual by default. Do not silently reduce grip whenever storm effects change. Surface friction variants, if desired later, must be explicit, readable gameplay surfaces and independently tested.

### Airborne motion

Retain shaped gravity initially and label air steering/double-jump as arcade assistance. Air control needs bounded acceleration, no velocity cap that erases externally supplied carry. Backward input brakes momentum before reversing it. Pose rotation or leg cycling must not move the root in isolated flight.

Dash is allowed explicit supernatural thrust, including after takeoff; its source is the ability motor, not friction against nonexistent ground. Keep hold/release launch and horizontal silhouette. Test acceleration seams between dash-owned gravity and ordinary fall shaping. Preserve flight height and duration before tuning those seams.

### Jump and landing

Ground jump is a takeoff impulse with anticipation/support before root departure. Air jump is a named ability impulse with its existing usage limit. Running boost is motor work, not conversion of vertical energy for free; do not claim conservation while increasing both components.

On landing, capture pre-contact normal speed, mass, and incoming energy. Contact absorbs normal momentum; sustained load then supports the body. Use bounded absorption duration/spring response for visuals. Do not turn absorbed energy directly into an uncapped bounce. Tangential motion persists unless traction/braking removes it.

A crouch/compression increases **stopping time/distance**, lowering average force for the same absorbed impulse. It does not reduce the impulse necessary to stop. Visual knee bend must respect joint limits, actual foot anchors, and black continuous anatomy. Small landings recover quickly; larger falls get stronger absorption without arbitrarily locking inputs.

### Walls and boundaries

Use time-of-impact normal response; no pass-through then large corrective teleport. Default restitution zero: wall absorbs incoming normal momentum, does not reverse it into a bounce. Preserve tangent velocity. Wall interaction must not inject chain-dash speed. Feed one bounded impact event to FX/camera; do not retrigger every blocked frame. Cinematic teleport/reposition remains a named exception with its own collision policy.

## 7. Combat and weapon inertia

### Attack motor families

Replace universal moveX/moveY assignments only after per-attack baseline capture. Classify each authored entry as:
- planted strike with finite braking;
- advancing strike with a short traction-limited drive;
- carry-through strike that retains incoming travel;
- launcher impulse;
- aerial correction/dive ability;
- cinematic override.

The existing value could mean a target speed, minimum forward speed, additive impulse, or displacement. Never blindly convert every `moveX` to additive velocity: repeated chains would accelerate without bound. Each family needs duration, work/impulse budget, carry fraction, and maximum motor-added speed. Limit **motor work**, not arbitrary removal of external momentum.

Start with one light attack and one carry-through route, both stances and directions. Preserve contact window, reach, and selectable routes. Movement changes must not secretly extend hitboxes or move wrists away from established contact endpoints.

### Being hit and parrying

Express reactions as bounded external impulses or explicit authored velocity targets with accounting. Existing health damage does not determine physical impulse automatically. Retain armor and interruption rules from hit resolution. Avoid tiny hits catastrophically canceling dash carry unless intentionally authored.

Parry uses contact plus support/ability work; it is not literal perfect elastic reflection of the whole enemy. Bracing can absorb player momentum over a short finite interval. Keep successful parry timing, rewards, and steel contact unchanged while migrating the root response. Never trade away a reliable defensive input for physical purity.

### Rotational inertia and follow-through

Weapon inertia depends on mass distribution; a long balanced blade can need more rotational torque without making the root body heavier. Begin with bounded secondary angular springs/damping from measured hand/blade angular acceleration. Do not simulate a free weapon that pulls the hand off the grip or misses the authored strike endpoint.

Priority: contact pose/IK > anatomical limits > readability > secondary inertia. Capture, strike, follow-through, and regrip are distinct. Shoulders/hips counter-rotate within limits; this is not a new root propulsion source. Avoid applying lag twice: Player already has bladeLag/chainLag and post-attack residuals. Audit and consolidate rather than stacking another spring.

No real edge-pressure damage formula in the first pass. Combat damage remains authored; actual impulse/contact outcome can scale bounded effects. Otherwise tiny contact-area estimates would create absurd damage multipliers.

## 8. Animation/physics contract

Publish intent direction, actual travel direction, support phase, acceleration, impact impulse, load/pressure proxy, and movement owner. These facts drive the existing contextual clips, not random pose selection.

- Acceleration: supported core lean and propulsive leg action, not a waist fold.
- Braking: support foot catches travel ahead of the centre of mass; do not slide a supposedly locked foot.
- Reversal: torso anticipates, COM decelerates, new support drives away.
- Flight: limbs can change silhouette without translating COM; preserve horizontal dash silhouette and real clearance.
- Landing: foot contact first, compression/absorption, then recovery with believable hand placement.
- Weapon drive: pelvis/core → shoulder → elbow → wrist, without deleting real grip/extraction stages.

Do not change sprint's intentionally held 10 FPS presentation into 10 FPS physics. Keep simulated physics independent of visual hold cadence and equipment transitions.

## 9. Implementation slices and review checkpoints

After every small change: inspect diff, state what changed in observable terms, run its targeted reproduction, and stop expanding if the local gate fails.

1. **Baseline/contract (this study):** velocity-writer map, six runtime scenarios, units/ownership proposal. Next add input-driven sprint/jump/dash and damage/parry transitions.
2. **Observability without tuning:** bounded debug-only cause ledger and transition snapshots. Confirm instrumentation-off cost and identical outcomes.
3. **Locomotion extraction:** isolate existing braking/drag/motor formulas without behavioural changes. Assert both signs/analog values and state transitions.
4. **Integration consistency:** exact braking/drag displacement and contact timing, one at a time. Decide preservation tolerances before changing accepted stop/flight envelopes.
5. **Support/landing:** normal impulse + bounded absorption facts, then pose/FX integration. Preserve tangent carry and input recovery.
6. **Attack carry pilot:** replace one velocity assignment with a documented motor family. Requalify collisions, timing, damage/rewards, overspeed, and cancel routes.
7. **Parry/damage/charge migration:** explicit impulses/bracing, retaining defensive reliability and armor semantics.
8. **Dash unification:** adapt its existing finite-force engine to shared body ownership; preserve hold/release, launch height, path, phase visibility, and exit carry. Do not rewrite a working dash merely for architectural symmetry.
9. **Weapon inertia polish:** consolidate existing lag; add only evidence-backed bounded angular response. Contact/IK stays authoritative.
10. **Tuning:** adjust weight, stopping distance, force/traction, and effects only after correctness and performance gates pass. Keep reference baselines per approved change.

Do not combine integrator migration, global fixed timestep, damage formulas, new animations, friction surfaces, and dash tuning in one patch.

## 10. Qualification gates

### Numerical/unit tests

- No-force flight keeps velocity; no-force position is linear.
- Constant impulse yields Δv=J/m; doubling mass halves Δv for fixed J. A fixed target-speed motor is tested separately.
- Mirrored left/right scenarios produce mirrored root motion and equivalent timings within tolerance.
- Passive drag/friction cannot increase kinetic energy or reverse motion.
- Braking stops inside a step without crossing zero; reversal subsequently accelerates in the intended direction.
- One-shot impulse fires once across substeps, pause/blur, buffered input, and hitstop boundaries.
- Wall removes incoming normal velocity, keeps tangent, produces no energy gain.
- Landing records incoming speed once; no repeated recovery/impact emission while grounded.
- Ownership changes preserve velocity unless an explicit logged impulse/override explains the difference.
- Tiny/zero dt, finite-value guards, dt spikes within supported Game cap, and chained actions remain bounded.
- Pressure proxy is finite/bounded when support area is small; unsupported body has no ground traction.

### Runtime regression matrix

Both stances, directions, 30/60/120 capture rates plus uneven frame sequences; analog 0/.25/.5/1; incoming speeds 0/120/350/480/900; grounded/rising/apex/falling; stops/reversals/jump/landing; normal dash and charge-release; walls; attack/parry/hurt transitions. Add deterministic per-case seeds. Full Game path must also cover hitstop, slow motion, projectiles, collisions, rewards, and input edge lifetime.

Initial proposed migration gates, not measured guarantees: unchanged semantic events and reward counts; matching endpoints/contact landmarks; investigate >2 world units displacement or >one 1/120 step event drift before accepting. Do not use percentage error near zero. Explicitly approve intentional tuning differences rather than weakening tests until they pass.

### Visual review

Capture effects-off and full-storm sequences for accelerate→sprint, release→stop, hard reversal, sprint→jump→landing, dash load→release→flight→catch, dash→strike, parry entry, and knockback. Show slow motion plus normal speed and root/foot/contact overlays. Check planted feet, knee limits, core balance, silhouette, grip, blade contact, no geometry separation, no camera concealment of skating. No claim of visual validation from numeric finiteness alone.

### Performance/release

Compare production builds at fixed quality and same scripted scene, at least five samples; record p50/p95/p99 update/render time, substeps, FX count, and memory trend. Investigate repeatable >10% p95 regression; no unbounded debug allocations or per-force object churn. Then test adaptive quality and a sustained combat soak. Passing unit tests is not a frame-time measurement.

Run full `bun run check`, production build, and `git diff --check`. Preserve existing combat-outcome tests and animation/continuity audits. Do not certify browser visuals/performance until actual captures/measurements exist.

## Immediate next implementation

Add a behaviour-preserving locomotion motor extraction and finite braking/drag unit tests, with existing acceptance envelopes frozen first. In parallel, expand the baseline to input-driven dash/jump and parry/hurt seams. The highest-value correctness target is explicit action momentum ownership—not adding more constants named mass or pressure.
