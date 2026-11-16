# Light & Shadow Match Plan — reaching mountain.html's fidelity

Status: PLAN (measurement done; execution pending sign-off on the tone numbers).
Reference: `mountain.html` ("Shirogane Horizon") as captured in `image-8.png`.

## 0. Measurement — the target table (done)

Sampled from image-8 (actual 1920×1080) with a pixel probe:

| region | reference luminance | our build (image-9/10) | verdict |
|---|---|---|---|
| deck ambient, away from the pool | **3–5** (near black) | ~30–60 | **8–15× too bright** |
| door pool peak | **160** rgb(192,155,111) | no readable pool | missing |
| house wall (moonlit side) | **28** | ~60+ | 2× too bright |
| sky top | **3** | ~30 (washed) | washed |
| mountain snow face | **102** | similar | OK |
| moon disc | **100** gray-blue, cratered | clipped to white | blown out |
| moon halo (above disc) | **211** tight ring | ~400px white blob | oversized |

The reference's structure: **near-black ground and walls; the light does all
the work** (the practical pool is 40:1 against the ambient). Our structure
inverts that: a mid-tone baked ground with additive light on top → wash,
no drama. Every tuning iteration since has fought this inversion.

## 1. Root causes

1. **Albedo law conflict.** The round-1/2 rule "moonlit deck must stay
   bright enough for dark contact shadows to read" set the deck's albedo at
   mid-tone. The reference proves the opposite works: its deck is lum 3–5
   and its shadows read because they are *darker than an already-dark
   ground* and because the *lit* areas (the pool) carry the contrast.
2. **Split light systems.** The practicals/key live in three places —
   the canvas rig pools, the MountainGL shader, the baked glows — with
   independent gains. No single tone target exists, so each pass
   over/undershoots (wash → blob → wash).
3. **No measurable objective.** Pool alphas, moon size and gains were
   tuned by eye against screenshots; there is no number to hit.

## 2. The phases

### Phase A — tone ladder (fix the albedo first)

Add to `render/rules.ts`:

```
tone: {
  deckAmbientBack: 5,   // lum of the deck near the structures
  deckAmbientFront: 3,  // lum of the near deck
  wall: 28,             // moonlit house wall
  sky: 3,
  poolPeak: 160,        // warm practical at its hottest
  shadowFloor: 4,       // shadowed deck (violet-black)
  moonDisc: 100,        // gray-blue, never clipped white
  moonHalo: 211,        // tight ring above the disc
}
```

- Deck plate gradient stops derive from `tone` (near-black planks with
  small plank-to-plank variance so the wood still reads — the reference's
  planks are visible at lum 3–10).
- House wall/floor colors derive from `tone.wall`.
- Contact shadows keep a near-black violet floor (`shadowFloor`); the
  round-1/2 law is satisfied by the shadow's own contrast, not the
  ground's brightness (the reference demonstrates this).
- Rain streak alpha trimmed so the weather cannot lift the ambient.

### Phase B — one light/shadow system, measured gains

- MountainGL shader and the canvas rig both read the same
  `rules.light` / `rules.tone` numbers (finish the wiring: the pool peak
  gain is set so the rendered pool ≈ `tone.poolPeak`, not by eye).
- Moon: the disc's luminance comes from the lunar texture alone (no
  additive glow pass — already removed); the halo ring's alpha is set so
  its peak ≈ `tone.moonHalo`; the disc radius stays ≈ 0.112·min.
- Shadow: the occluder pass darkens the ambient toward `shadowFloor`
  under casters (the SAT behaviour), not only the light it hides.

### Phase C — verification gates (make tone testable)

- `makeCanvas` falls back to `@napi-rs/canvas` when `document` is
  undefined (it is already a devDependency for tests), so the background
  can bake headless.
- New **tone probe test**: bake the scene, draw one frame offscreen,
  sample the probe points, assert luminance within ±20% of `tone` —
  a permanent regression gate for exactly the failure mode of the last
  three rounds.
- Final check stays the screenshot diff against image-8.

## 3. Risks

- **Fighter readability on a near-black deck**: the fighters read via
  their rim/key lighting and by standing in the pool's light; contact
  shadows stay near-black. Verify in play; if they vanish outside the
  pool, raise `deckAmbientFront` to ~8 rather than reverting the ladder.
- **Rain over a dark frame**: streaks must stay below the ambient lift
  budget; trim alpha if the probe shows the deck lifting during storms.

## 4. Execution order

1. A1 tone constants + deck plate + house colors.
2. A2 moon disc/halo values.
3. B1 light gains to `poolPeak`; shadow floor to `shadowFloor`.
4. C1 headless canvas fallback + tone probe test.
5. Gates (typecheck / lint / suite / curl) → screenshot compare.
