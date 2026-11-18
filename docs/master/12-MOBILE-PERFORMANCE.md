# 12 — MOBILE PERFORMANCE REALITY (Phase 8b)
**Serves:** D2 (mobile = performance-only) · D3 (GPU atmosphere) · REQ-7xx.
**Written:** 2026-11-15, after six research passes + one code inspection that
contradicted an assumption in `05`/`06`. Nobody has run this on a phone. Every
number carries a tag.

| Tag | Meaning |
|---|---|
| **[M]** | measured in this repo (node, stub ctx) — see `00-DISCOVERY-REPORT.md` |
| **[R]** | published source, cited inline |
| **[J]** | engineering judgement — says so, no false authority |
| **[T]** | target/acceptance — provisional until validated |
| **[E]** | estimated by arithmetic from [M]/[R] |

Legend for confidence (used in `03`): **A** = controlled study · **B** = vendor
documentation/engine source · **C** = industry practice · **D** = convention.

---

## 0. Why this document exists

`06-PIPELINE-BUDGETS.md` assumed we could read GPU milliseconds with
`EXT_disjoint_timer_query_webgl2` and assumed a second canvas stacked under the
game canvas. Research killed the first. Code inspection killed the second:

```
src/game/game.ts:311
  this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })
```

The game canvas is **opaque**. Nothing drawn on a canvas *underneath* an opaque
canvas is ever visible. Mode B as sketched in `05` §3 cannot work without paying
a price that has to be named and measured — see §5.

Four corrections follow. They make the plan smaller, not bigger.

---

## 1. The four findings, and what each one costs us

| # | Finding | Source strength | Consequence |
|---|---|---|---|
| F1 | **There is no GPU timer on mobile.** `EXT_disjoint_timer_query_webgl2` reports 0.56 % Android, 0.15 % iOS, 0.12 % Safari, 0.07 % Firefox; Chrome stable disables it (timing-attack mitigation). | A/B — Web3D survey + Chromium issue | GPU ms in `06` are **models**, not measurements. Measurement must be frame-time based (`11`). |
| F2 | **Resolution is the dominant lever on mobile**, not effect count. Vendor case study: resolution scaling had "the most significant impact on GPU load and thermal output", shadows/textures only "minimal impact on overall thermal performance". | B — Android ADPF / Netmarble | Governor sheds **resolution first**, features second, never gameplay. |
| F3 | **iOS caps total canvas memory (224 MB / 384 MB observed) and per-canvas area (16.7 M px pre-iOS-18)**; exceeding it renders canvases **silently transparent** and released canvases are only reclaimed when resized to 0. | A/B — WebKit bug 195325 + iOS 18 change | We are one profile-churn bug away from "corrupted". Needs a **Canvas Ledger**. |
| F4 | **The first `texImage2D` from a large canvas cost 486.9 ms in Chrome and ~40 ms in Firefox**; repeats hit a cache at ~0.1 ms (Chrome) but not Firefox. | B — semi/signal measurement | Uploads happen at bake only, never in a frame. Reinforces Mode A. |

Every one of these pushes the same direction: **fewer live GPU resources, more
precomputation, more measurement discipline.** That is the mobile-only thesis.

---

## 2. F1 — Measuring a GPU you cannot time

### Evidence
`https://web3dsurvey.com/webgl2/extensions/EXT_disjoint_timer_query_webgl2`
→ overall 66.55 % of reports, but by platform: Android **0.56 %**, iOS
**0.15 %**, Chromium OS 99.09 %. By browser: Firefox **0.07 %**, Safari
**0.12 %**. Corroborated by practitioners: "EXT_disjoint_timer_query_webgl2 is
disabled in Chrome stable and unavailable in Firefox" — so their own benchmarks
fall back to wall-time bracketing
(`https://www.sitepoint.com/webgpu-vs-webgl-inference-benchmarks/`), and a
2026 engine research issue states it "works in desktop Chrome/Edge (about 81 % of
Windows), almost never on Android, iOS, Safari or Firefox"
(`https://github.com/EthanMeli/WiiWii/issues/577`).

So a budget gate of the form "GPU ≤ 3.0 ms" is **unverifiable on the device it
targets**. Writing it as if verified would be exactly the dishonesty Rule 2
forbids.

### Policy M1 — measurement without a timer
1. **Never gate on a GPU timer.** `scripts/bench-atmos.mjs` feature-detects it,
   uses it only as a desktop diagnostic, and prints `gpu_ms: n/a` otherwise.
2. **Primary metric = frame interval distribution** (p50/p95/p99, dropped-frame
   ratio), because that is what the player feels. Detail in `11-VALIDATION.md`.
3. **Secondary metric = marginal-cost calibration** (below), which lets us
   attribute time to the atmosphere pass *without* a GPU timer.
4. **Any GPU ms in any doc is printed with `[E]` and its arithmetic.** If a
   number cannot be traced to a measurement or an equation, it is deleted.

### Policy M1.1 — the multiplicity calibration (novel technique, [J] until proven)
`requestAnimationFrame` quantises everything to the vsync interval, so a pass
that costs 1.2 ms is invisible inside a 16.7 ms frame. The fix is to make the
pass dominate the interval on purpose:

```
calibrate():
  for k in [1, 2, 4, 8]:
     for 30 frames: render atmosphere k times into the same target
     record frame intervals
  T(k) = p50 interval for k
  fit  T(k) = fixed + k * marginal            (least squares)
  marginal  ≈ cost of one atmosphere pass
  fixed     ≈ CPU + presentation + vsync floor
```

`marginal` escapes the vsync floor because k=4 and k=8 exceed 16.7 ms on any
phone that is actually struggling, and on a fast phone the fit still separates
the slope from the intercept. Two caveats, both real: overdraw inside one frame
may be cached/reordered by the driver (bias low), and the calibration itself
must run in a pause screen, never during play. **Prototype P4 measures whether
the fit is stable; if it is not, we fall back to A/B toggling (k=0 vs k=1) over
300-frame windows and report a range, not a number.**

This is the only defensible way to hold a "≤ 3.0 ms" budget on a device with no
timer. If it does not hold up, the budget becomes a *relative* one (atmosphere
must add < 8 % to p95 frame time — measurable with toggling alone).

---

## 3. F2 — Resolution first, features last

### Evidence
Android's Adaptive Performance case study (Netmarble, *Game of Thrones:
Kingsroad*): "resolution scaling had the most significant impact on GPU load and
thermal output, without severely impacting frame rates… other graphics options
(shadows, textures, etc.) had a comparatively minimal impact on overall thermal
performance." With dynamic resolution + adaptive frame rate: thermal headroom
1.04 → 0.92, frame rate fluctuation **40–56 fps → stable 50–60 fps**, minimum
scalable FPS set to 30
(`https://developer.android.com/stories/games/netmarble-got-adpf`).

The same group of papers shows why our *pacing* matters as much as our average:
frequency-capping in thermal throttling "can increase dropped frames by up to
**146 %** in interactive applications", and task-utilisation scaling beat it by
up to 18 % fewer janks at equal average frame rate
(`https://eprints.soton.ac.uk/439709/1/tus_accepted_paper.pdf`). Translation:
**a stable 45 fps beats an oscillating 40–56 fps**, and average fps is the wrong
target metric.

DPR practice corroborates: `setPixelRatio(min(dpr, 2))` is described as "the most
common reason a configurator goes from slideshow to smooth on mobile", and a
PlayCanvas thread recommends banding by resolution class (≤1136×640 → 1.0,
mid → 1.5, large → 2.0) rather than one global value — because applying DPR
uncapped "absolutely decimates iOS performance" **[C]**.

### Policy M2 — the shed ladder
Two independent scales. The game canvas must stay crisp (text, figures); the
atmosphere is a soft image and can be much cheaper.

| Scale | Range | Applies to | Floor |
|---|---|---|---|
| `dprCap` | mobile **1.5** / desktop 2.0 | game canvas backing store | 1.0 |
| `gameScale` | {1.0, 0.85, 0.75} × dprCap | game canvas | 0.75 × dprCap |
| `atmoScale` | {1.0, 0.8, 0.66, 0.5} | sky/cloud plate ladder | 0.5 |

**Shed order (mobile), evaluated at the existing 4 Hz governor tick:**

```
0. jankRatio(10s) > 2 %  or  p95(60s) > 18 ms
1. atmoScale   step down        (cheapest visual loss, biggest GPU win)
2. octave/LOD step down         (Mode B only)
3. drop 2nd cirrus deck         (high/ultra only)
4. drop fog quad                (weather-gated)
5. gameScale   step down
6. tier step down               (last resort)
7. pause atmosphere entirely    (p95 > 40 ms: hardware cannot do it)
Raise guard: only when p95 < 13 ms for 12 s, one step per 12 s (existing rule).
```

Nothing in this ladder touches entities, combat, camera, assets or hit
detection. REQ-705 ("art-preserving") is satisfied because every step keeps the
same profile, hero, light direction and cloud mix — only sampling density and
pixel count change **[J]**.

**Explicitly rejected:** lowering frame rate as a *quality* option (30 fps
"cinematic"). It is only ever a last-resort floor. Assassin's Creed Unity's 0.9
fps paperdoll incident (already in `00`) is the cautionary case for pacing.

---

## 4. F3 — The iOS canvas ceiling, and why "corrupted" is a real failure mode

### Evidence
* Per-canvas area limit **16,777,216 px** (4096²) held for ~10 years; iOS 18.0
  raised it to 67,108,864 px (8192²). Above the limit, canvases do not throw —
  they render blank and further drawing is ignored
  (`https://lionpuro.com/posts/canvas-is-finally-usable-on-safari/`,
  `https://pqina.nl/blog/canvas-area-exceeds-the-maximum-limit/`).
* **Total canvas memory cap** is separate and much smaller: observed messages at
  **384 MB** and **224 MB**, with an iPhone SE in one report "just over 200 MB".
  Once exceeded, Safari renders canvases **transparent** rather than failing
  loudly (`https://bugs.webkit.org/show_bug.cgi?id=195325`). That is a silent
  visual corruption, not an exception.
* Released canvases are **not** reclaimed on drop; the documented workaround is
  `canvas.width = 0; canvas.height = 0`
  (`https://github.com/konvajs/konva/issues/653`).

Our exposure, from `00-DISCOVERY-REPORT.md`: **37 canvases, 30.1 MB resident
[M]**. Mode A adds cloud plates; profiles are memoised (REQ-308 says 12 plates
max). 37 + 12 = 49 canvases. At 1024×576 RGBA that is 2.36 MB per plate → +28 MB
→ **58 MB, 26 % of the smallest reported cap**, with no accounting and no cap.

### Policy M3 — the Canvas Ledger
One module owns every canvas in the game. Nothing else may call
`document.createElement('canvas')` (lint rule, same enforcement style as the
`src/gpu` boundary in `05` §4).

```ts
// render/canvasLedger.ts  (API sketch — not implemented)
export type LedgerSlot = 'game' | 'sky' | 'plate' | 'cloud' | 'gl' | 'scratch'
export interface LedgerEntry { slot: LedgerSlot; w: number; h: number; bytes: number }

ledger.acquire(slot, w, h): HTMLCanvasElement   // throws LedgerOverflowError
ledger.release(entry): void                     // sets w = h = 0  (WebKit reclaim)
ledger.stats(): { count, bytes, bySlot }        // printed by bench-render.mjs
```

**Hard caps (mobile-first, both [T]):**

| Cap | Mobile | Desktop |
|---|---|---|
| Live canvas count | **≤ 48** | ≤ 64 |
| Live canvas bytes (`w*h*4`) | **≤ 56 MB** (25 % of the 224 MB report) | ≤ 96 MB |
| Per-canvas area | ≤ 8.4 M px (half of the 16.7 M pre-iOS-18 limit) | ≤ 8.4 M px |
| Released canvases not zeroed | **0** | 0 |

**Profile memo policy (revises REQ-308 from "12 plates max" to bounded residency):**
* Plate key = `profileId × cloudType × ladderStep`; ladder steps are
  `{512×288, 768×432, 1024×576, 1280×720}`.
* **Resident ceiling: 6 cloud plates** (3 types × 2 ladder steps), LRU eviction
  with immediate `w=0;h=0`. Cold re-bake is 20.4–25.7 ms **[M]** and only ever
  happens at a run boundary behind the existing run-start work; warm re-bake is
  9.6 ms **[M]**.
* Consequence: profile distinctness must survive re-bake, which it does because
  plates are a pure function of the profile (that is the whole design).

**Failure detection, because silent transparency is the worst outcome:**
a 1-pixel probe drawn+read from a scratch canvas at boot and after every
profile change; if the readback does not match, the ledger has been silently
truncated → drop `atmoScale` one step, log `LEDGER_SUSPECT`, and stay on Mode A.
Cost: one 1×1 canvas, one `getImageData` at a run boundary (not in a frame).

---

## 5. F4 — The second canvas is not free, and our game canvas is opaque

### Evidence
* Each extra compositor layer ≈ **0.3–1.5 ms**, and "a full-screen transparent
  overlay is the worst case because it forces the compositor to blend every
  pixel" **[B]**
  (`https://digitalstrategyforce.com/journal/what-are-gpu-performance-budgets-and-how-do-you-optimize-render-pipelines/`).
* Canvas layers cost GPU memory: 0 → 1 layer, 11.9 MB → 28.9 MB at 1600×900
  **[B]** (`https://developer.ibm.com/tutorials/wa-canvashtml5layering/`).
* `alpha: false` lets the compositor skip blending; `desynchronized: true`
  bypasses the compositor queue for ~1 frame of latency —
  **but a translucent desynchronized canvas "must not have any other DOM
  elements above it"** **[B]** (`https://developer.chrome.com/blog/desynchronized`).
* Blitting *out* of a WebGL canvas costs a readback + upload: "right for a
  screenshot or a filter, not for a per-frame composite" **[B]**
  (`https://github.com/minigame-labs/migo-runtime/pull/396`).

### The conflict, stated plainly
`game.ts:311` already asks for `{ alpha: false, desynchronized: true }`. For a
sky canvas to be visible beneath the game canvas, the game canvas must become
`alpha: true`. That converts today's zero-blend opaque present into a
**full-screen per-pixel blend of a translucent top layer** — the single worst
compositor pattern in the literature — and it also rules out the sky canvas
being desynchronized (it has a DOM element above it).

| Option | Game canvas | Cost | Verdict |
|---|---|---|---|
| Today | `alpha:false` + desync | 0 compositor blend | keep for everything possible |
| B1 second canvas beneath | `alpha:true` (lose desync on sky layer) | full-screen blend + ~17 MB layer | desktop-only candidate, **P4 gate** |
| B2 gl→`drawImage` into game canvas | `alpha:false` kept | readback + upload **per frame** | **rejected** (F4 + R1) |
| B3 single canvas, GPU out of frame path | `alpha:false` kept | 0 | **chosen default** |

### Decision D7 (recorded in `DECISIONS.md`)
**B3 is the default and the only mobile path: "GPU as generator, zero per-frame
GPU".** Shaders run at bake time, `readPixels` once into a canvas, and the frame
loop is exactly today's single-canvas Canvas2D path. No second canvas on any
device unless P4 proves B1 pays for itself on desktop `high`/`ultra`.

Why B3 is not a retreat from D3: the *new technology* is the shader-authored
plate pipeline (fBm/domain-warp/SDF evaluated on the GPU, graded by a 3D LUT,
read back once). That pipeline does not exist in this repo today, produces art
Canvas2D cannot draw at the cost we need, and costs **0 ms per frame**. It is
also the only version of the feature that survives F1 (unmeasurable GPU time),
F2 (resolution-bound thermal), F3 (canvas caps) and F4 (compositor cost) at once.

What we lose: continuous morphing. What we keep and how we fake it:

| Live feature | B3 implementation | Cost |
|---|---|---|
| Cloud drift | integer-offset `drawImage` of the plate (existing technique) | 3 blits |
| Weather transition | cross-fade 2 plates over ≥8 s (REQ-105) | +1 blit, `globalAlpha` |
| Slow evolution | **scheduled re-bake during a lull** (no entities near frame top, ≤16 ms budget) — measured warm re-bake 9.6 ms **[M]** | ≤1 frame in ~10 s |
| Moon occlusion | per-plate `moonCover` variants, cross-faded | +1 blit |
| Light shafts | baked into the plate, drift with it | 0 |
| Grade change | LUT re-applied at bake; runtime tint blit only | 0–1 blit |

So the sky can visibly change on every run **and** evolve during a run, without
a live GPU pass. That is the mobile-optimised answer to "procedural and
distinctive" — and it is the one the evidence supports.

---

## 6. Upload and blit geometry policy

### Evidence
* `texImage2D` from a large canvas: **486.9 ms** on first call in Chrome
  (GPU-bound upload), ~0.1 ms cached afterwards; Firefox ~**40 ms** every time
  (`https://semisignal.com/a-look-at-2d-vs-webgl-canvas-performance/`).
* `drawImage` cost scales with pixels involved: 3000²→3000² = **64 ops/s**,
  3000²→900² = **56 ops/s**, 3000²→300² = **889 ops/s**; "the lower the total
  number of pixels involved (source plus destination), the more performant";
  downscaling was only cheap at the smallest destination
  (`https://www.middle-engine.com/blog/posts/2020/08/23/a-performance-testing-gotcha-with-the-canvas-web-api`).
* `willReadFrequently: true` "will force the 2D canvas to use software
  rendering" (**[B]**, gamedev.stackexchange 210596) — permanently banned from
  the frame path, now with a citation instead of a rule.

### Policies
* **M6.1** All texture uploads and all `readPixels` happen at bake/run-start.
  Frame path: no `texImage2D`, no `getImageData`, no `toDataURL`, no
  `willReadFrequently`, no `preserveDrawingBuffer`.
* **M6.2** Plates are baked **at the pixels they will be drawn at** for the
  current `atmoScale` ladder step — re-bake, never rescale. Draw is 1:1 with
  integer offsets. If a non-integer scale is unavoidable, ≤1.25×.
* **M6.3** Prefer `drawImage(canvas, …)` at 1:1; `ImageBitmap` showed no
  reliable win in cross-browser microbenchmarks (canvas 3.87 M ops/s vs
  ImageBitmap 3.89 M ops/s, and `bitmaprenderer.transferFromImageBitmap` was
  **4.9× slower** on `HTMLCanvasElement`: 787 k vs 3.87 M ops/s — measurethat.net
  #11302 **[C]**). So: plain `drawImage` of canvases; `ImageBitmap` only where a
  worker crosses a thread boundary, never per frame.

---

## 7. Thermal & pacing policy

| Rule | Value | Why |
|---|---|---|
| Target frame time | 16.7 ms, stable | F2: stable beats fast-but-oscillating |
| p95 budget | ≤ 18 ms | published game target for 60 fps **[C]** |
| p99 budget | ≤ 25 ms | published game target for 60 fps **[C]** |
| Jank trigger | >2 % of frames >1.5× target over 10 s | F2 (dropped-frame ratio is the thermal signal we can actually see) |
| Floor | 30 fps, never below | ADPF min scalable FPS = 30 **[B]** |
| Sampling window | 60 s p95, 10 s jank ratio | long enough to survive GC and prop spawns |
| Throttle response | shed ladder (§3), max one step per 4 s tick, raise guard 12 s | existing governor cadence **[M]** |
| Background tab | cancel RAF, release GL context, zero probe pixels kept | mobile Chrome reclaims GPU memory on background **[B]** |
| Idle/pause | atmosphere stops entirely | no reason to pay for a paused game |

Thermal caveat we must not overclaim: the ADPF/Nemarble and TUS results are
**Android-specific** and from vendor case studies, not from our devices. We treat
them as design direction (**B**), not as our measured thermal envelope.

---

## 8. Revised mobile budget (supersedes `06` §2 rows for mobile)

| Item | low (phone) | medium (phone) | high (tablet/desktop) | ultra (desktop) |
|---|---|---|---|---|
| Frame path | single canvas, Canvas2D | single canvas, Canvas2D | single or B1 | B1 if P4 passes |
| Per-frame GPU passes | **0** | **0** | 0–1 | 0–1 |
| Compositor layers added | **0** | **0** | 0–1 | 0–1 |
| Compositor ms | 0 | 0 | ≤1.0 [E] | ≤1.5 [E] |
| `atmoScale` ceiling | 0.5 | 0.66 | 1.0 | 1.0 |
| `dprCap` | 1.5 | 1.5 | 1.5 | 2.0 |
| Canvas2D blits | ≤14 | ≤18 | ≤20 | ≤26 |
| Cloud plates resident | 3 (512×288) | 6 (768×432) | 6 (1024×576) | 6 (1280×720) |
| Canvas bytes added | ≤3.5 MB | ≤8 MB | ≤14 MB | ≤24 MB |
| Live canvases | ≤44 | ≤48 | ≤48 | ≤56 |
| Uploads/frame | 0 | 0 | 0 | 0 |
| GL texture bytes | 0 | 0 | ≤1 MB (LUT) | ≤2 MB |
| Bake (cold) | ≤30 ms | ≤30 ms | ≤40 ms | ≤40 ms |
| Warm re-bake | ≤16 ms | ≤16 ms | ≤16 ms | ≤16 ms |
| Boot compile hitch | 0 | 0 | 0 | 0 |
| p95 / p99 target | 18 / 25 ms | 18 / 25 ms | 18 / 25 ms | 12 / 20 ms |

Resident total on a phone, Mode B3 `low`: 30.1 MB (today **[M]**) + 3.5 MB plates
+ 96 KB LUT ≈ **33.7 MB** — under REQ-702's 38 MB for the first time since I set
it. Mode B1 on desktop `ultra` remains ≈47 MB and stays an open item.

---

## 9. Budget arithmetic for the ledger (so §4 caps are not arbitrary)

At `low`, 1280×720 viewport, `atmoScale` 0.5 → sky region 1280×432 CSS px,
plate ladder step 512×288 (nearest ≥):

```
cloud plates   3 types × 1 step × 512×288×4 B      = 1.77 MB
LUT strip      2 × (16³ texels × 4 B) in 4096×16   = 0.13 MB
existing       37 canvases [M]                     = 30.1 MB
scratch/probe  1 × 1×1                             = 4 B
                                          total     ≈ 32.0 MB
```
At `ultra` desktop, `atmoScale` 1.0, ladder 1280×720:
```
cloud plates   3 types × 2 steps (1024×576 + 1280×720) = 22.1 MB
+ existing 30.1 MB + LUT 0.13 MB                        ≈ 52.3 MB
```
52.3 MB is **23 % of the 224 MB worst-case iOS cap** and 13.6 % of 384 MB. Both
inside the 56 MB mobile / 96 MB desktop caps of §4. Safari's canvas
memory is not a browser-quirk footnote any more; it is a line in the budget.

---

## 10. What this document changes elsewhere

| Doc | Change |
|---|---|
| `05-ARCHITECTURE.md` | Mode B demoted to desktop-only, gated by P4; add `canvasLedger` and `quality ladder` components; `src/gpu` becomes bake-time-only in the default path |
| `06-PIPELINE-BUDGETS.md` | §2 mobile rows superseded by §8; §5 "GPU ms where the extension exists" replaced by §2 calibration policy |
| `10-PROTOTYPES.md` | P4 becomes a **desktop** gate; add **P7** ledger stress and **P8** GPU→readback plate bake |
| `01-REQUIREMENTS-SPEC.md` | new REQ-708…712 (ledger, no-GPU-timer measurement, resolution-first ladder, upload-free frames, silent-transparency probe) |
| `DECISIONS.md` | **D7** — B3 single-canvas default; second canvas is a desktop experiment |

## 11. Open items (honest)

1. **Multiplicity calibration (§2) is unproven.** If the fit is noisy, GPU budget
   becomes relative-only. Resolved by P4, not by argument.
2. **`atmoScale` 0.5 + 512×288 plates may look soft on a 3× phone.** FID-11's
   "edge gradient ≥6 px at 1080p" cannot hold at 0.5 scale; the fidelity target
   must become scale-relative or `low` must bake at 768×432. Decide with the user
   eye (D5).
3. **Scheduled re-bake (§5) risks a 9.6 ms frame hitch** during play. It must
   only run when the top of the screen is clear of entities **and** the p95
   window has slack; otherwise defer to the next run.
4. **iOS 18 raised per-canvas area to 8192²**, so the ledger's per-canvas cap is
   conservative on purpose. Keep it.
5. **We still have no real device.** Every mobile conclusion here is [E]/[T].
   The first phone that runs M2 must produce a percentile report (`11` §4)
   before any of these numbers are called "measured".
