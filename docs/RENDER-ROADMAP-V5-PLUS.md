# RENDER ROADMAP — V5 AND BEYOND
### Planning only. Nothing here is built.

V4 (`docs/LIGHT-SHADOW-V4-PLAN.md`) is the *next* pass and is deliberately
bounded: five practicals, moon phases, puddle-masked reflections, tier parity,
all inside a 34 MB / 24-blit / 16 ms budget.

This document is the layer above it: **where the look goes after the budget is
clean.** It exists so that V4 decisions (data tables, quality ladder, harness)
are made in the shape the later work needs.

---

## 1. The three horizons

| Horizon | Theme | Signature feature | Hard constraint |
|---|---|---|---|
| **V4** | Depth | Five practicals + puddle reflections + moon phases | 24 blits, 34 MB |
| **V5** | Atmosphere | Baked volumetric fog with real depth ordering | no new full-screen pass |
| **V6** | Time & weather | The rooftops change through a 6-minute night | bake budget, not frame budget |

---

## 2. V5 — atmosphere without volumetrics

The word "volumetric" is banned; the *sensation* is not. Three ways to get it
from plates:

### 2.1 Depth-sliced fog sheets (primary)
Instead of one fog plane at parallax 0.098, use **three** thin plates at
0.06 / 0.098 / 0.16 with different tints and vertical anchors. Each plate is
2048×170 with procedural puffs, and each is *clipped to the silhouette band* of
the layer behind it (bake-time work, not runtime). Cost at runtime: 3 tiled rows
instead of 1 — roughly +6 blits, which is why this waits for V5, after V4 has
proven the budget with room.

Payoff: lights *inside* the city gain a halo because fog sits in front of them,
while foreground practicals stay crisp. That depth cue is what makes 2.5D read as
3D more than any shader.

### 2.2 Light-shaft cards, not god rays
The V3 moon shafts are baked flat in the arena tile. V5 promotes them to **three
cards** (baked 256×512 soft cones) that are drawn with alpha keyed to
`moonCover` and storm intensity, at parallax 0.04. Because they are cards, they
can slide *behind* the near-facade and *in front of* the far city — true ordering,
zero per-pixel work. Cost: ≤3 blits.

### 2.3 Airborne dust in the practical beams
Every practical gets ≤24 pre-baked "motes" in its spill (a small plate per
practical, drawn only when the camera is within 900 px). Not particles: a still
plate with 24 lit dots, drifting by an integer offset per second. Cost: ≤3 blits.
Risk: reads as a texture if the drift is not smooth → drift in sub-pixel steps.

### 2.4 V5 budget sketch
+12 blits, +3 MB (three fog plates + three shafts + motes). That is why V4 has to
land memory at ≤34 MB first: V5's headroom is pre-allocated.

---

## 3. V6 — the rooftops have a night

Right now the palette is chosen per run and frozen. V6 makes **time a run
property** on top of palette:

- **Four baked "hours" per palette** (16 plates total, but only one hour resident
  plus the next one prebaked in idle): `dusk → deep night → blue hour → pre-dawn`.
- Transitions every ~90 s of play, cross-faded by **one full-screen alpha on the
  sky vault** (1 blit), not by rebuilding art mid-fight.
- The practicals do not change; the **ambient** does. That single fact is what
  makes time-of-night feel authored rather than filtered.
- Weather couples in: rain intensity bias goes up at dusk, storm frequency peaks
  in deep night.

Cost: bake ×4 per palette (only for the *sky/star/deep/far* plates, not the
arena) amortised across idle time; memory held to +1 hour set (~6 MB) via a
two-slot ring.

---

## 4. Cross-cutting work that must not be forgotten

### 4.1 Perceptual QA without screenshots
We have no browser captures. Compensation plan:
1. **Geometric assertions** (V4 L5/L6/L8): band alignment, arena clipping, mask
   coverage — checkable in a stub.
2. **Alpha-sum budgets**: aggregate additive energy per frame must stay in a
   window (e.g. 0.35–0.75 of screen area × mean alpha). Detects "washed out"
   before a human sees it.
3. **Contrast probes**: sample the baked plated colours at fixed coordinates and
   assert the 60/30/10 ratio holds within ±8 %.
4. **Silhouette probes**: for a figure at a known x, assert the local luminance
   behind it is ≥ N below the figure's rim, so readability cannot regress.
These four are the closest thing to an eye we have, and they are cheap.

### 4.2 Accessibility (non-negotiable once lighting grows)
- **Photosensitivity**: cap additive alpha spikes to ≤3 flashes/s and ≤0.22 ΔL;
  the governor should treat a lightning burst as a budgeted event, not free.
- **Reduced motion**: a setting that disables ripples, glitter cycles and traumas.
- **Contrast mode**: strengthens practical pools and dims the falling city so the
  play band never competes with scenery.

### 4.3 Low-end reality
The tier ladder (V4 L7) is the mechanism; the roadmap needs targets:
- Tier `low` on a 5-year-old phone at DPR 1: ≤ 8 blits, no reflections, static moon.
- Tier `medium` on integrated laptop: ≤ 12 blits, 2-slice reflection.
Measured by the committed harness with a forced-tier flag (`?tier=low`).

---

## 5. Decision log (so future passes do not relitigate)

| Decision | Rationale | Reversal cost |
|---|---|---|
| Bake everything static | engines were deleted for cost and instability; baked plates are the architecture | high — it is the architecture |
| One reflection post-pass only | second passes stack cost and mud | medium |
| Practicals as a data table | F1: literals already broke clearance once | low |
| Moon phase per run | novelty without new frames | low |
| No screenshots in CI | not available | n/a |
| Quality tiers must change output | governor promise was unfulfilled (F4) | low |
| Props are dressing, capped, sparse | user directive: not a solutions menu | low |

---

## 6. Backlog (idea parking lot, unscheduled)

- Wet footprints trailing the player for 1.2 s (baked 3-frame strip, 1 blit).
- Enemy-held light sources (a lantern carrier) that move the rim light source.
- Broken window panes in the fall wall that catch the moon at one angle.
- Deck reflections of the **HUD legend** (deliberately never — HUD is screen space).
- A "photo mode" that raises reflection slices one tier for a still frame.
- Rain pooling on the lip as a moving meniscus (bake 4 frames, cycle).
