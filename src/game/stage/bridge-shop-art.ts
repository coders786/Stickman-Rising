import { box, edge, face, paintFastener, ramp, slab, type ArtPen } from './bridge-paint'
import { bridgeHash } from './bridge-material'
import type { ShopFront, ShopKind, ShopPane } from './bridge-shop-layout'

type Finish = { frame: string; seam: string; sill: string; tread: readonly string[]; walls: readonly [string, string, string]; lamp: string; label: string }
const finishes: Record<ShopKind, Finish> = {
  concourse: { frame: '#414d50', seam: '#8e9990', sill: '#acc0ad', tread: ['#435353', '#475751', '#536361', '#45504e'], walls: ['#353634', '#8b7a61', '#635449'], lamp: '#e4c197', label: 'TRANSIT EATS  /  TAKEAWAY' },
  metro: { frame: '#445660', seam: '#92aba6', sill: '#acc9bc', tread: ['#435861', '#455861', '#506674', '#526069'], walls: ['#36434a', '#83988d', '#565b50'], lamp: '#d5dcbd', label: 'STATION CAFÉ  /  NORTH LOOP' },
  market: { frame: '#544844', seam: '#a78c6c', sill: '#ba9876', tread: ['#62504a', '#6b5047', '#654b47', '#69584d'], walls: ['#463733', '#a58168', '#765b49'], lamp: '#ffcf9f', label: 'TEA & NOODLES  /  OPEN LATE' },
  garden: { frame: '#435752', seam: '#9aa98f', sill: '#acc4a8', tread: ['#465b54', '#546c5a', '#526455', '#4e6758'], walls: ['#374d44', '#879b81', '#61705a'], lamp: '#dfddb3', label: 'TERRACE  /  WINTER GARDEN' },
}

function plant(g: ArtPen, x: number, y: number, h: number, salt: number): void {
  edge(g, '#3a4a36', 1.2, x, y - 4, x - 1.8, y - h)
  for (let i = 0; i < 5; i++) {
    const d = i % 2 ? -1 : 1, v = bridgeHash(i, salt, 84), cy = y - h * (.45 + .1 * i)
    g.fillStyle = i % 3 ? '#4d6b4a' : '#748061'; g.beginPath(); g.ellipse(x + d * (2 + v * 3), cy, 2 + v * 1.7, h * .18, d * (1 + v * .3), 0, Math.PI * 2); g.fill()
  }
  face(g, '#765947', x - 4.5, y - 6, x + 4.5, y - 6, x + 3.3, y, x - 3.3, y)
  slab(g, '#ad8861', x - 4.8, y - 6.8, 9.6, 1.4)
}

/** A deep, warm room behind cool glass. Detail is behind the rubber gasket;
 * no high-contrast diagonal decal or independent portrait is on the pane. */
function interior(g: ArtPen, p: ShopPane, f: Finish, kind: ShopKind, i: number, detail: boolean): void {
  const { left: l, top: t, right: r, bottom: b } = p, w = r - l, h = b - t
  slab(g, ramp(g, 0, t, 0, b, ...f.walls), l, t, w, h)
  g.save(); g.beginPath(); g.rect(l, t, w, h); g.clip()
  const ledge = b - Math.min(12, h * .16), wall = t + h * .77
  const px = l + w * (i % 2 ? .62 : .39), py = t + Math.min(12, h * .18)
  // The pendant lights a finite patch of plaster behind the furnishings.
  // Paint the wall spill first so counters and seats remain solid silhouettes.
  if (i < 3) {
    const cy = py + h * .26, radius = Math.min(w * .65, h * .65)
    const pool = g.createRadialGradient(px, cy, 0, px, cy, radius)
    pool.addColorStop(0, f.lamp + '8c'); pool.addColorStop(.43, f.lamp + '48'); pool.addColorStop(1, f.lamp + '00')
    slab(g, pool, l, t, w, wall - t)
  }
  face(g, '#20211f68', l, t, r, t, r - 7, t + 5.7, l + 7.8, t + 5.7)
  face(g, '#242b2a81', l, t, l + 7.6, t + 6, l + 7.6, wall - 2, l, b - 4)
  face(g, '#251f20ac', r, t, r - 5, t + 6, r - 5, wall - 1, r, b)
  face(g, ramp(g, 0, wall, 0, b, '#383d38', '#5f5545', '#282b2b'), l, b, l + w * .21, wall, r - 7, wall, r, b)
  slab(g, '#141e2066', l + w * .21, wall, w * .79 - 7, 1.65)
  if (detail) {
    for (let row = t + 8, j = 0; row < wall; row += 7.8, j++) {
      edge(g, '#332a224c', .63, l + 8, row, r - 5, row)
      for (let sx = l + 9 + (j % 2) * 8, k = 0; sx < r - 8; sx += 16, k++) {
        const v = bridgeHash(k, j, i + 22), tile = Math.min(14, r - sx - 6)
        slab(g, v < .36 ? '#4a443230' : '#d0b9942e', sx + 1, row - 6.48, tile, 6.12)
        slab(g, '#302f2b73', sx, row - 7, .55, 6.95)
        slab(g, '#e2d5b23e', sx + 1, row + .71, tile, .53)
      }
    }
    for (const u of [.18, .36, .59, .84]) edge(g, '#221e2060', .61, l + w * (.22 + u * .63), wall + 1, l + w * u, b)
  }
  if (p.use === 'counter' || p.use === 'shelves') {
    const shelves = p.use === 'shelves' ? 3 : 2
    for (let j = 0; j < shelves; j++) {
      const y = t + h * (.39 + j * .16), span = w - 16, x = l + 9
      slab(g, ramp(g, 0, y, 0, y + 6, '#1b2020a4', '#0a101200'), x, y, span, 6)
      face(g, '#767052', x - .5, y - 1.5, x + 2.3, y - 3.1, x + span + 2, y - 3.1, x + span, y - 1.5)
      slab(g, '#423832', x - .5, y - 1.5, span + .5, 2.5)
      slab(g, '#bda37f', x + .5, y - 1.27, span - 2, .61)
      if (detail) for (let a = 0; a < Math.floor(span / 6.5); a++) {
        const u = bridgeHash(a + 9 * j, i, 192), sz = 2.4 + u * 2.8, ch = 4 + 5.1 * bridgeHash(a, j, 397), x1 = x + 1 + a * 6.7
        if (u > .93) continue
        const top = y - ch - 2
        box(g, x1, top, sz, ch, a % 4 ? '#806451' : '#5d6b56', '#b89f79', '#4a463d', 1.05, -.6)
        slab(g, a % 3 ? '#ded0a6b8' : '#c2a99e', x1 + .46, top + 1.1, sz - .9, ch * .30)
        slab(g, '#191f216a', x1 + sz * .62, top + 1.2, .43, ch - 1.6)
      }
    }
    box(g, l + 5, ledge - 5, w - 13, b - ledge + 5, ramp(g, 0, ledge - 5, 0, b, '#685c4e', '#322e2a'), '#a08261', '#292c2d', 5, -4)
    if (detail) for (let sx = l + 13; sx < r - 12; sx += 12) {
      slab(g, '#312a26c4', sx, ledge - 3, .7, b - ledge)
      slab(g, '#9f836854', sx + .79, ledge - 2, .7, b - ledge - 2)
    }
    if (detail && p.use === 'counter') {
      box(g, l + w * .58, ledge - 12, w * .23, 6, '#333a37', '#778677', '#2f3133', 3, -2)
      slab(g, '#c0a76a', l + w * .68, ledge - 10.7, w * .09, .9)
    }
  } else if (p.use === 'seating') {
    box(g, l + w * .15, ledge - 13, w * .68, 8, '#655648', '#a38c6d', '#3b352e', 4.3, -2.5)
    if (detail) for (const u of [.2, .77]) slab(g, '#3e362c', l + w * u, ledge - 6, 2.2, 7.2)
    slab(g, '#77695a5e', l + w * .15, ledge - 10, w * .68, .8)
    const x = l + w * .48
    if (detail) plant(g, x + w * .19, ledge - 14, kind === 'garden' ? 25 : 12, i)
    g.fillStyle = '#242322a0'; g.beginPath(); g.ellipse(x, ledge + 7, w * .24, 2.8, 0, 0, Math.PI * 2); g.fill()
    slab(g, '#3e3b32', x - 1.5, ledge - 6, 3.2, 13)
    g.fillStyle = '#776650'; g.beginPath(); g.ellipse(x, ledge - 6, w * .29, 3.6, 0, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#b49c76'; g.beginPath(); g.ellipse(x, ledge - 7.1, w * .28, 2.65, 0, 0, Math.PI * 2); g.fill()
    if (detail) {
      slab(g, '#aeb6a3', x - w * .09, ledge - 11, 2.9, 3.1)
      slab(g, '#87a19867', x - w * .09 + 2.9, ledge - 10.8, 1.1, 2)
    }
  } else {
    // Warm side wall and a door handle, mounted outside the main sightline
    // in its own metal stile (the pull plate is on the frame, not glass).
    face(g, '#454a3c', l + w * .70, t, r, t, r, b, l + w * .79, b - 10)
    slab(g, '#c4af7a51', l + w * .72, t + 7, 1, h - 24)
    slab(g, '#cbaa7b49', l + 3, b - 3, w - 7, 1)
  }
  if (i < 3) {
    edge(g, '#5c4b39', .91, px, t, px, py - 2)
    face(g, ramp(g, px - 5.6, 0, px + 5.6, 0, '#4e4239', '#9b8062', '#5c4b39'),
      px - 2.8, py - 2.9, px + 2.9, py - 2.9, px + 5.6, py + .9, px - 5.6, py + .9)
    slab(g, f.lamp, px - 4.7, py + .9, 9.4, 1.25)
  }
  // Age only the edges: built-up gasket dirt, a few vertical wiped streaks
  // and lint at the base. Black levels remain inside the glass, not on trim.
  slab(g, ramp(g, l, t, r, t, '#1222297d', '#1b354c13', '#324d5318', '#0d233b7d'), l, t, w, h)
  slab(g, ramp(g, 0, t, 0, b, '#15212b8a', '#111c2700', '#263c4543'), l, t, w, h)
  if (detail) for (let j = 0; j < 13; j++) {
    const u = bridgeHash(j, i + kind.length, 540), x = l + 1.2 + (j % 2 ? u * 5.4 : w - u * 6.1 - 2)
    const high = j % 3 === 0, y = high ? t + 1 + u * 13 : b - 1 - 5 * u
    slab(g, high ? '#cbd1c845' : '#2b414371', x, y, .4 + u * .7, high ? 2 + u * 13 : 1.8 + u * 2)
  }
  g.restore()
}

export function paintShopFront(g: ArtPen, front: ShopFront, detail = true): void {
  const { frame: { left: l, top: t, right: r, bottom: b }, kind, panes } = front, w = r - l, f = finishes[kind]
  const transom = kind === 'concourse', lower = Math.max(...panes.map(p => p.bottom)) + 2
  box(g, l, t, w, b - t, f.frame, f.seam, '#1a262d', 3.5, -2)
  slab(g, '#192429', l + 2, t + 2, w - 4, b - t - 4)
  // Glazed tile/plinth with bevels, chips, and darker seams below the sill.
  slab(g, f.tread[0], l + 2, lower - 1, w - 4, b - lower)
  if (detail) for (let j = 0, y = lower; y < b - 1; y += 5.6, j++) for (let a = l + 3 - (j & 1) * 5, k = 0; a < r - 3; a += 13.6, k++) {
    const start = Math.max(l + 3, a), width = Math.min(r - 3, a + 12.6) - start, v = bridgeHash(k, j + kind.length, 733)
    slab(g, f.tread[Math.floor(v * f.tread.length)], start, y, width, Math.min(4.7, b - 1 - y))
    if (v > .39) slab(g, v > .63 ? '#b6b19b50' : '#a8aea449', start + .5, y + .3, width - 1.2, .56)
    if (v < .15) slab(g, '#29323570', start + 2, y + 1, width * .32, .7)
  }
  for (const [i, p] of panes.entries()) {
    const w = p.right - p.left, h = p.bottom - p.top
    slab(g, f.frame, p.left - 2.1, p.top - 2, w + 4.2, h + 4)
    slab(g, '#0b131a', p.left - 1.25, p.top - 1.35, w + 2.5, h + 2.7)
    interior(g, p, f, kind, i, detail)
    slab(g, f.seam + '97', p.left - 2.55, p.top - 1.4, .85, h + 3)
    slab(g, '#20282a', p.right + 1.3, p.top - .25, 1, h + 1)
    slab(g, f.sill + 'af', p.left - 1.6, p.bottom + 1.4, w + 3.2, 1.35)
    if (detail) for (let j = 0; j < 4; j++) {
      const x = p.left + w * (j + .55) / 4, y = p.bottom + 2.7
      paintFastener(g, x, y, .96, bridgeHash(i, j, 238))
    }
    if (p.use === 'door') {
      slab(g, f.frame, p.left - 6, p.top + h * .54, 4, 13)
      slab(g, '#b5a886', p.left - 5.15, p.top + h * .54 + 2, 1.5, 8)
    }
  }
  slab(g, f.seam + '82', l + 2, t + 1, w - 4, .8)
  slab(g, f.sill + '77', l + 2, b - 2, w - 4, 1)
  g.fillStyle = f.lamp; g.textAlign = 'left'; g.font = `600 ${transom ? 8.2 : 6.5}px monospace`
  if (transom) {
    slab(g, '#455453', l + 6, t + 4, w - 12, 10.1)
    slab(g, '#7780786a', l + 7, t + 4.5, w - 14, .6)
    g.fillText(f.label, l + 12, t + 12.5, w - 58)
    g.textAlign = 'right'; g.fillText('04   /   NORTH LOOP', r - 10, t + 12.5)
  } else if (detail) {
    // The tiny wayfinding text is part of a solid apron, not an emitter.
    g.fillText(f.label, l + 6.1, b - 3.5, w - 17)
  }
}
