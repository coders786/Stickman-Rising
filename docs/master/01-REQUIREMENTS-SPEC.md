# 01 — REQUIREMENTS SPECIFICATION
**Phase 2 output.** Derived from the mandate, filtered through
`00-DISCOVERY-REPORT.md`. Every requirement has an ID, an implementation target, a
validation method, a performance note, and acceptance criteria. Nothing is
"understood" unless it is testable.

Status legend: **READY** = buildable now · **BLOCKED** = needs a user decision
(S1–S3, discovery §8) · **EXISTING** = already satisfied, do not rebuild.

---

## 0. Global constraints (apply to every requirement)

| ID | Constraint |
|---|---|
| GC-1 | **Canvas2D game renderer** (amended by D3/D7). The gameplay renderer stays Canvas2D. GPU work is allowed **only** inside `src/gpu/**` and **only at bake time** on the default path. No `ctx.filter`; no `getImageData` / `texImage2D` / `readPixels` in the draw path — the single documented exception is one bake-time readback per plate (`12` §6). |
| GC-2 | **Mobile-first budget:** every feature ships a `low`-tier path that preserves the environment's *identity* (it must still read as "rainy night"), and an `ultra` path that adds detail. |
| GC-3 | **Level identity is data, not quality.** A rainy run stays rainy at every tier; only detail scales. |
| GC-4 | **Zero per-frame allocations** in `draw*`/`update` hot paths; pre-baked plates or pooled state only. |
| GC-5 | **No regression of gameplay readability:** play band (world y 0..150) never carries new decorations; figures keep silhouette separation. |
| GC-6 | **Reach and preserve 244/244 tests.** Today the suite is 236/244; the 8 failures are triaged in `DECISIONS.md` D4 and fixed in **M0.5**, which must land before any render work. The combat/anim/physics determinism they protect outranks every visual goal (Rule 10). |
| GC-7 | **WCAG 2.3.2:** ≤3 opposing luminance events/s; full-screen ΔL ≤10 % except area-limited combat flashes (research R7). |
| GC-8 | Every claim of improvement must come from a **committed benchmark** (`scripts/bench-*`), never from prose. |

---

## 1. Environment & level identity (REQ-1xx)

| ID | Requirement | Status |
|---|---|---|
| REQ-101 | An **Environment Profile** object (data-only) shall define: sky palette, light direction, moon phase/size, cloud mix per type, weather weights, grade LUT, fog density, shadow strength. | READY |
| REQ-102 | Profiles shall be **selected per run** from the run seed, and **overridable** per stage when stages exist. | READY |
| REQ-103 | The run's palette (`mood.ts`, 4 palettes) shall become a *field of* the profile, not a parallel system. | READY |
| REQ-104 | Profiles shall drive **every** visual subsystem: skyline tint, clouds, moon, practicals' spill tint, prop accents, HUD badge, grade. | READY |
| REQ-105 | Weather shall be a **weighted profile field** (clear/partly/overcast/rain/storm/fog), not a single rain engine, and shall transition smoothly over ≥8 s. | READY |
| REQ-106 | Distinct **stage environments** (street, docks, …) — if in scope — shall be separate geometry tiles + profiles behind `LevelId`. | **BLOCKED (S1)** |

**REQ-101/104 — implementation target:** new `src/game/world/profile.ts`
(`EnvironmentProfile` type + `profileForSeed(seed)`); consumed by
`CyberBackground.setProfile()`, `PropField.setMood()` (already exists),
`hud.setMoodLabel()` (exists), `StormEngine.setProfile()` (new).
**Deps:** none (foundational). **Validation:** profile is a frozen object; a
10k-seed distribution test shows all profiles reachable and roughly even.
**Perf:** selection is 1 hash at run start. **Acceptance:** every consumer reads the
profile; no palette literals remain outside `mood.ts`/`profile.ts`.

**REQ-105 — target:** `weather.ts` state machine + `StormEngine` retuned to read
`{ rainRate, strikeRate, fogDensity, windX }`. **Acceptance:** a 60 s forced
transition test shows monotone parameter change, no frame with 0 rain mid-storm,
and profile identity preserved at `low`.

---

## 2. Sky, moon, atmosphere (REQ-2xx)

| ID | Requirement | Status |
|---|---|---|
| REQ-201 | Sky shall render ≥5 parallax planes whose speed ratios are **log-uniform** (research R4), with tier culling of the deepest at `low`. | READY |
| REQ-202 | Sky gradients, stars, milky-way dust and aurora shall be **baked plates** (no per-frame gradients). | EXISTING |
| REQ-203 | The moon shall support **phase variants** (crescent / gibbous / full) chosen per run, drawn from baked plates. | READY |
| REQ-204 | The moon shall have a **corona** (rings + rays), palette-tinted rims, and <8 px of parallax relative to the sky. | EXISTING (V3) |
| REQ-205 | Moon **visibility** shall respond to weather (cloud occlusion) with a `moonCover` value in [0,1] that also dims its deck glitter. | READY |
| REQ-206 | Atmospheric haze shall be a **separate parallax sheet** from fog and shall thin with altitude of the camera. | EXISTING (fog plane) / refine |
| REQ-207 | Sky shall support **time-of-day keyframes** (dusk → night → blue hour) if V6 ships; transitions ≤2 blits. | **DEFER (V6)** |

**REQ-203 target:** `buildMoon(pal, phase)` ×3 variants, one resident per run.
**Validation:** phase distribution ⅓ ±5 % over 10k seeds. **Acceptance:** crescent
remains readable at `low` (contrast probe ≥3:1 against sky).

---

## 3. Three procedural cloud systems (REQ-3xx)

| ID | Requirement | Status |
|---|---|---|
| REQ-301 | **Cumulus**: rounded, soft-edged, variable density, silhouette-driven masses with lit tops and shadowed bases. | READY |
| REQ-302 | **Stratus**: broad horizontal layered bands, high coverage, low contrast, near-seamless tiling. | READY |
| REQ-303 | **Cirrus**: thin, elongated, wispy, low alpha, directionally stretched, parallax-far. | READY |
| REQ-304 | Each system shall have **independent** coverage, density, wind speed and altitude parameters in the profile. | READY |
| REQ-305 | All three shall be **generated at bake time** into periodic tiles (fBM / value noise / Worley as appropriate) — no per-frame noise. | READY |
| REQ-306 | Drift shall be an **integer/float offset per frame** on the tile blit, never a re-render. | READY |
| REQ-307 | `low` tier shall render **2 cloud layers**, `high` 3, `ultra` 3 + a second cirrus deck. | READY |
| REQ-308 | Cloud tiles shall be generated per profile (not per run seed) so 4 profiles × 3 types = 12 plates max, memoised. | READY |

**Technical basis:** Canvas2D has no shader noise, so fBM/Worley run once per plate
in TS (JS loop over ImageData *at bake time only* — allowed by GC-1, which bans
`getImageData` in the **draw path**).
**Implementation target:** new `src/game/world/clouds.ts` (three builders +
`CloudDeck` class), consumed by `background.drawSky`.
**Cost:** 3 tiles ≈ 2048×260 each; worst case 3 layers = 3 blits + 2 (ultra cirrus).
**Validation:** silhouette entropy/coverage measured from the baked alpha (not by
eye): cumulus coverage 22–38 %, stratus 55–80 %, cirrus 12–25 % with elongation
ratio ≥4:1. **Perf:** bake +≤6 ms; resident +≤4 MB. **Acceptance:** all three read
as *different systems* at `low` (contrast/edge-density probes differ ≥25 %).

---

## 4. Lighting & shadows (REQ-4xx)

| ID | Requirement | Status |
|---|---|---|
| REQ-401 | A single **light direction** shall be defined per profile and honoured by every shadow, rim and spill. | READY |
| REQ-402 | Static rooftop objects (tanks, antennas, poles, rails, AC units, vents, pipes) shall cast **baked** directional shadows with correct length and lean. | PARTIAL (V3 rakes) |
| REQ-403 | **Dynamic props** shall cast a live directional shadow (1 blit or 2 fills, no per-frame maths beyond scale/alpha). | READY |
| REQ-404 | Shadow **colour** shall be a palette-derived cool tint, not pure black (reads as ambient sky fill). | READY |
| REQ-405 | The player's rim light shall respond to the nearest practical and to enemies within it. | EXISTING (player) / extend |
| REQ-406 | Height-aware shadows: shadow offset/scale shall respond to entity height above deck (jump arcs). | EXISTING (ellipse scale) |
| REQ-407 | `ultra` shall add **shadow filtering** (2-sample penumbra from baked variants), `low` a single hard-ish shadow. | READY |
| REQ-408 | No dynamic shadow may be computed per-pixel or require a depth buffer (C2). | GC |

**Validation:** geometric assertion — for a 100 px object at x, the baked shadow's
far corner must lie within ±12° of the profile's light azimuth; measured on the
bake by sampling the shadow polygon (numeric, no screenshots).

---

## 5. Weather & colour grading (REQ-5xx)

| ID | Requirement | Status |
|---|---|---|
| REQ-501 | Weather profiles shall modify: sky tint, cloud mix, ambient light, shadow colour, haze density, saturation, contrast, exposure, temperature. | READY |
| REQ-502 | Grading shall be **precomputed LUTs** applied at **bake time** per (profile × weather) pair; runtime cost 0. | READY |
| REQ-503 | If a live grade is ever needed (weather change mid-run), it shall be **one full-screen tint blit**, not a shader pass. | READY |
| REQ-504 | Transitions shall interleave two baked LUTs by cross-fading the *plates* rebuilt once at transition start, not per frame. | READY |
| REQ-505 | Grade shall never reduce play-band contrast below the readability floor (REQ-6xx). | GC |

**LUT count budget:** 4 profiles × 6 weathers = 24 LUTs, each 16³ RGB = 12 KB →
**288 KB** total, or generated lazily per active pair (recommended: 1 resident).
**Implementation target:** `world/grade.ts` — bake-time `ImageData` transform of
plates (allowed: bake only). **Validation:** ΔE between profile grades ≥6 (they must
be visibly distinct) and ≤18 (no posterisation).

---

## 6. Readability, accessibility, mobile display (REQ-6xx)

| ID | Requirement | Status |
|---|---|---|
| REQ-601 | The play band shall keep a minimum local contrast between figure and background: figure rim ≥ **3:1** luminance ratio. | READY |
| REQ-602 | Decoration shall not enter the play band (no particles/shadows above 25 % alpha in y 0..150 except entity shadows). | READY |
| REQ-603 | Flash budget: ≤3 opposing luminance events/s; ≤10 % full-screen ΔL (GC-7). | READY |
| REQ-604 | A **reduced-motion** setting shall disable ripple drift, glitter cycling, reflection boost and cap trauma. | READY |
| REQ-605 | `low` tier shall remain *identifiable*: same profile, same weather, same light direction — only detail reduced. | READY |
| REQ-606 | Touch-playable layout + controls shall exist if S2 = full mobile. | **BLOCKED (S2)** |

**Validation for REQ-601:** numeric probe on the baked plates + a synthetic figure
mask: for N sampled figure positions, background luminance within the figure's
silhouette neighbourhood must be ≤ figure luminance / 3.

---

## 7. Performance, memory, loading (REQ-7xx)

| ID | Requirement | Status |
|---|---|---|
| REQ-701 | Frame blits ≤ **14** at `low`, ≤ **20** at `high`, ≤ **26** at `ultra` (provisional; see §7.1). | READY |
| REQ-702 | Resident **canvas** memory ≤ **38 MB** at 1280×720 for `low`/`medium` (single canvas; ≈33.7 MB modelled in `12` §8, from 30.3 MB today). Desktop `high`/`ultra` may rise to **≤56 MB** but only with a `DECISIONS.md` entry naming the cause; the 38 MB figure was written for a Canvas2D-only world and does not survive a second canvas (≈47 MB). | READY (amended) |
| REQ-703 | Warm re-bake ≤ **16 ms**; cold bake ≤ **30 ms**. No bake during gameplay except run start. A scheduled mid-run re-bake is allowed **only** if the top 150 px of the play band is clear of entities, the p95 window has ≥4 ms of slack, and it happens at most once per 10 s (currently 9.6 ms warm **[M]**). | READY (amended) |
| REQ-704 | Zero per-frame allocations in draw/update. | READY |
| REQ-705 | Tier changes shall be **art-preserving** and rate-limited (governor already: 4 s cooldown, 12 s raise guard). | EXISTING |
| REQ-706 | Loading shall not regress: no new network assets (asset-free pipeline is a feature). | GC |
| REQ-707 | A committed harness shall print: bake, reseed, resident MB, blits by composite-op, per-tier counts. | READY |
| REQ-708 | **Canvas Ledger:** every canvas is acquired/released through one module; released canvases are resized to 0×0. Caps: ≤48 live canvases / ≤56 MB mobile, ≤64 / ≤96 MB desktop, ≤8.4 M px per canvas (`12` §4). | READY |
| REQ-709 | **No gate may depend on a GPU timer.** `EXT_disjoint_timer_query_webgl2` reaches 0.56 % of Android and 0.15 % of iOS; budgets are enforced through frame-interval percentiles and the multiplicity calibration (`12` §2, `11` §2). | READY |
| REQ-710 | **Resolution is shed before features.** The ladder order is fixed: `atmoScale` → octave LOD → 2nd cirrus → fog → `gameScale` → tier → pause. No step may touch entities, combat, camera, assets or hit detection (`12` §3). | READY |
| REQ-711 | **Upload-free frame path:** 0 texture uploads, 0 readbacks, 0 `getImageData`, 0 `willReadFrequently` per frame; all uploads/readbacks occur at bake or run start. | READY |
| REQ-712 | **Silent-corruption probe:** a 1×1 probe canvas is drawn and read at boot and after every profile change; a mismatch means the canvas budget was truncated (iOS renders canvases transparent silently) and forces `atmoScale` down one step plus a `LEDGER_SUSPECT` log. | READY |

### 7.1 Why these numbers are provisional
They are derived from today's measured baseline (30.3 MB resident, 37 canvases,
11 blits, 9.6 ms warm re-bake **[M]**) plus the planned additions (clouds +2–6
blits / +3.5–24 MB, grade 0 blits, shadows +1–2 blits).

Two corrections landed after the first draft, both in `12-MOBILE-PERFORMANCE.md`:
* **The GPU-ms budgets cannot be measured on a phone.** No mobile browser exposes
  a GPU timer; those numbers are models `[E]` enforced relatively (`11` §2).
* **iOS caps total canvas memory** (224 MB / 384 MB observed) and renders
  canvases **transparent** rather than throwing when that cap is hit — so the
  memory requirement is now a ledger with caps (REQ-708) and a probe (REQ-712),
  not a single number.

They are still **not** universal device limits: no phone has run this build. Labeled
provisional in code and in every document.

---

## 8. Architecture & maintainability (REQ-8xx)

| ID | Requirement | Status |
|---|---|---|
| REQ-801 | `background.ts` (3,285 LOC) shall be split: `renderers/` (draw), `bakers/` (build), `profile`/`grade`/`clouds` modules. No new feature may be added to the monolith before the split. | READY |
| REQ-802 | Systems shall communicate through an explicit **Environment Controller** (single source of truth), not by reaching into each other. | READY |
| REQ-803 | Quality Manager owns tier + profile-independent scaling; Renderers read, never write. | READY |
| REQ-804 | All new resources shall be owned by exactly one module with an explicit `dispose()`/`invalidate()` path (V3 already had a growth bug here). | READY |
| REQ-805 | No circular deps; `world/` may not import `entities/`; `render/` may not import React. | READY |
| REQ-806 | Decision log maintained (`docs/master/DECISIONS.md`) — settled choices are not relitigated. | READY |

---

## 9. Requirements the mandate implies but the project cannot satisfy as written

| Mandate ask | Reality | Resolution |
|---|---|---|
| "Optimized shaders / shader variants / prewarming" | No shader stage exists | Re-spec as **bake-time plate generation + memoisation + explicit invalidation**; keep the *intent* (no per-frame cost, no stutter) |
| "Pipeline caching" | No GPU pipeline objects exposed by Canvas2D | Same re-spec as above; the analogue is **plate caching** (SkyVaultCache already) |
| "Distinctive graphics for every game level" | One level | **S1 decision**; interim: per-run profiles |
| "Mobile-first" | Keyboard-only input | **S2 decision**; interim: performance-first mobile |
| "Desktop Ultra enhanced visuals" | Tiers identical above `low` (F4) | V4 `L7` tier ladder + REQ-3xx/4xx ultra paths |
| "Screenshot comparison" | No browser in environment (C8) | Numeric probes + user visual review |

---

## 10. Traceability summary

| Requirement | Implementation target | Depends on | Validation | Perf note | Acceptance |
|---|---|---|---|---|---|
| REQ-101..106 | `world/profile.ts` | — | 10k-seed distribution | 1 hash/run | all consumers read profile |
| REQ-201..207 | `background.drawSky`, `bakers/sky` | REQ-801 split | log-uniform ratio test | ≤5 planes at low | ratios ±12 % |
| REQ-301..308 | `world/clouds.ts` | REQ-101 | alpha coverage probes | +3 blits, +4 MB | 3 distinct systems at low |
| REQ-401..408 | `bakers/shadow.ts`, `renderer.ground` | REQ-101 | azimuth ±12° | ≤2 blits | shadows agree with light dir |
| REQ-501..505 | `world/grade.ts` | REQ-101 | ΔE 6..18 | 0 blits runtime | grades distinct, no banding |
| REQ-601..606 | `renderer`, `fx`, settings | REQ-501 | contrast probes | ≤1 blit | 3:1 kept |
| REQ-701..707 | `game.govern`, harness | all | bench table | budgets | measured, not claimed |
| REQ-708..712 | `render/canvasLedger.ts`, `render/quality.ts`, `debug/bench.ts` | REQ-707 | ledger assertions, percentile report | caps `12` §4 | 0 unzeroed canvases, 0 uploads/frame |
| REQ-801..806 | repo structure | — | import-boundary lint | n/a | no monolith additions |

---

## 11. Open requirement questions — status (2026-11-15)

| # | Question | Answer |
|---|---|---|
| 1 | **S1** — profiles only, or 2–3 real stages? | **Answered: profiles only.** REQ-106 stays **BLOCKED**; the distinctiveness load moves to the five profile axes (`07`). |
| 2 | **S2** — performance-only or touch-playable mobile? | **Answered: performance-only.** REQ-606 stays **BLOCKED**; this spec never claims the game is touch-playable. |
| 3 | **S3** — confirm Canvas2D-only? | **Reversed by D3/D7.** GPU is allowed in `src/gpu/**` at bake time; the game renderer is untouched. GC-1 rewritten. |
| 4 | Fix the 8 failing tests? | **Answered: yes**, M0.5, before any render work (D4). |

Remaining genuinely open (needs the user's eye, not a decision): whether
`atmoScale` 0.5 on `low` is acceptably soft (FID-11 is scale-absolute today —
`12` §11.2), and whether the six archetypes are distinct enough to read as
"different nights" (`07` §2, gate G8).
