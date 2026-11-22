# PLAN INDEX
### The planning set for Stickman Rising's world rendering, in the order it was written.

| # | Doc | Status | What it decides |
|---|---|---|---|
| ★ | `docs/master/README.md` | **package** | Master overhaul package: discovery, requirements, decisions, tech selection, psychology, fidelity targets, architecture, budgets, prototypes, profile matrix, roadmap, risks, validation, mobile reality, shader spec, device tiers, contracts, profile data, cost model, motion/120 fps research, animation cadence, natural-motion plan, optimisation catalog, UX bug bounty — all delivered |
|---|---|---|---|
| 1 | `docs/PREBAKED-WORLD-PLAN.md` | **built** (`e4dbbfe`) | Baked plates, parallax ladder, seeded procedural skyline, purposeful props |
| 2 | `docs/NEUROAESTHETIC-UPGRADE.md` | **built** (`3081d8c`) | 60/30/10 mood palettes, split-tone grade, isolation heroes, teen+adult dual register |
| 3 | `docs/LIGHT-SHADOW-V3.md` | **built** (`49cfb88`) | Stylized moon, reactive key light, 1/8-scale reflection band, sparse prop dressing, −20 % memory |
| 4 | `docs/LIGHT-SHADOW-V4-PLAN.md` | **planned** | Practicals as data, 3 new sources, moon phases, puddle mask, rotation-correct reflections, tier parity, committed harness |
| 5 | `docs/RENDER-ROADMAP-V5-PLUS.md` | **planned** | Depth-sliced fog, shaft cards, time-of-night, perceptual QA, accessibility |
| 6 | `docs/LIGHTING-RESEARCH-V4.md` | **evidence** | Canvas2D readback risk, flipped-sprite mirrors, two-level puddle masks, log parallax, directional fog, WCAG flash limits — with the 6 experiments that gate V4 |

Kept for reference: `docs/mobile-2.5d/LIGHT-SHADOW-MATCH-PLAN.md`, `docs/ANIMATION.md`.

## Start here for current graphics work

- [Master overhaul execution record — 2026-11-22](ULTRA-OVERHAUL-2026-11-22.md) — what the "100% WebGL2 / SACR utilisation / 350 ms boot" plan asked for, which of its complaints the current source already answers (with file:line), the three fixes landed in that pass (stall watchdog, guard deflection, death-state HUD retirement), and the honest open list.

- [Bridge visual rules](BRIDGE-VISUAL-RULES.md) — prioritized fighter readability, rain on asphalt, and city depth; implementation and matched in-game comparisons.
- [Procedural bridge run](PROCEDURAL-BRIDGE.md) — the current Engage path: streamed sectors, service/Flow, single-resolution governor and verification.
- [Retired environment pilot](ENVIRONMENT-PILOT.md) — reference art and evidence from the former separate previews.
- [Next-generation environments](NEXT-GEN-ENVIRONMENT-PLAN.md) — the universal graphics specification and phased roadmap, with a visual atlas and 80 review questions.
- [Practical Optics](PRACTICAL-OPTICS.md) — the accepted Wet Bridge and dry Night Station visuals and paired evidence that the new plan uses as its baseline.
- [Graphics engine map & mobile visual rulebook](GRAPHICS-ENGINE-MAP.md) — the current frame pipeline and shared scene rules.
- [Wet Bridge upgrade and Night Station preview](MOBILE-VISUAL-UPGRADE-RESULTS.md) — historical art trial, matched Low 1× captures and validation receipts.
- [Mobile visual upgrade plan](MOBILE-VISUAL-UPGRADE-PLAN.md) — researched art direction, ownership, rollout order, and phone frame-time gates.
- [Adaptive graphics presets](lighting/graphics-tiers.md) — the active tier/route contract and visual checks.
- [Graphics repair without losing the slasher](SLASHER-GRAPHICS-REPAIR-PLAN.md) maps the earlier audit to 24 tickets. The [implementation checkpoint](SLASHER-GRAPHICS-REPAIR-STATUS.md) records landed repairs, evidence, and what still needs device testing.

## Master overhaul package (design history and proposals)
`docs/master/DECISIONS.md` (D1–D4) → `00-DISCOVERY-REPORT.md` →
`01-REQUIREMENTS-SPEC.md` → `02-TECH-SELECTION.md` → `03-PSYCHOLOGY-ART-DIRECTION.md`
→ `04-FIDELITY-TARGETS.md` → then 05 architecture … 11 validation.

## Historical reading order

For the reasoning behind the current system and earlier proposals:

1. `LIGHTING-RESEARCH-V4.md` §2 R1 and §4 (reflection/compositing experiments).
2. `LIGHT-SHADOW-V4-PLAN.md` §2 (the three budgets) and §8 (the do-not-do list).
3. `LIGHT-SHADOW-V3.md` §2 (the earlier architecture).
4. `RENDER-ROADMAP-V5-PLUS.md` §5 (the decision log).

## The one rule
**If it can be baked, bake it. If it must move, blit it. If it must think,
measure it once per frame, never per object.**
