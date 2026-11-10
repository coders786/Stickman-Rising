# Player motor implementation: first integrated slice

## Shipped changes

- Shared passive braking/drag helpers in `src/game/physics/player-motor.ts`; locomotion extraction preserves previous velocity formulas and travel, rather than mixing a timestep redesign into the migration.
- Sword l1 opts into a finite ground drive: starts at the existing .13 authored animation beat, lasts .06 simulation seconds, acceleration limit 3000 world units/s², target forward speed 150. Incoming forward overspeed is retained rather than reset. Existing ground braking remains. Motor budget belongs to the action and cannot persist into the next action after cancellation. No change to authored strike timing, animation keys, damage, grip, contact IK, or hit volumes.
- Other attacks and the unarmed jab are intentionally unchanged pending their own motion-family/contact qualification. This is not a universal moveX-to-impulse conversion.
- Parry defense opens immediately as before; grounded body momentum is caught by .05 seconds of finite braking at 8000, then 1200. Entry no longer multiplies velocity by .2. Airborne parry does not receive ground braking. This intentionally changes the parry travel envelope and may affect combat spacing; it is not advertised as behaviour-preserving.
- Landing contact captures incoming normal impulse and kinetic energy using constant effective mass 70 (world-unit scale, not SI calibration). Bounded visual pressure/load controls existing dust and sound; compression recovers over .08–.16 seconds based on impact. Normal collision still stops vertical motion while tangential carry survives. No new damage formula or real-material pressure claim.
- Reset clears landing load/compression and brace state; grounded support does not emit repeated landing impacts.

## Review decisions

Preserved accepted coast/jump/dash paths rather than changing the global integrator. Did not add competing root solvers or double-integrate dash motion. Did not add root/weapon ragdoll forces or alter actual wrist/contact endpoints. Landing response uses existing bounded squash; it does not change anatomy or add joint geometry. Rain does not secretly reduce traction.

Landing data is allocated only on contact/reset, not every frame. The strike drive and brace use scalar action state. No hot-loop ledger/logging or new physics dependency was introduced.

## Checks executed

- `bun run check`: **128/128 tests**, typecheck, animation and continuity audits pass. Existing cache-file lint warning remains; no lint errors.
- `bun run build`: passes; new production preview on port **3001** runs that final gameplay build.
- `git diff --check`: clean.
- `scripts/research-player-physics.ts research/player-physics-motor-results.json`: actual Player/Game-collaborator matrix; 36 cases, 5760 updates. All **30 non-attack baseline cases exactly unchanged**. Original baseline JSON preserved.
- Representative 60 Hz sword carry: largest Δvx per step **225 → 46.667**; total travel **62.75 → 122.722** world units over two seconds. The latter is an intentional, substantial spacing change and needs encounter playtesting, not an assertion that every previous attack endpoint is preserved.
- Seven new tests cover passive dissipation, mirrored/capped strike drive, landing impulse/energy/load bounds, actual Player strike at 30/60/120 capture Hz in both directions with incoming 0/480/900, unchanged coast envelope, one-shot landing/reset, and immediate defensive parry with finite bracing in both stances.

## Production browser smoke

Reproducible harness: `.qa/player-motor-browser.mjs`.

Example in this sandbox:

```
LD_LIBRARY_PATH=/home/user/browser-tools/al2023/lib node .qa/player-motor-browser.mjs
```

Optional `SR_BROWSER_TOOLS` supplies the external Playwright/Sparticuz package directory; `SR_QA_URL` overrides the default local port3001. These browser packages are not production dependencies.

Final production build: 420 simulated updates at120 Hz, high-quality storm, no enemies; sword strike, injected fall/landing, input-driven parry, held/released dash. No browser runtime errors; all checked positions/velocities/pose values finite; attack Δvx max23.333; landing load captured; parry opens on input; dash load planted; horizontal airborne release reached. Report: `research/player-motor-browser.json`.

Eight landmark screenshots stored in ignored `.cache/player-motor-browser/`; inspected strike, landing/recovery, parry, and dash samples. The black continuous silhouette and storm remain. Full effects obscure parts of the strike, so this does **not** qualify effects-off contact/foot-slip or every animation phase. Rendering sampled every fourth update plus screenshot landmarks to keep software-browser cost manageable. Initial every-update capture exceeded the execution timeout; orphaned browser was stopped and the bounded capture completed. This is **not a frame-rate/performance benchmark**.

## Still pending

Full encounter/contact-route qualification of increased l1 carry; effects-off foot/hand landmark sequences; fixed-quality production performance A/B and soak; actual hit reaction impulses; other attack motor families; general time-of-impact/integration improvements; explicit traction/support-area model; weapon inertia consolidation. Do not claim all planned physics systems are complete or momentum is universally conserved. Next priority is real-target collision/spacing tests for this pilot before extending finite-drive behaviour to the rest of the moveset.
