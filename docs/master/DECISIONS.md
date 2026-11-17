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

---

## D7 · Single canvas by default — the second canvas is a desktop experiment

**Evidence gathered 2026-11-15 (four searches + one code inspection):**

1. `src/game/game.ts:311` already requests `{ alpha: false, desynchronized: true }`.
   An opaque canvas cannot show anything drawn *beneath* it, so the "sky canvas
   stacked under the game canvas" sketch in `05` §3 requires flipping the game
   canvas to `alpha: true`.
2. That flip converts the present into a **full-screen per-pixel blend of a
   translucent top layer** — the single worst compositor pattern in the
   literature, at 0.3–1.5 ms per layer, plus ≈17 MB of layer memory at 1600×900.
3. Blitting *out* of a WebGL canvas costs a readback + upload per use — "right for
   a screenshot or a filter, not for a per-frame composite".
4. iOS caps **total canvas memory** (224 MB / 384 MB observed) and silently
   renders canvases transparent when exceeded, so every live canvas is a liability
   on the platform that matters most for D2.
5. No mobile browser exposes a GPU timer (Android 0.56 %, iOS 0.15 %), so a
   per-frame GPU pass is also the one thing we could never budget honestly.

**Decision.** The default and only mobile path is **B3 — "GPU as generator, zero
per-frame GPU"**: shaders run at bake time, one `readPixels` per plate, and the
frame loop stays exactly today's single-canvas Canvas2D path with `alpha:false`
+ `desynchronized:true`. **No second canvas on any device** unless prototype P4
proves B1 pays for itself on desktop `high`/`ultra`.

**This is not a retreat from D3.** The distinct new technology is the
shader-authored plate pipeline (fBm / domain-warp / SDF on the GPU, graded by a
16³ LUT, read back once) which does not exist in this repo and which Canvas2D
cannot produce at our cost. It costs 0 ms per frame.

**What changes:** `05` two-mode design (Mode B demoted), `06` §2 mobile rows,
`10` P4 becomes a desktop gate, `01` GC-1/REQ-702/REQ-708…712, new doc `12`.

**What is kept:** drift by integer-offset blits, weather by plate cross-fade,
slow evolution by a scheduled re-bake guarded by REQ-703, moon occlusion by
baked `moonCover` variants. The sky still differs every run and still evolves
during a run.

**Reversal clause:** if P4 measures ≤0.5 ms compositor delta at dpr 2 *and* the
user prefers continuous morphing over the memory saving, D7 is revisited with
that measurement attached — not before.

---

## D8 · Mobile-first budget discipline: resolution before features

Netmarble/Android ADPF evidence: resolution scaling had "the most significant
impact on GPU load and thermal output" while shadows/textures had "minimal
impact on overall thermal performance"; frequency capping raised dropped frames
by up to 146 % in interactive apps. Therefore the shed ladder is fixed
(`12` §3, REQ-710) and tier changes that delete art come last. A steady 45 fps
is preferred over an oscillating 40–56 fps, and average FPS is never the target
metric — p95/p99 and jank ratio are (`11` §3).
