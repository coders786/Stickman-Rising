(() => {
  const g = window.__sr
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const key = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true }))
  const keyup = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true }))
  const live = () => g.enemies.filter(e => !e.dead && !e.spawning)
  const log = []
  const god = setInterval(() => { if (g.player) { g.player.hp = g.player.maxHp; g.player.iframes = 3 } }, 120)
  async function run() {
    for (let i = 0; i < 40 && live().length === 0; i++) await sleep(300)
    const es = live()
    if (!es.length) { clearInterval(god); return 'NO_ENEMIES' }
    const e0 = es[0]
    const pinX = e0.x
    const pin = setInterval(() => { if (!e0.dead) { e0.x = pinX; e0.vx = 0 } }, 16)
    g.player.x = e0.x - 55; g.player.face = 1; g.player.vx = 0; g.player.y = 0
    key('KeyK')
    // tight sampling INSIDE the hit window (28-42% into the clip)
    for (let i = 0; i < 60; i++) {
      const p = g.player
      const a = p.action
      if (a && a.def.id === 'h1' && a.animT >= 0.2 && a.animT <= 0.45) {
        const b = p.blade
        // exact same test the game runs: spheres vs blade segment
        let hitAny = false, dets = []
        for (const oy of [14, 48, 78]) {
          const cy = e0.dead ? 9999 : e0.y - oy * e0.scale
          const r = (oy === 48 ? 21 : oy === 14 ? 15 : 17) * e0.scale + 3
          const dx = b.tx - b.bx, dy = b.ty - b.by
          const L2 = dx * dx + dy * dy || 1
          let t = ((e0.x - b.bx) * dx + (cy - b.by) * dy) / L2
          t = Math.max(0, Math.min(1, t))
          const px = b.bx + t * dx, py = b.by + t * dy
          const d = Math.hypot(e0.x - px, cy - py)
          dets.push(`oy${oy}:d=${d.toFixed(0)}${d <= r ? ' HIT' : ''}`)
          if (d <= r) hitAny = true
        }
        log.push({
          animT: +a.animT.toFixed(3), hw: a.animT >= a.def.hit.start && a.animT <= a.def.hit.end,
          eState: e0.dead ? 'DEAD' : e0.state,
          bx: +b.bx.toFixed(0), by: +b.by.toFixed(0), tx: +b.tx.toFixed(0), ty: +b.ty.toFixed(0),
          ex: e0.dead ? 0 : +e0.x.toFixed(0), ey: e0.dead ? 0 : +e0.y.toFixed(0),
          px: +p.x.toFixed(0), hipY: +p.hipY.toFixed(0), hits: g.combo.hits, hitAny, dets: dets.join(' ')
        })
      }
      await sleep(16)
      if (i === 5) keyup('KeyK')
    }
    clearInterval(pin); clearInterval(god)
    window.__probe7 = log
    return 'DONE'
  }
  window.__probe7 = null
  run()
  return 'P7_STARTED'
})()
