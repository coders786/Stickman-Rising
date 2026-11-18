# 16 — PROFILE DATA (the numbers the code will consume)
**Serves:** `07` (matrix) · REQ-101…105 · FID-1…FID-25.

`07` defines the axes and rules; this document supplies the actual values for the
six archetypes so the implementer never invents a number. Everything is **[T]** =
target for art direction, not a measurement. Values are chosen to satisfy the
fidelity bands mechanically (§5 asserts them).

---

## 0. A measured fact that shapes the jitter budget

The existing palette picker (`moodIndexForSeed`, `mood.ts`) over 10,000 seeds
**[M]**:

```
NEON NOIR 25.0 %   ACID RAIN 25.7 %   EMBER CITY 24.2 %   ULTRAVIOLET 25.1 %
consecutive-seed palette repeat rate: 25.3 %
sample: 1→0  2→1  3→1  7→2  42→2  1234→2  99999→1  0xdeadbeef→3
```
It is uniform (good) and it repeats the palette on **one run in four** (expected).
So a quarter of runs *cannot* differ on A1 — they must differ on A2…A5, which is
exactly the ≥4-of-5 constraint in `07` §5. The data below is what makes that
possible: two archetypes share each palette, and `signal` vs `noir` moves all
four remaining axes.

---

## 1. Sky, weather, stars

| Field | `noir` | `acid` | `ember` | `violet` | `signal` | `ash` |
|---|---|---|---|---|---|---|
| palette | NEON NOIR | ACID RAIN | EMBER CITY | ULTRAVIOLET | NEON NOIR | EMBER CITY |
| `tod` | night | night | dusk | predawn | predawn | night |
| zenith rgb | 14,16,38 | 8,26,30 | 26,16,44 | 22,20,58 | 10,20,34 | 22,18,34 |
| mid rgb | 52,36,96 | 20,60,72 | 92,44,88 | 68,48,128 | 34,58,84 | 66,40,62 |
| horizon rgb | 122,74,116 | 104,120,96 | 214,112,84 | 168,112,168 | 110,104,112 | 148,86,72 |
| haze rgb | 78,64,104 | 60,88,84 | 130,84,92 | 96,80,132 | 72,80,96 | 108,72,72 |
| stars | 2800 | 700 | 500 | 1100 | 1800 | 500 |
| weather w1 | clear .60 | rain .45 | partly .50 | fog .45 | storm .40 | fog .40 |
| weather w2 | partly .40 | storm .30 | clear .30 | overcast .35 | rain .35 | overcast .35 |
| weather w3 | — | overcast .25 | fog .20 | partly .20 | overcast .25 | clear .25 |
| fog density | 0.12 | 0.30 | 0.18 | 0.58 | 0.26 | 0.62 |
| fog height px @1080p | 180 | 260 | 220 | 420 | 300 | 400 |
| hero | cumulus-bank | moon-in-stratus | cirrus-fan | stratus-shelf | anvil | haze-disc |

---

## 2. The three cloud systems

Coverage column values are the **alpha-mass targets** and live inside FID bands
(cumulus 22–38, stratus 55–80, cirrus 12–25).

| Field | `noir` | `acid` | `ember` | `violet` | `signal` | `ash` |
|---|---|---|---|---|---|---|
| **cumulus** coverage | 0.30 | 0.22 | 0.36 | 0.26 | 0.28 | 0.24 |
| density | 0.55 | 0.62 | 0.48 | 0.58 | 0.66 | 0.60 |
| softness | 0.09 | 0.06 | 0.11 | 0.08 | 0.07 | 0.10 |
| windPx/s | 3.2 | 7.5 | 2.4 | 1.6 | 9.0 | 1.1 |
| opacity | 0.92 | 0.80 | 0.88 | 0.70 | 0.86 | 0.62 |
| plane | 3 | 3 | 3 | 3 | 3 | 3 |
| **stratus** coverage | 0.55 | 0.78 | 0.60 | 0.72 | 0.66 | 0.80 |
| bands | 2 | 4 | 2 | 3 | 3 | 4 |
| ΔL contrast | 0.16 | 0.12 | 0.14 | 0.10 | 0.13 | 0.11 |
| opacity | 0.40 | 0.72 | 0.45 | 0.66 | 0.58 | 0.74 |
| plane | 2 | 2 | 2 | 2 | 2 | 2 |
| **cirrus** coverage | 0.18 | 0.14 | 0.12 | 0.25 | 0.20 | 0.12 |
| stretch | 4.0 | 4.0 | 5.0 | 4.0 | 4.5 | 4.0 |
| opacity | 0.35 | 0.22 | 0.30 | 0.28 | 0.34 | 0.20 |
| plane | 1 | 1 | 1 | 1 | 1 | 1 |

`low` drops cirrus entirely (`07` §4); `medium`+ draw all three. Wind is applied
as integer-texel offsets, so `windPx` is quantised at draw time to `round(acc)`
(`13` S-2, P2).

---

## 3. Light and moon

| Field | `noir` | `acid` | `ember` | `violet` | `signal` | `ash` |
|---|---|---|---|---|---|---|
| azimuth° | 250 | 190 | 300 | 120 | 340 | 210 |
| elevation° | 14 | 8 | 22 | 10 | 6 | 18 |
| key rgb | 255,176,120 | 182,255,120 | 255,168,96 | 255,178,140 | 210,226,246 | 255,150,90 |
| fill rgb | 60,96,150 | 44,120,110 | 74,70,140 | 96,80,152 | 60,86,132 | 92,70,88 |
| shadowStrength | 0.70 | 0.45 | 0.60 | 0.35 | 0.50 | 0.30 |
| shadowTint rgb | 26,44,74 | 18,52,52 | 30,40,78 | 40,38,86 | 22,46,68 | 44,34,58 |
| moon phase | gibbous | crescent | full | gibbous | crescent | full |
| moon size px | 240 | 216 | 258 | 232 | 210 | 252 |
| moon rings | 3 | 2 | 4 | 3 | 2 | 3 |
| moonCover base | 0.25 | 0.65 | 0.10 | 0.50 | 0.55 | 0.80 |
| moon tint rgb | 236,226,208 | 220,236,208 | 255,226,190 | 236,214,240 | 224,232,244 | 244,206,178 |

Shadow tint is never `#000` and is cyan-shifted relative to the key (REQ-404,
FID-8, FID-18). `azimuth°` is the single value every shadow, rim and spill must
agree with within ±12° (FID-9).

---

## 4. Grade and motion

| Field | `noir` | `acid` | `ember` | `violet` | `signal` | `ash` |
|---|---|---|---|---|---|---|
| exposure | −0.05 | −0.12 | +0.06 | −0.18 | −0.14 | −0.10 |
| contrast | 1.14 | 1.08 | 1.18 | 1.04 | 1.12 | 0.98 |
| saturation | 0.98 | 1.06 | 1.02 | 1.10 | 0.96 | 0.90 |
| temperature | −2 | −6 | +8 | −4 | −8 | +3 |
| shadow hue° | 196 | 188 | 202 | 206 | 192 | 198 |
| highlight hue° | 32 | 88 | 26 | 318 | 40 | 24 |
| reflection strength | 0.35 | 0.50 | 0.30 | 0.22 | 0.45 | 0.18 |
| reflection ripple | 0.22 | 0.40 | 0.15 | 0.10 | 0.50 | 0.08 |

Grade ΔE between neighbouring archetypes is checked in `tests/profile.data.test.ts`
(target ≥6, soft ≥10 — FID-19). `ash` deliberately sits at contrast 0.98 and
saturation 0.90: a low-contrast night is what fog looks like, and it is the
archetype most likely to fail readability (R-23), so its rim boost is the
strongest (§6).

---

## 5. Machine-checkable invariants (these *are* the tests)

1. `cumulus.coverage ∈ [0.22, 0.38]`, `stratus ∈ [0.55, 0.80]`, `cirrus ∈ [0.12, 0.25]`.
2. `stratus` ΔL ≤ 0.18; `cirrus` stretch ≥ 4.0.
3. `moon.sizePx ∈ [210, 260]`; `moon.rings ∈ [2,4]`; `moon.coverBase ∈ [0,1]`.
4. `parallax` is a fixed ladder `[1.0, 1.7, 2.8, 4.6, 7.6]`; max ratio 7.6 ≤ 12.
5. `light.shadowTint` luminance ≥ 0.02 and hue within ±40° of `fill` (never black).
6. `weatherWeights` sums to 1 ± 0.001; every weight ≥ 0.05 or exactly 0.
7. `profileAxisDiff(a, b) ≥ 4` for any consecutive pair (10k seeds).
8. Grade ΔE ≥ 6 between any two archetypes.
9. `hero` is one value (never a list) — FID-5 "exactly one hero".
10. `stars` monotone with `tod` darkness: `predawn ≤ night` (±20 %) — a predawn sky
    is brighter.
11. `fog.density ≥ 0.5` ⇒ `light.shadowStrength ≤ 0.40` (fog cannot have hard
    shadows; `ash` 0.62/0.30 and `violet` 0.58/0.35 satisfy it).
12. `reflection.ripple` > 0.35 only when the weather weights include rain ≥ 0.3
    (`acid` 0.45, `signal` 0.35) — dry air plus heavy ripple reads wrong.

---

## 6. Per-run jitter (applied to the table above, seeded)

| Field | Jitter | Clamp | Why |
|---|---|---|---|
| azimuth° | ±11 | absolute, keeps FID-9 (≤12°) | shadows follow |
| elevation° | ±3 | ≥2° (no flat light) | shadow length |
| moon size | ±6 % | 210–260 px | S1 "stylised" |
| moon coverBase | ±0.12 | 0…0.95 | weather feel |
| cumulus coverage | ±0.04 | inside FID-11 band | distinctness |
| stratus coverage | ±0.05 | inside FID-12 band | distinctness |
| cirrus coverage | ±0.04 | inside FID-13 band | distinctness |
| windPx | ±12 % | ≥0.8 px/s | drift reads as motion |
| density/softness | ±0.06 | 0.3…0.9 | silhouette |
| stars | ±15 % | ≥200 | star field density |
| fog density | ±0.08 | 0…0.9 | haze |
| weatherWeights | ±0.15 then renormalise | each ≥0.05 | weather differs |
| grade temperature | ±2 | −10…10 | colour cast |
| grade contrast | ±0.06 | 0.9…1.3 | punch |

Jitter consumes bits of the same 32-bit `seed` through the existing avalanche
mixer — no new RNG, reproducible from the seed printed in bug reports.

---

## 7. Per-tier presentation of this data (data → cost)

The *data* is identical at every tier (`07` §4); the tier only changes the
sampling and the draw list.

| Tier | ladder | octaves | warp | cumulus lit-side | stars | moon rings | sky blits | cloud blits |
|---|---|---|---|---|---|---|---|---|
| low | 512×288 | 3 | 1 | off | ÷4 | 2 | 1 | 2 |
| medium | 768×432 | 4 | 2 | off | ÷2 | 3 | 1 | 5 |
| high | 1024×576 | 4 | 2 | on | full | 3 | 1 | 5 |
| ultra | 1280×720 | 4 (+micro) | 2 | on | full | 4 | 1 | 6 |

---

## 8. Worked example — what "a different night" means numerically

Two seeds that both land on NEON NOIR (1-in-4 chance, §0) must still differ on
four axes. Using the jitter table:

| Axis | Run A (`noir`) | Run B (`signal`) | Differs |
|---|---|---|---|
| A1 palette | NEON NOIR | NEON NOIR | no (allowed) |
| A2 tod | night | **predawn** | ✓ |
| A3 weather | clear .60 / partly .40 | **storm .40 / rain .35** | ✓ |
| A4 mix | 0.30 / 0.55 / 0.18 | **0.28 / 0.66 / 0.20** | ✓ (>25 % pairwise) |
| A5 light | 250° / 14°, gibbous 240 px | **340° / 6°, crescent 210 px** | ✓ |
| grade ΔE | — | — | ≥10 (contrast 1.12 vs 1.14, temp −8 vs −2, hue 192 vs 196) |

That is the acceptance test for S1 in one table: same palette, four axes moved,
sky/cloud/light/grade all different, and the shadow rake rotated 90° — which the
player reads as a different time of night, not a filter.
