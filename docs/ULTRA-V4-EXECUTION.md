# ULTRA v4 — Execution receipt (performance maximization + full SACR v4.0 utilization)

This page records one execution pass over the **Master Performance Maximization
& Full SACR v4.0 Utilization** plan. Every change respects the frozen v4
contract in [IMPORTANT.md](../IMPORTANT.md): the 3,584-byte std140 packet, its
offsets (0/640/1664/2176/2432/3072/3456), 80 X columns, K=6 Master / K=4
Optimized, and "no new uniforms inside this ABI" are untouched.

## 1. GPU pipeline (draw calls, TBDR)

- **Dual-filter Kawase bloom** (`src/gpu/bridge-bloom.ts`,
  `src/gpu/bridge-pipeline.ts`). The 3-scale box chain (prefilter → two downs →
  combine, 4 draws) is now a real down/up pyramid: three 13-tap bilinear
  reductions, two additive tent upsamples that re-inject the smaller mips, and
  one compose of the upsampled core with the raw deep skirt (6 draws). Same
  four allocations (`BLOOM_TARGET_DIVISORS = [4,8,16,4]` unchanged), threshold
  still >1.15 in the first tap, ACES + 4× TEXTURE_3D LUT grade untouched.
  Receipt now reports `upPasses: 2` honestly.
- **TBDR load/store discipline** (was greenfield — `gl.clear` and
  `gl.invalidateFramebuffer` had zero uses in `src/`):
  - `gl.clear(COLOR)` immediately after binding every fully-overwritten target:
    sky cache, scene (before the sparse base), half-res road MRT (both
    attachments), every bloom destination.
  - `gl.invalidateFramebuffer` the moment a target's last reader of the frame
    has drawn: roadHalf + roadLightHalf after the mobile resolve; the three
    bloom mips after the compose; scene + composed bloom after grade. The sky
    cache is never invalidated (it persists across alternate mobile frames).
  - `gl.clearColor(0,0,0,0)` set once at initialize; scissor explicitly
    disabled around clears.

## 2. SACR v4.0 — the same UBO now drives five systems

The plan's U1 (half-res wet reflection FBO) is already the shipped mobile
architecture (`roadHalf` MRT + full-res resolve, puddle-masked, bilinear); no
change was needed beyond the new clears. The three genuinely missing consumers
were added. All of them read the **existing** column/bin records — zero new
uniforms, zero CPU work added per frame:

- **U3 — combat spark occlusion** (`sparkGate` in `LIGHTS`,
  `src/gpu/bridge-shaders.ts`). One shadow-bin column between receiver and
  spark, ≤4 opaque capsule slots, endpoint hits excluded (they are the two
  bodies), arcs/emissive/slabs never shade their own light. Applied to the
  actor emission program, the Mobile actors glow, and rain/rain-crown
  lighting — the probed road/facade paths keep their existing
  `receiverShadows` strike trace, so every driver-probe oracle stays valid.
  ~20 ALU per fragment.
- **U4 — O(1) GPU rain↔actor contact** (`WEATHER_VERT`). The mid rain plane
  shares the actor lane; each drop's vertex shader converts its foot X to a
  section column (`u_SacrView` now fanned out through `field()` to every UBO
  consumer), reads the top posed capsule, and flips the instance into a small
  splash crown pinned to the contact height. Zero CPU AABB passes; crowns
  inherit impulse lighting. Rain crowning is Master-tier by construction (the
  instanced weather program), which is where the plan placed it.
- **U5 — puddle bounce uplight** (`EMISSION_FRAG`). Emissive capsules in the
  receiver's own column warm boots/hem/blade from below with bounded
  finite-source falloff, gated by wetness > 0.04 and height above the deck.
  The CPU `wetBounce` probe stays for the Canvas contour taps.

## 3. Loading and retry

- **Idle GL prewarm** (`BridgeFinish.warm`, called from the menu and the
  Results screen, `src/game/game.ts`). One generator step per quiet frame:
  adapter probe → context creation → async `KHR_parallel_shader_compile` links
  → init ticks → backing reservation. ENGAGE/RETRY now start the opening on
  assets alone instead of paying link+init latency inside the watchdog budget.
  (Parallel compile itself was already shipped; what was missing was starting
  it before the gesture.)
- **RETRY budget** — retry preparation paints behind an opaque interlude, so
  its draft slices run at 14 ms instead of the interactive 6 ms
  (`RETRY_PAINT_SLICE_MS`); programs/textures/pools/plates are resident by
  construction, and the death screen pre-steps the pipeline. The death screen
  also decides the next run's seed (`nextRunSeed`) — the hook a future Chunk-0
  pre-bake hangs on without stretching any previous seed's data.
- **Death screen ink** — the HUD layer is cleared once at `gameOver()`:
  YOU HAVE FALLEN composes over the last world frame, not frozen vitality
  plates.
- Already shipped and verified, no change: worker bake windows with
  `WINDOW_LEAD = 1.5` chunks, one texture/mip per quiet present, LZ4 packed
  windows, KTX2 offline bakes, no `Review the final frame` sync check anywhere
  in the tree.

## 4. Allocation-free submit path

- `rgba()` (`src/game/core/utils.ts`): nested hex→alpha map, alpha quantized to
  1/255 (what the rasterizer keeps anyway) — no key strings on the hot path.
- `gatherBlockers` (`src/game/render/bridge-frame.ts`): the per-frame
  `[...route.between(...)]` materialization is a reused scratch array.
- `Renderer`: `castTint` returns a reused tuple (plus a shared empty
  admission list), the nearest-enemy comparator is a bound method instead of a
  per-frame closure, prop blockers come from a 4-slot pool.
- `Game.paint` reuses one persistent `RenderWorld` + one persistent `HudState`
  (telemetry/gate/boss/prompt/terminal/buff are refilled slots, projection
  inlined); drafts keep freezing the reference they were created with, so
  semantics are unchanged.
- `sampleRibbon` writes the live blade anchor into a reused 4-slot scratch.
- Deliberately skipped: `hand-kinematics`/`hand-gestures` result objects
  (consumers may retain them across frames — sharing would corrupt animation
  state) and position-dependent Canvas gradients (uncacheable by nature).

## 5. Honest dynamics kept as-is (with rationale)

- **Adaptive resolution** keeps its shipped ladder (>20 ms avg over 28 frames
  drops, <12 ms over 270 recovers, min 0.75) — `tests/render-scale.test.ts`
  pins this contract, it is more conservative than the plan's sketch, and
  ULTRA locks disable it unconditionally, which the plan asked for.
- **Penumbra formula** stays `.018 + separation·angularRadius` (capped) —
  probe 9's CPU/GPU oracle and the shadow tests pin it.
- **Runtime KTX2 transcoder** remains offline-only (`bake-bridge-ktx.ts`);
  adding a runtime Basis transcoder is a follow-up, not part of this pass.

## 6. Verification

- `?verifyGraphics=1` now records the acceptance targets live and prints a
  gate table into `window.__GRAPHICS_DIAGNOSTICS__.verify` and the console:
  ENGAGE→playing ≤ 400 ms, RETRY→playing ≤ 150 ms, SACR pack+bin p95 ≤ 1.2 ms,
  frame-interval p99 ≤ 16.6 ms, zero >33.4 ms stalls in the sampled window,
  heap growth < 0.2 MB/min (Chrome `performance.memory`, ≥0.2 min window).
  Existing driver probes (9 SACR oracle comparisons) are unchanged and still
  gate `status`.
- `npx tsc --noEmit` clean; `node scripts/lint-boundaries.mjs` clean;
  `npm run lint:webgl` clean (UBO still 3584 bytes, no dynamic vector-lane
  indexing, every new snippet registered through `BRIDGE_PROGRAMS`).
- Full test suite: **640/645 pass**. The five failures
  (blade-cleave ×2, full-body, ritual-idle, unarmed-step) reproduce on pristine
  `main` and match the known frozen set in [BRIDGE-MASTER-V4.md](BRIDGE-MASTER-V4.md);
  they are unrelated to this pass.
- Software-GL caveat (unchanged): offline/offscreen runs validate shaders,
  formats and readbacks only. Hardware frame-budget sign-off still requires the
  `SR_BROWSER_TOOLS` matrix from [BRIDGE-MASTER-V4.md](BRIDGE-MASTER-V4.md).
