# Pre-Baked World Upgrade — design & implementation plan

Scope: the rooftop stage only. Hard constraints: **120 fps at any cost**,
**flat Canvas2D** (no WebGL / shaders / post passes), and **all new art must be
baked once** — the 60/120 Hz frame path may only blit pre-rendered canvases.
"0 strain on CPU/GPU" therefore means *one-time bake cost*, not a live engine.

## Research the plan is grounded in

| Source | Law applied |
| --- | --- |
| `reddit.com/r/gamedev/comments/danis8` · `gamedev.net/topics/589293` (2D lighting) | Bake a static **lightmap / emissive map into the texture**; a pre-calculated lightmap costs nothing at runtime. |
| `cyanilux.com/tutorials/2d-water-shader-breakdown` · `gamemunchers.com/blog/2021/03/19/2d-reflections-godot` | The canonical cheap 2D reflection is a **vertically flipped sprite** + fade/tint, drawn under the object and over the ground. |
| Northeastern PCG thesis `repository.library.northeastern.edu/files/neu:m0455c71t` · `reddit.com/r/gamemaker/comments/rvqu96` | **Modular templates + randomized placement scoring** (min-gap, distance from anchors, spread). |
| `reddit.com/r/gamedesign/comments/73h4uf` · `aaagameartstudio.com/blog/3d-prop-design` | Barrels/crates are instantly readable environmental interactivity; **props must be designed with a gameplay purpose**. |

---

## 1. Advanced pre-baked lighting / realistic buildings

Everything lives in `src/game/world/background.ts` and executes inside
`buildDeep/buildFar/buildMid/buildNear/buildArena` — never in `draw*()`.

* **`buildGlowDisc` + `bakeSpill`** — one radial light disc per color, blitted
  additively at each emissive source. Every lit window now illuminates the wall
  around it; every neon sign throws a colour-matched wall wash; every emissive
  crown and billboard lights its own facade. This is the lightmap law: light is
  *in the texture*, not a per-frame radial gradient.
* **`bake3DKey`** — a single directional moon from the upper right: diagonal
  surface falloff, lit right face, occluded left face, and a ledge contact AO
  gradient. Applied to every generated building.
* **`bakeCastShadows`** — skewed shadow volumes projected to the lower-left
  from every tower, composited `source-atop` so they only darken existing
  geometry (sky gaps stay clean) and a tall tower darkens its neighbour.
* **`bakePropShadow`** — contact ellipse under every roof prop (shipped
  previously, kept).
* **Prop rim light** — the restored streetlight and the stairwell head-house
  carry baked left-face occlusion, right-face moon rim, warm/cool emissive
  spill and a base contact AO inside their own sprites.
* Existing global key washes on all four bands remain, so the new local
  lighting and the global key agree on one light direction.

## 2. Cheaper foreground reflections

* `bakeFlipReflection` duplicates a sprite, flips it vertically, squashes it
  into the wet deck, bakes a `destination-in` vertical alpha fade, and
  composites it additively **into the arena tile**. Zero live reflection work.
* Applied to the stairwell head-house and the broken streetlight (plus baked
  micro-ripples and specular hairlines that chop both mirrors like wet
  concrete).
* `src/game/world/props.ts` uses the same trick: every prop sprite is ONE
  canvas containing the body (above y=0) and its faded flipped mirror (below
  y=0). Two `drawImage` calls per visible prop, no render target, no readback,
  no shader. Previously the "reflection" was only a colour smear gradient.

## 3. Visibly procedural generation (the "yo didn't made anything procedural" fix)

* **Per-run reseeding**: `CyberBackground.setRunSeed(seed)` invalidates all
  baked tiles and the sky vault; `Game.startRun()` draws ONE seed and feeds it
  to both the skyline and the prop lane. Every run has a different skyline
  instead of a fixed art plate.
* **Five archetypes** (`slab`, `setback`, `glass`, `warehouse`, `spire`) chosen
  per building from the seeded RNG — genuinely different silhouettes: receding
  tiers, curtain-wall glazing, sawtooth roofs, tapered crowns with beacons,
  horizontal floor-band slabs.
* **Four window personalities** (`grid`, `shaft`, `checker`, `clusters`) chosen
  per building, each with baked emissive spill. Two runs with the same seed
  are identical; two runs with different seeds are not.
* **Procedural bridges**: truss skybridges on the mid band (gap-scored) and
  enclosed glass skybridges on the near band, both with baked junction AO.
* **Sixth parallax plane**: `buildAuroraTile` at f = 0.045 with a slow alpha
  pulse, inside the coherence-gated sky vault, so it is one blit per vault
  rebuild (≈24 Hz) rather than per frame. Ladder is now
  stars .015 → deep .032 → aurora .045 → far .065 → fog .098 → mid .14 → near .30.
* Dynamic sky retained/extended: orbital moon drift, deterministic shooting
  stars, ~90 s indigo↔violet tint pulse, three drifting cloud decks.

## 4. Destructible props with purposes (not just particles)

`src/game/world/props.ts` — `PropField`.

* **Sprites from code only**: one compact procedural draw routine per template,
  driven by a single `PROP_DEFS` table (body colour, accent, emissive RGB, HP,
  label, hint). No pixel art, no image assets, no verbose authoring. Baked
  purpose plate (`BLAST` / `HEAL` / `LAUNCH` / `STUN` / `EXPOSE` / `SCORE`)
  plus a HUD legend plate drawn once per frame.
* **Seeded placement scoring**: shuffled 2-of-each deck (11 slots, every
  purpose guaranteed), min-gap 195 px, keep clear of the stairwell (x 1755)
  and streetlight (x 830). Respawns after 15–23 s and can return as a
  *different* purpose → the side-scrolling lane keeps changing.
* **Contact**: `WorldRef.strikeProps` offers the *exact same blade sweep* used
  for enemy hit detection to the props (`player.ts` hit window), plus heavy
  AoE shockwaves and dash-through contact in `PropField.update`. 2 HP: one
  heavy hit or two light hits.
* **Purposes** (all routed through real game systems, not decorative FX):

| Prop | Useful effect |
| --- | --- |
| fuel drum | real AoE explosion → `worldRef.hitEnemy` on every enemy within 240 px (guard break, kill credit, score, combo) |
| med crate | +30 HP |
| steam valve | geyser launch (`vy = -790`) for mobility / juggle routing + light damage to nearby enemies |
| shock box | chain-lightning **stun** on every enemy within 320 px |
| smoke canister | stun + `vulnerableT` mark → **double damage** for 4.5 s ("EXPOSED") |
| supply crate | +1400 score × combo multiplier **and** a live combo hit |

* Headless-safe: `update`/`strike` no-op when `document` is undefined, so the
  physics-only test worlds never have HP or velocity injected mid-assertion.

## 5. Cost accounting

| Pass | Per-frame cost |
| --- | --- |
| all lighting (lightmap, 3D key, cast shadows, neon spill, crowns) | **0** — inside one-time tile bakes |
| flipped-sprite reflections (door, lamp, props) | 2 blits / visible prop, 0 extra for stage props (baked into arena tile) |
| aurora / dynamic sky | inside the 24 Hz `SkyVaultCache`; steady frames = one 1:1 plate blit |
| props update | 11 plain-number iterations, no allocations |
| props draw | frustum-culled, 2 `drawImage` per visible prop |
| HUD legend | 1 `drawImage` |

## 6. Verification

`tsc --noEmit` 0 · `eslint .` clean · `npm test` 244 / 236 pass / 8 pre-existing
failures (unchanged baseline) · `npm run build` ✓ · `curl localhost:3000` 200.
Additional headless smoke tests exercised the entire bake path (including a
`setRunSeed` rebuild) and **all six** destruction effect branches with a stub
canvas context. Visuals verified by code inspection — Playwright/browser
screenshots are unavailable in this sandbox.
