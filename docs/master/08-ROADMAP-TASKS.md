# 08 — ROADMAP & TASK DECOMPOSITION (Phase 12)
**Serves:** mandate phase order (plan → prototype → implement → validate) · Rule 10.

Seven milestones. Each has: exit gates from `11`, risks from `09`, and the files
it is allowed to touch. **No milestone may begin while the previous one's E1
gates are open.** Effort is `[J]` (judgement, not measurement) and assumes one
agent working in small verified steps.

```
M0.5 baseline truth ──▶ M1 data+poles ──▶ M2 GPU bake ──▶ M3 clouds
                                              │              │
                                              └──▶ M4 light ─┴──▶ M5 weather/grade ──▶ M6 mobile tiers
```

Critical path: **M0.5 → M1 → M2 → M3 → M6.** M4 and M5 can overlap M3 but not
precede M2.

---

## M0.5 — Baseline truth (no render changes)
*Why first:* R-01. Every gate in `11` is measured against the suite; a suite at
236/244 measures nothing. This milestone writes **zero** render code.

| Task | What | Files | Gate | Risk |
|---|---|---|---|---|
| `T0.5.1` | Reproduce each of the 8 failures individually and classify: stale assertion vs real behaviour bug | `tests/*` (read-only) | failure list matches D4 | R-01 |
| `T0.5.2` | Fix **behaviour** for each real bug | `src/game/combat/attacks.ts`, `src/game/anim/clips.ts`, others as classified | `npm test` | R-26 |
| `T0.5.3` | For any assertion that was genuinely wrong, record the reversal in `DECISIONS.md` **before** editing it | `DECISIONS.md`, `tests/*` | 244/244 | D4 |
| `T0.5.4` | Add `npm run gate` = `tsc --noEmit && vitest run` | `package.json` | G0+G1 in one command | — |

**Exit:** 244/244, `tsc` clean, one command. **Effort:** 0.5–1 day. **Effort risk:**
unknown until T0.5.1 — this is the only milestone whose size we cannot estimate,
because 4 of the 8 failures have never been read in source.

---

## M1 — Data, poles and measurement (still no pixels)
*Why:* profiles, budgets and the ledger are all pure logic. Pure logic is
testable, and testable logic is the only kind worth building first.

| Task | What | Files (new) | Est | Gate | Risk |
|---|---|---|---|---|---|
| `T1.1` | `EnvironmentProfile` schema + `pick(seed, history)` + deterministic jitter (`07` §2–§5) | `src/game/world/profile.ts` | 180 LOC | `M-AXES` 10k seeds, determinism | R-15 |
| `T1.2` | Canvas ledger: acquire/release/zero-on-release/LRU + caps (`12` §4) | `src/game/render/canvasLedger.ts` | 140 LOC | `M-LEDGER`, `M-CANVAS-COUNT` | R-04, R-16, R-18 |
| `T1.3` | Lint rule: only the ledger may create canvases; `src/gpu/**` may not import `entities` | `scripts/lint-boundaries.mjs` | 80 LOC | G1 | R-14 |
| `T1.4` | Quality ladder as a pure state machine: shed order, 4 s tick, 12 s raise guard, 30 fps floor | `src/game/render/quality.ts` | 120 LOC | unit test: one step per window, no oscillation | R-09 |
| `T1.5` | `scripts/bench-render.mjs`: blits by op, **overdraw multiple**, resident bytes, canvas count, bake ms, per-tier table, `exit 1` on breach | `scripts/bench-render.mjs` | 240 LOC | G2/G3/G4 table prints; `M-OVERDRAW ≤4.0×` at `low` | R-28, `17` §5 |
| `T1.6` | Move (not edit) the 37-canvas creation in `background.ts` onto the ledger | `src/game/world/background.ts` | ~60 LOC churn | blit counts unchanged vs golden table | R-13 |

**Exit:** G0, G1, G4; `bench-render` prints a table that matches `12` §8 for
`low` today (30.1 MB, 37 canvases, 11 blits). **Effort:** 2–3 days.
**Deliberate omission:** no shader, no plate, no visual change. If M1 changes
what the screen looks like, it is wrong.

---

## M2 — GPU bake pipeline (the "new technology", correctly scoped)
*Why:* this is where `D3`/`D7` actually happen — GPU shaders generate art at boot,
`readPixels` once, Canvas2D draws it forever.

| Task | What | Files (new) | Est | Gate | Risk |
|---|---|---|---|---|---|
| `T2.1` | `src/gpu/context.ts`: WebGL2 acquire, capability report, `webglcontextlost`/`restored`, `WEBGL_lose_context` test hook | `src/gpu/context.ts` | 160 LOC | context-loss test recovers ≤2 frames | R-06 |
| `T2.2` | `src/gpu/lut.ts`: 16³ LUT in 4096×16 strip, manual two-slice blend, dither 1 LSB | `src/gpu/lut.ts` | 180 LOC | `M-DELTA-E` computable, no banding comb | R-20 |
| `T2.3` | `src/gpu/plateGen.ts` + sky shader: gradient, star field, moon corona → framebuffer → `readPixels` → `ImageData` → canvas | `src/gpu/plateGen.ts`, `src/gpu/shaders/sky.frag` | 260 LOC | bake ≤40 ms for a full sky plate | R-11 |
| `T2.4` | Plate ladder + sizing: bake at the **draw size** of the current `atmoScale` step, never rescale (`12` §6) | `src/gpu/ladder.ts` | 90 LOC | `M-BLITS` unchanged, 0 uploads/frame | R-07 |
| `T2.5` | P8 gate: GPU sky plate vs the current Canvas2D sky — ΔE ≤2, bake ≤40 ms, ≤1 MB | `prototypes/p8-gpu-plate/` | — | P8 accept/reject | 10 P8 |

**Exit:** G3, G5 (sky), zero uploads per frame, `readPixels` count in the frame
log = 0. **Effort:** 3–4 days. **Reject path:** if P8 fails, the sky stays
Canvas2D and only clouds get GPU baking — the architecture survives with a
smaller feature.

---

## M3 — The three cloud systems
*Why:* the mandate's centrepiece and the user's actual complaint ("didn't make
anything procedural"). Coverage bands are the acceptance criteria, so each
system lands with its probe.

| Task | What | Files (new) | Est | Gate | Risk |
|---|---|---|---|---|---|
| `T3.1` | Cumulus: domain-warped fBm, 2 warp levels × 4 octaves (`06` §3 budget), smoothstep shaping, lit top / shadow base | `src/gpu/shaders/cumulus.frag` | 240 LOC | `M-COVERAGE` 22–38 % | R-19 |
| `T3.2` | Stratus: periodic horizontal bands, seam-locked | `src/gpu/shaders/stratus.frag` | 140 LOC | 55–80 %, seam probe | R-22 |
| `T3.3` | Cirrus: anisotropic stretch (≥4:1), low alpha, far parallax | `src/gpu/shaders/cirrus.frag` | 120 LOC | 12–25 %, `M-ELONG` | R-19 |
| `T3.4` | Two coverage variants (`tight`/`loose`) per type + `globalAlpha` cross-fade at run start | `src/game/world/clouds.ts` | 130 LOC | ±4 pp jitter visible, 0 re-bake in-run | R-16 |
| `T3.5` | Integer-offset drift; P2 shimmer test (flat-region temporal variance ≤1.5×) | `src/game/world/clouds.ts` | 80 LOC | P2, FID-25 | R-21 |
| `T3.6` | `scripts/probe-fidelity.mjs`: alpha mass, elongation, histogram, contrast over baked plates | `scripts/probe-fidelity.mjs` | 200 LOC | G5 all five metrics | R-28 |

**Exit:** G2, G5; three systems distinguishable pairwise by ≥25 % (FID-14) at
`medium`+; `low` shows cumulus only (07 §4). **Effort:** 4–5 days.

---

## M4 — Light, shadow, reactivity
*Why:* the user's standing requirement — lighting must respond to the player.
Reactivity is cheap (one nearest-practical query); the expensive part is getting
one light model to own every shadow.

| Task | What | Files | Est | Gate | Risk |
|---|---|---|---|---|---|
| `T4.1` | Single light model from the profile (`azimuth`, `elevation`), consumed by sky, rakes, rims, spills | `src/game/world/env.ts` | 150 LOC | `M-SHADOW-DIR` ≤12° | R-25 |
| `T4.2` | Baked shadow rakes per archetype + **shear-at-draw** for ±11° jitter (07 §11.3) | `src/game/render/bakers/shadow.ts` | 220 LOC | one rake resident, 0 extra canvas | R-25 |
| `T4.3` | Player-reactive rim/spill from the nearest practical (existing hooks in `props.ts`) | `src/game/render/rim.ts` | 110 LOC | `M-CONTRAST` ≥3:1 in every weather | R-23 |
| `T4.4` | Moon variants (4 phases × 2 sizes) + `moonCover` from weather, cross-faded | `src/game/render/bakers/moon.ts` | 160 LOC | moon 210–260 px @1080p, 0 extra blit/frame | R-19 |
| `T4.5` | Height-aware dynamic prop shadows (scale/alpha only) | `src/game/render/props-shadows.ts` | 90 LOC | ≤2 blits, no per-frame maths | — |

**Exit:** G5 (`M-CONTRAST`, `M-SHADOW-DIR`), G2. **Effort:** 2–3 days.

---

## M5 — Weather and grade
| Task | What | Files | Est | Gate | Risk |
|---|---|---|---|---|---|
| `T5.1` | Weather state machine (`07` §8): ≥8 s transitions, one change per ≥20 s, never during flash cooldown | `src/game/world/weather.ts` | 140 LOC | state graph unit test | — |
| `T5.2` | LUT cross-fade by tint blit; no plate re-bake on weather change | `src/game/world/grade.ts` | 120 LOC | 0 re-bakes during transition | R-11 |
| `T5.3` | Flash budget integration (existing `FlashLedger` authoritative) | `src/game/fx/*` (read, not edit) | 40 LOC | ≤3/s, ≤10 % ΔL | R-24 |
| `T5.4` | Reflection response to weather at ≤1 blit, very low CPU (standing requirement) | `src/game/world/background.ts` | 80 LOC | ≤1 blit | — |

**Exit:** G5 (`M-DELTA-E` ≥6, `M-HIST` ±8 %). **Effort:** 2 days.

---

## M6 — Mobile tiers, governor, validation
| Task | What | Files | Est | Gate | Risk |
|---|---|---|---|---|---|
| `T6.1` | Wire the `T1.4` ladder to `atmoScale` + plate ladder switching + Mode B3 (single canvas) | `src/game/render/quality.ts`, `game.ts` (1 line: keep `alpha:false`) | 160 LOC | simulated governor drives each tier | R-09 |
| `T6.2` | In-page bench (`?bench=1`): fixed-bucket histogram, time-weighted p50/p95/p99, jank ratio, p1, multiplicity calibration | `src/game/debug/bench.ts` | 220 LOC | prints the `11` §2.2 block | R-02 |
| `T6.3` | Device report on ≥2 phones + one desktop, 10-minute thermal run | none (report only) | — | `D-THERM` drift ≤15 % | R-08 |
| `T6.4` | Final: benchmark table, fidelity table, honest coverage statement (`11` §9) | `docs/master/`, `BENCHMARKS.md` | — | G6, G8 | R-28 |
| `T6.5` | Cadence lock: fixed 1/60 step + draw interpolation for camera/parallax/entities; even-vsync lock at 60-on-120 | `src/game/loop.ts` | 90 LOC | `M-EVEN` ≥95 %, `M-JUDDER` ≤8.3 | `18` §4 |
| `T6.6` | Sub-pixel audit: one rounding policy applied at final draw, all layers on the same grid | renderer draw calls | 60 LOC churn | `M-SUBPIXEL` (FID-33) | `18` §5 L2 |
| `T6.7` | Half-frame smear for FX/trails only (1 blit, α ≤0.25, reduced-motion off) | `src/game/fx/` | 80 LOC | FID-36, flash budget | `18` §5 L3 |
| `T6.8` | Cadence metrics + `M-CLAMP` detection in `?bench=1` | `src/game/debug/bench.ts` | 70 LOC | separates "we're slow" from "the browser clamped" | `18` §6 |
| `T6.9` | Opt-in 120 mode, capability-gated (median ≤9 ms, p95 ≤8.3, user setting) | `src/game/render/quality.ts` | 60 LOC | FID-35 | `18` §5 L4 |
| `T6.10` | **Deferred to M7:** worker-owned `OffscreenCanvas` frame clock (the only 120 path on Chrome Android) | new | 250 LOC | — | `18` §1, Rule 10 |

**Exit:** G6, a G7 report that says what it measured, and the user's eye on G8.
**Effort:** 3 days + device time we do not have yet.

---

## What is explicitly *not* in this roadmap

| Not doing | Why |
|---|---|
| Second canvas on mobile | `12` §5 — full-screen blend + 17 MB for a soft image |
| Per-frame noise in any shader | mandate + `06` §3 |
| WebGPU as a requirement | 14 % of sessions cannot run it; ultra-only opt-in |
| Touch controls / mobile layout | S2: mobile is performance, not playability |
| Second stage / new props / new enemies | D1, S1, Rule 10 |
| Rewriting the gameplay renderer | D3 |
| A new asset pipeline | REQ-706: asset-free is a feature |

---

## Sequencing rationale (why not any other order)

1. **Tests before everything** — otherwise we cannot tell our regressions from the
   pre-existing ones.
2. **Pure logic before pixels** — profiles, ledger and ladder are provable in
   node in milliseconds; discovering a ladder bug on a phone would cost days.
3. **Bake pipeline before clouds** — the clouds are three shaders; if the bake
   → readback → canvas path is wrong, we would find out three times.
4. **Light before weather** — weather changes what a fixed light *looks like*;
   building weather first means building it twice.
5. **Governor last** — it can only tune what exists, and it must be tuned against
   the real frame cost, not a guess.

## Total

**≈17–22 working days [J]**, of which M0.5 is the only unknown and M6's device
work is the only part that cannot be done in this sandbox.
