# Weather engine replacement

## Why the prior pass did not solve disappearance

The old background constructor allocated zero rain on low quality. The automatic
performance governor can lower quality once gameplay starts. Game.applySettings
then constructed a new background, resetting lightning's countdown each time.
Earlier offline animation captures disabled the governor and forced lightning;
they did not exercise this lifecycle. The user's screenshot exposed that gap.

## Replacement, not a parallel fallback

Removed the old rain arrays/update/render loops, splash engine, lightning
scheduler, bolt sprites, bloom sprites and flash sprites from background.ts.
Over 400 lines of the old background weather implementation were removed.

New src/game/world/storm.ts owns the complete rain/roof-impact/lightning pipeline:

- Game owns one persistent StormEngine. City-art reconstruction receives that
  same instance; neither quality switches nor game starts recreate weather.
- Separate visual clock ticks once per unpaused game frame, outside combat
  hitstop/slow-motion. Pausing freezes weather. Long frame integration is bounded.
- Three quality budgets: low 96 / medium 180 / high 288 drops. Low means cheaper,
  never clear skies. A fixed 288-particle simulation survives budget changes.
- World-space particle trajectories and world-space roof impact coordinates.
  Drawing projects them through one camera. Floor clipping prevents rain passing
  through the roof; impact ring storage is bounded at 64 records.
- Camera migration replenishes exposed sky; viewport size is independent of DPR.
- Seeded natural strikes: first sequence after ~0.85 visual seconds, then 4–7
  seconds between sequences. A single envelope drives viewport bolt, sky bloom,
  scene flash, existing floor response and cast-light consumers.
- No DOM/canvas dependency in simulation; rendering never advances simulation.
- Existing skyline, arena art, fighter animation, equipment modes and gameplay
  remain intact. This replaces weather, not the whole game or city-art engine.

## Verification

`bun run check`: **101 tests pass**, typecheck/lint/animation audits pass.
`bun run build`: successful. `git diff --check`: clean.

New tests cover rain on every quality, natural lightning through repeated quality
changes, persistent ownership across city reconstruction, preserved callbacks,
side-effect-free rendering, visible low-quality rainy pixels, invalid-input
handling and natural viewport bolt rendering. The obsolete private-array test
for the deleted engine was removed rather than retained against dead code.

Actual production-browser check (`storm-reboot-browser.json`):

- Clicked ENGAGE; normal requestAnimationFrame and performance governor enabled.
- Rain visible during gameplay on low: 96 drops.
- Medium/high/low changes preserve engine identity and exact clock value.
- Browser resized from 1000×600 to 1100×650; natural lightning continued.
- Two naturally scheduled strike sequences, 945 roof impacts, zero JS errors.
- No private strike-timer manipulation, forced strike, fixed offline frame
  stepping, wave disabling or governor bypass in this validation.
- Inspected `storm-reboot-rain.png` and `storm-reboot-lightning.png`; rain is
  visible in gameplay, including alongside enemies during the natural strike.

Counts describe this captured run, not an FPS benchmark. Lightning remains
intermittent by design; constant white flashing would obscure combat. This is a
stylized bounded particle renderer, not volumetric fluid simulation.
