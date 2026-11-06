/** STICKMAN RISING — math / easing / small helpers. No allocations in hot paths. */

export const TAU = Math.PI * 2

export const clamp = (v: number, a: number, b: number): number =>
  v < a ? a : v > b ? b : v

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Frame-rate independent exponential smoothing. */
export const damp = (a: number, b: number, k: number, dt: number): number =>
  a + (b - a) * (1 - Math.exp(-k * dt))

export const dampAngle = (a: number, b: number, k: number, dt: number): number => {
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return a + d * (1 - Math.exp(-k * dt))
}

export const smoothstep = (t: number): number => {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}

/* ---------------- easing (t in 0..1) ---------------- */

export type EaseFn = (t: number) => number
export const easeLinear: EaseFn = (t) => t
export const easeInQuad: EaseFn = (t) => t * t
export const easeOutQuad: EaseFn = (t) => 1 - (1 - t) * (1 - t)
export const easeInCubic: EaseFn = (t) => t * t * t
export const easeOutCubic: EaseFn = (t) => 1 - Math.pow(1 - t, 3)
export const easeInOutCubic: EaseFn = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
export const easeOutQuart: EaseFn = (t) => 1 - Math.pow(1 - t, 4)
export const easeInQuart: EaseFn = (t) => t * t * t * t
export const easeOutBack: EaseFn = (t) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
export const easeOutElastic: EaseFn = (t) => {
  const c4 = TAU / 3
  return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
}
export const easeOutExpo: EaseFn = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))

export const EASES: Record<string, EaseFn> = {
  linear: easeLinear,
  inQuad: easeInQuad,
  outQuad: easeOutQuad,
  inCubic: easeInCubic,
  outCubic: easeOutCubic,
  inOutCubic: easeInOutCubic,
  outQuart: easeOutQuart,
  inQuart: easeInQuart,
  outBack: easeOutBack,
  outElastic: easeOutElastic,
  outExpo: easeOutExpo,
}

/* ---------------- random ---------------- */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const rand = (a = 1, b?: number): number => {
  if (b === undefined) return Math.random() * a
  return a + Math.random() * (b - a)
}
export const randInt = (a: number, b: number): number => Math.floor(rand(a, b + 1))
export const pick = <T>(arr: readonly T[]): T => arr[(Math.random() * arr.length) | 0]
export const chance = (p: number): boolean => Math.random() < p

/* ---------------- geometry ---------------- */

export const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax
  const dy = by - ay
  return dx * dx + dy * dy
}

export const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.sqrt(dist2(ax, ay, bx, by))

/** Squared distance from point C to segment AB. */
export function pointSegDist2(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): number {
  const abx = bx - ax
  const aby = by - ay
  const l2 = abx * abx + aby * aby
  let t = 0
  if (l2 > 1e-8) {
    t = clamp01(((cx - ax) * abx + (cy - ay) * aby) / l2)
  }
  const px = ax + abx * t
  const py = ay + aby * t
  return dist2(px, py, cx, cy)
}

/** True if segment AB intersects circle (cx,cy,r). */
export const segHitsCircle = (
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, r: number,
): boolean => pointSegDist2(ax, ay, bx, by, cx, cy) <= r * r

/* ---------------- color ---------------- */

const rgbaCache = new Map<string, string>()

/** '#rrggbb' + alpha → 'rgba(...)', cached. */
export function rgba(hex: string, a: number): string {
  const key = hex + a.toFixed(3)
  const hit = rgbaCache.get(key)
  if (hit) return hit
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const out = `rgba(${r},${g},${b},${a < 0 ? 0 : a > 1 ? 1 : a})`
  rgbaCache.set(key, out)
  return out
}

/** Simple struct pool — avoids per-frame allocation. */
export class Pool<T> {
  private free: T[] = []
  constructor(private factory: () => T, prealloc = 0) {
    for (let i = 0; i < prealloc; i++) this.free.push(factory())
  }
  acquire(): T {
    return this.free.pop() ?? this.factory()
  }
  release(o: T): void {
    this.free.push(o)
  }
}

/** Format integers with thousands separators. */
export const fmt = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
