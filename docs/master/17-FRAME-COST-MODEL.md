# 17 — FRAME COST MODEL (Phase 8c: predict before measuring)
**Serves:** D2 · D8 · REQ-710 · `11` (metrics) · `14` (device classes).

We cannot measure a phone from this sandbox. What we *can* do is write the frame
budget as an equation, mark which terms are known, and derive the governor
thresholds and the DPR caps from it. That is what this document does — and it
also says exactly what would prove it wrong.

---

## 1. The equation (shipping path B3, single canvas)

```
T_frame = max( T_rAF ,  T_cpu + T_raster + T_present ) + T_sched
```
| Term | What it is | Status |
|---|---|---|
| `T_rAF` | vsync quantum (16.7 ms @60, 8.3 ms @120) | known |
| `T_cpu` | JS: input, gameplay, env uniforms, 14–18 `drawImage` calls' bookkeeping | **unknown on device**; node-stub figures exist but a stub ctx does no rasterisation **[M is not transferable]** |
| `T_raster` | pixels actually filled by Canvas2D = `Σ(w·h)` over every draw, i.e. `P = O · A` (overdraw × area) divided by fill rate `F` | model below |
| `T_present` | compositing the one opaque canvas into the frame | unknown, 0 extra layers in B3 (the thing Mode B would have added) |
| `T_sched` | browser scheduling noise / GC | bounded by REQ-704 (0 allocations) |
| `T_blend` | translucent-layer blend | **0** in B3 (`alpha:false`, D7) |

Mode B1 would add `T_blend` (0.3–1.5 ms per layer **[R]**) and ~17 MB of layer
memory. That is the entire reason D7 exists.

---

## 2. The raster term, which is the only one we can reason about

```
P   = O × A                      pixels touched per frame
T_raster = P / F                 F = device fill rate (Mpx/ms)
```

**Canvas area `A`** (physical px, after `dprCap`):

| Surface | CSS | dpr | `A` |
|---|---|---|---|
| desktop 1280×720 | 1280×720 | 1.0 | 0.92 Mpx |
| phone portrait | 390×844 | **1.5** (capped) | 0.74 Mpx |
| phone portrait | 390×844 | 2.0 (uncapped) | 1.32 Mpx |
| phone portrait | 390×844 | **3.0 (Apple default)** | **2.96 Mpx** |
| phone landscape | 844×390 | 3.0 | 2.96 Mpx |

`dprCap 1.5` on a portrait phone is **4× fewer pixels than dpr 3** — the single
largest lever available, which is why `12` §3 and `14` §2 spend the boot probe
picking it rather than picking effects.

**Overdraw `O`**, from the planned draw list (a full-screen sky plate is 1.0 by
definition):

| Layer | Coverage of screen | Contribution |
|---|---|---|
| sky plate | 1.00 | 1.00 |
| stratus | 0.6 × 0.72 | 0.43 |
| cumulus | 0.6 × 0.30 | 0.18 |
| cirrus | 0.6 × 0.18 | 0.11 |
| fog sheet | 0.60 | 0.60 |
| world (skyline + deck + props) | ~1.10 | 1.10 |
| entities + FX | ~0.20 | 0.20 |
| HUD | ~0.20 | 0.20 |
| **total** | | **≈ 3.8 → target ≤4.0 [T]** |

So a phone at capped dpr touches **≈2.8 Mpx/frame** (0.74 × 3.8). The budget is
therefore about **not letting `O` creep past 4** — every new full-screen sheet
costs ~0.6 of a screen, and three of them cost more than the entire game.

---

## 3. What that implies per device class

Fill rates are `[J]` placeholders spanning the plausible range for 2D canvas
rasterisation (not GPU peak specs — Canvas2D pays blend + upload + per-draw
overhead). They exist to be *replaced* by `P-fill` from `14` §3.

| Class | `F` (Mpx/ms) | `P` at dpr1.5 | `T_raster` | + `T_cpu` (4–8) | + `T_present` (1–3) | Verdict |
|---|---|---|---|---|---|---|
| C0 | 0.8–1.5 | 2.8 | 1.9–3.5 | 5.9–11.5 | 6.9–14.5 | fits 16.7 with ~2 ms slack — **no room for a second canvas** |
| C1 | 1.5–3.0 | 2.8 | 0.9–1.9 | 4.9–9.9 | 5.9–12.9 | comfortable |
| C2 | 3.0–6.0 | 2.8 | 0.5–0.9 | 4.5–8.9 | 5.5–11.9 | headroom for `ultra`-ish art |
| C3 | 10–30 | 0.92 at dpr2 =3.7 | 0.1–0.4 | 4.1–8.4 | 5.1–11.4 | `T_cpu` is the wall, not fill |

**Same arithmetic at dpr 3 unbounded:** `P` = 2.96 × 3.8 = 11.2 Mpx ⇒ C0
`T_raster` = **7.5–14 ms**, which alone eats the frame. Since Apple ships dpr 3
as the default, "we forgot to cap dpr" is indistinguishable from "the game is
slow" on exactly the devices we cannot test. `M-OVERDRAW` and `P-fill` exist to
catch this before a phone does.

**Consequence for `atmoScale`:** the atmosphere's raster contribution is
`0.6 × (1 - atmoScale²)` of a screen at most (§2 rows), i.e. tiny. Dropping
`atmoScale` from 1.0 to 0.5 saves ≈0.45 screens of fill — real, but **smaller
than capping dpr**. This is why the shed ladder (`12` §3) puts `atmoScale` first
*within* the atmosphere but treats `gameScale`/dpr as the bigger hammer when the
whole frame is over budget.

---

## 4. Governor thresholds, derived rather than invented

| Threshold | Value | Derivation |
|---|---|---|
| target frame | 16.7 ms | 60 Hz |
| `p95 ≤ 18 ms` | 16.7 + 1.3 slack | one dropped frame per 20 is the perceptual edge; 1.3 ms is measurement + scheduling noise **[J]** |
| `p99 ≤ 25 ms` | 1.5 × target | one 25 ms frame is a hitch you notice, 33 ms is a stutter |
| jank ratio ≤ 2 % | 1 in 50 frames | 10 s window at 60 Hz = 600 frames ⇒ 12 janky frames tolerated |
| raise guard 12 s | existing | re-raising faster than the thermal time constant guarantees oscillation (F2: capping raised defects 146 %) |
| 30 fps floor | ADPF min scalable FPS = 30 **[R]** | below that, drop to Canvas2D-only rather than show a slideshow |
| `atmoScale` floor 0.5 | below that, cumulus reads as blur, not cloud (`12` §11.2) | below 0.5 we drop a *system*, not detail |

The governor never reads GPU time; it reads `T_frame` percentiles, which include
every term above whether we understand them or not. **That is the trick that
makes the model disposable:** the thresholds are calibration, the metric is
ground truth.

---

## 5. Sensitivity: what actually moves `T_frame`

Ranked by how much a wrong guess costs us:

| Rank | Unknown | If we are wrong by 2× | Blast radius |
|---|---|---|---|
| 1 | `T_cpu` (JS + Canvas2D bookkeeping) | frame misses 60 fps at every tier | whole feature; mitigated by `?bench=1` histograms |
| 2 | `dprCap` behaviour on the actual device | 4× pixel change (§2) | tier choice, `14` §4 |
| 3 | overdraw `O` creeping with each new sheet | +0.6 screen per sheet | `M-OVERDRAW` assertion |
| 4 | `T_present` on iOS vs Android | 1–3 ms, ±50 % | small but constant |
| 5 | `F` (fill rate) | ±2× | only matters at C0 |
| 6 | bake time (§13.7) | one 6 ms spike per plate | bounded by one-plate-per-frame rule |

If only one measurement is ever taken on a real device, it should be **`T_cpu`
plus overdraw at `low`** — that pair decides whether this project is viable on
C0 hardware at all.

---

## 6. Falsification: what result would kill the plan

| Observation | Meaning | Response |
|---|---|---|
| C0 device, `low`, 2.8 Mpx, still `p95 > 25 ms` | `T_cpu`/`T_present` dominate; the Canvas2D pipeline itself is the wall | reduce overdraw and dpr further; **do not add features**; escalate to the user as a scope truth (0.9 fps class, `00`) |
| Cloud plates at 512×288 look like blur on C0 | `atmoScale` floor too low | bake 768×432 and cut a system instead (FID-14 trade) |
| `atmoScale` changes move `p95` by <0.5 ms | the atmosphere is not the cost | the governor's first rung is wrong; reorder the ladder using measure, not theory |
| `p95` is fine but `p99` spikes at plate bakes | scheduled bake hit gameplay | `REQ-703` guard is insufficient; move all bakes to run start |
| dpr cap 1.5 on a 3× phone looks soft to the user's eye | resolution vs crispness trade is real | raise `gameScale` for text/figure layers only — never the atmosphere |

---

## 7. Instrumentation this model requires (all cheap, all in the frame path)

| Counter | How | Cost |
|---|---|---|
| `M-OVERDRAW` | accumulate `w*h` in each `drawImage`/`fillRect` wrapper | 1 add per draw, 0 alloc |
| `M-BLITS` | count per composite op | 1 increment |
| `T_frame` histogram | fixed buckets, 7 buckets | 1 compare + 1 increment |
| bake wall time | `performance.now()` around `stepBake()` | 2 calls per plate |
| `T_cpu` | `performance.now()` at frame start/end (dev flag only) | 2 calls |

All five are already specified in `11` §2; this document just explains why each
one exists rather than trusting the model.

---

## 8. Open items

1. `F` values in §3 are placeholders with no citation, because no public source
   measures Canvas2D fill rate on mobile. `P-fill` replaces them in M6. Until
   then they are `[J]` and the *table* is a range, not a prediction.
2. `T_cpu` 4–8 ms comes from the mandate-era estimate in `06` §1, not from a
   device. It is the largest single risk in this document (§5 rank 1).
3. Overdraw 3.8 is arithmetic over a *planned* draw list; the real number will
   include FX and props we have not counted. M1's harness must print the real
   `O` at `low` before any atmosphere work lands.
