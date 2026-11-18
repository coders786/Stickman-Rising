# 21 — THE OPTIMISATION CATALOG (every technique that matters for 2.5D on the web)
**Serves:** D2, D7, D8, D9 · `12`, `17`, `19` · REQ-701…712.

A sweep of the literature and practitioner sources, filtered through one question:
**does this apply to a parallax 2.5D Canvas2D game with no assets, one canvas, and
a mobile-first budget?** Techniques are marked:

* **ADOPT** — we do this / will do this.
* **COND** — conditional: applies only at a tier, or only if a prototype passes.
* **REJECT** — does not apply *to us*, with the reason stated. (Most catalogs omit
  this column, which is why teams implement techniques that cannot help them.)

---

## 0. Where the time actually goes in a 2.5D canvas game

Ranked by what we can influence, from the cost model in `17`:

| # | Cost | Magnitude | Lever |
|---|---|---|---|
| 1 | **Pixels touched** (`overdraw × area`) | ~2.8–11.2 Mpx/frame | dpr cap, overdraw budget (`17` §2) |
| 2 | **JS per frame** | 4–8 ms **[E]** | allocation-free draw path, batching |
| 3 | **Present + compositor** | 1–3 ms | one opaque canvas (`alpha:false`) |
| 4 | **GC pauses** | sporadic 5–50 ms | zero allocations in the loop |
| 5 | **Memory / cache pressure** | 30–60 MB | canvas ledger (`12` §4) |
| 6 | **Boot** | 100–350 ms | bake queue, program prewarm (`13` §7) |

Every technique below maps to one of those six rows. If it does not, it is not
an optimisation for this game — it is a hobby.

---

## 1. Frame loop and time (cost row 2, 4)

| Technique | Effect | Verdict | Notes / evidence |
|---|---|---|---|
| `requestAnimationFrame` with the timestamp argument | syncs to display, pauses when hidden | **ADOPT** | already; also why we get 120 on capable devices |
| Fixed timestep + accumulator | deterministic sim, physics stable | **ADOPT** | `19` §2, D10; `dt` clamp 0.25 s prevents "spiral of death" |
| Render interpolation (`alpha`) | removes 60-vs-120 judder | **ADOPT** | costs exactly one frame of latency (`19` §2) |
| Never `setInterval`/`setTimeout` for cadence | avoids tearing/drift | **ADOPT** | "on a 120hz display, a 60hz interval only paints half the frames" |
| Clamp `dt` on resume | avoids a 30-second catch-up after a tab switch | **ADOPT** | also required for `visibilitychange` |
| Skip `sim` entirely when hidden | battery, thermal | **ADOPT** | rAF is throttled anyway; explicit stop is better |
| Delta-time animation | identical motion at any refresh | **ADOPT** | repo already does this (`hand-kinematics`: "C1 in-betweens at any render Hz") |
| Run the whole loop in a Worker | unthrottled 120 on Chrome Android | **REJECT (M7)** | moves input + React boundary; Rule 10 (`18` §1) |

---

## 2. Redraw strategy (cost row 1)

| Technique | Effect | Verdict | Why |
|---|---|---|---|
| Full-canvas redraw each frame | simple, correct | **ADOPT** | our world scrolls, so nearly everything is dirty anyway |
| **Dirty rectangles** | avoids repainting unchanged pixels | **REJECT for the world** · **ADOPT for HUD panels** | the literature is explicit: "full-screen scrolling games — if the whole world moves every frame, nearly everything is dirty anyway"; tracking can cost more than repainting |
| Layer split (static bg canvas + dynamic fg canvas) | avoids redrawing static content | **REJECT** | a full-screen extra layer costs 0.3–1.5 ms compositor + ~17 MB (`12` §5) — worse than redrawing |
| Clear only the play band / clip to region | small fill saving | **COND** | only if `M-OVERDRAW` shows the band is the hot region |
| `clearRect` vs `fillRect(bg)` vs `width=width` | clear cost differs | **ADOPT `fillRect`** | we draw an opaque sky plate over the whole frame; no clear needed at all (best case) |
| Double-buffer by drawing to an offscreen then blitting | tear-free composites | **REJECT** | one full-screen blit = +0.74 Mpx touched for zero benefit with `alpha:false` |

---

## 3. Draw-call economy (cost row 1 and 2)

| Technique | Effect | Verdict | Evidence |
|---|---|---|---|
| **One path + one `stroke()` for same-styled lines** | "consolidating paths for multiple lines into a single stroke() call can **halve execution time**" | **ADOPT (T6.13)** | the player rig issues 20 strokes (`19` §0.5) |
| Batch by state: set `fillStyle`/`lineWidth` once, draw many | removes context state churn | **ADOPT** | "state changes between each draw" is the classic anti-pattern |
| Avoid per-draw `globalAlpha` / per-stroke alpha | per-paint alpha forces extra work (measured 2× on a vector renderer; a canvas-wide layer in some engines) | **ADOPT** | replace with a quantised cached colour table (T6.13) |
| Avoid `shadowBlur` / `ctx.filter` | "multiply draw complexity without hardware acceleration benefits in 2D" | **ADOPT** | 2 `shadowBlur` sites exist in the repo; both are outside the env layer, both should be baked |
| Avoid `save()`/`restore()` churn | each pair touches the state stack | **ADOPT** | prefer `setTransform` |
| Integer vs sub-pixel coordinates | integers skip sub-pixel AA cost | **COND** | *conflicts* with `19` §5's smoothness rule: we use **integers for static plates, sub-pixel for moving rigs**, and measure the AA cost (`M-OVERDRAW`) rather than guess |
| `imageSmoothingEnabled=false` for 1:1 blits | cheaper sampling, crisper | **ADOPT for plates at integer scale** | and `=true` when a fractional scale is unavoidable |
| Avoid `drawImage` source→dest downscale > 1.5× | the expensive case (`12` §6) | **ADOPT** | bake at draw size |
| Clip only where it changes the fill | clipping adds a mask | **COND** | measure; the play band clip may be free if the region is already opaque |
| Avoid `getImageData`/`putImageData` in frame | readback stalls the pipeline | **ADOPT (existing)** | bake-time only (`13`) |
| `willReadFrequently` | forces a software canvas | **REJECT (banned)** | gamedev.stackexchange 210596 |

---

## 4. Text and UI (cost row 1)

| Technique | Effect | Verdict | Notes |
|---|---|---|---|
| Cache text to an offscreen plate | "font rasterization is the most expensive single call" | **ADOPT** | HUD already bakes; keep it |
| Cache `measureText` results | avoids per-frame shaping | **ADOPT** | only re-measure on font/size change |
| Avoid font/style changes mid-frame | each change invalidates shaping | **ADOPT** | group by font |
| DOM overlay for pulse/flash instead of canvas | compositor runs it at display rate even when rAF is clamped | **COND (L5)** | small, short-lived, disabled on `low` (`18` §5) |
| `fillText` with long strings in the play band | per-frame shaping | **REJECT** | no text in the play band by design (FID-4) |

---

## 5. Pre-rendering and caching (cost rows 1, 5, 6)

| Technique | Effect | Verdict | Notes |
|---|---|---|---|
| Offscreen plate cache for anything complex | "only execute expensive drawing operations once" | **ADOPT** | the whole `13` architecture |
| Memoise by profile/archetype signature | avoids re-bake | **ADOPT** | 18 signatures, ≤6 resident (`07` §6) |
| LRU with `w=0;h=0` on release | actually reclaims GPU memory | **ADOPT** | WebKit does not GC canvases (`12` §4) |
| One plate per frame bake queue | removes the 20–25 ms boot spike | **ADOPT** | `13` §7 |
| Reuse scratch canvases | avoids allocation | **ADOPT** | ledger slot `scratch` |
| `ImageBitmap` + `bitmaprenderer` for transfers | zero-copy across threads | **COND** | only where a worker boundary exists; `transferFromImageBitmap` measured **4.9× slower** than `drawImage` on a canvas source (`12` §6) |
| `Path2D` caching | reuse geometry | **COND** | `Path2D` is immutable; rebuilding cheap line segments is usually faster than reusing a cached *shape* |

---

## 6. Layering and the compositor (cost row 3)

| Technique | Effect | Verdict | Notes |
|---|---|---|---|
| One opaque canvas (`alpha:false`) | compositor skips blending | **ADOPT** | already `game.ts:311` |
| `desynchronized: true` | ~1 frame less latency | **ADOPT on the top canvas** | translucent + desync requires no DOM above it |
| Multiple canvases / CSS-layer parallax | compositor does the motion | **REJECT for the game world** | full-screen layers cost 0.3–1.5 ms each + memory; D7 |
| `will-change: transform` | promotes a layer early | **REJECT (permanent)** | "a persistent `will-change` layer costs GPU memory for every flagged element" — the same law as `12` §5 |
| CSS transforms for page-level parallax | 40–60 % less CPU than JS parallax | **REJECT** | that is a *marketing page* result; our camera is a game camera inside one canvas |
| `contain:` / `content-visibility:` | skips offscreen DOM work | **COND** | only if a DOM HUD layer exists |

---

## 7. Memory (cost row 5)

| Technique | Effect | Verdict | Notes |
|---|---|---|---|
| Canvas ledger with caps + zero-on-release | prevents the silent-transparent failure | **ADOPT** | `12` §4, REQ-708 |
| Cap `devicePixelRatio` at 1.5 mobile / 2.0 desktop | 4× fewer pixels vs dpr 3 | **ADOPT** | `17` §2 |
| Keep any single texture ≤ 2048² on mobile | WebGL limits/bandwidth | **ADOPT** | a 4096² sheet "forces the GPU to downsample" |
| Retina backing store only where it matters | memory vs crispness | **COND** | plates at ladder steps, not at screen dpr |
| `ImageBitmap.close()` | frees immediately | **COND** | only if we ever create bitmaps |
| Avoid resize thrash | resize clears + reallocates | **ADOPT** | debounce resize, rebuild plates on settle |

---

## 8. Garbage collection (cost row 4)

| Technique | Effect | Verdict | Evidence |
|---|---|---|---|
| **Zero allocations in the frame path** | removes sawtooth GC | **ADOPT (REQ-704)** | "200 particles × 60 fps = **12,000 allocations/second**; the young generation fills every 2 seconds like clockwork" |
| Object/particle pooling | "reduces GC pressure by ~90 %" | **ADOPT** | pools already exist for FX; extend to any per-frame object |
| Typed arrays for state | allocated outside the normal GC heap | **ADOPT** | `Float32Array` for pose channels, uniforms, chain points |
| No string building per frame | strings are the worst offender | **ADOPT** | found 14 template strings/frame in `player.ts` (`19` §0.5) |
| No closures created in loops | each allocates | **ADOPT** | hoist |
| `arr.length = 0` not `arr = []` | avoids a new array | **ADOPT** | classic |
| Avoid `map/filter/spread` in hot paths | each allocates | **ADOPT** | review rule |
| Monomorphic object shapes | hidden-class churn | **ADOPT** | fixed field order in pooled entities |
| Don't use `try/catch` on the hot path | deopt risk | **ADOPT** | keep error handling at boundaries |

---

## 9. Culling, LOD and skipping work (all rows)

| Technique | Effect | Verdict |
|---|---|---|
| Frustum-cull decorative layers entirely | 0 fill, 0 blits | **ADOPT** (parallax ladder already culls the deepest at `low`) |
| Skip **animation updates** for off-screen entities | CPU | **ADOPT** |
| Pressure LOD: fewer octaves / lower plate step at `low` | fill | **ADOPT** (`13` §9) |
| Skip chain simulation off-screen | CPU | **ADOPT** (`20` §2.3) |
| Skip storm particles off-screen | fill | **COND** (existing rain budget) |
| Distance-based FX LOD (skip dust beyond N px) | fill | **ADOPT** |
| Occlusion culling by opaque plates | fill | **REJECT** | 2.5D painted layers rarely occlude each other enough to pay for the test |

---

## 10. Input (cost row 2)

| Technique | Effect | Verdict | Notes |
|---|---|---|---|
| `{ passive: true }` listeners where allowed | avoids scroll-blocking | **ADOPT** | and `touch-action: none` on the canvas |
| `setPointerCapture` for drags | no lost moves | **ADOPT** | |
| Input **snapshot**, read once per sim step | determinism | **ADOPT** | "do not mutate game state inside a pointer handler" |
| `getCoalescedEvents()` | 2× samples at 120 Hz digitizer | **ADOPT** | for gesture/trail sampling only |
| `pointerrawupdate` | unthrottled | **COND (off)** | "costs main-thread work on exactly the low-end devices" |
| `getPredictedEvents()` | shaves perceived latency | **COND** | only for the player's own input echo (`19` §4) |

---

## 11. Boot and loading (cost row 6)

| Technique | Effect | Verdict |
|---|---|---|
| Asset-free pipeline | no downloads, no decode | **ADOPT (REQ-706)** |
| Prewarm/compile all 8 programs at boot | 0 ms first-frame hitch | **ADOPT** (`13` §3) |
| Boot probe ≤120 ms for tier selection | right tier on first frame | **ADOPT** (`14` §3) |
| Bakes spread one-per-frame | no 25 ms spike | **ADOPT** (`13` §7) |
| Measure boot separately from steady state | honesty | **ADOPT** (`11` §3.4) |

**If we ever add raster assets** (we do not, but the rules would be):

| Technique | Verdict | Evidence |
|---|---|---|
| WebP/AVIF | **COND** | smaller than PNG for photographic content |
| Chrome: `fetch → blob → createImageBitmap` | **COND** | the only path that decodes off the main thread in Chrome |
| Firefox: `ImageDecoder.decode` | **COND** | 460 ms → 196 ms for Sponza textures |
| Safari: `HTMLImageElement` (+`decode()`) | **COND** | `createImageBitmap` was slower and had colour bugs pre-iOS 26 |
| `decoding="async"` | **COND** | "in practice the hint doesn't seem to make much difference" in Firefox |

---

## 12. WebGL / instancing — the honest comparison for 2.5D

| Technique | What it buys | Verdict for us |
|---|---|---|
| Instanced quads (one draw call for 10k sprites) | 10–100× fewer draws | **REJECT** — we draw ~15 quads, not 10k. Draw-call overhead is not our bottleneck; fill is. |
| Texture atlas <2048² (mobile) | fewer texture switches | **REJECT** — no assets, no sprites |
| Batched sprite renderer (Pixi/Phaser) | 100–300 animated sprites @60 on a mid phone *with* batching, 20–40 without | **REJECT** — we have tens of objects, not hundreds |
| WebGL2 for the *atmosphere* at bake time | shader-generated plates | **ADOPT** (`13`) |
| WebGL2 for the live sky (Mode B1) | morphing clouds | **COND** — desktop only, P4 gate (D7) |
| Workers + `OffscreenCanvas` | unthrottled frame clock, no main-thread competition | **COND (M7)** — `18` §1 |

The pattern: **instancing and atlases solve a problem we do not have.** Our problem is
pixels touched and JS per frame. Saying that out loud is worth more than a benchmark.

---

## 13. Lifecycle (cost rows 2, 3, 5)

| Technique | Effect | Verdict |
|---|---|---|
| `visibilitychange` → stop the loop | battery, thermal | **ADOPT** |
| Resume with `dt` clamp | no teleporting | **ADOPT** |
| Release the GL context when hidden | avoids mobile reclaim kill | **ADOPT** (`12` §7) |
| `webglcontextlost` + `preventDefault` + rebuild from profile | recovery ≤2 frames | **ADOPT** (`13` §8) |
| Sticky thermal demotion for the session | kills oscillation | **ADOPT** (`14` §7) |
| `prefers-reduced-motion` | comfort, not perf | **ADOPT** (REQ-604) |

---

## 14. Measurement (the meta-technique)

| Technique | Why | Verdict |
|---|---|---|
| Fixed-bucket frame-time histogram | averages hide stutters | **ADOPT** (`11` §3) |
| Time-weighted p50/p95/p99 + p1 | pacing is the experience | **ADOPT** |
| `M-OVERDRAW` counter (Σ w·h per draw) | the only way to see fill creep | **ADOPT** (`17` §7) |
| Allocation counter (`--expose-gc` heap delta) | proves REQ-704 | **ADOPT** |
| `M-CLAMP` (median 60 + frame time <12 ms) | separates "we're slow" from "browser clamped" | **ADOPT** (`18` §6) |
| Profiling *before* optimising | "profile with DevTools before optimising anything; test on your weakest device" | **ADOPT** |
| Average FPS as a headline metric | hides variance | **REJECT** |
| GPU timers | absent on mobile | **REJECT** (`12` §2) |

---

## 15. The decision tree — a slow frame, in order

```
1  is M-CLAMP true?              → the platform capped us. Not a bug. Stop.
2  is overdraw > 4.0×?           → a new sheet crept in. Remove/merge it.
3  is dpr > cap?                 → the single biggest lever (4× at dpr 3).
4  is p95 fine but p99 spiky?    → allocation or a bake landing in-frame.
5  is T_cpu high at low overdraw?→ JS: string allocs, stroke count, per-frame math.
6  does the histogram show a saw?→ GC. Pool it, type it, stop allocating strings.
7  is it only on first run?      → boot: program prewarm, bake queue.
8  is it only after 3 minutes?   → thermal: resolution ladder, sticky demotion.
```

This order matters: it puts the cheapest, most likely causes first and never lets a
measurement be replaced by a hunch.

---

## 16. Top 15 for *this* game, ranked

| # | Technique | Row | Status |
|---|---|---|---|
| 1 | Cap dpr at 1.5 | pixels | planned (`12`) |
| 2 | Overdraw budget ≤4× with a live counter | pixels | planned (`17`) |
| 3 | Zero allocations in the draw path (strings!) | GC/JS | **violated today** in `player.ts` |
| 4 | Batch rig strokes 20 → ≤4 | JS+fill | planned (T6.13) |
| 5 | Bake at draw size, never rescale | pixels | planned (`12` §6) |
| 6 | One opaque canvas, zero extra layers | compositor | **already true** |
| 7 | Fixed timestep + render interpolation | judder | planned (T6.5) |
| 8 | One-plate-per-frame bake queue | boot spike | planned (`13` §7) |
| 9 | Canvas ledger + zero-on-release | memory | planned (`12` §4) |
| 10 | Pause on hidden, release GL | battery | planned |
| 11 | Cull/skip off-screen animation + chains | CPU | planned (`20`) |
| 12 | Text cached to plates | JS | **already true** |
| 13 | Fixed-bucket percentiles, not FPS averages | truth | planned (`11`) |
| 14 | Thermal-sticky tier demotion | sustained | planned (`14`) |
| 15 | Boot probe picks the tier | everything | planned (`14`) |

Note how much of it is already true or already planned — and that the one currently
*violated* item is allocation-free drawing, which is a Rule-10-adjacent correctness
issue, not a micro-optimisation.

---

## 17. Rejected-with-reason summary (so nobody re-litigates it)

| Technique | Reason it cannot help us |
|---|---|
| Dirty rectangles for the world | the world scrolls; everything is dirty |
| Multi-canvas layering / CSS parallax | compositor ms + GPU memory per full-screen layer (D7) |
| WebGL rewrite of the game renderer | draw-call count is ~15; fill and JS dominate (D3) |
| Instancing / atlas / sprite sheets | no assets, no thousands of sprites |
| Worker-rendered `OffscreenCanvas` | moves input+React boundary; M7 only |
| WASM | our hot code is draw calls, not arithmetic |
| Service-worker asset precache | there are no assets |
| GPU timers | not exposed on mobile |
| `willChange` / `translate3d` on game layers | memory cost, no benefit inside one canvas |
| Average FPS as the target | hides the variance that players feel |

---

## 18. Sources

Compositor/layer cost and `alpha:false`/`desynchronized`: `12` §5 sources (Chrome
desynchronized blog; IBM canvas layering; digitalstrategyforce). Canvas batching and
stroke consolidation: Grokipedia *Canvas element* summary of benchmarks; Nicola
Hibbert, *Optimising HTML5 Canvas games*; explainx canvas guide (2026). Dirty rects
and their limits: ubgworld *Browser game development 2015*; rustcodeweb canvas tips.
GC: V8/Orinoco write-ups (allocation rate, pooling ~90 % reduction, typed arrays
outside the generational heap). Parallax/compositor: builder.io, codefronts, wpdean
(compositor-only properties; permanent `will-change` costs memory). WebGL2 instancing
scale numbers: dinogame.gg WebGL2 advances; abratabia *animation performance*
(500–1000 sprites desktop / 100–300 mid mobile with batching; 20–40 without).
Image decoding per browser: calendar.perfplanet 2025; ludicon *Image Loading on the
Web* (2026); fastDrawImage. Lifecycle: Page Visibility API write-ups (pause rAF, clamp
dt). Canvas text/shadow cost: Grokipedia + explainx.
