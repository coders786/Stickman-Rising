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
    if (!es.length) return 'NO_ENEMIES'
    const e0 = es[0]
    e0.vx = 0
    g.player.x = e0.x - 62; g.player.face = 1; g.player.vx = 0; g.player.y = 0
    const hits0 = g.combo.hits
    key('KeyJ')
    for (let i = 0; i < 18; i++) {
      const p = g.player
      const a = p.action
      log.push({
        t: i * 100,
        state: p.state,
        animT: a ? +a.animT.toFixed(3) : null,
        atk: a ? a.def.id : null,
        hitWin: a ? (a.animT >= a.def.hit.start && a.animT <= a.def.hit.end) : null,
        bladeTx: +p.blade.tx.toFixed(0),
        enemyX: e0.dead ? 'DEAD' : +e0.x.toFixed(0),
        hits: g.combo.hits,
        phase: g.phase,
        hs: g.hitstopT !== undefined ? +g.hitstopT.toFixed(2) : '?',
      })
      await sleep(100)
    }
    clearInterval(god)
    window.__probeResult = { hits0, log }
    return 'PROBE_DONE'
  }
  window.__probeResult = null
  run()
  return 'PROBE_STARTED'
})()
