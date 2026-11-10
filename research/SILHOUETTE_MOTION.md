# Black silhouette, smooth stops, hands and three shadow-engine rewrites

> Historical pre-reference pass. White eyes, body flashes and storm rims below
> have been superseded by the [pure-black reference-driven revision](RUNNER_REFERENCE.md).
> The former walk/stop recording is retained as before evidence.

## Visual changes

The production player renderer now draws a matte **black silhouette** with
**white eyes**, a compact short swept head and **no ponytail**. Colored skin,
clothing planes, wraps, piping and waist tails are removed from the body pass.
The katana/scabbard remain separate game props. Temporary combat flashes and
very thin storm-lit contour edges are effects, not a return to colored clothing.

Every dash/ability echo uses this same renderer. No capsule or circular-joint
rig is reintroduced through the trails. The live actor is drawn after echoes.

## Smoother animation and stops

- Removed the 24Hz stepped attack clock; combat now interpolates continuously.
- Crossfades use C2 quintic weights and a bounded, decaying continuation of the
  previous pose velocity. This reduces the frozen-snapshot hitch at transitions.
  Wrist winding is still shortest-path blended; no inertial wrist extrapolation
  is allowed to disturb the weapon grip.
- New **seven-exposure, 500ms stop**: catch, load, absorb, rebound, settle,
  follow-through, rest. Continuous monotone interpolation fills all in-betweens.
- Releasing movement now triggers this clip. Zero velocity no longer aborts
  recovery; fresh input may interrupt to keep controls responsive.
- The last stop pose matches the first idle pose exactly. Joint constraints
  remain before contact/grip IK, so smoothing does not slide solved contacts.
- Small rendering improvement: the black surface uses flat fills, not the
  former per-limb cel gradients.

## Hands

`src/game/anim/hand-gestures.ts` covers idle, walk/run/sprint, stop/brake/land,
dash, jump/fall/air/vault, parry/charge, flourish/draw/sheathe, hurt/death and
attack fallback. Fingers curl/spread and wrists roll subtly, in the solved
forearm frame, without moving the weapon grip endpoint.

- Stop: off-hand opens to balance, then closes as the body settles.
- Locomotion: relaxed finger action and small phase-matched wrist motion.
- Dash: active compact hand, short opening through the push/flight.
- Air: open balancing hand; held sword remains gripped.
- Combat: gather/close through a cut, compact guard gestures, reaction release.
- Shortened the resting hilt from .36 to .28 blade lengths and changed both
  its rendering and IK target together: the resting arm no longer reaches as
  far forward. Off-arm keeps its authored swing.
- Repositioned the sprint free-hand targets lower and closer to the torso.

## Shadow rewrites — three implemented and tested passes

### Pass 1 — replace projection

Replaced the original skeleton-shadow projection code. Added pure, bounded
`projectGroundPoint`; finite handling for storm intensity, azimuth, joints,
elevation and direction. Ground projection uses world-space joint Y exactly
once. The old head code added jump height again, displacing the skull shadow
separately from the body. Initial suite: **31 passing tests**.

### Pass 2 — replace body/contact drawing

Replaced repeated translucent bone strokes with **one union fill path** per
figure. Crossing or duplicated limbs no longer multiply alpha into dark blobs.
Contacts use only actual foot anchors, not invented body-center contacts;
duplicates are deduplicated and airborne AO is suppressed. The sheathed blade
no longer casts the hidden full-steel shadow; the player's shadow skull radius
matches its actual head instead of the older oversized head. Suite: **33 pass**.

### Pass 3 — replace softness and compositing

Replaced unbounded nested penumbra accumulation with 1–3 bounded outside-in
passes whose opacity weights preserve the target center opacity. Altitude fades
and softens the shadow without applying a second position shift. Canvas state
is saved/restored, including blend mode. Removed the player's glowing interior
bone/round-head rim overlay; light now catches a thin outer silhouette instead.
Echoes render behind the opaque actor. Wet reflections are clipped below the
floor and restore the caller's canvas alpha/state. Shadow-pass suite: **35 pass**.

These were three successive code revisions with tests between them, not three
unused alternative engines left in production. Final production code is pass 3.

## Evidence and verification

- `shadow-ronin-model.png`: updated actual silhouette model plate.
- `ronin-stop-study.png`: seven actual rig exposures, before gameplay contact IK.
- `ronin-silhouette-stop.webp`: browser-captured walk → stop → recovery. Actual
  production rendering/contact IK, close-up camera, half-speed review playback.
  Canvas frames are resized to a consistent CSS size when the quality governor
  changes internal resolution.
- `ronin-silhouette-live.png`: actual gameplay still from the stop recovery.
- Final **39 tests pass**, with lint, TypeScript, animation and continuity audits.
- Optimized production build passes.
- Browser: zero JavaScript errors; stop clip remains visible for **32 60Hz frames**,
  including recovery at zero velocity, then returns to idle.
- Browser walk/sprint phase checks still agree to floating-point precision;
  reversal, jump and light attack exercised. Thighs stay 25 and shins 24.

Regenerate static art:

```sh
bun run art:player
node --import tsx scripts/render-stop-study.ts
```
