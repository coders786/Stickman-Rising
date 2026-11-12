# Z depth in 2D fighting-game animation — research pass

What was read, and precisely what each source changed in the renderer.
Sources are split into **YouTube** (video transcripts, as requested) and
**written** (articles / forum threads). Every rule below is implemented
somewhere in `src/game/anim/humanoid.ts`; the code comments cite back here.

---

## YouTube

### [Foreshortening and Limb Length in Perspective Made Easy](https://www.youtube.com/watch?v=aD2i4q1qmu4) — Dillon Wright, 2023
The single most quantitative source, and the basis for `HAND_GAIN`.

- Applies Toniko Pantoja's **"clock view" mindset** (animate the limb as
  clock hands in a top-down view) to foreshortening.
- **Measured length law:** an arm at **45° reads ¾ of its true length**;
  at 60°/73° it keeps shortening proportionally.
- **Measured hand-size law**, from dissecting hundreds of cartoon frames:
  hand pointed straight at the camera is **2× (safe)**, **2.5× (splits the
  difference)**, **3× (exaggerated but reads normal)**. At 45° the hand is
  **~1.5×**. With the forearm tilted 90° up those numbers halve; at 45° up,
  1.37×–1.75×.
- Notes the exact multiples depend on focal length — i.e. they are a
  *drawing* convention, not a projection result. That is why the renderer
  exaggerates (`DEPTH_GAIN`, `HAND_GAIN`) instead of trusting FOCUS 620.

### [How to draw FORESHORTENING | Perspective Tutorial](https://www.youtube.com/watch?v=G9ufRhWNeB8) — Draw like a Sir, 2021
- **The near end is bigger.** Build a limb as a stack of shoulder / elbow /
  wrist circles; *"the more the circles overlap, the more foreshortened and
  3D your pose looks"*. Wide spacing = flat and 2D.
- The far circle must be the **smallest** — a consistent size ordering is
  what makes the read legible, more than any single size.
- Overlapping shapes (not just shrinking them) is what sells depth.

### [TIMING — The 12 Principles of Animation in Games](https://www.youtube.com/watch?v=rHEJZXvFc5I) — New Frame Plus, 2019
- Timing is measured **in frames at 60/s**, spacing is *how far* something
  moves per frame. Depth that appears over 2 frames reads as a pop; the same
  depth over 5 reads as travel.
- Led to the rule that a clip's Z travel must be spread across several
  authored keys rather than one jump (see `h1`: −9.5 → +11 over the turn).

### [Free Workshop: The 12 Principles of Animation](https://www.youtube.com/watch?v=X7zN66riKKI) — Jay Jackson (Disney)
### [Fight scene animation tutorial — How to animate with IMPACT!](https://www.youtube.com/watch?v=GtAh73Vu_3Y)
Used for confirmation of anticipation → impact → follow-through structure
only; the second video's auto-transcript was unusable (ASR noise), so nothing
was taken from it beyond the title-level structure.

---

## Written sources

### [Foreshortening — illuspress](https://illuspress.com/how-to-foreshorten-arms-and-legs-without-it-looking-broken/)
**The core rule of this whole pass:** when a limb points at the viewer,
*draw the NEAR END LARGER — not the whole limb smaller.* Wrist near the
camera ⇒ wrist bigger than the shoulder. Holds that a limb should be
blocked as two stacked cylinders, drawn through, with cross-contours at the
joints and every joint overlapped. Wide FOV exaggerates (and reads as
intentional); a long lens softens the effect.

### [How to draw foreshortening in anime — dattebayo](https://dattebayo.me/en/blog/how-to-draw-foreshortening-in-anime)
Same law stated for a punch at the viewer: **fist largest, forearm shortens,
upper arm compresses the most.** Overlap is what makes it readable.

### [Foreshortening — arttechniques](https://arttechniques.com/techniques/foreshortening)
"Draw the **apparent**, not the actual, length." Skipping the overlap cues
flattens the form into something merely *short* rather than deep.

### [z-tilting: shader-based 2.5D depth sorting — GameMaker](https://gamemaker.io/en/blog/z-tilting-shader-based-2-dot-5d-depth-sorting)
Sprite top vertices are pushed back so a flat sprite occupies real depth for
z-sorting. Confirms **y-position ⇒ depth** as the standard 2.5D convention.

### [Using perspective to convey depth in 2D games — Purple Pwny](https://purplepwny.com/blog/using_perspective_to_convey_depth_in_2D_games.html)
Depth in 2D comes from parallax, foreground/background layers, **scale
relative to camera distance**, and focus/saturation falloff from one-point
perspective.

### [r/gamemaker — "how to make the impression that something is 3D in a 2D game"](https://www.reddit.com/r/gamemaker/comments/xc89sw/how_to_make_the_impression_that_something_is_3d/)
Forum consensus: z-tilting / depth-sorting on y, sprites rendered from 3D,
semi-transparent contact shadows. Nothing here beats real per-joint depth,
which is what the rig already has.

### [r/gamedev — 2D game with "fake" 3D depth (90s brawlers)](https://www.reddit.com/r/gamedev/comments/5kuubx/2d_game_with_fake_3d_depth_90s_brawlers/)
The practical brawler answer: keep gameplay in X/Y and let **Z affect only
the visuals**. Matches how these clips work — `rootZ`/`armZ` never touch
collision, they only drive projection and volume.

### [Give your sprites depth with sub-pixel animation — 2D Will Never Die](https://2dwillneverdie.com/tutorial/give-your-sprites-depth-with-sub-pixel-animation/)
Depth can be sold by shifting *shading* inside a still silhouette rather
than moving the outline. Not used yet (the style is flat matte black), noted
as a future option.

### [How to Animate a Fighting Game](https://www.artemisiacollege.com/feeds/blog/fighting-game-animation)
Pipeline + the reminder that **hit-boxes exist only on active frames**, so
visual timing has to respect frame data or the move feels disconnected. This
is the same failure the impact-timing audit measures.

---

## What was actually changed as a result

| Finding | Implementation |
|---|---|
| Near end larger, far end smaller | `depthScale(z)` multiplies each profile radius at that point's own Z |
| Hand magnifies far harder than the limb (1.5× @45°, 2.0–2.5× head-on) | `handScale(z)` — neutral anchored at 1.000, reaching ~2.07 toward camera |
| Far side only needs a *little* shrink; big shrink reads as a dot | asymmetric `HAND_GAIN` 14.0 near / `HAND_FAR_GAIN` 4.0 far → 0.78 … 2.07 |
| Consistent size ordering, not one size | monotonic taper enforced through `segmentProfile` |
| Depth must be spread over frames, not popped | multi-key Z ramps (e.g. `h1` rootZ −9.5 → +11 → 3.5) |
| Z is a visual channel, not physics | `rootZ`/`armZ` only feed projection + radius |

### Measured outcome (`.qa/depth-check.ts`, span = max spread across hip/hand/foot Z)

| move | span before | span after |
|---|---|---|
| `h1` RIPPLING ELBOW | 37.0 | **78.5** |
| `h2` TORNADO ROUNDHOUSE | 44.9 | **75.0** |
| `h3` SKYHAMMER FIST | 43.1 | **97.8** |
| `l2` GYAKU CROSS | 52.6 | **79.6** |
| `l4` SLIP BODY ELBOW | 62.9 | **103.0** |

### `l2` — the pelvis was not on the Z axis at all
The cross had 17.8 units of hand travel and only **2.4** of hip travel: the
arm did all the depth work while the pelvis stayed a flat slab. Authoring
the hip channel (wind `rootZ −5.5` / `hipLz −0.9`, contact `+9.0` /
`hipLz +1.5`, hold `+5.0`) took hip travel to 10.1 and the span to 79.6.

One trap worth recording: `chamber()` and `contact()` have a **closed**
option type, so `rootZ` cannot be passed inside them. It has to be merged
from outside — `kf(t, { ...contact(...), rootZ: 9 })` — and a bare
trailing `{...}` argument is rejected because `kf`/`mid` seal their
signatures.

### `h2` — depth alone was not enough
Giving the roundhouse real Z travel (rootZ coil −10.5 → arrive +14) raised its
span to 75, but a close-up read of the contact frames still showed a **knee
lift**: the shin was folded to **77°** at the moment of impact. `kickExtend`
spaces the foot by a goal offset, and the goal `38/−24` happens to sit near
the edge of the leg's reach.

A measured sweep of `kickExtend` (fold angle = thigh-to-shin, 180° straight):

| fwd / up | fold | hip→foot reach |
|---|---|---|
| 33 / −20 | 94° | 46.1u |
| 38 / −24 | **77°** | 52.8u |
| 44 / −27 | 50° | 60.7u |
| 46 / −26 | 38° | 63.4u |
| 47 / −28 | 30° | 64.7u (up clamps past −36) |

Contact now uses `46 / −26`: still a body-height kick, leg straightened to
38°, foot leading the hip by 63px instead of 53. Ignition uses `41 / −27` so
the leg passes *through* the arc rather than snapping open at contact.

`h1` also had its hit window re-anchored (0.192 → 0.164) because adding the Z
travel moved the elbow's speed peak from 0.182 to 0.174; the old window opened
after the peak and scored ratio 0.55 (DISCONNECTED). Now ratio **1.00**.

### Rejected
- **`DEPTH_GAIN` 7.0** — inflated fists into blobs and thickened the neck
  outline. 5.0 is the readable maximum.
- Trusting `FOCUS = 620` alone — the whole reachable depth range is only an
  8.9% scale change, which cannot carry the read. Volume is authored instead.
