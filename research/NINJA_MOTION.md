# Ninja lean and natural hand choreography

> Superseded dash posing/timing: [nine-key anime overhaul](ANIME_DASH_OVERHAUL.md).
> Dash lean/timing are subsequently intensified in [Dramatic dash](DRAMATIC_DASH.md).

> The subsequent [10 Hz arm-direction pass](SPRINT_10HZ_ARMS.md) re-composes
> sprint arms/palms and introduces deliberate limited-animation holds.

## Visual revision

The new request deliberately increases the previous upright sprint styling:

- Sprint cruise targets roughly **19–23°**, power stride roughly **23–27°**.
- Launch push targets **41°**; momentum-carry push targets **39°**. Acceleration
  adds a small bounded contribution. The recorded carry dash reached **42°**.
- This is a supported whole-core diagonal: lumbar bend stays small and the head
  counter-pitches. It is not a jackknifed waist or a perpetually horizontal torso.
- Load, catch, wall recovery, guarded retreat and vault retain their appropriate
  silhouettes; we do not apply forward lean indiscriminately to every action.
- Pure-black face/body, no ponytail, unchanged momentum mechanics and speeds.

## Hands and arms

Added `anim/hand-kinematics.ts`, shared by arm targeting and gesture generation.
The existing periodic reference hand arc now feeds both systems, rather than
animating wrist/finger changes independently from the arm path.

- Opposing left/right pump, compact front reversal and longer back/down drive.
- A slightly larger sprint excursion, bent elbows and reachable hand targets.
- Wrist follow-through lags the arm by 3.5% of a cycle and stays within 0.1 radians.
- Loosely curled athletic hands, rather than stiff fists, four extended spikes or
  both arms rigidly held behind the body. Finger openness stays around 0.22–0.29.
- The rendered four fingers have three curling segments and different resting
  flexion/lengths; the thumb opposes the fingers and folds over the grip.
- Dash off hand gathers/releases/gathers across load/flight/catch.
- The sword hand remains closed and does not receive cosmetic wrist roll; actual
  grip, blade and ground-contact solvers remain authoritative.

This is naturalistic stylized animation, not measured human finger motion capture.

## Verification and evidence

- `bun run check`: **62/62 tests**, typecheck, lint, animation/continuity audits.
- `bun run build`: successful. `git diff --check`: clean.
- New tests verify supported lean, balanced head, unchanged anatomical bounds,
  opposite hand motion, reachable targets, loop seam continuity, shared wrist/arm
  phase and held-grip safety. The old upright-sprint pitch assertion was intentionally
  updated for the new user-requested style, not removed.
- Rebuilt production browser: **720 updates at 120 Hz**, every pose finite and
  no JavaScript errors. Still verified **350 px/s single hold** and **480 px/s sprint**,
  power/cruise clips, carry/pivot dash, continuing air fall and wall absorption.
- [Browser report](ninja-browser-report.json) records observed pitch including
  transitions: the early low sprint angles are the normal-run→sprint blend.
- [Gameplay review](ninja-lean-gameplay.webp): actual rebuilt game, 240 frames
  sampled at 60 Hz and shown half speed. Not a live-device FPS benchmark.
- [Light-background pose study](ninja-lean-study.png): actual production rig and
  hand renderer, before gameplay contact IK. Regenerate with
  `node --import tsx scripts/render-ninja-study.ts`.
- Previous gameplay remains in `dash-physics-gameplay.webp` as before evidence.
