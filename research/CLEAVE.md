# Cutting through a pack: why the blade "stuck"

## The report
"When I have the blade I should cut through enemies and not get stuck."

## What it actually was

Nothing was blocking the player — there is no enemy body collision in this
engine at all (verified: no push-out/separation code exists). The player
could always walk through a crowd. What read as "stuck" was the *cut*
failing to register on everybody beyond the first body.

## Method

`.qa/blade-cleave.ts` builds a real `Player` + real `WorldRef` (the same
shape `tests/dash-combat.test.ts` uses), lines up N grunts at fixed
spacing, fires a real attack, steps the player for the whole swing and
counts how many bodies took damage.

It immediately exposed **a flaw in the test itself**: the first version set
`swordDrawn = true` for every attack. But `updateBladeWorld()` reads

    if (!this.swordDrawn && strike) { ...build the limb segment... }

so an *unarmed* attack is only ever resolved through its fist when the
blade is **sheathed**. Drawing the blade and firing an unarmed move is a
state the game never enters. Testing it reported "stuck" for a dozen moves
that are perfectly fine.

After fixing the harness to mirror the real state:

| group | cleave |
|---|---|
| sword attacks (l1 l2 l3 l5 h2 stabs dashSlash dashHeavy powerSlash charged riposte srIai srOmega) | **5/5** |
| sword heavies that lunge hard (l4 h1 spin retreat) | 4/5 |
| unarmed strikes (cyclone viperPalm ironRoot srOnslaught …) | 2-3/5 |

## The three real findings

### 1. An unarmed fist physically cannot reach a second body
`PLAYER_SPEC` gives an arm of `upperArm 22 + foreArm 20 = 42` local units,
which at `SCALE 1.32` is a **55 px** maximum reach measured from the
shoulder. `handPose()` clamps at `a + b - 2`, so asking for x = 40, 44, 48
or 52 produces the identical pose. With the torso at ~400 px, the fist tops
out around x = 461 — and the second body in a 26 px spaced pack sits at 486.

That is not a bug, it is anatomy. An empty hand should not cleave a crowd;
the fantasy is satisfied by the **blade**, which reaches 558 px on `l1`.
The unarmed spins are therefore expected to hit 2-3 bodies and that is
correct behaviour, not a defect to chase.

### 2. A `moveX` lunge can carry the body PAST the first enemy
`l5` has `moveX 240` firing at `moveXAt 0.20` while its hit window opens at
`0.22`. The body launches before the blade is anywhere near the target, so
enemy 1 is already behind the player when the window opens — the swing
damages bodies 2-5 and skips the nearest one. Same shape on `h1`
(`moveX 200` @0.24 vs window 0.28).

Contrast `dashSlash`: `moveX 560` but it declares a `corridorBack/Front`,
so the sweep covers the whole travel path and it still cuts 5/5.

**Rule:** a strike that lunges must either open its hit window before the
lunge, or declare a corridor. Otherwise it always misses whatever it
launched past.

### 3. Kicks left the sword arm folded, which also broke the blade
`AXEKICK`, `SPINHOOK` and `STEPKICK` are kick clips. They authored `shR`
but never `elR`, so the elbow inherited the base pose's `-2.57` — folded
~145°, putting the drawn blade tip *behind* the player (measured tipX 24,
-52, -58). Fixed by giving each kick a real sword-arm extension at the
strike beat. `stepKick` additionally had `shR = -0.55` (shoulder rotated
*backward*), so even a straight elbow sent the blade away from the target.

Result: axeKick 2→5, spinHook 2→5, stepKick 2→5 on the sword path.

## Dead ends (do not repeat)

- **Subdividing the swept quad.** Added a version that resampled the blade
  motion into steps of half the smallest body sphere to cover the 80-180 px
  jumps the 1/24 s stepped clock creates. Measured **zero** change on every
  attack. The jumps are not the problem; reach is. Reverted.
- **A "cut arc" helper.** An intermediate version passed 8 arguments to a
  7-parameter function, which silently shifted the curve points and produced
  a fake 5/5 result. Caught it by re-measuring; the corrected version
  regressed. Reverted.
- **Trusting a single harness state.** The biggest error of this whole pass
  was not the code, it was measuring an impossible state (blade drawn +
  unarmed attack) and reporting its consequences as defects.

## Where it stands

**41 of 48 attacks cut 5 of 5. 47 of 48 cut 4 or better.** Every attack now
damages the FIRST body — the original complaint ("stuck on the first body")
no longer reproduces anywhere in the kit. The single attack below 4 is
`ultPalm`, a five-contact palm barrage whose blade oscillates forward and
back through its window, so the two far bodies are reached on the forward
phases only.

The six remaining 4/5 cases all miss **body 5 only** — the farthest body,
sitting at the exact edge of the blade's reach. That is reach, not a defect.

### Frame-rate independence

Measured at 30, 60, 90, 120, 144, 165 and 240 Hz: **zero attacks change how
many of the first four bodies they hit.** Only the single far body at the
very edge of reach can flip, and only because reach is sampled at tick
boundaries — the true peak (`l4` 115, `srCross` 112) is only ~1px beyond what
either 30 Hz or 60 Hz samples. A coarser tick actually *overestimates* the
swept region, so 60 Hz is the honest number.

## The final architecture

The first fix used a hand-tuned corridor rectangle. It worked but it was
wrong in principle: an enemy could be cut by a blade the player never saw
pass through it, which breaks this engine's contract that visual contact IS
gameplay contact. It was replaced by `SweptEdge` in `player.ts`: the world
segment the drawn blade has actually occupied, sampled every 10px so
consecutive samples always overlap, recorded for the WHOLE swing (not just
the hit window — h1 and sakugaHammer overrun their first body during the
anticipation). An enemy is cut if it intersects any recorded position.

Two holes close geometrically with no magic numbers:
- the grip sits ~50px out, so the edge *begins* past a tightly-spaced enemy;
- a lunge carries the body over the row mid-swing, leaving the nearest enemy
  behind the blade.

It also subsumes the old tunnelling worry for free: the samples are real
positions, so the 80-180px frame-to-frame jumps from the 24fps stepped clock
can no longer skip a body lying between two poses.

The dash through-cut keeps its authored corridor, because there the *body*
crosses the target rather than the blade, so the blade-only segment is
genuinely the wrong witness.

## Regression cover

`tests/blade-cleave.test.ts` pins all of it: the 26px floor for every attack,
that spacing does not change the depth of the cut, that no attack may damage
bodies 2-5 while doing nothing to body 1, and that depth does not depend on
frame rate.

`research/cleave-visual.png` is the visual proof: the real `BODY_SPHERES` at
their true heights, hit for real, each body marked hit or not.
