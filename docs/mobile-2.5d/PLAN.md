# Stickman Rising — all-engine audit and mobile-first cinematic 2.5D plan

**14 November 2026 · Research/planning deliverable, not an implemented overhaul**

| Identity | Pinned revision |
|---|---|
| Game | `coders786/Stickman-Rising@c857433b57f4a1e9fe514fddd5f190be60eed8c8` |
| Optimization repository | `coders786/Optimization-of-Engines---Stickman-Rising@ffcb3bbcf9631371193afb1e8ab9406a1702cea0` |
| Local planning branch | `plan/sakura-renderer-audit` |

**Read with:** [technical designs, equations and rejection tests](TECHNIQUES.md) · [primary and community research](RESEARCH.md) · [evidence and reproduction](EVIDENCE.md) · [structured new findings](FINDINGS.json).

This extends, rather than erases, the [earlier 20-finding graphics audit](../graphics-optimization/PLAN.md) and [seven rendering experiments](../graphics-optimization/EXPERIMENTS.md). This document is the newer authority for **mobile scope, evidence status and implementation order**. The earlier desktop-like budgets are not a mobile baseline.

## 1. The decision

**Keep the game 2D. Build depth from art, material response, coherent lighting, grounded shadows, local reflections and continuous parallax—not from a wholesale 3D-engine rewrite. Repair input/time/lifecycle correctness before spending money on shaders.**

The requested visual direction is cinematic anime-inspired 2.5D: strong silhouettes, controlled held poses, dramatic but readable light, a richly drawn warm inn, quiet parallel mountain ranges, rooted sakura, long grounded shadows, atmospheric depth and convincing wet surfaces. “MAPPA-like” describes the desired staging and finish. It is not evidence that we know that studio's private pipeline, can reproduce all of its work, or can exceed it on a phone.

The present game is already a **Canvas2D Sakura reinterpretation**. The archived WebGL optics HTML is a separate project, not the game's current renderer. Do not copy the unpromoted five-plane village engine into the game. Its own historical evidence showed that it was slower and used more logical texture memory than the smaller released scene.

### What “optimization first” means here

1. Make the correct visible work reproducible: all effects, all input opportunities and correct current poses.
2. Remove repeated calculation, invalid cache work, redundant silhouettes, overlapping full-area effects and avoidable transfers.
3. Spend the recovered budget on art/material coherence and temporal stability.
4. Compare whole-engine candidates at the **same output resolution, active populations, effects, timing policy and accepted art revision**.
5. Admit visual tradeoffs explicitly. A lower DPR, fewer particles, a frozen sky or a 30-FPS cap is a scalability choice, not a same-quality speedup.

There are **no new phone-FPS or percentage-speedup claims** in this plan.

## 2. What was actually checked

### Executed evidence

- Hash-verified **376 pinned text references**: the original 318 plus 58 QA helpers. They are a selective audit checkout, not a complete installed app.
- Ran **39 upstream game-core test files** under Node **22.14.0**, satisfying the app's declared minimum Node requirement: **215 tests; 207 pass, 8 assertion failures**. The same totals occurred under the sandbox's default Node 20.20.2. Scores and persistence integration suites were excluded, not silently counted as passing.
- Executed read-only source probes for FX lifecycle, input edges, projectile reuse and projectile collision. These execute actual source functions; narrow stubs isolate nonessential services where documented.
- Bundled the actual `Game` core and executed **mount, frame, simulation, Canvas rendering, movement, a light-input sequence, eight scripted enemies, pause, resize and destroy** in Chromium **159.0.8154.6** at **640×360** and **360×640**, DPR 1, high quality locked. Both cases completed with finite checked poses and **no captured runtime errors**.
- Browser harness reproduced the missed parry, lost particle reuse and mixed-step hitch. It uses deterministic randomness and **manual time/rAF**, not natural browser pacing. Its GPU identification is **SwiftShader/software**, not a physical phone GPU.
- New limited reference models: **430,000** sequential AI-count comparisons, **5,000** stable-compaction cases, six command-ownership schedules, and **108,000** pixel comparisons of a finite-kernel bloom dirty-region model, all passing their stated invariants.
- Earlier source/native-Canvas witnesses remain valid for the pinned source, including 30,000 static SAT comparisons with no mismatch, stale RGB lighting, empty/stale reflection caches, frozen sky cadence and draw-count-dependent moon filtering.

### Not established

This is **not** a full Next production build, full app/browser regression, React touch-layer integration, real-touch latency test, hardware-GPU benchmark, 20-minute thermal test or implemented visual redesign. The screenshots are the **old game core**, not pictures of the proposed overhaul. Numbers in their debug overlay are meaningless as performance evidence because the harness controls time.

### What the browser images add

The [landscape capture](../../audit/evidence-mobile/game-core-640x360.png) shows a visually busy combat lane: bright contour/weapon detail, strong sky highlights, a large resource panel, rain, reflections and foreground silhouettes compete. The [portrait capture](../../audit/evidence-mobile/game-core-360x640.png) shows how little horizontal fighting space remains. These are composition observations, not blind quality scores. The Next touch controls are absent, so these captures do not prove the final full-app touch layout is acceptable.

The HUD backing is 350×154 at 640×360—about **23.4% of the entire viewport area**, before score, boss/banner or touch controls. The performance text is drawn unconditionally in `Game.frame`, despite `showFps:false`, and visibly crosses the HUD. Passing the existing HUD layout tests at a 700-pixel height did not catch this complete-frame readability problem.

## 3. Highest-priority independent findings

**B** = browser reproduced; **P** = isolated actual-source reproduction; **S** = source observation; **C** = failed contract requiring design review; **H** = cost hypothesis, not profiled bottleneck.

| ID | Evidence | Finding and consequence | First action |
|---|---|---|---|
| M01 | B/P | **Input can vanish before simulation sees it.** An 8-ms render with no step clears a parry press; the following simulation step sees `pressed=false`, and the player stays in move. `endFrame` is called at the bottom of every render. Edge-only actions are exposed; buffered attacks are not all equally affected. | Give gameplay edges step ownership; split editor-frame clearing from simulation-edge consumption. |
| M02 | B/P | **Recycled effects lose live ownership.** Expired particles, rings and trails are spliced out; reuse activates them but does not push them back into their live arrays. A recycled particle reports active while live count is zero. | Fix acquire/release invariants for these pools; test multiple expire/reacquire/clear cycles. Rebaseline cost after restoring effects. |
| M03 | B/S | **The loop is not always fixed-step.** A 250-ms hitch executes `16.67 + 16.67 + 16.67 + 50 ms`: gameplay advances 100 ms while weather advances 250 ms. FX receives the full scaled frame dt; background internally caps its dt. | Keep bounded work, but remove the disguised variable gameplay tick; define and instrument overload/clock policy. |
| M04 | P | **Reused projectiles retain history from their former life.** A new projectile is safe through NaN fallback; a recycled one spawned at (100,-50) interpolates to (65,-45) using stale (30,-40). | Reset interpolation history on spawn, teleport, ownership change and reset. |
| M05 | P/S | **Projectile collision is endpoint-only.** Actual 900 px/s bullet → actual parry multiplier → 1,440 px/s reflected bullet, at the allowed 50-ms tick: it travels 72 px across a body and misses. | Swept relative segment/body collision and earliest contact ordering. Do not merely enlarge hit radii. |
| M06 | C | **Cleave/contact contracts fail.** `axeKick` hits 3/5 tight and 2/4 loose; `sakugaHammer` differs in a direct variable-dt harness; one unarmed contact is 5.5 px off a body with pad 5. | Inspect authoritative contact trajectories and pose timing before tuning reach or changing tests. |
| M07 | C/S | **Some animation tests impose questionable artistic rules.** `l1` has zero head channel amplitude, a held contact velocity of zero and a fixed off-hand elbow; ritual key count is 12 versus expected 11. | Separate art approval from mechanical invariants. Do not add motion or delete a key only to turn tests green. |
| M08 | S + earlier probes | **Render is not a pure consumer.** Moon filtering, wake fog, HUD easing and petal ripple spawning mutate during drawing; petal drawing consumes global randomness also used by gameplay/audio. | Advance state once under named clocks; use separate deterministic RNG streams and immutable presentation packets. |
| M09 | Earlier P/S | **Lighting/sky/reflection contracts are incomplete.** Stale color keys, empty resized reflections, 4.3-Hz sky holds, inconsistent cloud consumers, camera-roll mismatch and shadow-footprint overclaims remain. | Implement the earlier F02–F15 repairs before evaluating caches or adding effects. |
| M10 | S / art approximation | **Averaging lights into one shadow direction is not equivalent to multiple shadows.** `composeShadowKey` blends moon/door/street vectors and drops point origins. | Per-source visibility for important light; retain an explicitly stylized fallback rather than calling the resultant physical. |
| M11 | S/H + counts | **A silhouette is repainted many times.** Body, multiple washes/rims, smears, projected shadow and reflection repeat geometry; surface functions allocate point arrays. One warm 640×360 frame contained 782 `stroke`, 262 `fill` and 173 `drawImage` calls across contexts. These are Canvas API calls, not GPU draw calls or measured cost. | Share solved geometry, retain contour packets and compare one material fill against repeated silhouette taps. Profile first. |
| M12 | S/H | **Repeated AI/combat scans.** Eligible enemies call `countEngaged` over the enemy list; contact resolution does another ID lookup; targeting repeats nearby-enemy work. | Compare a sequentially maintained engagement summary and ID table with the simple loops. At these populations, the simple loop may still win. |
| M13 | S/H | **Dash has nested 1/480-second force slices**, including per-slice boundary arrays. This may be fine for one player; it is not yet a demonstrated CPU bottleneck. | Count/profile slices and allocations; reuse boundaries first. Keep the convergence/contact behavior unless an alternative proves equivalent. |
| M14 | S + limited lifecycle check | **Audio lifecycle is mostly sensibly bounded, but pause is not suspension.** The engine has lazy audio, voice priorities/cap and stop scheduling; hidden-game pause lowers music intensity without explicitly stopping its 25-ms scheduler/context. | Define menu/hidden policy; test actual phone audio unlock/resume, voice pressure and background energy. |
| M15 | B/S | **HUD/debug composition competes with combat.** Large panel plus unconditional debug line; current hints use keyboard labels. | Compact responsive resources, touch-aware labels and a combat-safe rectangle; diagnostics off in release. |
| M16 | S/H | **Touch layer needs end-to-end validation.** Joystick captures one pointer and resets on loss; buttons have cancel/leave handling but no per-pointer ownership. Knob state updates React on pointer movement; blurred button backdrops may add compositing cost. | Preserve direct input writes; test multiple fingers/cancellation and optimize visual knob/backdrop work only if traced. |
| M17 | S/H | **Cold art is baked synchronously on first draw/true resize.** `ensure` calls sprites, sky, world and shadow bakes together. | Build-time art plus staged/worker-capable remaining bakes; retain the previous complete generation while preparing a new one. |
| M18 | S/H | **Startup risks, not proven bundle bloat:** static Game/debug imports and blanket `no-store` headers. | Measure the Next production graph and actual response headers; lazy diagnostics and sensible production asset caching. |
| M19 | S | **Governor gains can be quality reductions.** It lowers DPR and effect tiers; it uses callback pacing rather than completed GPU time. | Quality-lock comparisons. Keep honest opt-in scalability as a separate product path. |
| M20 | Evidence gap | **No physical-device performance/sustainability baseline exists in this audit.** | Hardware matrix, input traces and thermal runs are release blockers, not post-release chores. |

These are not “20 confirmed production bugs.” They deliberately include reproduced defects, documented approximations, failed contracts, hypotheses and missing evidence. Details and source anchors are in FINDINGS.json.

### The eight failed assertions, classified

1. Tight-pack `axeKick` cleave: review geometry/weapon intent; may be a contact/reach defect.
2. Loose-pack `axeKick`: same family; not an independent optimization bug.
3. `sakugaHammer` cut count across direct update rates: a **unit-harness** difference, not proof that 120-Hz displays normally change production combat. The real loop usually steps at 60 Hz, but its catch-up exception still warrants testing.
4. `l1` head channel amplitude: a fixed local head channel can coexist with moving world head position; artistic contract review.
5. `l1` instantaneous contact velocity zero: can be an intended exposure; check approach/contact coincidence, not only local derivative.
6. `l1` left elbow range: a guarded off-hand may be intentionally quiet; inspect silhouette and support before adding noise.
7. Sword ritual 12 vs 11 keys: likely test/art revision drift, but all duration/gate assertions after the first failure must still be rerun; they did not execute in that test.
8. Unarmed 5.5 vs 5 contact distance: check whether the test sampled the resolved contact or a post-root-movement state. Do not silently widen the pad.

## 4. All-engine redesign map

Paths below are relative to the pinned game's `src/game/` unless stated otherwise. This is cross-engine coverage of the relevant execution roots, not a claim to have proved every line or every supported platform correct.

### 4.1 Input and frame scheduling

**Keep:** real-time human input timestamps, held-key bookkeeping, existing combo buffers, pause/blur reset and one-step edge semantics once actually enforced.

**Change:** `core/input.ts` and `game.ts` get an ordered command envelope: monotonic sequence ID, action, physical/virtual source, down/up state and wall timestamp. Render frames must not discard commands. A simulation opportunity consumes each edge at most once. Maintain held states even if multiple physical sources map to an action; preserve the documented wall-time windows. Editor raw keys clear on render, gameplay edges on simulation consumption.

Define three clocks: wall/input, combat simulation and visual environment. Hitstop does not silently redefine physical human double-tap timing. Weather may deliberately keep moving during hitstop; attack trails/contact sparks must follow an explicit art policy. Pause freezes simulation and ordinary world visuals; menu/HUD animation can have a distinct UI clock.

**Gate:** presses/releases arriving in any phase of 30/60/90/120/144-Hz renders, no-step frames, hitstop, 100–250-ms stalls, focus loss and resume are neither lost nor duplicated. Tests must cover parry, sheathe, ability, execute and charged-release, not only buffered light attacks.

### 4.2 Movement, physics and collision

**Keep:** tuned arcade gravity, finite dash impulse, traction limits, no passive reversal, arena bounds, air-combo float, landing load and jump response. Physics variables are game units, not laboratory-calibrated SI.

**Change:** normal gameplay ticks stay fixed; bound backlog rather than silently calling a 50-ms update. Any discarded time/slowdown is explicit telemetry and an overload policy, not “the same real-time simulation.” Compute swept contacts for fast projectiles and short active windows. Broad phase uses swept AABBs including enemy motion; narrow phase uses actual intended body geometry.

Do not add a general-purpose rigid-body engine to solve a 1D ground lane and stylized airborne attacks. Do not increase all pads to hide misses. Optimize the dash boundary list/allocation before changing force integration resolution.

**Gate:** jump apex/landing, dash path/energy, wall absorption, launch/juggle and damage outcomes match the approved baseline across render schedules. A presentation FPS cap must not reduce gameplay simulation frequency.

### 4.3 Combat, combos, abilities and event ownership

**Keep:** existing attack states, hit-confirm outcomes, hit maps, parry/block distinctions, sword families, stamina/energy costs, dash through-cuts, executions and wave-survival balance.

**Change:** a **combat-locked event spine** gives every accepted contact a unique ID, tick/subtick time, actor IDs, attack instance, resolved contact point/normal and outcome. Damage is resolved once; FX, audio, camera impulse, local light and water/fog disturbance consume that result. This avoids independently guessed impact locations and allows presentation work to be grouped without resolving damage again.

Use active-interval overlap plus a correctly restricted swept path. A snap between held drawings is not a license to damage everything in an enormous interpolation corridor. Give such moves an authored contact segment/cut interval and prove its relation to visible contact. Preserve existing special dash corridor semantics explicitly.

**Gate:** exact replay damage/outcomes, no duplicate rewards, correct block/parry audio/FX, contact error in physical pixels, and no late hits after a window closes. Trace the eight failures separately from new optimizations.

### 4.4 Animation, IK and pseudo-3D character art

**Keep:** authored exposure timing, exaggerated depth, front/back ordering, anatomical constraints, planted feet, blade grip, hand gestures, contextual transitions and deliberate impact silhouettes. The player already has a pseudo-3D skeletal projection; it is not simply a flat bitmap.

**Change:** retain one solved draw packet per relevant pose revision. Body, shadow, reflection, blade/trail anchors and diagnostic overlays use that packet rather than resampling incompatible clocks. Separate roots/camera/cloth continuity from held acting channels. Build a pose manifest identifying continuous channels, held channels, intentional smears and contact anchors.

The animator's `sampleClip` comment says “binary-ish,” but it actually scans key intervals linearly (`anim/animator.ts:80–89`). Compare a last-interval cursor with explicit loop/seek/reverse invalidation against that simple scan. Clips are small and sampling is not yet a measured bottleneck, so do not add a lookup-table/quantization scheme without evidence or change authored curves to make it cheaper.

For art, give the hero a coherent near-black silhouette with selective cool rim and warm practical fill; enemies retain distinct silhouettes and telegraph colors without uniform bright outlines. Bake static cloth/weapon materials; use live geometry for attack edges, hands, scarf and contact-critical features. A normal/coverage or small triangulated contour representation is a **candidate**, not a mandatory sprite-atlas conversion.

**Gate:** contact sheets and real-speed clips for left/right facing, draws, jumps, turns, dash chain, parries and every sword. No blanket smoothing or arbitrary “all joints must move” rule. No full-pose quantization applied to camera, weather or input.

### 4.5 Enemies, targeting and waves

**Keep:** all active actors' movement, timers, attack opportunities, boss patterns, entry cues and wave composition. Offscreen is not inactive: an enemy can still shoot, move into reach or cast a visible shadow.

**Change:** an incremental engagement summary can replace repeated list scans **only if it updates at each sequential state transition**, preserving the current order-dependent admission rule. An ID lookup table can avoid a second scan after contact. Compare flat arrays with a small 1D/spatial-bin candidate for targeting/projectiles; at roughly tens of enemies, a complex hierarchy may lose.

Wave queue head-index replacement avoids repeated `shift` movement but is low priority at current counts. The spawn path allows up to 43 with its `>42` guard; the projectile guard similarly admits 81 with `>80`. Decide whether these are intended before changing caps or using them as benchmark settings.

**Gate:** exact admitted-attacker/outcome sequence for seeded replays, unchanged boss/escort timing, no offscreen frozen threats. Reduced offscreen brain cadence would be a separate gameplay change, not a free optimization.

### 4.6 Particles, lightning and weather

**Keep:** effect identity, impact energy, recognizable elemental swords, afterimages behind opaque actors, real-time storm scheduling and depth-layered rain. The storm's retained arrays and the lightning system's precreated bolt slots are useful foundations.

**Change:** fix pool membership first. Use dense ordered live indices and free indices, retaining stable alpha-over order where required. Build one contact/emitter packet for geometry, local lighting, emission and fog/water impulses. Retain lightning skeletons between authored restrikes; cache compatible glow geometry/sprites, not their entire motion. Its gameplay-plane ray intersections are not hardware ray-traced global illumination.

Keep high-value cues—blade silhouette, parry flash, warning, landing anchor—above decorative effects in the visibility hierarchy. Do not prove speed by deleting them. Improve rain/light response through shared material/light state and bounded receiver masks rather than making every drop a large bloom source.

**Gate:** repeated release/reacquire, scene reset, new-run cycles, bolt saturation, dense impact bursts, element switching and pause. Restored effects must be counted in every benchmark.

### 4.7 Audio

**Keep:** one lazy context, shared noise buffer, sound priorities, explicit source stops, lookahead scheduling and graceful silent fallback. A 32-voice cap means 32 sound subtrees, not necessarily 32 oscillator nodes.

**Change:** derive sounds from the same contact IDs as visuals, preventing duplicate play on re-render. Give incoming low-priority effects a reject policy rather than always evicting an important existing voice. For hidden tabs, stop or suspend work according to an explicit product policy, then resync on user-approved resume. Ordinary pause-menu music can intentionally continue; do not conflate that with hidden-tab behavior.

If traces show synth-node bursts or main-thread scheduling stalls, compare pre-rendered one-shot buffers for heavy recipes with current synthesis. AudioBufferSourceNode is a one-shot object; do not invent a reusable-node pool. Explicit `interactive` latency is documentation, not an improvement over its existing default. See primary API caveats in RESEARCH.

**Gate:** Safari gesture unlock, interruption/headphone changes, many simultaneous hits, silent mode, hidden/resume and repeated destroy. Headless mute is not an audible QA test.

### 4.8 HUD, touch and mobile camera

**Keep:** React receives discrete game events, not game state every frame. Direct joystick-to-Input writes already avoid waiting for a React render to affect gameplay. Existing minimum button sizes and cancel/reset handling should not regress.

**Change:** a shared `CombatSafeRect` reserves top resources, bottom touch zones, notches and browser safe areas. Camera framing reads this rectangle, not the whole screen as if it were unobstructed. A compact landscape HUD uses smaller aligned bars with expanded details on pause; the existing 154-pixel-high block is not the only possible layout. Dynamic digits can use a tiny cached glyph atlas/bitmap font if profiling warrants it; do not rasterize unchanged labels every frame.

Set pointer ownership per joystick/button. Track cancellation, lost capture, navigation and two fingers on one action. Test both hands plus simultaneous parry/dash/jump. Knob rendering can use a retained transform updated once per presentation, while input samples remain immediate. Compare solid translucent controls against per-button `backdrop-filter`; this is a UI art/performance comparison, not an automatic removal.

Landscape is the proposed primary combat layout. Portrait must either get an authored camera/control layout or a clear rotate/pause state; do not simply crop the same battle. Final support decision needs user approval. Source screenshots without the React layer cannot settle it.

### 4.9 Loading, resize, caches and resource lifecycle

Build stable inn/mountain/deck/material textures ahead of time where possible. For remaining procedural variants, prepare critical assets before the first fight using bounded tasks or a worker-capable baker; retain a staged main-thread fallback. A worker is a responsiveness tool, not a cure for GPU bandwidth.

Each asset generation has an ID. Resize cancels obsolete work; publish only a complete generation; dispose replaced GPU targets/bitmaps and bound old/new overlap. Keep actual output-size ratios distinct from nominal DPR. Do not rebuild static world art because a quality setting changed; that improvement is already present and must not be reintroduced as a new fix.

Build the real Next production app under its supported toolchain. Inspect its actual network graph, compression, immutable chunk behavior, font loading and diagnostic imports. The diagnostic esbuild bundle in this audit is **not** the Next production bundle. Blanket development `no-store` must not be mistaken for verified production cache behavior.

## 5. Visual overhaul: one scene, not a collection of unrelated effects

### Composition and art specification

- **Background:** four quiet, roughly parallel mountain ranges. Large authored silhouette rhythm; sparse tiny conifers and snow on appropriate moon-facing planes. Atmospheric contrast decreases with depth. No background village.
- **Inn/hut:** one improved focal building with proper roof/eave silhouette, side return, timber/plaster separation, roof directionality, shoji variation, noren/lantern and a threshold that actually emits warm light onto wet boards. Use shared art/caster geometry, not a separate guessed shadow building.
- **Sakura:** rooted trunk and visible ground anchor; broad canopy value masses with selected blossom highlights. Sway branches/canopy relative to stable roots. Do not animate every blossom independently or freeze all of them inside a low-Hz sky cache.
- **Ground:** timber boards, seams, stone and wetness are different materials. Stable texture detail can increase without adding live path calls. Avoid a uniformly gridded shiny floor that reads as a generic 3D test plane.
- **Fighters:** hero silhouette dominates; enemies remain separable from each other and the floor. Limit foreground fog/branches in the contact corridor. Cinematic is not synonymous with darker everything.
- **Palette:** indigo/slate environment, selective pale moon edges, amber inn/lantern, restrained pink sakura. Cyan/magenta energy remains justified for relevant weapons/emitters, not universal unrelated city bounce.
- **Camera:** modest look-ahead, controlled zoom/trauma and impact composition. Use the shared camera/inverse for light, shadow, reflection, HUD prompts and touch-to-world mapping. Respect reduced-shake preferences.
- **Finishing:** material-specific highlights, restrained finite-support bloom, one grade, subtle grain and one vignette owner. No global blur or chromatic smear over essential contact cues.

These are intentional art revisions. Once accepted, freeze the art manifest before comparing two optimizations. Fewer buildings or different flowers must not be counted as an equal-output algorithmic speedup.

## 6. Ten useful lighting behaviors, without ten render passes

There is **no universal canonical set of exactly ten light types**. Here are ten useful source/response behaviors for this scene. Several share one shader; rim/specular/scattering are material responses, not new physical light sources.

| # | Behavior | Intended use | Low-end implementation / cost rule |
|---|---|---|---|
| 1 | Ambient / hemispheric sky fill | Legible shadow side, depth palette | Two-color/authorable ambient response, static AO where valid. No screen-space GI pass. |
| 2 | Directional moon key | Cool plane separation and long shadows | One common direction/energy from cloud aperture; shared caster/receiver data. Lightning can modify this key transiently. |
| 3 | Point practical | Lantern and nearby warm falloff | Bounded analytic attenuation at relevant surfaces/actor packets; early reject outside radius. |
| 4 | Spot / shaped beam | Door spill or moon-gap shaft | Analytic cone/shape and local receiver bounds. Shaft art and floor light read the same aperture/occlusion. |
| 5 | Rectangular area practical | Broad shoji/doorway softness | Fixed-source response basis or normalized two/four-point control. LTC only if a measured quality/cost case warrants it. |
| 6 | Emissive / effect lighting | Swords, sparks, lightning nodes | Explicit emission plus a small bounded set of local reactive lights; not every spark becomes a full-screen light. |
| 7 | Rim / backlight | Hero contour readability | Material/contour response using the actual source direction and occlusion; no uniform neon outline. |
| 8 | Indirect bounce / color bleed | Warm deck/door side fill, pink nearby canopy | Authored bounded probes/bases, identified as stylized indirect approximation—not live global illumination. |
| 9 | Specular / reflection lighting | Wet boards, puddle, blade edge | Roughness-aware local reflection/glints from the same light packet; avoid broad anonymous white streaks. |
| 10 | Transmission / volumetric scattering | Petal translucency, cloud lining, fog shafts | Shared optical depth and a few bounded 2.5D media layers; not a low-end full-volume raymarch. |

The common model is **emission + ambient + per-source visible material response + bounded scattering**. One light's shadow removes that light's contribution, not unrelated ambient or another lamp. AO is not multiplied over all emission/direct light. Linear-light math and premultiplied alpha have one documented owner; Canvas fallback uses its own approved visual reference rather than pretending every legacy blend matches the new equation exactly.

## 7. Shadows, water, reflections, clouds and parallax: method choices

### Shadows

**Baseline:** shared static prop/caster geometry, live pose-derived actor silhouettes, contact anchors and bounded per-light receiver visibility. Long shadows follow the visible moon/light, not a fixed preprojected mask. Near a practical light, use the correct point projection if it is an important shadow caster.

**Project-specific candidate:** Shadow Witness Parcels (SWP), certifying the **whole receiver parcel, ray kernel and texture-filter footprint**. Start with bounding boxes/row spans; build/query a SAT only where it wins. Dynamic canopy/actors make their uncertain swept region ineligible for a static certificate. A center-ray test cannot certify a 346-pixel-wide glint.

**Reject for low-end baseline:** cubemap shadows for each point light, cascaded shadow maps, screen-space raymarch shadows and desktop SSAO. They solve a broader 3D problem than this scene needs. Multiple physically separate shadows can still be artistically simplified, but label the simplification and compare it in the art track.

### Water and liquid interaction

**Baseline:** a local water/wetness mask; 2–4 coherent analytic wave components; analytic slope; bounded event-driven ripples; reflection/refraction tint, Fresnel-like grazing response and roughness. Separate wet sheen on boards from deep reflective puddles. Impulses come from actual ground/water crossings, not a random draw-time test based on screen Y.

**New proposal:** Wet-Corridor Impulse Quilt (WCIQ). One event ledger supplies foot, landing, projectile, rain and petal impulses to local water and fog. Low-end uses bounded analytic kernels; only interaction-rich puddle patches get an optional damped height-field grid. Patches are an enhancement candidate with boundary/stability tests, not a promised free fluid simulation.

**Compare:** analytic ripples; small damped wave grid; GPU stable-fluid field only for a genuinely needed smoke/dye-flow use case. Stable-fluids pressure projection is not automatically a water/air free-surface simulation. No SPH/FLIP or ocean FFT in this game's low-end baseline. See the physical-model references and limitations in RESEARCH.

### Reflections

Repair atlas allocation/keys first. Use a direct current-pose reflection as the correctness reference. Then compare Motion-Certified Reflection Islands (MCRI): actor-local shape reuse with current root placement every presentation; immediate refresh on facing, pose/contact, material/light or allocation hazards.

Quality bound covers projected **silhouette/weapon/cloth support**, widths and distortion—not only a few joint centers. A fixed 20-Hz cap is rejected when it violates the bound. At 2,600 px/s, a 50-ms hold can permit 130 world pixels of travel. Do not hide this with extra blur. No SSR/cubemap pipeline is necessary to mirror a local 2D fighter onto a defined ground receiver.

### Clouds, fog and shafts

Continuously advect authored optical-depth layers. A common CloudPacket drives visible banks, moon extinction, key energy, shafts and reflected sky. Cache expensive invariant art/data, not the whole moving/twinkling sky. Genuine time brackets are allowed only for predictable fields, with boundary refreshes/direct comparison.

Use a few artistically lit 2.5D cloud layers and ankle-level fog first. Fog movement must be independent from how often draw happens. A fighter's dash can part local fog through the shared impulse ledger. Dense 3D cloud raymarching and many semi-transparent full-screen fog sheets are outside the low-end baseline. Nubis informs authoring/coherence, not a portable phone cost estimate.

### Parallax and other near-3D cues

Each background plane gets one camera-derived transform and atmospheric value/scale convention. Distant ranges move less than the inn/ground; the moon is effectively at infinity; foreground framing moves more but is kept away from important contacts. Do not randomly move all layers at unrelated rates.

Depth also comes from side planes/eaves, authored normals, foreshortening, shadow detachment, planted feet, reflection anchors, relative scale and occlusion order. Add these before considering depth of field, TAA, real 3D geometry or screen-space effects. Smooth camera/root motion does not require smoothing intentional impact drawings.

## 8. Rendering architecture and mobile cost discipline

### Backend decision

1. **Corrected Canvas reference/fallback:** repair state, cache, geometry reuse and cold preparation. This is mandatory even if a GPU backend eventually wins.
2. **Conditional WebGL2 material/compositor candidate:** static art/materials upload once; retained actor geometry/islands update only their required data; bounded local effects and one final compositor. Test capability/format/context-loss paths.
3. **No unconditional migration to Three.js/Pixi/WebGPU.** A new framework can be useful, but it is not evidence of a faster whole game. Mobile forum reports and vendor guidance reinforce the need for a locked full-scene test, not a universal API winner. See RESEARCH.

Do not call a full-resolution Canvas-to-WebGL texture upload every frame a finished optimized renderer. For example, 1280×720 RGBA8 is **3,686,400 logical bytes**; one such 60-Hz upload is **221,184,000 bytes/s** before copies, synchronization or driver costs. This is payload arithmetic, not measured bus traffic; browser pathways can differ.

### Minimal candidate graph

```text
simulation + visual update + command/contact/event ledgers
                         ↓
immutable frame packet / common camera / light-cloud-geometry revisions
                         ↓
static sky & parallax art → forward material surfaces → current actor packets
                         ↓
local shadows + masked water/reflection receivers + bounded atmosphere
                         ↓
explicit emitter layer → same-kernel local/full bloom control
                         ↓
one final grade / tone / vignette / grain → crisp HUD + touch UI
```

This diagram names **logical stages**, not a requirement for one framebuffer/pass per box. Keep opaque/background materials together; preserve alpha-over order for transparent actors/effects; restrict render-target switches. No full-frame multi-target G-buffer by default. Shader precision, packing and compression are tested against image/error gates, not lowered blindly.

### Cost accounting

Track `Σ_resources Σ_allocatedMips (width_m × height_m × bytesPerTexel × layers × samples)` for the actual storage formats, plus buffers, old/new generations, CPU copies, decoded bitmaps and upload staging. For block-compressed formats, round each mip to its block extent and count block bytes; do not multiply base-level size by the number of mips. It is a logical ledger, not browser process memory or a portable VRAM measurement. Textures stored as WebP/PNG can decode to much larger live resources.

Also track processed area for transparent/filter passes, actual context/API work, uploaded bytes, cache hit/refresh reason, frame deadlines and allocation spikes. Pixel area explains why native DPR 3 is expensive; it does not by itself prove exact bandwidth or a speedup. Culling can cost more CPU than the work it skips.

## 9. Original project-specific methods and controls

These names describe **scene-specific designs combining established ideas**, not claims of worldwide invention. The first seven extend the prior experiments; the last three address the wider engine/mobile scope. None is integrated into game runtime here.

| Design | Why it may improve quality and efficiency | Correct control / present evidence |
|---|---|---|
| ACMT — Aperture-Coherent Moon Transport | One cloud/aperture drives art and illumination; stops contradictory sky/shafts/reflections. | Direct current-time same-field evaluation. Existing game inconsistency is source-confirmed; new transport is proposed. |
| RBAP — Response-Basis Art Packets | Rich baked material art with live response, avoiding repeated broad wash layers. | Direct same-material forward shading. Fixed-light basis is exact only under stated fixed geometry/response assumptions. |
| MCRI — Motion-Certified Reflection Islands | Reuse unchanged local shapes but place roots live; preserve fast contacts. | Current-pose full-rate reflection; projected support/error gate. Proposed, not measured. |
| EFBL — Emitter-Footprint Bloom Ledger | Selective artistic emission; optimize the same finite blur over only affected support. | Full-target same-emission/kernel reference. New limited model: 108,000 comparisons, zero error; not a GPU result. |
| SWP — Shadow Witness Parcels | Skip only receiver footprints proven uniformly clear/opaque; fix broad-parcel leaks. | Direct current-mask taps. Earlier static SAT model: 30,000 queries, zero mismatch, limited domain. |
| CSS — Continuous Sky Slices | Reuse artwork without freezing motion/parallax/twinkles. | Direct same-art composition at the same current time. Existing sky hold reproduced; replacement proposed. |
| CLDP — Contact-Locked Draw Packets | Body, shadow, reflection and trails share one solved geometry/order. | Existing direct current-pose draws with approved exposures. Proposed integration. |
| Step-owned command envelopes + combat-locked event spine | Prevent missed/duplicate commands and detached contact audio/FX; group presentation without resolving combat again. | Actual source edge witness plus limited command-ownership model; full gameplay acceptance still required. |
| Sequential threat/engagement ledger | Reuse state summaries without changing which enemy gets an attack opportunity. | Literal sequential loop. Model matched 430,000 queries; real integration/performance untested. |
| WCIQ — Wet-Corridor Impulse Quilt | One true contact can disturb water/fog and seed visible cues coherently; local rather than whole-screen fluid work. | Direct analytic ripple reference; optional grid must pass boundary/energy/readability tests. Proposed only. |

Each candidate needs equations/data flow, source locations, assumptions, fallback and rejection tests. Those are specified in TECHNIQUES. Never promote an elaborate cache merely because its own microbenchmark is faster than a bad alternative.

## 10. Proposed mobile targets — not results or universal limits

The exact phone floor is still unspecified. Before making a promise, select at least two low-end physical Android models and the oldest supported iPhone/browser combination. RAM size alone is not a GPU benchmark. Suggested *coverage classes*, not certified targets: a 2–3-GB Android Go-class phone, a budget Mali-class Android, a budget Adreno-class Android and an older supported iPhone, plus a modern reference phone. Record exact SoC, RAM, OS/browser/build and refresh rate for each.

### Presentation and gameplay

- **Preferred target:** sustained 60-Hz presentation on agreed devices with 60-Hz gameplay ticks and responsive touch.
- **Provisional support floor:** a separately declared steady 30-Hz presentation mode on the weakest agreed hardware, still with 60-Hz gameplay. This is **not permission to replace a working 60-FPS baseline with 30 and call it optimization**. User approval determines whether that floor is acceptable.
- Proposed work headroom: roughly 20% below the chosen presentation deadline; initial investigations can use ≤8 ms main-thread frame work for a 60-Hz mode, ≤16 ms for a 30-Hz mode, then revise from traces. GPU and CPU overlap; do not add independent timing percentiles as if they were serial work.
- Frame pacing gates for a settled 60-Hz panel: report p50/p95/p99 intervals, >1.5-refresh misses and >50-ms stalls, not only average FPS. Initial desired miss rate <1%, no recurring >50-ms combat hitch. Quantization/panel/OS exceptions must be identified, not hidden.
- Input gates: zero lost/duplicate command edges in regression schedules; target p95 event-dispatch-to-first-changed-frame submission ≤2 presentation intervals. Validate actual touch-to-photon with external capture; event dispatch excludes hardware input latency.

### Memory, startup and sustain

- Initial **logical renderer resource target 32 MiB steady, 48 MiB transition peak**, provisional and subject to actual accepted art inventory. Not a claim that every browser can safely allocate that amount. Count CPU/Canvas/decoded copies separately; do not report the texture sum as whole-process memory.
- Scene generation overlap must be bounded; 20 repeated run/scene/resize cycles must plateau in resources/retained heap after normal collection. Do not force GC in production to manufacture that plateau.
- Working startup targets on a stated network/device profile: first interactive shell around 2 seconds, playable prepared scene around 5 seconds; critical transfer target about 2 MiB compressed. These are planning goals, not measured current sizes/times.
- **20-minute physical-device combat runs:** compare early steady segment and last 5 minutes at the same backing/tier; report deadline-miss drift, memory, crashes, battery/thermal observations where available. Do not claim temperature from APIs that do not expose it.
- Cold decode/upload/text/shader/bake stalls must be traced. No large predictable first-use fight hitch may be hidden in the average.

### Quality policy

Freeze a benchmark manifest: commit, art revision, seed, replay, CSS/backing sizes, effects, draw populations, shadow lights, reflection policy, time policy and governor setting. Use the same manifest on both sides.

Keep an optional adaptive mode with hysteresis and explicit tier reporting. Any deliberate reduction in resolution, sample counts, particle density, shadow coverage or presentation cadence is recorded as **scalability**, with its visual difference and user choice. The same-quality optimization lane may not use those levers.

## 11. Validation matrix and acceptance tests

### Replay scenes

1. Calm moon + continuous clouds + still actors: sky/parallax and cache motion.
2. Full camera traversal: one inn, four ranges, sakura, foreground and shadow continuity.
3. Rapid dash/jump/turn across the puddle: feet, current roots/reflections and shadow detachment.
4. Dense 30-enemy wave and the current hard-cap boundary: CPU/geometry/contact/AI stress with no artificial actor deletion.
5. Boss + bullets + parries + lightning + elemental ultimate: worst overlapping emission and damage windows.
6. Low HP + combo + boss/banner + multi-touch at 640×360, 844×390 and small portrait: actual React overlay and safe rectangles.
7. First entry, true resize/orientation, background/resume, context loss/restore and repeated new-run/destroy.
8. Ten-/twenty-minute wave survival: pools, resources and thermal behavior after warmup.

### Three independent acceptance lanes

**A — Gameplay correctness:** approved damage/contacts/commands/timings and state hashes. Correctness repairs get documented before/after behavior; later optimizations preserve the repaired baseline.

**B — Same-output efficiency:** identical current art and quality. Numerical buffers/cache results meet their stated bounds; paired randomized A/B runs show a meaningful whole-engine improvement. Initial promotion target: ≥10% less measured bottleneck work **or** a substantial deadline-miss reduction, with no repeatable >3% regression in another required scene/device. These thresholds are proposed, not statistically magical constants. Report sample distributions/confidence, not cherry-picked best runs.

**C — Artistic overhaul:** accepted composition/material/lighting/motion improvements at fixed mobile budget. Changes may intentionally differ from old pixels; label them. Preserve input/contact/readability and the approved feature checklist. Artist/user approval and real-speed video matter in addition to image metrics.

Golden frames include moon-bank crossings, lantern passage, both facings, sharp blade contacts and wet edges. Numeric RGB tolerance is not enough for a late reflection or obscured fist; test **event-aligned physical-pixel edge/contact errors** and temporal flicker separately. Pixel equivalence across different Canvas/GPU rasterizers is not assumed.

### Profiling hygiene

The manual SwiftShader smoke only establishes limited integration/correctness. For hardware runs use normal clocks/rAF and **production builds**. Separate instrumented and minimally instrumented runs. Browser traces distinguish main-thread work, raster/compositor/presentation and uploads; Canvas JavaScript duration alone cannot identify completed GPU time. A `frame interval - JS` residual is not a GPU measurement. WebGL timer queries, where available, require disjoint handling and cover only their delimited GPU work.

Community and primary sources motivating these controls are cataloged, with version/date caveats, in RESEARCH.

## 12. Implementation sequence and stop/go gates

### M0 — Freeze the corrected evidence contract

Import the pinned runnable game on an integration branch, preserve notices/history and archived research separately. Establish supported Node/package manager and full app typecheck/lint/tests/build. Reproduce the current failures; approve which art tests should change and why. Lock devices, quality, seeds, replays and success criteria. No renderer rewrite before this gate.

### M1 — Input, pool and birth/reset correctness

Fix M01/M02/M04, add swept projectile contacts for M05 and a consistent bounded-step policy for M03. Add cycling property tests and real touch/frame schedules. Separate RNG streams and clock ownership. **Exit:** no known disappearing FX or lost gameplay edges, corrected-baseline recordings and explicit overload policy. Restored work is the new cost baseline.

### M2 — Shared frame/contact/geometry and cache repairs

Build current-pose packets/event IDs/common camera; move visual simulation out of draw. Repair RGB, sky, moon, reflection, wind, shadow-footprint and damage-union contracts from the predecessor. Maintain direct reference paths. **Exit:** repeated renders do not advance world state; cache hits are valid; contact/root transforms align.

### M3 — First mobile visual vertical slice

One improved inn section + quiet mountain composition + one hero/enemy + one practical + a wet receiver. Implement the material/light-source data flow and ten-behavior design without ten passes. Compare corrected Canvas and a bounded forward GPU candidate. **Exit:** accepted moving art and an actual physical-device cost/resource report; reject the GPU architecture if the whole scene loses.

### M4 — Shadows, reflections, water and sky experiments

A/B SWP versus direct/bounds/rows; MCRI versus current-pose reflections; analytic WCIQ versus optional small grid; ACMT/CSS versus direct cloud/art composition. Prove exact domains and fallback hazards. **Exit:** verified boundary/contact error, no held sky/stale blade, local cost wins on required phones.

### M5 — Effects, audio and UI integration

EFBL same-kernel tests, retained contours/emitters, pool saturation, semantic audio events, compact touch HUD and safe camera. Profile AI/ID/compaction candidates against simple loops; keep only worthwhile ones. **Exit:** dense multi-touch combat remains legible and responsive, no duplicate/missing cues.

### M6 — Startup/resource/thermal hardening

Production asset caching and bundle analysis, staged art, context loss, resize cancellation, hidden/resume, repeated sessions and sustained device runs. **Exit:** memory plateau, cold-path bounds and final-minutes pacing meet agreed targets.

### M7 — Promotion and rollback

Ship per-subsystem flags and a corrected Canvas fallback. Keep direct debug references off the production hot path but reproducible. Roll back a cache/backend independently if it violates contact, memory or device stability. No global “ultra mode” switch that conceals which system regressed.

## 13. What is delivered now / what is not

**Delivered:** the expanded all-engine plan, source-linked findings, technical designs/comparators, primary/community research notebook, supported-Node test results, actual-core browser smoke, reference-model checks and reproducible audit wrappers.

**Not delivered:** game runtime fixes, a new MAPPA-quality renderer, physical-phone FPS gains, a full Next build, a completed standalone mountain replacement, or the earlier requested complete inline runtime source archive. The review export contains **planning/evidence/tools**, not an implemented game or complete runtime source. Historical scene files and the earlier export remain separate. No remote commit/push was made.

**Decisions still needed before implementation:** exact lowest-supported Android/iPhone models, whether sustained 60 is mandatory on that floor or a declared 30 mode is acceptable, portrait support versus rotate/pause, and the first approved art vertical slice. Until then, the correct promise is a testable mobile-first design—not a guaranteed frame rate.
