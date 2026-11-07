(() => {
  const g = window.__sr
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const key = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true }))
  const keyup = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true }))
  const tap = async (c) => { key(c); await sleep(90); keyup(c); await sleep(20) }
  const live = () => g.enemies.filter(e => !e.dead && !e.spawning)
  const log = []
  const god = setInterval(() => { if (g.player) { g.player.hp = g.player.maxHp; g.player.iframes = 1.5 } }, 200)
  async function run() {
    for (let i = 0; i < 40 && live().length === 0; i++) await sleep(300)
    let es = live()
    if (!es.length) { clearInterval(god); return 'NO_ENEMIES' }
    // chain L1 -> L2 -> L3 while sampling blade seg dist to nearest enemy
    const e0 = es[0]
    const samples = []
    const sampler = setInterval(() => {
      const p = g.player
      const a = p.action
      const b = p.blade
      // closest approach of blade SEGMENT to each enemy sphere
      let minD = 999
      for (const e of live()) {
        for (const oy of [14, 48, 78]) {
          const cy = e.y - oy * e.scale
          const r = (oy === 48 ? 21 : oy === 14 ? 15 : 17) * e.scale + 3
          const dx = b.tx - b.bx, dy = b.ty - b.by
          const L2 = dx * dx + dy * dy || 1
          let t = ((e.x - b.bx) * dx + (cy - b.by) * dy) / L2
          t = Math.max(0, Math.min(1, t))
          const px = b.bx + t * dx, py = b.by + t * dy
          minD = Math.min(minD, Math.hypot(e.x - px, cy - py) - r)
        }
      }
      samples.push({
        st: p.state, atk: a ? a.def.id : '-',
        animT: a ? +a.animT.toFixed(3) : null,
        hw: a ? (a.animT >= a.def.hit.start && a.animT <= a.def.hit.end) : false,
        segPen: +minD.toFixed(0), // negative = inside a sphere
        ex: e0.dead ? 'DEAD' : +e0.x.toFixed(0),
        px: +p.x.toFixed(0),
        hits: g.combo.hits,
      })
    }, 40)
    g.player.x = e0.x - 62; g.player.face = 1; g.player.vx = 0
    await tap('KeyJ')          // L1
    await sleep(250)
    await tap('KeyJ')          // L2 (chain)
    await sleep(250)
    g.player.x = live()[0] ? live()[0].x - 62 : g.player.x
    await tap('KeyJ')          // L3 (chain)
    await sleep(350)
    await tap('KeyK')          // H1
    await sleep(600)
    clearInterval(sampler)
    clearInterval(god)
    window.__probe3 = samples
    return 'DONE'
  }
  window.__probe3 = null
  run()
  return 'P3_STARTED'
})()
