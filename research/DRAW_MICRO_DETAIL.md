# Draw / grip / dash micro-detail pass

## Readable draw sequence, not full-weapon visibility at 120 ms

The deliberate Q draw retains its quick 300 ms action but now uses one shared
presentation clock (`anim/draw-detail.ts`):

- 0–65 ms: reach, seat fingers around the tsuka, close the grip. The sword stays
  at the saya mouth while the hand approaches; it does not follow an unseated
  palm through the air. A quiet collar/grip sound occurs when the grip closes.
- 65–190 ms: progressive extraction, paired with left-hand saya retraction/lift.
  The rendered saya is a clipping/occlusion boundary: only steel past the mouth
  appears. This replaces the old full-sword visibility gate at 120 ms.
- 190 ms: tip clears; `swordDrawn` changes and the existing draw accent fires.
- 190–265 ms: blade turns into guard and the saya returns smoothly to the hip.
- 265–300 ms: final guard settling and normal weapon-render handoff.

Final projected hand-contact solving runs AFTER generic smoothing and before
contact/foot capture. A bounded Jacobian solve adjusts shoulder/elbow channels
inside existing joint limits, without stretching bones. Both hands participate:
right hand follows the hilt; left hand supports the moving mouth. The scabbard
lifts/rotates during opposition so arm targets stay within reach. The fist is
redrawn in front of the tsuka during the ritual, so steel does not visually paint
over the gripping fingers. The hidden steel does not get a free-standing attack
smear that conceals extraction.

The saya now uses the equipped blade's actual length rather than 88% of the
base sword length, avoiding a visible mismatch for weapon range upgrades.

## Dash preparation

Stationary launch load is now 48 ms, chain load ~35 ms, hunt load ~42 ms. Carry
entry stays short (~8 ms), because an already-running fighter should not stop
and recoil just to dash. Existing reversal/airborne/retreat conditions remain.

Pose retiming moves through the preparation drawing during the force load;
propulsion peak maps to the forward drive drawing. The motor pulse stays 112 ms
for launch, existing invulnerability is unchanged, and the dash sound now fires
with the actual once-only propulsion event—not on button-down while still
bracing. Grounded force response still adds compression and bent elbows.

## Evidence

- `bun run check`: **104 tests pass**, typecheck/lint/animation audits pass.
- `bun run build`: successful; `git diff --check`: clean.
- New tests check monotone continuous steel reveal, fingers closed before
  extraction, coordinated saya motion, hand contact during actual Player updates,
  equipment arming after clearance and retained interruptibility before clearance.
- Existing old gate assertions were updated from 120 to 190 ms; prior draw-finger
  tests now allow the deliberate approach-open gesture before the grip closes.
- `draw-micro-detail.png`: twelve actual Player update/render samples, 0–300 ms,
  not an AI sheet. Generated with `node --import tsx scripts/render-micro-detail.ts`.
- `micro-detail-browser.json`: production gameplay capture, 180 updates at 120Hz,
  90 frames at 60Hz, no JS errors, all poses finite, visible partial steel before
  arming, dash sound during drive. Maximum sampled extraction hand-target residual
  was ~2.6 rig units—not claimed to be mathematically perfect zero-error contact.
- `micro-detail-gameplay.webp`: real-speed draw/settle/dash/recovery sequence.
  Offline frame stepping and a close camera were used for detail review; this is
  not a weather lifecycle or device performance benchmark. The persistent storm
  engine remains in use.

Scope: this pass targets deliberate drawing, gripping and dash preparation.
Sheathing's insertion path and emergency interruption of a partially extracted
blade are not a full continuous collision-constrained weapon simulation. Existing
stance-preserving interrupt rules remain; the new visual extraction is not an
extra damaging sword attack.

Frame review also caught stale foot anchors when resetting a running player to a
new spawn: reset now reseeds the gait and hip support before a draw can begin.
A regression covers this so the preparation does not float toward old anchors.
