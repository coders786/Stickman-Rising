# 03 — PSYCHOLOGY-DRIVEN ART DIRECTION
**Serves:** D1 — "full fidelity graphics that make me WoW; put as much human
psychology as you can."
**Discipline:** each law is graded **[R]** research · **[I]** inference from research
to our case · **[A]** assumption (needs validation). No player feedback is claimed —
none was collected (mandate forbids fabricating it).

---

## 0. What "WoW" is, psychologically

Awe is not "more effects". Keltner & Haidt define awe as the response to
**perceived vastness** plus a **need for accommodation** — a stimulus larger than
our frame of reference that forces the mental model to resize. [R]
https://www.templeton.org/discoveries/the-science-of-awe

Two operational consequences for a rooftop brawler:
1. **Vastness must be legible**: scale needs a *reference* (a tiny distant object,
   a horizon stack, a moon that is clearly enormous) — vastness is relational.
2. **Accommodation must be earned**: a reveal works when the player's expectation
   (flat 2.5D city) is exceeded at a specific moment (cloud break, moon emergence,
   storm turning over) — not when every frame is maximal.
VR studies find awe is mediated by **presence** and **perceived vastness**, and that
it is measurable (AWE-S scale, vastness factor) — so composition targets can be
argued from evidence rather than taste. [R]
https://www.researchgate.net/publication/352796844 ·
https://www.researchgate.net/publication/322636507

**[I] For us:** award the "WoW" to **one overwhelming frame** (first 3 seconds of a
run / wave transition), then hold a *calm, ordered* frame during combat. Constant
maximalism destroys both awe and readability.

---

## 1. The laws, and what each one changes in the pipeline

### P1 · Vastness needs scale contrast  [R + I]
**Claim:** awe requires "vastness" and a violated frame of reference (Keltner &
Haidt); panoramic/high-scale views are the most reliable elicitors in VR work.
**Application:** sky = **50–62 %** of frame at the default camera; the city must
have ≥4 depth planes; include a **scale reference** (distant aircraft beacon /
tiny tower light) inside the sky region; horizon must never be a flat line.
**Benefit:** the first frame reads as *place*, not *backdrop*.
**Disadvantage:** too much sky costs detail where the fight happens → keep play band
rich but low-motion.
**Cost:** 0 (composition, not pixels). **Confidence:** high [R].

### P2 · Purkinje shift — night is blue-green, not just dark  [R]
**Claim:** as luminance falls, rod vision (peak ≈507 nm, blue-green) takes over from
cones (≈555 nm); **reds go dark first, blues stay bright**; blue sensitivity also
rises with retinal eccentricity. [R]
https://quote.ucsd.edu/anstislab/files/2012/12/2002-The-Purkinje-rod-cone-shift.pdf ·
https://vester.si/bodily-oddities/oddities/purkinje-effect/
**Application:**
* **Distant light sources shift blue-green**; near practicals stay warm (a real
  depth cue that costs nothing).
* Deep shadow tint pulled toward **cyan-blue**, never neutral black.
* Warm surfaces (the stairwell door, fire barrel) become the *bright exceptions* —
  which is exactly the 60/30/10 discipline already used.
**Benefit:** the night reads as *authentically night*, not "day with a blue filter".
**Disadvantage:** overshooting makes the frame monochrome-teal; keep ≥10 % warm pop.
**Cost:** palette values only. **Confidence:** high [R].

### P3 · Processing fluency — beauty is ease of perception  [R]
**Claim:** aesthetic pleasure tracks *fluency* of processing: figural goodness,
figure–ground contrast, symmetry, prototypicality all raise liking via fluency. [R]
https://dornsife.usc.edu/norbert-schwarz/wp-content/uploads/sites/231/2023/11/04_pspr_reber_et_al_beauty.pdf
**Application:** clean silhouettes; consistent light direction; grouped cloud banks
(rather than uniform noise); a stable horizon; no competing focal points.
**Benefit:** the scene feels "designed" instantly — the core of premium feel.
**Disadvantage:** fluency alone → boring; pair with P5 (peak shift) for surprise.
**Cost:** 0. **Confidence:** high [R], application [I].

### P4 · Berlyne: moderate complexity + one novelty  [R]
**Claim:** preference peaks at moderate complexity with order ("unity in variety");
novelty sustains interest. [R] (prev. documented in `NEUROAESTHETIC-UPGRADE.md`)
**Application:** cloud coverage per system bounded (cumulus 22–38 %, stratus 55–80 %,
cirrus 12–25 %); exactly **one hero cloud bank / hero glow** per screen; variety
across *runs*, calm within a frame.
**Cost:** 0. **Confidence:** high [R].

### P5 · Peak shift / supernormal stimulus  [R]
**Claim:** exaggerating the defining feature of a stimulus increases response
(Ramachandran & Hirstein). [R] (prev. documented)
**Application:** moon larger than physical (210–260 px), corona exaggerated, cloud
edges *more* sculpted than reality; make the hero cloud's silhouette a **recognizable
shape** (an anvil, a claw), not noise.
**Disadvantage:** caricature if applied everywhere. **Cost:** 0. **Confidence:** high [R].

### P6 · Bottom-up salience must not fight gameplay  [R + I]
**Claim:** attention is captured by local contrast, motion, and looming; salience is
bottom-up and pre-conscious. [R/I — standard saliency literature]
**Application:** **motion budget**: cloud/fog motion amplitude in the play band is
capped; the fastest, highest-contrast element on screen must be the player/enemy
silhouette; sky motion is slow (wind 0.5–2 px/frame equivalent) and never flashes.
**Benefit:** readability during combat (REQ-601). **Cost:** 0.
**Confidence:** medium [R] → validated by contrast/motion probes.

### P7 · Gestalt: grouping, common fate, continuity  [R + I]
**Claim:** elements moving together group; continuous contours read as one object.
**Application:** one wind vector per profile (all clouds drift together, cirrus
faster); light direction identical across sky, shadows, rims; cloud banks share a
common base line so they read as *weather*, not sprites.
**Cost:** 0. **Confidence:** high for the principle [R], medium for our parameters [I].

### P8 · Colour emotion with a dual register  [R]
**Claim:** saturated, light figures on a desaturated dark ground are preferred;
adolescents respond to saturated/bright while over-saturation everywhere
over-stimulates; adults prefer cooler blue-green components. [R] (see
`NEUROAESTHETIC-UPGRADE.md` sources)
**Application (already law):** 60 % desaturated cool field, 30 % warm highlight,
10 % isolated saturated pops; sky tint per profile; grade split-toned.
**Cost:** palette only. **Confidence:** high [R].

### P9 · Motion comfort, vection and photosensitivity  [R]
**Claim:** flashing >3×/s risks seizures; a large change ≥10 % relative luminance is
a "general flash"; motion sickness is driven by large-field coherent motion with
conflicting vestibular cues. [R] WCAG 2.3.2 / 2.3.1
https://www.w3.org/WAI/WCAG21/Understanding/three-flashes
**Application:** flash budget (REQ-603); **large-field cloud motion kept sub-threshold**
(no full-screen scrolling at speed); parallax differentials sane (near:far ≤ 12:1);
reduced-motion toggle (REQ-604).
**Cost:** 0. **Confidence:** high [R].

### P10 · Reward cadence and flow  [I]
**Claim:** flow needs clear goals, immediate feedback, and challenge≈skill; visual
rewards are strongest when *earned* and spaced. [R/I — Csikszentmihalyi-derived]
**Application:** the "WoW" beat is scheduled at **run start and every boss wave**,
not randomly; sky events (moon break, lightning reveal) are authored to wave
boundaries; combat frames stay visually quieter.
**Cost:** scheduling only. **Confidence:** medium [I] — needs play validation.

### P11 · Profile identity must be recognizable in ≤1 s  [I]
**Claim (inference):** if identity is carried by *one* dominant cue per profile, it
will be recognized faster than by many small differences (fluency + salience).
**Application:** each profile gets **one signature**: e.g. NEON NOIR = magenta moon
halo; ACID RAIN = green-green rain haze; EMBER CITY = amber horizon; ULTRAVIOLET =
violet cirrus bands. Consecutive runs differ on ≥4 of 5 axes (D1).
**Cost:** 0. **Confidence:** medium [I].

---

## 2. Parameter table (psychology → numbers → probe)

| Law | Parameter | Target | Machine probe |
|---|---|---|---|
| P1 | sky fraction of frame | 50–62 % | geometric calc from camera + horizon plate |
| P1 | depth planes | ≥4 | layer count in draw ledger |
| P1 | scale reference present | 1 per frame | authoring checklist + bake assert |
| P2 | shadow hue | cyan-blue, ΔH ≥ +12° from neutral | palette assertion |
| P2 | distant light hue vs near | ≥ 25° apart | palette assertion |
| P3 | silhouette separation | figure rim ≥ 3:1 | contrast probe (REQ-601) |
| P4 | cumulus coverage | 22–38 % | alpha mass of baked/shader mask |
| P4 | stratus coverage | 55–80 % | idem |
| P4 | cirrus coverage + elongation | 12–25 %, ≥4:1 | idem |
| P4 | heroes per screen | exactly 1 | authoring rule, assert in profile |
| P5 | moon size | 210–260 px at 1080p | constant |
| P6 | play-band motion amplitude | ≤ 0.15 px/frame mean | motion ledger |
| P7 | wind coherence | 1 vector/profile | profile schema |
| P8 | palette ratio | 60/30/10 ±8 % | colour histogram probe |
| P9 | flash events | ≤3/s, ΔL ≤10 % | FlashLedger (REQ-603) |
| P9 | near:far parallax | ≤12:1 | ladder assert |
| P10 | reveal cadence | run start + boss waves | schedule assert |
| P11 | profile axes differing | ≥4 of 5 | seed distribution test |

---

## 3. Anti-patterns this document forbids

1. **Bloom-everywhere**: glow on every edge destroys hierarchy (P6, P8).
2. **Noise clouds**: uniform fBM without silhouette design reads as fog, not
   cumulus (P3, P5).
3. **Full-screen moving cloud deck at combat speed**: vection + salience conflict (P6, P9).
4. **Teal-and-orange applied to everything**: the grade must be stated per profile,
   not globally (P8).
5. **Detail in the play band**: decoration where the player must read attacks (P6).
6. **Random awe moments**: novelty without earning = noise (P10).
7. **Fabricated feedback**: no "players love X" claims in any doc (mandate).

---

## 4. Validation plan (no fabricated results)

| Step | What | Status |
|---|---|---|
| V1 | Numeric probes above in the committed harness | planned, M1 |
| V2 | User visual review of A/B frames (profiles, tiers) | needs user's eye — this environment cannot screenshot |
| V3 | Structured play-test (preference, identity recognition, comfort) | **future**, requires participants; script + consent + recording plan to be written in `11-VALIDATION.md` |
| V4 | Photosensitivity audit of the flash ledger | automated, M1–M2 |

Nothing in this document claims V2/V3 results. They do not exist yet.
