# LIGHTING RESEARCH DIGEST — V4 EVIDENCE PASS
### Planning only. Research → decision → seam. Nothing here is built.

This is the evidence layer under `docs/LIGHT-SHADOW-V4-PLAN.md`. Every finding
below names its source, states the claim **narrowly** (what the source actually
supports), and then says exactly what changes in our plan. Where a source is
about WebGL/Unity and we are Canvas2D, that is called out — we do not borrow
confidence we did not earn.

---

## 1. Method, and what research can and cannot prove here

**Can:** tell us which techniques are industry-standard cheap, which failure
modes are known, what accessibility limits are legally/ethically binding, and
which architecture choices have bitten other Canvas2D projects.

**Cannot:** tell us our frame time. Every performance claim in this document is a
*hypothesis to test on our stack*, and each one ships with a test in §4.

Rule for this pass: **a borrowed number is not a measurement.** Cited numbers
appear only to justify *why an experiment matters*, never as our result.

---

## 2. Findings

### R1 · `drawImage(canvas → canvas)` can be a synchronous GPU readback  ← **architecture risk**
**Source:** Chromium issue 40314054 — "This hits a known slow path that performs
a readback from the WebGL canvas… The readback is synchronous so it may block the
main renderer thread."
https://issues.chromium.org/issues/40314054

**Source (2D case, and the scary one):** a Canvas2D project measured **0.7–1.2
fps** on GPU-accelerated Canvas2D with *two* canvas-to-canvas `drawImage` blits of
large layers per frame; the same page ran **23 fps** with
`--disable-accelerated-2d-canvas`, and **22.9 fps** when every draw-path context
was created with `willReadFrequently: true`. Their acceptance note is the lesson:
*"Identify (with a count of getImageData/drawImage(canvas) readbacks per frame)
which canvases are read back, and fix the cause rather than only the flag."*
https://github.com/scifieconomicslab/paperdolls/issues/3

**Why this matters to us:** V3's `drawReflections()` does exactly this — it reads
the **main canvas** into a buffer, **every frame**:

```ts
g.drawImage(ctx.canvas, 0, deckY - srcH, w, srcH, 0, 0, bw, bh)
```

If Chromium takes the slow path for our main canvas (a large, GPU-backed surface),
the cheapest-looking feature we shipped could be the most expensive thing in the
game, and it would not show up in a JS-only timer the way we currently measure.

**Plan delta — this is the single biggest change research makes:**
1. **New Phase 0** (before any V4 feature): measure the real cost of that one
   call at `dpr 0.8 / 1 / 1.5 / 2`, three screen sizes, with and without
   `desynchronized`, and with the source region reduced. Pass/fail in §4.
2. **Ship a no-readback fallback behind a constant** — the "silhouette mirror":
   instead of sampling the framebuffer, draw a *simplified* reflection source into
   the 1/8 buffer — compressed city/sky gradient strip + capsule silhouettes for
   player/enemies/props + dot sparks. That is ~20 primitive fills at
   200×14, no readback at all, and it still "responds to the player".
3. **Reduce the source region** regardless: read `0.9 × bandH` instead of `1.5 ×`
   (the extra band above the deck is mostly empty sky and costs readback area).
4. **Never set `willReadFrequently: true` on draw-path canvases** — research is
   explicit that it *disables GPU acceleration* and makes writes far slower, with
   filters especially. We must also assert **zero `getImageData`** in the draw
   path: Chrome's heuristic disables GPU acceleration after as few as **two**
   reads. https://www.schiener.io/2024-08-02/canvas-willreadfrequently

---

### R2 · Flipped-sprite reflection is the cheap standard, and it is ours already
**Source:** Unity2D thread — *"The same way other games do it, render the same
sprite upside down and flipped, then add an alpha colour to it… Flipping the
sprite is actually so much more efficient than trying to actually reflect the
sprite in a mirror. Most mirror and water reflections in games do this"* (cites
Max Payne, Haze). https://www.reddit.com/r/Unity2D/comments/40rnp3/sprite_reflection/

**Implication:** our baked `bakeFlipReflection` + per-prop mirror canvas is not a
compromise, it is the genre-standard technique. It also means the **R1 fallback is
not a downgrade in kind** — it is the same trick the industry uses, just applied to
entities instead of framebuffers.

**Plan delta:** promote `L11` (entity shadows) to also carry **entity mirrors**:
a flipped draw of the *same* sprite for player/enemies into the deck band, clipped
to the band, at low alpha. Entity sprites are already drawn once per frame; a
second pass with `scale(1,-1)` is the standard cost and needs no readback. This
becomes the preferred path if R1's experiment fails.

---

### R3 · Wetness wants **two masks**, not one
**Source:** a puddles-shader breakdown describes exactly the structure we planned,
then refines it: a larger **dampness** mask drives broad sheen/smoothness, and a
**smaller puddle** mask drives the mirror surface; the puddle's normals are forced
flat so only the small area is a true mirror.
https://medium.com/@tayhaocheng.media/creating-a-puddles-shader-in-unity-from-observation-to-implementation-828f85dc2a4e

**Plan delta — `L8` changes from binary to two-level:**
* Bake **one** alpha mask with two values: **damp ≈ 0.25** across large deck
  areas, **puddle = 1.0** in 5–7 small pools + gutters, feathered 40 %.
* Apply once to the 1/8 buffer with `destination-in`. Same one blit; the deck now
  reads as *damp concrete with pools* instead of "wet everywhere" or "dry with
  holes".
* Acceptance changes: coverage is no longer one number — assert **pool coverage
  18–30 %** and **damp coverage 55–75 %**, measured as alpha mass in the bench.

---

### R4 · Parallax: more layers genuinely help, and the spacing should be logarithmic
**Source:** a five-layer parallax pipeline study (PIXI.js/RPG Maker) reports
**+38 % perceived depth/spatial realism** and **85 %** of participants preferring
the parallax version, while holding **>46 fps on low-end hardware** using
"grouped texture loading, **dynamic layer visibility (adaptive culling)**, and a
**logarithmic depth scaling** method".
https://jurnal.kdi.or.id/index.php/bt/article/download/2742/1425/16398
Also: *"motion parallax is one of the most influential depth cues in 2D"* and
depth cues should **respond to player movement and camera perspective**.

**Implication for our ladder:** factors are currently **linear-ish**
(`.015 .032 .045 .065 .098 .14 .30`). A logarithmic series spends *perceptual*
budget where the eye discriminates, instead of bunching the far layers.
**Plan delta — new `L15`:** retune the ladder to
`f_i = f_max · (f_min/f_max)^(i/(n−1))` across the 7 planes, verify the depth
read by asserting **monotone, log-uniform ratios** in the bench, and let the
governor **cull the two deepest planes at `low`** (research's "adaptive culling").
Cost: zero — same blits, better spacing. **Risk:** the arena/near relationship is
hand-tuned; keep `near/.30` pinned and redistribute only the six below it.
Acceptance: ratios log-uniform within ±12 %; `low` tier draws ≤5 planes.

---

### R5 · Six-way lighting on fog cards = volumetric *feel* without volumetric cost
**Source:** a technical write-up on faking volumetric fog: pack light information
into texture channels and blend by the sun/moon direction — *"This approximates
volumetric light scattering, giving the fog depth and shape without the cost of
full volumetric lighting."* https://keirenwall.com/home/fog

**Plan delta — `V5`'s fog becomes directional instead of just layered:** bake
**2–3 tint variants** of each fog plate (moon-lit from upper-right, ambient, and
storm-lit) and cross-fade by `moonCover` + storm intensity. Two blits instead of
three plus a directional read. This is a genuinely better idea than V5's original
"three tinted plates" and costs the same.

---

### R6 · Fog billboards fail on hard edges and overdraw — bake the fix, cap the count
**Source:** a volumetric-fog thesis: billboards give *"a hard edge whenever another
surface intersects"* (solved by depth-aware **soft particles**), and *"drawing
multiple semi-transparent textures over each other causes a lot of pixel overdraw…
[which] might also decrease rendering performance severely."*
https://files.core.ac.uk/download/pdf/237085222.pdf

**Plan delta:** we have no depth buffer, so the 2D equivalent is a **bake-time soft
edge**: every fog/shaft card's alpha is premultiplied against the silhouette of the
plane behind it when it is built (free, once). And hard-cap fog cards at **3**, with
a total additive alpha ceiling per frame (see `L16`). This is the evidence basis for
the V5 budget line "+12 blits" being a *ceiling*, not a target.

---

### R7 · WCAG: three flashes per second is the binding ceiling
**Source:** WCAG 2.3.2 (AAA) — *"nothing may flash more than three times in any one
second"*, **no size/brightness/contrast exemption**; 2.3.1 (A) permits faster
flashing only below the general flash threshold, defined as an opposing relative
luminance change **≥10 %** where the darker state is **below 0.80**; red flashes
have a stricter threshold. Migraines/dizziness/nausea occur well below the seizure
threshold.
https://www.w3.org/WAI/WCAG21/Understanding/three-flashes ·
https://dockaccess.org/documentation/wcag-success-criteria/wcag232/

**Where we stand:** our lightning tint is `alpha ≤ 0.22` full-screen; hit flashes and
Impact Frames are short; the new reflection band **boosts by 1.6× on lightning**.
That last one is exactly the kind of compounding luminance event that needs a budget,
not a vibe.

**Plan delta — new `L16` (ships with V4, not later):**
1. **Flash budget** in code: at most **3** opposing luminance events per second
   *globally* (lightning + hit flash + reflection boost + glitter cycle share it).
2. **Per-event cap:** any full-screen luminance delta ≤ **10 %** of relative
   luminance (the WCAG general threshold) except combat flashes, which are
   **area-limited** (a burst sprite, not the screen) and already smaller than the
   25 %-of-10°-field exemption.
3. **Reduced-motion / photosensitivity setting:** disables ripple drift, glitter
   cycling, reflection lightning boost, and caps trauma amplitude.
4. **Automated test:** the harness computes the per-second luminance-event ledger
   **from our own parameters** (not pixels) and asserts ≤3 and ≤10 %.

---

### R8 · Canvas flags worth testing (and one trap)
**Source:** GPU-accelerated Canvas2D guidance: `alpha: false` opts into an
opaque GPU backbuffer; `desynchronized: true` allows pipelining; **never scale the
canvas with CSS** (forces resample, disables optimisations); prefer `drawImage`
compositing over `putImageData`; avoid `globalCompositeOperation` values like
`lighten`/`overlay` *in tight loops* because they can prevent batching.
https://www.alibaba.com/product-insights/pro-trick-for-faster-painting-gpu-accelerated-canvas-rendering.html

**What we can act on:** the main canvas *does* need alpha (the page composites over
a DOM background), so `alpha:false` is out. But two things are live questions:
* **`desynchronized`** — one attribute, possible pipelining win, risk of tearing on
  some displays → test, do not assume.
* **our additive usage** — we use `'lighter'` heavily (props, reflections, pools,
  FX). The claim is about *batching* in tight loops. **This is measurable**: count
  and time the additive vs `source-over` blits in phase 0.

**Plan delta — `L17`:** a small "compositing ledger" — every frame reports
`{ sourceOver, lighter, other }` blit counts and total additive alpha. It becomes a
permanent guardrail for "did this pass turn into soup?" and gives R8 an answer.

---

### R9 · What not to do (research explicitly warns)
| Idea | Why not | Source |
|---|---|---|
| Depth-aware soft particles via depth buffer | no depth buffer in Canvas2D; we bake the edge instead | R6 |
| Raymarched/volumetric fog | the literature frames it as per-pixel shader work; we have no shader stage | R6, V5 doc |
| Full-res SSR + bilateral blur | measured 4.15 ms → optimized 0.20 ms **by downsampling**; full-res is the expensive mistake | Babylon SSR docs (V3 research) |
| `willReadFrequently: true` on the draw canvas | disables GPU acceleration, wrecks write speed | R1b |
| CSS-scaling the canvas for "cheap resolution" | forces resampling, kills optimisations; we use `canvas.width` already | R8 |

---

## 3. What research changed in the V4 plan (read this instead of the diff)

| # | V4 as originally planned | V4 as revised by evidence |
|---|---|---|
| 1 | Reflection pass assumed cheap | **Phase 0 must prove it**; fallback = silhouette mirror (no readback) |
| 2 | `L8` binary puddle mask | **two-level damp + pool mask**, two acceptance numbers |
| 3 | `L11` shadow atlas only | atlas **+ entity flipped mirrors** as the R1 fallback |
| 4 | 7-plane parallax left alone | **`L15` logarithmic retune + tier culling of deep planes** |
| 5 | V5 fog = 3 tinted plates | V5 fog = **3 directional variants**, soft edges baked, cap 3 |
| 6 | Accessibility in the "later" roadmap | **`L16` flash budget ships with V4** |
| 7 | Perf claims from `/tmp` benches | `L13` harness + **`L17` compositing ledger**, committed |

Revised order: `Phase 0 (R1 experiments) → L1/L5/L6/L13/L17 → L2/L4/L7 → L8/L9/L10/L15 → L3/L11/L14/L16`.

---

## 4. Experiments to run in Phase 0 (pass/fail, no screenshots)

| E | Question | Method | Pass |
|---|---|---|---|
| **E1** | What does the framebuffer read cost? | time `drawImage(mainCanvas→buf)` alone, 500 frames, dpr 0.8/1/1.5/2, 3 viewports | ≤ 0.6 ms mean at dpr 1, ≤ 1.6 ms at dpr 2 |
| **E2** | Does source-region size dominate? | same at `0.5× / 0.9× / 1.5× bandH` | cost scales with source area ⇒ adopt `0.9×` |
| **E3** | Does `desynchronized` help or tear? | A/B the canvas attribute, 60 s soak | helps ≥10 % **and** no visual report of tearing |
| **E4** | Are additive blits a batching problem? | ledger counts + frame time with `lighter` forced to `source-over` | additive share < 40 % of blits OR no measurable delta |
| **E5** | Is the silhouette-mirror fallback cheap enough to be default? | stub + real fill counts | ≤ 0.35 ms and ≤ 25 primitives |
| **E6** | Do tier culls actually buy time? | force tier, count planes/blits, time | `low` ≥ 25 % cheaper than `high` |

If **E1 fails**, V4 ships the silhouette mirror and the framebuffer version moves
behind a flag — written down *before* the work, so the decision is not made in the
heat of wanting the pretty version.

---

## 5. Open questions this research raises

1. **Do we accept the entity-mirror fallback's look?** It is what Unity/Godot 2D
   games do and it reflects *sprites*, not the whole frame — so the sky won't
   mirror, only bodies. Cheaper, more controllable, arguably more readable.
2. **Is `desynchronized` acceptable for a game** that also has UI popovers, given
   tearing risk on some displays?
3. **Logarithmic parallax** changes the feel of the whole backdrop for a
   provably better depth read — but "feel" is the user's call, not the paper's.
4. **Flash budget vs. juice:** capping global luminance events at 3/s will soften
   multi-hit lightning moments. Intended, but it is a game-feel trade.

---

## 6. Sources

1. Chromium — drawImage WebGL→2D synchronous readback —
   https://issues.chromium.org/issues/40314054
2. Canvas2D GPU-acceleration cliff, 0.9 fps case, readback counting —
   https://github.com/scifieconomicslab/paperdolls/issues/3
3. `willReadFrequently`, GPU-acceleration heuristic, filter cost —
   https://www.schiener.io/2024-08-02/canvas-willreadfrequently
4. Unity2D — flipped-sprite reflections are the standard cheap mirror —
   https://www.reddit.com/r/Unity2D/comments/40rnp3/sprite_reflection/
5. Puddles shader — dampness mask + smaller puddle mask + flat normals —
   https://medium.com/@tayhaocheng.media/creating-a-puddles-shader-in-unity-from-observation-to-implementation-828f85dc2a4e
6. Five-layer parallax study — +38 % perceived depth, log scaling, adaptive
   culling, >46 fps low-end —
   https://jurnal.kdi.or.id/index.php/bt/article/download/2742/1425/16398
7. Six-way lighting for fog cards (directional fog without volumetrics) —
   https://keirenwall.com/home/fog
8. Volumetric fog thesis — billboard hard edges, overdraw cost —
   https://files.core.ac.uk/download/pdf/237085222.pdf
9. WCAG 2.3.2 Three Flashes (AAA, no exemption) —
   https://www.w3.org/WAI/WCAG21/Understanding/three-flashes
10. WCAG 2.3.2 practical thresholds (10 % general, 25 % red) —
    https://dockaccess.org/documentation/wcag-success-criteria/wcag232/
11. GPU-accelerated Canvas2D flags, composite-op batching caution —
    https://www.alibaba.com/product-insights/pro-trick-for-faster-painting-gpu-accelerated-canvas-rendering.html
