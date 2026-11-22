# Graphics engine map & mobile visual rulebook

The continuous route now has a separate, optional WebGL2 presenter. The
[2.5D Bridge graphics guide](BRIDGE-GRAPHICS.md) describes current admission,
passes and results; the measurements and sequencing below describe the
preceding renderer.

**Recommendation: light the art, not the whole framebuffer.** Keep the current 2.5D renderer. Make the scene look deliberate at Low and 1× through composition, baked lighting, material edges and strong poses. Spend live CPU only where movement changes what the player should see: fighters, contacts, weather and small patches of light. High and Ultra should refine that picture, not make a different one.

This maps the renderer including the [authored practicals](PRACTICAL-OPTICS.md) and [quality locks](lighting/graphics-tiers.md). The [art upgrade results](MOBILE-VISUAL-UPGRADE-RESULTS.md) record the original bridge refinement and dry station preview. The [mobile visual upgrade plan](MOBILE-VISUAL-UPGRADE-PLAN.md) tracks broader scene support and physical-phone validation.

## 1. The engine we have

This is **Canvas 2D during play**, with **optional WebGL2 to bake moon and star images**. The game simulates combat in fixed 1/60 s steps and interpolates positions for drawing. Weather and FX update on their own visual clocks. A hitch can run up to four combat steps in one frame; excess debt is counted, not fed back as a longer step. Quality changes presentation, not the combat step.

```text
Mounted stage art → bake fixture bodies/scatter and fixed architecture once
Run seed + profile history → bake seeded skyline, receiver and light transfer
  → cache the distant sky composite by view

Input → Game's requestAnimationFrame loop → fixed steps → interpolate for paint
                                              + once-per-frame weather / FX
Paint order:
  distant sky → live mid/near parallax → arena and rear fixtures
  → prop shadows and props → fighter grounding
  → ground FX, enemies, echoes, player, projectiles
  → foreground + hit FX (legacy diagnostics may capture)
  → rain and impact overlays → HUD

DOM menus and touch controls are outside this paint pipeline.
```

| Area | Source of truth | What it owns |
|---|---|---|
| App and frame | [`page.tsx`](../src/app/page.tsx), [`game.ts`](../src/game/game.ts), [`sim-clock.ts`](../src/game/core/sim-clock.ts) | React mounts an opaque scene canvas and a transparent HUD canvas; menus and flat, unfiltered touch controls are DOM. `Game` owns the loop, resize, lifecycle and interpolated render positions. A stable pause can keep the world image and update only the HUD. |
| Run preparation | [`Game.requestRun` / `prepareRunFrame` / `beginRun`](../src/game/game.ts#L713), [`night.ts`](../src/game/world/night.ts), [loading results](GAME-LOADING.md) | The title uses Canvas 2D sky plates. Engage/Retry acknowledge before work and give optional, cancellable GPU baking a shared deadline before falling back. City/road warmup is still synchronous; play starts after the first complete arena draw. |
| Art and depth | [`art-grade.ts`](../src/game/world/art-grade.ts), [`profile.ts`](../src/game/world/profile.ts), [`CyberBackground`](../src/game/world/background.ts), [`buildings.ts`](../src/game/world/buildings.ts), [`bhst.ts`](../src/game/render/bhst.ts) | `BRIDGE_ART` sets the grade and warm airlight; seeded variation builds repeating city plates with baked blur and façade lighting. `SkyVaultCache` holds the distant composite at no more than CSS resolution. Baked mid/near plates and bounded animated details follow the camera every draw. On the authored stages, fully occluded sky rows behind the district and opaque span are clipped out of the main scene. |
| Play surface | [`road-section.ts`](../src/game/stage/road-section.ts), [`viaduct.ts`](../src/game/stage/viaduct.ts), [`roofprops.ts`](../src/game/world/roofprops.ts), [`props.ts`](../src/game/world/props.ts) | The fight plane is `y=0`, distinct from the rear sidewalk and projected asphalt. Viaduct plates carry lane paint, trim, baked pools and the wet material (dry tile at Station). Decorative fixtures supply fixed blockers/emitters; breakable combat props have separate state and sprites. |
| Light and materials | [`light.ts`](../src/game/world/light.ts), [`lightfield.ts`](../src/game/world/lightfield.ts), [`emitters.ts`](../src/game/lighting/emitters.ts), [`ribbons.ts`](../src/game/lighting/ribbons.ts), [`material.ts`](../src/game/lighting/material.ts), [`volume.ts`](../src/game/lighting/volume.ts) | A directional key plus local shaped lights. `RibbonField` precomputes transfer/occlusion in bounded regions, exposes live gain and samples for bodies and hit lights, and supplies the baked road lighting. Cached gradients or small directional normal tiles shade inside the figure, not over a figure-sized rectangle. |
| Fighters and grounding | [`renderer.ts`](../src/game/render/renderer.ts), [`shadows.ts`](../src/game/render/shadows.ts), [`rig3d.ts`](../src/game/anim/rig3d.ts), [`humanoid.ts`](../src/game/anim/humanoid.ts), [`entities/`](../src/game/entities) | Reuses a visible-enemy list for grounding and body drawing. Solved landmarks drive foreshortening and weapon placement, rendered as 2D shapes. Every tier draws up to two soft sole contacts. High and Ultra fill one graded cast of the solved pose. Ultra adds one faded body-mask blit per prop. [Shadow budgets and measurements](SHADOW-FOOTPRINT.md). |
| Moving air and FX | [`weather.ts`](../src/game/world/weather.ts), [`storm.ts`](../src/game/world/storm.ts), [`rigging.ts`](../src/game/world/rigging.ts), [`fx.ts`](../src/game/fx/fx.ts), [`look.ts`](../src/game/render/look.ts) | The weather front supplies rain/fog/wind/wetness; sight lines benefit from keeping much of that depth behind actors. Storm draws rain and receiver-clipped splashes. FX separates ground marks, silhouette echoes, additive strike effects and brief screen cues. |
| Optics | [`Renderer.draw`](../src/game/render/renderer.ts), [`CyberBackground`](../src/game/world/background.ts), [`baked-finish.ts`](../src/game/stage/baked-finish.ts) | Both routes stamp one precomposed sprite per visible practical, behind the actors. Wet Bridge's static fixture returns and spill are inside the road plate. Night Station only has diffuse spill. Neither authored stage draws live mirrors, split glow/shafts or a viewport vignette. Legacy capture/post remain in ungraded diagnostics. [Matched optics and pacing evidence](PRACTICAL-OPTICS.md). |
| Budgets and ownership | [`graphics.ts`](../src/game/render/graphics.ts), [`quality.ts`](../src/game/render/quality.ts), [`ledger.ts`](../src/game/render/ledger.ts), [`hud.ts`](../src/game/render/hud.ts), [`frameLog.ts`](../src/game/render/frameLog.ts) | Preset caps are separate from actual DPR and active tier. Low→Ultra scene pixel-ratio caps are 1/1.25/1.5/2.25; HUD density follows the device up to 2. Surface scopes and generations own release/reuse; ledger caps are soft, not hardware limits. |

**Do not confuse route, tier, and scene.** Right now the fine-pointer media query selects the forward route at mount; it is not a GPU-speed test. Device classification recommends presets. Adaptive Resolution is opt-in and adjusts only backing scale. A fixed preset uses its full scale (up to 1.25×); there is no separate Absolute Ultra control. Changing tier or mode does not reroll the scene. See the [verified tier matrix](lighting/graphics-tiers.md) for what is actually drawn.

## 2. Where to spend, and what to measure first

| Cost to look for | Why it matters here | First move |
|---|---|---|
| **Pixel area and blending** | Distant sky composition, wide plates, reflection sampling, rain, HUD alpha and full-frame overlays can cost even when there are few JS calls. A source canvas sampled while it is being painted may force raster work. | Crop to the receiver or emitter. Don't supersample distant blur. Compare forward vs. capture and scene DPR on the *same* phone, visual preset and encounter. A cheaper call count alone isn't a win. |
| **Crowd submission** | Every visible body still needs paths and style changes. High/Ultra budget one pose cast per body. A `volumeBrush` miss can still upload a newly coloured 32×32 tile and create a pattern. | Count visible bodies, pose solves and shadow fills; log brush misses only where enabled. Reuse the solved pose and avoid repeated silhouettes whose extra pixels don't help readability. |
| **Startup or resize stalls** | Building seeded city bands and the road performs real CPU work. Deferred GPU readback stops one long wait from blocking JS; it does not make the GPU finish sooner. | Move invariant asset work to build time or share small atlases; split any remaining prep into bounded, cancellable steps. Keep the old image until a complete replacement is ready, but don't keep two full scene generations resident just to crossfade. |
| **Decorative work in bursts** | Rain, splashes, echoes, glows and damage accents can arrive together. Some expensive problems only appear on a wet crowd frame or after heating up. | Use fixed pools and admission budgets. Cull before projection, batch by color/blend, stop invisible work. Drop optional echoes, motes and fringe before a warning, contact or damaging projectile. |

**What the existing checks tell us:**

- **Earlier memory receipt:** Wet 1000×560 tier replays at 1× used **24.0–24.1 MiB** of tracked backing estimates (58–63 surfaces) plus **4.27 MiB** for scene and HUD output. Teardown left no tracked stores. The count exceeds the ledger’s soft 48-surface reference; these figures are not total browser, GPU or pattern memory.
- **Historical comparison (before authored live mirrors were retired):** In one instrumented headless Chromium 153 pair (390×844 at 1×, Medium, seed 42, wet crowd, 72 samples per route), the road mirror hook charged **~7.1 ms/frame** on capture vs **<0.1 ms/frame** on forward. Forward paints its actor mirrors in the grounding hook, which charged **~0.2 ms/frame**. Both runs reached the same 98 sim ticks/event digest and tore down cleanly. Canvas can defer work across hooks; these timings identify same-frame scene sampling as an A/B candidate, not a phone speedup or equivalent-looking reflection.
- **Startup is a separate cost:** The [loading follow-up](GAME-LOADING.md) cuts the software WebGL wait on Engage and Retry. The city and road still bake synchronously. Test time to playable separately from title repaint and running cadence; none of the browser probes measures sustained Android/iOS performance.

## 3. Rules for every scene

| Rule | What to author | Review it on Low at phone size |
|---|---|---|
| **1 · Read the fight first** | Reserve the strongest local contrast and crispest edges for the player, threat hands/weapons, projectiles and cue shapes. Keep windows, signage and trim that sit behind the fight quieter. Grade the world, not UI or cue colors. | In grayscale idle, windup and contact frames, identify the player, attacking limb and target without HUD help. Cues use shape and timing, not hue alone; fog and particles cannot erase them in motion. |
| **2 · Show depth with composition** | Give the scene a distant mass, a crisp play band and a restrained near frame. Increase haze, softness and reduce texture contrast with distance. Pick one landmark outside the primary attack band; use parallax difference, overlap and scale instead of piling on blur. | Pan to both arena ends and roll/zoom in a narrow view. No transparent seam, sliding near sign, or high-contrast foreground occlusion hiding a reachable threat. |
| **3 · Every light has a source and a receiver** | Establish one dominant direction or skylight and a few identifiable practicals. Paint diffuse spill, ambient occlusion at joins, and a contact darkening into static art. A rim, shadow and reflected highlight agree with the same source and receiver. | Turn off optional optics. The sign/lamp still lights something; the player still has floor contact; a change of preset neither changes the key direction nor turns off the room's steady light. |
| **4 · Materials differ before effects** | Use broad weak highlights for cloth, tighter edge/specular shapes for metal/enamel, broken broad streaks only on wet receivers. Start with large form and bevel/occlusion pairs. Put microtexture and wear in the plate, not extra per-object passes. | Tell fabric, a steel edge and wet asphalt apart without bloom or a higher DPR. In a dry scene, a rough floor shouldn't look like a mirror just because a tier is higher. |
| **5 · Motion comes from the world** | Anchor decals, reflections and lamp shimmer to the same coordinates as their surfaces. Use seeded placement and coherent motion over time, slower at depth. Give fighters planted feet, readable anticipation and recoil first; use a few sparse ambient loops for life. | A slow pan and a fast dash have no crawling specks, floating reflections or one-frame poses that appear only at one refresh rate. Freeze or simplify decorative motion for reduced-motion; preserve essential feedback. |
| **6 · Spend on distance and attention, not on every object** | Use a broad palette mass, a support tone and rare accents. Bake the static richness. Draw live embellishment only if visible and limited; use stable identities/priorities so details don't pop as a new light enters. | Show the same seed and frame at each tier. Contact, fixture positions, base grade, action timing and cue identity survive; only chosen finish changes. |
| **7 · Keep planes, clocks and effects separate** | World-fixed fixtures and their receivers share the camera transform; backdrops use parallax and HUD uses CSS coordinates. Apply roll and backing-scale conversion consistently. Keep reflection on the floor, additive hit FX out of the road sample, and HUD outside all world optics. | With a fractional pan, jump, resize and quality shed, shoes, glints and effects stay on their intended planes and HUD avoids blur/flash treatment. |
| **8 · Don't turn polish into load** | A new effect declares its max instances/blits/fills, maximum destination area, memory owner and cheap fallback. Static complexity pays once; no new per-frame viewport readback, generated textures, or always-on full-screen blur on the baseline mobile route. | An offscreen or invisible effect submits no optional work. Move the quality ladder up/down, retry, rotate, pause/resume and destroy; no art rebake on a tier step, blank frame, growing pool/backing count or altered fight. |

The bridge's amber airlight is **its own art direction**, not a universal tint. A cold service tunnel or sunny plaza should follow the same rules with a different key, palette and receiver. For example, a streetlight beam can be a baked spill on Low, one cached cone blit on High, and a focused core using the same sprite on Ultra. All three still illuminate the same patch of ground.

## 4. The smallest reusable scene contract

[`BackgroundRenderer`](../src/game/world/background.ts#L79) is a useful draw/lifecycle boundary, not a scene loader. [`LevelId`](../src/game/core/types.ts) only has `rooftop`; arena bounds and spawn placement live in `Game` and [`waves.ts`](../src/game/world/waves.ts), and the renderer, landing code and weather read the same hard-coded `ROAD` cross-section. `CyberBackground` also owns the bridge lamp/sign positions and creates `Viaduct`. Start with a second scene on the same flat fight geometry; extract data before generalizing collision or copying the bridge painter.

| Piece | Proposed contract | Ownership and dependency rule |
|---|---|---|
| **Stage layout** | Play bounds, spawn and camera anchors, flat fight plane for the first two scenes, behind/in-front ranges and receiver clips. | Physics, spawns, camera and the renderer share the layout. The paint data cannot own or move the collision plane. Keep existing bridge coordinates as the first compatibility fixture. |
| **Art recipe** | Grade/role palette, ordered parallax plates, authored landmark, materials with roughness/edge treatment, keyed light + fixture records, optional weather type. | One record per fixture anchors its body, steady light, occluder and optional optic. Scene-specific art may pick paper/steel/wet stone, but shared cue palette and finish budgets stay in core. Seed decorative variation independently from game RNG. |
| **Scene instance** | Prepare reusable assets → hand off a complete scene → update visual clocks → draw through the same compositor hooks → dispose. | Versioned, scoped plans and atlases; do not allocate full viewport plates for every tier or scene in advance. A resize/tier change updates view/budgets, not the art or layout. |
| **Pass admission** | Required cues/base layers; optional effects admitted by tier and view, with a cheap fallback and bounded work. | The renderer is the common owner of pass order and device policy. Scenes provide surfaces/emitter positions, not copies of the governor, HUD or combat painters. |
| **Acceptance fixture** | Idle, pan, dash, crowd and weather/lighting beat at fixed seed/pose; portrait and landscape. | Ship a small baseline and a per-scene receipt (scopes, plate bytes, work caps, known exceptions). Compare behavior and pixels at the same effective tier/DPR before testing adaptive operation. |

**Reuse proof — Night Station:** the optional preview swaps the city and asphalt for arches, matte tile and a dark track recess. The existing practicals light a dry receiver, and the wet passes are skipped. It demonstrates shared art and pass budgets, not a second renderer, new collisions or persisted stage switching. See [how to try it](MOBILE-VISUAL-UPGRADE-RESULTS.md#mobile-visual-upgrade--playtest-build).

## 5. Upgrade order

| Priority | Build this | Why it earns its place / exit check |
|---|---|---|
| **1 · Art-first bridge slice** | Refine one stretch around the advisory sign and streetlight. Strengthen silhouette separation by quieting façade detail behind the fight, bake coherent metal bevels / concrete joins / roughness into the current plates, leave the existing warm air and steady pools intact. | Highest visual return without adding a gameplay pass or backing store. Compare Low at 1× before/after in motion and at narrow viewport, with fixed seed and HUD/combat parity. Measure start cost as well as steady frames. |
| **2 · Reusable stage/light/material data** | Extract the bridge receiver and shared layers described above. Unify fixture position, shape, color/gain and optional spill definitions. Share small material/trim tiles and weather cards; pre-bake art that doesn't need a run seed. | Less duplicated code and fewer places for light/collision drift. Bridge must render like the accepted baseline before testing the station. No startup spike or retained-store growth on retry/swap. |
| **3 · Fighter polish under load** | Use the existing body/weapon geometry and improve matte vs enamel shading in the same fill. Profile the brush miss and contour allocation paths; if hot, quantize & warm a small hot subset or reuse bounded scratch geometry. Simplify only secondary finish, not the weapon/hit geometry or silhouette that telegraphs it. | The same punch/guard reads on all tiers. Reduce the measured cost, if any, on the crowded fixed-scale test and then a warm real phone before adding more detailed limbs, per-enemy lights or softness passes. |
| **4 · Local optics and weather A/B** | On touch, test whether a coarse posed mirror plus baked emitter spill can replace same-frame road sampling. Approve that swap before adding effects. For any new beam/ripple, reuse sprites, receiver clipping and fixed budgets. | A win must improve tail frame time or save bandwidth/backing without losing readability or receiver alignment. A default path change needs real-device evidence, not the assumption that local is always faster. |
| **5 · Validate another scene, then revisit the backend** | Implement the station-size art proof with the shared contracts. Consider a narrow backend experiment only for a repeatable remaining bottleneck (e.g. large blended layers or too many visible submissions). | Don't start with Phaser, WebGPU, a 3D scene graph, heavier bloom or higher DPR. Keep the existing deterministic combat tests and a Canvas 2D fallback. Switch only if a matched prototype wins on the target phone. |

**First implementation ticket:** do priority 1 on the current bridge with **zero new viewport surfaces and zero new steady-state passes**. Approve a Low 1× pan and a wet-crowd replay. In parallel, compare Medium forward and capture on the target phones before changing the default route or spending an extra pass on atmosphere.

## 6. Mobile acceptance: what "lightweight" means

**Count pixels as well as calls.** A 390×844 CSS scene is about **1.26 MiB** of raw RGBA at 1× and **5.02 MiB** at 2×, before a HUD or an extra buffer. 1.25× already means ~56% more pixels than 1×. A fullscreen blend and a small halo can both be one draw call; they touch very different numbers of pixels. Scale the world/backings independently of HUD text. If submit cost rises with body count, tune that path; if only larger DPR/blended area hurts, crop or reduce area/scale first. If only preparation hitches, fix the bake schedule instead of making the picture worse.

**Suggested prototype gates, not current measurements or release promises:**

- Pick a minimum physical device (older Android) and a representative iPhone/Safari and midrange Android. Test production in landscape and portrait, starting cold and after a 10–15 min steady run. A touch viewport in headless Chromium checks behavior, not thermals, mobile raster cost, or presented frames.
- For a configuration targeting 60 Hz, start with a **≤8 ms p95 main-thread gameplay work** target (simulation plus drawing submission measured together), leaving part of the 16.7 ms interval for raster, compositor, audio/UI work and variance. Track **p95 ≤18 ms / p99 ≤25 ms** foreground frame-interval goals on a sustained, supported 60 Hz test. Log long stalls and dropped-sim debt too. Don't market 60/120 on an untested phone; choose a stable lower visual workload if the tail misses its target.
- Report rAF cadence, JS work, backing sizes and accepted/rejected effect work separately. `rAF − JS` is **not GPU time**. Compare multiple runs at the same scale/active tier before a governor-on run. Use device traces or presentation measurement when claiming a display rate. Don't hide visible hitches or include hidden-tab intervals.
- Check Engage, first frame, same-size Retry, stage switch, viewport/rotation, governor shed/recovery, background/restore and context loss. Track acknowledgement and time to playable separately. For new preparers, aim for ≤8 ms main-thread slices and no new foreground long task; check the CPU fallback, cleanup and cancellation path too. These don't fix the existing atomic warmup automatically.
- Match seed, action, pose and viewport for visual comparisons; check **Low first**, both routes where relevant, and capture after timing. Approve no unintended cue/color/placement change, stable HUD resolution, and fixed-scale combat/HUD parity for renderer-only changes. Count resident plate bytes at warm/return/retry, with no grow-on-retry trend and zero owned stores after destroy.

### Existing tools to reuse

```bash
# Fixed portrait pair: isolate pose and work, not phone throughput.
# Configure SR_BROWSER_TOOLS / SR_BROWSER_EXECUTABLE as in the repair checkpoint.
for route in capture forward; do
  SR_SOFTWARE=1 SR_SOURCE=src node .qa/slasher-replay.mjs --fixed --wet --fixture=crowd \
    --tier=medium --route="$route" --width=390 --height=844 --scale=1 \
    --warmup=30 --frames=72 --stages --empty-teardown
done

# Separate startup, touch / adaptability, and lifetime checks.
node .qa/slasher-startup.mjs --gl-timings
node .qa/slasher-quality.mjs --touch
node --import tsx .qa/slasher-lifetimes.mts --soak
node --import tsx --test tests/{graphics-tiers,layer-seams,shadows,fundamental-lights,ultra-stack}.test.ts
```

Omit `--stages` and `--pixels` for cleaner pacing probes. Keep `--fixed` for parity and controlled work comparisons; confirm performance with real-time input in a production build. Raw portrait probe receipts are in `.cache/engine-map/` in the audit sandbox (ignored; regenerate with the command above). More context: [warm-light invariants](lighting/road-and-sign-stability.md), [renderer repair follow-ups](SLASHER-GRAPHICS-REPAIR-PLAN.md), and [why we haven't changed engines](master/24-ENGINE-DECISION.md).
