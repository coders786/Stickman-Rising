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

---

# 3 · What was fixed, and what it measured

Five defects came out of transcribing the sheets against the rig. Each was
fixed at the one place it originates, not clip by clip.

## 3.1 `l4` could not hit anything

`strikeJoint` is `'elbow'`, but at contact the **hand** led the elbow by 25px —
a palm strike wearing an elbow's name — and the elbow point itself peaked at
**9.5px** forward, inside no body sphere at any distance.

Solved against the rig rather than guessed. Brute-forcing `shR` × `elR` and
reading the projected elbow/hand positions:

| shR | elR −0.8 | −1.2 | −1.6 | −2.0 | −2.4 |
|---|---|---|---|---|---|
| 1.2 | 17/42 | 6/32 | −4/21 | −13/13 | −19/7 |
| 2.0 | 31/56 | 27/50 | 18/42 | 9/31 | 0/21 |
| **2.4** | 26/51 | 29/49 | **26/43** | 19/35 | 11/24 |
| 2.8 | 15/38 | 16/41 | 18/39 | 21/33 | 19/25 |

(elbow-forward / hand-forward, px). A *real* elbow needs the point to project
past the forearm at a genuine fold — `shR 2.4 / elR −1.6` (92°) is the pair
that does it. Reach went **9.5 → 36.8px**; `h1`'s 46.5px is the healthy
reference.

## 3.2 The stance was a narrow box, not the sheets' diagonal lunge

Reference width/height (stance width ÷ body height, read off the silhouette)
is **0.95–1.00**. Ours measured **0.49–0.55**.

Fixed at `footAt()` — the single funnel all ~65 authored `leadFoot`/`rearFoot`
pairs pass through — by an X gain `STANCE_SPREAD`.

| spread | width/height | welded joints |
|---|---|---|
| 1.00 | 0.70 | none |
| 1.10 | 0.76 | none |
| **1.15** | **0.80** | **none** |
| 1.20 | 0.82 | `h1` right hip |
| 1.30 | 0.87 | `l2` right knee pinned at 0.0° |
| 1.45 | 0.94 | `l1`/`l3`/`h1` knees pinned at 0.0° |

Past ~1.18 the authored leg solutions run out of reach and `footAt`'s
`d = min(LEG − 0.2, …)` clamp starts swallowing the animation — the knee stops
moving entirely. `tests/full-body.test.ts` ("no joint is welded shut") catches
exactly that, and it is right to. **1.15 is as wide as this rig's legs can
actually stand.** The remaining gap to 0.98 is honest: the sheets' figures have
longer legs relative to the torso than ours.

## 3.3 A light hit pushed the combo out of its own range

Knockback scale did not know what a combo is. With the body pinned
(`.qa/combo-travel.ts`) the light chain `l1..l5` landed **only its first two
strikes**:

```
l1  landed at 34px, shoved the grunt to 45
l2  opened at 51, shoved to 69
l3  opened at 76  -> MISS
l5  opened at 126 -> MISS
```

Fixed by scaling a *light* hit's push (`LIGHT_HIT_PUSH = 0.34`): a light trades
most of its shove for hitstun, because its job is to hold the body still for the
next strike. Heavies keep full separation, because their job is to create space.
The whole chain now lands 10/13/14/15/16.

## 3.4 Hitstun was shorter than the strike that dealt it

A light's default 0.20s of stagger against clips of 0.26–0.44s and a ~0.30s
turnaround meant the body recovered and walked off mid-combo. Stagger is now
derived from the clip (`LIGHT_STUN_LAG + hit-window + CLIP_STUN_GAIN`), with
authored values still winning.

## 3.5 No melee enemy stood inside its own attack range

**This was the biggest one, and it was not an animation bug at all.**
`ENEMY_CHASE` parks at `orbit`; the attack trigger is `range + 14`. Every
melee type parked *outside* its trigger:

| kind | range | orbit | slack |
|---|---|---|---|
| grunt | 68 | 120 | 52 |
| assassin | 62 | 150 | 88 |
| heavy | 82 | 130 | 48 |
| shield | 72 | 110 | 38 |
| drone | 90 | 170 | 80 |
| elite | 74 | 140 | 66 |
| boss | 150 | 200 | 50 |

A grunt walked to 120px and stopped — beyond the player's ~70px hand range
*and* beyond its own 82px trigger — so it could neither hit nor be hit, and it
hovered there forever. Each `orbit` now sits just inside its own trigger; the
gunner keeps 380, the one type that wants distance.

### End-to-end result

`.qa/combo-live.ts` — a real chasing grunt, 15 unseeded 6-second trials, the
light chain thrown on repeat:

| chain | median strikes connected | mean damage |
|---|---|---|
| `l1-l2-l3-l4-l5` | **0 → 9** | **49 → 92** |
| `h2-h1-h3` | **0 → 2** | **19 → 46** |
| `l1-l2-l1-l2` | 12 → 11 | 85 → 82 |

`l1-l2-l1-l2` was already fine once the body was in range; the two-jab openers
were the only thing that ever worked, because 34px is inside reach and the sum
of two light pushes still is. Anything longer died in the gap.

> Harness note: the multi-trial RNG is deliberately **not** seeded. Pinning
> `Math.random` pins the grunt's orbit `side`, which produces one deterministic
> standoff rather than the average case (measured: 2/16 seeded vs 9/16
> unseeded). Do not "fix" this later.

## Gates

`npx tsx --test tests/*.test.ts` **201/201** · `npx tsc --noEmit` **0** ·
`npx tsx .qa/pose-golden.ts` **PASS**.

---

# 4 · The turret bug: the unarmed kit never travelled

Transcribing the sheets produced five fixes (§3). Running the *end-to-end*
harness afterwards showed the hand-to-hand string was still a coin flip, and
the reason turned out to be one missing channel that all five fixes sat on
top of.

## 4.1 Every empty-hand strike had `moveX: undefined`

The reference sheets advance the fighter on **every frame** (§2, measured
~5px/frame, `.qa/ref-motion.ts`). Measured against that, the unarmed kit did
this:

```
l1 root advance 0.0 px   vx 0
l2 root advance 0.0 px   vx 0
l3 root advance 0.0 px   vx 0
l4 root advance 0.0 px   vx 0
l5 root advance 0.0 px   vx 0
```

Zero. The sword kit all carries `moveX: 90-250`; the empty-hand defs carried
nothing at all. The feet still moved *forward inside the clip* — `footAt`
places them further along the local X on every strike key — so the animation
depicted a step while the root stayed pinned. A treadmill: the legs reached,
the body never arrived.

That is the mechanism behind the user's complaint. A grunt starts at a 34px
standoff; strike 1 connects and shoves it out to ~45px; because the player
never closes, strikes 3-5 open their windows outside hand reach and the
string dies after its first hit. Measured live before the fix:
`l1-l2-l3-l4-l5` connected **2 of 16** in the bad case, and the median over
12 trials was 9 with a range of **2-9** — a coin flip, not a combo.

## 4.2 The first fix over-corrected: five steps walked through the body

Giving every strike a step raised the string to 11-13 connections, and broke
something else: measured gap went `19 -> -15`, i.e. the player ended up
*behind* the grunt. There is **no player/enemy body collision anywhere in the
game**, so nothing stops a stepping attack from striding over its target.

The step therefore has to be range-aware, at the one place that knows where
the bodies are. `Player.updateAttack` clamps the drive to
`(distance to nearest body in front) - ATTACK_STANDOFF`, and the clamp had to
read `w.enemies` directly: `this.threatX` is refreshed by `scanEnemies`
inside `updateMove`, which **does not run during an attack**, so it is stale
exactly when a chained strike fires.

## 4.3 The drive motor's real distance law

Calibrating the clamp against the wrong constant made every clamped step
overshoot its budget by ~40% (a 24px budget landed at 33.4px) — which is
what walked strikes through their targets. The motor is cut off at the end
of `groundDrive.duration` but the body keeps **coasting** while
`brakeVelocity` bleeds the rest at 900px/s². Measured
(`.qa/tmp/cal.ts`, no enemy in world so the clamp cannot fire):

| speed | 40 | 60 | 80 | 100 | 120 | 150 | 180 | 200 |
|---|---|---|---|---|---|---|---|---|
| advance px | 5.6 | 8.7 | 12.0 | 15.5 | 19.2 | 25.1 | 31.3 | 33.4 |

So `px ≈ speed × 0.165`, not `× 0.12`. Two consequences: **duration is the
lever and magnitude is only the ceiling** (past ~200px/s the drive saturates
and more `moveX` does nothing), and the per-strike distance budget has to be
a *sum over the string*, not a per-strike maximum.

## 4.4 The wind-up scales with the clip

A fixed 0.12s drive is wrong for the heavies. `h1`'s window is 0.16-0.28;
at a 60px standoff it found the body still 50px away at `aT 0.25` and only
closed to 34px by `aT 0.42` — after the window had shut, so the push landed
in the recovery beat. The drive span is now a fraction of the clip
(`0.55 × dur`, clamped to 0.10-0.24s), so a jab steps short and quick and a
finisher steps through its whole wind-up and arrives on time.

## 4.5 Result

`.qa/combo-live.ts`, 12 unseeded trials each (median; the harness is
deliberately unseeded — see §3's note on why seeding pins the grunt's orbit):

| chain | before | after |
|---|---|---|
| `l1-l2-l3-l4-l5` | 2-9, **unstable** | **14 connected, 14/14/14 min-max** — deterministic |
| `h2-h1-h3` | 2 | **8**, stable |
| `l1-l2-l1-l2` | 11 | **15**, stable |
| damage (light string) | 32-92 | **191** |

The range of 2-9 collapsing to a flat 14 is the real result: the string no
longer depends on where the grunt happened to drift.

## 4.6 Contact fairness, measured the same way as the blade

`phantom-check.ts` asks whether the BLADE reached the body. The unarmed kit
needs the same question asked of the LIMB, because it credits through a
different path — with the blade sheathed, `updateBladeWorld` writes the
striking joint into `this.blade`'s fields (`limbSeg` is only populated on the
drawn-blade-but-punching path, which is why a probe reading `limbSeg` here
records nothing).

`.qa/unarmed-connect.ts`, slack = distance from the striking joint to the
nearest body sphere minus its radius at the first-damage frame:

| strike | joint | slack px | pad |
|---|---|---|---|
| h1 | elbow | 5.1 | 7 |
| h2 | foot | 2.3 | 7 |
| h3 | hand | 1.6 | 7 |
| l1 | hand | −4.7 | 5 |
| l5 | hand | −6.5 | 5 |
| l2 | hand | −6.7 | 5 |
| cyclone | hand | −10.8 | 5 |
| l4 | elbow | −12.1 | 5 |
| l3 | hand | −12.5 | 5 |

**9/9 within their own authored `pad`**, at both a 34px and a 48px standoff
(worst 5.1px, inside the 7px tolerance). Negative means the striking joint is
*inside* the body — that is real, visible contact.

Excluded from that table: `powerPunch`, a `kind: 'dash'` corridor attack that
is *designed* to hit bodies it dashes past (it keeps its own authored
`moveX: 240, moveXAt: 0.02`). It is the same exclusion `phantom-check.ts`
makes for AOE, and it is the documented worst case in `research/CLEAVE.md`.

## 4.7 Gates

`npx tsx --test tests/*.test.ts` **206/206** (5 new in
`tests/unarmed-step.test.ts`, pinning: no def is a turret, an individual step
is bounded so a string cannot outrun its standoff, the clamp engages, the
joint reaches the body, and the live string connects) · `npx tsc --noEmit`
**0** · pose-golden **PASS** · blade phantom-check unchanged (median −8px).

---

# 5 · "Compose these as they are": coverage, and two measurement traps

## 5.1 Coverage

`.qa/sheet-coverage.ts` maps every technique transcribed from the seven
sheets onto the move that serves it, matching on label and striking joint:

**20 of 20 sheet techniques have a roster move.** The uppercut is
`RISING DRAGON` (the `launcher`, built on the `unarmedUpperCut` clip); the
run-in is `SHOULDER TACKLE` / `CHARGED RAM`; the charged overhead raise is
`SHINRA PALM`; the slip-and-counter is `REKKA COUNTER PALM`. Nothing had to
be authored to complete the set — the gaps were in the *mapping*, not the
kit (I initially mis-scored uppercut and run-in as missing because the
matcher looked for the literal words).

`.qa/render-sheet.ts` lays any clip out as a numbered silhouette row so the
choreography can be compared to the sheets directly instead of by channel
number. The kit matches the references on the laws they encode: wide
diagonal lunge, knee fully folded in the chamber, every kick extending to
straight, fist clear above the head on the uppercut, saya never drawn.

## 5.2 TRAP: "peak reach is outside the hit window" is not a defect

`.qa/peak-window.ts` finds, for every unarmed clip, the beat at which the
def's own striking limb is farthest forward, and reports any whose window
does not contain it. It found **18 of 49**. That looks damning, and it is
exactly the shape of the Slynyrd conclusion recorded in §1b — so the
temptation is to move 18 windows onto their peaks.

Doing that is wrong, and the measurement that proves it is a live one. Of
the 18, ten are reachable as unarmed chain moves; testing each against a
body at the standoff before and after the proposed window:

| strike | connects NOW | connects with window moved onto its peak |
|---|---|---|
| `sakugaDragon` | **yes** (aT 0.33) | **no** — opens on air |
| `omegaPalm` | **yes** (aT 0.46) | **no** |
| `srOmega` | **yes** (aT 0.71) | **no** |
| `l1`, `a3`, `viperPalm`, `srOnslaught` | yes | yes (no gain) |
| `ironRoot`, `sakugaScorpion` | yes | worse or equal |

The geometry explains it. At a 34px standoff the body is *already* inside the
fist's sphere on the way through, so the strike lands well before maximum
extension, and by the time the limb peaks the target has been knocked back —
a peak-placed window opens on empty air. Peak reach is the right question for
a blade sweeping through a crowd (that is why it mattered for `srOnslaught`'s
*blade* in the cleave pass); it is the wrong question for a fist against one
body at contact range.

**Do not retune a window from `.qa/peak-window.ts` alone.** The acceptance
test is `.qa/unarmed-connect.ts`: is the striking joint on the body at the
frame damage is dealt? All 9 reachable strikes answer yes.

## 5.3 TRAP: moves have range BANDS, not a single reach

Asserting "every move connects at the 34px standoff" reported
`sakugaScorpion` and `srOnslaught` as broken. They are not — they are
*long-range* moves, and both connect at exactly the range their wind-up
needs:

| move | 34px | 50 | 67 | 85 | 100 | 120 |
|---|---|---|---|---|---|---|
| `sakugaScorpion` | miss | miss | **hit** | **hit** | **hit** | miss |
| `srOnslaught` | miss | **hit** | **hit** | **hit** | **hit** | miss |

At point-blank a lunging whip is still travelling when its window shuts; at
120px it has run out of clip. Both are correct. `tests/unarmed-step.test.ts`
therefore asserts that each move has a *working band* and that it lands on
the body inside it, not that it works at one fixed distance.

## 5.4 Two harness bugs worth remembering

Both of these produced convincing false results:

* **`Enemy` sets `this.side = Math.random()` in its constructor.** A chasing
  grunt therefore orbits randomly, and over a 1.33s clip it can walk out of
  the move entirely — the same test failed in 5 of 6 runs, always on the two
  longest clips. Pin `e.x` when the question is about the strike, not the AI.
* **`e.id = nextId++` is a module-global counter.** A test that builds its
  enemy per case and does not pin `e.id` will have `hitEnemy` resolve against
  an enemy from an earlier test, so the hit is applied to nothing and the
  move "never connects". Pin the id.

And one about loop bounds: clips run 1.33s and leave the attack state at
their `cancel` beat, which lands *before* the hit window of the slowest
finisher. A `while (p.state === 'attack')` loop silently truncates and
reports a working move as a miss. Bound by frames.

## 5.5 Gates

**207/207** (6 in `tests/unarmed-step.test.ts`) · tsc 0 · pose-golden PASS ·
blade phantom-check unchanged (median −8px).

## 5.6 The measurement traps went three levels deep

Getting an honest answer to "does a string connect every strike" took four
attempts, and **the first three all reported defects that did not exist**.
Recording them because each looked exactly like a gameplay bug:

| attempt reported | what it actually was |
|---|---|
| `sakugaScorpion` / `srOnslaught` never connect | true, but they are long-range moves (see 5.3) |
| the LAST strike of every string whiffs | loop guarded on `i < ids.length`, so it exited the moment the final strike *started* |
| `l5` whiffs only after `l1..l4` | a `Set` of ids cannot represent a repeated id, and the prefix-depth walk broke on `l1,l2,l1,l2` |
| `h1` whiffs in `h2-h1-h3` | **`h2` does not chain to `h1`** — an illegal sequence I invented |

The last one is worth keeping: `h2` (TORNADO ROUNDHOUSE) chains to
`l5, launcher, sakugaScorpion, omegaPalm`, while the authored heavy string is
`h1 → h2 → h3`. Testing a sequence the player cannot perform says nothing
about the game.

## 5.7 Final result — every authored string, full depth

`.qa/chain-depth.ts` (exported `runString`, so the test uses the same code
path as the report):

| string | pinned | chasing |
|---|---|---|
| `l1-l2-l3-l4-l5` | **5/5** | **5/5** |
| `l1-l2-l1-l2` | **4/4** | **4/4** |
| `h1-h2-h3` | **3/3** | **3/3** |
| `l1-l2-h1-h3-l5` | **5/5** | **5/5** |

No whiffs at any depth, against a body that is actively closing. Before this
work the light string connected 2 of 16 in the bad case; the string now
completes.

## 5.8 Gates

**208/208** (7 in `tests/unarmed-step.test.ts`) · tsc 0 · pose-golden PASS ·
blade phantom-check unchanged (median −8px).
