/** STICKMAN RISING — the light key + the strobe rim.
 *
 * The 2D shadow engine that lived here (drawPropShadow / drawCastShadow /
 * drawProjectedShadow / composeShadowKey / projectGroundPoint) is removed:
 * mountain.html's own system casts every shadow now — the world-mask
 * interval pyramid inside the MountainGL lightfield (mountain-gl/html-gl.ts).
 */
import { clamp, clamp01, lerp, rgba } from '../core/utils'

export interface KeyLight {
  /** horizontal direction shadows lean along (unit-ish, +X = right) */
  dirX: number
  /** elevation above the horizon, radians: high → short shadows */
  elev: number
  /** 0 = soft ambient … 1 = hard directional (strobes) */
  hard: number
  /** overall intensity */
  i: number
  /** shadow tint (near-black; storms cool it further) */
  color: string
  /** RAY-TRACED MODE: when a light ORIGIN is given, shadows are true
   * point-light projections instead of the directional skew. */
  ox?: number
  oy?: number
}

const finite = (n: number, fallback: number): number => (Number.isFinite(n) ? n : fallback)
const mixHex = (a: string, b: string, t: number): string => {
  const pa = parseInt(a.slice(1, 16), 16), pb = parseInt(b.slice(1, 16), 16), u = clamp01(finite(t, 0))
  const r = Math.round(((pa >> 16) & 255) * (1 - u) + ((pb >> 16) & 255) * u)
  const g = Math.round(((pa >> 8) & 255) * (1 - u) + ((pb >> 8) & 255) * u)
  const bl = Math.round((pa & 255) * (1 - u) + (pb & 255) * u)
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)
}

/* ===================== typed light rig (UE archetypes) ===================== */
export type LightKind = 'directional' | 'point' | 'spot' | 'rect'
export interface Light2D {
  kind: LightKind
  x: number
  y: number
  /** attenuation radius (point/spot/rect) */
  range: number
  intensity: number
  color: string
  /** spot axis */
  dirX?: number
  dirY?: number
  /** rect extent */
  w?: number
  h?: number
}

/** the shoji door — warm practical (its deck pool lives in the lightfield). */
export const DOOR_LIGHT: Light2D = {
  // the baked house's lit doorway (hearthAnchor = INN_X + 14); 1755 was the
  // legacy city scene's stairwell practical, 345 px left of the art
  kind: 'point', x: 2114, y: -120, range: 640, intensity: .95, color: '#ff9a4d',
}
/** the broken streetlight (left field) — cool practical. */
export const STREET_LIGHT: Light2D = {
  kind: 'point', x: 830, y: -252, range: 620, intensity: .9, color: '#b8e4ff',
}

export function keyLightFromStorm(intensity: number, azimuth: number): KeyLight {
  const k = clamp01(finite(intensity, 0)), az = clamp(finite(azimuth, 0), -1, 1)
  // Bolt-strobe mode (k→1): hard, bright, near-white, raking toward the bolt —
  // shadows snap tight and near-black (ambient drowned). Moon mode (k→0):
  // KEY LIGHT = moon upper-right — LOW elevation so shadows rake LONG
  // down-left across the deck, soft-edged.
  // SKY-COLORED SHADOWS law: shadow = the remaining skylight — a DARK
  // violet-blue that pops against the bright moonlit deck, never dead black.
  return {
    dirX: lerp(-.85, -.92 * az, k), elev: lerp(.50, .40, k), hard: lerp(.12, 1, k),
    i: lerp(.62, 1, k), color: mixHex('#231d48', '#0d0c22', k),
  }
}

export function drawStrobeRim(ctx: CanvasRenderingContext2D, light: KeyLight, k: number, chains: number[][], head: { x: number; y: number; r: number }, face: number, lineW: number, color = '#cfe4ff'): void {
  const amount = clamp01(finite(k, 0)); if (amount < .04) return
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = rgba(color, amount * .2)
  ctx.lineWidth = .65; ctx.beginPath()
  const off = -clamp(finite(light.dirX, 0), -1, 1) * finite(face, 1) * (clamp(finite(lineW, 5), .1, 20) * .5 + .5)
  for (const chain of chains) {
    let started = false
    for (let i = 0; i + 1 < chain.length; i += 2) {
      if (!Number.isFinite(chain[i]) || !Number.isFinite(chain[i + 1])) { started = false; continue }
      if (!started) ctx.moveTo(chain[i] + off, chain[i + 1]); else ctx.lineTo(chain[i] + off, chain[i + 1])
      started = true
    }
  }
  ctx.stroke(); ctx.restore(); void head
}
