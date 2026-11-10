# Stickman Rising audit

> Historical audit of the original revision. Subsequent fixes restored the player,
> storm and dash implementations, fixed input and touch controls, improved startup
> error handling and idempotency conflicts, and updated the build helper. See the
> current tests and Git diff for the verified state. The public leaderboard remains
> client-reported; SQLite-backed global and optional trusted-proxy client rate
> limits have since been added.

Audit date: 2026-11-09
Revision: `9ee64087990368d6de292f4060a22cd76ea88352`

## Executive summary

**Not release-ready.** The game cannot be initialized in its current state, and large parts of the player and weather implementations have been replaced with placeholders. Independent type errors also prevent a production build. This is an investigation, not a repair; no application code was changed. Findings below are the issues established during this audit, not a guarantee that no others exist.

## Critical findings

1. **Game construction crashes before the UI can handle the error.** `src/game/world/storm.ts:42-48` calls `this.random()`, but `StormEngine` has no such method. `Game` constructs a storm as a field initializer (`src/game/game.ts:113`), so `new Game()` throws `TypeError: this.random is not a function`. That constructor is called outside the `try` in `src/app/page.tsx:88,126`, so the intended initialization-error message and cleanup do not run. Reproduced by the game-dependent tests. Restore the storm implementation and include construction/settings initialization in the error boundary.

2. **Most player gameplay and rendering code is missing.** `src/game/entities/player.ts:515-591,608-617,665-735,753-760` contains placeholder bodies for the update loop, movement, combat, dash, parry, charge, damage, abilities, animation and drawing. Normal `takeDamage` returns success without reducing HP (`:594-609`), while `draw` does nothing (`:734-736`). `reset` calls the nonexistent `playAnimation` (`:478`); `startDraw` and fields such as `swordDrawn` are also missing. Fixing only the storm constructor therefore cannot make the game playable. Recover and integrate a complete, compatible player implementation, then verify all combat and lifecycle flows.

3. **Weather simulation is incomplete.** `src/game/world/storm.ts:64-66` has an empty update method; methods/properties used by the rest of the app, including `setQuality`, `resize`, `setView`, `intensity`, and `wind`, are absent. Rain does not evolve, lightning and splashes cannot age, and quality/background operations fail even if construction is repaired. Restore the complete simulation and its public contract.

4. **Production typechecking fails extensively.** `npm run typecheck` reports 102 TypeScript errors in this checkout, including the player/storm issues above, the dash error below, incompatible rendering calls, stale research scripts/tests, and the missing generated Prisma client. `src/game/render/renderer.ts:112,253` calls `player.draw` without the declared `WorldRef`, and passes a boolean in that position for reflections. Both interfaces and call sites need reconciliation. Prisma generation accounts for one environment-dependent error, not the rest.

## High findings

5. **Dash liquid-impact detection cannot work.** `src/game/physics/dash-body.ts:93` reads nonexistent `this.y`, and refers to `oldY` before its declaration at line 116. As currently written, `undefined < 0` is false, so the impact branch cannot trigger; supplying a `y` value that makes the preceding condition true would expose the temporal-dead-zone error. The position/crossing calculation should use actual player/world coordinates and be tested over the relevant time step. Additionally, `src/game/entities/player.ts:548` references nonexistent `w.fx.storm`.

6. **Touch players cannot draw/sheathe or cycle swords, and joystick sprint is not registered.** The touch controls (`src/app/page.tsx:606-627`) expose neither `sheathe` nor sword selection, although the instructions require Q to draw. The joystick calls only `setVirtualAxis` (`:671`); that method does not call the direction-press tracking used by `sprintDirection` (`src/game/core/input.ts:200-215`). A direct double-tap-axis reproduction returned sprint direction 0. Add touch actions and define/test a touch sprint gesture. These defects are currently masked by the startup blocker.

7. **Multiple keys mapped to the same action interfere with each other.** `src/game/core/input.ts:16-31,105-135` stores one boolean per action rather than tracking individual held keys. Reproduction: press A, press Left Arrow, release A; `down('left')` becomes false while Left Arrow remains held. The same issue affects other aliases such as the two Shift keys. Track physical keys independently and release an action only when all associated sources are up.

8. **Public score endpoint can be spammed and scores are forgeable.** `src/app/api/scores/route.ts:22-62` accepts unauthenticated client-supplied scores and creates a row on each valid request, with no rate or storage limit. An attacker can fill the leaderboard and grow the SQLite database. The README explicitly states that scores are not cheat-proof, so this is a documented design limitation rather than a claim of authentication bypass. If a public competitive leaderboard is intended, add abuse controls and server-verifiable run data.

## Medium and operational findings

9. **Reused idempotency keys silently accept different submissions.** The score upsert (`src/app/api/scores/route.ts:59-62`) returns the old row with 201 even if the new payload differs. After a timed-out request, changing the player name and retrying can appear successful while preserving the previous name. Compare stored and submitted payloads and return a conflict for mismatches, or clearly enforce immutable retry payloads.

10. **Deployment build helper assumes a different absolute checkout path.** `.zscripts/build.sh:13-18` requires `/home/z/my-project` and exits in this checkout. This may be intentional for the original deployment platform, but the helper is not portable to arbitrary clones. Derive the root from the script or accept a documented override. It also builds before `database-runtime-build.sh` runs, while the Prisma client is ignored and not generated by the build script itself; a clean deployment must generate the client before Next compiles.

11. **Development origin is tied to a single old preview host.** `next.config.ts:7` hard-codes an `e2b.app` hostname. Other preview hosts can be rejected for development assets/actions; configure allowed origins for the actual environment rather than a previous sandbox.

12. **Dependency and lint maintenance.** `npm audit` reports 10 moderate findings in the installed dependency graph, stemming from the minimatch glob-amplification advisory [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) through lint tooling. `npm audit --omit=dev` reported zero findings. `npm ci` also warns that several Next ESLint plugins declare support only through ESLint 9 while ESLint 10 is installed. Evaluate compatible upgrades/overrides rather than blindly applying the suggested major downgrades. Lint currently passes despite the placeholder code; many rules including `no-empty`, `no-unused-vars`, and `no-undef` are disabled in `eslint.config.mjs`, weakening its value as a guardrail.

## Verification performed

- Node 22.22.3 / npm 10.9.8. `npm ci` initially failed because the environment could not download Node headers; `npm_config_nodedir=/usr/local npm ci` succeeded with locally installed headers.
- `npm run lint`: passed.
- `npm run typecheck`: failed, 102 errors. The Prisma client was not generated.
- `npm test`: 130 reported tests, 91 passed and 39 failed. Many failures share the storm/player root causes; the scores test file failed to load because the generated Prisma client was unavailable. Passing tests do not establish that the complete game works.
- `npm run db:generate`: blocked because this environment cannot reach `binaries.prisma.sh`; therefore database integration tests and `db:push` could not be verified.
- `npm run build`: failed resolving the missing generated Prisma client. After generation, the independently observed TypeScript errors still require correction before a typechecked production build can pass.
- `npm audit`: 10 moderate findings; `npm audit --omit=dev`: 0.
- Direct input probes reproduced the held-key and joystick-sprint issues; a dash probe confirmed no liquid impact in the sampled ground dash.
- Bun, Docker and `uv` were unavailable, so Bun animation checks and deployment/container helper tests were not run. A full browser playthrough and live leaderboard exercise were blocked by the initialization and Prisma issues. Security review was limited to source and dependency checks; no exhaustive penetration or device testing was performed.

## Recommended order

1. Recover compatible complete player and storm implementations, including their contracts with Game, renderer and effects. Fix constructor error handling.
2. Repair dash physics and the renderer interface; reconcile stale scripts/tests and clear all type errors.
3. Generate Prisma client and schema in an environment with engine-download access, then rerun the database/API tests and production build.
4. Fix keyboard aliasing and touch-control gaps; add regression tests and perform desktop/mobile browser playthroughs.
5. Decide leaderboard trust/abuse requirements, improve CI and dependency compatibility, and rerun all checks including animation and deployment tests.
