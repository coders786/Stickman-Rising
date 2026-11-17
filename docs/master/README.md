# MASTER PROJECT — ENGINEERING PACKAGE
**Research-driven, mobile-first, level-aware 2D/2.5D graphics overhaul.**
Planning-first per the operating procedure: discovery → requirements → research →
architecture → roadmap → risk → prototype → implement → validate.

Baseline commit for all numbers in this package: `5b874fc`.

**Implementation status (this branch, after runs 1–2):** the planning package is
complete *and* its executable slice is in the tree — `world/profile.ts`
(12-axis run identity), `gpu/context.ts` + `gpu/sky.ts` (WebGL2 moon/star baker
with a Canvas2D fallback), `world/night.ts` (glitter + moon key rim),
`world/rigging.ts` + `world/wind.ts` (cables and pennants on the profile's wind),
`world/clouds.ts` (the conditional cumulus bank), `world/consumers.ts` (the
no-dead-knobs registry), `render/ledger.ts`, `render/quality.ts` (p95 ladder),
`render/color.ts` (allocation-free colour), `render/frameLog.ts`,
`anim/natural.ts` (M4.5 core, plus the tail-pinned chain), `scripts/bench-render.mjs`,
`scripts/lint-boundaries.mjs`, and `npm run gate`.

Tests: **352/357** (5 known fails, all filed). Every profile axis now has a named
renderer consumer and `tests/profile-consumption.test.ts` fails if one loses it
(O-08 closed). Run identity is visible in-play and on the results card (O-09), and
the contact shadow is projected away from the moon (O-10). See
`22-BUG-BOUNTY.md` §0–§4 for the verification stack and the re-test protocol.

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
| 07 | `07-PROFILES-MATRIX.md` | 9–10 | **DELIVERED** — 5 axes, 6 archetypes, per-run jitter, tier degradation rules (what a tier may *not* remove), per-archetype plate cost |
| 08 | `08-ROADMAP-TASKS.md` | 11–12 | **DELIVERED** — M0.5 → M6 with task IDs, files, LOC, gates, risks, effort (~17–22 days) |
| 09 | `09-RISK-REGISTER.md` | 13 | **DELIVERED** — 30 risks scored with signals and mitigations; 5 that can kill the project; accepted risks stated |
| 10 | `10-PROTOTYPES.md` | 14 | **DELIVERED** — P1–P8 with numeric accept/reject; P4 demoted to desktop-only by D7 |
| 11 | `11-VALIDATION.md` | 15, 21–24 | **DELIVERED** — 3 measurement environments, metric catalogue, frame-percentile method, gate ladder G0–G8, anti-self-deception rules, E3 rubric |
| 23 | `23-LIGHT-AND-SHADOW.md` | 3–5 | **DELIVERED** — the lighting/shadow rewrite: projected body shadows, the second light, prop silhouettes, volumetric shafts, and the graphics-level table (low/medium/high/ultra) with a device classifier |
| 12 | `12-MOBILE-PERFORMANCE.md` | 8b | **DELIVERED** — the mobile reality check: no GPU timer on phones, resolution-first shedding, iOS canvas caps + ledger, and **D7** (single canvas default) |
| 13 | `13-SHADER-SPEC.md` | 6b | **DELIVERED** — 8 programs with real math, the **noise atlas** decision, precision map, straight-alpha/Y-flip contract, bake budget of ≤6 ms per plate |
| 14 | `14-DEVICE-TIERS.md` | 10 | **DELIVERED** — tier detection by **measurement** (renderer strings are blocked/falsified), 120 ms boot probe, C0–C3 classes |
| 15 | `15-CONTRACTS.md` | 11 | **DELIVERED** — TypeScript interfaces for profile, ledger, governor, env controller, GPU bake; determinism/allocation contract; 6 test files |
| 16 | `16-PROFILE-DATA.md` | 9b | **DELIVERED** — the actual numbers for 6 archetypes × every field, jitter clamps, 12 machine-checkable invariants |
| 17 | `17-FRAME-COST-MODEL.md` | 8c | **DELIVERED** — `T_frame` equation, overdraw budget ≤4×, dpr arithmetic (dpr3 = 2.96 Mpx vs 1.5 = 0.74), derived governor thresholds, falsification table |
| 18 | `18-MOTION-SMOOTHNESS.md` | 6c | **DELIVERED** — the real answer on 120 fps: iOS flag-clamped, Android main thread capped (worker clock is the only path), cadence beats rate (σ ⇒ QoE R²=0.99), 5 levers, FID-32…36 |
| 19 | `19-ANIMATION-CADENCE.md` | 6d | **DELIVERED** — how movements/animations actually reach 120: sample time-driven, interpolate state-driven (D10), latency ledger, angle-space pose interpolation, rig batching (20 strokes/frame measured), input coalescing, FID-37…41 |
| 20 | `20-NATURAL-MOTION.md` | 6e | **DELIVERED** — higher graphics with **zero assets**: minimum-jerk (0.533 signature), 2/3 power law arcs, spring chains (21 pts, ζ bounds), aperiodic micro-life, sub-frame contacts, **0 MB / 0 blits** → new milestone M4.5 |
| 21 | `21-OPTIMISATION-CATALOG.md` | 8d | **DELIVERED** — every browser-game optimisation technique for 2.5D with an ADOPT/COND/**REJECT** verdict, a slow-frame decision tree, and a top-15 ranked for this game |
| 22 | `22-BUG-BOUNTY.md` | 24 | **DELIVERED** — first UX bug-bounty run: 10 defects found and fixed (2 of them made the game unplayable on a LAN origin), 10 filed with repro, and the re-test protocol |

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
| **D5** | **No screenshots** | Acceptance stays numeric/geometric; the user's eye is the final "WoW" gate (E3) |
| **D6** | **Evidence discipline** | Every number tagged `[M]/[E]/[T]/[R]/[J]`; untagged numbers are deleted |
| **D7** | **Single canvas by default** | The second canvas needs `alpha:true` on the game canvas → full-screen compositor blend; mobile is GPU-at-bake-time only. Mode B is a **desktop experiment** |
| **D8** | **Resolution before features** | Fixed shed ladder; tier-that-deletes-art comes last; p95/p99 + jank ratio, never average FPS |
| **D9** | **Cadence beats rate** | Locked cadence at the platform's granted rate; no 120 promise, no fake 120 (identical on sample-and-hold); worker-clock 120 is M7 |
| **D10** | **Sample time, interpolate state** | Clips/eases/camera/parallax sampled at render time (free 120); physics interpolated (+1 frame, ≤16.7 ms total latency budget); never lerp joint positions |
| **D11** | **Natural motion is code** | Minimum-jerk + 2/3 power law + spring chains + aperiodic life; 0 MB, 0 blits, 0 assets; ships as **M4.5** in parallel with the sky work |

## Execution order (authoritative version: `08-ROADMAP-TASKS.md`)
1. **M0.5** — fix the 8 combat/anim test failures → **244/244** (triage in `DECISIONS.md` D4).
2. **M1** — pure logic first: profile schema + picker (`M-AXES` 10k seeds), canvas
   ledger, quality ladder state machine, `scripts/bench-render.mjs`, boundary lint.
   No pixels change in M1.
3. **M2** — GPU **bake** pipeline: WebGL2 context, 16³ LUT, sky plate → readback →
   canvas. P8 gate (ΔE ≤2). Zero uploads per frame.
4. **M3** — cumulus (2 warp levels × 4 octaves) → stratus → cirrus, with coverage
   probes; integer-offset drift (P2).
5. **M4** — one light model, baked rakes + shear-at-draw, player-reactive rim,
   moon variants. **M5** — weather state machine + LUT cross-fade. **M6** —
   mobile tier ladder, `?bench=1` percentile harness, device report.
6. **M4.5 (parallel, `20`)** — natural motion: minimum-jerk shaping, 2/3 power law
   arcs, spring secondary chains, aperiodic micro-life, sub-frame contacts. Zero
   assets, zero memory, highest fidelity-per-byte. Starts right after M0.5.

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
