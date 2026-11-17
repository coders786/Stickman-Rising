# 200 % Visual Upgrade — dual-register neuroaesthetic pass

Goal: make the rooftop stage appeal to **teenagers and adults at the same
time**, with a visibly dramatic (≥2×) change, while keeping the hard contract:
120 fps, flat Canvas2D, **all new art baked once — the frame path only blits
canvases**. No shaders, no WebGL, no live light/reflection/post engine.

## 1. The research the design is built on

| Source | Finding | Design decision |
| --- | --- | --- |
| Schloss & Palmer, *Aesthetic response to color combinations: preference, harmony, and similarity* (2011) — https://link.springer.com/article/10.3758/s13414-010-0027-0 | Figure preference is highest when the figure **contrasts in lightness with its ground**, is **more saturated and lighter than a desaturated/dark ground**, and when hue contrast is high. Saturated figures on saturated grounds are least preferred. | Dark, desaturated, low-saturation city/arena field (≈60 %) + **light, saturated, isolated accents** (≈10 %). Never "neon everywhere". |
| Wilms & Oberfeld, quoted in *The Influence of Color Stimuli on Adolescents' Emotion Playing Mobile Games* (2024) — https://arxiv.org/html/2402.19064v1 | Saturated + bright colours raise **arousal**; saturated **blue** receives the highest valence; low brightness reads as fear. | Every run's pops are bright saturated accents, always paired with a cool blue/cyan secondary; the base is lifted (not crushed to black). |
| *Color, Emotion, and Perception: A Mixed-Methods Study on Social Media Design and Youth Well-Being* (2025) — https://ijip.in/articles/youth-well-being/ | Bright energetic hues → joy; **neon / highly saturated shades everywhere provoke over-stimulation**; colour must match content for credibility. | The 60/30/10 budget: pops are *isolated*, the field stays calm. This is what lets teens and adults like the same frame. |
| *Hue, chroma, and lightness preference in Chinese adults* (2019) — https://ir.psych.ac.cn/bitstream/311026/29772/1/Hue,%20chroma,%20and%20lightness%20preference%20in%20Chinese%20adults%20Age%20and%20gender%20differenc.pdf | Cool colours (blue-green/cyan/blue) are the largest component of adult preference; light colours are preferred most; preference for bluish/purple declines with age. | Cool shadow field as the dominant register, with warm highlights — not a fully warm frame. |
| Ramachandran & Hirstein, *The Science of Art: Eight Laws of Artistic Experience* — https://www.dgp.toronto.edu/~hertzman/courses/csc2521/fall_2007/ramachandran-science-art.pdf and the product-design summary https://gerritmcgowan.com/neuroaesthetics-and-ramachandrans-eight-laws-for-product-design/ | **Peak shift** (exaggerate the diagnostic cue → stronger reward response), **isolation** (one cue holds attention), **grouping**, **contrast**, **repetition/rhythm**, **balance**, **metaphor**. | Supernormal hero crowns, oversized halos, chromatic rim fringes, graffiti tags, holo panels, rhythmic light rails, symmetrical hero pips. |
| Berlyne / empirical aesthetics — https://iep.utm.edu/empirical-aesthetics/ and https://www.researchgate.net/publication/232468613_Emotional_Responses_to_Art_From_Collation_and_Arousal_to_Cognition_and_Emotion | Inverted-U: **moderate complexity + order** ("unity in variety") beats monotony and noise; novelty/surprise sustain interest. | Calm ordered field + clustered fine detail (windows, mullions, grain, milky-way dust) + **one novel hero per plane** + a per-run palette identity. |
| Teal/orange split toning in cinema — https://freeelectronmedia.com/blog/the-use-of-teal-and-orange-in-cinema , https://colorarchive.org/guides/color-grading-photography-guide/ , https://nottldr.com/FrameShifter/color-grading-your-emotions-how-post-production-shapes-feeling-0hetns1 | Complementary cool shadows / warm highlights create instant **visual hierarchy**, depth and a "cinematic / prestige" read; **shadow lift** + subtle grain are the film look; overuse looks artificial. | Baked split-tone grade at low strength, raised black point, baked grain, screen vignette — restrained, not a filter slapped on top. |

### The synthesis: two registers, one frame

* **Adult register (60–90 % of pixels)** — filmic restraint: cool desaturated
  shadow field, warm highlights, split tone, shadow lift, film grain,
  vignette, atmospheric depth, coherent one-palette-per-run identity.
* **Teen register (≈10 % of pixels)** — supernormal pops: one saturated hero
  landmark per plane, exaggerated glow/halo/rim, graffiti, holo ads, comic
  bursts, sticker tags, rhythmic chevrons, chromatic edge fringe, bright
  purpose plates.

Both satisfy the same eye because the pops are **isolated** on a calm ground —
the exact pairing the colour-preference literature rates highest, and the
exact composition Ramachandran's isolation/peak-shift laws predict.

## 2. What shipped

### Curated mood palettes (per-run identity + novelty)
`src/game/world/mood.ts` — four palettes (`NEON NOIR`, `ACID RAIN`,
`EMBER CITY`, `ULTRAVIOLET`), each with `shadow` (60 %), `highlight` (30 %),
`pop` / `pop2` (10 %), `sky` tint. `moodIndexForSeed` avalanche-mixes the run
seed (verified ≈25/25/25/25 over 10 000 random seeds). One seed drives the
skyline, the props **and** the HUD mood badge, so every run is a coherent
designed level rather than a random colour shuffle.

### Adult register — baked film grade
`bakeFilmGrade` in `background.ts`: cool shadow lift, warm highlight split
tone, baked film grain. Applied `source-atop` to deep/far/mid/near bands and
the arena tile (graded strengths 0.4 / 0.55 / 0.7 / 0.85 / 0.42) so sky gaps
stay clean. `buildVignettePlate` = one baked plate, **one blit** in the
existing `drawWeather` pass — no live radial gradient, no post engine (same
pattern already used by `HUD.drawLowHpVignette`). Sky vault: palette-driven
tint pulse + baked split tone + mood-aware horizon light-pollution bloom +
palette-tinted aurora ribbons + a baked milky-way dust band in the star tile.

### Teen register — isolated supernormal pops
* `bakeIsolationHero` — ONE saturated hero per plane (mid + near; deep ridge
  gets a palette-tinted crown). Oversized halo, peak-shifted crown, light
  ribbon, symmetrical beacons = isolation + contrast + balance.
* `bakeChromaticEdges` — 1 px saturated rims and rhythmic parapet strips on a
  subset of near towers (grouping / repetition, not uniform noise).
* `bakeGraffiti` — bold abstract tags with dark contour, chromatic offset and
  spray dots on ~⅓ of near facades.
* `bakeHoloPanel` — scanlined holographic ad panels with a baked glow spill.
* Arena — thin rhythmic light rail, four isolated saturated sticker decals,
  palette-tinted wet-deck neon smears, palette rims on the door and lamp.
* Props (`props.ts`) — isolation halo, comic burst rays, bold ground ring,
  rotated sticker chip, thick high-contrast purpose plate; `setMood()` re-bakes
  all six code-only sprites to match the run.

### Fixed on the way
`ensureBuilt()` is now **rebuild-safe**: a run reseed used to append a second
set of glyph sprites and glow discs on every rebuild (unbounded growth). Both
arrays are cleared first — asserted by the headless smoke test.

## 3. Cost accounting (the 120 fps contract)

| Feature | Per-frame cost |
| --- | --- |
| split toning, grain, shadow lift, palette tints, hero crowns, graffiti, holo panels, chromatic rims, milky-way dust, sticker decals, prop restyle, mood badge | **0** — all inside one-time bakes |
| screen vignette | **1** `drawImage` in the existing weather pass |
| sky vault (tint, split tone, aurora, clouds, stars, moon, shooting stars) | coherence-gated ≈24 Hz; steady frames = 1 plate blit |
| props | frustum-culled, 2 `drawImage` per visible prop |
| HUD legend | 1 `drawImage` of a baked plate |

One full re-bake happens at run start only (measured 9–24 ms with a stub
canvas context). No new per-frame gradient, no new engine, no new shader.

## 4. Verification

`tsc --noEmit` 0 · `eslint .` clean · `npm test` 244 / 236 pass / 8
pre-existing baseline failures · `npm run build` ✓ · `curl :3000` → 200.
Headless smoke tests: full bake path across four reseeded palettes, glyph/disc
leak assertion, six-sprite prop rebuild across all four moods, and all six
prop-destruction effect branches. Palette distribution verified over 10 000
seeds. Visuals verified by code inspection — browser screenshots are not
available in this sandbox (Playwright cannot install browsers here).
