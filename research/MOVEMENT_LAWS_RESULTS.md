# Dash and movement laws — implemented

## Mechanics

- **Newton/impulse model:** dash uses shared constant effective mass70 and an exactly integrated unit-area thrust pulse. Delivered impulse cannot exceed the authored budget. The power governor may withhold motor thrust; it does not erase incoming overspeed to impose a hard velocity cap.
- **Signed momentum:** DashBody exposes x/y momentum as well as its existing momentum magnitude. Player exposes reusable `physicsMetrics` with signed momentum, kinetic energy, step-average net force, and static support load. Net force includes action/contact impulses averaged over the step; it is not a pure muscle-force measurement.
- **Traction:** ordinary ground propulsion, reversal, release braking, and overspeed target-seeking obey a shared grip×normal-acceleration limit. Grip2.25 and support acceleration2050 permit4612.5 units/s²; existing run/sprint/reversal/release settings remain below it. Very large incoming overspeed no longer demands unbounded exponential braking. Air steering is explicitly an arcade force and does not receive ground traction. Parry brace remains an explicit authored exceptional support action, not ordinary locomotion.
- **Dissipative quadratic drag:** the scalar passive drag term uses its analytic velocity update, cannot reverse travel, and composes across time partitions. Dash combines that term with motor, friction, and gravity using its existing small force steps; the combined solver is not claimed exact.
- **Inelastic contact:** root wall response removes incoming normal velocity only; separating motion is retained. Dash wall contact records signed impulse and lost normal kinetic energy once and preserves vertical velocity. No bounce energy is injected.
- **Work accounting:** DashBody records signed motor work along its integrated displacement and delivered impulse. Negative motor work can occur during reversal. This is not a complete system-wide energy ledger: drag/gravity/external intake and every cinematic source are not separately accumulated.
- **Existing preserved laws:** finite attack drive, finite parry bracing, landing impulse/load/compression, limited air steering, shaped gravity, and hold→release horizontal dash remain intact.

Units are world pixels/simulation seconds with effective mass, not a calibrated SI body/material model. Mass is constant through pose/equipment animations. Ground and ability motors are external momentum sources, so player-only momentum/energy is not conserved during propulsion. No fake real-pressure damage, universal elastic collisions, or irrelevant physical laws were added.

## Validation

- `bun run check`: **134/134 tests**, typecheck, animation/continuity audits pass. Existing cache-file lint warning only.
- `bun run build`: succeeds.
- `git diff --check`: clean.
- Six new tests exercise traction/support limits, drag dissipation/partition equivalence, separating/incoming contacts, impulse budgets across all10 dash variants×both directions×30/60/120Hz, one-shot wall absorption with vertical carry, and actual Player extreme-speed braking/telemetry/reset.
- Existing dash tests still qualify finite reversal, phase/pose clock, chain bounds, gravity, release carry, fast thrust, visible catch, wall depenetration, and sprint input semantics.
- Actual Player matrix: `research/player-physics-laws-results.json`,36cases/5760updates; maximum displacement and final-velocity difference from the preceding motor slice **zero** for those six non-dash scenarios. This does not assert zero dash trajectory change; exact pulse/drag integration intentionally changes its numerical solution slightly within existing dash regression tolerances.
- Production browser smoke rerun on final build,420updates at120Hz: no runtime errors, all checked values finite, immediate parry, landing captured, dash load planted, horizontal airborne release reached. `research/player-motor-browser.json` now describes this latest run. Sampled rendering, not a performance benchmark.

Preview on port3001 restarted onto this build. General continuous collision time-of-impact, full system energy accounting, explicit support-area/material pressure, other attack-family migration, effects-off visual qualification, encounter spacing review, and production performance A/B remain pending. No claim that every conceivable physics law has been implemented.
