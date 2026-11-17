# LIGHT · SHADOW · REFLECTION — V4 PLAN
### "Plan more, then plan again" edition
**Status:** planning only. Nothing in this document has been built yet.
Baseline it plans from: `49cfb88` (V3 pass, live).

Companion docs:
`docs/PREBAKED-WORLD-PLAN.md` · `docs/NEUROAESTHETIC-UPGRADE.md` · `docs/LIGHT-SHADOW-V3.md`

> **RESEARCH ADDENDUM (read first): `docs/LIGHTING-RESEARCH-V4.md`.**
> An evidence pass over Canvas2D, reflection, parallax, fog and accessibility
> literature changed this plan in seven places. The important one: the V3
> reflection pass samples the **framebuffer** every frame, and canvas→canvas
> `drawImage` can be a synchronous GPU readback. So a **Phase 0** was added to
> prove that cost before any V4 feature is built, with a no-readback
> "silhouette mirror" fallback. Also revised: `L8` (two-level damp/pool mask),
> `L11` (+ entity flipped mirrors), new `L15` (logarithmic parallax + tier
> culling), new `L16` (WCAG flash budget), new `L17` (compositing ledger).

---

# 0. Purpose

V3 proved the architecture: **bake the world, react with a handful of blits, and
run the only post-processing as a 1/8-scale screenshot of the deck.** V4 is the
plan for going *deeper* on light, shadow and reflection **without** reopening the
door to engines that were deliberately killed (shaders, WebGL light transport,
live render targets, readback, full-res SSR, per-frame gradients, per-frame
allocations).

The mantra for every line below:

> **If it can be baked, bake it. If it must move, blit it. If it must think,
> measure it once per frame, never per object.**

---

# 1. Audit — what actually exists at `49cfb88`

## 1.1 Baked inventory (zero per-frame cost)

| # | Plate | Built by | Draw cost | Notes |
|---|---|---|---|---|
| 1 | Sky strip + gradients | `buildSkyStrip` | 1 blit + fills | inside `skyVault` cache |
| 2 | Star field + milky way | `buildStarTile` | tiled blits | 2048×`STAR_H` |
| 3 | Moon disc | `buildMoon(pal)` | **1 blit** @210 px | 512² plate, gibbous + 16 craters |
| 4 | Moon corona | `buildMoonHalo(pal)` | **1 blit** additive @402 px | 4 rings + 6 rays + streak |
| 5 | Cloud deck | `buildCloudTile` | 3 tiled rows | drifting alpha |
| 6 | Aurora sheet | `buildAuroraTile(pal)` | tiled blits | palette-tinted |
| 7 | Deep city | `buildDeep` | 1 row | soft plate @1/8 |
| 8 | Far city | `buildFar` | 1 row | soft plate @1/6 |
| 9 | Mid city | `buildMid` | 1 row | soft plate @1/3 |
| 10 | Near city | `buildNear` | 1 row | crisp |
| 11 | Fog plane | `buildFogPlane` | tiled | parallax .098 |
| 12 | Arena tile | `buildArena` | 1 frustum blit | lip + deck + fall wall + **V3 shadows/hardware/mirrors** |
| 13 | Streetlight sprite | `buildLampProp` | **1 blit** | broken pole, palette rim |
| 14 | Stairwell sprite | `buildDoorStructure` | **1 blit** | warm practical |
| 15 | Door pool | `buildDoorPool` | **1 blit** additive | breathes + lightning |
| 16 | Emissive discs | `buildGlowDisc` ×5+7 | on bake only | spill sources |
| 17 | Rim warm / rim cool | `buildRim(pal)` | ≤1 blit | reactive player key |
| 18 | Deck pool | `buildDeckPool` | ≤1 blit | reactive under feet |
| 19 | Vignette | `buildVignettePlate` | **1 blit** | per-viewport, cached |
| 20 | Prop sprites (6) | `props.ts makeSprite` | 1 blit each (≤3 alive) | body+mirror in one canvas |
| 21 | HUD prop legend | `hud.ts drawPropLegend` | 1 blit | baked plate |

## 1.2 Live per-frame lighting (the whole list)

1. `Game.govern()` — DPR + tier governor (already exists, already good).
2. `CyberBackground.drawReflections()` — 1 downscale + 3 flipped slices.
3. `CyberBackground.drawPlayerLight()` — rim + deck pool, alpha from proximity.
4. `drawArena` — door pool breathing alpha, `lightningI()` modulation.
5. `Renderer.ground()` — 2 ellipse fills per figure (directional since V3).
6. `drawWeather` — rain, lightning tint, vignette blit.

**Frame budget today (synthetic, 1280×720):** 11 blits measured through
sky+arena+reactive+reflection+weather; **bake 12.7 ms**, **re-bake 6.9 ms**;
**41.6 MB** of canvas memory; reflection buffer ~8 KB.

## 1.3 Findings the plan must absorb

| Finding | Where | Consequence |
|---|---|---|
| **F1** Practical world-x values are hard-coded as literals inside `PropField.pickX` (`1755`, `830`) *and* as constants in `background.ts` (`DOOR_X`, `LAMP_X`). | `props.ts`, `background.ts` | Any new practical silently breaks prop clearance. **V4 must centralise.** |
| **F2** `drawReflections` maps the deck band **axis-aligned in screen space**, ignoring `cam.rot`. | `background.ts` | During trauma shake the mirror stops matching the deck. Small, but it is *wrong*, not stylistic. |
| **F3** The reflection band spans the **full viewport width**, including world space beyond `ARENA_X0..ARENA_X1`. | `background.ts` | Outside the arena it reflects black — harmless today, blocks future wide sets. |
| **F4** The governor comment promises "reflection density scales with tier", but only `low` skips reflections. | `game.ts`, `background.ts` | Tiers `medium/high/ultra` are visually identical for the new passes. |
| **F5** Canvas memory (41.6 MB) is dominated by the four full city tiles; blur duplicates are gone but the tiles themselves are 2048 px wide at full height. | `background.ts` | Next memory win needs a tile-resolution plan, not deletion. |
| **F6** `makeCanvas` is unaccounted — no runtime inventory of what we allocated. | `background.ts` | Cannot hold a memory budget without it. |
| **F7** No committed harness: the benches (`bench3.mts`, `smoke4.mts`, `propsim.mts`) live in `/tmp`. | /tmp | **Every future claim is unrepeatable.** Phase 1 must commit them. |

---

# 2. The three budgets (V4 is judged against these)

| Budget | Ceiling | Measured by | Enforcement |
|---|---|---|---|
| **Frame blits** | ≤ 24 at `high`, ≤ 30 at `ultra`, ≤ 12 at `medium`, ≤ 6 at `low` | stub ctx counter in committed bench | governor tier + code review |
| **Canvas memory** | ≤ 34 MB resident at 1280×720 (from 41.6) | `makeCanvas` accounting in bench | per-plate table reviewed in PR |
| **Bake time** | ≤ 16 ms first, ≤ 12 ms re-bake | committed bench, synthetic ctx | if exceeded, plate is downscaled or split |
| **Live allocations** | exactly 0 per frame | smoke test asserts `ctx.calls` stable + no `new` in draw paths | review + smoke |

A feature that breaks a budget does **not** ship with an exception comment. It
ships at a lower tier or not at all.

---

# 3. Design principles (inherited, restated because they keep getting tested)

1. **Baked-first.** A light that never moves is a texture, not a system.
2. **Reactive = blits of baked art, keyed by ONE sample per frame.** "Reacting to
   the player" means *the player's position is read once and multiplies an alpha*,
   never that lights are re-solved.
3. **The wet deck is the only post.** One reflection pass, downsampled, slice-faded,
   tier-scaled. No bloom pass, no blur pass, no colour-grade pass at runtime.
4. **One hero per plane.** Berlyne: complexity with hierarchy beats noise.
5. **60/30/10.** Desaturated cool field, warm highlight, isolated saturated pops.
6. **Measure before claiming.** No "faster" without a number from a committed bench.

---

# 4. Initiatives

Each initiative: **intent → seam → technique → cost → risk → acceptance.**
`P0` = must have for V4, `P1` = should have, `P2` = backlog.

---

## L1 · `practicalLight` becomes a data table  · P0
**Intent:** more practicals without more special-casing; fixes **F1**.
**Seam:** new `src/game/world/practicals.ts`; consumed by `background.practicalLight`,
`props.pickX`, and a new `Serializer`-free `PRACTICAL_CLEARANCE` export.
**Technique:** one frozen array —
```
{ x, y, color, range, height, kind: 'lamp'|'door'|'sign'|'barrel'|'vending' }
```
`practicalLight(x)` loops ≤8 entries with `|x - p.x| >= p.range ? 0 : 1 - d/range`
and keeps the **two strongest** (needed for the warm/cool rim mix). `props.pickX`
imports the same array for clearance instead of literals.
**Cost:** ≤8 subtractions per frame. No allocation (returns a reused object).
**Risk:** rim mixing order changes existing look — gate behind a constant, tune.
**Acceptance:** props never spawn inside any practical's clearance, proven by the
committed prop sim over 5 seeds × 120 s; `practicalLight` returns the same values
as today for `x = 1755 / 830 / 1300`.

---

## L2 · Three new authored practicals  · P0
**Intent:** the deck stops being lit by exactly two sources; empty stretches get
their own identity. Directly answers "feel the empty space".
**Seam:** `buildArena` dressing + `L1` table + new bake funcs.
**Technique:** all three are **static sprats baked into plates**, no live state:
1. **Vending machine** (x≈480): cold palette front panel, baked spill disc, coin
   slot LED, its own mirror strip. Body 44×86 at deck line.
2. **Fire barrel** (x≈2320): warm flicker is *baked* as 3 stacked glow discs with
   different alphas; live "flicker" is **one alpha on one pre-baked plate** —
   `0.85 + 0.15·sin(t·7.3)` — not new art.
3. **Neon shop sign** on the fall wall (x≈1350): tube art + spill + drip reflection.
**Cost:** +1 blit (barrel glow), +0 on the other two (in tile). Bake +≈1.2 ms.
**Risk:** clutter vs. 60/30/10 — barrel is parked *outside* the main fight lane so
it never competes with an enemy cluster.
**Acceptance:** blit budget holds; every practical appears in the light table; prop
clearance respects all five.

---

## L3 · Enemy + prop keyed rim lights  · P1
**Intent:** "responds to players position **and other things**" — the same light
logic should notice enemies and freshly-broken props.
**Seam:** `Renderer.draw` (enemies loop), `PropField.draw`, reuse `rimWarm/rimCool`.
**Technique:** for enemies, only when within a practical's range (a per-enemy
`practicalLight` sample is 8 comparisons — acceptable for ≤8 on-screen enemies,
but **cache the result on the enemy for 0.15 s** so the loop cost is amortised).
Props get a **static** baked rim already; add a one-frame additive flash plate on
break (reuse the prop sprite's own glow layer, 1 blit, 0.12 s).
**Cost:** ≤8 blits worst case, 0 most frames.
**Risk:** rim soup → cap at 4 rims per frame, nearest-first.
**Acceptance:** frame with 8 enemies near two practicals stays ≤ budget; rim count
instrumented in the bench.

---

## L4 · Moon phase + orbit as a run property  · P0
**Intent:** the moon is the sky's hero; right now every run's moon is the same
gibbous at the same size.
**Seam:** `mood.ts` (add `moonPhase` to the run roll), `buildMoon(pal, phase)`,
`drawSky` moon block.
**Technique:** **3 baked variants** (crescent / gibbous / full) selected per run by
an avalanche hash of the seed, each with its own corona intensity (crescent =
stronger halo, full = flatter). Drawn at 190–230 px varying with phase.
Additionally, a slow **orbit** already exists (`sin(t·0.021)·46`); add a matching
**parallax-on-halo** offset so the corona drifts 30 % of the disc offset — 0 extra
blits, reads as atmosphere rather than a sticker.
**Cost:** bake ×3 variants = +~4 ms **only** if all three are built; build **one**
per run (phase is a run property) → net 0.
**Risk:** phase changes silhouette contrast — keep the palette rim on all three.
**Acceptance:** 10k seeds distribute ~1/3 per phase (same avalanche test as palettes).

---

## L5 · Rotation-correct reflection  · P0 (correctness)
**Intent:** fixes **F2**.
**Seam:** `drawReflections`.
**Technique:** the *capture* stays axis-aligned (it must read screen pixels).
The *write-back* wraps the three slices in the same rotation the world pass used:
`translate(w/2,h/2) · rotate(cam.rot) · translate(-w/2,-h/2)`, so the band tilts
with the deck. Because the reflection is already a blur, the extra rotation is
visually free.
**Cost:** 0 additional blits (same 3, inside a transform).
**Risk:** at large `cam.rot` the band's corners leave the canvas — clamp by
clipping to the deck's screen polygon (1 `clip()` per frame, cheap).
**Acceptance:** at `rot = ±0.06` the band's centre line matches the deck's painted
line within 1 px (asserted geometrically in the smoke test, no screenshot needed).

---

## L6 · Arena-masked reflection  · P0 (correctness)
**Intent:** fixes **F3**.
**Seam:** `drawReflections` (+ a 1×N baked x-mask or a world→screen x clamp).
**Technique:** compute the arena's screen x span from `ARENA_X0/ARENA_X1` and pass
it as the dst rect instead of `0..w`. No mask canvas needed.
**Cost:** 0. **Risk:** none. **Acceptance:** reflection stops exactly at the arena
end caps; verified by capturing the bb of drawn dst rects in the bench.

---

## L7 · Reflection quality ladder  · P0
**Intent:** fixes **F4** — tiers must actually differ.
**Seam:** `drawReflections(quality)` + `Game.govern` (already steps tiers).
**Technique:**

| Tier | downscale | slices | ripple | extra |
|---|---|---|---|---|
| low | — (off) | — | — | — |
| medium | 1/12 | 2 | no | — |
| high | 1/8 | 3 | yes | — |
| ultra | 1/6 | 4 | yes | + vertical smear slice |

**Cost:** ultra ≈ 6 blits, medium ≈ 3. **Risk:** tier thrash while the governor
oscillates — the governor already has 4 s cooldowns.
**Acceptance:** bench prints blits per tier; monotonic increase.

---

## L8 · Puddle mask on the reflection  · P1
**Intent:** the deck should not be uniformly a mirror — real concrete is wet in
*puddles*, dry elsewhere. This is the single biggest believability upgrade left
in the reflection path.
**Seam:** `buildArena` (bake a `wetMask` plate, same size as the deck band),
`drawReflections` (one `destination-in` on the small buffer).
**Technique:** bake a greyscale-ish alpha plate: 5–7 elliptical puddles + long
gutters along the seams, feathered. At 1/8 scale the mask is ~200×14 — apply it
to the **buffer** (`destination-in`), so the cost is one small blit, and the
reflection simply doesn't exist where the concrete is dry. The baked static
mirrors (door/lamp) stay full-length: they are the "always wet" hero puddles.
**Cost:** +1 small blit. **Risk:** too few puddles = flickery pop-in as objects
cross edges → feather 40 %.
**Acceptance:** coverage of the mask is 45–65 % of the band (measured by alpha
sum in the bench), so the deck still reads wet without being a lake.

---

## L9 · Moon glitter path on the deck  · P1
**Intent:** the moon is the brightest source; its deck response should be the
most beautiful thing on the ground.
**Seam:** `drawArena` (already has the V3 specular column) → promote to a live
1-blit "glitter" strip: pre-bake 3 phases of a sparkle strip (dots of varying
size), cycle them on `t`, alpha keyed to `moonCover`.
**Technique:** three 128×96 plates, one blit each frame at the column base with
`(t*3|0)%3` selection and additive alpha. No per-frame gradient, no per-spark maths.
**Cost:** 1 blit. **Risk:** sparkle reads as noise → keep 8–12 dots, 2 px max.
**Acceptance:** blit budget; sparkle plates ≤ 3 × 128×96 = 147 KB.

---

## L10 · Clouds occluding the moon (live, free)  · P1
**Intent:** the moon currently sits *in front of* the cloud deck; a real moon is
eaten by it.
**Seam:** `drawSky` cloud rows → draw **one** of them again *after* the moon with
`globalAlpha = 0.35 · cloudDensity`. `moonCover` already exists as a stub.
**Technique:** re-blit one existing cloud row (already resident) over the moon
disc only — clip to a 220 px circle to avoid touching the rest of the sky. Set
`moonCover` from the same sample so `L9` glitter dims with it.
**Cost:** 1 blit + 1 clip. **Risk:** clip cost on some GPUs → alternative: draw
the cloud row masked by a pre-baked radial alpha plate (1 blit, no clip).
**Acceptance:** `moonCover` moves in [0,1] over 60 s of `update()`; glitter alpha
correlates.

---

## L11 · Entity shadow atlas instead of ellipse fills  · P2
**Intent:** contact shadows are currently two mathematically drawn ellipses per
figure. A baked directional shadow reads better and is cheaper.
**Seam:** `Renderer.ground`, new `buildShadowSprite()` in background, exposed
through the optional interface like `drawPlayerLight`.
**Technique:** one 96×40 baked plate: soft penumbra + darker core, leaning
lower-left, palette-tinted. Blit with `dw` scaled by height and alpha by height.
Player + enemies share it (1 blit each vs 2 fills each).
**Cost:** same or fewer ops. **Risk:** stretch artefact at large figures → cap
`dw ≤ 2.2×` base.
**Acceptance:** visual parity claim is *not* possible without screenshots — treat as
a taste change, ship behind a constant.

---

## L12 · Bake accounting + memory budget enforcement  · P0
**Intent:** fixes **F6**; makes the 34 MB target checkable.
**Seam:** `makeCanvas` (dev-only counter), new `scripts/bench-render.mjs`.
**Technique:** `makeCanvas` increments `globalThis.__bgStats = { canvases, bytes }`
when a debug flag is set; the bench prints a **per-plate table** (name, size, KB)
by tagging each builder. Then decide the next cut *with data*, likely:
- `nearTile` at 3/4 resolution scaled up (it is mostly silhouette + rim glints),
- `midTile` soft plate already downscaled — its **sharp** copy only exists for
  lightning frames (currently built for every run) → build lazily on first bolt.
**Cost:** dev only. **Risk:** none in prod. **Acceptance:** table committed in the
doc; resident ≤ 34 MB.

---

## L13 · Commit the harness  · P0
**Intent:** fixes **F7** — the numbers in V3 came from `/tmp` and cannot be rerun.
**Seam:** `scripts/bench-render.mjs`, `scripts/bench-props.mjs`,
`scripts/smoke-render.mjs`, npm scripts `bench:render`, `bench:props`, `smoke`.
**Technique:** port the three existing `/tmp` harnesses with fixed seeds, strict
stub `drawImage` that throws on non-canvas sources, blit ledger, per-tier sweep,
geometry assertions from L5/L6/L8. Output is a **table** appended to the docs by
hand (no auto-write, so the doc stays honest).
**Cost:** ~250 LOC of test-only code. **Risk:** stub drift from real canvas —
mitigate by keeping the strictness (throws) rather than the fidelity.
**Acceptance:** `npm run bench:render` reproduces V3's row exactly.

---

## L14 · Split-tone reflection tint (tier-gated)  · P2
**Intent:** the reflection currently carries the frame's own colour. A **cool**
tint on the mirror sells "wet at night" and matches the adult split-tone law.
**Technique:** pre-bake a 1×64 vertical gradient tile per palette; blit it over the
band with `source-atop` on the **buffer** (small, cheap) — 1 extra small blit.
**Cost:** 1 small blit. **Risk:** must not grey out the neon reflections that sell
the teen register → tint alpha 0.18 max, and never touch the two hero mirrors.
**Acceptance:** bench alpha sum stays within ±5 % of L8's coverage.

---

## L15 · Logarithmic parallax ladder + tier culling  · P1
**Intent:** research (5-layer pipeline study) reports +38 % perceived depth and
recommends logarithmic depth scaling and adaptive culling. Our seven factors
(`.015 .032 .045 .065 .098 .14 .30`) are bunched at the far end.
**Seam:** `LAY_*` definitions in `background.ts`; tier gating in `drawSky`.
**Technique:** `f_i = f_max · (f_min/f_max)^(i/(n−1))` across the six planes below
the hand-tuned near plane (`.30` stays pinned). At `low`, cull the two deepest
planes instead of drawing them at 0.015/0.032.
**Cost:** zero blits (same count), fewer at `low`. **Risk:** backdrop feel changes —
ship behind a constant, compare both ladders in the same session.
**Acceptance:** consecutive ratios log-uniform ±12 %; `low` draws ≤5 planes.

## L16 · WCAG flash budget  · P0 (safety, not polish)
**Intent:** V3 already stacks lightning tint + reflection boost (×1.6). Research is
unambiguous: **≤3 opposing luminance events per second**, and the general flash
threshold is a **10 %** relative-luminance change with the darker state under 0.80.
**Seam:** `lightningI()` consumers, `fx.drawFlash`, `drawReflections` boost, a new
`FlashLedger` in the game loop; settings toggle in `persistence.ts`.
**Technique:** one small ledger object — timestamped `kind` + `delta` entries —
that every luminance event must pass through. It (a) rate-limits to 3/s,
(b) clamps full-screen deltas to ≤0.10, (c) is disabled-adjacent to a new
**reduced-motion** setting that also kills ripple drift, glitter cycling and trauma.
**Cost:** ≤8 pushes/s, zero draw cost. **Risk:** lightning feels softer — that is the
point; scale the *area* of the flash, not its peak.
**Acceptance:** harness replays a storm's worth of events and asserts ≤3/s and
≤10 %; the reduced-motion path produces 0 events.

## L17 · Compositing ledger  · P1
**Intent:** answer "is this pass soup?" with a number, and test the research claim
that additive composite ops can hurt batching in tight loops.
**Seam:** `Renderer.draw` (dev-only counters), harness output.
**Technique:** count blits per composite op per frame and total additive alpha
mass; print in the bench, log a warning when additive share > 40 % of blits.
**Cost:** dev-only increments (or a stub-ctx counter in tests, which is how the
harness works already). **Risk:** none in prod if compiled behind a flag.
**Acceptance:** V3 baseline recorded (11 blits: source-over vs lighter split), and
every later phase reports its delta against it.

---

# 5. Quality ladder — the contract

| Feature | low | medium | high | ultra |
|---|---|---|---|---|
| Reflection pass | off | 2 slices @1/12 | 3 @1/8 + ripple | 4 @1/6 + smear + tint |
| Player rim / deck pool | rim only | rim + pool | rim + pool | rim + pool |
| Enemy rim (L3) | off | ≤2 | ≤4 | ≤4 |
| Moon glitter (L9) | static column | 1 plate | 1 plate | 1 plate |
| Cloud occlusion (L10) | off | on | on | on |
| Rain / motes | existing | existing | existing | existing |
| Shadow atlas (L11) | ellipses | ellipses | atlas | atlas |

The governor already steps tiers under 36 fps and climbs back after 12 s of calm.
V4's job is simply to **make the tiers mean something**.

---

# 6. Phased roadmap

## Phase 0 — Prove the reflection architecture (research gate)
Run experiments **E1–E6** from `docs/LIGHTING-RESEARCH-V4.md` §4. No features.
**Exit:** a written verdict on the framebuffer reflection (keep / reduce source /
switch to silhouette mirror) plus measured `desynchronized` and additive-batching
answers. **Nothing in Phase 1+ starts until this is recorded** — the whole point is
to make the architecture decision on numbers, not affection.

## Phase 1 — Correctness & instrumenting (no new art)
`L1` data table · `L5` rotation · `L6` arena mask · `L13` harness · `L12` accounting ·
`L17` compositing ledger.
**Exit:** five assertions green, V3 numbers reproduced by a committed script,
practical literals gone from `props.ts`.

## Phase 2 — Depth (most visible per unit of risk)
`L2` three practicals · `L4` moon phase · `L7` quality ladder.
**Exit:** five practicals in the table, phases distributed ⅓ each, tier blit counts
monotonic, bake ≤ 16 ms.

## Phase 3 — Believable wetness
`L8` two-level damp/pool mask · `L9` glitter · `L10` cloud occlusion · `L15`
logarithmic parallax retune + tier culling.
**Exit:** pool coverage 18–30 % and damp 55–75 %, `moonCover` alive, parallax
ratios log-uniform ±12 %, blits within budget.

## Phase 4 — Refinement & taste calls
`L3` enemy rims · `L11` shadow atlas + entity mirrors · `L14` tint · **`L16` flash
budget** (WCAG 2.3.2: ≤3 opposing luminance events/s, ≤10 % full-screen delta).
**Exit:** each behind its own constant so it can be flipped off in one line; the
flash ledger asserts its limits in the harness.

---

# 7. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Rim/glow soup — "more light" reads as washed out | **high** | kills the 60/30/10 read | hard caps per frame, additive alphas ≤ 0.55, one hero per plane |
| Tier thrash from the governor | medium | visible popping | governor cooldowns already 4 s; tier changes only touch reflection slices |
| Puddle mask makes objects pop | medium | breaks grounding | feather 40 %, mask applied to the *buffer* (blurred anyway) |
| Memory target 34 MB misses | medium | slows low-end devices | measured per-plate table first; lazy sharp tiles second |
| Stub bench drifts from real canvas | medium | false confidence | strict throw-on-bad-source, geometry assertions, no fidelity claims |
| Reflection reads as "double image" of the player | low–medium | distracting | slice fades + 1/8 blur; alpha ≤ 0.17 at high |

---

# 8. Hard "do not do" list (carried from V3, still binding)

- No shaders, no WebGL, no `ctx.filter`, no `getImageData`, no `drawImage` readback.
- No live render targets, no full-resolution SSR, no ray marching in JS.
- No per-frame gradient construction, no per-frame array allocation, no object
  churn in `draw*`.
- No live streetlight flicker *art* (a baked plate + one alpha is the limit).
- No second post-processing pass stacked on the deck.
- No screenshot-based acceptance — assertions must be numerical or geometric.

---

# 9. Open questions (taste calls for the user)

1. **Moon phase per run** — is a crescent moon acceptable for gameplay readability,
   or must the key light always read as a big gibbous? (Crescent is prettier,
   gibbous gives better silhouettes.)
2. **Puddle coverage** — 45 % (subtle, filmic) vs 65 % (arcade wet-street)? I would
   default to 50 % on `high`, 65 % on `ultra`.
3. **Three new practicals** — vending machine + barrel + wall sign, or would you
   rather have **one** spectacular practical (a giant animated billboard whose
   baked spill is the level's hero)?
4. **Enemy rims** — helps "other things respond", but risks washing the silhouettes
   that the combat readability depends on. Default: on for `high/ultra` only.

---

# 10. What "done" looks like for V4

- Five practicals in one data table, props respect all of them.
- Moon: three phases, drifting corona, clouds eating the limb.
- Reflections: rotation-correct, arena-masked, puddle-limited, tier-scaled, tinted.
- Shadows: baked rakes everywhere static, directional atlas for anything that moves.
- Budgets: ≤ 34 MB, ≤ 24 blits at high, bake ≤ 16 ms — all printed by
  `npm run bench:render`, not claimed in prose.
