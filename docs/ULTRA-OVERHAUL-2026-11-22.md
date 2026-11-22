# Master overhaul — execution record 2026-11-22

Against the "Master Visual Overhaul & Performance Maximization Plan". This file is
the receipt for **this** pass on branch `arena/3c6eec42-stickman-rising`
(base `3a94443`). It does not claim the whole plan is finished.

The most important finding first: **the build under review is not the build in
the repo.** Several failures cited from the recording either do not exist in
this source at all, or exist in a completely different form. Those are listed
with file:line evidence so the next pass does not "fix" what is already right.

## 1. Verified against the recording

| Recording complaint | Current source | Verdict |
|---|---|---|
| Flat cream circle + clipart ninja loader | `src/app/ronin-cut-art.tsx` is a two-tone ink cel (rooftop, moon, ronin, scabbard, blade); `src/app/ronin-reveal.css` shuts it away with a skewed opaque shutter | **Not in this build** — the loader is an authored ink card, not an SVG clipart pose |
| "Review the final frame" stall at 85 % | No such string in `src/`, `.qa/`, `scripts/`. Nearest real stage is `settling: 'Check frame pacing'` (`src/app/bridge-interlude.tsx`) | **Different label.** The stall mechanism was real, see §2.1 |
| "The arena didn't finish loading" red banner | `src/app/page.tsx:487` (live text, `runUnavailable`) | **Real**, and it stays — it is now reached only by an actual wedge, see §2.1 |
| Elliptical "sticker" puddles | Puddles are **rectangular drainage runs** (`puddlePath`, `BRIDGE_PUDDLE_RUNS`, `src/game/stage/bridge-art.ts:17`) with a material-driven wetness mask | **Not in this build** |
| Banana-polygon slashes | Ribbons are Catmull-Rom sampled (`catmullRom`, `src/game/fx/ribbon.ts:42`) and meshed into the HDR frame (`src/game/render/bridge-frame.ts:235`) | **Not in this build** |
| 10 px glow-tube katana | Blade geometry/reach contracts are in `PLAYER_SPEC.blade = 56` with a thin edge (`src/game/entities/player.ts:202`, "a katana edge is ~4px thick") | **Not in this build** |
| Floating cyan "0" over shields | Nothing emits a numeric zero anywhere (`grep` for a `0` damage readout is empty); guard hits printed the word `BLOCK` | **Real in spirit** — the word popup was the same "number over a barrier" failure. Fixed, see §2.2 |
| Top HUD left behind the death screen | The world is frozen at `phase === 'gameover'` (`src/game/game.ts:1213`) so the separate HUD layer kept its last ink under the card | **Real**, fixed in §2.3 |
| Moon glued next to the left HUD | `lunarProjection` (`src/graphics/bridge/BridgeAtmosphere.ts:21`) places the disc with `MOON_KEY = [-.62, -.74, .24]` — the same vector `PASS 0` uses for cast shadows | **Consistent by design**: moving the disc without moving the key light would make every baked shadow contradict the sky. Open item §3.1 |

Already on the GPU, contrary to the recording: analytic-sphere moon with maria,
craters, terminator and Earthshine (`src/gpu/sky.ts:87-133`,
`src/gpu/bridge-lighting-shaders.ts:75-97`), `KHR_parallel_shader_compile`
program queueing (`src/gpu/program.ts:41`, `src/gpu/bridge-pipeline.ts:150`),
SACR v4.0 3584-byte std140 block (`npm run lint:webgl` prints
`0/640/1664/2176/2432/3072/3456`), SACR distance/shadow evaluation
(`src/graphics/sacr/SACRShadow.ts`), rain as instanced GPU streaks
(`src/gpu/bridge-shaders.ts:449+`), a half-res road target with its own resolve
pass (`BridgePipeline.ground`), and an adaptive scaler with hysteresis
(`src/game/render/render-scale.ts`: 28 slow frames to drop, 270 to recover).

## 2. What this pass changed

### 2.1 The loader can no longer sit on a frozen bar (`src/game/render/opening-budget.ts`)

One 25 s budget meant a preparation that stopped advancing at any stage held the
player for the full 25 s and *then* failed. That is the shape of the reported
hang: the bar stops, nothing changes, and eventually a banner appears.

Two clocks now, and they answer different questions:

- **`OPENING_STALL_MS = 8_000`** — *no observable progress* (stage change, first
  covered submit, settled frame) for 8 s is a wedge. Fail in 8 s, not 25.
- **`OPENING_TOTAL_BUDGET_MS = 25_000`** — unchanged backstop for a boot that
  trickles forward forever.

`Game.prepareRunFrame` publishes progress on every stage change, every successful
covered submit and every reopening, and republishes it while the tab is hidden so
a backgrounded tab is never mistaken for a stalled one. The boot receipt gains a
`run-stalled` mark (`?boot=1`), so the next recording can say *which* clock
expired instead of just "it hung".

### 2.2 A guarded strike is a deflection, not a number

`FX.text()` now refuses empty and zero strings (`0`, `00`, `+0`, `-0`) before
they can enter the pool. Guard and plate contacts in `Game.hitEnemy` no longer
print `BLOCK` / `ARMOR`: they spawn a **directional hexagonal Fresnel ripple** at
the blade contact (`FX.guardRipple`), blue ricochet sparks, and at most one 10 px
`[GUARD]` / `[PLATE]` micro-tag that dissolves in 200 ms.

The ripple is a fixed 4-slot pool, one pass, no closures and no array helpers —
`0` allocations per tick. It is drawn outside the particle toggle because a
deflection is combat feedback, not decoration. It is squashed along the strike
normal and drawn as six facets so it cannot be confused with the circular
shockwave every hit already uses.

### 2.3 The death screen retires the HUD ink (`src/game/render/hud-fade.ts`)

`YOU HAVE FALLEN` used to appear over a live score / sector panel, because the
world is frozen on the results screen and the HUD layer simply retained its last
ink. Now `Game.gameOver()` retires that ink with **one compositor transition**
(200 ms linear, `none` under reduced motion) — no per-frame repaint, no timer in
the game loop — and `openCombat()` / `quitToMenu()` restore it before input
opens. `HudState.opacity` is part of the HUD ink stamp, so a cached layer can
never stay opaque after the fade starts; the inline fallback path (no separate
HUD surface) keeps the old behaviour rather than repainting a frozen frame.

## 3. Open items, in the order they are worth doing

1. **Moon composition.** The plan asks for the disc in the upper-right third.
   The disc and the key light share one vector by design. Moving the disc means
   either re-baking every plate/sky basis with a right-hand key (and re-recording
   the cast-shadow receipts), or accepting a sky that contradicts the shadows.
   Needs an art decision, not a patch. Note the recording's "x ≈ 40 %, next to
   the HUD" does not match the current projection (it is keyed to the upper-left
   at a seeded offset).
2. **`0` Canvas2D world calls.** Both WebGL2 routes are batched; the
   `mobile-canvas` route and the actor/HUD layers are still Canvas 2D
   (`src/game/render/renderer.ts`). Retiring them is the largest remaining item
   and it invalidates the Canvas fallback path (context loss, software adapters,
   devices refused by `BridgeDeviceProbe`). Not attempted here.
3. **12-draw-call table.** The presenter already batches the frame
   (`frameDraws` is measured in `bridgeReceipt()`); it is **not** yet verified
   against the plan's per-call budget table, and no mobile GPU timing was taken on
   this branch.
4. **Honest telemetry limits.** No browser was available in this sandbox
   (Playwright and a Chromium binary cannot be installed here), so every claim in
   §2 is backed by type-checked code and unit tests, not by a captured frame. The
   `< 350 ms` cold-boot and `≤ 6.5 ms` GPU figures remain unverified targets.

## 4. Verification

- `npm run typecheck` — clean.
- `npm run gate` — boundaries `clean (20 known, 0 new)`; webgl lint
  `23 unique ES 3.00 stages, 33 embedded snippets, 0 standalone; SACR std140
  3584 bytes (0/640/1664/2176/2432/3072/3456)`; **640/645** tests pass.
  The five failures are the documented pre-existing combat/animation ones
  (`blade-cleave`, cut depth vs frame rate, welded joint, six extra ritual keys,
  connecting-joint placement) and were confirmed on the untouched tree by
  stashing this pass and re-running `tests/blade-cleave.test.ts` (2 failures on
  the base commit as well).
- New tests: `tests/opening-budget.test.ts`, `tests/hud-death-fade.test.ts`,
  `tests/guard-deflection.test.ts` (11 assertions/tests, all passing).
