// Raw LZ4 block (no frame or dictionary). The uncompressed size belongs to
// the typed bake protocol, not to the block. Keep incompressible data raw.
export type PackedBake = { bytes: Uint8Array<ArrayBuffer>; rawSize: number; lz4: boolean }
const word = (a: Uint8Array, i: number) => a[i] | a[i + 1] << 8 | a[i + 2] << 16 | a[i + 3] << 24
const TABLE = 1 << 16
const positions = new Int32Array(TABLE)

export function packBake(input: ArrayBuffer): PackedBake {
  const a = new Uint8Array(input), size = a.length
  const b = new Uint8Array(size + Math.ceil(size / 255) + 16)
  positions.fill(-1)
  let cursor = 0, head = 0, out = 0
  const writeLength = (length: number) => {
    while (length >= 255) { b[out++] = 255; length -= 255 }
    b[out++] = length
  }
  while (cursor <= size - 12) {
    const bits = word(a, cursor), h = Math.imul(bits, 0x9e3779b1) >>> 16
    const prev = positions[h]; positions[h] = cursor
    if (prev < 0 || cursor - prev > 65535 || word(a, prev) !== bits) { cursor++; continue }
    let n = 4
    while (cursor + n < size - 5 && a[prev + n] === a[cursor + n]) n++
    const literal = cursor - head, match = n - 4, distance = cursor - prev
    b[out++] = Math.min(literal, 15) << 4 | Math.min(match, 15)
    if (literal >= 15) writeLength(literal - 15)
    if (literal) { b.set(a.subarray(head, cursor), out); out += literal }
    b[out++] = distance & 255; b[out++] = distance >>> 8
    if (match >= 15) writeLength(match - 15)
    head = cursor += n
  }
  const literal = size - head
  b[out++] = Math.min(literal, 15) << 4
  if (literal >= 15) writeLength(literal - 15)
  b.set(a.subarray(head), out); out += literal
  // An uncompressed view must not detach the worker's retained tile cache.
  return out + 64 < size ? { bytes: b.slice(0, out), rawSize: size, lz4: true } : { bytes: a.slice(), rawSize: size, lz4: false }
}

export function unpackBake(p: PackedBake, expected = p.rawSize): ArrayBuffer {
  const a = p.bytes
  if (expected !== p.rawSize || expected < 0 || expected > 4 * 1024 * 1024) throw new RangeError('Bridge bake size')
  if (!p.lz4) {
    if (a.length !== expected) throw new RangeError('Bridge raw bake length')
    return a.byteOffset === 0 && a.buffer.byteLength === expected ? a.buffer : a.slice().buffer
  }
  const b = new Uint8Array(expected)
  let from = 0, to = 0
  const length = (base: number) => {
    if (base === 15) for (;;) {
      if (from >= a.length) throw new RangeError('LZ4 truncated length')
      const more = a[from++]; base += more
      if (more < 255) break
    }
    return base
  }
  while (from < a.length) {
    const token = a[from++], literal = length(token >>> 4)
    if (from + literal > a.length || to + literal > expected) throw new RangeError('LZ4 literal overrun')
    if (literal >= 48) { b.set(a.subarray(from, from + literal), to); from += literal; to += literal }
    else for (let k = 0; k < literal; k++) b[to++] = a[from++]
    if (from === a.length) break
    if (from + 2 > a.length) throw new RangeError('LZ4 missing offset')
    const offset = a[from++] | a[from++] << 8, n = length(token & 15) + 4
    if (offset <= 0 || offset > to || to + n > expected) throw new RangeError('LZ4 invalid match')
    let i = to - offset
    if (offset >= n && n >= 32) { b.copyWithin(to, i, i + n); to += n }
    else if (offset === 1 && n >= 32) { b.fill(b[i], to, to + n); to += n }
    else if (offset < n && n >= 96) {
      // Overlapping matches repeat a prefix; a single memmove is not LZ4
      // overlap semantics. Materialize one period, then double what's ready.
      const start = to, end = to + n
      b.copyWithin(to, i, to); to += offset
      while (to < end) {
        const size = Math.min(to - start, end - to)
        b.copyWithin(to, start, start + size); to += size
      }
    } else for (const end = to + n; to < end;) b[to++] = b[i++]
  }
  if (to !== expected) throw new RangeError('LZ4 output length')
  return b.buffer
}
