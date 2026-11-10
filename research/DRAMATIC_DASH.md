# Dramatic dash / explosive core drive

> Superseded dash posing/timing: [nine-key anime overhaul](ANIME_DASH_OVERHAUL.md).
## Reference interpretation

This pass builds on the reference vocabulary already documented in the
`clips.ts` conditioned dash library: Sword of the Stranger / MGR:R iai launch,
Naruto-style momentum carry, and fencing / Sekiro closing and guarded recovery.
These are stylized silhouette influences, not newly measured motion capture or
claims of frame-exact reproduction. Existing running/arm studies remain in
[the three-sheet reference pass](SPRINT_10HZ_ARMS.md).

The composition is low load → long rear support / diagonal core → compact
trailing off hand → lead-foot catch. It deliberately avoids a waist-fold,
rigid straight elbows, extra spins, or applying forward lean to guarded retreats.
The sword hand and final blade/contact constraints remain authoritative.

## Changes

- Launch push: 0.80 radians (~46°) authored core lean; flight 0.76 (~44°).
  Running carry push: 0.79 (~45°). Bounded acceleration adds up to 0.055 radians;
  actual rebuilt gameplay peaked at ~49°. Lumbar bend remains 0.025 radians;
  head counter-pitch remains within the existing anatomical limit.
- Off hand sweeps compactly behind the ribs during push/flight, then gathers
  into the catch. Chain mirrors the support stride rather than looping steps.
- Launch duration **260 → 220 ms**, speed multiplier **1.00 → 1.15**,
  load **47 → 26 ms**. Carry **250 → 210 ms**, multiplier **1.08 → 1.20**,
  load **15 → 8 ms** (no redundant standstill recoil during a run).
- Chain **250 → 215 ms**, multiplier **1.06 → 1.22**; hunt **280 → 240 ms**,
  multiplier **1.16 → 1.28**. Retreat/vault/air/pierce timings unchanged.
- Finite-force motor, gravity, opposite-momentum brace, bounded chain power,
  continuous exit velocity and braking catch retained. No velocity teleport,
  global speed-up, hitstop, or slowdown added.
- One propulsion accent per dash: two short motion cuts, three speed streaks,
  grounded dust/shadow smear and modest camera/chroma accent. It requires real
  travel aligned with intent; it cannot fire during load or into a blocked wall.
  Three existing silhouette afterimages retained; no continuous particle spam.
- Sprint's 10 Hz acting is unchanged; dash immediately uses full-rate action.

## Evidence

- `bun run check`: **70/70 tests**, typecheck/lint and animation/continuity audits.
- `bun run build`: successful.
- Added regressions for time-to-800 (<130 ms), controlled peak speed, preserved
  catch and exit momentum, once-only burst, no load burst and burst reset.
  Earlier duration/lean assertions were intentionally updated for this request;
  anatomical constraints, head balance and finite-force tests remain enforced.
- [Browser report](dramatic-dash-browser.json): 600 simulation updates at 120 Hz,
  finite poses, zero JavaScript errors, launch/carry/pivot exercised;
  observed maximum speed ~1081 px/s and maximum core lean ~49°.
- [Gameplay](dramatic-dash-gameplay.webp): 300 samples at 60 Hz, five seconds at
  real speed. Offline sampling is not a device performance benchmark.
- [Pose study](dramatic-dash-study.png): actual production renderer, pre-contact
  targets, regenerated with `node --import tsx scripts/render-ninja-study.ts
  research/dramatic-dash-study.png`.
