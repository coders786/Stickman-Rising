# Combat implementation — slice 1

Implemented contact resolution and reward correctness. No animation, dash, movement, gravity, or attack timing tuning in this slice.

## Decisions and review

- `HitResolution` distinguishes miss, parry, block, guard break, armor, hit, kill; carries target ID, contact class, actual HP damage, and guard damage.
- Game resolves damage once. Player contact and ability rewards consume that result. Blocks/parries/chip guard breaks do not count as confirmed strikes. Armor still damages HP and remains eligible.
- Meter and hit score use actual HP removed, capped at remaining HP. Flat energy-on-confirm remains unchanged.
- Chip is lethal, with HP clamped to zero. Death presentation and kill rewards run through Game once. A subsequent dead-target callback returns miss.
- Guard health stays private behind a read-only getter; review/typecheck caught and removed an initial attempt to access private state.
- Existing Enemy string API remains for direct research probes; the gameplay WorldRef API now requires a structured result. The runtime research harness was adapted to return that result. Historical JSON was not overwritten or relabeled as post-fix evidence.

## Validation

Two death regressions failed before the fix and passed afterward. Seven new tests now exercise Enemy, the actual Game orchestrator, and Player ability callbacks: lethal chip, repeated dead contact, block/guard-break scoring, single kill rewards, elite parry, damage-bearing armor/overkill, and actual-damage ability meter.

- `bun run check`: 121/121 tests; typecheck and animation/continuity audits pass. Existing ignored-cache lint warning remains; no lint errors.
- `bun run build`: succeeds (production code identical to that build; one additional test added afterward).
- `git diff --check`: clean.

## Not yet qualified

Browser visual captures and production performance A/B/soak are not measured for this slice. No claim of visual or performance certification. The existing running preview has not been restarted onto this build.

Next: exercise normal Player contact rewards and elemental procs through full contact sequences, then browser landmark captures and fixed-quality timing before expanding into reaction/gravity changes. Preserve current launch trajectories until that separate slice has its own regression baseline.
