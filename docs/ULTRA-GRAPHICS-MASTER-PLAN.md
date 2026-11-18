# Stickman Rising — Ultra graphics master plan and future-scene rulebook

**Status:** specification for approval, not an implementation claim. This supersedes the proposed production order in [Ultra baked overhaul](ULTRA-BAKED-OVERHAUL.md), and builds on the [renderer audit and seam fixes](ULTRA-GRAPHICS-AUDIT.md). Existing behavior: decorative particles default OFF and can be restored with B. Live weather is separate and has not been disabled globally. The clean art-review mode below is a work item. No final grade, hardware performance figure, or shipping asset budget is approved yet.

## 1. The picture we are making

A fighter crosses a rain-dark transit bridge over a deep city at night. The eye finds the fighter and their weapon first, the lamp and asphalt second, and the skyline third. Cool steel and blue-gray darkness make a few warm lamps feel warm. The bridge looks used without looking dirty everywhere. It should look finished with rain, particles, bloom and motion smears off. Adding those back should reveal weather or motion, not hide weak art.

- **Shape:** a clean silhouette for each fighter and a few distinct tower profiles. Detail is subordinate to shape. From a distance, a heavy enemy looks heavy even in grayscale.
- **Value:** protect separation around hands, head, feet and weapon. Gloom means low-key lighting with visible dark detail, not featureless black. Avoid both a bright skyline directly behind the player and a black player disappearing into a dark prop.
- **Color:** cool city, neutral fight lane, warmer practical lamps, and reserved gameplay cue colors. Use saturation sparingly. The HUD does not inherit the scene grade.
- **Depth:** far geometry moves slower, has softer edges and less contrast; the deck is crisp; near dressing can frame the scene but must not obscure a telegraph. No band of haze, water or particles glued to the middle of the screen.
- **Motion:** fighters, camera parallax and occasional environmental movement supply life. Keep the key strike pose sharp. No full-screen motion blur. A short blade or dash smear must show direction and end before it hides recovery.

## 2. Approve color before baking the final art

Build **Cold Steel**, **Deep Noir**, and **Neon Night**. Cold Steel: cool blue-gray distance, neutral dark steel, sparse amber. Deep Noir: subdued backgrounds, cool readable blacks, warm lamps, few saturated accents. Neon Night: richer cyan/magenta in selected signs and puddles, still a quiet fight lane. Start with Deep Noir as the candidate, not a predetermined winner.

1. **Make a review mode** in the capture harness (`scripts/capture-ultra.ts`) and expose a dev-only browser scene hook through the existing debug tooling in `src/game/debug/`. Use identical seed, camera, actors, pose time, viewport, and render route for each A/B. Omit rain, splashes, lightning, and decorative particles; hold clouds still for the stills. Make the weather omission explicit, not dependent on picking a calm seed. Preserve warnings, HUD and hit reactions.
2. **Author grade recipes** beside `src/game/world/mood.ts` / `profile.ts`. Give each recipe explicit slots for sky/distance, asphalt/steel, warm/cool emitters, fighter base/rim and protected cue colors. Put shared color conversion in `src/game/render/color.ts`, not scattered CSS strings. Avoid rewriting gameplay color tokens in a global filter.
3. **Produce references**: idle, crowd fight, lamp crossing and jump. Include color, grayscale and at least one moving crowded fight. Include High and both Ultra routes, label the effective tier, and test a narrow portrait and landscape viewport. Change only the grade between the three design candidates.
4. **Approve one grade.** Reject a grade that hides feet or hands, makes the sword vanish in front of a building, or clips lamps to big flat white areas. Check both bright and dim displays where available. Author the final palette into plates and ramps after the pick. No costly full-scene live grade is required to make the art read.

## 3. Production map: what, how, where, and how much to bake

**Full** = pixels can be pre-rendered or computed once. **Semi** = bake the reusable representation, drive its placement/intensity live. **Live** = behavior depends on camera, pose, input or changing world state. The percentages below are design targets for the **work within each subsystem**, not measured frame time, memory quotas, or a reason to bake something that must move. Cap measured costs separately.

| Work item and repo owner | How to make it | Bake split (full / semi / live) | Required look and behavior |
|---|---|---|---|
| **Sky and lower city** — `world/background.ts`, `stage/viaduct.ts`, `world/buildings.ts`, `world/night.ts`, `gpu/sky.ts` | Make landmark roof modules (stepped tower, narrow spire, mechanical block), wall families and sparse signs. Bake distance-specific plate palettes; preserve tile overlap and opaque district backing. Put occasional window activity on a separate sheet. | **80 / 15 / 5** | Far buildings recede. A near tower is recognizable without a neon tracing of every edge. No gaps, hard baseline or repeated standout sign beside every fighter. |
| **Asphalt and steel** — `stage/viaduct.ts`, `stage/road-section.ts`, `lighting/material.ts` | Bake aggregate, worn markings, drain grime, steel lips and roughness masks. Author quiet center lane and high detail at edges. Keep existing world coordinates and lane collision. | **85 / 10 / 5** | Dry-looking rough patches between narrow wet areas, thin steel edge catches, no full-width bright scuff or new middle strip. |
| **Puddles and reflections** — `stage/viaduct.ts`, `world/background.ts`, `render/renderer.ts` | Bake receiver masks and static emitter reflections. Resize/roll/clip with the road; use localized wetness to weight and soften live actor reflections. Test both capture and forward before deciding whether a live ripple stamp is worth it. | **55 / 30 / 15** | Smooth pockets can show a broken lamp shape; most asphalt shows only color. No sky glow floating outside the road, horizontal wobble, or mirror bleaching the feet. |
| **Lamps, shadows and shafts** — `lighting/ribbons.ts`, `emitters.ts`, `facade.ts`, `volume.ts`, `world/lightfield.ts`, `render/shadows.ts` | Bake static pools, lamp aperture/halo plates, and fixed-prop occlusion separately from movable props. Use one emitter position and palette to drive the bulb, pool, reflection and fighter sample. Use reusable soft contact shadows and project caster shapes live. | **55 / 30 / 15** | Near a lamp, a fighter breaks the pool and casts away from the fixture; the shadow softens and fades with distance. Shoe contact stays tight; airborne shadow loses weight. A demolished prop must not leave its painted shadow. |
| **Fighters and weapons** — `anim/rig3d.ts`, `anim/skeleton.ts`, `anim/draw-detail.ts`, `entities/player.ts`, `entities/enemy.ts` | Bake material ramps and reusable small detail, not an atlas of all combat poses. Tune visual-only proportions, key silhouettes, weapon edges and controlled rims with light probes. Review any geometry edit for hitbox/pose coupling. | **15 / 35 / 50** | Find the player in a crowd without an all-body halo. Separate blade from torso; heavy and agile enemies read differently without color. Collision, attack timings and support feet remain unchanged by art-only changes. |
| **Hits, smears, decorative particles** — `fx/fx.ts`, `fx/particles1d.ts`, `render/renderer.ts`, `render/look.ts` | Bake small reusable stamp art; place contact spark and blade smear from actual combat trajectory/timing. Keep decorative emission default OFF through art review. Preserve non-particle feedback and accessibility. | **35 / 40 / 25** | Short contact accent pinpoints the strike. No extended bright fog, image doubling, or screen blur obscuring the pose. Particle OFF cannot remove required attack warnings. |
| **Weather, after separate approval** — `world/storm.ts`, `weather.ts`, `wind.ts`, `clouds.ts`, `background.ts` | Bake streak/splash/haze art; reuse existing budgets before raising counts. Test faster fall and thinner streaks, tint selectively from lamps. Splashes stay scattered in road space, behind actors. Freeze or omit for grading. | **25 / 35 / 40** | Sharp streaks appear chiefly in light, rain does not veil the fight, and neither rain nor reflection brings back a pale line at the feet. Preserve independent weather timing, visibility and reduced-motion treatment. |
| **HUD, camera, stage policy** — `render/hud.ts`, `render/graphics.ts`, `render/quality.ts`, `core/camera.ts`, `game.ts`, `app/page.tsx` | Bake icons and constant ornaments. Keep text, values, viewport, camera and quality controller live. Draw HUD after scene optics and keep input/telegraph colors protected. | **25 / 15 / 60** | Crisp HUD in portrait/wide views. No visual tier changes collision, camera anchors, actor positions, or key cues. Shed distant decoration before combat clarity. |

Paths under `src/game/` above unless `src/gpu/`, `src/app/` or `scripts/` is indicated. Keep authored shared templates in `art/`; keep reproducible generators and validation in `scripts/`; put stable shipping assets under `public/` only after measuring. Keep raw captures and generated variants in ignored `out/`; put only a handful of approved reference frames in `docs/lighting/`. Do not turn `background.ts` into the place every new feature must live: leave it orchestrating scene layers and put new material/recipe logic with the owner above.

## 4. Compress without losing quality

Separate **transfer bytes**, **decoded bytes**, **bake time**, and **draw time**. A smaller PNG can decode into exactly the same size RGBA canvas; reducing the file size alone does not free GPU memory. A sheet at 1920×1080 RGBA is about 7.9 MiB before any platform overhead, regardless of whether its file is 100 KiB or 1 MiB.

| Strategy | Use it for | Guardrail |
|---|---|---|
| **Lossless PNG or lossless WebP** | Static plates, near art, sprite atlases with alpha. Encode both when helpful, choose by actual bytes and decode time. | Decode original and candidate and check dimensions, alpha, and visible RGBA. Preserve the working color space and verify in the browser. Do not silently quantize, strip necessary color metadata, or substitute lossy WebP/JPEG. Keep edge RGB/padding compatible with sampling. |
| **Trim and pack** | Sprites with empty borders; interchangeable modules that share sampling and lifetime. Save crop offsets, pivots and original bounds in metadata. | Extrude atlas edges for filtered sampling, keep intentional transparent padding, verify 1×/2× and fractional camera positions. Don't place distant or short-lived assets into the same always-resident atlas as core fighters. |
| **Deduplicate and reuse** | Matching silhouettes, repeated materials, emitter shapes and grayscale masks. Share one source and apply an approved tint or transform where it is equivalent. | Use content hashes for exact duplicates. Don't duplicate whole plates for a color swatch when a mask is identical. Don't mirror asymmetric text/signs or flatten silhouette variety to save bytes. |
| **Store compact source descriptions** | Procedural tiles, seeded particle patterns, palette ramps, modular silhouettes. | Store recipe/seed/version; bake or cache once per compatible variant. Never move recurring pixel loops or asset decoding into a frame to save disk space. Profile first-load bake cost and reseeds. |
| **Separate plate lifetime** | Static bases, optional overlays, scratch buffers and alternative grades. | One active grade; release stale generations and reuse scratch through `render/ledger.ts`. Record unique decoded bytes, not just compressed totals. Do not pin unused options for every scene. |
| **Perceptual reduction, explicitly not lossless** | Already soft distant haze and low-frequency background layers only, after visual approval. | Compare matched images at shipping scales, zoom/DPR changes and pans. Reject visible banding, edge color leaks or blur on fighters, HUD, road edges and telegraphs. This is optional and separate from exact lossless compression. |

**Tooling to add:** an atlas manifest with asset ID, owner, encoded bytes, decoded dimensions, sampling mode, pivots, color space, alpha policy and lifetime. Add a script under `scripts/` to compare decoded pixels, validate padding, detect duplicates, and print size/bake budgets by scene. Use the current ledger for runtime peaks. Store before/after numbers in the review report. No claim of savings until measured; exact compression is accepted only if the decoded/reference result passes.

## 5. Repository bad-graphics rule map (apply to every future scene)

| Owner | Red flag to catch in review | Required check |
|---|---|---|
| `world/background.ts`, `render/bhst.ts`, `stage/viaduct.ts` | A screen-width fill ending at the horizon; adjacent tiles with clear pixels; haze or roof gradient hitting a hard bottom edge. | Test opaque backing and joins at fractional zoom, portrait/wide, and wrap. Mark structural rails as intentional so they aren't mistaken for seams. |
| `world/storm.ts`, `fx/`, `render/look.ts` | Decorative effects centered on the fight rail; particles render above everything; unrelated effects share one global gain. | Scattered road-space impacts behind actors; separate weather/particle toggles; OFF still shows hit feedback and warnings. |
| `render/renderer.ts`, `world/background.ts`, `core/camera.ts` | Screen overlay estimates a curb with a different camera; reflection captures foreground props or UI; pose appears detached under shake. | Draw receivers with the correct world camera, capture before near props/HUD, clip to world bounds; both roll directions and DPR 2. |
| `lighting/`, `world/lightfield.ts`, `render/shadows.ts` | Fictional lights with no source; shadow pointing toward a lamp; bulb, asphalt and fighter using unrelated tint/direction. | For one amber lamp verify light → spill → reflection → occlusion, with a moving actor and removable prop. |
| `world/mood.ts`, `profile.ts`, `render/color.ts`, `render/post.ts` | Higher saturation/contrast over the whole frame; every window qualifies for bloom; two optics routes change the mood dramatically. | Keep cue colors outside the grade. Compare High/Ultra and forward/capture with bloom off/on, grayscale and motion. Bake selective emission instead of using glow to compensate for flat forms. |
| `anim/`, `entities/` | Fighter readability relies on team color or a thick outline; weapon clipped into torso at contact; art update silently changes collision. | Silhouette and hit-pose check at gameplay size, crowd and dark backdrop; preserve gameplay geometry and timing when swapping art. |
| `render/hud.ts`, `src/app/`, `game.ts` | HUD washes out in post, portrait UI covers contact zone, quality governor makes cues vanish, full-screen effects ignore preferences. | Check HUD after post, resize and text legibility; reduced-motion/flash review; pair effective tier with screenshots. |
| `render/ledger.ts`, `render/graphics.ts`, `render/quality.ts`, `src/gpu/` | New passes allocate surfaces each frame; reseed leaves old pinned assets; GPU bake is treated as a requirement for rendering. | Measure cold and warm separately, reuse buffers, check ledger after repeated reseeds, and keep a Canvas fallback. |
| `art/`, `public/`, `scripts/`, `docs/lighting/` | Unversioned bakes, duplicate oversized assets, hand-edited output, or charts claiming savings without decoded checks. | Rebuild from sources, record manifest, validate exact output and publish representative evidence only. |

**New scene entry ticket:** name the focal subjects and protected colors; show a three-value plan (dark/middle/light); list each layer's owner, coordinate space and bake class; declare tile/clip bounds, asset lifetimes, reduced-motion behavior and costs; attach color/grayscale/motion comparisons; run the gates below. A rejected scene needs to state which rule it breaks deliberately and why it helps combat.

## 6. Milestones, evidence and cut order

1. **Baseline and tooling.** Preserve current seam tests; extend the capture harness for grade ID, effective tier, weather/FX state, route, seed, camera and resolution. Gather matched stills and moving clips; establish device baselines and manifest checks. Existing software captures are references, not FPS certification.
2. **Grade approval.** Present the three matched grades and stop for selection. Freeze the color recipes and the no-weather reference before final atlas production.
3. **Single-span approval.** Build one strong amber lamp, one puddle group and a small crowd. Check materials, shoe contact, shadow direction, and glass/steel/asphalt differences. Approve no-post first; then compare selective bloom and directional smears. Fix mismatches before copying the look down the bridge.
4. **Full-scene production.** Build skyline families and quiet the backdrop; finalize bridge plates and repeat rules; tune fighter roles and hit cues. Ship one active grade, not all three simultaneously. Add only a little background life, such as an infrequent distant vehicle, with a static fallback.
5. **Optional weather milestone.** Approve faster/sharper rain independently at the same count, with local illumination and quiet splashes; keep it only if action reads as well in motion. Decorative particles stay off until explicitly restored for review.
6. **Performance and release.** Run `npm run gate`, track known baseline combat failures separately, add targeted pixel, mask and bake-lifetime tests. Browser tests at 1280×720, 1920×1080 and a narrow portrait size, DPR 1/2, both optics routes, low-to-Ultra transitions and multiple reseeds. Measure cold bake, encoded/decoded bytes, peak atlas memory, warm median/p95/p99 frame intervals and tier changes on named desktop/mobile devices. Use the earlier audit's provisional 60/120 Hz goals, revising them on measured devices. Fail a scene if it brings back seams, loses cues or introduces sustained tier shedding in a matched run.

**When over budget, cut in this order:** rare distant animation → decorative halo/shaft layers → expensive reflection detail → background-resolution extras. Keep road coverage, contact, cue colors, silhouettes, HUD and input untouched. The stable baseline should remain playable without Ultra effects; the upgraded image should be visibly better without needing them all on.


## 7. Visual production briefs

These are review cards, not implementation tickets. Read each alongside the bake split and repository owner map above. A "reject" condition is a reason to iterate the visual design before expanding it to other scenes.

### 7.01 Hero silhouette

**Why it matters**  
The player disappears between pale enemies and dark scenery.

**What the player should see**  
A narrow cool rim catches the weapon-side wrist and leading shin, with the torso mostly dark.

**How to make it**  
Use pose and the existing light probe to select a few readable edges; avoid tinting the entire outline.

**Behavior to inspect in-game**  
Cross a dark pillar, then a bright sign, while walking and attacking.

**Reject if**  
A continuous sticker outline or a glow detached from the limb.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.02 Enemy roles

**Why it matters**  
Color is unreliable in crowds and grayscale.

**What the player should see**  
The heavy enemy reads wide and planted; the agile enemy reads narrow and pitched forward.

**How to make it**  
Design silhouette thumbnails first; keep changes to visual overlays or validated poses, not hidden collision edits.

**Behavior to inspect in-game**  
Show three roles without color at native gameplay size.

**Reject if**  
A player must wait for the enemy to attack to identify its role.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.03 Blade versus body

**Why it matters**  
A detailed blade is useless if it vanishes across the chest.

**What the player should see**  
The cutting edge is a fine cool accent; the blade back stays subdued.

**How to make it**  
Protect the blade edge in the material ramp; check wrist and sword separation at swing extremes.

**Behavior to inspect in-game**  
Freeze anticipation, contact, and recovery, then watch at full speed.

**Reject if**  
Glare hides the hand or makes a sheathed sword look drawn.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.04 Support feet

**Why it matters**  
Ground contact sells scale more than another texture.

**What the player should see**  
A tight shadow nests beneath the planted sole; the airborne foot has no dark stamp directly below it.

**How to make it**  
Derive contact from the solved ankle and blend its weight rather than following the character center.

**Behavior to inspect in-game**  
Compare idle, walk transfer, takeoff, and landing.

**Reject if**  
Floating feet, glued shadows, or a dark stripe across the lane.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.05 Hit contact

**Why it matters**  
Several bright effects can hide the moment they are meant to explain.

**What the player should see**  
A brief bright accent marks the contact, followed by visible recovery.

**How to make it**  
Use the live hit position and direction with one prebuilt stamp; leave decorative bursts disabled in review.

**Behavior to inspect in-game**  
Compare light hits, heavy hits, a whiff, and a block.

**Reject if**  
A whiff looks like a hit, or identical flashes obscure different outcomes.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.06 Smear and motion

**Why it matters**  
Long blur removes the information players need mid-fight.

**What the player should see**  
A short tapered mark connects fast blade positions without replacing the sharp pose.

**How to make it**  
Use recent weapon positions to orient a baked smear; cap duration and omit from HUD and camera motion.

**Behavior to inspect in-game**  
Compare single-stepped poses with real-speed playback.

**Reject if**  
A second persistent sword, cloudy whole-screen movement, or loss of recovery pose.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.07 Value structure

**Why it matters**  
Gloom fails when everything is black or everything glows.

**What the player should see**  
City reads middle-dark, lane reads neutral dark, key combat edges get the clearest separation.

**How to make it**  
Author grayscale thumbnails before choosing hues; adjust specific layers rather than global contrast.

**Behavior to inspect in-game**  
Shrink the frame and identify the player and next threat without color.

**Reject if**  
Background sign reads first or dark clothing loses its shape.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.08 Cold Steel candidate

**Why it matters**  
A clean cooler grade is a useful visibility benchmark.

**What the player should see**  
Blue-gray distance, neutral steel, sparse amber pools and restrained cyan.

**How to make it**  
Keep cue colors fixed; change only the environment and fighter ramps between grade candidates.

**Behavior to inspect in-game**  
Match the same crowded and quiet frames against Deep Noir and Neon Night.

**Reject if**  
Everything looks uniformly blue or neutral steel becomes bright chrome.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.09 Deep Noir candidate

**Why it matters**  
Darkness needs legible layers to stay convincing.

**What the player should see**  
Cool lifted shadows, warm local bulbs, muted windows and a quiet neutral lane.

**How to make it**  
Reserve a readable dark floor in the ramps; reduce distant saturation before making the entire image darker.

**Behavior to inspect in-game**  
Review the same scene on a bright and dim screen.

**Reject if**  
The silhouette disappears in black or amber leaks through most of the frame.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.10 Neon Night candidate

**Why it matters**  
Strong accents impress in stills but can overwhelm combat.

**What the player should see**  
Cyan and magenta are confined to a few sources and wet catches.

**How to make it**  
Keep neutral buffers behind combat; reserve warning hues independently from the sign palette.

**Behavior to inspect in-game**  
Check an incoming warning beside a saturated sign in motion.

**Reject if**  
A decorative sign looks like an attack cue.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.11 Grade boundaries

**Why it matters**  
A coherent palette should not change gameplay semantics.

**What the player should see**  
The city, fighters, lamps and cues have separate color roles.

**How to make it**  
Bake palette choices into surfaces and ramps; do not run the HUD or protected cues through the grade.

**Behavior to inspect in-game**  
Compare warning and HUD colors across all three choices.

**Reject if**  
A selected grade changes the apparent meaning of a warning.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.12 Background depth

**Why it matters**  
Slower scrolling is only one sign of distance.

**What the player should see**  
Far towers have soft edges and sparse accents; the bridge remains sharp.

**How to make it**  
Bake distance-specific contrast, haze and detail density into parallax plates.

**Behavior to inspect in-game**  
Pan past repeated tiles at shallow and deep zoom.

**Reject if**  
The skyline competes with foreground silhouettes or feels pasted to the screen.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.13 Landmark rhythm

**Why it matters**  
Repetition is most obvious when the same bright object keeps returning.

**What the player should see**  
A service block, stepped tower and thin spire punctuate quieter shapes.

**How to make it**  
Build modular silhouettes with controlled adjacency; separate bright signs from base geometry.

**Behavior to inspect in-game**  
Pan long enough to see two wraps and note memorable repeats.

**Reject if**  
Identical neon crowns return at regular short intervals.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.14 District continuity

**Why it matters**  
A lower-city join can look like the world stops underneath the bridge.

**What the player should see**  
Buildings and shadowed streets extend through open bays without exposed clear pixels.

**How to make it**  
Keep opaque backing and overlap; repeat only the lower section with compatible floor cadence.

**Behavior to inspect in-game**  
Use a tall camera and fractional positioning at a tile boundary.

**Reject if**  
A bright floor seam, transparent row, or repeated fog slab.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.15 Haze depth

**Why it matters**  
A horizontal haze edge looks like a compositing mistake.

**What the player should see**  
Soft atmosphere separates city depths without coating the actor or asphalt.

**How to make it**  
Bake tapered alpha on both edges and layer before bridge geometry.

**Behavior to inspect in-game**  
Watch zoom and roll over rail and tower bases.

**Reject if**  
A flat veil ends in a screen-wide band or tints the player silhouette.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.16 Architecture materials

**Why it matters**  
Glass and concrete should not look like the same emissive box.

**What the player should see**  
Glass gets wide soft reflections; concrete stays low sheen with clear mass.

**How to make it**  
Bake different facade lighting shapes and a sparse emissive mask, separate from surface color.

**Behavior to inspect in-game**  
View a lit tower beside a service block in grayscale.

**Reject if**  
Uniform neon edging makes every building look synthetic.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.17 Optional distant vehicle

**Why it matters**  
A little motion can make the city feel inhabited without particles.

**What the player should see**  
A small train or service light crosses the distance rarely.

**How to make it**  
Move a baked silhouette on a seeded path behind the appropriate layer, with a static fallback.

**Behavior to inspect in-game**  
Watch a crowded fight as it passes behind the action.

**Reject if**  
It crosses the player at attack time with stronger contrast than the hit cue.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.18 Deck material

**Why it matters**  
An evenly shiny road reads like polished plastic.

**What the player should see**  
Matte aggregate fills most of the lane; wet patches are occasional and irregular.

**How to make it**  
Bake base grain and separate masks; use stable world-space variation, never frame noise.

**Behavior to inspect in-game**  
Pan slowly and examine road grain at narrow and wide scales.

**Reject if**  
Texture crawls, turns into a horizontal pattern, or looks equally glossy everywhere.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.19 Road paint

**Why it matters**  
Horizontal road elements can recreate the defect even if technically correct.

**What the player should see**  
The shoulder and rail are readable; the fight rail is not outlined by decoration.

**How to make it**  
Break edge paint into worn segments and keep the central visual channel quiet.

**Behavior to inspect in-game**  
Inspect an empty wide road and a crowd crossing it.

**Reject if**  
Repeated bright marks merge into one line at fighter feet.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.20 Steel and grime

**Why it matters**  
Wear should explain construction, not cover the scene.

**What the player should see**  
Bevel highlights trace real edges; grime collects near drains, joints and fasteners.

**How to make it**  
Bake small modular edge damage and dirt with clear density falloff away from its cause.

**Behavior to inspect in-game**  
Compare the bridge front to asphalt under the same lamp.

**Reject if**  
Identical stains at every interval or bright texture competing with the weapon.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.21 Puddle shapes

**Why it matters**  
A whole viewport mirror is not believable asphalt.

**What the player should see**  
Puddles follow low points and break reflections into contained patches.

**How to make it**  
Use road-space roughness and receiver masks; keep local irregularity stable across camera motion.

**Behavior to inspect in-game**  
Sweep past a puddle with both optics routes and roll directions.

**Reject if**  
Reflection spills off the deck or shimmers as the camera moves slowly.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.22 Puddle highlights

**Why it matters**  
A reflection carries information about the source and the road.

**What the player should see**  
An amber bulb leaves a softer amber patch on damp grit and a clearer broken image in smooth water.

**How to make it**  
Bake static emitter contributions independently of moving actor reflections; let roughness control sharpness.

**Behavior to inspect in-game**  
Move a fighter between a bulb and a puddle and compare routes.

**Reject if**  
Two contradictory lamp positions or an image brighter than the source should justify.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.23 Ripples

**Why it matters**  
Weather should disturb water only where a drop actually hits.

**What the player should see**  
A puddle ripple is a small local event, not a screen-wide wobble.

**How to make it**  
Later, share the splash position with a localized stamp, capped in amplitude and lifetime.

**Behavior to inspect in-game**  
Compare dry control, one drop, and persistent rain.

**Reject if**  
Dry asphalt moves or repeated circles form an uninterrupted row.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.24 Amber-lamp reference

**Why it matters**  
One good source proves the art system before multiplying it.

**What the player should see**  
The bulb, short halo, pool, rider rim, puddle and shadow all agree.

**How to make it**  
Use one emitter definition and receiver geometry, then compare forward and capture routes.

**Behavior to inspect in-game**  
Walk from dark into the pool, pause under it, and walk out.

**Reject if**  
The figure brightens before reaching the pool or the reflection points away from its source.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.25 Moving shadows

**Why it matters**  
A directional shadow establishes position and depth.

**What the player should see**  
A long weak shadow stretches away from the source; a short stronger one sits near the foot.

**How to make it**  
Project the real pose and clip practical shadows to meaningful light; keep contact separate.

**Behavior to inspect in-game**  
Use a jump, two fighters, and a rotating camera.

**Reject if**  
Shadow crosses a deck edge or remains harsh where no light reaches.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.26 Fixed and removable props

**Why it matters**  
Baked shadows are wrong when the object that made them disappears.

**What the player should see**  
Static bridge features cast stable shadows; broken dressing leaves a clean receiver.

**How to make it**  
Bake permanent casters into a separate pool composition; retain detachable contributions for destructibles.

**Behavior to inspect in-game**  
Remove a prop in a pool and revisit the same location.

**Reject if**  
A ghost prop shadow survives destruction or reseeding.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.27 Bloom control

**Why it matters**  
Glow is useful only if it distinguishes light from painted color.

**What the player should see**  
Tiny halo close to the bulb, occasional bright impact, no glowing rain blanket.

**How to make it**  
Use selective emissive masks and compare without bloom first; keep HUD outside optics.

**Behavior to inspect in-game**  
Stand between neon and a warm lamp during a hit in Ultra.

**Reject if**  
Windows, characters and rain all bloom equally.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.28 Rain shape and speed

**Why it matters**  
Weather motion and streak art are different decisions.

**What the player should see**  
Faster, thinner streaks are clearest in lamps; dark air stays fairly clean.

**How to make it**  
After approval, tune velocity and streak width independently at the same drop count.

**Behavior to inspect in-game**  
Show identical pans at stock and revised weather settings.

**Reject if**  
Faster looks denser or the rain erases attack silhouettes.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.29 Rain lighting

**Why it matters**  
Rain should show where light is passing through air.

**What the player should see**  
Brief amber streaks under the warm pool, cool streaks near a cyan source.

**How to make it**  
Sample a coarse shared emitter field or bounded mask rather than giving every drop its own expensive light.

**Behavior to inspect in-game**  
Cross an unlit gap, warm pool and cool sign with one fixed camera.

**Reject if**  
Uniformly white drops or obvious color bands at pool edges.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.30 Splashes and wetness

**Why it matters**  
The previous pale stripe came from concentrating impact effects in a narrow band.

**What the player should see**  
Tiny short-lived splashes scattered across road depth, behind fighters.

**How to make it**  
Keep deck-space clipping and the current separation from the combat rail; use the same hit location for optional ripples.

**Behavior to inspect in-game**  
Check an empty road and crowded shot at peak activity.

**Reject if**  
Splash row, sidewalk leaks, or drifting screen-space footprints.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.31 Weather-off look review

**Why it matters**  
A moving weather layer can hide the actual difference between grades.

**What the player should see**  
The same clear frame for every candidate, with the static wet surface intact.

**How to make it**  
Freeze review time and suppress weather rendering explicitly; do not equate a clear seed with weather off.

**Behavior to inspect in-game**  
Confirm the capture metadata and compare dry-reference silhouettes.

**Reject if**  
The A/B changes weather, camera or pose alongside grade.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.32 Decoration off

**Why it matters**  
Quiet review needs a clean picture, not a combat system with missing feedback.

**What the player should see**  
No ambient dust or decorative bursts, while important cues remain readable.

**How to make it**  
Keep particles independent of weather and preserve core non-particle cues; label OFF state in capture data.

**Behavior to inspect in-game**  
Try an attack, block, warning and jump with particles off.

**Reject if**  
A needed cue was quietly implemented as a decorative particle.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.33 Foreground framing

**Why it matters**  
Near objects give depth only when they do not hide decisions.

**What the player should see**  
Edge dressing frames the camera, leaving the active lane clear.

**How to make it**  
Author intentional occlusion as an opt-in layer and capture reflections before near dressing.

**Behavior to inspect in-game**  
Pan a foreground pole over the edge of a crowded fight.

**Reject if**  
A pole covers a telegraph or appears in the wrong reflection receiver.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.34 Camera roll and zoom

**Why it matters**  
Small shake exposes mismatched coordinate systems.

**What the player should see**  
Road, splashes, reflections and props rotate together; the sky keeps its own parallax.

**How to make it**  
Use the same world transform for road receivers and camera-sensitive effects, and keep UI screen-space.

**Behavior to inspect in-game**  
Test both roll signs, shake, zoom and off-center framing at DPR 1/2.

**Reject if**  
One horizontally locked effect floats off the tilted deck.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.35 Portrait composition

**Why it matters**  
A narrow view can make good wide art unusable.

**What the player should see**  
Characters stay legible with lower skyline emphasis and clear HUD edges.

**How to make it**  
Check viewport-aware framing and layout, not independent device-specific collision or geometry.

**Behavior to inspect in-game**  
Compare narrow portrait, wide and standard views at matched action.

**Reject if**  
Bars cover feet or an enemy telegraph leaves the visible action area unexpectedly.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.36 HUD and warnings

**Why it matters**  
Players should not decode a color grade to understand gameplay.

**What the player should see**  
Labels and vital bars remain crisp and consistent across moods.

**How to make it**  
Keep UI after scene optics; use protected cue colors with redundant shapes or timing.

**Behavior to inspect in-game**  
Check low health, warning, and action against bright and dark backgrounds.

**Reject if**  
A scene light changes the apparent warning color or makes labels illegible.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.37 Reduced motion review

**Why it matters**  
A striking scene should not depend on shake and flashes.

**What the player should see**  
Depth, ground contact and lighting remain apparent with flashes and shake disabled.

**How to make it**  
Build core readability into silhouettes and locally placed light, keep effects separately controllable.

**Behavior to inspect in-game**  
Run the same contact and lightning scenes with the preference off/on.

**Reject if**  
The reduced-motion build loses important state or flicker remains unreviewed.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.38 Cross-tier behavior

**Why it matters**  
A visual upgrade is not worth different gameplay cues across tiers.

**What the player should see**  
Low still presents a coherent bridge; Ultra adds depth, materials and source response.

**How to make it**  
Shed distant decoration and optional optics first; never change actors, collision or base coverage.

**Behavior to inspect in-game**  
Switch tiers mid-pan and mid-jump with the same scene state.

**Reject if**  
Geometry jumps, the stage rebakes during a fight, or key warnings disappear.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.39 Reference capture

**Why it matters**  
Unmatched images can make almost any change look like an improvement.

**What the player should see**  
Side-by-side references show the same scene with a labeled variable changed.

**How to make it**  
Record seed, camera, grade, time, viewport, DPR, tier, optics and weather in the capture manifest.

**Behavior to inspect in-game**  
Regenerate a reference from its metadata and check framing.

**Reject if**  
Unknown settings, a changed pose, or software timing advertised as GPU FPS.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.40 Lossless delivery

**Why it matters**  
Encoding is not a reason to degrade detail.

**What the player should see**  
File size drops while visible decoded pixels and sampling remain unchanged.

**How to make it**  
Round-trip PNG and lossless WebP, preserve color policy, and validate trimming, pivots and atlas padding.

**Behavior to inspect in-game**  
Compare decoded content and browser output at 1× and fractional zoom.

**Reject if**  
Banding, shifted anchors, alpha halos or hidden palette quantization.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.41 Bake lifecycle

**Why it matters**  
Runtime memory can grow even when compressed downloads shrink.

**What the player should see**  
A new seed or grade swaps one coherent art set without stale plates.

**How to make it**  
Version variants, release old generations, reuse scratch and avoid caching three final grades together.

**Behavior to inspect in-game**  
Repeat reseed, resize and tier churn while watching the ledger.

**Reject if**  
Pinned old surfaces accumulate or a grade change leaves a stale reflection mask.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

### 7.42 Frame pacing

**Why it matters**  
A pretty still does not prove a good game experience.

**What the player should see**  
Ultra has stable motion and remains clear under load.

**How to make it**  
Profile warm p95/p99 and cold bakes separately on named devices; cut nonessential distance effects first.

**Behavior to inspect in-game**  
Run the same crowded clip on desktop and mobile with tier and route logged.

**Reject if**  
Sustained shedding or repeated hitches masked by a good average FPS.

**Evidence before approval**  
Record the test scene and exact setting changed. Keep the matching control alongside it.

## 8. Approval handoff

- **First decision:** select a grade from matched stills, grayscale frames, and motion. If no grade wins, adjust the palette slots without changing rain, lighting placement or pose.
- **Second decision:** accept the one-span lamp and puddle study. Inspect both optics routes and mark which matching differences are intentional.
- **Third decision:** approve scene expansion only after the reference survives a crowd, a jump, a pan, a roll, and a narrow viewport.
- **Fourth decision:** review weather on its own. Keep the clean scene as a control. Do not schedule decorative particle restoration as a prerequisite for visual quality.
- **Release decision:** review decoded assets, measured device pacing and repeated reseeds. If a feature must be cut, keep the approved grade and combat readability intact.


## 9. Upgraded in-game behavior contracts

Use these decisions when the earlier briefs leave multiple implementation choices open. They specify the desired result, behavior over time, tradeoffs, and proof. They are proposed work, not features already implemented.

### 9.01 Color by material, not a global tint

**Desired image.**
Deep Noir makes the asphalt blue-gray without making skin, warning icons, and every building the same blue.

**Better decision.**
Grade the source ramps by material; let the same lamp tint each material by a different amount.

**Bake and runtime ownership.**
Bake the ramp and receiver colors. Keep sampled lamp weight live.

**Behavior over time.**
Outside the lamp pool the hero sits in cool neutral light; at its edge the warm channel grows smoothly; leaving restores the neutral look.

**Boundary or fallback.**
Raising the brightness of a sign must not change the road color a block away.

**Why it improves play.**
A consistent palette makes it easier to tell materials and threats apart at a glance.

**Proof and rejection.**
Compare the same grayscale contact frame with the grade toggled. Reject any grade that loses the wrist or changes a warning color.


### 9.02 Quiet the fight space without following the player

**Desired image.**
The lane has reliable contrast even when the fight moves across the bridge.

**Better decision.**
Author a calmer lower skyline and stagger bright landmark heights instead of drawing a dark circle behind the hero.

**Bake and runtime ownership.**
Bake the distance values and sign masks; keep parallax live. Do not build a player-tracking darkening effect.

**Behavior over time.**
As the camera pans, the same tower retains its grade; as the hero jumps, their edge light helps against a busier height.

**Boundary or fallback.**
Do not dim the city only when enemies spawn; that would make the palette visibly pulse with combat state.

**Why it improves play.**
Good visibility feels like part of the level instead of a spotlight chasing the player.

**Proof and rejection.**
Walk the full span in both directions, then fight beneath the brightest tower. Reject a backdrop that pops or flickers on camera movement.


### 9.03 Highlight just enough of the fighter

**Desired image.**
The head, leading shin and hands remain readable without a glowing sticker outline.

**Better decision.**
Split hero highlights by part and use restrained material contrast as the fallback when there is no practical light.

**Bake and runtime ownership.**
Bake ink and material ramps; choose lighting side and weights from the live pose and probe.

**Behavior over time.**
Turn through the warm light and watch the rim rotate toward the source, then taper in the dark.

**Boundary or fallback.**
A dark cloth sleeve should not shine as brightly as a blade edge; protect the silhouette without adding a halo.

**Why it improves play.**
Players can track which hand is attacking and where a planted foot is even in overlap.

**Proof and rejection.**
Inspect two crossing fighters in grayscale. Reject a rim that appears on the wrong side or turns into disconnected bright dots.


### 9.04 Enemy recognition before color

**Desired image.**
A heavy, a fast enemy, and the player are distinguishable at a distance.

**Better decision.**
Design broad shoulder-to-hip and stance differences before assigning white, violet, or other team accents.

**Bake and runtime ownership.**
Bake shape templates and ramps; keep the solved pose live and validate hitbox/visual correspondence.

**Behavior over time.**
At idle the heavy stays broad; during a wind-up it lowers visibly; the fast enemy commits from a forward lean.

**Boundary or fallback.**
Do not widen a visible strike beyond the real threat area or change foot spacing in a way that makes feet slide.

**Why it improves play.**
Players can predict the kind of attack arriving instead of reading a color key.

**Proof and rejection.**
Use an unmarked grayscale crowd clip. Reject roles that are only recognizable after a hit lands.


### 9.05 Clear overlap without x-ray outlines

**Desired image.**
Crossing fighters momentarily overlap but separate predictably.

**Better decision.**
Use stable draw order and a brief edge on the important visible weapon, not an outline through the blocking body.

**Bake and runtime ownership.**
Bake edge styles; determine depth order and visible blade placement from live pose and scene ordering.

**Behavior over time.**
During a crossing the nearer silhouette occludes the farther one; their attacks become distinguishable as soon as they separate.

**Boundary or fallback.**
Do not reorder fighters just because one starts glowing or enters a light pool.

**Why it improves play.**
Stable overlap prevents confusing visual jumps and preserves a believable sense of bodies.

**Proof and rejection.**
Step through a three-fighter crossover. Reject flickering order, phantom weapons, or invisible telegraphs.


### 9.06 Make anticipations and misses readable

**Desired image.**
A miss looks like empty space, and a hit has one clear point of contact.

**Better decision.**
Use directional weapon smear for movement, contact stamp for a confirmed hit, and body reaction for force.

**Bake and runtime ownership.**
Bake stamp and smear art; drive ownership from actual contact and pose timing, never particles or a canned timer alone.

**Behavior over time.**
The blade enters sharp anticipation, briefly smears on the fast part, hits with a small accent or cleanly misses, and returns to a sharp recovery.

**Boundary or fallback.**
A blocked strike can have a distinct restrained accent; do not reuse the same full-screen flash for all outcomes.

**Why it improves play.**
Players learn spacing, timing, and whether an attack connected without reading numbers.

**Proof and rejection.**
A/B the same swing as a hit, whiff, and block. Reject if observers cannot tell the outcomes without HUD changes.


### 9.07 Design the shadow from the foot outward

**Desired image.**
A planted sole feels attached to the asphalt and takeoff feels light.

**Better decision.**
Prioritize small foot contact; add a broad body shadow only where the lighting justifies it.

**Bake and runtime ownership.**
Bake contact stamps; place and weight them using live supported feet and height. Clip longer shadows to their receiver.

**Behavior over time.**
Shift weight from left to right; the contact follows support. On takeoff it fades, on landing it returns without jumping sideways.

**Boundary or fallback.**
A long shadow must not replace the foot stamp or stay very dark as the actor rises.

**Why it improves play.**
Movement feels heavier or lighter at the right time with no change to physics.

**Proof and rejection.**
Compare idle, walk, dash, jump and ledge framing. Reject toe gaps, duplicate contact spots, or dark strips.


### 9.08 Give each lamp one point of origin

**Desired image.**
The light pool, fixture rim, puddle and cast shadow belong to the same bulb.

**Better decision.**
Use emitter coordinates and a palette token from one source definition rather than tuning four independent positions.

**Bake and runtime ownership.**
Bake fixture emission and the static pool; keep actor sampling and blockers live.

**Behavior over time.**
Approach from the left, pass under the lamp, then exit right; rim direction changes, long shadow extends away, and the puddle shape stays fixed.

**Boundary or fallback.**
A moving actor may change the shadow, not drag the bulb reflection along the road.

**Why it improves play.**
Believable lighting makes street geography legible and sells depth without extra bloom.

**Proof and rejection.**
Test both optics routes and a removable prop. Reject shadows that point toward the bulb or survive a removed caster.


### 9.09 Separate soft bounce from sharp shadows

**Desired image.**
Dark areas retain structure without every lamp illuminating the entire street.

**Better decision.**
Keep a dim base fill and weak bounce separate from the tighter direct pool.

**Bake and runtime ownership.**
Bake fixed bounce colors; modulate direct contributions with live blockers and lamp state.

**Behavior over time.**
Outside the beam the bridge still has a readable edge, but clear cast contrast appears only inside a meaningful pool.

**Boundary or fallback.**
Do not subtract the scene's entire base fill when a character blocks one emitter.

**Why it improves play.**
Players can still see feet and props in gloom while lamp shadows add shape instead of muddying the lane.

**Proof and rejection.**
Compare an empty pool, a blocked pool and an unlit span. Reject pitch-black slabs or suddenly flattened materials.


### 9.10 Design wetness as three surfaces

**Desired image.**
Dry grip, damp grit and a puddle look distinct without changing movement speed.

**Better decision.**
Use matte dry base, soft color for damp areas and tighter highlights only in low pockets.

**Bake and runtime ownership.**
Bake roughness and water coverage separately; scale capture and fixed reflections by those masks.

**Behavior over time.**
As the view moves, the puddle stays in place and the detailed lamp shape appears only where the surface is smooth.

**Boundary or fallback.**
A black asphalt patch is not automatically wet; reflection behavior must be the visible cue.

**Why it improves play.**
The road feels made of material rather than a dark mirror, so fighters remain the focus.

**Proof and rejection.**
Pan at native zoom and in portrait. Reject evenly shiny asphalt or masks that visibly repeat at road-mark spacing.


### 9.11 Keep moving reflections less important than the actor

**Desired image.**
A fighter reflection suggests water but never looks like a second opponent.

**Better decision.**
Use a lower contrast, shorter, softer echo gated by the puddle. Allow simpler reflections on forward optics if the shape reads the same way.

**Bake and runtime ownership.**
Bake attenuation masks; keep actor placement, depth ordering, clipping, and roll live.

**Behavior over time.**
While jumping, the reflected shape softens and thins through rough areas. At the road edge it ends at the receiver.

**Boundary or fallback.**
Do not add a reflection just to show the whole sprite; fidelity means believable placement first.

**Why it improves play.**
Players can read the actual feet and weapons rather than chase their duplicates.

**Proof and rejection.**
Check crowded roll and a wet landing; reject reflection outside asphalt or a strong straight band at its top.


### 9.12 Glass, paint, metal and cloth each tell a different story

**Desired image.**
Glass has broad light shapes, steel catches thin edges, paint is dull, and clothing absorbs most light.

**Better decision.**
Author four small material swatches under the same lamp before drawing the full scene.

**Bake and runtime ownership.**
Bake material ramps and edge masks; use runtime lighting only where the surface or actor moves.

**Behavior over time.**
As light crosses steel, an edge glints while the flat plane stays dark; glass reflections read broad and distant, not like a second neon sign.

**Boundary or fallback.**
Do not use identical high-frequency grain or bloom for road, cloth and facade.

**Why it improves play.**
Material differences make the world feel detailed with fewer effects and less clutter.

**Proof and rejection.**
Put the four swatches side by side in one frame. Reject if the materials can only be identified by hue.


### 9.13 Place wear where the bridge would wear

**Desired image.**
Wear describes joints, drains and traffic without scribbling in the fight lane.

**Better decision.**
Keep fine detail by bolt heads, worn shoulder paint, road drains and fascia edges. Leave a calmer player channel.

**Bake and runtime ownership.**
Bake modular wear patterns with a few seeded variations; do not animate the grit.

**Behavior over time.**
A slow pan reveals local scuffs without shimmering. At gameplay speed those marks merge into a stable material tone.

**Boundary or fallback.**
Do not evenly sprinkle chips or trace an unbroken bright edge across the scene.

**Why it improves play.**
The bridge looks used without making fast combat harder to scan.

**Proof and rejection.**
Compare a detail crop and a full-speed pan. Reject crawling texture or another pale middle line.


### 9.14 Make the city read in three layers

**Desired image.**
The eye understands far skyline, nearer buildings and bridge without counting parallax layers.

**Better decision.**
Change silhouette scale, detail density, value and motion together. Use fewer accents as distance increases.

**Bake and runtime ownership.**
Bake separate grades and haze for each layer; move only the layer offset live.

**Behavior over time.**
Pan along the bridge and watch the near facade move faster while the far landmark drifts slowly and stays soft.

**Boundary or fallback.**
Do not plaster a prominent outline on each near tower; layer separation should still work with signs off.

**Why it improves play.**
A simpler background gives the bridge credible height and leaves more attention for enemies.

**Proof and rejection.**
Check wide, portrait and tower wrap. Reject a depth reversal or an abrupt fog cutoff between plate rows.


### 9.15 Keep skyline landmarks rare

**Desired image.**
A recognisable tower gives a sense of travel without repeated neon scenery.

**Better decision.**
Create a few distinctive crown shapes and assign them sparse occurrences separated by low-contrast utility blocks.

**Bake and runtime ownership.**
Bake silhouette modules and trim metadata; choose layout deterministically per scene seed.

**Behavior over time.**
After crossing the landmark, the player sees quieter blocks rather than its copy two buildings later.

**Boundary or fallback.**
One large sign can anchor a view but should not remain exactly behind the fight across the full camera path.

**Why it improves play.**
Landmarks make worlds memorable and help players feel that movement covers real distance.

**Proof and rejection.**
Show two tile periods in a pan. Reject regular repeating standout shapes or tiny variations that still read as clones.


### 9.16 Use background movement as punctuation

**Desired image.**
The city occasionally moves without competing with every attack.

**Better decision.**
Prototype a sparse distant train or service light before adding moving windows and aircraft together.

**Bake and runtime ownership.**
Bake one small silhouette sheet; advance along a bounded path behind the correct layer.

**Behavior over time.**
It enters briefly, passes behind towers and leaves; stills and reduced-motion mode can use a stationary variant.

**Boundary or fallback.**
Do not use a bright transit streak directly behind weapon trails.

**Why it improves play.**
The world feels occupied without replacing weather and particles with another constant layer of noise.

**Proof and rejection.**
Watch an ordinary fight and ignore the train on purpose. Reject it if it repeatedly steals attention from contact.


### 9.17 Preserve the no-weather reference

**Desired image.**
The finished atmosphere looks deliberate with rain, airborne dust, lightning and motion accents absent.

**Better decision.**
Keep a reproducible clean mode in dev captures, not a one-off lucky weather seed.

**Bake and runtime ownership.**
Bake static haze and damp road into their own layers; freeze or omit live weather in the reference.

**Behavior over time.**
In the same pose and camera, switching weather on changes atmosphere, not the approved color and contact readability.

**Boundary or fallback.**
Do not remove static wet materials just to make the clean reference dry; we need to review the puddles too.

**Why it improves play.**
The team can see whether lighting and grading work on their own before spending time on weather.

**Proof and rejection.**
Compare each grade with the exact same reference scene; reject if clock, FX, zoom or optics changed alongside grade.


### 9.18 Improve rain later with exposure and speed separately

**Desired image.**
Drops are fast and sharp near light, but the light does not expose the entire weather layer.

**Better decision.**
Vary fall speed and streak length independently; narrower cores are preferable to more drops. Keep unlit sections quiet.

**Bake and runtime ownership.**
Bake a small streak profile if useful; keep fall, wind and illumination placement live.

**Behavior over time.**
A drop crosses darkness, becomes briefly visible under a lamp, and disappears. Faster motion does not imply longer streaks everywhere.

**Boundary or fallback.**
Match drop count in A/B; do not combine more drops, more bloom and faster speed in one comparison.

**Why it improves play.**
The game gains visible weather and lamp depth while attacks remain easy to track.

**Proof and rejection.**
Review a dark gap and lit lane at normal speed before approving. Reject a washed-out rain curtain.


### 9.19 Let puddle ripples come from real splash positions

**Desired image.**
Small disturbance is enough to show water responding to rain.

**Better decision.**
Only put a ripple where the splash meets a wet receiver, and skip most visible impacts in a crowded section if needed.

**Bake and runtime ownership.**
Bake the ripple profile; keep position, lifetime and puddle clip live, with a fixed small budget.

**Behavior over time.**
A drop lands, a tiny ripple momentarily distorts its own reflection patch, then settles; nearby dry paint does not move.

**Boundary or fallback.**
No full-road waves or rings lined up at one depth. No ripple in weather-free captures.

**Why it improves play.**
Cause and effect make the weather feel grounded without creating distracting lines.

**Proof and rejection.**
Compare wet and dry spots during a rolled pan. Reject if the pattern leaks or becomes a bright runway.


### 9.20 Bloom has a named source

**Desired image.**
A few light sources look bright while the rest of the view keeps edge detail.

**Better decision.**
Prefer emissive masks for bulbs, selected neon, and short hit accents over boosting all bright pixels.

**Bake and runtime ownership.**
Bake halo profiles and masks; drive gains live and compare capture with forward rendering.

**Behavior over time.**
Near the fixture the halo expands gently; outside it dark steel stays clean. A contact sparkle decays before the next readable beat.

**Boundary or fallback.**
A cloud edge, rain streak and pale enemy do not need identical glow because they have similar luminance.

**Why it improves play.**
Local bloom makes lamps feel intense while preserving readable bodies and the gloomy grade.

**Proof and rejection.**
Compare bloom off/on at the brightest fixture during combat. Reject loss of weapon edge or a foggy screen.


### 9.21 Keep near dressing out of telegraphs

**Desired image.**
Foreground depth does not cost combat information.

**Better decision.**
Use short occluders near the sides and avoid tall dark objects in frequent attack zones.

**Bake and runtime ownership.**
Bake fixture bodies and masks; handle occlusion and draw order in world space live.

**Behavior over time.**
A pole can cross the edge of the shot, but the central action remains clear during the normal camera path.

**Boundary or fallback.**
A forced close-up and narrow viewport must not make an intended side ornament cover the whole combat area.

**Why it improves play.**
Players gain stronger sense of depth without being hit by something they could not see.

**Proof and rejection.**
Test side-scroll, wave entrance and portrait. Reject a prop that hides anticipation in common play.


### 9.22 Choose one coordinate space for each effect

**Desired image.**
The foreground does not fall apart during impact roll or small resizes.

**Better decision.**
Keep road receivers and planted effects in world space; reserve screen space for HUD and intentional accessibility-limited overlays.

**Bake and runtime ownership.**
Bake textures in local receiver coordinates; apply the live world transform or deliberate sky parallax exactly once.

**Behavior over time.**
Roll left and right: puddle, curb, splashes and foot shadows move together, while HUD stays square.

**Boundary or fallback.**
A screen-space filter that needs a road clip must use the rolled receiver, not estimate a horizontal height.

**Why it improves play.**
Stable attachment makes the world feel solid and prevents recurring seam reports.

**Proof and rejection.**
Test shakes at both DPRs with fractional zoom and resize. Reject any line that remains level while its surface tilts.


### 9.23 Keep cues constant across grades and quality

**Desired image.**
A warning means the same thing in Neon Night and Deep Noir, Ultra and Low.

**Better decision.**
Protect cue tokens and use more than color: location, readable shape, and timing also carry the message.

**Bake and runtime ownership.**
Bake icon and stamp art; keep player state, warnings and layout live and independent of grade.

**Behavior over time.**
A quality shed removes distant glow first; a warning that already exists continues in the same place and for the same duration.

**Boundary or fallback.**
Do not make a key cue a dust effect. Reduced motion does not mean reduced information.

**Why it improves play.**
Players can trust learned timing and cues across devices and settings.

**Proof and rejection.**
Play the same attack in Low and Ultra with particles off and reduced motion on. Reject disappearance or shifted timing.


### 9.24 Pack textures by lifetime before size

**Desired image.**
Small files should not force every scene to keep a giant atlas in memory.

**Better decision.**
Group static core surfaces together, but split optional city animation and grade-only masks by lifetime.

**Bake and runtime ownership.**
Losslessly encode the packed assets, keep original pivots and padding, and release inactive groups.

**Behavior over time.**
Reseed swaps one coherent set; switching tier reuses compatible base plates rather than triggering a bake in combat.

**Boundary or fallback.**
Do not put three color-grade candidates in a shipping resident atlas, or vote on compression by file size alone.

**Why it improves play.**
Faster loads and steadier pans are visual improvements because the scene no longer hitches mid-action.

**Proof and rejection.**
Measure encoded bytes, decoded dimensions, peak resident bytes and reseed time. Reject any pixel or sampling mismatch on critical art.


### 9.25 Make tier shedding visually boring

**Desired image.**
When performance gets tight, the fight should not look like it jumped to another scene.

**Better decision.**
Remove rare distant animation first, then decorative optics, then costly wet detail. Preserve palette, silhouettes and coverage.

**Bake and runtime ownership.**
Keep the base art resident; switch overlays and draw budgets, not physics or anchors.

**Behavior over time.**
A tier transition reduces distant activity gradually or at a safe point; it never changes where a fighter stands.

**Boundary or fallback.**
Do not buy a higher still-frame score with unstable Ultra frame pacing or repeated up/down transitions.

**Why it improves play.**
Consistent motion gives players more usable visual information than a richer but unstable scene.

**Proof and rejection.**
Record matched stressed clips and effective tier. Reject sustained shedding and frame spikes in ordinary encounters.


### 9.26 Prove the reference span before repeating it

**Desired image.**
The whole project has one believable lamp-and-puddle standard before expanding.

**Better decision.**
Build a single crossing with asphalt, steel, one amber lamp, a quiet skyline, and an approaching enemy.

**Bake and runtime ownership.**
Bake one reusable environment set; keep actor, lamp influence, camera, and shadow live. Add no weather during approval.

**Behavior over time.**
See quiet idle, the hero entering the lamp, weapon contact, jump out of the pool, and a short camera roll in one repeatable clip.

**Boundary or fallback.**
If one bridge segment does not read well, do not build more variants to hide the problem.

**Why it improves play.**
A reference makes it possible to scale an approved look instead of repeating mistakes across every future scene.

**Proof and rejection.**
Approve the clip in grayscale and color, both optics modes, plus no-bloom. Fail on lost contact, false reflections, or any middle strip.


### 9.27 Release decisions come from comparison, not effect count

**Desired image.**
The shipped scene is clearly better at full speed even when the viewer cannot name the new effects.

**Better decision.**
Compare matched before/after clips, collect readability observations, and keep a named device baseline.

**Bake and runtime ownership.**
Keep additional optional optics separate from base bakes so they can be removed without losing the approved grade.

**Behavior over time.**
During idle the city is attractive; during a fight, eyes return to the character, next threat and hit; after combat, the scenery can be noticed again.

**Boundary or fallback.**
Do not sign off from one still, average FPS alone, or a single desktop viewport.

**Why it improves play.**
The overhaul makes the game clearer to play as well as richer to look at.

**Proof and rejection.**
Release only after seam checks, cue checks, reference approval, decoded-pixel checks and device pacing review; leave unproven effects optional.

## Implementation status

See the [production rollout and evidence](lighting/ultra/ROLLOUT.md) for decisions made from the grade board, amber specimen, motion captures and software-browser smoke test. This section records what shipped separately from the behavior contracts above; unmeasured device gates remain open.
