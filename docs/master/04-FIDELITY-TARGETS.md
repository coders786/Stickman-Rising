# 04 — FIDELITY TARGETS: what "WoW / full fidelity" means, measurably
**Serves:** D1 ("full fidelity graphics that make me WoW").
**Why this file exists:** "full fidelity" is otherwise unfalsifiable, and this
environment cannot take screenshots (discovery C8). Every target below is either a
number the harness can print or a geometric assertion on baked/shader data.

Grading: **[M]** measured today · **[E]** estimated · **[T]** target for this project.

---

## 1. Frame composition

| ID | Target | Value | Probe |
|---|---|---|---|
| FID-1 | Sky fraction at default camera | **50–62 %** of frame height | horizon line from camera + plate geometry |
| FID-2 | Depth planes with visible haze attenuation | **≥4** (deep/far/mid/near + fog sheet) | draw ledger layer count |
| FID-3 | Scale reference present (distant beacon / tiny traffic) | **≥1** in sky region | authoring assert per profile |
| FID-4 | Play-band decoration limit | **0** static decals above 25 % alpha in y 0..150 | bake assert |
| FID-5 | Hero elements per screen | **exactly 1** (cloud bank or practical or moon) | profile schema `hero:` field |

## 2. Light, shadow, contrast

| ID | Target | Value | Probe |
|---|---|---|---|
| FID-6 | Figure/background separation | rim **≥3:1**, core **≥2:1** | contrast probe |
| FID-7 | Dynamic range in frame | hero highlight : deep shadow **≥12:1** | plate luminance percentiles |
| FID-8 | Shadow colour | cool (cyan-shifted), never `#000` | palette assert |
| FID-9 | Light-direction agreement | sky key, shadows and rims within **±12°** | azimuth math on bake + profile |
| FID-10 | Contact grounding | every figure/prop has a shadow within 2 px of its base | geometry assert |

## 3. Clouds (the mandate's headline feature)

| ID | Target | Value | Probe |
|---|---|---|---|
| FID-11 | Cumulus coverage / edge softness | 22–38 %, edge gradient ≥ 6 px at 1080p | alpha mass + gradient width |
| FID-12 | Stratus coverage / contrast | 55–80 %, low contrast (≤0.18 ΔL) | alpha mass + ΔL |
| FID-13 | Cirrus coverage / elongation | 12–25 %, **≥4:1** elongation | alpha mass + second-moment ratio |
| FID-14 | Systems distinguishable at `low` | pairwise difference **≥25 %** in (coverage, edge density) | probe pair |
| FID-15 | Cloud size distribution | power-law exponent **1.5–2.5** (a few huge, many small) | blob-size histogram |
| FID-16 | Silhouette legibility | hero bank has ≥3 concave arcs (reads as a form, not fog) | contour probe |

## 4. Atmosphere, depth, grade

| ID | Target | Value | Probe |
|---|---|---|---|
| FID-17 | Haze attenuation between planes | each far plane ≥8 % lower contrast | plate stats |
| FID-18 | Split-tone | shadows ≥+12° toward cyan, highlights ≥+10° toward amber | HSL assert |
| FID-19 | Profile distinctness | consecutive-run grade **ΔE ≥6** | LUT delta |
| FID-20 | Palette discipline | 60/30/10 **±8 %** | histogram probe |
| FID-21 | Night authenticity | distant lights ≥25° bluer than near practicals (Purkinje) | palette assert |

## 5. Motion & comfort

| ID | Target | Value | Probe |
|---|---|---|---|
| FID-22 | Near:far parallax differential | **≤12:1** | ladder assert |
| FID-23 | Play-band motion | ≤0.15 px/frame mean | motion ledger |
| FID-24 | Flash budget | ≤3/s, full-screen ΔL ≤10 % | FlashLedger |
| FID-25 | Cloud drift shimmer | 0 visible texel crawl at 0.5× scale | prototype P2 judgement + user eye |

## 6. Performance (provisional until device testing)

| ID | Target | `low` | `medium` | `high` | `ultra` |
|---|---|---|---|---|---|
| FID-26 | Game-canvas blits | ≤14 | ≤18 | ≤20 | ≤26 |
| FID-27 | GPU atmosphere passes | 0 (baked) | 1 | 1 | 2 |
| FID-28 | GPU ms (est.) | 0 | ≤1.5 | ≤3.0 | ≤4.5 |
| FID-29 | Resident canvas memory | ≤38 MB at 720p | ← | ← | ← |
| FID-30 | Warm re-bake | ≤16 ms | ← | ← | ← |
| FID-31 | First-frame shader compile | **0 ms hitch** (prewarmed) | ← | ← | ← |

## 6b. Motion & cadence (`18-MOTION-SMOOTHNESS.md`)

| ID | Target | Applies to |
|---|---|---|
| FID-32 | `M-EVEN` ≥ **95 %** of frame intervals within ±2 ms of target; `M-JUDDER` (p99−p50) ≤ **8.3 ms** | every tier |
| FID-33 | No layer may sit still for >6 frames while the world moves (kills 1-px stepping from integer drift at low speeds) | clouds, parallax |
| FID-34 | Cadence is never in the 45–55 fps band — either at/above target or a clean rung below (60 → 30) | governor |
| FID-35 | Opt-in 120 mode holds p95 ≤8.3 ms for 60 s, else auto-drops to 60 | C2/C3 only |
| FID-36 | Half-frame smear: ≤**1** extra blit, full-screen ΔL ≤10 %, never on the stickman silhouette, off under reduced motion | `medium`+ |

## 6c. Animation cadence (`19-ANIMATION-CADENCE.md`)

| ID | Target | Notes |
|---|---|---|
| FID-37 | `M-DUP` = **0** duplicated render states while anything moves — unless the clip authored `stepRate > 0` (deliberate "on twos") | pose sampled at render time |
| FID-38 | Input→visible ≤ **16.7 ms** beyond the raw input sample | latency ledger |
| FID-39 | `M-JERK`: no joint exceeds **2×** the clip's median \|Δ³θ\| | placeholder until measured |
| FID-40 | Foot slide ≤ **2 px** at any speed | pose clock and root share `alpha` |
| FID-41 | Rig ≤ **1.2 ms** at 120 on C1; ≤**4** stroke calls per figure | `M-RIG` |

## 7. How a "WoW" gate is actually passed

A milestone fails if any of FID-1…FID-25 is violated **in data**, even if the
screenshot would look nice. The reverse is also true: passing every number does not
prove it looks premium — the user's eye is the final gate (D5), and the harness
exists so that the *machine-checkable* half can never silently regress.

**Current status** (honest): FID-1…FID-25 are **targets**, not measurements.
Today we have measured only FID-26/29/30 equivalents: 8–11 blits, 30.3 MB resident,
9.6 ms warm bake. Everything else requires the M1 harness.
