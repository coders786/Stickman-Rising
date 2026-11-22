# Continuous Bridge

**Engage** starts one seeded route at Metro Approach. Run right through the
concourse, look for gear on the road and gunners on catwalks, and defeat the
boss at each sector checkpoint to keep going. Walk back into a shelter to
break contact. **Retry** starts a fresh seed. No room selector, wave break, or
loading screen between sectors. Old `?stage=` links still reach the same menu.
The [fixed-span Bridge](../research/combined-run/verification.json) was the
previous prototype; its screenshots and receipts are retained as history.

For the current city, camera and matched views, see [Metro Bridge](BRIDGE-METRO.md).
The [2.5D graphics guide](BRIDGE-GRAPHICS.md) documents an earlier presentation pass.

## Sprint 1 — settings and instrumentation

Desktop and touch both offer **Low .75×**, **Medium 1.00×**, **High 1.15×** and
**Ultra 1.25×**. Each selection locks the detail preset and backing target.
[Adaptive Resolution](BRIDGE-ATMOSPHERE.md#settings) is off by default; it changes
only backing resolution and never rebakes the route. Settings shows the target
separately from the actual renderer and scale of the last gameplay frame.
On a short screen, the preferences scroll under a fixed Back button. The
three labeled sliders expose their percentages to keyboard and assistive input.

The independent canvas HUD takes its bounds from the CSS safe-area insets.
**Show FPS** toggles the last HUD ink. It uses foreground frame intervals, a
90/10 exponential average, and publishes at most four times a second. It does
not change tier, scene scale or gameplay. Readings describe this browser's
cadence, not a GPU benchmark.

## Sprint 2 — route, cover and traffic

- [`BridgeRoute`](../src/game/stage/route.ts) creates deterministic 960–1,440
  world-unit chunks. Distance uses 10 units per metre. The first two 500 m
  boundaries move the palette from Metro Approach to Market Overpass to
  Sky Garden District over 80 m blends. Gates are placed near each 500 m mark,
  shifted forward if necessary to keep the approach out of a shelter.
- Transit cover and recurring service bays use the same eaves for art, dry
  ground, collision, rain clips and exposure. Enemy movement and projectiles
  stop at the eaves. Exterior glass recedes while the player is under the
  roof; the warm interior and load-bearing structure stay visible.
- One fixed-tick [front](../src/game/world/route-weather.ts) drives wetness,
  audio and three rain planes (0.4× far, 1× mid and 1.4× near parallax). The weather
  keeps moving during hitstop but not while paused or hidden. All three planes
  exclude dry columns. Shadows use the solved shoe contacts; wet returns
  stay on the wet receiver, not a copy of the composed scene.
- [`RouteScenery`](../src/game/stage/route-art.ts) holds at most three
  ledger-owned road plates. It prewarms at most one nearby plate, draws
  directly when storage is denied or the view spans more slots, and releases
  plates outside the window or on reseed. The descriptor tape is small and
  append-only, so walking back does not reroll a chunk. HTML canvas is the
  fallback when OffscreenCanvas is unavailable.
- The [director](../src/game/world/encounters.ts) fills local threat slots
  instead of waiting for a wave. It avoids covered lanes and occupied slots,
  anchors marksmen to real platforms and reserves space for a gate boss.
  Distant traffic retires without kills or score. Catwalks and cargo tops
  catch a descending player; down+jump drops through them. Road bosses keep
  their telegraphs; the camera follows the player and leads into checkpoint
  approaches on portrait screens. Sweeps have a height and a single contact
  window; a jump clears the stomp and a parry opens the core.

## Sprint 3 — combat and field UI

The HUD separates vitality/stamina/Overdrive at the left, sector, threat and
boss information in the center, and score/Flow at the right. Flow ranks up at
1/5/10/20/35/55/80 confirmed hits (D through SSS). Its 2.6 s window only drains
with pressure nearby; shelter and travel hold it. The best rank survives
current Flow decay or spending. Guard chip and parries do not earn hit streaks.

At a live service terminal, hold **E** for **1.5 s** or tap **Service** on
touch to begin the same channel. Stepping away cancels it. Once per bay and
run, the channel spends current Flow for **+40 HP**, **50 shield** and a seeded
**30-second** buff: Chain Lightning Dash, Vampiric Execute or Guard-Crush
Heavy. Road pickups require contact and an eligible resource. **R** (with
legacy **I** retained) activates Overdrive at full meter; the touch button
lights only when it is available. **E** or contextual **Exec** targets the
nearest staggered, low-HP foe in range. An anchored prompt identifies the
actual target, rather than a fixed position above the player. On touch, Draw
and Sword live over the stick. Combat and contextual buttons fit in three
rows below the action, with 44 px minimum targets.

The katana ribbon follows the rendered hilt and tip: bounded pose history,
Catmull–Rom interpolation, feathered bands and a 140 ms lifetime. The narrow
rim uses CSS-space width. Neither effect extends a hitbox.

## Reproduce the checks

```sh
npm ci
npm run check:bridge
npm run build:preview
npm run preview
```

Use isolated browser tooling (Puppeteer Core and Chromium) as described at
the top of [slasher-replay](../.qa/slasher-replay.mjs). Run live checks against
port 3000 by default, optionally setting `SR_QA_URL`. Set `SR_SHOTS` to a
scratch directory to save the gameplay and settings stills. The soak uses actual
Engage/Retry clicks but fixes the simulation steps and protects the QA hero;
bosses are defeated through the hit resolver after verifying the gate stops
movement. The 30-second FPS check uses real foreground animation callbacks.
These are desktop Chromium and **400 × 844 touch emulation**, not certification
on physical phones or a claim of a guaranteed frame rate.

```sh
node .qa/slasher-quality.mjs --pacing
node .qa/slasher-quality.mjs --touch --pacing
node .qa/slasher-environment.mjs --legacy-links
node .qa/slasher-environment.mjs --touch
node .qa/slasher-route-visuals.mjs
node .qa/slasher-route-visuals.mjs --touch
node .qa/slasher-gestures.mjs
node .qa/slasher-gestures.mjs --touch
node .qa/slasher-touch-compositor.mjs --flat
node .qa/slasher-route-soak.mjs
node .qa/slasher-route-soak.mjs --touch
```

The [Bridge CI workflow](../.github/workflows/bridge.yml) runs the focused
suites, strict boundary audit, typecheck and production build. `npm run gate`
is the broader suite and still reports five inherited combat/animation
failures. It is not silently treated as a pass by the Bridge check.

## Verification before the 2.5D graphics pass

The production build, typecheck and boundary audit passed (20 known boundaries,
no new violations). The focused check passed **126/126** tests. The full gate
passed **510/515**; the same five combat/animation failures match the frozen
control by name. The [machine-readable receipt](../research/bridge-remediation/verification.json)
records their names, the builds and the browser checks.

| Verification | Desktop (1180 × 660) | Touch emulation (400 × 844) |
| --- | ---: | ---: |
| Engage + Retry traversals ≥10,000 world units each | 21/21 (Ultra) | 21/21 (Medium) |
| Shortest net traversal | 10,630.15 world units | 10,630.15 world units |
| Maximum simultaneous chunk plates | 3 | 2 |
| Maximum live tracked backing | 23.38 MiB | 19.71 MiB |
| Live tracked backing after destroy | 0 | 0 |
| Locked Ultra scene backing in FPS check | 1475 × 825 | 500 × 1055 |
| 30-second foreground frame gaps, p50 / p95 | 50.0 / 83.3 ms | 33.3 / 50.0 ms |

Each traversal visited three shelters and cleared two gates, with zero
scene-sampling blits and no retired chunk backing surviving Retry. Those
fixed-step soaks preceded the final touch-only control rearrangement. The
final preview passed the live settings, two-way eave crossing, service,
execute, Overdrive, jump/landing/drop, boss framing, ribbon, pause/cancel and
remount checks on both viewport classes. The FPS checks confirmed the
readout and unchanged locked backing; the frame intervals above are from
software Chromium, not a 60 FPS claim or a physical-device sign-off.

**Live captures:** [Metro Approach entry](../research/bridge-remediation/desktop-outer-transit.jpg) ·
[Market katana](../research/bridge-remediation/desktop-market-katana.jpg) ·
[Industrial catwalk landing](../research/bridge-remediation/desktop-garden-skywalk.jpg) ·
[Touch boss](../research/bridge-remediation/touch-boss-windup.jpg) ·
[Touch attack](../research/bridge-remediation/touch-market-katana.jpg) ·
[Touch service](../research/bridge-remediation/touch-service.jpg) ·
[Touch settings](../research/bridge-remediation/touch-presets.png).
