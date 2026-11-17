# 07 — PROFILE MATRIX (Phase 9)
**Serves:** D1 (one stage, profiles only) · REQ-1xx · FID-1…FID-25.
**Purpose:** define *exactly* what varies per run, how much of it varies, what a
tier is allowed to remove, and what a profile costs on a phone.

Everything numeric here is **[T]** (target) unless tagged otherwise. Sources for
the constraints are `03` (psychology), `04` (fidelity), `12` (mobile reality).

---

## LEDGER NOTE — the live tier table
What each tier turns ON is no longer described here in prose: it is
`src/game/render/graphics.ts` `GRAPHICS`, asserted by `tests/shadows.test.ts`, and
explained in `23-LIGHT-AND-SHADOW.md` §2. This document keeps the *profile*
matrix (what a run is); 23 owns the *fidelity* matrix (what a device draws).

## 1. The five axes, and why five

S1 requires "≥5 environment profile axes varying per run". Five is the smallest
number that makes consecutive runs *structurally* different rather than
recoloured, which is the failure mode the user called out ("yo didn't made
anything procedural").

| Axis | Symbol | Domain | Affects | Evidence |
|---|---|---|---|---|
| A1 Palette identity | `paletteId` | 4 moods (`mood.ts`) | sky tint, spills, prop accents, HUD | Schloss & Palmer (**A**): saturated figure on desaturated ground |
| A2 Time of day | `tod` | `dusk · night · predawn` | sky gradient, star density, ambient level, Purkinje shift | Purkinje effect (**A**): scotopic vision shifts perception blue |
| A3 Weather | `weather` + weights | `clear · partly · overcast · rain · storm · fog` | cloud mix, haze, wetness, reflection strength, flash budget | FID-24 flash limits (**B**/WCAG) |
| A4 Cloud mix | `cumulus/stratus/cirrus` coverage | each in FID-11/12/13 band | hero, silhouette, motion character | FID-15 power-law (**C**) |
| A5 Light & moon | `azimuth · elevation · moonPhase · moonSize` | 8 × 3 × 4 × 2 | every shadow, rim, spill, moon size | FID-9 ±12° agreement, FID-19 ΔE≥6 |

Product space: 4 × 3 × 6 × (mix classes) × (8·3·4·2) = thousands of points. Far
more than we need; what matters is the **selection constraint**, §5.

---

## 2. Six archetypes (the memo unit)

Plates are a pure function of the environment. Six archetypes bound the memo
set; per-run jitter (§3) makes each run inside an archetype still differ on ≥4
of 5 axes.

| id | Name | A1 palette | A2 tod | A3 weather (weights) | A4 mix (C/S/Ci %) | A5 light (az°/elev°, moon) | Hero (FID-5) |
|---|---|---|---|---|---|---|---|
| `noir` | Neon Noir | NEON NOIR | night | clear .60, partly .40 | 30 / 55 / 18 | 250° / 14°, gibbous | tall cumulus bank low-left |
| `acid` | Acid Rain | ACID RAIN | night | rain .45, storm .30, overcast .25 | 22 / 78 / 14 | 190° / 8°, crescent | moon eaten by stratus |
| `ember` | Ember City | EMBER CITY | dusk | partly .50, clear .30, fog .20 | 36 / 60 / 12 | 300° / 22°, full | cirrus fan catching the last light |
| `violet` | Ultraviolet | ULTRAVIOLET | predawn | fog .45, overcast .35, partly .20 | 26 / 72 / 25 | 120° / 10°, gibbous | low stratus shelf + horizon glow |
| `signal` | Signal Static | NEON NOIR | predawn | storm .40, rain .35, overcast .25 | 28 / 66 / 20 | 340° / 6°, crescent | lightning-lit cumulus anvil |
| `ash` | Ashfall | EMBER CITY | night | fog .40, overcast .35, clear .25 | 24 / 80 / 12 | 210° / 18°, full | haze-buried moon as a disc |

Two archetypes share each palette on purpose: it proves the run identity comes
from the *environment*, not from a recolour — and it doubles our combinations for
zero art cost.

Coverage check per archetype: cumulus 22–36 ✓ (FID-11), stratus 55–80 ✓
(FID-12), cirrus 12–25 ✓ (FID-13). Pairwise separation in (coverage, edge
density) ≥25 % ✓ (FID-14) — `ash` vs `violet` is the closest pair at 24 vs 26 %
cumulus, so `ash` gets the wider 80 % stratus and a ΔL contrast 0.14 vs 0.18.

---

## 3. Per-run jitter (what makes run N+1 different)

| Axis | Jitter | Constraint | Distinctness contribution |
|---|---|---|---|
| A1 | cannot jitter (discrete) | a run may repeat a palette only if it changes ≥4 other axes | identity |
| A2 | adjacent band allowed (dusk↔night, night↔predawn) | never dusk↔predawn directly (no continuity) | strong |
| A3 | weights re-rolled within archetype ±0.15, normalised | flash ≤3/s, ΔL ≤10 % (REQ-603) | strong |
| A4 | each coverage ±4 pp, renormalised to band | must stay inside FID-11/12/13 | medium |
| A5 | azimuth ±11° (inside FID-9's ±12°), elevation ±3°, phase free, moonSize ±6 % | moon 210–260 px @1080p (FID, S1 "stylised") | **strong** |

Jitter is derived from the run seed through the existing avalanche mixer in
`mood.ts` (`moodIndexForSeed`), not `Math.random()` — a run must be reproducible
from its seed for bug reports and for the test harness **[M]**.

Numeric floor on ΔE: consecutive-run grade **ΔE ≥ 6** (FID-19) with a **soft
target of 10 [T]**, because 6 is the "just perceptible" end of the scale and a
run that merely feels "slightly different" fails S1's intent, not just its letter.

---

## 4. What a tier may and may not remove

The tier ladder is **resolution first** (`12` §3). Art identity is not a tier
feature.

| Element | low | medium | high | ultra |
|---|---|---|---|---|
| Palette / tod / weather weights | identical | identical | identical | identical |
| Hero element (FID-5) | **identical** | identical | identical | identical |
| Light azimuth / elevation | **identical** | identical | identical | identical |
| Cloud coverage bands | **identical** | identical | identical | identical |
| Cumulus | 1 plate, 512×288 | 1 plate, 768×432 | 1024×576 | 1280×720 |
| Stratus | baked into sky plate | 1 plate | 1 plate | 1 plate |
| Cirrus | **dropped** | 1 plate, low alpha | 1 plate | 1 plate + 2nd deck |
| Fog sheet | 0 (haze in plate) | 1 sheet | 1 sheet | 1 sheet + haze sheet |
| Moon | 1 plate, no corona rings | plate + corona | plate + corona + rays | plate + corona + rays + deck glitter |
| Shadow filtering | 1 hard rake | 1 rake | 2-sample penumbra | 2-sample + contact darkening |
| Reflection | static smear | smear + ripple | ripple + glitter | ripple + glitter + boost |
| Grade | LUT applied at bake | ← | ← | + split-tone LUT |

Rule: **anything in the top four rows is a bug if it differs across tiers.**
`low` must be *identifiable* as `acid` vs `ember` at a glance (REQ-605).

---

## 5. Selection algorithm (seeded, constraint-satisfying)

```
select(seed, history):              // history = last 2 archetype ids
  r = mixer(seed)
  candidates = ARCHETYPES.filter(a => !history.includes(a.id))
  if candidates.length < 4: candidates = ARCHETYPES   // tiny pools still work
  base = candidates[r % candidates.length]

  env = jitter(base, r)              // §3, deterministic from r's bit field
  if env.tod === 'dusk' && base.tod === 'predawn': env.tod = 'night'  // guard

  // distinctness audit (also a unit test, 10k seeds)
  assert axesDiffering(env, history[0]) >= 4
  assert deltaE(env.grade, history[0].grade) >= 6
  return env
```

`axesDiffering` counts A1…A5. A1 only counts when the palette changed, so a run
that keeps the palette must move A2, A3, A4 and A5 — which is exactly what
`signal` vs `noir` does (tod, weather, mix, light all move).

**Test:** 10,000 seeds → histogram of `axesDiffering` must show **0 runs below
4**, archetype frequency within ±8 % of uniform, and ΔE distribution mean ≥10.
This is a pure-function test, no canvas required (`tests/profile.pick.test.ts`).

---

## 6. Plate signatures and residency

```
signature = hash(archetypeId, cloudType, ladderStep, gradeId)
```

* 6 archetypes × 3 cloud types = **18 signatures** max, but only the current
  archetype's 3 plates (plus the previous run's while a transition cross-fades)
  are resident → **≤6 plates**, LRU, zeroed on eviction (`12` §4).
* A run start may therefore cost a cold bake: 3 plates × ~7 ms ≈ 21 ms **[E]**
  from the measured 20.4–25.7 ms cold bake of the existing 37-plate set **[M]**.
  That must land inside the existing run-start transition, not on a gameplay
  frame. If it does not fit, `low` reuses the previous archetype's plates with a
  LUT-based tint (acceptable: FID-19 only requires ΔE ≥6, which a grade can
  deliver at 6–18 ΔE by its own target band).
* Within a run, plates are **not** re-baked for jitter: coverage jitter ±4 pp is
  applied at *bake* of the archetype's plate set, so a run's exact coverage is in
  its own plates — this keeps the 18-signature bound by making jitter part of
  the signature only within an archetype… **open item**: either accept 6 extra
  signatures per run (memory) or express ±4 pp coverage as an alpha/scale
  cross-fade between two pre-baked coverage variants (cheaper, 2 variants per
  type). **Chosen: two coverage variants** (`tight`, `loose`) per cloud type,
  cross-faded by `globalAlpha` — 6 plates per archetype worst case, matching the
  residency cap exactly.

---

## 7. Cost per archetype per tier (plates, bytes, blits)

Plate bytes = `w × h × 4`. Ladder steps from `12` §4.

| Tier | Cumulus | Stratus | Cirrus | Plates resident | Plate bytes | Cloud blits/frame |
|---|---|---|---|---|---|---|
| low | 512×288 ×2 variants | in sky plate | — | 2 | 1.18 MB | 2 |
| medium | 768×432 ×2 | 768×432 | 768×432 ×2 | 5 | 6.75 MB | 5 |
| high | 1024×576 ×2 | 1024×576 | 1024×576 ×2 | 5 | 12.0 MB | 5 |
| ultra | 1280×720 ×2 | 1280×720 | 1280×720 ×2 | 6 | 22.1 MB | 6 |

Blit budget check against REQ-701 / FID-26 (≤14 low, ≤20 high): `low` uses 2
cloud blits + 11 existing = **13** ✓; `high` 5 + 11 = **16** ✓ (≤20); `ultra`
6 + 11 + fog/haze 2 + 2nd cirrus = **21** ✓ (≤26) — all **[E]** from the measured
11 [M] plus planned additions.

---

## 8. Weather state machine (per run, smooth, cheap)

```
states: clear → partly → overcast → rain → storm → fog → overcast → partly → clear
transition: ≥8 s (REQ-105), driven by profile weights, one state change
            per ≥20 s of run time, never during a flash cooldown
rendering cost per transition: 2 plate cross-fades (globalAlpha), 0 re-bakes,
            grade LUT swap by tint blit only
```

Weather never changes the light *direction* (A5 is fixed per run) — that keeps
FID-9 (±12° agreement) trivially satisfied and preserves the physics illusion
across a storm.

---

## 9. Per-tier profile-agnostic invariants

These must hold for every archetype at every tier (testable in the bake harness):

1. Moon size 210–260 px at 1080p reference (S1: stylised, "more").
2. Sky occupies 50–62 % of frame height at the default camera (FID-1).
3. ≥4 depth planes with ≥8 % contrast attenuation each (FID-2, FID-17).
4. Near:far parallax ≤12:1 (FID-22) — one ladder, whatever the mix.
5. 60/30/10 histogram ±8 % (FID-20).
6. Figure rim ≥3:1 against its local background in **every** weather state
   (FID-6, REQ-601) — this is the one numeric that can force a profile to be
   rejected outright.
7. Play band ≤25 % alpha decoration in y 0..150 (FID-4, REQ-602).

---

## 10. Rejected profile ideas (and why)

| Idea | Why rejected |
|---|---|
| Daytime / noon | Purkinje and night identity are the whole art direction; a noon sky would need a second lighting model for shadows — Rule 10 risk for no gain |
| Snow | Costs a new particle system and a ground material; gameplay readability drops (white on white figures) |
| Volcano / fire rain | Reads as a different game; flash budget (REQ-603) would be violated by design |
| Per-run *new* palette generation (HSL rotation) | Palette discipline (60/30/10) is curated in `mood.ts` for a reason; generated palettes broke hue-contrast in V3 (`00`) |
| 12+ archetypes | Memo cost, art review cost, and no player-perceptible gain over 6 |

## 11. Open items

1. `low` with cirrus dropped (4th row of §4) may fail FID-14's "systems
   distinguishable" at low — the requirement was written before the tier ladder.
   Proposed: FID-14 applies at `medium`+, and `low` is judged on
   cumulus-vs-stratus only. **Needs a requirement edit, recorded in `01`.**
2. `ash` at 80 % stratus + fog is the most likely readability failure (FID-6).
   It ships only if the contrast probe passes at `low`.
3. Jitter on A5 azimuth ±11° interacts with the baked shadow rakes: shadows are
   baked per archetype, so a ±11° jitter means either 3 baked rakes per archetype
   (memory) or rotating the rake by shearing at draw time (1 transform, cheap).
   **Chosen: shear at draw time, ≤2 % quality loss, 0 extra canvas.**
