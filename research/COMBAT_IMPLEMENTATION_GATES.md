# Combat implementation specification and release gates

Status: implementation plan only. No production mechanics changed by this file.
Baseline: existing 114 passing tests, prior research JSON, current character and
weather/draw/walk/dash behavior. Do not treat passing these tests as proof that
new combat behavior is correct or fast.

## Working method

Implement narrow vertical slices, with a failing reproduction before the fix.
Each slice must have: explicit behavior policy, unit/integration coverage,
actual-player visual proof, performance comparison and a clean production build.
Keep correctness fixes separate from balance changes and visual changes so a
regression can be attributed. Stop on a failed gate instead of hiding it with FX.
No promise of perfection; make defects observable and reproducible.

## Slice 0 — baseline and reproducibility

- Preserve current production captures and event traces before changing behavior.
- Per-case RNG seeds, fixed input scripts and exact initial states. The prior
  matrix's global seed is reproducible but not sufficient for equal-input Hz
  comparisons. Restore test RNG afterward; production cosmetics need not become
  deterministic just to support gameplay probes.
- Trace action ID/instance, input event, simulation time, authored clip time,
  active interval, contact/outcome, actual HP delta, reward and target state.
- Optional debug ring buffer with fixed capacity; no unlimited logs or frame
  allocations in shipping hot paths. Dump only on failure or explicit inspection.
- Record provenance: actual entity test, full browser Game, static estimate or
  visual judgment. Never present one as another.

## Slice 1 — resolve contact once, then consume its result

Files: core/types.ts, combat/attacks.ts, entities/enemy.ts, entities/player.ts,
game.ts, projectiles and ability/cinematic call sites that share damage handling.
Audit all callers before changing the callback's return contract.

Proposed result fields: outcome (miss/hit/blocked/guardBreak/armored/parried/killed),
actualDamage, guardDamage, contact point, target ID, reaction category. A killed
result may also record contact type (e.g. chip) so death does not erase cause.
No target object references in long-lived traces.

Policy proposal, to encode explicitly rather than scatter across callers:
- Hit/guard break/killed: confirmed offensive outcome; reward once using resolved
  damage/eligible outcome, not unconditional overlap.
- Block/chip: guard feedback/pressure, no full hit-confirm energy or meter.
- Armor: preserve damage without interrupting the heavy's windup. Meter uses
  actual damage; do not accidentally turn armor into invulnerability.
- Parry: deflection response, no attacker's successful-hit rewards/elemental proc.
- Dead/missing target: no repeated damage, score, resources or impact procs.
- Choose lethal chip and resolve death in that branch, unless design explicitly
  chooses nonlethal chip instead. Never allow live targets with HP below zero.

Transaction order: validate target/contact → resolve damage and reaction →
resolve death → apply outcome-specific rewards/FX → emit trace. One authoritative
result, not duplicate calls to takeHit for presentation.

Required reproductions: current blocked-energy case, lethal chip, elite parry
reward leakage, armored damage, lethal armored hit, guard-break lethality,
multi-hit rearm, repeated contact after death, ability/projectile/echo outcomes.
Test full Game callbacks as well as entity methods; current runtime harness
intentionally omits Game score and elite parry.

## Slice 2 — reaction consistency without stealth rebalance

- Correct unarmed upward launch sign with an actual upward-displacement test.
- Consolidate launched non-drone gravity into one owner. First preserve measured
  effective gravity/trajectory (~3250), then tune apex/time in a separate change.
  Removing the 1900 term and retaining 1350 alone is a balance change, not merely
  cleanup. Drones and bosses have separate eligibility/reaction cases.
- Define and test kbY versus launch versus airborne juggle; no unused authored
  parameters or accidental double application.
- One landing/death/reset transition, no stale launched flags. Preserve heavy
  armor, boss stagger budgets and current no-auto-draw behavior.
- Empty-hand self-hop/follow-up is a deliberate stance-specific design decision,
  not silently inherited from sword chain metadata.

Gate: per-case identical seeds/input at 30/60/120Hz; measured apex, landing time,
contact outcomes and forward displacement with documented tolerances. Initial
suggestion: <=5% travel/apex error for rate comparisons, tighter where practical;
state transitions compared within a simulation-step tolerance. No NaNs or floor
penetration. Use analytical predictions only as cross-checks, not substitutes.

## Slice 3 — timing and input-accurate combo resolver

- Represent cancel input, allowed phase/window, ground/air state, hit/block/whiff
  conditions, resource gates and next action explicitly.
- Preserve current live controls while migrating; document intended exceptions.
- Keep clip time, simulation time, input real time and presentation time distinct.
- Detect active-window overlap across [previousTime,currentTime], including
  large-dt/high-speed cases. A crossed window must not disappear because the
  endpoint sample lies after it. Reconstruct/sample contact at relevant times.
- Clear consumed input exactly once; later high-priority defense may replace a
  buffered offensive intent. Test release edges across substeps, pause and blur.
- Prove a true combo by collision + opponent recovery + next contact, not a
  chain-array path. Test early/mid/late contact and starting light/heavy indices.

Gate: valid and invalid route tests, no ghost follow-up after hitstop/pause,
no doubled damage/cancel/charge consumption; generated move help matches resolver.
Keep ordinary sequence/pressure/true-combo labels distinct.

## Slice 4 — physical attack motor, one family at a time

Start with jab, cross and sword thrust; then diagonals/heavies, dash attacks,
launcher/air, dive/meteor, counter/charge and scripted exceptions.

- Finite impulse/work budget, stable substeps and exact phase boundaries.
- Inherited momentum preserved where compatible. Reversal must brake first.
- Distinct grounded support/pivot, actual airborne launch and landing absorption.
- Bounded pre-contact target alignment: maximum displacement/angle, target-loss
  rule, collision veto and commitment cutoff. No continuous homing or limb stretch.
- Hit/block/whiff get separate catch/recoil; visual pose layer must not override
  the collision authority. Keep visible fist/elbow/blade contact geometry.
- Cancelling must not replay spent impulse or duplicate hit events. Wall contact
  stops translation even if the authored pose still wants to drive forward.

Gate: 30/60/120Hz standing/run/dash/reversal entries, both directions/stances,
hit/block/whiff/wall, every cancel phase; speed and energy remain bounded.

## Slice 5 — victim budgets and encounter pressure

- Separate damage scaling from stun, physical launch and reward multipliers.
- Prefer action-level extension costs for multi-hit moves/echoes; repeated moves
  have explicit costs. Do not stack several strong anti-infinite systems at once.
- Target recovery/landing must not reset extension budgets unintentionally.
- Measure existing engagement limits before adding orchestration. Distinguish
  melee/ranged/aerial threat pressure and left/right spacing in this side view.
- Keep readable enemy tells and punish windows; no unavoidable offscreen pile-on
  and no artificial single-file queue. New player moves need meaningful targets.

## Visual bug-catching gate — every movement slice

Capture actual Player/Game output, not AI concepts as implementation proof:
- Contact sheets for load, support shift, acceleration, first/last contact,
  follow-through, catch, recovery. Include hit/block/whiff, left/right, fists/sword.
- Real-speed and slow-review 60Hz clips; effects off for anatomy then full storm
  gameplay. Pause around transitions, not only the attractive peak pose.
- Numeric landmarks: segment lengths, finite joints, reachable hand/foot targets,
  sole clearance, grip/socket error, blade sheath clearance, per-step angle change.
- Detect unintended double-foot hover only during grounded support phases; it is
  correct during actual flight. Don't write a test that pins the new leap down.
- Compare silhouettes: no waist-only fold, broken neck, elbow inversion, arm
  through torso, sword cutting roof, or both hands missing the grip.
- Contact/reaction direction must agree. Match event trace to visible contact;
  camera shake/afterimages must not conceal a missed hit or reward error.
- Render must remain side-effect free; drawing twice cannot alter combat results.

Automated image checks are tripwires, not an aesthetic judge. Use tolerant
landmark/image-region comparisons; seed/freeze cosmetic weather for visual
regressions so lightning doesn't produce false failures. Review normal random
weather separately. Preserve #000 body/no eyes/topknot/costume tubes.

## Performance gate — measured, not assumed

Use production build, fixed viewport/DPR, fixed quality tier, warm-up and identical
scenario/input logs. Run at least five samples and record machine/browser config.
Sandbox numbers are comparisons, not a claim about the user's hardware.

Measure separately: simulation step, collision candidate tests/narrow phase,
IK/animation solve, rendering, FX update, live FX count, allocations/GC stalls,
and browser frame p50/p95/p99. Don't let adaptive quality quietly hide a regression:
fixed-quality benchmark first, governor-enabled real-play check second.

Scenarios: isolated duel; mixed crowd; fast multi-hit/Phantom/Thunder chain;
charged flight→air attacks→landing; maximum storm plus combat; repeated deaths,
restarts, stance swaps and cancel-heavy play. Long soak checks bounded trails,
particles, hit maps, event buffers and pending attacks.

Targets proposed for reference-device qualification:
- 60Hz full-frame budget is 16.7ms, but report actual hardware and percentiles.
- Investigate >10% repeatable p95 regression against baseline; do not accept
  merely because average FPS looks unchanged. Check noise and absolute cost.
- Avoid new per-enemy/per-frame allocations and uncontrolled all-pairs collision.
  Profile before adding pools/spatial indices; those have their own complexity.
- Cap elemental recursion/proc depth, multi-target FX and simultaneous audio;
  preserve resolved damage/events when degrading cosmetic quality.
- No NaNs, unbounded heap/live-FX growth, sustained stalls or accumulating
  simulation backlog in the defined soak. State tested duration explicitly.

A screenshot-generation loop is NOT a performance benchmark. Do not time
synchronous screenshots as if they were gameplay frames.

## Per-slice release checklist

1. Failing reproduction recorded; policy agreed in tests.
2. Focused tests pass, then `bun run check`, `bun run build`, `git diff --check`.
3. Actual full-Game browser smoke: zero unexpected JS errors; correct controls,
   counters, score/resources, pause/blur/reset and persistence of equipment mode.
4. Landmark/sequence review and real-speed gameplay capture pass.
5. Fixed-quality performance A/B and memory/FX lifecycle checks pass.
6. Record limitations, unresolved issues and intentionally changed balance.
7. Update preview only to a tested build. Expand scope only after this gate.

Recommended first implementation: Slice 1 only, followed by its full-Game
outcome/reward/death regressions. Leave move additions and broad animation
recomposition out until this contract is reliable.
