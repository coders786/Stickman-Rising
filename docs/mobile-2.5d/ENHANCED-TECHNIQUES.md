# Enhanced techniques — hardened contracts from the M1/M2 implementation

**Status: implemented designs with regression tests.** This document records
the *further enhancements* made while executing [PLAN.md](PLAN.md) milestones
**M1 (input/pool/birth/reset correctness)** and **M2 (shared frame, contact,
geometry and cache repairs)** in this repository. It extends — and where they
conflict, supersedes the implementation claims of — [TECHNIQUES.md](TECHNIQUES.md).
Everything labeled *implemented* is covered by a named test file under
`tests/`; everything labeled *open* maps to milestones M3–M7.

Evidence terms follow [EVIDENCE.md](EVIDENCE.md): a passing regression test
proves the stated invariant on the exercised domain, not device performance.

---

## 1. Step-owned command edges (enhancement of TECHNIQUES §1)

### The hardened model

Gameplay `pressed()`/`released()` edges now move through an explicit
ownership state machine:

```text
event arrives (between rAF callbacks)
  → edge PENDING (survives any number of zero-step renders)
  → first legal simulation step reads it          [consumed exactly once]
  → cleared immediately after that step (endFrame)
```

Three distinct tick APIs make the ownership explicit (previously one
`endFrame` did all three jobs, which is exactly how edges were lost):

| API | Clears | Called by |
|---|---|---|
| `Input.endFrame(dt)` | gameplay edges | after **each simulation step** |
| `Input.endRenderFrame()` | raw editor keys only | bottom of **every render** |
| `Input.clearEdges()` | gameplay edges + buffers + stamps | **intentional resets**: pause/blur/disable, `setPhase` transitions |

### Policies derived during implementation

1. **Frozen frames discard edges.** While `paused` or edit-frozen no step
   will ever consume an edge; keeping one would fire a stale press on resume.
   The frame loop calls `endFrame(0)` in the frozen branch. This is the
   documented "gesture cancel at a state boundary", not a lost command.
2. **Phase transitions clear edges + buffers.** `setPhase` clears on any
   phase change so a `pause` press during game-over cannot detonate on the
   first step of the next run. Hold (`down`) states are untouched — they are
   owned by `setEnabled(false)`/`reset` on pause.
3. **Hitstop does not drop edges.** Slow steps still run (fixed-size), so a
   press arriving during hitstop waits for the next legal simulation
   boundary — matching TECHNIQUES §1's "commit at the legal simulation
   boundary". The combo buffer (press-time based) continues to span frames.
4. **Zero-step renders keep raw edges one frame** — the editor's scrub/jog
   semantics (`rawPressed`) are unchanged.

**Control:** the old bottom-of-frame full clear. **Reject:** any schedule
where an edge is cleared before a step read it, or read by two steps.
Implemented in `src/game/core/input.ts`, `src/game/game.ts`;
tested by `tests/input-edge-ownership.test.ts`.

## 2. Fixed-step scheduler with an explicit overload ledger (M03)

TECHNIQUES §0.2 asked for a bounded fixed-step policy; the implementation is
a pure function (`src/game/core/sim-clock.ts`):

```text
acc += dt
if acc > maxBacklog:  dropped += acc − maxBacklog;  acc = maxBacklog
steps  = min(floor(acc / stepDt + ε), maxSteps)      // ε kills float dust
acc   −= steps · stepDt
invariant:  requested = steps·stepDt + dropped + acc
```

Policy: `stepDt = 1/60`, `maxSteps = 4`, `maxBacklog = 4/60` (~66.7 ms
ceiling per render — slightly *less* sim work per hitch than the old
3×1/60 + variable 50 ms catch-up, so recovery is cheaper).

**Enhancements over the old loop:**

- no variable-size tick ever reaches `Game.step` (the `[1/60,1/60,1/60,.05]`
  mixed-step witness is structurally impossible now);
- dropped time is *counted* (`Game.overloadDropped`, shown in the perf
  readout when nonzero) — requested vs simulated time is auditable;
- the interpolation collapse (`recordPrev`) fires exactly when a drop
  occurred, preserving the old no-rewind guarantee.

**Reject:** any reintroduction of `step(Math.min(acc, x))`. Tested by
`tests/sim-clock.test.ts`.

## 3. Pool law, hardened (M02)

The complete law (TECHNIQUES §0.3) with the **single-membership invariant**:

```text
∀ object o:  (o ∈ live) XOR (o ∈ free)        // never both, never neither
acquire:  pop free | fresh-allocate → reset → activate → PUSH live  ← the fix
release:  age out → deactivate → SPLICE live → PUSH free (exactly once)
```

Three acquire paths violated it (`nextParticle`, `nextRing`, `startTrail`):
they activated a recycled object **without re-pushing it into the live
array`, producing the probe witness `live 0 / free 0 / active true` — an
orphan that was invisible, unaged, and leaked. All other pools
(flashes/debris/texts/cracks/lines/smears/afterimages) already pushed
unconditionally and were left alone.

**Enhancement:** a reusable assertion recipe for debug builds —

```ts
assert(live.every(o => o.active) && free.every(o => !o.active))
assert(free.every(o => !liveSet.has(o)))
```

— now encoded as `assertPoolLaw` in `tests/fx-pool.test.ts`, exercised over
12 expire/reacquire cycles plus `clear()` → new-run cycles.

## 4. Swept projectile contact (M05) with a parry travel rule

For a projectile segment `p0→p1` and a body disc `c0→c1` (radius `R`):

```text
q0 = p0 − c0 ;  v = (p1 − p0) − (c1 − c0)
a = v·v ;  b = 2 q0·v ;  c = q0·q0 − R²
c ≤ 0            → u = 0            (already overlapping)
a ≈ 0, c > 0     → miss             (no relative motion)
disc < 0         → miss
u = (−b − √disc) / 2a ∈ [0,1]      (earliest root) else miss
```

**Enhancements beyond the sketch:**

1. **Body sweep endpoints:** enemies use their true `e.px→e.x` pre/post-step
   roots (recorded by the frame's `recordPrev`); the player body uses a
   dedicated `PLAYER_BODY` record filled by `Game.step` around
   `player.update` (pre-root from `PLAYER_POS`, post-root after movement).
   A harness that never sets it falls back to a static body at `PLAYER_POS`.
2. **Parry remaining-travel rule:** on a parry the bullet is placed *at the
   contact point*, reflected, then advances `(1−u)·dt` under the **new**
   velocity — never a second full `dt` (TECHNIQUES §1's rule, now coded).
3. **Earliest-contact ordering** across enemies (`min u`), and the swept
   segment retains the exact old radii (`rr+16` player, `30·scale` enemy) —
   no hitbox inflation, verified by a clean-miss control test.
4. **Deliberately not swept:** the firewave's 64-px horizontal window (its
   wave speed is ≪ window/tick; changing it would alter combat semantics —
   flagged for the combat-contract review, not silently rewritten).

The EVIDENCE.md witness (vx −1440, dt .05, endpoint distance 37.6 > 30) is
reproduced as a regression test that fails on endpoint-only logic.
Tested by `tests/projectile-sweep.test.ts`.

## 5. Typed cache-key schema (F09 + F07)

**Rule: a cache key is the set of every input that changes the output —
quantization is part of the documented contract, not an accident.**

- **Light solve (`lightSignature`)** now includes `kind, x>>1, y>>1,
  range>>1, intensity*100|0, **color rgb**` per light plus ambient and size.
  The old key omitted RGB (the stale-red→blue witness).
- **Reflection atlas (`reflectionRefreshKey`)** upgraded from
  `(span, quality)` to

```text
span | tier | viewLeft>>1 | realloc? | player(x>>1,y>>1,face,state)
     | ∀visible enemies: id, x>>2, face, state
```

  with two structural fixes:
  * **realloc is captured before assignment** (the old
    `this.reflPW !== pw` test ran *after* `reflPW = pw`, so a fresh empty
    plate never refreshed);
  * **the plate blits at its stored world anchor** `reflViewLeft` instead of
    the current `viewLeft` — sub-2-px camera drift stays world-anchored
    instead of sliding reflections off actors, and larger pans change the key.

**Honest residual (F08):** the atlas *period* (1/20 s) remains only as a
fallback bound for pose-internal limb motion the key cannot observe; the
old “<1.5 px at 20 Hz” claim (arithmetically wrong: 2 600 px/s × 50 ms =
130 world px) was removed from `look.ts`. Error-gated refresh (MCRI, M4)
supersedes this key. Tests: `tests/light-rig-key.test.ts`,
`tests/reflection-key.test.ts`.

## 6. Visual-clock response filters — semigroup, with a sampler caveat (F03/F04)

```text
a(dt, τ) = 1 − exp(−dt/τ) ;  y ← y + a·(target − y)
```

Repeated application composes **exactly**: `Π(1−aᵢ) = exp(−Σdtᵢ/τ)`, so
10×0.01 s ≡ 1×0.1 s in exact arithmetic (and to ~1e-15 in floats). The
moon-visibility filter derives its taus from the authored rates
(`τ = 1/(rate·60)` → ≈0.93 s darkening, ≈2.78 s brightening), replacing the
per-draw `min(1, rate·60)` factor that made state depend on draw count
(the 6-vs-14-draw witness).

**Enhancement — the sampler caveat:** the 2-slot media bracket advances on a
`1/24 s` quantization grid, so *its phase* legitimately differs between
update splits (different grids sample different instants). The response
filter is split-invariant; the bracket is a discrete sampler. Tests isolate
the two claims accordingly (constant-`sampleTransmission` for the filter;
an advance-from-`update` test for the sampler). Bracket values are now
interpolated with real `t0 ≤ t ≤ t1` keys (`mix(A,B,u)`) — the old
`min(A,B)` was a biased hold, now correctly named and replaced.

## 7. Unique-union damage lattice with run merging (F15)

```text
union = |{ idx ∈ prev ∪ cur }|            // stamped dedup, counted ONCE
if full or union > 0.58·total → one full clear
else → clear each unique cell ONCE, merged into horizontal runs
       (row-major ascending indices ⇒ consecutive idx in a row are adjacent
        columns; track the last INDEX, derive its column)
```

The old `prev.length + cur.length` double-counted cells touched in both
frames — identical ~32 % coverage summed to 64 % and falsely selected a
full clear. Run merging also cuts `clearRect` calls from *N cells* to *N
runs* (row-major run detection bug caught by the very first test — the
column-vs-index confusion is now pinned by exact-rect assertions).
Fractional-DPR `floor/ceil` cell bounds are unchanged and separately tested.
Tested by `tests/damage-lattice.test.ts`.

**Enhancement note:** `DamageSurface.markRect` treats the upper edge cell as
touched (`floor((x+w+pad)/s)` inclusive) — conservative over-marking that is
safe for clearing; tests pin marks to single cells with interior
coordinates rather than changing the proven semantics.

## 8. Draw-purity ledger (F14/M08)

| State that used to mutate inside draw | Now advanced by | RNG |
|---|---|---|
| wake-fog step + actor injection | `Game.updateWakeFog(simDt)` once per frame | n/a |
| moon filter + media bracket | `ZenNightBackground.update(dt)` | n/a |
| petal→pond ripple events | `ZenNightBackground.update(dt)` (rate `1−e^{−0.24·dt}` ≈ old 0.004/draw @60) | dedicated `rippleRng` |
| film-grain plate/offset choice | still per frame, but… | dedicated `grainRand` LCG |

**Rule for every future effect:** a render call may *read* clocks, packets
and caches; it may not advance simulation, spawn events, or consume the
global RNG shared with gameplay/audio. Visual events are generated on the
visual clock with their own stream.

**Open (M5):** gameplay vs audio RNG streams are still the global `rand()` /
`Math.random` pair — separated for the draw path here; full stream ownership
(audio included) remains a milestone.

## 9. Piecewise-continuous wind displacement (F05)

`windAt(t,s)` is an exact antiderivative only for constant `s`. With
`storm.wind = 0.38 + 0.12·sin(t·0.7)` the old `s(t)·F(t)` introduced jumps
of `Δs·F(t)` (F grows ~t; the t=5 jump is ≈1.9 world px) and broke
`dD/dt = vx`. The enhancer: carry state and integrate per update segment

```text
F = windAt(t, 1) unit primitive (0.85 carrier included)
D += s_prev · (F(t) − F(t_prev))          // s_prev = strength at segment start
```

which (a) telescopes to exactly `windAt(t,s)` under constant strength, and
(b) is continuous across any strength change. Velocity output is untouched.
Tested by `tests/wind-carrier.test.ts` (equivalence, continuity bound 0.1 vs
the ~1.9 jump the old law produced, finite-difference derivative).

## 10. Continuous sky plates — CSS step 1 (F02)

`ZenNightBackground.drawSky` no longer routes through `SkyVaultCache`.
Invariant artwork is cached **at bake time** (staticFar/staticMid/cloud/
lunar/shaft/star sprites are already retained canvases); every display frame
runs only their transforms plus the genuinely dynamic layers (cloud drift,
moon glow, shaft breathing, storm, star twinkle, mist seam). The old
`dt ≥ 0.22` composite hold froze all of that at ~4.3 Hz.

**Cost honesty:** this trades a broken cache for ~25 baked-plate blits per
frame — the correct-by-construction baseline the plan demands; its frame
cost must be re-measured at M3 gates, not assumed. `SkyVaultCache` itself
remains for the cyber background, where its hold is now *labeled* as a
quality tradeoff pending the same split. Full layer-split CSS (per-plane
transform + live twinkles inside a retained vault) is M3 work.

---

## 11. Implemented ↔ test index

| Finding | Change | Test |
|---|---|---|
| M01 edge loss | step-owned edges + 3-tick API | `tests/input-edge-ownership.test.ts` |
| M02 pool orphans | acquire re-registration ×3 paths | `tests/fx-pool.test.ts` |
| M03 mixed-step hitch | `core/sim-clock.ts` + telemetry | `tests/sim-clock.test.ts` |
| M04 stale projectile history | `spawn()` NaN birth reset | `tests/projectile-sweep.test.ts` |
| M05 endpoint-only collision | swept TOI + parry travel rule | `tests/projectile-sweep.test.ts` |
| F03 `min(A,B)` hold | real t0/t1 interpolation | `tests/zen-visual-clock.test.ts` |
| F04 draw-count filter | dt-based semigroup filter in update | `tests/zen-visual-clock.test.ts` |
| F05 wind product law | piecewise-continuous integrator | `tests/wind-carrier.test.ts` |
| F07 reflection key | typed key + realloc + world anchor | `tests/reflection-key.test.ts` |
| F09 missing RGB | `lightSignature` | `tests/light-rig-key.test.ts` |
| F14 draw mutations | fog/moon/ripples → update; draw RNG streams | `tests/zen-visual-clock.test.ts` |
| F15 duplicate-area clear | unique union + run merge | `tests/damage-lattice.test.ts` |

Suite status: **270 tests, 262 pass, 8 fail** — the same 8 classified
pre-existing failures documented in EVIDENCE.md (blade-cleave ×2,
sakugaHammer rate, full-body ×3, ritual key count, unarmed pad). They are
combat/animation contract reviews (M-plan §3), untouched by this work.

## 12. What deliberately remains open (M3–M7)

- **MCRI** error-gated reflections (replaces the §5 key fallback).
- **SWP** parcel certificates, **EFBL** emission bloom ledger, full
  **ACMT** aperture transport, **RBAP** material bases — unchanged designs,
  now with the §6/§7 clock and key lessons folded in.
- Staged/worker asset generations, context-loss rebuild, Next production
  build/caching audit, WebGL2 vertical slice, physical-device matrix and
  20-minute thermal runs — release gates per PLAN.md.
- Combat-contact contracts behind the 8 failing tests; touch-layer
  multi-pointer validation; audio/gameplay RNG stream split.
