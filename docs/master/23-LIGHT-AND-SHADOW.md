# 23 — LIGHT AND SHADOW (rewrite, run 3)
**Serves:** S1 ("full fidelity that makes me WoW"), Rule 10 (never sacrifice what
works), 04's FID targets, 06's budgets, 07's tier rules.
**Status:** implemented on `arena/aefb8bb5-stickman-rising`; numbers below are the
implemented ones, not targets — except where marked **[provisional]**.

This chapter records the earlier renderer. For today's sole contact, single
cast and measured preset budgets, see [Shadow Footprint](../SHADOW-FOOTPRINT.md).
The separate practical and penumbra stacks below are historical.

---

## 0 · The complaint, taken literally

> "the graphics and specially the lighting and shadow is still cheap and not god
> level backed and made good"

That is a fair reading of what shipped, and the reason is worth stating precisely,
because "make it better" is not an engineering instruction:

**An ellipse is not a shadow — it is a stain.** The old grounding drew two
ellipses under each figure. They were *correct* (their direction answered the key
light after O-10) and they still looked cheap, because an ellipse carries none of
the information a shadow carries:

| What a shadow tells the eye | What an ellipse said |
|---|---|
| how tall the body is | nothing |
| how low the sun is (length ∝ 1/tan(elevation)) | nothing |
| how far the body is from the light | a little (it slid) |
| what the body is doing (a blade raised, a leg planted) | nothing |
| how soft the light is | nothing — a hard edge |
| that there is more than one light | nothing |

Meanwhile the practicals (stairwell, streetlight) glowed but cast nothing, so the
scene had light *without* consequence. Light that never blocks, never rims, and
never projects is a decal. That is the whole diagnosis.

---

## 1 · What was built (four systems, in paint order)

### 1.1 Projected body shadows — `render/shadows.ts`
A figure's shadow is now a **tapered polygon thrown along the light direction**,
long by `shadowLength(height, reach)`:

```
mul  = 0.30 + (2.05 − 0.30) · (reach/1.25)^1.6      // convex: the far half buys the length
len  = height · mul
```

The convexity matters. A linear map makes every figure on screen cast a
mid-length shadow, which reads as a uniform decal — the same failure as the
ellipse with more polygons. With the exponent, a fighter near the moon's foot
casts a short dark blob (0.3 × body height) and one at the far edge throws a
shadow **over twice its own height** across the roof.

Three lobes, one path: the body (two quadratics — a spine curves, a traffic cone
does not), a head lobe at the tip, a blade sliver for the raised arm. Then the
**penumbra stack**: the same path filled under itself at growing scale and
falling alpha, `penumbra` times. `ctx.filter = 'blur()'` would be the other way to
get a soft edge and costs 3–8 ms on mobile software raster; three fills cost
three fills. The stack is what separates "vector art" from "photograph".

Height is honest: `shadowAlpha` fades to **zero at 200 px** (above any jump the
game makes) and `airborneOffset` slides the shadow's base along the light as the
body rises — so a jump both detaches *and* separates the shadow from the feet,
which is the cue that sells altitude.

### 1.2 The second light — `practicalShadow` in `world/background.ts`
The practicals are now **sources with consequence**. `practicalShadow(x)` returns
the nearer light's direction (the shadow falls *away* from it), its strength at
that x (linear falloff over 320 px), and **an ink**: warm light blocked is a brown
shadow, cool light blocked is a blue one. A second `drawCastShadow` with that ink
and a **short** reach lands under the moon's long one.

Two shadows, two directions, two lengths, two colours — that is the cheapest
honest way to say "multiple light sources", and it is the single change that
makes the door and the streetlight stop looking painted on.

The failing tube's flicker now reaches its shadow (`flick`), so a dying
streetlight produces a *shuddering* shadow rather than a steady one.

### 1.3 True prop silhouettes — `world/props.ts`
A prop is a static sprite, so its shadow can be its **actual outline**:
`silhouetteOf()` derives a black-alpha mask at bake time (`source-in`), and
`drawShadows` blits it through a shear matrix:

```
x' = x + c·y ,  c = −dir·(0.22 + 0.6·reach)      // the top leans away from the light
y' = 0.14·y                                       // flattened onto the deck
```

`d = 0.14` rather than `0` on purpose: a shadow on a real roof has a little
thickness where the surface is not perfectly flat, and a mathematically pure line
reads as a sticker. One 9-arg `drawImage` + one penumbra pass per visible prop.

Why this outranks its cost: the deck is the largest surface in the frame. Real
outlines crossing it tie props, fighters and moon into **one lit space** — the
information a shadow map gives a 3D scene, bought for two blits per prop.

### 1.4 Volumetric shafts and dust — `world/background.ts`
Each practical gets a baked cone (trapezoid + vertical gradient + horizontal
`destination-in` mask so its edges are not straight lines), drawn additively with
the practical's own gain and flicker. Ultra adds `drawMotes`: 22 specks drifting
down the cones — one path, one fill, positions derived from the clock, never
stored. A lamp with a cone reads as a source *in air*: dust, drizzle, smoke. This
is the highest perceived-quality-per-millisecond in the whole package.

---

## 2 · The graphics levels — `render/graphics.ts`

Quality was a word passed around four modules that each invented its meaning.
There is now one table, and **every consumer asks it** (`featuresFor(tier)`), so
the cost of a frame is the cost the table promised — asserted by
`tests/shadows.test.ts`, not hoped for.

| | low | medium | high | ultra |
|---|---|---|---|---|
| figure grounding | contact | contact + 1 penumbra | **cast body** + 2 penumbra | cast body + 3 penumbra |
| second light shadow | — | — | ✅ | ✅ |
| prop silhouettes | — | — | — | ✅ |
| volumetric shafts | — | — | ✅ | ✅ |
| dust motes | — | — | — | ✅ |
| reflection | off | 1/8, 2 slices | 1/6, 3 slices | **1/4, 4 slices** |
| DPR cap | 1 | 1.25 | 1.5 | **2.0** |
| glitter / tint / rim | — / — / — | ✅ / ✅ / ✅ | ✅ | ✅ |

**Fill budget for the player, per tier** (fills are the unit because a shadow is a
path fill):

- low: **2** (contact)
- medium: **3** (contact ×2 + core)
- high: **10** (moon 4 + practical 4 + contact 2)
- ultra: **10** + 2 blits per visible prop

Six visible fighters on ultra: 60 fills + ~12 blits. For scale, one `shadowBlur`
on a phone software raster costs more than all 60 — which is why the old engine's
"cheap" look was never a performance decision, it was an unfinished one.

### Tiers are offered by device, chosen by player
`classifyDevice()` reads **behavioural** facts — fine pointer, no touch, shaded
megapixels — and *never the GPU string* (14 §2 measured renderer strings as
blocked or spoofed often enough to be a coin flip).

- ≥1.9 MP, fine pointer, no touch → **start `high`, ceiling `ultra`**
- fine pointer, smaller screen → start `medium`, ceiling `high`
- touch ≥3.2 MP (large tablet) → start `medium`, ceiling `high`
- other touch → start `low`, ceiling `medium`

A tier beyond the device's ceiling is **disabled in the settings screen, not
hidden** — the player can see that ultra exists and that it is a desktop tier.
The blurb under the buttons states each tier's actual contents; if a line there is
false, the table is wrong.

**The default tier is now the device's starting tier.** It used to be a
hard-coded `'low'`, which is precisely why a desktop with a discrete GPU could
launch the game into its cheapest look and conclude the graphics were bad. The
governor can still shed out of it within one 4 s window.

---

## 2.5 · Run 4 — the light FIELD, living buildings, and a roof with stuff on it

Three additions, all aimed at the same note: *"add more better lighting when near
light sources like hut and the lantern — animations for each building and each
run's procedural buildings, and props on the rooftop."*

### 2.5.1 · A field, not a light bulb — `world/lightfield.ts`

The two practicals used to be two hard-coded x positions and a `1 - d/300` used
in exactly one place: the player's rim. You could stand in the stairwell light and
the light did not touch you.

Now the stage owns a **field**: point sources with a radius, a colour family, a
gain and a flicker, and one query — `sampleLight(lights, x, y, t, out)`. Five
consumers read it and can no longer disagree:

| consumer | what it asks for |
|---|---|
| `drawLightPools` | where the deck is wet and lit (`1 blit` per visible source) |
| `drawFigureLighting` | the body wash + rim + deck pool for the player (`3 blits`) |
| `drawFigureWash` | the same, one blit, for enemies — a light that lights only the hero is a HUD effect |
| `practicalShadow` | direction, strength and **ink** of the second cast shadow |
| `drawMotes` | which cone the dust belongs in |

**The fall-off is smoothstep², not a ramp.** `1 - d/r` has a corner at the
cut-off; the eye reads that corner as a **ring around every light**, which is the
single most "programmer art" artifact in 2-D lighting. It also puts too much
energy far from the source, so two nearby lights wash into a blob. The new curve
is 1 at the source, exactly 0 at the radius, flat at both ends — asserted by
`tests/world-lights.test.ts` (slope at the source and at the cut-off must be
under a quarter of the mid-slope).

**Flicker only dims.** A failing tube's gain is a pure function of `t` and its
phase (two incommensurate sines), so a replay fails identically, and it never
brightens — an additive flicker that brightens is a strobe, which is a medical
consideration as much as a taste one. Measured over 6 s at the streetlight: gain
0.34 – 0.83, mean 0.63. It never goes dark.

**A third light per run.** If the rooftop props roll no bulb (2 % per prop), the
one nearest the last slot becomes one, so most runs get a real third source.

### 2.5.2 · Buildings that are inhabited — `world/buildings.ts`

The skyline is baked once per run and blitted — that is why it is cheap, and why
it was a photograph. Nine animation kinds are emitted **at bake time** from the
same building rectangles and drawn on top each frame as one to three fills:

`flicker` (a window switching), `tv` (blue, quantised), `chase` (a sign's three
cells), `buzz` (a failing neon tube), `beacon` (red obstruction light), `steam`
(a vent breathing), `laundry` (a line swaying), `dish` (tracking something),
`bulb` (a bare bulb on a wire).

Records are chosen by hashing `(band, tile x, run seed)` — **not** by consuming
the bake's RNG. The bake's art therefore does not move when an animation is added
(a screenshot diff shows the animations, not a re-rolled skyline), and the same
run always grows the same inhabitants. Density falls with distance
(near 85 % → mid 60 % → far 34 % → deep 12 %): a skyline where every window
animates is a disco, not a city.

### 2.5.3 · A roof somebody uses — `world/roofprops.ts`

Condensers, water tanks, crates, planters, vents, dishes, antennae, laundry lines,
cable coils, and the bulb. Two hard rules, both tested:

- **Never on a practical** (≥100 px clearance from both authored sources) and
  **never within 70 px of each other** — clutter is spaced.
- **Never blocks the fight**: every prop is ≤60 px tall against a 118 px fighter,
  so a swing never disappears behind a water tank.

They are *live*, not baked: a couple of dozen fills culled to the view, because
the count changes with the tier and a bake cannot.

### 2.5.4 · The three new dials

| | low | medium | high | ultra |
|---|---|---|---|---|
| rooftop props (of 16) | 0 | 6 | 12 | **22** (all) |
| city records / band | 0 | 2 | 4 | **6** |
| live deck pools | 0 | 1 | 2 | **4** |

Cost on ultra, worst case: 16 props × ~3 fills, 6 records × 4 bands, 4 pool blits,
3 blits per lit figure. It is all arithmetic on a path that already existed —
there is no new pass, no new canvas, no new bake.

### 2.5.5 · Verified by rendering, not by assertion

`npm run gate` proves the maths. It cannot prove the composition. So
`.qa/verify-lighting.mts` renders the real `CyberBackground` through
`@napi-rs/canvas` (a native canvas, not a stub) with the same transform
`Renderer.draw` applies, at every tier, and writes PNGs to `/tmp` — with
`MODE=nofig|nopool` to answer "which pass is that?" This is how the doubled pool
at the stairwell was found and fixed: a bright white slab where the fight happens,
because the field drew a pool over the bake's own.

---

## 2.6 · Run 4b — the city on the roof, the inn, and the hit that was a circle

Three complaints, taken literally: *"use city lights on rooftop"*, *"the lighting
of inn and other sucks"*, *"when hit enemies a kind of circle glow appears rather
than the appropriate lighting"*.

### 2.6.1 · The roof sits in the city

A rooftop over a neon city is never dark. That light has no single source —
sodium street lighting, shop fronts, sign spill — so it is modelled as three
**city-bounce** sources (`kind: 'city'`): gain 0.14–0.26 against the door's ~1.2,
radius 420–560, y *below* the deck (it comes up over the parapet), placed from the
run seed so a new run moves the light.

On top of that, one baked **glow plate** along the back edge:

- its vertical profile is a stack of ten stops of `0.24·(1−u)^1.8`, so the alpha
  reaches exactly 0 at the top of the plate — a glow that ends on a visible line
  is a rectangle;
- its pockets are small and low, because a radial gradient clipped by a canvas
  edge leaves a hard line (the first version did exactly that);
- rooftop props are lit **from below** by it (`CITY_EDGE` / `CITY_UNDER` in
  `world/roofprops.ts`) — the underside edge is the cue that says *six floors up*
  rather than *a crate on a dark floor*.

The city bounce is also a **shadow liar's check**: it may darken the deck under a
fighter, but it is capped at 0.45 strength for the second cast shadow, because a
crisp shadow from a source you cannot point at is a lie about where the light is.

### 2.6.2 · The inn is a room now

The doorway used to be one vertical gradient filling the opening — a glowing
panel. It is now five passes: a dim ceiling, a warm body, **a floor bounce** (the
hot ellipse where light hits the deck inside), **an open leaf** splitting the
field with its lit edge and its shadow, and **jambs** whose inner edges catch the
light. The spill is *local* (28 px of wall bounce, one threshold pool) instead of
a 120 px halo — everything beyond that is the live field's job.

### 2.6.3 · A hit is a light, not a circle

The impact effect was a 64 px radial sprite blitted as a perfect circle plus a
lens cross, identical everywhere. That is why it read as "a circle appears". Four
changes, in order of how much they mattered:

1. **Direction.** The bloom is an ellipse stretched 2.15 : 0.5 along the strike
   axis — a forward lobe into the target with a short tail back to the blade — and
   the shockwave ring is squashed (0.62 heavy / 0.78 light) and rotated to the
   same axis. A perfect circle is the most "this is a UI element" shape a hit can
   produce.
2. **Colour from the place.** `FX.setLightSampler()` is wired once to the field
   (`game.ts` → `hitLight`), so a strike inside the stairwell blooms warm, one
   under the failing tube blooms cool, and one out in the middle keeps the blade's
   own colour. The takeover threshold is 0.35 — deliberately above the city bounce
   (~0.2), or every hit on the roof would be the same amber.
3. **Local exposure.** A new light in an already-bright place barely registers,
   and additively a full-strength bloom over a lit doorway clips to white. The
   flash is dimmed by the light it happens in: `1 − 0.45·k`.
4. **A hot core + a thin wave.** The wide pass of the ring is now 0.12 alpha and
   2× width (it was a grey donut at 0.28 / 3.2×), and the core sprite is 0.38 r.

**The bug this exposed, and it is a good one.** The first version of the hit light
passed `"255,168,92"` to `rgba()` — but there are two colour helpers in this
codebase: `rgbaConst()` takes `"r,g,b"` (the draw path's cached strings, the
shadow inks) and `rgba()` takes `"#rrggbb"`. Feeding a triple to the hex parser
silently produces `rgb(37,81,146)`: a **blue** bloom in a warm doorway. Hence
`LIGHT_HEX` in `world/lightfield.ts` and a test that every light kind's tint
matches `/^#[0-9a-f]{6}$/` and that no two are the same.

### 2.6.4 · Verified in paint

`.qa/verify-hit.mts` renders the same strike twice — once inside the door's spill,
once in the unlit middle of the deck — and writes close-ups to `.qa/`. The
difference is visible, not asserted: warm ellipse + warm wave at the door, cold
white blade-light in the dark.

---

## 2.7 · Run 5 — the ULTRA stack: ultra stops being "high with bigger numbers"

Up to run 4 the tiers differed by *dial values*: more penumbra passes, a finer
reflection divisor, a higher DPR cap. Run 5 adds detail passes controlled by the
flags in `src/game/render/graphics.ts`, not by tier tests buried in individual
passes. Base atmosphere and wet-road sheen are now independent of these flags.

| flag | tiers | what it draws |
|---|---|---|
| `bloom` | ultra | the frame, downscaled 1/8, squared, added back at two scales — 6 blits |
| `godRays` | ultra | the same squared buffer smeared radially away from each practical — ≤ 8 taps |
| `keyTop` | high, ultra | a *top* light term on every figure: the key comes from above, not only from the side |

### 2.7.1 · Bloom without a shader, and the two ways it goes wrong

A downscale **is** a blur. Capture the frame at 1/6, blit it back additively,
twice at two scales: the tight pass carries the hot cores, the wide pass is the
skirt. That is the whole trick, and it is 5 `drawImage` calls.

The two failure modes, both encountered here:

1. **The wash.** Blitting a plain downscale back raises the *whole* frame
   roughly uniformly — a 240×150 buffer of a night scene is mid-grey, so "bloom"
   turns into "fog". Measured on a real stage render: mean luminance 33.8 → 52.7,
   a 56 % lift on a frame whose darks are supposed to stay dark.
2. **The white-out.** Additive passes *sum*. Eight taps at 0.22 add 1.76 frames.
   Measured: 33.8 → 92.4. The picture was gone.

The fix for (1) is two extra blits: **square the downscale** before using it.
Value² is a crude threshold that no canvas API gives us directly — 0.15 → 0.02
(gone), 0.85 → 0.72 (kept) — so the added light lands on the sources instead of
on the air. The fix for (2) is an energy budget written down as constants
(`RAY_GAIN`, `RAY_CLAMP`, `BLOOM_TIGHT`, `BLOOM_WIDE`) with a test that fails if
the total ever exceeds 0.045 of a frame for the rays.

Final measured cost on the ultra stage frame (`node --import tsx
.qa/verify-ultra.mts`): mean 33.79 → 38.62, p10 7 → 11, p50 32 → 36, p90 64 → 70,
doorway crop 49.97 → 56.22. The brights lift, the darks stay dark, and the
two-up crop `.qa/post-ultra.png` shows the halo sitting in the air around the
door.

### 2.7.2 · The key from above

Every light term up to run 4 was a **side** light: a wash across the body, a rim
on one edge, a pool under the feet. A figure lit only that way reads as a
cut-out standing in a spotlight, because nothing in the frame tells the eye the
key is overhead. `keyTop` adds one squash blit from above at ≤ 0.14 alpha — the
cheapest third dimension the renderer has — and it is on high as well as ultra,
because it costs almost nothing and fixes the same problem on both.

### 2.7.3 · Depth, culling and the horde

- **Mid-ground air**: the previous Ultra-only veil and tier-dependent ambient
  glow changed the skyline's colour when the budget changed. City bounce and
  warm air now belong to the [base stage](../lighting/road-and-sign-stability.md#the-warm-bridge-is-base-lighting).
- **Culling**: every body is skipped by one helper that compares against
  `cam.x + cam.offX` with a 90 px margin. The old inline test used `cam.x` alone,
  so during screen shake and the slow-push cutscenes bodies appeared a frame late
  or vanished a frame early. The count is reported in the debug line as
  `cull drawn/total`, because culling you cannot measure is culling you cannot
  claim.
- **Horde AI**: `src/game/combat/horde.ts`. Enemies within 900 px of the player
  tick every step; everything beyond ticks one step in three with `dt × 3`, so
  average speed, cadence and timers are unchanged and only the sampling is
  coarser. The plan is a pure function of (positions, player x, step counter), so
  a replay is still a replay and the frame-rate-independence tests still pass. A
  uniform 1-D grid (`HordeGrid`) answers radius queries for area sweeps in
  O(cell) instead of O(horde).

### 2.7.4 · Worst case for the stack

Ultra pays 13 full-frame blits per frame (5 bloom, 8 rays) plus two pinned
buffers (240×150 and 180×113 at 1440×900). Everything else on ultra is unchanged
from run 4 except the penumbra cap, which moved 3 → 4 so that `penumbra: 4` on
ultra is a real fourth pass rather than a number the renderer silently clamped.
`tests/shadows.test.ts` still asserts `fills === penumbra + 2` per tier, so an
over-ask fails the build.

---

## 3 · What this does NOT claim

- **Not "god level" as a guarantee.** "God level" is a taste judgement and the
  player's eye is the gate. What is claimed here is narrower and checkable: every
  lit thing in the frame now answers one light model, shadows carry the body's
  shape and height, two lights cast two shadows, and props throw real outlines.
- **No measured frame times on device.** The fill counts are exact; the ms they
  cost on a given phone is not measured here (no device in this sandbox). The
  governor still owns that decision, and `?bench` reports what it did.
- **No ray-traced/cascaded shadow maps.** This is a 2.5D Canvas2D renderer with a
  WebGL2 *baker* (D3). Nothing here changes that boundary.
- **Prop shadows are outline projections, not occluders.** They do not darken
  other props, and they do not react to the practicals (a prop within 320 px of
  the door casts only its moon shadow). Filed as 23-A.

## 4 · Open items
| # | What | Why it is open |
|---|---|---|
| 23-A | Props ignore the practical lights | needs a per-prop practical mask pass; cost is 2 more blits per prop at ultra |
| 23-B | No ground reflection of the shafts | the mirror band already contains them (it copies the frame) — a *separate* shaft reflection would double the cost for little gain |
| 23-C | Motes do not react to wind | one multiply on the sway if the weather front's gust should move them |
| 23-D | Device frame-time validation | needs real phones (T6.3) |
| 23-E | God rays have no occlusion mask | a true shaft pass masks by depth; Canvas2D has no per-pixel readback we can afford, so the smear is occlusion-free and the alpha is kept tiny (≤ 0.010 per tap) to stop it becoming a veil |
| 23-F | Bloom uses a square, not a luminance threshold | value² is a stand-in for a threshold. A real one needs a pixel readback (or WebGL); the squared downscale is the cheap honest approximation |
