# Research notebook — mobile web, stylized 2.5D and developer experience

**Reviewed 14 November 2026.** Companion to [PLAN.md](PLAN.md) and [TECHNIQUES.md](TECHNIQUES.md). Source code is pinned separately; external pages can change. These sources inform design choices, not performance forecasts for this game.

## How evidence is weighted

1. Executed reproductions of the pinned game are the strongest evidence about its behavior.
2. Source observations identify real data flow, but do not measure the cost of that flow.
3. Primary API/vendor/paper guidance explains mechanisms and limitations.
4. Developer discussions supply failure modes and experiments to try. Their devices, dates, engines and versions matter; their FPS numbers are not ours.
5. New reference-model checks prove only the invariants actually tested. They are not production implementations.

Search results also contained attractive but unsupported claims: Canvas is never accelerated; a WebGL context is always faster; `powerPreference` forces hardware acceleration; WebP automatically reduces decoded GPU storage; a texture atlas guarantees one draw; all stutter is GC; moving work to a worker eliminates GPU cost. None is used as a premise here. No studio-quality or mobile-FPS promise is derived from a tutorial or forum anecdote.

## Primary sources and engineering decisions

### R01 — MDN: WebGL best practices

Citation: [1](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)

- Relevant guidance: estimate resource use conservatively; WebGL has no portable available-VRAM query; avoid production blocking queries/readbacks; handle context loss; distinguish CSS size and backing size. Search extracts and the beginning of the live document were reviewed, not every section of every linked reference. [1](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
- **Decision:** a resource ledger and a same-backing-size benchmark are mandatory. No `readPixels`, `getImageData`, `gl.finish` or shader-log query in the production hot path merely to feed a profiler. Debug synchronization experiments are separate.
- **Does not establish:** that Canvas is CPU-only, that a particular texture format is available, or that 32/48 MiB is safe on every phone. Our budgets are project proposals.

### R02 — Arm: optimization advice for mobile graphics, version 1.0 (2024)

Citation: [1](https://documentation-service.arm.com/static/65952df1159ca73387227425?token=)

- High overdraw can be costly even when individual layers are simple; high pixel count/refresh increases the cumulative work. The reviewed section discusses opaque versus transparent content and cumulative overdraw. Reviewed search-extracted sections, not the entire manual. [1](https://documentation-service.arm.com/static/65952df1159ca73387227425?token=)
- **Decision:** count the complete graph and bound clouds, water, bloom, masks and HUD effects by their real coverage. Baking static transparencies together is preferred to layering them forever.
- **Limit:** native GPU advice must be translated to browser APIs. Do not assume direct control over tile scheduling, internal Canvas storage or compressed framebuffer behavior.

### R03 — Arm: GPU Best Practices revision 3.4

Citation: [1](https://documentation-service.arm.com/static/67a62b17091bfc3e0a947695)

- The reviewed guide warns that a depth prepass duplicates geometry/draw work and can cost more than the overdraw it removes on Arm GPUs. Its recommendations also distinguish newer hardware capabilities. [1](https://documentation-service.arm.com/static/67a62b17091bfc3e0a947695)
- **Decision:** no desktop-style depth prepass/G-buffer is prescribed for this mostly layered 2D game. Compare a bounded forward material compositor first.
- **Limit:** this is not a universal prohibition for every GPU/workload; it is a reason to reject a cargo-cult architecture.

### R04 — Arm: console-quality rendering on mobile (2017)

Citation: [1](https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/console-quality-game-rendering-on-mobile)

- Mobile form factor and passive cooling constrain sustainable work, not merely the first few seconds of rendering. The article emphasizes removing redundancy and minimizing work/data movement. [1](https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/console-quality-game-rendering-on-mobile)
- **Decision:** test 20-minute runs and record the final minutes separately. An initially high FPS result followed by throttling does not pass.
- **Limit:** the article's historical power examples are not a measured power budget for the user's phones.

### R05 — PixiJS v8 performance guidance

Citation: [1](https://pixijs.com/8.x/guides/concepts/performance-tips)

- Relevant guidance: batch compatible artwork; use atlases; constantly changing complex Graphics and text can be costly; bound filter areas; masks/filters have different costs; culling can hurt a CPU-bound scene. The full performance-tips page was fetched. [1](https://pixijs.com/8.x/guides/concepts/performance-tips)
- **Decision:** cache rich static art, reuse actor packets, cache HUD labels and compare simple culling against no culling. Respect transparent draw order rather than sorting everything by material.
- **Limit:** Pixi internals and its sprite batching limits do not automatically describe this game's custom Canvas renderer. This is not a recommendation to migrate the entire game to Pixi.

### R06 — Glenn Fiedler: Fix Your Timestep!

Citation: [1](https://gafferongames.com/post/fix_your_timestep/)

- The article describes the accumulator, fixed steps, presentation interpolation and the spiral of death when catch-up work outpaces real time. [1](https://gafferongames.com/post/fix_your_timestep/)
- **Decision:** retain bounded work, but make overload policy explicit. Do not label a 50 ms variable catch-up update “always 1/60.” Keep authored exposure selection separate from root/camera interpolation.
- **Limit:** a fixed step alone does not make random input, floating-point behavior or draw-mutated state deterministic. Interpolation can add latency; measure it rather than assuming it is free.

### R07 — GPU Gems, Mark Finch: Effective Water Simulation from Physical Models

Citation: [1](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models)

- Summed periodic waves have explicit parameters and analytic derivatives; geometric motion and fine normal detail can be separated. Gerstner steepness must be bounded to avoid loops. Reviewed search extracts and the first fetched section, not every linked implementation. [1](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models)
- **Decision:** use a small analytic surface plus event-driven local ripples for the puddle. Give amplitude, wavelength, roughness and attenuation meaningful controls. Do not call arbitrary moving sine lines a validated gravity-capillary solver.
- **Limit:** this is an approximation, not a fluid-volume solver. An ocean FFT is not automatically justified for a small wet deck.

### R08 — GPU Gems, Mark Harris: Fast Fluid Dynamics Simulation on the GPU

Citation: [1](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu)

- The chapter's stable-fluids implementation is a grid-based continuous-fluid simulation and explicitly does **not** simulate the free water/air surface. The beginning and relevant search-extracted free-surface discussion were reviewed. [1](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu)
- **Decision:** do not add advection/divergence/iterative-pressure/projection passes and assume realistic puddles have been solved. The bounded wave-field candidate in TECHNIQUES is a different, simpler model.
- **Limit:** numerical stability is not physical accuracy, cheap execution, or automatic large-dt correctness.

### R09 — Guerrilla: Nubis (SIGGRAPH 2017)

Citation: [1](https://www.guerrilla-games.com/read/nubis-authoring-real-time-volumetric-cloudscapes-with-the-decima-engine)

- The studio describes regional cloud authoring, animation/transitions, atmospheric integration and lighting changes, extending a volumetric prototype. Its under-2-ms claim is explicitly for PlayStation 4, not low-end browser phones. The studio abstract was fetched; the linked presentation was not reviewed in full. [1](https://www.guerrilla-games.com/read/nubis-authoring-real-time-volumetric-cloudscapes-with-the-decima-engine)
- **Decision:** borrow the insistence on authored density and coherent consumers, not the whole volumetric runtime. The mobile baseline uses continuously moving 2D/2.5D optical-depth layers and a common aperture.
- **Limit:** no dense 3D cloud raymarch is in the low-end baseline; no PS4 timing is transferred to it.

### R10 — Arc System Works / GDC: Guilty Gear Xrd art direction

Citations: official session [1](https://gdcvault.com/play/1022031/GuiltyGearXrd-s-Art-Style-The), studio announcement [2](https://www.arcsystemworks.com/guilty-gear-xrds-art-style-the-x-factor-between-2d-and-3d-talk-from-gdc-2015-is-now-available-online/), substantial search-extracted handout [1](https://www.ggxrd.com/Motomura_Junya_GuiltyGearXrd.pdf).

- The session documents deliberately anime-styled results rather than a photorealism race. The handout excerpts discuss limited animation, per-key artistic adjustments and expressiveness over mathematical accuracy. The handout's direct fetch failed HTTP 500; it was **not** independently read in full. [1](https://gdcvault.com/play/1022031/GuiltyGearXrd-s-Art-Style-The) [1](https://www.ggxrd.com/Motomura_Junya_GuiltyGearXrd.pdf)
- **Decision:** protect authored poses, shot composition, controlled value masses and deliberate deformations. A zero instantaneous contact velocity is not, by itself, proof that an impact drawing is wrong.
- **Limit:** this is Arc System Works evidence, **not MAPPA's proprietary pipeline**. Do not prescribe 500-bone rigs for this game or claim that turning interpolation off creates animation quality by itself.

### R11 — Heitz, Dupuy, Hill, Neubelt: linearly transformed cosines

Citation: [1](https://eheitzresearch.wordpress.com/415-2/)

- LTCs are an established approach to integrating polygonal area-light response, not a new invention of this project. [1](https://eheitzresearch.wordpress.com/415-2/)
- **Decision:** an area-lit shoji doorway gets a simple normalized two/four-sample or fixed-source response-basis control first. LTC is a comparison candidate if broad moving area lighting actually earns its cost.
- **Limit:** a two-point approximation is not exact LTC or full soft-shadow area integration.

### R12 — Web Audio API / MDN

Citations: constructor guidance [1](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext), specification [3](https://www.w3.org/TR/webaudio-1.1/).

- `interactive` is already the default latency hint; a browser can choose not to meet a requested hint. Reported base latency is not complete finger-to-speaker latency. [1](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext) [3](https://www.w3.org/TR/webaudio-1.1/)
- **Decision:** do not advertise adding `latencyHint:'interactive'` as a new optimization. Test audio unlock, output routing, scheduler stalls and hidden-tab behavior; retain procedural audio where it is inexpensive.
- **Limit:** headless muted-context lifecycle checks do not establish audible quality or actual phone audio latency.

### R13 — Event Timing and custom metrics

Citations: [1](https://www.w3.org/TR/event-timing/), [1](https://web.dev/articles/custom-metrics).

- Event Timing exposes discrete interaction phases with restricted timing precision; continuous pointer/touch movement is excluded from the API's exposed event set. [1](https://www.w3.org/TR/event-timing/)
- **Decision:** instrument pointer sample → command consumption → first changed game frame yourself. Event Timing/INP is complementary, not the joystick's complete latency metric. Use high-speed video for true touch-to-photon validation.
- **Limit:** a JavaScript “frame submitted” timestamp is not a display scanout timestamp.

### R14 — OffscreenCanvas

Citation: [1](https://web.dev/articles/offscreen-canvas)

- OffscreenCanvas can move suitable work into a worker and free main-thread resources. [1](https://web.dev/articles/offscreen-canvas)
- **Decision:** prototype procedural art baking there first, with a main-thread staged fallback and generation cancellation. Only consider full render-thread migration after proving input transport and ownership.
- **Limit:** moving work does not erase GPU fill, bandwidth, transfer cost or thermal load. Feature-detect each required context/worker capability.

## Developer discussions: what was learned, and what was not

| Discussion / evidence level | Report or correction | Concrete experiment for this game |
|---|---|---|
| HTML5GameDevs, older Phaser 2 mobile WebGL thread; fetched beginning plus search extracts. [1](https://www.html5gamedevs.com/topic/35100-webgl-performance-on-mobile/) | Participants report large differences when switching renderer/framework versions; suggested causes are not all confirmed. | Lock browser/library/version/physical output; compare corrected Canvas with the whole GPU candidate. Do not conclude from a sprite demo. |
| HTML5GameDevs, Pixi v3 masks; fetched beginning plus search extracts. [1](https://www.html5gamedevs.com/topic/38509-fastest-way-to-do-masking/) | Static masks can still cause unexpected mobile stutter; the thread discusses batching/framebuffer alternatives. | Compare local wet-mask shader sampling, bounded clipping, precombined static masks and no-op mask overhead. Do not import its FPS-per-mask as a cost constant. |
| three.js shadow discussion, 2019. [1](https://discourse.threejs.org/t/question-about-shadows-and-their-influence-on-draw-calls-and-polygon-counts/7262) | A participant corrects their own claim: shadows did not disable ordinary culling; extra shadow rendering explains extra work, with light-camera culling. | Keep full pass accounting and separate camera-visible receivers from shadow-relevant offscreen casters. Do not cull a caster solely because its body is offscreen. |
| three.js full-screen statistics, 2021. [1](https://discourse.threejs.org/t/webgl-performance-in-all-devices/22234) | Final post-pass statistics hid the earlier scene work; the scene did not become just two triangles. | Report sum of all passes, texture copies and uploads, not only the final compositor draw. |
| Defold iPhone first GUI reveal, 2023. [1](https://forum.defold.com/t/app-freezes-in-html5-on-iphone/72498) | The first reveal stalled, later reveals did not. The discussion proposes causes and a warmup workaround; it does not establish GC as the cause. | Separately trace first bake/decode/upload/shader/text and subsequent openings. Prepare critical art before combat, with bounded work rather than arbitrary sleeps. |
| Defold iOS Low Power Mode input report, 2026; search extract only; direct page fetch returned navigation, not the discussion body. [1](https://forum.defold.com/t/has-anyone-experienced-html5-input-issues-in-ios-low-power-mode/83106) | A user reports lost input after several expensive mesh updates. It is an unresolved anecdote, not a browser-law diagnosis. | Include Low Power Mode, multi-touch and post-upload bursts in physical iPhone testing. Do not claim the same cause is present here. |
| BlenderNation comments on Xrd, 2015; directly fetched. [1](https://www.blendernation.com/2015/07/26/junya-c-motomura-behind-the-scenes-of-guilty-gear-xrd/) | An animation discussion distinguishes choosing meaningful held drawings from mechanically deleting intermediate frames. | Review contact sheets and real-speed clips with an authored-exposure manifest. Do not smooth every held head/elbow merely to satisfy an amplitude test. |
| Rune developer engineering blog, 2024; practitioner account. [1](https://developers.rune.ai/blog/web-game-performance-optimization) | Discusses low-end runtime/GC constraints, renderer variability and explicit frame-rate choices. | Use allocations and traces as measured signals; keep a separately labeled supported-30 presentation mode rather than hiding reductions inside a “same-quality” benchmark. |

These reports disagree on which renderer wins, precisely because engines, versions and workloads differ. That disagreement is useful: it makes a universal WebGL-migration promise less defensible, not more.

## What remains unknown

- The exact lowest supported phone models, RAM, OS/browser versions and required presentation FPS.
- Sustained GPU/CPU time, real touch latency, crash/context-loss behavior, physical memory and audio latency on those devices.
- Next production bundle composition/cache responses and complete application integration.
- Which of the proposed caches wins after their correctness keys are repaired.
- Whether the new material art is artistically accepted in motion, not only numerically close.

The implementation plan treats these as release gates, not details to fill in after promising the result.
