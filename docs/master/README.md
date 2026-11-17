# MASTER PROJECT — ENGINEERING PACKAGE
**Research-driven, mobile-first, level-aware 2D/2.5D graphics overhaul.**
Planning-first per the operating procedure: discovery → requirements → research →
architecture → roadmap → risk → prototype → implement → validate.

Baseline commit for all numbers in this package: `5b874fc`.

---

## Package map (what exists, what is next)

| # | Document | Phase | Status |
|---|---|---|---|
| 00 | `00-DISCOVERY-REPORT.md` | 1 | **DELIVERED** — audit, measured baseline, 8 constraints, 6 decisions |
| 01 | `01-REQUIREMENTS-SPEC.md` | 2 | **DELIVERED** — REQ-101…REQ-806, traceability, 3 blocked scope decisions |
| 02 | `02-VISUAL-RESEARCH.md` | 3 | next — atmosphere, hierarchy, cloud aesthetics, comfort, evidence grades |
| 03 | `03-ART-DIRECTION.md` | 4 | next — references, target frames, hierarchy, consistency rules |
| 04 | `04-TECH-COMPARISON.md` | 5 | next — technique matrix (adopt/adapt/defer/reject) in Canvas2D terms |
| 05 | `05-ARCHITECTURE.md` | 6–7 | next — Environment Controller, Level Manager, Quality Manager, renderers, diagrams, data flow |
| 06 | `06-PIPELINE-BUDGETS.md` | 8 | next — frame order, platform budgets (provisional, labelled) |
| 07 | `07-PROFILES-MATRIX.md` | 9–10 | next — environment profiles × quality tiers feature matrix |
| 08 | `08-ROADMAP-TASKS.md` | 11–12 | next — milestones 0–10, task IDs, dependency graph, file plan |
| 09 | `09-RISK-REGISTER.md` | 13 | next — likelihood/severity/detection/prevention/fallback |
| 10 | `10-PROTOTYPES.md` | 14 | next — hypotheses + measurements for the 6 uncertain techniques |
| 11 | `11-VALIDATION.md` | 15, 21–24 | next — gates, benches, device matrix, living decision log |

Existing research that this package builds on (kept, not duplicated):
`docs/LIGHTING-RESEARCH-V4.md`, `docs/LIGHT-SHADOW-V4-PLAN.md`,
`docs/LIGHT-SHADOW-V3.md`, `docs/NEUROAESTHETIC-UPGRADE.md`,
`docs/PREBAKED-WORLD-PLAN.md`, `docs/RENDER-ROADMAP-V5-PLUS.md`, `docs/PLAN-INDEX.md`.

---

## The three decisions that gate everything

| ID | Question | Why it blocks |
|---|---|---|
| **S1** | Per-run **environment profiles** on the one rooftop stage, or build **2–3 real stages**? | Decides whether REQ-106 is a data file or a 10× art/geometry project |
| **S2** | Mobile = **performance-first** or **touch-playable**? | The game is keyboard-only; full mobile needs an input + layout system |
| **S3** | Confirm **Canvas2D-only** (no WebGL layer for clouds)? | Whole architecture; default assumed **yes** |

Answered decisions live in `DECISIONS.md` once S1–S3 are resolved.

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
