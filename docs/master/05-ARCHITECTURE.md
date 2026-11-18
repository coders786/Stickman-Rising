# 05 — RENDERING ARCHITECTURE (Phase 7)
**Serves:** D3 (new technology) + D1 (profiles, full fidelity) + D2 (performance-first mobile).
**Supersedes:** the "two stacked canvases always" sketch in `02-TECH-SELECTION.md` §5 —
research on compositor cost (below) produced a **two-mode** design that is better on
mobile and still premium on desktop.

---

## 0. The finding that changed the design

* Every **extra canvas layer** costs GPU memory: one 1600×900 layer moved GPU memory
  from **11.9 MB → 28.9 MB** in a measured study, and 32 layers reached 187 MB. [R]
  https://developer.ibm.com/tutorials/wa-canvashtml5layering/
* **A full-screen transparent overlay is the most expensive compositor pattern** —
  it forces the compositor to blend every pixel, "effectively doubling the pixel
  throughput", at **0.3–1.5 ms per extra layer**. [R]
  https://digitalstrategyforce.com/journal/what-are-gpu-performance-budgets-and-how-do-you-optimize-render-pipelines/

**Consequence:** paying compositor cost *every frame on every phone* to animate
clouds is the wrong default for a performance-first mobile mandate (D2).

---

## 1. Two modes, one weather model

```
MODE A — "GPU as GENERATOR"  (mobile / medium)
  Boot: WebGL2 offscreen canvas → fBM/Worley/LUT shaders render RICH CLOUD PLATES
        and a grade strip ONCE (or on profile change)
  Frame: single Canvas2D canvas blits those plates (integer offsets for drift)
  Cost: 0 compositor layers · blits only · animation = offset + cross-fade
  Quality ceiling: far above today's painted tiles (shader noise, 6 octaves)

MODE B — "GPU as RENDERER"  (high / ultra)
  Boot: WebGL2 (or WebGPU) canvas BELOW the game canvas, programs prewarmed
  Frame: live shader atmosphere (drift, morph, fog, shafts) + Canvas2D game on top
  Cost: +1 compositor layer, measured, tier-gated, first thing the governor drops
  Quality ceiling: clouds that evolve, moon being eaten, fog that breathes
```

Both modes read **the same `EnvironmentProfile`** and the same uniform struct. Mode A
is not a "degraded Mode B": it is a *generated-art* path whose output is authored by
the same shaders, frozen. That preserves identity (GC-3) while removing per-frame
GPU work — exactly what a phone needs.

**Default assignment:** `low`/`medium` → A · `high`/`ultra` → B · user override
(`atmosphere: auto | live | baked | off`) · governor may demote B→A at runtime.

---

## 2. Component map

```
                    ┌──────────────────────────────┐
                    │      EnvironmentController    │  src/game/world/env.ts
                    │  profile · weather · time     │  (single source of truth)
                    └───────┬──────────────┬────────┘
        publishes 64-byte   │              │  publishes profile axes (data)
        uniform struct      ▼              ▼
        ┌───────────────────────────┐  ┌──────────────────────────────┐
        │   src/gpu/AtmosphereLayer │  │  src/game/render/* (Canvas2D)│
        │  context · programs ·     │  │  background · renderer · hud │
        │  meshes · uniforms · timer│  │  props · fx · entities       │
        └───────────┬───────────────┘  └──────────────┬───────────────┘
                    │ draws sky canvas                │ draws game canvas
                    └──────────────┬──────────────────┘
                                   ▼
                          browser compositor
                                   │
                        ┌──────────▼──────────┐
                        │ GraphicsQualityMgr  │  src/game/render/quality.ts
                        │ tier · DPR · modes  │  (governor already exists)
                        └─────────────────────┘
```

### 2.1 Responsibilities (strict)

| Component | Owns | May NOT |
|---|---|---|
| `EnvironmentController` | profile selection, weather state machine, wind vector, moon phase, time-of-night, transition timers | draw anything |
| `ProfileStore` | the frozen `EnvironmentProfile[]`, LUT data, cloud recipes | mutate at runtime |
| `GraphicsQualityManager` | tier, DPR target, mode (A/B/off), thermal hysteresis, user override | change profile identity |
| `src/gpu/AtmosphereLayer` | GL context, programs, textures, uniforms, timing | import `src/game/entities/**`, read gameplay state |
| `src/game/render/background` | arena, baked fallback sky, props, reflections | upload uniforms, touch GL |
| `src/game/render/renderer` | draw order of the game canvas | decide tier |
| `FlashLedger` | luminance-event budget | draw |

### 2.2 Import boundary (lint-enforced, REQ-805 amended)

```
src/gpu/**      → may import: src/gpu/**, src/game/world/profile.ts (types only)
src/game/**     → may import: src/gpu/types.ts (the uniform struct ONLY)
src/gpu/**      → must never import: entities, combat, anim, fx, renderer, React
```
The uniform struct is a frozen plain object with **numbers only** — no functions, no
class instances — so it can be unit-tested headlessly and diffed.

---

## 3. Data flow per frame (Mode B)

```
1  env.update(dt)                     weather timers, wind, moon orbit   (CPU, ~0)
2  quality.govern(dt)                 tier/DPR/mode decisions            (CPU, 4 Hz)
3  uniform = env.uniforms()           one 64-byte struct (no allocation)
4  atmosphere.render(uniform)         GPU: sky + clouds + fog + grade
5  renderer.draw(game canvas)         Canvas2D as today (sky pass skipped)
6  flashLedger.commit()               event budget (≤3/s, ΔL ≤10 %)
7  HUD last                           stays in the game canvas
```
Mode A replaces 4 with: `background.blitCloudPlates(uniform.drift)` → 3 blits.

### 3.1 Uniform struct (64 bytes, versioned)
| Field | Type | Meaning |
|---|---|---|
| `time` | f32 | seconds (wrapped to 3600) |
| `wind` | f32×2 | direction × speed (profile) |
| `coverage` | f32×3 | cumulus, stratus, cirrus |
| `moonPhase`, `moonX`, `moonY` | f32×3 | phase 0..1, screen-ish position |
| `skyTop`, `skyHorizon` | f32×2 packed rgb | gradient ends (profile) |
| `fogDensity`, `lightAzimuth`, `lightElev` | f32×3 | atmosphere + key light |
| `gradeMix`, `stormI` | f32×2 | LUT blend + lightning |
| reserved | f32×4 | future (no re-layout) |

---

## 4. Program inventory (kept deliberately tiny)

| Program | Passes | Est. ALU | Notes |
|---|---|---|---|
| `sky` | 1 fullscreen quad | ~20 | gradient + stars sample + moon composite |
| `cumulus` | 1 quad | ~120 (4 oct × 2-level warp) | threshold + soft edge |
| `stratus` | 1 quad | ~30 | 2 oct, stretched UV |
| `cirrus` | 1 quad | ~18 | 1 oct ribbon + anisotropic stretch |
| `fog` | 1 quad | ~25 | layered noise × height |
| `grade` | 1 quad | ~8 + LUT sample | 16³ LUT in a 256×16 strip |
| `plateGen` (Mode A only) | 1 offscreen pass per type | — | bake-time, never in frame |

**Evidence for those numbers:** domain-warped clouds cost 18 noise samples/pixel at
3 warp levels × 6 octaves (up to 54 with finite differences); **2 warp levels ≈ −33 %**
and **4 octaves ≈ −33 %** with little visual loss, and octave LOD by distance is the
standard further cut. [R]
https://github.com/MiniMax-AI/skills/blob/main/skills/shader-dev/reference/domain-warping.md

**Precision:** fragment default `mediump`; 16-bit is up to **2× faster and 2× more
power-efficient** on Adreno (Qualcomm), recommended on Mali by Arm and on Apple GPUs
for register pressure; MDN: don't require `highp` in fragment shaders. [R]
https://www.utsubo.com/blog/threejs-best-practices-100-tips ·
https://mdn.beonex.com/en/WebGL/WebGL_best_practices.html

---

## 5. Grading: LUT, not a shader branch farm

A 16³ LUT is **16 KB**, sampled trilinearly; the standard layout is a **strip of N
slices of N×N** (red across, green down, blue slice-to-slice), with the two nearest
slices blended by hand so hardware filtering cannot bleed across slice edges. [R]
https://scanmountgoat.github.io/Smush-Material-Research/post_processing/colorgradinglut/ ·
https://developer.nvidia.com/gpugems/gpugems2/part-iii-high-quality-rendering/chapter-24-using-lookup-tables-accelerate-color

* One LUT per `(profile × weather)` pair, generated at boot on the CPU into a
  `Uint8Array` (16 KB each, ≤6 resident).
* Weather transitions cross-fade **two LUTs** by `gradeMix` — no shader rewrite, no
  per-frame CPU work.
* Mode A applies the same LUT **at plate-generation time**, so baked and live paths
  cannot drift apart visually.

---

## 6. Error handling & fail-closed rules

| Failure | Detection | Behaviour |
|---|---|---|
| No WebGL2 | `getContext('webgl2')` null | Mode A with canvas-2D-scaled plates (existing baked sky as last resort) |
| Shader compile/link error | `getShaderInfoLog` | log once, disable layer for session, Mode A |
| Context lost | `webglcontextlost` event | `preventDefault`, keep game canvas running, rebuild on `restored`; if not restored in 2 s → Mode A for the session |
| Program hitch at boot | boot timing probe | blocks release: prewarm in `requestIdleCallback` before first gameplay frame |
| Thermal / fps collapse | governor (exists) | B→A, then DPR, then tier — in that order (GPU first, gameplay last) |
| Uniform NaN | dev assertion | clamp + one-time warn |

**Rule:** the game must be playable with the atmosphere layer entirely absent. That is
the compatibility gate (Phase 15) and the reason Mode A exists at all.

---

## 7. Directory plan (Milestone 1)

```
src/gpu/
  types.ts            Uniform struct + AtmosphereMode union (imported by game)
  context.ts          context acquisition, caps, precision probe, loss handling
  programs.ts         sky / cumulus / stratus / cirrus / fog / grade (+ compile cache)
  shaders/            *.glsl.ts template strings (no bundler plugins)
  atmosphere.ts       AtmosphereLayer: render(uniform), resize(), dispose()
  plates.ts           Mode A: generate cloud plates + LUT strip via GPU, return canvases
  timer.ts            optional EXT_disjoint_timer_query wrapper (dev only)
src/game/world/
  profile.ts          EnvironmentProfile + profileForSeed + validation
  env.ts              EnvironmentController (weather state machine, wind, moon)
  grade.ts            CPU LUT generation (shared by both modes)
src/game/render/
  quality.ts          GraphicsQualityManager (wraps the existing governor)
```

Existing code **kept**: `background.ts` baked sky becomes the Mode-A fallback and the
`low` tier art. It is **not deleted** — it is the compatibility floor.

---

## 8. What this architecture refuses to do

1. **No per-frame canvas→canvas sampling** in either mode (R1).
2. **No third canvas.** Two is the measured ceiling (compositor + GPU memory).
3. **No shader variant explosion** — 7 programs, feature flags via uniforms, not
   `#define` permutations.
4. **No gameplay knowledge in the GPU layer** — it knows wind, moon and time, nothing else.
5. **No silent fallback** — the active mode is reported in the perf readout and the
   debug overlay so a "why does it look different" report is answerable.

---

## 9. Open items for `06-PIPELINE-BUDGETS.md`

* Frame-time split per mode/tier with the compositor cost included.
* Draw-call budget (mobile guidance ~100/frame; we are far below — but the Canvas2D
  side must be counted too).
* Fill-rate budget for the atmosphere quads (overdraw × resolution).
* Shader instruction ceiling (mobile convention <50 for "simple"; our cumulus is
  above that, so it is explicitly a *high-tier* program).
