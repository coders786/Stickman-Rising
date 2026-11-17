# 06 — PIPELINE & FRAME BUDGETS (Phase 8)
**Serves:** D2 (performance-first mobile) · D3 (GPU atmosphere) · REQ-7xx.
**Status of every number:** marked [M] measured in this repo · [E] estimated from
research + arithmetic · [T] target. Nothing here is a device measurement; the
sandbox has no GPU timer (discovery M1).

---

## 1. Frame structure

### Mode A — GPU-generated plates (low / medium)
```
CPU   env.update           ~0.02 ms   [E]
CPU   quality.govern       4 Hz       [M] existing
CPU   Canvas2D game draw   ~4–6 ms    [E] (11 blits + entities + FX)
CPU   cloud drift blit     3 blits    [T]
────  no GPU pass, no extra compositor layer, 1 canvas
```

### Mode B — live GPU atmosphere (high / ultra)
```
CPU    env.update + uniforms   ~0.03 ms          [E]
CPU    atmosphere.render()     ~0.1 ms submit     [E]
GPU    sky quad                1 pass  ~20 ALU    [E]
GPU    cumulus quad           18 noise samples/px [R]
GPU    stratus / cirrus/fog    3 quads            [E]
GPU    grade quad + LUT                              [E]
CPU    Canvas2D game draw      ~4–6 ms            [E]
COMP   +1 compositor layer     0.3–1.5 ms         [R]
```

**Compositor evidence:** each extra layer ≈ **0.3–1.5 ms**, and a full-screen
transparent overlay is the worst case because it blends every pixel. [R]
https://digitalstrategyforce.com/journal/what-are-gpu-performance-budgets-and-how-do-you-optimize-render-pipelines/

---

## 2. Tier budgets (provisional, labelled)

| Item | low | medium | high | ultra |
|---|---|---|---|---|
| Mode | A (Canvas2D fallback art allowed) | A (GPU plates) | B (WebGL2) | B (WebGL2 / WebGPU) |
| Frame target | 60 fps (16.7 ms) mobile, 120 fps desktop | 60 | 60 | 60–120 |
| CPU (game + env) | ≤ 8 ms | ≤ 8 ms | ≤ 9 ms | ≤ 10 ms |
| GPU atmosphere | 0 ms | 0 ms (boot-time only) | **≤ 3.0 ms** | **≤ 4.5 ms** |
| Compositor delta | 0 | 0 | ≤ 1.0 ms | ≤ 1.5 ms |
| GPU draw calls | 0 | 0 (frame) | **≤ 7** | ≤ 9 |
| Canvas2D blits | ≤ 14 | ≤ 18 | ≤ 20 | ≤ 26 |
| Cloud systems drawn | 1 (baked) | 3 plates | 3 quads | 3 + 2nd cirrus |
| Noise samples / px | 0 | 0 (pre-baked) | ≤ 20 (cumulus) | ≤ 26 |
| Shader ALU ceiling | — | — | ≤ 130 (cumulus only) | ≤ 160 |
| Canvas memory | ≤ 38 MB | ≤ 40 MB | ≤ 42 MB | ≤ 46 MB |
| GL texture memory | 0 | ≤ 4 MB | ≤ 6 MB | ≤ 8 MB |
| Warm re-bake | ≤ 16 ms | ≤ 16 ms | ≤ 10 ms (plates on GPU) | ≤ 10 ms |
| Boot shader compile | 0 | 0 | **0 hitch** (prewarm) | 0 hitch |

**Why "≤7 draw calls" is not the constraint people expect:** mobile guidance is
~100 draw calls/frame [R] https://www.utsubo.com/blog/threejs-best-practices-100-tips.
Our GPU layer is 7 quads; the *real* risk is **fill rate**, not draw count.

---

## 3. Fill-rate arithmetic (the actual mobile risk)

At 1280×720 CSS px, DPR 1, sky ≈ 60 % of frame:

```
sky pixels          ≈ 553 k px
cumulus samples     = 553 k × ~18 noise lookups ≈ 10.0 M lookups/frame
+ stratus/cirrus/fog ≈ +4 M
```

Mitigations, in order of value:
1. **Half-res atmosphere** (render at 0.5×, upscale): **4× fewer pixels** →
   ≈ 2.5 M lookups. Prototype P1 decides if cirrus survives it.
2. **2-level warp + 4 octaves** instead of 3-level/6-octave: −33 % twice. [R]
3. **Octave LOD** by distance from the horizon (fewer octaves near the top).
4. **`mediump` everywhere in fragment shaders** (up to 2× faster / 2× more
   power-efficient on Adreno; Arm/Apple guidance agrees). [R]
5. Sky canvas at **0.75× DPR** on `high` mobile (it is a soft image — nobody sees it).

---

## 4. Memory accounting

| Bucket | Today [M] | Mode A [T] | Mode B [T] |
|---|---|---|---|
| Background plates (Canvas2D) | 30.1 MB | 30.1 − removed sky plates + 6.4 (cloud plates) | 30.1 − removed sky plates |
| Props sprites | 0.2 MB | 0.2 | 0.2 |
| Reflection buffer | ~8 KB | ~8 KB | ~8 KB |
| LUT strip(s) | 0 | ≤ 96 KB | ≤ 96 KB |
| Sky canvas (DOM layer) | 0 | 0 | ≈ 17 MB @1600×900 [R] |
| GL textures | 0 | ≤ 2 MB | ≤ 6 MB |
| **Total** | **30.3 MB** | **≈ 37 MB** | **≈ 47 MB** |

Layer memory evidence (0→1 layer: 11.9 MB → 28.9 MB GPU at 1600×900) [R]
https://developer.ibm.com/tutorials/wa-canvashtml5layering/

**Watch item:** Mode B's 47 MB is above the 38 MB target set in REQ-702. Either the
target is raised for `high`/`ultra` (documented) or the sky canvas runs at 0.75 DPR
(≈ 9.6 MB) → ≈ 40 MB. Decision pending prototype P4.

---

## 5. Enforcement (so budgets are real)

1. `scripts/bench-render.mjs` prints: blits by composite-op, canvas bytes resident,
   bake ms, mode, tier, and (if present) GL program compile ms.
2. `scripts/bench-atmos.mjs` prints: draw calls, uniform bytes/frame, texture
   bytes, and — where `EXT_disjoint_timer_query` exists — real GPU ms per pass.
3. Budget assertions fail the script (`process.exitCode = 1`) when a tier exceeds
   its row in §2. A failed budget cannot be merged with a comment.
4. Every doc claim cites the script output, not a hope.

---

## 6. Update / render order (canonical)

```
per frame:
  input → gameplay update → camera → env.update(dt) → quality.govern(4 Hz)
  → uniforms (bytes only) → [Mode B: atmosphere.render] → renderer.draw(game)
  → flashLedger.commit → hud → perf readout (dev)
per run start:
  profile select → (Mode A: regenerate plates from profile) → bake plates
  → prop scheduler reset → camera snap
on profile/weather change:
  LUT cross-fade start (no re-bake of geometry)
on resize:
  canvas sizes + DPR (existing path) + atmosphere.resize() (textures only)
```

---

## 7. What is deliberately *not* budgeted

* Storm rain overdaw (existing engine, tier-budgeted 96/180/288/288 drops).
* Combat FX (pooled; protected by 244 tests — not this project's lever).
* HUD (baked plates).

Those are pre-existing and already governed; this project's new costs are the
atmosphere pass and 3–6 MB of textures, both above.
