# Dual-stance movement and empty-hand combat overhaul

[Plan, lessons and Reddit research](DUAL_STANCE_PLAN.md). Community critique
was used as feedback, not as anatomy authority or proof of biomechanical realism.

## Equipment is now a deliberate choice

**Q draws/sheathes.** Run, jump, dash, ordinary attacks, guard, charge and ability
no longer silently pull the sword out. Drawn mode no longer auto-sheathes after
1.2 seconds of standing still. Ritual interruptions preserve whichever side of
the actual steel visibility gate has already been reached.

HUD and How To Play now distinguish EMPTY HAND / SHEATHED from the drawn sword.
Gear selection remains available, but fists do not inherit sword damage/speed
multipliers. The drawn sword keeps its existing progression, cuts, arc solvers,
blade contacts, abilities and cinematics.

## Two movement libraries, one physical gait

`equipment-motion.ts` caches equipment-specific upper-body variants of idle,
walk/run/sprint, combat advance/retreat, jump/leap/double jump/fall, land/stop and
dash. Logical clip names and clocks are preserved; the equipment tag and clip
identity distinguish variants. Leg cadence and force clocks are not duplicated.

- Sheathed running uses opposed free hands; airborne arms gather compactly.
- Sheathed guard keeps both hands ready instead of welding a fist to the hilt.
- Sheathed dash gathers both arms behind the drive, without drawing steel.
- Drawn travel/air/dash keeps a bent sword arm and counter-solves the wrist for
  a stable rear-up carry. Guard and landing present a controlled forward-up edge.
- Rear-carried blades render behind the opaque torso, rather than showing a
  bright line through the ribs. Non-attack run/jump no longer generates attack
  smear fans just because a carry transition has high angular velocity.
- Ground/contact IK, sprint's 10Hz exposures, nine-key dash posing and recent
  velocity-matched transition corrections remain in place.

## Real empty-hand combat, not hidden sword animations

`unarmed.ts` supplies equivalents for all **20 existing attack intents** using
seven core families: jab, cross, hook, elbow, palm, uppercut and hammer. These are
20 mapped intents, **not 20 wholly unrelated motion-capture sequences**. Air,
dash, heavy, charged and counter inputs select the appropriate family/timing.
Each clip has seven authored keys: guard, chamber, transfer, contact, recoil,
recovery, guard. The other hand stays ready. Uppercut reach was corrected during
sheet review so the fist does not swing over the skull.

- Actual distal forearm-to-knuckle geometry supplies swept hit segments.
  Elbow strikes use the elbow/proximal upper-arm segment instead.
- Short 5–7px padding, no hidden katana-length volume or dash-cut corridor.
- No sword arc solver, blade whip, elemental sword proc, blade overshoot,
  slash trail or phantom pooled trail object for empty-hand attacks.
- Knockback follows the fighter's facing for hand contacts, not the incidental
  direction of a bent forearm segment.
- Combo intent IDs remain stable, so existing chaining/cancellation rules work.
- Bare-hand parry uses a forearm guard pose; charge gathers one hand behind the
  support guard. These are arcade guard mechanics, not advice for bare-hand
  defence against real swords.
- Sheathed U spends energy on a 30-damage contact-based focused strike. Ground
  and air use appropriate poses, without falling back to a weak generic jab.
- Sheathed full-meter I uses a 65-damage contact finisher. Sheathed E uses a
  40-damage guard-break strike, not the old invisible-sword execution cinematic.
  These do not duplicate the drawn sword's multi-target cinematic/HP-restoration
  behavior; balance/parity remains a playtesting question.

## Important correction after the first browser review

The first new jab was softened past its hit window. Passing unit checks was not
enough: the image showed a late guard rather than contact. Corrected three causes:

1. The hilt-rest overlay cannot overwrite an active attack or threat guard.
2. Unarmed authored arm motion bypasses the extra generic arm tracker; core and
   legs still track anatomically. The hand-space entry bridge remains active.
3. `armBlendLimit` makes arm residuals finish before contact, while the core can
   retain a longer inertial handoff. Neither the hit window nor input is delayed.

An added regression requires >29 rig units of forward jab reach **inside** the
active hit window. The corrected browser capture measured ~31.8 units.

## Evidence and validation

- `bun run check`: **95/95 tests**, typecheck/lint and animation/continuity audits.
- `bun run build`: successful. `git diff --check`: clean.
- New coverage: all 20 empty-hand intents, bounded keys, mode-preserving inputs,
  distinct equipment poses with identical leg clocks, explicit Q draw, persistent
  drawn mode, near/far hit reach, once-only hit, zero pooled slash trails, elbow
  contact endpoint, air heavy, powered air/ground attacks and actual contact timing.
- [Nine-second real-speed capture](dual-stance-gameplay.webp): 540 frames at
  60Hz from 1,080 updates at 120Hz. Both modes, free air jab, ground jab/cross,
  heavy/charge/guard, dash, Q draw, drawn run/leap/cut/heavy/parry. No JS errors,
  every pose finite. [Report](dual-stance-browser.json).
- [Actual live-browser enemy contact check](dual-stance-contact.json): nearby
  enemy takes **12 damage**, far enemy at 155px takes **0**, steel stays home,
  pooled slash trails **0**. Sheathed ultimate and explicit Q draw verified.
- [Movement comparison sheet](dual-stance-movement.png).
- [Empty-hand contact-key sheet](dual-stance-combat.png).
  Both are actual production-rig FK studies, not AI motion evidence. Final
  gameplay uses transition/contact solvers. Regenerate using
  `node --import tsx scripts/render-dual-stance.ts`.

The main capture was refreshed after the late-contact correction and drawn-carry
render correction. The final live contact check also ran against the final build.
Offline simulation captures are not device performance benchmarks.

## Limits, not concealed promises

This is a substantial dual-stance implementation, not a claim that every drawn
attack has been re-authored or that full-body physics/self-collision is solved.
Existing drawn cut animations and enemy art remain. New hand attacks share
purposeful family vocabulary; ultimate/execution balance and combat feel need
longer player testing. The source research was searched text excerpts, plus
actual gameplay/frame review—not newly downloaded boxing motion capture.
