# Minimal athletic shadow fighter / walk and anime-hand pass

## Remodel

The production continuous-surface renderer now has a stronger deltoid/upper-arm
silhouette, shoulder-to-waist taper, narrower pelvis, leaner thigh profile and
clearer calf-to-ankle taper. Removed the thigh-length gi hems: in profile they
merged into a low, bulky crotch and obscured knee separation. The jaw/crown is
more compact, with short untied hair. A short waist tie remains.

All body pixels remain pure #000, including face/hurt frames: no eyes, muscle
lines, armor, joint discs, colored costume or ponytail. Anatomy is communicated
by the exterior contour, not bodybuilder shading or interior decoration.

The existing adult rig lengths are deliberately preserved: 32-unit torso,
20+18 arms, 25+24 legs. Shoulder sockets, fist reach, blade contacts and draw IK
are not moved to manufacture a larger fighter. This is an athletic stylization,
not a medical measurement or a new physics/motion-capture rig.

## Walk corrections

- Step cycle distance 110 → 90 world px; stance duty .64 → .60.
- Lower swing clearance 11 → 8 and toe-off rise 7 → 4: less lifted-knee shuffle.
- Walk park width 9, rather than inheriting the wider default martial stance.
- Walk-specific pelvis support floor .88 of nominal leg height instead of .74;
  combat crouch, running, airborne and ritual support retain their own behavior.
- Removed the moving walk's strong right-hand hilt-rest overlay; it fades out by
  45px/s, so the free hand can actually swing instead of staying pinned at the hip.
- Fixed asymmetric low-speed hand targets: the right free hand previously used
  the high run reference Y while the left used the relaxed walk Y. Both now have
  equal low-speed vertical reach and opposite horizontal swing.

At 100px/s the new walk is a brisk ~2.22 footfalls/sec, not a slow 1.82/sec stride
that leaves the stance foot far behind the pelvis. Keyboard full-speed run is
still 350 and sprint still 480. No walking input or physics speed buff was added.

## Anime-inspired hand acting

- Stronger run reference arc: compact forward recovery, elbow-led downward/back
  sweep and delayed wrist recovery. Sprint retains its authored power-stride path
  and deliberate 10Hz exposure system.
- New `dashHandMotion` supplies load/gather → rear stream → catch/re-guard paths.
  It animates actual shoulder/elbow targets, not just detached finger overlays.
- Surrounded carve lifts the off hand defensively; retreat/vault keep it forward.
  Sheathed dashes animate both hands. Drawn dashes keep the right hand on its
  established sword carry while the left follows the contextual path.
- Wrist follow-through and finger release increase through propulsion, then
  gather for catch. Sword-held right fingers remain closed with zero gesture roll.

## Validation

- `bun run check`: **106 tests pass**, typecheck/lint and animation audits pass.
- `bun run build`: passes; `git diff --check`: clean.
- Existing pure-black surface, joint-limit, grip, draw-extraction, attack-reach,
  dash motor, gait continuity and storm lifecycle tests remain active.
- New tests exercise both equipment modes for four seconds of actual walking,
  require a supported pelvis above -56 world Y, constrain foot reach, check equal
  free-hand walking height and meaningful dash preparation/drive/catch variation.
- `athlete-walk.png`: actual Player updates/contact IK, six samples per equipment
  mode at 98px/s. Regenerate: `node --import tsx scripts/render-athlete-walk.ts`.
- `athlete-browser.json` and `athlete-gameplay.webp`: production-browser review
  of partial-input walk, full run, dash, recovery, Q draw and drawn walk. Offline
  stepping and close camera for animation inspection, not a performance benchmark.

Existing draw/grip micro-details and the persistent storm service are preserved.
