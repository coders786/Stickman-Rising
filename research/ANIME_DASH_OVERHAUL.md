# Anime dash overhaul / longer readable drawings

This supersedes the previous fast-dash pose/timing pass, not the force-based
momentum system or the jump/draw transition work.

## Four more drawings, not four duplicate frames

Launch, chain and hunt now have **nine authored keys instead of five**.
The new release, stretched drive, gather and rebound keys change leg support,
center height, core lean and off-hand placement. Launch authored timestamps:
0, **28**, 60, **103**, 160, **195**, 225, **265**, 300 ms (bold = added key).
Chain mirrors the support stride; hunt advances the long drive.
Carry has **eight keys instead of four**, retaining a momentum-matched entry.

Forward dash curves now use shape-preserving C1 interpolation to flow through
these breakdowns. Physics-driven clip retiming still aligns peak push with
peak force, so authored key timestamps are not a promise of the same displayed
wall-clock timestamp. Every switch still uses the visible-pose transition seed
and at least three intermediate samples from the preceding pass.

## Longer visibility, without a sluggish motor

| Variant | Previous state | New state | Independent motor pulse |
| --- | ---: | ---: | ---: |
| Launch | 220 ms | 300 ms | 112 ms |
| Chain | 215 ms | 295 ms | 112 ms |
| Carry | 210 ms | 290 ms | 117 ms |
| Hunt | 240 ms | 320 ms | 125 ms |

Load remains short (~8–27 ms). `driveDuration` separates motor impulse timing
from the longer animation state. The silhouette remains low through stretch
and flight instead of straightening immediately. Braking force is retuned for
the longer coast/catch; continuous exit momentum survives, with no speed clamp
or velocity teleport. Power governor and frame-rate-stable integration remain.
Invulnerability durations are **not extended**. Attack cancels remain immediate.
Retreat, vault, air, pierce and pivot preserve their distinct tactical behavior;
we do not blindly make a guarded backdash lean forward.

## Sprint lean and continuous body curve

Sprint's core pitch increases by another 0.035 radians (~2°); the power-stride
additive is slightly reduced to keep it controlled. Lumbar contribution is
0.04 radians, and gaze still counterbalances the full lean. Sprint's 10Hz art
exposures, continuous travel, contact cadence and natural hand arc are unchanged.

The pure-black torso outline now follows the solved waist with a shallow
bounded C-curve instead of a rigid straight hip-to-chest slab. Its contour bow
is capped at 1.5 rig units and never moves rig landmarks, foot contacts, weapon
grips or hitboxes. No colored anatomy lines, eyes, ponytail or joint discs added.

## Evidence

- [Nine-key actual-rig sheet](anime-dash-nine-keys.png), generated with
  `node --import tsx scripts/render-anime-dash-sheet.ts`. Pre-contact design
  targets, not an AI sheet. Thin weapon lines show solved endpoints; the real
  game retains final weapon and foot constraints.
- [Real-speed gameplay](anime-dash-gameplay.webp): five seconds / 300 samples
  at 60Hz; launch, sprint-to-carry, reversal and recovery.
- [Browser report](anime-dash-browser.json): 600 updates at 120Hz, finite poses,
  zero JavaScript errors; launch, carry and pivot verified. Actual constrained
  leaned-drive visibility above 0.65 radians: **150ms launch / 192ms carry**.
  Observed peak speed ~1104 px/s, peak core lean ~49°.
- `bun run check`: **77/77 tests**, typecheck/lint and animation/continuity audits.
  New tests enforce exactly four added keys, anatomy, balanced gaze, continuous
  sprint seam, >=95ms readable drive, <130ms to 800px/s and unchanged immunity.
  Existing force, wall, gravity, momentum and every-clip switching tests pass.
- `bun run build`: successful. Offline capture is not a device FPS benchmark.
