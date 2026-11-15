# Evidence, scope and reproduction

**Pinned game:** `coders786/Stickman-Rising@c857433b57f4a1e9fe514fddd5f190be60eed8c8`
**Target base:** `coders786/Optimization-of-Engines---Stickman-Rising@ffcb3bbcf9631371193afb1e8ab9406a1702cea0`
**Audit date:** 14 November 2026. No upstream runtime edits, commit or push.

This is evidence for the [plan](PLAN.md), **not an implementation benchmark**. [Reproduction commands](../../audit/README.md) and the [finite suite allowlist](../../audit/core-suite.json) are included.

## 1. Provenance and checkout limits

- [Original source manifest](../graphics-optimization/SOURCE-MANIFEST.json): **318** selective text references, **3,324,205 bytes**, individually SHA-256 pinned.
- [Additional mobile/QA manifest](../graphics-optimization/MOBILE-SOURCE-MANIFEST.json): **58** QA helpers, **229,931 bytes**, individually SHA-256 pinned.
- Combined verified reference set: **376 files, 3,554,136 bytes**. The downloader's `--mobile` flag restores both sets; default behavior retains the predecessor's 318-file scope.
- Local references live under ignored `audit/reference/Stickman-Rising/`. This is **not a complete Next application checkout**. Do not run `next build` there and report its missing assets/dependencies as game defects.
- Exact audit dependencies: `@napi-rs/canvas@1.1.1`, `tsx@4.23.15`, `esbuild@0.28.2`, `playwright@1.65.1`. The builder is explicitly declared, not relied on as an accidental transitive dependency. Lockfile included.
- Browser: Playwright Chromium/headless-shell build 1255, **159.0.8154.6**, Linux, launched with ANGLE SwiftShader. The diagnostic WebGL renderer identifies software rendering; it does **not** profile the Canvas2D backend or identify a physical device bottleneck.

All 376 references were hash/length checked after the probes. A separate empty-reference download also succeeded: **376 references, 3,554,136 bytes downloaded** ([clean-fetch log](../../audit/evidence-mobile/clean-fetch.log)). The evidence checker repeats the local integrity checks. Reproducible downloads require network access; the review ZIP deliberately does not redistribute the whole game/source/asset collection.

## 2. Upstream core suite

### Authoritative records

| Run | Files | Tests | Pass | Fail | Status |
|---|---:|---:|---:|---:|---|
| Node 20.20.2 after QA helpers restored | 39 | 215 | 207 | 8 | Exit 1; below app's declared runtime floor, comparative evidence only |
| **Node 22.14.0** | **39** | **215** | **207** | **8** | **Exit 1**, supported-runtime source-suite evidence |
| New finite-suite reproduction wrapper, Node 22.14.0 | 39 | 215 | 207 | 8 | Exit 1; same totals, not a speed comparison |

Canonical logs: [Node 22 TAP](../../audit/evidence-mobile/engine-tests-node22.tap), [Node 22 exact command/summary](../../audit/evidence-mobile/engine-tests-node22-summary.json), [Node 20 complete TAP](../../audit/evidence-mobile/engine-tests-complete.tap), [Node 20 complete summary](../../audit/evidence-mobile/engine-tests-complete-summary.json).

The original Node 22 run took about **16.39 seconds wall time** for the suite. This is test-run duration, **not game frame performance**. A later concurrent verification took longer with the same totals; no comparison claim is made. `scores.test.ts` and `persistence.test.ts` are excluded library/server integration suites. The full app's install/build/lint/typecheck and Bun runtime remain unverified.

An earlier 212-test run lacked `.qa` imports. Those were **audit reference omissions**, restored before the 215-test results. The incomplete `engine-tests.tap` / `engine-tests-summary.json` are superseded and excluded from the review export.

### Eight failed assertions

| Source / test | Observed assertion | Interpretation, not automatic diagnosis |
|---|---|---|
| `tests/blade-cleave.test.ts:79–83` | `axeKick`, 26-px pack, **3/5**, expected at least 4 | Contact/cleave contract requiring replay/geometry review |
| `tests/blade-cleave.test.ts:87–98` | `axeKick`, 40-px pack, **2/4** | Same family, not independent evidence of a CPU/render defect |
| `tests/blade-cleave.test.ts:112–132` | `sakugaHammer`: 60 Hz **2**, 90/120/144/240 Hz **3** first-four contacts | Direct variable-dt unit harness; not automatically display-Hz dependence in the normal fixed-step path |
| `tests/full-body.test.ts:45–65` | `l1` local head amplitude **0** | Fixed local channel does not imply the world-space head never moves |
| `tests/full-body.test.ts:125–135` | `l1` contact velocity **0 px/s** | Could be authored held contact; inspect approach and contact alignment |
| `tests/full-body.test.ts:193–217` | `l1` left elbow considered “welded” | Could be guard intent; compare approved acting/silhouette |
| `tests/ritual-idle.test.ts:8–10` | **12** ritual keys versus expected **11** | Possible stale count; later duration/gate assertions in the failed test still need execution after reconciliation |
| `tests/unarmed-step.test.ts:129–146` | credited joint **5.5 px** from body, pad **5** | Inspect exact resolved contact versus post-movement sample; do not widen tolerance blindly |

Several tests stop at the first bad move, so eight failing test cases do not constitute an exhaustive list of all attacks/defects. Conversely, a deliberately held drawing need not be “repaired” merely because a test assumes every channel must move.

Raw TAP files preserve Node's generated trailing spaces and blank lines; the narrow `.gitattributes` rule exempts only these machine logs from whitespace style checks rather than editing evidence.

The predecessor's **11/11 selected optics/shadow tests** also passed. Those tests do not exercise the later reproduced cache invalidation, pool or edge-lifetime cases; passing them does not erase those witnesses.

## 3. Actual-source witnesses

Script: [mobile-engine-probes.ts](../../audit/mobile-engine-probes.ts)
Output: [additional-source-probes.json](../../audit/evidence-mobile/additional-source-probes.json) and [log](../../audit/evidence-mobile/additional-source-probes.log).

| Witness | Executed result | Scope limitation |
|---|---|---|
| Particle acquire/expire/reacquire | Initial live 1 → expired live 0/free 1 → reused **live 0/free 0, object active** | Actual FX functions, one controlled lifecycle; proves missing live membership, not all possible pool leaks |
| Ring/trail reacquire | Same missing live-list re-registration; trail object identity reused | Actual functions; other pools have different acquire paths and must not be assumed broken |
| Fresh projectile birth | Safe NaN-history fallback renders `(30,-40)` | Explicit negative control: **do not report fresh births as the stale-history bug** |
| Recycled projectile birth | New `(100,-50)` retains finite previous `(30,-40)`; alpha .5 renders `(65,-45)`, then restores actual coordinates | Actual projectile interpolation; not a browser encounter-frequency estimate |
| Synthetic endpoint tunneling | `(-40,-45)→(60,-45)` at vx 2000 / dt .05, zero player contacts | Supported-API stress case, not claimed common game speed |
| **Actual reflected bullet speed** | Spawn vx 900, actual parry multiplier -1.6 → vx -1440; dt .05 travels `(0,-45)→(-72,-45)`, passes 11 px from `(-36,-34)` center/radius 30, **zero enemy hits** | Actual source projectile/pool with stubbed world services and chosen geometry; production step permits .05, but no frequency claim |
| Input edge lifetime | Parry press true → 8-ms zero-step render clears it → following step sees false while held remains true | Actual Game scheduler + Input with painter/governor/visual stubs. Browser confirmation below uses the actual Canvas renderer |

Probe success means it reproduced the **pinned bug**. A passing probe is not a claim the game is fixed. A later corrected implementation should get new regression assertions, preserving these historical source witnesses.

## 4. Actual Game-core browser smoke

Harness: [mobile-core.ts](../../audit/browser/mobile-core.ts), [build.mjs](../../audit/browser/build.mjs), [smoke.mjs](../../audit/browser/smoke.mjs).
Results: [JSON](../../audit/evidence-mobile/browser-core-smoke.json), [log](../../audit/evidence-mobile/browser-core-smoke.log), [landscape image](../../audit/evidence-mobile/game-core-640x360.png), [portrait image](../../audit/evidence-mobile/game-core-360x640.png).

### Configuration

- **640×360** and **360×640**, DPR 1; browser touch/mobile **emulation**, not a phone.
- Actual bundled unmodified `Game.mount`, `Game.frame`, actors/weather, renderer, HUD and audio object/lifecycle. Minimal HTML wrapper, **not Next/React**, so no real app menus/joystick/button layer.
- Seed `0x51af23d`, overridden `performance.now`, disabled automatic rAF and manually advanced timestamps.
- `quality:'high'`, governor disabled, muted, `qaMode` suppressing automatic wave generation. Eight enemies are explicitly spawned to exercise actors.
- Start uses a real Playwright button click; gameplay actions use the actual Input's virtual API, **not synthesized physical multi-touch**.
- Images are Canvas PNG diagnostic readbacks after scripted frames. Readback is outside call counters and added only in the harness. They establish drawn content, **not compositor scanout/presentation**. The production game was not given a readback.

### Results, in both viewports

Eight named checks pass per case: finite checked poses, no captured runtime errors, no-step edge-loss witness, mixed-step hitch witness, recycled-particle witness, pause-clock freeze, same-size resize, and destroy-handle cleanup.

- **Parry:** before true; at 8 ms zero steps and `pressed=false`; after another 10 ms the first `1/60` step sees false; state remains `move`.
- **250-ms hitch:** updates `[1/60,1/60,1/60,.05]`; simulation **+.100 s**; weather **+.250 s**.
- **Particle:** recycled object active, live **0**, free **0**.
- Movement sequence: player x **1454.3158288955772**, HP 100; after light-input sequence x **1503.5148028700385**, state `hurt`, HP 95. This exercises controls/combat/update but **does not prove light-attack coverage or all move transitions**.
- Pause across three manual frames preserves sim **1.2000000000000006** and storm **1.5346666666666662**. Same-size resize completes. Destroy reports audio graph/timer null, game debug handle absent and destroyed true.
- **No captured browser runtime errors.** Limited pause/resize/destroy success is not proof of resource plateau, orientation/context-loss support or every cleanup path.

### Method counts: diagnostic only

One warm landscape frame, counted across Canvas2D contexts:

| Method | Count |
|---|---:|
| `drawImage` | 173 |
| `stroke` | 782 |
| `fill` | 262 |
| `fillRect` | 78 |
| `fillText` | 17 |
| `save` / `restore` | 264 / 264 |
| `createLinearGradient` | 4 |
| `setTransform` | 5 |

These are **JavaScript API invocations**, not GPU draw calls, completed GPU work, bandwidth, elapsed time or proof that a method dominates. Portrait counts differ with viewport/culling. No recorded FPS/debug text from a manual-clock image may be cited as a performance result.

### Harness failure history

The first browser capture attempt timed out because a Playwright page screenshot waits on presentation while the harness deliberately controls rAF/time. Temporarily enabling native rAF allowed a successful earlier run but proved unreliable during a later verification. The final harness uses explicit diagnostic Canvas PNG readback instead and reran both cases successfully. These were **capture-harness failures**, not evidence of a game crash or 30-second game frame. `browser-core-smoke.json` is the final two-case, `allChecksPassed:true` record; partial timeout reports are superseded.

## 5. Isolated mathematical/reference models

Script: [mobile-reference-models.py](../../audit/mobile-reference-models.py)
Output: [reference-models.json](../../audit/evidence-mobile/reference-models.json), [log](../../audit/evidence-mobile/reference-models.log). Seed `0x2D51`.

| Model | Checked invariant | Exact result / limitation |
|---|---|---|
| Stable compaction | Survivors preserve direct backward-removal identity/order | **5,000** trials, **0** mismatches. No runtime timing/alpha-image test |
| Sequential engagement summary | Update count at each sequential transition, subtract self | **43 entities × 10,000 steps = 430,000 queries**, **0** mismatches. Not a once-per-frame stale summary or integrated AI test |
| Step-owned command envelopes | Pending commands consumed once at a simulation opportunity | **130/130** delivered, **0** duplicates at each 30/60/90/120/144/240 render Hz including .05× hitstop. Model per-render clearing misses 8/9/49/71/85/101 respectively. These are **synthetic model counts, not game loss rates**; actual accept/reject/expiry semantics are not implemented |
| Finite-support bloom ledger | Recompute dirty output support from all contributing current emission, retain unaffected old output | **250 cases, 108,000 pixels, max error 0** for a radius-2 box kernel with zero-extension. Candidate independently recomputes the dirty region. Changed-sources-only counterexample found. No GPU/filter-format/Gaussian/occlusion proof |
| Active-window crossing | An interval can cross an active window when its endpoint is outside it | `.083333→.133333` crosses `[.09,.12]`; endpoint misses, overlap detects. Does not construct swept contact geometry |

These checks falsify simple unsafe alternatives and support particular invariants. They do **not** measure production CPU/GPU speed or validate entire proposed algorithms. TECHNIQUES states additional proof obligations and rejection criteria.

## 6. Earlier graphics witnesses retained

[Source-probes JSON](../../audit/evidence/source-probes.json), [probe code](../../audit/probes.ts), [earlier experiment limits](../graphics-optimization/EXPERIMENTS.md).

- Wind coefficient-sum bound **1.292×strength**, not .85×strength; varying strength invalidates the simple scaled primitive unless the additional derivative term is handled.
- Changing only a light's RGB leaves its cached map stale; a fresh blue-light map differs from the stale red-light result.
- Reflection cache can retain moved-actor content or remain blank after reallocation. **2600 px/s × .05 s = 130 world px**, before projection; not a measured physical-pixel error bound.
- Sky cache in a stable 60-draw schedule refreshes at 0,14,28,42,56 (about **4.3 Hz**), holding embedded motion.
- Equal intended .1-s moon input gives different results with 6 versus 14 draws: about **.76307 vs .81062**.
- Duplicate damage-rectangle area can trigger a false full clear; unique physical-pixel union is needed for correct cost estimates/dirty clearing.
- **30,000** static nearest-texel SAT-kernel comparisons matched. Moving masks, bilinear filters and broad receivers were not proved.
- Rolled camera mismatch about **18.779 px** in the controlled projection example.
- The predecessor background image uses `@napi-rs/canvas` at 1280×720 and is **background-only**, not the later Chromium gameplay image.

Do not transfer historical standalone SwiftShader timing claims to phone FPS. The historical village candidate was **14.4% slower** in its qualified test and remains unpromoted; it is not the planned mountain scene. Full numbers/conditions remain in the archived work and predecessor documentation.

## 7. Required future evidence

| Gate | Missing today |
|---|---|
| Complete application | Supported-toolchain production install/build, real Next/React UI, persistence/scores integration |
| Mobile interaction | Physical pointer/multi-touch ownership, lost capture, notches/browser chrome, end-to-end touch-to-photon |
| Hardware performance | Natural rAF/device pacing, real CPU/GPU traces, quality-locked paired candidates |
| Resource sustainability | Whole-process/browser memory observations, repeated generation plateau, context loss and 20-minute thermal runs |
| Visual acceptance | New art/material vertical slice, motion/contact comparisons and user/artist acceptance |
| Optimization result | Correct integrated candidate faster than a simple correct control at the same accepted quality |

Until those gates pass, the defensible result is **identified weaknesses + tested limited invariants + a concrete implementation plan**, not a completed optimization or promised studio-equivalent renderer.
