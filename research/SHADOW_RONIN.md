# Shadow Ronin — anime redesign and image-driven iteration

> Subsequent movement fixes, research and before/after gameplay animation:
> [RONIN_MOTION.md](RONIN_MOTION.md). That revision supersedes the sustained
> sprint lean and timing described in this initial visual-design log.

## Art direction

Original anime shadow ronin martial artist: broad, defined shoulder line;
compact ribcage; narrow waist; elongated athletic leg silhouette; angular eyes,
jaw and ink-black hair. Deep indigo/charcoal cel planes are broken up by muted
skin, blue-gray cloth edges and a restrained crimson obi. No robotic joint discs,
rigid armor plates or capsule limbs have returned.

Costume: sleeveless crossed keikogi, soft high collar, split upper-thigh panels,
short waist tails, forearm bindings, fingerless gloves, shin wraps and tabi.
Garments follow solved torso/limb frames, while the panel openings retain the
leg separation needed to read walking and sprinting.

## Visual iterations

### 1. Generate a concrete target

- `shadow-ronin-concept.png` — AI-generated design reference, not a game screenshot.
- `shadow-ronin-pose-target.png` — AI-generated refinement using the concept and
  first renderer image, focused on iai readiness and a soft collar.

The references established the cloth layering, shoulder/waist gesture, wrap
placement and pointed hair silhouette. They are **not** pasted over gameplay;
the animated model remains a procedural canvas surface on the constrained rig.

### 2. Inspect the first actual renderer image

`shadow-ronin-iteration-01.png` preserves the first canvas result. It translated
the costume, cel shading and hair but exposed two problems:

1. The old upright idle posture still looked like a civilian mannequin.
2. A polygonal collar looked rigid, closer to a neck guard than folded cloth.

### 3. Revise and render again

`shadow-ronin-model.png` is the final actual-renderer model plate, not generated
concept art. The revision:

- Introduces an asymmetric, lowered **hanmi / iai-ready stance**, flexed knees,
  rear foot back, forward torso intent and compensated downward gaze.
- Changes the collar to curved folded cloth with a broad shadow fold.
- Uses a 32-unit torso and 6.1-unit skull radius, keeping leg length 49,
  arm length 38 and blade length 56. Shoulder/waist widths are visual surface
  profiles, not inflated collision volumes.
- Adds 17-unit parked half-stance width for the player, instead of the old 12.
  Combat shuffle tuning permits 20; enemy default stance width is unchanged.
- Strengthens walk/run/sprint pitch and head counter-rotation while preserving
  the human ROM limits and phase-continuous motion pipeline.
- Rebases the idle flourishes onto a martial rest instead of popping upright.

`shadow-ronin-animation-sheet.png` renders all ten walking and twelve sprinting
exposures through the production rig. The sheet is explicitly **before gameplay
foot/grip IK**; its authored seconds are adjusted by runtime cadence.

## Reproduction

```sh
bun run art:player
bun run check
bun run build
```

The art command regenerates the model plate and exposure sheet. Concept images
and iteration 01 are retained as fixed art-review references.

Tests cover the art direction's rig proportions, flexed and lowered rest/guard,
parked foot width, finite and bounded poses, continuity, limb lengths, elbow
poles, phase matching, both render facings and impact flashes. Existing database,
persistence, input and animation audits continue to run.

## Final verification

- `bun run check`: lint, TypeScript, **24 tests passed**, animation audit and
  continuity audit passed.
- `bun run build`: optimized production build passed.
- Chromium smoke: no JavaScript errors; idle, walk, sprint, reversal, jump and
  light attack exercised. Settled walk speed 105; sprint speed 480.
- Runtime geometry remained finite; both thighs measured 25 and both shins 24
  (within floating-point precision).
- Browser captures: `shadow-ronin-live-idle.png`, `shadow-ronin-live-walk.png`,
  `shadow-ronin-live-sprint.png`. The light inset is the game's solo inspection
  view, showing the actual player surface and solved pose, not concept artwork.
