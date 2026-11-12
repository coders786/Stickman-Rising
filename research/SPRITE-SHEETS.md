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

---

# 2 · The seven attached sheets, transcribed

The user's seven sheets are the brief. Copied into `research/refs/` so they
survive (`sheet-composite-4row.png`, `sheet-duel-jab-contact.png`,
`sheet-duel-impact-reaction.png`, `sheet-boxing-12.jpg`,
`sheet-karate-kicks.jpg`, `sheet-run-thrust.jpg`, `sheet-kick-elements-run.jpg`).

## The one rule that runs through all seven

**The katana stays in the saya.** Every unarmed sheet — all twelve boxing
poses, all twelve karate poses, every punch in the four-row composite — draws
the sword **sheathed at the hip**: near-horizontal, edge down, hilt forward,
and *unmoving*. The blade never joins an unarmed action. The fists and feet
carry the whole move.

That matches the game: `Player.swordDrawn === false` → `switchWeapon` swaps
every attack through `unarmedAttack()`, the blade rides the hip. Worth stating
because the QA sheet renderer drew the blade from the hand for every clip and
made the unarmed set look like it was flailing a sword.

## Per-sheet transcription

### `sheet-composite-4row.png` — 4 × 12
| row | beat order |
|---|---|
| 1 | guard → step-in → lead jab ×2 → cross ×2 → **left hook, speed-line arc** → jab → recover → guard |
| 2 | guard → jab → mid kick chamber → high roundhouse with **full circular smear** → **burst/splat impact** → recover |
| 3 | run-in (5 frames) → **deep low sweep / side kick, rear leg extended flat** → pivot follow-through → spinning kick (silhouette drops to 115px span) → vertical extension → recover |
| 4 | run → **draw-from-hip, fist raised overhead** → vertical overhead slash with tall smears → recover |

Row 2's impact burst and row 3's ground-pivot ellipse are **contact
signage** — the sheet is telling you where the frame of maximum commitment
goes, which is the frame the hitbox must be open on.

### `sheet-boxing-12.jpg` — 12 poses, 3 × 4
guard · step diagonal · **long cross, arm fully extended** · snare/recoil ·
guard (fist vertical) · cross · **jab with three-line smear** · guard ·
**hook with wide arc smear** · **uppercut, fist above head** · **double hook,
two smears** · guard.

Fists are held **vertical** (thumb up), not horizontal — that is what makes
the silhouette read at 40px.

### `sheet-karate-kicks.jpg` — 12 poses
guard · step · knee chamber · **front kick fully extended** · high side kick ·
step · rear-leg chamber · rear kick · **spinning hook kick** · high back kick ·
neutral · ready.

Chambers are held at **waist height with the knee fully folded** — one clear
frame of stillness before every extension. Every kick extends to *straight*.

### `sheet-duel-jab-contact.png` and `sheet-duel-impact-reaction.png` — 12 each
attacker (black) vs defender (grey), same row structure:
guard → **jab travelling** → **contact with a star burst at the fist** →
defender's head snaps back → recovery → guard.

These two are the only sheets with a **partner**, and they are the reason the
contact frame is drawn with a star: they are teaching *where the two
silhouettes must overlap at the hit*.

### `sheet-run-thrust.jpg` — 4 × 3
Run cycle with the sheathed blade (3 frames) · **lunge thrust with three speed
lines, arm straight, rear leg extended** (3) · recover (3) · settle (3).

### `sheet-kick-elements-run.jpg` — 3 × 4
Run with saya · **charged overhead raise with electric FX** (4 frames, fist
clear above the head, feet off the ground) · settle · run.

## Measured drift across the reference rows

Silhouette-centroid drift per frame, read directly off the pixels
(`.qa/ref-motion.ts` / `.qa/ref-span.ts`):

| row | per-frame centroid | span |
|---|---|---|
| composite R1 (jab chain) | −8 −6 −6 −5 0 −1 −2 −4 −3 0 −13 | 138–141px, flat all row |
| composite R3 (run + kick) | −3 −2 0 +1 −4 +10 −8 **−35** +1 0 −7 | 135→162 (kick) →**115** (pivot) →163 |
| boxing R1 | −11 −14 −11 | 263–266px |
| duel R1 | −2 −1 +1 | 230–246px |
| karate R1 | −3 −31 −20 | 139→85px |

Two lessons:

1. **The reference fighter advances ~5px per frame.** Every row ends
   meaningfully right of where it began. A move that returns to its starting
   silhouette has not travelled.
2. **The reference fighter's stance width is enormous.** Boxing row: span is
   263–266 on a figure whose head-to-heel is ~266, and the **front toe and
   rear heel are the extreme points of the silhouette** — a full diagonal
   lunge, held through the whole row. Karate row dives 139→85 as the fighter
   drops into the kick. Nothing in the reference is ever upright and narrow.

## What this means for the game (measured, not guessed)

`.qa/limb-probe.ts`, `.qa/punch-height.ts`, `.qa/combo-reach.ts`:

| defect | measurement |
|---|---|
| **`l4` cannot hit anything** | elbow reaches **9.5px** forward at peak, inside its own window. It is folded at 87°–124° shoulder with a −146° elbow the whole time. |
| **`h1` is not much better** | elbow **21.1px** — a standing elbow needs ~35+ to clear the torso. |
| **combos silently drop** | grunt starts at 34px. `l1` lands, knocks it to 46. `l2` opens its window at **50px**, `l3` at **64px**, `l4` at **78px** — outside hand reach, so nothing after strike 1 connects. |
| **punches land at hip height** | `l4` fist 19.2px *below* the shoulder, `h1` 21.6, `ironRoot` 16.0. The reference throws every punch at chin level. |

The `l1` knockback is `kb: 95` and the enemy receives `kb * 0.45` → 43px/s,
but the chain is only ~0.3s per strike, and `l2`'s own `moveX` (+3.0 rig
units × 3.9 travel gain ≈ 11.7 rig = 15px) does not close a 16px gap.
