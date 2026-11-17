# 02 — TECHNOLOGY SELECTION (Phase 5–6)
**Decision it serves:** D3 — "use a new and distinct technology."
**Output:** one selected architecture, with rejected alternatives, boundaries,
migration plan and gates. Companion: `05-ARCHITECTURE.md` (not yet written).

---

## 1. What we are choosing between

The game today is a **32.8k-LOC hand-written Canvas2D renderer** with an
asset-free, bake-time art pipeline (discovery §1). The ask is a *new and distinct*
technology for the **environment** (sky, clouds, atmosphere, grading) — not to throw
away the game.

So the real question is not "Canvas2D or GPU?" but: **where is the GPU boundary,
and how do we keep it from touching the parts that work?**

---

## 2. Evidence: platform reach (the constraint that decides everything)

| API | Reach | Mobile reality | Source |
|---|---|---|---|
| **WebGL2** | Universal in modern browsers (baseline for years) | Works on iOS/Android, incl. older devices | long-standing baseline |
| **WebGPU** | **~86 % of sessions** (84–87 % depending on snapshot, Aug–Sep 2026); Chrome/Edge stable since 113, **Safari 26+ (iOS/iPadOS/macOS)** default; **Firefox stable on Windows 141+, Macs; not yet Linux/Android** | iOS < 26 and Firefox Android fall back to WebGL2 | caniuse-derived 2026 reports: [1], [2], [3] |
| **OffscreenCanvas + Worker** | Chromium + Firefox; Safari support partial | Useful for off-main-thread generation | MDN/implementation notes |

[1] https://www.xictron.com/en/blog/on-device-ai-browser-webgpu-shops-2026/ ·
[2] https://www.programming-helper.com/tech/webgpu-2026-next-generation-browser-graphics-compute-api ·
[3] https://www.utsubo.com/blog/webgpu-threejs-migration-guide

**Reading:** a mobile-first product (D2) cannot make WebGPU its *only* path in 2026
— the same sources say Safari needs **26+** and Firefox Linux/Android is not stable.
WebGL2 is the floor; WebGPU is an **ultra-tier upgrade**, feature-detected.

---

## 3. Evidence: what our own pipeline measured

From `LIGHTING-RESEARCH-V4.md` R1 and this project's baseline:
* Sampling the game's framebuffer (`drawImage(canvas→canvas)`) is a **suspected
  synchronous readback**; a Canvas2D project in the wild ran at **0.9 fps** with
  such per-frame blits and ~23 fps without them.
* Our resident canvas memory is **30.3 MB**; bake is **9.6 ms** warm per run.
* Every current effect is a blit of a baked plate — extremely cheap per frame, but
  **static**: clouds cannot evolve, fog cannot respond, grading cannot lerp.

**That is the gap the new technology must close:** *dynamic* environment at a
predictable cost, without per-frame readbacks.

---

## 4. Comparative matrix

| Criterion | A. More baked Canvas2D | **B. Hybrid: Canvas2D game + WebGL2 atmosphere** | C. Full WebGL2 rewrite | D. WebGPU-first | E. OffscreenCanvas worker |
|---|---|---|---|---|---|
| Visual ceiling for clouds/atmosphere | Low–medium (static tiles) | **High** — real fBM/domain warp per pixel | High | Highest | Same as A/B (transport, not renderer) |
| Mobile suitability | Excellent | **Good** (one extra fullscreen-ish pass, tier-gated) | Poor initially | Poor (reach) | Good |
| Platform reach | 100 % | **~100 %** (WebGL2), WebGPU optional | ~100 % | ~86 % | Chromium/Firefox |
| Migration cost | 0 | **Medium**: new module tree, 2-canvas compositing, shader pipeline | **Very high** (rewrite fighter/world/tests) | High + fallback | Low–medium |
| Risk to gameplay (Rule 10) | none | **Low** — game renderer untouched | High | High | Low |
| Frame-cost predictability | Very high (blits) | Medium (GPU pass; overdraw) | Medium | Medium | High |
| Thermal/battery | Best | Acceptable; first thing to shed on `low` | Worse | Worse | Neutral |
| Maintainability | Sheets of TS art | **Two clean tiers**: GPU env + TS game | One giant GL codebase | GL + WGSL + fallback | Split-brain draw |
| "New and distinct" (D3) | ✗ | **✓** | ✓ | ✓ (but risky) | Partial |
| **Verdict** | fallback path | **SELECTED** | reject | defer (ultra) | adopt as support |

---

## 5. Selected architecture — "GPU atmosphere, CPU game"

```
┌──────────────────────────────────────────────────────────────┐
│  <canvas id="sky">   WebGL2  1080p-ish, drawn FIRST           │
│    sky gradient · 3 cloud systems · fog/haze · grade          │
│    (WebGPU backend at ultra when navigator.gpu is present)    │
└───────────────────────────────┬──────────────────────────────┘
                                │ browser composite (no readback!)
┌───────────────────────────────▼──────────────────────────────┐
│  <canvas id="game">  Canvas2D  alpha:true, drawn SECOND       │
│    arena · props · shadows · enemies · player · FX · HUD      │
│    reflection band (existing, 1/8) · weather overlays         │
└──────────────────────────────────────────────────────────────┘
```

### 5.1 Why this wins
1. **It is genuinely new** (per-pixel procedural atmosphere in shaders) while the
   proven game renderer keeps its 244-test safety net.
2. **It dodges R1 entirely.** The GPU layer never reads the game canvas; the game
   canvas never reads the GPU layer. Compositing is the browser's compositor —
   zero readback, zero sync cost.
3. **Mobile-first by construction.** Tier `low` → GPU layer off, existing baked sky
   stays. The expensive thing is the first thing shed, and identity survives
   because the *baked* sky uses the same profile data.
4. **Ultra is honest.** WebGPU backend + 3 cloud systems + fog raymarch-free
   layering + per-pixel grade, only when `navigator.gpu` exists and fps allows.
5. **Fallback is not a rewrite.** The Canvas2D sky is already written and stays
   maintained as tier-`low` art.

### 5.2 Hard boundaries (non-negotiable)
| Rule | Why |
|---|---|
| `src/gpu/**` may not import `src/game/**` (and vice versa, except a thin adapter) | prevents the coupling that always kills hybrid renderers |
| No `getImageData`/`drawImage(gameCanvas)` in the GPU layer | R1 |
| No `drawImage(skyCanvas)` in the game layer | R1 |
| GPU layer owns no gameplay state; it reads a **plain uniform struct** published once per frame | determinism, testability |
| Shaders compiled + linked + first-draw at **boot**, not on first cloud frame | Phase 20 prewarming |
| Uniform upload ≤ 64 bytes/frame | keeps IPC trivial |

### 5.3 The atmosphere pass — cost model
| Item | `low` | `medium` | `high` | `ultra` |
|---|---|---|---|---|
| Backend | Canvas2D baked sky | WebGL2 | WebGL2 | WebGL2 / **WebGPU** |
| Cloud systems | 1 baked layer | 2 | 3 | 3 + 2nd cirrus deck |
| fBM octaves | — | 3 | 4 | 5 |
| Fog layer | baked plane | 2 layers | 3 layers | 3 + light shafts |
| Grade | baked LUT | LUT in shader | LUT in shader | LUT + local contrast |
| Fullscreen-ish passes | 0 (blits) | 1 | 1 | 2 |
| Target GPU ms (provisional [E]) | 0 | ≤1.5 | ≤3.0 | ≤4.5 |

Numbers are **estimated** from pass count and mobile fill-rate reality; they are
Phase 8/21 outputs once a device is available. Labelled provisional everywhere.

---

## 6. Rejected alternatives — why, so we do not revisit

| Rejected | Reason |
|---|---|
| **C. Full WebGL2 rewrite** | The fighter, world, FX and HUD are 32.8k LOC of canvas drawing with 244 tests. A rewrite risks the game to gain what the hybrid already gains. |
| **D. WebGPU-first** | ~14 % of sessions lack it; Safari requires 26+; Firefox Android/Linux not stable. Mobile-first can't ship on that. Kept as ultra upgrade. |
| **A. More baked plates** | Already at the ceiling of static art; clouds would not evolve, fog would not breathe. It *is* the current technology, which D3 supersedes. |
| **E. OffscreenCanvas as the headline** | Transport, not technology; it moves work, does not raise the visual ceiling. Adopted as support for **bake-time noise generation in a worker** (keeps the 9.6 ms run bake off the main thread). |
| **SVG/CSS effects for sky** | No per-pixel control, no noise, compositor-dependent. |

---

## 7. Migration plan (fits the milestone structure)

**M1 — foundation (no visuals change):** profile system + quality manager +
`src/gpu` skeleton with a context that can *fail closed*. Gate: game looks identical,
244/244 tests.

**M2 — GPU sky behind a flag:** gradient + static stars only, drawn under the game
canvas; Canvas2D sky disabled when GPU path active. Gate: pixel-free verification
(no readback), frame time within budget, instant fallback.

**M3 — cloud systems:** cumulus → stratus → cirrus, each its own program + uniform
block; per-profile coverage/density/wind. Gate: three systems measurably distinct
(coverage/edge-density probes), mobile `low` unchanged.

**M4 — fog + light shafts + grade:** layered fog with directional tint, LUT grade
in shader, god-shaft cards gated at high+. Gate: contrast probes, flash budget.

**M5 — ultra/WebGPU:** `navigator.gpu` backend behind the same interface; ultra-only.
Gate: identical uniforms, A/B measurable detail, fallback on adapter loss.

**M6 — governance:** governor now has a GPU lever (drops GPU layer before DPR),
thermal hysteresis, and a user "atmosphere: on/off" override.

---

## 8. Risks introduced by this choice

| Risk | Detection | Mitigation / fallback |
|---|---|---|
| GPU context loss on mobile | `webglcontextlost` listener | rebuild programs from cache; fall back to Canvas2D sky for the session |
| Shader compile hitch at boot | boot timing gate | prewarm all programs, compile in `requestIdleCallback` before first frame |
| Overdraw on phones (3 cloud layers) | GPU timer query where available; else fps | tier-gated layers; alpha ceilings; clouds drawn at half-res and upscaled |
| Two canvases = compositor cost | frame gap vs JS time (existing readout) | sky canvas at 0.75× DPR on mobile; single CSS layer promotion |
| Divergence between GPU sky and baked fallback | profile-driven shared data | both read the *same* profile values; fallback is generated from them |
| Driver quirks (precision, texture units) | feature detection + safe caps | `mediump` uniforms, ≤4 samplers, no extensions required |

---

## 9. Open technical questions for the prototype phase

1. **Half-res atmosphere** (render at 0.5× and upscale): does it visibly soften
   cirrus? Prototype P1.
2. **Cloud drift without shimmer**: integer texel offsets vs float UV scroll —
   which holds up at 0.5×? P2.
3. **Grade in shader vs LUT texture**: 3D LUT emulation (256×16 strip) vs analytic
   grade — which is cheaper on mobile? P3.
4. **Compositor cost of two stacked canvases** at DPR 1.5 on a mid phone — P4.
5. **WebGPU uniform path**: is one 64-byte UBO per frame truly free? P5 (desktop only).

Each prototype has a stated hypothesis and a numeric accept/reject in
`10-PROTOTYPES.md` (to be written before M2).
