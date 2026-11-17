# PLAN INDEX
### The planning set for Stickman Rising's world rendering, in the order it was written.

| # | Doc | Status | What it decides |
|---|---|---|---|
| 1 | `docs/PREBAKED-WORLD-PLAN.md` | **built** (`e4dbbfe`) | Baked plates, parallax ladder, seeded procedural skyline, purposeful props |
| 2 | `docs/NEUROAESTHETIC-UPGRADE.md` | **built** (`3081d8c`) | 60/30/10 mood palettes, split-tone grade, isolation heroes, teen+adult dual register |
| 3 | `docs/LIGHT-SHADOW-V3.md` | **built** (`49cfb88`) | Stylized moon, reactive key light, 1/8-scale reflection band, sparse prop dressing, −20 % memory |
| 4 | `docs/LIGHT-SHADOW-V4-PLAN.md` | **planned** | Practicals as data, 3 new sources, moon phases, puddle mask, rotation-correct reflections, tier parity, committed harness |
| 5 | `docs/RENDER-ROADMAP-V5-PLUS.md` | **planned** | Depth-sliced fog, shaft cards, time-of-night, perceptual QA, accessibility |

Kept for reference: `docs/mobile-2.5d/LIGHT-SHADOW-MATCH-PLAN.md`, `docs/ANIMATION.md`.

## Reading order for a new contributor
1. `LIGHT-SHADOW-V4-PLAN.md` §2 (the three budgets) and §8 (the do-not-do list).
2. `LIGHT-SHADOW-V3.md` §2 (architecture) — the line the code actually follows.
3. `PLAN-INDEX.md` (this file) for what is built vs planned.
4. `RENDER-ROADMAP-V5-PLUS.md` §5 (decision log) before proposing a new engine.

## The one rule
**If it can be baked, bake it. If it must move, blit it. If it must think,
measure it once per frame, never per object.**
