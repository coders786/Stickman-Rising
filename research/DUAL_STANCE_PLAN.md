# Dual-stance animation and combat overhaul — implementation plan

## Lessons carried forward

More keys and frozen-pose crossfades did not solve credible transitions. Keep
velocity-matched hand-space transitions, displayed-pose seeding, anatomical
limits, force-driven dash, distance-driven gait and final contact/grip IK.
Do not add startup delay just to show anticipation. Do not use a hidden sword
hitbox or sword-length reach for a punch. Do not claim universal biomechanics.

## Research notes (community feedback, not anatomical authority)

- r/Games, “How to Animate a Fighting Game” (2018): startup/recovery must fit
  frame data; long windups can make the player unresponsive.
  https://www.reddit.com/r/Games/comments/8kj5zi/how_to_animate_a_fighting_game/
- r/animation, “simple punch animation” (2025): anticipation alone is not
  enough; release, torso-to-arm transfer and a supported final pose matter.
  https://www.reddit.com/r/animation/comments/1pjiaw2/simple_punch_animation/
- r/animation, “Punching Bag Animation” (2024): non-striking hand retains
  guard, proportions remain stable, feet should not drift on recovery.
  https://www.reddit.com/r/animation/comments/1d6ndmb/punching_bag_animation/
- r/animation, “A fight scene from my fantasy animation” (2025): smoothness
  without attack/recovery timing can read as slow, weightless dream motion.
  https://www.reddit.com/r/animation/comments/1mmslpu/a_fight_scene_from_my_fantasy_animation/

These are searched discussion excerpts, not videos decoded or motion-capture
measurements. Apply them as critique, not consensus or formal medical advice.

## Ordered work

1. Separate equipment intent: Q deliberately draws/sheathes. Movement, dash,
   ordinary attacks, parry, charged attacks and ability do not silently draw.
2. Author sheathed locomotion/air/guard variants and drawn weapon-safe carries,
   preserving leg cadence and original force/contact clocks.
3. Create empty-hand jab/cross/hook/elbow/palm/uppercut/air/dash/heavy families.
   Each has chamber, transfer, contact, recoil and guard; non-striking hand
   stays active. Map existing combo intents centrally, retaining combo IDs.
4. Use actual fist/forearm swept segments and short padding for empty-hand
   hits. Disable blade solver, trails, blade overshoot and elemental sword
   procs during empty-hand combat. Keep drawn attacks on their real blade.
5. Integrate guard/charge/counter, ability and cinematic entry semantics; audit
   mode changes and interruption paths for phantom blade events.
6. Test both modes, combo intent, hit reach, geometry, cancellation, stance
   variants, special inputs and existing movement/transition regressions.
7. Build and exercise actual browser gameplay; inspect chronological frames,
   render actual-rig comparison sheet and publish a real-speed clip. Record
   limitations rather than pretending this is full-body physical simulation.

## Acceptance

Steel stays visibly and mechanically home in sheathed play. Normal combat
inputs deliver empty-hand attacks. Q switches intent explicitly. Drawn attacks
retain sword arc/contact gameplay. Distinct silhouette and hand carriage in
run/jump/dash/guard, no visible bones/capsules, pure-black body and no ponytail.

## Completed pass

Implemented the equipment adapter, all 20 empty-hand intent mappings, visible
short contact geometry, guard/charge/power/cinematic routing, explicit mode UX,
95-test validation and two actual browser reviews. The first review exposed a
late-contact jab; it was corrected and the capture repeated. Full outcomes,
artifacts and remaining limits: [DUAL_STANCE.md](DUAL_STANCE.md).
