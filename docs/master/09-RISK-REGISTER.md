# 09 — RISK REGISTER (Phase 13)
**Serves:** Rule 10 (never break the game) · D6 (evidence discipline).

Scoring: **L**ikelihood and **I**mpact are `1–5`; score = L×I. **≥12 = must have a
mitigation before the milestone that triggers it.** Every risk names the signal
that tells us it is happening (a signal nobody reads is not a mitigation) and the
document that owns the fix.

---

## 0. The five that can actually kill this

| # | Risk | Why it is top-5 |
|---|---|---|
| R-01 | 8 pre-existing test failures never fixed → no trustworthy baseline | every later gate is measured on sand | 
| R-04 | iOS canvas-memory cap silently blanks canvases | looks exactly like "the game is corrupted" |
| R-06 | The 244-test gameplay suite regresses as the render layer is split | Rule 10 violation, user-visible |
| R-11 | Re-bake hitch during combat | the one thing players *feel* immediately |
| R-15 | Profiles look like a filter, not a different night | S1's actual ask fails |

---

## 1. Device & platform

| ID | Risk | L | I | Score | Signal | Mitigation | Residual | Owner |
|---|---|---|---|---|---|---|---|---|
| R-01 | **8 failing tests** stay unfixed; "236/244" becomes normal | 4 | 5 | **20** | `npm test` output | M0.5 is first milestone; no render work before 244/244 | low | D4 |
| R-02 | No GPU timer on mobile → GPU budgets unverifiable | 5 | 3 | 15 | `gpu_ms: n/a` in every report | multiplicity calibration (`12` §2); else relative A/B budget | medium | 12 |
| R-03 | `EXT_disjoint_timer_query` behaviour differs per browser → harness crashes | 3 | 2 | 6 | exception in `bench-atmos` | feature-detect, never require; try/catch around every query | low | 12 |
| R-04 | **iOS total canvas memory cap** (224/384 MB observed) exceeded → canvases render **transparent** | 3 | 5 | **15** | 1×1 probe readback mismatch; ledger near cap | canvas ledger with 56 MB mobile cap, LRU eviction, zero-on-release (`12` §4) | medium | 12 |
| R-05 | Per-canvas area cap (16.7 M px pre-iOS-18) exceeded by a large plate | 2 | 4 | 8 | ledger rejects at acquire | per-canvas cap 8.4 M px; ladder never exceeds 1280×720 | low | 12 |
| R-06 | Context loss on mobile Chrome background reclaim → black sky, then crash | 4 | 3 | 12 | `webglcontextlost` count | `preventDefault` + rebuild from profile (pure function); Mode B3 needs no GL in frame path at all | low | 05, 12 |
| R-07 | Firefox `texImage2D` ~40 ms every call (no cache) → hitch if we upload per profile change | 2 | 4 | 8 | upload time in bench | uploads only at bake/run-start; never on a gameplay frame | low | 12 §6 |
| R-08 | Thermal throttling on a 10-minute session | 4 | 3 | 12 | p95 drift over minutes (`D-THERM`) | resolution-first shed ladder; 30 fps floor; pause when hidden | medium | 12 §7 |
| R-09 | Frame **pacing** worse than average (oscillating 40–56 fps) | 3 | 4 | 12 | `D-PACE` (p50 − p1) | one step per 4 s tick, raise guard 12 s; never loosen and tighten in the same window | medium | 11 §3 |
| R-10 | Variable-refresh displays (90/120 Hz) make 16.7 ms targets meaningless | 4 | 2 | 8 | rAF interval ≈8.3 ms | budgets expressed in ms, not frames; governor uses ratios of target | low | 11 |
| R-11 | **Bake/re-bake inside a gameplay frame** (9.6 ms warm, 21 ms cold) | 3 | 5 | **15** | `M-BAKE-WARM` in frame log; "Game loop stopped" in console | scheduled re-bake only when top band is clear and p95 has slack; default: only at run start | medium | 12 §5 |
| R-12 | WebGPU path drifts from WebGL2 semantics (ultra-only) | 2 | 2 | 4 | pixel-diff in P5 | WebGPU is opt-in ultra, never a requirement; ΔE ≤1 parity gate | low | 10 |

---

## 2. Architecture

| ID | Risk | L | I | Score | Signal | Mitigation | Residual | Owner |
|---|---|---|---|---|---|---|---|---|
| R-13 | Splitting `background.ts` (3,285 LOC) breaks drawing order subtly | 4 | 4 | 16 | visual diff by eye; blit counts change | move code before changing it; golden blit-count table per tier; no algorithmic edits in the same commit as a move | medium | 05, REQ-801 |
| R-14 | `src/gpu` boundary leaks (`entities` imported into renderer) | 3 | 2 | 6 | lint error | import-boundary lint, same style as existing rules | low | 05 §4 |
| R-15 | **Profile distinctness collapses** — runs feel like a filter | 3 | 5 | **15** | `M-AXES` < 4, ΔE < 6, user says "same" | 5-axis jitter, 6 archetypes, ΔE soft target 10, eye gate G8 | medium | 07 |
| R-16 | Plate memo grows unbounded (12 plates × profiles × jitter) | 4 | 3 | 12 | ledger count/bytes climbing between runs | 18-signature bound, ≤6 resident, LRU + zero-on-release | low | 07 §6 |
| R-17 | Second canvas (Mode B1) costs more than it gives | 3 | 3 | 9 | `D-COMP` > 1.5 ms | B3 is the default; B1 ships only if P4 passes on desktop | low | 12 §5 |
| R-18 | A new module owns a canvas without `dispose()` (V3 growth bug repeat) | 3 | 3 | 9 | ledger count rises per resize | ledger is the *only* allocation path; release is mandatory and asserted | low | REQ-804 |

---

## 3. Art & fidelity

| ID | Risk | L | I | Score | Signal | Mitigation | Residual | Owner |
|---|---|---|---|---|---|---|---|---|
| R-19 | Half-res atmosphere softens FID-11's ≥6 px edge gradient | 4 | 3 | 12 | `M-ELONG` / gradient probe at `atmoScale` 0.5 | bake-time edge softness independent of draw scale; `low` at 768×432 if the eye rejects | medium | 12 §11.2 |
| R-20 | 8-bit LUT banding in smooth skies | 3 | 3 | 9 | histogram comb in dark gradient | dither 1 LSB at bake, 16³ LUT + trilinear blend; never per-frame noise | low | 05 |
| R-21 | Texel crawl / shimmer on integer-offset drift | 4 | 2 | 8 | visible in P2 flat-region variance test | integer-texel offsets only, no sub-texel motion; P2 gate ≤1.5× baseline | low | 10 P2 |
| R-22 | Cloud drift seam at tile wrap | 3 | 3 | 9 | seam line at fixed x | periodic noise (period-locked fBm), seam probe at bake | low | 03/05 |
| R-23 | Fog archetypes (`ash`, `violet`) fail figure readability | 3 | 5 | **15** | `M-CONTRAST` < 3:1 in that weather | per-weather rim boost; archetype ships only if `low` passes | medium | 07 §11.2 |
| R-24 | Storm flashes exceed 3/s or 10 % ΔL | 3 | 4 | 12 | `FlashLedger` counters | existing flash ledger is authoritative; storm weights capped in profile | low | REQ-603 |
| R-25 | Shadows disagree with light direction after jitter | 3 | 3 | 9 | `M-SHADOW-DIR` > 12° | shear-at-draw (07 §11.3) keeps one baked rake | low | 07 |

---

## 4. Process & gameplay

| ID | Risk | L | I | Score | Signal | Mitigation | Residual | Owner |
|---|---|---|---|---|---|---|---|---|
| R-26 | **Gameplay regression** while touching the render layer | 3 | 5 | **15** | any of the 244 tests | G0 after every task; no gameplay file is edited by this project | low | Rule 10 |
| R-27 | Scope creep: second stage, touch controls, new props | 4 | 4 | 16 | a new `LevelId` in a diff | D1/D2 recorded; REQ-106 and REQ-606 stay BLOCKED until the user reverses them | low | DECISIONS |
| R-28 | Docs outrun reality (plans describe unbuilt systems) | 4 | 2 | 8 | claims tagged `[T]` read as facts | `[M]/[E]/[T]/[R]/[J]` tags mandatory; `11` §6 | medium | all |
| R-29 | The 0.9 fps paperdoll class of bug (pacing collapse from decoration) | 2 | 4 | 8 | `D-JANK` spike | decoration is outside the play band (FID-4) and drift is offset-only | low | 00 |
| R-30 | Node/Next dev-server issues hide real failures (200 ≠ healthy) | 3 | 3 | 9 | `Game loop stopped after an unexpected error` | grep the log, never trust status codes | low | 00 traps |

---

## 5. Accepted risks (documented, not mitigated)

| Risk | Why accepted |
|---|---|
| No real-device measurement before M6 | no device in the sandbox; E1 gates are meaningful on their own (`11` §9) |
| `ultra` may exceed 38 MB resident | REQ-702 was written for a Canvas2D-only world; Mode B1 memory is a desktop-only cost, pending P4 |
| Softness at `atmoScale` 0.5 | the alternative is dropping a cloud system, which fails FID-14 harder |
| Android-only thermal evidence | labelled **[B]**, treated as direction, not as our envelope |

---

## 6. Review cadence

* **Every commit:** R-01, R-26 (the two that must never be true).
* **Every milestone:** re-score the table; a risk whose score dropped because of
  a measurement is written down in `DECISIONS.md`, not silently removed.
* **Any new risk ≥12** blocks the milestone until a mitigation exists in a doc.
* Risks are *deleted* only when the thing they describe becomes impossible, not
  when it becomes unfashionable.
