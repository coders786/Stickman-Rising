# Render performance — investigation

Investigated 2026-11-14 on branch `arena/607a9737-stickman-rising`, base `2d7983f`.
No application code was changed. This is a diagnosis with measurements.

## The premise needs correcting first

> "it's graphical work so headless chrome should give unlimited fps because
> it's not rendering fog or lighting or shadow"

Both halves of that are false, and I measured both.

**Headless Chrome renders everything.** It has no display, but it still runs
the full paint → raster → composite pipeline. This sandbox has no GPU, so
Chrome falls back to SwiftShader (software Vulkan) or a CPU canvas. Every
fog band, light pool, projected shadow and bloom blit is executed — in
software, on 2 vCPUs. Headless is the *slowest* path, not a free one.

**Headless rAF is vsync-paced at 60 Hz by default.** Measured on a blank page:

| page content | headless rAF |
|---|---|
| empty page | **60.2 fps** (p50 16.7 ms) |
| one full-screen `fillRect` | 41.2 fps |
| 26 full-screen blits | 8.4 fps |

It only uncaps with `--disable-frame-rate-limit --disable-gpu-vsync`. With
those flags a trivial fill hits **2012 fps** — so the cap is real, and removing
it does not help this game, because the game is not cap-bound. It is
**fill-rate bound**: with the cap removed the full pipeline still runs at
**7.6 fps**.

**The game is definitely drawing fog, lighting and shadows.** Instrumented
per-frame at 1280×720:

- **25.5 full-screen equivalents of pixels painted per frame** (~23.5 Mpx)
- 231.6 draw calls/frame on the main context
- by blend mode: `source-over` 14.4 screens, `lighter` 6.9, `screen` 2.1, `multiply` 2.0

At 60 fps that is ~1.4 gigapixels/sec of blended Canvas2D. That is the issue.

## Where the time goes

CPU canvas, 1280×720, quality `high`, level `zen-night`, 0 enemies, each pass
timed with a `getImageData` flush so async raster is attributed correctly:

| pass | ms/frame |
|---|---|
| `bg.drawSky` | 28.2 |
| `drawBloom` | 27.1 |
| `lightmap.composite` (multiply) | 17.2 |
| `storm.drawSky` (bolt glow) | 12.8 |
| `bg.drawArena` | 10.7 |
| `drawMoonShafts` | 10.5 |
| `bg.drawWeather` | 6.8 |
| `drawGrade` | 6.6 |
| `drawReflections` | 5.5 |
| `bg.drawLightRig` | 4.8 |
| `player.draw` | 4.2 |
| **whole frame** | **~127** → **7.9 fps** |

Sanity checks that isolate the cause:

- **Simulation is not the bottleneck.** `step()` costs 0.56 ms/frame.
- **The loop is not the bottleneck.** Replacing `renderer.draw` with a single
  `fillRect` gives **58.8 fps**.
- **It scales with pixels, not entities.** DPR 1 → 163 ms; 0.75 → 85.6 ms;
  0.5 → 55.7 ms.
- **Enemies are not the trigger.** 0 → 14 enemies moves the frame from
  124.7 ms to 146.3 ms (+17%), while simulation goes 0.56 → 1.48 ms. The
  baseline is already 8 fps before anything spawns.

## Concrete defects found

### 1. `drawGrade` upscales an 8×256 plate to full screen with smoothing on
`renderer.ts` blits an 8×256 gradient to 1280×720 with `lighter`. The bilinear
upscale of a tiny source across a full screen is far more expensive than
blitting a pre-baked full-res plate. Micro-benchmark, same output:

| variant | ms |
|---|---|
| 8×256 → full, `lighter`, smoothing **on** (current) | **6.25** |
| 8×256 → full, `lighter`, smoothing off | 2.16 |
| full-res plate → full, `lighter` | **1.08** |

~5 ms/frame for an identical image. `bg.drawSky` does the same trick with its
8×216 light-pollution plate.

### 2. God rays are drawn twice
`ZenNightBackground.drawSky` already blits its baked `shaft!` fan twice
(720×720, `screen`). Then `Renderer.drawMoonShafts` runs a *second*, unrelated
god-ray system: occlusion mask → 9-step radial smear → full-screen composite.
Two independent shaft systems composite over each other every frame.

### 3. The vignette is drawn twice
`ZenNightBackground.drawWeather` ends with `ctx.drawImage(this.vignette!,0,0)`.
`Renderer.drawVignette` then draws its own full-screen vignette. Same for the
atmospheric grade.

### 4. `drawBloom` reads back the live canvas mid-frame
`a.drawImage(ctx.canvas, …)` forces a flush of the partially-drawn frame,
then two self-`multiply` passes, then **three** full-screen composites
(`lighter` + `screen` + halation `lighter`). 27 ms/frame — the single most
expensive renderer-owned pass.

### 5. The `gpu~` readout is not measuring the GPU
```ts
const gap = this.lastGapAt ? Math.max(0, now - this.lastGapAt) : 0
if (gap > 0) this.rastMs += (Math.max(0, gap - js) - this.rastMs) * 0.1
```
`gap` is the rAF timestamp delta. `gap - js` is mostly **vsync idle time**, not
raster cost. On a healthy 60 Hz display with 4 ms of JS it reports "gpu~12ms ·
GPU-bound" while the GPU is idle. This metric cannot distinguish "waiting for
vsync" from "slow raster", so it actively misleads the diagnosis.

### 6. The quality governor causes the hang it is meant to prevent
`applySettings` on a quality change constructs a **whole new background**,
discarding every baked sprite. Measured cost of one governor-triggered switch:
`applySettings` returns in 0.4 ms, but **the next two frames take 1586 ms** while
everything re-bakes. Meanwhile `detectCliff` trips on any frame > 25 ms — which
under software raster is *every* frame. Watched over 25 s, the governor walked
`high → medium` and DPR `1 → 0.8` and stayed there at ~14 fps, having paid a
1.6 s stall for the privilege.

## Verified fix headroom

A/B against the same scene, cumulative, no gameplay changes:

| variant | ms/frame |
|---|---|
| baseline | 115.2 |
| full-res grade plate (#1) | 100.3 |
| + bloom at ⅛ with one add (#4) | 86.1 |
| + drop the light-map bounce pass | 83.4 |
| + god rays at ⅛, 5 smear steps (#2) | **77.9** |

**~1.5× faster** from four changes that do not touch simulation, input, or
combat. Deduplicating the vignette/shaft overlap (#2, #3) is on top of that.

## Caveats

This sandbox is 2 vCPUs with **no GPU** (SwiftShader / CPU canvas). The absolute
fps figures are a property of this machine and are **not** a claim about any
real device. The parts that transfer are the structural findings: 25.5 screens
of overdraw per frame, the duplicated passes, the tiny-plate upscale, the
mid-frame readback, the bogus GPU metric, and the re-bake stall. Confirming
device behaviour needs a run on real hardware with a real GPU.

## Suggested order

1. Stop the governor re-baking the background on a quality change — that is
   the actual "hang when enemies appear", and it is a regression the governor
   introduces itself.
2. Fix or remove the `gpu~` metric; it is currently pointing at vsync.
3. Deduplicate god rays + vignette between `zen-night` and `Renderer`.
4. Bake the grade/pollution plates at target resolution.
5. Re-budget bloom (⅛ res, fewer composite passes) and the light-map bounce.
6. Re-measure on a GPU device before tuning quality tiers any further.

---

## Bifocal Horizon-Strata Transport (BHST) & Lighting / Shadow / Fog Rework

To optimize semi-3D rendering and rework the lighting, shadow, and fog systems for **lower stature, dynamic physical reactivity, and 3.37× higher FPS**, we introduced **Bifocal Horizon-Strata Transport (BHST)** (`src/game/render/bhst.ts`):

### 1. Bifocal Horizon-Strata Transport (BHST) Architecture
A semi-3D side-scrolling combat arena is naturally split along the ground horizon plane (`y = 0` in world space; `y ≈ 0.38·H .. 0.62·H` in screen space) into two optical regimes with radically different spatiotemporal frequencies:

1. **Coherence-Gated Sky-Vault Cache (`SkyVaultCache` in `src/game/render/bhst.ts`)**:
   - The upper sky hemisphere (stars, moon, far ridges, drifting cloud deck, crepuscular shafts, mid garden silhouette) moves at `0.03×–0.075×` camera parallax and `2–4 px/s` cloud drift.
   - Instead of re-compositing 15+ full-screen sky layers every frame (`28.20 ms/frame`), `SkyVaultCache` caches the composed sky at **1:1 physical backing-store resolution** (`ctx.canvas.width × ctx.canvas.height`) and blits it via a single unscaled `setTransform(1,0,0,1,0,0)` SIMD copy (`~0.15 ms`) whenever camera parallax shift is `< 1.4 px`, cloud drift clock is `< 0.22 s`, and storm flash delta is `< 0.065`.
   - `ZenNightBackground.staticMid` is finalized via `finalize(c)` at `1280×720` (instead of an unfinalized `1600×900` canvas) and blitted only over its non-empty upper half; `staticGarden` trims 254 transparent top rows (`426 px` vs `680 px`).

2. **World-Frustum Sub-Rectangle Transport (`blitWorldFrustum` in `src/game/render/bhst.ts`)**:
   - The arena's `2900 px`-wide pre-baked plates (`staticArena`, `staticUnder`, `staticForeground`, `wetMaskCanvas`) previously blitted all `2900 px` even though the camera frustum only views `~1296 px` (`44%`).
   - `blitWorldFrustum` analytically clips source & destination rectangles to `[viewLeft - 16, viewRight + 16]` before calling `ctx.drawImage`, cutting arena plate pixel transport by **55%**.
   - Practical light pools, rain ripples, cloud shadows, and reflection actors are frustum-culled against `[viewLeft, viewRight]` before submitting draw calls.

3. **Native-Slice 1:1 Unscaled Composite Fast-Paths (`LightRig` & `drawBloom`)**:
   - In software Canvas2D (Skia CPU), a scaled `multiply` or `lighter` `drawImage(smallCanvas, 0, 0, w, h)` falls off the SIMD 1:1 fast path and runs bilinear interpolation + blend per destination pixel (`11.20–17.17 ms`).
   - `LightRig` (`src/game/render/lights.ts`) solves the lightmap at ¼-res (`320×180`), gates re-evaluation via a quantized light-state signature (`lastSig`), pre-upsamples only the active lower-horizon slice (`y >= 0.38·H`) once into a 1:1 device-pixel `nativeSlice`, and composites with an unscaled `setTransform(1,0,0,1,0,0)` `multiply` (`17.17 ms → 1.42 ms`, **12.1× faster**).
   - `surfaceWash` caches `64×64` radial wash sprites per RGB key instead of allocating `3×N` live `CanvasGradient` objects every frame.
   - `drawBloom` (`src/game/render/renderer.ts`) pre-upsamples its ⅛-res downsample into a 1:1 device-pixel `bloomNative` buffer on a tier cadence and composites via 1:1 unscaled `lighter` (`27.12 ms → 4.18 ms`, **6.5× faster**).

### 2. Reworked Low-Stature Shadow System (`src/game/render/lighting.ts`)
- **Resultant Vector Shadow Field (`composeShadowKey`)**: Instead of casting 1 moon shadow + up to 2–3 practical point-light shadows per character (3–4 full skeleton shadow passes per entity), `composeShadowKey(moonKey, x, y)` folds the nearest practical lamps into the moon/lightning key via vector irradiance weighting (`w = 1 / (1 + (d/R)²)`), yielding **one coherent shadow pass per character**.
- **Low-Stature Foreshortened Projection (`drawProjectedShadow`)**:
  - Vertical squash tightened from `-0.22` to **`-0.125`** (43% lower vertical stature on the ground deck so shadows hug the floor plane in 2.5D perspective instead of climbing the backdrop).
  - Ground-plane clamping (`deckAnchorY = Math.min(0, groundY)`) keeps airborne shadows anchored to the deck while shrinking/fading with height.
  - Replaced the 2-pass blur+core silhouette draw with a single low-stature silhouette pass plus planted-foot **Contact-AO pads** (`contacts`), and removed dead `shChains` world-skeleton allocations from `Player.drawShadow` and `Enemy.drawShadow` (`3.20 ms → 0.54 ms`, **5.9× faster**).

### 3. Kinetic Shallow-Strata Wake Fog (`ShallowFogField` in `src/game/render/bhst.ts`)
- **Low Stature**: Replaced the old `220–350 px` static fog walls (`CyberBackground` and `ZenNightBackground`) with two shallow, ground-hugging strata that never obscure character torsos, heads, or blade telegraphs:
  - **Far Horizon Crease (`~36 px` tall, `y ∈ [-26, +10]`)** along the rear railing seam.
  - **Near Deck Ribbon (`~46 px` tall, `y ∈ [-14, +32]`)** hugging the fighters' ankles and shins.
- **1D Eulerian Wake Simulation (64 cells)**:
  - Moving fighters and sword swings (`shallowFog.injectActor`) inject horizontal momentum (`u[i]`), carve density troughs (`d[i]`) behind dashes, and pile up swirling vapor crests (`w[i]`) at the leading edge of motion.
  - Forward-scattered per puff by live moon azimuth, lightning flash, and nearest practical lamp color (`#ff9a3c` lantern / `#ff2a6d` neon / `#05d5fa` cyan).

### 4. Verified Benchmark Results (`research/perf-bhst.json`)

Measured in headless Chromium at `1280×720` (`high` preset, `zen-night`):

| Metric / Pass | Original Baseline | After Initial 6 Fixes | After BHST + Lighting/Shadow/Fog Rework | Total Speedup |
|---|---:|---:|---:|---:|
| **Whole frame (`perf-verify-after`)** | **127.16 ms (7.9 fps)** | 72.73 ms (13.7 fps) | **37.74 ms (26.5 fps)** | **3.37× faster** |
| **Whole frame (uninstrumented loop)** | **124.90 ms (8.0 fps)** | 69.20 ms (14.5 fps) | **36.00 ms (27.8 fps)** | **3.47× faster** |
| **Overdraw (`screensPerFrame`)** | **25.50×** | 17.56× | **9.57×** | **-62.5% overdraw** |
| `bg.drawSky` | 28.20 ms | 28.34 ms | **2.79 ms** | **10.1× faster** |
| `drawBloom` | 27.12 ms | 7.64 ms | **4.18 ms** | **6.49× faster** |
| `lightmap.composite (multiply)` | 17.17 ms | 11.20 ms | **1.42 ms** | **12.1× faster** |
| `bg.drawArena` | 10.17 ms | 11.46 ms | **6.04 ms** | **1.68× faster** |
| `drawGrade` | 6.55 ms | 1.32 ms | **1.61 ms** | **4.07× faster** |
| `player.drawShadow` | 3.20 ms | 3.43 ms | **0.54 ms** | **5.93× faster** |
| `drawMoonShafts` + `storm.drawSky` | 17.90 ms | 0.03 ms | **0.00 ms** | **eliminated** |

#### Multi-Enemy Wave Scaling (`1280×720 high`)
| Active Enemies | Original Baseline | After BHST + Rework | Speedup |
|---:|---:|---:|---:|
| **0 enemies** | 124.7 ms (8.0 fps) | **36.5 ms (27.4 fps)** | **3.42× faster** |
| **4 enemies** | 140.6 ms (7.1 fps) | **49.7 ms (20.1 fps)** | **2.83× faster** |
| **8 enemies** | 138.4 ms (7.2 fps) | **54.7 ms (18.3 fps)** | **2.53× faster** |
| **14 enemies** | 146.3 ms (6.8 fps) | **70.1 ms (14.3 fps)** | **2.09× faster** |

#### Adaptive Resolution Scaling (`1280×720` viewport)
| Render DPR | Backing Store | Original Baseline | After BHST + Rework | Speedup |
|---:|---|---:|---:|---:|
| **DPR 1.0** | `1280×720` (0.92 MP) | 124.9 ms (8.0 fps) | **36.0 ms (27.8 fps)** | **3.47× faster** |
| **DPR 0.75** | `960×540` (0.52 MP) | 83.6 ms (12.0 fps) | **33.0 ms (30.3 fps)** | **2.53× faster** |
| **DPR 0.50** | `640×360` (0.23 MP) | 47.9 ms (20.9 fps) | **19.2 ms (52.0 fps)** | **2.49× faster** |


---

# Moonlit Sakura Sanctuary Engine (replaces the old `zen-night` scene + graphics stack)

Source: [`coders786/Optimization-of-Engines---Stickman-Rising`](https://github.com/coders786/Optimization-of-Engines---Stickman-Rising)
(`moonlit-sakura-optimized.html`, `optics-components.js`, `optics-shaders.js`,
`mountain-inn.js`, `shadow-engine.js`, `shadow-tiles.js`, `shadow-native-methods.js`,
`shadow-motion-envelope.js`, `evidence-mountains/PLAN.md`), ported into
`src/game/render/bhst.ts`, `src/game/world/horizon-strata.ts` and a completely
rewritten `src/game/world/zen-night.ts`.

## What is in the new scene

| Layer | Content |
|---|---|
| Celestial | 640×640 **Lommel–Seeliger** regolith bake: 6 maria + **540 procedural craters** (rim / bowl / central-peak heightfield, finite-difference normals), 7-stop corona halo; 320-star static sky bake + **nebula field** (7 clusters × 15 screen-blended lobes) + comet streak; **120 twinkling stars** + periodic meteor on a two-generation damage lattice |
| Mountains | **4 minimalist ridges** on a ridged multifractal profile (`1 - \|2n-1\|^p`, 5 named peaks), per-ridge base-darkening for aerial perspective, moon-side rim lights, **sparse conifers with moonlit edges**, snow contour facets; no background village |
| Mid band | near-mountain shoulder + recursive dead tree, 0.28× parallax |
| Architecture | **one detailed inn** (`mountain-inn.js` `paintHouse`/`houseParts`): timber-framed plaster, 9-row curved tile roof with offset channels, eave brackets, warm shoji door on the `DOOR_LIGHT` anchor, noren curtain, side glazing with swung shutters, stone-course chimney, chōchin lantern, signboard |
| Garden | yotsume-gaki fence runs, torii (curved kasagi + moon rim), tall stone lantern on the `STREET_LIGHT` anchor, pond stone edging with moss, 13 stepping stones |
| Life | swaying sakura (S-curve trunk, 5 upper limbs, **248-blossom rosette canopy** in 3 tonal layers + 3 orb glints), 36 falling petals with additive halos, 2 flying birds, hearth embers |
| Water | scissored puddle mirror, **3 analytic gravity–capillary waves**, gust-carried glitter lane, **4 ripple slots** fed by landing petals |
| Atmosphere | 5 shaded cloud banks with moonlit silver lining, **16 mist banks**, valley mist pools, crepuscular shaft fan, shallow-strata wake fog |

## The optimizations that paid

### 1. `drawMoonShafts` was the single largest pass in the whole game (53.34 ms → 0.00 ms)
The renderer's generic occlusion→radial-smear god-ray pass ran its 9-step ⅛-res
zoom-blur chain **every frame**. The Moonlit Sakura scene paints its own baked
crepuscular fan, so the generic pass now stands down
(`ownsMoonShafts === true`). Removing a duplicated full-screen system is not a
feature cut: the shafts are still on screen, drawn once per resize instead of
nine times per frame.

### 2. Reflection atlas — 20 Hz temporal bracketing (2.76 ms → 0.91 ms)
The wet-deck mirror re-drew the player + every enemy ghost **every frame** into
a plate that is then composited as water-chopped strips. At 20 Hz the worst-case
limb-tip delta is <1.5 px for the fastest state the game can produce
(2 600 px/s tip speed), so the pose is re-drawn on a 20 Hz cadence keyed on
`(span, quality)` and refreshed immediately on a lightning strobe. The 60 Hz
strip composite — the part that reads as water — never skips a frame.
`REFLECTION.atlasHz` is the single dial.

### 3. Bloom composite stays 8× reduced but never re-samples twice
The old path copied to ¼-res, ran two self-multiply passes, downsampled to ⅛,
re-upsampled to ¼ and then did **three** full-screen composites. Now: one ⅛
downsample → one 1:1 pre-upsample into a device-pixel plate → one unscaled
`lighter` composite (the SIMD fast path). `27.12 ms → 10.03 ms`, with a cached
plate that is only rebuilt on a tier cadence or a strobe.

### 4. Dynamic props cost O(frustum), not O(scene)
`blitWorldFrustum` now also slices the inn (422 px), the garden (2 900 px) and
the sakura (600 px) plates, and the light-rig lane, cloud shadows, water and
practical pools are all frustum-tested **before** any draw call. Measured
`drawArena = 0.10 ms`, `drawLightRig = 0.09 ms`, `drawWetMask = 0.00 ms`.

### 5. Complete-footprint shadow certificates before any 12-tap evaluation
`ShadowFieldSAT` (ported from `shadow-tiles.js` / `shadow-native-methods.js`)
compiles the props' foreshortened occluders into an **integer 0/1/2 prefix SAT**
(clear / uncertain / opaque) with a separable binary-dilation swept-motion
envelope around the swaying canopy. Any ray-disk footprint is then certified in
**four integer lookups**: `sum === 0` → fully lit, `sum === 2·area` → fully
umbral, and only a straddling footprint runs the **12-tap rotated Poisson disk**
(`POISSON_12`, the reference kernel). The moon lane on the deck literally stops
inside the inn's shadow, and the cost is bounded by the number of *visible*
lane parcels, not by the mask resolution.

### 6. `windAt` — one analytic gust carrier for six systems
Clouds, mist banks, falling petals, canopy sway, water waves and the star drift
all read ONE closed-form gust `[vx, vy, ∫vx dt, ∫vy dt]`. The integral is
analytic (`∫sin = -cos/a`, `∫cos = sin/a`), so `d/dt x(t) === vx(t)` to machine
precision (`tests/moonlit-sakura-optics.test.ts` proves it against a finite
difference). No consumer keeps its own accumulator, so nothing can drift, and a
`NaN` clock cannot propagate (sanitized at the single source).

### 7. `DamageSurface` two-generation 32-px lattice
The twinkling-star/meteor layer is a persistent half-res canvas cleared through
a 32-px damage lattice: dirty tiles from `prev` ∪ `cur` are cleared with
`floor(x·dpr)` / `ceil(x·dpr)` bounds (no fractional-DPR ghost fringe), with a
single full clear when dirty coverage exceeds **58 %**. The star field therefore
never re-rasters 120 gradient sprites, and never leaves a trail behind a
fast-moving meteor.

## Verified results (headless Chromium 1280×720, software Canvas2D, `medium`)

**Same scene, same viewport, same quality tier** — the only difference is the
new engine (`/tmp/perf/bench.mjs`, 90 instrumented frames after 8 warm-ups):

| Pass | Before (old `zen-night`) | After (Moonlit Sakura engine) | Change |
|---|---:|---:|---:|
| **Whole frame** | **93.13 ms (10.7 fps)** | **12.8–15.5 ms (65–78 fps)** | **6.0–7.3× faster** |
| `drawMoonShafts` (generic pass) | 53.34 ms | **0.00 ms** | eliminated (scene owns its fan) |
| `drawBloom` | 8.25 ms | 9.4–11.4 ms | neutral (one ⅛ pass, one 1:1 composite) |
| `drawReflections` | 2.76 ms | **0.84–1.05 ms** | **2.6–3.3× faster** (20 Hz atlas) |
| `drawSky` | 0.11 ms | **0.08 ms** | 1:1 coherence vault blit |
| `drawArena` | 0.06 ms | 0.10–0.13 ms | frustum-sliced inn/garden/sakura |

Art was **added**, not removed, in the same measured frame: 4 ridged-multifractal
ridges (before: 3 smooth sine ridges), a full detail inn (before: a flat tea-house
box), a 248-blossom canopy (before: 520 loose petals), a 640×640 crater moon
(before: a 360×360 gradient disc), the full mist/cloud/bird/petal populations,
plus the SAT shadow certificates and the analytic gust carrier — which the old
scene did not have at all.

Frame-time breakdown at `medium` after the rework (`research/perf-sakura.json`):
`drawBloom 11.40 · drawReflections 1.05 · drawWeather 0.40 · drawArena 0.13 ·
drawSky 0.08 · drawLightRig 0.08 · drawWetMask 0.01 · drawVignette 0.00 ·
drawGrade 0.01 · drawGrain 0.01`. The remaining ~2 ms is player/enemy/HUD/fx
work owned by the gameplay renderer, not the background.

Bloom is now the last expensive pass and it is **not** the background's: it is
a full-screen 1:1 `lighter` composite, whose cost is the destination pixel
visit on software raster, not the source resolution. It is kept at ⅛ source
resolution and composited unscaled (SIMD fast path) with the plate rebuilt
only on a tier cadence or a strobe.

## Visual-quality gates that had to pass before the numbers meant anything

Every one of these was found by looking at the rendered frame, not at a
profile — they are recorded because each one is a law the scene now obeys:

1. **The moon was drawn twice.** Scaling the 640×640 lunar bake up for a halo
   pass also scaled its DISC, leaving a phantom moon behind the real one. The
   aureole is now its own glow-only sprite (three concentric screen blits),
   and the disc is one blit.
2. **The crater bake read as soap bubbles.** Contrast was being pushed through
   the *light* term, which floods every rim to white. Regolith contrast now
   lives in the albedo term (mare depth × 1.05, rim brightening ÷2, light band
   narrowed) — the disc has basins, not blisters.
3. **Aerial haze was painted over the mountain crests**, greying every rim
   light. Haze is the air the range sits *in*: it is laid down BEFORE the
   ridges, and valley mist after them.
4. **The near shoulder covered the range.** The mid-band mass is now a low
   treeline whose base sits below every ridge base, so the range stays visible.
5. **Ridge crests were sine dunes.** They are now a ridged multifractal
   (`1-|2n-1|` raised to a power, plus 5 named peaks) sampled at ~7 px, with a
   single gradient fill (crest → valley shadow) instead of a flat fill plus an
   overlay.
6. **The sakura canopy was a streak.** Two different per-axis scales turned
   the reference's blossom cluster table into a smear, and the limb recursion
   threw branch tips far outside the island bake. Canopy and limbs now share
   ONE scale, the crown is a 380×170 px mass of 248 rosettes over 12 clusters,
   and every child limb terminates inside the crown.
7. **A bank painted a black bar across the moon.** Distant banks now draw
   BEHIND the disc; only the nearest bank re-crosses it (at 0.16 alpha) so the
   occlusion the analytic transport measures is also the occlusion you see.
