# HAND-TO-HAND — FLUIDITY, AND THE UX GAP REGISTER

Benchmarked against the reference studio rig (`Shadow_Ronin.html`: 7 sequences × 32 frames @ 24 fps),
measured against this repo's own code on 2026-11-11 with `.qa/reference-parity.ts`.

Every number below is reproducible: `npx tsx .qa/reference-parity.ts`.


## 1. The reference is three laws, not one

| law | reference | this repo before | now |
|---|---|---|---|
| **1 · BAKE** | keys expanded onto a 24 fps grid, each key's ease baked into the data (`t = EASE[b.e](t)`) | *absent* — sparse keys sampled directly; every authored ease was unreachable dead code | `bakeClip()` — `src/game/anim/bake.ts` |
| **2 · CADENCE** | `getDisplayP()` quantises the playhead to the sample rate, `BASE_FPS = 24` | continuous 60 Hz | `stepRate: 24` for empty-hand clips |
| **3 · DWELL** | the move *holds*: median **58 %** of its frames are nearly motionless, the strike lives in 1–3 frames, `slow{}` weights stretch the impact | every frame carried motion | `holdSnap()` — same file |

Law 3 is the one that actually reads as "fluid", and it is invisible in the source until you
measure it: the reference's keys are sparse (7–9 over 32 frames), so most frames are *between*
beats and barely move. Ours were dense (every 1–2 frames), so there was nothing to hold.

## 2. Measured, on each rig's own 24 fps grid

| metric | meaning | reference | ours before | ours now |
|---|---|---|---|---|
| **still** | share of frames under 10 % of peak speed | 23 – 87 %, median **58 %** | **0 %** (`l1`, `l3`) / 15–41 % | **32 – 57 %** |
| **peak/mean** | how concentrated the motion is (a smear ≈ 2) | 3.8 – 13.1, median **6.7** | **1.9 – 3.3** | **2.8 – 4.2** |
| **amplitude** | striking hand from the shoulder, in shoulder-to-hip lengths | 1.09 – 1.26 | 1.22 – 1.44 | unchanged (already correct) |

Amplitude was **not** the problem — an earlier reading of 0.60 was a measurement artifact
(§5). The defect was purely temporal.

### Per move, after this pass

| move | dur | frames | still | peak/mean | hit window |
|---|---|---|---|---|---|
| `viperPalm` | 0.60 s | 15 | 57 % | 4.0 | 0.238 – 0.363 |
| `avalancheElbow` | 0.79 s | 20 | 42 % | 3.6 | 0.374 – 0.511 |
| `cyclone` | 0.80 s | 20 | 32 % | 2.8 | 0.398 – 0.512 |
| `ironRoot` | 0.72 s | 18 | 35 % | 3.0 | 0.278 – 0.413 |
| `omegaPalm` | 0.98 s | 25 | 50 % | 4.2 | 0.489 – 0.685 |

Frame budget: the five showcase moves were 0.36–0.70 s (10–18 frames). At that length a windup,
a hold, a snap, a brace and a settle cannot coexist — every attempt traded one for another. They
are now 0.60–0.98 s (15–25 frames), still well under the reference's 1.33 s.

## 3. What changed in the code

- **`bakeClip()`** expands sparse keys through their authored eases onto the 24 fps grid.
  Fixes the root cause: `interpolation: 'monotone'` never evaluated `b.e(u)`, so *every* ease in
  the moveset was dead code and every move was a uniform smear.
- **`holdSnap()`** — the missing law. Given the contact time it re-times the dense grid:
  the approach keeps ≥ 3 frames (compressing it makes the chamber faster than the punch and the
  prep reads as the hit), the pre-contact pose is held still, the contact frame keeps its exact
  timestamp, the contact pose is braced for 1–2 frames, and the settle keeps ≥ 3 frames (else the
  retract becomes the fastest motion and the *recovery* reads as the strike).
- **`Clip.snapAt`** — the bake reports when the pose actually snaps, and `MOVES` re-anchors each
  hit window onto it (same width). The hitbox now follows the animation instead of being guessed
  beside it.
- **`stepRate: 24`** on empty-hand attack playback — the anime cadence. One constant
  (`UNARMED_STEP_RATE` in `player.ts`); the drawn sword stays continuous.
- Settle keys no longer spread `...G` (which reset `rootX` and teleported the body 8 px backwards
  faster than the punch).
- Contact frames retimed onto measured peak-limb-speed (`l1` 0.095, `l3` 0.105, plus the five).

`.qa/impact-timing.ts` scores every move: **16 / 47** empty-hand moves now open their hitbox on a
fast frame (was 10 / 47). It exits nonzero while any move in the showcase set is not `OK`, and
right now three are not — see gap 6b, which is a real defect rather than a regression. `.qa/reference-parity.ts` is the reference comparison harness.

## 4. Measurement traps worth remembering

- **`solveFighter3D` returns shared vectors.** Storing `g.handR` per frame aliases every frame to
  the last solve. This produced a fake "arms never extend (0.60)" result that nearly triggered a
  pointless re-authoring pass. Copy joints to plain `{x, y}`.
- **Joint speed is not contact.** Elbow and knee strikes pivot; the joint barely travels while the
  contact point whips. An automated retiming pass proposed putting `h1`'s hitbox on its recovery
  frame — the metric, not the animation, was wrong.
- **One frame of tolerance.** A 1-frame snap concentrates all motion into one 41 ms step, so a
  window that opens 5 ms early covers none of it. Windows are now derived from `snapAt`.

## 5. Gap register

**P0** = the hit reads wrong · **P1** = the exchange feels wrong · **P2** = polish.

| # | gap | symptom | root cause | fix | status |
|---|---|---|---|---|---|
| 1 | per-key eases ignored | smooth smear, no snap | `monotone` bypasses `b.e(u)` | bake eases into a frame grid | **fixed** |
| 2 | continuous 60 Hz playback | "interpolated", not anime | no cadence quantisation | `stepRate: 24` | **fixed** |
| 3 | no dwell | the strike shares the clip's velocity with everything else | dense keys, no holds | `holdSnap()` | **fixed** on 5 moves |
| 4 | hitbox off the fast frame | "I didn't even touch him" | windows hand-authored | windows derived from `snapAt` | **fixed** on 5; **31 / 47 moves still off** |
| 5 | reversal faster than strike | body springs backwards after a lunge | settle keys reset `rootX` via `...G` | decaying `rootX`/`rootY` | **fixed** on 3 clips |
| 6b | the wind-up is louder than the strike | on 3 of 5 moves the chamber moves faster than the punch, so the prep reads as the hit (the audit flags them `LATE/EARLY`, ratio 0.43–0.77) | authored chamber keys are a bigger pose change than the contact (rootY + chestYaw + hip/knee + rootZ all move at once) | shrink the chamber ~25 % or lengthen the wind-up | **open** — surfaced, not hidden: `.qa/impact-timing.ts` exits nonzero on it |
| 6 | legacy light chain untouched | `l1`/`l3` are 0 % still — pure smear, every frame moves | never passed through `holdSnap` | pass `contact` for the whole set | **open** — highest value left |
| 7 | no whiff feedback | a miss feels like input lag | nothing fires when the corridor is empty | whiff recovery + air-cut FX/sound | **open** |
| 8 | one flinch for every hit | jab and hammer react identically, so nothing has weight | `enemy.hit()` → single `stun`, `stunT = max(0.18, stagger)` | graduated flinch / interrupt / stagger | **open** — biggest "connect" upgrade |
| 9 | no directional recoil | enemies slide away instead of bending away from the contact point | `vx = dir * kb` only | recoil along the impact normal | **open** |
| 10 | telegraph is a timer | fast enemies (windup 0.26 s) feel unfair | `enemy.cfg.windup`, pose barely changes | unique readable wind-up ≥ ~0.25 s + buffer | **open** |
| 11 | hitstop not weight-scaled | light strings feel mushy | one number per move | 2–4 frames scaled by mass | **partly** |
| 12 | combos restart visually | body snaps to guard between links | 0.11 s crossfade, no authored link pose | per-edge link poses | **open** |
| 13 | recovery is dead time | 0.34 s of nothing after a whiff | fixed `postAttackT` | cancels sized to the move | **open** |
| 14 | generic smear | trail geometry shared with the sword | `emptyTrail` reused | smear hull along the swept arc | **open** |
| 15 | feet slide | grounded sinks look buoyant | no ground IK in the clips | solve foot targets (reference `bfx/bfy`) | **open** — biggest animation gap |
| 15b | limb mass reads as a brute | arms were 10 units across on a 22-unit upper arm — as wide as the skull — with a flare-pinch-flare profile (the "golem / diamond" read) | `humanoid.ts` arm radii `[5.15, 4.95, 3.65, 2.35, 3.65, 2.35, 1.35]`; fist drawn as four curled 3-segment polylines | lean monotone taper `[3.4, 3.2, 2.55, 1.7, 2.25, 1.85, 1.15]`, girdle narrowed 10.9 → 9.6, one-piece rounded fist sized to `PLAYER_SPEC.hand` | **fixed** |
| 16 | no secondary motion | the fist stops dead on impact | no wrist/hand lag layer | overlapping action, 1–2 frames | **open** |
| 17 | silent input buffer | pressing during recovery does nothing visible | buffer consumed only at `def.cancel` | show the queued action | **open** |
| 18 | connect feedback is partial | you can't tell a clip from a clean hit | impact flash only at `hitstop ≥ 0.07` | spark + pitch-matched sound on every connect | **partly** |
| 19 | the world ignores hits | heavy blows don't disturb anything | no dust/ground cue | environmental response | **open** |
| 20 | no camera punctuation on finishers | `omegaPalm` lands like a jab | `cam.addTrauma(shake)` only | zoom punch / FOV beat on the closer | **partly** |

## 6. Research rules this is built on

- **Hitstop 2–4 frames**, longer for heavier moves, freezing attacker *and* target
  ([mygamedesign](https://mygamedesign.com/what-makes-combat-feel-weighty-and-impactful/)).
- **Anticipation must be unique and readable**; player reaction ≈ 0.25 s, so a wind-up needs
  reaction + trigger + difficulty buffer ([GDKeys](https://gdkeys.com/keys-to-combat-design-1-anatomy-of-an-attack/)).
- **The enemy's reaction sells the hit more than the player's animation** — graduated reaction
  tiers (flinch < interrupt < stagger) sized to the move.
- **Impact is instant, located and directional**; follow-through and recovery resolve into idle so
  transitions are clean ([r/gamedesign](https://www.reddit.com/r/gamedesign/comments/)).
- **Animation priority layering**: attack > reaction > dodge > movement; 15–20 clips is the viable
  minimum set, with anticipation / hit-stop / follow-through as the trio.

## 7. Next by leverage

0. **Gap 6b** — shrink the five chambers ~25 % (or buy the wind-up 3 more frames); it flips the
   last three audit failures and makes the prep quieter than the hit.
1. **Gap 6** — run `l1…h3` through `holdSnap` (they are the moves the player presses most, and they
   are still 0 % still). Needs a contact time per move; 30 minutes of work, biggest visible win.
2. **Gap 8 + 9** — weight-matched reaction ladder with impact-point recoil.
3. **Gap 15** — port the reference's IK legs so sinks and lunges plant.
4. **Gap 14** — smear hulls on the 1–2 frames the pose holds.
