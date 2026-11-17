# 18 — MOTION & "120 fps"-GRADE SMOOTHNESS (Phase 6c)
**Serves:** D2 · D8 · FID-23/24 · the user's question: *how do mobile browser games
actually reach 120 fps smoothness?*

Short answer, from the research, before the detail:

1. **On iPhone you cannot.** Safari ships a feature flag that clamps `requestAnimationFrame`
   to ~60 fps, and PWAs always run on default flags.
2. **On Android Chrome you can, but not from the main thread** — the main thread is
   throttled to 60 Hz on 120 Hz screens and only lifts the cap while a finger is
   moving. The documented escape is a worker-owned `OffscreenCanvas` frame clock.
3. **Raw 120 is not what makes motion look good.** Perceived smoothness gains flatten
   around 75–90 fps; what keeps improving is *latency* and *cadence stability* — and
   frame-time standard deviation predicts QoE with R² = 0.99.

So the plan is: **lock cadence, kill sub-pixel judder, add half-frame motion cues,
and make 120 an opt-in capability** — not "chase 120 everywhere".

---

## 1. Capability map: who can actually do 120 today

| Platform | 120 Hz rAF? | Evidence | What we can rely on |
|---|---|---|---|
| **iOS Safari (17.x)** | No — clamps ~60 | Apple keeps "Prefer Page Rendering Updates near 60fps" **on by default** on macOS/iOS/iPadOS; iPad 120 works once disabled, iPhone only from iOS 18 | 60, perfectly paced |
| **iOS Safari 18+ (iPhone Pro)** | Yes, **only if the user unchecks the flag** (Settings → Safari → Advanced → Feature Flags) | WebKit bug 173434 resolved on iOS 18 public release; TestUFO reaches 120 on Apple hardware with the flag off | 60 by default, 120 if the user opted in |
| **iOS PWA / home-screen app** | **No, ever** | "PWAs only run on system default flags… above 60fps is disabled for all PWAs" (same bug) | 60 |
| **Chrome on Android** | **Capped at 60 on the main thread** on 120 Hz screens; cap lifts only while a finger moves (`kThrottleMainFrameTo60Hz`) | Uno Platform PR #25181, which fixes exactly this by moving the frame clock to a worker | 60 paced; 120 only via a worker clock |
| **Android via worker + `OffscreenCanvas`** | Yes — "a dedicated worker that owns a canvas gets its own frame clock, and Chrome doesn't cap it" | same PR: render into a standalone `OffscreenCanvas`, hand the page canvas over as a `bitmaprenderer`, show one frame per refresh | the *only* real 120 path on Android |
| **Firefox / Edge / Samsung (Android)** | Uncapped by default (all APIs) | Blur Busters' HFR compatibility notes / WICG proposal #165 | display rate |

Consequences we accept:
* **We do not promise 120.** We promise *locked cadence at the highest rate the
  platform will give us*, and we detect which rate that is (§6).
* The main-thread Canvas2D game loop is capped at 60 on the two biggest mobile
  platforms by default. Any plan that assumes 120 on mobile is fiction.

---

## 2. What 120 actually buys (and what it doesn't)

### It buys
* **Half the input-to-photon quantum** (16.7 → 8.3 ms), on any device that allows it.
* **Half the display persistence**, and persistence is a hard floor on motion blur:
  "1 ms persistence = 1 pixel motion blur per 1000 px/s" — so 60 fps = **16.7 px**
  of blur at 1000 px/s, 120 fps = **8.3 px** (Blur Busters Law).
* **Less judder on OLED**, because fast GtG stops hiding frame breaks. Practitioners
  put it plainly: "Oleds actually look more juddery at 60fps/hz than lcds because the
  picture smears less… you notice harder breaks between each frame." Every iPhone
  since the 12 is OLED, so this applies to our exact target audience.

### It does not buy
* Performance: "player performance rises sharply from 7 through 90 fps, but sees
  little benefit above 120" and QoE gains are "statistically significant through
  five consecutive transitions, up to 60 vs 75 fps, and flattens above that"
  (Claypool et al., frame-rate series, incl. the up-to-500 Hz study).
* Smoothness from *repeated frames*: on a sample-and-hold display "60fps@60Hz and
  60fps@120Hz look identical… repeat refreshes in sample-and-hold look exactly the
  same as one longer refresh" (Blur Busters forums). **Fake 120 by duplicating
  frames is worthless** — this is the single most common wrong idea and it is why
  we will not "just run the rAF loop at 120 and only draw every other frame".

### The real predictor is variance
In a controlled 60 Hz vs 120 Hz study with injected frame-time variation, **frame
time standard deviation predicted average QoE with R² = 0.99**, and average frame
rate was "not an effective predictor… the average is hiding the underlying frame
time variation" (CHI '23, *The Effects of Frame Rate Variation on Game Player
Quality of Experience*). Same paper: "a 60 f/s average on a 120 Hz system is likely
not the same as 60 f/s on a 60 Hz system" — the 120 Hz system's 60 is uneven.

**That is our thesis: cadence beats rate.** A locked 60 with 8 ms of headroom looks
better than an unlocked loop swinging 48–75.

---

## 3. Our scene's motion budget (why we are not a first-person shooter)

Persistence blur = `persistence_ms × speed_px_per_s ÷ 1000`:

| Element | Speed | Blur @60 fps | Blur @120 fps |
|---|---|---|---|
| play-band mean motion (FID-23 ≤0.15 px/frame) | ~9 px/s | **0.15 px** | 0.08 px |
| sky/cloud drift (`07` windPx) | 1.1–9.0 px/s | 0.02–0.15 px | negligible |
| camera pan during a run **[E]** | 40–160 px/s | 0.7–2.7 px | 0.35–1.3 px |
| stickman lunge / attack arc **[E]** | 500–900 px/s | **8–15 px** | 4–7.5 px |
| FX (dust, sparks, muzzle) | 300–1200 px/s | 5–20 px | 2.5–10 px |

**Reading:** our *environment* is slow enough that 60 fps already has essentially
zero persistence blur — the sky will not look better at 120 no matter what. The
only elements that benefit are **fast entity/FX motion**, and there the cheapest
fix is a half-frame smear (§5 L3), not doubling the frame rate.

This also explains why the user's instinct ("make it look like 120") is about
**perceived cadence and crispness**, not about the sky.

---

## 4. L1 — Cadence lock (biggest win, zero GPU cost)

```
fixed timestep     dt = 1/60 s exactly; accumulator; max 2 steps per frame (never spiral)
render interpolation  draw at lerp(prev, cur, alpha) for camera, parallax, entities
cadence target     display/1 or display/2 — never display/3
60-on-120 rule     lock to every second vsync; un-paced 60 on a 120 Hz panel judders
                   ("you need to make sure to sync against every other display vsync…
                    if you just set a 60FPS limit in 120Hz it's not going to be synced")
never 45–55        below target, drop a whole rung (60 → 30) so every frame is even
                   (console cadence logic, r/pcgaming / r/OLED threads)
```
Why interpolation instead of variable `dt`: `rAF` timestamps jitter by ±0.4 ms
(and are quantised to the vsync grid), so integrating raw `dt` into slow motion
produces exactly the "things move very slowly → they shake" complaint that recurs
on r/gamedev and r/gamemaker. A fixed step + interpolated render is what "smooth"
means in practice.

Cost: a second position per moving thing (or a scalar `alpha` applied at draw).
Memory: negligible. Risk: none gameplay-side if interpolation is draw-only —
**physics stays integer-deterministic**, so the 244 tests keep passing (Rule 10).

---

## 5. L2…L5 — the rest, in order of effect per cost

### L2 · Sub-pixel discipline (fixes the "why does it shake" class)
Community consensus is unanimous and consistent with our own P2 finding:
* keep floats, round **once at draw**, and round **every layer the same way**
  ("it's the mixed coords. You're rounding the background but drawing the hero at a
  fractional screen position, so they slide against different pixel grids and shimmer");
* "the only times I've had problems with jitter are when things move **very slowly**,
  or when there are **parallax layers**" — both true of our sky.

Our rule, therefore:
```
entities / camera     float physics, round screen-space at draw, same grid for all
cloud plates          integer offsets ONLY (P2 shimmer), BUT windPx must stay ≥12 px/s
                      at 1080p, otherwise the 1-px step becomes visible at 60 fps
                      3 px/s = one step every 333 ms → reads as a stutter, not drift
```
That last line is a real conflict between `07` (windPx 1.1–9.0) and P2 (integer
offsets). Resolution: **clamp authored wind to ≥12 px/s at 1080p (2.4 px/s at
`atmoScale` 0.2…), or sub-pixel blit with mip-smoothed plates** — decided by
prototype **P9** (new, §8). We do not ship 1.1 px/s integer drift.

### L3 · Half-frame motion smear (the film trick, correctly sized)
Reddit and graphics practice converge: "well implemented motion blur makes motion
appear smoother at a much lower performance cost", and the *correct* amount is a
**half-frame shutter**, exactly like a real camera (`r.MotionBlur.TargetFPS 0`
"locks the motion blur size to current framerate… always exactly half a frame").

Our version is deliberately humble:
```
apply to   FX, trails, lunge arcs — the fast stuff
never to   the stickman silhouette, enemy telegraphs, or the play band floor
method     one extra blit of the previous frame's fast elements at alpha ≤0.25,
           stretched along the velocity vector (no per-pixel blur, no readback)
budget     +1 blit, full-screen ΔL ≤10 % (REQ-603), off under prefers-reduced-motion
```
Above ~80 fps it should be **disabled** by default (practitioner consensus: "above
around 80FPS, I generally prefer it off or low"), which we gate on measured cadence.

### L4 · True 120 where the platform allows (opt-in)
```
gate:  rAF median interval ≤9 ms (i.e. the platform is really at 120)
   and p95 frame time ≤8.3 ms at the current atmoScale
   and the player has enabled "high refresh" (battery cost is real)
path:  main-thread 120 works on Android Firefox/Samsung and Safari-with-flag;
       Chrome Android needs the worker clock (OffscreenCanvas + bitmaprenderer,
       one frame per refresh, ≤2 queued) — a game-loop change, so it is M7, not M1
fallback: display/2 with even cadence
```
The worker-clock refactor is *not* in this roadmap because it moves the loop,
input and React boundary — the exact class of change Rule 10 protects against.
It is recorded as the only known route to 120 on the largest mobile platform.

### L5 · Compositor-driven HUD (cheap "free" 120 polish)
On devices where rAF is clamped to 60, **CSS animations still run at display rate**:
"on their 120hz devices, `requestAnimationFrame` is throttled to 60hz, whereas CSS
animations run at 120hz" (WHATWG/HTML issue #5025; the same report that makes
TestUFO's clamping visible). So a small DOM overlay (combo pulse, damage vignette,
score flash) animated with `transform`/`opacity` gets 120 Hz smoothness on an iPhone
*without* touching the game loop.

Cost: one absolutely-positioned `<div>` layer with `will-change: transform`, no
layout, no per-frame JS. Risk: it is a second compositor layer — the very thing D7
avoided — so it must be **small and short-lived** (a 200×200 pulse, not a full
screen) and is disabled on `low`.

---

## 6. Measuring cadence (so "smooth" is a number)

| Metric | Definition | Target |
|---|---|---|
| `M-CADENCE` | median rAF interval | 16.67 ±0.5 ms (60) or 8.33 ±0.4 ms (120) |
| `M-EVEN` | % of intervals within ±2 ms of target | **≥95 %** |
| `M-JUDDER` | p99 interval − p50 interval | ≤8.3 ms at 60 |
| `M-CLAMP` | median 59.5–60.5 **and** frame time <12 ms | boolean — means the platform is clamping, not us |
| `M-SUBPIXEL` | max |Δscreen position| per frame on a slow layer | ≤1.0 px, and never 0 for >6 frames |

`M-CLAMP` matters because it separates "our game is slow" from "the browser will
not give us more" — a distinction the user has already been burned by once
("a 200 is not proof of health"). The heuristic is borrowed from a real bug report
that had to detect Safari's silent 60 fps clamp: `fps.median 59.5–60.5` with
`activeFrameTime < 8.33 ms` ⇒ clamped
(`https://github.com/kevmoo/flutter-wasm-compare/issues/40`).

---

## 7. Acceptance criteria (added to `04`)

| ID | Target |
|---|---|
| FID-32 | `M-EVEN` ≥95 % at the achieved rate; `M-JUDDER` ≤8.3 ms |
| FID-33 | `M-SUBPIXEL`: no layer stationary for >6 frames while the world moves (no 1-px stepping) |
| FID-34 | Cadence mode is **never** 45–55: either ≥target or a clean rung below |
| FID-35 | 120-mode (when enabled) holds p95 ≤8.3 ms for 60 s or drops back to 60 automatically |
| FID-36 | Smear adds ≤1 blit and full-screen ΔL ≤10 %; disabled under reduced motion |

---

## 8. New prototype

**P9 · Drift-speed vs shimmer.** Hypothesis: integer-offset cloud drift at ≥12 px/s
shows no stepping at 60 fps, and no texel crawl (P2's criterion).
Method: bake one cumulus plate, blit at 3 / 6 / 12 / 24 px/s with integer offsets,
capture the same 8 frames twice; measure step events per second and flat-region
temporal variance. Accept: 0 visible steps at ≥12 px/s, variance ≤1.5× static.
Reject: sub-pixel blit with mip-smoothed plates becomes the cloud path (cost: one
`imageSmoothingEnabled` toggle, possible softness — measured, not assumed).

---

## 9. What we will NOT do

| Rejected | Why |
|---|---|
| Duplicate frames to "reach 120" | On sample-and-hold, 60@120 looks identical to 60@60 (Blur Busters) |
| Render the world at 120 on mobile | `T_cpu` is 4–8 ms **[E]** (`17` §3); an 8.3 ms budget leaves nothing for a phone |
| Full-screen motion blur | Blurs the silhouette that FID-6 protects; costs a readback or a second canvas |
| Black-frame insertion | Not expressible in a browser canvas |
| Tell iPhone users "just enable 120" | A hidden developer flag is not a feature. We detect and adapt (§6) |
| Chase 500 fps | Statistically "slight upward trend" in smoothness, at ~8× the cost |

## 10. Roadmap impact

Adds to **M6**: `T6.5` cadence lock + interpolation, `T6.6` sub-pixel round-at-draw
audit (one rounding policy), `T6.7` half-frame smear (FX only), `T6.8` cadence
metrics + `M-CLAMP` detection, `T6.9` opt-in 120 mode. `T6.10` (worker-clock
`OffscreenCanvas`) is deferred to **M7** and is the only known route to 120 on
Android Chrome.
