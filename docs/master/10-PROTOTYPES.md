# 10 — PROTOTYPE PLAN (Phase 14)
**Rule 3 of the mandate:** do not invest in a subsystem before its uncertain
technique is proven. Six prototypes, each with a hypothesis, the cheapest possible
implementation, a numeric accept/reject, and what gets deleted if it fails.

All prototypes are **throwaway**: ≤150 LOC each, no production imports, no test
coverage requirements, and they never become architecture without a review entry in
`DECISIONS.md`.

---

## P1 · Half-resolution atmosphere
**Hypothesis:** rendering sky+clouds at 0.5× and upscaling with bilinear filtering is
visually indistinguishable for cumulus/stratus/fog and 4× cheaper in fill rate, but
*cirrus* may go mushy (it is the highest-frequency system).
**Method:** one quad, 3 cloud octaves, same seed; capture at 1.0× and 0.5×; measure
gradient energy (mean |∇α|) per system and the full-res/ half-res ratio.
**Accept:** cumulus/stratus gradient energy within **±8 %**; cirrus within **±15 %**
→ adopt half-res for `medium/high`, full-res only for cirrus at `ultra`.
**Reject:** cirrus loses >15 % → cirrus renders at full res into a small strip only.
**Why it matters:** this is the single largest lever on mobile fill rate (§3 of
`06-PIPELINE-BUDGETS.md`).

---

## P2 · Cloud drift without shimmer
**Hypothesis:** **integer texel offsets** of a pre-generated cloud texture avoid the
sub-texel crawl that float UV scrolling produces when the camera also moves, at the
cost of quantised motion that is invisible at ≤2 px/frame.
**Method:** in Mode A, scroll a generated plate by (a) integer texel steps,
(b) float UV steps; step the camera; capture per-frame delta images and compute
temporal variance in flat regions.
**Accept:** temporal variance in flat regions ≤ 1.5× the static baseline for (a)
and >3× for (b) → adopt integer offsets.
**Reject:** if both shimmer, generate the plate at 2× and scroll at 1× (cost: +memory).

---

## P3 · LUT vs analytic grade
**Hypothesis:** a 16³ LUT (16 KB, trilinear, two-slice blend) is no more expensive
than an analytic grade chain (contrast → lift → split-tone) on mobile and far more
expressive per instruction; but LUT sampling adds a dependent texture read.
**Method:** two grade shaders, same look authored both ways; measure ALU count and
(when available) GPU ms; compare ΔE between outputs.
**Accept:** LUT path within **+0.3 ms** of analytic at 1080p and ΔE ≤ 2 vs the
authored look → adopt LUT (needed for weather cross-fade anyway).
**Reject:** if the dependent read is costly on the target, use analytic grade and
implement weather blending as uniform lerps (loses authored subtlety, keeps speed).
**Evidence:** LUT is a single 3D texture lookup; 16³ = 16 KB; strip layout with
manual two-slice blending avoids hardware bleed. [R]
https://scanmountgoat.github.io/Smush-Material-Research/post_processing/colorgradinglut/

---

## P4 · Cost of the second canvas (**desktop-only gate since D7**)
**Hypothesis:** one extra full-screen canvas layer (Mode B) costs **≤1.0 ms** of
compositor time and ≤17 MB GPU at 1600×900 — acceptable at `high/ultra`, unacceptable
if it lands on every phone.
**Method:** a harness page with (a) one opaque 2D canvas, (b) the same + a WebGL
canvas beneath + a transparent 2D canvas above, (c) sky canvas at 0.75 DPR; measure
frame gap and memory with the existing perf readout pattern; soak 5 min for
thermals on a real device when one exists.
**Accept:** ≤1.0 ms delta at DPR 1 and ≤1.5 ms at DPR 2 → Mode B stays `high+` only.
**Reject:** >1.5 ms → atmosphere renders **into Mode A plates at runtime on a
schedule** (regenerate every N frames at low res, cross-fade), i.e. no second canvas
at all. This is a legitimate fallback: same shaders, no compositor cost.
**Why it is #1 priority:** it decides whether "new technology" is a per-frame GPU
pass or a GPU-generated art pipeline.

---

## P5 · WebGPU uniform path (desktop ultra only)
**Hypothesis:** a single 64-byte uniform buffer per frame is effectively free, and
the WebGPU backend can be swapped behind the same interface with no visual delta.
**Method:** implement `sky` only in WGSL; render the same frame in both backends;
diff pixel buffers (in the prototype only — this is the one place reading pixels is
allowed, because it is not the shipping draw path).
**Accept:** ΔE ≤ 1 per channel on the sky quad, submit cost <0.1 ms → keep WebGPU as
`ultra` backend.
**Reject:** any backend divergence → ship WebGL2 only; WebGPU deferred (not
cancelled).

---

## P6 · GPU plate generation at boot (Mode A)
**Hypothesis:** generating 3 cloud plates + 1 LUT on the GPU at boot costs
**≤40 ms once** and produces richer art than the current CPU tiles, without a
per-frame GPU pass.
**Method:** time `plates.generate(profile)` for 4 profiles × 3 systems on integrated
GPU; measure into a `readPixels` **once at bake** (allowed: not the draw path) to
copy into a 2D canvas.
**Accept:** ≤40 ms per profile switch, ≤1 MB texture each, no main-thread frame
>50 ms during boot → adopt Mode A as the *default* (it is the mobile path).
**Reject:** if readback is slow on mobile, generate plates on the **CPU** with the
same recipes (slower boot, same art) — Mode A does not depend on the GPU.
**Note:** the readback here is *bake-time*, which is the explicit exception to R1.

---

## P7 · Canvas-ledger stress (iOS silent-transparency class)
**Hypothesis:** the ledger's caps keep us far from WebKit's total canvas memory
limit, and zeroing released canvases actually reclaims them.

**Method:** create/release 500 canvases of mixing sizes through the ledger only;
after each 50 cycles, draw to a probe canvas and read one pixel. Run at the
top cap (48 live / 56 MB). Safari-only check (manual, when a device exists): the
failure mode is *silent transparency*, so the probe is the sensor.

**Accept:** 0 probe failures, live count never above cap, bytes return to the
baseline ±2 % after release, no unbounded growth over 500 cycles.
**Reject:** any probe failure ⇒ cut mobile caps to ≤32 canvases / 40 MB and
evict cloud plates to 3.
**Illuminating source:** WebKit bug 195325 ("Total canvas memory use exceeds the
maximum limit", 224/384 MB, canvases render transparent);
konva#653 (released canvases are not reclaimed until `w=h=0`).
**Cost:** 1 hour in node for the ledger, plus one manual Safari run.

---

## P8 · GPU-baked plate vs today's Canvas2D sky
**Hypothesis:** a shader-generated sky plate is within perceptual tolerance of the
current painted sky and cheap enough to bake at run start.

**Method:** render the same profile twice — existing Canvas2D sky, and the
WebGL2 sky shader at 1024×576 — read both back, compute ΔE (CIE76) over a 64×64
grid and compare luminance histograms. Time the full path
(compile → draw → `readPixels` → `ImageData` → canvas).

**Accept:** mean ΔE ≤ 2, p95 ΔE ≤ 4, bake ≤ 40 ms, plate ≤ 1 MB, second-run
bake ≤ 12 ms (compile cached).
**Reject:** if ΔE > 4 the GPU plate is not the same art; keep the Canvas2D sky
and use the GPU only for clouds (the architecture survives with a smaller
feature — `08` M2 reject path).
**Note:** this is the *only* place a per-frame `readPixels`-class operation is
allowed, and it is at bake time. R1 still holds.
**Cost:** 1 day.

---

## Prototype order and gates

| Order | Prototype | Gates | Cost of failure |
|---|---|---|---|
| 1 | **P4** second canvas | Mode B existence | fall back to scheduled plate regeneration |
| 2 | **P6** GPU plates | Mode A quality/loader | CPU-generated plates |
| 3 | **P1** half-res | mobile fill rate | full-res, fewer systems on mobile |
| 4 | **P3** LUT | grade pipeline | analytic grade |
| 5 | **P2** drift | shimmer | 2× plates |
| 6 | **P5** WebGPU | desktop ultra | WebGL2 only |

**Nothing in `src/` is modified by a prototype.** Each lives in `prototypes/pN-*/`
with a README stating hypothesis, method, numbers, verdict. Only after a verdict does
Milestone 1 (production) begin — so a failed prototype costs a day, not an
architecture.
