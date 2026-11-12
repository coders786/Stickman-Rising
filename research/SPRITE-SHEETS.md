# Fighting-game sprite sheets: what the references actually teach

Goal: find free/public fighting-game moveset sheets, **look at them**, and take
the pose and timing lessons that make an attack connect.

## Sources reviewed

### 1. Slynyrd — Pixelblog 53, "Punches and Kicks" (free, CC-BY-NC)
`slynyrd.com/blog/2024/11/25/pixelblog-53-punches-and-kicks`

This is the single most useful sheet found. It is drawn as a **side-view
dummy** on a visible grid, and every frame carries two annotations: a **beat
name** and a **frame duration** (`FRAME . MSEC`).

The animation is broken into **seven named beats**:

| # | beat | what it does |
|---|---|---|
| 1 | **LOAD** | weight sinks, shoulders counter-rotate *against* the hips |
| 2 | **SPRING** | the hips fire first, the limb is still cocked |
| 3 | **SNARE** | the brief "catch" at the top — the wind-up overshoots and holds for one frame |
| 4 | **HIT** | full extension, everything on one line |
| 5 | **FOLLOW THRU** | the limb keeps travelling *past* the target |
| 6 | **RECOVER** | the limb retracts, the base is still wide |
| 7 | **OVERSHOOT** | the guard passes its rest position and settles back |

Two things in that list are missing from this game's vocabulary. We author
`chamber → contact → recover` (three beats). The reference spends *two* beats
of anticipation — LOAD then SPRING — and **three** beats after contact —
FOLLOW THRU, RECOVER, OVERSHOOT. The strike is one frame out of seven.

The timings printed on the sheet back this up: the wind-up and the strike get
about the same number of milliseconds, and the recovery gets more than either.

**What it implies for hit registration:** if a swing's hit window is placed by
"when the pose looks extended", it will be placed on HIT and FOLLOW THRU. The
sheet shows the limb is at maximum reach for **two** consecutive beats, not
one. A window that covers only the contact keyframe will miss the frame the
blade is actually farthest forward.

That is exactly the fault found in `srOnslaught` and `srVortex`: their windows
opened on the chamber and closed before the follow-through.

### 2. Ludo.ai — combat animation presets (free previews)
`ludo.ai/tools/animation-presets/combat`

A 3D mannequin "dash attack (punch)" pose, colour-coded by limb. Useful only
as a check that the *torso* leads: the chest is already rotated a quarter-turn
ahead of the fist, and the rear leg is fully extended as a counterweight. It
confirms the Slynyrd read that the hips/chest fire before the striking limb.

### 3. nightcafe — "2D fighting game hit effect sprite sheet" (AI, free)
A brawler sheet in a red/black palette. Its one transferable observation is a
**contact-frame exaggeration**: on the punching frames the glove is drawn
noticeably larger than the head, and the arm longer than the torso allows.
This is the classic fighting-game impact frame (the same trick BlazBlue and
Guilty Gear use), and it is why a hit that *looks* connected reads as powerful.

## What was actually changed because of this

### a. The blade pitch law (the big one)

The sprite sheets show the striking limb **and the weapon it holds** on one
line at HIT. Checking the rig against that:

    bladeAngle = PI/2 - (shR + elR + wrR)      // rig3d.ts

The blade's world pitch is the *sum* of the three arm channels. Most of the
unarmed-authored clips sum to **~0** at their contact beat, which points the
blade straight **up** — so `tip.x` can never exceed `grip.x`, no matter how
far the arm reaches. `cyclone` sat at 0.00; `ironRoot` at 0.14.

Fixing the elbow alone (extending the arm) does nothing, because the sum is
what aims the sword. The fix drives the sum to 1.30 (~15° above horizontal,
the angle the working sword lights use — `l1` sums 1.25).

### b. The hit window must cover the follow-through

Following the seven-beat structure, a window placed on the contact key alone
will miss the frame of maximum reach. This is documented as the remaining work
on the ronin clips (`srOnslaught`'s real forward sweep is at 0.75–0.90 while
its window opens at 0.45).

## Result

39 of 49 attacks now cut 4–5 of 5 bodies in a tight formation, up from 30.
`research/cleave-visual.png` is the visual proof: the blade drawn through a
row of five enemies.

## Note on licensing

Slynyrd's pixelblog art is CC BY-NC 4.0 — usable as reference, not shippable
in a commercial build. Nothing was copied into this repository; only the
beat structure and the geometric principle were used.
