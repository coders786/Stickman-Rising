# MASTER PROJECT — ENGINEERING PACKAGE
**Research-driven, mobile-first, level-aware 2D/2.5D graphics overhaul.**
Planning-first per the operating procedure: discovery → requirements → research →
architecture → roadmap → risk → prototype → implement → validate.

Baseline commit for all numbers in this package: `5b874fc`.

---

## Package map (what exists, what is next)

| # | Document | Phase | Status |
|---|---|---|---|
| 00 | `00-DISCOVERY-REPORT.md` | 1 | **DELIVERED** — audit, measured baseline, 8 constraints |
| 01 | `01-REQUIREMENTS-SPEC.md` | 2 | **DELIVERED** — REQ-101…REQ-806, traceability, re-spec of unsatisfiable asks |
| — | `DECISIONS.md` | — | **DELIVERED** — D1 profiles / D2 perf-mobile / D3 new technology / D4 fix tests |
| 02 | `02-TECH-SELECTION.md` | 5–6 | **DELIVERED** — 5 candidates compared; **hybrid Canvas2D game + WebGL2 atmosphere (WebGPU ultra)** selected, with boundaries + migration |
| 03 | `03-PSYCHOLOGY-ART-DIRECTION.md` | 3–4 | **DELIVERED** — 11 evidence-graded laws (awe/vastness, Purkinje, fluency, Berlyne, peak shift, salience, Gestalt, colour, comfort, reward cadence, identity) → parameter table → probes |
| 04 | `04-FIDELITY-TARGETS.md` | 3–4 | **DELIVERED** — 25 machine-checkable "WoW"/full-fidelity targets + 6 perf targets |
| 05 | `05-ARCHITECTURE.md` | 6–7 | **DELIVERED** — two-mode design (GPU-as-generator / GPU-as-renderer), components, import boundary, 64-byte uniforms, 7 programs, LUT, fail-closed rules, directory plan |
| 06 | `06-PIPELINE-BUDGETS.md` | 8 | **DELIVERED** — per-tier CPU/GPU/blit/memory budgets, fill-rate arithmetic, enforcement scripts |
| 07 | `07-PROFILES-MATRIX.md` | 9–10 | next — 4+ environment profiles × 4 tiers feature matrix |
| 08 | `08-ROADMAP-TASKS.md` | 11–12 | next — M0.5 test fixes → M1…M6, task IDs, dependency graph, file plan |
| 09 | `09-RISK-REGISTER.md` | 13 | next — incl. GPU context loss, shader hitch, overdraw, two-canvas compositor |
| 10 | `10-PROTOTYPES.md` | 14 | **DELIVERED** — P1–P6 with numeric accept/reject, ordered by risk; #1 is the second-canvas compositor cost |
| 11 | `11-VALIDATION.md` | 15, 21–24 | next — gates, benches, device matrix |

Existing research that this package builds on (kept, not duplicated):
`docs/LIGHTING-RESEARCH-V4.md`, `docs/LIGHT-SHADOW-V4-PLAN.md`,
`docs/LIGHT-SHADOW-V3.md`, `docs/NEUROAESTHETIC-UPGRADE.md`,
`docs/PREBAKED-WORLD-PLAN.md`, `docs/RENDER-ROADMAP-V5-PLUS.md`, `docs/PLAN-INDEX.md`.

---

## Decisions (answered — see `DECISIONS.md`)

| ID | Answer | Headline consequence |
|---|---|---|
| **D1** | **Profiles only**, full-fidelity, psychology-heavy | One stage; distinctiveness via profile axes; "full fidelity" defined as 25 measurable targets (`04-FIDELITY-TARGETS.md`) |
| **D2** | **Performance-only mobile** | No touch controls; mobile = budgets/tiers/thermals. Game is not touch-playable — stated honestly |
| **D3** | **New and distinct technology** | Canvas2D-only revoked → **hybrid: Canvas2D game + WebGL2 procedural atmosphere (WebGPU at ultra)**, hard no-readback boundary, Canvas2D sky kept as fallback (`02-TECH-SELECTION.md`) |
| **D4** | **Fix the 8 failing tests** | Milestone **M0.5** before any GPU work; green 244/244 baseline required |

## Execution order (what happens next)
1. **M0.5** — fix the 8 combat/anim test failures (triage already in `DECISIONS.md` §D4).
2. **M1** — profile system (`world/profile.ts`), quality manager, committed harness
   (`scripts/bench-render.mjs`), FlashLedger, `src/gpu` skeleton that fails closed.
3. **M2** — GPU sky behind a flag (gradient + stars), pixel-free verification.
4. **M3** — cumulus → stratus → cirrus.
5. **M4** — fog/shafts/grade. **M5** — WebGPU ultra. **M6** — governor + thermal.

---

## Operating rules adopted (from the mandate, enforced in this package)

1. Plan before coding; no feature without a requirement ID.
2. Challenge the plan: every subsystem must answer "is this needed / is there a
   cheaper way / is it mobile-friendly".
3. Prototype high-risk techniques before committing (reflection readback is #1).
4. Milestone-based, one coherent subsystem at a time.
5. Living docs — statuses and decisions updated as work lands.
6. Measure, never claim: all numbers come from `scripts/bench-*`.
7. **Never sacrifice the game**: combat/anim/physics determinism, camera feel and
   saved settings are protected (discovery §8).

---

## Evidence discipline (how to read claims in this package)

* **[M]** measured — command + scope stated (e.g. "30.3 MB resident, stub ctx").
* **[E]** estimated — arithmetic from measurements, labelled provisional.
* **[A]** assumption — no evidence; needs validation, listed in discovery §9.
* **[R]** research — external source cited with a URL.

No player-feedback claim appears anywhere in this package: none was collected.
