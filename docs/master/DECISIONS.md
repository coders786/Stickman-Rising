# DECISIONS LOG — MASTER PROJECT
Every settled decision lands here. Reversal requires **new evidence**, not a new
preference (mandate Rule 2). Dates are session dates; baseline `5b874fc`.

---

## D1 · S1 — Level identity = **per-run environment profiles, one stage**
**Decided:** 2026-11-15 · **By:** user
> "Profiles only but achieve a full fidelity graphics that make me WoW. Put as
> much human psychology as you can."

**Consequences**
* REQ-106 (real stages) is **dropped** from scope; `LevelId` stays single-valued.
* REQ-101…REQ-105 (profile object, per-run selection, profile-driven identity,
  weather weights) become the **critical path** — everything else reads the profile.
* "Full fidelity" is now a *requirement*, not a vibe: it must be defined as
  measurable targets (`04-FIDELITY-TARGETS.md`) and validated numerically, because
  this environment cannot take screenshots (discovery C8).
* Human-psychology weighting is a **design constraint with evidence grading**
  (`03-PSYCHOLOGY-ART-DIRECTION.md`), not decoration. Claims must be marked
  [R] research / [I] inference / [A] assumption — the mandate forbids fabricated
  player feedback and this project has collected none.
* Because there is only one stage, distinctiveness must come from **profile
  variation**: palette × weather × moon phase × cloud mix × grade. Target: any two
  consecutive runs should differ in ≥4 of those 5 axes.

---

## D2 · S2 — Mobile = **performance-first, not touch-playable**
**Decided:** 2026-11-15 · **By:** user (selected "Performance-only mobile")

**Consequences**
* REQ-606 (touch controls, mobile layout, safe areas) is **out of scope**.
* Mobile-first means: budgets, tier ladder, DPR governor, overdraw control,
  thermal-aware degradation, and **identity preservation at every tier** (GC-2/3).
* The game remains a desktop keyboard experience; the mobile target is "a phone
  in landscape running the web build at a stable frame rate", not a mobile product.
* Honest limitation to restate in the final delivery: *the game is not playable on
  a touch-only device.* Do not market mobile support as playability.

---

## D3 · S3 — "Use a new and distinct technology" → **Canvas2D-only is REVOKED**
**Decided:** 2026-11-15 · **By:** user
> "usse a new and distinct technology."

This supersedes the standing "no shaders / no WebGL / no render targets" constraint
that governed V3 and V4 planning. That constraint is now **historical**, not
binding. What replaces it is a *technology selection decision*:

| Candidate | Verdict |
|---|---|
| A. Stay Canvas2D, more baked plates | **Rejected as the answer to D3** — it is the current technology, and the user asked for a new one. Retained as the **fallback path**. |
| B. **Hybrid: Canvas2D game + GPU atmosphere layer (WebGL2, WebGPU optional)** | **SELECTED** (`02-TECH-SELECTION.md` §5) |
| C. Full WebGL2 rewrite of the renderer | Rejected — 32.8k LOC of canvas drawing incl. a 5.3k-line procedural fighter; rewrite risk dwarfs visual gain |
| D. WebGPU-first, WebGL2 fallback | Deferred — WebGPU reaches ~86 % of sessions (Safari 26+ only; Firefox partial) so it cannot be primary on a mobile-first budget; used as an **ultra-only upgrade path** |
| E. OffscreenCanvas + worker rendering | Adopted as a **supporting** technique, not the headline |

**What "new and distinct" concretely means**
1. A **second, GPU-rendered atmosphere canvas** (WebGL2) that procedurally generates
   sky gradients, three cloud systems (fBM/domain-warp cumulus, layered stratus,
   stretched cirrus), and volumetric-feel fog **per frame, in shaders** — replacing
   the baked sky plates at `medium`+ quality.
2. **Hard isolation**: the GPU layer never samples the game canvas and the game
   canvas never samples the GPU layer. Compositing is done by the browser
   (stacked canvases). This deliberately avoids the framebuffer-readback trap
   measured/documented in `LIGHTING-RESEARCH-V4.md` R1.
3. Feature detection with **the existing Canvas2D sky retained as a first-class
   fallback** — not a degraded afterthought.
4. The game renderer, combat, physics and animation are **untouched**.

**Consequences to carry into architecture**
* New module tree `src/gpu/` (context, programs, geometry, uniforms, timer) with a
  strict no-import boundary from `src/game/` (REQ-805 amended).
* New budget line: GPU frame time for the atmosphere pass, separate from the
  Canvas2D blit budget (which still applies to the game canvas).
* Shader compilation must be **prewarmed at boot** (mandate Phase 20) — a
  first-frame compile hitch is a gate failure.
* Mobile battery/thermal: the GPU layer is the first thing the governor degrades
  (tier `low` → Canvas2D fallback sky), which is exactly the "cheap to shed" property
  we want on a mobile-first product.

---

## D4 · S4 — The 8 failing tests will be **fixed** (Milestone 0.5)
**Decided:** 2026-11-15 · **By:** user (selected "Fix them")

Triage (executed):

| # | Test | File | Failure |
|---|---|---|---|
| 8 | blade cleaves a tight pack, every strike | `blade-cleave.test.ts` | `axeKick at 26px only cut 3/5 (29 29 29 0 0); expected ≥4` |
| 9 | cleave independent of pack tightness | `blade-cleave.test.ts` | same family |
| 11 | cut depth independent of frame rate | `blade-cleave.test.ts` | same family |
| 81 | every core strike thrown by the whole body | `full-body.test.ts` | body-engagement assertion |
| 84 | each strike holds an extreme at contact | `full-body.test.ts` | pose-extreme assertion |
| 86 | no joint welded shut in any core strike | `full-body.test.ts` | joint-range assertion |
| 195 | six extra authored keys preserve timing | `ritual-idle.test.ts` | keyframe/timing assertion |
| 242 | connecting strike puts joint ON the body | `unarmed-step.test.ts` | contact-precision assertion |

All eight are **combat/animation design assertions**, not rendering. Their files and
the implementation (`attacks.ts`, `clips.ts`) share one history commit (`c857433`),
so these are **not stale tests** — they encode design intent that the implementation
currently violates (e.g. "A drawn blade must not stop on the first body").

**Rules for fixing them (protects Rule 10):**
* Fix **behaviour**, not assertions, unless an assertion is provably wrong against
  the design doc — in which case the change is documented here first.
* Each fix is a separate commit with the failing assertion quoted.
* `npm test` must reach **244/244** before Milestone 1 lands; the "no regression"
  claim in later phases depends on a green baseline.
* Schedule: **M0.5**, immediately, before any GPU work — it is independent and
  unblocks trustworthy gates.

---

## D5 · No screenshots — acceptance stays numeric/geometric
Carried from discovery C8. The user's eye remains the final gate for "WoW";
machine gates use contrast probes, alpha mass, coverage percentages, blit counts,
bake timings, and geometry checks. No claim of "looks better" will be made from code.

---

## D6 · Evidence discipline
* [M] measured · [E] estimated · [A] assumption · [R] research.
* No fabricated player feedback. Any UX statement is either cited research,
  a design inference ([I]), or an explicit assumption flagged for user validation.
