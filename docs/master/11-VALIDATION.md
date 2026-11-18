# 11 — VALIDATION & QUALITY GATES (Phase 16)
**Serves:** D5 (no screenshots — code inspection + gates; the user's eye is the
final "WoW" gate) · D6 (evidence discipline) · Rule 2 (measure everything).

This document exists because of an uncomfortable fact: **we cannot measure the
thing we most need to measure.** `12` §2 established that no GPU timer reaches a
phone. So validation is split into what *is* provable here, what is only provable
on a device, and what can never be automated.

---

## 1. Three measurement environments

| Env | Runs where | Can prove | Cannot prove |
|---|---|---|---|
| **E1 — Deterministic (node)** | this repo, CI | bake ms, blit counts, resident bytes, canvas count, coverage mass, ΔE, contrast ratios, parallax ratios, allocation counts | anything visual, anything GPU |
| **E2 — Device (browser)** | user's phone/desktop, manual | frame percentiles, jank ratio, thermal drift, compositor delta, context-loss recovery | visual "WoW" |
| **E3 — Human eye** | user | beauty, readability, "does it feel like a different run" | numbers |

A gate is only ever closed in the environment that can close it. **No E1 result
may be written as if it were E2.** That single rule prevents every "it's fast on
my machine" claim in this project's future.

Today: E1 exists (244 tests, `/tmp` harnesses), E2 does not exist (no device, no
GPU in the sandbox — discovery M1), E3 is the user.

---

## 2. Metric catalogue

### 2.1 Deterministic metrics (E1) — all computed in node, all cheap

| ID | Metric | How | Threshold | Doc |
|---|---|---|---|---|
| `M-BAKE-COLD` | cold bake ms | `performance.now()` around bake with stub ctx | ≤30 ms low/med, ≤40 ms high/ultra **[T]** | 06 §2, 12 §8 |
| `M-BAKE-WARM` | warm re-bake ms | re-run bake with same profile | ≤16 ms **[T]** (measured 9.6 ms **[M]**) | REQ-703 |
| `M-BLITS` | blits per frame, by composite op | instrumented stub ctx counter | 14/18/20/26 **[T]** | REQ-701 |
| `M-OVERDRAW` | pixels touched per frame = Σ(w·h) over every draw ÷ canvas area | instrumented draw wrapper, 0 alloc | **≤4.0× screen** | `17` §2 |
| `M-RESIDENT` | resident canvas bytes `w*h*4` | ledger, not "allocated" | ≤38 MB at 720p **[T]** | REQ-702 |
| `M-CANVAS-COUNT` | live canvases | ledger | ≤48 mobile / ≤64 desktop **[T]** | 12 §4 |
| `M-LEDGER` | released-but-not-zeroed | ledger assertion | **0** | 12 §4 |
| `M-COVERAGE` | cumulus / stratus / cirrus alpha mass | plate pixel scan at bake (one `getImageData` per plate, bake time only) | 22–38 / 55–80 / 12–25 % | FID-11/12/13 |
| `M-ELONG` | cirrus second-moment ratio | same scan | ≥4:1 | FID-13 |
| `M-DELTA-E` | consecutive-run grade distance | LUT math (CIE76 on 16³ grid) | ≥6, soft ≥10 **[T]** | FID-19 |
| `M-CONTRAST` | figure rim vs local bg | plate luminance sample at figure positions | ≥3:1 | FID-6 |
| `M-HIST` | 60/30/10 histogram mass | frame composite histogram | ±8 % | FID-20 |
| `M-PARALLAX` | near:far ratio | ladder assert | ≤12:1 | FID-22 |
| `M-ALLOC` | allocations in draw/update | `--expose-gc` + heap delta over 600 frames | **0** | REQ-704 |
| `M-AXES` | consecutive-run axes differing | 10k-seed simulation | never <4 | 07 §5 |
| `M-SHADOW-DIR` | shadow azimuth vs light azimuth | bake assert | ±12° | FID-9 |

### 2.2 Device metrics (E2) — can only run on a real GPU

| ID | Metric | Method | Threshold |
|---|---|---|---|
| `D-P50` | median frame interval | rAF timestamps, fixed-bucket histogram | ≤14 ms (60 fps) **[T]** |
| `D-P95` | 95th percentile | same | ≤18 ms |
| `D-P99` | 99th percentile | same | ≤25 ms |
| `D-JANK` | % frames >1.5× target, 10 s window | same | ≤2 % |
| `D-PACE` | p1 vs p50 spread | same | ≤8 ms (stability) |
| `D-ATMO` | marginal atmosphere ms | multiplicity calibration, `12` §2 | ≤3.0 high / ≤4.5 ultra **[T]** |
| `D-COMP` | compositor delta (Mode B1 only) | A/B: sky canvas shown vs `display:none`, 300-frame windows | ≤1.0 ms dpr1 / ≤1.5 dpr2 |
| `D-THERM` | p95 drift over 10 min | histogram buckets per minute | ≤15 % growth before shed |
| `D-CTX` | context-loss recovery | force via `WEBGL_lose_context` | recovers ≤2 frames, no visual error |
| `D-CADENCE` | `M-EVEN`, `M-JUDDER`, `M-CADENCE` | fixed-bucket interval histogram | ≥95 % within ±2 ms (FID-32) |
| `D-CLAMP` | is the platform clamping us at 60? | median 59.5–60.5 **and** frame time <12 ms | boolean, reported not failed |
| `D-SUBPIXEL` | screen-position delta per frame on a slow layer | draw-call instrumentation | never 0 for >6 frames (FID-33) |
| `D-DUP` | duplicated render states while moving | hash of joint angles per frame | 0 unless `stepRate > 0` (FID-37) |
| `D-JERK` | max \|Δ³θ\| per joint vs clip median | pose history ring buffer | ≤2× (FID-39) |
| `D-RIG` | rig draw ms + stroke calls | `performance.now()` around the figure draw | ≤1.2 ms / ≤4 strokes at 120 (FID-41) |
| `D-LATENCY` | input timestamp → first visible frame | stamp on input, read at draw | ≤16.7 ms added (FID-38) |
| `M-VELPROF` | mean/peak tangential speed of a strike | joint history ring buffer | 0.50–0.58 (FID-42) |
| `M-POWER` | slope of log(angular speed) vs log(curvature) | same buffer | 0.60–0.75 (FID-43) |
| `M-SECONDARY` | settle time, overshoot, ζ, penetration | chain solver instrumentation | ≤0.6 s / ≤15 % / ζ≥0.2 / 0 (FID-44) |
| `M-MICRO` / `M-DEAD` | idle joint RMS; frames with zero delta | pose diff | 0.4–2.5 px / 0 (FID-45) |

---

## 3. Frame-time methodology (so D-* numbers mean something)

Research-backed specifics, because this is where benchmarks usually lie:

1. **Percentiles, not averages.** Averages hide stutters: "a game can have a
   16 ms average frame time while 1 % of frames take 80 ms"
   (`https://bugnet.io/blog/how-to-track-frame-time-percentiles-in-production`).
2. **Fixed-bucket histogram, not a sample array.** Buckets `0-8, 8-12, 12-16,
   16-20, 20-33, 33-50, 50+` ms; constant memory, "nanoseconds per frame".
3. **Time-weighted percentiles.** Counting samples over-weights fast frames: a
   single 1-hour frame is one sample but the whole session's experience. Compute
   the percentile over *accumulated time*, not sample count
   (`https://www.yosoygames.com.ar/wp/2023/09/youre-calculating-framerate-percentiles-wrong/`).
4. **Discard the first 5 s** (shader compile, plate bake, JIT warmup) and report
   it separately as boot.
5. **Report p1 as well as p99** — the stability signal is p50 − p1
   (`https://github.com/decentraland/unity-renderer/issues/2460`).
6. **≥60 s samples, 3 repeats, median of the three.** Mobile thermals make the
   first run optimistic; `10`-minute runs are required for `D-THERM`.
7. **Same build, same seed, same tier.** A profile change is a benchmark change.

---

## 4. Gate ladder

Each gate names its environment. A milestone cannot close with an open E1 gate.
E2 gates produce a *report*, not a pass/fail, until a device exists.

| Gate | When | Environment | Pass condition | On failure |
|---|---|---|---|---|
| **G0** | continuous | E1 | `npm test` **244/244** | block commit (Rule 10) |
| **G1** | continuous | E1 | `tsc --noEmit` clean, import-boundary lint clean | block commit |
| **G2** | each render change | E1 | `M-BLITS` within tier row | block commit |
| **G3** | each bake change | E1 | `M-BAKE-COLD`/`WARM` within budget | block commit |
| **G4** | each profile change | E1 | `M-RESIDENT`, `M-CANVAS-COUNT`, `M-LEDGER` within caps | block commit |
| **G5** | each art change | E1 | `M-COVERAGE`, `M-ELONG`, `M-HIST`, `M-CONTRAST`, `M-DELTA-E` | block commit |
| **G6** | milestone end | E1 | `M-ALLOC` = 0 over 600 frames; governor raises/lowers exactly once per window | block milestone |
| **G7** | milestone end | E2 | `D-P50/P95/P99/JANK` report on ≥2 devices | milestone ships "unverified on device" |
| **G8** | final | E3 | user says "WoW" **and** can name the profile without being told | reopen art, not logic |

**G0 is the one that matters most.** The repo currently sits at **236/244**
(8 pre-existing failures, triaged in `DECISIONS.md` D4). Until M0.5 lands, every
gate above is being evaluated on a broken baseline — which is precisely how a
project ends up with pretty docs and a game that does not load.

---

## 5. Harness specs (to be written in M1, not now)

```
scripts/bench-render.mjs      M-BLITS, M-RESIDENT, M-CANVAS-COUNT, M-LEDGER,
                              M-BAKE-*, prints a table per tier; exits 1 on breach
scripts/bench-atmos.mjs       D-ATMO if the (rare) extension exists, else
                              prints "gpu_ms: n/a (no timer — see 12 §2)";
                              counts draw calls, texture bytes, upload bytes/frame
scripts/probe-fidelity.mjs    M-COVERAGE, M-ELONG, M-DELTA-E, M-HIST, M-CONTRAST,
                              M-PARALLAX — pure functions over baked plates
tests/profile.pick.test.ts    10k seeds: M-AXES histogram, archetype uniformity,
                              ΔE distribution, determinism (same seed ⇒ same env)
tests/canvas-ledger.test.ts   create/release 500 canvases; assert count cap,
                              zeroing, overflow throws, LRU eviction order
```

All of these run with the existing stub-context trick (`00` §"traps"):
`arcTo/arc/ellipse/setTransform/resetTransform/createPattern/gradients/getImageData`
must exist, and `drawImage` must *count* rather than draw.

---

## 6. Anti-self-deception rules

These exist because the honest failure mode of a planning-heavy project is
beautiful documentation of unmeasured claims.

1. **Name the metric.** "30.3 MB" is *resident canvas bytes at 1280×720*, never
   "memory". The 41.6 MB that turned out to be allocation-not-residency ([`00`])
   is the precedent.
2. **Tag every number** `[M] [E] [T] [R] [J]` (`12` legend). Untagged = deleted.
3. **A changed threshold is a decision, not an edit.** Any change to a gate value
   requires a `DECISIONS.md` entry with the measurement that forced it.
4. **Never weaken an assertion to make a test pass** (D4).
5. **Report the environment.** "9.6 ms" is useless without "stub ctx, 1280×720,
   node 20".
6. **One number, one script.** If two scripts print resident memory, one of them
   is wrong; delete it.
7. **The eye outranks the doc.** If the user says it does not look "WoW", G5
   passing does not matter.

---

## 7. The E3 rubric (what the user is actually judging)

Not automatable. Written down so the user can point at a line instead of saying
"meh":

1. Does the sky read as **depth** (4+ planes) or as a flat backdrop?
2. Is there **exactly one** hero per screen, and is the eye drawn to it?
3. Does the moon look **stylised and large**, or like a sticker?
4. Do the three cloud systems look like **three different weather systems**?
5. Does the light direction agree across sky, shadows and rim light?
6. Is the stickman **immediately readable** against every weather state?
7. Does run N+1 feel like **a different night**, not a filter?
8. Is the frame **calm** in the play band and rich outside it?
9. Does anything shimmer, crawl, or band under motion?
10. Would you screenshot it unprompted?

---

## 8. Validation cadence by milestone

| Milestone | Must close before proceeding |
|---|---|
| M0.5 | G0 (244/244), G1 |
| M1 | G1, G4 (ledger), `tests/profile.pick.test.ts`, `scripts/bench-render.mjs` |
| M2 | G3 (bake), G5 (first LUT + first GPU-baked plate), `M-UPLOAD` = 0/frame |
| M3 | G2, G5 (coverage bands for all 3 systems) |
| M4 | G5 (`M-CONTRAST`, `M-SHADOW-DIR`), G2 |
| M5 | G5 (`M-DELTA-E`, `M-HIST`), flash budget test |
| M6 | G6, G7 report, G8 |

## 9. Coverage statement (what "validated" will honestly mean)

At the end of M6, if no device has run the build, the project can claim:
*budgets are enforced in a deterministic harness; fidelity targets are measured
on the plates; the frame path is allocation-free and upload-free; the governor
is proven to react; nothing has been measured on a phone.* That sentence is the
deliverable — and it is stronger than a benchmark nobody can reproduce.
