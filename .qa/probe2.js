(() => {
  const g = window.__sr
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const key = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true }))
  const live = () => g.enemies.filter(e => !e.dead && !e.spawning)
  const log = []
  const god = setInterval(() => { if (g.player) { g.player.hp = g.player.maxHp; g.player.iframes = 1.5 } }, 200)
  async function run() {
    for (let i = 0; i < 40 && live().length === 0; i++) await sleep(300)
    const es = live()
    if (!es.length) { clearInterval(god); return 'NO_ENEMIES' }
    const e0 = es[0]
    e0.vx = 0
    g.player.x = e0.x - 62; g.player.face = 1; g.player.vx = 0; g.player.y = 0
    const p = g.player
    const snap = () => {
      const a = p.action
      const b = p.blade
      // dist from blade SEGMENT to enemy torso center
      const cx = e0.dead ? 9999 : e0.x, cy = e0.dead ? 9999 : e0.y - 48 * e0.scale
      const dx = b.tx - b.bx, dy = b.ty - b.by
      const L2 = dx*dx + dy*dy || 1
      let t = ((cx - b.bx) * dx + (cy - b.by) * dy) / L2
      t = Math.max(0, Math.min(1, t))
      const px = b.bx + t * dx, py = b.by + t * dy
      const dist = Math.hypot(cx - px, cy - py)
      log.push({
        st: p.state, atk: a ? a.def.id : '-', animT: a ? +a.animT.toFixed(3) : null,
        hw: a ? (a.animT >= a.def.hit.start && a.animT <= a.def.hit.end) : false,
        segDist: +dist.toFixed(0), eState: e0.dead ? 'DEAD' : e0.state,
        hits: g.combo.hits, pX: +p.x.toFixed(0), eX: e0.dead ? '-' : +e0.x.toFixed(0),
      })
    }
    key('KeyJ')
    const s1 = setInterval(snap, 50)
    await sleep(420)
    key('KeyJ') // chain into L2
    await sleep(420)
    key('KeyJ') // chain into L3
    await sleep(500)
    clearInterval(s1)
    clearInterval(god)
    window.__probe2 = log
    return 'DONE'
  }
  window.__probe2 = null
  run()
  return 'P2_STARTED'
})()
