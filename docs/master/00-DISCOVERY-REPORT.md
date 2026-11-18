# 00 — PROJECT DISCOVERY REPORT
**Phase 1 output.** Evidence base: direct inspection of the repository at `5b874fc`
plus executed measurements (§5). No assumptions carried over from the mandate.
**Nothing was modified to produce this report.**

---

## 0. Executive summary (the five things that reframe the mandate)

1. **There are no shaders.** The project is a hand-written **Canvas2D** renderer
   with **zero** image assets. Every "shader technique" in the mandate (fBM, LUT
   blending, noise textures, pipeline states) has to be re-expressed as
   **bake-time procedural generation into offscreen canvases** + per-frame blits.
   This is already the established architecture and was chosen deliberately.
2. **There is one level, not many.** `LevelId = 'rooftop'` is a single-valued type.
   No scene files, no level configs, no loading pipeline. "Distinctive graphics
   for every level" is therefore either (a) new stages to build, or (b) a
   **per-run environment profile** on the one stage. That is a scope decision, not
   an implementation detail (§8, S1).
3. **The game is keyboard-only.** `input.ts` binds `keydown`/`keyup`; there is **no
   touch, pointer, or gamepad** handling anywhere in `src/`. "Mobile-first" today
   means only *performance* (DPR governor + quality tiers). Playable mobile needs
   an input layer that does not exist (§8, S2).
4. **The art is 100 % procedural code.** `public/` contains `logo.svg` and
   `robots.txt` — nothing else. All city, moon, clouds, props and HUD art is drawn
   by TypeScript at bake time. This is an asset-free pipeline: excellent for load
   time, unusual for a graphics overhaul, and it means "texture compression /
   atlasing" translates to *canvas budget management*.
5. **The project is large and mature.** `src/game` is **32,821 LOC across 65
   files**, guarded by **47 test files** (244 tests, 236 passing / 8 pre-existing
   failures). A graphics overhaul must *not* disturb the combat/anim determinism
   those tests protect (Rule 10).

---

## 1. Current architecture

| Area | Reality |
|---|---|
| Runtime | **Next.js 16.4.6** (App Router) + **React 19.3.1** + **TypeScript 6.0.3**, `tsx` for tests |
| Game engine | **Custom**, no game library. `src/game` — 65 files, 32.8k LOC |
| Rendering | **Canvas2D**, one `<canvas>` (`page.tsx:273`), CSS-pixel coordinate space with DPR scaling |
| Render entry | `Game.frame()` → `Renderer.draw()` (`src/game/render/renderer.ts`, 126 LOC) |
| Background | `CyberBackground` (`world/background.ts`, **3,285 LOC** — the monolith), contract: `drawSky / drawArena / drawWeather` + optional reactive hooks |
| Camera | Custom `Camera` (`core/camera.ts`, 134 LOC): tracking, look-ahead, zoom, trauma shake, `snapTo` |
| Physics/motion | `physics/`, `anim/` (skeleton, clips, arc solvers, IK) — 20+ files |
| Combat | `combat/` — moveset 2,387 LOC, attacks 1,921 LOC, hit-resolution |
| FX | `fx/fx.ts` 1,556 LOC (pooled particles, trails, impact frames) |
| Audio | `audio/audio.ts` 894 LOC — fully synthesised WebAudio, no files |
| UI/React | `src/components/ui` (48 shadcn-style files, 5.4k LOC) + `page.tsx` |
| Persistence | `lib/persistence.ts` — zod-validated `GameSettings` in localStorage |
| Deliberately removed | shaders, WebGL, render targets, live light rigs, `mountain-gl/`, lighting engines (see git history `7478384`) |

### 1.1 Rendering pipeline (actual order, `Renderer.draw`)
```
1  bg.drawSky()            screen-space: vault cache (stars/milky way/deep/far/mid/near,
                                        moon+corona, clouds, aurora, fog plane) + shooting star
2  world transform         translate(w/2,h/2) · rotate(cam.rot) · scale(zoom) · translate(-cam)
3  bg.drawArena()          arena tile frustum blit + lamp sprite + door sprite + door pool
4  props.draw()            1 blit per visible prop (body + baked mirror in one canvas)
5  ground()                directional contact shadow, 2 fills per figure
6  fx.drawUnder()          ground decals/debris
7  enemies.draw()
8  fx.drawSilhouettes()    echoes
9  player.drawStrikeSmear() / player.draw()
10 bg.drawPlayerLight()    reactive rim + deck pool (V3)
11 projectiles.draw()
12 fx.drawAdditive()       lights, trails, particles
13 fx.drawImpactFrames()   manga spikes
14 restore → bg.drawReflections()  1/8-scale framebuffer band, 3 slices (V3)
15 bg.drawWeather()        rain → lightning tint → vignette plate
16 fx.drawFlash()          hit flash
17 hud.draw()              baked plates + live text
18 inspect.draw()          debug overlay (dev)
```

### 1.2 Existing light / shadow / reflection inventory
* **Baked (zero per-frame):** 21 plates (documented in `LIGHT-SHADOW-V3.md` §1.1),
  emissive discs + spill, cast-shadow rakes, contact AO, flipped reflections for
  lamp/door/hardware, moon disc + corona, film grade, vignette.
* **Live:** door-pool breathing alpha, lightning tint, reflection band (×1.6 on
  lightning), player rim + deck pool, 2-fill contact shadows, rain, vignette blit.
* **Missing vs mandate:** three *distinct* cloud systems (there is one drifting
  cloud tile), time-of-day, weather-driven grading (grade is baked per palette),
  per-level environment profiles, LUTs, shadow projection *for rooftop objects*
  beyond baked rakes, cloud coverage/density controls, any mobile layout.

### 1.3 Level / scene structure
```
GamePhase: attract → playing → paused → gameover
Run:      1 arena (ARENA_X0 -150 … ARENA_X1 2750, play band y 0..150)
Waves:    WaveDirector — escalating horde, boss every 5, intermission banners
Identity: per-run seed → moodIndexForSeed → 4 palettes (NEON NOIR / ACID RAIN /
          EMBER CITY / ULTRAVIOLET) drives skyline, props, HUD badge
```
**No `loadLevel()`. No transitions. No per-stage configuration object.** `bgLevel`
exists (`game.ts:169`) but every branch on it is currently trivial.

---

## 2. Existing rendering capabilities (what already works, do not rebuild)

| Capability | Where | Notes |
|---|---|---|
| 7-plane paraxial city ladder | `background.ts` `LAY_*`, `drawCityBand` | linear-ish factors `.015 … .30` |
| Sky vault cache | `render/bhst.ts` `SkyVaultCache` | sky art re-blitted only on rebuild |
| Frustum-sliced tile blit | `bhst.ts` `blitWorldFrustum` | avoids drawing the whole 2900 px tile |
| Seeded procedural art | `mulberry32` + 4 XOR seeds | identical art per seed, different per run |
| Baked 3D key + AO + shadows | `bake3DKey`, `bakeCastShadows`, `bakeSpill` | on facades |
| Temperature/quality noise | `NEUROAESTHETIC-UPGRADE.md`, `mood.ts` | 60/30/10 palettes |
| Storm engine | `world/storm.ts` | rain banks, splashes, strikes, intensity; budgets 96/180/288/288 |
| Reflection band | `drawReflections` | 1/8 downscale, 3 slices, tier-gated at `low` only |
| Reactive player light | `practicalLight` + `drawPlayerLight` | 300 px falloff from 2 practicals |
| DPR governor | `game.ts govern()` | 0.8–2.0 DPR, tier fallback, 12 s raise cooldown |
| Perf readout | `game.ts` frame metrics | JS vs residual wait, live |
| 244 tests | `tests/*.test.ts` | combat, motion, FX, HUD layout, storm |

---

## 3. Dependencies

**Runtime:** React 19, Next 16, zod, zustand, framer-motion, shadcn/radix (UI only —
none in the render path). `next-auth`, `socket.io`, `z-ai-web-dev-sdk` present for
app scaffolding but **not referenced by the game renderer**.
**Dev:** `@napi-rs/canvas` (headless art scripts in `.qa/`, `scripts/`),
`tsx`, `eslint`, `typescript`.
**Rendering third-party deps in the draw path: none.** This is a strength: the
frame budget is our own code plus `drawImage`.

---

## 4. Technical limitations (constraints the plan must accept)

| # | Limitation | Consequence |
|---|---|---|
| C1 | **No shader stage.** Canvas2D only. | All noise/LUT/cloud work happens at bake time on CPU, or as pre-baked plates. |
| C2 | **No depth buffer.** | No depth fog, no soft particles, no depth-aware occlusion. Must fake with per-layer alpha + bake-time masks. |
| C3 | **One canvas, no render targets** (decision, not accident). | Reflections must sample the framebuffer or be redrawn from sprites. |
| C4 | **Framebuffer sampling is a suspected readback cost** (`LIGHTING-RESEARCH-V4.md` R1). | Must be measured before scaling; fallback designed. |
| C5 | Single environment type. | "Per level" identity needs new authored stages or profiles. |
| C6 | Keyboard-only input. | Mobile playability is out of reach without new work. |
| C7 | Monolithic files (`background.ts` 3,285; `player.ts` 5,303). | Every visual change lands in a 3k-line file → merge/review risk. |
| C8 | No screenshot/visual regression capability in this environment. | Acceptance must be numeric/geometric, or by the user's eye. |

---

## 5. Measured baseline (executed, this environment)

Method: strict stub `CanvasRenderingContext2D` with real `drawImage` argument
checking; 1280×720 viewport; seeds fixed. **CPU only — no GPU/raster timing is
possible in this sandbox.**

| Metric | Value | Scope / caveat |
|---|---|---|
| Resident canvas memory | **30.1 MB background + 0.2 MB props = 30.3 MB** | walk of live object graph (`__perf` style), excludes GC-able bake scratch |
| Cold bake (first build) | **20.4–25.7 ms** | includes module warm-up; stub canvas (real canvas is slower) |
| Warm re-bake (new run seed) | **9.6 ms mean** (8.8 / 9.4 / 10.6) | same stub |
| Frame blits, `low` | **8** (5 `source-over`, 3 `lighter`) | sky+arena+playerLight+reflection(off)+weather |
| Frame blits, `medium`/`high`/`ultra` | **11** (5 / 6) | tiers currently identical above `low` (finding F4) |
| Canvas objects, background | 37 | |
| Tests | 244 total, **236 pass, 8 fail** | 8 failures pre-exist `d93cd95`; not yet triaged |
| Image assets | **0** | all art procedural |

**Correction to earlier reporting:** "41.6 MB" in the V3 note counted *all canvases
ever allocated* (including transient bake scratch). **Resident is 30.3 MB.** The
distinction matters and the harness must be explicit about which it prints.

---

## 6. Performance bottlenecks (ranked by expected impact, evidence-based)

| Rank | Suspect | Evidence | Status |
|---|---|---|---|
| 1 | **Framebuffer reflection readback** | R1 in research doc; Chromium slow path + a 0.9 fps Canvas2D case study | **unmeasured in our build** → Phase 0 E1 |
| 2 | Additive (`lighter`) blit batching | 6 of 11 blits are additive; literature warns about composite-op batching | E4 |
| 3 | `high`/`ultra` tiers buy nothing | only `low` differs (F4) | tier ladder in V4 |
| 4 | Bake cost on every run start | 9.6 ms warm, 20 ms cold, all on the main thread | matters for mobile run-restart |
| 5 | Storm rain overdraw | 288 drops at ultra, drawn as strokes | existing budgets; unmeasured on device |
| 6 | Big-file edit risk | 3,285-line background | engineering, not frame time |

---

## 7. Opportunities (highest value first)

1. **Environment profile system** — the missing abstraction that makes "distinctive
   levels", weather-driven grading and moon response possible without new stages.
2. **Three cloud systems as baked variants** — cumulus/stratus/cirrus plates +
   integer-offset drift; cheap on mobile, richer at ultra.
3. **Rooftop-object shadow projection** — extend the existing bake-time rake to
   authored objects (tanks, antennas, rails) and to *dynamic* props.
4. **Baked LUT grading** — grade is currently baked into each plate; a LUT applied
   at bake time per profile gives weather/time-of-day response for free.
5. **Tier ladder that means something** — mobile low must stay *identifiable*, not
   just cheaper.
6. **Monolith decomposition** — split `background.ts` into renderer + bakers +
   profiles before adding three cloud systems to it.

---

## 8. Areas that must NOT be modified

| Area | Why |
|---|---|
| `combat/`, `anim/`, `physics/`, `entities/player.ts` motion math | 47 test files / 244 tests encode determinism; 8 failures already unresolved |
| `input.ts` edge ownership | `input-edge-ownership.test.ts` |
| `game.ts` loop error handling & governor hysteresis | the "loop stops on error" path saved the app during the V3 crash |
| Persisted settings schema additive-only | users' saved settings must not be invalidated (`persistence.ts` zod) |
| Existing palette/mood identity | user-approved art direction |
| Camera feel (`snapTo`, trauma) | hand-tuned |

---

## 9. Missing information & assumptions

| # | Missing | Assumption used | How to close |
|---|---|---|---|
| M1 | Real GPU/raster timings | none — numbers above are CPU/stub | device testing (Phase 21); needs a browser the sandbox lacks |
| M2 | Real mobile thermals/battery | none | device testing |
| M3 | Player preference data | none — no fabricated feedback | Phase 23 plan, user play-testing |
| M4 | Whether "levels" means new stages | treated as **decision S1** | user answer |
| M5 | Whether mobile playability (touch) is in scope | treated as **decision S2** | user answer |
| M6 | Whether WebGL may return for a confined layer | treated as **decision S3**, default **no** | user answer |

### Decisions required before Phase 6/7 can be finalised
* **S1 — Level identity:** (a) per-run environment *profiles* on the one rooftop
  stage (fast, preserves gameplay, still gives 4+ distinct looks), or (b) build
  **2–3 real stages** (rooftop + street + docks) with their own geometry
  (10× the art work, new collision/camera concerns).
* **S2 — Mobile:** (a) performance-only mobile-first (tiers, budget, DPR), or
  (b) full mobile product (touch controls, layout, safe areas, battery).
* **S3 — Shaders:** confirm Canvas2D-only, or allow one *confined* WebGL layer for
  clouds? Default per established architecture: **Canvas2D only**.

---

## 10. Recommended investigation priorities

1. **Phase 0 experiments E1–E6** (from `LIGHTING-RESEARCH-V4.md` §4) — the reflection
   readback question gates the entire atmosphere/reflection roadmap.
2. **Environment profile abstraction** (Phase 7 A/B) — blocks clouds, grading,
   time-of-day, per-level identity.
3. **Committed harness** (`scripts/bench-*`) — every claim after this point must be
   reproducible; today it is not.
4. **Cloud feasibility prototype** (Phase 14) — three systems baked into tiles:
   confirm silhouette quality at 60 fps-tier budgets.
5. **Shadow projection prototype** for rooftop objects — the mandate's most
   visible dedicated feature after clouds.

---

## 11. Verification of this report

Every claim above is traceable to a file path, a command, or a measurement in §5.
Commands used: `package.json`/`src` inventory, `wc -l`, targeted greps for
`LevelId`, `keydown`, `touch`, `quality`, `govern`, `drawReflections`;
`node --import tsx` baseline + resident-memory harnesses (strict stub ctx).
No file in `src/` was changed.
