# 3D STAGE → 2D SPRITE SHEET

```
npx tsx scripts/render-3d.ts stage     # research/stage-3d.png   — model in the environment, 4 camera solves
npx tsx scripts/render-3d.ts sheet     # research/sprite-sheet-3d.png + .json — the animation, captured
```

## Why this works at all

The fighter rig was never 2D. `solveFighter3D` outputs every joint as a projected
`(x, y)` **plus a real depth `z`**, produced by

```
s = FOCUS / (FOCUS − z);  x_screen = x · s;  y_screen = y · s
```

so every joint can be unprojected back into true 3D (`x_screen · (FOCUS − z) / FOCUS`, `y`, `z`).
From there the character is a normal 3D object: it can be orbited, lit, occluded and filmed.
Nothing in the rig, the channels, the joints, `PLAYER_SPEC` or the joint limits is re-authored
for the render — the anatomy in the sprite sheet **is** the anatomy in the game.

`z` is authored per limb (`rootZ`, `hipLz/hipRz`, `armLz/armRz`, `footL/R`), so the depth in the
images is real pose data, not a fake parallax.

## The pipeline

1. **Unproject** every joint to world space (Y up, feet on the floor).
2. **Stage**: a floor grid, two gate pillars and a moon, all drawn through the same camera — the
   horizon, the spacing and the fog are earned, not painted.
3. **Camera**: yaw / pitch / distance / look-at height. `autoCam()` frames the body by *measuring*
   the projected height and iterating the distance three times, because pitch moves the endpoints
   in depth and the pinhole formula alone crops the feet.
4. **Model**: each bone is a tapered capsule (half-cap at each end), sampled as a polygon, split
   into two depth bands (far / near) with an aerial-perspective tone and a moon-side edge light.
5. **Capture**: one canvas per displayed frame at **24 fps** — the same cadence the game plays
   empty-hand clips at (`stepRate: 24`) — composited into the sheet.

No physics anywhere: no cloth, no verlet, no secondary integrator, no IK solving at render time.
Every frame is the authored pose sampled at its own time.

## Animation principles that survive the conversion

| principle | where it lives |
|---|---|
| **hold → snap → brace** | baked into the clips (`holdSnap` in `anim/bake.ts`); the sheet shows the still frames, the 1-frame strike, the braced impact |
| **staging** | the camera drifts with the combo and punches in on the finisher; the figure is framed by measurement, not by eye |
| **arcs** | the strike travels through the 3D space, so the arm's path curves in depth instead of sliding across a plane |
| **overlapping action** | shoulders → elbows → wrists carry different yaw and depth, so the limb lags itself |
| **timing / spacing** | 24 fps capture of 24 fps animation: what you see is what the game plays |
| **exaggeration** | the depth channels (`rootZ`, `armRz`, `bladeZ`) push the strike toward camera on contact |
| **appeal / silhouette** | near limbs read black, far limbs step back into haze, the moon rim separates the contour |

## Deliverables

- `research/stage-3d.png` — four camera solves (front ¾, profile at `omegaPalm` contact, rear ¾,
  low hero) of the unmodified rig.
- `research/sprite-sheet-3d.png` — 83 frames, 8 columns, 236 px cells, red border = hitbox open
  (17 hit frames), each labelled `move f<frame>`.
- `research/sprite-sheet-3d.json` — the atlas: `{image, cols, cell, head, fps, frames[{id, t, x, y, w, h, hit}], moves[{id, label, dur, hitStart, hitEnd}]}`. A sprite sheet nobody can slice is a poster.

## Bugs this renderer caught (worth remembering)

1. **Capsule caps sampled on the wrong side.** The cap at each end must sweep the side the segment
   continues into; sampling the opposite side folds the outline back across the limb and the
   nonzero winding rule punches a lens-shaped hole out of it. Symptom: a light disc at every knee
   and elbow.
2. **Batching subpaths into one path** for a "seamless" fill cancels overlapping regions under
   nonzero winding — same visible discs, different cause. Fill per part, in one colour.
3. **Double projection**: a drawn entry's radius is already screen-space; multiplying by the
   projection scale again gave a 40× skull that swallowed the frame.
4. **`solveFighter3D` returns shared vectors.** Copy joints to plain `{x, y, z}` before storing a
   frame, or every frame aliases to the last solve.

## Limits, stated plainly

- Limbs are **billboarded capsules**: they face the camera, so a limb pointing straight at the lens
  shrinks to a disc. A real mesh is the next step if this becomes the shipping renderer.
- Lighting is banded tone + one edge light, not a shaded surface model.
- The stage is software 3D on a 2D canvas (no WebGL, no z-buffer) — depth is painter's-algorithm
  with two bands, which is why far limbs can occasionally intersect near ones.
- The sheet is a *capture*, not a runtime sprite path. Wiring `atlas` into the renderer would be a
  separate change, and the game currently draws the rig live (which is cheaper and sharper).
