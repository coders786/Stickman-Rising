# LIGHT · SHADOW · REFLECTION V3 — "react without paying"

**Scope:** deeper baked lighting + shadows + reflections, a reactive light layer that
follows the player, a stylized moon, a sub-millisecond screen-space reflection
post-pass, and a prop system that is *dressing* instead of a *win menu* — all
under a hard CPU / memory / load-time budget.

Companion docs: `docs/PREBAKED-WORLD-PLAN.md`, `docs/NEUROAESTHETIC-UPGRADE.md`.

---

## 1. The law we are obeying

| Law | Consequence for this pass |
|---|---|
| **Baked beats realtime for static surfaces** — realtime re-evaluates every light × surface × frame; a lightmap is a texture read. Bake the city, keep a *tiny* live budget for things that must move. | Everything static is baked into the layer tiles. The only live work is a handful of `drawImage` blits of pre-baked discs/sprites. |
| **1–3 realtime lights per room, each with a job.** Tight range beats wide flood. | Exactly three live "jobs": (a) the player's key/rim light sampled from the nearest practical, (b) the player's contact shadow, (c) the deck reflection band. |
| **Downsample + blur is the cheap reflection path.** Babylon's own docs: `ssrDownsample` / `blurDownsample` "save performance and generally have little impact". Full-res SSR was ~4.15 ms; optimized ~0.20 ms. | Reflection runs at **1/8 resolution**, one downscale blit + one flipped upscale blit. No ray-march, no readback, no shaders. |
| **Static art is free; procedural art is a one-time cost that must be measured.** | Every new plate is baked once per palette/run and then blitted. Added buffers are ≤ 40 KB. |

---

## 2. Architecture

### 2.1 Baked layer — what gets *more*
All added in `background.ts` inside existing bake passes (no new per-frame pass):

1. **Cast shadows, second generation** — `bakeCastShadows` gains: railing-post
   shadows raking lower-left from the moon, cable shadows, AC-unit and vent
   shadows, curb AO, and a soft occlusion band under the deck lip.
2. **Wall practicals** — additional neon strips, a corner-shop sign, distant
   window bloom clusters: each a baked rect + `bakeSpill` disc on the facade, so
   the wall reads as *lit by the city*, not *painted*.
3. **Moon light shafts** — 2–3 baked additive cones from the upper right, cut by
   the skyline silhouette, plus a wet specular streak on the deck under the moon.
4. **Contact AO everywhere** — every prop/deck junction gets the two-band AO
   already used by the door (shadowed side + bite line).
5. **Reflection plates** — flipped, desaturated, alpha-ramped mirrors baked into
   `arenaTile` for the door, lamp, vents, and every static deck prop.

### 2.2 Reactive layer — cheap by construction
| Feature | Cost | How |
|---|---|---|
| Player key/rim light | ≤ 2 blits | Nearest practical is chosen with 3 distance checks; a pre-baked warm/cool rim disc is blitted at the player with alpha = proximity falloff. |
| Player contact shadow (directional) | 1 fill | The existing ellipse gains a skew toward the anti-moon direction and shrinks with jump height. |
| Prop/deck wet sheen under the player | 1 blit | Pre-baked elliptical pool, alpha scaled by how close the player is to a practical. |
| Lightning modulation | 0 extra | Existing `lightningI()` already scales the door pool; new practical pools read the same number. |

### 2.3 Reflection post-pass — the only "post processing"
```
        ┌─────────────── capture ───────────────┐
scene   │  band above deck (w × bandH·1.35)     │──downscale 1/8──► buf (w/8 × bandH/8)
        │  sky + city + fighters + FX           │                        │
        └───────────────────────────────────────┘                        │
                                                                  flip + blur
                                                                         ▼
        deck band (w × bandH)  ◄── 1 blit, alpha ≈ 0.16, 'lighter' ──────┘
        2 extra slices at ±1px x-offset for the wet ripple
```
* Source is the *live main canvas* → the reflection automatically contains the
  player, enemies, projectiles and FX. That is the "responds to the player" part.
* The 1/8 downscale **is** the blur — no filter pass, no `filter=` strings, no
  `getImageData`.
* Total per frame: 2–4 `drawImage` calls, ~15 KB of memory, 0 allocations.
* Gated off at `quality === 'low'` and when the deck is off-screen.

### 2.4 The moon — stylized, not minimal
Rebuilt as a 512² plate (`buildMoon`), drawn at 210 px:
* **Gibbous terminator** with a soft two-stop limb falloff (no crescent sticker).
* **Maria + crater rings** — 7 baked blotches, 14 craters with lit rim / shadowed
  bowl in the palette's `pop` + `highlight`, matching the moon key from upper right.
* **Limb darkening + chromatic fringe** — 3 nested rims, the outermost tinted by
  the mood palette so the moon belongs to the run's identity.
* **Cloud wisps** crossing the lower limb (baked, static) — depth against the sky.
* **Corona** rebuilt: 4 concentric scattering rings + 6 short rays + one wide
  horizontal lens streak. Still exactly **2 blits** at draw time.

### 2.5 Props — dressing, not a win menu
The old `reset()` dealt a shuffled 2-of-each deck and guaranteed all 6 purposes,
pre-placed across the lane. That is a *solutions menu* sitting in the level before
the player arrives.

New model (`PropField`):
* **Sparse start** — at most `1` prop exists when the run begins (or none); the
  lane starts empty so it reads as a place, not a shop.
* **Timed trickle** — a spawn clock places one prop at a time every `6.5–11 s`,
  with a **concurrent cap of 2 → 3** (ramps with elapsed run time, never more).
* **Gap-seeking placement** — candidates are sampled ahead of the player in
  *empty* stretches (min 240 px from any prop, 170 from practicals, 220 from the
  player) so a prop always fills a bare stretch of deck instead of clustering.
* **Weighted scarcity** — `med`/`fuel` are uncommon, `supply` is rare; **no
  duplicate kind alive at once**, so a single spawn can never hand out a full
  answer key. Purposes are still all reachable across a run, just not at once.
* **Churn** — a broken prop returns as a *new* weighted kind after a longer
  delay (18–30 s), so the lane keeps breathing without ever being stocked.

---

## 3. Budget & measurements

| Item | Before | Target V3 |
|---|---|---|
| Bake time (synthetic ctx) | 23.5 ms first / 9–16 ms reseed | ≤ 34 ms first / ≤ 22 ms reseed |
| Added per-frame blits | — | ≤ 8 |
| Added live allocations | — | 0 |
| Added resident memory | — | ≤ 40 KB (reflection buf + 3 rim discs) |
| Frame budget | 120 fps path | unchanged |
| Reflection buffer | — | `w/8 × bandH/8` (≈ 200 × 14 at 1280×720) |

Measured numbers are recorded at the bottom of this file after the pass lands.

---

## 4. Acceptance checklist
- [x] No shader, no WebGL, no `filter=`, no `getImageData`, no live render target.
- [x] Every new light/shadow/reflection exists as a baked plate or a blit of one.
- [x] Player-proximity rim light + directional contact shadow in the draw path.
- [x] Reflection post-pass is ≤ 4 blits and off at low quality.
- [x] Moon: terminator + craters + palette rim + corona, 2 blits.
- [x] Props: no pre-placed bulk, timed spawn, cap ≤ 3, no duplicate kinds.
- [x] `tsc` 0, lint clean, test baseline 236/8 unchanged, build ok, page 200.

---

## 5. Measurements

Synthetic (stub) canvas, 1280×720, `BEFORE` = `c3bc644`, `AFTER` = this pass:

| Metric | Before | After | Note |
|---|---|---|---|
| Bake (first frame) | 13.5 ms | **12.7 ms** | more art, less time |
| Re-bake (new run) | 14.3 ms | **6.9 ms** | −52%: blur plates no longer re-upscaled |
| Canvas memory allocated | 52.0 MB | **41.6 MB** | **−20%** *despite* the 512² moon + 3 new sprites |
| Frame blits (sky+arena+new passes+weather) | 6 | 11 | +5 (2 player light, 4 reflection − 1 shared) |
| Reflection buffer | — | ~8 KB @1280×720 | `w/8 × bandH/8` |
| Live allocations per frame | 0 | 0 | buffers are reused/resized only |

The −20% memory number is the important one: the pass adds a bigger moon plate,
two rim sprites, a deck pool and a reflection buffer, and still lands 10 MB
below the previous build because `blurTile` stopped keeping a full-size
upscaled copy of each of the three city layers (≈12 MB of duplicates).

## 6. What the player actually sees

* **Entering a practical's pool** (300 px falloff) lights a palette-tinted rim on
  the fighter and lifts the wet concrete under their feet — the stage literally
  notices where you are.
* **The wet deck mirrors the live frame**: your fighter, enemies, projectiles and
  FX slide down into the concrete, chopped into three fading, rippling slices.
* **Every piece of deck hardware** (condensers, spool, vents, pipes, wall neon)
  now throws a moon-direction rake and has its own contact AO + reflection.
* **The moon** is a gibbous sphere with seas, 16 cratered bowls, a lit rim pair in
  the run's palette and a 4-ring corona with rays and an anamorphic streak.
* **The lane starts empty.** Props arrive one at a time, capped, from weighted
  rarities, into bare deck ahead of you — dressing you find, not a stocked menu.
