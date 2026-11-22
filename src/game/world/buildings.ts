/** STICKMAN RISING — src/game/world/buildings.ts
 * BUILDINGS THAT LOOK INHABITED, WITHOUT RE-BAKING A TILE.
 * ----------------------------------------------------------------------------
 * Every skyline band is baked once per run into a tile and blitted in rows — the
 * reason the city is cheap. The price is that a baked city is a PHOTOGRAPH: no
 * window ever changes, no sign buzzes, no rooftop vent breathes. A player will
 * not say "the city is static"; they will say the background looks cheap, and
 * they will be right, because a living foreground moving in front of a dead
 * backdrop is the oldest tell in 2-D.
 *
 * The fix cannot be "animate the bake" — that is a full-tile redraw per frame.
 * It also cannot be "re-bake on a timer": a 2048×860 canvas upload mid-fight is a
 * frame spike, which is worse than a still city.
 *
 * So each band keeps an ANIMATION LIST: a handful of tiny records (a window cell,
 * a sign tube, an antenna beacon, a vent) emitted at bake time from the same
 * rectangles, and drawn on top of the band as a few fills. Each tier picks a
 * fixed set per tile; visibility culls copies, not which fixtures animate.
 *
 * DETERMINISM, AND WHY THIS FILE IS STATELESS. Records are chosen by hashing
 * (band, tile x, run seed) rather than by consuming the bake's RNG. Two reasons:
 * the bake's art must not shift because an animation was added (a screenshot
 * diff should show the animations, not a re-rolled skyline), and a hash needs no
 * state, so the same run always produces the same inhabitants. `h01` is a pure
 * integer hash — no `Math.random`, no clock.
 * ==========================================================================*/

export type Band = 'deep' | 'far' | 'mid' | 'near'

export type AnimKind =
  /** One warm window gradually changing intensity. */
  | 'flicker'
  /** A highlight travels across three continuously lit sign cells. */
  | 'chase'
  /** Red obstruction light on an antenna, pulsing. */
  | 'beacon'
  /** A vent exhaling three puffs into the light. */
  | 'steam'
  /** Laundry on a line, swaying. */
  | 'laundry'
  /** A satellite dish tracking something slowly. */
  | 'dish'
  /** A cool window with a gently varying TV glow. */
  | 'tv'
  /** A neon tube with subtle ballast variation, never turned off. */
  | 'buzz'
  /** A bare bulb breathing on a wire. */
  | 'bulb'

export interface BuildingAnim {
  kind: AnimKind
  band: Band
  /** Tile-local x, px. The band's scroll is applied at draw. */
  tx: number
  /** Tile-local y measured from the TOP of the band tile. */
  ty: number
  /** Cell size, px. Interpretation depends on the kind. */
  w: number
  h: number
  /** 0–1, offsets the animation so neighbours never sync. */
  phase: number
  /** Kind-specific rate (Hz for emitters, px/s for steam). */
  rate: number
}

/** Pure integer hash → [0,1). No state, no clock, identical on every machine. */
export function h01(a: number, b: number, c: number): number {
  let h = (a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 2147483647
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967296
}

/* Constant colour strings: an animation must not build a colour per frame (the
 * draw path's allocation rule, 22 §O-09). */
const C_WARM = '255,206,140'
const C_COOL = '150,205,255'
const C_TV = '120,170,235'
const C_NEON = '255,90,190'
const C_BEACON = '255,86,64'
const C_STEAM = '200,218,232'

/** Pick the animations for one baked building. `budget` is the tier's records
 *  per band; a building may get 0, 1 or 2 of them — a skyline where EVERY window
 *  animates is a disco, and the eye reads it as noise rather than life.
 *
 *  `depth` fades the whole list with distance: the deep ridge is 4 px of
 *  silhouette, and a beacon there would be the brightest thing in the sky. */
export function animsForBuilding(
  band: Band,
  seed: number,
  rect: { tx: number; ty: number; w: number; h: number },
  out: BuildingAnim[],
): void {
  const { tx, ty, w, h } = rect
  if (w < 10 || h < 14) return
  const bandN = band === 'deep' ? 1 : band === 'far' ? 2 : band === 'mid' ? 3 : 4
  const r = h01(tx | 0, bandN, seed)
  // Occupancy: the further the band, the fewer things are alive in it.
  const dense = band === 'near' ? 0.85 : band === 'mid' ? 0.6 : band === 'far' ? 0.34 : 0.12
  if (r > dense) return

  const which = h01(tx | 0, bandN + 71, seed)
  // Rooftop line in tile coords. The building's top is `ty`; the roof furniture
  // sits ON it, and a window sits BELOW it.
  const roofY = ty
  if (which < 0.22) {
    out.push({ kind: 'flicker', band, tx: tx + w * (0.15 + 0.7 * h01(tx | 0, bandN + 3, seed)), ty: ty + h * (0.2 + 0.5 * h01(tx | 0, bandN + 4, seed)), w: band === 'near' ? 3 : 2, h: band === 'near' ? 4 : 3, phase: h01(tx | 0, bandN + 5, seed), rate: 0.28 + 0.5 * h01(tx | 0, bandN + 6, seed) })
  } else if (which < 0.36) {
    out.push({ kind: 'tv', band, tx: tx + w * (0.2 + 0.6 * h01(tx | 0, bandN + 7, seed)), ty: ty + h * (0.25 + 0.4 * h01(tx | 0, bandN + 8, seed)), w: 2, h: 3, phase: h01(tx | 0, bandN + 9, seed), rate: 0.55 + 0.6 * h01(tx | 0, bandN + 10, seed) })
  } else if (which < 0.5 && (band === 'mid' || band === 'near')) {
    out.push({ kind: 'buzz', band, tx: tx + w * 0.2, ty: roofY - 4 - 10 * h01(tx | 0, bandN + 11, seed), w: Math.min(26, w * 0.5), h: 3, phase: h01(tx | 0, bandN + 12, seed), rate: 0.6 + 0.65 * h01(tx | 0, bandN + 13, seed) })
  } else if (which < 0.62 && band !== 'deep') {
    out.push({ kind: 'beacon', band, tx: tx + w * (0.25 + 0.5 * h01(tx | 0, bandN + 14, seed)), ty: roofY - 6 - 12 * h01(tx | 0, bandN + 15, seed), w: 2, h: 2, phase: h01(tx | 0, bandN + 16, seed), rate: 0.5 + 0.35 * h01(tx | 0, bandN + 17, seed) })
  } else if (which < 0.74 && band !== 'deep') {
    out.push({ kind: 'steam', band, tx: tx + w * (0.3 + 0.4 * h01(tx | 0, bandN + 18, seed)), ty: roofY - 3, w: 3, h: 12, phase: h01(tx | 0, bandN + 19, seed), rate: 9 + 8 * h01(tx | 0, bandN + 20, seed) })
  } else if (which < 0.84 && (band === 'mid' || band === 'near')) {
    out.push({ kind: 'laundry', band, tx: tx + w * (0.2 + 0.4 * h01(tx | 0, bandN + 21, seed)), ty: roofY - 5 - 6 * h01(tx | 0, bandN + 22, seed), w: Math.min(30, w * 0.55), h: 8, phase: h01(tx | 0, bandN + 23, seed), rate: 0.8 + 0.6 * h01(tx | 0, bandN + 24, seed) })
  } else if (which < 0.93 && band !== 'deep') {
    out.push({ kind: 'dish', band, tx: tx + w * (0.3 + 0.4 * h01(tx | 0, bandN + 25, seed)), ty: roofY - 5, w: 6 + 4 * h01(tx | 0, bandN + 26, seed), h: 4, phase: h01(tx | 0, bandN + 27, seed), rate: 0.12 + 0.1 * h01(tx | 0, bandN + 28, seed) })
  } else if (band === 'near' || band === 'mid') {
    out.push({ kind: 'bulb', band, tx: tx + w * (0.25 + 0.5 * h01(tx | 0, bandN + 29, seed)), ty: roofY - 10 - 8 * h01(tx | 0, bandN + 30, seed), w: 2, h: 2, phase: h01(tx | 0, bandN + 31, seed), rate: 0.7 + 0.5 * h01(tx | 0, bandN + 32, seed) })
  }
  // A chase needs a sign wide enough to hold three cells; it is added as a
  // SECOND record so a building can have a window and a sign without doubling
  // the density everywhere.
  if (which < 0.36 && band === 'mid' && w > 60) {
    out.push({ kind: 'chase', band, tx: tx + w * 0.18, ty: roofY - 16, w: Math.min(24, w * 0.42), h: 4, phase: h01(tx | 0, bandN + 40, seed), rate: 0.42 + 0.48 * h01(tx | 0, bandN + 41, seed) })
  }
}

/** Rank once per bake, so small budgets are spread across the district instead
 *  of taking only its left end. Higher tiers add to the same fixed set. */
export function orderBuildingAnims(anims: BuildingAnim[], seed: number): void {
  anims.sort((a, b) => h01(a.tx, a.ty, seed) - h01(b.tx, b.ty, seed))
}

const TAU = 2 * Math.PI

/** Draw one band's animations. `bandTopY` is the screen y of the band tile's top
 *  row (the same value `drawCityBand` computed), `t` the ambient clock.
 *  Everything is fills and short strokes: no sprites, no gradients, no filters. */
export function drawBuildingAnims(
  ctx: CanvasRenderingContext2D,
  anims: readonly BuildingAnim[],
  t: number,
  m: number,
  bandTopY: number,
  tileW: number,
  viewL: number,
  viewR: number,
  budget: number,
): number {
  const count = Math.min(budget, anims.length)
  if (count <= 0 || tileW <= 0) return 0
  let drawn = 0
  ctx.save()
  for (let i = 0; i < count; i++) {
    const a = anims[i]
    // Cull only copies whose whole footprint misses the view. Steam, dishes
    // and bulbs can extend to the left of the record's anchor.
    const margin = a.kind === 'dish' ? a.w + 1 : a.kind === 'steam' || a.kind === 'bulb' ? 12 : 1
    const sx = a.tx - m, left = viewL - a.w - margin, right = viewR + margin
    const firstX = sx + Math.ceil((left - sx) / tileW) * tileW
    if (firstX >= right) continue
    const y = bandTopY + a.ty
    const phase = TAU * (t * a.rate + a.phase)
    // Don't inherit additive blending from a previous vent or bulb. Its
    // visibility may change without any change to this sign's own light.
    ctx.globalCompositeOperation = a.kind === 'steam' || a.kind === 'bulb' ? 'lighter' : 'source-over'
    for (let x = firstX; x < right; x += tileW) {
      switch (a.kind) {
        case 'flicker': {
          ctx.globalAlpha = 0.33 + 0.12 * Math.sin(phase)
          ctx.fillStyle = `rgb(${C_WARM})`
          ctx.fillRect(x, y, a.w, a.h)
          break
        }
        case 'tv': {
          ctx.globalAlpha = 0.54 + 0.09 * Math.sin(phase)
          ctx.fillStyle = `rgb(${C_TV})`
          ctx.fillRect(x, y, a.w, a.h)
          break
        }
        case 'chase': {
          const cw = a.w / 3
          ctx.fillStyle = `rgb(${C_NEON})`
          for (let c = 0; c < 3; c++) {
            ctx.globalAlpha = 0.34 + 0.12 * Math.cos(phase - c * TAU / 3)
            ctx.fillRect(x + c * cw, y, cw - 1, a.h)
          }
          break
        }
        case 'buzz': {
          ctx.globalAlpha = 0.46 + 0.08 * Math.sin(phase)
          ctx.fillStyle = `rgb(${C_NEON})`
          ctx.fillRect(x, y, a.w, a.h)
          break
        }
        case 'beacon': {
          const p = Math.max(0, Math.sin(phase))
          ctx.globalAlpha = 0.15 + 0.75 * p * p * p
          ctx.fillStyle = `rgb(${C_BEACON})`
          ctx.fillRect(x, y, a.w, a.h)
          break
        }
        case 'steam': {
          ctx.fillStyle = `rgb(${C_STEAM})`
          for (let p = 0; p < 3; p++) {
            // Each puff is on its own trip up the same column.
            const u = ((t * a.rate + a.phase * 60 + p * 17) % 42) / 42
            const r = a.w * (0.5 + u * 2.2)
            const alpha = 0.16 * (1 - u) * (1 - u)
            if (alpha < 0.01) continue
            ctx.globalAlpha = alpha
            ctx.beginPath()
            ctx.arc(x + Math.sin(u * 6 + p) * 2.5, y - u * a.h * 2.4, r, 0, Math.PI * 2)
            ctx.fill()
          }
          break
        }
        case 'laundry': {
          const sway = Math.sin(t * a.rate + a.phase * 6.283) * 1.6
          ctx.globalAlpha = 0.5
          ctx.strokeStyle = `rgb(${C_COOL})`
          ctx.lineWidth = 1
          ctx.beginPath()
          // The line, then three hanging pieces as short strokes.
          ctx.moveTo(x, y)
          ctx.lineTo(x + a.w, y)
          for (let c = 1; c <= 3; c++) {
            const lx = x + (a.w * c) / 4 + sway
            ctx.moveTo(lx, y)
            ctx.lineTo(lx + sway * 0.6, y + a.h)
          }
          ctx.stroke()
          break
        }
        case 'dish': {
          const rot = t * a.rate + a.phase * 6.283
          ctx.globalAlpha = 0.45
          ctx.strokeStyle = `rgb(${C_COOL})`
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(x, y, a.w, Math.PI * 0.15 + Math.sin(rot) * 0.5, Math.PI * 1.15 + Math.sin(rot) * 0.5)
          ctx.stroke()
          break
        }
        case 'bulb': {
          const b = 0.5 + 0.5 * Math.sin(t * a.rate + a.phase * TAU)
          ctx.globalAlpha = 0.18 + 0.22 * b
          ctx.fillStyle = `rgb(${C_WARM})`
          ctx.beginPath()
          ctx.arc(x, y, 3.5 + b * 1.5, 0, Math.PI * 2)
          ctx.fill()
          break
        }
      }
      drawn++
    }
  }
  ctx.restore()
  return drawn
}
