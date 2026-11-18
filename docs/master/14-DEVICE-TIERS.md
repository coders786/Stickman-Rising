# 14 — DEVICE TIERS: DETECTION BY MEASUREMENT (Phase 10)
**Serves:** D2 (mobile = performance) · REQ-710 (resolution first) · `12` §3.

We cannot ship a tier ladder that is chosen by a GPU name, because the GPU name
is not reliably available. This document defines what we *can* read, what we must
*measure*, and how the measurement maps to a tier — with the boot cost of finding
out.

---

## 1. Why name-based detection is dead

| Signal | Chrome/Edge | Firefox | Safari | Brave |
|---|---|---|---|---|
| `WEBGL_debug_renderer_info` (unmasked renderer) | exposed | **blocked behind a permission prompt** | **blocked** | **randomised per session** |
| `navigator.hardwareConcurrency` | exposed | exposed | exposed | **farbled** |
| `navigator.deviceMemory` (GB, rounded to a power of two) | exposed | exposed | exposed | **farbled or reduced** |

Sources: browser-fingerprint surveys of these exact APIs
(`https://www.thumbmarkjs.com/content/browser-fingerprinting-techniques/`,
`https://dev.to/davidtimothy/how-much-can-websites-really-detect-about-brave-users-4bmb`),
and a GPU-detection service that states the quiet part out loud: "browser APIs
provide limited hardware information… real-world performance depends on many
factors we can't measure from a browser: thermal throttling, background
processes, driver versions, OS memory pressure" — so they run **a ~30 ms CPU
benchmark** instead of trusting the string
(`https://canirun.ai/why/`).

Since the platform that matters most (iOS, `12`) blocks the string outright, and
Android privacy builds falsify it, **tier selection must be measured on the
device that is about to run the game.**

---

## 2. What we read (cheap, no probe)

```
webgl2: boolean                     // 98.7 % iOS, 99.2 % Android (web3dsurvey)
maxTextureSize                      // decides the plate ladder ceiling
MAX_FRAGMENT_UNIFORM_VECTORS        // sanity for the uniform block
mediump range (getShaderPrecisionFormat)  // is mediump really 16-bit here?
devicePixelRatio                    // capped (§3)
innerWidth/innerHeight              // canvas size ⇒ fill budget
hardwareConcurrency, deviceMemory   // prior only, never a decision
prefers-reduced-motion              // REQ-604, unrelated to perf but read here
```
`devicePixelRatio` arrives as 2, 3, even 4; passing it straight through means
"rendering nine times the pixels of a ratio-1 screen, for no visible gain" — the
single most-cited cause of mobile slideshows, fixed by
`min(dpr, 2)` **[C]**
(`https://dev.to/gronskideveloper/threejs-on-mobile-the-device-gotchas-that-tank-a-configurator-3oe`).
We cap at **1.5 on mobile, 2.0 on desktop** (`12` §3), and never below 1.0.

---

## 3. What we measure (the boot probe, ≤120 ms)

Runs **once**, inside the existing loading transition, before the first
gameplay frame. Every stage is defensive: a throw ⇒ that stage contributes 0 and
the tier goes down, never up.

| Stage | What it does | Reports | Budget |
|---|---|---|---|
| `P-fill` | 3 full-screen `P_cumulus` draws at the candidate plate size into a 1×1 FBO viewport… (FBO at real size, 3 draws) | ms per 590 k px | ≤45 ms |
| `P-read` | one `readPixels` of 512×512 RGBA + `putImageData` into a scratch canvas | ms per 1 MB readback | ≤25 ms |
| `P-alloc` | 64 canvas acquire/release cycles through the ledger | ms per cycle (ledger sanity) | ≤15 ms |
| `P-cpu` | tight integer loop, ~30 ms wall | "CPU index" (like canirun) | ≤35 ms |
| `P-cap` | context creation + 8 program links | ms, and `LINK_FAIL` count | ≤0 (compiled once at boot anyway) |

`gl.finish()` after each timed draw: it blocks the CPU on purpose — at boot that
is exactly what we want (a sync point), and it is what practitioners use when no
GPU timer exists (`https://www.sitepoint.com/webgpu-vs-webgl-inference-benchmarks/`).

**It measures the device as it is right now.** A cold phone measures fast; a
phone that has been in a pocket measures slow. That is fine: the boot tier is a
**ceiling**, and the governor (`12` §3) may only shed below it, never above.

---

## 4. Mapping: probe → class → tier

Derived thresholds, all `[T]` until M6 measures real devices:

| Class | Examples (judgement, not a device DB) | `P-fill` @590 k px | `P-read` @1 MB | Starting tier | `atmoScale` | Ladder step | `dprCap` |
|---|---|---|---|---|---|---|---|
| **C0** | 2019–21 mid Android, iPhone SE | >9 ms | >5 ms | `low` | 0.5 | 512×288 | 1.5 |
| **C1** | 2022–24 midrange | 5–9 ms | 3–5 ms | `medium` | 0.66 | 768×432 | 1.5 |
| **C2** | recent flagship phone / tablet | 2–5 ms | 1.5–3 ms | `high` | 1.0 | 1024×576 | 1.5 |
| **C3** | desktop / laptop with dGPU or Apple silicon | <2 ms | <1.5 ms | `ultra` | 1.0 | 1280×720 | 2.0 |
| **Cx** | WebGL2 missing, probe threw, or `LINK_FAIL` | — | — | `low` **Canvas2D fallback** | — | no GPU plates | 1.5 |

Rules:
* A single bad probe **demotes one class**; two bad probes ⇒ C0.
* `deviceMemory ≤ 2` or `hardwareConcurrency ≤ 4` demotes one class (prior only).
* A device that reports `dpr ≥ 3` is demoted one class **unless** C3-class probe
  values, because fill cost tracks physical pixels.
* The chosen class is stored in `sessionStorage` keyed by `UA + WxH + dpr` so a
  reload does not re-probe; it is **never** stored longer than the session (the
  device's thermal state changes).

---

## 5. Platform-specific reality table

| Platform | Behaviour we must plan for | Source / doc |
|---|---|---|
| iOS Safari | total canvas memory cap 224–384 MB, silent transparent canvases, no `WEBGL_debug_renderer_info`, per-canvas area 16.7 M px pre-18 | `12` §4 |
| Chrome Android | reclaims GPU memory on background ⇒ `webglcontextlost`; no timer query | `12` §2.6 |
| Firefox (any) | `texImage2D` from a large canvas ~40 ms **every** call (no cache); timer query absent | `12` §6 |
| Privacy builds (Brave) | falsified renderer/concurrency/deviceMemory ⇒ probe is the only truth | §1 |
| WebGL2 absent (≈1.3 % iOS) | no GPU plates at all; Canvas2D plates + ledger still work | `02`, `05` |

---

## 6. Boot sequence (total ≤~350 ms, inside the existing fade)

```
0    create game canvas (alpha:false, desynchronized:true)          existing
1    ledger init, caps from class guess (C1 default)
2    GL context + compile 8 programs (hidden 1×1 canvas)            ≤45 ms [T]
3    boot probe (§3)                                                ≤120 ms [T]
4    resolve class → tier ceiling, ledger caps, ladder step         ~0 ms
5    atlas generation (13 §2)                                       ≤5 ms [T]
6    first plate(s) — one per frame (§13.7)                         ≤6 ms each
7    gameplay frame 1
```
Any stage that overruns aborts to the next-lower class and continues — **boot
never fails closed into a black screen**; it fails closed into `low`.

---

## 7. What the governor does with the class

* The boot class sets `tierCeiling`. The governor can go **down** any number of
  steps and **up** at most back to the ceiling (12 s raise guard, existing).
* Thermal demotion is **session-only**: after a 10-minute run, a phone that
  dropped two steps stays at that class for the session even if it cools, because
  we measured that it throttles (F2) and re-raising is how oscillation starts.
* The user's manual quality setting (existing settings screen) becomes an
  **override of the ceiling**, not of the ladder: "low" means never above `low`.
* `prefers-reduced-motion` disables drift/ripple/glitter independent of tier
  (REQ-604) — it is a comfort setting, not a performance one.

---

## 8. Failure modes

| Failure | Guard |
|---|---|
| Probe measures a cold device, gameplay throttles in 3 min | ceiling only; governor sheds; thermal demotion is sticky |
| Probe itself causes jank on a slow device | ≤120 ms total, inside the fade, one attempt, no retries |
| `sessionStorage` unavailable (private mode) | default to C1 and proceed; no exception |
| Class changes between reloads on the same device | allowed and expected (thermal); reported in the bench log |
| A device classifies as C3 but is a desktop iGPU at 4K | dpr ≥3 demotion rule + governor |

## 9. Open items

1. **Thresholds are unvalidated.** They come from the model in `17`, not from
   phones. The first device report (M6) replaces this table; until then `C1` is
   the default guess for anything unknown.
2. **Is 120 ms too much boot budget?** The existing loading path already bakes
   20–25 ms; 120 ms of probe doubles "time to first gameplay frame" if it is not
   hidden by the fade. If M1 measures the fade shorter than 120 ms, the probe
   splits across two frames.
3. **Should the probe bake a real plate?** `P-fill` uses the cumulus program on a
   dummy uniform set, which is close but not identical to the real bake. M2
   decides whether to time the *first real plate* and feed it back into the class
   instead of using a synthetic probe.
