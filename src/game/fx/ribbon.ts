export const RIBBON_LIFETIME = .140
export const RIBBON_STEPS = 4
export const RIBBON_CAPACITY = 36

export interface RibbonSegment { bx: number; by: number; tx: number; ty: number }
export interface Trail {
  active: boolean
  pts: Float32Array // ring of hilt x/y and kissaki x/y
  born: Float64Array
  head: number
  count: number
  N: number
  age: number
  clock: number
  life: number
  color: string
  color2: string
  width: number
  emitting: boolean
  opticalArc?: { x: number; y: number; angle: number; sweep: number; radius: number }
}

export function newRibbon(capacity = RIBBON_CAPACITY): Trail {
  return { active: false, pts: new Float32Array(capacity * 4), born: new Float64Array(capacity), N: capacity,
    head: 0, count: 0, age: 0, clock: 0, life: RIBBON_LIFETIME, color: '#fff', color2: '#afc9d4', width: 1, emitting: false }
}

export function addRibbonSample(t: Trail, bx: number, by: number, tx: number, ty: number): void {
  if (!t.active || !(Number.isFinite(bx) && Number.isFinite(by) && Number.isFinite(tx) && Number.isFinite(ty))) return
  const i = t.head * 4
  t.pts[i] = bx; t.pts[i + 1] = by; t.pts[i + 2] = tx; t.pts[i + 3] = ty
  t.born[t.head] = t.clock
  t.head = (t.head + 1) % t.N
  t.count = Math.min(t.N, t.count + 1)
}

export function trimRibbon(t: Trail, dt: number): void {
  t.clock += dt
  while (t.count > 0 && t.clock - t.born[(t.head - t.count + t.N) % t.N] >= RIBBON_LIFETIME) t.count--
}

export function catmullRom(a: number, b: number, c: number, d: number, t: number): number {
  return b + .5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (-a + 3 * b - 3 * c + d)))
}

// Renderer-owned scratch, no point lists or temporary canvas per attack.
const mesh = new Float32Array((RIBBON_CAPACITY * RIBBON_STEPS + 1) * 5)
const anchorScratch = [0, 0, 0, 0]
const at = (t: Trail, from: number, index: number) => ((from + Math.max(0, Math.min(t.count - 1, index))) % t.N) * 4

export function ribbonFade(t: Trail): number { return t.emitting ? 1 : Math.max(0, 1 - t.age / t.life) }

/** Both the Canvas body of the ribbon and the HDR edge take their rows
 * from the same spline sampler. Scratch is valid until the next call. */
export function sampleRibbon(t: Trail, anchor?: RibbonSegment): number {
  if (!t.active || t.count < 2 || ribbonFade(t) <= .005) return 0
  const start = (t.head - t.count + t.N) % t.N, rowCount = (t.count - 1) * RIBBON_STEPS + 1
  const last = at(t, start, t.count - 1)
  // Reused 4-slot scratch: the anchored row is consumed before the next call.
  let anchored: readonly number[] | null = null
  if (anchor) {
    anchorScratch[0] = anchor.bx; anchorScratch[1] = anchor.by
    anchorScratch[2] = anchor.tx; anchorScratch[3] = anchor.ty
    anchored = anchorScratch
  }
  const value = (row: number, axis: number) => anchored && row === last ? anchored[axis] : t.pts[row + axis]
  let row = 0
  for (let i = 0; i < t.count - 1; i++) {
    const a = at(t, start, i - 1), b = at(t, start, i), c = at(t, start, i + 1), d = at(t, start, i + 2)
    const bTime = t.born[b / 4], cTime = t.born[c / 4]
    for (let j = 0; j < RIBBON_STEPS; j++, row += 5) {
      const f = j / RIBBON_STEPS
      for (let k = 0; k < 4; k++) mesh[row + k] = catmullRom(value(a, k), value(b, k), value(c, k), value(d, k), f)
      const age = Math.max(0, 1 - (t.clock - bTime - (cTime - bTime) * f) / RIBBON_LIFETIME)
      mesh[row + 4] = .09 + .91 * age * Math.pow((i + f) / (t.count - 1), .64)
    }
  }
  for (let k = 0; k < 4; k++) mesh[row + k] = value(last, k)
  mesh[row + 4] = Math.max(.22, 1 - (t.clock - t.born[last / 4]) / RIBBON_LIFETIME)
  return rowCount
}

export function ribbonRow(index: number, lane: 0 | 1 | 2 | 3 | 4): number { return mesh[index * 5 + lane] }

/** Two connected feather bands (hilt -> tip) plus one continuous edge.
 * Replacing the final row with the interpolated live blade anchors it on the
 * render pose, while the old samples remain fixed in world space. */
export function drawRibbon(g: CanvasRenderingContext2D, t: Trail, anchor?: RibbonSegment, hdr = false): void {
  paintRibbonRows(g, t, sampleRibbon(t, anchor), hdr)
}

/** Reuse the sampled spline if the same frame also needs native HDR vertices. */
export function paintRibbonRows(g: CanvasRenderingContext2D, t: Trail, rowCount: number, hdr: boolean): void {
  if (rowCount < 2) return
  const fade = ribbonFade(t)
  g.save()
  g.globalCompositeOperation = 'lighter'
  g.lineJoin = g.lineCap = 'round'
  const strength = Math.min(1, .62 + t.width * .26)
  const ribbon = (width: number, color: string, alpha: number) => {
    g.beginPath(); g.moveTo(mesh[2], mesh[3])
    for (let k = 1; k < rowCount; k++) g.lineTo(mesh[k * 5 + 2], mesh[k * 5 + 3])
    for (let k = rowCount - 1; k >= 0; k--) {
      const p = k * 5, f = Math.min(.98, width * mesh[p + 4])
      g.lineTo(mesh[p + 2] + (mesh[p] - mesh[p + 2]) * f, mesh[p + 3] + (mesh[p + 1] - mesh[p + 3]) * f)
    }
    g.closePath(); g.fillStyle = color; g.globalAlpha = fade * alpha * strength; g.fill()
  }
  ribbon(.90, t.color2, .21)
  ribbon(.52, t.color, .42)
  ribbon(.12, hdr ? t.color : '#f0f7ff', t.width < .5 ? .17 : .32)
  g.restore()
}
