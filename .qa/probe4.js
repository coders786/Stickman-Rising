(() => {
  const g = window.__sr
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const key = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true }))
  const keyup = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true }))
  const live = () => g.enemies.filter(e => !e.dead && !e.spawning)
  const log = []
  const god = setInterval(() => { if (g.player) { g.player.hp = g.player.maxHp; g.player.iframes = 1.5 } }, 200)
  async function run() {
    for (let i = 0; i < 40 && live().length === 0; i++) await sleep(300)
    const es = live()
    if (!es.length) { clearInterval(god); return 'NO_ENEMIES' }
    const e0 = es[0]
    const pinX = e0.x
    const pin = setInterval(() => { if (!e0.dead) { e0.x = pinX; e0.vx = 0 } }, 16)
    g.player.x = e0.x - 55; g.player.face = 1; g.player.vx = 0; g.player.y = 0
    key('KeyK')
    for (let i = 0; i < 14; i++) {
      const p = g.player
      const a = p.action
      log.push({
        t: i * 100,
        phase: g.phase, pstate: p.state, hp: +p.hp.toFixed(0),
        atk: a ? a.def.id : null, animT: a ? +a.animT.toFixed(3) : null,
        hw: a ? (a.animT >= a.def.hit.start && a.animT <= a.def.hit.end) : false,
        btx: +p.blade.tx.toFixed(0), bty: +p.blade.ty.toFixed(0),
        eState: e0.dead ? 'DEAD' : e0.state, eHp: e0.dead ? 0 : +e0.hp.toFixed(0),
        px: +p.x.toFixed(0), ex: +e0.x.toFixed(0),
        hits: g.combo.hits,
      })
      if (i === 0) { /* keep K down for 90ms like the QA tap */ }
      await sleep(100)
      if (i === 0) keyup('KeyK')
    }
    clearInterval(pin); clearInterval(god)
    window.__probe4 = log
    return 'DONE'
  }
  window.__probe4 = null
  run()
  return 'P4_STARTED'
})()
