# Environment pilot: Rain Market and Wet Bridge Weather Fronts

**Status: retired pilot.** The player now enters [one procedural bridge](PROCEDURAL-BRIDGE.md) from Engage. The routes, code references, and commands below describe the frozen pilot checkout, not the current application.

This implemented the first rollout in the [environment plan](NEXT-GEN-ENVIRONMENT-PLAN.md). The accepted Wet Bridge remains `/`, and dry Night Station remains `/?stage=station`. With the preview flag on, choose **Try Rain Market** on the title screen, or pick an arena in title → Settings.

| Preview route | What to look for |
| --- | --- |
| `/?stage=market` | Start beneath the awning. Walk left or right: the paving changes from matte to wet at the eave, rain and splashes start outside, and the warm service lamp gives way to cool exterior light. |
| `/?stage=bridge-fronts` | Same bridge kit, with seeded weather that leads with clouds, then starts or stops rain. No new lightning. |
| `/`, `/?stage=station` | Compatibility controls. They keep their own accepted art, optics, and timing. |

A normal production build without `NEXT_PUBLIC_STICKMAN_PREVIEW=1` still selects Wet Bridge. Arena selection is mount-only and is never saved. No weather values feed collision, jump height, attack timing, enemy choices, loot, or score.

## What landed

- `LEVEL_BLUEPRINTS` and [`FLAT_LANE`](../src/game/stage/flat-lane.ts) separate authored presentation from the shared lane and spawn limits. `makeArenaBackground` dispatches once. The compatibility adapters reuse the original fixture addresses, receiver bakes, and painter slots instead of rebuilding their art in a second engine.
- [`EnvironmentFront`](../src/game/world/fronts.ts) is a bounded, seeded sequence of adjacent temperate bands. Cloud cover leads precipitation, the key and distance fog respond gradually, and wetness trails rain onset and clearing. New previews take bounded 60 Hz ticks from unscaled active play. The title, pause, editor freeze, hidden tab, and results do not spend them. Retry still chooses the normal new run seed; instrumentation can pin a seed and tick.
- [`SceneFront`](../src/game/world/scene-front.ts) binds the same sample to sky, rear rain, wind, shaded key light, runoff, and a single filtered rain voice on the SFX bus. A world-space clip blocks rain at both Market eaves; light, wind and sound use a short taper instead. The canopy never clips feet or action indicators. Market's one steady service lamp supplies both the baked floor transfer and the actor light probe.
- `ProceduralSky` paints Market's opaque ramp, two parallax silhouette plates, and one optional small bank. Behind-action precipitation uses the same rolled camera as the roof and floor. No new foreground rain, flash scheduler, rendered-scene reflection, or scene-sized intermediate. On denial or a lost bank context, the ramp and a simple contour still show the front. Bridge Fronts can fall back to its existing cloud decks.
- Low keeps the roof, matte and wet receiver types, local pool, contact, and rain outside. The system motion preference holds the small cloth, bank drift and streak motion, removes splashes, and leaves weather meaning, clips and steady light intact. Sound is supplementary and respects mute and SFX volume. Weather presets do not alter the tier ladder or its lock.

## How the retired pilot was authored

1. Register the mount id and copy in `core/arenas.ts`, then author a validated recipe in `stage/blueprints.ts`. Use the same flat layout until a separate gameplay design changes it. A compatibility kit wraps existing approved art; the canopy kit takes three receiver strips and a roof address. A different geometry needs its own art kit, not a branch in combat or the frame renderer.
2. Put receiver seams and access in one `ExposureMap`. Choose hard precipitation access, soft exterior light/wind/audio access, and whether the material supports splashes. The art and rain must consume the same world edges. Don't define a second screen-space roof.
3. Use steady fixture sockets, one source per painted practical, and sample the same field for the floor and characters. Keep a low-contrast backing behind hands and cue silhouettes. Use the sky recipe for distance and directional key; thin learned effects before removing that identity.
4. Reproduce the closed/open seam at Low, with quiet motion, denied optional bank, portrait roll, and backed-up retries. Pin source, seed, front tick, tier, size, pose, and render route. Capture outside, under cover, and outside again. Check combat events and trajectories independently from visual captures.

## Verification in this checkout

[Wide Market](../research/environment/market-wide.jpg) · [Low with reduced motion and actual touch controls](../research/environment/market-portrait.jpg) · [Crowd at the east eave](../research/environment/market-crowd.jpg) · [Numerical receipts](../research/environment/verification.json)

| Check | Result |
| --- | --- |
| Compatibility | Wet Bridge's High forward lamp fight, Low capture sign pan, and Night Station's Absolute 2.25× portrait capture match the frozen control's scene/HUD PNG hashes, state/events, weather, cast/optics metrics where collected, and backing-store shapes. |
| Fight and wave rules | A 150-tick crowd trace (10 opponents, score 24) matches Wet Bridge on both pilots, including quiet + denied-bank runs. The Low Market replay also reproduces the real first wave and four spawns over 260 ticks. |
| Shelter and clock | Raster tests found no precipitation or splash pixels in the dry interval at either edge, across roll/zoom/portrait configurations. At seed 42, outside wetness was 0.47 on both sides and zero under cover; normalized rain audio went from 0.0918 inside to 0.34 outside without starting a second source. Six play-clock ticks elapsed during hitstop in both wrapper tests. |
| Live wrapper | Desktop mouse/keyboard and emulated-touch gestures exercised selection, Engage, Cancel, Slash, pause/resume, Low, live reduced-motion toggling, resize/rotation, hidden/resume, Retry and teardown. The phone HUD stayed at 2× when world output changed to Low 1×. No new backdrop filters. |
| Lifetime | Engage + 20 deferred retries on each of the four routes. Market retained four stage stores (1,277,952 bytes estimated), and the Market test peaked at 3,055,616 ledger bytes including sky, props, masks, and HUD plates. Scene/HUD output canvases and browser-native memory are **not** included. All four routes released tracked stores on teardown. |
| Build/tests | Production preview build, TypeScript and import boundaries passed. All 11 new tests passed. Full gate: 501/506; the same five pre-existing combat/animation failures as the accepted control (named in the receipt). |

Market has a single optional 864×164 cloud tile (569,344 ledger bytes) and Bridge Fronts replaces the old bank with at most one 1024×120 tile. Draw caps are 180 rear streaks and 14 splashes per view; the two Market seams admit at most 14 short wet marks. Quiet mode emits no animated splashes. Instrumented authored paths made zero live scene copies. The new renderer uses no viewport-sized backing store or gameplay-canvas sampling for weather or lighting.

**Headless pacing triage, not device targets:** three alternated pairs per viewport, 36 warmup + 90 sample frames, pinned simulation inputs, matched scene/HUD backings and no pixels/trace/stage instrumentation during timing. Values are ranges over the three trials.

| View and tier | Wet Bridge rAF p95 | Rain Market rAF p95 | Wet Bridge submit p95 | Rain Market submit p95 |
| --- | ---: | ---: | ---: | ---: |
| 960×544 High / 1.5× | 83.3–99.9 ms | 50.0–66.6 ms | 33.4–38.0 ms | 6.6–7.6 ms |
| 390×844 Low / 1× | 16.8–33.4 ms | 16.7–16.8 ms | 20.9–22.6 ms | 3.6–5.2 ms |

No measured interval exceeded 250 ms in those windows. These are different art kits in a headless browser with software rendering requested. They do not measure device memory, frame cadence in a real wrapper, or the cost of a long warm match.

## Reproduce on the frozen pilot sources and QA tools

```sh
NEXT_PUBLIC_STICKMAN_PREVIEW=1 npm run build:preview
npm run preview
# Or use npm run dev; development already admits preview arenas.
node --import tsx --test tests/environment-{fronts,paint}.test.ts
```

With Puppeteer and Chromium available via `SR_BROWSER_TOOLS` (and optionally `SR_BROWSER_EXECUTABLE`):

```sh
node .qa/slasher-environment.mjs --capture=.cache/environment/market-wide.png
node .qa/slasher-environment.mjs --touch --capture=.cache/environment/market-portrait.png
SR_SOURCE=src node .qa/slasher-optics-retries.mjs --market --shadow-masks
SR_SOURCE=src node .qa/slasher-optics-retries.mjs --fronts --shadow-masks
SR_SOURCE=src node .qa/slasher-replay.mjs --fixed --scene=market --front-tick=1250 \
  --tier=low --scale=1 --width=390 --height=844 --route=capture --quiet --deny-bank \
  --at-x=1415 --roll=.10 --fixture=pan --warmup=16 --frames=124 --stages --empty-teardown \
  --pixels=.cache/environment/east-edge
```

For matched checks, point `SR_SOURCE` at frozen **accepted Practical Optics** and candidate trees, not the branch base. Use the same `--fixed --trace-state` recipe; keep `--stages`, `--pixels`, and `--trace-state` off for pacing runs. `--live-waves` leaves the natural wave director enabled. `--state-out` with `--trace-state` emits per-tick JSON lines for diagnosis.

## Release boundary

The pilot does not add Quarry, Salt Cliffs, Reservoir Gate, portals, campaign continuity, procedural collision, or environmental hazards. Browser checks use headless Chromium, including emulated touch, not physical-phone certification. The E6 release gate still needs supported-device/presentation review and longer warm play before any preview becomes the default.
