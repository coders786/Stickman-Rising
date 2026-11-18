/** STICKMAN RISING — src/game/world/clouds.ts
 * THE CLOUD BANK: the one cloud surface a soft sheet cannot fake.
 * ----------------------------------------------------------------------------
 * The stage already had three drifting sheets (high thin / main / low wisps)
 * built from radial blobs. Sheets read as *haze*; what reads as *weather* is a
 * SILHOUETTE — a ragged cumulus bank sitting on the skyline with a moonlit top
 * edge and a dark belly. That is a bake, not a particle system, and it is the
 * cheapest genuine depth cue available to a parallax sky: one canvas, one blit,
 * and it separates the four city bands from the sky without touching them.
 *
 * Three profile axes reach this file, and each one changes the PICTURE:
 *  · `clouds.coverage` picks how many billows exist and how opaque the bank is
 *    (below ~0.4 the bank is skipped entirely — a clear night has no bank);
 *  · `clouds.texture` picks how torn the edges are (soft sheet → hard cumulus);
 *  · `clouds.altitude` moves the whole band against the horizon.
 *
 * The bank is baked in LAYER SPACE (2048 px wide, wrapping) from the run seed,
 * so two runs never have the same cloud and a resize never re-bakes.
 * ==========================================================================*/

import type { EnvironmentProfile } from './profile'

const TAU = Math.PI * 2

export interface BankParams {
  /** 0 = no bank at all, 1 = a solid wall. */
  opacity: number
  billows: number
  /** 0 = soft sheet, 1 = torn cumulus. */
  torn: number
  /** Vertical offset against the horizon, in px. */
  lift: number
  /** Skip the whole pass below this coverage. */
  present: boolean
}

/** Pure parameter derivation — the part the tests can check without a canvas. */
export function bankParams(p: EnvironmentProfile): BankParams {
  const cov = Math.max(0, Math.min(1, p.clouds.coverage))
  const torn = Math.max(0, Math.min(1, p.clouds.texture))
  return {
    present: cov > 0.4,
    // Opacity ramps from 0 at the threshold to 0.85 at overcast: the bank is
    // additive to the sheets, so it must never be the only thing holding the
    // sky up on a clear night.
    opacity: cov > 0.4 ? Math.min(0.85, (cov - 0.4) * 1.75) : 0,
    billows: Math.round(10 + cov * 26),
    torn,
    // +y is DOWN in canvas space: a high-altitude sky must be drawn HIGHER, so
    // the lift is negative for altitude > 1. (Got this backwards first; the
    // test caught it, which is the only reason it is a comment.)
    lift: (1 - p.clouds.altitude) * 40,
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Bake the bank at `w`×`h` in layer space.
 *
 *  `surface` is the LEDGER'S canvas (render/ledger.ts). Better to be handed one
 *  than to make one: a 2048×210 bank is 1.7 MB resident, and a surface that
 *  allocates itself is a surface that never appears in the memory budget (12 §4
 *  measured 37 of those). The headless path still refuses: no document, no bank.
 *  Returns null when the release is clear or when the caller has no canvas. */
export function buildCloudBank(
  p: EnvironmentProfile,
  w = 2048,
  h = 210,
  surface?: HTMLCanvasElement | null,
): HTMLCanvasElement | null {
  const params = bankParams(p)
  if (!params.present) return null
  // NO CANVAS IS CREATED HERE, EVER — not even a fallback. The ledger rule is a
  // gate (scripts/lint-boundaries.mjs rule 1), and a "convenience" fallback is
  // exactly how such gates stop meaning anything. No surface, no bank.
  if (!surface) return null
  const c = surface
  if (c.width !== w) c.width = w
  if (c.height !== h) c.height = h
  const g = c.getContext('2d')
  if (!g) return c
  const rng = mulberry32((p.seed ^ 0x5c10d5) >>> 0)
  const moon = p.mood.highlight
  const belly = '10,16,24'

  // BILLOWS — darkest first, so the moonlit pass lands on top of the mass.
  for (let i = 0; i < params.billows; i++) {
    const cx = rng() * w
    // Bias the mass low in the band: a bank sits ON the skyline.
    const cy = h * (0.42 + Math.pow(rng(), 0.7) * 0.5)
    const r = (38 + rng() * 78) * (0.7 + params.torn * 0.6)
    // wrapping: draw twice when the blob crosses the seam, so the tile is
    // horizontally periodic and the parallax wrap has no visible join
    for (const dx of [0, cx > w - r * 2 ? -w : 0]) {
      const grd = g.createRadialGradient(cx + dx, cy, r * 0.12, cx + dx, cy, r)
      grd.addColorStop(0, `rgba(${belly},${(0.5 + 0.35 * params.torn).toFixed(3)})`)
      grd.addColorStop(0.55, `rgba(${belly},${(0.3 + 0.2 * params.torn).toFixed(3)})`)
      grd.addColorStop(1, `rgba(${belly},0)`)
      g.fillStyle = grd
      g.beginPath()
      g.arc(cx + dx, cy, r, 0, TAU)
      g.fill()
    }
  }

  // MOONLIT TOPS — an arc of lit rim on the upper-right of each billow. Drawn
  // with `lighter` so overlapping rims brighten where the mass is thickest,
  // which is what real cloud tops do at the terminator.
  g.globalCompositeOperation = 'lighter'
  const rng2 = mulberry32((p.seed ^ 0x9b31e7) >>> 0)
  for (let i = 0; i < params.billows; i++) {
    const cx = rng2() * w
    const cy = h * (0.42 + Math.pow(rng2(), 0.7) * 0.5)
    const r = (38 + rng2() * 78) * (0.7 + params.torn * 0.6)
    const a = (0.10 + rng2() * 0.16) * (0.5 + params.torn * 0.5)
    for (const dx of [0, cx > w - r * 2 ? -w : 0]) {
      const rim = g.createRadialGradient(cx + dx + r * 0.25, cy - r * 0.45, r * 0.1, cx + dx, cy, r)
      rim.addColorStop(0, `rgba(${moon},${a.toFixed(3)})`)
      rim.addColorStop(0.5, `rgba(${moon},${(a * 0.25).toFixed(3)})`)
      rim.addColorStop(1, `rgba(${moon},0)`)
      g.fillStyle = rim
      g.beginPath()
      g.arc(cx + dx, cy, r, 0, TAU)
      g.fill()
    }
  }
  g.globalCompositeOperation = 'source-over'

  // FADE the bottom into the skyline so the bank has no visible cut edge.
  const fade = g.createLinearGradient(0, h * 0.55, 0, h)
  fade.addColorStop(0, 'rgba(0,0,0,0)')
  fade.addColorStop(1, 'rgba(0,0,0,1)')
  g.globalCompositeOperation = 'destination-out'
  g.fillStyle = fade
  g.fillRect(0, h * 0.55, w, h * 0.45)
  g.globalCompositeOperation = 'source-over'
  return c
}
