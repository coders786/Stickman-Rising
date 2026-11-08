# STICKMAN RISING — GROUNDING PHYSICS PLAN

**Status: DESIGN ONLY — planned per request, execution deferred.**
Scope: the character-limb physics system that *grounds* the fighter with
constraints instead of authored postures. This document is the build
contract: data structures, integration points, solver order, tunables,
and acceptance gates. No code below is live yet.

---

## 0. WHY (the defects this replaces)

The current rig grounds the character through three *kinematic* mechanisms:
`updateFootLock` (pelvis height from planted feet), `applyGroundIK`
(2-bone leg IK to planner targets), and `GaitPlanner` (stride/anchor
state machine). They are now all guarded by hard limits, but they are
still **positional solvers with no dynamics** — they snap to targets,
fight each other through one damped scalar (`footLock`), and cannot
express *why* a body settles: no mass, no momentum, no ground reaction.

Measured defect history (all reproduced in QA before the clamp fixes):
- Stop from run → planted foot beyond leg reach → `vert→0` → pelvis
  bound collapses to ankle height → hipY −65 → −7, knees 176° locked.
- Brake deceleration → 9° back-lean lingering ~200 ms after vx = 0.
- Off-hand IK onto a sheathed pommel → elbow crosses flexion side.

Hard clamps turned these failures into *shallow lunges* — correct, but
still kinematic. The physics system below makes the failure modes
*impossible by construction* and gives the animation weight, follow-
through, and settle that keyframes cannot.

## 1. SYSTEMS (4 layers, strict solver order)

```
┌ L1 VERLET BODY CORE ──────────────────────────────────────────┐
│ pelvis + torso segments as point masses, semi-implicit Verlet │
│ (x += v·dt + a·dt²; v = (x−xPrev)/dt) — stable at any frame   │
│ rate, no accumulation blowups, free damping via velocity trim │
└───────────────────────────────────────────────────────────────┘
┌ L2 DISTANCE CONSTRAINTS (skeleton as a linkage) ──────────────┐
│ bones = stick constraints (bone length ± 2% strain); solved   │
│ Gauss-Seidel, 6–8 iterations, mass-weighted (pelvis 3.2× hand)│
│ THIS replaces FK where active: knees/elbows are positions,    │
│ not angles — anatomical limits become BENDED-SIDE constraints │
│ (knee must stay forward of the hip→ankle chord; elbow behind) │
└───────────────────────────────────────────────────────────────┘
┌ L3 GROUND CONTACT (the grounding layer) ──────────────────────┐
│ foot = contact point with: unilateral floor constraint        │
│ (y ≥ ground, projected with restitution 0 and friction cone), │
│ weight acceptance (stance foot gets support force = k_spring· │
│ penetration + k_damp·vy, clamped to ≤ body weight × 1.6),     │
│ and a NO-SLIP clamp while stance (x locked to anchor)         │
└───────────────────────────────────────────────────────────────┘
┌ L4 DRIVERS (intent layer — replaces authored poses where on) ──┐
│ · muscle springs: each joint gets a target angle with a       │
│   torque-limited PD controller (max torque = researched       │
│   strength envelope) — the body can FAIL to reach a pose      │
│   under load, which is where weight comes from               │
│ · angular momentum: lean becomes dynamic — the COG must stay │
│   inside the support polygon (feet convex hull) or the body  │
│   FALLS (a real dash commit, a real stumble on hard stops)   │
│ · foot placement (capture point): swing foot targets          │
│   xCOM + vCOM·√(h/g) — the biomechanically correct step to   │
│   catch a moving body; replaces the linear land prediction   │
└───────────────────────────────────────────────────────────────┘
```

## 2. DATA (new module `src/game/anim/phys/`)

| file | contents |
|---|---|
| `body.ts` | `PhysBody`: 12 point masses (pelvis, waist, chest, head, 2 shoulders, 2 elbows, 2 hands, knees/ankles via legs), Verlet integrator, gravity, global damp |
| `constraints.ts` | `Stick`, `BendSide`, `AngleLimit` constraint types + Gauss-Seidel solver (order: sticks → bend sides → contacts) |
| `contact.ts` | `FootContact`: floor projection, friction, support force, no-slip stance lock, plant envelope (√(reach²−dx²) preserved from the fix) |
| `drivers.ts` | `MusclePD` (torque-limited joint servos), `LeanBalance` (COG-in-support-polygon governor), `CaptureStepper` (foot placement by capture point) |
| `bridge.ts` | pose-channel ⇄ phys-point conversion (pose stays the SOURCE for clips; physics points OVERWRITE the pose post-solve when layer weight > 0 — same blending contract as `gaitW`) |

## 3. INTEGRATION (surgical, one state at a time)

The layer engages through a single damped weight (`physW`) exactly like
`gaitW` — clips stay authoritative wherever physics is off:

1. **Phase 1 (settle):** idle + stop-from-run only. Verlet body tracks
   the solved geom (soft springs), ground contacts on planted feet;
   `footLock` retired for these states. Gate: hipY never leaves
   [0.72, 1.02]·HIP_H over a 5 s random-input soak test.
2. **Phase 2 (weight):** walk + run. Muscle drivers track the gait
   targets; pelvis height becomes the L3 support solve. Gate: no knee
   lock (interior < 170°) at any duty factor; stride cadence match ±5%.
3. **Phase 3 (commit):** dash + brake. Angular-momentum lean with the
   capture-point stepper: hard stops take a REAL recovery step (the
   stumble), dashes lean because the COG genuinely leads the feet.
   Gate: dash lean 35–45° authored + ≤6° dynamic overshoot, stop
   recovers upright in ≤ 0.45 s with ≤ 1 extra step.
4. **Phase 4 (air):** jumps/air-dash — root height stays engine-physics
   (unchanged); limb points get ballistic follow-through only.

## 4. TUNABLES (initial values from research)

- pelvis mass 3.2, chest 2.4, head 1.0, upper arm 0.7, forearm 0.5,
  hand 0.35, thigh 1.3, shin 0.9, foot 0.45 (total ≈ 15.6 units)
- muscle PD: k = 180 s⁻², c = 24 s⁻¹ (ζ ≈ 0.9 — slightly over-damped,
  settles without wobble); torque caps: knee 260, hip 300, elbow 90,
  shoulder 110 (Nm-equivalents, tuned so a full-sprint arm pump at
  5 Hz stays inside 60% cap)
- support spring: k = 900 s⁻², damp c = 60 s⁻¹, force cap 1.6× body
  weight (compliant-but-firm — the "weight acceptance" read)
- friction cone μ = 0.62 (dry rooftop), restitution 0 (no bounce —
  anime weight, not ragdoll chaos)
- capture point: xFoot = xCOM + vCOM·√(h_COG/g), look-ahead clamp ±38 px
  (the QA-measured plant envelope)

## 5. ACCEPTANCE (verify-don't-guess, spec §9)

- **Soak:** 5 min random virtual input; zero joint-limit hits
  (`checkJointLimits` from `anim/limits.ts` polls per frame), hipY in
  band, no NaN, ≥ 55 fps on the QA machine.
- **Stop test:** release at vx = 350 → hipY dip ≤ 12 px, recover ≤
  0.45 s, backward lean ≤ 5°, both feet grounded within 150 ms.
- **Stumble test (phase 3):** stop at vx > 500 → one recovery step
  plants inside the envelope, torso stays inside ±28°.
- **Render parity:** shadow chains consume the phys points directly —
  the cast shadow deforms with the DYNAMIC body, contact AO stays
  glued to real support feet.

## 6. WHAT STAYS KINEMATIC (deliberately)

Attack swings, iai draws, parries: authored keyframes + the sword-arc
3D solver stay in charge — combat needs *choreography*, not physics.
The physics layer blends OUT (physW → 0) during any attack state and
blends back over 90 ms on exit, preserving the momentum handoff via
post-attack velocity seeding (the existing `postAttackT` layer).
