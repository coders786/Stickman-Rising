# Deeper anime sprint, tactical burst dash, storm corrections

## Movement and dash

- Sprint core pitch increased by 0.145 radians (~8.3°) over the last version.
  Head counter-pitch follows it; lumbar flex remains 0.04 radians. Existing
  gait/contact physics, 10Hz sprint acting and both equipment libraries remain.
- Forward dash drive keys peak at 0.84 radians (~48°). Arm bending, joint limits,
  nine-key acting and momentum-earned reversals remain; no faster global clock.
- Surrounded escape re-authored as a low diagonal weave, peaking at 0.70 radians,
  instead of a near-upright transverse spin. Pelvis yaw is restrained to 0.48.
- Snapshot live enemies on both sides at dash input, excluding dead/spawning
  enemies and enemies >150px vertically away. A two-sided pocket within 220px
  immediately chooses carve, without waiting for damped proximity state.
- A rear pursuer within 220px selects the fleeing drive; a close enemy ahead
  selects pierce, a distant target selects hunt. Airborne and reversal priorities
  remain. Variants depend on geometry, not a new animation for each enemy species.
- Propulsion emits one extra sharp leading motion accent; hunt gets denser speed
  streaks; surrounded escape gets crossing breakaway accents. These fire once
  when the force motor really drives, never during load/reversal bracing.
- Damage and invulnerability windows are unchanged. No global speed or i-frame
  buff was used to pretend the dash feels stronger.

## Concrete storm bugs corrected

1. Near rain used different render/collision coordinates. Near droplets now
   share their screen-space fall path and floor collision coordinates. Their
   gust slant is identical in update, body streak and bright tip rendering.
2. Near droplets passed through the roof after splashing. They are consumed and
   recycled at the roof instead. Far/mid rain remain distant atmospheric layers.
3. Splash rings were stored in screen coordinates and slid with the lens.
   Impact positions are converted to world coordinates and reprojected each
   frame, including camera movement/zoom. Ringbuffer storage remains bounded.
4. Rain assigned `globalAlpha = 1 + 2.6*lightning`; Canvas ignores out-of-range
   assignments. The rain now has an explicit valid 0.42–1 brightness envelope.
5. The bolt used its own brightness during the dark inter-stroke beat. Bolt,
   bloom and scene response now share the same multi-strike intensity envelope.
6. The wet-floor player redraw duplicated world-space attack smear, point light
   and parry aura. Reflection redraw now stops after character/weapon geometry;
   scene lens/aura overlays do not get emitted again by the mirror pass. Existing
   mirror floor clipping, depth fade and lightning-dependent opacity remain.

## Checks and evidence

- `bun run check`: **98 tests pass**, typecheck/lint and animation audits pass.
- `bun run build`: passes; `git diff --check`: clean.
- New regressions cover immediate surrounded/pursuer/target selection, preserved
  airborne/reversal priorities, near-drop roof recycling, world-space splash
  coordinates, and bounded deep-weave keys/gaze. Previous sprint expectations
  were updated for the deliberately stronger angle, not removed.
- `anime-storm-browser.json`: final production browser, 480 updates at 120Hz,
  120 captured frames at 30Hz, 170 rain drops, forced lightning strokes, no JS
  errors, all poses finite. Observed variants carry/carve/hunt/launch. Captured
  actual sprint core pitch peaks near 0.599 radians. Input's real-time clock was
  controlled during offline simulation so double-tap sprint is actually tested.
- `anime-storm-gameplay.webp`: four simulation seconds in real-speed playback.
  Includes sprint/storm, carry burst, two-sided escape, hunt and drawn dash.
  Reviewed lightning/sprint and surrounded frames. This is an offline simulation
  capture, not a device performance benchmark or proof every possible weather
  artifact is eliminated.

No full fluid simulation, screen-space ray tracing, new enemy art or species-
specific dash behavior is claimed. Deeper lean is intentional anime stylization,
not a claim of realistic sustained human running mechanics.
