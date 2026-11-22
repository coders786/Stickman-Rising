/** SACR v4.0 wire format. Offsets below are words, not bytes. */
const _f32 = new Float32Array(1)
const _u32 = new Uint32Array(_f32.buffer)

export const SACR_COLUMNS = 80
/** The SACR v4 wire bin remains eight bytes wide; active Master evaluation
 *  uses six slots and Mobile four without changing the 3,584-byte ABI. */
export const SACR_V4_BIN_SLOTS = 8
export const SACR_MOBILE_K = 4 as const
export const SACR_MASTER_K = 6 as const
export const SACR_PRIMITIVES = 64
export const SACR_ARCH_RECORDS = 32
export const SACR_FEET = 16
export const SACR_DILATION = 1.2
export const SACR_SHADOW_GUARD = .48 // metres beyond an opaque capsule in the shadow bins
export const SACR_PX_PER_METER = 48 // logical world px; not HUD distance units
export const SACR_UBO_BINDING = 0
export const SACR_SOLID_ID = 63
export const SACR_BAR_DEPTH_MULTIPLIER = 6 // r1 steps (.02) encode Z reach in .12m increments
export type SACRMaxK = typeof SACR_MOBILE_K | typeof SACR_MASTER_K
export type RGB = readonly [number, number, number]
export type Vec3 = readonly [number, number, number]

export function f32ToF16(val: number): number {
  _f32[0] = val
  const x = _u32[0]
  const sign = (x >>> 16) & 0x8000
  const mantissa = x & 0x007fffff, e = (x >>> 23) & 0xff
  if (e === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0)
  const exp = e - 127 + 15
  if (exp >= 31) return sign | 0x7c00
  if (exp < -10) return sign
  // Round to nearest, ties to even. Preserve the half-way bit for
  // subnormals and let rounding carry into the exponent (including inf).
  const shift = exp <= 0 ? 14 - exp : 13
  const bits = exp <= 0 ? mantissa | 0x00800000 : mantissa
  const q = bits >>> shift, tie = 1 << (shift - 1)
  const remainder = bits & ((tie << 1) - 1)
  const rounding = Number(remainder > tie || (remainder === tie && (q & 1) !== 0))
  return sign | ((Math.max(exp, 0) << 10) + q + rounding)
}

/** GLSL unpackHalf2x16: x is low, y is high. */
export function packHalf2x16(x: number, y: number): number {
  return ((f32ToF16(x) & 0xffff) | ((f32ToF16(y) & 0xffff) << 16)) >>> 0
}

export function f16ToF32(word: number): number {
  const sign = word & 0x8000 ? -1 : 1
  const exp = (word >>> 10) & 31, frac = word & 1023
  if (exp === 31) return frac ? NaN : sign * Infinity
  if (!exp) return sign * frac * 2 ** -24
  return sign * (1 + frac / 1024) * 2 ** (exp - 15)
}

export function unpackHalf2x16(word: number): readonly [number, number] {
  return [f16ToF32(word & 0xffff), f16ToF32(word >>> 16)]
}

export class SACRUniformBuffer {
  static readonly BYTE_LENGTH = 3584
  static readonly OFF_COLBINS = 0
  static readonly OFF_PRIMPOOL = 160
  static readonly OFF_ARCHPROFILE = 416
  static readonly OFF_FOOTAO = 544
  static readonly OFF_SHADOWBINS = 608
  static readonly OFF_BLOCKERS = 768
  static readonly OFF_SUPPORTS = 864
  readonly raw = new ArrayBuffer(SACRUniformBuffer.BYTE_LENGTH)
  readonly u32 = new Uint32Array(this.raw)
  readonly f32 = new Float32Array(this.raw)

  clearFrame(): void {
    this.u32.fill(0, 0, SACRUniformBuffer.OFF_ARCHPROFILE)
    this.u32.fill(0, SACRUniformBuffer.OFF_FOOTAO)
  }

  clearArchitecture(): void {
    this.u32.fill(0, SACRUniformBuffer.OFF_ARCHPROFILE, SACRUniformBuffer.OFF_FOOTAO)
  }
}

export function packCapsulePrim(
  buf: SACRUniformBuffer, poolIdx0Based: number,
  ax: number, ay: number, bx: number, by: number,
  r0: number, zObj: number, r1: number,
  r8: number, g8: number, b8: number, emis: number, charID: number,
): void {
  const o = SACRUniformBuffer.OFF_PRIMPOOL + poolIdx0Based * 4
  buf.u32[o] = packHalf2x16(ax, ay)
  buf.u32[o + 1] = packHalf2x16(bx, by)
  buf.u32[o + 2] = packHalf2x16(Math.max(0, r0), zObj)
  const r1Q = Math.min(63, Math.round(Math.max(0, r1) / 0.02))
  const r5 = (r8 >> 3) & 31, g5 = (g8 >> 3) & 31, b5 = (b8 >> 3) & 31
  const eQ = emis <= 0 ? 0 : Math.min(31, Math.max(1, Math.round(Math.log2(emis / 0.25 + 1) / 0.23)))
  buf.u32[o + 3] = (r1Q | (r5 << 6) | (g5 << 11) | (b5 << 16) | (eQ << 21) | ((charID & 63) << 26)) >>> 0
}

/** A horizontal opaque capsule/bar. ID 63 with zero emission has reserved
 * slab semantics: A/B span X at the slab centre Y, r0 is half thickness,
 * zObj is near Z, and the r1 lane encodes reach. No UBO layout change. */
export function packOpaqueBar(buf: SACRUniformBuffer, index: number, left: number, right: number, y: number,
  halfThickness: number, nearZ: number, depth: number, tint: number): void {
  packCapsulePrim(buf, index, left, y, right, y, halfThickness, nearZ, depth / SACR_BAR_DEPTH_MULTIPLIER,
    tint >>> 16 & 255, tint >>> 8 & 255, tint & 255, 0, SACR_SOLID_ID)
}

export function packArcPrim(
  buf: SACRUniformBuffer, poolIdx0Based: number,
  cx: number, cy: number, mx: number, my: number,
  radius: number, zObj: number, halfThickness: number, thetaHalfRad: number,
  r8: number, g8: number, b8: number, emis: number,
): void {
  if (Math.abs(Math.hypot(mx, my) - 1) > 1e-6 || !Number.isFinite(mx + my)) throw new RangeError('SACR arc bisector must be a unit vector')
  const o = SACRUniformBuffer.OFF_PRIMPOOL + poolIdx0Based * 4
  buf.u32[o] = packHalf2x16(cx, cy)
  buf.u32[o + 1] = packHalf2x16(mx, my)
  buf.u32[o + 2] = packHalf2x16(-Math.max(0.01, Math.abs(radius)), zObj)
  const thickQ = Math.min(63, Math.max(1, Math.round(halfThickness / 0.01)))
  const paramQ = Math.min(255, Math.max(1, Math.round(thetaHalfRad / Math.PI * 255)))
  const r4 = (r8 >> 4) & 15, g5 = (g8 >> 3) & 31, b4 = (b8 >> 4) & 15
  const eQ = Math.min(31, Math.max(1, Math.round(Math.log2(Math.max(emis, 0.25) / 0.25 + 1) / 0.23)))
  buf.u32[o + 3] = (thickQ | (paramQ << 6) | (r4 << 14) | (g5 << 18) | (b4 << 23) | (eQ << 27)) >>> 0
}

const decodeEmission = (q: number): number => .25 * (2 ** (q * .23) - 1)
export function unpackCapsuleMeta(word: number) {
  return { r1: (word & 63) * .02, rgb: [((word >>> 6) & 31) / 31, ((word >>> 11) & 31) / 31, ((word >>> 16) & 31) / 31] as RGB,
    emis: decodeEmission((word >>> 21) & 31), charID: word >>> 26 }
}
export function unpackArcMeta(word: number) {
  return { halfThickness: (word & 63) * .01, thetaHalf: ((word >>> 6) & 255) * Math.PI / 255,
    rgb: [((word >>> 14) & 15) / 15, ((word >>> 18) & 31) / 31, ((word >>> 23) & 15) / 15] as RGB,
    emis: decodeEmission(word >>> 27) }
}

export function unpackUnorm4x8_ES30(word: number): readonly [number, number, number, number] {
  return [(word & 255) / 255, ((word >>> 8) & 255) / 255, ((word >>> 16) & 255) / 255, (word >>> 24) / 255]
}

/** Arch word contract: atlas-local start/end millimetres (half-open),
 * half2(depth, lintel), linear RGBA8 soffit. Empty spans are ignored. */
export function packArchProfile(buf: SACRUniformBuffer, index: number, left: number, right: number,
  depth: number, lintel: number, soffit: RGB): void {
  if (index < 0 || index >= SACR_ARCH_RECORDS) throw new RangeError('SACR arch index')
  const o = SACRUniformBuffer.OFF_ARCHPROFILE + 4 * index
  buf.u32[o] = Math.round(Math.max(0, left) * 1000)
  buf.u32[o + 1] = Math.round(Math.max(left, right) * 1000)
  buf.u32[o + 2] = packHalf2x16(depth, lintel)
  const octet = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255)
  buf.u32[o + 3] = (octet(soffit[0]) | octet(soffit[1]) << 8 | octet(soffit[2]) << 16 | 255 << 24) >>> 0
}

export function packFootAO(buf: SACRUniformBuffer, index: number, x: number, z: number, radius: number, height: number): void {
  if (index < 0 || index >= SACR_FEET) throw new RangeError('SACR foot index')
  const o = SACRUniformBuffer.OFF_FOOTAO + 4 * index
  if (![x, z, radius, height].every(Number.isFinite) || radius <= 0 || height < -2.8 || height > 1.8) return
  buf.f32[o] = x; buf.f32[o + 1] = z; buf.f32[o + 2] = radius; buf.f32[o + 3] = height
}

export const SACR_PRIORITY = { architecture: 0, player: 1, boss: 2, emissive: 3, enemy: 4 } as const
export type SACRPriority = typeof SACR_PRIORITY[keyof typeof SACR_PRIORITY]
export interface SACRBinItem {
  /** Zero-based primitive pool slot, not the sentinel byte. */
  index: number
  minX: number
  maxX: number
  zObj: number
  priority: SACRPriority
  distance: number
  caster?: boolean
  representative?: boolean
}

/** One bounded scratch bin per column. Priority admission happens before
 * depth sorting. Equal (including half-quantized equal) depths use pool order. */
export class SACRColumnBinner {
  private readonly slots = new Uint8Array(SACR_COLUMNS * SACR_V4_BIN_SLOTS)
  private readonly counts = new Uint8Array(SACR_COLUMNS)
  private readonly itemById: (SACRBinItem | undefined)[] = new Array(SACR_PRIMITIVES + 1)

  write(buf: SACRUniformBuffer, items: readonly SACRBinItem[], viewWidthMeters: number, maxK: SACRMaxK, count = items.length, shadow = false): void {
    this.counts.fill(0)
    const offset = shadow ? SACRUniformBuffer.OFF_SHADOWBINS : SACRUniformBuffer.OFF_COLBINS
    buf.u32.fill(0, offset, offset + 160)
    if (!(viewWidthMeters > 0 && Number.isFinite(viewWidthMeters))) return
    const invColWidth = SACR_COLUMNS / viewWidthMeters
    for (let n = 0; n < Math.min(count, SACR_PRIMITIVES); n++) {
      const p = items[n], id = p.index + 1
      if (shadow && !p.caster) continue
      if (id <= 0 || id > SACR_PRIMITIVES) continue
      const guard = shadow ? SACR_SHADOW_GUARD : SACR_DILATION
      const left = p.minX - guard, right = p.maxX + guard
      // Offscreen intervals don't invent a primitive in an edge column.
      if (right < 0 || left > viewWidthMeters) continue
      this.itemById[id] = p
      const from = Math.max(0, Math.min(79, Math.floor(left * invColWidth)))
      const to = Math.max(0, Math.min(79, Math.floor(right * invColWidth)))
      for (let col = from; col <= to; col++) {
        const base = col * SACR_V4_BIN_SLOTS, used = this.counts[col]
        let i = used
        while (i > 0) {
          const q = this.itemById[this.slots[base + i - 1]]!
          if (shadow && !!p.representative !== !!q.representative) {
            if (q.representative) break
            i--; continue
          }
          if (p.priority > q.priority || p.priority === q.priority &&
            (p.distance > q.distance || p.distance === q.distance && p.index >= q.index)) break
          i--
        }
        if (i >= maxK) continue
        const next = Math.min(maxK, used + 1)
        for (let j = next - 1; j > i; j--) this.slots[base + j] = this.slots[base + j - 1]
        this.slots[base + i] = id
        this.counts[col] = next
      }
    }
    for (let col = 0; col < SACR_COLUMNS; col++) {
      const base = col * SACR_V4_BIN_SLOTS, used = this.counts[col]
      // Stable front-to-back using the exact depth the shader unpacks.
      for (let i = 1; i < used; i++) {
        const id = this.slots[base + i], z = this.depth(buf, id)
        let j = i
        while (j > 0) {
          const prev = this.slots[base + j - 1], pz = this.depth(buf, prev)
          if (pz < z || (pz === z && prev < id)) break
          this.slots[base + j] = prev
          j--
        }
        this.slots[base + j] = id
      }
      for (let i = 0; i < used; i++) {
        const word = offset + col * 2 + (i >>> 2)
        buf.u32[word] |= this.slots[base + i] << ((i & 3) * 8)
      }
    }
  }

  private depth(buf: SACRUniformBuffer, id: number): number {
    return f16ToF32(buf.u32[SACRUniformBuffer.OFF_PRIMPOOL + (id - 1) * 4 + 2] >>> 16)
  }
}

export function readColumnSlot(buf: SACRUniformBuffer, col: number, slot: number): number {
  return (buf.u32[col * 2 + (slot >>> 2)] >>> ((slot & 3) * 8)) & 255
}
