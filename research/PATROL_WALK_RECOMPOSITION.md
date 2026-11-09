# Walk replacement: reference study → new composition → extended audit

## Scope and deletion

Removed the former WALK_Q, its walk-hand array, its additive pose adjustments,
and the old WALK_CLIP construction from clips.ts. The new walk lives in
`anim/patrol-walk.ts`, with 14 bilateral pose keys, built from seven authored phase landmarks and an
opposite-leg half-cycle, plus the
closing key. clips.ts only re-exports it. Run, sprint, combat, dash, draw, the
minimal black body and the persistent storm service were preserved.

This is a new WALK composition, not a claim that every game animation was deleted.

## Actual reference inspection

Downloaded source assets into ignored `.cache/walk-study`, decoded/inspected their
actual frames. None of these third-party models, films or sprites is shipped in
the game. No claim of watching whole feature films or whole anime episodes.

| Source inspected | What was actually examined | Decision |
| --- | --- | --- |
| [three.js Soldier.glb](https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Soldier.glb) | Parsed real Walk animation (1.0333s), evaluated skinning at ten phases; rendered both side and three-quarter projected mesh frames | Quiet head, modest knee recovery, distinguish support and passing; do not copy armored hand posture |
| [Big Buck Bunny video sample](https://github.com/mediaelement/mediaelement-files/blob/master/big_buck_bunny.mp4) | Decoded 60s sample; overview plus 54–59s frame study of walking passage | Clear weight transfer and limb overlap; reject its heavy character's sway/body proportions for the lean fighter |
| [Phaser dude sprite sheet](https://github.com/phaserjs/examples/blob/master/public/3.86/assets/sprites/dude.png) | Actual horizontal strip of opposite-facing steps and idle | Readable alternating silhouettes; not enough frames/anatomy detail to use as realistic motion data |
| [Phaser knight sheet](https://github.com/phaserjs/examples/blob/master/public/3.86/assets/animations/knight.png) | Actual combat/locomotion sprite rows | Preserve negative space and stable silhouette; combat crouch is NOT the patrol walk |
| [Phaser walker sheet](https://github.com/phaserjs/examples/blob/master/public/3.86/assets/animations/walker.png) | Actual mechanical walker frames | Rejected as a human gait source; machine legs are not human support mechanics |
| [Naruto sprite sheet](https://github.com/SKJTCodes/Naruto/blob/main/Naruto.png) | Actual sheet and enlarged stance/run/dash rows | Clear load/drive poses; its forward-lean run is NOT evidence for a walking cycle |

The 2.5D study is the same actual 3D clip projected at a three-quarter angle,
not a separately downloaded 2.5D commercial game. Anime-style sprite inspection
is not a claim of having watched anime footage. Original authored poses follow
principles from the study; this is not automated mocap retargeting.

Local study outputs: `3d-frames.png`, `film-overview.jpg`, `film-walk.jpg`,
`anime-movement.png` under the ignored cache directory. The renderer used actual
skinning and triangle projection, not AI-generated reference imagery.

## Replacement architecture

### One walk clock

`patrol-walk.ts` authors contact, weight acceptance, passing, push-off and terminal
recovery. Two half-cycles close exactly. Pelvis yaw stays within ±.035 radians,
with a small opposing chest turn. The core has only a small acceptance dip.

`walkHandMotion` supplies opposed relaxed hands with restrained wrist lag. It is
shared by pose authoring, equipment variants, context composition and finger
rendering. Walk no longer borrows a run hand path or pins one empty hand at the
belly. The drawn adapter keeps a stable lower right-hand weapon carry while the
off hand continues its walk rhythm.

### Dedicated support and swing path

GaitPlanner now has an explicit `patrol` profile. Walking uses a centered support
interval (92px full cycle, 60% duty), world-locked stance anchors, low clearance,
and direct smooth swing recovery. It no longer uses the run-like delayed forward
sweep or large fixed landing offset. Both feet overlap support during a real
walking interval; there is no aerial phase disguised as a slow run.

The existing ground IK remains authoritative, so the clip does not dictate a
foot sliding across the roof just to preserve a pretty FK pose. Cadence follows
actual displacement. Animation duration is a pose-library clock, not a hardcoded
one-second stride at every speed.

### Defects caught during audit, then corrected

1. A first slow step retained old idle anchors too long. On entering patrol,
   initialize each foot from the current phase and support interval. Reset/
   teleport reseeding also resets profile entry state.
2. Toe-off lifted the ankle 2px, while swing started at the unlifted baseline.
   The swing now carries and smoothly releases that lift, preserving height and
   toe-pitch continuity across support → swing → contact.

These were found by additional tests, not hidden by crossfade or camera effects.

## Audits and reproducibility

- `bun run check`: **109 tests pass**, typecheck, lint and animation/continuity
  audits pass. `bun run build`: successful. `git diff --check`: clean.
- `scripts/audit-patrol-walk.ts`: **60 full-player cases**, 30/60/120Hz, both
  directions, sheathed/drawn, five input speeds (42–196px/s), six seconds each.
  **25,200 updates / 360 simulated seconds**, all poses and sampled joints finite.
  Worst settled pelvis Y ~-62.41 world units; maximum sampled horizontal ankle
  offset from pelvis ~21.91 rig units. Report: `patrol-walk-audit.json`.
- Separate profile regression: 30 combinations × 12 seconds = 360 additional
  simulated seconds. Checks stance anchors do not move during stance, foot
  envelope stays bounded, actual double support exists, no aerial walking.
- Dense boundary sampling at 2400Hz checks ankle-height/toe-pitch continuity
  around toe-off and the loop seam. This is a numerical audit, not game FPS.
- Bilateral/equipment loop seams, authored joint limits, stable sword carry,
  existing draw/grip, combat, run/dash and storm tests remain active.
- `patrol-walk.png`: actual Player/IK six-sample sheet for both equipment modes.
  Regenerate with `node --import tsx scripts/render-athlete-walk.ts patrol-walk`.
- `patrol-walk-browser.json`, `patrol-walk-gameplay.webp`: final production browser
  capture, 600 updates at 120Hz, 150 frames at 30Hz: free walk, stop, Q draw,
  drawn walk and reverse-direction walk. Offline inspection stepping and close
  camera; not a device performance or natural-weather-lifecycle benchmark.

This is a substantial walk replacement, not proof that all imaginable surfaces,
frame stalls, combat interruptions or player preferences are solved. No continuous
3D body collision or physically complete COM planner is claimed.
