# 23 — LIGHT AND SHADOW (rewrite, run 3)
**Serves:** S1 ("full fidelity that makes me WoW"), Rule 10 (never sacrifice what
works), 04's FID targets, 06's budgets, 07's tier rules.
**Status:** implemented on `arena/aefb8bb5-stickman-rising`; numbers below are the
implemented ones, not targets — except where marked **[provisional]**.

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
