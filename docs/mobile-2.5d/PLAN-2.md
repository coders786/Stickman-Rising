# Stickman Rising: graphics, optimization and Moonlit Sakura integration plan

> **Predecessor graphics audit.** The [expanded mobile/all-engine plan](../mobile-2.5d/PLAN.md) now governs mobile budgets, wider engine scope and current evidence status. This document retains the original source witnesses and design history; later browser checks are documented separately, not retroactively claimed here.

- **Date:** 2026-11-14
- **Target repository:** `coders786/Optimization-of-Engines---Stickman-Rising`
- **Audited target revision:** `ffcb3bbcf9631371193afb1e8ab9406a1702cea0`
- **Audited game revision:** `coders786/Stickman-Rising@c857433b57f4a1e9fe514fddd5f190be60eed8c8`

## Decision in one paragraph

Keep the combat, input, tuned animation and useful Canvas artwork. Replace the current Zen scene's *rendering implementation and inconsistent contracts*, not merely its label, with a modular Moonlit Sakura renderer: four quiet mountain ranges, one carefully lit inn, rooted sakura, coherent moon/cloud/fog transport, convincing local water and clear fighters. First repair cache validity, clocks, transforms and evidence. Then compare an improved Canvas backend against a measured WebGL2 compositing/material backend. Spend the saved work on material/lighting quality rather than more full-screen glow. Do not ship the archived five-plane village engine or assume moving Canvas work into a shader automatically makes it faster.

**This deliverable is a source audit and implementation plan, with reproducible source-level probes. It is not an implemented game rewrite or a new FPS result. No remote repository was modified or pushed.**

## 1. What actually exists

The optimization repository currently contains an R&D archive under `work/`; it is not a runnable Next application. Preserve that archive. The game is in the other repository.

The current game has **already incorporated a Canvas reinterpretation** of the Sakura work:

- `src/game/world/zen-night.ts`: four ridge drawings, an inn, a lunar bake, clouds, water-line animation, particles and static prop shadow mask.
- `src/game/render/bhst.ts`: sky cache, wake fog, noise/wind/moon helpers, damage lattice and a CPU integer SAT.
- `src/game/render/renderer.ts`: full Canvas game pipeline, reflection atlas, light rig, post-processing and HUD.
- `src/game/world/horizon-strata.ts`: re-exports, not a separate graphics backend.

A search of the downloaded game source found no WebGL context initialization, GLSL ES 3 shaders, `R16F`, `RGBA16F` or `copyTexSubImage2D`. Its clipped Canvas puddle and CPU SAT are **not** the archived WebGL optics/shadow implementation. Some source comments describe stronger guarantees than the code provides.

The application already separates React's discrete UI events from the frame loop. Do not rewrite React or Prisma/database code to solve a fill/compositing problem. The large dependency list is not proof that every dependency enters the browser bundle; inspect the actual bundle before making that claim.

### Prior work to preserve, not blindly transplant

The archived optics release is `work/moonlit-sakura-optimized.html`, 96,166 bytes, SHA256 `b1845d5d2b3adfeb47f3d810a3556e37f90ab9d510f05b34090d0ef51ac8bff0`. Its documented whole-renderer software-GPU comparison was 7.5% less GPU time than its preceding scene, not a universal hardware/FPS claim.

The archived village is 145,355 bytes, SHA256 `14143ecfb36335586a2f24ef099c0e26e3a836b1f86799da64eb90a219d8e36b`. Its final shadow engine saved 46.3% against the same-village Direct reference but was 14.4% slower than the smaller released scene, with 27.56 MiB versus 10.93 MiB of logical texture storage. It was not promoted. Those historical results do not establish the performance of a TypeScript/Canvas port.

The target's `work/evidence-mountains/PLAN.md` remains a plan; the separate game now has its own mountain implementation. Keep that provenance explicit.

## 2. Investigation performed for this plan

- Retrieved pinned public source trees and downloaded text references. `SOURCE-MANIFEST.json` records the reference file paths, byte counts and SHA256 values.
- Inspected the game orchestration, background contract, Zen scene, BHST, main renderer, light rig, lighting math, look policy, character draw/shadow paths, application mount, Next config and existing evidence/tests.
- Re-ran the selected upstream optics/shadow tests: **11 passed**.
- Added `audit/probes.ts` and executed targeted checks against the **unmodified pinned source**.
- Ran **30,000** static SAT versus always-12-tap comparisons: **zero mismatches**, maximum error zero for that nearest-texel reference and tested domain.
- Generated a native-Canvas **background-only** illustration for composition inspection. It is not a browser/gameplay screenshot and excludes the game's global lightmap, bloom, grade, HUD and actors.

Environment for these checks: Node 20.20.2, `@napi-rs/canvas` 1.1.1, `tsx` 4.23.15. The full application declares Node >=22.12.0. The small probes are not a substitute for building/testing the full application under its supported toolchain.

**Not done:** a full application build, a browser performance comparison, a hardware GPU test, a new integrated renderer or remote commits. Historical benchmark files are evidence to audit, not newly reproduced measurements.

## 3. Confirmed weaknesses and priorities

Legend: **probe** = executed targeted reproduction; **source** = direct code observation; **historical** = existing repository record; **hypothesis** = requires full-engine profiling.

| ID | Priority | Weak point / evidence | Required action |
|---|---|---|---|
| F01 | P0 | **Benchmark provenance:** the 73.3-FPS `research/perf-sakura.json` sample has a **1024×576** backing canvas: only **64%** of 1280×720 area. The surrounding narrative does not establish equal backing resolution. | Freeze viewport, physical backing, tier, governor, effects, scene, commit, seed and timing method. Withdraw/requalify same-quality ratios until reconciled. |
| F02 | P0 | **Sky motion is held, not merely artwork cached.** `SkyVaultCache` uses `dt >= .22`, despite other 24-Hz/42-ms comments. Actual 60-draw probe refreshed on frames 0,14,28,42,56—about **4.3 Hz** between refreshes. Twinkles/clouds inside the cache inherit that hold. | Cache invariant artwork; transform layers and evaluate dynamic motion at display cadence. Separate expensive field generation from moving/twinkling outputs. |
| F03 | P0 | **Not a temporal bracket.** `drawSky` stores past/current scalar samples and uses `min(A,B)`; there is no pair of time endpoints or interpolation factor. | Implement genuine `t0 <= t <= t1` keys, or accurately name a sample-and-hold filter. Preserve direct reference for comparison. |
| F04 | P0 | **Moon filtering depends on draw count.** The update multiplies by `rate*60`, not dt. Same 0.1-second controlled input: 6 draws -> 0.76307; 14 draws -> 0.81062. Paint callback was stubbed, original visibility update was executed. | Move state evolution into update; use `a=1-exp(-dt/tau)`. Repeated drawing of the same frame must not advance visual simulation. |
| F05 | P0 | **The port changed the wind equation.** Its safe coefficient bound is **1.292 M**, not the original renderer's `0.85 M`; sampled maximum for M=1 was **1.28251**. Multiplying its antiderivative by changing `storm.wind` also breaks the claimed derivative identity. At t=10 the reported vx was 0.53387, while the displacement finite difference was 1.10483. | Choose one documented wind model, integrate its actual varying-strength law or maintain continuous piecewise offsets, and regenerate envelope proofs for that model. Do not reuse old bounds. |
| F06 | P1 | **Shared-cloud claims do not match consumers.** `cloudNx` has its own integration; visual bank shapes/centers differ from `sampleTransmission`; the latter samples a coarse scalar proxy. | One cloud packet, coordinates and density/coverage function for art, moon extinction, shafts, floor light and water. |
| F07 | P1 | **Reflection cache invalidation is incomplete.** Key includes span width and quality, not pose/location identity. On allocation, reflPW/reflPH are updated before the dirty test. Probe reproduced an **empty new atlas** and a stale same-width moved actor. | Dirty on allocation/generation, camera origin, pose revision, actor membership, clipping changes and lighting revision. Better: root-independent per-actor reflection islands. |
| F08 | P1 | **Reflection error claim is arithmetically unsupported.** 2,600 px/s at 20 Hz permits **130 world pixels** between refreshes before projection, not universally <1.5 px. Horizontal displacement is not removed by vertical foreshortening. | Measure projected joint error, not an arbitrary fixed Hz. Refresh hazardous poses immediately; reuse genuinely static poses. |
| F09 | P1 | **Light color missing from signature.** Changing only point-light RGB red -> blue kept an identical cached map; a fresh blue rig differed. | Include RGB, source identity/revision and every shading input in typed cache keys. Add regression test. This is a latent bug when source color varies. |
| F10 | P1 | **Camera transforms disagree.** World draw includes `cam.rot`; light sx/sy and surface-wash transform omit it. Math witness at relative point (200,-100), zoom 1.2, roll .07 differs by **18.78 screen pixels**. | Supply shared world-to-screen and inverse matrices. Test roll/shake/zoom/resize. This witness is not a full-frame pixel measurement. |
| F11 | P1 | **Correct static SAT, incomplete scene integration.** Prop mask is hand-authored and preprojected at fixed shear; it is not the same geometry as the visible inn/tree and does not track current light projection or sway. | Shared caster geometry + current light transforms. Static SAT only for static data; uncertain dynamic regions must sample a CURRENT mask. |
| F12 | P1 | **A sample-footprint proof is being applied to a wider drawing parcel.** A ray disk around a glint center controls a whole horizontal rectangle, up to 346 world pixels wide. It does not certify the whole rectangle. The diffuse pool is not SAT-modulated in its code path despite its comment. | Certify parcel support plus penumbra, subdivide crossed parcels, or shade receivers per pixel. Keep per-light visibility. |
| F13 | P1 | **Bloom is not the selective pass described in comments.** `BLOOM_BRIGHTPASS` is declared but unused; the refresh copies the rendered scene. The archived sample attributes 10.03 of 13.64 ms (~73.5%) to bloom. | Profile anew, then compare an explicit emissive buffer against whole-scene capture. `drawImage(canvas)` can cause synchronization/copy cost but is NOT itself CPU readback. |
| F14 | P1 | **Drawing mutates visual simulation.** Wake fog is stepped/injected inside `Renderer.draw`; petals spawn random ripples inside `drawWeather`. Paused/repeated draws can change effects. | Pure immutable frame packets. Advance visual systems exactly once in update; generate events on actual world-space crossings. |
| F15 | P2 | **Damage-lattice port loses coalescing and union counting.** It issues per-cell clears and counts both lists before unioning. Probe: identical **32%** coverage selected a full clear on the third begin. | Unique bitset union, count once, merge horizontal runs, preserve fractional-DPR floor/ceil coverage and context state. |
| F16 | P2 | **Cold/resize work is synchronous on first draw.** `ensure()` invokes sprite/sky/world/shadow baking in a batch. Art is not a quality-tier rebuild anymore—that earlier bug is fixed—but real resizing/first use can still hitch. | Staged baker / worker-capable assets, versioned generations, retain old complete generation until new one is ready. |
| F17 | P2 | **"Zero allocations" is overstated.** Light/figure pushes create objects; emitter fills allocate, sort and map; the sky callback builds arrays. | Trace GC first; replace hot allocations with retained packets only where measurable. Do not make this the first optimization while bloom/fill dominates. |
| F18 | P2 | **Initial-load risks:** static Game/debug imports and an unconditional catch-all `no-store` Next header policy. | Bundle/response inspection, lazy diagnostics, production-aware caching. These are loading/latency work, not an in-frame GPU FPS fix. |
| F19 | P2 | **Generalized performance claims:** explicit world-source cropping does not by itself prove 55% less physical fill; browsers already clip destination draws. Likewise 1:1 CPU-Skia wins are not universal hardware-GPU laws. | Measure actual backend and completed frame cost; retain cropping where useful, drop unsupported universal percentages. |
| F20 | P2 | **Art/document drift:** the 12 listed blossom-cluster counts sum to **314**, not the claimed 248. Three arbitrary Canvas sine-line frequencies are described as a gravity-capillary implementation. | Treat code/art parameters as generated manifest data; state which features are stylized proxies and which use the dispersion relation. |

### Good decisions already present—do not regress them

- Background quality changes use `setQuality`, not wholesale scene reconstruction.
- No-op Canvas resize avoids needless backing allocation.
- Scene-owned moon shafts prevent the generic duplicate system from running.
- Only one universal vignette is owned by the renderer in the current Zen scene.
- Geometry, particles and several sprites are already retained or pooled.
- React receives discrete events rather than per-frame state.
- The static CPU SAT correctly matched its tested static nearest-sample reference.
- Frame telemetry now calls its residual `wait`, not actual GPU time. Still, rAF interval is callback pacing, not proof of presented frames, and small JS time cannot exclude a GPU bottleneck.

## 4. What 'true graphical level' should mean

For this project the appropriate target is **high-quality stylized 2.5D**, not calling every projection 'ray tracing' or adding enough bloom to hide flat art.

1. **Coherent lighting:** the visible moon, occluding cloud, floor illumination, body rim, shadow and water glint all agree.
2. **Material distinction:** roof tiles, plaster, timber, stone, wet boards, cloth and blossom translucency react differently.
3. **Grounding:** planted feet, contact shadows, water/reflection anchors and prop bases share one surface convention.
4. **Depth hierarchy:** four quiet atmospheric ridges; detailed architecture only in the focal zone; no background village.
5. **Temporal stability:** slow background motion is continuous; blades/reflective silhouettes do not stall at 20 Hz; no cache/color/resize pops.
6. **Combat readability:** silhouettes, blade arcs, anticipation and contact frames dominate, not decorative particles or mist.

### Art direction: Moonlit Sakura / quiet mountains

- **Composition:** one warm inn as the architectural focal anchor, moon offset above it, sakura framing rather than occupying the combat lane. Preserve the game's camera/travel envelope instead of pasting a screenshot composition into every view.
- **Mountains:** four approximately parallel ranges. Reduce uniform bright crest outlines and repeated jagged noise. Use large authored peak/valley rhythm, sparse snow on moon-facing high planes, very small conifers and increasing atmospheric softness with distance. No extra houses/streets or expensive mountain animation.
- **Inn:** shared parts for roof silhouette, timber/plaster, door/shoji, noren, lantern and caster geometry. Variation in roof tiles should be directional and restrained. Amber light spills on the actual threshold and wet boards, not a disconnected broad orange wash.
- **Deck:** boards read as timber rather than a uniform tile grid. Bake grain, seam AO, damp islands and roughness variation. Stable material data can be richer without more per-frame path calls.
- **Sakura:** rooted trunk; separate canopy/branch motion from root placement. Cluster-level value masses first, individual flowers second. Fix the documented count instead of pretending 314 is 248. Keep counts fixed during optimization A/B; any deliberate art-count redesign is a separately reviewed visual change.
- **Moon/clouds:** one moon disc and a distinct halo sprite. All atmospheric clouds are physically in front of a celestial moon if they overlap it; do not solve a dark-bank problem by declaring local clouds behind the moon. Change bank placement/art response or use real transmittance.
- **Water:** a dark local reflecting material, not cyan sine scribbles on an ellipse. Reflected moon/inn/sakura/actors use the same scene state and a wetness mask; roughness controls distortion, glint width and reflection strength.
- **Fog/FX:** ankle/shin-level atmosphere in the battle corridor, deeper shafts behind actors; reserve the strongest accents for blades, impact and lightning. Foreground silhouettes must not cover contact cues.
- **Color:** cool desaturated indigo/slate environment, selective pale moon edges, warm amber practicals and localized pink blossom highlights. Do not keep universal cyberpunk cyan/magenta bounce in a scene with no matching emitters.

The generated background-only reference reveals the hierarchy problem: similarly outlined ridge bands, flat facade masses, highly regular floor lines and flower icons compete for attention. That illustration is useful for art direction, but the full final game must be reviewed with its additional lightmap/post effects and actual actors.

## 5. Rendering architecture to build

### Repository layout (proposed, not yet implemented)

```text
work/                            # preserved historical HTML/modules/evidence
apps/stickman-rising/             # pinned game import, runtime assets only
packages/scene-contracts/         # coordinates, materials, frame packets
packages/sakura-art/              # procedural asset sources and build manifests
packages/sakura-renderer/
  canvas/                        # corrected reference/fallback backend
  webgl2/                        # candidate material/compositor backend
  shaders/
  cache/
  shadows/
  reflections/
docs/graphics-optimization/       # this plan, experiments and source evidence
audit/                           # reproducible source-level probes
bench/                           # to be implemented: browser replay/profiling
```

Import the game at the audited SHA into this target repository on an integration branch. Preserve notices and record source revision. Do not pull 237 MiB of research videos/contact sheets into a production web bundle, and do not install or serve `work/evidence*` as runtime assets.

### One authoritative frame packet

A `SceneFrame` must be built once per presentation from already-solved simulation poses and a documented visual clock:

```ts
interface SceneFrame {
  readonly simTime: number;
  readonly visualTime: number;
  readonly visualDt: number;
  readonly generation: number;
  readonly viewport: { cssW:number; cssH:number; backingW:number; backingH:number };
  readonly camera: { worldToScreen:Float32Array; screenToWorld:Float32Array; revision:number };
  readonly wind: { velocity:Float32Array; displacement:Float32Array; modelRevision:number };
  readonly lights: readonly LightPacket[];
  readonly actors: readonly SolvedDrawPacket[];
  readonly cloudRevision: number;
}
```

This is an interface sketch, not delivered runtime code. Use stable storage/read-only views rather than allocating every nested object each frame. Drawing may mutate caches, but may not mutate simulation, consume gameplay RNG or advance visual time.

### Keep two backends until there is evidence

**Canvas backend:** fix invalidation, temporal/camera contracts, draw purity, damage coalescing and asset preparation first. This provides the same-feature reference and fallback.

**WebGL2 candidate:** upload static procedural art/material fields once, shade cached artwork with common light/coverage data, execute local water/atmosphere work, accumulate explicit emissions and combine post effects in one final pass. Reuse established cloud-density/media formats and premultiplied-alpha handling from the optics release, but adapt world units and horizontal game-camera movement.

Do **not** call a GPU pipeline finished by drawing a full-resolution Canvas frame into a texture every frame. At 1920×1080 RGBA8 that source alone is 8.29 MB/frame, about 498 MB/s at 60 uploads/s before driver overhead. Actual upload pathways may optimize this, but it is a cost to measure, not assume away.

For an incremental bridge, prototype bounded changed actor islands and measure upload bytes/time; static artwork uploads only on generation changes. A direct GPU draw-packet path for characters can follow if the bridge misses budget. Do not alter IK, hitboxes, authored held poses or front/back limb order to fit the renderer.

A temporary WebGL-background/Canvas-actor overlay needs a **transparent** actor canvas; the current `{alpha:false}` canvas would cover it. Global bloom/lighting spanning both canvases cannot be treated as already solved. Final shared post-processing needs one compositing owner or explicitly managed emission bridges. Feature-flag this architectural work.

### Candidate final render graph

1. Static albedo/material atlas + continuous parallax transforms.
2. Cloud density/time keys + shared moon-aperture transport.
3. World surfaces with per-light visibility and linear material response.
4. Current solved actors/weapon packets and contact shadows.
5. Local water/reflection pass restricted to wet receivers.
6. Behind/in-front atmosphere with consistent coverage/depth conventions.
7. Explicit emission atlas -> localized bloom.
8. One final linear-to-display tone/grade/vignette/grain pass.
9. Crisp HUD excluded from bloom and scene tone.

Do not algebraically fuse noncommuting Canvas blend operations and claim identical output. Write the intended new color/alpha equation, compare against a reference, then decide whether any difference is an accepted art change.

## 6. Scene-specific techniques to invent and compare

These are **new design proposals for this project**, not claims of world-first algorithms or measured speedups. They combine established methods with the scene's geometry, motion and visual priorities. Full math, controls and kill criteria are in [EXPERIMENTS.md](EXPERIMENTS.md).

| Technique | What it reuses / why it could improve both quality and cost | Control |
|---|---|---|
| **Aperture-Coherent Moon Transport (ACMT)** | One cloud/coverage packet drives moon, shafts, floor key and reflected sky; expensive smooth fields get genuine bracketing, sharp edges get native evaluation. | Direct same-field evaluation. |
| **Response-Basis Art Packets (RBAP)** | Rich static art plus authored material/light-response data; current lights shade it instead of stacking many large painted pools. | Existing Canvas art/light composition at fixed resolution and a direct material shader. |
| **Motion-Certified Reflection Islands (MCRI)** | Cache actor-local silhouette/material islands, move roots live, refresh shape by projected joint error and state events, not a fixed 20 Hz. | Full current-pose reflection every frame. |
| **Emitter-Footprint Bloom Ledger (EFBL)** | Explicit emitters, a blur-support-expanded dirty union and local bloom work rather than copying the entire live scene. | Same emission/kernel evaluated full-target every frame. |
| **Shadow Witness Parcels (SWP)** | Certify complete receiver parcel plus ray support against shared caster data; split uncertain parcels or use direct taps. Compare cheap bounds/row spans before paying for a SAT. | Direct current-mask 12 taps at every reference receiver. |
| **Continuous Sky Slices (CSS)** | Cache artwork of separate depth planes, not a frozen composite; transform/parallax and twinkles remain live. | Direct uncached same-art composition. |
| **Contact-Locked Draw Packets (CLDP)** | One current solved geometry/ordering packet supplies visible body, reflection, shadow and trail support. | Existing full-draw functions with identical poses. |

Each invention must beat both a simple correct baseline and a suitable established alternative. A fancy name does not establish a win. If an additional pass or cache increases total cost, reject it and keep the simpler implementation.

## 7. Implementation order and pull-request gates

### PR 0 — Source import and honest benchmark foundation

- Bring pinned runtime source into `apps/stickman-rising` in this repository; keep `work/` immutable.
- Establish Node >=22.12 supported toolchain and existing app lockfile; run full typecheck/lint/test/animation suites.
- Add fixed-seed replay scenes, fixed camera and a **quality lock** that disables DPR/tier/cadence governors for comparison.
- Record CSS and physical sizes, browser/OS/GPU/backend, refresh pacing, all counts, effect settings, exact SHA and warmup.
- Separate JS submission, completed-work diagnostic timing, rAF callback pacing and trace-derived presentation metrics. No actual GPU-time label for Canvas residuals.
- Keep `getImageData`/readback flush experiments out of production and separate them from unflushed traces.

**Exit:** reproducible identical-input baseline. A JSON record with missing metadata is not a valid release comparator.

### PR 1 — Correctness and cache contracts before new art

Files: `game.ts`, `renderer.ts`, `lights.ts`, `look.ts`, `bhst.ts`, `zen-night.ts`, camera contract.

- Fix reflected-atlas allocation/invalidation, RGB/revision keys and matrix consistency.
- Move moon filtering, wake fog and ripple generation to update.
- Choose and document the wind law; support variable strength without displacement jumps or invalid envelopes.
- Replace misleading 'bracketing' with actual timed keys or accurately named filtering.
- Coalesce the unique damage union and preserve fractional backing coverage.
- Make paused/repeated render snapshots stable, keeping intentional camera/UI behavior explicit.

**Exit:** new regression tests fail on old source, pass on corrected source; no combat-state, timing or animation regression. Correctness changes need not pretend to be speedups.

### PR 2 — One scene/light/geometry contract and art baseline

- Introduce `SakuraScene`, material IDs, common camera matrices, canonical prop parts and shared emitter anchors.
- Create art-only previews for noon-neutral, moon, door-only, storm and grayscale readability.
- Split rooted sakura trunk/crown; root stays planted.
- Author four minimalist ridge profiles and material-aware inn/deck/stone artwork offline or at initialization.
- Separate scene revisions: visual art changes are reviewed independently of optimization ratios.

**Exit:** approved whole-game art baseline at combat zoom, not only a pretty background still. Actual counts and asset extents are generated manifest data.

### PR 3 — Benchmark the compositor/material vertical slice

- Prototype WebGL2 scene-composition ownership behind a feature flag.
- Draw one representative camera with static art, actors, moon/clouds, two practical lights, local water and bloom.
- Compare corrected Canvas, direct WebGL and factored WebGL at identical physical output.
- Measure upload bytes, first-frame shader cost, logical texture memory, total completed frame cost, GC/long tasks and p95.
- Validate float/packed paths and premultiplied alpha. No full-frame Canvas upload hidden in an 'optimized' GPU number.

**Exit:** same-quality benefit on target hardware, or reject/reduce the migration. Keep a Canvas production path until this gate passes.

### PR 4 — Shared optics and meaningful water

- Port ACMT and the established edge-guard/direct-reference fog logic; genuine future/past keys only for evaluable analytic fields.
- Three analytic waves with a documented world-to-meter scale and dispersion relation; analytic normals.
- Project current scene/actor reflection packets, Fresnel/roughness response and optical-depth fog; restrict water shading to projected wet support.
- Preserve the dry base via a GPU-side copy or direct base texture only if this beats recomputing the necessary material. `copyTexSubImage2D` is a candidate, not a mandatory ritual.

**Exit:** no moon/cloud light disagreement, stable reflected anchors, correct roughness range, no edge leaks in landscape/portrait or camera roll.

### PR 5 — Motion-certified reflections, shadows and local bloom

- MCRI with actor-local root tracking, state/visibility hazards and error-triggered refresh.
- SWP compare Direct, complete-footprint bounds, row intervals and SAT. Use the light/geometry configuration actually present; do not import five village planes.
- Static certificate data stays static; live uncertain masks update. Validate every certificate against current visible geometry, not only its own stale mask.
- EFBL explicit emitters; dirty union includes old/new support, blur halo and every camera transform. Full refresh after resize, context recovery or saturation/high coverage.

**Exit:** correctness/image gates plus improved whole-scene median/p95 or a clearly documented richer-art-within-budget outcome. Reject optimizations that only win in isolated kernels.

### PR 6 — Predictable asset preparation and lifecycle

- Staged `prepare()` with generation IDs. Keep the last complete frame/assets while new bakes build; never expose half-built plates.
- Compare worker/OffscreenCanvas, build-time image artifacts and incremental main-thread bakes. Workers improve responsiveness, not necessarily total throughput.
- Reuse immutable moon/noise across actual scene rebuilds; bound caches with eviction/accounting.
- Context loss/restore must recreate resources, bindings, programs and cache revisions without duplicate rAF or listeners. Canvas fallback remains usable.
- Remove full diagnostic tables/debug inspector from the initial production path unless requested. Fix production caching policy after checking actual served headers.

**Exit:** no sustained memory growth through 20 scene/resize cycles; no gameplay first-use rebake stall; feature/capability fallback tests pass.

### PR 7 — Spend the recovered budget on art, then release

- Re-light the inn and deck with material variation; thin/subsurface blossom response, restrained dust/petals and defined reflected highlights.
- Preserve readable silhouette/weapon contrast during the strongest storm and FX stacks.
- Final quality/performance/device sweep; asset/source/case manifests and side-by-side inspection of motion, not just screenshots.
- Feature-flag rollout, old backend retained for one release, clear rollback and browser-capability policy.

**Exit:** accepted art direction and test/benchmark gates below. Do not promise a fixed multiplier before this experiment exists.

## 8. Performance targets—not results

Provisional release objective on explicitly nominated real target devices:

- 60-Hz target: p95 render completion within a **16.67 ms** display budget with usable margin; p99 <=33.3 ms and <1% missed target intervals in the declared stress replay.
- Optional 120-Hz mode is a separate 8.33-ms target, not inferred from average throughput.
- Working budgets to tune after baseline: simulation <=2 ms, render submission <=2 ms, GPU render/composite <=10 ms at p95 on the nominated 60-Hz device. CPU/GPU overlap means these numbers must not be naïvely added or presented as guaranteed.
- No steady-state >50-ms long tasks from baking, shader compilation, reallocations or GC. Report startup and transitions separately.
- Initial engine-owned logical texture ceilings to validate: 64 MiB at 1280×720, 96 MiB at 1920×1080. These are provisional design budgets, not total browser/driver memory guarantees; reduce optional allocations/duplicate targets before sacrificing art.
- A performance-only candidate should show a repeatable improvement beyond noise (aim >=15% center improvement in its target stress case) without >3% repeatable regression in other nominated cases, or be rejected. Small correctness fixes are worthwhile regardless of FPS.
- A graphics feature can be accepted without being faster if it stays within the approved frame/memory budget. Label that as a feature, not a speedup.

No downscaled backing, deleted effects, lower population, shorter shadow kernel or slower presentation may be hidden inside a same-quality win. Explicit user-selected compatibility modes may make tradeoffs; benchmark and describe them separately.

## 9. Required test matrix

### Cases

- Idle/calm, 0 enemies; 8/16/32 enemies; boss and each entry in `SWORD_ORDER`.
- Dash, air jump, heavy slash, parry, execution, hitstop and slow motion; overlapping projectiles/particles.
- Camera pan, shake, +/-roll and zoom 0.85..1.3; scene edges and rapid reversals.
- 1280×720, 1920×1080, ultrawide and portrait 430×932; DPR 1/1.25/1.5/2, with locked physical dimensions for A/B.
- Scripted storm flashes and fades; cloud-to-moon crossings; room-light flicker/color change; moving canopy.
- Resize during a reflection-cache hit; actor spawn/despawn without span-width change; window/visibility pause/resume; repeated renders of an identical packet.
- Float targets unavailable, context loss, Canvas fallback and reduced-motion preference.

### Methods

- Deterministic independent seeds for gameplay and visual noise/particles/grain. Rendering and cache decisions must not consume gameplay RNG.
- Warm/cold runs separate; at least three counterbalanced A/B page pairs; retain raw samples, medians, p95/p99, long tasks and event-aligned hitch traces.
- Browser performance trace and async non-disjoint GPU queries where available. Canvas JS call duration does not establish raster completion; rAF does not prove presentation; software benchmarks cannot promise user hardware FPS.
- No production `gl.finish()`, framebuffer readback or per-frame `getImageData` added to make telemetry convenient.
- Desktop Windows Chromium/Edge hardware GPU, an integrated-GPU laptop, midrange Android and Safari/iOS where supported. CI software-rendering results are correctness/smoke evidence, not device certification.

### Numerical and visual gates

- Cache keys cover all dependencies, reset on reallocation/generation change and cannot alias different actor sets.
- Cloud density/UV tests verify art and light transport agree under camera/wind/time changes.
- For culling certificates, require zero false accepts against the direct current-mask reference across randomized/adversarial footprints and motion bounds. Native shader image differences have explicit per-channel/edge thresholds; do not silently adopt an old tolerance for a different renderer.
- Reflections: proposed <=0.75 physical-pixel shape error in high-contrast regions, otherwise refresh; transitions bypass cache. Verify bounds after wave displacement and projection. Do not enforce a low refresh ceiling that makes this impossible.
- Storm/cloud/contact-edge crops inspected frame-by-frame. Retained static art should be exact where claimed; approximate field paths document max/p99 errors and exceptions.
- Alpha/transparent-gutter, fractional-DPR damage and boundary sampler tests. For the GPU field path, distinguish NEAREST native visibility from linearly filtered smooth media.
- Combat replay state/confirmed-hit checksum unchanged by renderer/backend selection. Pose/animation continuity, front/back limb order, foot contact and sword socket remain intact.

## 10. Risks and explicit stop rules

1. **WebGL migration loses to accelerated Canvas:** stop or narrow it; ship useful Canvas correctness/art improvements.
2. **Reflection reuse fails fast poses:** refresh those poses; do not blur away the failure and claim quality preservation.
3. **SAT preparation costs more than 12 taps for a few props:** prefer bounds/row spans/direct taps. The current CPU field is 640×80, not the old village's 2048×768 GPU SAT; do not conflate their memory costs.
4. **Emission bloom differs from old whole-scene bloom:** approve it as an art/lighting redesign. Test its local-vs-full emission implementations with the same equation.
5. **Many small dirty rectangles exceed one full pass:** use measured backend-specific crossover, not blind attachment to 58% for every subsystem.
6. **Rich art increases cold startup:** move generation earlier/off-thread/offline and stream generations. Do not move the stall into combat.
7. **Approximate light basis changes storm shape:** use direct material evaluation near the hero and mark the approximation; do not call averaged light vectors physically equivalent to multiple source shadows.
8. **Native canvases/driver behavior differ:** repeat on browser hardware. The source-level probes prove the specific invariants/bugs stated, not platform timing.

## 11. Deliverables and current completion status

**Delivered in the local target checkout:** this plan, experiment specifications, source manifest, structured findings, reproducible probe source, exact minimal audit dependency lockfile, targeted upstream test output, probe results and a labelled background-only reference image. A compact review archive/patch can carry these without copying the game or installing its full dependency tree.

**Next implementation action:** import the pinned game into the optimization repository, establish the honest baseline (PR 0), and apply PR 1. Do not start by adding more particles, a larger bloom pyramid or the old experimental village.

### Source references (pinned)

- [Game orchestration / clocks / governor](https://github.com/coders786/Stickman-Rising/blob/c857433b57f4a1e9fe514fddd5f190be60eed8c8/src/game/game.ts)
- [Current Zen scene](https://github.com/coders786/Stickman-Rising/blob/c857433b57f4a1e9fe514fddd5f190be60eed8c8/src/game/world/zen-night.ts)
- [BHST, wind, damage and CPU SAT](https://github.com/coders786/Stickman-Rising/blob/c857433b57f4a1e9fe514fddd5f190be60eed8c8/src/game/render/bhst.ts)
- [Renderer and reflections/bloom](https://github.com/coders786/Stickman-Rising/blob/c857433b57f4a1e9fe514fddd5f190be60eed8c8/src/game/render/renderer.ts)
- [Light-map caching](https://github.com/coders786/Stickman-Rising/blob/c857433b57f4a1e9fe514fddd5f190be60eed8c8/src/game/render/lights.ts)
- [Lighting/projection math](https://github.com/coders786/Stickman-Rising/blob/c857433b57f4a1e9fe514fddd5f190be60eed8c8/src/game/render/lighting.ts)
- [Historical performance narrative](https://github.com/coders786/Stickman-Rising/blob/c857433b57f4a1e9fe514fddd5f190be60eed8c8/research/RENDER_PERFORMANCE.md)
- [Historical Sakura sample](https://github.com/coders786/Stickman-Rising/blob/c857433b57f4a1e9fe514fddd5f190be60eed8c8/research/perf-sakura.json)
- [Existing optics tests](https://github.com/coders786/Stickman-Rising/blob/c857433b57f4a1e9fe514fddd5f190be60eed8c8/tests/moonlit-sakura-optics.test.ts)
- [Target archive and earlier evidence](https://github.com/coders786/Optimization-of-Engines---Stickman-Rising/tree/ffcb3bbcf9631371193afb1e8ab9406a1702cea0/work)
