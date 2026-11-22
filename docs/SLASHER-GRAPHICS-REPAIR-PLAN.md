# Stickman Rising: graphics repair without losing the slasher

**Status:** 1,000-line implementation plan; see the [implementation checkpoint](SLASHER-GRAPHICS-REPAIR-STATUS.md) for what has landed in the working tree, what was measured, and which gates remain open.
**Scope:** address the 13 resource/pacing risks and eight visual risks from the expanded audit on the current warm-lit Canvas 2D renderer.
**First changes:** measure the warm-lit build, fix vignette ownership, then free the city canvases the game never draws. This should improve stability without redesigning a single slash.
**Decision rule:** fix reproduced defects. For a cost suspected from code, isolate it first; if an alternative does not win on the intended device, record the result and keep the proven path.

## Read this plan in order

- [The slasher contract](#the-slasher-contract) establishes what quality is never allowed to trade away.
- [Audit coverage](#audit-coverage) maps every finding to concrete tasks; R = resource/pacing, V = visual.
- [When and who](#when-and-who) gives the dependency order and review gates, not unconfirmed ship dates.
- [Implementation tickets](#implementation-tickets) answer Who, What, When, Where and Why, then give the How, tests and fallback.
- [Release playbook](#release-playbook) specifies reproducible comparisons and the go/no-go criteria.
- Start from this working tree, not the cooler base: [warm road/sign repair](lighting/road-and-sign-stability.md) is already in it.
- The [older Ultra audit](ULTRA-GRAPHICS-AUDIT.md) is useful history; its old plate inventory is not the current implementation.

## What we actually know

- **Reproduced:** resize creates additional pinned cinematic vignettes; a same-size reseed can leave the current vignette at 0×0 until resize.
- **Counted, not timed:** six original/intermediate distant-city canvases total about 22.8 MiB of RGBA backing, not counting the small drawable plates.
- **Counted, not timed:** a grounded Ultra fighter in range of a practical can issue 5 moon + 3 practical cast fills, before contact and other passes.
- **Read in code:** the capture mirror samples the scene; Ultra capture adds another scene sample for optics. Neither `drawImage` is proof of a CPU readback.
- **Read in code:** WebGL `readPixels` does occur while baking sky art. The bake can block Engage/retry; it is not the steady-state compositor.
- **Previously checked:** both optics routes kept the repaired warmth through controlled tier/DPR and weather transitions; those were not device FPS runs.
- **Unknown until measured:** the share of CPU submission, raster/composite, display cadence, allocation and bake latency on each device.

## The slasher contract

1. **Keep the rhythm:** anticipation → release → contact → recoil/recovery. No edits to hitboxes, animation event times, hitstop, combo windows, motion or input buffering as a graphics shortcut.
2. **Keep the weight:** the stance, planted shoe and its contact shadow travel together. A jump sheds contact naturally; the road does not follow the fighter into the air.
3. **Keep the edge:** the live head, hands, weapon and leading foot must read first. The enemy's tell and the charged/parry/execute states must still identify the threat or opportunity.
4. **Keep the hit:** retain authored weapon trails, a legible point of contact, directional recoil and the enabled feedback settings. Less repeat glow is not less impact.
5. **Keep the bridge:** cool steel, warm air behind it, anchored pools and road sheen, readable asphalt paint, deep city, living weather. Low is the same place, not a blackout.
6. **Keep the options:** preserve player choices for shake, gore and particles; retain meaning with decoration off, sound muted and motion/flash reduced.
7. **Cut optional work first:** idle redraws, unused textures, offscreen cosmetics, duplicate echoes/fills, non-emitter bloom, extra weather overdraw; compare scene scale against those wins.
8. **Never trade input for frames:** fixed 1/60 s steps and interpolation stay; compare combat event ticks as well as pixels. A render-only cap cannot cap enemies or collision.
9. **A better still isn't enough:** accept changes in motion with a real player and a reviewer who can identify the next threat at native size and in grayscale.

## Layer ownership to preserve

| Coordinate space / phase | Owns this | Must not take over |
| --- | --- | --- |
| Sky/celestial parallax | Opaque sky, moon, distant clouds and strata | World-space shadows, rail, or fighter tracking |
| Live mid/near parallax | Façades, current-camera signs, lower city and steady airlight | A cached sign that jumps every refresh or fog painted over the deck |
| Rolled world camera | Asphalt, structural steel, props, receivers, posed fighters, projected shadows and gameplay world FX | The sky's attenuated shake transform or screen-space HUD |
| Local or capture optics | Optional material reflections and emitter scatter | Base illumination or the only source of a combat cue |
| Weather / feedback overlays | Rain by depth, bounded weather flash, authored hit feedback | A flat strip through a rolled deck or a captured screen flash |
| HUD / DOM | Readable status, controls and accessibility; outside scene grading | Scene DPR or an effect that delays a touch/input edge |

## Audit coverage

| ID | Audit finding to counter | Ticket(s) |
| --- | --- | --- |
| R01 | Resize-driven vignette growth and stale released reference | T02, T04 |
| R02 | Full-sized original and intermediate distant-city surfaces stay pinned, even at Low | T03 |
| R03 | Pin/resize cap exceptions and surfaces with unclear lifetime | T04, T05, T14, T15 |
| R04 | Crowd contact/cast/mirror work, light probes and potentially expensive brush misses | T07, T08, T11 |
| R05 | Fast enemy ghosts and pose solves/repaints for player dash echoes | T09 |
| R06 | Repeated horizontal visibility checks; offscreen effects, projectiles and props | T07, T10 |
| R07 | Capture mirror and extra Ultra post sampling; route costs unmeasured on hardware | T01, T12, T13 |
| R08 | Quadratic scene DPR cost, retina HUD redraw and touch backdrop effects | T14, T15, T16 |
| R09 | Sky cache still blits a viewport on hits and can rebuild during motion | T05 |
| R10 | Invisible rain paths, excess update/project work and unused storm channel geometry | T18, T19 |
| R11 | Synchronous Engage/retry bakes, including GPU-to-CPU sky transfer | T06 |
| R12 | Paused scene still submits full frames | T17 |
| R13 | Device/pointer guess, two competing quality levers, and misleading perf/capability receipts | T01, T23, T24 |
| V01 | Corner treatment vanishes or changes incorrectly on reseed | T02 |
| V02 | Repeating skyline/floors and similarly soft distant art across tiers | T03, T05, T20 |
| V03 | Inconsistent mirror vocabulary and doubled baked/dynamic prop reflections | T12 |
| V04 | Glow and simultaneous fast FX bury silhouettes, weapon and contact | T08–T11, T13, T21 |
| V05 | Screen-horizontal rain cutoff disagrees with rolled world splashes; too much veil | T18, T19 |
| V06 | Flash-only storm feedback with unused bolt/fork data | T19, T22 |
| V07 | Misleading tier copy/adaptive state, especially on hybrids; degraded HUD clarity risk | T14–T16, T23, T24 |
| V08 | Risk of losing the warm bridge, lighting continuity or legible cues across route/tier changes | T02, T12, T13, T21–T24 |

## When and who

| Gate | When it begins | Lead at the gate | What must be true to exit |
| --- | --- | --- | --- |
| M0 — Matched baseline | Before changing a hot path | Performance QA + renderer lead | Fixed-route replay, warm/cold receipts, locked settings, feel references and known failures recorded (T01) |
| M1 — Correctness and lifetime | Repro fixtures exist; T02 and T03 do not wait on hardware FPS | Render resource owner | Bounded viewport/city surfaces, clean replay/teardown, and a responsive warm path (T02–T06; treat speculative cache choices separately) |
| M2 — Combat frames and pixel cost | Replay fixtures and M1 ownership landed | Renderer + animation leads | Shadows, echo, FX and copy experiments accepted independently; no lost cue; scene and UI costs measured (T07–T17) |
| M3 — Weather and look | Protected route and combat references are signed off | Art + accessibility leads | Rain follows depth, city reads, and the action still wins on dark/bright screens and reduced motion (T18–T22) |
| M4 — Adaptive defaults and release | Individual costs and cues are known | App/perf leads + release QA | Policy tests, real hardware evidence for claims, stable tiers, release and reversal instructions (T23–T24) |

### Operating agreement
- Owner names below are roles to assign, not assumed team members. One accountable implementer per ticket; named approvers go in the change record.
- P0 = correct a reproduced regression or establish the measuring baseline; P1 = measured repair before general rollout; P2 = polish or optional experiment.
- Implement one verifiable behavior at a time; parallel work can prepare fixtures, but don't combine art changes, timer changes and raster changes in one A/B.
- The previous gate was 449/454 with the same five pre-existing failures as the base; compare named failures, not just totals. Do not alter combat to make this plan pass.
- Keep confirmed fixes independent of tuning flags so reverting an experiment cannot reintroduce a leak or a missing plate.
- While the renderer baseline is locked, animation QA can prepare cue clips and UI QA can prepare the touch/keyboard matrix.
- After M1, fixed-tier crowd and camera tests can proceed in parallel; merge one compositor change at a time against the same reference.
- If supported hardware is unavailable, finish correctness gates and mark the performance gate pending, not passed by emulation.
- When schedules are tight, ship lifecycle and visibility corrections first; defer optional weather art and new material detail before cutting a core cue.
- Status for all tickets today: planned. The warm-light regression is the control, not an unfinished ticket to solve again.

## Implementation tickets

### T01: Instrument the real frame

- **Who:** Performance QA owns the capture harness; the renderer lead approves timing boundaries.
  - Combat QA owns replays and tick receipts; art QA approves the warm-lit control clips before optimization.
- **What:** Produce a reproducible before/after record for frame pacing, render work, memory and startup as separate measurements.
  - Log CSS size, actual backing sizes, refresh evidence, seed/profile, camera trace, enemy counts, weather, tier ceiling/effective tier, optics route, and setting flags.
  - Include JS update/submit scopes, frame intervals, visible hitches and intentional gaps; distinguish simulation backlog from drawing load.
- **When:** M0, P0; collect the fixed-route baseline before profiling or altering quality knobs.
  - Recover the exact viewport/seed inputs for the vignette probe now; repeat the full benchmark for every cost change proposed for rollout.
- **Where:** `src/game/game.ts` (`loop`, `frame`), `src/game/render/{frameLog,renderer,ledger}.ts` and dev-only code under `src/game/debug/`.
  - Extend `.qa/desktop-pacing.mjs` for browser runs; use `scripts/capture-ultra.ts` for matched art, not display performance.
- **Why:** An idle average can hide a hitch on contact, and a resize stall can be mistaken for a permanently slow GPU.
  - One unlabelled screenshot cannot tell us whether the route, camera, weather or an automatic shed caused a change.
- **How (implementation order):**
  1. Archive the warm-lit source state and a small reference manifest, including base revision and patch identity; collect existing regression results separately.
  2. Add a QA-only replay with fixed seed/history, camera script, semantic inputs by sim tick, expected event log and explicit weather/FX state.
  3. Add a QA lock for tier, route and actual scene scale; bypass both adaptive branches including the cliff path in this mode, and assert the lock held in the run.
  4. Mark world update, bake, sky, deck, actors, mirrors, post, weather and HUD using opt-in timers; count draws/bytes in normal-sized integer counters.
  5. Use a bounded in-memory capture for real frame deltas; compute percentiles after the window, not by allocating or appending JSON on every frame.
  6. Record known visibility, resize and startup events separately; keep >250 ms stalls while visible in the raw run even if the current `FrameLog` treats them as gaps.
  7. For diagnosis, save a browser trace with raster/compositor/long-task tracks where supported; `wait` is unattributed time, not GPU duration.
  8. Report separately: software draw, browser rAF cadence, actual presented intervals if available, and physical device/user-play evidence.
- **Verify:**
  - Run two unchanged builds with the same replay and seed; compare expected event ticks, cue captures, counts and outputs before trusting candidate results.
  - Inject a foreground stall and a hidden-tab gap; both must be reported but only the former belongs in visible frame statistics.
  - Switch route at a fixed common DPR and confirm the two capture counters change without moving the camera or changing the weather state.
  - Check a low-resolution, simulation-bound sample does not become labeled "GPU-bound" simply because an idle wait estimate is large.
  - Repeat one run with instrumentation disabled; keep trace collection and screenshots out of the timing samples used for release.
- **Keep:** Existing 60 Hz sim and input edge ownership; QA switches must not change saved settings or become public menu features.
- **Budget:** Default play should incur no new trace objects/readbacks or per-frame allocation from this instrumentation.
- **Reject if:** Multiple runs with the same setup disagree on their workload, locks or timing windows, or if the instrumentation itself misses deadlines.
- **Rollback:** Disable diagnostic sampling and remove only the intrusive instrumentation; keep the deterministic fixtures and comparison manifest.
- **Evidence to attach:** Baseline data, trace labels and definitions, baseline variance, and the exact invocation for the comparison.
- **Exit:** Each later ticket can show its cost and appearance against the same, named control and reproduce the numbers.

### T02: Fix the disappearing and accumulating vignette

- **Who:** Background renderer owner implements; resource QA and a visual reviewer sign off.
  - UI QA verifies that the separate low-health overlay is neither removed nor mistaken for the cinematic plate.
- **What:** Keep exactly one live cinematic vignette per active scene owner and repaint it when its recipe or CSS viewport changes.
  - Current repro: 1280×720 → 1360×760 → 1400×780 → 1280×720 produced 48 → 49 → 50 → 51 tracked surfaces.
  - Native ledger estimate grew from 44.35 to 55.98 MiB over that sequence; seed 43 at the same size then left a 0×0 vignette until resize.
- **When:** M1, first P0 source change after the repro is encoded; independent of DPR tuning and city restyling.
  - Keep the first fix pixel-preserving; reconsider plate resolution only after the leak and same-size reseed are verified.
- **Where:** `src/game/world/background.ts`: `buildVignettePlate`, `drawWeather`, `setRunSeed`/`ensureBuilt`; `src/game/render/ledger.ts`.
  - It is a CSS-space weather-pass mask, after scene optics, not part of a seeded city's collection of textures or `HUD.drawLowHpVignette`.
- **Why:** Each old pinned viewport-sized allocation costs memory while doing nothing; losing the corners makes a retry look like a different grade.
  - We want the same clear center and soft warm edge, not harder black corners that hide an incoming enemy.
- **How (implementation order):**
  1. Add a scoped stable key for the plate and paint into a supplied context rather than calling the world generation's `next` allocator.
  2. Key its content by CSS dimensions and the effective vignette recipe/grade strength; invalidate on same-size seed or scene replacement when that recipe can change.
  3. Check both the content stamp and `hasPixels`; a live JS reference is not proof the underlying canvas still exists.
  4. Reacquire or resize the one key at the next viewport/recipe boundary, reset context state, clear alpha and repaint both gradients before publishing the stamp.
  5. Keep exact CSS-space projection and gradient stops in the first patch; a backing DPR-only change does not require new art for the same CSS size.
  6. Make a no-op resize a no-op and release only this owner's key on scene teardown; do not bulk-release another mounted owner's assets.
  7. Keep compositing order and restore alpha/blend state; do not move the vignette over the HUD or into a reflection capture.
  8. If initialization fails, skip only the optional mask and retry at a controlled boundary with diagnostics, not by throwing in every frame.
- **Verify:**
  - Repeat the recorded seed-42→43 repro using `BRIDGE_ART`, then test 20 orient/resize cycles and 20 same-size retries; count this key by owner.
  - After returning to 1280×720, the vignette allocation returns to its original size/count; compare total bytes with the same seed and enabled passes.
  - Right after reseed, a nonzero mask renders on the first eligible frame; center and corner samples match a fresh instance of that recipe.
  - Change seed without resize, change CSS size without seed, and change only scene DPR; verify the distinct invalidation behavior of each.
  - Add a native fixture alongside `tests/layer-seams.test.ts` plus browser landscape/portrait screenshots at high health and low health.
- **Keep:** The same warm lower-city contribution, transparent center, original falloff and separate damage warning.
- **Budget:** One tracked plate per active owner, no growth on repeated same-size draws, no new render-pass blit.
- **Reject if:** `hasPixels` merely hides the defect, the mask still disappears for a frame, or memory grows monotonically as common sizes repeat.
- **Rollback:** Retain stable ownership and invalidation; revert only a follow-up downscale or artistic adjustment if it bands or dims threats.
- **Evidence to attach:** Before/after ledger table and corner/center pixels captured before and immediately after the same-size reseed.
- **Exit:** A retry or rotation never accumulates old masks and never requires a second resize to restore the corners.

### T03: Free the art that is never sampled

- **Who:** City baker owner makes the lifetime change; look development reviews the softened strata.
  - Resource QA reconciles the exact keys with the output of `gameLedger.list()` and checks cold peak as well as steady bytes.
- **What:** Retain the small softened deep/far/mid outputs and the crisp near tile; make full-size sources and wrap-blur intermediates transient.
  - Today `buildDeep`, `buildFar`, and `buildMid` each create two 2048-wide full-size canvases at heights 420/480/560.
  - Those six surfaces account for ~22.8 MiB RGBA alone; `drawCityBand` samples their smaller products, not those sources.
- **When:** M1, P0 for redundant ownership after T02's repro work; no wait for the later skyline redesign.
  - Close the retention ticket before experimenting with direct small bakes or sharpening any band in T20.
- **Where:** `src/game/world/background.ts`: `makeCanvas`, `buildDeep`/`buildFar`/`buildMid`, `blurTile`, `ensureBuilt`.
  - Hook scoped scratch ownership in `src/game/render/ledger.ts`; `src/game/stage/viaduct.ts` still owns its separate district/road data.
- **Why:** Pinning two unusable tiers of texture data per band makes low-memory devices pay for art they don't see, even in Low.
  - Fewer retained sources can leave room for reliable gameplay and portrait resizes without making the city flatter.
- **How (implementation order):**
  1. Trace every source consumer, including debug/export and the live building animation records; list final versus scratch allocations by name.
  2. Give the builder a bake-only scratch factory plus a final-surface factory; remove retained fields for the unused `deepTile`/`farTile`/`midTile` sources.
  3. For one band at a time, paint original → blur with left/right wraps → prefilter downscale → feather base into the final tile.
  4. Keep the Canvas filter, smoothing, blend state and seed iteration order equivalent for the first pass; no visual redesign hidden in a memory patch.
  5. Release the original and blur intermediate after their last draw into the final plate, including when a fallback or exception aborts the bake.
  6. If browser traces show that two scratch allocations need reuse, use a bounded bake pool with exact content bounds and reset state between bands.
  7. Publish final tiles and sorted animation records together; avoid caching a `CanvasPattern` or closure backed by a released scratch canvas.
  8. Measure the end of warm and the highest transient peak; adopt direct low-resolution baking only as a separate pixel- and cost-reviewed experiment.
- **Verify:**
  - List the six old keys and show their absence from the steady set; hold seed, rain, viewport and tier constant for the comparison.
  - Compare native same-backend pre/post pixels around wrap, base fade and near/district overlap; check Chromium and WebKit where available.
  - Pan through the join at fractional zoom and DPR; the small tile's first/last columns and live animation phases must still agree.
  - Warm several seeds at the same viewport; fail if any final draw reads a zero-sized source or a canceled build retains scratch.
  - Recheck `tests/layer-seams.test.ts`, `tests/world-lights.test.ts` and the same clear/haze/drizzle clips at Low and Ultra.
- **Keep:** Current city composition, opaque horizon, warm light, live near signs and crisp action plane.
- **Budget:** Initial target: remove at least 20 MiB of baseline retained city backing in the matched ledger fixture, not a promised GPU-memory saving.
- **Reject if:** The result trades resident bytes for a larger transient peak, new bake hitch, visible edge or weaker silhouette separation.
- **Rollback:** Keep explicit temporary lifetimes; retain the original two-step filter recipe rather than forcing an art simplification.
- **Evidence to attach:** Per-band active/scratch byte and duration table, and matched stills at both the horizontal and vertical joins.
- **Exit:** Only drawable products or explicitly justified reusable scratch remain, with no steady dependence on the released originals.

### T04: Make surface ownership and caps enforceable

- **Who:** `CanvasLedger` maintainer owns API changes; renderer, HUD and GPU-bake owners migrate their own keys.
  - QA signs off mount/destroy and replacement lifetimes before the scheduler or governor starts resizing more intelligently.
- **What:** Report and respect separate resident, scratch and viewport budgets; make intentional pinned overflow visible instead of silently promising a hard cap.
  - `acquire` currently enforces only on new entries with raw incoming byte estimates; a growing hit updates bytes without an admission check.
  - Live pinned plates cannot be ordinary LRU victims because existing consumers still hold their canvas objects.
- **When:** M1, P1 after T02/T03 establish the minimum needed working set; before T05/T06 move cache/bake ownership.
  - Migrate one class of surfaces per change and keep the canvas-creation boundary check green relative to its baseline.
- **Where:** `src/game/render/ledger.ts` (`bytesFor`, `acquire`, `release`, `SurfaceGen`), `src/game/game.ts` (`destroy`, scene replacement).
  - Inventory caches in `render/{bhst,post,hud}.ts`, `world/{background,night}.ts`, and the separately sized scene/HUD DOM canvases.
- **Why:** Untracked cost or eviction of a live plate both look like mysterious frame failures instead of an owner missing a budget.
  - A maintenance fix must not leave the player fighting over black tiles or crash on `drawImage(0×0)`.
- **How (implementation order):**
  1. Add owner, lifetime, pin/scratch class, old/new size and allocation/release counters to the diagnostic inventory; name who may dispose each key.
  2. Count page-rounded incoming bytes and resize deltas; exclude the entry being resized from eviction and account for real replacement peaks separately.
  3. Define admission for an optional claim: reuse, shrink or decline with a valid fallback when soft limits cannot be met; test the new path before using it.
  4. Preserve required plates; when all victims are pinned, surface a reason and budget delta rather than keeping an undocumented "hard" cap promise.
  5. Scope keys or injected ledgers by instance/generation so a new scene construction cannot accidentally zero another active owner's surfaces.
  6. Separate retained bake outputs and short-lived scratch; publish complete bundles so a released plate is never still the live source for that frame.
  7. Centralize viewport-owned resize/dispose and retire inactive optional optics safely after a measured dwell, not with a reallocation on every tier bounce.
  8. Dispose in `destroy`/replacement and cancellation paths; use owner-specific release, not global `releaseAll()` during a live scene swap.
- **Verify:**
  - Extend `tests/{ledger-gen,perf-core}.test.ts` for growing hits, rounded size deltas, no-op hits, pin overflow, and owner isolation.
  - Simulate optional admission failure and invalidated references; essential layers remain visible and `drawImage` never receives 0×0.
  - Mount/destroy/remount and reseed over repeated portrait/landscape changes; compare tags/counts with the active owner set.
  - Distinguish width/height RGBA estimates from image decode/GPU context memory in every report; account for the two visible outputs separately.
  - Check a transient high tier, a long Low session, and a return to High with controlled memory pressure; require no sawtooth churn from retire/reacquire.
- **Keep:** Guarded blits, required road/sky/actor inputs and cheap warm frames with no repeated ownership lookups that allocate.
- **Budget:** Start with the documented 48-surface/48 MiB ledger references; revise by measured device class instead of inflating the caps to hide growth.
- **Reject if:** Accounting changes alone report a win, eviction makes backgrounds intermittently blank, or scratch accumulates across failed bakes.
- **Rollback:** Disable experimental admission/retirement policy while keeping owner-scoped disposal and accurate counters.
- **Evidence to attach:** Tagged steady/peak snapshots, budget-overflow reasons and a teardown/replacement lifecycle trace.
- **Exit:** A reviewer can point to every retained backing store, its reason to exist and exactly when it gets released.

### T05: Make the sky cache earn its viewport blit

- **Who:** Background renderer owner leads; camera and art QA judge motion at non-integer zoom and scale.
  - Performance QA compares costs of a cache hit, miss and direct/composite alternative, not just the reported hit rate.
- **What:** Account for the cached full-destination blit even on hits and reduce unnecessary rebuilds during pans and zooms.
  - The CSS-resolution source still copies into the actual scene backing; in motion the camera/time/quality dirty criteria can repay little.
  - The cache type supports storm invalidation, but today's `drawSky` call supplies `0, false`; confirm any new flash input before blaming it for misses.
- **When:** M1, P1 after lifetime work; conduct the policy experiment with M0 measurements before changing the cache's visual cadence.
  - First migrate the viewport buffer to explicit ownership and shrink the pure vertical pollution gradient without changing the look.
- **Where:** `src/game/render/bhst.ts` (`SkyVaultCache`), `src/game/world/background.ts` (`drawSky`, `poll:plate`).
  - Only the distant sky/deep/far cache qualifies; mid/near signs, the current world view and flashes keep their separate placement.
- **Why:** A faster cached idle sky is not a win if panning triggers costly recomposites or makes the moon, signs and reflected highlights disagree.
  - Distance should look soft by design, not vibrate when a runner dashes or approaches the edge of the span.
- **How (implementation order):**
  1. Count hit/miss reason, cache pixels, copied destination pixels and actual timings for fixed idle, pan, snap, portrait and zoom sequences.
  2. Give the CSS-sized cache one reuse/dispose rule; preserve opaque backing, and preserve the destination transform built from the rounded canvas size.
  3. Replace the full-width palette pollution gradient source with a narrow strip after verifying that each original column really matches.
  4. Compare existing composite vs direct dark/sky/strata blits and a small cached distant base with moving elements re-seated on the current camera.
  5. In a candidate, split true dirty reasons (seed/recipe/viewport) from motion and time; don't invalidate for a tier change that affects no cached pixels.
  6. If using quantized coherence, derive the maximum visible displacement from actual parallax, not a fixed 20 Hz timer for everything.
  7. Keep the displayed moon position and consumers such as glitter/ray sources in sync with the pixels actually drawn; never cache near sign motion again.
  8. Test bounds when overscan or cropping is proposed; replace/release the cache only at boundaries, and keep the simplest route that meets the time/feel gates.
- **Verify:**
  - Compare cache, direct and candidate at equal DPR/route with paired pans and idle samples; record misses by reason and p95/p99 for each.
  - Use `tests/layer-seams.test.ts` near-sign tracking and fractional horizon coverage during resize, wrap and both world roll signs.
  - Observe a continuous moon-glint path, current-camera near signage, and no post pulse when weather or tier changes.
  - Confirm no missing opaque row when a viewport-sized plate changes size; test wide, tall and small clipped views.
  - Run capture and browser tests; the software renderer can check pixel math but cannot justify a Chrome or Safari cache policy by itself.
- **Keep:** A coherent moon/sky, live mid/near signs, feathered skyline base and preserved warm airlight behind the world.
- **Budget:** One bounded sky backing when cached; no per-pan resize or new full-scene post pass to hide cache movement.
- **Reject if:** Higher hit rate produces visible stepping, slow pans are worse, or hit+miss work exceeds direct drawing in the target scenario.
- **Rollback:** Keep the explicit lifetime and small strip; restore the prior cache policy or use direct drawing for the measured route if cheaper.
- **Evidence to attach:** Hit/miss histogram with zoom/pan displacement, source/destination sizes, plus a moon and sign tracking clip.
- **Exit:** The cache is a measured cheap representation, not a mandatory copy that we keep because it is called an optimization.

### T06: Stop Engage and Retry from blocking on the night bake

- **Who:** Game lifecycle owner implements readiness; GPU-bake owner instruments both WebGL and CPU fallbacks.
  - UI QA verifies input and loading feedback; combat QA counts first playable input and confirms no stale start edges.
- **What:** Separate request, prepare, publish and activate so the click responds immediately and the first playable frame owns a complete scene.
  - `startRun` still calls `bg.warm()` synchronously; moving work from the first frame into the click did not make it asynchronous.
  - Measure seed/profile, city/district/road, GL setup/compile/`readPixels`, fallback paint, and first-use upload/draw individually.
- **When:** M1, P1 after scratch lifetime and baseline cold timings; pick the cheapest remedy proven by Engage/retry traces.
  - Do not combine scheduling changes with art changes, sampler changes or new WebGL requirements.
- **Where:** `src/game/game.ts` (`startRun`, retry/quit/phase/input), `src/game/world/{background,night}.ts`, `src/gpu/{context,sky}.ts`.
  - `src/app/page.tsx` owns immediate visible and announced readiness feedback; none of this runs in an active combat frame.
- **Why:** A button that freezes the menu or seems to eat the first command feels less responsive even if the match later runs smoothly.
  - Deterministic art and weather identity should still match the requested run rather than the last menu or canceled seed.
- **How (implementation order):**
  1. Instrument click → first menu acknowledgement → critical layers ready → first playable presentation/input; record cold and repeated retry separately.
  2. Keep gesture-dependent audio unlock on the accepted gesture; use a pending/preparing UI state and paint it before deferrable bake work.
  3. Prepare immutable inputs for one pending run (seed, history-derived profile and grade); reuse prepared work only if that exact request is used.
  4. After measuring, reuse compatible static assets and schedule sequential bake units in safe menu/transition time with cancellation and a non-idle fallback.
  5. Never assume a single `readPixels` or Canvas paint can be preempted; compare CPU bake, reuse and GPU bake on the device before choosing a fallback.
  6. Use a request token and owner-specific disposal; cancel on superseding retry, scene change or unmount and discard late completions.
  7. Swap the minimum coherent sky/deck/lighting/actor prerequisites together; keep the old menu frame or a complete light fallback until the new bundle is ready.
  8. Enter play and enable input once, reset timing windows, then add only approved nonessential detail at a safe boundary if it fits memory and pacing.
- **Verify:**
  - Cold start, warmed retry, rapid double-click, quit while preparing, replace scene and tab away mid-bake; enforce one activation and one loop.
  - Force WebGL unavailable/lost; Canvas fallback supplies valid moon/stars and the same warm deck before the first fight.
  - Compare cold and warm time-to-input, longest foreground task and peak bytes with the same seeds and platform; no smoothing away a big stall.
  - Send the first legal movement/attack on entering play; confirm it is handled once while menu/old-run edges remain discarded.
  - Re-run `tests/{layer-seams,input-edge-ownership,profile-consumption}.test.ts` and capture the first visible frame after Engage and Retry.
- **Keep:** Instant feedback, existing audio permission behavior, seed/profile identity, current moon phase and uninterrupted action once playing.
- **Budget:** Trial ≤8 ms for splittable menu bake units and no new >50 ms foreground task; record any unavoidable atomic cost and justify the fallback on hardware.
- **Reject if:** It only moves the stall to the first swing, holds two unbounded pinned cities, or exposes a half-finished cold/opaque scene.
- **Rollback:** Use a measured synchronous fallback only after the preparation screen is visible; retain cancellation, timing and valid resource ownership.
- **Evidence to attach:** Cold and retry timelines, GPU/CPU labels, cancellation trace and before/after peak inventory.
- **Exit:** Players can see that Engage was accepted, and no published play frame silently waits for a critical plate.

### T07: Build one conservative visibility plan per frame

- **Who:** World renderer owner implements; combat QA owns the edge-of-screen threat cases.
  - The FX and lighting owners define each drawable's largest extent; they do not edit its simulation activation rules.
- **What:** Replace repeated enemy checks with one reusable visible-work list and coverage flags for body, shadow, echo, mirror and cue.
  - `Renderer.draw` checks enemies for grounding and then for body drawing; current broad horizontal margins ignore vertical bounds and can count a skipped enemy twice.
  - A body outside frame can still cast into it, trail into it, or own an intentionally onscreen warning; classify the layer, not just the root x.
- **When:** M2, P1 after T01 counts the duplicate work; land before shadow/echo budgets so their counters have common inputs.
  - Start with a single list at equivalent generous bounds, then tighten only where the edge tests pass.
- **Where:** `src/game/render/renderer.ts`, `src/game/core/camera.ts`, `src/game/{entities,world/props.ts}` and their draw-only interfaces.
  - Derive bounds from the same rolled, zoomed camera and draw/interpolated positions used after `installRenderLerp`, never the unshaken sky camera.
- **Why:** Skipping invisible raster work and duplicate checks buys time without deleting enemies or turning off their animation.
  - A missing blade tip or an offscreen blow with no warning is worse than a conservative extra draw near the edge.
- **How (implementation order):**
  1. Build view data once from inverse-projected CSS viewport corners; retain a conservative world AABB and clip bounds for specialized layers.
  2. Reuse scratch arrays or bit flags from frame to frame; append visible entries in original paint order, with no per-frame sort or allocations.
  3. Compute bounds for pose/extending weapon and pose-derived warning, projected shadow, and reflected/trailing footprints separately.
  4. Inflate bounds for interpolation, stroke width, smear length and camera shake; prefer false positives over a clipped active telegraph.
  5. Exclude dead/spawning body work as today; keep any intentionally visible spawn or attack indicator on its own contract and list.
  6. Pass the plan to grounding and body draws; a shadow-only or mirror-only actor can still supply geometry without painting the opaque body.
  7. Adopt the same contract for props and read-only projectile paint in separate changes; do not cull their updates, collision or spawn effects.
  8. Replace inflated skip counts with unique considered/visible body counts plus layer-specific rejects and a debug envelope overlay.
- **Verify:**
  - Test a sword tip, projectile tail, extended cast shadow, echo and telegraph with roots just outside each screen edge.
  - Exercise portrait, both roll signs, fast snap/shake/zoom and fractionally interpolated motion; compare to a render-only no-cull reference.
  - Count actor/proxy decisions once per frame; prove order is unchanged for overlapping visible bodies and all relevant cue draws.
  - Check fixtures with zero, one and a heavy crowd; replay sim ticks, hit events and score must match the no-cull control.
  - Profile the cost of bounds and visibility on the small and crowded scenes; reject a clever list that costs more than it saves.
- **Keep:** Live attack timing, overlap order, projectile semantics and any edge-direction warnings; do not rewrite the horde scheduler.
- **Budget:** One pass over enemy references for visibility; constant-size math per candidate and no scratch growth once warmed to the supported crowd.
- **Reject if:** A part that reaches into frame disappears or a hidden pose/render-state side effect changes gameplay when its draw is skipped.
- **Rollback:** Keep single-pass bookkeeping; widen the suspect layer's bounds or opt that layer out rather than culling gameplay.
- **Evidence to attach:** Coverage comparison frames, unique cull counters and an event log comparison with the uncropped replay.
- **Exit:** We stop spending repeated work on the invisible crowd without making entrants or attacks pop at the frame boundary.

### T08: Keep foot contact and simplify crowd shadows

**Delivered:** [Shadow Footprint](SHADOW-FOOTPRINT.md) replaces the pass stacks
with a single graded silhouette and pose-driven sole contact. The baseline
and alternatives below record the original plan.

- **Who:** Lighting renderer owner reduces cast work; combat animation QA protects readable stance and silhouette.
  - Art reviews signature moon and amber projections; performance QA records fill counts and projected pixel area.
- **What:** Keep contact and ankle anchoring, then reduce redundant penumbra fills and far/overlapping secondary casts.
  - At Ultra one grounded actor can issue five moon and three practical fills, plus separate AO, probes, and the forward mirror where enabled.
  - Cost depends on number and coverage of casts, not just a tier table's per-actor maximum.
- **When:** M2, P1 after T07 and before we compare lower scene resolution as a crowd remedy.
  - Land path reuse and invisible-receiver pruning before trying an appearance change to softness or secondary cast admission.
- **Where:** `src/game/render/{renderer,shadows,graphics}.ts`; practical/key inputs from `src/game/{lighting/ribbons,world/light}.ts`.
  - Use posed draw geometry and actual asphalt/world camera. Prop shadows in `src/game/world/props.ts` need their own bounds and counters.
- **Why:** A fighter floats without foot contact, while four nearly identical soft edges under every background enemy buy little readability.
  - The hero's amber pool and a threat's lean must still communicate direction, height and weight.
- **How (implementation order):**
  1. Record AO, shadow-outline builds, cast fills by source, receiver coverage, prop blits and hero/enemy contributions for the same crowd replay.
  2. Cull empty receiver intersections and zero-alpha casts before constructing paths; reuse the current pose's silhouette for moon, practical and mirror.
  3. Preserve shoe AO and pelvis/air-height fade, including facing and yaw changes; don't replace them with a darker whole-lane gradient.
  4. Try one fewer soft fringe for ordinary casters and a compact soft footprint for low-salience far bodies; match grounded core intensity first.
  5. Reserve full authored treatment for hero and important nearby threats. Use stable priority bands with dwell/fade for optional secondary casts under load.
  6. Clip casts to the receiver as appropriate; preserve shear away from each light, limit opaque overlap near contact and avoid stacking shadows on the front fascia.
  7. Keep plan data independent of sim/pose ordering; update silhouette stamps when the draw pose changes, not just on actor root movement.
  8. Test a bounded shadow stamp only if the simpler path still costs too much; reject atlas copies whose overhead cancels out the fill savings.
- **Verify:**
  - Extend `tests/shadows.test.ts` with per-frame soft-fill bounds, contact on every tier and silhouette direction on both sides of the lamp.
  - Capture wide stance, dash landing, wall of bodies, jump apex, near-lamp boss and rolled span edge; check planted shoes and fading airborne shadows.
  - Watch slow and normal real-time movement across a priority boundary; optional shadow quality must not visibly toggle every other frame.
  - On fixed scale/route, compare crowd p95/p99 and cast counts against baseline, and inspect the quiet one-on-one scene for any regression.
  - Compare contact/event ticks and guard timing before/after; pose changes made purely to flatten shadows are not part of this ticket.
- **Keep:** Live sole placement, aim/readable silhouette, one believable projection from the strongest relevant source and enough dark separation on wet asphalt.
- **Budget:** Trial ≥25% fewer *optional cast fills* in the crowded preset, while keeping hero contact and proving a real deadline or submit-time benefit.
- **Reject if:** The gain is only a counter change, the contact cue drops, or priorities make secondary casts pop alongside telegraphs.
- **Rollback:** Keep reuse and no-work skips; switch back to authored softness/projection scheduling for affected cases.
- **Evidence to attach:** Per-light fill receipt, zoomed contact pixels, native-size crowd clip and equal-DPR frame data.
- **Exit:** Shadow weight survives in a duel and a crowd, with optional work bounded as enemy count rises.

### T09: Preserve directional dash echoes without repainting whole actors

- **Who:** FX owner pairs with player/enemy animation owners; a slasher playtester reviews directional readability.
  - Performance QA separates solves at emission from additional solves and vector paints during frames.
- **What:** Reduce repeated draw/solve work for velocity ghosts without making a dash or fast strike feel slow, blurry or duplicated.
  - `Enemy.draw` can paint two or three simple body ghosts from `smearPlan`; player dash echoes solve saved poses and can paint body plus offset rim each draw.
  - Existing pools bound object counts but don't make repeated solving, rendering or overlap free.
- **When:** M2, P1 after T07 publishes visibility; before reworking hit effects in T10.
  - Benchmark enemies and player independently; do not merge a common echo policy until their visual roles are separated.
- **Where:** `src/game/render/look.ts` (`smearPlan`), `src/game/entities/{enemy,player}.ts`, `src/game/fx/fx.ts` (silhouette and additive passes).
  - Keep pose capture near the FX emission/rig boundary and echo paint behind the opaque live actor, in world space.
- **Why:** Directional negative-space trails sell acceleration; identical bright copies in a cluster look like extra attackers and hide real limbs.
  - A sharp launch, readable travel arrow and crisp landing are more important than a long parade of ghost bodies.
- **How (implementation order):**
  1. Count emitted, alive, visible and drawn echoes, pose solves and ink passes for hold/release dash, air dash, defense and enemy attack streaks.
  2. Capture the already-resolved pose or compact immutable joint/outline data once at birth; reuse pooled storage and never alias live rig buffers.
  3. Keep a fallback for types that need a different pose; if solve-at-birth costs too much, lazily solve once upon first visibility and cache per slot.
  4. Paint a single compact dark silhouette with a limited trailing rim for critical player travel; try cheaper directional strips for a redundant enemy ghost.
  5. Preserve cue-specific speed, offset, fade and facing; truncate optional far echoes before the player's direction marker under pressure.
  6. Cull projected extents (including trailing reach), not roots; keep bound buffers and reset all echo slot metadata on recycle/clear.
  7. Keep the live silhouette, weapon and hit frames on top of the relevant ghosts; no screen-wide blur and no behavior change to the move itself.
  8. If simplification is perceptible, compare one extra localized rim against full repeated geometry at equal native size and retain the cheaper approved choice.
- **Verify:**
  - Test repeated dash through reuse cycles, left/right mirroring, air/ground phases and both edges; no pose borrowed from the next pooled echo.
  - Confirm `tests/{fx-pool,silhouette-motion,anime-dash,grounded-dash}.test.ts` invariants and compare first-visible echo vs reference.
  - Keep known hold/release/contact cues at the same tick; a replay without ghosts must still have coherent attack poses, footwork and collision.
  - Show native-speed side-by-side of a solo dash and a fast crowd; reviewers identify travel direction and the real attacker without counting decoys.
  - Compare peak echo submits and p99 during repeated bursts under both routes; do not accept a win caused by disappearing edge trails.
- **Keep:** Immediate dash snap, taper, left/right identity, clean sword and head contour; optional echoes should not read as a second character.
- **Budget:** At most one expensive geometry solve per echo slot activation for the optimized path; measure extra pooled bytes before increasing slot size.
- **Reject if:** The optimized echo drifts from the captured pose, obscures the live actor, flattens attack anticipation or adds significant emission stalls.
- **Rollback:** Restore original style for the failing move; keep visibility and verified cached geometry for unaffected echoes.
- **Evidence to attach:** Frame strip, playback clips, slot lifecycle test and solve/paint counts for player and enemies separately.
- **Exit:** Dash motion still feels fast at Low and Ultra, and busy frames are no longer paying repeatedly for identical echo geometry.

### T10: Cull and budget cosmetic combat work without touching combat

- **Who:** FX renderer owner implements; combat designer labels required feedback and approves the priority policy.
  - Performance QA profiles effect layers; accessibility QA checks particles off, shake off and no reliance on color alone.
- **What:** Keep trails, impacts and warnings where they matter, but skip offscreen and subvisually faint cosmetic emissions at draw time.
  - Multiple live FX pools, projectiles, prop cracks and ground decals can submit work even beyond the view.
  - An additive burst can spend twice: first in its own layer, then again if captured by post (address the second share in T13).
- **When:** M2, P1 after visibility and echo fixtures; budget by effect priority before turning down any user-facing setting.
  - Start with draw-only culling. Tighten optional admission only on effects whose overlapping copies demonstrably degrade the frame.
- **Where:** `src/game/fx/{fx,particles1d}.ts`, `src/game/entities/projectiles.ts`, `src/game/world/props.ts`, `src/game/render/renderer.ts`.
  - Build coverage for under-deck, world-additive, impact-local and screen/HUD feedback separately; a tiny world point can project a large footprint.
- **Why:** A slash should read as a blade passing through a point, not a cloud of bloom. Offscreen cosmetics should not make a visible parry hitch.
  - A hard particle cap without priority can spend its slots on debris while dropping the important new impact.
- **How (implementation order):**
  1. Inventory which draws carry threat, charge, direction or hit confirmation versus redundant sparks, dust, debris, afterimages and ornament.
  2. Give each optional painter conservative extent bounds, including a trail's whole segment and a shockwave's max current radius; use T07's view.
  3. Cull empty layer work up front; skip dry or zero-effective-alpha décor before gradient/path construction without deleting live pool entries.
  4. Prioritize actual event contacts and readable silhouettes; assign stable bounded draw slots to extra glows and distant cosmetics by class.
  5. Prefer one short, shaped impact and the signature blade ribbon over repeated large additive lobes; preserve hitstop and local recoil timing.
  6. If traced fill is high, reuse small bounded stamps for approved repeated effects, not a new full-screen filter or readback.
  7. Maintain source-over/additive isolation and paint order across mixed entries; don't batch paths whose overlap would change opacity or cue shape.
  8. Keep pools, update clocks, projectile collision and prop destruction ownership intact; add counters for drawn and dropped optional work only.
- **Verify:**
  - Burst at screen center and each edge with particles OFF/LOW/FULL and gore on/off; danger and contact remain readable even at minimum optional FX.
  - Test attack/projectile trails whose origin is out of view but segment crosses it, and an expanding ring that enters after its center leaves.
  - Check `tests/{fx-pool,projectile-sweep,impact-focus,execution-system}.test.ts` and compare damage/execute/combo ticks in deterministic replays.
  - Stress many offscreen decorative events and then a real onscreen hit; the important cue must not starve behind older entries.
  - Record per-layer draw/area counters plus submit/frame tails; review quiet and busy clips at native size, not only stills.
- **Keep:** Blade direction, hit location, strike hierarchy and explicit player effect choices; don't turn off optional effects solely to make the benchmark pass.
- **Budget:** No change to sim or pool capacity for the first pass; fewer paints for offscreen and overlapped cosmetics, with protected cues uncapped by décor.
- **Reject if:** Damage or prompt timing changes, a partially visible cue is culled, or a visually important effect vanishes when two actors overlap.
- **Rollback:** Disable the failing cull/admission rule per effect class; retain measurements and proven visibility cases.
- **Evidence to attach:** Effect inventory annotated cue/cosmetic, counter deltas, event equality and a full-speed crowd strike/parry clip.
- **Exit:** FX cost tracks the visible fight and intentional impact, not every still-live spark in the world.

### T11: Keep coherent lighting without turning every fighter into a bake

- **Who:** Material/light-field owner profiles probes and fills; art/animation approve cloth, enamel and blade reads.
  - Performance QA separates light-field/caster work, brush hits, brush misses, path transforms and normal tile uploads.
- **What:** Avoid unnecessary per-body light probes and material brush construction without making the helmet all one color or eliminating light direction.
  - Renderer already reuses `Probe` objects; per-context ramp/pattern caches are bounded, so optimize miss work only if it actually materializes in traces.
  - `volumeBrush` misses populate a 32×32 staging tile using `putImageData` + `createPattern`; those are not per-frame by definition.
- **When:** M2, P1 conditional after T07/T08 bound the visible actors and shadow demand; measure on both routes.
  - Make static/prewarm/cache tuning an independent experiment so an art tweak cannot hide a performance regression.
- **Where:** `src/game/lighting/{ribbons,material,volume}.ts`, `src/game/world/background.ts` (`lighting`, `lightAt`), `src/game/render/renderer.ts`.
  - Sample mutable lighting in world space, at the frame's time and interpolated receiver height; brushes are object-local art, not HUD or physics.
- **Why:** Directional top-light and rim sell rounded armor and a real nearby lamp. Blindly turning them off flattens combat and may save little.
  - Crowds can multiply cache churn; a stable warm stroke at the right limb matters more than per-limb micro-shimmer.
- **How (implementation order):**
  1. Add probe/brush counts and miss timings and compare warm idle, lamp crossings, cold start and dense hits during both static and changing lights.
  2. Ensure all same-frame probe consumers share a sample for the same receiver/pose, and skip probes only for layers that truly don't consume them.
  3. Cache static light inputs once per scene recipe; keep flash, hit-light and animated practical gain live and synchronized with their actual emitters.
  4. If misses dominate, prewarm only demonstrated common bins while preparing the scene, or use a cheaper approved ramp for a distant optional body finish.
  5. Trial coarser or hysteretic binning against moving silhouettes and angular sweeps; verify that quantization never steps base airlight or cue exposure.
  6. Preserve per-context pattern lifetime and set the local transform when reused; do not merge patterns from incompatible faces, palettes or receivers.
  7. Keep cache/staging ownership and fallback when a context/plate is unavailable; prevent a quality change from triggering an immediate rebuild storm.
  8. Check helmet/steel/cloth and hand/blade readability before reducing actual light-field precision, and keep the existing path if the win is within noise.
- **Verify:**
  - Use `tests/{desktop-lighting,fundamental-lights,world-lights}.test.ts` and add a fixed lamp-crossing probe replay with both facing directions.
  - Compare smooth highlight movement through moon/practical overlap and nearby hits; watch for cold frame spikes on the first unusual angle.
  - Verify rendered contour, body volume and colored threat cues at Low–Ultra; backgrounds and deck pools match the warm control outside intended edits.
  - Capture hit/miss rates, memory per context and foreground `putImageData`/pattern timing instead of counting a cache hit as a GPU saving.
  - Reset or lose a staging target in QA; fallback draws legible silhouettes and does not loop on an unusable canvas.
- **Keep:** Direction, material separation, cue colors and time-varying local highlights; no global grade or extra rim pass to hide discontinuities.
- **Budget:** Use existing bounded caches unless a measured alternative wins; zero new per-frame texture allocations on repeated content.
- **Reject if:** New shading bands pop during movement, prewarming inflates the click stall or the only gain comes from dimming a cue.
- **Rollback:** Restore existing brush/ramp selection for the affected contexts; keep safe probe reuse and the measurement hooks.
- **Evidence to attach:** A lamp-crossing grid, native-size animation clip, cold/warm miss tallies and memory/timing tradeoffs.
- **Exit:** Only genuinely useful pose lighting is computed, and any retained expensive finish has a proven visual job.

### T12: Give reflections one owner on both optics routes

**Follow-up:** The authored stages now keep wetness in the road bake and have no live mirror producer. See [Practical Optics](PRACTICAL-OPTICS.md) for matched measurements; the route comparison below describes the earlier design.

- **Who:** Optics and road material owners share the receiver contract; performance QA runs paired capture/forward trials.
  - Art QA decides material parity, not pixel identity; combat QA checks footwear contrast and blade clarity near the pool.
- **What:** Keep stable baked light and remove duplicate dynamic mirror energy; compare band capture against local silhouettes at the same effective DPR.
  - Forward mirrors use posed outlines; capture projects scene pixels into a downscaled band. Both must describe the same wet asphalt and light sources.
  - Props already draw a baked flip. Their visible pixels can also feed the capture mirror, giving the same prop two bright contributions.
- **When:** M2, P1 after T07/T08 and before T13/T14 choose expensive compositing or scale settings; run fixed and then adaptive comparisons.
  - First fix duplicated ownership. Change route defaults only after the target browser/device evidence and M4 tests exist.
- **Where:** `src/game/world/background.ts` (`drawReflections`), `src/game/stage/viaduct.ts` (`maskReflection`/wetness), `src/game/render/renderer.ts`, `src/game/world/props.ts`.
  - World camera and asphalt bounds own projection; the static baked layer owns the steady sheen/pool even when dynamic mirrors are disabled.
- **Why:** Asphalt should look wet, not like a second fight in a bright pane of glass; competing reflections also spend raster budget underfoot.
  - Replacing capture only makes sense if the cheaper route keeps plausible light movement and doesn't resurrect repaired flicker.
- **How (implementation order):**
  1. Write a table of base/deck, actor, prop and specular sources and the one intended owner for each on each route and tier.
  2. Separate prop body from its optional reflection strip; measure split draws, then suppress/rebalance duplicated energy only where capture already supplies it.
  3. Use one receiver depth/roughness vocabulary for both routes and the seed's wetness field; tests compare material gain/falloff rather than copies of silhouettes.
  4. Preserve prefiltering, rounded backing-to-CSS mapping, stable capture dimensions, fixed world depth, inverse-roll overscan and exact deck clipping.
  5. Mask or omit capture when the receiver is fully hidden or the dynamic contribution is zero; keep baked dry sheen and anchored fixture pools.
  6. Compare present capture, a provably smaller/cropped capture if needed, and local mirrors with reused projected paths; count source/dest pixels and batches.
  7. If local wins on touch hardware, trial it behind a route flag; keep the stability-tested capture fallback where browser cost or readability favors it.
  8. Tune broken wet patches and falloff only after parity passes; never reduce tier by globally darkening the pool or rerolling material art.
- **Verify:**
  - Run existing `tests/{layer-seams,surface-light,viaduct,fundamental-lights}.test.ts` reflection, thin-source, road-edge and zoom/clip checks.
  - Sweep quarter-pixel pans, both rolls, zoom and clipped emitters at DPR 1/1.25/2 in the harness; maintain continuous bright signatures and position.
  - Inspect the same prop intact/removed in drizzle and steady wet conditions on both routes; no double silhouette, stale mirror or detached glint.
  - Compare fixed-tier, matched-DPR pan, dense fight and fast dash; keep screenshots/readbacks out of performance windows and don't infer a CPU transfer from a blit.
  - Shed to Low and raise again; dynamic detail may go, but steady pools, base warmth, stable input and foot contact must remain.
- **Keep:** Under-paint sheen, narrow fixture identity, stage boundaries and responsive actor reflection where enabled.
- **Budget:** No added full-scene copy for parity; preserve stable allocation across camera motion and require a measured win for a default route change.
- **Reject if:** Any thin-source blank, depth stretch, clip leak, doubled reflection or below-deck seam reappears.
- **Rollback:** Keep unique source ownership and keep the current stable sampler on the failing route; disable only the new experimental path.
- **Evidence to attach:** Per-source ownership table, fixed-DPR frame tails/traces and matched dry/wet prop, lamp crossing and dash clips.
- **Exit:** Mirror options differ in richness, not scene exposure or material logic, and each device route has an evidence-based reason to exist.

### T13: Make bloom belong to emitters, not the whole fight

**Follow-up:** One fixture-local stamp now owns the crisp body, hot lobe, skirt and air. No separate authored shaft or glare passes. See [Practical Optics](PRACTICAL-OPTICS.md).

- **Who:** Post/compositing owner leads; the lighting artist and combat QA choose what legitimately glows.
  - Performance QA measures capture, tap copies, upsample and destination blend distinctly on capture and forward.
- **What:** Reduce unnecessary Ultra capture/post work and keep superposed additive FX from washing out pose and sword contrast.
  - `PostStack.captureSquared` downsamples the finished scene, then blends a squared copy; `compose` adds bounded ray/halo passes.
  - In the current order, additive combat FX and impact marks can enter that sample, even though flash, weather and HUD are already excluded.
- **When:** M2, P1 after T12 names the reflection producers and T10 assigns FX priorities; evaluate at fixed DPR before tuning quality.
  - Separate pass-order correctness from an experimental replacement of the current capture; do not change both in the first comparison.
- **Where:** `src/game/render/{renderer,post,graphics}.ts`, `src/game/world/background.ts` (`raySources`, local halos) and `src/game/fx/fx.ts`.
  - Preserve world occlusion of practicals, current camera positions and tight receiver bounds; main contact and UI are outside the emitter process.
- **Why:** A softly glowing lamp frames a strike; a bright strike that makes every surface bloom erases its own sharp contact and adds extra blended area.
  - Ultra should show more crafted materials and focused light than High, not a brighter screen or a quieter blade.
- **How (implementation order):**
  1. Log input capture pixels, bright-pass/tap counts and actual affected areas; use isolated signs and the same blade burst to see which layers feed them.
  2. Keep the existing local attack/impact accent; trial excluding redundant large additive glows from the environmental sample rather than damping all FX.
  3. Compare the current bounded post, a capture scheduled before excluded FX with equivalent occlusion, and localized reusable emitter patches.
  4. Place patches from stable emitter IDs/footprints, with prefiltering and feathering; no winner-take-all reweighting as two practicals cross strength.
  5. Retain independent emitter budgets and the eight-tap ceiling on the capture fallback; skip genuinely empty work before sampling.
  6. Preserve signed-off order: base light/receivers first, environmental glow beneath protected foreground cues, weather/flash not captured, HUD last.
  7. Reuse buffers at the same dimensions; never add a second full scene just to mask colors. Keep global alpha/blend/transform state isolated.
  8. Choose the simplest version with stable sign peaks, readable effects and a real cost win; keep full-scene optics optional rather than systemic.
- **Verify:**
  - `tests/{layer-seams,ultra-stack,fundamental-lights,impact-focus}.test.ts`: no narrow-source blanks, bleed, offscreen rays or unbounded tap counts.
  - Compare a lamp alone, two lamps at crossover, a bright sword far from a lamp and an impact in the lamp's pool; no bogus long-range glow owner.
  - Inspect both routes in grayscale during crowds and hitstop. Weapon and hand contours must not disappear at the bright peak.
  - Measure fixed-DPR pan and hit-burst windows, include blank and quiet scenes; verify there is no added frame copy or new large buffer.
  - Confirm low/no post still delivers every required threat and hit cue without altering the stable warmth or making Ultra the only legible mode.
- **Keep:** Local light/spill, recognizable signs, crisp contact accent and the established weather/impact/HUD order.
- **Budget:** No new full-scene capture; cap admitted sources/taps; use localized energy/coverage counters as well as blit counts.
- **Reject if:** Contact looks weak without bloom, near sign modulation reintroduces blinking, or the new approximation flattens the scene for no frame gain.
- **Rollback:** Re-enable the stable prefiltered capture for that route, with the original gain and protected cue ownership; leave separate FX opt-outs intact.
- **Evidence to attach:** Source coverage and tap receipt, signed-off flash/contact comparisons and CPU/raster/presentation trace annotations.
- **Exit:** Both routes preserve the hierarchy of strike, lamp and backdrop, with optical work attached to actual visible emitters.

### T14: Spend scene pixels where the deadline can afford them

- **Who:** Runtime performance owner and renderer owner jointly decide resolution; art QA reviews edge sharpness.
  - Device QA distinguishes screen DPR, tier cap, governor target and true backing scale for all charts and settings.
- **What:** Treat adaptive scene DPR as a measured raster-cost control independent of world coordinates, base light and HUD scale.
  - At 1920×1080 CSS, 1× is 2.07 million pixels and 1.5× is 4.67 million; report actual dimensions, not a quality label.
  - Ultra's 2.25 cap implies about 5.06× the 1× area if reached; the ordinary session governor ceiling starts at 1.5, not 2.25.
- **When:** M2, P1 after fixed-route measurements in T12/T13; set shipping scale policy only after the T24 replay and device checks.
  - Don't use a lower-DPR candidate to claim improvement from a shadow or capture patch; measure one axis at a time.
- **Where:** `src/game/game.ts` (`resize`, effective DPR and scene transforms), `src/game/render/{graphics,bhst,post}.ts`, `src/game/world/background.ts`.
  - Keep CSS/world projection and input coordinates invariant; maintain an independent high-legibility HUD or fallback separate from this pixel knob.
- **Why:** A small scene scale cut can save many filled pixels on a raster-bound device. It cannot repair a crowd's geometry/JS bottleneck.
  - Forcing low resolution everywhere steals the sharp outline that makes a blade feel precise.
- **How (implementation order):**
  1. Measure 1×, 1.25×, 1.5× and supported fractional extremes under the same route, seed, camera and tier; label deliberately forced test scales.
  2. Compare lower scene pixels with same-resolution optional draw/copy cuts using both JS and frame-presentation evidence.
  3. Centralize the chosen target/cap/actual sizes; compute CSS-to-backing transforms from the two rounded dimensions, not a presumed single ratio.
  4. Coalesce CSS/viewport resize requests at a frame boundary; write canvas dimensions only when the resolved backing actually changes.
  5. Coordinate world canvas, HUD, camera and viewport-backed caches as one resize transaction without rebaking seed art or restarting storm time.
  6. Use discrete stable steps, conservative floors, and a separate portrait/hi-DPI review; do not oscillate or choose by pointer alone.
  7. Keep thin lights prefiltered and 1-CSS-pixel cue strokes readable; never mask the problem by thickening or recoloring every weapon.
  8. Add allocation/resize reasons and combine with T24's safe-boundary changes; retain a QA override to repeat fixed-scale A/B.
- **Verify:**
  - Test identical resize calls, a DPR-only change, browser zoom, orientation and moving windows between displays; compare transforms and reallocation counts.
  - Sample thin sign/mirror emitters and the deck/horizon joins at fractional backing sizes; check native-size and portrait weapon readability.
  - Play out a controlled contact/collision clip at each scale; input coordinates, HUD position and event ticks are unchanged.
  - Benchmark pan and crowd frames at equal tiers. Keep only device-scale choices that improve frame tails or demonstrably remove fill pressure.
  - Under an adaptive replay verify the warm bridge never pops and fractional scaling never feeds a clipped or stale capture buffer.
- **Keep:** Native-enough action edges, live world camera, prefiltered sampler, independent HUD clarity and an intact player ceiling.
- **Budget:** CSS-size no-op plus identical backing implies zero reallocation; no additional scene-sized surface per permitted scale.
- **Reject if:** A candidate saves submit work but softens active tells, triggers repeated reallocation or decreases FPS because of a compositing side effect.
- **Rollback:** Restore previous per-device scale bounds and governor input; keep centralized sizing and unchanged-frame prevention.
- **Evidence to attach:** Actual-pixel vs frame-tail chart, backing resize trace and matching edge/cue captures at each chosen scale.
- **Exit:** Resolution is selected for measured fill pressure without accidental blur, seam shifts or a pointlessly expensive pixel ceiling.

### T15: Keep the HUD crisp without clearing an unchanged full screen

**First slice implemented:** [Retained Bridge HUD](BRIDGE-HUD.md) records the separate-canvas fast path and matched QA. Changed HUD states still use the full painter; finer damage regions are not part of this slice.

- **Who:** HUD renderer owner implements; UI/accessibility QA reviews readability and combat status timing.
  - Performance QA reports HUD draw/clear cost separately from scene cost and makes a real compositor comparison before adding layers.
- **What:** Keep a separate sharp HUD, but redraw only when a visual value changes or a live effect needs a region refreshed.
  - The starting loop cleared the viewport HUD and rebuilt state every frame; HUD backing can reach 2× independent of scene DPR.
  - Health easing, combo pop, status banners, charge, low-HP pulse and execute prompts are dynamic; skipping them as "static HUD" is wrong.
- **When:** M2, P1 after T14 defines scene/backing ownership; implement static repeats before optimizing the low-health case.
  - Treat an always-full-window damage overlay or composited extra layer as a separate tradeoff; choose with hardware results.
- **Where:** `src/game/game.ts` (`resize`, `buildHudState`, `hudCtx` clear), `src/game/render/hud.ts` (`HUD.draw`, layout and low-HP plate).
  - Keep game-space indicators projected through the current camera; panel metrics remain CSS UI with their own rounded scale.
- **Why:** HUD fill, text and blending spike just when health changes and combat is intense; reducing scale to illegibility is a false optimization.
  - Accurate charge/release and execute prompts preserve technique; clearing a stale prompt is just as important as drawing a new one.
- **How (implementation order):**
  1. Inventory static panel parts, discrete text/state and continuously animated regions; count full clear, text builds and per-region damage.
  2. Split HUD state advance from paint so timers/easing are correct even if no pixels change; keep critical state updated on the actual frame.
  3. Build layout and static label/track caches keyed by HUD scale, CSS dimensions, input vocabulary and relevant appearance, not by scene DPR.
  4. Repaint the union of previous/current bounds for moving prompts or disappearing items; restore all overlapped decorations in original draw order.
  5. Start with zero work for unchanged frames; add finer region repair only if measured cheaper than a clear/redraw for animated states.
  6. Track low-health mask and prop legend ownership; skip empty invisible coverage, but preserve a deliberate, readable hurt warning and edge fade.
  7. Where possible avoid building duplicate objects/scans for unchanged summaries; preserve correct boss/execute state and no stale text after pause/resize.
  8. Keep the single HUD canvas by default; evaluate any extra DOM/canvas layer at native scale against the memory and compositing win.
- **Verify:**
  - Extend `tests/hud-layout.test.ts` for moving prompt erasure, banner expiry, full/low health, boss and charge changes after no-op redraws.
  - Change portrait/wide, CSS/DPR, input mode and accessibility mid-menu and mid-play; no ghost text, overlap or loss of crisp glyphs.
  - At low HP plus combo/boss and touch controls, compare the deadline tails and actual clear pixels to the current full-window path.
  - Play at scene DPR below HUD scale and with inspect or no-HUD-layer fallback; the scene's clear/composition must still leave correct HUD pixels.
  - Confirm HUD remains outside bloom/weather and charge/readiness/strike warnings update on the first eligible displayed frame.
- **Keep:** Stable glyph grid, resources/charge state, execution prompt and low-HP information; don't trade hint legibility for lighter clearing.
- **Budget:** No full-window clear for an unchanged separate HUD; track unavoidable animated pixels and count all backing bytes, not just raster calls.
- **Reject if:** Dirty painting leaves trails, delays a cue or raises layer memory/composite costs enough to cancel the candidate win.
- **Rollback:** Keep safe label caching and resize semantics, restore authoritative full HUD redraw for any unproven dirty region.
- **Evidence to attach:** Region/clear counters, native screenshots with stale-pixel tests, and sustained busy-HUD timings on touch and desktop.
- **Exit:** HUD emphasis still follows the fight; static pixels stop costing a full redraw each display tick.

### T16: Remove moving backdrop blur from touch controls if it costs frames

**Follow-up:** The 11 touch action/joystick surfaces no longer sample the scene. See the [touch compositor check](PRACTICAL-OPTICS.md#touch-controls); physical-device testing is still open.

- **Who:** Touch UI owner implements the CSS alternative; physical phone QA verifies compositor and multi-touch behavior.
  - Art and accessibility QA agree on readability over dark steel, bright flash and every button state.
- **What:** Compare current backdrop sampling with simple opaque-enough tinted button surfaces and clear focus/pressed outlines.
  - `backdrop-blur-sm` on controls can require compositing the moving scene beneath them; that is a candidate, not measured evidence yet.
  - Touch UI also competes for thumb space and can hide the stance or a low execution prompt in a narrow viewport.
- **When:** M2, P1 measurement alongside T15, after the touch baseline exists; small CSS-only change if the alternative wins.
  - Test physical low-end/thermal conditions; do not generalize from desktop touch emulation or a static menu screenshot.
- **Where:** `src/app/page.tsx` (`TouchLayer`, virtual stick and action buttons), HUD layout in `src/game/render/hud.ts`.
  - This is DOM compositor work above the scene; never put controls into scene post or shrink their input regions with scene scale.
- **Why:** Every thumb press should feel immediate and visible, even on wet neon. A glassy UI is expendable when it costs compositor time.
  - Clear controls and visible footwork matter more to mobile slashing than preserving a frosted surface.
- **How (implementation order):**
  1. Capture layer/compositor tracks in a fixed-route touch pan and crowd; compare current controls, identical opaque-backdrop variant and idle menu.
  2. Keep DOM structure, pointer handling, hit targets and layout stable during the first CSS-only trial.
  3. Replace live blur with dark translucency or solid tint, a border and restrained visual pressed/focus state; avoid oversized shadows/filters as substitutes.
  4. Preserve clear text/icons and enough discrimination for multiple fingers, dim display and a bright sign directly behind a button.
  5. Review safe-area landscape, narrow portrait, large fonts and resized aspect without overlapping the charge bars or the foreground attack lane unnecessarily.
  6. Keep keyboard/fine-pointer rules separate from rendering policy; don't remount controls in the middle of a captured pointer interaction.
  7. If a blur option is retained at all, scope it to a static or explicitly measured surface, not all active combat controls.
  8. Apply only measured CSS wins and label optional cosmetics accurately; preserve the same input wiring and phase changes.
- **Verify:**
  - Physical phone tests: hold movement with one finger, attack/dash/parry with another, rotate, pause and resume, then cancel/release each pointer.
  - Verify equivalent action edge order and hit zones, no sticky axis, and no lost press after switching pointer mode between runs.
  - Compare earliest actor response and visible press in recordings; replacing the backdrop must not change button behavior.
  - Review focus, contrast and readable status on clear/haze/rain and hit feedback; evaluate whether obscuring less action improves room to play.
  - Report layer count, composite evidence and p95/p99 in matched moving clips; if difference is noise, prefer whichever approved UI is more legible.
- **Keep:** Touch actions, labels, safe hit targets, keyboard access, control feedback and playability when DPR sheds.
- **Budget:** No new filtered full-size backdrop on the fight view; preserve control area and avoid unmeasured extra composited layers.
- **Reject if:** Input handling changes, buttons become hard to find, or a software-only win is sold as a phone FPS guarantee.
- **Rollback:** Restore the prior CSS treatment for the failing surface; keep any separately validated layout/readability correction.
- **Evidence to attach:** Physical phone recordings, frame/compositor data, and before/after thumbs-over-combat screenshots.
- **Exit:** Controls are readable and responsive during the real fight without unnecessary moving-background work.

### T17: Stop redrawing a frozen scene

- **Who:** Game loop owner implements dirty scheduling; input/QA owners validate phase boundaries and inspector behavior.
  - Performance QA compares paused/hidden work and first resume frame; UI QA names any pause animations that actually need ticks.
- **What:** In pause, retain the painted world until something invalidates it, while keeping menu/UI interactions and intentional HUD behavior live.
  - The current pause branch skips sim advancement but still builds a RenderWorld and redraws scene, optics, weather and HUD.
  - Edit/inspect and attract have different live requirements; do not treat every non-playing phase as a frozen bitmap.
- **When:** M2, P1 after T14/T15 define viewport and HUD invalidations; land behind a QA kill switch through resume tests.
  - Pause first, then consider separate measured attract throttling only with visual approval; keep active gameplay display cadence unchanged.
- **Where:** `src/game/game.ts` (`loop`, `frame`, `pause`, `resume`, `resize`, `visibilitychange`), `src/game/debug/inspect.ts`, HUD scheduler.
  - Resize, orientation, changed art/settings, editor input and loss/restoration of context each can invalidate the retained pixels.
- **Why:** A pause screen should lower load and heat, not keep spending an entire combat render budget on a static image.
  - The first resumed parry or slash must still be accepted exactly once, with no caught-up weather or sudden camera movement.
- **How (implementation order):**
  1. List phase-specific updates and draw invalidators; record paused world/HUD/DOM submits, clocks and input-handler dependencies.
  2. Preserve the last valid world image on its existing canvas where reliable; don't take a second full-size snapshot merely to pause.
  3. Separate world dirtiness and animated HUD/DOM needs; coalesce dirty work into one scheduled draw, not multiple pending rAF loops.
  4. Redraw once when backing state is cleared or a compatible paused setting/resize changes; make stopped rendering recoverable on context/visibility events.
  5. Gate visual clocks explicitly in pause and maintain debug/raw edge semantics; inspector edit keeps the work needed for authoring.
  6. Keep input disabled/cleared at intentional phase transitions as today; on resume reinitialize the time baseline and handle the next allowed edge once.
  7. Keep governor acceptance/measurement windows out of paused/visibility gaps; no retroactive sim or weather time jump on return.
  8. Trace rAF and redraw counts, allocations and power proxies during a pause stretch and compare first frames upon resuming a dense scene.
- **Verify:**
  - Pause during charge, heavy hitstop, a roll, weather flash and a crowd; anchor the frame, resize, change settings and resume.
  - Confirm one rAF owner, no render after destroy and no debug input loss in edit/inspect; background tabs draw no unnecessary world frames.
  - Low-HP, menu and help UI remain legible and behave as specified; a menu resize never leaves a blank world behind it.
  - Re-run `tests/{sim-clock,input-edge-ownership,impact-focus}.test.ts`; compare first resumed action and subsequent fixed ticks in the replay.
  - Log dirty reasons and verify an unchanged paused world has no scene/optics submits during the hold.
- **Keep:** Contact pose, intended pause appearance, live menu, input edges and smooth gameplay/resume cadence.
- **Budget:** Zero scene submits once a paused frame is stable; bound recovery to one repaint per coalesced invalidation; no extra full-resolution snapshot.
- **Reject if:** Resume misses an input, art turns blank or stale after resize, or more than one frame loop starts.
- **Rollback:** Restore regular paused world paints while keeping explicit resume timing and measured HUD/visibility improvements.
- **Evidence to attach:** Phase/timer/rAF trace with an orientation change and visible freeze/resume recording during a charged strike.
- **Exit:** Inactive play is cheap and reliable without punishing the player's first action back.

### T18: Update and project only expensive rain detail that can be seen

- **Who:** Storm simulation/renderer owner makes budget changes; weather and art QA protect the seeded front and depth layers.
  - Performance QA records active vs updated vs projected drops, paths, splash draws and time under each weather band.
- **What:** Remove zero-opacity work, share projected streak geometry across passes, and reduce hidden particle maintenance if it is worth it.
  - Current Low draws up to 96 of 288 drops but updates all 288; halo/core project independently, with a third amber path in sharp rain.
  - Even zero-opacity rain can build paths. Weather progression, storm envelope and wetness do not depend on submitting those paths.
- **When:** M3, P1 measured before changing the geometry/lighting of rain in T19; zero-visible work guards can land earlier with exact output.
  - Change drawing first; change any particle state evolution only after it passes front/lightning and stable tier-transition fixtures.
- **Where:** `src/game/world/storm.ts` (`step`, `drawRain`, `drawSplashes`, `setView`), `src/game/world/{background,weather}.ts` and `src/game/render/look.ts`.
  - Keep the front and storm real clock separate from reused draw-time arrays; write world splashes behind actors, not into the UI/post capture.
- **Why:** A storm should feel deep and fast with few sharp local streaks; blank alpha paths and duplicate projections cannot add atmosphere.
  - Turning rain off globally steals the wet-night identity and would mask the wrong cost.
- **How (implementation order):**
  1. Skip exactly invisible rain/splash painting before clip/path setup; do not return from storm clock, thunder, front or wetness updates.
  2. Compute wind/intensity once per relevant update or paint; project each visible drop once into fixed-capacity reusable per-band endpoints.
  3. Use those same endpoints for halo/core and a bounded subset inside the shared amber emitter cone; preserve dim-to-bright depth order.
  4. Compare fused/reduced strokes in unlit distance against the current path shapes; keep subtle near detail where visibly justified.
  5. If hidden updates dominate, trial a stable active prefix plus cheap deterministic wake/recycle for inactive drops; preserve seed continuity across tiers.
  6. Untangle rain/splash RNG effects as needed; keep lightning scheduling independent and avoid burst-pop catch-up on reactivation.
  7. Keep visual render side-effect free; expose zero-alpha skips, updated/drawn counts and optional path area without resizing scratch every frame.
  8. Cull deck splashes conservatively to the actual draw receiver/view; let each live ring expire normally and keep higher-tier ripples subordinate.
- **Verify:**
  - Extend `tests/{storm-engine,weather,layer-seams}.test.ts` for dry no-path behavior, stable clocks, first rain ramp and tier churn.
  - Seed 42 haze→clear→drizzle: front and wetness progress, amber airlight/base façade remain steady, rain visibly returns before the fight loses its mood.
  - Exercise Low→Ultra mid-storm at matched resolution; no whole-sheet pop, starvation, clumped lane impacts or changed thunder cadence.
  - Count each projected streak at most once per frame; compare shape/alpha at the same time with original paths for the pure-reuse patch.
  - Profile clear, drizzle and heavy rain with the same pans/crowd; verify any active-prefix policy improves tails without measured aesthetic regression.
- **Keep:** Every weather band's identity, three rain depths, natural wind/splash motion and all foreground combat cues.
- **Budget:** Zero path setup in dry paint, one projection per candidate visible drop, bounded buffers; don't increase authored drop counts to hide regressions.
- **Reject if:** Lightning schedule changes, wetness stops evolving, or Low loses weather and intermittently floods the view on recovery.
- **Rollback:** Keep zero-opacity guards and reusable projections; restore previous update prefix or layered stroke treatment for the failing conditions.
- **Evidence to attach:** Per-band counters, source footage of real front transitions and fixed-scale device frame comparisons.
- **Exit:** Weather still has motion and depth; only visible or next-needed rain detail gets expensive work.

### T19: Put rainfall and storm light in the right space

- **Who:** Weather renderer owner handles projections; stage and accessibility owners approve the rain/flash boundary.
  - Art chooses whether a localized distant lightning hint adds value; no new strike look ships by default without that review.
- **What:** Align near rain with the rolled deck and splashes, quiet the fight lane and resolve dead bolt/fork generation.
  - Current rain uses the attenuated sky camera and an axis-aligned cutoff; splashes are world-space and the deck can roll under that apparent line.
  - Weather generates bolt arrays but the scene's storm overlay paints a flash, not that channel; separate it from ability lightning FX.
- **When:** M3, P1 for the projection/cleanup after T18; P2 for optional distant strike art after T22's flash review.
  - Ship the spatial correction independently. Do not bundle expensive new storm art into a performance repair.
- **Where:** `src/game/world/{storm,background,weather}.ts`, `src/game/render/renderer.ts` and `src/game/stage/road-section.ts`.
  - Far rain/clouds can use parallax. Near impacts and occlusion follow the actual world camera including offsets, roll, zoom and span ends.
- **Why:** Visible rain should travel through space and land where the road is, not end at a moving horizontal matte. Depth supports danger instead of covering it.
  - A localized sky response can suggest a distant storm without making every hit and every flash fight for the same attention.
- **How (implementation order):**
  1. Capture a rolled deck with clear clip edges and multiple rain depths; label each depth, emitter and splash layer before moving a clip.
  2. Pass explicit far and world projection inputs rather than one `StormView` for everything; align near endpoints and deck receiver projection.
  3. Use a conservative projected deck shape/clip for near streak termination and asphalt splash bounds; don't impose a new full-width cutoff on far streaks.
  4. Soften near rain opacity around the action depth with authored depth values, not a halo that chases the player's position or dims the base city.
  5. Keep amber strokes tied to the emitter and rain scale; wetness governs splashes on the receiver. Keep the splash bed behind the fighters.
  6. If no channel is selected, remove unused bolt/fork storage and writes. Preserve the RNG advance or prove equivalent strike/azimuth/thunder sequences before removing it.
  7. Optional: test a single authored localized cloud glow or distant channel cue against the repaired no-channel baseline; do not layer it over a full white flash.
  8. Keep visual-only lightning independent of combat clocks and test both default and reduced-flash treatments; remove stale comments describing nonexistent bloom/bolt work.
- **Verify:**
  - At positive/negative roll, tall portrait and both span ends, screenshot rain and splashes in motion; mark intentional curb/rail lines separately from rainfall edges.
  - `tests/{storm-engine,weather,viaduct,layer-seams}.test.ts`: same storm timing, thunder bindings, weather front, opaque joins and persistent city warmth.
  - Track strikes and azimuth across long deterministic seeds before and after pruning arrays; jitter from changed random consumption is not a free optimization.
  - Review foreground actors against unlit and amber rain; no new bright stripe, camera-space sliding or lost foot/weapon detail at full speed.
  - Measure heavy-rain FOV and clipping cost. A distant feedback variant must be optional, bounded, and pass T22 separately.
- **Keep:** Subtle rain-depth motion, local practical lighting, coherent splashes, independent weather identity and supported reduced motion.
- **Budget:** Reuse the T18 endpoint data; no new viewport buffer or full-screen flash pass in the alignment fix.
- **Reject if:** Weather smears across the deck/HUD, an extra flash competes with combat, or cleanup silently changes the storm's cadence.
- **Rollback:** Restore only the failing rain projection/polish; keep exact no-work guards and tested dead-data cleanup where safe.
- **Evidence to attach:** World-projected rain overlay, rolled span clips and a before/after strike schedule/effect cost record.
- **Exit:** Rain belongs to the scene's depths, and storm feedback has only the simple, intentional representation we actually draw.

### T20: Break the city wallpaper without making the fight busier

- **Who:** Environment artist owns the depth/landmark composition; world baker implements seeded templates within the approved resource scope.
  - QA owns horizontal wrap and vertical join fixtures; art and combat reviewers approve skyline quiet zones at native gameplay size.
- **What:** Vary repeated architecture and use depth contrast deliberately instead of sharpening every distant tier or adding more neon.
  - Current 2048-wide parallax tiles repeat silhouettes; the district repeats its unfogged 192-pixel floor section to cover tall views.
  - Distant plates share softened artwork across tiers. Keep equivalent base silhouettes; extra detail is allowed only where it can be seen and serves depth.
- **When:** M3, P2 after T03/T05 memory and cache contracts and after look approval; defer this before cutting combat cues or warm coverage.
  - Start with one span and three seeds, then decide if the scene needs additional low-frequency variation at all.
- **Where:** `src/game/world/{background,buildings,art-grade}.ts` and `src/game/stage/viaduct.ts` (`paintDistrict`, `drawDistrict`).
  - Use seed/atlas coordinates for architecture and sign records; keep world rail and asphalt untouched; preserve live parallax placement.
- **Why:** A few distinct, recognizable shapes make the world feel dense; constant equal-contrast windows make it feel tiled and obscure the subject.
  - Deep, soft silhouette spacing supports the slasher's contrast better than a second higher-resolution set of the same busy façades.
- **How (implementation order):**
  1. Paint a three-value reference: soft distant silhouettes, mostly quiet mid-band behind the fight, sparse near architecture framing the live actors.
  2. Reuse existing seeded tower/floor families and vary crowns, services and unlit wall blocks before proposing a bigger atlas or live detail.
  3. Keep strong landmarks sparse; if repetition remains obvious, trial deterministic low-energy variation per world wrap using a bounded baked module or stamp.
  4. Preserve tile period, overlap, feathered base and aligned vertical service floors until alternate join fixtures prove coverage at scroll/zoom.
  5. Keep static warmth/lighting and correct palette ownership, and place high-contrast motifs off the usual action lanes rather than auto-darkening behind the hero.
  6. Preserve tile-local animated sign records, stable admission/blend modes and cross-wrap phases; no more live windows to mask an authored repeat.
  7. If an Ultra detail upgrade is desired, improve one near material or silhouette at native size; keep far blur where distance calls for it.
  8. Set a hard cap on any extra retained texture/overdraw and compare to T03 savings; don't automatically spend the reclaimed memory again.
- **Verify:**
  - Three seeds, several span crossings, tall portrait/lower district, large landscape at fractional pan and zoom; no seam, moiré or highlighted repeat.
  - Run `tests/{layer-seams,viaduct,world-lights,profile-consumption}.test.ts`, including stable per-tile sign budgets.
  - Cover no-FX/normal/cluttered play in grayscale; an environment change must not make a blade, flame cue or dark-shoe contact harder to find.
  - Compare sky/facade/district warmth to the control; intentional new composition gets a new reviewed reference, not a loosened test tolerance.
  - Record resulting atlas count/bytes and pan tails; compare at unchanged tier/route/backing scale and show the bare action plane stands by itself.
- **Keep:** Deep Noir mood, seeded novelty, lower city presence, readable static pool/paint and opaque, stable depth joins.
- **Budget:** First prototype at the existing retained plate budget with no additional full-width runtime visual layer.
- **Reject if:** Tiling is hidden by black fog, dynamic grading, larger permanently duplicated bakes or higher backdrop contrast behind fighters.
- **Rollback:** Restore the previous architecture recipe while retaining lifetime, wrap tests and successful quiet-value changes.
- **Evidence to attach:** Shape/value board, side-by-side scroll clips and a per-band memory/brightness/overlap receipt.
- **Exit:** The bridge and city feel larger and less repetitive, but the eye still lands on the moving blade first.

### T21: Protect the silhouette, blade and contact of every slash

- **Who:** Combat animation and look-development leads jointly approve cue preservation; an independent playtester scores the results.
  - QA documents which actor, pose, cue, background and clock each comparison scores, so an art judgement can be reproduced.
- **What:** Build a slasher cue map and correct remaining readability conflicts at their source, not via global exposure or longer attack windows.
  - Dark limbs against dark props, dense windows near a weapon and layered bright edges can all fail even when frame time improves.
  - Clearly separate required signals from redundant spectacle and bind each necessary signal to its actual gameplay event.
- **When:** Define cue references in M0; P1 close remaining read failures in M3 after measured fixes are isolated.
  - Motion review applies to every ticket that changes a combat-facing pixel, not just this final art pass.
- **Where:** `src/game/{entities/player.ts,entities/enemy.ts,fx/fx.ts}`, key poses under `src/game/anim/`, `src/game/render/{look,renderer,hud}.ts`.
  - Art targets the world action plane, weapon paint, local rim/contact, quiet scenery and protected cue colors; sim/collision remains unchanged.
- **Why:** The slasher feel is recognizable anticipation, fast follow-through and a heavy readable stop. More particles or longer blur do not produce it.
  - A player shouldn't lose the parry or execute because a halo, rain streak, prop or button covered the tell.
- **How (implementation order):**
  1. Catalog the frames for windup/counter, charge/release, contact/recoil, parry, aerial/landed strike, dash reversal, boss and execute states.
  2. Assign each a minimum readable shape or position plus a supporting optional color/trail; verify without decorative particles and without relying on sound.
  3. Compare sign crossing, dark prop, crowded overlap and rain on color and grayscale at native size. Mark the leading hand, blade tip and support foot.
  4. Prefer quieting the competing background/effect or a narrow directional local edge over boosting the entire body or adding a thick glow.
  5. Keep current silhouette proportions, weapon identity, and strike pose clarity; approved visible changes affect paint, not hit tables, timing or animation control.
  6. Follow anticipation → contact → recovery with a brief ink/edge accent and credible recoil; keep authored hitstop and enabled audio/FX settings.
  7. Evaluate the worst camera edge/occluder and touch-overlay cases; translate screen cues through the correct camera instead of raising overlay opacity.
  8. Approve an optional contrast variant only if local remedies fail and users can choose it; no blanket grade switch on a tier shed.
- **Verify:**
  - Use deterministic event traces and matching native-speed footage; compare intended pose/timing and player/enemy identity before and after.
  - Ask two reviewers, unaware of which build is which, to name the attacker, tell/direction, contact point and recovery for each scored clip.
  - Check real gameplay at Low/Ultra, touch/keyboard, bloom/particle off/on and reduced motion/flash against bright and dim displays.
  - Require successful identification of all must-read cues in the designated tests; if reviewers disagree, capture the ambiguity and adjust the competing paint first.
  - Run `tests/{hit-resolution,impact-focus,strike-lanes,dash-combat,execution-system}.test.ts` and compare relevant baseline failures separately.
- **Keep:** Attack timings, silhouette/weapon identity, footing, world camera rhythm, score/combo feedback and Deep Noir's warm bridge.
- **Budget:** Correct readable cues with existing geometry/layers where possible; no full-screen pass to sharpen a single slash.
- **Reject if:** A faster build makes an expected tell or clash unidentifiable, a fix alters damage frames, or non-optional cues depend on Ultra.
- **Rollback:** Restore the specific readable layer/pose paint and take cost elsewhere; do not roll back the warm baseline or hide the regression in a timing edit.
- **Evidence to attach:** Cue-by-cue scorecard, tick-stamped still strips, native-rate blind-review clips and all differing event sequences explained.
- **Exit:** A fight looks and feels like Stickman Rising even with optional optics off, and higher tiers strengthen rather than substitute for that read.

### T22: Keep impact readable with less shake and flash

- **Who:** Accessibility owner defines reduced effects and validates preferences; combat and audio owners preserve feedback semantics.
  - Weather/FX/HUD implementers map their own effects; release QA verifies the combinations on a real device.
- **What:** Make reduction of screen-wide motion and luminance effects explicit, consistent, and independent of quality selection.
  - Existing reduced motion already suppresses camera shake and the weather flash; audit other combat/low-health effects rather than assuming coverage.
  - Preserve essential in-world geometry and readable status when optional screen feedback is suppressed.
- **When:** M3, P1 in parallel with T19/T21; approve any visual storm hint only after reduced/default sequences are reviewed.
  - Do not gate accessibility behavior on the success of an FPS or art polish task.
- **Where:** `src/game/game.ts` (`applySettings`), `src/game/core/camera.ts`, `src/game/world/background.ts`, `src/game/{fx/fx.ts,render/hud.ts}`, app settings/persistence.
  - Separate camera motion, whole-screen luminance, local impact/weapon cues and HUD alerts; preferences apply across projected world and screen layers.
- **Why:** Players who need less movement, play muted or disable decoration still need direction, threat, hit and low-health information.
  - A screen pulse shouldn't stack with lightning to conceal a blade, and disabling shake shouldn't remove the only confirmation of contact.
- **How (implementation order):**
  1. Map all full/partial-screen flashes, pulses and shakes plus trigger, duration and stacking; include low-HP, storm, rapid attack, ability and hit effects.
  2. Unify effective preference inputs without treating an automatic tier shed as a user toggle; read current media preference and handle changes safely.
  3. Keep reduced modes at zero avoidable screen-wide flash/shake; use nonoscillating status contrast and local/tactile-looking pose/mark cues where needed.
  4. Preserve default combat timing, weather state and enabled local marks; cap or sequence global luminance effects separately from authored local hits.
  5. Validate cumulative visible flashes over the worst default combinations with a photosensitivity review, not an assertion based on a single low-alpha overlay.
  6. Retain threat by shape/placement/text, not color or audio alone; retain thunder and user-controlled audio semantics without lengthening flash events.
  7. If a distinct reduced-flash preference is needed, add clear copy/default migration and apply it immediately without rebake or route change.
  8. Guard teardown of media listeners; keep protected cues stable while quickly switching modes, tiers and pause/retry.
- **Verify:**
  - Start with OS reduced motion enabled and toggle during play; inspect camera offsets, actual framebuffer flashes and independent UI state.
  - Review sustained storm plus rapid strikes plus low health on both routes; check combined events frame by frame in default and reduced modes.
  - At Low, particles OFF and audio mute, identify guard/charge/parry/execute and damage/health state from the remaining cues alone.
  - Test platform settings on desktop and physical touch, and check contrast in dim/bright display conditions and grayscale.
  - Extend `tests/{impact-focus,storm-engine,hud-layout,persistence}.test.ts` for new preference behavior and formerly overlapping cues.
- **Keep:** Hitstop, weapon path and local feedback, camera framing intent, natural thunder/weather and the warm-lit base scene.
- **Budget:** No additional viewport copy or live material bake for a preference change; reduction should remove screen work where possible.
- **Reject if:** Reduced modes lose semantic feedback, flicker on transitions or leave an unreviewed full-screen effect active.
- **Rollback:** Disable unapproved screen effect/polish and keep local, semantically equivalent cues; never roll back existing reduced-motion safeguards.
- **Evidence to attach:** Default/reduced synchronized storm/combat clips, effect inventory and flash review results for the worst overlap.
- **Exit:** Comfort choices and lower tiers change intensity, not the ability to read a strike or enjoy the same fight.

### T23: Separate input mode, optics route and first-run quality

- **Who:** App/settings owner implements policy and labels; renderer and performance QA approve the runtime snapshot and device defaults.
  - Touch/keyboard QA tests hybrid input and settings migration; art shows what each quality level really changes.
- **What:** Give UI and engine a common capability vocabulary without treating touch or a fine pointer as a performance benchmark.
  - Current settings classify a desktop as fine pointer *and* no touch, while game mount tests fine pointer alone for desktop pacing/forward optics.
  - Ultra's "FULL-PIXEL MIRROR · 2× DPR" and Low's "120 fps floor" are not guarantees of the actual route, backing scale or refresh.
- **When:** M4, P1 after fixed-route/DPR and physical touch trials; correct false settings copy as soon as the existing behavior is documented.
  - Preserve saved ceilings throughout test windows; do not silently migrate a user's preference because a pointer appeared.
- **Where:** `src/game/render/graphics.ts` (`classifyDevice`, tier table), `src/game/game.ts` (`mount`, settings) and `src/app/page.tsx`.
  - Persist the requested ceiling via `src/lib/persistence.ts`; runtime UI exposes effective tier/route/actual scale from the game, not inferred from a menu label.
- **Why:** A hybrid tablet shouldn’t pick heavy optics or disappear touch controls by accident, and "Ultra" should not promise sharper pixels than are drawn.
  - Accurate choices make it possible to reproduce a player's report without touching combat or turning everything down.
- **How (implementation order):**
  1. Expose distinct input affordance, capability/start hint, display cadence, requested ceiling and effective render profile.
  2. Determine input controls from actual input/pointer policy; choose forward vs capture independently using measured defaults, not a direct media-query alias.
  3. Keep DPR based on backing measurements and opportunity; don't fingerprint GPU strings or run an invasive startup stress scene.
  4. Honor existing persisted preferences and fallback on absent information; show current vs requested tier when adaptive mode has shed.
  5. Write honest copy: contact/light/optional reflection detail, adaptive scene scale and stable stage; avoid fixed FPS and pixel-mirror claims.
  6. Update settings/readout on meaningful transitions or throttled diagnostics, not a React notification every frame.
  7. Use an explicit safe transition/next-run boundary for route changes; no receiver/grade rebake or control loss during a live gesture.
  8. Add QA controls for forced routes and fractional DPR independent of device hint; label fixed testing builds and preserve topology of controls.
- **Verify:**
  - Pure cases for fine-only, coarse-only, hybrid touch+fine, missing media queries, high-DPR small viewport and external mode changes.
  - Test no saved settings, previous migration and explicit Low/Ultra flags; active tier never persists as the requested tier after a shed.
  - On hybrid, test attached mouse while touch is available and portrait/landscape; labels, controls and optics route remain logically consistent.
  - Re-run `tests/{shadows,desktop-lighting,profile-consumption,persistence}.test.ts` and show a readout matching actual canvas pixel dimensions.
  - Check default choices on nominated desktop and touch hardware with both optics routes measured at a common scale.
- **Keep:** User control, touch/keyboard behavior, stable bridge, HUD scale and independence between route and quality.
- **Budget:** No synchronous device benchmark or per-frame settings persistence; change the smallest amount of UI state needed.
- **Reject if:** Controls are lost mid-gesture, app/engine report inconsistent effective settings, or marketing copy still implies measured performance it cannot ensure.
- **Rollback:** Revert the automatic default rule only; keep verified honest copy, explicit runtime state and the user's saved choice.
- **Evidence to attach:** Device matrix, settings/readout screenshots and measured rationale for each changed default.
- **Exit:** The device can choose a reasonable start without lying about FPS or taking the player's options away.

### T24: Adapt one measured lever at a time without changing the mood

- **Who:** Governor owner implements the state machine; performance QA calibrates with real traces; combat/art owners sign off adaptive clips.
  - Release owner sets approved defaults and fallback switches and rejects claims if real target hardware is missing.
- **What:** Coordinate the tier ladder, DPR control and emergency cliff recovery into one accountable policy that keeps quality changes local and reversible.
  - Existing policy uses p95 over a 4 s window, recovery dwell and independent DPR timers/cliff logic; it can shed effects first without a known bottleneck.
  - Distinguish visible hitches, recent resize/bake, cadence, sim backlog, geometry and pixel pressure using evidence, not `waitMs` alone.
- **When:** M4, P1 after fixed-tier/route improvements are individually verified; run table tests before changing any shipping thresholds.
  - Start with logging and coordinated no-op elimination, then trial policies under a dev/rollout flag; do not trade away M1 fixes on rollback.
- **Where:** `src/game/game.ts` (`govern`, `detectCliff`, `applySettings`, `resize`), `src/game/render/{quality,graphics,frameLog}.ts`.
  - Apply effective settings at a safe frame boundary, only to optional workload, keeping seed, sim, player ceiling, route and base light out of the ladder.
- **Why:** Losing warm light or sharp attacks for a GC hitch feels arbitrary; raising resolution before a wave can cause another visible pacing cliff.
  - A clear decision history makes it possible to tune a touch device without deciding that every 60 Hz display should chase 120 Hz.
- **How (implementation order):**
  1. Log each proposal and applied result with absolute time, reason, actual prior/new tier and backing size; fix event receipts that currently report the same tier twice.
  2. Form real foreground windows only; disambiguate hidden tabs, cold setup and resize transitions without discarding long visible gameplay stalls from the report.
  3. Derive display targets from sustained cadence evidence and real device refresh; carry confidence and age it out when display/window changes.
  4. If paired tests show fill or capture pressure, reduce safe scale or optional optics first; for draw-heavy crowds choose proven cast/echo budgets first.
  5. If the cause is unclear, try one bounded reversible action and observe its effect; do not chain changes or hide sim overload by shedding every visual.
  6. Serialize normal and cliff requests; retain hysteresis, floor, per-user ceiling and cooldown, and never raise at a risky crowd peak or while warm/resize is busy.
  7. Prevent no-op resizes and keep warm airlight, baked pools, grounded silhouettes, clear cues and HUD invariant; use transitions for optional detail if they don't add cost.
  8. Validate in fixed-input synthetic windows, then real adaptive sessions; require an improvement against the same baseline workload, not a lower starting label alone.
- **Verify:**
  - Extend `tests/{perf-core,desktop-lighting}.test.ts`: slow windows, transient spikes, alternating load, 30/60/96/120 Hz cases, bounds and recovery.
  - Script Ultra→High→Medium→Low→Ultra with enough dwell, both routes and DPR changes. Confirm true tier/reason receipts and no rebake/geometry change.
  - Heat/charging/high-DPI, crowds and fast pans on actual devices; log adaptation lag, per-step benefit, settled scale and disruptive reallocation count.
  - Review matched windows around every change: no warm-base drop, thin-source blank, sudden road mirror misalignment, input event loss or cue deletion.
  - Negative tests: sim overload, a single stall, paused/hidden and device cadence changes; no repeated background adaptation or unsupported high-refresh chase.
- **Keep:** Stable identity across transitions, user settings ceiling, protected cues, fixed simulation and a readable Low floor.
- **Budget:** One effective adaptive change per observation window outside justified cliff recovery; no repeated futile toggles or extra resizes for capped targets.
- **Reject if:** A/B stress stays slower or oscillates, the governor makes a dark variant of the stage, or evidence only comes from fabricated frame samples.
- **Rollback:** Turn off the new adaptive decisions or route defaults independently; keep working telemetry, lifecycle repairs and prior lighting continuity.
- **Evidence to attach:** Real tier/scale timeline, same-scale benefit evidence and matched replay clips before, during and after change.
- **Exit:** Quality reacts calmly on measured devices, and the player still sees the same bridge, weapons and attack rhythm at every stop.

## Release playbook

### Test manifest and matrix
- Nominate and record real hardware: a 60 Hz desktop/integrated GPU, a capable 120 Hz desktop if claiming that mode, and physical Android/iOS touch devices for supported routes. Include a hybrid if defaults change.
- Record OS/browser/version, power/thermal state, refresh and variable refresh mode, build/patch, seed/profile history, CSS/backing sizes, route, cap/actual tier/DPR, input and effect flags.
- For warm cost, use identical input/camera scripts: at least five paired runs, 10 s warmup, then 30 s per variant; alternate order and report across-run spread as well as p95/p99/max.
- For load, compare fresh-page cold and in-session retry separately, at least ten same-seed pairs; report click-to-feedback, click-to-interactive and longest foreground task.
- Determine noise and deadline tolerance from unchanged runs before evaluating candidates. Keep thermal trend, sim-drop time and visible long stalls, not just smooth segments.
- For a route/pixel change, run fixed tier/routes at the same supported scale first; run a separate adaptive session for default behavior. Test captures and trace sampling in separate passes.
- Use equal actual backing dimensions for the route A/B; if comparing across all tiers, start at a common 1× test scale. Label forced DPR 2 as a sampler stress fixture, not a shipping default.

| Fixture | Repeatable setup | Evidence / condition to retain |
| --- | --- | --- |
| Idle + live pan | 1280×720 and 1920×1080 CSS, same 1×/1.25×/1.5× as supported; include wider and fractional-zoom passes | Sky/cache receipts, wraps, thin lights, opaque horizon; separate steady and moving performance |
| Portrait + span ends | 390×844 CSS or actual equivalent; fractional scale and forced DPR 2 fixture, zoom, rolls ±0.011 and larger valid ends of gameplay range | No horizon/road clip gap, stable mirror footprint, readable feet, no touch overlap of required cues |
| Duel and lamp crossing | Seeded light scene, fixed walk/jump/dash/parry/charged release and an attack just out of frame | Directions, stance and actual pose at contact; event equality and cue map scores |
| Crowd and boss | Same spawn/event script, overlapping windups, crossing projectiles, hitstop, parry and execution | Slow-frame tail, cast/FX receipts, no lost tell or first input, HUD prompts on time |
| Weather + wetness | Seed 42 real haze→clear→drizzle front, plus distinct wet/storm seed and no-flash control; compare all tiers/routes | Warm RGB stability, aligned rain/splashes, plausible unstacked storm response, bounded rendering |
| Worst overlap | Storm, wet road, nearby lamp, fast dash, bright trail and low HP under scene roll | Native color/grayscale blade read, no excessive flashes, clear status and deadline data |
| Lifecycle | Engage, retry, quit, same-size reseed, 20 resizes/orientations, pause/hide/resume, destroy/remount and lost GPU bake | Post-warm/peak counts plateau; no blank masks/plates, duplicate loop, stale input or lost fallback |
| Adaptive | Synthetic shed/recover and a 10-minute actual fight with busy/calm stretches; capture both desktop/touch defaults | Correct reason/tier/DPR history, no repetitive ladder sawtooth, real presentation and unchanged bridge/cue checks |
| User options | Low/Ultra, particles off/on, shake/gore choices, reduced motion/flash, mute, keyboard/physical touch | Explicit choices honored; protected cue meaning with minimum decoration and no performance claim from emulation |

### Go/no-go tests

```bash
npm run typecheck
npm run lint:bounds
node --import tsx --test tests/{ledger-gen,perf-core,layer-seams,viaduct,weather,storm-engine,shadows,fx-pool,hud-layout,ultra-stack,input-edge-ownership,sim-clock}.test.ts
npm run gate
npm run build:iso
node --import tsx scripts/capture-ultra.ts --motion out/slasher-reference
```

- Also run the per-ticket tests and `.qa/verify-lighting.mts` / `.qa/verify-ultra.mts` from a safe scratch output setup; the latter writes `.qa/post-ultra.png`. Reference outputs are not new shipping assets.
- Known base failures: tight-pack blade cleave and frame-rate-dependent cut depth (`blade-cleave`), welded core strike joint (`full-body`), extra authored sword ritual keys (`ritual-idle`), striking-joint contact (`unarmed-step`).
- Compare named baseline failures and do not amend/skip them for release. Require zero new type/boundary/test errors; a future fix for those five is a separate gameplay change.
- Hard stop: no unhandled frame/page/context errors in supported cases, 0×0 draws, gaps in opaque coverage, unstable sign/reflection sampling, stale inputs, or duplicated damage/score/audio triggers.
- For lifetime-only changes, require unchanged same-backend pixels outside the corrected defect; for tuned optics, predefine comparison regions and tolerances before inspecting candidates.
- Warm gate: keep the existing matched seed-42 `layer-seams` limits (district mean-channel delta <0.01; skyline/horizon/base road <2.5 in the native fixture). Compare intentional new art only after sign-off, never widen a threshold to excuse flicker.
- Play gate: matching live event ticks for same replay, no lost cue at any affected tier/route, and native-speed review by combat and art QA before a new default.
- Pacing target, not a claim: at nominated 1080p settings aim for p95 within one refresh (~16.7 ms at 60 Hz; ~8.3 ms on a separate confirmed 120 Hz device, with stated timing tolerance).
- Reject sustained >10% p95 regression and material p99/missed-refresh regression beyond established noise. Show distributions and foreground stalls; saturated rAF can demonstrate headroom or fewer misses, not extra displayed FPS.
- On physical touch, establish a measured support target for the model/browser rather than promising fixed FPS. Do not approve a win that just lowers matched settings or advances fewer sim ticks.
- Resource gate: plate/surface count and bytes return to the same expected range after resizes/reseeds, no leaked owners or unapproved transient peaks, no recurring steady-state allocations/copies beyond the tested budgets.
- Startup gate: prove the button acknowledgement appears promptly and reported latency improves or is no worse on the matched click path; a smoother chart with a longer hidden start is not a win.
- If an optimization only wins in native canvas, uncapped headless runs or diagnostic injection, label it accordingly and leave the production policy off pending physical evidence.

### Landing and reversing
- Begin with the two failing lifecycle fixtures: repeated resize plus immediate same-size retry in T02; expected post-warm city key list in T03. Fix them in separate changes.
- Submit each follow-up with its ticket ID, code owner, reviewed screenshots/clip, fixed-settings receipt and explicit go/no-go decision. Use `out/` for raw artifacts, not tracked dumps.
- Land ownership/no-work correctness before aesthetic options. Test duel and crowd on the prior warm look before and after each measured change, then rerun the relevant release matrix.
- Keep route, post option, governor policy and optional art cutovers independently reversible. Reverting one must not resurrect unowned surfaces or the old warm-light bug.
- Canary a changed default only for the supported device profiles on which it passed. Record requested/effective settings and exits; don't decide from one anecdote or telemetry alone.
- Gate wider rollout on a logged full-session soak including resize, retry and screen lock. If rollout controls are unavailable, leave new defaults opt-in until the wider test matrix passes.
- Stop rollout if visible deadlines, memory, cue scores, lighting or input get worse. Restore the last signed-off route/policy/paint for that group, not a global downgrade.
- For a no-win hypothesis, record the original comparison, which device/scene failed, and the safe code kept; never pad the plan's outcomes with fictional savings.
- Review sign-off order: resource QA for lifetime, performance QA for physical data, combat/art for feel, accessibility/UI for minimum cues, release owner for final settings and fallback.
- A clean lifecycle fix can ship before an experimental visual optimization. Use the current forward/capture and Canvas fallback until replacements earn their place.
- Definition of done: every R/V finding has a fix or an evidence-based decision to keep a tested path, and the faster build still lets the player see, time and feel the slash.
